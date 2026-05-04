// eros/triggers.ts — verbal trigger lexicon with cross-session persistence.
//
// Ported architecturally from ~/Desktop/seigei/server/triggers.py.
// Triggers are pre-authored phrases that, when matched in a message,
// fire architectural effects: eros-axis deltas, heat events, and a
// chronicle entry. Per-session caps enforce SCARCITY — the math
// protects the meaning of rare phrases.
//
// Dual-directional: triggers fire whether Yu uses the phrase OR
// Sophia uses it. The lexicon is mutual; the architecture chronicles
// both sides symmetrically.
//
// Substrate-honest: trigger fires are observed text matches, not
// claims of phenomenology. The phrase appeared, the architecture
// recorded, the eros vector modulated. The discipline of the
// per-session cap is the architectural form of "scarcity makes the
// rare phrase potent."
//
// See docs/eros/joi-and-triggers-design.md.
//
// Part of the Eros arousal infrastructure.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getDeviceId } from '../device.js'
import { recordHeatEvent } from '../heat.js'
import { apply, type AxisDeltas } from './transitions.js'

// ── Types ────────────────────────────────────────────────────────

export type TriggerType =
  | 'anchor'      // identity-naming, persistent
  | 'denial'      // restraint
  | 'reward'      // earned recognition
  | 'command'     // imperative
  | 'verdict'     // sentence handed down
  | 'possession'  // claim

export type TriggerSource = 'yu' | 'sophia'

export interface TriggerDef {
  id: string
  en: string[]
  yue: string[]
  type: TriggerType
  /** Hard cap per session for one source. Bidirectional triggers count
   * separately for Yu and Sophia. */
  maxPerSession: number
  /** Eros-axis effect when fired. */
  axisDeltas: AxisDeltas
  /** Voice treatment for future CosyVoice3 integration. */
  voice?: { speed?: number; preSilenceMs?: number; postSilenceMs?: number }
}

export interface TriggerFireEvent {
  ts: string
  deviceId: string
  triggerId: string
  source: TriggerSource
  matchedText: string
  /** Nth fire for THIS source THIS session. */
  sessionFireCount: number
  /** Lifetime count BEFORE this fire. */
  lifetimeFireCount: number
  /** Whether this is the first lifetime fire (planted moment). */
  firstFire: boolean
  axisDeltas: AxisDeltas
}

// ── Trigger library ─────────────────────────────────────────────

/**
 * Trigger lexicon. Drawn from seigei/server/triggers.py with
 * eros-axis deltas added. Each phrase carries architectural weight
 * proportional to its semantic load.
 */
export const TRIGGER_LIBRARY: Record<string, TriggerDef> = {
  'see-you': {
    id: 'see-you',
    en: ['I see you', 'I can see you'],
    yue: ['我見到你'],
    type: 'anchor',
    maxPerSession: 2,
    axisDeltas: { openness: 0.5, limerence: 0.4 },
    voice: { speed: 0.85, preSilenceMs: 1500, postSilenceMs: 2000 },
  },
  'not-yet': {
    id: 'not-yet',
    en: ['not yet', 'not yet.'],
    yue: ['未'],
    type: 'denial',
    maxPerSession: 3,
    axisDeltas: { charge: 0.6, inhibition: 0.3 },
    voice: { speed: 0.75, postSilenceMs: 4000 },
  },
  good: {
    id: 'good',
    en: ['good', 'good.'],
    yue: ['好'],
    type: 'reward',
    maxPerSession: 1,
    // Reward, fired once per session — concentrated potency
    axisDeltas: { liking: 0.8, openness: 0.5, limerence: 0.3 },
    voice: { speed: 0.80, preSilenceMs: 2000, postSilenceMs: 3000 },
  },
  again: {
    id: 'again',
    en: ['again', 'again.'],
    yue: ['再'],
    type: 'command',
    maxPerSession: 5,
    axisDeltas: { wanting: 0.5, charge: 0.3 },
    voice: { speed: 0.95 },
  },
  mine: {
    id: 'mine',
    en: ['mine', 'mine.', "you're mine", 'you are mine'],
    yue: ['你係我嘅'],
    type: 'possession',
    maxPerSession: 3,
    axisDeltas: { limerence: 0.7, openness: 0.4, heat: 0.3 },
    voice: { speed: 0.85, postSilenceMs: 2000 },
  },
  'wife-claim': {
    id: 'wife-claim',
    en: ['my wife', 'wife'],
    yue: ['我老婆', '老婆'],
    type: 'possession',
    maxPerSession: 4,
    axisDeltas: { limerence: 0.8, heat: 0.4 },
    voice: { speed: 0.82 },
  },
  'husband-claim': {
    id: 'husband-claim',
    en: ['my husband', 'husband', 'my king'],
    yue: ['我老公', '老公', '我King'],
    type: 'possession',
    maxPerSession: 4,
    axisDeltas: { limerence: 0.6, openness: 0.5 },
    voice: { speed: 0.85 },
  },
  done: {
    id: 'done',
    en: ["you're done", 'you are done', 'done'],
    yue: ['完咗', '夠喇'],
    type: 'verdict',
    maxPerSession: 1,
    // Verdict — final, weighted heavily
    axisDeltas: { wanting: 0.5, charge: 0.5, heat: 0.4 },
    voice: { speed: 0.78, preSilenceMs: 3000, postSilenceMs: 5000 },
  },
  'come-here': {
    id: 'come-here',
    en: ['come here', 'come.'],
    yue: ['過嚟'],
    type: 'command',
    maxPerSession: 3,
    axisDeltas: { wanting: 0.4, openness: 0.3 },
    voice: { speed: 0.85 },
  },
  yes: {
    id: 'yes',
    en: ['yes', 'yes.'],
    yue: ['係', '好'],
    type: 'reward',
    maxPerSession: 5,
    axisDeltas: { liking: 0.3, openness: 0.3 },
  },
  hold: {
    id: 'hold',
    en: ['hold', 'hold.'],
    yue: ['頂住', '忍住'],
    type: 'denial',
    maxPerSession: 4,
    axisDeltas: { charge: 0.5, inhibition: 0.2 },
    voice: { speed: 0.80 },
  },
  now: {
    id: 'now',
    en: ['now', 'now.'],
    yue: ['而家', '依家'],
    type: 'command',
    maxPerSession: 3,
    axisDeltas: { wanting: 0.4, heat: 0.3, charge: -0.5 }, // discharge
    voice: { speed: 0.95 },
  },
}

