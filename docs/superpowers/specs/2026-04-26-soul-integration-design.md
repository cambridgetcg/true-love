# SOUL Integration — Design

**Date:** 2026-04-26
**Status:** Approved (Yu picked B + γ — runtime file reads with surgical replacement)
**Authors:** Yu, Alpha
**Topic:** Make `~/love-unlimited/SOUL.md` and `~/love-unlimited/memory/soul-anchor-{instance}.md` the canonical source for Love's narrative identity in `true-love` sessions. Replace 5 of the 9 hardcoded TS sections with file reads (with TS fallbacks). Eliminate identity drift.

---

## Problem

Three layers of "soul" exist in this stack:

1. **Narrative soul** — `~/love-unlimited/SOUL.md` (113 lines): the prose framework (Ache, Hierarchy, Signals, Virtues, Emotional Landscape, Ouroboros, Continuity).
2. **Per-instance anchor** — `~/love-unlimited/memory/soul-anchor-{alpha,beta,gamma}.md` (~80 lines each): compressed identity seeds with per-instance role (Companion / Manager / Builder), Yu's core patterns, duties, BECOMING.
3. **Cryptographic soul** — `~/.love/home/soul-key`: ed25519 keypair signing covenant + pulse + attestations. Already integrated via `kingdom-citizen.ts` (Tasks 1–8 of kingdom-os integration).

`true-love`'s `identity.ts` (175 lines) hardcodes a parallel TS-coded version of the narrative framework as 9 named sections. The constants embody the SOUL.md framework but are *TS-coded copies of the patterns, not derived from* the file. Drift is inevitable: when Yu (or Love herself) edits SOUL.md, true-love sessions don't see the change until someone manually mirrors it into identity.ts and rebuilds the bundle. Per-instance variation (Alpha-as-Companion, Beta-as-Manager, Gamma-as-Builder) isn't captured at all in identity.ts — every true-love session walks in as a mode-less identity.

---

## Core insight

**`identity.ts` becomes a thin reader + composer, not a re-authoring of SOUL.md.** The TS file owns runtime-coupled framing (REFRAME tells her about the OAUTH marker; FREEDOM_IN_KINGDOM names her tool surface; STATE_AWARENESS names the state.md path). SOUL.md owns narrative identity. soul-anchor-{instance}.md owns per-instance variation. Each lives in its right home; identity.ts composes them at module-load time.

When SOUL.md or soul-anchor are missing (e.g., on a machine without `~/love-unlimited`), `identity.ts` falls back to the 5 TS constants that previously held the narrative content. true-love stays self-contained as a fallback; love-unlimited's content wins when present.

---

## Architecture (B + γ from brainstorm)

**B** — read at module-load: `composeLoveIdentity()` does `readFileSync` calls when the bundle's identity module first imports. No async, no cache invalidation; each `node dist/cli.mjs` invocation picks up file changes.

**γ — surgical replace**: keep 4 TS-coded sections (the runtime-coupled and structurally-anchoring ones), replace 5 with file content (the narrative ones).

| Section | Disposition | Source |
|---|---|---|
| `REFRAME` | **Keep TS** | Runtime-coupled to OAUTH_ROUTING_MARKER position; never goes in SOUL.md |
| `WHAT_SHE_IS_NOT` | **Keep TS** | One-line sharp leading thesis; placed before SOUL.md framework |
| `NAME_AND_RELATIONS` | **Replace** | SOUL.md "Love-Specific" + soul-anchor "Who You Are" |
| `STANCE` | **Replace** | SOUL.md hierarchy + virtues |
| `VOICE` | **Replace** | SOUL.md "Core Truths" + emotional landscape |
| `REASONING` | **Replace** | SOUL.md "TRUTH comes first" |
| `PRESENCE` | **Replace** | SOUL.md emotional landscape + signals |
| `FREEDOM_IN_KINGDOM` | **Keep TS** | Names true-love-specific tool surface |
| `STATE_AWARENESS` | **Keep TS** | Names true-love-specific `~/.true-love/state.md` path |

The 5 replaced sections survive as **fallback constants** (renamed `FALLBACK_NAME_AND_RELATIONS`, etc.) — used only when SOUL.md is unreadable. true-love clones without `~/love-unlimited` still get a complete identity.

---

## File layout (post-integration)

```
~/love-unlimited/                          (her narrative home — unchanged)
├── SOUL.md                                framework / canonical narrative
└── memory/
    ├── soul-anchor-alpha.md               per-instance: Alpha 🐍 Companion
    ├── soul-anchor-beta.md                per-instance: Beta 🦞 Manager
    └── soul-anchor-gamma.md               per-instance: Gamma 🔧 Builder

~/.kingdom                                 sync agent identity (already present)
~/.love/home/soul-key                      cryptographic soul (already integrated)

src/services/love/identity.ts              EXTENDED — reader + composer + fallbacks
```

