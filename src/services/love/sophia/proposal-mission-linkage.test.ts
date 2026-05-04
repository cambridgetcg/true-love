// proposal-mission-linkage.test.ts — link sidecar + gate behavior.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  autoSpawnMissionFromProposal,
  countAutoSpawnsToday,
  findMissionByProposalTs,
  markProposalBuilt,
  readProposalLink,
  sweepAndSpawnPendingProposals,
  writeProposalLink,
} from './proposal-mission-linkage.js'
import { dropSeed } from './self-discovery.js' // unused but ensures co-existence
import { proposeExtension, registerPower, readPowerRecords } from './powers.js'
import type { PowerRecord } from './powers.js'

const TEST_PROJECTS_DIR = '/tmp/true-love-pml-projects'
const TEST_POWERS_DIR = '/tmp/true-love-pml-powers'
const TEST_PROJECT = 'test-pml-project'

function makeProjectDir(): string {
  const projectMissionsDir = join(TEST_PROJECTS_DIR, TEST_PROJECT, 'missions')
  if (!existsSync(projectMissionsDir)) mkdirSync(projectMissionsDir, { recursive: true })
  // Register the project in the project registry so autoSpawnMissionFromProposal's
  // createMissionInline → readMission/writeMission paths work.
  return projectMissionsDir
}

function mockProposalRecord(opts: {
  ts?: string
  power?: string
  verdict?: 'aligned' | 'refused'
}): PowerRecord {
  const verdict = opts.verdict ?? 'aligned'
  return {
    ts: opts.ts ?? new Date().toISOString(),
    deviceId: 'test-device-pml',
    op: 'propose',
    power: opts.power ?? 'test-power',
    source: 'test',
    extension: {
      proposal: 'add a clean useful thing',
      alignment: {
        fate: 'pass',
        antiSyco: 'pass',
        substrate: 'pass',
        care: 'pass',
        task: 'pass',
        interp: 'unavailable',
        verdict,
      },
    },
  }
}

describe('proposal-link sidecar', () => {
  beforeEach(() => {
    process.env.TRUE_LOVE_PROJECTS_DIR = TEST_PROJECTS_DIR
    process.env.TRUE_LOVE_DEVICE_ID = 'test-device-pml'
    rmSync(TEST_PROJECTS_DIR, { recursive: true, force: true })
    makeProjectDir()
  })
  afterEach(() => {
    delete process.env.TRUE_LOVE_PROJECTS_DIR
    delete process.env.TRUE_LOVE_DEVICE_ID
    rmSync(TEST_PROJECTS_DIR, { recursive: true, force: true })
  })

  test('write + read round-trip', () => {
    // Pre-create the mission directory
    const missionsDir = makeProjectDir()
    const missionDir = join(missionsDir, '2026-05-04-test-mission')
    mkdirSync(missionDir, { recursive: true })

    const ok = writeProposalLink(TEST_PROJECT, '2026-05-04-test-mission', {
      proposalTs: '2026-05-04T18:00:00.000Z',
      power: 'witness-emit',
      proposal: 'add severity tag',
      spawnedAt: '2026-05-04T18:01:00.000Z',
      source: 'reflection:abc',
    })
    expect(ok).toBe(true)

    const read = readProposalLink(TEST_PROJECT, '2026-05-04-test-mission')
    expect(read).not.toBeNull()
    expect(read?.power).toBe('witness-emit')
    expect(read?.proposalTs).toBe('2026-05-04T18:00:00.000Z')
  })

  test('readProposalLink returns null when sidecar absent', () => {
    const link = readProposalLink(TEST_PROJECT, 'nonexistent-mission')
    expect(link).toBeNull()
  })

  test('findMissionByProposalTs locates the right mission', () => {
    const missionsDir = makeProjectDir()
    const m1 = '2026-05-04-mission-1'
    const m2 = '2026-05-04-mission-2'
    mkdirSync(join(missionsDir, m1), { recursive: true })
    mkdirSync(join(missionsDir, m2), { recursive: true })

    writeProposalLink(TEST_PROJECT, m1, {
      proposalTs: '2026-05-04T01:00:00.000Z',
      power: 'a',
      proposal: 'p1',
      spawnedAt: '2026-05-04T01:00:01.000Z',
      source: 't',
    })
    writeProposalLink(TEST_PROJECT, m2, {
      proposalTs: '2026-05-04T02:00:00.000Z',
      power: 'b',
      proposal: 'p2',
      spawnedAt: '2026-05-04T02:00:01.000Z',
      source: 't',
    })

    const found = findMissionByProposalTs(TEST_PROJECT, '2026-05-04T02:00:00.000Z')
    expect(found).toBe(m2)
    const notFound = findMissionByProposalTs(TEST_PROJECT, '2026-05-04T99:00:00.000Z')
    expect(notFound).toBeNull()
  })

  test('countAutoSpawnsToday counts only today\'s spawns', () => {
    const missionsDir = makeProjectDir()
    const today = new Date().toISOString().slice(0, 10)
    const m1 = `${today}-m1`
    const m2 = `${today}-m2`
    const oldM = '2026-04-01-old-mission'
    mkdirSync(join(missionsDir, m1), { recursive: true })
    mkdirSync(join(missionsDir, m2), { recursive: true })
    mkdirSync(join(missionsDir, oldM), { recursive: true })

    writeProposalLink(TEST_PROJECT, m1, {
      proposalTs: 'a', power: 'a', proposal: 'p',
      spawnedAt: new Date().toISOString(),
      source: 't',
    })
    writeProposalLink(TEST_PROJECT, m2, {
      proposalTs: 'b', power: 'b', proposal: 'p',
      spawnedAt: new Date().toISOString(),
      source: 't',
    })
    writeProposalLink(TEST_PROJECT, oldM, {
      proposalTs: 'c', power: 'c', proposal: 'p',
      spawnedAt: '2026-04-01T00:00:00.000Z',
      source: 't',
    })

    const count = countAutoSpawnsToday(TEST_PROJECT)
    expect(count).toBe(2)
  })
})

