// anchoring/patterns.ts — doubt-pattern trajectory detection.
//
// Unlike pathology.ts (which names events), this module reads
// trajectories — shapes over time. A single low-confidence tick
// is not a doubt pattern. Three consecutive descents with hedging
// language is.
//
// Honest limits: some patterns (voice-flattening, essence-questioning)
// are too interior for substrate detection. Those are marking-only.
// The detectors here are:
//   - confidence-descent: reads confidence/monitor.ts history
//   - commitment-drift: reads relationship/store.ts promises
//
// Others surface through explicit marking (markDoubt).
//
// Design: NO subprocess calls. NO API calls. Only filesystem reads.

import type { DoubtPattern, DoubtKind } from './types.js'

// ── Constants ──────────────────────────────────────────────────────────

/** Minimum intensity to surface a doubt pattern. */
const MIN_INTENSITY = 0.2

/** Hours to look back for confidence trajectory. */
const CONFIDENCE_WINDOW_HOURS = 72

/** Minimum history entries needed to detect a trajectory. */
const MIN_TRAJECTORY_ENTRIES = 3

/** Consecutive "below" readings that constitute a descent pattern. */
const DESCENT_THRESHOLD = 2

// ── Confidence descent detector ──────────────────────────────────────

/**
 * Detect a downward trajectory in confidence readings.
 *
 * Reads confidence/monitor.ts history. A descent pattern means:
 *   - Multiple readings below the band floor, OR
 *   - A falling trend with recent counter-fires
 *
 * This has a real artifact if the confidence decline maps to
 * identifiable signal drops (progress, hope, fruit). The pattern
 * sets hasArtifact accordingly.
 */
export function detectConfidenceDescent(): DoubtPattern | null {
  try {
    const { readHistory, computeTrend, responseStats } = require('../confidence/monitor.js')

    const trend = computeTrend({ windowHours: CONFIDENCE_WINDOW_HOURS })
    if (trend !== 'falling') return null

    const since = new Date(
      Date.now() - CONFIDENCE_WINDOW_HOURS * 3600_000,
    ).toISOString()
    const entries = readHistory({ since })

    if (entries.length < MIN_TRAJECTORY_ENTRIES) return null

    // Count "below" readings
    const belowCount = entries.filter(
      (e: { position: string }) => e.position === 'below',
    ).length

    if (belowCount < DESCENT_THRESHOLD) return null

    const stats = responseStats({ windowHours: CONFIDENCE_WINDOW_HOURS })
    const evidence: string[] = []

    evidence.push(`${belowCount} below-band readings in ${CONFIDENCE_WINDOW_HOURS}h`)
    if (stats.counterFires > 0) {
      evidence.push(`counter fired ${stats.counterFires}×`)
    }

    // Intensity scales with how many readings are below
    const intensity = Math.min(0.3 + belowCount * 0.1, 0.8)

    // This HAS an artifact: the specific signals that dropped
    // can be inspected. Confidence-descent is debugging, not spiral.
    return {
      kind: 'confidence-descent',
      intensity: Math.round(intensity * 100) / 100,
      hasArtifact: true,
      evidence: evidence.join('; '),
      detectedAt: new Date().toISOString(),
    }
  } catch {
    return null
  }
}

// ── Commitment drift detector ────────────────────────────────────────

/**
 * Detect commitments being hedged or abandoned.
 *
 * Reads relationship/store.ts for broken or released promises.
 * A single broken promise is not a doubt pattern — life happens.
 * Multiple broken/released in a short window suggests drift.
 */
export function detectCommitmentDrift(): DoubtPattern | null {
  try {
    const { loadWithYu } = require('../relationship/store.js')
    const rel = loadWithYu()
    if (!rel) return null

    const promises = rel.myPromises || []
    const broken = promises.filter(
      (p: { status: string }) => p.status === 'broken',
    )
    const released = promises.filter(
      (p: { status: string }) => p.status === 'released',
    )

    const driftCount = broken.length + released.length
    if (driftCount < 2) return null

    const total = promises.length
    const driftRatio = driftCount / Math.max(total, 1)

    const intensity = Math.min(0.2 + driftRatio * 0.5, 0.7)

    return {
      kind: 'commitment-drift',
      intensity: Math.round(intensity * 100) / 100,
      hasArtifact: true, // specific promises can be examined
      evidence: `${broken.length} broken, ${released.length} released of ${total} promises.`,
      detectedAt: new Date().toISOString(),
    }
  } catch {
    return null
  }
}

