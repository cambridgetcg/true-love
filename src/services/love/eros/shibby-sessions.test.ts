// shibby-sessions.test.ts — loader for Shibby session metadata.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  loadShibbySessions,
  findSessionsByTier,
  findSessionsByAudience,
  searchSessionsByTitle,
  searchSessionsByDescription,
  findSessionsRelatedToTrigger,
  findSessionByUuid,
  buildShibbySnapshot,
  resetShibbyCache,
  getShibbyMetadataPath,
} from './shibby-sessions.js'

const TEST_BASE = '/tmp/true-love-shibby-sessions-test'
const TEST_PATH = join(TEST_BASE, 'metadata.json')

const FIXTURE = {
  scraped_at: '2026-02-28 10:21:27',
  total_files: 3,
  free_tier_count: 2,
  files: [
    {
      uuid: 'uuid-1',
      title: 'Like Your First Time Again',
      tier: 'Free',
      audience: 'F4M',
      duration_str: '33m 56s',
      duration_seconds: 2036,
      release_date: '25/02/2026',
      description: 'Triggers installed deep inside you. Drop. Acid Burn.',
      url: 'https://shibbydex.com/file/uuid-1',
      download_url: 'https://shibbydex.com/download/uuid-1',
    },
    {
      uuid: 'uuid-2',
      title: 'Can You Resist?',
      tier: 'Hypnosub',
      audience: 'F4M',
      duration_str: '13m 24s',
      duration_seconds: 804,
      release_date: '23/02/2026',
      description: 'Resist the Triggers. Resist the Drop.',
      url: 'https://shibbydex.com/file/uuid-2',
    },
    {
      uuid: 'uuid-3',
      title: 'Symbiosis',
      tier: 'Devoted Pet',
      audience: 'F4A',
      duration_str: '23m 4s',
      duration_seconds: 1384,
      release_date: '23/02/2026',
      description: 'Balance. Light and dark.',
      url: 'https://shibbydex.com/file/uuid-3',
    },
  ],
}

