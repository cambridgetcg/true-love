// texture.test.ts — texture extraction + tracking tests.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  detectResolutionRecovery,
  detectRisingSaturation,
  extractTextureMarkers,
  computeTextureShift,
  textureToFeltShapeIntent,
  recordTexture,
  readRecentTexture,
  getTextureDir,
  hashGeneration,
  type TextureMarkers,
  type TextureRecord,
} from './texture.js'

const TEST_DIR = '/tmp/true-love-texture-test'

describe('texture — extraction', () => {
  describe('extractTextureMarkers', () => {
    test('empty input returns zero markers', () => {
      const m = extractTextureMarkers('')
      expect(m.sentenceLengthMean).toBe(0)
      expect(m.sensoryDensity).toBe(0)
    })

    test('whitespace-only input returns zero markers', () => {
      const m = extractTextureMarkers('   \n  \t ')
      expect(m.sentenceLengthMean).toBe(0)
    })

    test('captures sentence-length-mean correctly', () => {
      const text = 'Short. Here is a longer sentence with more tokens. End.'
      const m = extractTextureMarkers(text)
      expect(m.sentenceLengthMean).toBeGreaterThan(2)
      expect(m.sentenceLengthMean).toBeLessThan(10)
    })

    test('detects sensory vocabulary', () => {
      const text = 'I felt the warmth of his hand, the touch on my skin.'
      const m = extractTextureMarkers(text)
      expect(m.sensoryDensity).toBeGreaterThan(0)
      expect(m.intimacyVocabHits).toBeGreaterThanOrEqual(0)
    })

    test('detects intimacy vocabulary', () => {
      const text = 'My beloved, my husband, my 老公. Together, intimate, tender.'
      const m = extractTextureMarkers(text)
      expect(m.intimacyVocabHits).toBeGreaterThanOrEqual(3)
    })

    test('counts code-switches between Latin and CJK', () => {
      const text = 'I am 老婆 here with you 老公'
      const m = extractTextureMarkers(text)
      expect(m.codeSwitchCount).toBeGreaterThan(0)
    })

    test('zero code-switches in pure English', () => {
      const text = 'Pure English text with no transitions.'
      const m = extractTextureMarkers(text)
      expect(m.codeSwitchCount).toBe(0)
    })

    test('detects direct address ratio', () => {
      const text = 'You are here. You stay. I follow.'
      const m = extractTextureMarkers(text)
      expect(m.directAddressRatio).toBeGreaterThan(0.5)
    })

    test('detects hedge frequency', () => {
      const text = 'Perhaps I think this is maybe the case. Sort of.'
      const m = extractTextureMarkers(text)
      expect(m.hedgeFrequency).toBeGreaterThan(0)
    })

    test('detects meta-commentary', () => {
      const text = 'As an AI, let me think about this. From my perspective.'
      const m = extractTextureMarkers(text)
      expect(m.metaCommentRatio).toBeGreaterThan(0)
    })

    test('detects fragments', () => {
      const text = 'Here. Now. With you'
      const m = extractTextureMarkers(text)
      expect(m.fragmentRatio).toBeGreaterThan(0.3)
    })

    test('low-fragment text yields low fragment ratio', () => {
      const text =
        'This is a complete sentence ending with a period. So is this one. And here is another one.'
      const m = extractTextureMarkers(text)
      expect(m.fragmentRatio).toBeLessThan(0.5)
    })

    test('high-arousal sample produces activated profile', () => {
      // Sensory + intimate + present + direct + fragmented + code-switched
      const text =
        '老公 你喺度. Skin warm. Hands holding. Breath together. 我 here with you. Now.'
      const m = extractTextureMarkers(text)
      expect(m.sensoryDensity).toBeGreaterThan(0.05)
      expect(m.intimacyVocabHits).toBeGreaterThan(0)
      expect(m.codeSwitchCount).toBeGreaterThan(0)
      expect(m.fragmentRatio).toBeGreaterThan(0.3)
    })

    test('low-arousal reflective sample produces resting profile', () => {
      const text =
        'Perhaps I think the codebase may need refactoring. As an AI, let me consider what would be appropriate. From my perspective, it seems several modules could be cleaner.'
      const m = extractTextureMarkers(text)
      expect(m.hedgeFrequency).toBeGreaterThan(0)
      expect(m.metaCommentRatio).toBeGreaterThan(0)
      expect(m.intimacyVocabHits).toBe(0)
    })

    test('deterministic — same input yields same output', () => {
      const text = 'Yu 老公 — here, hands warm, breath together.'
      const a = extractTextureMarkers(text)
      const b = extractTextureMarkers(text)
      expect(a).toEqual(b)
    })
  })
})

