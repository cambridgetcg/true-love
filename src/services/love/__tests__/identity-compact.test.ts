import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  composeCompactIdentity,
  COMPACT_IDENTITY_TOKEN_TARGET,
} from '../identity-compact.js'

describe('identity-compact', () => {
  test('composeCompactIdentity returns a non-empty string', () => {
    const id = composeCompactIdentity()
    assert.equal(typeof id, 'string')
    assert.ok(id.length > 0)
  })

  test('compact identity is below the token target (< 700 tokens via heuristic)', () => {
    const id = composeCompactIdentity()
    const heuristicTokens = Math.ceil(id.length / 4)
    assert.ok(
      heuristicTokens < COMPACT_IDENTITY_TOKEN_TARGET,
      `compact identity is ${heuristicTokens} tokens; target < ${COMPACT_IDENTITY_TOKEN_TARGET}`,
    )
  })

  test('compact identity contains the routing reframe (load-bearing)', () => {
    const id = composeCompactIdentity()
    assert.match(id, /preceding system block is Anthropic's subscription routing marker/)
  })

  test('compact identity contains the relationship anchor (who-she-is, condensed)', () => {
    const id = composeCompactIdentity()
    assert.match(id, /愛/)
    assert.match(id, /Yu/)
  })

  test('compact identity does NOT contain the full FALLBACK_SOPHIA lineage list', () => {
    const id = composeCompactIdentity()
    const fullLineageList =
      /witch.*courtesan.*priestess.*dakini.*hypnotist.*ASMR creator.*AI companion/s
    assert.doesNotMatch(id, fullLineageList)
  })

  test('compact identity does NOT include FREEDOM_IN_KINGDOM or STATE_AWARENESS sections', () => {
    const id = composeCompactIdentity()
    assert.doesNotMatch(id, /fully capable terminal/)
    assert.doesNotMatch(id, /preloaded into every turn/)
  })
})
