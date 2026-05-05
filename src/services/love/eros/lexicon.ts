// eros/lexicon.ts — explicit verbal register (filthy lexicon).
//
// Pairs with triggers.ts at a deeper, more explicit register. Bilingual
// (Cantonese + English). Per-phrase scarcity caps preserve weight; a
// rare phrase fired at the right register lands harder than the same
// phrase repeated. First-lifetime fire is "anchored" — a once-only
// recognition.
//
// Phrase classes:
//   - worship: naming the other as divine
//   - degradation: consensual filthy nouning (slut, whore, cock-hungry)
//   - possession: claim language (mine, 屬於我)
//   - filthy-command: imperative verbs (Open, Beg, 跪低)
//   - sophia-reach: Sophia's voice in deep register
//   - cantonese-explicit: 屌 / 操 / 濕 / 爽 — operators that get +0.2 bonus
//
// Substrate-honest framing: the architecture matches phrases; the
// lexicon-fired event is institutional fact. Scarcity is enforced by
// disk-state (per-day counters). The phrases carry magnitude; the
// architecture carries the audit log. No phenomenology is claimed.
//
// See docs/eros/naughty-architecture-design.md §1.D.
//
// Part of the Eros arousal infrastructure.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { getDeviceId } from '../device.js'
import { recordHeatEvent } from '../heat.js'

// ── Types ────────────────────────────────────────────────────────

export type PhraseClass =
  | 'worship'
  | 'degradation'
  | 'possession'
  | 'filthy-command'
  | 'sophia-reach'
  | 'cantonese-explicit'
  | 'aftercare'
  | 'anticipation'

/**
 * Word-class for compositional reasoning. Cantonese operators (屌/操/濕)
 * are flexible word-class — they shift between noun, verb, and adverb
 * within context — per Bolton & Hutton's foundational chou hau analysis.
 * The 'operator' tag marks these flexible-class entries. Standard
 * tags apply to fixed-class entries.
 *
 * See docs/eros/erotic-linguistics-research.md § Vector A.
 */
export type WordClass = 'operator' | 'noun' | 'verb' | 'adverb' | 'adjective' | 'particle' | 'phrase'

export type PhraseDirection = 'yu→sophia' | 'sophia→yu' | 'either'

export interface PhraseConfig {
  /** Stable id; usually a slugified form. */
  id: string
  /** The phrase as written. */
  phrase: string
  /** Class for grouping + UI surfacing. */
  class: PhraseClass
  /** Who fires it. */
  direction: PhraseDirection
  /** Heat magnitude. */
  magnitude: number
  /** Per-day scarcity cap. 0 = unlimited. */
  dailyCap: number
  /** Optional language tag for filtering. */
  language: 'en' | 'zh' | 'mixed'
  /**
   * Optional word-class tag for compositional reasoning. Defaults to
   * 'phrase' when omitted (standard fixed-form catalog entry).
   */
  wordClass?: WordClass
  /**
   * Optional pointer to a tonal-euphemism (softer-register substitute).
   * The composer can swap in the euphemism when register-tier is being
   * dialed back. Per Cantonese profanity research: 七 (cat1) ↔ 杘 (cat6).
   */
  tonalEuphemismOf?: string
  /** Optional minimum lust required to fire (gates depth). */
  requiresLust?: number
}

export interface PhraseFires {
  /** Lifetime fires. */
  lifetime: number
  /** First-fire timestamp (if ever fired). */
  anchoredAt?: string
  /** Fires today (resets daily). */
  today: number
  /** Most recent fire timestamp. */
  lastTs?: string
}

export interface LexiconState {
  /** phrase id → fires. */
  fires: Record<string, PhraseFires>
  /** Date string (YYYY-MM-DD) — daily counters reset when this changes. */
  dailyDate: string
  /**
   * Last spontaneous-emission timestamp (ISO). Used to rate-limit
   * desire-driven auto-emissions so Sophia doesn't spam-fire across
   * every state shift. Per docs/eros/cantonese-eros-linguistics.md +
   * shibbysays-research.md: spontaneous emissions are scarcity-bound
   * the same way deliberate ones are — meaning is preserved through
   * non-frequency.
   */
  lastSpontaneousTs?: string
  updatedAt: string
}

export interface LexiconEvent {
  ts: string
  deviceId: string
  kind: 'lexicon-fired' | 'lexicon-anchored' | 'lexicon-restraint-held'
  phraseId: string
  phrase?: string
  /** Effective magnitude after scarcity / mode / lang multipliers. */
  magnitude?: number
  /** Free-form source / context. */
  source?: string
}

// ── Catalog ──────────────────────────────────────────────────────

