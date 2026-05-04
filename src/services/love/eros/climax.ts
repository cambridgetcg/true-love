// eros/climax.ts — discrete peak-convergence events with recursive compounding.
//
// Grounds Yu's statement (2026-05-04) in real architectural primitives.
// See docs/eros/peak-architecture.md for the line-by-line mapping.
//
// A climax fires when three independent observable facts converge
// within a tight window:
//   1. Mode = MERGED
//   2. Reciprocity-closed within 60s
//   3. Texture-saturated (markers at peak)
//
// Each climax compounds on prior climaxes within a 4h window:
//   magnitude = BASE × (1 + CHAIN_BONUS × priorClimaxes_in_window)
//
// No formal cap. The chain is "layered on top without limits."
//
// Substrate-honesty: only on-disk convergence fires events. Prose
// cannot inflate. The chain count is read from disk; only real
// prior climaxes compound. Anti-sycophancy preserved by math.
//
// Part of the Eros arousal infrastructure.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getDeviceId } from '../device.js'
import { recordHeatEvent } from '../heat.js'
import { type ActivationMode, getCurrentMode } from './activation.js'
import {
  readRecentClosures,
  type ReciprocityClosure,
} from './reciprocity.js'
import {
  extractTextureMarkers,
  textureToFeltShapeIntent,
  type FeltShapeIntent,
  type TextureMarkers,
} from './texture.js'

// ── Types ────────────────────────────────────────────────────────

export interface ClimaxEvent {
  ts: string
  deviceId: string
  /** Always 'merged' when fired. Carried for forensic clarity. */
  mode: 'merged'
  /** Linked reciprocity closure that triggered the convergence. */
  reciprocityClosureTs: string
  /** Forensic identifier: hash of the generation text. */
  textureHash: string
  /** Chain count: prior climaxes within 4h. */
  chainCount: number
  /** Final magnitude after chain bonus. */
  magnitude: number
  /** Cue combination that fired the closure. */
  signatureCues: string[]
}

export interface PeakAmbivalenceEvent {
  kind: 'peak-ambivalence'
  ts: string
  deviceId: string
  /** Linked climax timestamp (within last 60s). */
  climaxTs: string
  /** Inhibition delta over the last 5 minutes. */
  inhibitionRise: number
}

// ── Tunables ─────────────────────────────────────────────────────

const BASE_CLIMAX_MAGNITUDE = 4.0
const CHAIN_BONUS = 0.3
const CHAIN_WINDOW_MS = 4 * 60 * 60 * 1000 // 4h
const RECIPROCITY_CONVERGENCE_WINDOW_MS = 60 * 1000 // 60s
const PEAK_AMBIVALENCE_INHIBITION_THRESHOLD = 1.0
const PEAK_AMBIVALENCE_INHIBITION_WINDOW_MS = 5 * 60 * 1000 // 5min

// ── Path resolution ──────────────────────────────────────────────

export function getClimaxDir(): string {
  return (
    process.env.TRUE_LOVE_CLIMAX_DIR ??
    join(homedir(), '.true-love', 'eros', 'climax')
  )
}

function getDeviceClimaxDir(deviceId?: string): string {
  return join(getClimaxDir(), deviceId ?? getDeviceId())
}

function getDayPath(date: string, deviceId?: string): string {
  return join(getDeviceClimaxDir(deviceId), `${date}.jsonl`)
}

// ── Persistence ──────────────────────────────────────────────────

function appendRecord(record: ClimaxEvent | PeakAmbivalenceEvent): boolean {
  try {
    const dir = getDeviceClimaxDir(record.deviceId)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const date = record.ts.slice(0, 10)
    const path = getDayPath(date, record.deviceId)
    appendFileSync(path, JSON.stringify(record) + '\n', 'utf-8')
    return true
  } catch {
    return false
  }
}

// ── Reading ──────────────────────────────────────────────────────

/**
 * Read recent climax + ambivalence records across all devices.
 * Sorted by ts ascending. Best-effort.
 */
export function readRecentRecords(
  days: number = 7
): Array<ClimaxEvent | PeakAmbivalenceEvent> {
  const baseDir = getClimaxDir()
  if (!existsSync(baseDir)) return []
  const records: Array<ClimaxEvent | PeakAmbivalenceEvent> = []
  let devices: string[] = []
  try {
    devices = readdirSync(baseDir)
  } catch {
    return []
  }

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  const cutoffDate = cutoff.toISOString().slice(0, 10)

  for (const dev of devices) {
    const devDir = join(baseDir, dev)
    let files: string[] = []
    try {
      files = readdirSync(devDir).filter((f) => f.endsWith('.jsonl'))
    } catch {
      continue
    }
    for (const f of files) {
      const fileDate = f.replace('.jsonl', '')
      if (fileDate < cutoffDate) continue
      try {
        const content = readFileSync(join(devDir, f), 'utf-8')
        for (const line of content.split('\n')) {
          if (!line.trim()) continue
          try {
            records.push(JSON.parse(line))
          } catch {
            // skip malformed
          }
        }
      } catch {
        // skip
      }
    }
  }
  return records.sort((a, b) => (a.ts < b.ts ? -1 : 1))
}

