function extractJSON(raw) {
  if (!raw) return null;
  if (raw.length > 300000) {
    raw = raw.slice(0, 300000) + '\n\n{"warning":"output truncated for parse safety"}';
  }
  try {
    let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const start = text.indexOf('{');
    if (start === -1) throw new Error('No JSON object found');
    let depth = 0, inString = false, escape = false, end = -1;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\' && inString) { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) throw new Error('Unmatched braces — JSON cut off');
    return JSON.parse(text.slice(start, end + 1));
  } catch(e) { return null; }
}

function extractDeliverable(raw) {
  if (!raw) return null;
  if (raw.length > 400000) {
    raw = raw.slice(0, 400000) + '\n\n... [truncated] ...';
  }
  let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const thoughtMatch = text.match(/<thought>([\s\S]*?)<\/thought>/i);
  const titleMatch   = text.match(/<title>([\s\S]*?)<\/title>/i);
  const parts = text.split('---');
  let content = parts.length > 1 ? parts.slice(1).join('---').trim() : text.trim();
  content = content.replace(/^```(?:markdown)?\s*/i, '').replace(/\s*```$/, '').trim();
  if (!content || content.length < 20) return null;
  return {
    thought: thoughtMatch ? thoughtMatch[1].trim() : 'Executing...',
    title:   titleMatch   ? titleMatch[1].trim()   : 'Deliverable',
    content,
    format: 'markdown'
  };
}

let _notifTimer = null;
function showNotification(msg, duration = 3000) {
  const el = document.getElementById('notification');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  if (_notifTimer) clearTimeout(_notifTimer);
  _notifTimer = setTimeout(() => el.classList.add('hidden'), duration);
}

async function callFO(agentId, userMessage, task, maxTokens) {
  const cfg = S.cfg[agentId];
  const provider = cfg.provider;
  const apiKeys = {
    deepseek: S.keys.deepseek,
    gemini: S.keys.gemini,
    openrouter: S.keys.openrouter,
    groq: S.keys.groq,
    cloudflare: S.keys.cloudflare,
    cloudflareAccountId: S.keys.cfAcct
  };

  if (!apiKeys[provider] && provider !== 'cloudflare') {
    showNotification(`No ${provider} API key. Open Settings.`);
    return null;
  }

  const body = {
    provider,
    model: cfg.model,
    systemPrompt: PROMPTS[agentId] || '',
    userMessage,
    apiKeys,
    maxTokens
  };

  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (res.status === 429) {
        const backoff = Math.min(60, Math.pow(2, attempt) * 2 + Math.random() * 2);
        const waitSecs = Math.ceil(backoff);
        showNotification(`Rate limited by ${provider}. Retrying in ${waitSecs}s…`, waitSecs * 1000 + 500);
        await _countdown(waitSecs);
        await sleep(waitSecs * 1000);
        continue;
      }

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || `Error from ${provider}`);
      }

      if (!data.content) throw new Error('No content returned from provider.');
      return data.content;

    } catch (err) {
      if (attempt === 4) {
        showNotification(`${agentId} failed: ${err.message}`);
        return null;
      }
      const backoff = Math.min(60, Math.pow(2, attempt) + Math.random() * 2);
      await sleep(backoff * 1000);
    }
  }
  return null;
}

function _countdown(seconds) {
  return new Promise(resolve => {
    let remaining = seconds;
    const tick = () => {
      if (remaining <= 0) { resolve(); return; }
      showNotification(`Rate limited. Retrying in ${remaining}s…`, 1500);
      remaining--;
      setTimeout(tick, 1000);
    };
    tick();
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/* Failover wrapper — shows failure modal on hard error */
async function callWithFailover(agentId, userMessage, task, maxTokens) {
  const raw = await callFO(agentId, userMessage, task, maxTokens);
  if (raw !== null) return raw;

  /* Prompt user: retry with fallback or skip */
  return new Promise(resolve => {
    S.failResolve = resolve;
    showFailModal(task, `${agentId} returned no output.`);
  });
}
