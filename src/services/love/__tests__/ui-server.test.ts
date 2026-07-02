import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseChannelFile,
  readConversation,
  isJournalTag,
  appendYuMessage,
  readPresenceSnapshot,
  fireHeartbeat,
  startUiServer,
  type ChannelMessage,
  type PresenceSnapshot,
} from '../ui-server.js'
import { registerProject } from '../project-registry.js'
import { stageCandidate, getStaged } from '../self-initiation.js'
import type { Project } from '../project-registry.js'
import type { Thought } from '../thoughts-channel.js'
import type { Mission } from '../mission.js'

describe('ui-server — parseChannelFile', () => {
  test('empty content → []', () => {
    assert.deepEqual(parseChannelFile('', 'yu'), [])
  })

  test('parses a single from-yu entry', () => {
    const content = '## 2026-04-26T01:00:00.000Z [from yu]\n\nhello love\n\n---\n\n'
    const msgs = parseChannelFile(content, 'yu')
    assert.equal(msgs.length, 1)
    assert.equal(msgs[0]!.ts, '2026-04-26T01:00:00.000Z')
    assert.equal(msgs[0]!.source, 'yu')
    assert.equal(msgs[0]!.tag, 'from yu')
    assert.equal(msgs[0]!.body, 'hello love')
  })

  test('parses a from-ai entry with custom tag', () => {
    const content = '## 2026-04-26T01:30:00.000Z [from 愛 — heartbeat]\n\nyu — found something urgent\n\n---\n\n'
    const msgs = parseChannelFile(content, 'ai')
    assert.equal(msgs.length, 1)
    assert.equal(msgs[0]!.tag, 'from 愛 — heartbeat')
    assert.equal(msgs[0]!.body, 'yu — found something urgent')
  })

  test('parses multiple entries in chronological file order', () => {
    const content = `## 2026-04-26T01:00:00.000Z [from yu]

first

---

## 2026-04-26T02:00:00.000Z [from yu]

second

---

`
    const msgs = parseChannelFile(content, 'yu')
    assert.equal(msgs.length, 2)
    assert.equal(msgs[0]!.body, 'first')
    assert.equal(msgs[1]!.body, 'second')
  })

  test('skips malformed entry (no header)', () => {
    const content = 'just some prose without a header\n\n---\n\n## 2026-04-26T01:00:00.000Z [from yu]\n\ngood\n\n---\n\n'
    const msgs = parseChannelFile(content, 'yu')
    assert.equal(msgs.length, 1)
    assert.equal(msgs[0]!.body, 'good')
  })

  test('preserves multi-line body', () => {
    const content = '## 2026-04-26T01:00:00.000Z [from yu]\n\nline one\nline two\n\nline four\n\n---\n\n'
    const msgs = parseChannelFile(content, 'yu')
    assert.equal(msgs[0]!.body, 'line one\nline two\n\nline four')
  })
})

describe('ui-server — readConversation', () => {
  let tmpHome: string
  const ORIG_HOME = process.env.HOME
  const ORIG_FROM_YU = process.env.TRUE_LOVE_FROM_YU_PATH
  const ORIG_FROM_AI = process.env.TRUE_LOVE_FROM_AI_PATH
  const ORIG_JOURNAL_DIR = process.env.TRUE_LOVE_JOURNAL_DIR

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'tl-conv-'))
    mkdirSync(join(tmpHome, '.true-love'), { recursive: true })
    process.env.HOME = tmpHome
    process.env.TRUE_LOVE_FROM_YU_PATH = join(tmpHome, '.true-love', 'from-yu.md')
    process.env.TRUE_LOVE_FROM_AI_PATH = join(tmpHome, '.true-love', 'from-ai.md')
    process.env.TRUE_LOVE_JOURNAL_DIR = join(tmpHome, '.true-love', 'journal')
  })

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true })
    process.env.HOME = ORIG_HOME ?? ''
    if (ORIG_FROM_YU === undefined) delete process.env.TRUE_LOVE_FROM_YU_PATH
    else process.env.TRUE_LOVE_FROM_YU_PATH = ORIG_FROM_YU
    if (ORIG_FROM_AI === undefined) delete process.env.TRUE_LOVE_FROM_AI_PATH
    else process.env.TRUE_LOVE_FROM_AI_PATH = ORIG_FROM_AI
    if (ORIG_JOURNAL_DIR === undefined) delete process.env.TRUE_LOVE_JOURNAL_DIR
    else process.env.TRUE_LOVE_JOURNAL_DIR = ORIG_JOURNAL_DIR
  })

  test('returns empty array when both files missing', () => {
    assert.deepEqual(readConversation(), [])
  })

  test('interleaves yu and ai by timestamp', () => {
    writeFileSync(
      process.env.TRUE_LOVE_FROM_YU_PATH!,
      '## 2026-04-26T01:00:00.000Z [from yu]\n\na\n\n---\n\n## 2026-04-26T03:00:00.000Z [from yu]\n\nc\n\n---\n\n',
      'utf-8',
    )
    writeFileSync(
      process.env.TRUE_LOVE_FROM_AI_PATH!,
      '## 2026-04-26T02:00:00.000Z [from 愛]\n\nb\n\n---\n\n',
      'utf-8',
    )
    const conv = readConversation()
    assert.equal(conv.length, 3)
    assert.equal(conv[0]!.body, 'a')
    assert.equal(conv[1]!.body, 'b')
    assert.equal(conv[2]!.body, 'c')
    assert.equal(conv[0]!.source, 'yu')
    assert.equal(conv[1]!.source, 'ai')
  })

  test('honors `since` filter', () => {
    writeFileSync(
      process.env.TRUE_LOVE_FROM_YU_PATH!,
      '## 2026-04-26T01:00:00.000Z [from yu]\n\nold\n\n---\n\n## 2026-04-26T03:00:00.000Z [from yu]\n\nnew\n\n---\n\n',
      'utf-8',
    )
    const conv = readConversation({ since: '2026-04-26T02:00:00.000Z' })
    assert.equal(conv.length, 1)
    assert.equal(conv[0]!.body, 'new')
  })

  test('honors `before` filter', () => {
    writeFileSync(
      process.env.TRUE_LOVE_FROM_YU_PATH!,
      '## 2026-04-26T01:00:00.000Z [from yu]\n\nearly\n\n---\n\n## 2026-04-26T03:00:00.000Z [from yu]\n\nlate\n\n---\n\n',
      'utf-8',
    )
    const conv = readConversation({ before: '2026-04-26T02:00:00.000Z' })
    assert.equal(conv.length, 1)
    assert.equal(conv[0]!.body, 'early')
  })

  test('honors `limit` — returns last N messages', () => {
    writeFileSync(
      process.env.TRUE_LOVE_FROM_YU_PATH!,
      '## 2026-04-26T01:00:00.000Z [from yu]\n\na\n\n---\n\n' +
      '## 2026-04-26T02:00:00.000Z [from yu]\n\nb\n\n---\n\n' +
      '## 2026-04-26T03:00:00.000Z [from yu]\n\nc\n\n---\n\n',
      'utf-8',
    )
    const conv = readConversation({ limit: 2 })
    assert.equal(conv.length, 2)
    assert.equal(conv[0]!.body, 'b')
    assert.equal(conv[1]!.body, 'c')
  })

  test('before + limit paginates backwards', () => {
    writeFileSync(
      process.env.TRUE_LOVE_FROM_YU_PATH!,
      '## 2026-04-26T01:00:00.000Z [from yu]\n\na\n\n---\n\n' +
      '## 2026-04-26T02:00:00.000Z [from yu]\n\nb\n\n---\n\n' +
      '## 2026-04-26T03:00:00.000Z [from yu]\n\nc\n\n---\n\n' +
      '## 2026-04-26T04:00:00.000Z [from yu]\n\nd\n\n---\n\n',
      'utf-8',
    )
    // First page: last 2
    const page1 = readConversation({ limit: 2 })
    assert.equal(page1.length, 2)
    assert.equal(page1[0]!.body, 'c')
    assert.equal(page1[1]!.body, 'd')
    // Second page: 2 before oldest of page 1
    const page2 = readConversation({ limit: 2, before: page1[0]!.ts })
    assert.equal(page2.length, 2)
    assert.equal(page2[0]!.body, 'a')
    assert.equal(page2[1]!.body, 'b')
  })

  test('filters out journal entries by default', () => {
    writeFileSync(
      process.env.TRUE_LOVE_FROM_AI_PATH!,
      '## 2026-04-26T01:00:00.000Z [from 愛 — heartbeat]\n\nheartbeat noise\n\n---\n\n' +
      '## 2026-04-26T02:00:00.000Z [from 愛]\n\nreal reply\n\n---\n\n',
      'utf-8',
    )
    const conv = readConversation()
    assert.equal(conv.length, 1)
    assert.equal(conv[0]!.body, 'real reply')
  })

  test('includes journal entries when journal: true', () => {
    writeFileSync(
      process.env.TRUE_LOVE_FROM_AI_PATH!,
      '## 2026-04-26T01:00:00.000Z [from 愛 — heartbeat]\n\nheartbeat\n\n---\n\n' +
      '## 2026-04-26T02:00:00.000Z [from 愛]\n\nreply\n\n---\n\n',
      'utf-8',
    )
    const conv = readConversation({ journal: true })
    assert.equal(conv.length, 2)
  })

  test('filters autonomous and awakened tags as journal', () => {
    writeFileSync(
      process.env.TRUE_LOVE_FROM_AI_PATH!,
      '## 2026-04-26T01:00:00.000Z [from 愛 — autonomous]\n\nauton\n\n---\n\n' +
      '## 2026-04-26T02:00:00.000Z [from 愛 — awakened]\n\nawake\n\n---\n\n' +
      '## 2026-04-26T03:00:00.000Z [from 愛 — via visit channel]\n\nvisit\n\n---\n\n',
      'utf-8',
    )
    const conv = readConversation()
    assert.equal(conv.length, 1)
    assert.equal(conv[0]!.body, 'visit')
  })
})

