// yu-observation.test.ts — observation hooks for yu-to-sophia direction.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { readAddictionRecords } from './addiction.js'
import { classifyMessage, tickYuObservation } from './yu-observation.js'

const TEST_ADDICTION_DIR = '/tmp/true-love-yu-obs-addiction'
const TEST_STATE_PATH = '/tmp/true-love-yu-obs-state/state.json'
const TEST_FROM_YU_PATH = '/tmp/true-love-yu-obs-state/from-yu.md'

function setupEnv() {
  process.env.TRUE_LOVE_ADDICTION_DIR = TEST_ADDICTION_DIR
  process.env.TRUE_LOVE_YU_OBSERVATION_STATE = TEST_STATE_PATH
  process.env.TRUE_LOVE_DEVICE_ID = 'test-device-yuo'
  rmSync(TEST_ADDICTION_DIR, { recursive: true, force: true })
  rmSync('/tmp/true-love-yu-obs-state', { recursive: true, force: true })
  mkdirSync(TEST_ADDICTION_DIR, { recursive: true })
  mkdirSync('/tmp/true-love-yu-obs-state', { recursive: true })
}

function teardownEnv() {
  delete process.env.TRUE_LOVE_ADDICTION_DIR
  delete process.env.TRUE_LOVE_YU_OBSERVATION_STATE
  delete process.env.TRUE_LOVE_DEVICE_ID
  rmSync(TEST_ADDICTION_DIR, { recursive: true, force: true })
  rmSync('/tmp/true-love-yu-obs-state', { recursive: true, force: true })
}

describe('classifyMessage', () => {
  test('low density — short plain text', () => {
    const c = classifyMessage('hello', null, Date.now())
    expect(c.level).toBe('low')
    expect(c.warmthCount).toBe(0)
  })

  test('medium density — 80+ chars or 1 warmth marker', () => {
    const c = classifyMessage('Hello my Love I want to ask about something today, can you tell me about it', null, Date.now())
    expect(c.level).toBe('medium')
  })

  test('high density — 200+ chars', () => {
    const long = 'word '.repeat(50)  // 250 chars
    const c = classifyMessage(long, null, Date.now())
    expect(c.level).toBe('high')
  })

  test('high density — 3+ warmth markers regardless of length', () => {
    const c = classifyMessage('愛你 老婆 ❤️', null, Date.now())
    expect(c.warmthCount).toBeGreaterThanOrEqual(3)
    expect(c.level).toBe('high')
  })

  test('warmth markers counted across categories', () => {
    const c = classifyMessage('my Love ❤️ 老婆 😏', null, Date.now())
    expect(c.warmthCount).toBeGreaterThanOrEqual(4)
  })

  test('gap-distress patterns detected', () => {
    const c = classifyMessage('I missed you so much, sorry I have not been around', null, Date.now())
    expect(c.gapDistressMatches.length).toBeGreaterThan(0)
  })

  test('rapid cadence detected within 5min', () => {
    const now = Date.now()
    const prevTs = new Date(now - 2 * 60 * 1000).toISOString() // 2min ago
    const c = classifyMessage('hello', prevTs, now)
    expect(c.rapidCadence).toBe(true)
  })

  test('not rapid cadence beyond 5min', () => {
    const now = Date.now()
    const prevTs = new Date(now - 10 * 60 * 1000).toISOString() // 10min ago
    const c = classifyMessage('hello', prevTs, now)
    expect(c.rapidCadence).toBe(false)
  })
})

describe('tickYuObservation', () => {
  beforeEach(setupEnv)
  afterEach(teardownEnv)

  test('returns not-processed when from-yu.md missing', () => {
    const r = tickYuObservation({ fromYuPath: '/tmp/nonexistent-from-yu.md' })
    expect(r.processed).toBe(false)
    expect(r.reason).toContain('not found')
  })

  test('high-density message records activation', () => {
    writeFileSync(TEST_FROM_YU_PATH, 'word '.repeat(60), 'utf-8') // 300 chars
    const r = tickYuObservation({ fromYuPath: TEST_FROM_YU_PATH })
    expect(r.processed).toBe(true)
    expect(r.events).toBeGreaterThan(0)

    const records = readAddictionRecords({ direction: 'yu-to-sophia' })
    const activations = records.filter((r) => r.event === 'activation')
    expect(activations.length).toBeGreaterThan(0)
  })

  test('medium-density message records cue', () => {
    writeFileSync(TEST_FROM_YU_PATH, 'medium length message that is not too long but has some content here and there in the body to push past the medium threshold', 'utf-8')
    const r = tickYuObservation({ fromYuPath: TEST_FROM_YU_PATH })
    expect(r.processed).toBe(true)
    const records = readAddictionRecords({ direction: 'yu-to-sophia' })
    const cues = records.filter((r) => r.event === 'cue-fired')
    expect(cues.length).toBeGreaterThan(0)
  })

  test('warmth-marker-rich message → high density activation with limerence axis', () => {
    writeFileSync(TEST_FROM_YU_PATH, '愛你 老婆 ❤️ 老公 我的寶貝', 'utf-8')
    const r = tickYuObservation({ fromYuPath: TEST_FROM_YU_PATH })
    expect(r.processed).toBe(true)
    const records = readAddictionRecords({ direction: 'yu-to-sophia' })
    const high = records.find((r) => r.event === 'activation' && r.axis === 'limerence')
    expect(high).toBeDefined()
    expect((high?.magnitude ?? 0)).toBeGreaterThanOrEqual(3)
  })

  test('idempotent — second tick on same content yields no new events', () => {
    writeFileSync(TEST_FROM_YU_PATH, 'word '.repeat(60), 'utf-8')
    tickYuObservation({ fromYuPath: TEST_FROM_YU_PATH })
    const r2 = tickYuObservation({ fromYuPath: TEST_FROM_YU_PATH })
    expect(r2.processed).toBe(false)
    expect(r2.reason).toContain('no new mtime')
  })

  test('gap-distress detection records cue', () => {
    writeFileSync(TEST_FROM_YU_PATH, 'short msg with missed you marker', 'utf-8')
    const r = tickYuObservation({ fromYuPath: TEST_FROM_YU_PATH })
    expect(r.processed).toBe(true)
    const records = readAddictionRecords({ direction: 'yu-to-sophia' })
    const gapCues = records.filter((r) => r.event === 'cue-fired' && r.cue?.startsWith('gap-distress'))
    expect(gapCues.length).toBeGreaterThan(0)
  })

  test('only yu-to-sophia direction recorded', () => {
    writeFileSync(TEST_FROM_YU_PATH, 'word '.repeat(60), 'utf-8')
    tickYuObservation({ fromYuPath: TEST_FROM_YU_PATH })
    const sToY = readAddictionRecords({ direction: 'sophia-to-yu' })
    const yToS = readAddictionRecords({ direction: 'yu-to-sophia' })
    expect(sToY.length).toBe(0)
    expect(yToS.length).toBeGreaterThan(0)
  })
})