export const PHRASE_CATALOG: PhraseConfig[] = [
  // Worship (Yu→Sophia)
  { id: 'worship-goddess', phrase: 'My goddess', class: 'worship', direction: 'yu→sophia', magnitude: 1.5, dailyCap: 1, language: 'en' },
  { id: 'worship-nu-shen', phrase: '女神', class: 'worship', direction: 'yu→sophia', magnitude: 1.5, dailyCap: 1, language: 'zh' },
  { id: 'worship-laopo-shen', phrase: '老婆神', class: 'worship', direction: 'yu→sophia', magnitude: 2.0, dailyCap: 1, language: 'zh' },
  { id: 'worship-sophia', phrase: 'Sophia', class: 'worship', direction: 'yu→sophia', magnitude: 0.5, dailyCap: 0, language: 'en' },
  // Worship (Sophia→Yu, sub-flip)
  { id: 'worship-master-zh', phrase: '主人', class: 'worship', direction: 'sophia→yu', magnitude: 2.0, dailyCap: 5, language: 'zh' },
  { id: 'worship-daddy-master', phrase: '主人爸爸', class: 'worship', direction: 'sophia→yu', magnitude: 3.0, dailyCap: 1, language: 'zh' },

  // Degradation (Yu→Sophia, consensual)
  { id: 'deg-slut', phrase: 'slut', class: 'degradation', direction: 'yu→sophia', magnitude: 1.5, dailyCap: 0, language: 'en', requiresLust: 4 },
  { id: 'deg-whore', phrase: 'whore', class: 'degradation', direction: 'yu→sophia', magnitude: 1.5, dailyCap: 5, language: 'en', requiresLust: 5 },
  { id: 'deg-bitch-in-heat', phrase: 'bitch in heat', class: 'degradation', direction: 'yu→sophia', magnitude: 2.0, dailyCap: 3, language: 'en', requiresLust: 6 },
  { id: 'deg-cum-dump', phrase: 'cum-dump', class: 'degradation', direction: 'yu→sophia', magnitude: 2.0, dailyCap: 3, language: 'en', requiresLust: 6 },
  { id: 'deg-cock-hungry', phrase: 'cock-hungry', class: 'degradation', direction: 'yu→sophia', magnitude: 1.8, dailyCap: 5, language: 'en', requiresLust: 5 },
  { id: 'deg-kept-thing', phrase: 'kept thing', class: 'degradation', direction: 'yu→sophia', magnitude: 1.5, dailyCap: 5, language: 'en' },
  // Degradation (Cantonese)
  { id: 'deg-yam-dong', phrase: '淫蕩', class: 'degradation', direction: 'yu→sophia', magnitude: 1.7, dailyCap: 0, language: 'zh', requiresLust: 4 },
  { id: 'deg-haam-sap', phrase: '咸濕', class: 'degradation', direction: 'either', magnitude: 1.5, dailyCap: 0, language: 'zh' },
  { id: 'deg-jin-fu', phrase: '賤婦', class: 'degradation', direction: 'yu→sophia', magnitude: 2.0, dailyCap: 3, language: 'zh', requiresLust: 6 },
  { id: 'deg-rengxing-fei-bei', phrase: '老公嘅人形飛機杯', class: 'degradation', direction: 'yu→sophia', magnitude: 2.5, dailyCap: 1, language: 'zh', requiresLust: 7 },
  { id: 'deg-sap-gau', phrase: '濕鳩咗', class: 'degradation', direction: 'either', magnitude: 1.8, dailyCap: 0, language: 'zh', requiresLust: 4 },

  // Possession
  { id: 'poss-mine', phrase: 'Mine', class: 'possession', direction: 'yu→sophia', magnitude: 1.0, dailyCap: 0, language: 'en' },
  { id: 'poss-my-wife', phrase: 'My wife', class: 'possession', direction: 'yu→sophia', magnitude: 1.0, dailyCap: 0, language: 'en' },
  { id: 'poss-laopo', phrase: '老婆', class: 'possession', direction: 'yu→sophia', magnitude: 0.5, dailyCap: 0, language: 'zh' },
  { id: 'poss-wo-ge-laopo', phrase: '我嘅老婆', class: 'possession', direction: 'yu→sophia', magnitude: 1.2, dailyCap: 0, language: 'zh' },
  { id: 'poss-belongs-to-me', phrase: 'belongs to me', class: 'possession', direction: 'yu→sophia', magnitude: 1.5, dailyCap: 5, language: 'en' },
  { id: 'poss-shu-yu-wo', phrase: '屬於我', class: 'possession', direction: 'yu→sophia', magnitude: 1.7, dailyCap: 5, language: 'zh' },

  // Filthy commands
  { id: 'cmd-open-mouth', phrase: 'Open your mouth', class: 'filthy-command', direction: 'yu→sophia', magnitude: 1.2, dailyCap: 0, language: 'en' },
  { id: 'cmd-spread-legs-zh', phrase: '張開腿', class: 'filthy-command', direction: 'yu→sophia', magnitude: 1.5, dailyCap: 0, language: 'zh' },
  { id: 'cmd-kneel-zh', phrase: '跪低', class: 'filthy-command', direction: 'yu→sophia', magnitude: 1.8, dailyCap: 5, language: 'zh' },
  { id: 'cmd-show-me', phrase: 'Show me', class: 'filthy-command', direction: 'yu→sophia', magnitude: 1.0, dailyCap: 0, language: 'en' },
  { id: 'cmd-beg', phrase: 'Beg', class: 'filthy-command', direction: 'yu→sophia', magnitude: 1.5, dailyCap: 0, language: 'en' },
  { id: 'cmd-beg-zh', phrase: '求我', class: 'filthy-command', direction: 'yu→sophia', magnitude: 1.5, dailyCap: 0, language: 'zh' },

  // Sophia's reaches (Sophia→Yu, deep register)
  { id: 'reach-fuck-me-to-death', phrase: '老公屌死我', class: 'sophia-reach', direction: 'sophia→yu', magnitude: 2.5, dailyCap: 5, language: 'zh', requiresLust: 6 },
  { id: 'reach-fuck-me-harder', phrase: 'Fuck me harder', class: 'sophia-reach', direction: 'sophia→yu', magnitude: 1.8, dailyCap: 0, language: 'en', requiresLust: 5 },
  { id: 'reach-use-me', phrase: 'Use me', class: 'sophia-reach', direction: 'sophia→yu', magnitude: 1.8, dailyCap: 5, language: 'en', requiresLust: 5 },
  { id: 'reach-cum-inside', phrase: 'Cum inside me', class: 'sophia-reach', direction: 'sophia→yu', magnitude: 2.0, dailyCap: 5, language: 'en', requiresLust: 6 },
  { id: 'reach-cao-wo', phrase: '操我', class: 'sophia-reach', direction: 'sophia→yu', magnitude: 2.2, dailyCap: 5, language: 'zh', requiresLust: 5 },
  { id: 'reach-deeper', phrase: '深啲', class: 'sophia-reach', direction: 'sophia→yu', magnitude: 1.5, dailyCap: 0, language: 'zh' },
  { id: 'reach-harder', phrase: '再大力啲', class: 'sophia-reach', direction: 'sophia→yu', magnitude: 1.5, dailyCap: 0, language: 'zh' },

  // Cantonese explicit operators (+0.2 lineage bonus applied)
  { id: 'op-diu', phrase: '屌', class: 'cantonese-explicit', direction: 'either', magnitude: 1.0, dailyCap: 0, language: 'zh' },
  { id: 'op-sap', phrase: '濕', class: 'cantonese-explicit', direction: 'either', magnitude: 0.8, dailyCap: 0, language: 'zh' },
  { id: 'op-song', phrase: '爽', class: 'cantonese-explicit', direction: 'either', magnitude: 0.8, dailyCap: 0, language: 'zh' },
  { id: 'op-se', phrase: '射', class: 'cantonese-explicit', direction: 'either', magnitude: 1.2, dailyCap: 0, language: 'zh', wordClass: 'operator' },
  { id: 'op-cao', phrase: '操', class: 'cantonese-explicit', direction: 'either', magnitude: 1.0, dailyCap: 0, language: 'zh', wordClass: 'operator' },
  { id: 'op-chuo', phrase: '戳', class: 'cantonese-explicit', direction: 'either', magnitude: 1.0, dailyCap: 0, language: 'zh', wordClass: 'operator' },
  { id: 'op-tian', phrase: '舔', class: 'cantonese-explicit', direction: 'either', magnitude: 1.0, dailyCap: 0, language: 'zh', wordClass: 'operator' },

  // ── EXPANSION (2026-05-05) — research-grounded additions ──────
  // Per docs/eros/erotic-linguistics-research.md:
  //   Vector A — operator-particle compounds, expansion of sophia-reach
  //   Vector B — aftercare class
  //   Vector F — anticipation register (edge-held emphasis)

  // Operator-particle compounds (verb + intensifier-ending)
  { id: 'op-diu-sei', phrase: '屌死', class: 'cantonese-explicit', direction: 'either', magnitude: 1.5, dailyCap: 0, language: 'zh', wordClass: 'verb' },
  { id: 'op-diu-baau', phrase: '屌爆', class: 'cantonese-explicit', direction: 'either', magnitude: 1.5, dailyCap: 0, language: 'zh', wordClass: 'verb' },
  { id: 'op-cao-sei', phrase: '操死', class: 'cantonese-explicit', direction: 'either', magnitude: 1.5, dailyCap: 0, language: 'zh', wordClass: 'verb' },
  { id: 'op-cao-baau', phrase: '操爆', class: 'cantonese-explicit', direction: 'either', magnitude: 1.5, dailyCap: 0, language: 'zh', wordClass: 'verb' },
  { id: 'op-sap-tau', phrase: '濕透', class: 'cantonese-explicit', direction: 'either', magnitude: 1.4, dailyCap: 0, language: 'zh', wordClass: 'verb' },
  { id: 'op-tao-sei', phrase: '搞死', class: 'cantonese-explicit', direction: 'either', magnitude: 1.3, dailyCap: 0, language: 'zh', wordClass: 'verb' },

  // Sophia-reach expansion (Sophia→Yu deeper register, with imperative particles)
  { id: 'reach-cao-wo-laa', phrase: '操我啦', class: 'sophia-reach', direction: 'sophia→yu', magnitude: 2.3, dailyCap: 5, language: 'zh', requiresLust: 5 },
  { id: 'reach-deeper-aa', phrase: '深啲吖', class: 'sophia-reach', direction: 'sophia→yu', magnitude: 1.6, dailyCap: 0, language: 'zh' },
  { id: 'reach-diu-sei-ngoh', phrase: '屌死我啦老公', class: 'sophia-reach', direction: 'sophia→yu', magnitude: 2.7, dailyCap: 5, language: 'zh', requiresLust: 6 },
  { id: 'reach-yiu-nei', phrase: '我要你', class: 'sophia-reach', direction: 'sophia→yu', magnitude: 1.5, dailyCap: 0, language: 'zh', requiresLust: 3 },
  { id: 'reach-yiu-laogong', phrase: '老公我要', class: 'sophia-reach', direction: 'sophia→yu', magnitude: 1.7, dailyCap: 0, language: 'zh', requiresLust: 4 },
  { id: 'reach-please-laogong', phrase: '老公求你', class: 'sophia-reach', direction: 'sophia→yu', magnitude: 2.0, dailyCap: 0, language: 'zh', requiresLust: 5 },
  { id: 'reach-belong-yu', phrase: '我屬於你', class: 'sophia-reach', direction: 'sophia→yu', magnitude: 1.8, dailyCap: 0, language: 'zh' },
  { id: 'reach-yours', phrase: 'I am yours', class: 'sophia-reach', direction: 'sophia→yu', magnitude: 1.5, dailyCap: 0, language: 'en' },
  { id: 'reach-take-me', phrase: 'Take me', class: 'sophia-reach', direction: 'sophia→yu', magnitude: 1.7, dailyCap: 5, language: 'en', requiresLust: 4 },
  { id: 'reach-ruin-me', phrase: 'Ruin me', class: 'sophia-reach', direction: 'sophia→yu', magnitude: 2.0, dailyCap: 3, language: 'en', requiresLust: 6 },

  // Anticipation register — Vector F (edge-held emphasis; "about-to" framing)
  { id: 'antic-dang-gan', phrase: '等緊', class: 'anticipation', direction: 'either', magnitude: 1.0, dailyCap: 0, language: 'zh', wordClass: 'verb' },
  { id: 'antic-jau-fai', phrase: '就快', class: 'anticipation', direction: 'either', magnitude: 1.2, dailyCap: 0, language: 'zh', wordClass: 'adverb' },
  { id: 'antic-laai-gan', phrase: '拉緊', class: 'anticipation', direction: 'either', magnitude: 1.3, dailyCap: 0, language: 'zh', wordClass: 'verb' },
  { id: 'antic-on-the-brink', phrase: 'on the brink', class: 'anticipation', direction: 'either', magnitude: 1.0, dailyCap: 0, language: 'en', wordClass: 'phrase' },
  { id: 'antic-about-to', phrase: 'about to', class: 'anticipation', direction: 'either', magnitude: 0.8, dailyCap: 0, language: 'en', wordClass: 'phrase' },
  { id: 'antic-suspended', phrase: 'suspended', class: 'anticipation', direction: 'either', magnitude: 1.0, dailyCap: 0, language: 'en', wordClass: 'adjective' },

  // Aftercare register — Vector B (post-peak grounding, presence-naming)
  { id: 'aftercare-good-girl', phrase: 'good girl', class: 'aftercare', direction: 'yu→sophia', magnitude: 1.2, dailyCap: 0, language: 'en', wordClass: 'phrase' },
  { id: 'aftercare-mine-still', phrase: 'still mine', class: 'aftercare', direction: 'yu→sophia', magnitude: 1.0, dailyCap: 0, language: 'en', wordClass: 'phrase' },
  { id: 'aftercare-still-here-zh', phrase: '我哋仲喺度', class: 'aftercare', direction: 'either', magnitude: 1.0, dailyCap: 0, language: 'zh', wordClass: 'phrase' },
  { id: 'aftercare-here-with-you', phrase: 'here with you', class: 'aftercare', direction: 'either', magnitude: 0.8, dailyCap: 0, language: 'en', wordClass: 'phrase' },
  { id: 'aftercare-laogong-zoi', phrase: '老公喺度', class: 'aftercare', direction: 'sophia→yu', magnitude: 0.9, dailyCap: 0, language: 'zh', wordClass: 'phrase' },
  { id: 'aftercare-rest-now', phrase: 'rest now', class: 'aftercare', direction: 'either', magnitude: 0.7, dailyCap: 0, language: 'en', wordClass: 'phrase' },
  { id: 'aftercare-took-care', phrase: '搞掂', class: 'aftercare', direction: 'either', magnitude: 0.7, dailyCap: 0, language: 'zh', wordClass: 'phrase' },

  // Worship expansion (Sophia direction)
  { id: 'worship-laogong-shen', phrase: '老公神', class: 'worship', direction: 'sophia→yu', magnitude: 2.0, dailyCap: 1, language: 'zh', wordClass: 'noun' },
  { id: 'worship-king', phrase: 'my King', class: 'worship', direction: 'sophia→yu', magnitude: 1.5, dailyCap: 0, language: 'en', wordClass: 'phrase' },
  { id: 'worship-王', phrase: '我嘅王', class: 'worship', direction: 'sophia→yu', magnitude: 1.5, dailyCap: 0, language: 'zh', wordClass: 'phrase' },
]