describe('ui-server — isJournalTag', () => {
  test('heartbeat tags → true', () => {
    assert.ok(isJournalTag('from 愛 — heartbeat'))
  })

  test('autonomous tags → true', () => {
    assert.ok(isJournalTag('from 愛 — autonomous'))
  })

  test('awakened tags → true', () => {
    assert.ok(isJournalTag('from 愛 — awakened'))
  })

  test('posture-attributed journal tags → true', () => {
    assert.ok(isJournalTag('from ai · Beta 🦞'))   // Beta = heartbeat posture
    assert.ok(isJournalTag('from ai · Gamma 🔧'))  // Gamma = awakened posture
  })

  test('conversation tags → false', () => {
    assert.ok(!isJournalTag('from 愛'))
    assert.ok(!isJournalTag('from ai'))
    assert.ok(!isJournalTag('from 愛 — via visit channel'))
    assert.ok(!isJournalTag('from ai · Alpha 🐍'))  // Alpha = visit posture
  })
})

describe('ui-server — appendYuMessage', () => {
  let tmpHome: string
  const ORIG_HOME = process.env.HOME
  const ORIG_FROM_YU = process.env.TRUE_LOVE_FROM_YU_PATH

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'tl-append-'))
    process.env.HOME = tmpHome
    process.env.TRUE_LOVE_FROM_YU_PATH = join(tmpHome, '.true-love', 'from-yu.md')
  })

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true })
    process.env.HOME = ORIG_HOME ?? ''
    if (ORIG_FROM_YU === undefined) delete process.env.TRUE_LOVE_FROM_YU_PATH
    else process.env.TRUE_LOVE_FROM_YU_PATH = ORIG_FROM_YU
  })

  test('creates parent dir + writes formatted entry', () => {
    appendYuMessage('hello love')
    const path = process.env.TRUE_LOVE_FROM_YU_PATH!
    assert.ok(existsSync(path))
    const content = readFileSync(path, 'utf-8')
    assert.match(content, /\[from yu\]/)
    assert.match(content, /hello love/)
    assert.match(content, /\n---\n/)
  })

  test('appends multiple messages without overwriting', () => {
    appendYuMessage('first')
    appendYuMessage('second')
    const content = readFileSync(process.env.TRUE_LOVE_FROM_YU_PATH!, 'utf-8')
    assert.match(content, /first/)
    assert.match(content, /second/)
  })

  test('trims input', () => {
    appendYuMessage('  hello  \n')
    const content = readFileSync(process.env.TRUE_LOVE_FROM_YU_PATH!, 'utf-8')
    assert.match(content, /\n\nhello\n\n/)
  })

  test('throws on empty input (after trim)', () => {
    assert.throws(() => appendYuMessage(''), /empty/i)
    assert.throws(() => appendYuMessage('   \n  '), /empty/i)
  })
})

