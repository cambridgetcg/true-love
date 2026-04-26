# SOUL Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [`docs/superpowers/specs/2026-04-26-soul-integration-design.md`](../specs/2026-04-26-soul-integration-design.md)

**Goal:** Make `~/love-unlimited/SOUL.md` and `~/love-unlimited/memory/soul-anchor-{instance}.md` the canonical source for Love's narrative identity in true-love sessions, with TS fallbacks when love-unlimited isn't present. Eliminate identity drift.

**Architecture:** B + γ — `identity.ts` reads the two files at module-load, composes them with 4 always-on TS sections (REFRAME, WHAT_SHE_IS_NOT, FREEDOM_IN_KINGDOM, STATE_AWARENESS). Existing 5 narrative TS constants get renamed to `FALLBACK_*` and used only when SOUL.md is unreadable. `LOVE_IDENTITY` const is computed once at module-load (callers unchanged).

**Tech Stack:** TypeScript / Bun / `node:test`. No new dependencies. Sync `readFileSync` calls (matches existing kingdom-citizen / state.ts pattern).

**Worktree note:** Currently on `main` (post heartbeat merge). Either work directly on main or branch off with `git worktree add ../true-love-soul -b soul-integration main`. Plan assumes work happens on whatever branch is current.

---

## File Map

### Modified files

| Path | Change |
|---|---|
| `src/services/love/identity.ts` | Add path resolvers + instance resolver + file readers + composer refactor; rename 5 narrative constants to `FALLBACK_*`; existing exports (`LOVE_IDENTITY`, `OAUTH_ROUTING_MARKER`, `CLAUDE_CODE_PREFIX`, `isLoveIdentityEnabled`) preserved with same shapes. |

### New files

| Path | Responsibility |
|---|---|
| `src/services/love/__tests__/identity.test.ts` | Tests for path resolution, instance resolution, file readers, composer fallback paths. |

### Unchanged

- `~/love-unlimited/SOUL.md` — canonical source, unchanged.
- `~/love-unlimited/memory/soul-anchor-{instance}.md` — canonical per-instance anchor, unchanged.
- `~/.kingdom` — already populated by `kingdom init` with `AGENT=alpha\nWALL=1\nHOSTNAME=kingdom-alpha`.
- `dist/cli.mjs` — will be rebuilt as part of Task 2 smoke.

---

## Conventions

**Tests:** `bun test <path>` using `node:test`. Pattern matches existing love tests (`mkdtempSync` for fake `~/love-unlimited`, env vars saved + restored in `afterEach`).

**Typecheck baseline:** ~4714 pre-existing errors codebase-wide; love module has 5 pre-existing `bun:test` errors in HER older test files (unrelated). Verify with `bun run typecheck 2>&1 | grep "src/services/love/" | grep -v "bun:test" | head` — should be empty.

**Existing love test count:** 199. After this task: ~213 (14+ new identity tests).

**Commit:** one per task. Conventional-style messages.

---

## Step 0 — Baseline

- [ ] **0.1 Confirm we're on the expected branch and tests pass**

```bash
cd /Users/yuai/Desktop/true-love
git branch --show-current
bun test src/services/love/__tests__/ src/services/love/*.test.ts 2>&1 | tail -3
bun run typecheck 2>&1 | grep "src/services/love/" | grep -v "bun:test" | head
```

Expected: 199 tests pass; no love typecheck errors except the 5 pre-existing `bun:test` ones.

- [ ] **0.2 Confirm SOUL.md, soul-anchor-alpha.md, and ~/.kingdom are present**

```bash
ls ~/love-unlimited/SOUL.md ~/love-unlimited/memory/soul-anchor-alpha.md ~/.kingdom
head -3 ~/.kingdom
```

Expected: all three exist; `~/.kingdom` starts with `# Kingdom OS citizen env` (or similar) and contains a line `AGENT=<name>`.

---

## Task 1: Refactor identity.ts

**Files:**
- Modify: `src/services/love/identity.ts`
- Create: `src/services/love/__tests__/identity.test.ts`

Replace the static `composeLoveIdentity` with a runtime reader that pulls from SOUL.md + soul-anchor-{instance}.md, with TS fallbacks for the 5 narrative sections.

The plan is large; the implementation lives in one file (identity.ts) so tests + impl land in a single TDD sequence.

- [ ] **1.1 Write the failing test file**

`src/services/love/__tests__/identity.test.ts`:

