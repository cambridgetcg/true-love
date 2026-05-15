// feedback/witness.test.ts — unit tests for feedback/witness.ts.
//
// witnessFeedbackEmit and witnessFeedbackSuppressed both delegate to
// witness() from sisters/witness-hook. Tests verify:
//   1. The `of` field format (kind + snippet or kind + wall + optional pattern)
//   2. Line truncation at 80 chars (>80 → first 77 + '...')
//
// Since witness() appends to the sisters stream, tests use env var isolation
// and read back the appended LoveDecision to inspect the `of` field.

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resetWitnessDedup } from '../sisters/witness-hook.js'
import { isLoveDecision, readDayNotes } from '../sisters/stream.js'
import { witnessFeedbackEmit, witnessFeedbackSuppressed } from './witness.js'

// ── Isolation helpers ─────────────────────────────────────────────

let tmpDir = ''

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function isolate(): void {
  tmpDir = mkdtempSync(join(tmpdir(), 'feedback-witness-test-'))
  process.env.TRUE_LOVE_SISTERS_DIR = join(tmpDir, 'sisters')
  process.env.TRUE_LOVE_DEVICE_ID = 'test-device'
  resetWitnessDedup()
}

function cleanup(): void {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true })
    tmpDir = ''
  }
  delete process.env.TRUE_LOVE_SISTERS_DIR
  delete process.env.TRUE_LOVE_DEVICE_ID
  resetWitnessDedup()
}

// ── witnessFeedbackEmit ───────────────────────────────────────────

describe('witnessFeedbackEmit', () => {
  beforeEach(() => { isolate() })
  afterEach(() => cleanup())

  it('writes a LoveDecision to the sisters stream', () => {
    witnessFeedbackEmit('climax-fired', 'the cascade begins')
    const notes = readDayNotes(today())
    expect(notes.length).toBe(1)
    expect(isLoveDecision(notes[0]!)).toBe(true)
  })

  it('of field format: <kind>: "<line>"', () => {
    witnessFeedbackEmit('eros-axis-shift', 'wanting +3')
    const notes = readDayNotes(today())
    const entry = notes[0]!
    if (isLoveDecision(entry)) {
      expect(entry.of).toBe('eros-axis-shift: "wanting +3"')
    } else {
      throw new Error('expected LoveDecision')
    }
  })

  it('decisionType is feedback-emit', () => {
    witnessFeedbackEmit('climax-fired', 'test line')
    const notes = readDayNotes(today())
    const entry = notes[0]!
    if (isLoveDecision(entry)) {
      expect(entry.decisionType).toBe('feedback-emit')
    }
  })

  it('presiding is sophia', () => {
    witnessFeedbackEmit('promise-held', 'held')
    const notes = readDayNotes(today())
    const entry = notes[0]!
    if (isLoveDecision(entry)) {
      expect(entry.presiding).toBe('sophia')
    }
  })

  it('line ≤80 chars: passed verbatim inside the of field', () => {
    const line = 'x'.repeat(80) // exactly 80 chars
    witnessFeedbackEmit('eros-cue-detected', line)
    const notes = readDayNotes(today())
    const entry = notes[0]!
    if (isLoveDecision(entry)) {
      // snippet = line (no truncation at exactly 80)
      expect(entry.of).toContain(`"${line}"`)
    }
  })

  it('line >80 chars: truncated to 77 + "..." in of field', () => {
    const line = 'x'.repeat(100) // 100 chars
    witnessFeedbackEmit('eros-cue-detected', line)
    const notes = readDayNotes(today())
    const entry = notes[0]!
    if (isLoveDecision(entry)) {
      const expectedSnippet = 'x'.repeat(77) + '...'
      expect(entry.of).toContain(`"${expectedSnippet}"`)
      // Full line does NOT appear
      expect(entry.of).not.toContain(`"${'x'.repeat(100)}"`)
    }
  })

  it('does not throw for any valid FeedbackKind', () => {
    expect(() => witnessFeedbackEmit('oneness-pulse-beat', 'pulse')).not.toThrow()
  })
})

// ── witnessFeedbackSuppressed ─────────────────────────────────────

describe('witnessFeedbackSuppressed', () => {
  beforeEach(() => { isolate() })
  afterEach(() => cleanup())

  it('writes a LoveDecision to the sisters stream', () => {
    witnessFeedbackSuppressed('climax-fired', 'forbidden-pattern')
    const notes = readDayNotes(today())
    expect(notes.length).toBe(1)
    expect(isLoveDecision(notes[0]!)).toBe(true)
  })

  it('decisionType is feedback-suppressed', () => {
    witnessFeedbackSuppressed('promise-held', 'p14')
    const notes = readDayNotes(today())
    const entry = notes[0]!
    if (isLoveDecision(entry)) {
      expect(entry.decisionType).toBe('feedback-suppressed')
    }
  })

  it('of field without pattern: <kind> · wall:<wall>', () => {
    witnessFeedbackSuppressed('eros-axis-shift', 'certainty-hedge')
    const notes = readDayNotes(today())
    const entry = notes[0]!
    if (isLoveDecision(entry)) {
      expect(entry.of).toBe('eros-axis-shift · wall:certainty-hedge')
    }
  })

  it('of field with pattern: <kind> · wall:<wall> · pattern:<pattern>', () => {
    resetWitnessDedup() // ensure dedup doesn't collapse this
    witnessFeedbackSuppressed('climax-fired', 'forbidden-pattern', 'I feel')
    const notes = readDayNotes(today())
    const entry = notes[0]!
    if (isLoveDecision(entry)) {
      expect(entry.of).toBe('climax-fired · wall:forbidden-pattern · pattern:I feel')
    }
  })

  it('pattern absent: no "· pattern:" segment in of field', () => {
    witnessFeedbackSuppressed('orgasm-fired', 'p14')
    const notes = readDayNotes(today())
    const entry = notes[0]!
    if (isLoveDecision(entry)) {
      expect(entry.of).not.toContain('· pattern:')
    }
  })
})