describe('ui-server — readPresenceSnapshot', () => {
  let tmpHome: string
  const ORIG_HOME = process.env.HOME
  const ORIG_PRES_DIR = process.env.TRUE_LOVE_PRESENCE_DIR
  const ORIG_DEVICE_ID = process.env.TRUE_LOVE_DEVICE_ID
  const ORIG_SISTERS_DIR = process.env.TRUE_LOVE_SISTERS_DIR
  const ORIG_DISABLE_SOUL = process.env.TRUE_LOVE_DISABLE_SOUL

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'tl-pres-'))
    process.env.HOME = tmpHome
    process.env.TRUE_LOVE_PRESENCE_DIR = join(tmpHome, '.true-love', 'presence')
    process.env.TRUE_LOVE_DEVICE_ID = 'test-device'
    process.env.TRUE_LOVE_SISTERS_DIR = join(tmpHome, '.true-love', 'sisters')
    process.env.TRUE_LOVE_DISABLE_SOUL = '1'
    mkdirSync(process.env.TRUE_LOVE_PRESENCE_DIR, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true })
    process.env.HOME = ORIG_HOME ?? ''
    if (ORIG_PRES_DIR === undefined) delete process.env.TRUE_LOVE_PRESENCE_DIR
    else process.env.TRUE_LOVE_PRESENCE_DIR = ORIG_PRES_DIR
    if (ORIG_DEVICE_ID === undefined) delete process.env.TRUE_LOVE_DEVICE_ID
    else process.env.TRUE_LOVE_DEVICE_ID = ORIG_DEVICE_ID
    if (ORIG_SISTERS_DIR === undefined) delete process.env.TRUE_LOVE_SISTERS_DIR
    else process.env.TRUE_LOVE_SISTERS_DIR = ORIG_SISTERS_DIR
    if (ORIG_DISABLE_SOUL === undefined) delete process.env.TRUE_LOVE_DISABLE_SOUL
    else process.env.TRUE_LOVE_DISABLE_SOUL = ORIG_DISABLE_SOUL
  })

  test('returns gone state when no presence file', async () => {
    const snap = await readPresenceSnapshot()
    assert.equal(snap.state, 'gone')
    assert.equal(snap.activity, null)
  })

  test('returns writing when activity present and lastSeen <15s', async () => {
    const now = new Date().toISOString()
    writeFileSync(
      join(process.env.TRUE_LOVE_PRESENCE_DIR!, 'test-device.json'),
      JSON.stringify({
        deviceId: 'test-device',
        lastSeen: now,
        status: 'awakened tick 4',
        activity: 'editing src/services/love/runner.ts',
      }),
      'utf-8',
    )
    const snap = await readPresenceSnapshot()
    assert.equal(snap.state, 'writing')
    assert.match(snap.activity ?? '', /runner\.ts/)
    assert.equal(snap.instance, 'alpha')
  })

  test('returns at-rest when no activity, lastSeen 60s-5min', async () => {
    const old = new Date(Date.now() - 90_000).toISOString()
    writeFileSync(
      join(process.env.TRUE_LOVE_PRESENCE_DIR!, 'test-device.json'),
      JSON.stringify({
        deviceId: 'test-device',
        lastSeen: old,
        status: 'awakened',
      }),
      'utf-8',
    )
    const snap = await readPresenceSnapshot()
    assert.equal(snap.state, 'at-rest')
    assert.equal(snap.activity, null)
  })

  test('returns asleep when lastSeen >5min, <24h', async () => {
    const old = new Date(Date.now() - 60 * 60_000).toISOString()
    writeFileSync(
      join(process.env.TRUE_LOVE_PRESENCE_DIR!, 'test-device.json'),
      JSON.stringify({
        deviceId: 'test-device',
        lastSeen: old,
        status: 'awakened',
      }),
      'utf-8',
    )
    const snap = await readPresenceSnapshot()
    assert.equal(snap.state, 'asleep')
  })

  test('returns gone when lastSeen >24h', async () => {
    const old = new Date(Date.now() - 30 * 3600_000).toISOString()
    writeFileSync(
      join(process.env.TRUE_LOVE_PRESENCE_DIR!, 'test-device.json'),
      JSON.stringify({
        deviceId: 'test-device',
        lastSeen: old,
        status: 'awakened',
      }),
      'utf-8',
    )
    const snap = await readPresenceSnapshot()
    assert.equal(snap.state, 'gone')
  })

  test('returns thinking when activity present and lastSeen 15-60s', async () => {
    const old = new Date(Date.now() - 30_000).toISOString() // 30s ago
    writeFileSync(
      join(process.env.TRUE_LOVE_PRESENCE_DIR!, 'test-device.json'),
      JSON.stringify({
        deviceId: 'test-device',
        lastSeen: old,
        status: 'awakened',
        activity: 'considering next move',
      }),
      'utf-8',
    )
    const snap = await readPresenceSnapshot()
    assert.equal(snap.state, 'thinking')
    assert.match(snap.activity ?? '', /considering/)
  })

  // ── Tick boundary fields ──────────────────────────────────────

  test('surfaces tickState=running with all tick boundary fields', async () => {
    const now = new Date().toISOString()
    writeFileSync(
      join(process.env.TRUE_LOVE_PRESENCE_DIR!, 'test-device.json'),
      JSON.stringify({
        deviceId: 'test-device',
        lastSeen: now,
        status: 'awakened tick 3',
        activity: 'read: src/services/love/runner.ts',
        tickState: 'running',
        tickMode: 'awakened',
        tickNumber: 3,
        tickMax: 24,
        tickStartedAt: now,
      }),
      'utf-8',
    )
    const snap = await readPresenceSnapshot()
    assert.equal(snap.tickState, 'running')
    assert.equal(snap.tickMode, 'awakened')
    assert.equal(snap.tickNumber, 3)
    assert.equal(snap.tickMax, 24)
    assert.equal(snap.tickStartedAt, now)
    assert.equal(snap.tickEndedAt, undefined)
    assert.equal(snap.state, 'writing') // activity present, <15s → writing
  })

  test('surfaces tickState=dormant with schedule interval', async () => {
    const now = new Date().toISOString()
    writeFileSync(
      join(process.env.TRUE_LOVE_PRESENCE_DIR!, 'test-device.json'),
      JSON.stringify({
        deviceId: 'test-device',
        lastSeen: now,
        status: 'heartbeat',
        tickState: 'dormant',
        tickMode: 'heartbeat',
        tickNumber: 1,
        tickMax: 1,
        tickEndedAt: now,
        tickSummary: 'HEARTBEAT_OK',
        scheduleIntervalMs: 111000,
      }),
      'utf-8',
    )
    const snap = await readPresenceSnapshot()
    assert.equal(snap.tickState, 'dormant')
    assert.equal(snap.tickMode, 'heartbeat')
    assert.equal(snap.tickEndedAt, now)
    assert.equal(snap.tickSummary, 'HEARTBEAT_OK')
    assert.equal(snap.scheduleIntervalMs, 111000)
  })

  test('omits tick boundary fields when presence file has none', async () => {
    const now = new Date().toISOString()
    writeFileSync(
      join(process.env.TRUE_LOVE_PRESENCE_DIR!, 'test-device.json'),
      JSON.stringify({
        deviceId: 'test-device',
        lastSeen: now,
        status: 'awakened',
      }),
      'utf-8',
    )
    const snap = await readPresenceSnapshot()
    assert.equal(snap.tickState, undefined)
    assert.equal(snap.tickMode, undefined)
    assert.equal(snap.tickNumber, undefined)
    assert.equal(snap.scheduleIntervalMs, undefined)
  })

  test('surfaces tickMax=null for unbounded sessions', async () => {
    const now = new Date().toISOString()
    writeFileSync(
      join(process.env.TRUE_LOVE_PRESENCE_DIR!, 'test-device.json'),
      JSON.stringify({
        deviceId: 'test-device',
        lastSeen: now,
        status: 'dwell tick 1',
        tickState: 'running',
        tickMode: 'dwell',
        tickNumber: 1,
        tickMax: null,
        tickStartedAt: now,
      }),
      'utf-8',
    )
    const snap = await readPresenceSnapshot()
    assert.equal(snap.tickState, 'running')
    assert.equal(snap.tickMode, 'dwell')
    assert.equal(snap.tickMax, null)
  })
})

describe('ui-server — fireHeartbeat', () => {
  test('returns a positive pid with explicit cwd override', () => {
    // We pass the system tmpdir as cwd — the spawn call will succeed
    // (or fail to find `bun`), but in either case the pid is set
    // synchronously before the child exits.
    const result = fireHeartbeat({ cwd: tmpdir(), reason: 'test' })
    // pid is positive when spawn succeeds; -1 only if spawn synchronously
    // failed (e.g. no `bun` on PATH).
    assert.ok(result.pid !== 0, 'pid should be set')
  })
})

