# Fork Guide

Fork-specific guidance for AI coding assistants. For general project architecture, code style, and conventions, see [AGENTS.md](./AGENTS.md) (upstream-maintained).

## This is a Fork

LibreChat has an active upstream. Avoiding upstream edits is a design requirement,
not a cleanup step after implementation.

### Fork-owned paths

Put fork implementation, tests, helpers, styles, and documentation in these paths:

- `.fork/**`
- `FORK.md`
- `api/server/forked-code/**`
- `client/src/forked-code-custom/**`
- `client/src/forked-style-custom/**`

Custom backend routes go under `/api/forked/*`. Treat every other path as
upstream-owned unless Daniel has explicitly approved and documented another
fork-owned location. An upstream-looking test directory does not become
fork-owned because the test covers fork behavior.

### Upstream edit gate (mandatory)

Before changing an upstream-owned file:

1. Search `.fork/sentinels.tsv`, the fork-owned paths above, and existing
   uncommitted changes for a hook, wrapper, route, component, or sentinel that
   can carry the change.
2. Reuse or extend an existing fork integration point when it fits. Prefer
   removing or consolidating old fork wiring over adding another upstream edit.
   Do not create a second hook when an existing touched location can safely
   support the same concern.
3. Keep the implementation and its tests in fork-owned paths. If upstream wiring
   is unavoidable, limit it to the smallest stable call, import, or registration.
4. Get Daniel's explicit approval in the current conversation before editing a
   new upstream-owned file or adding a new sentinel. A request to implement a
   feature is not blanket approval to modify upstream files.
5. Tag every approved inline upstream edit with a `FORK-SENTINEL:<id>` comment
   and register it in `.fork/sentinels.tsv`. See `.fork/README.md`.
6. In the final report, list every upstream-owned file changed and explain why
   existing fork code or sentinels could not avoid the edit.

Existing upstream edits are not precedent for more upstream edits. Reuse them
only when the same integration concern belongs there. Otherwise keep the change
fork-owned or ask Daniel before proceeding. CI blocks merges to `main` that drop
a registered sentinel or leave a conflict marker.

## Running checks (fast)

### Resource safety (mandatory)

**NEVER run the full CI test suites on a developer Mac.** Do not run
`npm run test:ci`, `cd api && npm run test:ci`, `cd client && npm run test:ci`,
or equivalent workspace-wide test commands locally. They can spawn enough Jest
workers and supporting processes to exhaust system RAM and CPU.

Run only the test files relevant to the change, with concurrency capped:

```bash
npx jest --runInBand --no-watchman path/to/changed.spec.js
```

Use changed-file linting and targeted builds as described below. Leave full CI
execution to the CI environment unless Daniel explicitly approves it in the
current conversation.

**ESLint is the lint gate — but never run `npx eslint .`.** The config is type-aware
(it builds a TypeScript program per file), so linting the whole repo takes minutes.
Lint only changed files, exactly like CI (~10s):

```bash
git diff --name-only --diff-filter=ACMRTUXB HEAD -- '*.js' '*.jsx' '*.ts' '*.tsx' \
  | grep -E '^(api|client|packages)/' \
  | xargs -r npx eslint --no-error-on-unmatched-pattern --max-warnings=0
```

Single file: `npx eslint path/to/file.tsx` (add `--fix` to auto-fix).

Lint the **entire fork codebase** (all fork-owned JS/TS dirs, uses the existing config, ~5s) — a good final check that doesn't depend on what the diff happens to touch:

```bash
npx eslint --no-error-on-unmatched-pattern --max-warnings=0 \
  client/src/forked-code-custom api/server/forked-code
```

**Type-check.** Build the workspace packages first or the client sees stale
cross-package types (parallel + cached; skips the heavy client app build):

```bash
npx turbo run build --filter='./packages/*'
cd client && npx tsc --noEmit
```

CI type-gates differ by workspace:

- **`packages/*` ARE strictly type-checked** (`backend-review.yml` runs `tsc --noEmit -p`
  on each). If you change a package, keep it clean:
  `npx tsc --noEmit -p packages/<name>/tsconfig.json`.
- **The `client/` app is NOT type-checked in CI** — it ships via Vite/esbuild (no type
  check) and is covered by ESLint + Jest. So `cd client && npx tsc --noEmit` always
  reports pre-existing **upstream** type debt (tests, a11y, agents, etc.). That baseline
  is not yours to fix — only ensure the files **you** changed add no *new* errors.

In practice: ESLint on changed files is the lint gate; package `tsc` is the type gate;
a green `tsc` over the whole `client/` app is not expected and not required.

**Install:** `npm ci` — authoritative (`packageManager: npm`, CI uses it) and never
rewrites a lockfile. Avoid `bun install`: upstream's `bun.lock` is stale, so bun
rewrites it on every run (large spurious diff).

## Fork File Locations

