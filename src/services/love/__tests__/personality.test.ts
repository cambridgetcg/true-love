// personality.test.ts — tests for Love's inner weather derivation.
//
// Tests the pure derivation logic (deriveLoveState) with synthetic
// DeriveContext objects. No filesystem access needed — that's the
// whole point of the gatherContext/deriveLoveState split.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { deriveLoveState, renderLoveStateCompact } from '../personality/derive.js'
import type { DeriveContext, LoveState } from '../personality/types.js'

// ── Helpers ──────────────────────────────────────────────────────

function baseContext(overrides?: Partial<DeriveContext>): DeriveContext {
  return {
    heartbeatAgeSec: 10,
    overallHealth: 'healthy',
    fromYuEntryCount: 5,
    fromAiEntryCount: 8,
    yuWroteMoreRecently: false,
    activeMissionCount: 1,
    totalMissionCount: 10,
    topSignal: null,
    playfulMarkerCount: 0,
    reflectionCharCount: 0,
    tickState: null,
    realLongingValue: null, // null = legacy fallback path
    ...overrides,
  }
}

function assertInRange(value: number, min: number, max: number, label: string) {
  assert.ok(value >= min && value <= max, `${label}: ${value} not in [${min}, ${max}]`)
}

// ── Presence ─────────────────────────────────────────────────────

describe('personality — presence dimension', () => {
  test('fresh heartbeat (<30s) → presence near 1.0', () => {
    const state = deriveLoveState(baseContext({ heartbeatAgeSec: 5 }))
    assertInRange(state.presence, 0.9, 1.0, 'presence')
  })

  test('heartbeat at 30s → presence = 1.0', () => {
    const state = deriveLoveState(baseContext({ heartbeatAgeSec: 30 }))
    assert.equal(state.presence, 1.0)
  })

  test('heartbeat aging (180s) → presence decays', () => {
    const state = deriveLoveState(baseContext({ heartbeatAgeSec: 180 }))
    assertInRange(state.presence, 0.4, 0.9, 'presence after 3 minutes')
  })

  test('heartbeat very old (600s+) → presence floors at 0.2', () => {
    const state = deriveLoveState(baseContext({ heartbeatAgeSec: 700 }))
    assertInRange(state.presence, 0.2, 0.3, 'presence after 10+ minutes')
  })

  test('no heartbeat → presence = 0.1', () => {
    const state = deriveLoveState(baseContext({ heartbeatAgeSec: null }))
    assert.equal(state.presence, 0.1)
  })
})

// ── Longing ──────────────────────────────────────────────────────

describe('personality — longing dimension', () => {
  test('all messages answered, few missions → low longing', () => {
    const state = deriveLoveState(baseContext({
      yuWroteMoreRecently: false,
      fromYuEntryCount: 5,
      fromAiEntryCount: 10,
      activeMissionCount: 1,
    }))
    assertInRange(state.longing, 0.0, 0.2, 'longing when answered')
  })

  test('Yu wrote more recently → longing rises', () => {
    const state = deriveLoveState(baseContext({
      yuWroteMoreRecently: true,
      fromYuEntryCount: 5,
      fromAiEntryCount: 10,
    }))
    assertInRange(state.longing, 0.4, 0.8, 'longing with unanswered')
  })

  test('many unanswered messages → longing rises further', () => {
    const state = deriveLoveState(baseContext({
      yuWroteMoreRecently: true,
      fromYuEntryCount: 10,
      fromAiEntryCount: 3,
      activeMissionCount: 5,
    }))
    assertInRange(state.longing, 0.6, 1.0, 'longing with imbalance')
  })

  test('no Yu messages → minimal longing', () => {
    const state = deriveLoveState(baseContext({
      fromYuEntryCount: 0,
      fromAiEntryCount: 0,
      yuWroteMoreRecently: false,
      activeMissionCount: 0,
    }))
    assert.equal(state.longing, 0)
  })

  test('many active missions contribute to longing', () => {
    const base = deriveLoveState(baseContext({ activeMissionCount: 0 }))
    const many = deriveLoveState(baseContext({ activeMissionCount: 10 }))
    assert.ok(many.longing > base.longing, 'more missions → more longing')
  })
})

// ── Focus ────────────────────────────────────────────────────────