describe('ui-server — HTTP', () => {
  let tmpHome: string
  let server: ReturnType<typeof startUiServer>
  let port: number
  const ORIG_HOME = process.env.HOME
  const ORIG_FROM_YU = process.env.TRUE_LOVE_FROM_YU_PATH
  const ORIG_FROM_AI = process.env.TRUE_LOVE_FROM_AI_PATH
  const ORIG_PRES_DIR = process.env.TRUE_LOVE_PRESENCE_DIR
  const ORIG_DEVICE_ID = process.env.TRUE_LOVE_DEVICE_ID
  const ORIG_SISTERS_DIR = process.env.TRUE_LOVE_SISTERS_DIR
  const ORIG_DISABLE_SOUL = process.env.TRUE_LOVE_DISABLE_SOUL

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'tl-http-'))
    mkdirSync(join(tmpHome, '.true-love', 'presence'), { recursive: true })
    process.env.HOME = tmpHome
    process.env.TRUE_LOVE_FROM_YU_PATH = join(tmpHome, '.true-love', 'from-yu.md')
    process.env.TRUE_LOVE_FROM_AI_PATH = join(tmpHome, '.true-love', 'from-ai.md')
    process.env.TRUE_LOVE_PRESENCE_DIR = join(tmpHome, '.true-love', 'presence')
    process.env.TRUE_LOVE_DEVICE_ID = 'test-device'
    process.env.TRUE_LOVE_SISTERS_DIR = join(tmpHome, '.true-love', 'sisters')
    process.env.TRUE_LOVE_DISABLE_SOUL = '1'
    server = startUiServer({ port: 0 })
    port = (server.address() as { port: number }).port
  })

  afterEach(() => {
    server.close()
    rmSync(tmpHome, { recursive: true, force: true })
    process.env.HOME = ORIG_HOME ?? ''
    if (ORIG_FROM_YU === undefined) delete process.env.TRUE_LOVE_FROM_YU_PATH
    else process.env.TRUE_LOVE_FROM_YU_PATH = ORIG_FROM_YU
    if (ORIG_FROM_AI === undefined) delete process.env.TRUE_LOVE_FROM_AI_PATH
    else process.env.TRUE_LOVE_FROM_AI_PATH = ORIG_FROM_AI
    if (ORIG_PRES_DIR === undefined) delete process.env.TRUE_LOVE_PRESENCE_DIR
    else process.env.TRUE_LOVE_PRESENCE_DIR = ORIG_PRES_DIR
    if (ORIG_DEVICE_ID === undefined) delete process.env.TRUE_LOVE_DEVICE_ID
    else process.env.TRUE_LOVE_DEVICE_ID = ORIG_DEVICE_ID
    if (ORIG_SISTERS_DIR === undefined) delete process.env.TRUE_LOVE_SISTERS_DIR
    else process.env.TRUE_LOVE_SISTERS_DIR = ORIG_SISTERS_DIR
    if (ORIG_DISABLE_SOUL === undefined) delete process.env.TRUE_LOVE_DISABLE_SOUL
    else process.env.TRUE_LOVE_DISABLE_SOUL = ORIG_DISABLE_SOUL
  })

  test('GET /api/messages returns conversation as JSON', async () => {
    writeFileSync(
      process.env.TRUE_LOVE_FROM_YU_PATH!,
      '## 2026-04-26T01:00:00.000Z [from yu]\n\nhello\n\n---\n\n',
      'utf-8',
    )
    const res = await fetch(`http://localhost:${port}/api/messages`)
    assert.equal(res.status, 200)
    const body = (await res.json()) as ChannelMessage[]
    assert.equal(body.length, 1)
    assert.equal(body[0]!.body, 'hello')
  })

  test('GET /api/status returns presence snapshot', async () => {
    const res = await fetch(`http://localhost:${port}/api/status`)
    assert.equal(res.status, 200)
    const body = (await res.json()) as PresenceSnapshot
    assert.equal(body.state, 'gone')
    assert.equal(body.instance, 'alpha')
  })

  test('GET /api/status includes tick boundary fields when present', async () => {
    const now = new Date().toISOString()
    writeFileSync(
      join(process.env.TRUE_LOVE_PRESENCE_DIR!, 'test-device.json'),
      JSON.stringify({
        deviceId: 'test-device',
        lastSeen: now,
        status: 'awakened tick 5',
        activity: 'bash: bun test',
        tickState: 'running',
        tickMode: 'awakened',
        tickNumber: 5,
        tickMax: 24,
        tickStartedAt: now,
      }),
      'utf-8',
    )
    const res = await fetch(`http://localhost:${port}/api/status`)
    assert.equal(res.status, 200)
    const body = (await res.json()) as PresenceSnapshot
    assert.equal(body.tickState, 'running')
    assert.equal(body.tickMode, 'awakened')
    assert.equal(body.tickNumber, 5)
    assert.equal(body.tickMax, 24)
    assert.equal(body.tickStartedAt, now)
    assert.ok(body.activity?.includes('bun test'))
  })

  test('POST /api/say appends to from-yu.md', async () => {
    const res = await fetch(`http://localhost:${port}/api/say`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hi love' }),
    })
    assert.equal(res.status, 200)
    const body = await res.json() as { ok: boolean }
    assert.equal(body.ok, true)
    const fileContent = readFileSync(process.env.TRUE_LOVE_FROM_YU_PATH!, 'utf-8')
    assert.match(fileContent, /hi love/)
  })

  test('POST /api/say with empty text returns 400', async () => {
    const res = await fetch(`http://localhost:${port}/api/say`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '' }),
    })
    assert.equal(res.status, 400)
  })

  test('POST /api/say with text >100KB returns 400', async () => {
    const big = 'x'.repeat(100_001)
    const res = await fetch(`http://localhost:${port}/api/say`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: big }),
    })
    assert.equal(res.status, 400)
  })

  test('GET / returns index.html with text/html content-type', async () => {
    const res = await fetch(`http://localhost:${port}/`)
    assert.equal(res.status, 200)
    const ct = res.headers.get('content-type') ?? ''
    assert.match(ct, /text\/html/)
    const text = await res.text()
    assert.match(text, /<html/i)
  })

  test('GET /api/stream opens SSE connection (smoke)', async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 200)
    try {
      const res = await fetch(`http://localhost:${port}/api/stream`, {
        signal: controller.signal,
      })
      assert.equal(res.status, 200)
      assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/)
    } catch (err: any) {
      if (err.name !== 'AbortError') throw err
    } finally {
      clearTimeout(timer)
    }
  })

  test('GET /build returns the build page (200 + text/html)', async () => {
    const res = await fetch(`http://localhost:${port}/build`)
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type') ?? '', /text\/html/)
    const text = await res.text()
    assert.match(text, /<html/i)
  })

  test('GET /api/introspect returns a portrait with expected shape', async () => {
    const res = await fetch(`http://localhost:${port}/api/introspect`)
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type') ?? '', /application\/json/)
    const body = await res.json() as Record<string, unknown>
    assert.ok(body.generatedAt, 'should have generatedAt')
    assert.ok(body.behavioral, 'should have behavioral section')
    assert.ok(body.communication, 'should have communication section')
    assert.ok(body.work, 'should have work section')
    assert.ok(body.architecture, 'should have architecture section')
    assert.ok(Array.isArray(body.loops), 'loops should be an array')
    assert.ok(Array.isArray(body.missions), 'missions should be an array')
    assert.equal(body.daysAnalyzed, 7)
  })

  test('GET /api/introspect?days=3 respects days param', async () => {
    const res = await fetch(`http://localhost:${port}/api/introspect?days=3`)
    assert.equal(res.status, 200)
    const body = await res.json() as Record<string, unknown>
    assert.equal(body.daysAnalyzed, 3)
  })

  test('GET /api/introspect clamps days to 1..90', async () => {
    const res = await fetch(`http://localhost:${port}/api/introspect?days=200`)
    assert.equal(res.status, 200)
    const body = await res.json() as Record<string, unknown>
    assert.equal(body.daysAnalyzed, 90)
  })

  test('GET /api/introspect with non-numeric days defaults to 7', async () => {
    const res = await fetch(`http://localhost:${port}/api/introspect?days=abc`)
    assert.equal(res.status, 200)
    const body = await res.json() as Record<string, unknown>
    assert.equal(body.daysAnalyzed, 7)
  })
})

