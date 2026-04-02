let activeExecutors = 0;
const MAX_CONCURRENT = 2;
// RULE: increment activeExecutors SYNCHRONOUSLY in evaluateTaskQueue before calling runExecutor
// RULE: decrement in the finally{} block of runExecutor
// RULE: do NOT use a while-loop — evaluateTaskQueue handles dispatch

async function yieldToUI() {
  // Keep the UI thread responsive during tight queue checks
  return new Promise(resolve => setTimeout(resolve, 0));
}

async function evaluateTaskQueue() {
  // S.running guards CEO phase only — do NOT gate on it here
  let stateChanged = false;                                    // FIX 1
  let evalLoopCount = 0;
  const THROTTLE_BATCH = 8;

  const tasksToCheck = S.tasks.filter(t =>
    t.status === 'todo' || t.status === 'waiting' || t.status === 'blocked'
  );

  for (const task of tasksToCheck) {
    const deps = task.depends_on || [];
    const depTasks = deps.map(id => S.tasks.find(t => t.id === id)).filter(Boolean);
    const unknownDeps = deps.filter(id => !depTasks.some(d => d.id === id));

    if (unknownDeps.length > 0) {
      if (task.status !== 'blocked') {
        updateTask(task.id, {
          status: 'blocked',
          error: `Unknown dependency IDs: ${unknownDeps.join(', ')} (task may be malformed)`
        });
        stateChanged = true;
      }
      continue;
    }

    if (deps.length === 0) {
      if (task.status !== 'todo') {
        updateTask(task.id, { status: 'todo' });
        stateChanged = true;
      }
      if (activeExecutors < MAX_CONCURRENT) {
        activeExecutors++;
        updateTask(task.id, { status: 'in_progress' });
        runExecutor(task);  // fire-and-forget, decrement handled in finally
      }
      continue;
    }

    const anyBlocked = depTasks.some(d => d.status === 'blocked');
    const allDone    = depTasks.every(d => d.status === 'done');

    if (anyBlocked) {
      if (task.status !== 'blocked') {
        updateTask(task.id, { status: 'blocked', error: 'Upstream task failed.' });
        stateChanged = true;
      }
    } else if (allDone) {
      if (activeExecutors < MAX_CONCURRENT) {
        activeExecutors++;
        updateTask(task.id, { status: 'in_progress' });
        runExecutor(task);
      } else {
        if (task.status !== 'waiting') {
          updateTask(task.id, { status: 'waiting' });
          stateChanged = true;
        }
      }
    } else {
      if (task.status !== 'waiting') {
        updateTask(task.id, { status: 'waiting' });
        stateChanged = true;
      }
    }

    evalLoopCount++;
    if (evalLoopCount % THROTTLE_BATCH === 0) {
      await yieldToUI();
    }
  }

  if (stateChanged) evaluateTaskQueue();                       // FIX 1 — recursive re-run
  render();
}

