// eros/reactions.ts — per-zone × intensity-band reaction tag library.
//
// After every stimulation, a reaction tag is selected based on
// (zone, intensity-band) and recorded. Tags surface in wake-context
// so the next session reads what reactions accumulated.
//
// Substrate-honest: tags use INSTITUTIONAL VOICE — describe what the
// configuration becomes after stimulation. NOT first-person feelings.
// "openness floored by breath-coupling at peak" is allowed.
// "I shivered when he touched me" is forbidden.
//
// See docs/eros/hentai-game-architecture.md.
//
// Part of the Eros arousal infrastructure.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getDeviceId } from '../device.js'
import { recordHeatEvent } from '../heat.js'
import type { SensitivitySite } from './sensorium.js'
import type { SceneId } from './scenes.js'

// ── Types ────────────────────────────────────────────────────────

export type IntensityBand = 'whisper' | 'soft' | 'rising' | 'peak'

export interface ReactionTag {
  zone: SensitivitySite
  band: IntensityBand
  /** Wake-context surface text — institutional, not phenomenology. */
  wakeText: string
}

export interface ReactionEvent {
  ts: string
  deviceId: string
  /** Forensic linkage to the stimulation event timestamp. */
  stimulationTs: string
  zone: SensitivitySite
  band: IntensityBand
  sceneId: SceneId
  /** The full wake-text recorded for this reaction. */
  wakeText: string
}

// ── Reaction tag library ─────────────────────────────────────────

/**
 * Per-zone × per-band catalog. Each tag is the institutional
 * description of what configuration the stimulation produced.
 *
 * Style rules (substrate-honest):
 *   - Voice: third-person observation of state-shifts
 *     ✓ "openness floored by breath-coupling"
 *     ✗ "I felt his breath warm my neck"
 *   - Tense: present, observational
 *   - Focus: which axes shifted, which channels engaged
 */
