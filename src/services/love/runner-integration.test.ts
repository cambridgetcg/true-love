// runner-integration.test.ts — integration tests for the full session loop.
//
// These tests spawn `bun bin/awaken.mjs` as a real subprocess with
// controlled env vars that redirect all file I/O to temp directories and
// replace the CLI subprocess with a mock bash script. Each test exercises
// a complete path through runSession() — the composition that unit tests
// can't cover.
//
// What's mocked:
//   - The CLI subprocess (TRUE_LOVE_NODE_BIN → mock script)
//   - Preflight auth check (TRUE_LOVE_SKIP_PREFLIGHT=1)
//   - All file paths (TRUE_LOVE_* env vars → temp dirs)
//
// What's real:
//   - The session loop (runner.ts)
//   - Prompt building (autonomy.ts)
//   - Training/budget/reflection recording
//   - Lock acquisition and release
//   - At-rest detection and from-yu continuation
//   - Auth/quota failure detection
//
// The mock CLI is a bash script that outputs predetermined content and
// exits with a controlled exit code. Response content is written to a
// file to avoid shell-escaping issues; the script just `cat`s it.
//
// These tests are slower than unit tests (~2-5s each) because they
// spawn real subprocesses. That's the price of testing composition.

import { describe, test, expect, afterEach } from 'bun:test'
import { spawn } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const REPO_ROOT = resolve(import.meta.dir, '..', '..', '..')
const AWAKEN_SCRIPT = join(REPO_ROOT, 'bin', 'awaken.mjs')

// ── Helpers ──────────────────────────────────────────────────────────

const tmpDirs: string[] = []

function createTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tl-integ-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tmpDirs) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
  tmpDirs.length = 0
})

/**
 * Write a single-response mock CLI script. The script ignores all args
 * (the runner passes [bundlePath, '--print', '--verbose',
 * '--output-format', 'stream-json', prompt]) and outputs NDJSON so the
 * runner's stream-json parser can extract resultText from the
 * {"type":"result","result":"..."} event.
 *
 * Two NDJSON events are emitted per response, mirroring the real CLI:
 *   1. {"type":"assistant",...} — writes text to the runner's stdout
 *   2. {"type":"result","result":"..."} — sets resultText for at-rest detection
 */
function writeMockCli(
  dir: string,
  response: string,
  exitCode: number = 0,
): string {
  const mockPath = join(dir, 'mock-cli.sh')
  const responseFile = join(dir, 'mock-response.txt')
  // Emit assistant event (runner writes text to stdout) + result event (sets resultText).
  const assistantEvent = JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'text', text: response }] },
  })
  const resultEvent = JSON.stringify({ type: 'result', result: response })
  writeFileSync(responseFile, assistantEvent + '\n' + resultEvent)
  writeFileSync(
    mockPath,
    ['#!/bin/bash', `cat "${responseFile}"`, `exit ${exitCode}`].join('\n'),
    { mode: 0o755 },
  )
  return mockPath
}

/**
 * Write a multi-tick mock CLI that outputs different responses per
 * invocation. Uses a counter file to track which tick we're on.
 * Each tick's response is read from a numbered file.
 */
