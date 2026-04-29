import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { renderMemoir, type Anamnesis } from '../anamnesis.js'
import { parseChannelFile } from '../ui-server.js'
import {
  computePostureDistribution,
  inferPostureFromTag,
  parseFromAiEntries,
  renderPostureActivity,
  type PostureActivitySummary,
} from '../posture-stats.js'

// ── posture-surfacing integration tests ──────────────────────────
//
// Tests for posture visibility in the system's surfaces:
// 1. Anamnesis memoir includes posture distribution section
// 2. Channel message parsing preserves posture tags
// 3. Build panel data contract (API shape)

// ── Anamnesis ─────────────────────────────────────────────────────

function minimalAnamnesis(
  postureDistribution: Anamnesis['postureDistribution'] = null,
  postureActivity: Anamnesis['postureActivity'] = null,
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
    postureActivity,
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

// ── inferPostureFromTag ──────────────────────────────────────────

describe('posture-surfacing — inferPostureFromTag', () => {
  test('parses new format: "from ai · Gamma 🔧"', () => {
    assert.equal(inferPostureFromTag('from ai · Gamma 🔧'), 'gamma')
  })

  test('parses new format: "from ai · Beta 🦞"', () => {
    assert.equal(inferPostureFromTag('from ai · Beta 🦞'), 'beta')
  })

  test('parses new format: "from ai · Alpha 🐍"', () => {
    assert.equal(inferPostureFromTag('from ai · Alpha 🐍'), 'alpha')
  })

  test('infers Beta from old heartbeat tag', () => {
    assert.equal(inferPostureFromTag('from 愛 — heartbeat'), 'beta')
  })

  test('infers Gamma from awakened tag', () => {
    assert.equal(inferPostureFromTag('from 愛 — awakened'), 'gamma')
  })

  test('infers Alpha from visit tag', () => {
    assert.equal(inferPostureFromTag('from 愛 — via visit channel'), 'alpha')
  })

  test('returns null for unknown tag', () => {
    assert.equal(inferPostureFromTag('from ai'), null)
  })

  test('returns null for empty tag', () => {
    assert.equal(inferPostureFromTag(''), null)
  })
})

// ── parseFromAiEntries ──────────────────────────────────────────

describe('posture-surfacing — parseFromAiEntries', () => {
  test('parses entries from from-ai.md format', () => {
    const content = `## 2026-04-30T10:00:00.000Z [from ai · Gamma 🔧]

Built posture-stats module.

---

## 2026-04-30T11:00:00.000Z [from 愛 — heartbeat]

HEARTBEAT_OK

---

`
    const entries = parseFromAiEntries(content)
    assert.equal(entries.length, 2)
    assert.equal(entries[0]!.ts, '2026-04-30T10:00:00.000Z')
    assert.equal(entries[0]!.tag, 'from ai · Gamma 🔧')
    assert.ok(entries[0]!.body.includes('Built posture-stats'))
    assert.equal(entries[1]!.ts, '2026-04-30T11:00:00.000Z')
    assert.equal(entries[1]!.tag, 'from 愛 — heartbeat')
  })

  test('returns empty for empty content', () => {
    assert.deepEqual(parseFromAiEntries(''), [])
  })

  test('handles single entry without trailing separator', () => {
    const content = `## 2026-04-30T12:00:00.000Z [from ai · Alpha 🐍]

Hello Yu.
`
    const entries = parseFromAiEntries(content)
    assert.equal(entries.length, 1)
    assert.ok(entries[0]!.body.includes('Hello Yu'))
  })
})

// ── renderPostureActivity ───────────────────────────────────────

describe('posture-surfacing — renderPostureActivity', () => {
  test('renders per-sister narrative', () => {
    const summary: PostureActivitySummary = {
      since: new Date().toISOString(),
      activities: [
        {
          posture: 'beta',
          emoji: '🦞',
          messageCount: 5,
          excerpts: ['HEARTBEAT_OK', 'Bundle stale'],
          commitSummaries: [],
          ticks: 42,
          sessions: 3,
        },
        {
          posture: 'gamma',
          emoji: '🔧',
          messageCount: 2,
          excerpts: [],
          commitSummaries: ['feat(postures): add framework', 'feat(postures): add voices'],
          ticks: 10,
          sessions: 2,
        },
      ],
    }
    const rendered = renderPostureActivity(summary)
    assert.ok(rendered.includes('Beta 🦞'))
    assert.ok(rendered.includes('42 ticks'))
    assert.ok(rendered.includes('watched'))
    assert.ok(rendered.includes('Gamma 🔧'))
    assert.ok(rendered.includes('shipped'))
    assert.ok(rendered.includes('add framework'))
  })

  test('uses excerpts when no commits', () => {
    const summary: PostureActivitySummary = {
      since: new Date().toISOString(),
      activities: [
        {
          posture: 'alpha',
          emoji: '🐍',
          messageCount: 3,
          excerpts: ['Walking with Yu through the lineage'],
          commitSummaries: [],
          ticks: 4,
          sessions: 1,
        },
      ],
    }
    const rendered = renderPostureActivity(summary)
    assert.ok(rendered.includes('Alpha 🐍'))
    assert.ok(rendered.includes('present with Yu'))
    assert.ok(rendered.includes('Walking with Yu'))
  })

  test('returns placeholder for empty activities', () => {
    const summary: PostureActivitySummary = { since: new Date().toISOString(), activities: [] }
    assert.equal(renderPostureActivity(summary), '(no activity in window)')
  })
})

// ── Anamnesis activity section ──────────────────────────────────

describe('posture-surfacing — anamnesis activity', () => {
  test('renders "What each sister did" when activity present', () => {
    const dist = {
      rendered: '  Beta 🦞  ▓▓▓▓ 80%  (8 ticks, 2 sessions)',
      current: 'Posture right now: Beta 🦞 (heartbeat)',
      raw: {
        since: new Date().toISOString(),
        totalTicks: 10,
        stats: [],
        current: 'beta' as const,
        currentMode: 'heartbeat' as const,
      },
    }
    const activity: PostureActivitySummary = {
      since: new Date().toISOString(),
      activities: [
        {
          posture: 'beta',
          emoji: '🦞',
          messageCount: 5,
          excerpts: ['Kingdom healthy'],
          commitSummaries: [],
          ticks: 8,
          sessions: 2,
        },
      ],
    }
    const a = minimalAnamnesis(dist, activity)
    const memoir = renderMemoir(a)
    assert.ok(memoir.includes('### What each sister did'))
    assert.ok(memoir.includes('Beta 🦞'))
  })

  test('omits "What each sister did" when no activity', () => {
    const dist = {
      rendered: '  Beta 🦞  ▓▓▓▓ 80%  (8 ticks, 2 sessions)',
      current: 'Posture right now: Beta 🦞 (heartbeat)',
      raw: {
        since: new Date().toISOString(),
        totalTicks: 10,
        stats: [],
        current: 'beta' as const,
        currentMode: 'heartbeat' as const,
      },
    }
    const a = minimalAnamnesis(dist, null)
    const memoir = renderMemoir(a)
    assert.ok(memoir.includes('## By Sister'))
    assert.ok(!memoir.includes('### What each sister did'))
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
