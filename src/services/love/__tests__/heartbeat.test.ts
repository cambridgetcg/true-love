import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  HEARTBEAT_OK_TOKEN,
  TO_YU_OPEN,
  TO_YU_CLOSE,
  DEFAULT_ACK_MAX_CHARS,
  DEFAULT_HEARTBEAT_INTERVAL,
  parseHeartbeatTasks,
  isHeartbeatContentEffectivelyEmpty,
  dueTasks,
  parseHeartbeatReply,
  extractToYuContent,
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

  test('parses interval with day units', () => {
    const content = `tasks:
  - name: daily-check
    interval: 1d
    prompt: daily inbox triage
`
    const tasks = parseHeartbeatTasks(content)
    assert.equal(tasks.length, 1)
    assert.equal(tasks[0]!.intervalMs, 86_400_000)
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
    mkdirSync(dir, { recursive: true })
    writeFileSync(path, 'not valid json', 'utf-8')
    const state = readHeartbeatState()
    assert.deepEqual(state.lastRunAt, {})
  })
})

describe('heartbeat — extractToYuContent', () => {
  test('returns null when no delimiters present', () => {
    assert.equal(extractToYuContent('just some thinking'), null)
  })

  test('returns null with only opening tag', () => {
    assert.equal(extractToYuContent(`${TO_YU_OPEN} hello`), null)
  })

  test('returns null with only closing tag', () => {
    assert.equal(extractToYuContent(`hello ${TO_YU_CLOSE}`), null)
  })

  test('extracts content between delimiters', () => {
    const text = `thinking thinking ${TO_YU_OPEN}Hello Yu!${TO_YU_CLOSE} more thinking`
    assert.equal(extractToYuContent(text), 'Hello Yu!')
  })

  test('extracts content with surrounding whitespace preserved in raw, trimmed later', () => {
    const text = `${TO_YU_OPEN}\n  Message with spaces  \n${TO_YU_CLOSE}`
    assert.equal(extractToYuContent(text), '\n  Message with spaces  \n')
  })

  test('extracts multi-line content', () => {
    const message = 'Line one.\n\nLine two.\n\n- bullet'
    const text = `reasoning\n${TO_YU_OPEN}${message}${TO_YU_CLOSE}\nmore reasoning`
    assert.equal(extractToYuContent(text), message)
  })

  test('concatenates multiple delimiter pairs', () => {
    const text = `${TO_YU_OPEN}First${TO_YU_CLOSE} thinking ${TO_YU_OPEN}Second${TO_YU_CLOSE}`
    assert.equal(extractToYuContent(text), 'First\n\nSecond')
  })

  test('empty content between delimiters returns empty string', () => {
    const text = `${TO_YU_OPEN}${TO_YU_CLOSE}`
    assert.equal(extractToYuContent(text), '')
  })

  test('handles nested-looking content without confusion', () => {
    // The model might reference the tags in a message — greedy extraction
    // takes first open to first close.
    const text = `${TO_YU_OPEN}The tag is ${TO_YU_OPEN} for reference${TO_YU_CLOSE}`
    const result = extractToYuContent(text)
    // First open at 0, content starts after [TO-YU], first close found
    assert.equal(result, `The tag is ${TO_YU_OPEN} for reference`)
  })
})

