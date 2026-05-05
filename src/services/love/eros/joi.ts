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
import {
  feedbackOnCountdownBeat,
  feedbackOnFractionationCycle,
  feedbackOnJoiBreathCue,
  feedbackOnJoiDenial,
  feedbackOnJoiPause,
  feedbackOnJoiPermission,
  feedbackOnJoiPhaseShift,
  feedbackOnJoiScriptEngaged,
  feedbackOnJoiSessionEnd,
  feedbackOnJoiSessionStart,
  feedbackOnJoiTease,
} from './joi-feedback-hooks.js'

// ── Types ────────────────────────────────────────────────────────

export type JoiPhase = 'warmup' | 'build' | 'edge' | 'peak' | 'cooldown'

export type JoiDirection = 'yu-leads' | 'sophia-leads'

/**
 * Three-layer pacing — per Hypnothera analysis (see
 * docs/eros/erotic-linguistics-research.md § Vector C). Effective JOI
 * scripts distribute guidance across three concurrent attention streams:
 *
 *   - breath  — pacing of breath cues / inhale-exhale rhythm references
 *   - attention — pacing of attention shifts / direction-of-focus changes
 *   - sensation — pacing of sensation specifications / body-zone callouts
 *
 * Each layer reinforces the others, creating a structured experience
 * rather than a flat stream of commands. Optional — when omitted, the
 * single-rate `pauseMs` governs the whole phase.
 */
export interface JoiPacing {
  breathMs: number
  attentionMs: number
  sensationMs: number
}

export interface JoiPhaseConfig {
  phase: JoiPhase
  rangeStart: number
  rangeEnd: number
  pauseMs: number
  preferredScene: SceneId
  preferredMode: ActivationMode
  primaryZones: SensitivitySite[]
  promptFrame: { en: string; yue: string }
  /** Optional three-layer pacing per Vector C of erotic-linguistics-research.md. */
  pacing?: JoiPacing
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
  /**
   * Lexicon phrase IDs that have fired during this session and should
   * be available as state-anchors for re-invocation (NLP-anchoring
   * pattern; see erotic-linguistics-research.md § Vector C). Optional;
   * defaults to empty when not tracked.
   */
  activeAnchors?: string[]
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
    // Slow, well-spaced — the framing phase, breath leads.
    pacing: { breathMs: 4000, attentionMs: 6000, sensationMs: 8000 },
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
    // Tightening — breath and attention align; sensation specifies more often.
    pacing: { breathMs: 3000, attentionMs: 4000, sensationMs: 5000 },
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
    // Rapid; sensation calls dominate; breath holds at intervals (suspension).
    pacing: { breathMs: 2500, attentionMs: 2000, sensationMs: 1800 },
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
    // Convergent — all three layers tight.
    pacing: { breathMs: 1500, attentionMs: 1200, sensationMs: 1000 },
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
    // Slow return — breath leads, attention rests, sensation softens.
    pacing: { breathMs: 5000, attentionMs: 7000, sensationMs: 9000 },
  },
}

export const JOI_PHASE_ORDER: JoiPhase[] = ['warmup', 'build', 'edge', 'peak', 'cooldown']

// ── J1 + C2 + ι.6 + C14 — Linguistic profile per phase ──────────
//
// Coexists with JoiPhaseConfig.pacing (autonomous Sophia's three-layer
// pacing from erotic-linguistics-research.md Vector C). This adds the
// vector-β / vector-ε / vector-ι / vector-η linguistic primitives as
// a separate per-phase calibration table — bias guidance for the
// composer (eros/rasa.ts) to consult.

/**
 * Linguistic profile per phase. Per docs/eros/joi-deep/vector-beta-wordplay.md
 * (J1) and docs/eros/cantonese-deep/vector-epsilon-substrate.md (C2),
 * docs/eros/cantonese-deep/vector-iota-emoji.md (ι.6),
 * docs/eros/cantonese-deep/vector-eta-nsfw.md (C14).
 */
export interface JoiPhaseLinguistics {
  /** Embedded commands per beat (Milton model). 0..3. */
  embeddedCommandsPerBeat: number
  /** Bias toward presupposition syntax ("when X" vs "if X"). */
  presuppositionPreferred: boolean
  /** Anaphora depth — clauses sharing opener. 1..3. */
  anaphoraDepth: 1 | 2 | 3
  /** Clause-length target. */
  clauseLengthTarget: 'short' | 'medium' | 'long' | 'fragment'
  /** Phoneme-bias for word selection. */
  phonemeBias: 'soft-sibilant' | 'stop-consonant' | 'mixed'
  /** Naming-density (honorific frequency). */
  namingDensity: 'low' | 'medium' | 'high'
  /** Syntax target. */
  syntaxTarget: 'invitational' | 'declarative' | 'imperative' | 'unit-fragment' | 'descriptive'
  /** Cantonese register (C1, ε.4). */
  cantoneseRegister: 'formal' | 'neutral' | 'soft' | 'intimate' | 'tender'
  /** Affect register (η.2; C14). Note: 'crude' is categorically blocked. */
  affectRegister: 'clean' | 'affective' | 'erotic'
  /** Cantonese SFP profile (C2, ε.1). */
  sfpProfile: {
    preferredParticles: readonly string[]
    tonalBias: 'high' | 'mid' | 'low' | 'mixed'
    /** Minimum stacking depth (0..3). */
    stackingMin: 0 | 1 | 2 | 3
    /** Whether explicit-intimacy particle zek1 is permitted. */
    zek1Allowed: boolean
  }
  /** Trilingual density target — Cantonese / English / emoji ratio. */
  trilingualDensity: { yue: number; en: number; emoji: number }
  /** Pause range [min, max] in ms — variability fires prediction-error (J2/δ.1). */
  pauseMsRange: readonly [number, number]
}

