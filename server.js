const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json({ limit: '12mb' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

const dbPath = path.join(__dirname, 'agentos.db');
const db = new Database(dbPath);

let currentWorkspacePath = path.join(__dirname, 'workspace');

// Schema
db.exec(`
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT,
  instruction TEXT,
  assignee TEXT,
  status TEXT,
  depends_on TEXT,
  deliverable_type TEXT,
  content TEXT,
  title_output TEXT,
  error TEXT,
  is_truncated INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS profile (
  id INTEGER PRIMARY KEY,
  time_saved INTEGER DEFAULT 0,
  agent_configs TEXT
);
`);

const taskCols = db.prepare('PRAGMA table_info(tasks)').all();
if (!taskCols.find(c => c.name === 'is_truncated')) {
  db.exec('ALTER TABLE tasks ADD COLUMN is_truncated INTEGER DEFAULT 0;');
}

function normalizeDeps(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw); } catch { return []; }
}

function toTask(row) {
  return {
    id: row.id,
    title: row.title,
    instruction: row.instruction,
    assignee: row.assignee,
    status: row.status,
    depends_on: normalizeDeps(row.depends_on),
    deliverable_type: row.deliverable_type,
    content: row.content,
    title_output: row.title_output,
    error: row.error,
    is_truncated: row.is_truncated === 1
  };
}

function sanitizeFilename(name) {
  return name.toString().replace(/[<>:"/\\|?*\s]+/g, '_').replace(/_+/g, '_').substring(0, 150);
}

function extractErrorBody(data) {
  if (!data || typeof data !== 'object') return JSON.stringify(data).slice(0, 300);
  const msg = data?.error?.message || data?.message || data?.detail || (Array.isArray(data?.errors) && data.errors[0]?.message);
  return msg || JSON.stringify(data).slice(0, 300);
}

async function proxyCallWithRetry(providerName, fn, ...args) {
  const maxAttempt = 4;
  for (let attempt = 1; attempt <= maxAttempt; attempt++) {
    try {
      return await fn(...args);
    } catch (err) {
      const text = (err.message || '').toLowerCase();
      const isRateLimit = text.includes('429') || text.includes('rate limit') || text.includes('rate-limited');
      if (!isRateLimit || attempt === maxAttempt) {
        throw err;
      }
      const wait = Math.min(60, Math.pow(2, attempt) * 2 + Math.random() * 2);
      console.log(`proxyCallWithRetry ${providerName} attempt ${attempt}/${maxAttempt}, waiting ${wait.toFixed(1)}s due to 429`);
      await new Promise(resolve => setTimeout(resolve, wait * 1000));
    }
  }
}

function timedFetch(url, opts = {}, ms = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...opts, signal: controller.signal })
    .catch(e => {
      if (e.name === 'AbortError') throw new Error(`Request timed out after ${ms / 1000}s`);
      throw e;
    })
    .finally(() => clearTimeout(timer));
}

async function callDeepSeek(model, system, user, apiKey) {
  const url = 'https://api.deepseek.com/v1/chat/completions';
  const res = await timedFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      max_tokens: 4096,
      temperature: 0.7
    })
  });

  if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error(`DeepSeek no content; response: ${JSON.stringify(data).slice(0, 300)}`);
  return content;
}

async function callGemini(model, system, user, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await timedFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { maxOutputTokens: 4096, temperature: 0.7, responseMimeType: 'text/plain' },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' }
      ]
    })
  });

  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const data = await res.json();
  if (data.error) throw new Error(`Gemini error: ${data.error.message || JSON.stringify(data.error)}`);
  const candidate = data?.candidates?.[0];
  if (!candidate) throw new Error(`Gemini blocked: ${JSON.stringify(data.promptFeedback || data).slice(0, 300)}`);
  if (candidate.finishReason === 'SAFETY') throw new Error('Gemini: blocked by safety filter');
  if (candidate.finishReason === 'RECITATION') throw new Error('Gemini: blocked by recitation');
  const text = candidate?.content?.parts?.[0]?.text;
  if (!text) throw new Error(`Gemini empty response (finishReason: ${candidate.finishReason})`);
  return text;
}

async function callGroq(model, system, user, apiKey) {
  const url = 'https://api.groq.com/openai/v1/chat/completions';
  const res = await timedFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      max_tokens: 4096,
      temperature: 0.7
    })
  });

  if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error(`Groq no content; response: ${JSON.stringify(data).slice(0, 300)}`);
  return content;
}

