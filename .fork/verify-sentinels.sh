#!/usr/bin/env bash
# Verify every fork sentinel registered in .fork/sentinels.tsv:
#   - its FORK-SENTINEL:<id> marker still exists in the registered file,
#   - the registered code anchor (the fork behavior) still exists in that file,
#   - no tracked file carries a marker without a matching (id, file) row.
#
# The anchor check stops a merge from deleting the fork behavior while leaving the
# marker comment behind — that would otherwise pass, since the marker is only a
# comment. Each row must carry an anchor (4th column), and that anchor must match
# EXACTLY ONE line in the file: an anchor that is a substring of a sibling line
# (e.g. `name:` inside `short_name:`) could let one line be dropped while the
# other masks the loss, so an ambiguous (multi-line) anchor is rejected too.
#
# Exit 0  -> all registered sentinels present with a unique anchor, no orphans.
# Exit 1  -> a marker or its anchor is missing (a fork change was dropped), an
#            anchor matches multiple lines (ambiguous), a row lacks an anchor, or
#            an orphan marker exists (edit never registered).
#
# Usage: bash .fork/verify-sentinels.sh [registry-path]
#
# SKIP_ORPHAN_SCAN (env): when set, run pass 1 only (registered rows intact) and
# skip pass 2 (the orphan scan). Use when verifying a DIFFERENT registry against
# this working tree — e.g. the PR guard runs the BASE registry over the PR tree to
# prove no base-registered edit was dropped; the PR's NEW markers are legitimate
# there and must not be flagged as orphans.
set -euo pipefail

REGISTRY="${1:-.fork/sentinels.tsv}"

if [[ ! -f "$REGISTRY" ]]; then
  echo "verify-sentinels: registry not found: $REGISTRY" >&2
  exit 1
fi

registered_ids=()
registered_pairs=""
missing_report=""
status=0

# --- Pass 1: every registered marker AND its code anchor must exist in its file ---
while IFS=$'\t' read -r id file description anchor || [[ -n "${id:-}" ]]; do
  [[ -z "${id:-}" || "$id" == \#* ]] && continue
  registered_ids+=("$id")
  registered_pairs+="${id}"$'\t'"${file}"$'\n'
  if [[ -z "${anchor:-}" ]]; then
    missing_report+="  NO ANCHOR     FORK-SENTINEL:${id} registry row is missing the required code-anchor (4th) column"$'\n'
    status=1
    continue
  fi
  if [[ ! -f "$file" ]]; then
    missing_report+="  MISSING FILE  FORK-SENTINEL:${id} → ${file} (${description})"$'\n'
    status=1
    continue
  fi
  if ! grep -qF "FORK-SENTINEL:${id}" "$file"; then
    missing_report+="  DROPPED       FORK-SENTINEL:${id} expected in ${file} — ${description}"$'\n'
    status=1
    continue
  fi
  anchor_hits=$(grep -cF "$anchor" "$file" || true)
  if [[ "$anchor_hits" -eq 0 ]]; then
    missing_report+="  BEHAVIOR LOST FORK-SENTINEL:${id} marker present in ${file} but its code anchor [${anchor}] is gone — ${description}"$'\n'
    status=1
  elif [[ "$anchor_hits" -ne 1 ]]; then
    missing_report+="  AMBIGUOUS     FORK-SENTINEL:${id} anchor [${anchor}] matches ${anchor_hits} lines in ${file}; pick a token unique within the file so a partial drop can't hide behind a sibling line — ${description}"$'\n'
    status=1
  fi
done < "$REGISTRY"

# --- Pass 2: every marker in the tree must be registered for the file it sits in ---
# Sentinels tag inline edits to upstream files of ANY type — not just JS/TS. The
# registry already covers .md (CLAUDE.md), .html (client/index.html), and config
# (vite.config.ts). Scan EVERY tracked text file so a marker in markdown, HTML,
# YAML, CSS, or config can't slip in unregistered. `git ls-files` keeps .gitignore
# respected (no dist/node_modules); `grep -I` skips binaries. `.fork/` and the
# top-level FORK.md are excluded because they are fork-owned docs that cite real
# sentinel ids in prose (never upstream files carrying a code marker).
#
# The check is on the (id, file) PAIR, not the id alone. Reusing a registered id
# in a second file would otherwise pass — yet that second edit has no row of its
# own, so its later loss would go undetected (pass 1 still finds the id in the
# original file). Binding to the pair forces every marker to a dedicated row.
orphan_report=""
is_registered_pair() {
  printf '%s' "$registered_pairs" | grep -Fxq "${1}"$'\t'"${2}"
}

if [[ -z "${SKIP_ORPHAN_SCAN:-}" ]] && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  tracked_files=$(git ls-files -- . ':(exclude).fork/*' ':(exclude)FORK.md' || true)
  if [[ -n "$tracked_files" ]]; then
    while IFS= read -r hit; do
      [[ -z "$hit" ]] && continue
      file="${hit%%:FORK-SENTINEL:*}"
      id="${hit##*:FORK-SENTINEL:}"
      if ! is_registered_pair "$id" "$file"; then
        orphan_report+="  ORPHAN        FORK-SENTINEL:${id} in ${file} has no matching row (id+file) in ${REGISTRY}"$'\n'
        status=1
      fi
    done < <(printf '%s\n' "$tracked_files" | tr '\n' '\0' \
      | xargs -0 grep -oIE 'FORK-SENTINEL:[a-z][a-z0-9-]*' 2>/dev/null | sort -u)
  fi
fi

if [[ "$status" -ne 0 ]]; then
  echo "Fork sentinel verification FAILED:"
  [[ -n "$missing_report" ]] && printf '%s' "$missing_report"
  [[ -n "$orphan_report" ]] && printf '%s' "$orphan_report"
  exit 1
fi

if [[ -n "${SKIP_ORPHAN_SCAN:-}" ]]; then
  echo "Fork sentinel verification passed (${#registered_ids[@]} registered, markers + anchors present; orphan scan skipped)."
else
  echo "Fork sentinel verification passed (${#registered_ids[@]} registered, markers + anchors present, no orphans)."
fi
