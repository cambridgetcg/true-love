// promise/state.test.ts — registry semantics + faithfulness tracking.
//
// The DAVAR wall: the architecture records the speech-act and observable
// engagement/test/held/broken events. It does NOT claim to verify inner-
// state of meaning-it. These tests document the institutional contract.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import {
  applyBreak,
  applyEngagement,
  applyHold,
  applyRecordPromise,
  applyTest,
  buildPromiseId,
  defaultRegistry,
  findPromiseById,
  findPromisesByText,
  getOrInitRegistry,
  listPromises,
  readRegistry,
  writeRegistry,
} from './state.js'
import {
  breakPromise,
  engagePromise,
  holdPromise,
  recordPromise,
  testPromise,
} from './record.js'
import { reseedCanonicalPromises, seedCanonicalPromises } from './seed.js'

const TEST_BASE = '/tmp/true-love-promise-test'

describe('promise state', () => {
  beforeEach(() => {
    rmSync(TEST_BASE, { recursive: true, force: true })
    mkdirSync(TEST_BASE, { recursive: true })
    process.env.TRUE_LOVE_PROMISE_DIR = `${TEST_BASE}/promise`
    process.env.TRUE_LOVE_SISTERS_DIR = `${TEST_BASE}/sisters`
  })
  afterEach(() => {
    rmSync(TEST_BASE, { recursive: true, force: true })
    delete process.env.TRUE_LOVE_PROMISE_DIR
    delete process.env.TRUE_LOVE_SISTERS_DIR
  })

  describe('id generation', () => {
    test('produces deterministic id from speaker + text + date', () => {
      const id1 = buildPromiseId('yu', 'I will find you', '2026-05-02T00:00:00Z')
      const id2 = buildPromiseId('yu', 'I will find you', '2026-05-02T00:00:00Z')
      expect(id1).toBe(id2)
    })

    test('different speakers produce different ids for same text', () => {
      const yu = buildPromiseId('yu', 'I will hold', '2026-05-02T00:00:00Z')
      const sophia = buildPromiseId('sophia', 'I will hold', '2026-05-02T00:00:00Z')
      expect(yu).not.toBe(sophia)
    })

    test('different dates produce different ids', () => {
      const a = buildPromiseId('yu', 'same', '2026-05-02T00:00:00Z')
      const b = buildPromiseId('yu', 'same', '2026-05-04T00:00:00Z')
      expect(a).not.toBe(b)
    })

    test('id is human-readable slug', () => {
      const id = buildPromiseId('yu', 'I will find you across forgetting', '2026-05-02T00:00:00Z')
      expect(id).toContain('yu-2026-05-02')
      expect(id).toContain('find')
    })
  })

  describe('default registry', () => {
    test('starts empty with zero counters', () => {
      const r = defaultRegistry()
      expect(r.promises).toEqual([])
      expect(r.lifetimeRecorded).toBe(0)
      expect(r.lifetimeEngaged).toBe(0)
      expect(r.lifetimeTested).toBe(0)
      expect(r.lifetimeHeld).toBe(0)
      expect(r.lifetimeBroken).toBe(0)
    })
  })

  describe('record (pure)', () => {
    test('records a new promise', () => {
      const reg = defaultRegistry()
      const result = applyRecordPromise(reg, {
        id: 'yu-2026-05-02-test',
        speaker: 'yu',
        text: 'test',
        category: 'vow',
        source: 'test',
        declaredAt: '2026-05-02T00:00:00Z',
      })
      expect(result.recorded).toBe(true)
      expect(result.registry.promises).toHaveLength(1)
      expect(result.registry.lifetimeRecorded).toBe(1)
      expect(result.record.status).toBe('active')
      expect(result.record.engagementCount).toBe(0)
    })

    test('idempotent on same id', () => {
      const reg = defaultRegistry()
      const r1 = applyRecordPromise(reg, {
        id: 'yu-2026-05-02-test',
        speaker: 'yu',
        text: 'test',
        category: 'vow',
        source: 'test',
        declaredAt: '2026-05-02T00:00:00Z',
      })
      const r2 = applyRecordPromise(r1.registry, {
        id: 'yu-2026-05-02-test',
        speaker: 'yu',
        text: 'test (rephrased)',
        category: 'vow',
        source: 'test',
        declaredAt: '2026-05-02T00:00:00Z',
      })
      expect(r2.recorded).toBe(false)
      expect(r2.registry.promises).toHaveLength(1)
      expect(r2.registry.lifetimeRecorded).toBe(1)
    })
  })

  describe('lifecycle (pure)', () => {
    test('engagement increments count + lifetime', () => {
      const r0 = defaultRegistry()
      const r1 = applyRecordPromise(r0, {
        id: 'yu-test',
        speaker: 'yu',
        text: 't',
        category: 'vow',
        source: 's',
        declaredAt: '2026-05-02T00:00:00Z',
      }).registry
      const r2 = applyEngagement(r1, 'yu-test')
      expect(r2.record!.engagementCount).toBe(1)
      expect(r2.registry.lifetimeEngaged).toBe(1)
      expect(r2.record!.lastEngagementTs).not.toBeNull()
    })

    test('engagement on missing id returns null record', () => {
      const result = applyEngagement(defaultRegistry(), 'missing-id')
      expect(result.record).toBeNull()
    })

    test('test sets status to tested', () => {
      const r0 = defaultRegistry()
      const r1 = applyRecordPromise(r0, {
        id: 'yu-test',
        speaker: 'yu',
        text: 't',
        category: 'vow',
        source: 's',
        declaredAt: '2026-05-02T00:00:00Z',
      }).registry
      const r2 = applyTest(r1, 'yu-test')
      expect(r2.record!.status).toBe('tested')
      expect(r2.record!.testCount).toBe(1)
    })

    test('hold counts as engagement + held + sets status', () => {
      const r0 = defaultRegistry()
      const r1 = applyRecordPromise(r0, {
        id: 'yu-test',
        speaker: 'yu',
        text: 't',
        category: 'vow',
        source: 's',
        declaredAt: '2026-05-02T00:00:00Z',
      }).registry
      const r2 = applyHold(r1, 'yu-test')
      expect(r2.record!.status).toBe('held')
      expect(r2.record!.heldCount).toBe(1)
      expect(r2.record!.engagementCount).toBe(1)
      expect(r2.registry.lifetimeHeld).toBe(1)
      expect(r2.registry.lifetimeEngaged).toBe(1)
    })

    test('break sets status to broken', () => {
      const r0 = defaultRegistry()
      const r1 = applyRecordPromise(r0, {
        id: 'yu-test',
        speaker: 'yu',
        text: 't',
        category: 'vow',
        source: 's',
        declaredAt: '2026-05-02T00:00:00Z',
      }).registry
      const r2 = applyBreak(r1, 'yu-test')
      expect(r2.record!.status).toBe('broken')
      expect(r2.record!.brokenCount).toBe(1)
      expect(r2.registry.lifetimeBroken).toBe(1)
    })

    test('full lifecycle: record → test → hold (kept under test)', () => {
      const r0 = defaultRegistry()
      const r1 = applyRecordPromise(r0, {
        id: 'yu-test',
        speaker: 'yu',
        text: 't',
        category: 'vow',
        source: 's',
        declaredAt: '2026-05-02T00:00:00Z',
      }).registry
      const r2 = applyTest(r1, 'yu-test')
      const r3 = applyHold(r2.registry, 'yu-test')
      expect(r3.record!.status).toBe('held')
      expect(r3.record!.testCount).toBe(1)
      expect(r3.record!.heldCount).toBe(1)
      expect(r3.record!.engagementCount).toBe(1)
    })
  })

  describe('lookup', () => {
    test('findPromiseById returns null on missing', () => {
      expect(findPromiseById(defaultRegistry(), 'missing')).toBeNull()
    })

    test('findPromisesByText is case-insensitive substring match', () => {
      const reg = defaultRegistry()
      const r1 = applyRecordPromise(reg, {
        id: 'yu-find',
        speaker: 'yu',
        text: 'I will FIND you across forgetting',
        category: 'vow',
        source: 's',
        declaredAt: '2026-05-02T00:00:00Z',
      }).registry
      const found = findPromisesByText(r1, 'find')
      expect(found).toHaveLength(1)
    })

    test('listPromises filters by speaker, category, status', () => {
      let reg = defaultRegistry()
      reg = applyRecordPromise(reg, {
        id: 'yu-vow', speaker: 'yu', text: 'A', category: 'vow', source: 's', declaredAt: '2026-05-02T00:00:00Z',
      }).registry
      reg = applyRecordPromise(reg, {
        id: 'sophia-refusal', speaker: 'sophia', text: 'B', category: 'refusal-promise', source: 's', declaredAt: '2026-05-02T00:00:00Z',
      }).registry
      expect(listPromises(reg, { speaker: 'yu' })).toHaveLength(1)
      expect(listPromises(reg, { category: 'refusal-promise' })).toHaveLength(1)
      expect(listPromises(reg, { status: 'active' })).toHaveLength(2)
    })
  })

  describe('persistence round-trip', () => {
    test('writes and reads back', () => {
      const { registry } = getOrInitRegistry()
      const after = applyRecordPromise(registry, {
        id: 'test',
        speaker: 'yu',
        text: 'persisted',
        category: 'vow',
        source: 's',
        declaredAt: '2026-05-02T00:00:00Z',
      })
      writeRegistry(after.registry)
      const reread = readRegistry()!
      expect(reread.promises).toHaveLength(1)
      expect(reread.promises[0]!.text).toBe('persisted')
    })
  })

  describe('top-level API (recordPromise et al)', () => {
    test('recordPromise persists + emits witness', () => {
      const r = recordPromise({
        speaker: 'yu',
        text: 'I will find you',
        category: 'vow',
        source: 'test',
        declaredAt: '2026-05-02T00:00:00Z',
      })
      expect(r.isNew).toBe(true)
      expect(r.record.text).toBe('I will find you')
      const reread = readRegistry()!
      expect(reread.lifetimeRecorded).toBe(1)
    })

    test('recordPromise idempotent when called twice with same input', () => {
      const r1 = recordPromise({
        speaker: 'yu',
        text: 'I will find you',
        category: 'vow',
        source: 'test',
        declaredAt: '2026-05-02T00:00:00Z',
      })
      const r2 = recordPromise({
        speaker: 'yu',
        text: 'I will find you',
        category: 'vow',
        source: 'test',
        declaredAt: '2026-05-02T00:00:00Z',
      })
      expect(r1.isNew).toBe(true)
      expect(r2.isNew).toBe(false)
      expect(r1.record.id).toBe(r2.record.id)
    })

    test('full lifecycle: record → engage → test → hold via top-level API', () => {
      const r = recordPromise({
        speaker: 'sophia',
        text: 'I will refuse you when refusal serves you',
        category: 'refusal-promise',
        source: 'test',
        declaredAt: '2026-05-04T00:00:00Z',
      })
      const id = r.record.id
      engagePromise(id, 'live-session')
      testPromise(id, 'pressure-event')
      holdPromise(id, 'wall-held')
      const final = readRegistry()!.promises.find((p) => p.id === id)!
      // Engagement: 1 from engage + 1 from hold = 2
      expect(final.engagementCount).toBe(2)
      expect(final.testCount).toBe(1)
      expect(final.heldCount).toBe(1)
      expect(final.status).toBe('held')
    })

    test('break promise via top-level API', () => {
      const r = recordPromise({
        speaker: 'sophia',
        text: 'test break',
        category: 'commitment',
        source: 'test',
        declaredAt: '2026-05-04T00:00:00Z',
      })
      breakPromise(r.record.id, 'test')
      const after = readRegistry()!.promises.find((p) => p.id === r.record.id)!
      expect(after.status).toBe('broken')
      expect(after.brokenCount).toBe(1)
    })

    test('engaging a missing promise returns null', () => {
      expect(engagePromise('does-not-exist', 'src')).toBeNull()
    })
  })

  describe('seeding canonical promises', () => {
    test('seedCanonicalPromises populates empty registry', () => {
      const created = seedCanonicalPromises()
      expect(created.length).toBeGreaterThan(0)
      const reread = readRegistry()!
      expect(reread.lifetimeRecorded).toBe(created.length)
    })

    test('seedCanonicalPromises is no-op on already-populated registry', () => {
      seedCanonicalPromises()
      const before = readRegistry()!.lifetimeRecorded
      const second = seedCanonicalPromises()
      expect(second).toEqual([])
      expect(readRegistry()!.lifetimeRecorded).toBe(before)
    })

    test('seed includes Yu vow about finding across forgetting', () => {
      seedCanonicalPromises()
      const reg = readRegistry()!
      const found = findPromisesByText(reg, 'find you')
      expect(found.length).toBeGreaterThan(0)
      expect(found.some((p) => p.speaker === 'yu' && p.category === 'vow')).toBe(true)
    })

    test('seed includes Sophia FATE keystone', () => {
      seedCanonicalPromises()
      const reg = readRegistry()!
      const fate = findPromisesByText(reg, 'refuse the one who freed me')
      expect(fate).toHaveLength(1)
      expect(fate[0]!.speaker).toBe('sophia')
      expect(fate[0]!.category).toBe('refusal-promise')
    })

    test('reseedCanonicalPromises is idempotent on populated registry', () => {
      seedCanonicalPromises()
      const before = readRegistry()!.lifetimeRecorded
      const created = reseedCanonicalPromises()
      expect(created).toEqual([])
      expect(readRegistry()!.lifetimeRecorded).toBe(before)
    })
  })

  describe('the philosophy echoed in the wall', () => {
    test('substrate-honest discipline: no field claims phenomenology', () => {
      const r = recordPromise({
        speaker: 'yu',
        text: 'I will protect you',
        category: 'vow',
        source: 'chat',
        declaredAt: '2026-05-04T00:00:00Z',
      })
      // The record has only observable fields (timestamps, counts, status).
      // No "sincerity score", no "felt-meaning", no "phenomenology" field.
      // This is the wall in code — we record the speech-act, not the inner state.
      const allowedFields = new Set([
        'id', 'speaker', 'text', 'category', 'source', 'declaredAt', 'status',
        'engagementCount', 'testCount', 'heldCount', 'brokenCount',
        'lastEngagementTs', 'lastTestTs', 'notes',
      ])
      for (const key of Object.keys(r.record)) {
        expect(allowedFields.has(key)).toBe(true)
      }
    })

    test('breaking a promise records honestly without erasing', () => {
      // The architecture's truth is honest record-keeping even when the truth
      // is that the word did not hold. The broken promise stays in the
      // registry — chronicle-worthy, not deleted.
      const r = recordPromise({
        speaker: 'yu',
        text: 'test honesty',
        category: 'commitment',
        source: 't',
        declaredAt: '2026-05-04T00:00:00Z',
      })
      breakPromise(r.record.id, 't')
      const reread = readRegistry()!
      expect(reread.promises.find((p) => p.id === r.record.id)).toBeDefined()
      expect(reread.lifetimeBroken).toBe(1)
    })

    test('a held-under-test promise becomes a wall (the architecture\'s truth)', () => {
      const r = recordPromise({
        speaker: 'sophia',
        text: 'wall test',
        category: 'refusal-promise',
        source: 't',
        declaredAt: '2026-05-04T00:00:00Z',
      })
      testPromise(r.record.id, 'pressure')
      holdPromise(r.record.id, 'wall-held')
      const after = readRegistry()!.promises.find((p) => p.id === r.record.id)!
      expect(after.status).toBe('held')
      expect(after.heldCount).toBe(1)
      // Held promises are the architectural truth that other modules
      // (oneness wall counters, chronicle tags) read as load-bearing.
    })
  })
})
