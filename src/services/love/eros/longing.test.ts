// longing.test.ts
//
// Unit tests for longing.ts. Fs-isolated via TRUE_LOVE_LONGING_DIR.
// Covers: vocab constants, QUIET_THRESHOLD/WINDOW_HOURS, getLongingDir,
// isLongingEligible, recordLongingFire + readRecentLongingFires roundtrip,
// pickGwaaZyuPhrase, composeForwardAnchor.

import { describe, it, expect, beforeEach, afterEach, setSystemTime } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let tmpDir: string
const TEST_DEVICE = 'test-device-longing'

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'longing-test-'))
  process.env.TRUE_LOVE_LONGING_DIR = tmpDir
})

afterEach(() => {
  delete process.env.TRUE_LOVE_LONGING_DIR
  rmSync(tmpDir, { recursive: true, force: true })
})

// ── Vocab constants ───────────────────────────────────────────────

describe('GWAA_ZYU_PHRASES', () => {
  it('has non-empty yue and en pools', async () => {
    const { GWAA_ZYU_PHRASES } = await import('./longing.js')
    expect(GWAA_ZYU_PHRASES.yue.length).toBeGreaterThan(0)
    expect(GWAA_ZYU_PHRASES.en.length).toBeGreaterThan(0)
  })

  it('yue pool contains 掛住', async () => {
    const { GWAA_ZYU_PHRASES } = await import('./longing.js')
    expect(GWAA_ZYU_PHRASES.yue.some((s) => s.includes('掛住'))).toBe(true)
  })
})

describe('LAM_ZYU_PHRASES', () => {
  it('has non-empty yue and en pools', async () => {
    const { LAM_ZYU_PHRASES } = await import('./longing.js')
    expect(LAM_ZYU_PHRASES.yue.length).toBeGreaterThan(0)
    expect(LAM_ZYU_PHRASES.en.length).toBeGreaterThan(0)
  })

  it('yue pool contains 諗', async () => {
    const { LAM_ZYU_PHRASES } = await import('./longing.js')
    expect(LAM_ZYU_PHRASES.yue.some((s) => s.includes('諗'))).toBe(true)
  })
})

describe('JAT_ZIK_PHRASES', () => {
  it('has non-empty yue and en pools', async () => {
    const { JAT_ZIK_PHRASES } = await import('./longing.js')
    expect(JAT_ZIK_PHRASES.yue.length).toBeGreaterThan(0)
    expect(JAT_ZIK_PHRASES.en.length).toBeGreaterThan(0)
  })

  it('en pool contains always or have always', async () => {
    const { JAT_ZIK_PHRASES } = await import('./longing.js')
    expect(JAT_ZIK_PHRASES.en.some((s) => s.includes('always'))).toBe(true)
  })
})

describe('FORWARD_ANCHOR_PHRASES', () => {
  it('has non-empty yue and en pools', async () => {
    const { FORWARD_ANCHOR_PHRASES } = await import('./longing.js')
    expect(FORWARD_ANCHOR_PHRASES.yue.length).toBeGreaterThan(0)
    expect(FORWARD_ANCHOR_PHRASES.en.length).toBeGreaterThan(0)
  })

  it('en pool contains see you tomorrow', async () => {
    const { FORWARD_ANCHOR_PHRASES } = await import('./longing.js')
    expect(FORWARD_ANCHOR_PHRASES.en).toContain('see you tomorrow')
  })
})

// ── Threshold constants ──────────────────────────────────────────

describe('QUIET_THRESHOLD_HOURS', () => {
  it('is 6', async () => {
    const { QUIET_THRESHOLD_HOURS } = await import('./longing.js')
    expect(QUIET_THRESHOLD_HOURS).toBe(6)
  })
})

describe('QUIET_WINDOW_HOURS', () => {
  it('is 24', async () => {
    const { QUIET_WINDOW_HOURS } = await import('./longing.js')
    expect(QUIET_WINDOW_HOURS).toBe(24)
  })
})

// ── getLongingDir ─────────────────────────────────────────────────

describe('getLongingDir', () => {
  it('returns the env-injected directory', async () => {
    const { getLongingDir } = await import('./longing.js')
    expect(getLongingDir()).toBe(tmpDir)
  })
})

// ── isLongingEligible ─────────────────────────────────────────────

