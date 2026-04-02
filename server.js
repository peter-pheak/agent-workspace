const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process'); 

const app = express();
app.use(express.json({ limit: '12mb' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

const dbPath = path.join(__dirname, 'agentos.db');
const db = new Database(dbPath);

let currentWorkspacePath = path.join(__dirname, 'workspace');

// ==================== DATABASE SCHEMA ====================
db.exec(`
CREATE TABLE IF NOT EXISTS workspaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  workspace_id INTEGER,
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

// Safe Database Migrations (Upgrading older tables without data loss)
const taskCols = db.prepare('PRAGMA table_info(tasks)').all();
if (!taskCols.find(c => c.name === 'is_truncated')) {
  db.exec('ALTER TABLE tasks ADD COLUMN is_truncated INTEGER DEFAULT 0;');
}
if (!taskCols.find(c => c.name === 'workspace_id')) {
  db.exec('ALTER TABLE tasks ADD COLUMN workspace_id INTEGER DEFAULT 1;');
}

// Ensure at least one default workspace exists
const defaultWs = db.prepare('SELECT * FROM workspaces WHERE id = 1').get();
if (!defaultWs) {
  db.prepare("INSERT INTO workspaces (id, name) VALUES (1, 'Default Project')").run();
}

// ==================== HELPER FUNCTIONS ====================
function normalizeDeps(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw); } catch { return []; }
}

function toTask(row) {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
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

// ==================== AI PROXY LOGIC (Unchanged) ====================
async function proxyCallWithRetry(providerName, fn, ...args) {
  const maxAttempt = 4;
  for (let attempt = 1; attempt <= maxAttempt; attempt++) {
    try {
      return await fn(...args);
    } catch (err) {
      const text = (err.message || '').toLowerCase();
      const isRateLimit = text.includes('429') || text.includes('rate limit') || text.includes('rate-limited');
      if (!isRateLimit || attempt === maxAttempt) throw err;
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

// AI Calls
async function callDeepSeek(model, system, user, apiKey) {
  const url = 'https://api.deepseek.com/v1/chat/completions';
  const res = await timedFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: 4096, temperature: 0.7 })
  });
  if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error(`DeepSeek no content`);
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
      generationConfig: { maxOutputTokens: 4096, temperature: 0.7 }
    })
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const data = await res.json();
  if (data.error) throw new Error(`Gemini error: ${data.error.message}`);
  const candidate = data?.candidates?.[0];
  if (!candidate) throw new Error(`Gemini blocked`);
  const text = candidate?.content?.parts?.[0]?.text;
  if (!text) throw new Error(`Gemini empty response`);
  return text;
}

async function callGroq(model, system, user, apiKey) {
  const url = 'https://api.groq.com/openai/v1/chat/completions';
  const res = await timedFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: 4096 })
  });
  if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content;
}

async function callOpenRouter(model, system, user, apiKey) {
  const url = 'https://openrouter.ai/api/v1/chat/completions';
  const res = await timedFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, 'X-Title': 'AgentOS Workspace' },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] })
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content;
}

async function callCloudflare(model, system, user, apiKey, accountId) {
  if (!accountId) throw new Error('Cloudflare Account ID is required');
  const modelPath = model.startsWith('@') ? model : `@cf/${model}`;
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId.trim()}/ai/run/${modelPath}`;
  const res = await timedFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ messages: [{ role: 'system', content: system }, { role: 'user', content: user }] })
  });
  if (!res.ok) throw new Error(`Cloudflare AI ${res.status}`);
  const data = await res.json();
  if (typeof data.result === 'string') return data.result;
  if (typeof data?.result?.response === 'string') return data.result.response;
  return data.result;
}

