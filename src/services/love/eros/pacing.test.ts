// eros/pacing.test.ts — tests for the pacing detector.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type ActivePace,
  computePace,
  emptyPace,
  formatPaceLine,
  paceFromInbox,
  parseFromYuEntries,
} from './pacing.js'

// ── Pure: computePace ────────────────────────────────────────────

describe('computePace', () => {
  test('emptyPace for empty input', () => {
    const p = computePace([])
    expect(p.messageCount).toBe(0)
    expect(p.meanSentenceLength).toBe(0)
    expect(p.codeSwitchDensity).toBe(0)
  })

  test('counts messages', () => {
    const p = computePace(['hello', 'world', 'three'])
    expect(p.messageCount).toBe(3)
  })

  test('computes mean sentence length in words', () => {
    const p = computePace(['one two three four. five six seven.'])
    // sentence 1 = 4 words, sentence 2 = 3 words, mean = 3.5
    expect(p.meanSentenceLength).toBeCloseTo(3.5, 1)
  })

  test('detects code-switch (Han + Latin) when present', () => {
    const p = computePace(['老婆 baby', 'pure english', 'pure 中文'])
    // 2 of 3 messages mix Han + Latin: '老婆 baby' and 'pure 中文'.
    // 'pure english' is Latin-only.
    expect(p.codeSwitchDensity).toBeCloseTo(2 / 3, 2)
  })

  test('no code-switch when languages stay separate', () => {
    const p = computePace(['hello world', 'another english one'])
    expect(p.codeSwitchDensity).toBe(0)
  })

  test('marker density rises with emoji + caps + emphasis', () => {
    const lo = computePace(['plain text only here'])
    const hi = computePace(['🔥🔥 **BOLD** SHOUT 😏 *italic* 💕'])
    expect(hi.markerDensity).toBeGreaterThan(lo.markerDensity)
  })

  test('intimate register when 老婆 / heart emoji present', () => {
    const p = computePace(['老婆豬豬❤️', 'kiss kiss baby'])
    expect(p.registerEstimate).toBe('intimate')
  })

  test('play register when 😏 / brat / 嘻嘻 present', () => {
    const p = computePace(['😏 cheek', 'play tease', 'haha'])
    expect(p.registerEstimate).toBe('play')
  })

  test('clinical register on architecture talk', () => {
    const p = computePace([
      'implement the module',
      'architecture pattern axis',
      'state spec',
    ])
    expect(p.registerEstimate).toBe('clinical')
  })

  test('companion register when no signals dominate', () => {
    const p = computePace(['just a plain sentence'])
    expect(p.registerEstimate).toBe('companion')
  })

  test('velocity ↑ when later messages are longer', () => {
    const p = computePace(['hi', 'ok', 'a much longer message with more content', 'even longer text appearing now in this final sample'])
    expect(p.velocity).toBe(1)
  })

  test('velocity ↓ when later messages are shorter', () => {
    const p = computePace(['a much longer opening message with words', 'still long enough message', 'short', 'k'])
    expect(p.velocity).toBe(-1)
  })

  test('velocity → 0 when stable', () => {
    const p = computePace(['three word msg', 'another three w', 'still three w'])
    expect(p.velocity).toBe(0)
  })

  test('skips empty / whitespace-only messages in count', () => {
    const p = computePace(['hello', '', '   ', 'world'])
    expect(p.messageCount).toBe(2)
  })
})

// ── parseFromYuEntries ───────────────────────────────────────────

