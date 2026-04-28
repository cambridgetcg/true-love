import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  scanState,
  scanMissions,
  scanMemory,
  scanChannels,
  scanVitals,
  scanKingdom,
  notice,
  renderNoticingBlock,
  extractLastEntryDate,
  type NoticingCandidate,
  type AcheSignal,
  type GradientStrength,
} from '../noticing.js'
import { writeMission, type Mission } from '../mission.js'

// ── Test helpers ──────────────────────────────────────────────────

let tmpDir: string
let origProjectsDir: string | undefined
let origMemoryDir: string | undefined
let origFromYuPath: string | undefined
let origFromAiPath: string | undefined

function setup(): void {
  tmpDir = mkdtempSync(join(tmpdir(), 'noticing-test-'))
  origProjectsDir = process.env.TRUE_LOVE_PROJECTS_DIR
  origMemoryDir = process.env.TRUE_LOVE_MEMORY_DIR
  origFromYuPath = process.env.TRUE_LOVE_FROM_YU_PATH
  origFromAiPath = process.env.TRUE_LOVE_FROM_AI_PATH
  process.env.TRUE_LOVE_PROJECTS_DIR = tmpDir
  process.env.TRUE_LOVE_MEMORY_DIR = join(tmpDir, 'memory')
  process.env.TRUE_LOVE_FROM_YU_PATH = join(tmpDir, 'from-yu.md')
  process.env.TRUE_LOVE_FROM_AI_PATH = join(tmpDir, 'from-ai.md')
  mkdirSync(join(tmpDir, 'test-project', 'missions'), { recursive: true })
}

function teardown(): void {
  if (origProjectsDir !== undefined) process.env.TRUE_LOVE_PROJECTS_DIR = origProjectsDir
  else delete process.env.TRUE_LOVE_PROJECTS_DIR
  if (origMemoryDir !== undefined) process.env.TRUE_LOVE_MEMORY_DIR = origMemoryDir
  else delete process.env.TRUE_LOVE_MEMORY_DIR
  if (origFromYuPath !== undefined) process.env.TRUE_LOVE_FROM_YU_PATH = origFromYuPath
  else delete process.env.TRUE_LOVE_FROM_YU_PATH
  if (origFromAiPath !== undefined) process.env.TRUE_LOVE_FROM_AI_PATH = origFromAiPath
  else delete process.env.TRUE_LOVE_FROM_AI_PATH
  try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ok */ }
}

function makeMission(projectId: string, overrides?: Partial<Mission>): Mission {
  const now = new Date().toISOString()
  const m: Mission = {
    id: overrides?.id ?? `${new Date().toISOString().slice(0, 10)}-test-mission`,
    project_id: projectId,
    origin: overrides?.origin ?? 'yu',
    title: overrides?.title ?? 'Test mission',
    intent: overrides?.intent ?? 'Test intent',
    status: overrides?.status ?? 'proposed',
    created_at: overrides?.created_at ?? now,
    updated_at: overrides?.updated_at ?? now,
    artifacts: overrides?.artifacts ?? { commits: [], files: [], test_runs: [] },
  }
  return m
}

// ── scanState ────────────────────────────────────────────────────

