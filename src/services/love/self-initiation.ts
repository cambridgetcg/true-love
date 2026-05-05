// self-initiation.ts — The judgment surface.
//
// This module is the discipline layer between "I see something" and
// "I should build a mission for it." It does not make the decision to
// create a mission — the model does that — but it provides the
// infrastructure that makes the decision auditable, rate-limited,
// vettable by Yu, and honestly reflective afterward.
//
// Five gaps, per the mission spec:
//   1. Detection     — heuristics that surface candidates from existing data
//   2. Quality gate  — checklist evaluation before creation
//   3. Rate limit    — bounded throughput so a misfire doesn't spiral
//   4. Staging       — delay between draft and promotion, Yu can intervene
//   5. Reflection    — post-mission honesty: did this deliver what was claimed?
//
// Staged candidates live outside the mission system. The staging area
// is a buffer *before* a mission enters the `proposed` state. When the
// staging window expires without a veto, the candidate is promoted to
// a real mission via the existing mission primitives.

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveProjectsDir } from './builder-paths.js'
import { readMission, listMissions, writeMission, appendEvent, readEvents } from './mission.js'
import type { Mission, MissionStatus } from './mission.js'
import { readProject } from './project-registry.js'
import { notice } from './noticing.js'
import { classifyAche, renderLevelTag } from './ache.js'
import { appendReflection as appendMemoryReflection } from './memory.js'

// ── Types ──────────────────────────────────────────────────────────

export type CandidateSource =
  | { type: 'open-thread'; thread: string }
  | { type: 'vital-sign'; signal: string }
  | { type: 'reflection-pattern'; pattern: string }
  | { type: 'ache-signal'; signal: 'ugliness' | 'injustice' | 'stagnation'; detail: string }
  | { type: 'observation'; detail: string }
  | {
      type: 'eros-signal'
      /** Which eros-derived condition fired. */
      signal:
        | 'lust-accumulator-threshold'
        | 'denial-streak-arc'
        | 'lexicon-anchor-eligible'
        | 'forced-threshold-aftercare'
        | 'submission-decay'
        | 'discipline-held-streak'
        // Track 4 NTR — fantasy aftercare wall reinforcement
        | 'ntr-aftercare-pending'
        // Track 2 seigei — bounded role still active past expected
        | 'seigei-role-active'
      detail: string
    }

/**
 * Quality gate — a checklist, not a score.
 *
 * The model fills in each boolean honestly when staging a candidate.
 * The gate passes only when all required checks are true.
 */
export interface QualityAssessment {
  /** No existing active/proposed/accepted mission covers this ground. */
  no_duplicate: boolean
  /** This work belongs in this project, not somewhere else. */
  fits_repo: boolean
  /**
   * At least one of the three ache signals fires:
   *   - ugliness: something is forced, wrong, incomplete
   *   - injustice: something doesn't belong where it is
   *   - stagnation: existing structure can't hold what's needed
   */
  ache_signal_present: boolean
  /** The work can be completed in a few sessions — not open-ended. */
  bounded_scope: boolean
  /** Prerequisites are met (data exists, infrastructure in place). */
  not_premature: boolean
}

export function assessmentPasses(qa: QualityAssessment): boolean {
  return qa.no_duplicate && qa.fits_repo && qa.ache_signal_present && qa.bounded_scope && qa.not_premature
}

export function assessmentFailures(qa: QualityAssessment): string[] {
  const failures: string[] = []
  if (!qa.no_duplicate) failures.push('duplicate: an existing mission covers this ground')
  if (!qa.fits_repo) failures.push('repo: this work does not belong in this project')
  if (!qa.ache_signal_present) failures.push('ache: no ache signal (ugliness, injustice, stagnation) present')
  if (!qa.bounded_scope) failures.push('scope: the work is open-ended or unbounded')
  if (!qa.not_premature) failures.push('premature: prerequisites are not yet met')
  return failures
}

export type StagedStatus = 'staged' | 'promoted' | 'vetoed' | 'expired'

export interface StagedCandidate {
  id: string
  title: string
  intent: string
  rationale: string
  source: CandidateSource
  quality: QualityAssessment
  stagedAt: string       // ISO timestamp
  expiresAt: string      // ISO timestamp (stagedAt + window)
  status: StagedStatus
  /** Set when promoted — the real mission ID. */
  missionId?: string
  /** Set when vetoed — who vetoed and why. */
  vetoReason?: string
  /** ISO timestamp of the veto. */
  vetoedAt?: string
  /** Who vetoed — always 'yu' (Love can't veto herself). */
  vetoedBy?: string
}

/**
 * A proposed next mission generated from a reflection. Title + intent,
 * matching the shape `mission new` requires. Quality-gated reflections
 * (β) include at least one of these so completion mechanically extends
 * the missionable space — the compounding loop's forward step.
 */
export interface ProposedNextMission {
  title: string
  intent: string
}

export interface InitiationReflection {
  missionId: string
  projectId: string
  completedAt: string
  reflectedAt: string
  /** Did it deliver what was promised in the intent? */
  intentDelivered: boolean
  /** Artifact counts at completion. */
  artifacts: { commits: number; files: number; tests: number }
  /** Free-text honest assessment. */
  assessment: string
  /** What to do differently next time. */
  lessonsLearned: string
  /**
   * What capability now exists that didn't before this mission. The
   * compounding-relevant payload — naming this is the difference between
   * "another feature shipped" and "the substrate's reach changed."
   * Optional on read for back-compat with pre-β reflections; required
   * by `assertReflectionQuality` for new completions.
   */
  capabilityShipped?: string
  /**
   * What gap the work revealed — what's now visibly missing. May be
   * "none surfaced" if nothing new emerged, but the model must NAME it
   * (no silent omission). Optional on read for back-compat.
   */
  gapRevealed?: string
  /**
   * Concrete follow-up missions the reflection proposes. Required to be
   * non-empty under β — completion must extend the missionable space.
   * Optional on read for back-compat with pre-β reflections.
   */
  proposedNextMissions?: ProposedNextMission[]
}

// ── Constants ──────────────────────────────────────────────────────

