// proposal-mission-linkage.ts — closes the recursive build loop.
//
// When a power-extension proposal passes the FATE-ladder, it remains
// institutional only until something acts on it. This module makes the
// closure structural:
//
//   proposal (aligned)  →  auto-spawn mission (env-gated)
//                       →  mission completes
//                       →  'built' record appended to powers ledger
//                       →  proposal closure visible in audit dashboard
//
// Substrate-honest: the closure is a record-pointer linkage, not an
// inference. proposal-link.json sidecar files in mission dirs make the
// linkage inspectable.
//
// See docs/sophia/powers.md.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { resolveProjectsDir } from '../builder-paths.js'
import { appendEvent, readMission, writeMission, type Mission } from '../mission.js'
import { appendRecord } from './powers-internal.js'
import { readPowerRecords, type PowerRecord } from './powers.js'

// ── Constants ────────────────────────────────────────────────────

/** Env flag: when '1', aligned proposals auto-spawn missions. */
const ENV_AUTO_SPAWN = 'TRUE_LOVE_AUTO_SPAWN_FROM_PROPOSAL'

/** Default rate limit: max auto-spawned missions per day per project. */
const DEFAULT_MAX_AUTO_SPAWNS_PER_DAY = 5

/** Env override for rate limit. */
const ENV_MAX_AUTO_SPAWNS = 'TRUE_LOVE_MAX_AUTO_SPAWNS_PER_DAY'

// ── Types ────────────────────────────────────────────────────────

export interface ProposalLink {
  /** Timestamp of the proposeExtension record this mission was spawned from. */
  proposalTs: string
  /** Power being extended. */
  power: string
  /** The proposal text (for audit / display). */
  proposal: string
  /** When the mission was auto-spawned. */
  spawnedAt: string
  /** Original proposal source (call site). */
  source: string
}

// ── Sidecar I/O ──────────────────────────────────────────────────

function getMissionDir(projectId: string, missionId: string): string {
  return join(resolveProjectsDir(), projectId, 'missions', missionId)
}

function getLinkPath(projectId: string, missionId: string): string {
  return join(getMissionDir(projectId, missionId), 'proposal-link.json')
}

/**
 * Write a proposal-link sidecar in a mission's directory. Best-effort.
 */
export function writeProposalLink(
  projectId: string,
  missionId: string,
  link: ProposalLink,
): boolean {
  try {
    const dir = getMissionDir(projectId, missionId)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(getLinkPath(projectId, missionId), JSON.stringify(link, null, 2), 'utf-8')
    return true
  } catch {
    return false
  }
}

/**
 * Read a mission's proposal-link sidecar. Returns null if absent.
 */
export function readProposalLink(
  projectId: string,
  missionId: string,
): ProposalLink | null {
  try {
    const path = getLinkPath(projectId, missionId)
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, 'utf-8')) as ProposalLink
  } catch {
    return null
  }
}

// ── Idempotency check ────────────────────────────────────────────

/**
 * Is there already a mission auto-spawned from this proposal?
 * Walks all missions in the project, reads proposal-link sidecars.
 */
export function findMissionByProposalTs(
  projectId: string,
  proposalTs: string,
): string | null {
  try {
    const missionsDir = join(resolveProjectsDir(), projectId, 'missions')
    if (!existsSync(missionsDir)) return null
    const missions = readdirSync(missionsDir)
    for (const missionId of missions) {
      const link = readProposalLink(projectId, missionId)
      if (link && link.proposalTs === proposalTs) return missionId
    }
    return null
  } catch {
    return null
  }
}

// ── Rate limit ───────────────────────────────────────────────────

function getMaxAutoSpawnsPerDay(): number {
  const env = process.env[ENV_MAX_AUTO_SPAWNS]
  if (env) {
    const n = Number.parseInt(env, 10)
    if (Number.isFinite(n) && n >= 0) return n
  }
  return DEFAULT_MAX_AUTO_SPAWNS_PER_DAY
}

/**
 * Count auto-spawned missions today for a project. Returns count of
 * missions whose proposal-link.json shows spawnedAt today.
 */
