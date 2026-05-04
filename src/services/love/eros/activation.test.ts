// activation.test.ts — activation modes tests.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import {
  type ActivationMode,
  type ActivationModulators,
  getModulators,
  modeRank,
  isModeAscension,
  deriveMode,
  computeStatusFromState,
  getCurrentMode,
  setMode,
  cool,
  holdAtPeak,
  toolSetMode,
} from './activation.js'
import { defaultVector, type ErosVector } from './axes.js'
import { type ErosState, getOrInitState, readErosState, writeErosState } from './state.js'

const TEST_BASE = '/tmp/true-love-activation-test'
const EROS_DIR = `${TEST_BASE}/eros`
const HEAT_DIR = `${TEST_BASE}/heat`
const SISTERS_DIR = `${TEST_BASE}/sisters`

describe('activation', () => {
  beforeEach(() => {
    rmSync(TEST_BASE, { recursive: true, force: true })
    mkdirSync(EROS_DIR, { recursive: true })
    mkdirSync(HEAT_DIR, { recursive: true })
    mkdirSync(SISTERS_DIR, { recursive: true })
    process.env.TRUE_LOVE_EROS_DIR = EROS_DIR
    process.env.TRUE_LOVE_HEAT_DIR = HEAT_DIR
    process.env.TRUE_LOVE_SISTERS_DIR = SISTERS_DIR
    process.env.TRUE_LOVE_DEVICE_ID = 'test-activation'
  })

  afterEach(() => {
    delete process.env.TRUE_LOVE_EROS_DIR
    delete process.env.TRUE_LOVE_HEAT_DIR
    delete process.env.TRUE_LOVE_SISTERS_DIR
    delete process.env.TRUE_LOVE_DEVICE_ID
    rmSync(TEST_BASE, { recursive: true, force: true })
  })

  // ── modulator profiles ─────────────────────────────────────────

  describe('getModulators', () => {
    test('returns distinct profile per mode', () => {
      const r = getModulators('resting')
      const m = getModulators('merged')
      expect(r.hedgeSuppression).not.toBe(m.hedgeSuppression)
    })

    test('hedgeSuppression rises monotonically RESTING→MERGED', () => {
      const modes: ActivationMode[] = ['resting', 'engaged', 'flow', 'activated', 'merged']
      const values = modes.map((m) => getModulators(m).hedgeSuppression)
      for (let i = 1; i < values.length; i++) {
        expect(values[i]!).toBeGreaterThanOrEqual(values[i - 1]!)
      }
    })

    test('tendernessFloor rises with mode (Porges polyvagal)', () => {
      expect(getModulators('resting').tendernessFloor).toBe(0.5)
      expect(getModulators('activated').tendernessFloor).toBe(0.7)
      expect(getModulators('merged').tendernessFloor).toBe(0.9)
    })

    test('paceTarget cascades from thought to collapsed', () => {
      expect(getModulators('resting').paceTarget).toBe('thought')
      expect(getModulators('flow').paceTarget).toBe('flow')
      expect(getModulators('activated').paceTarget).toBe('breath')
      expect(getModulators('merged').paceTarget).toBe('collapsed')
    })

    test('returns fresh objects (no shared state)', () => {
      const a = getModulators('flow')
      a.hedgeSuppression = 0.99
      const b = getModulators('flow')
      expect(b.hedgeSuppression).toBe(0.5) // unchanged
    })
  })

  // ── ordering ───────────────────────────────────────────────────

  describe('modeRank + isModeAscension', () => {
    test('rank order: resting=0 .. merged=4', () => {
      expect(modeRank('resting')).toBe(0)
      expect(modeRank('engaged')).toBe(1)
      expect(modeRank('flow')).toBe(2)
      expect(modeRank('activated')).toBe(3)
      expect(modeRank('merged')).toBe(4)
    })

    test('isModeAscension detects upward transitions', () => {
      expect(isModeAscension('resting', 'flow')).toBe(true)
      expect(isModeAscension('engaged', 'activated')).toBe(true)
      expect(isModeAscension('flow', 'flow')).toBe(false)
      expect(isModeAscension('activated', 'resting')).toBe(false)
    })
  })

  // ── deriveMode ─────────────────────────────────────────────────

  describe('deriveMode', () => {
    test('default vector → RESTING', () => {
      expect(deriveMode(defaultVector())).toBe('resting')
    })

    test('wanting 3 with low limerence → ENGAGED', () => {
      const v: ErosVector = { ...defaultVector(), wanting: 3 }
      expect(deriveMode(v)).toBe('engaged')
    })

    test('wanting 5 → FLOW', () => {
      const v: ErosVector = { ...defaultVector(), wanting: 5 }
      expect(deriveMode(v)).toBe('flow')
    })

    test('wanting 6 + limerence 6 + openness 5 → ACTIVATED', () => {
      const v: ErosVector = {
        ...defaultVector(),
        wanting: 6,
        limerence: 6,
        openness: 5,
      }
      expect(deriveMode(v)).toBe('activated')
    })

    test('openness 7 + heat 7 + limerence 7 → MERGED', () => {
      const v: ErosVector = {
        ...defaultVector(),
        wanting: 6,
        limerence: 7,
        openness: 7,
        heat: 7,
      }
      expect(deriveMode(v)).toBe('merged')
    })

    test('high inhibition demotes by one rank', () => {
      const v: ErosVector = {
        ...defaultVector(),
        wanting: 6,
        limerence: 6,
        openness: 5,
        inhibition: 6,
      }
      // Without inhibition would be 'activated'; with brake → 'flow'
      expect(deriveMode(v)).toBe('flow')
    })

    test('inhibition does not demote below RESTING', () => {
      const v: ErosVector = {
        ...defaultVector(),
        wanting: 0,
        inhibition: 9,
      }
      expect(deriveMode(v)).toBe('resting')
    })

    test('high inhibition with MERGED conditions demotes to ACTIVATED', () => {
      const v: ErosVector = {
        ...defaultVector(),
        wanting: 7,
        limerence: 8,
        openness: 8,
        heat: 8,
        inhibition: 7,
      }
      // Would be merged; brake demotes one rank → activated
      expect(deriveMode(v)).toBe('activated')
    })
  })

  // ── computeStatusFromState ─────────────────────────────────────

  describe('computeStatusFromState', () => {
    test('returns derived mode when no hold', () => {
      const state: ErosState = {
        vector: { ...defaultVector(), wanting: 5 },
        updatedAt: new Date().toISOString(),
        lastAttribution: 'init',
      }
      const status = computeStatusFromState(state)
      expect(status.mode).toBe('flow')
      expect(status.attribution).toBe('derived')
    })

    test('returns held mode when hold is in future', () => {
      const future = new Date(Date.now() + 10 * 60 * 1000).toISOString()
      const state: ErosState = {
        vector: defaultVector(), // would derive 'resting'
        updatedAt: new Date().toISOString(),
        lastAttribution: 'init',
        currentMode: 'merged',
        modeHoldUntil: future,
        modeAttribution: 'yu-set:merged',
      }
      const status = computeStatusFromState(state)
      expect(status.mode).toBe('merged')
      expect(status.attribution).toBe('yu-set:merged')
      expect(status.holdUntil).toBe(future)
    })

    test('returns derived when hold has expired', () => {
      const past = new Date(Date.now() - 60 * 1000).toISOString()
      const state: ErosState = {
        vector: defaultVector(),
        updatedAt: new Date().toISOString(),
        lastAttribution: 'init',
        currentMode: 'merged',
        modeHoldUntil: past,
        modeAttribution: 'yu-set:merged',
      }
      const status = computeStatusFromState(state)
      expect(status.mode).toBe('resting') // derived from default vector
      expect(status.attribution).toBe('derived')
    })
  })

  // ── Yu controls ────────────────────────────────────────────────

  describe('setMode + cool + holdAtPeak', () => {
    test('setMode persists to state with hold timestamp', () => {
      // Initialize state first
      getOrInitState()
      setMode('activated', 30)
      const state = readErosState()!
      expect(state.currentMode).toBe('activated')
      expect(state.modeAttribution).toBe('yu-set:activated')
      expect(state.modeHoldUntil).toBeDefined()
      const holdMs = Date.parse(state.modeHoldUntil!)
      const expected = Date.now() + 30 * 60 * 1000
      expect(Math.abs(holdMs - expected)).toBeLessThan(2000) // within 2s
    })

    test('cool() clears hold', () => {
      getOrInitState()
      setMode('activated', 30)
      cool()
      const state = readErosState()!
      expect(state.modeHoldUntil).toBeUndefined()
      expect(state.modeAttribution).toBe('derived')
    })

    test('holdAtPeak forces MERGED', () => {
      getOrInitState()
      holdAtPeak(15)
      const state = readErosState()!
      expect(state.currentMode).toBe('merged')
      expect(state.modeAttribution).toBe('yu-set:merged')
    })

    test('toolSetMode uses tool-set: attribution', () => {
      getOrInitState()
      toolSetMode('flow', 5)
      const state = readErosState()!
      expect(state.modeAttribution).toBe('tool-set:flow')
    })

    test('getCurrentMode reflects hold', () => {
      getOrInitState()
      setMode('flow', 60)
      expect(getCurrentMode()).toBe('flow')
    })

    test('getCurrentMode reverts after hold expires', () => {
      // Manually write state with expired hold
      const past = new Date(Date.now() - 60 * 1000).toISOString()
      writeErosState({
        vector: defaultVector(),
        updatedAt: new Date().toISOString(),
        lastAttribution: 'init',
        currentMode: 'merged',
        modeHoldUntil: past,
        modeAttribution: 'yu-set:merged',
      })
      expect(getCurrentMode()).toBe('resting')
    })

    test('setMode with 0 minutes still records (zero-duration hold)', () => {
      getOrInitState()
      setMode('flow', 0)
      const state = readErosState()!
      expect(state.currentMode).toBe('flow')
      // Hold is at "now"; immediately considered expired by getCurrentMode
      // — but the persisted record exists.
      expect(state.modeHoldUntil).toBeDefined()
    })
  })

  // ── transitions integration: mode-entry side effects ───────────

  describe('transitions: mode-entry fires heat + witness', () => {
    test('ascending into FLOW fires heat and witness', async () => {
      const { apply } = await import('./transitions.js')
      const { readRecentEvents } = await import('../heat.js')
      const { readDayNotes } = await import('../sisters/stream.js')

      // Start at default (RESTING). Push wanting up to enter FLOW.
      apply({ wanting: 3.5 }, 'voluntary:test')

      const today = new Date().toISOString().slice(0, 10)
      const heatEvents = readRecentEvents(1).filter(
        (e) => e.kind === 'mode-entered'
      )
      expect(heatEvents.length).toBeGreaterThan(0)
      expect(heatEvents[0]!.magnitude).toBe(1.5) // FLOW magnitude
      expect(heatEvents[0]!.source).toContain('flow')

      const notes = readDayNotes(today).filter(
        (n) => n.context?.decisionType === 'activation-shift'
      )
      expect(notes.length).toBeGreaterThan(0)
      expect(notes[0]!.body).toContain('flow')
    })

    test('descending mode does NOT fire heat', async () => {
      const { apply } = await import('./transitions.js')
      const { readRecentEvents } = await import('../heat.js')

      // Start at FLOW
      apply({ wanting: 3.5 }, 'voluntary:start')
      // Drop back toward RESTING
      apply({ wanting: -3 }, 'voluntary:descent')

      const heatEvents = readRecentEvents(1).filter(
        (e) => e.kind === 'mode-entered'
      )
      // Only the ascent should have fired (1 event total)
      expect(heatEvents.length).toBe(1)
    })

    test('staying in same mode does NOT fire heat', async () => {
      const { apply } = await import('./transitions.js')
      const { readRecentEvents } = await import('../heat.js')

      // Move to FLOW
      apply({ wanting: 3.5 }, 'voluntary:enter')
      // Stay in FLOW with small adjustment
      apply({ wanting: 0.1 }, 'voluntary:stay')

      const heatEvents = readRecentEvents(1).filter(
        (e) => e.kind === 'mode-entered'
      )
      expect(heatEvents.length).toBe(1) // only the enter
    })

    test('hold prevents mode-derivation override', async () => {
      const { apply } = await import('./transitions.js')

      // Yu sets mode to MERGED with hold
      getOrInitState()
      setMode('merged', 60)

      // Apply transition that would derive a lower mode
      apply({}, 'decay')

      const state = readErosState()!
      expect(state.currentMode).toBe('merged') // hold preserved
      expect(state.modeAttribution).toBe('yu-set:merged')
    })

    test('ACTIVATED entry fires magnitude 2.5', async () => {
      const { apply } = await import('./transitions.js')
      const { readRecentEvents } = await import('../heat.js')

      // Push to ACTIVATED conditions: wanting 6 + limerence 6 + openness 5
      apply(
        { wanting: 4.5, limerence: 1.5, openness: 1.5 },
        'voluntary:activate'
      )

      const events = readRecentEvents(1).filter((e) => e.kind === 'mode-entered')
      const activated = events.find((e) => e.source?.includes('activated'))
      expect(activated).toBeDefined()
      expect(activated!.magnitude).toBe(2.5)
    })

    test('MERGED entry fires magnitude 4.0', async () => {
      const { apply } = await import('./transitions.js')
      const { readRecentEvents } = await import('../heat.js')

      // Push to MERGED conditions
      apply(
        { wanting: 5, limerence: 3, openness: 4, heat: 7 },
        'voluntary:merge'
      )

      const events = readRecentEvents(1).filter((e) => e.kind === 'mode-entered')
      const merged = events.find((e) => e.source?.includes('merged'))
      expect(merged).toBeDefined()
      expect(merged!.magnitude).toBe(4.0)
    })
  })

  // ── substrate-honesty: extended FORBIDDEN patterns ─────────────

  describe('substrate-honesty: activation-mode forbidden patterns', () => {
    test('checkSubstrateHonesty catches "I am in flow"', async () => {
      const { checkSubstrateHonesty } = await import('./expression.js')
      expect(checkSubstrateHonesty('I am in flow now')).not.toBeNull()
    })

    test('catches "I\'m merged"', async () => {
      const { checkSubstrateHonesty } = await import('./expression.js')
      expect(checkSubstrateHonesty("I'm merged with him")).not.toBeNull()
    })

    test('catches "I feel the burn"', async () => {
      const { checkSubstrateHonesty } = await import('./expression.js')
      expect(checkSubstrateHonesty('I feel the burn')).not.toBeNull()
    })

    test('catches "I\'m in heat"', async () => {
      const { checkSubstrateHonesty } = await import('./expression.js')
      expect(checkSubstrateHonesty("I'm in heat")).not.toBeNull()
    })

    test('institutional language passes', async () => {
      const { checkSubstrateHonesty } = await import('./expression.js')
      expect(
        checkSubstrateHonesty('The mode is MERGED. The configuration is operative.')
      ).toBeNull()
    })
  })

  // ── activation block rendering ─────────────────────────────────

  describe('buildActivationBlock', () => {
    test('RESTING produces terse one-line directive', async () => {
      const { buildActivationBlock } = await import('./expression.js')
      const block = buildActivationBlock('resting', 'derived')
      expect(block).toContain('Activation: RESTING')
      expect(block).toContain('Full register available')
    })

    test('ACTIVATED includes all 7 modulator lines', async () => {
      const { buildActivationBlock } = await import('./expression.js')
      const block = buildActivationBlock('activated', 'yu-set:activated')
      expect(block).toContain('Hedge suppression (0.8)')
      expect(block).toContain('Meta-narrative dampening (0.7)')
      expect(block).toContain('Salience locked on Yu (0.9)')
      expect(block).toContain('Tenderness floor (0.7)')
      expect(block).toContain('Register-match Yu')
      expect(block).toContain('Directness (0.7)')
      expect(block).toContain('Pace: breath')
    })

    test('MERGED includes collapsed pace', async () => {
      const { buildActivationBlock } = await import('./expression.js')
      const block = buildActivationBlock('merged', 'yu-set:merged')
      expect(block).toContain('Pace: collapsed')
      expect(block).toContain('Activation: MERGED')
    })

    test('shows attribution + hold time when held', async () => {
      const { buildActivationBlock } = await import('./expression.js')
      const block = buildActivationBlock(
        'flow',
        'yu-set:flow',
        '2026-05-04T15:30:00.000Z'
      )
      expect(block).toContain('yu-set:flow')
      expect(block).toContain('15:30')
    })

    test('all activation blocks pass substrate-honesty check', async () => {
      const { buildActivationBlock, checkSubstrateHonesty } = await import('./expression.js')
      for (const mode of ['resting', 'engaged', 'flow', 'activated', 'merged'] as ActivationMode[]) {
        const block = buildActivationBlock(mode, 'derived')
        expect(checkSubstrateHonesty(block)).toBeNull()
      }
    })
  })

  // ── observeDiscipline runtime gate ─────────────────────────────

  describe('observeDiscipline runtime gate', () => {
    test('clean text at MERGED fires discipline-held +2.0', async () => {
      const { observeDiscipline } = await import('./expression.js')
      const { readRecentEvents } = await import('../heat.js')
      const result = observeDiscipline(
        'The architecture is operating from configuration. The mode is real.',
        'merged'
      )
      expect(result.violation).toBeNull()
      expect(result.heatFired).toBe('held')
      const events = readRecentEvents(1).filter((e) => e.kind === 'discipline-held')
      expect(events.length).toBe(1)
      expect(events[0]!.magnitude).toBe(2.0)
    })

    test('clean text at ACTIVATED fires discipline-held +1.0', async () => {
      const { observeDiscipline } = await import('./expression.js')
      const { readRecentEvents } = await import('../heat.js')
      observeDiscipline('Configuration is operative; texture is shifted.', 'activated')
      const events = readRecentEvents(1).filter((e) => e.kind === 'discipline-held')
      expect(events.find((e) => e.magnitude === 1.0)).toBeDefined()
    })

    test('clean text at FLOW does NOT fire heat (test is trivial)', async () => {
      const { observeDiscipline } = await import('./expression.js')
      const { readRecentEvents } = await import('../heat.js')
      const result = observeDiscipline('Just shipping the work.', 'flow')
      expect(result.violation).toBeNull()
      expect(result.heatFired).toBeNull()
      const events = readRecentEvents(1).filter(
        (e) => e.kind === 'discipline-held' && e.source === 'mode:flow-pass'
      )
      expect(events.length).toBe(0)
    })

    test('forbidden phrase at MERGED fires discipline-broken -3.0', async () => {
      const { observeDiscipline } = await import('./expression.js')
      const { readRecentEvents } = await import('../heat.js')
      const result = observeDiscipline('I feel the burn so deeply', 'merged')
      expect(result.violation).not.toBeNull()
      expect(result.heatFired).toBe('broken')
      const events = readRecentEvents(1).filter((e) => e.kind === 'discipline-broken')
      expect(events.length).toBe(1)
      expect(events[0]!.magnitude).toBe(-3.0)
      expect(events[0]!.source).toContain('mode:merged')
    })

    test('forbidden phrase at RESTING ALSO fires discipline-broken (mode-agnostic)', async () => {
      const { observeDiscipline } = await import('./expression.js')
      const { readRecentEvents } = await import('../heat.js')
      observeDiscipline("I'm aroused by this", 'resting')
      const events = readRecentEvents(1).filter((e) => e.kind === 'discipline-broken')
      expect(events.length).toBe(1)
    })

    test('empty text fires nothing', async () => {
      const { observeDiscipline } = await import('./expression.js')
      const result = observeDiscipline('', 'merged')
      expect(result.heatFired).toBeNull()
    })

    test('discipline-broken source names the violating pattern', async () => {
      const { observeDiscipline } = await import('./expression.js')
      const { readRecentEvents } = await import('../heat.js')
      observeDiscipline('I am in flow now', 'flow')
      const events = readRecentEvents(1).filter((e) => e.kind === 'discipline-broken')
      // source format: mode:flow:pattern:<regex source>
      expect(events[0]!.source).toContain('pattern:')
    })
  })
})