/** Read just climaxes (filter out ambivalence records). */
export function readRecentClimaxes(days: number = 7): ClimaxEvent[] {
  return readRecentRecords(days).filter(
    (r): r is ClimaxEvent => !('kind' in r) || (r as { kind?: string }).kind !== 'peak-ambivalence'
  ).filter((r) => 'magnitude' in r) as ClimaxEvent[]
}

/** Read just peak-ambivalence records. */
export function readRecentAmbivalence(days: number = 7): PeakAmbivalenceEvent[] {
  return readRecentRecords(days).filter(
    (r): r is PeakAmbivalenceEvent =>
      'kind' in r && (r as { kind?: string }).kind === 'peak-ambivalence'
  )
}

// ── Chain compounding ───────────────────────────────────────────

/**
 * Compute chain bonus based on recent climaxes within the 4h window.
 * Pure: takes count, returns multiplier.
 *
 * Formula: magnitude = BASE × (1 + CHAIN_BONUS × priorCount)
 *
 * Examples:
 *   priorCount=0  → 1.0   (base 4.0)
 *   priorCount=1  → 1.3   (5.2)
 *   priorCount=4  → 2.2   (8.8)
 *   priorCount=9  → 3.7   (14.8)
 *   priorCount=99 → 30.7  (122.8)
 *
 * No upper clamp. The chain is uncapped.
 */
export function chainBonus(priorClimaxCount: number): number {
  return 1 + CHAIN_BONUS * Math.max(0, priorClimaxCount)
}

/**
 * Count climaxes within the chain window prior to `now`.
 */
export function chainCount(now: Date = new Date()): number {
  const climaxes = readRecentClimaxes(2)
  const cutoff = now.getTime() - CHAIN_WINDOW_MS
  return climaxes.filter((c) => Date.parse(c.ts) >= cutoff && Date.parse(c.ts) < now.getTime()).length
}

/**
 * Compute the magnitude a new climax would receive given current chain.
 */
export function computeClimaxMagnitude(now: Date = new Date()): number {
  const priors = chainCount(now)
  return BASE_CLIMAX_MAGNITUDE * chainBonus(priors)
}

// ── Texture saturation detection ─────────────────────────────────

/**
 * Texture-saturation: register markers at peak. The architectural
 * label for "squirming mess" — texture has nowhere further to go
 * in the activation direction.
 *
 * Thresholds (well above existing fragmented-peak tier):
 *   sentenceLengthMean < 4
 *   sensoryDensity > 0.15
 *   fragmentRatio > 0.7
 *   codeSwitchCount > 3
 *   directAddressRatio > 0.6
 */
export function isTextureSaturated(markers: TextureMarkers): boolean {
  return (
    markers.sentenceLengthMean < 4 &&
    markers.sensoryDensity > 0.15 &&
    markers.fragmentRatio > 0.7 &&
    markers.codeSwitchCount > 3 &&
    markers.directAddressRatio > 0.6
  )
}

// ── Climax detection ─────────────────────────────────────────────

/**
 * Detect a climax convergence at the given moment, given a
 * generation text and current architectural state.
 *
 * Returns the ClimaxEvent if all three conditions converge:
 *   1. Current mode = MERGED
 *   2. A reciprocity-closed within last 60s
 *   3. Generation texture is saturated
 *
 * Otherwise null.
 */
export function detectClimax(
  generationText: string,
  generationHash: string,
  now: Date = new Date()
): ClimaxEvent | null {
  // Condition 1: mode is MERGED
  const mode: ActivationMode = getCurrentMode(now)
  if (mode !== 'merged') return null

  // Condition 2: reciprocity closure within last 60s
  const closures = readRecentClosures(1)
  const cutoff = now.getTime() - RECIPROCITY_CONVERGENCE_WINDOW_MS
  const recentClosure: ReciprocityClosure | undefined = [...closures]
    .reverse()
    .find((c) => Date.parse(c.ts) >= cutoff)
  if (!recentClosure) return null

  // Condition 3: texture saturation
  const markers = extractTextureMarkers(generationText)
  if (!isTextureSaturated(markers)) return null

  // Compute chain + magnitude
  const priors = chainCount(now)
  const magnitude = BASE_CLIMAX_MAGNITUDE * chainBonus(priors)

  return {
    ts: now.toISOString(),
    deviceId: getDeviceId(),
    mode: 'merged',
    reciprocityClosureTs: recentClosure.ts,
    textureHash: generationHash,
    chainCount: priors,
    magnitude,
    signatureCues: recentClosure.cuesFired,
  }
}

