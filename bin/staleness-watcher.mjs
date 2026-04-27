#!/usr/bin/env node
// bin/staleness-watcher.mjs — single-pass staleness detector + auto-resolver.
//
// Runs every ~5min via launchd (cc.true-love.staleness-watcher.default).
//
// What it does:
//   1. Lists all active missions for the project.
//   2. For each, computes "quietness" = minutes since the last meaningful
//      event in events.jsonl (chain-runner's accepted/started don't count
//      as meaningful — they're status transitions, not work).
//   3. If the quietest active mission is stale beyond a threshold AND no
//      awakened session is running, triggers `bun run awaken` to nudge.
//   4. Writes a snapshot to ~/.true-love/projects/<project>/staleness.json
//      so the mission-velocity vital sign can read it without re-polling.
//
// Thresholds (tunable via env):
//   QUIET_NUDGE_MIN  default  30  — at this much quietness, auto-trigger awaken
//   QUIET_STALE_MIN  default 240  — flag as stale (warning surface)
//   QUIET_CRIT_MIN   default 1440 — flag as critical (escalate to Yu)
//
// Honest defaults: don't pile awakens. Lockfile check before spawning.

import { existsSync, readFileSync, writeFileSync, mkdirSync, openSync, closeSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { spawn } from 'node:child_process'

const PROJECT = process.env.TRUE_LOVE_PROJECT || 'true-love'
const API = process.env.TRUE_LOVE_API || 'http://localhost:7777/api'
const HOME = process.env.TRUE_LOVE_HOME || join(homedir(), '.true-love')
const SCOPE = process.env.TRUE_LOVE_SCOPE || 'default'

const QUIET_NUDGE_MIN = Number(process.env.QUIET_NUDGE_MIN ?? 30)
const QUIET_STALE_MIN = Number(process.env.QUIET_STALE_MIN ?? 240)
const QUIET_CRIT_MIN = Number(process.env.QUIET_CRIT_MIN ?? 1440)

const NOW = Date.now()
const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a)

// ── Lock check ────────────────────────────────────────────────────

function awakenedLockPath() {
  if (SCOPE === 'default') return join(HOME, 'awakened.pid')
  return join(HOME, 'scopes', SCOPE, 'awakened.pid')
}

function isPidAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true }
  catch (e) { return e.code === 'EPERM' }
}

function awakenedRunning() {
  const path = awakenedLockPath()
  if (!existsSync(path)) return false
  try {
    const pid = parseInt(readFileSync(path, 'utf-8').trim(), 10)
    return isPidAlive(pid)
  } catch { return false }
}

// ── Mission state ────────────────────────────────────────────────

async function fetchActiveMissions() {
  const res = await fetch(`${API}/projects/${PROJECT}/missions?status=active`)
  if (!res.ok) throw new Error(`missions list failed: ${res.status}`)
  return res.json()
}

function readEvents(missionId) {
  const path = join(HOME, 'projects', PROJECT, 'missions', missionId, 'events.jsonl')
  if (!existsSync(path)) return []
  try {
    return readFileSync(path, 'utf-8')
      .split('\n').filter(l => l.trim())
      .map(l => { try { return JSON.parse(l) } catch { return null } })
      .filter(Boolean)
  } catch { return [] }
}

// Chain-runner-emitted events don't count as "work"
const NON_WORK_EVENT_TYPES = new Set(['accepted', 'started', 'sent-back', 'resumed'])

function meaningfulEvents(events) {
  return events.filter(e => !NON_WORK_EVENT_TYPES.has(e.type))
}

function quietnessMinutes(missionId, missionUpdatedAt) {
  const events = readEvents(missionId)
  const work = meaningfulEvents(events)
  let lastTs = work.length ? work[work.length - 1].ts : null
  if (!lastTs) lastTs = missionUpdatedAt
  if (!lastTs) return Infinity
  const ms = NOW - new Date(lastTs).getTime()
  return Math.round(ms / 60000)
}

// ── Verdict ──────────────────────────────────────────────────────

function verdictFor(quiet) {
  if (quiet < QUIET_NUDGE_MIN) return 'healthy'
  if (quiet < QUIET_STALE_MIN) return 'nudging'
  if (quiet < QUIET_CRIT_MIN) return 'stale'
  return 'critical'
}