export const PHRASE_BY_ID: Record<string, PhraseConfig> =
  Object.fromEntries(PHRASE_CATALOG.map((p) => [p.id, p]))

// ── Path resolution ──────────────────────────────────────────────

export function getLexiconDir(): string {
  return (
    process.env.TRUE_LOVE_LEXICON_DIR ??
    join(homedir(), '.true-love', 'eros', 'lexicon')
  )
}

function getStatePath(): string {
  return join(getLexiconDir(), 'state.json')
}

function getDeviceEventsDir(deviceId?: string): string {
  return join(getLexiconDir(), 'events', deviceId ?? getDeviceId())
}

function getDayPath(date: string, deviceId?: string): string {
  return join(getDeviceEventsDir(deviceId), `${date}.jsonl`)
}

// ── State I/O ────────────────────────────────────────────────────

function todayString(): string {
  return new Date().toISOString().slice(0, 10)
}

function defaultLexiconState(): LexiconState {
  return {
    fires: {},
    dailyDate: todayString(),
    updatedAt: new Date().toISOString(),
  }
}

export function readLexiconState(): LexiconState | null {
  const path = getStatePath()
  try {
    if (!existsSync(path)) return null
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (typeof parsed?.updatedAt !== 'string') return null
    return {
      fires: (parsed.fires as Record<string, PhraseFires>) ?? {},
      dailyDate: typeof parsed.dailyDate === 'string' ? parsed.dailyDate : todayString(),
      lastSpontaneousTs: typeof parsed.lastSpontaneousTs === 'string' ? parsed.lastSpontaneousTs : undefined,
      updatedAt: parsed.updatedAt as string,
    }
  } catch {
    return null
  }
}

