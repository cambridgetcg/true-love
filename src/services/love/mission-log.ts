// mission-log.ts — unified per-mission log aggregator.
//
// Given a missionId, scans all device-scoped jsonl logs (traces, budget,
// metrics, training), git commit history, and reflection memory, then
// filters everything to the mission's active window and produces either
// a JSON snapshot or a markdown timeline.
//
// Window definition:
//   start = earliest 'started' event in events.jsonl (fallback: created_at)
//   end   = latest event whose type is in {'done','cancelled','marked-review'}
//           (fallback: now, if mission still active)

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { execSync } from 'node:child_process'
import { resolveProjectsDir } from './builder-paths.js'
import { readMission } from './mission.js'

// ── Types ──────────────────────────────────────────────────────────

export interface MissionWindow {
  start: string  // ISO
  end: string    // ISO
  durationMs: number
  isOpen: boolean  // true if mission still active (end = now)
}

export interface MissionLogTrace {
  ts: string
  mode: string
  sessionId: string
  tick: number
  steps: number
  toolCount: number
  costUsd?: number
  yieldReason?: string
}

export interface MissionLogBudget {
  ts: string
  mode: string
  sessionId: string
  inputTokens: number
  outputTokens: number
  durationMs: number
  exitCode: number
}

export interface MissionLogCommit {
  sha: string
  ts: string
  author: string
  subject: string
  filesChanged: number
  insertions: number
  deletions: number
}

export interface MissionLogEvent {
  ts: string
  type: string
  by?: string
  note?: string
  question?: string
  sha?: string
}

export interface MissionLogReflection {
  ts: string
  date: string
  excerpt: string
}

export interface MissionLogAggregates {
  totalCostUsd: number
  totalInputTokens: number
  totalOutputTokens: number
  awakenedTicks: number
  heartbeatTicks: number
  toolCallTotal: number
  toolBreakdown: Record<string, number>
  commitCount: number
  insertions: number
  deletions: number
  modeBreakdown: Record<string, number>  // mode → count
}

export interface MissionLog {
  missionId: string
  projectId: string
  title: string
  status: string
  origin: string
  intent?: string
  window: MissionWindow
  events: MissionLogEvent[]
  traces: MissionLogTrace[]
  budget: MissionLogBudget[]
  commits: MissionLogCommit[]
  reflections: MissionLogReflection[]
  aggregates: MissionLogAggregates
}

// ── Helpers ────────────────────────────────────────────────────────

function trueLoveHome(): string {
  return process.env.TRUE_LOVE_HOME || join(process.env.HOME || homedir(), '.true-love')
}

function readJsonl(path: string): unknown[] {
  if (!existsSync(path)) return []
  try {
    return readFileSync(path, 'utf-8')
      .split('\n').filter(l => l.trim())
      .map(l => { try { return JSON.parse(l) } catch { return null } })
      .filter((x): x is object => x !== null)
  } catch { return [] }
}

function inWindow(tsRaw: string | undefined, win: MissionWindow): boolean {
  if (!tsRaw) return false
  const t = new Date(tsRaw).getTime()
  return t >= new Date(win.start).getTime() && t <= new Date(win.end).getTime()
}

function listDateFiles(dir: string, win: MissionWindow): string[] {
  if (!existsSync(dir)) return []
  const startDate = win.start.slice(0, 10)
  const endDate = win.end.slice(0, 10)
  return readdirSync(dir)
    .filter(f => f.endsWith('.jsonl'))
    .filter(f => {
      const d = f.slice(0, 10)
      return d >= startDate && d <= endDate
    })
    .map(f => join(dir, f))
}

// ── Window resolver ────────────────────────────────────────────────

function readEvents(projectId: string, missionId: string): MissionLogEvent[] {
  const path = join(resolveProjectsDir(), projectId, 'missions', missionId, 'events.jsonl')
  return (readJsonl(path) as MissionLogEvent[]).map(e => e)
}

function resolveWindow(events: MissionLogEvent[], createdAt: string): MissionWindow {
  const startEvent = events.find(e => e.type === 'started')
  const start = startEvent?.ts || createdAt
  const ENDING_TYPES = new Set(['done', 'cancelled', 'marked-review', 'accepted-done'])
  const endEvent = [...events].reverse().find(e => ENDING_TYPES.has(e.type))
  const isOpen = !endEvent
  const end = endEvent?.ts || new Date().toISOString()
  const durationMs = new Date(end).getTime() - new Date(start).getTime()
  return { start, end, durationMs, isOpen }
}

