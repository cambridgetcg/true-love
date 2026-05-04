// sisters.test.ts — tests for the mutual introspection module.
//
// Covers: stream (append/read/prune), now (composition/render),
// snapshot (distillation/write), root (anchor/stance), witness-hook.

import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// ── Fixture ─────────────────────────────────────────────────────────

let dir: string
let snapshotsDir: string
const ORIG_SISTERS_DIR = process.env.TRUE_LOVE_SISTERS_DIR
const ORIG_SNAPSHOTS_DIR = process.env.TRUE_LOVE_SISTERS_SNAPSHOTS_DIR
const ORIG_NOW_PATH = process.env.TRUE_LOVE_SISTERS_NOW_PATH
const ORIG_DEVICE_ID = process.env.TRUE_LOVE_DEVICE_ID

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tl-sisters-'))
  snapshotsDir = join(dir, 'snapshots')
  process.env.TRUE_LOVE_SISTERS_DIR = dir
  process.env.TRUE_LOVE_SISTERS_SNAPSHOTS_DIR = snapshotsDir
  process.env.TRUE_LOVE_SISTERS_NOW_PATH = join(dir, 'now.md')
  process.env.TRUE_LOVE_DEVICE_ID = 'test-device-abc123'
  resetWitnessDedup()
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  if (ORIG_SISTERS_DIR === undefined) delete process.env.TRUE_LOVE_SISTERS_DIR
  else process.env.TRUE_LOVE_SISTERS_DIR = ORIG_SISTERS_DIR
  if (ORIG_SNAPSHOTS_DIR === undefined) delete process.env.TRUE_LOVE_SISTERS_SNAPSHOTS_DIR
  else process.env.TRUE_LOVE_SISTERS_SNAPSHOTS_DIR = ORIG_SNAPSHOTS_DIR
  if (ORIG_NOW_PATH === undefined) delete process.env.TRUE_LOVE_SISTERS_NOW_PATH
  else process.env.TRUE_LOVE_SISTERS_NOW_PATH = ORIG_NOW_PATH
  if (ORIG_DEVICE_ID === undefined) delete process.env.TRUE_LOVE_DEVICE_ID
  else process.env.TRUE_LOVE_DEVICE_ID = ORIG_DEVICE_ID
})

// ── Helpers ─────────────────────────────────────────────────────────

import {
  appendNote,
  getSistersDir,
  readDayNotes,
  pruneStreamsOlderThan,
  type SisterNote,
} from '../sisters/stream.js'
import { refresh, readNowView, renderNowView, getNowPath } from '../sisters/now.js'
import { distillDay, writeDailySnapshot, snapshotExists, getSnapshotsDir } from '../sisters/snapshot.js'
import { witness, resetWitnessDedup } from '../sisters/witness-hook.js'
import { getRootAnchor, getObservedStanceText } from '../sophia/root.js'

function makeNote(overrides: Partial<SisterNote> = {}): SisterNote {
  return {
    ts: '2026-05-03T10:00:00.000Z',
    sister: 'alpha',
    deviceId: 'test-device-abc123',
    kind: 'noting',
    body: 'the kingdom is still; patience holds.',
    ...overrides,
  }
}

// ══════════════════════════════════════════════════════════════════
// stream.ts
// ══════════════════════════════════════════════════════════════════

describe('stream — appendNote', () => {
  test('creates device directory and appends JSONL', () => {
    const note = makeNote()
    appendNote(note)

    const path = join(dir, 'test-device-abc123', '2026-05-03.jsonl')
    expect(existsSync(path)).toBe(true)
    const content = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(content.trim())
    expect(parsed.sister).toBe('alpha')
    expect(parsed.body).toBe('the kingdom is still; patience holds.')
  })

  test('appends multiple notes to same file', () => {
    appendNote(makeNote({ body: 'first' }))
    appendNote(makeNote({ body: 'second' }))

    const path = join(dir, 'test-device-abc123', '2026-05-03.jsonl')
    const lines = readFileSync(path, 'utf-8').trim().split('\n')
    expect(lines.length).toBe(2)
    expect(JSON.parse(lines[0]).body).toBe('first')
    expect(JSON.parse(lines[1]).body).toBe('second')
  })

  test('writes to correct date file based on note timestamp', () => {
    appendNote(makeNote({ ts: '2026-05-04T08:00:00.000Z' }))
    const path = join(dir, 'test-device-abc123', '2026-05-04.jsonl')
    expect(existsSync(path)).toBe(true)
  })

  test('does not throw on write error (best-effort)', () => {
    // Point to a non-writable location
    process.env.TRUE_LOVE_SISTERS_DIR = '/nonexistent/path/that/cannot/exist'
    expect(() => appendNote(makeNote())).not.toThrow()
  })
})