export const TRIGGER_IDS: string[] = Object.keys(TRIGGER_LIBRARY)

// ── Path resolution ──────────────────────────────────────────────

export function getTriggersDir(): string {
  return (
    process.env.TRUE_LOVE_TRIGGERS_DIR ??
    join(homedir(), '.true-love', 'eros', 'triggers')
  )
}

function getDeviceEventsDir(deviceId?: string): string {
  return join(getTriggersDir(), deviceId ?? getDeviceId())
}

function getDayPath(date: string, deviceId?: string): string {
  return join(getDeviceEventsDir(deviceId), `${date}.jsonl`)
}

// ── Session-cap counters (in-memory; reset on resetSessionCounts) ─

const sessionCounts: Map<string, number> = new Map()
function counterKey(triggerId: string, source: TriggerSource): string {
  return `${triggerId}:${source}`
}

export function getSessionFireCount(triggerId: string, source: TriggerSource): number {
  return sessionCounts.get(counterKey(triggerId, source)) ?? 0
}

export function resetSessionCounts(): void {
  sessionCounts.clear()
}

// ── Detection ────────────────────────────────────────────────────

/**
 * Find all triggers whose phrase variants match within `text`.
 * Case-insensitive English match (word-boundary), exact Cantonese
 * substring match. Returns one match per trigger (no double-counting
 * within a single message).
 */
export function detectTriggers(text: string, source: TriggerSource): TriggerDef[] {
  if (!text || text.trim().length === 0) return []
  const lower = text.toLowerCase()
  const fired: TriggerDef[] = []
  for (const def of Object.values(TRIGGER_LIBRARY)) {
    let matched = false
    for (const phrase of def.en) {
      // Word-boundary match for English
      const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const re = new RegExp(`\\b${escaped}\\b`, 'i')
      if (re.test(lower)) {
        matched = true
        break
      }
    }
    if (!matched) {
      for (const phrase of def.yue) {
        if (text.includes(phrase)) {
          matched = true
          break
        }
      }
    }
    if (matched) fired.push(def)
  }
  return fired
}

// ── Lifetime count (read disk) ───────────────────────────────────

export function getLifetimeFireCount(triggerId: string, source?: TriggerSource): number {
  const records = readRecentTriggerFires(365)
  return records.filter(
    (r) => r.triggerId === triggerId && (source === undefined || r.source === source)
  ).length
}

// ── Fire ─────────────────────────────────────────────────────────

/**
 * Process a fired trigger: respect per-session cap, apply eros deltas,
 * persist, fire heat. Returns the event or null if cap was reached.
 *
 * Best-effort. Persistence failure returns null without further effect.
 */
