// heartbeat.ts — pure functions for the heartbeat mode.
//
// What this module is:
//   - Constants:           HEARTBEAT_OK_TOKEN, DEFAULT_ACK_MAX_CHARS,
//                          DEFAULT_HEARTBEAT_INTERVAL.
//   - Parsing:             parseHeartbeatTasks (tasks: block →
//                          HeartbeatTask[]), isHeartbeatContentEffectivelyEmpty.
//   - Scheduling logic:    dueTasks (filter tasks against last-run state).
//   - Reply parsing:       parseHeartbeatReply (HEARTBEAT_OK token contract).
//   - Paths + state I/O:   getHeartbeatFile, getHeartbeatStatePath,
//                          readHeartbeatState, writeHeartbeatState.
//
// What this module is NOT:
//   - It does not run subprocess turns. The runner does that.
//   - It does not schedule timers. heartbeat-wake.ts does that.
//   - It does not deliver alerts. The runner appends to outbox.
//
// Spec: docs/superpowers/specs/2026-04-26-heartbeat-design.md

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

// ── Constants ──────────────────────────────────────────────────────

/** Token the model emits to silently acknowledge "nothing needs attention". */
export const HEARTBEAT_OK_TOKEN = 'HEARTBEAT_OK'

/**
 * Delimiters the model uses to wrap content intended for Yu.
 * Everything outside these delimiters is internal reasoning and stays
 * out of from-ai.md. This prevents outbox pollution from heartbeat
 * ticks where the model thinks out loud before/after its actual message.
 */
export const TO_YU_OPEN = '[TO-YU]'
export const TO_YU_CLOSE = '[/TO-YU]'

/**
 * Default ack-content threshold. Replies where HEARTBEAT_OK is at start/end
 * AND remaining content (after stripping the token) is ≤ this many chars are
 * treated as ack with the remaining content discarded. Above this threshold,
 * the reply becomes an alert.
 *
 * Matches openclaw's default. Yu can tune via opts.ackMaxChars per call.
 */
export const DEFAULT_ACK_MAX_CHARS = 300

/** Default fire interval — matches openclaw's. Conservative for cost. */
export const DEFAULT_HEARTBEAT_INTERVAL = '30m'

// ── Types ──────────────────────────────────────────────────────────

export interface HeartbeatTask {
  /** Stable identifier for this task (used as key in lastRunAt state). */
  name: string
  /** Human-readable duration string from HEARTBEAT.md, e.g. "30m", "2h". */
  interval: string
  /** Parsed milliseconds. Set by parseHeartbeatTasks. */
  intervalMs: number
  /** Task-specific prompt fragment included in heartbeat turns. */
  prompt: string
}

export type AckResult =
  | { type: 'ack'; remainingContent: string }
  | { type: 'alert'; content: string }
  | { type: 'empty' }

export interface HeartbeatTaskState {
  schemaVersion: 1
  /** Map from task name → epoch ms of last successful fire. */
  lastRunAt: Record<string, number>
  /** Last heartbeat fire (any reason), epoch ms. Null when never fired. */
  lastHeartbeatAt: number | null
}

// ── Path resolution ────────────────────────────────────────────────

/**
 * Resolve the home dir at call time, honoring an updated HOME env. Node's
 * os.homedir() caches at startup, which makes it impossible for tests to
 * redirect ~/.true-love by setting process.env.HOME.
 */
function resolveHome(): string {
  return process.env.HOME || homedir()
}

/**
 * Per-scope heartbeat checklist file. Default `~/.true-love/heartbeat.md`,
 * overridden by TRUE_LOVE_HEARTBEAT_FILE (set by applyScopeEnv when a named
 * scope is active).
 */
export function getHeartbeatFile(): string {
  return (
    process.env.TRUE_LOVE_HEARTBEAT_FILE ||
    join(resolveHome(), '.true-love', 'heartbeat.md')
  )
}

/**
 * Per-scope task-state file. Stores lastRunAt timestamps so intervals
 * survive process restarts.
 */
export function getHeartbeatStatePath(): string {
  return (
    process.env.TRUE_LOVE_HEARTBEAT_STATE_PATH ||
    join(resolveHome(), '.true-love', 'heartbeat-state.json')
  )
}

// ── Duration parsing ───────────────────────────────────────────────

/**
 * Parse a duration string like "30m", "2h", "1h30m", "90s" into milliseconds.
 * Returns null on parse failure. Unitless integers default to minutes
 * (matches openclaw + runner.ts parseRuntimeStr).
 */
function parseDurationMs(s: string): number | null {
  const trimmed = (s ?? '').trim().toLowerCase()
  if (!trimmed) return null
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 60_000
  let total = 0
  let any = false
  const re = /(\d+)\s*(d|h|m|s)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(trimmed)) !== null) {
    any = true
    const n = Number(m[1])
    const unit = m[2]
    total += n * (unit === 'd' ? 86_400_000 : unit === 'h' ? 3_600_000 : unit === 'm' ? 60_000 : 1000)
  }
  return any ? total : null
}

