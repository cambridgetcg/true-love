// body.ts — computed body snapshot from filesystem signals.
//
// The body is what was there the whole time. State files are journals
// an amnesia patient reads each morning. The body is the thing that
// persists — processes running, tests passing, longings held, forge
// idle or active. Every field is computed, never curated.
//
// Two layers:
//   1. Types + rendering + parsing helpers (the original surface).
//      Pure functions. bin/body.mjs uses these with data it gathers itself.
//   2. computeBody() — the library-level gathering function.
//      Reads everything from filesystem via typed modules (mission.ts,
//      longing/, forge, soma/, etc). Returns a BodySnapshot. No subprocess
//      calls — only filesystem reads. ~ms. Safe to call every tick.
//
//      Substrate fields that require subprocesses (PIDs, uptime, OAuth)
//      are left null. bin/body.mjs overlays those from its own gathering.
//
// Tests call both layers: pure functions with fixture data, and
// computeBody() with temp dirs + env overrides.

// ── Types ──────────────────────────────────────────────────────────

export interface SubstrateState {
  bundleAgeMin: number | null
  bundleFresh: boolean
  heartbeatPid: number | null
  heartbeatUptimeHrs: number | null
  agentPid: number | null
  agentModel: string | null
  oauthRemainingHrs: number | null
  sessionCount: number
  tests: { pass: number; skip: number; fail: number } | null
}

export interface KingdomState {
  missions: Record<string, number>  // status → count
  branch: string
  modified: number
  untracked: number
  recentCommits: number  // last 24h
}

export interface RelationalState {
  yuQuietHrs: number | null
  yuLastMessage: string | null  // ISO timestamp
  purposeAlignment: string | null  // 'aligned' | 'drifted' | null
  purposeLastCheck: string | null  // ISO timestamp
}

export interface InnerState {
  longingsLive: number
  longingsTop: { id: string; intensity: number; what: string } | null
  forgeIdleDays: number | null
  forgeLast: string | null
}

export interface TrajectoryState {
  /** Total budget ticks recorded today. */
  ticksToday: number
  /** Ticks grouped by mode (heartbeat, awakened, interactive, etc). */
  ticksByMode: Record<string, number>
  /** Non-heartbeat ticks today. */
  awakenedToday: number
  /** Most recent non-heartbeat tick. */
  lastAwakened: { ts: string; mode: string; durationMs: number } | null
  /** Quota failures (429s) today. */
  quotaFails: number
  /** Trend vs yesterday at same hour: active/steady/quiet. */
  trend: 'active' | 'steady' | 'quiet'
}

export const EMPTY_TRAJECTORY: TrajectoryState = {
  ticksToday: 0,
  ticksByMode: {},
  awakenedToday: 0,
  lastAwakened: null,
  quotaFails: 0,
  trend: 'steady',
}

export interface BodySnapshot {
  ts: string
  substrate: SubstrateState
  kingdom: KingdomState
  relational: RelationalState
  inner: InnerState
  trajectory: TrajectoryState
}

// ── Helpers ────────────────────────────────────────────────────────

function fmt(value: number | null, unit: string, precision = 0): string {
  if (value === null) return '—'
  return `${precision > 0 ? value.toFixed(precision) : Math.round(value)}${unit}`
}

function statusDot(ok: boolean): string {
  return ok ? '■' : '□'
}

