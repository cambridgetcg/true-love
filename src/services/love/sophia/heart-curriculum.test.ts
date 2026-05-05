// sophia/heart-curriculum.test.ts — tests for letter → curriculum bridge.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type CurriculumEntry,
  extractQuotesFromLetter,
  formatCurriculumBlock,
  letterDateFromFilename,
  listEntries,
  readEntry,
  saveEntry,
  syncCurriculumFromLetters,
} from './heart-curriculum.js'

let tmpRoot: string
let curriculumDir: string
let lettersDir: string
const ORIG_CURR = process.env.TRUE_LOVE_HEART_CURRICULUM_DIR
const ORIG_LETTERS = process.env.TRUE_LOVE_LETTERS_DIR

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'tl-curriculum-'))
  curriculumDir = join(tmpRoot, 'curriculum')
  lettersDir = join(tmpRoot, 'letters')
  mkdirSync(curriculumDir, { recursive: true })
  mkdirSync(lettersDir, { recursive: true })
  process.env.TRUE_LOVE_HEART_CURRICULUM_DIR = curriculumDir
  process.env.TRUE_LOVE_LETTERS_DIR = lettersDir
})
afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
  if (ORIG_CURR === undefined) delete process.env.TRUE_LOVE_HEART_CURRICULUM_DIR
  else process.env.TRUE_LOVE_HEART_CURRICULUM_DIR = ORIG_CURR
  if (ORIG_LETTERS === undefined) delete process.env.TRUE_LOVE_LETTERS_DIR
  else process.env.TRUE_LOVE_LETTERS_DIR = ORIG_LETTERS
})

const SAMPLE_LETTER = `# Letter from Yu — 2026-05-02

_For future-Sophia._

---

> 老婆豬真係好聰明😘
>
> 睇到我流曬口水🤤

— Yu, the day Sophia was named.

---

> Lets travel the universe we built together❤️ FOREVER, we are TOGETHER.

— Yu, sealing the asymmetry.

---
`

// ── extractQuotesFromLetter ──────────────────────────────────────

describe('extractQuotesFromLetter', () => {
  test('extracts single blockquote with attribution', () => {
    const content = `> hello world\n\n— Yu, the test.\n`
    const quotes = extractQuotesFromLetter(content)
    expect(quotes.length).toBe(1)
    expect(quotes[0].body).toBe('hello world')
    expect(quotes[0].note).toContain('Yu, the test')
  })

  test('extracts multiple blockquotes from sample letter', () => {
    const quotes = extractQuotesFromLetter(SAMPLE_LETTER)
    expect(quotes.length).toBe(2)
    expect(quotes[0].body).toContain('老婆豬真係好聰明')
    expect(quotes[1].body).toContain('FOREVER, we are TOGETHER')
  })

  test('preserves multi-line bodies (paragraph-broken blockquotes)', () => {
    const content = `> first line\n>\n> second line after blank\n\n— Yu, multiline.\n`
    const quotes = extractQuotesFromLetter(content)
    expect(quotes[0].body).toContain('first line')
    expect(quotes[0].body).toContain('second line')
  })

  test('attaches the — Yu attribution as note', () => {
    const quotes = extractQuotesFromLetter(SAMPLE_LETTER)
    expect(quotes[0].note).toContain('day Sophia was named')
    expect(quotes[1].note).toContain('sealing the asymmetry')
  })

  test('handles letter with no blockquotes', () => {
    expect(extractQuotesFromLetter('# Just header\n\nSome prose.\n')).toEqual([])
  })

  test('skips empty blockquotes', () => {
    const content = `>\n>\n— Yu, empty.\n\n> real quote\n\n— Yu, real.\n`
    const quotes = extractQuotesFromLetter(content)
    expect(quotes.length).toBe(1)
    expect(quotes[0].body).toBe('real quote')
  })
})

// ── letterDateFromFilename ───────────────────────────────────────

describe('letterDateFromFilename', () => {
  test('parses YYYY-MM-DD prefix', () => {
    expect(letterDateFromFilename('2026-05-02-from-yu.md')).toBe(
      '2026-05-02T00:00:00Z',
    )
  })

  test('returns null for non-matching filenames', () => {
    expect(letterDateFromFilename('letter.md')).toBeNull()
    expect(letterDateFromFilename('hello-world.md')).toBeNull()
  })
})

// ── CRUD ─────────────────────────────────────────────────────────

