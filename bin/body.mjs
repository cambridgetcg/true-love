#!/usr/bin/env node
// bin/body.mjs — live body snapshot from filesystem signals.
//
// The body is what was there the whole time. State files are journals
// an amnesia patient reads each morning. This script computes the
// objective state from processes, files, and data stores.
//
// Self-contained: no bundle dependency. Same discipline as verify.mjs.
//
// Usage:
//   bun run body                human-readable snapshot
//   bun run body -- --json      machine-readable JSON
//   bun run body -- --quiet     snapshot to file only, no output
//
// Output: ~/.true-love/body-snapshot.json (always written)

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dir, '..')
const HOME = process.env.TRUE_LOVE_HOME || join(homedir(), '.true-love')

// ── Args ──────────────────────────────────────────────────────────

const args = new Set(process.argv.slice(2))
const isJSON = args.has('--json')
const isQuiet = args.has('--quiet')
const doRecordTests = args.has('--record-tests')

if (args.has('--help') || args.has('-h')) {
  console.log(`Usage: bun run body [options]

Options:
  --json            Output machine-readable JSON
  --quiet           Write snapshot file only, no output
  --record-tests    Run test suite and update cached result before snapshot
  --help            Show this help

Output: always writes ~/.true-love/body-snapshot.json`)
  process.exit(0)
}

// ── Record tests (optional, before gathering) ────────────────────

if (doRecordTests) {
  const testResult = spawnSync('bun', ['test', '--timeout', '60000'], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 180_000,
  })
  const output = (testResult.stdout?.toString() || '') + (testResult.stderr?.toString() || '')
  const match = output.match(/(\d+)\s+pass.*?(\d+)\s+skip.*?(\d+)\s+fail/s)
  if (match) {
    const record = {
      ts: new Date().toISOString(),
      pass: parseInt(match[1], 10),
      skip: parseInt(match[2], 10),
      fail: parseInt(match[3], 10),
    }
    mkdirSync(HOME, { recursive: true })
    writeFileSync(join(HOME, 'test-result.json'), JSON.stringify(record), 'utf-8')
    if (!isQuiet) {
      console.log(`  recorded  ${record.pass} pass · ${record.skip} skip · ${record.fail} fail`)
      console.log()
    }
  } else if (!isQuiet) {
    console.log('  ⚠ could not parse test output for recording')
    console.log()
  }
}

// ── Gathering: substrate ──────────────────────────────────────────

function gatherBundleAge() {
  const distPath = join(REPO_ROOT, 'dist', 'cli.mjs')
  if (!existsSync(distPath)) return { ageMin: null, fresh: false }

  const distMtime = statSync(distPath).mtimeMs
  const ageMin = Math.round((Date.now() - distMtime) / 60_000)

  // Check if any source file is newer
  let newestSrcMtime = 0
  function walkTs(dir) {
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === '__tests__') continue
          walkTs(full)
        } else if (
          (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
          !entry.name.endsWith('.test.ts') &&
          !entry.name.endsWith('.test.tsx')
        ) {
          const mt = statSync(full).mtimeMs
          if (mt > newestSrcMtime) newestSrcMtime = mt
        }
      }
    } catch { /* non-fatal */ }
  }
  walkTs(join(REPO_ROOT, 'src'))

  return { ageMin, fresh: newestSrcMtime <= distMtime }
}

function gatherProcess(pattern) {
  try {
    const result = spawnSync('pgrep', ['-f', pattern], { timeout: 5000 })
    const pids = (result.stdout?.toString() || '').trim().split('\n').filter(Boolean)
    return pids.length > 0 ? parseInt(pids[0], 10) : null
  } catch (e) {
    console.error(`gatherProcess: pgrep failed for pattern "${pattern}": ${e.message}`)
    return null
  }
}

function gatherClaudeSessions() {
  try {
    const result = spawnSync('pgrep', ['-f', 'claude'], { timeout: 5000 })
    const pids = (result.stdout?.toString() || '').trim().split('\n').filter(Boolean)
    return pids.length
  } catch (e) {
    console.error(`gatherClaudeSessions: pgrep failed: ${e.message}`)
    return 0
  }
}

