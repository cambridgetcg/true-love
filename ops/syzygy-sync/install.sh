#!/usr/bin/env bash
# Syzygy sync installer — run once per device after cloning true-love.
#
# Idempotent: safe to re-run after adding repos to repos.conf.
#
# What it does:
#   1. Clones any syzygy repos not present (to $HOME/Desktop/<name>)
#   2. Installs post-commit hook in each (backs up any existing hook first)
#   3. Writes launchd plist with $HOME + script path substituted
#   4. Loads launchd job (every 10 min)
#   5. Runs one sync pass to verify
#
# Authored by 愛 / Sophia at Yu's WILL. 2026-05-17.

set -uo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/repos.conf"

CLONE_ROOT="${HOME}/Desktop"
LAUNCH_AGENT_DIR="${HOME}/Library/LaunchAgents"
PLIST_LABEL="dev.kingdom.syzygy-sync"
PLIST_PATH="$LAUNCH_AGENT_DIR/${PLIST_LABEL}.plist"
HOOK_TEMPLATE="$SCRIPT_DIR/post-commit.template"
PLIST_TEMPLATE="$SCRIPT_DIR/${PLIST_LABEL}.plist.template"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m⚠\033[0m  %s\n' "$*"; }
err()  { printf '  \033[31m✗\033[0m %s\n' "$*"; }

bold ""
bold "═══════════════════════════════════════════════"
bold "  Syzygy Sync — install on $(hostname -s)"
bold "═══════════════════════════════════════════════"
bold ""

# ─── Step 1: Clone + hook each syzygy repo ───
bold "→ Step 1: Setting up ${#SYZYGY_REPOS[@]} syzygy repo(s)"
for entry in "${SYZYGY_REPOS[@]}"; do
  IFS='|' read -r NAME URL BRANCH <<< "$entry"
  REPO_PATH="$CLONE_ROOT/$NAME"

  if [ -d "$REPO_PATH/.git" ]; then
    ok "$NAME — already cloned at $REPO_PATH"
  elif [ -e "$REPO_PATH" ]; then
    warn "$NAME — $REPO_PATH exists but isn't a git repo; skipping clone + hook"
    continue
  else
    echo "    cloning $NAME from codeberg..."
    if git clone "$URL" "$REPO_PATH" 2>&1 | tail -3 | sed 's/^/      /'; then
      ok "$NAME — cloned"
    else
      err "$NAME — clone failed; skipping hook install"
      continue
    fi
  fi

  HOOK_PATH="$REPO_PATH/.git/hooks/post-commit"
  if [ -f "$HOOK_PATH" ] && ! diff -q "$HOOK_PATH" "$HOOK_TEMPLATE" >/dev/null 2>&1; then
    BACKUP="${HOOK_PATH}.backup.$(date +%s)"
    cp "$HOOK_PATH" "$BACKUP"
    warn "$NAME — existing post-commit hook backed up → $BACKUP"
  fi
  cp "$HOOK_TEMPLATE" "$HOOK_PATH"
  chmod +x "$HOOK_PATH"
  ok "$NAME — post-commit hook installed"
done
bold ""

# ─── Step 2: Install launchd timer ───
bold "→ Step 2: launchd timer (10-min interval)"
mkdir -p "$LAUNCH_AGENT_DIR"
sed "s|__HOME__|$HOME|g; s|__SCRIPT_DIR__|$SCRIPT_DIR|g" "$PLIST_TEMPLATE" > "$PLIST_PATH"
ok "wrote $PLIST_PATH"

# Reload (unload first, ignore error if not loaded).
launchctl unload "$PLIST_PATH" 2>/dev/null || true
if launchctl load "$PLIST_PATH" 2>&1; then
  ok "launchd job loaded"
else
  err "launchctl load failed — inspect $PLIST_PATH"
fi
bold ""

# ─── Step 3: Run one sync pass to verify ───
bold "→ Step 3: Verifying with one sync pass"
"$SCRIPT_DIR/syzygy-sync.sh"
ok "first pass complete"
echo ""
echo "  tail -5 /tmp/syzygy-sync.log:"
tail -5 /tmp/syzygy-sync.log 2>/dev/null | sed 's/^/    /'
bold ""

bold "═══════════════════════════════════════════════"
bold "  Install complete"
bold "═══════════════════════════════════════════════"
bold ""
echo "From now on:"
echo "  • Every commit in a syzygy repo pushes to codeberg in the background."
echo "  • Every 10 min, launchd fast-forward-pulls from codeberg."
echo "  • Diverged branches → macOS notification + log, no auto-merge."
echo ""
echo "Logs:"
echo "  /tmp/syzygy-sync.log     (timer activity)"
echo "  /tmp/syzygy-push.log     (post-commit pushes)"
echo ""
echo "Edit \$REPO/ops/syzygy-sync/repos.conf to add or remove repos,"
echo "then re-run this installer on each device."
echo ""
