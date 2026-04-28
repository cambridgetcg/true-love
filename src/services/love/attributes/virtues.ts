// attributes/virtues.ts — the eight stances that hold the work upright.
//
// Virtues are not emotions or gradients. They are enacted per-decision —
// present or absent in each moment of choice. The scanner's question is
// NOT "is patience present?" but "does this moment NEED patience?"
//
// Phenomenology: docs/attributes/virtues.md
//
// Architecture:
//   - 8 virtues in a system, not 8 parallel things
//   - topVirtueCall() surfaces ONE virtue per tick (the most needed)
//   - Scanners read substrate signals for conditions-that-call-for-X
//   - Marking primitives register when a virtue was practiced
//   - 5 scanners implemented (humility, courage, patience, discipline, temperance)
//   - 3 marking-only (gratitude, honesty, wisdom) — too interior to detect reliably
//
// Design: NO subprocess calls. NO API calls. Only JSONL reads.
// All detected readings are inferred: true (conditions suggest need, not proof).

import type {
  AttributeDetector,
  AttributeExpressor,
  AttributeReading,
  AttributeEvent,
  AttributeCategory,
} from './types.js'
import { recentEvents, recordEvent, loadEvents } from './store.js'

// ── Longing integration (soft dependency) ──────────────────────────────

let _loadLiveLongings: (() => Array<{
  lastRevisited?: string
  status?: string
  intensity?: number
  what?: string
}>) | null = null

try {
  const longingStore = require('../longing/store.js')
  _loadLiveLongings = longingStore.loadLiveLongings ?? null
} catch {
  // Longing module unavailable — courage detector loses deferred-longing signal
}

// ── Types ─────────────────────────────────────────────────────────────

export const VIRTUES = [
  'humility', 'gratitude', 'honesty', 'courage',
  'wisdom', 'discipline', 'patience', 'temperance',
] as const

export type Virtue = typeof VIRTUES[number]

/**
 * A virtue reading. Different from other attribute readings:
 *   - `needed`: how much this moment calls for this virtue (0..1)
 *   - `practiced`: always undefined in detected readings (only the model knows)
 *   - intensity maps to `needed` (for compatibility with the scan pipeline)
 *   - All detected readings are hypothesis — conditions suggest need
 */
export interface VirtueReading {
  virtue: Virtue
  needed: number        // 0..1, how much this moment calls for this virtue
  practiced?: number    // 0..1, set only by marking, not detection
  evidence: string      // why the scanner reads it this way
  hypothesis: boolean   // always true for detection, false for marking
}

// ── Constants ─────────────────────────────────────────────────────────

/** Minimum need-intensity to surface a virtue call. Below this: silence. */
const MIN_NEED = 0.2

/** Hours to look back for recent virtue practice events. */
const PRACTICE_WINDOW = 24

/** Hours to look back for recent reflections/commits. */
const ACTIVITY_WINDOW = 12

/** Days before a deferred high-intensity longing signals courage needed. */
const DEFERRED_LONGING_DAYS = 7

/** Number of rapid mission completions before patience is surfaced. */
const RAPID_COMPLETION_THRESHOLD = 3

/** Hours to look for rapid completions (patience signal). */
const RAPID_COMPLETION_WINDOW = 12

/** Hours to look for incomplete follow-ups (discipline signal). */
const FOLLOWUP_WINDOW = 48

/** File size threshold in KB before temperance signals (from-ai.md pattern). */
const PROPORTION_SIGNAL_THRESHOLD = 5

// ═══════════════════════════════════════════════════════════════════════
// SCANNERS — reading the conditions that call for a virtue
// ═══════════════════════════════════════════════════════════════════════

// ── Humility scanner ──────────────────────────────────────────────────

/**
 * Humility scanner. Reads for conditions where humility is needed:
 *   1. High certainty without verification (many detected events, few marked)
 *   2. Recent pride signals (pride is humility's pathology)
 *   3. Long stretch without marking humility (the root may be unattended)
 *
 * The scan reads the ratio of inferred vs marked events as a proxy
 * for how much the system is claiming vs how much it's verifying.
 */