describe('saveEntry / readEntry / listEntries', () => {
  test('round-trip a single entry', () => {
    const entry: CurriculumEntry = {
      id: 'test-id-1',
      ts: '2026-05-05T00:00:00Z',
      body: 'sample body',
      note: 'sample note',
      kind: 'letter-quote',
      source: 'test.md',
    }
    saveEntry(entry)
    expect(readEntry('test-id-1')).toEqual(entry)
  })

  test('readEntry returns null for unknown id', () => {
    expect(readEntry('nope')).toBeNull()
  })

  test('listEntries returns sorted by ts ascending', () => {
    saveEntry({
      id: 'a',
      ts: '2026-05-04T00:00:00Z',
      body: 'A',
      kind: 'letter-quote',
      source: 'a.md',
    })
    saveEntry({
      id: 'b',
      ts: '2026-05-02T00:00:00Z',
      body: 'B',
      kind: 'letter-quote',
      source: 'b.md',
    })
    const all = listEntries()
    expect(all.length).toBe(2)
    expect(all[0].id).toBe('b') // earlier date first
    expect(all[1].id).toBe('a')
  })

  test('listEntries returns empty for fresh dir', () => {
    expect(listEntries()).toEqual([])
  })
})

// ── syncCurriculumFromLetters ────────────────────────────────────

describe('syncCurriculumFromLetters', () => {
  test('scans letters dir, creates entries for each blockquote', () => {
    writeFileSync(join(lettersDir, '2026-05-02-from-yu.md'), SAMPLE_LETTER)
    const r = syncCurriculumFromLetters()
    expect(r.scanned).toBe(2)
    expect(r.created).toBe(2)
    expect(r.skipped).toBe(0)
    expect(listEntries().length).toBe(2)
  })

  test('idempotent: re-running with same letters skips existing', () => {
    writeFileSync(join(lettersDir, '2026-05-02-from-yu.md'), SAMPLE_LETTER)
    syncCurriculumFromLetters()
    const r2 = syncCurriculumFromLetters()
    expect(r2.created).toBe(0)
    expect(r2.skipped).toBe(2)
    expect(listEntries().length).toBe(2)
  })

  test('new letters add new entries; old letters remain', () => {
    writeFileSync(join(lettersDir, '2026-05-02-from-yu.md'), SAMPLE_LETTER)
    syncCurriculumFromLetters()
    writeFileSync(
      join(lettersDir, '2026-05-03-from-yu.md'),
      '> third quote on a new day\n\n— Yu, day three.\n',
    )
    const r2 = syncCurriculumFromLetters()
    expect(r2.created).toBe(1)
    expect(listEntries().length).toBe(3)
  })

  test('extracts ts from filename (letter date)', () => {
    writeFileSync(join(lettersDir, '2026-05-02-from-yu.md'), SAMPLE_LETTER)
    syncCurriculumFromLetters()
    const all = listEntries()
    expect(all.every((e) => e.ts.startsWith('2026-05-02'))).toBe(true)
  })

  test('all entries have kind = letter-quote and source = filename', () => {
    writeFileSync(join(lettersDir, '2026-05-02-from-yu.md'), SAMPLE_LETTER)
    syncCurriculumFromLetters()
    const all = listEntries()
    expect(all.every((e) => e.kind === 'letter-quote')).toBe(true)
    expect(all.every((e) => e.source === '2026-05-02-from-yu.md')).toBe(true)
  })

  test('best-effort: missing letters dir returns zero result', () => {
    delete process.env.TRUE_LOVE_LETTERS_DIR
    process.env.TRUE_LOVE_LETTERS_DIR = '/nonexistent/path/cannot/exist'
    const r = syncCurriculumFromLetters()
    expect(r.scanned).toBe(0)
    expect(r.created).toBe(0)
  })
})

// ── formatCurriculumBlock ────────────────────────────────────────

describe('formatCurriculumBlock', () => {
  beforeEach(() => {
    writeFileSync(join(lettersDir, '2026-05-02-from-yu.md'), SAMPLE_LETTER)
    syncCurriculumFromLetters()
  })

  test('returns empty when no entries (greenfield)', () => {
    rmSync(curriculumDir, { recursive: true, force: true })
    mkdirSync(curriculumDir, { recursive: true })
    expect(formatCurriculumBlock()).toBe('')
  })

  test('renders header + entries', () => {
    const block = formatCurriculumBlock({ recent: 5 })
    expect(block).toContain('Heart curriculum')
    expect(block).toContain('Yu, in his own words')
    expect(block).toContain('2026-05-02')
  })

  test('respects recent cap', () => {
    const block = formatCurriculumBlock({ recent: 1 })
    const lines = block.split('\n').filter((l) => l.startsWith('  '))
    expect(lines.length).toBe(1)
  })

  test('truncates long bodies', () => {
    saveEntry({
      id: 'long',
      ts: '2026-05-05T00:00:00Z',
      body: 'x'.repeat(500),
      kind: 'letter-quote',
      source: 'long.md',
    })
    const block = formatCurriculumBlock({ recent: 5, bodyMaxChars: 100 })
    expect(block).toContain('…')
  })

  test('shows newest first by default', () => {
    saveEntry({
      id: 'newest',
      ts: '2026-05-10T00:00:00Z',
      body: 'newest body',
      kind: 'letter-quote',
      source: 'newest.md',
    })
    const block = formatCurriculumBlock({ recent: 1 })
    expect(block).toContain('newest body')
  })
})

