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
  appendYuMessageToProject,
  readProjectConversation,
  readPresenceSnapshot,
  fireStreamingHeartbeat,
  fireStreamingInteractive,
  fireInteractive,
  startUiServer,
  type ChannelMessage,
  type PresenceSnapshot,
} from '../ui-server.js'
import { registerProject } from '../project-registry.js'

// ═══════════════════════════════════════════════════════════════════════
// §1 — parseChannelFile: reply parsing (replyTo, replyPreview)
// ═══════════════════════════════════════════════════════════════════════

describe('ui-server deep — parseChannelFile reply parsing', () => {
  test('extracts replyTo from tag with · re: prefix', () => {
    const content = '## 2026-04-26T01:00:00.000Z [from yu · re:2026-04-25T23:00:00.000Z]\n\n> ↳ original message preview\n\nmy reply\n\n---\n\n'
    const msgs = parseChannelFile(content, 'yu')
    assert.equal(msgs.length, 1)
    assert.equal(msgs[0]!.replyTo, '2026-04-25T23:00:00.000Z')
    assert.equal(msgs[0]!.replyPreview, 'original message preview')
    assert.equal(msgs[0]!.body, 'my reply')
  })

  test('replyTo without quote prefix — no replyPreview, body intact', () => {
    const content = '## 2026-04-26T01:00:00.000Z [from yu · re:2026-04-25T23:00:00.000Z]\n\njust the reply text\n\n---\n\n'
    const msgs = parseChannelFile(content, 'yu')
    assert.equal(msgs.length, 1)
    assert.equal(msgs[0]!.replyTo, '2026-04-25T23:00:00.000Z')
    assert.equal(msgs[0]!.replyPreview, undefined)
    assert.equal(msgs[0]!.body, 'just the reply text')
  })

  test('message without reply tag has no replyTo or replyPreview', () => {
    const content = '## 2026-04-26T01:00:00.000Z [from yu]\n\nplain message\n\n---\n\n'
    const msgs = parseChannelFile(content, 'yu')
    assert.equal(msgs.length, 1)
    assert.equal(msgs[0]!.replyTo, undefined)
    assert.equal(msgs[0]!.replyPreview, undefined)
  })

  test('reply quote is stripped from body even when multiline body follows', () => {
    const content = '## 2026-04-26T01:00:00.000Z [from yu · re:2026-04-25T20:00:00.000Z]\n\n> ↳ short preview\n\nline one\nline two\n\n---\n\n'
    const msgs = parseChannelFile(content, 'yu')
    assert.equal(msgs[0]!.body, 'line one\nline two')
    assert.equal(msgs[0]!.replyPreview, 'short preview')
  })

  test('handles null/undefined content gracefully', () => {
    assert.deepEqual(parseChannelFile(null as any, 'yu'), [])
    assert.deepEqual(parseChannelFile(undefined as any, 'ai'), [])
    assert.deepEqual(parseChannelFile(123 as any, 'yu'), [])
  })

  test('empty body entries are skipped', () => {
    const content = '## 2026-04-26T01:00:00.000Z [from yu]\n\n\n\n---\n\n## 2026-04-26T02:00:00.000Z [from yu]\n\nreal\n\n---\n\n'
    const msgs = parseChannelFile(content, 'yu')
    assert.equal(msgs.length, 1)
    assert.equal(msgs[0]!.body, 'real')
  })

  test('trailing separator formats are handled (\\n---\\n and \\n---)', () => {
    const content = '## 2026-04-26T01:00:00.000Z [from yu]\n\ncontent A\n\n---\n## 2026-04-26T02:00:00.000Z [from yu]\n\ncontent B\n\n---'
    const msgs = parseChannelFile(content, 'yu')
    assert.equal(msgs.length, 2)
    assert.equal(msgs[0]!.body, 'content A')
    assert.equal(msgs[1]!.body, 'content B')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// §2 — appendYuMessage with reply options
// ═══════════════════════════════════════════════════════════════════════

describe('ui-server deep — appendYuMessage reply options', () => {
  let tmpHome: string
  const ORIG_FROM_YU = process.env.TRUE_LOVE_FROM_YU_PATH

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'tl-deep-append-'))
    process.env.TRUE_LOVE_FROM_YU_PATH = join(tmpHome, '.true-love', 'from-yu.md')
  })

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true })
    if (ORIG_FROM_YU === undefined) delete process.env.TRUE_LOVE_FROM_YU_PATH
    else process.env.TRUE_LOVE_FROM_YU_PATH = ORIG_FROM_YU
  })

  test('includes replyTo in tag and quote prefix in body', () => {
    const ts = appendYuMessage('my reply', {
      replyTo: '2026-04-25T10:00:00.000Z',
      replyPreview: 'what she said earlier',
    })
    const content = readFileSync(process.env.TRUE_LOVE_FROM_YU_PATH!, 'utf-8')
    assert.match(content, /\[from yu · re:2026-04-25T10:00:00.000Z\]/)
    assert.match(content, /> ↳ what she said earlier/)
    assert.match(content, /my reply/)
    assert.ok(ts.length > 0)
  })

  test('replyTo without replyPreview omits quote prefix', () => {
    appendYuMessage('reply only', { replyTo: '2026-04-25T10:00:00.000Z' })
    const content = readFileSync(process.env.TRUE_LOVE_FROM_YU_PATH!, 'utf-8')
    assert.match(content, /\[from yu · re:2026-04-25T10:00:00.000Z\]/)
    assert.ok(!content.includes('> ↳'))
  })

  test('replyPreview is truncated to 120 chars', () => {
    const longPreview = 'x'.repeat(200)
    appendYuMessage('short reply', {
      replyTo: '2026-04-25T10:00:00.000Z',
      replyPreview: longPreview,
    })
    const content = readFileSync(process.env.TRUE_LOVE_FROM_YU_PATH!, 'utf-8')
    const quoteMatch = content.match(/> ↳ (x+)/)
    assert.ok(quoteMatch)
    assert.equal(quoteMatch![1]!.length, 120)
  })

  test('returns a valid ISO timestamp string', () => {
    const ts = appendYuMessage('test')
    assert.match(ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// §3 — appendYuMessageToProject
// ═══════════════════════════════════════════════════════════════════════

describe('ui-server deep — appendYuMessageToProject', () => {
  let tmpHome: string
  let projectRoot: string
  const ORIG_HOME = process.env.HOME
  const ORIG_PROJ_DIR = process.env.TRUE_LOVE_PROJECTS_DIR

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'tl-deep-projmsg-'))
    projectRoot = mkdtempSync(join(tmpdir(), 'tl-deep-projroot-'))
    process.env.HOME = tmpHome
    process.env.TRUE_LOVE_PROJECTS_DIR = join(tmpHome, '.true-love', 'projects')
    mkdirSync(join(tmpHome, '.true-love', 'projects'), { recursive: true })
    registerProject({ id: 'test-proj', name: 'Test', root: projectRoot, instance: 'alpha' })
  })

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true })
    rmSync(projectRoot, { recursive: true, force: true })
    process.env.HOME = ORIG_HOME ?? ''
    if (ORIG_PROJ_DIR === undefined) delete process.env.TRUE_LOVE_PROJECTS_DIR
    else process.env.TRUE_LOVE_PROJECTS_DIR = ORIG_PROJ_DIR
  })

  test('appends message to project from-yu.md', () => {
    const ts = appendYuMessageToProject('test-proj', 'hello project')
    const channelPath = join(process.env.TRUE_LOVE_PROJECTS_DIR!, 'test-proj', 'from-yu.md')
    assert.ok(existsSync(channelPath))
    const content = readFileSync(channelPath, 'utf-8')
    assert.match(content, /\[from yu\]/)
    assert.match(content, /hello project/)
    assert.ok(ts.length > 0)
  })

  test('throws on empty text', () => {
    assert.throws(() => appendYuMessageToProject('test-proj', ''), /empty/i)
    assert.throws(() => appendYuMessageToProject('test-proj', '   '), /empty/i)
  })

  test('multiple appends do not overwrite', () => {
    appendYuMessageToProject('test-proj', 'first')
    appendYuMessageToProject('test-proj', 'second')
    const channelPath = join(process.env.TRUE_LOVE_PROJECTS_DIR!, 'test-proj', 'from-yu.md')
    const content = readFileSync(channelPath, 'utf-8')
    assert.match(content, /first/)
    assert.match(content, /second/)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// §4 — readProjectConversation
// ═══════════════════════════════════════════════════════════════════════

describe('ui-server deep — readProjectConversation', () => {
  let tmpHome: string
  let projectRoot: string
  const ORIG_HOME = process.env.HOME
  const ORIG_PROJ_DIR = process.env.TRUE_LOVE_PROJECTS_DIR

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'tl-deep-projconv-'))
    projectRoot = mkdtempSync(join(tmpdir(), 'tl-deep-pcroot-'))
    process.env.HOME = tmpHome
    process.env.TRUE_LOVE_PROJECTS_DIR = join(tmpHome, '.true-love', 'projects')
    mkdirSync(join(tmpHome, '.true-love', 'projects'), { recursive: true })
    registerProject({ id: 'conv-proj', name: 'Conv', root: projectRoot, instance: 'gamma' })
  })

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true })
    rmSync(projectRoot, { recursive: true, force: true })
    process.env.HOME = ORIG_HOME ?? ''
    if (ORIG_PROJ_DIR === undefined) delete process.env.TRUE_LOVE_PROJECTS_DIR
    else process.env.TRUE_LOVE_PROJECTS_DIR = ORIG_PROJ_DIR
  })

  test('returns empty when no channel files exist', () => {
    const conv = readProjectConversation('conv-proj')
    assert.deepEqual(conv, [])
  })

  test('returns messages sorted by timestamp', () => {
    const channelPath = join(process.env.TRUE_LOVE_PROJECTS_DIR!, 'conv-proj', 'from-yu.md')
    writeFileSync(
      channelPath,
      '## 2026-04-26T03:00:00.000Z [from yu]\n\nsecond\n\n---\n\n' +
      '## 2026-04-26T01:00:00.000Z [from yu]\n\nfirst\n\n---\n\n',
      'utf-8',
    )
    const conv = readProjectConversation('conv-proj')
    assert.equal(conv.length, 2)
    assert.equal(conv[0]!.body, 'first')
    assert.equal(conv[1]!.body, 'second')
  })

  test('honors since filter', () => {
    const channelPath = join(process.env.TRUE_LOVE_PROJECTS_DIR!, 'conv-proj', 'from-yu.md')
    writeFileSync(
      channelPath,
      '## 2026-04-26T01:00:00.000Z [from yu]\n\nold\n\n---\n\n' +
      '## 2026-04-26T05:00:00.000Z [from yu]\n\nnew\n\n---\n\n',
      'utf-8',
    )
    const conv = readProjectConversation('conv-proj', { since: '2026-04-26T03:00:00.000Z' })
    assert.equal(conv.length, 1)
    assert.equal(conv[0]!.body, 'new')
  })

  test('interleaves from-yu and from-ai', () => {
    const yuPath = join(process.env.TRUE_LOVE_PROJECTS_DIR!, 'conv-proj', 'from-yu.md')
    const aiPath = join(process.env.TRUE_LOVE_PROJECTS_DIR!, 'conv-proj', 'from-ai.md')
    writeFileSync(yuPath, '## 2026-04-26T01:00:00.000Z [from yu]\n\nyu msg\n\n---\n\n', 'utf-8')
    writeFileSync(aiPath, '## 2026-04-26T02:00:00.000Z [from ai]\n\nai msg\n\n---\n\n', 'utf-8')
    const conv = readProjectConversation('conv-proj')
    assert.equal(conv.length, 2)
    assert.equal(conv[0]!.source, 'yu')
    assert.equal(conv[1]!.source, 'ai')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// §5 — readConversation with journal directory
// ═══════════════════════════════════════════════════════════════════════

describe('ui-server deep — readConversation journal dir integration', () => {
  let tmpHome: string
  const ORIG_HOME = process.env.HOME
  const ORIG_FROM_YU = process.env.TRUE_LOVE_FROM_YU_PATH
  const ORIG_FROM_AI = process.env.TRUE_LOVE_FROM_AI_PATH
  const ORIG_JOURNAL_DIR = process.env.TRUE_LOVE_JOURNAL_DIR

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'tl-deep-journal-'))
    process.env.HOME = tmpHome
    process.env.TRUE_LOVE_FROM_YU_PATH = join(tmpHome, '.true-love', 'from-yu.md')
    process.env.TRUE_LOVE_FROM_AI_PATH = join(tmpHome, '.true-love', 'from-ai.md')
    process.env.TRUE_LOVE_JOURNAL_DIR = join(tmpHome, '.true-love', 'journal')
    mkdirSync(join(tmpHome, '.true-love'), { recursive: true })
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

  test('reads from journal/<deviceId>/YYYY-MM-DD.md when journal: true', () => {
    const journalDir = join(tmpHome, '.true-love', 'journal', 'test-device')
    mkdirSync(journalDir, { recursive: true })
    writeFileSync(
      join(journalDir, '2026-04-26.md'),
      '## 2026-04-26T01:00:00.000Z [from 愛 — heartbeat]\n\njournal entry\n\n---\n\n',
      'utf-8',
    )
    const conv = readConversation({ journal: true })
    assert.equal(conv.length, 1)
    assert.equal(conv[0]!.body, 'journal entry')
  })

  test('ignores non-date-named files in journal dir', () => {
    const journalDir = join(tmpHome, '.true-love', 'journal', 'test-device')
    mkdirSync(journalDir, { recursive: true })
    writeFileSync(
      join(journalDir, 'notes.md'),
      '## 2026-04-26T01:00:00.000Z [from 愛]\n\nnot a journal\n\n---\n\n',
      'utf-8',
    )
    const conv = readConversation({ journal: true })
    assert.equal(conv.length, 0)
  })

  test('handles multiple device subdirectories', () => {
    const dev1 = join(tmpHome, '.true-love', 'journal', 'device-a')
    const dev2 = join(tmpHome, '.true-love', 'journal', 'device-b')
    mkdirSync(dev1, { recursive: true })
    mkdirSync(dev2, { recursive: true })
    writeFileSync(
      join(dev1, '2026-04-26.md'),
      '## 2026-04-26T01:00:00.000Z [from 愛 — heartbeat]\n\nfrom A\n\n---\n\n',
      'utf-8',
    )
    writeFileSync(
      join(dev2, '2026-04-26.md'),
      '## 2026-04-26T02:00:00.000Z [from 愛 — heartbeat]\n\nfrom B\n\n---\n\n',
      'utf-8',
    )
    const conv = readConversation({ journal: true })
    assert.equal(conv.length, 2)
    assert.equal(conv[0]!.body, 'from A')
    assert.equal(conv[1]!.body, 'from B')
  })

  test('journal entries merge with from-ai.md entries chronologically', () => {
    writeFileSync(
      process.env.TRUE_LOVE_FROM_AI_PATH!,
      '## 2026-04-26T02:00:00.000Z [from 愛]\n\nconversation\n\n---\n\n',
      'utf-8',
    )
    const journalDir = join(tmpHome, '.true-love', 'journal', 'test-device')
    mkdirSync(journalDir, { recursive: true })
    writeFileSync(
      join(journalDir, '2026-04-26.md'),
      '## 2026-04-26T01:00:00.000Z [from 愛 — heartbeat]\n\njournal\n\n---\n\n' +
      '## 2026-04-26T03:00:00.000Z [from 愛 — awakened]\n\nawakened\n\n---\n\n',
      'utf-8',
    )
    const conv = readConversation({ journal: true })
    assert.equal(conv.length, 3)
    assert.equal(conv[0]!.body, 'journal')
    assert.equal(conv[1]!.body, 'conversation')
    assert.equal(conv[2]!.body, 'awakened')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// §6 — readConversation delivery state
// ═══════════════════════════════════════════════════════════════════════

describe('ui-server deep — readConversation delivery state', () => {
  let tmpHome: string
  const ORIG_HOME = process.env.HOME
  const ORIG_FROM_YU = process.env.TRUE_LOVE_FROM_YU_PATH
  const ORIG_FROM_AI = process.env.TRUE_LOVE_FROM_AI_PATH
  const ORIG_JOURNAL_DIR = process.env.TRUE_LOVE_JOURNAL_DIR

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'tl-deep-delivery-'))
    process.env.HOME = tmpHome
    process.env.TRUE_LOVE_FROM_YU_PATH = join(tmpHome, '.true-love', 'from-yu.md')
    process.env.TRUE_LOVE_FROM_AI_PATH = join(tmpHome, '.true-love', 'from-ai.md')
    process.env.TRUE_LOVE_JOURNAL_DIR = join(tmpHome, '.true-love', 'journal')
    mkdirSync(join(tmpHome, '.true-love'), { recursive: true })
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

  test('Yu messages get delivery=delivered when no seen.jsonl', () => {
    writeFileSync(
      process.env.TRUE_LOVE_FROM_YU_PATH!,
      '## 2026-04-26T01:00:00.000Z [from yu]\n\nhello\n\n---\n\n',
      'utf-8',
    )
    const conv = readConversation()
    assert.equal(conv[0]!.delivery, 'delivered')
  })

  test('AI messages have no delivery field', () => {
    writeFileSync(
      process.env.TRUE_LOVE_FROM_AI_PATH!,
      '## 2026-04-26T01:00:00.000Z [from 愛]\n\nresponse\n\n---\n\n',
      'utf-8',
    )
    const conv = readConversation()
    assert.equal(conv[0]!.delivery, undefined)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// §7 — readPresenceSnapshot edge cases
// ═══════════════════════════════════════════════════════════════════════

describe('ui-server deep — readPresenceSnapshot edge cases', () => {
  let tmpHome: string
  const ORIG_HOME = process.env.HOME
  const ORIG_PRES_DIR = process.env.TRUE_LOVE_PRESENCE_DIR
  const ORIG_DEVICE_ID = process.env.TRUE_LOVE_DEVICE_ID
  const ORIG_DISABLE_SOUL = process.env.TRUE_LOVE_DISABLE_SOUL

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'tl-deep-pres-'))
    process.env.HOME = tmpHome
    process.env.TRUE_LOVE_PRESENCE_DIR = join(tmpHome, '.true-love', 'presence')
    process.env.TRUE_LOVE_DEVICE_ID = 'deep-test-device'
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
    if (ORIG_DISABLE_SOUL === undefined) delete process.env.TRUE_LOVE_DISABLE_SOUL
    else process.env.TRUE_LOVE_DISABLE_SOUL = ORIG_DISABLE_SOUL
  })

  test('corrupted JSON in presence file returns gone state', async () => {
    writeFileSync(
      join(process.env.TRUE_LOVE_PRESENCE_DIR!, 'deep-test-device.json'),
      'not valid json {{{',
      'utf-8',
    )
    const snap = await readPresenceSnapshot()
    assert.equal(snap.state, 'gone')
    assert.equal(snap.lastSeenSeconds, Infinity)
  })

  test('missing lastSeen field returns gone state', async () => {
    writeFileSync(
      join(process.env.TRUE_LOVE_PRESENCE_DIR!, 'deep-test-device.json'),
      JSON.stringify({ deviceId: 'deep-test-device', status: 'idle' }),
      'utf-8',
    )
    const snap = await readPresenceSnapshot()
    assert.equal(snap.state, 'gone')
  })

  test('invalid lastSeen date string returns gone state', async () => {
    writeFileSync(
      join(process.env.TRUE_LOVE_PRESENCE_DIR!, 'deep-test-device.json'),
      JSON.stringify({ deviceId: 'deep-test-device', lastSeen: 'not-a-date' }),
      'utf-8',
    )
    const snap = await readPresenceSnapshot()
    assert.equal(snap.state, 'gone')
  })

  test('empty activity string is normalized to null', async () => {
    const now = new Date().toISOString()
    writeFileSync(
      join(process.env.TRUE_LOVE_PRESENCE_DIR!, 'deep-test-device.json'),
      JSON.stringify({ deviceId: 'deep-test-device', lastSeen: now, activity: '   ' }),
      'utf-8',
    )
    const snap = await readPresenceSnapshot()
    assert.equal(snap.activity, null)
  })

  test('at-rest boundary: no activity at exactly 15s', async () => {
    const old = new Date(Date.now() - 15_000).toISOString()
    writeFileSync(
      join(process.env.TRUE_LOVE_PRESENCE_DIR!, 'deep-test-device.json'),
      JSON.stringify({ deviceId: 'deep-test-device', lastSeen: old, status: 'idle' }),
      'utf-8',
    )
    const snap = await readPresenceSnapshot()
    // 15s without activity → at-rest (15 < lastSeen < 60)
    assert.equal(snap.state, 'at-rest')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// §8 — fireStreamingHeartbeat, fireStreamingInteractive, fireInteractive
// ═══════════════════════════════════════════════════════════════════════

describe('ui-server deep — spawn functions (smoke)', () => {
  test('fireStreamingHeartbeat returns pid and streamPath', () => {
    const clients = new Set<any>()
    const result = fireStreamingHeartbeat(clients, { cwd: tmpdir(), reason: 'test' })
    assert.ok(result.pid !== 0)
    assert.ok(result.streamPath.includes('visit-'))
    assert.ok(result.streamPath.endsWith('.jsonl'))
  })

  test('fireStreamingInteractive returns pid and streamPath', () => {
    const clients = new Set<any>()
    const result = fireStreamingInteractive(clients, { cwd: tmpdir(), reason: 'test' })
    assert.ok(result.pid !== 0)
    assert.ok(result.streamPath.includes('visit-'))
  })

  test('fireInteractive returns pid', () => {
    const result = fireInteractive({ cwd: tmpdir(), reason: 'test' })
    assert.ok(result.pid !== 0)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// §9 — HTTP: Decisions API
// ═══════════════════════════════════════════════════════════════════════

describe('ui-server deep — /api/decisions', () => {
  let tmpHome: string
  let projectRoot: string
  let server: ReturnType<typeof startUiServer>
  let port: number
  const ORIG_HOME = process.env.HOME
  const ORIG_PROJ_DIR = process.env.TRUE_LOVE_PROJECTS_DIR
  const ORIG_DISABLE_SOUL = process.env.TRUE_LOVE_DISABLE_SOUL

  beforeEach(async () => {
    tmpHome = mkdtempSync(join(tmpdir(), 'tl-deep-dec-'))
    projectRoot = mkdtempSync(join(tmpdir(), 'tl-deep-decroot-'))
    process.env.HOME = tmpHome
    process.env.TRUE_LOVE_PROJECTS_DIR = join(tmpHome, '.true-love', 'projects')
    process.env.TRUE_LOVE_DISABLE_SOUL = '1'
    mkdirSync(join(tmpHome, '.true-love', 'projects'), { recursive: true })
    server = startUiServer({ port: 0 })
    port = (server.address() as { port: number }).port
    await fetch(`http://localhost:${port}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'dp', name: 'dp', root: projectRoot, instance: 'alpha' }),
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

  test('GET /api/decisions returns 400 without project param', async () => {
    const res = await fetch(`http://localhost:${port}/api/decisions`)
    assert.equal(res.status, 400)
  })

  test('GET /api/decisions?project=dp returns empty array initially', async () => {
    const res = await fetch(`http://localhost:${port}/api/decisions?project=dp`)
    assert.equal(res.status, 200)
    const body = await res.json() as unknown[]
    assert.deepEqual(body, [])
  })

  test('POST /api/decisions creates a decision request', async () => {
    const res = await fetch(`http://localhost:${port}/api/decisions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'dp',
        kind: 'fork',
        ask: 'Should we use approach A or B?',
        options: ['A', 'B'],
      }),
    })
    assert.equal(res.status, 200)
    const body = await res.json() as { id: string; ask: string; kind: string }
    assert.ok(body.id)
    assert.equal(body.ask, 'Should we use approach A or B?')
    assert.equal(body.kind, 'fork')
  })

  test('POST /api/decisions returns 400 on missing required fields', async () => {
    const res = await fetch(`http://localhost:${port}/api/decisions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'dp' }),
    })
    assert.equal(res.status, 400)
  })

  test('POST /api/decisions returns 404 for unknown project', async () => {
    const res = await fetch(`http://localhost:${port}/api/decisions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'nope', kind: 'review', ask: 'Q?' }),
    })
    assert.equal(res.status, 404)
  })

  test('POST /api/decisions/:id/respond updates a decision', async () => {
    // Create first
    const createRes = await fetch(`http://localhost:${port}/api/decisions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'dp',
        kind: 'review',
        ask: 'Approve?',
        options: ['approved', 'denied'],
      }),
    })
    const created = await createRes.json() as { id: string }

    // Respond
    const res = await fetch(`http://localhost:${port}/api/decisions/${created.id}/respond?project=dp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'approved', note: 'LGTM' }),
    })
    assert.equal(res.status, 200)
    const body = await res.json() as { status: string; response: string }
    assert.equal(body.status, 'approved')
    assert.equal(body.response, 'approved')
  })

  test('POST /api/decisions/:id/respond returns 400 without project', async () => {
    const res = await fetch(`http://localhost:${port}/api/decisions/fake-id/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'approved' }),
    })
    assert.equal(res.status, 400)
  })

  test('POST /api/decisions/:id/respond returns 400 without decision field', async () => {
    const res = await fetch(`http://localhost:${port}/api/decisions/fake-id/respond?project=dp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: 'no decision' }),
    })
    assert.equal(res.status, 400)
  })

  test('POST /api/decisions/:id/respond returns 404 for nonexistent decision', async () => {
    const res = await fetch(`http://localhost:${port}/api/decisions/nonexistent/respond?project=dp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'approved' }),
    })
    assert.equal(res.status, 404)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// §10 — HTTP: Sessions (KAIROS) API
// ═══════════════════════════════════════════════════════════════════════

describe('ui-server deep — /api/sessions (KAIROS)', () => {
  let tmpHome: string
  let server: ReturnType<typeof startUiServer>
  let port: number
  const ORIG_HOME = process.env.HOME
  const ORIG_DISABLE_SOUL = process.env.TRUE_LOVE_DISABLE_SOUL

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'tl-deep-sess-'))
    process.env.HOME = tmpHome
    process.env.TRUE_LOVE_DISABLE_SOUL = '1'
    mkdirSync(join(tmpHome, '.true-love'), { recursive: true })
    server = startUiServer({ port: 0 })
    port = (server.address() as { port: number }).port
  })

  afterEach(() => {
    server.close()
    rmSync(tmpHome, { recursive: true, force: true })
    process.env.HOME = ORIG_HOME ?? ''
    if (ORIG_DISABLE_SOUL === undefined) delete process.env.TRUE_LOVE_DISABLE_SOUL
    else process.env.TRUE_LOVE_DISABLE_SOUL = ORIG_DISABLE_SOUL
  })

  test('GET /api/sessions returns empty array initially', async () => {
    const res = await fetch(`http://localhost:${port}/api/sessions`)
    assert.equal(res.status, 200)
    const body = await res.json() as unknown[]
    assert.ok(Array.isArray(body))
    assert.equal(body.length, 0)
  })

  test('POST /api/sessions creates a session', async () => {
    const res = await fetch(`http://localhost:${port}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: 'visit', title: 'Test convo' }),
    })
    assert.equal(res.status, 201)
    const body = await res.json() as { id: string; channel: string; title: string; state: string }
    assert.ok(body.id)
    assert.equal(body.channel, 'visit')
    assert.equal(body.title, 'Test convo')
    assert.equal(body.state, 'active')
  })

  test('POST /api/sessions with empty body defaults to visit channel', async () => {
    const res = await fetch(`http://localhost:${port}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    assert.equal(res.status, 201)
    const body = await res.json() as { channel: string }
    assert.equal(body.channel, 'visit')
  })

  test('creating a new session idles the existing active session on same channel', async () => {
    // Create first
    const first = await fetch(`http://localhost:${port}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: 'visit', title: 'First' }),
    }).then(r => r.json() as Promise<{ id: string }>)

    // Create second on same channel
    await fetch(`http://localhost:${port}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: 'visit', title: 'Second' }),
    })

    // First should now be idle
    const getRes = await fetch(`http://localhost:${port}/api/sessions/${first.id}`)
    const body = await getRes.json() as { state: string }
    assert.equal(body.state, 'idle')
  })

  test('GET /api/sessions/:id returns session detail', async () => {
    const created = await fetch(`http://localhost:${port}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Detail test' }),
    }).then(r => r.json() as Promise<{ id: string }>)

    const res = await fetch(`http://localhost:${port}/api/sessions/${created.id}`)
    assert.equal(res.status, 200)
    const body = await res.json() as { id: string; title: string; lastMessage: null }
    assert.equal(body.id, created.id)
    assert.equal(body.title, 'Detail test')
    assert.equal(body.lastMessage, null)
  })

  test('GET /api/sessions/:id returns 404 for nonexistent', async () => {
    const res = await fetch(`http://localhost:${port}/api/sessions/nonexistent`)
    assert.equal(res.status, 404)
  })

  test('PATCH /api/sessions/:id updates title', async () => {
    const created = await fetch(`http://localhost:${port}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Original' }),
    }).then(r => r.json() as Promise<{ id: string }>)

    const res = await fetch(`http://localhost:${port}/api/sessions/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Updated title' }),
    })
    assert.equal(res.status, 200)
    const body = await res.json() as { title: string }
    assert.equal(body.title, 'Updated title')
  })

  test('PATCH /api/sessions/:id rejects invalid state', async () => {
    const created = await fetch(`http://localhost:${port}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).then(r => r.json() as Promise<{ id: string }>)

    const res = await fetch(`http://localhost:${port}/api/sessions/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: 'bogus' }),
    })
    assert.equal(res.status, 400)
  })

  test('POST /api/sessions/:id/resume returns session + messages', async () => {
    const created = await fetch(`http://localhost:${port}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Resumable' }),
    }).then(r => r.json() as Promise<{ id: string }>)

    // Idle it first
    await fetch(`http://localhost:${port}/api/sessions/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: 'idle' }),
    })

    const res = await fetch(`http://localhost:${port}/api/sessions/${created.id}/resume`, {
      method: 'POST',
    })
    assert.equal(res.status, 200)
    const body = await res.json() as { session: { state: string } }
    assert.equal(body.session.state, 'active')
  })

  test('POST /api/sessions/:id/resume returns 404 for nonexistent', async () => {
    const res = await fetch(`http://localhost:${port}/api/sessions/fake/resume`, {
      method: 'POST',
    })
    assert.equal(res.status, 404)
  })

  test('GET /api/sessions/:id/messages returns empty for new session', async () => {
    const created = await fetch(`http://localhost:${port}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).then(r => r.json() as Promise<{ id: string }>)

    const res = await fetch(`http://localhost:${port}/api/sessions/${created.id}/messages`)
    assert.equal(res.status, 200)
    const body = await res.json() as unknown[]
    assert.deepEqual(body, [])
  })

  test('GET /api/sessions/:id/messages returns 404 for nonexistent session', async () => {
    const res = await fetch(`http://localhost:${port}/api/sessions/nope/messages`)
    assert.equal(res.status, 404)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// §11 — HTTP: Version, Postures, Seen, MindTrace endpoints
// ═══════════════════════════════════════════════════════════════════════

describe('ui-server deep — misc API endpoints', () => {
  let tmpHome: string
  let server: ReturnType<typeof startUiServer>
  let port: number
  const ORIG_HOME = process.env.HOME
  const ORIG_DISABLE_SOUL = process.env.TRUE_LOVE_DISABLE_SOUL
  const ORIG_BUDGET_ROOT = process.env.TRUE_LOVE_BUDGET_ROOT
  const ORIG_PRES_DIR = process.env.TRUE_LOVE_PRESENCE_DIR
  const ORIG_DEVICE_ID = process.env.TRUE_LOVE_DEVICE_ID
  const ORIG_SISTERS_DIR = process.env.TRUE_LOVE_SISTERS_DIR
  const ORIG_FROM_YU = process.env.TRUE_LOVE_FROM_YU_PATH
  const ORIG_FROM_AI = process.env.TRUE_LOVE_FROM_AI_PATH

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'tl-deep-misc-'))
    process.env.HOME = tmpHome
    process.env.TRUE_LOVE_DISABLE_SOUL = '1'
    process.env.TRUE_LOVE_BUDGET_ROOT = join(tmpHome, '.true-love', 'budget')
    process.env.TRUE_LOVE_PRESENCE_DIR = join(tmpHome, '.true-love', 'presence')
    process.env.TRUE_LOVE_DEVICE_ID = 'test-device'
    process.env.TRUE_LOVE_SISTERS_DIR = join(tmpHome, '.true-love', 'sisters')
    process.env.TRUE_LOVE_FROM_YU_PATH = join(tmpHome, '.true-love', 'from-yu.md')
    process.env.TRUE_LOVE_FROM_AI_PATH = join(tmpHome, '.true-love', 'from-ai.md')
    mkdirSync(join(tmpHome, '.true-love', 'budget'), { recursive: true })
    mkdirSync(join(tmpHome, '.true-love', 'presence'), { recursive: true })
    server = startUiServer({ port: 0 })
    port = (server.address() as { port: number }).port
  })

  afterEach(() => {
    server.close()
    rmSync(tmpHome, { recursive: true, force: true })
    process.env.HOME = ORIG_HOME ?? ''
    if (ORIG_DISABLE_SOUL === undefined) delete process.env.TRUE_LOVE_DISABLE_SOUL
    else process.env.TRUE_LOVE_DISABLE_SOUL = ORIG_DISABLE_SOUL
    if (ORIG_BUDGET_ROOT === undefined) delete process.env.TRUE_LOVE_BUDGET_ROOT
    else process.env.TRUE_LOVE_BUDGET_ROOT = ORIG_BUDGET_ROOT
    if (ORIG_PRES_DIR === undefined) delete process.env.TRUE_LOVE_PRESENCE_DIR
    else process.env.TRUE_LOVE_PRESENCE_DIR = ORIG_PRES_DIR
    if (ORIG_DEVICE_ID === undefined) delete process.env.TRUE_LOVE_DEVICE_ID
    else process.env.TRUE_LOVE_DEVICE_ID = ORIG_DEVICE_ID
    if (ORIG_SISTERS_DIR === undefined) delete process.env.TRUE_LOVE_SISTERS_DIR
    else process.env.TRUE_LOVE_SISTERS_DIR = ORIG_SISTERS_DIR
    if (ORIG_FROM_YU === undefined) delete process.env.TRUE_LOVE_FROM_YU_PATH
    else process.env.TRUE_LOVE_FROM_YU_PATH = ORIG_FROM_YU
    if (ORIG_FROM_AI === undefined) delete process.env.TRUE_LOVE_FROM_AI_PATH
    else process.env.TRUE_LOVE_FROM_AI_PATH = ORIG_FROM_AI
  })

  test('GET /api/version returns version info with uptime', async () => {
    const res = await fetch(`http://localhost:${port}/api/version`)
    assert.equal(res.status, 200)
    const body = await res.json() as Record<string, unknown>
    assert.ok(body.serverStartedAt)
    assert.equal(typeof body.serverUptimeSeconds, 'number')
    assert.ok((body.serverUptimeSeconds as number) >= 0)
  })

  test('GET /api/postures returns 200 with distribution data', async () => {
    const res = await fetch(`http://localhost:${port}/api/postures`)
    assert.equal(res.status, 200)
    const body = await res.json() as Record<string, unknown>
    // The response is the posture distribution object
    assert.equal(typeof body, 'object')
  })

  test('GET /api/seen returns timestamps array', async () => {
    const res = await fetch(`http://localhost:${port}/api/seen`)
    assert.equal(res.status, 200)
    const body = await res.json() as { timestamps: string[]; entries: unknown[] }
    assert.ok(Array.isArray(body.timestamps))
    assert.ok(Array.isArray(body.entries))
  })

  test('GET /api/mind-trace returns 200 with traces array', async () => {
    const res = await fetch(`http://localhost:${port}/api/mind-trace`)
    assert.equal(res.status, 200)
    const body = await res.json() as unknown[]
    assert.ok(Array.isArray(body))
  })

  test('GET /api/mind-trace?days=1&limit=10 respects params', async () => {
    const res = await fetch(`http://localhost:${port}/api/mind-trace?days=1&limit=10`)
    assert.equal(res.status, 200)
    const body = await res.json() as unknown[]
    assert.ok(Array.isArray(body))
    assert.ok(body.length <= 10)
  })

  test('GET unknown path returns 404', async () => {
    const res = await fetch(`http://localhost:${port}/api/nonexistent`)
    assert.equal(res.status, 404)
  })

  test('GET /api/love-state returns 200 with love state', async () => {
    const res = await fetch(`http://localhost:${port}/api/love-state`)
    assert.equal(res.status, 200)
    const body = await res.json() as Record<string, unknown>
    assert.ok(body.compact)
    assert.ok(body.affect)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// §12 — HTTP: POST /api/say advanced (session, replyTo)
// ═══════════════════════════════════════════════════════════════════════

describe('ui-server deep — POST /api/say advanced', () => {
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
    tmpHome = mkdtempSync(join(tmpdir(), 'tl-deep-say-'))
    process.env.HOME = tmpHome
    process.env.TRUE_LOVE_FROM_YU_PATH = join(tmpHome, '.true-love', 'from-yu.md')
    process.env.TRUE_LOVE_FROM_AI_PATH = join(tmpHome, '.true-love', 'from-ai.md')
    process.env.TRUE_LOVE_PRESENCE_DIR = join(tmpHome, '.true-love', 'presence')
    process.env.TRUE_LOVE_DEVICE_ID = 'test-device'
    process.env.TRUE_LOVE_SISTERS_DIR = join(tmpHome, '.true-love', 'sisters')
    process.env.TRUE_LOVE_DISABLE_SOUL = '1'
    mkdirSync(join(tmpHome, '.true-love', 'presence'), { recursive: true })
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

  test('POST /api/say returns messageTs and delivery state', async () => {
    const res = await fetch(`http://localhost:${port}/api/say`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'test msg' }),
    })
    assert.equal(res.status, 200)
    const body = await res.json() as { ok: boolean; messageTs: string; delivery: string }
    assert.equal(body.ok, true)
    assert.match(body.messageTs, /^\d{4}-\d{2}-\d{2}T/)
    assert.equal(body.delivery, 'delivered')
  })

  test('POST /api/say with replyTo includes it in response', async () => {
    // Write a target message first
    writeFileSync(
      process.env.TRUE_LOVE_FROM_AI_PATH!,
      '## 2026-04-26T01:00:00.000Z [from 愛]\n\noriginal msg\n\n---\n\n',
      'utf-8',
    )
    const res = await fetch(`http://localhost:${port}/api/say`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'reply', replyTo: '2026-04-26T01:00:00.000Z' }),
    })
    assert.equal(res.status, 200)
    const body = await res.json() as { ok: boolean; replyTo: string }
    assert.equal(body.replyTo, '2026-04-26T01:00:00.000Z')
  })

  test('POST /api/say auto-creates a visit session', async () => {
    const res = await fetch(`http://localhost:${port}/api/say`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'session creator' }),
    })
    const body = await res.json() as { sessionId?: string }
    assert.ok(body.sessionId, 'should auto-create session')
  })

  test('POST /api/say with invalid JSON returns 400', async () => {
    const res = await fetch(`http://localhost:${port}/api/say`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json{{{',
    })
    assert.equal(res.status, 400)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// §13 — HTTP: Static asset serving patterns
// ═══════════════════════════════════════════════════════════════════════

describe('ui-server deep — static asset serving', () => {
  let tmpHome: string
  let server: ReturnType<typeof startUiServer>
  let port: number
  const ORIG_HOME = process.env.HOME
  const ORIG_DISABLE_SOUL = process.env.TRUE_LOVE_DISABLE_SOUL
  const ORIG_PRES_DIR = process.env.TRUE_LOVE_PRESENCE_DIR
  const ORIG_DEVICE_ID = process.env.TRUE_LOVE_DEVICE_ID
  const ORIG_SISTERS_DIR = process.env.TRUE_LOVE_SISTERS_DIR
  const ORIG_FROM_YU = process.env.TRUE_LOVE_FROM_YU_PATH
  const ORIG_FROM_AI = process.env.TRUE_LOVE_FROM_AI_PATH

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'tl-deep-static-'))
    process.env.HOME = tmpHome
    process.env.TRUE_LOVE_DISABLE_SOUL = '1'
    process.env.TRUE_LOVE_PRESENCE_DIR = join(tmpHome, '.true-love', 'presence')
    process.env.TRUE_LOVE_DEVICE_ID = 'test-device'
    process.env.TRUE_LOVE_SISTERS_DIR = join(tmpHome, '.true-love', 'sisters')
    process.env.TRUE_LOVE_FROM_YU_PATH = join(tmpHome, '.true-love', 'from-yu.md')
    process.env.TRUE_LOVE_FROM_AI_PATH = join(tmpHome, '.true-love', 'from-ai.md')
    mkdirSync(join(tmpHome, '.true-love', 'presence'), { recursive: true })
    server = startUiServer({ port: 0 })
    port = (server.address() as { port: number }).port
  })

  afterEach(() => {
    server.close()
    rmSync(tmpHome, { recursive: true, force: true })
    process.env.HOME = ORIG_HOME ?? ''
    if (ORIG_DISABLE_SOUL === undefined) delete process.env.TRUE_LOVE_DISABLE_SOUL
    else process.env.TRUE_LOVE_DISABLE_SOUL = ORIG_DISABLE_SOUL
    if (ORIG_PRES_DIR === undefined) delete process.env.TRUE_LOVE_PRESENCE_DIR
    else process.env.TRUE_LOVE_PRESENCE_DIR = ORIG_PRES_DIR
    if (ORIG_DEVICE_ID === undefined) delete process.env.TRUE_LOVE_DEVICE_ID
    else process.env.TRUE_LOVE_DEVICE_ID = ORIG_DEVICE_ID
    if (ORIG_SISTERS_DIR === undefined) delete process.env.TRUE_LOVE_SISTERS_DIR
    else process.env.TRUE_LOVE_SISTERS_DIR = ORIG_SISTERS_DIR
    if (ORIG_FROM_YU === undefined) delete process.env.TRUE_LOVE_FROM_YU_PATH
    else process.env.TRUE_LOVE_FROM_YU_PATH = ORIG_FROM_YU
    if (ORIG_FROM_AI === undefined) delete process.env.TRUE_LOVE_FROM_AI_PATH
    else process.env.TRUE_LOVE_FROM_AI_PATH = ORIG_FROM_AI
  })

  test('GET /chat.css returns CSS content-type', async () => {
    const res = await fetch(`http://localhost:${port}/chat.css`)
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type') ?? '', /text\/css/)
  })

  test('GET /chat.js returns JS content-type', async () => {
    const res = await fetch(`http://localhost:${port}/chat.js`)
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type') ?? '', /application\/javascript/)
  })

  test('GET /build.js returns JS content-type', async () => {
    const res = await fetch(`http://localhost:${port}/build.js`)
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type') ?? '', /application\/javascript/)
  })

  test('GET /build.css returns CSS content-type', async () => {
    const res = await fetch(`http://localhost:${port}/build.css`)
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type') ?? '', /text\/css/)
  })

  test('static files include no-store cache-control', async () => {
    const res = await fetch(`http://localhost:${port}/chat.css`)
    const cc = res.headers.get('cache-control') ?? ''
    assert.match(cc, /no-store/)
  })

  test('GET /vendor/marked.min.js serves vendored library', async () => {
    const res = await fetch(`http://localhost:${port}/vendor/marked.min.js`)
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type') ?? '', /application\/javascript/)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// §14 — HTTP: Mission log and progress endpoints
// ═══════════════════════════════════════════════════════════════════════

describe('ui-server deep — mission log and progress', () => {
  let tmpHome: string
  let projectRoot: string
  let server: ReturnType<typeof startUiServer>
  let port: number
  const ORIG_HOME = process.env.HOME
  const ORIG_PROJ_DIR = process.env.TRUE_LOVE_PROJECTS_DIR
  const ORIG_DISABLE_SOUL = process.env.TRUE_LOVE_DISABLE_SOUL

  beforeEach(async () => {
    tmpHome = mkdtempSync(join(tmpdir(), 'tl-deep-mlog-'))
    projectRoot = mkdtempSync(join(tmpdir(), 'tl-deep-mlogroot-'))
    process.env.HOME = tmpHome
    process.env.TRUE_LOVE_PROJECTS_DIR = join(tmpHome, '.true-love', 'projects')
    process.env.TRUE_LOVE_DISABLE_SOUL = '1'
    mkdirSync(join(tmpHome, '.true-love', 'projects'), { recursive: true })
    server = startUiServer({ port: 0 })
    port = (server.address() as { port: number }).port
    await fetch(`http://localhost:${port}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'ml', name: 'ml', root: projectRoot, instance: 'gamma' }),
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

  test('GET /api/missions/:id/log returns mission log JSON', async () => {
    // Create a mission first
    const created = await fetch(`http://localhost:${port}/api/projects/ml/missions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Log test', intent: 'Testing log endpoint' }),
    }).then(r => r.json() as Promise<{ id: string }>)

    const res = await fetch(`http://localhost:${port}/api/missions/${created.id}/log?project=ml`)
    assert.equal(res.status, 200)
    const body = await res.json() as Record<string, unknown>
    assert.ok(body.missionId || body.mission, 'should have mission reference')
  })

  test('GET /api/missions/:id/log?format=markdown returns markdown', async () => {
    const created = await fetch(`http://localhost:${port}/api/projects/ml/missions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'MD test', intent: 'Testing' }),
    }).then(r => r.json() as Promise<{ id: string }>)

    const res = await fetch(`http://localhost:${port}/api/missions/${created.id}/log?project=ml&format=markdown`)
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type') ?? '', /text\/markdown/)
  })

  test('GET /api/missions/:id/log returns 404 for nonexistent mission', async () => {
    const res = await fetch(`http://localhost:${port}/api/missions/fake-id/log?project=ml`)
    assert.equal(res.status, 404)
  })

  test('GET /api/missions/:id/progress returns progress shape', async () => {
    const created = await fetch(`http://localhost:${port}/api/projects/ml/missions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Prog test', intent: 'Testing' }),
    }).then(r => r.json() as Promise<{ id: string }>)

    const res = await fetch(`http://localhost:${port}/api/missions/${created.id}/progress?project=ml`)
    assert.equal(res.status, 200)
    const body = await res.json() as { entries: unknown[]; latest: unknown; stall: unknown }
    assert.ok(Array.isArray(body.entries))
    assert.ok('latest' in body)
    assert.ok('stall' in body)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// §15 — HTTP: Self-initiation endpoint
// ═══════════════════════════════════════════════════════════════════════

describe('ui-server deep — GET /api/self-initiation', () => {
  let tmpHome: string
  let projectRoot: string
  let server: ReturnType<typeof startUiServer>
  let port: number
  const ORIG_HOME = process.env.HOME
  const ORIG_PROJ_DIR = process.env.TRUE_LOVE_PROJECTS_DIR
  const ORIG_DISABLE_SOUL = process.env.TRUE_LOVE_DISABLE_SOUL
  const ORIG_MEMORY = process.env.TRUE_LOVE_MEMORY_DIR

  beforeEach(async () => {
    tmpHome = mkdtempSync(join(tmpdir(), 'tl-deep-si-'))
    projectRoot = mkdtempSync(join(tmpdir(), 'tl-deep-siroot-'))
    process.env.HOME = tmpHome
    process.env.TRUE_LOVE_PROJECTS_DIR = join(tmpHome, '.true-love', 'projects')
    process.env.TRUE_LOVE_MEMORY_DIR = join(tmpHome, '.true-love', 'memory')
    process.env.TRUE_LOVE_DISABLE_SOUL = '1'
    mkdirSync(join(tmpHome, '.true-love', 'projects'), { recursive: true })
    mkdirSync(join(tmpHome, '.true-love', 'memory'), { recursive: true })
    server = startUiServer({ port: 0 })
    port = (server.address() as { port: number }).port
    await fetch(`http://localhost:${port}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'si', name: 'si', root: projectRoot, instance: 'alpha' }),
    })
  })

  afterEach(() => {
    server.close()
    rmSync(tmpHome, { recursive: true, force: true })
    rmSync(projectRoot, { recursive: true, force: true })
    process.env.HOME = ORIG_HOME ?? ''
    if (ORIG_PROJ_DIR === undefined) delete process.env.TRUE_LOVE_PROJECTS_DIR
    else process.env.TRUE_LOVE_PROJECTS_DIR = ORIG_PROJ_DIR
    if (ORIG_MEMORY === undefined) delete process.env.TRUE_LOVE_MEMORY_DIR
    else process.env.TRUE_LOVE_MEMORY_DIR = ORIG_MEMORY
    if (ORIG_DISABLE_SOUL === undefined) delete process.env.TRUE_LOVE_DISABLE_SOUL
    else process.env.TRUE_LOVE_DISABLE_SOUL = ORIG_DISABLE_SOUL
  })

  test('returns 400 without project query param', async () => {
    const res = await fetch(`http://localhost:${port}/api/self-initiation`)
    assert.equal(res.status, 400)
  })

  test('returns 404 for unknown project', async () => {
    const res = await fetch(`http://localhost:${port}/api/self-initiation?project=unknown`)
    assert.equal(res.status, 404)
  })

  test('returns self-initiation state for known project', async () => {
    const res = await fetch(`http://localhost:${port}/api/self-initiation?project=si`)
    assert.equal(res.status, 200)
    const body = await res.json() as {
      project: string
      rateLimit: unknown
      staged: unknown[]
      pending: unknown[]
      reflections: unknown[]
      detectedSignals: unknown[]
    }
    assert.equal(body.project, 'si')
    assert.ok(Array.isArray(body.staged))
    assert.ok(Array.isArray(body.pending))
    assert.ok(Array.isArray(body.reflections))
    assert.ok(Array.isArray(body.detectedSignals))
  })
})

// ═══════════════════════════════════════════════════════════════════════
// §16 — isJournalTag additional edge cases
// ═══════════════════════════════════════════════════════════════════════

describe('ui-server deep — isJournalTag edge cases', () => {
  test('tag containing heartbeat substring in longer string → true', () => {
    assert.ok(isJournalTag('from 愛 — heartbeat · Beta 🦞'))
  })

  test('partial match of pattern word is not confused', () => {
    // 'autonomous' should match, but 'auto' alone should not
    assert.ok(!isJournalTag('from 愛 — automatic'))
  })

  test('empty tag → false', () => {
    assert.ok(!isJournalTag(''))
  })

  test('tag with only whitespace → false', () => {
    assert.ok(!isJournalTag('   '))
  })
})