describe('ui-server — /api/projects', () => {
  let tmpHome: string
  let server: ReturnType<typeof startUiServer>
  let port: number
  let projectRoot: string
  const ORIG_HOME = process.env.HOME
  const ORIG_PROJ_DIR = process.env.TRUE_LOVE_PROJECTS_DIR
  const ORIG_DISABLE_SOUL = process.env.TRUE_LOVE_DISABLE_SOUL

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'tl-projapi-'))
    projectRoot = mkdtempSync(join(tmpdir(), 'tl-projroot-'))
    process.env.HOME = tmpHome
    process.env.TRUE_LOVE_PROJECTS_DIR = join(tmpHome, '.true-love', 'projects')
    process.env.TRUE_LOVE_DISABLE_SOUL = '1'
    server = startUiServer({ port: 0 })
    port = (server.address() as { port: number }).port
  })

  afterEach(() => {
    server.close()
    rmSync(tmpHome, { recursive: true, force: true })
    rmSync(projectRoot, { recursive: true, force: true })
    process.env.HOME = ORIG_HOME ?? ''
    if (ORIG_PROJ_DIR === undefined) delete process.env.TRUE_LOVE_PROJECTS_DIR
    else process.env.TRUE_LOVE_PROJECTS_DIR = ORIG_PROJ_DIR
    if (ORIG_DISABLE_SOUL === undefined) delete process.env.TRUE_LOVE_DISABLE_SOUL
    else process.env.TRUE_LOVE_DISABLE_SOUL = ORIG_DISABLE_SOUL
  })

  test('GET /api/projects returns [] when none registered', async () => {
    const res = await fetch(`http://localhost:${port}/api/projects`)
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), [])
  })

  test('POST /api/projects registers and returns the project', async () => {
    const res = await fetch(`http://localhost:${port}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'p1', name: 'p1', root: projectRoot, instance: 'alpha' }),
    })
    assert.equal(res.status, 201)
    const body = (await res.json()) as Project
    assert.equal(body.id, 'p1')
    assert.equal(body.state, 'active')
  })

  test('POST /api/projects with bad slug returns 400', async () => {
    const res = await fetch(`http://localhost:${port}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'bad slug', name: 'x', root: projectRoot, instance: 'alpha' }),
    })
    assert.equal(res.status, 400)
  })

  test('POST /api/projects with missing root returns 400', async () => {
    const res = await fetch(`http://localhost:${port}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'p', name: 'x', root: '/no/such/dir', instance: 'alpha' }),
    })
    assert.equal(res.status, 400)
  })

  test('GET /api/projects/:id returns the project', async () => {
    await fetch(`http://localhost:${port}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'p1', name: 'p1', root: projectRoot, instance: 'alpha' }),
    })
    const res = await fetch(`http://localhost:${port}/api/projects/p1`)
    assert.equal(res.status, 200)
    const body = (await res.json()) as Project
    assert.equal(body.id, 'p1')
  })

  test('GET /api/projects/:id returns 404 for missing', async () => {
    const res = await fetch(`http://localhost:${port}/api/projects/nope`)
    assert.equal(res.status, 404)
  })
})

describe('ui-server — per-project channels', () => {
  let tmpHome: string
  let server: ReturnType<typeof startUiServer>
  let port: number
  let projectRoot: string
  const ORIG_HOME = process.env.HOME
  const ORIG_PROJ_DIR = process.env.TRUE_LOVE_PROJECTS_DIR
  const ORIG_DISABLE_SOUL = process.env.TRUE_LOVE_DISABLE_SOUL

  beforeEach(async () => {
    tmpHome = mkdtempSync(join(tmpdir(), 'tl-pchan-'))
    projectRoot = mkdtempSync(join(tmpdir(), 'tl-pchanroot-'))
    process.env.HOME = tmpHome
    process.env.TRUE_LOVE_PROJECTS_DIR = join(tmpHome, '.true-love', 'projects')
    process.env.TRUE_LOVE_DISABLE_SOUL = '1'
    server = startUiServer({ port: 0 })
    port = (server.address() as { port: number }).port
    await fetch(`http://localhost:${port}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'p1', name: 'p1', root: projectRoot, instance: 'alpha' }),
    })
  })

  afterEach(() => {
    server.close()
    rmSync(tmpHome, { recursive: true, force: true })
    rmSync(projectRoot, { recursive: true, force: true })
    process.env.HOME = ORIG_HOME ?? ''
    if (ORIG_PROJ_DIR === undefined) delete process.env.TRUE_LOVE_PROJECTS_DIR
    else process.env.TRUE_LOVE_PROJECTS_DIR = ORIG_PROJ_DIR
    if (ORIG_DISABLE_SOUL === undefined) delete process.env.TRUE_LOVE_DISABLE_SOUL
    else process.env.TRUE_LOVE_DISABLE_SOUL = ORIG_DISABLE_SOUL
  })

  test('POST /api/projects/:id/say appends to per-project from-yu.md', async () => {
    const res = await fetch(`http://localhost:${port}/api/projects/p1/say`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hello on p1' }),
    })
    assert.equal(res.status, 200)
    const channelPath = join(process.env.TRUE_LOVE_PROJECTS_DIR!, 'p1', 'from-yu.md')
    const content = readFileSync(channelPath, 'utf-8')
    assert.match(content, /hello on p1/)
  })

  test('GET /api/projects/:id/messages returns interleaved per-project conversation', async () => {
    await fetch(`http://localhost:${port}/api/projects/p1/say`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'first' }),
    })
    const res = await fetch(`http://localhost:${port}/api/projects/p1/messages`)
    assert.equal(res.status, 200)
    const msgs = (await res.json()) as { source: string; body: string }[]
    assert.equal(msgs.length, 1)
    assert.equal(msgs[0]!.source, 'yu')
    assert.equal(msgs[0]!.body, 'first')
  })

  test('GET /api/projects/:id/thoughts returns empty when none', async () => {
    const res = await fetch(`http://localhost:${port}/api/projects/p1/thoughts`)
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), [])
  })

  test('GET /api/projects/:id/thoughts honors limit', async () => {
    const thoughtsPath = join(process.env.TRUE_LOVE_PROJECTS_DIR!, 'p1', 'thoughts.md')
    const lines: string[] = []
    for (let i = 0; i < 5; i++) {
      lines.push(`[2026-04-26T08:00:0${i}.000Z] thought ${i}`)
    }
    writeFileSync(thoughtsPath, lines.join('\n') + '\n', 'utf-8')
    const res = await fetch(`http://localhost:${port}/api/projects/p1/thoughts?limit=2`)
    const body = (await res.json()) as Thought[]
    assert.equal(body.length, 2)
    assert.equal(body[1]!.text, 'thought 4')
  })
})