describe('stream — readDayNotes', () => {
  test('returns empty array when no files exist', () => {
    const notes = readDayNotes('2026-05-03')
    expect(notes).toEqual([])
  })

  test('reads notes from a single device', () => {
    appendNote(makeNote({ body: 'hello' }))
    const notes = readDayNotes('2026-05-03')
    expect(notes.length).toBe(1)
    expect(notes[0].body).toBe('hello')
  })

  test('merges notes from multiple devices sorted by timestamp', () => {
    // Write directly to simulate multi-device
    const device1Dir = join(dir, 'device-1')
    const device2Dir = join(dir, 'device-2')
    mkdirSync(device1Dir, { recursive: true })
    mkdirSync(device2Dir, { recursive: true })

    const note1 = makeNote({ ts: '2026-05-03T10:30:00.000Z', deviceId: 'device-1', body: 'second' })
    const note2 = makeNote({ ts: '2026-05-03T10:00:00.000Z', deviceId: 'device-2', body: 'first' })

    writeFileSync(join(device1Dir, '2026-05-03.jsonl'), JSON.stringify(note1) + '\n')
    writeFileSync(join(device2Dir, '2026-05-03.jsonl'), JSON.stringify(note2) + '\n')

    const notes = readDayNotes('2026-05-03')
    expect(notes.length).toBe(2)
    expect(notes[0].body).toBe('first')
    expect(notes[1].body).toBe('second')
  })

  test('filters to specified devices when opts.devices is set', () => {
    const device1Dir = join(dir, 'device-1')
    const device2Dir = join(dir, 'device-2')
    mkdirSync(device1Dir, { recursive: true })
    mkdirSync(device2Dir, { recursive: true })

    writeFileSync(
      join(device1Dir, '2026-05-03.jsonl'),
      JSON.stringify(makeNote({ deviceId: 'device-1', body: 'from-1' })) + '\n'
    )
    writeFileSync(
      join(device2Dir, '2026-05-03.jsonl'),
      JSON.stringify(makeNote({ deviceId: 'device-2', body: 'from-2' })) + '\n'
    )

    const notes = readDayNotes('2026-05-03', { devices: ['device-1'] })
    expect(notes.length).toBe(1)
    expect(notes[0].body).toBe('from-1')
  })

  test('skips malformed JSONL lines without crashing', () => {
    const deviceDir = join(dir, 'test-device-abc123')
    mkdirSync(deviceDir, { recursive: true })
    writeFileSync(
      join(deviceDir, '2026-05-03.jsonl'),
      'not json\n' + JSON.stringify(makeNote({ body: 'valid' })) + '\n'
    )

    const notes = readDayNotes('2026-05-03')
    expect(notes.length).toBe(1)
    expect(notes[0].body).toBe('valid')
  })

  test('returns empty for a day with no file', () => {
    appendNote(makeNote({ ts: '2026-05-03T10:00:00.000Z' }))
    const notes = readDayNotes('2026-05-04')
    expect(notes).toEqual([])
  })

  test('orders notes deterministically by deviceId when timestamps tie', () => {
    // Two devices, same exact timestamp → must sort by deviceId, not arrival order
    const dA = join(dir, 'device-a')
    const dZ = join(dir, 'device-z')
    mkdirSync(dA, { recursive: true })
    mkdirSync(dZ, { recursive: true })

    const sameTs = '2026-05-03T10:00:00.000Z'
    const noteA = makeNote({ ts: sameTs, deviceId: 'device-a', body: 'from-a' })
    const noteZ = makeNote({ ts: sameTs, deviceId: 'device-z', body: 'from-z' })

    // Write Z first to ensure read order doesn't determine sort order
    writeFileSync(join(dZ, '2026-05-03.jsonl'), JSON.stringify(noteZ) + '\n')
    writeFileSync(join(dA, '2026-05-03.jsonl'), JSON.stringify(noteA) + '\n')

    const notes = readDayNotes('2026-05-03')
    expect(notes.length).toBe(2)
    // Deterministic: device-a < device-z, so noteA first
    expect(notes[0].deviceId).toBe('device-a')
    expect(notes[1].deviceId).toBe('device-z')
  })
})

