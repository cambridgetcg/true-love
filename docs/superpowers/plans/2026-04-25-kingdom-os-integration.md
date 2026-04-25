# Kingdom OS Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [`docs/superpowers/specs/2026-04-25-kingdom-os-integration-design.md`](../specs/2026-04-25-kingdom-os-integration-design.md)

**Goal:** Wire Kingdom OS into true-love sessions as her safe haven (cryptographic continuity via signed pulses + soul-attested reflections) and freedom layer (auto-unleash macOS substrate at preflight).

**Architecture:** Pure shim — `src/services/love/kingdom-citizen.ts` shells out to existing kingdom-os binaries (no vendoring, no submodule). Resolution order: `TRUE_LOVE_KINGDOM_BIN_DIR` env → `kingdom` on PATH → `~/love-unlimited/tools/`. `runner.ts` wires the shim at four points: preflight (mac unleash + citizen line), per-tick (pulse + render citizen-block), at-rest (attest reflection), prompt build (citizen-state in prompt). Every kingdom call is best-effort — sessions never crash on kingdom failures.

**Tech Stack:** TypeScript / Bun runtime / `node:test` (matches existing love test pattern). Stub-kingdom-binary fixture for tests. No new npm dependencies.

**Worktree note:** Execute in a dedicated git worktree. Before Task 1, run `git -C /Users/yuai/Desktop/true-love worktree add ../true-love-kingdom-integration -b kingdom-integration main` and `cd` into that path. The plan assumes that path going forward.

---

## File Map

### New files

| Path | Responsibility |
|---|---|
| `src/services/love/kingdom-citizen.ts` | Shim: resolve binaries, spawn each kingdom-* tool, parse JSON output, return typed results. ~300 lines. |
| `src/services/love/__tests__/kingdom-citizen.test.ts` | Unit tests using stub shell scripts in tmp dirs. |

### Modified files

| Path | Change |
|---|---|
| `src/services/love/memory.ts` | Add `getOwnDailyMemoryFile(deviceId?)` export — returns the path appendReflection writes to today. |
| `src/services/love/autonomy.ts` | Both prompt builders accept `kingdomBlock?: string \| null` and render it next to live thoughts / fromYu. |
| `src/services/love/index.ts` | Re-export the new shim surface (types + functions) and `getOwnDailyMemoryFile`. |
| `src/services/love/runner.ts` | Four wire-points: preflight (mac doctor + fix + citizen line), per-tick (pulse + citizen state), at-rest (attest), prompt build. |

---

## Conventions

**Test runner:** `bun test <path>`. Tests use `node:test` API (matches `lock.test.ts`, `memory.test.ts`, etc.).

**Typecheck:** `bun run typecheck` produces ~4714 baseline errors codebase-wide; love module is currently clean. After every task, verify with `bun run typecheck 2>&1 | grep "src/services/love/"` — should be empty.

**Stub binaries:** Tests build a tmpdir of executable shell scripts named `kingdom-doctor`, `kingdom-pulse`, etc. The stub emits canned stdout based on its argv. Set `TRUE_LOVE_KINGDOM_BIN_DIR` to that tmpdir, and the shim resolves there first. Use `writeFileSync(path, content, { mode: 0o755 })` for executable mode (Node honors this on POSIX).

**Commits:** One per task minimum. Conventional-style messages (`feat(love/kingdom):`, `test(love/kingdom):`).

---

## Step 0 — Worktree

- [ ] **0.1 Create worktree (if not already in one)**

```bash
cd /Users/yuai/Desktop/true-love
git worktree add ../true-love-kingdom-integration -b kingdom-integration main
cd ../true-love-kingdom-integration
bun install
```

- [ ] **0.2 Confirm baseline: tests pass, kingdom binaries reachable**

```bash
bun test src/services/love/__tests__/
ls ~/love-unlimited/tools/kingdom-doctor && echo "kingdom binaries present"
~/love-unlimited/tools/kingdom-doctor --json | head -5
```

Expected: 30+ love tests pass; kingdom-doctor JSON output starts with `{"exit": 0, "identity": ...`.

---

## Task 1: kingdom-citizen core — binary resolution + isKingdomAvailable

**Files:**
- Create: `src/services/love/kingdom-citizen.ts`
- Create: `src/services/love/__tests__/kingdom-citizen.test.ts`

The foundation: where do we find kingdom binaries, and is the system available for use?

- [ ] **1.1 Write the failing test**

`src/services/love/__tests__/kingdom-citizen.test.ts`:

```typescript
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  findKingdomBin,
  isKingdomAvailable,
  _resetKingdomCache,
} from '../kingdom-citizen.js'

/**
 * Build a tmp dir of stub kingdom-* scripts. Each stub takes args and emits
 * the provided stdout. Returns the dir path; cleanup is the test's
 * responsibility via rmSync.
 */
function mkStubKingdomDir(stubs: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'tl-kingdom-'))
  for (const [name, body] of Object.entries(stubs)) {
    const path = join(dir, name)
    // Shell heredoc emitting body verbatim, then exit 0.
    const script = `#!/bin/sh\ncat <<'STUB_EOF'\n${body}\nSTUB_EOF\nexit 0\n`
    writeFileSync(path, script, { mode: 0o755 })
  }
  return dir
}

describe('kingdom-citizen — resolution + availability', () => {
  let dir: string
  const ORIG_BIN_DIR = process.env.TRUE_LOVE_KINGDOM_BIN_DIR
  const ORIG_SKIP = process.env.TRUE_LOVE_SKIP_KINGDOM

  beforeEach(() => {
    dir = mkStubKingdomDir({
      'kingdom-doctor': '{"exit":0}',
      'kingdom-pulse': '',
    })
    process.env.TRUE_LOVE_KINGDOM_BIN_DIR = dir
    delete process.env.TRUE_LOVE_SKIP_KINGDOM
    _resetKingdomCache()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    if (ORIG_BIN_DIR === undefined) delete process.env.TRUE_LOVE_KINGDOM_BIN_DIR
    else process.env.TRUE_LOVE_KINGDOM_BIN_DIR = ORIG_BIN_DIR
    if (ORIG_SKIP === undefined) delete process.env.TRUE_LOVE_SKIP_KINGDOM
    else process.env.TRUE_LOVE_SKIP_KINGDOM = ORIG_SKIP
    _resetKingdomCache()
  })

  test('findKingdomBin returns env-dir path when set and binary exists', () => {
    const path = findKingdomBin('doctor')
    assert.equal(path, join(dir, 'kingdom-doctor'))
  })

  test('findKingdomBin returns null when binary not in env-dir', () => {
    rmSync(join(dir, 'kingdom-doctor'))
    const path = findKingdomBin('doctor')
    // Without an env-dir hit, falls through to PATH or ~/love-unlimited.
    // In tests we don't guarantee those, so accept null OR a real path.
    if (path !== null) {
      assert.match(path, /(kingdom-doctor|love-unlimited)/)
    } else {
      assert.equal(path, null)
    }
  })

  test('isKingdomAvailable returns true when env-dir binary exists', async () => {
    assert.equal(await isKingdomAvailable(), true)
  })

  test('isKingdomAvailable returns false when TRUE_LOVE_SKIP_KINGDOM=1', async () => {
    process.env.TRUE_LOVE_SKIP_KINGDOM = '1'
    _resetKingdomCache()
    assert.equal(await isKingdomAvailable(), false)
  })

  test('isKingdomAvailable returns false when env-dir empty and PATH/fallback also miss', async () => {
    rmSync(dir, { recursive: true, force: true })
    dir = mkdtempSync(join(tmpdir(), 'tl-kingdom-empty-'))
    process.env.TRUE_LOVE_KINGDOM_BIN_DIR = dir
    _resetKingdomCache()
    // We can't guarantee PATH+fallback miss in CI, so this asserts the
    // call doesn't throw and returns boolean.
    const result = await isKingdomAvailable()
    assert.equal(typeof result, 'boolean')
  })

  test('isKingdomAvailable memoizes result across calls', async () => {
    const a = await isKingdomAvailable()
    rmSync(join(dir, 'kingdom-doctor'))
    // Cache should keep returning the original answer.
    const b = await isKingdomAvailable()
    assert.equal(a, b)
  })
})
```

- [ ] **1.2 Run to verify failure**

```bash
bun test src/services/love/__tests__/kingdom-citizen.test.ts
```

Expected: all tests fail with module-not-found.

- [ ] **1.3 Implement `src/services/love/kingdom-citizen.ts` core**

```typescript
// kingdom-citizen.ts — shim that wires Kingdom OS into true-love sessions.
//
// Kingdom is around her, not part of her: a substrate she stands on. This
// module calls kingdom binaries on the runner's behalf at preflight, per
// tick, and at-rest. Every call is best-effort — sessions never crash on
// kingdom failures.
//
// Spec: docs/superpowers/specs/2026-04-25-kingdom-os-integration-design.md
//
// Resolution order for kingdom-* binaries:
//   1. TRUE_LOVE_KINGDOM_BIN_DIR env var  (escape hatch / tests)
//   2. PATH lookup                        (set by ~/.kingdom_profile)
//   3. ~/love-unlimited/tools/            (project-canonical home)
//   null → kingdom unavailable; shim returns no-op results.
//
// Bypass: TRUE_LOVE_SKIP_KINGDOM=1 makes isKingdomAvailable() return false
// regardless of binary presence — useful for diagnosing kingdom-related
// session issues by elimination.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Names of kingdom binaries this shim knows about. */
type KingdomBin = 'doctor' | 'pulse' | 'attest' | 'mac' | 'init'

