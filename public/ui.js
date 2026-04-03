/* ── Master render ── */
function render() {
  renderStats();
  renderAgentList();
  renderAgentCfg();
  renderTaskBoard();
  renderRightPanel();
  renderPolishBtn();
  renderNavActive();
  renderWorkspaceDropdown(); // NEW: Keeps the project list in sync
}

async function loadProjectContext() {
    const container = document.getElementById('project-context-list');
    if (!container) return;
    container.innerHTML = '<div style="font-size:11px; color:var(--dim); text-align:center;">Loading...</div>';
    
    try {
        const res = await fetch('/api/list-source');
        const files = await res.json();
        
        container.innerHTML = files.map(f => `
            <label style="display:flex; align-items:center; gap:6px; font-size:11px; color:var(--dim); cursor:pointer; margin-bottom:4px;">
                <input type="checkbox" class="context-cb" value="${f}">
                <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${f}</span>
            </label>
        `).join('');
    } catch (e) {
        container.innerHTML = '<div style="color:var(--red); font-size:11px;">Error loading files</div>';
    }
}

/* ── Workspace Management ── */

async function renderWorkspaceDropdown() {
  const select = document.getElementById('workspace-select');
  if (!select) return;

  if (S.workspaces.length === 0) {
    select.innerHTML = `<option value="1">Default Project</option>`;
    return;
  }

  select.innerHTML = S.workspaces.map(ws => 
    `<option value="${ws.id}" ${S.currentWorkspaceId == ws.id ? 'selected' : ''}>${_esc(ws.name)}</option>`
  ).join('');
}

async function switchWorkspace(id) {
  const wsId = parseInt(id);
  if (S.running || S.polishing) {
    showNotification('Cannot switch projects while agents are running.');
    renderWorkspaceDropdown(); // Reset dropdown
    return;
  }
  
  S.currentWorkspaceId = wsId;
  localStorage.setItem('agentos_workspace', wsId);
  
  showNotification('Switching project...');
  // loadFromSQLite is defined in init.js
  await loadFromSQLite(wsId);
  render();
}

async function createNewProject() {
  const name = prompt("Enter a name for the new project:");
  if (!name) return;

  try {
    const res = await fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const data = await res.json();
    
    if (data.success) {
      // 1. Update Workspace List
      const listRes = await fetch('/api/workspaces');
      const listData = await listRes.json();
      S.workspaces = listData.workspaces;
      
      // 2. Switch to the new ID
      S.currentWorkspaceId = data.workspace.id;
      localStorage.setItem('agentos_workspace', S.currentWorkspaceId);
      
      // 3. Optional: Wipe the physical disk folder for a fresh start
      if (confirm("Start with a clean folder? (Deletes all files in the sync workspace)")) {
        await fetch('/api/clear-workspace-disk', { method: 'POST' });
      }
      
      // 4. Reset Board
      S.tasks = [];
      S.tc = 1;
      S.timeSaved = 0;
      
      showNotification(`Created project: ${name}`);
      render();
    }
  } catch (err) {
    showNotification('Failed to create project: ' + err.message);
  }
}

async function confirmClearWorkspaceDisk() {
  if (!confirm("⚠️ DANGER: This will delete ALL files in your local sync folder on your E: drive. Continue?")) return;
  
  try {
    const res = await fetch('/api/clear-workspace-disk', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showNotification('Local folder wiped clean.');
    }
  } catch (err) {
    showNotification('Wipe failed: ' + err.message);
  }
}

/* ── Standard UI Logic ── */

function renderNavActive() {
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.view === S.view);
  });
}

function renderPolishBtn() {
  const btn = document.getElementById('polish-btn');
  if (!btn) return;
  if (canPolish()) {
    btn.classList.remove('hidden');
    const spin = document.getElementById('polish-spin');
    if (spin) spin.classList.toggle('hidden', !S.polishing);
    btn.disabled = S.polishing;
  } else {
    btn.classList.add('hidden');
  }
}

