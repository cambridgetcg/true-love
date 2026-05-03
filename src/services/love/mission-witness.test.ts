import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readDayNotes } from './sisters/stream.js'
import {
  writeMission,
  writeMissionWithEvents,
  type Mission,
  type MissionStatus,
} from './mission.js'

const TEST_DIR = '/tmp/true-love-mission-witness-test'

let tmpProjects: string
const ORIG_PROJECTS = process.env.TRUE_LOVE_PROJECTS_DIR

function makeMission(overrides?: Partial<Mission>): Mission {
  return {
    id: '2026-05-03-test-mission',
    project_id: 'p1',
    origin: 'yu',
    title: 'Test mission',
    intent: 'Test intent',
    status: 'proposed',
    created_at: '2026-05-03T08:00:00.000Z',
    updated_at: '2026-05-03T08:00:00.000Z',
    artifacts: { commits: [], files: [], test_runs: [] },
    ...overrides,
  }
}

describe('mission lifecycle triggers witness-hook', () => {
  beforeEach(() => {
    process.env.TRUE_LOVE_SISTERS_DIR = TEST_DIR
    process.env.TRUE_LOVE_DEVICE_ID = 'test-device'
    rmSync(TEST_DIR, { recursive: true, force: true })
    mkdirSync(TEST_DIR, { recursive: true })

    tmpProjects = mkdtempSync(join(tmpdir(), 'tl-mwh-'))
    process.env.TRUE_LOVE_PROJECTS_DIR = tmpProjects
    mkdirSync(join(tmpProjects, 'p1', 'missions'), { recursive: true })
  })

  afterEach(() => {
    delete process.env.TRUE_LOVE_SISTERS_DIR
    delete process.env.TRUE_LOVE_DEVICE_ID
    rmSync(TEST_DIR, { recursive: true, force: true })
    rmSync(tmpProjects, { recursive: true, force: true })
    if (ORIG_PROJECTS === undefined) delete process.env.TRUE_LOVE_PROJECTS_DIR
    else process.env.TRUE_LOVE_PROJECTS_DIR = ORIG_PROJECTS
  })

  test('starting a mission (accepted → active) appends a gamma witness note with start slug', () => {
    const m = makeMission({ status: 'accepted' })
    writeMission(m)

    const updated: Mission = {
      ...m,
      status: 'active' as MissionStatus,
      updated_at: '2026-05-03T09:00:00.000Z',
    }
    const result = writeMissionWithEvents(updated, 'love')
    expect(result.eventAppended).toBe(true)
    expect(result.eventType).toBe('started')

    const today = new Date().toISOString().slice(0, 10)
    const notes = readDayNotes(today).filter(
      (n) => n.kind === 'witnessed-decision' && n.context?.decisionType === 'mission'
    )
    expect(notes.length).toBeGreaterThan(0)
    expect(notes[0]!.context?.of).toContain('start')
    expect(notes[0]!.context?.of).toContain(m.id)
    expect(notes[0]!.sister).toBe('gamma')
  })

  test('cancelling a mission appends a sophia witness note with abandon slug', () => {
    const m = makeMission({ status: 'proposed' })
    writeMission(m)

    const updated: Mission = {
      ...m,
      status: 'cancelled' as MissionStatus,
      updated_at: '2026-05-03T09:30:00.000Z',
    }
    const result = writeMissionWithEvents(updated, 'yu')
    expect(result.eventAppended).toBe(true)
    expect(result.eventType).toBe('cancelled')

    const today = new Date().toISOString().slice(0, 10)
    const abandonNotes = readDayNotes(today).filter(
      (n) =>
        n.kind === 'witnessed-decision' &&
        n.context?.decisionType === 'mission' &&
        n.context.of.startsWith('abandon')
    )
    expect(abandonNotes.length).toBeGreaterThan(0)
    expect(abandonNotes[0]!.sister).toBe('sophia')
    expect(abandonNotes[0]!.context?.of).toContain(m.id)
  })

  test('completing a mission via accepted-done appends a gamma witness note with complete slug', () => {
    const m = makeMission({ status: 'review' })
    writeMission(m)

    const updated: Mission = {
      ...m,
      status: 'done' as MissionStatus,
      updated_at: '2026-05-03T10:00:00.000Z',
    }
    const result = writeMissionWithEvents(updated, 'yu')
    expect(result.eventAppended).toBe(true)
    expect(result.eventType).toBe('accepted-done')

    const today = new Date().toISOString().slice(0, 10)
    const completeNotes = readDayNotes(today).filter(
      (n) =>
        n.kind === 'witnessed-decision' &&
        n.context?.decisionType === 'mission' &&
        n.context.of.startsWith('complete')
    )
    expect(completeNotes.length).toBeGreaterThan(0)
    expect(completeNotes[0]!.sister).toBe('gamma')
    expect(completeNotes[0]!.context?.of).toContain(m.id)
  })

  test('non-lifecycle event (active → blocked) does NOT append a witness note', () => {
    const m = makeMission({ status: 'active' })
    writeMission(m)

    const updated: Mission = {
      ...m,
      status: 'blocked' as MissionStatus,
      updated_at: '2026-05-03T11:00:00.000Z',
    }
    const result = writeMissionWithEvents(updated, 'love')
    expect(result.eventAppended).toBe(true)
    expect(result.eventType).toBe('blocked')

    const today = new Date().toISOString().slice(0, 10)
    const missionNotes = readDayNotes(today).filter(
      (n) => n.kind === 'witnessed-decision' && n.context?.decisionType === 'mission'
    )
    expect(missionNotes).toHaveLength(0)
  })

  test('non-lifecycle event (active → review marked-review) does NOT append a witness note', () => {
    const m = makeMission({ status: 'active' })
    writeMission(m)

    const updated: Mission = {
      ...m,
      status: 'review' as MissionStatus,
      updated_at: '2026-05-03T11:30:00.000Z',
    }
    const result = writeMissionWithEvents(updated, 'love')
    expect(result.eventAppended).toBe(true)
    expect(result.eventType).toBe('marked-review')

    const today = new Date().toISOString().slice(0, 10)
    const missionNotes = readDayNotes(today).filter(
      (n) => n.kind === 'witnessed-decision' && n.context?.decisionType === 'mission'
    )
    expect(missionNotes).toHaveLength(0)
  })

  test('writing a mission with no status change does NOT append a witness note', () => {
    const m = makeMission({ status: 'active' })
    writeMission(m)

    // Same status, just rewrite
    const updated: Mission = { ...m, title: 'Updated title' }
    const result = writeMissionWithEvents(updated, 'love')
    expect(result.eventAppended).toBe(false)

    const today = new Date().toISOString().slice(0, 10)
    const missionNotes = readDayNotes(today).filter(
      (n) => n.kind === 'witnessed-decision' && n.context?.decisionType === 'mission'
    )
    expect(missionNotes).toHaveLength(0)
  })
})
