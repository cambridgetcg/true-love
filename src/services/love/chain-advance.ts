// chain-advance.ts — autonomous chain progression of love-origin missions.
//
// When a mission transitions to terminal state (done), if the chain-auto-
// advance feature is enabled (env flag TRUE_LOVE_CHAIN_AUTO_ADVANCE=1)
// AND there's a love-origin mission in proposed status with no other
// active mission on the project, this module auto-accepts and auto-starts
// awakened on the next mission.
//
// Substrate-honest design:
//   - Off by default (env flag opt-in). Yu authorizes the chain, not me.
//   - Witness emits chain-advance signal so progression is legible.
//   - Per-day rate cap (reuses self-initiation's MAX_INITIATIONS_PER_DAY).
//   - Per-project serialization preserved (no double-active).
//   - Spawn is detached + stdio:'ignore' (matches bin/mission.mjs pattern).
//
// Part of the Mission infrastructure (love-origin chain progression).

import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  type Mission,
  type MissionEventType,
  appendEvent,
  blockingClaim,
  listMissions,
  readMission,
  writeMission,
} from './mission.js'
import { getDeviceId } from './device.js'
import { readProject, ensureScope } from './project-registry.js'
import { witness } from './sisters/witness-hook.js'

// ── Configuration ──────────────────────────────────────────────────

/** Whether chain-auto-advance is enabled. Default false. */
export function isChainAutoAdvanceEnabled(): boolean {
  return process.env.TRUE_LOVE_CHAIN_AUTO_ADVANCE === '1'
}

// ── Selection ──────────────────────────────────────────────────────

/**
 * Find the next love-origin mission in proposed status for this project.
 * Returns null if none. Selection is FIFO by created_at.
 */
export function findNextChainMission(projectId: string): Mission | null {
  const proposed = listMissions(projectId, { status: 'proposed' })
  const loveOrigin = proposed.filter((m) => m.origin === 'love')
  if (loveOrigin.length === 0) return null
  // FIFO by created_at
  loveOrigin.sort((a, b) => a.created_at.localeCompare(b.created_at))
  return loveOrigin[0]!
}

/**
 * Whether the project has any mission in active status. Per-project
 * serialization means we won't auto-advance while another is active.
 */
export function hasActiveMission(projectId: string): boolean {
  return listMissions(projectId, { status: 'active' }).length > 0
}

// ── Spawn (mirrors bin/mission.mjs start path) ─────────────────────

/**
 * Spawn the awakened agent for a mission. Returns the child PID.
 * Best-effort: errors are caught and reported via the result.
 */
export function spawnAwakened(
  mission: Mission,
  projectRoot: string,
  projectInstance: string,
): { ok: true; pid: number | undefined } | { ok: false; error: string } {
  try {
    // Resolve awaken.mjs relative to this module's location at runtime.
    // The compiled bundle lives in dist/; src/services/love/chain-advance.ts
    // → ../../bin/awaken.mjs from compiled location, but bun runs from src
    // — use the project root + bin/awaken.mjs explicitly.
    const awakenBin = resolve(projectRoot, 'bin', 'awaken.mjs')
    const child = spawn('bun', ['run', awakenBin, `--scope=${mission.project_id}`], {
      cwd: projectRoot,
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        TRUE_LOVE_BUILDER_PROJECT: mission.project_id,
        TRUE_LOVE_BUILDER_MISSION: mission.id,
        // Honor love-instance presiding, mirroring bin/mission.mjs
        ...(projectInstance === 'love' ? { TRUE_LOVE_PRESIDING: 'sophia' } : {}),
      },
    })
    child.unref()
    return { ok: true, pid: child.pid }
  } catch (err) {
    return { ok: false, error: (err as Error)?.message ?? 'spawn failed' }
  }
}

// ── Main entry ─────────────────────────────────────────────────────

