// sisters/snapshot.test.ts — unit tests for sisters/snapshot.ts.
//
// distillDay is the key pure function: accepts StreamEntry[] directly,
// returns markdown. Tests drive it via the notes parameter to avoid
// real I/O. The optional block builders (yu-witness, seeds, powers,
// addiction, becoming, syzygy, certainty) silently return empty when
// their dirs don't exist — isolation means they're all absent.

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  distillDay,
  getSnapshotsDir,
  snapshotExists,
  writeDailySnapshot,
} from './snapshot.js'
import type { LoveDecision, SisterNote, StreamEntry } from './stream.js'

// ── Fixtures ─────────────────────────────────────────────────────

const DATE = '2026-05-15'
const BASE_TS = `${DATE}T12:00:00.000Z`

function makeSisterNote(
  overrides: Partial<SisterNote> = {}
): SisterNote {
  return {
    ts: BASE_TS,
    sister: 'gamma',
    deviceId: 'test-device',
    kind: 'noting',
    body: 'test note',
    schema: 'v2',
    ...overrides,
  }
}

function makeWitnessedDecision(
  sister: SisterNote['sister'],
  body: string,
  decisionType = 'refusal',
  of = 'some decision',
  ts = BASE_TS
): SisterNote {
  return {
    ts,
    sister,
    deviceId: 'test-device',
    kind: 'witnessed-decision',
    body,
    context: { decisionType: decisionType as SisterNote['context'] extends { decisionType: infer D } ? D : never, of },
    schema: 'v2',
  }
}

function makeLoveDecision(ts = BASE_TS, withSophia = false): LoveDecision {
  return {
    ts,
    deviceId: 'test-device',
    kind: 'witnessed-decision',
    decisionType: 'refusal',
    of: 'test decision',
    presiding: 'sophia',
    voices: { alpha: 'alpha voice', beta: 'beta voice', gamma: 'gamma voice' },
    ...(withSophia ? { sophia: 'sophia integration' } : {}),
    sister: 'sophia',
    context: { decisionType: 'refusal', of: 'test decision' },
    body: 'sophia voice',
    schema: 'v2',
  }
}

// ── Isolation helpers ─────────────────────────────────────────────

let tmpDir = ''

function isolate(): void {
  tmpDir = mkdtempSync(join(tmpdir(), 'sisters-snapshot-test-'))
  process.env.TRUE_LOVE_SISTERS_SNAPSHOTS_DIR = join(tmpDir, 'snapshots')
  process.env.TRUE_LOVE_SISTERS_DIR = join(tmpDir, 'sisters')
  process.env.TRUE_LOVE_YU_WITNESS_DIR = join(tmpDir, 'yu-witness')
  // Non-existent dirs for all optional block builders → silently empty.
  process.env.TRUE_LOVE_DEVICE_ID = 'test-device'
}

function cleanup(): void {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true })
    tmpDir = ''
  }
  delete process.env.TRUE_LOVE_SISTERS_SNAPSHOTS_DIR
  delete process.env.TRUE_LOVE_SISTERS_DIR
  delete process.env.TRUE_LOVE_YU_WITNESS_DIR
  delete process.env.TRUE_LOVE_DEVICE_ID
}

// ── getSnapshotsDir ───────────────────────────────────────────────

describe('getSnapshotsDir', () => {
  afterEach(() => {
    delete process.env.TRUE_LOVE_SISTERS_SNAPSHOTS_DIR
  })

  it('returns env var when set', () => {
    process.env.TRUE_LOVE_SISTERS_SNAPSHOTS_DIR = '/custom/snapshots'
    expect(getSnapshotsDir()).toBe('/custom/snapshots')
  })

  it('returns cwd-relative default when env var absent', () => {
    delete process.env.TRUE_LOVE_SISTERS_SNAPSHOTS_DIR
    const dir = getSnapshotsDir()
    expect(dir).toContain('docs')
    expect(dir).toContain('sisters')
    expect(dir).toContain('snapshots')
  })
})

// ── distillDay — structure ────────────────────────────────────────

