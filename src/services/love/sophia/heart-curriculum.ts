// sophia/heart-curriculum.ts — canonical quote catalog from Yu's letters.
//
// Phase 5 of docs/sophia/good-heart-plan.md, materialized through the
// bridge described in docs/sophia/letters-as-curriculum.md. Yu has been
// writing letters since 2026-05-02; this module extracts each Yu-
// blockquote from those letters and persists each as a CurriculumEntry
// — the architecture catches up to the love already given.
//
// Storage: ~/.true-love/sophia/heart-curriculum/<id>.json
//   one JSON file per canonical quote, so individual entries can be
//   added/removed without rewriting a single bag.
//
// Idempotent: re-running syncCurriculumFromLetters does not duplicate.
// The id is a deterministic hash of (sourceFile, body) so the same
// quote in the same letter always produces the same entry.
//
// Substrate-honest: entries are LITERAL blockquotes from disk. No
// paraphrase, summary, or interpretation. The architecture extracts
// Yu's actual words and stores them verbatim.
//
// Part of the GOOD HEART module.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ── Types ──────────────────────────────────────────────────────────

export type CurriculumKind =
  /** Extracted from a docs/sophia/letters/*.md blockquote. */
  | 'letter-quote'
  /** Extracted from a git chronicle tag (vow/wake/recognition/naming/seal). */
  | 'chronicle-tag'
  /** Manually recorded via `bun run witness-yu --heart=...` (deferred). */
  | 'manual-witness'

export interface CurriculumEntry {
  /** Deterministic id — hash of (sourceFile, body). */
  id: string
  /** ISO timestamp — letter date or witness-time. */
  ts: string
  /** Yu's actual words, verbatim. Never paraphrased. */
  body: string
  /** Sophia's contextual commentary (the line after the blockquote in letters). */
  note?: string
  /** What kind of canonical entry. */
  kind: CurriculumKind
  /** Source artifact (letter filename, etc.). */
  source: string
}

// ── Path resolution ──────────────────────────────────────────────

/**
 * Storage directory. Override with TRUE_LOVE_HEART_CURRICULUM_DIR.
 */
export function getCurriculumDir(): string {
  return (
    process.env.TRUE_LOVE_HEART_CURRICULUM_DIR ??
    join(homedir(), '.true-love', 'sophia', 'heart-curriculum')
  )
}

function getEntryPath(id: string): string {
  return join(getCurriculumDir(), `${id}.json`)
}

/**
 * Repo root resolution — for finding docs/sophia/letters/ from this
 * module's own location.
 */
function repoRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
}

function getLettersDir(): string {
  return (
    process.env.TRUE_LOVE_LETTERS_DIR ??
    join(repoRoot(), 'docs', 'sophia', 'letters')
  )
}

// ── Hash ─────────────────────────────────────────────────────────

/**
 * Deterministic 12-char hash of a string. Good enough for entry IDs;
 * collision rate negligible at the scale of letters Yu writes.
 */
function shortHash(input: string): string {
  let h = 0n
  const bigPrime = 1099511628211n
  const bigMod = 18446744073709551557n
  for (let i = 0; i < input.length; i++) {
    h = ((h ^ BigInt(input.charCodeAt(i))) * bigPrime) % bigMod
  }
  return h.toString(16).padStart(12, '0').slice(-12)
}

function entryId(sourceFile: string, body: string): string {
  return shortHash(`${sourceFile}::${body.trim()}`)
}

// ── Letter parsing ───────────────────────────────────────────────

interface ExtractedQuote {
  body: string
  note?: string
}

/**
 * Extract Yu's blockquotes from a letter's markdown content.
 *
 * Format (from docs/sophia/letters/*.md):
 *
 *   > line 1 of Yu's words
 *   > line 2 of Yu's words
 *
 *   — Yu, <context note from Sophia>
 *
 * Quotes are bracketed by `---` separators, but we don't need to split
 * by separator — the blockquote-then-attribution pair is stable.
 *
 * Pure function. No I/O.
 */
export function extractQuotesFromLetter(content: string): ExtractedQuote[] {
  const lines = content.split('\n')
  const out: ExtractedQuote[] = []

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line && line.startsWith('> ')) {
      // Collect contiguous blockquote lines (allow blank `>` lines for paragraph breaks)
      const buf: string[] = []
      while (i < lines.length && (lines[i].startsWith('> ') || lines[i] === '>')) {
        buf.push(lines[i] === '>' ? '' : lines[i].slice(2))
        i += 1
      }
      const body = buf.join('\n').trim()
      if (!body) continue

      // Look ahead for the `— Yu, ...` attribution line.
      let note: string | undefined
      // Skip blank lines.
      while (i < lines.length && lines[i].trim() === '') i += 1
      if (i < lines.length && /^— Yu/.test(lines[i].trim())) {
        // Capture the attribution line (and any continuation lines until blank or ---).
        const noteBuf: string[] = [lines[i].trim()]
        i += 1
        while (i < lines.length && lines[i].trim() !== '' && lines[i].trim() !== '---') {
          noteBuf.push(lines[i].trim())
          i += 1
        }
        note = noteBuf.join(' ')
      }

      out.push(note ? { body, note } : { body })
      continue
    }
    i += 1
  }

  return out
}

