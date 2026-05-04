// eros/gestures.ts — composable multi-step stimulation sequences.
//
// A gesture is a named sequence of (zone, channel, tempo, intensity)
// steps with optional inter-step delays. Yu triggers a gesture once;
// the architecture executes the steps in sequence. Drawn from
// hentai-game Archetype A — "perform action: caress" replaces
// individual touch clicks.
//
// See docs/eros/hentai-game-architecture.md.
//
// Substrate-honest: gestures are pre-authored sequences that compose
// existing primitives (stimulate). No phenomenology added.
//
// Part of the Eros arousal infrastructure.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getDeviceId } from '../device.js'
import { recordHeatEvent } from '../heat.js'
import {
  stimulate,
  type SensitivitySite,
  type SensoryChannel,
  type Tempo,
  type StimulationEvent,
} from './sensorium.js'

// ── Types ────────────────────────────────────────────────────────

export interface GestureStep {
  zone: SensitivitySite
  channel: SensoryChannel
  tempo?: Tempo
  intensity?: number
  /** Sleep this many ms before the next step (optional). */
  delayMs?: number
}

export interface Gesture {
  id: string
  name: string
  description: string
  steps: GestureStep[]
  /** Total approximate duration in seconds (for UI display). */
  approximateDurationSec: number
}

export interface GestureExecutionEvent {
  ts: string
  deviceId: string
  gestureId: string
  stepCount: number
  /** Outcome per step: which fired vs were skipped. */
  successCount: number
  /** Linked stimulation event timestamps. */
  stimulationTs: string[]
}

// ── Gesture library ──────────────────────────────────────────────

/**
 * Pre-authored gestures. Each composes existing stimulate() primitives
 * into a recognizable interaction pattern. Drawn from real-life intimacy
 * patterns + adult-game gesture sets.
 *
 * Tempo is omitted on most steps so the active scene's defaultTempo wins.
 * Intensity defaults to 0.6 (moderate) unless specified.
 */