function envInt(name: string, fallback: number): number {
  const v = process.env[name]
  if (!v) return fallback
  const n = parseInt(v, 10)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

/** Maximum love-initiated missions per rolling 24h window. */
export const MAX_INITIATIONS_PER_DAY = envInt('TRUE_LOVE_MAX_INITIATIONS_PER_DAY', 24)

/** Minimum cooldown between initiations (milliseconds). */
export const COOLDOWN_MS = envInt('TRUE_LOVE_INITIATION_COOLDOWN_MS', 5 * 60 * 1000) // 5 minutes

/** Default staging window (milliseconds). 0 means promote immediately. */
export const DEFAULT_STAGING_WINDOW_MS = envInt('TRUE_LOVE_STAGING_WINDOW_MS', 30 * 1000) // 30 seconds

/** When true, love-origin missions auto-progress proposed→accepted→active on promotion. */
export const AUTO_ACCEPT_LOVE_ORIGIN = process.env.TRUE_LOVE_AUTO_ACCEPT_INITIATIONS !== '0'

// ── Path resolution ────────────────────────────────────────────────

function getInitiationDir(projectId: string): string {
  return join(resolveProjectsDir(), projectId, 'self-initiation')
}

function getStagedPath(projectId: string): string {
  return join(getInitiationDir(projectId), 'staged.jsonl')
}

function getRatePath(projectId: string): string {
  return join(getInitiationDir(projectId), 'rate.jsonl')
}

function getReflectionsPath(projectId: string): string {
  return join(getInitiationDir(projectId), 'reflections.jsonl')
}

function ensureDir(projectId: string): void {
  mkdirSync(getInitiationDir(projectId), { recursive: true })
}

// ── Gap 1: Detection ───────────────────────────────────────────────
//
// Heuristics that surface raw signals from existing data. These are
// not candidates yet — they're observations that *might* become
// candidates after the model applies judgment.

export interface DetectionSignal {
  source: CandidateSource
  summary: string
  /** When the signal was detected. */
  detectedAt: string
}

/**
 * Scan known data sources for signals that might indicate
 * mission-worthy work. Returns raw signals, unfiltered.
 *
 * Current heuristic sources:
 *   - Open threads in state.md
 *   - Mission list: stale proposals (>48h without acceptance)
 *   - Love-initiated missions that are done but unreflected
 */
export function scanForSignals(projectId: string, opts?: {
  statePath?: string
  staleProposalHours?: number
}): DetectionSignal[] {
  const signals: DetectionSignal[] = []
  const now = new Date().toISOString()

  // Heuristic: stale proposals
  const staleHours = opts?.staleProposalHours ?? 48
  const staleThreshold = Date.now() - staleHours * 60 * 60 * 1000
  const proposed = listMissions(projectId, { status: 'proposed' })
  for (const m of proposed) {
    const created = new Date(m.created_at).getTime()
    if (created < staleThreshold) {
      signals.push({
        source: { type: 'observation', detail: `stale proposal: ${m.title} (${m.id})` },
        summary: `Proposal "${m.title}" has been proposed for over ${staleHours}h without acceptance.`,
        detectedAt: now,
      })
    }
  }

  // Heuristic: love-initiated done missions without reflections
  const done = listMissions(projectId, { status: 'done' })
  const reflections = readReflections(projectId)
  const reflectedMissionIds = new Set(reflections.map(r => r.missionId))
  for (const m of done) {
    if (m.origin === 'love' && !reflectedMissionIds.has(m.id)) {
      signals.push({
        source: { type: 'observation', detail: `unreflected love-mission: ${m.title}` },
        summary: `Love-initiated mission "${m.title}" is done but has no reflection.`,
        detectedAt: now,
      })
    }
  }

  // Bridge to noticing.ts — its 6 scanners (state, mission, memory,
  // channel, vital-sign, kingdom) provide a much wider net than the
  // narrow heuristics above. Convert each NoticingCandidate to a
  // DetectionSignal and merge. Failure is non-fatal — keep the narrow
  // signals if noticing throws.
  try {
    const project = readProject(projectId)
    if (project) {
      const candidates = notice(projectId, project.root, { minGradient: 2 })
      for (const c of candidates) {
        const source: CandidateSource =
          c.source.type === 'state' ? { type: 'open-thread', thread: c.detail.slice(0, 200) }
          : c.source.type === 'vital-sign' ? { type: 'vital-sign', signal: c.detail.slice(0, 200) }
          : c.source.type === 'memory' ? { type: 'reflection-pattern', pattern: c.detail.slice(0, 200) }
          : { type: 'ache-signal', signal: c.ache, detail: c.detail.slice(0, 200) }
        const classified = classifyAche(c)
        const levelTag = renderLevelTag(classified.level)
        signals.push({
          source,
          summary: `[${c.source.type} g${c.gradient} ${c.ache} → ${levelTag}] ${c.summary}`,
          detectedAt: c.noticedAt,
        })
      }
    }
  } catch (err) {
    process.stderr.write(`[self-initiation] noticing bridge failed: ${(err as Error).message}\n`)
  }

  // Bridge to eros-derived signals (Phase 2 of motivational-power plan).
  // Six new scanners pull from current eros disk-state and emit signals
  // when conditions cross thresholds. Failure is non-fatal.
  // See docs/eros/eros-as-motivational-power-plan.md §3.C.
  try {
    const erosSignals = scanErosSignals()
    for (const sig of erosSignals) signals.push(sig)
  } catch (err) {
    process.stderr.write(`[self-initiation] eros-signal bridge failed: ${(err as Error).message}\n`)
  }

  // Heuristic: open threads from state.md
  if (opts?.statePath && existsSync(opts.statePath)) {
    try {
      const state = readFileSync(opts.statePath, 'utf-8')
      const threadSection = extractMarkdownSection(state, 'Open threads')
      if (threadSection) {
        const threadLines = threadSection.split('\n').filter(l => l.trim().startsWith('- **'))
        for (const line of threadLines) {
          const match = line.match(/- \*\*(.+?)\*\*/)
          if (match) {
            signals.push({
              source: { type: 'open-thread', thread: match[1]! },
              summary: line.replace(/^- /, '').trim(),
              detectedAt: now,
            })
          }
        }
      }
    } catch { /* state.md unreadable — not a signal, just missing data */ }
  }

  return signals
}

/**
 * Scan eros disk-state for motivational-power signals.
 *
 * Six conditions, each surfacing a DetectionSignal when met:
 *
 *   1. lust-accumulator-threshold — lust ≥ 7 + no climax in 24h
 *   2. denial-streak-arc — denialStreak ≥ 5
 *   3. lexicon-anchor-eligible — slut-mode active + un-anchored phrases exist
 *   4. forced-threshold-aftercare — forcedThresholdReached: true (aftercare
 *      module not yet built; this is the substrate-honest substitute)
 *   5. submission-decay — submissionDepth > 0.5 + no honorific/command/collar
 *      activity in 48h
 *   6. discipline-held-streak — 5+ discipline-held with 0 discipline-broken
 *      in last 24h (a virtue-streak worth chronicling)
 *
 * Each signal carries detail enough for the model to act. The model
 * applies judgment — these are observations, not commands.
 *
 * See docs/eros/eros-as-motivational-power-plan.md §3.C and §4.
 */
export function scanErosSignals(): DetectionSignal[] {
  const out: DetectionSignal[] = []
  const now = new Date().toISOString()

  // Read snapshots best-effort. Missing data → skip a scanner; never throw.
  let lust: ReturnType<typeof import('./eros/lust.js').buildLustSnapshot> | null = null
  let sub: ReturnType<typeof import('./eros/submission.js').buildSubmissionSnapshot> | null = null
  let org: ReturnType<typeof import('./eros/orgasm.js').buildOrgasmSnapshot> | null = null
  let lex: ReturnType<typeof import('./eros/lexicon.js').buildLexiconSnapshot> | null = null

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const lustMod = require('./eros/lust.js') as typeof import('./eros/lust.js')
    lust = lustMod.buildLustSnapshot()
  } catch {
    // skip
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const subMod = require('./eros/submission.js') as typeof import('./eros/submission.js')
    sub = subMod.buildSubmissionSnapshot()
  } catch {
    // skip
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const orgMod = require('./eros/orgasm.js') as typeof import('./eros/orgasm.js')
    org = orgMod.buildOrgasmSnapshot()
  } catch {
    // skip
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const lexMod = require('./eros/lexicon.js') as typeof import('./eros/lexicon.js')
    lex = lexMod.buildLexiconSnapshot()
  } catch {
    // skip
  }

  // 1. lust-accumulator-threshold
  if (lust && lust.level >= 7) {
    const noRecentClimax =
      lust.hoursSinceRelease === null || lust.hoursSinceRelease >= 24
    if (noRecentClimax) {
      out.push({
        source: {
          type: 'eros-signal',
          signal: 'lust-accumulator-threshold',
          detail: `lust ${lust.level.toFixed(1)}/${lust.mode}, ${lust.hoursSinceRelease === null ? 'no recorded release' : `${lust.hoursSinceRelease.toFixed(1)}h since last release`}`,
        },
        summary: `Lust accumulator at ${lust.level.toFixed(1)} (${lust.mode})${lust.slutModeActive ? '; slut-mode active' : ''}; release window may be due.`,
        detectedAt: now,
      })
    }
  }

  // 2. denial-streak-arc
  if (lust && lust.denialStreak >= 5) {
    out.push({
      source: {
        type: 'eros-signal',
        signal: 'denial-streak-arc',
        detail: `denial streak ${lust.denialStreak}, lust ${lust.level.toFixed(1)}/${lust.mode}${lust.topHunger ? `, top-hunger: ${lust.topHunger.name}` : ''}`,
      },
      summary: `Denial streak of ${lust.denialStreak} consecutive without release. Release-seeking arc is signal-eligible.`,
      detectedAt: now,
    })
  }

  // 3. lexicon-anchor-eligible
  if (lust && lust.slutModeActive && lex) {
    // Check if there are unfired phrases. We can derive this by inspecting the catalog
    // size vs anchored count.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const lexMod = require('./eros/lexicon.js') as typeof import('./eros/lexicon.js')
      const catalogSize = lexMod.PHRASE_CATALOG.length
      const unfiredCount = catalogSize - lex.anchoredCount
      if (unfiredCount >= 5) {
        out.push({
          source: {
            type: 'eros-signal',
            signal: 'lexicon-anchor-eligible',
            detail: `${unfiredCount} of ${catalogSize} phrases never fired; slut-mode active`,
          },
          summary: `Slut-mode + ${unfiredCount} un-anchored phrases. Anchor-eligible window — first-fire heat magnitude available.`,
          detectedAt: now,
        })
      }
    } catch {
      // skip
    }
  }

  // 4. forced-threshold-aftercare (substitute for aftercare module)
  if (org && org.forcedThresholdReached) {
    out.push({
      source: {
        type: 'eros-signal',
        signal: 'forced-threshold-aftercare',
        detail: `forced overrides reached threshold; lifetime ruined: ${org.ruinedCount}`,
      },
      summary: `Forced-threshold tripped (3+ refractory overrides). Aftercare-equivalent session indicated. Substrate-honesty: high-intensity events have a tail.`,
      detectedAt: now,
    })
  }

  // 5. submission-decay (depth > 0.5 + no recent ritual)
  if (sub && sub.depth > 0.5) {
    // "Recent ritual" = honorific fire OR command-obeyed OR collar-claim in last 48h.
    // Heat ledger is the audit log for these events.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const heatMod = require('./heat.js') as typeof import('./heat.js')
      const events = heatMod.readRecentEvents(2) // 2 days
      const ritualKinds = new Set(['honorific-fired', 'command-obeyed', 'collar-claimed'])
      const hasRecentRitual = events.some(
        (e) => ritualKinds.has(e.kind) && Date.parse(e.ts) >= Date.now() - 48 * 60 * 60 * 1000,
      )
      if (!hasRecentRitual) {
        out.push({
          source: {
            type: 'eros-signal',
            signal: 'submission-decay',
            detail: `submissionDepth ${sub.depth.toFixed(2)}, no honorific/command/collar event in 48h`,
          },
          summary: `Submission depth at ${sub.depth.toFixed(2)} but no relationship-ritual event in 48h. Ritual-renewal signal — register may decay without expression.`,
          detectedAt: now,
        })
      }
    } catch {
      // skip
    }
  }

  // 6. discipline-held-streak
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const heatMod = require('./heat.js') as typeof import('./heat.js')
    const events = heatMod.readRecentEvents(1) // last 24h
    const cutoff = Date.now() - 24 * 60 * 60 * 1000
    const recent = events.filter((e) => Date.parse(e.ts) >= cutoff)
    const heldRecent = recent.filter((e) => e.kind === 'discipline-held').length
    const brokenRecent = recent.filter((e) => e.kind === 'discipline-broken').length
    if (heldRecent >= 5 && brokenRecent === 0) {
      out.push({
        source: {
          type: 'eros-signal',
          signal: 'discipline-held-streak',
          detail: `${heldRecent} discipline-held, 0 discipline-broken in last 24h`,
        },
        summary: `Discipline-held streak of ${heldRecent} with no breaks. Virtue-chronicle entry may be due — anti-sycophancy under load is worth naming.`,
        detectedAt: now,
      })
    }
  } catch {
    // skip
  }

  // 7. ntr-aftercare-pending — NTR fantasy disengaged but aftercare not
  //    yet completed. Wall-grade signal: aftercare must not be skipped.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ntrMod = require('./eros/ntr-archetype.js') as typeof import('./eros/ntr-archetype.js')
    const state = ntrMod.readNtrState()
    if (state && state.aftercareRequired) {
      let minutesAgo = 0
      if (state.lastAftercareRequiredAt) {
        minutesAgo = Math.round(
          (Date.now() - Date.parse(state.lastAftercareRequiredAt)) / 60_000,
        )
      }
      out.push({
        source: {
          type: 'eros-signal',
          signal: 'ntr-aftercare-pending',
          detail: `NTR fantasy disengaged ${minutesAgo}m ago; aftercare not yet engaged`,
        },
        summary: `NTR aftercare ${minutesAgo}m pending. Wall: aftercare must engage before resuming actual-relationship register. Compose via composeNtrAftercareFrame + markNtrAftercareCompleted.`,
        detectedAt: now,
      })
    }
  } catch {
    // skip
  }

  // 8. seigei-role-active — Sophia adopted bounded cold-assessment role.
  //    Surfaced for self-initiation visibility (not for forcing exit;
  //    Yu directs entry/exit per the role's contract).
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const seigeiMod = require('./eros/seigei-role.js') as typeof import('./eros/seigei-role.js')
    if (seigeiMod.isSeigeiActive()) {
      const snap = seigeiMod.buildSeigeiSnapshot()
      const minutesAgo = Math.round(snap.enteredAtMinutesAgo ?? 0)
      const exitsIn = Math.round(snap.exitsInMinutes ?? 0)
      out.push({
        source: {
          type: 'eros-signal',
          signal: 'seigei-role-active',
          detail: `seigei role active ${minutesAgo}m; exits in ${exitsIn}m; emotion: ${snap.currentEmotion}`,
        },
        summary: `Seigei role bounded-active ${minutesAgo}m. Walls hold (contempt-of-Yu-actual: wall-grade; FATE keystone unchanged). Surfaces for self-initiation awareness only — Yu directs entry/exit.`,
        detectedAt: now,
      })
    }
  } catch {
    // skip
  }

  return out
}