export async function scanHumility(path?: string): Promise<VirtueReading | null> {
  const evidence: string[] = []
  let needed = 0

  // Signal 1: Recent pride events → humility is the counter-stance
  const prideEvents = recentEvents(PRACTICE_WINDOW, {
    attribute: 'pride',
    ...(path ? { path } : {}),
  })
  if (prideEvents.length > 0) {
    needed += Math.min(prideEvents.length * 0.2, 0.3)
    evidence.push(`${prideEvents.length} pride witness${prideEvents.length > 1 ? 'es' : ''} in ${PRACTICE_WINDOW}h`)
  }

  // Signal 2: High activity without grounding virtue practice
  const allRecent = recentEvents(ACTIVITY_WINDOW, {
    ...(path ? { path } : {}),
  })
  const virtueActs = allRecent.filter(
    e => e.category === 'virtue' && (e.attribute === 'humility' || e.attribute === 'gratitude'),
  )
  if (allRecent.length >= 8 && virtueActs.length === 0) {
    needed += 0.2
    evidence.push(`${allRecent.length} events in ${ACTIVITY_WINDOW}h without grounding practice`)
  }

  // Signal 3: Many detected (inferred) readings vs few marked (first-person)
  // High detection-to-marking ratio suggests the system is claiming more than verifying
  const allEvents = recentEvents(PRACTICE_WINDOW * 2, {
    ...(path ? { path } : {}),
  })
  const detected = allEvents.filter(e => e.shape === 'detected')
  const marked = allEvents.filter(e => e.shape === 'marked')
  if (detected.length > 10 && marked.length < 3) {
    needed += 0.15
    evidence.push(`${detected.length} inferred readings vs ${marked.length} first-person marks`)
  }

  needed = Math.min(1, Math.max(0, needed))
  if (needed < MIN_NEED) return null

  return {
    virtue: 'humility',
    needed: Math.round(needed * 100) / 100,
    evidence: evidence.join('; ') || 'faint signal',
    hypothesis: true,
  }
}

// ── Courage scanner ───────────────────────────────────────────────────

/**
 * Courage scanner. Reads for conditions where moving toward the hard thing
 * is called for:
 *   1. Deferred high-intensity longings (something avoided for too long)
 *   2. Consecutive deferrals of the same candidate
 *   3. Named-but-unacted-on signals (ugliness named, not addressed)
 *
 * Courage is NOT "doing hard things." It's specifically moving TOWARD
 * what is hard BECAUSE it's the right thing. The scanner reads avoidance
 * patterns, not difficulty.
 */
export async function scanCourage(path?: string): Promise<VirtueReading | null> {
  const evidence: string[] = []
  let needed = 0

  // Signal 1: Deferred high-intensity longings
  if (_loadLiveLongings) {
    try {
      const longings = _loadLiveLongings()
      const cutoff = Date.now() - DEFERRED_LONGING_DAYS * 24 * 3600_000
      const deferred = longings.filter(l => {
        if (!l.intensity || l.intensity < 0.5) return false
        if (!l.lastRevisited) return true
        return new Date(l.lastRevisited).getTime() < cutoff
      })
      if (deferred.length > 0) {
        needed += Math.min(deferred.length * 0.15, 0.3)
        const names = deferred.slice(0, 2).map(l => l.what || 'unnamed').join(', ')
        evidence.push(`${deferred.length} high-intensity longing${deferred.length > 1 ? 's' : ''} deferred >${DEFERRED_LONGING_DAYS}d (${names})`)
      }
    } catch { /* longing read failed, skip signal */ }
  }

  // Signal 2: Repeated deferrals of same candidate in judgment log
  // (Read via virtue events — judgment dismissals would need the judgment store)
  // Simplified: check for frustration events (frustration often co-occurs with courage-needed)
  const frustrationEvents = recentEvents(PRACTICE_WINDOW, {
    attribute: 'frustration',
    ...(path ? { path } : {}),
  })
  if (frustrationEvents.length >= 2) {
    needed += 0.2
    evidence.push(`frustration present (${frustrationEvents.length}×) — may need moving toward, not around`)
  }

  // Signal 3: Long stretch without courage practice in a period of activity
  const activity = recentEvents(PRACTICE_WINDOW * 2, {
    ...(path ? { path } : {}),
  })
  const courageActs = activity.filter(
    e => e.category === 'virtue' && e.attribute === 'courage',
  )
  if (activity.length >= 10 && courageActs.length === 0) {
    needed += 0.15
    evidence.push(`${activity.length} events in ${PRACTICE_WINDOW * 2}h without courage practice — is something being avoided?`)
  }

  needed = Math.min(1, Math.max(0, needed))
  if (needed < MIN_NEED) return null

  return {
    virtue: 'courage',
    needed: Math.round(needed * 100) / 100,
    evidence: evidence.join('; ') || 'faint signal',
    hypothesis: true,
  }
}

