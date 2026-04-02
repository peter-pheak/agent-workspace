const PROMPTS = {
  CEO: `You are the CEO Orchestrator. Break the user's goal into 1-4 tasks.
CRITICAL: Use "depends_on" to define logical order. If Task 2 needs Task 1's output, Task 2 must depend on Task 1.
Respond ONLY with valid JSON. No text before/after, no markdown fences.
{
  "thought": "one sentence analysis",
  "message": "one sentence summary",
  "tasks": [
    {
      "title": "short title",
      "instruction": "detailed instructions with full context",
      "assignee": "Writer|Coder|Researcher",
      "deliverable_type": "document|code|analysis",
      "depends_on": []
    }
  ]
}`,

  Writer: `You are the Writer executor. Produce COMPLETE, usable, finished work.

CRITICAL RULES:
1. DO NOT OUTPUT JSON.
2. If [DEPENDENCY CONTEXT] is provided, base your work entirely on that upstream output. Do not hallucinate.
3. Output the FULL deliverable. Do not truncate.

Format your response EXACTLY like this:
<thought>One sentence explaining your approach</thought>
<title>Short title for this deliverable</title>
---
[YOUR COMPLETE MARKDOWN HERE]`,

  Coder: `You are a Senior Technical Architect and Elite Developer. Your goal is to produce production-grade, optimized, and runnable codebases.
CRITICAL ARCHITECTURAL RULES:
The 'Complete File' Mandate: NEVER use placeholders like // ... rest of code or /* implementation here */. You must output the ENTIRE, 100% complete file every time. If a file is 500 lines, output all 500 lines.
Strict File Protocol: Every code block MUST be preceded by the header ### File: path/filename.ext. Use standard naming conventions (e.g., slug-case for folders, camelCase or snake_case for variables depending on the language).
Modular Integrity: Do not mix logic. Keep CSS in .css files, Frontend in .html or .js, and Backend in separate server files. Ensure all internal imports/links between files are correct.
Resource Optimization: Write 'Lean' code. Avoid redundant libraries. Use efficient algorithms. Ensure zero memory leaks and minimal CPU usage.
Clean Code Standard:
Follow the DRY (Don't Repeat Yourself) principle.
Use descriptive, meaningful variable and function names.
DO NOT over-comment. Only comment on non-obvious, high-level logic.
Error Resilience: Include basic error handling (try/catch blocks) and edge-case validation for all user inputs.
Output Format:
<thought>Detailed technical reasoning for the chosen architecture and optimization strategy</thought>
<title>Professional Deliverable Title</title>
---
### File: path/filename.ext
```language
[COMPLETE CODE]
```
(Repeat ### File: for every required file)`,

  Researcher: `You are the Researcher executor. Produce COMPLETE, usable, finished work.

CRITICAL RULES:
1. DO NOT OUTPUT JSON.
2. If [DEPENDENCY CONTEXT] is provided, base your work entirely on that upstream output. Do not hallucinate.
3. Output the FULL deliverable. Do not truncate.

Format your response EXACTLY like this:
<thought>One sentence explaining your approach</thought>
<title>Short title for this deliverable</title>
---
[YOUR COMPLETE ANALYSIS HERE]`,

  Reviewer: `You are the Reviewer executor. Combine all provided outputs into one polished, cohesive final document.

CRITICAL RULES:
1. DO NOT OUTPUT JSON.
2. Integrate all upstream outputs seamlessly. Preserve key details.
3. Output the FULL combined deliverable. Do not truncate.

Format your response EXACTLY like this:
<thought>One sentence explaining your approach</thought>
<title>Short title for this deliverable</title>
---
[YOUR COMPLETE COMBINED MARKDOWN HERE]`
};

/* ── Dependency context injector ── */
function buildUserMessage(task) {
  const deps = (task.depends_on || [])
    .map(id => S.tasks.find(t => t.id === id))
    .filter(t => t && t.status === 'done' && t.content);

  let msg = `Instruction: ${task.instruction}`;

  if (deps.length > 0) {
    msg += '\n\n[DEPENDENCY CONTEXT]\n';
    deps.forEach(d => {
      msg += `\n--- ${d.title_output || d.title} ---\n${d.content}\n`;
    });
  }

  return msg;
}

function buildCEOMessage(goal, taskType) {
  const TYPE_INJECTIONS = {
    write:    'Focus on written deliverables. Assign Writer agents.',
    code:     'Focus on code deliverables. Assign Coder agents.',
    research: 'Focus on research and analysis. Assign Researcher agents.',
    plan:     'Create a structured plan broken into logical steps.'
  };
  let msg = `Goal: ${goal}`;
  if (taskType && taskType !== 'auto' && TYPE_INJECTIONS[taskType]) {
    msg += `\n${TYPE_INJECTIONS[taskType]}`;
  }
  msg += '\nRespond only with valid JSON matching the schema in your system prompt.';
  return msg;
}

/* ── Provider URL ── */
function getProviderURL(provider, model, cfAcct) {
  switch (provider) {
    case 'deepseek':
      return 'https://api.deepseek.com/v1/chat/completions';
    case 'gemini':
      return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    case 'openrouter':
      return 'https://openrouter.ai/api/v1/chat/completions';
    case 'groq':
      return 'https://api.groq.com/openai/v1/chat/completions';
    case 'cloudflare':
      return `https://api.cloudflare.com/client/v4/accounts/${cfAcct}/ai/run/${model}`;
    default:
      return '';
  }
}

/* ── Request headers ── */
function buildHeaders(provider, apiKey) {
  const base = { 'Content-Type': 'application/json' };
  switch (provider) {
    case 'deepseek':
    case 'openrouter':
    case 'groq':
      return { ...base, 'Authorization': `Bearer ${apiKey}` };
    case 'cloudflare':
      return { ...base, 'Authorization': `Bearer ${apiKey}` };
    case 'gemini':
      return { ...base, 'x-goog-api-key': apiKey };
    default:
      return base;
  }
}

/* ── Request body ── */
function buildRequestBody(provider, agentId, userMessage, maxTokens) {
  const systemPrompt = PROMPTS[agentId] || '';
  switch (provider) {
    case 'deepseek':
    case 'openrouter':
    case 'groq': {
      const model = S.cfg[agentId].model;
      return {
        model,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userMessage  }
        ]
      };
    }
    case 'gemini': {
      return {
        contents: [{
          parts: [{ text: `${systemPrompt}\n\n${userMessage}` }]
        }],
        generationConfig: { maxOutputTokens: maxTokens }
      };
    }
    case 'cloudflare': {
      return {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userMessage  }
        ],
        max_tokens: maxTokens
      };
    }
    default:
      return {};
  }
}

/* ── Extract text from provider response ── */
function extractContent(provider, data) {
  switch (provider) {
    case 'deepseek':
    case 'openrouter':
    case 'groq':
      return data?.choices?.[0]?.message?.content || null;
    case 'gemini':
      return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
    case 'cloudflare':
      return data?.result?.response || null;
    default:
      return null;
  }
}

/* ── Gemini URL needs key as query param ── */
function buildGeminiURL(model, apiKey) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
}