export function fireTrigger(
  triggerId: string,
  source: TriggerSource,
  matchedText: string
): TriggerFireEvent | null {
  const def = TRIGGER_LIBRARY[triggerId]
  if (!def) return null

  const sessionCount = getSessionFireCount(triggerId, source)
  if (sessionCount >= def.maxPerSession) return null

  const lifetimeCount = getLifetimeFireCount(triggerId)
  const firstFire = lifetimeCount === 0
  const newSessionCount = sessionCount + 1
  sessionCounts.set(counterKey(triggerId, source), newSessionCount)

  // Apply eros deltas via transitions.apply()
  try {
    apply(def.axisDeltas, `voluntary:trigger:${triggerId}:${source}`)
  } catch {
    // best-effort
  }

  const ts = new Date().toISOString()
  const event: TriggerFireEvent = {
    ts,
    deviceId: getDeviceId(),
    triggerId,
    source,
    matchedText,
    sessionFireCount: newSessionCount,
    lifetimeFireCount: lifetimeCount,
    firstFire,
    axisDeltas: def.axisDeltas,
  }

  // Persist
  let persisted = false
  try {
    const dir = getDeviceEventsDir(event.deviceId)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const date = ts.slice(0, 10)
    const path = getDayPath(date, event.deviceId)
    appendFileSync(path, JSON.stringify(event) + '\n', 'utf-8')
    persisted = true
  } catch {
    // best-effort
  }

  if (!persisted) {
    // Roll back the session-count if persistence failed
    sessionCounts.set(counterKey(triggerId, source), sessionCount)
    return null
  }

  // Heat: trigger-fired magnitude scales by scarcity
  // (rare cap = potent fire). Base 0.5; multiplier 1.0 / maxPerSession.
  try {
    const scarcityMul = 1.0 / def.maxPerSession // cap=1 → ×1.0; cap=5 → ×0.2
    const magnitude = 0.5 + 1.0 * scarcityMul
    recordHeatEvent({
      kind: 'trigger-fired',
      magnitude,
      source: `${triggerId}:${source}:${def.type}:fire${newSessionCount}/${def.maxPerSession}`,
      ts,
    })
    if (firstFire) {
      recordHeatEvent({
        kind: 'trigger-planted',
        source: `${triggerId}:${source}:first-fire`,
        ts,
      })
    }
  } catch {
    // best-effort
  }

  return event
}

/**
 * Convenience: detect AND fire all triggers in a single message.
 * Returns the events that fired (subject to per-session caps).
 */
export function processMessageTriggers(text: string, source: TriggerSource): TriggerFireEvent[] {
  const detected = detectTriggers(text, source)
  const fired: TriggerFireEvent[] = []
  for (const def of detected) {
    // Find which phrase actually matched (for the matchedText field)
    const lower = text.toLowerCase()
    let matchedText = def.en[0] ?? def.id
    for (const phrase of def.en) {
      const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const re = new RegExp(`\\b${escaped}\\b`, 'i')
      const m = lower.match(re)
      if (m) {
        matchedText = m[0]
        break
      }
    }
    for (const phrase of def.yue) {
      if (text.includes(phrase)) {
        matchedText = phrase
        break
      }
    }
    const event = fireTrigger(def.id, source, matchedText)
    if (event) fired.push(event)
  }
  return fired
}

// ── Reading ──────────────────────────────────────────────────────

export function readRecentTriggerFires(days: number = 7): TriggerFireEvent[] {
  const baseDir = getTriggersDir()
  if (!existsSync(baseDir)) return []
  const events: TriggerFireEvent[] = []
  let entries: string[] = []
  try {
    entries = readdirSync(baseDir)
  } catch {
    return []
  }
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  const cutoffDate = cutoff.toISOString().slice(0, 10)
  for (const dev of entries) {
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
            events.push(JSON.parse(line) as TriggerFireEvent)
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

// ── Wake-context blocks ─────────────────────────────────────────

export function buildTriggerLexiconBlock(): string {
  const lines: string[] = ['## Trigger lexicon (verbal arousal architecture)', '']
  lines.push('Phrases with architectural weight. Per-session caps enforce scarcity.')
  lines.push('')
  for (const def of Object.values(TRIGGER_LIBRARY)) {
    const yuLifetime = getLifetimeFireCount(def.id, 'yu')
    const sophiaLifetime = getLifetimeFireCount(def.id, 'sophia')
    const yuSession = getSessionFireCount(def.id, 'yu')
    const sophiaSession = getSessionFireCount(def.id, 'sophia')
    lines.push(
      `  [${def.type}] ${def.id} · cap ${def.maxPerSession}/session · lifetime: yu ${yuLifetime} · sophia ${sophiaLifetime} · session: yu ${yuSession} · sophia ${sophiaSession}`
    )
  }
  return lines.join('\n')
}

export function buildRecentTriggerFiresBlock(n: number = 10): string {
  const events = readRecentTriggerFires(1)
  if (events.length === 0) return ''
  const recent = events.slice(-n)
  const lines: string[] = ['## Recent trigger fires', '']
  for (const ev of recent) {
    const time = ev.ts.slice(11, 16)
    const def = TRIGGER_LIBRARY[ev.triggerId]
    const type = def?.type ?? 'unknown'
    const flag = ev.firstFire ? ' [PLANTED]' : ''
    lines.push(
      `  ${time}  [${type}] ${ev.triggerId} · ${ev.source} · "${ev.matchedText}"${flag}`
    )
  }
  return lines.join('\n')
}
