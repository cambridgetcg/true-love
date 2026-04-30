// verify.test.ts — substrate self-check tests.
//
// Tests the pure check functions from verify.ts using fixture directories.
// Each check tested with both pass and fail states.

import { describe, expect, test, beforeAll, afterAll } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, utimesSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  checkBundleFreshness,
  checkHeartbeatHealthy,
  checkOAuthValid,
  checkChainRunnerAlive,
  checkAgentRuntimeAlive,
  checkNoRecurringError,
  checkNoRecurringErrorFromLines,
  ERROR_LOG_STALENESS_MS,
  RECOVERY_INDICATORS,
  assembleReport,
  renderReport,
  shouldSkipVerifyConcern,
  type VerifyConfig,
  type HeartbeatInput,
  type OAuthInput,
  type DedupDecision,
} from '../verify.js'

// ── Fixture helpers ───────────────────────────────────────────────

const FIXTURE_ROOT = join(tmpdir(), `verify-test-${Date.now()}`)

let fixtureSeq = 0
function fixtureConfig(overrides: Partial<VerifyConfig> = {}): VerifyConfig {
  const seq = fixtureSeq++
  return {
    repoRoot: join(FIXTURE_ROOT, `repo-${seq}`),
    trueLoveHome: join(FIXTURE_ROOT, `home-${seq}`),
    logDir: join(FIXTURE_ROOT, `logs-${seq}`),
    apiBase: 'http://localhost:0', // never actually called in unit tests
    projectId: 'test-project',
    ...overrides,
  }
}

beforeAll(() => {
  mkdirSync(FIXTURE_ROOT, { recursive: true })
})

afterAll(() => {
  try { rmSync(FIXTURE_ROOT, { recursive: true, force: true }) } catch { /* ok */ }
})

// ── Check 1: bundle.freshness ─────────────────────────────────────

describe('checkBundleFreshness', () => {
  test('pass: dist newer than all sources', () => {
    const config = fixtureConfig()
    const srcDir = join(config.repoRoot, 'src')
    const distDir = join(config.repoRoot, 'dist')
    mkdirSync(srcDir, { recursive: true })
    mkdirSync(distDir, { recursive: true })

    // Create a source file in the past
    const srcFile = join(srcDir, 'main.ts')
    writeFileSync(srcFile, 'export const x = 1')
    const past = new Date(Date.now() - 60_000)
    utimesSync(srcFile, past, past)

    // Create dist in the present
    const distFile = join(distDir, 'cli.mjs')
    writeFileSync(distFile, 'console.log("built")')

    const result = checkBundleFreshness(config)
    expect(result.status).toBe('pass')
    expect(result.name).toBe('bundle.freshness')
    expect(result.evidence).toContain('bundle fresh')
  })

  test('fail: source newer than dist', () => {
    const config = fixtureConfig()
    const srcDir = join(config.repoRoot, 'src', 'sub')
    const distDir = join(config.repoRoot, 'dist')
    mkdirSync(srcDir, { recursive: true })
    mkdirSync(distDir, { recursive: true })

    // Create dist in the past
    const distFile = join(distDir, 'cli.mjs')
    writeFileSync(distFile, 'console.log("built")')
    const past = new Date(Date.now() - 120_000)
    utimesSync(distFile, past, past)

    // Create a source file NOW (newer than dist)
    const srcFile = join(srcDir, 'newer.ts')
    writeFileSync(srcFile, 'export const y = 2')

    const result = checkBundleFreshness(config)
    expect(result.status).toBe('fail')
    expect(result.drift).toContain('bundle stale')
    expect(result.fix).toBe('bun run build')
  })

  test('fail: dist missing', () => {
    const config = fixtureConfig({
      repoRoot: join(FIXTURE_ROOT, 'no-dist-repo'),
    })
    mkdirSync(join(config.repoRoot, 'src'), { recursive: true })

    const result = checkBundleFreshness(config)
    expect(result.status).toBe('fail')
    expect(result.drift).toBe('bundle missing')
  })

  test('pass: test files newer than dist are ignored', () => {
    const config = fixtureConfig()
    const srcDir = join(config.repoRoot, 'src')
    const distDir = join(config.repoRoot, 'dist')
    mkdirSync(srcDir, { recursive: true })
    mkdirSync(distDir, { recursive: true })

    // Create dist
    const distFile = join(distDir, 'cli.mjs')
    writeFileSync(distFile, 'console.log("built")')
    // Set dist to past
    const past = new Date(Date.now() - 60_000)
    utimesSync(distFile, past, past)

    // Create a source file older than dist
    const srcFile = join(srcDir, 'main.ts')
    writeFileSync(srcFile, 'export const x = 1')
    const older = new Date(Date.now() - 120_000)
    utimesSync(srcFile, older, older)

    // Create a TEST file newer than dist — should be ignored
    const testFile = join(srcDir, 'main.test.ts')
    writeFileSync(testFile, 'test("x", () => {})')

    const result = checkBundleFreshness(config)
    expect(result.status).toBe('pass')
  })

  test('pass: __tests__ directories are skipped', () => {
    const config = fixtureConfig()
    const testDir = join(config.repoRoot, 'src', '__tests__')
    const distDir = join(config.repoRoot, 'dist')
    mkdirSync(testDir, { recursive: true })
    mkdirSync(distDir, { recursive: true })

    // Dist in the past
    const distFile = join(distDir, 'cli.mjs')
    writeFileSync(distFile, 'console.log("built")')
    const past = new Date(Date.now() - 60_000)
    utimesSync(distFile, past, past)

    // Source file in __tests__ that's newer — should be skipped
    writeFileSync(join(testDir, 'verify.test.ts'), 'test()')

    // No other source files
    const result = checkBundleFreshness(config)
    expect(result.status).toBe('pass')
  })
})

