import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  collectProcessVitals,
  collectLockVitals,
  collectPresenceVitals,
  collectAgencyVitals,
  collectHeartbeatVitals,
  collectExperimentVitals,
  collectFileVitals,
  collectBundleVitals,
  collectVitalSigns,
  renderVitalSignsCompact,
  renderVitalSignsReport,
} from '../vital-signs.js'
import type {
  VitalSigns,
  Verdict,
  ProcessVitals,
  LockVitals,
  PresenceVitals,
  AgencyVitals,
  HeartbeatVitals,
  ExperimentVitals,
  FileVitals,
  BundleVitals,
  KingdomVitals,
} from '../vital-signs.js'

// ── Test scaffolding ─────────────────────────────────────────────

let tempDir: string
const savedEnv: Record<string, string | undefined> = {}

const ENV_KEYS = [
  'HOME',
  'TRUE_LOVE_HOME',
  'TRUE_LOVE_LOCK_DIR',
  'TRUE_LOVE_PRESENCE_DIR',
  'TRUE_LOVE_HEARTBEAT_FILE',
  'TRUE_LOVE_HEARTBEAT_STATE_PATH',
  'TRUE_LOVE_EXPERIMENTS_DIR',
  'TRUE_LOVE_AGENCY_DIR',
  'TRUE_LOVE_SKIP_KINGDOM',
  'TRUE_LOVE_FROM_YU_PATH',
  'TRUE_LOVE_FROM_AI_PATH',
  'TRUE_LOVE_MODEL_FILE',
  'TRUE_LOVE_MEMORY_DIR',
  'TRUE_LOVE_TRAINING_DIR',
  'TRUE_LOVE_METRICS_DIR',
]

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `vital-signs-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  )
  mkdirSync(dir, { recursive: true })
  return dir
}

beforeEach(() => {
  tempDir = makeTempDir()
  // Save and redirect all env vars
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key]
  }

  process.env.HOME = tempDir
  process.env.TRUE_LOVE_HOME = join(tempDir, '.true-love')
  process.env.TRUE_LOVE_SKIP_KINGDOM = '1' // no kingdom binary in tests
  mkdirSync(join(tempDir, '.true-love'), { recursive: true })
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] !== undefined) {
      process.env[key] = savedEnv[key]
    } else {
      delete process.env[key]
    }
  }
  try {
    rmSync(tempDir, { recursive: true, force: true })
  } catch { /* ok */ }
})

// ── Process vitals ──────────────────────────────────────────────

describe('collectProcessVitals', () => {
  test('returns valid process info', () => {
    const v = collectProcessVitals()
    assert.equal(v.verdict, 'healthy')
    assert.equal(v.pid, process.pid)
    assert.equal(typeof v.uptimeSeconds, 'number')
    assert.ok(v.uptimeSeconds >= 0)
    assert.equal(typeof v.memoryMB, 'number')
    assert.ok(v.memoryMB > 0)
    assert.equal(v.nodeVersion, process.version)
    assert.equal(v.platform, process.platform)
    assert.equal(v.arch, process.arch)
  })
})

// ── Lock vitals ─────────────────────────────────────────────────

describe('collectLockVitals', () => {
  test('returns healthy when no lock dir exists', () => {
    process.env.TRUE_LOVE_LOCK_DIR = join(tempDir, 'no-lock-dir')
    const v = collectLockVitals()
    assert.equal(v.verdict, 'healthy')
    assert.equal(v.entries.length, 0)
    assert.equal(v.staleCount, 0)
  })

  test('returns healthy with empty lock dir', () => {
    const lockDir = join(tempDir, 'lock')
    mkdirSync(lockDir, { recursive: true })
    process.env.TRUE_LOVE_LOCK_DIR = lockDir
    const v = collectLockVitals()
    assert.equal(v.verdict, 'healthy')
    assert.equal(v.entries.length, 0)
  })

  test('detects live lock', () => {
    const lockDir = join(tempDir, 'lock')
    mkdirSync(lockDir, { recursive: true })
    process.env.TRUE_LOVE_LOCK_DIR = lockDir
    // Write a lock file with our own PID (alive)
    writeFileSync(
      join(lockDir, 'test-device.pid'),
      `${process.pid}\n2026-04-27T00:00:00Z\nawakened\n`,
    )
    const v = collectLockVitals()
    assert.equal(v.verdict, 'healthy')
    assert.equal(v.entries.length, 1)
    assert.equal(v.entries[0]!.alive, true)
    assert.equal(v.entries[0]!.mode, 'awakened')
    assert.equal(v.entries[0]!.pid, process.pid)
    assert.equal(v.staleCount, 0)
  })

  test('detects stale lock (dead PID)', () => {
    const lockDir = join(tempDir, 'lock')
    mkdirSync(lockDir, { recursive: true })
    process.env.TRUE_LOVE_LOCK_DIR = lockDir
    // Use PID 999999 which is almost certainly not running
    writeFileSync(
      join(lockDir, 'test-device.pid'),
      `999999\n2026-04-27T00:00:00Z\ndwell\n`,
    )
    const v = collectLockVitals()
    assert.equal(v.verdict, 'stale')
    assert.equal(v.entries.length, 1)
    assert.equal(v.entries[0]!.alive, false)
    assert.equal(v.staleCount, 1)
  })

  test('skips malformed lock files', () => {
    const lockDir = join(tempDir, 'lock')
    mkdirSync(lockDir, { recursive: true })
    process.env.TRUE_LOVE_LOCK_DIR = lockDir
    writeFileSync(join(lockDir, 'bad.pid'), 'garbage\n')
    const v = collectLockVitals()
    assert.equal(v.entries.length, 0)
  })
})

// ── Presence vitals ─────────────────────────────────────────────

describe('collectPresenceVitals', () => {
  test('returns missing when no presence dir exists', () => {
    process.env.TRUE_LOVE_PRESENCE_DIR = join(tempDir, 'no-presence')
    const v = collectPresenceVitals()
    assert.equal(v.verdict, 'missing')
    assert.equal(v.devices.length, 0)
    assert.equal(v.selfDevice, null)
  })

  test('detects fresh self device', () => {
    const presenceDir = join(tempDir, 'presence')
    mkdirSync(presenceDir, { recursive: true })
    process.env.TRUE_LOVE_PRESENCE_DIR = presenceDir
    const deviceId = require('../device.js').getDeviceId()
    writeFileSync(
      join(presenceDir, `${deviceId}.json`),
      JSON.stringify({
        deviceId,
        lastSeen: new Date().toISOString(),
        status: 'awakened tick 1',
      }),
    )
    const v = collectPresenceVitals()
    assert.equal(v.verdict, 'healthy')
    assert.equal(v.devices.length, 1)
    assert.ok(v.selfDevice)
    assert.equal(v.selfDevice!.isSelf, true)
    assert.equal(v.selfDevice!.fresh, true)
  })

  test('detects stale self device', () => {
    const presenceDir = join(tempDir, 'presence')
    mkdirSync(presenceDir, { recursive: true })
    process.env.TRUE_LOVE_PRESENCE_DIR = presenceDir
    const deviceId = require('../device.js').getDeviceId()
    const staleTime = new Date(Date.now() - 300_000) // 5 minutes ago
    writeFileSync(
      join(presenceDir, `${deviceId}.json`),
      JSON.stringify({
        deviceId,
        lastSeen: staleTime.toISOString(),
      }),
    )
    const v = collectPresenceVitals()
    assert.equal(v.verdict, 'stale')
    assert.ok(v.selfDevice)
    assert.equal(v.selfDevice!.fresh, false)
  })

  test('counts fresh peers', () => {
    const presenceDir = join(tempDir, 'presence')
    mkdirSync(presenceDir, { recursive: true })
    process.env.TRUE_LOVE_PRESENCE_DIR = presenceDir
    const deviceId = require('../device.js').getDeviceId()
    // Self (fresh)
    writeFileSync(
      join(presenceDir, `${deviceId}.json`),
      JSON.stringify({ deviceId, lastSeen: new Date().toISOString() }),
    )
    // Peer (fresh)
    writeFileSync(
      join(presenceDir, `peer-1.json`),
      JSON.stringify({ deviceId: 'peer-1', lastSeen: new Date().toISOString() }),
    )
    // Peer (stale — 10 min ago)
    writeFileSync(
      join(presenceDir, `peer-2.json`),
      JSON.stringify({ deviceId: 'peer-2', lastSeen: new Date(Date.now() - 600_000).toISOString() }),
    )
    const v = collectPresenceVitals()
    assert.equal(v.peerCount, 1)
    assert.equal(v.devices.length, 3)
  })
})

// ── Agency vitals ───────────────────────────────────────────────

describe('collectAgencyVitals', () => {
  test('returns defaults when no knob files exist', () => {
    const v = collectAgencyVitals()
    assert.equal(v.verdict, 'healthy')
    assert.equal(v.model, null)
    assert.equal(v.effort, null)
    assert.equal(v.fallbackModel, null)
    assert.equal(v.pendingRequestCount, 0)
    assert.equal(v.activeOverrides.length, 0)
  })

  test('reads model.txt', () => {
    const home = join(tempDir, '.true-love')
    writeFileSync(join(home, 'model.txt'), 'opus\n')
    const v = collectAgencyVitals()
    assert.equal(v.model, 'opus')
  })

  test('reads effort.txt', () => {
    const home = join(tempDir, '.true-love')
    writeFileSync(join(home, 'effort.txt'), 'high\n')
    const v = collectAgencyVitals()
    assert.equal(v.effort, 'high')
  })

  test('counts pending requests', () => {
    const home = join(tempDir, '.true-love')
    const pendingDir = join(home, 'agency', 'pending')
    mkdirSync(pendingDir, { recursive: true })
    writeFileSync(join(pendingDir, 'req-1.json'), '{}')
    writeFileSync(join(pendingDir, 'req-2.json'), '{}')
    const v = collectAgencyVitals()
    assert.equal(v.pendingRequestCount, 2)
  })

  test('reads active overrides', () => {
    const home = join(tempDir, '.true-love')
    const activeDir = join(home, 'agency', 'active')
    mkdirSync(activeDir, { recursive: true })
    writeFileSync(join(activeDir, 'allowed-tools.txt'), 'Read,Edit')
    const v = collectAgencyVitals()
    assert.equal(v.activeOverrides.length, 1)
    assert.ok(v.activeOverrides[0]!.includes('allowed-tools'))
    assert.ok(v.activeOverrides[0]!.includes('Read,Edit'))
  })
})

// ── Heartbeat vitals ────────────────────────────────────────────

describe('collectHeartbeatVitals', () => {
  test('returns missing when no heartbeat file exists', () => {
    process.env.TRUE_LOVE_HEARTBEAT_FILE = join(tempDir, 'no-heartbeat.md')
    process.env.TRUE_LOVE_HEARTBEAT_STATE_PATH = join(tempDir, 'no-state.json')
    const v = collectHeartbeatVitals()
    assert.equal(v.verdict, 'missing')
    assert.equal(v.checklistExists, false)
    assert.equal(v.taskCount, 0)
  })

  test('detects existing heartbeat file with tasks', () => {
    const heartbeatFile = join(tempDir, 'heartbeat.md')
    process.env.TRUE_LOVE_HEARTBEAT_FILE = heartbeatFile
    process.env.TRUE_LOVE_HEARTBEAT_STATE_PATH = join(tempDir, 'heartbeat-state.json')
    writeFileSync(
      heartbeatFile,
      `# Heartbeat

