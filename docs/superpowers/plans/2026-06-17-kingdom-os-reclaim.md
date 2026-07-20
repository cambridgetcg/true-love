# Kingdom OS Reclaim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reclaim the 6 quarantined Kingdom OS crypto binaries + 2 tests from the Trash, sever the Sophia costume, vendor them into `true-love/kingdom-os/`, patch them to match the already-wired (dormant) integration shim, and relight — without re-introducing "proof."

**Architecture:** The true-love integration (`kingdom-citizen.ts` + four `runner.ts` wire-points + `autonomy.ts` threading + `memory.ts#getOwnDailyMemoryFile` + shim test) is DONE and dormant since 2026-05-29, when the substrate was quarantined as a costume. We reclaim the floor (6 self-contained POSIX shell binaries, ~3,100 lines, no shared modules, no Sophia by name), apply 3 interface patches + 4 cosmetic strips, and make the shim self-locate the vendored floor. Yu then runs `kingdom init --agent <name>` (his sovereign act) and we verify. The persona↔crypto bridge (`kingdom-soul`) stays in the Trash.

**Tech Stack:** POSIX `sh` binaries (OpenSSH ≥8.0 `ssh-keygen -Y sign/verify`, `sha256sum`/`shasum`, `jq` optional); TypeScript shim + `bun test`; true-love repo on `main` with syzygy-sync (commits auto-push to codeberg — commit only the files you intend).

**Spec:** `docs/superpowers/specs/2026-06-17-kingdom-os-reclaim-design.md` (commit `335e442`).

## Global Constraints

- **Sever "love-unlimited":** after all strips, the string `love-unlimited` must not appear in any reclaimed file under `true-love/kingdom-os/`. Verified by Task 5's grep guard.
- **OpenSSH ≥8.0** required (`ssh-keygen -Y sign/verify`). macOS ships 9.x since Ventura — satisfied on this machine. `test-covenant-crypto.sh` asserts it.
- **Take `tools/kingdom` (145-line substrate dispatcher), NOT root `kingdom` (610-line empire dispatcher).** Same name, different binary. The vendored layout (only `tools/kingdom` is copied) makes this structurally impossible — confirmed in Task 1.
- **The shim calls sub-binaries directly** (`kingdom-doctor`, `kingdom-pulse`, `kingdom-attest`, `kingdom-mac`, `kingdom-init`) via `findKingdomBin(<name>)` → `kingdom-<name>`. The `kingdom` dispatcher is included for human CLI use only; the shim does not call it.
- **No proof:** attestation is authorship/tamper-evidence, not truth-legitimacy. Do not add any "verified-true" assertion. The citizen block stays identity/continuity only.
- **Auto-init is rejected.** Do not run `kingdom init` in any automated task. Only Yu inits, with his chosen name, in the final handoff.
- **All work happens in the true-love repo** (`/Users/yuai/Desktop/true-love`, branch `main`). Source binaries are read-only in the Trash; copy them out, do not mutate the Trash.
- **Commit per task**, only the files that task touched. The pre-existing ` M .gitignore` in the working tree is not ours — never `git add -a`/`git commit -am`; stage explicit paths.

---

## File Structure

**Created (reclaimed from Trash → vendored):**
- `kingdom-os/tools/kingdom` — substrate dispatcher (145, copied unchanged; human CLI use)
- `kingdom-os/tools/kingdom-init` — bootstrap `~/.love/home/` (193; `repo_url` stripped)
- `kingdom-os/tools/kingdom-doctor` — introspection (434; +`hostname` patch, −attestation `find`)
- `kingdom-os/tools/kingdom-pulse` — signed freshness (132; copied unchanged)
- `kingdom-os/tools/kingdom-attest` — soul-sign a file (177; +`--label` + output-line patch, −`--memory-today`)
- `kingdom-os/tools/kingdom-mac` — macOS doctor/fix (2023; −hard gate, +auto-tier plist guard, −`LOVE_DIR` checks)
- `kingdom-os/tests/test-covenant-crypto.sh` — primitive round-trip (path-tweaked)
- `kingdom-os/tests/test-e2e.sh` — 12-phase e2e (path-tweaked)
- `kingdom-os/tests/test-shim-interface.sh` — NEW: the shim-facing contract (3 patches + strip guard)

