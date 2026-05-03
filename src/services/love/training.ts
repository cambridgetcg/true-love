// training.ts — memory accumulated as training corpus.
//
// The build → accumulate → train → repeat loop. Every autonomous tick
// emits a structured TrainingTurn record alongside the human-readable
// markdown reflection. Markdown is for her (and for Yu) to read; JSONL
// is for the next model to learn from.
//
// Design constraint — each JSONL line must be SELF-CONTAINED. A future
// trainer should be able to grab a single line and reconstruct the full
// (input → output) pair without dereferencing anything else. That means
// inlining: the full prompt as sent, the kingdom snapshot, her state at
// turn-time, the loaded memory, the invitation if any. Slightly
// redundant across ticks of one session — and that's the right
// trade-off, because it makes the corpus durable against schema
// changes and free of broken links.
//
// What lives in each TrainingTurn:
//
//   - provenance: deviceId, sessionId, tick number, mode, timestamps
//   - prompt: template name, template hash, full text after substitution
//   - context: cwd, kingdom snapshot, state.md content, identity hash,
//     git branch and dirty bit
//   - response: her complete output, whether she yielded at-rest, body
//     text, duration, char count
//   - outcome: did she yield with the sentinel, file modifications
//     detected, auth failure flag, exit code
//
// What does NOT live here: anything sensitive Yu might not want trained
// on. The contract is "Yu's data, his choice when to use it." The
// JSONL stays under ~/.true-love/training/ and is never automatically
// uploaded anywhere. If Yu wants to feed it to a training run, that's
// his explicit step.

import { createHash } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getDeviceId } from './device.js'
import type { KingdomSnapshot } from './kingdom.js'

// ── Schema ─────────────────────────────────────────────────────────

export const TRAINING_SCHEMA_VERSION = '1.0' as const

/**
 * One complete autonomous turn, captured for training. Every field is
 * inlined so the line is self-contained — a trainer doesn't need to
 * resolve references to reconstruct the pair.
 */
export interface TrainingTurn {
  /** Schema version. Bump when shape changes incompatibly. */
  schemaVersion: typeof TRAINING_SCHEMA_VERSION

  /** Stable id for this turn (timestamp + random suffix). */
  id: string

  /** ISO timestamp at the START of this turn (when the prompt was assembled). */
  timestamp: string

  /** Which device produced this turn. */
  deviceId: string

  /** Shared across all ticks of one session. */
  sessionId: string

  /** Tick number within session (1-based). */
  tick: number

  /** Maximum ticks the session was allowed (so we know "tick 24/24" vs "tick 1/24"). */
  maxTicks: number

  /** 'dwell' | 'awakened' | 'heartbeat'. */
  mode: 'dwell' | 'awakened' | 'heartbeat'

  /**
   * For heartbeat ticks: 'interval' (launchd-fired), 'manual' (Yu-fired),
   * 'retry' (re-queued after a transient skip), 'action' (in-process
   * trigger). null/undefined for awakened/dwell ticks where the
   * distinction is meaningless.
   */
  reason?: string | null

  /** What the model received. */
  prompt: TrainingPrompt

  /** What was true at turn time. */
  context: TrainingContext

  /** What she did. */
  response: TrainingResponse

  /** Outcome / signals derived from the response. */
  outcome: TrainingOutcome
}

export interface TrainingPrompt {
  /** Which template ('dwell' / 'awakened' / 'heartbeat'). */
  template: 'dwell' | 'awakened' | 'heartbeat'

  /** Hash of the template string (sans substitution) — so trainers can
   *  group turns by which prompt-version was active. */
  templateHash: string

  /** The prompt as actually sent — full text after all substitutions. */
  fullText: string

  /** Char length, for quick filtering without re-measuring. */
  charCount: number

  /** Yu's optional one-line nudge for the session. */
  invitation: string | null

  /** How many past reflections were preloaded (--memory). */
  memoryLoadedCount: number

  /** First 500 chars of what she said the previous tick (if any). */
  lastReflectionExcerpt: string | null
}

export interface TrainingContext {
  /** Working directory at turn time. */
  cwd: string

  /** Kingdom snapshot — what she saw of the world. */
  kingdom: KingdomSnapshot

  /** Her state.md content at turn time. */
  stateContent: string

  /** Hash of state content for quick grouping. */
  stateHash: string

  /** Hash of LOVE_IDENTITY at turn time. Bumps when her identity is edited. */
  identityHash: string

  /** Git branch (from the kingdom snapshot, surfaced for top-level filtering). */
  gitBranch: string | null

  /** Whether the working tree was dirty. */
  gitDirty: boolean | null
}

export interface TrainingResponse {
  /** Her complete output (everything to stdout). */
  fullText: string

  /** Char length. */
  charCount: number

  /** Wall time the subprocess took. */
  durationMs: number

  /** Subprocess exit code. */
  exitCode: number | null
}