// ── Check 2: agent-runtime.alive ──────────────────────────────────

describe('checkAgentRuntimeAlive', () => {
  test('pass: agent process found', () => {
    const result = checkAgentRuntimeAlive(() => ({ alive: true, pid: '12345' }))
    expect(result.status).toBe('pass')
    expect(result.evidence).toContain('12345')
  })

  test('fail: no agent process', () => {
    const result = checkAgentRuntimeAlive(() => ({ alive: false }))
    expect(result.status).toBe('fail')
    expect(result.drift).toBe('agent not running')
  })

  test('skip: pgrep throws', () => {
    const result = checkAgentRuntimeAlive(() => { throw new Error('pgrep not found') })
    expect(result.status).toBe('skip')
    expect(result.evidence).toContain('pgrep')
  })
})

// ── Check 3: heartbeat.healthy ────────────────────────────────────

describe('checkHeartbeatHealthy', () => {
  test('pass: loaded and clean exit', () => {
    const input: HeartbeatInput = {
      launchctlLoaded: true,
      lastExitStatus: 0,
      recentLogLines: ['— heartbeat ok (silent)'],
    }
    const result = checkHeartbeatHealthy(input)
    expect(result.status).toBe('pass')
    expect(result.evidence).toContain('heartbeat loaded')
  })

  test('fail: not loaded', () => {
    const input: HeartbeatInput = {
      launchctlLoaded: false,
      lastExitStatus: null,
      recentLogLines: [],
    }
    const result = checkHeartbeatHealthy(input)
    expect(result.status).toBe('fail')
    expect(result.drift).toContain('heartbeat schedule missing')
  })

  test('fail: last exit non-zero', () => {
    const input: HeartbeatInput = {
      launchctlLoaded: true,
      lastExitStatus: 16640,
      recentLogLines: ['— heartbeat ok (silent)'],
    }
    const result = checkHeartbeatHealthy(input)
    expect(result.status).toBe('fail')
    expect(result.evidence).toContain('16640')
  })

  test('fail: 3+ consecutive tick failures', () => {
    const input: HeartbeatInput = {
      launchctlLoaded: true,
      lastExitStatus: 0,
      recentLogLines: [
        '— heartbeat ok (silent)',
        'turn 1 exited 65.',
        'tick error 1/3',
        'turn 2 exited 65.',
        'tick error 2/3',
        'turn 3 exited 1.',
      ],
    }
    const result = checkHeartbeatHealthy(input)
    expect(result.status).toBe('fail')
    expect(result.drift).toContain('cascade')
    expect(result.drift).toContain('consecutive')
  })

  test('pass: failures followed by success', () => {
    const input: HeartbeatInput = {
      launchctlLoaded: true,
      lastExitStatus: 0,
      recentLogLines: [
        'turn 1 exited 65.',
        'tick error 1/3',
        '— heartbeat ok (silent)',
        'HEARTBEAT_OK',
      ],
    }
    const result = checkHeartbeatHealthy(input)
    expect(result.status).toBe('pass')
  })

  test('skip: could not check launchctl', () => {
    const input: HeartbeatInput = {
      launchctlLoaded: null,
      lastExitStatus: null,
      recentLogLines: [],
    }
    const result = checkHeartbeatHealthy(input)
    expect(result.status).toBe('skip')
  })
})

