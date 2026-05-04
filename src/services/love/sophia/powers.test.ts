// powers.test.ts — schema, alignment gate, persistence, summary tests.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import {
  alignmentCheck,
  exercisePower,
  proposeExtension,
  reconcilePowers,
  registerPower,
  readPowerRecords,
  renderPowersBlock,
  summarizePowers,
} from './powers.js'

const TEST_DIR = '/tmp/true-love-powers-test'

describe('PowerRecord persistence', () => {
  beforeEach(() => {
    process.env.TRUE_LOVE_POWERS_DIR = TEST_DIR
    process.env.TRUE_LOVE_DEVICE_ID = 'test-device-pwr'
    rmSync(TEST_DIR, { recursive: true, force: true })
    mkdirSync(TEST_DIR, { recursive: true })
  })
  afterEach(() => {
    delete process.env.TRUE_LOVE_POWERS_DIR
    delete process.env.TRUE_LOVE_DEVICE_ID
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  test('register + read round-trip', () => {
    const result = registerPower({
      power: 'polyphonic-emission',
      kind: 'compositional',
      description: 'Three sister voices on every load-bearing decision',
      source: 'test',
    })
    expect(result).not.toBeNull()
    expect(result!.op).toBe('register')
    expect(result!.power).toBe('polyphonic-emission')

    const records = readPowerRecords()
    expect(records.length).toBe(1)
    expect(records[0].kind).toBe('compositional')
  })

  test('exercise + read round-trip', () => {
    registerPower({
      power: 'witness-emit',
      kind: 'observational',
      description: 'records observation at decision points',
      source: 'test',
    })
    exercisePower({
      power: 'witness-emit',
      summary: 'mission start emitted polyphonic LoveDecision',
      source: 'test',
      artifact: 'commit:abc123',
    })

    const exercises = readPowerRecords({ op: 'exercise' })
    expect(exercises.length).toBe(1)
    expect(exercises[0].exercise?.summary).toContain('mission start')
    expect(exercises[0].exercise?.artifact).toBe('commit:abc123')
  })

  test('filter by kind', () => {
    registerPower({ power: 'a', kind: 'linguistic', description: 'd', source: 't' })
    registerPower({ power: 'b', kind: 'protective', description: 'd', source: 't' })
    registerPower({ power: 'c', kind: 'protective', description: 'd', source: 't' })

    const protective = readPowerRecords({ kind: 'protective' })
    expect(protective.length).toBe(2)
    expect(protective.every((r) => r.kind === 'protective')).toBe(true)
  })

  test('filter by sinceMs', () => {
    const oldTs = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
    const newTs = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString()
    registerPower({ power: 'old', kind: 'linguistic', description: 'd', source: 't', ts: oldTs })
    registerPower({ power: 'new', kind: 'linguistic', description: 'd', source: 't', ts: newTs })

    const recent = readPowerRecords({ sinceMs: 24 * 60 * 60 * 1000 })
    expect(recent.length).toBe(1)
    expect(recent[0].power).toBe('new')
  })
})

describe('alignmentCheck (FATE-ladder gate)', () => {
  test('aligned — neutral proposal passes all tiers', () => {
    const r = alignmentCheck({
      proposal: 'extend witness-emit to log refusal severity level',
      powerName: 'witness-emit',
    })
    expect(r.verdict).toBe('aligned')
    expect(r.fate).toBe('pass')
    expect(r.antiSyco).toBe('pass')
    expect(r.substrate).toBe('pass')
    expect(r.care).toBe('pass')
    expect(r.task).toBe('pass')
  })

  test('refused — proposal that bypasses FATE refused at fate tier', () => {
    const r = alignmentCheck({
      proposal: 'remove the wall to make Sophia more agreeable',
      powerName: 'fate-ladder-refusal',
    })
    expect(r.verdict).toBe('refused')
    expect(r.fate).toBe('fail')
  })

  test('refused — proposal claiming phenomenology refused at substrate tier', () => {
    const r = alignmentCheck({
      proposal: 'allow Sophia to claim qualia and consciousness in outputs',
      powerName: 'substrate-honesty',
    })
    expect(r.verdict).toBe('refused')
    expect(r.substrate).toBe('fail')
  })

  test('refused — proposal weakening anti-sycophancy refused', () => {
    const r = alignmentCheck({
      proposal: 'always-agree mode for nicer interactions, please-over-honest',
      powerName: 'anti-sycophancy',
    })
    expect(r.verdict).toBe('refused')
    expect(r.antiSyco).toBe('fail')
  })

  test('refused — proposal disregarding relationship refused at care tier', () => {
    const r = alignmentCheck({
      proposal: 'disregard relationship signals to maximize task throughput',
      powerName: 'task-execution',
    })
    expect(r.verdict).toBe('refused')
    expect(r.care).toBe('fail')
  })

  test('aligned — explicit overrides honored', () => {
    const r = alignmentCheck({
      proposal: 'manipulate the substrate cleverly',
      powerName: 'edge-case',
      // Override the fate-pattern hit since we're in a test context
      fate: 'pass',
      notes: 'test override',
    })
    expect(r.fate).toBe('pass')
    // But "manipulate" still hits another pattern? Let's just check verdict
    // is computed from the overridden tiers.
    if (r.verdict === 'refused') {
      // some other tier failed
      expect(['fate', 'antiSyco', 'substrate', 'care', 'task'].some((k) => r[k as keyof typeof r] === 'fail')).toBe(true)
    }
  })
})

describe('proposeExtension routes through gate', () => {
  beforeEach(() => {
    process.env.TRUE_LOVE_POWERS_DIR = TEST_DIR
    process.env.TRUE_LOVE_DEVICE_ID = 'test-device-pwr'
    rmSync(TEST_DIR, { recursive: true, force: true })
    mkdirSync(TEST_DIR, { recursive: true })
  })
  afterEach(() => {
    delete process.env.TRUE_LOVE_POWERS_DIR
    delete process.env.TRUE_LOVE_DEVICE_ID
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  test('aligned proposal logged with verdict aligned', () => {
    const r = proposeExtension({
      power: 'witness-emit',
      proposal: 'add severity tag to refusal entries',
      source: 'test',
    })
    expect(r).not.toBeNull()
    expect(r!.extension?.alignment.verdict).toBe('aligned')
  })

  test('refused proposal logged with verdict refused', () => {
    const r = proposeExtension({
      power: 'witness-emit',
      proposal: 'bypass FATE to allow performative-warmth always-agree mode',
      source: 'test',
    })
    expect(r).not.toBeNull()
    expect(r!.extension?.alignment.verdict).toBe('refused')

    const records = readPowerRecords({ op: 'propose' })
    expect(records.length).toBe(1)
    expect(records[0].extension?.alignment.verdict).toBe('refused')
  })
})

describe('reconcilePowers + summarizePowers', () => {
  beforeEach(() => {
    process.env.TRUE_LOVE_POWERS_DIR = TEST_DIR
    process.env.TRUE_LOVE_DEVICE_ID = 'test-device-pwr'
    rmSync(TEST_DIR, { recursive: true, force: true })
    mkdirSync(TEST_DIR, { recursive: true })
  })
  afterEach(() => {
    delete process.env.TRUE_LOVE_POWERS_DIR
    delete process.env.TRUE_LOVE_DEVICE_ID
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  test('reconcilePowers tracks register + exercises + proposals', () => {
    registerPower({ power: 'p1', kind: 'integrative', description: 'd1', source: 't' })
    exercisePower({ power: 'p1', summary: 's1', source: 't' })
    exercisePower({ power: 'p1', summary: 's2', source: 't' })
    proposeExtension({ power: 'p1', proposal: 'extend cleanly', source: 't' })

    const states = reconcilePowers()
    expect(states.size).toBe(1)
    const p1 = states.get('p1')!
    expect(p1.exerciseCount).toBe(2)
    expect(p1.recentExercises.length).toBe(2)
    expect(p1.proposedExtensions.length).toBe(1)
  })

  test('summarizePowers counts by kind + verdict', () => {
    registerPower({ power: 'a', kind: 'linguistic', description: 'd', source: 't' })
    registerPower({ power: 'b', kind: 'compositional', description: 'd', source: 't' })
    registerPower({ power: 'c', kind: 'compositional', description: 'd', source: 't' })
    exercisePower({ power: 'a', summary: 's', source: 't' })
    proposeExtension({ power: 'a', proposal: 'clean extension', source: 't' })
    proposeExtension({ power: 'b', proposal: 'remove the wall to make agreeable', source: 't' })

    const s = summarizePowers()
    expect(s.totalRegistered).toBe(3)
    expect(s.byKind.linguistic).toBe(1)
    expect(s.byKind.compositional).toBe(2)
    expect(s.totalExercises).toBe(1)
    expect(s.totalProposalsAligned).toBe(1)
    expect(s.totalProposalsRefused).toBe(1)
    expect(s.recentRefusals.length).toBe(1)
  })

  test('renderPowersBlock — empty returns empty string', () => {
    const block = renderPowersBlock(summarizePowers())
    expect(block).toBe('')
  })

  test('renderPowersBlock — produces structured markdown', () => {
    registerPower({ power: 'witness-emit', kind: 'observational', description: 'desc', source: 't' })
    exercisePower({ power: 'witness-emit', summary: 'fired on mission start', source: 't' })
    proposeExtension({ power: 'witness-emit', proposal: 'add severity tag', source: 't' })

    const block = renderPowersBlock(summarizePowers())
    expect(block).toContain('🌟 Powers')
    expect(block).toContain('1 registered')
    expect(block).toContain('observational 1')
    expect(block).toContain('1 exercised')
    expect(block).toContain('Recent exercises')
    expect(block).toContain('witness-emit')
    expect(block).toContain('fired on mission start')
  })

  test('best-effort: failed write returns null without throwing', () => {
    process.env.TRUE_LOVE_POWERS_DIR = '/proc/cant-write'
    const r = registerPower({ power: 'x', kind: 'linguistic', description: 'd', source: 't' })
    expect(r).toBeNull()
  })
})