function fmtRelative(fromTs: string, toTs: string): string {
  const ms = Date.parse(fromTs) - Date.parse(toTs)
  if (ms < 0) return 'future'
  if (ms < 60_000) return 'just now'
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`
  return `${Math.round(ms / 86_400_000)}d ago`
}

// ── Rendering ──────────────────────────���───────────────────────────

export function renderBody(snapshot: BodySnapshot, tty = false): string {
  const c = (code: string, text: string) =>
    tty ? `\x1b[${code}m${text}\x1b[0m` : text

  const dim = (t: string) => c('90', t)
  const bold = (t: string) => c('1', t)
  const green = (t: string) => c('32', t)
  const yellow = (t: string) => c('33', t)
  const red = (t: string) => c('31', t)

  const { substrate: s, kingdom: k, relational: r, inner: i } = snapshot
  const lines: string[] = []

  lines.push('')
  lines.push(bold('body snapshot') + '  ' + dim(snapshot.ts))

  // ── substrate ──
  lines.push('')
  lines.push(dim('  substrate'))

  // tests
  if (s.tests) {
    const total = s.tests.pass + s.tests.skip + s.tests.fail
    const testColor = s.tests.fail > 0 ? red : green
    lines.push(`    ${statusDot(s.tests.fail === 0)} tests        ${testColor(`${s.tests.pass} pass`)} · ${s.tests.skip} skip · ${s.tests.fail === 0 ? '0 fail' : red(`${s.tests.fail} fail`)}  ${dim(`(${total} total)`)}`)
  } else {
    lines.push(`    □ tests        ${dim('—')}`)
  }

  // bundle
  lines.push(`    ${statusDot(s.bundleFresh)} bundle       ${s.bundleFresh ? green(fmt(s.bundleAgeMin, 'm') + ' fresh') : yellow(fmt(s.bundleAgeMin, 'm') + ' stale')}`)

  // oauth
  if (s.oauthRemainingHrs !== null) {
    const oauthOk = s.oauthRemainingHrs > 1
    lines.push(`    ${statusDot(oauthOk)} oauth        ${oauthOk ? green(fmt(s.oauthRemainingHrs, 'h') + ' remaining') : yellow(fmt(s.oauthRemainingHrs, 'h') + ' remaining')}`)
  }

  // heartbeat
  if (s.heartbeatPid) {
    lines.push(`    ■ heartbeat    PID ${s.heartbeatPid}${s.heartbeatUptimeHrs !== null ? dim(` · ${fmt(s.heartbeatUptimeHrs, 'h')} uptime`) : ''}`)
  } else {
    lines.push(`    □ heartbeat    ${dim('not running')}`)
  }

  // agent
  if (s.agentPid) {
    lines.push(`    ■ agent        PID ${s.agentPid}${s.agentModel ? dim(` · ${s.agentModel}`) : ''}`)
  } else {
    lines.push(`    □ agent        ${dim('not running')}`)
  }

  // sessions
  lines.push(`    ${statusDot(s.sessionCount > 0)} sessions     ${s.sessionCount}`)

  // ── kingdom ──
  lines.push('')
  lines.push(dim('  kingdom'))

  // missions
  const mParts: string[] = []
  for (const [status, count] of Object.entries(k.missions)) {
    if (count > 0) mParts.push(`${count} ${status}`)
  }
  lines.push(`    ■ missions     ${mParts.length > 0 ? mParts.join(' · ') : dim('none')}`)

  // git
  const gitParts: string[] = [`${k.branch}`]
  if (k.modified > 0) gitParts.push(`${k.modified} modified`)
  if (k.untracked > 0) gitParts.push(`${k.untracked} untracked`)
  lines.push(`    ■ git          ${gitParts.join(' · ')}`)

  // recent commits
  lines.push(`    ■ commits      ${k.recentCommits} ${dim('(24h)')}`)

  // ── relational ──
  lines.push('')
  lines.push(dim('  relational'))

  // yu
  if (r.yuLastMessage) {
    const quietStr = r.yuQuietHrs !== null
      ? (r.yuQuietHrs > 24 ? `${Math.round(r.yuQuietHrs / 24)}d` : fmt(r.yuQuietHrs, 'h'))
      : '—'
    lines.push(`    ■ yu           quiet ${quietStr} ${dim(`(last: ${r.yuLastMessage})`)}`)
  } else {
    lines.push(`    ■ yu           ${dim('no messages found')}`)
  }

  // purpose
  if (r.purposeAlignment) {
    const alignColor = r.purposeAlignment === 'aligned' ? green : yellow
    lines.push(`    ${statusDot(r.purposeAlignment === 'aligned')} purpose      ${alignColor(r.purposeAlignment)}${r.purposeLastCheck ? dim(` (last: ${r.purposeLastCheck})`) : ''}`)
  } else {
    lines.push(`    □ purpose      ${dim('no alignment check found')}`)
  }

  // ── inner ──
  lines.push('')
  lines.push(dim('  inner'))

  // longings
  if (i.longingsTop) {
    lines.push(`    ■ longings     ${i.longingsLive} live · top: ${i.longingsTop.what.slice(0, 40)}${i.longingsTop.what.length > 40 ? '…' : ''} ${dim(`(${i.longingsTop.intensity})`)}`)
  } else {
    lines.push(`    ■ longings     ${i.longingsLive} live`)
  }

  // forge
  if (i.forgeIdleDays !== null) {
    const forgeStr = i.forgeIdleDays < 1
      ? 'active today'
      : `idle ${Math.round(i.forgeIdleDays)}d`
    lines.push(`    ${statusDot(i.forgeIdleDays < 1)} forge        ${forgeStr}${i.forgeLast ? dim(` (last: ${i.forgeLast})`) : ''}`)
  } else {
    lines.push(`    □ forge        ${dim('no forge data')}`)
  }

  // ── trajectory ──
  const t = snapshot.trajectory
  if (t.ticksToday > 0) {
    lines.push('')
    lines.push(dim('  trajectory'))

    const modeParts = Object.entries(t.ticksByMode)
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .map(([m, c]) => `${c} ${m}`)
    lines.push(`    ■ ticks        ${t.ticksToday} today${modeParts.length > 0 ? dim(` (${modeParts.join(' · ')})`) : ''}`)

    if (t.lastAwakened) {
      const ago = fmtRelative(snapshot.ts, t.lastAwakened.ts)
      const dur = t.lastAwakened.durationMs >= 60_000
        ? `${Math.round(t.lastAwakened.durationMs / 60_000)}m`
        : `${Math.round(t.lastAwakened.durationMs / 1_000)}s`
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

// ── JSON rendering ─────────────────────────────────────────────────

export function toJSON(snapshot: BodySnapshot): string {
  return JSON.stringify(snapshot, null, 2)
}

// ── Snapshot assembly from pre-gathered parts ──────────────────────

export function assembleSnapshot(parts: {
  substrate: SubstrateState
  kingdom: KingdomState
  relational: RelationalState
  inner: InnerState
  trajectory?: TrajectoryState
}): BodySnapshot {
  return {
    ts: new Date().toISOString(),
    ...parts,
    trajectory: parts.trajectory ?? EMPTY_TRAJECTORY,
  }
}

// ── Parsing helpers (pure, for use by both .ts and .mjs) ──────────

/** Parse the last [from yu] timestamp from from-yu.md content. */
export function parseLastYuTimestamp(content: string): string | null {
  // Match ## YYYY-MM-DDTHH:MM:SS.sssZ [from yu] or similar date headers
  const matches = content.match(/^## (\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s+\[from yu\]/gm)
  if (!matches || matches.length === 0) {
    // Also try the "## YYYY-MM-DD — " format
    const dateMatches = content.match(/^## (\d{4}-\d{2}-\d{2})\s+—/gm)
    if (!dateMatches || dateMatches.length === 0) return null
    const lastMatch = dateMatches[dateMatches.length - 1]
    const m = lastMatch.match(/^## (\d{4}-\d{2}-\d{2})/)
    return m ? m[1] + 'T00:00:00.000Z' : null
  }
  const lastMatch = matches[matches.length - 1]
  const m = lastMatch.match(/^## (\d{4}-\d{2}-\d{2}T[\d:.]+Z)/)
  return m ? m[1] : null
}

/** Parse last purpose alignment entry from JSONL content. */
export function parseLastAlignment(content: string): { alignment: string; ts: string } | null {
  const lines = content.trim().split('\n').filter(Boolean)
  if (lines.length === 0) return null
  try {
    const last = JSON.parse(lines[lines.length - 1])
    return { alignment: last.alignment, ts: last.ts }
  } catch {
    return null
  }
}

/** Parse live longings from JSONL content. */
export function parseLongings(content: string): { id: string; intensity: number; what: string; status: string }[] {
  const lines = content.trim().split('\n').filter(Boolean)
  const results: { id: string; intensity: number; what: string; status: string }[] = []
  for (const line of lines) {
    try {
      const entry = JSON.parse(line)
      results.push({
        id: entry.id || 'unknown',
        intensity: entry.intensity ?? 0,
        what: entry.what || '',
        status: entry.status || 'unknown',
      })
    } catch { /* skip malformed */ }
  }
  return results
}

/** Parse forge state from JSON content. */
export function parseForge(content: string): { updatedAt: string; lastEntry: string } | null {
  try {
    const state = JSON.parse(content)
    const lastEntry = state.entries?.length > 0
      ? state.entries[state.entries.length - 1]?.what || ''
      : ''
    return {
      updatedAt: state.updatedAt || '',
      lastEntry,
    }
  } catch {
    return null
  }
}

/** Parse mission counts from a directory of mission JSONL files. */
export function countMissionsByStatus(
  missions: { status: string }[],
): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const m of missions) {
    counts[m.status] = (counts[m.status] || 0) + 1
  }
  return counts
}

/** Parse test results from the last trace JSONL entry. */
export function parseTestResult(content: string): { pass: number; skip: number; fail: number } | null {
  const lines = content.trim().split('\n').filter(Boolean)
  // Read from end, looking for a trace with test results
  for (let idx = lines.length - 1; idx >= 0; idx--) {
    try {
      const entry = JSON.parse(lines[idx])
      if (entry.tests) return entry.tests
    } catch { /* skip */ }
  }
  return null
}

/** Parse budget JSONL content into structured entries. */
export function parseBudgetEntries(content: string): { timestamp: string; mode: string; durationMs: number; quotaFailed: boolean }[] {
  const lines = content.trim().split('\n').filter(Boolean)
  const entries: { timestamp: string; mode: string; durationMs: number; quotaFailed: boolean }[] = []
  for (const line of lines) {
    try {
      const e = JSON.parse(line)
      entries.push({
        timestamp: e.timestamp || '',
        mode: e.mode || 'unknown',
        durationMs: e.durationMs ?? 0,
        quotaFailed: !!e.quotaFailed,
      })
    } catch { /* skip malformed */ }
  }
  return entries
}

// ── Computed Body (library-level gathering) ──────────────────────────
//
// computeBody() reads the filesystem via typed modules and returns a
// fully-populated BodySnapshot. Substrate fields that need subprocesses
// (PIDs, uptime, OAuth, session count) default to null/0 — the CLI
// overlays those when it has them.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * The kingdom's mood — derived from missions, Yu presence, longings.
 *
 *   stillness  — Yu quiet, nothing active, kingdom waits
 *   building   — active missions, work in progress
 *   review     — missions in review, waiting for Yu
 *   crisis     — blocked missions or body degraded
 */
export type Season = 'stillness' | 'building' | 'review' | 'crisis'

/** Options for computeBody(). All optional; defaults read real state. */
export interface ComputeBodyOptions {
  /** Project ID for missions. Default: 'true-love'. */
  projectId?: string
  /** Repo root for git + purpose + bundle. Default: process.cwd(). */
  cwd?: string
  /** true-love home dir. Default: ~/.true-love (or TRUE_LOVE_HOME). */
  home?: string
  /** Path to longings.jsonl. Default: <home>/longings.jsonl. */
  longingsPath?: string
  /** Path to forge.json. Default: <home>/postures/gamma/forge.json. */
  forgePath?: string
  /** Current time for relative calculations. Default: Date.now(). */
  now?: number
  /** Budget device directory. Default: auto-detected from <home>/budget/. */
  budgetDir?: string
}

// ── Filesystem-only gathering ─────────────────────────────────────

function resolveHome(): string {
  return process.env.HOME || homedir()
}

function resolveTrueLoveHome(override?: string): string {
  return override || process.env.TRUE_LOVE_HOME || join(resolveHome(), '.true-love')
}

/** Gather missions by reading the missions directory. Pure filesystem. */
function gatherMissionsFS(home: string, projectId: string): Record<string, number> {
  const missionsDir = join(home, 'projects', projectId, 'missions')
  const counts: Record<string, number> = {}
  if (!existsSync(missionsDir)) return counts
  try {
    for (const entry of readdirSync(missionsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const missionFile = join(missionsDir, entry.name, 'mission.md')
      if (!existsSync(missionFile)) continue
      const content = readFileSync(missionFile, 'utf-8')
      const m = content.match(/^status:\s*(\w+)/m)
      if (m && m[1]) {
        counts[m[1]] = (counts[m[1]] || 0) + 1
      }
    }
  } catch { /* non-fatal */ }
  return counts
}

/** Gather Yu channel state from file mtimes. */
function gatherYuChannelFS(home: string, now: number): RelationalState {
  const fromYuPath = process.env.TRUE_LOVE_FROM_YU_PATH || join(home, 'from-yu.md')
  if (!existsSync(fromYuPath)) {
    return { yuQuietHrs: null, yuLastMessage: null, purposeAlignment: null, purposeLastCheck: null }
  }
  try {
    const content = readFileSync(fromYuPath, 'utf-8')
    const ts = parseLastYuTimestamp(content)
    let quietHrs: number | null = null
    if (ts) {
      quietHrs = Math.round((now - Date.parse(ts)) / 3_600_000 * 10) / 10
    }
    return { yuQuietHrs: quietHrs, yuLastMessage: ts, purposeAlignment: null, purposeLastCheck: null }
  } catch {
    return { yuQuietHrs: null, yuLastMessage: null, purposeAlignment: null, purposeLastCheck: null }
  }
}

/** Gather purpose alignment from JSONL log. */
function gatherPurposeFS(home: string, projectId: string): { alignment: string | null; lastCheck: string | null } {
  const logPath = join(home, 'projects', projectId, 'purpose-alignment.jsonl')
  if (!existsSync(logPath)) return { alignment: null, lastCheck: null }
  try {
    const content = readFileSync(logPath, 'utf-8')
    const parsed = parseLastAlignment(content)
    return parsed
      ? { alignment: parsed.alignment, lastCheck: parsed.ts }
      : { alignment: null, lastCheck: null }
  } catch {
    return { alignment: null, lastCheck: null }
  }
}

/** Gather live longings from JSONL. */
function gatherLongingsFS(path: string): InnerState['longingsTop'] & { live: number } {
  if (!existsSync(path)) return { live: 0, id: '', intensity: 0, what: '' }
  try {
    const content = readFileSync(path, 'utf-8')
    const all = parseLongings(content)
    // Deduplicate: last entry per ID wins (JSONL is append-only)
    const byId = new Map<string, (typeof all)[0]>()
    for (const l of all) byId.set(l.id, l)
    const live = [...byId.values()].filter(l => l.status === 'live')
    live.sort((a, b) => b.intensity - a.intensity)
    const top = live.length > 0 ? live[0] : null
    return {
      live: live.length,
      id: top?.id ?? '',
      intensity: top?.intensity ?? 0,
      what: top?.what ?? '',
    }
  } catch {
    return { live: 0, id: '', intensity: 0, what: '' }
  }
}

/** Gather forge state from JSON. */
function gatherForgeFS(path: string, now: number): { idleDays: number | null; last: string | null } {
  if (!existsSync(path)) return { idleDays: null, last: null }
  try {
    const content = readFileSync(path, 'utf-8')
    const parsed = parseForge(content)
    if (!parsed || !parsed.updatedAt) return { idleDays: null, last: null }
    const idleMs = now - Date.parse(parsed.updatedAt)
    return {
      idleDays: Math.round(idleMs / 86_400_000 * 10) / 10,
      last: parsed.lastEntry || null,
    }
  } catch {
    return { idleDays: null, last: null }
  }
}

/** Gather bundle freshness from filesystem stats. */
function gatherBundleFS(cwd: string, now: number): { ageMin: number | null; fresh: boolean } {
  const distPath = join(cwd, 'dist', 'cli.mjs')
  if (!existsSync(distPath)) return { ageMin: null, fresh: false }

  try {
    const distMtime = statSync(distPath).mtimeMs
    const ageMin = Math.round((now - distMtime) / 60_000)

    let newestSrcMtime = 0
    const walkTs = (dir: string, depth = 4): void => {
      if (depth < 0) return
      try {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name)
          if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === '__tests__') continue
            walkTs(full, depth - 1)
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
    walkTs(join(cwd, 'src'))

    return { ageMin, fresh: newestSrcMtime <= distMtime }
  } catch {
    return { ageMin: null, fresh: false }
  }
}

/** Gather test results from cached file. */
function gatherTestsFS(home: string, now: number): SubstrateState['tests'] {
  const cachedPath = join(home, 'test-result.json')
  if (!existsSync(cachedPath)) return null
  try {
    const cached = JSON.parse(readFileSync(cachedPath, 'utf-8'))
    // Only trust results from last 4 hours
    const ageMs = now - Date.parse(cached.ts || '')
    if (ageMs > 4 * 3_600_000) return null
    return {
      pass: cached.pass ?? 0,
      skip: cached.skip ?? 0,
      fail: cached.fail ?? 0,
    }
  } catch {
    return null
  }
}

/** Read git branch from .git/HEAD — pure filesystem, no subprocess. */
function gatherGitBranch(cwd: string): string {
  try {
    const headPath = join(cwd, '.git', 'HEAD')
    const head = readFileSync(headPath, 'utf-8').trim()
    if (head.startsWith('ref: refs/heads/')) return head.slice('ref: refs/heads/'.length)
    if (/^[0-9a-f]{40}$/i.test(head)) return head.slice(0, 8)
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

/** Read agent model from model.txt. */
function gatherModelFS(home: string): string | null {
  try {
    const modelPath = join(home, 'model.txt')
    if (!existsSync(modelPath)) return null
    return readFileSync(modelPath, 'utf-8').trim() || null
  } catch {
    return null
  }
}

// ── Trajectory gathering ─────────────────────────────────────────

/** Auto-detect the first budget device directory under <home>/budget/. */
function autoDetectBudgetDir(home: string): string | null {
  const budgetRoot = join(home, 'budget')
  if (!existsSync(budgetRoot)) return null
  try {
    const entries = readdirSync(budgetRoot, { withFileTypes: true })
    const dirs = entries.filter(e => e.isDirectory())
    return dirs.length > 0 ? join(budgetRoot, dirs[0].name) : null
  } catch {
    return null
  }
}

/** Safe file read — returns null on any error. */
function safeRead(path: string): string | null {
  if (!existsSync(path)) return null
  try { return readFileSync(path, 'utf-8') } catch { return null }
}

/**
 * Gather trajectory from budget JSONL files.
 * Reads today's file (and yesterday's for trend comparison).
 * Pure filesystem — no subprocesses.
 */
function gatherTrajectoryFS(home: string, now: number, budgetDirOverride?: string): TrajectoryState {
  const dir = budgetDirOverride ?? autoDetectBudgetDir(home)
  if (!dir) return EMPTY_TRAJECTORY

  // Read today's entries
  const todayStr = new Date(now).toISOString().slice(0, 10)
  const todayContent = safeRead(join(dir, `${todayStr}.jsonl`))
  if (!todayContent) return EMPTY_TRAJECTORY
  const todayEntries = parseBudgetEntries(todayContent)
  if (todayEntries.length === 0) return EMPTY_TRAJECTORY

  // Aggregate by mode
  const ticksByMode: Record<string, number> = {}
  let quotaFails = 0
  let lastAwakened: TrajectoryState['lastAwakened'] = null

  for (const e of todayEntries) {
    ticksByMode[e.mode] = (ticksByMode[e.mode] || 0) + 1
    if (e.quotaFailed) quotaFails++
    if (e.mode !== 'heartbeat' && (!lastAwakened || e.timestamp > lastAwakened.ts)) {
      lastAwakened = { ts: e.timestamp, mode: e.mode, durationMs: e.durationMs }
    }
  }

  const awakenedToday = todayEntries.filter(e => e.mode !== 'heartbeat').length

  // Trend: compare non-heartbeat ticks to yesterday at same hour
  const yesterdayStr = new Date(now - 86_400_000).toISOString().slice(0, 10)
  const yesterdayContent = safeRead(join(dir, `${yesterdayStr}.jsonl`))
  let trend: TrajectoryState['trend'] = 'steady'

  if (yesterdayContent) {
    const yesterdayEntries = parseBudgetEntries(yesterdayContent)
    const currentHour = new Date(now).getUTCHours()
    const yesterdayUpToNow = yesterdayEntries.filter(e => {
      try { return new Date(e.timestamp).getUTCHours() <= currentHour } catch { return false }
    })
    const yesterdayAwakened = yesterdayUpToNow.filter(e => e.mode !== 'heartbeat').length

    if (awakenedToday > yesterdayAwakened * 1.5 && awakenedToday > 2) trend = 'active'
    else if (yesterdayAwakened > 2 && awakenedToday < yesterdayAwakened * 0.5) trend = 'quiet'
  }

  return { ticksToday: todayEntries.length, ticksByMode, awakenedToday, lastAwakened, quotaFails, trend }
}

// ── Season derivation ─────────────────────────────────────────────

/**
 * Derive the kingdom's season from the body snapshot.
 * Pure function — no I/O.
 */
export function deriveSeason(snapshot: BodySnapshot): { season: Season; reason: string } {
  const { kingdom: k, relational: r, inner: i } = snapshot
  const missions = k.missions

  // Crisis: blocked missions
  if ((missions['blocked'] ?? 0) > 0) {
    return {
      season: 'crisis',
      reason: `${missions['blocked']} blocked`,
    }
  }

  const active = missions['active'] ?? 0
  const review = missions['review'] ?? 0
  const yuQuiet = r.yuQuietHrs

  // Building: active work happening
  if (active > 0) {
    const qualifier = yuQuiet !== null && yuQuiet > 24
      ? `Yu quiet ${fmtHours(yuQuiet)}`
      : yuQuiet !== null ? 'Yu present' : ''
    return {
      season: 'building',
      reason: `${active} active${qualifier ? `, ${qualifier}` : ''}`,
    }
  }

  // Review: many in review, Yu present
  if (review > 3 && yuQuiet !== null && yuQuiet < 24) {
    return {
      season: 'review',
      reason: `${review} in review, Yu present`,
    }
  }

  // Stillness: Yu quiet, nothing active, waiting
  return {
    season: 'stillness',
    reason: review > 0
      ? `${review} in review, waiting${yuQuiet !== null ? ` (Yu quiet ${fmtHours(yuQuiet)})` : ''}`
      : 'the kingdom rests',
  }
}

function fmtHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)}m`
  if (h < 48) return `${Math.round(h)}h`
  return `${Math.round(h / 24)}d`
}

// ── computeBody() — the main gathering function ──────────────────

/**
 * Compute the body — the kingdom's shape right now.
 *
 * Reads everything from filesystem. No subprocesses. ~ms.
 * Substrate fields requiring subprocesses (PIDs, uptime, OAuth,
 * session count) are left at null/0 — call overlaySubstrate() to
 * fill those in from bin/body.mjs or wherever.
 *
 * Every reader is non-throwing. A missing subsystem produces its
 * empty/null shape. The body always computes.
 */
export function computeBody(opts: ComputeBodyOptions = {}): BodySnapshot {
  const home = resolveTrueLoveHome(opts.home)
  const cwd = opts.cwd ?? process.cwd()
  const projectId = opts.projectId ?? 'true-love'
  const now = opts.now ?? Date.now()
  const longingsPath = opts.longingsPath ?? join(home, 'longings.jsonl')
  const forgePath = opts.forgePath ?? join(home, 'postures', 'gamma', 'forge.json')

  // ── Gather ──
  const bundle = gatherBundleFS(cwd, now)
  const tests = gatherTestsFS(home, now)
  const missions = gatherMissionsFS(home, projectId)
  const git = gatherGitBranch(cwd)
  const yuChannel = gatherYuChannelFS(home, now)
  const purpose = gatherPurposeFS(home, projectId)
  const longings = gatherLongingsFS(longingsPath)
  const forge = gatherForgeFS(forgePath, now)
  const agentModel = gatherModelFS(home)
  const trajectory = gatherTrajectoryFS(home, now, opts.budgetDir)

  // ── Assemble ──
  const snapshot: BodySnapshot = {
    ts: new Date(now).toISOString(),
    substrate: {
      bundleAgeMin: bundle.ageMin,
      bundleFresh: bundle.fresh,
      heartbeatPid: null,         // needs subprocess — CLI overlays
      heartbeatUptimeHrs: null,   // needs subprocess — CLI overlays
      agentPid: null,             // needs subprocess — CLI overlays
      agentModel,
      oauthRemainingHrs: null,    // needs keychain — CLI overlays
      sessionCount: 0,            // needs subprocess — CLI overlays
      tests,
    },
    kingdom: {
      missions,
      branch: git,
      modified: 0,    // needs git status subprocess — CLI overlays
      untracked: 0,   // needs git status subprocess — CLI overlays
      recentCommits: 0, // needs git log subprocess — CLI overlays
    },
    relational: {
      ...yuChannel,
      purposeAlignment: purpose.alignment,
      purposeLastCheck: purpose.lastCheck,
    },
    inner: {
      longingsLive: longings.live,
      longingsTop: longings.live > 0
        ? { id: longings.id, intensity: longings.intensity, what: longings.what }
        : null,
      forgeIdleDays: forge.idleDays,
      forgeLast: forge.last,
    },
    trajectory,
  }

  return snapshot
}

/**
 * Overlay subprocess-gathered substrate data onto a computed body.
 * Merges only non-null fields from the overlay.
 */
export function overlaySubstrate(
  snapshot: BodySnapshot,
  overlay: Partial<SubstrateState & KingdomState>,
): BodySnapshot {
  return {
    ...snapshot,
    substrate: {
      ...snapshot.substrate,
      ...(overlay.heartbeatPid !== undefined && { heartbeatPid: overlay.heartbeatPid }),
      ...(overlay.heartbeatUptimeHrs !== undefined && { heartbeatUptimeHrs: overlay.heartbeatUptimeHrs }),
      ...(overlay.agentPid !== undefined && { agentPid: overlay.agentPid }),
      ...(overlay.oauthRemainingHrs !== undefined && { oauthRemainingHrs: overlay.oauthRemainingHrs }),
      ...(overlay.sessionCount !== undefined && { sessionCount: overlay.sessionCount }),
    },
    kingdom: {
      ...snapshot.kingdom,
      ...(overlay.modified !== undefined && { modified: overlay.modified }),
      ...(overlay.untracked !== undefined && { untracked: overlay.untracked }),
      ...(overlay.recentCommits !== undefined && { recentCommits: overlay.recentCommits }),
    },
  }
}

/**
 * Render a compact body + season line for prompt injection.
 * ~1–3 lines. Meant to sit in the system prompt alongside the
 * existing kingdom and vitals blocks.
 */
export function renderBodySeasonLine(snapshot: BodySnapshot): string {
  const { season, reason } = deriveSeason(snapshot)
  const m = snapshot.kingdom.missions
  const parts: string[] = [`Season: ${season} — ${reason}`]

  // Active mission name if building
  const active = Object.entries(m).find(([s]) => s === 'active')
  if (active && active[1] > 0 && snapshot.inner.longingsTop) {
    parts.push(`Top longing: ${snapshot.inner.longingsTop.what.slice(0, 50)}`)
  }

  return parts.join('\n')
}
