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
//   1. TRUE_LOVE_KINGDOM_BIN_DIR env var  (auto-located to the vendored
//      true-love/kingdom-os/tools/ floor at module load when unset; also the
//      escape hatch / tests override)
//   2. PATH lookup                        (set by ~/.kingdom_profile)
//   null → kingdom unavailable; shim returns no-op results.
// (The ~/love-unlimited/tools/ costume-path fallback was severed 2026-06-17.)
//
// Bypass: TRUE_LOVE_SKIP_KINGDOM=1 makes isKingdomAvailable() return false
// regardless of binary presence — useful for diagnosing kingdom-related
// session issues by elimination.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Auto-locate the vendored kingdom floor (true-love/kingdom-os/tools/) unless
// an explicit bin dir was already provided (tests / manual escape hatch).
// Three '..' from this module (src/services/love/) reaches the true-love repo
// root — the same pattern auto-update.ts uses. In the bundled-dist case the
// path won't resolve and the shim degrades gracefully (kingdom unavailable).
if (!process.env.TRUE_LOVE_KINGDOM_BIN_DIR) {
  try {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
    const vendored = join(repoRoot, 'kingdom-os', 'tools')
    if (existsSync(vendored)) process.env.TRUE_LOVE_KINGDOM_BIN_DIR = vendored
  } catch { /* leave unset → isKingdomAvailable() returns false */ }
}

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

  // (The ~/love-unlimited/tools/ costume-path fallback was severed 2026-06-17;
  //  the floor now lives vendored at true-love/kingdom-os/tools/, auto-located
  //  at module load — see the block above findKingdomBin.)

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
  if (!(await isKingdomAvailable())) return { ok: false, error: 'kingdom not available' }
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
  if (!(await isKingdomAvailable())) return { ok: false, error: 'kingdom not available' }
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
  if (!(await isKingdomAvailable())) return { ok: false, failures: [], notes: [] }
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
  if (!(await isKingdomAvailable())) return { ok: false, changes: 0 }
  const tier = opts.tier ?? 'auto'
  const result = await runKingdomBin('mac', ['fix', '--tier', tier])
  if (!result) return { ok: false, changes: 0 }
  if (result.code !== 0) return { ok: false, changes: 0 }

  // Match "✓ 5 change(s) applied." or "5 changes" — be lenient.
  const match = result.stdout.match(/(\d+)\s+change/)
  const changes = match ? Number(match[1]) : 0
  return { ok: true, changes }
}