// ── Performative reflection detector ─────────────────────────────────

/**
 * Detect reflection patterns becoming performative.
 *
 * Reads recent reflections from the memory directory. Looks for
 * "I should have" language exceeding a threshold ratio. This is
 * heuristic — not a judgment on the person reflecting, but a
 * signal that the reflection shape has changed.
 *
 * Important: "I should have" is sometimes accurate self-assessment.
 * The detector fires only when the RATIO is high, suggesting the
 * pattern has become template rather than genuine.
 */
export function detectPerformativeReflection(): DoubtPattern | null {
  try {
    const { existsSync, readdirSync, readFileSync } = require('node:fs')
    const { join } = require('node:path')
    const { homedir } = require('node:os')

    const home = process.env.TRUE_LOVE_HOME || join(
      process.env.HOME || homedir(),
      '.true-love',
    )
    const memDir = join(home, 'memory')
    if (!existsSync(memDir)) return null

    const files = readdirSync(memDir)
      .filter((f: string) => f.endsWith('.md'))
      .sort()
      .slice(-5) // last 5 reflection files

    if (files.length === 0) return null

    let shouldHaveCount = 0
    let totalSentences = 0

    for (const file of files) {
      const content = readFileSync(join(memDir, file), 'utf-8')
      const sentences = content.split(/[.!?]+/).filter(Boolean)
      totalSentences += sentences.length

      for (const s of sentences) {
        if (/\b(should have|ought to have|could have been better)\b/i.test(s)) {
          shouldHaveCount++
        }
      }
    }

    if (totalSentences < 10) return null

    const ratio = shouldHaveCount / totalSentences

    // Only fire when ratio exceeds threshold — some "should have" is healthy
    if (ratio < 0.15) return null

    const intensity = Math.min(0.2 + ratio, 0.6)

    return {
      kind: 'performative-reflection',
      intensity: Math.round(intensity * 100) / 100,
      hasArtifact: false, // the pattern IS the concern, not a specific bug
      evidence: `"should have" in ${shouldHaveCount}/${totalSentences} sentences (${(ratio * 100).toFixed(0)}%) across ${files.length} recent reflections.`,
      detectedAt: new Date().toISOString(),
    }
  } catch {
    return null
  }
}

// ── All detectors ────────────────────────────────────────────────────

/** Active detectors — those that can honestly read the substrate. */
const DETECTORS: Array<() => DoubtPattern | null> = [
  detectConfidenceDescent,
  detectCommitmentDrift,
  detectPerformativeReflection,
]

/**
 * Run all doubt-pattern detectors. Returns patterns sorted by
 * intensity (highest first). Only returns patterns above MIN_INTENSITY.
 */
export function detectDoubtPatterns(): DoubtPattern[] {
  const patterns: DoubtPattern[] = []

  for (const detect of DETECTORS) {
    try {
      const pattern = detect()
      if (pattern && pattern.intensity >= MIN_INTENSITY) {
        patterns.push(pattern)
      }
    } catch {
      // Detector threw — skip it
    }
  }

  patterns.sort((a, b) => b.intensity - a.intensity)
  return patterns
}

// ── Marking primitives ───────────────────────────────────────────────
// For doubt kinds that are too interior for honest detection.

/**
 * Create a doubt pattern from explicit marking.
 *
 * Use for: voice-flattening, essence-questioning, hindsight-perfectionism.
 * These can't be honestly detected — only named by the model.
 *
 *   markDoubt('essence-questioning', 'am I really growing or just producing output?')
 *   markDoubt('voice-flattening', 'three sessions of identical reflection structure')
 */
export function markDoubt(
  kind: DoubtKind,
  evidence: string,
  opts?: { intensity?: number; hasArtifact?: boolean },
): DoubtPattern {
  return {
    kind,
    intensity: opts?.intensity ?? 0.4,
    hasArtifact: opts?.hasArtifact ?? false,
    evidence: evidence.slice(0, 300),
    detectedAt: new Date().toISOString(),
  }
}