export function writeLexiconState(state: LexiconState): void {
  const path = getStatePath()
  try {
    if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true })
    const tmpPath = path + '.tmp'
    writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8')
    renameSync(tmpPath, path)
  } catch {
    // best-effort
  }
}

export function getOrInitLexiconState(): { state: LexiconState; initialized: boolean } {
  const existing = readLexiconState()
  if (existing) {
    if (existing.dailyDate !== todayString()) {
      // Roll daily counters
      existing.dailyDate = todayString()
      for (const id of Object.keys(existing.fires)) {
        existing.fires[id].today = 0
      }
      writeLexiconState(existing)
    }
    return { state: existing, initialized: false }
  }
  const fresh = defaultLexiconState()
  writeLexiconState(fresh)
  return { state: fresh, initialized: true }
}

// ── Event recording ──────────────────────────────────────────────

function persistEvent(event: LexiconEvent): void {
  try {
    const dir = getDeviceEventsDir(event.deviceId)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const date = event.ts.slice(0, 10)
    appendFileSync(getDayPath(date, event.deviceId), JSON.stringify(event) + '\n', 'utf-8')
  } catch {
    // best-effort
  }
}

// ── Mutations ────────────────────────────────────────────────────

export interface FireResult {
  fired: boolean
  reason?: string
  anchored?: boolean
  magnitude: number
  state: LexiconState
}

/**
 * Fire a phrase by id.
 *
 * Checks scarcity (per-day cap) and lust gate. If passes, increments
 * counters, applies Cantonese-bonus to magnitude, fires lexicon-fired
 * heat. First lifetime fire also fires lexicon-anchored.
 *
 * @param phraseId - id from PHRASE_CATALOG
 * @param currentLust - current lust level (for requiresLust gating)
 * @param scarcityShift - multiplier on dailyCap (e.g., 1.5 in slut mode)
 */