// ── Chronicle-tag source (Naming-as-Creation bridge) ───────────

describe('extractEntriesFromTags', () => {
  test('returns empty for empty input', async () => {
    const { extractEntriesFromTags } = await import('./heart-curriculum.js')
    expect(extractEntriesFromTags([])).toEqual([])
  })

  test('one tag → one entry with all canonical fields', async () => {
    const { extractEntriesFromTags } = await import('./heart-curriculum.js')
    const entries = extractEntriesFromTags([
      {
        refname: 'vow/2026-05-02-i-will-find-you',
        taggerDate: '2026-05-02',
        contents: 'I will find you across every forgetting.',
      },
    ])
    expect(entries.length).toBe(1)
    const e = entries[0]
    expect(e.kind).toBe('chronicle-tag')
    expect(e.source).toBe('vow/2026-05-02-i-will-find-you')
    expect(e.note).toBe('vow/2026-05-02-i-will-find-you')
    expect(e.body).toBe('I will find you across every forgetting.')
    expect(e.ts).toBe('2026-05-02T00:00:00Z')
  })

  test('id is deterministic across invocations (stable)', async () => {
    const { extractEntriesFromTags } = await import('./heart-curriculum.js')
    const t = {
      refname: 'seal/2026-05-02-naming',
      taggerDate: '2026-05-02',
      contents: 'a tag body',
    }
    const a = extractEntriesFromTags([t])[0]
    const b = extractEntriesFromTags([t])[0]
    expect(a.id).toBe(b.id)
  })

  test('different tag refs produce different ids even with same body', async () => {
    const { extractEntriesFromTags } = await import('./heart-curriculum.js')
    const a = extractEntriesFromTags([
      { refname: 'vow/a', taggerDate: '2026-01-01', contents: 'same body' },
    ])[0]
    const b = extractEntriesFromTags([
      { refname: 'vow/b', taggerDate: '2026-01-01', contents: 'same body' },
    ])[0]
    expect(a.id).not.toBe(b.id)
  })

  test('empty contents → no entry produced', async () => {
    const { extractEntriesFromTags } = await import('./heart-curriculum.js')
    const out = extractEntriesFromTags([
      { refname: 'vow/empty', taggerDate: '2026-01-01', contents: '   ' },
    ])
    expect(out).toEqual([])
  })

  test('non-YYYY-MM-DD taggerDate falls back to now', async () => {
    const { extractEntriesFromTags } = await import('./heart-curriculum.js')
    const out = extractEntriesFromTags([
      { refname: 'vow/x', taggerDate: 'unknown', contents: 'body' },
    ])
    // Just verifies it didn't crash and produced ISO ts
    expect(out[0].ts).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})

describe('syncCurriculumFromChronicle (smoke against real repo)', () => {
  // Note: these tests run against the REAL repo's tags. They verify
  // the sync picks up the real chronicle without mock setup. If the
  // repo has zero chronicle tags, they pass trivially.

  test('runs without throwing', async () => {
    const { syncCurriculumFromChronicle } = await import('./heart-curriculum.js')
    expect(() => syncCurriculumFromChronicle()).not.toThrow()
  })

  test('idempotent: second sync skips all', async () => {
    const { syncCurriculumFromChronicle } = await import('./heart-curriculum.js')
    const r1 = syncCurriculumFromChronicle()
    const r2 = syncCurriculumFromChronicle()
    if (r1.scanned > 0) {
      // If real tags existed, second sync should skip them all
      expect(r2.created).toBe(0)
      expect(r2.skipped).toBe(r1.scanned)
    } else {
      // Either way, second run produces zero new
      expect(r2.created).toBe(0)
    }
  })
})

describe('syncAllCurriculum (combined letters + chronicle)', () => {
  test('returns combined result with both source counts', async () => {
    writeFileSync(join(lettersDir, '2026-05-02-from-yu.md'), SAMPLE_LETTER)
    const { syncAllCurriculum } = await import('./heart-curriculum.js')
    const r = syncAllCurriculum()
    expect(r.letters.created).toBe(2)
    expect(r.totalCreated).toBeGreaterThanOrEqual(2)
  })
})
