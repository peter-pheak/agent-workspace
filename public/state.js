const TIME_CREDIT = 5;

const DEF_CFG = {
  Planner:      { provider: 'deepseek', model: 'deepseek-reasoner'     },
  Organizer:    { provider: 'deepseek', model: 'deepseek-chat'     },
  Analyzer:     { provider: 'gemini',   model: 'gemini-2.5-flash'  },
  PromptEngineer: { provider: 'deepseek', model: 'deepseek-chat'     }
};

const AGENT_MAX_TOKENS = {
  Planner: 3000, Organizer: 4000, Analyzer: 4000, PromptEngineer: 8000
};

const AGENT_META = {
  Planner:      { icon: '⬡',   color: '#0d9488', bg: '#ccfbf1', label: 'Planner'      },
  Organizer:    { icon: '✍',   color: '#7c3aed', bg: '#ede9fe', label: 'Organizer'    },
  Analyzer:     { icon: '🔬',  color: '#059669', bg: '#d1fae5', label: 'Analyzer'     },
  PromptEngineer: { icon: '★',   color: '#d97706', bg: '#fef3c7', label: 'Prompt Engineer'   }
};

// Remove code-related deliverable types
const TIME_CREDITS = {
  document: 25,
  analysis: 20,
  mixed:    45
};

const PROVIDERS = ['deepseek', 'gemini', 'openrouter'];

const FALLBACK_CHAIN = ['deepseek', 'gemini', 'openrouter'];

const S = {
  currentWorkspaceId: 1,  // NEW: Tracks the active project
  workspaces: [],         // NEW: Holds the list of available projects
  tasks:      [],
  logs:       [],
  running:    false,
  polishing:  false,
  tc:         1,
  view:       'board',
  tab:        'logs',
  filter:     'all',
  selTask:    null,
  searchQ:    '',
  taskType:   'auto',
  keys:       { deepseek: '', gemini: '', openrouter: '' },
  cfg:        JSON.parse(JSON.stringify(DEF_CFG)),
  stats:      { deepseek: 0, gemini: 0, openrouter: 0 },
  live:       { Planner: 0, Organizer: 0, Analyzer: 0, PromptEngineer: 0 },
  failResolve: null,
  runStart:   null,
  timeSaved:  0
};

/* ── Derived getters ── */
function getDoneTasks() {
  return S.tasks.filter(t => t.status === 'done' && t.content);
}

function canPolish() {
  return (
    !S.running &&
    !S.polishing &&
    S.tasks.length > 0 &&
    S.tasks.some(t => t.status === 'done') &&
    !S.tasks.some(t => t.assignee === 'PromptEngineer')
  );
}

/* ── Mutators ── */
function setLive(agentId, delta) {
  S.live[agentId] = Math.max(0, (S.live[agentId] || 0) + delta);
  render();
}

function persistTask(task) {
  if (!task?.id) return;
  
  // Inject the workspace_id into the payload before saving to DB
  const payload = {
    ...task,
    workspace_id: S.currentWorkspaceId,
    depends_on: Array.isArray(task.depends_on) ? task.depends_on : []
  };

  fetch('/api/save-task', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).catch(() => { /* best-effort */ });
}

function updateTask(id, patch) {
  const t = S.tasks.find(x => x.id === id);
  if (t) {
    Object.assign(t, patch);
    saveToStorage();
    persistTask(t); // persistTask now handles the workspace_id injection
  }
}

function addLog(msg, type = 'info') {
  S.logs.unshift({ msg, type, ts: new Date().toLocaleTimeString() });
  if (S.logs.length > 100) S.logs.pop();
}

/* ── Time saved ── */
function addTimeSaved(deliverable_type) {
  const mins = TIME_CREDITS[deliverable_type] || TIME_CREDIT;
  S.timeSaved += mins;
  saveToStorage();
}

function formatTimeSaved(mins) {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/* ── Task factory ── */
function mkTask(overrides) {
  const id = `LOC-${String(S.tc++).padStart(2, '0')}`;
  return Object.assign({
    id,
    workspace_id:     S.currentWorkspaceId, // Attach current project ID
    title:            'Untitled',
    instruction:      '',
    assignee:         'Organizer',
    status:           'todo',
    depends_on:       [],
    deliverable_type: 'document',
    content:          null,
    title_output:     null,
    error:            null,
    date:             new Date().toLocaleDateString()
  }, overrides);
}