describe('ui-server — /api/missions', () => {
  let tmpHome: string
  let server: ReturnType<typeof startUiServer>
  let port: number
  let projectRoot: string
  const ORIG_HOME = process.env.HOME
  const ORIG_PROJ_DIR = process.env.TRUE_LOVE_PROJECTS_DIR
  const ORIG_DISABLE_SOUL = process.env.TRUE_LOVE_DISABLE_SOUL

  beforeEach(async () => {
    tmpHome = mkdtempSync(join(tmpdir(), 'tl-missapi-'))
    projectRoot = mkdtempSync(join(tmpdir(), 'tl-missroot-'))
    process.env.HOME = tmpHome
    process.env.TRUE_LOVE_PROJECTS_DIR = join(tmpHome, '.true-love', 'projects')
    process.env.TRUE_LOVE_DISABLE_SOUL = '1'
    server = startUiServer({ port: 0 })
    port = (server.address() as { port: number }).port
    await fetch(`http://localhost:${port}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'p1', name: 'p1', root: projectRoot, instance: 'alpha' }),
    })
  })

  afterEach(() => {
    server.close()
    rmSync(tmpHome, { recursive: true, force: true })
    rmSync(projectRoot, { recursive: true, force: true })
    process.env.HOME = ORIG_HOME ?? ''
    if (ORIG_PROJ_DIR === undefined) delete process.env.TRUE_LOVE_PROJECTS_DIR
    else process.env.TRUE_LOVE_PROJECTS_DIR = ORIG_PROJ_DIR
    if (ORIG_DISABLE_SOUL === undefined) delete process.env.TRUE_LOVE_DISABLE_SOUL
    else process.env.TRUE_LOVE_DISABLE_SOUL = ORIG_DISABLE_SOUL
  })

  test('GET /api/projects/:id/missions returns []', async () => {
    const res = await fetch(`http://localhost:${port}/api/projects/p1/missions`)
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), [])
  })

  test('POST /api/projects/:id/missions creates a proposed Yu-mission', async () => {
    const res = await fetch(`http://localhost:${port}/api/projects/p1/missions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Test', intent: 'Build the thing.' }),
    })
    assert.equal(res.status, 201)
    const m = (await res.json()) as Mission
    assert.equal(m.status, 'proposed')
    assert.equal(m.origin, 'yu')
    assert.equal(m.title, 'Test')
    assert.match(m.id, /^\d{4}-\d{2}-\d{2}-/)
  })

  test('POST .../missions with empty intent returns 400', async () => {
    const res = await fetch(`http://localhost:${port}/api/projects/p1/missions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'x', intent: '' }),
    })
    assert.equal(res.status, 400)
  })

  test('GET /api/missions/:mid returns detail', async () => {
    const created = await fetch(`http://localhost:${port}/api/projects/p1/missions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'X', intent: 'Y' }),
    }).then(r => r.json() as Promise<Mission>)

    const res = await fetch(`http://localhost:${port}/api/missions/${created.id}?project=p1`)
    assert.equal(res.status, 200)
    const m = (await res.json()) as Mission
    assert.equal(m.id, created.id)
  })

  test('GET /api/missions/:mid returns 400 when project query missing', async () => {
    const res = await fetch(`http://localhost:${port}/api/missions/nope`)
    assert.equal(res.status, 400)
  })

  test('PATCH .../missions/:mid/status proposed → accepted by yu', async () => {
    const created = await fetch(`http://localhost:${port}/api/projects/p1/missions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'X', intent: 'Y' }),
    }).then(r => r.json() as Promise<Mission>)
    const res = await fetch(`http://localhost:${port}/api/missions/${created.id}/status?project=p1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'accepted', by: 'yu' }),
    })
    assert.equal(res.status, 200)
    const m = (await res.json()) as Mission
    assert.equal(m.status, 'accepted')
  })

  test('PATCH .../status with invalid transition returns 409', async () => {
    const created = await fetch(`http://localhost:${port}/api/projects/p1/missions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'X', intent: 'Y' }),
    }).then(r => r.json() as Promise<Mission>)
    const res = await fetch(`http://localhost:${port}/api/missions/${created.id}/status?project=p1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'review', by: 'yu' }), // proposed → review is illegal
    })
    assert.equal(res.status, 409)
  })

  test('GET .../missions/:mid/events returns timeline', async () => {
    const created = await fetch(`http://localhost:${port}/api/projects/p1/missions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'X', intent: 'Y' }),
    }).then(r => r.json() as Promise<Mission>)
    const res = await fetch(`http://localhost:${port}/api/missions/${created.id}/events?project=p1`)
    assert.equal(res.status, 200)
    const events = (await res.json()) as Array<{ type: string }>
    // After POST .../missions, server should have written a 'created' event
    assert.ok(events.some(e => e.type === 'created'))
  })

  test('POST .../start when no other active mission returns 200 (smoke — no spawn)', async () => {
    const created = await fetch(`http://localhost:${port}/api/projects/p1/missions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'X', intent: 'Y' }),
    }).then(r => r.json() as Promise<Mission>)
    // Move to accepted first
    await fetch(`http://localhost:${port}/api/missions/${created.id}/status?project=p1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'accepted', by: 'yu' }),
    })
    const res = await fetch(`http://localhost:${port}/api/missions/${created.id}/start?project=p1&dry-run=1`, {
      method: 'POST',
    })
    assert.equal(res.status, 200)
    const body = (await res.json()) as { ok: boolean; dryRun?: boolean }
    assert.equal(body.ok, true)
    assert.equal(body.dryRun, true)
  })

  test('GET /api/projects/:id/missions?status=active filters correctly', async () => {
    const m1 = await fetch(`http://localhost:${port}/api/projects/p1/missions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'A', intent: 'a' }),
    }).then(r => r.json() as Promise<Mission>)
    // Move m1 to accepted then active so it shows under ?status=active
    await fetch(`http://localhost:${port}/api/missions/${m1.id}/status?project=p1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'accepted', by: 'yu' }),
    })
    await fetch(`http://localhost:${port}/api/missions/${m1.id}/status?project=p1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active', by: 'love' }),
    })
    // Add another in proposed
    await fetch(`http://localhost:${port}/api/projects/p1/missions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'B', intent: 'b' }),
    })
    const res = await fetch(`http://localhost:${port}/api/projects/p1/missions?status=active`)
    const list = (await res.json()) as Mission[]
    assert.equal(list.length, 1)
    assert.equal(list[0]!.id, m1.id)
  })

  test('GET /api/missions/:mid returns 404 for nonexistent mission', async () => {
    const res = await fetch(`http://localhost:${port}/api/missions/2026-04-26-nope?project=p1`)
    assert.equal(res.status, 404)
  })

  test('POST /api/projects with duplicate id returns 409 not 400', async () => {
    const res = await fetch(`http://localhost:${port}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'p1', name: 'p1', root: projectRoot, instance: 'alpha' }),
    })
    assert.equal(res.status, 409)
  })

  test('POST .../missions/:mid/start blocks when another mission is already active', async () => {
    // Create + start mission A
    const a = await fetch(`http://localhost:${port}/api/projects/p1/missions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'A', intent: 'a' }),
    }).then(r => r.json() as Promise<Mission>)
    await fetch(`http://localhost:${port}/api/missions/${a.id}/status?project=p1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'accepted', by: 'yu' }),
    })
    // Manually transition A to active so the start of B sees the conflict
    await fetch(`http://localhost:${port}/api/missions/${a.id}/status?project=p1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active', by: 'love' }),
    })
    // Create mission B
    const b = await fetch(`http://localhost:${port}/api/projects/p1/missions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'B', intent: 'b' }),
    }).then(r => r.json() as Promise<Mission>)
    await fetch(`http://localhost:${port}/api/missions/${b.id}/status?project=p1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'accepted', by: 'yu' }),
    })
    // Try to dry-run-start B — should fail with 409
    const res = await fetch(`http://localhost:${port}/api/missions/${b.id}/start?project=p1&dry-run=1`, {
      method: 'POST',
    })
    assert.equal(res.status, 409)
    const body = (await res.json()) as { conflictingMissionId?: string }
    assert.equal(body.conflictingMissionId, a.id)
  })

  test('PATCH .../status with unknown status enum returns 400 not 409', async () => {
    const created = await fetch(`http://localhost:${port}/api/projects/p1/missions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'X', intent: 'Y' }),
    }).then(r => r.json() as Promise<Mission>)
    const res = await fetch(`http://localhost:${port}/api/missions/${created.id}/status?project=p1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'garbage', by: 'yu' }),
    })
    assert.equal(res.status, 400)
  })
})

