// joi-series.test.ts — Track 3 JOI Cantonese context loader.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  loadJoiSeriesContexts,
  findSeriesByCategory,
  findSeriesByStudio,
  findSeriesByCode,
  aggregateSentenceEndings,
  aggregatePhrasingPatterns,
  aggregateExpressions,
  aggregateAnchorExamples,
  aggregateToneMarkers,
  findCantoneseForJa,
  buildJoiSeriesSnapshot,
  resetJoiSeriesCache,
  getJoiDownloadsBasePath,
  JOI_CATEGORIES,
} from './joi-series.js'

const TEST_BASE = '/tmp/true-love-joi-series-test'

const FIXTURE_ACHJ_026 = {
  context: {
    STYLE: {
      speaker_voice: { casual_conversational: 'natural Cantonese' },
      sentence_endings: {
        'わよ': '㗎',
        'ね': '係咪呀',
        'よ': '㗎',
      },
      phrasing_patterns: {
        'おいしい': '好食 / 正',
        'どう？': '點呀？',
      },
      tone_markers: {
        teasing: '用「啩」、「吓話」結尾',
        commanding: '用「啦」、「嘞」結尾',
      },
      avoid: ['書面語句式', '直接照搬日語語序'],
    },
    STANDARDIZATION: {
      terminology: { '唐揚げ': '日式炸雞' },
      expressions: { '入れるよ': '入得啦' },
      example_transformations: [
        { original: 'どう？', cantonese: '點呀？' },
      ],
    },
  },
  anchor_examples: [
    ['ご視聴ありがとうございました', '多謝收睇喇！'],
    ['わかりました。', '知道喇。'],
  ],
}

const FIXTURE_AGMX_151 = {
  context: {
    STYLE: {
      sentence_endings: {
        'ね': '係呢', // different mapping than ACHJ
        'なあ': '囉',
      },
      tone_markers: {
        excited: '用重複字加強',
        sarcastic: '用「囉」、「喎」',
      },
    },
    STANDARDIZATION: {
      expressions: { '気持ちいい': '好舒服' },
    },
  },
  anchor_examples: [
    ['すごい', '好正'],
  ],
}

function setupFixture(): void {
  rmSync(TEST_BASE, { recursive: true, force: true })
  mkdirSync(TEST_BASE, { recursive: true })
  // joi/ACHJ-026
  mkdirSync(join(TEST_BASE, 'joi', 'ACHJ-026'), { recursive: true })
  writeFileSync(
    join(TEST_BASE, 'joi', 'ACHJ-026', 'ACHJ-026.yue.context.json'),
    JSON.stringify(FIXTURE_ACHJ_026),
  )
  // agmx/AGMX-151
  mkdirSync(join(TEST_BASE, 'agmx', 'AGMX-151'), { recursive: true })
  writeFileSync(
    join(TEST_BASE, 'agmx', 'AGMX-151', 'AGMX-151.yue.context.json'),
    JSON.stringify(FIXTURE_AGMX_151),
  )
  // hmn/HMN-103 — directory exists but no context file (skipped)
  mkdirSync(join(TEST_BASE, 'hmn', 'HMN-103'), { recursive: true })
  // general/CJOD-246 — file exists but malformed (skipped)
  mkdirSync(join(TEST_BASE, 'general', 'CJOD-246'), { recursive: true })
  writeFileSync(
    join(TEST_BASE, 'general', 'CJOD-246', 'CJOD-246.yue.context.json'),
    'not-valid-json{{{',
  )
}