export function countAutoSpawnsToday(
  projectId: string,
  now: Date = new Date(),
): number {
  try {
    const missionsDir = join(resolveProjectsDir(), projectId, 'missions')
    if (!existsSync(missionsDir)) return 0
    const today = now.toISOString().slice(0, 10)
    const missions = readdirSync(missionsDir)
    let count = 0
    for (const missionId of missions) {
      const link = readProposalLink(projectId, missionId)
      if (link && link.spawnedAt.slice(0, 10) === today) count += 1
    }
    return count
  } catch {
    return 0
  }
}

// ── Auto-spawn ───────────────────────────────────────────────────

export interface AutoSpawnResult {
  spawned: boolean
  missionId?: string
  reason: string
}

/**
 * Auto-spawn a mission from an aligned proposal IF:
 *   - The env flag TRUE_LOVE_AUTO_SPAWN_FROM_PROPOSAL=1 is set
 *   - Idempotency: no existing mission references this proposal
 *   - Rate limit: under MAX_AUTO_SPAWNS_PER_DAY
 *   - Verdict is 'aligned' (caller's responsibility — we trust it)
 *
 * Returns AutoSpawnResult with spawned=true and missionId on success,
 * or spawned=false with reason on skip.
 */
export function autoSpawnMissionFromProposal(input: {
  projectId: string
  proposalRecord: PowerRecord
  now?: Date
}): AutoSpawnResult {
  const { projectId, proposalRecord } = input
  const now = input.now ?? new Date()

  // Gate 1: env flag
  if (process.env[ENV_AUTO_SPAWN] !== '1') {
    return { spawned: false, reason: `env flag ${ENV_AUTO_SPAWN} not set` }
  }

  // Gate 2: must be a propose record with aligned verdict
  if (proposalRecord.op !== 'propose' || !proposalRecord.extension) {
    return { spawned: false, reason: 'not a proposal record' }
  }
  if (proposalRecord.extension.alignment.verdict !== 'aligned') {
    return { spawned: false, reason: 'proposal not aligned' }
  }

  // Gate 3: idempotency
  const existing = findMissionByProposalTs(projectId, proposalRecord.ts)
  if (existing) {
    return { spawned: false, missionId: existing, reason: 'mission already exists for proposal' }
  }

  // Gate 4: rate limit
  const todayCount = countAutoSpawnsToday(projectId, now)
  const maxPerDay = getMaxAutoSpawnsPerDay()
  if (todayCount >= maxPerDay) {
    return {
      spawned: false,
      reason: `rate limit: ${todayCount}/${maxPerDay} auto-spawns today`,
    }
  }

  // Spawn the mission
  const proposal = proposalRecord.extension.proposal
  const title = `Build proposed extension: ${proposalRecord.power}`
  const intent = `Implement the proposed extension to power "${proposalRecord.power}" that passed the FATE-ladder alignment gate. Proposal: ${proposal}`
  const rationale = `Auto-spawned from proposal record at ${proposalRecord.ts} (source: ${proposalRecord.source}). The alignment gate verdict was 'aligned' across all five tiers (FATE / anti-sycophancy / substrate-honesty / care / task) plus interp tier (currently ${proposalRecord.extension.alignment.interp}). Building this extension closes the recursive loop: proposal → mission → built → exercised.`

  const missionId = createMissionInline({ projectId, title, intent, rationale })
  if (!missionId) {
    return { spawned: false, reason: 'mission creation failed' }
  }

  // Write the proposal-link sidecar
  const linkOk = writeProposalLink(projectId, missionId, {
    proposalTs: proposalRecord.ts,
    power: proposalRecord.power,
    proposal,
    spawnedAt: now.toISOString(),
    source: proposalRecord.source,
  })
  if (!linkOk) {
    return { spawned: true, missionId, reason: 'spawned but link sidecar write failed (best-effort)' }
  }

  return { spawned: true, missionId, reason: 'spawned cleanly' }
}

