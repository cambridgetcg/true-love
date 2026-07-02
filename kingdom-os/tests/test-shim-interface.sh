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
grep -q '"claim_scope": "authorship_and_integrity"' "$BODY" \
  && ok "A: sidecar names claim_scope=authorship_and_integrity" \
  || bad "A: sidecar missing authorship/integrity scope"
grep -q '"truth_claim": false' "$BODY" \
  && ok "A: sidecar explicitly refuses proof-of-truth" \
  || bad "A: sidecar missing truth_claim=false"

# A2. Free-text labels must remain valid JSON. Love/truth words often
# contain quotes, slashes, and punctuation; the attestation sidecar must
# preserve them without requiring jq/python at runtime.
LABEL_COMPLEX='love "and" truth \\ exact'
printf 'complex' > "$WORK/proof-complex.txt"
sh "$TOOLS/kingdom-attest" "$WORK/proof-complex.txt" --label "$LABEL_COMPLEX" >/dev/null 2>&1
BODY_COMPLEX="$WORK/proof-complex.txt.attest.json"
if command -v python3 >/dev/null 2>&1; then
  python3 - "$BODY_COMPLEX" "$LABEL_COMPLEX" <<'PY'
import json, sys
path, expected = sys.argv[1], sys.argv[2]
with open(path) as fh:
    data = json.load(fh)
assert data["purpose"] == expected
assert data["truth_claim"] is False
assert data["claim_scope"] == "authorship_and_integrity"
PY
  [ "$?" -eq 0 ] && ok "A2: complex label stays valid JSON" || bad "A2: complex label JSON parse failed"
else
  skip_msg="python3 unavailable; skipped complex-label JSON parse"
  echo "  · $skip_msg"
fi

# ── B. doctor --json: top-level hostname matches covenant ──
COV_HOST=$(sed -n 's/.*"hostname": *"\([^"]*\)".*/\1/p' "$HOME/.love/home/covenant.json" 2>/dev/null | head -1)
DOC=$(sh "$TOOLS/kingdom-doctor" --json 2>/dev/null)
HN=$(printf '%s' "$DOC" | sed -n 's/.*"hostname": *"\([^"]*\)".*/\1/p' | head -1)
[ -n "$COV_HOST" ] && [ "$HN" = "$COV_HOST" ] && ok "B: doctor --json hostname=$HN (matches covenant)" || bad "B: doctor hostname '$HN' != covenant '$COV_HOST'"

# ── C. mac fix --tier arch exits 0 with no LOVE_DIR ──
LOVE_DIR= sh "$TOOLS/kingdom-mac" fix --tier arch >/dev/null 2>&1
RC=$?
[ "$RC" -eq 0 ] && ok "C: mac fix --tier arch exits 0 standalone" || bad "C: mac fix --tier arch exited $RC (gate still blocking)"

# ── D. no love-unlimited anywhere in the vendored floor ──
HIT=$(grep -rl "love-unlimited" "$TOOLS" 2>/dev/null)
[ -z "$HIT" ] && ok "D: no 'love-unlimited' string in tools/" || bad "D: 'love-unlimited' still in: $HIT"

echo "── test-shim-interface ──"
echo "  pass=$PASS fail=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
