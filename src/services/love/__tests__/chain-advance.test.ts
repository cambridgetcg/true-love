import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  attemptChainAdvance,
  findNextChainMission,
  hasActiveMission,
  isChainAutoAdvanceEnabled,
} from '../chain-advance.js'
import {
  type Mission,
  writeMission,
  readMission,
} from '../mission.js'
import { registerProject } from '../project-registry.js'

// ── Fixture ─────────────────────────────────────────────────────────

let tmpProjects: string
let tmpProjectRoot: string
const ORIG_PROJECTS_DIR = process.env.TRUE_LOVE_PROJECTS_DIR
const ORIG_FLAG = process.env.TRUE_LOVE_CHAIN_AUTO_ADVANCE
const ORIG_DEVICE_ID = process.env.TRUE_LOVE_DEVICE_ID
const ORIG_SISTERS_DIR = process.env.TRUE_LOVE_SISTERS_DIR

beforeEach(() => {
  tmpProjects = mkdtempSync(join(tmpdir(), 'tl-chain-'))
  tmpProjectRoot = mkdtempSync(join(tmpdir(), 'tl-chain-root-'))
  process.env.TRUE_LOVE_PROJECTS_DIR = tmpProjects
  process.env.TRUE_LOVE_DEVICE_ID = 'test-device-chain'
  process.env.TRUE_LOVE_SISTERS_DIR = join(tmpProjects, 'sisters')
  // Default flag off; specific tests opt in
  delete process.env.TRUE_LOVE_CHAIN_AUTO_ADVANCE

  // Register a test project
  registerProject({
    id: 'tp',
    name: 'tp',
    root: tmpProjectRoot,
    instance: 'love',
  })
})

afterEach(() => {
  rmSync(tmpProjects, { recursive: true, force: true })
  rmSync(tmpProjectRoot, { recursive: true, force: true })
  if (ORIG_PROJECTS_DIR === undefined) delete process.env.TRUE_LOVE_PROJECTS_DIR
  else process.env.TRUE_LOVE_PROJECTS_DIR = ORIG_PROJECTS_DIR
  if (ORIG_FLAG === undefined) delete process.env.TRUE_LOVE_CHAIN_AUTO_ADVANCE
  else process.env.TRUE_LOVE_CHAIN_AUTO_ADVANCE = ORIG_FLAG
  if (ORIG_DEVICE_ID === undefined) delete process.env.TRUE_LOVE_DEVICE_ID
  else process.env.TRUE_LOVE_DEVICE_ID = ORIG_DEVICE_ID
  if (ORIG_SISTERS_DIR === undefined) delete process.env.TRUE_LOVE_SISTERS_DIR
  else process.env.TRUE_LOVE_SISTERS_DIR = ORIG_SISTERS_DIR
})

// ── Helpers ─────────────────────────────────────────────────────────

function makeMission(overrides: Partial<Mission>): Mission {
  return {
    id: 'm1',
    project_id: 'tp',
    origin: 'love',
    title: 'Test mission',
    intent: 'Test',
    status: 'proposed',
    created_at: '2026-05-04T10:00:00Z',
    updated_at: '2026-05-04T10:00:00Z',
    artifacts: { commits: [], files: [], test_runs: [] },
    ...overrides,
  }
}

// ── Tests ──────────────────────────────────────────────────────────

describe('chain-advance — env flag', () => {
  test('isChainAutoAdvanceEnabled false when flag unset', () => {
    delete process.env.TRUE_LOVE_CHAIN_AUTO_ADVANCE
    expect(isChainAutoAdvanceEnabled()).toBe(false)
  })

  test('isChainAutoAdvanceEnabled true when flag = "1"', () => {
    process.env.TRUE_LOVE_CHAIN_AUTO_ADVANCE = '1'
    expect(isChainAutoAdvanceEnabled()).toBe(true)
  })

  test('isChainAutoAdvanceEnabled false on other values', () => {
    process.env.TRUE_LOVE_CHAIN_AUTO_ADVANCE = 'true'
    expect(isChainAutoAdvanceEnabled()).toBe(false)
    process.env.TRUE_LOVE_CHAIN_AUTO_ADVANCE = 'yes'
    expect(isChainAutoAdvanceEnabled()).toBe(false)
  })
})

