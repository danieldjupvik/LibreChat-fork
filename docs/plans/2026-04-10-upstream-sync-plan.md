# Upstream Sync Conflict PR Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the upstream sync workflow reuse one fork-scoped conflict branch and PR instead of creating new timestamped conflict PRs on each failing run.

**Architecture:** The workflow keeps the existing merge probe on `main`, but the conflict-handling branch becomes a stable branch. PR detection uses the exact fork repository, base branch, and head branch. On conflict, the workflow resets the stable branch from `main`, replays the conflicted merge, commits the conflict markers, force-pushes the branch, and creates a PR only when one is not already open.

**Tech Stack:** GitHub Actions YAML, `git`, GitHub CLI (`gh`)

---

### Task 1: Harden conflict PR detection and branch reuse

**Files:**
- Modify: `.github/workflows/sync-upstream.yml`

**Step 1: Re-read the workflow before editing**

Run: `sed -n '1,220p' .github/workflows/sync-upstream.yml`
Expected: Current conflict flow uses `gh pr list --search "Upstream Sync"` and a timestamped `upstream-sync-<date>` branch.

**Step 2: Patch the conflict flow**

Change the workflow to:

- define `BRANCH="upstream-sync-conflicts"`
- define `HEAD_REF="${GITHUB_REPOSITORY_OWNER}:${BRANCH}"`
- look up `EXISTING_PR` with `gh pr list --repo "$GITHUB_REPOSITORY" --base main --head "$BRANCH" --state open`
- fetch and delete any local copy of the stable branch before recreating it from `main`
- force-push the stable branch to `origin`
- create the PR only when `EXISTING_PR` is empty

**Step 3: Re-read the workflow after editing**

Run: `sed -n '45,110p' .github/workflows/sync-upstream.yml`
Expected: Repo-scoped PR lookup, stable branch name, and single-PR logic are present.

### Task 2: Verify behavior and repository tooling

**Files:**
- Inspect: `.github/workflows/sync-upstream.yml`

**Step 1: Verify open conflict PR state in the fork**

Run: `gh pr list --repo danieldjupvik/LibreChat-fork --state open --json number,title,headRefName`
Expected: Existing conflict PRs are visible and show why the old lookup allowed duplication.

**Step 2: Run required typecheck**

Run: `npx tsc --noEmit`
Expected: Exit code `0`, or clear report if the repo has unrelated existing failures.

**Step 3: Run required lint**

Run: `npx eslint . --quiet`
Expected: Exit code `0`, or clear report if the repo has unrelated existing failures.

**Step 4: Report residual risk**

Document that correctness depends on GitHub honoring `gh pr list --repo ... --head ... --base ...` in Actions, which matches local CLI behavior verified against the fork.
