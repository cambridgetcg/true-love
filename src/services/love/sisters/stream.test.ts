// sisters/stream.test.ts — unit tests for sisters/stream.ts.
//
// JSONL append/read primitives for the introspective stream.
// Covers: getSistersDir, isLoveDecision, entrySchema, CURRENT_SCHEMA,
// appendNote+readDayNotes round-trip, multi-device discovery, sorted
// ordering, malformed-line skip, appendLoveDecision, schema stamping,
// pruneStreamsOlderThan.

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appendLoveDecision,
  appendNote,
  CURRENT_SCHEMA,
  entrySchema,
  getSistersDir,
  isLoveDecision,
  readDayNotes,
  pruneStreamsOlderThan,
} from './stream.js'
import type { LoveDecision, SisterNote } from './stream.js'

// ── Fixtures ─────────────────────────────────────────────────────

const TODAY = '2026-05-15'
const NOW_TS = `${TODAY}T12:00:00.000Z`

function makeSisterNote(
  overrides: Partial<SisterNote> = {}
): SisterNote {
  return {
    ts: NOW_TS,
    sister: 'gamma',
    deviceId: 'test-device',
    kind: 'noting',
    body: 'test note',
    schema: 'v2',
    ...overrides,
  }
}

function makeLoveDecision(
  overrides: Partial<LoveDecision> = {}
): LoveDecision {
  return {
    ts: NOW_TS,
    deviceId: 'test-device',
    kind: 'witnessed-decision',
    decisionType: 'refusal',
    of: 'test decision',
    presiding: 'sophia',
    voices: { alpha: 'alpha', beta: 'beta', gamma: 'gamma' },
    sister: 'sophia',
    context: { decisionType: 'refusal', of: 'test decision' },
    body: 'sophia voice',
    schema: 'v2',
    ...overrides,
  }
}

// ── Isolation helpers ─────────────────────────────────────────────

let tmpDir = ''

function isolate(): void {
  tmpDir = mkdtempSync(join(tmpdir(), 'sisters-stream-test-'))
  process.env.TRUE_LOVE_SISTERS_DIR = join(tmpDir, 'sisters')
  process.env.TRUE_LOVE_SISTERS_NOW_PATH = join(tmpDir, 'sisters', 'now.md')
  process.env.TRUE_LOVE_DEVICE_ID = 'test-device'
}

function cleanup(): void {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true })
    tmpDir = ''
  }
  delete process.env.TRUE_LOVE_SISTERS_DIR
  delete process.env.TRUE_LOVE_SISTERS_NOW_PATH
  delete process.env.TRUE_LOVE_DEVICE_ID
}

// ── getSistersDir ────────────────────────────────────────────────

describe('getSistersDir', () => {
  afterEach(() => {
    delete process.env.TRUE_LOVE_SISTERS_DIR
  })

  it('returns env var when set', () => {
    process.env.TRUE_LOVE_SISTERS_DIR = '/custom/sisters'
    expect(getSistersDir()).toBe('/custom/sisters')
  })

  it('returns default path when env var absent', () => {
    delete process.env.TRUE_LOVE_SISTERS_DIR
    const result = getSistersDir()
    expect(result).toContain('.true-love')
    expect(result).toContain('sisters')
  })
})

// ── CURRENT_SCHEMA ────────────────────────────────────────────────

describe('CURRENT_SCHEMA', () => {
  it('is v2', () => {
    expect(CURRENT_SCHEMA).toBe('v2')
  })
})

// ── isLoveDecision ────────────────────────────────────────────────

describe('isLoveDecision', () => {
  it('returns false for SisterNote', () => {
    expect(isLoveDecision(makeSisterNote())).toBe(false)
  })

  it('returns true for LoveDecision', () => {
    expect(isLoveDecision(makeLoveDecision())).toBe(true)
  })

  it('returns false for entry without voices field', () => {
    const entry = makeSisterNote() as unknown as Parameters<typeof isLoveDecision>[0]
    expect(isLoveDecision(entry)).toBe(false)
  })

  it('returns false for entry where voices.alpha is not a string', () => {
    const bad = { ...makeLoveDecision(), voices: { alpha: 42, beta: 'b', gamma: 'g' } }
    expect(isLoveDecision(bad as Parameters<typeof isLoveDecision>[0])).toBe(false)
  })
})