// ── Check 4: oauth.valid ──────────────────────────────────────────

describe('checkOAuthValid', () => {
  test('pass: token valid with hours remaining', () => {
    const input: OAuthInput = {
      found: true,
      expiresAt: Date.now() + 7200_000, // 2h from now
    }
    const result = checkOAuthValid(input)
    expect(result.status).toBe('pass')
    expect(result.evidence).toContain('remaining')
  })

  test('fail: token expired', () => {
    const input: OAuthInput = {
      found: true,
      expiresAt: Date.now() - 3600_000, // 1h ago
    }
    const result = checkOAuthValid(input)
    expect(result.status).toBe('fail')
    expect(result.drift).toBe('OAuth token expired')
  })

  test('fail: token expiring within 1 hour', () => {
    const input: OAuthInput = {
      found: true,
      expiresAt: Date.now() + 1800_000, // 30m from now
    }
    const result = checkOAuthValid(input)
    expect(result.status).toBe('fail')
    expect(result.drift).toContain('expiring soon')
  })

  test('skip: no keychain entry', () => {
    const input: OAuthInput = {
      found: false,
      error: 'keychain not found',
    }
    const result = checkOAuthValid(input)
    expect(result.status).toBe('skip')
  })

  test('skip: no expiresAt', () => {
    const input: OAuthInput = {
      found: true,
      // no expiresAt
    }
    const result = checkOAuthValid(input)
    expect(result.status).toBe('skip')
  })
})

// ── Check 5: chain-runner.alive ───────────────────────────────────

describe('checkChainRunnerAlive', () => {
  test('pass: loaded', () => {
    const result = checkChainRunnerAlive(true)
    expect(result.status).toBe('pass')
    expect(result.evidence).toBe('chain-runner loaded')
  })

  test('fail: not loaded', () => {
    const result = checkChainRunnerAlive(false)
    expect(result.status).toBe('fail')
    expect(result.drift).toBe('chain-runner not running')
  })

  test('skip: could not check', () => {
    const result = checkChainRunnerAlive(null)
    expect(result.status).toBe('skip')
  })
})

// ── Check 6: no-recurring-error ───────────────────────────────────