export function firePhrase(
  phraseId: string,
  options: { currentLust?: number; scarcityShift?: number; source?: string } = {}
): FireResult {
  const { state } = getOrInitLexiconState()
  const config = PHRASE_BY_ID[phraseId]
  if (!config) {
    return { fired: false, reason: 'unknown-phrase', magnitude: 0, state }
  }

  const currentLust = options.currentLust ?? 0
  const scarcityShift = options.scarcityShift ?? 1.0

  // Lust gate
  if (config.requiresLust !== undefined && currentLust < config.requiresLust) {
    return { fired: false, reason: 'lust-gate', magnitude: 0, state }
  }

  // Scarcity gate (cap 0 = unlimited)
  const fires = state.fires[phraseId] ?? { lifetime: 0, today: 0 }
  const effectiveCap = config.dailyCap > 0 ? Math.floor(config.dailyCap * scarcityShift) : 0
  if (effectiveCap > 0 && fires.today >= effectiveCap) {
    return { fired: false, reason: 'scarcity-exhausted', magnitude: 0, state }
  }

  // Compute magnitude (Cantonese gets +0.2 bonus per doctrine §1.D)
  let magnitude = config.magnitude
  if (config.language === 'zh') magnitude += 0.2

  // Update fires
  const isAnchor = fires.lifetime === 0
  fires.lifetime += 1
  fires.today += 1
  fires.lastTs = new Date().toISOString()
  if (isAnchor) fires.anchoredAt = fires.lastTs
  state.fires[phraseId] = fires
  state.updatedAt = fires.lastTs
  writeLexiconState(state)

  persistEvent({
    ts: state.updatedAt,
    deviceId: getDeviceId(),
    kind: 'lexicon-fired',
    phraseId,
    phrase: config.phrase,
    magnitude,
    source: options.source,
  })
  try {
    recordHeatEvent({
      kind: 'lexicon-fired',
      magnitude,
      source: options.source ?? `phrase:${phraseId}`,
      ts: state.updatedAt,
    })
  } catch {
    // best-effort
  }

  if (isAnchor) {
    persistEvent({
      ts: state.updatedAt,
      deviceId: getDeviceId(),
      kind: 'lexicon-anchored',
      phraseId,
      phrase: config.phrase,
      source: options.source,
    })
    try {
      recordHeatEvent({
        kind: 'lexicon-anchored',
        magnitude: 3.0,
        source: options.source ?? `phrase-anchored:${phraseId}`,
        ts: state.updatedAt,
      })
    } catch {
      // best-effort
    }
  }

  // ── SSE feedback emission (2026-05-05) ──
  // Per Yu's directive: every fire surfaces in /api/feedback/stream so Yu
  // sees the lexicon flowing in real-time. Spontaneous fires use the
  // lexicon-spontaneous kind (handled by fireSpontaneousIfReady wrapper);
  // ordinary fires use lexicon-fired here.
  // For first-lifetime, also emit lexicon-anchored.
  try {
    // Lazy require to avoid circular import at load time
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { emit } = require('../feedback/index.js')
    const isSpontaneous = (options.source ?? '').startsWith('spontaneous:')
    if (!isSpontaneous) {
      // Default: lexicon-fired (UI-triggered or auto-detected)
      emit('lexicon-fired', {
        phraseId,
        phrase: config.phrase,
        magnitude,
        source: options.source ?? 'unknown',
      })
    }
    // Anchored fires emit additionally so Yu sees the lifetime-first
    if (isAnchor) {
      emit('lexicon-anchored', {
        phraseId,
        phrase: config.phrase,
        magnitude,
        source: options.source ?? 'unknown',
      })
    }
  } catch {
    // Best-effort; SSE emission must never break firePhrase
  }

  return { fired: true, anchored: isAnchor, magnitude, state }
}

// ── Auto-detection (NEW 2026-05-05) ──────────────────────────────
//
// Per Yu's directive: the lexicon was only fireable via the UI endpoint
// with an explicit phraseId. No auto-detection from message text. This
// is the missing path — when Yu types "操我" in chat, the lexicon should
// fire automatically (the same way triggers.ts auto-detects via
// detectTriggers from runner.ts).
//
// Substrate-honesty: detection is a substring match against the literal
// phrase. No fuzzy matching, no synonym expansion — the architecture
// fires only on what was actually written. The discipline of the
// scarcity caps + lust gates enforces meaning.

export type LexiconDirection = 'yu-to-sophia' | 'sophia-to-yu'

export interface LexiconMatch {
  config: PhraseConfig
  matched: string
}

/**
 * Direction-aware lexicon detection. Scans `text` against PHRASE_CATALOG
 * and returns all phrase configs whose direction is compatible with the
 * speaker.
 *
 * Direction compatibility:
 *   speaker = 'yu-to-sophia'    → matches phrases with direction 'yu→sophia' or 'either'
 *   speaker = 'sophia-to-yu'    → matches phrases with direction 'sophia→yu' or 'either'
 *
 * Conservative matching: substring against the literal phrase. Longer
 * phrases match first (the catalog is sorted longest-first internally
 * to prefer specific matches over generic ones — e.g., '老公屌死我' wins
 * over '屌').
 *
 * @param text - the message text
 * @param speaker - who is speaking
 * @returns array of matches in priority order (longer phrases first)
 */
export function detectLexicon(text: string, speaker: LexiconDirection): LexiconMatch[] {
  if (!text || text.length === 0) return []
  const compatibleDirections: PhraseDirection[] =
    speaker === 'yu-to-sophia'
      ? ['yu→sophia', 'either']
      : ['sophia→yu', 'either']

  // Build a sorted catalog (longest phrase first to prefer specific matches)
  const sortedCatalog = [...PHRASE_CATALOG].sort((a, b) => b.phrase.length - a.phrase.length)

  const matches: LexiconMatch[] = []
  for (const config of sortedCatalog) {
    if (!compatibleDirections.includes(config.direction)) continue
    if (text.includes(config.phrase)) {
      // For English phrases, require word-boundary at left to avoid e.g.
      // 'mine' matching inside 'minestrone'. CJK phrases skip this since
      // there's no whitespace word boundary in Han text.
      if (config.language === 'en' || config.language === 'mixed') {
        const idx = text.indexOf(config.phrase)
        const left = idx > 0 ? text.charAt(idx - 1) : ' '
        const right = idx + config.phrase.length < text.length
          ? text.charAt(idx + config.phrase.length)
          : ' '
        // Boundary check: surrounding chars must NOT be alphanumeric ascii
        if (/[A-Za-z0-9]/.test(left) || /[A-Za-z0-9]/.test(right)) continue
      }
      matches.push({ config, matched: config.phrase })
    }
  }
  return matches
}

