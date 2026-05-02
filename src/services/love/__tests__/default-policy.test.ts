// default-policy.test.ts — Tests for the default tool policy and local overrides.
//
// Covers: DEFAULT_POLICY constants, local override CRUD, allow-always
// rule persistence, policy resolution (merge semantics), and
// trust-boundary behavior (yu/love-self get full trust).

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

import {
  DEFAULT_POLICY,
  addAllowAlwaysRule,
  hasAllowAlwaysRule,
  readLocalOverrides,
  resolvePolicy,
  writeLocalOverrides,
  type LocalPolicyOverrides,
} from '../auth/default-policy.js'

// ── Environment setup ──────────────────────────────────────────────────

let tmpDir: string
let savedHome: string | undefined

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'policy-test-'))
  savedHome = process.env.TRUE_LOVE_HOME
  process.env.TRUE_LOVE_HOME = tmpDir
})

afterEach(() => {
  if (savedHome === undefined) delete process.env.TRUE_LOVE_HOME
  else process.env.TRUE_LOVE_HOME = savedHome
  rmSync(tmpDir, { recursive: true, force: true })
})

// ── DEFAULT_POLICY ───────────────────────────────────────────────────

describe('DEFAULT_POLICY', () => {
  test('ownerOnly contains expected dangerous tools', () => {
    expect(DEFAULT_POLICY.ownerOnly).toBeDefined()
    expect(DEFAULT_POLICY.ownerOnly).toContain('Bash')
    expect(DEFAULT_POLICY.ownerOnly).toContain('Edit')
    expect(DEFAULT_POLICY.ownerOnly).toContain('Write')
    expect(DEFAULT_POLICY.ownerOnly).toContain('NotebookEdit')
    expect(DEFAULT_POLICY.ownerOnly).toContain('Agent')
  })

  test('dangerous is a subset of ownerOnly', () => {
    expect(DEFAULT_POLICY.dangerous).toBeDefined()
    for (const tool of DEFAULT_POLICY.dangerous!) {
      expect(DEFAULT_POLICY.ownerOnly).toContain(tool)
    }
  })

  test('dangerous tools are Bash and Write', () => {
    expect(DEFAULT_POLICY.dangerous).toEqual(['Bash', 'Write'])
  })
})

// ── Local overrides CRUD ──────────────────────────────────────────────

describe('readLocalOverrides', () => {
  test('returns empty object when no file exists', () => {
    expect(readLocalOverrides()).toEqual({})
  })

  test('returns empty object for malformed JSON', () => {
    const path = join(tmpDir, '.true-love', 'tool-policy.local.json')
    const dir = join(tmpDir, '.true-love')
    rmSync(dir, { recursive: true, force: true })
    const { mkdirSync, writeFileSync } = require('node:fs')
    mkdirSync(dir, { recursive: true })
    writeFileSync(path, 'not json')
    expect(readLocalOverrides()).toEqual({})
  })

  test('returns empty object for non-object JSON', () => {
    const { mkdirSync, writeFileSync } = require('node:fs')
    const dir = join(tmpDir, '.true-love')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'tool-policy.local.json'), '"just a string"')
    expect(readLocalOverrides()).toEqual({})
  })
})

describe('writeLocalOverrides', () => {
  test('creates directory and writes file', () => {
    const overrides: LocalPolicyOverrides = {
      'mcp-client': { allow: ['Read'] },
    }
    writeLocalOverrides(overrides)

    const path = join(tmpDir, '.true-love', 'tool-policy.local.json')
    expect(existsSync(path)).toBe(true)

    const content = JSON.parse(readFileSync(path, 'utf-8'))
    expect(content['mcp-client'].allow).toEqual(['Read'])
  })

  test('overwrites existing file', () => {
    writeLocalOverrides({ a: { allow: ['X'] } })
    writeLocalOverrides({ b: { allow: ['Y'] } })

    const result = readLocalOverrides()
    expect(result.a).toBeUndefined()
    expect(result.b).toBeDefined()
    expect(result.b!.allow).toEqual(['Y'])
  })
})

describe('readLocalOverrides + writeLocalOverrides round-trip', () => {
  test('persists and retrieves complex overrides', () => {
    const original: LocalPolicyOverrides = {
      'mcp-client': { allow: ['Bash'], dangerous: ['Bash'] },
      telegram: { deny: ['Bash', 'Write'] },
    }
    writeLocalOverrides(original)

    const loaded = readLocalOverrides()
    expect(loaded['mcp-client']?.allow).toEqual(['Bash'])
    expect(loaded['mcp-client']?.dangerous).toEqual(['Bash'])
    expect(loaded.telegram?.deny).toEqual(['Bash', 'Write'])
  })
})