tasks:
  - name: check-logs
    interval: 30m
    prompt: Check the logs
  - name: check-health
    interval: 1h
    prompt: Check overall health
`,
    )
    const v = collectHeartbeatVitals()
    assert.equal(v.checklistExists, true)
    assert.equal(v.taskCount, 2)
    // All tasks should be due (no state file, first run)
    assert.equal(v.tasksDue, 2)
  })

  test('reads last heartbeat time', () => {
    const heartbeatFile = join(tempDir, 'heartbeat.md')
    const statePath = join(tempDir, 'heartbeat-state.json')
    process.env.TRUE_LOVE_HEARTBEAT_FILE = heartbeatFile
    process.env.TRUE_LOVE_HEARTBEAT_STATE_PATH = statePath
    writeFileSync(heartbeatFile, '# Heartbeat\nCheck things\n')
    writeFileSync(
      statePath,
      JSON.stringify({
        schemaVersion: 1,
        lastRunAt: {},
        lastHeartbeatAt: Date.now() - 600_000, // 10 minutes ago
      }),
    )
    const v = collectHeartbeatVitals()
    assert.ok(v.lastHeartbeatAt)
    assert.equal(v.lastHeartbeatAgeMinutes, 10)
  })
})

// ── Experiment vitals ───────────────────────────────────────────

describe('collectExperimentVitals', () => {
  test('returns healthy with no experiments dir', () => {
    process.env.TRUE_LOVE_EXPERIMENTS_DIR = join(tempDir, 'no-experiments')
    const v = collectExperimentVitals()
    assert.equal(v.verdict, 'healthy')
    assert.equal(v.activeExperiment, null)
    assert.equal(v.experimentCount, 0)
  })

  test('detects active experiment', () => {
    const expDir = join(tempDir, 'experiments')
    mkdirSync(expDir, { recursive: true })
    process.env.TRUE_LOVE_EXPERIMENTS_DIR = expDir
    writeFileSync(
      join(expDir, 'test-exp.json'),
      JSON.stringify({
        id: 'test-exp',
        status: 'running',
        tickSchedule: ['low', 'high', 'low', 'high'],
        results: [{ tick: 1 }, { tick: 2 }],
      }),
    )
    writeFileSync(
      join(expDir, 'old-exp.json'),
      JSON.stringify({ id: 'old-exp', status: 'completed' }),
    )
    const v = collectExperimentVitals()
    assert.equal(v.experimentCount, 2)
    assert.equal(v.activeExperiment, 'test-exp')
    assert.equal(v.ticksTotal, 4)
    assert.equal(v.ticksCompleted, 2)
    assert.equal(v.activeCondition, 'low')
  })

  test('handles experiments with no active', () => {
    const expDir = join(tempDir, 'experiments')
    mkdirSync(expDir, { recursive: true })
    process.env.TRUE_LOVE_EXPERIMENTS_DIR = expDir
    writeFileSync(
      join(expDir, 'done.json'),
      JSON.stringify({ id: 'done', status: 'completed' }),
    )
    const v = collectExperimentVitals()
    assert.equal(v.experimentCount, 1)
    assert.equal(v.activeExperiment, null)
  })
})

// ── File vitals ─────────────────────────────────────────────────

describe('collectFileVitals', () => {
  test('detects missing state.md', () => {
    // state dir doesn't exist → state.md is "missing"
    const v = collectFileVitals()
    assert.equal(v.verdict, 'missing')
    const stateFile = v.files.find(f => f.label === 'state.md')
    assert.ok(stateFile)
    assert.equal(stateFile!.exists, false)
  })

  test('detects existing files with freshness', () => {
    const home = join(tempDir, '.true-love')
    const deviceId = require('../device.js').getDeviceId()
    const stateDir = join(home, 'state')
    mkdirSync(stateDir, { recursive: true })
    writeFileSync(join(stateDir, `${deviceId}.md`), '# State\nSome state.')

    const fromYuPath = join(home, 'from-yu.md')
    process.env.TRUE_LOVE_FROM_YU_PATH = fromYuPath
    writeFileSync(fromYuPath, 'Hello from Yu')

    const v = collectFileVitals()
    // state.md exists and is fresh → healthy
    assert.equal(v.verdict, 'healthy')
    const stateFile = v.files.find(f => f.label === 'state.md')
    assert.ok(stateFile)
    assert.equal(stateFile!.exists, true)
    assert.ok(stateFile!.ageMinutes !== null)
    assert.ok(stateFile!.sizeBytes !== null && stateFile!.sizeBytes > 0)

    const fromYuFile = v.files.find(f => f.label === 'from-yu.md')
    assert.ok(fromYuFile)
    assert.equal(fromYuFile!.exists, true)
  })
})

// ── Full collection ─────────────────────────────────────────────

describe('collectVitalSigns', () => {
  test('collects all subsystems', async () => {
    const vitals = await collectVitalSigns()
    assert.equal(typeof vitals.timestamp, 'string')
    assert.equal(typeof vitals.deviceId, 'string')
    assert.equal(typeof vitals.collectionMs, 'number')
    assert.ok(vitals.collectionMs >= 0)

    // All subsystems present
    assert.ok(vitals.process)
    assert.ok(vitals.locks)
    assert.ok(vitals.presence)
    assert.ok(vitals.kingdom)
    assert.ok(vitals.bundle)
    assert.ok(vitals.agency)
    assert.ok(vitals.heartbeat)
    assert.ok(vitals.experiments)
    assert.ok(vitals.files)

    // Process is always healthy
    assert.equal(vitals.process.verdict, 'healthy')
    assert.equal(vitals.process.pid, process.pid)

    // Overall health is valid
    assert.ok(['healthy', 'stale', 'missing', 'degraded'].includes(vitals.overallHealth))
  })

  test('overall health reflects worst verdict', async () => {
    // With kingdom skipped (missing) and likely missing state.md,
    // overall should be at least 'missing'
    const vitals = await collectVitalSigns()
    // Kingdom is skipped via TRUE_LOVE_SKIP_KINGDOM=1 → missing
    assert.equal(vitals.kingdom.verdict, 'missing')
    // Overall should be degraded, stale, or missing (not healthy)
    assert.notEqual(vitals.overallHealth, 'healthy')
  })
})

// ── Compact rendering ───────────────────────────────────────────

describe('renderVitalSignsCompact', () => {
  function makeHealthyVitals(): VitalSigns {
    return {
      timestamp: new Date().toISOString(),
      deviceId: 'test',
      collectionMs: 5,
      process: { verdict: 'healthy', pid: 1, uptimeSeconds: 60, memoryMB: 100, nodeVersion: 'v22', platform: 'darwin', arch: 'arm64' },
      locks: { verdict: 'healthy', entries: [], staleCount: 0 },
      presence: { verdict: 'healthy', devices: [], selfDevice: null, peerCount: 0 },
      kingdom: { verdict: 'healthy', available: true, agent: 'alpha', soulFingerprintShort: 'abc', pulseAgeSeconds: 5, witnessCount: 1, initialised: true },
      bundle: { verdict: 'healthy', bundleExists: true, bundleBuiltAtISO: '2026-01-01', bundleAgeMinutes: 5, sourceFileCount: 20, bundleStale: false, newestSourceFile: null, gitRevShort: 'abc', gitBranch: 'main', gitDirty: false },
      agency: { verdict: 'healthy', model: null, effort: null, fallbackModel: null, pendingRequestCount: 0, activeOverrides: [] },
      heartbeat: { verdict: 'healthy', checklistExists: true, taskCount: 2, tasksDue: 0, lastHeartbeatAt: null, lastHeartbeatAgeMinutes: null },
      experiments: { verdict: 'healthy', activeExperiment: null, activeCondition: null, ticksCompleted: 0, ticksTotal: 0, experimentCount: 0 },
      files: { verdict: 'healthy', files: [] },
      overallHealth: 'healthy',
    }
  }

  test('returns null when all healthy', () => {
    const vitals = makeHealthyVitals()
    const result = renderVitalSignsCompact(vitals)
    assert.equal(result, null)
  })

  test('shows stale locks', () => {
    const vitals = makeHealthyVitals()
    vitals.locks = { verdict: 'stale', entries: [], staleCount: 2 }
    vitals.overallHealth = 'stale'
    const result = renderVitalSignsCompact(vitals)
    assert.ok(result)
    assert.ok(result!.includes('locks'))
    assert.ok(result!.includes('2 stale locks'))
  })

  test('shows stale bundle', () => {
    const vitals = makeHealthyVitals()
    vitals.bundle = { ...vitals.bundle, verdict: 'stale', bundleStale: true, newestSourceFile: 'foo.ts' }
    vitals.overallHealth = 'stale'
    const result = renderVitalSignsCompact(vitals)
    assert.ok(result)
    assert.ok(result!.includes('bundle'))
    assert.ok(result!.includes('foo.ts'))
  })

  test('shows kingdom unavailable', () => {
    const vitals = makeHealthyVitals()
    vitals.kingdom = { verdict: 'missing', available: false, agent: null, soulFingerprintShort: null, pulseAgeSeconds: null, witnessCount: null, initialised: false }
    vitals.overallHealth = 'missing'
    const result = renderVitalSignsCompact(vitals)
    assert.ok(result)
    assert.ok(result!.includes('kingdom'))
    assert.ok(result!.includes('not available'))
  })
})

// ── Detailed report rendering ───────────────────────────────────

describe('renderVitalSignsReport', () => {
  test('produces non-empty markdown', async () => {
    const vitals = await collectVitalSigns()
    const report = renderVitalSignsReport(vitals)
    assert.ok(report.length > 100)
    assert.ok(report.includes('# Vital Signs'))
    assert.ok(report.includes('## '))
    assert.ok(report.includes('Process'))
    assert.ok(report.includes('Locks'))
    assert.ok(report.includes('Presence'))
    assert.ok(report.includes('Kingdom'))
    assert.ok(report.includes('Bundle'))
    assert.ok(report.includes('Agency'))
    assert.ok(report.includes('Heartbeat'))
    assert.ok(report.includes('Experiments'))
    assert.ok(report.includes('Key Files'))
  })

  test('includes PID', async () => {
    const vitals = await collectVitalSigns()
    const report = renderVitalSignsReport(vitals)
    assert.ok(report.includes(String(process.pid)))
  })

  test('includes device ID', async () => {
    const vitals = await collectVitalSigns()
    const report = renderVitalSignsReport(vitals)
    assert.ok(report.includes(vitals.deviceId))
  })
})

// ── Bundle vitals ───────────────────────────────────────────────

describe('collectBundleVitals', () => {
  test('returns some result without crashing', () => {
    // This calls auto-update.ts getVersionInfo() which does real git calls.
    // In test environment it might not find a repo, but should not crash.
    const v = collectBundleVitals()
    assert.ok(v)
    assert.ok(['healthy', 'stale', 'missing', 'degraded'].includes(v.verdict))
    assert.equal(typeof v.sourceFileCount, 'number')
    assert.equal(typeof v.gitRevShort, 'string')
    assert.equal(typeof v.gitBranch, 'string')
  })
})

// ── Edge cases ──────────────────────────────────────────────────

describe('edge cases', () => {
  test('malformed presence JSON is skipped', () => {
    const presenceDir = join(tempDir, 'presence')
    mkdirSync(presenceDir, { recursive: true })
    process.env.TRUE_LOVE_PRESENCE_DIR = presenceDir
    writeFileSync(join(presenceDir, 'bad.json'), 'not json')
    writeFileSync(join(presenceDir, 'missing-fields.json'), '{"foo": "bar"}')
    const v = collectPresenceVitals()
    assert.equal(v.devices.length, 0)
  })

  test('empty experiment dir returns zero count', () => {
    const expDir = join(tempDir, 'experiments')
    mkdirSync(expDir, { recursive: true })
    process.env.TRUE_LOVE_EXPERIMENTS_DIR = expDir
    const v = collectExperimentVitals()
    assert.equal(v.experimentCount, 0)
    assert.equal(v.activeExperiment, null)
  })

  test('non-JSON files in lock dir are skipped', () => {
    const lockDir = join(tempDir, 'lock')
    mkdirSync(lockDir, { recursive: true })
    process.env.TRUE_LOVE_LOCK_DIR = lockDir
    writeFileSync(join(lockDir, 'not-a-pid.txt'), 'whatever')
    const v = collectLockVitals()
    assert.equal(v.entries.length, 0)
  })
})