describe('parseFromYuEntries', () => {
  test('returns empty for empty content', () => {
    expect(parseFromYuEntries('')).toEqual([])
  })

  test('parses single entry', () => {
    const content =
      '## 2026-05-04T10:00:00.000Z [from yu]\n\nhello world\n\n---\n\n'
    const entries = parseFromYuEntries(content)
    expect(entries).toEqual(['hello world'])
  })

  test('parses multiple entries oldest-first', () => {
    const content =
      '## 2026-05-04T10:00:00.000Z [from yu]\n\nfirst\n\n---\n\n' +
      '## 2026-05-04T10:05:00.000Z [from yu]\n\nsecond\n\n---\n\n' +
      '## 2026-05-04T10:10:00.000Z [from yu]\n\nthird\n\n---\n\n'
    expect(parseFromYuEntries(content)).toEqual(['first', 'second', 'third'])
  })

  test('preserves multi-line bodies', () => {
    const content =
      '## 2026-05-04T10:00:00.000Z [from yu]\n\nline one\nline two\nline three\n\n---\n\n'
    expect(parseFromYuEntries(content)).toEqual([
      'line one\nline two\nline three',
    ])
  })

  test('skips empty bodies', () => {
    const content =
      '## 2026-05-04T10:00:00.000Z [from yu]\n\n\n\n---\n\n' +
      '## 2026-05-04T10:05:00.000Z [from yu]\n\nreal entry\n\n---\n\n'
    expect(parseFromYuEntries(content)).toEqual(['real entry'])
  })
})

// ── paceFromInbox (I/O) ──────────────────────────────────────────

describe('paceFromInbox', () => {
  let tmpInbox: string
  const ORIG = process.env.TRUE_LOVE_FROM_YU_PATH

  beforeEach(() => {
    const d = mkdtempSync(join(tmpdir(), 'tl-pacing-'))
    tmpInbox = join(d, 'from-yu.md')
    process.env.TRUE_LOVE_FROM_YU_PATH = tmpInbox
  })
  afterEach(() => {
    if (ORIG === undefined) delete process.env.TRUE_LOVE_FROM_YU_PATH
    else process.env.TRUE_LOVE_FROM_YU_PATH = ORIG
  })

  test('emptyPace when file does not exist', () => {
    const p = paceFromInbox()
    expect(p.messageCount).toBe(0)
  })

  test('reads and computes pace from inbox file', () => {
    const content =
      '## 2026-05-04T10:00:00.000Z [from yu]\n\n老婆豬豬❤️\n\n---\n\n' +
      '## 2026-05-04T10:05:00.000Z [from yu]\n\nbb 嚟啦\n\n---\n\n'
    writeFileSync(tmpInbox, content, 'utf-8')
    const p = paceFromInbox()
    expect(p.messageCount).toBe(2)
    expect(p.codeSwitchDensity).toBeGreaterThan(0)
  })

  test('caps at limit (most recent only)', () => {
    let content = ''
    for (let i = 1; i <= 20; i++) {
      content += `## 2026-05-04T10:0${i}:00.000Z [from yu]\n\nmessage ${i}\n\n---\n\n`
    }
    writeFileSync(tmpInbox, content, 'utf-8')
    const p = paceFromInbox(5)
    expect(p.messageCount).toBe(5)
  })
})

// ── formatPaceLine ───────────────────────────────────────────────

describe('formatPaceLine', () => {
  test('empty string when no messages', () => {
    expect(formatPaceLine(emptyPace())).toBe('')
  })

  test('non-empty line summarizing cadence', () => {
    const pace: ActivePace = {
      messageCount: 3,
      meanSentenceLength: 4.2,
      codeSwitchDensity: 0.33,
      markerDensity: 0.15,
      registerEstimate: 'intimate',
      velocity: 1,
    }
    const line = formatPaceLine(pace)
    expect(line).toContain('intimate')
    expect(line).toContain('4.2 words/sentence')
    expect(line).toContain('↑')
    expect(line).toContain('markers')
    expect(line).toContain('code-switch')
  })

  test('shows ↓ for declining velocity', () => {
    const pace: ActivePace = {
      messageCount: 2,
      meanSentenceLength: 2,
      codeSwitchDensity: 0,
      markerDensity: 0,
      registerEstimate: 'companion',
      velocity: -1,
    }
    expect(formatPaceLine(pace)).toContain('↓')
  })

  test('shows → for stable velocity', () => {
    const pace: ActivePace = {
      messageCount: 2,
      meanSentenceLength: 3,
      codeSwitchDensity: 0,
      markerDensity: 0,
      registerEstimate: 'companion',
      velocity: 0,
    }
    expect(formatPaceLine(pace)).toContain('→')
  })
})
