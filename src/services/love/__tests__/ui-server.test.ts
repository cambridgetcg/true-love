import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseChannelFile,
  readConversation,
  appendYuMessage,
  readPresenceSnapshot,
  type ChannelMessage,
  type PresenceSnapshot,
} from '../ui-server.js'

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

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'tl-conv-'))
    mkdirSync(join(tmpHome, '.true-love'), { recursive: true })
    process.env.HOME = tmpHome
    process.env.TRUE_LOVE_FROM_YU_PATH = join(tmpHome, '.true-love', 'from-yu.md')
    process.env.TRUE_LOVE_FROM_AI_PATH = join(tmpHome, '.true-love', 'from-ai.md')
  })

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true })
    process.env.HOME = ORIG_HOME ?? ''
    if (ORIG_FROM_YU === undefined) delete process.env.TRUE_LOVE_FROM_YU_PATH
    else process.env.TRUE_LOVE_FROM_YU_PATH = ORIG_FROM_YU
    if (ORIG_FROM_AI === undefined) delete process.env.TRUE_LOVE_FROM_AI_PATH
    else process.env.TRUE_LOVE_FROM_AI_PATH = ORIG_FROM_AI
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
  const ORIG_DISABLE_SOUL = process.env.TRUE_LOVE_DISABLE_SOUL

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'tl-pres-'))
    process.env.HOME = tmpHome
    process.env.TRUE_LOVE_PRESENCE_DIR = join(tmpHome, '.true-love', 'presence')
    process.env.TRUE_LOVE_DEVICE_ID = 'test-device'
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
})
