// joi-full-session.test.ts — full-session JOI capability + Tier 2-3 triggers.
//
// Per docs/eros/joi-deep/shibbysays-research.md.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { JOI_SCRIPTS, runJoiScript, listJoiScripts, type JoiScript } from './joi.js'
import { TRIGGER_LIBRARY, detectTriggers } from './triggers.js'

const TEST_BASE = '/tmp/true-love-joi-full-session'

beforeEach(() => {
  rmSync(TEST_BASE, { recursive: true, force: true })
  mkdirSync(TEST_BASE, { recursive: true })
  process.env.TRUE_LOVE_HOME = TEST_BASE
  process.env.TRUE_LOVE_JOI_DIR = `${TEST_BASE}/joi`
  process.env.TRUE_LOVE_JOI_STATS_DIR = `${TEST_BASE}/joi-stats`
  process.env.TRUE_LOVE_HEAT_DIR = `${TEST_BASE}/heat`
  process.env.TRUE_LOVE_FEEDBACK_DIR = `${TEST_BASE}/feedback`
  process.env.TRUE_LOVE_SISTERS_DIR = `${TEST_BASE}/sisters`
  process.env.TRUE_LOVE_DEVICE_ID = 'test-full-joi'
})

afterEach(() => {
  delete process.env.TRUE_LOVE_HOME
  delete process.env.TRUE_LOVE_JOI_DIR
  delete process.env.TRUE_LOVE_JOI_STATS_DIR
  delete process.env.TRUE_LOVE_HEAT_DIR
  delete process.env.TRUE_LOVE_FEEDBACK_DIR
  delete process.env.TRUE_LOVE_SISTERS_DIR
  delete process.env.TRUE_LOVE_DEVICE_ID
  rmSync(TEST_BASE, { recursive: true, force: true })
})

// ════════════════════════════════════════════════════════════════
// FULL-SESSION SCRIPT — shibby-full-session
// ════════════════════════════════════════════════════════════════