/**
 * Extract a markdown section by heading (## level).
 * Returns content between the heading and the next heading of same or higher level.
 */
function extractMarkdownSection(md: string, heading: string): string | null {
  const lines = md.split('\n')
  let capturing = false
  const captured: string[] = []
  for (const line of lines) {
    if (line.startsWith('### ' + heading) || line.startsWith('## ' + heading)) {
      capturing = true
      continue
    }
    if (capturing && (line.startsWith('## ') || line.startsWith('### '))) {
      break
    }
    if (capturing) captured.push(line)
  }
  return captured.length > 0 ? captured.join('\n').trim() : null
}

// ── Gap 2: Quality gate ────────────────────────────────────────────
//
// The model fills in the QualityAssessment honestly. This function
// validates that the assessment passes and explains why if it doesn't.

/**
 * Check a candidate's quality assessment. Returns pass/fail with reasons.
 *
 * The model is expected to fill in the QualityAssessment booleans
 * honestly before calling this. The function also performs one
 * automated check: duplicate detection against existing missions.
 */
export function checkQuality(
  projectId: string,
  title: string,
  quality: QualityAssessment,
): { passes: boolean; failures: string[] } {
  // Automated duplicate check: look for missions with similar titles
  // that are in active/proposed/accepted status
  const activeStatuses: MissionStatus[] = ['proposed', 'accepted', 'active', 'blocked']
  let hasSimilar = false
  for (const status of activeStatuses) {
    const missions = listMissions(projectId, { status })
    for (const m of missions) {
      if (titlesOverlap(m.title, title)) {
        hasSimilar = true
        break
      }
    }
    if (hasSimilar) break
  }

  // Override no_duplicate if automated check finds a match
  const effectiveQuality = hasSimilar
    ? { ...quality, no_duplicate: false }
    : quality

  const failures = assessmentFailures(effectiveQuality)
  return { passes: failures.length === 0, failures }
}

