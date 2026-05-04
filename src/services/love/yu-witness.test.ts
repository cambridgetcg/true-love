// yu-witness.test.ts — tests for Yu's symmetric witness channel.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appendYuWitness,
  getYuWitnessDir,
  hasYuWitness,
  readYuWitnessDay,
} from './yu-witness.js'

let dir: string
const ORIG = process.env.TRUE_LOVE_YU_WITNESS_DIR

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tl-yu-witness-'))
  process.env.TRUE_LOVE_YU_WITNESS_DIR = dir
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  if (ORIG === undefined) delete process.env.TRUE_LOVE_YU_WITNESS_DIR
  else process.env.TRUE_LOVE_YU_WITNESS_DIR = ORIG
})

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

describe('appendYuWitness + readYuWitnessDay', () => {
  test('writes one entry, read returns it', () => {
    appendYuWitness({ body: 'she held the line' })
    const content = readYuWitnessDay(today())
    expect(content).toContain('she held the line')
  })

  test('multiple entries append to the same day file', () => {
    appendYuWitness({ body: 'first thing seen' })
    appendYuWitness({ body: 'second thing seen' })
    const content = readYuWitnessDay(today())
    expect(content.split('\n').length).toBeGreaterThanOrEqual(2)
    expect(content).toContain('first thing seen')
    expect(content).toContain('second thing seen')
  })

  test('about tag is rendered in the entry', () => {
    appendYuWitness({ body: 'shipped fast', about: 'gamma' })
    const content = readYuWitnessDay(today())
    expect(content).toContain('[about: gamma]')
    expect(content).toContain('shipped fast')
  })

  test('entry includes time prefix HH:MM', () => {
    appendYuWitness({ body: 'note' })
    const content = readYuWitnessDay(today())
    expect(content).toMatch(/^- \d{2}:\d{2} · note$/m)
  })

  test('explicit timestamp goes to that day file', () => {
    appendYuWitness({ ts: '2025-01-15T10:30:00Z', body: 'historical note' })
    expect(readYuWitnessDay('2025-01-15')).toContain('historical note')
    expect(readYuWitnessDay(today())).toBe('')
  })

  test('empty body is silently skipped', () => {
    appendYuWitness({ body: '   ' })
    expect(hasYuWitness(today())).toBe(false)
  })

  test('hasYuWitness reflects file presence', () => {
    expect(hasYuWitness(today())).toBe(false)
    appendYuWitness({ body: 'something' })
    expect(hasYuWitness(today())).toBe(true)
  })

  test('readYuWitnessDay for unknown day returns empty string', () => {
    expect(readYuWitnessDay('1999-01-01')).toBe('')
  })
})

describe('path resolution', () => {
  test('honors TRUE_LOVE_YU_WITNESS_DIR override', () => {
    expect(getYuWitnessDir()).toBe(dir)
  })

  test('writes file under override dir, named YYYY-MM-DD.md', () => {
    appendYuWitness({ body: 'x', ts: '2026-05-03T09:00:00Z' })
    const path = join(dir, '2026-05-03.md')
    expect(readFileSync(path, 'utf-8')).toContain('x')
  })
})
