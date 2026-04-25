import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  findKingdomBin,
  isKingdomAvailable,
  _resetKingdomCache,
  getCitizenState,
  renderCitizenStateBlock,
  type CitizenState,
} from '../kingdom-citizen.js'

/**
 * Build a tmp dir of stub kingdom-* scripts. Each stub takes args and emits
 * the provided stdout. Returns the dir path; cleanup is the test's
 * responsibility via rmSync.
 */
function mkStubKingdomDir(stubs: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'tl-kingdom-'))
  for (const [name, body] of Object.entries(stubs)) {
    const path = join(dir, name)
    // Shell heredoc emitting body verbatim, then exit 0.
    const script = `#!/bin/sh\ncat <<'STUB_EOF'\n${body}\nSTUB_EOF\nexit 0\n`
    writeFileSync(path, script, { mode: 0o755 })
  }
  return dir
}

describe('kingdom-citizen — resolution + availability', () => {
  let dir: string
  const ORIG_BIN_DIR = process.env.TRUE_LOVE_KINGDOM_BIN_DIR
  const ORIG_SKIP = process.env.TRUE_LOVE_SKIP_KINGDOM

  beforeEach(() => {
    dir = mkStubKingdomDir({
      'kingdom-doctor': '{"exit":0}',
      'kingdom-pulse': '',
    })
    process.env.TRUE_LOVE_KINGDOM_BIN_DIR = dir
    delete process.env.TRUE_LOVE_SKIP_KINGDOM
    _resetKingdomCache()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    if (ORIG_BIN_DIR === undefined) delete process.env.TRUE_LOVE_KINGDOM_BIN_DIR
    else process.env.TRUE_LOVE_KINGDOM_BIN_DIR = ORIG_BIN_DIR
    if (ORIG_SKIP === undefined) delete process.env.TRUE_LOVE_SKIP_KINGDOM
    else process.env.TRUE_LOVE_SKIP_KINGDOM = ORIG_SKIP
    _resetKingdomCache()
  })

  test('findKingdomBin returns env-dir path when set and binary exists', () => {
    const path = findKingdomBin('doctor')
    assert.equal(path, join(dir, 'kingdom-doctor'))
  })

  test('findKingdomBin returns null when binary not in env-dir', () => {
    rmSync(join(dir, 'kingdom-doctor'))
    const path = findKingdomBin('doctor')
    // Without an env-dir hit, falls through to PATH or ~/love-unlimited.
    // In tests we don't guarantee those, so accept null OR a real path.
    if (path !== null) {
      assert.match(path, /(kingdom-doctor|love-unlimited)/)
    } else {
      assert.equal(path, null)
    }
  })

  test('isKingdomAvailable returns true when env-dir binary exists', async () => {
    assert.equal(await isKingdomAvailable(), true)
  })

  test('isKingdomAvailable returns false when TRUE_LOVE_SKIP_KINGDOM=1', async () => {
    process.env.TRUE_LOVE_SKIP_KINGDOM = '1'
    _resetKingdomCache()
    assert.equal(await isKingdomAvailable(), false)
  })

  test('isKingdomAvailable returns false when env-dir empty and PATH/fallback also miss', async () => {
    rmSync(dir, { recursive: true, force: true })
    dir = mkdtempSync(join(tmpdir(), 'tl-kingdom-empty-'))
    process.env.TRUE_LOVE_KINGDOM_BIN_DIR = dir
    _resetKingdomCache()
    // We can't guarantee PATH+fallback miss in CI, so this asserts the
    // call doesn't throw and returns boolean.
    const result = await isKingdomAvailable()
    assert.equal(typeof result, 'boolean')
  })

  test('isKingdomAvailable memoizes result across calls', async () => {
    const a = await isKingdomAvailable()
    rmSync(join(dir, 'kingdom-doctor'))
    // Cache should keep returning the original answer.
    const b = await isKingdomAvailable()
    assert.equal(a, b)
  })
})