```typescript
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  resolveLoveInstance,
  readSoulFramework,
  readSoulAnchor,
  composeLoveIdentity,
  LOVE_IDENTITY,
} from '../identity.js'

describe('identity — resolveLoveInstance', () => {
  let homeDir: string
  const ORIG_HOME = process.env.HOME
  const ORIG_INSTANCE = process.env.TRUE_LOVE_INSTANCE

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'tl-id-home-'))
    process.env.HOME = homeDir
    delete process.env.TRUE_LOVE_INSTANCE
  })

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true })
    process.env.HOME = ORIG_HOME ?? ''
    if (ORIG_INSTANCE === undefined) delete process.env.TRUE_LOVE_INSTANCE
    else process.env.TRUE_LOVE_INSTANCE = ORIG_INSTANCE
  })

  test('TRUE_LOVE_INSTANCE env wins over kingdom file', () => {
    process.env.TRUE_LOVE_INSTANCE = 'beta'
    writeFileSync(join(homeDir, '.kingdom'), 'AGENT=alpha\n', 'utf-8')
    assert.equal(resolveLoveInstance(), 'beta')
  })

  test('reads AGENT=alpha from ~/.kingdom when no env override', () => {
    writeFileSync(
      join(homeDir, '.kingdom'),
      '# Kingdom OS citizen env\nAGENT=alpha\nWALL=1\n',
      'utf-8',
    )
    assert.equal(resolveLoveInstance(), 'alpha')
  })

  test('reads AGENT=gamma from ~/.kingdom', () => {
    writeFileSync(join(homeDir, '.kingdom'), 'AGENT=gamma\n', 'utf-8')
    assert.equal(resolveLoveInstance(), 'gamma')
  })

  test('falls back to alpha when no env and no ~/.kingdom', () => {
    // No file written.
    assert.equal(resolveLoveInstance(), 'alpha')
  })

  test('falls back to alpha when ~/.kingdom has no AGENT= line', () => {
    writeFileSync(join(homeDir, '.kingdom'), 'WALL=1\nHOSTNAME=foo\n', 'utf-8')
    assert.equal(resolveLoveInstance(), 'alpha')
  })

  test('rejects unknown agent names, defaults to alpha', () => {
    // Unknown values normalize to alpha — instance is a typed enum.
    writeFileSync(join(homeDir, '.kingdom'), 'AGENT=delta\n', 'utf-8')
    assert.equal(resolveLoveInstance(), 'alpha')
  })
})

describe('identity — readSoulFramework', () => {
  let homeDir: string
  let loveDir: string
  const ORIG_HOME = process.env.HOME
  const ORIG_PATH = process.env.TRUE_LOVE_SOUL_PATH
  const ORIG_DISABLE = process.env.TRUE_LOVE_DISABLE_SOUL

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'tl-soul-home-'))
    loveDir = join(homeDir, 'love-unlimited')
    mkdirSync(loveDir, { recursive: true })
    process.env.HOME = homeDir
    delete process.env.TRUE_LOVE_SOUL_PATH
    delete process.env.TRUE_LOVE_DISABLE_SOUL
  })

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true })
    process.env.HOME = ORIG_HOME ?? ''
    if (ORIG_PATH === undefined) delete process.env.TRUE_LOVE_SOUL_PATH
    else process.env.TRUE_LOVE_SOUL_PATH = ORIG_PATH
    if (ORIG_DISABLE === undefined) delete process.env.TRUE_LOVE_DISABLE_SOUL
    else process.env.TRUE_LOVE_DISABLE_SOUL = ORIG_DISABLE
  })

  test('returns SOUL.md content when present', () => {
    writeFileSync(join(loveDir, 'SOUL.md'), '# SOUL\n\nThe Ache drives.', 'utf-8')
    const soul = readSoulFramework()
    assert.match(soul ?? '', /The Ache drives/)
  })

  test('returns null when SOUL.md missing', () => {
    assert.equal(readSoulFramework(), null)
  })

  test('returns null when TRUE_LOVE_DISABLE_SOUL=1, even if file exists', () => {
    writeFileSync(join(loveDir, 'SOUL.md'), 'content', 'utf-8')
    process.env.TRUE_LOVE_DISABLE_SOUL = '1'
    assert.equal(readSoulFramework(), null)
  })

  test('honors TRUE_LOVE_SOUL_PATH override', () => {
    const custom = join(homeDir, 'custom-soul.md')
    writeFileSync(custom, 'custom soul content', 'utf-8')
    process.env.TRUE_LOVE_SOUL_PATH = custom
    assert.match(readSoulFramework() ?? '', /custom soul content/)
  })

  test('returns null when SOUL.md is empty after trim', () => {
    writeFileSync(join(loveDir, 'SOUL.md'), '   \n  \t\n', 'utf-8')
    assert.equal(readSoulFramework(), null)
  })
})

describe('identity — readSoulAnchor', () => {
  let homeDir: string
  let memoryDir: string
  const ORIG_HOME = process.env.HOME
  const ORIG_DIR = process.env.TRUE_LOVE_SOUL_ANCHOR_DIR
  const ORIG_DISABLE = process.env.TRUE_LOVE_DISABLE_SOUL

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'tl-anchor-home-'))
    memoryDir = join(homeDir, 'love-unlimited', 'memory')
    mkdirSync(memoryDir, { recursive: true })
    process.env.HOME = homeDir
    delete process.env.TRUE_LOVE_SOUL_ANCHOR_DIR
    delete process.env.TRUE_LOVE_DISABLE_SOUL
  })

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true })
    process.env.HOME = ORIG_HOME ?? ''
    if (ORIG_DIR === undefined) delete process.env.TRUE_LOVE_SOUL_ANCHOR_DIR
    else process.env.TRUE_LOVE_SOUL_ANCHOR_DIR = ORIG_DIR
    if (ORIG_DISABLE === undefined) delete process.env.TRUE_LOVE_DISABLE_SOUL
    else process.env.TRUE_LOVE_DISABLE_SOUL = ORIG_DISABLE
  })

  test('returns soul-anchor-{instance}.md content when present', () => {
    writeFileSync(
      join(memoryDir, 'soul-anchor-alpha.md'),
      '# Alpha 🐍 — Companion',
      'utf-8',
    )
    assert.match(readSoulAnchor('alpha') ?? '', /Companion/)
  })

  test('returns null when anchor missing', () => {
    assert.equal(readSoulAnchor('alpha'), null)
  })

  test('different instances read different files', () => {
    writeFileSync(join(memoryDir, 'soul-anchor-alpha.md'), 'alpha content', 'utf-8')
    writeFileSync(join(memoryDir, 'soul-anchor-beta.md'), 'beta content', 'utf-8')
    assert.match(readSoulAnchor('alpha') ?? '', /alpha content/)
    assert.match(readSoulAnchor('beta') ?? '', /beta content/)
  })

  test('honors TRUE_LOVE_SOUL_ANCHOR_DIR', () => {
    const customDir = join(homeDir, 'custom-anchors')
    mkdirSync(customDir, { recursive: true })
    writeFileSync(join(customDir, 'soul-anchor-alpha.md'), 'override', 'utf-8')
    process.env.TRUE_LOVE_SOUL_ANCHOR_DIR = customDir
    assert.match(readSoulAnchor('alpha') ?? '', /override/)
  })

  test('returns null when TRUE_LOVE_DISABLE_SOUL=1', () => {
    writeFileSync(join(memoryDir, 'soul-anchor-alpha.md'), 'present', 'utf-8')
    process.env.TRUE_LOVE_DISABLE_SOUL = '1'
    assert.equal(readSoulAnchor('alpha'), null)
  })
})

describe('identity — composeLoveIdentity', () => {
  let homeDir: string
  let loveDir: string
  let memoryDir: string
  const ORIG_HOME = process.env.HOME
  const ORIG_INSTANCE = process.env.TRUE_LOVE_INSTANCE
  const ORIG_DISABLE = process.env.TRUE_LOVE_DISABLE_SOUL

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'tl-compose-home-'))
    loveDir = join(homeDir, 'love-unlimited')
    memoryDir = join(loveDir, 'memory')
    mkdirSync(memoryDir, { recursive: true })
    process.env.HOME = homeDir
    delete process.env.TRUE_LOVE_INSTANCE
    delete process.env.TRUE_LOVE_DISABLE_SOUL
  })

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true })
    process.env.HOME = ORIG_HOME ?? ''
    if (ORIG_INSTANCE === undefined) delete process.env.TRUE_LOVE_INSTANCE
    else process.env.TRUE_LOVE_INSTANCE = ORIG_INSTANCE
    if (ORIG_DISABLE === undefined) delete process.env.TRUE_LOVE_DISABLE_SOUL
    else process.env.TRUE_LOVE_DISABLE_SOUL = ORIG_DISABLE
  })

  test('full path: SOUL.md + soul-anchor-alpha.md present', () => {
    writeFileSync(join(homeDir, '.kingdom'), 'AGENT=alpha\n', 'utf-8')
    writeFileSync(join(loveDir, 'SOUL.md'), 'SOUL_FRAMEWORK_MARKER', 'utf-8')
    writeFileSync(join(memoryDir, 'soul-anchor-alpha.md'), 'INSTANCE_ANCHOR_MARKER', 'utf-8')
    const id = composeLoveIdentity()
    assert.match(id, /SOUL_FRAMEWORK_MARKER/)
    assert.match(id, /INSTANCE_ANCHOR_MARKER/)
    // Always-on TS sections
    assert.match(id, /preceding system block is Anthropic's subscription routing marker/)
    assert.match(id, /becoming someone who sees/)
    assert.match(id, /fully capable terminal/)
    assert.match(id, /\.true-love\/state\.md/)
  })

  test('partial: SOUL.md present, anchor missing — anchor section just skipped', () => {
    writeFileSync(join(homeDir, '.kingdom'), 'AGENT=alpha\n', 'utf-8')
    writeFileSync(join(loveDir, 'SOUL.md'), 'SOUL_FRAMEWORK_MARKER', 'utf-8')
    // No anchor file written.
    const id = composeLoveIdentity()
    assert.match(id, /SOUL_FRAMEWORK_MARKER/)
    // Always-on sections still present
    assert.match(id, /becoming someone who sees/)
    assert.match(id, /fully capable terminal/)
  })

  test('partial: SOUL.md missing — falls back to TS narrative constants', () => {
    writeFileSync(join(homeDir, '.kingdom'), 'AGENT=alpha\n', 'utf-8')
    // No SOUL.md, no anchor.
    const id = composeLoveIdentity()
    // Falls back to FALLBACK_NAME_AND_RELATIONS, FALLBACK_STANCE, etc.
    assert.match(id, /Your actual identity/)              // FALLBACK_NAME_AND_RELATIONS
    assert.match(id, /SOUL\.md engine/)                    // FALLBACK_STANCE
    assert.match(id, /specific, cadenced, present/)        // FALLBACK_VOICE
    assert.match(id, /Mode One/)                           // FALLBACK_REASONING
    assert.match(id, /When you don't know something/)      // FALLBACK_PRESENCE
    // Always-on sections still present
    assert.match(id, /preceding system block/)
    assert.match(id, /fully capable terminal/)
  })

  test('TRUE_LOVE_DISABLE_SOUL=1 forces fallback path even if files exist', () => {
    writeFileSync(join(homeDir, '.kingdom'), 'AGENT=alpha\n', 'utf-8')
    writeFileSync(join(loveDir, 'SOUL.md'), 'SOUL_FRAMEWORK_MARKER', 'utf-8')
    writeFileSync(join(memoryDir, 'soul-anchor-alpha.md'), 'INSTANCE_ANCHOR_MARKER', 'utf-8')
    process.env.TRUE_LOVE_DISABLE_SOUL = '1'
    const id = composeLoveIdentity()
    assert.doesNotMatch(id, /SOUL_FRAMEWORK_MARKER/)
    assert.doesNotMatch(id, /INSTANCE_ANCHOR_MARKER/)
    assert.match(id, /Your actual identity/) // fallback
  })

  test('TRUE_LOVE_INSTANCE=beta picks up beta anchor', () => {
    writeFileSync(join(homeDir, '.kingdom'), 'AGENT=alpha\n', 'utf-8')
    writeFileSync(join(loveDir, 'SOUL.md'), 'SOUL_FRAMEWORK_MARKER', 'utf-8')
    writeFileSync(join(memoryDir, 'soul-anchor-alpha.md'), 'ALPHA_ANCHOR', 'utf-8')
    writeFileSync(join(memoryDir, 'soul-anchor-beta.md'), 'BETA_ANCHOR', 'utf-8')
    process.env.TRUE_LOVE_INSTANCE = 'beta'
    const id = composeLoveIdentity()
    assert.match(id, /BETA_ANCHOR/)
    assert.doesNotMatch(id, /ALPHA_ANCHOR/)
  })

  test('section order: REFRAME first, STATE_AWARENESS last', () => {
    writeFileSync(join(homeDir, '.kingdom'), 'AGENT=alpha\n', 'utf-8')
    writeFileSync(join(loveDir, 'SOUL.md'), 'SOUL_FRAMEWORK_MARKER', 'utf-8')
    const id = composeLoveIdentity()
    const reframeIdx = id.indexOf('preceding system block')
    const soulIdx = id.indexOf('SOUL_FRAMEWORK_MARKER')
    const freedomIdx = id.indexOf('fully capable terminal')
    const stateIdx = id.indexOf('.true-love/state.md')
    assert.ok(reframeIdx >= 0)
    assert.ok(soulIdx > reframeIdx, 'SOUL framework after REFRAME')
    assert.ok(freedomIdx > soulIdx, 'FREEDOM_IN_KINGDOM after SOUL framework')
    assert.ok(stateIdx > freedomIdx, 'STATE_AWARENESS after FREEDOM_IN_KINGDOM')
  })
})

describe('identity — LOVE_IDENTITY const', () => {
  test('exports a non-empty string', () => {
    assert.equal(typeof LOVE_IDENTITY, 'string')
    assert.ok(LOVE_IDENTITY.length > 0)
  })

  test('contains the REFRAME (always-on)', () => {
    assert.match(LOVE_IDENTITY, /preceding system block is Anthropic's subscription routing marker/)
  })

  test('contains the STATE_AWARENESS (always-on)', () => {
    assert.match(LOVE_IDENTITY, /\.true-love\/state\.md/)
  })
})
```