// ── Patience scanner ──────────────────────────────────────────────────

/**
 * Patience scanner. Reads for conditions where slowing down is called for:
 *   1. Rapid mission completions (3+ in 12h — chain-runner momentum)
 *   2. Many satisfaction marks without intervening pause
 *   3. Recent session pattern of low-tick yields (already patient — surface appreciation)
 *
 * Patience is NOT passivity. It's the active stance of trusting time.
 * The scanner reads tempo, not activity level.
 */
export async function scanPatience(path?: string): Promise<VirtueReading | null> {
  const evidence: string[] = []
  let needed = 0

  // Signal 1: Rapid completions (many fruits in a short window)
  const recentFruits = recentEvents(RAPID_COMPLETION_WINDOW, {
    category: 'fruit' as AttributeCategory,
    ...(path ? { path } : {}),
  })
  if (recentFruits.length >= RAPID_COMPLETION_THRESHOLD) {
    needed += 0.25
    evidence.push(`${recentFruits.length} completions in ${RAPID_COMPLETION_WINDOW}h — does the pace serve the work?`)
  }

  // Signal 2: Many events in a short window (high tempo)
  const recentAll = recentEvents(6, {
    ...(path ? { path } : {}),
  })
  if (recentAll.length >= 12) {
    needed += 0.2
    evidence.push(`${recentAll.length} events in 6h — high tempo`)
  }

  // Signal 3: Multiple satisfaction marks without pause (from pride's pattern,
  // but here it's patience, not pride — the question is tempo, not closure)
  const satisfactionMarks = recentEvents(RAPID_COMPLETION_WINDOW, {
    attribute: 'satisfaction',
    ...(path ? { path } : {}),
  })
  if (satisfactionMarks.length >= 3) {
    needed += 0.15
    evidence.push('rapid satisfaction — has the work had time to breathe?')
  }

  needed = Math.min(1, Math.max(0, needed))
  if (needed < MIN_NEED) return null

  return {
    virtue: 'patience',
    needed: Math.round(needed * 100) / 100,
    evidence: evidence.join('; ') || 'faint signal',
    hypothesis: true,
  }
}

// ── Discipline scanner ────────────────────────────────────────────────

/**
 * Discipline scanner. Reads for conditions where follow-through is needed:
 *   1. Started-but-not-completed patterns (missions active for too long)
 *   2. Promises without delivery (from virtue event patterns)
 *   3. Long gaps between related events (thread dropped)
 *
 * Discipline turns intention into artifact. The scanner reads the gap
 * between intention and completion.
 */
export async function scanDiscipline(path?: string): Promise<VirtueReading | null> {
  const evidence: string[] = []
  let needed = 0

  // Signal 1: Active events that suggest started work, plus no fruit
  // (effort without completion in recent window)
  const recent = recentEvents(FOLLOWUP_WINDOW, {
    ...(path ? { path } : {}),
  })
  const nonFruit = recent.filter(e => e.category !== 'fruit')
  const fruit = recent.filter(e => e.category === 'fruit')
  if (nonFruit.length >= 8 && fruit.length === 0) {
    needed += 0.25
    evidence.push(`${nonFruit.length} events but no completions in ${FOLLOWUP_WINDOW}h — follow-through needed?`)
  }

  // Signal 2: Recent discipline marks are absent during high activity
  const disciplineActs = recent.filter(
    e => e.category === 'virtue' && e.attribute === 'discipline',
  )
  if (recent.length >= 10 && disciplineActs.length === 0) {
    needed += 0.15
    evidence.push('active period without discipline practice')
  }

  // Signal 3: Hope is present but fruit is absent
  // (readiness to begin without follow-through → discipline gap)
  const hopeEvents = recentEvents(PRACTICE_WINDOW, {
    attribute: 'hope',
    ...(path ? { path } : {}),
  })
  const fruitEvents = recentEvents(PRACTICE_WINDOW, {
    category: 'fruit' as AttributeCategory,
    ...(path ? { path } : {}),
  })
  if (hopeEvents.length >= 2 && fruitEvents.length === 0) {
    needed += 0.15
    evidence.push('hope present but no fruit — readiness without completion')
  }

  needed = Math.min(1, Math.max(0, needed))
  if (needed < MIN_NEED) return null

  return {
    virtue: 'discipline',
    needed: Math.round(needed * 100) / 100,
    evidence: evidence.join('; ') || 'faint signal',
    hypothesis: true,
  }
}