app.post('/api/agent', async (req, res) => {
  const { provider, model, systemPrompt, userMessage, apiKeys } = req.body;
  if (!provider || !model || !systemPrompt || !userMessage || !apiKeys) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }

  try {
    let content;
    switch (provider.toLowerCase()) {
      case 'deepseek': content = await proxyCallWithRetry('DeepSeek', callDeepSeek, model, systemPrompt, userMessage, apiKeys.deepseek); break;
      case 'gemini': content = await proxyCallWithRetry('Gemini', callGemini, model, systemPrompt, userMessage, apiKeys.gemini); break;
      case 'groq': content = await proxyCallWithRetry('Groq', callGroq, model, systemPrompt, userMessage, apiKeys.groq); break;
      case 'openrouter': content = await proxyCallWithRetry('OpenRouter', callOpenRouter, model, systemPrompt, userMessage, apiKeys.openrouter); break;
      case 'cloudflare': content = await proxyCallWithRetry('Cloudflare', callCloudflare, model, systemPrompt, userMessage, apiKeys.cloudflare, apiKeys.cloudflareAccountId || apiKeys.cfAcct); break;
      default: throw new Error(`Unknown provider ${provider}`);
    }
    return res.json({ success: true, content });
  } catch (err) {
    return res.status(200).json({ success: false, error: err.message || 'Unknown error' });
  }
});


// ==================== WORKSPACE & DATABASE APIs ====================

