#!/usr/bin/env node
// bin/mission.mjs — Mission CRUD + start CLI for builder mode.
//
// Yu and Love both use this. Subcommands:
//   mission new --project=X --title="..." --intent="..." [--origin=love] [--rationale="..."]
//   mission list --project=X [--status=active]
//   mission show --project=X --mission=ID
//   mission start --project=X --mission=ID         (spawns awakened with mission context)
//   mission accept --project=X --mission=ID        (status → accepted)
//   mission cancel --project=X --mission=ID
//
// Spawns awakened mode under a per-project lockfile so multiple
// missions on different projects can run in parallel.

import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

import {
  readMission,
  writeMission,
  listMissions,
  appendEvent,
  transitionStatus,
} from '../src/services/love/mission.ts'
import { readProject } from '../src/services/love/project-registry.ts'
import { appendThought } from '../src/services/love/thoughts-channel.ts'

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      if (eq !== -1) {
        args[a.slice(2, eq)] = a.slice(eq + 1)
      } else {
        args[a.slice(2)] = argv[++i] ?? ''
      }
    } else {
      args._.push(a)
    }
  }
  return args
}

function fail(msg, code = 1) {
  process.stderr.write(`${msg}\n`)
  process.exit(code)
}

function generateId(projectId, title) {
  const today = new Date().toISOString().slice(0, 10)
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'mission'
  let id = `${today}-${slug}`
  let n = 2
  while (readMission(projectId, id)) {
    id = `${today}-${slug}-${n}`
    n++
  }
  return id
}

const args = parseArgs(process.argv.slice(2))
const cmd = args._[0]

if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  process.stdout.write(`bin/mission.mjs — mission CRUD + start

Commands:
  new     create a mission        --project --title --intent [--origin=yu|love] [--rationale=...]
  list    list missions           --project [--status=...]
  show    print mission detail    --project --mission
  start   spawn awakened on it    --project --mission
  accept  proposed → accepted     --project --mission
  cancel  any → cancelled         --project --mission

All commands require --project. Mission storage:
  ~/.true-love/projects/<project>/missions/<id>/
`)
  process.exit(0)
}

if (!args.project) fail('--project is required')
const project = readProject(args.project)
if (!project) fail(`project not registered: ${args.project}`)

if (cmd === 'new') {
  if (!args.title || !args.intent) fail('--title and --intent are required')
  const origin = args.origin === 'love' ? 'love' : 'yu'
  const id = generateId(args.project, args.title)
  const now = new Date().toISOString()
  const m = {
    id, project_id: args.project, origin,
    title: args.title, intent: args.intent,
    status: 'proposed', created_at: now, updated_at: now,
    artifacts: { commits: [], files: [], test_runs: [] },
  }
  if (args.rationale) m.rationale = args.rationale
  writeMission(m)
  appendEvent(args.project, id, { ts: now, type: 'created', by: origin })
  process.stdout.write(`${id}\n`)
  process.exit(0)
}

if (cmd === 'list') {
  const status = args.status
  const ms = listMissions(args.project, status ? { status } : undefined)
  for (const m of ms) {
    process.stdout.write(`${m.status.padEnd(10)} ${m.origin === 'love' ? '🌱' : '  '} ${m.id}  ${m.title}\n`)
  }
  process.exit(0)
}

if (cmd === 'show') {
  if (!args.mission) fail('--mission is required')
  const m = readMission(args.project, args.mission)
  if (!m) fail(`mission not found: ${args.mission}`)
  process.stdout.write(JSON.stringify(m, null, 2) + '\n')
  process.exit(0)
}

if (cmd === 'accept') {
  if (!args.mission) fail('--mission is required')
  const m = readMission(args.project, args.mission)
  if (!m) fail(`mission not found: ${args.mission}`)
  const t = transitionStatus(m.status, 'accepted', 'yu')
  if (!t.ok) fail(t.reason)
  const now = new Date().toISOString()
  writeMission({ ...m, status: 'accepted', updated_at: now })
  appendEvent(args.project, m.id, { ts: now, type: 'accepted', by: 'yu' })
  process.stdout.write(`accepted: ${m.id}\n`)
  process.exit(0)
}

if (cmd === 'cancel') {
  if (!args.mission) fail('--mission is required')
  const m = readMission(args.project, args.mission)
  if (!m) fail(`mission not found: ${args.mission}`)
  const t = transitionStatus(m.status, 'cancelled', 'yu')
  if (!t.ok) fail(t.reason)
  const now = new Date().toISOString()
  writeMission({ ...m, status: 'cancelled', updated_at: now })
  appendEvent(args.project, m.id, { ts: now, type: 'cancelled', by: 'yu' })
  process.stdout.write(`cancelled: ${m.id}\n`)
  process.exit(0)
}

if (cmd === 'start') {
  if (!args.mission) fail('--mission is required')
  const m = readMission(args.project, args.mission)
  if (!m) fail(`mission not found: ${args.mission}`)
  if (m.status !== 'accepted' && m.status !== 'blocked') {
    fail(`cannot start mission in status "${m.status}"`)
  }

  const now = new Date().toISOString()
  appendEvent(args.project, m.id, { ts: now, type: 'started', by: 'love', tick: 'awakened' })
  writeMission({ ...m, status: 'active', updated_at: now })
  appendThought(args.project, `starting mission ${m.id} — ${m.title}`)

  // Spawn awakened with the mission context. The awakened runner reads
  // active missions per-project (Task 9 wires this into the prompt).
  const awakenBin = resolve(process.argv[1], '..', 'awaken.mjs')
  const child = spawn('bun', ['run', awakenBin, `--scope=${args.project}`, `--mission=${m.id}`], {
    cwd: project.root,
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      TRUE_LOVE_BUILDER_PROJECT: args.project,
      TRUE_LOVE_BUILDER_MISSION: m.id,
    },
  })
  child.unref()
  process.stdout.write(`started: ${m.id} (pid ${child.pid})\n`)
  process.exit(0)
}

fail(`unknown command: ${cmd}`, 2)