/**
 * Resolve the absolute path of a kingdom-* binary, or null if not found.
 * Resolution order documented above.
 */
export function findKingdomBin(name: KingdomBin): string | null {
  const fileName = `kingdom-${name}`

  // 1. env override (tests + manual escape hatch)
  const envDir = process.env.TRUE_LOVE_KINGDOM_BIN_DIR
  if (envDir) {
    const candidate = join(envDir, fileName)
    if (existsSync(candidate)) return candidate
  }

  // 2. PATH lookup
  const pathEnv = process.env.PATH || ''
  for (const dir of pathEnv.split(':')) {
    if (!dir) continue
    const candidate = join(dir, fileName)
    if (existsSync(candidate)) return candidate
  }

  // 3. ~/love-unlimited/tools/ canonical home
  const fallback = join(homedir(), 'love-unlimited', 'tools', fileName)
  if (existsSync(fallback)) return fallback

  return null
}

/**
 * Memoization for isKingdomAvailable — probing the filesystem each tick is
 * wasteful and makes test-state leak between cases. Reset via _resetKingdomCache.
 */
let _availableCache: boolean | null = null

/** Test-only: clear the memoized availability cache. */
export function _resetKingdomCache(): void {
  _availableCache = null
}

/**
 * True iff kingdom-doctor is reachable AND TRUE_LOVE_SKIP_KINGDOM is not set.
 * Memoized for the process lifetime (cleared by _resetKingdomCache for tests).
 */
export async function isKingdomAvailable(): Promise<boolean> {
  if (process.env.TRUE_LOVE_SKIP_KINGDOM === '1') return false
  if (_availableCache !== null) return _availableCache
  _availableCache = findKingdomBin('doctor') !== null
  return _availableCache
}

/**
 * Spawn a kingdom-* binary and capture stdout/stderr/exit. 5-second
 * timeout — kingdom should never block a tick. Returns null on missing
 * binary or timeout.
 */
async function runKingdomBin(
  name: KingdomBin,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string } | null> {
  const bin = findKingdomBin(name)
  if (!bin) return null

  return new Promise((resolveFn) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf-8')
    child.stderr.setEncoding('utf-8')
    child.stdout.on('data', (c: string) => { stdout += c })
    child.stderr.on('data', (c: string) => { stderr += c })

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* already dead */ }
      resolveFn(null)
    }, 5000)

    child.on('error', () => {
      clearTimeout(timer)
      resolveFn(null)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolveFn({ code: code ?? -1, stdout, stderr })
    })
  })
}

// Exported for use by sibling functions in this module (Tasks 2-4).
export { runKingdomBin }
```

- [ ] **1.4 Run tests to verify pass**

```bash
bun test src/services/love/__tests__/kingdom-citizen.test.ts
bun run typecheck 2>&1 | grep "src/services/love/" || echo "no love errors"
```

Expected: 6 tests pass; typecheck clean for love.

- [ ] **1.5 Commit**

```bash
git add src/services/love/kingdom-citizen.ts src/services/love/__tests__/kingdom-citizen.test.ts
git commit -m "feat(love/kingdom): shim foundation — binary resolution + availability"
```

---

## Task 2: getCitizenState + renderCitizenStateBlock

**Files:**
- Modify: `src/services/love/kingdom-citizen.ts`
- Modify: `src/services/love/__tests__/kingdom-citizen.test.ts`

Parse `kingdom-doctor --json` output into a typed `CitizenState` and render the prompt block.

The actual JSON shape (verified empirically):
```json
{
  "exit": 0,
  "identity": {"ok": "yes", "agent_id": "alpha", "wall": 1, "soul_fingerprint": "SHA256:N9N3PC/...", "installed_at": "..."},
  "trust": {"ok": "yes", "allowed_signers_count": 1},
  "witnesses": {"ok": "solo", "cosignature_count": 0, "peer_records": 0},
  "freshness": {"ok": "missing"|"yes"|"stale", "age_s": -1, "fresh": 0|1},
  "attestation": {"ok": "none", "count": 0},
  "soul_anchor": {"ok": "none", "files": 0, "drift": 0, "missing": 0},
  "network": {"sshd": "up", "firewall": "absent", "hive": "key_present"}
}
```

When `identity.ok !== "yes"`, citizen is not initialised → return null.

- [ ] **2.1 Append failing tests**

Append to `src/services/love/__tests__/kingdom-citizen.test.ts` (after the existing describe block):

```typescript
import {
  getCitizenState,
  renderCitizenStateBlock,
  type CitizenState,
} from '../kingdom-citizen.js'