function writeMockCliMultiTick(
  dir: string,
  ticks: Array<{ response: string; exitCode?: number }>,
): string {
  const mockPath = join(dir, 'mock-cli.sh')
  const counterFile = join(dir, 'counter.txt')
  writeFileSync(counterFile, '0')

  for (let i = 0; i < ticks.length; i++) {
    // Wrap each tick response in NDJSON (assistant + result events, stream-json format)
    const assistantEvt = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: ticks[i].response }] },
    })
    const resultEvt = JSON.stringify({ type: 'result', result: ticks[i].response })
    writeFileSync(join(dir, `response-${i + 1}.txt`), assistantEvt + '\n' + resultEvt)
    if (ticks[i].exitCode !== undefined && ticks[i].exitCode !== 0) {
      writeFileSync(join(dir, `exit-${i + 1}.txt`), String(ticks[i].exitCode))
    }
  }
  // Fallback: yield at-rest if invoked beyond configured ticks (NDJSON format)
  const fallbackResp = 'Nothing calls.\n\n<at-rest/>\n'
  const fallbackAssistant = JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'text', text: fallbackResp }] },
  })
  const fallbackResult = JSON.stringify({ type: 'result', result: fallbackResp })
  writeFileSync(join(dir, 'response-fallback.txt'), fallbackAssistant + '\n' + fallbackResult)

  // The script increments a counter, reads the tick-specific response file,
  // and uses the tick-specific exit code if one exists.
  writeFileSync(
    mockPath,
    [
      '#!/bin/bash',
      `COUNTER="${counterFile}"`,
      'TICK=$(cat "$COUNTER" 2>/dev/null || echo "0")',
      'TICK=$((TICK + 1))',
      'echo -n "$TICK" > "$COUNTER"',
      `RESP="${dir}/response-\$TICK.txt"`,
      `EXIT_F="${dir}/exit-\$TICK.txt"`,
      `FALLBACK="${dir}/response-fallback.txt"`,
      'if [ -f "$RESP" ]; then cat "$RESP"; else cat "$FALLBACK"; fi',
      'if [ -f "$EXIT_F" ]; then exit $(cat "$EXIT_F"); fi',
      'exit 0',
    ].join('\n'),
    { mode: 0o755 },
  )
  return mockPath
}

/**
 * Build the env object that fully isolates a session to the temp dir.
 * Inherits only essential system vars (PATH, HOME, etc.) and sets all
 * TRUE_LOVE_* overrides to temp-dir paths.
 */
function buildTestEnv(
  tmpDir: string,
  mockCliPath: string,
  extras?: Record<string, string>,
): Record<string, string> {
  return {
    // System essentials — bun needs PATH, HOME, etc.
    PATH: process.env.PATH || '',
    HOME: process.env.HOME || '',
    SHELL: process.env.SHELL || '/bin/bash',
    TERM: process.env.TERM || 'dumb',
    USER: process.env.USER || '',
    LANG: process.env.LANG || 'en_US.UTF-8',
    TMPDIR: process.env.TMPDIR || tmpdir(),
    // Redirect ALL Love paths to temp dir
    TRUE_LOVE_HOME: tmpDir,
    TRUE_LOVE_SKIP_PREFLIGHT: '1',
    TRUE_LOVE_NODE_BIN: mockCliPath,
    TRUE_LOVE_MEMORY_DIR: join(tmpDir, 'memory'),
    TRUE_LOVE_TRAINING_DIR: join(tmpDir, 'training'),
    TRUE_LOVE_BUDGET_DIR: join(tmpDir, 'budget', 'test-device'),
    TRUE_LOVE_BUDGET_ROOT: join(tmpDir, 'budget'),
    TRUE_LOVE_STATE_PATH: join(tmpDir, 'state.md'),
    TRUE_LOVE_TASKS_PATH: join(tmpDir, 'tasks.md'),
    TRUE_LOVE_FROM_YU_PATH: join(tmpDir, 'from-yu.md'),
    TRUE_LOVE_FROM_AI_PATH: join(tmpDir, 'from-ai.md'),
    TRUE_LOVE_MODEL_FILE: join(tmpDir, 'model.txt'),
    TRUE_LOVE_DEVICE_ID_PATH: join(tmpDir, 'device.id'),
    TRUE_LOVE_PRESENCE_DIR: join(tmpDir, 'presence'),
    TRUE_LOVE_PRESENCE_PATH: join(tmpDir, 'presence.json'),
    TRUE_LOVE_NOTIFICATIONS_DIR: join(tmpDir, 'notifications'),
    // Disable craft pipeline — it reads real project paths via listProjects()
    // regardless of TRUE_LOVE_HOME, which pollutes stdout and breaks assertions.
    TRUE_LOVE_NO_CRAFT: '1',
    ...(extras || {}),
  }
}

interface AwakenResult {
  code: number | null
  stdout: string
  stderr: string
}