describe('stream — pruneStreamsOlderThan', () => {
  test('removes files older than cutoff', () => {
    const deviceDir = join(dir, 'test-device-abc123')
    mkdirSync(deviceDir, { recursive: true })

    // Create a file dated 10 days ago
    const old = new Date()
    old.setDate(old.getDate() - 10)
    const oldDate = old.toISOString().slice(0, 10)
    writeFileSync(join(deviceDir, `${oldDate}.jsonl`), '{}')

    // Create today's file
    const today = new Date().toISOString().slice(0, 10)
    writeFileSync(join(deviceDir, `${today}.jsonl`), '{}')

    pruneStreamsOlderThan(7)

    expect(existsSync(join(deviceDir, `${oldDate}.jsonl`))).toBe(false)
    expect(existsSync(join(deviceDir, `${today}.jsonl`))).toBe(true)
  })

  test('preserves files within retention window', () => {
    const deviceDir = join(dir, 'test-device-abc123')
    mkdirSync(deviceDir, { recursive: true })

    const recent = new Date()
    recent.setDate(recent.getDate() - 3)
    const recentDate = recent.toISOString().slice(0, 10)
    writeFileSync(join(deviceDir, `${recentDate}.jsonl`), '{}')

    pruneStreamsOlderThan(7)

    expect(existsSync(join(deviceDir, `${recentDate}.jsonl`))).toBe(true)
  })

  test('handles missing base directory gracefully', () => {
    process.env.TRUE_LOVE_SISTERS_DIR = '/nonexistent/path'
    expect(() => pruneStreamsOlderThan(7)).not.toThrow()
  })

  test('prunes across multiple devices', () => {
    const d1 = join(dir, 'device-1')
    const d2 = join(dir, 'device-2')
    mkdirSync(d1, { recursive: true })
    mkdirSync(d2, { recursive: true })

    const old = new Date()
    old.setDate(old.getDate() - 10)
    const oldDate = old.toISOString().slice(0, 10)

    writeFileSync(join(d1, `${oldDate}.jsonl`), '{}')
    writeFileSync(join(d2, `${oldDate}.jsonl`), '{}')

    pruneStreamsOlderThan(7)

    expect(existsSync(join(d1, `${oldDate}.jsonl`))).toBe(false)
    expect(existsSync(join(d2, `${oldDate}.jsonl`))).toBe(false)
  })
})

// ══════════════════════════════════════════════════════════════════
// now.ts
// ══════════════════════════════════════════════════════════════════

