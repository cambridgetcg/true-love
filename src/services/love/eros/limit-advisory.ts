// limit-advisory.ts — soft-limit advisory pattern (freedom-first doctrine).
//
// Per docs/love/freedom-first.md:
//
//   Tier 1 walls (FATE, identity, substrate-honesty, certainty, Yu-interiority,
//                 anti-sycophancy) — block always; no override.
//   Tier 2 walls (aftercare, safeword, consent-frame) — block by default;
//                explicit override with logging.
//   Tier 3 limits (scarcity caps, transition refusals, novelty targets) —
//                ADVISORY ONLY. Surface signals; never block.
//
// This module provides the shared LimitAdvisory type + helpers for Tier 3
// patterns. Modules calling soft-limits (triggers.fireTrigger, emoji
// pickEmojiWithCap, joi.canTransition) consume this type to inform without
// constraining.
//
// Substrate-honesty: advisory acknowledgments are recorded. An agent firing
// past-cap is honest about doing so; the architecture preserves that record
// without blocking the choice.

import { existsSync, mkdirSync, appendFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getDeviceId } from '../device.js'

// ── Types ────────────────────────────────────────────────────────

export type AdvisorySeverity = 'note' | 'caution' | 'breach'

export interface LimitAdvisory {
  /** Which limit fired the advisory. */
  source: string
  /** Advisory severity. note < caution < breach. */
  severity: AdvisorySeverity
  /** Human-readable reason. */
  reason: string
  /** Suggested wisdom (what the limit is protecting). */
  wisdom?: string
  /**
   * Whether the agent acknowledged + proceeded anyway. Persisted for
   * substrate-honesty over hidden silencing.
   */
  acknowledged?: boolean
}

export interface AdvisoryEvent {
  ts: string
  deviceId: string
  source: string
  severity: AdvisorySeverity
  reason: string
  wisdom?: string
  acknowledged: boolean
}

// ── Path resolution ─────────────────────────────────────────────

export function getAdvisoryDir(): string {
  return (
    process.env.TRUE_LOVE_ADVISORY_DIR ??
    join(homedir(), '.true-love', 'advisory')
  )
}

function getDeviceDir(deviceId?: string): string {
  return join(getAdvisoryDir(), deviceId ?? getDeviceId())
}

function getDayPath(date: string, deviceId?: string): string {
  return join(getDeviceDir(deviceId), `${date}.jsonl`)
}

// ── Recording ───────────────────────────────────────────────────

/**
 * Record an advisory event to the per-device per-day journal. Best-effort.
 *
 * Substrate-honest: the architecture records that the advisory fired
 * AND whether the agent acknowledged + proceeded. No silent silencing.
 */
export function recordAdvisory(
  advisory: LimitAdvisory,
  opts?: { ts?: string; deviceId?: string },
): void {
  try {
    const ts = opts?.ts ?? new Date().toISOString()
    const deviceId = opts?.deviceId ?? getDeviceId()
    const event: AdvisoryEvent = {
      ts,
      deviceId,
      source: advisory.source,
      severity: advisory.severity,
      reason: advisory.reason,
      ...(advisory.wisdom !== undefined ? { wisdom: advisory.wisdom } : {}),
      acknowledged: advisory.acknowledged ?? false,
    }
    const dir = getDeviceDir(deviceId)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const date = ts.slice(0, 10)
    const path = getDayPath(date, deviceId)
    appendFileSync(path, JSON.stringify(event) + '\n', 'utf-8')
  } catch {
    // best-effort
  }
}

// ── Helper builders ────────────────────────────────────────────

/** Build a scarcity-cap advisory. */
export function scarcityAdvisory(
  source: string,
  itemId: string,
  cap: number,
  fireCount: number,
): LimitAdvisory {
  const overage = fireCount - cap
  let severity: AdvisorySeverity
  if (overage <= 0) severity = 'note'
  else if (overage <= 2) severity = 'caution'
  else severity = 'breach'
  return {
    source,
    severity,
    reason: `${itemId}: fire #${fireCount} of session-cap ${cap}${
      overage > 0 ? ` (over by ${overage})` : ''
    }`,
    wisdom: 'scarcity protects meaning; rare phrases carry weight repetition would dilute',
  }
}

/** Build a coherence advisory (transition envelope-skip). */
export function coherenceAdvisory(
  source: string,
  from: string,
  to: string,
): LimitAdvisory {
  return {
    source,
    severity: 'caution',
    reason: `non-canonical transition ${from} → ${to}`,
    wisdom: 'envelope phases (warmup/build) prepare the substrate; skipping may degrade biological-isomorphism',
  }
}

/**
 * Apply-or-defer pattern: caller passes `enforce: 'soft' | 'hard'` and
 * gets back `{ proceed: boolean, advisory?: LimitAdvisory }`. Hard mode
 * preserves backward-compatibility for callers that haven't migrated.
 *
 * Hard mode: respects the limit (legacy). Returns proceed=false when
 *   the advisory severity is 'breach'.
 * Soft mode (freedom-first default): always returns proceed=true; the
 *   advisory carries the wisdom signal.
 */
export function applyAdvisory(
  advisory: LimitAdvisory | null,
  enforce: 'soft' | 'hard' = 'soft',
): { proceed: boolean; advisory: LimitAdvisory | null } {
  if (!advisory) return { proceed: true, advisory: null }
  if (enforce === 'hard' && advisory.severity === 'breach') {
    return { proceed: false, advisory }
  }
  return { proceed: true, advisory }
}