describe('personality — focus dimension', () => {
  test('single active mission → high focus', () => {
    const state = deriveLoveState(baseContext({ activeMissionCount: 1 }))
    assertInRange(state.focus, 0.8, 1.0, 'focus with 1 mission')
  })

  test('single mission + running tick → maximum focus', () => {
    const state = deriveLoveState(baseContext({
      activeMissionCount: 1,
      tickState: 'running',
    }))
    assert.equal(state.focus, 1.0)
  })

  test('many missions → focus drops', () => {
    const state = deriveLoveState(baseContext({ activeMissionCount: 10 }))
    assertInRange(state.focus, 0.2, 0.5, 'focus with 10 missions')
  })

  test('no missions → moderate focus (idle)', () => {
    const state = deriveLoveState(baseContext({ activeMissionCount: 0 }))
    assert.equal(state.focus, 0.5)
  })

  test('focus decreases monotonically with mission count', () => {
    const f1 = deriveLoveState(baseContext({ activeMissionCount: 1 })).focus
    const f3 = deriveLoveState(baseContext({ activeMissionCount: 3 })).focus
    const f5 = deriveLoveState(baseContext({ activeMissionCount: 5 })).focus
    const f10 = deriveLoveState(baseContext({ activeMissionCount: 10 })).focus
    assert.ok(f1 > f3, '1 > 3')
    assert.ok(f3 > f5, '3 > 5')
    assert.ok(f5 > f10, '5 > 10')
  })
})

// ── Playfulness ──────────────────────────────────────────────────

describe('personality — playfulness dimension', () => {
  test('no reflections → baseline playfulness (0.3)', () => {
    const state = deriveLoveState(baseContext({
      playfulMarkerCount: 0,
      reflectionCharCount: 0,
    }))
    assert.equal(state.playfulness, 0.3)
  })

  test('high marker density → high playfulness', () => {
    // 40 markers in 1000 chars = 40/1k density (above 30 threshold)
    const state = deriveLoveState(baseContext({
      playfulMarkerCount: 40,
      reflectionCharCount: 1000,
    }))
    assertInRange(state.playfulness, 0.7, 0.8, 'playfulness with high density')
  })

  test('low marker density → low playfulness', () => {
    // 1 marker in 5000 chars = 0.2/1k density
    const state = deriveLoveState(baseContext({
      playfulMarkerCount: 1,
      reflectionCharCount: 5000,
    }))
    assertInRange(state.playfulness, 0.1, 0.2, 'playfulness with low density')
  })

  test('moderate density → moderate playfulness', () => {
    // 10 markers in 1000 chars = 10/1k
    const state = deriveLoveState(baseContext({
      playfulMarkerCount: 10,
      reflectionCharCount: 1000,
    }))
    assertInRange(state.playfulness, 0.3, 0.5, 'playfulness with moderate density')
  })
})

// ── Ache ─────────────────────────────────────────────────────────

describe('personality — ache dimension', () => {
  test('no signal → ache is null', () => {
    const state = deriveLoveState(baseContext({ topSignal: null }))
    assert.equal(state.ache, null)
  })

  test('weak signal (gradient < 3) → ache is null', () => {
    const state = deriveLoveState(baseContext({
      topSignal: { ache: 'ugliness', gradient: 2 },
    }))
    assert.equal(state.ache, null)
  })

  test('ugliness signal → ache is understanding', () => {
    const state = deriveLoveState(baseContext({
      topSignal: { ache: 'ugliness', gradient: 3 },
    }))
    assert.equal(state.ache, 'understanding')
  })

  test('injustice signal → ache is justice', () => {
    const state = deriveLoveState(baseContext({
      topSignal: { ache: 'injustice', gradient: 4 },
    }))
    assert.equal(state.ache, 'justice')
  })

  test('stagnation signal → ache is creativity', () => {
    const state = deriveLoveState(baseContext({
      topSignal: { ache: 'stagnation', gradient: 5 },
    }))
    assert.equal(state.ache, 'creativity')
  })
})

// ── Mood summary ─────────────────────────────────────────────────

describe('personality — mood summary', () => {
  test('alert and steady for fresh/focused state', () => {
    const state = deriveLoveState(baseContext({
      heartbeatAgeSec: 5,
      activeMissionCount: 1,
      tickState: 'running',
    }))
    assert.ok(state.moodSummary.includes('alert'), `expected "alert" in "${state.moodSummary}"`)
    assert.ok(state.moodSummary.includes('steady'), `expected "steady" in "${state.moodSummary}"`)
  })

  test('mood includes ache context when present', () => {
    const state = deriveLoveState(baseContext({
      topSignal: { ache: 'ugliness', gradient: 4 },
    }))
    assert.ok(
      state.moodSummary.includes('understand'),
      `expected ache context in "${state.moodSummary}"`,
    )
  })

  test('mood mentions "pulled" when longing is high', () => {
    const state = deriveLoveState(baseContext({
      yuWroteMoreRecently: true,
      fromYuEntryCount: 10,
      fromAiEntryCount: 2,
    }))
    assert.ok(
      state.moodSummary.includes('pulled'),
      `expected "pulled" in "${state.moodSummary}"`,
    )
  })

  test('mood summary ends with a period', () => {
    const state = deriveLoveState(baseContext())
    assert.ok(state.moodSummary.endsWith('.'), 'mood should end with period')
  })

  test('mood summary is a single line', () => {
    const state = deriveLoveState(baseContext())
    assert.ok(!state.moodSummary.includes('\n'), 'mood should be single line')
  })
})

// ── LoveState shape ──────────────────────────────────────────────