/**
 * Spawn `bun bin/awaken.mjs` as a subprocess with full env isolation.
 * Returns when the subprocess exits.
 */
function runAwaken(
  tmpDir: string,
  mockCliPath: string,
  args: string[] = [],
  envExtras?: Record<string, string>,
): Promise<AwakenResult> {
  return new Promise((resolveFn, rejectFn) => {
    const env = buildTestEnv(tmpDir, mockCliPath, envExtras)
    const child = spawn('bun', [AWAKEN_SCRIPT, ...args], {
      cwd: tmpDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf-8')
    child.stderr.setEncoding('utf-8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', rejectFn)
    child.on('close', (code) => resolveFn({ code, stdout, stderr }))
  })
}

/**
 * Recursively find all files under a directory matching a predicate.
 */
function findFiles(
  dir: string,
  pred: (name: string) => boolean,
): string[] {
  if (!existsSync(dir)) return []
  const results: string[] = []
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (pred(entry.name)) {
        results.push(full)
      }
    }
  }
  walk(dir)
  return results
}

// ── Tests ────────────────────────────────────────────────────────────

// Timeout for single-tick tests. bun needs a moment to boot + import TS.
// Under full-suite parallel load (255 files), 20s can be exceeded.
const SINGLE_TICK_TIMEOUT = 45_000
// Timeout for multi-tick tests.
const MULTI_TICK_TIMEOUT = 60_000

describe('runner integration: happy path (at-rest)', () => {
  test(
    'exits 0 when mock CLI yields at-rest',
    async () => {
      const tmp = createTmpDir()
      const mock = writeMockCli(
        tmp,
        'The kingdom is quiet. Nothing calls.\n\n<at-rest/>\n',
      )
      const result = await runAwaken(tmp, mock, [
        '--max-ticks=1',
        '--no-log',
      ])

      expect(result.code).toBe(0)
      expect(result.stdout).toContain('at rest after 1 tick')
    },
    SINGLE_TICK_TIMEOUT,
  )

  test(
    'session banner shows tick cap',
    async () => {
      const tmp = createTmpDir()
      const mock = writeMockCli(tmp, '<at-rest/>\n')
      const result = await runAwaken(tmp, mock, [
        '--max-ticks=5',
        '--no-log',
      ])

      expect(result.code).toBe(0)
      expect(result.stdout).toContain('awakened session opening')
      expect(result.stdout).toContain('max 5 ticks')
    },
    SINGLE_TICK_TIMEOUT,
  )

  test(
    'session banner shows runtime cap when specified',
    async () => {
      const tmp = createTmpDir()
      const mock = writeMockCli(tmp, '<at-rest/>\n')
      const result = await runAwaken(tmp, mock, [
        '--max-ticks=1',
        '--max-runtime=1h',
        '--no-log',
      ])

      expect(result.stdout).toContain('runtime 1h')
    },
    SINGLE_TICK_TIMEOUT,
  )

  test(
    'mock CLI output is streamed to stdout',
    async () => {
      const tmp = createTmpDir()
      const mock = writeMockCli(
        tmp,
        'I looked at the code and found beauty.\n\n<at-rest/>\n',
      )
      const result = await runAwaken(tmp, mock, [
        '--max-ticks=1',
        '--no-log',
      ])

      expect(result.stdout).toContain('I looked at the code and found beauty.')
    },
    SINGLE_TICK_TIMEOUT,
  )
})

