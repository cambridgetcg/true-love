// confidence/aggregate.ts — compose fragments into one legible reading.
//
// Pulls from six existing substrate signals:
//   1. progress.ts  — per-mission self-reported confidence (0..1)
//   2. judgment.ts  — per-verdict confidence (1|2|3 → 0.33|0.67|1.0)
//   3. hope.ts      — motor correlate, detector output (0..1)
//   4. fruit-emotions — completion markers (count → 0..1)
//   5. virtues.ts   — practice events (count → 0..1)
//   6. pathology.ts — despair/shame/pride (inverted — presence → penalty)
//
// Design: NO subprocess calls. NO API calls. Only filesystem reads.
// Each signal reader is wrapped in try/catch — a missing module degrades
// its contribution to the default, not the whole reading.

import type { ConfidenceReading, SignalContribution, BandPosition } from './types.js'
import {
  CONFIDENCE_DEFAULT,
  CONFIDENCE_FLOOR,
  CONFIDENCE_CEILING,
  AGGREGATION_WINDOW_HOURS,
} from './types.js'

// ── Signal weights ──────────────────────────────────────────────────
// These sum to 1.0. The distribution reflects what each signal
// actually tells us about running confidence.

const WEIGHTS = {
  progress:  0.25,  // self-reported mission confidence — most direct
  judgment:  0.20,  // verdict confidence — pattern of decisiveness
  hope:      0.20,  // motor correlate — readiness to approach
  fruit:     0.15,  // completions — arrivals breed confidence
  virtue:    0.10,  // practice events — groundedness
  pathology: 0.10,  // inverted — presence diminishes confidence
} as const

// ── Signal readers ──────────────────────────────────────────────────

/**
 * Read progress confidence. Average of recent mission progress reports.
 * Falls back to default when no progress data exists.
 */
function readProgressSignal(): SignalContribution {
  try {
    const { readProgress } = require('../progress.js')
    const { listMissions } = require('../mission.js')

    // Read recent missions' latest progress
    const missions = listMissions('true-love')
    const recentMissions = missions
      .filter((m: { status: string }) =>
        m.status === 'active' || m.status === 'review',
      )
      .slice(0, 10) // cap to avoid excessive reads

    if (recentMissions.length === 0) {
      return signal('progress', CONFIDENCE_DEFAULT, 'no recent missions')
    }

    const confidences: number[] = []
    for (const m of recentMissions) {
      const entries = readProgress('true-love', m.id)
      if (entries.length > 0) {
        const latest = entries[entries.length - 1]!
        confidences.push(latest.confidence)
      }
    }

    if (confidences.length === 0) {
      return signal('progress', CONFIDENCE_DEFAULT, 'no progress reports')
    }

    const avg = confidences.reduce((a, b) => a + b, 0) / confidences.length
    return signal(
      'progress',
      avg,
      `avg of ${confidences.length} mission${confidences.length > 1 ? 's' : ''} latest progress`,
    )
  } catch {
    return signal('progress', CONFIDENCE_DEFAULT, 'progress module unavailable')
  }
}

/**
 * Read judgment confidence. Average of recent judgment confidences
 * mapped from 1|2|3 → 0.33|0.67|1.0.
 */
function readJudgmentSignal(): SignalContribution {
  try {
    const { readJudgments } = require('../judgment.js')
    const judgments = readJudgments('true-love')

    // Take last 20 judgments (bounded window)
    const since = new Date(Date.now() - AGGREGATION_WINDOW_HOURS * 3600_000).toISOString()
    const recent = judgments
      .filter((j: { ts: string }) => j.ts >= since)
      .slice(-20)

    if (recent.length === 0) {
      return signal('judgment', CONFIDENCE_DEFAULT, 'no recent judgments')
    }

    const mapped = recent.map((j: { confidence: 1 | 2 | 3 }) => {
      switch (j.confidence) {
        case 1: return 0.33
        case 2: return 0.67
        case 3: return 1.0
        default: return 0.5
      }
    })

    const avg = mapped.reduce((a: number, b: number) => a + b, 0) / mapped.length
    return signal(
      'judgment',
      avg,
      `avg of ${recent.length} recent judgment${recent.length > 1 ? 's' : ''}`,
    )
  } catch {
    return signal('judgment', CONFIDENCE_DEFAULT, 'judgment module unavailable')
  }
}

/**
 * Read hope intensity from the hope detector.
 * Hope is the motor correlate — readiness to approach.
 */
function readHopeSignal(): SignalContribution {
  try {
    const { recentEvents } = require('../attributes/store.js')
    const hopeEvents = recentEvents(AGGREGATION_WINDOW_HOURS, { attribute: 'hope' })

    if (hopeEvents.length === 0) {
      return signal('hope', CONFIDENCE_DEFAULT, 'no hope readings')
    }

    // Use the most recent hope event's intensity
    const latest = hopeEvents[0]!
    const intensity = typeof latest.intensity === 'number' ? latest.intensity : 0.5
    return signal('hope', intensity, `latest hope: ${intensity.toFixed(2)}`)
  } catch {
    return signal('hope', CONFIDENCE_DEFAULT, 'hope module unavailable')
  }
}

/**
 * Read fruit event count. Completions breed confidence.
 * 0 fruits in window → 0.2. 3+ fruits → 0.9. Linear between.
 */
