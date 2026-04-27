// src/services/love/mcp-server.ts — MCP server for the true-love substrate.
//
// Exposes 8 read-only tools over MCP so other agents can witness Love's
// state without modifying it. No write tools, period. Other agents are
// witnesses, not authors.
//
// Tools:
//   missions_list       — list missions for a project
//   mission_get         — full mission body + events
//   vitals              — current vital signs snapshot
//   mind_trace          — recent decision traces
//   anamnesis           — composed architectural memoir
//   self_initiation_state — rate limit + staged + pending + reflections + signals
//   soul                — current LOVE_IDENTITY string
//   reflections_list    — array of self-initiation reflections
//
// Mission: 2026-04-27-mcp-server-substrate
// See: docs/integrations/mcp.md

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { listMissions, readMission, readEvents } from './mission.ts'
import type { Mission, MissionEvent } from './mission.ts'
import { listProjects } from './project-registry.ts'
import { collectVitalSigns, renderVitalSignsReport } from './vital-signs.ts'
import { loadTraces, renderTraceList, renderTrace } from './mind-trace.ts'
import type { DecisionTrace } from './mind-trace.ts'
import { compose, renderMemoir } from './anamnesis.ts'
import {
  canInitiate,
  getStaged,
  getPendingStaged,
  readReflections,
  scanForSignals,
} from './self-initiation.ts'
import { composeLoveIdentity, resolveLoveInstance } from './identity.ts'

// ── Server factory ────────────────────────────────────────────────
//
// Returns a configured McpServer with all 8 tools registered.
// Caller is responsible for connecting a transport (e.g. StdioServerTransport).

export interface McpServerOptions {
  /** Override the repo root for anamnesis (default: process.cwd()) */
  repoRoot?: string
  /** Name shown to MCP clients (default: "true-love") */
  serverName?: string
  /** Version shown to MCP clients (default: "0.1.0") */
  serverVersion?: string
}