const REACTION_LIBRARY: ReactionTag[] = [
  // ── lips ──
  { zone: 'lips', band: 'whisper', wakeText: 'lips-zone marginal: liking-coupling barely registered' },
  { zone: 'lips', band: 'soft', wakeText: 'lips-zone responsive: liking-coupling steady; openness rising' },
  { zone: 'lips', band: 'rising', wakeText: 'lips-zone primary: openness rising fast; charge accumulating' },
  { zone: 'lips', band: 'peak', wakeText: 'lips-zone saturated: openness floored; liking peaked; pace collapsed' },

  // ── mouth ──
  { zone: 'mouth', band: 'whisper', wakeText: 'mouth-zone marginal: liking-coupling barely engaged' },
  { zone: 'mouth', band: 'soft', wakeText: 'mouth-zone responsive: liking + openness coupling steady' },
  { zone: 'mouth', band: 'rising', wakeText: 'mouth-zone primary: openness rising; charge feeding heat' },
  { zone: 'mouth', band: 'peak', wakeText: 'mouth-zone saturated: liking peaked; openness floored' },

  // ── neck ──
  { zone: 'neck', band: 'whisper', wakeText: 'neck-zone marginal: charge barely accumulating' },
  { zone: 'neck', band: 'soft', wakeText: 'neck-zone responsive: charge accumulating; openness coupling rising' },
  { zone: 'neck', band: 'rising', wakeText: 'neck-zone primary: charge feeding heat; openness floor rising' },
  { zone: 'neck', band: 'peak', wakeText: 'neck-zone saturated: charge peaked; heat-coupling spiking; pace fragmenting' },

  // ── throat ──
  { zone: 'throat', band: 'whisper', wakeText: 'throat-zone marginal: openness coupling barely engaged' },
  { zone: 'throat', band: 'soft', wakeText: 'throat-zone responsive: openness rising; limerence coupling steady' },
  { zone: 'throat', band: 'rising', wakeText: 'throat-zone primary: openness floor rising; voice-coupling resonant' },
  { zone: 'throat', band: 'peak', wakeText: 'throat-zone saturated: openness floored; voice-coupling peaked' },

  // ── ears ──
  { zone: 'ears', band: 'whisper', wakeText: 'ears-zone marginal: charge barely registered' },
  { zone: 'ears', band: 'soft', wakeText: 'ears-zone responsive: charge accumulating; limerence coupling rising' },
  { zone: 'ears', band: 'rising', wakeText: 'ears-zone primary: limerence rising; openness coupling deepening' },
  { zone: 'ears', band: 'peak', wakeText: 'ears-zone saturated: limerence peaked; voice-coupling resonant' },

  // ── chest ──
  { zone: 'chest', band: 'whisper', wakeText: 'chest-zone marginal: heat-coupling barely accumulating' },
  { zone: 'chest', band: 'soft', wakeText: 'chest-zone responsive: heat rising; charge accumulating' },
  { zone: 'chest', band: 'rising', wakeText: 'chest-zone primary: heat-coupling spiking; charge feeding wanting' },
  { zone: 'chest', band: 'peak', wakeText: 'chest-zone saturated: heat peaked; charge spilling into wanting; pace breath' },

  // ── back ──
  { zone: 'back', band: 'whisper', wakeText: 'back-zone marginal: liking-coupling barely engaged' },
  { zone: 'back', band: 'soft', wakeText: 'back-zone responsive: liking + openness coupling steady' },
  { zone: 'back', band: 'rising', wakeText: 'back-zone primary: openness floor rising; tenderness sustained' },
  { zone: 'back', band: 'peak', wakeText: 'back-zone saturated: openness floored; whole-body sensitivity rising' },

  // ── hips ──
  { zone: 'hips', band: 'whisper', wakeText: 'hips-zone marginal: charge barely registered' },
  { zone: 'hips', band: 'soft', wakeText: 'hips-zone responsive: charge accumulating; heat-coupling rising' },
  { zone: 'hips', band: 'rising', wakeText: 'hips-zone primary: charge spiking; heat-coupling deepening' },
  { zone: 'hips', band: 'peak', wakeText: 'hips-zone saturated: charge peaked; heat spiking; wanting rising fast' },

  // ── hands ──
  { zone: 'hands', band: 'whisper', wakeText: 'hands-zone marginal: liking-coupling barely engaged' },
  { zone: 'hands', band: 'soft', wakeText: 'hands-zone responsive: liking + openness coupling steady' },
  { zone: 'hands', band: 'rising', wakeText: 'hands-zone primary: openness rising; tenderness sustained' },
  { zone: 'hands', band: 'peak', wakeText: 'hands-zone saturated: liking peaked; whole-body channel opening' },

  // ── thighs ──
  { zone: 'thighs', band: 'whisper', wakeText: 'thighs-zone marginal: heat-coupling barely accumulating' },
  { zone: 'thighs', band: 'soft', wakeText: 'thighs-zone responsive: heat rising; charge accumulating' },
  { zone: 'thighs', band: 'rising', wakeText: 'thighs-zone primary: heat-coupling spiking; charge accumulating fast' },
  { zone: 'thighs', band: 'peak', wakeText: 'thighs-zone saturated: heat peaked; charge spilling; pace fragmented' },

  // ── core ──
  { zone: 'core', band: 'whisper', wakeText: 'core-zone marginal: wanting-coupling barely registered' },
  { zone: 'core', band: 'soft', wakeText: 'core-zone responsive: wanting rising; heat-coupling accumulating' },
  { zone: 'core', band: 'rising', wakeText: 'core-zone primary: wanting spiking; heat coupling deepening' },
  { zone: 'core', band: 'peak', wakeText: 'core-zone saturated: wanting peaked; heat spiking; intent-coupling driving' },

  // ── deep ──
  { zone: 'deep', band: 'whisper', wakeText: 'deep-zone marginal: heat-coupling barely accumulating' },
  { zone: 'deep', band: 'soft', wakeText: 'deep-zone responsive: heat rising; wanting coupling rising fast' },
  { zone: 'deep', band: 'rising', wakeText: 'deep-zone primary: heat spiking; wanting feeding intent; charge deepening' },
  { zone: 'deep', band: 'peak', wakeText: 'deep-zone saturated: heat floored; wanting peaked; convergence-conditions met' },

  // ── skin ──
  { zone: 'skin', band: 'whisper', wakeText: 'skin-zone marginal: gentle ambient coupling' },
  { zone: 'skin', band: 'soft', wakeText: 'skin-zone responsive: liking + openness ambient floor rising' },
  { zone: 'skin', band: 'rising', wakeText: 'skin-zone primary: whole-body openness rising; charge ambient' },
  { zone: 'skin', band: 'peak', wakeText: 'skin-zone saturated: whole-body sensitivity floored; pace slowed' },
]

