// snapshots.test.ts — unit tests for eros/snapshots.ts
//
// Covers: getSnapshotsPath (env override + fallback),
//         recordErosSnapshot (graceful absence, shape, append),
//         readSnapshots (absent file, JSONL parse, malformed-line skip).
//
// Isolation: every test gets its own tmpDir via TRUE_LOVE_EROS_DIR.
// recordErosSnapshot reads eros state via readErosState, so we also
// write a valid state.json to the same tmpDir.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import {
  getSnapshotsPath,
  recordErosSnapshot,
  readSnapshots,
} from './snapshots.js'
import { writeErosState } from './state.js'
import { defaultVector } from './axes.js'
import type { ErosState } from './state.js'

// ── Helpers ────────────────────────────────────────────────────────

const REAL_EROS_DIR = process.env.TRUE_LOVE_EROS_DIR

function makeBaseState(): ErosState {
  return {
    vector: defaultVector(),
    updatedAt: '2026-03-01T12:00:00.000Z',
    lastAttribution: 'init',
    currentMode: 'resting',
    modeAttribution: 'init',
  }
}

function makeSnapCtx(override: Partial<Parameters<typeof recordErosSnapshot>[0]> = {}) {
  return {
    sessionId: 'test-session-001',
    tick: 1,
    mode: 'awakened',
    deviceId: 'test-device',
    ts: '2026-03-01T12:00:00.000Z',
    ...override,
  }
}

let tmpDir: string

beforeEach(() => {
  tmpDir = join(tmpdir(), `tl-snap-${process.pid}-${Date.now()}`)
  mkdirSync(tmpDir, { recursive: true })
  process.env.TRUE_LOVE_EROS_DIR = tmpDir
})

afterEach(() => {
  if (REAL_EROS_DIR !== undefined) {
    process.env.TRUE_LOVE_EROS_DIR = REAL_EROS_DIR
  } else {
    delete process.env.TRUE_LOVE_EROS_DIR
  }
  try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* cleanup, non-fatal */ }
})

// ── getSnapshotsPath ──────────────────────────────────────────────

describe('getSnapshotsPath', () => {
  test('returns path ending in snapshots.jsonl', () => {
    expect(getSnapshotsPath()).toMatch(/snapshots\.jsonl$/)
  })

  test('uses TRUE_LOVE_EROS_DIR override', () => {
    process.env.TRUE_LOVE_EROS_DIR = '/custom/path'
    expect(getSnapshotsPath()).toBe('/custom/path/snapshots.jsonl')
  })

  test('falls back to ~/.true-love/eros/snapshots.jsonl when unset', () => {
    delete process.env.TRUE_LOVE_EROS_DIR
    expect(getSnapshotsPath()).toBe(join(homedir(), '.true-love', 'eros', 'snapshots.jsonl'))
  })
})

// ── recordErosSnapshot ────────────────────────────────────────────

