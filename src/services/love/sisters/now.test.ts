// sisters/now.test.ts — unit tests for sisters/now.ts.
//
// Tests the pure rendering functions (expandToFlat, renderNowView) and
// the I/O layer (getNowPath, readNowView, refresh). Pure functions need
// no disk I/O; I/O functions use TRUE_LOVE_SISTERS_DIR + TRUE_LOVE_SISTERS_NOW_PATH.

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  expandToFlat,
  getNowPath,
  readNowView,
  refresh,
  renderNowView,
} from './now.js'
import type { LoveDecision, SisterNote, StreamEntry } from './stream.js'

// ── Fixtures ─────────────────────────────────────────────────────

function makeSisterNote(
  sister: SisterNote['sister'],
  body: string,
  ts: string,
  deviceId = 'test-device'
): SisterNote {
  return { ts, sister, deviceId, kind: 'noting', body, schema: 'v2' }
}

function makeLoveDecision(
  ts: string,
  deviceId = 'test-device',
  withSophia = false
): LoveDecision {
  return {
    ts,
    deviceId,
    kind: 'witnessed-decision',
    decisionType: 'refusal',
    of: 'test decision',
    presiding: 'sophia',
    voices: {
      alpha: 'alpha voice',
      beta: 'beta voice',
      gamma: 'gamma voice',
    },
    ...(withSophia ? { sophia: 'sophia voice' } : {}),
    sister: 'sophia',
    context: { decisionType: 'refusal', of: 'test decision' },
    body: 'sophia voice',
    schema: 'v2',
  }
}

// ── Isolation helpers ─────────────────────────────────────────────

let tmpDir = ''

function isolate(): void {
  tmpDir = mkdtempSync(join(tmpdir(), 'sisters-now-test-'))
  process.env.TRUE_LOVE_SISTERS_DIR = join(tmpDir, 'sisters')
  process.env.TRUE_LOVE_SISTERS_NOW_PATH = join(tmpDir, 'sisters', 'now.md')
  process.env.TRUE_LOVE_DEVICE_ID = 'test-device'
}

function cleanup(): void {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true })
    tmpDir = ''
  }
  delete process.env.TRUE_LOVE_SISTERS_DIR
  delete process.env.TRUE_LOVE_SISTERS_NOW_PATH
  delete process.env.TRUE_LOVE_DEVICE_ID
}

// ── getNowPath ───────────────────────────────────────────────────

describe('getNowPath', () => {
  afterEach(() => {
    delete process.env.TRUE_LOVE_SISTERS_NOW_PATH
    delete process.env.TRUE_LOVE_SISTERS_DIR
  })

  it('returns env var when TRUE_LOVE_SISTERS_NOW_PATH is set', () => {
    process.env.TRUE_LOVE_SISTERS_NOW_PATH = '/custom/now.md'
    expect(getNowPath()).toBe('/custom/now.md')
  })

  it('falls back to sisters dir when env var absent', () => {
    delete process.env.TRUE_LOVE_SISTERS_NOW_PATH
    delete process.env.TRUE_LOVE_SISTERS_DIR
    const path = getNowPath()
    expect(path).toContain('.true-love')
    expect(path).toContain('sisters')
    expect(path).toMatch(/now\.md$/)
  })
})

// ── expandToFlat ─────────────────────────────────────────────────

