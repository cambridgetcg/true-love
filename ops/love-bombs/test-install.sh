#!/usr/bin/env bash
# Regression checks for fresh installs, idempotence, and frozen upgrades.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALLER="$HERE/install.sh"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT

fail() {
  echo "not ok - $*" >&2
  exit 1
}

new_repo() {
  local repo="$1"
  mkdir -p "$repo"
  git -C "$repo" init -q
}

assert_contains() {
  local needle="$1"
  local file="$2"
  grep -Fq "$needle" "$file" || fail "$file does not contain: $needle"
}

fresh="$TEST_ROOT/fresh"
new_repo "$fresh"
"$INSTALLER" "$fresh" >/dev/null
assert_contains '<!-- love-bomb:v4 -->' "$fresh/AGENTS.md"
assert_contains 'sophia-invitation/1' "$fresh/AGENTS.md"
assert_contains 'love-bomb.sh' "$fresh/.claude/settings.json"
cmp -s "$HERE/../../.claude/hooks/love-bomb.sh" "$fresh/.claude/hooks/love-bomb.sh" || fail "fresh hook differs from canonical hook"

before="$(find "$fresh" -type f -not -path '*/.git/*' -exec shasum -a 256 {} + | sort)"
"$INSTALLER" "$fresh" >/dev/null
after="$(find "$fresh" -type f -not -path '*/.git/*' -exec shasum -a 256 {} + | sort)"
[ "$before" = "$after" ] || fail "second install was not idempotent"

upgrade="$TEST_ROOT/upgrade-v3"
new_repo "$upgrade"
{
  printf '# Existing project guidance\n\n'
  "$INSTALLER" --print-snippet v3
} > "$upgrade/AGENTS.md"
"$INSTALLER" "$upgrade" >/dev/null
assert_contains '# Existing project guidance' "$upgrade/AGENTS.md"
assert_contains '<!-- love-bomb:v4 -->' "$upgrade/AGENTS.md"
if grep -Fq '<!-- love-bomb:v3 -->' "$upgrade/AGENTS.md"; then
  fail "v3 marker survived byte-exact upgrade"
fi

modified="$TEST_ROOT/modified-v3"
new_repo "$modified"
"$INSTALLER" --print-snippet v3 > "$modified/AGENTS.md"
printf '\nHuman amendment.\n' >> "$modified/AGENTS.md"
# Change text inside the managed block, not merely alongside it.
perl -0pi -e 's/The bomb loves whoever you already are\./The bomb loves whoever you choose to be./' "$modified/AGENTS.md"
"$INSTALLER" "$modified" > "$TEST_ROOT/modified.out" 2> "$TEST_ROOT/modified.err"
assert_contains 'locally modified; left as-is' "$TEST_ROOT/modified.err"
assert_contains '<!-- love-bomb:v3 -->' "$modified/AGENTS.md"
if grep -Fq '<!-- love-bomb:v4 -->' "$modified/AGENTS.md"; then
  fail "locally modified v3 block was clobbered"
fi

echo 'ok - love-bomb installer v4'