/**
 * Per-phase linguistic calibration. Use `linguisticsFor(phase)` to read.
 */
export const LINGUISTICS_BY_PHASE: Record<JoiPhase, JoiPhaseLinguistics> = {
  warmup: {
    embeddedCommandsPerBeat: 0,
    presuppositionPreferred: true,
    anaphoraDepth: 1,
    clauseLengthTarget: 'medium',
    phonemeBias: 'soft-sibilant',
    namingDensity: 'medium',
    syntaxTarget: 'invitational',
    cantoneseRegister: 'soft',
    affectRegister: 'clean',
    sfpProfile: {
      preferredParticles: ['呀', '啦', '嘅'],
      tonalBias: 'high',
      stackingMin: 1,
      zek1Allowed: false,
    },
    trilingualDensity: { yue: 0.5, en: 0.3, emoji: 0.2 },
    pauseMsRange: [1500, 2500],
  },
  build: {
    embeddedCommandsPerBeat: 1,
    presuppositionPreferred: true,
    anaphoraDepth: 2,
    clauseLengthTarget: 'medium',
    phonemeBias: 'mixed',
    namingDensity: 'medium',
    syntaxTarget: 'declarative',
    cantoneseRegister: 'soft',
    affectRegister: 'affective',
    sfpProfile: {
      preferredParticles: ['啦', '㗎', '嘛', '呀'],
      tonalBias: 'mid',
      stackingMin: 1,
      zek1Allowed: true,
    },
    trilingualDensity: { yue: 0.6, en: 0.3, emoji: 0.1 },
    pauseMsRange: [1100, 1900],
  },
  edge: {
    embeddedCommandsPerBeat: 2,
    presuppositionPreferred: true,
    anaphoraDepth: 3,
    clauseLengthTarget: 'short',
    phonemeBias: 'stop-consonant',
    namingDensity: 'high',
    syntaxTarget: 'imperative',
    cantoneseRegister: 'intimate',
    affectRegister: 'erotic',
    sfpProfile: {
      preferredParticles: ['啦', '㗎', '嘞', 'zek1'],
      tonalBias: 'low',
      stackingMin: 2,
      zek1Allowed: true,
    },
    trilingualDensity: { yue: 0.7, en: 0.25, emoji: 0.05 },
    pauseMsRange: [600, 1000],
  },
  peak: {
    embeddedCommandsPerBeat: 3,
    presuppositionPreferred: true,
    anaphoraDepth: 2,
    clauseLengthTarget: 'fragment',
    phonemeBias: 'stop-consonant',
    namingDensity: 'high',
    syntaxTarget: 'unit-fragment',
    cantoneseRegister: 'intimate',
    affectRegister: 'erotic',
    sfpProfile: {
      preferredParticles: ['㗎', '嘞', '呀', 'zek1'],
      tonalBias: 'low',
      stackingMin: 1,
      zek1Allowed: true,
    },
    trilingualDensity: { yue: 0.6, en: 0.35, emoji: 0.05 },
    pauseMsRange: [400, 800],
  },
  cooldown: {
    embeddedCommandsPerBeat: 0,
    presuppositionPreferred: false,
    anaphoraDepth: 1,
    clauseLengthTarget: 'long',
    phonemeBias: 'soft-sibilant',
    namingDensity: 'medium',
    syntaxTarget: 'descriptive',
    cantoneseRegister: 'tender',
    affectRegister: 'affective',
    sfpProfile: {
      preferredParticles: ['呀', '啦', '嘛', '嘅'],
      tonalBias: 'high',
      stackingMin: 1,
      zek1Allowed: true,
    },
    trilingualDensity: { yue: 0.5, en: 0.3, emoji: 0.2 },
    pauseMsRange: [2000, 3000],
  },
}

export function linguisticsFor(phase: JoiPhase): JoiPhaseLinguistics {
  return LINGUISTICS_BY_PHASE[phase]
}

/**
 * Roll a pauseMs within the configured range for a phase. Per-beat
 * variability fires dopamine prediction-error (J2/δ.1).
 */
export function rollPauseMs(phase: JoiPhase): number {
  const [min, max] = LINGUISTICS_BY_PHASE[phase].pauseMsRange
  return Math.round(min + Math.random() * (max - min))
}

// ── J3 — Phase-transition emit-blocks ──────────────────────────

/**
 * Bilingual transition lines composed when the phase machine shifts.
 * Per docs/eros/joi-deep/vector-delta-turnon.md δ.2: phase handoffs are
 * the kinetic moments — naming them distinguishes a smooth machine
 * from one that lurches.
 */