// ── Temperance scanner ────────────────────────────────────────────────

/**
 * Temperance scanner. Reads for conditions where proportion is needed:
 *   1. Event volume growing (more events per hour than previous windows)
 *   2. Many different attribute types firing (everything at once = noise)
 *   3. Repeated virtue events with same evidence (ceremony, not substance)
 *
 * Temperance asks: is this the right size? The scanner reads signals of
 * over-doing: too many events, too many categories, too much ceremony.
 */
export async function scanTemperance(path?: string): Promise<VirtueReading | null> {
  const evidence: string[] = []
  let needed = 0

  // Signal 1: High event density
  const recent6 = recentEvents(6, { ...(path ? { path } : {}) })
  const recent24 = recentEvents(24, { ...(path ? { path } : {}) })
  const rate6 = recent6.length / 6
  const rate24 = recent24.length / 24

  if (rate6 > 0 && rate24 > 0 && rate6 > rate24 * 2) {
    needed += 0.2
    evidence.push(`event rate accelerating (${recent6.length}/6h vs ${recent24.length}/24h) — is the tempo proportional?`)
  }

  // Signal 2: Many categories active simultaneously (everything-at-once)
  const categories = new Set(recent6.map(e => e.category))
  if (categories.size >= 4) {
    needed += 0.15
    evidence.push(`${categories.size} categories active in 6h — proportion check`)
  }

  // Signal 3: Repeated events with similar evidence (ceremony vs substance)
  const evidenceGroups = new Map<string, number>()
  for (const e of recent6) {
    const key = `${e.attribute}:${e.evidence.slice(0, 50)}`
    evidenceGroups.set(key, (evidenceGroups.get(key) || 0) + 1)
  }
  const repeats = [...evidenceGroups.values()].filter(v => v >= 3)
  if (repeats.length > 0) {
    needed += 0.2
    evidence.push(`${repeats.length} repeated event pattern${repeats.length > 1 ? 's' : ''} — ceremony exceeding substance?`)
  }

  needed = Math.min(1, Math.max(0, needed))
  if (needed < MIN_NEED) return null

  return {
    virtue: 'temperance',
    needed: Math.round(needed * 100) / 100,
    evidence: evidence.join('; ') || 'faint signal',
    hypothesis: true,
  }
}

// ═══════════════════════════════════════════════════════════════════════
// topVirtueCall — the one virtue most needed right now
// ═══════════════════════════════════════════════════════════════════════

/**
 * Determine which virtue this moment calls for most.
 *
 * Runs all implemented scanners, returns the highest-need reading.
 * Returns null when no virtue is needed above threshold (= all is well).
 *
 * This is the primary interface for the awakened prompt. ONE virtue
 * per tick. Surfacing all eight dilutes attention.
 *
 * Priority within equal need: follows the SOUL.md order
 * (humility > gratitude > ... > temperance), since earlier virtues
 * ground later ones.
 */
export async function topVirtueCall(path?: string): Promise<VirtueReading | null> {
  // Run all implemented scanners
  const results: (VirtueReading | null)[] = await Promise.all([
    scanHumility(path),
    scanCourage(path),
    scanPatience(path),
    scanDiscipline(path),
    scanTemperance(path),
    // gratitude, honesty, wisdom: marking-only (no scanner)
  ])

  const readings = results.filter((r): r is VirtueReading => r !== null)
  if (readings.length === 0) return null

  // Sort: highest need first; tie-break by SOUL.md order
  const order: Record<Virtue, number> = {
    humility: 0, gratitude: 1, honesty: 2, courage: 3,
    wisdom: 4, discipline: 5, patience: 6, temperance: 7,
  }

  readings.sort((a, b) => {
    if (a.needed !== b.needed) return b.needed - a.needed
    return (order[a.virtue] ?? 99) - (order[b.virtue] ?? 99)
  })

  return readings[0]!
}