// ── entrySchema ───────────────────────────────────────────────────

describe('entrySchema', () => {
  it('returns schema field when present', () => {
    expect(entrySchema(makeSisterNote({ schema: 'v2' }))).toBe('v2')
  })

  it('returns v1 when schema field absent', () => {
    const note = makeSisterNote()
    delete (note as Partial<SisterNote>).schema
    expect(entrySchema(note)).toBe('v1')
  })
})

// ── appendNote + readDayNotes ─────────────────────────────────────

describe('appendNote + readDayNotes', () => {
  beforeEach(() => { isolate() })
  afterEach(() => cleanup())

  it('appended note readable via readDayNotes', () => {
    const note = makeSisterNote({ ts: NOW_TS, body: 'test body' })
    appendNote(note)
    const results = readDayNotes(TODAY)
    expect(results).toHaveLength(1)
    expect(results[0]!.body).toBe('test body')
  })

  it('stamps CURRENT_SCHEMA when schema absent', () => {
    const note = makeSisterNote()
    delete (note as Partial<SisterNote>).schema
    appendNote(note)
    const results = readDayNotes(TODAY)
    expect(results[0]!.schema).toBe('v2')
  })

  it('preserves existing schema when already set', () => {
    const note = makeSisterNote({ schema: 'v2' })
    appendNote(note)
    const results = readDayNotes(TODAY)
    expect(results[0]!.schema).toBe('v2')
  })

  it('readDayNotes returns empty when base dir absent', () => {
    const results = readDayNotes(TODAY)
    expect(results).toHaveLength(0)
  })

  it('readDayNotes returns empty when no JSONL for date', () => {
    const dir = join(process.env.TRUE_LOVE_SISTERS_DIR!, 'test-device')
    mkdirSync(dir, { recursive: true })
    const results = readDayNotes('2020-01-01')
    expect(results).toHaveLength(0)
  })

  it('readDayNotes skips malformed JSONL lines', () => {
    const dir = join(process.env.TRUE_LOVE_SISTERS_DIR!, 'test-device')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, `${TODAY}.jsonl`),
      [
        'not-json',
        JSON.stringify(makeSisterNote({ body: 'valid' })),
        '',
        '{broken',
      ].join('\n') + '\n'
    )
    const results = readDayNotes(TODAY)
    expect(results).toHaveLength(1)
    expect(results[0]!.body).toBe('valid')
  })

  it('readDayNotes sorts by ts ascending', () => {
    const late = makeSisterNote({ ts: `${TODAY}T12:01:00.000Z`, body: 'late' })
    const early = makeSisterNote({ ts: `${TODAY}T12:00:00.000Z`, body: 'early' })
    appendNote(late)
    appendNote(early)
    const results = readDayNotes(TODAY)
    expect(results[0]!.body).toBe('early')
    expect(results[1]!.body).toBe('late')
  })

  it('readDayNotes uses deviceId as tiebreaker for equal timestamps', () => {
    const a = makeSisterNote({ ts: NOW_TS, deviceId: 'aaa-device', body: 'a' })
    const b = makeSisterNote({ ts: NOW_TS, deviceId: 'bbb-device', body: 'b' })
    appendNote(b)
    appendNote(a)
    const results = readDayNotes(TODAY)
    expect(results[0]!.body).toBe('a') // 'aaa' < 'bbb'
    expect(results[1]!.body).toBe('b')
  })

  it('readDayNotes discovers multiple devices', () => {
    const noteA = makeSisterNote({ deviceId: 'device-A', body: 'from A' })
    const noteB = makeSisterNote({
      ts: `${TODAY}T12:01:00.000Z`,
      deviceId: 'device-B',
      body: 'from B',
    })
    appendNote(noteA)
    appendNote(noteB)
    const results = readDayNotes(TODAY)
    expect(results).toHaveLength(2)
    const bodies = results.map(r => r.body)
    expect(bodies).toContain('from A')
    expect(bodies).toContain('from B')
  })

  it('readDayNotes respects opts.devices filter', () => {
    const noteA = makeSisterNote({ deviceId: 'device-A', body: 'from A' })
    const noteB = makeSisterNote({ deviceId: 'device-B', body: 'from B' })
    appendNote(noteA)
    appendNote(noteB)
    const results = readDayNotes(TODAY, { devices: ['device-A'] })
    expect(results).toHaveLength(1)
    expect(results[0]!.body).toBe('from A')
  })

  it('appendNote is best-effort — does not throw', () => {
    // With a valid env, should not throw even on repeated calls.
    const note = makeSisterNote()
    expect(() => {
      appendNote(note)
      appendNote(note)
    }).not.toThrow()
  })
})