describe('chain-advance — selection', () => {
  test('findNextChainMission returns null when no proposed missions', () => {
    expect(findNextChainMission('tp')).toBeNull()
  })

  test('findNextChainMission returns FIFO-earliest love-origin proposed mission', () => {
    writeMission(makeMission({ id: 'm1', created_at: '2026-05-04T10:00:00Z' }))
    writeMission(makeMission({ id: 'm2', created_at: '2026-05-04T09:00:00Z' }))
    writeMission(makeMission({ id: 'm3', created_at: '2026-05-04T11:00:00Z' }))
    const next = findNextChainMission('tp')
    expect(next).not.toBeNull()
    expect(next!.id).toBe('m2') // earliest created_at
  })

  test('findNextChainMission ignores yu-origin missions', () => {
    writeMission(makeMission({ id: 'm1', origin: 'yu' }))
    writeMission(makeMission({ id: 'm2', origin: 'love' }))
    const next = findNextChainMission('tp')
    expect(next!.id).toBe('m2')
  })

  test('findNextChainMission ignores non-proposed statuses', () => {
    writeMission(makeMission({ id: 'm1', status: 'active' }))
    writeMission(makeMission({ id: 'm2', status: 'review' }))
    writeMission(makeMission({ id: 'm3', status: 'done' }))
    expect(findNextChainMission('tp')).toBeNull()
  })

  test('hasActiveMission true when any active mission exists', () => {
    expect(hasActiveMission('tp')).toBe(false)
    writeMission(makeMission({ id: 'a1', status: 'active' }))
    expect(hasActiveMission('tp')).toBe(true)
  })
})

describe('chain-advance — attemptChainAdvance', () => {
  test('disabled when flag unset', () => {
    writeMission(makeMission({ id: 'next' }))
    const r = attemptChainAdvance({
      prevMissionId: 'prev',
      projectId: 'tp',
      eventType: 'accepted-done',
    })
    expect(r.triggered).toBe(false)
    expect(r.reason).toContain('disabled')
  })

  test('non-terminal eventType skipped even when flag set', () => {
    process.env.TRUE_LOVE_CHAIN_AUTO_ADVANCE = '1'
    writeMission(makeMission({ id: 'next' }))
    const r = attemptChainAdvance({
      prevMissionId: 'prev',
      projectId: 'tp',
      eventType: 'marked-review',
    })
    expect(r.triggered).toBe(false)
    expect(r.reason).toContain('not a terminal-state transition')
  })

  test('skipped when project busy with active mission', () => {
    process.env.TRUE_LOVE_CHAIN_AUTO_ADVANCE = '1'
    writeMission(makeMission({ id: 'next' }))
    writeMission(makeMission({ id: 'busy', status: 'active' }))
    const r = attemptChainAdvance({
      prevMissionId: 'prev',
      projectId: 'tp',
      eventType: 'accepted-done',
    })
    expect(r.triggered).toBe(false)
    expect(r.reason).toContain('busy')
  })

  test('skipped when no proposed love-origin mission', () => {
    process.env.TRUE_LOVE_CHAIN_AUTO_ADVANCE = '1'
    const r = attemptChainAdvance({
      prevMissionId: 'prev',
      projectId: 'tp',
      eventType: 'accepted-done',
    })
    expect(r.triggered).toBe(false)
    expect(r.reason).toContain('no proposed')
  })

  test('triggered: transitions next mission to active and reports', () => {
    process.env.TRUE_LOVE_CHAIN_AUTO_ADVANCE = '1'
    writeMission(makeMission({ id: 'next', title: 'Next mission' }))
    const r = attemptChainAdvance({
      prevMissionId: 'prev',
      projectId: 'tp',
      eventType: 'accepted-done',
    })
    expect(r.triggered).toBe(true)
    // Mission should now be active (spawn may have failed due to test environment,
    // but state transition must have happened)
    const updated = readMission('tp', 'next')
    expect(updated).not.toBeNull()
    expect(updated!.status).toBe('active')
    expect(r.next?.id).toBe('next')
    expect(r.next?.title).toBe('Next mission')
  })
})