**Backend (JavaScript):**
- `api/server/forked-code/` — all fork-specific backend code
- `api/server/forked-code/agents/` — agent controller extensions (e.g., `applyLiteLLMStreamUsage.js`, `preserveLiteLLMUsage.js`)
- `api/server/forked-code/litellm/` — LiteLLM proxy and model info cache
- `api/server/forked-code/routes/` — custom Express routes mounted under `/api/forked/*`

**Frontend (TypeScript):**
- `client/src/forked-code-custom/` — fork React components and adapters (RouteGuard, SubscriptionRequiredPage, ModelBadges, etc.)
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

Cost display is **upstream's native feature** (`interface.contextCost`, the context
gauge, the cost breakdown, `metadata.usage`). The fork contributes exactly two
things: LiteLLM **prices** and LiteLLM **usage normalization**. The fork's own
response-cost UI/persistence is parked — see
[`.fork/parked/litellm-response-cost/`](./.fork/parked/litellm-response-cost/README.md).

### The pricing bridge

`api/server/forked-code/litellm/tokenConfig.js` exposes a single function:

```js
applyLiteLLMTokenConfig(appConfig) -> Promise<appConfig>
```

Everything else — fetching, caching, validation, LiteLLM→LibreChat conversion,
model matching, cloning, fallback, error handling, logging — is inside the module.
It has exactly one upstream seam, `api/server/middleware/config/app.js`
(`FORK-SENTINEL:litellm-token-config`). The sentinel wraps that file's local
`getAppConfig` binding, so its success and fallback assignments stay identical
to upstream while both native consumers of `req.config` receive the pricing.
The fork-owned `initForkedCode` starts the cache warm-up before the server begins
handling requests:

```
initForkedCode → LiteLLM GET /model/info  (server-side, authenticated, cached 1h)
request → applyLiteLLMTokenConfig → req.config.endpoints.custom[LiteLLM].tokenConfig
      ├─ resolveTokenConfigMap  → GET /api/endpoints/token-config → client context gauge
      └─ initializeCustom       → endpointTokenConfig → computeUsageCostUSD → metadata.usage.cost
```

Conversion (LiteLLM per-token → LibreChat per-1M `tokenConfig`):

| LiteLLM `model_info` | LibreChat |
|---|---|
| `input_cost_per_token × 1e6` | `prompt` |
| `output_cost_per_token × 1e6` | `completion` |
| `cache_read_input_token_cost × 1e6` | `cacheRead` (optional) |
| `cache_creation_input_token_cost × 1e6` | `cacheWrite` (optional) |
| `max_input_tokens` ?? `max_tokens` | `context` |

Rules the module enforces:

- An explicit `0` is a real (free) rate; missing / null / non-numeric / `NaN` /
  infinite / negative is **absent**, never coerced to `0`.
- An entry is emitted only with finite input **and** output prices **and** a
  positive context. Otherwise the existing static `tokenConfig` entry stands.
- Dynamic fields override matching static fields. Optional static cache rates
  remain when LiteLLM omits them, so partial metadata cannot change cache billing.
- Public `model_name` aliases are preserved verbatim and win; the underlying
  `litellm_params.model` is also keyed so a provider reporting the real model
  still resolves. No fuzzy or substring matching.
- Duplicate aliases with **conflicting** rates are dropped (bounded warning) so
  the static fallback stays in charge — never last-write-wins. A conflicted key
  stays suppressed for the whole pass, so a third duplicate cannot revive it.
- Only the custom endpoint named `LiteLLM` (case-insensitive, exact) is touched.
- The shared cached `AppConfig` is never mutated; only the root, `endpoints`,
  `endpoints.custom`, the LiteLLM endpoint and its `tokenConfig` are cloned.

**Failure behavior.** Nothing about this can block chat, startup, or
`/api/endpoints/token-config`. `modelInfoCache.js` is stale-while-revalidate: an
expired cache is served immediately and refreshed in the background. A cold cache
also starts the fetch in the background and returns no dynamic entries, leaving
the static config untouched until the warm-up finishes. The fetch has a 5s
timeout, failed refreshes keep the last-known-good entries, and in-flight requests
are deduped.

A failure then opens a **60s backoff** (`FAILURE_BACKOFF_MS`) during which LiteLLM
is not called at all. Without it a cold cache would start another fetch after each
failure, and an expired cache would re-arm a background refresh on every request.
The backoff also bounds the warning to one log line per window. With nothing
cached, `applyLiteLLMTokenConfig` returns the **same** config object untouched —
never zero-cost entries, never a thrown error.

**Known limitation.** LibreChat's custom `tokenConfig` is flat. LiteLLM's
long-context / tiered pricing (`input_cost_per_token_above_128k_tokens`), and its
per-request, per-image, per-audio-token and per-second rates cannot be expressed
by it, so a long-context request is priced at the base rate. Extending upstream's
pricing schema is deliberately out of scope. Costs are approximate for that
reason — LiteLLM's own per-request cost is not available in the streaming
response, and the fork does **not** query spend logs per response.

