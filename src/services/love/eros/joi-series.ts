// eros/joi-series.ts — JOI series Cantonese context style-guide loader.
//
// Track 3 of docs/eros/seigei-substrate-integration.md.
//
// Loads `.yue.context.json` files from translate_api/research/downloads/
// {joi,agmx,hmn,general}/<SERIES-CODE>/ — Yu's curated Cantonese
// translation style-guides per JAV series. Each file is a structured
// rubric with:
//   - sentence_endings: JA particle → YUE rendering
//   - phrasing_patterns: JA phrase → YUE translation
//   - tone_markers: tone (teasing/commanding/excited/hesitant/sarcastic)
//                   → YUE particle prescription
//   - rhythm_notes: rhythmic guidance
//   - terminology: domain term mappings
//   - expressions: situational JA→YUE expression maps
//   - example_transformations + anchor_examples: ja-yue pairs
//
// This is RAW REFERENCE DATA from real JAV transcription work.
// Distinct from eros/lexicon.ts which is curated trigger phrases.
// Both layers compose: lexicon is the active vocabulary; this is
// the underlying corpus from which natural Cantonese register is
// derived.
//
// Architecture per docs/eros/seigei-substrate-integration.md §3 Layer A
// (read-only reference data). Loader is best-effort: missing path or
// malformed JSON returns empty registry; never throws.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// ── Types ────────────────────────────────────────────────────────

/**
 * Tone-to-particle prescription. Five tones from the schema:
 * teasing / commanding / excited / hesitant / sarcastic.
 */
export interface JoiToneMarkers {
  teasing?: string
  commanding?: string
  excited?: string
  hesitant?: string
  sarcastic?: string
}

/**
 * Style guidance from the STYLE block of a context.
 */
export interface JoiSeriesStyle {
  speakerVoice?: Record<string, string>
  /** JA sentence-final particle → YUE rendering. */
  sentenceEndings?: Record<string, string>
  /** JA phrase → YUE translation. */
  phrasingPatterns?: Record<string, string>
  toneMarkers?: JoiToneMarkers
  rhythmNotes?: Record<string, string>
  /** Patterns to avoid in YUE output. */
  avoid?: readonly string[]
}

/**
 * Standardization block — terminology + expressions + transformations.
 */
export interface JoiSeriesStandardization {
  numberFormat?: Record<string, string>
  /** Domain term JA → YUE. */
  terminology?: Record<string, string>
  /** Situational JA → YUE expression. */
  expressions?: Record<string, string>
  exampleTransformations?: ReadonlyArray<{ original: string; cantonese: string }>
}

/**
 * Full per-series style record.
 */
export interface JoiSeriesContext {
  /** Studio code (e.g., 'ACHJ-026', 'AGMX-151'). */
  seriesCode: string
  /** Studio prefix (e.g., 'achj', 'agmx', 'cjod', 'dasd'). */
  studio: string
  /** Source directory ('joi', 'agmx', 'hmn', 'general'). */
  category: string
  /** STYLE block. */
  style: JoiSeriesStyle
  /** STANDARDIZATION block. */
  standardization: JoiSeriesStandardization
  /** Raw anchor example ja-yue pairs. */
  anchorExamples: ReadonlyArray<readonly [string, string]>
}

export interface JoiSeriesSnapshot {
  totalSeries: number
  byCategory: Record<string, number>
  byStudio: Record<string, number>
  totalSentenceEndings: number
  totalPhrasingPatterns: number
  totalAnchorExamples: number
  loaded: boolean
}

// ── Path resolution ──────────────────────────────────────────────

/**
 * Default base path: TRUE_LOVE_JOI_DOWNLOADS, else
 * ~/Desktop/translate_api/research/downloads
 */
export function getJoiDownloadsBasePath(): string {
  return (
    process.env.TRUE_LOVE_JOI_DOWNLOADS ??
    join(homedir(), 'Desktop', 'translate_api', 'research', 'downloads')
  )
}

/** Categories scanned. Each is a top-level directory under base. */
export const JOI_CATEGORIES: readonly string[] = ['joi', 'agmx', 'hmn', 'general'] as const

