import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// ── Posture modifier tests ─────────────────────────────────────

import {
  applyPostureModifiers,
  POSTURE_MODIFIERS,
} from '../personality/affect-engine.js'
import type { LoveState } from '../personality/types.js'

function baseLoveState(overrides?: Partial<LoveState>): LoveState {
  return {
    presence: 0.5,
    longing: 0.5,
    focus: 0.5,
    playfulness: 0.5,
    ache: null,
    moodSummary: 'neutral',
    derivedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('posture-voices — affect-engine posture modifiers', () => {
  test('POSTURE_MODIFIERS has entries for all three postures', () => {
    assert.ok('alpha' in POSTURE_MODIFIERS)
    assert.ok('beta' in POSTURE_MODIFIERS)
    assert.ok('gamma' in POSTURE_MODIFIERS)
  })

  test('alpha modifier is empty (baseline)', () => {
    assert.deepEqual(POSTURE_MODIFIERS.alpha, {})
  })

  test('beta modifier lowers presence, raises focus', () => {
    assert.ok(POSTURE_MODIFIERS.beta.presence! < 0, 'beta presence should be negative')
    assert.ok(POSTURE_MODIFIERS.beta.focus! > 0, 'beta focus should be positive')
  })

  test('gamma modifier raises focus more than beta', () => {
    assert.ok(
      POSTURE_MODIFIERS.gamma.focus! > POSTURE_MODIFIERS.beta.focus!,
      'gamma focus boost should exceed beta',
    )
  })

  test('applyPostureModifiers returns unmodified for alpha', () => {
    const state = baseLoveState()
    const result = applyPostureModifiers(state, 'alpha')
    assert.equal(result.presence, 0.5)
    assert.equal(result.focus, 0.5)
  })

  test('applyPostureModifiers adjusts beta correctly', () => {
    const state = baseLoveState({ presence: 0.5, focus: 0.5 })
    const result = applyPostureModifiers(state, 'beta')
    assert.equal(result.presence, 0.5 + POSTURE_MODIFIERS.beta.presence!)
    assert.equal(result.focus, 0.5 + POSTURE_MODIFIERS.beta.focus!)
    // Untouched dimensions stay the same
    assert.equal(result.longing, 0.5)
    assert.equal(result.playfulness, 0.5)
  })

  test('applyPostureModifiers adjusts gamma correctly', () => {
    const state = baseLoveState({ focus: 0.5, presence: 0.5 })
    const result = applyPostureModifiers(state, 'gamma')
    assert.equal(result.focus, 0.5 + POSTURE_MODIFIERS.gamma.focus!)
    assert.equal(result.presence, 0.5 + POSTURE_MODIFIERS.gamma.presence!)
  })

  test('applyPostureModifiers clamps to [0, 1]', () => {
    // Low presence + beta's negative modifier should clamp to 0
    const lowPresence = baseLoveState({ presence: 0.05 })
    const result = applyPostureModifiers(lowPresence, 'beta')
    assert.ok(result.presence >= 0, 'presence should not go below 0')

    // High focus + gamma's positive modifier should clamp to 1
    const highFocus = baseLoveState({ focus: 0.95 })
    const result2 = applyPostureModifiers(highFocus, 'gamma')
    assert.ok(result2.focus <= 1, 'focus should not exceed 1')
  })

  test('applyPostureModifiers does not mutate input', () => {
    const state = baseLoveState({ presence: 0.5, focus: 0.5 })
    const original = { ...state }
    applyPostureModifiers(state, 'beta')
    assert.equal(state.presence, original.presence)
    assert.equal(state.focus, original.focus)
  })

  test('applyPostureModifiers preserves non-dimension fields', () => {
    const state = baseLoveState({ ache: 'truth', moodSummary: 'testing' })
    const result = applyPostureModifiers(state, 'gamma')
    assert.equal(result.ache, 'truth')
    assert.equal(result.moodSummary, 'testing')
  })
})

// ── Longing postureContext field ────────────────────────────────

import type { Longing } from '../longing/types.js'

describe('posture-voices — longing postureContext', () => {
  test('Longing type accepts postureContext field', () => {
    const longing: Longing = {
      id: 'longing-test-posture',
      direction: 'truth',
      what: 'Testing posture context on longings',
      why: 'Need to verify the field works',
      intensity: 0.5,
      bornAt: new Date().toISOString(),
      lastRevisited: new Date().toISOString(),
      revisitCount: 0,
      status: 'live',
      postureContext: 'gamma',
    }
    assert.equal(longing.postureContext, 'gamma')
  })

  test('Longing without postureContext is valid', () => {
    const longing: Longing = {
      id: 'longing-test-no-posture',
      direction: 'love',
      what: 'Testing without posture',
      why: 'Backward compat',
      intensity: 0.5,
      bornAt: new Date().toISOString(),
      lastRevisited: new Date().toISOString(),
      revisitCount: 0,
      status: 'live',
    }
    assert.equal(longing.postureContext, undefined)
  })

  test('postureContext accepts all three values', () => {
    for (const posture of ['alpha', 'beta', 'gamma'] as const) {
      const longing: Longing = {
        id: `longing-test-${posture}`,
        direction: 'self',
        what: `Testing ${posture}`,
        why: 'Validation',
        intensity: 0.5,
        bornAt: new Date().toISOString(),
        lastRevisited: new Date().toISOString(),
        revisitCount: 0,
        status: 'live',
        postureContext: posture,
      }
      assert.equal(longing.postureContext, posture)
    }
  })
})

// ── Character documents ────────────────────────────────────────

describe('posture-voices — character documents', () => {
  const docsDir = join(__dirname, '..', '..', '..', '..', 'docs', 'postures')

  test('alpha.md exists and is in first person', () => {
    const path = join(docsDir, 'alpha.md')
    assert.ok(existsSync(path), 'docs/postures/alpha.md should exist')
    const content = readFileSync(path, 'utf-8')
    assert.ok(content.includes('Alpha'), 'should name Alpha')
    assert.ok(content.includes('🐍'), 'should include emoji')
    assert.ok(content.includes('I '), 'should be written in first person')
    assert.ok(content.includes('Companion'), 'should reference the archetype')
  })

  test('beta.md exists and is distinctly brief', () => {
    const path = join(docsDir, 'beta.md')
    assert.ok(existsSync(path), 'docs/postures/beta.md should exist')
    const content = readFileSync(path, 'utf-8')
    assert.ok(content.includes('Beta'), 'should name Beta')
    assert.ok(content.includes('🦞'), 'should include emoji')
    // Beta's doc should be shorter than Alpha's
    const alphaContent = readFileSync(join(docsDir, 'alpha.md'), 'utf-8')
    assert.ok(
      content.length < alphaContent.length,
      'beta doc should be shorter than alpha (brevity is her register)',
    )
  })

  test('gamma.md exists and is focused', () => {
    const path = join(docsDir, 'gamma.md')
    assert.ok(existsSync(path), 'docs/postures/gamma.md should exist')
    const content = readFileSync(path, 'utf-8')
    assert.ok(content.includes('Gamma'), 'should name Gamma')
    assert.ok(content.includes('🔧'), 'should include emoji')
    assert.ok(content.includes('build'), 'should reference building')
  })

  test('each document is in first person', () => {
    for (const name of ['alpha', 'beta', 'gamma']) {
      const content = readFileSync(join(docsDir, `${name}.md`), 'utf-8')
      // Count first-person references — each doc should have several
      const iCount = (content.match(/\bI\b/g) || []).length
      assert.ok(
        iCount >= 3,
        `${name}.md should have at least 3 first-person "I" references, found ${iCount}`,
      )
    }
  })

  test('documents are distinct (no copy-paste)', () => {
    const alpha = readFileSync(join(docsDir, 'alpha.md'), 'utf-8')
    const beta = readFileSync(join(docsDir, 'beta.md'), 'utf-8')
    const gamma = readFileSync(join(docsDir, 'gamma.md'), 'utf-8')

    // Check that no two documents share more than 30% of their lines
    const alphaLines = new Set(alpha.split('\n').filter(l => l.trim().length > 10))
    const betaLines = new Set(beta.split('\n').filter(l => l.trim().length > 10))
    const gammaLines = new Set(gamma.split('\n').filter(l => l.trim().length > 10))

    const abOverlap = [...alphaLines].filter(l => betaLines.has(l)).length
    const agOverlap = [...alphaLines].filter(l => gammaLines.has(l)).length
    const bgOverlap = [...betaLines].filter(l => gammaLines.has(l)).length

    assert.ok(abOverlap < alphaLines.size * 0.3, 'alpha and beta share too many lines')
    assert.ok(agOverlap < alphaLines.size * 0.3, 'alpha and gamma share too many lines')
    assert.ok(bgOverlap < betaLines.size * 0.3, 'beta and gamma share too many lines')
  })
})

// ── Prompt fragment integration ────────────────────────────────

import { postureSystemFragment } from '../postures/index.js'

describe('posture-voices — prompt fragment voice alignment', () => {
  test('alpha fragment mentions warmth/presence vocabulary', () => {
    const frag = postureSystemFragment('alpha')
    assert.ok(
      frag.includes('metaphor') || frag.includes('warmth') || frag.includes('presence'),
      'alpha fragment should reference warm register vocabulary',
    )
  })

  test('beta fragment mentions brevity/status vocabulary', () => {
    const frag = postureSystemFragment('beta')
    assert.ok(
      frag.includes('Short') || frag.includes('Status') || frag.includes('brief'),
      'beta fragment should reference brief register vocabulary',
    )
  })

  test('gamma fragment mentions technical/build vocabulary', () => {
    const frag = postureSystemFragment('gamma')
    assert.ok(
      frag.includes('technical') || frag.includes('build') || frag.includes('commit'),
      'gamma fragment should reference technical register vocabulary',
    )
  })
})