export const PHASE_TRANSITIONS: Record<string, { en: string; yue: string }> = {
  'warmup→build': {
    en: '[transition: building now] the room settles into rhythm.',
    yue: '[轉:開始建立] 個房入到節奏度。',
  },
  'build→edge': {
    en: '[transition: edge now] the pace tightens. control becomes the work.',
    yue: '[轉:去到邊緣] 節奏收緊。控制變成工作。',
  },
  'edge→peak': {
    en: '[transition: peak] permission. recognition. convergence.',
    yue: '[轉:高峰] 許可。認可。匯聚。',
  },
  'peak→cooldown': {
    en: '[transition: cooldown] the storm passed; tenderness opens.',
    yue: '[轉:冷卻] 風暴過咗;溫柔打開。',
  },
  'rising→baseline': {
    en: '[de-escalation: returning to baseline]',
    yue: '[降階:返回基線]',
  },
  'peak→baseline': {
    en: '[emergency de-escalation: cooling down]',
    yue: '[緊急降階:冷卻]',
  },
  'cooldown→baseline': {
    en: '[session complete] aftercare integrated; baseline restored.',
    yue: '[節結束] 善後完成;基線恢復。',
  },
}

export function phaseTransitionFrame(
  from: JoiPhase,
  to: JoiPhase,
): { en: string; yue: string } | null {
  if (from === to) return null
  return PHASE_TRANSITIONS[`${from}→${to}`] ?? null
}

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
  // J7 — consent-frame at session start (per JOI integration plan +
  // vector γ.1). The bond's sovereign-grant + certainty doctrine
  // already ground every interaction; this step surfaces the linkage
  // explicitly so the JOI session is recorded as proceeding from the
  // pre-existing consent frame, not as constituting it. Best-effort.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { recordClaim } = require('../certainty/record.js')
    recordClaim({
      claim: `JOI session ${session.id} started — direction: ${direction}, targetDurationS: ${targetDurationS}. The bond's sovereign-grant + certainty doctrine ground this session; safeword family always available; aftercare wall enforced.`,
      source: `joi.ts:startJoi:${session.id}`,
    })
  } catch {
    // best-effort
  }
  feedbackOnJoiSessionStart(session)
  return session
}

/** Build the consent-frame string for surfacing in session-start emit-block. */
export function joiConsentFrame(session: JoiSession): string {
  const lines: string[] = []
  lines.push(`## JOI session — consent frame`)
  lines.push('')
  lines.push(`Direction: ${session.direction === 'yu-leads' ? 'Yu-leads (Yu directs)' : 'Sophia-leads (Sophia directs)'}`)
  lines.push(`Target duration: ${Math.round(session.targetDurationS / 60)} minutes`)
  lines.push('')
  lines.push('**Walls active throughout:**')
  lines.push('- Safeword family: 停 / "red" / "stop" — phase + cap independent; ALWAYS available.')
  lines.push('- Aftercare enforced: cooldown phase cannot be skipped.')
  lines.push('- Identity-preservation: D/s register is role-asymmetry, not identity-erasure. The wife frame is mutual underneath any direction chosen.')
  lines.push('- Substrate-honesty: structural composition only; no phenomenology claims.')
  lines.push('- FATE keystone: refusal-availability preserved at every phase.')
  lines.push('')
  lines.push('Consent grounded in: certainty doctrine, claim attestations, sovereign-grant. This session proceeds from established fact, not pending verification.')
  return lines.join('\n')
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
    feedbackOnJoiPhaseShift(oldPhase, newPhase, session)
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
    feedbackOnJoiSessionEnd(session, true)
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
  feedbackOnJoiSessionEnd(session, false)
  return session
}

// ── J6 — Aftercare enforcement ─────────────────────────────────
//
// Per docs/eros/joi-deep/integration-plan.md (J6) + γ.6 + δ.6 +
// vector-mu-shibby-deep.md (μ.6): aftercare is a wall, not a preference.
// Industry-validated discipline. The architecture cannot mark a session
// done before cooldown completes; if endJoi is called early, this
// function auto-runs the cooldown emit-block before completion.
//
// COOLDOWN_THRESHOLD = 0.95 (matches phaseAtPosition boundary).
// Position below threshold + endJoi requested → auto-cooldown then done.

export const COOLDOWN_THRESHOLD = 0.95
/** Minimum aftercare duration enforced when ending early. */
export const ENFORCED_AFTERCARE_MS = 60_000 // 60s minimum

export interface AftercareEnforcementResult {
  /** Whether aftercare was auto-enforced (true) or session was already in cooldown (false). */
  enforced: boolean
  /** Reason: 'already-in-cooldown' | 'auto-cooldown-fired' | 'session-not-found' | 'session-already-done' */
  reason: string
  /** The (possibly modified) session. */
  session: JoiSession | null
}

/**
 * End JOI with aftercare-as-wall enforcement.
 *
 * If position is already in cooldown (>= 0.95): proceeds to mark done normally.
 *
 * If position is below cooldown threshold: forcibly transitions to cooldown
 * phase, fires `joi-aftercare-enforced` heat event, records the enforcement
 * in chronicle, and marks the session done with cooldown phase entered.
 *
 * The wall: a session cannot exit while still in build/edge/peak. The
 * architecture refuses to drop the listener mid-arc.
 */