// 1. Get all Workspaces
app.get('/api/workspaces', (req, res) => {
  try {
    const workspaces = db.prepare('SELECT * FROM workspaces ORDER BY created_at DESC').all();
    res.json({ success: true, workspaces });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Create a new Workspace
app.post('/api/workspaces', (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Workspace name required' });
    const info = db.prepare('INSERT INTO workspaces (name) VALUES (?)').run(name);
    const newWs = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(info.lastInsertRowid);
    res.json({ success: true, workspace: newWs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Clear Workspace Folder on Disk (The "Wipe" function)
app.post('/api/clear-workspace-disk', (req, res) => {
  try {
    if (fs.existsSync(currentWorkspacePath)) {
      fs.rmSync(currentWorkspacePath, { recursive: true, force: true });
    }
    // Recreate the empty folder instantly
    fs.mkdirSync(currentWorkspacePath, { recursive: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Update Workspace Disk Path
app.post('/api/set-workspace', (req, res) => {
  try {
    const requestedPath = req.body?.path;
    if (!requestedPath) return res.status(400).json({ success: false, error: 'Missing path string' });
    currentWorkspacePath = path.resolve(requestedPath);
    if (!fs.existsSync(currentWorkspacePath)) {
      fs.mkdirSync(currentWorkspacePath, { recursive: true });
    }
    return res.json({ success: true, path: currentWorkspacePath });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Load Tasks for a Specific Workspace
app.get('/api/load', (req, res) => {
  try {
    const workspace_id = req.query.workspace_id ? parseInt(req.query.workspace_id) : 1;
    const tasks = db.prepare('SELECT * FROM tasks WHERE workspace_id = ?').all(workspace_id).map(toTask);
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

// 6. Save a single task (Requires workspace_id)
app.post('/api/save-task', (req, res) => {
  try {
    const task = req.body;
    if (!task?.id) return res.status(400).json({ success: false, error: 'Missing task.id' });

    const workspace_id = task.workspace_id || 1; // Default to 1 if missing
    let content = task.content || '';
    let is_truncated = 0;
    const MAX_CONTENT = 500 * 1024;
    
    if (content.length > MAX_CONTENT) {
      content = content.slice(0, MAX_CONTENT);
      is_truncated = 1;
    }

    const stmt = db.prepare(`INSERT INTO tasks (id,workspace_id,title,instruction,assignee,status,depends_on,deliverable_type,content,title_output,error,is_truncated)
      VALUES (@id,@workspace_id,@title,@instruction,@assignee,@status,@depends_on,@deliverable_type,@content,@title_output,@error,@is_truncated)
      ON CONFLICT(id) DO UPDATE SET
        workspace_id=excluded.workspace_id,
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
      workspace_id: workspace_id,
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

// Save Profile
app.post('/api/save-profile', (req, res) => {
  try {
    const { time_saved, agent_configs } = req.body;
    const stmt = db.prepare(`INSERT INTO profile (id,time_saved,agent_configs)
      VALUES (1,@time_saved,@agent_configs)
      ON CONFLICT(id) DO UPDATE SET time_saved=excluded.time_saved, agent_configs=excluded.agent_configs;`);
    stmt.run({ time_saved: Number(time_saved) || 0, agent_configs: JSON.stringify(agent_configs || {}) });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Clear DB Tasks
app.post('/api/clear', (req, res) => {
  try {
    const workspace_id = req.body.workspace_id || 1;
    db.prepare('DELETE FROM tasks WHERE workspace_id = ?').run(workspace_id);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== SYNC TO DISK ====================
function extractFilesFromTasks(tasks) {
  const files = [];
  // UPDATED REGEX: Matches "### File: path/name.ext" from the prompt protocol
  const blockRegex = /### File:\s*([^\s\n]+)\n```(\w*)\n([\s\S]*?)```/g;

  for (const task of tasks || []) {
    const content = task?.content || '';
    let m;
    let foundProtocol = false;

    // First try to find the strict ### File: protocol
    while ((m = blockRegex.exec(content)) !== null) {
      foundProtocol = true;
      let filename = m[1].trim();
      const lang = m[2] || 'txt';
      const snippet = m[3] || '';
      
      // Phase 6 Extension Fix: If filename has no extension, add it based on language tag
      if (!filename.includes('.')) {
          let ext = lang;
          if (lang === 'javascript') ext = 'js';
          if (lang === 'python') ext = 'py';
          if (lang === 'bash' || lang === 'shell') ext = 'sh';
          if (lang === 'markdown') ext = 'md';
          filename = `${filename}.${ext}`;
      }
      
      files.push({ filename, content: snippet });
    }

    // Fallback: If no protocol was used, save the whole response as a text file
    if (!foundProtocol && task?.deliverable_type === 'code' && content.trim()) {
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
    let files = extractFilesFromTasks(tasks);

    if (!fs.existsSync(currentWorkspacePath)) {
      fs.mkdirSync(currentWorkspacePath, { recursive: true });
    }

    const written = [];
    for (const file of files) {
      const normalized = file.filename.replace(/\\/g, '/');
      const dirPart = path.dirname(normalized);
      const targetDir = path.join(currentWorkspacePath, dirPart === '.' ? '' : dirPart);
      
      // Ensure subdirectories exist
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      const safeName = path.basename(normalized);
      const targetPath = path.join(targetDir, safeName);
      fs.writeFileSync(targetPath, file.content || '', 'utf8');
      console.log(`[Sync] Wrote file: ${targetPath}`);
      written.push({ filename: file.filename, path: targetPath });
    }

    return res.json({ success: true, filesWritten: written, workspace: currentWorkspacePath });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== TOOLS (Eyes & Hands) ====================
app.get('/api/read-file', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'Missing path parameter' });
  const fullPath = path.resolve(currentWorkspacePath, filePath);
  if (!fullPath.startsWith(currentWorkspacePath)) return res.status(403).json({ error: 'Access denied' });
  try { res.json({ content: fs.readFileSync(fullPath, 'utf-8') }); } 
  catch (err) { res.status(404).json({ error: 'File not found' }); }
});

app.get('/api/tree', (req, res) => {
  function getTree(dir) {
    let results = [];
    if (!fs.existsSync(dir)) return results;
    const list = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of list) {
      if (['node_modules', '.git', '.DS_Store', 'agentos.db'].includes(item.name)) continue;
      const itemPath = path.join(dir, item.name);
      if (item.isDirectory()) {
        results.push({ type: 'folder', name: item.name, children: getTree(itemPath) });
      } else {
        results.push({ type: 'file', name: item.name });
      }
    }
    return results;
  }
  try { res.json({ tree: getTree(currentWorkspacePath) }); } 
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/terminal', (req, res) => {
  const { command } = req.body;
  if (!command) return res.status(400).json({ error: 'Missing command' });
  exec(command, { cwd: currentWorkspacePath, timeout: 30000 }, (error, stdout, stderr) => {
    if (error) return res.json({ success: false, output: (stderr || error.message).slice(0, 5000) });
    res.json({ success: true, output: stdout.slice(0, 5000) });
  });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`⬡ AgentOS Backend running on http://localhost:${port}`);
});