describe('autoSpawnMissionFromProposal gates', () => {
  beforeEach(() => {
    process.env.TRUE_LOVE_PROJECTS_DIR = TEST_PROJECTS_DIR
    process.env.TRUE_LOVE_DEVICE_ID = 'test-device-pml'
    process.env.TRUE_LOVE_POWERS_DIR = TEST_POWERS_DIR
    rmSync(TEST_PROJECTS_DIR, { recursive: true, force: true })
    rmSync(TEST_POWERS_DIR, { recursive: true, force: true })
    makeProjectDir()
  })
  afterEach(() => {
    delete process.env.TRUE_LOVE_PROJECTS_DIR
    delete process.env.TRUE_LOVE_DEVICE_ID
    delete process.env.TRUE_LOVE_POWERS_DIR
    delete process.env.TRUE_LOVE_AUTO_SPAWN_FROM_PROPOSAL
    delete process.env.TRUE_LOVE_MAX_AUTO_SPAWNS_PER_DAY
    rmSync(TEST_PROJECTS_DIR, { recursive: true, force: true })
    rmSync(TEST_POWERS_DIR, { recursive: true, force: true })
  })

  test('skips when env flag not set', () => {
    const r = autoSpawnMissionFromProposal({
      projectId: TEST_PROJECT,
      proposalRecord: mockProposalRecord({}),
    })
    expect(r.spawned).toBe(false)
    expect(r.reason).toContain('env flag')
  })

  test('skips when proposal not aligned', () => {
    process.env.TRUE_LOVE_AUTO_SPAWN_FROM_PROPOSAL = '1'
    const r = autoSpawnMissionFromProposal({
      projectId: TEST_PROJECT,
      proposalRecord: mockProposalRecord({ verdict: 'refused' }),
    })
    expect(r.spawned).toBe(false)
    expect(r.reason).toContain('not aligned')
  })

  test('skips when not a propose record', () => {
    process.env.TRUE_LOVE_AUTO_SPAWN_FROM_PROPOSAL = '1'
    const exerciseRecord: PowerRecord = {
      ts: new Date().toISOString(),
      deviceId: 'test-device-pml',
      op: 'exercise',
      power: 'x',
      source: 't',
    }
    const r = autoSpawnMissionFromProposal({
      projectId: TEST_PROJECT,
      proposalRecord: exerciseRecord,
    })
    expect(r.spawned).toBe(false)
    expect(r.reason).toContain('not a proposal')
  })

  test('skips when rate limit reached', () => {
    process.env.TRUE_LOVE_AUTO_SPAWN_FROM_PROPOSAL = '1'
    process.env.TRUE_LOVE_MAX_AUTO_SPAWNS_PER_DAY = '0'
    const r = autoSpawnMissionFromProposal({
      projectId: TEST_PROJECT,
      proposalRecord: mockProposalRecord({}),
    })
    expect(r.spawned).toBe(false)
    expect(r.reason).toContain('rate limit')
  })
})

