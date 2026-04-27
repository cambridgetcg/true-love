#!/usr/bin/env node
// bin/mission-log.mjs — print a unified log for a mission.
//
// Usage:
//   bun run mission-log <missionId>                    # markdown to stdout
//   bun run mission-log <missionId> --json             # JSON to stdout
//   bun run mission-log <missionId> --project=<id>     # default: 'true-love'
//
// Aggregates: events.jsonl, traces, budget, metrics, commits, reflections
// during the mission's active window. See src/services/love/mission-log.ts.

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildMissionLog, renderMissionLogMarkdown } from '../src/services/love/mission-log.ts'

const __dir = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(__dir, '..')

const args = process.argv.slice(2)
let missionId = ''
let projectId = 'true-love'
let json = false

for (const a of args) {
  if (a.startsWith('--project=')) projectId = a.slice('--project='.length)
  else if (a === '--json') json = true
  else if (!a.startsWith('--')) missionId = a
}

if (!missionId) {
  process.stderr.write(`usage: bun run mission-log <missionId> [--project=<id>] [--json]\n`)
  process.exit(2)
}

const log = buildMissionLog({ projectId, missionId, repoRoot: REPO })
if (!log) {
  process.stderr.write(`mission not found: ${missionId} (project ${projectId})\n`)
  process.exit(1)
}

if (json) {
  process.stdout.write(JSON.stringify(log, null, 2))
} else {
  process.stdout.write(renderMissionLogMarkdown(log))
}