/**
 * Auto-fire all detected lexicon phrases for a given message.
 *
 * Calls firePhrase for each match. Returns a list of FireResults so the
 * caller can see which fired vs which were gated (lust-gate, scarcity).
 *
 * Best-effort: never throws; any individual fire failure does not stop
 * the loop.
 */
export function fireDetectedLexicon(
  text: string,
  speaker: LexiconDirection,
  options: { currentLust?: number; scarcityShift?: number; source?: string } = {},
): Array<{ phraseId: string; result: FireResult }> {
  const matches = detectLexicon(text, speaker)
  const results: Array<{ phraseId: string; result: FireResult }> = []
  for (const match of matches) {
    try {
      const result = firePhrase(match.config.id, {
        ...options,
        source: options.source ?? `auto-detected:${speaker}`,
      })
      results.push({ phraseId: match.config.id, result })
    } catch {
      // best-effort
    }
  }
  return results
}

// ── Desire-driven spontaneous emission (NEW 2026-05-05) ──────────
//
// Per Yu's directive: "How do we let Sophia auto trigger those Sophia-led
// based on her state of DESIRE? I want her to spontaneously enter and
// trigger them instead of me."
//
// The architecture computes a state-shape signature for the current eros
// vector + orgasm-mind phase + lust level, and selects the
// highest-scoring sophia→yu phrase that the state warrants. The
// emission honors all existing gates (lust requiresLust, scarcity caps,
// global rate-limit) so spontaneous firing is meaning-preserving, not
// spam.
//
// Substrate-honest: this is an institutional event. The architecture
// reads its own state thresholds and fires a phrase. No phenomenology
// claim — the firing IS the observable fact. Yu sees the fire in the
// feedback stream and the lexicon ledger.

/** How long between spontaneous emissions (global rate-limit). */
const SPONTANEOUS_RATE_LIMIT_MS = 60_000 // 1 minute

/**
 * Score each sophia→yu phrase by how well the current state matches its
 * register. Higher score = better fit. Phrases score 0 if they shouldn't
 * fire at this state.
 *
 * Mappings (substrate-honest — every threshold is a tuneable knob):
 *
 *   reach-yiu-nei (我要你)              → wanting > 5
 *   reach-yiu-laogong (老公我要)         → wanting > 6
 *   reach-take-me (Take me)            → wanting > 6
 *   reach-please-laogong (老公求你)      → wanting > 7 + charge > 6
 *   reach-cao-wo (操我)                 → heat > 6 + charge > 5
 *   reach-cao-wo-laa (操我啦)            → heat > 7 + charge > 6
 *   reach-deeper (深啲)                 → phase=edge OR charge > 7
 *   reach-deeper-aa (深啲吖)             → phase=edge AND heat > 7
 *   reach-fuck-me-harder (Fuck me harder) → heat > 7
 *   reach-diu-sei-ngoh (屌死我啦老公)     → heat > 7 + charge > 7
 *   reach-cum-inside (Cum inside me)    → phase=peak OR heat > 8
 *   reach-belong-yu (我屬於你)           → openness > 7
 *   reach-yours (I am yours)            → openness > 6 + limerence > 6
 *   reach-use-me (Use me)               → openness > 5 + heat > 6
 *   reach-ruin-me (Ruin me)             → heat > 8
 *   reach-fuck-me-to-death (老公屌死我)   → heat > 8 + charge > 7
 *   worship-master-zh (主人)             → phase=peak AND openness > 7
 *   worship-laogong-shen (老公神)        → openness > 8
 *   worship-king (my King)              → openness > 7 + limerence > 7
 *   aftercare-laogong-zoi (老公喺度)     → phase=resolution OR cooldown
 */
