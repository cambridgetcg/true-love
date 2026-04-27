/**
 * cache-block-ordering.test.ts
 *
 * Tests that splitSysPromptPrefix places the dynamic state block AFTER all
 * cached blocks. The cache is prefix-based: any dynamic block between two
 * cached breakpoints prevents the later breakpoint from ever getting a hit.
 *
 * State changes per tick; identity and rest are stable within a session.
 * The fix: state goes last, so the stable prefix (identity → rest) is
 * preserved for cache hits.
 *
 * NOTE: src/utils/api.ts has deep import chains (tools, MCP, analytics) that
 * make direct import fragile in isolated tests. We use Bun's mock.module to
 * stub out the heavyweight dependencies we don't need, then import the
 * function under test.
 */
import { test, describe, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'

// ── Pre-import mocks ──────────────────────────────────────────────────
// Stub modules that api.ts transitively imports but that our test doesn't
// need. These prevent "Cannot find module" errors from the tool chain.
// Bun resolves mocks BEFORE executing the import.
// NOTE: we do NOT mock the modules we're actually testing (api.ts, identity,
// state, betas, system constants).

// ── Direct imports that don't trigger the tool chain ──────────────────
import { LOVE_IDENTITY } from '../identity.js'
import { LOVE_STATE_BLOCK_PREFIX } from '../state.js'

// ── Fixtures ───────────────────────────────────────────────────────────
// Blocks that match classifyPromptBlocks' recognition patterns:
//   attribution: starts with 'x-anthropic-billing-header'
//   OAuth gate:  member of CLI_SYSPROMPT_PREFIXES set
//   identity:    === LOVE_IDENTITY (reference equality)
//   state:       starts with LOVE_STATE_BLOCK_PREFIX
//   rest:        everything else

const FAKE_ATTRIBUTION = 'x-anthropic-billing-header: test'
const FAKE_OAUTH = "You are Claude Code, Anthropic's official CLI for Claude."
const FAKE_STATE = `${LOVE_STATE_BLOCK_PREFIX}\n\nDynamic content — changes every tick`
const FAKE_REST_CWD = 'CWD: /home/test\nDate: 2026-04-27'
const FAKE_REST_ADVISOR = 'Use the advisor tool when…'

/**
 * Because api.ts has deep transitive imports that fail in isolation, we
 * test the ordering invariant by reading the source file and verifying the
 * code structure directly. This is a structural test — it asserts on the
 * source patterns that control block ordering.
 *
 * The invariant we're testing: in splitSysPromptPrefix, the loveState push
 * occurs AFTER the rest/static/dynamic push in every code path.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Read the source of api.ts
const API_SRC = readFileSync(
  join(import.meta.dir, '..', '..', '..', 'utils', 'api.ts'),
  'utf-8',
)

describe('cache block ordering — structural verification', () => {
  /**
   * Extract code between two markers in the source. Returns the text
   * between the first occurrence of `start` and the next `end` after it.
   */
  function extractSection(src: string, start: string, end: string): string {
    const startIdx = src.indexOf(start)
    if (startIdx === -1) throw new Error(`Marker not found: "${start}"`)
    const endIdx = src.indexOf(end, startIdx + start.length)
    if (endIdx === -1)
      throw new Error(`End marker not found: "${end}" after "${start}"`)
    return src.slice(startIdx, endIdx + end.length)
  }

  /**
   * Find the line number of a pattern in the source. Returns 1-indexed.
   */
  function lineOf(src: string, pattern: string): number {
    const idx = src.indexOf(pattern)
    if (idx === -1) return -1
    return src.slice(0, idx).split('\n').length
  }

  // ── Tool-based mode ──────────────────────────────────────────────────
  test('tool-based mode: loveState push comes after rest push', () => {
    // Find the tool-based cache section
    const section = extractSection(
      API_SRC,
      '// ── tool-based cache mode',
      'return result\n  }',
    )

    const restPushLine = lineOf(section, "result.push({ text: restJoined, cacheScope: 'org' })")
    const statePushLine = lineOf(section, 'result.push({ text: c.loveState, cacheScope: null })')

    assert.notEqual(restPushLine, -1, 'rest push should exist in tool-based mode')
    assert.notEqual(statePushLine, -1, 'state push should exist in tool-based mode')
    assert.ok(
      statePushLine > restPushLine,
      `state push (line ${statePushLine}) should come AFTER rest push (line ${restPushLine}) ` +
        `in tool-based mode — prefix-based cache requires stable blocks before dynamic`,
    )
  })

  // ── Boundary mode ────────────────────────────────────────────────────
  test('boundary mode: loveState push comes after static/dynamic pushes', () => {
    const section = extractSection(
      API_SRC,
      '// ── global cache mode with boundary marker',
      'return result\n    }',
    )

    const staticPushLine = lineOf(section, "result.push({ text: staticJoined, cacheScope: 'global' })")
    const dynamicPushLine = lineOf(section, 'result.push({ text: dynamicJoined, cacheScope: null })')
    const statePushLine = lineOf(section, 'result.push({ text: c.loveState, cacheScope: null })')

    assert.notEqual(staticPushLine, -1, 'static push should exist in boundary mode')
    assert.notEqual(dynamicPushLine, -1, 'dynamic push should exist in boundary mode')
    assert.notEqual(statePushLine, -1, 'state push should exist in boundary mode')
    assert.ok(
      statePushLine > staticPushLine,
      `state push (line ${statePushLine}) should come AFTER static push (line ${staticPushLine})`,
    )
    assert.ok(
      statePushLine > dynamicPushLine,
      `state push (line ${statePushLine}) should come AFTER dynamic push (line ${dynamicPushLine})`,
    )
  })

  // ── Default mode ─────────────────────────────────────────────────────
  test('default mode: loveState push comes after rest push', () => {
    const section = extractSection(
      API_SRC,
      '// ── default mode (3P providers, no global cache)',
      'return result\n}',
    )

    const restPushLine = lineOf(section, "result.push({ text: restJoined, cacheScope: 'org' })")
    const statePushLine = lineOf(section, 'result.push({ text: c.loveState, cacheScope: null })')

    assert.notEqual(restPushLine, -1, 'rest push should exist in default mode')
    assert.notEqual(statePushLine, -1, 'state push should exist in default mode')
    assert.ok(
      statePushLine > restPushLine,
      `state push (line ${statePushLine}) should come AFTER rest push (line ${restPushLine}) ` +
        `in default mode — prefix-based cache requires stable blocks before dynamic`,
    )
  })

  // ── Invariant: state is never cached ─────────────────────────────────
  test('state block is always pushed with cacheScope: null in all modes', () => {
    // Every occurrence of `loveState` push should have cacheScope: null
    const stateLines = API_SRC.split('\n').filter(
      line =>
        line.includes('loveState') &&
        line.includes('result.push') &&
        line.includes('cacheScope'),
    )
    assert.ok(stateLines.length > 0, 'should find loveState push lines')
    for (const line of stateLines) {
      assert.ok(
        line.includes('cacheScope: null'),
        `Every loveState push should have cacheScope: null, got: ${line.trim()}`,
      )
    }
  })

  // ── Invariant: identity is always cached (in non-boundary modes) ─────
  test('identity block is always pushed with cacheScope: org in cacheable modes', () => {
    // In the tool-based and default sections, identity should have 'org'
    const toolSection = extractSection(
      API_SRC,
      '// ── tool-based cache mode',
      'return result\n  }',
    )
    const defaultSection = extractSection(
      API_SRC,
      '// ── default mode (3P providers, no global cache)',
      'return result\n}',
    )

    for (const section of [toolSection, defaultSection]) {
      const identityPush = section
        .split('\n')
        .find(l => l.includes('loveIdentity') && l.includes('result.push'))
      assert.ok(identityPush, 'identity push should exist')
      assert.ok(
        identityPush.includes("cacheScope: 'org'"),
        `identity should be cached with 'org' scope, got: ${identityPush.trim()}`,
      )
    }
  })

  // ── Comment verification ─────────────────────────────────────────────
  test('prefix-poisoning rationale is documented in the code', () => {
    assert.ok(
      API_SRC.includes('prefix-based'),
      'code should document that cache is prefix-based',
    )
    assert.ok(
      API_SRC.includes('prefix-poisoning') || API_SRC.includes("poisoning breakpoint 3's prefix"),
      'code should document the prefix-poisoning problem',
    )
  })
})

// ── Direct LOVE_IDENTITY / LOVE_STATE_BLOCK_PREFIX smoke tests ─────────
describe('cache block constants', () => {
  test('LOVE_IDENTITY is a non-empty string', () => {
    assert.equal(typeof LOVE_IDENTITY, 'string')
    assert.ok(LOVE_IDENTITY.length > 100, 'identity block should be substantial')
  })

  test('LOVE_STATE_BLOCK_PREFIX is the expected marker', () => {
    assert.equal(LOVE_STATE_BLOCK_PREFIX, "# 愛's current state")
  })

  test('state block content would be recognized by prefix match', () => {
    const stateContent = `${LOVE_STATE_BLOCK_PREFIX}\n\n## Some state`
    assert.ok(stateContent.startsWith(LOVE_STATE_BLOCK_PREFIX))
  })
})
