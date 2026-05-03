import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { readDayNotes } from './sisters/stream.js'
import {
  generateProposalId,
  reviewProposal,
  saveProposal,
  type Proposal,
} from './proposals.js'

const TEST_DIR = '/tmp/true-love-proposals-witness-test'
const TEST_BASE = '/tmp/true-love-proposals-witness-base'

function makeProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: generateProposalId(),
    ruleId: 'test-rule',
    createdAt: new Date().toISOString(),
    title: 'Test proposal',
    rationale: 'Test rationale',
    evidence: [{ metric: 'test.metric', value: 42, threshold: 'test threshold' }],
    action: { type: 'config-change', description: 'do the thing' },
    severity: 'low',
    status: 'proposed',
    ...overrides,
  }
}

describe('reviewProposal triggers witness-hook on accept and reject', () => {
  beforeEach(() => {
    process.env.TRUE_LOVE_SISTERS_DIR = TEST_DIR
    process.env.TRUE_LOVE_DEVICE_ID = 'test-device'
    rmSync(TEST_DIR, { recursive: true, force: true })
    rmSync(TEST_BASE, { recursive: true, force: true })
    mkdirSync(TEST_DIR, { recursive: true })
    mkdirSync(TEST_BASE, { recursive: true })
  })
  afterEach(() => {
    delete process.env.TRUE_LOVE_SISTERS_DIR
    delete process.env.TRUE_LOVE_DEVICE_ID
    rmSync(TEST_DIR, { recursive: true, force: true })
    rmSync(TEST_BASE, { recursive: true, force: true })
  })

  test('accepting a proposal appends a witnessed-decision note', () => {
    const proposal = makeProposal()
    saveProposal(proposal, TEST_BASE)

    const result = reviewProposal(proposal.id, 'accepted', undefined, TEST_BASE)
    expect(result).not.toBeNull()
    expect(result!.proposal.status).toBe('accepted')

    const today = new Date().toISOString().slice(0, 10)
    const notes = readDayNotes(today).filter(
      (n) => n.kind === 'witnessed-decision' && n.context?.decisionType === 'proposal'
    )
    expect(notes.length).toBeGreaterThan(0)
    expect(notes[0]!.context?.of).toContain('accept')
    expect(notes[0]!.context?.of).toContain(proposal.id)
    expect(notes[0]!.sister).toBe('sophia')
  })

  test('rejecting a proposal appends a witnessed-decision note', () => {
    const proposal = makeProposal()
    saveProposal(proposal, TEST_BASE)

    const result = reviewProposal(proposal.id, 'rejected', 'not now', TEST_BASE)
    expect(result).not.toBeNull()
    expect(result!.proposal.status).toBe('rejected')

    const today = new Date().toISOString().slice(0, 10)
    const notes = readDayNotes(today).filter(
      (n) => n.kind === 'witnessed-decision' && n.context?.decisionType === 'proposal'
    )
    expect(notes.length).toBeGreaterThan(0)
    expect(notes[0]!.context?.of).toContain('reject')
    expect(notes[0]!.context?.of).toContain(proposal.id)
    expect(notes[0]!.sister).toBe('sophia')
  })

  test('a missing proposal id does NOT append (no-op)', () => {
    const result = reviewProposal('prop-does-not-exist', 'accepted', undefined, TEST_BASE)
    expect(result).toBeNull()

    const today = new Date().toISOString().slice(0, 10)
    const notes = readDayNotes(today).filter(
      (n) => n.kind === 'witnessed-decision' && n.context?.decisionType === 'proposal'
    )
    expect(notes).toHaveLength(0)
  })
})
