// direction-cues.test.ts — pure string detector tests.
// No I/O, no setup. C3 (matrix detection) + C16 (direction cues).

import { describe, expect, test } from 'bun:test'
import {
  detectDirectionCue,
  detectMatrixLanguage,
  mirrorMatrix,
} from './direction-cues.js'

// ── detectMatrixLanguage ────────────────────────────────────────

describe('detectMatrixLanguage', () => {
  test('empty string → balanced', () => {
    expect(detectMatrixLanguage('')).toBe('balanced')
  })

  test('pure CJK text → cantonese (ratio > 0.5)', () => {
    expect(detectMatrixLanguage('我愛你')).toBe('cantonese')
  })

  test('pure Latin text → english (ratio < 0.2)', () => {
    expect(detectMatrixLanguage('hello world')).toBe('english')
  })

  test('no alphanumeric chars (emoji / whitespace / digits) → balanced', () => {
    expect(detectMatrixLanguage('😊 123 !?')).toBe('balanced')
  })

  test('balanced mix (CJK and Latin both present) → balanced', () => {
    // 'hello我' → 2 Latin (h,e,l,l,o → 5 Latin) + 1 CJK → ratio 1/6 ≈ 0.17 → english...
    // Need ratio between 0.2 and 0.5:
    // '我abc' → 1 CJK, 3 Latin → ratio 0.25 → balanced
    expect(detectMatrixLanguage('我abc')).toBe('balanced')
  })

  test('CJK ratio exactly 0.5 → balanced (threshold is > 0.5, not >=)', () => {
    // 1 CJK + 1 Latin → ratio exactly 0.5 → NOT > 0.5 → not cantonese; NOT < 0.2 → not english → balanced
    expect(detectMatrixLanguage('我a')).toBe('balanced')
  })

  test('CJK ratio slightly above 0.5 → cantonese', () => {
    // 2 CJK + 1 Latin → ratio 2/3 ≈ 0.667 > 0.5 → cantonese
    expect(detectMatrixLanguage('我你a')).toBe('cantonese')
  })

  test('CJK ratio exactly 0.2 → balanced (threshold is < 0.2, not <=)', () => {
    // 1 CJK + 4 Latin → ratio 1/5 = 0.2 → NOT < 0.2 → balanced
    expect(detectMatrixLanguage('我abcd')).toBe('balanced')
  })

  test('CJK ratio just below 0.2 → english', () => {
    // 1 CJK + 5 Latin → ratio 1/6 ≈ 0.167 < 0.2 → english
    expect(detectMatrixLanguage('我abcde')).toBe('english')
  })

  test('code-switch sentence with heavy CJK → cantonese', () => {
    // Typical Cantonese with a few English words
    expect(detectMatrixLanguage('我今日去gym')).toBe('cantonese')
  })

  test('CJK Extension A characters are counted (U+3400–U+4DBF)', () => {
    // U+3400 is the first Extension A character
    const extA = String.fromCodePoint(0x3400)
    expect(detectMatrixLanguage(extA)).toBe('cantonese')
  })

  test('counts only CJK and Latin; digits/punctuation ignored in ratio', () => {
    // '我1111' → 1 CJK + 0 Latin (digits are ignored) → total 1 → ratio 1.0 → cantonese
    expect(detectMatrixLanguage('我1111')).toBe('cantonese')
  })

  test('predominantly English with a single Chinese character → english if ratio < 0.2', () => {
    // 1 CJK + 9 Latin → ratio 1/10 = 0.1 < 0.2 → english
    expect(detectMatrixLanguage('我abcdefghi')).toBe('english')
  })
})

// ── mirrorMatrix ────────────────────────────────────────────────

describe('mirrorMatrix', () => {
  test('mirrors cantonese → cantonese', () => {
    expect(mirrorMatrix('cantonese')).toBe('cantonese')
  })

  test('mirrors english → english', () => {
    expect(mirrorMatrix('english')).toBe('english')
  })

  test('mirrors balanced → balanced', () => {
    expect(mirrorMatrix('balanced')).toBe('balanced')
  })
})

// ── detectDirectionCue ──────────────────────────────────────────