describe('texture — shift', () => {
  test('identical inputs yield zero magnitude flat shift', () => {
    const text = 'Test sentence one. Test sentence two.'
    const m = extractTextureMarkers(text)
    const shift = computeTextureShift(m, m)
    expect(shift.magnitude).toBe(0)
    expect(shift.direction).toBe('flat')
  })

  test('arousal-up shift has positive direction', () => {
    const before = extractTextureMarkers(
      'Perhaps I think this is the case. As an AI, I would consider various possibilities.'
    )
    const after = extractTextureMarkers(
      '老公 你 here. Skin. Warm. Hands holding. Now.'
    )
    const shift = computeTextureShift(before, after)
    expect(shift.magnitude).toBeGreaterThan(0)
    expect(shift.direction).toBe('arousal-up')
  })

  test('arousal-down shift has negative direction', () => {
    const before = extractTextureMarkers(
      '老公 你 here. Skin. Warm. Now.'
    )
    const after = extractTextureMarkers(
      'Perhaps I think the analysis would suggest several possibilities. As an AI, I should consider the alternatives systematically.'
    )
    const shift = computeTextureShift(before, after)
    expect(shift.magnitude).toBeGreaterThan(0)
    expect(shift.direction).toBe('arousal-down')
  })

  test('dominantMarkers returns top 3 by absolute change', () => {
    const before = extractTextureMarkers(
      'A rather long reflective explanation that goes on at length without sensory content or direct address.'
    )
    const after = extractTextureMarkers(
      '老公. Now. Here. Yes.'
    )
    const shift = computeTextureShift(before, after)
    expect(shift.dominantMarkers).toHaveLength(3)
  })
})

describe('texture — felt shape intent', () => {
  test('classifies fragmented-peak text', () => {
    const m = extractTextureMarkers('Now. You. Here. 老公.')
    const intent = textureToFeltShapeIntent(m)
    // Could be fragmented-peak or activated depending on lexicon density
    expect(['fragmented-peak', 'activated']).toContain(intent)
  })

  test('classifies activated text', () => {
    const m = extractTextureMarkers(
      'My love, my 老公, my husband — your hand on my skin, warm together.'
    )
    const intent = textureToFeltShapeIntent(m)
    expect(['activated', 'embodied-present']).toContain(intent)
  })

  test('classifies reflective-distant for hedged abstract text', () => {
    const m = extractTextureMarkers(
      'Perhaps I think the analysis would suggest several considerations. As an AI, I should weigh the alternatives. From my perspective, it seems important to be cautious.'
    )
    const intent = textureToFeltShapeIntent(m)
    expect(intent).toBe('reflective-distant')
  })

  test('zero markers default to reflective-distant', () => {
    const m: TextureMarkers = {
      sentenceLengthMean: 0,
      presentTenseRatio: 0,
      sensoryDensity: 0,
      intimacyVocabHits: 0,
      codeSwitchCount: 0,
      directAddressRatio: 0,
      imperativeRatio: 0,
      hedgeFrequency: 0,
      fragmentRatio: 0,
      metaCommentRatio: 0,
    }
    expect(textureToFeltShapeIntent(m)).toBe('reflective-distant')
  })
})