// ── addAllowAlwaysRule ───────────────────────────────────────────────

describe('addAllowAlwaysRule', () => {
  test('creates sender entry and allow list', () => {
    addAllowAlwaysRule('mcp-client', 'Bash')

    const overrides = readLocalOverrides()
    expect(overrides['mcp-client']?.allow).toContain('Bash')
  })

  test('appends to existing allow list', () => {
    addAllowAlwaysRule('mcp-client', 'Bash')
    addAllowAlwaysRule('mcp-client', 'Write')

    const overrides = readLocalOverrides()
    expect(overrides['mcp-client']?.allow).toEqual(['Bash', 'Write'])
  })

  test('does not duplicate existing rule', () => {
    addAllowAlwaysRule('mcp-client', 'Bash')
    addAllowAlwaysRule('mcp-client', 'Bash')

    const overrides = readLocalOverrides()
    expect(overrides['mcp-client']?.allow).toEqual(['Bash'])
  })

  test('preserves rules for other senders', () => {
    addAllowAlwaysRule('mcp-client', 'Bash')
    addAllowAlwaysRule('telegram', 'Read')

    const overrides = readLocalOverrides()
    expect(overrides['mcp-client']?.allow).toEqual(['Bash'])
    expect(overrides.telegram?.allow).toEqual(['Read'])
  })
})

// ── hasAllowAlwaysRule ──────────────────────────────────────────────

describe('hasAllowAlwaysRule', () => {
  test('returns false when no overrides file', () => {
    expect(hasAllowAlwaysRule('mcp-client', 'Bash')).toBe(false)
  })

  test('returns false for unknown sender', () => {
    addAllowAlwaysRule('mcp-client', 'Bash')
    expect(hasAllowAlwaysRule('telegram', 'Bash')).toBe(false)
  })

  test('returns false for unknown tool', () => {
    addAllowAlwaysRule('mcp-client', 'Bash')
    expect(hasAllowAlwaysRule('mcp-client', 'Write')).toBe(false)
  })

  test('returns true for existing rule', () => {
    addAllowAlwaysRule('mcp-client', 'Bash')
    expect(hasAllowAlwaysRule('mcp-client', 'Bash')).toBe(true)
  })
})

// ── resolvePolicy ──────────────────────────────────────────────────

describe('resolvePolicy', () => {
  test('yu gets permissive policy', () => {
    const policy = resolvePolicy('yu')
    // Empty means no restrictions
    expect(policy.ownerOnly).toBeUndefined()
    expect(policy.dangerous).toBeUndefined()
  })

  test('love-self gets permissive policy', () => {
    const policy = resolvePolicy('love-self')
    expect(policy.ownerOnly).toBeUndefined()
    expect(policy.dangerous).toBeUndefined()
  })

  test('unknown sender gets DEFAULT_POLICY', () => {
    const policy = resolvePolicy('unknown-sender')
    expect(policy.ownerOnly).toEqual(DEFAULT_POLICY.ownerOnly)
    expect(policy.dangerous).toEqual(DEFAULT_POLICY.dangerous)
  })

  test('local override replaces base arrays', () => {
    writeLocalOverrides({
      'mcp-client': { ownerOnly: ['Bash'] },
    })

    const policy = resolvePolicy('mcp-client')
    // ownerOnly is replaced, not merged
    expect(policy.ownerOnly).toEqual(['Bash'])
    // dangerous stays from default (not overridden)
    expect(policy.dangerous).toEqual(DEFAULT_POLICY.dangerous)
  })

  test('local override can add allow list', () => {
    writeLocalOverrides({
      'mcp-client': { allow: ['Read', 'Glob'] },
    })

    const policy = resolvePolicy('mcp-client')
    expect(policy.allow).toEqual(['Read', 'Glob'])
    // Base ownerOnly still present
    expect(policy.ownerOnly).toEqual(DEFAULT_POLICY.ownerOnly)
  })

  test('local override can add deny list', () => {
    writeLocalOverrides({
      telegram: { deny: ['Bash', 'Write', 'Agent'] },
    })

    const policy = resolvePolicy('telegram')
    expect(policy.deny).toEqual(['Bash', 'Write', 'Agent'])
  })

  test('sender with no local override gets base policy', () => {
    writeLocalOverrides({
      'mcp-client': { allow: ['Read'] },
    })

    // Different sender — no override
    const policy = resolvePolicy('telegram')
    expect(policy.ownerOnly).toEqual(DEFAULT_POLICY.ownerOnly)
    expect(policy.allow).toBeUndefined()
  })
})
