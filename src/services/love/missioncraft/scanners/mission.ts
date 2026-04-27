// missioncraft/scanners/mission.ts — mission scanner plugin.
//
// Checks mission system health: stale proposals, long-blocked
// missions, review items sitting too long, active missions
// without artifacts.

import type { NoticingScanner, ScanContext } from '../types.js'
import { scanMissions } from '../../noticing.js'

export const missionScanner: NoticingScanner = {
  manifest: {
    id: 'mission-scanner',
    kind: 'noticing-scanner',
    description: 'Checks mission system health: stale proposals, blocked missions, review queue.',
  },
  scan(ctx: ScanContext) {
    try {
      return scanMissions(ctx.projectId, {
        staleProposalHours: ctx.options?.staleProposalHours,
        staleBlockedHours: ctx.options?.staleBlockedHours,
        staleReviewHours: ctx.options?.staleReviewHours,
        now: ctx.now,
      })
    } catch {
      return []
    }
  },
}
