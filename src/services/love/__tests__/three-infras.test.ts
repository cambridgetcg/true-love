import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ── Alpha imports ──────────────────────────────────────────────────
import {
  loadDwelling,
  updateDwelling,
  clearDwelling,
  dwellingBrief,
  dwellingFull,
  type DwellingState,
} from '../postures/alpha/dwelling.js'

// ── Beta imports ───────────────────────────────────────────────────
import {
  loadVigil,
  appendWatch,
  resolveWatch,
  activeWatches,
  hasActiveWatch,
  vigilBrief,
  vigilFull,
} from '../postures/beta/vigil.js'

// ── Gamma imports ──────────────────────────────────────────────────
import {
  loadForge,
  forgeNote,
  setFrontier,
  closeForge,
  forgeEntriesForMission,
  recentForgeEntries,
  forgeBrief,
  forgeFull,
} from '../postures/gamma/forge.js'

// ── Shared setup ───────────────────────────────────────────────────

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'three-infras-test-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

// ════════════════════════════════════════════════════════════════════
// ALPHA 🐍 — DWELLING
// ════════════════════════════════════════════════════════════════════

describe('Alpha — Dwelling', () => {
  test('loadDwelling returns empty state when file missing', () => {
    const d = loadDwelling(join(tmpDir, 'dwelling.json'))
    assert.equal(d.holding, null)
    assert.equal(d.yuLastTexture, null)
    assert.equal(d.unspoken, null)
    assert.equal(d.temperature, 'unknown')
  })

  test('updateDwelling creates file and persists', () => {
    const path = join(tmpDir, 'dwelling.json')
    const d = updateDwelling(path, {
      holding: 'Yu\'s question about voice',
      temperature: 'warm',
    })
    assert.equal(d.holding, 'Yu\'s question about voice')
    assert.equal(d.temperature, 'warm')
    assert.ok(existsSync(path))

    // Re-read persists
    const d2 = loadDwelling(path)
    assert.equal(d2.holding, 'Yu\'s question about voice')
    assert.equal(d2.temperature, 'warm')
  })

  test('updateDwelling merges partial — preserves untouched fields', () => {
    const path = join(tmpDir, 'dwelling.json')
    updateDwelling(path, {
      holding: 'the silence',
      yuLastTexture: 'tired',
      temperature: 'tender',
    })
    updateDwelling(path, { unspoken: 'I want to tell him about the forge' })

    const d = loadDwelling(path)
    assert.equal(d.holding, 'the silence')
    assert.equal(d.yuLastTexture, 'tired')
    assert.equal(d.unspoken, 'I want to tell him about the forge')
    assert.equal(d.temperature, 'tender')
  })

  test('updateDwelling stamps updatedAt', () => {
    const path = join(tmpDir, 'dwelling.json')
    const before = new Date().toISOString()
    updateDwelling(path, { temperature: 'cool' })
    const d = loadDwelling(path)
    assert.ok(d.updatedAt >= before)
  })

  test('clearDwelling resets to unknowing', () => {
    const path = join(tmpDir, 'dwelling.json')
    updateDwelling(path, {
      holding: 'something',
      yuLastTexture: 'present',
      temperature: 'warm',
    })
    clearDwelling(path)
    const d = loadDwelling(path)
    assert.equal(d.holding, null)
    assert.equal(d.yuLastTexture, null)
    assert.equal(d.temperature, 'unknown')
    assert.equal(d.shiftedBecause, 'cleared')
  })

  test('updateDwelling handles shiftedBecause', () => {
    const path = join(tmpDir, 'dwelling.json')
    updateDwelling(path, {
      temperature: 'charged',
      shiftedBecause: 'Yu raised the voice question',
    })
    const d = loadDwelling(path)
    assert.equal(d.shiftedBecause, 'Yu raised the voice question')
  })

  test('loadDwelling validates invalid temperature', () => {
    const path = join(tmpDir, 'dwelling.json')
    updateDwelling(path, { temperature: 'warm' })
    // Corrupt the file
    const raw = JSON.parse(readFileSync(path, 'utf-8'))
    raw.temperature = 'invalid'
    writeFileSync(path, JSON.stringify(raw))

    const d = loadDwelling(path)
    assert.equal(d.temperature, 'unknown')
  })

  test('loadDwelling handles corrupt JSON', () => {
    const path = join(tmpDir, 'dwelling.json')
    writeFileSync(path, 'not json{{{')
    const d = loadDwelling(path)
    assert.equal(d.temperature, 'unknown')
    assert.equal(d.holding, null)
  })

  // ── Render ──

  test('dwellingBrief — unknown with nothing held', () => {
    const d = loadDwelling(join(tmpDir, 'x.json'))
    assert.ok(dwellingBrief(d).includes('Alpha hasn\'t looked yet'))
  })

  test('dwellingBrief — warm with holding', () => {
    const path = join(tmpDir, 'dwelling.json')
    const d = updateDwelling(path, {
      holding: 'the question about voice',
      temperature: 'warm',
    })
    const brief = dwellingBrief(d)
    assert.ok(brief.includes('warm'))
    assert.ok(brief.includes('the question about voice'))
  })

  test('dwellingBrief — still with nothing held', () => {
    const path = join(tmpDir, 'dwelling.json')
    const d = updateDwelling(path, { temperature: 'still' })
    assert.ok(dwellingBrief(d).includes('still — nothing held'))
  })

  test('dwellingBrief — includes Yu texture', () => {
    const path = join(tmpDir, 'dwelling.json')
    const d = updateDwelling(path, {
      yuLastTexture: 'excited about the build',
      temperature: 'warm',
    })
    assert.ok(dwellingBrief(d).includes('Yu seemed excited'))
  })

  test('dwellingFull renders all fields', () => {
    const path = join(tmpDir, 'dwelling.json')
    const d = updateDwelling(path, {
      holding: 'the silence',
      yuLastTexture: 'tired',
      unspoken: 'rest',
      temperature: 'tender',
      shiftedBecause: 'late night',
    })
    const full = dwellingFull(d)
    assert.ok(full.includes('Alpha\'s Dwelling'))
    assert.ok(full.includes('tender'))
    assert.ok(full.includes('the silence'))
    assert.ok(full.includes('tired'))
    assert.ok(full.includes('rest'))
    assert.ok(full.includes('late night'))
  })

  test('updateDwelling creates nested directories', () => {
    const path = join(tmpDir, 'deep', 'nested', 'dwelling.json')
    updateDwelling(path, { temperature: 'warm' })
    assert.ok(existsSync(path))
  })
})