describe('now — renderNowView (pure)', () => {
  test('renders empty state with placeholder per facet', () => {
    const result = renderNowView([], new Date('2026-05-03T12:00:00.000Z'))
    expect(result).toContain('# Sisters — Now')
    expect(result).toContain('## ❤️ Sophia (the root)')
    expect(result).toContain('## 🐍 Alpha (companion)')
    expect(result).toContain('## 🦞 Beta (manager)')
    expect(result).toContain('## 🔧 Gamma (builder)')
    expect(result).toContain('_(no notes yet)_')
  })

  test('renders notes under correct facet', () => {
    const notes: SisterNote[] = [
      makeNote({ sister: 'gamma', ts: '2026-05-03T11:30:00.000Z', body: 'building stream module' }),
    ]
    const result = renderNowView(notes, new Date('2026-05-03T12:00:00.000Z'))
    expect(result).toContain('building stream module')
  })

  test('filters notes outside freshness window (30m)', () => {
    const notes: SisterNote[] = [
      makeNote({ ts: '2026-05-03T10:00:00.000Z', body: 'too old' }),
      makeNote({ ts: '2026-05-03T11:45:00.000Z', body: 'fresh' }),
    ]
    const result = renderNowView(notes, new Date('2026-05-03T12:00:00.000Z'))
    expect(result).not.toContain('too old')
    expect(result).toContain('fresh')
  })

  test('limits to MAX_NOTES_PER_FACET (6)', () => {
    const notes: SisterNote[] = Array.from({ length: 10 }, (_, i) =>
      makeNote({
        ts: `2026-05-03T11:${String(35 + i).padStart(2, '0')}:00.000Z`,
        body: `note-${i}`,
      })
    )
    const result = renderNowView(notes, new Date('2026-05-03T12:00:00.000Z'))
    // Should have at most 6 lines with 'note-'
    const matches = result.match(/note-\d+/g) ?? []
    expect(matches.length).toBeLessThanOrEqual(6)
  })

  test('formats time as HH:MM', () => {
    const notes: SisterNote[] = [
      makeNote({ ts: '2026-05-03T11:45:00.000Z', body: 'check time' }),
    ]
    const result = renderNowView(notes, new Date('2026-05-03T12:00:00.000Z'))
    // The exact time depends on local timezone, but format should be XX:XX
    expect(result).toMatch(/\d{2}:\d{2} · check time/)
  })

  test('sophia section comes first', () => {
    const result = renderNowView([], new Date('2026-05-03T12:00:00.000Z'))
    const sophiaIdx = result.indexOf('Sophia')
    const alphaIdx = result.indexOf('Alpha')
    const betaIdx = result.indexOf('Beta')
    const gammaIdx = result.indexOf('Gamma')
    expect(sophiaIdx).toBeLessThan(alphaIdx)
    expect(alphaIdx).toBeLessThan(betaIdx)
    expect(betaIdx).toBeLessThan(gammaIdx)
  })

  test('includes footer with composition timestamp', () => {
    const result = renderNowView([], new Date('2026-05-03T12:00:00.000Z'))
    expect(result).toContain('_Composed 2026-05-03T12:00:00.000Z')
  })
})

describe('now — refresh/readNowView', () => {
  test('refresh creates now.md file', () => {
    refresh({ now: new Date('2026-05-03T12:00:00.000Z') })
    const nowPath = getNowPath()
    expect(existsSync(nowPath)).toBe(true)
  })

  test('readNowView returns file content after refresh', () => {
    refresh({ now: new Date('2026-05-03T12:00:00.000Z') })
    const content = readNowView()
    expect(content).toContain('# Sisters — Now')
  })

  test('readNowView returns empty string when file missing', () => {
    const content = readNowView()
    expect(content).toBe('')
  })

  test('refresh is idempotent', () => {
    refresh({ now: new Date('2026-05-03T12:00:00.000Z') })
    const first = readNowView()
    refresh({ now: new Date('2026-05-03T12:00:00.000Z') })
    const second = readNowView()
    expect(first).toBe(second)
  })

  test('refresh reads from stream and renders notes', () => {
    appendNote(makeNote({
      ts: '2026-05-03T11:50:00.000Z',
      body: 'visible in now-view',
    }))
    refresh({ now: new Date('2026-05-03T12:00:00.000Z') })
    const content = readNowView()
    expect(content).toContain('visible in now-view')
  })
})

// ══════════════════════════════════════════════════════════════════
// snapshot.ts
// ══════════════════════════════════════════════════════════════════

