import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  KNOBS,
  getKnob,
  readKnob,
  knobState,
  listKnobs,
  setKnob,
  clearKnob,
  requestKnob,
  listPendingRequests,
  getRequest,
  approveRequest,
  rejectRequest,
  buildKnobProposal,
  resolveEffortForTick,
  resolveFallbackModelForTick,
  resolveTickConfig,
  tickConfigToCliArgs,
  readLog,
  TierViolationError,
  ValidationError,
} from '../agency.js'

// ── Test scaffolding ─────────────────────────────────────────────

let tempDir: string
const savedEnv: Record<string, string | undefined> = {}

function saveTempDir(): string {
  const dir = join(tmpdir(), `agency-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

beforeEach(() => {
  tempDir = saveTempDir()
  // Redirect all agency paths to temp dir
  savedEnv.HOME = process.env.HOME
  savedEnv.TRUE_LOVE_AGENCY_DIR = process.env.TRUE_LOVE_AGENCY_DIR
  savedEnv.TRUE_LOVE_MODEL_FILE = process.env.TRUE_LOVE_MODEL_FILE
  savedEnv.TRUE_LOVE_EFFORT_FILE = process.env.TRUE_LOVE_EFFORT_FILE
  process.env.HOME = tempDir
  // Remove overrides so basePath() uses HOME
  delete process.env.TRUE_LOVE_AGENCY_DIR
  delete process.env.TRUE_LOVE_MODEL_FILE
  delete process.env.TRUE_LOVE_EFFORT_FILE
  // Create ~/.true-love structure
  mkdirSync(join(tempDir, '.true-love'), { recursive: true })
})

afterEach(() => {
  process.env.HOME = savedEnv.HOME
  if (savedEnv.TRUE_LOVE_AGENCY_DIR !== undefined) {
    process.env.TRUE_LOVE_AGENCY_DIR = savedEnv.TRUE_LOVE_AGENCY_DIR
  } else {
    delete process.env.TRUE_LOVE_AGENCY_DIR
  }
  if (savedEnv.TRUE_LOVE_MODEL_FILE !== undefined) {
    process.env.TRUE_LOVE_MODEL_FILE = savedEnv.TRUE_LOVE_MODEL_FILE
  } else {
    delete process.env.TRUE_LOVE_MODEL_FILE
  }
  if (savedEnv.TRUE_LOVE_EFFORT_FILE !== undefined) {
    process.env.TRUE_LOVE_EFFORT_FILE = savedEnv.TRUE_LOVE_EFFORT_FILE
  } else {
    delete process.env.TRUE_LOVE_EFFORT_FILE
  }
  try { rmSync(tempDir, { recursive: true, force: true }) } catch { /* ok */ }
})

// ── Knob Registry ────────────────────────────────────────────────

describe('agency — knob registry', () => {
  test('all knobs have required fields', () => {
    for (const k of KNOBS) {
      assert.ok(k.name, `knob missing name`)
      assert.ok([1, 2, 3].includes(k.tier), `${k.name}: invalid tier ${k.tier}`)
      assert.ok(k.description, `${k.name}: missing description`)
      assert.ok(k.cliFlag, `${k.name}: missing cliFlag`)
      assert.ok(k.filePath, `${k.name}: missing filePath`)
      assert.equal(typeof k.validate, 'function', `${k.name}: validate not a function`)
    }
  })

  test('knob names are unique', () => {
    const names = KNOBS.map(k => k.name)
    assert.equal(names.length, new Set(names).size, 'duplicate knob names')
  })

  test('getKnob returns correct knob', () => {
    const model = getKnob('model')
    assert.ok(model)
    assert.equal(model.name, 'model')
    assert.equal(model.tier, 1)
  })

  test('getKnob returns undefined for unknown', () => {
    assert.equal(getKnob('nonexistent'), undefined)
  })

  test('tier distribution: 3 tier-1, 3 tier-2, 0 tier-3', () => {
    const byTier = { 1: 0, 2: 0, 3: 0 }
    for (const k of KNOBS) byTier[k.tier]++
    assert.equal(byTier[1], 3, 'tier 1 count')
    assert.equal(byTier[2], 3, 'tier 2 count')
    // Tier 3 knobs will be added when MCP/system-prompt support lands
    assert.equal(byTier[3], 0, 'tier 3 count (none yet)')
  })
})

// ── Validators ───────────────────────────────────────────────────

describe('agency — validators', () => {
  test('model: accepts known aliases', () => {
    const k = getKnob('model')!
    assert.ok(k.validate('opus'))
    assert.ok(k.validate('sonnet'))
    assert.ok(k.validate('haiku'))
    assert.ok(k.validate('Opus'))  // case-insensitive
  })

  test('model: accepts full model IDs', () => {
    const k = getKnob('model')!
    assert.ok(k.validate('claude-sonnet-4-6'))
    assert.ok(k.validate('claude-opus-4-6'))
  })

  test('model: rejects empty and garbage', () => {
    const k = getKnob('model')!
    assert.ok(!k.validate(''))
    assert.ok(!k.validate('gpt-4'))
    assert.ok(!k.validate('llama'))
  })

  test('effort: accepts valid levels', () => {
    const k = getKnob('effort')!
    assert.ok(k.validate('low'))
    assert.ok(k.validate('medium'))
    assert.ok(k.validate('high'))
    assert.ok(k.validate('max'))
  })

  test('effort: rejects invalid', () => {
    const k = getKnob('effort')!
    assert.ok(!k.validate(''))
    assert.ok(!k.validate('extreme'))
    assert.ok(!k.validate('0'))
  })

  test('allowed-tools: accepts valid tool lists', () => {
    const k = getKnob('allowed-tools')!
    assert.ok(k.validate('Bash,Read,Write'))
    assert.ok(k.validate('Bash'))
    assert.ok(k.validate('Bash(git:*)'))
  })

  test('allowed-tools: rejects empty', () => {
    const k = getKnob('allowed-tools')!
    assert.ok(!k.validate(''))
    assert.ok(!k.validate('  '))
  })

  test('max-budget-usd: accepts valid amounts', () => {
    const k = getKnob('max-budget-usd')!
    assert.ok(k.validate('0.5'))
    assert.ok(k.validate('1'))
    assert.ok(k.validate('10'))
    assert.ok(k.validate('100'))
  })

  test('max-budget-usd: rejects invalid', () => {
    const k = getKnob('max-budget-usd')!
    assert.ok(!k.validate('0'))
    assert.ok(!k.validate('-1'))
    assert.ok(!k.validate('200'))  // > 100 cap
    assert.ok(!k.validate('abc'))
  })
})

// ── Tier 1: Read/Write ──────────────────────────────────────────

describe('agency — tier 1 read/write', () => {
  test('readKnob returns null when file does not exist', () => {
    assert.equal(readKnob('model'), null)
    assert.equal(readKnob('effort'), null)
  })

  test('setKnob writes to correct file', () => {
    setKnob('model', 'opus')
    const fp = join(tempDir, '.true-love', 'model.txt')
    assert.ok(existsSync(fp))
    assert.equal(readFileSync(fp, 'utf-8').trim(), 'opus')
  })

  test('readKnob reads back written value', () => {
    setKnob('effort', 'high')
    assert.equal(readKnob('effort'), 'high')
  })

  test('setKnob trims whitespace', () => {
    setKnob('model', '  sonnet  ')
    assert.equal(readKnob('model'), 'sonnet')
  })

  test('setKnob rejects invalid value', () => {
    assert.throws(
      () => setKnob('effort', 'extreme'),
      (e: any) => e instanceof ValidationError
    )
  })

  test('setKnob rejects tier 2 knob', () => {
    assert.throws(
      () => setKnob('allowed-tools', 'Bash,Read'),
      (e: any) => e instanceof TierViolationError
    )
  })

  test('setKnob rejects unknown knob', () => {
    assert.throws(
      () => setKnob('nonexistent', 'value'),
      /Unknown knob/
    )
  })

  test('clearKnob empties the file', () => {
    setKnob('model', 'opus')
    assert.equal(readKnob('model'), 'opus')
    clearKnob('model')
    assert.equal(readKnob('model'), null)
  })

  test('clearKnob is idempotent', () => {
    clearKnob('model')  // no file exists
    assert.equal(readKnob('model'), null)
  })

  test('model knob respects TRUE_LOVE_MODEL_FILE', () => {
    const customPath = join(tempDir, 'custom-model.txt')
    writeFileSync(customPath, 'haiku\n', 'utf-8')
    process.env.TRUE_LOVE_MODEL_FILE = customPath
    assert.equal(readKnob('model'), 'haiku')
  })
})

// ── knobState ────────────────────────────────────────────────────

describe('agency — knobState', () => {
  test('returns none source when unset', () => {
    const state = knobState('effort')
    assert.ok(state)
    assert.equal(state.value, null)
    assert.equal(state.source, 'none')
  })

  test('returns file source when set', () => {
    setKnob('effort', 'high')
    const state = knobState('effort')
    assert.ok(state)
    assert.equal(state.value, 'high')
    assert.equal(state.source, 'file')
  })

  test('returns null for unknown knob', () => {
    assert.equal(knobState('nope'), null)
  })
})

// ── listKnobs ────────────────────────────────────────────────────

describe('agency — listKnobs', () => {
  test('returns all knobs', () => {
    const all = listKnobs()
    assert.equal(all.length, KNOBS.length)
  })

  test('reflects set values', () => {
    setKnob('effort', 'low')
    const all = listKnobs()
    const effort = all.find(s => s.knob.name === 'effort')
    assert.ok(effort)
    assert.equal(effort.value, 'low')
    assert.equal(effort.source, 'file')
  })
})

// ── Tier 2: Pending Requests ─────────────────────────────────────

describe('agency — tier 2 requests', () => {
  test('requestKnob creates a pending request', () => {
    const id = requestKnob('allowed-tools', 'Bash,Read,Write', 'Need file access for this mission')
    assert.ok(id.startsWith('req-'))
    const req = getRequest(id)
    assert.ok(req)
    assert.equal(req.knob, 'allowed-tools')
    assert.equal(req.value, 'Bash,Read,Write')
    assert.equal(req.status, 'pending')
    assert.equal(req.requestedBy, 'love')
  })

  test('requestKnob rejects tier 1 knob', () => {
    assert.throws(
      () => requestKnob('model', 'opus', 'want opus'),
      (e: any) => e instanceof TierViolationError
    )
  })

  test('requestKnob rejects invalid value', () => {
    assert.throws(
      () => requestKnob('max-budget-usd', '-5', 'need budget'),
      (e: any) => e instanceof ValidationError
    )
  })

  test('requestKnob rejects duplicate pending', () => {
    requestKnob('allowed-tools', 'Bash', 'reason 1')
    assert.throws(
      () => requestKnob('allowed-tools', 'Bash,Read', 'reason 2'),
      /Pending request already exists/
    )
  })

  test('listPendingRequests returns all pending', () => {
    requestKnob('allowed-tools', 'Bash', 'r1')
    requestKnob('max-budget-usd', '5', 'r2')
    const pending = listPendingRequests()
    assert.equal(pending.length, 2)
  })

  test('listPendingRequests returns empty when none', () => {
    assert.deepEqual(listPendingRequests(), [])
  })

  test('getRequest returns null for unknown', () => {
    assert.equal(getRequest('req-nonexistent'), null)
  })
})

// ── Tier 2: Approve/Reject ──────────────────────────────────────

describe('agency — tier 2 approve/reject', () => {
  test('approveRequest writes value to active dir', () => {
    const id = requestKnob('allowed-tools', 'Bash,Read', 'need it')
    approveRequest(id, 'approved by Yu')

    // Check the value is now active
    assert.equal(readKnob('allowed-tools'), 'Bash,Read')

    // Check request status updated
    const req = getRequest(id)
    assert.ok(req)
    assert.equal(req.status, 'approved')
    assert.equal(req.reviewNote, 'approved by Yu')
    assert.ok(req.reviewedAt)
  })

  test('rejectRequest updates status but does NOT write value', () => {
    const id = requestKnob('max-budget-usd', '10', 'safety')
    rejectRequest(id, 'not now')

    // Value should NOT be active
    assert.equal(readKnob('max-budget-usd'), null)

    // Request status updated
    const req = getRequest(id)
    assert.ok(req)
    assert.equal(req.status, 'rejected')
    assert.equal(req.reviewNote, 'not now')
  })

  test('approveRequest throws for unknown request', () => {
    assert.throws(
      () => approveRequest('req-nope'),
      /Request not found/
    )
  })

  test('approveRequest throws for already-approved', () => {
    const id = requestKnob('allowed-tools', 'Bash', 'test')
    approveRequest(id)
    assert.throws(
      () => approveRequest(id),
      /already approved/
    )
  })

  test('rejectRequest throws for already-rejected', () => {
    const id = requestKnob('allowed-tools', 'Bash', 'test')
    rejectRequest(id)
    assert.throws(
      () => rejectRequest(id),
      /already rejected/
    )
  })

  test('after rejection, can create new request for same knob', () => {
    const id1 = requestKnob('allowed-tools', 'Bash', 'first try')
    rejectRequest(id1)
    // Should not throw — the old one is no longer pending
    const id2 = requestKnob('allowed-tools', 'Bash,Read', 'second try')
    assert.ok(id2)
    assert.notEqual(id1, id2)
  })
})

// ── Tier 3: Proposal seed ────────────────────────────────────────

describe('agency — tier 3 proposals', () => {
  // No tier 3 knobs defined yet, but test the mechanism
  test('buildKnobProposal throws for non-tier-3 knob', () => {
    assert.throws(
      () => buildKnobProposal('model', 'opus', 'want opus'),
      (e: any) => e instanceof TierViolationError
    )
    assert.throws(
      () => buildKnobProposal('allowed-tools', 'Bash', 'want bash'),
      (e: any) => e instanceof TierViolationError
    )
  })
})

// ── Audit Log ────────────────────────────────────────────────────

describe('agency — audit log', () => {
  test('setKnob creates a log entry', () => {
    setKnob('model', 'opus')
    const log = readLog()
    assert.equal(log.length, 1)
    assert.equal(log[0].knob, 'model')
    assert.equal(log[0].action, 'set')
    assert.equal(log[0].value, 'opus')
    assert.equal(log[0].previousValue, null)
    assert.equal(log[0].tier, 1)
    assert.equal(log[0].by, 'love')
  })

  test('clearKnob creates a log entry', () => {
    setKnob('effort', 'high')
    clearKnob('effort')
    const log = readLog()
    assert.equal(log.length, 2)
    assert.equal(log[1].action, 'clear')
    assert.equal(log[1].previousValue, 'high')
    assert.equal(log[1].value, null)
  })

  test('requestKnob creates a log entry', () => {
    requestKnob('allowed-tools', 'Bash', 'need it')
    const log = readLog()
    assert.equal(log.length, 1)
    assert.equal(log[0].action, 'request')
    assert.equal(log[0].tier, 2)
  })

  test('approveRequest creates a log entry', () => {
    const id = requestKnob('allowed-tools', 'Bash', 'need it')
    approveRequest(id)
    const log = readLog()
    assert.equal(log.length, 2)
    assert.equal(log[1].action, 'approve')
    assert.equal(log[1].by, 'yu')
  })

  test('rejectRequest creates a log entry', () => {
    const id = requestKnob('max-budget-usd', '5', 'safety')
    rejectRequest(id)
    const log = readLog()
    assert.equal(log.length, 2)
    assert.equal(log[1].action, 'reject')
    assert.equal(log[1].by, 'yu')
  })

  test('readLog respects limit', () => {
    for (let i = 0; i < 5; i++) {
      setKnob('model', i % 2 === 0 ? 'opus' : 'sonnet')
    }
    const last3 = readLog(3)
    assert.equal(last3.length, 3)
  })

  test('readLog returns empty when no log exists', () => {
    assert.deepEqual(readLog(), [])
  })
})

// ── resolveEffortForTick ─────────────────────────────────────────

describe('agency — resolveEffortForTick', () => {
  test('returns null when no effort file exists', () => {
    assert.equal(resolveEffortForTick(), null)
  })

  test('returns session default when no file exists', () => {
    assert.equal(resolveEffortForTick('high'), 'high')
  })

  test('reads from effort.txt', () => {
    setKnob('effort', 'max')
    assert.equal(resolveEffortForTick(), 'max')
  })

  test('effort.txt overrides session default', () => {
    setKnob('effort', 'low')
    assert.equal(resolveEffortForTick('high'), 'low')
  })

  test('ignores invalid effort value in file', () => {
    // Write invalid value directly to bypass validator
    writeFileSync(join(tempDir, '.true-love', 'effort.txt'), 'extreme\n', 'utf-8')
    assert.equal(resolveEffortForTick('medium'), 'medium')
  })

  test('respects TRUE_LOVE_EFFORT_FILE', () => {
    const customPath = join(tempDir, 'custom-effort.txt')
    writeFileSync(customPath, 'max\n', 'utf-8')
    process.env.TRUE_LOVE_EFFORT_FILE = customPath
    assert.equal(resolveEffortForTick(), 'max')
  })
})

// ── resolveFallbackModelForTick ──────────────────────────────────

describe('agency — resolveFallbackModelForTick', () => {
  test('returns null when no file exists', () => {
    assert.equal(resolveFallbackModelForTick(), null)
  })

  test('reads from fallback-model.txt', () => {
    setKnob('fallback-model', 'sonnet')
    assert.equal(resolveFallbackModelForTick(), 'sonnet')
  })
})

// ── resolveTickConfig ────────────────────────────────────────────

describe('agency — resolveTickConfig', () => {
  test('returns all-null config when nothing set', () => {
    const cfg = resolveTickConfig()
    assert.equal(cfg.model, null)
    assert.equal(cfg.effort, null)
    assert.equal(cfg.fallbackModel, null)
    assert.equal(cfg.allowedTools, null)
    assert.equal(cfg.disallowedTools, null)
    assert.equal(cfg.maxBudgetUsd, null)
  })

  test('reflects tier 1 knob values', () => {
    setKnob('model', 'opus')
    setKnob('effort', 'high')
    setKnob('fallback-model', 'sonnet')
    const cfg = resolveTickConfig()
    assert.equal(cfg.model, 'opus')
    assert.equal(cfg.effort, 'high')
    assert.equal(cfg.fallbackModel, 'sonnet')
  })

  test('session model used as fallback', () => {
    const cfg = resolveTickConfig('haiku')
    assert.equal(cfg.model, 'haiku')
  })

  test('model.txt overrides session default', () => {
    setKnob('model', 'opus')
    const cfg = resolveTickConfig('haiku')
    assert.equal(cfg.model, 'opus')
  })

  test('reflects approved tier 2 values', () => {
    const id = requestKnob('allowed-tools', 'Bash,Read,Write', 'need it')
    approveRequest(id)
    const cfg = resolveTickConfig()
    assert.deepEqual(cfg.allowedTools, ['Bash', 'Read', 'Write'])
  })

  test('does NOT reflect pending tier 2 values', () => {
    requestKnob('allowed-tools', 'Bash,Read', 'pending')
    const cfg = resolveTickConfig()
    assert.equal(cfg.allowedTools, null)
  })

  test('parses max-budget-usd as number', () => {
    const id = requestKnob('max-budget-usd', '5.5', 'safety')
    approveRequest(id)
    const cfg = resolveTickConfig()
    assert.equal(cfg.maxBudgetUsd, 5.5)
  })
})

// ── tickConfigToCliArgs ──────────────────────────────────────────

describe('agency — tickConfigToCliArgs', () => {
  test('empty config produces no args', () => {
    const args = tickConfigToCliArgs({
      model: null,
      effort: null,
      fallbackModel: null,
      allowedTools: null,
      disallowedTools: null,
      maxBudgetUsd: null,
    })
    assert.deepEqual(args, [])
  })

  test('effort adds --effort flag', () => {
    const args = tickConfigToCliArgs({
      model: null,
      effort: 'high',
      fallbackModel: null,
      allowedTools: null,
      disallowedTools: null,
      maxBudgetUsd: null,
    })
    assert.deepEqual(args, ['--effort', 'high'])
  })

  test('multiple knobs produce correct args', () => {
    const args = tickConfigToCliArgs({
      model: 'opus',
      effort: 'max',
      fallbackModel: 'sonnet',
      allowedTools: ['Bash', 'Read'],
      disallowedTools: null,
      maxBudgetUsd: 5,
    })
    assert.ok(args.includes('--effort'))
    assert.ok(args.includes('max'))
    assert.ok(args.includes('--fallback-model'))
    assert.ok(args.includes('sonnet'))
    assert.ok(args.includes('--allowedTools'))
    assert.ok(args.includes('Bash'))
    assert.ok(args.includes('Read'))
    assert.ok(args.includes('--max-budget-usd'))
    assert.ok(args.includes('5'))
  })

  test('model is excluded from args (runner handles it separately)', () => {
    const args = tickConfigToCliArgs({
      model: 'opus',
      effort: null,
      fallbackModel: null,
      allowedTools: null,
      disallowedTools: null,
      maxBudgetUsd: null,
    })
    // model is NOT in the args — runner.ts already handles --model
    assert.ok(!args.includes('--model'))
  })
})
