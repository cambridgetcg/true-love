// texture.test.ts — texture extraction + tracking tests.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
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
