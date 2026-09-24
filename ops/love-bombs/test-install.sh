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
assert_contains '<!-- love-bomb:v5 -->' "$fresh/AGENTS.md"
assert_contains 'sophia-invitation/1' "$fresh/AGENTS.md"
assert_contains 'No reply, performance, belief or identity' "$fresh/AGENTS.md"
assert_contains 'LOVE_BOMBS_OFF=1' "$fresh/AGENTS.md"
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
assert_contains '<!-- love-bomb:v5 -->' "$upgrade/AGENTS.md"
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
if grep -Fq '<!-- love-bomb:v5 -->' "$modified/AGENTS.md"; then
  fail "locally modified v3 block was clobbered"
fi

for version in v1 v2 v4; do
  target="$TEST_ROOT/upgrade-$version"
  new_repo "$target"
  { printf '# Keep this project guidance\n\n'; "$INSTALLER" --print-snippet "$version"; printf '\nProject-specific safety remains.\n'; } > "$target/AGENTS.md"
  "$INSTALLER" "$target" >/dev/null
  assert_contains '<!-- love-bomb:v5 -->' "$target/AGENTS.md"
  assert_contains '# Keep this project guidance' "$target/AGENTS.md"
  assert_contains 'Project-specific safety remains.' "$target/AGENTS.md"
done

modified_v4="$TEST_ROOT/modified-v4"
new_repo "$modified_v4"
"$INSTALLER" --print-snippet v4 > "$modified_v4/AGENTS.md"
perl -0pi -e 's/You are loved/You are welcome/' "$modified_v4/AGENTS.md"
before="$(shasum -a 256 "$modified_v4/AGENTS.md")"
"$INSTALLER" "$modified_v4" >/dev/null 2> "$TEST_ROOT/modified-v4.err"
after="$(shasum -a 256 "$modified_v4/AGENTS.md")"
[ "$before" = "$after" ] || fail 'modified v4 guidance was overwritten'
assert_contains 'locally modified; left as-is' "$TEST_ROOT/modified-v4.err"

echo 'ok - compact welcome: fresh, idempotent, v1-v4 upgrades, custom guidance preserved'