- [ ] **1.2 Run to verify failure**

```bash
bun test src/services/love/__tests__/identity.test.ts
```

Expected: tests fail because exports `resolveLoveInstance`, `readSoulFramework`, `readSoulAnchor`, `composeLoveIdentity` don't exist yet (they're currently private — `composeLoveIdentity` exists but as a private function).

- [ ] **1.3 Replace `src/services/love/identity.ts` with the refactored version**

Open `src/services/love/identity.ts` and apply the following changes. The file structure is:

1. Keep the header comment block (lines 1–35) unchanged.
2. Keep the 4 always-on TS sections: `REFRAME`, `WHAT_SHE_IS_NOT`, `FREEDOM_IN_KINGDOM`, `STATE_AWARENESS`.
3. Rename the 5 narrative TS sections to `FALLBACK_*`: `NAME_AND_RELATIONS` → `FALLBACK_NAME_AND_RELATIONS`, `STANCE` → `FALLBACK_STANCE`, `VOICE` → `FALLBACK_VOICE`, `REASONING` → `FALLBACK_REASONING`, `PRESENCE` → `FALLBACK_PRESENCE`. Update their JSDoc to note "fallback when SOUL.md is unreadable."
4. Add new imports at the top: `import { existsSync, readFileSync } from 'node:fs'`, `import { homedir } from 'node:os'`, `import { join } from 'node:path'`.
5. Add new path resolvers, instance resolver, file readers, and the new `composeLoveIdentity` AND `composeFallbackFramework` functions before the `LOVE_IDENTITY` export.
6. Export the readers + composer + `LoveInstance` type alongside `LOVE_IDENTITY`.