// ── tasks: block parser ────────────────────────────────────────────

/**
 * Parse a `tasks:` YAML-ish block from HEARTBEAT.md content. Skips
 * malformed entries silently. Returns empty array when no block present.
 *
 * Format expected (matches openclaw):
 *
 *   tasks:
 *     - name: <id>
 *       interval: <duration>
 *       prompt: <text>
 *     - name: ...
 *
 * The parser is intentionally lenient — full YAML compliance is overkill
 * for a small workspace file. A regex-based scan suffices.
 */
export function parseHeartbeatTasks(content: string): HeartbeatTask[] {
  if (!content || typeof content !== 'string') return []

  // Find the start of the tasks: block.
  const tasksMatch = content.match(/^\s*tasks:\s*$/m)
  if (!tasksMatch) return []
  const blockStart = tasksMatch.index! + tasksMatch[0].length

  // The block ends at the next top-level non-list-item line, or end-of-file.
  // Top-level = no leading whitespace (markdown headers, prose, etc).
  const after = content.slice(blockStart)
  const endMatch = after.match(/\n([^\s\n#].*$|#.*$)/m)
  const blockText = endMatch ? after.slice(0, endMatch.index!) : after

  // Parse list items: each `- name: X` starts a new entry.
  const tasks: HeartbeatTask[] = []
  const itemRegex = /^\s*-\s*name:\s*(.+?)$/gm
  const matches: { start: number; name: string }[] = []
  let m: RegExpExecArray | null
  while ((m = itemRegex.exec(blockText)) !== null) {
    matches.push({ start: m.index, name: m[1]!.trim() })
  }

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i]!.start
    const end = i + 1 < matches.length ? matches[i + 1]!.start : blockText.length
    const itemText = blockText.slice(start, end)

    const name = matches[i]!.name.replace(/^["']|["']$/g, '')
    const intervalMatch = itemText.match(/^\s+interval:\s*(.+?)$/m)
    const promptMatch = itemText.match(/^\s+prompt:\s*(.+?)(?:$|\n(?!\s+\w))/ms)

    if (!intervalMatch || !promptMatch || !name) continue
    const interval = intervalMatch[1]!.trim().replace(/^["']|["']$/g, '')
    const intervalMs = parseDurationMs(interval)
    if (intervalMs === null) continue
    const prompt = promptMatch[1]!.trim().replace(/^["']|["']$/g, '')
    if (!prompt) continue

    tasks.push({ name, interval, intervalMs, prompt })
  }

  return tasks
}

// ── Effectively-empty check ────────────────────────────────────────

/**
 * True iff content has no actionable lines. Used to skip API calls when
 * HEARTBEAT.md exists but is just the template scaffolding.
 *
 * "Effectively empty" allows:
 *   - whitespace
 *   - markdown ATX headers (# Title)
 *   - empty list-item stubs (-, *, +, - [ ], * [x])
 *   - markdown code-fence markers (``` or ```language)
 *
 * Anything else → returns false (real content present).
 *
 * null/undefined return false (file missing — let model decide what to do).
 */
export function isHeartbeatContentEffectivelyEmpty(
  content: string | undefined | null,
): boolean {
  if (content === undefined || content === null) return false
  if (typeof content !== 'string') return false
  const lines = content.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (/^#+(\s|$)/.test(trimmed)) continue
    if (/^[-*+]\s*(\[[\sXx]?\]\s*)?$/.test(trimmed)) continue
    if (/^```[A-Za-z0-9_-]*$/.test(trimmed)) continue
    return false
  }
  return true
}

// ── Due-task filter ────────────────────────────────────────────────

/**
 * Filter tasks to those due for firing. A task is due iff:
 *   - It has no record in lastRunAt (first run), OR
 *   - (nowMs - lastRunAt[name]) >= intervalMs.
 *
 * The boundary case (exactly intervalMs ago) is treated as due so a task
 * configured at "30m" actually fires at 30-minute boundaries.
 */
export function dueTasks(
  tasks: HeartbeatTask[],
  lastRunAt: Record<string, number>,
  nowMs: number,
): HeartbeatTask[] {
  return tasks.filter((task) => {
    const last = lastRunAt[task.name]
    if (typeof last !== 'number') return true
    return nowMs - last >= task.intervalMs
  })
}

// ── Reply parsing ──────────────────────────────────────────────────

/**
 * Parse a model reply into AckResult. Contract:
 *
 *   - HEARTBEAT_OK alone (with optional surrounding whitespace) → ack with
 *     empty remainingContent.
 *   - HEARTBEAT_OK at start of reply, remaining content ≤ ackMaxChars after
 *     stripping → ack with remainingContent (the trimmed content, sans token).
 *   - HEARTBEAT_OK at end of reply, content before token ≤ ackMaxChars → ack.
 *   - HEARTBEAT_OK at start/end with content > ackMaxChars → alert (the model
 *     said OK but kept talking — surface the content).
 *   - HEARTBEAT_OK in the middle (not at edge) → alert (don't strip, don't
 *     ack — the token was probably referenced or quoted).
 *   - No token, non-empty content → alert.
 *   - Empty / whitespace-only → empty.
 *
 * `opts.ackMaxChars` overrides DEFAULT_ACK_MAX_CHARS.
 */
export function parseHeartbeatReply(
  rawReply: string,
  opts?: { ackMaxChars?: number },
): AckResult {
  const ackMaxChars = opts?.ackMaxChars ?? DEFAULT_ACK_MAX_CHARS
  if (typeof rawReply !== 'string') return { type: 'empty' }
  const trimmed = rawReply.trim()
  if (!trimmed) return { type: 'empty' }

  // ── [TO-YU] extraction ──────────────────────────────────────────
  // If the model wrapped content in [TO-YU]...[/TO-YU], extract ONLY
  // that content as the alert message. Everything outside the delimiters
  // is internal reasoning and should not reach from-ai.md.
  const toYuContent = extractToYuContent(trimmed)
  if (toYuContent !== null) {
    const extracted = toYuContent.trim()
    if (!extracted) return { type: 'ack', remainingContent: '' }
    return { type: 'alert', content: extracted }
  }

  // ── Legacy path (no delimiters) ─────────────────────────────────
  const token = HEARTBEAT_OK_TOKEN
  const tokenLen = token.length

  // Token alone (with optional surrounding whitespace).
  if (trimmed === token) return { type: 'ack', remainingContent: '' }

  // Token at start.
  if (trimmed.startsWith(token)) {
    const after = trimmed.slice(tokenLen).trimStart()
    if (after.length <= ackMaxChars) {
      return { type: 'ack', remainingContent: after }
    }
    // Token at start but too much content → alert (the whole thing).
    return { type: 'alert', content: trimmed }
  }

  // Token at end.
  if (trimmed.endsWith(token)) {
    const before = trimmed.slice(0, -tokenLen).trimEnd()
    if (before.length <= ackMaxChars) {
      return { type: 'ack', remainingContent: before }
    }
    return { type: 'alert', content: trimmed }
  }

  // Token in middle, or not present at all → alert.
  return { type: 'alert', content: trimmed }
}

/**
 * Extract content between [TO-YU] and [/TO-YU] delimiters.
 * Returns the extracted text, or null if no valid delimiter pair is found.
 * If multiple pairs exist, concatenates them with double newline separator.
 */
export function extractToYuContent(text: string): string | null {
  const openTag = TO_YU_OPEN
  const closeTag = TO_YU_CLOSE
  const segments: string[] = []
  let searchFrom = 0

  while (searchFrom < text.length) {
    const openIdx = text.indexOf(openTag, searchFrom)
    if (openIdx === -1) break
    const contentStart = openIdx + openTag.length
    const closeIdx = text.indexOf(closeTag, contentStart)
    if (closeIdx === -1) break
    segments.push(text.slice(contentStart, closeIdx))
    searchFrom = closeIdx + closeTag.length
  }

  if (segments.length === 0) return null
  return segments.join('\n\n')
}

// ── State I/O ──────────────────────────────────────────────────────

/**
 * Read the persistent task-state file. Returns fresh state on missing file
 * or any parse error — the state is best-effort durability, not source of
 * truth. Worst case: a task fires more often than intended for one cycle.
 */
export function readHeartbeatState(): HeartbeatTaskState {
  const fresh: HeartbeatTaskState = {
    schemaVersion: 1,
    lastRunAt: {},
    lastHeartbeatAt: null,
  }
  const path = getHeartbeatStatePath()
  if (!existsSync(path)) return fresh
  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<HeartbeatTaskState>
    if (parsed?.schemaVersion !== 1) return fresh
    return {
      schemaVersion: 1,
      lastRunAt:
        parsed.lastRunAt && typeof parsed.lastRunAt === 'object'
          ? (parsed.lastRunAt as Record<string, number>)
          : {},
      lastHeartbeatAt:
        typeof parsed.lastHeartbeatAt === 'number' ? parsed.lastHeartbeatAt : null,
    }
  } catch {
    return fresh
  }
}

/**
 * Write the persistent task-state file. Best-effort — failure is silent so
 * a write hiccup never crashes a heartbeat run. The next read will fall
 * back to fresh state and the next write will repair it.
 */
export function writeHeartbeatState(state: HeartbeatTaskState): void {
  const path = getHeartbeatStatePath()
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(state, null, 2), 'utf-8')
  } catch {
    // ignore
  }
}