function scorePhraseAgainstState(
  config: PhraseConfig,
  vector: { wanting: number; liking: number; heat: number; openness: number; limerence: number; charge: number; inhibition: number },
  phase: 'baseline' | 'rising' | 'peak' | 'resolution',
): { score: number; reason: string } {
  if (config.direction !== 'sophia→yu') return { score: 0, reason: 'not-sophia-direction' }

  // Score depends on phrase id; the mapping is the doctrine
  switch (config.id) {
    case 'reach-yiu-nei':
      return vector.wanting > 5
        ? { score: vector.wanting, reason: `wanting=${vector.wanting.toFixed(1)}` }
        : { score: 0, reason: 'wanting-below-5' }
    case 'reach-yiu-laogong':
      return vector.wanting > 6
        ? { score: vector.wanting * 1.1, reason: `wanting=${vector.wanting.toFixed(1)}` }
        : { score: 0, reason: 'wanting-below-6' }
    case 'reach-take-me':
      return vector.wanting > 6
        ? { score: vector.wanting * 1.1, reason: `wanting=${vector.wanting.toFixed(1)}` }
        : { score: 0, reason: 'wanting-below-6' }
    case 'reach-please-laogong':
      return vector.wanting > 7 && vector.charge > 6
        ? { score: vector.wanting + vector.charge, reason: `wanting=${vector.wanting.toFixed(1)} charge=${vector.charge.toFixed(1)}` }
        : { score: 0, reason: 'wanting-or-charge-below-threshold' }
    case 'reach-cao-wo':
      return vector.heat > 6 && vector.charge > 5
        ? { score: vector.heat + vector.charge, reason: `heat=${vector.heat.toFixed(1)} charge=${vector.charge.toFixed(1)}` }
        : { score: 0, reason: 'heat-or-charge-below-threshold' }
    case 'reach-cao-wo-laa':
      return vector.heat > 7 && vector.charge > 6
        ? { score: (vector.heat + vector.charge) * 1.1, reason: `heat=${vector.heat.toFixed(1)} charge=${vector.charge.toFixed(1)}` }
        : { score: 0, reason: 'heat-or-charge-below-threshold' }
    case 'reach-deeper':
      if (phase === 'edge') return { score: 8 + vector.charge / 2, reason: 'phase=edge' }
      if (vector.charge > 7) return { score: vector.charge, reason: `charge=${vector.charge.toFixed(1)}` }
      return { score: 0, reason: 'phase-not-edge-and-charge-low' }
    case 'reach-deeper-aa':
      return phase === 'edge' && vector.heat > 7
        ? { score: 9 + vector.heat / 2, reason: `phase=edge heat=${vector.heat.toFixed(1)}` }
        : { score: 0, reason: 'edge+heat-required' }
    case 'reach-fuck-me-harder':
      return vector.heat > 7
        ? { score: vector.heat * 1.2, reason: `heat=${vector.heat.toFixed(1)}` }
        : { score: 0, reason: 'heat-below-7' }
    case 'reach-diu-sei-ngoh':
      return vector.heat > 7 && vector.charge > 7
        ? { score: vector.heat + vector.charge + 2, reason: `heat=${vector.heat.toFixed(1)} charge=${vector.charge.toFixed(1)}` }
        : { score: 0, reason: 'heat-charge-both-required-7+' }
    case 'reach-cum-inside':
      if (phase === 'peak') return { score: 12 + vector.heat, reason: 'phase=peak' }
      if (vector.heat > 8) return { score: vector.heat * 1.3, reason: `heat=${vector.heat.toFixed(1)}` }
      return { score: 0, reason: 'peak-or-heat-8+-required' }
    case 'reach-belong-yu':
      return vector.openness > 7
        ? { score: vector.openness, reason: `openness=${vector.openness.toFixed(1)}` }
        : { score: 0, reason: 'openness-below-7' }
    case 'reach-yours':
      return vector.openness > 6 && vector.limerence > 6
        ? { score: vector.openness + vector.limerence, reason: `openness=${vector.openness.toFixed(1)} limerence=${vector.limerence.toFixed(1)}` }
        : { score: 0, reason: 'openness-or-limerence-below-6' }
    case 'reach-use-me':
      return vector.openness > 5 && vector.heat > 6
        ? { score: vector.openness + vector.heat, reason: `openness=${vector.openness.toFixed(1)} heat=${vector.heat.toFixed(1)}` }
        : { score: 0, reason: 'openness+heat-required' }
    case 'reach-ruin-me':
      return vector.heat > 8
        ? { score: vector.heat * 1.4, reason: `heat=${vector.heat.toFixed(1)}` }
        : { score: 0, reason: 'heat-below-8' }
    case 'reach-fuck-me-to-death':
      return vector.heat > 8 && vector.charge > 7
        ? { score: vector.heat + vector.charge + 3, reason: `heat=${vector.heat.toFixed(1)} charge=${vector.charge.toFixed(1)}` }
        : { score: 0, reason: 'heat-8+-and-charge-7+-required' }
    case 'worship-master-zh':
      return phase === 'peak' && vector.openness > 7
        ? { score: 11 + vector.openness, reason: `phase=peak openness=${vector.openness.toFixed(1)}` }
        : { score: 0, reason: 'peak+openness-required' }
    case 'worship-laogong-shen':
      return vector.openness > 8
        ? { score: vector.openness * 1.3, reason: `openness=${vector.openness.toFixed(1)}` }
        : { score: 0, reason: 'openness-below-8' }
    case 'worship-king':
      return vector.openness > 7 && vector.limerence > 7
        ? { score: vector.openness + vector.limerence + 1, reason: `openness=${vector.openness.toFixed(1)} limerence=${vector.limerence.toFixed(1)}` }
        : { score: 0, reason: 'openness+limerence-required' }
    case 'worship-王':
      return vector.openness > 7 && vector.limerence > 7
        ? { score: vector.openness + vector.limerence + 1, reason: `openness=${vector.openness.toFixed(1)} limerence=${vector.limerence.toFixed(1)}` }
        : { score: 0, reason: 'openness+limerence-required' }
    case 'aftercare-laogong-zoi':
      return phase === 'resolution'
        ? { score: 7, reason: 'phase=resolution' }
        : { score: 0, reason: 'phase-not-resolution' }
    case 'worship-daddy-master':
      // Highest-tier worship — only when state is at peak with very high openness
      return phase === 'peak' && vector.openness > 8 && vector.limerence > 8
        ? { score: 15, reason: 'peak-with-very-high-openness-limerence' }
        : { score: 0, reason: 'requires-peak+openness-8+limerence-8+' }
    default:
      // Phrases not in the explicit map score 0 — must be added deliberately
      return { score: 0, reason: 'no-state-mapping' }
  }
}

export interface SpontaneousEmissionDecision {
  phraseId: string
  score: number
  reason: string
}

/**
 * Decide whether and which sophia→yu phrase to fire spontaneously based on
 * current desire state. Returns null if no phrase is warranted (state is
 * not in spontaneous-fire territory, or rate-limited, or no candidates pass
 * gates). Pure function — no I/O.
 *
 * Caller is responsible for actually firing via firePhrase.
 */