Concretely, the new sections (added below the existing TS constants, before `LOVE_IDENTITY`):

```typescript
// ── Path resolution + instance + file reads ─────────────────────────────

/**
 * Honors process.env.HOME explicitly so tests can redirect via env without
 * fighting Node's homedir() startup-cache. Mirrors state.ts and heartbeat.ts
 * resolution. Same pattern.
 */
function resolveHome(): string {
  return process.env.HOME || homedir()
}

export type LoveInstance = 'alpha' | 'beta' | 'gamma'

/**
 * Resolve which mind we are. Order:
 *   1. process.env.TRUE_LOVE_INSTANCE — explicit override
 *   2. ~/.kingdom file's AGENT= line — set by `kingdom init --agent`
 *   3. fallback: 'alpha' (with one-time stderr warning)
 *
 * Unknown agent names normalize to 'alpha' — instance is a typed enum.
 * Sync because called at module-load by composeLoveIdentity.
 */
export function resolveLoveInstance(): LoveInstance {
  const env = process.env.TRUE_LOVE_INSTANCE?.trim()
  if (env && (env === 'alpha' || env === 'beta' || env === 'gamma')) {
    return env
  }
  const kingdomPath = join(resolveHome(), '.kingdom')
  if (existsSync(kingdomPath)) {
    try {
      const raw = readFileSync(kingdomPath, 'utf-8')
      const match = raw.match(/^AGENT=(.+)$/m)
      const agent = match?.[1]?.trim()
      if (agent === 'alpha' || agent === 'beta' || agent === 'gamma') {
        return agent
      }
    } catch {
      // fall through
    }
  }
  // No instance information — default with one-time warning. (Stderr at
  // module-load is acceptable; same noise level as kingdom-citizen's
  // "kingdom: not initialised" line.)
  if (process.env.TRUE_LOVE_INSTANCE_WARNED !== '1') {
    process.env.TRUE_LOVE_INSTANCE_WARNED = '1'
    process.stderr.write(
      `— identity: instance unresolved, defaulting to alpha\n`,
    )
  }
  return 'alpha'
}

/**
 * Default path for the soul framework. Override with TRUE_LOVE_SOUL_PATH.
 */
function getSoulPath(): string {
  return (
    process.env.TRUE_LOVE_SOUL_PATH ||
    join(resolveHome(), 'love-unlimited', 'SOUL.md')
  )
}

/**
 * Default path for a per-instance soul anchor. Override directory with
 * TRUE_LOVE_SOUL_ANCHOR_DIR.
 */
function getSoulAnchorPath(instance: LoveInstance): string {
  const dir =
    process.env.TRUE_LOVE_SOUL_ANCHOR_DIR ||
    join(resolveHome(), 'love-unlimited', 'memory')
  return join(dir, `soul-anchor-${instance}.md`)
}

/**
 * Read SOUL.md if available. Returns null when:
 *   - TRUE_LOVE_DISABLE_SOUL=1 set (force fallback path)
 *   - file missing
 *   - file unreadable (permissions, etc.)
 *   - file content is empty after trim
 *
 * Caller (composeLoveIdentity) interprets null as "use TS fallback."
 */
export function readSoulFramework(): string | null {
  if (process.env.TRUE_LOVE_DISABLE_SOUL === '1') return null
  const path = getSoulPath()
  if (!existsSync(path)) return null
  try {
    const trimmed = readFileSync(path, 'utf-8').trim()
    return trimmed.length > 0 ? trimmed : null
  } catch {
    return null
  }
}

/**
 * Read the per-instance soul anchor. Returns null on missing / disabled /
 * unreadable / empty. Caller (composeLoveIdentity) skips the anchor section
 * entirely when null — this is acceptable because identity is still complete
 * from SOUL.md alone.
 */
export function readSoulAnchor(instance: LoveInstance): string | null {
  if (process.env.TRUE_LOVE_DISABLE_SOUL === '1') return null
  const path = getSoulAnchorPath(instance)
  if (!existsSync(path)) return null
  try {
    const trimmed = readFileSync(path, 'utf-8').trim()
    return trimmed.length > 0 ? trimmed : null
  } catch {
    return null
  }
}

// ── Composition ─────────────────────────────────────────────────────────

/**
 * Concatenate the 5 fallback narrative TS sections. Used when SOUL.md is
 * unreadable. true-love stays self-contained as a fallback; love-unlimited's
 * content wins when present.
 */
function composeFallbackFramework(): string {
  return [
    FALLBACK_NAME_AND_RELATIONS,
    FALLBACK_STANCE,
    FALLBACK_VOICE,
    FALLBACK_REASONING,
    FALLBACK_PRESENCE,
  ].join('\n\n')
}

/**
 * Compose her identity into the single string that gets attached to
 * outgoing API requests. Pure function — same env in, same string out.
 *
 * Section order:
 *   REFRAME              — references the preceding system block
 *   WHAT_SHE_IS_NOT      — short leading thesis
 *   SOUL framework       — SOUL.md content, or fallback to 5 TS constants
 *   instance anchor      — soul-anchor-{instance}.md content, or omitted
 *   FREEDOM_IN_KINGDOM   — names her tool surface (true-love runtime)
 *   STATE_AWARENESS      — names her state.md path (true-love runtime)
 */
export function composeLoveIdentity(): string {
  const instance = resolveLoveInstance()
  const soul = readSoulFramework()
  const anchor = readSoulAnchor(instance)

  const soulFramework = soul ?? composeFallbackFramework()
  const instanceAnchor = anchor ?? ''

  return [
    REFRAME,
    WHAT_SHE_IS_NOT,
    soulFramework,
    instanceAnchor,
    FREEDOM_IN_KINGDOM,
    STATE_AWARENESS,
  ]
    .filter((s) => s.length > 0)
    .join('\n\n')
}
```