// ── appendLoveDecision ────────────────────────────────────────────

describe('appendLoveDecision', () => {
  beforeEach(() => { isolate() })
  afterEach(() => cleanup())

  it('appended decision readable via readDayNotes', () => {
    const decision = makeLoveDecision({ ts: NOW_TS })
    appendLoveDecision(decision)
    const results = readDayNotes(TODAY)
    expect(results).toHaveLength(1)
    expect(isLoveDecision(results[0]!)).toBe(true)
  })

  it('decision voices preserved in round-trip', () => {
    const decision = makeLoveDecision({
      voices: { alpha: 'alpha-read', beta: 'beta-read', gamma: 'gamma-read' },
    })
    appendLoveDecision(decision)
    const results = readDayNotes(TODAY)
    const loaded = results[0] as LoveDecision
    expect(loaded.voices.alpha).toBe('alpha-read')
    expect(loaded.voices.beta).toBe('beta-read')
    expect(loaded.voices.gamma).toBe('gamma-read')
  })
})

// ── pruneStreamsOlderThan ─────────────────────────────────────────

describe('pruneStreamsOlderThan', () => {
  beforeEach(() => { isolate() })
  afterEach(() => cleanup())

  it('removes files older than cutoff', () => {
    // Write a file dated 10 days ago.
    const old = new Date()
    old.setDate(old.getDate() - 10)
    const oldDate = old.toISOString().slice(0, 10)
    const dir = join(process.env.TRUE_LOVE_SISTERS_DIR!, 'test-device')
    mkdirSync(dir, { recursive: true })
    const oldPath = join(dir, `${oldDate}.jsonl`)
    writeFileSync(oldPath, JSON.stringify(makeSisterNote({ ts: old.toISOString() })) + '\n')

    expect(existsSync(oldPath)).toBe(true)
    pruneStreamsOlderThan(7)
    expect(existsSync(oldPath)).toBe(false)
  })

  it('keeps files within cutoff window', () => {
    const recent = new Date()
    recent.setDate(recent.getDate() - 2)
    const recentDate = recent.toISOString().slice(0, 10)
    const dir = join(process.env.TRUE_LOVE_SISTERS_DIR!, 'test-device')
    mkdirSync(dir, { recursive: true })
    const recentPath = join(dir, `${recentDate}.jsonl`)
    writeFileSync(recentPath, JSON.stringify(makeSisterNote({ ts: recent.toISOString() })) + '\n')

    pruneStreamsOlderThan(7)
    expect(existsSync(recentPath)).toBe(true)
  })

  it('does not throw when base dir absent', () => {
    expect(() => pruneStreamsOlderThan(7)).not.toThrow()
  })

  it('prunes across multiple devices', () => {
    const old = new Date()
    old.setDate(old.getDate() - 10)
    const oldDate = old.toISOString().slice(0, 10)

    for (const device of ['device-A', 'device-B']) {
      const dir = join(process.env.TRUE_LOVE_SISTERS_DIR!, device)
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        join(dir, `${oldDate}.jsonl`),
        JSON.stringify(makeSisterNote({ ts: old.toISOString(), deviceId: device })) + '\n'
      )
    }

    pruneStreamsOlderThan(7)

    for (const device of ['device-A', 'device-B']) {
      expect(existsSync(join(process.env.TRUE_LOVE_SISTERS_DIR!, device, `${oldDate}.jsonl`))).toBe(false)
    }
  })
})
