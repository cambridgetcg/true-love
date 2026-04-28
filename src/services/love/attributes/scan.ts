// attributes/scan.ts — runs all attribute detectors and surfaces top readings.
//
// Called once per awakened tick (after existing scanners: noticing,
// longings, loving-opportunities). The scanner:
//
//   1. Iterates all registered attributes that have detectors
//   2. Calls each detector.read()
//   3. Collects non-null readings
//   4. Sorts by priority (ache hierarchy + intensity)
//   5. Returns top 1-3 for prompt injection
//
// Design: the scanner is fast. It reads existing state only — no API
// calls, no file watches, no external systems. Each detector is
// responsible for being cheap (reading a JSONL file, checking a
// timestamp, counting events).
//
// The framework ships with NO detectors. This is intentional —
// sister missions implement detectors for their specific attributes.
// The scanner still works with zero detectors (returns empty readings).

import type { AttributeReading, AttributeScan } from './types.js'
import { ATTRIBUTES } from './registry.js'

// ── Priority sort ────────────────────────────────────────────────────

/**
 * Priority levels aligned with the ache hierarchy.
 * Lower number = higher priority.
 *
 * Pathology always surfaces first (it's a witness that needs attention).
 * Then signal emotions (current information about current conditions).
 * Then motors (engines that might need fuel or direction).
 * Then virtues and fruits (important but not urgent).
 */
const CATEGORY_PRIORITY: Record<string, number> = {
  pathology: 0,   // witnesses that need attention first
  signal: 1,      // current information, time-sensitive
  motor: 2,       // engines, persistent but not urgent
  virtue: 3,      // stances, reported not surfaced
  fruit: 4,       // moments, marked not detected
  emergent: 3,    // same priority as virtues by default
}

/**
 * Sort readings by priority. Criteria:
 *   1. Category priority (pathology > signal > motor > virtue > fruit)
 *   2. Within same category: intensity (higher = more important)
 *   3. Within same intensity: most recent first
 */
function sortByPriority(readings: AttributeReading[]): AttributeReading[] {
  return [...readings].sort((a, b) => {
    const catA = CATEGORY_PRIORITY[a.category] ?? 5
    const catB = CATEGORY_PRIORITY[b.category] ?? 5
    if (catA !== catB) return catA - catB

    // Higher intensity = more important
    if (a.intensity !== b.intensity) return b.intensity - a.intensity

    // More recent = more relevant
    return b.readAt.localeCompare(a.readAt)
  })
}

// ── Scanner ──────────────────────────────────────────────────────────

/**
 * Run all registered attribute detectors and produce a scan result.
 *
 * This is the main entry point called by the awakened tick.
 * Returns empty readings when no detectors are registered or when
 * all detectors return null (= no attributes worth surfacing).
 *
 * The scanner catches individual detector errors and continues —
 * one broken detector doesn't kill the scan.
 */
export async function scanAttributes(): Promise<AttributeScan> {
  const now = new Date().toISOString()
  const readings: AttributeReading[] = []

  for (const attr of ATTRIBUTES) {
    if (!attr.detector) continue
    try {
      const reading = await attr.detector.read()
      if (reading) {
        readings.push(reading)
      }
    } catch (_err) {
      // Individual detector failure: log but continue.
      // When observability improves, this should emit a trace event.
    }
  }

  const sorted = sortByPriority(readings)

  return {
    readings: sorted,
    topByPriority: sorted.slice(0, 3),
    timestamp: now,
  }
}

// ── Renderer ─────────────────────────────────────────────────────────

/**
 * Render an attribute scan into a compact prompt block.
 *
 * Returns null if no readings worth surfacing (suppresses the block
 * entirely — silence is better than empty output).
 *
 * Format:
 *   # Attributes (current readings)
 *   anxiety: 0.4 (unhandled risks in 3 open missions)
 *   patience: held 2× today
 *   hope: 0.7 (new mission accepted, direction clear)
 */
export function renderAttributesBlock(scan: AttributeScan): string | null {
  if (scan.topByPriority.length === 0) return null

  const lines: string[] = ['# Attributes (current readings)']

  for (const reading of scan.topByPriority) {
    // Use the attribute's expressor if it has one, otherwise default render
    const attr = ATTRIBUTES.find(a => a.name === reading.attribute)
    if (attr?.expressor) {
      const rendered = attr.expressor.render(reading)
      if (rendered) {
        lines.push(rendered)
        continue
      }
    }
    // Default rendering
    lines.push(renderReadingDefault(reading))
  }

  return lines.join('\n')
}

/**
 * Default rendering for a reading without a custom expressor.
 * Adapts format by category.
 */
function renderReadingDefault(reading: AttributeReading): string {
  const name = reading.attribute
  const evidence = reading.evidence

  switch (reading.category) {
    case 'signal':
      // Gradient: show intensity + reason
      return `${name}: ${reading.intensity.toFixed(1)} (${evidence})`

    case 'motor':
      // Motor: show intensity + direction
      return `${name}: ${reading.intensity.toFixed(1)} (${evidence})`

    case 'virtue':
      // Virtue: discrete, show as presence
      return `${name}: present (${evidence})`

    case 'fruit':
      // Fruit: arrival, show as moment
      return `${name}: arrived (${evidence})`

    case 'pathology': {
      // Pathology: gentle witness language
      const attr = ATTRIBUTES.find(a => a.name === name)
      const counter = attr?.counterSignal
        ? ` — ${attr.counterSignal.split('.')[0]}.`
        : ''
      return `${name}: noticed (${evidence})${counter}`
    }

    default:
      return `${name}: ${reading.intensity.toFixed(1)} (${evidence})`
  }
}