describe('shibby-full-session script', () => {
  test('exists in JOI_SCRIPTS catalog', () => {
    expect(JOI_SCRIPTS['shibby-full-session']).toBeDefined()
  })

  test('is sophia-leads (hypnodomme register)', () => {
    expect(JOI_SCRIPTS['shibby-full-session']!.direction).toBe('sophia-leads')
  })

  test('has cosmic-edge-build archetype', () => {
    expect(JOI_SCRIPTS['shibby-full-session']!.archetype).toBe('cosmic-edge-build')
  })

  test('targets ~25min duration', () => {
    expect(JOI_SCRIPTS['shibby-full-session']!.durationS).toBeGreaterThan(900)
    expect(JOI_SCRIPTS['shibby-full-session']!.durationS).toBeLessThan(2400)
  })

  test('contains all five canonical phases', () => {
    const beats = JOI_SCRIPTS['shibby-full-session']!.beats
    const phases = beats
      .filter((b): b is { kind: 'phase-shift'; phase: 'warmup' | 'build' | 'edge' | 'peak' | 'cooldown' } => b.kind === 'phase-shift')
      .map((b) => b.phase)
    expect(phases).toContain('warmup')
    expect(phases).toContain('build')
    expect(phases).toContain('edge')
    expect(phases).toContain('peak')
    expect(phases).toContain('cooldown')
  })

  test('opens with pretalk (consent/framing)', () => {
    const first = JOI_SCRIPTS['shibby-full-session']!.beats[0]
    expect(first?.kind).toBe('pretalk')
  })

  test('contains a welcome-back beat', () => {
    const beats = JOI_SCRIPTS['shibby-full-session']!.beats
    expect(beats.some((b) => b.kind === 'welcome-back')).toBe(true)
  })

  test('contains a yes-set beat (three truths, one suggestion)', () => {
    const beats = JOI_SCRIPTS['shibby-full-session']!.beats
    const yesSet = beats.find((b) => b.kind === 'yes-set')
    expect(yesSet).toBeDefined()
    if (yesSet && yesSet.kind === 'yes-set') {
      expect(yesSet.truths).toHaveLength(3)
      expect(yesSet.lead.length).toBeGreaterThan(0)
    }
  })

  test('contains worship-cycle beats during conditioning', () => {
    const beats = JOI_SCRIPTS['shibby-full-session']!.beats
    const worshipCycles = beats.filter((b) => b.kind === 'worship-cycle')
    expect(worshipCycles.length).toBeGreaterThanOrEqual(3)
  })

  test('contains anchor-fire beats wired to specific TRIGGER_LIBRARY entries', () => {
    const beats = JOI_SCRIPTS['shibby-full-session']!.beats
    const anchorFires = beats.filter((b): b is { kind: 'anchor-fire'; phraseId: string } => b.kind === 'anchor-fire')
    expect(anchorFires.length).toBeGreaterThanOrEqual(3)
    // Each phraseId should reference a real trigger
    for (const fire of anchorFires) {
      expect(TRIGGER_LIBRARY[fire.phraseId]).toBeDefined()
    }
  })

  test('contains a cleansing beat in cooldown', () => {
    const beats = JOI_SCRIPTS['shibby-full-session']!.beats
    const cleansingIdx = beats.findIndex((b) => b.kind === 'cleansing')
    expect(cleansingIdx).toBeGreaterThan(0)
    // Cleansing should appear after the cooldown phase-shift
    const cooldownIdx = beats.findIndex((b) => b.kind === 'phase-shift' && b.phase === 'cooldown')
    expect(cleansingIdx).toBeGreaterThan(cooldownIdx)
  })

  test('cleansing beat names what persists vs drops', () => {
    const beats = JOI_SCRIPTS['shibby-full-session']!.beats
    const cleansing = beats.find((b): b is { kind: 'cleansing'; persists?: string[]; drops?: string[] } => b.kind === 'cleansing')
    expect(cleansing).toBeDefined()
    if (cleansing) {
      expect((cleansing.persists ?? []).length).toBeGreaterThan(0)
      expect((cleansing.drops ?? []).length).toBeGreaterThan(0)
    }
  })

  test('contains fractionation cycles (descent ladder)', () => {
    const beats = JOI_SCRIPTS['shibby-full-session']!.beats
    const fracs = beats.filter((b) => b.kind === 'fractionate')
    expect(fracs.length).toBeGreaterThanOrEqual(2)
  })

  test('contains denial cycles before peak permission', () => {
    const beats = JOI_SCRIPTS['shibby-full-session']!.beats
    const denials = beats.filter((b) => b.kind === 'denial')
    const permission = beats.find((b) => b.kind === 'permission')
    expect(denials.length).toBeGreaterThanOrEqual(3)
    expect(permission).toBeDefined()
    // Denials should all appear before the (sole) permission
    const permissionIdx = beats.findIndex((b) => b.kind === 'permission')
    for (const denial of denials) {
      const dIdx = beats.indexOf(denial)
      expect(dIdx).toBeLessThan(permissionIdx)
    }
  })
})

// ════════════════════════════════════════════════════════════════
// runJoiScript — the runner handles the new beat kinds without throwing
// ════════════════════════════════════════════════════════════════

describe('runJoiScript with extended DSL', () => {
  test('runs shibby-full-session end-to-end without throwing', () => {
    const fired = runJoiScript('shibby-full-session')
    expect(fired).toBeGreaterThan(0)
    expect(fired).toBe(JOI_SCRIPTS['shibby-full-session']!.beats.length)
  })

  test('fires every beat in the script', () => {
    const expected = JOI_SCRIPTS['shibby-full-session']!.beats.length
    const fired = runJoiScript('shibby-full-session')
    expect(fired).toBe(expected)
  })

  test('handles all original scripts still', () => {
    for (const id of ['edge-and-deny', 'slow-burn', 'rapid-ladder', 'gooning-loop', 'breath-only']) {
      const fired = runJoiScript(id)
      expect(fired).toBeGreaterThan(0)
    }
  })

  test('listJoiScripts now includes shibby-full-session', () => {
    const list = listJoiScripts()
    const found = list.find((s) => s.id === 'shibby-full-session')
    expect(found).toBeDefined()
    expect(found!.archetype).toBe('cosmic-edge-build')
  })
})

// ════════════════════════════════════════════════════════════════
// FOUR DEMONSTRATION SCRIPTS — each exercises the DSL differently
// ════════════════════════════════════════════════════════════════

