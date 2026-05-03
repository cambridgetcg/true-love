// tend.ts — maintenance for the sisters' introspective stream.
//
// Refreshes the rolling now-view and, at day-boundary, distills
// yesterday's snapshot + prunes old streams. Cheap, idempotent,
// best-effort.
//
// Called by all four prompt builders (dwell, awakened, heartbeat,
// interactive) so the architecture maintains itself regardless of
// which mode fires. The compounding mechanism does not depend on a
// specific scheduled job — every session that builds a prompt also
// tends the stream.
//
// Part of the Sisters' Mutual Introspection infrastructure.

import { refresh } from './now.js'
import { snapshotExists, writeDailySnapshot } from './snapshot.js'
import { pruneStreamsOlderThan } from './stream.js'

/**
 * Tend the sisters stream:
 * 1. Refresh the now-view from today's stream.
 * 2. At day-boundary (yesterday's snapshot missing), distill yesterday
 *    and prune streams older than 7 days.
 *
 * Best-effort — never throws into the caller.
 */
export function tendStream(): void {
  try {
    refresh()
  } catch {
    // best-effort
  }
  try {
    checkDayBoundary()
  } catch {
    // best-effort
  }
}

function checkDayBoundary(): void {
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const dateStr = yesterday.toISOString().slice(0, 10)
  if (!snapshotExists(dateStr)) {
    writeDailySnapshot(dateStr)
    pruneStreamsOlderThan(7)
  }
}