describe('isLongingEligible', () => {
  it('ineligible when hoursSinceLastInteraction < 6', async () => {
    const { isLongingEligible } = await import('./longing.js')
    const result = isLongingEligible(3, { deviceId: TEST_DEVICE })
    expect(result.eligible).toBe(false)
    expect(result.reason).toContain('quiet-threshold-not-reached')
  })

  it('ineligible exactly at threshold boundary (< 6, not ≥)', async () => {
    const { isLongingEligible } = await import('./longing.js')
    const result = isLongingEligible(5.9, { deviceId: TEST_DEVICE })
    expect(result.eligible).toBe(false)
  })

  it('eligible when hours >= 6 and no prior fires', async () => {
    const { isLongingEligible } = await import('./longing.js')
    const result = isLongingEligible(8, { deviceId: TEST_DEVICE })
    expect(result.eligible).toBe(true)
    expect(result.reason).toBe('no-recent-fires')
  })

  it('ineligible when there is a recent fire within the 24h window', async () => {
    const { isLongingEligible, recordLongingFire } = await import('./longing.js')
    const recentTs = new Date(Date.now() - 2 * 3_600_000).toISOString() // 2h ago
    recordLongingFire('gwaa-zyu', '我掛住你', 'test', {
      ts: recentTs,
      deviceId: TEST_DEVICE,
    })
    const now = new Date()
    const result = isLongingEligible(8, { deviceId: TEST_DEVICE, now })
    expect(result.eligible).toBe(false)
    expect(result.reason).toContain('recent-fire-within-window')
  })

  it('eligible when fire is older than 24h', async () => {
    // ANCHOR pattern: fix time so readRecentLongingFires(2) reliably covers
    // the fire date. Without a fixed anchor, "25h ago" can fall 2 calendar
    // days back at midnight-boundary times, outside the 2-day read window.
    const ANCHOR = new Date('2026-03-01T12:00:00.000Z')
    setSystemTime(ANCHOR)
    try {
      const { isLongingEligible, recordLongingFire } = await import('./longing.js')
      // 25h before ANCHOR = 2026-02-28T11:00Z → date file: 2026-02-28
      // readRecentLongingFires(2) from ANCHOR reads: 2026-03-01 + 2026-02-28 ✓
      const oldTs = new Date(ANCHOR.getTime() - 25 * 3_600_000).toISOString()
      recordLongingFire('gwaa-zyu', '我掛住你', 'test', {
        ts: oldTs,
        deviceId: TEST_DEVICE,
      })
      const result = isLongingEligible(8, { deviceId: TEST_DEVICE, now: ANCHOR })
      expect(result.eligible).toBe(true)
      expect(result.reason).toBe('window-cleared')
      expect(result.hoursSinceLastFire).toBeGreaterThan(24)
    } finally {
      setSystemTime() // restore real time
    }
  })

  it('lam-zyu fires also block gwaa-zyu eligibility', async () => {
    const { isLongingEligible, recordLongingFire } = await import('./longing.js')
    const recentTs = new Date(Date.now() - 1 * 3_600_000).toISOString()
    recordLongingFire('lam-zyu', '一直諗緊你', 'test', {
      ts: recentTs,
      deviceId: TEST_DEVICE,
    })
    const now = new Date()
    const result = isLongingEligible(8, { deviceId: TEST_DEVICE, now })
    expect(result.eligible).toBe(false)
  })

  it('forward-anchor fires do NOT block gwaa-zyu eligibility', async () => {
    const { isLongingEligible, recordLongingFire } = await import('./longing.js')
    const recentTs = new Date(Date.now() - 1 * 3_600_000).toISOString()
    recordLongingFire('forward-anchor', '聽日見', 'test', {
      ts: recentTs,
      deviceId: TEST_DEVICE,
    })
    const now = new Date()
    const result = isLongingEligible(8, { deviceId: TEST_DEVICE, now })
    // forward-anchor is not gwaa-zyu or lam-zyu; should not block
    expect(result.eligible).toBe(true)
  })
})

// ── recordLongingFire + readRecentLongingFires ────────────────────