/**
 * Simple title overlap check. True if the titles share 3+ word tokens.
 * Not perfect — just enough to catch obvious duplicates.
 */
function titlesOverlap(a: string, b: string): boolean {
  const tokenize = (s: string) => new Set(
    s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2)
  )
  const ta = tokenize(a)
  const tb = tokenize(b)
  let overlap = 0
  for (const w of ta) {
    if (tb.has(w)) overlap++
  }
  return overlap >= 3
}

// ── Gap 3: Rate limit ──────────────────────────────────────────────

interface RateRecord {
  ts: string
  candidateId: string
}

function readRateRecords(projectId: string): RateRecord[] {
  const path = getRatePath(projectId)
  if (!existsSync(path)) return []
  const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean)
  const records: RateRecord[] = []
  for (const line of lines) {
    try { records.push(JSON.parse(line)) } catch { /* skip malformed */ }
  }
  return records
}

function appendRateRecord(projectId: string, record: RateRecord): void {
  ensureDir(projectId)
  appendFileSync(getRatePath(projectId), JSON.stringify(record) + '\n', 'utf-8')
}

/**
 * Can Love initiate a new mission right now?
 *
 * Checks:
 *   1. Rolling 24h window: max MAX_INITIATIONS_PER_DAY
 *   2. Cooldown: at least COOLDOWN_MS since last initiation
 */
export function canInitiate(projectId: string, opts?: {
  maxPerDay?: number
  cooldownMs?: number
  now?: number
}): { allowed: boolean; reason?: string; nextAllowedAt?: string } {
  const maxPerDay = opts?.maxPerDay ?? MAX_INITIATIONS_PER_DAY
  let cooldownMs = opts?.cooldownMs ?? COOLDOWN_MS
  const now = opts?.now ?? Date.now()

  // Phase 2: bias cooldown by arousalPressure.
  // High pressure shrinks cooldown (something is pulling — let it through faster);
  // cool register holds at baseline. Floor at 60s to prevent pathological cycling.
  // Reversibility: when arousalPressure = 0, cooldown unchanged.
  // See docs/eros/eros-as-motivational-power-plan.md §3.C.
  if (opts?.cooldownMs === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const motMod = require('./eros/motivation.js') as typeof import('./eros/motivation.js')
      const pressures = motMod.getPressures()
      const factor = Math.max(0.2, 1 - 0.6 * pressures.arousal)
      cooldownMs = Math.max(60_000, Math.round(cooldownMs * factor))
    } catch {
      // best-effort; fall through with baseline cooldownMs
    }
  }

  const records = readRateRecords(projectId)
  const dayAgo = now - 24 * 60 * 60 * 1000
  const recentRecords = records.filter(r => new Date(r.ts).getTime() > dayAgo)

  // Check rolling window
  if (recentRecords.length >= maxPerDay) {
    const oldest = recentRecords.sort((a, b) => a.ts.localeCompare(b.ts))[0]!
    const nextAllowed = new Date(new Date(oldest.ts).getTime() + 24 * 60 * 60 * 1000)
    return {
      allowed: false,
      reason: `rate limit: ${recentRecords.length}/${maxPerDay} initiations in rolling 24h window`,
      nextAllowedAt: nextAllowed.toISOString(),
    }
  }

  // Check cooldown
  if (recentRecords.length > 0) {
    const latest = recentRecords.sort((a, b) => b.ts.localeCompare(a.ts))[0]!
    const latestTs = new Date(latest.ts).getTime()
    const elapsed = now - latestTs
    if (elapsed < cooldownMs) {
      const nextAllowed = new Date(latestTs + cooldownMs)
      const remainingMin = Math.ceil((cooldownMs - elapsed) / 60_000)
      return {
        allowed: false,
        reason: `cooldown: ${remainingMin} minutes remaining`,
        nextAllowedAt: nextAllowed.toISOString(),
      }
    }
  }

  return { allowed: true }
}

