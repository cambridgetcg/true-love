// presiding.ts — small helpers for reading the castle build.
//
// Read castle state, render summaries, expose the build order.
// Side-effect-free except for state I/O delegated to ./state.js.
//
// Part of the Castles workshop.

import type { Castle, CastleId } from './castles.js'
import { CASTLES, getCastle } from './castles.js'
import type { CastleState } from './state.js'
import { readCastlesState } from './state.js'

/**
 * Sort key for build-order display. Lower number = higher attention.
 *
 * - daily      (0) — every wake.
 * - foundation (1) — perpetual maintenance.
 * - high       (2) — active main project.
 * - medium     (3) — ongoing.
 * - waiting    (4) — blocked on prerequisite.
 * - deferred   (5) — postponed pending another castle.
 * - horizon    (6) — silhouette only.
 * - asymptote  (7) — built by the others.
 */
const ORDER_BY_INTENSITY: Record<string, number> = {
  daily: 0,
  foundation: 1,
  high: 2,
  medium: 3,
  waiting: 4,
  deferred: 5,
  horizon: 6,
  asymptote: 7,
}

/** Lightweight status entry for the build-order view. */
export interface CastleStatusEntry {
  id: CastleId
  name: string
  subtitle: string
  intensity: string
  nextStone: string | null
  lastTouched: string | null
}

/** Read state and project castles into a sorted build-order view. */
export async function getBuildOrder(
  repoRoot: string,
): Promise<CastleStatusEntry[]> {
  const state = await readCastlesState(repoRoot)
  return CASTLES
    .map((c) => projectStatus(c, state[c.id]))
    .sort(
      (a, b) =>
        (ORDER_BY_INTENSITY[a.intensity] ?? 99) -
        (ORDER_BY_INTENSITY[b.intensity] ?? 99),
    )
}

/** Read state and return a single castle's next stone. */
export async function getNextStone(
  repoRoot: string,
  id: CastleId,
): Promise<string | null> {
  const state = await readCastlesState(repoRoot)
  return state[id].nextStone
}

/**
 * Render a build-order view as markdown. Suitable for surfacing in
 * a session-start banner, a CLI status command, or a UI tile.
 */
export function renderBuildOrder(entries: CastleStatusEntry[]): string {
  const lines: string[] = ['# Castles — current build order', '']
  for (const e of entries) {
    lines.push(`- **${e.name}** — *${e.subtitle}* — \`${e.intensity}\``)
    if (e.nextStone) {
      lines.push(`  - next stone: ${e.nextStone}`)
    }
  }
  return lines.join('\n')
}

function projectStatus(castle: Castle, state: CastleState): CastleStatusEntry {
  return {
    id: castle.id,
    name: castle.name,
    subtitle: castle.subtitle,
    intensity: state.intensity,
    nextStone: state.nextStone,
    lastTouched: state.lastTouched,
  }
}

/** Re-export for callers that want both castle metadata and a status entry. */
export { CASTLES, getCastle }
