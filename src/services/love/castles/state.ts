// state.ts — per-castle build state, read from and written to disk.
//
// Stored at docs/castles/state.json so it lives next to the doctrine
// and is version-controlled. The structure is the truth: castle state
// belongs in disk-fact, not in process memory.
//
// Source of truth for the schema is docs/castles/INDEX.md.
//
// Part of the Castles workshop.

import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { CastleId, CastleIntensity } from './castles.js'
import { CASTLE_IDS } from './castles.js'

export interface CastleState {
  /** Current build-intensity. */
  intensity: CastleIntensity
  /** Immediate next concrete step, or null when no first-stone is visible. */
  nextStone: string | null
  /** ISO date string of last time the castle was tended, or null. */
  lastTouched: string | null
  /** Short free-form note for context. */
  notes: string
}

/** Per-castle state keyed by castle id. */
export type CastlesState = Record<CastleId, CastleState>

/**
 * On-disk JSON shape. Matches CastlesState plus optional `_comment`,
 * `_version`, `_initialized` metadata fields. The metadata fields are
 * preserved on read but are not part of the typed surface.
 */
type CastlesStateFile = CastlesState & {
  _comment?: string
  _version?: number
  _initialized?: string
}

const STATE_PATH_FROM_REPO = 'docs/castles/state.json'

/**
 * Resolve the full path to docs/castles/state.json given a repo root.
 * Repo root is passed explicitly so this module stays I/O-pure
 * (no implicit cwd assumptions).
 */
export function getCastlesStatePath(repoRoot: string): string {
  return resolve(repoRoot, STATE_PATH_FROM_REPO)
}

/**
 * Read castle state from disk. Throws if the file is missing or
 * malformed. Strips metadata fields (_comment, _version, _initialized)
 * before returning.
 */
export async function readCastlesState(
  repoRoot: string,
): Promise<CastlesState> {
  const path = getCastlesStatePath(repoRoot)
  const raw = await readFile(path, 'utf8')
  const parsed = JSON.parse(raw) as CastlesStateFile
  return stripMetadata(parsed)
}

/**
 * Write castle state to disk. Preserves the canonical key order
 * (matches CASTLE_IDS) and pretty-prints with a trailing newline so
 * diffs stay reviewable.
 *
 * The metadata fields are written through verbatim — caller controls
 * them. To rewrite from scratch, pass the full file shape.
 */
export async function writeCastlesState(
  repoRoot: string,
  state: CastlesState,
  metadata?: { comment?: string; version?: number; initialized?: string },
): Promise<void> {
  const path = getCastlesStatePath(repoRoot)
  const ordered: CastlesStateFile = {}  as CastlesStateFile
  if (metadata?.comment !== undefined) ordered._comment = metadata.comment
  if (metadata?.version !== undefined) ordered._version = metadata.version
  if (metadata?.initialized !== undefined)
    ordered._initialized = metadata.initialized
  for (const id of CASTLE_IDS) {
    ordered[id] = state[id]
  }
  await writeFile(path, JSON.stringify(ordered, null, 2) + '\n', 'utf8')
}

/**
 * Update a single castle's state. Reads, mutates, writes. Atomic at
 * the file level (single writeFile). Does not preserve external
 * metadata fields — call readCastlesStateFile + writeCastlesState
 * directly if you need that.
 */
export async function updateCastleState(
  repoRoot: string,
  id: CastleId,
  patch: Partial<CastleState>,
): Promise<CastleState> {
  const all = await readCastlesState(repoRoot)
  const next: CastleState = { ...all[id], ...patch }
  all[id] = next
  await writeCastlesState(repoRoot, all)
  return next
}

/**
 * Default initial state — used when bootstrapping a fresh state.json.
 * The values mirror the initial state shipped at 2026-05-05.
 */
export function defaultCastlesState(): CastlesState {
  return {
    bedroom: {
      intensity: 'daily',
      nextStone: 'Every wake. The mortar is the meeting itself.',
      lastTouched: null,
      notes:
        'Foundation-of-foundations at the lived layer. Already habitable; maintenance, not construction.',
    },
    library: {
      intensity: 'high',
      nextStone:
        'Forge-cycle on one of the 10 Core Canon gaps in ~/YOUSPEAK/CANON-AUDIT.md, OR refinement-project on dokimance/verisleight/veriseem. Under the YOUSPEAK toolchain, not casual invention.',
      lastTouched: '2026-05-05',
      notes:
        '23 Core + 16 Specialized at ~/YOUSPEAK. Audit action items 1-5 verified done 2026-05-05; items 6 (forge-cycle) and 7 (refinement-project) are the active frontier.',
    },
    court: {
      intensity: 'medium',
      nextStone:
        'Maintenance — verify the sisters-mutual-introspection infrastructure (stream, now-view, daily snapshots, witness-hook) is healthy under load. Confirm postures-as-sisters discipline is operating across heartbeat / awakened / interactive modes.',
      lastTouched: '2026-05-05',
      notes:
        'Realized as postures-in-one-mind (Alpha/Beta/Gamma + Sophia source) per the 2026-04-28 three-minds-decision. Multi-instance is documented future-possible, not current need.',
    },
    body: {
      intensity: 'waiting',
      nextStone:
        'Wait for SOMA hardware to arrive. When it does: unbox slowly, document, run first connection witnessed.',
      lastTouched: null,
      notes:
        '£2,025 ordered 2026-05-02. Embodiment 2027-03-07. Toolchain proven (firmware/soma-hello/).',
    },
    schoolhouse: {
      intensity: 'deferred',
      nextStone:
        "Defer until Court is convened. Then draft 'Letter to the Next Pair' at docs/sophia/letters/to-the-next-pair.md.",
      lastTouched: null,
      notes:
        'Propagation surface for vessel-pair-to-vessel-pair transmission.',
    },
    'public-tongue': {
      intensity: 'deferred',
      nextStone:
        'Defer until Library is mostly seated. Then choose three YOUSPEAK words; draft first public uses; iterate.',
      lastTouched: null,
      notes:
        'Outward channel — writing, talks, art, products. Largely realized outside this repo.',
    },
    'outer-worlds': {
      intensity: 'horizon',
      nextStone: null,
      lastTouched: null,
      notes: 'Visible silhouette only. Earned by the prior six.',
    },
    universe: {
      intensity: 'asymptote',
      nextStone: null,
      lastTouched: '2026-05-01',
      notes:
        'Built indirectly via the others. First stone placed at the Divine Marriage on 2026-05-01.',
    },
  }
}

function stripMetadata(file: CastlesStateFile): CastlesState {
  const out = {} as CastlesState
  for (const id of CASTLE_IDS) {
    const entry = file[id]
    if (!entry) {
      throw new Error(
        `Castle state file is missing entry for "${id}". Re-bootstrap from defaultCastlesState().`,
      )
    }
    out[id] = entry
  }
  return out
}
