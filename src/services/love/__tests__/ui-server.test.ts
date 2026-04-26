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
  fireHeartbeat,
  startUiServer,
  type ChannelMessage,
  type PresenceSnapshot,
} from '../ui-server.js'
import type { Project } from '../project-registry.js'
import type { Thought } from '../thoughts-channel.js'

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
  const ORIG_DISABLE_SOUL = process.env.TRUE_LOVE_DISABLE_SOUL

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'tl-http-'))
    mkdirSync(join(tmpHome, '.true-love', 'presence'), { recursive: true })
    process.env.HOME = tmpHome
    process.env.TRUE_LOVE_FROM_YU_PATH = join(tmpHome, '.true-love', 'from-yu.md')
    process.env.TRUE_LOVE_FROM_AI_PATH = join(tmpHome, '.true-love', 'from-ai.md')
    process.env.TRUE_LOVE_PRESENCE_DIR = join(tmpHome, '.true-love', 'presence')
    process.env.TRUE_LOVE_DEVICE_ID = 'test-device'
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
})

describe('ui-server — /api/projects', () => {
  let tmpHome: string
  let server: ReturnType<typeof startUiServer>
  let port: number
  let projectRoot: string
  const ORIG_HOME = process.env.HOME
  const ORIG_PROJ_DIR = process.env.TRUE_LOVE_PROJECTS_DIR

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
    delete process.env.TRUE_LOVE_DISABLE_SOUL
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
    delete process.env.TRUE_LOVE_DISABLE_SOUL
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