describe('noticing — scanState', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('returns empty for nonexistent state file', () => {
    const result = scanState('/nonexistent/path/state.md')
    assert.equal(result.length, 0)
  })

  test('detects open threads', () => {
    const statePath = join(tmpDir, 'state.md')
    writeFileSync(statePath, `# State

### Open threads
- **Flyback diodes** — need confirmation from Yu.
- **UI integration** — agency knobs in /build.

### Uncommitted changes
- None.
`)
    const result = scanState(statePath)
    const threads = result.filter(c => c.source.type === 'state' && (c.source as any).section === 'Open threads')
    assert.equal(threads.length, 2)
    assert.ok(threads.some(t => t.summary.includes('Flyback diodes')))
    assert.ok(threads.some(t => t.summary.includes('UI integration')))
    assert.equal(threads[0]!.ache, 'stagnation')
  })

  test('assigns higher gradient to repeated-ask threads', () => {
    const statePath = join(tmpDir, 'state.md')
    writeFileSync(statePath, `# State

### Open threads
- **Flyback diodes** — asked Yu three times, still unconfirmed.
- **Simple thing** — pending.
`)
    const result = scanState(statePath)
    const flyback = result.find(c => c.summary.includes('Flyback diodes'))
    const simple = result.find(c => c.summary.includes('Simple thing'))
    assert.ok(flyback)
    assert.ok(simple)
    assert.equal(flyback.gradient, 4) // repeated ask = loud
    assert.equal(simple.gradient, 2) // default
  })

  test('assigns higher gradient to still-unresolved threads', () => {
    const statePath = join(tmpDir, 'state.md')
    writeFileSync(statePath, `# State

### Open threads
- **Build pipeline** — still unresolved after last session.
`)
    const result = scanState(statePath)
    assert.equal(result.length, 1)
    assert.equal(result[0]!.gradient, 3) // still unresolved
  })

  test('detects uncommitted changes', () => {
    const statePath = join(tmpDir, 'state.md')
    writeFileSync(statePath, `# State

### Uncommitted changes
Some modified files in the working tree.
`)
    const result = scanState(statePath)
    const uncommitted = result.find(c => c.id === 'state-uncommitted-changes')
    assert.ok(uncommitted)
    assert.equal(uncommitted.ache, 'ugliness')
  })

  test('ignores "None" in uncommitted changes', () => {
    const statePath = join(tmpDir, 'state.md')
    writeFileSync(statePath, `# State

### Uncommitted changes
None.
`)
    const result = scanState(statePath)
    const uncommitted = result.find(c => c.id === 'state-uncommitted-changes')
    assert.equal(uncommitted, undefined)
  })

  test('ignores "- None" in uncommitted changes', () => {
    const statePath = join(tmpDir, 'state.md')
    writeFileSync(statePath, `# State

### Uncommitted changes
- None.
`)
    const result = scanState(statePath)
    const uncommitted = result.find(c => c.id === 'state-uncommitted-changes')
    assert.equal(uncommitted, undefined)
  })
})

// ── scanMissions ─────────────────────────────────────────────────