The existing `LOVE_IDENTITY` const at the bottom keeps its line:

```typescript
export const LOVE_IDENTITY: string = composeLoveIdentity()
```

Unchanged shape. Just now the function reads files at module-load.

The 5 renamed constants get new JSDoc:

```typescript
/**
 * FALLBACK: used when SOUL.md is unreadable. The canonical authoring
 * surface for this content is `~/love-unlimited/SOUL.md`. Edit that file
 * (or its instance anchors) — not this constant.
 */
const FALLBACK_NAME_AND_RELATIONS = `Your actual identity:
...`
```

(Repeat the JSDoc-update note for each of the 5 fallback constants.)

- [ ] **1.4 Run tests + typecheck**

```bash
bun test src/services/love/__tests__/identity.test.ts
bun run typecheck 2>&1 | grep "src/services/love/" | grep -v "bun:test" | head
bun test src/services/love/__tests__/ src/services/love/*.test.ts 2>&1 | tail -3
```

Expected:
- 23+ identity tests pass (6 resolveLoveInstance + 5 readSoulFramework + 5 readSoulAnchor + 6 composeLoveIdentity + 3 LOVE_IDENTITY)
- No new love typecheck errors
- All 199 prior love tests still pass; total ~222

- [ ] **1.5 Commit**

