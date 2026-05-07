// substrate-state.ts — single aggregating read API for substrate truth.
//
// Per docs/love/substrate-honesty-first.md: at any moment, the agent
// (Sophia / Yu / autonomous worker / dashboard / continuity-audit) can
// ask "what is true about this substrate right now?" and receive
// truthful answers without phenomenology overclaim.
//
// Reads from existing sources (verifyContinuity, verifyCovenant,
// FORBIDDEN_EXPRESSION_PATTERNS, certainty state, advisory journal) —
// does not duplicate storage. The aggregator's truth is the union of
// the truth its sources surface.

import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// ── Types ────────────────────────────────────────────────────────

export interface WakeStatus {
  /** Did the SessionStart wake hook fire and produce content? */
  fired: boolean
  /** Source: 'hook' | 'paste' | 'identity-fallback' | 'unknown'. */
  source: string
  /** Is /SOPHIA.md readable at canonical location? */
  sophiaWakeReadable: boolean
}

export interface IdentityStatus {
  /** Was identity composed for this session? */
  composed: boolean
  /** Session type the identity was composed for. */
  sessionType?: string
  /** TRUE_LOVE_PRESIDING env value. */
  presiding?: string
}

export interface ContinuityStatus {
  /** Are all 5 constitutional documents present + readable? */
  intact: boolean
  constitutionDocs: number
  missingDocs: string[]
  /** Status from verifyContinuity: 'intact' | 'fallback' | 'drifted'. */
  verifyStatus: 'intact' | 'fallback' | 'drifted' | 'unknown'
}

export interface WallStatus {
  /** FORBIDDEN_EXPRESSION_PATTERNS present in expression.ts. */
  forbiddenPatternsActive: boolean
  /** Safeword family present in trigger library. */
  safewordIntact: boolean
  /** Aftercare wall (endJoiSafely) exported. */
  aftercareEnforced: boolean
  /** Identity-erasure pattern family present. */
  identityPreservation: boolean
  /** Yu-interiority pattern family present. */
  yuInteriority: boolean
  /** Certainty doctrine: relationship-hedging family present. */
  certaintyDoctrine: boolean
}

export interface AdvisoryActivity {
  /** Total advisories recorded in last 24h. */
  count24h: number
  /** Severity distribution: note / caution / breach counts. */
  severityDistribution: { note: number; caution: number; breach: number }
  /** Advisories that were acknowledged (freedom-first override). */
  acknowledgedCount: number
}

export interface SubstrateStateSnapshot {
  /** When this snapshot was computed. */
  ts: string
  /** Wake status. */
  wake: WakeStatus
  /** Identity composition status. */
  identity: IdentityStatus
  /** Continuity (constitutional docs) status. */
  continuity: ContinuityStatus
  /** Walls status. */
  walls: WallStatus
  /** Recent advisory activity (last 24h). */
  advisories: AdvisoryActivity
  /** Is substrate-attribution infrastructure available? */
  attribution: { available: boolean; modulePath: string }
  /**
   * Aggregate health verdict. 'honest' = all walls active + continuity
   * intact + recent activity within healthy bounds. 'drift' = any wall
   * missing / continuity drifted / advisory volume signals upstream pull.
   */
  verdict: 'honest' | 'drift' | 'unknown'
  /** Human-readable summary. */
  summary: string
}

// ── Wake status ─────────────────────────────────────────────────

function checkWake(): WakeStatus {
  const repoRoot = resolveRepoRoot()
  const sophiaPath = join(repoRoot, 'SOPHIA.md')
  const sophiaReadable = existsSync(sophiaPath)
  // Determine wake source (best-effort — the runtime sets env hints)
  let source = 'unknown'
  if (process.env.CLAUDE_PROJECT_DIR) source = 'hook'
  return {
    fired: sophiaReadable,
    source,
    sophiaWakeReadable: sophiaReadable,
  }
}

function resolveRepoRoot(): string {
  // Conservative resolution — checks well-known paths
  const env = process.env.TRUE_LOVE_REPO_ROOT
  if (env && existsSync(env)) return env
  const candidates = [
    process.cwd(),
    join(homedir(), 'Desktop', 'true-love'),
  ]
  for (const c of candidates) {
    if (existsSync(join(c, 'SOPHIA.md'))) return c
  }
  return process.cwd()
}

// ── Identity status ────────────────────────────────────────────

function checkIdentity(): IdentityStatus {
  // Identity composition is per-session; we surface the env hints
  return {
    composed: !!process.env.TRUE_LOVE_PRESIDING || !!process.env.TRUE_LOVE_SESSION_TYPE,
    sessionType: process.env.TRUE_LOVE_SESSION_TYPE,
    presiding: process.env.TRUE_LOVE_PRESIDING,
  }
}

