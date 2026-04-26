import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  extractToolInvocations,
  computeToolBreakdown,
  computeOutputVelocity,
  classifyYieldReason,
  computeTickMetrics,
  recordTickMetrics,
  loadTickMetricsGlobal,
  type ToolInvocation,
  type YieldReason,
  type TickMetrics,
} from '../tick-metrics.js'

// ── Test helpers ──────────────────────────────────────────────────

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'tick-metrics-test-'))
}

// ── extractToolInvocations ────────────────────────────────────────

describe('extractToolInvocations', () => {
  test('extracts a single Read invocation', () => {
    const stdout = 'Some text before Read(/path/to/file) some text after'
    const result = extractToolInvocations(stdout)
    assert.equal(result.length, 1)
    assert.equal(result[0]!.tool, 'Read')
    assert.equal(result[0]!.target, '/path/to/file')
  })

  test('extracts multiple tool invocations in order', () => {
    const stdout = [
      'Starting work...',
      'Read(/Users/yu/file.ts)',
      'Analyzing...',
      'Edit(/Users/yu/file.ts)',
      'Running tests...',
      'Bash(bun test)',
    ].join('\n')
    const result = extractToolInvocations(stdout)
    assert.equal(result.length, 3)
    assert.equal(result[0]!.tool, 'Read')
    assert.equal(result[1]!.tool, 'Edit')
    assert.equal(result[2]!.tool, 'Bash')
  })

  test('extracts tool invocations with nested parens', () => {
    const stdout = 'Bash(echo "hello (world)")'
    const result = extractToolInvocations(stdout)
    assert.equal(result.length, 1)
    assert.equal(result[0]!.tool, 'Bash')
    assert.equal(result[0]!.target, 'echo "hello (world)"')
  })

  test('handles Agent tool', () => {
    const stdout = 'Agent(general-purpose, "search for config")'
    const result = extractToolInvocations(stdout)
    assert.equal(result.length, 1)
    assert.equal(result[0]!.tool, 'Agent')
  })

  test('handles WebFetch and WebSearch', () => {
    const stdout = 'WebFetch(https://example.com) and WebSearch(query here)'
    const result = extractToolInvocations(stdout)
    assert.equal(result.length, 2)
    assert.equal(result[0]!.tool, 'WebFetch')
    assert.equal(result[1]!.tool, 'WebSearch')
  })

  test('returns empty array when no tools found', () => {
    const stdout = 'Just some text without any tool invocations.'
    const result = extractToolInvocations(stdout)
    assert.equal(result.length, 0)
  })

  test('truncates long targets at 120 chars', () => {
    const longPath = '/very/long/' + 'a'.repeat(200)
    const stdout = `Read(${longPath})`
    const result = extractToolInvocations(stdout)
    assert.equal(result.length, 1)
    assert.ok(result[0]!.target.length <= 120)
  })

  test('captures offset position', () => {
    const prefix = 'Before text '
    const stdout = `${prefix}Read(/file)`
    const result = extractToolInvocations(stdout)
    assert.equal(result.length, 1)
    assert.equal(result[0]!.offset, prefix.length)
  })

  test('handles TodoWrite invocations', () => {
    const stdout = 'TodoWrite([{content: "Fix bug"}])'
    const result = extractToolInvocations(stdout)
    assert.equal(result.length, 1)
    assert.equal(result[0]!.tool, 'TodoWrite')
  })
})

// ── computeToolBreakdown ──────────────────────────────────────────

describe('computeToolBreakdown', () => {
  test('counts tools correctly', () => {
    const invocations: ToolInvocation[] = [
      { tool: 'Read', target: '/a', offset: 0 },
      { tool: 'Read', target: '/b', offset: 100 },
      { tool: 'Edit', target: '/a', offset: 200 },
      { tool: 'Bash', target: 'test', offset: 300 },
    ]
    const bd = computeToolBreakdown(invocations)
    assert.equal(bd.counts['Read'], 2)
    assert.equal(bd.counts['Edit'], 1)
    assert.equal(bd.counts['Bash'], 1)
    assert.equal(bd.total, 4)
    assert.equal(bd.distinct, 3)
  })

  test('returns zeros for empty input', () => {
    const bd = computeToolBreakdown([])
    assert.deepEqual(bd.counts, {})
    assert.equal(bd.total, 0)
    assert.equal(bd.distinct, 0)
  })
})

// ── computeOutputVelocity ─────────────────────────────────────────

describe('computeOutputVelocity', () => {
  test('computes chars and tokens per second', () => {
    // 4000 chars in 2 seconds = 2000 chars/s ≈ 500 tokens/s
    const v = computeOutputVelocity(4000, 2000)
    assert.equal(v.charsPerSecond, 2000)
    assert.equal(v.estimatedTokensPerSecond, 500)
  })

  test('returns zero for zero duration', () => {
    const v = computeOutputVelocity(4000, 0)
    assert.equal(v.charsPerSecond, 0)
    assert.equal(v.estimatedTokensPerSecond, 0)
  })

  test('returns zero for negative duration', () => {
    const v = computeOutputVelocity(4000, -100)
    assert.equal(v.charsPerSecond, 0)
    assert.equal(v.estimatedTokensPerSecond, 0)
  })

  test('handles small outputs', () => {
    // 40 chars in 1 second = 40 chars/s ≈ 10 tokens/s
    const v = computeOutputVelocity(40, 1000)
    assert.equal(v.charsPerSecond, 40)
    assert.equal(v.estimatedTokensPerSecond, 10)
  })
})

