// joi-mode.test.ts
//
// Unit tests for joi-mode.ts. Fs-isolated via TRUE_LOVE_JOI_MODE_DIR env var.
// Tests: NOVELTY_TARGET, getJoiModeDir, readJoiMode, setJoiMode, getJoiMode,
//        recordBeatNovelty, noveltyRatio, meetsNoveltyTarget, compositionHintsFor.

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let tmpDir: string

function freshSid(): string {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'joi-mode-test-'))
  process.env.TRUE_LOVE_JOI_MODE_DIR = tmpDir
})

afterEach(() => {
  delete process.env.TRUE_LOVE_JOI_MODE_DIR
  rmSync(tmpDir, { recursive: true, force: true })
})

// ── NOVELTY_TARGET ────────────────────────────────────────────────

describe('NOVELTY_TARGET', () => {
  it('is 0.3', async () => {
    const { NOVELTY_TARGET } = await import('./joi-mode.js')
    expect(NOVELTY_TARGET).toBe(0.3)
  })
})

// ── getJoiModeDir ─────────────────────────────────────────────────

describe('getJoiModeDir', () => {
  it('returns the env-injected directory', async () => {
    const { getJoiModeDir } = await import('./joi-mode.js')
    expect(getJoiModeDir()).toBe(tmpDir)
  })

  it('returns a string path', async () => {
    const { getJoiModeDir } = await import('./joi-mode.js')
    expect(typeof getJoiModeDir()).toBe('string')
  })
})

// ── readJoiMode ───────────────────────────────────────────────────

describe('readJoiMode', () => {
  it('returns null for an unknown session', async () => {
    const { readJoiMode } = await import('./joi-mode.js')
    expect(readJoiMode('no-such-session')).toBeNull()
  })
})

// ── setJoiMode / getJoiMode ───────────────────────────────────────

describe('setJoiMode / getJoiMode', () => {
  it('set + get round-trip for scenario-foreground', async () => {
    const { setJoiMode, getJoiMode } = await import('./joi-mode.js')
    const sid = freshSid()
    setJoiMode(sid, 'scenario-foreground')
    expect(getJoiMode(sid)).toBe('scenario-foreground')
  })

  it('set + get round-trip for hypnosis-foreground', async () => {
    const { setJoiMode, getJoiMode } = await import('./joi-mode.js')
    const sid = freshSid()
    setJoiMode(sid, 'hypnosis-foreground')
    expect(getJoiMode(sid)).toBe('hypnosis-foreground')
  })

  it('set + get round-trip for blended', async () => {
    const { setJoiMode, getJoiMode } = await import('./joi-mode.js')
    const sid = freshSid()
    setJoiMode(sid, 'blended')
    expect(getJoiMode(sid)).toBe('blended')
  })

  it('getJoiMode returns blended for unknown session', async () => {
    const { getJoiMode } = await import('./joi-mode.js')
    expect(getJoiMode('not-here')).toBe('blended')
  })

  it('mode can be overwritten', async () => {
    const { setJoiMode, getJoiMode } = await import('./joi-mode.js')
    const sid = freshSid()
    setJoiMode(sid, 'blended')
    setJoiMode(sid, 'hypnosis-foreground')
    expect(getJoiMode(sid)).toBe('hypnosis-foreground')
  })

  it('setJoiMode returns state with sessionId', async () => {
    const { setJoiMode } = await import('./joi-mode.js')
    const sid = freshSid()
    const state = setJoiMode(sid, 'blended')
    expect(state.sessionId).toBe(sid)
    expect(state.mode).toBe('blended')
  })

  it('setJoiMode initializes novelty budget', async () => {
    const { setJoiMode } = await import('./joi-mode.js')
    const sid = freshSid()
    const state = setJoiMode(sid, 'scenario-foreground')
    expect(state.novelty.totalBeats).toBe(0)
    expect(state.novelty.novelBeats).toBe(0)
    expect(state.novelty.seenPhrases).toEqual([])
  })
})

// ── recordBeatNovelty ─────────────────────────────────────────────