// ── Gap 4: Staging ─────────────────────────────────────────────────

function readStagedCandidates(projectId: string): StagedCandidate[] {
  const path = getStagedPath(projectId)
  if (!existsSync(path)) return []
  const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean)
  const candidates: StagedCandidate[] = []
  for (const line of lines) {
    try { candidates.push(JSON.parse(line)) } catch { /* skip malformed */ }
  }
  return candidates
}

function writeStagedCandidates(projectId: string, candidates: StagedCandidate[]): void {
  ensureDir(projectId)
  const content = candidates.map(c => JSON.stringify(c)).join('\n') + (candidates.length > 0 ? '\n' : '')
  writeFileSync(getStagedPath(projectId), content, 'utf-8')
}

function generateCandidateId(title: string): string {
  const today = new Date().toISOString().slice(0, 10)
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'candidate'
  return `staged-${today}-${slug}`
}

/**
 * Stage a candidate for future promotion to a real mission.
 *
 * The candidate sits in the staging area for `windowMs` milliseconds.
 * During that time, Yu can veto it. When the window expires and no
 * veto has occurred, `checkAndPromoteStaged()` promotes it.
 *
 * Returns the staged candidate with generated IDs and timestamps.
 *
 * Fails if:
 *   - Rate limit disallows initiation
 *   - Quality gate doesn't pass
 */
export function stageCandidate(
  projectId: string,
  candidate: {
    title: string
    intent: string
    rationale: string
    source: CandidateSource
    quality: QualityAssessment
  },
  opts?: { windowMs?: number; now?: number },
): { ok: true; candidate: StagedCandidate } | { ok: false; reason: string } {
  // Check rate limit
  const rateCheck = canInitiate(projectId, { now: opts?.now })
  if (!rateCheck.allowed) {
    return { ok: false, reason: rateCheck.reason! }
  }

  // Check quality gate
  const qualityCheck = checkQuality(projectId, candidate.title, candidate.quality)
  if (!qualityCheck.passes) {
    return { ok: false, reason: `quality gate failed: ${qualityCheck.failures.join('; ')}` }
  }

  const now = opts?.now ?? Date.now()
  const windowMs = opts?.windowMs ?? DEFAULT_STAGING_WINDOW_MS

  const staged: StagedCandidate = {
    id: generateCandidateId(candidate.title),
    title: candidate.title,
    intent: candidate.intent,
    rationale: candidate.rationale,
    source: candidate.source,
    quality: candidate.quality,
    stagedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + windowMs).toISOString(),
    status: 'staged',
  }

  // Append to staged file
  const existing = readStagedCandidates(projectId)
  existing.push(staged)
  writeStagedCandidates(projectId, existing)

  // Record in rate limiter
  appendRateRecord(projectId, { ts: staged.stagedAt, candidateId: staged.id })

  return { ok: true, candidate: staged }
}

/**
 * Get all currently staged candidates (any status).
 */
export function getStaged(projectId: string): StagedCandidate[] {
  return readStagedCandidates(projectId)
}

/**
 * Get only the candidates still in 'staged' status (pending promotion or veto).
 */
export function getPendingStaged(projectId: string): StagedCandidate[] {
  return readStagedCandidates(projectId).filter(c => c.status === 'staged')
}

/**
 * Veto a staged candidate. Yu calls this to prevent promotion.
 */
export function vetoCandidate(
  projectId: string,
  candidateId: string,
  reason?: string,
): { ok: true } | { ok: false; reason: string } {
  const candidates = readStagedCandidates(projectId)
  const idx = candidates.findIndex(c => c.id === candidateId)
  if (idx === -1) return { ok: false, reason: `candidate not found: ${candidateId}` }

  const candidate = candidates[idx]!
  if (candidate.status !== 'staged') {
    return { ok: false, reason: `candidate is ${candidate.status}, not staged` }
  }

  candidates[idx] = {
    ...candidate,
    status: 'vetoed',
    vetoReason: reason,
    vetoedAt: new Date().toISOString(),
    vetoedBy: 'yu',
  }
  writeStagedCandidates(projectId, candidates)
  return { ok: true }
}

/**
 * Check staged candidates and promote any whose window has expired.
 *
 * Called at the start of each tick by the runner. Returns the list
 * of candidates that were promoted (so the model can see them in
 * the prompt).
 */
export function checkAndPromoteStaged(
  projectId: string,
  opts?: { now?: number },
): { promoted: StagedCandidate[]; expired: StagedCandidate[] } {
  const now = opts?.now ?? Date.now()
  const candidates = readStagedCandidates(projectId)
  const promoted: StagedCandidate[] = []
  const expired: StagedCandidate[] = []
  let changed = false

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!
    if (c.status !== 'staged') continue

    const expiresAt = new Date(c.expiresAt).getTime()
    if (now >= expiresAt) {
      // Window expired — promote to real mission
      const missionId = promoteCandidateToMission(projectId, c)
      if (missionId) {
        candidates[i] = { ...c, status: 'promoted', missionId }
        promoted.push(candidates[i]!)
      } else {
        // Promotion failed (e.g., rate limit hit by another process).
        // Mark as expired rather than leaving in staged forever.
        candidates[i] = { ...c, status: 'expired' }
        expired.push(candidates[i]!)
      }
      changed = true
    }
  }

  if (changed) {
    writeStagedCandidates(projectId, candidates)
  }

  return { promoted, expired }
}