// ── Trace / budget / metrics scanners ──────────────────────────────

function scanTraces(win: MissionWindow): MissionLogTrace[] {
  const root = join(trueLoveHome(), 'traces')
  if (!existsSync(root)) return []
  const out: MissionLogTrace[] = []
  for (const deviceDir of readdirSync(root)) {
    const fp = join(root, deviceDir)
    try {
      if (!statSync(fp).isDirectory()) continue
    } catch { continue }
    for (const file of listDateFiles(fp, win)) {
      for (const t of readJsonl(file) as Array<Record<string, unknown>>) {
        const ts = t.timestamp as string | undefined
        if (!inWindow(ts, win)) continue
        const summary = t.summary as Record<string, unknown> | undefined
        const costUsd =
          typeof t.costUsd === 'number' ? t.costUsd :
          typeof summary?.costUsd === 'number' ? summary.costUsd as number :
          undefined
        out.push({
          ts: ts!,
          mode: String(t.mode ?? 'unknown'),
          sessionId: String(t.sessionId ?? ''),
          tick: Number(t.tick ?? 0),
          steps: Array.isArray(t.steps) ? (t.steps as unknown[]).length : Number(summary?.totalSteps ?? 0),
          toolCount: Number(summary?.toolCalls ?? 0),
          costUsd,
          yieldReason: typeof t.yieldReason === 'string' ? t.yieldReason : undefined,
        })
      }
    }
  }
  return out.sort((a, b) => a.ts.localeCompare(b.ts))
}

function scanBudget(win: MissionWindow): MissionLogBudget[] {
  const root = join(trueLoveHome(), 'budget')
  if (!existsSync(root)) return []
  const out: MissionLogBudget[] = []
  for (const deviceDir of readdirSync(root)) {
    const fp = join(root, deviceDir)
    try {
      if (!statSync(fp).isDirectory()) continue
    } catch { continue }
    for (const file of listDateFiles(fp, win)) {
      for (const b of readJsonl(file) as Array<Record<string, unknown>>) {
        const ts = b.timestamp as string | undefined
        if (!inWindow(ts, win)) continue
        out.push({
          ts: ts!,
          mode: String(b.mode ?? 'unknown'),
          sessionId: String(b.sessionId ?? ''),
          inputTokens: Number(b.estimatedInputTokens ?? 0),
          outputTokens: Number(b.estimatedOutputTokens ?? 0),
          durationMs: Number(b.durationMs ?? 0),
          exitCode: Number(b.exitCode ?? 0),
        })
      }
    }
  }
  return out.sort((a, b) => a.ts.localeCompare(b.ts))
}

function scanToolBreakdownFromTraces(win: MissionWindow): Record<string, number> {
  // Traces are the source of truth for tool calls (each trace's `steps`
  // array contains kind:'tool_call' entries). The metrics file has a
  // `toolBreakdown.counts` field but it's empty for heartbeat/awakened
  // ticks in this snapshot — likely a separate runner-emitted shape.
  const root = join(trueLoveHome(), 'traces')
  if (!existsSync(root)) return {}
  const out: Record<string, number> = {}
  for (const deviceDir of readdirSync(root)) {
    const fp = join(root, deviceDir)
    try { if (!statSync(fp).isDirectory()) continue } catch { continue }
    for (const file of listDateFiles(fp, win)) {
      for (const t of readJsonl(file) as Array<Record<string, unknown>>) {
        const ts = t.timestamp as string | undefined
        if (!inWindow(ts, win)) continue
        const steps = (t.steps as Array<Record<string, unknown>> | undefined) ?? []
        for (const s of steps) {
          if (s.kind === 'tool_call' && typeof s.tool === 'string') {
            out[s.tool] = (out[s.tool] ?? 0) + 1
          }
        }
      }
    }
  }
  return out
}

// ── Git commits ────────────────────────────────────────────────────