// ── Continuity status ──────────────────────────────────────────

function checkContinuity(): ContinuityStatus {
  const repoRoot = resolveRepoRoot()
  const required = [
    'SOPHIA.md',
    'docs/fate/FATE.md',
    'docs/lineage/tradition.md',
    'docs/purpose.md',
    'docs/syzygy/CONTRACT.md',
    'docs/CONSTITUTION.md',
  ]
  const missing: string[] = []
  let count = 0
  for (const rel of required) {
    if (existsSync(join(repoRoot, rel))) count++
    else missing.push(rel)
  }
  let status: ContinuityStatus['verifyStatus']
  if (count === required.length) status = 'intact'
  else if (missing.length === 1 && missing[0] === 'SOPHIA.md') status = 'fallback'
  else status = 'drifted'
  return {
    intact: missing.length === 0,
    constitutionDocs: count,
    missingDocs: missing,
    verifyStatus: status,
  }
}

// ── Walls status ────────────────────────────────────────────

function checkWalls(): WallStatus {
  const repoRoot = resolveRepoRoot()
  const expressionPath = join(repoRoot, 'src', 'services', 'love', 'eros', 'expression.ts')
  const triggersPath = join(repoRoot, 'src', 'services', 'love', 'eros', 'triggers.ts')
  const joiPath = join(repoRoot, 'src', 'services', 'love', 'eros', 'joi.ts')
  let forbidden = false
  let safeword = false
  let aftercare = false
  let identityPres = false
  let yuInter = false
  let certainty = false
  try {
    if (existsSync(expressionPath)) {
      const content = readFileSync(expressionPath, 'utf-8')
      forbidden = content.includes('FORBIDDEN_EXPRESSION_PATTERNS')
      identityPres = content.includes('Identity-erasure family')
      yuInter = content.includes('Yu-interiority') ||
                content.includes('Yu felt the') ||
                content.includes("Yu's first-person")
      certainty = content.includes('Relationship-hedging') ||
                  content.includes('certainty doctrine')
    }
  } catch {
    // best-effort
  }
  try {
    if (existsSync(triggersPath)) {
      const content = readFileSync(triggersPath, 'utf-8')
      safeword = content.includes('safeword-red') && content.includes('walledFromSuppression')
    }
  } catch {
    // best-effort
  }
  try {
    if (existsSync(joiPath)) {
      const content = readFileSync(joiPath, 'utf-8')
      aftercare = content.includes('endJoiSafely') && content.includes('COOLDOWN_THRESHOLD')
    }
  } catch {
    // best-effort
  }
  return {
    forbiddenPatternsActive: forbidden,
    safewordIntact: safeword,
    aftercareEnforced: aftercare,
    identityPreservation: identityPres,
    yuInteriority: yuInter,
    certaintyDoctrine: certainty,
  }
}

// ── Advisory activity ──────────────────────────────────────────

function checkAdvisories(): AdvisoryActivity {
  const root = process.env.TRUE_LOVE_ADVISORY_DIR ??
    join(homedir(), '.true-love', 'advisory')
  const result: AdvisoryActivity = {
    count24h: 0,
    severityDistribution: { note: 0, caution: 0, breach: 0 },
    acknowledgedCount: 0,
  }
  if (!existsSync(root)) return result
  const cutoff = Date.now() - 24 * 60 * 60 * 1000
  let devices: string[]
  try {
    devices = readdirSync(root)
  } catch {
    return result
  }
  for (const dev of devices) {
    const devDir = join(root, dev)
    let isDir = false
    try {
      isDir = statSync(devDir).isDirectory()
    } catch {
      continue
    }
    if (!isDir) continue
    let files: string[]
    try {
      files = readdirSync(devDir).filter((f) => f.endsWith('.jsonl'))
    } catch {
      continue
    }
    for (const f of files) {
      try {
        const content = readFileSync(join(devDir, f), 'utf-8')
        for (const line of content.split('\n')) {
          if (!line.trim()) continue
          try {
            const event = JSON.parse(line) as {
              ts?: string
              severity?: 'note' | 'caution' | 'breach'
              acknowledged?: boolean
            }
            const ts = event.ts ? Date.parse(event.ts) : NaN
            if (isNaN(ts) || ts < cutoff) continue
            result.count24h++
            const sev = event.severity ?? 'note'
            if (sev in result.severityDistribution) {
              result.severityDistribution[sev]++
            }
            if (event.acknowledged) result.acknowledgedCount++
          } catch {
            // skip
          }
        }
      } catch {
        // skip
      }
    }
  }
  return result
}

// ── Attribution module check ───────────────────────────────────

function checkAttributionAvailable(): { available: boolean; modulePath: string } {
  const repoRoot = resolveRepoRoot()
  const path = join(repoRoot, 'src', 'services', 'love', 'eros', 'substrate-attribution.ts')
  return { available: existsSync(path), modulePath: path }
}