function renderStats() {
  const done    = S.tasks.filter(t => t.status === 'done').length;
  const inProg  = S.tasks.filter(t => t.status === 'in_progress').length;
  const live    = Object.values(S.live).reduce((a, b) => a + b, 0);
  const el = id => document.getElementById(id);
  if (el('stat-time-val')) el('stat-time-val').textContent = formatTimeSaved(S.timeSaved);
  if (el('stat-done-val')) el('stat-done-val').textContent = done;
  if (el('stat-prog-val')) el('stat-prog-val').textContent = inProg;
  if (el('stat-live-val')) el('stat-live-val').textContent = live;
}

function renderAgentList() {
  const el = document.getElementById('agent-list');
  if (!el) return;
  const agents = Object.keys(AGENT_META);
  el.innerHTML = `<h4>Agents</h4>` + agents.map(id => {
    const m    = AGENT_META[id];
    const live = S.live[id] || 0;
    return `<div class="agent-row">
      <span class="agent-dot${live > 0 ? ' live' : ''}"
            style="background:${m.color}"></span>
      <span class="agent-name">${m.icon} ${id}</span>
      ${live > 0 ? `<span class="agent-live-count">${live}</span>` : ''}
    </div>`;
  }).join('');
}

function renderAgentCfg() {
  const el = document.getElementById('agent-cfg');
  if (!el) return;
  const agents = Object.keys(AGENT_META).filter(id => id !== 'CEO');
  el.innerHTML = `<h4>Model Config</h4>` + agents.map(id => {
    const cfg = S.cfg[id];
    const opts = PROVIDERS.map(p =>
      `<option value="${p}"${cfg.provider === p ? ' selected' : ''}>${p}</option>`
    ).join('');
    return `<div class="agent-cfg-block">
      <label>${AGENT_META[id].icon} ${id}</label>
      <select onchange="S.cfg['${id}'].provider=this.value;saveToStorage()">${opts}</select>
      <input type="text" value="${cfg.model}"
             placeholder="model name"
             oninput="S.cfg['${id}'].model=this.value;saveToStorage()">
      <button class="btn-test" onclick="testAgent('${id}')">Test</button>
      <div class="agent-cfg-hint" id="hint-${id}"></div>
    </div>`;
  }).join('');
}

function renderTaskBoard() {
  const el = document.getElementById('task-board');
  if (!el) return;
  let tasks = S.tasks.slice();
  if (S.searchQ) {
    const q = S.searchQ.toLowerCase();
    tasks = tasks.filter(t => t.title.toLowerCase().includes(q) || t.instruction.toLowerCase().includes(q));
  }
  if (S.filter !== 'all') tasks = tasks.filter(t => t.status === S.filter);
  if (tasks.length === 0) {
    el.innerHTML = `<div class="empty-board"><div class="empty-icon">⊞</div><div>${S.tasks.length === 0 ? 'Enter a goal and click Start' : 'No tasks match filter'}</div></div>`;
    return;
  }
  el.innerHTML = tasks.map(renderTaskCard).join('');
}

function renderTaskCard(task) {
  const m      = AGENT_META[task.assignee] || AGENT_META.Writer;
  const status = task.status;
  const isLive = status === 'in_progress';
  return `<div class="task-card" onclick="openModal('${task.id}')">
    <div class="card-header">
      <span class="card-icon" style="color:${m.color}">${m.icon}</span>
      <span class="card-title">${_esc(task.title)}</span>
    </div>
    ${task.error ? `<div style="font-size:12px;color:var(--danger);margin-bottom:6px">${_esc(task.error)}</div>` : ''}
    <div class="card-meta">
      <span class="badge badge-${status}">${_statusLabel(status)}</span>
      <span class="card-assignee" style="color:${m.color}">${task.assignee}</span>
      <span class="card-date">${task.date}</span>
    </div>
    ${isLive ? `<div class="card-progress"><div class="card-progress-bar" style="width:60%"></div></div>` : ''}
    ${status === 'blocked' ? `<button class="btn-copy-sm" style="margin-top:8px" onclick="event.stopPropagation();retryTask('${task.id}')">⟳ Retry</button>` : ''}
  </div>`;
}