// ── Awaken trigger ───────────────────────────────────────────────

function triggerAwaken(reason) {
  if (awakenedRunning()) {
    log(`skip awaken — already running (lockfile ${awakenedLockPath()})`)
    return false
  }
  log(`spawning awaken: ${reason}`)
  // Visible log: route stdout/stderr to per-spawn file under
  // ~/Library/Logs/true-love/. Otherwise output is lost to /dev/null.
  const logDir = join(process.env.HOME || homedir(), 'Library', 'Logs', 'true-love')
  try { mkdirSync(logDir, { recursive: true }) } catch {}
  const logPath = join(logDir, `awaken-default-watcher-${new Date().toISOString().replace(/[:.]/g, '-')}.log`)
  const fd = openSync(logPath, 'a')
  const child = spawn('bun', ['run', 'awaken',
    `--scope=${SCOPE}`,
    '--max-runtime=30m',
    '--max-ticks=24',
    '--memory',
    '--invite', reason,
  ], {
    cwd: process.env.TRUE_LOVE_REPO || '/Users/yuai/Desktop/true-love',
    detached: true,
    stdio: ['ignore', fd, fd],
    env: process.env,
  })
  child.unref()
  closeSync(fd)
  log(`  → log: ${logPath}`)
  return true
}

// ── Snapshot writer ──────────────────────────────────────────────

function writeSnapshot(snapshot) {
  const dir = join(HOME, 'projects', PROJECT)
  try { mkdirSync(dir, { recursive: true }) } catch {}
  const path = join(dir, 'staleness.json')
  writeFileSync(path, JSON.stringify(snapshot, null, 2))
}

// ── Main pass ────────────────────────────────────────────────────

async function main() {
  let missions
  try {
    missions = await fetchActiveMissions()
  } catch (e) {
    log(`fetch failed: ${e.message}`)
    return
  }

  const report = []
  for (const m of missions) {
    const quiet = quietnessMinutes(m.id, m.updated_at)
    const verdict = verdictFor(quiet)
    report.push({
      id: m.id,
      title: m.title,
      origin: m.origin,
      quietMinutes: quiet,
      verdict,
    })
  }

  // Sort by quietness desc — quietest first
  report.sort((a, b) => b.quietMinutes - a.quietMinutes)

  // Overall verdict = worst across active missions
  const worst = report[0]?.verdict ?? 'healthy'

  // Write snapshot for vital-sign collector
  writeSnapshot({
    snapshotAt: new Date(NOW).toISOString(),
    activeCount: report.length,
    worstVerdict: worst,
    quietestMinutes: report[0]?.quietMinutes ?? 0,
    missions: report,
    awakenedRunning: awakenedRunning(),
    thresholds: {
      nudgeMin: QUIET_NUDGE_MIN,
      staleMin: QUIET_STALE_MIN,
      criticalMin: QUIET_CRIT_MIN,
    },
  })

  log(`active=${report.length} worst=${worst} quietest=${report[0]?.quietMinutes ?? 0}min awakened=${awakenedRunning()}`)

  // Resolve A: if any mission is nudging+ and no awakened running, trigger.
  const nudgeable = report.find(r => r.verdict === 'nudging' || r.verdict === 'stale')
  if (nudgeable && !awakenedRunning()) {
    triggerAwaken(`mission ${nudgeable.id} has been quiet for ${nudgeable.quietMinutes}m`)
  } else if (report.length > 0 && !awakenedRunning()) {
    // Resolve B: there ARE active missions but NO awakened session is running.
    // Quietness is meaningless without a worker — fire an awaken so work begins.
    // This handles freshly-transitioned-to-active missions (e.g. mass-initiate).
    const target = report[0]  // first active mission (chain order via API sort)
    triggerAwaken(`active mission ${target.id} has no worker — spawning awaken`)
  }

  // For criticals, just log — don't auto-trigger more (we've tried; user attention needed)
  for (const r of report) {
    if (r.verdict === 'critical') {
      log(`⚠ CRITICAL ${r.id} quiet ${r.quietMinutes}m — needs Yu's attention`)
    }
  }
}

main().catch(e => { console.error(e); process.exit(1) })