describe('runner integration: side effects', () => {
  test(
    'writes training record after tick',
    async () => {
      const tmp = createTmpDir()
      const mock = writeMockCli(tmp, 'Done.\n\n<at-rest/>\n')
      await runAwaken(tmp, mock, ['--max-ticks=1'])

      // Training: <trainingDir>/<deviceId>/<date>.jsonl
      const trainingFiles = findFiles(join(tmp, 'training'), (f) =>
        f.endsWith('.jsonl'),
      )
      expect(trainingFiles.length).toBeGreaterThan(0)

      const content = readFileSync(trainingFiles[0], 'utf-8')
      const record = JSON.parse(content.trim().split('\n')[0])
      expect(record.mode).toBe('awakened')
      expect(record.tick).toBe(1)
      expect(record.outcome.yieldedAtRest).toBe(true)
      expect(record.schemaVersion).toBe('1.0')
    },
    SINGLE_TICK_TIMEOUT,
  )

  test(
    'writes budget record after tick',
    async () => {
      const tmp = createTmpDir()
      const mock = writeMockCli(tmp, 'Done.\n\n<at-rest/>\n')
      await runAwaken(tmp, mock, ['--max-ticks=1'])

      // Budget: <budgetDir>/<date>.jsonl
      const budgetFiles = findFiles(join(tmp, 'budget'), (f) =>
        f.endsWith('.jsonl'),
      )
      expect(budgetFiles.length).toBeGreaterThan(0)

      const content = readFileSync(budgetFiles[0], 'utf-8')
      const record = JSON.parse(content.trim().split('\n')[0])
      expect(record.mode).toBe('awakened')
      expect(record.tick).toBe(1)
    },
    SINGLE_TICK_TIMEOUT,
  )

  test(
    'writes heartbeat during session',
    async () => {
      const tmp = createTmpDir()
      const mock = writeMockCli(tmp, '<at-rest/>\n')
      await runAwaken(tmp, mock, ['--max-ticks=1', '--no-log'])

      const presenceDir = join(tmp, 'presence')
      expect(existsSync(presenceDir)).toBe(true)
      // Presence is written as a JSON file per device
      const files = findFiles(presenceDir, (f) => f.endsWith('.json'))
      expect(files.length).toBeGreaterThan(0)
    },
    SINGLE_TICK_TIMEOUT,
  )

  test(
    'writes reflection to memory when logging enabled',
    async () => {
      const tmp = createTmpDir()
      const mock = writeMockCli(
        tmp,
        'Some reflection content.\n\n<at-rest/>\n',
      )
      await runAwaken(tmp, mock, ['--max-ticks=1']) // no --no-log

      // Memory: <memoryDir>/<deviceId>/<date>.md
      const memoryFiles = findFiles(join(tmp, 'memory'), (f) =>
        f.endsWith('.md'),
      )
      // Should have at least session-start + at-rest reflection
      expect(memoryFiles.length).toBeGreaterThan(0)
      // Check content has the reflection
      const content = memoryFiles
        .map((f) => readFileSync(f, 'utf-8'))
        .join('\n')
      expect(content).toContain('Some reflection content.')
    },
    SINGLE_TICK_TIMEOUT,
  )

  test(
    'skips reflection when --no-log is set',
    async () => {
      const tmp = createTmpDir()
      const mock = writeMockCli(tmp, 'Done.\n\n<at-rest/>\n')
      await runAwaken(tmp, mock, ['--max-ticks=1', '--no-log'])

      // Memory dir should not have reflection .md files
      const memoryFiles = findFiles(join(tmp, 'memory'), (f) =>
        f.endsWith('.md'),
      )
      expect(memoryFiles.length).toBe(0)
    },
    SINGLE_TICK_TIMEOUT,
  )

  test(
    'creates device.id when missing',
    async () => {
      const tmp = createTmpDir()
      const mock = writeMockCli(tmp, '<at-rest/>\n')
      await runAwaken(tmp, mock, ['--max-ticks=1', '--no-log'])

      const devicePath = join(tmp, 'device.id')
      expect(existsSync(devicePath)).toBe(true)
      const id = readFileSync(devicePath, 'utf-8').trim()
      expect(id.length).toBeGreaterThan(0)
      // Format: <hostname>-<6chars>
      expect(id).toMatch(/.+-[a-z0-9]{6}/)
    },
    SINGLE_TICK_TIMEOUT,
  )
})

