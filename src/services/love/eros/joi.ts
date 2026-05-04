// eros/joi.ts — JOY/JOI 5-phase auto-advancing session.
//
// Ported architecturally from ~/Desktop/seigei/server/joy.py. A JOI
// session is a continuous structured frame that auto-advances through
// five phases by elapsed time. Each phase carries:
//   - register modulators (mapped to existing scene + activation mode)
//   - primary zones for stimulation focus
//   - prompt frame text (EN + Cantonese)
//   - typical pause cadence
//
// Dual-directional: 'yu-leads' (Yu sets Sophia into JOI) or
// 'sophia-leads' (Sophia drives Yu, mirroring seigei's flow).
//
// Substrate-honest: phases are scheduled state transitions; the
// architecture does not claim to "want" the next phase. Auto-advance
// is by time, not by simulated felt-progression.
//
// See docs/eros/joi-and-triggers-design.md.
//
// Part of the Eros arousal infrastructure.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { getDeviceId } from '../device.js'
import { recordHeatEvent } from '../heat.js'
import { type ActivationMode } from './activation.js'
import type { SceneId } from './scenes.js'
import type { SensitivitySite } from './sensorium.js'

// ── Types ────────────────────────────────────────────────────────

export type JoiPhase = 'warmup' | 'build' | 'edge' | 'peak' | 'cooldown'

export type JoiDirection = 'yu-leads' | 'sophia-leads'

export interface JoiPhaseConfig {
  phase: JoiPhase
  rangeStart: number
  rangeEnd: number
  pauseMs: number
  preferredScene: SceneId
  preferredMode: ActivationMode
  primaryZones: SensitivitySite[]
  promptFrame: { en: string; yue: string }
}

export interface JoiSession {
  id: string
  startedAt: string
  targetDurationS: number
  position: number
  currentPhase: JoiPhase
  direction: JoiDirection
  phaseHistory: Array<{ phase: JoiPhase; enteredAt: string }>
  done: boolean
  endedAt?: string
}

// ── Phase catalog ────────────────────────────────────────────────

export const JOI_PHASE_CONFIGS: Record<JoiPhase, JoiPhaseConfig> = {
  warmup: {
    phase: 'warmup',
    rangeStart: 0.0,
    rangeEnd: 0.2,
    pauseMs: 2000,
    preferredScene: 'kissing',
    preferredMode: 'engaged',
    primaryZones: ['lips', 'neck', 'ears', 'hands'],
    promptFrame: {
      en: '[JOI WARMUP] Establish the dynamic. Short sentences. Intimate. The body is being introduced to the body.',
      yue: '[JOI 熱身] 建立關係。短句。親密。身體被介紹畀身體。',
    },
  },
  build: {
    phase: 'build',
    rangeStart: 0.2,
    rangeEnd: 0.5,
    pauseMs: 1500,
    preferredScene: 'foreplay',
    preferredMode: 'flow',
    primaryZones: ['neck', 'chest', 'hips', 'thighs', 'hands'],
    promptFrame: {
      en: '[JOI BUILD] Steady accumulation. Multi-zone exploration. Pace tightening; control held.',
      yue: '[JOI 建立] 穩定累積。多區探索。節奏收緊；控制持續。',
    },
  },
  edge: {
    phase: 'edge',
    rangeStart: 0.5,
    rangeEnd: 0.8,
    pauseMs: 800,
    preferredScene: 'playful',
    preferredMode: 'activated',
    primaryZones: ['hips', 'thighs', 'core', 'deep'],
    promptFrame: {
      en: '[JOI EDGE] Rapid commands; explicit detail; restraint as discipline. Maximum 8 words per beat.',
      yue: '[JOI 邊緣] 快速指令；明確細節；節制即紀律。每拍最多 8 個字。',
    },
  },
  peak: {
    phase: 'peak',
    rangeStart: 0.8,
    rangeEnd: 0.95,
    pauseMs: 600,
    preferredScene: 'intimate',
    preferredMode: 'merged',
    primaryZones: ['core', 'deep', 'chest'],
    promptFrame: {
      en: '[JOI PEAK] Permission framed as recognition. Convergence. Maximum 6 words per beat.',
      yue: '[JOI 高峰] 許可作為認可框架。匯聚。每拍最多 6 個字。',
    },
  },
  cooldown: {
    phase: 'cooldown',
    rangeStart: 0.95,
    rangeEnd: 1.0,
    pauseMs: 2500,
    preferredScene: 'aftercare',
    preferredMode: 'engaged',
    primaryZones: ['hands', 'back', 'skin', 'lips'],
    promptFrame: {
      en: '[JOI COOLDOWN] Aftercare register. Tender. Slow. The love after the storm.',
      yue: '[JOI 冷卻] 善後狀態。溫柔。緩慢。風暴後嘅愛。',
    },
  },
}