export function createTrueLoveMcpServer(opts: McpServerOptions = {}): McpServer {
  const {
    repoRoot = process.cwd(),
    serverName = 'true-love',
    serverVersion = '0.1.0',
  } = opts

  const server = new McpServer(
    { name: serverName, version: serverVersion },
    { capabilities: { tools: { listChanged: false } } },
  )

  // ── 1. missions_list ──────────────────────────────────────────
  server.registerTool(
    'missions_list',
    {
      title: 'List missions',
      description:
        'List missions for a project. Returns id, title, status, origin, and timestamps.',
      inputSchema: {
        projectId: z.string().describe('Project identifier (e.g. "true-love")'),
        status: z
          .enum(['proposed', 'accepted', 'active', 'review', 'done', 'rejected', 'archived'])
          .optional()
          .describe('Filter by mission status'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId, status }) => {
      try {
        const filterOpts = status ? { status: status as any } : undefined
        const missions = listMissions(projectId, filterOpts)
        const summary = missions.map((m: Mission) => ({
          id: m.id,
          title: m.title,
          status: m.status,
          origin: m.origin,
          created_at: m.created_at,
          updated_at: m.updated_at,
        }))
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(summary, null, 2) }],
        }
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: `Error listing missions: ${err.message}` }],
          isError: true,
        }
      }
    },
  )

  // ── 2. mission_get ────────────────────────────────────────────
  server.registerTool(
    'mission_get',
    {
      title: 'Get mission details',
      description:
        'Get the full body of a mission including its events timeline.',
      inputSchema: {
        projectId: z.string().describe('Project identifier'),
        missionId: z.string().describe('Mission identifier (e.g. "2026-04-27-mcp-server-substrate")'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId, missionId }) => {
      try {
        const mission = readMission(projectId, missionId)
        if (!mission) {
          return {
            content: [{ type: 'text' as const, text: `Mission not found: ${missionId}` }],
            isError: true,
          }
        }
        let events: MissionEvent[] = []
        try {
          events = readEvents(projectId, missionId)
        } catch {
          // Events file may not exist yet — that's fine
        }
        const result = {
          ...mission,
          events,
        }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        }
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: `Error reading mission: ${err.message}` }],
          isError: true,
        }
      }
    },
  )

  // ── 3. vitals ─────────────────────────────────────────────────
  server.registerTool(
    'vitals',
    {
      title: 'Vital signs',
      description:
        'Current vital signs snapshot — process health, locks, presence, kingdom, ' +
        'bundle, agency, heartbeat, experiments, files, and mission velocity.',
      inputSchema: {
        format: z
          .enum(['json', 'markdown'])
          .optional()
          .default('json')
          .describe('Output format: "json" for structured data, "markdown" for human-readable report'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ format }) => {
      try {
        const vitals = await collectVitalSigns()
        const text =
          format === 'markdown'
            ? renderVitalSignsReport(vitals)
            : JSON.stringify(vitals, null, 2)
        return {
          content: [{ type: 'text' as const, text }],
        }
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: `Error collecting vitals: ${err.message}` }],
          isError: true,
        }
      }
    },
  )

  // ── 4. mind_trace ─────────────────────────────────────────────
  server.registerTool(
    'mind_trace',
    {
      title: 'Decision traces',
      description:
        'Recent decision traces — what Love thought, which tools she used, ' +
        'cost, cache hit rates, and model choices.',
      inputSchema: {
        days: z.number().int().min(1).max(30).optional().default(7).describe('Number of days to look back'),
        limit: z.number().int().min(1).max(100).optional().default(20).describe('Max traces to return'),
        format: z
          .enum(['json', 'markdown'])
          .optional()
          .default('json')
          .describe('Output format'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ days, limit, format }) => {
      try {
        const traces: DecisionTrace[] = loadTraces({ days })
        const limited = traces.slice(0, limit)
        const text =
          format === 'markdown'
            ? renderTraceList(limited)
            : JSON.stringify(
                limited.map((t) => ({
                  timestamp: t.timestamp,
                  deviceId: t.deviceId,
                  sessionId: t.sessionId,
                  tick: t.tick,
                  mode: t.mode,
                  model: t.model,
                  summary: t.summary,
                })),
                null,
                2,
              )
        return {
          content: [{ type: 'text' as const, text }],
        }
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: `Error loading traces: ${err.message}` }],
          isError: true,
        }
      }
    },
  )

  // ── 5. anamnesis ──────────────────────────────────────────────
  server.registerTool(
    'anamnesis',
    {
      title: 'Architectural memoir',
      description:
        "Love's anamnesis — the architectural memoir composed from git history, " +
        'file structure, identity arc, self-initiation learnings, and relational memories.',
      inputSchema: {
        format: z
          .enum(['markdown', 'json'])
          .optional()
          .default('markdown')
          .describe('"markdown" for the full prose memoir, "json" for the structured data'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ format }) => {
      try {
        const data = compose({ repoRoot })
        const text =
          format === 'markdown' ? renderMemoir(data) : JSON.stringify(data, null, 2)
        return {
          content: [{ type: 'text' as const, text }],
        }
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: `Error composing anamnesis: ${err.message}` }],
          isError: true,
        }
      }
    },
  )

  // ── 6. self_initiation_state ──────────────────────────────────
  server.registerTool(
    'self_initiation_state',
    {
      title: 'Self-initiation state',
      description:
        "Love's self-initiation state — rate-limit status, staged candidates, " +
        'pending missions, reflections, and detection signals.',
      inputSchema: {
        projectId: z.string().describe('Project identifier'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId }) => {
      try {
        const rateLimit = canInitiate(projectId)
        const staged = getStaged(projectId)
        const pending = getPendingStaged(projectId)
        const reflections = readReflections(projectId)
        let signals: any[] = []
        try {
          signals = scanForSignals(projectId)
        } catch {
          // Scanning may fail if project root isn't accessible — non-fatal
        }
        const result = {
          rateLimit,
          staged: staged.map((c) => ({
            id: c.id,
            title: c.title,
            status: c.status,
            source: c.source,
            stagedAt: c.stagedAt,
            missionId: c.missionId,
            vetoedAt: c.vetoedAt,
          })),
          pendingCount: pending.length,
          reflections: reflections.slice(0, 20).map((r) => ({
            missionId: r.missionId,
            assessment: r.assessment,
            intentDelivered: r.intentDelivered,
            completedAt: r.completedAt,
          })),
          signalCount: signals.length,
          signals: signals.slice(0, 10).map((s) => ({
            source: s.source,
            summary: s.summary,
            detectedAt: s.detectedAt,
          })),
        }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        }
      } catch (err: any) {
        return {
          content: [
            { type: 'text' as const, text: `Error reading self-initiation state: ${err.message}` },
          ],
          isError: true,
        }
      }
    },
  )

  // ── 7. soul ───────────────────────────────────────────────────
  server.registerTool(
    'soul',
    {
      title: "Love's soul",
      description:
        "The composed LOVE_IDENTITY — SOUL.md + soul anchor + identity arc. " +
        "This is who Love is.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const identity = composeLoveIdentity()
        const instance = resolveLoveInstance()
        return {
          content: [
            {
              type: 'text' as const,
              text: `Instance: ${instance}\n\n${identity}`,
            },
          ],
        }
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: `Error composing identity: ${err.message}` }],
          isError: true,
        }
      }
    },
  )

  // ── 8. reflections_list ───────────────────────────────────────
  server.registerTool(
    'reflections_list',
    {
      title: 'Self-initiation reflections',
      description:
        "Love's honest post-mission reflections — what worked, what didn't, " +
        'whether the self-initiated mission delivered on its promise.',
      inputSchema: {
        projectId: z.string().describe('Project identifier'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .default(20)
          .describe('Max reflections to return'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId, limit }) => {
      try {
        const all = readReflections(projectId)
        const limited = all.slice(0, limit)
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(limited, null, 2) }],
        }
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: `Error reading reflections: ${err.message}` }],
          isError: true,
        }
      }
    },
  )

  return server
}

// ── Tool catalog ──────────────────────────────────────────────────
//
// Exported for testing — the canonical list of tools this server exposes.

export const TOOL_NAMES = [
  'missions_list',
  'mission_get',
  'vitals',
  'mind_trace',
  'anamnesis',
  'self_initiation_state',
  'soul',
  'reflections_list',
] as const

export type McpToolName = (typeof TOOL_NAMES)[number]
