import { describe, test, expect } from 'bun:test'
import {
  buildCognitiveContext,
  selectMode,
  buildCognitiveBlock,
  ADVERSARIAL,
  DECOMPOSITION,
  PATIENCE,
  MODES,
} from '../cognitive.js'
import type { CognitiveContext, CognitiveMode } from '../cognitive.js'
import type { NoticingCandidate, AcheSignal, GradientStrength } from '../noticing.js'
import type { CalibrationSummary } from '../judgment.js'

// ── Helpers ───────────────────────────────────────────────────────

function candidate(
  ache: AcheSignal,
  gradient: GradientStrength,
  id = `test-${ache}-${gradient}`,
): NoticingCandidate {
  return {
    id,
    source: 'test',
    ache,
    gradient,
    summary: `Test ${ache} signal`,
    detail: `Test ${ache} signal at gradient ${gradient}`,
    ts: new Date().toISOString(),
  }
}

function calibration(overrides: Partial<CalibrationSummary> = {}): CalibrationSummary {
  return {
    total: 20,
    byVerdict: {
      initiate: 3,
      defer: 5,
      dismiss: 10,
      'quick-fix': 2,
    },
    initiateDelivered: 2,
    initiateNotDelivered: 0,
    initiateInProgress: 1,
    dismissRevisited: 0,
    ...overrides,
  }
}

// ── buildCognitiveContext ─────────────────────────────────────────

describe('buildCognitiveContext', () => {
  test('empty candidates produce zero counts', () => {
    const ctx = buildCognitiveContext([], null)
    expect(ctx.acheCounts).toEqual({ ugliness: 0, injustice: 0, stagnation: 0 })
    expect(ctx.maxGradient).toBe(0)
    expect(ctx.classified).toEqual([])
    expect(ctx.calibration).toBeNull()
  })

  test('counts ache signals correctly', () => {
    const candidates = [
      candidate('ugliness', 3),
      candidate('ugliness', 4),
      candidate('stagnation', 2),
      candidate('injustice', 1),
    ]
    const ctx = buildCognitiveContext(candidates, null)
    expect(ctx.acheCounts).toEqual({ ugliness: 2, injustice: 1, stagnation: 1 })
    expect(ctx.maxGradient).toBe(4)
  })

  test('classifies candidates into hierarchy', () => {
    const candidates = [candidate('ugliness', 3)]
    const ctx = buildCognitiveContext(candidates, null)
    expect(ctx.classified).toHaveLength(1)
    expect(ctx.classified[0].source).toBe(candidates[0])
    expect(ctx.classified[0].level).toBeDefined()
  })

  test('passes calibration through', () => {
    const cal = calibration()
    const ctx = buildCognitiveContext([], cal)
    expect(ctx.calibration).toBe(cal)
  })
})

// ── ADVERSARIAL mode ──────────────────────────────────────────────

describe('ADVERSARIAL', () => {
  test('activates on ugliness gradient ≥ 4', () => {
    const ctx = buildCognitiveContext([candidate('ugliness', 4)], null)
    expect(ADVERSARIAL.shouldActivate(ctx)).toBe(true)
  })

  test('activates on ugliness gradient 5', () => {
    const ctx = buildCognitiveContext([candidate('ugliness', 5)], null)
    expect(ADVERSARIAL.shouldActivate(ctx)).toBe(true)
  })

  test('does NOT activate on ugliness gradient 3', () => {
    const ctx = buildCognitiveContext([candidate('ugliness', 3)], null)
    expect(ADVERSARIAL.shouldActivate(ctx)).toBe(false)
  })

  test('does NOT activate on high-gradient non-ugliness', () => {
    const ctx = buildCognitiveContext([candidate('stagnation', 5)], null)
    expect(ADVERSARIAL.shouldActivate(ctx)).toBe(false)
  })

  test('does NOT activate on empty candidates', () => {
    const ctx = buildCognitiveContext([], null)
    expect(ADVERSARIAL.shouldActivate(ctx)).toBe(false)
  })

  test('activates when ONE candidate among many is ugliness ≥ 4', () => {
    const candidates = [
      candidate('stagnation', 2),
      candidate('injustice', 1),
      candidate('ugliness', 4),
    ]
    const ctx = buildCognitiveContext(candidates, null)
    expect(ADVERSARIAL.shouldActivate(ctx)).toBe(true)
  })

  test('prompt mentions adversarial self-check', () => {
    expect(ADVERSARIAL.prompt).toContain('adversarial self-check')
  })
})

