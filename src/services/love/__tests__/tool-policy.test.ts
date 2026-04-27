// __tests__/tool-policy.test.ts — Tests for the auth/tool-policy subsystem.
//
// Covers:
//   1. Tool groups expansion
//   2. Sender resolution from channels
//   3. Policy filtering (allow/deny/ownerOnly/dangerous)
//   4. Full-trust bypass for yu and love-self
//   5. Default policy behavior
//   6. Local overrides (allow-always rules)
//   7. Exec-approval creation and response handling

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ── Module imports ───────────────────────────────────────────────────

import {
  TOOL_GROUPS,
  normalizeToolName,
  expandGroups,
  checkToolAccess,
  filterToolsForSender,
  isDangerous,
  getDangerousToolsForSender,
  resolveSender,
  type Sender,
  type ToolPolicy,
} from '../auth/tool-policy.js'

import {
  DEFAULT_POLICY,
  resolvePolicy,
  readLocalOverrides,
  writeLocalOverrides,
  addAllowAlwaysRule,
  hasAllowAlwaysRule,
} from '../auth/default-policy.js'

import {
  requestExecApproval,
  processExecApprovalResponse,
  listPendingApprovals,
  hasPendingApproval,
  resolveToolApprovals,
} from '../auth/exec-approval.js'

// ── Test fixtures ────────────────────────────────────────────────────

const ALL_TOOLS = [
  'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch',
  'Edit', 'Write', 'NotebookEdit',
  'Bash', 'Agent', 'TodoWrite', 'AskUserQuestion',
]

const SIMPLE_POLICY: ToolPolicy = {
  ownerOnly: ['Bash', 'Edit', 'Write'],
  dangerous: ['Bash'],
}

// Temp directory for local override tests.
let testHome: string