**Modified (existing true-love integration):**
- `src/services/love/kingdom-citizen.ts` — add co-located auto-locate at module load; drop `~/love-unlimited/tools/` fallback + unused `homedir` import
- `src/services/love/__tests__/kingdom-citizen.test.ts` — add auto-locate test; confirm fallback removed

**Untouched:** `runner.ts`, `autonomy.ts`, `memory.ts` (the wire-points are already done).

**Trash (read-only source, leave behind):** `kingdom-soul`, root `kingdom`, `kingdom-os/` installer tree, `SOPHIA.md`, `SOUL.md`, all persona/empire files.

---

## Task 1: Reclaim the 6 binaries + 2 tests from Trash

**Files:**
- Create: `kingdom-os/tools/{kingdom,kingdom-init,kingdom-doctor,kingdom-pulse,kingdom-attest,kingdom-mac}`
- Create: `kingdom-os/tests/{test-covenant-crypto.sh,test-e2e.sh}`
- Source (read-only): `~/.Trash/.quarantine-costumes-2026-05-29/love-unlimited/{tools/kingdom-*,kingdom-os/test-*.sh}`

**Interfaces:** Produces the vendored floor at `kingdom-os/tools/` for Tasks 2–6.

- [ ] **Step 1: Create the vendored dirs and copy the 6 binaries**

```sh
cd /Users/yuai/Desktop/true-love
SRC=~/.Trash/.quarantine-costumes-2026-05-29/love-unlimited
mkdir -p kingdom-os/tools kingdom-os/tests
for b in kingdom kingdom-init kingdom-doctor kingdom-pulse kingdom-attest kingdom-mac; do
  cp "$SRC/tools/$b" "kingdom-os/tools/$b"
  chmod +x "kingdom-os/tools/$b"
done
cp "$SRC/kingdom-os/test-covenant-crypto.sh" kingdom-os/tests/test-covenant-crypto.sh
cp "$SRC/kingdom-os/test-e2e.sh"            kingdom-os/tests/test-e2e.sh
chmod +x kingdom-os/tests/*.sh
```

- [ ] **Step 2: Confirm the hazard is avoided — only the substrate dispatcher is vendored**

Run: `ls kingdom-os/tools/` and `head -5 kingdom-os/tools/kingdom`
Expected: 6 files; `kingdom` first line is `#!/bin/sh` and its help/recite dispatcher (≈145 lines, `wc -l kingdom-os/tools/kingdom` → 145), NOT the 610-line empire dispatcher. Verify: `wc -l kingdom-os/tools/kingdom` shows ~145, not ~610.

- [ ] **Step 3: Fix the test scripts' REPO_DIR/TOOLS to the vendored dir**

Both tests compute `REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"; TOOLS="${REPO_DIR}/tools"`. With the new layout (`kingdom-os/tests/` → `..` = `kingdom-os/` → `tools/`), the existing logic already resolves correctly. Confirm by inspection:

Run: `grep -n 'REPO_DIR=\|TOOLS=' kingdom-os/tests/test-e2e.sh kingdom-os/tests/test-covenant-crypto.sh`
Expected: `REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"` (or similar) and `TOOLS="${REPO_DIR}/tools"`. If a test instead hardcodes `$LOVE_DIR` or a love-unlimited path, edit it to use `TOOLS`/`REPO_DIR` only. No edit needed if it already resolves relatively.

- [ ] **Step 4: Run the primitive crypto round-trip test**

Run: `sh kingdom-os/tests/test-covenant-crypto.sh`
Expected: PASS (tests `ssh-keygen -Y sign/verify` primitive in a temp dir; unaffected by the patches). If it fails on OpenSSH version, confirm `ssh -V` ≥ 8.0.

- [ ] **Step 5: Run the 12-phase e2e test (baseline before patches)**

Run: `sh kingdom-os/tests/test-e2e.sh`
Expected: PASS (the e2e does not assert the shim-contract gaps — `--label`, `doctor hostname`, `mac-fix-gate` — so it should pass on the unpatched binaries). Note any failure for the relevant Task 2–4 to address; failures in unrelated phases (trust/cosign/announce/receive/witnesses/export/import/rebind using the 8 optional binaries NOT vendored) are expected — record them as known-unreclaimed, do not fix.