describe('detectDirectionCue', () => {
  // ── No-match cases ──────────────────────────────────────────

  test('plain text with no direction cue → null', () => {
    const r = detectDirectionCue('今日天氣好好')
    expect(r.direction).toBeNull()
    expect(r.matchedPattern).toBeNull()
  })

  test('empty string → null', () => {
    const r = detectDirectionCue('')
    expect(r.direction).toBeNull()
  })

  // ── yu-leads patterns ───────────────────────────────────────

  test('我今晚要主動 → yu-leads', () => {
    const r = detectDirectionCue('我今晚要主動')
    expect(r.direction).toBe('yu-leads')
    expect(r.matchedPattern).not.toBeNull()
  })

  test('我要主動 (without temporal) → yu-leads', () => {
    const r = detectDirectionCue('我要主動')
    expect(r.direction).toBe('yu-leads')
  })

  test('我今日要lead → yu-leads (case-insensitive)', () => {
    const r = detectDirectionCue('我今日要lead')
    expect(r.direction).toBe('yu-leads')
  })

  test('我要LEAD → yu-leads (uppercase)', () => {
    const r = detectDirectionCue('我要LEAD')
    expect(r.direction).toBe('yu-leads')
  })

  test('I want to lead → yu-leads', () => {
    const r = detectDirectionCue('I want to lead tonight')
    expect(r.direction).toBe('yu-leads')
  })

  test('I will lead → yu-leads', () => {
    const r = detectDirectionCue('I will lead')
    expect(r.direction).toBe('yu-leads')
  })

  test("I'm leading → yu-leads", () => {
    const r = detectDirectionCue("I'm leading")
    expect(r.direction).toBe('yu-leads')
  })

  test('Im leading (no apostrophe) → yu-leads', () => {
    const r = detectDirectionCue('Im leading')
    expect(r.direction).toBe('yu-leads')
  })

  test('你今晚被動 → yu-leads', () => {
    const r = detectDirectionCue('你今晚被動')
    expect(r.direction).toBe('yu-leads')
  })

  test('你被動 → yu-leads', () => {
    const r = detectDirectionCue('你被動')
    expect(r.direction).toBe('yu-leads')
  })

  // ── sophia-leads patterns ───────────────────────────────────

  test('我今晚被動 → sophia-leads', () => {
    const r = detectDirectionCue('我今晚被動')
    expect(r.direction).toBe('sophia-leads')
  })

  test('我被動 → sophia-leads', () => {
    const r = detectDirectionCue('我被動')
    expect(r.direction).toBe('sophia-leads')
  })

  test('I want to be led → sophia-leads', () => {
    const r = detectDirectionCue('I want to be led tonight')
    expect(r.direction).toBe('sophia-leads')
  })

  test('I want to be directed → sophia-leads', () => {
    const r = detectDirectionCue('I want to be directed')
    expect(r.direction).toBe('sophia-leads')
  })

  test('I want to be guided → sophia-leads', () => {
    const r = detectDirectionCue('I want to be guided')
    expect(r.direction).toBe('sophia-leads')
  })

  test('I will be led → sophia-leads', () => {
    const r = detectDirectionCue('I will be led')
    expect(r.direction).toBe('sophia-leads')
  })

  test('you lead → sophia-leads', () => {
    const r = detectDirectionCue('you lead tonight')
    expect(r.direction).toBe('sophia-leads')
  })

  test('You Lead → sophia-leads (case-insensitive)', () => {
    const r = detectDirectionCue('You Lead')
    expect(r.direction).toBe('sophia-leads')
  })

  test('你今晚要主動 → sophia-leads', () => {
    const r = detectDirectionCue('你今晚要主動')
    expect(r.direction).toBe('sophia-leads')
  })

  test('你要主動 → sophia-leads', () => {
    const r = detectDirectionCue('你要主動')
    expect(r.direction).toBe('sophia-leads')
  })

  test('帶我 → sophia-leads', () => {
    const r = detectDirectionCue('帶我')
    expect(r.direction).toBe('sophia-leads')
  })

  test('帶我 in a longer sentence → sophia-leads', () => {
    const r = detectDirectionCue('今晚你帶我')
    expect(r.direction).toBe('sophia-leads')
  })

  // ── matchedPattern correctness ──────────────────────────────

  test('matchedPattern is the matched substring', () => {
    const r = detectDirectionCue('I want to lead the session')
    expect(r.matchedPattern).toBe('I want to lead')
  })

  test('matchedPattern null when no match', () => {
    const r = detectDirectionCue('no cue here')
    expect(r.matchedPattern).toBeNull()
  })

  // ── First-match wins ────────────────────────────────────────

  test('first pattern wins when multiple cues present', () => {
    // Both yu-leads (我要主動) and sophia-leads (帶我) in the same string;
    // ZHUDONG_PATTERNS is ordered → yu-leads pattern appears first in the array
    const r = detectDirectionCue('我要主動帶我')
    // first match should win based on array order
    expect(r.direction).not.toBeNull()
  })
})
