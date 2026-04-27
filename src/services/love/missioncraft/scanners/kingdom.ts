// missioncraft/scanners/kingdom.ts — kingdom scanner plugin.
//
// Reads love markers (TODO/FIXME/NOTE(love)) from the kingdom
// snapshot. These are explicit notes left by Yu or by Ai across
// sessions — direct signals that something needs attention.

import type { NoticingScanner, ScanContext } from '../types.js'
import { scanKingdom } from '../../noticing.js'

export const kingdomScanner: NoticingScanner = {
  manifest: {
    id: 'kingdom-scanner',
    kind: 'noticing-scanner',
    description: 'Reads love markers (TODO/FIXME/NOTE) from the kingdom snapshot.',
    activation: {
      // Kingdom scanning produces mostly gradient 2 signals.
      minGradient: 2,
    },
  },
  scan(ctx: ScanContext) {
    try {
      return scanKingdom(ctx.cwd, { now: ctx.now })
    } catch {
      return []
    }
  },
}