async function runExecutor(task) {
  const agentId   = task.assignee;
  const maxTokens = AGENT_MAX_TOKENS[agentId] || 4000;
  setLive(agentId, +1);
  addLog(`${agentId} started: ${task.title}`, 'info');
  render();

  try {
    const userMessage = buildUserMessage(task);
    let raw = await callFO(agentId, userMessage, task, maxTokens);

    // Truncation retry at 1.5x tokens
    if (raw && raw.length > 0) {
      const lastChars = raw.slice(-80);
      const lookscut  = !lastChars.match(/[.!?\n`]$/) && raw.length > maxTokens * 3;
      if (lookscut) {
        addLog(`${agentId}: response may be cut off, retrying at 1.5x tokens`, 'warn');
        raw = await callFO(agentId, userMessage, task, Math.floor(maxTokens * 1.5));
      }
    }

    if (!raw) {
      // Automatic fallback cycle for transient “no content” situations
      let fallbackProvider = _nextFallback(S.cfg[agentId].provider);
      const originalProvider = S.cfg[agentId].provider;
      while (!raw && fallbackProvider) {
        addLog(`${agentId}: no content - trying fallback provider ${fallbackProvider}`, 'warn');
        S.cfg[agentId].provider = fallbackProvider;
        raw = await callFO(agentId, userMessage, task, maxTokens);
        S.cfg[agentId].provider = originalProvider;

        if (raw) break;
        fallbackProvider = _nextFallback(fallbackProvider);
      }

      if (!raw) {
        const action = await new Promise(resolve => {
          S.failResolve = resolve;
          showFailModal(task, `${agentId} returned no content.`);
        });

        if (action === 'retry') {
          const fallbackProvider = _nextFallback(S.cfg[agentId].provider);
          if (fallbackProvider) {
            const savedProvider = S.cfg[agentId].provider;
            S.cfg[agentId].provider = fallbackProvider;
            raw = await callFO(agentId, userMessage, task, maxTokens);
            S.cfg[agentId].provider = savedProvider;
          }
        }
      }

      if (!raw) {
        updateTask(task.id, { status: 'blocked', error: `${agentId} returned no content.` });
        addLog(`${task.title} blocked — no content`, 'error');
        return;
      }
    }

    const result = extractDeliverable(raw);
    if (!result) {
      updateTask(task.id, {
        status: 'blocked',
        error: 'Agent returned unstructured output. Try deepseek-chat.'
      });
      addLog(`${task.title}: parse failed`, 'error');
      return;
    }

    updateTask(task.id, {
      status:       'done',
      content:      result.content,
      title_output: result.title,
      error:        null
    });
    addTimeSaved(task.deliverable_type);
    addLog(`${task.title} done`, 'success');

  } catch (err) {
    updateTask(task.id, { status: 'blocked', error: err.message });
    addLog(`${task.title} error: ${err.message}`, 'error');
  } finally {
    activeExecutors = Math.max(0, activeExecutors - 1);
    setLive(agentId, -1);
    render();
    // Re-evaluate — picks up waiting tasks now that a slot is free
    evaluateTaskQueue();
  }
}

async function runCEO(goal) {
  if (S.running) return;
  S.running  = true;
  S.runStart = Date.now();
  S.tasks    = [];
  S.tc       = 1;
  saveToStorage();
  render();

  const agentId   = 'CEO';
  const maxTokens = AGENT_MAX_TOKENS.CEO;
  setLive(agentId, +1);
  addLog(`CEO planning: ${goal.slice(0, 60)}…`, 'info');

  try {
    const userMessage = buildCEOMessage(goal, S.taskType);
    const raw         = await callFO(agentId, userMessage, null, maxTokens);

    if (!raw) {
      addLog('CEO returned no response', 'error');
      showNotification('CEO returned no response. Check API key.');
      return;
    }

    const parsed = extractJSON(raw);
    if (!parsed || !Array.isArray(parsed.tasks)) {
      addLog('CEO: failed to parse task list', 'error');
      showNotification('Agent returned unstructured output. Try deepseek-chat.');
      return;
    }

    addLog(`CEO: ${parsed.message || `${parsed.tasks.length} tasks created`}`, 'success');

    // Build tasks; collect title→id map for depends_on resolution
    const titleToId = {};
    parsed.tasks.forEach((t, i) => {
      const task = mkTask({
        title:            t.title,
        instruction:      t.instruction,
        assignee:         t.assignee,
        deliverable_type: t.deliverable_type || 'document',
        depends_on:       []
      });
      S.tasks.push(task);
      titleToId[t.title] = task.id;
      titleToId[i]       = task.id;
    });

    // Second pass: wire depends_on now that all ids exist
    parsed.tasks.forEach((t, i) => {
      const deps = (t.depends_on || []).map(ref => {
        if (typeof ref === 'number') return titleToId[ref];
        if (typeof ref === 'string') return titleToId[ref] || ref;
        return null;
      }).filter(Boolean);
      S.tasks[i].depends_on = deps;
    });

    saveToStorage();

    // KEY FIX: clear S.running BEFORE evaluateTaskQueue so it can dispatch executors.
    // evaluateTaskQueue no longer gates on S.running, but runCEO guard still needs reset.
    S.running = false;
    setLive(agentId, -1);
    render();
    await evaluateTaskQueue();
    return; // early return — skip finally cleanup (already done above)

  } catch (err) {
    addLog(`CEO error: ${err.message}`, 'error');
    showNotification(`CEO error: ${err.message}`);
  } finally {
    // Only runs on error path — the happy path returned early above
    if (S.running) {
      S.running = false;
      setLive(agentId, -1);
      render();
    }
  }
}

function buildUserMessage(task) {
  if (!task || !task.instruction) return '';

  return `Task: ${task.title || 'Untitled'}\n` +
         `Assignee: ${task.assignee || 'Writer'}\n` +
         `Deliverable Type: ${task.deliverable_type || 'document'}\n\n` +
         `${task.instruction.trim()}`;
}

function buildCEOMessage(goal, taskType = 'auto') {
  if (!goal) return '';

  return `You are the CEO agent in AgentOS. Create a structured execution plan for this goal.\n\n` +
         `Goal: ${goal.trim()}\n` +
         `Task type: ${taskType}\n\n` +
         `Output format: JSON with keys { message, tasks }.\n` +
         `tasks must be an array of objects with: title, instruction, assignee, deliverable_type, depends_on.\n` +
         `Use assignees from [Writer, Coder, Researcher, Reviewer].\n` +
         `Use depends_on by task title or id references.\n` +
         `No plain text list; return valid JSON only.`;
}

function retryTask(taskId) {
  function resetDownstream(id) {
    const t = S.tasks.find(x => x.id === id);
    if (t) updateTask(t.id, { status: 'todo', error: null });
    S.tasks
      .filter(child => (child.depends_on || []).includes(id))
      .forEach(child => resetDownstream(child.id));
  }
  resetDownstream(taskId);
  render();
  evaluateTaskQueue();
}

async function polishAndCombine() {
  if (S.polishing || S.running) return;
  S.polishing = true;
  render();
  const doneTasks  = S.tasks.filter(t => t.status === 'done' && t.content);
  const reviewTask = mkTask({
    title:            'Combined Final Output',
    instruction:      'Combine all outputs into one polished final document.',
    assignee:         'Reviewer',
    status:           'todo',
    depends_on:       doneTasks.map(t => t.id),
    deliverable_type: 'mixed'
  });
  S.tasks.push(reviewTask);
  saveToStorage();
  render();
  await evaluateTaskQueue();
  S.polishing = false;
  render();
}

function showFailModal(task, errMsg) {
  const modal = document.getElementById('failModal');
  const msg   = document.getElementById('fail-msg');
  if (msg)   msg.textContent = errMsg || 'Task failed with no error message.';
  if (modal) modal.classList.remove('hidden');
}

function resolveFailure(action) {
  document.getElementById('failModal').classList.add('hidden');
  if (S.failResolve) {
    const fn = S.failResolve;
    S.failResolve = null;
    fn(action);
  }
}

function _nextFallback(currentProvider) {
  const idx = FALLBACK_CHAIN.indexOf(currentProvider);
  if (idx === -1 || idx === FALLBACK_CHAIN.length - 1) return null;
  for (let i = idx + 1; i < FALLBACK_CHAIN.length; i++) {
    const p = FALLBACK_CHAIN[i];
    if (S.keys[p]) return p;
  }
  return null;
}
