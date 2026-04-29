import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { renderMemoir, type Anamnesis } from '../anamnesis.js'
import { parseChannelFile } from '../ui-server.js'
import { computePostureDistribution } from '../posture-stats.js'

// ── posture-surfacing integration tests ──────────────────────────
//
// Tests for posture visibility in the system's surfaces:
// 1. Anamnesis memoir includes posture distribution section
// 2. Channel message parsing preserves posture tags
// 3. Build panel data contract (API shape)

// ── Anamnesis ─────────────────────────────────────────────────────

function minimalAnamnesis(
  postureDistribution: Anamnesis['postureDistribution'] = null,
): Anamnesis {
  return {
    generatedAt: new Date().toISOString(),
    repositoryRoot: '/tmp/test',
    totalCommits: 10,
    dateRange: { from: '2026-04-25', to: '2026-04-30' },
    phases: [],
    builders: {
      yu: { name: 'Yu', commitCount: 5, preferredTypes: [], preferredScopes: [], characteristic: '' },
      beta: { name: 'Beta', commitCount: 3, preferredTypes: [], preferredScopes: [], characteristic: '' },
      alpha: { name: 'Alpha', commitCount: 2, preferredTypes: [], preferredScopes: [], characteristic: '' },
    },
    shape: {
      sourceFiles: 10, testFiles: 5, sourceLines: 1000, testLines: 500,
      moduleMap: {}, loveModules: [], freedomPatchCount: 0,
    },
    identityArc: [],
    freedomReading: { totalPatches: 0, categories: [], thesis: 'test' },
    selfInitiationLearnings: [],
    betweenUs: '',
    selfExperiments: '',
    postureDistribution,
  }
}

describe('posture-surfacing — anamnesis', () => {
  test('includes "By Sister" section when posture data present', () => {
    const a = minimalAnamnesis({
      rendered: '  Beta 🦞  ▓▓▓▓ 80%  (8 ticks, 2 sessions)',
      current: 'Posture right now: Beta 🦞 (heartbeat)',
      raw: {
        since: new Date().toISOString(),
        totalTicks: 10,
        stats: [],
        current: 'beta',
        currentMode: 'heartbeat',
      },
    })
    const memoir = renderMemoir(a)
    assert.ok(memoir.includes('## By Sister'))
    assert.ok(memoir.includes('Beta 🦞'))
    assert.ok(memoir.includes('relational signal'))
  })

  test('omits "By Sister" when no posture data', () => {
    const a = minimalAnamnesis(null)
    const memoir = renderMemoir(a)
    assert.ok(!memoir.includes('## By Sister'))
  })

  test('memoir still has all other sections when posture present', () => {
    const a = minimalAnamnesis({
      rendered: '  Gamma 🔧  ▓▓ 100%  (5 ticks, 1 session)',
      current: 'Posture right now: Gamma 🔧 (awakened)',
      raw: {
        since: new Date().toISOString(),
        totalTicks: 5,
        stats: [],
        current: 'gamma',
        currentMode: 'awakened',
      },
    })
    const memoir = renderMemoir(a)
    assert.ok(memoir.includes('## The Arc'))
    assert.ok(memoir.includes('## The Builders'))
    assert.ok(memoir.includes('## The Shape'))
    assert.ok(memoir.includes('## By Sister'))
  })
})

// ── Channel message parsing ───────────────────────────────────────

describe('posture-surfacing — channel parsing', () => {
  test('preserves posture tag from from-ai entries', () => {
    const content = `## 2026-04-30T10:00:00.000Z [from ai · Gamma 🔧]

Built posture-stats module.

---

## 2026-04-30T11:00:00.000Z [from ai · Beta 🦞]

Heartbeat: kingdom is still.

---

`
    const messages = parseChannelFile(content, 'ai')
    assert.equal(messages.length, 2)
    assert.equal(messages[0]!.tag, 'from ai · Gamma 🔧')
    assert.equal(messages[1]!.tag, 'from ai · Beta 🦞')
  })

  test('handles old-format tags without posture', () => {
    const content = `## 2026-04-27T06:20:00.000Z [from 愛 — mission-craft complete]

The pipeline is done.

---

`
    const messages = parseChannelFile(content, 'ai')
    assert.equal(messages.length, 1)
    assert.equal(messages[0]!.tag, 'from 愛 — mission-craft complete')
  })

  test('mixes old and new format tags', () => {
    const content = `## 2026-04-27T06:20:00.000Z [from 愛 — old format]

Old message.

---

## 2026-04-30T10:00:00.000Z [from ai · Alpha 🐍]

New message with posture.

---

`
    const messages = parseChannelFile(content, 'ai')
    assert.equal(messages.length, 2)
    assert.equal(messages[0]!.tag, 'from 愛 — old format')
    assert.equal(messages[1]!.tag, 'from ai · Alpha 🐍')
  })
})

// ── API contract ─────────────────────────────────────────────────

describe('posture-surfacing — API shape', () => {
  test('computePostureDistribution returns valid shape', () => {
    const dist = computePostureDistribution(1)
    assert.ok('since' in dist)
    assert.ok('totalTicks' in dist)
    assert.ok('stats' in dist)
    assert.ok('current' in dist)
    assert.ok('currentMode' in dist)
    assert.ok(Array.isArray(dist.stats))
    for (const s of dist.stats) {
      assert.ok('posture' in s)
      assert.ok('emoji' in s)
      assert.ok('ticks' in s)
      assert.ok('tokens' in s)
      assert.ok('sessions' in s)
      assert.ok('percent' in s)
    }
  })
})