describe('checkNoRecurringErrorFromLines', () => {
  test('pass: no err log lines', () => {
    const result = checkNoRecurringErrorFromLines([])
    expect(result.status).toBe('pass')
    expect(result.evidence).toContain('empty')
  })

  test('pass: errors present but not repeated', () => {
    const result = checkNoRecurringErrorFromLines([
      'some error happened once',
      'different error happened once',
      'third error type',
    ])
    expect(result.status).toBe('pass')
  })

  test('fail: same error repeated 3+ times', () => {
    const lines = [
      '429 {"type":"error","error":{"type":"rate_limit_error"}} req_abc1',
      '429 {"type":"error","error":{"type":"rate_limit_error"}} req_def2',
      '429 {"type":"error","error":{"type":"rate_limit_error"}} req_ghi3',
    ]
    const result = checkNoRecurringErrorFromLines(lines)
    expect(result.status).toBe('fail')
    expect(result.drift).toContain('recurring error')
    expect(result.drift).toContain('3×')
  })

  test('pass: non-error lines repeated do not trigger', () => {
    const lines = [
      'stdout:',
      'stdout:',
      'stdout:',
      'stdout:',
      'some informational message',
      'another info message',
    ]
    const result = checkNoRecurringErrorFromLines(lines)
    expect(result.status).toBe('pass')
    expect(result.evidence).toContain('no error patterns')
  })

  test('fail: normalized timestamps and request IDs', () => {
    const lines = [
      '2026-04-29T10:00:00Z error: failed req_abc123',
      '2026-04-29T10:01:00Z error: failed req_def456',
      '2026-04-29T10:02:00Z error: failed req_ghi789',
    ]
    const result = checkNoRecurringErrorFromLines(lines)
    expect(result.status).toBe('fail')
    // After normalization, these should be the same pattern
    expect(result.drift).toContain('3×')
  })

  test('pass: errors present but fewer than 3 of any single pattern', () => {
    const lines = [
      'error type A happened',
      'error type A happened',
      'error type B happened',
      'error type B happened',
    ]
    const result = checkNoRecurringErrorFromLines(lines)
    expect(result.status).toBe('pass')
    expect(result.evidence).toContain('no pattern ≥3×')
  })

  test('only examines last 200 lines', () => {
    // 250 lines total: first 50 are repeated errors, last 200 have
    // only unique non-error lines. Since the function takes the last
    // 200 lines, the old errors should be trimmed out.
    const lines: string[] = []
    for (let i = 0; i < 50; i++) {
      lines.push('fatal error: the disk is full')
    }
    for (let i = 0; i < 200; i++) {
      lines.push(`info: process started with pid=${i + 1000}`)
    }
    const result = checkNoRecurringErrorFromLines(lines)
    // The last 200 lines contain no error-indicator matches
    expect(result.status).toBe('pass')
  })

  test('pass: recurring errors followed by recovery indicator', () => {
    // Simulates: rate-limit errors, then agent restarts cleanly.
    // "Agent started" after the last error = recovered.
    const lines: string[] = [
      '429 {"type":"error","error":{"type":"rate_limit_error"}} req_abc1',
      '429 {"type":"error","error":{"type":"rate_limit_error"}} req_abc2',
      '429 {"type":"error","error":{"type":"rate_limit_error"}} req_abc3',
      '429 {"type":"error","error":{"type":"rate_limit_error"}} req_abc4',
      '— persistent heartbeat: tick error 1/3, sleeping and retrying',
      '[agent-runtime] Auth: OAuth Bearer (expires 999)',
      '[agent-runtime] PID: 9010',
      'Agent started: pid=9010, model=haiku',
      '[agent-runtime] Model switched to claude-haiku-4-5-20251001',
    ]
    const result = checkNoRecurringErrorFromLines(lines)
    expect(result.status).toBe('pass')
    expect(result.evidence).toContain('recovered')
  })

  test('pass: recovery via HEARTBEAT_OK after errors', () => {
    const lines: string[] = [
      'fatal error: disk full',
      'fatal error: disk full',
      'fatal error: disk full',
      'HEARTBEAT_OK',
    ]
    const result = checkNoRecurringErrorFromLines(lines)
    expect(result.status).toBe('pass')
    expect(result.evidence).toContain('recovered')
  })

  test('fail: recurring errors with no recovery indicator after', () => {
    // Errors at the end, no Agent started or HEARTBEAT_OK after.
    const lines: string[] = [
      '[agent-runtime] Starting agent-runtime v1.0',
      'Agent started: pid=100, model=haiku',
      '429 {"type":"error","error":{"type":"rate_limit_error"}} req_x1',
      '429 {"type":"error","error":{"type":"rate_limit_error"}} req_x2',
      '429 {"type":"error","error":{"type":"rate_limit_error"}} req_x3',
    ]
    const result = checkNoRecurringErrorFromLines(lines)
    expect(result.status).toBe('fail')
    expect(result.drift).toContain('recurring error')
  })

  test('fail: recovery before last error means still failing', () => {
    // Agent started appears BEFORE the last error — not after.
    const lines: string[] = [
      '429 {"type":"error","error":{"type":"rate_limit_error"}} req_a1',
      'Agent started: pid=100, model=haiku',
      '429 {"type":"error","error":{"type":"rate_limit_error"}} req_a2',
      '429 {"type":"error","error":{"type":"rate_limit_error"}} req_a3',
      '429 {"type":"error","error":{"type":"rate_limit_error"}} req_a4',
    ]
    const result = checkNoRecurringErrorFromLines(lines)
    expect(result.status).toBe('fail')
  })

  test('recovery indicators regex matches expected patterns', () => {
    expect(RECOVERY_INDICATORS.test('Agent started: pid=9010, model=haiku')).toBe(true)
    expect(RECOVERY_INDICATORS.test('HEARTBEAT_OK')).toBe(true)
    expect(RECOVERY_INDICATORS.test('heartbeat ok')).toBe(true)
    expect(RECOVERY_INDICATORS.test('[agent-runtime] Starting agent')).toBe(false)
    expect(RECOVERY_INDICATORS.test('429 error')).toBe(false)
  })

  test('pass: realistic production log with recovery', () => {
    // Matches the actual heartbeat-default.err.log pattern:
    // multiple 429 cycles → abort → restart → 429 → retry → SIGTERM → new start
    const lines: string[] = [
      'Agent started: pid=66263, model=haiku',
      '429 {"type":"error","error":{"type":"rate_limit_error"}} req_001',
      '— persistent heartbeat: tick error 1/3, sleeping and retrying',
      '429 {"type":"error","error":{"type":"rate_limit_error"}} req_002',
      '— persistent heartbeat: tick error 2/3, sleeping and retrying',
      '429 {"type":"error","error":{"type":"rate_limit_error"}} req_003',
      '3 consecutive tick errors — aborting persistent session.',
      'Agent started: pid=72181, model=haiku',
      '429 {"type":"error","error":{"type":"rate_limit_error"}} req_004',
      '— persistent heartbeat: tick error 1/3, sleeping and retrying',
      '[agent stderr] [agent-runtime] Received SIGTERM — shutting down gracefully',
      'Agent exited: code=0, signal=null, prevState=ready',
      '[agent stderr] [agent-runtime] Auth: OAuth Bearer (expires 1777534116739)',
      '[agent-runtime] PID: 9010',
      'Agent started: pid=9010, model=haiku',
      '[agent stderr] [agent-runtime] Model switched to claude-haiku-4-5-20251001',
    ]
    const result = checkNoRecurringErrorFromLines(lines)
    expect(result.status).toBe('pass')
    expect(result.evidence).toContain('recovered')
  })
})