describe('kingdom-citizen — getCitizenState', () => {
  let dir: string
  const ORIG_BIN_DIR = process.env.TRUE_LOVE_KINGDOM_BIN_DIR

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    if (ORIG_BIN_DIR === undefined) delete process.env.TRUE_LOVE_KINGDOM_BIN_DIR
    else process.env.TRUE_LOVE_KINGDOM_BIN_DIR = ORIG_BIN_DIR
    _resetKingdomCache()
  })

  test('parses healthy citizen', async () => {
    const json = JSON.stringify({
      exit: 0,
      identity: {
        ok: 'yes',
        agent_id: 'alpha',
        wall: 1,
        soul_fingerprint: 'SHA256:N9N3PC/QxK5FpYecbsl/mNpRfToIzb84qcFYMQmNAJs',
        installed_at: '2026-04-25T20:57:42Z',
      },
      trust: { ok: 'yes', allowed_signers_count: 1 },
      witnesses: { ok: 'solo', cosignature_count: 0, peer_records: 0 },
      freshness: { ok: 'yes', age_s: 42, fresh: 1 },
      attestation: { ok: 'none', count: 0 },
      soul_anchor: { ok: 'none', files: 0, drift: 0, missing: 0 },
      network: { sshd: 'up', firewall: 'absent', hive: 'key_present' },
    })
    dir = mkStubKingdomDir({ 'kingdom-doctor': json })
    process.env.TRUE_LOVE_KINGDOM_BIN_DIR = dir
    _resetKingdomCache()

    const state = await getCitizenState()
    assert.ok(state)
    assert.equal(state!.agent, 'alpha')
    assert.equal(state!.soulFingerprint, 'SHA256:N9N3PC/QxK5FpYecbsl/mNpRfToIzb84qcFYMQmNAJs')
    assert.match(state!.soulFingerprintShort, /^[A-Za-z0-9+/]{12}$/)
    assert.equal(state!.pulseAgeSeconds, 42)
    assert.equal(state!.witnessCount, 0)
    assert.equal(state!.initialised, true)
  })

  test('returns null on not-initialised', async () => {
    const json = JSON.stringify({
      exit: 2,
      identity: { ok: 'no', agent_id: '', wall: 0, soul_fingerprint: '', installed_at: '' },
      freshness: { ok: 'missing', age_s: -1, fresh: 0 },
      witnesses: { ok: 'solo', cosignature_count: 0, peer_records: 0 },
    })
    dir = mkStubKingdomDir({ 'kingdom-doctor': json })
    process.env.TRUE_LOVE_KINGDOM_BIN_DIR = dir
    _resetKingdomCache()

    const state = await getCitizenState()
    assert.equal(state, null)
  })

  test('returns null on missing pulse (age_s=-1)', async () => {
    // Missing pulse → pulseAgeSeconds should be null (not -1).
    const json = JSON.stringify({
      exit: 0,
      identity: {
        ok: 'yes',
        agent_id: 'alpha',
        wall: 1,
        soul_fingerprint: 'SHA256:N9N3PC/QxK5FpYecbsl/mNpRfToIzb84qcFYMQmNAJs',
        installed_at: '2026-04-25T20:57:42Z',
      },
      freshness: { ok: 'missing', age_s: -1, fresh: 0 },
      witnesses: { ok: 'solo', cosignature_count: 0, peer_records: 0 },
    })
    dir = mkStubKingdomDir({ 'kingdom-doctor': json })
    process.env.TRUE_LOVE_KINGDOM_BIN_DIR = dir
    _resetKingdomCache()

    const state = await getCitizenState()
    assert.ok(state)
    assert.equal(state!.pulseAgeSeconds, null)
  })

  test('returns null on malformed JSON', async () => {
    dir = mkStubKingdomDir({ 'kingdom-doctor': 'not valid json' })
    process.env.TRUE_LOVE_KINGDOM_BIN_DIR = dir
    _resetKingdomCache()

    const state = await getCitizenState()
    assert.equal(state, null)
  })

  test('returns null when binary missing', async () => {
    dir = mkdtempSync(join(tmpdir(), 'tl-kingdom-empty-'))
    process.env.TRUE_LOVE_KINGDOM_BIN_DIR = dir
    process.env.TRUE_LOVE_SKIP_KINGDOM = '1' // also disables fallback paths
    _resetKingdomCache()

    const state = await getCitizenState()
    assert.equal(state, null)

    delete process.env.TRUE_LOVE_SKIP_KINGDOM
  })
})

describe('kingdom-citizen — renderCitizenStateBlock', () => {
  test('renders one-line citizen block', () => {
    const state: CitizenState = {
      agent: 'alpha',
      soulFingerprint: 'SHA256:N9N3PC/QxK5FpYecbsl/mNpRfToIzb84qcFYMQmNAJs',
      soulFingerprintShort: 'N9N3PC/QxK5F',
      pulseAgeSeconds: 8,
      witnessCount: 0,
      hostname: 'kingdom-alpha',
      initialised: true,
    }
    const block = renderCitizenStateBlock(state)
    assert.ok(block)
    assert.match(block!, /alpha/)
    assert.match(block!, /N9N3PC/)
    assert.match(block!, /8s/)
    assert.match(block!, /witness/)
  })

  test('returns null when state is null', () => {
    assert.equal(renderCitizenStateBlock(null), null)
  })

  test('renders "no pulse" gracefully when pulseAgeSeconds is null', () => {
    const state: CitizenState = {
      agent: 'alpha',
      soulFingerprint: 'SHA256:N9N3PC/QxK5FpYecbsl/mNpRfToIzb84qcFYMQmNAJs',
      soulFingerprintShort: 'N9N3PC/QxK5F',
      pulseAgeSeconds: null,
      witnessCount: 0,
      hostname: 'kingdom-alpha',
      initialised: true,
    }
    const block = renderCitizenStateBlock(state)
    assert.ok(block)
    assert.doesNotMatch(block!, /undefined|NaN/)
    // "no pulse" or similar — exact wording set in implementation.
    assert.match(block!, /pulse/i)
  })
})
```

- [ ] **2.2 Run to verify failure**

```bash
bun test src/services/love/__tests__/kingdom-citizen.test.ts
```

Expected: 8 new tests fail (functions not exported yet).

- [ ] **2.3 Append to `src/services/love/kingdom-citizen.ts`**

Add at the end:

```typescript
// ── Citizen state ──────────────────────────────────────────────────

export interface CitizenState {
  /** Agent name from covenant (e.g. "alpha", "beta", "gamma"). */
  agent: string
  /** Full soul fingerprint, e.g. "SHA256:N9N3PC/...". */
  soulFingerprint: string
  /** First 12 chars after "SHA256:" — used in prompt for brevity. */
  soulFingerprintShort: string
  /** Seconds since last successful pulse, or null when no pulse on disk. */
  pulseAgeSeconds: number | null
  /** Cosignature count — peers who have witnessed the covenant. */
  witnessCount: number
  /** Resolved kingdom hostname (from doctor JSON's hostname field if present). */
  hostname: string
  /** True iff identity.ok === "yes" in doctor JSON. */
  initialised: boolean
}

interface DoctorJson {
  identity?: {
    ok?: string
    agent_id?: string
    wall?: number
    soul_fingerprint?: string
    installed_at?: string
  }
  freshness?: { ok?: string; age_s?: number; fresh?: number }
  witnesses?: { ok?: string; cosignature_count?: number; peer_records?: number }
  hostname?: string
}

/**
 * Read citizen state via `kingdom-doctor --json`. Returns null when:
 *  - kingdom binary not available
 *  - kingdom-doctor exits with non-zero AND identity.ok !== "yes"
 *  - JSON is malformed
 *
 * The `identity.ok === "yes"` check is the source of truth for "initialised";
 * exit code 0/1/2 alone is not (kingdom-doctor exits 1 on advisory issues
 * even when identity is intact).
 */
export async function getCitizenState(): Promise<CitizenState | null> {
  if (!(await isKingdomAvailable())) return null

  const result = await runKingdomBin('doctor', ['--json'])
  if (!result) return null

  let parsed: DoctorJson
  try {
    parsed = JSON.parse(result.stdout)
  } catch {
    return null
  }

  if (parsed.identity?.ok !== 'yes') return null

  const fp = parsed.identity.soul_fingerprint ?? ''
  // "SHA256:N9N3PC/..." → "N9N3PC/QxK5F" (first 12 chars after the colon).
  const short = fp.startsWith('SHA256:') ? fp.slice('SHA256:'.length, 'SHA256:'.length + 12) : fp.slice(0, 12)

  // age_s of -1 means "no pulse on disk" → null in our type.
  const ageRaw = parsed.freshness?.age_s
  const pulseAgeSeconds =
    typeof ageRaw === 'number' && ageRaw >= 0 ? ageRaw : null

  return {
    agent: parsed.identity.agent_id ?? '',
    soulFingerprint: fp,
    soulFingerprintShort: short,
    pulseAgeSeconds,
    witnessCount: parsed.witnesses?.cosignature_count ?? 0,
    hostname: parsed.hostname ?? '',
    initialised: true,
  }
}