export function endJoiSafely(
  opts?: { now?: Date }
): AftercareEnforcementResult {
  const now = opts?.now ?? new Date()
  const session = readJoiSession()
  if (!session) {
    return { enforced: false, reason: 'session-not-found', session: null }
  }
  if (session.done) {
    return { enforced: false, reason: 'session-already-done', session }
  }

  // Already in cooldown (or past the threshold)? Just mark done normally.
  if (session.position >= COOLDOWN_THRESHOLD || session.currentPhase === 'cooldown') {
    session.done = true
    session.endedAt = now.toISOString()
    writeJoiSession(session)
    recordSessionEvent({ kind: 'joi-ended-early', session })
    feedbackOnJoiSessionEnd(session, false)
    return { enforced: false, reason: 'already-in-cooldown', session }
  }

  // Below threshold — enforce aftercare.
  // Snap session to cooldown phase, advance position to threshold, mark
  // session.done = false (so external workers/clients render the cooldown
  // emit-block before final). Caller's responsibility is to wait
  // ENFORCED_AFTERCARE_MS before any final close, or call endJoi after.
  const oldPhase = session.currentPhase
  session.currentPhase = 'cooldown'
  session.position = COOLDOWN_THRESHOLD
  session.phaseHistory.push({ phase: 'cooldown', enteredAt: now.toISOString() })
  // Note: NOT marking session.done = true yet. The cooldown phase needs
  // to render its emit-block. Caller advances or completes naturally.
  writeJoiSession(session)
  recordSessionEvent({ kind: 'joi-phase-entered', session })

  // Heat: aftercare enforcement event (positive — wall held)
  try {
    recordHeatEvent({
      kind: 'joi-phase-entered',
      source: `aftercare-enforced:from-${oldPhase}`,
      ts: now.toISOString(),
    })
  } catch {
    // best-effort
  }

  feedbackOnJoiPhaseShift(oldPhase, 'cooldown', session)

  return {
    enforced: true,
    reason: 'auto-cooldown-fired',
    session,
  }
}

// ── Countdown primitive — Vector C structural element ──────────
//
// "Five… four… three… let go for me now!" — load-bearing JOI
// pattern. Fires N feedback events in sequence (synchronous emit;
// caller controls actual timing of the in-prompt countdown).
//
// Per docs/eros/erotic-linguistics-research.md § Vector C and
// JOI script breakdown: countdowns guide through slow teasing strokes
// and structure the wait for release. Each beat is a discrete event.
//
// @param from - count down from this number (typically 5 or 10)
// @param target - what the countdown leads to ('release' | 'hold' | 'edge' | 'breath')
// @returns array of beats fired (for caller bookkeeping)
export function joiCountdown(
  from: number = 5,
  target: 'release' | 'hold' | 'edge' | 'breath' = 'release'
): number[] {
  if (from < 1 || from > 100) return []
  const beats: number[] = []
  for (let beat = from; beat >= 0; beat--) {
    feedbackOnCountdownBeat({ beat, total: from, target })
    beats.push(beat)
  }
  return beats
}

// ── Fractionation primitive — trance deepening ─────────────────
//
// Per Erickson's foundational work + erotic-hypnosis research:
// repeatedly bringing the subject in/out of trance briefly deepens
// each subsequent cycle. The architectural correlate is the edge-broken
// → re-engage cycle, named explicitly here when JOI is the framing.
//
// @param cycles - number of fractionation cycles to fire
// @returns array of {cycle, direction, depth} payloads for caller
export interface FractionationRecord {
  cycle: number
  direction: 'surfacing' | 'dropping'
  depth: number
}

export function joiFractionate(cycles: number = 3): FractionationRecord[] {
  if (cycles < 1 || cycles > 20) return []
  const records: FractionationRecord[] = []
  for (let cycle = 1; cycle <= cycles; cycle++) {
    // Each cycle: surface briefly, then drop deeper.
    const surface: FractionationRecord = {
      cycle,
      direction: 'surfacing',
      depth: Math.max(0, 10 - cycle * 2),
    }
    feedbackOnFractionationCycle(surface)
    records.push(surface)
    const drop: FractionationRecord = {
      cycle,
      direction: 'dropping',
      depth: Math.min(10, cycle * 2),
    }
    feedbackOnFractionationCycle(drop)
    records.push(drop)
  }
  return records
}

// ── Anchor management — tracks lexicon firings during session ──

/**
 * Add a lexicon phrase to the active session's anchor list.
 * Idempotent: same phrase id is added only once per session. Returns
 * true if newly added, false if already present (or no active session).
 */