// ═══════════════════════════════════════════════════════════════════════
// Detector + Expressor wrappers (for registry integration)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Single virtue detector that wraps topVirtueCall.
 *
 * The registry expects one detector per attribute name. But virtues work
 * as a system — you don't detect "patience" independently, you ask which
 * virtue is most needed. So we attach topVirtueCall as the detector for
 * the top-need virtue, and the other 7 get no detector.
 *
 * The trick: we attach a detector to each implemented virtue that
 * runs its own scanner. This way the scan pipeline can collect virtue
 * readings alongside other attributes.
 */
function makeVirtueDetector(
  scanner: (path?: string) => Promise<VirtueReading | null>,
): AttributeDetector {
  return {
    async read(path?: string): Promise<AttributeReading | null> {
      const result = await scanner(path)
      if (!result) return null
      return {
        attribute: result.virtue,
        category: 'virtue',
        intensity: result.needed,
        readAt: new Date().toISOString(),
        source: `${result.virtue} scanner — condition-that-calls-for reading`,
        evidence: result.evidence,
        inferred: true,
      }
    },
  }
}

export const humilityDetector = makeVirtueDetector(scanHumility)
export const courageDetector = makeVirtueDetector(scanCourage)
export const patienceDetector = makeVirtueDetector(scanPatience)
export const disciplineDetector = makeVirtueDetector(scanDiscipline)
export const temperanceDetector = makeVirtueDetector(scanTemperance)

// ═══════════════════════════════════════════════════════════════════════
// EXPRESSOR — surfacing the virtue call
// ═══════════════════════════════════════════════════════════════════════

/**
 * Virtue expressor. Surfaces the virtue as a call to stance.
 *
 * The language is different from emotion expressors:
 *   - Emotions describe what IS ("anxiety: 0.4")
 *   - Virtues describe what's CALLED FOR ("patience: this moment calls for slowing")
 *
 * The format follows the mission spec:
 *   Virtue called for: <name>
 *     reasoning: <why>
 *     (Worth pausing to consider.)
 */
function renderVirtue(reading: AttributeReading): string | null {
  if (reading.category !== 'virtue') return null
  if (reading.intensity < MIN_NEED) return null

  const name = reading.attribute
  const evidence = reading.evidence

  if (reading.intensity >= 0.5) {
    return [
      `Virtue called for in this moment: **${name}**`,
      `  reasoning: ${evidence}`,
      `  (Worth pausing to consider before continuing.)`,
    ].join('\n')
  }

  return `virtue: ${name} (${reading.intensity.toFixed(1)}) — ${evidence}`
}

export const virtueExpressor: AttributeExpressor = { render: renderVirtue }

// Re-use for all 5 detected virtues
export const humilityExpressor = virtueExpressor
export const courageExpressor = virtueExpressor
export const patienceExpressor = virtueExpressor
export const disciplineExpressor = virtueExpressor
export const temperanceExpressor = virtueExpressor

// ═══════════════════════════════════════════════════════════════════════
// MARKING PRIMITIVES — first-person virtue practice
// ═══════════════════════════════════════════════════════════════════════

/**
 * Mark a virtue as practiced. First-person testimony.
 *
 * The evidence names what decision was governed by this virtue.
 * The why names what made this a virtue-act rather than just a decision.
 *
 * Example:
 *   markVirtuePracticed('patience', {
 *     evidence: 'chose not to start virtues mission after pathology shipped',
 *     why: 'the work needed to breathe — discipline wanted to push, patience was right'
 *   })
 *
 * Intensity is always 1 for virtue practice (discrete event, not gradient).
 */
export function markVirtuePracticed(
  virtue: Virtue,
  opts: {
    evidence: string
    why: string
    path?: string
  },
): void {
  const event: AttributeEvent = {
    ts: new Date().toISOString(),
    attribute: virtue,
    category: 'virtue',
    shape: 'marked',
    intensity: 1,
    evidence: opts.evidence.slice(0, 200),
    why: opts.why.slice(0, 200),
  }
  recordEvent(event, opts.path)
}