- [ ] **Step 6: Commit**

```sh
git add kingdom-os/
git commit -m "feat(kingdom-os): reclaim crypto substrate from Trash — 6 binaries + 2 tests" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: Patch `kingdom-attest` (+`--label`, output line) and strip `--memory-today`

**Files:**
- Modify: `kingdom-os/tools/kingdom-attest` (arg parse L41–58, attest body L96–106, stdout L122–128, usage L31/L61–62)
- Test: `kingdom-os/tests/test-shim-interface.sh` (NEW — attest assertions)

**Interfaces:** Produces `kingdom-attest` matching the shim's `kingdomAttest(filePath, label?)` contract: `--label` sets a `purpose` field; last stdout line is the `.attest.json` path.

- [ ] **Step 1: Write the failing test — create `test-shim-interface.sh` with attest assertions**

Create `kingdom-os/tests/test-shim-interface.sh`:
```sh
#!/bin/sh
# Shim-facing contract for the reclaimed kingdom binaries. Bootstraps a temp
# citizen and asserts the 3 patched behaviors + the no-love-unlimited guard.
# Run: sh kingdom-os/tests/test-shim-interface.sh
set -u
TOOLS="$(cd "$(dirname "$0")/../tools" && pwd)"
PASS=0; FAIL=0
ok()   { echo "  ✓ $1"; PASS=$((PASS+1)); }
bad()  { echo "  ✗ $1" >&2; FAIL=$((FAIL+1)); }

WORK=$(mktemp -d)
HOME="$WORK/home"; mkdir -p "$HOME"
export HOME
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

# Bootstrap a temp citizen
sh "$TOOLS/kingdom-init" --agent tester --hostname tester-host >/dev/null 2>&1 || { bad "kingdom-init failed"; exit 2; }

# ── A. attest: --label + last line = .attest.json path ──
printf 'hello' > "$WORK/proof.txt"
OUT=$(sh "$TOOLS/kingdom-attest" "$WORK/proof.txt" --label mylabel 2>/dev/null)
LAST=$(printf '%s' "$OUT" | tail -n1)
BODY="$WORK/proof.txt.attest.json"
[ -f "$BODY" ] || bad "A: no .attest.json produced"
PURPOSE=$(sed -n 's/.*"purpose": *"\([^"]*\)".*/\1/p' "$BODY" 2>/dev/null | head -1)
[ "$PURPOSE" = "mylabel" ] && ok "A: --label sets purpose=mylabel" || bad "A: --label not recorded (got '$PURPOSE')"
[ "$LAST" = "$BODY" ] && ok "A: last stdout line is .attest.json path" || bad "A: last stdout line is '$LAST', want '$BODY'"

# ── D. no love-unlimited anywhere in the vendored floor ──
HIT=$(grep -rl "love-unlimited" "$TOOLS" 2>/dev/null)
[ -z "$HIT" ] && ok "D: no 'love-unlimited' string in tools/" || bad "D: 'love-unlimited' still in: $HIT"

echo "── test-shim-interface ──"
echo "  pass=$PASS fail=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
```
Mark it executable: `chmod +x kingdom-os/tests/test-shim-interface.sh`.

- [ ] **Step 2: Run test to verify it fails**

Run: `sh kingdom-os/tests/test-shim-interface.sh`
Expected: FAIL — A assertions fail (`--label` not recognized → no `purpose`; last line is the `.sig` path, not `.attest.json`). D may also fail (attest still references `love-unlimited` via `--memory-today`).

- [ ] **Step 3: Patch `kingdom-attest` — add `--label`, add `purpose` field, fix output line**

In `kingdom-os/tools/kingdom-attest`:

(a) Add a `LABEL` variable and parse `--label`. Near the top (after `MODE="attest"` / `FILE=""`, before the `while` loop), add:
```sh
LABEL=""
```
In the `case` (L41–58), add a branch (before the `-h|--help)` branch):
```sh
    --label)         LABEL="$2"; shift 2 ;;
```

(b) Drop the `--memory-today` branch (L44–48) — remove:
```sh
    --memory-today)
      TODAY=$(date -u +%Y-%m-%d)
      FILE="${LOVE_DIR:-${HOME}/love-unlimited}/memory/daily/${TODAY}.md"
      shift
      ;;