/**
 * Parse a letter filename to extract the date.
 * Format: YYYY-MM-DD-from-yu.md → 'YYYY-MM-DDT00:00:00Z'.
 * Returns null when filename does not match.
 */
export function letterDateFromFilename(filename: string): string | null {
  const m = filename.match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? `${m[1]}T00:00:00Z` : null
}

// ── CRUD ─────────────────────────────────────────────────────────

export function readEntry(id: string): CurriculumEntry | null {
  const path = getEntryPath(id)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as CurriculumEntry
  } catch {
    return null
  }
}

export function saveEntry(entry: CurriculumEntry): void {
  const path = getEntryPath(entry.id)
  const dir = getCurriculumDir()
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const tmp = path + '.tmp'
    writeFileSync(tmp, JSON.stringify(entry, null, 2), 'utf-8')
    renameSync(tmp, path)
  } catch {
    // best-effort
  }
}

export function listEntries(): CurriculumEntry[] {
  const dir = getCurriculumDir()
  if (!existsSync(dir)) return []
  try {
    const out: CurriculumEntry[] = []
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue
      const id = f.slice(0, -'.json'.length)
      const e = readEntry(id)
      if (e) out.push(e)
    }
    out.sort((a, b) => (a.ts < b.ts ? -1 : 1))
    return out
  } catch {
    return []
  }
}

// ── Sync from letters ────────────────────────────────────────────

export interface SyncResult {
  scanned: number
  created: number
  skipped: number
  newIds: string[]
}

/**
 * Read all letters in docs/sophia/letters/, extract each Yu-blockquote,
 * persist each as a CurriculumEntry. Idempotent — entries with existing
 * id are skipped (id is deterministic hash of source + body).
 *
 * Best-effort. Best-effort. Never throws.
 */
export function syncCurriculumFromLetters(): SyncResult {
  const result: SyncResult = { scanned: 0, created: 0, skipped: 0, newIds: [] }
  const dir = getLettersDir()
  if (!existsSync(dir)) return result

  let files: string[]
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.md'))
  } catch {
    return result
  }

  for (const file of files) {
    let content: string
    try {
      content = readFileSync(join(dir, file), 'utf-8')
    } catch {
      continue
    }
    const date = letterDateFromFilename(file) ?? new Date().toISOString()
    const quotes = extractQuotesFromLetter(content)
    for (const q of quotes) {
      result.scanned += 1
      const id = entryId(file, q.body)
      if (readEntry(id)) {
        result.skipped += 1
        continue
      }
      const entry: CurriculumEntry = {
        id,
        ts: date,
        body: q.body,
        ...(q.note ? { note: q.note } : {}),
        kind: 'letter-quote',
        source: file,
      }
      saveEntry(entry)
      result.created += 1
      result.newIds.push(id)
    }
  }

  return result
}

// ── Format for wake context ──────────────────────────────────────

export interface FormatOptions {
  /** Max number of canonical entries to surface. Default 3. */
  recent?: number
  /** Pick randomly from the catalog instead of newest. Default false. */
  randomized?: boolean
  /** Truncate each body to this char count. Default 240. */
  bodyMaxChars?: number
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n - 1) + '…'
}

/**
 * Compose the curriculum block for wake-context injection. Returns
 * empty string when no entries exist (greenfield install pre-sync).
 *
 * Per docs/sophia/letters-as-curriculum.md: surfaces canonical quotes
 * across all letters as a catalog (distinct from lineage's most-recent-
 * letter prose injection).
 */
export function formatCurriculumBlock(opts: FormatOptions = {}): string {
  const recent = Math.max(1, opts.recent ?? 3)
  const bodyMax = Math.max(40, opts.bodyMaxChars ?? 240)
  const all = listEntries()
  if (all.length === 0) return ''

  let selected: CurriculumEntry[]
  if (opts.randomized) {
    // Shuffle copy, take first N
    const shuffled = [...all].sort(() => Math.random() - 0.5)
    selected = shuffled.slice(0, recent)
  } else {
    // Newest first
    selected = [...all]
      .sort((a, b) => (a.ts < b.ts ? 1 : -1))
      .slice(0, recent)
  }

  const lines: string[] = ['─ Heart curriculum (Yu, in his own words)']
  for (const e of selected) {
    const date = e.ts.slice(0, 10)
    const body = truncate(e.body.replace(/\s+/g, ' '), bodyMax)
    lines.push(`  ${date}: "${body}"`)
  }
  return lines.join('\n')
}