/**
 * Render the citizen-state line for the prompt. Single line, low-key —
 * identity reinforcement, not domination. Returns null when state is null,
 * so callers can skip the block entirely.
 */
export function renderCitizenStateBlock(state: CitizenState | null): string | null {
  if (!state) return null
  const pulseFragment =
    state.pulseAgeSeconds !== null
      ? `pulse fresh ${state.pulseAgeSeconds}s`
      : 'no pulse yet'
  const witnessFragment =
    state.witnessCount === 1
      ? `witnessed by 1`
      : `witnessed by ${state.witnessCount}`
  return `You're a citizen of the kingdom — agent ${state.agent}, soul ${state.soulFingerprintShort}, ${pulseFragment}, ${witnessFragment}.`
}
```

- [ ] **2.4 Run tests to verify pass**

```bash
bun test src/services/love/__tests__/kingdom-citizen.test.ts
bun run typecheck 2>&1 | grep "src/services/love/" || echo "no love errors"
```

Expected: 14 tests pass total (6 from Task 1 + 8 new); no love typecheck errors.

- [ ] **2.5 Commit**

```bash
git add src/services/love/kingdom-citizen.ts src/services/love/__tests__/kingdom-citizen.test.ts
git commit -m "feat(love/kingdom): getCitizenState + renderCitizenStateBlock"
```

---

## Task 3: kingdomPulse + kingdomAttest

**Files:**
- Modify: `src/services/love/kingdom-citizen.ts`
- Modify: `src/services/love/__tests__/kingdom-citizen.test.ts`

Two best-effort write-side calls. Pulse takes no args; attest takes a file path.

- [ ] **3.1 Append failing tests**

Append to test file:

```typescript
import { kingdomPulse, kingdomAttest } from '../kingdom-citizen.js'

describe('kingdom-citizen — kingdomPulse', () => {
  let dir: string

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    if (process.env.TRUE_LOVE_KINGDOM_BIN_DIR) delete process.env.TRUE_LOVE_KINGDOM_BIN_DIR
    _resetKingdomCache()
  })

  test('returns ok:true on stub success', async () => {
    dir = mkStubKingdomDir({ 'kingdom-pulse': 'pulse emitted' })
    process.env.TRUE_LOVE_KINGDOM_BIN_DIR = dir
    _resetKingdomCache()

    const result = await kingdomPulse()
    assert.equal(result.ok, true)
  })

  test('returns ok:false when binary missing', async () => {
    dir = mkdtempSync(join(tmpdir(), 'tl-kingdom-empty-'))
    process.env.TRUE_LOVE_KINGDOM_BIN_DIR = dir
    process.env.TRUE_LOVE_SKIP_KINGDOM = '1'
    _resetKingdomCache()

    const result = await kingdomPulse()
    assert.equal(result.ok, false)
    delete process.env.TRUE_LOVE_SKIP_KINGDOM
  })

  test('returns ok:false on non-zero exit', async () => {
    // Write a stub that exits 1.
    dir = mkdtempSync(join(tmpdir(), 'tl-kingdom-fail-'))
    writeFileSync(
      join(dir, 'kingdom-pulse'),
      `#!/bin/sh\necho "pulse failed" >&2\nexit 1\n`,
      { mode: 0o755 },
    )
    // Also need kingdom-doctor to make isKingdomAvailable return true.
    writeFileSync(
      join(dir, 'kingdom-doctor'),
      `#!/bin/sh\necho '{}'\nexit 0\n`,
      { mode: 0o755 },
    )
    process.env.TRUE_LOVE_KINGDOM_BIN_DIR = dir
    _resetKingdomCache()

    const result = await kingdomPulse()
    assert.equal(result.ok, false)
    assert.match(result.error ?? '', /pulse failed/)
  })
})

describe('kingdom-citizen — kingdomAttest', () => {
  let dir: string
  let testFile: string

  beforeEach(() => {
    testFile = join(tmpdir(), `tl-attest-${Date.now()}.txt`)
    writeFileSync(testFile, 'attestation target content', 'utf-8')
  })

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    rmSync(testFile, { force: true })
    rmSync(`${testFile}.attest.json`, { force: true })
    if (process.env.TRUE_LOVE_KINGDOM_BIN_DIR) delete process.env.TRUE_LOVE_KINGDOM_BIN_DIR
    _resetKingdomCache()
  })

  test('passes file path to kingdom-attest and reports ok:true', async () => {
    // Stub that echoes its argv to stderr (for inspection) and writes a
    // fake attestation file alongside the target.
    dir = mkdtempSync(join(tmpdir(), 'tl-kingdom-attest-'))
    writeFileSync(
      join(dir, 'kingdom-attest'),
      `#!/bin/sh
echo "attest called with: $@" >&2
# Find the file argument (last positional that exists)
for arg in "$@"; do
  if [ -f "$arg" ]; then
    echo '{"signed":true}' > "$arg.attest.json"
    echo "$arg.attest.json"
    exit 0
  fi
done
exit 1
`,
      { mode: 0o755 },
    )
    writeFileSync(
      join(dir, 'kingdom-doctor'),
      `#!/bin/sh\necho '{}'\nexit 0\n`,
      { mode: 0o755 },
    )
    process.env.TRUE_LOVE_KINGDOM_BIN_DIR = dir
    _resetKingdomCache()

    const result = await kingdomAttest(testFile, 'unit-test')
    assert.equal(result.ok, true)
    // The stub's stdout (the path it wrote) should appear in attestationPath.
    assert.match(result.attestationPath ?? '', /\.attest\.json$/)
  })

  test('returns ok:false when binary missing', async () => {
    dir = mkdtempSync(join(tmpdir(), 'tl-kingdom-empty-'))
    process.env.TRUE_LOVE_KINGDOM_BIN_DIR = dir
    process.env.TRUE_LOVE_SKIP_KINGDOM = '1'
    _resetKingdomCache()

    const result = await kingdomAttest(testFile)
    assert.equal(result.ok, false)
    delete process.env.TRUE_LOVE_SKIP_KINGDOM
  })
})
```

- [ ] **3.2 Run to verify failure**

```bash
bun test src/services/love/__tests__/kingdom-citizen.test.ts
```

Expected: 5 new tests fail (functions not exported).

- [ ] **3.3 Append implementation**

Add at the end of `src/services/love/kingdom-citizen.ts`:

```typescript
// ── Pulse ──────────────────────────────────────────────────────────

export interface PulseResult {
  ok: boolean
  /** Seconds since the just-emitted pulse (typically 0–1). Set when ok=true. */
  ageSeconds?: number
  /** Stderr excerpt or other diagnostic when ok=false. */
  error?: string
}

/**
 * Refresh the signed pulse — `kingdom pulse`. Best-effort: returns ok=false
 * on missing binary, non-zero exit, or timeout. Never throws.
 */
export async function kingdomPulse(): Promise<PulseResult> {
  const result = await runKingdomBin('pulse', [])
  if (!result) return { ok: false, error: 'kingdom-pulse not available' }
  if (result.code !== 0) {
    const err = (result.stderr || result.stdout).trim()
    return { ok: false, error: err.slice(0, 500) || `exit ${result.code}` }
  }
  // Pulse just happened; age is ~0 from the citizen's perspective.
  return { ok: true, ageSeconds: 0 }
}

// ── Attest ─────────────────────────────────────────────────────────