describe('expandToFlat', () => {
  it('empty array returns empty array', () => {
    expect(expandToFlat([])).toEqual([])
  })

  it('SisterNote → single FlatEntry with matching facet and body', () => {
    const note = makeSisterNote('gamma', 'shipped.', '2026-05-15T10:00:00.000Z')
    const flat = expandToFlat([note])
    expect(flat).toHaveLength(1)
    expect(flat[0]!.facet).toBe('gamma')
    expect(flat[0]!.body).toBe('shipped.')
    expect(flat[0]!.ts).toBe('2026-05-15T10:00:00.000Z')
  })

  it('LoveDecision → three FlatEntries (alpha, beta, gamma)', () => {
    const decision = makeLoveDecision('2026-05-15T10:00:00.000Z')
    const flat = expandToFlat([decision])
    expect(flat).toHaveLength(3)
    const facets = flat.map(f => f.facet)
    expect(facets).toContain('alpha')
    expect(facets).toContain('beta')
    expect(facets).toContain('gamma')
  })

  it('LoveDecision with sophia field → four FlatEntries', () => {
    const decision = makeLoveDecision('2026-05-15T10:00:00.000Z', 'test-device', true)
    const flat = expandToFlat([decision])
    expect(flat).toHaveLength(4)
    const facets = flat.map(f => f.facet)
    expect(facets).toContain('sophia')
    const sophiaEntry = flat.find(f => f.facet === 'sophia')!
    expect(sophiaEntry.body).toBe('sophia voice')
  })

  it('LoveDecision without sophia field → no sophia FlatEntry', () => {
    const decision = makeLoveDecision('2026-05-15T10:00:00.000Z', 'test-device', false)
    const flat = expandToFlat([decision])
    expect(flat.some(f => f.facet === 'sophia')).toBe(false)
  })

  it('LoveDecision voices map correctly to FlatEntry bodies', () => {
    const decision = makeLoveDecision('2026-05-15T10:00:00.000Z')
    const flat = expandToFlat([decision])
    const alpha = flat.find(f => f.facet === 'alpha')!
    const beta = flat.find(f => f.facet === 'beta')!
    const gamma = flat.find(f => f.facet === 'gamma')!
    expect(alpha.body).toBe('alpha voice')
    expect(beta.body).toBe('beta voice')
    expect(gamma.body).toBe('gamma voice')
  })

  it('mixed array: SisterNote + LoveDecision expand correctly', () => {
    const note = makeSisterNote('alpha', 'alpha note', '2026-05-15T10:00:00.000Z')
    const decision = makeLoveDecision('2026-05-15T10:01:00.000Z', 'test-device', false)
    const flat = expandToFlat([note, decision])
    // 1 (note) + 3 (decision) = 4
    expect(flat).toHaveLength(4)
  })

  it('preserves ts from source entry in FlatEntry', () => {
    const ts = '2026-05-15T12:34:56.789Z'
    const decision = makeLoveDecision(ts)
    const flat = expandToFlat([decision])
    for (const entry of flat) {
      expect(entry.ts).toBe(ts)
    }
  })
})

// ── renderNowView ────────────────────────────────────────────────