describe('distillDay — header and footer', () => {
  it('renders # Sisters — <date> header', () => {
    const result = distillDay(DATE, [])
    expect(result.startsWith(`# Sisters — ${DATE}`)).toBe(true)
  })

  it('footer contains note count', () => {
    const notes: StreamEntry[] = [makeSisterNote(), makeSisterNote()]
    const result = distillDay(DATE, notes)
    expect(result).toContain('2 total notes')
  })

  it('footer note count = 0 for empty notes', () => {
    const result = distillDay(DATE, [])
    expect(result).toContain('0 total notes')
  })

  it('renders all four facet headers', () => {
    const result = distillDay(DATE, [])
    expect(result).toContain('## ❤️ Sophia')
    expect(result).toContain('## 🐍 Alpha')
    expect(result).toContain('## 🦞 Beta')
    expect(result).toContain('## 🔧 Gamma')
  })
})

// ── distillDay — silent facets ────────────────────────────────────

describe('distillDay — silent facets', () => {
  it('renders silence marker for facets with no notes', () => {
    const result = distillDay(DATE, [])
    const count = (result.match(/Silent today; the silence held\./g) ?? []).length
    // All four facets silent.
    expect(count).toBe(4)
  })

  it('silence for specific facet only when it has no notes', () => {
    const note = makeSisterNote({ sister: 'gamma', body: 'gamma shipped.' })
    const result = distillDay(DATE, [note])
    // gamma has a note — no silence marker there.
    const afterGamma = result.split('## 🔧 Gamma')[1]!
    expect(afterGamma).not.toContain('Silent today')
    expect(afterGamma).toContain('gamma shipped.')
    // Other facets still silent.
    expect(result.split('## 🔧 Gamma')[0]).toContain('Silent today')
  })
})

// ── distillDay — noting entries ───────────────────────────────────

describe('distillDay — noting entries', () => {
  it('renders noting entry body in facet section', () => {
    const note = makeSisterNote({ sister: 'alpha', body: 'alpha observed.' })
    const result = distillDay(DATE, [note])
    expect(result).toContain('alpha observed.')
  })

  it('condenses >5 noting entries with count marker', () => {
    const notes: StreamEntry[] = []
    for (let i = 0; i < 8; i++) {
      notes.push(makeSisterNote({
        sister: 'beta',
        body: `note ${i}`,
        ts: new Date(`${DATE}T12:0${i}:00.000Z`).toISOString(),
      }))
    }
    const result = distillDay(DATE, notes)
    // 8 noting → 5 selected + "3 more condensed".
    expect(result).toContain('3 more routine notes condensed')
  })

  it('renders ≤5 noting entries without condensation marker', () => {
    const notes: StreamEntry[] = []
    for (let i = 0; i < 4; i++) {
      notes.push(makeSisterNote({
        sister: 'gamma',
        body: `note ${i}`,
        ts: new Date(`${DATE}T12:0${i}:00.000Z`).toISOString(),
      }))
    }
    const result = distillDay(DATE, notes)
    expect(result).not.toContain('more routine notes condensed')
    for (let i = 0; i < 4; i++) {
      expect(result).toContain(`note ${i}`)
    }
  })

  it('session-wrap notes always preserved', () => {
    const wrap = makeSisterNote({
      sister: 'gamma',
      kind: 'session-wrap',
      body: 'session wrapped.',
    })
    const result = distillDay(DATE, [wrap])
    expect(result).toContain('session wrapped.')
  })
})

// ── distillDay — witnessed-decision ──────────────────────────────

describe('distillDay — witnessed-decision entries', () => {
  it('renders witnessed-decision body in facet section', () => {
    const note = makeWitnessedDecision('gamma', 'gamma refused.', 'refusal', 'bad request')
    const result = distillDay(DATE, [note])
    expect(result).toContain('gamma refused.')
  })

  it('renders decision context prefix: [decisionType: of]', () => {
    const note = makeWitnessedDecision('alpha', 'alpha voice.', 'refusal', 'sycophancy')
    const result = distillDay(DATE, [note])
    expect(result).toContain('[refusal: sycophancy]')
  })

  it('collapses repeated (decisionType, of) within 5-min window', () => {
    const t0 = `${DATE}T12:00:00.000Z`
    const t1 = `${DATE}T12:02:00.000Z` // 2 min later — within 5-min bucket
    const n1 = makeWitnessedDecision('gamma', 'first.', 'refusal', 'same decision', t0)
    const n2 = makeWitnessedDecision('gamma', 'second.', 'refusal', 'same decision', t1)
    const result = distillDay(DATE, [n1, n2])
    // Should collapse to 1 entry with ×2.
    expect(result).toContain('_(×2)_')
    // Only one entry body rendered.
    expect(result).toContain('first.')
    expect(result).not.toContain('second.')
  })

  it('does not collapse different (decisionType, of)', () => {
    const n1 = makeWitnessedDecision('gamma', 'first.', 'refusal', 'decision A')
    const n2 = makeWitnessedDecision('gamma', 'second.', 'refusal', 'decision B')
    const result = distillDay(DATE, [n1, n2])
    // Two different decisions — both appear, no ×N.
    expect(result).toContain('first.')
    expect(result).toContain('second.')
    expect(result).not.toContain('_(×2)_')
  })

  it('does not collapse same (decisionType, of) outside 5-min window', () => {
    const t0 = `${DATE}T12:00:00.000Z`
    const t1 = `${DATE}T12:06:00.000Z` // 6 min later — outside 5-min bucket
    const n1 = makeWitnessedDecision('gamma', 'first.', 'refusal', 'same decision', t0)
    const n2 = makeWitnessedDecision('gamma', 'second.', 'refusal', 'same decision', t1)
    const result = distillDay(DATE, [n1, n2])
    // Two separate entries (not collapsed).
    expect(result).not.toContain('_(×2)_')
    expect(result).toContain('first.')
    expect(result).toContain('second.')
  })
})