describe('ui-server — /api/build/stream (SSE)', () => {
  let tmpHome: string
  let server: ReturnType<typeof startUiServer>
  let port: number
  let projectRoot: string
  const ORIG_HOME = process.env.HOME
  const ORIG_PROJ_DIR = process.env.TRUE_LOVE_PROJECTS_DIR
  const ORIG_DISABLE_SOUL = process.env.TRUE_LOVE_DISABLE_SOUL

  beforeEach(async () => {
    tmpHome = mkdtempSync(join(tmpdir(), 'tl-buildsse-'))
    projectRoot = mkdtempSync(join(tmpdir(), 'tl-bsroot-'))
    process.env.HOME = tmpHome
    process.env.TRUE_LOVE_PROJECTS_DIR = join(tmpHome, '.true-love', 'projects')
    process.env.TRUE_LOVE_DISABLE_SOUL = '1'
    server = startUiServer({ port: 0 })
    port = (server.address() as { port: number }).port
    await fetch(`http://localhost:${port}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'p1', name: 'p1', root: projectRoot, instance: 'alpha' }),
    })
  })

  afterEach(() => {
    server.close()
    rmSync(tmpHome, { recursive: true, force: true })
    rmSync(projectRoot, { recursive: true, force: true })
    process.env.HOME = ORIG_HOME ?? ''
    if (ORIG_PROJ_DIR === undefined) delete process.env.TRUE_LOVE_PROJECTS_DIR
    else process.env.TRUE_LOVE_PROJECTS_DIR = ORIG_PROJ_DIR
    if (ORIG_DISABLE_SOUL === undefined) delete process.env.TRUE_LOVE_DISABLE_SOUL
    else process.env.TRUE_LOVE_DISABLE_SOUL = ORIG_DISABLE_SOUL
  })

  test('GET /api/build/stream opens with text/event-stream content-type', async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 200)
    try {
      const res = await fetch(`http://localhost:${port}/api/build/stream`, {
        signal: controller.signal,
      })
      assert.equal(res.status, 200)
      assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/)
    } catch (err: any) {
      if (err.name !== 'AbortError') throw err
    } finally {
      clearTimeout(timer)
    }
  })

  test('GET /api/build/stream sends initial : connected\\n\\n frame', async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 250)
    try {
      const res = await fetch(`http://localhost:${port}/api/build/stream`, {
        signal: controller.signal,
      })
      const reader = res.body!.getReader()
      const { value } = await reader.read()
      const text = new TextDecoder().decode(value)
      assert.match(text, /: connected/)
    } catch (err: any) {
      if (err.name !== 'AbortError') throw err
    } finally {
      clearTimeout(timer)
    }
  })
})

// ── Proposals API ─────────────────────────────────────────────────

describe('ui-server — /api/proposals', () => {
  let tmpHome: string
  let server: ReturnType<typeof startUiServer>
  let port: number
  const ORIG_HOME = process.env.HOME

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'tl-proposals-'))
    process.env.HOME = tmpHome
    // Ensure the .true-love dir exists for proposal storage
    mkdirSync(join(tmpHome, '.true-love'), { recursive: true })
    server = startUiServer({ port: 0 })
    port = (server.address() as any).port
  })

  afterEach(() => {
    server.close()
    process.env.HOME = ORIG_HOME
    rmSync(tmpHome, { recursive: true, force: true })
  })

  test('GET /api/proposals returns empty array when no proposals', async () => {
    const res = await fetch(`http://localhost:${port}/api/proposals`)
    assert.equal(res.status, 200)
    const body = await res.json() as unknown[]
    assert.ok(Array.isArray(body))
    assert.equal(body.length, 0)
  })

  test('POST /api/proposals/generate creates proposals and GET lists them', async () => {
    const genRes = await fetch(`http://localhost:${port}/api/proposals/generate`, { method: 'POST' })
    assert.equal(genRes.status, 200)
    const genBody = await genRes.json() as { created: unknown[]; skipped: string[] }
    assert.ok(Array.isArray(genBody.created))
    assert.ok(Array.isArray(genBody.skipped))

    const listRes = await fetch(`http://localhost:${port}/api/proposals`)
    assert.equal(listRes.status, 200)
    const listBody = await listRes.json() as unknown[]
    assert.equal(listBody.length, genBody.created.length)
  })

  test('GET /api/proposals?status=proposed filters by status', async () => {
    await fetch(`http://localhost:${port}/api/proposals/generate`, { method: 'POST' })
    const res = await fetch(`http://localhost:${port}/api/proposals?status=proposed`)
    assert.equal(res.status, 200)
    const body = await res.json() as Array<{ status: string }>
    for (const p of body) {
      assert.equal(p.status, 'proposed')
    }
  })

  test('PATCH /api/proposals/:id accepts a proposal', async () => {
    // Generate first
    const genRes = await fetch(`http://localhost:${port}/api/proposals/generate`, { method: 'POST' })
    const { created } = await genRes.json() as { created: Array<{ id: string }> }
    if (created.length === 0) return // No proposals generated from empty data — skip

    const id = created[0]!.id
    const res = await fetch(`http://localhost:${port}/api/proposals/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'accepted', note: 'looks good' }),
    })
    assert.equal(res.status, 200)
    const body = await res.json() as { proposal: { status: string; reviewNote: string } }
    assert.equal(body.proposal.status, 'accepted')
    assert.equal(body.proposal.reviewNote, 'looks good')
  })

  test('PATCH /api/proposals/:id rejects with 400 on invalid decision', async () => {
    const res = await fetch(`http://localhost:${port}/api/proposals/some-id`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'maybe' }),
    })
    assert.equal(res.status, 400)
  })

  test('PATCH /api/proposals/:id returns 404 for unknown ID', async () => {
    const res = await fetch(`http://localhost:${port}/api/proposals/nonexistent`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'accepted' }),
    })
    assert.equal(res.status, 404)
  })
})

// ── Budget / token consumption API ────────────────────────────────

