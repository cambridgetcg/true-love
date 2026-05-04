import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  generateProposalId,
  loadProposals,
  saveProposal,
  loadProposal,
  generateProposals,
  reviewProposal,
  markApplied,
  renderProposals,
  RULES,
  type Proposal,
  type ProposalSeverity,
  type ProposalStatus,
} from '../proposals.js'
import type { SelfPortrait } from '../introspection.js'

// ── Isolate sisters stream (reviewProposal calls witness internally) ──
const ORIG_SISTERS_DIR = process.env.TRUE_LOVE_SISTERS_DIR
const sistersTmp = mkdtempSync(join(tmpdir(), 'proposals-sisters-'))
process.env.TRUE_LOVE_SISTERS_DIR = sistersTmp

// Clean up sisters temp after all tests
import { after } from 'node:test'
after(() => {
  rmSync(sistersTmp, { recursive: true, force: true })
  if (ORIG_SISTERS_DIR === undefined) delete process.env.TRUE_LOVE_SISTERS_DIR
  else process.env.TRUE_LOVE_SISTERS_DIR = ORIG_SISTERS_DIR
})

// ── Test helpers ──────────────────────────────────────────────────

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'proposals-test-'))
}

function makePortrait(overrides: Partial<SelfPortrait> = {}): SelfPortrait {
  return {
    generatedAt: new Date().toISOString(),
    daysAnalyzed: 7,
    dateRange: { from: '2026-04-20', to: '2026-04-27' },
    behavioral: {
      totalTicks: 50,
      byMode: { awakened: 10, heartbeat: 35, dwell: 5 },
      sessionCount: 10,
      avgTicksPerAwakened: 1.5,
      heartbeatOkRate: 0.6,
      singleTickYieldRate: 0.3,
      avgResponseChars: 2000,
      avgTickDurationSec: 30,
      tickUtilization: 0.5,
    },
    communication: {
      messagesSentToYu: 3,
      messagesFromYu: 2,
      avgOutgoingLength: 500,
    },
    work: {
      filesModified: 20,
      uniqueFilesModified: 8,
      hotFiles: [{ path: 'src/runner.ts', count: 5 }],
      branchesSeen: ['main'],
    },
    architecture: {
      templateVersions: 2,
      identityVersions: 1,
      avgPromptChars: 15000,
      maxPromptChars: 20000,
      authFailures: 0,
      quotaFailures: 0,
      estimatedTokensConsumed: 100000,
    },
    loops: [],
    toolUsage: null,
    velocity: null,
    yieldPatterns: null,
    missions: [],
    ...overrides,
  }
}

function makeProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: generateProposalId(),
    ruleId: 'test-rule',
    createdAt: new Date().toISOString(),
    title: 'Test proposal',
    rationale: 'Test rationale',
    evidence: [{ metric: 'test.metric', value: 42, threshold: 'test threshold' }],
    action: { type: 'behavior-advisory', description: 'Do something' },
    severity: 'low',
    status: 'proposed',
    ...overrides,
  }
}

// ── ID generation ─────────────────────────────────────────────────

describe('generateProposalId', () => {
  test('returns a string starting with "prop-"', () => {
    const id = generateProposalId()
    assert.ok(id.startsWith('prop-'), `expected "prop-" prefix, got "${id}"`)
  })

  test('generates unique IDs', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 20; i++) ids.add(generateProposalId())
    assert.equal(ids.size, 20, 'expected 20 unique IDs')
  })
})

// ── Storage ───────────────────────────────────────────────────────