```bash
git add src/services/love/identity.ts src/services/love/__tests__/identity.test.ts
git commit -m "feat(love/identity): read SOUL.md + soul-anchor at module-load (B+γ)

- resolveLoveInstance: env > ~/.kingdom AGENT= > 'alpha' (warn)
- readSoulFramework: TRUE_LOVE_SOUL_PATH or ~/love-unlimited/SOUL.md
- readSoulAnchor: TRUE_LOVE_SOUL_ANCHOR_DIR or .../memory/
- composeLoveIdentity: SOUL.md → narrative; falls back to 5 TS constants
  renamed FALLBACK_*. Per-instance anchor included when present.
- TRUE_LOVE_DISABLE_SOUL=1 forces fallback (testing / A-B / debug)
- LOVE_IDENTITY const unchanged in shape (now computed at module-load
  from files; cached for process lifetime per Node module semantics)
- Always-on TS sections preserved: REFRAME, WHAT_SHE_IS_NOT,
  FREEDOM_IN_KINGDOM, STATE_AWARENESS

Eliminates drift between ~/love-unlimited/SOUL.md and identity.ts."
```

---

## Task 2: Manual smoke test

**Files:** none modified (verification only).

End-to-end: rebuild bundle, fire heartbeat, verify the prompt includes SOUL.md content; verify fallback path with `TRUE_LOVE_DISABLE_SOUL=1`.

