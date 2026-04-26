import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  EXPERIMENT_SCHEMA_VERSION,
  createExperiment,
  startExperiment,
  abortExperiment,
  completeExperiment,
  getActiveExperiment,
  listExperiments,
  loadExperiment,
  saveExperiment,
  generateSchedule,
  analyzeExperiment,
  renderExperimentReport,
  renderExperimentStatus,
  applyExperimentCondition,
  recordExperimentTick,
  getExperimentsDir,
} from '../experiment.js'
import type {
  Experiment,
  ExperimentCondition,
  ExperimentMetricsSnapshot,
} from '../experiment.js'
import type { TickMetrics } from '../tick-metrics.js'

// ── Test scaffolding ─────────────────────────────────────────────

let tempDir: string
const savedEnv: Record<string, string | undefined> = {}

function saveTempDir(): string {
  const dir = join(
    tmpdir(),
    `experiment-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  )
  mkdirSync(dir, { recursive: true })
  return dir
}

beforeEach(() => {
  tempDir = saveTempDir()
  // Redirect paths
  savedEnv.HOME = process.env.HOME
  savedEnv.TRUE_LOVE_EXPERIMENTS_DIR = process.env.TRUE_LOVE_EXPERIMENTS_DIR
  savedEnv.TRUE_LOVE_AGENCY_DIR = process.env.TRUE_LOVE_AGENCY_DIR
  savedEnv.TRUE_LOVE_MODEL_FILE = process.env.TRUE_LOVE_MODEL_FILE
  savedEnv.TRUE_LOVE_EFFORT_FILE = process.env.TRUE_LOVE_EFFORT_FILE

  process.env.HOME = tempDir
  process.env.TRUE_LOVE_EXPERIMENTS_DIR = join(tempDir, 'experiments')
  // Agency writes go to temp too
  delete process.env.TRUE_LOVE_AGENCY_DIR
  delete process.env.TRUE_LOVE_MODEL_FILE
  delete process.env.TRUE_LOVE_EFFORT_FILE
  mkdirSync(join(tempDir, '.true-love'), { recursive: true })
})

afterEach(() => {
  process.env.HOME = savedEnv.HOME
  for (const key of [
    'TRUE_LOVE_EXPERIMENTS_DIR',
    'TRUE_LOVE_AGENCY_DIR',
    'TRUE_LOVE_MODEL_FILE',
    'TRUE_LOVE_EFFORT_FILE',
  ]) {
    if (savedEnv[key] !== undefined) {
      process.env[key] = savedEnv[key]
    } else {
      delete process.env[key]
    }
  }
  try {
    rmSync(tempDir, { recursive: true, force: true })
  } catch {
    /* ok */
  }
})

// ── Helpers ──────────────────────────────────────────────────────

function makeConditions(): ExperimentCondition[] {
  return [
    { name: 'low', knobs: { effort: 'low' } },
    { name: 'high', knobs: { effort: 'high' } },
  ]
}

function makeTickMetrics(overrides: Partial<TickMetrics> = {}): TickMetrics {
  return {
    schemaVersion: '1.0',
    timestamp: new Date().toISOString(),
    deviceId: 'test-device',
    sessionId: 'test-session',
    tick: 1,
    mode: 'awakened',
    toolInvocations: [],
    toolBreakdown: { counts: { Read: 3, Bash: 2 }, total: 5, distinct: 2 },
    velocity: { charsPerSecond: 100, estimatedTokensPerSecond: 25 },
    yieldReason: 'continue',
    outputLines: 50,
    durationMs: 15000,
    outputChars: 5000,
    ...overrides,
  }
}

// ── Schedule Generation ──────────────────────────────────────────

describe('experiment — schedule generation', () => {
  test('alternating schedule cycles through conditions', () => {
    const schedule = generateSchedule(2, 3, 'alternating')
    assert.deepEqual(schedule, [0, 1, 0, 1, 0, 1])
  })

  test('alternating with 3 conditions', () => {
    const schedule = generateSchedule(3, 2, 'alternating')
    assert.deepEqual(schedule, [0, 1, 2, 0, 1, 2])
  })

  test('sequential schedule groups conditions', () => {
    const schedule = generateSchedule(2, 3, 'sequential')
    assert.deepEqual(schedule, [0, 0, 0, 1, 1, 1])
  })

  test('sequential with 3 conditions', () => {
    const schedule = generateSchedule(3, 2, 'sequential')
    assert.deepEqual(schedule, [0, 0, 1, 1, 2, 2])
  })

  test('block-random has correct counts per condition', () => {
    const schedule = generateSchedule(2, 5, 'block-random', 42)
    assert.equal(schedule.length, 10)
    const counts = [0, 0]
    for (const c of schedule) counts[c]!++
    assert.equal(counts[0], 5)
    assert.equal(counts[1], 5)
  })

  test('block-random is deterministic with same seed', () => {
    const s1 = generateSchedule(2, 5, 'block-random', 42)
    const s2 = generateSchedule(2, 5, 'block-random', 42)
    assert.deepEqual(s1, s2)
  })

  test('block-random differs with different seeds', () => {
    const s1 = generateSchedule(2, 10, 'block-random', 42)
    const s2 = generateSchedule(2, 10, 'block-random', 99)
    // Could theoretically be the same by chance, but extremely unlikely with 20 ticks
    assert.notDeepEqual(s1, s2)
  })
})

// ── Creation ─────────────────────────────────────────────────────

describe('experiment — creation', () => {
  test('creates a valid experiment', () => {
    const exp = createExperiment({
      hypothesis: 'Higher effort yields more tool use',
      variable: 'effort',
      conditions: makeConditions(),
      ticksPerCondition: 3,
    })

    assert.equal(exp.schemaVersion, EXPERIMENT_SCHEMA_VERSION)
    assert.ok(exp.id.startsWith('exp-'))
    assert.ok(exp.id.includes('effort'))
    assert.equal(exp.hypothesis, 'Higher effort yields more tool use')
    assert.equal(exp.variable, 'effort')
    assert.equal(exp.conditions.length, 2)
    assert.equal(exp.schedule, 'alternating')
    assert.equal(exp.ticksPerCondition, 3)
    assert.equal(exp.status, 'pending')
    assert.equal(exp.results.length, 0)
    assert.equal(exp.tickSchedule.length, 6) // 2 conditions × 3 ticks
    assert.ok(exp.createdAt)
  })

  test('persists to disk', () => {
    const exp = createExperiment({
      hypothesis: 'Test persistence',
      variable: 'effort',
      conditions: makeConditions(),
      ticksPerCondition: 2,
    })

    const loaded = loadExperiment(exp.id)
    assert.ok(loaded)
    assert.equal(loaded!.id, exp.id)
    assert.equal(loaded!.hypothesis, exp.hypothesis)
  })

  test('rejects fewer than 2 conditions', () => {
    assert.throws(
      () =>
        createExperiment({
          hypothesis: 'test',
          variable: 'effort',
          conditions: [{ name: 'only', knobs: { effort: 'low' } }],
          ticksPerCondition: 3,
        }),
      /at least 2 conditions/,
    )
  })

  test('rejects duplicate condition names', () => {
    assert.throws(
      () =>
        createExperiment({
          hypothesis: 'test',
          variable: 'effort',
          conditions: [
            { name: 'same', knobs: { effort: 'low' } },
            { name: 'same', knobs: { effort: 'high' } },
          ],
          ticksPerCondition: 3,
        }),
      /unique/,
    )
  })

  test('rejects non-tier-1 knobs', () => {
    assert.throws(
      () =>
        createExperiment({
          hypothesis: 'test',
          variable: 'tools',
          conditions: [
            { name: 'a', knobs: { 'allowed-tools': 'Read,Edit' } },
            { name: 'b', knobs: { 'allowed-tools': 'Read,Edit,Bash' } },
          ],
          ticksPerCondition: 3,
        }),
      /not tier 1/,
    )
  })

  test('rejects ticksPerCondition < 1', () => {
    assert.throws(
      () =>
        createExperiment({
          hypothesis: 'test',
          variable: 'effort',
          conditions: makeConditions(),
          ticksPerCondition: 0,
        }),
      /at least 1/,
    )
  })

  test('rejects total ticks > 100', () => {
    assert.throws(
      () =>
        createExperiment({
          hypothesis: 'test',
          variable: 'effort',
          conditions: makeConditions(),
          ticksPerCondition: 51,
        }),
      /100-tick safety cap/,
    )
  })

  test('respects custom schedule', () => {
    const exp = createExperiment({
      hypothesis: 'test',
      variable: 'effort',
      conditions: makeConditions(),
      ticksPerCondition: 3,
      schedule: 'sequential',
    })
    assert.equal(exp.schedule, 'sequential')
    assert.deepEqual(exp.tickSchedule, [0, 0, 0, 1, 1, 1])
  })

  test('accepts focusMetrics', () => {
    const exp = createExperiment({
      hypothesis: 'test',
      variable: 'effort',
      conditions: makeConditions(),
      ticksPerCondition: 3,
      focusMetrics: ['toolTotal', 'outputChars'],
    })
    assert.deepEqual(exp.focusMetrics, ['toolTotal', 'outputChars'])
  })
})

// ── Lifecycle ────────────────────────────────────────────────────

describe('experiment — lifecycle', () => {
  test('start transitions to running', () => {
    const exp = createExperiment({
      hypothesis: 'test',
      variable: 'effort',
      conditions: makeConditions(),
      ticksPerCondition: 2,
    })

    const started = startExperiment(exp.id)
    assert.equal(started.status, 'running')
    assert.ok(started.startedAt)
    assert.ok(started.baselineKnobs)
  })

  test('cannot start non-pending experiment', () => {
    const exp = createExperiment({
      hypothesis: 'test',
      variable: 'effort',
      conditions: makeConditions(),
      ticksPerCondition: 2,
    })
    startExperiment(exp.id)
    assert.throws(() => startExperiment(exp.id), /Cannot start/)
  })

  test('abort transitions to aborted', () => {
    const exp = createExperiment({
      hypothesis: 'test',
      variable: 'effort',
      conditions: makeConditions(),
      ticksPerCondition: 2,
    })
    startExperiment(exp.id)

    const aborted = abortExperiment(exp.id, 'testing abort')
    assert.equal(aborted.status, 'aborted')
    assert.ok(aborted.abortedAt)
    assert.equal(aborted.abortReason, 'testing abort')
  })

  test('complete transitions to complete', () => {
    const exp = createExperiment({
      hypothesis: 'test',
      variable: 'effort',
      conditions: makeConditions(),
      ticksPerCondition: 2,
    })
    startExperiment(exp.id)

    const completed = completeExperiment(exp.id)
    assert.equal(completed.status, 'complete')
    assert.ok(completed.completedAt)
  })

  test('cannot complete non-running experiment', () => {
    const exp = createExperiment({
      hypothesis: 'test',
      variable: 'effort',
      conditions: makeConditions(),
      ticksPerCondition: 2,
    })
    assert.throws(() => completeExperiment(exp.id), /Cannot complete/)
  })

  test('cannot create while another is running', () => {
    createExperiment({
      hypothesis: 'test1',
      variable: 'effort',
      conditions: makeConditions(),
      ticksPerCondition: 2,
    })
    // First one is pending, not running — should be OK
    const exp2 = createExperiment({
      hypothesis: 'test2',
      variable: 'model',
      conditions: [
        { name: 'sonnet', knobs: { model: 'sonnet' } },
        { name: 'haiku', knobs: { model: 'haiku' } },
      ],
      ticksPerCondition: 2,
    })
    // But if we start one, creating another should fail? No — the check is
    // "no running experiment". Let's start exp2 and try creating another.
    startExperiment(exp2.id)
    assert.throws(
      () =>
        createExperiment({
          hypothesis: 'test3',
          variable: 'effort',
          conditions: makeConditions(),
          ticksPerCondition: 2,
        }),
      /running/,
    )
  })
})

// ── Listing ──────────────────────────────────────────────────────

describe('experiment — listing', () => {
  test('listExperiments returns all experiments', () => {
    createExperiment({
      hypothesis: 'first',
      variable: 'effort',
      conditions: makeConditions(),
      ticksPerCondition: 2,
    })
    createExperiment({
      hypothesis: 'second',
      variable: 'model',
      conditions: [
        { name: 'sonnet', knobs: { model: 'sonnet' } },
        { name: 'haiku', knobs: { model: 'haiku' } },
      ],
      ticksPerCondition: 2,
    })

    const all = listExperiments()
    assert.equal(all.length, 2)
    // Both present (order depends on sub-ms timestamp — just check both exist)
    const hypotheses = all.map((e) => e.hypothesis).sort()
    assert.deepEqual(hypotheses, ['first', 'second'])
  })

  test('getActiveExperiment returns running experiment', () => {
    const exp = createExperiment({
      hypothesis: 'test',
      variable: 'effort',
      conditions: makeConditions(),
      ticksPerCondition: 2,
    })

    assert.equal(getActiveExperiment(), null)
    startExperiment(exp.id)
    const active = getActiveExperiment()
    assert.ok(active)
    assert.equal(active!.id, exp.id)
  })

  test('empty dir returns empty list', () => {
    assert.deepEqual(listExperiments(), [])
    assert.equal(getActiveExperiment(), null)
  })
})

// ── Runner Hooks ─────────────────────────────────────────────────

describe('experiment — runner hooks', () => {
  test('applyExperimentCondition returns null when no experiment', () => {
    assert.equal(applyExperimentCondition(), null)
  })

  test('applyExperimentCondition returns condition info for running experiment', () => {
    const exp = createExperiment({
      hypothesis: 'test',
      variable: 'effort',
      conditions: makeConditions(),
      ticksPerCondition: 2,
      schedule: 'alternating',
    })
    startExperiment(exp.id)

    const result = applyExperimentCondition()
    assert.ok(result)
    assert.equal(result!.experimentId, exp.id)
    assert.equal(result!.experimentTick, 1)
    // Alternating: first tick should be condition 0 (low)
    assert.equal(result!.conditionName, 'low')
    assert.equal(result!.conditionIndex, 0)
    assert.deepEqual(result!.knobs, { effort: 'low' })
  })

  test('recordExperimentTick stores metrics and advances', () => {
    const exp = createExperiment({
      hypothesis: 'test',
      variable: 'effort',
      conditions: makeConditions(),
      ticksPerCondition: 2,
      schedule: 'alternating',
    })
    startExperiment(exp.id)

    // Apply first condition
    applyExperimentCondition()

    // Record tick
    const completed = recordExperimentTick(makeTickMetrics(), 1)
    assert.equal(completed, false) // not done yet

    // Verify recorded
    const updated = loadExperiment(exp.id)!
    assert.equal(updated.results.length, 1)
    assert.equal(updated.results[0]!.conditionName, 'low')
    assert.equal(updated.results[0]!.experimentTick, 1)
  })

  test('experiment auto-completes when all ticks recorded', () => {
    const exp = createExperiment({
      hypothesis: 'test',
      variable: 'effort',
      conditions: makeConditions(),
      ticksPerCondition: 1,
      schedule: 'alternating',
    })
    startExperiment(exp.id)

    // Tick 1: condition 0
    applyExperimentCondition()
    const c1 = recordExperimentTick(makeTickMetrics({ tick: 1 }), 1)
    assert.equal(c1, false)

    // Tick 2: condition 1
    applyExperimentCondition()
    const c2 = recordExperimentTick(makeTickMetrics({ tick: 2 }), 2)
    assert.equal(c2, true) // completed!

    const final = loadExperiment(exp.id)!
    assert.equal(final.status, 'complete')
    assert.ok(final.completedAt)
    assert.equal(final.results.length, 2)
  })

  test('applyExperimentCondition returns null after completion', () => {
    const exp = createExperiment({
      hypothesis: 'test',
      variable: 'effort',
      conditions: makeConditions(),
      ticksPerCondition: 1,
    })
    startExperiment(exp.id)

    applyExperimentCondition()
    recordExperimentTick(makeTickMetrics({ tick: 1 }), 1)
    applyExperimentCondition()
    recordExperimentTick(makeTickMetrics({ tick: 2 }), 2)

    // Now experiment is complete
    const result = applyExperimentCondition()
    assert.equal(result, null)
  })

  test('recordExperimentTick returns false when no experiment', () => {
    const result = recordExperimentTick(makeTickMetrics(), 1)
    assert.equal(result, false)
  })
})

// ── Analysis ─────────────────────────────────────────────────────

describe('experiment — analysis', () => {
  function createAndRunExperiment(): Experiment {
    const exp = createExperiment({
      hypothesis: 'Higher effort yields more tool use',
      variable: 'effort',
      conditions: makeConditions(),
      ticksPerCondition: 3,
      schedule: 'sequential',
    })
    startExperiment(exp.id)

    // Sequential: 3 ticks low, then 3 ticks high
    // Low effort ticks: fewer tools, less output
    for (let i = 0; i < 3; i++) {
      applyExperimentCondition()
      recordExperimentTick(
        makeTickMetrics({
          tick: i + 1,
          toolBreakdown: { counts: { Read: 2 }, total: 2, distinct: 1 },
          outputChars: 2000,
          outputLines: 30,
          durationMs: 10000,
          velocity: { charsPerSecond: 200, estimatedTokensPerSecond: 50 },
        }),
        i + 1,
      )
    }
    // High effort ticks: more tools, more output
    for (let i = 0; i < 3; i++) {
      applyExperimentCondition()
      recordExperimentTick(
        makeTickMetrics({
          tick: i + 4,
          toolBreakdown: { counts: { Read: 5, Bash: 3, Edit: 2 }, total: 10, distinct: 3 },
          outputChars: 8000,
          outputLines: 120,
          durationMs: 30000,
          velocity: { charsPerSecond: 266, estimatedTokensPerSecond: 66 },
        }),
        i + 4,
      )
    }

    return loadExperiment(exp.id)!
  }

  test('analyzeExperiment computes per-condition stats', () => {
    const exp = createAndRunExperiment()
    const analysis = analyzeExperiment(exp)

    assert.equal(analysis.totalTicks, 6)
    assert.equal(analysis.complete, true)
    assert.equal(analysis.ticksPerCondition['low'], 3)
    assert.equal(analysis.ticksPerCondition['high'], 3)

    // Find toolTotal comparison
    const toolComp = analysis.comparisons.find((c) => c.metric === 'Tool invocations (total)')
    assert.ok(toolComp)
    assert.equal(toolComp!.conditions[0]!.conditionName, 'low')
    assert.equal(toolComp!.conditions[0]!.mean, 2)
    assert.equal(toolComp!.conditions[1]!.conditionName, 'high')
    assert.equal(toolComp!.conditions[1]!.mean, 10)
    assert.equal(toolComp!.deltaAbsolute, 8)
    assert.equal(toolComp!.deltaPercent, 400)
  })

  test('analyzeExperiment respects focusMetrics', () => {
    const exp = createExperiment({
      hypothesis: 'test focus',
      variable: 'effort',
      conditions: makeConditions(),
      ticksPerCondition: 1,
      focusMetrics: ['toolTotal'],
    })
    startExperiment(exp.id)
    applyExperimentCondition()
    recordExperimentTick(makeTickMetrics(), 1)
    applyExperimentCondition()
    recordExperimentTick(makeTickMetrics(), 2)

    const final = loadExperiment(exp.id)!
    const analysis = analyzeExperiment(final)
    assert.equal(analysis.comparisons.length, 1)
    assert.equal(analysis.comparisons[0]!.metric, 'Tool invocations (total)')
  })

  test('analyzeExperiment handles empty results', () => {
    const exp = createExperiment({
      hypothesis: 'test empty',
      variable: 'effort',
      conditions: makeConditions(),
      ticksPerCondition: 3,
    })
    const analysis = analyzeExperiment(exp)
    assert.equal(analysis.totalTicks, 0)
    assert.equal(analysis.complete, false)
    // Each comparison should have n=0 for all conditions
    for (const comp of analysis.comparisons) {
      for (const cs of comp.conditions) {
        assert.equal(cs.n, 0)
      }
    }
  })

  test('stats computation — median, stddev', () => {
    const exp = createExperiment({
      hypothesis: 'test stats',
      variable: 'effort',
      conditions: makeConditions(),
      ticksPerCondition: 3,
      schedule: 'sequential',
    })
    startExperiment(exp.id)

    // Low: outputChars = 100, 200, 300 → mean 200, median 200
    const lowValues = [100, 200, 300]
    for (let i = 0; i < 3; i++) {
      applyExperimentCondition()
      recordExperimentTick(makeTickMetrics({ outputChars: lowValues[i]! }), i + 1)
    }
    // High: outputChars = 500, 500, 500 → mean 500, median 500, stddev 0
    for (let i = 0; i < 3; i++) {
      applyExperimentCondition()
      recordExperimentTick(makeTickMetrics({ outputChars: 500 }), i + 4)
    }

    const final = loadExperiment(exp.id)!
    const analysis = analyzeExperiment(final)
    const charComp = analysis.comparisons.find((c) => c.metric === 'Output (chars)')
    assert.ok(charComp)

    const lowStats = charComp!.conditions[0]!
    assert.equal(lowStats.mean, 200)
    assert.equal(lowStats.median, 200)
    assert.equal(lowStats.min, 100)
    assert.equal(lowStats.max, 300)
    assert.ok(lowStats.stddev > 0) // 100

    const highStats = charComp!.conditions[1]!
    assert.equal(highStats.mean, 500)
    assert.equal(highStats.stddev, 0)
  })
})

// ── Reporting ────────────────────────────────────────────────────

describe('experiment — reporting', () => {
  test('renderExperimentReport produces structured markdown', () => {
    const exp = createExperiment({
      hypothesis: 'Higher effort yields more output',
      variable: 'effort',
      conditions: makeConditions(),
      ticksPerCondition: 1,
      schedule: 'sequential',
    })
    startExperiment(exp.id)

    applyExperimentCondition()
    recordExperimentTick(makeTickMetrics({ outputChars: 1000 }), 1)
    applyExperimentCondition()
    recordExperimentTick(makeTickMetrics({ outputChars: 5000 }), 2)

    const final = loadExperiment(exp.id)!
    const report = renderExperimentReport(final)

    assert.ok(report.includes('# Experiment Report'))
    assert.ok(report.includes('Higher effort yields more output'))
    assert.ok(report.includes('**Variable:** effort'))
    assert.ok(report.includes('## Conditions'))
    assert.ok(report.includes('## Results'))
    assert.ok(report.includes('### Tick Timeline'))
    assert.ok(report.includes('| Tick |'))
  })

  test('renderExperimentReport with empty results', () => {
    const exp = createExperiment({
      hypothesis: 'test',
      variable: 'effort',
      conditions: makeConditions(),
      ticksPerCondition: 3,
    })
    const report = renderExperimentReport(exp)
    assert.ok(report.includes('No ticks recorded yet'))
  })

  test('renderExperimentStatus returns status line for active experiment', () => {
    const exp = createExperiment({
      hypothesis: 'test',
      variable: 'effort',
      conditions: makeConditions(),
      ticksPerCondition: 3,
    })
    startExperiment(exp.id)

    const status = renderExperimentStatus()
    assert.ok(status)
    assert.ok(status!.includes('🧪'))
    assert.ok(status!.includes('0/6'))
    assert.ok(status!.includes('effort'))
  })

  test('renderExperimentStatus returns null when no active experiment', () => {
    assert.equal(renderExperimentStatus(), null)
  })

  test('report includes abort reason', () => {
    const exp = createExperiment({
      hypothesis: 'test abort',
      variable: 'effort',
      conditions: makeConditions(),
      ticksPerCondition: 3,
    })
    startExperiment(exp.id)
    abortExperiment(exp.id, 'budget exceeded')

    const final = loadExperiment(exp.id)!
    const report = renderExperimentReport(final)
    assert.ok(report.includes('budget exceeded'))
  })
})

// ── Multi-knob conditions ────────────────────────────────────────

describe('experiment — multi-knob conditions', () => {
  test('conditions can set multiple tier-1 knobs', () => {
    const exp = createExperiment({
      hypothesis: 'Model + effort interaction',
      variable: 'model-effort',
      conditions: [
        { name: 'sonnet-low', knobs: { model: 'sonnet', effort: 'low' } },
        { name: 'opus-high', knobs: { model: 'opus', effort: 'high' } },
      ],
      ticksPerCondition: 2,
    })

    assert.equal(exp.conditions[0]!.knobs['model'], 'sonnet')
    assert.equal(exp.conditions[0]!.knobs['effort'], 'low')
    assert.equal(exp.conditions[1]!.knobs['model'], 'opus')
    assert.equal(exp.conditions[1]!.knobs['effort'], 'high')
  })
})

// ── Storage resilience ───────────────────────────────────────────

describe('experiment — storage resilience', () => {
  test('loadExperiment returns null for non-existent', () => {
    assert.equal(loadExperiment('does-not-exist'), null)
  })

  test('saveExperiment and loadExperiment round-trip', () => {
    const exp = createExperiment({
      hypothesis: 'round trip',
      variable: 'effort',
      conditions: makeConditions(),
      ticksPerCondition: 2,
    })

    const loaded = loadExperiment(exp.id)!
    assert.deepEqual(loaded.conditions, exp.conditions)
    assert.deepEqual(loaded.tickSchedule, exp.tickSchedule)
  })

  test('getExperimentsDir respects env override', () => {
    const customDir = join(tempDir, 'custom-experiments')
    process.env.TRUE_LOVE_EXPERIMENTS_DIR = customDir
    assert.equal(getExperimentsDir(), customDir)
  })
})

// ── Edge cases ──────────────────────────────────────────────────

describe('experiment — edge cases', () => {
  test('single tick per condition', () => {
    const exp = createExperiment({
      hypothesis: 'minimal',
      variable: 'effort',
      conditions: makeConditions(),
      ticksPerCondition: 1,
    })
    startExperiment(exp.id)

    applyExperimentCondition()
    recordExperimentTick(makeTickMetrics(), 1)
    applyExperimentCondition()
    const completed = recordExperimentTick(makeTickMetrics(), 2)
    assert.equal(completed, true)

    const final = loadExperiment(exp.id)!
    assert.equal(final.status, 'complete')
    assert.equal(final.results.length, 2)
  })

  test('abort pending experiment', () => {
    const exp = createExperiment({
      hypothesis: 'abort pending',
      variable: 'effort',
      conditions: makeConditions(),
      ticksPerCondition: 2,
    })
    const aborted = abortExperiment(exp.id)
    assert.equal(aborted.status, 'aborted')
  })

  test('cannot abort complete experiment', () => {
    const exp = createExperiment({
      hypothesis: 'test',
      variable: 'effort',
      conditions: makeConditions(),
      ticksPerCondition: 1,
    })
    startExperiment(exp.id)
    applyExperimentCondition()
    recordExperimentTick(makeTickMetrics(), 1)
    applyExperimentCondition()
    recordExperimentTick(makeTickMetrics(), 2)

    assert.throws(() => abortExperiment(exp.id), /Cannot abort/)
  })

  test('3+ conditions work correctly', () => {
    const exp = createExperiment({
      hypothesis: 'three-way comparison',
      variable: 'effort',
      conditions: [
        { name: 'low', knobs: { effort: 'low' } },
        { name: 'medium', knobs: { effort: 'medium' } },
        { name: 'high', knobs: { effort: 'high' } },
      ],
      ticksPerCondition: 2,
      schedule: 'alternating',
    })

    assert.equal(exp.tickSchedule.length, 6)
    assert.deepEqual(exp.tickSchedule, [0, 1, 2, 0, 1, 2])

    startExperiment(exp.id)
    for (let i = 0; i < 6; i++) {
      applyExperimentCondition()
      recordExperimentTick(makeTickMetrics({ tick: i + 1 }), i + 1)
    }

    const final = loadExperiment(exp.id)!
    assert.equal(final.status, 'complete')
    assert.equal(final.results.length, 6)

    const analysis = analyzeExperiment(final)
    // 3 conditions means no delta (only computed for exactly 2)
    for (const comp of analysis.comparisons) {
      assert.equal(comp.conditions.length, 3)
      assert.equal(comp.deltaAbsolute, null)
      assert.equal(comp.deltaPercent, null)
    }
  })
})