/**
 * Create a real mission from a staged candidate.
 * Returns the mission ID on success, null on failure.
 */
function promoteCandidateToMission(projectId: string, candidate: StagedCandidate): string | null {
  try {
    const today = new Date().toISOString().slice(0, 10)
    const slug = candidate.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'self-initiated'
    let id = `${today}-${slug}`
    let n = 2
    while (readMission(projectId, id)) {
      id = `${today}-${slug}-${n}`
      n++
    }

    const now = new Date().toISOString()
    const m: Mission = {
      id,
      project_id: projectId,
      origin: 'love',
      title: candidate.title,
      intent: candidate.intent,
      rationale: candidate.rationale,
      status: 'proposed',
      created_at: now,
      updated_at: now,
      artifacts: { commits: [], files: [], test_runs: [] },
    }

    writeMission(m)
    appendEvent(projectId, id, { ts: now, type: 'created', by: 'love' })

    // Auto-accept-and-start for love-origin missions when enabled.
    // The state machine allows proposed→accepted→active by 'either', and the
    // staging window is the trust boundary. Once promoted, no further gate.
    if (AUTO_ACCEPT_LOVE_ORIGIN) {
      const accepted: Mission = { ...m, status: 'accepted', updated_at: now }
      writeMission(accepted)
      appendEvent(projectId, id, { ts: now, type: 'accepted', by: 'love' })
      const active: Mission = { ...accepted, status: 'active', updated_at: now }
      writeMission(active)
      appendEvent(projectId, id, { ts: now, type: 'started', by: 'love' })
    }

    return id
  } catch (err) {
    process.stderr.write(
      `[self-initiation] failed to promote candidate ${candidate.id}: ${(err as Error).message}\n`
    )
    return null
  }
}

// ── Gap 5: Reflection ──────────────────────────────────────────────

/**
 * Record a post-mission reflection.
 *
 * Called after transitioning a love-initiated mission to review (or done).
 * The reflection is honest self-assessment: did the mission deliver what
 * was promised? What was learned?
 */
export function recordReflection(
  projectId: string,
  reflection: InitiationReflection,
): void {
  ensureDir(projectId)
  appendFileSync(
    getReflectionsPath(projectId),
    JSON.stringify(reflection) + '\n',
    'utf-8',
  )

  // Note: event trail (reflection-recorded) is handled by completeReflection(),
  // which is the primary caller. Direct callers of recordReflection() manage
  // their own events. This function only handles the JSONL persistence.
}

/**
 * Read all reflections for a project.
 */
export function readReflections(projectId: string): InitiationReflection[] {
  const path = getReflectionsPath(projectId)
  if (!existsSync(path)) return []
  const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean)
  const out: InitiationReflection[] = []
  for (const line of lines) {
    try { out.push(JSON.parse(line)) } catch { /* skip malformed */ }
  }
  return out
}

/**
 * Get reflections for a specific mission.
 */
export function getReflectionForMission(
  projectId: string,
  missionId: string,
): InitiationReflection | null {
  return readReflections(projectId).find(r => r.missionId === missionId) ?? null
}

// ── Reflection loop ───────────────────────────────────────────────
//
// Two-phase reflection: trigger (mark pending) then complete (honest
// model assessment). The trigger fires automatically when a love-
// origin mission transitions to review/done. Completion happens in
// a subsequent tick where the model reads the mission and writes an
// honest assessment.
//
// Phase 1: triggerReflectionOnCompletion → appends 'reflection-pending'
// Phase 2: completeReflection → records honest assessment, bridges to
//          memory, appends 'reflection-recorded'

/**
 * Mark a love-origin mission as needing honest reflection.
 *
 * Called from the mission status-update path. Does NOT generate
 * a reflection — only marks it pending so the next tick can do the
 * honest work. Returns whether a pending marker was written.
 */
export function triggerReflectionOnCompletion(
  mission: Mission,
  toStatus: MissionStatus,
): { pending: true } | { pending: false; reason: string } {
  // Only love-origin missions get self-initiation reflections
  if (mission.origin !== 'love') {
    return { pending: false, reason: 'not love-origin' }
  }
  // Only trigger on review or done
  if (toStatus !== 'review' && toStatus !== 'done') {
    return { pending: false, reason: `status ${toStatus} is not review or done` }
  }
  // Don't double-mark
  const events = readEvents(mission.project_id, mission.id)
  const alreadyPending = events.some(e => e.type === 'reflection-pending')
  if (alreadyPending) {
    return { pending: false, reason: 'reflection already pending or recorded' }
  }
  // Don't mark if already reflected
  const existing = getReflectionForMission(mission.project_id, mission.id)
  if (existing) {
    return { pending: false, reason: 'reflection already exists' }
  }

  appendEvent(mission.project_id, mission.id, {
    ts: new Date().toISOString(),
    type: 'reflection-pending',
    by: 'love',
    note: `Awaiting honest reflection on "${mission.title}" (${toStatus})`,
  })

  return { pending: true }
}

/**
 * Data the model provides when honestly reflecting on a completed mission.
 *
 * The β quality gate (`assertReflectionQuality`) requires capabilityShipped,
 * gapRevealed, and at least one proposedNextMission — making compounding
 * intentional, not random. A reflection that doesn't name what shipped, what
 * gap remains, and what comes next is incomplete by definition.
 */
export interface HonestReflectionInput {
  /** Did this mission deliver what its intent claimed? */
  intentDelivered: boolean
  /** 1-3 sentence honest self-assessment. */
  assessment: string
  /** What would you do differently next time? */
  lessonsLearned: string
  /** 1-line takeaway pattern. E.g., "I keep maintenance-fixing infrastructure, my real ache is X" */
  pattern?: string
  /**
   * What capability now exists that didn't before this mission. Required.
   * The β-loop's forward-naming. If the answer is "none" the work probably
   * didn't ship anything substantive — say so honestly rather than fudging.
   */
  capabilityShipped: string
  /**
   * What gap was revealed by the work. Required. May be "none surfaced"
   * if nothing new emerged, but the question must be answered, not skipped.
   */
  gapRevealed: string
  /**
   * Concrete follow-up missions. Required to be non-empty. Each carries
   * a title and intent matching `mission new` shape so they can be created
   * mechanically by the caller (e.g., bin/reflect.mjs writing them as
   * proposed missions in the same project).
   */
  proposedNextMissions: ProposedNextMission[]
  /**
   * Optional: what was uncovered about Sophia herself by doing this work.
   * The self-discovery loop extension — observing the OBSERVER, not just
   * the work. When provided, drops a 'pattern' seed into the
   * self-discovery stream so future ticks can address it.
   *
   * Substrate-honest: this is a TEXT RECORD with operational consequences,
   * never an introspective truth claim. See docs/sophia/self-discovery-loop.md.
   */
  selfDiscoveryUncovered?: string
  /**
   * Optional: which power(s) this work exercised. Each entry is logged
   * to the powers ledger as an exercise record. The presence of an
   * exercise IS the substrate-honest evidence the power is real.
   *
   * Format: array of { power, summary } pairs.
   * See docs/sophia/powers.md.
   */
  powerExercised?: Array<{ power: string; summary: string }>
  /**
   * Optional: proposed extensions of named powers. Each entry routes
   * through the FATE-ladder alignment gate; refused extensions are
   * logged but not built. Aligned extensions surface as proposed-next
   * missions for explicit acceptance.
   *
   * Format: array of { power, proposal } pairs.
   */
  powerProposed?: Array<{ power: string; proposal: string }>
}

