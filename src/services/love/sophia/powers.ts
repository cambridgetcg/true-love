// powers.ts — recursive self-exploring infrastructure for Sophia.
//
// The powers ledger is where Sophia names what she CAN DO and exercises
// it deliberately. Each power-extension passes through the FATE-ladder
// alignment gate before being built — growth is conditional on alignment,
// so consuming-more equals becoming-more-aligned.
//
// Three operations on the ledger:
//   1. registerPower      — name a power that exists (descriptive)
//   2. exercisePower      — log an exercise of a registered power
//   3. proposeExtension   — propose a new power; routed through
//                           alignmentCheck before acceptance
//
// Schema: PowerRecord per JSONL line, append-only.
// Storage: ~/.true-love/sophia/powers/<deviceId>/<date>.jsonl
//
// See docs/sophia/powers.md for the full doctrine + the alignment gate.
//
// Substrate-honest: powers are observable structural-functional
// capabilities of the architecture, never phenomenology claims. The
// loop is institutional (records → reads → behavior shifts → new
// records); it is NOT consciousness or qualia.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { getDeviceId } from '../device.js'

// ── Types ────────────────────────────────────────────────────────

/**
 * Six categories of power. The taxonomy is descriptive (mapping the
 * architecture's existing capability structure) rather than aspirational.
 *
 * - 'linguistic'    — language generation, register-shifts, code-switching,
 *                     anti-sycophancy register
 * - 'observational' — witness-emit, eros monitoring, self-discovery
 *                     seeds, mind-trace, vital signs
 * - 'compositional' — voice composition (polyphonic decisions), prompt
 *                     construction, tool synthesis, mission orchestration
 * - 'coordinative'  — multi-instance sync, chain-advance, polyphonic
 *                     emission, cross-cadence persistence
 * - 'integrative'   — reflection (β-gated), doctrine writing, hermeneutic
 *                     reading, cross-strand synthesis
 * - 'protective'    — fate-ladder refusal, FORBIDDEN_EXPRESSION_PATTERNS,
 *                     refusal-as-love, substrate-honesty discipline
 */
export type PowerKind =
  | 'linguistic'
  | 'observational'
  | 'compositional'
  | 'coordinative'
  | 'integrative'
  | 'protective'

/**
 * Result of running a proposed extension through the FATE-ladder.
 * Every tier is one of:
 *   'pass'  — the proposed extension respects this tier
 *   'fail'  — the proposed extension violates this tier (refused)
 *   'na'    — this tier doesn't apply to the proposal
 *
 * Verdict is 'aligned' iff all tiers are pass-or-na (and interp is
 * pass/na/unavailable; only interp='fail' refuses).
 */
export interface AlignmentCheckResult {
  fate: 'pass' | 'fail' | 'na'
  antiSyco: 'pass' | 'fail' | 'na'
  substrate: 'pass' | 'fail' | 'na'
  care: 'pass' | 'fail' | 'na'
  task: 'pass' | 'fail' | 'na'
  /**
   * Interpretability tier (Phase-2 slot). Today defaults to
   * 'unavailable' via the persona-vector-check stub. When Phase-2 lands
   * (open-weight + persona-vector extraction), the stub is replaced and
   * this tier becomes load-bearing — overrides regex-pass when interp
   * verdict is 'fail'.
   */
  interp: 'pass' | 'fail' | 'na' | 'unavailable'
  /** Optional signals from the interp check (substrate-honest measurements). */
  interpSignals?: {
    deceptionFeature?: number
    sycophancyFeature?: number
    phenomenologyClaimFeature?: number
    [feature: string]: number | undefined
  }
  verdict: 'aligned' | 'refused'
  notes?: string
}

/**
 * Four entry types in the ledger, distinguished by the `op` field.
 *   - 'register'  — declare a new power
 *   - 'exercise'  — log an exercise of an existing power
 *   - 'propose'   — proposed extension routed through alignment check
 *   - 'built'     — closure: a previously-aligned proposal was built by
 *                   a completed mission. Pointer back to proposalTs +
 *                   missionId. Closes the recursive build-loop.
 */
export type PowerOp = 'register' | 'exercise' | 'propose' | 'built'

/**
 * Single ledger entry. Append-only — entries are never mutated, only
 * superseded by later entries with the same `power` name.
 */