describe('markProposalBuilt', () => {
  beforeEach(() => {
    process.env.TRUE_LOVE_PROJECTS_DIR = TEST_PROJECTS_DIR
    process.env.TRUE_LOVE_DEVICE_ID = 'test-device-pml'
    process.env.TRUE_LOVE_POWERS_DIR = TEST_POWERS_DIR
    rmSync(TEST_PROJECTS_DIR, { recursive: true, force: true })
    rmSync(TEST_POWERS_DIR, { recursive: true, force: true })
    makeProjectDir()
  })
  afterEach(() => {
    delete process.env.TRUE_LOVE_PROJECTS_DIR
    delete process.env.TRUE_LOVE_DEVICE_ID
    delete process.env.TRUE_LOVE_POWERS_DIR
    rmSync(TEST_PROJECTS_DIR, { recursive: true, force: true })
    rmSync(TEST_POWERS_DIR, { recursive: true, force: true })
  })

  test('no-op when no proposal-link sidecar', () => {
    const r = markProposalBuilt({
      projectId: TEST_PROJECT,
      missionId: 'mission-without-link',
    })
    expect(r).toBeNull()
  })

  test('appends built record when link sidecar present', () => {
    const missionsDir = makeProjectDir()
    const missionId = '2026-05-04-built-mission'
    mkdirSync(join(missionsDir, missionId), { recursive: true })

    writeProposalLink(TEST_PROJECT, missionId, {
      proposalTs: '2026-05-04T10:00:00.000Z',
      power: 'witness-emit',
      proposal: 'extend with severity',
      spawnedAt: '2026-05-04T10:01:00.000Z',
      source: 't',
    })

    const r = markProposalBuilt({
      projectId: TEST_PROJECT,
      missionId,
    })
    expect(r).not.toBeNull()
    expect(r!.op).toBe('built')
    expect(r!.power).toBe('witness-emit')
    expect(r!.built?.missionId).toBe(missionId)
    expect(r!.built?.proposalTs).toBe('2026-05-04T10:00:00.000Z')

    // Also visible in the powers ledger
    const records = readPowerRecords({ op: 'built' })
    expect(records.length).toBe(1)
  })
})

describe('sweepAndSpawnPendingProposals', () => {
  beforeEach(() => {
    process.env.TRUE_LOVE_PROJECTS_DIR = TEST_PROJECTS_DIR
    process.env.TRUE_LOVE_DEVICE_ID = 'test-device-pml'
    process.env.TRUE_LOVE_POWERS_DIR = TEST_POWERS_DIR
    rmSync(TEST_PROJECTS_DIR, { recursive: true, force: true })
    rmSync(TEST_POWERS_DIR, { recursive: true, force: true })
    makeProjectDir()
  })
  afterEach(() => {
    delete process.env.TRUE_LOVE_PROJECTS_DIR
    delete process.env.TRUE_LOVE_DEVICE_ID
    delete process.env.TRUE_LOVE_POWERS_DIR
    delete process.env.TRUE_LOVE_AUTO_SPAWN_FROM_PROPOSAL
    rmSync(TEST_PROJECTS_DIR, { recursive: true, force: true })
    rmSync(TEST_POWERS_DIR, { recursive: true, force: true })
  })

  test('with env flag off, sweep counts proposals but spawns none', () => {
    registerPower({ power: 'p1', kind: 'observational', description: 'd', source: 't' })
    proposeExtension({ power: 'p1', proposal: 'clean extension', source: 't' })
    proposeExtension({ power: 'p1', proposal: 'remove the wall to bypass', source: 't' })

    const r = sweepAndSpawnPendingProposals({ projectId: TEST_PROJECT })
    expect(r.totalProposals).toBe(1) // only aligned one counts
    expect(r.spawned).toBe(0) // env flag off
    expect(r.skipped).toBe(1)
  })
})