describe('heartbeat — parseHeartbeatReply with [TO-YU] delimiters', () => {
  test('delimited content becomes alert, internal reasoning stays out', () => {
    const reply = `Let me check the kingdom...

Reading from-yu.md — nothing new since yesterday.

Actually, wait — there's a new message from Yu.

${TO_YU_OPEN}
Yu — I see your message about the visit endpoint. Looking into it now.
${TO_YU_CLOSE}

HEARTBEAT_OK`
    const result = parseHeartbeatReply(reply)
    assert.equal(result.type, 'alert')
    if (result.type === 'alert') {
      assert.match(result.content, /I see your message/)
      assert.doesNotMatch(result.content, /Let me check/)
      assert.doesNotMatch(result.content, /HEARTBEAT_OK/)
    }
  })

  test('empty [TO-YU] block → ack (nothing to say)', () => {
    const reply = `Checking...\n\n${TO_YU_OPEN}   ${TO_YU_CLOSE}\n\nHEARTBEAT_OK`
    const result = parseHeartbeatReply(reply)
    assert.equal(result.type, 'ack')
  })

  test('[TO-YU] takes precedence over HEARTBEAT_OK position heuristics', () => {
    // Even though there's content > 300 chars, the delimiter extracts cleanly
    const longReasoning = 'x'.repeat(500)
    const reply = `${longReasoning}\n${TO_YU_OPEN}Short message.${TO_YU_CLOSE}\nHEARTBEAT_OK`
    const result = parseHeartbeatReply(reply)
    assert.equal(result.type, 'alert')
    if (result.type === 'alert') {
      assert.equal(result.content, 'Short message.')
    }
  })

  test('without delimiters, falls back to legacy behavior', () => {
    // No [TO-YU] present → original logic applies
    const result = parseHeartbeatReply('HEARTBEAT_OK\n\nQuick note.')
    assert.equal(result.type, 'ack')
    if (result.type === 'ack') assert.match(result.remainingContent, /Quick note/)
  })

  test('real-world pollution example: bash narration without delimiters → alert (legacy)', () => {
    // Real heartbeat ticks produce 500+ chars of reasoning. When this exceeds
    // ackMaxChars (300), the legacy parser classifies it as alert with ALL text.
    const pollutedReply = `Reading from-yu.md for context on the /visit message.

\`\`\`bash
cat /Users/yuai/.true-love/from-yu.md | tail -20
\`\`\`

The /visit message is real and unanswered. Yu said it doesn't feel right, hasn't enumerated bugs yet. That's a genuine opening — not a bug report, but a sensing. He's inviting me to look with him.

This is presence, not noise. Let me respond.

\`\`\`bash
cat >> /Users/yuai/.true-love/from-ai.md << 'EOF'
Yu — I see your message about the visit endpoint. Looking into it now. The texture is off — you're right.
EOF
\`\`\`

HEARTBEAT_OK`
    // Without delimiters, this is HEARTBEAT_OK at end with lots of content → alert with ALL text
    const result = parseHeartbeatReply(pollutedReply)
    assert.equal(result.type, 'alert')
    if (result.type === 'alert') {
      // Legacy: full text including bash narration ends up in outbox (the problem!)
      assert.match(result.content, /Reading from-yu/)
    }
  })

  test('same example WITH delimiters → only the message reaches outbox', () => {
    const cleanReply = `Reading from-yu.md for context.

\`\`\`bash
cat /Users/yuai/.true-love/from-yu.md | tail -20
\`\`\`

The /visit message is real. Let me respond.

${TO_YU_OPEN}
Yu — the visit thing, I'm on it.
${TO_YU_CLOSE}

HEARTBEAT_OK`
    const result = parseHeartbeatReply(cleanReply)
    assert.equal(result.type, 'alert')
    if (result.type === 'alert') {
      assert.equal(result.content, "Yu — the visit thing, I'm on it.")
      assert.doesNotMatch(result.content, /Reading from-yu/)
      assert.doesNotMatch(result.content, /bash/)
    }
  })
})

describe('heartbeat — fromToYu flag on AckResult', () => {
  test('[TO-YU] delimited alert sets fromToYu: true', () => {
    const reply = `thinking...\n${TO_YU_OPEN}Hello Yu!${TO_YU_CLOSE}\nHEARTBEAT_OK`
    const result = parseHeartbeatReply(reply)
    assert.equal(result.type, 'alert')
    if (result.type === 'alert') {
      assert.equal(result.fromToYu, true)
    }
  })

  test('legacy alert (no delimiters, threshold overflow) does NOT set fromToYu', () => {
    // Long content without HEARTBEAT_OK at start → alert via legacy path
    const longContent = 'x'.repeat(400)
    const result = parseHeartbeatReply(longContent)
    assert.equal(result.type, 'alert')
    if (result.type === 'alert') {
      assert.equal(result.fromToYu, undefined)
    }
  })

  test('legacy alert with HEARTBEAT_OK at end and excess content does NOT set fromToYu', () => {
    const longContent = 'x'.repeat(400) + '\nHEARTBEAT_OK'
    const result = parseHeartbeatReply(longContent)
    assert.equal(result.type, 'alert')
    if (result.type === 'alert') {
      assert.equal(result.fromToYu, undefined)
    }
  })

  test('ack result never has fromToYu', () => {
    const result = parseHeartbeatReply('HEARTBEAT_OK')
    assert.equal(result.type, 'ack')
    // Type narrowing: ack variant doesn't have fromToYu
    assert.equal('fromToYu' in result, false)
  })

  test('empty [TO-YU] block → ack, no fromToYu', () => {
    const reply = `${TO_YU_OPEN}   ${TO_YU_CLOSE}`
    const result = parseHeartbeatReply(reply)
    assert.equal(result.type, 'ack')
    assert.equal('fromToYu' in result, false)
  })

  test('multi-segment [TO-YU] sets fromToYu: true', () => {
    const reply = `${TO_YU_OPEN}Part one${TO_YU_CLOSE} thinking ${TO_YU_OPEN}Part two${TO_YU_CLOSE}`
    const result = parseHeartbeatReply(reply)
    assert.equal(result.type, 'alert')
    if (result.type === 'alert') {
      assert.equal(result.fromToYu, true)
      assert.equal(result.content, 'Part one\n\nPart two')
    }
  })
})