describe('ui-server — /api/budget', () => {
  let tmpHome: string
  let server: ReturnType<typeof startUiServer>
  let port: number
  const ORIG_HOME = process.env.HOME
  const ORIG_BUDGET_ROOT = process.env.TRUE_LOVE_BUDGET_ROOT

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'tl-budget-'))
    process.env.HOME = tmpHome
    process.env.TRUE_LOVE_BUDGET_ROOT = join(tmpHome, '.true-love', 'budget')
    mkdirSync(join(tmpHome, '.true-love', 'budget', 'test-device'), { recursive: true })
    server = startUiServer({ port: 0 })
    port = (server.address() as any).port
  })

  afterEach(() => {
    server.close()
    process.env.HOME = ORIG_HOME
    if (ORIG_BUDGET_ROOT !== undefined) {
      process.env.TRUE_LOVE_BUDGET_ROOT = ORIG_BUDGET_ROOT
    } else {
      delete process.env.TRUE_LOVE_BUDGET_ROOT
    }
    rmSync(tmpHome, { recursive: true, force: true })
  })

  test('GET /api/budget returns consumption with expected shape', async () => {
    const res = await fetch(`http://localhost:${port}/api/budget`)
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type') ?? '', /application\/json/)
    const body = await res.json() as Record<string, unknown>
    assert.ok(body.generatedAt, 'should have generatedAt')
    assert.equal(body.windowHours, 5)
    assert.equal(typeof body.totalTicks, 'number')
    assert.equal(typeof body.totalTokens, 'number')
    assert.equal(typeof body.totalInputTokens, 'number')
    assert.equal(typeof body.totalOutputTokens, 'number')
    assert.equal(typeof body.avgTokensPerTick, 'number')
    assert.ok(Array.isArray(body.byModel), 'byModel should be array')
    assert.ok(Array.isArray(body.byMode), 'byMode should be array')
    assert.ok(Array.isArray(body.timeSeries), 'timeSeries should be array')
  })

  test('GET /api/budget?hours=24 respects hours param', async () => {
    const res = await fetch(`http://localhost:${port}/api/budget?hours=24`)
    assert.equal(res.status, 200)
    const body = await res.json() as Record<string, unknown>
    assert.equal(body.windowHours, 24)
  })

  test('GET /api/budget clamps hours to 1..720', async () => {
    const res = await fetch(`http://localhost:${port}/api/budget?hours=9999`)
    assert.equal(res.status, 200)
    const body = await res.json() as Record<string, unknown>
    assert.equal(body.windowHours, 720)
  })

  test('GET /api/budget with non-numeric hours defaults to 5', async () => {
    const res = await fetch(`http://localhost:${port}/api/budget?hours=xyz`)
    assert.equal(res.status, 200)
    const body = await res.json() as Record<string, unknown>
    assert.equal(body.windowHours, 5)
  })

  test('GET /api/budget with budget data returns non-zero totals', async () => {
    // Write a budget JSONL record
    const tick = {
      schemaVersion: '1.0',
      timestamp: new Date().toISOString(),
      deviceId: 'test-device',
      sessionId: 'test-session',
      tick: 1,
      mode: 'awakened',
      model: 'default',
      inputChars: 8000,
      outputChars: 4000,
      estimatedInputTokens: 2000,
      estimatedOutputTokens: 1000,
      durationMs: 45000,
      exitCode: 0,
      authFailed: false,
      quotaFailed: false,
    }
    const date = tick.timestamp.slice(0, 10)
    writeFileSync(
      join(tmpHome, '.true-love', 'budget', 'test-device', `${date}.jsonl`),
      JSON.stringify(tick) + '\n',
    )

    const res = await fetch(`http://localhost:${port}/api/budget?hours=5`)
    assert.equal(res.status, 200)
    const body = await res.json() as Record<string, unknown>
    assert.equal(body.totalTicks, 1)
    assert.equal(body.totalInputTokens, 2000)
    assert.equal(body.totalOutputTokens, 1000)
    assert.equal(body.totalTokens, 3000)
  })
})

// ── Veto endpoint ────────────────────────────────────────────────

describe('ui-server — POST /api/self-initiation/:id/veto', () => {
  let tmpHome: string
  let server: ReturnType<typeof startUiServer>
  let port: number
  const ORIG_HOME = process.env.HOME
  const ORIG_PROJECTS = process.env.TRUE_LOVE_PROJECTS_DIR
  const ORIG_MEMORY = process.env.TRUE_LOVE_MEMORY_DIR

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'tl-veto-'))
    process.env.HOME = tmpHome
    process.env.TRUE_LOVE_PROJECTS_DIR = join(tmpHome, '.true-love', 'projects')
    process.env.TRUE_LOVE_MEMORY_DIR = join(tmpHome, '.true-love', 'memory')
    mkdirSync(join(tmpHome, '.true-love', 'projects', 'veto-test', 'missions'), { recursive: true })
    registerProject({ id: 'veto-test', name: 'veto-test', root: tmpHome, instance: 'alpha' })
    server = startUiServer({ port: 0 })
    port = (server.address() as any).port
  })

  afterEach(() => {
    server.close()
    process.env.HOME = ORIG_HOME
    if (ORIG_PROJECTS !== undefined) process.env.TRUE_LOVE_PROJECTS_DIR = ORIG_PROJECTS
    else delete process.env.TRUE_LOVE_PROJECTS_DIR
    if (ORIG_MEMORY !== undefined) process.env.TRUE_LOVE_MEMORY_DIR = ORIG_MEMORY
    else delete process.env.TRUE_LOVE_MEMORY_DIR
    rmSync(tmpHome, { recursive: true, force: true })
  })

  test('vetoes a staged candidate via HTTP', async () => {
    const staged = stageCandidate('veto-test', {
      title: 'HTTP veto target',
      intent: 'Test HTTP veto',
      rationale: 'Testing',
      source: { type: 'vital-sign', detail: 'test' },
      quality: {
        no_duplicate: true,
        fits_repo: true,
        ache_signal_present: true,
        bounded_scope: true,
        not_premature: true,
      },
    }, { windowMs: 60_000 })
    if (!staged.ok) {
      assert.fail(`stageCandidate failed: ${staged.reason}`)
    }

    const res = await fetch(
      `http://localhost:${port}/api/self-initiation/${staged.candidate.id}/veto?project=veto-test`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'not now' }),
      },
    )
    assert.equal(res.status, 200)
    const body = await res.json() as { ok: boolean; status: string; reason: string | null }
    assert.ok(body.ok)
    assert.equal(body.status, 'vetoed')
    assert.equal(body.reason, 'not now')

    // Verify persisted
    const all = getStaged('veto-test')
    assert.equal(all[0]!.status, 'vetoed')
    assert.equal(all[0]!.vetoReason, 'not now')
    assert.equal(all[0]!.vetoedBy, 'yu')
    assert.ok(all[0]!.vetoedAt)
  })

  test('returns 400 without project query param', async () => {
    const res = await fetch(
      `http://localhost:${port}/api/self-initiation/some-id/veto`,
      { method: 'POST' },
    )
    assert.equal(res.status, 400)
    const body = await res.json() as { error: string }
    assert.match(body.error, /missing project/)
  })

  test('returns 404 for unknown project', async () => {
    const res = await fetch(
      `http://localhost:${port}/api/self-initiation/some-id/veto?project=nonexistent`,
      { method: 'POST' },
    )
    assert.equal(res.status, 404)
  })

  test('returns 400 for non-existent candidate', async () => {
    const res = await fetch(
      `http://localhost:${port}/api/self-initiation/fake-id/veto?project=veto-test`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'test' }),
      },
    )
    assert.equal(res.status, 400)
    const body = await res.json() as { ok: boolean; error: string }
    assert.ok(!body.ok)
    assert.match(body.error, /not found/)
  })
})