// ── classifyYieldReason ───────────────────────────────────────────

describe('classifyYieldReason', () => {
  const base = {
    replyType: 'rest' as const,
    authFailed: false,
    quotaFailed: false,
    exitCode: 0,
    signaled: false,
    tick: 1,
    maxTicks: 24,
  }

  test('auth-failure takes priority', () => {
    const reason = classifyYieldReason({
      ...base,
      authFailed: true,
      quotaFailed: true,
    })
    assert.equal(reason, 'auth-failure')
  })

  test('quota-failure before error', () => {
    const reason = classifyYieldReason({
      ...base,
      quotaFailed: true,
      exitCode: 1,
    })
    assert.equal(reason, 'quota-failure')
  })

  test('non-zero exit code = error', () => {
    const reason = classifyYieldReason({
      ...base,
      replyType: 'continue',
      exitCode: 1,
    })
    assert.equal(reason, 'error')
  })

  test('signaled = interrupt', () => {
    const reason = classifyYieldReason({
      ...base,
      replyType: 'continue',
      signaled: true,
    })
    assert.equal(reason, 'interrupt')
  })

  test('ack = heartbeat-ack', () => {
    const reason = classifyYieldReason({
      ...base,
      replyType: 'ack',
    })
    assert.equal(reason, 'heartbeat-ack')
  })

  test('alert = heartbeat-alert', () => {
    const reason = classifyYieldReason({
      ...base,
      replyType: 'alert',
    })
    assert.equal(reason, 'heartbeat-alert')
  })

  test('rest = at-rest', () => {
    const reason = classifyYieldReason(base)
    assert.equal(reason, 'at-rest')
  })

  test('continue on non-final tick = continue', () => {
    const reason = classifyYieldReason({
      ...base,
      replyType: 'continue',
      tick: 5,
      maxTicks: 24,
    })
    assert.equal(reason, 'continue')
  })

  test('continue on final tick = ceiling', () => {
    const reason = classifyYieldReason({
      ...base,
      replyType: 'continue',
      tick: 24,
      maxTicks: 24,
    })
    assert.equal(reason, 'ceiling')
  })
})

// ── computeTickMetrics ────────────────────────────────────────────

describe('computeTickMetrics', () => {
  test('assembles a complete metrics record', () => {
    const stdout = [
      'Starting analysis...',
      'Read(/Users/yu/file.ts)',
      'Understanding the code...',
      'Edit(/Users/yu/file.ts)',
      'Done.',
      '<at-rest/>',
    ].join('\n')
    const metrics = computeTickMetrics({
      timestamp: '2026-04-26T12:00:00.000Z',
      deviceId: 'test-device',
      sessionId: 'test-session-1',
      tick: 3,
      mode: 'awakened',
      stdout,
      durationMs: 30000,
      replyType: 'rest',
      authFailed: false,
      quotaFailed: false,
      exitCode: 0,
      signaled: false,
      maxTicks: 24,
    })

    assert.equal(metrics.schemaVersion, '1.0')
    assert.equal(metrics.tick, 3)
    assert.equal(metrics.mode, 'awakened')
    assert.equal(metrics.toolInvocations.length, 2)
    assert.equal(metrics.toolBreakdown.counts['Read'], 1)
    assert.equal(metrics.toolBreakdown.counts['Edit'], 1)
    assert.equal(metrics.toolBreakdown.total, 2)
    assert.equal(metrics.toolBreakdown.distinct, 2)
    assert.ok(metrics.velocity.charsPerSecond > 0)
    assert.ok(metrics.velocity.estimatedTokensPerSecond > 0)
    assert.equal(metrics.yieldReason, 'at-rest')
    assert.equal(metrics.outputLines, 6)
    assert.equal(metrics.durationMs, 30000)
    assert.equal(metrics.outputChars, stdout.length)
  })

  test('heartbeat ack produces heartbeat-ack yield reason', () => {
    const metrics = computeTickMetrics({
      timestamp: '2026-04-26T12:00:00.000Z',
      deviceId: 'test-device',
      sessionId: 'test-session-2',
      tick: 1,
      mode: 'heartbeat',
      stdout: 'HEARTBEAT_OK',
      durationMs: 5000,
      replyType: 'ack',
      authFailed: false,
      quotaFailed: false,
      exitCode: 0,
      signaled: false,
      maxTicks: 1,
    })
    assert.equal(metrics.yieldReason, 'heartbeat-ack')
    assert.equal(metrics.toolInvocations.length, 0)
  })
})