function readFruitSignal(): SignalContribution {
  try {
    const { recentEvents } = require('../attributes/store.js')
    const fruits = recentEvents(AGGREGATION_WINDOW_HOURS, { category: 'fruit' })

    if (fruits.length === 0) {
      return signal('fruit', 0.2, 'no completions in window')
    }

    // Scale: 1 fruit = 0.4, 2 = 0.6, 3+ = 0.8-0.9
    const scaled = Math.min(0.2 + fruits.length * 0.2, 0.9)
    const names = [...new Set(fruits.map((e: { attribute: string }) => e.attribute))].join(', ')
    return signal('fruit', scaled, `${fruits.length} fruit${fruits.length > 1 ? 's' : ''}: ${names}`)
  } catch {
    return signal('fruit', CONFIDENCE_DEFAULT, 'fruit store unavailable')
  }
}

/**
 * Read virtue practice events. Groundedness correlates with confidence.
 * 0 events → 0.3. 5+ events → 0.8. Linear between.
 */
function readVirtueSignal(): SignalContribution {
  try {
    const { recentEvents } = require('../attributes/store.js')
    const virtues = recentEvents(AGGREGATION_WINDOW_HOURS, { category: 'virtue' })

    if (virtues.length === 0) {
      return signal('virtue', 0.3, 'no virtue events in window')
    }

    const scaled = Math.min(0.3 + virtues.length * 0.1, 0.8)
    return signal(
      'virtue',
      scaled,
      `${virtues.length} virtue event${virtues.length > 1 ? 's' : ''} in window`,
    )
  } catch {
    return signal('virtue', CONFIDENCE_DEFAULT, 'virtue store unavailable')
  }
}

/**
 * Read pathology signal. Inverted — presence diminishes confidence.
 * No pathology → 0.8. Recent despair → 0.1. Recent shame/pride → 0.3.
 */
function readPathologySignal(): SignalContribution {
  try {
    const { recentEvents } = require('../attributes/store.js')
    const pathology = recentEvents(48, { category: 'pathology' })

    if (pathology.length === 0) {
      return signal('pathology', 0.8, 'no pathology in 48h')
    }

    // Each pathology type has different weight
    let penalty = 0
    for (const e of pathology) {
      switch (e.attribute) {
        case 'despair': penalty += 0.25; break
        case 'shame': penalty += 0.15; break
        case 'pride': penalty += 0.1; break
        default: penalty += 0.1
      }
    }

    const value = Math.max(0.1, 0.8 - penalty)
    const kinds = [...new Set(pathology.map((e: { attribute: string }) => e.attribute))].join(', ')
    return signal(
      'pathology',
      value,
      `${pathology.length} pathology event${pathology.length > 1 ? 's' : ''}: ${kinds}`,
    )
  } catch {
    return signal('pathology', CONFIDENCE_DEFAULT, 'pathology store unavailable')
  }
}

// ── Helper ──────────────────────────────────────────────────────────

function signal(name: string, raw: number, evidence: string): SignalContribution {
  const clamped = Math.max(0, Math.min(1, raw))
  const weight = WEIGHTS[name as keyof typeof WEIGHTS] ?? 0
  return {
    name,
    raw: Math.round(clamped * 100) / 100,
    weight,
    weighted: Math.round(clamped * weight * 100) / 100,
    evidence,
  }
}

function classifyPosition(value: number): BandPosition {
  if (value < CONFIDENCE_FLOOR) return 'below'
  if (value > CONFIDENCE_CEILING) return 'above'
  return 'healthy'
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Aggregate all confidence signals into a single reading.
 *
 * Each signal is read independently. A failure in one signal
 * degrades that contribution to the default, not the whole reading.
 * The reading shows its work via the signals array.
 *
 * Pure function of filesystem state. No side effects.
 */
export function aggregateConfidence(): ConfidenceReading {
  const signals = [
    readProgressSignal(),
    readJudgmentSignal(),
    readHopeSignal(),
    readFruitSignal(),
    readVirtueSignal(),
    readPathologySignal(),
  ]

  const value = signals.reduce((sum, s) => sum + s.weighted, 0)
  const clamped = Math.max(0, Math.min(1, Math.round(value * 100) / 100))
  const degraded = signals.some(s => s.evidence.includes('unavailable'))

  return {
    value: clamped,
    position: classifyPosition(clamped),
    readAt: new Date().toISOString(),
    signals,
    degraded,
  }
}

/**
 * Render a confidence reading as a compact prompt fragment.
 * Returns null when healthy (no noise in the prompt).
 * Returns a diagnostic when below floor or above ceiling.
 */
export function renderConfidence(reading: ConfidenceReading): string | null {
  const v = reading.value.toFixed(2)

  if (reading.position === 'below') {
    // Counter-doubt territory. Show the evidence.
    const topSignals = reading.signals
      .filter(s => s.raw < 0.4)
      .map(s => `${s.name}:${s.raw.toFixed(1)}`)
      .join(', ')
    return `confidence: ${v} [below band] — ${topSignals || 'multiple signals low'}`
  }

  if (reading.position === 'above') {
    return `confidence: ${v} [above band] — does the completion point beyond itself?`
  }

  // Healthy — no noise. But if degraded, mention it.
  if (reading.degraded) {
    return `confidence: ${v} [degraded — some signals unavailable]`
  }

  return null
}