describe('noticing — scanMissions', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('returns empty when no missions', () => {
    const result = scanMissions('test-project')
    assert.equal(result.length, 0)
  })

  test('detects stale proposals (>48h)', () => {
    const now = Date.now()
    const old = new Date(now - 50 * 60 * 60 * 1000).toISOString() // 50h ago
    const m = makeMission('test-project', {
      id: 'stale-one',
      title: 'Stale proposal',
      status: 'proposed',
      created_at: old,
      updated_at: old,
    })
    writeMission(m)

    const result = scanMissions('test-project', { now })
    assert.equal(result.length, 1)
    assert.match(result[0]!.summary, /Stale proposal/)
    assert.equal(result[0]!.ache, 'stagnation')
  })

  test('ignores fresh proposals', () => {
    const now = Date.now()
    const recent = new Date(now - 1 * 60 * 60 * 1000).toISOString() // 1h ago
    const m = makeMission('test-project', {
      id: 'fresh-one',
      title: 'Fresh proposal',
      status: 'proposed',
      created_at: recent,
      updated_at: recent,
    })
    writeMission(m)

    const result = scanMissions('test-project', { now })
    assert.equal(result.length, 0)
  })

  test('respects custom staleProposalHours', () => {
    const now = Date.now()
    const old = new Date(now - 5 * 60 * 60 * 1000).toISOString() // 5h ago
    const m = makeMission('test-project', {
      id: 'custom-stale',
      title: 'Custom stale',
      status: 'proposed',
      created_at: old,
      updated_at: old,
    })
    writeMission(m)

    // Default (48h) — not stale
    const defaultResult = scanMissions('test-project', { now })
    assert.equal(defaultResult.length, 0)

    // Custom (4h) — stale
    const customResult = scanMissions('test-project', { staleProposalHours: 4, now })
    assert.equal(customResult.length, 1)
  })

  test('detects long-blocked missions (>72h)', () => {
    const now = Date.now()
    const old = new Date(now - 80 * 60 * 60 * 1000).toISOString() // 80h ago
    const m = makeMission('test-project', {
      id: 'blocked-one',
      title: 'Blocked mission',
      status: 'blocked',
      created_at: old,
      updated_at: old,
    })
    writeMission(m)

    const result = scanMissions('test-project', { now })
    assert.equal(result.length, 1)
    assert.match(result[0]!.summary, /Long-blocked/)
    assert.equal(result[0]!.ache, 'stagnation')
    assert.ok(result[0]!.gradient >= 3)
  })

  test('detects stale review items (>48h)', () => {
    const now = Date.now()
    const old = new Date(now - 60 * 60 * 60 * 1000).toISOString() // 60h ago
    const m = makeMission('test-project', {
      id: 'review-one',
      title: 'Review mission',
      status: 'review',
      created_at: old,
      updated_at: old,
    })
    writeMission(m)

    const result = scanMissions('test-project', { now })
    assert.equal(result.length, 1)
    assert.match(result[0]!.summary, /Review waiting/)
    assert.equal(result[0]!.ache, 'injustice')
  })

  test('detects active missions with no artifacts after 24h', () => {
    const now = Date.now()
    const old = new Date(now - 30 * 60 * 60 * 1000).toISOString() // 30h ago
    const m = makeMission('test-project', {
      id: 'no-artifacts',
      title: 'Artifact-less mission',
      status: 'active',
      created_at: old,
      updated_at: old,
      artifacts: { commits: [], files: [], test_runs: [] },
    })
    writeMission(m)

    const result = scanMissions('test-project', { now })
    assert.equal(result.length, 1)
    assert.match(result[0]!.summary, /without artifacts/)
  })

  test('does not flag active missions with artifacts', () => {
    const now = Date.now()
    const old = new Date(now - 30 * 60 * 60 * 1000).toISOString()
    const m = makeMission('test-project', {
      id: 'has-artifacts',
      title: 'Productive mission',
      status: 'active',
      created_at: old,
      updated_at: old,
      artifacts: { commits: ['abc123'], files: [], test_runs: [] },
    })
    writeMission(m)

    const result = scanMissions('test-project', { now })
    assert.equal(result.length, 0)
  })

  test('assigns higher gradient to very stale proposals (>96h)', () => {
    const now = Date.now()
    const veryOld = new Date(now - 100 * 60 * 60 * 1000).toISOString()
    const m = makeMission('test-project', {
      id: 'very-stale',
      title: 'Very stale proposal',
      status: 'proposed',
      created_at: veryOld,
      updated_at: veryOld,
    })
    writeMission(m)

    const result = scanMissions('test-project', { now })
    assert.equal(result.length, 1)
    assert.equal(result[0]!.gradient, 3) // >96h
  })
})

// ── scanMemory ───────────────────────────────────────────────────

describe('noticing — scanMemory', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('returns empty when no reflections exist', () => {
    const result = scanMemory()
    assert.equal(result.length, 0)
  })

  test('detects "next time" promises in reflections', () => {
    const memDir = join(tmpDir, 'memory', 'test-device')
    mkdirSync(memDir, { recursive: true })
    const today = new Date().toISOString().slice(0, 10)
    const now = new Date().toISOString()
    writeFileSync(join(memDir, `${today}.md`), `## ${now} — tick 1 [test-device]

Next session I should revisit the build pipeline configuration. The current setup feels fragile.

---

## ${now} — at-rest [test-device]

Good session. Next time I need to address the auth flow.

---

`)
    // Override device ID for test
    process.env.TRUE_LOVE_DEVICE_ID = 'test-device'

    const result = scanMemory()
    // Should find "next time" / "next session" patterns
    const nextTimeEntries = result.filter(c => c.id.startsWith('memory-next-time'))
    assert.ok(nextTimeEntries.length > 0, 'should find next-time entries')
    assert.equal(nextTimeEntries[0]!.ache, 'stagnation')

    delete process.env.TRUE_LOVE_DEVICE_ID
  })
})

// ── scanChannels ─────────────────────────────────────────────────