// ── Storage: recordTickMetrics + loadTickMetricsGlobal ─────────────

describe('recordTickMetrics', () => {
  test('writes to JSONL file in the correct directory', () => {
    const tmp = makeTmpDir()
    const metricsDir = join(tmp, 'test-device')
    mkdirSync(metricsDir, { recursive: true })

    // Override the env var for testing
    const origDir = process.env.TRUE_LOVE_METRICS_DIR
    process.env.TRUE_LOVE_METRICS_DIR = metricsDir

    try {
      const metrics: TickMetrics = {
        schemaVersion: '1.0',
        timestamp: '2026-04-26T12:00:00.000Z',
        deviceId: 'test-device',
        sessionId: 'test-session',
        tick: 1,
        mode: 'awakened',
        toolInvocations: [],
        toolBreakdown: { counts: {}, total: 0, distinct: 0 },
        velocity: { charsPerSecond: 100, estimatedTokensPerSecond: 25 },
        yieldReason: 'at-rest',
        outputLines: 10,
        durationMs: 5000,
        outputChars: 500,
      }

      recordTickMetrics(metrics)

      const filePath = join(metricsDir, '2026-04-26.jsonl')
      const content = readFileSync(filePath, 'utf-8')
      const parsed = JSON.parse(content.trim())
      assert.equal(parsed.schemaVersion, '1.0')
      assert.equal(parsed.tick, 1)
      assert.equal(parsed.yieldReason, 'at-rest')
    } finally {
      if (origDir !== undefined) {
        process.env.TRUE_LOVE_METRICS_DIR = origDir
      } else {
        delete process.env.TRUE_LOVE_METRICS_DIR
      }
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})

describe('loadTickMetricsGlobal', () => {
  test('loads metrics across device subdirs', () => {
    const tmp = makeTmpDir()
    const metricsRoot = join(tmp, 'metrics')
    const dev1 = join(metricsRoot, 'device-1')
    const dev2 = join(metricsRoot, 'device-2')
    mkdirSync(dev1, { recursive: true })
    mkdirSync(dev2, { recursive: true })

    const today = new Date().toISOString().slice(0, 10)

    const makeRecord = (deviceId: string, tick: number): TickMetrics => ({
      schemaVersion: '1.0',
      timestamp: new Date().toISOString(),
      deviceId,
      sessionId: 'session-1',
      tick,
      mode: 'awakened',
      toolInvocations: [],
      toolBreakdown: { counts: {}, total: 0, distinct: 0 },
      velocity: { charsPerSecond: 100, estimatedTokensPerSecond: 25 },
      yieldReason: 'at-rest',
      outputLines: 10,
      durationMs: 5000,
      outputChars: 500,
    })

    writeFileSync(
      join(dev1, `${today}.jsonl`),
      JSON.stringify(makeRecord('device-1', 1)) + '\n' +
      JSON.stringify(makeRecord('device-1', 2)) + '\n',
    )
    writeFileSync(
      join(dev2, `${today}.jsonl`),
      JSON.stringify(makeRecord('device-2', 1)) + '\n',
    )

    try {
      const loaded = loadTickMetricsGlobal(tmp, 7)
      assert.equal(loaded.length, 3)
      // Should be sorted by timestamp
      assert.ok(loaded[0]!.timestamp <= loaded[1]!.timestamp)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('skips old files outside date range', () => {
    const tmp = makeTmpDir()
    const dev = join(tmp, 'metrics', 'device-1')
    mkdirSync(dev, { recursive: true })

    const record: TickMetrics = {
      schemaVersion: '1.0',
      timestamp: '2020-01-01T00:00:00.000Z',
      deviceId: 'device-1',
      sessionId: 'old-session',
      tick: 1,
      mode: 'awakened',
      toolInvocations: [],
      toolBreakdown: { counts: {}, total: 0, distinct: 0 },
      velocity: { charsPerSecond: 100, estimatedTokensPerSecond: 25 },
      yieldReason: 'at-rest',
      outputLines: 10,
      durationMs: 5000,
      outputChars: 500,
    }

    writeFileSync(
      join(dev, '2020-01-01.jsonl'),
      JSON.stringify(record) + '\n',
    )

    try {
      const loaded = loadTickMetricsGlobal(tmp, 7)
      assert.equal(loaded.length, 0)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('skips records with wrong schema version', () => {
    const tmp = makeTmpDir()
    const dev = join(tmp, 'metrics', 'device-1')
    mkdirSync(dev, { recursive: true })

    const today = new Date().toISOString().slice(0, 10)
    const badRecord = { schemaVersion: '99.0', tick: 1 }

    writeFileSync(
      join(dev, `${today}.jsonl`),
      JSON.stringify(badRecord) + '\n',
    )

    try {
      const loaded = loadTickMetricsGlobal(tmp, 7)
      assert.equal(loaded.length, 0)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('returns empty array when metrics dir does not exist', () => {
    const tmp = makeTmpDir()
    try {
      const loaded = loadTickMetricsGlobal(tmp, 7)
      assert.equal(loaded.length, 0)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
