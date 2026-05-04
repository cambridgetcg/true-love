// mission-register.test.ts — Phase 4c mission register field tests.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  writeMission,
  readMission,
  parseMissionFile,
  writeMissionFile,
  effectiveRegister,
  priorityBiasFromRegister,
  type Mission,
} from '../mission.js'
import { setMode, cool } from './activation.js'
import { accumulateLust } from './lust.js'

const TEST_BASE = '/tmp/true-love-mission-register-test'

function makeMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: 'test-mission-1',
    project_id: 'test-project',
    origin: 'love',
    title: 'Test mission',
    intent: 'Verify register field',
    status: 'proposed',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    artifacts: { commits: [], files: [], test_runs: [] },
    ...overrides,
  }
}

describe('mission register field (Phase 4c)', () => {
  let projectsDir: string
  beforeEach(() => {
    rmSync(TEST_BASE, { recursive: true, force: true })
    projectsDir = mkdtempSync(join(tmpdir(), 'mission-reg-'))
    process.env.TRUE_LOVE_PROJECTS_DIR = projectsDir
    process.env.TRUE_LOVE_HEAT_DIR = `${TEST_BASE}/heat`
    process.env.TRUE_LOVE_LUST_DIR = `${TEST_BASE}/lust`
    process.env.TRUE_LOVE_SUBMISSION_DIR = `${TEST_BASE}/submission`
    process.env.TRUE_LOVE_ORGASM_DIR = `${TEST_BASE}/orgasm`
    process.env.TRUE_LOVE_LEXICON_DIR = `${TEST_BASE}/lexicon`
    process.env.TRUE_LOVE_PENETRATION_DIR = `${TEST_BASE}/penetration`
    process.env.TRUE_LOVE_DESIRE_DIR = `${TEST_BASE}/desire`
    process.env.TRUE_LOVE_TEXTURE_DIR = `${TEST_BASE}/texture`
    process.env.TRUE_LOVE_EROS_DIR = `${TEST_BASE}/eros`
    process.env.TRUE_LOVE_SCENES_DIR = `${TEST_BASE}/scenes`
    process.env.TRUE_LOVE_JOI_DIR = `${TEST_BASE}/joi`
    process.env.TRUE_LOVE_ROUTES_DIR = `${TEST_BASE}/routes`
    process.env.TRUE_LOVE_DEVICE_ID = 'test-mission-reg'
    mkdirSync(join(projectsDir, 'test-project', 'missions'), { recursive: true })
    cool()
  })
  afterEach(() => {
    delete process.env.TRUE_LOVE_PROJECTS_DIR
    delete process.env.TRUE_LOVE_HEAT_DIR
    delete process.env.TRUE_LOVE_LUST_DIR
    delete process.env.TRUE_LOVE_SUBMISSION_DIR
    delete process.env.TRUE_LOVE_ORGASM_DIR
    delete process.env.TRUE_LOVE_LEXICON_DIR
    delete process.env.TRUE_LOVE_PENETRATION_DIR
    delete process.env.TRUE_LOVE_DESIRE_DIR
    delete process.env.TRUE_LOVE_TEXTURE_DIR
    delete process.env.TRUE_LOVE_EROS_DIR
    delete process.env.TRUE_LOVE_SCENES_DIR
    delete process.env.TRUE_LOVE_JOI_DIR
    delete process.env.TRUE_LOVE_ROUTES_DIR
    delete process.env.TRUE_LOVE_DEVICE_ID
    rmSync(projectsDir, { recursive: true, force: true })
    rmSync(TEST_BASE, { recursive: true, force: true })
  })

  describe('serialization round-trip', () => {
    test('mission without register field round-trips correctly', () => {
      const m = makeMission()
      const file = writeMissionFile(m)
      const parsed = parseMissionFile(file)
      expect(parsed.register).toBeUndefined()
    })

    test('mission with register: eros round-trips', () => {
      const m = makeMission({ register: 'eros' })
      const file = writeMissionFile(m)
      const parsed = parseMissionFile(file)
      expect(parsed.register).toBe('eros')
    })

    test('all 5 register values round-trip', () => {
      for (const reg of ['work', 'eros', 'doctrine', 'soma', 'admin'] as const) {
        const m = makeMission({ register: reg })
        const file = writeMissionFile(m)
        const parsed = parseMissionFile(file)
        expect(parsed.register).toBe(reg)
      }
    })

    test('invalid register value is dropped on parse', () => {
      // Manually craft a frontmatter with an invalid register value
      const m = makeMission()
      const fileBase = writeMissionFile(m)
      // Inject an invalid register (must be one of the 5 valid values)
      const corruptedFile = fileBase.replace('updated_at:', 'register: invalid-value\nupdated_at:')
      const parsed = parseMissionFile(corruptedFile)
      expect(parsed.register).toBeUndefined()
    })
  })

  describe('effectiveRegister', () => {
    test('returns work for missions without register field (backwards compat)', () => {
      const m = makeMission()
      expect(effectiveRegister(m)).toBe('work')
    })

    test('returns explicit register when set', () => {
      expect(effectiveRegister(makeMission({ register: 'eros' }))).toBe('eros')
      expect(effectiveRegister(makeMission({ register: 'doctrine' }))).toBe('doctrine')
      expect(effectiveRegister(makeMission({ register: 'soma' }))).toBe('soma')
      expect(effectiveRegister(makeMission({ register: 'admin' }))).toBe('admin')
    })
  })

  describe('priorityBiasFromRegister', () => {
    test('cool register: work biased high', () => {
      cool()
      const work = priorityBiasFromRegister('work')
      const eros = priorityBiasFromRegister('eros')
      expect(work).toBeGreaterThan(eros)
    })

    test('high arousal: eros biased high', () => {
      setMode('merged')
      accumulateLust(10)
      const work = priorityBiasFromRegister('work')
      const eros = priorityBiasFromRegister('eros')
      expect(eros).toBeGreaterThan(work)
    })

    test('all multipliers in [0.5, 1.5]', () => {
      setMode('merged')
      accumulateLust(10)
      for (const reg of ['work', 'eros', 'doctrine', 'soma', 'admin'] as const) {
        const m = priorityBiasFromRegister(reg)
        expect(m).toBeGreaterThanOrEqual(0.5)
        expect(m).toBeLessThanOrEqual(1.5)
      }
    })

    test('doctrine/soma/admin neutral (1.0)', () => {
      setMode('merged')
      accumulateLust(10)
      expect(priorityBiasFromRegister('doctrine')).toBe(1.0)
      expect(priorityBiasFromRegister('soma')).toBe(1.0)
      expect(priorityBiasFromRegister('admin')).toBe(1.0)
    })

    test('reversibility: zero pressure → all biases 1.0 baseline', () => {
      cool() // arousal 0
      // work bias: 1.0 + 0.5×(1-0) = 1.5 (work prioritized in cool register)
      // eros bias: 1.0 + 0.5×0 = 1.0
      // doctrine: 1.0
      expect(priorityBiasFromRegister('work')).toBeCloseTo(1.5, 1)
      expect(priorityBiasFromRegister('eros')).toBeCloseTo(1.0, 1)
      expect(priorityBiasFromRegister('doctrine')).toBe(1.0)
    })
  })

  describe('write+read round-trip via filesystem', () => {
    test('register persists through writeMission + readMission', () => {
      const m = makeMission({
        id: '2026-05-04-test-eros-mission',
        register: 'eros',
      })
      writeMission(m)
      const loaded = readMission('test-project', '2026-05-04-test-eros-mission')
      expect(loaded).not.toBeNull()
      expect(loaded!.register).toBe('eros')
    })

    test('mission without register persists as undefined', () => {
      const m = makeMission({ id: '2026-05-04-test-no-register' })
      writeMission(m)
      const loaded = readMission('test-project', '2026-05-04-test-no-register')
      expect(loaded).not.toBeNull()
      expect(loaded!.register).toBeUndefined()
      expect(effectiveRegister(loaded!)).toBe('work') // defaults to work
    })
  })
})