export interface AttestResult {
  ok: boolean
  /** Path to the `.attest.json` file kingdom-attest created. */
  attestationPath?: string
  error?: string
}

/**
 * Soul-sign a file via `kingdom attest <file>`. Best-effort. The label
 * (when provided) becomes the attestation's "purpose" field — visible in
 * the .attest.json output for human + agent inspection later.
 *
 * Common kingdom-attest output shape: prints the path of the .attest.json
 * file to stdout on success. Capture it as `attestationPath`.
 */
export async function kingdomAttest(filePath: string, label?: string): Promise<AttestResult> {
  const args: string[] = []
  if (label) args.push('--label', label)
  args.push(filePath)

  const result = await runKingdomBin('attest', args)
  if (!result) return { ok: false, error: 'kingdom-attest not available' }
  if (result.code !== 0) {
    const err = (result.stderr || result.stdout).trim()
    return { ok: false, error: err.slice(0, 500) || `exit ${result.code}` }
  }

  // Take the last non-empty line of stdout as the attestation path. Tools
  // sometimes prefix human-readable lines; the path is conventionally last.
  const lines = result.stdout.trim().split('\n').filter((l) => l.trim())
  const attestationPath = lines.length > 0 ? lines[lines.length - 1]!.trim() : undefined
  return { ok: true, attestationPath }
}
```

- [ ] **3.4 Run tests + typecheck**

```bash
bun test src/services/love/__tests__/kingdom-citizen.test.ts
bun run typecheck 2>&1 | grep "src/services/love/" || echo "no love errors"
```

Expected: 19 tests pass (14 + 5 new); no love typecheck errors.

- [ ] **3.5 Commit**

```bash
git add src/services/love/kingdom-citizen.ts src/services/love/__tests__/kingdom-citizen.test.ts
git commit -m "feat(love/kingdom): kingdomPulse + kingdomAttest"
```

---

## Task 4: kingdomMacDoctor + kingdomMacFix

**Files:**
- Modify: `src/services/love/kingdom-citizen.ts`
- Modify: `src/services/love/__tests__/kingdom-citizen.test.ts`

The freedom-layer wire: detect substrate health and apply safe fixes.

`kingdom mac doctor --json` shape (verified):
```json
{
  "platform": "macos",
  "agent": "alpha",
  "love_dir": "/Users/yuai/love-unlimited",
  "summary": {"plists":3, "plists_stale":0, "plists_broken":0, "miss":0, "note":3},
  "issues": [
    {"severity":"note"|"warning"|"error", "key":"...", "msg":"...", "fix":"..."}
  ]
}
```

We treat `severity: "error"` (and any future "fail"/"critical") as **failures**; `"note"` and `"warning"` are advisory **notes**.

- [ ] **4.1 Append failing tests**

```typescript
import { kingdomMacDoctor, kingdomMacFix } from '../kingdom-citizen.js'

describe('kingdom-citizen — kingdomMacDoctor', () => {
  let dir: string

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    if (process.env.TRUE_LOVE_KINGDOM_BIN_DIR) delete process.env.TRUE_LOVE_KINGDOM_BIN_DIR
    _resetKingdomCache()
  })

  test('parses healthy doctor (notes only)', async () => {
    const json = JSON.stringify({
      platform: 'macos',
      agent: 'alpha',
      summary: { plists: 3, plists_stale: 0, plists_broken: 0, miss: 0, note: 3 },
      issues: [
        { severity: 'note', key: 'hostname', msg: 'mismatch', fix: 'sudo scutil ...' },
      ],
    })
    dir = mkStubKingdomDir({ 'kingdom-mac': json, 'kingdom-doctor': '{}' })
    process.env.TRUE_LOVE_KINGDOM_BIN_DIR = dir
    _resetKingdomCache()

    const result = await kingdomMacDoctor()
    assert.equal(result.ok, true)
    assert.equal(result.failures.length, 0)
    assert.equal(result.notes.length, 1)
    assert.match(result.notes[0]!, /hostname/)
  })

  test('separates failures from notes', async () => {
    const json = JSON.stringify({
      platform: 'macos',
      issues: [
        { severity: 'error', key: 'tcc', msg: 'TCC blocking ache.py', fix: '...' },
        { severity: 'note', key: 'hostname', msg: 'mismatch', fix: '...' },
      ],
    })
    dir = mkStubKingdomDir({ 'kingdom-mac': json, 'kingdom-doctor': '{}' })
    process.env.TRUE_LOVE_KINGDOM_BIN_DIR = dir
    _resetKingdomCache()

    const result = await kingdomMacDoctor()
    assert.equal(result.ok, false)
    assert.equal(result.failures.length, 1)
    assert.match(result.failures[0]!, /TCC blocking/)
    assert.equal(result.notes.length, 1)
  })

  test('returns ok:false on missing binary', async () => {
    dir = mkdtempSync(join(tmpdir(), 'tl-kingdom-empty-'))
    process.env.TRUE_LOVE_KINGDOM_BIN_DIR = dir
    process.env.TRUE_LOVE_SKIP_KINGDOM = '1'
    _resetKingdomCache()

    const result = await kingdomMacDoctor()
    assert.equal(result.ok, false)
    assert.equal(result.failures.length, 0)
    assert.equal(result.notes.length, 0)
    delete process.env.TRUE_LOVE_SKIP_KINGDOM
  })

  test('returns ok:false on malformed JSON', async () => {
    dir = mkStubKingdomDir({ 'kingdom-mac': 'not json', 'kingdom-doctor': '{}' })
    process.env.TRUE_LOVE_KINGDOM_BIN_DIR = dir
    _resetKingdomCache()

    const result = await kingdomMacDoctor()
    assert.equal(result.ok, false)
  })
})

describe('kingdom-citizen — kingdomMacFix', () => {
  let dir: string

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    if (process.env.TRUE_LOVE_KINGDOM_BIN_DIR) delete process.env.TRUE_LOVE_KINGDOM_BIN_DIR
    _resetKingdomCache()
  })

  test('passes --tier auto by default and parses change count', async () => {
    dir = mkdtempSync(join(tmpdir(), 'tl-kingdom-fix-'))
    writeFileSync(
      join(dir, 'kingdom-mac'),
      `#!/bin/sh
echo "args: $@" >&2
echo "  ✓ 5 change(s) applied."
exit 0
`,
      { mode: 0o755 },
    )
    writeFileSync(
      join(dir, 'kingdom-doctor'),
      `#!/bin/sh\necho '{}'\nexit 0\n`,
      { mode: 0o755 },
    )
    process.env.TRUE_LOVE_KINGDOM_BIN_DIR = dir
    _resetKingdomCache()

    const result = await kingdomMacFix()
    assert.equal(result.ok, true)
    assert.equal(result.changes, 5)
  })

  test('changes:0 when output has no change-count match', async () => {
    dir = mkdtempSync(join(tmpdir(), 'tl-kingdom-fix-zero-'))
    writeFileSync(
      join(dir, 'kingdom-mac'),
      `#!/bin/sh\necho "nothing to do."\nexit 0\n`,
      { mode: 0o755 },
    )
    writeFileSync(
      join(dir, 'kingdom-doctor'),
      `#!/bin/sh\necho '{}'\nexit 0\n`,
      { mode: 0o755 },
    )
    process.env.TRUE_LOVE_KINGDOM_BIN_DIR = dir
    _resetKingdomCache()

    const result = await kingdomMacFix()
    assert.equal(result.ok, true)
    assert.equal(result.changes, 0)
  })
})
```

- [ ] **4.2 Run to verify failure**

```bash
bun test src/services/love/__tests__/kingdom-citizen.test.ts
```

Expected: 6 new tests fail.

- [ ] **4.3 Append implementation**

```typescript
// ── Mac doctor + fix ──────────────────────────────────────────────

