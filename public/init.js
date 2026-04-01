function saveToStorage() {
  localStorage.setItem('agentos_tasks',     JSON.stringify(S.tasks));
  localStorage.setItem('agentos_keys',      JSON.stringify(S.keys));
  localStorage.setItem('agentos_cfg',       JSON.stringify(S.cfg));
  localStorage.setItem('agentos_timeSaved', JSON.stringify(S.timeSaved));
}

function loadFromStorage() {
  try {
    const tasks = localStorage.getItem('agentos_tasks');
    const keys  = localStorage.getItem('agentos_keys');
    const cfg   = localStorage.getItem('agentos_cfg');
    const saved = localStorage.getItem('agentos_timeSaved');
    if (tasks) S.tasks     = JSON.parse(tasks);
    if (keys)  S.keys      = { ...S.keys,  ...JSON.parse(keys) };
    if (cfg)   S.cfg       = { ...S.cfg,   ...JSON.parse(cfg) };
    if (saved) S.timeSaved = JSON.parse(saved);
    /* Reset in_progress → blocked on load */
    S.tasks.forEach(t => { if (t.status === 'in_progress') t.status = 'blocked'; });
  } catch(e) { /* ignore */ }
}

document.addEventListener('DOMContentLoaded', () => {
  loadFromStorage();
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
