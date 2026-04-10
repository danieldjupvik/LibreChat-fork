# Upstream Sync Conflict PR Design

**Context**

The upstream sync workflow creates a new timestamped branch and PR on every scheduled run that encounters the same unresolved merge conflict. The confirmed root cause is that the workflow checks for an existing open PR without scoping the `gh pr list` call to the fork repository, while `gh pr create` is scoped correctly. In this repo, that means the lookup can resolve against `danny-avila/LibreChat` while creation targets `danieldjupvik/LibreChat-fork`.

**Approved Approach**

Use a stable conflict branch name and exact PR lookup in the fork repository:

- Scope all `gh pr` calls to `${GITHUB_REPOSITORY}`.
- Replace the timestamped branch with a stable branch name: `upstream-sync-conflicts`.
- Look for an open PR by exact head branch and base branch instead of title search.
- Recreate or force-update that branch when conflicts persist, then create the PR only if one does not already exist.

**Why This Design**

This fixes the confirmed repo-resolution bug and removes the branch/PR spam failure mode. Even if the workflow hits conflicts repeatedly for hours or days, it should keep reusing the same branch and the same PR instead of minting new ones.

**Non-Goals**

- No automatic conflict resolution.
- No cleanup of old conflict PRs or branches in this phase.
- No broader refactor of other workflows.