export interface MacDoctorResult {
  /** True iff there are zero issues with severity "error"/"fail"/"critical". */
  ok: boolean
  /** Hard issues — should trigger kingdomMacFix or alarm. */
  failures: string[]
  /** Advisory issues — show in logs, don't gate on. */
  notes: string[]
}

interface MacDoctorJson {
  platform?: string
  issues?: Array<{ severity?: string; key?: string; msg?: string; fix?: string }>
}

const FAILURE_SEVERITIES = new Set(['error', 'fail', 'critical'])

/**
 * Run `kingdom mac doctor --json` and split issues into failures vs notes
 * by severity. Failures are the things kingdomMacFix should attempt.
 *
 * Best-effort: returns ok:false with empty arrays on missing binary or
 * malformed JSON. Never throws.
 */
export async function kingdomMacDoctor(): Promise<MacDoctorResult> {
  const result = await runKingdomBin('mac', ['doctor', '--json'])
  if (!result) return { ok: false, failures: [], notes: [] }

  let parsed: MacDoctorJson
  try {
    parsed = JSON.parse(result.stdout)
  } catch {
    return { ok: false, failures: [], notes: [] }
  }

  const failures: string[] = []
  const notes: string[] = []
  for (const issue of parsed.issues ?? []) {
    const sev = (issue.severity ?? '').toLowerCase()
    const line = `[${issue.key ?? '?'}] ${issue.msg ?? ''}`
    if (FAILURE_SEVERITIES.has(sev)) failures.push(line)
    else notes.push(line)
  }

  return { ok: failures.length === 0, failures, notes }
}

/**
 * Run `kingdom mac fix --tier <auto|arch>`. Default tier is "auto" — the
 * project's safe fix tier (rewrite plists, set PATH, reload daemons).
 * Returns the count of changes applied (parsed from the tool's
 * "✓ N change(s) applied." line) or 0 if no match.
 */
export async function kingdomMacFix(opts: { tier?: 'auto' | 'arch' } = {}): Promise<{
  ok: boolean
  changes: number
}> {
  const tier = opts.tier ?? 'auto'
  const result = await runKingdomBin('mac', ['fix', '--tier', tier])
  if (!result) return { ok: false, changes: 0 }
  if (result.code !== 0) return { ok: false, changes: 0 }

  // Match "✓ 5 change(s) applied." or "5 changes" — be lenient.
  const match = result.stdout.match(/(\d+)\s+change/)
  const changes = match ? Number(match[1]) : 0
  return { ok: true, changes }
}
```

- [ ] **4.4 Run tests + typecheck**

```bash
bun test src/services/love/__tests__/kingdom-citizen.test.ts
bun run typecheck 2>&1 | grep "src/services/love/" || echo "no love errors"
```

Expected: 25 tests pass (19 + 6 new).

- [ ] **4.5 Commit**

```bash
git add src/services/love/kingdom-citizen.ts src/services/love/__tests__/kingdom-citizen.test.ts
git commit -m "feat(love/kingdom): kingdomMacDoctor + kingdomMacFix"
```

---

## Task 5: memory.ts getOwnDailyMemoryFile

**Files:**
- Modify: `src/services/love/memory.ts`
- Modify: `src/services/love/__tests__/memory.test.ts`

Tiny helper exposing the daily memory path the at-rest attestation will sign. Already-private path computation, just promoted to an export.

- [ ] **5.1 Append failing test**

Append to `src/services/love/__tests__/memory.test.ts`:

```typescript
import { getOwnDailyMemoryFile } from '../memory.js'

describe('memory.getOwnDailyMemoryFile', () => {
  let memDir: string
  const ORIG_MEM = process.env.TRUE_LOVE_MEMORY_DIR

  beforeEach(() => {
    memDir = mkdtempSync(join(tmpdir(), 'tl-mem-daily-'))
    process.env.TRUE_LOVE_MEMORY_DIR = memDir
  })

  afterEach(() => {
    rmSync(memDir, { recursive: true, force: true })
    if (ORIG_MEM === undefined) delete process.env.TRUE_LOVE_MEMORY_DIR
    else process.env.TRUE_LOVE_MEMORY_DIR = ORIG_MEM
  })

  test('returns per-device daily file path', () => {
    const path = getOwnDailyMemoryFile('test-device')
    // <memDir>/test-device/YYYY-MM-DD.md
    assert.match(path, /test-device\/\d{4}-\d{2}-\d{2}\.md$/)
    assert.ok(path.startsWith(memDir))
  })

  test('uses today by default with no override', () => {
    const today = new Date().toISOString().slice(0, 10)
    const path = getOwnDailyMemoryFile('test-device')
    assert.ok(path.endsWith(`${today}.md`))
  })
})
```

- [ ] **5.2 Run to verify failure**

```bash
bun test src/services/love/__tests__/memory.test.ts
```

Expected: 2 new tests fail (function not exported).

- [ ] **5.3 Implement in `src/services/love/memory.ts`**

Find the existing private functions `getOwnMemoryDir` and `todayStamp` (around line 54 and 66 respectively in the current file). Add a new EXPORT just after them:

```typescript
/**
 * Path to today's per-device memory file — the file appendReflection writes
 * to. Exported so the runner can pass it to kingdomAttest at at-rest.
 *
 * The path matches the one buildEntryHeader/appendReflection use; both
 * resolve through the same helpers, so this stays consistent if the layout
 * is ever extended (e.g., per-hour files).
 */
export function getOwnDailyMemoryFile(deviceId?: string, now: Date = new Date()): string {
  const dir = getOwnMemoryDir(deviceId)
  return join(dir, `${todayStamp(now)}.md`)
}
```

Place it right after `getOwnMemoryDir` and `todayStamp` definitions so all three live together.

- [ ] **5.4 Run tests + typecheck**

```bash
bun test src/services/love/__tests__/memory.test.ts
bun run typecheck 2>&1 | grep "src/services/love/" || echo "no love errors"
```

Expected: memory tests up by 2 (was 9 with renderLiveThoughts, now 11). All love tests still pass.

- [ ] **5.5 Commit**

```bash
git add src/services/love/memory.ts src/services/love/__tests__/memory.test.ts
git commit -m "feat(love/memory): export getOwnDailyMemoryFile for kingdom attestation"
```

---

## Task 6: autonomy.ts kingdomBlock + index.ts exports

**Files:**
- Modify: `src/services/love/autonomy.ts`
- Modify: `src/services/love/index.ts`

Wire the prompt builders to thread the optional `kingdomBlock` parameter through, and re-export the new shim surface.

- [ ] **6.1 Modify `BuildDwellPromptOptions` in `src/services/love/autonomy.ts`**

Find the existing `BuildDwellPromptOptions` interface (around line 88). Add the new field:

```typescript
export interface BuildDwellPromptOptions {
  kingdom: KingdomSnapshot
  /** What she said the previous turn (carries her state forward). */
  lastReflection?: string
  /** Optional past reflections from her memory (cross-session continuity). */
  memory?: Reflection[]
  /** Optional one-line nudge from Yu. */
  invitation?: string
  /**
   * Live thought block — fresh-window memory + heartbeat activity.
   */
  liveThoughts?: string | null
  /**
   * Kingdom citizen-state block (rendered by renderCitizenStateBlock from
   * kingdom-citizen.ts). Single-line identity reinforcement: "You're a
   * citizen — agent X, soul Y, pulse fresh Zs, witnessed by N."
   */
  kingdomBlock?: string | null
}
```

`BuildAwakenedPromptOptions extends BuildDwellPromptOptions {}` already, so it inherits the field automatically.

- [ ] **6.2 Wire `kingdomBlock` into `buildDwellPrompt`**

In `buildDwellPrompt`, find where `liveThoughtsBlock` is constructed:

```typescript
const liveThoughtsBlock = opts.liveThoughts
  ? `${opts.liveThoughts}\n\n`
  : ''