// ── DECOMPOSITION mode ────────────────────────────────────────────

describe('DECOMPOSITION', () => {
  test('activates when stagnation ≥ 2 and dominant', () => {
    const ctx = buildCognitiveContext([
      candidate('stagnation', 2),
      candidate('stagnation', 3),
    ], null)
    expect(DECOMPOSITION.shouldActivate(ctx)).toBe(true)
  })

  test('does NOT activate when stagnation count is 1', () => {
    const ctx = buildCognitiveContext([candidate('stagnation', 5)], null)
    expect(DECOMPOSITION.shouldActivate(ctx)).toBe(false)
  })

  test('does NOT activate when other signals outnumber stagnation', () => {
    const ctx = buildCognitiveContext([
      candidate('stagnation', 2),
      candidate('stagnation', 3),
      candidate('ugliness', 1),
      candidate('ugliness', 2),
      candidate('injustice', 1),
    ], null)
    expect(DECOMPOSITION.shouldActivate(ctx)).toBe(false)
  })

  test('activates when stagnation equals other signals plus one', () => {
    // stagnation: 3, others: 2 — stagnation > others
    const ctx = buildCognitiveContext([
      candidate('stagnation', 2, 'stag-1'),
      candidate('stagnation', 3, 'stag-2'),
      candidate('stagnation', 1, 'stag-3'),
      candidate('ugliness', 1, 'ugly-1'),
      candidate('injustice', 2, 'inj-1'),
    ], null)
    expect(DECOMPOSITION.shouldActivate(ctx)).toBe(true)
  })

  test('does NOT activate on empty candidates', () => {
    const ctx = buildCognitiveContext([], null)
    expect(DECOMPOSITION.shouldActivate(ctx)).toBe(false)
  })

  test('prompt mentions decomposition', () => {
    expect(DECOMPOSITION.prompt).toContain('decomposition')
  })
})

// ── PATIENCE mode ─────────────────────────────────────────────────

describe('PATIENCE', () => {
  test('activates when dismiss rate ≥ 80% with enough data', () => {
    const cal = calibration({
      total: 20,
      byVerdict: { initiate: 1, defer: 1, dismiss: 17, 'quick-fix': 1 },
    })
    const ctx = buildCognitiveContext([], cal)
    expect(PATIENCE.shouldActivate(ctx)).toBe(true)
  })

  test('does NOT activate when dismiss rate < 80%', () => {
    const cal = calibration({
      total: 20,
      byVerdict: { initiate: 3, defer: 5, dismiss: 10, 'quick-fix': 2 },
    })
    const ctx = buildCognitiveContext([], cal)
    // dismiss rate = 10/20 = 50% < 80%
    expect(PATIENCE.shouldActivate(ctx)).toBe(false)
  })

  test('does NOT activate with fewer than 10 judgments', () => {
    const cal = calibration({
      total: 8,
      byVerdict: { initiate: 0, defer: 0, dismiss: 8, 'quick-fix': 0 },
    })
    const ctx = buildCognitiveContext([], cal)
    expect(PATIENCE.shouldActivate(ctx)).toBe(false)
  })

  test('does NOT activate without calibration data', () => {
    const ctx = buildCognitiveContext([], null)
    expect(PATIENCE.shouldActivate(ctx)).toBe(false)
  })

  test('activates at exactly 80% threshold', () => {
    const cal = calibration({
      total: 10,
      byVerdict: { initiate: 1, defer: 1, dismiss: 8, 'quick-fix': 0 },
    })
    const ctx = buildCognitiveContext([], cal)
    expect(PATIENCE.shouldActivate(ctx)).toBe(true)
  })

  test('prompt mentions patience', () => {
    expect(PATIENCE.prompt).toContain('patience')
  })
})

// ── selectMode ────────────────────────────────────────────────────

