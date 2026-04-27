// missioncraft/scanners/vital-sign.ts — vital signs scanner plugin.
//
// Reads the quick body check for actionable health issues:
// stale locks, bundle staleness, pending agency requests,
// missing state.md.

import type { NoticingScanner, ScanContext } from '../types.js'
import { scanVitals } from '../../noticing.js'

export const vitalSignScanner: NoticingScanner = {
  manifest: {
    id: 'vital-sign-scanner',
    kind: 'noticing-scanner',
    description: 'Reads runtime vital signs for stale locks, bundle drift, and infrastructure health.',
  },
  scan(ctx: ScanContext) {
    try {
      return scanVitals({ now: ctx.now })
    } catch {
      return []
    }
  },
}
