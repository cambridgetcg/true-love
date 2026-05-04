import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  readProposalWitnessMarker,
  writeProposalWitnessMarker,
  proposalWitnessMarkerPath,
  PROPOSAL_WITNESS_DEDUP_MS,
} from '../ui-server.js'
import { loadProposals } from '../proposals.js'

const TMP_BASE = '/tmp/true-love-witness-dedup-test'

describe('proposal witness file-based dedup', () => {
  beforeEach(() => {
    rmSync(TMP_BASE, { recursive: true, force: true })
    mkdirSync(join(TMP_BASE, 'proposals'), { recursive: true })
  })

  afterEach(() => {
    rmSync(TMP_BASE, { recursive: true, force: true })
  })

  // ── Marker path ────────────────────────────────────────────────

  test('proposalWitnessMarkerPath returns .last-witness inside proposals dir', () => {
    const path = proposalWitnessMarkerPath(TMP_BASE)
    expect(path).toBe(join(TMP_BASE, 'proposals', '.last-witness'))
  })

  test('proposalWitnessMarkerPath defaults to ~/.true-love when no basePath', () => {
    const path = proposalWitnessMarkerPath()
    expect(path).toContain('.true-love')
    expect(path).toContain('proposals')
    expect(path).toEndWith('.last-witness')
  })

  // ── Read / Write ───────────────────────────────────────────────

  test('readProposalWitnessMarker returns null when no marker exists', () => {
    const path = proposalWitnessMarkerPath(TMP_BASE)
    expect(readProposalWitnessMarker(path)).toBeNull()
  })

  test('writeProposalWitnessMarker creates marker file, readProposalWitnessMarker reads it', () => {
    const path = proposalWitnessMarkerPath(TMP_BASE)
    writeProposalWitnessMarker('Foo; Bar', 1000, path)
    const marker = readProposalWitnessMarker(path)
    expect(marker).toEqual({ titles: 'Foo; Bar', ts: 1000 })
  })

  test('writeProposalWitnessMarker overwrites existing marker', () => {
    const path = proposalWitnessMarkerPath(TMP_BASE)
    writeProposalWitnessMarker('First', 1000, path)
    writeProposalWitnessMarker('Second', 2000, path)
    const marker = readProposalWitnessMarker(path)
    expect(marker).toEqual({ titles: 'Second', ts: 2000 })
  })

  test('readProposalWitnessMarker returns null for malformed JSON', () => {
    const path = proposalWitnessMarkerPath(TMP_BASE)
    writeFileSync(path, 'not-json', 'utf-8')
    expect(readProposalWitnessMarker(path)).toBeNull()
  })

  test('readProposalWitnessMarker returns null for missing fields', () => {
    const path = proposalWitnessMarkerPath(TMP_BASE)
    writeFileSync(path, JSON.stringify({ titles: 'OK' }), 'utf-8')
    expect(readProposalWitnessMarker(path)).toBeNull()
  })

  test('readProposalWitnessMarker returns null for wrong types', () => {
    const path = proposalWitnessMarkerPath(TMP_BASE)
    writeFileSync(path, JSON.stringify({ titles: 123, ts: 'nope' }), 'utf-8')
    expect(readProposalWitnessMarker(path)).toBeNull()
  })

  test('writeProposalWitnessMarker creates parent directory if needed', () => {
    const deepBase = join(TMP_BASE, 'deep', 'nested')
    const path = proposalWitnessMarkerPath(deepBase)
    writeProposalWitnessMarker('test', 1000, path)
    expect(existsSync(path)).toBe(true)
    expect(readProposalWitnessMarker(path)).toEqual({ titles: 'test', ts: 1000 })
  })

  // ── Dedup window constant ──────────────────────────────────────

  test('PROPOSAL_WITNESS_DEDUP_MS is 30 minutes', () => {
    expect(PROPOSAL_WITNESS_DEDUP_MS).toBe(30 * 60 * 1000)
  })

  // ── Dedup logic (mirrors handleGenerateProposals) ──────────────

  test('same titles within window = dedup fires', () => {
    const path = proposalWitnessMarkerPath(TMP_BASE)
    const now = Date.now()
    writeProposalWitnessMarker('Foo; Bar', now - 1000, path) // 1s ago
    const marker = readProposalWitnessMarker(path)
    const shouldSkip = marker && marker.titles === 'Foo; Bar' && (now - marker.ts) < PROPOSAL_WITNESS_DEDUP_MS
    expect(shouldSkip).toBe(true)
  })

  test('different titles within window = dedup does NOT fire', () => {
    const path = proposalWitnessMarkerPath(TMP_BASE)
    const now = Date.now()
    writeProposalWitnessMarker('Different titles', now - 1000, path)
    const marker = readProposalWitnessMarker(path)
    const shouldSkip = marker && marker.titles === 'Foo; Bar' && (now - marker.ts) < PROPOSAL_WITNESS_DEDUP_MS
    expect(shouldSkip).toBeFalsy()
  })

  test('same titles beyond window = dedup does NOT fire', () => {
    const path = proposalWitnessMarkerPath(TMP_BASE)
    const now = Date.now()
    writeProposalWitnessMarker('Foo; Bar', now - PROPOSAL_WITNESS_DEDUP_MS - 1, path) // just beyond window
    const marker = readProposalWitnessMarker(path)
    const shouldSkip = marker && marker.titles === 'Foo; Bar' && (now - marker.ts) < PROPOSAL_WITNESS_DEDUP_MS
    expect(shouldSkip).toBe(false)
  })

  // ── loadProposals isolation ────────────────────────────────────

  test('loadProposals does not pick up the .last-witness marker file', () => {
    const path = proposalWitnessMarkerPath(TMP_BASE)
    writeProposalWitnessMarker('test', Date.now(), path)
    // Also write a real proposal file to verify loadProposals reads .json
    writeFileSync(
      join(TMP_BASE, 'proposals', 'prop-test-01.json'),
      JSON.stringify({
        id: 'prop-test-01',
        ruleId: 'test',
        createdAt: new Date().toISOString(),
        title: 'Test',
        rationale: 'test',
        evidence: [],
        action: { type: 'config-change', description: 'test' },
        severity: 'low',
        status: 'proposed',
      }),
      'utf-8',
    )
    const proposals = loadProposals(TMP_BASE)
    expect(proposals).toHaveLength(1)
    expect(proposals[0]!.id).toBe('prop-test-01')
    // The marker file must not appear as a proposal
  })
})