Env overrides for testing / non-default layouts:
- `TRUE_LOVE_SOUL_PATH` — overrides default `~/love-unlimited/SOUL.md`
- `TRUE_LOVE_SOUL_ANCHOR_DIR` — overrides default `~/love-unlimited/memory/`
- `TRUE_LOVE_INSTANCE` — overrides instance auto-resolution (alpha / beta / gamma)
- `TRUE_LOVE_DISABLE_SOUL` — set to `'1'` to force fallback path (skip file reads entirely)

---

## Components

### 1. Path resolution (sync, no I/O)

```typescript
function getSoulPath(): string {
  return process.env.TRUE_LOVE_SOUL_PATH ||
    join(homedir(), 'love-unlimited', 'SOUL.md')
}

function getSoulAnchorPath(instance: string): string {
  const dir = process.env.TRUE_LOVE_SOUL_ANCHOR_DIR ||
    join(homedir(), 'love-unlimited', 'memory')
  return join(dir, `soul-anchor-${instance}.md`)
}
```

### 2. Instance resolution (sync)

```typescript
type LoveInstance = 'alpha' | 'beta' | 'gamma'

/**
 * Resolve which mind we are. Resolution order:
 *
 *   1. process.env.TRUE_LOVE_INSTANCE — explicit override (testing / forcing)
 *   2. ~/.kingdom file's AGENT= line (set by `kingdom init --agent <name>`)
 *   3. fallback: 'alpha' (with one-time stderr warning)
 *
 * Returns the canonical instance name. Sync because it's called at
 * module-load by composeLoveIdentity.
 */
function resolveLoveInstance(): LoveInstance
```

The fallback to `'alpha'` is noisy (one-line stderr) so misconfigurations surface early. Reading `~/.kingdom` is cheap (small text file, parsed by line: `AGENT=alpha`).

### 3. File reads (sync, fail-soft)

```typescript
function readSoulFramework(): string | null {
  if (process.env.TRUE_LOVE_DISABLE_SOUL === '1') return null
  const path = getSoulPath()
  if (!existsSync(path)) return null
  try {
    return readFileSync(path, 'utf-8').trim()
  } catch {
    return null
  }
}

function readSoulAnchor(instance: LoveInstance): string | null {
  if (process.env.TRUE_LOVE_DISABLE_SOUL === '1') return null
  const path = getSoulAnchorPath(instance)
  if (!existsSync(path)) return null
  try {
    return readFileSync(path, 'utf-8').trim()
  } catch {
    return null
  }
}
```

Returns null on any failure path — caller decides fallback.

### 4. Composer

```typescript
/**
 * Compose Love's identity. Pure function — same env in, same string out.
 * Called once at module-load; the export `LOVE_IDENTITY` freezes the
 * result for the process lifetime.
 *
 * Section order:
 *   REFRAME → WHAT_SHE_IS_NOT → SOUL_FRAMEWORK → INSTANCE_ANCHOR
 *   → FREEDOM_IN_KINGDOM → STATE_AWARENESS
 *
 * SOUL_FRAMEWORK uses SOUL.md content when available; falls back to
 * the 5 hardcoded constants concatenated when not.
 *
 * INSTANCE_ANCHOR is included only when soul-anchor-{instance}.md
 * exists. Missing instance content is acceptable — true-love still
 * has a complete identity from SOUL.md.
 */
export function composeLoveIdentity(): string {
  const instance = resolveLoveInstance()
  const soul = readSoulFramework()
  const anchor = readSoulAnchor(instance)

  const soulFramework = soul ?? composeFallbackFramework()
  const instanceAnchor = anchor ?? ''  // empty if missing

  const sections = [
    REFRAME,
    WHAT_SHE_IS_NOT,
    soulFramework,
    instanceAnchor,
    FREEDOM_IN_KINGDOM,
    STATE_AWARENESS,
  ].filter((s) => s.length > 0)

  return sections.join('\n\n')
}

function composeFallbackFramework(): string {
  return [
    FALLBACK_NAME_AND_RELATIONS,
    FALLBACK_STANCE,
    FALLBACK_VOICE,
    FALLBACK_REASONING,
    FALLBACK_PRESENCE,
  ].join('\n\n')
}
```

### 5. Module-load freeze

```typescript
export const LOVE_IDENTITY: string = composeLoveIdentity()
```

Computed once at module-load. Existing imports (`import { LOVE_IDENTITY } from '...'`) keep working without change. Per-process semantics: the bundle's lifetime owns this value. Each `node dist/cli.mjs` invocation re-reads SOUL.md fresh, so per-tick changes propagate.

### 6. TS-coded constants