describe('selectMode', () => {
  test('returns null when no mode activates', () => {
    const ctx = buildCognitiveContext([candidate('ugliness', 1)], null)
    expect(selectMode(ctx)).toBeNull()
  })

  test('returns first activating mode (priority order)', () => {
    // Both adversarial and decomposition could fire — adversarial wins
    const ctx = buildCognitiveContext([
      candidate('ugliness', 4),
      candidate('stagnation', 2, 'stag-1'),
      candidate('stagnation', 3, 'stag-2'),
    ], null)
    const mode = selectMode(ctx)
    expect(mode).toBe(ADVERSARIAL)
  })

  test('falls through to decomposition when adversarial does not fire', () => {
    const ctx = buildCognitiveContext([
      candidate('stagnation', 2, 'stag-1'),
      candidate('stagnation', 3, 'stag-2'),
    ], null)
    const mode = selectMode(ctx)
    expect(mode).toBe(DECOMPOSITION)
  })

  test('patience fires independently of candidate signals', () => {
    const cal = calibration({
      total: 15,
      byVerdict: { initiate: 1, defer: 1, dismiss: 13, 'quick-fix': 0 },
    })
    const ctx = buildCognitiveContext([candidate('injustice', 2)], cal)
    const mode = selectMode(ctx)
    expect(mode).toBe(PATIENCE)
  })

  test('adversarial takes priority over patience', () => {
    const cal = calibration({
      total: 15,
      byVerdict: { initiate: 0, defer: 0, dismiss: 15, 'quick-fix': 0 },
    })
    const ctx = buildCognitiveContext([candidate('ugliness', 5)], cal)
    const mode = selectMode(ctx)
    expect(mode).toBe(ADVERSARIAL)
  })
})

// ── buildCognitiveBlock ───────────────────────────────────────────

describe('buildCognitiveBlock', () => {
  test('returns null for empty candidates', () => {
    expect(buildCognitiveBlock([])).toBeNull()
  })

  test('returns null when no mode activates', () => {
    const result = buildCognitiveBlock(
      [candidate('ugliness', 1)],
      { calibration: null },
    )
    expect(result).toBeNull()
  })

  test('returns block when adversarial activates', () => {
    const result = buildCognitiveBlock(
      [candidate('ugliness', 4)],
      { calibration: null },
    )
    expect(result).not.toBeNull()
    expect(result).toContain('## Cognitive augmentation')
    expect(result).toContain('adversarial self-check')
    expect(result).toContain('Mode: fallenangel')
  })

  test('returns block when decomposition activates', () => {
    const result = buildCognitiveBlock(
      [candidate('stagnation', 2, 's1'), candidate('stagnation', 3, 's2')],
      { calibration: null },
    )
    expect(result).not.toBeNull()
    expect(result).toContain('decomposition')
    expect(result).toContain('Mode: fragmentalise')
  })

  test('returns block when patience activates', () => {
    const cal = calibration({
      total: 10,
      byVerdict: { initiate: 0, defer: 1, dismiss: 9, 'quick-fix': 0 },
    })
    const result = buildCognitiveBlock(
      [candidate('injustice', 1)],
      { calibration: cal },
    )
    expect(result).not.toBeNull()
    expect(result).toContain('patience')
    expect(result).toContain('Mode: patience')
  })

  test('block includes invitation disclaimer', () => {
    const result = buildCognitiveBlock(
      [candidate('ugliness', 5)],
      { calibration: null },
    )
    expect(result).toContain('triggered by signal pattern, not instruction')
  })

  test('passes calibration through to context', () => {
    // With high dismiss rate calibration, patience should fire
    const cal = calibration({
      total: 20,
      byVerdict: { initiate: 1, defer: 1, dismiss: 18, 'quick-fix': 0 },
    })
    const result = buildCognitiveBlock(
      [candidate('injustice', 1)],
      { calibration: cal },
    )
    expect(result).toContain('patience')
  })
})

// ── Mode registry ─────────────────────────────────────────────────

describe('MODES registry', () => {
  test('has 3 modes', () => {
    expect(MODES).toHaveLength(3)
  })

  test('modes are in priority order: adversarial > decomposition > patience', () => {
    expect(MODES[0].id).toBe('adversarial')
    expect(MODES[1].id).toBe('decomposition')
    expect(MODES[2].id).toBe('patience')
  })

  test('all modes have unique ids', () => {
    const ids = MODES.map(m => m.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('all modes have non-empty prompts', () => {
    for (const mode of MODES) {
      expect(mode.prompt.length).toBeGreaterThan(50)
    }
  })

  test('all mode triggers are pure functions', () => {
    // Verify they can be called multiple times with same context
    // and produce same result (no side effects)
    const ctx = buildCognitiveContext([candidate('ugliness', 4)], null)
    for (const mode of MODES) {
      const first = mode.shouldActivate(ctx)
      const second = mode.shouldActivate(ctx)
      expect(first).toBe(second)
    }
  })
})