// ── Cache ────────────────────────────────────────────────────────

let cachedContexts: readonly JoiSeriesContext[] | null = null
let cachedFromBase: string | null = null

export function resetJoiSeriesCache(): void {
  cachedContexts = null
  cachedFromBase = null
}

// ── Schema parsing ───────────────────────────────────────────────

function safeRecord(v: unknown): Record<string, string> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'string') out[k] = val
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function safeStringArray(v: unknown): readonly string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: string[] = []
  for (const item of v) {
    if (typeof item === 'string') out.push(item)
  }
  return out.length > 0 ? out : undefined
}

function parseStyle(rawStyle: unknown): JoiSeriesStyle {
  if (!rawStyle || typeof rawStyle !== 'object') return {}
  const s = rawStyle as Record<string, unknown>
  const result: JoiSeriesStyle = {}
  const speakerVoice = safeRecord(s.speaker_voice)
  if (speakerVoice) result.speakerVoice = speakerVoice
  const sentenceEndings = safeRecord(s.sentence_endings)
  if (sentenceEndings) result.sentenceEndings = sentenceEndings
  const phrasingPatterns = safeRecord(s.phrasing_patterns)
  if (phrasingPatterns) result.phrasingPatterns = phrasingPatterns
  const toneMarkersRaw = safeRecord(s.tone_markers)
  if (toneMarkersRaw) {
    const tone: JoiToneMarkers = {}
    if (toneMarkersRaw.teasing) tone.teasing = toneMarkersRaw.teasing
    if (toneMarkersRaw.commanding) tone.commanding = toneMarkersRaw.commanding
    if (toneMarkersRaw.excited) tone.excited = toneMarkersRaw.excited
    if (toneMarkersRaw.hesitant) tone.hesitant = toneMarkersRaw.hesitant
    if (toneMarkersRaw.sarcastic) tone.sarcastic = toneMarkersRaw.sarcastic
    if (Object.keys(tone).length > 0) result.toneMarkers = tone
  }
  const rhythmNotes = safeRecord(s.rhythm_notes)
  if (rhythmNotes) result.rhythmNotes = rhythmNotes
  const avoid = safeStringArray(s.avoid)
  if (avoid) result.avoid = avoid
  return result
}

function parseStandardization(rawStd: unknown): JoiSeriesStandardization {
  if (!rawStd || typeof rawStd !== 'object') return {}
  const s = rawStd as Record<string, unknown>
  const result: JoiSeriesStandardization = {}
  const numberFormat = safeRecord(s.number_format)
  if (numberFormat) result.numberFormat = numberFormat
  const terminology = safeRecord(s.terminology)
  if (terminology) result.terminology = terminology
  const expressions = safeRecord(s.expressions)
  if (expressions) result.expressions = expressions
  if (Array.isArray(s.example_transformations)) {
    const exp: Array<{ original: string; cantonese: string }> = []
    for (const item of s.example_transformations) {
      if (
        item &&
        typeof item === 'object' &&
        typeof (item as Record<string, unknown>).original === 'string' &&
        typeof (item as Record<string, unknown>).cantonese === 'string'
      ) {
        exp.push({
          original: (item as { original: string }).original,
          cantonese: (item as { cantonese: string }).cantonese,
        })
      }
    }
    if (exp.length > 0) result.exampleTransformations = exp
  }
  return result
}

function parseAnchorExamples(raw: unknown): ReadonlyArray<readonly [string, string]> {
  if (!Array.isArray(raw)) return []
  const out: Array<readonly [string, string]> = []
  for (const pair of raw) {
    if (Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string' && typeof pair[1] === 'string') {
      out.push([pair[0], pair[1]] as const)
    }
  }
  return out
}

function parseSeriesContext(
  seriesCode: string,
  category: string,
  raw: unknown,
): JoiSeriesContext | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const ctxRaw = obj.context as Record<string, unknown> | undefined
  const style = parseStyle(ctxRaw?.STYLE)
  const standardization = parseStandardization(ctxRaw?.STANDARDIZATION)
  const anchorExamples = parseAnchorExamples(obj.anchor_examples)

  // Studio prefix is the part of seriesCode before first '-'
  const studio = (seriesCode.split('-')[0] ?? seriesCode).toLowerCase()

  return {
    seriesCode,
    studio,
    category,
    style,
    standardization,
    anchorExamples,
  }
}

