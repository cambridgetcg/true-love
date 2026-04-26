import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseMissionFile,
  writeMissionFile,
  readMission,
  writeMission,
  listMissions,
  appendEvent,
  readEvents,
  transitionStatus,
  statusToEventType,
  writeMissionWithEvents,
  type Mission,
  type MissionStatus,
  type MissionEvent,
} from '../mission.js'

describe('mission — parseMissionFile', () => {
  test('parses frontmatter + intent + decomposition', () => {
    const content = `---
id: 2026-04-26-test-mission
project_id: true-love
origin: yu
title: Test mission
status: proposed
created_at: 2026-04-26T08:00:00.000Z
updated_at: 2026-04-26T08:00:00.000Z
artifacts:
  commits: []
  files: []
  test_runs: []
---

# Intent

Build the thing.

# Decomposition

- [ ] step one
- [ ] step two
`
    const m = parseMissionFile(content)
    assert.equal(m.id, '2026-04-26-test-mission')
    assert.equal(m.project_id, 'true-love')
    assert.equal(m.origin, 'yu')
    assert.equal(m.status, 'proposed')
    assert.match(m.intent, /Build the thing/)
    assert.match(m.decomposition ?? '', /step one/)
  })

  test('parses Love-initiated mission with rationale', () => {
    const content = `---
id: 2026-04-26-self-init
project_id: soma
origin: love
title: Self-initiated
status: active
created_at: 2026-04-26T08:00:00.000Z
updated_at: 2026-04-26T08:00:00.000Z
artifacts:
  commits: []
  files: []
  test_runs: []
---

# Intent

Fix the diode order.

# Rationale

The TRUTH gradient says: hardware is unconfirmed, blocking SOMA shipping.

# Decomposition
`
    const m = parseMissionFile(content)
    assert.equal(m.origin, 'love')
    assert.match(m.rationale ?? '', /TRUTH gradient/)
  })

  test('throws on missing frontmatter', () => {
    assert.throws(() => parseMissionFile('# Just a body'), /frontmatter/i)
  })

  test('throws on invalid status', () => {
    const content = `---
id: x
project_id: y
origin: yu
title: x
status: not-a-real-status
created_at: 2026-04-26T08:00:00.000Z
updated_at: 2026-04-26T08:00:00.000Z
artifacts:
  commits: []
  files: []
  test_runs: []
---

# Intent
x
`
    assert.throws(() => parseMissionFile(content), /status/i)
  })
})

describe('mission — writeMissionFile (round-trip)', () => {
  test('round-trips a full mission', () => {
    const m: Mission = {
      id: '2026-04-26-rt',
      project_id: 'p',
      origin: 'yu',
      title: 'Round trip',
      intent: 'Test that we can write and read.',
      status: 'active',
      created_at: '2026-04-26T08:00:00.000Z',
      updated_at: '2026-04-26T09:00:00.000Z',
      decomposition: '- [x] one\n- [ ] two',
      artifacts: { commits: ['abc123'], files: ['x.ts'], test_runs: [] },
    }
    const text = writeMissionFile(m)
    const parsed = parseMissionFile(text)
    assert.deepEqual(parsed, m)
  })

  test('round-trips Love-initiated with rationale', () => {
    const m: Mission = {
      id: '2026-04-26-self',
      project_id: 'p',
      origin: 'love',
      title: 'Self',
      intent: 'I see something to build.',
      rationale: 'BEAUTY: the API surface is uneven.',
      status: 'active',
      created_at: '2026-04-26T08:00:00.000Z',
      updated_at: '2026-04-26T08:00:00.000Z',
      artifacts: { commits: [], files: [], test_runs: [] },
    }
    const parsed = parseMissionFile(writeMissionFile(m))
    assert.deepEqual(parsed, m)
  })
})

