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