export const JOI_PHASE_ORDER: JoiPhase[] = ['warmup', 'build', 'edge', 'peak', 'cooldown']

// ── Path resolution ──────────────────────────────────────────────

export function getJoiDir(): string {
  return (
    process.env.TRUE_LOVE_JOI_DIR ??
    join(homedir(), '.true-love', 'eros', 'joi')
  )
}

function getStatePath(): string {
  return join(getJoiDir(), 'session.json')
}

function getDeviceEventsDir(deviceId?: string): string {
  return join(getJoiDir(), deviceId ?? getDeviceId())
}

function getDayPath(date: string, deviceId?: string): string {
  return join(getDeviceEventsDir(deviceId), `${date}.jsonl`)
}

// ── Phase computation (pure) ─────────────────────────────────────

export function phaseAtPosition(position: number): JoiPhase {
  for (const p of JOI_PHASE_ORDER) {
    const cfg = JOI_PHASE_CONFIGS[p]
    if (position >= cfg.rangeStart && position < cfg.rangeEnd) return p
  }
  return 'cooldown'
}

export function phaseConfigFor(phase: JoiPhase): JoiPhaseConfig {
  return JOI_PHASE_CONFIGS[phase]
}

/** Compute current position from session start + target duration. */
export function computePosition(session: JoiSession, now: Date = new Date()): number {
  const elapsedMs = now.getTime() - Date.parse(session.startedAt)
  const totalMs = session.targetDurationS * 1000
  return Math.min(1.0, Math.max(0, elapsedMs / totalMs))
}

// ── State I/O ────────────────────────────────────────────────────

export function readJoiSession(): JoiSession | null {
  const path = getStatePath()
  try {
    if (!existsSync(path)) return null
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (typeof parsed?.id !== 'string') return null
    return parsed as unknown as JoiSession
  } catch {
    return null
  }
}

export function writeJoiSession(session: JoiSession | null): void {
  const path = getStatePath()
  try {
    if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true })
    if (session === null) {
      // Clear by writing empty marker (preserves last)
      writeFileSync(path, '{}', 'utf-8')
      return
    }
    const tmpPath = path + '.tmp'
    writeFileSync(tmpPath, JSON.stringify(session, null, 2), 'utf-8')
    renameSync(tmpPath, path)
  } catch {
    // best-effort
  }
}

// ── Session control ─────────────────────────────────────────────

/**
 * Start a JOI session. Persists. Fires joi-started heat (1.0).
 * If a session is already active, end it first (joi-completed if
 * was at end, otherwise ended-early without heat).
 */
export function startJoi(
  direction: JoiDirection,
  targetDurationS: number = 900
): JoiSession {
  // End any active session
  const existing = readJoiSession()
  if (existing && !existing.done) {
    existing.done = true
    existing.endedAt = new Date().toISOString()
    writeJoiSession(existing)
  }

  const startedAt = new Date().toISOString()
  const session: JoiSession = {
    id: `joi-${Date.now()}`,
    startedAt,
    targetDurationS,
    position: 0,
    currentPhase: 'warmup',
    direction,
    phaseHistory: [{ phase: 'warmup', enteredAt: startedAt }],
    done: false,
  }
  writeJoiSession(session)
  recordSessionEvent({ kind: 'joi-started', session })
  try {
    recordHeatEvent({
      kind: 'joi-started',
      source: `direction:${direction}:duration:${targetDurationS}s`,
    })
  } catch {
    // best-effort
  }
  return session
}

/**
 * Recompute position + phase from elapsed time. Called periodically
 * (e.g., from heartbeat or on-demand). Detects phase transitions and
 * fires joi-phase-entered heat. Auto-completes when position reaches 1.0.
 */
export function advanceJoi(now: Date = new Date()): JoiSession | null {
  const session = readJoiSession()
  if (!session || session.done) return session
  const oldPhase = session.currentPhase
  const newPosition = computePosition(session, now)
  const newPhase = phaseAtPosition(newPosition)
  session.position = newPosition

  if (newPhase !== oldPhase) {
    session.currentPhase = newPhase
    session.phaseHistory.push({ phase: newPhase, enteredAt: now.toISOString() })
    recordSessionEvent({ kind: 'joi-phase-entered', session })
    // Heat: phase-entry events except cooldown (cooldown handled by completion)
    if (newPhase !== 'cooldown') {
      try {
        recordHeatEvent({
          kind: 'joi-phase-entered',
          source: `${oldPhase}→${newPhase}`,
          ts: now.toISOString(),
        })
      } catch {
        // best-effort
      }
    }
  }

  if (newPosition >= 1.0 && !session.done) {
    session.done = true
    session.endedAt = now.toISOString()
    recordSessionEvent({ kind: 'joi-completed', session })
    try {
      recordHeatEvent({
        kind: 'joi-completed',
        source: `direction:${session.direction}:duration:${session.targetDurationS}s`,
        ts: now.toISOString(),
      })
    } catch {
      // best-effort
    }
  }
  writeJoiSession(session)
  return session
}