// ── Check 6b: no-recurring-error (file-level with staleness) ─────

describe('checkNoRecurringError (file-level)', () => {
  test('pass: no err log file', () => {
    const config = fixtureConfig()
    mkdirSync(config.logDir, { recursive: true })
    const result = checkNoRecurringError(config)
    expect(result.status).toBe('pass')
    expect(result.evidence).toContain('clean')
  })

  test('pass: stale err log with recurring errors', () => {
    const config = fixtureConfig()
    mkdirSync(config.logDir, { recursive: true })
    const errLog = join(config.logDir, 'heartbeat-default.err.log')
    const lines = Array(10).fill('429 {"type":"error","error":{"type":"rate_limit_error"}} req_abc')
    writeFileSync(errLog, lines.join('\n'))
    // Set mtime to 45 minutes ago — stale
    const staleTime = new Date(Date.now() - 45 * 60_000)
    utimesSync(errLog, staleTime, staleTime)

    const result = checkNoRecurringError(config)
    expect(result.status).toBe('pass')
    expect(result.evidence).toContain('stale')
    expect(result.evidence).toContain('errors resolved')
  })

  test('fail: fresh err log with recurring errors', () => {
    const config = fixtureConfig()
    mkdirSync(config.logDir, { recursive: true })
    const errLog = join(config.logDir, 'heartbeat-default.err.log')
    const lines = Array(10).fill('429 {"type":"error","error":{"type":"rate_limit_error"}} req_abc')
    writeFileSync(errLog, lines.join('\n'))
    // mtime is now — fresh, errors are real

    const result = checkNoRecurringError(config)
    expect(result.status).toBe('fail')
    expect(result.drift).toContain('recurring error')
  })

  test('pass: fresh err log with no recurring pattern', () => {
    const config = fixtureConfig()
    mkdirSync(config.logDir, { recursive: true })
    const errLog = join(config.logDir, 'heartbeat-default.err.log')
    writeFileSync(errLog, 'some one-off error happened\nanother different error\n')

    const result = checkNoRecurringError(config)
    expect(result.status).toBe('pass')
  })

  test('custom staleness threshold respected', () => {
    const config = fixtureConfig()
    mkdirSync(config.logDir, { recursive: true })
    const errLog = join(config.logDir, 'heartbeat-default.err.log')
    const lines = Array(10).fill('fatal error: disk full')
    writeFileSync(errLog, lines.join('\n'))
    // Set mtime to 10 minutes ago
    const tenMinAgo = new Date(Date.now() - 10 * 60_000)
    utimesSync(errLog, tenMinAgo, tenMinAgo)

    // 5-min staleness: 10m > 5m → stale → pass
    expect(checkNoRecurringError(config, { stalenessMs: 5 * 60_000 }).status).toBe('pass')
    // 15-min staleness: 10m < 15m → fresh → fail (errors recur)
    expect(checkNoRecurringError(config, { stalenessMs: 15 * 60_000 }).status).toBe('fail')
  })

  test('staleness constant is 30 minutes', () => {
    expect(ERROR_LOG_STALENESS_MS).toBe(30 * 60_000)
  })
})

