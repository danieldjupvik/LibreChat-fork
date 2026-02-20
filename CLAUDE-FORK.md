# CLAUDE-FORK.md

Fork-specific guidance for AI coding assistants. For general project architecture, code style, and conventions, see [AGENTS.md](./AGENTS.md) (upstream-maintained).

## This is a Fork

LibreChat fork with active upstream. Minimize merge conflicts:

- **Do not modify upstream files** unless absolutely necessary
- Put custom code in isolated directories: `client/src/forked-code-custom/`, `client/src/forked-style-custom/`, `api/server/forked-code/`
- Custom backend routes go under `/api/forked/*`
- Prefer extension over modification (wrap components, override CSS via higher specificity)
- Leave inline comments explaining why a change was made

## Fork File Locations

**Backend (JavaScript):**
- `api/server/forked-code/` — all fork-specific backend code
- `api/server/forked-code/agents/` — agent controller extensions (e.g., `syncResponseUsage.js`)
- `api/server/forked-code/litellm/` — LiteLLM proxy and model info cache
- `api/server/forked-code/routes/` — custom Express routes mounted under `/api/forked/*`

**Frontend (TypeScript):**
- `client/src/forked-code-custom/` — fork React components and adapters (RouteGuard, SubscriptionRequiredPage, ResponseCost, etc.)
- `client/src/forked-style-custom/custom-daniel-ai.css` — CSS overrides via higher specificity

## Fork Conventions

- **Frontend**: TypeScript. **Backend**: JavaScript (intentional, not migrating).
- Path alias `~/` maps to `src/` in client and `api/` root in backend.
- File naming: React components PascalCase (`MyComponent.tsx`), helpers camelCase (`myHelper.ts`).
- Commit format: semantic (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `test:`, `style:`).
- Node 20.x, npm 11.
- Config: root `.env` file (see `.env.example`), `librechat.yaml` for app features/endpoints.

## LiteLLM Integration & Cost Display

LiteLLM is used as a custom endpoint (`endpoints.custom` in `librechat.yaml`), NOT as an agents endpoint. All models (Gemini, Claude, GPT, etc.) route through it as an OpenAI-compatible proxy.

### Request Flow for Custom Endpoints (LiteLLM)

All chat requests go through `/api/agents/chat/:endpoint` (the `/:endpoint` route handles custom endpoints like LiteLLM as "ephemeral agents"). The flow:

```
Frontend → POST /api/agents/chat/LiteLLM
  → ResumableAgentController (api/server/controllers/agents/request.js)
    → initializeClient → creates AgentClient, collectedUsage[], ModelEndHandler
    → client.sendMessage()
      → sendCompletion() → LangChain ChatOpenAI → OpenAI SDK → LiteLLM proxy → LLM provider
      → on_chat_model_end → pushes usage_metadata to collectedUsage[]
      → recordCollectedUsage() → sets this.usage = { input_tokens, output_tokens }
      → saveMessageToDatabase() → saves to MongoDB
      → delete responseMessage.tokenCount (REMOVED from in-memory before return)
    → syncResponseUsage (non-persist) → re-attaches actual token counts to response
    → syncResponseUsage (persist, fire-and-forget) → enriches with rates/costs, saves to metadata
    → SSE final event → frontend (not blocked by persist step)
```

### Key Gotchas

1. **`streamUsage` is disabled for custom providers** — `packages/api/src/agents/run.ts:276` sets `llmConfig.streamUsage = false` for all custom providers. We patched this to skip the override when `agent.endpoint` contains `'litellm'` (case-insensitive `includes` check). Without this, `usage_metadata` arrives as `undefined` and `response_metadata.usage` is `{}`.

2. **`tokenCount` is deleted before reaching frontend** — `BaseClient.js:810` does `delete responseMessage.tokenCount` after saving to DB. `syncResponseUsage` re-attaches it from `client.getStreamUsage()`.

3. **`promptTokens` is an estimate, not actual** — The `promptTokens` field on the response message comes from context window accounting, NOT from the LLM API response. `syncResponseUsage` overrides it with `streamUsage.input_tokens` for the SSE response. The persist step saves actual tokens + rates + costs to `metadata.forked_litellm_usage`, so page refresh uses the snapshot (not the estimate).

4. **LiteLLM cost is NOT in the streaming response** — LiteLLM calculates cost server-side but does NOT include it in the streaming usage chunk. Cost is calculated server-side by `syncResponseUsage` (locked at generation) and falls back to client-side calculation from token counts × pricing rates.

5. **`stream_options` routing** — `stream_options` is in `knownOpenAIParams` (packages/api/src/endpoints/openai/llm.ts), so YAML `addParams.stream_options` goes to `llmConfig` (ignored by ChatOpenAI constructor) instead of `modelKwargs`. This is why the YAML config alone can't enable stream usage.

6. **TypeScript packages need rebuild** — Changes to `packages/api/src/` require `npm run build:packages` before restart.

### Upstream Files Modified (minimize these)

- `packages/api/src/agents/run.ts:276` — Skip `streamUsage = false` for endpoints containing "litellm"
- `api/server/controllers/agents/request.js` — Import and call `syncResponseUsage` (non-blocking persist)

### Fork Files for Cost Display

**Backend:**
- `api/server/forked-code/agents/syncResponseUsage.js` — Enriches response with actual token counts, fetches model rates, calculates costs, persists to `metadata.forked_litellm_usage`
- `api/server/forked-code/litellm/modelInfoCache.js` — Server-side cache for LiteLLM `/model/info` (1h TTL, 5s timeout, inflight dedup)
- `api/server/forked-code/routes/litellm.js` — Server-side proxy for LiteLLM API (keeps API key secure)

**Frontend:**
- `client/src/forked-code-custom/ResponseCost.tsx` — Cost breakdown dialog with currency conversion (USD/NOK), per-token rates, reasoning token split, Claude cost comparison, model label resolution from modelSpecs
- `client/src/forked-code-custom/litellmInfoAdapter.ts` — Client-side cache for LiteLLM model pricing
- `client/src/forked-code-custom/currencyAdapter.ts` — USD/NOK exchange rate fetcher (1h cache, failure throttling)
- `client/src/components/Chat/Messages/HoverButtons.tsx:264` — Mounts `<ResponseCost />` component