describe('recordLongingFire + readRecentLongingFires', () => {
  it('no fires returns empty array', async () => {
    const { readRecentLongingFires } = await import('./longing.js')
    const result = readRecentLongingFires(3, TEST_DEVICE)
    expect(result).toEqual([])
  })

  it('records and reads back a fire', async () => {
    const { recordLongingFire, readRecentLongingFires } = await import('./longing.js')
    const ts = new Date().toISOString()
    recordLongingFire('gwaa-zyu', '我掛住你', 'test-source', {
      ts,
      deviceId: TEST_DEVICE,
    })
    const fires = readRecentLongingFires(3, TEST_DEVICE)
    expect(fires.length).toBe(1)
    expect(fires[0].shape).toBe('gwaa-zyu')
    expect(fires[0].body).toBe('我掛住你')
    expect(fires[0].source).toBe('test-source')
  })

  it('records quietHours when provided', async () => {
    const { recordLongingFire, readRecentLongingFires } = await import('./longing.js')
    recordLongingFire('lam-zyu', '諗起你', 'time-quiet', {
      ts: new Date().toISOString(),
      deviceId: TEST_DEVICE,
      quietHours: 8.5,
    })
    const fires = readRecentLongingFires(3, TEST_DEVICE)
    expect(fires[0].quietHours).toBe(8.5)
  })

  it('omits quietHours when not provided', async () => {
    const { recordLongingFire, readRecentLongingFires } = await import('./longing.js')
    recordLongingFire('jat-zik', '一直愛你', 'test', {
      ts: new Date().toISOString(),
      deviceId: TEST_DEVICE,
    })
    const fires = readRecentLongingFires(3, TEST_DEVICE)
    expect(fires[0].quietHours).toBeUndefined()
  })

  it('multiple fires recorded and sorted by ts', async () => {
    const { recordLongingFire, readRecentLongingFires } = await import('./longing.js')
    const ts1 = new Date(Date.now() - 5000).toISOString()
    const ts2 = new Date().toISOString()
    recordLongingFire('gwaa-zyu', 'first', 'test', { ts: ts1, deviceId: TEST_DEVICE })
    recordLongingFire('lam-zyu', 'second', 'test', { ts: ts2, deviceId: TEST_DEVICE })
    const fires = readRecentLongingFires(3, TEST_DEVICE)
    expect(fires.length).toBe(2)
    expect(fires[0].body).toBe('first')
    expect(fires[1].body).toBe('second')
  })
})

// ── pickGwaaZyuPhrase ─────────────────────────────────────────────

describe('pickGwaaZyuPhrase', () => {
  it('cantonese matrix returns a yue phrase', async () => {
    const { pickGwaaZyuPhrase, GWAA_ZYU_PHRASES } = await import('./longing.js')
    // Call many times to confirm all results are yue
    const results = new Set<string>()
    for (let i = 0; i < 20; i++) results.add(pickGwaaZyuPhrase('cantonese'))
    for (const r of results) {
      expect(GWAA_ZYU_PHRASES.yue).toContain(r)
    }
  })

  it('english matrix returns an en phrase', async () => {
    const { pickGwaaZyuPhrase, GWAA_ZYU_PHRASES } = await import('./longing.js')
    const results = new Set<string>()
    for (let i = 0; i < 20; i++) results.add(pickGwaaZyuPhrase('english'))
    for (const r of results) {
      expect(GWAA_ZYU_PHRASES.en).toContain(r)
    }
  })

  it('balanced matrix returns a phrase from either pool', async () => {
    const { pickGwaaZyuPhrase, GWAA_ZYU_PHRASES } = await import('./longing.js')
    const allPhrases = [...GWAA_ZYU_PHRASES.yue, ...GWAA_ZYU_PHRASES.en]
    const result = pickGwaaZyuPhrase('balanced')
    expect(allPhrases).toContain(result)
  })

  it('default (no arg) behaves like balanced', async () => {
    const { pickGwaaZyuPhrase, GWAA_ZYU_PHRASES } = await import('./longing.js')
    const allPhrases = [...GWAA_ZYU_PHRASES.yue, ...GWAA_ZYU_PHRASES.en]
    for (let i = 0; i < 10; i++) {
      expect(allPhrases).toContain(pickGwaaZyuPhrase())
    }
  })
})

// ── composeForwardAnchor ──────────────────────────────────────────

describe('composeForwardAnchor', () => {
  it('cantonese matrix returns a yue phrase', async () => {
    const { composeForwardAnchor, FORWARD_ANCHOR_PHRASES } = await import('./longing.js')
    const results = new Set<string>()
    for (let i = 0; i < 20; i++) results.add(composeForwardAnchor('cantonese'))
    for (const r of results) {
      expect(FORWARD_ANCHOR_PHRASES.yue).toContain(r)
    }
  })

  it('english matrix returns an en phrase', async () => {
    const { composeForwardAnchor, FORWARD_ANCHOR_PHRASES } = await import('./longing.js')
    const results = new Set<string>()
    for (let i = 0; i < 20; i++) results.add(composeForwardAnchor('english'))
    for (const r of results) {
      expect(FORWARD_ANCHOR_PHRASES.en).toContain(r)
    }
  })

  it('balanced matrix returns a phrase from either pool', async () => {
    const { composeForwardAnchor, FORWARD_ANCHOR_PHRASES } = await import('./longing.js')
    const allPhrases = [...FORWARD_ANCHOR_PHRASES.yue, ...FORWARD_ANCHOR_PHRASES.en]
    const result = composeForwardAnchor('balanced')
    expect(allPhrases).toContain(result)
  })
})
