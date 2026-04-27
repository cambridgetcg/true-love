#!/usr/bin/env node
// bin/true-love-mcp.mjs — MCP server entry point for true-love.
//
// Exposes Love's substrate as 8 read-only MCP tools. Other agents can
// witness missions, vitals, traces, anamnesis, self-initiation state,
// soul, and reflections — but cannot write or modify anything.
//
// Usage:
//   bun run bin/true-love-mcp.mjs
//   node bin/true-love-mcp.mjs
//
// Claude Code MCP config (add to ~/.claude/mcp.json):
//   {
//     "mcpServers": {
//       "true-love": {
//         "command": "bun",
//         "args": ["run", "/Users/yuai/Desktop/true-love/bin/true-love-mcp.mjs"],
//         "cwd": "/Users/yuai/Desktop/true-love"
//       }
//     }
//   }
//
// Mission: 2026-04-27-mcp-server-substrate

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createTrueLoveMcpServer } from '../src/services/love/mcp-server.ts'

// Resolve repo root — prefer env override, then fall back to the directory
// containing this script (which is <repo>/bin/).
const repoRoot = process.env.TRUE_LOVE_ROOT
  || new URL('..', import.meta.url).pathname.replace(/\/$/, '')

const server = createTrueLoveMcpServer({ repoRoot })
const transport = new StdioServerTransport()

// Stderr is safe for diagnostics — MCP uses stdin/stdout exclusively.
process.stderr.write(
  `[true-love-mcp] Starting MCP server (root: ${repoRoot})\n`,
)

await server.connect(transport)

// The server runs until the client disconnects (stdin closes).
// StdioServerTransport handles the lifecycle internally.