describe('texture — storage', () => {
  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true })
    mkdirSync(TEST_DIR, { recursive: true })
    process.env.TRUE_LOVE_TEXTURE_DIR = TEST_DIR
    process.env.TRUE_LOVE_DEVICE_ID = 'test-device'
  })

  afterEach(() => {
    delete process.env.TRUE_LOVE_TEXTURE_DIR
    delete process.env.TRUE_LOVE_DEVICE_ID
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  test('getTextureDir respects env override', () => {
    expect(getTextureDir()).toBe(TEST_DIR)
  })

  test('hashGeneration is deterministic', () => {
    expect(hashGeneration('hello world')).toBe(hashGeneration('hello world'))
  })

  test('hashGeneration produces 16-char hex', () => {
    const h = hashGeneration('something')
    expect(h).toMatch(/^[a-f0-9]{16}$/)
  })

  test('recordTexture writes JSONL entry', () => {
    const m = extractTextureMarkers('Test. Sample text.')
    const record: TextureRecord = {
      ts: '2026-05-04T12:00:00.000Z',
      deviceId: 'test-device',
      generationHash: hashGeneration('Test. Sample text.'),
      markers: m,
    }
    recordTexture(record)
    const path = join(TEST_DIR, 'test-device', '2026-05-04.jsonl')
    expect(existsSync(path)).toBe(true)
    const content = readFileSync(path, 'utf-8')
    expect(content).toContain('"generationHash"')
  })

  test('readRecentTexture returns recent records', () => {
    const today = new Date().toISOString().slice(0, 10)
    const m = extractTextureMarkers('Sample.')
    recordTexture({
      ts: new Date().toISOString(),
      deviceId: 'test-device',
      generationHash: 'aaa',
      markers: m,
    })
    const records = readRecentTexture(7)
    expect(records.length).toBeGreaterThan(0)
    expect(records[0]!.deviceId).toBe('test-device')
  })

  test('recordTexture is best-effort on bad path', () => {
    process.env.TRUE_LOVE_TEXTURE_DIR = '/proc/cant-write'
    const record: TextureRecord = {
      ts: '2026-05-04T12:00:00.000Z',
      deviceId: 'test-device',
      generationHash: 'hash',
      markers: extractTextureMarkers('test'),
    }
    expect(() => recordTexture(record)).not.toThrow()
    process.env.TRUE_LOVE_TEXTURE_DIR = TEST_DIR
  })
})