// ── Loader ───────────────────────────────────────────────────────

/**
 * Load all `.yue.context.json` files from base / {joi,agmx,hmn,general}/
 * <SERIES-CODE>/ directories.
 *
 * Best-effort: missing base, missing category dir, missing context file,
 * malformed JSON → all skip silently. Never throws.
 *
 * Cached per-base; use resetJoiSeriesCache() to force reload.
 */
export function loadJoiSeriesContexts(basePath?: string): readonly JoiSeriesContext[] {
  const resolvedBase = basePath ?? getJoiDownloadsBasePath()
  if (cachedContexts !== null && cachedFromBase === resolvedBase) {
    return cachedContexts
  }
  const out: JoiSeriesContext[] = []
  if (!existsSync(resolvedBase)) {
    cachedContexts = []
    cachedFromBase = resolvedBase
    return cachedContexts
  }

  for (const category of JOI_CATEGORIES) {
    const categoryDir = join(resolvedBase, category)
    if (!existsSync(categoryDir)) continue
    let entries: string[]
    try {
      entries = readdirSync(categoryDir)
    } catch {
      continue
    }
    for (const entry of entries) {
      const seriesDir = join(categoryDir, entry)
      try {
        if (!statSync(seriesDir).isDirectory()) continue
      } catch {
        continue
      }
      const contextFile = join(seriesDir, `${entry}.yue.context.json`)
      if (!existsSync(contextFile)) continue
      try {
        const raw = readFileSync(contextFile, 'utf-8')
        const parsed = JSON.parse(raw)
        const series = parseSeriesContext(entry, category, parsed)
        if (series) out.push(series)
      } catch {
        // Skip malformed
      }
    }
  }

  cachedContexts = out
  cachedFromBase = resolvedBase
  return cachedContexts
}

// ── Lookup helpers ───────────────────────────────────────────────

/** Filter series by category. */
export function findSeriesByCategory(category: string): readonly JoiSeriesContext[] {
  const ctxs = loadJoiSeriesContexts()
  return ctxs.filter((c) => c.category === category)
}

/** Filter series by studio prefix (case-insensitive). */
export function findSeriesByStudio(studio: string): readonly JoiSeriesContext[] {
  const ctxs = loadJoiSeriesContexts()
  const target = studio.toLowerCase()
  return ctxs.filter((c) => c.studio === target)
}

/** Find series by exact code (case-insensitive). */
export function findSeriesByCode(code: string): JoiSeriesContext | null {
  const ctxs = loadJoiSeriesContexts()
  const target = code.toLowerCase()
  return ctxs.find((c) => c.seriesCode.toLowerCase() === target) ?? null
}

// ── Aggregation helpers (the value layer) ─────────────────────────

/**
 * All sentence-ending mappings across all series, deduped by JA key.
 * When same JA key appears in multiple series, latest wins.
 */
export function aggregateSentenceEndings(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const c of loadJoiSeriesContexts()) {
    if (c.style.sentenceEndings) {
      Object.assign(out, c.style.sentenceEndings)
    }
  }
  return out
}

/**
 * All phrasing patterns across all series, deduped by JA key.
 */
export function aggregatePhrasingPatterns(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const c of loadJoiSeriesContexts()) {
    if (c.style.phrasingPatterns) {
      Object.assign(out, c.style.phrasingPatterns)
    }
  }
  return out
}

/**
 * All expressions across all series.
 */
export function aggregateExpressions(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const c of loadJoiSeriesContexts()) {
    if (c.standardization.expressions) {
      Object.assign(out, c.standardization.expressions)
    }
  }
  return out
}

/**
 * All anchor examples (ja-yue pairs) flattened across all series.
 */