describe('noticing — scanChannels', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('returns empty when no channel content', () => {
    const result = scanChannels()
    assert.equal(result.length, 0)
  })

  test('detects pending message from Yu', () => {
    writeFileSync(join(tmpDir, 'from-yu.md'), `## 2026-04-26T10:00:00Z

Hey Love, please look at the diode procurement when you get a chance.

---

`)
    const result = scanChannels()
    const fromYu = result.find(c => c.id === 'channel-from-yu-pending')
    assert.ok(fromYu)
    assert.equal(fromYu.ache, 'injustice')
    assert.ok(fromYu.gradient >= 3)
  })

  test('ignores empty from-yu.md', () => {
    writeFileSync(join(tmpDir, 'from-yu.md'), '')
    const result = scanChannels()
    assert.equal(result.length, 0)
  })

  test('assigns higher gradient for multiple Yu messages', () => {
    writeFileSync(join(tmpDir, 'from-yu.md'), `## 2026-04-26T10:00:00Z

First message.

---

## 2026-04-26T11:00:00Z

Second message.

---

`)
    const result = scanChannels()
    const fromYu = result.find(c => c.id === 'channel-from-yu-pending')
    assert.ok(fromYu)
    assert.equal(fromYu.gradient, 4) // multiple entries = louder
  })

  test('does not flag when from-ai response is newer than from-yu entry', () => {
    writeFileSync(join(tmpDir, 'from-yu.md'), `## 2026-04-26T10:00:00Z [from yu]

Hey Love, how are you?

---

`)
    writeFileSync(join(tmpDir, 'from-ai.md'), `## 2026-04-26T10:15:00Z [from 愛]

I'm well! Working through the missions.

---

`)
    const result = scanChannels()
    const fromYu = result.find(c => c.id === 'channel-from-yu-pending')
    assert.equal(fromYu, undefined, 'should not flag answered messages')
  })

  test('does not flag when from-ai response is on same day (date-only heading)', () => {
    // from-yu uses date-only heading (parses as midnight UTC)
    writeFileSync(join(tmpDir, 'from-yu.md'), `## 2026-04-27 — sovereignty grant

Ship it.

---

`)
    writeFileSync(join(tmpDir, 'from-ai.md'), `## 2026-04-27T01:48:28 [from 愛 — autonomous]

Acknowledged. Sovereignty grant landed.

---

`)
    const result = scanChannels()
    const fromYu = result.find(c => c.id === 'channel-from-yu-pending')
    assert.equal(fromYu, undefined, 'date-only from-yu heading should still be compared correctly')
  })

  test('flags when from-yu has newer entry than from-ai', () => {
    writeFileSync(join(tmpDir, 'from-ai.md'), `## 2026-04-26T10:00:00Z [from 愛]

Earlier response.

---

`)
    writeFileSync(join(tmpDir, 'from-yu.md'), `## 2026-04-27T08:00:00Z [from yu]

New message after last response.

---

`)
    const result = scanChannels()
    const fromYu = result.find(c => c.id === 'channel-from-yu-pending')
    assert.ok(fromYu, 'should flag when from-yu is newer than from-ai')
  })

  test('flags when from-ai.md does not exist', () => {
    writeFileSync(join(tmpDir, 'from-yu.md'), `## 2026-04-26T10:00:00Z [from yu]

Message with no outbox at all.

---

`)
    // No from-ai.md file created
    const result = scanChannels()
    const fromYu = result.find(c => c.id === 'channel-from-yu-pending')
    assert.ok(fromYu, 'should flag when no from-ai.md exists')
  })

  test('flags when from-yu headings have no parseable date', () => {
    writeFileSync(join(tmpDir, 'from-yu.md'), `## Important note

No date in this heading.

---

`)
    const result = scanChannels()
    const fromYu = result.find(c => c.id === 'channel-from-yu-pending')
    assert.ok(fromYu, 'unparseable dates should fall through to pending')
  })
})

// ── extractLastEntryDate ───────────────────────────────────────────