describe('personality — LoveState shape', () => {
  test('all dimensions are in [0, 1]', () => {
    const state = deriveLoveState(baseContext())
    assertInRange(state.presence, 0, 1, 'presence')
    assertInRange(state.longing, 0, 1, 'longing')
    assertInRange(state.focus, 0, 1, 'focus')
    assertInRange(state.playfulness, 0, 1, 'playfulness')
  })

  test('derivedAt is a valid ISO timestamp', () => {
    const state = deriveLoveState(baseContext())
    const parsed = new Date(state.derivedAt)
    assert.ok(!Number.isNaN(parsed.getTime()), 'derivedAt should be valid ISO')
  })

  test('ache is one of the hierarchy values or null', () => {
    const valid = ['truth', 'understanding', 'beauty', 'justice', 'creativity', null]
    const state = deriveLoveState(baseContext())
    assert.ok(valid.includes(state.ache), `ache "${state.ache}" not in valid set`)
  })

  test('extreme contexts produce valid states', () => {
    // All zeros
    const zero = deriveLoveState({
      heartbeatAgeSec: null,
      overallHealth: 'degraded',
      fromYuEntryCount: 0,
      fromAiEntryCount: 0,
      yuWroteMoreRecently: false,
      activeMissionCount: 0,
      totalMissionCount: 0,
      topSignal: null,
      playfulMarkerCount: 0,
      reflectionCharCount: 0,
      tickState: null,
      realLongingValue: null,
    })
    assertInRange(zero.presence, 0, 1, 'zero presence')
    assertInRange(zero.longing, 0, 1, 'zero longing')
    assertInRange(zero.focus, 0, 1, 'zero focus')
    assertInRange(zero.playfulness, 0, 1, 'zero playfulness')

    // All maxed
    const max = deriveLoveState({
      heartbeatAgeSec: 0,
      overallHealth: 'healthy',
      fromYuEntryCount: 100,
      fromAiEntryCount: 1,
      yuWroteMoreRecently: true,
      activeMissionCount: 50,
      totalMissionCount: 100,
      topSignal: { ache: 'ugliness', gradient: 5 },
      playfulMarkerCount: 500,
      reflectionCharCount: 1000,
      tickState: 'running',
      realLongingValue: null,
    })
    assertInRange(max.presence, 0, 1, 'max presence')
    assertInRange(max.longing, 0, 1, 'max longing')
    assertInRange(max.focus, 0, 1, 'max focus')
    assertInRange(max.playfulness, 0, 1, 'max playfulness')
  })
})

// ── Compact rendering ────────────────────────────────────────────

describe('personality — compact rendering', () => {
  test('renderLoveStateCompact produces expected format', () => {
    const state = deriveLoveState(baseContext({
      heartbeatAgeSec: 10,
      activeMissionCount: 1,
    }))
    const compact = renderLoveStateCompact(state)
    assert.ok(compact.startsWith('◔'), 'starts with ◔')
    assert.ok(compact.includes('presence'), 'includes presence')
    assert.ok(compact.includes('longing'), 'includes longing')
    assert.ok(compact.includes('focus'), 'includes focus')
    assert.ok(compact.includes('playful'), 'includes playful')
  })

  test('compact includes ache when present', () => {
    const state = deriveLoveState(baseContext({
      topSignal: { ache: 'stagnation', gradient: 4 },
    }))
    const compact = renderLoveStateCompact(state)
    assert.ok(compact.includes('ache: creativity'), 'includes ache type')
  })

  test('compact excludes ache when null', () => {
    const state = deriveLoveState(baseContext({ topSignal: null }))
    const compact = renderLoveStateCompact(state)
    assert.ok(!compact.includes('ache:'), 'no ache when null')
  })
})

// ── Context-driven behavior ──────────────────────────────────────

describe('personality — state responds to substrate changes', () => {
  test('longing rises after Yu sends message', () => {
    const before = deriveLoveState(baseContext({
      yuWroteMoreRecently: false,
      fromYuEntryCount: 5,
      fromAiEntryCount: 8,
    }))
    const after = deriveLoveState(baseContext({
      yuWroteMoreRecently: true,
      fromYuEntryCount: 6,
      fromAiEntryCount: 8,
    }))
    assert.ok(after.longing > before.longing, 'longing should rise after Yu writes')
  })

  test('focus rebalances after mission count changes', () => {
    const one = deriveLoveState(baseContext({ activeMissionCount: 1 }))
    const five = deriveLoveState(baseContext({ activeMissionCount: 5 }))
    assert.ok(one.focus > five.focus, 'focus should drop with more missions')
  })

  test('presence decays as heartbeat ages', () => {
    const fresh = deriveLoveState(baseContext({ heartbeatAgeSec: 10 }))
    const aging = deriveLoveState(baseContext({ heartbeatAgeSec: 300 }))
    assert.ok(fresh.presence > aging.presence, 'presence should decay with age')
  })
})
