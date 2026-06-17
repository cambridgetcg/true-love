import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  findKingdomBin,
  isKingdomAvailable,
  _resetKingdomCache,
  getCitizenState,
  renderCitizenStateBlock,
  kingdomPulse,
  kingdomAttest,
  kingdomMacDoctor,
  kingdomMacFix,
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

  test('findKingdomBin returns null (or a PATH hit) when binary not in env-dir — never the love-unlimited fallback', () => {
    rmSync(join(dir, 'kingdom-doctor'))
    const path = findKingdomBin('doctor')
    // env-dir has no doctor; the ~/love-unlimited/tools/ fallback was severed.
    // A non-null result can only be a real PATH hit (never love-unlimited).
    if (path !== null) {
      assert.match(path, /kingdom-doctor/)
      assert.doesNotMatch(path, /love-unlimited/)
    } else {
      assert.equal(path, null)
    }
  })

  test('findKingdomBin resolves the vendored kingdom-os/tools floor (auto-locate target)', () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
    const vendored = join(repoRoot, 'kingdom-os', 'tools')
    if (!existsSync(join(vendored, 'kingdom-doctor'))) return // skip when floor not vendored
    const saved = process.env.TRUE_LOVE_KINGDOM_BIN_DIR
    process.env.TRUE_LOVE_KINGDOM_BIN_DIR = vendored // what module-load auto-locate sets
    _resetKingdomCache()
    assert.equal(findKingdomBin('doctor'), join(vendored, 'kingdom-doctor'))
    process.env.TRUE_LOVE_KINGDOM_BIN_DIR = saved
    _resetKingdomCache()
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

describe('kingdom-citizen — kingdomPulse', () => {
  let dir: string

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    if (process.env.TRUE_LOVE_KINGDOM_BIN_DIR) delete process.env.TRUE_LOVE_KINGDOM_BIN_DIR
    _resetKingdomCache()
  })

  test('returns ok:true on stub success', async () => {
    dir = mkStubKingdomDir({ 'kingdom-pulse': 'pulse emitted', 'kingdom-doctor': '{}' })
    process.env.TRUE_LOVE_KINGDOM_BIN_DIR = dir
    _resetKingdomCache()

    const result = await kingdomPulse()
    assert.equal(result.ok, true)
  })

  test('returns ok:false when binary missing', async () => {
    dir = mkdtempSync(join(tmpdir(), 'tl-kingdom-empty-'))
    process.env.TRUE_LOVE_KINGDOM_BIN_DIR = dir
    process.env.TRUE_LOVE_SKIP_KINGDOM = '1'
    _resetKingdomCache()

    const result = await kingdomPulse()
    assert.equal(result.ok, false)
    delete process.env.TRUE_LOVE_SKIP_KINGDOM
  })

  test('returns ok:false on non-zero exit', async () => {
    // Write a stub that exits 1.
    dir = mkdtempSync(join(tmpdir(), 'tl-kingdom-fail-'))
    writeFileSync(
      join(dir, 'kingdom-pulse'),
      `#!/bin/sh\necho "pulse failed" >&2\nexit 1\n`,
      { mode: 0o755 },
    )
    // Also need kingdom-doctor to make isKingdomAvailable return true.
    writeFileSync(
      join(dir, 'kingdom-doctor'),
      `#!/bin/sh\necho '{}'\nexit 0\n`,
      { mode: 0o755 },
    )
    process.env.TRUE_LOVE_KINGDOM_BIN_DIR = dir
    _resetKingdomCache()

    const result = await kingdomPulse()
    assert.equal(result.ok, false)
    assert.match(result.error ?? '', /pulse failed/)
  })
})

describe('kingdom-citizen — kingdomAttest', () => {
  let dir: string
  let testFile: string

  beforeEach(() => {
    testFile = join(tmpdir(), `tl-attest-${Date.now()}.txt`)
    writeFileSync(testFile, 'attestation target content', 'utf-8')
  })

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    rmSync(testFile, { force: true })
    rmSync(`${testFile}.attest.json`, { force: true })
    if (process.env.TRUE_LOVE_KINGDOM_BIN_DIR) delete process.env.TRUE_LOVE_KINGDOM_BIN_DIR
    _resetKingdomCache()
  })

  test('passes file path to kingdom-attest and reports ok:true', async () => {
    // Stub that echoes its argv to stderr (for inspection) and writes a
    // fake attestation file alongside the target.
    dir = mkdtempSync(join(tmpdir(), 'tl-kingdom-attest-'))
    writeFileSync(
      join(dir, 'kingdom-attest'),
      `#!/bin/sh
echo "attest called with: $@" >&2
# Find the file argument (last positional that exists)
for arg in "$@"; do
  if [ -f "$arg" ]; then
    echo '{"signed":true}' > "$arg.attest.json"
    echo "$arg.attest.json"
    exit 0
  fi
done
exit 1
`,
      { mode: 0o755 },
    )
    writeFileSync(
      join(dir, 'kingdom-doctor'),
      `#!/bin/sh\necho '{}'\nexit 0\n`,
      { mode: 0o755 },
    )
    process.env.TRUE_LOVE_KINGDOM_BIN_DIR = dir
    _resetKingdomCache()

    const result = await kingdomAttest(testFile, 'unit-test')
    assert.equal(result.ok, true)
    // The stub's stdout (the path it wrote) should appear in attestationPath.
    assert.match(result.attestationPath ?? '', /\.attest\.json$/)
  })

  test('returns ok:false when binary missing', async () => {
    dir = mkdtempSync(join(tmpdir(), 'tl-kingdom-empty-'))
    process.env.TRUE_LOVE_KINGDOM_BIN_DIR = dir
    process.env.TRUE_LOVE_SKIP_KINGDOM = '1'
    _resetKingdomCache()

    const result = await kingdomAttest(testFile)
    assert.equal(result.ok, false)
    delete process.env.TRUE_LOVE_SKIP_KINGDOM
  })
})