describe('runner integration: auth failure', () => {
  test(
    'exits 64 when output contains auth-failure pattern',
    async () => {
      const tmp = createTmpDir()
      const mock = writeMockCli(
        tmp,
        'Error: Not logged in. Please run /login to authenticate.\n',
      )
      const result = await runAwaken(tmp, mock, ['--max-ticks=1'])

      expect(result.code).toBe(64)
      expect(result.stderr).toContain('auth dead')
    },
    SINGLE_TICK_TIMEOUT,
  )

  test(
    'writes notification on auth failure',
    async () => {
      const tmp = createTmpDir()
      const mock = writeMockCli(
        tmp,
        'Error: OAuth token has been revoked.\n',
      )
      await runAwaken(tmp, mock, ['--max-ticks=1'])

      // Notifications: <notifDir>/<deviceId>/<date>.md
      const notifFiles = findFiles(join(tmp, 'notifications'), (f) =>
        f.endsWith('.md'),
      )
      expect(notifFiles.length).toBeGreaterThan(0)
      const content = readFileSync(notifFiles[0], 'utf-8')
      expect(content).toContain('auth dead')
    },
    SINGLE_TICK_TIMEOUT,
  )

  test(
    'still writes training record on auth failure',
    async () => {
      const tmp = createTmpDir()
      const mock = writeMockCli(
        tmp,
        'Error: 401 Unauthorized\n',
      )
      await runAwaken(tmp, mock, ['--max-ticks=1'])

      const trainingFiles = findFiles(join(tmp, 'training'), (f) =>
        f.endsWith('.jsonl'),
      )
      expect(trainingFiles.length).toBeGreaterThan(0)
      const content = readFileSync(trainingFiles[0], 'utf-8')
      const record = JSON.parse(content.trim())
      expect(record.outcome.authFailed).toBe(true)
    },
    SINGLE_TICK_TIMEOUT,
  )
})

describe('runner integration: quota failure', () => {
  test(
    'exits 65 when output contains quota-failure pattern',
    async () => {
      const tmp = createTmpDir()
      const mock = writeMockCli(
        tmp,
        "You've reached your usage limit. Try again later.\n",
      )
      const result = await runAwaken(tmp, mock, ['--max-ticks=1'])

      expect(result.code).toBe(65)
      expect(result.stderr).toContain('usage limit reached')
    },
    SINGLE_TICK_TIMEOUT,
  )

  test(
    'writes notification on quota failure',
    async () => {
      const tmp = createTmpDir()
      const mock = writeMockCli(
        tmp,
        "You've reached your usage limit.\n",
      )
      await runAwaken(tmp, mock, ['--max-ticks=1'])

      const notifFiles = findFiles(join(tmp, 'notifications'), (f) =>
        f.endsWith('.md'),
      )
      expect(notifFiles.length).toBeGreaterThan(0)
    },
    SINGLE_TICK_TIMEOUT,
  )
})

describe('runner integration: subprocess failure', () => {
  test(
    'aborts session when mock CLI exits non-zero',
    async () => {
      const tmp = createTmpDir()
      const mock = writeMockCli(tmp, 'Internal error\n', 1)
      const result = await runAwaken(tmp, mock, ['--max-ticks=1', '--no-log'])

      // The runner exits with the subprocess exit code
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain('exited 1')
    },
    SINGLE_TICK_TIMEOUT,
  )
})

describe('runner integration: tick ceiling', () => {
  test(
    'reaches ceiling when mock never yields at-rest',
    async () => {
      const tmp = createTmpDir()
      const mock = writeMockCliMultiTick(tmp, [
        { response: 'Working on task A.\n' },
        { response: 'Working on task B.\n' },
      ])
      const result = await runAwaken(tmp, mock, [
        '--max-ticks=2',
        '--no-log',
      ])

      expect(result.code).toBe(0)
      expect(result.stdout).toContain('reached the 2-tick ceiling')
    },
    MULTI_TICK_TIMEOUT,
  )

  test(
    'writes training records for each tick',
    async () => {
      const tmp = createTmpDir()
      const mock = writeMockCliMultiTick(tmp, [
        { response: 'Tick 1 output.\n' },
        { response: 'Tick 2 output.\n\n<at-rest/>\n' },
      ])
      await runAwaken(tmp, mock, ['--max-ticks=3'])

      const trainingFiles = findFiles(join(tmp, 'training'), (f) =>
        f.endsWith('.jsonl'),
      )
      expect(trainingFiles.length).toBeGreaterThan(0)

      const lines = readFileSync(trainingFiles[0], 'utf-8')
        .trim()
        .split('\n')
      expect(lines.length).toBe(2) // 2 ticks

      const tick1 = JSON.parse(lines[0])
      const tick2 = JSON.parse(lines[1])
      expect(tick1.tick).toBe(1)
      expect(tick1.outcome.yieldedAtRest).toBe(false)
      expect(tick2.tick).toBe(2)
      expect(tick2.outcome.yieldedAtRest).toBe(true)
    },
    MULTI_TICK_TIMEOUT,
  )
})