async function callOpenRouter(model, system, user, apiKey) {
  const url = 'https://openrouter.ai/api/v1/chat/completions';
  const res = await timedFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'X-Title': 'AgentOS Workspace'
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      max_tokens: 4096,
      temperature: 0.7
    })
  });

  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  const data = await res.json();
  if (data.error) throw new Error(`OpenRouter error: ${JSON.stringify(data.error)}`);
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    const reason = data?.choices?.[0]?.finish_reason || 'unknown';
    throw new Error(`OpenRouter no content. finish_reason: ${reason}`);
  }
  return content;
}

async function callCloudflare(model, system, user, apiKey, accountId) {
  if (!accountId || !accountId.trim()) throw new Error('Cloudflare Account ID is required');
  const modelPath = model.startsWith('@') ? model : `@cf/${model}`;
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId.trim()}/ai/run/${modelPath}`;
  const res = await timedFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      max_tokens: 4096
    })
  });

  if (!res.ok) throw new Error(`Cloudflare AI ${res.status}: ${await res.text()}`);
  const data = await res.json();
  if (!data.success) {
    const errMsg = Array.isArray(data.errors) ? data.errors.map(e => e.message).join(', ') : 'unknown';
    throw new Error(`Cloudflare AI error: ${errMsg}`);
  }

  if (typeof data.result === 'string') return data.result;
  if (typeof data?.result?.response === 'string') return data.result.response;
  if (typeof data?.result?.generated_text === 'string') return data.result.generated_text;
  throw new Error(`Cloudflare AI: unrecognized shape ${JSON.stringify(data.result).slice(0, 300)}`);
}

app.post('/api/agent', async (req, res) => {
  const { provider, model, systemPrompt, userMessage, apiKeys } = req.body;
  if (!provider || !model || !systemPrompt || !userMessage || !apiKeys) {
    return res.status(400).json({ success: false, error: 'Missing required fields: provider, model, systemPrompt, userMessage, apiKeys' });
  }

  try {
    let content;
    switch (provider.toLowerCase()) {
      case 'deepseek':
        if (!apiKeys.deepseek) throw new Error('DeepSeek API key missing');
        content = await proxyCallWithRetry('DeepSeek', callDeepSeek, model, systemPrompt, userMessage, apiKeys.deepseek);
        break;
      case 'gemini':
        if (!apiKeys.gemini) throw new Error('Gemini API key missing');
        content = await proxyCallWithRetry('Gemini', callGemini, model, systemPrompt, userMessage, apiKeys.gemini);
        break;
      case 'groq':
        if (!apiKeys.groq) throw new Error('Groq API key missing');
        content = await proxyCallWithRetry('Groq', callGroq, model, systemPrompt, userMessage, apiKeys.groq);
        break;
      case 'openrouter':
        if (!apiKeys.openrouter) throw new Error('OpenRouter API key missing');
        content = await proxyCallWithRetry('OpenRouter', callOpenRouter, model, systemPrompt, userMessage, apiKeys.openrouter);
        break;
      case 'cloudflare':
        if (!apiKeys.cloudflare) throw new Error('Cloudflare API key missing');
        content = await proxyCallWithRetry('Cloudflare', callCloudflare, model, systemPrompt, userMessage, apiKeys.cloudflare, apiKeys.cloudflareAccountId || apiKeys.cfAcct);
        break;
      default:
        throw new Error(`Unknown provider ${provider}`);
    }
    return res.json({ success: true, content });
  } catch (err) {
    return res.status(200).json({ success: false, error: err.message || 'Unknown error' });
  }
});

app.post('/api/set-workspace', (req, res) => {
  try {
    const requestedPath = req.body?.path;
    if (!requestedPath || typeof requestedPath !== 'string') {
      return res.status(400).json({ success: false, error: 'Missing path string' });
    }
    currentWorkspacePath = path.resolve(requestedPath);
    if (!fs.existsSync(currentWorkspacePath)) {
      fs.mkdirSync(currentWorkspacePath, { recursive: true });
    }
    return res.json({ success: true, path: currentWorkspacePath });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/load', (req, res) => {
  try {
    const tasks = db.prepare('SELECT * FROM tasks').all().map(toTask);
    const profileRow = db.prepare('SELECT * FROM profile WHERE id = 1').get();
    const profile = profileRow ? {
      time_saved: profileRow.time_saved || 0,
      agent_configs: profileRow.agent_configs ? JSON.parse(profileRow.agent_configs) : {}
    } : { time_saved: 0, agent_configs: {} };
    return res.json({ success: true, tasks, profile });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/save-task', (req, res) => {
  try {
    const task = req.body;
    if (!task?.id) return res.status(400).json({ success: false, error: 'Missing task.id' });

    let content = task.content || '';
    let is_truncated = 0;
    const MAX_CONTENT = 500 * 1024;
    if (content.length > MAX_CONTENT) {
      content = content.slice(0, MAX_CONTENT);
      is_truncated = 1;
    }

    const stmt = db.prepare(`INSERT INTO tasks (id,title,instruction,assignee,status,depends_on,deliverable_type,content,title_output,error,is_truncated)
      VALUES (@id,@title,@instruction,@assignee,@status,@depends_on,@deliverable_type,@content,@title_output,@error,@is_truncated)
      ON CONFLICT(id) DO UPDATE SET
        title=excluded.title,
        instruction=excluded.instruction,
        assignee=excluded.assignee,
        status=excluded.status,
        depends_on=excluded.depends_on,
        deliverable_type=excluded.deliverable_type,
        content=excluded.content,
        title_output=excluded.title_output,
        error=excluded.error,
        is_truncated=excluded.is_truncated;`);

    const data = {
      id: task.id,
      title: task.title || '',
      instruction: task.instruction || '',
      assignee: task.assignee || '',
      status: task.status || '',
      depends_on: JSON.stringify(task.depends_on || []),
      deliverable_type: task.deliverable_type || '',
      content,
      title_output: task.title_output || '',
      error: task.error || '',
      is_truncated
    };

    stmt.run(data);
    return res.json({ success: true, task: toTask(data) });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/save-profile', (req, res) => {
  try {
    const { time_saved, agent_configs } = req.body;
    const agentConfigsSerialized = JSON.stringify(agent_configs || {});
    const stmt = db.prepare(`INSERT INTO profile (id,time_saved,agent_configs)
      VALUES (1,@time_saved,@agent_configs)
      ON CONFLICT(id) DO UPDATE SET time_saved=excluded.time_saved, agent_configs=excluded.agent_configs;`);
    stmt.run({ time_saved: Number(time_saved) || 0, agent_configs: agentConfigsSerialized });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/clear', (req, res) => {
  try {
    db.prepare('DELETE FROM tasks').run();
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

function extractFilesFromTasks(tasks) {
  const files = [];
  const blockRegex = /```(\w*)\n([\s\S]*?)```/g;

  for (const task of tasks || []) {
    const content = task?.content || '';
    let m;
    while ((m = blockRegex.exec(content)) !== null) {
      const lang = m[1] || 'txt';
      const snippet = m[2] || '';
      const safeTitle = sanitizeFilename(task.title || task.id || 'task');
      const filename = `${task.id || 'task'}-${safeTitle}.${lang}`;
      files.push({ filename, content: snippet });
    }

    if (files.length === 0 && task?.deliverable_type === 'code' && content.trim()) {
      const safeTitle = sanitizeFilename(task.title || task.id || 'task');
      const filename = `${task.id || 'task'}-${safeTitle}.txt`;
      files.push({ filename, content });
    }
  }

  return files;
}

app.post('/api/sync', (req, res) => {
  try {
    const tasks = req.body.tasks || [];
    const incomingFiles = req.body.files || [];
    let files = Array.isArray(incomingFiles) ? incomingFiles.slice() : [];
    if (tasks.length > 0) {
      files = files.concat(extractFilesFromTasks(tasks));
    }

    if (!fs.existsSync(currentWorkspacePath)) {
      fs.mkdirSync(currentWorkspacePath, { recursive: true });
    }

    const written = [];
    for (const file of files) {
      const rawFilename = file.filename || `task-${Date.now()}.txt`;
      const normalized = rawFilename.replace(/\\/g, '/');
      const dirPart = path.dirname(normalized);
      const targetDir = path.join(currentWorkspacePath, dirPart === '.' ? '' : dirPart);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      const safeName = path.basename(normalized);
      const targetPath = path.join(targetDir, safeName);
      fs.writeFileSync(targetPath, file.content || '', 'utf8');
      console.log(`Sync wrote file: ${targetPath}`);
      written.push({ filename: rawFilename, path: targetPath });
    }

    return res.json({ success: true, filesWritten: written, workspace: currentWorkspacePath });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`AgentOS unified server listening on http://localhost:${port}`);
});