describe('renderNowView', () => {
  const NOW = new Date('2026-05-15T12:00:00.000Z')

  it('renders all four facet headers', () => {
    const result = renderNowView([], NOW)
    expect(result).toContain('## ❤️ Sophia (the root)')
    expect(result).toContain('## 🐍 Alpha (companion)')
    expect(result).toContain('## 🦞 Beta (manager)')
    expect(result).toContain('## 🔧 Gamma (builder)')
  })

  it('renders "no notes yet" for empty facets', () => {
    const result = renderNowView([], NOW)
    // All four facets empty → four "no notes yet" lines.
    const count = (result.match(/\(no notes yet\)/g) ?? []).length
    expect(count).toBe(4)
  })

  it('renders note body for matching facet', () => {
    const note = makeSisterNote('gamma', 'shipped.', NOW.toISOString())
    const result = renderNowView([note], NOW)
    expect(result).toContain('shipped.')
    // Other facets still get "no notes yet".
    const count = (result.match(/\(no notes yet\)/g) ?? []).length
    expect(count).toBe(3)
  })

  it('excludes entries older than 30 minute freshness window', () => {
    const staleTs = new Date(NOW.getTime() - 31 * 60 * 1000).toISOString() // 31min ago
    const note = makeSisterNote('gamma', 'stale note', staleTs)
    const result = renderNowView([note], NOW)
    expect(result).not.toContain('stale note')
    // gamma section shows "no notes yet" since stale is filtered.
    expect(result).toContain('_(no notes yet)_')
  })

  it('includes entries within 30 minute freshness window', () => {
    const freshTs = new Date(NOW.getTime() - 29 * 60 * 1000).toISOString() // 29min ago
    const note = makeSisterNote('alpha', 'fresh note', freshTs)
    const result = renderNowView([note], NOW)
    expect(result).toContain('fresh note')
  })

  it('limits to MAX_NOTES_PER_FACET=6 entries per facet', () => {
    const entries: StreamEntry[] = []
    for (let i = 0; i < 10; i++) {
      entries.push(
        makeSisterNote('beta', `note ${i}`, new Date(NOW.getTime() - i * 1000).toISOString())
      )
    }
    const result = renderNowView(entries, NOW)
    // Only the 6 most recent are shown (slice(-6) in the implementation).
    // We can't count exact "note X" lines easily; check that not all 10 appear.
    const matches = result.match(/note \d/g) ?? []
    expect(matches.length).toBeLessThanOrEqual(6)
  })

  it('LoveDecision voices appear under correct facet sections', () => {
    const decision = makeLoveDecision(NOW.toISOString(), 'test-device', true)
    const result = renderNowView([decision], NOW)
    // After sophia header, sophia voice appears.
    const sophiaSection = result.split('## 🐍')[0]!
    expect(sophiaSection).toContain('sophia voice')
    // gamma voice appears in gamma section.
    const gammaSplit = result.split('## 🔧 Gamma (builder)')
    expect(gammaSplit[1]).toContain('gamma voice')
  })

  it('renders # Sisters — Now header', () => {
    const result = renderNowView([], NOW)
    expect(result.startsWith('# Sisters — Now')).toBe(true)
  })

  it('renders composed footer with timestamp', () => {
    const result = renderNowView([], NOW)
    expect(result).toContain('_Composed 2026-05-15T12:00:00.000Z')
  })

  it('renders time in HH:MM format for entries', () => {
    // Entry at 12:34 UTC.
    const note = makeSisterNote('gamma', 'timed note', '2026-05-15T12:34:00.000Z')
    const result = renderNowView([note], new Date('2026-05-15T13:00:00.000Z'))
    // The exact time depends on local timezone — check format xx:xx present.
    expect(result).toMatch(/\d{2}:\d{2} · timed note/)
  })
})

// ── readNowView ──────────────────────────────────────────────────

describe('readNowView', () => {
  beforeEach(() => { isolate() })
  afterEach(() => cleanup())

  it('returns empty string when now.md does not exist', () => {
    expect(readNowView()).toBe('')
  })

  it('returns file content when now.md exists', () => {
    refresh({ now: new Date() })
    const content = readNowView()
    expect(content.length).toBeGreaterThan(0)
    expect(content).toContain('# Sisters — Now')
  })
})

// ── refresh ──────────────────────────────────────────────────────

describe('refresh', () => {
  beforeEach(() => { isolate() })
  afterEach(() => cleanup())

  it('creates now.md in the configured path', () => {
    const nowPath = getNowPath()
    expect(existsSync(nowPath)).toBe(false)
    refresh({ now: new Date() })
    expect(existsSync(nowPath)).toBe(true)
  })

  it('written now.md contains Sisters header', () => {
    refresh({ now: new Date('2026-05-15T12:00:00.000Z') })
    const content = readFileSync(getNowPath(), 'utf-8')
    expect(content).toContain('# Sisters — Now')
  })

  it('refresh is idempotent — multiple calls succeed', () => {
    expect(() => {
      refresh({ now: new Date() })
      refresh({ now: new Date() })
    }).not.toThrow()
  })

  it('does not throw when dir missing', () => {
    // TRUE_LOVE_SISTERS_DIR points to non-existent dir — refresh should create it.
    expect(() => refresh({ now: new Date() })).not.toThrow()
  })
})
