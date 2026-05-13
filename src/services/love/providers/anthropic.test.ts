// providers/anthropic.test.ts — tests for the Anthropic provider.
//
// Covers: AnthropicProvider.resolve() (model selection, effort mapping,
// task defaults, CLI args), TASK_DEFAULTS correctness,
// AnthropicProvider.status() (env var gate), supports().

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  ANTHROPIC_MODELS,
  AnthropicProvider,
  TASK_DEFAULTS,
  getAnthropicProvider,
} from './anthropic.js'

const ORIG_API_KEY = process.env.ANTHROPIC_API_KEY

afterEach(() => {
  if (ORIG_API_KEY === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = ORIG_API_KEY
})

// ── TASK_DEFAULTS ─────────────────────────────────────────────────────

describe('TASK_DEFAULTS', () => {
  test('heartbeat uses opus (meta-recognition for autonomous ticks)', () => {
    expect(TASK_DEFAULTS.heartbeat.model).toBe('opus')
  })

  test('awakened uses sonnet', () => {
    expect(TASK_DEFAULTS.awakened.model).toBe('sonnet')
  })

  test('dwell uses opus (max effort)', () => {
    expect(TASK_DEFAULTS.dwell.model).toBe('opus')
    expect(TASK_DEFAULTS.dwell.effort).toBe('max')
  })

  test('visit uses priority service tier (Yu is waiting)', () => {
    expect(TASK_DEFAULTS.visit.serviceTier).toBe('priority')
  })

  test('extract uses haiku (cheap background work)', () => {
    expect(TASK_DEFAULTS.extract.model).toBe('haiku')
    expect(TASK_DEFAULTS.extract.effort).toBe('low')
  })

  test('all tasks have a model, effort, and serviceTier defined', () => {
    const tasks = ['heartbeat', 'awakened', 'dwell', 'visit', 'extract', 'agent'] as const
    for (const task of tasks) {
      const d = TASK_DEFAULTS[task]
      expect(d.model).toBeTruthy()
      expect(d.effort).toBeTruthy()
      expect(d.serviceTier).toBeTruthy()
    }
  })
})

// ── ANTHROPIC_MODELS ──────────────────────────────────────────────────

describe('ANTHROPIC_MODELS', () => {
  test('opus, sonnet, haiku are all defined', () => {
    expect(ANTHROPIC_MODELS.opus).toContain('claude')
    expect(ANTHROPIC_MODELS.sonnet).toContain('claude')
    expect(ANTHROPIC_MODELS.haiku).toContain('claude')
  })
})

// ── AnthropicProvider.supports ────────────────────────────────────────

describe('AnthropicProvider.supports', () => {
  const p = new AnthropicProvider()

  test('supports all tasks', () => {
    const tasks = ['heartbeat', 'awakened', 'dwell', 'visit', 'extract', 'agent'] as const
    for (const task of tasks) {
      expect(p.supports(task)).toBe(true)
    }
  })
})

// ── AnthropicProvider.resolve ─────────────────────────────────────────

describe('AnthropicProvider.resolve', () => {
  const p = new AnthropicProvider()

  test('heartbeat with no override → opus model (task default)', () => {
    const r = p.resolve({ task: 'heartbeat', effort: 'high' })
    expect(r.provider).toBe('anthropic')
    expect(r.model).toBe(ANTHROPIC_MODELS.opus)
    expect(r.cliAlias).toBe('opus')
  })

  test('awakened with no override → sonnet', () => {
    const r = p.resolve({ task: 'awakened', effort: 'high' })
    expect(r.model).toBe(ANTHROPIC_MODELS.sonnet)
    expect(r.cliAlias).toBe('sonnet')
  })

  test('extract with no override → haiku (task default)', () => {
    const r = p.resolve({ task: 'extract', effort: 'low' })
    expect(r.model).toBe(ANTHROPIC_MODELS.haiku)
    expect(r.cliAlias).toBe('haiku')
  })

  test('effort=max on awakened → opus (effort override beats task default for non-heartbeat)', () => {
    const r = p.resolve({ task: 'awakened', effort: 'max' })
    expect(r.model).toBe(ANTHROPIC_MODELS.opus)
  })

  test('effort=low on awakened → haiku', () => {
    const r = p.resolve({ task: 'awakened', effort: 'low' })
    expect(r.model).toBe(ANTHROPIC_MODELS.haiku)
  })

  test('heartbeat always → opus regardless of effort (task default dominates)', () => {
    // heartbeat and extract use task defaults, not effort mapping
    expect(p.resolve({ task: 'heartbeat', effort: 'low' }).model).toBe(ANTHROPIC_MODELS.opus)
    expect(p.resolve({ task: 'heartbeat', effort: 'medium' }).model).toBe(ANTHROPIC_MODELS.opus)
  })

  test('extract always → haiku regardless of effort (task default dominates)', () => {
    expect(p.resolve({ task: 'extract', effort: 'max' }).model).toBe(ANTHROPIC_MODELS.haiku)
    expect(p.resolve({ task: 'extract', effort: 'high' }).model).toBe(ANTHROPIC_MODELS.haiku)
  })

  test('visit effort=low → haiku (effort-mapped, not task-locked)', () => {
    // visit is NOT task-locked like heartbeat/extract
    const r = p.resolve({ task: 'visit', effort: 'low' })
    expect(r.model).toBe(ANTHROPIC_MODELS.haiku)
  })

  test('agent effort=high → sonnet', () => {
    const r = p.resolve({ task: 'agent', effort: 'high' })
    expect(r.model).toBe(ANTHROPIC_MODELS.sonnet)
  })

  test('effort=medium → sonnet for standard tasks', () => {
    const r = p.resolve({ task: 'agent', effort: 'medium' })
    expect(r.model).toBe(ANTHROPIC_MODELS.sonnet)
  })

  test('model alias "sonnet" overrides task+effort', () => {
    const r = p.resolve({ task: 'heartbeat', effort: 'max', model: 'sonnet' })
    expect(r.model).toBe(ANTHROPIC_MODELS.sonnet)
    expect(r.cliAlias).toBe('sonnet')
  })

  test('model alias "haiku" overrides task+effort', () => {
    const r = p.resolve({ task: 'dwell', effort: 'max', model: 'haiku' })
    expect(r.model).toBe(ANTHROPIC_MODELS.haiku)
    expect(r.cliAlias).toBe('haiku')
  })

  test('full claude- model ID passes through unchanged', () => {
    const r = p.resolve({ task: 'awakened', effort: 'high', model: 'claude-sonnet-4-20250514' })
    expect(r.model).toBe('claude-sonnet-4-20250514')
    expect(r.cliAlias).toBe('claude-sonnet-4-20250514')
  })

  test('unknown model string passes through', () => {
    const r = p.resolve({ task: 'awakened', effort: 'high', model: 'experimental-v1' })
    expect(r.model).toBe('experimental-v1')
  })

  test('cliArgs contains --effort flag', () => {
    const r = p.resolve({ task: 'awakened', effort: 'high' })
    expect(r.cliArgs).toBeDefined()
    const args = r.cliArgs!
    const effortIdx = args.indexOf('--effort')
    expect(effortIdx).toBeGreaterThanOrEqual(0)
    expect(args[effortIdx + 1]).toBe('high')
  })

  test('effort=low → --effort low in cliArgs', () => {
    const r = p.resolve({ task: 'extract', effort: 'low' })
    expect(r.cliArgs).toContain('low')
  })

  test('effort=max → --effort max in cliArgs', () => {
    const r = p.resolve({ task: 'dwell', effort: 'max' })
    expect(r.cliArgs).toContain('max')
  })

  test('serviceTier matches task default for heartbeat (standard)', () => {
    const r = p.resolve({ task: 'heartbeat', effort: 'high' })
    expect(r.serviceTier).toBe('standard')
  })

  test('serviceTier matches task default for visit (priority)', () => {
    const r = p.resolve({ task: 'visit', effort: 'high' })
    expect(r.serviceTier).toBe('priority')
  })
})

// ── AnthropicProvider.status ──────────────────────────────────────────

describe('AnthropicProvider.status', () => {
  const p = new AnthropicProvider()

  test('no API key → unhealthy', async () => {
    delete process.env.ANTHROPIC_API_KEY
    const s = await p.status()
    expect(s.healthy).toBe(false)
    expect(s.reason).toContain('ANTHROPIC_API_KEY')
  })

  test('API key present → healthy (key check only, no live call)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-fake-key'
    const s = await p.status()
    expect(s.healthy).toBe(true)
  })
})

// ── getAnthropicProvider singleton ───────────────────────────────────

describe('getAnthropicProvider', () => {
  test('returns same instance on repeated calls', () => {
    const a = getAnthropicProvider()
    const b = getAnthropicProvider()
    expect(a).toBe(b)
  })

  test('instance is an AnthropicProvider', () => {
    expect(getAnthropicProvider()).toBeInstanceOf(AnthropicProvider)
  })
})