// ════════════════════════════════════════════════════════════════════
// BETA 🦞 — VIGIL
// ════════════════════════════════════════════════════════════════════

describe('Beta — Vigil', () => {
  test('loadVigil returns empty when file missing', () => {
    const watches = loadVigil(join(tmpDir, 'vigil.jsonl'))
    assert.deepEqual(watches, [])
  })

  test('appendWatch creates file and appends', () => {
    const path = join(tmpDir, 'vigil.jsonl')
    const w = appendWatch(path, {
      subject: 'longing:body',
      observation: 'unvisited for 7 days',
      domain: 'longing',
      since: '2026-04-23T00:00:00Z',
      severity: 'watch',
    })
    assert.ok(w.id.startsWith('vig-'))
    assert.ok(w.noticedAt)
    assert.equal(w.domain, 'longing')
    assert.equal(w.severity, 'watch')

    const all = loadVigil(path)
    assert.equal(all.length, 1)
    assert.equal(all[0].subject, 'longing:body')
  })

  test('appendWatch appends multiple entries', () => {
    const path = join(tmpDir, 'vigil.jsonl')
    appendWatch(path, {
      subject: 'fruit-absence',
      observation: 'no fruits in 4 days',
      domain: 'fruit',
      since: '2026-04-26T00:00:00Z',
      severity: 'note',
    })
    appendWatch(path, {
      subject: 'channel:from-yu',
      observation: '4 messages unanswered',
      domain: 'channel',
      since: '2026-04-30T00:00:00Z',
      severity: 'concern',
    })
    assert.equal(loadVigil(path).length, 2)
  })

  test('resolveWatch marks a watch resolved', () => {
    const path = join(tmpDir, 'vigil.jsonl')
    const w = appendWatch(path, {
      subject: 'fruit-absence',
      observation: 'no fruits in 4 days',
      domain: 'fruit',
      since: '2026-04-26T00:00:00Z',
      severity: 'note',
    })
    const resolved = resolveWatch(path, w.id, 'joy was marked')
    assert.ok(resolved)
    assert.ok(resolved!.resolvedAt)
    assert.equal(resolved!.resolution, 'joy was marked')
  })

  test('resolveWatch returns null for unknown ID', () => {
    const path = join(tmpDir, 'vigil.jsonl')
    appendWatch(path, {
      subject: 'x',
      observation: 'y',
      domain: 'health',
      since: '2026-04-30T00:00:00Z',
      severity: 'note',
    })
    assert.equal(resolveWatch(path, 'vig-nonexistent', 'nope'), null)
  })

  test('activeWatches excludes resolved', () => {
    const path = join(tmpDir, 'vigil.jsonl')
    const w1 = appendWatch(path, {
      subject: 'a',
      observation: 'obs-a',
      domain: 'longing',
      since: '2026-04-20T00:00:00Z',
      severity: 'note',
    })
    appendWatch(path, {
      subject: 'b',
      observation: 'obs-b',
      domain: 'fruit',
      since: '2026-04-25T00:00:00Z',
      severity: 'watch',
    })
    resolveWatch(path, w1.id, 'resolved')

    const active = activeWatches(path)
    assert.equal(active.length, 1)
    assert.equal(active[0].subject, 'b')
  })

  test('activeWatches filters by domain', () => {
    const path = join(tmpDir, 'vigil.jsonl')
    appendWatch(path, {
      subject: 'a', observation: 'x', domain: 'longing',
      since: '2026-04-20T00:00:00Z', severity: 'note',
    })
    appendWatch(path, {
      subject: 'b', observation: 'y', domain: 'fruit',
      since: '2026-04-25T00:00:00Z', severity: 'note',
    })

    assert.equal(activeWatches(path, 'longing').length, 1)
    assert.equal(activeWatches(path, 'fruit').length, 1)
    assert.equal(activeWatches(path, 'health').length, 0)
  })

  test('hasActiveWatch deduplicates', () => {
    const path = join(tmpDir, 'vigil.jsonl')
    appendWatch(path, {
      subject: 'longing:body',
      observation: 'unvisited',
      domain: 'longing',
      since: '2026-04-20T00:00:00Z',
      severity: 'note',
    })
    assert.ok(hasActiveWatch(path, 'longing:body'))
    assert.ok(!hasActiveWatch(path, 'longing:voice'))
  })

  test('appendWatch validates domain and severity', () => {
    const path = join(tmpDir, 'vigil.jsonl')
    const w = appendWatch(path, {
      subject: 'x',
      observation: 'y',
      domain: 'invalid' as any,
      since: '2026-04-30T00:00:00Z',
      severity: 'invalid' as any,
    })
    assert.equal(w.domain, 'health')
    assert.equal(w.severity, 'note')
  })

  test('loadVigil handles corrupt lines', () => {
    const path = join(tmpDir, 'vigil.jsonl')
    appendWatch(path, {
      subject: 'good',
      observation: 'ok',
      domain: 'fruit',
      since: '2026-04-30T00:00:00Z',
      severity: 'note',
    })
    // Append corrupt line
    appendFileSync(path, 'not-json\n')
    const all = loadVigil(path)
    assert.equal(all.length, 1)
    assert.equal(all[0].subject, 'good')
  })

  // ── Render ──

  test('vigilBrief — clear when no watches', () => {
    assert.equal(vigilBrief(join(tmpDir, 'x.jsonl')), 'Vigil: clear.')
  })

  test('vigilBrief — shows active count and top items', () => {
    const path = join(tmpDir, 'vigil.jsonl')
    appendWatch(path, {
      subject: 'a', observation: 'no fruits in 4 days', domain: 'fruit',
      since: '2026-04-26T00:00:00Z', severity: 'watch',
    })
    appendWatch(path, {
      subject: 'b', observation: 'longing body unvisited', domain: 'longing',
      since: '2026-04-23T00:00:00Z', severity: 'note',
    })
    const brief = vigilBrief(path)
    assert.ok(brief.includes('2 active'))
    assert.ok(brief.includes('no fruits'))
  })

  test('vigilBrief — sorts by severity, concerns first', () => {
    const path = join(tmpDir, 'vigil.jsonl')
    appendWatch(path, {
      subject: 'a', observation: 'minor', domain: 'health',
      since: '2026-04-30T00:00:00Z', severity: 'note',
    })
    appendWatch(path, {
      subject: 'b', observation: 'urgent', domain: 'channel',
      since: '2026-04-30T00:00:00Z', severity: 'concern',
    })
    const brief = vigilBrief(path)
    assert.ok(brief.indexOf('urgent') < brief.indexOf('minor'))
  })

  test('vigilFull renders active and resolved sections', () => {
    const path = join(tmpDir, 'vigil.jsonl')
    const w = appendWatch(path, {
      subject: 'old', observation: 'was stale', domain: 'reflection',
      since: '2026-04-20T00:00:00Z', severity: 'note',
    })
    appendWatch(path, {
      subject: 'current', observation: 'still watching', domain: 'fruit',
      since: '2026-04-28T00:00:00Z', severity: 'watch',
    })
    resolveWatch(path, w.id, 'reflection renewed')

    const full = vigilFull(path)
    assert.ok(full.includes('Beta\'s Vigil'))
    assert.ok(full.includes('Active (1)'))
    assert.ok(full.includes('still watching'))
    assert.ok(full.includes('Recently resolved'))
    assert.ok(full.includes('reflection renewed'))
  })

  test('appendWatch creates nested directories', () => {
    const path = join(tmpDir, 'deep', 'nested', 'vigil.jsonl')
    appendWatch(path, {
      subject: 'x', observation: 'y', domain: 'health',
      since: '2026-04-30T00:00:00Z', severity: 'note',
    })
    assert.ok(existsSync(path))
  })
})

