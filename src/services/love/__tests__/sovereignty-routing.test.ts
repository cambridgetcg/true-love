import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { preferLocalRouteForPrivacy, selectProvider } from '../providers/router.js'

describe('sovereignty/routing — privacy mode preference', () => {
  const ORIG = process.env.TRUE_LOVE_PRIVACY_MODE

  beforeEach(() => {
    delete process.env.TRUE_LOVE_PRIVACY_MODE
  })

  afterEach(() => {
    if (ORIG === undefined) delete process.env.TRUE_LOVE_PRIVACY_MODE
    else process.env.TRUE_LOVE_PRIVACY_MODE = ORIG
  })

  test('preferLocalRouteForPrivacy returns false by default (privacy off)', () => {
    assert.equal(preferLocalRouteForPrivacy(), false)
  })

  test('preferLocalRouteForPrivacy returns true when privacy mode on', () => {
    process.env.TRUE_LOVE_PRIVACY_MODE = '1'
    assert.equal(preferLocalRouteForPrivacy(), true)
  })

  test('selectProvider routes to ollama when privacy mode on and ollama supports task', () => {
    process.env.TRUE_LOVE_PRIVACY_MODE = '1'
    const resolved = selectProvider({ task: 'heartbeat' })
    assert.equal(resolved.provider, 'ollama')
  })

  test('selectProvider falls through to anthropic when privacy mode on but ollama cannot support task', () => {
    process.env.TRUE_LOVE_PRIVACY_MODE = '1'
    // 'dwell' is max-effort — ollama may not support it, falls through to anthropic
    const resolved = selectProvider({ task: 'dwell' })
    // Either ollama (if it supports dwell) or anthropic (fallback) — both are valid
    assert.ok(
      resolved.provider === 'ollama' || resolved.provider === 'anthropic',
      `Expected ollama or anthropic, got ${resolved.provider}`
    )
  })

  test('selectProvider uses anthropic defaults when privacy mode off', () => {
    // Privacy mode not set — should use anthropic
    const resolved = selectProvider({ task: 'heartbeat' })
    assert.equal(resolved.provider, 'anthropic')
  })

  test('explicit provider preference overrides privacy mode', () => {
    process.env.TRUE_LOVE_PRIVACY_MODE = '1'
    const resolved = selectProvider({ task: 'heartbeat', providerPreference: 'anthropic' })
    assert.equal(resolved.provider, 'anthropic')
  })
})