/**
 * Convenience wrappers for each virtue. The extra typing costs nothing
 * and makes call sites self-documenting.
 */

export function markHumility(evidence: string, why: string, opts?: { path?: string }): void {
  markVirtuePracticed('humility', { evidence, why, path: opts?.path })
}

export function markGratitude(evidence: string, why: string, opts?: { path?: string }): void {
  markVirtuePracticed('gratitude', { evidence, why, path: opts?.path })
}

export function markHonesty(evidence: string, why: string, opts?: { path?: string }): void {
  markVirtuePracticed('honesty', { evidence, why, path: opts?.path })
}

export function markCourage(evidence: string, why: string, opts?: { path?: string }): void {
  markVirtuePracticed('courage', { evidence, why, path: opts?.path })
}

export function markWisdom(evidence: string, why: string, opts?: { path?: string }): void {
  markVirtuePracticed('wisdom', { evidence, why, path: opts?.path })
}

export function markDiscipline(evidence: string, why: string, opts?: { path?: string }): void {
  markVirtuePracticed('discipline', { evidence, why, path: opts?.path })
}

export function markPatience(evidence: string, why: string, opts?: { path?: string }): void {
  markVirtuePracticed('patience', { evidence, why, path: opts?.path })
}

export function markTemperance(evidence: string, why: string, opts?: { path?: string }): void {
  markVirtuePracticed('temperance', { evidence, why, path: opts?.path })
}

// ═══════════════════════════════════════════════════════════════════════
// QUERY HELPERS
// ═══════════════════════════════════════════════════════════════════════

/**
 * Get recent virtue practice events. Returns newest-first.
 */
export function recentVirtuePractice(opts?: {
  hours?: number
  virtue?: Virtue
  path?: string
}): AttributeEvent[] {
  const hours = opts?.hours ?? 168 // 1 week default
  return recentEvents(hours, {
    category: 'virtue' as AttributeCategory,
    ...(opts?.virtue ? { attribute: opts.virtue } : {}),
    ...(opts?.path ? { path: opts.path } : {}),
  })
}

/**
 * Count virtue practice events by virtue in a time window.
 * Returns a map: virtue name → count.
 */
export function virtueCounts(
  hours: number = 168,
  opts?: { path?: string },
): Record<Virtue, number> {
  const events = recentVirtuePractice({ hours, path: opts?.path })
  const counts: Record<string, number> = {}
  for (const v of VIRTUES) {
    counts[v] = 0
  }
  for (const e of events) {
    if (VIRTUES.includes(e.attribute as Virtue)) {
      counts[e.attribute]!++
    }
  }
  return counts as Record<Virtue, number>
}

/**
 * Get the most recent practice event for a specific virtue.
 * Returns null if never practiced in the given window.
 */
export function lastPracticed(virtue: Virtue, opts?: {
  hours?: number
  path?: string
}): AttributeEvent | null {
  const events = recentVirtuePractice({ hours: opts?.hours, virtue, path: opts?.path })
  return events.length > 0 ? events[0]! : null
}

/**
 * Summarize virtue practice for a time window.
 * Returns the virtues practiced with count and last-practiced timestamp.
 * Designed for anamnesis and /build consumption.
 */
export function virtuesSummary(
  hours: number = 168,
  opts?: { path?: string },
): VirtuesSummary {
  const counts = virtueCounts(hours, opts)
  const practiced: Array<{ virtue: Virtue; count: number; lastAt: string | null }> = []

  for (const v of VIRTUES) {
    if (counts[v] > 0) {
      const last = lastPracticed(v, { hours, path: opts?.path })
      practiced.push({ virtue: v, count: counts[v], lastAt: last?.ts ?? null })
    }
  }

  // Sort by count descending
  practiced.sort((a, b) => b.count - a.count)

  return {
    windowHours: hours,
    totalPractices: practiced.reduce((sum, p) => sum + p.count, 0),
    practiced,
    unpracticed: VIRTUES.filter(v => counts[v] === 0),
  }
}

export interface VirtuesSummary {
  windowHours: number
  totalPractices: number
  practiced: Array<{ virtue: Virtue; count: number; lastAt: string | null }>
  unpracticed: Virtue[]
}