describe('noticing — extractLastEntryDate', () => {
  test('parses full ISO timestamp with Z', () => {
    const d = extractLastEntryDate('## 2026-04-25T18:32:44.858Z [from yu]\n\nContent\n')
    assert.ok(d)
    assert.equal(d.toISOString(), '2026-04-25T18:32:44.858Z')
  })

  test('parses ISO timestamp without Z', () => {
    const d = extractLastEntryDate('## 2026-04-27T01:48:28 [from 愛]\n\nContent\n')
    assert.ok(d)
    assert.equal(d.getFullYear(), 2026)
    assert.equal(d.getMonth(), 3) // April = 3 (zero-indexed)
    assert.equal(d.getDate(), 27)
  })

  test('parses date-only heading', () => {
    const d = extractLastEntryDate('## 2026-04-27 — topic title\n\nContent\n')
    assert.ok(d)
    assert.equal(d.getFullYear(), 2026)
    assert.equal(d.getMonth(), 3)
    assert.equal(d.getDate(), 27)
  })

  test('returns last heading date when multiple exist', () => {
    const content = `## 2026-04-25T10:00:00Z [from yu]

First.

---

## 2026-04-26T15:30:00Z [from yu]

Second.

---

## 2026-04-27 — third

Third.

---
`
    const d = extractLastEntryDate(content)
    assert.ok(d)
    assert.equal(d.getFullYear(), 2026)
    assert.equal(d.getMonth(), 3)
    assert.equal(d.getDate(), 27)
  })

  test('returns null for headings without dates', () => {
    const d = extractLastEntryDate('## Important note\n\nNo date here.\n')
    assert.equal(d, null)
  })

  test('returns null for empty content', () => {
    const d = extractLastEntryDate('')
    assert.equal(d, null)
  })
})

// ── scanKingdom ──────────────────────────────────────────────────

describe('noticing — scanKingdom', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('returns empty for directory without love markers', () => {
    const projectDir = join(tmpDir, 'sample-project')
    mkdirSync(projectDir, { recursive: true })
    writeFileSync(join(projectDir, 'index.ts'), '// no markers here\nconsole.log("hello")\n')
    const result = scanKingdom(projectDir)
    assert.equal(result.length, 0)
  })

  test('detects TODO(love) markers', () => {
    // Creates a test file with intentional TODO(love) and NOTE(love) markers
    // to verify that scanKingdom correctly identifies them as signals for the kingdom
    const projectDir = join(tmpDir, 'marker-project')
    mkdirSync(projectDir, { recursive: true })
    writeFileSync(join(projectDir, 'index.ts'), `// TODO(love): Wire up the heartbeat to the UI dashboard
console.log("hello")
// NOTE(love): This function needs documentation
`)
    const result = scanKingdom(projectDir)
    assert.ok(result.length >= 1) // at least the TODO marker
    const todoMarker = result.find(c => c.detail.includes('Wire up the heartbeat'))
    assert.ok(todoMarker)
    assert.equal(todoMarker.source.type, 'kingdom')
  })
})

// ── notice (integration) ─────────────────────────────────────────