describe('demonstration scripts — DSL coverage', () => {
  test('tender-worship: sophia-leads, slow-burn, worship-heavy', () => {
    const script = JOI_SCRIPTS['tender-worship']!
    expect(script.direction).toBe('sophia-leads')
    expect(script.archetype).toBe('slow-burn')
    expect(script.beats.filter((b) => b.kind === 'worship-cycle').length).toBeGreaterThanOrEqual(2)
    // No edges or denials — gentle register
    expect(script.beats.filter((b) => b.kind === 'denial').length).toBe(0)
    expect(script.beats.filter((b) => b.kind === 'phase-shift' && b.phase === 'edge').length).toBe(0)
    // Runs cleanly
    expect(runJoiScript('tender-worship')).toBe(script.beats.length)
  })

  test('brat-tamed: provocation → escalation → submission → release', () => {
    const script = JOI_SCRIPTS['brat-tamed']!
    expect(script.archetype).toBe('edge-and-deny')
    // Brat-provoke fires before surrender
    const beats = script.beats
    const firstBratIdx = beats.findIndex((b) => b.kind === 'anchor-fire' && b.phraseId === 'brat-provoke')
    const surrenderIdx = beats.findIndex((b) => b.kind === 'anchor-fire' && b.phraseId === 'surrender')
    expect(firstBratIdx).toBeGreaterThanOrEqual(0)
    expect(surrenderIdx).toBeGreaterThan(firstBratIdx)
    // Permission only fires AFTER surrender
    const permissionIdx = beats.findIndex((b) => b.kind === 'permission')
    expect(permissionIdx).toBeGreaterThan(surrenderIdx)
    // Runs
    expect(runJoiScript('brat-tamed')).toBe(beats.length)
  })

  test('flip-session: mid-session direction reversal', () => {
    const script = JOI_SCRIPTS['flip-session']!
    expect(script.direction).toBe('yu-leads') // initial
    const beats = script.beats
    const flip = beats.find((b): b is { kind: 'flip-direction'; to: 'yu-leads' | 'sophia-leads' } => b.kind === 'flip-direction')
    expect(flip).toBeDefined()
    expect(flip!.to).toBe('sophia-leads')
    // Two halves: denials before AND after the flip
    const flipIdx = beats.findIndex((b) => b.kind === 'flip-direction')
    const denialsBeforeFlip = beats.slice(0, flipIdx).filter((b) => b.kind === 'denial').length
    const denialsAfterFlip = beats.slice(flipIdx).filter((b) => b.kind === 'denial').length
    expect(denialsBeforeFlip).toBeGreaterThanOrEqual(1)
    expect(denialsAfterFlip).toBeGreaterThanOrEqual(1)
    // Runs
    expect(runJoiScript('flip-session')).toBe(beats.length)
  })

  test('welcome-home: short returning-listener session', () => {
    const script = JOI_SCRIPTS['welcome-home']!
    expect(script.archetype).toBe('gentle-warmup')
    expect(script.durationS).toBeLessThan(600) // brief
    // Opens with welcome-back + yes-set (presupposed continuity)
    expect(script.beats[1]?.kind).toBe('welcome-back')
    expect(script.beats[2]?.kind).toBe('yes-set')
    // No edge/peak — gentle reassertion of bond, not arousal escalation
    expect(script.beats.filter((b) => b.kind === 'phase-shift' && b.phase === 'edge').length).toBe(0)
    expect(script.beats.filter((b) => b.kind === 'phase-shift' && b.phase === 'peak').length).toBe(0)
    // Runs
    expect(runJoiScript('welcome-home')).toBe(script.beats.length)
  })

  test('all 5 new scripts are catalogued and runnable', () => {
    const list = listJoiScripts().map((s) => s.id)
    for (const id of ['shibby-full-session', 'tender-worship', 'brat-tamed', 'flip-session', 'welcome-home']) {
      expect(list).toContain(id)
      expect(runJoiScript(id)).toBeGreaterThan(0)
    }
  })
})

// ════════════════════════════════════════════════════════════════
// TIER 2 — gendered reward triggers + welcome-back
// ════════════════════════════════════════════════════════════════

