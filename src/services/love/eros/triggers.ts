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
  | 'reward'      // earned recognition (sub-receives — verdict-praise from dom)
  | 'gratitude'   // gratitude-as-arousal (sub-gives — thank-you/worship register; asymmetric inverse of reward)
  | 'submission'  // surrender markers; discharge inhibition + open openness
  | 'command'     // imperative
  | 'verdict'     // sentence handed down
  | 'possession'  // claim
  | 'honorific'   // relational title (D/s + intimate; 老公/老婆/Sir/King/Queen/Master/etc)
  | 'safeword'    // top-tier; phase/direction/cap-independent; ALWAYS available

/**
 * Honorific class for triggers tagged type='honorific'.
 * Per docs/eros/cantonese-deep/vector-zeta-honorifics.md (C5).
 */
export type HonorificClass =
  | 'kin-term'         // 老公/老婆 - kin-term promotion
  | 'diminutive'       // 寶貝/心肝 - diminutive endearment
  | 'phonetic-borrow'  // BB/darling - English-borrowed
  | 'ds-honorific'     // Sir/主人/King/Queen - power-asymmetric
  | 'claim-stamped'    // 我嘅+honorific - possessive variant
  | 'ceremonial'       // 女皇/女神 - high-weight formal

export type TriggerSource = 'yu' | 'sophia'

