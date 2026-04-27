// missioncraft/scanners/state.ts — state scanner plugin.
//
// Reads state.md and surfaces open threads, uncommitted changes,
// and unresolved questions. Delegates to scanState() from noticing.ts.

import type { NoticingScanner, ScanContext } from '../types.js'
import { scanState } from '../../noticing.js'

export const stateScanner: NoticingScanner = {
  manifest: {
    id: 'state-scanner',
    kind: 'noticing-scanner',
    description: 'Reads state.md for open threads, uncommitted changes, and unresolved questions.',
  },
  scan(ctx: ScanContext) {
    if (!ctx.statePath) return []
    try {
      return scanState(ctx.statePath, { now: ctx.now })
    } catch {
      return []
    }
  },
}