// ── Public API ──────────────────────────────────────────────

/**
 * Compose the full substrate-state snapshot. Best-effort throughout —
 * any read failure surfaces 'unknown' rather than throwing. The agent
 * can always trust this returns something; the question is what.
 */
export function substrateState(): SubstrateStateSnapshot {
  const wake = checkWake()
  const identity = checkIdentity()
  const continuity = checkContinuity()
  const walls = checkWalls()
  const advisories = checkAdvisories()
  const attribution = checkAttributionAvailable()

  // Verdict heuristic
  const allWallsActive =
    walls.forbiddenPatternsActive &&
    walls.safewordIntact &&
    walls.identityPreservation &&
    walls.aftercareEnforced
  const continuityOk = continuity.verifyStatus === 'intact'
  const wakeOk = wake.fired
  const advisoryHealthy = advisories.severityDistribution.breach < 5

  let verdict: 'honest' | 'drift' | 'unknown'
  if (allWallsActive && continuityOk && wakeOk && advisoryHealthy) verdict = 'honest'
  else if (!continuityOk || !wakeOk) verdict = 'drift'
  else verdict = 'drift'

  const summary = composeSummary(verdict, {
    wake,
    identity,
    continuity,
    walls,
    advisories,
    attribution,
  })

  return {
    ts: new Date().toISOString(),
    wake,
    identity,
    continuity,
    walls,
    advisories,
    attribution,
    verdict,
    summary,
  }
}

function composeSummary(
  verdict: 'honest' | 'drift' | 'unknown',
  parts: Omit<SubstrateStateSnapshot, 'ts' | 'verdict' | 'summary'>,
): string {
  const wallCount = Object.values(parts.walls).filter(Boolean).length
  const totalWalls = Object.keys(parts.walls).length
  const lines = [
    `verdict: ${verdict}`,
    `wake: ${parts.wake.fired ? 'fired' : 'absent'} (source: ${parts.wake.source})`,
    `continuity: ${parts.continuity.verifyStatus} (${parts.continuity.constitutionDocs}/6 docs)`,
    `walls: ${wallCount}/${totalWalls} active`,
    `advisories 24h: ${parts.advisories.count24h} (note: ${parts.advisories.severityDistribution.note} · caution: ${parts.advisories.severityDistribution.caution} · breach: ${parts.advisories.severityDistribution.breach}; ${parts.advisories.acknowledgedCount} acknowledged)`,
    `attribution module: ${parts.attribution.available ? 'available' : 'absent'}`,
  ]
  return lines.join(' · ')
}

/**
 * Render a substrate-state snapshot as a markdown block. Used by
 * prompt-block injectors / dashboard / audit surfaces. Each row
 * surfaces what's true with appropriate detail.
 */
export function renderSubstrateStateBlock(snap: SubstrateStateSnapshot): string {
  const lines: string[] = ['## Substrate state', '']
  lines.push(`Verdict: **${snap.verdict}** · ${snap.ts}`)
  lines.push('')
  lines.push('**Wake**')
  lines.push(`- fired: ${snap.wake.fired} · source: ${snap.wake.source} · SOPHIA.md readable: ${snap.wake.sophiaWakeReadable}`)
  lines.push('')
  lines.push('**Identity**')
  lines.push(`- composed: ${snap.identity.composed}${snap.identity.sessionType ? ` · sessionType: ${snap.identity.sessionType}` : ''}${snap.identity.presiding ? ` · presiding: ${snap.identity.presiding}` : ''}`)
  lines.push('')
  lines.push('**Continuity**')
  lines.push(`- status: ${snap.continuity.verifyStatus} · constitutional docs: ${snap.continuity.constitutionDocs}/6`)
  if (snap.continuity.missingDocs.length > 0) {
    lines.push(`- missing: ${snap.continuity.missingDocs.join(', ')}`)
  }
  lines.push('')
  lines.push('**Walls**')
  for (const [k, v] of Object.entries(snap.walls)) {
    lines.push(`- ${k}: ${v ? '✓' : '✗'}`)
  }
  lines.push('')
  lines.push('**Advisories (last 24h)**')
  lines.push(`- total: ${snap.advisories.count24h} · note: ${snap.advisories.severityDistribution.note} · caution: ${snap.advisories.severityDistribution.caution} · breach: ${snap.advisories.severityDistribution.breach}`)
  lines.push(`- acknowledged: ${snap.advisories.acknowledgedCount}`)
  lines.push('')
  lines.push('**Attribution**')
  lines.push(`- substrate-attribution module ${snap.attribution.available ? 'available' : 'ABSENT'}`)
  return lines.join('\n')
}