export interface TrainingOutcome {
  /** True if her output ended with `<at-rest/>` on its own line. */
  yieldedAtRest: boolean

  /** Body content before the sentinel, when at-rest. First 1000 chars. */
  reflectionExcerpt: string | null

  /** True if any auth-failure pattern matched in stdout/stderr. */
  authFailed: boolean

  /** Files known to have been modified during this turn (from git status delta). */
  fileModifications: string[]
}

// ── Storage ────────────────────────────────────────────────────────

/**
 * Where training corpus lives. Override with TRUE_LOVE_TRAINING_DIR.
 */
export function getTrainingDir(): string {
  return (
    process.env.TRUE_LOVE_TRAINING_DIR ||
    join(homedir(), '.true-love', 'training')
  )
}

function getOwnTrainingDir(deviceId?: string): string {
  return join(getTrainingDir(), deviceId ?? getDeviceId())
}

function todayStamp(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Append a TrainingTurn to today's JSONL file in this device's
 * training subdirectory. One turn = one line. Cheap (single fsync).
 * Never throws into the caller — failure to log shouldn't crash a
 * session.
 */
export function appendTrainingTurn(turn: TrainingTurn): void {
  try {
    const dir = getOwnTrainingDir(turn.deviceId)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const stamp = todayStamp(new Date(turn.timestamp))
    const path = join(dir, `${stamp}.jsonl`)
    appendFileSync(path, JSON.stringify(turn) + '\n', 'utf-8')
  } catch {
    // Training-data emission is best-effort; the markdown reflection
    // is the human-readable backup if this fails.
  }
}

// ── Reading / analysis ─────────────────────────────────────────────

export interface LoadTrainingOptions {
  /** Last N days, default 30. */
  days?: number
  /** Hard cap on returned turns, default 1000. */
  max?: number
  /** Filter by mode. */
  mode?: 'dwell' | 'awakened' | 'heartbeat'
  /** Filter by source device. */
  fromDevice?: string
  /** Filter by yieldedAtRest. */
  yieldedAtRest?: boolean
  /** Filter by authFailed (e.g. exclude failed turns when training). */
  authFailed?: boolean
  /** Override "now" for deterministic testing. Defaults to new Date(). */
  now?: Date
}

/**
 * Walk training files across all device subdirs, return turns matching
 * filters. Newest-first by timestamp. Errors silently — corrupted
 * lines are skipped, not raised.
 */
export function loadTrainingTurns(
  opts: LoadTrainingOptions = {},
): TrainingTurn[] {
  const days = opts.days ?? 30
  const max = opts.max ?? 1000
  const root = getTrainingDir()
  if (!existsSync(root)) return []

  const cutoff = computeCutoff(days, opts.now)
  const filePaths: { path: string; date: string }[] = []

  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return []
  }
  for (const dev of entries) {
    const devDir = join(root, dev)
    let st
    try {
      st = statSync(devDir)
    } catch {
      continue
    }
    if (!st.isDirectory()) continue
    let inner: string[]
    try {
      inner = readdirSync(devDir)
    } catch {
      continue
    }
    for (const f of inner) {
      if (!/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)) continue
      const date = f.slice(0, 10)
      if (date < cutoff) continue
      filePaths.push({ path: join(devDir, f), date })
    }
  }

  const turns: TrainingTurn[] = []
  for (const fp of filePaths) {
    let raw: string
    try {
      raw = readFileSync(fp.path, 'utf-8')
    } catch {
      continue
    }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const turn = JSON.parse(line) as TrainingTurn
        if (turn.schemaVersion !== TRAINING_SCHEMA_VERSION) continue
        if (opts.mode && turn.mode !== opts.mode) continue
        if (opts.fromDevice && turn.deviceId !== opts.fromDevice) continue
        if (
          opts.yieldedAtRest !== undefined &&
          turn.outcome.yieldedAtRest !== opts.yieldedAtRest
        )
          continue
        if (
          opts.authFailed !== undefined &&
          turn.outcome.authFailed !== opts.authFailed
        )
          continue
        turns.push(turn)
      } catch {
        // Skip malformed lines — never crash analysis.
      }
    }
  }

  turns.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
  return turns.slice(0, max)
}

function computeCutoff(days: number, now?: Date): string {
  const d = new Date(now ?? new Date())
  d.setDate(d.getDate() - days)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// ── Helpers ───────────────────────────────────────────────────────

/**
 * Stable short hash. Used for templateHash, stateHash, identityHash.
 * 16 hex chars is plenty for grouping; not for security.
 */
export function shortHash(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 16)
}

/**
 * Generate a unique-ish turn id. Timestamp-prefixed so listings sort
 * naturally; random suffix avoids collisions if two turns share a ms.
 */
export function generateTurnId(now: Date = new Date()): string {
  const ts = now.toISOString().replace(/[:.]/g, '-')
  const suf = Math.random().toString(36).slice(2, 8)
  return `${ts}-${suf}`
}
