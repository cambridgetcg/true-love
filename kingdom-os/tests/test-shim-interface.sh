#!/bin/sh
# ── test-shim-interface.sh ───────────────────────────────────────────
# Shim-facing contract for the reclaimed kingdom binaries. Bootstraps a
# temp citizen and asserts the 3 patched behaviors + the no-love-unlimited
# guard. Complements test-covenant-crypto.sh (primitive) and test-e2e.sh
# (full-suite, which needs the optional binaries not in this reclaim).
#
# Run:  sh kingdom-os/tests/test-shim-interface.sh
# Exit: 0 on all-pass, 1 on any failure.
# ─────────────────────────────────────────────────────────────────────
set -u
TOOLS="$(cd "$(dirname "$0")/../tools" && pwd)"
PASS=0; FAIL=0
ok()  { echo "  ✓ $1"; PASS=$((PASS+1)); }
bad() { echo "  ✗ $1" >&2; FAIL=$((FAIL+1)); }

WORK=$(mktemp -d)
HOME="$WORK/home"; mkdir -p "$HOME"
export HOME
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

# Bootstrap a temp citizen (the one sovereign act, done here under a throwaway
# HOME + agent name "tester" — never the real ~/.love/home).
sh "$TOOLS/kingdom-init" --agent tester --hostname tester-host >/dev/null 2>&1 \
  || { bad "kingdom-init failed"; echo "  pass=$PASS fail=$FAIL"; exit 2; }

# ── A. attest: --label sets purpose; last stdout line = .attest.json path ──
printf 'hello' > "$WORK/proof.txt"
OUT=$(sh "$TOOLS/kingdom-attest" "$WORK/proof.txt" --label mylabel 2>/dev/null)
LAST=$(printf '%s' "$OUT" | tail -n1)
BODY="$WORK/proof.txt.attest.json"
[ -f "$BODY" ] || bad "A: no .attest.json produced"
PURPOSE=$(sed -n 's/.*"purpose": *"\([^"]*\)".*/\1/p' "$BODY" 2>/dev/null | head -1)
[ "$PURPOSE" = "mylabel" ] && ok "A: --label sets purpose=mylabel" || bad "A: --label not recorded (got '$PURPOSE')"
[ "$LAST" = "$BODY" ] && ok "A: last stdout line is .attest.json path" || bad "A: last stdout line is '$LAST', want '$BODY'"

# ── B. doctor --json: top-level hostname matches covenant ──
COV_HOST=$(sed -n 's/.*"hostname": *"\([^"]*\)".*/\1/p' "$HOME/.love/home/covenant.json" 2>/dev/null | head -1)
DOC=$(sh "$TOOLS/kingdom-doctor" --json 2>/dev/null)
HN=$(printf '%s' "$DOC" | sed -n 's/.*"hostname": *"\([^"]*\)".*/\1/p' | head -1)
[ -n "$COV_HOST" ] && [ "$HN" = "$COV_HOST" ] && ok "B: doctor --json hostname=$HN (matches covenant)" || bad "B: doctor hostname '$HN' != covenant '$COV_HOST'"

# ── D. no love-unlimited anywhere in the vendored floor ──
HIT=$(grep -rl "love-unlimited" "$TOOLS" 2>/dev/null)
[ -z "$HIT" ] && ok "D: no 'love-unlimited' string in tools/" || bad "D: 'love-unlimited' still in: $HIT"

echo "── test-shim-interface ──"
echo "  pass=$PASS fail=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
exit 0