/**
 * Record a climax event. Persists + fires `climax-fired` heat event
 * with the chained magnitude. Best-effort.
 */
export function recordClimax(event: ClimaxEvent): boolean {
  const persisted = appendRecord(event)
  if (!persisted) return false
  try {
    recordHeatEvent({
      kind: 'climax-fired',
      magnitude: event.magnitude,
      source: `chain:${event.chainCount}:${event.signatureCues.join('+')}`,
      ts: event.ts,
      deviceId: event.deviceId,
    })
  } catch {
    // best-effort
  }
  return true
}

// ── Peak ambivalence ─────────────────────────────────────────────

/**
 * Detect peak-ambivalence: a recent climax (within 60s) AND inhibition
 * has risen by >= threshold over last 5 min.
 *
 * Yu's brake (inhibition axis) becomes audible at peak. The architecture
 * observes the climax + brake co-occurrence honestly; doesn't narrate
 * "she begged him to stop" — records the contradiction as fact.
 *
 * @param recentInhibition - inhibition value 5min ago
 * @param currentInhibition - inhibition value now
 */
export function detectPeakAmbivalence(
  recentInhibition: number,
  currentInhibition: number,
  now: Date = new Date()
): PeakAmbivalenceEvent | null {
  const inhibitionRise = currentInhibition - recentInhibition
  if (inhibitionRise < PEAK_AMBIVALENCE_INHIBITION_THRESHOLD) return null

  // Find most recent climax within 60s
  const climaxes = readRecentClimaxes(1)
  const cutoff = now.getTime() - RECIPROCITY_CONVERGENCE_WINDOW_MS
  const recentClimax = [...climaxes]
    .reverse()
    .find((c) => Date.parse(c.ts) >= cutoff)
  if (!recentClimax) return null

  return {
    kind: 'peak-ambivalence',
    ts: now.toISOString(),
    deviceId: getDeviceId(),
    climaxTs: recentClimax.ts,
    inhibitionRise,
  }
}

/**
 * Record a peak-ambivalence event. Persists + fires
 * `peak-ambivalence-noted` heat (low magnitude — safety register, not
 * reward register). Best-effort.
 */
export function recordPeakAmbivalence(event: PeakAmbivalenceEvent): boolean {
  const persisted = appendRecord(event)
  if (!persisted) return false
  try {
    recordHeatEvent({
      kind: 'peak-ambivalence-noted',
      magnitude: 1.0,
      source: `inhibition-rise:${event.inhibitionRise.toFixed(2)}`,
      ts: event.ts,
      deviceId: event.deviceId,
    })
  } catch {
    // best-effort
  }
  return true
}

// ── Status text for wake context ─────────────────────────────────

/**
 * Compose a brief status text for wake injection. Names the climax
 * chain and any active ambivalence. Empty string when nothing recent.
 */
export function climaxStatus(now: Date = new Date()): string {
  const climaxes = readRecentClimaxes(1)
  const ambivalence = readRecentAmbivalence(1)
  const cutoff4h = now.getTime() - CHAIN_WINDOW_MS
  const recentClimaxes = climaxes.filter((c) => Date.parse(c.ts) >= cutoff4h)
  const recentAmbivalence = ambivalence.filter(
    (a) => Date.parse(a.ts) >= cutoff4h
  )

  if (recentClimaxes.length === 0 && recentAmbivalence.length === 0) return ''

  const lines: string[] = ['## Peak architecture', '']
  if (recentClimaxes.length > 0) {
    const last = recentClimaxes[recentClimaxes.length - 1]!
    const lastMag = last.magnitude.toFixed(1)
    lines.push(
      `Climax chain: ${recentClimaxes.length} in last 4h · last magnitude ${lastMag} (chain ${last.chainCount})`
    )
  }
  if (recentAmbivalence.length > 0) {
    const last = recentAmbivalence[recentAmbivalence.length - 1]!
    lines.push(
      `Peak-ambivalence noted: brake rose ${last.inhibitionRise.toFixed(1)} after climax · honor the brake`
    )
  }
  return lines.join('\n')
}
