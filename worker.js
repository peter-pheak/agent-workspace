// ─── CORS ─────────────────────────────────────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function ok(content) {
  return new Response(JSON.stringify({ success: true, content }), {
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

function err(msg, status = 200) {
  // Always 200 so the browser fetch doesn't throw — error is in the body
  return new Response(JSON.stringify({ success: false, error: msg }), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

// ─── HELPER: safe JSON parse of error body ────────────────────────────────────
async function extractError(res, provider) {
  let body = '';
  try { body = await res.text(); } catch { body = '(no body)'; }
  // Try to pull a human-readable message from common error shapes
  try {
    const j = JSON.parse(body);
    const msg =
      j?.error?.message ||          // OpenAI / DeepSeek / OpenRouter shape
      j?.message ||                  // generic
      j?.detail ||                   // FastAPI shape
      j?.errors?.[0]?.message ||     // Cloudflare shape
      JSON.stringify(j).slice(0, 300);
    return `${provider} ${res.status}: ${msg}`;
  } catch {
    return `${provider} ${res.status}: ${body.slice(0, 300)}`;
  }
}

// ─── TIMEOUT HELPER ───────────────────────────────────────────────────────────
// Wraps a fetch call with an AbortController. Cloudflare Workers have a 30s
// CPU wall time; we abort at 25s so the Worker can return a clean error
// instead of dying with an opaque edge timeout.
function timedFetch(url, opts, ms = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...opts, signal: controller.signal })
    .catch(e => {
      if (e.name === 'AbortError') throw new Error(`Request timed out after ${ms / 1000}s`);
      throw e;
    })
    .finally(() => clearTimeout(timer));
}

// ─── DEEPSEEK ─────────────────────────────────────────────────────────────────
// API: OpenAI-compatible  https://api.deepseek.com/v1/chat/completions
async function callDeepSeek(model, system, user, apiKey) {
  const res = await timedFetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: user   },
      ],
      max_tokens: 4096,
      temperature: 0.7,
    }),
  });

  if (!res.ok) throw new Error(await extractError(res, 'DeepSeek'));

  const data = await res.json();

  // Defensive — check the shape before accessing
  const content = data?.choices?.[0]?.message?.content;
  if (content == null) {
    const reason = data?.choices?.[0]?.finish_reason || 'unknown';
    throw new Error(`DeepSeek returned no content. finish_reason: ${reason}`);
  }
  return content;
}

// ─── GEMINI (AI Studio) ───────────────────────────────────────────────────────
// API: https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
// Notes:
//   - systemInstruction is supported on gemini-1.5+ and gemini-2.0+
//   - Safety filters can block responses → candidates[0].content may be undefined
//   - Add permissive safety settings to reduce false blocks on business prompts
async function callGemini(model, system, user, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const res = await timedFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: {
        maxOutputTokens: 4096,
        temperature: 0.7,
        responseMimeType: 'text/plain',
      },
      // Relax safety thresholds so business/tech prompts aren't blocked
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
      ],
    }),
  });

  if (!res.ok) throw new Error(await extractError(res, 'Gemini'));

  const data = await res.json();

  // Prompt-level block (e.g. key invalid, quota)
  if (data.error) throw new Error(`Gemini error: ${data.error.message}`);

  // Candidate-level block (safety / recitation / other)
  const candidate = data?.candidates?.[0];
  if (!candidate) {
    const feedback = data?.promptFeedback?.blockReason || 'no candidates returned';
    throw new Error(`Gemini blocked: ${feedback}`);
  }

  const finishReason = candidate.finishReason;
  if (finishReason === 'SAFETY') throw new Error('Gemini: response blocked by safety filter');
  if (finishReason === 'RECITATION') throw new Error('Gemini: response blocked (recitation)');

  const text = candidate?.content?.parts?.[0]?.text;
  if (text == null) throw new Error(`Gemini: empty response (finishReason: ${finishReason})`);
  return text;
}

