/* ── Persistence ── */

function saveToStorage() {
  // Local backups for UI state and keys
  localStorage.setItem('agentos_keys',      JSON.stringify(S.keys));
  localStorage.setItem('agentos_cfg',       JSON.stringify(S.cfg));
  localStorage.setItem('agentos_workspace', JSON.stringify(S.currentWorkspaceId));

  // Sync Profile to SQLite (Time saved & global agent configs)
  fetch('/api/save-profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      time_saved: S.timeSaved,
      agent_configs: S.cfg
    })
  }).catch(err => console.warn('Profile sync failed:', err));
}

async function loadWorkspaces() {
  try {
    const res = await fetch('/api/workspaces');
    const data = await res.json();
    if (data.success) {
      S.workspaces = data.workspaces;
      // If we saved a last-used workspace in localStorage, restore it
      const savedWs = localStorage.getItem('agentos_workspace');
      if (savedWs) S.currentWorkspaceId = parseInt(savedWs);
    }
  } catch (e) {
    console.error('Failed to load workspaces:', e);
  }
}

async function loadFromSQLite(workspaceId = null) {
  const idToLoad = workspaceId || S.currentWorkspaceId || 1;
  
  try {
    // 1. Restore local keys
    const keys = localStorage.getItem('agentos_keys');
    if (keys) S.keys = { ...S.keys, ...JSON.parse(keys) };

    // 2. Fetch specific workspace data from server
    const resp = await fetch(`/api/load?workspace_id=${idToLoad}`);
    if (!resp.ok) throw new Error('Failed to load from /api/load');
    const data = await resp.json();

    if (data.success) {
      S.currentWorkspaceId = idToLoad;
      
      // Load tasks for this workspace
      if (Array.isArray(data.tasks)) {
        S.tasks = data.tasks;
      } else {
        S.tasks = [];
      }

      // Load global profile settings
      if (data.profile?.time_saved !== undefined) S.timeSaved = data.profile.time_saved;
      if (data.profile?.agent_configs) S.cfg = { ...S.cfg, ...data.profile.agent_configs };
    }

    // 3. Cleanup: Any task left in "in_progress" was interrupted by a crash/close
    S.tasks.forEach(t => { 
      if (t.status === 'in_progress') t.status = 'blocked'; 
    });

    // 4. Recalculate Task Counter (S.tc) based on highest ID in this workspace
    const maxNum = S.tasks.reduce((max, t) => {
      const match = t.id.match(/\d+/);
      const num = match ? parseInt(match[0], 10) : 0;
      return Math.max(max, num);
    }, 0);
    S.tc = maxNum + 1;

    console.log(`Workspace ${idToLoad} loaded. Tasks: ${S.tasks.length}, Counter: ${S.tc}`);

  } catch(e) {
    console.warn('loadFromSQLite failed:', e?.message || e);
  }
}

/* ── Entry Point ── */

document.addEventListener('DOMContentLoaded', async () => {
  // First load the list of projects
  await loadWorkspaces();
  
  // Then load the tasks for the active project
  await loadFromSQLite();
  
  // Initial render of the entire UI
  render();

  /* Sync UI Task-Type radios with restored state */
  const radio = document.querySelector(`input[name="taskType"][value="${S.taskType}"]`);
  if (radio) radio.checked = true;

  /* Goal textarea — Enter without Shift triggers start */
  const goalInput = document.getElementById('goal-input');
  if (goalInput) {
    goalInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleStart();
      }
    });
  }

  /* Global keyboard shortcuts */
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      // Logic handled in ui.js
      if (typeof closeOutputModal === 'function') closeOutputModal();
      if (typeof closeSettings === 'function') closeSettings();
    }
  });

  console.log('AgentOS v4.5 (Research Edition) Initialized');
});