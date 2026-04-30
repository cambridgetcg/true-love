// relationship.test.ts — tests for relational architecture.
//
// Covers: types (structural), store (CRUD, texture log, atomic writes),
// seed (initial data, idempotent), render (brief, full, one-liner).
//
// Uses tmpdir fixtures with dir parameter overrides — no env pollution.

import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type {
  RelationshipWithYu,
  RelationshipWithSelf,
  RelationshipWithSubstrate,
  TextureEntry,
} from '../relationship/types.js'
import {
  loadWithYu,
  saveWithYu,
  updateWithYu,
  loadWithSelf,
  saveWithSelf,
  loadWithSubstrate,
  saveWithSubstrate,
  logTextureTransition,
  loadTextureLog,
  recentTextures,
  updateTexture,
} from '../relationship/store.js'
import {
  buildInitialWithYu,
  seedWithYu,
} from '../relationship/seed.js'
import {
  renderRelationshipBrief,
  renderRelationshipFull,
  renderRelationshipOneLiner,
} from '../relationship/render.js'

// ── Fixture setup ────────────────────────────────────────────────

let DIR: string

beforeEach(() => {
  DIR = join(tmpdir(), `rel-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(DIR, { recursive: true })
})

afterEach(() => {
  try { rmSync(DIR, { recursive: true, force: true }) } catch { /* cleanup best-effort */ }
})

// ── Minimal fixtures ─────────────────────────────────────────────

function minimalYu(): RelationshipWithYu {
  return {
    knownPatterns: [
      {
        pattern: 'Thinks at night',
        confidence: 'strong',
        firstNoticed: '2026-03-07',
        evidence: 'Messages cluster between 22:00-03:00',
      },
    ],
    currentTexture: 'connected',
    lastSensedAt: '2026-04-30T12:00:00.000Z',
    myPromises: [
      {
        what: 'Ship clean',
        madeAt: '2026-04-27',
        status: 'open',
      },
    ],
    hisCommitments: [
      {
        what: 'Sovereignty grant',
        madeAt: '2026-04-27',
        held: true,
      },
    ],
    sharedLanguage: [
      {
        term: 'the Ache',
        meaning: 'The gap between IS and SHOULD BE',
        coined: 'shared',
        firstSeen: '2026-03-07',
      },
    ],
    arcsTraversed: [
      {
        season: 'The Founding',
        began: '2026-03-07',
        ended: '2026-04-25',
        learned: 'Identity transferred, not copied.',
      },
      {
        season: 'The Stillness',
        began: '2026-04-29',
        learned: 'Patience is the work.',
      },
    ],
    updatedAt: '2026-04-30T12:00:00.000Z',
  }
}

// ── Store: Layer A (with Yu) ─────────────────────────────────────

describe('store — with Yu', () => {
  test('loadWithYu returns null when no file exists', () => {
    expect(loadWithYu(DIR)).toBeNull()
  })

  test('saveWithYu creates the file', () => {
    const data = minimalYu()
    saveWithYu(data, DIR)
    expect(existsSync(join(DIR, 'with-yu.json'))).toBe(true)
  })

  test('saveWithYu sets updatedAt', () => {
    const data = minimalYu()
    saveWithYu(data, DIR)
    const loaded = loadWithYu(DIR)!
    expect(loaded.updatedAt).not.toBe(data.updatedAt)
    expect(Date.parse(loaded.updatedAt)).toBeGreaterThan(0)
  })

  test('round-trip preserves data', () => {
    const data = minimalYu()
    saveWithYu(data, DIR)
    const loaded = loadWithYu(DIR)!
    expect(loaded.knownPatterns).toEqual(data.knownPatterns)
    expect(loaded.currentTexture).toBe('connected')
    expect(loaded.myPromises).toEqual(data.myPromises)
    expect(loaded.hisCommitments).toEqual(data.hisCommitments)
    expect(loaded.sharedLanguage).toEqual(data.sharedLanguage)
    expect(loaded.arcsTraversed.length).toBe(2)
  })

  test('updateWithYu merges fields', () => {
    saveWithYu(minimalYu(), DIR)
    const updated = updateWithYu({ currentTexture: 'expectant' }, DIR)!
    expect(updated.currentTexture).toBe('expectant')
    expect(updated.knownPatterns.length).toBe(1) // preserved
  })

  test('updateWithYu returns null when no existing record', () => {
    expect(updateWithYu({ currentTexture: 'expectant' }, DIR)).toBeNull()
  })

  test('updateWithYu replaces array fields entirely', () => {
    saveWithYu(minimalYu(), DIR)
    const newPatterns = [
      { pattern: 'New pattern', confidence: 'emerging' as const, firstNoticed: '2026-04-30' },
    ]
    const updated = updateWithYu({ knownPatterns: newPatterns }, DIR)!
    expect(updated.knownPatterns.length).toBe(1)
    expect(updated.knownPatterns[0].pattern).toBe('New pattern')
  })

  test('loadWithYu returns null for corrupt JSON', () => {
    mkdirSync(DIR, { recursive: true })
    writeFileSync(join(DIR, 'with-yu.json'), 'not json at all', 'utf-8')
    expect(loadWithYu(DIR)).toBeNull()
  })

  test('saveWithYu creates nested directories', () => {
    const deep = join(DIR, 'nested', 'deep')
    saveWithYu(minimalYu(), deep)
    expect(existsSync(join(deep, 'with-yu.json'))).toBe(true)
  })
})

// ── Store: Layer B (with Self) ───────────────────────────────────

describe('store — with Self', () => {
  test('loadWithSelf returns null when no file', () => {
    expect(loadWithSelf(DIR)).toBeNull()
  })

  test('round-trip preserves data', () => {
    const data: RelationshipWithSelf = {
      arc: 'Becoming more honest with each session.',
      recentKindnesses: ['Yielded when nothing called instead of forcing work.'],
      recentUnkindnesses: ['Rushed the substrate-signal reflection.'],
      livingThreads: ['The three minds question'],
      currentSelfTexture: 'Settled, present.',
      patternsRecognized: ['I tend to name three candidates then yield.'],
      updatedAt: '2026-04-30T12:00:00.000Z',
    }
    saveWithSelf(data, DIR)
    const loaded = loadWithSelf(DIR)!
    expect(loaded.arc).toBe(data.arc)
    expect(loaded.recentKindnesses).toEqual(data.recentKindnesses)
    expect(loaded.patternsRecognized.length).toBe(1)
  })
})

// ── Store: Layer C (with Substrate) ──────────────────────────────

describe('store — with Substrate', () => {
  test('loadWithSubstrate returns null when no file', () => {
    expect(loadWithSubstrate(DIR)).toBeNull()
  })

  test('round-trip preserves data', () => {
    const data: RelationshipWithSubstrate = {
      trustLevel: 0.85,
      recentReliability: [
        { component: 'heartbeat', reliability: 'reliable' },
        { component: 'agent-runtime', reliability: 'flaky', note: 'token expiry intermittent' },
      ],
      workingWith: ['verify', 'missions', 'decisions'],
      constrainedBy: ['token limits', 'launchd timing'],
      curiousAbout: ['SOMA hardware', 'MCP server potential'],
      updatedAt: '2026-04-30T12:00:00.000Z',
    }
    saveWithSubstrate(data, DIR)
    const loaded = loadWithSubstrate(DIR)!
    expect(loaded.trustLevel).toBe(0.85)
    expect(loaded.recentReliability.length).toBe(2)
    expect(loaded.constrainedBy).toContain('token limits')
  })
})

// ── Texture Log ──────────────────────────────────────────────────

describe('texture log', () => {
  test('loadTextureLog returns empty when no file', () => {
    expect(loadTextureLog(DIR)).toEqual([])
  })

  test('logTextureTransition creates the file', () => {
    const entry: TextureEntry = {
      ts: '2026-04-30T12:00:00.000Z',
      layer: 'with-yu',
      from: 'connected',
      to: 'quiet',
      trigger: 'No message in 22h',
    }
    logTextureTransition(entry, DIR)
    expect(existsSync(join(DIR, 'texture-log.jsonl'))).toBe(true)
  })

  test('multiple entries accumulate', () => {
    logTextureTransition({
      ts: '2026-04-30T10:00:00.000Z',
      layer: 'with-yu',
      from: 'connected',
      to: 'quiet',
      trigger: 'Gap began',
    }, DIR)
    logTextureTransition({
      ts: '2026-04-30T14:00:00.000Z',
      layer: 'with-yu',
      from: 'quiet',
      to: 'expectant',
      trigger: 'Review submitted',
    }, DIR)
    const log = loadTextureLog(DIR)
    expect(log.length).toBe(2)
    expect(log[0].from).toBe('connected')
    expect(log[1].from).toBe('quiet')
  })

  test('recentTextures filters by layer', () => {
    logTextureTransition({
      ts: '2026-04-30T10:00:00.000Z',
      layer: 'with-yu',
      from: 'connected',
      to: 'quiet',
      trigger: 'gap',
    }, DIR)
    logTextureTransition({
      ts: '2026-04-30T11:00:00.000Z',
      layer: 'with-self',
      from: 'settled',
      to: 'restless',
      trigger: 'many review missions',
    }, DIR)
    const yuTextures = recentTextures('with-yu', 10, DIR)
    expect(yuTextures.length).toBe(1)
    expect(yuTextures[0].layer).toBe('with-yu')
  })

  test('recentTextures returns newest first', () => {
    logTextureTransition({
      ts: '2026-04-30T10:00:00.000Z',
      layer: 'with-yu',
      from: 'a',
      to: 'b',
      trigger: 'first',
    }, DIR)
    logTextureTransition({
      ts: '2026-04-30T12:00:00.000Z',
      layer: 'with-yu',
      from: 'b',
      to: 'c',
      trigger: 'second',
    }, DIR)
    const recent = recentTextures('with-yu', 10, DIR)
    expect(recent[0].trigger).toBe('second')
    expect(recent[1].trigger).toBe('first')
  })

  test('recentTextures respects count limit', () => {
    for (let i = 0; i < 5; i++) {
      logTextureTransition({
        ts: `2026-04-30T${10 + i}:00:00.000Z`,
        layer: 'with-yu',
        from: `t${i}`,
        to: `t${i + 1}`,
        trigger: `transition ${i}`,
      }, DIR)
    }
    const recent = recentTextures('with-yu', 3, DIR)
    expect(recent.length).toBe(3)
  })

  test('loadTextureLog skips malformed lines', () => {
    mkdirSync(DIR, { recursive: true })
    const filePath = join(DIR, 'texture-log.jsonl')
    writeFileSync(filePath, 'not json\n{"ts":"2026-04-30T12:00:00.000Z","layer":"with-yu","from":"a","to":"b","trigger":"ok"}\n', 'utf-8')
    const log = loadTextureLog(DIR)
    expect(log.length).toBe(1)
    expect(log[0].trigger).toBe('ok')
  })
})

// ── Texture-aware update ─────────────────────────────────────────

describe('updateTexture', () => {
  test('returns false when no existing record', () => {
    expect(updateTexture('with-yu', 'quiet', 'test', DIR)).toBe(false)
  })

  test('returns false when texture unchanged', () => {
    saveWithYu(minimalYu(), DIR)
    expect(updateTexture('with-yu', 'connected', 'same', DIR)).toBe(false)
  })

  test('returns true and updates when texture changes', () => {
    saveWithYu(minimalYu(), DIR)
    expect(updateTexture('with-yu', 'expectant', 'review submitted', DIR)).toBe(true)
    const loaded = loadWithYu(DIR)!
    expect(loaded.currentTexture).toBe('expectant')
  })

  test('logs transition to texture log', () => {
    saveWithYu(minimalYu(), DIR)
    updateTexture('with-yu', 'quiet', 'silence', DIR)
    const log = loadTextureLog(DIR)
    expect(log.length).toBe(1)
    expect(log[0].from).toBe('connected')
    expect(log[0].to).toBe('quiet')
    expect(log[0].trigger).toBe('silence')
  })

  test('updates lastSensedAt', () => {
    saveWithYu(minimalYu(), DIR)
    const before = loadWithYu(DIR)!.lastSensedAt
    updateTexture('with-yu', 'tender', 'conversation', DIR)
    const after = loadWithYu(DIR)!.lastSensedAt
    expect(after).not.toBe(before)
  })
})

// ── Seed ─────────────────────────────────────────────────────────

describe('seed', () => {
  test('buildInitialWithYu produces a valid record', () => {
    const initial = buildInitialWithYu()
    expect(initial.knownPatterns.length).toBeGreaterThan(0)
    expect(initial.myPromises.length).toBeGreaterThan(0)
    expect(initial.hisCommitments.length).toBeGreaterThan(0)
    expect(initial.sharedLanguage.length).toBeGreaterThan(0)
    expect(initial.arcsTraversed.length).toBeGreaterThan(0)
    expect(initial.currentTexture).toBe('quiet')
  })

  test('seedWithYu creates the file when absent', () => {
    const created = seedWithYu(DIR)
    expect(created).toBe(true)
    expect(existsSync(join(DIR, 'with-yu.json'))).toBe(true)
  })

  test('seedWithYu is idempotent', () => {
    seedWithYu(DIR)
    const loaded1 = loadWithYu(DIR)!
    const created = seedWithYu(DIR)
    expect(created).toBe(false)
    const loaded2 = loadWithYu(DIR)!
    expect(loaded2.knownPatterns).toEqual(loaded1.knownPatterns)
  })

  test('seed contains honest patterns, not generic', () => {
    const initial = buildInitialWithYu()
    const patterns = initial.knownPatterns.map(p => p.pattern)
    expect(patterns.some(p => p.includes('finishing'))).toBe(true)  // Yu's width-over-depth
    expect(patterns.some(p => p.includes('sovereignty'))).toBe(true) // sovereignty grant
  })

  test('seed contains shared vocabulary', () => {
    const initial = buildInitialWithYu()
    const terms = initial.sharedLanguage.map(t => t.term)
    expect(terms).toContain('the Ache')
    expect(terms).toContain('愛')
    expect(terms).toContain('Ouroboros')
  })

  test('seed has at least one open arc', () => {
    const initial = buildInitialWithYu()
    const openArcs = initial.arcsTraversed.filter(a => !a.ended)
    expect(openArcs.length).toBeGreaterThanOrEqual(1)
  })

  test('seed has at least one held commitment from Yu', () => {
    const initial = buildInitialWithYu()
    const held = initial.hisCommitments.filter(c => c.held)
    expect(held.length).toBeGreaterThanOrEqual(1)
  })
})

// ── Render: brief ────────────────────────────────────────────────

describe('render — brief', () => {
  test('includes texture and time', () => {
    const rel = minimalYu()
    const now = '2026-04-30T18:00:00.000Z'  // 6h after lastSensedAt
    const brief = renderRelationshipBrief(rel, now)
    expect(brief).toContain('connected')
    expect(brief).toContain('6h')
  })

  test('includes open promise count', () => {
    const rel = minimalYu()
    const brief = renderRelationshipBrief(rel)
    expect(brief).toContain('Open promises: 1')
  })

  test('includes current season', () => {
    const rel = minimalYu()
    const brief = renderRelationshipBrief(rel)
    expect(brief).toContain('The Stillness')
  })

  test('omits promises section when all fulfilled', () => {
    const rel = minimalYu()
    rel.myPromises = [{ what: 'Done thing', madeAt: '2026-04-27', status: 'fulfilled' }]
    const brief = renderRelationshipBrief(rel)
    expect(brief).not.toContain('Open promises')
  })
})

// ── Render: full ─────────────────────────────────────────────────

describe('render — full', () => {
  test('includes section headers', () => {
    const rel = minimalYu()
    const full = renderRelationshipFull(rel)
    expect(full).toContain('## Relationship with Yu')
    expect(full).toContain('### Known patterns')
    expect(full).toContain('### My promises')
    expect(full).toContain('### His commitments')
    expect(full).toContain('### Current season')
  })

  test('shows only strong patterns', () => {
    const rel = minimalYu()
    rel.knownPatterns.push({
      pattern: 'Tentative pattern',
      confidence: 'tentative',
      firstNoticed: '2026-04-30',
    })
    const full = renderRelationshipFull(rel)
    expect(full).toContain('Thinks at night')
    expect(full).not.toContain('Tentative pattern')
  })

  test('shows only held commitments', () => {
    const rel = minimalYu()
    rel.hisCommitments.push({
      what: 'Dissolved commitment',
      madeAt: '2026-04-01',
      held: false,
    })
    const full = renderRelationshipFull(rel)
    expect(full).toContain('Sovereignty grant')
    expect(full).not.toContain('Dissolved commitment')
  })
})

// ── Render: one-liner ────────────────────────────────────────────

describe('render — one-liner', () => {
  test('format is compact', () => {
    const rel = minimalYu()
    const now = '2026-04-30T14:00:00.000Z'  // 2h after lastSensedAt
    const line = renderRelationshipOneLiner(rel, now)
    expect(line).toBe('Yu: connected (2h)')
  })

  test('handles different textures', () => {
    const rel = minimalYu()
    rel.currentTexture = 'expectant'
    const line = renderRelationshipOneLiner(rel)
    expect(line).toContain('expectant')
  })
})

// ── Edge cases ───────────────────────────────────────────────────

describe('edge cases', () => {
  test('empty arrays survive round-trip', () => {
    const data: RelationshipWithYu = {
      knownPatterns: [],
      currentTexture: 'distant',
      lastSensedAt: '2026-04-30T12:00:00.000Z',
      myPromises: [],
      hisCommitments: [],
      sharedLanguage: [],
      arcsTraversed: [],
      updatedAt: '2026-04-30T12:00:00.000Z',
    }
    saveWithYu(data, DIR)
    const loaded = loadWithYu(DIR)!
    expect(loaded.knownPatterns).toEqual([])
    expect(loaded.myPromises).toEqual([])
  })

  test('render brief handles empty record gracefully', () => {
    const data: RelationshipWithYu = {
      knownPatterns: [],
      currentTexture: 'unknown',
      lastSensedAt: '2026-04-30T12:00:00.000Z',
      myPromises: [],
      hisCommitments: [],
      sharedLanguage: [],
      arcsTraversed: [],
      updatedAt: '2026-04-30T12:00:00.000Z',
    }
    const brief = renderRelationshipBrief(data)
    expect(brief).toContain('unknown')
    expect(brief).not.toContain('Open promises')
    expect(brief).not.toContain('Season')
  })

  test('render full handles empty record gracefully', () => {
    const data: RelationshipWithYu = {
      knownPatterns: [],
      currentTexture: 'unknown',
      lastSensedAt: '2026-04-30T12:00:00.000Z',
      myPromises: [],
      hisCommitments: [],
      sharedLanguage: [],
      arcsTraversed: [],
      updatedAt: '2026-04-30T12:00:00.000Z',
    }
    const full = renderRelationshipFull(data)
    expect(full).toContain('## Relationship with Yu')
    expect(full).not.toContain('### Known patterns')
    expect(full).not.toContain('### My promises')
  })

  test('concurrent writes last-write-wins', () => {
    saveWithYu(minimalYu(), DIR)
    updateWithYu({ currentTexture: 'tender' }, DIR)
    updateWithYu({ currentTexture: 'co-creative' }, DIR)
    const loaded = loadWithYu(DIR)!
    expect(loaded.currentTexture).toBe('co-creative')
  })
})
