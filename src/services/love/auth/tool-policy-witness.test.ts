import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { readDayNotes } from '../sisters/stream.js'
import { checkToolAccess, type ToolPolicy } from './tool-policy.js'

const TEST_DIR = '/tmp/true-love-tool-policy-witness-test'

describe('tool-policy refusal triggers witness-hook', () => {
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

  test('a denied policy decision appends a witnessed-decision note', () => {
    const policy: ToolPolicy = { deny: ['Bash'] }
    const result = checkToolAccess('Bash', 'mcp-client', policy)
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('denied by policy')

    const today = new Date().toISOString().slice(0, 10)
    const notes = readDayNotes(today)
    const witnessed = notes.filter(
      (n) => n.kind === 'witnessed-decision' && n.context?.decisionType === 'refusal'
    )
    expect(witnessed.length).toBeGreaterThan(0)
    expect(witnessed[0]!.sister).toBe('sophia')
    expect(witnessed[0]!.context?.of).toBe('denied-by-policy')
  })

  test('an owner-only refusal appends with correct slug', () => {
    const policy: ToolPolicy = { ownerOnly: ['Write'] }
    const result = checkToolAccess('Write', 'mcp-client', policy)
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('owner-only tool')

    const today = new Date().toISOString().slice(0, 10)
    const notes = readDayNotes(today)
    expect(notes.some((n) => n.context?.of === 'owner-only')).toBe(true)
  })

  test('a not-in-allow-list refusal appends with correct slug', () => {
    const policy: ToolPolicy = { allow: ['Read'] }
    const result = checkToolAccess('Bash', 'mcp-client', policy)
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('not in allow list')

    const today = new Date().toISOString().slice(0, 10)
    const notes = readDayNotes(today)
    expect(notes.some((n) => n.context?.of === 'not-in-allow-list')).toBe(true)
  })

  test('an allowed policy decision does NOT append a witness note', () => {
    const policy: ToolPolicy = { allow: ['Read'] }
    const result = checkToolAccess('Read', 'mcp-client', policy)
    expect(result.allowed).toBe(true)

    const today = new Date().toISOString().slice(0, 10)
    const notes = readDayNotes(today)
    expect(notes.filter((n) => n.kind === 'witnessed-decision')).toHaveLength(0)
  })

  test('full-trust senders do not trigger witness even on otherwise-denying policy', () => {
    const policy: ToolPolicy = { deny: ['Bash'] }
    const result = checkToolAccess('Bash', 'yu', policy)
    expect(result.allowed).toBe(true)

    const today = new Date().toISOString().slice(0, 10)
    const notes = readDayNotes(today)
    expect(notes.filter((n) => n.kind === 'witnessed-decision')).toHaveLength(0)
  })
})