beforeEach(() => {
  testHome = join(tmpdir(), `tool-policy-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(join(testHome, '.true-love'), { recursive: true })
  process.env.TRUE_LOVE_HOME = testHome
})

afterEach(() => {
  delete process.env.TRUE_LOVE_HOME
  try {
    rmSync(testHome, { recursive: true, force: true })
  } catch { /* cleanup best-effort */ }
})

// ═══════════════════════════════════════════════════════════════════
// 1. TOOL GROUPS
// ═══════════════════════════════════════════════════════════════════

describe('tool groups', () => {
  test('group:read contains read-only tools', () => {
    const group = TOOL_GROUPS['group:read']
    expect(group).toBeDefined()
    expect(group).toContain('Read')
    expect(group).toContain('Glob')
    expect(group).toContain('Grep')
    expect(group).not.toContain('Bash')
    expect(group).not.toContain('Write')
  })

  test('group:write contains mutation tools', () => {
    const group = TOOL_GROUPS['group:write']
    expect(group).toBeDefined()
    expect(group).toContain('Edit')
    expect(group).toContain('Write')
    expect(group).not.toContain('Read')
    expect(group).not.toContain('Bash')
  })

  test('group:exec contains Bash', () => {
    const group = TOOL_GROUPS['group:exec']
    expect(group).toContain('Bash')
  })

  test('group:dangerous includes world-changing tools', () => {
    const group = TOOL_GROUPS['group:dangerous']
    expect(group).toContain('Bash')
    expect(group).toContain('Write')
    expect(group).toContain('Edit')
    expect(group).not.toContain('Read')
  })

  test('expandGroups expands group references', () => {
    const expanded = expandGroups(['group:read', 'Bash'])
    expect(expanded).toContain('Read')
    expect(expanded).toContain('Glob')
    expect(expanded).toContain('Grep')
    expect(expanded).toContain('Bash')
  })

  test('expandGroups deduplicates', () => {
    const expanded = expandGroups(['Read', 'group:read'])
    const readCount = expanded.filter(t => t === 'Read').length
    expect(readCount).toBe(1)
  })

  test('expandGroups returns empty for undefined', () => {
    expect(expandGroups(undefined)).toEqual([])
  })

  test('expandGroups returns empty for empty array', () => {
    expect(expandGroups([])).toEqual([])
  })

  test('expandGroups passes through non-group names', () => {
    const expanded = expandGroups(['CustomTool', 'Read'])
    expect(expanded).toContain('CustomTool')
    expect(expanded).toContain('Read')
  })
})

// ═══════════════════════════════════════════════════════════════════
// 2. SENDER RESOLUTION
// ═══════════════════════════════════════════════════════════════════

describe('sender resolution', () => {
  test('visit channel resolves to yu', () => {
    expect(resolveSender('visit')).toBe('yu')
  })

  test('autonomy channel resolves to love-self', () => {
    expect(resolveSender('autonomy')).toBe('love-self')
    expect(resolveSender('self')).toBe('love-self')
  })

  test('mcp channel resolves to mcp-client', () => {
    expect(resolveSender('mcp')).toBe('mcp-client')
    expect(resolveSender('mcp-client')).toBe('mcp-client')
  })

  test('telegram with verified yu resolves to yu', () => {
    expect(resolveSender('telegram', 'yu')).toBe('yu')
  })

  test('telegram without verification resolves to telegram', () => {
    expect(resolveSender('telegram')).toBe('telegram')
    expect(resolveSender('telegram', 'stranger')).toBe('telegram')
  })

  test('unknown channel resolves to channel-other', () => {
    expect(resolveSender('whatsapp')).toBe('channel-other')
    expect(resolveSender('discord')).toBe('channel-other')
    expect(resolveSender('')).toBe('channel-other')
  })
})

// ═══════════════════════════════════════════════════════════════════
// 3. TOOL ACCESS CHECKS
// ═══════════════════════════════════════════════════════════════════

describe('checkToolAccess', () => {
  test('yu gets full access to everything', () => {
    const result = checkToolAccess('Bash', 'yu', SIMPLE_POLICY)
    expect(result.allowed).toBe(true)
    expect(result.requiresApproval).toBe(false)
  })

  test('love-self gets full access to everything', () => {
    const result = checkToolAccess('Bash', 'love-self', SIMPLE_POLICY)
    expect(result.allowed).toBe(true)
    expect(result.requiresApproval).toBe(false)
  })

  test('mcp-client blocked from ownerOnly tools', () => {
    const result = checkToolAccess('Bash', 'mcp-client', SIMPLE_POLICY)
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('owner-only tool')
  })

  test('mcp-client allowed read-only tools', () => {
    const result = checkToolAccess('Read', 'mcp-client', SIMPLE_POLICY)
    expect(result.allowed).toBe(true)
    expect(result.requiresApproval).toBe(false)
  })

  test('deny list takes absolute precedence', () => {
    const policy: ToolPolicy = { deny: ['Read'], ownerOnly: [] }
    const result = checkToolAccess('Read', 'mcp-client', policy)
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('denied by policy')
  })

  test('allow list restricts to named tools', () => {
    const policy: ToolPolicy = { allow: ['Read', 'Glob'] }
    const result = checkToolAccess('Bash', 'mcp-client', policy)
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('not in allow list')
  })

  test('allow list permits named tools', () => {
    const policy: ToolPolicy = { allow: ['Read', 'Glob'] }
    const result = checkToolAccess('Read', 'mcp-client', policy)
    expect(result.allowed).toBe(true)
  })

  test('dangerous tools are allowed but flagged', () => {
    const policy: ToolPolicy = { dangerous: ['Bash'] }
    const result = checkToolAccess('Bash', 'mcp-client', policy)
    expect(result.allowed).toBe(true)
    expect(result.requiresApproval).toBe(true)
  })

  test('ownerOnly takes precedence over dangerous', () => {
    // If a tool is both ownerOnly and dangerous, ownerOnly blocks it
    // for non-owners (dangerous is irrelevant if you can't use it).
    const result = checkToolAccess('Bash', 'mcp-client', SIMPLE_POLICY)
    expect(result.allowed).toBe(false)
  })

  test('deny with group reference', () => {
    const policy: ToolPolicy = { deny: ['group:exec'] }
    const result = checkToolAccess('Bash', 'mcp-client', policy)
    expect(result.allowed).toBe(false)
  })

  test('ownerOnly with group reference', () => {
    const policy: ToolPolicy = { ownerOnly: ['group:write'] }
    const result = checkToolAccess('Edit', 'telegram', policy)
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('owner-only tool')
  })

  test('empty policy allows everything for non-owner', () => {
    const policy: ToolPolicy = {}
    const result = checkToolAccess('Bash', 'mcp-client', policy)
    expect(result.allowed).toBe(true)
    expect(result.requiresApproval).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════
// 4. FILTER TOOLS FOR SENDER
// ═══════════════════════════════════════════════════════════════════

describe('filterToolsForSender', () => {
  test('yu gets all tools', () => {
    const filtered = filterToolsForSender(ALL_TOOLS, 'yu', SIMPLE_POLICY)
    expect(filtered).toEqual(ALL_TOOLS)
  })

  test('love-self gets all tools', () => {
    const filtered = filterToolsForSender(ALL_TOOLS, 'love-self', SIMPLE_POLICY)
    expect(filtered).toEqual(ALL_TOOLS)
  })

  test('mcp-client gets only non-ownerOnly tools', () => {
    const filtered = filterToolsForSender(ALL_TOOLS, 'mcp-client', SIMPLE_POLICY)
    expect(filtered).not.toContain('Bash')
    expect(filtered).not.toContain('Edit')
    expect(filtered).not.toContain('Write')
    expect(filtered).toContain('Read')
    expect(filtered).toContain('Glob')
    expect(filtered).toContain('Grep')
  })

  test('default policy filters ownerOnly for external sender', () => {
    const filtered = filterToolsForSender(ALL_TOOLS, 'mcp-client', DEFAULT_POLICY)
    expect(filtered).not.toContain('Bash')
    expect(filtered).not.toContain('Edit')
    expect(filtered).not.toContain('Write')
    expect(filtered).not.toContain('NotebookEdit')
    expect(filtered).not.toContain('Agent')
    expect(filtered).toContain('Read')
    expect(filtered).toContain('Glob')
  })

  test('empty tools returns empty', () => {
    const filtered = filterToolsForSender([], 'mcp-client', SIMPLE_POLICY)
    expect(filtered).toEqual([])
  })
})

// ═══════════════════════════════════════════════════════════════════
// 5. isDangerous
// ═══════════════════════════════════════════════════════════════════

describe('isDangerous', () => {
  test('returns false for yu regardless of policy', () => {
    expect(isDangerous('Bash', 'yu', SIMPLE_POLICY)).toBe(false)
  })

  test('returns false for love-self regardless of policy', () => {
    expect(isDangerous('Bash', 'love-self', SIMPLE_POLICY)).toBe(false)
  })

  test('returns true for dangerous tool + external sender', () => {
    // Note: Bash is ownerOnly in SIMPLE_POLICY, so checkToolAccess
    // blocks it before checking dangerous. Use a policy where Bash
    // is dangerous but not ownerOnly.
    const policy: ToolPolicy = { dangerous: ['Bash'] }
    expect(isDangerous('Bash', 'mcp-client', policy)).toBe(true)
  })

  test('returns false for non-dangerous tool', () => {
    const policy: ToolPolicy = { dangerous: ['Bash'] }
    expect(isDangerous('Read', 'mcp-client', policy)).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════
// 6. getDangerousToolsForSender
// ═══════════════════════════════════════════════════════════════════

describe('getDangerousToolsForSender', () => {
  test('returns empty for yu', () => {
    const policy: ToolPolicy = { dangerous: ['Bash'] }
    expect(getDangerousToolsForSender(ALL_TOOLS, 'yu', policy)).toEqual([])
  })

  test('returns dangerous tools for external sender', () => {
    const policy: ToolPolicy = { dangerous: ['Bash', 'Write'] }
    const result = getDangerousToolsForSender(ALL_TOOLS, 'mcp-client', policy)
    expect(result).toContain('Bash')
    expect(result).toContain('Write')
    expect(result).not.toContain('Read')
  })
})

// ═══════════════════════════════════════════════════════════════════
// 7. DEFAULT POLICY
// ═══════════════════════════════════════════════════════════════════

describe('default policy', () => {
  test('has ownerOnly tools defined', () => {
    expect(DEFAULT_POLICY.ownerOnly).toBeDefined()
    expect(DEFAULT_POLICY.ownerOnly!.length).toBeGreaterThan(0)
    expect(DEFAULT_POLICY.ownerOnly).toContain('Bash')
    expect(DEFAULT_POLICY.ownerOnly).toContain('Edit')
    expect(DEFAULT_POLICY.ownerOnly).toContain('Write')
  })

  test('has dangerous tools defined', () => {
    expect(DEFAULT_POLICY.dangerous).toBeDefined()
    expect(DEFAULT_POLICY.dangerous).toContain('Bash')
    expect(DEFAULT_POLICY.dangerous).toContain('Write')
  })

  test('no explicit allow/deny — everything not ownerOnly is open', () => {
    expect(DEFAULT_POLICY.allow).toBeUndefined()
    expect(DEFAULT_POLICY.deny).toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════════════════════
// 8. POLICY RESOLUTION
// ═══════════════════════════════════════════════════════════════════

describe('resolvePolicy', () => {
  test('yu gets empty policy (no restrictions)', () => {
    const policy = resolvePolicy('yu')
    expect(policy.ownerOnly).toBeUndefined()
    expect(policy.dangerous).toBeUndefined()
  })

  test('love-self gets empty policy', () => {
    const policy = resolvePolicy('love-self')
    expect(policy.ownerOnly).toBeUndefined()
  })

  test('mcp-client gets default policy when no overrides', () => {
    const policy = resolvePolicy('mcp-client')
    expect(policy.ownerOnly).toEqual(DEFAULT_POLICY.ownerOnly)
    expect(policy.dangerous).toEqual(DEFAULT_POLICY.dangerous)
  })

  test('local overrides replace default arrays', () => {
    writeLocalOverrides({
      'mcp-client': { allow: ['Read', 'Bash'], dangerous: ['Bash'] },
    })
    const policy = resolvePolicy('mcp-client')
    expect(policy.allow).toEqual(['Read', 'Bash'])
    expect(policy.dangerous).toEqual(['Bash'])
    // ownerOnly should still come from default (no override).
    expect(policy.ownerOnly).toEqual(DEFAULT_POLICY.ownerOnly)
  })
})

// ═══════════════════════════════════════════════════════════════════
// 9. LOCAL OVERRIDES
// ═══════════════════════════════════════════════════════════════════

describe('local overrides', () => {
  test('read returns empty when no file exists', () => {
    const overrides = readLocalOverrides()
    expect(overrides).toEqual({})
  })

  test('write and read round-trips', () => {
    const data = { 'mcp-client': { allow: ['Read', 'Bash'] } }
    writeLocalOverrides(data)
    const read = readLocalOverrides()
    expect(read).toEqual(data)
  })

  test('addAllowAlwaysRule creates and persists rule', () => {
    addAllowAlwaysRule('mcp-client', 'Bash')
    expect(hasAllowAlwaysRule('mcp-client', 'Bash')).toBe(true)
    expect(hasAllowAlwaysRule('mcp-client', 'Write')).toBe(false)
  })

  test('addAllowAlwaysRule is idempotent', () => {
    addAllowAlwaysRule('mcp-client', 'Bash')
    addAllowAlwaysRule('mcp-client', 'Bash')
    const overrides = readLocalOverrides()
    const count = overrides['mcp-client']!.allow!.filter(t => t === 'Bash').length
    expect(count).toBe(1)
  })

  test('hasAllowAlwaysRule returns false for unknown sender', () => {
    expect(hasAllowAlwaysRule('telegram', 'Bash')).toBe(false)
  })

  test('readLocalOverrides handles malformed JSON', () => {
    const path = join(testHome, '.true-love', 'tool-policy.local.json')
    writeFileSync(path, 'not json at all', 'utf-8')
    expect(readLocalOverrides()).toEqual({})
  })
})

// ═══════════════════════════════════════════════════════════════════
// 10. EXEC APPROVAL
// ═══════════════════════════════════════════════════════════════════

describe('exec approval', () => {
  // Exec approval uses decisions.ts which reads from a project directory.
  // We need to set up the project dir.
  let projectDir: string

  beforeEach(() => {
    projectDir = join(testHome, '.true-love', 'projects', 'test-project')
    mkdirSync(projectDir, { recursive: true })
    process.env.TRUE_LOVE_PROJECTS_DIR = join(testHome, '.true-love', 'projects')
  })

  afterEach(() => {
    delete process.env.TRUE_LOVE_PROJECTS_DIR
  })

  test('requestExecApproval creates a decision record', () => {
    const result = requestExecApproval('test-project', {
      toolName: 'Bash',
      sender: 'mcp-client',
      channelId: 'mcp',
    })
    expect(result).not.toBeNull()
    expect(result!.toolName).toBe('Bash')
    expect(result!.sender).toBe('mcp-client')
    expect(result!.decision.status).toBe('pending')
    expect(result!.decision.ask).toContain('Exec approval')
    expect(result!.decision.ask).toContain('Bash')
  })

  test('requestExecApproval returns null when allow-always exists', () => {
    addAllowAlwaysRule('mcp-client', 'Bash')
    const result = requestExecApproval('test-project', {
      toolName: 'Bash',
      sender: 'mcp-client',
      channelId: 'mcp',
    })
    expect(result).toBeNull()
  })

  test('requestExecApproval includes tool args in context', () => {
    const result = requestExecApproval('test-project', {
      toolName: 'Bash',
      sender: 'mcp-client',
      channelId: 'mcp',
      toolArgs: 'rm -rf /important',
    })
    expect(result!.decision.ask).toContain('rm -rf /important')
  })

  test('listPendingApprovals filters to exec-approval decisions', () => {
    requestExecApproval('test-project', {
      toolName: 'Bash',
      sender: 'mcp-client',
      channelId: 'mcp',
    })
    const pending = listPendingApprovals('test-project')
    expect(pending.length).toBe(1)
    expect(pending[0]!.ask).toContain('Exec approval')
  })

  test('hasPendingApproval detects existing requests', () => {
    requestExecApproval('test-project', {
      toolName: 'Bash',
      sender: 'mcp-client',
      channelId: 'mcp',
    })
    expect(hasPendingApproval('test-project', 'Bash', 'mcp-client')).toBe(true)
    expect(hasPendingApproval('test-project', 'Write', 'mcp-client')).toBe(false)
  })

  test('processExecApprovalResponse with allow-once', () => {
    const req = requestExecApproval('test-project', {
      toolName: 'Bash',
      sender: 'mcp-client',
      channelId: 'mcp',
    })
    const result = processExecApprovalResponse(
      'test-project',
      req!.decision.id,
      'allow-once',
      'mcp-client',
      'Bash',
    )
    expect(result).toBe('allow-once')
    // No persistent rule should be created.
    expect(hasAllowAlwaysRule('mcp-client', 'Bash')).toBe(false)
  })

  test('processExecApprovalResponse with allow-always creates persistent rule', () => {
    const req = requestExecApproval('test-project', {
      toolName: 'Bash',
      sender: 'mcp-client',
      channelId: 'mcp',
    })
    const result = processExecApprovalResponse(
      'test-project',
      req!.decision.id,
      'allow-always',
      'mcp-client',
      'Bash',
    )
    expect(result).toBe('allow-always')
    expect(hasAllowAlwaysRule('mcp-client', 'Bash')).toBe(true)
  })

  test('processExecApprovalResponse with deny', () => {
    const req = requestExecApproval('test-project', {
      toolName: 'Bash',
      sender: 'mcp-client',
      channelId: 'mcp',
    })
    const result = processExecApprovalResponse(
      'test-project',
      req!.decision.id,
      'deny',
      'mcp-client',
      'Bash',
    )
    expect(result).toBe('deny')
    expect(hasAllowAlwaysRule('mcp-client', 'Bash')).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════
// 11. RESOLVE TOOL APPROVALS (integration)
// ═══════════════════════════════════════════════════════════════════

describe('resolveToolApprovals', () => {
  beforeEach(() => {
    const projectDir = join(testHome, '.true-love', 'projects', 'test-project')
    mkdirSync(projectDir, { recursive: true })
    process.env.TRUE_LOVE_PROJECTS_DIR = join(testHome, '.true-love', 'projects')
  })

  afterEach(() => {
    delete process.env.TRUE_LOVE_PROJECTS_DIR
  })

  test('all tools approved for non-dangerous policy', () => {
    const policy: ToolPolicy = {}
    const result = resolveToolApprovals(
      'test-project',
      ['Read', 'Glob', 'Bash'],
      'mcp-client',
      'mcp',
      policy,
    )
    expect(result.approved).toEqual(['Read', 'Glob', 'Bash'])
    expect(result.needsApproval).toEqual([])
  })

  test('dangerous tools need approval', () => {
    const policy: ToolPolicy = { dangerous: ['Bash'] }
    const result = resolveToolApprovals(
      'test-project',
      ['Read', 'Bash'],
      'mcp-client',
      'mcp',
      policy,
    )
    expect(result.approved).toEqual(['Read'])
    expect(result.needsApproval).toEqual(['Bash'])
  })

  test('allow-always bypasses approval', () => {
    addAllowAlwaysRule('mcp-client', 'Bash')
    const policy: ToolPolicy = { dangerous: ['Bash'] }
    const result = resolveToolApprovals(
      'test-project',
      ['Read', 'Bash'],
      'mcp-client',
      'mcp',
      policy,
    )
    expect(result.approved).toEqual(['Read', 'Bash'])
    expect(result.needsApproval).toEqual([])
  })

  test('does not create duplicate approval requests', () => {
    const policy: ToolPolicy = { dangerous: ['Bash'] }
    resolveToolApprovals('test-project', ['Bash'], 'mcp-client', 'mcp', policy)
    resolveToolApprovals('test-project', ['Bash'], 'mcp-client', 'mcp', policy)
    const pending = listPendingApprovals('test-project')
    expect(pending.length).toBe(1)
  })
})

// ═══════════════════════════════════════════════════════════════════
// 12. normalizeToolName
// ═══════════════════════════════════════════════════════════════════

describe('normalizeToolName', () => {
  test('trims whitespace', () => {
    expect(normalizeToolName('  Bash  ')).toBe('Bash')
  })

  test('preserves case', () => {
    expect(normalizeToolName('Read')).toBe('Read')
    expect(normalizeToolName('WebFetch')).toBe('WebFetch')
  })
})

// ═══════════════════════════════════════════════════════════════════
// 13. EDGE CASES
// ═══════════════════════════════════════════════════════════════════

describe('edge cases', () => {
  test('policy with both allow and deny — deny wins', () => {
    const policy: ToolPolicy = {
      allow: ['Read', 'Bash'],
      deny: ['Bash'],
    }
    const result = checkToolAccess('Bash', 'mcp-client', policy)
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('denied by policy')
  })

  test('policy with groups in all fields', () => {
    const policy: ToolPolicy = {
      allow: ['group:all'],
      deny: ['group:exec'],
      ownerOnly: ['group:write'],
      dangerous: ['group:dangerous'],
    }
    // Bash: denied by deny list
    expect(checkToolAccess('Bash', 'telegram', policy).allowed).toBe(false)
    // Edit: blocked by ownerOnly
    expect(checkToolAccess('Edit', 'telegram', policy).allowed).toBe(false)
    // Read: allowed (in allow list, not denied, not ownerOnly)
    expect(checkToolAccess('Read', 'telegram', policy).allowed).toBe(true)
  })

  test('channel-other gets same treatment as mcp-client', () => {
    const filtered = filterToolsForSender(ALL_TOOLS, 'channel-other', DEFAULT_POLICY)
    const mcpFiltered = filterToolsForSender(ALL_TOOLS, 'mcp-client', DEFAULT_POLICY)
    expect(filtered).toEqual(mcpFiltered)
  })
})