// ── distillDay — LoveDecision expansion ──────────────────────────

describe('distillDay — LoveDecision expansion', () => {
  it('LoveDecision alpha voice appears in alpha section', () => {
    const decision = makeLoveDecision(BASE_TS)
    const result = distillDay(DATE, [decision])
    const alphaSplit = result.split('## 🐍 Alpha')
    expect(alphaSplit[1]).toContain('alpha voice')
  })

  it('LoveDecision beta voice appears in beta section', () => {
    const decision = makeLoveDecision(BASE_TS)
    const result = distillDay(DATE, [decision])
    const betaSplit = result.split('## 🦞 Beta')
    expect(betaSplit[1]).toContain('beta voice')
  })

  it('LoveDecision gamma voice appears in gamma section', () => {
    const decision = makeLoveDecision(BASE_TS)
    const result = distillDay(DATE, [decision])
    const gammaSplit = result.split('## 🔧 Gamma')
    expect(gammaSplit[1]).toContain('gamma voice')
  })

  it('LoveDecision with sophia field: sophia voice appears in sophia section', () => {
    const decision = makeLoveDecision(BASE_TS, true)
    const result = distillDay(DATE, [decision])
    const sophiaSplit = result.split('## ❤️ Sophia')
    expect(sophiaSplit[1]).toContain('sophia integration')
  })

  it('LoveDecision without sophia: sophia section stays silent', () => {
    const decision = makeLoveDecision(BASE_TS, false)
    const result = distillDay(DATE, [decision])
    const sophiaSplit = result.split('## 🐍 Alpha')[0]! // sophia section is before alpha
    expect(sophiaSplit).toContain('Silent today')
  })

  it('LoveDecision decision context appears in expanded voices', () => {
    const decision = makeLoveDecision(BASE_TS)
    const result = distillDay(DATE, [decision])
    // Context: [refusal: test decision] should appear in expanded voices.
    expect(result).toContain('[refusal: test decision]')
  })
})

// ── snapshotExists ────────────────────────────────────────────────

describe('snapshotExists', () => {
  beforeEach(() => { isolate() })
  afterEach(() => cleanup())

  it('returns false when snapshot file absent', () => {
    expect(snapshotExists('2026-05-15')).toBe(false)
  })

  it('returns true after writeDailySnapshot creates the file', () => {
    writeDailySnapshot('2026-05-15')
    expect(snapshotExists('2026-05-15')).toBe(true)
  })
})

// ── writeDailySnapshot ────────────────────────────────────────────

describe('writeDailySnapshot', () => {
  beforeEach(() => { isolate() })
  afterEach(() => cleanup())

  it('creates snapshot file in snapshots dir', () => {
    writeDailySnapshot('2026-05-15')
    const path = join(getSnapshotsDir(), '2026-05-15.md')
    expect(existsSync(path)).toBe(true)
  })

  it('snapshot file contains distilled content', () => {
    writeDailySnapshot('2026-05-15')
    const { readFileSync } = require('node:fs') as typeof import('node:fs')
    const content = readFileSync(join(getSnapshotsDir(), '2026-05-15.md'), 'utf-8')
    expect(content).toContain('# Sisters — 2026-05-15')
  })

  it('does not throw when called repeatedly', () => {
    expect(() => {
      writeDailySnapshot('2026-05-15')
      writeDailySnapshot('2026-05-15')
    }).not.toThrow()
  })
})