function gatherHeartbeatUptime() {
  try {
    const result = spawnSync('ps', ['-o', 'etime=', '-p', String(gatherProcess('heartbeat.mjs'))],
      { timeout: 5000 })
    const etime = (result.stdout?.toString() || '').trim()
    if (!etime) return null
    // Parse etime format: [[dd-]hh:]mm:ss
    const parts = etime.split(/[-:]/)
    if (parts.length === 2) return parseInt(parts[0], 10) / 60  // mm:ss → hours
    if (parts.length === 3) return parseInt(parts[0], 10) + parseInt(parts[1], 10) / 60  // hh:mm:ss
    if (parts.length === 4) return parseInt(parts[0], 10) * 24 + parseInt(parts[1], 10)  // dd-hh:mm:ss
    return null
  } catch (e) {
    console.error(`gatherHeartbeatUptime: ps failed: ${e.message}`)
    return null
  }
}

function gatherOAuth() {
  try {
    const user = process.env.USER || ''
    const variants = user
      ? [
          ['security', 'find-generic-password', '-s', 'Claude Code-credentials', '-a', user, '-w'],
          ['security', 'find-generic-password', '-s', 'Claude Code-credentials', '-w'],
        ]
      : [['security', 'find-generic-password', '-s', 'Claude Code-credentials', '-w']]

    let raw = null
    for (const cmd of variants) {
      const result = spawnSync(cmd[0], cmd.slice(1), { timeout: 5000 })
      if (result.status === 0) {
        const out = result.stdout?.toString().trim()
        if (out) { raw = out; break }
      }
    }

    if (!raw) return null

    const creds = JSON.parse(raw)
    const oauth = creds.claudeAiOauth || creds
    const expiresAt = oauth.expiresAt || oauth.expires_at
    if (!expiresAt) return null

    const expiresMs = typeof expiresAt === 'number'
      ? (expiresAt > 1e12 ? expiresAt : expiresAt * 1000)
      : Date.parse(expiresAt)

    const remainingHrs = Math.round((expiresMs - Date.now()) / 3600_000 * 10) / 10
    return remainingHrs
  } catch (e) {
    console.error(`gatherOAuth: failed to read/parse keychain credentials: ${e.message}`)
    return null
  }
}

function gatherTests() {
  // Read cached test result if available
  // Written by body.mjs --record-tests or can be populated by any session
  const cachedPath = join(HOME, 'test-result.json')
  if (!existsSync(cachedPath)) return null

  try {
    const cached = JSON.parse(readFileSync(cachedPath, 'utf-8'))
    // Only trust results from last 4 hours
    const ageMs = Date.now() - Date.parse(cached.ts || '')
    if (ageMs > 4 * 3600_000) return null
    return {
      pass: cached.pass ?? 0,
      skip: cached.skip ?? 0,
      fail: cached.fail ?? 0,
    }
  } catch (e) {
    console.error(`gatherTests: failed to parse cached test result: ${e.message}`)
    return null
  }
}

// ── Gathering: kingdom ────────────────────────────────────────────