**Deployment.** Requires `interface.contextCost: true` in `librechat.yaml`
(currency left unset ⇒ USD) and `LITELLM_API_KEY` (+ optional `LITELLM_BASE_URL`)
in the environment. `librechat.yaml` is gitignored — it is deployment config, not
repo state. A manually maintained static `tokenConfig` block under the LiteLLM
endpoint still works and acts as a per-model fallback; remove it only once the
dynamic bridge is validated against the full configured model list, as a separate
step.

### Request Flow for Custom Endpoints (LiteLLM)

All chat requests go through `/api/agents/chat/:endpoint` (the `/:endpoint` route handles custom endpoints like LiteLLM as "ephemeral agents"). The flow:

```
Frontend → POST /api/agents/chat/LiteLLM
  → configMiddleware → getAppConfig → applyLiteLLMTokenConfig → req.config
    → ResumableAgentController (api/server/controllers/agents/request.js)
      → initializeClient → initializeCustom → endpointTokenConfig (LiteLLM rates)
      → creates AgentClient, collectedUsage[], ModelEndHandler
      → client.sendMessage()
        → sendCompletion() → LangChain ChatOpenAI → OpenAI SDK → LiteLLM proxy → LLM provider
        → on_chat_model_end → preserveLiteLLMUsage normalizes raw usage → collectedUsage[]
        → computeUsageCostUSD(usage, endpointTokenConfig) → per-event `cost`
        → saveMessageToDatabase() → metadata.usage (native rollup incl. cost)
      → SSE final event → native context gauge / cost breakdown
```

### Key Gotchas

1. **`streamUsage` is disabled for custom providers** — `packages/api/src/agents/run.ts` sets `llmConfig.streamUsage = false` for custom providers unless `model_parameters.streamUsage` is explicitly set. The fork's `applyLiteLLMStreamUsage` (`api/server/forked-code/agents/applyLiteLLMStreamUsage.js`, called from `client.js` via the `FORK-SENTINEL:litellm-streamusage` edit) sets that opt-in for LiteLLM-endpoint agents so upstream skips the disable path. Without it, `usage_metadata` arrives as `undefined` and `response_metadata.usage` is `{}`. (This replaces the older inline `run.ts` patch.)

2. **LiteLLM's raw usage needs normalizing** — `preserveLiteLLMUsage` (`FORK-SENTINEL:litellm-response-usage`) merges the raw OpenAI-compatible `usage` details LiteLLM sends (cache buckets, reasoning tokens) into `usage_metadata`, and de-duplicates doubled stream counts. Upstream's native rollup and cost math read those details, so this is **not** part of the parked cost feature.

3. **LiteLLM cost is NOT in the streaming response** — LiteLLM calculates cost server-side but does not include it in the streaming usage chunk. Cost is computed by upstream's `computeUsageCostUSD` from provider token usage × the injected flat rates.

4. **`stream_options` routing** — `stream_options` is in `knownOpenAIParams` (packages/api/src/endpoints/openai/llm.ts), so YAML `addParams.stream_options` goes to `llmConfig` (ignored by ChatOpenAI constructor) instead of `modelKwargs`. This is why the YAML config alone can't enable stream usage.

5. **TypeScript packages need rebuild** — Changes to `packages/api/src/` require `npm run build:packages` before restart.

### Fork Files for LiteLLM

**Backend:**
- `api/server/forked-code/litellm/tokenConfig.js` — the pricing bridge (`applyLiteLLMTokenConfig`)
- `api/server/forked-code/litellm/modelInfoCache.js` — non-blocking authenticated `/model/info` warm-up + 1h stale-while-revalidate cache (5s timeout, inflight dedup, last-known-good). The only LiteLLM fetch in the codebase; the API key never leaves the server.
- `api/server/forked-code/agents/applyLiteLLMStreamUsage.js` — streamed-usage opt-in
- `api/server/forked-code/agents/preserveLiteLLMUsage.js` — raw usage normalization

**Frontend:**
- `client/src/forked-code-custom/modelPricing.ts` — `useModelPricingInfo`, badge pricing read from the native `useTokenConfigQuery` (explicit `spec.badges` values stay authoritative); its five-minute refresh hook mounts once through the existing fork-owned `RouteGuard`, with no extra upstream integration edit
- `client/src/forked-code-custom/modelBadges.tsx` — price / context / free / new badges in the model picker

**Tests:**
- `api/server/forked-code/litellm/tokenConfig.spec.js` — conversion, merge, cache, and non-blocking fallback behavior
- `api/server/forked-code/litellm/tokenConfig.integration.spec.js` — middleware → `/endpoints/token-config` **and** → `endpointTokenConfig` → `computeUsageCostUSD`
- `api/server/forked-code/litellm/responseCostRemoved.spec.js` — **active** guard (not parked): fails if the parked feature is wired back in, or if the native `metadata.usage` path is lost
- `client/src/forked-code-custom/modelPricing.spec.tsx` — badge pricing + loading/fallback + refresh policy