function renderRightPanel() {
  const el = document.getElementById('panel-body');
  if (!el) return;
  document.querySelectorAll('.panel-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === S.tab);
  });
  if (S.tab === 'logs') {
    el.innerHTML = S.logs.length === 0 ? '<div style="color:var(--muted);font-size:13px;padding:8px">No logs yet.</div>' : S.logs.map(l => `<div class="log-entry"><span class="log-ts">${l.ts}</span><span class="log-msg log-${l.type}">${_esc(l.msg)}</span></div>`).join('');
  } else {
    const done = getDoneTasks();
    el.innerHTML = done.length === 0 ? '<div style="color:var(--muted);font-size:13px;padding:8px">No completed outputs yet.</div>' : done.map(renderOutputItem).join('');
  }
}

function renderOutputItem(task) {
  return `<div class="output-item">
    <span class="output-item-title">${_esc(task.title_output || task.title)}</span>
    <button class="btn-copy-sm" onclick="copyTaskContent('${task.id}')">⧉ Copy</button>
  </div>`;
}

/* ── Markdown renderer ── */
function renderMarkdown(raw) {
  if (!raw) return '';
  let html = raw;
  const codeBlocks = [];
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const placeholder = `__CODEBLOCK_${codeBlocks.length}__`;
    codeBlocks.push(`<pre style="background:#1e1e2e;color:#e0e0ee;padding:16px;border-radius:8px;overflow-x:auto;font-family:monospace;font-size:13px;line-height:1.5"><code class="${lang}">${escaped}</code></pre>`);
    return placeholder;
  });
  html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  html = html.replace(/`([^`]+)`/g, '<code style="font-family:monospace;background:rgba(0,0,0,0.07);padding:2px 5px;border-radius:4px">$1</code>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/((?:\|.+\|\n?)+)/g, (block) => {
    const rows  = block.trim().split('\n').filter(r => r.trim());
    const isSep = r => /^\|[\s\-:|]+\|/.test(r);
    let table   = '<table style="border-collapse:collapse;width:100%;margin:12px 0">';
    let inHead  = true;
    for (const row of rows) {
      if (isSep(row)) { inHead = false; continue; }
      const tag   = inHead ? 'th' : 'td';
      const style = inHead ? 'border:1px solid #ddd;padding:8px 12px;background:#f5f5f5;font-weight:600;text-align:left' : 'border:1px solid #ddd;padding:8px 12px;text-align:left';
      const cells = row.split('|').filter(c => c.trim() !== '');
      table += `<tr>${cells.map(c => `<${tag} style="${style}">${c.trim()}</${tag}>`).join('')}</tr>`;
    }
    return table + '</table>';
  });
  html = html.replace(/^### (.+)$/gm, '<h3 style="font-size:16px;font-weight:600;margin:16px 0 8px">$1</h3>');
  html = html.replace(/^## (.+)$/gm,  '<h2 style="font-size:20px;font-weight:700;margin:20px 0 10px">$1</h2>');
  html = html.replace(/^# (.+)$/gm,   '<h1 style="font-size:24px;font-weight:700;margin:24px 0 12px">$1</h1>');
  html = html.replace(/^\- (.+)$/gm, '<li style="margin:4px 0">$1</li>');
  html = html.replace(/(<li[^>]*>.*<\/li>\n?)+/g, m => `<ul style="margin:8px 0;padding-left:24px">${m}</ul>`);
  html = html.replace(/^\d+\. (.+)$/gm, '<li style="margin:4px 0">$1</li>');
  html = html.replace(/(<li[^>]*>.*<\/li>\n?)+/g, m => m.includes('<ul') ? m : `<ol style="margin:8px 0;padding-left:24px">${m}</ol>`);
  html = html.replace(/\n{2,}/g, '</p><p style="margin:8px 0">');
  html = `<p style="margin:8px 0">${html}</p>`;
  html = html.replace(/\n/g, '<br>');
  codeBlocks.forEach((block, i) => { html = html.replace(`__CODEBLOCK_${i}__`, block); });
  return html;
}

function renderModalOutput(task) {
  const markdownHtml = renderMarkdown(task.content);
  if (task.deliverable_type === 'code' && task.content && (task.content.includes('<!DOCTYPE html>') || task.content.includes('<html>'))) {
    const blob = new Blob([task.content], { type: 'text/html' });
    const url  = URL.createObjectURL(blob);
    return `<div class="modal-markdown">${markdownHtml}</div><div class="modal-preview"><h4>Live Preview</h4><iframe src="${url}" sandbox="allow-same-origin allow-scripts" style="width:100%;height:400px;border:1px solid #ddd;border-radius:8px;margin-top:8px;"></iframe></div>`;
  }
  return `<div class="modal-markdown">${markdownHtml}</div>`;
}

function openModal(taskId) {
  const task = S.tasks.find(t => t.id === taskId);
  if (!task) return;
  S.selTask = taskId;
  document.getElementById('modal-title').textContent       = task.title_output || task.title;
  document.getElementById('modal-instruction').textContent = task.instruction || '';
  document.getElementById('modal-content').innerHTML       = task.content ? renderModalOutput(task) : '<p style="color:var(--muted)">No output yet.</p>';
  document.getElementById('outputModal').classList.remove('hidden');
}

function closeModal() {
  document.querySelectorAll('.modal-preview iframe').forEach(iframe => {
    if (iframe.src && iframe.src.startsWith('blob:')) URL.revokeObjectURL(iframe.src);
  });
  document.getElementById('outputModal').classList.add('hidden');
  S.selTask = null;
}

function handleModalClick(e) { if (e.target.id === 'outputModal') closeModal(); }
function copyModalContent() { const task = S.tasks.find(t => t.id === S.selTask); if (!task || !task.content) return; navigator.clipboard.writeText(task.content).then(() => showNotification('Copied to clipboard')); }
function downloadModalContent() { const task = S.tasks.find(t => t.id === S.selTask); if (!task || !task.content) return; const blob = new Blob([task.content], { type: 'text/markdown' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${(task.title_output || task.title).replace(/\s+/g, '_')}.md`; a.click(); URL.revokeObjectURL(url); }
function copyTaskContent(taskId) { const task = S.tasks.find(t => t.id === taskId); if (!task || !task.content) return; navigator.clipboard.writeText(task.content).then(() => showNotification('Copied')); }

