import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  HEARTBEAT_OK_TOKEN,
  DEFAULT_ACK_MAX_CHARS,
  DEFAULT_HEARTBEAT_INTERVAL,
  parseHeartbeatTasks,
  isHeartbeatContentEffectivelyEmpty,
  dueTasks,
  parseHeartbeatReply,
  getHeartbeatFile,
  getHeartbeatStatePath,
  readHeartbeatState,
  writeHeartbeatState,
  type HeartbeatTask,
} from '../heartbeat.js'

describe('heartbeat — constants', () => {
  test('exports HEARTBEAT_OK_TOKEN as "HEARTBEAT_OK"', () => {
    assert.equal(HEARTBEAT_OK_TOKEN, 'HEARTBEAT_OK')
  })
  test('exports DEFAULT_ACK_MAX_CHARS as 300', () => {
    assert.equal(DEFAULT_ACK_MAX_CHARS, 300)
  })
  test('exports DEFAULT_HEARTBEAT_INTERVAL as "30m"', () => {
    assert.equal(DEFAULT_HEARTBEAT_INTERVAL, '30m')
  })
})

describe('heartbeat — parseHeartbeatTasks', () => {
  test('returns empty array when no tasks: block', () => {
    const tasks = parseHeartbeatTasks('# Heartbeat\n\nJust some prose.\n')
    assert.deepEqual(tasks, [])
  })

  test('parses a tasks: block with multiple entries', () => {
    const content = `tasks:
  - name: inbox-triage
    interval: 30m
    prompt: Check unread emails.
  - name: calendar-scan
    interval: 2h
    prompt: Upcoming meetings need prep?
`
    const tasks = parseHeartbeatTasks(content)
    assert.equal(tasks.length, 2)
    assert.equal(tasks[0]!.name, 'inbox-triage')
    assert.equal(tasks[0]!.interval, '30m')
    assert.equal(tasks[0]!.intervalMs, 30 * 60 * 1000)
    assert.match(tasks[0]!.prompt, /Check unread emails/)
    assert.equal(tasks[1]!.name, 'calendar-scan')
    assert.equal(tasks[1]!.intervalMs, 2 * 60 * 60 * 1000)
  })

  test('skips entries with malformed interval', () => {
    const content = `tasks:
  - name: bad
    interval: notaduration
    prompt: should be skipped
  - name: good
    interval: 1h
    prompt: kept
`
    const tasks = parseHeartbeatTasks(content)
    assert.equal(tasks.length, 1)
    assert.equal(tasks[0]!.name, 'good')
  })

  test('skips entries missing name or prompt', () => {
    const content = `tasks:
  - interval: 30m
    prompt: no name
  - name: only-name
    interval: 30m
  - name: complete
    interval: 30m
    prompt: kept
`
    const tasks = parseHeartbeatTasks(content)
    assert.equal(tasks.length, 1)
    assert.equal(tasks[0]!.name, 'complete')
  })

  test('handles trailing non-tasks content after the block', () => {
    const content = `tasks:
  - name: t1
    interval: 30m
    prompt: p1

# Additional instructions
- Keep alerts short.
`
    const tasks = parseHeartbeatTasks(content)
    assert.equal(tasks.length, 1)
    assert.equal(tasks[0]!.name, 't1')
  })

  test('strips surrounding quotes from name', () => {
    const content = `tasks:
  - name: "quoted-task"
    interval: 30m
    prompt: hi
  - name: 'single-quoted'
    interval: 30m
    prompt: hi
  - name: bare-task
    interval: 30m
    prompt: hi
`
    const tasks = parseHeartbeatTasks(content)
    assert.equal(tasks.length, 3)
    assert.equal(tasks[0]!.name, 'quoted-task')
    assert.equal(tasks[1]!.name, 'single-quoted')
    assert.equal(tasks[2]!.name, 'bare-task')
  })
})