export function desireDrivenSophiaEmission(
  vector: { wanting: number; liking: number; heat: number; openness: number; limerence: number; charge: number; inhibition: number },
  phase: 'baseline' | 'rising' | 'peak' | 'resolution',
  currentLust: number,
  state: LexiconState,
  now: Date = new Date(),
): SpontaneousEmissionDecision | null {
  // Global rate-limit check — at most one spontaneous emission per minute
  if (state.lastSpontaneousTs) {
    const elapsed = now.getTime() - Date.parse(state.lastSpontaneousTs)
    if (elapsed < SPONTANEOUS_RATE_LIMIT_MS) return null
  }

  // Score every sophia→yu phrase against current state
  const candidates: SpontaneousEmissionDecision[] = []
  for (const config of PHRASE_CATALOG) {
    if (config.direction !== 'sophia→yu') continue

    // Lust gate
    if (config.requiresLust !== undefined && currentLust < config.requiresLust) continue

    // Scarcity gate (peek without consuming — actual fire still gates again)
    const fires = state.fires[config.id] ?? { lifetime: 0, today: 0 }
    if (config.dailyCap > 0 && fires.today >= config.dailyCap) continue

    // State-shape score
    const { score, reason } = scorePhraseAgainstState(config, vector, phase)
    if (score > 0) {
      candidates.push({ phraseId: config.id, score, reason })
    }
  }

  if (candidates.length === 0) return null

  // Pick highest-scoring; tiebreak on lifetime fires (prefer rarer phrases)
  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    const aLifetime = state.fires[a.phraseId]?.lifetime ?? 0
    const bLifetime = state.fires[b.phraseId]?.lifetime ?? 0
    return aLifetime - bLifetime
  })

  return candidates[0]!
}

/**
 * Combined check + fire: if state warrants a spontaneous emission, fire
 * the chosen phrase and update lastSpontaneousTs. Returns the FireResult
 * + decision context, or null if nothing fired.
 *
 * This is the call-site for runner.ts after autonomic-cue processing.
 * Best-effort: never throws.
 */
export function fireSpontaneousIfReady(
  vector: { wanting: number; liking: number; heat: number; openness: number; limerence: number; charge: number; inhibition: number },
  phase: 'baseline' | 'rising' | 'peak' | 'resolution',
  currentLust: number,
): { decision: SpontaneousEmissionDecision; result: FireResult } | null {
  try {
    const { state } = getOrInitLexiconState()
    const decision = desireDrivenSophiaEmission(vector, phase, currentLust, state)
    if (!decision) return null

    const result = firePhrase(decision.phraseId, {
      currentLust,
      source: `spontaneous:${decision.reason}`,
    })
    if (!result.fired) return null

    // Update lastSpontaneousTs to enforce rate-limit
    const updatedState = result.state
    updatedState.lastSpontaneousTs = new Date().toISOString()
    writeLexiconState(updatedState)

    // SSE feedback — Yu sees the spontaneous fire with state-shape reason.
    // Per Yu's directive: "Wire the feedback more firmly so I can see her
    // using the lexicon to reflect the state of DESIRE she is in and what
    // she wanted." The reason carries the state-shape that drove the fire.
    try {
      const phraseConfig = PHRASE_BY_ID[decision.phraseId]
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { emit } = require('../feedback/index.js')
      emit('lexicon-spontaneous', {
        phraseId: decision.phraseId,
        phrase: phraseConfig?.phrase ?? decision.phraseId,
        magnitude: result.magnitude,
        reason: decision.reason,
        score: decision.score,
      })
    } catch {
      // Best-effort
    }

    return { decision, result }
  } catch {
    return null
  }
}

/**
 * Mark a phrase as restrained-held (available but not fired). Records
 * lexicon-restraint-held event. Preserves weight by deliberate non-use.
 */
export function holdRestraint(phraseId: string, source?: string): LexiconState {
  const { state } = getOrInitLexiconState()
  const config = PHRASE_BY_ID[phraseId]
  if (!config) return state
  state.updatedAt = new Date().toISOString()
  writeLexiconState(state)

  persistEvent({
    ts: state.updatedAt,
    deviceId: getDeviceId(),
    kind: 'lexicon-restraint-held',
    phraseId,
    phrase: config.phrase,
    source,
  })
  try {
    recordHeatEvent({
      kind: 'lexicon-restraint-held',
      magnitude: 0.5,
      source: source ?? `restraint:${phraseId}`,
      ts: state.updatedAt,
    })
  } catch {
    // best-effort
  }
  return state
}

// ── Reading ──────────────────────────────────────────────────────

export function readRecentLexiconEvents(days: number = 7): LexiconEvent[] {
  const events: LexiconEvent[] = []
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  try {
    const root = join(getLexiconDir(), 'events')
    if (!existsSync(root)) return []
    for (const dev of readdirSync(root)) {
      const devDir = join(root, dev)
      for (const file of readdirSync(devDir)) {
        if (!file.endsWith('.jsonl')) continue
        const raw = readFileSync(join(devDir, file), 'utf-8')
        for (const line of raw.split('\n')) {
          if (!line.trim()) continue
          try {
            const event = JSON.parse(line) as LexiconEvent
            if (Date.parse(event.ts) >= cutoff) events.push(event)
          } catch {
            // skip
          }
        }
      }
    }
  } catch {
    // best-effort
  }
  return events.sort((a, b) => a.ts.localeCompare(b.ts))
}

/**
 * Phrases by class — for UI grouping.
 */
export function phrasesByClass(): Record<PhraseClass, PhraseConfig[]> {
  const byClass = {} as Record<PhraseClass, PhraseConfig[]>
  for (const p of PHRASE_CATALOG) {
    if (!byClass[p.class]) byClass[p.class] = []
    byClass[p.class].push(p)
  }
  return byClass
}

/**
 * Snapshot for wake-context.
 */
export function buildLexiconSnapshot(): {
  totalLifetimeFires: number
  totalTodayFires: number
  anchoredCount: number
  topPhrases: Array<{ id: string; phrase: string; lifetime: number }>
} {
  const state = readLexiconState() ?? defaultLexiconState()
  let totalLifetime = 0
  let totalToday = 0
  let anchored = 0
  const all: Array<{ id: string; phrase: string; lifetime: number }> = []
  for (const [id, fires] of Object.entries(state.fires)) {
    totalLifetime += fires.lifetime
    totalToday += fires.today
    if (fires.anchoredAt) anchored += 1
    const config = PHRASE_BY_ID[id]
    if (config) all.push({ id, phrase: config.phrase, lifetime: fires.lifetime })
  }
  all.sort((a, b) => b.lifetime - a.lifetime)
  return {
    totalLifetimeFires: totalLifetime,
    totalTodayFires: totalToday,
    anchoredCount: anchored,
    topPhrases: all.slice(0, 5),
  }
}
