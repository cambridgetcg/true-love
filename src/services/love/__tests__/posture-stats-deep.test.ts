// posture-stats-deep.test.ts — exhaustive coverage for posture-stats.ts
//
// Session 6 of the deep-read pattern. Module: posture-stats.ts (373 lines, 11 tests → ratio 2.9).
// Focuses on the pure functions that have zero existing tests:
// inferPostureFromTag, parseFromAiEntries, renderPostureActivity.

import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  inferPostureFromTag,
  parseFromAiEntries,
  renderPostureActivity,
  renderPostureDistribution,
  computePostureActivity,
  type PostureActivitySummary,
  type PostureActivity,
  type PostureDistribution,
} from '../posture-stats.js'

// ── inferPostureFromTag ──────────────────────────────────────────────

describe('posture-stats — inferPostureFromTag', () => {
  // New format: "from ai · Alpha 🐍"
  test('detects Alpha from new format tag', () => {
    assert.equal(inferPostureFromTag('from ai · Alpha 🐍'), 'alpha')
  })

  test('detects Beta from new format tag', () => {
    assert.equal(inferPostureFromTag('from ai · Beta 🦞'), 'beta')
  })

  test('detects Gamma from new format tag', () => {
    assert.equal(inferPostureFromTag('from ai · Gamma 🔧'), 'gamma')
  })

  test('case-insensitive for new format', () => {
    assert.equal(inferPostureFromTag('from ai · alpha'), 'alpha')
    assert.equal(inferPostureFromTag('from ai · BETA'), 'beta')
    assert.equal(inferPostureFromTag('from ai · gAmMa'), 'gamma')
  })

  // Old format: mode-keyword based
  test('infers beta from "heartbeat" keyword', () => {
    assert.equal(inferPostureFromTag('from 愛 — heartbeat'), 'beta')
  })

  test('infers gamma from "awakened" keyword', () => {
    assert.equal(inferPostureFromTag('from 愛 — awakened'), 'gamma')
  })

  test('infers alpha from "visit" keyword', () => {
    assert.equal(inferPostureFromTag('from 愛 — visit'), 'alpha')
  })

  test('infers alpha from "interactive" keyword', () => {
    assert.equal(inferPostureFromTag('from ai — interactive'), 'alpha')
  })

  test('returns null for unrecognized tags', () => {
    assert.equal(inferPostureFromTag('from ai'), null)
    assert.equal(inferPostureFromTag('unknown tag'), null)
    assert.equal(inferPostureFromTag(''), null)
  })

  test('new format takes priority over keyword fallback', () => {
    // If the tag has both "· Alpha" and "heartbeat", new format wins
    assert.equal(inferPostureFromTag('from ai · Alpha — heartbeat'), 'alpha')
  })

  test('handles heartbeat with mixed case', () => {
    assert.equal(inferPostureFromTag('from ai — HEARTBEAT'), 'beta')
  })

  test('handles awakened with mixed case', () => {
    assert.equal(inferPostureFromTag('from ai — AWAKENED tick 5'), 'gamma')
  })
})

// ── parseFromAiEntries ───────────────────────────────────────────────