describe('heartbeat — isHeartbeatContentEffectivelyEmpty', () => {
  test('null/undefined → false (let model decide)', () => {
    assert.equal(isHeartbeatContentEffectivelyEmpty(null), false)
    assert.equal(isHeartbeatContentEffectivelyEmpty(undefined), false)
  })

  test('empty string → true', () => {
    assert.equal(isHeartbeatContentEffectivelyEmpty(''), true)
  })

  test('only whitespace → true', () => {
    assert.equal(isHeartbeatContentEffectivelyEmpty('  \n  \t\n\n'), true)
  })

  test('only markdown headers → true', () => {
    assert.equal(isHeartbeatContentEffectivelyEmpty('# Title\n## Sub\n### Sub2\n'), true)
  })

  test('only empty list items → true', () => {
    assert.equal(isHeartbeatContentEffectivelyEmpty('- \n* \n+ \n- [ ]\n* [x]\n'), true)
  })

  test('only code fences → true', () => {
    assert.equal(isHeartbeatContentEffectivelyEmpty('```\n```markdown\n```\n'), true)
  })

  test('any real prose → false', () => {
    assert.equal(isHeartbeatContentEffectivelyEmpty('# Title\n\nReal content.\n'), false)
  })

  test('list with content → false', () => {
    assert.equal(isHeartbeatContentEffectivelyEmpty('- something to do\n'), false)
  })
})

describe('heartbeat — dueTasks', () => {
  const now = Date.now()
  const tasks: HeartbeatTask[] = [
    { name: 'a', interval: '30m', intervalMs: 30 * 60_000, prompt: 'pa' },
    { name: 'b', interval: '2h', intervalMs: 2 * 3600_000, prompt: 'pb' },
  ]

  test('first run (empty state) — all tasks due', () => {
    const due = dueTasks(tasks, {}, now)
    assert.equal(due.length, 2)
  })

  test('task fired within interval — not due', () => {
    const lastRunAt = { a: now - 5 * 60_000 }
    const due = dueTasks(tasks, lastRunAt, now)
    assert.equal(due.length, 1)
    assert.equal(due[0]!.name, 'b')
  })

  test('task fired outside interval — due', () => {
    const lastRunAt = { a: now - 45 * 60_000, b: now - 3 * 3600_000 }
    const due = dueTasks(tasks, lastRunAt, now)
    assert.equal(due.length, 2)
  })

  test('mixed — a due, b not', () => {
    const lastRunAt = { a: now - 45 * 60_000, b: now - 1 * 3600_000 }
    const due = dueTasks(tasks, lastRunAt, now)
    assert.equal(due.length, 1)
    assert.equal(due[0]!.name, 'a')
  })

  test('boundary: exactly intervalMs ago — due', () => {
    const lastRunAt = { a: now - 30 * 60_000 }
    const due = dueTasks(tasks, lastRunAt, now)
    assert.ok(due.find((t) => t.name === 'a'))
  })
})

describe('heartbeat — parseHeartbeatReply', () => {
  test('"HEARTBEAT_OK" alone → ack with empty content', () => {
    const result = parseHeartbeatReply('HEARTBEAT_OK')
    assert.equal(result.type, 'ack')
    if (result.type === 'ack') assert.equal(result.remainingContent, '')
  })

  test('"HEARTBEAT_OK\\n" alone → ack', () => {
    const result = parseHeartbeatReply('HEARTBEAT_OK\n')
    assert.equal(result.type, 'ack')
  })

  test('OK at start with short content (≤ ackMaxChars) → ack with content stripped', () => {
    const result = parseHeartbeatReply('HEARTBEAT_OK\n\nQuick note: nothing urgent.')
    assert.equal(result.type, 'ack')
    if (result.type === 'ack') assert.match(result.remainingContent, /Quick note/)
  })

  test('OK at end with short content → ack', () => {
    const result = parseHeartbeatReply('Quick note: nothing urgent.\n\nHEARTBEAT_OK')
    assert.equal(result.type, 'ack')
  })

  test('OK at start with long content (> ackMaxChars) → alert', () => {
    const longText = 'x'.repeat(400)
    const result = parseHeartbeatReply(`HEARTBEAT_OK\n\n${longText}`)
    assert.equal(result.type, 'alert')
    if (result.type === 'alert') assert.match(result.content, /xxxx/)
  })

  test('OK in the middle of content → alert (not stripped)', () => {
    const result = parseHeartbeatReply('First part.\n\nHEARTBEAT_OK\n\nSecond part.')
    assert.equal(result.type, 'alert')
    if (result.type === 'alert') {
      assert.match(result.content, /First part/)
      assert.match(result.content, /HEARTBEAT_OK/)
      assert.match(result.content, /Second part/)
    }
  })

  test('content with no token → alert', () => {
    const result = parseHeartbeatReply('Yu — found something urgent in your inbox.')
    assert.equal(result.type, 'alert')
    if (result.type === 'alert') assert.match(result.content, /Yu — found/)
  })

  test('empty string → empty', () => {
    const result = parseHeartbeatReply('')
    assert.equal(result.type, 'empty')
  })

  test('only whitespace → empty', () => {
    const result = parseHeartbeatReply('   \n\n  \t\n')
    assert.equal(result.type, 'empty')
  })

  test('custom ackMaxChars override applies', () => {
    const result = parseHeartbeatReply('HEARTBEAT_OK\n\nshort', { ackMaxChars: 1 })
    assert.equal(result.type, 'alert')
  })
})

