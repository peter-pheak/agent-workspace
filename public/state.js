const TIME_CREDIT = 5;

const DEF_CFG = {
  CEO:        { provider: 'deepseek', model: 'deepseek-chat'     },
  Writer:     { provider: 'deepseek', model: 'deepseek-chat'     },
  Coder:      { provider: 'deepseek', model: 'deepseek-chat'     },
  Researcher: { provider: 'gemini',   model: 'gemini-2.0-flash'  },
  Reviewer:   { provider: 'deepseek', model: 'deepseek-chat'     }
};

const AGENT_MAX_TOKENS = {
  CEO: 3000, Writer: 4000, Coder: 4000, Researcher: 4000, Reviewer: 8000
};

const AGENT_META = {
  CEO:        { icon: '⬡',   color: '#0d9488', bg: '#ccfbf1', label: 'CEO'        },
  Writer:     { icon: '✍',   color: '#7c3aed', bg: '#ede9fe', label: 'Writer'     },
  Coder:      { icon: '⟨/⟩', color: '#2563eb', bg: '#dbeafe', label: 'Coder'      },
  Researcher: { icon: '🔬',  color: '#059669', bg: '#d1fae5', label: 'Researcher' },
  Reviewer:   { icon: '★',   color: '#d97706', bg: '#fef3c7', label: 'Reviewer'   }
};

const TIME_CREDITS = {
  document: 25,
  code:     35,
  analysis: 20,
  mixed:    45
};

const PROVIDERS = ['deepseek', 'gemini', 'openrouter', 'groq', 'cloudflare'];

const FALLBACK_CHAIN = ['deepseek', 'gemini', 'groq', 'openrouter', 'cloudflare'];

const S = {
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
  keys:       { deepseek: '', gemini: '', cloudflare: '', cfAcct: '', openrouter: '', groq: '' },
  cfg:        JSON.parse(JSON.stringify(DEF_CFG)),
  stats:      { deepseek: 0, gemini: 0, cloudflare: 0, openrouter: 0, groq: 0 },
  live:       { CEO: 0, Writer: 0, Coder: 0, Researcher: 0, Reviewer: 0 },
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
    !S.tasks.some(t => t.assignee === 'Reviewer')
  );
}

/* ── Mutators ── */
function setLive(agentId, delta) {
  S.live[agentId] = Math.max(0, (S.live[agentId] || 0) + delta);
  render();
}

function persistTask(task) {
  if (!task?.id) return;
  fetch('/api/save-task', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(task)
  }).catch(() => { /* best-effort */ });
}

function updateTask(id, patch) {
  const t = S.tasks.find(x => x.id === id);
  if (t) {
    Object.assign(t, patch);
    saveToStorage();
    persistTask({
      ...t,
      depends_on: Array.isArray(t.depends_on) ? t.depends_on : [],
    });
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
    title:            'Untitled',
    instruction:      '',
    assignee:         'Writer',
    status:           'todo',
    depends_on:       [],
    deliverable_type: 'document',
    content:          null,
    title_output:     null,
    error:            null,
    date:             new Date().toLocaleDateString()
  }, overrides);
}
