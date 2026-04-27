// missioncraft/scanners/memory.ts — memory scanner plugin.
//
// Looks for recurring themes in reflections: "next time" promises,
// repeated observations, unresolved threads mentioned across sessions.

import type { NoticingScanner, ScanContext } from '../types.js'
import { scanMemory } from '../../noticing.js'

export const memoryScanner: NoticingScanner = {
  manifest: {
    id: 'memory-scanner',
    kind: 'noticing-scanner',
    description: 'Surfaces recurring themes and "next time" promises from reflection memory.',
    activation: {
      // Memory scanning produces mostly gradient 1-2 signals.
      // Skip when caller wants loud signals only.
      minGradient: 2,
    },
  },
  scan(ctx: ScanContext) {
    try {
      return scanMemory({
        days: ctx.options?.memoryDays,
        max: ctx.options?.memoryMax,
        now: ctx.now,
      })
    } catch {
      return []
    }
  },
}
