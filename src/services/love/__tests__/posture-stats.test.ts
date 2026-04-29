import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  computePostureDistribution,
  renderPostureDistribution,
  renderCurrentPosture,
  type PostureDistribution,
} from '../posture-stats.js'

// ── posture-stats render tests ───────────────────────────────────
//
// computePostureDistribution depends on live budget data (loadUsageSince).
// These tests exercise the pure render functions with constructed data.

describe('posture-stats — renderPostureDistribution', () => {
  test('returns placeholder for empty stats', () => {
    const dist: PostureDistribution = {
      since: new Date().toISOString(),
      totalTicks: 0,
      stats: [],
      current: null,
      currentMode: null,
    }
    assert.equal(renderPostureDistribution(dist), '(no tick data in window)')
  })

  test('formats three postures with bars', () => {
    const dist: PostureDistribution = {
      since: new Date().toISOString(),
      totalTicks: 100,
      stats: [
        { posture: 'beta', emoji: '🦞', ticks: 75, tokens: 50000, sessions: 3, percent: 75 },
        { posture: 'gamma', emoji: '🔧', ticks: 18, tokens: 30000, sessions: 2, percent: 18 },
        { posture: 'alpha', emoji: '🐍', ticks: 7, tokens: 10000, sessions: 1, percent: 7 },
      ],
      current: 'beta',
      currentMode: 'heartbeat',
    }
    const rendered = renderPostureDistribution(dist)
    assert.ok(rendered.includes('Beta 🦞'))
    assert.ok(rendered.includes('Gamma 🔧'))
    assert.ok(rendered.includes('Alpha 🐍'))
    assert.ok(rendered.includes('75%'))
    assert.ok(rendered.includes('18%'))
    assert.ok(rendered.includes('7%'))
    assert.ok(rendered.includes('▓'), 'should contain bar characters')
  })

  test('shows singular "session" for 1', () => {
    const dist: PostureDistribution = {
      since: new Date().toISOString(),
      totalTicks: 10,
      stats: [
        { posture: 'alpha', emoji: '🐍', ticks: 10, tokens: 5000, sessions: 1, percent: 100 },
      ],
      current: 'alpha',
      currentMode: 'interactive',
    }
    const rendered = renderPostureDistribution(dist)
    assert.ok(rendered.includes('1 session'))
    assert.ok(!rendered.includes('1 sessions'))
  })

  test('shows plural "sessions" for >1', () => {
    const dist: PostureDistribution = {
      since: new Date().toISOString(),
      totalTicks: 10,
      stats: [
        { posture: 'beta', emoji: '🦞', ticks: 10, tokens: 5000, sessions: 3, percent: 100 },
      ],
      current: 'beta',
      currentMode: 'heartbeat',
    }
    const rendered = renderPostureDistribution(dist)
    assert.ok(rendered.includes('3 sessions'))
  })

  test('100% gives max bar length (20 chars)', () => {
    const dist: PostureDistribution = {
      since: new Date().toISOString(),
      totalTicks: 100,
      stats: [
        { posture: 'beta', emoji: '🦞', ticks: 100, tokens: 50000, sessions: 1, percent: 100 },
      ],
      current: 'beta',
      currentMode: 'heartbeat',
    }
    const rendered = renderPostureDistribution(dist)
    const barMatch = rendered.match(/▓+/)
    assert.ok(barMatch)
    assert.equal(barMatch![0].length, 20)
  })

  test('small percent gives at least 1 bar char', () => {
    const dist: PostureDistribution = {
      since: new Date().toISOString(),
      totalTicks: 100,
      stats: [
        { posture: 'alpha', emoji: '🐍', ticks: 1, tokens: 100, sessions: 1, percent: 1 },
      ],
      current: 'alpha',
      currentMode: 'interactive',
    }
    const rendered = renderPostureDistribution(dist)
    const barMatch = rendered.match(/▓+/)
    assert.ok(barMatch)
    assert.ok(barMatch![0].length >= 1)
  })
})

describe('posture-stats — renderCurrentPosture', () => {
  test('formats current posture with name and mode', () => {
    const dist: PostureDistribution = {
      since: new Date().toISOString(),
      totalTicks: 10,
      stats: [],
      current: 'gamma',
      currentMode: 'awakened',
    }
    const line = renderCurrentPosture(dist)
    assert.ok(line.includes('Gamma'))
    assert.ok(line.includes('🔧'))
    assert.ok(line.includes('awakened'))
  })

  test('shows unknown when no current', () => {
    const dist: PostureDistribution = {
      since: new Date().toISOString(),
      totalTicks: 0,
      stats: [],
      current: null,
      currentMode: null,
    }
    const line = renderCurrentPosture(dist)
    assert.ok(line.includes('unknown'))
  })
})

describe('posture-stats — computePostureDistribution', () => {
  test('returns correct shape', () => {
    // Short window — may or may not have data, but shape must be correct
    const dist = computePostureDistribution(1)
    assert.ok('since' in dist)
    assert.ok('totalTicks' in dist)
    assert.ok(Array.isArray(dist.stats))
    assert.ok('current' in dist)
    assert.ok('currentMode' in dist)
    assert.equal(typeof dist.totalTicks, 'number')
    for (const s of dist.stats) {
      assert.ok(['alpha', 'beta', 'gamma'].includes(s.posture))
      assert.equal(typeof s.ticks, 'number')
      assert.equal(typeof s.tokens, 'number')
      assert.equal(typeof s.sessions, 'number')
      assert.equal(typeof s.percent, 'number')
    }
  })

  test('stats are sorted by tick count descending', () => {
    const dist = computePostureDistribution(24 * 7) // wider window
    for (let i = 1; i < dist.stats.length; i++) {
      assert.ok(
        dist.stats[i]!.ticks <= dist.stats[i - 1]!.ticks,
        'stats should be sorted by ticks descending',
      )
    }
  })
})

describe('posture-stats — module exports', () => {
  test('exports all expected functions', () => {
    assert.ok(typeof computePostureDistribution === 'function')
    assert.ok(typeof renderPostureDistribution === 'function')
    assert.ok(typeof renderCurrentPosture === 'function')
  })
})