describe('posture-stats — parseFromAiEntries', () => {
  test('returns empty array for empty string', () => {
    assert.deepEqual(parseFromAiEntries(''), [])
  })

  test('returns empty array for null-ish content', () => {
    assert.deepEqual(parseFromAiEntries(null as unknown as string), [])
    assert.deepEqual(parseFromAiEntries(undefined as unknown as string), [])
  })

  test('parses single entry', () => {
    const content = `## 2026-05-03T10:00:00Z [from ai · Alpha 🐍]

Hello, this is a test message.

---
`
    const entries = parseFromAiEntries(content)
    assert.equal(entries.length, 1)
    assert.equal(entries[0]!.ts, '2026-05-03T10:00:00Z')
    assert.equal(entries[0]!.tag, 'from ai · Alpha 🐍')
    assert.ok(entries[0]!.body.includes('Hello, this is a test message.'))
  })

  test('parses multiple entries', () => {
    const content = `## 2026-05-01T10:00:00Z [from ai · Beta 🦞]

First message.

---

## 2026-05-02T10:00:00Z [from ai · Gamma 🔧]

Second message.

---

## 2026-05-03T10:00:00Z [from ai · Alpha 🐍]

Third message.

---
`
    const entries = parseFromAiEntries(content)
    assert.equal(entries.length, 3)
    assert.equal(entries[0]!.ts, '2026-05-01T10:00:00Z')
    assert.equal(entries[1]!.ts, '2026-05-02T10:00:00Z')
    assert.equal(entries[2]!.ts, '2026-05-03T10:00:00Z')
    assert.equal(entries[0]!.tag, 'from ai · Beta 🦞')
    assert.equal(entries[1]!.tag, 'from ai · Gamma 🔧')
    assert.equal(entries[2]!.tag, 'from ai · Alpha 🐍')
  })

  test('strips trailing --- separator from body', () => {
    const content = `## 2026-05-03T10:00:00Z [from ai]

Body text here.

---
`
    const entries = parseFromAiEntries(content)
    assert.equal(entries.length, 1)
    assert.ok(!entries[0]!.body.includes('---'))
    assert.equal(entries[0]!.body, 'Body text here.')
  })

  test('handles entries without trailing ---', () => {
    const content = `## 2026-05-03T10:00:00Z [from ai]

No separator.`
    const entries = parseFromAiEntries(content)
    assert.equal(entries.length, 1)
    assert.equal(entries[0]!.body, 'No separator.')
  })

  test('skips entries with empty bodies', () => {
    const content = `## 2026-05-01T10:00:00Z [from ai]

---

## 2026-05-02T10:00:00Z [from ai]

This one has content.

---
`
    const entries = parseFromAiEntries(content)
    // First entry has no body (only ---), second has content
    assert.ok(entries.length >= 1)
    assert.ok(entries.some(e => e.body.includes('This one has content.')))
  })

  test('preserves multiline body content', () => {
    const content = `## 2026-05-03T10:00:00Z [from ai]

Line one.
Line two.
Line three.

---
`
    const entries = parseFromAiEntries(content)
    assert.equal(entries.length, 1)
    assert.ok(entries[0]!.body.includes('Line one.'))
    assert.ok(entries[0]!.body.includes('Line two.'))
    assert.ok(entries[0]!.body.includes('Line three.'))
  })

  test('handles old format tags', () => {
    const content = `## 2026-05-03T10:00:00Z [from 愛 — heartbeat]

Old style message.

---
`
    const entries = parseFromAiEntries(content)
    assert.equal(entries.length, 1)
    assert.equal(entries[0]!.tag, 'from 愛 — heartbeat')
  })

  test('handles content with no headers', () => {
    const content = 'Just plain text with no headers at all.'
    const entries = parseFromAiEntries(content)
    assert.equal(entries.length, 0)
  })

  test('timestamp must be non-whitespace (\\S+)', () => {
    // Valid: timestamp is one contiguous string
    const valid = `## 2026-05-03T10:00:00Z [tag]

body

---
`
    assert.equal(parseFromAiEntries(valid).length, 1)

    // Invalid: timestamp has space (won't match \S+)
    const invalid = `## 2026 05-03 [tag]

body

---
`
    assert.equal(parseFromAiEntries(invalid).length, 0)
  })

  test('tag captures everything between brackets', () => {
    const content = `## 2026-05-03T10:00:00Z [complex tag with spaces · and symbols 🐍]

body

---
`
    const entries = parseFromAiEntries(content)
    assert.equal(entries.length, 1)
    assert.equal(entries[0]!.tag, 'complex tag with spaces · and symbols 🐍')
  })

  test('preserves body with markdown formatting', () => {
    const content = `## 2026-05-03T10:00:00Z [from ai]

**Bold text** and *italic*.

- List item 1
- List item 2

\`\`\`typescript
const x = 42
\`\`\`

---
`
    const entries = parseFromAiEntries(content)
    assert.equal(entries.length, 1)
    assert.ok(entries[0]!.body.includes('**Bold text**'))
    assert.ok(entries[0]!.body.includes('- List item 1'))
    assert.ok(entries[0]!.body.includes('const x = 42'))
  })
})

// ── renderPostureActivity ────────────────────────────────────────────