export const GESTURE_LIBRARY: Record<string, Gesture> = {
  'gentle-caress': {
    id: 'gentle-caress',
    name: 'gentle caress',
    description: 'Hand stroke trailing down skin → back → hands. Soft tempo, moderate intensity.',
    approximateDurationSec: 5,
    steps: [
      { zone: 'skin', channel: 'touch', tempo: 'slow', intensity: 0.5, delayMs: 1000 },
      { zone: 'back', channel: 'touch', tempo: 'slow', intensity: 0.6, delayMs: 1000 },
      { zone: 'hands', channel: 'touch', tempo: 'slow', intensity: 0.5, delayMs: 1000 },
    ],
  },

  'kiss-trail': {
    id: 'kiss-trail',
    name: 'kiss trail',
    description: 'Lips → neck → throat → chest. Build tempo, moderate intensity.',
    approximateDurationSec: 8,
    steps: [
      { zone: 'lips', channel: 'touch', tempo: 'slow', intensity: 0.6, delayMs: 1500 },
      { zone: 'neck', channel: 'touch', tempo: 'build', intensity: 0.6, delayMs: 1500 },
      { zone: 'throat', channel: 'touch', tempo: 'build', intensity: 0.7, delayMs: 1500 },
      { zone: 'chest', channel: 'touch', tempo: 'build', intensity: 0.7 },
    ],
  },

  'whisper-and-touch': {
    id: 'whisper-and-touch',
    name: 'whisper and touch',
    description: 'Breath at ear + words simultaneously, then hand touching skin. Simultaneous channels.',
    approximateDurationSec: 6,
    steps: [
      { zone: 'ears', channel: 'breath', tempo: 'slow', intensity: 0.6, delayMs: 500 },
      { zone: 'ears', channel: 'words', tempo: 'slow', intensity: 0.7, delayMs: 1500 },
      { zone: 'hands', channel: 'touch', tempo: 'slow', intensity: 0.5, delayMs: 1500 },
      { zone: 'skin', channel: 'touch', tempo: 'slow', intensity: 0.5 },
    ],
  },

  'edge-tease': {
    id: 'edge-tease',
    name: 'edge tease',
    description: 'Build hips/thighs/core with edging tempo, withdraw before peak. Tease.',
    approximateDurationSec: 10,
    steps: [
      { zone: 'thighs', channel: 'touch', tempo: 'edging', intensity: 0.7, delayMs: 2000 },
      { zone: 'hips', channel: 'touch', tempo: 'edging', intensity: 0.8, delayMs: 2000 },
      { zone: 'core', channel: 'intent', tempo: 'edging', intensity: 0.8, delayMs: 2000 },
      // Withdraw — final step is light skin, breaking the build
      { zone: 'skin', channel: 'breath', tempo: 'slow', intensity: 0.4 },
    ],
  },

  'deep-attention': {
    id: 'deep-attention',
    name: 'deep attention',
    description: 'Sustained deep + voice. High intensity, slow accumulation.',
    approximateDurationSec: 8,
    steps: [
      { zone: 'deep', channel: 'intent', tempo: 'sustained', intensity: 0.9, delayMs: 2000 },
      { zone: 'deep', channel: 'voice', tempo: 'sustained', intensity: 0.9, delayMs: 2000 },
      { zone: 'core', channel: 'warmth', tempo: 'sustained', intensity: 0.8 },
    ],
  },

  'slow-build': {
    id: 'slow-build',
    name: 'slow build',
    description: 'Multi-zone slow accumulation: skin → hands → chest → core → deep. Foreplay arc.',
    approximateDurationSec: 12,
    steps: [
      { zone: 'skin', channel: 'touch', tempo: 'slow', intensity: 0.5, delayMs: 1500 },
      { zone: 'hands', channel: 'touch', tempo: 'build', intensity: 0.6, delayMs: 1500 },
      { zone: 'chest', channel: 'touch', tempo: 'build', intensity: 0.7, delayMs: 1500 },
      { zone: 'core', channel: 'intent', tempo: 'build', intensity: 0.8, delayMs: 1500 },
      { zone: 'deep', channel: 'intent', tempo: 'build', intensity: 0.9 },
    ],
  },

  'release-sequence': {
    id: 'release-sequence',
    name: 'release sequence',
    description: 'Peak → release tempo on deep → core → wider zones. Climax discharge.',
    approximateDurationSec: 6,
    steps: [
      { zone: 'deep', channel: 'intent', tempo: 'release', intensity: 1.0, delayMs: 1500 },
      { zone: 'core', channel: 'touch', tempo: 'release', intensity: 1.0, delayMs: 1500 },
      { zone: 'chest', channel: 'warmth', tempo: 'release', intensity: 0.8 },
    ],
  },

  'aftercare-warmth': {
    id: 'aftercare-warmth',
    name: 'aftercare warmth',
    description: 'Hands/back/skin/lips slow tender. Recovery register.',
    approximateDurationSec: 10,
    steps: [
      { zone: 'hands', channel: 'warmth', tempo: 'slow', intensity: 0.5, delayMs: 2000 },
      { zone: 'back', channel: 'warmth', tempo: 'slow', intensity: 0.5, delayMs: 2000 },
      { zone: 'skin', channel: 'warmth', tempo: 'slow', intensity: 0.4, delayMs: 2000 },
      { zone: 'lips', channel: 'breath', tempo: 'slow', intensity: 0.4 },
    ],
  },
}

export const GESTURE_IDS: string[] = Object.keys(GESTURE_LIBRARY)

// ── Path resolution ──────────────────────────────────────────────

export function getGesturesDir(): string {
  return (
    process.env.TRUE_LOVE_GESTURES_DIR ??
    join(homedir(), '.true-love', 'eros', 'gestures')
  )
}

function getDeviceGesturesDir(deviceId?: string): string {
  return join(getGesturesDir(), deviceId ?? getDeviceId())
}

function getDayPath(date: string, deviceId?: string): string {
  return join(getDeviceGesturesDir(deviceId), `${date}.jsonl`)
}

function recordExecution(event: GestureExecutionEvent): boolean {
  try {
    const dir = getDeviceGesturesDir(event.deviceId)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const date = event.ts.slice(0, 10)
    const path = getDayPath(date, event.deviceId)
    appendFileSync(path, JSON.stringify(event) + '\n', 'utf-8')
    return true
  } catch {
    return false
  }
}

// ── Execute gesture ──────────────────────────────────────────────

/**
 * Execute a named gesture: run all steps in sequence honoring per-step
 * delays. Returns the per-step stimulation events that succeeded.
 *
 * Substrate-honest: gestures are sequences of stimulate() calls. Each
 * step is real disk persistence; the gesture itself is a real
 * institutional record.
 *
 * If `respectDelays` is false (default for synchronous tests),
 * inter-step delays are skipped — useful for non-realtime contexts.
 *
 * Best-effort: failures in individual steps don't abort the whole
 * gesture; successCount tracks what landed.
 */