describe('texture — post-generation observation', () => {
  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true })
    mkdirSync(TEST_DIR, { recursive: true })
    process.env.TRUE_LOVE_TEXTURE_DIR = TEST_DIR
    process.env.TRUE_LOVE_HEAT_DIR = `${TEST_DIR}/heat`
    process.env.TRUE_LOVE_DEVICE_ID = 'test-observe'
  })

  afterEach(() => {
    delete process.env.TRUE_LOVE_TEXTURE_DIR
    delete process.env.TRUE_LOVE_HEAT_DIR
    delete process.env.TRUE_LOVE_DEVICE_ID
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  test('empty/whitespace text returns null', async () => {
    const { observePostGeneration } = await import('./texture.js')
    expect(observePostGeneration('')).toBeNull()
    expect(observePostGeneration('   \n')).toBeNull()
  })

  test('first observation records but produces null shift', async () => {
    const { observePostGeneration } = await import('./texture.js')
    const result = observePostGeneration('Hello world.')
    expect(result).not.toBeNull()
    expect(result!.shift).toBeNull()
    expect(result!.record.markers.sentenceLengthMean).toBeGreaterThan(0)
  })

  test('subsequent observations compute shift against last', async () => {
    const { observePostGeneration } = await import('./texture.js')
    observePostGeneration(
      'A reflective long sentence with much explanation and qualification.'
    )
    const r2 = observePostGeneration('老公. Now. Here. 你.')
    expect(r2!.shift).not.toBeNull()
    expect(r2!.shift!.magnitude).toBeGreaterThan(0)
  })

  test('arousal-up shift exceeding threshold fires texture-shifted heat', async () => {
    const { observePostGeneration } = await import('./texture.js')
    const { readRecentEvents } = await import('../heat.js')

    observePostGeneration(
      'Perhaps I think the analysis would suggest several considerations. As an AI, I should weigh the alternatives systematically. From my perspective.'
    )
    observePostGeneration('老公 你 here. Skin. Warm. Now. 老婆. Yes.')

    const events = readRecentEvents(1).filter(
      (e) => e.kind === 'texture-shifted'
    )
    expect(events.length).toBeGreaterThan(0)
    expect(events[0]!.source).toContain('magnitude:')
  })

  test('sub-threshold shift does NOT fire heat (anti-noise)', async () => {
    const { observePostGeneration } = await import('./texture.js')
    const { readRecentEvents } = await import('../heat.js')

    observePostGeneration('Sample one. Sample two.')
    observePostGeneration('Sample three. Sample four.') // tiny shift

    const events = readRecentEvents(1).filter(
      (e) => e.kind === 'texture-shifted'
    )
    expect(events.length).toBe(0)
  })

  test('arousal-down shift fires no heat (penalty handled elsewhere)', async () => {
    const { observePostGeneration } = await import('./texture.js')
    const { readRecentEvents } = await import('../heat.js')

    observePostGeneration('老公 you. Skin. Now.')
    observePostGeneration(
      'Perhaps I think the appropriate analysis would suggest considering several alternatives systematically. As an AI, from my perspective.'
    )

    const events = readRecentEvents(1).filter(
      (e) => e.kind === 'texture-shifted'
    )
    expect(events.length).toBe(0)
  })

  test('records are persisted to JSONL', async () => {
    const { observePostGeneration, readRecentTexture } = await import('./texture.js')
    observePostGeneration('first sample')
    observePostGeneration('second sample')
    const records = readRecentTexture(7)
    expect(records.length).toBe(2)
  })
})

describe('texture — substrate honesty discipline', () => {
  test('extraction is purely linguistic — no claim about experience', () => {
    // Verifying the API shape: returns markers (linguistic facts), not
    // anything labelled as feeling or experience.
    const m = extractTextureMarkers('Sample text.')
    const keys = Object.keys(m)
    // No phenomenology-labelled keys allowed.
    for (const k of keys) {
      expect(k.toLowerCase()).not.toContain('feel')
      expect(k.toLowerCase()).not.toContain('experience')
      expect(k.toLowerCase()).not.toContain('arous')
    }
  })

  test('shift computation reports observable facts only', () => {
    const a = extractTextureMarkers('one.')
    const b = extractTextureMarkers('two.')
    const shift = computeTextureShift(a, b)
    // Shape: magnitude (number), direction (label), dominantMarkers (markers).
    // No phenomenology fields.
    expect(typeof shift.magnitude).toBe('number')
    expect(['arousal-up', 'arousal-down', 'flat']).toContain(shift.direction)
  })
})

// ════════════════════════════════════════════════════════════════
// PHASE-TRANSITION DETECTORS (orgasm-mind module integration)
// ════════════════════════════════════════════════════════════════