describe('recordErosSnapshot', () => {
  test('does not write snapshot when no eros state exists (graceful absence)', () => {
    recordErosSnapshot(makeSnapCtx())
    const snaps = readSnapshots()
    expect(snaps).toHaveLength(0)
  })

  test('writes snapshot with correct shape when state exists', () => {
    writeErosState(makeBaseState())
    recordErosSnapshot(makeSnapCtx({
      sessionId: 'ses-abc',
      tick: 3,
      mode: 'dwell',
      deviceId: 'dev-x',
      ts: '2026-03-01T12:00:00.000Z',
    }))
    const snaps = readSnapshots()
    expect(snaps).toHaveLength(1)
    const snap = snaps[0]
    expect(snap.sessionId).toBe('ses-abc')
    expect(snap.tick).toBe(3)
    expect(snap.mode).toBe('dwell')
    expect(snap.deviceId).toBe('dev-x')
    expect(snap.ts).toBe('2026-03-01T12:00:00.000Z')
    expect(snap.lastAttribution).toBe('init')
    expect(snap.stateUpdatedAt).toBe('2026-03-01T12:00:00.000Z')
    expect(typeof snap.feltShape).toBe('object')
    expect(typeof snap.vector).toBe('object')
  })

  test('appends multiple snapshots to the same file', () => {
    writeErosState(makeBaseState())
    recordErosSnapshot(makeSnapCtx({ tick: 1, ts: '2026-03-01T12:00:00.000Z' }))
    recordErosSnapshot(makeSnapCtx({ tick: 2, ts: '2026-03-01T12:01:00.000Z' }))
    recordErosSnapshot(makeSnapCtx({ tick: 3, ts: '2026-03-01T12:02:00.000Z' }))
    const snaps = readSnapshots()
    expect(snaps).toHaveLength(3)
    expect(snaps.map((s) => s.tick)).toEqual([1, 2, 3])
  })

  test('does not throw when directory is not writable (best-effort)', () => {
    // eros dir doesn't exist yet — write state to create it, then point to read-only subpath
    // Simple approach: point to a path where a parent component is a file
    const blockingFile = join(tmpDir, 'cannot-be-dir')
    writeFileSync(blockingFile, 'x', 'utf-8')
    process.env.TRUE_LOVE_EROS_DIR = join(blockingFile, 'sub')
    expect(() => recordErosSnapshot(makeSnapCtx())).not.toThrow()
  })

  test('uses ts field for snapshot timestamp', () => {
    writeErosState(makeBaseState())
    const ts = '2026-01-15T08:30:00.000Z'
    recordErosSnapshot(makeSnapCtx({ ts }))
    const snaps = readSnapshots()
    expect(snaps[0].ts).toBe(ts)
  })
})

// ── readSnapshots ─────────────────────────────────────────────────

describe('readSnapshots', () => {
  test('returns empty array when snapshots file does not exist', () => {
    expect(readSnapshots()).toEqual([])
  })

  test('returns empty array when snapshots file is empty', () => {
    writeFileSync(getSnapshotsPath(), '', 'utf-8')
    expect(readSnapshots()).toEqual([])
  })

  test('returns empty array when file is entirely whitespace', () => {
    writeFileSync(getSnapshotsPath(), '   \n\n  \n', 'utf-8')
    expect(readSnapshots()).toEqual([])
  })

  test('parses valid JSONL — one record per non-empty line', () => {
    writeErosState(makeBaseState())
    recordErosSnapshot(makeSnapCtx({ tick: 1 }))
    recordErosSnapshot(makeSnapCtx({ tick: 2 }))
    const snaps = readSnapshots()
    expect(snaps).toHaveLength(2)
    expect(snaps[0].tick).toBe(1)
    expect(snaps[1].tick).toBe(2)
  })

  test('skips malformed lines without crashing', () => {
    const path = getSnapshotsPath()
    writeErosState(makeBaseState())
    recordErosSnapshot(makeSnapCtx({ tick: 1 }))
    // Append a malformed line between two valid ones
    const snap2 = JSON.stringify({ ...makeSnapCtx({ tick: 2 }), sessionId: 'x' })
    writeFileSync(path, readFileSync(path, 'utf-8') + '{bad json\n' + snap2 + '\n', 'utf-8')
    const snaps = readSnapshots()
    // Should get 2 valid (original + snap2), skip malformed
    expect(snaps.length).toBeGreaterThanOrEqual(2)
    expect(snaps.some((s) => s.tick === 1)).toBe(true)
  })

  test('returns empty array when file is unreadable (best-effort)', () => {
    // Write file then point eros dir to a non-existent path
    writeFileSync(getSnapshotsPath(), '{"tick":1}\n', 'utf-8')
    const altDir = join(tmpDir, 'nonexistent')
    process.env.TRUE_LOVE_EROS_DIR = altDir
    expect(readSnapshots()).toEqual([])
  })
})
