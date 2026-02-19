# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## This is a Fork

LibreChat fork with active upstream. Minimize merge conflicts:

- **Do not modify upstream files** unless absolutely necessary
- Put custom code in isolated directories: `client/src/forked-code-custom/`, `client/src/forked-style-custom/`, `api/server/forked-code/`
- Custom backend routes go under `/api/forked/*`
- Prefer extension over modification (wrap components, override CSS via higher specificity)
- Leave inline comments explaining why a change was made

## Commands

```bash
# Development
npm run backend:dev          # Express server with nodemon (port 3080)
npm run frontend:dev         # Vite dev server (port 3090, proxies to 3080)

# Build (order matters — packages first)
npm run build:packages       # builds data-provider → data-schemas → api → client-package
npm run build:client         # builds React app (requires packages built first)
npm run frontend             # builds everything in correct order

# Test
npm run test:api             # jest --ci in api/
npm run test:client          # jest --ci in client/
npm run test:packages:api    # jest --ci in packages/api/
npm run test:packages:data-provider
npm run test:packages:data-schemas
npm run test:all             # runs all the above

# Single test (inside workspace)
cd api && npx jest path/to/test --watch
cd client && npx jest path/to/test --watch

# E2E
npm run e2e                  # Playwright headless
npm run e2e:headed           # with browser

# Lint
npm run lint
npm run lint:fix
```

## Architecture

Monorepo (npm workspaces + Turborepo). Five packages:

```
api/                          Express.js backend (CommonJS, JavaScript)
client/                       React SPA (TypeScript, Vite)
packages/data-provider/       Shared types, Zod schemas, API client, react-query hooks
packages/data-schemas/        Mongoose schemas and models (TypeScript)
packages/api/                 MCP services, stream, cache, middleware (TypeScript)
packages/client/              Shared React component library
```

**Dependency flow:** `client/` → `packages/client/` → `data-provider`. `api/` → `packages/api/` → `data-schemas` → `data-provider`.

### Backend (`api/`)

- Entry: `api/server/index.js` — connects MongoDB, loads `librechat.yaml` config, mounts Express middleware, registers all `/api/*` routes, serves static React build
- Routes: `api/server/routes/` — one file per resource (auth, convos, messages, agents, files, etc.)
- Controllers: `api/server/controllers/`
- Middleware: `api/server/middleware/` — auth (Passport.js + JWT), rate limiting, validation
- LLM clients: `api/app/clients/` — adapters for OpenAI, Anthropic, Google, Bedrock, Ollama, etc.
- Auth strategies: `api/strategies/` — local, LDAP, OAuth (Google, GitHub, Discord, etc.)
- Fork routes: `api/server/forked-code/` — Lago billing proxy, LiteLLM proxy

### Frontend (`client/src/`)

- Root: `App.jsx` — RecoilRoot, QueryClientProvider, ThemeProvider, Router
- Routes: `routes/` — React Router v6, `ChatRoute.tsx` is the main chat UI
- State: Recoil atoms (`store/`), Jotai atoms, TanStack Query v4 (`data-provider/`)
- Components: organized by feature (`Chat/`, `Messages/`, `Agents/`, `Nav/`, `Auth/`, `ui/`)
- Providers: 28+ React contexts in `Providers/`
- i18n: `locales/` with i18next
- Fork code: `forked-code-custom/` (RouteGuard, SubscriptionRequiredPage, etc.), `forked-style-custom/custom-daniel-ai.css`

### Database

MongoDB via Mongoose. Schemas in `packages/data-schemas/src/schema/`, models in `src/models/`. Key models: User, Conversation, Message, Agent, File, Role, Balance, Transaction, Session.

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

## Conventions

- **Frontend**: TypeScript. **Backend**: JavaScript (intentional, not migrating).
- Path alias `~/` maps to `src/` in client and `api/` root in backend.
- File naming: React components PascalCase (`MyComponent.tsx`), helpers camelCase (`myHelper.ts`).
- Commit format: semantic (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `test:`, `style:`).
- Import order (ESLint enforced): npm packages → TypeScript types → local imports (longest line first within each group).
- Node 20.x, npm 11.
- Config: root `.env` file (see `.env.example`), `librechat.yaml` for app features/endpoints.