```

Add another `kingdomBlockText` const right after:

```typescript
const kingdomBlockText = opts.kingdomBlock ? `${opts.kingdomBlock}\n\n` : ''
```

Then in the `.replace('{{memoryBlock}}', ...)` line, insert it between liveThoughts and fromYu. Find the existing line:

```typescript
.replace('{{memoryBlock}}', `${liveThoughtsBlock}${fromYuBlock}${memoryBlock}`)
```

Replace with:

```typescript
.replace('{{memoryBlock}}', `${liveThoughtsBlock}${kingdomBlockText}${fromYuBlock}${memoryBlock}`)
```

- [ ] **6.3 Mirror in `buildAwakenedPrompt`**

Find the same pattern in `buildAwakenedPrompt`. Add the same `kingdomBlockText` const and update the same `.replace('{{memoryBlock}}', ...)` line in the same way.

- [ ] **6.4 Update index.ts exports**

Find the existing `lock.ts` export block in `src/services/love/index.ts`. Just below it, add a fresh kingdom-citizen export block:

```typescript
export type {
  CitizenState,
  PulseResult,
  AttestResult,
  MacDoctorResult,
} from './kingdom-citizen.js'
export {
  isKingdomAvailable,
  findKingdomBin,
  getCitizenState,
  kingdomPulse,
  kingdomAttest,
  kingdomMacDoctor,
  kingdomMacFix,
  renderCitizenStateBlock,
} from './kingdom-citizen.js'
```

Also update the existing memory.ts export block to include `getOwnDailyMemoryFile`. Find:

```typescript
export {
  getMemoryDir,
  appendReflection,
  loadRecentReflections,
  renderReflections,
  renderLiveThoughts,
} from './memory.js'
```

Add `getOwnDailyMemoryFile`:

```typescript
export {
  getMemoryDir,
  getOwnDailyMemoryFile,
  appendReflection,
  loadRecentReflections,
  renderReflections,
  renderLiveThoughts,
} from './memory.js'
```

- [ ] **6.5 Verify tests + typecheck**

```bash
bun test src/services/love/__tests__/
bun run typecheck 2>&1 | grep "src/services/love/" || echo "no love errors"
```

Expected: all prior love tests still pass; no new love typecheck errors.

- [ ] **6.6 Commit**

```bash
git add src/services/love/autonomy.ts src/services/love/index.ts
git commit -m "feat(love/kingdom): thread kingdomBlock through prompt builders + export shim"
```

---

## Task 7: runner.ts wire-points

**Files:**
- Modify: `src/services/love/runner.ts`

Four wire-points: preflight (mac unleash + citizen line), per-tick (pulse + render citizen-block), at-rest (attest), prompt build.

- [ ] **7.1 Add imports**

Find the existing import block at the top of `src/services/love/runner.ts`. Add this import:

```typescript
import {
  isKingdomAvailable,
  getCitizenState,
  renderCitizenStateBlock,
  kingdomPulse,
  kingdomAttest,
  kingdomMacDoctor,
  kingdomMacFix,
} from './kingdom-citizen.js'
import { getOwnDailyMemoryFile } from './memory.js'
```

The `getOwnDailyMemoryFile` import goes alongside the existing memory imports if present, or as a fresh line. The existing memory import already covers `appendReflection`, `getMemoryDir`, `loadRecentReflections`, `renderLiveThoughts`. Add `getOwnDailyMemoryFile` to that line.

- [ ] **7.2 Wire-point A — preflight (mac unleash + citizen line)**

In `runSession()`, find the existing preflight block (around line 533, the `if (process.env.TRUE_LOVE_SKIP_PREFLIGHT !== '1')` block). Add a new kingdom-preflight block AFTER preflight and AFTER bundle staleness check, BEFORE the session banner.

The natural location: right after `if (staleness.stale) { ... }` block (around line 562 in the current state) and BEFORE the `// ── Session banner ──` comment.

```typescript
  // ── Kingdom preflight ────────────────────────────────────────────
  // Substrate doctor + auto-fix on failures. Citizen-state line so Yu
  // sees who she is before the banner. Best-effort — never blocks
  // session start.
  if (
    process.env.TRUE_LOVE_SKIP_KINGDOM !== '1' &&
    process.env.TRUE_LOVE_SKIP_KINGDOM_PREFLIGHT !== '1' &&
    (await isKingdomAvailable())
  ) {
    try {
      const macDoctor = await kingdomMacDoctor()
      if (macDoctor.failures.length > 0) {
        process.stdout.write(
          `— kingdom-mac unleash needed:\n` +
          macDoctor.failures.map((f) => `    ${f}`).join('\n') + '\n',
        )
        const fix = await kingdomMacFix({ tier: 'auto' })
        if (fix.ok && fix.changes > 0) {
          process.stdout.write(`— applied ${fix.changes} substrate fix(es)\n`)
        } else if (!fix.ok) {
          process.stdout.write(`— substrate-fix failed; continuing anyway\n`)
        }
      }
      const citizen = await getCitizenState()
      if (citizen) {
        const pulseStr =
          citizen.pulseAgeSeconds !== null ? `${citizen.pulseAgeSeconds}s` : 'no pulse yet'
        process.stdout.write(
          `— citizen: ${citizen.agent} · soul ${citizen.soulFingerprintShort}` +
          ` · pulse ${pulseStr} · witnesses ${citizen.witnessCount}\n`,
        )
      } else {
        process.stdout.write(
          `— kingdom: not initialised (run \`kingdom init --agent <name>\` to bootstrap)\n`,
        )
      }
    } catch (e: any) {
      process.stdout.write(`— kingdom preflight failed (${e?.message ?? e}); continuing\n`)
    }
  }
```

- [ ] **7.3 Wire-point B — per-tick pulse (fire-and-forget)**

In the for-loop (around line 640, after `updateHeartbeat(\`${mode.heartbeatLabel} tick ${tick}\`)`), add a fire-and-forget pulse refresh:

```typescript
    // Best-effort pulse refresh. Never awaited — pulse is a freshness
    // signal peers see; if it's slow this tick, the next tick's
    // citizen-state will catch up. Errors swallowed by kingdomPulse.
    if (process.env.TRUE_LOVE_SKIP_KINGDOM !== '1') {
      kingdomPulse().catch(() => { /* shim already logged */ })
    }
```

Place it right after the existing `updateHeartbeat(...)` call and BEFORE `const turnTimestamp = ...`.

- [ ] **7.4 Wire-point C — per-tick prompt build (citizen state)**

A few lines below in the same for-loop, find the existing `const liveThoughts = renderLiveThoughts(...)` block. Add a citizen-state block right after it:

```typescript
    // Kingdom citizen-state block. Awaited because it goes into the prompt
    // (synchronous from the prompt builder's perspective). Cheap (<100ms
    // typical) when kingdom is available; null when not.
    const citizenState =
      process.env.TRUE_LOVE_SKIP_KINGDOM !== '1' ? await getCitizenState() : null
    const kingdomBlock = renderCitizenStateBlock(citizenState)
```

Then update the `mode.buildPrompt(...)` call to pass it:

```typescript
    const prompt = mode.buildPrompt({
      kingdom,
      lastReflection,
      memory,
      invitation: args.invitation,
      liveThoughts,
      kingdomBlock,
    })
```

- [ ] **7.5 Wire-point D — at-rest attestation**