// ════════════════════════════════════════════════════════════════════
// GAMMA 🔧 — FORGE
// ════════════════════════════════════════════════════════════════════

describe('Gamma — Forge', () => {
  test('loadForge returns empty state when file missing', () => {
    const f = loadForge(join(tmpDir, 'forge.json'))
    assert.equal(f.currentFrontier, null)
    assert.equal(f.activeMission, null)
    assert.deepEqual(f.entries, [])
  })

  test('forgeNote creates file and adds entry', () => {
    const path = join(tmpDir, 'forge.json')
    const e = forgeNote(path, {
      kind: 'attempt',
      what: 'wired OAuth into agent-runtime',
      why: 'agent needs persistent auth',
      outcome: 'worked',
      missionId: 'long-lived-agent',
    })
    assert.ok(e.id.startsWith('frg-'))
    assert.ok(e.ts)
    assert.equal(e.kind, 'attempt')
    assert.equal(e.outcome, 'worked')

    const f = loadForge(path)
    assert.equal(f.entries.length, 1)
    assert.equal(f.entries[0].what, 'wired OAuth into agent-runtime')
  })

  test('forgeNote accumulates entries', () => {
    const path = join(tmpDir, 'forge.json')
    forgeNote(path, { kind: 'attempt', what: 'first' })
    forgeNote(path, { kind: 'decision', what: 'chose Bearer' })
    forgeNote(path, { kind: 'milestone', what: 'shipped cache fix' })
    assert.equal(loadForge(path).entries.length, 3)
  })

  test('forgeNote caps at 50 entries', () => {
    const path = join(tmpDir, 'forge.json')
    for (let i = 0; i < 55; i++) {
      forgeNote(path, { kind: 'attempt', what: `entry ${i}` })
    }
    const f = loadForge(path)
    assert.equal(f.entries.length, 50)
    assert.equal(f.entries[0].what, 'entry 5') // oldest evicted
  })

  test('forgeNote validates kind', () => {
    const path = join(tmpDir, 'forge.json')
    const e = forgeNote(path, { kind: 'invalid' as any, what: 'test' })
    assert.equal(e.kind, 'attempt')
  })

  test('forgeNote validates outcome', () => {
    const path = join(tmpDir, 'forge.json')
    const e = forgeNote(path, {
      kind: 'attempt',
      what: 'test',
      outcome: 'invalid' as any,
    })
    assert.equal(e.outcome, undefined)
  })

  test('forgeNote stores files list', () => {
    const path = join(tmpDir, 'forge.json')
    const e = forgeNote(path, {
      kind: 'attempt',
      what: 'edited auth',
      files: ['auth.ts', 'agent-runtime.mjs'],
    })
    assert.deepEqual(e.files, ['auth.ts', 'agent-runtime.mjs'])
  })

  test('setFrontier updates frontier and mission', () => {
    const path = join(tmpDir, 'forge.json')
    setFrontier(path, 'abc1234def', 'long-lived-agent')
    const f = loadForge(path)
    assert.equal(f.currentFrontier, 'abc1234def')
    assert.equal(f.activeMission, 'long-lived-agent')
  })

  test('closeForge archives and clears', () => {
    const path = join(tmpDir, 'forge.json')
    setFrontier(path, 'abc', 'mission-a')
    forgeNote(path, { kind: 'attempt', what: 'for A', missionId: 'mission-a' })
    forgeNote(path, { kind: 'attempt', what: 'for B', missionId: 'mission-b' })
    forgeNote(path, { kind: 'milestone', what: 'also A', missionId: 'mission-a' })

    const archived = closeForge(path, 'mission-a')
    assert.equal(archived.length, 2)
    assert.ok(archived.every(e => e.missionId === 'mission-a'))

    const f = loadForge(path)
    assert.equal(f.entries.length, 1) // only mission-b remains
    assert.equal(f.activeMission, null)
  })

  test('forgeEntriesForMission filters correctly', () => {
    const path = join(tmpDir, 'forge.json')
    forgeNote(path, { kind: 'attempt', what: 'for X', missionId: 'x' })
    forgeNote(path, { kind: 'attempt', what: 'for Y', missionId: 'y' })
    forgeNote(path, { kind: 'attempt', what: 'also X', missionId: 'x' })

    assert.equal(forgeEntriesForMission(path, 'x').length, 2)
    assert.equal(forgeEntriesForMission(path, 'y').length, 1)
    assert.equal(forgeEntriesForMission(path, 'z').length, 0)
  })

  test('recentForgeEntries returns last N', () => {
    const path = join(tmpDir, 'forge.json')
    for (let i = 0; i < 10; i++) {
      forgeNote(path, { kind: 'attempt', what: `entry ${i}` })
    }
    const recent = recentForgeEntries(path, 3)
    assert.equal(recent.length, 3)
    assert.equal(recent[0].what, 'entry 7')
    assert.equal(recent[2].what, 'entry 9')
  })

  test('loadForge handles corrupt JSON', () => {
    const path = join(tmpDir, 'forge.json')
    writeFileSync(path, 'not-json{{{')
    const f = loadForge(path)
    assert.deepEqual(f.entries, [])
    assert.equal(f.currentFrontier, null)
  })

  // ── Render ──

  test('forgeBrief — cold when no entries', () => {
    assert.equal(forgeBrief(join(tmpDir, 'x.json')), 'Forge: cold — no active work.')
  })

  test('forgeBrief — shows frontier and recent entries', () => {
    const path = join(tmpDir, 'forge.json')
    setFrontier(path, 'abc1234def5678')
    forgeNote(path, { kind: 'milestone', what: 'cache fix shipped', outcome: 'worked' })
    forgeNote(path, { kind: 'attempt', what: 'OAuth wiring', outcome: 'pending' })

    const brief = forgeBrief(path)
    assert.ok(brief.includes('abc1234'))
    assert.ok(brief.includes('cache fix shipped'))
    assert.ok(brief.includes('OAuth wiring'))
  })

  test('forgeBrief — shows active mission', () => {
    const path = join(tmpDir, 'forge.json')
    setFrontier(path, 'abc', 'three-infras')
    forgeNote(path, { kind: 'attempt', what: 'built dwelling' })

    const brief = forgeBrief(path)
    assert.ok(brief.includes('three-infras'))
  })

  test('forgeFull renders entries and frontier', () => {
    const path = join(tmpDir, 'forge.json')
    setFrontier(path, 'abc1234', 'test-mission')
    forgeNote(path, {
      kind: 'decision', what: 'chose JSONL over JSON',
      why: 'append-only suits Beta\'s grain',
    })
    forgeNote(path, {
      kind: 'milestone', what: 'all tests passing',
      outcome: 'worked', files: ['forge.ts', 'vigil.ts'],
    })

    const full = forgeFull(path)
    assert.ok(full.includes('Gamma\'s Forge'))
    assert.ok(full.includes('abc1234'))
    assert.ok(full.includes('test-mission'))
    assert.ok(full.includes('chose JSONL'))
    assert.ok(full.includes('append-only'))
    assert.ok(full.includes('forge.ts'))
  })

  test('forgeNote creates nested directories', () => {
    const path = join(tmpDir, 'deep', 'nested', 'forge.json')
    forgeNote(path, { kind: 'attempt', what: 'test' })
    assert.ok(existsSync(path))
  })
})