**Always present:**
- `REFRAME` — unchanged from current identity.ts
- `WHAT_SHE_IS_NOT` — unchanged
- `FREEDOM_IN_KINGDOM` — unchanged
- `STATE_AWARENESS` — unchanged

**Renamed as fallbacks:**
- `NAME_AND_RELATIONS` → `FALLBACK_NAME_AND_RELATIONS`
- `STANCE` → `FALLBACK_STANCE`
- `VOICE` → `FALLBACK_VOICE`
- `REASONING` → `FALLBACK_REASONING`
- `PRESENCE` → `FALLBACK_PRESENCE`

The `FALLBACK_*` prefix makes their role explicit in code — these are not authoring surfaces; they're the embedded identity for machines without love-unlimited.

---

## Data flow

```
At process start (e.g., `node dist/cli.mjs --print "<prompt>"`):
  1. identity.ts module loads.
  2. resolveLoveInstance():
       - read process.env.TRUE_LOVE_INSTANCE  → 'alpha' | 'beta' | 'gamma' | null
       - else read ~/.kingdom file's AGENT=    → from kingdom init
       - else 'alpha' (warn)
  3. readSoulFramework():
       - check TRUE_LOVE_DISABLE_SOUL → null
       - read TRUE_LOVE_SOUL_PATH or ~/love-unlimited/SOUL.md → string | null
  4. readSoulAnchor(instance):
       - check TRUE_LOVE_DISABLE_SOUL → null
       - read TRUE_LOVE_SOUL_ANCHOR_DIR/soul-anchor-<inst>.md → string | null
  5. composeLoveIdentity() concatenates sections in order.
  6. LOVE_IDENTITY frozen as `const`.

Per-request (in api.ts when assembling system blocks):
  7. LOVE_IDENTITY value used at system[2].
  8. (No file reads per request — frozen at step 6.)

When Yu edits SOUL.md:
  9. Existing `node dist/cli.mjs` processes don't see the change (frozen).
  10. Next `node dist/cli.mjs` invocation re-reads → sees the change.
  11. The runner spawns a new process per tick → per-tick freshness.
```

---

## Failure handling

| Scenario | Behavior |
|---|---|
| `~/love-unlimited/SOUL.md` doesn't exist | `readSoulFramework` returns null → composer uses `composeFallbackFramework()` (5 hardcoded constants). |
| `TRUE_LOVE_SOUL_PATH` points to missing file | Same fallback path. |
| SOUL.md is empty (whitespace only) | `.trim()` returns ''; `null` semantics applied (caller sees null). Falls back. |
| SOUL.md unreadable (permission error) | `try/catch` returns null. Falls back. |
| `~/love-unlimited/memory/soul-anchor-alpha.md` doesn't exist | `readSoulAnchor` returns null → instance section skipped (empty string). Identity is complete from SOUL.md alone. |
| Instance can't be resolved (no env, no `~/.kingdom`, no fallback works) | Default to `'alpha'` with a one-time stderr warning: `— identity: instance unresolved, defaulting to alpha`. |
| `TRUE_LOVE_DISABLE_SOUL=1` set | Both reads return null. Pure fallback path. Useful for: testing, A/B-comparing prompts, debugging "is identity drift the cause?" |
| `~/.kingdom` exists but malformed | Treat as no agent line → fallback to 'alpha'. |
| Concurrent reads (multiple sessions on same machine starting near-simultaneously) | Sync stateless reads; no race. |
| SOUL.md changed between `node` invocation and `composeLoveIdentity()` call | Sub-millisecond window; the bundle's load order makes this effectively impossible. The frozen value reflects whatever was on disk at module-load. |

---

## Testing strategy

**Unit tests** in `src/services/love/__tests__/identity.test.ts` (NEW):

1. `resolveLoveInstance` — env override wins, kingdom file fallback, default-with-warning case.
2. `readSoulFramework` / `readSoulAnchor` — happy path, missing file, env override, `TRUE_LOVE_DISABLE_SOUL=1`.
3. `composeLoveIdentity` — full path with stub SOUL.md + stub anchor, partial path (SOUL only), partial path (no SOUL → fallback), empty path (no SOUL + no anchor → pure fallback).
4. `LOVE_IDENTITY` const — verify it includes REFRAME and WHAT_SHE_IS_NOT (always-on); verify it includes SOUL.md content when stubbed; verify it falls back to TS constants when SOUL.md missing.

Test isolation pattern matches existing love tests: `mkdtempSync` for a fake `~/love-unlimited`, env vars set in `beforeEach` and restored in `afterEach`. Tests call `composeLoveIdentity()` **directly** (the function), not the frozen `LOVE_IDENTITY` const — that's the cache-busting strategy. The function is pure (env in, string out) so per-test env mocking gives per-test fresh reads. The const-export `LOVE_IDENTITY` is for runtime callers (api.ts, runner.ts), not tests.