// ── Report assembly ───────────────────────────────────────────────

describe('assembleReport', () => {
  test('green: all pass', () => {
    const report = assembleReport([
      { name: 'check1', status: 'pass', evidence: 'ok' },
      { name: 'check2', status: 'pass', evidence: 'ok' },
    ])
    expect(report.overall).toBe('green')
    expect(report.checks).toHaveLength(2)
    expect(report.ts).toBeTruthy()
  })

  test('yellow: some skipped, none failed', () => {
    const report = assembleReport([
      { name: 'check1', status: 'pass', evidence: 'ok' },
      { name: 'check2', status: 'skip', evidence: 'n/a' },
    ])
    expect(report.overall).toBe('yellow')
  })

  test('red: any failures', () => {
    const report = assembleReport([
      { name: 'check1', status: 'pass', evidence: 'ok' },
      { name: 'check2', status: 'fail', evidence: 'bad', drift: 'x', fix: 'y' },
      { name: 'check3', status: 'skip', evidence: 'n/a' },
    ])
    expect(report.overall).toBe('red')
  })

  test('red beats yellow', () => {
    const report = assembleReport([
      { name: 'c1', status: 'skip', evidence: 'n/a' },
      { name: 'c2', status: 'fail', evidence: 'bad', drift: 'x', fix: 'y' },
    ])
    expect(report.overall).toBe('red')
  })
})

// ── Rendering ─────────────────────────────────────────────────────