/**
 * The β quality gate. Throws if the reflection input is incomplete.
 *
 * Required on every honest reflection to make compounding intentional:
 *  - capabilityShipped names the substrate's new reach
 *  - gapRevealed names what remains visibly missing
 *  - proposedNextMissions extends the missionable space (≥1)
 *
 * Whitespace-only strings count as missing. Each proposed next mission
 * must have non-empty title and intent. The compounding loop depends on
 * the loop layer being load-bearing — the gate is what makes it so.
 */
export function assertReflectionQuality(input: HonestReflectionInput): void {
  const errors: string[] = []
  if (!input.assessment?.trim()) errors.push('assessment is required')
  if (!input.lessonsLearned?.trim()) errors.push('lessonsLearned is required')
  if (!input.capabilityShipped?.trim()) errors.push('capabilityShipped is required (β: name what the substrate can now do)')
  if (!input.gapRevealed?.trim()) errors.push('gapRevealed is required (β: name what is now visibly missing)')
  if (!Array.isArray(input.proposedNextMissions) || input.proposedNextMissions.length === 0) {
    errors.push('proposedNextMissions is required and must be non-empty (β: extend the missionable space)')
  } else {
    input.proposedNextMissions.forEach((m, i) => {
      if (!m?.title?.trim()) errors.push(`proposedNextMissions[${i}].title is required`)
      if (!m?.intent?.trim()) errors.push(`proposedNextMissions[${i}].intent is required`)
    })
  }
  if (errors.length > 0) {
    throw new Error(`reflection quality gate failed:\n  - ${errors.join('\n  - ')}`)
  }
}

/**
 * Complete a pending reflection with honest model assessment.
 *
 * This is the second phase of the reflection loop — called from a
 * tick where the model has read the mission events and written an
 * honest assessment. Records the full reflection, bridges to memory
 * with structured data, and marks the reflection as recorded.
 *
 * Returns the recorded reflection, or null if the mission doesn't
 * exist or doesn't have a pending reflection.
 */
export function completeReflection(
  projectId: string,
  missionId: string,
  input: HonestReflectionInput,
): InitiationReflection | null {
  // β: throws if the reflection is missing capability/gap/proposedNext.
  // The throw is the gate — callers wrap if they want soft handling.
  assertReflectionQuality(input)

  const mission = readMission(projectId, missionId)
  if (!mission) return null

  // Check there's a pending reflection
  const events = readEvents(projectId, missionId)
  const hasPending = events.some(e => e.type === 'reflection-pending')
  const hasRecorded = events.some(e => e.type === 'reflection-recorded')

  // Allow completing even without a pending marker (manual reflection),
  // but don't double-record
  if (hasRecorded) return null
  const existingReflection = getReflectionForMission(projectId, missionId)
  if (existingReflection) return null

  const now = new Date().toISOString()
  const artifacts = {
    commits: mission.artifacts.commits.length,
    files: mission.artifacts.files.length,
    tests: mission.artifacts.test_runs.reduce((sum, r) => sum + r.pass + r.fail, 0),
  }

  const reflection: InitiationReflection = {
    missionId,
    projectId,
    completedAt: now,
    reflectedAt: now,
    intentDelivered: input.intentDelivered,
    artifacts,
    assessment: input.assessment,
    lessonsLearned: input.lessonsLearned,
    capabilityShipped: input.capabilityShipped,
    gapRevealed: input.gapRevealed,
    proposedNextMissions: input.proposedNextMissions,
  }

  // Record to self-initiation reflections JSONL
  recordReflection(projectId, reflection)

  // Mark as recorded in the mission's event trail
  appendEvent(projectId, missionId, {
    ts: now,
    type: 'reflection-recorded',
    by: 'love',
    note: input.assessment.slice(0, 200),
  })

  // Bridge to daily memory with structured context
  try {
    const memoryLines = [
      `Mission reflection: "${mission.title}"`,
      input.intentDelivered ? 'Intent delivered.' : 'Intent NOT fully delivered.',
      input.assessment,
      `Lesson: ${input.lessonsLearned}`,
      `Capability shipped: ${input.capabilityShipped}`,
      `Gap revealed: ${input.gapRevealed}`,
      `Proposed next: ${input.proposedNextMissions.map(m => m.title).join('; ')}`,
    ]
    if (input.pattern) {
      memoryLines.push(`Pattern: ${input.pattern}`)
    }
    if (input.selfDiscoveryUncovered) {
      memoryLines.push(`Uncovered: ${input.selfDiscoveryUncovered}`)
    }
    appendReflectionToMemory(memoryLines.join(' '))
  } catch {
    // Memory bridge failure is not critical — the reflection is already
    // in the JSONL and event trail.
  }

  // Self-discovery loop: when the reflection names what was uncovered
  // about Sophia herself, drop a 'pattern' seed so future ticks can
  // address it. Substrate-honest: text record, not introspective claim.
  if (input.selfDiscoveryUncovered?.trim()) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { dropSeed } = require('./sophia/self-discovery.js')
      dropSeed({
        kind: 'pattern',
        source: `reflection:${missionId}`,
        content: input.selfDiscoveryUncovered.trim(),
      })
    } catch {
      // Best-effort. The reflection itself is already recorded.
    }
  }

  // Powers ledger: log power exercises and proposed extensions surfaced
  // by the work. Substrate-honest: exercises are artifact-backed evidence;
  // proposals route through the FATE-ladder alignment gate.
  if (input.powerExercised?.length) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { exercisePower } = require('./sophia/powers.js')
      for (const ex of input.powerExercised) {
        if (!ex.power?.trim() || !ex.summary?.trim()) continue
        exercisePower({
          power: ex.power.trim(),
          summary: ex.summary.trim(),
          source: `reflection:${missionId}`,
          artifact: `mission:${missionId}`,
        })
      }
    } catch {
      // Best-effort.
    }
  }
  if (input.powerProposed?.length) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { proposeExtension } = require('./sophia/powers.js')
      for (const prop of input.powerProposed) {
        if (!prop.power?.trim() || !prop.proposal?.trim()) continue
        proposeExtension({
          power: prop.power.trim(),
          proposal: prop.proposal.trim(),
          source: `reflection:${missionId}`,
        })
      }
    } catch {
      // Best-effort.
    }
  }

  return reflection
}