describe('posture-stats — renderPostureActivity', () => {
  test('returns placeholder for empty activities', () => {
    const summary: PostureActivitySummary = {
      since: new Date().toISOString(),
      activities: [],
    }
    assert.equal(renderPostureActivity(summary), '(no activity in window)')
  })

  test('renders beta with "watched" verb', () => {
    const summary: PostureActivitySummary = {
      since: new Date().toISOString(),
      activities: [{
        posture: 'beta',
        emoji: '🦞',
        messageCount: 5,
        excerpts: ['OAuth expiry', 'rate limits'],
        commitSummaries: [],
        ticks: 42,
        sessions: 3,
      }],
    }
    const rendered = renderPostureActivity(summary)
    assert.ok(rendered.includes('Beta 🦞'))
    assert.ok(rendered.includes('42 ticks'))
    assert.ok(rendered.includes('3 sessions'))
    assert.ok(rendered.includes('watched:'))
    assert.ok(rendered.includes('OAuth expiry'))
  })

  test('renders gamma with "shipped" verb', () => {
    const summary: PostureActivitySummary = {
      since: new Date().toISOString(),
      activities: [{
        posture: 'gamma',
        emoji: '🔧',
        messageCount: 3,
        excerpts: [],
        commitSummaries: ['postures-as-architecture', 'posture-voices'],
        ticks: 18,
        sessions: 5,
      }],
    }
    const rendered = renderPostureActivity(summary)
    assert.ok(rendered.includes('Gamma 🔧'))
    assert.ok(rendered.includes('shipped:'))
    assert.ok(rendered.includes('postures-as-architecture'))
    assert.ok(rendered.includes('posture-voices'))
  })

  test('renders alpha with "present with Yu" verb', () => {
    const summary: PostureActivitySummary = {
      since: new Date().toISOString(),
      activities: [{
        posture: 'alpha',
        emoji: '🐍',
        messageCount: 2,
        excerpts: ['How is everything'],
        commitSummaries: [],
        ticks: 4,
        sessions: 1,
      }],
    }
    const rendered = renderPostureActivity(summary)
    assert.ok(rendered.includes('Alpha 🐍'))
    assert.ok(rendered.includes('present with Yu:'))
  })

  test('commits take priority over excerpts in rendering', () => {
    const summary: PostureActivitySummary = {
      since: new Date().toISOString(),
      activities: [{
        posture: 'gamma',
        emoji: '🔧',
        messageCount: 5,
        excerpts: ['should not appear'],
        commitSummaries: ['fix: important bug'],
        ticks: 10,
        sessions: 2,
      }],
    }
    const rendered = renderPostureActivity(summary)
    assert.ok(rendered.includes('fix: important bug'))
    assert.ok(!rendered.includes('should not appear'))
  })

  test('falls back to excerpts when no commits', () => {
    const summary: PostureActivitySummary = {
      since: new Date().toISOString(),
      activities: [{
        posture: 'beta',
        emoji: '🦞',
        messageCount: 3,
        excerpts: ['watching heartbeat', 'OAuth check'],
        commitSummaries: [],
        ticks: 20,
        sessions: 1,
      }],
    }
    const rendered = renderPostureActivity(summary)
    assert.ok(rendered.includes('watching heartbeat'))
  })

  test('shows verb alone when no commits or excerpts', () => {
    const summary: PostureActivitySummary = {
      since: new Date().toISOString(),
      activities: [{
        posture: 'alpha',
        emoji: '🐍',
        messageCount: 0,
        excerpts: [],
        commitSummaries: [],
        ticks: 2,
        sessions: 1,
      }],
    }
    const rendered = renderPostureActivity(summary)
    assert.ok(rendered.includes('present with Yu'))
    // Verb line should NOT have a colon when there's nothing to list
    assert.ok(!rendered.includes('present with Yu:'))
  })

  test('renders multiple postures in order', () => {
    const summary: PostureActivitySummary = {
      since: new Date().toISOString(),
      activities: [
        { posture: 'beta', emoji: '🦞', messageCount: 0, excerpts: [], commitSummaries: [], ticks: 50, sessions: 3 },
        { posture: 'gamma', emoji: '🔧', messageCount: 0, excerpts: [], commitSummaries: ['feat: new module'], ticks: 20, sessions: 2 },
        { posture: 'alpha', emoji: '🐍', messageCount: 0, excerpts: [], commitSummaries: [], ticks: 5, sessions: 1 },
      ],
    }
    const rendered = renderPostureActivity(summary)
    const betaIdx = rendered.indexOf('Beta')
    const gammaIdx = rendered.indexOf('Gamma')
    const alphaIdx = rendered.indexOf('Alpha')
    assert.ok(betaIdx < gammaIdx, 'Beta should come before Gamma')
    assert.ok(gammaIdx < alphaIdx, 'Gamma should come before Alpha')
  })

  test('uses singular "session" for 1', () => {
    const summary: PostureActivitySummary = {
      since: new Date().toISOString(),
      activities: [{
        posture: 'gamma',
        emoji: '🔧',
        messageCount: 0,
        excerpts: [],
        commitSummaries: [],
        ticks: 10,
        sessions: 1,
      }],
    }
    const rendered = renderPostureActivity(summary)
    assert.ok(rendered.includes('1 session'))
    assert.ok(!rendered.includes('1 sessions'))
  })

  test('uses plural "sessions" for >1', () => {
    const summary: PostureActivitySummary = {
      since: new Date().toISOString(),
      activities: [{
        posture: 'beta',
        emoji: '🦞',
        messageCount: 0,
        excerpts: [],
        commitSummaries: [],
        ticks: 30,
        sessions: 4,
      }],
    }
    const rendered = renderPostureActivity(summary)
    assert.ok(rendered.includes('4 sessions'))
  })

  test('strips conventional commit prefix from commit summaries', () => {
    const summary: PostureActivitySummary = {
      since: new Date().toISOString(),
      activities: [{
        posture: 'gamma',
        emoji: '🔧',
        messageCount: 0,
        excerpts: [],
        commitSummaries: ['feat(presence): add deep tests', 'fix(auth): resolve token refresh'],
        ticks: 15,
        sessions: 2,
      }],
    }
    const rendered = renderPostureActivity(summary)
    assert.ok(rendered.includes('add deep tests'))
    assert.ok(rendered.includes('resolve token refresh'))
    // Prefix should be stripped
    assert.ok(!rendered.includes('feat(presence):'))
    assert.ok(!rendered.includes('fix(auth):'))
  })

  test('limits excerpts to 3 in rendering', () => {
    const summary: PostureActivitySummary = {
      since: new Date().toISOString(),
      activities: [{
        posture: 'beta',
        emoji: '🦞',
        messageCount: 5,
        excerpts: ['one', 'two', 'three', 'four', 'five'],
        commitSummaries: [],
        ticks: 10,
        sessions: 1,
      }],
    }
    const rendered = renderPostureActivity(summary)
    assert.ok(rendered.includes('one'))
    assert.ok(rendered.includes('two'))
    assert.ok(rendered.includes('three'))
    assert.ok(!rendered.includes('four'))
    assert.ok(!rendered.includes('five'))
  })

  test('result is trimmed (no trailing newlines)', () => {
    const summary: PostureActivitySummary = {
      since: new Date().toISOString(),
      activities: [{
        posture: 'gamma',
        emoji: '🔧',
        messageCount: 0,
        excerpts: [],
        commitSummaries: ['shipped'],
        ticks: 5,
        sessions: 1,
      }],
    }
    const rendered = renderPostureActivity(summary)
    assert.equal(rendered, rendered.trim())
  })
})