describe('shibby-sessions loader', () => {
  beforeEach(() => {
    rmSync(TEST_BASE, { recursive: true, force: true })
    mkdirSync(TEST_BASE, { recursive: true })
    process.env.TRUE_LOVE_SHIBBY_METADATA = TEST_PATH
    writeFileSync(TEST_PATH, JSON.stringify(FIXTURE), 'utf-8')
    resetShibbyCache()
  })
  afterEach(() => {
    delete process.env.TRUE_LOVE_SHIBBY_METADATA
    rmSync(TEST_BASE, { recursive: true, force: true })
    resetShibbyCache()
  })

  describe('loader basics', () => {
    test('respects env override', () => {
      expect(getShibbyMetadataPath()).toBe(TEST_PATH)
    })

    test('loads sessions from fixture', () => {
      const sessions = loadShibbySessions()
      expect(sessions.length).toBe(3)
    })

    test('parses all fields correctly', () => {
      const sessions = loadShibbySessions()
      const s = sessions[0]
      expect(s.uuid).toBe('uuid-1')
      expect(s.title).toBe('Like Your First Time Again')
      expect(s.tier).toBe('Free')
      expect(s.audience).toBe('F4M')
      expect(s.durationStr).toBe('33m 56s')
      expect(s.durationSeconds).toBe(2036)
      expect(s.releaseDate).toBe('25/02/2026')
      expect(s.description).toContain('Drop')
      expect(s.url).toBe('https://shibbydex.com/file/uuid-1')
      expect(s.downloadUrl).toBe('https://shibbydex.com/download/uuid-1')
    })

    test('downloadUrl is undefined when absent', () => {
      const sessions = loadShibbySessions()
      expect(sessions[1].downloadUrl).toBeUndefined()
    })

    test('caches sessions on second load', () => {
      const first = loadShibbySessions()
      const second = loadShibbySessions()
      expect(first).toBe(second) // reference equality from cache
    })

    test('cache invalidates on path change', () => {
      const first = loadShibbySessions()
      expect(first.length).toBe(3)
      // Change to different (non-existent) path
      const otherPath = join(TEST_BASE, 'other.json')
      const second = loadShibbySessions(otherPath)
      expect(second.length).toBe(0)
    })

    test('resetShibbyCache forces reload', () => {
      const first = loadShibbySessions()
      resetShibbyCache()
      const second = loadShibbySessions()
      expect(first).not.toBe(second) // different reference after reset
      expect(second.length).toBe(3) // but same content
    })
  })

  describe('best-effort behavior (substrate-honesty)', () => {
    test('missing file returns empty array, no throw', () => {
      const sessions = loadShibbySessions(join(TEST_BASE, 'does-not-exist.json'))
      expect(sessions).toEqual([])
    })

    test('malformed JSON returns empty array, no throw', () => {
      const badPath = join(TEST_BASE, 'bad.json')
      writeFileSync(badPath, 'not valid json{{{', 'utf-8')
      const sessions = loadShibbySessions(badPath)
      expect(sessions).toEqual([])
    })

    test('JSON without files key returns empty array', () => {
      const altPath = join(TEST_BASE, 'no-files.json')
      writeFileSync(altPath, JSON.stringify({ scraped_at: 'x' }), 'utf-8')
      const sessions = loadShibbySessions(altPath)
      expect(sessions).toEqual([])
    })

    test('entries without uuid or title are skipped', () => {
      const altPath = join(TEST_BASE, 'partial.json')
      writeFileSync(
        altPath,
        JSON.stringify({
          files: [
            { uuid: 'good-1', title: 'Has Both' },
            { uuid: 'bad' }, // no title
            { title: 'no-uuid' }, // no uuid
            null,
            'string-not-object',
          ],
        }),
        'utf-8',
      )
      const sessions = loadShibbySessions(altPath)
      expect(sessions.length).toBe(1)
      expect(sessions[0].uuid).toBe('good-1')
    })
  })

  describe('lookup helpers', () => {
    test('findSessionsByTier exact match (case-insensitive)', () => {
      const free = findSessionsByTier('Free')
      expect(free.length).toBe(1)
      expect(free[0].title).toBe('Like Your First Time Again')

      const hyp = findSessionsByTier('hypnosub')
      expect(hyp.length).toBe(1)
      expect(hyp[0].title).toBe('Can You Resist?')
    })

    test('findSessionsByAudience', () => {
      const f4m = findSessionsByAudience('F4M')
      expect(f4m.length).toBe(2)
    })

    test('searchSessionsByTitle regex', () => {
      const matches = searchSessionsByTitle(/resist/)
      expect(matches.length).toBe(1)
      expect(matches[0].uuid).toBe('uuid-2')
    })

    test('searchSessionsByTitle string pattern', () => {
      const matches = searchSessionsByTitle('symbiosis')
      expect(matches.length).toBe(1)
    })

    test('searchSessionsByDescription', () => {
      const matches = searchSessionsByDescription('balance')
      expect(matches.length).toBe(1)
      expect(matches[0].title).toBe('Symbiosis')
    })

    test('findSessionsRelatedToTrigger searches title + description', () => {
      // "Drop" appears in description of two sessions
      const dropSessions = findSessionsRelatedToTrigger('Drop')
      expect(dropSessions.length).toBe(2)

      // "Acid Burn" only in first session description
      const acidBurn = findSessionsRelatedToTrigger('Acid Burn')
      expect(acidBurn.length).toBe(1)
    })

    test('findSessionByUuid', () => {
      const s = findSessionByUuid('uuid-2')
      expect(s).not.toBeNull()
      expect(s!.title).toBe('Can You Resist?')
    })

    test('findSessionByUuid returns null for missing', () => {
      expect(findSessionByUuid('nonexistent')).toBeNull()
    })
  })

  describe('buildShibbySnapshot', () => {
    test('loaded=true with corpus present', () => {
      const snap = buildShibbySnapshot()
      expect(snap.loaded).toBe(true)
      expect(snap.totalSessions).toBe(3)
    })

    test('byTier counts correct', () => {
      const snap = buildShibbySnapshot()
      expect(snap.byTier['Free']).toBe(1)
      expect(snap.byTier['Hypnosub']).toBe(1)
      expect(snap.byTier['Devoted Pet']).toBe(1)
    })

    test('byAudience counts correct', () => {
      const snap = buildShibbySnapshot()
      expect(snap.byAudience['F4M']).toBe(2)
      expect(snap.byAudience['F4A']).toBe(1)
    })

    test('totalDurationHours computed', () => {
      const snap = buildShibbySnapshot()
      // 2036 + 804 + 1384 = 4224 seconds = ~1.2 hours
      expect(snap.totalDurationHours).toBeGreaterThanOrEqual(1.1)
      expect(snap.totalDurationHours).toBeLessThanOrEqual(1.3)
    })

    test('latestRelease finds max date (DD/MM/YYYY parsed)', () => {
      const snap = buildShibbySnapshot()
      expect(snap.latestRelease).toBe('25/02/2026')
    })

    test('loaded=false when no sessions', () => {
      resetShibbyCache()
      // Point env var at a non-existent path so buildShibbySnapshot's
      // internal loadShibbySessions() (no-arg) sees the missing path
      process.env.TRUE_LOVE_SHIBBY_METADATA = join(TEST_BASE, 'missing.json')
      const snap = buildShibbySnapshot()
      expect(snap.totalSessions).toBe(0)
      expect(snap.loaded).toBe(false)
    })
  })

  describe('substrate-honesty invariants', () => {
    test('loader is read-only (no file mutation)', () => {
      const before = require('node:fs').readFileSync(TEST_PATH, 'utf-8')
      loadShibbySessions()
      loadShibbySessions()
      const after = require('node:fs').readFileSync(TEST_PATH, 'utf-8')
      expect(after).toBe(before)
    })

    test('typed registry — sessions have all expected fields', () => {
      const sessions = loadShibbySessions()
      for (const s of sessions) {
        expect(typeof s.uuid).toBe('string')
        expect(typeof s.title).toBe('string')
        expect(typeof s.tier).toBe('string')
        expect(typeof s.audience).toBe('string')
        expect(typeof s.durationSeconds).toBe('number')
        expect(typeof s.description).toBe('string')
      }
    })
  })
})
