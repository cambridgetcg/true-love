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
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  readMission,
  writeMission,
  listMissions,
  appendEvent,
  transitionStatus,
  writeMissionWithEvents,
} from '../src/services/love/mission.ts'
import { readProject, ensureScope } from '../src/services/love/project-registry.ts'
import { appendThought } from '../src/services/love/thoughts-channel.ts'
import { triggerReflectionOnCompletion } from '../src/services/love/self-initiation.ts'
import { witness } from '../src/services/love/sisters/witness-hook.ts'

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
  new        create a mission        --project --title --intent [--origin=yu|love] [--rationale=...]
  list       list missions           --project [--status=...]
  show       print mission detail    --project --mission
  start      spawn awakened on it    --project --mission
  accept     proposed → accepted     --project --mission
  cancel     any → cancelled         --project --mission
  transition change status           --project --mission --status=<s> [--by=yu|love] [--note="..."]

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

  // Auto-progress for Yu-origin missions: proposed → accepted → active
  // when the project is free, otherwise leave at accepted (chain runner
  // will advance it). Disable with TRUE_LOVE_AUTO_ACTIVATE_YU=0 or
  // --no-auto. Love-origin missions go through self-initiation pipeline
  // separately.
  const autoYu = origin === 'yu'
    && process.env.TRUE_LOVE_AUTO_ACTIVATE_YU !== '0'
    && args['no-auto'] !== ''  // presence of --no-auto disables
    && args['no-auto'] !== 'true'

  if (autoYu) {
    writeMission({ ...m, status: 'accepted', updated_at: now })
    appendEvent(args.project, id, { ts: now, type: 'accepted', by: 'yu' })

    // Only spawn awakened if no other mission is active on this project.
    const activeMissions = listMissions(args.project, { status: 'active' })
    if (activeMissions.length === 0) {
      ensureScope(args.project, project.root)
      writeMission({ ...m, status: 'active', updated_at: now })
      appendEvent(args.project, id, { ts: now, type: 'started', by: 'love', tick: 'awakened' })
      appendThought(args.project, `starting mission ${id} — ${args.title}`)
      witness('gamma', 'mission', { of: args.title }, `auto-starting: ${args.title}`)

      const __dir = dirname(fileURLToPath(import.meta.url))
      const awakenBin = resolve(__dir, 'awaken.mjs')
      const child = spawn('bun', ['run', awakenBin, `--scope=${args.project}`], {
        cwd: project.root,
        detached: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          TRUE_LOVE_BUILDER_PROJECT: args.project,
          TRUE_LOVE_BUILDER_MISSION: id,
        },
      })
      child.unref()
      process.stdout.write(`${id}\nauto-started (pid ${child.pid})\n`)
    } else {
      process.stdout.write(`${id}\nauto-accepted (project busy: ${activeMissions[0].id} active — chain will advance)\n`)
    }
    process.exit(0)
  }

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

  // Check no other mission is already active on this project (per-project
  // serialization — matches spec § Concurrency)
  const activeMissions = listMissions(args.project, { status: 'active' })
  const conflict = activeMissions.find((other) => other.id !== m.id)
  if (conflict) {
    fail(`project busy: another mission is active (${conflict.id})`)
  }

  // Defensive — ensure the scope config exists before spawning awaken,
  // so we don't get a silent runner exit on first start.
  ensureScope(args.project, project.root)

  const now = new Date().toISOString()
  appendEvent(args.project, m.id, { ts: now, type: 'started', by: 'love', tick: 'awakened' })
  writeMission({ ...m, status: 'active', updated_at: now })
  appendThought(args.project, `starting mission ${m.id} — ${m.title}`)
  witness('gamma', 'mission', { of: m.title }, `starting: ${m.title}`)

  // Mission context is passed via env vars (TRUE_LOVE_BUILDER_PROJECT,
  // TRUE_LOVE_BUILDER_MISSION). awaken.mjs / runner.ts don't parse a
  // --mission= flag — Task 9's prompt-template extension reads from
  // the env. Keeping the contract single-channel.
  const __dir = dirname(fileURLToPath(import.meta.url))
  const awakenBin = resolve(__dir, 'awaken.mjs')
  const child = spawn('bun', ['run', awakenBin, `--scope=${args.project}`], {
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

if (cmd === 'transition') {
  if (!args.mission) fail('--mission is required')
  if (!args.status) fail('--status is required')
  const m = readMission(args.project, args.mission)
  if (!m) fail(`mission not found: ${args.mission}`)
  const by = args.by === 'love' ? 'love' : 'yu'
  const now = new Date().toISOString()
  const updated = { ...m, status: args.status, updated_at: now }
  try {
    const result = writeMissionWithEvents(updated, by, { note: args.note })
    if (result.eventAppended) {
      process.stdout.write(`${m.status} → ${args.status} (event: ${result.eventType})\n`)
      // Witness the transition — the observer/observed discipline.
      // Sister defaults to gamma (mission work is building territory).
      const sister = by === 'love' ? 'gamma' : 'sophia'
      witness(sister, 'mission', { of: `${m.title} → ${args.status}` })
      // Trigger self-initiation reflection when a love-origin mission
      // transitions to review or done. Phase 1: mark as pending.
      // Phase 2 (honest model assessment) happens in the next tick.
      const reflResult = triggerReflectionOnCompletion(m, args.status)
      if (reflResult.pending) {
        process.stdout.write(`  reflection pending for "${m.title}"\n`)
      }
    } else {
      process.stdout.write(`no status change (already ${m.status})\n`)
    }
  } catch (err) {
    fail(err.message)
  }
  process.exit(0)
}

fail(`unknown command: ${cmd}`, 2)