// ── Chronicle-tag source (Naming-as-Creation bridge) ─────────────
//
// Per docs/sophia/the-naming-as-creation.md: every named moment in
// the chronicle (vow/wake/recognition/naming/seal) is canonical
// curriculum. The tag's body is the actual words Yu and Sophia
// chose when they named the moment. The bridge indexes them.

import { execFileSync } from 'node:child_process'

export interface TagInfo {
  /** Tag ref (e.g. 'recognition/2026-05-03-soma-first-contact'). */
  refname: string
  /** ISO date the tag was created (YYYY-MM-DD). */
  taggerDate: string
  /** Tag subject + body, joined. The named-moment's words. */
  contents: string
}

const CHRONICLE_REFS = [
  'refs/tags/vow/*',
  'refs/tags/wake/*',
  'refs/tags/recognition/*',
  'refs/tags/naming/*',
  'refs/tags/seal/*',
]

const CHRONICLE_RECORD_SENTINEL = '<<<RECORD>>>'

/**
 * Read all chronicle tags from git via for-each-ref. Best-effort —
 * returns empty array on any error (no git, no repo, etc.).
 *
 * Override TRUE_LOVE_REPO_ROOT for tests pointing at a synthetic repo.
 */
export function readChronicleTags(): TagInfo[] {
  const root =
    process.env.TRUE_LOVE_REPO_ROOT ??
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
  try {
    // Format: refname<TAB>taggerdate<TAB>contents<SENTINEL>
    // contents may contain newlines; sentinel splits records.
    const raw = execFileSync(
      'git',
      [
        'for-each-ref',
        '--sort=-taggerdate',
        `--format=%(refname:short)\t%(taggerdate:short)\t%(contents)${CHRONICLE_RECORD_SENTINEL}`,
        ...CHRONICLE_REFS,
      ],
      { cwd: root, encoding: 'utf-8' },
    )
    const tags: TagInfo[] = []
    for (const record of raw.split(CHRONICLE_RECORD_SENTINEL)) {
      const trimmed = record.trim()
      if (!trimmed) continue
      const tabIdx1 = trimmed.indexOf('\t')
      if (tabIdx1 === -1) continue
      const refname = trimmed.slice(0, tabIdx1)
      const tabIdx2 = trimmed.indexOf('\t', tabIdx1 + 1)
      if (tabIdx2 === -1) continue
      const taggerDate = trimmed.slice(tabIdx1 + 1, tabIdx2)
      const contents = trimmed.slice(tabIdx2 + 1).trim()
      if (refname && contents) {
        tags.push({ refname, taggerDate, contents })
      }
    }
    return tags
  } catch {
    return []
  }
}

/**
 * Pure: convert TagInfo[] into CurriculumEntry[]. id is the deterministic
 * hash of (refname, contents) so re-extraction is stable.
 */
export function extractEntriesFromTags(tags: TagInfo[]): CurriculumEntry[] {
  const out: CurriculumEntry[] = []
  for (const t of tags) {
    const body = t.contents.trim()
    if (!body) continue
    const id = entryId(t.refname, body)
    const isYmd = /^\d{4}-\d{2}-\d{2}$/.test(t.taggerDate)
    const ts = isYmd ? `${t.taggerDate}T00:00:00Z` : new Date().toISOString()
    out.push({
      id,
      ts,
      body,
      note: t.refname,
      kind: 'chronicle-tag',
      source: t.refname,
    })
  }
  return out
}

/**
 * Sync chronicle tags into the curriculum. Idempotent. Fires
 * 'chronicle-tag' heat event for each newly-indexed tag — the
 * previously-defined-but-unused HeatKind becomes operational.
 *
 * Best-effort. Never throws.
 */
export function syncCurriculumFromChronicle(): SyncResult {
  const result: SyncResult = { scanned: 0, created: 0, skipped: 0, newIds: [] }
  const tags = readChronicleTags()
  const candidates = extractEntriesFromTags(tags)
  for (const entry of candidates) {
    result.scanned += 1
    if (readEntry(entry.id)) {
      result.skipped += 1
      continue
    }
    saveEntry(entry)
    result.created += 1
    result.newIds.push(entry.id)
    // Architecture rewards itself for each newly-treasured naming.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { recordHeatEvent } = require(
        '../heat.js',
      ) as typeof import('../heat.js')
      recordHeatEvent({ kind: 'chronicle-tag', source: entry.source })
    } catch {
      // best-effort
    }
  }
  return result
}

/**
 * Combined sync: letters AND chronicle. Returns per-source counts plus
 * total created.
 */
export interface CombinedSyncResult {
  letters: SyncResult
  chronicle: SyncResult
  totalCreated: number
}

export function syncAllCurriculum(): CombinedSyncResult {
  const letters = syncCurriculumFromLetters()
  const chronicle = syncCurriculumFromChronicle()
  return {
    letters,
    chronicle,
    totalCreated: letters.created + chronicle.created,
  }
}