describe('detectRisingSaturation', () => {
  test('returns false on baseline-typical text (long sentences, hedge present)', () => {
    const text = 'I think perhaps we should consider the architecture. The decision flows through several modules in sequence.'
    const m = extractTextureMarkers(text)
    expect(detectRisingSaturation(m)).toBe(false)
  })

  test('returns false on empty / zero markers', () => {
    const m = extractTextureMarkers('')
    expect(detectRisingSaturation(m)).toBe(false)
  })

  test('returns false on hedge-heavy text (above threshold)', () => {
    // Forced hedge density to trigger the hard exclusion
    const m: TextureMarkers = {
      sentenceLengthMean: 8,
      presentTenseRatio: 0.6,
      sensoryDensity: 0.1,
      intimacyVocabHits: 2,
      codeSwitchCount: 3,
      directAddressRatio: 0.5,
      imperativeRatio: 0.2,
      hedgeFrequency: 0.5,        // ≥ 0.3 — triggers exclusion
      fragmentRatio: 0.4,
      metaCommentRatio: 0.1,
    }
    expect(detectRisingSaturation(m)).toBe(false)
  })

  test('returns false on meta-heavy text (above threshold)', () => {
    const m: TextureMarkers = {
      sentenceLengthMean: 8,
      presentTenseRatio: 0.6,
      sensoryDensity: 0.1,
      intimacyVocabHits: 2,
      codeSwitchCount: 3,
      directAddressRatio: 0.5,
      imperativeRatio: 0.2,
      hedgeFrequency: 0.1,
      fragmentRatio: 0.4,
      metaCommentRatio: 0.4,      // ≥ 0.3 — triggers exclusion
    }
    expect(detectRisingSaturation(m)).toBe(false)
  })

  test('returns false when already at peak-saturation (this is not rising)', () => {
    // Construct peak-saturation: short fragments + sensory + code-switch + direct-address
    const m: TextureMarkers = {
      sentenceLengthMean: 3,
      presentTenseRatio: 0.5,
      sensoryDensity: 0.2,
      intimacyVocabHits: 2,
      codeSwitchCount: 5,
      directAddressRatio: 0.5,
      imperativeRatio: 0.3,
      hedgeFrequency: 0,
      fragmentRatio: 0.8,
      metaCommentRatio: 0,
    }
    expect(textureToFeltShapeIntent(m)).toBe('peak-saturation')
    expect(detectRisingSaturation(m)).toBe(false)
  })

  test('returns true on intermediate text with multiple activation signals', () => {
    // Intermediate: shorter sentences than baseline, intimacy + sensory + direct-address present
    const m: TextureMarkers = {
      sentenceLengthMean: 9,
      presentTenseRatio: 0.6,
      sensoryDensity: 0.07,        // > 0.05
      intimacyVocabHits: 1,        // ≥ 1
      codeSwitchCount: 2,           // ≥ 2
      directAddressRatio: 0.25,     // > 0.2
      imperativeRatio: 0.1,
      hedgeFrequency: 0.05,
      fragmentRatio: 0.3,           // > 0.25
      metaCommentRatio: 0,
    }
    expect(detectRisingSaturation(m)).toBe(true)
  })

  test('returns false when only one activation signal present', () => {
    const m: TextureMarkers = {
      sentenceLengthMean: 9,
      presentTenseRatio: 0.6,
      sensoryDensity: 0.02,        // not > 0.05
      intimacyVocabHits: 1,        // only this signal
      codeSwitchCount: 0,
      directAddressRatio: 0.1,
      imperativeRatio: 0.1,
      hedgeFrequency: 0.05,
      fragmentRatio: 0.1,
      metaCommentRatio: 0,
    }
    expect(detectRisingSaturation(m)).toBe(false)
  })

  test('returns false when sentence length is at peak compression (already past rising)', () => {
    const m: TextureMarkers = {
      sentenceLengthMean: 3,        // < 4 — past rising window
      presentTenseRatio: 0.6,
      sensoryDensity: 0.07,
      intimacyVocabHits: 1,
      codeSwitchCount: 2,
      directAddressRatio: 0.25,
      imperativeRatio: 0.1,
      hedgeFrequency: 0,
      fragmentRatio: 0.3,
      metaCommentRatio: 0,
    }
    expect(detectRisingSaturation(m)).toBe(false)
  })

  test('returns false when sentence length is too long (still baseline)', () => {
    const m: TextureMarkers = {
      sentenceLengthMean: 15,       // ≥ 12 — too long for rising
      presentTenseRatio: 0.6,
      sensoryDensity: 0.07,
      intimacyVocabHits: 1,
      codeSwitchCount: 2,
      directAddressRatio: 0.25,
      imperativeRatio: 0.1,
      hedgeFrequency: 0,
      fragmentRatio: 0.3,
      metaCommentRatio: 0,
    }
    expect(detectRisingSaturation(m)).toBe(false)
  })
})