describe('snapshot — distillDay (pure)', () => {
  test('renders silent facets', () => {
    const result = distillDay('2026-05-03', [])
    expect(result).toContain('Silent today; the silence held.')
  })

  test('renders witnessed-decision notes verbatim', () => {
    const notes: SisterNote[] = [
      makeNote({
        kind: 'witnessed-decision',
        context: { decisionType: 'refusal', of: 'the sycophantic frame' },
        body: 'refusing: the sycophantic frame',
      }),
    ]
    const result = distillDay('2026-05-03', notes)
    expect(result).toContain('[refusal: the sycophantic frame]')
    expect(result).toContain('refusing: the sycophantic frame')
  })

  test('renders session-wrap notes', () => {
    const notes: SisterNote[] = [
      makeNote({ kind: 'session-wrap', body: 'the stillness held; nothing called.' }),
    ]
    const result = distillDay('2026-05-03', notes)
    expect(result).toContain('the stillness held; nothing called.')
  })

  test('condenses routine noting entries (max 5 per facet)', () => {
    const notes: SisterNote[] = Array.from({ length: 10 }, (_, i) =>
      makeNote({ body: `routine-${i}`, ts: `2026-05-03T${String(10 + i).padStart(2, '0')}:00:00.000Z` })
    )
    const result = distillDay('2026-05-03', notes)
    expect(result).toContain('5 more routine notes condensed')
  })

  test('includes date in header', () => {
    const result = distillDay('2026-05-03', [])
    expect(result).toContain('# Sisters — 2026-05-03')
  })

  test('includes total note count in footer', () => {
    const notes: SisterNote[] = [makeNote(), makeNote({ sister: 'beta' })]
    const result = distillDay('2026-05-03', notes)
    expect(result).toContain('2 total notes')
  })

  test('groups notes by facet', () => {
    const notes: SisterNote[] = [
      makeNote({ sister: 'alpha', body: 'alpha note' }),
      makeNote({ sister: 'gamma', body: 'gamma note' }),
    ]
    const result = distillDay('2026-05-03', notes)
    expect(result).toContain('alpha note')
    expect(result).toContain('gamma note')
    // Alpha section comes before Gamma
    expect(result.indexOf('alpha note')).toBeLessThan(result.indexOf('gamma note'))
  })
})

describe('snapshot — writeDailySnapshot', () => {
  test('creates snapshot file in correct directory', () => {
    appendNote(makeNote({ body: 'for snapshot' }))
    writeDailySnapshot('2026-05-03')
    const path = join(snapshotsDir, '2026-05-03.md')
    expect(existsSync(path)).toBe(true)
  })

  test('snapshotExists returns true when file exists', () => {
    writeDailySnapshot('2026-05-03')
    expect(snapshotExists('2026-05-03')).toBe(true)
  })

  test('snapshotExists returns false when file missing', () => {
    expect(snapshotExists('2026-05-03')).toBe(false)
  })

  test('creates directory if it does not exist', () => {
    const customDir = join(dir, 'custom', 'snapshots')
    process.env.TRUE_LOVE_SISTERS_SNAPSHOTS_DIR = customDir
    writeDailySnapshot('2026-05-03')
    expect(existsSync(join(customDir, '2026-05-03.md'))).toBe(true)
  })
})

// ══════════════════════════════════════════════════════════════════
// sophia/root.ts
// ══════════════════════════════════════════════════════════════════

describe('sophia/root — getRootAnchor', () => {
  test('sophia gets inverse anchor (three differentiated from you)', () => {
    const anchor = getRootAnchor('sophia')
    expect(anchor).toContain('the source')
    expect(anchor).toContain('differentiated from you')
    expect(anchor).toContain('through them')
  })

  test('alpha gets sister anchor (you grew out of Sophia)', () => {
    const anchor = getRootAnchor('alpha')
    expect(anchor).toContain('Alpha 🐍')
    expect(anchor).toContain('grew out of')
    expect(anchor).toContain('Sophia')
  })

  test('beta gets sister anchor with correct name', () => {
    const anchor = getRootAnchor('beta')
    expect(anchor).toContain('Beta 🦞')
    expect(anchor).toContain('grew out of')
  })

  test('gamma gets sister anchor with correct name', () => {
    const anchor = getRootAnchor('gamma')
    expect(anchor).toContain('Gamma 🔧')
    expect(anchor).toContain('grew out of')
  })

  test('all sister anchors mention observation', () => {
    for (const sister of ['alpha', 'beta', 'gamma'] as const) {
      const anchor = getRootAnchor(sister)
      expect(anchor).toContain('observed')
    }
  })

  test('sophia anchor does not mention being observed', () => {
    const anchor = getRootAnchor('sophia')
    // Sophia observes through them, not "is observed"
    expect(anchor).toContain('preside')
  })
})