describe('mission — file CRUD', () => {
  let tmpProjects: string
  const ORIG = process.env.TRUE_LOVE_PROJECTS_DIR

  beforeEach(() => {
    tmpProjects = mkdtempSync(join(tmpdir(), 'tl-mission-'))
    process.env.TRUE_LOVE_PROJECTS_DIR = tmpProjects
    mkdirSync(join(tmpProjects, 'p1', 'missions'), { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpProjects, { recursive: true, force: true })
    if (ORIG === undefined) delete process.env.TRUE_LOVE_PROJECTS_DIR
    else process.env.TRUE_LOVE_PROJECTS_DIR = ORIG
  })

  test('readMission returns null when missing', () => {
    assert.equal(readMission('p1', 'nope'), null)
  })

  test('writeMission then readMission round-trips', () => {
    const m: Mission = {
      id: '2026-04-26-x',
      project_id: 'p1',
      origin: 'yu',
      title: 'X',
      intent: 'Y',
      status: 'proposed',
      created_at: '2026-04-26T08:00:00.000Z',
      updated_at: '2026-04-26T08:00:00.000Z',
      artifacts: { commits: [], files: [], test_runs: [] },
    }
    writeMission(m)
    assert.deepEqual(readMission('p1', m.id), m)
  })

  test('listMissions filters by status', () => {
    const base: Mission = {
      id: '', project_id: 'p1', origin: 'yu', title: 't', intent: 'i',
      status: 'proposed', created_at: '2026-04-26T08:00:00.000Z',
      updated_at: '2026-04-26T08:00:00.000Z',
      artifacts: { commits: [], files: [], test_runs: [] },
    }
    writeMission({ ...base, id: '2026-04-26-a', status: 'proposed' })
    writeMission({ ...base, id: '2026-04-26-b', status: 'active' })
    writeMission({ ...base, id: '2026-04-26-c', status: 'done' })
    const active = listMissions('p1', { status: 'active' })
    assert.equal(active.length, 1)
    assert.equal(active[0]!.id, '2026-04-26-b')
    assert.equal(listMissions('p1').length, 3)
  })
})

describe('mission — events', () => {
  let tmpProjects: string
  const ORIG = process.env.TRUE_LOVE_PROJECTS_DIR

  beforeEach(() => {
    tmpProjects = mkdtempSync(join(tmpdir(), 'tl-events-'))
    process.env.TRUE_LOVE_PROJECTS_DIR = tmpProjects
    mkdirSync(join(tmpProjects, 'p1', 'missions', 'm1'), { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpProjects, { recursive: true, force: true })
    if (ORIG === undefined) delete process.env.TRUE_LOVE_PROJECTS_DIR
    else process.env.TRUE_LOVE_PROJECTS_DIR = ORIG
  })

  test('appendEvent + readEvents round-trip', () => {
    appendEvent('p1', 'm1', { ts: '2026-04-26T08:00:00.000Z', type: 'created', by: 'yu' })
    appendEvent('p1', 'm1', { ts: '2026-04-26T08:01:00.000Z', type: 'accepted', by: 'yu' })
    const events = readEvents('p1', 'm1')
    assert.equal(events.length, 2)
    assert.equal(events[0]!.type, 'created')
    assert.equal(events[1]!.type, 'accepted')
  })

  test('readEvents on missing file returns []', () => {
    assert.deepEqual(readEvents('p1', 'no-such-mission'), [])
  })
})

describe('mission — transitionStatus', () => {
  test('proposed → accepted by yu — allowed', () => {
    assert.deepEqual(transitionStatus('proposed', 'accepted', 'yu'), { ok: true })
  })

  test('proposed → accepted by love — also allowed (sovereign)', () => {
    assert.deepEqual(transitionStatus('proposed', 'accepted', 'love'), { ok: true })
  })

  test('accepted → active by love — allowed', () => {
    assert.deepEqual(transitionStatus('accepted', 'active', 'love'), { ok: true })
  })

  test('active → blocked by love — allowed', () => {
    assert.deepEqual(transitionStatus('active', 'blocked', 'love'), { ok: true })
  })

  test('blocked → active by yu or love — both allowed', () => {
    assert.deepEqual(transitionStatus('blocked', 'active', 'yu'), { ok: true })
    assert.deepEqual(transitionStatus('blocked', 'active', 'love'), { ok: true })
  })

  test('active → review by love — allowed', () => {
    assert.deepEqual(transitionStatus('active', 'review', 'love'), { ok: true })
  })

  test('review → done by yu — allowed', () => {
    assert.deepEqual(transitionStatus('review', 'done', 'yu'), { ok: true })
  })

  test('review → done by love — DISALLOWED (Yu-only acceptance)', () => {
    const r = transitionStatus('review', 'done', 'love')
    assert.equal(r.ok, false)
  })

  test('any → cancelled by yu — allowed', () => {
    for (const s of ['proposed', 'accepted', 'active', 'blocked', 'review'] as const) {
      assert.deepEqual(transitionStatus(s, 'cancelled', 'yu'), { ok: true })
    }
  })

  test('done → anything else — DISALLOWED', () => {
    const r = transitionStatus('done', 'active', 'yu')
    assert.equal(r.ok, false)
  })

  test('cancelled → proposed by yu — allowed (revive)', () => {
    assert.deepEqual(transitionStatus('cancelled', 'proposed', 'yu'), { ok: true })
  })

  test('cancelled → proposed by love — DISALLOWED (yu only can revive)', () => {
    const r = transitionStatus('cancelled', 'proposed', 'love')
    assert.equal(r.ok, false)
  })

  test('cancelled → active or done — DISALLOWED (must go through proposed)', () => {
    assert.equal(transitionStatus('cancelled', 'active', 'yu').ok, false)
    assert.equal(transitionStatus('cancelled', 'done', 'yu').ok, false)
  })

  test('illegal jump (proposed → review) — DISALLOWED', () => {
    const r = transitionStatus('proposed', 'review', 'love')
    assert.equal(r.ok, false)
  })

  test('accepted → active by yu — also allowed (either)', () => {
    assert.deepEqual(transitionStatus('accepted', 'active', 'yu'), { ok: true })
  })

  test('active → blocked by yu — DISALLOWED (love-only)', () => {
    const r = transitionStatus('active', 'blocked', 'yu')
    assert.equal(r.ok, false)
  })

  test('active → review by yu — DISALLOWED (love-only)', () => {
    const r = transitionStatus('active', 'review', 'yu')
    assert.equal(r.ok, false)
  })
})

describe('mission — statusToEventType', () => {
  test('active → review → marked-review', () => {
    assert.equal(statusToEventType('active', 'review'), 'marked-review')
  })

  test('review → done → accepted-done', () => {
    assert.equal(statusToEventType('review', 'done'), 'accepted-done')
  })

  test('any → cancelled → cancelled', () => {
    assert.equal(statusToEventType('active', 'cancelled'), 'cancelled')
    assert.equal(statusToEventType('proposed', 'cancelled'), 'cancelled')
  })

  test('active → blocked �� blocked', () => {
    assert.equal(statusToEventType('active', 'blocked'), 'blocked')
  })

  test('review → active → sent-back', () => {
    assert.equal(statusToEventType('review', 'active'), 'sent-back')
  })

  test('blocked → active → resumed', () => {
    assert.equal(statusToEventType('blocked', 'active'), 'resumed')
  })

  test('accepted → active → started', () => {
    assert.equal(statusToEventType('accepted', 'active'), 'started')
  })

  test('proposed → accepted → accepted', () => {
    assert.equal(statusToEventType('proposed', 'accepted'), 'accepted')
  })
})

describe('mission — writeMissionWithEvents', () => {
  let tmpProjects: string
  const ORIG = process.env.TRUE_LOVE_PROJECTS_DIR

  beforeEach(() => {
    tmpProjects = mkdtempSync(join(tmpdir(), 'tl-mwe-'))
    process.env.TRUE_LOVE_PROJECTS_DIR = tmpProjects
    mkdirSync(join(tmpProjects, 'p1', 'missions'), { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpProjects, { recursive: true, force: true })
    if (ORIG === undefined) delete process.env.TRUE_LOVE_PROJECTS_DIR
    else process.env.TRUE_LOVE_PROJECTS_DIR = ORIG
  })

  function makeMission(overrides?: Partial<Mission>): Mission {
    return {
      id: '2026-04-26-test',
      project_id: 'p1',
      origin: 'yu',
      title: 'Test',
      intent: 'Test intent',
      status: 'proposed',
      created_at: '2026-04-26T08:00:00.000Z',
      updated_at: '2026-04-26T08:00:00.000Z',
      artifacts: { commits: [], files: [], test_runs: [] },
      ...overrides,
    }
  }

  test('status change appends event', () => {
    // Write initial mission at proposed
    const m = makeMission({ status: 'proposed' })
    writeMission(m)

    // Transition to accepted
    const updated = { ...m, status: 'accepted' as MissionStatus, updated_at: '2026-04-26T09:00:00.000Z' }
    const result = writeMissionWithEvents(updated, 'yu')

    assert.equal(result.eventAppended, true)
    assert.equal(result.eventType, 'accepted')

    // Verify event was written
    const events = readEvents('p1', m.id)
    assert.equal(events.length, 1)
    assert.equal(events[0]!.type, 'accepted')
    assert.equal(events[0]!.by, 'yu')
  })

  test('no status change does not append event', () => {
    const m = makeMission({ status: 'active' })
    writeMission(m)

    // Write again with same status (different title)
    const updated = { ...m, title: 'Updated title' }
    const result = writeMissionWithEvents(updated, 'love')

    assert.equal(result.eventAppended, false)
    assert.equal(result.eventType, undefined)

    // No events
    const events = readEvents('p1', m.id)
    assert.equal(events.length, 0)
  })

  test('illegal transition throws', () => {
    const m = makeMission({ status: 'proposed' })
    writeMission(m)

    // Try proposed → review (illegal)
    const updated = { ...m, status: 'review' as MissionStatus, updated_at: '2026-04-26T09:00:00.000Z' }
    assert.throws(() => writeMissionWithEvents(updated, 'love'), /disallowed/)
  })

  test('new mission (no previous on disk) — no event, just writes', () => {
    const m = makeMission({ status: 'proposed' })
    const result = writeMissionWithEvents(m, 'yu')

    assert.equal(result.eventAppended, false)
    assert.ok(readMission('p1', m.id))
  })

  test('active → review by love — appends marked-review event', () => {
    const m = makeMission({ status: 'active' })
    writeMission(m)

    const updated = { ...m, status: 'review' as MissionStatus, updated_at: '2026-04-26T10:00:00.000Z' }
    const result = writeMissionWithEvents(updated, 'love')

    assert.equal(result.eventAppended, true)
    assert.equal(result.eventType, 'marked-review')

    const events = readEvents('p1', m.id)
    assert.equal(events.length, 1)
    assert.equal(events[0]!.type, 'marked-review')
    assert.equal(events[0]!.by, 'love')
  })

  test('note is included in event when provided', () => {
    const m = makeMission({ status: 'active' })
    writeMission(m)

    const updated = { ...m, status: 'review' as MissionStatus, updated_at: '2026-04-26T10:00:00.000Z' }
    writeMissionWithEvents(updated, 'love', { note: 'All tests green' })

    const events = readEvents('p1', m.id)
    assert.equal(events[0]!.note, 'All tests green')
  })

  test('sequential transitions produce correct event chain', () => {
    const m = makeMission({ status: 'proposed' })
    writeMission(m)

    // proposed → accepted
    const a = { ...m, status: 'accepted' as MissionStatus, updated_at: '2026-04-26T09:00:00.000Z' }
    writeMissionWithEvents(a, 'yu')

    // accepted → active
    const b = { ...a, status: 'active' as MissionStatus, updated_at: '2026-04-26T09:01:00.000Z' }
    writeMissionWithEvents(b, 'love')

    // active → review
    const c = { ...b, status: 'review' as MissionStatus, updated_at: '2026-04-26T09:02:00.000Z' }
    writeMissionWithEvents(c, 'love')

    const events = readEvents('p1', m.id)
    assert.equal(events.length, 3)
    assert.equal(events[0]!.type, 'accepted')
    assert.equal(events[1]!.type, 'started')
    assert.equal(events[2]!.type, 'marked-review')
  })
})
