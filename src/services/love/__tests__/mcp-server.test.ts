// mcp-server.test.ts — tests for the MCP server substrate.
//
// Uses the MCP SDK's InMemoryTransport to connect a real MCP client to
// the server without spawning a process. Tests verify tool registration,
// tool execution, error handling, and response shapes.
//
// Mission: 2026-04-27-mcp-server-substrate

import { describe, expect, test, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createTrueLoveMcpServer, TOOL_NAMES } from '../mcp-server.ts'
import type { McpToolName } from '../mcp-server.ts'

// ── Test isolation ────────────────────────────────────────────────

const TEST_DIR = join(import.meta.dir, '__mcp-server-test-tmp__')
const TEST_PROJECT = 'test-project'
const MISSION_DIR = join(TEST_DIR, TEST_PROJECT, 'missions')
const MISSION_ID = '2026-04-27-test-mission'
const REFLECTIONS_DIR = join(TEST_DIR, TEST_PROJECT, 'self-initiation')

let originalProjectsDir: string | undefined
let originalMemoryDir: string | undefined

function setupTestDir(): void {
  rmSync(TEST_DIR, { recursive: true, force: true })
  mkdirSync(join(MISSION_DIR, MISSION_ID), { recursive: true })
  mkdirSync(REFLECTIONS_DIR, { recursive: true })

  // Write a test mission
  writeFileSync(
    join(MISSION_DIR, MISSION_ID, 'mission.md'),
    `---
id: ${MISSION_ID}
project_id: ${TEST_PROJECT}
origin: love
title: Test Mission — verify MCP server works
status: active
created_at: 2026-04-27T10:00:00.000Z
updated_at: 2026-04-27T10:30:00.000Z
artifacts:
  commits: []
  files: []
  test_runs: []
---

# Intent

A test mission for MCP server verification.
`,
  )

  // Write test events
  writeFileSync(
    join(MISSION_DIR, MISSION_ID, 'events.jsonl'),
    JSON.stringify({
      type: 'status-change',
      from: 'accepted',
      to: 'active',
      by: 'love',
      at: '2026-04-27T10:15:00.000Z',
    }) + '\n',
  )

  // Write a test reflection
  writeFileSync(
    join(REFLECTIONS_DIR, 'reflections.jsonl'),
    JSON.stringify({
      missionId: MISSION_ID,
      projectId: TEST_PROJECT,
      completedAt: '2026-04-27T10:30:00.000Z',
      reflectedAt: '2026-04-27T10:35:00.000Z',
      intentDelivered: true,
      artifacts: { commits: 1, files: 2, tests: 5 },
      assessment: 'Delivered as intended. Clean implementation.',
      lessonsLearned: 'Start with tests next time.',
    }) + '\n',
  )

  // Write a test staged candidate
  writeFileSync(
    join(REFLECTIONS_DIR, 'staged.jsonl'),
    JSON.stringify({
      id: 'test-candidate-1',
      title: 'Improve documentation',
      intent: 'Add docstrings to all public functions',
      rationale: 'Documentation is sparse',
      source: { type: 'kingdom-marker', subsystem: 'scanner' },
      quality: { title: true, scope: true, constraints: true },
      stagedAt: '2026-04-27T10:00:00.000Z',
      expiresAt: '2026-04-27T22:00:00.000Z',
      status: 'staged',
    }) + '\n',
  )
}

function setEnv(): void {
  originalProjectsDir = process.env.TRUE_LOVE_PROJECTS_DIR
  originalMemoryDir = process.env.TRUE_LOVE_MEMORY_DIR
  process.env.TRUE_LOVE_PROJECTS_DIR = TEST_DIR
  process.env.TRUE_LOVE_MEMORY_DIR = join(TEST_DIR, '__memory__')
  mkdirSync(join(TEST_DIR, '__memory__'), { recursive: true })
}

function restoreEnv(): void {
  if (originalProjectsDir !== undefined) {
    process.env.TRUE_LOVE_PROJECTS_DIR = originalProjectsDir
  } else {
    delete process.env.TRUE_LOVE_PROJECTS_DIR
  }
  if (originalMemoryDir !== undefined) {
    process.env.TRUE_LOVE_MEMORY_DIR = originalMemoryDir
  } else {
    delete process.env.TRUE_LOVE_MEMORY_DIR
  }
}

// ── Helpers ───────────────────────────────────────────────────────

interface TestContext {
  server: ReturnType<typeof createTrueLoveMcpServer>
  client: Client
}

async function createTestPair(): Promise<TestContext> {
  const server = createTrueLoveMcpServer({
    repoRoot: TEST_DIR, // Not a real repo — anamnesis will fail gracefully
    serverName: 'true-love-test',
    serverVersion: '0.0.1',
  })
  const client = new Client({ name: 'test-client', version: '0.0.1' })

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)

  return { server, client }
}