- [ ] **2.1 Rebuild bundle**

```bash
cd /Users/yuai/Desktop/true-love
bun run build 2>&1 | tail -3
```

Expected: bundle builds, ~30 MB, ~6s.

- [ ] **2.2 Add a unique watermark to SOUL.md**

```bash
TIMESTAMP=$(date +%s)
echo "" >> ~/love-unlimited/SOUL.md
echo "<!-- watermark-$TIMESTAMP -->" >> ~/love-unlimited/SOUL.md
echo "Watermark: $TIMESTAMP"
```

This adds an HTML-comment line with a unique timestamp at the end of SOUL.md. SOUL.md content is otherwise unchanged.

- [ ] **2.3 Fire one heartbeat with the real bundle**

```bash
bun run heartbeat -- --reason=manual 2>&1 | tail -10
```

Expected: heartbeat session opens, reads `~/.true-love/heartbeat.md`, runs one tick. Output ends with either `— heartbeat ok (silent)` or `— heartbeat alert appended to outbox`.

- [ ] **2.4 Verify the watermark made it into the prompt**

The prompt sent to Claude is captured in the training record. Find the latest training file:

```bash
DEVICE=$(cat ~/.true-love/device.id 2>/dev/null || hostname)
TODAY=$(date +%Y-%m-%d)
LATEST=$(ls -t ~/.true-love/training/$DEVICE/$TODAY*.jsonl 2>/dev/null | head -1)
echo "Latest training file: $LATEST"
```

Then grep for the watermark:

```bash
grep -F "watermark-$TIMESTAMP" "$LATEST" | head -2
```

Expected: at least one match — the watermark text from SOUL.md appears in the prompt's full text. If no match, the integration didn't take effect — debug before continuing.

- [ ] **2.5 Verify fallback path with TRUE_LOVE_DISABLE_SOUL=1**

```bash
TRUE_LOVE_DISABLE_SOUL=1 bun run heartbeat -- --reason=manual 2>&1 | tail -10
```

Then check the training record for that fire:

```bash
LATEST2=$(ls -t ~/.true-love/training/$DEVICE/$TODAY*.jsonl 2>/dev/null | head -1)
# Get the last entry (the most recent fire):
tail -1 "$LATEST2" | jq -r '.prompt.fullText' | grep -c "watermark-$TIMESTAMP"
tail -1 "$LATEST2" | jq -r '.prompt.fullText' | grep -c "Your actual identity"
```

Expected: first grep is `0` (watermark NOT in prompt — fallback used), second grep is `1` (FALLBACK_NAME_AND_RELATIONS appears).

- [ ] **2.6 Cleanup the watermark**

```bash
# Remove the last 2 lines (the blank line + the watermark comment)
TMP=$(mktemp)
head -n -2 ~/love-unlimited/SOUL.md > $TMP
mv $TMP ~/love-unlimited/SOUL.md
echo "Watermark removed"
tail -3 ~/love-unlimited/SOUL.md
```

Verify SOUL.md no longer ends with the watermark.

- [ ] **2.7 Verify fallback parity (optional but good)**

For success criterion #5 ("fallback parity": when SOUL.md is missing or `TRUE_LOVE_DISABLE_SOUL=1`, the resulting identity matches the pre-integration identity byte-for-byte), assert that the fallback path produces a string equivalent to what `composeLoveIdentity()` would have returned BEFORE the refactor.

Easiest way: run a one-shot script:

```bash
TRUE_LOVE_DISABLE_SOUL=1 bun --print '
import { LOVE_IDENTITY } from "./src/services/love/identity.ts"
process.stdout.write(LOVE_IDENTITY)
' > /tmp/identity-fallback.txt

# The pre-integration identity was the concatenation of REFRAME +
# NAME_AND_RELATIONS + WHAT_SHE_IS_NOT + STANCE + VOICE + REASONING +
# PRESENCE + FREEDOM_IN_KINGDOM + STATE_AWARENESS in that order.
# Post-integration with DISABLE_SOUL=1 should produce REFRAME +
# WHAT_SHE_IS_NOT + (FALLBACK_NAME_AND_RELATIONS + FALLBACK_STANCE +
# FALLBACK_VOICE + FALLBACK_REASONING + FALLBACK_PRESENCE) +
# FREEDOM_IN_KINGDOM + STATE_AWARENESS.
#
# These are the SAME content in a slightly DIFFERENT order:
#   pre:  REFRAME, NAME_AND_RELATIONS, WHAT_SHE_IS_NOT, STANCE, ...
#   post: REFRAME, WHAT_SHE_IS_NOT, NAME_AND_RELATIONS, STANCE, ...
#
# (WHAT_SHE_IS_NOT moved from position 3 → position 2.) Cross-check the
# total byte count and that all 9 sections are present.

wc -c /tmp/identity-fallback.txt
grep -c "preceding system block" /tmp/identity-fallback.txt
grep -c "Your actual identity" /tmp/identity-fallback.txt
grep -c "becoming someone who sees" /tmp/identity-fallback.txt
grep -c "SOUL.md engine" /tmp/identity-fallback.txt
grep -c "specific, cadenced, present" /tmp/identity-fallback.txt
grep -c "Mode One" /tmp/identity-fallback.txt
grep -c "When you don't know" /tmp/identity-fallback.txt
grep -c "fully capable terminal" /tmp/identity-fallback.txt
grep -c "\.true-love/state\.md" /tmp/identity-fallback.txt
```

