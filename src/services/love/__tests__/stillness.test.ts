import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  computeFingerprint,
  fingerprintsMatch,
  loadState,
  saveState,
  shouldSkip,
  MAX_SKIPS,
  type StillnessFingerprint,
  type StillnessState,
} from '../stillness.js'

// ── Test helpers ───────────────────────────────────────────────────

let tmp: string
let scopeHome: string
let cwd: string
let fromYuPath: string
let modelPath: string

const savedEnv: Record<string, string | undefined> = {}
const envKeys = [
  'TRUE_LOVE_FROM_YU_PATH',
  'TRUE_LOVE_MODEL_FILE',
  'TRUE_LOVE_SKIP_STILLNESS_GUARD',
]

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'stillness-test-'))
  scopeHome = join(tmp, 'scope')
  cwd = join(tmp, 'repo')
  fromYuPath = join(tmp, 'from-yu.md')
  modelPath = join(tmp, 'model.txt')
  mkdirSync(scopeHome, { recursive: true })
  mkdirSync(cwd, { recursive: true })

  // Save and override env
  for (const k of envKeys) {
    savedEnv[k] = process.env[k]
  }
  process.env.TRUE_LOVE_FROM_YU_PATH = fromYuPath
  process.env.TRUE_LOVE_MODEL_FILE = modelPath
  delete process.env.TRUE_LOVE_SKIP_STILLNESS_GUARD
})

afterEach(() => {
  // Restore env
  for (const k of envKeys) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  try { rmSync(tmp, { recursive: true, force: true }) } catch { /* */ }
})

// ── computeFingerprint ─────────────────────────────────────────────

describe('computeFingerprint', () => {
  test('returns zeroed fingerprint when files are missing', () => {
    const fp = computeFingerprint(cwd)
    expect(fp.fromYuMtimeMs).toBe(0)
    // gitHead is empty because tmp dir isn't a repo
    expect(fp.gitHead).toBe('')
    expect(fp.modelTxt).toBe('')
  })

  test('reads from-yu.md mtime', () => {
    writeFileSync(fromYuPath, 'hello from yu')
    const fp = computeFingerprint(cwd)
    expect(fp.fromYuMtimeMs).toBeGreaterThan(0)
  })

  test('reads model.txt contents', () => {
    writeFileSync(modelPath, '  opus  \n')
    const fp = computeFingerprint(cwd)
    expect(fp.modelTxt).toBe('opus')
  })

  test('detects from-yu.md mtime change', () => {
    writeFileSync(fromYuPath, 'msg1')
    const fp1 = computeFingerprint(cwd)

    // Touch with a different mtime
    const futureMs = Date.now() + 5000
    const futureDate = new Date(futureMs)
    const { utimesSync } = require('node:fs')
    utimesSync(fromYuPath, futureDate, futureDate)

    const fp2 = computeFingerprint(cwd)
    expect(fp2.fromYuMtimeMs).not.toBe(fp1.fromYuMtimeMs)
  })

  test('detects model.txt content change', () => {
    writeFileSync(modelPath, 'opus')
    const fp1 = computeFingerprint(cwd)

    writeFileSync(modelPath, 'sonnet')
    const fp2 = computeFingerprint(cwd)

    expect(fp1.modelTxt).toBe('opus')
    expect(fp2.modelTxt).toBe('sonnet')
    expect(fingerprintsMatch(fp1, fp2)).toBe(false)
  })
})

// ── fingerprintsMatch ──────────────────────────────────────────────

describe('fingerprintsMatch', () => {
  const base: StillnessFingerprint = {
    fromYuMtimeMs: 1000,
    gitHead: 'abc123',
    modelTxt: 'opus',
  }

  test('identical fingerprints match', () => {
    expect(fingerprintsMatch(base, { ...base })).toBe(true)
  })

  test('different fromYuMtimeMs → no match', () => {
    expect(fingerprintsMatch(base, { ...base, fromYuMtimeMs: 2000 })).toBe(false)
  })

  test('different gitHead → no match', () => {
    expect(fingerprintsMatch(base, { ...base, gitHead: 'def456' })).toBe(false)
  })

  test('different modelTxt → no match', () => {
    expect(fingerprintsMatch(base, { ...base, modelTxt: 'sonnet' })).toBe(false)
  })
})

// ── State persistence ──────────────────────────────────────────────

describe('state persistence', () => {
  test('loadState returns empty state when file missing', () => {
    const state = loadState(scopeHome)
    expect(state.lastFingerprint).toBeNull()
    expect(state.skipCount).toBe(0)
    expect(state.lastCheckAt).toBeNull()
  })

  test('saveState → loadState round-trip', () => {
    const state: StillnessState = {
      lastFingerprint: { fromYuMtimeMs: 999, gitHead: 'abc', modelTxt: 'opus' },
      skipCount: 5,
      lastCheckAt: '2026-05-09T10:00:00Z',
    }
    saveState(scopeHome, state)
    const loaded = loadState(scopeHome)
    expect(loaded).toEqual(state)
  })

  test('saveState creates parent directories', () => {
    const deep = join(tmp, 'a', 'b', 'c')
    const state: StillnessState = {
      lastFingerprint: null,
      skipCount: 0,
      lastCheckAt: null,
    }
    saveState(deep, state)
    expect(existsSync(join(deep, 'stillness.json'))).toBe(true)
  })
})

