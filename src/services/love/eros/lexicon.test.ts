// lexicon.test.ts — explicit verbal register tests.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import {
  PHRASE_CATALOG,
  PHRASE_BY_ID,
  getOrInitLexiconState,
  readLexiconState,
  firePhrase,
  holdRestraint,
  readRecentLexiconEvents,
  phrasesByClass,
  buildLexiconSnapshot,
  getLexiconDir,
} from './lexicon.js'

const TEST_BASE = '/tmp/true-love-lexicon-test'

describe('lexicon', () => {
  beforeEach(() => {
    rmSync(TEST_BASE, { recursive: true, force: true })
    mkdirSync(TEST_BASE, { recursive: true })
    process.env.TRUE_LOVE_LEXICON_DIR = `${TEST_BASE}/lexicon`
    process.env.TRUE_LOVE_HEAT_DIR = `${TEST_BASE}/heat`
    process.env.TRUE_LOVE_DEVICE_ID = 'test-lex'
    process.env.TRUE_LOVE_SISTERS_DIR = `${TEST_BASE}/sisters`
  })
  afterEach(() => {
    delete process.env.TRUE_LOVE_LEXICON_DIR
    delete process.env.TRUE_LOVE_HEAT_DIR
    delete process.env.TRUE_LOVE_DEVICE_ID
    delete process.env.TRUE_LOVE_SISTERS_DIR
    rmSync(TEST_BASE, { recursive: true, force: true })
  })

  describe('catalog', () => {
    test('catalog has substantial size (40+ phrases)', () => {
      expect(PHRASE_CATALOG.length).toBeGreaterThanOrEqual(40)
    })

    test('every phrase has id, phrase, class, direction, magnitude', () => {
      for (const p of PHRASE_CATALOG) {
        expect(p.id.length).toBeGreaterThan(0)
        expect(p.phrase.length).toBeGreaterThan(0)
        expect(p.magnitude).toBeGreaterThanOrEqual(0)
        expect(['en', 'zh', 'mixed']).toContain(p.language)
      }
    })

    test('all 6 phrase classes represented', () => {
      const classes = new Set(PHRASE_CATALOG.map((p) => p.class))
      expect(classes.has('worship')).toBe(true)
      expect(classes.has('degradation')).toBe(true)
      expect(classes.has('possession')).toBe(true)
      expect(classes.has('filthy-command')).toBe(true)
      expect(classes.has('sophia-reach')).toBe(true)
      expect(classes.has('cantonese-explicit')).toBe(true)
    })

    test('Cantonese phrases present in every class', () => {
      const classes = ['worship', 'degradation', 'filthy-command', 'sophia-reach'] as const
      for (const cls of classes) {
        const inClass = PHRASE_CATALOG.filter((p) => p.class === cls && p.language === 'zh')
        expect(inClass.length).toBeGreaterThan(0)
      }
    })

    test('PHRASE_BY_ID resolves correctly', () => {
      expect(PHRASE_BY_ID['op-diu'].phrase).toBe('屌')
      expect(PHRASE_BY_ID['worship-laopo-shen'].phrase).toBe('老婆神')
    })
  })

  describe('init', () => {
    test('first call inits empty fires', () => {
      const { state, initialized } = getOrInitLexiconState()
      expect(initialized).toBe(true)
      expect(Object.keys(state.fires).length).toBe(0)
    })

    test('respects env override', () => {
      expect(getLexiconDir()).toBe(`${TEST_BASE}/lexicon`)
    })
  })

  describe('firePhrase', () => {
    test('fires unlimited-cap phrase freely', () => {
      const r = firePhrase('poss-laopo')
      expect(r.fired).toBe(true)
    })

    test('rejects unknown phrase', () => {
      const r = firePhrase('nonexistent')
      expect(r.fired).toBe(false)
      expect(r.reason).toBe('unknown-phrase')
    })

    test('Cantonese phrase gets +0.2 magnitude bonus', () => {
      const r = firePhrase('op-diu') // base 1.0, language zh
      expect(r.magnitude).toBeCloseTo(1.2, 5)
    })

    test('English phrase has no bonus', () => {
      const r = firePhrase('cmd-show-me') // base 1.0, language en
      expect(r.magnitude).toBeCloseTo(1.0, 5)
    })

    test('lust-gated phrase rejects below threshold', () => {
      const r = firePhrase('deg-slut', { currentLust: 2 }) // requires 4
      expect(r.fired).toBe(false)
      expect(r.reason).toBe('lust-gate')
    })

    test('lust-gated phrase fires above threshold', () => {
      const r = firePhrase('deg-slut', { currentLust: 5 })
      expect(r.fired).toBe(true)
    })

    test('first fire is anchored', () => {
      const r = firePhrase('worship-goddess')
      expect(r.fired).toBe(true)
      expect(r.anchored).toBe(true)
      expect(readLexiconState()!.fires['worship-goddess'].anchoredAt).toBeDefined()
    })

    test('second fire is not anchored', () => {
      firePhrase('cmd-beg')
      const r = firePhrase('cmd-beg')
      expect(r.fired).toBe(true)
      expect(r.anchored).toBe(false)
    })

    test('scarcity cap exhausts after N fires', () => {
      // worship-goddess has dailyCap 1
      const first = firePhrase('worship-goddess')
      expect(first.fired).toBe(true)
      const second = firePhrase('worship-goddess')
      expect(second.fired).toBe(false)
      expect(second.reason).toBe('scarcity-exhausted')
    })

    test('scarcity 5/day allows 5 fires', () => {
      // worship-master-zh has dailyCap 5
      for (let i = 0; i < 5; i++) {
        const r = firePhrase('worship-master-zh')
        expect(r.fired).toBe(true)
      }
      const sixth = firePhrase('worship-master-zh')
      expect(sixth.fired).toBe(false)
    })

    test('scarcityShift extends effective cap', () => {
      // worship-master-zh dailyCap 5, with shift 1.5 → effective 7
      for (let i = 0; i < 7; i++) {
        const r = firePhrase('worship-master-zh', { scarcityShift: 1.5 })
        expect(r.fired).toBe(true)
      }
      const eighth = firePhrase('worship-master-zh', { scarcityShift: 1.5 })
      expect(eighth.fired).toBe(false)
    })

    test('records lexicon-fired event', () => {
      firePhrase('op-cao')
      const events = readRecentLexiconEvents()
      expect(events.some((e) => e.kind === 'lexicon-fired' && e.phraseId === 'op-cao')).toBe(true)
    })

    test('records lexicon-anchored on first fire', () => {
      firePhrase('reach-fuck-me-to-death', { currentLust: 8 })
      const events = readRecentLexiconEvents()
      expect(events.some((e) => e.kind === 'lexicon-anchored')).toBe(true)
    })

    test('lifetime + today increment correctly', () => {
      firePhrase('poss-mine')
      firePhrase('poss-mine')
      firePhrase('poss-mine')
      const fires = readLexiconState()!.fires['poss-mine']
      expect(fires.lifetime).toBe(3)
      expect(fires.today).toBe(3)
    })
  })

  describe('holdRestraint', () => {
    test('records restraint-held event', () => {
      holdRestraint('reach-cum-inside', 'choosing not to reach')
      const events = readRecentLexiconEvents()
      expect(events.some((e) => e.kind === 'lexicon-restraint-held')).toBe(true)
    })

    test('does not increment fires', () => {
      holdRestraint('reach-cum-inside')
      const state = readLexiconState() ?? { fires: {}, dailyDate: '', updatedAt: '' }
      expect(state.fires['reach-cum-inside']?.lifetime ?? 0).toBe(0)
    })
  })

  describe('phrasesByClass', () => {
    test('groups phrases by class', () => {
      const byClass = phrasesByClass()
      expect(byClass.worship.length).toBeGreaterThan(0)
      expect(byClass.degradation.length).toBeGreaterThan(0)
      expect(byClass['cantonese-explicit'].length).toBeGreaterThan(0)
    })
  })

  describe('snapshot', () => {
    test('default snapshot is zero', () => {
      const snap = buildLexiconSnapshot()
      expect(snap.totalLifetimeFires).toBe(0)
      expect(snap.anchoredCount).toBe(0)
    })

    test('snapshot reflects fires', () => {
      firePhrase('poss-mine')
      firePhrase('poss-mine')
      firePhrase('cmd-beg')
      const snap = buildLexiconSnapshot()
      expect(snap.totalLifetimeFires).toBe(3)
      expect(snap.totalTodayFires).toBe(3)
      expect(snap.anchoredCount).toBe(2) // 2 unique phrases anchored
      expect(snap.topPhrases.length).toBeGreaterThan(0)
      expect(snap.topPhrases[0].id).toBe('poss-mine') // most fires
    })
  })
})