/* ── Final Sync to Disk with Extension Fix ── */

async function syncToDisk() {
  const doneTasks = S.tasks.filter(t => t.status === 'done' && t.content);
  if (!doneTasks.length) { showNotification('No completed tasks to sync.'); return; }

  const files = [];
  
  // NEW ULTRA-FORGIVING REGEX: Finds "### File: name" even with spaces, quotes, or weird paths
  const fileHeaderRe = /###\s*File:\s*["']?([\w./\-\\]+)["']?/gi;

  for (const task of doneTasks) {
    const content = task.content || '';
    let match;
    
    // We search the task content for file markers
    while ((match = fileHeaderRe.exec(content)) !== null) {
      const filename = match[1].trim();
      const searchStartIndex = match.index + match[0].length;
      
      // Find the NEXT code block after this specific filename marker
      const remainingContent = content.slice(searchStartIndex);
      const codeBlockMatch = remainingContent.match(/```(?:\w*)\n([\s\S]*?)```/);
      
      if (codeBlockMatch) {
        const rawCode = codeBlockMatch[1].trim();
        // Remove the [EOF] marker if it exists
        const cleanCode = rawCode.replace(/\[EOF\]\s*$/, '').trim();
        
        files.push({ filename, content: cleanCode });
      }
    }
  }

  if (files.length === 0) {
    console.warn("Sync: No files found matching the protocol. Checking for raw code...");
    // Fallback: If no protocol found, but task is 'code', save it anyway
    for (const task of doneTasks) {
        if (task.deliverable_type === 'code' && !content.includes('### File:')) {
             files.push({ filename: `fallback/${task.id}.txt`, content: task.content });
        }
    }
  }

  if (files.length === 0) { showNotification('Error: No code blocks found in "Done" tasks.'); return; }

  try {
    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files, workspace_id: S.currentWorkspaceId })
    });
    const data = await res.json();
    if (data.success) {
      showNotification(`🚀 Sync complete: ${data.filesWritten?.length || 0} files saved to disk.`);
    }
  } catch (err) {
    showNotification(`Sync failed: ${err.message}`);
  }
}