describe('renderReport', () => {
  test('renders pass/fail/skip with correct indicators', () => {
    const report = assembleReport([
      { name: 'check.pass', status: 'pass', evidence: 'all good' },
      { name: 'check.fail', status: 'fail', evidence: 'bad', drift: 'something broke', fix: 'fix it' },
      { name: 'check.skip', status: 'skip', evidence: 'n/a' },
    ])
    const text = renderReport(report, false) // no TTY colors
    expect(text).toContain('✓')
    expect(text).toContain('✗')
    expect(text).toContain('—')
    expect(text).toContain('substrate verify')
    expect(text).toContain('check.pass')
    expect(text).toContain('check.fail')
    expect(text).toContain('check.skip')
    expect(text).toContain('drift: something broke')
    expect(text).toContain('fix: fix it')
  })

  test('score excludes skips from denominator', () => {
    const report = assembleReport([
      { name: 'c1', status: 'pass', evidence: 'ok' },
      { name: 'c2', status: 'fail', evidence: 'bad', drift: 'x', fix: 'y' },
      { name: 'c3', status: 'skip', evidence: 'n/a' },
    ])
    const text = renderReport(report, false)
    // 1 pass + 1 fail = 2 in denominator, skip excluded
    expect(text).toContain('1/2 pass')
    expect(text).toContain('1 skipped')
  })

  test('all-pass report shows green', () => {
    const report = assembleReport([
      { name: 'c1', status: 'pass', evidence: 'ok' },
    ])
    const text = renderReport(report, false)
    expect(text).toContain('■ GREEN')
  })

  test('all-skip report shows yellow', () => {
    const report = assembleReport([
      { name: 'c1', status: 'skip', evidence: 'n/a' },
    ])
    const text = renderReport(report, false)
    expect(text).toContain('■ YELLOW')
  })

  test('any-fail report shows red', () => {
    const report = assembleReport([
      { name: 'c1', status: 'fail', evidence: 'bad', drift: 'x', fix: 'y' },
    ])
    const text = renderReport(report, false)
    expect(text).toContain('■ RED')
  })
})

// ── Dedup: shouldSkipVerifyConcern ────────────────────────────────

