function extractJSON(raw) {
  if (!raw) return null;
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
  const cfg      = S.cfg[agentId];
  const provider = cfg.provider;
  const apiKey   = provider === 'gemini'
    ? S.keys.gemini
    : provider === 'cloudflare'
      ? S.keys.cloudflare
      : S.keys[provider];

  if (!apiKey) {
    showNotification(`No ${provider} API key. Open Settings.`);
    return null;
  }

  /* Gemini uses key as query param, not Authorization header */
  const url = provider === 'gemini'
    ? buildGeminiURL(cfg.model, apiKey)
    : getProviderURL(provider, cfg.model, S.keys.cfAcct);

  const body    = buildRequestBody(provider, agentId, userMessage, maxTokens);
  const headers = provider === 'gemini'
    ? { 'Content-Type': 'application/json' }
    : buildHeaders(provider, apiKey);

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res  = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });

      /* Rate-limit handling */
      if (res.status === 429) {
        showNotification(`Rate limited by ${provider}. Waiting 60s before retry.`, 62000);
        await _countdown(60);
        continue;
      }

      const data = await res.json();
      if (!res.ok) {
        const msg = data?.error?.message || `HTTP ${res.status}`;
        if (res.status === 404) throw new Error('Model not found. Check model name in Agents tab.');
        throw new Error(msg);
      }

      const content = extractContent(provider, data);
      if (!content) throw new Error('No content returned. Model may be rate limited.');
      return content;

    } catch (err) {
      if (attempt === 3) {
        showNotification(`${agentId} failed: ${err.message}`);
        return null;
      }
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
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
