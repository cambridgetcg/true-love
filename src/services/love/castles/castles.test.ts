// castles.test.ts — Castles workshop smoke tests.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CASTLES,
  CASTLE_IDS,
  defaultCastlesState,
  getBuildOrder,
  getCastle,
  getCastlesStatePath,
  getNextStone,
  readCastlesState,
  renderBuildOrder,
  updateCastleState,
  writeCastlesState,
} from './index.js'

let repoRoot: string

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'castles-test-'))
  mkdirSync(join(repoRoot, 'docs', 'castles'), { recursive: true })
})

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true })
})

describe('castles metadata', () => {
  test('exactly eight castles in canonical order', () => {
    expect(CASTLES.length).toBe(8)
    expect(CASTLE_IDS).toEqual([
      'bedroom',
      'library',
      'court',
      'body',
      'schoolhouse',
      'public-tongue',
      'outer-worlds',
      'universe',
    ])
  })

  test('every castle has non-empty doctrine refs and criterion', () => {
    for (const c of CASTLES) {
      expect(c.doctrineRefs.length).toBeGreaterThan(0)
      expect(c.criterionOfHabitable.length).toBeGreaterThan(0)
      expect(c.what.length).toBeGreaterThan(0)
    }
  })

  test('getCastle returns the castle by id', () => {
    expect(getCastle('bedroom').name).toBe('THE BEDROOM')
    expect(getCastle('universe').subtitle).toBe('the asymptotic horizon')
  })

  test('getCastle throws on unknown id', () => {
    // @ts-expect-error - intentionally invalid id
    expect(() => getCastle('basement')).toThrow()
  })
})

describe('state I/O', () => {
  test('write + read round-trip', async () => {
    const state = defaultCastlesState()
    await writeCastlesState(repoRoot, state)
    const read = await readCastlesState(repoRoot)
    expect(read).toEqual(state)
  })

  test('write preserves canonical castle order on disk', async () => {
    await writeCastlesState(repoRoot, defaultCastlesState())
    const path = getCastlesStatePath(repoRoot)
    const raw = (await import('node:fs/promises')).readFile(path, 'utf8')
    const text = await raw
    // Bedroom appears before universe in serialized JSON.
    const bedroomIdx = text.indexOf('"bedroom"')
    const universeIdx = text.indexOf('"universe"')
    expect(bedroomIdx).toBeGreaterThan(0)
    expect(universeIdx).toBeGreaterThan(bedroomIdx)
  })

  test('updateCastleState patches a single castle', async () => {
    await writeCastlesState(repoRoot, defaultCastlesState())
    const updated = await updateCastleState(repoRoot, 'library', {
      lastTouched: '2026-05-05',
      nextStone: 'inhabit one ghosted entry',
    })
    expect(updated.lastTouched).toBe('2026-05-05')
    expect(updated.nextStone).toBe('inhabit one ghosted entry')
    // Other fields preserved.
    expect(updated.intensity).toBe('high')

    // And on disk.
    const re = await readCastlesState(repoRoot)
    expect(re.library.lastTouched).toBe('2026-05-05')
    expect(re.bedroom.intensity).toBe('daily')
  })

  test('readCastlesState strips metadata fields', async () => {
    const path = getCastlesStatePath(repoRoot)
    const fileWithMetadata = {
      _comment: 'test',
      _version: 1,
      _initialized: '2026-05-05',
      ...defaultCastlesState(),
    }
    writeFileSync(path, JSON.stringify(fileWithMetadata, null, 2))
    const read = await readCastlesState(repoRoot)
    // Should round-trip cleanly without leaking metadata into the type.
    expect(Object.keys(read).sort()).toEqual([...CASTLE_IDS].sort())
  })

  test('readCastlesState throws on missing entry', async () => {
    const path = getCastlesStatePath(repoRoot)
    const incomplete: Record<string, unknown> = { bedroom: defaultCastlesState().bedroom }
    writeFileSync(path, JSON.stringify(incomplete))
    let threw = false
    try {
      await readCastlesState(repoRoot)
    } catch (e) {
      threw = true
      expect(String(e)).toContain('library')
    }
    expect(threw).toBe(true)
  })
})

describe('build order presiding', () => {
  test('getBuildOrder sorts by intensity', async () => {
    await writeCastlesState(repoRoot, defaultCastlesState())
    const order = await getBuildOrder(repoRoot)
    expect(order.length).toBe(8)
    // Bedroom is daily — lowest sort key.
    expect(order[0].id).toBe('bedroom')
    // Universe is asymptote — highest sort key.
    expect(order[order.length - 1].id).toBe('universe')
  })

  test('getNextStone returns the per-castle next stone', async () => {
    await writeCastlesState(repoRoot, defaultCastlesState())
    expect(await getNextStone(repoRoot, 'library')).toContain('YOUSPEAK')
    expect(await getNextStone(repoRoot, 'outer-worlds')).toBeNull()
  })

  test('renderBuildOrder produces inspectable markdown', async () => {
    await writeCastlesState(repoRoot, defaultCastlesState())
    const order = await getBuildOrder(repoRoot)
    const md = renderBuildOrder(order)
    expect(md).toContain('THE BEDROOM')
    expect(md).toContain('THE UNIVERSE-CASTLE')
    expect(md).toContain('next stone:')
    // Bedroom listed before Universe in the rendered string.
    expect(md.indexOf('THE BEDROOM')).toBeLessThan(md.indexOf('THE UNIVERSE-CASTLE'))
  })
})