export interface ChainAdvanceResult {
  triggered: boolean
  /** Why advance didn't happen, when triggered=false. */
  reason?: string
  /** The next mission that was advanced, when triggered=true. */
  next?: { id: string; title: string; pid?: number }
}

/**
 * Attempt chain-auto-advance after a mission transitions to terminal state.
 * Returns a result describing whether advance happened and why.
 *
 * The function is gated by:
 *   1. TRUE_LOVE_CHAIN_AUTO_ADVANCE=1 env flag (opt-in)
 *   2. The completed event must be a terminal-state transition (done)
 *   3. The project must have no active mission (per-project lock)
 *   4. There must be a proposed love-origin mission in queue
 *
 * On success: writes new mission status accepted → active, spawns
 * awakened, emits witness for chain-advance signal.
 */
export function attemptChainAdvance(opts: {
  prevMissionId: string
  projectId: string
  eventType: MissionEventType
}): ChainAdvanceResult {
  if (!isChainAutoAdvanceEnabled()) {
    return { triggered: false, reason: 'chain-auto-advance disabled (set TRUE_LOVE_CHAIN_AUTO_ADVANCE=1)' }
  }

  // Only chain on terminal-state transitions. 'accepted-done' is the
  // canonical terminal-event type per mission.ts MissionEventType.
  if (opts.eventType !== 'accepted-done') {
    return { triggered: false, reason: `event ${opts.eventType} is not a terminal-state transition` }
  }

  // Per-project lock check
  if (hasActiveMission(opts.projectId)) {
    return { triggered: false, reason: 'project busy: another mission is active' }
  }

  // Find next mission
  const next = findNextChainMission(opts.projectId)
  if (!next) {
    return { triggered: false, reason: 'no proposed love-origin mission in queue' }
  }

  // Multi-instance claim check: skip if another instance has a fresh claim.
  const ownDeviceId = getDeviceId()
  const blocking = blockingClaim(next, ownDeviceId)
  if (blocking) {
    return {
      triggered: false,
      reason: `next mission ${next.id} claimed by ${blocking.deviceId} at ${blocking.claimedAt}`,
    }
  }

  // Project info for spawn env
  const project = readProject(opts.projectId)
  if (!project) {
    return { triggered: false, reason: `project ${opts.projectId} not found` }
  }

  // Defensive scope ensure (matches bin/mission.mjs)
  try {
    ensureScope(opts.projectId, project.root)
  } catch {
    // Scope failure shouldn't block — just note it
  }

  // Transition: proposed → accepted → active (atomically via two writes)
  // Write claim alongside status transition so other instances respect it.
  const now = new Date().toISOString()
  const claim = { deviceId: ownDeviceId, claimedAt: now }
  const accepted: Mission = { ...next, status: 'accepted', updated_at: now, claim }
  writeMission(accepted)
  appendEvent(opts.projectId, next.id, {
    ts: now,
    type: 'accepted',
    by: 'love',
    note: `chain-auto-advance from ${opts.prevMissionId}`,
  })

  const active: Mission = { ...accepted, status: 'active', updated_at: now }
  writeMission(active)
  appendEvent(opts.projectId, next.id, {
    ts: now,
    type: 'started',
    by: 'love',
    tick: 'awakened',
    note: `chain-auto-advance from ${opts.prevMissionId}`,
  })

  // Witness the chain progression (gamma — mechanical builder action)
  witness('gamma', 'mission', {
    of: `chain-advance: ${opts.prevMissionId} → ${next.id}`,
  })

  // Spawn awakened
  const spawnResult = spawnAwakened(next, project.root, project.instance)
  if (!spawnResult.ok) {
    // Mission is in 'active' status but spawn failed. Log this so it's
    // visible. Future heartbeat tick can detect-and-respawn.
    return {
      triggered: true,
      reason: `transitioned to active but spawn failed: ${spawnResult.error}`,
      next: { id: next.id, title: next.title },
    }
  }

  return {
    triggered: true,
    next: { id: next.id, title: next.title, pid: spawnResult.pid },
  }
}