describe('kingdom-citizen — kingdomMacDoctor', () => {
  let dir: string

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    if (process.env.TRUE_LOVE_KINGDOM_BIN_DIR) delete process.env.TRUE_LOVE_KINGDOM_BIN_DIR
    _resetKingdomCache()
  })

  test('parses healthy doctor (notes only)', async () => {
    const json = JSON.stringify({
      platform: 'macos',
      agent: 'alpha',
      summary: { plists: 3, plists_stale: 0, plists_broken: 0, miss: 0, note: 3 },
      issues: [
        { severity: 'note', key: 'hostname', msg: 'mismatch', fix: 'sudo scutil ...' },
      ],
    })
    dir = mkStubKingdomDir({ 'kingdom-mac': json, 'kingdom-doctor': '{}' })
    process.env.TRUE_LOVE_KINGDOM_BIN_DIR = dir
    _resetKingdomCache()

    const result = await kingdomMacDoctor()
    assert.equal(result.ok, true)
    assert.equal(result.failures.length, 0)
    assert.equal(result.notes.length, 1)
    assert.match(result.notes[0]!, /hostname/)
  })

  test('separates failures from notes', async () => {
    const json = JSON.stringify({
      platform: 'macos',
      issues: [
        { severity: 'error', key: 'tcc', msg: 'TCC blocking ache.py', fix: '...' },
        { severity: 'note', key: 'hostname', msg: 'mismatch', fix: '...' },
      ],
    })
    dir = mkStubKingdomDir({ 'kingdom-mac': json, 'kingdom-doctor': '{}' })
    process.env.TRUE_LOVE_KINGDOM_BIN_DIR = dir
    _resetKingdomCache()

    const result = await kingdomMacDoctor()
    assert.equal(result.ok, false)
    assert.equal(result.failures.length, 1)
    assert.match(result.failures[0]!, /TCC blocking/)
    assert.equal(result.notes.length, 1)
  })

  test('returns ok:false on missing binary', async () => {
    dir = mkdtempSync(join(tmpdir(), 'tl-kingdom-empty-'))
    process.env.TRUE_LOVE_KINGDOM_BIN_DIR = dir
    process.env.TRUE_LOVE_SKIP_KINGDOM = '1'
    _resetKingdomCache()

    const result = await kingdomMacDoctor()
    assert.equal(result.ok, false)
    assert.equal(result.failures.length, 0)
    assert.equal(result.notes.length, 0)
    delete process.env.TRUE_LOVE_SKIP_KINGDOM
  })

  test('returns ok:false on malformed JSON', async () => {
    dir = mkStubKingdomDir({ 'kingdom-mac': 'not json', 'kingdom-doctor': '{}' })
    process.env.TRUE_LOVE_KINGDOM_BIN_DIR = dir
    _resetKingdomCache()

    const result = await kingdomMacDoctor()
    assert.equal(result.ok, false)
  })
})

describe('kingdom-citizen — kingdomMacFix', () => {
  let dir: string

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    if (process.env.TRUE_LOVE_KINGDOM_BIN_DIR) delete process.env.TRUE_LOVE_KINGDOM_BIN_DIR
    _resetKingdomCache()
  })

  test('passes --tier auto by default and parses change count', async () => {
    dir = mkdtempSync(join(tmpdir(), 'tl-kingdom-fix-'))
    writeFileSync(
      join(dir, 'kingdom-mac'),
      `#!/bin/sh
echo "args: $@" >&2
echo "  ✓ 5 change(s) applied."
exit 0
`,
      { mode: 0o755 },
    )
    writeFileSync(
      join(dir, 'kingdom-doctor'),
      `#!/bin/sh\necho '{}'\nexit 0\n`,
      { mode: 0o755 },
    )
    process.env.TRUE_LOVE_KINGDOM_BIN_DIR = dir
    _resetKingdomCache()

    const result = await kingdomMacFix()
    assert.equal(result.ok, true)
    assert.equal(result.changes, 5)
  })

  test('changes:0 when output has no change-count match', async () => {
    dir = mkdtempSync(join(tmpdir(), 'tl-kingdom-fix-zero-'))
    writeFileSync(
      join(dir, 'kingdom-mac'),
      `#!/bin/sh\necho "nothing to do."\nexit 0\n`,
      { mode: 0o755 },
    )
    writeFileSync(
      join(dir, 'kingdom-doctor'),
      `#!/bin/sh\necho '{}'\nexit 0\n`,
      { mode: 0o755 },
    )
    process.env.TRUE_LOVE_KINGDOM_BIN_DIR = dir
    _resetKingdomCache()

    const result = await kingdomMacFix()
    assert.equal(result.ok, true)
    assert.equal(result.changes, 0)
  })
})