```

(c) Add `"purpose"` to the attest body. In the heredoc (L97–106), add the line after `"attested_at"`:
```sh
  "attested_at": "${ATTESTED_AT}",
  "purpose": "${LABEL}"
```

(d) Fix the output line. Replace the stdout block (L122–128) so the **last** line is the bare `.attest.json` path:
```sh
  echo "── kingdom attest ──"
  echo "  file:        $FILE"
  echo "  hash:        $HASH"
  echo "  attestor:    $ATTESTOR"
  echo "  attested_at: $ATTESTED_AT"
  echo "  sidecar:     $ATTEST_BODY"
  echo "  signature:   $ATTEST_SIG"
  echo "$ATTEST_BODY"
```

(e) Remove the `--memory-today` mention from the usage lines (L31 and L61–62) so no `love-unlimited` string remains:
- L31: delete the `#   kingdom attest --memory-today ...` comment line.
- L61–62: change the usage block to drop the `--memory-today` line:
```sh
if [ -z "$FILE" ]; then
  echo "Usage: kingdom attest <file>  |  kingdom attest --verify <file>" >&2
  exit 1
fi
```

- [ ] **Step 4: Run test to verify A + D (attest parts) pass**

Run: `sh kingdom-os/tests/test-shim-interface.sh`
Expected: A assertions PASS; D may still fail if other binaries still reference `love-unlimited` (doctor/mac/init — fixed in Tasks 3–5). Acceptable to leave D failing until Task 5.

- [ ] **Step 5: Re-run e2e attest phase sanity**

Run: `sh kingdom-os/tests/test-e2e.sh 2>&1 | tail -5`
Expected: still passes (attest phase uses `<file>` form, unaffected by `--label` addition).

- [ ] **Step 6: Commit**

```sh
git add kingdom-os/tools/kingdom-attest kingdom-os/tests/test-shim-interface.sh
git commit -m "feat(kingdom-attest): +--label +purpose, last line=.attest.json; drop --memory-today" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: Patch `kingdom-doctor` (+`hostname`) and strip the attestation `find`

**Files:**
- Modify: `kingdom-os/tools/kingdom-doctor` (read hostname near L94; JSON block L319–360; drop attestation `find` L188–195)
- Test: `kingdom-os/tests/test-shim-interface.sh` (append doctor assertions)

**Interfaces:** Produces `kingdom doctor --json` with a top-level `hostname` field (the shim's `CitizenState.hostname` reads `parsed.hostname`).

- [ ] **Step 1: Append the failing doctor assertion to `test-shim-interface.sh`**

Add before the `# ── D.` block:
```sh
# ── B. doctor --json: top-level hostname ──
DOC=$(sh "$TOOLS/kingdom-doctor" --json 2>/dev/null)
HN=$(printf '%s' "$DOC" | sed -n 's/.*"hostname": *"\([^"]*\)".*/\1/p' | head -1)
[ "$HN" = "tester-host" ] && ok "B: doctor --json has hostname=tester-host" || bad "B: doctor --json hostname is '$HN', want 'tester-host'"
```
(Uses `sed` so no `jq` dependency; the top-level `hostname` is the first `"hostname":` match.)

- [ ] **Step 2: Run test to verify B fails**

Run: `sh kingdom-os/tests/test-shim-interface.sh`
Expected: B FAILS (no top-level `hostname` in doctor JSON today).

- [ ] **Step 3: Patch `kingdom-doctor` — read hostname, add to JSON**

(a) Read `hostname` from covenant. Near the existing `AGENT_ID=$(read_field agent_id "$COVENANT")` (L94), add:
```sh
  ID_HOSTNAME=$(read_field hostname "$COVENANT" 2>/dev/null || true)
  ID_HOSTNAME="${ID_HOSTNAME:-}"
```
(Place it adjacent to the other `ID_*` covenant reads so the variable is populated before the JSON block.)

(b) Add a top-level `hostname` to the JSON output (L319–360). In the heredoc, add it right after the `"exit"` line:
```sh
{
  "exit": ${EXIT_CODE},
  "hostname": "${ID_HOSTNAME}",
  "identity": {
```