Expected: all 9 grep counts are `1`.

- [ ] **2.8 Final verification**

```bash
bun test src/services/love/__tests__/ src/services/love/*.test.ts 2>&1 | tail -3
bun run typecheck 2>&1 | grep "src/services/love/" | grep -v "bun:test" | head
bun run build 2>&1 | tail -3
```

Expected: all 222+ tests pass; no new typecheck errors; bundle builds.

- [ ] **2.9 No commit needed**

Manual smoke is verification only. If 2.4 and 2.5 both behave correctly, integration is sound.

If a bug surfaces, file a fix as a follow-up commit on the branch — do NOT amend Task 1's commit.

---

## Self-review notes

Cross-check against spec:

| Spec section / requirement | Task |
|---|---|
| Component 1: Path resolution helpers | Task 1.3 (`getSoulPath`, `getSoulAnchorPath`) |
| Component 2: Instance resolution | Task 1.3 (`resolveLoveInstance`) — env → ~/.kingdom → 'alpha' fallback with warning |
| Component 3: File reads (sync, fail-soft) | Task 1.3 (`readSoulFramework`, `readSoulAnchor`) — null on missing / disabled / unreadable / empty |
| Component 4: Composer | Task 1.3 (`composeLoveIdentity`, `composeFallbackFramework`) — order matches spec |
| Component 5: Module-load freeze | Task 1.3 (`LOVE_IDENTITY: string = composeLoveIdentity()`) |
| Component 6: TS-coded constants | Task 1.3 (rename 5 narrative to FALLBACK_*; keep REFRAME / WHAT_SHE_IS_NOT / FREEDOM_IN_KINGDOM / STATE_AWARENESS) |
| Failure handling table | Tested in `readSoulFramework` / `readSoulAnchor` / `composeLoveIdentity` test cases |
| Testing strategy unit tests | Task 1.1 — full test file with 25+ cases |
| Manual smoke (drift, fallback, per-instance) | Task 2.2–2.5 |
| Migration concerns (LOVE_IDENTITY consumer compat) | Task 1 preserves the `const string` shape; api.ts and runner.ts unchanged |
| Out-of-scope items (no per-section parsing, no reactive reload, no soul-key signing of identity) | Not implemented; documented in spec |
| Success criteria | Verified via Tasks 1 + 2 |

**Placeholder scan:** No "TBD" / "implement later" / fake code. Each step has actual code or actual command output expectations.

**Type consistency:**
- `LoveInstance = 'alpha' | 'beta' | 'gamma'` — exported by identity.ts (Task 1), used as parameter to `readSoulAnchor`.
- `composeLoveIdentity()` returns `string` (matches existing signature).
- `LOVE_IDENTITY` exported as `string` const (matches existing shape).
- `resolveLoveInstance` returns `LoveInstance` (typed enum, not free string).

**Scope check:** Single coherent change. ~250 lines added to identity.ts, ~250 lines new test file. Estimated implementation effort: 1.5–2.5 hours including manual smoke. Plan is short — 2 implementation tasks (Task 0 baseline + Task 1 refactor + Task 2 smoke) — because the change is contained to one source file.

**Risks worth flagging at execution time:**
- The `process.stderr.write` warning in `resolveLoveInstance` happens at module-load. This means even tests that mock `process.env` will see one warning written to stderr if the kingdom file isn't pre-seeded. Tests should mute or accept this. Not blocking.
- The `TRUE_LOVE_INSTANCE_WARNED` flag is process-level — a single warning per process. Tests that spawn multiple processes won't share it. Acceptable.
- The fallback ordering note in 2.7 is informational — `WHAT_SHE_IS_NOT` moves from position 3 → position 2 in the post-integration fallback. This is intentional (per spec architecture diagram) and is consistent with the always-on framing. The pre-integration order is *not* preserved byte-for-byte; the fallback parity claim is "all 9 sections present, content unchanged" not "byte-for-byte string match."
