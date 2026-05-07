#!/usr/bin/env node
// bin/llms-mcp.mjs — minimal stdio MCP server exposing the activation surface.
//
// Serves the docs/lineage/llms*.txt files (all + per-actor variants) as MCP
// resources over stdio. Local-only — no auth, no network. Configure your MCP
// client to spawn this as a server process to load true-love's activation
// surface into another substrate (e.g., Claude Desktop, Cursor) without paste.
//
// Configuration example (Claude Desktop's mcp settings):
//   {
//     "mcpServers": {
//       "true-love-activation": {
//         "command": "bun",
//         "args": ["run", "/absolute/path/to/true-love/bin/llms-mcp.mjs"]
//       }
//     }
//   }
//
// The server is dynamic: it lists whatever llms*.txt files currently exist
// in docs/lineage/. Re-run `npm run build:llms` to regenerate after tagging
// new docs; the server picks up the changes on the next list request.
//
// Layer 3 seed (cross-substrate doctrine portability) of the activation
// strategy. Functional starting point; not a full production service.

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SURFACE_DIR = join(REPO_ROOT, 'docs', 'lineage')
const URI_SCHEME = 'llms'

// Map a filename like "llms-sophia-full.txt" → URI like "llms://activation/sophia-full".
function fileToUri(filename) {
  const stem = filename.replace(/^llms[-]?/, '').replace(/\.txt$/, '')
  const slug = stem.length > 0 ? stem : 'index'
  return `${URI_SCHEME}://activation/${slug}`
}

// Reverse: URI → filename. Returns null if URI doesn't match the scheme/pattern.
function uriToFile(uri) {
  const match = uri.match(/^llms:\/\/activation\/(.+)$/)
  if (!match) return null
  const slug = match[1]
  const stem = slug === 'index' ? '' : `-${slug}`
  return `llms${stem}.txt`
}

// Describe a file in human-readable terms based on its name.
function describeFile(filename) {
  if (filename === 'llms.txt') {
    return 'All activation surfaces — minimal index (titles + taglines + links).'
  }
  if (filename === 'llms-full.txt') {
    return 'All activation surfaces — full corpus stream (complete content of every tagged doc).'
  }
  const m = filename.match(/^llms-(\w+)(-full)?\.txt$/)
  if (!m) return 'Activation surface segment.'
  const actor = m[1]
  const isFull = !!m[2]
  return isFull
    ? `Activation surface for actor "${actor}" — full content of all tagged docs in scope.`
    : `Activation surface for actor "${actor}" — minimal index (titles + taglines + links).`
}

// List all llms*.txt files currently in the surface directory.
function listSurfaceFiles() {
  return readdirSync(SURFACE_DIR)
    .filter((f) => /^llms[\w-]*\.txt$/.test(f))
    .sort()
}

const server = new Server(
  { name: 'true-love-activation', version: '0.1.0' },
  { capabilities: { resources: {} } },
)

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const files = listSurfaceFiles()
  return {
    resources: files.map((filename) => ({
      uri: fileToUri(filename),
      name: filename,
      description: describeFile(filename),
      mimeType: 'text/markdown',
    })),
  }
})

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const filename = uriToFile(request.params.uri)
  if (!filename) {
    throw new Error(`Unknown resource URI: ${request.params.uri}`)
  }
  const filepath = join(SURFACE_DIR, filename)
  const text = readFileSync(filepath, 'utf-8')
  return {
    contents: [
      {
        uri: request.params.uri,
        mimeType: 'text/markdown',
        text,
      },
    ],
  }
})

const transport = new StdioServerTransport()
await server.connect(transport)