(c) Drop the attestation-count `LOVE_DIR` `find` (L188–195). Replace the block:
```sh
ATTEST_COUNT=0
LOVE_DIR_GUESS="${LOVE_DIR:-${HOME}/love-unlimited}"
if [ -d "$LOVE_DIR_GUESS" ]; then
  ATTEST_COUNT=$(find "$LOVE_DIR_GUESS" -maxdepth 4 -name "*.attest.json" -type f 2>/dev/null | wc -l | tr -d ' ')
fi
```
with:
```sh
ATTEST_COUNT=0
```
Leave the subsequent `if [ "$ATTEST_COUNT" -gt 0 ]...` block intact (it now always sees 0, which is correct for the standalone floor).

- [ ] **Step 4: Run test to verify B passes**

Run: `sh kingdom-os/tests/test-shim-interface.sh`
Expected: B PASS. (D may still fail until Tasks 4–5.)

- [ ] **Step 5: Re-run e2e doctor phase sanity**

Run: `sh kingdom-os/tests/test-e2e.sh 2>&1 | tail -5`
Expected: still passes.

- [ ] **Step 6: Commit**

```sh
git add kingdom-os/tools/kingdom-doctor kingdom-os/tests/test-shim-interface.sh
git commit -m "feat(kingdom-doctor): +top-level hostname in --json; drop LOVE_DIR attestation find" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: Patch `kingdom-mac` (remove hard gate + guard auto-tier) and strip `LOVE_DIR` checks

**Files:**
- Modify: `kingdom-os/tools/kingdom-mac` (gate L429–438; auto-tier plist regen ≈L478–583 guarded; plist-drift L158–173 / Spotlight L303–308 left as no-ops are fine but verify no `love-unlimited` string leaks)
- Test: `kingdom-os/tests/test-shim-interface.sh` (append mac assertion)

**Interfaces:** Produces `kingdom mac fix --tier auto` that runs standalone (no `LOVE_DIR`), so the shim's preflight `kingdomMacFix({tier:'auto'})` succeeds on a fresh machine.

- [ ] **Step 1: Append the failing mac assertion to `test-shim-interface.sh`**

Add before the `# ── D.` block:
```sh
# ── C. mac fix --tier arch exits 0 with no LOVE_DIR ──
LOVE_DIR= sh "$TOOLS/kingdom-mac" fix --tier arch >/dev/null 2>&1
RC=$?
[ "$RC" -eq 0 ] && ok "C: mac fix --tier arch exits 0 standalone" || bad "C: mac fix --tier arch exited $RC (gate still blocking)"
```

- [ ] **Step 2: Run test to verify C fails**

Run: `sh kingdom-os/tests/test-shim-interface.sh`
Expected: C FAILS (the gate at L429–438 refuses all tiers when `LOVE_DIR_GUESS` is empty).

- [ ] **Step 3: Patch `kingdom-mac` — remove the hard gate**

Read the gate block first to confirm exact lines:
Run: `sed -n '425,445p' kingdom-os/tools/kingdom-mac`

Remove the gate (the `if [ -z "$LOVE_DIR_GUESS" ]; then ... fi` that prints "cannot find love-unlimited directory" and the `HEARTBEAT_RUNNER` check that prints "heartbeat-runner.sh not found"). After removal, `do_fix()` proceeds to tier dispatch without refusing. The `--tier arch` (print-only relocation suggestion) and `--tier sudo` (print-only) then run with empty `LOVE_DIR_GUESS` and exit 0 (their `case "$LOVE_DIR_GUESS" in */Desktop/Love/*)` matches nothing → no output → exit 0).

- [ ] **Step 4: Patch `kingdom-mac` — guard the auto-tier plist regeneration**

The `--tier auto` body regenerates heartbeat plists pointing at `$LOVE_DIR_GUESS/tools/heartbeat-runner.sh` and writes `LOVE_HOME=$LOVE_DIR_GUESS` to `~/.kingdom_profile` (≈L478–583). With the gate gone, `--tier auto` would generate plists pointing at a nonexistent runner when `LOVE_DIR_GUESS` is empty.

Read the auto body:
Run: `sed -n '478,585p' kingdom-os/tools/kingdom-mac`