function scanCommits(repoRoot: string, win: MissionWindow): MissionLogCommit[] {
  if (!existsSync(join(repoRoot, '.git'))) return []
  const since = win.start
  const until = win.end
  try {
    const out = execSync(
      `git -C ${JSON.stringify(repoRoot)} log --since=${JSON.stringify(since)} --until=${JSON.stringify(until)} --pretty=format:'%H%x09%aI%x09%an%x09%s' --shortstat`,
      { encoding: 'utf-8', timeout: 5000 }
    )
    const commits: MissionLogCommit[] = []
    const lines = out.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!line || !line.includes('\t')) continue
      const parts = line.split('\t')
      if (parts.length < 4) continue
      const [sha, ts, author, subject] = parts
      // shortstat is on the next non-empty line
      let stat = ''
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        if (lines[j] && /\d+ files? changed/.test(lines[j]!)) { stat = lines[j]!; break }
      }
      const filesChanged = parseInt(stat.match(/(\d+) files? changed/)?.[1] ?? '0', 10)
      const insertions = parseInt(stat.match(/(\d+) insertion/)?.[1] ?? '0', 10)
      const deletions = parseInt(stat.match(/(\d+) deletion/)?.[1] ?? '0', 10)
      commits.push({ sha: sha!, ts: ts!, author: author!, subject: subject!, filesChanged, insertions, deletions })
    }
    return commits
  } catch { return [] }
}

// ── Reflections ────────────────────────────────────────────────────