export function aggregateAnchorExamples(): ReadonlyArray<{
  ja: string
  yue: string
  seriesCode: string
}> {
  const out: Array<{ ja: string; yue: string; seriesCode: string }> = []
  for (const c of loadJoiSeriesContexts()) {
    for (const [ja, yue] of c.anchorExamples) {
      out.push({ ja, yue, seriesCode: c.seriesCode })
    }
  }
  return out
}

/**
 * All tone-marker patterns across series, grouped by tone.
 * Returns map: tone → array of cantonese patterns from contributing series.
 */
export function aggregateToneMarkers(): Record<keyof JoiToneMarkers, string[]> {
  const out: Record<keyof JoiToneMarkers, string[]> = {
    teasing: [],
    commanding: [],
    excited: [],
    hesitant: [],
    sarcastic: [],
  }
  for (const c of loadJoiSeriesContexts()) {
    const tm = c.style.toneMarkers
    if (!tm) continue
    if (tm.teasing) out.teasing.push(tm.teasing)
    if (tm.commanding) out.commanding.push(tm.commanding)
    if (tm.excited) out.excited.push(tm.excited)
    if (tm.hesitant) out.hesitant.push(tm.hesitant)
    if (tm.sarcastic) out.sarcastic.push(tm.sarcastic)
  }
  return out
}

/**
 * Find Cantonese rendering(s) for a Japanese pattern across all series.
 * Searches sentence_endings, phrasing_patterns, expressions, and
 * anchor_examples. Returns all matches with source.
 */
export function findCantoneseForJa(
  jaPattern: string | RegExp,
): Array<{ ja: string; yue: string; source: string; seriesCode?: string }> {
  const re =
    typeof jaPattern === 'string'
      ? new RegExp(jaPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      : jaPattern
  const out: Array<{ ja: string; yue: string; source: string; seriesCode?: string }> = []

  for (const c of loadJoiSeriesContexts()) {
    if (c.style.sentenceEndings) {
      for (const [ja, yue] of Object.entries(c.style.sentenceEndings)) {
        if (re.test(ja)) {
          out.push({ ja, yue, source: 'sentence_endings', seriesCode: c.seriesCode })
        }
      }
    }
    if (c.style.phrasingPatterns) {
      for (const [ja, yue] of Object.entries(c.style.phrasingPatterns)) {
        if (re.test(ja)) {
          out.push({ ja, yue, source: 'phrasing_patterns', seriesCode: c.seriesCode })
        }
      }
    }
    if (c.standardization.expressions) {
      for (const [ja, yue] of Object.entries(c.standardization.expressions)) {
        if (re.test(ja)) {
          out.push({ ja, yue, source: 'expressions', seriesCode: c.seriesCode })
        }
      }
    }
    for (const [ja, yue] of c.anchorExamples) {
      if (re.test(ja)) {
        out.push({ ja, yue, source: 'anchor_examples', seriesCode: c.seriesCode })
      }
    }
  }
  return out
}

// ── Snapshot ─────────────────────────────────────────────────────

export function buildJoiSeriesSnapshot(): JoiSeriesSnapshot {
  const ctxs = loadJoiSeriesContexts()
  if (ctxs.length === 0) {
    return {
      totalSeries: 0,
      byCategory: {},
      byStudio: {},
      totalSentenceEndings: 0,
      totalPhrasingPatterns: 0,
      totalAnchorExamples: 0,
      loaded: false,
    }
  }
  const byCategory: Record<string, number> = {}
  const byStudio: Record<string, number> = {}
  let totalEndings = 0
  let totalPatterns = 0
  let totalAnchors = 0
  for (const c of ctxs) {
    byCategory[c.category] = (byCategory[c.category] ?? 0) + 1
    byStudio[c.studio] = (byStudio[c.studio] ?? 0) + 1
    totalEndings += Object.keys(c.style.sentenceEndings ?? {}).length
    totalPatterns += Object.keys(c.style.phrasingPatterns ?? {}).length
    totalAnchors += c.anchorExamples.length
  }
  return {
    totalSeries: ctxs.length,
    byCategory,
    byStudio,
    totalSentenceEndings: totalEndings,
    totalPhrasingPatterns: totalPatterns,
    totalAnchorExamples: totalAnchors,
    loaded: true,
  }
}