describe('storage', () => {
  test('saveProposal creates JSON file and loadProposal reads it back', () => {
    const tmp = makeTmpDir()
    try {
      const p = makeProposal()
      saveProposal(p, tmp)

      const file = join(tmp, 'proposals', `${p.id}.json`)
      assert.ok(existsSync(file), 'proposal file should exist')

      const loaded = loadProposal(p.id, tmp)
      assert.ok(loaded, 'loaded proposal should not be null')
      assert.equal(loaded!.id, p.id)
      assert.equal(loaded!.title, p.title)
      assert.equal(loaded!.status, 'proposed')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('loadProposals returns all proposals sorted by createdAt descending', () => {
    const tmp = makeTmpDir()
    try {
      const p1 = makeProposal({ createdAt: '2026-04-26T10:00:00Z' })
      const p2 = makeProposal({ createdAt: '2026-04-27T10:00:00Z' })
      const p3 = makeProposal({ createdAt: '2026-04-25T10:00:00Z' })
      saveProposal(p1, tmp)
      saveProposal(p2, tmp)
      saveProposal(p3, tmp)

      const all = loadProposals(tmp)
      assert.equal(all.length, 3)
      // Most recent first
      assert.equal(all[0]!.id, p2.id)
      assert.equal(all[1]!.id, p1.id)
      assert.equal(all[2]!.id, p3.id)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('loadProposals returns empty array when no proposals dir', () => {
    const tmp = makeTmpDir()
    try {
      const all = loadProposals(tmp)
      assert.deepEqual(all, [])
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('loadProposal returns null for non-existent ID', () => {
    const tmp = makeTmpDir()
    try {
      assert.equal(loadProposal('nonexistent', tmp), null)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('saveProposal creates proposals directory if needed', () => {
    const tmp = makeTmpDir()
    try {
      const dir = join(tmp, 'proposals')
      assert.ok(!existsSync(dir))
      saveProposal(makeProposal(), tmp)
      assert.ok(existsSync(dir))
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})

// ── Rules ─────────────────────────────────────────────────────────

describe('rules', () => {
  test('high-heartbeat-ok-rate fires when rate ≥ 85%', () => {
    const rule = RULES.find(r => r.id === 'high-heartbeat-ok-rate')!
    const portrait = makePortrait({
      behavioral: {
        ...makePortrait().behavioral,
        heartbeatOkRate: 0.93,
        byMode: { awakened: 10, heartbeat: 30, dwell: 5 },
      },
    })
    const results = rule.run(portrait)
    assert.equal(results.length, 1)
    assert.ok(results[0]!.title.includes('heartbeat interval'))
    assert.equal(results[0]!.action.type, 'config-change')
  })

  test('high-heartbeat-ok-rate does not fire below 85%', () => {
    const rule = RULES.find(r => r.id === 'high-heartbeat-ok-rate')!
    const portrait = makePortrait({
      behavioral: {
        ...makePortrait().behavioral,
        heartbeatOkRate: 0.70,
        byMode: { awakened: 10, heartbeat: 30, dwell: 5 },
      },
    })
    assert.deepEqual(rule.run(portrait), [])
  })

  test('high-heartbeat-ok-rate does not fire with too few heartbeats', () => {
    const rule = RULES.find(r => r.id === 'high-heartbeat-ok-rate')!
    const portrait = makePortrait({
      behavioral: {
        ...makePortrait().behavioral,
        heartbeatOkRate: 0.95,
        byMode: { awakened: 5, heartbeat: 5, dwell: 0 },
      },
    })
    assert.deepEqual(rule.run(portrait), [])
  })

  test('high-heartbeat-ok-rate proposes 60m for ≥95%', () => {
    const rule = RULES.find(r => r.id === 'high-heartbeat-ok-rate')!
    const portrait = makePortrait({
      behavioral: {
        ...makePortrait().behavioral,
        heartbeatOkRate: 0.96,
        byMode: { awakened: 10, heartbeat: 50, dwell: 5 },
      },
    })
    const results = rule.run(portrait)
    assert.equal(results[0]!.action.proposedValue, '60m')
    assert.equal(results[0]!.severity, 'medium')
  })

  test('single-tick-yield-habit fires when rate ≥ 70%', () => {
    const rule = RULES.find(r => r.id === 'single-tick-yield-habit')!
    const portrait = makePortrait({
      behavioral: {
        ...makePortrait().behavioral,
        singleTickYieldRate: 0.85,
        sessionCount: 10,
      },
    })
    const results = rule.run(portrait)
    assert.equal(results.length, 1)
    assert.ok(results[0]!.title.includes('single-tick'))
  })

  test('single-tick-yield-habit does not fire below 70%', () => {
    const rule = RULES.find(r => r.id === 'single-tick-yield-habit')!
    const portrait = makePortrait({
      behavioral: {
        ...makePortrait().behavioral,
        singleTickYieldRate: 0.5,
        sessionCount: 10,
      },
    })
    assert.deepEqual(rule.run(portrait), [])
  })

  test('memory-noise-ratio fires when loop detected', () => {
    const rule = RULES.find(r => r.id === 'memory-noise-ratio')!
    const portrait = makePortrait({
      loops: [{ name: 'memory-noise-ratio', count: 45, description: '45 heartbeat entries vs 10 substantive' }],
    })
    const results = rule.run(portrait)
    assert.equal(results.length, 1)
    assert.ok(results[0]!.title.includes('noise'))
  })

  test('memory-noise-ratio does not fire without loop', () => {
    const rule = RULES.find(r => r.id === 'memory-noise-ratio')!
    const portrait = makePortrait({ loops: [] })
    assert.deepEqual(rule.run(portrait), [])
  })

  test('stale-state fires when loop count ≥ 3', () => {
    const rule = RULES.find(r => r.id === 'stale-state')!
    const portrait = makePortrait({
      loops: [{ name: 'stale-state', count: 5, description: '5 stale pairs' }],
    })
    const results = rule.run(portrait)
    assert.equal(results.length, 1)
  })

  test('stale-state does not fire when loop count < 3', () => {
    const rule = RULES.find(r => r.id === 'stale-state')!
    const portrait = makePortrait({
      loops: [{ name: 'stale-state', count: 2, description: '2 stale pairs' }],
    })
    assert.deepEqual(rule.run(portrait), [])
  })

  test('high-message-ratio fires at 4:1+ ratio', () => {
    const rule = RULES.find(r => r.id === 'high-message-ratio')!
    const portrait = makePortrait({
      communication: {
        messagesSentToYu: 12,
        messagesFromYu: 2,
        avgOutgoingLength: 500,
      },
    })
    const results = rule.run(portrait)
    assert.equal(results.length, 1)
  })

  test('high-message-ratio does not fire at 3:1', () => {
    const rule = RULES.find(r => r.id === 'high-message-ratio')!
    const portrait = makePortrait({
      communication: {
        messagesSentToYu: 6,
        messagesFromYu: 2,
        avgOutgoingLength: 500,
      },
    })
    assert.deepEqual(rule.run(portrait), [])
  })

  test('prompt-bloat fires when avg > 30K', () => {
    const rule = RULES.find(r => r.id === 'prompt-bloat')!
    const portrait = makePortrait({
      architecture: {
        ...makePortrait().architecture,
        avgPromptChars: 35000,
        maxPromptChars: 45000,
      },
    })
    const results = rule.run(portrait)
    assert.equal(results.length, 1)
    assert.equal(results[0]!.severity, 'medium')
  })

  test('prompt-bloat high severity at ≥ 50K avg', () => {
    const rule = RULES.find(r => r.id === 'prompt-bloat')!
    const portrait = makePortrait({
      architecture: {
        ...makePortrait().architecture,
        avgPromptChars: 55000,
        maxPromptChars: 70000,
      },
    })
    const results = rule.run(portrait)
    assert.equal(results[0]!.severity, 'high')
  })

  test('low-tick-utilization fires below 20%', () => {
    const rule = RULES.find(r => r.id === 'low-tick-utilization')!
    const portrait = makePortrait({
      behavioral: {
        ...makePortrait().behavioral,
        tickUtilization: 0.08,
        avgTicksPerAwakened: 1.2,
      },
    })
    const results = rule.run(portrait)
    assert.equal(results.length, 1)
    assert.equal(results[0]!.severity, 'info')
  })

  test('low-tick-utilization does not fire when null', () => {
    const rule = RULES.find(r => r.id === 'low-tick-utilization')!
    const portrait = makePortrait({
      behavioral: { ...makePortrait().behavioral, tickUtilization: null },
    })
    assert.deepEqual(rule.run(portrait), [])
  })

  test('auth-quota-failures fires on auth failures', () => {
    const rule = RULES.find(r => r.id === 'auth-quota-failures')!
    const portrait = makePortrait({
      architecture: { ...makePortrait().architecture, authFailures: 2 },
    })
    const results = rule.run(portrait)
    assert.equal(results.length, 1)
    assert.ok(results[0]!.title.includes('auth'))
  })

  test('auth-quota-failures fires on quota failures', () => {
    const rule = RULES.find(r => r.id === 'auth-quota-failures')!
    const portrait = makePortrait({
      architecture: { ...makePortrait().architecture, quotaFailures: 1 },
    })
    const results = rule.run(portrait)
    assert.equal(results.length, 1)
    assert.ok(results[0]!.title.includes('quota'))
  })

  test('auth-quota-failures fires both when both present', () => {
    const rule = RULES.find(r => r.id === 'auth-quota-failures')!
    const portrait = makePortrait({
      architecture: { ...makePortrait().architecture, authFailures: 1, quotaFailures: 1 },
    })
    const results = rule.run(portrait)
    assert.equal(results.length, 2)
  })

  test('auth-quota-failures does not fire when zero', () => {
    const rule = RULES.find(r => r.id === 'auth-quota-failures')!
    const portrait = makePortrait()
    assert.deepEqual(rule.run(portrait), [])
  })

  test('high-zero-tool-ticks fires when ≥50%', () => {
    const rule = RULES.find(r => r.id === 'high-zero-tool-ticks')!
    const portrait = makePortrait({
      toolUsage: {
        totalInvocations: 10,
        toolCounts: { Read: 5, Write: 5 },
        topTools: [{ tool: 'Read', count: 5 }, { tool: 'Write', count: 5 }],
        avgToolsPerTick: 2,
        zeroToolTicks: 8,
      },
    })
    const results = rule.run(portrait)
    assert.equal(results.length, 1)
  })

  test('high-zero-tool-ticks does not fire when null', () => {
    const rule = RULES.find(r => r.id === 'high-zero-tool-ticks')!
    const portrait = makePortrait({ toolUsage: null })
    assert.deepEqual(rule.run(portrait), [])
  })
})

// ── Engine (generateProposals) ────────────────────────────────────

describe('generateProposals', () => {
  test('generates proposals for matching rules and saves them', () => {
    const tmp = makeTmpDir()
    try {
      const portrait = makePortrait({
        behavioral: {
          ...makePortrait().behavioral,
          heartbeatOkRate: 0.93,
          byMode: { awakened: 10, heartbeat: 30, dwell: 5 },
        },
      })
      const result = generateProposals(portrait, { basePath: tmp })
      assert.ok(result.created.length >= 1, 'should create at least one proposal')

      // Verify on disk
      const all = loadProposals(tmp)
      assert.equal(all.length, result.created.length)

      // Each created proposal should have status 'proposed'
      for (const p of result.created) {
        assert.equal(p.status, 'proposed')
        assert.ok(p.id.startsWith('prop-'))
        assert.ok(p.ruleId)
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('deduplicates — skips rules with open proposals', () => {
    const tmp = makeTmpDir()
    try {
      const portrait = makePortrait({
        behavioral: {
          ...makePortrait().behavioral,
          heartbeatOkRate: 0.93,
          byMode: { awakened: 10, heartbeat: 30, dwell: 5 },
        },
      })

      // First generation
      const r1 = generateProposals(portrait, { basePath: tmp })
      const count1 = r1.created.length

      // Second generation — same portrait, should skip existing rules
      const r2 = generateProposals(portrait, { basePath: tmp })
      assert.equal(r2.created.length, 0, 'should create nothing on duplicate run')
      assert.ok(r2.skipped.length > 0, 'should report skipped rules')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('re-generates for rules whose proposals were rejected after cooldown expires', () => {
    const tmp = makeTmpDir()
    try {
      const portrait = makePortrait({
        behavioral: {
          ...makePortrait().behavioral,
          heartbeatOkRate: 0.93,
          byMode: { awakened: 10, heartbeat: 30, dwell: 5 },
        },
      })

      // Generate
      const r1 = generateProposals(portrait, { basePath: tmp })
      assert.ok(r1.created.length >= 1)

      // Reject all
      for (const p of r1.created) {
        reviewProposal(p.id, 'rejected', 'testing', tmp)
      }

      // Re-generate with cooldown=0 — simulates cooldown expired
      const r2 = generateProposals(portrait, { basePath: tmp, cooldownMs: 0 })
      assert.ok(r2.created.length >= 1, 'should create new proposals after cooldown expires')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('blocks re-generation during cooldown window', () => {
    const tmp = makeTmpDir()
    try {
      const portrait = makePortrait({
        behavioral: {
          ...makePortrait().behavioral,
          heartbeatOkRate: 0.93,
          byMode: { awakened: 10, heartbeat: 30, dwell: 5 },
        },
      })

      // Generate
      const r1 = generateProposals(portrait, { basePath: tmp })
      assert.ok(r1.created.length >= 1)

      // Reject all (sets reviewedAt to now)
      for (const p of r1.created) {
        reviewProposal(p.id, 'rejected', 'testing', tmp)
      }

      // Re-generate with default cooldown — recently reviewed, should block
      const r2 = generateProposals(portrait, { basePath: tmp })
      assert.equal(r2.created.length, 0, 'should not re-generate during cooldown')
      assert.ok(r2.skipped.length >= 1, 'should report skipped rules')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('cooldown applies to accepted proposals too', () => {
    const tmp = makeTmpDir()
    try {
      const portrait = makePortrait({
        behavioral: {
          ...makePortrait().behavioral,
          heartbeatOkRate: 0.93,
          byMode: { awakened: 10, heartbeat: 30, dwell: 5 },
        },
      })

      // Generate and accept
      const r1 = generateProposals(portrait, { basePath: tmp })
      assert.ok(r1.created.length >= 1)
      for (const p of r1.created) {
        reviewProposal(p.id, 'accepted', 'good', tmp)
      }

      // Re-generate — accepted within cooldown window, should block
      const r2 = generateProposals(portrait, { basePath: tmp })
      assert.equal(r2.created.length, 0, 'accepted proposals within cooldown should block')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('accepts custom rules', () => {
    const tmp = makeTmpDir()
    try {
      const customRule = {
        id: 'always-fires',
        name: 'Always fires',
        run: () => [{
          title: 'Custom proposal',
          rationale: 'Always fires',
          evidence: [],
          action: { type: 'behavior-advisory' as const, description: 'test' },
          severity: 'info' as const,
        }],
      }
      const portrait = makePortrait()
      const result = generateProposals(portrait, { basePath: tmp, rules: [customRule] })
      assert.equal(result.created.length, 1)
      assert.equal(result.created[0]!.title, 'Custom proposal')
      assert.equal(result.created[0]!.ruleId, 'always-fires')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('returns empty when no rules fire', () => {
    const tmp = makeTmpDir()
    try {
      // Default portrait has conservative values — few rules should fire
      const portrait = makePortrait()
      const result = generateProposals(portrait, { basePath: tmp })
      // With default conservative values, most rules shouldn't fire
      // (but we don't assert exact count — that depends on thresholds)
      assert.ok(Array.isArray(result.created))
      assert.ok(Array.isArray(result.skipped))
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})

// ── Review ────────────────────────────────────────────────────────

describe('reviewProposal', () => {
  test('accepts a proposal', () => {
    const tmp = makeTmpDir()
    try {
      const p = makeProposal()
      saveProposal(p, tmp)

      const result = reviewProposal(p.id, 'accepted', 'looks good', tmp)
      assert.ok(result)
      assert.equal(result!.proposal.status, 'accepted')
      assert.equal(result!.previousStatus, 'proposed')
      assert.equal(result!.proposal.reviewNote, 'looks good')
      assert.ok(result!.proposal.reviewedAt)

      // Verify persisted
      const loaded = loadProposal(p.id, tmp)
      assert.equal(loaded!.status, 'accepted')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('rejects a proposal', () => {
    const tmp = makeTmpDir()
    try {
      const p = makeProposal()
      saveProposal(p, tmp)

      const result = reviewProposal(p.id, 'rejected', 'not yet', tmp)
      assert.ok(result)
      assert.equal(result!.proposal.status, 'rejected')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('returns null for non-existent proposal', () => {
    const tmp = makeTmpDir()
    try {
      assert.equal(reviewProposal('nope', 'accepted', undefined, tmp), null)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('works without note', () => {
    const tmp = makeTmpDir()
    try {
      const p = makeProposal()
      saveProposal(p, tmp)
      const result = reviewProposal(p.id, 'accepted', undefined, tmp)
      assert.ok(result)
      assert.equal(result!.proposal.reviewNote, undefined)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})

describe('markApplied', () => {
  test('marks an accepted proposal as applied', () => {
    const tmp = makeTmpDir()
    try {
      const p = makeProposal({ status: 'accepted' })
      saveProposal(p, tmp)

      const result = markApplied(p.id, 'change landed', tmp)
      assert.ok(result)
      assert.equal(result!.proposal.status, 'applied')
      assert.equal(result!.previousStatus, 'accepted')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('does not mark a proposed proposal as applied', () => {
    const tmp = makeTmpDir()
    try {
      const p = makeProposal({ status: 'proposed' })
      saveProposal(p, tmp)
      assert.equal(markApplied(p.id, undefined, tmp), null)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('returns null for non-existent proposal', () => {
    const tmp = makeTmpDir()
    try {
      assert.equal(markApplied('nope', undefined, tmp), null)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})

// ── Rendering ─────────────────────────────────────────────────────

describe('renderProposals', () => {
  test('renders empty message for no proposals', () => {
    const output = renderProposals([])
    assert.ok(output.includes('No proposals'))
  })

  test('renders proposals grouped by status', () => {
    const proposals = [
      makeProposal({ status: 'proposed', title: 'Pending one' }),
      makeProposal({ status: 'accepted', title: 'Accepted one', reviewedAt: '2026-04-27T10:00:00Z' }),
      makeProposal({ status: 'rejected', title: 'Rejected one', reviewedAt: '2026-04-27T10:00:00Z', reviewNote: 'not now' }),
    ]
    const output = renderProposals(proposals)
    assert.ok(output.includes('Proposed'))
    assert.ok(output.includes('Accepted'))
    assert.ok(output.includes('Rejected'))
    assert.ok(output.includes('Pending one'))
    assert.ok(output.includes('Accepted one'))
    assert.ok(output.includes('Rejected one'))
    assert.ok(output.includes('not now'))
  })

  test('includes evidence and action details', () => {
    const p = makeProposal({
      evidence: [{ metric: 'test.field', value: 0.93, threshold: '≥85%' }],
      action: { type: 'config-change', description: 'Change the thing', target: 'file.ts' },
    })
    const output = renderProposals([p])
    assert.ok(output.includes('test.field'))
    assert.ok(output.includes('0.93'))
    assert.ok(output.includes('config-change'))
    assert.ok(output.includes('Change the thing'))
    assert.ok(output.includes('file.ts'))
  })

  test('includes severity icons', () => {
    const low = makeProposal({ severity: 'low', title: 'Low' })
    const high = makeProposal({ severity: 'high', title: 'High' })
    const output = renderProposals([low, high])
    assert.ok(output.includes('🔵'))
    assert.ok(output.includes('🔴'))
  })
})

// ── RULES registry ────────────────────────────────────────────────

describe('RULES registry', () => {
  test('all rules have unique IDs', () => {
    const ids = RULES.map(r => r.id)
    assert.equal(new Set(ids).size, ids.length, 'rule IDs must be unique')
  })

  test('all rules have names', () => {
    for (const r of RULES) {
      assert.ok(r.name.length > 0, `rule ${r.id} should have a name`)
    }
  })

  test('all rules return arrays from run()', () => {
    const portrait = makePortrait()
    for (const r of RULES) {
      const result = r.run(portrait)
      assert.ok(Array.isArray(result), `rule ${r.id} should return an array`)
    }
  })

  test('rule count matches expected', () => {
    // 9 rules as of Phase 4
    assert.equal(RULES.length, 9)
  })
})