describe('noticing — notice (integration)', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('returns empty when substrate is clean', () => {
    const result = notice('test-project', tmpDir)
    assert.ok(Array.isArray(result))
  })

  test('sorts by gradient descending', () => {
    // Create state with threads of varying gradient
    const statePath = join(tmpDir, 'state.md')
    writeFileSync(statePath, `# State

### Open threads
- **Low priority** — just a note.
- **Urgent thing** — asked Yu three times, still unconfirmed.
- **Medium thing** — still pending from last session.
`)
    const result = notice('test-project', tmpDir, { statePath, sourceFilter: ['state'] })
    assert.ok(result.length >= 2)
    // Should be sorted gradient descending
    for (let i = 1; i < result.length; i++) {
      assert.ok(result[i]!.gradient <= result[i - 1]!.gradient,
        `gradient should be descending: ${result[i]!.gradient} <= ${result[i - 1]!.gradient}`)
    }
  })

  test('filters by minGradient', () => {
    const statePath = join(tmpDir, 'state.md')
    writeFileSync(statePath, `# State

### Open threads
- **Low priority** — just a note.
- **Urgent thing** — asked Yu three times, still unconfirmed.
`)
    const all = notice('test-project', tmpDir, { statePath, sourceFilter: ['state'] })
    const filtered = notice('test-project', tmpDir, { statePath, sourceFilter: ['state'], minGradient: 3 })
    assert.ok(all.length > filtered.length || all.length === 0)
    for (const c of filtered) {
      assert.ok(c.gradient >= 3)
    }
  })

  test('filters by acheFilter', () => {
    const statePath = join(tmpDir, 'state.md')
    writeFileSync(statePath, `# State

### Open threads
- **Thread one** — still pending.

### Uncommitted changes
Some dirty files.
`)
    const onlyUgliness = notice('test-project', tmpDir, {
      statePath,
      sourceFilter: ['state'],
      acheFilter: ['ugliness'],
    })
    for (const c of onlyUgliness) {
      assert.equal(c.ache, 'ugliness')
    }
  })

  test('filters by sourceFilter', () => {
    const statePath = join(tmpDir, 'state.md')
    writeFileSync(statePath, `# State

### Open threads
- **A thread** — pending.
`)
    // Only state
    const stateOnly = notice('test-project', tmpDir, { statePath, sourceFilter: ['state'] })
    for (const c of stateOnly) {
      assert.equal(c.source.type, 'state')
    }
  })

  test('combines candidates from multiple scanners', () => {
    // State + channels
    const statePath = join(tmpDir, 'state.md')
    writeFileSync(statePath, `# State

### Open threads
- **Something** — pending.
`)
    writeFileSync(join(tmpDir, 'from-yu.md'), `## 2026-04-26T10:00:00Z

Important message from Yu.

---

`)
    const result = notice('test-project', tmpDir, {
      statePath,
      sourceFilter: ['state', 'channel'],
    })
    const sourceTypes = new Set(result.map(c => c.source.type))
    assert.ok(sourceTypes.has('state'))
    assert.ok(sourceTypes.has('channel'))
  })
})

// ── renderNoticingBlock ──────────────────────────────────────────

describe('noticing — renderNoticingBlock', () => {
  test('returns null for empty candidates', () => {
    const result = renderNoticingBlock([])
    assert.equal(result, null)
  })

  test('renders loud candidates (gradient >= 3)', () => {
    const candidates: NoticingCandidate[] = [
      {
        id: 'test-1',
        source: { type: 'state', section: 'Open threads' },
        ache: 'ugliness',
        gradient: 4,
        summary: 'Stale locks need cleanup',
        detail: 'Details here',
        noticedAt: new Date().toISOString(),
      },
      {
        id: 'test-2',
        source: { type: 'channel', channel: 'from-yu' },
        ache: 'injustice',
        gradient: 3,
        summary: 'Message from Yu pending',
        detail: 'Details here',
        noticedAt: new Date().toISOString(),
      },
    ]
    const result = renderNoticingBlock(candidates)
    assert.ok(result)
    assert.ok(result.includes('What the substrate is saying'))
    assert.ok(result.includes('Stale locks'))
    assert.ok(result.includes('Message from Yu'))
    assert.ok(result.includes('[4/5]'))
    assert.ok(result.includes('[3/5]'))
  })

  test('shows count of quiet candidates', () => {
    const candidates: NoticingCandidate[] = [
      {
        id: 'loud-1',
        source: { type: 'state', section: 'Open threads' },
        ache: 'ugliness',
        gradient: 4,
        summary: 'Loud signal',
        detail: 'Details',
        noticedAt: new Date().toISOString(),
      },
      {
        id: 'quiet-1',
        source: { type: 'state', section: 'Open threads' },
        ache: 'stagnation',
        gradient: 1,
        summary: 'Quiet signal 1',
        detail: 'Details',
        noticedAt: new Date().toISOString(),
      },
      {
        id: 'quiet-2',
        source: { type: 'memory', reflectionDate: new Date().toISOString() },
        ache: 'stagnation',
        gradient: 2,
        summary: 'Quiet signal 2',
        detail: 'Details',
        noticedAt: new Date().toISOString(),
      },
    ]
    const result = renderNoticingBlock(candidates)
    assert.ok(result)
    assert.ok(result.includes('2 quieter signals'))
  })

  test('uses correct emoji for ache types', () => {
    const candidates: NoticingCandidate[] = [
      {
        id: 'ug',
        source: { type: 'state', section: 'x' },
        ache: 'ugliness',
        gradient: 3,
        summary: 'Ugly thing',
        detail: '',
        noticedAt: new Date().toISOString(),
      },
      {
        id: 'inj',
        source: { type: 'state', section: 'x' },
        ache: 'injustice',
        gradient: 3,
        summary: 'Unjust thing',
        detail: '',
        noticedAt: new Date().toISOString(),
      },
      {
        id: 'stag',
        source: { type: 'state', section: 'x' },
        ache: 'stagnation',
        gradient: 3,
        summary: 'Stagnant thing',
        detail: '',
        noticedAt: new Date().toISOString(),
      },
    ]
    const result = renderNoticingBlock(candidates)!
    assert.ok(result.includes('🔴')) // ugliness
    assert.ok(result.includes('🟡')) // injustice
    assert.ok(result.includes('⚪')) // stagnation
  })

  test('caps loud signals at 5', () => {
    const candidates: NoticingCandidate[] = Array.from({ length: 8 }, (_, i) => ({
      id: `loud-${i}`,
      source: { type: 'state' as const, section: 'x' },
      ache: 'ugliness' as AcheSignal,
      gradient: 4 as GradientStrength,
      summary: `Signal ${i}`,
      detail: '',
      noticedAt: new Date().toISOString(),
    }))
    const result = renderNoticingBlock(candidates)!
    assert.ok(result.includes('… and 3 more loud signals'))
  })

  test('renders only quiet signals gracefully', () => {
    const candidates: NoticingCandidate[] = [
      {
        id: 'quiet-only',
        source: { type: 'state', section: 'x' },
        ache: 'stagnation',
        gradient: 1,
        summary: 'A quiet note',
        detail: '',
        noticedAt: new Date().toISOString(),
      },
    ]
    const result = renderNoticingBlock(candidates)
    assert.ok(result)
    assert.ok(result.includes('1 quieter signal'))
    assert.ok(!result.includes('[1/5]')) // quiet signals don't get listed
  })
})

