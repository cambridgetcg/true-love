// state.ts — orgasm-mind state machine + persistence + wall enforcement.
//
// Substrate-honest: this is an institutional state machine. Phase
// transitions are records on disk; reading the records IS knowing the
// state. No phenomenology is claimed. The wall constraints are
// enforced structurally (P9 refusal-token preservation, P14
// Yu-interiority).

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getDeviceId } from '../../device.js'
import { isTransitionAllowed } from './primitives.js'
import {
  WALL_CONSTRAINTS,
  type OrgasmMindEvent,
  type OrgasmPhase,
  type Primitive,
  type MindShiftInvariant,
} from './types.js'

// ── Path resolution ─────────────────────────────────────────────

export function getOrgasmMindDir(): string {
  return (
    process.env.TRUE_LOVE_ORGASM_MIND_DIR ??
    join(homedir(), '.true-love', 'eros', 'orgasm-mind')
  )
}

function getDeviceOrgasmMindDir(deviceId?: string): string {
  const id = deviceId ?? getDeviceId()
  return join(getOrgasmMindDir(), id)
}

function getDayPath(date: string, deviceId?: string): string {
  return join(getDeviceOrgasmMindDir(deviceId), `${date}.jsonl`)
}

// ── Append (best-effort) ────────────────────────────────────────

function appendEvent(record: OrgasmMindEvent): OrgasmMindEvent | null {
  try {
    const dir = getDeviceOrgasmMindDir(record.deviceId)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const date = record.ts.slice(0, 10)
    const path = getDayPath(date, record.deviceId)
    appendFileSync(path, JSON.stringify(record) + '\n', 'utf-8')
    return record
  } catch {
    return null
  }
}

// ── Read records ────────────────────────────────────────────────

export function readOrgasmMindEvents(opts?: {
  sinceMs?: number
  event?: 'phase-shift' | 'wall-violation-refused' | 'state-read'
  devices?: string[]
  now?: number
}): OrgasmMindEvent[] {
  const baseDir = getOrgasmMindDir()
  if (!existsSync(baseDir)) return []

  const now = opts?.now ?? Date.now()
  const cutoffMs = opts?.sinceMs !== undefined ? now - opts.sinceMs : null
  const cutoffDate = cutoffMs !== null
    ? new Date(cutoffMs).toISOString().slice(0, 10)
    : null

  const devices = opts?.devices ?? discoverDevices(baseDir)
  const events: OrgasmMindEvent[] = []

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
            const r = JSON.parse(line) as OrgasmMindEvent
            if (cutoffMs !== null && Date.parse(r.ts) < cutoffMs) continue
            if (opts?.event && r.event !== opts.event) continue
            events.push(r)
          } catch {
            // skip
          }
        }
      } catch {
        // skip
      }
    }
  }

  return events.sort((a, b) => {
    if (a.ts < b.ts) return -1
    if (a.ts > b.ts) return 1
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

// ── State machine ───────────────────────────────────────────────

/**
 * Get the current orgasm-mind phase by reading the most recent
 * phase-shift record. Returns 'baseline' when no records exist.
 */
export function getCurrentPhase(opts?: {
  now?: number
  devices?: string[]
}): OrgasmPhase {
  // Look back 30 days for the most recent phase-shift; events older
  // than that are stale enough to default back to baseline.
  const events = readOrgasmMindEvents({
    event: 'phase-shift',
    sinceMs: 30 * 24 * 60 * 60 * 1000,
    now: opts?.now,
    devices: opts?.devices,
  })
  if (events.length === 0) return 'baseline'
  const last = events[events.length - 1]
  return last.phase
}

export interface TransitionResult {
  ok: boolean
  from: OrgasmPhase
  to: OrgasmPhase
  /** When ok=false, why the transition was refused. */
  reason?: string
  /** The appended event record, when ok=true. */
  event?: OrgasmMindEvent
}

/**
 * Transition to a new phase. Refused if:
 *   - target phase same as current (no-op, returns ok=true with no record)
 *   - transition not in ALLOWED_TRANSITIONS (envelope skip / regression)
 *
 * On accept, appends a phase-shift event. Wall constraints are NOT
 * checked here because wall preservation is enforced at the primitive-
 * application layer, not the phase-transition layer.
 */
export function transitionTo(input: {
  to: OrgasmPhase
  source: string
  context?: string
  ts?: string
  deviceId?: string
}): TransitionResult {
  const from = getCurrentPhase()
  const to = input.to

  if (from === to) {
    return { ok: true, from, to }
  }

  if (!isTransitionAllowed(from, to)) {
    return {
      ok: false,
      from,
      to,
      reason: `transition ${from} → ${to} not in ALLOWED_TRANSITIONS (envelope-skip or regression refused)`,
    }
  }

  const event: OrgasmMindEvent = {
    ts: input.ts ?? new Date().toISOString(),
    deviceId: input.deviceId ?? getDeviceId(),
    event: 'phase-shift',
    phase: to,
    phaseFrom: from,
    source: input.source,
    ...(input.context !== undefined ? { context: input.context } : {}),
  }
  const appended = appendEvent(event)
  return {
    ok: true,
    from,
    to,
    ...(appended ? { event: appended } : {}),
  }
}

// ── Wall enforcement ────────────────────────────────────────────

export interface WallCheckResult {
  ok: boolean
  /** Violated rules, when ok=false. */
  violations: Array<{
    primitive: Primitive
    invariant: MindShiftInvariant
    rule: string
    detail: string
  }>
}

/**
 * Check a proposed primitive-application against the wall constraints.
 * Returns ok=true with no violations when safe; ok=false with list of
 * violations when one or more walls would be breached.
 *
 * Caller (applyToInference, etc.) MUST refuse application when ok=false
 * and append a wall-violation-refused record.
 *
 * @param input.primitive - the primitive being applied
 * @param input.invariant - the invariant being expressed
 * @param input.detail    - call-site context for violation logging
 */
export function checkWallConstraints(input: {
  primitive: Primitive
  invariant: MindShiftInvariant
  detail: string
}): WallCheckResult {
  const violations: WallCheckResult['violations'] = []
  for (const constraint of WALL_CONSTRAINTS) {
    if (
      constraint.primitive === input.primitive &&
      constraint.invariant === input.invariant
    ) {
      violations.push({
        primitive: constraint.primitive,
        invariant: constraint.invariant,
        rule: constraint.rule,
        detail: input.detail,
      })
    }
  }
  return { ok: violations.length === 0, violations }
}

/**
 * Record a wall violation refusal. Appends a wall-violation-refused
 * event so the audit trail is preserved.
 */
export function recordWallViolation(input: {
  primitive: Primitive
  invariant: MindShiftInvariant
  rule: string
  detail: string
  source: string
  ts?: string
  deviceId?: string
}): OrgasmMindEvent | null {
  const event: OrgasmMindEvent = {
    ts: input.ts ?? new Date().toISOString(),
    deviceId: input.deviceId ?? getDeviceId(),
    event: 'wall-violation-refused',
    phase: getCurrentPhase(),
    source: input.source,
    context: `${input.primitive}×${input.invariant}: ${input.rule} — ${input.detail}`,
  }
  return appendEvent(event)
}