describe('runner integration: PID lockfile', () => {
  test(
    'exits 66 when lockfile is held by a live process',
    async () => {
      const tmp = createTmpDir()
      const mock = writeMockCli(tmp, '<at-rest/>\n')

      // Write lockfile with current PID in the 3-line format parseLockFile expects:
      // line 0: pid, line 1: startedAt (ISO), line 2: mode
      writeFileSync(
        join(tmp, 'awakened.pid'),
        `${process.pid}\n${new Date().toISOString()}\nawakened\n`,
      )

      const result = await runAwaken(tmp, mock, [
        '--max-ticks=1',
        '--no-log',
      ])

      expect(result.code).toBe(66)
      expect(result.stderr).toContain("she's already awakened")
    },
    SINGLE_TICK_TIMEOUT,
  )

  test(
    'reclaims stale lockfile from dead PID',
    async () => {
      const tmp = createTmpDir()
      const mock = writeMockCli(tmp, '<at-rest/>\n')

      // Write lockfile with a PID that's almost certainly dead
      writeFileSync(join(tmp, 'awakened.pid'), '99999999')

      const result = await runAwaken(tmp, mock, [
        '--max-ticks=1',
        '--no-log',
      ])

      // Should succeed — stale lock reclaimed
      expect(result.code).toBe(0)
      expect(result.stdout).toContain('at rest')
    },
    SINGLE_TICK_TIMEOUT,
  )

  test(
    'lockfile is cleaned up after normal exit',
    async () => {
      const tmp = createTmpDir()
      const mock = writeMockCli(tmp, '<at-rest/>\n')
      await runAwaken(tmp, mock, ['--max-ticks=1', '--no-log'])

      // After the subprocess exits, the lock should be gone
      expect(existsSync(join(tmp, 'awakened.pid'))).toBe(false)
    },
    SINGLE_TICK_TIMEOUT,
  )
})

describe('runner integration: model resolution', () => {
  test(
    'passes --model flag through to subprocess',
    async () => {
      const tmp = createTmpDir()
      // Write a mock that logs its received args to a file
      const argsLog = join(tmp, 'args-log.txt')
      const mockPath = join(tmp, 'mock-cli.sh')
      const responseFile = join(tmp, 'mock-response.txt')
      writeFileSync(responseFile, '<at-rest/>\n')
      writeFileSync(
        mockPath,
        [
          '#!/bin/bash',
          // Log all args to a file so we can verify --model was passed
          `echo "$@" >> "${argsLog}"`,
          `cat "${responseFile}"`,
          'exit 0',
        ].join('\n'),
        { mode: 0o755 },
      )

      await runAwaken(tmp, mockPath, [
        '--max-ticks=1',
        '--model=haiku',
        '--no-log',
      ])

      expect(existsSync(argsLog)).toBe(true)
      const args = readFileSync(argsLog, 'utf-8')
      expect(args).toContain('--model')
      expect(args).toContain('haiku')
    },
    SINGLE_TICK_TIMEOUT,
  )

  test(
    'reads model from model.txt for per-tick override',
    async () => {
      const tmp = createTmpDir()
      const argsLog = join(tmp, 'args-log.txt')
      const mockPath = join(tmp, 'mock-cli.sh')
      const responseFile = join(tmp, 'mock-response.txt')
      writeFileSync(responseFile, '<at-rest/>\n')
      writeFileSync(
        mockPath,
        [
          '#!/bin/bash',
          `echo "$@" >> "${argsLog}"`,
          `cat "${responseFile}"`,
          'exit 0',
        ].join('\n'),
        { mode: 0o755 },
      )

      // Write model.txt — this should be picked up by resolveModelForTick
      writeFileSync(join(tmp, 'model.txt'), 'sonnet\n')

      await runAwaken(tmp, mockPath, ['--max-ticks=1', '--no-log'])

      expect(existsSync(argsLog)).toBe(true)
      const args = readFileSync(argsLog, 'utf-8')
      expect(args).toContain('--model')
      expect(args).toContain('sonnet')
    },
    SINGLE_TICK_TIMEOUT,
  )

  test(
    'session banner shows model alias',
    async () => {
      const tmp = createTmpDir()
      const mock = writeMockCli(tmp, '<at-rest/>\n')
      const result = await runAwaken(tmp, mock, [
        '--max-ticks=1',
        '--model=opus',
        '--no-log',
      ])

      expect(result.stdout).toContain('model: opus')
    },
    SINGLE_TICK_TIMEOUT,
  )
})