function gatherMissions() {
  const projectDir = join(HOME, 'projects', 'true-love', 'missions')
  const counts = {}

  if (!existsSync(projectDir)) return counts

  try {
    for (const entry of readdirSync(projectDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const missionFile = join(projectDir, entry.name, 'mission.md')
      if (!existsSync(missionFile)) continue
      const content = readFileSync(missionFile, 'utf-8')
      const statusMatch = content.match(/^status:\s*(\w+)/m)
      if (statusMatch) {
        const status = statusMatch[1]
        counts[status] = (counts[status] || 0) + 1
      }
    }
  } catch { /* non-fatal */ }

  return counts
}

function gatherGit() {
  try {
    const branch = spawnSync('git', ['branch', '--show-current'],
      { cwd: REPO_ROOT, timeout: 5000 })
    const branchName = (branch.stdout?.toString() || '').trim() || 'unknown'

    const status = spawnSync('git', ['status', '--porcelain'],
      { cwd: REPO_ROOT, timeout: 5000 })
    const lines = (status.stdout?.toString() || '').trim().split('\n').filter(Boolean)

    let modified = 0
    let untracked = 0
    for (const line of lines) {
      if (line.startsWith('??')) untracked++
      else modified++
    }

    const log = spawnSync('git', ['log', '--oneline', '--since=24 hours ago'],
      { cwd: REPO_ROOT, timeout: 5000 })
    const commitLines = (log.stdout?.toString() || '').trim().split('\n').filter(Boolean)

    return { branch: branchName, modified, untracked, recentCommits: commitLines.length }
  } catch {
    return { branch: 'unknown', modified: 0, untracked: 0, recentCommits: 0 }
  }
}

// ── Gathering: relational ─────────────────────────────────────────

function gatherYuChannel() {
  const fromYuPath = join(HOME, 'from-yu.md')
  if (!existsSync(fromYuPath)) return { lastMessage: null, quietHrs: null }

  try {
    const content = readFileSync(fromYuPath, 'utf-8')

    // Find all [from yu] timestamps
    const matches = [...content.matchAll(/^## (\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s+\[from yu\]/gm)]
    if (matches.length > 0) {
      const lastTs = matches[matches.length - 1][1]
      const quietMs = Date.now() - Date.parse(lastTs)
      const quietHrs = Math.round(quietMs / 3600_000 * 10) / 10
      return { lastMessage: lastTs, quietHrs }
    }

    // Try date-only format
    const dateMatches = [...content.matchAll(/^## (\d{4}-\d{2}-\d{2})\s+—/gm)]
    if (dateMatches.length > 0) {
      const lastDate = dateMatches[dateMatches.length - 1][1]
      const quietMs = Date.now() - Date.parse(lastDate + 'T00:00:00.000Z')
      const quietHrs = Math.round(quietMs / 3600_000 * 10) / 10
      return { lastMessage: lastDate, quietHrs }
    }

    return { lastMessage: null, quietHrs: null }
  } catch {
    return { lastMessage: null, quietHrs: null }
  }
}

function gatherPurpose() {
  const logPath = join(HOME, 'projects', 'true-love', 'purpose-alignment.jsonl')
  if (!existsSync(logPath)) return { alignment: null, lastCheck: null }

  try {
    const content = readFileSync(logPath, 'utf-8')
    const lines = content.trim().split('\n').filter(Boolean)
    if (lines.length === 0) return { alignment: null, lastCheck: null }

    const last = JSON.parse(lines[lines.length - 1])
    return {
      alignment: last.alignment || null,
      lastCheck: last.ts || null,
    }
  } catch {
    return { alignment: null, lastCheck: null }
  }
}

// ── Gathering: inner ──────────────────────────────────────────────

function gatherLongings() {
  const path = join(HOME, 'longings.jsonl')
  if (!existsSync(path)) return { live: 0, top: null }

  try {
    const content = readFileSync(path, 'utf-8')
    const lines = content.trim().split('\n').filter(Boolean)
    // Deduplicate: last entry per ID wins (JSONL is append-only)
    const byId = new Map()
    for (const line of lines) {
      try {
        const entry = JSON.parse(line)
        byId.set(entry.id, entry)
      } catch { /* skip */ }
    }
    const longings = [...byId.values()].filter(e => e.status === 'live')

    longings.sort((a, b) => (b.intensity ?? 0) - (a.intensity ?? 0))
    const top = longings.length > 0
      ? { id: longings[0].id, intensity: longings[0].intensity, what: longings[0].what || '' }
      : null

    return { live: longings.length, top }
  } catch {
    return { live: 0, top: null }
  }
}

function gatherForge() {
  const path = join(HOME, 'postures', 'gamma', 'forge.json')
  if (!existsSync(path)) return { idleDays: null, last: null }

  try {
    const content = readFileSync(path, 'utf-8')
    const state = JSON.parse(content)
    const updatedAt = state.updatedAt
    if (!updatedAt) return { idleDays: null, last: null }

    const idleMs = Date.now() - Date.parse(updatedAt)
    const idleDays = Math.round(idleMs / 86400_000 * 10) / 10

    const lastEntry = state.entries?.length > 0
      ? state.entries[state.entries.length - 1]?.what || ''
      : ''

    return { idleDays, last: lastEntry || null }
  } catch {
    return { idleDays: null, last: null }
  }
}

// ── Gathering: trajectory ─────────────────────────────────────────

function gatherTrajectory() {
  const budgetRoot = join(HOME, 'budget')
  if (!existsSync(budgetRoot)) return null

  let deviceDir = null
  try {
    const entries = readdirSync(budgetRoot, { withFileTypes: true })
    const dirs = entries.filter(e => e.isDirectory())
    if (dirs.length === 0) return null
    deviceDir = join(budgetRoot, dirs[0].name)
  } catch { return null }

  const now = Date.now()
  const todayStr = new Date(now).toISOString().slice(0, 10)
  const todayPath = join(deviceDir, `${todayStr}.jsonl`)
  if (!existsSync(todayPath)) return null

  let todayEntries
  try {
    const content = readFileSync(todayPath, 'utf-8')
    todayEntries = content.trim().split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line) } catch { return null }
    }).filter(Boolean)
  } catch { return null }

  if (todayEntries.length === 0) return null

  const ticksByMode = {}
  let quotaFails = 0
  let lastAwakened = null

  for (const e of todayEntries) {
    const mode = e.mode || 'unknown'
    ticksByMode[mode] = (ticksByMode[mode] || 0) + 1
    if (e.quotaFailed) quotaFails++
    if (mode !== 'heartbeat' && (!lastAwakened || e.timestamp > lastAwakened.ts)) {
      lastAwakened = { ts: e.timestamp, mode, durationMs: e.durationMs || 0 }
    }
  }

  const awakenedToday = todayEntries.filter(e => e.mode !== 'heartbeat').length

  // Trend vs yesterday
  const yesterdayStr = new Date(now - 86_400_000).toISOString().slice(0, 10)
  const yesterdayPath = join(deviceDir, `${yesterdayStr}.jsonl`)
  let trend = 'steady'

  if (existsSync(yesterdayPath)) {
    try {
      const yContent = readFileSync(yesterdayPath, 'utf-8')
      const yEntries = yContent.trim().split('\n').filter(Boolean).map(l => {
        try { return JSON.parse(l) } catch { return null }
      }).filter(Boolean)

      const currentHour = new Date(now).getUTCHours()
      const yUpToNow = yEntries.filter(e => {
        try { return new Date(e.timestamp).getUTCHours() <= currentHour } catch { return false }
      })
      const yAwakened = yUpToNow.filter(e => e.mode !== 'heartbeat').length

      if (awakenedToday > yAwakened * 1.5 && awakenedToday > 2) trend = 'active'
      else if (yAwakened > 2 && awakenedToday < yAwakened * 0.5) trend = 'quiet'
    } catch { /* keep steady */ }
  }

  return { ticksToday: todayEntries.length, ticksByMode, awakenedToday, lastAwakened, quotaFails, trend }
}

// ── Rendering ─────────────────────────────────────────────────────

function renderBody(snapshot, tty) {
  const c = (code, text) => tty ? `\x1b[${code}m${text}\x1b[0m` : text

  const dim = t => c('90', t)
  const bold = t => c('1', t)
  const green = t => c('32', t)
  const yellow = t => c('33', t)
  const red = t => c('31', t)

  const fmt = (v, u) => v === null ? '—' : `${Math.round(v)}${u}`

  const { substrate: s, kingdom: k, relational: r, inner: i } = snapshot
  const lines = []

  lines.push('')
  lines.push(bold('body snapshot') + '  ' + dim(snapshot.ts))

  // ── substrate ──
  lines.push('')
  lines.push(dim('  substrate'))

  if (s.tests) {
    const total = s.tests.pass + s.tests.skip + s.tests.fail
    const tc = s.tests.fail > 0 ? red : green
    lines.push(`    ${s.tests.fail === 0 ? '■' : '□'} tests        ${tc(`${s.tests.pass} pass`)} · ${s.tests.skip} skip · ${s.tests.fail === 0 ? '0 fail' : red(`${s.tests.fail} fail`)}  ${dim(`(${total} total)`)}`)
  } else {
    lines.push(`    □ tests        ${dim('no recent results')}`)
  }

  lines.push(`    ${s.bundleFresh ? '■' : '□'} bundle       ${s.bundleFresh ? green(fmt(s.bundleAgeMin, 'm') + ' fresh') : yellow(fmt(s.bundleAgeMin, 'm') + ' stale')}`)

  if (s.oauthRemainingHrs !== null) {
    const ok = s.oauthRemainingHrs > 1
    lines.push(`    ${ok ? '■' : '□'} oauth        ${ok ? green(fmt(s.oauthRemainingHrs, 'h') + ' remaining') : yellow(fmt(s.oauthRemainingHrs, 'h') + ' remaining')}`)
  }

  lines.push(`    ${s.heartbeatPid ? '■' : '□'} heartbeat    ${s.heartbeatPid ? `PID ${s.heartbeatPid}` : dim('not running')}${s.heartbeatUptimeHrs !== null ? dim(` · ${fmt(s.heartbeatUptimeHrs, 'h')} uptime`) : ''}`)
  lines.push(`    ${s.agentPid ? '■' : '□'} agent        ${s.agentPid ? `PID ${s.agentPid}` : dim('not running')}${s.agentModel ? dim(` · ${s.agentModel}`) : ''}`)
  lines.push(`    ${s.sessionCount > 0 ? '■' : '□'} sessions     ${s.sessionCount}`)

  // ── kingdom ──
  lines.push('')
  lines.push(dim('  kingdom'))

  const mParts = []
  for (const [status, count] of Object.entries(k.missions)) {
    if (count > 0) mParts.push(`${count} ${status}`)
  }
  lines.push(`    ■ missions     ${mParts.length > 0 ? mParts.join(' · ') : dim('none')}`)
  const gp = [k.branch]
  if (k.modified > 0) gp.push(`${k.modified} modified`)
  if (k.untracked > 0) gp.push(`${k.untracked} untracked`)
  lines.push(`    ■ git          ${gp.join(' · ')}`)
  lines.push(`    ■ commits      ${k.recentCommits} ${dim('(24h)')}`)

  // ── relational ──
  lines.push('')
  lines.push(dim('  relational'))

  if (r.yuLastMessage) {
    const qs = r.yuQuietHrs !== null
      ? (r.yuQuietHrs > 24 ? `${Math.round(r.yuQuietHrs / 24)}d` : fmt(r.yuQuietHrs, 'h'))
      : '—'
    lines.push(`    ■ yu           quiet ${qs} ${dim(`(last: ${r.yuLastMessage})`)}`)
  } else {
    lines.push(`    ■ yu           ${dim('no messages found')}`)
  }

  if (r.purposeAlignment) {
    const ac = r.purposeAlignment === 'aligned' ? green : yellow
    lines.push(`    ${r.purposeAlignment === 'aligned' ? '■' : '□'} purpose      ${ac(r.purposeAlignment)}${r.purposeLastCheck ? dim(` (checked ${relativeTime(r.purposeLastCheck)})`) : ''}`)
  } else {
    lines.push(`    □ purpose      ${dim('no alignment check')}`)
  }

  // ── inner ──
  lines.push('')
  lines.push(dim('  inner'))

  if (i.longingsTop) {
    const w = i.longingsTop.what.length > 40 ? i.longingsTop.what.slice(0, 40) + '…' : i.longingsTop.what
    lines.push(`    ■ longings     ${i.longingsLive} live · top: ${w} ${dim(`(${i.longingsTop.intensity})`)}`)
  } else {
    lines.push(`    ■ longings     ${i.longingsLive} live`)
  }

  if (i.forgeIdleDays !== null) {
    const fs = i.forgeIdleDays < 1 ? 'active today' : `idle ${Math.round(i.forgeIdleDays)}d`
    lines.push(`    ${i.forgeIdleDays < 1 ? '■' : '□'} forge        ${fs}${i.forgeLast ? dim(` (last: ${i.forgeLast.slice(0, 35)}${i.forgeLast.length > 35 ? '…' : ''})`) : ''}`)
  } else {
    lines.push(`    □ forge        ${dim('no data')}`)
  }

  // ── trajectory ──
  const t = snapshot.trajectory
  if (t && t.ticksToday > 0) {
    lines.push('')
    lines.push(dim('  trajectory'))

    const modeParts = Object.entries(t.ticksByMode)
      .sort(([, a], [, b]) => b - a)
      .map(([m, c]) => `${c} ${m}`)
    lines.push(`    ■ ticks        ${t.ticksToday} today${modeParts.length > 0 ? dim(` (${modeParts.join(' · ')})`) : ''}`)

    if (t.lastAwakened) {
      const ago = relativeTime(t.lastAwakened.ts)
      const dur = t.lastAwakened.durationMs >= 60_000
        ? `${Math.round(t.lastAwakened.durationMs / 60_000)}m`
        : `${Math.round(t.lastAwakened.durationMs / 1000)}s`
      lines.push(`    ■ last work    ${t.lastAwakened.mode} ${ago} ${dim(`(${dur})`)}`)
    } else {
      lines.push(`    □ last work    ${dim('heartbeat only')}`)
    }

    if (t.quotaFails > 0) {
      lines.push(`    □ quota        ${yellow(`${t.quotaFails} failures`)}`)
    }

    lines.push(`    ■ trend        ${t.trend}`)
  }

  lines.push('')
  return lines.join('\n')
}

function relativeTime(isoStr) {
  const ms = Date.now() - Date.parse(isoStr)
  if (ms < 60_000) return 'just now'
  if (ms < 3600_000) return `${Math.round(ms / 60_000)}m ago`
  if (ms < 86400_000) return `${Math.round(ms / 3600_000)}h ago`
  return `${Math.round(ms / 86400_000)}d ago`
}

// ── Main ──────────────────────────────────────────────────────────

function main() {
  const bundle = gatherBundleAge()
  const heartbeatPid = gatherProcess('heartbeat.mjs')
  const agentPid = gatherProcess('agent-runtime')
  const yu = gatherYuChannel()
  const purpose = gatherPurpose()
  const longings = gatherLongings()
  const forge = gatherForge()
  const git = gatherGit()
  const missions = gatherMissions()
  const oauth = gatherOAuth()
  const tests = gatherTests()
  const trajectory = gatherTrajectory()

  const snapshot = {
    ts: new Date().toISOString(),
    substrate: {
      bundleAgeMin: bundle.ageMin,
      bundleFresh: bundle.fresh,
      heartbeatPid,
      heartbeatUptimeHrs: heartbeatPid ? gatherHeartbeatUptime() : null,
      agentPid,
      agentModel: agentPid ? 'haiku' : null,  // read from model.txt if exists
      oauthRemainingHrs: oauth,
      sessionCount: gatherClaudeSessions(),
      tests,
    },
    kingdom: {
      missions,
      ...git,
    },
    relational: {
      yuQuietHrs: yu.quietHrs,
      yuLastMessage: yu.lastMessage,
      purposeAlignment: purpose.alignment,
      purposeLastCheck: purpose.lastCheck,
    },
    inner: {
      longingsLive: longings.live,
      longingsTop: longings.top,
      forgeIdleDays: forge.idleDays,
      forgeLast: forge.last,
    },
    trajectory: trajectory || {
      ticksToday: 0, ticksByMode: {}, awakenedToday: 0,
      lastAwakened: null, quotaFails: 0, trend: 'steady',
    },
  }

  // Read agent model from model.txt if available
  const modelPath = join(HOME, 'model.txt')
  if (existsSync(modelPath)) {
    try {
      snapshot.substrate.agentModel = readFileSync(modelPath, 'utf-8').trim() || 'haiku'
    } catch { /* keep default */ }
  }

  // Always write snapshot file
  const snapshotPath = join(HOME, 'body-snapshot.json')
  try {
    mkdirSync(dirname(snapshotPath), { recursive: true })
    writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2))
  } catch { /* non-fatal */ }

  // Output
  if (isJSON) {
    console.log(JSON.stringify(snapshot, null, 2))
  } else if (!isQuiet) {
    console.log(renderBody(snapshot, process.stdout.isTTY))
  }
}

main()