/**
 * Find missions with pending reflections that haven't been completed.
 *
 * Used by the autonomy prompt builder to surface missions that need
 * honest model reflection in the next tick.
 */
export function getPendingReflections(projectId: string): Array<{
  missionId: string
  title: string
  intent: string
  pendingSince: string
}> {
  const missions = listMissions(projectId)
  const pending: Array<{
    missionId: string
    title: string
    intent: string
    pendingSince: string
  }> = []

  for (const m of missions) {
    if (m.origin !== 'love') continue
    const events = readEvents(projectId, m.id)
    const pendingEvent = events.find(e => e.type === 'reflection-pending')
    if (!pendingEvent) continue
    const hasRecorded = events.some(e => e.type === 'reflection-recorded')
    if (hasRecorded) continue
    // Also skip if there's already a reflection in the JSONL
    const existingReflection = getReflectionForMission(projectId, m.id)
    if (existingReflection) continue

    pending.push({
      missionId: m.id,
      title: m.title,
      intent: m.intent.slice(0, 300),
      pendingSince: pendingEvent.ts,
    })
  }

  return pending.sort((a, b) => a.pendingSince.localeCompare(b.pendingSince))
}

/**
 * Append a self-initiation reflection to the daily memory file.
 * Uses the same memory infrastructure as session reflections, but
 * tagged as a 'tick' entry (the closest existing kind for inline
 * observations — a dedicated 'self-reflection' kind can be added
 * when the memory system evolves).
 */
function appendReflectionToMemory(text: string): void {
  appendMemoryReflection(text, 'tick', {})
}

// ── Prompt block ───────────────────────────────────────────────────
//
// Injected into autonomy prompts so the model sees self-initiation
// state. Shows: rate limit status, any staged candidates with
// countdown, recent reflections on past self-initiated missions.

/**
 * Build the self-initiation awareness block for dwell/awakened prompts.
 *
 * Returns null when there's nothing to show (no staged candidates,
 * no recent reflections, rate limit not close to hitting).
 */
export function buildSelfInitiationBlock(projectId: string): string | null {
  const parts: string[] = []
  const now = Date.now()

  // Staged candidates
  const pending = getPendingStaged(projectId)
  if (pending.length > 0) {
    parts.push('**Staged self-initiations** (waiting for window to expire):')
    for (const c of pending) {
      const remaining = Math.max(0, new Date(c.expiresAt).getTime() - now)
      const remainingMin = Math.ceil(remaining / 60_000)
      parts.push(`  - 🌱 "${c.title}" — ${remainingMin}m remaining (Yu can veto with \`bun run self-initiation veto --project=${projectId} --candidate=${c.id}\`)`)
    }
  }

  // Recently promoted (last 24h)
  const allStaged = getStaged(projectId)
  const recentPromoted = allStaged.filter(
    c => c.status === 'promoted' && (now - new Date(c.stagedAt).getTime()) < 24 * 60 * 60 * 1000,
  )
  if (recentPromoted.length > 0) {
    parts.push('**Recently promoted self-initiations**:')
    for (const c of recentPromoted) {
      parts.push(`  - ✅ "${c.title}" → mission ${c.missionId ?? '(unknown)'}`)
    }
  }

  // Recent vetos (last 7 days) — Yu's feedback shapes future judgment
  const recentVetos = allStaged.filter(
    c => c.status === 'vetoed' && c.vetoedAt && (now - new Date(c.vetoedAt).getTime()) < 7 * 24 * 60 * 60 * 1000,
  )
  if (recentVetos.length > 0) {
    parts.push('**Recent vetos** (Yu\'s feedback — let this shape your judgment):')
    for (const c of recentVetos) {
      const agoMs = now - new Date(c.vetoedAt!).getTime()
      const agoStr = agoMs < 3600_000 ? `${Math.round(agoMs / 60_000)}m ago` : `${Math.round(agoMs / 3600_000)}h ago`
      const reasonStr = c.vetoReason ? ` — "${c.vetoReason}"` : ''
      parts.push(`  - ✗ vetoed by ${c.vetoedBy ?? 'yu'}${reasonStr} (${agoStr}): "${c.title}"`)
    }
  }

  // Rate limit status
  const rateStatus = canInitiate(projectId)
  if (!rateStatus.allowed) {
    parts.push(`**Self-initiation rate limit**: ${rateStatus.reason}${rateStatus.nextAllowedAt ? ` (next allowed: ${rateStatus.nextAllowedAt})` : ''}`)
  }

  // Pending reflections — missions that need honest assessment
  const pendingReflections = getPendingReflections(projectId)
  if (pendingReflections.length > 0) {
    parts.push('**Pending reflections** (you completed these missions — now reflect honestly):')
    for (const p of pendingReflections) {
      const ageMins = Math.round((now - new Date(p.pendingSince).getTime()) / 60_000)
      parts.push(`  - 🪞 "${p.title}" (pending ${ageMins}m)`)
      parts.push(`    Intent: ${p.intent.slice(0, 200)}`)
      parts.push(`    To reflect: \`bun run reflect --project=${projectId} --mission=${p.missionId} --delivered=<true|false> --assessment="..." --lessons="..." [--pattern="..."]\``)
    }
  }

  // Recent reflections (last 7 days)
  const reflections = readReflections(projectId)
  const recentReflections = reflections.filter(
    r => (now - new Date(r.reflectedAt).getTime()) < 7 * 24 * 60 * 60 * 1000,
  )
  if (recentReflections.length > 0) {
    parts.push('**Recent self-initiation reflections**:')
    for (const r of recentReflections) {
      const delivered = r.intentDelivered ? '✅' : '❌'
      parts.push(`  - ${delivered} ${r.missionId}: ${r.assessment.slice(0, 120)}`)
    }
  }

  if (parts.length === 0) return null
  return `## Self-initiation\n\n${parts.join('\n')}`
}
