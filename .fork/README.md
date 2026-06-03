# Fork sync hardening

This directory holds the machinery that keeps our fork in sync with upstream
LibreChat **without silently losing fork changes**, and that makes conflict PRs
safe enough for an agent to resolve from the PR URL alone.

## Why this exists

Our fork commits changes directly to `main`. ~97% of those changes are isolated
in `forked-code/` and `forked-code-custom/` directories that upstream never
touches. The remaining risk is a small number of **inline edits to upstream
files** (thin wiring). When upstream rewrites one of those exact lines, two bad
things used to happen:

1. A clean text-merge could **silently drop** a fork edit. Once dropped on
   `main`, our line equals upstream's line, so it never conflicts again — the
   loss is permanent and invisible.
2. The old sync job committed conflict markers as a normal merge commit (which
   GitHub still reports as "mergeable") and force-pushed the conflict branch
   hourly, clobbering any in-progress resolution.

## How it works

### Sentinels (the silent-loss defense)

Every intentional inline edit to an upstream file is tagged in code with a
unique marker comment and registered in [`sentinels.tsv`](./sentinels.tsv):

```ts
// FORK-SENTINEL:litellm-streamusage — opt LiteLLM agents into streamUsage so createRun keeps streamed usage
applyLiteLLMStreamUsage(agents);
```

```
litellm-streamusage  api/server/controllers/agents/client.js  <description>  applyLiteLLMStreamUsage(
```

The marker is only a comment, so each registry row also carries a **code anchor**
(the last column) — a fixed substring of the fork *behavior*, here
`applyLiteLLMStreamUsage(`. [`verify-sentinels.sh`](./verify-sentinels.sh) asserts
that for every row both the `FORK-SENTINEL:<id>` marker **and** its anchor still
exist in the file, and that no tracked file carries an unregistered marker. The
anchor matters because a merge could delete the behavior line and leave the
comment behind; without it that loss would pass. If a merge (or any PR) drops a
fork edit, the marker or its anchor disappears and verification **fails loudly**
instead of the change vanishing silently.

### The sync job (`.github/workflows/sync-upstream.yml`)

Runs hourly:

- **Open conflict PR exists?** → pause. Never touch a branch someone is
  resolving.
- **No upstream changes?** → exit.
- **Clean text-merge + sentinels intact?** → push straight to `main`. No human.
- **Clean text-merge but a sentinel vanished?** → escalate to a conflict PR
  (reason `dropped-sentinel`).
- **Real conflict?** → commit the merge with `zdiff3` markers as a proper
  2-parent merge commit and open a conflict PR (reason `conflict-markers`).

### The guard (`.github/workflows/sync-pr-guard.yml`)

Runs on every PR into `main` and blocks merge unless:

- no conflict markers remain in source, and
- all fork sentinels are intact.

Mark **Fork integrity** a required status check in branch protection for `main`
so a markered or fork-change-dropping PR cannot be merged.

## Adding a fork edit to an upstream file

1. Make the edit as small as possible (prefer wiring into `forked-code*/`).
2. Tag it with a `// FORK-SENTINEL:<id>` comment on or next to the changed line.
3. Add a row to [`sentinels.tsv`](./sentinels.tsv): `id <TAB> file <TAB> description <TAB> anchor`.
   The anchor is a fixed substring of the behavior (a call or JSX tag, e.g.
   `<RouteGuard`) that is unique within the file — not the comment text.
4. Run `bash .fork/verify-sentinels.sh` locally — it must pass.

## Resolving a conflict PR

Spin up an agent and give it the PR URL. Everything it needs is in the PR body:
the reason, the conflicting files (or the dropped sentinel), and the steps.
Resolve every conflict / re-apply the dropped edit, preserving **both**
upstream's and the fork's intent, never deleting a `FORK-SENTINEL:<id>`, commit,
and push. The guard + existing CI must be green before merge.

**Merge the conflict PR with a merge commit — never squash or rebase.** The
branch carries a real 2-parent merge commit; that is the only thing that records
upstream as merged into `main`. Squash/rebase discards the upstream parent, so the
next sync reprocesses the same upstream range and re-conflicts. If the repo allows
squash/rebase merges, either disable them for `main` in branch-protection settings
or be careful to pick "Create a merge commit" for these PRs.

## Future option: rebased patch series (Model B)

The "gold standard" for forks is keeping fork changes as a clean patch series
rebased on top of upstream, where conflicts surface per-patch and loss is
impossible by design. We do **not** use it today: our changes are interleaved
into `main`'s history with sync merges, so there is no separable stack to
rebase, and rebasing a deployed `main` rewrites shared history. If inline edits
ever proliferate, restructure fork changes into a rebased stack and revisit.