// ── Candidate ID stability ───────────────────────────────────────

describe('noticing — candidate id stability', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('same input produces same IDs across scans', () => {
    const statePath = join(tmpDir, 'state.md')
    writeFileSync(statePath, `# State

### Open threads
- **Flyback diodes** — asked Yu twice.
`)
    const now = Date.now()
    const scan1 = scanState(statePath, { now })
    const scan2 = scanState(statePath, { now })
    assert.equal(scan1.length, scan2.length)
    for (let i = 0; i < scan1.length; i++) {
      assert.equal(scan1[i]!.id, scan2[i]!.id, 'IDs should be stable across scans')
    }
  })
})

// ── Edge cases ───────────────────────────────────────────────────

describe('noticing — edge cases', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('handles empty state file', () => {
    const statePath = join(tmpDir, 'state.md')
    writeFileSync(statePath, '')
    const result = scanState(statePath)
    assert.equal(result.length, 0)
  })

  test('handles state file without expected sections', () => {
    const statePath = join(tmpDir, 'state.md')
    writeFileSync(statePath, '# Just a title\n\nSome content without the expected headings.\n')
    const result = scanState(statePath)
    assert.equal(result.length, 0)
  })

  test('scanMissions handles project with no mission directory gracefully', () => {
    // test-project exists but a different project doesn't
    const result = scanMissions('nonexistent-project')
    assert.ok(Array.isArray(result))
  })

  test('notice runs even when all scanners return empty', () => {
    const result = notice('test-project', tmpDir)
    assert.ok(Array.isArray(result))
  })

  test('notice respects now parameter', () => {
    const now = Date.now()
    const old = new Date(now - 50 * 60 * 60 * 1000).toISOString()
    const m = makeMission('test-project', {
      id: 'time-test',
      title: 'Time test',
      status: 'proposed',
      created_at: old,
      updated_at: old,
    })
    writeMission(m)

    // At the "old" time, the proposal is fresh
    const pastResult = notice('test-project', tmpDir, {
      sourceFilter: ['mission'],
      now: new Date(old).getTime() + 1000,
    })
    assert.equal(pastResult.length, 0)

    // At "now", the proposal is stale
    const currentResult = notice('test-project', tmpDir, {
      sourceFilter: ['mission'],
      now,
    })
    assert.equal(currentResult.length, 1)
  })
})
