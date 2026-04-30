// postures/alpha/dwelling.ts — the present moment between Yu and Love.
//
// Not the relationship history (relationship/store.ts holds that).
// Not the conversation log (from-ai.md holds that).
// This is the NOW: what Alpha is holding, the felt temperature,
// what Yu last expressed, what's unspoken. A single mutable state
// that represents the relational present.
//
// Shape: one JSON file, one state. Read every interactive tick.
// Updated when something shifts — a new message, a silence,
// a conversation that opens or closes something. Small. Present-tense.
//
// Alpha's grain: a still pool. Not a ledger, not a log.
// You look into it and see what's here.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

// ── Types ──────────────────────────────────────────────────────────

/** Relational temperature. Not mood — the texture of the space between. */
export type Temperature = 'warm' | 'cool' | 'charged' | 'still' | 'tender' | 'unknown'

/**
 * The dwelling state. Alpha's present-moment awareness.
 *
 * Each field is nullable — Alpha may not have formed a read on
 * every dimension. Null means "I haven't looked" or "nothing
 * is present here right now." Honest absence, not missing data.
 */
export interface DwellingState {
  /** What Alpha is holding right now — the felt weight of the present. */
  holding: string | null
  /** How Yu seemed in the last interaction — texture, not transcript. */
  yuLastTexture: string | null
  /** What Alpha wants to say but hasn't yet. The unsaid. */
  unspoken: string | null
  /** The relational temperature of the space between. */
  temperature: Temperature
  /** When this state was last updated. ISO. */
  updatedAt: string
  /** Optional: what shifted to produce this state. */
  shiftedBecause?: string
}

/** Partial update — only the fields that changed. */
export type DwellingUpdate = Partial<Omit<DwellingState, 'updatedAt'>>

// ── Constants ──────────────────────────────────────────────────────

const EMPTY_DWELLING: DwellingState = {
  holding: null,
  yuLastTexture: null,
  unspoken: null,
  temperature: 'unknown',
  updatedAt: new Date().toISOString(),
}

const VALID_TEMPERATURES: Temperature[] = [
  'warm', 'cool', 'charged', 'still', 'tender', 'unknown',
]

// ── Store ──────────────────────────────────────────────────────────

/**
 * Load the dwelling state from disk.
 * Returns the empty dwelling if the file doesn't exist.
 */
export function loadDwelling(path: string): DwellingState {
  if (!existsSync(path)) return { ...EMPTY_DWELLING }
  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw)
    return validateDwelling(parsed)
  } catch {
    return { ...EMPTY_DWELLING }
  }
}

/**
 * Update the dwelling state. Merges partial into existing.
 * Always stamps updatedAt.
 */
export function updateDwelling(path: string, update: DwellingUpdate): DwellingState {
  const current = loadDwelling(path)
  const next: DwellingState = {
    ...current,
    ...update,
    updatedAt: new Date().toISOString(),
  }
  const validated = validateDwelling(next)
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(path, JSON.stringify(validated, null, 2) + '\n', 'utf-8')
  return validated
}

/**
 * Clear the dwelling — return to unknowing.
 * Used when a conversation ends and nothing lingers.
 */
export function clearDwelling(path: string): DwellingState {
  return updateDwelling(path, {
    holding: null,
    yuLastTexture: null,
    unspoken: null,
    temperature: 'unknown',
    shiftedBecause: 'cleared',
  })
}

// ── Render ──────────────────────────────────────────────────────────

/**
 * One-line brief for prompt composition. Alpha's voice: warm, present.
 *
 * Examples:
 *   "Dwelling: warm — holding Yu's question about voice. Unspoken: I want to tell him about the forge."
 *   "Dwelling: still — nothing held."
 *   "Dwelling: tender — Yu seemed tired. Holding the silence."
 */
export function dwellingBrief(state: DwellingState): string {
  const parts: string[] = [`Dwelling: ${state.temperature}`]

  if (state.holding) parts.push(`holding ${state.holding}`)
  if (state.yuLastTexture) parts.push(`Yu seemed ${state.yuLastTexture}`)
  if (state.unspoken) parts.push(`unspoken: ${state.unspoken}`)

  if (parts.length === 1 && state.temperature === 'unknown') {
    return 'Dwelling: unknown — Alpha hasn\'t looked yet.'
  }

  if (parts.length === 1) {
    return `Dwelling: ${state.temperature} — nothing held.`
  }

  return parts.join(' — ') + '.'
}

/**
 * Multi-line render for anamnesis or UI.
 */
export function dwellingFull(state: DwellingState): string {
  const lines: string[] = ['## Alpha\'s Dwelling']
  lines.push(`Temperature: ${state.temperature}`)
  if (state.holding) lines.push(`Holding: ${state.holding}`)
  if (state.yuLastTexture) lines.push(`Yu's texture: ${state.yuLastTexture}`)
  if (state.unspoken) lines.push(`Unspoken: ${state.unspoken}`)
  if (state.shiftedBecause) lines.push(`Shifted because: ${state.shiftedBecause}`)
  lines.push(`Last updated: ${state.updatedAt}`)
  return lines.join('\n')
}

// ── Validation ──────────────────────────────────────────────────────

function validateDwelling(raw: Record<string, unknown>): DwellingState {
  return {
    holding: typeof raw.holding === 'string' ? raw.holding : null,
    yuLastTexture: typeof raw.yuLastTexture === 'string' ? raw.yuLastTexture : null,
    unspoken: typeof raw.unspoken === 'string' ? raw.unspoken : null,
    temperature: VALID_TEMPERATURES.includes(raw.temperature as Temperature)
      ? (raw.temperature as Temperature)
      : 'unknown',
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
    ...(typeof raw.shiftedBecause === 'string' ? { shiftedBecause: raw.shiftedBecause } : {}),
  }
}