function downloadZip() { const payload = { tasks: S.tasks, time_saved: S.timeSaved, cfg: S.cfg, keys: S.keys }; const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'agentos_export.json'; a.click(); URL.revokeObjectURL(url); showNotification('Download ready (JSON).'); }

/* ── Settings ── */
function openSettings() {
  const el = id => document.getElementById(id);
  el('key-deepseek').value   = S.keys.deepseek   || '';
  el('key-gemini').value     = S.keys.gemini      || '';
  el('key-openrouter').value = S.keys.openrouter  || '';
  el('key-groq').value       = S.keys.groq        || '';
  el('key-cloudflare').value = S.keys.cloudflare  || '';
  el('key-cfAcct').value     = S.keys.cfAcct      || '';
  
  // Set the current workspace path in settings
  fetch('/api/load').then(r => r.json()).then(data => {
      // In local mode, the workspace path is managed by server.js globally
  });

  document.getElementById('settingsModal').classList.remove('hidden');
}

function closeSettings() { document.getElementById('settingsModal').classList.add('hidden'); }

function saveSettings() {
  const el = id => document.getElementById(id).value.trim();
  S.keys.deepseek   = el('key-deepseek');
  S.keys.gemini     = el('key-gemini');
  S.keys.openrouter = el('key-openrouter');
  S.keys.groq       = el('key-groq');
  S.keys.cloudflare = el('key-cloudflare');
  S.keys.cfAcct     = el('key-cfAcct');

  const workspacePath = el('sync-path-input');
  if (workspacePath) {
    fetch('/api/set-workspace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: workspacePath })
    }).catch(err => console.error('Path update failed:', err));
  }

  saveToStorage();
  closeSettings();
  showNotification('Settings saved');
}

function handleSettingsClick(e) { if (e.target.id === 'settingsModal') closeSettings(); }

function setView(v) { S.view = v; render(); }
function setFilter(f) { S.filter = f; document.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === f)); renderTaskBoard(); }
function setPanelTab(t) { S.tab = t; renderRightPanel(); }
function onSearch(q) { S.searchQ = q; renderTaskBoard(); }

function handleStart() {
  const goal = document.getElementById('goal-input').value.trim();
  if (!goal) { showNotification('Enter a goal first.'); return; }
  if (S.running) { showNotification('Already running.'); return; }
  // runCEO is in engine.js
  runCEO(goal);
}

async function testAgent(agentId) {
  const hint = document.getElementById(`hint-${agentId}`);
  if (hint) hint.textContent = 'Testing…';
  const provider = S.cfg[agentId].provider;
  if (!S.keys[provider]) { hint.textContent = `No ${provider} key.`; return; }
  // callFO is in core.js
  const result = await callFO(agentId, 'say hello', null, 50);
  if (hint) hint.textContent = result ? '✓ OK' : '✗ Failed';
}

function _esc(str) { if (!str) return ''; return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function _statusLabel(s) { return { todo:'Todo', waiting:'Waiting', in_progress:'In Progress', done:'Done', blocked:'Blocked' }[s] || s; }