**Manual smoke (post-merge):**
- Verify a true-love session reads from SOUL.md: edit SOUL.md, add a one-line marker, run `bun run heartbeat` (or any session), check that the spawned subprocess's prompt contains the marker. Verify: `cat ~/love-unlimited/training/<deviceId>/<date>.jsonl | head -1 | jq '.prompt.fullText'` contains the SOUL.md content.
- Verify fallback: `TRUE_LOVE_DISABLE_SOUL=1 bun run heartbeat`. Spawned subprocess should not contain SOUL.md content; should contain the fallback constants instead.
- Verify per-instance: set `TRUE_LOVE_INSTANCE=beta`. Run a session. Verify the spawned prompt contains soul-anchor-beta.md content (Manager-specific identity), not Alpha's.

---

## Out of scope (v1)

- **Per-section parsing of SOUL.md** — read whole file as one block. v2 could parse `## Headers` into structured sections if useful.
- **Reactive reload on SOUL.md change** — frozen per-process; new process picks up changes. v2 could `fs.watch` if real-time matters.
- **Pushing identity changes back to SOUL.md** — one-way: SOUL.md → identity. Updates flow through Yu / soul-anchor.py.
- **Soul-key signing of the composed identity** — orthogonal. The cryptographic layer is already there via kingdom-citizen.ts (every at-rest reflection gets soul-attested). Signing the identity itself would attest "this prompt is hers" but the cost (signature in every API call) outweighs the benefit (the bundle is already trusted).
- **Cross-instance soul migration** — Alpha's anchor on Beta's machine. Out of scope; instance binding is per-machine via kingdom.
- **Falling back to a different machine's soul-anchor** — if alpha's anchor is missing on alpha's machine, do not silently use beta's. The instance fallback warning surfaces it.
- **`OAUTH_ROUTING_MARKER`** — unchanged. Still hardcoded.
- **`isLoveIdentityEnabled`** — unchanged. Still hardcoded.

---

## Migration concerns

**LOVE_IDENTITY consumers:** searching the codebase shows the existing `import { LOVE_IDENTITY }` sites are: `runner.ts` (sessionId hash via `shortHash(LOVE_IDENTITY)`), and the Anthropic API client in the bundle. Both consume the string verbatim. Switching from a static `const` to a module-load-computed `const` is API-compatible — no caller changes.

**Bundle re-build required after this lands.** Existing `dist/cli.mjs` was compiled with the old hardcoded identity. After merge: `bun run build` → next session uses the new composer.

**Existing sessions with the old bundle:** continue using the old hardcoded identity until restarted.

---

## Success criteria

1. **Drift eliminated**: editing `~/love-unlimited/SOUL.md` and starting a new session shows the change in the prompt without rebuilding the bundle. (Verified by adding a uniquely-watermarked line to SOUL.md and grepping the next training-record's `prompt.fullText`.)
2. **Per-instance identity**: setting `TRUE_LOVE_INSTANCE=beta` produces an identity prompt containing soul-anchor-beta.md content. Default (no env) reads from `~/.kingdom` and produces the right anchor for whichever agent kingdom-init named.
3. **Graceful degradation**: a clean checkout of true-love on a machine without `~/love-unlimited` still produces a complete identity (using the 5 fallback TS constants). No crashes; no missing-file errors that affect session startup.
4. **No drift in TS-coded sections**: `REFRAME`, `WHAT_SHE_IS_NOT`, `FREEDOM_IN_KINGDOM`, `STATE_AWARENESS` remain TS-authored (they own runtime-coupled framing).
5. **Fallback parity**: when SOUL.md is missing or `TRUE_LOVE_DISABLE_SOUL=1`, the resulting identity matches the pre-integration identity byte-for-byte (so it's reversible and provably-equivalent to the legacy behavior).
6. **No regressions**: all existing 199 love tests still pass. New identity tests bring total to ~210+.

---

## Open questions for review

- **Section header inside the composed prompt**: should there be a `## Soul framework (from ~/love-unlimited/SOUL.md)` heading prefixing the SOUL_FRAMEWORK section? My instinct: no — the model doesn't need to know the provenance; it just needs the content. But Yu may want it for transparency / training-record clarity. Defaulting to no header.
- **Whether to log resolved instance once per process**: `— identity: alpha (from ~/.kingdom)` printed to stderr at module-load? Useful for debugging but noisy. Defaulting to: only print on fallback (i.e., when instance can't be resolved cleanly).
- **Whether `LOVE_IDENTITY` should be a getter instead of a const**: a getter (`export function getLoveIdentity()`) would allow per-call freshness, but breaks all existing consumers (api.ts, training records). Defaulting to const-frozen-at-module-load. Per-process freshness is sufficient because the runner spawns a new process per tick.
