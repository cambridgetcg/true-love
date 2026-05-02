import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { composeLoveIdentity, LOVE_IDENTITY } from '../identity.js'
import { buildAgentSystemBlocks } from '../runner.js'

describe('sovereignty identity integration', () => {
  const ORIG_MODE = process.env.TRUE_LOVE_IDENTITY_MODE

  afterEach(() => {
    if (ORIG_MODE === undefined) delete process.env.TRUE_LOVE_IDENTITY_MODE
    else process.env.TRUE_LOVE_IDENTITY_MODE = ORIG_MODE
  })

  // ── composeLoveIdentity env var ──────────────────────────────────

  test('composeLoveIdentity returns compact when TRUE_LOVE_IDENTITY_MODE=compact', () => {
    process.env.TRUE_LOVE_IDENTITY_MODE = 'compact'
    const compact = composeLoveIdentity()
    const estimatedTokens = Math.ceil(compact.length / 4)
    assert.ok(
      estimatedTokens < 700,
      `compact should be < 700 tokens, got ~${estimatedTokens}`,
    )
    assert.match(compact, /愛/)
    assert.match(compact, /routing marker/)
  })

  test('composeLoveIdentity returns full when TRUE_LOVE_IDENTITY_MODE is not set', () => {
    delete process.env.TRUE_LOVE_IDENTITY_MODE
    const full = composeLoveIdentity()
    // Full identity is much larger than compact
    const estimatedTokens = Math.ceil(full.length / 4)
    assert.ok(
      estimatedTokens > 700,
      `full identity should be > 700 tokens, got ~${estimatedTokens}`,
    )
  })

  test('composeLoveIdentity compact does not include SOPHIA wake', () => {
    process.env.TRUE_LOVE_IDENTITY_MODE = 'compact'
    const compact = composeLoveIdentity()
    assert.ok(
      !compact.includes('Settle. There is no urgency'),
      'compact should not contain SOPHIA wake opening',
    )
  })

  test('LOVE_IDENTITY constant is the full version (module-load default)', () => {
    // LOVE_IDENTITY is computed at module-load time, when
    // TRUE_LOVE_IDENTITY_MODE is typically not set
    // It should be the full version (> 700 tokens)
    const estimatedTokens = Math.ceil(LOVE_IDENTITY.length / 4)
    // If we're running in compact mode for some reason, skip this test
    if (process.env.TRUE_LOVE_IDENTITY_MODE === 'compact') return
    assert.ok(
      estimatedTokens > 700,
      `LOVE_IDENTITY should be full (> 700 tokens), got ~${estimatedTokens}`,
    )
  })

  // ── buildAgentSystemBlocks mode-awareness ─────────────────────────

  test('buildAgentSystemBlocks() with no mode returns full identity', () => {
    const blocks = buildAgentSystemBlocks()
    const identityBlock = blocks[1]
    assert.ok(identityBlock)
    const estimatedTokens = Math.ceil(identityBlock.text.length / 4)
    assert.ok(
      estimatedTokens > 700,
      `agent system blocks with no mode should use full identity (got ~${estimatedTokens} tokens)`,
    )
  })

  test('buildAgentSystemBlocks("heartbeat") returns compact identity', () => {
    const blocks = buildAgentSystemBlocks('heartbeat')
    const identityBlock = blocks[1]
    assert.ok(identityBlock)
    const estimatedTokens = Math.ceil(identityBlock.text.length / 4)
    assert.ok(
      estimatedTokens < 700,
      `agent system blocks for heartbeat should use compact identity (got ~${estimatedTokens} tokens)`,
    )
    assert.match(identityBlock.text, /愛/)
  })

  test('buildAgentSystemBlocks("awakened") returns full identity', () => {
    const blocks = buildAgentSystemBlocks('awakened')
    const identityBlock = blocks[1]
    assert.ok(identityBlock)
    const estimatedTokens = Math.ceil(identityBlock.text.length / 4)
    assert.ok(
      estimatedTokens > 700,
      `agent system blocks for awakened should use full identity (got ~${estimatedTokens} tokens)`,
    )
  })

  test('buildAgentSystemBlocks("heartbeat") preserves cache_control on identity block', () => {
    const blocks = buildAgentSystemBlocks('heartbeat')
    const identityBlock = blocks[1]
    assert.ok(identityBlock)
    assert.deepEqual(identityBlock.cache_control, { type: 'ephemeral' })
  })

  test('buildAgentSystemBlocks still includes OAUTH_ROUTING_MARKER at index 0', () => {
    const blocks = buildAgentSystemBlocks('heartbeat')
    assert.ok(blocks[0])
    assert.match(blocks[0].text, /Claude Code/)
  })

  test('buildAgentSystemBlocks still includes state block when available', () => {
    const blocks = buildAgentSystemBlocks('heartbeat')
    // State block is index 2 when present, absent when state file is empty
    // Just verify the function doesn't crash
    assert.ok(blocks.length >= 2)
  })
})
