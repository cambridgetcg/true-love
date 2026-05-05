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

  return { fired: true, anchored: isAnchor, magnitude, state }
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