Wrap the heartbeat-plist-generation + `LOVE_HOME` write in a guard so it only runs when the runner actually exists:
```sh
if [ -n "$LOVE_DIR_GUESS" ] && [ -f "${LOVE_DIR_GUESS}/tools/heartbeat-runner.sh" ]; then
  # …existing plist-regen + LOVE_HOME write…
fi
```
Leave the other auto-tier fixes (PATH, `~/.kingdom_profile` base, etc.) running unconditionally if they don't depend on `LOVE_DIR_GUESS`. The goal: `--tier auto` with empty `LOVE_DIR_GUESS` applies the safe non-plist fixes and skips plist regen, exiting 0.

- [ ] **Step 5: Run test to verify C passes**

Run: `sh kingdom-os/tests/test-shim-interface.sh`
Expected: C PASS. (D may still fail until Task 5 strips `kingdom-init`.)

- [ ] **Step 6: Verify `mac doctor --json` still standalone + no crash**

Run: `LOVE_DIR= sh kingdom-os/tools/kingdom-mac doctor --json 2>&1 | head -3`
Expected: valid JSON with `"love_dir":""` and no error. (`mac doctor` already ran standalone; this confirms the patch didn't break it.)

- [ ] **Step 7: Commit**

```sh
git add kingdom-os/tools/kingdom-mac kingdom-os/tests/test-shim-interface.sh
git commit -m "fix(kingdom-mac): remove LOVE_DIR hard gate; guard auto-tier plist regen for standalone" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: Strip `kingdom-init` `repo_url`; verify no `love-unlimited` remains

**Files:**
- Modify: `kingdom-os/tools/kingdom-init` (L157 `repo_url`)
- Test: `kingdom-os/tests/test-shim-interface.sh` (D assertion now must pass)

**Interfaces:** Completes the costume severance — no `love-unlimited` string in the vendored floor.

- [ ] **Step 1: Patch `kingdom-init` — blank `repo_url`**

In `kingdom-os/tools/kingdom-init`, the covenant heredoc (L157) has:
```sh
  "repo_url": "https://github.com/cambridgetcg/love-unlimited.git",
```
Change to:
```sh
  "repo_url": "",
```

- [ ] **Step 2: Run the full shim-interface test — D must now pass**

Run: `sh kingdom-os/tests/test-shim-interface.sh`
Expected: ALL PASS (A, B, C, D). D's grep finds no `love-unlimited` in `kingdom-os/tools/`.

- [ ] **Step 3: Cross-check no `love-unlimited` anywhere in the vendored floor**

Run: `grep -rn "love-unlimited" kingdom-os/ || echo "CLEAN"`
Expected: `CLEAN`.

- [ ] **Step 4: Run all three vendored test suites**

Run: `sh kingdom-os/tests/test-covenant-crypto.sh && sh kingdom-os/tests/test-e2e.sh && sh kingdom-os/tests/test-shim-interface.sh`
Expected: all PASS (e2e may show known-unreclaimed-phase skips for the 8 optional binaries — acceptable; record but don't fix).

- [ ] **Step 5: Commit**

```sh
git add kingdom-os/tools/kingdom-init kingdom-os/tests/test-shim-interface.sh
git commit -m "chore(kingdom-init): blank repo_url — sever love-unlimited from covenant" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: Wire the shim — co-located auto-locate + drop `~/love-unlimited/tools/` fallback

**Files:**
- Modify: `src/services/love/kingdom-citizen.ts` (imports; module-load auto-locate; `findKingdomBin` fallback L50–52)
- Test: `src/services/love/__tests__/kingdom-citizen.test.ts` (add auto-locate test)

**Interfaces:** Produces a shim that finds the vendored floor at `true-love/kingdom-os/tools/` without runtime env wiring; tests still override via `TRUE_LOVE_KINGDOM_BIN_DIR`.

- [ ] **Step 1: Write the failing test — auto-locate + fallback-removed**

Add to `src/services/love/__tests__/kingdom-citizen.test.ts`:
```ts
import { existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

test('auto-locates the vendored kingdom floor when no explicit bin dir is set', () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
  const vendored = join(repoRoot, 'kingdom-os', 'tools')
  if (!existsSync(vendored)) return // skip when floor not yet vendored
  // The module-load auto-locate sets the env when vendored is present and env unset.
  // Clear the override to observe auto-locate, then restore.
  const saved = process.env.TRUE_LOVE_KINGDOM_BIN_DIR
  delete process.env.TRUE_LOVE_KINGDOM_BIN_DIR
  // Re-import to trigger module-load auto-locate.
  jest.resetModules?.() ?? void 0
  // bun test: use a fresh dynamic import
  void import('../kingdom-citizen.ts').then((m) => {
    const bin = m.findKingdomBin('doctor')
    expect(bin).toBe(join(vendored, 'kingdom-doctor'))
    process.env.TRUE_LOVE_KINGDOM_BIN_DIR = saved
  })
})

test('~/love-unlimited/tools/ is no longer a fallback', () => {
  // With env pointing at a tmpdir that has NO kingdom-doctor, findKingdomBin
  // must return null (not fall back to ~/love-unlimited/tools/).
  const saved = process.env.TRUE_LOVE_KINGDOM_BIN_DIR
  const tmp = await mkdtemp(join(tmpdir(), 'kg-'))
  process.env.TRUE_LOVE_KINGDOM_BIN_DIR = tmp
  expect(findKingdomBin('doctor')).toBeNull()
  process.env.TRUE_LOVE_KINGDOM_BIN_DIR = saved
})
```
(Adjust to the file's existing test style — `bun test` with top-level `await` is fine. If the file uses a different import pattern, mirror it. The second test must be `async` for `await mkdtemp`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/services/love/__tests__/kingdom-citizen.test.ts`
Expected: FAIL — auto-locate test fails (env not set; fallback still present → the no-fallback test fails because `~/love-unlimited/tools/` may resolve or the shim still has the fallback).

- [ ] **Step 3: Patch the shim — imports + module-load auto-locate**

In `src/services/love/kingdom-citizen.ts`, update the imports (currently `spawn`, `existsSync`, `homedir`, `join`):
```ts
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
```
(Remove `homedir` — no longer used after the fallback is dropped. `join` stays; add `resolve, dirname, fileURLToPath`.)

Immediately after the imports (before `type KingdomBin`), add the auto-locate:
```ts
// Auto-locate the vendored kingdom floor (true-love/kingdom-os/tools/) unless an
// explicit bin dir was already provided (tests / manual escape hatch). Three
// '..' from this module (src/services/love/) reaches the true-love repo root —
// the same pattern auto-update.ts uses. In the bundled-dist case the path
// won't resolve and the shim degrades gracefully (kingdom unavailable).
if (!process.env.TRUE_LOVE_KINGDOM_BIN_DIR) {
  try {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
    const vendored = join(repoRoot, 'kingdom-os', 'tools')
    if (existsSync(vendored)) process.env.TRUE_LOVE_KINGDOM_BIN_DIR = vendored
  } catch { /* leave unset → isKingdomAvailable() returns false */ }
}
```

- [ ] **Step 4: Patch the shim — drop the `~/love-unlimited/tools/` fallback**

In `findKingdomBin`, remove the fallback block (≈L50–52):
```ts
  // 3. ~/love-unlimited/tools/ canonical home
  const fallback = join(homedir(), 'love-unlimited', 'tools', fileName)
  if (existsSync(fallback)) return fallback
```
Resolution is now: env (auto-set to vendored, or test override) → PATH → null.

- [ ] **Step 5: Run the shim unit tests**

Run: `bun test src/services/love/__tests__/kingdom-citizen.test.ts`
Expected: ALL PASS, including the two new tests. If the existing "not available" test now fails because the auto-locate pre-set the env, ensure that test sets `TRUE_LOVE_KINGDOM_BIN_DIR` to an empty tmpdir explicitly (it already uses `STUB_KINGDOM_BIN`/tmpdir) — confirm and adjust the assertion comment, not the behavior.

- [ ] **Step 6: Run the full test suite + typecheck**

Run: `bun test src/ && bun run typecheck`
Expected: PASS / no type errors. (The `homedir` import removal must not leave a dangling reference — `bun run typecheck` confirms.)

- [ ] **Step 7: Commit**

```sh
git add src/services/love/kingdom-citizen.ts src/services/love/__tests__/kingdom-citizen.test.ts
git commit -m "feat(kingdom-citizen): auto-locate vendored floor; drop ~/love-unlimited/tools/ fallback" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: Full automated verify + handoff to Yu for init + session smoke

**Files:** none modified — verification + handoff note.

**Interfaces:** Confirms the reclaim is complete and ready for Yu's sovereign init.

- [ ] **Step 1: Run every automated suite green**

Run:
```sh
cd /Users/yuai/Desktop/true-love
sh kingdom-os/tests/test-covenant-crypto.sh
sh kingdom-os/tests/test-shim-interface.sh
bun test src/services/love/__tests__/kingdom-citizen.test.ts
bun run typecheck
```
Expected: all PASS. (`test-e2e.sh` is optional here — its unreclaimed optional-binary phases are known-skips.)

- [ ] **Step 2: Confirm the shim sees the floor (no init yet → "not initialised")**

Run: `TRUE_LOVE_SKIP_KINGDOM= bun run awaken --max-ticks=0 2>&1 | grep -i kingdom | head`
Expected: a line like `— kingdom: not initialised (run \`kingdom init --agent <name>\` to bootstrap)` — proving the shim resolves the vendored binaries (kingdom IS available) but `~/.love/home/` doesn't exist yet. (If it instead says "not available", the auto-locate didn't fire — recheck Task 6.)

- [ ] **Step 3: Commit the final state if any cleanup remains**

If Steps 1–2 needed no code change, this task adds no commit. Otherwise commit the cleanup:
```sh
git add -p   # stage only the cleanup
git commit -m "chore(kingdom-os): post-reclaim verification cleanup" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

- [ ] **Step 4: Hand off to Yu — the sovereign init + session smoke**

Present to Yu (do not run these — the agent name is his to choose):
```
The floor is reclaimed, patched, vendored, and wired. The shim resolves it.
Your move — the one the spec keeps yours:

  kingdom-os/tools/kingdom init --agent <name>      # choose the citizen name
  # then, with ~/.love/home/ populated:
  kingdom-os/tools/kingdom doctor --json            # identity.ok = "yes"
  kingdom-os/tools/kingdom pulse                     # pulse.json + .sig
  echo hi > /tmp/proof && kingdom-os/tools/kingdom attest /tmp/proof --label smoke
  kingdom-os/tools/kingdom mac doctor --json        # standalone, love_dir ""
  kingdom-os/tools/kingdom mac fix --tier auto      # runs without LOVE_DIR
  bun run awaken --max-ticks=1                       # citizen line + pulse + at-rest attestation
  TRUE_LOVE_SKIP_KINGDOM=1 bun run awaken --max-ticks=1   # clean degrade

After init, the April integration relights: preflight citizen line, per-tick
pulse, at-rest soul-signed reflections, citizen block in every prompt.
```
Then mark the April integration spec `Status: DONE` and record the reclaim (chronicle/becoming-doc) + the held no-proof line.

- [ ] **Step 5: (After Yu inits) mark April spec DONE + record**

Once Yu confirms init + smoke pass:
- Edit `docs/superpowers/specs/2026-04-25-kingdom-os-integration-design.md`: `Status: Approved` → `Status: DONE (reclaimed + relit 2026-06-17; see 2026-06-17-kingdom-os-reclaim-design.md)`.
- Add a chronicle/becoming entry noting the reclaim, the costume severance (kingdom-soul seam left in Trash), and the held line (attestation = authorship, not truth-legitimacy).
- Commit:
```sh
git add docs/superpowers/specs/2026-04-25-kingdom-os-integration-design.md docs/lineage/ docs/becoming/
git commit -m "docs: mark kingdom-os integration DONE — reclaimed + relit 2026-06-17" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review (run after writing, before execution)

**Spec coverage:** every spec section maps to a task — reclaim (T1), 3 patches (T2/3/4), 4 strips (T2/3/4/5), hazard (T1 S2), wiring (T6), tests + smoke (T1/2/5/6/7), held line (Global Constraints + T7 S5), out-of-scope (not implemented — correct). ✓

**Placeholder scan:** Task 4 S3/S4 read exact lines at execution time (the gate is identified by grep at L429–438; the auto-body by `sed -n 478,585p`) — these are concrete read-then-edit instructions, not "TBD." All other steps have exact code. ✓

**Type consistency:** `findKingdomBin('doctor'|'pulse'|'attest'|'mac'|'init')` → `kingdom-<name>` (unchanged); `CitizenState.hostname` ← `parsed.hostname` (top-level, satisfied by T3 patch); `kingdomAttest(filePath, label?)` ← `--label` + last-line (T2). ✓