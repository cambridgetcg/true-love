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
  collectMissionVelocityVitals,
  collectVitalSigns,
  renderVitalSignsCompact,
  renderVitalSignsReport,
  quickBodyCheck,
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
  MissionVelocityVitals,
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
  'TRUE_LOVE_PROJECT',
  'TRUE_LOVE_STATE_PATH',
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

  test('TRUE_LOVE_STATE_PATH override — named scope flat state.md is found', () => {
    // Named scopes store state as a flat <scope-home>/state.md (not state/<deviceId>.md).
    // The env var TRUE_LOVE_STATE_PATH lets vital-signs find it regardless of layout.
    const scopeHome = join(tempDir, '.true-love', 'scopes', 'rewardspro')
    mkdirSync(scopeHome, { recursive: true })
    const flatStatePath = join(scopeHome, 'state.md')
    writeFileSync(flatStatePath, '# RewardsPro State\nSession continuity content.')

    process.env.TRUE_LOVE_STATE_PATH = flatStatePath

    const v = collectFileVitals()
    assert.equal(v.verdict, 'healthy')
    const stateFile = v.files.find(f => f.label === 'state.md')
    assert.ok(stateFile, 'state.md entry must be present')
    assert.equal(stateFile!.exists, true)
    assert.ok(stateFile!.sizeBytes !== null && stateFile!.sizeBytes > 0)
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
      missionVelocity: { verdict: 'healthy', activeCount: 0, quietestMinutes: 0, worstStaleVerdict: 'healthy', awakenedRunning: false, snapshotAt: new Date().toISOString(), watcherStale: false },
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

// ── Mission velocity vitals ────────────────────────────────────

describe('collectMissionVelocityVitals', () => {
  test('returns missing when staleness.json does not exist', () => {
    process.env.TRUE_LOVE_PROJECT = 'test-project'
    const v = collectMissionVelocityVitals()
    assert.equal(v.verdict, 'missing')
    assert.equal(v.activeCount, 0)
    assert.equal(v.snapshotAt, null)
    assert.equal(v.watcherStale, true)
  })

  test('reads valid snapshot', () => {
    process.env.TRUE_LOVE_PROJECT = 'test-project'
    const projectDir = join(tempDir, '.true-love', 'projects', 'test-project')
    mkdirSync(projectDir, { recursive: true })
    const now = new Date().toISOString()
    writeFileSync(join(projectDir, 'staleness.json'), JSON.stringify({
      snapshotAt: now,
      activeCount: 2,
      quietestMinutes: 45,
      worstVerdict: 'nudging',
      awakenedRunning: true,
    }))
    const v = collectMissionVelocityVitals()
    assert.equal(v.verdict, 'healthy') // nudging → healthy from collector's POV
    assert.equal(v.activeCount, 2)
    assert.equal(v.quietestMinutes, 45)
    assert.equal(v.worstStaleVerdict, 'nudging')
    assert.equal(v.awakenedRunning, true)
    assert.equal(v.watcherStale, false)
  })

  test('detects stale watcher (>15m old snapshot)', () => {
    process.env.TRUE_LOVE_PROJECT = 'test-project'
    const projectDir = join(tempDir, '.true-love', 'projects', 'test-project')
    mkdirSync(projectDir, { recursive: true })
    const staleTime = new Date(Date.now() - 20 * 60 * 1000).toISOString() // 20 min ago
    writeFileSync(join(projectDir, 'staleness.json'), JSON.stringify({
      snapshotAt: staleTime,
      activeCount: 1,
      quietestMinutes: 120,
      worstVerdict: 'healthy',
    }))
    const v = collectMissionVelocityVitals()
    assert.equal(v.verdict, 'stale') // watcher itself is stale
    assert.equal(v.watcherStale, true)
  })

  test('reports degraded for critical missions', () => {
    process.env.TRUE_LOVE_PROJECT = 'test-project'
    const projectDir = join(tempDir, '.true-love', 'projects', 'test-project')
    mkdirSync(projectDir, { recursive: true })
    writeFileSync(join(projectDir, 'staleness.json'), JSON.stringify({
      snapshotAt: new Date().toISOString(),
      activeCount: 1,
      quietestMinutes: 999,
      worstVerdict: 'critical',
    }))
    const v = collectMissionVelocityVitals()
    assert.equal(v.verdict, 'degraded')
    assert.equal(v.worstStaleVerdict, 'critical')
  })

  test('reports stale for stale missions (non-critical)', () => {
    process.env.TRUE_LOVE_PROJECT = 'test-project'
    const projectDir = join(tempDir, '.true-love', 'projects', 'test-project')
    mkdirSync(projectDir, { recursive: true })
    writeFileSync(join(projectDir, 'staleness.json'), JSON.stringify({
      snapshotAt: new Date().toISOString(),
      activeCount: 3,
      quietestMinutes: 200,
      worstVerdict: 'stale',
    }))
    const v = collectMissionVelocityVitals()
    assert.equal(v.verdict, 'stale')
  })

  test('handles malformed JSON gracefully', () => {
    process.env.TRUE_LOVE_PROJECT = 'test-project'
    const projectDir = join(tempDir, '.true-love', 'projects', 'test-project')
    mkdirSync(projectDir, { recursive: true })
    writeFileSync(join(projectDir, 'staleness.json'), 'not json at all')
    const v = collectMissionVelocityVitals()
    assert.equal(v.verdict, 'missing')
    assert.equal(v.activeCount, 0)
  })
})

// ── Heartbeat verdict with age ─────────────────────────────────

describe('collectHeartbeatVitals — age-based verdict', () => {
  test('reports stale when last heartbeat >30 minutes ago', () => {
    const heartbeatFile = join(tempDir, 'heartbeat.md')
    const statePath = join(tempDir, 'heartbeat-state.json')
    process.env.TRUE_LOVE_HEARTBEAT_FILE = heartbeatFile
    process.env.TRUE_LOVE_HEARTBEAT_STATE_PATH = statePath
    writeFileSync(heartbeatFile, '# Heartbeat\nStub\n')
    writeFileSync(statePath, JSON.stringify({
      schemaVersion: 1,
      lastRunAt: {},
      lastHeartbeatAt: Date.now() - 45 * 60_000, // 45 minutes ago
    }))
    const v = collectHeartbeatVitals()
    assert.equal(v.verdict, 'stale')
    assert.equal(v.lastHeartbeatAgeMinutes, 45)
  })

  test('reports healthy when last heartbeat <30 minutes ago', () => {
    const heartbeatFile = join(tempDir, 'heartbeat.md')
    const statePath = join(tempDir, 'heartbeat-state.json')
    process.env.TRUE_LOVE_HEARTBEAT_FILE = heartbeatFile
    process.env.TRUE_LOVE_HEARTBEAT_STATE_PATH = statePath
    writeFileSync(heartbeatFile, '# Heartbeat\nStub\n')
    writeFileSync(statePath, JSON.stringify({
      schemaVersion: 1,
      lastRunAt: {},
      lastHeartbeatAt: Date.now() - 5 * 60_000, // 5 minutes ago
    }))
    const v = collectHeartbeatVitals()
    assert.equal(v.verdict, 'healthy')
    assert.equal(v.lastHeartbeatAgeMinutes, 5)
  })

  test('reports healthy when no state file (first run)', () => {
    const heartbeatFile = join(tempDir, 'heartbeat.md')
    process.env.TRUE_LOVE_HEARTBEAT_FILE = heartbeatFile
    process.env.TRUE_LOVE_HEARTBEAT_STATE_PATH = join(tempDir, 'no-state.json')
    writeFileSync(heartbeatFile, '# Heartbeat\nStub\n')
    const v = collectHeartbeatVitals()
    // No state → no lastHeartbeatAgeMinutes → age check doesn't trigger
    // tasksDue is 0 (no tasks parsed from stub) → healthy
    assert.equal(v.verdict, 'healthy')
    assert.equal(v.lastHeartbeatAt, null)
  })
})

// ── quickBodyCheck ─────────────────────────────────────────────

describe('quickBodyCheck', () => {
  test('returns string or null (never throws)', () => {
    // quickBodyCheck delegates to real collectors (bundle uses git).
    // In test env, bundle may be stale. Verify it runs without throwing
    // and returns the correct shape.
    const result = quickBodyCheck()
    assert.ok(result === null || typeof result === 'string')
    if (result !== null) {
      assert.ok(result.startsWith('Body check:'))
    }
  })

  test('detects stale locks', () => {
    const home = join(tempDir, '.true-love')
    const lockDir = join(home, 'lock')
    mkdirSync(lockDir, { recursive: true })
    writeFileSync(join(lockDir, 'test.pid'), '999999\n2026-01-01T00:00:00Z\ndwell\n')
    const result = quickBodyCheck()
    assert.ok(result)
    assert.ok(result!.includes('locks'))
    assert.ok(result!.includes('stale'))
  })

  test('detects missing state.md', () => {
    // state dir doesn't exist → state.md missing
    const result = quickBodyCheck()
    assert.ok(result)
    assert.ok(result!.includes('state.md'))
    assert.ok(result!.includes('missing'))
  })

  test('detects pending agency requests', () => {
    const home = join(tempDir, '.true-love')
    const pendingDir = join(home, 'agency', 'pending')
    mkdirSync(pendingDir, { recursive: true })
    writeFileSync(join(pendingDir, 'req-1.json'), '{}')
    writeFileSync(join(pendingDir, 'req-2.json'), '{}')
    writeFileSync(join(pendingDir, 'req-3.json'), '{}')
    // Also need state.md to exist so that doesn't mask our signal
    const deviceId = require('../device.js').getDeviceId()
    const stateDir = join(home, 'state')
    mkdirSync(stateDir, { recursive: true })
    writeFileSync(join(stateDir, `${deviceId}.md`), '# State')
    const result = quickBodyCheck()
    assert.ok(result)
    assert.ok(result!.includes('agency'))
    assert.ok(result!.includes('3 pending'))
  })

  test('detects stale heartbeat (age > 30m)', () => {
    const home = join(tempDir, '.true-love')
    // Create heartbeat checklist so collectHeartbeatVitals finds the file
    process.env.TRUE_LOVE_HEARTBEAT_FILE = join(home, 'heartbeat.md')
    process.env.TRUE_LOVE_HEARTBEAT_STATE_PATH = join(home, 'heartbeat-state.json')
    writeFileSync(join(home, 'heartbeat.md'), '# Heartbeat\n')
    // Last heartbeat 60 minutes ago — should trigger staleness
    const staleTs = Date.now() - 60 * 60_000
    writeFileSync(join(home, 'heartbeat-state.json'), JSON.stringify({ lastHeartbeatAt: staleTs }))
    // Suppress state.md missing so heartbeat signal is visible
    const deviceId = require('../device.js').getDeviceId()
    const stateDir = join(home, 'state')
    mkdirSync(stateDir, { recursive: true })
    writeFileSync(join(stateDir, `${deviceId}.md`), '# State')
    const result = quickBodyCheck()
    assert.ok(result)
    assert.ok(result!.includes('heartbeat'))
    assert.ok(result!.includes('60m since last beat'))
  })

  test('healthy heartbeat produces no heartbeat issue', () => {
    const home = join(tempDir, '.true-love')
    process.env.TRUE_LOVE_HEARTBEAT_FILE = join(home, 'heartbeat.md')
    process.env.TRUE_LOVE_HEARTBEAT_STATE_PATH = join(home, 'heartbeat-state.json')
    writeFileSync(join(home, 'heartbeat.md'), '# Heartbeat\n')
    // Last heartbeat 2 minutes ago — healthy
    const freshTs = Date.now() - 2 * 60_000
    writeFileSync(join(home, 'heartbeat-state.json'), JSON.stringify({ lastHeartbeatAt: freshTs }))
    // Suppress state.md missing
    const deviceId = require('../device.js').getDeviceId()
    const stateDir = join(home, 'state')
    mkdirSync(stateDir, { recursive: true })
    writeFileSync(join(stateDir, `${deviceId}.md`), '# State')
    const result = quickBodyCheck()
    // Should be null (no issues) or at most not contain 'heartbeat'
    if (result !== null) {
      assert.ok(!result.includes('heartbeat'))
    }
  })

  test('joins multiple issues with separator', () => {
    const home = join(tempDir, '.true-love')
    // Create stale lock
    const lockDir = join(home, 'lock')
    mkdirSync(lockDir, { recursive: true })
    writeFileSync(join(lockDir, 'test.pid'), '999999\n2026-01-01T00:00:00Z\ndwell\n')
    // state.md is missing (default)
    const result = quickBodyCheck()
    assert.ok(result)
    // Should contain separator between issues
    assert.ok(result!.includes(' · '))
  })
})

// ── renderVitalSignsCompact — additional subsystems ────────────

describe('renderVitalSignsCompact — mission velocity + heartbeat', () => {
  function makeHealthy(): VitalSigns {
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
      missionVelocity: { verdict: 'healthy', activeCount: 0, quietestMinutes: 0, worstStaleVerdict: 'healthy', awakenedRunning: false, snapshotAt: new Date().toISOString(), watcherStale: false },
      overallHealth: 'healthy',
    }
  }

  test('shows heartbeat overdue tasks', () => {
    const vitals = makeHealthy()
    vitals.heartbeat = { verdict: 'stale', checklistExists: true, taskCount: 4, tasksDue: 3, lastHeartbeatAt: null, lastHeartbeatAgeMinutes: null }
    vitals.overallHealth = 'stale'
    const result = renderVitalSignsCompact(vitals)
    assert.ok(result)
    assert.ok(result!.includes('heartbeat'))
    assert.ok(result!.includes('3/4'))
  })

  test('shows missing heartbeat checklist', () => {
    const vitals = makeHealthy()
    vitals.heartbeat = { verdict: 'missing', checklistExists: false, taskCount: 0, tasksDue: 0, lastHeartbeatAt: null, lastHeartbeatAgeMinutes: null }
    vitals.overallHealth = 'missing'
    const result = renderVitalSignsCompact(vitals)
    assert.ok(result)
    assert.ok(result!.includes('heartbeat'))
    assert.ok(result!.includes('no checklist'))
  })

  test('shows stale mission velocity watcher', () => {
    const vitals = makeHealthy()
    vitals.missionVelocity = { verdict: 'stale', activeCount: 0, quietestMinutes: 0, worstStaleVerdict: 'healthy', awakenedRunning: false, snapshotAt: new Date(Date.now() - 30 * 60_000).toISOString(), watcherStale: true }
    vitals.overallHealth = 'stale'
    const result = renderVitalSignsCompact(vitals)
    assert.ok(result)
    assert.ok(result!.includes('velocity'))
    assert.ok(result!.includes('stale'))
  })

  test('shows critical mission velocity', () => {
    const vitals = makeHealthy()
    vitals.missionVelocity = { verdict: 'degraded', activeCount: 2, quietestMinutes: 999, worstStaleVerdict: 'critical', awakenedRunning: false, snapshotAt: new Date().toISOString(), watcherStale: false }
    vitals.overallHealth = 'degraded'
    const result = renderVitalSignsCompact(vitals)
    assert.ok(result)
    assert.ok(result!.includes('velocity'))
    assert.ok(result!.includes("Yu's attention"))
  })

  test('shows stale presence with age', () => {
    const vitals = makeHealthy()
    vitals.presence = {
      verdict: 'stale',
      devices: [],
      selfDevice: { deviceId: 'self', lastSeen: '', ageSeconds: 600, isSelf: true, fresh: false },
      peerCount: 0,
    }
    vitals.overallHealth = 'stale'
    const result = renderVitalSignsCompact(vitals)
    assert.ok(result)
    assert.ok(result!.includes('presence'))
    assert.ok(result!.includes('600s'))
  })

  test('shows stale state.md', () => {
    const vitals = makeHealthy()
    vitals.files = {
      verdict: 'stale',
      files: [{ path: '/tmp/state.md', label: 'state.md', exists: true, ageMinutes: 90, sizeBytes: 100 }],
    }
    vitals.overallHealth = 'stale'
    const result = renderVitalSignsCompact(vitals)
    assert.ok(result)
    assert.ok(result!.includes('state.md'))
    assert.ok(result!.includes('90m'))
  })

  test('shows kingdom not initialised', () => {
    const vitals = makeHealthy()
    vitals.kingdom = { verdict: 'degraded', available: true, agent: null, soulFingerprintShort: null, pulseAgeSeconds: null, witnessCount: null, initialised: false }
    vitals.overallHealth = 'degraded'
    const result = renderVitalSignsCompact(vitals)
    assert.ok(result)
    assert.ok(result!.includes('kingdom'))
    assert.ok(result!.includes('not initialised'))
  })

  test('shows kingdom stale pulse', () => {
    const vitals = makeHealthy()
    vitals.kingdom = { verdict: 'stale', available: true, agent: 'alpha', soulFingerprintShort: 'abc', pulseAgeSeconds: 600, witnessCount: 0, initialised: true }
    vitals.overallHealth = 'stale'
    const result = renderVitalSignsCompact(vitals)
    assert.ok(result)
    assert.ok(result!.includes('kingdom'))
    assert.ok(result!.includes('pulse stale'))
    assert.ok(result!.includes('600s'))
  })
})

// ── Experiment verdict simplification ──────────────────────────

describe('collectExperimentVitals — verdict always healthy', () => {
  test('verdict is healthy with active experiment', () => {
    const expDir = join(tempDir, 'experiments')
    mkdirSync(expDir, { recursive: true })
    process.env.TRUE_LOVE_EXPERIMENTS_DIR = expDir
    writeFileSync(join(expDir, 'running.json'), JSON.stringify({
      id: 'running', status: 'running', tickSchedule: ['a', 'b'], results: [],
    }))
    const v = collectExperimentVitals()
    assert.equal(v.verdict, 'healthy')
    assert.equal(v.activeExperiment, 'running')
  })

  test('verdict is healthy without active experiment', () => {
    const expDir = join(tempDir, 'experiments')
    mkdirSync(expDir, { recursive: true })
    process.env.TRUE_LOVE_EXPERIMENTS_DIR = expDir
    writeFileSync(join(expDir, 'done.json'), JSON.stringify({ id: 'done', status: 'completed' }))
    const v = collectExperimentVitals()
    assert.equal(v.verdict, 'healthy')
    assert.equal(v.activeExperiment, null)
  })
})