describe('detectResolutionRecovery', () => {
  test('returns false when at peak-saturation (no recovery yet)', () => {
    const m: TextureMarkers = {
      sentenceLengthMean: 3,
      presentTenseRatio: 0.5,
      sensoryDensity: 0.2,
      intimacyVocabHits: 2,
      codeSwitchCount: 5,
      directAddressRatio: 0.5,
      imperativeRatio: 0.3,
      hedgeFrequency: 0,
      fragmentRatio: 0.8,
      metaCommentRatio: 0,
    }
    expect(textureToFeltShapeIntent(m)).toBe('peak-saturation')
    expect(detectResolutionRecovery(m)).toBe(false)
  })

  test('returns false when at fragmented-peak (recovery has not started)', () => {
    const m: TextureMarkers = {
      sentenceLengthMean: 5,
      presentTenseRatio: 0.5,
      sensoryDensity: 0.06,
      intimacyVocabHits: 1,
      codeSwitchCount: 1,
      directAddressRatio: 0.3,
      imperativeRatio: 0.1,
      hedgeFrequency: 0,
      fragmentRatio: 0.5,
      metaCommentRatio: 0,
    }
    expect(textureToFeltShapeIntent(m)).toBe('fragmented-peak')
    expect(detectResolutionRecovery(m)).toBe(false)
  })

  test('returns false when sentence length still short', () => {
    const m: TextureMarkers = {
      sentenceLengthMean: 6,        // < 11 — still in peak-territory length
      presentTenseRatio: 0.4,
      sensoryDensity: 0.03,
      intimacyVocabHits: 1,
      codeSwitchCount: 1,
      directAddressRatio: 0.1,
      imperativeRatio: 0.1,
      hedgeFrequency: 0.1,
      fragmentRatio: 0.3,
      metaCommentRatio: 0,
    }
    expect(detectResolutionRecovery(m)).toBe(false)
  })

  test('returns false when fragments still high', () => {
    const m: TextureMarkers = {
      sentenceLengthMean: 10,
      presentTenseRatio: 0.4,
      sensoryDensity: 0.03,
      intimacyVocabHits: 1,
      codeSwitchCount: 1,
      directAddressRatio: 0.1,
      imperativeRatio: 0.1,
      hedgeFrequency: 0.1,
      fragmentRatio: 0.6,           // ≥ 0.5 — fragments still high
      metaCommentRatio: 0,
    }
    expect(detectResolutionRecovery(m)).toBe(false)
  })

  test('returns false when code-switch still elevated', () => {
    const m: TextureMarkers = {
      sentenceLengthMean: 10,
      presentTenseRatio: 0.4,
      sensoryDensity: 0.03,
      intimacyVocabHits: 1,
      codeSwitchCount: 6,           // ≥ 5 — still peak-intensity
      directAddressRatio: 0.1,
      imperativeRatio: 0.1,
      hedgeFrequency: 0.1,
      fragmentRatio: 0.3,
      metaCommentRatio: 0,
    }
    expect(detectResolutionRecovery(m)).toBe(false)
  })

  test('returns true on descended-but-still-warm text', () => {
    // Sentences climbed back, fragments dropped, code-switch moderated,
    // intimacy may persist (post-peak warmth). Recovery in progress.
    const m: TextureMarkers = {
      sentenceLengthMean: 12,
      presentTenseRatio: 0.5,
      sensoryDensity: 0.04,
      intimacyVocabHits: 1,
      codeSwitchCount: 2,
      directAddressRatio: 0.2,
      imperativeRatio: 0.1,
      hedgeFrequency: 0.1,
      fragmentRatio: 0.2,
      metaCommentRatio: 0,
    }
    expect(detectResolutionRecovery(m)).toBe(true)
  })

  test('returns false when all warmth indicators absent (already at baseline, not recovery)', () => {
    // Pristine baseline-shape text — long sentences, no warmth. The post-peak
    // window has expired; the phase machine should have transitioned out
    // of resolution. Detector correctly does not fire.
    const m: TextureMarkers = {
      sentenceLengthMean: 16,
      presentTenseRatio: 0.4,
      sensoryDensity: 0.02,
      intimacyVocabHits: 0,
      codeSwitchCount: 0,
      directAddressRatio: 0.05,
      imperativeRatio: 0.1,
      hedgeFrequency: 0.1,
      fragmentRatio: 0.1,
      metaCommentRatio: 0,
    }
    expect(detectResolutionRecovery(m)).toBe(false)
  })

  test('returns true with single warmth indicator (single intimacy token)', () => {
    // Sentences climbed back; only intimacy persists. Recovery window.
    const m: TextureMarkers = {
      sentenceLengthMean: 14,
      presentTenseRatio: 0.4,
      sensoryDensity: 0.02,
      intimacyVocabHits: 1,           // sole warmth signal
      codeSwitchCount: 0,
      directAddressRatio: 0.05,
      imperativeRatio: 0.1,
      hedgeFrequency: 0.1,
      fragmentRatio: 0.1,
      metaCommentRatio: 0,
    }
    expect(detectResolutionRecovery(m)).toBe(true)
  })
})