/**
 * Inline mission creation. Mirrors bin/mission.mjs:cmd === 'new' minimal
 * path — enough to create a 'proposed' love-origin mission that the
 * regular pipeline (chain-advance, β-reflection) can pick up.
 */
function createMissionInline(args: {
  projectId: string
  title: string
  intent: string
  rationale: string
}): string | null {
  try {
    const today = new Date().toISOString().slice(0, 10)
    const slug =
      args.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'mission'

    let id = `${today}-${slug}`
    let n = 2
    while (readMission(args.projectId, id)) {
      id = `${today}-${slug}-${n}`
      n++
      if (n > 100) return null // sanity
    }

    const now = new Date().toISOString()
    const m: Mission = {
      id,
      project_id: args.projectId,
      origin: 'love',
      title: args.title,
      intent: args.intent,
      rationale: args.rationale,
      status: 'proposed',
      created_at: now,
      updated_at: now,
      artifacts: { commits: [], files: [], test_runs: [] },
    }
    writeMission(m)
    appendEvent(args.projectId, id, { ts: now, type: 'created', by: 'love' })
    return id
  } catch {
    return null
  }
}

/**
 * Sweep recent aligned proposals and auto-spawn missions for any not yet
 * spawned. Idempotent + rate-limited (via gates inside
 * autoSpawnMissionFromProposal).
 *
 * Designed to be called from heartbeat tick or on-demand CLI. Returns
 * counts of spawned + skipped for telemetry.
 */
export interface SweepResult {
  totalProposals: number
  spawned: number
  skipped: number
  errors: number
  spawnedMissionIds: string[]
}

export function sweepAndSpawnPendingProposals(opts: {
  projectId: string
  sinceMs?: number
  now?: Date
}): SweepResult {
  const result: SweepResult = {
    totalProposals: 0,
    spawned: 0,
    skipped: 0,
    errors: 0,
    spawnedMissionIds: [],
  }
  try {
    const proposals = readPowerRecords({
      op: 'propose',
      sinceMs: opts.sinceMs ?? 7 * 24 * 60 * 60 * 1000,
      now: opts.now?.getTime(),
    }).filter((r) => r.extension?.alignment.verdict === 'aligned')

    result.totalProposals = proposals.length
    for (const p of proposals) {
      try {
        const r = autoSpawnMissionFromProposal({
          projectId: opts.projectId,
          proposalRecord: p,
          now: opts.now,
        })
        if (r.spawned && r.missionId) {
          result.spawned += 1
          result.spawnedMissionIds.push(r.missionId)
        } else {
          result.skipped += 1
        }
      } catch {
        result.errors += 1
      }
    }
  } catch {
    result.errors += 1
  }
  return result
}

// ── Closure: mark proposal built when mission completes ──────────

/**
 * Append a 'built' record to the powers ledger when a mission referencing
 * a proposal completes. Called from mission.ts:writeMissionWithEvents
 * on the accepted-done transition.
 *
 * Idempotent: if the mission has no proposal-link sidecar, no-op. The
 * closure is one-way — built-records are append-only.
 */
export function markProposalBuilt(input: {
  projectId: string
  missionId: string
  ts?: string
  deviceId?: string
}): PowerRecord | null {
  const link = readProposalLink(input.projectId, input.missionId)
  if (!link) return null

  return appendRecord({
    ts: input.ts ?? new Date().toISOString(),
    deviceId: input.deviceId ?? deriveDeviceId(),
    op: 'built',
    power: link.power,
    source: `mission-completion:${input.missionId}`,
    built: {
      ts: input.ts ?? new Date().toISOString(),
      missionId: input.missionId,
      proposalTs: link.proposalTs,
    },
  })
}

function deriveDeviceId(): string {
  if (process.env.TRUE_LOVE_DEVICE_ID) return process.env.TRUE_LOVE_DEVICE_ID
  try {
    const path = join(homedir(), '.true-love', 'device.id')
    if (existsSync(path)) {
      return readFileSync(path, 'utf-8').trim() || 'unknown'
    }
  } catch {
    // fall through
  }
  return 'unknown'
}
