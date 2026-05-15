// sisters/tend.test.ts — unit tests for sisters/tend.ts.
//
// tendStream() is the only exported function. It orchestrates:
//   1. refresh() → updates the rolling now-view
//   2. checkDayBoundary() → distills yesterday's snapshot if missing,
//      then prunes streams older than 7 days
//
// Both sub-operations are best-effort (swallowed catches). Tests verify
// the observable side effects using env var isolation and temp dirs.
//
// checkDayBoundary uses real new Date() internally — tests observe the
// side effect of yesterday's snapshot being created rather than
// parameterizing the date.

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { tendStream } from './tend.js'
import { getSnapshotsDir, snapshotExists } from './snapshot.js'

// ── Isolation helpers ─────────────────────────────────────────────

let tmpDir = ''

function isolate(): void {
  tmpDir = mkdtempSync(join(tmpdir(), 'sisters-tend-test-'))
  process.env.TRUE_LOVE_SISTERS_DIR = join(tmpDir, 'sisters')
  process.env.TRUE_LOVE_SISTERS_NOW_PATH = join(tmpDir, 'sisters', 'now.md')
  process.env.TRUE_LOVE_SISTERS_SNAPSHOTS_DIR = join(tmpDir, 'snapshots')
  process.env.TRUE_LOVE_YU_WITNESS_DIR = join(tmpDir, 'yu-witness') // absent dir → silent empty blocks
  process.env.TRUE_LOVE_DEVICE_ID = 'test-device'
}

function cleanup(): void {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true })
    tmpDir = ''
  }
  delete process.env.TRUE_LOVE_SISTERS_DIR
  delete process.env.TRUE_LOVE_SISTERS_NOW_PATH
  delete process.env.TRUE_LOVE_SISTERS_SNAPSHOTS_DIR
  delete process.env.TRUE_LOVE_YU_WITNESS_DIR
  delete process.env.TRUE_LOVE_DEVICE_ID
}

// ── yesterday helper ─────────────────────────────────────────────

function yesterdayStr(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

// ── tendStream ────────────────────────────────────────────────────

describe('tendStream — does not throw', () => {
  beforeEach(() => { isolate() })
  afterEach(() => cleanup())

  it('does not throw when all dirs are absent', () => {
    // dirs point to non-existent paths; everything is best-effort
    expect(() => tendStream()).not.toThrow()
  })

  it('does not throw when called repeatedly', () => {
    expect(() => {
      tendStream()
      tendStream()
      tendStream()
    }).not.toThrow()
  })
})

describe('tendStream — now-view side effect', () => {
  beforeEach(() => { isolate() })
  afterEach(() => cleanup())

  it('creates now.md after call', () => {
    const nowPath = process.env.TRUE_LOVE_SISTERS_NOW_PATH!
    expect(existsSync(nowPath)).toBe(false)
    tendStream()
    expect(existsSync(nowPath)).toBe(true)
  })

  it('now.md contains sisters header after call', () => {
    tendStream()
    const nowPath = process.env.TRUE_LOVE_SISTERS_NOW_PATH!
    const { readFileSync } = require('node:fs') as typeof import('node:fs')
    const content = readFileSync(nowPath, 'utf-8')
    expect(content).toContain('# Sisters — Now')
  })
})

describe('tendStream — day-boundary snapshot side effect', () => {
  beforeEach(() => { isolate() })
  afterEach(() => cleanup())

  it("creates yesterday's snapshot when it does not exist", () => {
    const yesterday = yesterdayStr()
    expect(snapshotExists(yesterday)).toBe(false)
    tendStream()
    // checkDayBoundary fires because yesterday's snapshot is absent.
    expect(snapshotExists(yesterday)).toBe(true)
  })

  it("snapshot file is in the configured snapshots dir", () => {
    tendStream()
    const snapshotsDir = getSnapshotsDir()
    const yesterday = yesterdayStr()
    expect(existsSync(join(snapshotsDir, `${yesterday}.md`))).toBe(true)
  })

  it("does not recreate yesterday's snapshot when it already exists", () => {
    // First call creates it.
    tendStream()
    const snapshotsDir = getSnapshotsDir()
    const yesterday = yesterdayStr()
    const snapshotPath = join(snapshotsDir, `${yesterday}.md`)
    const { statSync } = require('node:fs') as typeof import('node:fs')
    const mtimeBefore = statSync(snapshotPath).mtimeMs

    // Second call should not recreate (snapshotExists returns true → no write).
    // We can't guarantee mtime difference in the same ms-resolution tick,
    // but we can verify no throw and the file still exists.
    tendStream()
    expect(existsSync(snapshotPath)).toBe(true)
    // mtime should not have changed (file not rewritten).
    const mtimeAfter = statSync(snapshotPath).mtimeMs
    expect(mtimeAfter).toBe(mtimeBefore)
  })

  it("snapshot file starts with # Sisters — <date> header", () => {
    tendStream()
    const snapshotsDir = getSnapshotsDir()
    const yesterday = yesterdayStr()
    const snapshotPath = join(snapshotsDir, `${yesterday}.md`)
    const { readFileSync } = require('node:fs') as typeof import('node:fs')
    const content = readFileSync(snapshotPath, 'utf-8')
    expect(content).toContain(`# Sisters — ${yesterday}`)
  })
})