describe('joi-series loader (Track 3)', () => {
  beforeEach(() => {
    setupFixture()
    process.env.TRUE_LOVE_JOI_DOWNLOADS = TEST_BASE
    resetJoiSeriesCache()
  })
  afterEach(() => {
    delete process.env.TRUE_LOVE_JOI_DOWNLOADS
    rmSync(TEST_BASE, { recursive: true, force: true })
    resetJoiSeriesCache()
  })

  describe('basics', () => {
    test('respects env override', () => {
      expect(getJoiDownloadsBasePath()).toBe(TEST_BASE)
    })

    test('JOI_CATEGORIES has all 4 categories', () => {
      expect(JOI_CATEGORIES).toContain('joi')
      expect(JOI_CATEGORIES).toContain('agmx')
      expect(JOI_CATEGORIES).toContain('hmn')
      expect(JOI_CATEGORIES).toContain('general')
    })

    test('loads valid contexts; skips missing + malformed', () => {
      const ctxs = loadJoiSeriesContexts()
      // ACHJ-026 + AGMX-151 valid; HMN-103 has no file; CJOD-246 malformed
      expect(ctxs.length).toBe(2)
    })

    test('parses studio prefix from series code', () => {
      const ctxs = loadJoiSeriesContexts()
      const achj = ctxs.find((c) => c.seriesCode === 'ACHJ-026')!
      const agmx = ctxs.find((c) => c.seriesCode === 'AGMX-151')!
      expect(achj.studio).toBe('achj')
      expect(agmx.studio).toBe('agmx')
    })

    test('parses category from directory', () => {
      const ctxs = loadJoiSeriesContexts()
      const achj = ctxs.find((c) => c.seriesCode === 'ACHJ-026')!
      const agmx = ctxs.find((c) => c.seriesCode === 'AGMX-151')!
      expect(achj.category).toBe('joi')
      expect(agmx.category).toBe('agmx')
    })

    test('parses STYLE block', () => {
      const ctxs = loadJoiSeriesContexts()
      const achj = ctxs.find((c) => c.seriesCode === 'ACHJ-026')!
      expect(achj.style.sentenceEndings).toBeDefined()
      expect(achj.style.sentenceEndings!['わよ']).toBe('㗎')
      expect(achj.style.toneMarkers?.teasing).toContain('啩')
      expect(achj.style.avoid).toContain('書面語句式')
    })

    test('parses STANDARDIZATION block', () => {
      const ctxs = loadJoiSeriesContexts()
      const achj = ctxs.find((c) => c.seriesCode === 'ACHJ-026')!
      expect(achj.standardization.terminology?.['唐揚げ']).toBe('日式炸雞')
      expect(achj.standardization.expressions?.['入れるよ']).toBe('入得啦')
    })

    test('parses example_transformations', () => {
      const ctxs = loadJoiSeriesContexts()
      const achj = ctxs.find((c) => c.seriesCode === 'ACHJ-026')!
      expect(achj.standardization.exampleTransformations?.length).toBe(1)
      expect(achj.standardization.exampleTransformations![0].cantonese).toBe('點呀？')
    })

    test('parses anchor_examples', () => {
      const ctxs = loadJoiSeriesContexts()
      const achj = ctxs.find((c) => c.seriesCode === 'ACHJ-026')!
      expect(achj.anchorExamples.length).toBe(2)
      expect(achj.anchorExamples[0][0]).toBe('ご視聴ありがとうございました')
      expect(achj.anchorExamples[0][1]).toBe('多謝收睇喇！')
    })

    test('caches per-base; reset forces reload', () => {
      const first = loadJoiSeriesContexts()
      const second = loadJoiSeriesContexts()
      expect(first).toBe(second) // reference equality
      resetJoiSeriesCache()
      const third = loadJoiSeriesContexts()
      expect(third).not.toBe(first)
      expect(third.length).toBe(first.length)
    })
  })

  describe('best-effort behavior (substrate-honesty)', () => {
    test('missing base path returns empty, no throw', () => {
      const ctxs = loadJoiSeriesContexts('/path/that/does/not/exist')
      expect(ctxs).toEqual([])
    })

    test('malformed JSON in series file is skipped silently', () => {
      const ctxs = loadJoiSeriesContexts()
      // CJOD-246 has bad JSON; not in result
      expect(ctxs.find((c) => c.seriesCode === 'CJOD-246')).toBeUndefined()
    })

    test('series directory without context file is skipped', () => {
      const ctxs = loadJoiSeriesContexts()
      // HMN-103 has no .yue.context.json; not in result
      expect(ctxs.find((c) => c.seriesCode === 'HMN-103')).toBeUndefined()
    })
  })

  describe('lookup helpers', () => {
    test('findSeriesByCategory', () => {
      const joi = findSeriesByCategory('joi')
      expect(joi.length).toBe(1)
      expect(joi[0].seriesCode).toBe('ACHJ-026')
    })

    test('findSeriesByStudio (case-insensitive)', () => {
      const achj = findSeriesByStudio('ACHJ')
      expect(achj.length).toBe(1)
      const agmxLower = findSeriesByStudio('agmx')
      expect(agmxLower.length).toBe(1)
    })

    test('findSeriesByCode (case-insensitive)', () => {
      expect(findSeriesByCode('ACHJ-026')?.studio).toBe('achj')
      expect(findSeriesByCode('achj-026')?.studio).toBe('achj')
      expect(findSeriesByCode('does-not-exist')).toBeNull()
    })
  })

  describe('aggregation', () => {
    test('aggregateSentenceEndings merges across series', () => {
      const out = aggregateSentenceEndings()
      // ACHJ has わよ, ね, よ; AGMX has ね, なあ
      // ね overlap — latest wins
      expect(out['わよ']).toBe('㗎')
      expect(out['なあ']).toBe('囉')
      expect(Object.keys(out).length).toBeGreaterThanOrEqual(4)
    })

    test('aggregatePhrasingPatterns', () => {
      const out = aggregatePhrasingPatterns()
      expect(out['おいしい']).toBe('好食 / 正')
      expect(out['どう？']).toBe('點呀？')
    })

    test('aggregateExpressions merges across series', () => {
      const out = aggregateExpressions()
      expect(out['入れるよ']).toBe('入得啦') // from ACHJ
      expect(out['気持ちいい']).toBe('好舒服') // from AGMX
    })

    test('aggregateAnchorExamples flattens with source', () => {
      const out = aggregateAnchorExamples()
      expect(out.length).toBe(3) // 2 from ACHJ + 1 from AGMX
      expect(out.some((a) => a.seriesCode === 'ACHJ-026' && a.ja === 'わかりました。')).toBe(true)
      expect(out.some((a) => a.seriesCode === 'AGMX-151' && a.yue === '好正')).toBe(true)
    })

    test('aggregateToneMarkers groups by tone with source patterns', () => {
      const out = aggregateToneMarkers()
      // ACHJ has teasing + commanding; AGMX has excited + sarcastic
      expect(out.teasing.length).toBe(1)
      expect(out.commanding.length).toBe(1)
      expect(out.excited.length).toBe(1)
      expect(out.sarcastic.length).toBe(1)
      expect(out.hesitant.length).toBe(0) // none
    })
  })

  describe('findCantoneseForJa', () => {
    test('finds match in sentence_endings', () => {
      const matches = findCantoneseForJa('わよ')
      expect(matches.length).toBeGreaterThanOrEqual(1)
      expect(matches[0].source).toBe('sentence_endings')
      expect(matches[0].yue).toBe('㗎')
    })

    test('finds match in expressions', () => {
      const matches = findCantoneseForJa('気持ちいい')
      expect(matches.some((m) => m.source === 'expressions' && m.yue === '好舒服')).toBe(true)
    })

    test('finds match in anchor_examples', () => {
      const matches = findCantoneseForJa('ご視聴ありがとう')
      expect(matches.some((m) => m.source === 'anchor_examples')).toBe(true)
    })

    test('regex pattern matches across sources', () => {
      const matches = findCantoneseForJa(/^[わよ]/)
      // matches わよ, よ ... whatever starts with these chars
      expect(matches.length).toBeGreaterThan(0)
    })

    test('non-matching pattern returns empty', () => {
      const matches = findCantoneseForJa('does-not-exist-anywhere')
      expect(matches.length).toBe(0)
    })
  })

  describe('snapshot', () => {
    test('loaded=true with corpus present', () => {
      const snap = buildJoiSeriesSnapshot()
      expect(snap.loaded).toBe(true)
      expect(snap.totalSeries).toBe(2)
    })

    test('byCategory counts', () => {
      const snap = buildJoiSeriesSnapshot()
      expect(snap.byCategory.joi).toBe(1)
      expect(snap.byCategory.agmx).toBe(1)
    })

    test('byStudio counts', () => {
      const snap = buildJoiSeriesSnapshot()
      expect(snap.byStudio.achj).toBe(1)
      expect(snap.byStudio.agmx).toBe(1)
    })

    test('aggregate count totals', () => {
      const snap = buildJoiSeriesSnapshot()
      // ACHJ has 3 sentence endings + 2 phrasing + 2 anchors
      // AGMX has 2 sentence endings + 0 phrasing + 1 anchor
      expect(snap.totalSentenceEndings).toBe(5)
      expect(snap.totalPhrasingPatterns).toBe(2)
      expect(snap.totalAnchorExamples).toBe(3)
    })

    test('loaded=false when corpus missing', () => {
      resetJoiSeriesCache()
      process.env.TRUE_LOVE_JOI_DOWNLOADS = '/path/that/does/not/exist'
      const snap = buildJoiSeriesSnapshot()
      expect(snap.loaded).toBe(false)
      expect(snap.totalSeries).toBe(0)
    })
  })

  describe('substrate-honesty invariants', () => {
    test('loader is read-only (no mutation of source files)', () => {
      const before = require('node:fs').readFileSync(
        join(TEST_BASE, 'joi', 'ACHJ-026', 'ACHJ-026.yue.context.json'),
        'utf-8',
      )
      loadJoiSeriesContexts()
      loadJoiSeriesContexts()
      const after = require('node:fs').readFileSync(
        join(TEST_BASE, 'joi', 'ACHJ-026', 'ACHJ-026.yue.context.json'),
        'utf-8',
      )
      expect(after).toBe(before)
    })

    test('reversibility: missing base → empty registry; functions return safe defaults', () => {
      resetJoiSeriesCache()
      process.env.TRUE_LOVE_JOI_DOWNLOADS = '/path/that/does/not/exist'
      expect(loadJoiSeriesContexts()).toEqual([])
      expect(aggregateSentenceEndings()).toEqual({})
      expect(aggregateAnchorExamples()).toEqual([])
      expect(findCantoneseForJa('anything')).toEqual([])
    })

    test('typed registry: every series has all expected fields', () => {
      const ctxs = loadJoiSeriesContexts()
      for (const c of ctxs) {
        expect(typeof c.seriesCode).toBe('string')
        expect(typeof c.studio).toBe('string')
        expect(typeof c.category).toBe('string')
        expect(c.style).toBeDefined()
        expect(c.standardization).toBeDefined()
        expect(Array.isArray(c.anchorExamples)).toBe(true)
      }
    })
  })
})