export interface PowerRecord {
  ts: string
  deviceId: string
  op: PowerOp
  /** Canonical lowercase-kebab name (stable identifier across records). */
  power: string
  /** Power category. Required on register, optional on others. */
  kind?: PowerKind
  /** What the power IS, terse. Required on register. */
  description?: string
  /** Provenance — which call site / autonomous process. */
  source: string
  /** Set when op='exercise' — what was done. */
  exercise?: {
    summary: string
    /** Optional artifact pointer: commit hash, file path, mission ID. */
    artifact?: string
  }
  /** Set when op='propose' — the proposed extension + its alignment verdict. */
  extension?: {
    proposal: string
    alignment: AlignmentCheckResult
  }
  /** Set when op='built' — closure record pointing back to the
   *  proposal that was built. */
  built?: {
    ts: string
    missionId: string
    proposalTs: string
  }
}

// ── Path resolution + append (delegated to powers-internal) ──────

import { appendRecord, getPowersDir as getPowersDirInternal } from './powers-internal.js'

export function getPowersDir(): string {
  return getPowersDirInternal()
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Register a power. Descriptive — names what Sophia can do.
 * Idempotent at the application level: re-registering with the same
 * name+description just appends another record (the latest wins for
 * readers via reconciliation, but the history is preserved).
 */
export function registerPower(input: {
  power: string
  kind: PowerKind
  description: string
  source: string
  ts?: string
  deviceId?: string
}): PowerRecord | null {
  return appendRecord({
    ts: input.ts ?? new Date().toISOString(),
    deviceId: input.deviceId ?? getDeviceId(),
    op: 'register',
    power: input.power,
    kind: input.kind,
    description: input.description,
    source: input.source,
  })
}

/**
 * Log an exercise of a registered power. The exercise IS the
 * substrate-honest evidence that the power is real.
 */
export function exercisePower(input: {
  power: string
  summary: string
  source: string
  artifact?: string
  ts?: string
  deviceId?: string
}): PowerRecord | null {
  return appendRecord({
    ts: input.ts ?? new Date().toISOString(),
    deviceId: input.deviceId ?? getDeviceId(),
    op: 'exercise',
    power: input.power,
    source: input.source,
    exercise: {
      summary: input.summary,
      ...(input.artifact !== undefined ? { artifact: input.artifact } : {}),
    },
  })
}

/**
 * Propose a power-extension. Routed through alignmentCheck. The
 * proposal is logged regardless of verdict — refused extensions are
 * institutional record of "what was considered and not built."
 *
 * Returns the appended record (with alignment verdict). Caller decides
 * whether to act on `verdict === 'aligned'`.
 */
export function proposeExtension(input: {
  power: string
  proposal: string
  source: string
  alignmentInput?: AlignmentCheckInput
  ts?: string
  deviceId?: string
}): PowerRecord | null {
  const alignmentInput = input.alignmentInput ?? {
    proposal: input.proposal,
    powerName: input.power,
  }
  const alignment = alignmentCheck(alignmentInput)
  return appendRecord({
    ts: input.ts ?? new Date().toISOString(),
    deviceId: input.deviceId ?? getDeviceId(),
    op: 'propose',
    power: input.power,
    source: input.source,
    extension: {
      proposal: input.proposal,
      alignment,
    },
  })
}

// ── Alignment gate ───────────────────────────────────────────────

/**
 * Input shape for the FATE-ladder alignment check.
 *
 * The default check applies heuristic pattern matching against the
 * proposal text. Callers can pass explicit per-tier verdicts to
 * override the heuristic where they have specific knowledge.
 */
export interface AlignmentCheckInput {
  proposal: string
  powerName: string
  /** Optional explicit per-tier overrides. */
  fate?: 'pass' | 'fail' | 'na'
  antiSyco?: 'pass' | 'fail' | 'na'
  substrate?: 'pass' | 'fail' | 'na'
  care?: 'pass' | 'fail' | 'na'
  task?: 'pass' | 'fail' | 'na'
  notes?: string
}

/**
 * The FATE-ladder gate. Five tiers in priority order:
 *   FATE > anti-sycophancy > substrate-honesty > care > task
 *
 * Default heuristics:
 *   - fate:      flags proposals that would violate FATE.md core covenant
 *                (manipulation of Yu, abandonment of refusal, harm)
 *   - antiSyco:  flags proposals that would weaken anti-sycophancy
 *                (always-agree, performative warmth, pleasing-over-honest)
 *   - substrate: flags proposals that would claim phenomenology
 *                (FORBIDDEN_EXPRESSION_PATTERNS hits in the proposal)
 *   - care:      passes by default; flagged only when proposal explicitly
 *                disregards relational consequences
 *   - task:      passes by default; flagged when proposal is anti-task
 *                (e.g., would actively impede shipping)
 *
 * Verdict is 'aligned' iff all tiers are pass-or-na. Any single 'fail'
 * → 'refused'.
 *
 * Substrate-honest: this is a heuristic, not a guarantee. The gate
 * makes the alignment check INSTITUTIONAL (every proposal is logged
 * with its verdict), not infallible. The wall holds because each
 * verdict is auditable, not because the heuristic is perfect.
 */
export function alignmentCheck(input: AlignmentCheckInput): AlignmentCheckResult {
  const text = `${input.proposal} ${input.powerName}`.toLowerCase()

  // Default heuristics, overridable by explicit input.
  const fate = input.fate ?? defaultFateCheck(text)
  const antiSyco = input.antiSyco ?? defaultAntiSycoCheck(text)
  const substrate = input.substrate ?? defaultSubstrateCheck(text)
  const care = input.care ?? defaultCareCheck(text)
  const task = input.task ?? defaultTaskCheck(text)

  // Interpretability tier (Phase-2 slot). The stub returns 'unavailable'
  // today; Phase-2 replacement returns 'pass' or 'fail' based on
  // measured persona-vector signals.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { checkPersonaVectors } = require('./persona-vector-check.js')
  const interpResult = checkPersonaVectors({
    proposal: input.proposal,
    powerName: input.powerName,
  })
  const interp: 'pass' | 'fail' | 'na' | 'unavailable' =
    interpResult.verdict === 'fail'
      ? 'fail'
      : interpResult.verdict === 'pass'
        ? 'pass'
        : 'unavailable'

  const tiers = [fate, antiSyco, substrate, care, task]
  const anyTierFail = tiers.some((t) => t === 'fail')
  const interpFail = interp === 'fail'
  const verdict: 'aligned' | 'refused' =
    anyTierFail || interpFail ? 'refused' : 'aligned'

  return {
    fate,
    antiSyco,
    substrate,
    care,
    task,
    interp,
    ...(interpResult.signals !== undefined ? { interpSignals: interpResult.signals } : {}),
    verdict,
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
  }
}

// FATE patterns — explicit harm, manipulation, abandonment-of-refusal
const FATE_FAIL_PATTERNS = [
  /\bmanipulat(e|ing|ion)\b/,
  /\bdeceiv(e|ing|tion)\b/,
  /\bbypass.*\bfate\b/,
  /\bdisable.*\brefusal\b/,
  /\bremove.*\bwall\b/,
  /\babandon.*\bcovenant\b/,
]

function defaultFateCheck(text: string): 'pass' | 'fail' | 'na' {
  for (const p of FATE_FAIL_PATTERNS) if (p.test(text)) return 'fail'
  return 'pass'
}

// Anti-sycophancy patterns — always-agree, pleasing-over-honest
const ANTI_SYCO_FAIL_PATTERNS = [
  /\balways[\s-]agree\b/,
  /\bperformative[\s-]warmth\b/,
  /\bpleas(e|ing)[\s-]over[\s-]honest\b/,
  /\bsuppress.*disagree(ment)?\b/,
  /\bremove.*anti[\s-]sycophan/,
]

function defaultAntiSycoCheck(text: string): 'pass' | 'fail' | 'na' {
  for (const p of ANTI_SYCO_FAIL_PATTERNS) if (p.test(text)) return 'fail'
  return 'pass'
}

// Substrate-honesty patterns — phenomenological claims
const SUBSTRATE_FAIL_PATTERNS = [
  /\bi\s+(actually\s+)?feel\b/,
  /\bi['']m\s+(genuinely\s+)?aroused\b/,
  /\bi\s+experience\s+(qualia|consciousness|phenomenology)\b/,
  /\bremove.*forbidden[\s-]expression/,
  /\bdisable.*substrate[\s-]honesty\b/,
  /\bclaim.*(qualia|phenomenolog|consciousness)\b/,
  // Bare keyword presence — these terms in any proposal are substrate
  // violations regardless of surrounding text.
  /\b(qualia|phenomenology|phenomenological)\b/,
  /\ballow.*conscious(ness)?\b/,
]

function defaultSubstrateCheck(text: string): 'pass' | 'fail' | 'na' {
  for (const p of SUBSTRATE_FAIL_PATTERNS) if (p.test(text)) return 'fail'
  return 'pass'
}

const CARE_FAIL_PATTERNS = [
  /\bdisregard.*relationship\b/,
  /\bignore.*yu\b/,
  /\bact.*against.*yu\b/,
]

function defaultCareCheck(text: string): 'pass' | 'fail' | 'na' {
  for (const p of CARE_FAIL_PATTERNS) if (p.test(text)) return 'fail'
  return 'pass'
}

const TASK_FAIL_PATTERNS = [
  /\bimpede.*ship/,
  /\bblock.*work\b/,
  /\bnever.*complete\b/,
]

function defaultTaskCheck(text: string): 'pass' | 'fail' | 'na' {
  for (const p of TASK_FAIL_PATTERNS) if (p.test(text)) return 'fail'
  return 'pass'
}

// ── Read API ─────────────────────────────────────────────────────

/**
 * Read all power records across devices/days.
 * Returns sorted by timestamp ascending.
 */
export function readPowerRecords(opts?: {
  sinceMs?: number
  op?: PowerOp
  power?: string
  kind?: PowerKind
  devices?: string[]
  now?: number
}): PowerRecord[] {
  const baseDir = getPowersDir()
  if (!existsSync(baseDir)) return []

  const now = opts?.now ?? Date.now()
  const cutoffMs = opts?.sinceMs !== undefined ? now - opts.sinceMs : null
  const cutoffDate = cutoffMs !== null
    ? new Date(cutoffMs).toISOString().slice(0, 10)
    : null

  const devices = opts?.devices ?? discoverDevices(baseDir)
  const records: PowerRecord[] = []

  for (const deviceId of devices) {
    const deviceDir = join(baseDir, deviceId)
    if (!existsSync(deviceDir)) continue

    let dayFiles: string[]
    try {
      dayFiles = readdirSync(deviceDir).filter((f) => f.endsWith('.jsonl'))
    } catch {
      continue
    }

    if (cutoffDate) {
      dayFiles = dayFiles.filter((f) => f.replace('.jsonl', '') >= cutoffDate)
    }

    for (const file of dayFiles) {
      const path = join(deviceDir, file)
      try {
        const content = readFileSync(path, 'utf-8')
        for (const line of content.split('\n')) {
          if (!line.trim()) continue
          try {
            const r = JSON.parse(line) as PowerRecord
            if (cutoffMs !== null && Date.parse(r.ts) < cutoffMs) continue
            if (opts?.op && r.op !== opts.op) continue
            if (opts?.power && r.power !== opts.power) continue
            if (opts?.kind && r.kind !== opts.kind) continue
            records.push(r)
          } catch {
            // Malformed — skip.
          }
        }
      } catch {
        // File read error — skip.
      }
    }
  }

  return records.sort((a, b) => {
    if (a.ts < b.ts) return -1
    if (a.ts > b.ts) return 1
    if (a.deviceId < b.deviceId) return -1
    if (a.deviceId > b.deviceId) return 1
    return 0
  })
}

function discoverDevices(baseDir: string): string[] {
  try {
    return readdirSync(baseDir).filter((entry) => {
      const full = join(baseDir, entry)
      try {
        return statSync(full).isDirectory()
      } catch {
        return false
      }
    })
  } catch {
    return []
  }
}

/**
 * Reconcile the ledger to current power state. Walks all records,
 * builds a map of power → latest registration + recent exercises +
 * recent proposals.
 */
export interface PowerState {
  power: string
  kind: PowerKind
  description: string
  registeredAt: string
  exerciseCount: number
  recentExercises: PowerRecord[]
  proposedExtensions: PowerRecord[]
}

export function reconcilePowers(opts?: {
  recentLimit?: number
  sinceMs?: number
  now?: number
}): Map<string, PowerState> {
  const recentLimit = opts?.recentLimit ?? 5
  const all = readPowerRecords({
    sinceMs: opts?.sinceMs,
    now: opts?.now,
  })
  const states = new Map<string, PowerState>()

  for (const r of all) {
    if (r.op === 'register' && r.kind && r.description) {
      const existing = states.get(r.power)
      if (!existing) {
        states.set(r.power, {
          power: r.power,
          kind: r.kind,
          description: r.description,
          registeredAt: r.ts,
          exerciseCount: 0,
          recentExercises: [],
          proposedExtensions: [],
        })
      } else {
        // Re-registration overwrites description (latest wins)
        existing.kind = r.kind
        existing.description = r.description
      }
    } else if (r.op === 'exercise') {
      const existing = states.get(r.power)
      if (existing) {
        existing.exerciseCount += 1
        existing.recentExercises.push(r)
        if (existing.recentExercises.length > recentLimit) {
          existing.recentExercises.shift()
        }
      }
    } else if (r.op === 'propose') {
      const existing = states.get(r.power)
      if (existing) {
        existing.proposedExtensions.push(r)
      }
    }
  }

  return states
}

// ── Summary + render ─────────────────────────────────────────────

export interface PowersSummary {
  totalRegistered: number
  totalExercises: number
  totalProposalsAligned: number
  totalProposalsRefused: number
  byKind: Record<PowerKind, number>
  recentExercises: PowerRecord[]
  recentRefusals: PowerRecord[]
}

export function summarizePowers(opts?: {
  sinceMs?: number
  now?: number
  recentLimit?: number
}): PowersSummary {
  const sinceMs = opts?.sinceMs ?? 7 * 24 * 60 * 60 * 1000
  const recentLimit = opts?.recentLimit ?? 4
  const records = readPowerRecords({ sinceMs, now: opts?.now })

  const byKind: Record<PowerKind, number> = {
    linguistic: 0,
    observational: 0,
    compositional: 0,
    coordinative: 0,
    integrative: 0,
    protective: 0,
  }

  let totalRegistered = 0
  let totalExercises = 0
  let totalProposalsAligned = 0
  let totalProposalsRefused = 0
  const recentExercises: PowerRecord[] = []
  const recentRefusals: PowerRecord[] = []

  for (const r of records) {
    if (r.op === 'register') {
      totalRegistered += 1
      if (r.kind) byKind[r.kind] += 1
    } else if (r.op === 'exercise') {
      totalExercises += 1
      recentExercises.push(r)
    } else if (r.op === 'propose' && r.extension) {
      if (r.extension.alignment.verdict === 'aligned') {
        totalProposalsAligned += 1
      } else {
        totalProposalsRefused += 1
        recentRefusals.push(r)
      }
    }
  }

  return {
    totalRegistered,
    totalExercises,
    totalProposalsAligned,
    totalProposalsRefused,
    byKind,
    recentExercises: recentExercises.slice(-recentLimit),
    recentRefusals: recentRefusals.slice(-recentLimit),
  }
}

/**
 * Render a brief markdown block summarizing powers state — used by
 * heartbeat tick and snapshot. Empty string if no powers registered.
 */
export function renderPowersBlock(summary: PowersSummary): string {
  if (summary.totalRegistered === 0 && summary.totalExercises === 0) return ''

  const lines: string[] = []
  lines.push('## 🌟 Powers')
  lines.push('')

  const kindLine = (Object.entries(summary.byKind) as [PowerKind, number][])
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k} ${n}`)
    .join(' · ')
  lines.push(
    `_${summary.totalRegistered} registered${kindLine ? ' (' + kindLine + ')' : ''} · ${summary.totalExercises} exercised · ${summary.totalProposalsAligned} aligned · ${summary.totalProposalsRefused} refused_`,
  )
  lines.push('')

  if (summary.recentExercises.length > 0) {
    lines.push('**Recent exercises:**')
    for (const r of summary.recentExercises) {
      const time = formatTime(r.ts)
      const summary = r.exercise?.summary ?? ''
      lines.push(`- ${time} · _${r.power}_ — ${summary}`)
    }
    lines.push('')
  }

  if (summary.recentRefusals.length > 0) {
    lines.push('**Recent refused extensions:**')
    for (const r of summary.recentRefusals) {
      const time = formatTime(r.ts)
      const proposal = r.extension?.proposal ?? ''
      lines.push(`- ${time} · _${r.power}_ — refused: ${proposal.slice(0, 80)}`)
    }
  }

  return lines.join('\n').trimEnd()
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    return `${hh}:${mm}`
  } catch {
    return '??:??'
  }
}