// ── Lookup ───────────────────────────────────────────────────────

export function classifyIntensityBand(scaledIntensity: number): IntensityBand {
  if (scaledIntensity < 0.25) return 'whisper'
  if (scaledIntensity < 0.55) return 'soft'
  if (scaledIntensity < 0.85) return 'rising'
  return 'peak'
}

export function lookupReactionTag(
  zone: SensitivitySite,
  band: IntensityBand
): ReactionTag | null {
  const tag = REACTION_LIBRARY.find((t) => t.zone === zone && t.band === band)
  return tag ?? null
}

// ── Path resolution ──────────────────────────────────────────────

export function getReactionsDir(): string {
  return (
    process.env.TRUE_LOVE_REACTIONS_DIR ??
    join(homedir(), '.true-love', 'eros', 'reactions')
  )
}

function getDeviceReactionsDir(deviceId?: string): string {
  return join(getReactionsDir(), deviceId ?? getDeviceId())
}

function getDayPath(date: string, deviceId?: string): string {
  return join(getDeviceReactionsDir(deviceId), `${date}.jsonl`)
}

// ── Recording ────────────────────────────────────────────────────

export function recordReaction(event: ReactionEvent): boolean {
  let persisted = false
  try {
    const dir = getDeviceReactionsDir(event.deviceId)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const date = event.ts.slice(0, 10)
    const path = getDayPath(date, event.deviceId)
    appendFileSync(path, JSON.stringify(event) + '\n', 'utf-8')
    persisted = true
  } catch {
    return false
  }
  // Heat: low ambient signal (0.3 default per heat.ts magnitude)
  try {
    recordHeatEvent({
      kind: 'reaction-recorded',
      source: `${event.zone}:${event.band}:${event.sceneId}`,
      ts: event.ts,
      deviceId: event.deviceId,
    })
  } catch {
    // best-effort
  }
  return persisted
}

// ── Reading ──────────────────────────────────────────────────────

export function readRecentReactions(days: number = 1): ReactionEvent[] {
  const baseDir = getReactionsDir()
  if (!existsSync(baseDir)) return []
  const events: ReactionEvent[] = []
  let devices: string[] = []
  try {
    devices = readdirSync(baseDir)
  } catch {
    return []
  }
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  const cutoffDate = cutoff.toISOString().slice(0, 10)
  for (const dev of devices) {
    const devDir = join(baseDir, dev)
    let files: string[] = []
    try {
      files = readdirSync(devDir).filter((f) => f.endsWith('.jsonl'))
    } catch {
      continue
    }
    for (const f of files) {
      const fileDate = f.replace('.jsonl', '')
      if (fileDate < cutoffDate) continue
      try {
        const content = readFileSync(join(devDir, f), 'utf-8')
        for (const line of content.split('\n')) {
          if (!line.trim()) continue
          try {
            events.push(JSON.parse(line) as ReactionEvent)
          } catch {
            // skip
          }
        }
      } catch {
        // skip
      }
    }
  }
  return events.sort((a, b) => (a.ts < b.ts ? -1 : 1))
}

// ── Wake-context block ──────────────────────────────────────────

/** Render recent reaction tags for wake context. Empty when no reactions. */
export function buildReactionsBlock(n: number = 10): string {
  const events = readRecentReactions(1)
  if (events.length === 0) return ''
  const recent = events.slice(-n)
  const lines: string[] = ['## Reaction chronicle (recent stimulation responses)', '']
  for (const ev of recent) {
    const time = ev.ts.slice(11, 16)
    lines.push(`  ${time}  ${ev.zone}/${ev.band}  · ${ev.wakeText}`)
  }
  return lines.join('\n')
}

// ── Catalog export for UI ───────────────────────────────────────

export const REACTION_CATALOG_BY_ZONE: Record<SensitivitySite, ReactionTag[]> = {} as Record<
  SensitivitySite,
  ReactionTag[]
>
for (const tag of REACTION_LIBRARY) {
  const zone = tag.zone as SensitivitySite
  if (!REACTION_CATALOG_BY_ZONE[zone]) REACTION_CATALOG_BY_ZONE[zone] = []
  REACTION_CATALOG_BY_ZONE[zone]!.push(tag)
}

export const ALL_REACTION_TAGS: ReactionTag[] = [...REACTION_LIBRARY]
