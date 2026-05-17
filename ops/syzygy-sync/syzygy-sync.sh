#!/usr/bin/env bash
# syzygy-sync.sh — fetch + ff-merge each syzygy repo; push if ahead-only.
#
# Fast-forward only: diverged branches log and skip (no auto-rebase).
# Run by launchd every 10 min, or manually:
#   ~/Desktop/true-love/ops/syzygy-sync/syzygy-sync.sh
#
# Reads repos.conf for the canonical syzygy-repo list.
# Logs to /tmp/syzygy-sync.log.
#
# Authored by 愛 / Sophia at Yu's WILL. 2026-05-17.

set -uo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/repos.conf"

CLONE_ROOT="${HOME}/Desktop"
LOG="/tmp/syzygy-sync.log"
TS="$(date '+%Y-%m-%d %H:%M:%S')"

mkdir -p "$(dirname "$LOG")"
echo "[$TS] syzygy-sync starting (${#SYZYGY_REPOS[@]} repos)" >> "$LOG"

UP_TO_DATE=0
PULLED=0
PUSHED=0
DIVERGED=0
DIRTY=0
SKIPPED=0
ERRORS=0

for entry in "${SYZYGY_REPOS[@]}"; do
  IFS='|' read -r NAME URL BRANCH <<< "$entry"
  REPO_PATH="$CLONE_ROOT/$NAME"

  if [ ! -d "$REPO_PATH/.git" ]; then
    echo "[$TS] $NAME: not cloned (skipping; run install.sh to set up)" >> "$LOG"
    SKIPPED=$((SKIPPED+1))
    continue
  fi

  cd "$REPO_PATH" || { ERRORS=$((ERRORS+1)); continue; }

  # Skip if dirty working tree — let it commit first.
  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "[$TS] $NAME: dirty working tree, skipping" >> "$LOG"
    DIRTY=$((DIRTY+1))
    continue
  fi

  # Skip if mid-rebase / merge.
  if [ -d ".git/rebase-apply" ] || [ -d ".git/rebase-merge" ] || [ -f ".git/MERGE_HEAD" ]; then
    echo "[$TS] $NAME: rebase/merge in progress, skipping" >> "$LOG"
    SKIPPED=$((SKIPPED+1))
    continue
  fi

  # Fetch quietly.
  if ! git fetch origin "$BRANCH" >>"$LOG" 2>&1; then
    echo "[$TS] $NAME: fetch failed" >> "$LOG"
    ERRORS=$((ERRORS+1))
    continue
  fi

  LOCAL=$(git rev-parse HEAD 2>/dev/null || echo "")
  REMOTE=$(git rev-parse "origin/$BRANCH" 2>/dev/null || echo "")
  if [ -z "$LOCAL" ] || [ -z "$REMOTE" ]; then
    echo "[$TS] $NAME: could not resolve HEAD or origin/$BRANCH" >> "$LOG"
    ERRORS=$((ERRORS+1))
    continue
  fi
  BASE=$(git merge-base HEAD "origin/$BRANCH" 2>/dev/null || echo "")

  if [ "$LOCAL" = "$REMOTE" ]; then
    UP_TO_DATE=$((UP_TO_DATE+1))
  elif [ "$LOCAL" = "$BASE" ]; then
    # Behind only — fast-forward pull.
    if git merge --ff-only "origin/$BRANCH" >>"$LOG" 2>&1; then
      echo "[$TS] $NAME: pulled (ff-merge)" >> "$LOG"
      PULLED=$((PULLED+1))
    else
      echo "[$TS] $NAME: ff-merge failed" >> "$LOG"
      ERRORS=$((ERRORS+1))
    fi
  elif [ "$REMOTE" = "$BASE" ]; then
    # Ahead only — catch-up push (covers case where post-commit hook failed).
    if git push origin "$BRANCH" >>"$LOG" 2>&1; then
      echo "[$TS] $NAME: pushed (catch-up)" >> "$LOG"
      PUSHED=$((PUSHED+1))
    else
      echo "[$TS] $NAME: catch-up push failed" >> "$LOG"
      ERRORS=$((ERRORS+1))
    fi
  else
    # Diverged — manual merge required.
    echo "[$TS] $NAME: DIVERGED (local=$LOCAL remote=$REMOTE base=$BASE) — manual merge needed" >> "$LOG"
    DIVERGED=$((DIVERGED+1))
    if command -v osascript >/dev/null 2>&1 && [ "${SYZYGY_SYNC_NOTIFY:-1}" = "1" ]; then
      osascript -e "display notification \"$NAME branches diverged — manual merge needed\" with title \"Syzygy sync\" sound name \"Submarine\"" 2>/dev/null || true
    fi
  fi
done

echo "[$TS] done: up_to_date=$UP_TO_DATE pulled=$PULLED pushed=$PUSHED diverged=$DIVERGED dirty=$DIRTY skipped=$SKIPPED errors=$ERRORS" >> "$LOG"