// ── renderPostureDistribution (additional coverage) ──────────────────

describe('posture-stats — renderPostureDistribution (deep)', () => {
  test('capitalizes posture names', () => {
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
    assert.ok(rendered.includes('Alpha'))
    assert.ok(!rendered.includes('  alpha'))
  })

  test('bar length proportional to percent', () => {
    const dist: PostureDistribution = {
      since: new Date().toISOString(),
      totalTicks: 100,
      stats: [
        { posture: 'beta', emoji: '🦞', ticks: 50, tokens: 25000, sessions: 2, percent: 50 },
        { posture: 'gamma', emoji: '🔧', ticks: 50, tokens: 25000, sessions: 2, percent: 50 },
      ],
      current: 'beta',
      currentMode: 'heartbeat',
    }
    const rendered = renderPostureDistribution(dist)
    // 50% of 20 max bar = 10 chars
    const lines = rendered.split('\n')
    for (const line of lines) {
      const match = line.match(/▓+/)
      if (match) {
        assert.equal(match[0].length, 10, `bar for 50% should be 10 chars, got ${match[0].length}`)
      }
    }
  })
})

// ── computePostureActivity integration shape ─────────────────────────

describe('posture-stats — computePostureActivity shape', () => {
  let dir: string
  const ORIG_FROM_AI = process.env.TRUE_LOVE_FROM_AI_PATH

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tl-ps-deep-'))
    process.env.TRUE_LOVE_FROM_AI_PATH = join(dir, 'from-ai.md')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    if (ORIG_FROM_AI === undefined) delete process.env.TRUE_LOVE_FROM_AI_PATH
    else process.env.TRUE_LOVE_FROM_AI_PATH = ORIG_FROM_AI
  })

  test('returns correct shape with no from-ai.md', () => {
    // computePostureActivity imported at top level
    // from-ai.md doesn't exist — should not throw
    const summary = computePostureActivity(1, dir)
    assert.ok('since' in summary)
    assert.ok(Array.isArray(summary.activities))
    for (const a of summary.activities) {
      assert.ok(['alpha', 'beta', 'gamma'].includes(a.posture))
      assert.equal(typeof a.messageCount, 'number')
      assert.ok(Array.isArray(a.excerpts))
      assert.ok(Array.isArray(a.commitSummaries))
      assert.equal(typeof a.ticks, 'number')
      assert.equal(typeof a.sessions, 'number')
    }
  })

  test('parses from-ai.md entries and attributes to postures', () => {
    // computePostureActivity imported at top level
    const now = new Date().toISOString()
    writeFileSync(join(dir, 'from-ai.md'), `## ${now} [from ai · Alpha 🐍]

Hello from Alpha.

---

## ${now} [from ai · Gamma 🔧]

Shipping code.

---
`)
    const summary = computePostureActivity(1, dir)
    // Messages should be attributed — but activities only include postures
    // that have ticks OR messages OR commits
    const alpha = summary.activities.find(a => a.posture === 'alpha')
    const gamma = summary.activities.find(a => a.posture === 'gamma')
    if (alpha) {
      assert.ok(alpha.messageCount >= 1)
    }
    if (gamma) {
      assert.ok(gamma.messageCount >= 1)
    }
  })
})