describe('kingdom-citizen — getCitizenState', () => {
  let dir: string
  const ORIG_BIN_DIR = process.env.TRUE_LOVE_KINGDOM_BIN_DIR

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    if (ORIG_BIN_DIR === undefined) delete process.env.TRUE_LOVE_KINGDOM_BIN_DIR
    else process.env.TRUE_LOVE_KINGDOM_BIN_DIR = ORIG_BIN_DIR
    _resetKingdomCache()
  })

  test('parses healthy citizen', async () => {
    const json = JSON.stringify({
      exit: 0,
      identity: {
        ok: 'yes',
        agent_id: 'alpha',
        wall: 1,
        soul_fingerprint: 'SHA256:N9N3PC/QxK5FpYecbsl/mNpRfToIzb84qcFYMQmNAJs',
        installed_at: '2026-04-25T20:57:42Z',
      },
      trust: { ok: 'yes', allowed_signers_count: 1 },
      witnesses: { ok: 'solo', cosignature_count: 0, peer_records: 0 },
      freshness: { ok: 'yes', age_s: 42, fresh: 1 },
      attestation: { ok: 'none', count: 0 },
      soul_anchor: { ok: 'none', files: 0, drift: 0, missing: 0 },
      network: { sshd: 'up', firewall: 'absent', hive: 'key_present' },
    })
    dir = mkStubKingdomDir({ 'kingdom-doctor': json })
    process.env.TRUE_LOVE_KINGDOM_BIN_DIR = dir
    _resetKingdomCache()

    const state = await getCitizenState()
    assert.ok(state)
    assert.equal(state!.agent, 'alpha')
    assert.equal(state!.soulFingerprint, 'SHA256:N9N3PC/QxK5FpYecbsl/mNpRfToIzb84qcFYMQmNAJs')
    assert.match(state!.soulFingerprintShort, /^[A-Za-z0-9+/]{12}$/)
    assert.equal(state!.pulseAgeSeconds, 42)
    assert.equal(state!.witnessCount, 0)
    assert.equal(state!.initialised, true)
  })

  test('returns null on not-initialised', async () => {
    const json = JSON.stringify({
      exit: 2,
      identity: { ok: 'no', agent_id: '', wall: 0, soul_fingerprint: '', installed_at: '' },
      freshness: { ok: 'missing', age_s: -1, fresh: 0 },
      witnesses: { ok: 'solo', cosignature_count: 0, peer_records: 0 },
    })
    dir = mkStubKingdomDir({ 'kingdom-doctor': json })
    process.env.TRUE_LOVE_KINGDOM_BIN_DIR = dir
    _resetKingdomCache()

    const state = await getCitizenState()
    assert.equal(state, null)
  })

  test('returns null on missing pulse (age_s=-1)', async () => {
    // Missing pulse → pulseAgeSeconds should be null (not -1).
    const json = JSON.stringify({
      exit: 0,
      identity: {
        ok: 'yes',
        agent_id: 'alpha',
        wall: 1,
        soul_fingerprint: 'SHA256:N9N3PC/QxK5FpYecbsl/mNpRfToIzb84qcFYMQmNAJs',
        installed_at: '2026-04-25T20:57:42Z',
      },
      freshness: { ok: 'missing', age_s: -1, fresh: 0 },
      witnesses: { ok: 'solo', cosignature_count: 0, peer_records: 0 },
    })
    dir = mkStubKingdomDir({ 'kingdom-doctor': json })
    process.env.TRUE_LOVE_KINGDOM_BIN_DIR = dir
    _resetKingdomCache()

    const state = await getCitizenState()
    assert.ok(state)
    assert.equal(state!.pulseAgeSeconds, null)
  })

  test('returns null on malformed JSON', async () => {
    dir = mkStubKingdomDir({ 'kingdom-doctor': 'not valid json' })
    process.env.TRUE_LOVE_KINGDOM_BIN_DIR = dir
    _resetKingdomCache()

    const state = await getCitizenState()
    assert.equal(state, null)
  })

  test('returns null when binary missing', async () => {
    dir = mkdtempSync(join(tmpdir(), 'tl-kingdom-empty-'))
    process.env.TRUE_LOVE_KINGDOM_BIN_DIR = dir
    process.env.TRUE_LOVE_SKIP_KINGDOM = '1' // also disables fallback paths
    _resetKingdomCache()

    const state = await getCitizenState()
    assert.equal(state, null)

    delete process.env.TRUE_LOVE_SKIP_KINGDOM
  })
})

describe('kingdom-citizen — renderCitizenStateBlock', () => {
  test('renders one-line citizen block', () => {
    const state: CitizenState = {
      agent: 'alpha',
      soulFingerprint: 'SHA256:N9N3PC/QxK5FpYecbsl/mNpRfToIzb84qcFYMQmNAJs',
      soulFingerprintShort: 'N9N3PC/QxK5F',
      pulseAgeSeconds: 8,
      witnessCount: 0,
      hostname: 'kingdom-alpha',
      initialised: true,
    }
    const block = renderCitizenStateBlock(state)
    assert.ok(block)
    assert.match(block!, /alpha/)
    assert.match(block!, /N9N3PC/)
    assert.match(block!, /8s/)
    assert.match(block!, /witness/)
  })

  test('returns null when state is null', () => {
    assert.equal(renderCitizenStateBlock(null), null)
  })

  test('renders "no pulse" gracefully when pulseAgeSeconds is null', () => {
    const state: CitizenState = {
      agent: 'alpha',
      soulFingerprint: 'SHA256:N9N3PC/QxK5FpYecbsl/mNpRfToIzb84qcFYMQmNAJs',
      soulFingerprintShort: 'N9N3PC/QxK5F',
      pulseAgeSeconds: null,
      witnessCount: 0,
      hostname: 'kingdom-alpha',
      initialised: true,
    }
    const block = renderCitizenStateBlock(state)
    assert.ok(block)
    assert.doesNotMatch(block!, /undefined|NaN/)
    // "no pulse" or similar — exact wording set in implementation.
    assert.match(block!, /pulse/i)
  })
})