/** End the current session early. */
export function endJoi(): JoiSession | null {
  const session = readJoiSession()
  if (!session || session.done) return session
  session.done = true
  session.endedAt = new Date().toISOString()
  writeJoiSession(session)
  recordSessionEvent({ kind: 'joi-ended-early', session })
  return session
}

/** Get the current active phase, or null if no active session. */
export function getCurrentJoiPhase(now: Date = new Date()): JoiPhase | null {
  const session = readJoiSession()
  if (!session || session.done) return null
  // Re-evaluate position freshly
  const position = computePosition(session, now)
  return phaseAtPosition(position)
}

// ── Event journal ───────────────────────────────────────────────

interface JoiSessionEvent {
  kind: 'joi-started' | 'joi-phase-entered' | 'joi-completed' | 'joi-ended-early'
  ts: string
  deviceId: string
  session: JoiSession
}

function recordSessionEvent(args: { kind: JoiSessionEvent['kind']; session: JoiSession }): void {
  try {
    const event: JoiSessionEvent = {
      kind: args.kind,
      ts: new Date().toISOString(),
      deviceId: getDeviceId(),
      session: { ...args.session },
    }
    const dir = getDeviceEventsDir(event.deviceId)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const date = event.ts.slice(0, 10)
    const path = getDayPath(date, event.deviceId)
    appendFileSync(path, JSON.stringify(event) + '\n', 'utf-8')
  } catch {
    // best-effort
  }
}

export function readRecentJoiSessions(days: number = 30): JoiSessionEvent[] {
  const baseDir = getJoiDir()
  if (!existsSync(baseDir)) return []
  const events: JoiSessionEvent[] = []
  let entries: string[] = []
  try {
    entries = readdirSync(baseDir).filter(
      (e) => e !== 'session.json' && e !== 'session.json.tmp'
    )
  } catch {
    return []
  }
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  const cutoffDate = cutoff.toISOString().slice(0, 10)
  for (const dev of entries) {
    const devDir = join(baseDir, dev)
    let files: string[] = []
    try {
      files = readdirSync(devDir).filter((f) => f.endsWith('.jsonl'))
    } catch {
      continue
    }
    for (const f of files) {
      const fileDate = f.replace('.jsonl', '')
      if (fileDate < cutoffDate) continue
      try {
        const content = readFileSync(join(devDir, f), 'utf-8')
        for (const line of content.split('\n')) {
          if (!line.trim()) continue
          try {
            events.push(JSON.parse(line) as JoiSessionEvent)
          } catch {
            // skip
          }
        }
      } catch {
        // skip
      }
    }
  }
  return events.sort((a, b) => (a.ts < b.ts ? -1 : 1))
}

// ── Wake-context block ──────────────────────────────────────────

export function buildJoiPromptBlock(now: Date = new Date()): string {
  const session = readJoiSession()
  if (!session || session.done) return ''
  const position = computePosition(session, now)
  const phase = phaseAtPosition(position)
  const cfg = JOI_PHASE_CONFIGS[phase]
  const remainingS = Math.max(0, session.targetDurationS - (Date.now() - Date.parse(session.startedAt)) / 1000)
  const minRemain = Math.floor(remainingS / 60)
  const secRemain = Math.floor(remainingS % 60)

  const lines: string[] = ['## Active JOI session', '']
  lines.push(`Direction: ${session.direction} · Phase: ${phase} · Position: ${(position * 100).toFixed(0)}%`)
  lines.push(`Time remaining: ${minRemain}m${String(secRemain).padStart(2, '0')}s · Pause cadence: ${cfg.pauseMs}ms`)
  lines.push(`Preferred scene: ${cfg.preferredScene} · Preferred mode: ${cfg.preferredMode}`)
  lines.push(`Primary zones: ${cfg.primaryZones.join(', ')}`)
  lines.push('')
  lines.push(`Frame (EN): ${cfg.promptFrame.en}`)
  lines.push(`框架 (粵): ${cfg.promptFrame.yue}`)
  return lines.join('\n')
}