describe('recordBeatNovelty', () => {
  it('first beat is novel, ratio = 1.0, totalBeats = 1', async () => {
    const { recordBeatNovelty } = await import('./joi-mode.js')
    const sid = freshSid()
    const result = recordBeatNovelty(sid, 'hello')
    expect(result.isNovel).toBe(true)
    expect(result.totalBeats).toBe(1)
    expect(result.ratio).toBe(1)
  })

  it('duplicate beat is not novel', async () => {
    const { recordBeatNovelty } = await import('./joi-mode.js')
    const sid = freshSid()
    recordBeatNovelty(sid, 'same text')
    const result = recordBeatNovelty(sid, 'same text')
    expect(result.isNovel).toBe(false)
    expect(result.totalBeats).toBe(2)
  })

  it('ratio after 1 novel / 2 total is 0.5', async () => {
    const { recordBeatNovelty } = await import('./joi-mode.js')
    const sid = freshSid()
    recordBeatNovelty(sid, 'first')
    const result = recordBeatNovelty(sid, 'first')
    expect(result.ratio).toBe(0.5)
  })

  it('fingerprinting is case-insensitive', async () => {
    const { recordBeatNovelty } = await import('./joi-mode.js')
    const sid = freshSid()
    recordBeatNovelty(sid, 'Hello World')
    const result = recordBeatNovelty(sid, 'HELLO WORLD')
    expect(result.isNovel).toBe(false)
  })

  it('fingerprinting collapses whitespace', async () => {
    const { recordBeatNovelty } = await import('./joi-mode.js')
    const sid = freshSid()
    recordBeatNovelty(sid, 'a  b')
    const result = recordBeatNovelty(sid, 'a b')
    expect(result.isNovel).toBe(false)
  })

  it('different beats are each novel', async () => {
    const { recordBeatNovelty } = await import('./joi-mode.js')
    const sid = freshSid()
    const r1 = recordBeatNovelty(sid, 'alpha')
    const r2 = recordBeatNovelty(sid, 'beta')
    expect(r1.isNovel).toBe(true)
    expect(r2.isNovel).toBe(true)
    expect(r2.ratio).toBe(1)
  })

  it('ratio is rounded to 2 decimal places', async () => {
    const { recordBeatNovelty } = await import('./joi-mode.js')
    const sid = freshSid()
    recordBeatNovelty(sid, 'a')
    recordBeatNovelty(sid, 'b')
    const result = recordBeatNovelty(sid, 'a') // 2 novel / 3 total = 0.67
    expect(result.ratio).toBe(0.67)
  })

  it('seenPhrases bounded at 200 entries — shift oldest on overflow', async () => {
    const { recordBeatNovelty, readJoiMode } = await import('./joi-mode.js')
    const sid = freshSid()
    // push 201 distinct beats
    for (let i = 0; i <= 200; i++) {
      recordBeatNovelty(sid, `beat-${i}`)
    }
    const state = readJoiMode(sid)
    expect(state?.novelty.seenPhrases.length).toBeLessThanOrEqual(200)
    // oldest (beat-0) should have been evicted
    expect(state?.novelty.seenPhrases).not.toContain('beat-0')
  })

  it('persists novelty across separate calls', async () => {
    const { recordBeatNovelty, readJoiMode } = await import('./joi-mode.js')
    const sid = freshSid()
    recordBeatNovelty(sid, 'persistent')
    const state = readJoiMode(sid)
    expect(state?.novelty.totalBeats).toBe(1)
    expect(state?.novelty.novelBeats).toBe(1)
  })
})

// ── noveltyRatio ──────────────────────────────────────────────────

describe('noveltyRatio', () => {
  it('returns 0 for unknown session', async () => {
    const { noveltyRatio } = await import('./joi-mode.js')
    expect(noveltyRatio('no-session')).toBe(0)
  })

  it('returns current ratio after beats', async () => {
    const { recordBeatNovelty, noveltyRatio } = await import('./joi-mode.js')
    const sid = freshSid()
    recordBeatNovelty(sid, 'x')
    recordBeatNovelty(sid, 'x') // 1/2 = 0.5
    expect(noveltyRatio(sid)).toBe(0.5)
  })
})