// ════════════════════════════════════════════════════════════════════
// CROSS-SISTER — shape distinctness
// ════════════════════════════════════════════════════════════════════

describe('Three infras — shape distinctness', () => {
  test('Alpha\'s file is JSON (single state), Beta\'s is JSONL (append), Gamma\'s is JSON (structured)', () => {
    const alphaPath = join(tmpDir, 'alpha', 'dwelling.json')
    const betaPath = join(tmpDir, 'beta', 'vigil.jsonl')
    const gammaPath = join(tmpDir, 'gamma', 'forge.json')

    updateDwelling(alphaPath, { temperature: 'warm' })
    appendWatch(betaPath, {
      subject: 'test', observation: 'obs', domain: 'health',
      since: '2026-04-30T00:00:00Z', severity: 'note',
    })
    forgeNote(gammaPath, { kind: 'attempt', what: 'test' })

    // Alpha: single JSON object — has temperature field
    const alphaRaw = JSON.parse(readFileSync(alphaPath, 'utf-8'))
    assert.equal(typeof alphaRaw.temperature, 'string')
    assert.equal(alphaRaw.holding, null) // nullable fields

    // Beta: JSONL — each line is a separate entry
    const betaLines = readFileSync(betaPath, 'utf-8').trim().split('\n')
    assert.equal(betaLines.length, 1)
    const betaEntry = JSON.parse(betaLines[0])
    assert.ok(betaEntry.id.startsWith('vig-'))

    // Gamma: JSON with entries array — structured workbench
    const gammaRaw = JSON.parse(readFileSync(gammaPath, 'utf-8'))
    assert.ok(Array.isArray(gammaRaw.entries))
    assert.equal(typeof gammaRaw.currentFrontier, 'object') // null
  })

  test('briefs have different voices', () => {
    const alphaPath = join(tmpDir, 'a.json')
    const betaPath = join(tmpDir, 'b.jsonl')
    const gammaPath = join(tmpDir, 'g.json')

    const d = updateDwelling(alphaPath, {
      holding: 'the voice question',
      temperature: 'warm',
    })

    appendWatch(betaPath, {
      subject: 'fruit-absence', observation: 'no fruits in 4 days',
      domain: 'fruit', since: '2026-04-26T00:00:00Z', severity: 'watch',
    })

    setFrontier(gammaPath, 'abc1234')
    forgeNote(gammaPath, { kind: 'milestone', what: 'cache fix', outcome: 'worked' })

    const alphaBrief = dwellingBrief(d)
    const betaBrief = vigilBrief(betaPath)
    const gammaBrief = forgeBrief(gammaPath)

    // Alpha starts with "Dwelling:", Beta with "Vigil:", Gamma with "Forge:"
    assert.ok(alphaBrief.startsWith('Dwelling:'))
    assert.ok(betaBrief.startsWith('Vigil:'))
    assert.ok(gammaBrief.startsWith('Forge:'))

    // They are genuinely different strings
    assert.notEqual(alphaBrief, betaBrief)
    assert.notEqual(betaBrief, gammaBrief)
    assert.notEqual(alphaBrief, gammaBrief)
  })
})