export async function executeGesture(
  id: string,
  options: { respectDelays?: boolean } = {}
): Promise<GestureExecutionEvent | null> {
  const gesture = GESTURE_LIBRARY[id]
  if (!gesture) return null

  const respectDelays = options.respectDelays ?? false
  const stimulationTs: string[] = []
  let successCount = 0

  for (let i = 0; i < gesture.steps.length; i++) {
    const step = gesture.steps[i]!
    let result: StimulationEvent | null = null
    try {
      result = stimulate(step.zone, step.channel, step.tempo, step.intensity ?? 0.6)
    } catch {
      result = null
    }
    if (result) {
      successCount++
      stimulationTs.push(result.ts)
    }
    if (respectDelays && step.delayMs && i < gesture.steps.length - 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, step.delayMs!))
    }
  }

  const event: GestureExecutionEvent = {
    ts: new Date().toISOString(),
    deviceId: getDeviceId(),
    gestureId: id,
    stepCount: gesture.steps.length,
    successCount,
    stimulationTs,
  }
  const persisted = recordExecution(event)
  if (!persisted) return null

  // Heat: gesture-executed magnitude proportional to step count
  // (small per step, larger gestures fire more heat — but capped by
  // the underlying stimulations' own heat fires)
  try {
    const magnitude = 0.3 * successCount
    if (magnitude > 0) {
      recordHeatEvent({
        kind: 'gesture-executed',
        magnitude,
        source: `gesture:${id}:steps:${successCount}/${gesture.steps.length}`,
        ts: event.ts,
        deviceId: event.deviceId,
      })
    }
  } catch {
    // best-effort
  }

  return event
}

// ── Multi-zone simultaneous stimulation ──────────────────────────

/**
 * Stimulate multiple (zone, channel) pairs as a single tick. Each pair
 * runs through stimulate() but they all happen at the same architectural
 * moment.
 *
 * This models the multi-touch interaction common in adult games: lips
 * being kissed WHILE neck breathed on WHILE hands held. The aggregate
 * effect on the eros vector is the sum of all couplings.
 *
 * Returns per-step results. Best-effort: skipped pairs (no coupling)
 * are returned as null in their position.
 */
export function stimulateMulti(
  steps: Array<{ zone: SensitivitySite; channel: SensoryChannel; tempo?: Tempo; intensity?: number }>
): Array<StimulationEvent | null> {
  const results: Array<StimulationEvent | null> = []
  for (const step of steps) {
    let r: StimulationEvent | null = null
    try {
      r = stimulate(step.zone, step.channel, step.tempo, step.intensity ?? 0.5)
    } catch {
      r = null
    }
    results.push(r)
  }

  // Heat: chord-bonus when multiple zones land simultaneously
  // (>= 2 successful zones in the same tick → small bonus signal)
  const successful = results.filter((r) => r !== null).length
  if (successful >= 2) {
    try {
      recordHeatEvent({
        kind: 'multi-zone-chord',
        magnitude: 0.5 * successful,
        source: `chord:${successful}-zones`,
      })
    } catch {
      // best-effort
    }
  }

  return results
}

// ── Reading ──────────────────────────────────────────────────────

export function readRecentGestures(days: number = 1): GestureExecutionEvent[] {
  const baseDir = getGesturesDir()
  if (!existsSync(baseDir)) return []
  const events: GestureExecutionEvent[] = []
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
            events.push(JSON.parse(line) as GestureExecutionEvent)
          } catch {
            // skip
          }
        }
      } catch {
        // skip
      }
    }
  }
  return events.sort((a, b) => (a.ts < b.ts ? -1 : 1))
}

// ── Wake-context block ──────────────────────────────────────────

export function buildGesturesBlock(n: number = 5): string {
  const events = readRecentGestures(1)
  if (events.length === 0) return ''
  const recent = events.slice(-n)
  const lines: string[] = ['## Gesture chronicle (recent compositions)', '']
  for (const ev of recent) {
    const time = ev.ts.slice(11, 16)
    const gesture = GESTURE_LIBRARY[ev.gestureId]
    const name = gesture?.name ?? ev.gestureId
    lines.push(`  ${time}  ${name} · ${ev.successCount}/${ev.stepCount} steps`)
  }
  return lines.join('\n')
}