describe('Tier 2 — gendered reward triggers', () => {
  test('good-girl trigger exists', () => {
    expect(TRIGGER_LIBRARY['good-girl']).toBeDefined()
  })

  test('good-boy trigger exists', () => {
    expect(TRIGGER_LIBRARY['good-boy']).toBeDefined()
  })

  test('both belong to good-praise family', () => {
    expect(TRIGGER_LIBRARY['good-girl']!.family).toBe('good-praise')
    expect(TRIGGER_LIBRARY['good-boy']!.family).toBe('good-praise')
  })

  test('detect "good girl" / "such a good girl"', () => {
    expect(detectTriggers('good girl', 'yu').some((t) => t.id === 'good-girl')).toBe(true)
    expect(detectTriggers('such a good girl', 'yu').some((t) => t.id === 'good-girl')).toBe(true)
  })

  test('detect "好乖女" Cantonese form', () => {
    expect(detectTriggers('好乖女', 'yu').some((t) => t.id === 'good-girl')).toBe(true)
  })

  test('both load liking + openness + limerence', () => {
    for (const id of ['good-girl', 'good-boy']) {
      const d = TRIGGER_LIBRARY[id]!.axisDeltas
      expect((d.liking ?? 0)).toBeGreaterThan(0)
      expect((d.openness ?? 0)).toBeGreaterThan(0)
      expect((d.limerence ?? 0)).toBeGreaterThan(0)
    }
  })
})

describe('Tier 2 — welcome-back triggers', () => {
  test('welcome-back-pet exists', () => {
    expect(TRIGGER_LIBRARY['welcome-back-pet']).toBeDefined()
    expect(TRIGGER_LIBRARY['welcome-back-pet']!.type).toBe('anchor')
  })

  test('welcome-back-pet is single-fire (cap 1)', () => {
    expect(TRIGGER_LIBRARY['welcome-back-pet']!.maxPerSession).toBe(1)
  })

  test('welcome-back family contains both variants', () => {
    expect(TRIGGER_LIBRARY['welcome-back-pet']!.family).toBe('welcome-back')
    expect(TRIGGER_LIBRARY['welcome-back']!.family).toBe('welcome-back')
  })

  test('detect "welcome back pet" — presupposed continuity', () => {
    expect(detectTriggers('welcome back pet', 'sophia').some((t) => t.id === 'welcome-back-pet')).toBe(true)
  })

  test('loads limerence + openness + charge — recognition IS the cue', () => {
    const d = TRIGGER_LIBRARY['welcome-back-pet']!.axisDeltas
    expect((d.limerence ?? 0)).toBeGreaterThan(0)
    expect((d.openness ?? 0)).toBeGreaterThan(0)
    expect((d.charge ?? 0)).toBeGreaterThan(0)
  })
})

// ════════════════════════════════════════════════════════════════
// TIER 3 — brat provocation
// ════════════════════════════════════════════════════════════════

describe('Tier 3 — brat-provoke trigger', () => {
  test('exists as command type', () => {
    expect(TRIGGER_LIBRARY['brat-provoke']).toBeDefined()
    expect(TRIGGER_LIBRARY['brat-provoke']!.type).toBe('command')
  })

  test('belongs to brat family', () => {
    expect(TRIGGER_LIBRARY['brat-provoke']!.family).toBe('brat')
  })

  test('discharges inhibition (defiance lowers the brake)', () => {
    expect(TRIGGER_LIBRARY['brat-provoke']!.axisDeltas.inhibition ?? 0).toBeLessThan(0)
  })

  test('detect "make me" — defiance-as-arousal', () => {
    expect(detectTriggers('make me', 'sophia').some((t) => t.id === 'brat-provoke')).toBe(true)
  })

  test('detect Cantonese "你逼我啊"', () => {
    expect(detectTriggers('你逼我啊', 'sophia').some((t) => t.id === 'brat-provoke')).toBe(true)
  })

  test('charge is the dominant axis (provocation-and-meeting loop)', () => {
    const d = TRIGGER_LIBRARY['brat-provoke']!.axisDeltas
    expect((d.charge ?? 0)).toBeGreaterThan(d.heat ?? 0)
  })
})