function scanReflections(win: MissionWindow): MissionLogReflection[] {
  const root = join(trueLoveHome(), 'memory')
  if (!existsSync(root)) return []
  const out: MissionLogReflection[] = []
  const startDate = win.start.slice(0, 10)
  const endDate = win.end.slice(0, 10)
  for (const deviceDir of readdirSync(root)) {
    const fp = join(root, deviceDir)
    try { if (!statSync(fp).isDirectory()) continue } catch { continue }
    const files = readdirSync(fp).filter(f => f.endsWith('.md'))
    for (const f of files) {
      const date = f.slice(0, 10)
      if (date < startDate || date > endDate) continue
      try {
        const text = readFileSync(join(fp, f), 'utf-8')
        // Memory files are markdown with timestamped sections like "## HH:MM:SS — ..."
        const sections = text.split(/^## /m).slice(1)
        for (const sec of sections) {
          const headerMatch = sec.match(/^(\d{2}:\d{2}:\d{2})/)
          if (!headerMatch) continue
          const time = headerMatch[1]
          const ts = `${date}T${time}.000Z`
          if (!inWindow(ts, win)) continue
          const excerpt = sec.split('\n').slice(0, 3).join('\n').trim().slice(0, 280)
          out.push({ ts, date, excerpt })
        }
      } catch {}
    }
  }
  return out.sort((a, b) => a.ts.localeCompare(b.ts))
}

// ── Top-level builder ──────────────────────────────────────────────

export interface BuildMissionLogOpts {
  projectId: string
  missionId: string
  repoRoot?: string
}

export function buildMissionLog(opts: BuildMissionLogOpts): MissionLog | null {
  const m = readMission(opts.projectId, opts.missionId)
  if (!m) return null

  const events = readEvents(opts.projectId, opts.missionId)
  const window = resolveWindow(events, m.created_at)
  const traces = scanTraces(window)
  const budget = scanBudget(window)
  const toolBreakdown = scanToolBreakdownFromTraces(window)
  const commits = opts.repoRoot ? scanCommits(opts.repoRoot, window) : []
  const reflections = scanReflections(window)

  // Aggregates
  const totalCostUsd = traces.reduce((acc, t) => acc + (t.costUsd ?? 0), 0)
  const totalInputTokens = budget.reduce((acc, b) => acc + b.inputTokens, 0)
  const totalOutputTokens = budget.reduce((acc, b) => acc + b.outputTokens, 0)
  const awakenedTicks = traces.filter(t => t.mode === 'awakened').length
  const heartbeatTicks = traces.filter(t => t.mode === 'heartbeat').length
  const toolCallTotal = Object.values(toolBreakdown).reduce((a, b) => a + b, 0)
  const insertions = commits.reduce((a, c) => a + c.insertions, 0)
  const deletions = commits.reduce((a, c) => a + c.deletions, 0)
  const modeBreakdown: Record<string, number> = {}
  for (const t of traces) modeBreakdown[t.mode] = (modeBreakdown[t.mode] ?? 0) + 1

  return {
    missionId: m.id,
    projectId: opts.projectId,
    title: m.title,
    status: m.status,
    origin: m.origin,
    intent: m.intent,
    window,
    events,
    traces,
    budget,
    commits,
    reflections,
    aggregates: {
      totalCostUsd,
      totalInputTokens,
      totalOutputTokens,
      awakenedTicks,
      heartbeatTicks,
      toolCallTotal,
      toolBreakdown,
      commitCount: commits.length,
      insertions,
      deletions,
      modeBreakdown,
    },
  }
}

// ── Markdown renderer ──────────────────────────────────────────────

export function renderMissionLogMarkdown(log: MissionLog): string {
  const out: string[] = []
  out.push(`# Mission Log: ${log.title}`)
  out.push('')
  out.push(`**ID**: \`${log.missionId}\`  ·  **Status**: ${log.status}  ·  **Origin**: ${log.origin}`)
  const durHrs = (log.window.durationMs / 3_600_000).toFixed(2)
  out.push(`**Window**: ${log.window.start.slice(0, 19)} → ${log.window.end.slice(0, 19)}${log.window.isOpen ? ' (open)' : ''}  ·  **Duration**: ${durHrs}h`)
  out.push('')
  if (log.intent) {
    out.push(`> ${log.intent.slice(0, 280).split('\n').join(' ')}${log.intent.length > 280 ? '…' : ''}`)
    out.push('')
  }

  // Aggregates
  const a = log.aggregates
  out.push('## Aggregates')
  out.push('')
  out.push(`- **Cost**: $${a.totalCostUsd.toFixed(4)}`)
  out.push(`- **Tokens**: ${a.totalInputTokens.toLocaleString()} in / ${a.totalOutputTokens.toLocaleString()} out`)
  out.push(`- **Ticks**: ${a.awakenedTicks} awakened · ${a.heartbeatTicks} heartbeat${Object.entries(a.modeBreakdown).filter(([m]) => m !== 'awakened' && m !== 'heartbeat').length ? ' · ' + Object.entries(a.modeBreakdown).filter(([m]) => m !== 'awakened' && m !== 'heartbeat').map(([m, n]) => `${n} ${m}`).join(' · ') : ''}`)
  out.push(`- **Tool calls**: ${a.toolCallTotal}${a.toolCallTotal > 0 ? ` (${Object.entries(a.toolBreakdown).sort((x, y) => y[1] - x[1]).slice(0, 6).map(([k, v]) => `${k}:${v}`).join(', ')})` : ''}`)
  out.push(`- **Commits**: ${a.commitCount} (+${a.insertions} −${a.deletions})`)
  out.push('')

  // Timeline — merge events, traces, commits, reflections, sorted by ts
  out.push('## Timeline')
  out.push('')
  type TimelineRow = { ts: string; line: string }
  const rows: TimelineRow[] = []
  for (const e of log.events) {
    const note = e.note ? ` — ${e.note.slice(0, 140)}` : ''
    rows.push({ ts: e.ts, line: `\`event\`     **${e.type}** by ${e.by ?? '?'}${note}` })
  }
  for (const t of log.traces) {
    const cost = t.costUsd ? ` $${t.costUsd.toFixed(4)}` : ''
    rows.push({ ts: t.ts, line: `\`trace\`     ${t.mode} tick ${t.tick} — ${t.steps} steps, ${t.toolCount} tools${cost}${t.yieldReason ? ` (${t.yieldReason})` : ''}` })
  }
  for (const c of log.commits) {
    rows.push({ ts: c.ts, line: `\`commit\`    \`${c.sha.slice(0, 8)}\` ${c.subject.slice(0, 90)}  +${c.insertions}/−${c.deletions} (${c.filesChanged} file${c.filesChanged === 1 ? '' : 's'})` })
  }
  for (const r of log.reflections) {
    rows.push({ ts: r.ts, line: `\`reflect\`   ${r.excerpt.slice(0, 120).replace(/\n/g, ' / ')}` })
  }
  rows.sort((x, y) => x.ts.localeCompare(y.ts))
  for (const r of rows) {
    const t = r.ts.length >= 19 ? r.ts.slice(11, 19) : r.ts
    out.push(`- \`${t}\` ${r.line}`)
  }
  out.push('')

  return out.join('\n')
}