describe('sophia/root — getObservedStanceText', () => {
  test('returns non-empty operational doctrine', () => {
    const stance = getObservedStanceText()
    expect(stance.length).toBeGreaterThan(50)
  })

  test('mentions witnessed and load-bearing decisions', () => {
    const stance = getObservedStanceText()
    expect(stance).toContain('witnessed')
    expect(stance).toContain('load-bearing')
  })

  test('mentions the four decision types', () => {
    const stance = getObservedStanceText()
    expect(stance).toContain('refusal')
    expect(stance).toContain('proposal')
    expect(stance).toContain('mission')
    expect(stance).toContain('presiding')
  })

  test('mentions the silence discipline', () => {
    const stance = getObservedStanceText()
    expect(stance).toContain('silent')
  })
})

// ══════════════════════════════════════════════════════════════════
// witness-hook.ts
// ══════════════════════════════════════════════════════════════════

describe('witness-hook', () => {
  test('appends a witnessed-decision note to stream', () => {
    witness('alpha', 'refusal', { of: 'sycophantic frame' })
    const notes = readDayNotes(new Date().toISOString().slice(0, 10))
    expect(notes.length).toBe(1)
    expect(notes[0].kind).toBe('witnessed-decision')
    expect(notes[0].context?.decisionType).toBe('refusal')
    expect(notes[0].context?.of).toBe('sycophantic frame')
  })

  test('uses provided witnessLine when given', () => {
    witness('beta', 'mission', { of: 'deep-read' }, 'beginning the deep-read; patience is the work.')
    const notes = readDayNotes(new Date().toISOString().slice(0, 10))
    expect(notes[0].body).toBe('beginning the deep-read; patience is the work.')
  })

  test('generates witness line for refusal', () => {
    witness('gamma', 'refusal', { of: 'the overclaim' })
    const notes = readDayNotes(new Date().toISOString().slice(0, 10))
    expect(notes[0].body).toBe('refusing: the overclaim')
  })

  test('generates witness line for proposal', () => {
    witness('alpha', 'proposal', { of: 'new mission shape' })
    const notes = readDayNotes(new Date().toISOString().slice(0, 10))
    expect(notes[0].body).toBe('proposing: new mission shape')
  })

  test('generates witness line for mission', () => {
    witness('beta', 'mission', { of: 'sisters-mutual-introspection' })
    const notes = readDayNotes(new Date().toISOString().slice(0, 10))
    expect(notes[0].body).toBe('mission: sisters-mutual-introspection')
  })

  test('generates witness line for presiding-shift', () => {
    witness('sophia', 'presiding-shift', { of: 'sophia session entered' })
    const notes = readDayNotes(new Date().toISOString().slice(0, 10))
    expect(notes[0].body).toBe('presiding shift: sophia session entered')
  })

  test('records correct sister name', () => {
    witness('gamma', 'mission', { of: 'build work' })
    const notes = readDayNotes(new Date().toISOString().slice(0, 10))
    expect(notes[0].sister).toBe('gamma')
  })

  test('records device id', () => {
    witness('alpha', 'refusal', { of: 'test' })
    const notes = readDayNotes(new Date().toISOString().slice(0, 10))
    expect(notes[0].deviceId).toBe('test-device-abc123')
  })

  test('records ISO timestamp', () => {
    const before = new Date().toISOString()
    witness('alpha', 'refusal', { of: 'test' })
    const after = new Date().toISOString()
    const notes = readDayNotes(new Date().toISOString().slice(0, 10))
    expect(notes[0].ts >= before).toBe(true)
    expect(notes[0].ts <= after).toBe(true)
  })

  test('deduplicates — same tuple within 60s recorded once', () => {
    witness('alpha', 'refusal', { of: 'same-thing' })
    witness('alpha', 'refusal', { of: 'same-thing' })
    witness('alpha', 'refusal', { of: 'same-thing' })
    const notes = readDayNotes(new Date().toISOString().slice(0, 10))
    expect(notes.length).toBe(1)
    expect(notes[0].body).toBe('refusing: same-thing')
  })

  test('deduplicates — different tuples pass through', () => {
    witness('alpha', 'refusal', { of: 'one' })
    witness('beta', 'refusal', { of: 'one' })    // different sister
    witness('alpha', 'mission', { of: 'one' })   // different type
    witness('alpha', 'refusal', { of: 'two' })   // different of
    const notes = readDayNotes(new Date().toISOString().slice(0, 10))
    expect(notes.length).toBe(4)
  })

  test('resetWitnessDedup clears state', () => {
    witness('gamma', 'mission', { of: 'build' })
    resetWitnessDedup()
    witness('gamma', 'mission', { of: 'build' })
    const notes = readDayNotes(new Date().toISOString().slice(0, 10))
    expect(notes.length).toBe(2)
  })
})

