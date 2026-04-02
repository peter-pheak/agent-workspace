function extractJSON(raw) {
  if (!raw) return null;
  try {
    // 1. Strip think tags if using a reasoner model
    let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    
    // 2. Aggressively strip any markdown fences around the JSON
    text = text.replace(/^```[a-z]*\s*/im, '').replace(/\s*```$/im, '').trim();

    // 3. Find the first '{' and the LAST '}'
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    
    if (start === -1 || end === -1 || end < start) {
        throw new Error('No valid JSON object boundaries found.');
    }

    // 4. Extract just the JSON block
    const jsonString = text.substring(start, end + 1);
    
    return JSON.parse(jsonString);
  } catch(e) { 
      console.error('extractJSON failed:', e); 
      console.log("RAW OUTPUT WAS:", raw); // This will show you exactly what the AI did wrong!
      return null; 
  }
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

async function callFO(agentId, userMessage, task, maxTokens, customSystemPrompt = null) {
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

  // Use custom prompt if provided, otherwise default from PROMPTS
  const systemPrompt = customSystemPrompt !== null ? customSystemPrompt : (PROMPTS[agentId] || '');

  const body = {
    provider,
    model: cfg.model,
    systemPrompt,
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