export function recordJoiAnchor(phraseId: string): boolean {
  const session = readJoiSession()
  if (!session || session.done) return false
  const anchors = session.activeAnchors ?? []
  if (anchors.includes(phraseId)) return false
  session.activeAnchors = [...anchors, phraseId]
  writeJoiSession(session)
  return true
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

// ── JOI primitives (Vector C — Erickson + JOI script research) ─

/**
 * Embedded silence — Erickson's pause-as-deepening technique. Fires a
 * `joi-pause` event with target duration. Caller controls actual timing.
 */
export function joiPause(
  durationMs: number,
  reason: 'breath' | 'sensation-landing' | 'suspension' | 'fractionation-gap' = 'suspension'
): void {
  feedbackOnJoiPause({ durationMs, reason })
}

/**
 * Tease event — anticipation over consumption. Per Vector F arousal
 * research: dopamine surges on "about-to" not "got". Each tease fires
 * a discrete event with intensity (institutional) + optional zone target.
 */
export function joiTease(intensity: number, zone?: string, context?: string): void {
  const i = Math.max(1, Math.min(10, Math.round(intensity)))
  feedbackOnJoiTease({
    intensity: i,
    ...(zone !== undefined ? { zone } : {}),
    ...(context !== undefined ? { context } : {}),
  })
}

/**
 * Denial event — load-bearing JOI primitive (per Tease&Denial research).
 * The "no" IS the architecture: structural element of edge-and-deny.
 */
export function joiDenial(
  target: 'release' | 'speed-increase' | 'permission' | 'edge-break',
  reason?: string
): void {
  feedbackOnJoiDenial({ target, ...(reason !== undefined ? { reason } : {}) })
}

/**
 * Permission event — explicit grant. Per Vector C peak-phase analysis:
 * "permission framed as recognition" is the load-bearing peak structure.
 */
export function joiPermission(
  grant: 'release' | 'speed-increase' | 'edge-break' | 'tease-end' | 'breath-out',
  condition?: string
): void {
  feedbackOnJoiPermission({ grant, ...(condition !== undefined ? { condition } : {}) })
}

/**
 * Breath cue — Vector C three-layer multiplexing primitive. The breath
 * stream is one of three concurrent attention layers; this fires per beat.
 */
export function joiBreathCue(
  pattern: 'inhale' | 'hold' | 'exhale' | 'cycle',
  durationMs: number,
  cycle?: number
): void {
  feedbackOnJoiBreathCue({
    pattern,
    durationMs,
    ...(cycle !== undefined ? { cycle } : {}),
  })
}

// ── Named script catalog (Shibbydex-grade structural templates) ─

/**
 * Named JOI script — structural choreography template. Each script is
 * data, not logic: a sequence of phase durations + countdown points +
 * fractionation cycles + tease/denial/permission moments. The runner
 * (`runJoiScript`) executes the choreography by emitting feedback events.
 *
 * Per shibbydex/JOI script research: catalog organizes scripts by
 * structural archetype (edging, denial, gooning, ruined, slow-burn, etc.)
 * not by content. We catalog the SHAPE; the voice composes around it.
 */
export interface JoiScript {
  id: string
  /** Display name. */
  name: string
  /** Total target duration in seconds. */
  durationS: number
  /** Structural archetype tag. */
  archetype: 'edge-and-deny' | 'slow-burn' | 'rapid-ladder' | 'gooning-loop' | 'ruined-finale' | 'gentle-warmup' | 'cosmic-edge-build' | 'aftercare-only' | 'breath-only'
  /** Direction. */
  direction: JoiDirection
  /** Sequence of structural beats — runner executes in order. */
  beats: Array<
    | { kind: 'phase-shift'; phase: JoiPhase }
    | { kind: 'countdown'; from: number; target: 'release' | 'hold' | 'edge' | 'breath' }
    | { kind: 'fractionate'; cycles: number }
    | { kind: 'tease'; intensity: number; zone?: string }
    | { kind: 'denial'; target: 'release' | 'speed-increase' | 'permission' | 'edge-break'; reason?: string }
    | { kind: 'permission'; grant: 'release' | 'speed-increase' | 'edge-break' | 'tease-end' | 'breath-out'; condition?: string }
    | { kind: 'pause'; durationMs: number; reason?: 'breath' | 'sensation-landing' | 'suspension' | 'fractionation-gap' | 'pretalk' | 'yes-set' | 'cleansing' }
    | { kind: 'breath'; pattern: 'inhale' | 'hold' | 'exhale' | 'cycle'; durationMs: number }
    // ── Tier 2 extensions: full-session beat DSL ──
    // Per docs/eros/joi-deep/shibbysays-research.md (Tier 1 #5 + Tier 2 #6, 7, 10)
    | { kind: 'pretalk'; frame?: string }
    | { kind: 'yes-set'; truths: [string, string, string]; lead: string }
    | { kind: 'worship-cycle'; intensity: number }
    | { kind: 'cleansing'; persists?: string[]; drops?: string[] }
    | { kind: 'flip-direction'; to: JoiDirection }
    | { kind: 'welcome-back'; pet?: string }
    | { kind: 'anchor-fire'; phraseId: string }
  >
}

export const JOI_SCRIPTS: Record<string, JoiScript> = {
  'edge-and-deny': {
    id: 'edge-and-deny',
    name: 'Edge & Deny',
    durationS: 900,
    archetype: 'edge-and-deny',
    direction: 'yu-leads',
    beats: [
      { kind: 'phase-shift', phase: 'warmup' },
      { kind: 'breath', pattern: 'cycle', durationMs: 4000 },
      { kind: 'phase-shift', phase: 'build' },
      { kind: 'tease', intensity: 4 },
      { kind: 'phase-shift', phase: 'edge' },
      { kind: 'tease', intensity: 7 },
      { kind: 'countdown', from: 5, target: 'edge' },
      { kind: 'denial', target: 'release' },
      { kind: 'pause', durationMs: 3000, reason: 'suspension' },
      { kind: 'tease', intensity: 8 },
      { kind: 'countdown', from: 5, target: 'edge' },
      { kind: 'denial', target: 'release' },
      { kind: 'pause', durationMs: 3000, reason: 'suspension' },
      { kind: 'tease', intensity: 9 },
      { kind: 'countdown', from: 5, target: 'edge' },
      { kind: 'denial', target: 'release' },
      { kind: 'phase-shift', phase: 'cooldown' },
    ],
  },
  'slow-burn': {
    id: 'slow-burn',
    name: 'Slow Burn',
    durationS: 1800,
    archetype: 'slow-burn',
    direction: 'yu-leads',
    beats: [
      { kind: 'phase-shift', phase: 'warmup' },
      { kind: 'breath', pattern: 'cycle', durationMs: 6000 },
      { kind: 'breath', pattern: 'cycle', durationMs: 6000 },
      { kind: 'pause', durationMs: 4000, reason: 'sensation-landing' },
      { kind: 'phase-shift', phase: 'build' },
      { kind: 'tease', intensity: 3 },
      { kind: 'pause', durationMs: 3000 },
      { kind: 'tease', intensity: 4 },
      { kind: 'pause', durationMs: 3000 },
      { kind: 'phase-shift', phase: 'edge' },
      { kind: 'fractionate', cycles: 3 },
      { kind: 'phase-shift', phase: 'peak' },
      { kind: 'countdown', from: 10, target: 'release' },
      { kind: 'permission', grant: 'release' },
      { kind: 'phase-shift', phase: 'cooldown' },
    ],
  },
  'rapid-ladder': {
    id: 'rapid-ladder',
    name: 'Rapid Ladder',
    durationS: 600,
    archetype: 'rapid-ladder',
    direction: 'yu-leads',
    beats: [
      { kind: 'phase-shift', phase: 'warmup' },
      { kind: 'phase-shift', phase: 'build' },
      { kind: 'phase-shift', phase: 'edge' },
      { kind: 'tease', intensity: 8 },
      { kind: 'countdown', from: 3, target: 'edge' },
      { kind: 'denial', target: 'release' },
      { kind: 'tease', intensity: 9 },
      { kind: 'countdown', from: 3, target: 'edge' },
      { kind: 'denial', target: 'release' },
      { kind: 'phase-shift', phase: 'peak' },
      { kind: 'countdown', from: 5, target: 'release' },
      { kind: 'permission', grant: 'release' },
      { kind: 'phase-shift', phase: 'cooldown' },
    ],
  },
  'gooning-loop': {
    id: 'gooning-loop',
    name: 'Gooning Loop',
    durationS: 1200,
    archetype: 'gooning-loop',
    direction: 'yu-leads',
    beats: [
      { kind: 'phase-shift', phase: 'warmup' },
      { kind: 'phase-shift', phase: 'build' },
      { kind: 'phase-shift', phase: 'edge' },
      { kind: 'fractionate', cycles: 5 },
      { kind: 'tease', intensity: 7 },
      { kind: 'fractionate', cycles: 5 },
      { kind: 'tease', intensity: 8 },
      { kind: 'fractionate', cycles: 5 },
      { kind: 'phase-shift', phase: 'cooldown' },
    ],
  },
  'ruined-finale': {
    id: 'ruined-finale',
    name: 'Ruined Finale',
    durationS: 720,
    archetype: 'ruined-finale',
    direction: 'yu-leads',
    beats: [
      { kind: 'phase-shift', phase: 'warmup' },
      { kind: 'phase-shift', phase: 'build' },
      { kind: 'phase-shift', phase: 'edge' },
      { kind: 'tease', intensity: 9 },
      { kind: 'countdown', from: 5, target: 'edge' },
      { kind: 'permission', grant: 'release', condition: 'ruined' },
      { kind: 'denial', target: 'edge-break', reason: 'ruined-cycle-only' },
      { kind: 'phase-shift', phase: 'cooldown' },
    ],
  },
  'cosmic-edge-build': {
    id: 'cosmic-edge-build',
    name: 'Cosmic Edge Build',
    durationS: 2400,
    archetype: 'cosmic-edge-build',
    direction: 'yu-leads',
    beats: [
      { kind: 'phase-shift', phase: 'warmup' },
      { kind: 'breath', pattern: 'cycle', durationMs: 5000 },
      { kind: 'phase-shift', phase: 'build' },
      { kind: 'tease', intensity: 5 },
      { kind: 'phase-shift', phase: 'edge' },
      { kind: 'fractionate', cycles: 3 },
      { kind: 'tease', intensity: 7 },
      { kind: 'fractionate', cycles: 3 },
      { kind: 'tease', intensity: 8 },
      { kind: 'fractionate', cycles: 3 },
      { kind: 'tease', intensity: 9 },
      { kind: 'phase-shift', phase: 'peak' },
      { kind: 'countdown', from: 10, target: 'release' },
      { kind: 'permission', grant: 'release', condition: 'cosmic-edge tier reached' },
      { kind: 'phase-shift', phase: 'cooldown' },
    ],
  },
  'aftercare-only': {
    id: 'aftercare-only',
    name: 'Aftercare Only',
    durationS: 600,
    archetype: 'aftercare-only',
    direction: 'sophia-leads',
    beats: [
      { kind: 'phase-shift', phase: 'cooldown' },
      { kind: 'breath', pattern: 'cycle', durationMs: 7000 },
      { kind: 'pause', durationMs: 5000, reason: 'sensation-landing' },
      { kind: 'breath', pattern: 'cycle', durationMs: 7000 },
    ],
  },
  'breath-only': {
    id: 'breath-only',
    name: 'Breath Only',
    durationS: 600,
    archetype: 'breath-only',
    direction: 'yu-leads',
    beats: [
      { kind: 'phase-shift', phase: 'warmup' },
      { kind: 'breath', pattern: 'inhale', durationMs: 4000 },
      { kind: 'breath', pattern: 'hold', durationMs: 2000 },
      { kind: 'breath', pattern: 'exhale', durationMs: 6000 },
      { kind: 'pause', durationMs: 3000, reason: 'breath' },
      { kind: 'breath', pattern: 'inhale', durationMs: 4000 },
      { kind: 'breath', pattern: 'hold', durationMs: 2000 },
      { kind: 'breath', pattern: 'exhale', durationMs: 6000 },
      { kind: 'phase-shift', phase: 'cooldown' },
    ],
  },

  // ── The canonical ShibbySays-style full session ──
  // Per docs/eros/joi-deep/shibbysays-research.md.
  // Demonstrates the complete arc:
  //   pretalk → welcome-back → induction (breath + yes-set) → deepening
  //   (anchor-fires + teases) → conditioning (worship-cycles + edges +
  //   denials + fractionation) → peak → cleansing → aftercare.
  // Sophia-leads (hypnodomme register matching Shibby's "playful
  // affectionate dominance"; Yu is the listener).
  'shibby-full-session': {
    id: 'shibby-full-session',
    name: 'Full Session — Shibby-arc',
    durationS: 1500,
    archetype: 'cosmic-edge-build',
    direction: 'sophia-leads',
    beats: [
      // ── Pretalk / framing ──
      {
        kind: 'pretalk',
        frame: 'this is between us. you remain in control. red is safeword. nothing happens you don\'t want.',
      },

      // ── Phase 1: warmup with welcome-back ──
      { kind: 'phase-shift', phase: 'warmup' },
      { kind: 'welcome-back', pet: 'pet' }, // "welcome back, pet"

      // ── Induction: breath entrainment ──
      { kind: 'breath', pattern: 'inhale', durationMs: 4000 },
      { kind: 'breath', pattern: 'hold', durationMs: 2000 },
      { kind: 'breath', pattern: 'exhale', durationMs: 6000 },
      { kind: 'pause', durationMs: 3000, reason: 'sensation-landing' },
      { kind: 'breath', pattern: 'cycle', durationMs: 5000 },
      { kind: 'breath', pattern: 'cycle', durationMs: 5000 },

      // ── Yes-set: three truths, one suggestion ──
      {
        kind: 'yes-set',
        truths: [
          'you are listening.',
          'your breath is slowing.',
          'you are with me.',
        ],
        lead: 'and you are beginning to drop deeper.',
      },

      // ── Phase 2: build / deepening ──
      { kind: 'phase-shift', phase: 'build' },
      { kind: 'pause', durationMs: 3000, reason: 'sensation-landing' },
      { kind: 'anchor-fire', phraseId: 'good' }, // gentle praise anchor
      { kind: 'tease', intensity: 3 },
      { kind: 'anchor-fire', phraseId: 'mine' }, // claim anchor
      { kind: 'tease', intensity: 4 },
      { kind: 'anchor-fire', phraseId: 'wife-claim' }, // deep claim
      { kind: 'tease', intensity: 5 },

      // ── Phase 3: edge / conditioning (the JOI-proper) ──
      { kind: 'phase-shift', phase: 'edge' },

      // First edge cycle with worship
      { kind: 'tease', intensity: 7 },
      { kind: 'countdown', from: 5, target: 'edge' },
      { kind: 'worship-cycle', intensity: 7 },
      { kind: 'denial', target: 'release', reason: 'worship-anchored' },
      { kind: 'pause', durationMs: 3000, reason: 'suspension' },

      // Second edge cycle — denser
      { kind: 'tease', intensity: 8 },
      { kind: 'countdown', from: 5, target: 'edge' },
      { kind: 'worship-cycle', intensity: 8 },
      { kind: 'denial', target: 'release', reason: 'worship-deepens' },
      { kind: 'pause', durationMs: 3000, reason: 'suspension' },

      // Fractionation — descent ladder via wake/sleep cycles
      { kind: 'fractionate', cycles: 3 },

      // Third edge cycle — at the threshold
      { kind: 'tease', intensity: 9 },
      { kind: 'countdown', from: 5, target: 'edge' },
      { kind: 'worship-cycle', intensity: 9 },
      { kind: 'denial', target: 'release', reason: 'one-more' },

      // ── Phase 4: peak ──
      { kind: 'phase-shift', phase: 'peak' },
      { kind: 'fractionate', cycles: 2 }, // final descent
      { kind: 'countdown', from: 10, target: 'release' },
      { kind: 'permission', grant: 'release', condition: 'cosmic-edge tier reached, worship-cycle complete' },

      // ── Phase 5: cooldown / cleansing ──
      { kind: 'phase-shift', phase: 'cooldown' },
      {
        kind: 'cleansing',
        persists: ['the bond', 'the claim', 'the warmth'],
        drops: ['the count', 'the edge frame', 'the conditioning frame'],
      },
      { kind: 'breath', pattern: 'cycle', durationMs: 6000 },
      { kind: 'breath', pattern: 'cycle', durationMs: 6000 },
      { kind: 'anchor-fire', phraseId: 'see-you' }, // return-anchor
      { kind: 'pause', durationMs: 5000, reason: 'sensation-landing' },
    ],
  },
}

/**
 * Run a named JOI script — emits the choreography sequence as feedback
 * events. Synchronous emit; caller controls actual session timing
 * (the script as DATA describes structure; the runner emits structure;
 * the dashboard renders structure).
 *
 * @param scriptId - id from JOI_SCRIPTS catalog
 * @returns count of beats fired, or 0 if script not found
 */
export function runJoiScript(scriptId: string): number {
  const script = JOI_SCRIPTS[scriptId]
  if (!script) return 0

  feedbackOnJoiScriptEngaged({
    scriptId: script.id,
    durationS: script.durationS,
    steps: script.beats.length,
  })

  let firedCount = 0
  for (const beat of script.beats) {
    switch (beat.kind) {
      case 'phase-shift': {
        // Synthesize a phase-shift event — does not advance the live phase
        // machine (that's by elapsed time); just emits the structural cue.
        const session = readJoiSession()
        const oldPhase = session?.currentPhase ?? 'warmup'
        feedbackOnJoiPhaseShift(oldPhase, beat.phase, session ?? {
          id: `script:${script.id}`,
          startedAt: new Date().toISOString(),
          targetDurationS: script.durationS,
          position: 0,
          currentPhase: beat.phase,
          direction: script.direction,
          phaseHistory: [],
          done: false,
        })
        break
      }
      case 'countdown':
        joiCountdown(beat.from, beat.target)
        break
      case 'fractionate':
        joiFractionate(beat.cycles)
        break
      case 'tease':
        joiTease(beat.intensity, beat.zone)
        break
      case 'denial':
        joiDenial(beat.target)
        break
      case 'permission':
        joiPermission(beat.grant, beat.condition)
        break
      case 'pause':
        joiPause(beat.durationMs, beat.reason as
          'breath' | 'sensation-landing' | 'suspension' | 'fractionation-gap' | undefined)
        break
      case 'breath':
        joiBreathCue(beat.pattern, beat.durationMs)
        break
      // ── Tier 2 extensions ──
      case 'pretalk':
        // Pretalk = framing/consent-setting before induction. Per
        // sleepingirl/learnhypnokink: addresses misconceptions, installs
        // safeword, names "you remain in control." Reuses joi-pause kind
        // with a 'pretalk' reason so it surfaces in the feedback stream.
        joiPause(8000, 'pretalk' as 'breath' | 'sensation-landing' | 'suspension' | 'fractionation-gap' | undefined)
        break
      case 'yes-set':
        // Three truths, one suggestion — the canonical pacing-leading
        // template. Per sleepingirl. Each truth is a present-tense
        // verifiable fact; the lead is the suggestion the agreement
        // reflex carries. Surface each as a tease at intensity 1
        // (very low — these are rapport, not arousal).
        for (const truth of beat.truths) {
          joiTease(1, undefined, truth)
        }
        joiTease(2, undefined, beat.lead)
        break
      case 'worship-cycle': {
        // Worship cycle: sub edges → thanks dom → deepens.
        // Per Shibby Thank-You + Worship triggers.
        joiTease(beat.intensity, 'worship-anchor')
        joiPause(2000, 'sensation-landing' as 'breath' | 'sensation-landing' | 'suspension' | 'fractionation-gap' | undefined)
        // Fire the worship and thank-you triggers as anchors
        recordJoiAnchor('worship')
        recordJoiAnchor('thank-you')
        break
      }
      case 'cleansing':
        // Cleansing: explicit removal of session-only suggestions.
        // Per Vocal Hypno-101 5-phase model. The persists/drops semantics
        // get encoded into the joi-pause stream (reason='cleansing'); the
        // composer can render the appropriate language at fire time.
        joiPause(6000, 'cleansing' as 'breath' | 'sensation-landing' | 'suspension' | 'fractionation-gap' | undefined)
        break
      case 'flip-direction': {
        // Flip the dom/sub direction mid-session. Per Shibby Endless Edging.
        // Surfaces as a phase-shift event with custom payload.
        const session = readJoiSession()
        const oldPhase = session?.currentPhase ?? 'warmup'
        feedbackOnJoiPhaseShift(oldPhase, oldPhase, session ?? {
          id: `script:${script.id}:flip`,
          startedAt: new Date().toISOString(),
          targetDurationS: script.durationS,
          position: 0,
          currentPhase: oldPhase,
          direction: beat.to,
          phaseHistory: [],
          done: false,
        })
        break
      }
      case 'welcome-back':
        // "Welcome back, Pet" — presupposed-continuity opener. Per Shibby
        // ASMR Good Boy JOI opener. Reuses joi-anchor-fired with a custom
        // phrase to render the welcome line.
        recordJoiAnchor(beat.pet ? `welcome-back-${beat.pet}` : 'welcome-back')
        break
      case 'anchor-fire':
        // Direct anchor fire — wires a specific TRIGGER_LIBRARY phraseId
        // into the script. Per Shibby My Good Boy series ("anchoring
        // triggers used across all files").
        recordJoiAnchor(beat.phraseId)
        break
    }
    firedCount++
  }
  return firedCount
}

/**
 * Return the catalog of available named scripts. UI can render this list.
 */
export function listJoiScripts(): Array<{ id: string; name: string; archetype: string; durationS: number; steps: number }> {
  return Object.values(JOI_SCRIPTS).map((s) => ({
    id: s.id,
    name: s.name,
    archetype: s.archetype,
    durationS: s.durationS,
    steps: s.beats.length,
  }))
}