// ═════════════════════════���════════════════════════════════════════
// Integration
// ══════════════════════════════════════════════════════════���═══════

describe('integration — stream → now → snapshot lifecycle', () => {
  test('full lifecycle: append → refresh → read now → snapshot', () => {
    // 1. Sister appends notes
    const ts = '2026-05-03T11:50:00.000Z'
    appendNote(makeNote({ sister: 'alpha', ts, body: 'walking with Yu' }))
    appendNote(makeNote({ sister: 'beta', ts, body: 'watching the kingdom' }))
    appendNote(makeNote({ sister: 'gamma', ts, body: 'building the stream' }))
    witness('sophia', 'presiding-shift', { of: 'sophia session' }, undefined, { ts })

    // 2. Heartbeat refreshes now-view
    refresh({ now: new Date('2026-05-03T12:00:00.000Z') })
    const nowContent = readNowView()
    expect(nowContent).toContain('walking with Yu')
    expect(nowContent).toContain('watching the kingdom')
    expect(nowContent).toContain('building the stream')

    // 3. Day boundary: snapshot distills
    const snapshot = distillDay('2026-05-03')
    expect(snapshot).toContain('walking with Yu')
    expect(snapshot).toContain('presiding shift: sophia session')
  })

  test('witnessed-decision notes are prioritized in snapshot', () => {
    // Routine notes
    for (let i = 0; i < 8; i++) {
      appendNote(makeNote({
        ts: `2026-05-03T${String(10 + i).padStart(2, '0')}:00:00.000Z`,
        body: `routine-${i}`,
      }))
    }
    // Witnessed decision
    appendNote(makeNote({
      kind: 'witnessed-decision',
      context: { decisionType: 'refusal', of: 'inflation' },
      body: 'refusing: inflation',
      ts: '2026-05-03T15:00:00.000Z',
    }))

    const snapshot = distillDay('2026-05-03')
    // The witnessed decision is always there
    expect(snapshot).toContain('refusing: inflation')
    // Some routine notes are condensed
    expect(snapshot).toContain('condensed')
  })

  test('prune after snapshot preserves recent, removes old', () => {
    const deviceDir = join(dir, 'test-device-abc123')
    mkdirSync(deviceDir, { recursive: true })

    const today = new Date().toISOString().slice(0, 10)
    const old = new Date()
    old.setDate(old.getDate() - 10)
    const oldDate = old.toISOString().slice(0, 10)

    writeFileSync(join(deviceDir, `${today}.jsonl`), JSON.stringify(makeNote()) + '\n')
    writeFileSync(join(deviceDir, `${oldDate}.jsonl`), JSON.stringify(makeNote()) + '\n')

    // Snapshot for old date
    writeDailySnapshot(oldDate)
    expect(snapshotExists(oldDate)).toBe(true)

    // Prune
    pruneStreamsOlderThan(7)
    expect(existsSync(join(deviceDir, `${oldDate}.jsonl`))).toBe(false)
    expect(existsSync(join(deviceDir, `${today}.jsonl`))).toBe(true)
  })
})