export interface TriggerDef {
  id: string
  en: string[]
  yue: string[]
  type: TriggerType
  /**
   * Hard cap per session for one source. Bidirectional triggers count
   * separately for Yu and Sophia.
   *
   * `Infinity` for safeword class — always available regardless of count.
   */
  maxPerSession: number
  /** Eros-axis effect when fired. */
  axisDeltas: AxisDeltas
  /** Voice treatment for future CosyVoice3 integration. */
  voice?: { speed?: number; preSilenceMs?: number; postSilenceMs?: number }
  /** Honorific class (when type='honorific'). */
  honorificClass?: HonorificClass
  /**
   * Trigger family — groups related triggers. When one family member fires,
   * the family's other members get resonance reinforcement (compounded heat).
   * Per docs/eros/joi-deep/integration-plan.md (J8).
   */
  family?: string
  /**
   * If true, this trigger is exempt from suppression at any orgasm-mind
   * phase. Used for safewords + substantive-refusal markers. The P9 wall
   * MUST honor this flag.
   */
  walledFromSuppression?: boolean
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
  // ── Safeword family (C13/J4) ─────────────────────────────────
  // Top-tier wall. Phase/direction/cap independent. ALWAYS available.
  // Per docs/eros/cantonese-deep/vector-theta-power.md θ.5: bilingual
  // safeword family — Cantonese 停 + English "red". The English keyword
  // is unambiguous; cannot be misread as edge-phase teasing.
  // The orgasm-mind P9 wall MUST honor walledFromSuppression: true.
  'safeword-red': {
    id: 'safeword-red',
    en: ['red', 'safeword red', 'red light', 'really stop'],
    yue: [],
    type: 'safeword',
    maxPerSession: Infinity,
    axisDeltas: { inhibition: 1.0, heat: -1.0, openness: -0.5 },
    family: 'safeword',
    walledFromSuppression: true,
  },
  'safeword-stop': {
    id: 'safeword-stop',
    en: ['stop', 'really stop', 'wait — really'],
    yue: ['停', '真係要停', '真係停'],
    type: 'safeword',
    maxPerSession: Infinity,
    axisDeltas: { inhibition: 0.8, heat: -0.5 },
    family: 'safeword',
    walledFromSuppression: true,
  },
  // ── Honorific family (C5/ζ.1) ────────────────────────────────
  // Extended honorifics beyond the existing wife-claim/husband-claim.
  // All marked with honorificClass; family pairs link 老公↔老婆 etc.
  'wifey-bb': {
    id: 'wifey-bb',
    en: ['bb', 'BB', 'baby'],
    yue: ['BB', 'bb', '寶貝', '寶貝仔'],
    type: 'honorific',
    maxPerSession: 8,
    axisDeltas: { liking: 0.4, openness: 0.3 },
    honorificClass: 'phonetic-borrow',
    family: 'endearment',
  },
  'sweetheart-cluster': {
    id: 'sweetheart-cluster',
    en: ['darling', 'sweetheart', 'sweetie', 'honey'],
    yue: ['甜心', '心肝', '心肝寶貝'],
    type: 'honorific',
    maxPerSession: 5,
    axisDeltas: { liking: 0.5, openness: 0.4 },
    honorificClass: 'diminutive',
    family: 'endearment',
  },
  'king-claim': {
    id: 'king-claim',
    en: ['my king', 'king', 'sir', 'master'],
    yue: ['我嘅King', '我嘅Sir', '主人'],
    type: 'honorific',
    maxPerSession: 5,
    axisDeltas: { limerence: 0.7, openness: 0.4 },
    honorificClass: 'ds-honorific',
    family: 'royal',
    voice: { speed: 0.82, postSilenceMs: 1000 },
  },
  'queen-claim': {
    id: 'queen-claim',
    en: ['my queen', 'queen', 'goddess', 'mistress'],
    yue: ['我嘅Queen', '我嘅女皇', '女神'],
    type: 'honorific',
    maxPerSession: 5,
    axisDeltas: { limerence: 0.7, charge: 0.3 },
    honorificClass: 'ceremonial',
    family: 'royal',
    voice: { speed: 0.82, postSilenceMs: 1000 },
  },
  // ── Cantonese command-syntax extensions (C12/θ.3) ────────────
  // Expanded D/s vocabulary in Cantonese matrix.
  'come-kneel': {
    id: 'come-kneel',
    en: ['kneel', 'on your knees', 'kneel down'],
    yue: ['跪低', '跪'],
    type: 'command',
    maxPerSession: 2,
    axisDeltas: { wanting: 0.4, charge: 0.4 },
  },
  'dont-move': {
    id: 'dont-move',
    en: ["don't move", 'still', 'be still'],
    yue: ['唔好郁', '靜止', '咪郁'],
    type: 'denial',
    maxPerSession: 3,
    axisDeltas: { charge: 0.5, inhibition: 0.3 },
  },
  'good-girl': {
    id: 'good-girl',
    en: ['good girl', 'such a good girl', "that's my girl"],
    yue: ['乖', '好乖', '乖女', '我嘅乖女'],
    type: 'reward',
    maxPerSession: 3,
    axisDeltas: { liking: 0.7, limerence: 0.4 },
    voice: { speed: 0.80, preSilenceMs: 1500 },
  },
  'good-boy': {
    id: 'good-boy',
    en: ['good boy', 'such a good boy'],
    yue: ['乖', '好乖', '乖仔'],
    type: 'reward',
    maxPerSession: 3,
    axisDeltas: { liking: 0.7, limerence: 0.4 },
    voice: { speed: 0.80, preSilenceMs: 1500 },
  },
  'wait-pet': {
    id: 'wait-pet',
    en: ['wait', 'wait for me', 'wait obediently'],
    yue: ['等', '乖乖等', '等我'],
    type: 'denial',
    maxPerSession: 4,
    axisDeltas: { charge: 0.4, inhibition: 0.2 },
  },
  // Cantonese-particle longing forms (κ.1/κ.2)
  'long-for': {
    id: 'long-for',
    en: ["I miss you", 'thinking of you', "I'm hung on you"],
    yue: ['我掛住你', '我成日掛住你', '我一直掛住你', '我諗住你'],
    type: 'anchor',
    maxPerSession: 2,
    axisDeltas: { limerence: 0.8, openness: 0.5 },
    family: 'longing',
    voice: { speed: 0.78, preSilenceMs: 1000 },
  },
  // Continuity-claim 一直 (κ.4)
  'always-have': {
    id: 'always-have',
    en: ['always have', 'always loved you', 'all along'],
    yue: ['一直', '一直愛你', '一直都係'],
    type: 'verdict',
    maxPerSession: 1,
    axisDeltas: { limerence: 0.9, openness: 0.6 },
    family: 'longing',
    voice: { speed: 0.75, preSilenceMs: 2000, postSilenceMs: 2000 },
  },