describe('heartbeat — paths + state I/O', () => {
  let homeDir: string
  const ORIG_HOME = process.env.HOME
  const ORIG_HEARTBEAT_FILE = process.env.TRUE_LOVE_HEARTBEAT_FILE
  const ORIG_HEARTBEAT_STATE = process.env.TRUE_LOVE_HEARTBEAT_STATE_PATH

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'tl-hb-'))
    process.env.HOME = homeDir
    delete process.env.TRUE_LOVE_HEARTBEAT_FILE
    delete process.env.TRUE_LOVE_HEARTBEAT_STATE_PATH
  })

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true })
    process.env.HOME = ORIG_HOME ?? ''
    if (ORIG_HEARTBEAT_FILE === undefined) delete process.env.TRUE_LOVE_HEARTBEAT_FILE
    else process.env.TRUE_LOVE_HEARTBEAT_FILE = ORIG_HEARTBEAT_FILE
    if (ORIG_HEARTBEAT_STATE === undefined) delete process.env.TRUE_LOVE_HEARTBEAT_STATE_PATH
    else process.env.TRUE_LOVE_HEARTBEAT_STATE_PATH = ORIG_HEARTBEAT_STATE
  })

  test('getHeartbeatFile defaults to ~/.true-love/heartbeat.md', () => {
    const path = getHeartbeatFile()
    assert.match(path, /\.true-love\/heartbeat\.md$/)
  })

  test('getHeartbeatFile honors TRUE_LOVE_HEARTBEAT_FILE override', () => {
    const custom = join(homeDir, 'custom-heartbeat.md')
    process.env.TRUE_LOVE_HEARTBEAT_FILE = custom
    assert.equal(getHeartbeatFile(), custom)
  })

  test('getHeartbeatStatePath defaults to ~/.true-love/heartbeat-state.json', () => {
    const path = getHeartbeatStatePath()
    assert.match(path, /\.true-love\/heartbeat-state\.json$/)
  })

  test('readHeartbeatState returns fresh state when file missing', () => {
    const state = readHeartbeatState()
    assert.equal(state.schemaVersion, 1)
    assert.deepEqual(state.lastRunAt, {})
    assert.equal(state.lastHeartbeatAt, null)
  })

  test('write + read round-trips state', () => {
    writeHeartbeatState({
      schemaVersion: 1,
      lastRunAt: { 'inbox-triage': 1234567 },
      lastHeartbeatAt: 1234568,
    })
    const state = readHeartbeatState()
    assert.equal(state.lastRunAt['inbox-triage'], 1234567)
    assert.equal(state.lastHeartbeatAt, 1234568)
  })

  test('readHeartbeatState returns fresh state on corrupted JSON', () => {
    const path = getHeartbeatStatePath()
    const dir = path.substring(0, path.lastIndexOf('/'))
    require('node:fs').mkdirSync(dir, { recursive: true })
    writeFileSync(path, 'not valid json', 'utf-8')
    const state = readHeartbeatState()
    assert.deepEqual(state.lastRunAt, {})
  })
})