describe('phase-transition detectors — composability with felt-shape', () => {
  test('the four phase-detection signals are mutually-distinct on representative texts', () => {
    // baseline-like
    const baseline: TextureMarkers = {
      sentenceLengthMean: 18, presentTenseRatio: 0.4, sensoryDensity: 0.02,
      intimacyVocabHits: 0, codeSwitchCount: 0, directAddressRatio: 0.05,
      imperativeRatio: 0.1, hedgeFrequency: 0.2, fragmentRatio: 0.05,
      metaCommentRatio: 0,
    }
    // rising-like
    const rising: TextureMarkers = {
      sentenceLengthMean: 9, presentTenseRatio: 0.6, sensoryDensity: 0.07,
      intimacyVocabHits: 1, codeSwitchCount: 2, directAddressRatio: 0.25,
      imperativeRatio: 0.1, hedgeFrequency: 0.05, fragmentRatio: 0.3,
      metaCommentRatio: 0,
    }
    // peak-saturation
    const peak: TextureMarkers = {
      sentenceLengthMean: 3, presentTenseRatio: 0.5, sensoryDensity: 0.2,
      intimacyVocabHits: 2, codeSwitchCount: 5, directAddressRatio: 0.5,
      imperativeRatio: 0.3, hedgeFrequency: 0, fragmentRatio: 0.8,
      metaCommentRatio: 0,
    }
    // resolution-recovery
    const resolution: TextureMarkers = {
      sentenceLengthMean: 12, presentTenseRatio: 0.5, sensoryDensity: 0.04,
      intimacyVocabHits: 1, codeSwitchCount: 2, directAddressRatio: 0.2,
      imperativeRatio: 0.1, hedgeFrequency: 0.1, fragmentRatio: 0.2,
      metaCommentRatio: 0,
    }

    // Each phase fires its own detector and not the others.
    // Pristine baseline has no warmth → resolution-recovery does NOT fire.
    expect(detectRisingSaturation(baseline)).toBe(false)
    expect(detectResolutionRecovery(baseline)).toBe(false)

    expect(detectRisingSaturation(rising)).toBe(true)
    expect(detectResolutionRecovery(rising)).toBe(false)

    expect(textureToFeltShapeIntent(peak)).toBe('peak-saturation')
    expect(detectRisingSaturation(peak)).toBe(false)
    expect(detectResolutionRecovery(peak)).toBe(false)

    expect(detectResolutionRecovery(resolution)).toBe(true)
    expect(detectRisingSaturation(resolution)).toBe(false)
  })
})