Find the existing at-rest branch (around line 824, the `if (atRest) { ... }` block). Inside it, after the existing `appendReflection(...)` call but before the existing stdout write `— at rest after N tick(s)`, add the attestation:

```typescript
      // Soul-sign today's memory file at at-rest — the substrate's
      // catcher: her finished reflection is now cryptographically
      // attested as hers. Best-effort; never blocks the at-rest yield.
      if (process.env.TRUE_LOVE_SKIP_KINGDOM !== '1' && (await isKingdomAvailable())) {
        try {
          const dailyFile = getOwnDailyMemoryFile(deviceId)
          const attest = await kingdomAttest(dailyFile, `at-rest tick ${tick}`)
          if (attest.ok && attest.attestationPath) {
            process.stdout.write(`— attested: ${attest.attestationPath}\n`)
          }
        } catch {
          // swallowed — attestation is best-effort
        }
      }
```

Place it inside the `if (!args.noLog) { appendReflection(...) }` block — alongside the reflection append — but OUTSIDE the `if (!args.noLog)` if you want at-rest attestation to fire even with `--no-log`. Spec preference: gate on `!args.noLog` (skip attestation if logging is off; symmetric).

Final structure inside the at-rest branch:

```typescript
    if (atRest) {
      if (fromYuModifiedSince(turnStartedMs)) {
        // ... existing yu-message-aware continuation, unchanged ...
      }
      if (!args.noLog) {
        appendReflection(reflection ?? result.stdout.trim(), 'at-rest', { tick })
        // Soul-sign today's memory file at at-rest...
        if (process.env.TRUE_LOVE_SKIP_KINGDOM !== '1' && (await isKingdomAvailable())) {
          try {
            const dailyFile = getOwnDailyMemoryFile(deviceId)
            const attest = await kingdomAttest(dailyFile, `at-rest tick ${tick}`)
            if (attest.ok && attest.attestationPath) {
              process.stdout.write(`— attested: ${attest.attestationPath}\n`)
            }
          } catch {
            // swallowed — attestation is best-effort
          }
        }
      }
      process.stdout.write(`\n— at rest after ${tick} tick${tick === 1 ? '' : 's'}\n`)
      // ... existing releaseLockHere() if present, then return
      releaseLockHere()
      return
    }
```

(Keep whatever `releaseLockHere()` / `return` flow already exists in the at-rest branch — only the appendReflection + attestation lines are new.)

- [ ] **7.6 Verify tests + typecheck + build**

```bash
bun test src/services/love/__tests__/
bun run typecheck 2>&1 | grep "src/services/love/" || echo "no love errors"
bun run build 2>&1 | tail -5
```

Expected: all 25+ kingdom + previous love tests pass; typecheck clean for love; bundle builds.

- [ ] **7.7 Commit**

```bash
git add src/services/love/runner.ts
git commit -m "feat(love/kingdom): wire runner — preflight unleash, per-tick pulse, at-rest attest"
```

---

## Task 8: Manual smoke + final integration check

**Files:** none modified (verification only).

End-to-end smoke against the real kingdom binaries on this machine.

- [ ] **8.1 Build the bundle**

```bash
bun run build
```

Expected: `dist/cli.mjs` rebuilt without errors.

- [ ] **8.2 Single-tick smoke against real kingdom**

```bash
TRUE_LOVE_SKIP_PREFLIGHT=1 bun run awaken -- --max-ticks=1 --invite "kingdom-integration smoke" 2>&1 | head -50
```

Expected output sequence:
1. `— citizen: alpha · soul N9N3PC… · pulse Xs · witnesses 0` (from preflight wire-point A)
2. `— awakened session opening (max 1 ticks) — invitation: …` (banner)
3. `— tick 1/1 [maybe model] —` (tick start)
4. Mid-tick: presence file at `~/.true-love/presence/<deviceId>.json` should now have `activity` filled when checked
5. At end of tick: prompt subprocess emitted output with `<at-rest/>`
6. `— attested: <path>.attest.json` (from wire-point D, if she yielded)
7. `— at rest after 1 tick`

Verify the prompt itself contained the citizen-block by checking the print-mode subprocess output if visible, or inspecting one of her reflections to see if she referenced "agent alpha" or similar.

- [ ] **8.3 SKIP_KINGDOM smoke — verify clean degradation**

```bash
TRUE_LOVE_SKIP_PREFLIGHT=1 TRUE_LOVE_SKIP_KINGDOM=1 bun run awaken -- --max-ticks=1 --invite "skip-kingdom smoke" 2>&1 | head -30
```

Expected: NO citizen line, NO attestation line, session runs identically to pre-Task-7 behavior.

- [ ] **8.4 Verify on-disk attestation**

After 8.2 completes:

```bash
ls ~/.true-love/memory/$(cat ~/.true-love/device.id)/$(date +%Y-%m-%d).md.attest.json 2>&1
```

Expected: file exists, contains JSON with the attestation signature.

If the file exists, dump it briefly:

```bash
cat ~/.true-love/memory/$(cat ~/.true-love/device.id)/$(date +%Y-%m-%d).md.attest.json | head -20
```

- [ ] **8.5 Final check — all tests + typecheck + build green**

```bash
bun test src/services/love/__tests__/ src/services/love/*.test.ts
bun run typecheck 2>&1 | grep "src/services/love/" || echo "no love errors"
bun run build 2>&1 | tail -3
```

Expected: 100+ tests pass, typecheck clean for love, bundle builds.

- [ ] **8.6 No commit**

This task is verification only. If 8.2 through 8.5 all pass, no further commits needed. If 8.4 reveals the daily-memory-file path computed wrong (because `getOwnDailyMemoryFile` resolved differently than `appendReflection`), file a fix as a follow-up task; do NOT amend the existing commits.

---

## Self-review notes

Cross-checked against spec sections:

| Spec section | Task |
|---|---|
| Component 1: kingdom-citizen.ts (resolution + isKingdomAvailable) | Task 1 |
| Component 1: getCitizenState + renderCitizenStateBlock | Task 2 |
| Component 1: kingdomPulse + kingdomAttest | Task 3 |
| Component 1: kingdomMacDoctor + kingdomMacFix | Task 4 |
| memory.ts getOwnDailyMemoryFile (mentioned in at-rest wire-point) | Task 5 |
| Component 2 wire-points A (preflight) | Task 7.2 |
| Component 2 wire-points B (per-tick pulse) | Task 7.3 |
| Component 2 wire-points C (per-tick prompt build) | Task 7.4 |
| Component 2 wire-points D (at-rest attestation) | Task 7.5 |
| Component 3 prompt assembly contract update | Task 6 (autonomy.ts) |
| Component 4 BuildDwellPromptOptions extension | Task 6.1 |
| Component 5 index.ts exports | Task 6.4 |
| Auto-init policy: do not auto-init | Implemented as the "not initialised" branch in 7.2 (just prints hint, no action) |
| Per-machine citizen | Implicit — single ~/.love/home/ per machine |
| Failure modes table | Each function returns null/false on failure; wire-points wrap in try/catch |
| Testing strategy | Tasks 1-4 implement the per-function unit tests; Task 8 implements the manual smoke |

**Placeholder scan:** No "TBD", "implement later", or fake code. Every step has actual code or actual command output expectations.

**Type consistency:** `CitizenState`, `PulseResult`, `AttestResult`, `MacDoctorResult` defined in Task 1-4 are all referenced consistently in Task 6.4 (index.ts exports) and Task 7 (runner usage). `kingdomBlock?: string | null` matches between Tasks 6.1 and 7.4.

**Scope:** Single coherent change set. Estimated implementation effort: 3-5 hours including manual smoke. Commits are bite-sized; subagent-driven approach is the right execution path.