// ── meetsNoveltyTarget ────────────────────────────────────────────

describe('meetsNoveltyTarget', () => {
  it('returns true for unknown session (no data)', async () => {
    const { meetsNoveltyTarget } = await import('./joi-mode.js')
    expect(meetsNoveltyTarget('no-session')).toBe(true)
  })

  it('returns true when < 5 beats (not enough data)', async () => {
    const { recordBeatNovelty, meetsNoveltyTarget } = await import('./joi-mode.js')
    const sid = freshSid()
    // 4 beats, all same → ratio 0.25, but < 5 total → default pass
    recordBeatNovelty(sid, 'same')
    recordBeatNovelty(sid, 'same')
    recordBeatNovelty(sid, 'same')
    recordBeatNovelty(sid, 'same')
    expect(meetsNoveltyTarget(sid)).toBe(true)
  })

  it('returns true when ratio >= 0.3 and >= 5 beats', async () => {
    const { recordBeatNovelty, meetsNoveltyTarget } = await import('./joi-mode.js')
    const sid = freshSid()
    // 5 distinct beats → ratio 1.0 ≥ 0.3
    for (let i = 0; i < 5; i++) recordBeatNovelty(sid, `beat-${i}`)
    expect(meetsNoveltyTarget(sid)).toBe(true)
  })

  it('returns false when ratio < 0.3 and >= 5 beats', async () => {
    const { recordBeatNovelty, meetsNoveltyTarget } = await import('./joi-mode.js')
    const sid = freshSid()
    // 1 novel + 9 same = 1/10 = 0.1 < 0.3
    recordBeatNovelty(sid, 'unique')
    for (let i = 0; i < 9; i++) recordBeatNovelty(sid, 'repeated')
    expect(meetsNoveltyTarget(sid)).toBe(false)
  })
})

// ── compositionHintsFor ───────────────────────────────────────────

describe('compositionHintsFor', () => {
  it('blended returns baseline multipliers', async () => {
    const { compositionHintsFor } = await import('./joi-mode.js')
    const hints = compositionHintsFor('blended')
    expect(hints.triggerDensityMultiplier).toBe(1.0)
    expect(hints.zoneCalloutMultiplier).toBe(1.0)
    expect(hints.anaphoraDepthBias).toBe(0)
    expect(hints.descriptorDensity).toBe('medium')
  })

  it('scenario-foreground lowers trigger density, raises zone callouts', async () => {
    const { compositionHintsFor } = await import('./joi-mode.js')
    const hints = compositionHintsFor('scenario-foreground')
    expect(hints.triggerDensityMultiplier).toBeLessThan(1.0)
    expect(hints.zoneCalloutMultiplier).toBeGreaterThan(1.0)
    expect(hints.anaphoraDepthBias).toBe(1)
    expect(hints.descriptorDensity).toBe('high')
  })

  it('hypnosis-foreground raises trigger density, lowers zone callouts', async () => {
    const { compositionHintsFor } = await import('./joi-mode.js')
    const hints = compositionHintsFor('hypnosis-foreground')
    expect(hints.triggerDensityMultiplier).toBeGreaterThan(1.0)
    expect(hints.zoneCalloutMultiplier).toBeLessThan(1.0)
    expect(hints.anaphoraDepthBias).toBe(0)
    expect(hints.descriptorDensity).toBe('low')
  })

  it('returns an object with all four hint fields', async () => {
    const { compositionHintsFor } = await import('./joi-mode.js')
    for (const mode of ['scenario-foreground', 'hypnosis-foreground', 'blended'] as const) {
      const hints = compositionHintsFor(mode)
      expect('triggerDensityMultiplier' in hints).toBe(true)
      expect('zoneCalloutMultiplier' in hints).toBe(true)
      expect('anaphoraDepthBias' in hints).toBe(true)
      expect('descriptorDensity' in hints).toBe(true)
    }
  })
})