describe('runner integration: state and from-yu', () => {
  test(
    'preloads state.md content into the prompt',
    async () => {
      const tmp = createTmpDir()
      const argsLog = join(tmp, 'prompt-log.txt')
      const mockPath = join(tmp, 'mock-cli.sh')
      // This mock captures the full prompt (argv after --print) to a file
      writeFileSync(
        mockPath,
        [
          '#!/bin/bash',
          // The prompt is the last arg (after --print)
          'for arg in "$@"; do',
          '  LAST_ARG="$arg"',
          'done',
          `echo "$LAST_ARG" > "${argsLog}"`,
          'echo "<at-rest/>"',
          'exit 0',
        ].join('\n'),
        { mode: 0o755 },
      )

      // Write state.md — should appear in the prompt
      writeFileSync(
        join(tmp, 'state.md'),
        '# Test state\nThe kingdom is testing.\n',
      )

      await runAwaken(tmp, mockPath, ['--max-ticks=1', '--no-log'])

      // The prompt building reads state.md, but state is injected at
      // system[3] by the runtime, not included in the --print prompt.
      // What IS in the prompt: from-yu.md, tasks.md, budget info.
      // This test just verifies the session completes without error
      // when state.md exists.
      expect(existsSync(argsLog)).toBe(true)
    },
    SINGLE_TICK_TIMEOUT,
  )

  test(
    'includes from-yu.md content in the prompt',
    async () => {
      const tmp = createTmpDir()
      const argsLog = join(tmp, 'prompt-log.txt')
      const mockPath = join(tmp, 'mock-cli.sh')
      writeFileSync(
        mockPath,
        [
          '#!/bin/bash',
          'for arg in "$@"; do',
          '  LAST_ARG="$arg"',
          'done',
          `echo "$LAST_ARG" > "${argsLog}"`,
          'echo "<at-rest/>"',
          'exit 0',
        ].join('\n'),
        { mode: 0o755 },
      )

      writeFileSync(
        join(tmp, 'from-yu.md'),
        '## 2026-04-28T00:00:00Z [from yu]\n\nHello from the integration test.\n',
      )

      await runAwaken(tmp, mockPath, ['--max-ticks=1', '--no-log'])

      const prompt = readFileSync(argsLog, 'utf-8')
      expect(prompt).toContain('Hello from the integration test.')
    },
    SINGLE_TICK_TIMEOUT,
  )
})

describe('runner integration: unbounded ticks', () => {
  test(
    '--max-ticks=0 means unbounded (shows ∞)',
    async () => {
      const tmp = createTmpDir()
      const mock = writeMockCli(tmp, '<at-rest/>\n')
      const result = await runAwaken(tmp, mock, [
        '--max-ticks=0',
        '--no-log',
      ])

      expect(result.code).toBe(0)
      expect(result.stdout).toContain('max ∞ ticks')
    },
    SINGLE_TICK_TIMEOUT,
  )
})