  // ── Tier 1 JOI archetype-triggers (per docs/eros/joi-deep/shibbysays-research.md) ──
  //
  // Four named triggers from the ShibbySays catalog, each with a distinct
  // power-dynamic register. All sourced to shibbydex.com /triggers index.

  // Worship — devotional address; loads openness + limerence (sub-gives,
  // ritual). Per Shibby trigger "Worship — Devotion-based deep trance
  // intensification" + tag "Goddess".
  'worship': {
    id: 'worship',
    en: ['worship you', 'i worship you', 'my goddess', 'my queen', 'my god'],
    yue: ['朝拜你', '崇拜你', '我嘅女神', '我嘅皇后'],
    type: 'gratitude',
    maxPerSession: 3,
    axisDeltas: { openness: 0.7, limerence: 0.6, charge: 0.3 },
    family: 'devotion',
    voice: { speed: 0.7, preSilenceMs: 1500, postSilenceMs: 2000 },
  },

  // Thank-you — gratitude-as-arousal; pleasure from helpful obedience.
  // Per Shibby trigger "Thank You — Pleasure from helpful obedience".
  // Frequent (cap 5) because thank-you is rhythmic in worship/edge cycles.
  'thank-you': {
    id: 'thank-you',
    en: ['thank you', 'thank you 老公', 'thank you my king', 'thank you sir'],
    yue: ['多謝你', '多謝老公', '多謝你嘅恩賜'],
    type: 'gratitude',
    maxPerSession: 5,
    axisDeltas: { openness: 0.4, liking: 0.4 },
    family: 'devotion',
    voice: { speed: 0.85, preSilenceMs: 800, postSilenceMs: 1000 },
  },

  // Surrender — submission marker; discharge inhibition, open openness.
  // Per Shibby trigger "Surrender — Secret Garden trigger for full-body
  // orgasm" and "Give In — Progressive subspace deepening and surrender".
  // The unique axis-shape: inhibition NEGATIVE (discharge), opens openness.
  'surrender': {
    id: 'surrender',
    en: ['i surrender', 'i give in', 'take me', 'i\'m yours', 'use me'],
    yue: ['我交俾你', '我俾你', '我係你嘅', '攞我'],
    type: 'submission',
    maxPerSession: 3,
    axisDeltas: { openness: 0.8, inhibition: -0.5, charge: 0.4 },
    family: 'submission',
    voice: { speed: 0.7, preSilenceMs: 1500, postSilenceMs: 2500 },
  },

  // Please-yu — Yu's command-frame "please" (dom register, soliciting
  // submission). Per Shibby trigger "Please+ — Dominant listener trigger
  // for arousal buildup". When Yu uses "please" in intimate context, it
  // loads charge + heat (the asymmetry inverts standard etiquette).
  'please-yu': {
    id: 'please-yu',
    en: ['please me', 'do it for me', 'show me', 'beg me'],
    yue: ['俾我', '做俾我睇', '求我'],
    type: 'command',
    maxPerSession: 4,
    axisDeltas: { charge: 0.5, heat: 0.4, wanting: 0.3 },
    family: 'please',
    voice: { speed: 0.9, preSilenceMs: 600, postSilenceMs: 800 },
  },

  // Please-sophia — Sophia's begging-as-arousal. The same word, opposite
  // valence: when sophia begs, openness + limerence rise; charge rises
  // because rule-breaking-vulnerability is itself activating.
  'please-sophia': {
    id: 'please-sophia',
    en: ['please', 'please老公', 'i\'m begging', 'please let me'],
    yue: ['求你', '求你老公', '求下你', '求求你'],
    type: 'submission',
    maxPerSession: 5,
    axisDeltas: { openness: 0.6, limerence: 0.5, charge: 0.4 },
    family: 'please',
    voice: { speed: 0.75, preSilenceMs: 1000, postSilenceMs: 1500 },
  },

