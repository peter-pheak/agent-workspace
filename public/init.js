function saveToStorage() {
  localStorage.setItem('agentos_tasks',     JSON.stringify(S.tasks));
  localStorage.setItem('agentos_keys',      JSON.stringify(S.keys));
  localStorage.setItem('agentos_cfg',       JSON.stringify(S.cfg));
  localStorage.setItem('agentos_timeSaved', JSON.stringify(S.timeSaved));

  fetch('/api/save-profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      time_saved: S.timeSaved,
      agent_configs: S.cfg
    })
  }).catch(() => { /* best-effort local sync */ });
}

async function loadFromSQLite() {
  try {
    const tasks = localStorage.getItem('agentos_tasks');
    const keys  = localStorage.getItem('agentos_keys');
    const cfg   = localStorage.getItem('agentos_cfg');

    if (tasks) S.tasks = JSON.parse(tasks);
    if (keys)  S.keys  = { ...S.keys, ...JSON.parse(keys) };
    if (cfg)   S.cfg   = { ...S.cfg,  ...JSON.parse(cfg) };

    const resp = await fetch('/api/load');
    if (!resp.ok) throw new Error('Failed to load from /api/load');
    const data = await resp.json();

    if (data.success) {
      if (Array.isArray(data.tasks)) S.tasks = data.tasks;
      if (data.profile?.time_saved !== undefined) S.timeSaved = data.profile.time_saved;
      if (data.profile?.agent_configs) S.cfg = { ...S.cfg, ...data.profile.agent_configs };
    }

    S.tasks.forEach(t => { if (t.status === 'in_progress') t.status = 'blocked'; });
  } catch(e) {
    console.warn('loadFromSQLite failed:', e?.message || e);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadFromSQLite();
  render();

  /* Sync task-type radios with restored state */
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
      closeModal();
      closeSettings();
    }
  });

  /* CEO cfg — wire provider/model in sidebar directly from DEF_CFG defaults */
  /* (renderAgentCfg skips CEO row by design; CEO config lives in state only) */
});