// ── shouldSkip ─────────────────────────────────────────────────────

describe('shouldSkip', () => {
  test('first run → no skip, records baseline', () => {
    const result = shouldSkip({ scopeHome, cwd })
    expect(result.skip).toBe(false)
    expect(result.reason).toContain('first check')

    // State file created
    const state = loadState(scopeHome)
    expect(state.lastFingerprint).not.toBeNull()
    expect(state.skipCount).toBe(0)
  })

  test('unchanged fingerprint → skip', () => {
    // First call records baseline
    shouldSkip({ scopeHome, cwd })

    // Second call with same fingerprint → skip
    const result = shouldSkip({ scopeHome, cwd })
    expect(result.skip).toBe(true)
    expect(result.reason).toContain('unchanged')
    expect(result.reason).toContain('1/' + MAX_SKIPS)
  })

  test('skip count increments on repeated unchanged calls', () => {
    shouldSkip({ scopeHome, cwd }) // baseline

    for (let i = 1; i <= 3; i++) {
      const result = shouldSkip({ scopeHome, cwd })
      expect(result.skip).toBe(true)
      expect(result.reason).toContain(`${i}/${MAX_SKIPS}`)
    }

    const state = loadState(scopeHome)
    expect(state.skipCount).toBe(3)
  })

  test('fingerprint change → no skip, reset counter', () => {
    shouldSkip({ scopeHome, cwd }) // baseline
    shouldSkip({ scopeHome, cwd }) // skip 1
    shouldSkip({ scopeHome, cwd }) // skip 2

    // Change fingerprint by writing model.txt
    writeFileSync(modelPath, 'haiku')

    const result = shouldSkip({ scopeHome, cwd })
    expect(result.skip).toBe(false)
    expect(result.reason).toContain('changed')

    const state = loadState(scopeHome)
    expect(state.skipCount).toBe(0)
  })

  test('ceiling reached → no skip, reset counter', () => {
    shouldSkip({ scopeHome, cwd }) // baseline

    // Skip up to the ceiling
    for (let i = 0; i < MAX_SKIPS; i++) {
      const result = shouldSkip({ scopeHome, cwd })
      expect(result.skip).toBe(true)
    }

    // Next call hits the ceiling → forced re-check
    const result = shouldSkip({ scopeHome, cwd })
    expect(result.skip).toBe(false)
    expect(result.reason).toContain('ceiling')

    // Counter reset
    const state = loadState(scopeHome)
    expect(state.skipCount).toBe(0)
  })

  test('invitation override → no skip regardless of fingerprint', () => {
    shouldSkip({ scopeHome, cwd }) // baseline

    const result = shouldSkip({
      scopeHome,
      cwd,
      invitation: 'wake up, something happened',
    })
    expect(result.skip).toBe(false)
    expect(result.reason).toContain('invitation')
  })

  test('empty invitation does not override', () => {
    shouldSkip({ scopeHome, cwd }) // baseline

    const result = shouldSkip({
      scopeHome,
      cwd,
      invitation: '   ',
    })
    expect(result.skip).toBe(true)
  })

  test('env var override → no skip', () => {
    shouldSkip({ scopeHome, cwd }) // baseline
    process.env.TRUE_LOVE_SKIP_STILLNESS_GUARD = '1'

    const result = shouldSkip({ scopeHome, cwd })
    expect(result.skip).toBe(false)
    expect(result.reason).toContain('env')
  })

  test('from-yu.md change wakes the session', () => {
    writeFileSync(fromYuPath, 'msg1')
    shouldSkip({ scopeHome, cwd }) // baseline

    shouldSkip({ scopeHome, cwd }) // skip (unchanged)

    // Yu writes a new message → mtime changes
    const futureMs = Date.now() + 5000
    const futureDate = new Date(futureMs)
    const { utimesSync } = require('node:fs')
    utimesSync(fromYuPath, futureDate, futureDate)

    const result = shouldSkip({ scopeHome, cwd })
    expect(result.skip).toBe(false)
    expect(result.reason).toContain('changed')
  })

  test('model.txt change wakes the session', () => {
    shouldSkip({ scopeHome, cwd }) // baseline
    shouldSkip({ scopeHome, cwd }) // skip

    writeFileSync(modelPath, 'sonnet')

    const result = shouldSkip({ scopeHome, cwd })
    expect(result.skip).toBe(false)
    expect(result.reason).toContain('changed')
  })

  test('state persists across shouldSkip calls', () => {
    shouldSkip({ scopeHome, cwd }) // baseline

    // Verify state file exists and is valid JSON
    const statePath = join(scopeHome, 'stillness.json')
    expect(existsSync(statePath)).toBe(true)

    const raw = readFileSync(statePath, 'utf-8')
    const state = JSON.parse(raw)
    expect(state.lastFingerprint).toBeDefined()
    expect(state.skipCount).toBe(0)
    expect(state.lastCheckAt).toBeDefined()
  })

  test('MAX_SKIPS is 12', () => {
    expect(MAX_SKIPS).toBe(12)
  })
})
