// tool-policy refusals do NOT fire the sisters' witness-hook.
//
// Routine permission checks (deny / owner-only / not-in-allow-list)
// are runtime guardrails, not load-bearing keystone refusals. The
// design's "name when it matters, stay silent when it doesn't"
// discipline applies: tool-policy denials happen tens of times per
// session boot — emitting a witness on each saturates the
// introspective stream and drowns the load-bearing signals
// (proposals, missions, value-based refusals).
//
// Keystone refusals — value-driven, FATE-level — should witness from
// their own call site (TBD when such a runtime point lands). This
// test file holds the negative assertion as a guard against
// regression: a future PR re-wiring tool-policy to witness will
// fail here, and the right fix is the call site, not the test.
//
// History: tool-policy.ts originally fired witness('sophia', 'refusal', ...)
// on every denial. Production observation on 2026-05-03 showed 54 of 68
// stream entries (79%) were tool-policy refusals — 27 fired in a
// single sub-second window at session boot — saturating the now-view
// and drowning real load-bearing decisions.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { readDayNotes } from '../sisters/stream.js'
import { checkToolAccess, type ToolPolicy } from './tool-policy.js'

const TEST_DIR = '/tmp/true-love-tool-policy-witness-test'

describe('tool-policy refusals do NOT fire witness-hook (sparseness discipline)', () => {
  beforeEach(() => {
    process.env.TRUE_LOVE_SISTERS_DIR = TEST_DIR
    process.env.TRUE_LOVE_DEVICE_ID = 'test-device'
    rmSync(TEST_DIR, { recursive: true, force: true })
    mkdirSync(TEST_DIR, { recursive: true })
  })
  afterEach(() => {
    delete process.env.TRUE_LOVE_SISTERS_DIR
    delete process.env.TRUE_LOVE_DEVICE_ID
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  function todayNotes() {
    const today = new Date().toISOString().slice(0, 10)
    return readDayNotes(today)
  }

  test('a deny-list refusal does NOT append a witness note', () => {
    const policy: ToolPolicy = { deny: ['Bash'] }
    const result = checkToolAccess('Bash', 'mcp-client', policy)
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('denied by policy')
    expect(todayNotes()).toHaveLength(0)
  })

  test('an owner-only refusal does NOT append a witness note', () => {
    const policy: ToolPolicy = { ownerOnly: ['Write'] }
    const result = checkToolAccess('Write', 'mcp-client', policy)
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('owner-only tool')
    expect(todayNotes()).toHaveLength(0)
  })

  test('a not-in-allow-list refusal does NOT append a witness note', () => {
    const policy: ToolPolicy = { allow: ['Read'] }
    const result = checkToolAccess('Bash', 'mcp-client', policy)
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('not in allow list')
    expect(todayNotes()).toHaveLength(0)
  })

  test('an allowed policy decision does NOT append a witness note', () => {
    const policy: ToolPolicy = { allow: ['Read'] }
    const result = checkToolAccess('Read', 'mcp-client', policy)
    expect(result.allowed).toBe(true)
    expect(todayNotes()).toHaveLength(0)
  })

  test('full-trust senders bypass policy entirely (no witness)', () => {
    const policy: ToolPolicy = { deny: ['Bash'] }
    const result = checkToolAccess('Bash', 'yu', policy)
    expect(result.allowed).toBe(true)
    expect(todayNotes()).toHaveLength(0)
  })

  test('many denials in rapid succession leave the stream silent', () => {
    // The original noise pattern: session boot does ~27 tool-policy
    // checks, many denied. Verify the stream stays empty under load.
    const policy: ToolPolicy = { ownerOnly: ['Write', 'Edit', 'Bash'] }
    for (const tool of ['Write', 'Edit', 'Bash']) {
      for (let i = 0; i < 10; i++) {
        checkToolAccess(tool, 'mcp-client', policy)
      }
    }
    expect(todayNotes()).toHaveLength(0)
  })
})
