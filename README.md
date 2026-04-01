# AgentOS Workspace

A multi-agent AI workspace powered by your free-tier API providers.
CEO → CMO / CTO → Engineering Manager, all running on real AI APIs.

---

## Quick Deploy

### 1. Prerequisites
```bash
npm install -g wrangler
wrangler login
```

### 2. Deploy
```bash
cd agent-workspace
wrangler deploy
```

Your app will be live at: `https://agent-workspace.YOUR_SUBDOMAIN.workers.dev`

---

## API Keys

Enter your keys in the **Settings panel** (⚙ gear icon, bottom-left sidebar).
Keys are stored in memory only — re-enter each session for security.

| Provider   | Where to get your key                                     |
|------------|-----------------------------------------------------------|
| DeepSeek   | https://platform.deepseek.com/api_keys                    |
| AI Studio  | https://aistudio.google.com/app/apikey                    |
| Cloudflare | https://dash.cloudflare.com/profile/api-tokens            |
| OpenRouter | https://openrouter.ai/keys                                |

For **Cloudflare AI**, you also need your **Account ID**:
→ Cloudflare Dashboard → right sidebar → "Account ID"

---

## Free Tier Limits

| Provider       | Limit                        | Used for        |
|----------------|------------------------------|-----------------|
| DeepSeek       | ~60 RPM, generous TPD        | CEO, CTO        |
| Gemini Flash   | 15 RPM, 1M tokens/day        | CMO             |
| Cloudflare AI  | ~10k neurons/day (~20 calls) | Fallback        |
| OpenRouter     | ~20 RPM (free models)        | EM, fallback    |

The workspace adds a 1.8s delay between agent calls to stay within limits.

---

## Agent Defaults

| Agent | Provider      | Model                            |
|-------|---------------|----------------------------------|
| CEO   | DeepSeek      | deepseek-reasoner (deep thinking)|
| CMO   | AI Studio     | gemini-2.0-flash                 |
| CTO   | DeepSeek      | deepseek-chat                    |
| EM    | OpenRouter    | llama-3.1-8b-instruct:free       |

Change any agent's model in the **Agents** tab of the right panel.

---

## Optional: Add KV Persistence

To save tasks between sessions:

```bash
wrangler kv namespace create "WORKSPACE_KV"
# Copy the ID it gives you into wrangler.toml
```

Then uncomment the `[[kv_namespaces]]` section in `wrangler.toml`.

---

## Project Structure

```
agent-workspace/
  wrangler.toml     - Cloudflare config
  worker.js         - Backend: proxies all AI API calls server-side
  public/
    index.html      - Full frontend (vanilla JS, no build step)
  README.md
```

---

## Security Note

API keys are sent from browser → Cloudflare Worker → AI provider.
The Worker→Provider connection is fully server-side (secure).
Keys are never stored — cleared on page refresh.

For production: store keys as Cloudflare Worker secrets instead:
```bash
wrangler secret put DEEPSEEK_API_KEY
```
Then update `worker.js` to read from `env.DEEPSEEK_API_KEY`.