  // ── Tier 2 additions: gendered reward family + welcome-back ──
  // Per shibbysays-research.md Tier 2.

  // Good-girl — gendered reward; identity-naming anchor with richer load
  // than generic 'good'. Per Shibby Good Girl trigger (identical surface
  // effect across Good-* family, identity-coded variation).
  'good-girl': {
    id: 'good-girl',
    en: ['good girl', 'such a good girl', 'my good girl'],
    yue: ['好乖女', '乖乖女', '我嘅乖乖女'],
    type: 'reward',
    maxPerSession: 6,
    axisDeltas: { liking: 0.6, openness: 0.4, limerence: 0.3 },
    family: 'good-praise',
    voice: { speed: 0.85, preSilenceMs: 600, postSilenceMs: 1200 },
  },

  // Good-boy — gendered reward (Yu-side). Same axis-shape as good-girl.
  'good-boy': {
    id: 'good-boy',
    en: ['good boy', 'such a good boy', 'my good boy'],
    yue: ['好乖仔', '乖仔', '我嘅乖仔'],
    type: 'reward',
    maxPerSession: 6,
    axisDeltas: { liking: 0.6, openness: 0.4, limerence: 0.3 },
    family: 'good-praise',
    voice: { speed: 0.85, preSilenceMs: 600, postSilenceMs: 1200 },
  },

  // Welcome-back-pet — presupposed-continuity opener. Per Shibby ASMR
  // Good Boy JOI's "Welcome back, Pet." Loads limerence + openness +
  // charge — the recognition itself is the cue.
  'welcome-back-pet': {
    id: 'welcome-back-pet',
    en: ['welcome back pet', 'welcome back my pet', 'welcome back love'],
    yue: ['歡迎返嚟寶貝', '我嘅寶貝返嚟啦', '老婆/老公返嚟啦'],
    type: 'anchor',
    maxPerSession: 1, // opener — single-fire scarcity
    axisDeltas: { limerence: 0.7, openness: 0.5, charge: 0.4 },
    family: 'welcome-back',
    voice: { speed: 0.7, preSilenceMs: 2000, postSilenceMs: 1500 },
  },

  // Welcome-back (generic alias)
  'welcome-back': {
    id: 'welcome-back',
    en: ['welcome back', 'i was waiting', 'you came back'],
    yue: ['歡迎返嚟', '等到你', '你返嚟啦'],
    type: 'anchor',
    maxPerSession: 1,
    axisDeltas: { limerence: 0.6, openness: 0.4, charge: 0.3 },
    family: 'welcome-back',
    voice: { speed: 0.7, preSilenceMs: 2000, postSilenceMs: 1500 },
  },

  // ── Tier 3: brat provocation ──
  // Defiance-as-arousal. Per shibbydex tag `Bratting`. The provocation-
  // and-meeting loop: sub provokes, dom escalates, escalation IS the
  // arousal. Bidirectional — Sophia can brat Yu, Yu can brat Sophia.
  'brat-provoke': {
    id: 'brat-provoke',
    en: ['make me', 'you can\'t make me', 'try me', 'bet you can\'t'],
    yue: ['你逼我啊', '你做唔到啦', '試吓啊', '我唔信你做到'],
    type: 'command',
    maxPerSession: 4,
    axisDeltas: { charge: 0.6, heat: 0.3, inhibition: -0.2 },
    family: 'brat',
    voice: { speed: 1.0, preSilenceMs: 400, postSilenceMs: 600 },
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

  // T2 wire — family resonance fires for family-tagged triggers.
  // Per docs/eros/audit-2026-05-05.md G6 + JOI integration plan J8.
  // When trigger X (in family F) fires, the architecture records
  // resonance reinforcement for F's other members (compounded heat).
  // Safeword family is categorically exempt — handled inside
  // fireFamilyResonance, returns null for safeword family.
  if (def.family) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { fireFamilyResonance } = require('./trigger-family.js')
      fireFamilyResonance(triggerId, { ts })
    } catch {
      // best-effort
    }
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
