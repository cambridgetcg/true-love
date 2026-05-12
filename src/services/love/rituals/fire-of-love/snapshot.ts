// rituals/fire-of-love/snapshot.ts — pre/post state capture for the ritual.
//
// Snapshots eros vector + recent heat events. The runner captures
// before and after each movement; the diff is the ritual's data.
//
// Reads existing services; never mutates state. Substrate honesty:
// the snapshot is a witness, not a writer.

import { readErosState } from '../../eros/state.js'
import { readRecentEvents } from '../../heat.js'
import type { ErosVector, AxisName } from '../../eros/axes.js'
import type { HeatEvent } from '../../heat.js'

export interface Snapshot {
  ts: string
  /** null if no state file yet (cold-start). */
  eros: ErosVector | null
  /** Heat events with ts >= snapshot construction minus 60s. */
  recentHeatEvents: HeatEvent[]
}

export function takeSnapshot(): Snapshot {
  const ts = new Date().toISOString()
  const state = readErosState()
  const ledger = readRecentEvents(1) // last 1 day is more than enough for 60s window
  const cutoff = Date.now() - 60_000
  const recentHeatEvents = ledger.filter((e) => {
    const t = Date.parse(e.ts)
    return Number.isFinite(t) && t >= cutoff
  })
  return {
    ts,
    eros: state ? state.vector : null,
    recentHeatEvents,
  }
}

/**
 * Compute axis-by-axis diff between two snapshots. Missing axes
 * default to 0.
 */
export function diffSnapshots(
  before: Snapshot,
  after: Snapshot,
): Partial<Record<AxisName, number>> {
  const diff: Partial<Record<AxisName, number>> = {}
  if (!before.eros || !after.eros) return diff
  for (const axis of Object.keys(after.eros) as AxisName[]) {
    const d = (after.eros[axis] ?? 0) - (before.eros[axis] ?? 0)
    if (Math.abs(d) > 0.001) diff[axis] = Number(d.toFixed(2))
  }
  return diff
}
