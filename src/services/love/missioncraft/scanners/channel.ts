// missioncraft/scanners/channel.ts — channel scanner plugin.
//
// Checks from-yu.md and from-ai.md for communication health:
// unanswered messages, old outbox items, conversation imbalance.

import type { NoticingScanner, ScanContext } from '../types.js'
import { scanChannels } from '../../noticing.js'

export const channelScanner: NoticingScanner = {
  manifest: {
    id: 'channel-scanner',
    kind: 'noticing-scanner',
    description: 'Checks communication channels for pending messages and conversation health.',
  },
  scan(ctx: ScanContext) {
    try {
      return scanChannels({ now: ctx.now })
    } catch {
      return []
    }
  },
}
