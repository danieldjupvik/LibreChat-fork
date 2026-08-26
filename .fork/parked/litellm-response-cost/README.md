# Parked: custom LiteLLM response-cost feature

The fork's own per-message cost pipeline, replaced on 2026-08-25 by the LiteLLM
**pricing bridge** (`api/server/forked-code/litellm/tokenConfig.js`) feeding
LibreChat's *native* context gauge and cost breakdown.

The old feature calculated its own USD/NOK cost per response, persisted a
snapshot to `metadata.forked_litellm_usage`, and rendered a bespoke cost dialog
from a HoverButtons mount. Upstream has since shipped native context-usage and
context-cost (`interface.contextCost`, `metadata.usage`, `/api/endpoints/token-config`),
so the fork now only supplies **prices** and keeps upstream's UI, persistence,
and cost math.

Everything needed to bring the old feature back is kept here verbatim.

## Contents

| File | Was |
|---|---|
| `api/syncResponseUsage.js` | `api/server/forked-code/agents/syncResponseUsage.js` |
| `api/syncResponseUsage.spec.js` | `api/server/forked-code/agents/syncResponseUsage.spec.js` |
| `api/syncResponseUsage.db.spec.js` | `api/server/forked-code/agents/syncResponseUsage.db.spec.js` |
| `api/litellm.route.js` | `api/server/forked-code/routes/litellm.js` |
| `client/ResponseCost.tsx` | `client/src/forked-code-custom/ResponseCost.tsx` |
| `client/ResponseCost.spec.ts` | `client/src/forked-code-custom/ResponseCost.spec.ts` |
| `client/pricing.ts` | `client/src/forked-code-custom/pricing.ts` |
| `client/currencyAdapter.ts` | `client/src/forked-code-custom/currencyAdapter.ts` |
| `client/litellmInfoAdapter.ts` | `client/src/forked-code-custom/litellmInfoAdapter.ts` |

All of it lives **outside** `api/` and `client/src`, so it is not compiled,
bundled, linted, type-checked, or picked up by either jest project (`api`'s root
is `api/`, the client's is `client/src`). It is a snapshot, not live code: the
imports (`~/models`, `~/utils`, `~/store`, `librechat-data-provider` types) may
have drifted upstream since parking.

`api/server/forked-code/litellm/responseCostRemoved.spec.js` fails if any of this
is wired back into active source by accident.

## What was removed from active code

- `api/server/controllers/agents/request.js` — both `syncResponseUsage` calls and
  the import (sentinels `sync-response-usage`, `sync-response-usage-persist`).
- `client/src/components/Chat/Messages/HoverButtons.tsx` — the `<ResponseCost />`
  mount and its import (sentinel `response-cost`).
- `api/server/forked-code/routes/index.js` — the `/api/forked/litellm` mount.
- `client/src/forked-code-custom/index.ts`, `ForkedCustomizations.tsx`,
  `jestBarrelStub.tsx` — `ResponseCost` / `initLiteLLMModelData` exports and the
  app-start LiteLLM prefetch.
- `client/src/forked-code-custom/modelBadges.tsx` — now reads
  `./modelPricing` (native `useTokenConfigQuery`) instead of the browser-side
  LiteLLM adapter.

**No database change was ever made for this feature.** The snapshot lived inside
the existing free-form `metadata` field on the message document
(`packages/data-schemas/src/schema/message.ts`: `metadata: Mixed`) — there is no
collection, index, schema field, or migration to roll back. Existing messages may
still carry an inert `metadata.forked_litellm_usage` object; with every reader and
writer gone it is harmless and no live cleanup was performed.

## What deliberately stayed active

`applyLiteLLMStreamUsage.js` and `preserveLiteLLMUsage.js` (and
`modelEndHandlerUsage.spec.js`) are **not** part of this feature. They opt LiteLLM
agents into streamed `usage_metadata` and normalize LiteLLM's raw OpenAI usage
payload — upstream's native usage rollup and cost calculation depend on both.

## Re-applying

1. Move the files back to the paths in the table above (`git mv`).
2. `api/server/controllers/agents/request.js` — re-add the import and both call
   sites with their `FORK-SENTINEL:sync-response-usage` /
   `FORK-SENTINEL:sync-response-usage-persist` comments.
3. `client/src/components/Chat/Messages/HoverButtons.tsx` — re-add the import and

   ```tsx
   {/* FORK-SENTINEL:response-cost — fork-only per-message cost display */}
   <ResponseCost message={message} conversation={conversation} isLast={isLast} />
   ```

4. `api/server/forked-code/routes/index.js` — re-mount `router.use('/litellm', litellmRoutes)`.
5. Re-export `ResponseCost` / `initLiteLLMModelData` from
   `client/src/forked-code-custom/index.ts` and `jestBarrelStub.tsx`, and re-add the
   `initLiteLLMModelData()` call in `ForkedCustomizations.tsx`.
6. Re-add these rows to `.fork/sentinels.tsv` (TAB-separated):

   ```
   sync-response-usage	api/server/controllers/agents/request.js	Set token/cost usage on the response before the final SSE event	await syncResponseUsage(
   sync-response-usage-persist	api/server/controllers/agents/request.js	Background-persist cost metadata without blocking the SSE final event	persist: true
   response-cost	client/src/components/Chat/Messages/HoverButtons.tsx	Fork-only per-message cost display	<ResponseCost
   ```

7. `api/syncResponseUsage.js` imported `getLiteLLMModelInfoMap` from
   `api/server/forked-code/litellm/modelInfoCache.js`. That export is gone. The
   cache now returns an atomic snapshot via `getLiteLLMPricingSnapshot()`.
   Handle a possible `null` cold-cache result, then rebuild the
   `model -> model_info` map from `snapshot.entries`, or restore the old export.
   Do **not** add a second LiteLLM fetch.
8. Verify: `bash .fork/verify-sentinels.sh`, `cd api && npx jest forked-code`,
   `npx eslint api/server/forked-code client/src/forked-code-custom`. Note that
   `responseCostRemoved.spec.js` is designed to fail once the feature is active —
   delete it as part of the restore.

The removal commit is the other reference —
`git log --diff-filter=D -- api/server/forked-code/agents/syncResponseUsage.js`.