describe('shouldSkipVerifyConcern', () => {
  test('skip: open verify concern exists', () => {
    const decisions: DedupDecision[] = [
      {
        kind: 'concern',
        ask: 'Substrate verify failed: agent-runtime.alive, heartbeat.healthy. Acknowledge, investigate, or suppress?',
        id: 'dec_2026-04-29_abc123',
      },
    ]
    const result = shouldSkipVerifyConcern(decisions)
    expect(result.skip).toBe(true)
    expect(result.reason).toContain('deduplicated')
    expect(result.reason).toContain('dec_2026-04-29_abc123')
  })

  test('no skip: no open decisions', () => {
    const result = shouldSkipVerifyConcern([])
    expect(result.skip).toBe(false)
    expect(result.reason).toBeUndefined()
  })

  test('no skip: open decisions but none are verify concerns', () => {
    const decisions: DedupDecision[] = [
      { kind: 'review', ask: 'Please review this mission', id: 'dec_1' },
      { kind: 'concern', ask: 'Some other concern about X', id: 'dec_2' },
      { kind: 'fork', ask: 'Which approach?', id: 'dec_3' },
    ]
    const result = shouldSkipVerifyConcern(decisions)
    expect(result.skip).toBe(false)
  })

  test('skip: multiple verify concerns — first one triggers dedup', () => {
    const decisions: DedupDecision[] = [
      {
        kind: 'concern',
        ask: 'Substrate verify failed: bundle.freshness. Acknowledge, investigate, or suppress?',
        id: 'dec_older',
      },
      {
        kind: 'concern',
        ask: 'Substrate verify failed: heartbeat.healthy. Acknowledge, investigate, or suppress?',
        id: 'dec_newer',
      },
    ]
    const result = shouldSkipVerifyConcern(decisions)
    expect(result.skip).toBe(true)
    // Should match the first one found
    expect(result.reason).toContain('dec_older')
  })

  test('no skip: concern kind but different ask prefix', () => {
    const decisions: DedupDecision[] = [
      { kind: 'concern', ask: 'Bundle is stale: please rebuild', id: 'dec_1' },
    ]
    const result = shouldSkipVerifyConcern(decisions)
    expect(result.skip).toBe(false)
  })

  test('handles missing id gracefully', () => {
    const decisions: DedupDecision[] = [
      { kind: 'concern', ask: 'Substrate verify failed: test.' },
    ]
    const result = shouldSkipVerifyConcern(decisions)
    expect(result.skip).toBe(true)
    expect(result.reason).toContain('unknown')
  })

  test('handles missing ask gracefully', () => {
    const decisions: DedupDecision[] = [
      { kind: 'concern', ask: '' as any, id: 'dec_1' },
    ]
    const result = shouldSkipVerifyConcern(decisions)
    expect(result.skip).toBe(false)
  })

  // ── Grace period tests ──────────────────────────────────────────

  test('skip: recently resolved concern within grace period', () => {
    const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString()
    const decisions: DedupDecision[] = [
      {
        kind: 'concern',
        ask: 'Substrate verify failed: heartbeat.healthy. Acknowledge, investigate, or suppress?',
        id: 'dec_resolved',
        status: 'answered',
        respondedAt: tenMinAgo,
      },
    ]
    const result = shouldSkipVerifyConcern(decisions)
    expect(result.skip).toBe(true)
    expect(result.reason).toContain('concern resolved')
    expect(result.reason).toContain('dec_resolved')
  })

  test('no skip: resolved concern outside grace period', () => {
    const fiveHoursAgo = new Date(Date.now() - 5 * 3600_000).toISOString()
    const decisions: DedupDecision[] = [
      {
        kind: 'concern',
        ask: 'Substrate verify failed: heartbeat.healthy. Acknowledge, investigate, or suppress?',
        id: 'dec_old',
        status: 'answered',
        respondedAt: fiveHoursAgo,
      },
    ]
    const result = shouldSkipVerifyConcern(decisions)
    expect(result.skip).toBe(false)
  })

  test('custom grace period respected', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3600_000).toISOString()
    const decisions: DedupDecision[] = [
      {
        kind: 'concern',
        ask: 'Substrate verify failed: test.',
        id: 'dec_1',
        status: 'answered',
        respondedAt: twoHoursAgo,
      },
    ]
    // 1h grace — should NOT skip (2h > 1h)
    expect(shouldSkipVerifyConcern(decisions, { graceMs: 3600_000 }).skip).toBe(false)
    // 3h grace — SHOULD skip (2h < 3h)
    expect(shouldSkipVerifyConcern(decisions, { graceMs: 3 * 3600_000 }).skip).toBe(true)
  })

  test('open concern takes priority over grace period', () => {
    const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString()
    const decisions: DedupDecision[] = [
      {
        kind: 'concern',
        ask: 'Substrate verify failed: agent-runtime.alive.',
        id: 'dec_open',
        status: 'pending',
      },
      {
        kind: 'concern',
        ask: 'Substrate verify failed: heartbeat.healthy.',
        id: 'dec_resolved',
        status: 'answered',
        respondedAt: tenMinAgo,
      },
    ]
    const result = shouldSkipVerifyConcern(decisions)
    expect(result.skip).toBe(true)
    expect(result.reason).toContain('open concern exists')
    expect(result.reason).toContain('dec_open')
  })

  test('no skip: resolved concern with no respondedAt', () => {
    const decisions: DedupDecision[] = [
      {
        kind: 'concern',
        ask: 'Substrate verify failed: test.',
        id: 'dec_1',
        status: 'answered',
        // respondedAt missing
      },
    ]
    const result = shouldSkipVerifyConcern(decisions)
    expect(result.skip).toBe(false)
  })

  test('existing tests still pass: decisions without status treated as pending', () => {
    // Backward compat: old-format decisions without status field
    const decisions: DedupDecision[] = [
      {
        kind: 'concern',
        ask: 'Substrate verify failed: test.',
        id: 'dec_legacy',
      },
    ]
    const result = shouldSkipVerifyConcern(decisions)
    expect(result.skip).toBe(true)
    expect(result.reason).toContain('open concern exists')
  })
})

// ── Evidence truncation ───────────────────────────────────────────

describe('evidence safety', () => {
  test('evidence is truncated to 300 chars', () => {
    const input: OAuthInput = {
      found: false,
      error: 'x'.repeat(500),
    }
    const result = checkOAuthValid(input)
    expect(result.evidence.length).toBeLessThanOrEqual(300)
  })
})