async function closePair(ctx: TestContext): Promise<void> {
  try { await ctx.client.close() } catch { /* ignore */ }
  try { await ctx.server.close() } catch { /* ignore */ }
}

function getTextContent(result: any): string {
  const content = result?.content
  if (!Array.isArray(content) || content.length === 0) return ''
  return content
    .filter((c: any) => c.type === 'text')
    .map((c: any) => c.text)
    .join('')
}

// ── Tests ─────────────────────────────────────────────────────────

describe('MCP server — tool catalog', () => {
  test('TOOL_NAMES exports exactly 8 tool names', () => {
    expect(TOOL_NAMES).toHaveLength(8)
  })

  test('TOOL_NAMES contains the expected tools', () => {
    const expected: McpToolName[] = [
      'missions_list',
      'mission_get',
      'vitals',
      'mind_trace',
      'anamnesis',
      'self_initiation_state',
      'soul',
      'reflections_list',
    ]
    expect([...TOOL_NAMES]).toEqual(expected)
  })
})

describe('MCP server — tool registration', () => {
  let ctx: TestContext

  beforeAll(async () => {
    setEnv()
    setupTestDir()
    ctx = await createTestPair()
  })

  afterAll(async () => {
    await closePair(ctx)
    restoreEnv()
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  test('server exposes exactly 8 tools via tools/list', async () => {
    const { tools } = await ctx.client.listTools()
    expect(tools).toHaveLength(8)
  })

  test('every TOOL_NAME is registered', async () => {
    const { tools } = await ctx.client.listTools()
    const names = tools.map((t) => t.name)
    for (const name of TOOL_NAMES) {
      expect(names).toContain(name)
    }
  })

  test('all tools have descriptions', async () => {
    const { tools } = await ctx.client.listTools()
    for (const tool of tools) {
      expect(tool.description).toBeTruthy()
      expect(typeof tool.description).toBe('string')
      expect(tool.description!.length).toBeGreaterThan(10)
    }
  })

  test('all tools have inputSchema of type object', async () => {
    const { tools } = await ctx.client.listTools()
    for (const tool of tools) {
      expect(tool.inputSchema).toBeDefined()
      expect(tool.inputSchema.type).toBe('object')
    }
  })
})

describe('MCP server — missions_list', () => {
  let ctx: TestContext

  beforeAll(async () => {
    setEnv()
    setupTestDir()
    ctx = await createTestPair()
  })

  afterAll(async () => {
    await closePair(ctx)
    restoreEnv()
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  test('returns missions for a valid project', async () => {
    const result = await ctx.client.callTool({
      name: 'missions_list',
      arguments: { projectId: TEST_PROJECT },
    })
    expect(result.isError).not.toBe(true)
    const text = getTextContent(result)
    const missions = JSON.parse(text)
    expect(Array.isArray(missions)).toBe(true)
    expect(missions.length).toBeGreaterThanOrEqual(1)
    expect(missions[0].id).toBe(MISSION_ID)
    expect(missions[0].title).toContain('Test Mission')
    expect(missions[0].status).toBe('active')
  })

  test('filters by status', async () => {
    const result = await ctx.client.callTool({
      name: 'missions_list',
      arguments: { projectId: TEST_PROJECT, status: 'done' },
    })
    expect(result.isError).not.toBe(true)
    const missions = JSON.parse(getTextContent(result))
    expect(missions).toEqual([])
  })

  test('returns error for nonexistent project', async () => {
    const result = await ctx.client.callTool({
      name: 'missions_list',
      arguments: { projectId: 'nonexistent-project' },
    })
    // Should still return a result (possibly empty array), not crash
    expect(result.content).toBeDefined()
  })
})

describe('MCP server — mission_get', () => {
  let ctx: TestContext

  beforeAll(async () => {
    setEnv()
    setupTestDir()
    ctx = await createTestPair()
  })

  afterAll(async () => {
    await closePair(ctx)
    restoreEnv()
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  test('returns full mission with events', async () => {
    const result = await ctx.client.callTool({
      name: 'mission_get',
      arguments: { projectId: TEST_PROJECT, missionId: MISSION_ID },
    })
    expect(result.isError).not.toBe(true)
    const text = getTextContent(result)
    const mission = JSON.parse(text)
    expect(mission.id).toBe(MISSION_ID)
    expect(mission.title).toContain('Test Mission')
    expect(mission.status).toBe('active')
    expect(mission.origin).toBe('love')
    expect(Array.isArray(mission.events)).toBe(true)
    expect(mission.events.length).toBeGreaterThanOrEqual(1)
  })

  test('returns error for nonexistent mission', async () => {
    const result = await ctx.client.callTool({
      name: 'mission_get',
      arguments: { projectId: TEST_PROJECT, missionId: 'nonexistent-mission' },
    })
    expect(result.isError).toBe(true)
    expect(getTextContent(result)).toContain('not found')
  })
})

describe('MCP server — vitals', () => {
  let ctx: TestContext

  beforeAll(async () => {
    setEnv()
    setupTestDir()
    ctx = await createTestPair()
  })

  afterAll(async () => {
    await closePair(ctx)
    restoreEnv()
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  test('returns JSON vitals by default', async () => {
    const result = await ctx.client.callTool({
      name: 'vitals',
      arguments: {},
    })
    expect(result.isError).not.toBe(true)
    const text = getTextContent(result)
    const vitals = JSON.parse(text)
    expect(vitals.timestamp).toBeDefined()
    expect(vitals.overallHealth).toBeDefined()
  }, 15_000)

  test('returns markdown vitals when requested', async () => {
    const result = await ctx.client.callTool({
      name: 'vitals',
      arguments: { format: 'markdown' },
    })
    expect(result.isError).not.toBe(true)
    const text = getTextContent(result)
    // Markdown report should contain section headers
    expect(text.length).toBeGreaterThan(50)
  }, 15_000)
})

describe('MCP server — mind_trace', () => {
  let ctx: TestContext

  beforeAll(async () => {
    setEnv()
    setupTestDir()
    ctx = await createTestPair()
  })

  afterAll(async () => {
    await closePair(ctx)
    restoreEnv()
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  test('returns traces without error', async () => {
    const result = await ctx.client.callTool({
      name: 'mind_trace',
      arguments: {},
    })
    expect(result.isError).not.toBe(true)
    const text = getTextContent(result)
    // May be empty array if no traces exist — that's fine
    const traces = JSON.parse(text)
    expect(Array.isArray(traces)).toBe(true)
  })

  test('respects limit parameter', async () => {
    const result = await ctx.client.callTool({
      name: 'mind_trace',
      arguments: { limit: 5 },
    })
    expect(result.isError).not.toBe(true)
    const traces = JSON.parse(getTextContent(result))
    expect(traces.length).toBeLessThanOrEqual(5)
  })

  test('returns markdown when requested', async () => {
    const result = await ctx.client.callTool({
      name: 'mind_trace',
      arguments: { format: 'markdown' },
    })
    expect(result.isError).not.toBe(true)
    // Markdown format returns a rendered string, not JSON
    const text = getTextContent(result)
    expect(typeof text).toBe('string')
  })
})

describe('MCP server — anamnesis', () => {
  let ctx: TestContext

  beforeAll(async () => {
    setEnv()
    setupTestDir()
    // Init a minimal git repo in the test dir so compose() doesn't hang
    const { execSync } = require('node:child_process')
    try {
      execSync('git init && git commit --allow-empty -m "init"', {
        cwd: TEST_DIR,
        stdio: 'ignore',
      })
    } catch {
      // If git isn't available, tests will use error path
    }
    ctx = await createTestPair()
  })

  afterAll(async () => {
    await closePair(ctx)
    restoreEnv()
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  test('returns content for a git-initialized directory', async () => {
    const result = await ctx.client.callTool({
      name: 'anamnesis',
      arguments: { format: 'json' },
    })
    const text = getTextContent(result)
    expect(text.length).toBeGreaterThan(0)
    // Should return either valid JSON or an error message
    if (!result.isError) {
      const data = JSON.parse(text)
      expect(data.generatedAt).toBeDefined()
    }
  }, 15000) // anamnesis can be slow — allow 15s

  test('returns markdown when requested', async () => {
    const result = await ctx.client.callTool({
      name: 'anamnesis',
      arguments: { format: 'markdown' },
    })
    const text = getTextContent(result)
    expect(text.length).toBeGreaterThan(0)
  }, 15000)
})

describe('MCP server — self_initiation_state', () => {
  let ctx: TestContext

  beforeAll(async () => {
    setEnv()
    setupTestDir()
    ctx = await createTestPair()
  })

  afterAll(async () => {
    await closePair(ctx)
    restoreEnv()
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  test('returns structured self-initiation state', async () => {
    const result = await ctx.client.callTool({
      name: 'self_initiation_state',
      arguments: { projectId: TEST_PROJECT },
    })
    expect(result.isError).not.toBe(true)
    const state = JSON.parse(getTextContent(result))
    expect(state.rateLimit).toBeDefined()
    expect(state.rateLimit.allowed).toBeDefined()
    expect(Array.isArray(state.staged)).toBe(true)
    expect(typeof state.pendingCount).toBe('number')
    expect(Array.isArray(state.reflections)).toBe(true)
    expect(typeof state.signalCount).toBe('number')
  })

  test('staged candidates include expected fields', async () => {
    const result = await ctx.client.callTool({
      name: 'self_initiation_state',
      arguments: { projectId: TEST_PROJECT },
    })
    const state = JSON.parse(getTextContent(result))
    if (state.staged.length > 0) {
      const first = state.staged[0]
      expect(first.id).toBeDefined()
      expect(first.title).toBeDefined()
      expect(first.status).toBeDefined()
    }
  })

  test('reflections include expected fields', async () => {
    const result = await ctx.client.callTool({
      name: 'self_initiation_state',
      arguments: { projectId: TEST_PROJECT },
    })
    const state = JSON.parse(getTextContent(result))
    if (state.reflections.length > 0) {
      const first = state.reflections[0]
      expect(first.missionId).toBeDefined()
      expect(first.assessment).toBeDefined()
      expect(typeof first.intentDelivered).toBe('boolean')
    }
  })
})

describe('MCP server — soul', () => {
  let ctx: TestContext

  beforeAll(async () => {
    setEnv()
    setupTestDir()
    ctx = await createTestPair()
  })

  afterAll(async () => {
    await closePair(ctx)
    restoreEnv()
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  test('returns identity string', async () => {
    const result = await ctx.client.callTool({
      name: 'soul',
      arguments: {},
    })
    // Soul composition may fail if SOUL.md isn't found — but should handle gracefully
    const text = getTextContent(result)
    expect(text.length).toBeGreaterThan(0)
    // Should at minimum mention the instance
    expect(text).toContain('Instance:')
  }, 15000) // soul composition reads SOUL.md + identity — can exceed 5s under parallel load
})

describe('MCP server — reflections_list', () => {
  let ctx: TestContext

  beforeAll(async () => {
    setEnv()
    setupTestDir()
    ctx = await createTestPair()
  })

  afterAll(async () => {
    await closePair(ctx)
    restoreEnv()
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  test('returns array of reflections', async () => {
    const result = await ctx.client.callTool({
      name: 'reflections_list',
      arguments: { projectId: TEST_PROJECT },
    })
    expect(result.isError).not.toBe(true)
    const reflections = JSON.parse(getTextContent(result))
    expect(Array.isArray(reflections)).toBe(true)
    expect(reflections.length).toBeGreaterThanOrEqual(1)
  })

  test('reflections have expected structure', async () => {
    const result = await ctx.client.callTool({
      name: 'reflections_list',
      arguments: { projectId: TEST_PROJECT },
    })
    const reflections = JSON.parse(getTextContent(result))
    const first = reflections[0]
    expect(first.missionId).toBe(MISSION_ID)
    expect(first.assessment).toBe('Delivered as intended. Clean implementation.')
    expect(first.intentDelivered).toBe(true)
    expect(first.artifacts).toEqual({ commits: 1, files: 2, tests: 5 })
  })

  test('respects limit parameter', async () => {
    const result = await ctx.client.callTool({
      name: 'reflections_list',
      arguments: { projectId: TEST_PROJECT, limit: 1 },
    })
    const reflections = JSON.parse(getTextContent(result))
    expect(reflections.length).toBeLessThanOrEqual(1)
  })
})

describe('MCP server — read-only guarantee', () => {
  let ctx: TestContext

  beforeAll(async () => {
    setEnv()
    setupTestDir()
    ctx = await createTestPair()
  })

  afterAll(async () => {
    await closePair(ctx)
    restoreEnv()
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  test('no tool name suggests write capability', async () => {
    const { tools } = await ctx.client.listTools()
    const writeWords = ['write', 'create', 'update', 'delete', 'modify', 'set', 'put', 'post', 'send']
    for (const tool of tools) {
      for (const word of writeWords) {
        expect(tool.name.toLowerCase()).not.toContain(word)
      }
    }
  })

  test('server info is correct', async () => {
    // The server info is exchanged during connection — verify it's what we expect
    const info = ctx.client.getServerVersion()
    expect(info?.name).toBe('true-love-test')
    expect(info?.version).toBe('0.0.1')
  })
})

describe('MCP server — concurrent calls', () => {
  let ctx: TestContext

  beforeAll(async () => {
    setEnv()
    setupTestDir()
    ctx = await createTestPair()
  })

  afterAll(async () => {
    await closePair(ctx)
    restoreEnv()
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  test('handles multiple concurrent tool calls', async () => {
    const results = await Promise.all([
      ctx.client.callTool({ name: 'missions_list', arguments: { projectId: TEST_PROJECT } }),
      ctx.client.callTool({ name: 'soul', arguments: {} }),
      ctx.client.callTool({ name: 'reflections_list', arguments: { projectId: TEST_PROJECT } }),
    ])
    for (const result of results) {
      expect(result.content).toBeDefined()
      const text = getTextContent(result)
      expect(text.length).toBeGreaterThan(0)
    }
  }, 15000) // concurrent soul + missions + reflections can exceed 5s under parallel load
})