// ─── CLOUDFLARE AI ────────────────────────────────────────────────────────────
// API: https://api.cloudflare.com/client/v4/accounts/{id}/ai/run/{model}
// Notes:
//   - model must be the FULL path e.g. @cf/meta/llama-3.1-8b-instruct
//   - result shape varies by model family:
//       text gen → data.result.response  OR  data.result.generated_text
//       some models → data.result (plain string)
async function callCloudflare(model, system, user, apiKey, accountId) {
  if (!accountId || !accountId.trim()) {
    throw new Error('Cloudflare Account ID is required. Add it in Settings.');
  }

  // Ensure model starts with @ (common mistake is to omit it)
  const modelPath = model.startsWith('@') ? model : `@cf/${model}`;

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId.trim()}/ai/run/${modelPath}`;

  const res = await timedFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: user   },
      ],
      max_tokens: 4096,
    }),
  });

  if (!res.ok) throw new Error(await extractError(res, 'Cloudflare AI'));

  const data = await res.json();

  if (!data.success) {
    const errMsg = data.errors?.map(e => e.message).join(', ') || 'unknown error';
    throw new Error(`Cloudflare AI error: ${errMsg}`);
  }

  // Handle all known result shapes
  const result = data.result;
  if (typeof result === 'string') return result;                     // plain string
  if (typeof result?.response === 'string') return result.response; // most text models
  if (typeof result?.generated_text === 'string') return result.generated_text; // some models

  throw new Error(`Cloudflare AI: unrecognised response shape: ${JSON.stringify(result).slice(0, 200)}`);
}

// ─── OPENROUTER ───────────────────────────────────────────────────────────────
// API: OpenAI-compatible  https://openrouter.ai/api/v1/chat/completions
// Notes:
//   - Free models may return content: null when rate-limited or filtered
//   - Omit HTTP-Referer if it causes 403 on some models
//   - Some models may return finish_reason: 'content_filter' with null content
async function callOpenRouter(model, system, user, apiKey) {
  const res = await timedFetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      // X-Title is fine; skip HTTP-Referer to avoid 403 on some free models
      'X-Title': 'AgentOS Workspace',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: user   },
      ],
      max_tokens: 4096,
      temperature: 0.7,
    }),
  });

  if (!res.ok) throw new Error(await extractError(res, 'OpenRouter'));

  const data = await res.json();

  // Top-level error (auth, quota, model not found)
  if (data.error) {
    throw new Error(`OpenRouter error: ${data.error.message || JSON.stringify(data.error)}`);
  }

  const choice = data?.choices?.[0];
  if (!choice) throw new Error('OpenRouter: no choices in response');

  const content = choice?.message?.content;
  if (content == null) {
    // Common on free models when rate limited or content-filtered
    const reason = choice?.finish_reason || 'null content';
    throw new Error(`OpenRouter: no content returned. finish_reason: "${reason}". Try a different free model or wait for rate limit reset.`);
  }
  return content;
}

// ─── GROQ (bonus — same OpenAI-compat shape, easy to add) ────────────────────
async function callGroq(model, system, user, apiKey) {
  const res = await timedFetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: user   },
      ],
      max_tokens: 4096,
      temperature: 0.7,
    }),
  });
  if (!res.ok) throw new Error(await extractError(res, 'Groq'));
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (content == null) throw new Error(`Groq: no content. finish_reason: ${data?.choices?.[0]?.finish_reason}`);
  return content;
}

// ─── KV PERSISTENCE ───────────────────────────────────────────────────────────
// Requires WORKSPACE_KV binding in wrangler.toml.
// If KV is not bound, /api/kv/load returns null (graceful degradation) and
// /api/kv/save returns a soft error — the frontend handles both silently.
const KV_TTL = 60 * 60 * 24 * 90; // 90 days

// Per-user key isolation — frontend sends X-Session-Id (a UUID stored in
// localStorage). Without this every visitor would overwrite the same KV key.
// Sanitise strictly: only alphanum + hyphens, max 64 chars.
function getUserKvKey(request) {
  const sessionId = request.headers.get('X-Session-Id') || 'default';
  const safe = sessionId.replace(/[^a-zA-Z0-9\-]/g, '').slice(0, 64);
  return `workspace_v2_${safe || 'default'}`;
}

async function handleKvSave(request, env) {
  if (!env.WORKSPACE_KV) return err('KV not configured — add WORKSPACE_KV binding');
  let body;
  try { body = await request.json(); } catch { return err('Invalid JSON body'); }
  const { state } = body;
  if (!state) return err('Missing state field');
  try {
    const key = getUserKvKey(request);
    await env.WORKSPACE_KV.put(key, JSON.stringify(state), { expirationTtl: KV_TTL });
    return ok('saved');
  } catch (e) {
    return err(`KV write failed: ${e.message}`);
  }
}

async function handleKvLoad(request, env) {
  if (!env.WORKSPACE_KV) return ok(null); // no KV → silent null, not an error
  try {
    const key = getUserKvKey(request);
    const raw = await env.WORKSPACE_KV.get(key);
    if (!raw) return ok(null);
    return ok(JSON.parse(raw));
  } catch (e) {
    return err(`KV read failed: ${e.message}`);
  }
}

async function handleKvClear(request, env) {
  if (!env.WORKSPACE_KV) return ok('no-op');
  try {
    const key = getUserKvKey(request);
    await env.WORKSPACE_KV.delete(key);
    return ok('cleared');
  } catch (e) {
    return err(`KV delete failed: ${e.message}`);
  }
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────
async function handleAgentCall(request) {
  let body;
  try { body = await request.json(); }
  catch { return err('Invalid JSON body', 400); }

  const { provider, model, systemPrompt, userMessage, apiKeys } = body;

  if (!provider || !model?.trim() || !systemPrompt || !userMessage || !apiKeys) {
    return err('Missing required fields: provider, model, systemPrompt, userMessage, apiKeys', 400);
  }

  const modelStr = model.trim();

  try {
    let content;
    switch (provider) {
      case 'deepseek':
        if (!apiKeys.deepseek)   throw new Error('DeepSeek API key not set in Settings');
        content = await callDeepSeek(modelStr, systemPrompt, userMessage, apiKeys.deepseek);
        break;

      case 'gemini':
        if (!apiKeys.gemini)     throw new Error('AI Studio (Gemini) API key not set in Settings');
        content = await callGemini(modelStr, systemPrompt, userMessage, apiKeys.gemini);
        break;

      case 'cloudflare':
        if (!apiKeys.cloudflare) throw new Error('Cloudflare API key not set in Settings');
        content = await callCloudflare(modelStr, systemPrompt, userMessage, apiKeys.cloudflare, apiKeys.cloudflareAccountId);
        break;

      case 'openrouter':
        if (!apiKeys.openrouter) throw new Error('OpenRouter API key not set in Settings');
        content = await callOpenRouter(modelStr, systemPrompt, userMessage, apiKeys.openrouter);
        break;

      case 'groq':
        if (!apiKeys.groq)       throw new Error('Groq API key not set in Settings');
        content = await callGroq(modelStr, systemPrompt, userMessage, apiKeys.groq);
        break;

      default:
        throw new Error(`Unknown provider "${provider}". Valid: deepseek, gemini, cloudflare, openrouter, groq`);
    }
    return ok(content);
  } catch (e) {
    return err(e.message);
  }
}

// ─── ENTRY ────────────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    const url = new URL(request.url);

    if (url.pathname === '/api/agent' && request.method === 'POST') {
      return handleAgentCall(request);
    }

    // KV persistence endpoints
    if (url.pathname === '/api/kv/save'  && request.method === 'POST')   return handleKvSave(request, env);
    if (url.pathname === '/api/kv/load'  && request.method === 'GET')    return handleKvLoad(request, env);
    if (url.pathname === '/api/kv/clear' && request.method === 'POST')   return handleKvClear(request, env);

    if (url.pathname === '/api/ping') {
      return new Response(JSON.stringify({ ok: true, ts: Date.now() }), {
        headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    return env.ASSETS.fetch(request);
  },
};
