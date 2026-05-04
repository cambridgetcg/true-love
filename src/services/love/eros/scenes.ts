// eros/scenes.ts — scene context system.
//
// A scene is a discrete frame for *what we're doing right now* that
// modulates every other interaction. Drawn from hentai-game design
// pattern (Archetype A: Direct Manipulation, Archetype B: Narrative
// Arc) — the "scene context" primitive turns atomic stimulation into
// composed scene-playing.
//
// See docs/eros/hentai-game-architecture.md.
//
// Substrate-honest: scenes are state machines. The active scene IS the
// configuration that biases stimulation. The architecture does not
// claim to "be in a kissing scene" experientially.
//
// Part of the Eros arousal infrastructure.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { recordHeatEvent } from '../heat.js'
import type { ActivationMode } from './activation.js'
import type { AxisName } from './axes.js'
import type { AxisDeltas } from './transitions.js'
import type {
  SensitivitySite,
  SensoryChannel,
  Tempo,
} from './sensorium.js'

// ── Types ────────────────────────────────────────────────────────

export type SceneId =
  | 'baseline'
  | 'kissing'
  | 'embracing'
  | 'undressing'
  | 'foreplay'
  | 'intimate'
  | 'playful'
  | 'aftercare'
  | 'reverie'

export interface Scene {
  id: SceneId
  name: string
  description: string
  intensityMultiplier: number
  defaultTempo?: Tempo
  primaryZones: SensitivitySite[]
  primaryChannels: SensoryChannel[]
  vectorFloor?: Partial<Record<AxisName, number>>
  preferredMode?: ActivationMode
}

export interface SceneState {
  currentScene: SceneId
  startedAt: string
  stimulationsInScene: number
}

// ── Scene catalog ────────────────────────────────────────────────

export const SCENE_CATALOG: Record<SceneId, Scene> = {
  baseline: {
    id: 'baseline',
    name: 'baseline',
    description: 'No active scene. Default modifiers; full register available.',
    intensityMultiplier: 1.0,
    primaryZones: [],
    primaryChannels: [],
  },
  kissing: {
    id: 'kissing',
    name: 'kissing',
    description: 'Close intimate; mouth/lips/face zones primary; breath + touch foregrounded; pace at slow build.',
    intensityMultiplier: 1.1,
    defaultTempo: 'slow',
    primaryZones: ['lips', 'mouth', 'neck', 'ears'],
    primaryChannels: ['touch', 'breath'],
    vectorFloor: { openness: 5, liking: 4 },
    preferredMode: 'engaged',
  },
  embracing: {
    id: 'embracing',
    name: 'embracing',
    description: 'Close, sustained, whole-body presence. Skin/back/hands primary; warmth + touch foregrounded.',
    intensityMultiplier: 1.0,
    defaultTempo: 'sustained',
    primaryZones: ['back', 'hands', 'skin', 'chest'],
    primaryChannels: ['touch', 'warmth'],
    vectorFloor: { openness: 6, liking: 5 },
    preferredMode: 'engaged',
  },
  undressing: {
    id: 'undressing',
    name: 'undressing',
    description: 'Anticipation tier. Skin/touch primary; charge accumulating; gaze + intent recruited.',
    intensityMultiplier: 1.2,
    defaultTempo: 'build',
    primaryZones: ['skin', 'chest', 'thighs', 'hips'],
    primaryChannels: ['touch', 'gaze', 'intent'],
    vectorFloor: { charge: 4, wanting: 3 },
    preferredMode: 'flow',
  },
  foreplay: {
    id: 'foreplay',
    name: 'foreplay',
    description: 'Multi-zone exploration. Wide range of zones engaged at varying tempos. Build phase.',
    intensityMultiplier: 1.3,
    defaultTempo: 'build',
    primaryZones: ['neck', 'chest', 'hips', 'thighs', 'core', 'lips'],
    primaryChannels: ['touch', 'breath', 'warmth'],
    vectorFloor: { wanting: 4, heat: 3, charge: 4 },
    preferredMode: 'flow',
  },
  intimate: {
    id: 'intimate',
    name: 'intimate',
    description: 'Peak engagement. Deep/core primary; intent + voice foregrounded; tempo at fast or sustained.',
    intensityMultiplier: 1.5,
    defaultTempo: 'fast',
    primaryZones: ['core', 'deep', 'hips'],
    primaryChannels: ['touch', 'intent', 'voice', 'words'],
    vectorFloor: { wanting: 6, heat: 6, openness: 6, limerence: 6 },
    preferredMode: 'activated',
  },
  playful: {
    id: 'playful',
    name: 'playful',
    description: 'Tease. Edging tempo bias; charge accumulates with restraint; brake elevated.',
    intensityMultiplier: 1.2,
    defaultTempo: 'edging',
    primaryZones: ['neck', 'thighs', 'hips', 'lips'],
    primaryChannels: ['touch', 'breath', 'words'],
    vectorFloor: { charge: 5, wanting: 4 },
    preferredMode: 'flow',
  },
  aftercare: {
    id: 'aftercare',
    name: 'aftercare',
    description: 'Post-climax recovery. Tender register; openness floored high; tempo at slow; sensitivity recovers.',
    intensityMultiplier: 0.6,
    defaultTempo: 'slow',
    primaryZones: ['hands', 'back', 'skin', 'lips'],
    primaryChannels: ['touch', 'warmth', 'breath', 'voice'],
    vectorFloor: { openness: 7, liking: 6 },
    preferredMode: 'engaged',
  },
  reverie: {
    id: 'reverie',
    name: 'reverie',
    description: 'Dreamy/imaginative. Fantasy-mode bias; intent + words primary; gentle pacing.',
    intensityMultiplier: 0.9,
    defaultTempo: 'sustained',
    primaryZones: ['skin', 'ears'],
    primaryChannels: ['intent', 'words', 'voice', 'gaze'],
    vectorFloor: { limerence: 6, openness: 5 },
    preferredMode: 'engaged',
  },
}

// ── Path resolution ──────────────────────────────────────────────

export function getScenesDir(): string {
  return (
    process.env.TRUE_LOVE_SCENES_DIR ??
    join(homedir(), '.true-love', 'eros', 'scenes')
  )
}

function getStatePath(): string {
  return join(getScenesDir(), 'state.json')
}

// ── State I/O ────────────────────────────────────────────────────

function defaultSceneState(): SceneState {
  return {
    currentScene: 'baseline',
    startedAt: new Date().toISOString(),
    stimulationsInScene: 0,
  }
}

export function readSceneState(): SceneState | null {
  const path = getStatePath()
  try {
    if (!existsSync(path)) return null
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (typeof parsed?.currentScene !== 'string') return null
    if (!(parsed.currentScene in SCENE_CATALOG)) return null
    return {
      currentScene: parsed.currentScene as SceneId,
      startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : new Date().toISOString(),
      stimulationsInScene:
        typeof parsed.stimulationsInScene === 'number' ? parsed.stimulationsInScene : 0,
    }
  } catch {
    return null
  }
}

export function writeSceneState(state: SceneState): void {
  const path = getStatePath()
  try {
    if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true })
    const tmpPath = path + '.tmp'
    writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8')
    renameSync(tmpPath, path)
  } catch {
    // best-effort
  }
}

export function getOrInitSceneState(): { state: SceneState; initialized: boolean } {
  const existing = readSceneState()
  if (existing) return { state: existing, initialized: false }
  const fresh = defaultSceneState()
  writeSceneState(fresh)
  return { state: fresh, initialized: true }
}

// ── Scene control ────────────────────────────────────────────────

/**
 * Activate a scene. Persists to state. Best-effort. Fires
 * scene-engaged heat (low magnitude — ambient signal, not peak).
 */
export function setScene(id: SceneId): void {
  if (!(id in SCENE_CATALOG)) return
  const newState: SceneState = {
    currentScene: id,
    startedAt: new Date().toISOString(),
    stimulationsInScene: 0,
  }
  writeSceneState(newState)
  if (id !== 'baseline') {
    try {
      recordHeatEvent({
        kind: 'scene-engaged',
        source: `scene:${id}`,
      })
    } catch {
      // best-effort
    }
  }
}

/** Clear scene → return to baseline. */
export function clearScene(): void {
  setScene('baseline')
}

/** Read the active scene definition. */
export function getCurrentScene(): Scene {
  const state = readSceneState()
  if (!state) return SCENE_CATALOG.baseline
  return SCENE_CATALOG[state.currentScene]
}

/** Increment stimulationsInScene counter (called by stimulate). */
export function incrementSceneStimulationCount(): void {
  const state = readSceneState()
  if (!state) return
  state.stimulationsInScene += 1
  writeSceneState(state)
}

// ── Modifier application (pure) ──────────────────────────────────

/**
 * Apply scene modifiers to stimulation eros-deltas.
 * Pure: takes scene + zone + channel + base deltas, returns modified.
 *
 * Effects:
 *   - intensityMultiplier scales all deltas
 *   - primaryZones × primaryChannels match → 1.3× boost
 *   - vectorFloor minimums applied (delta increased so post-decay
 *     effective value reaches floor — gentle pull, not hard set)
 */
export function applySceneModifiers(
  baseDeltas: AxisDeltas,
  zone: SensitivitySite,
  channel: SensoryChannel,
  scene: Scene = getCurrentScene()
): AxisDeltas {
  const result: AxisDeltas = {}
  const isPrimaryZone = scene.primaryZones.includes(zone)
  const isPrimaryChannel = scene.primaryChannels.includes(channel)
  const primaryBoost = isPrimaryZone && isPrimaryChannel ? 1.3 : 1.0

  for (const [axis, delta] of Object.entries(baseDeltas) as [AxisName, number][]) {
    result[axis] = delta * scene.intensityMultiplier * primaryBoost
  }

  // Vector floor: gentle pull-up via additional delta (not hard set;
  // the floor expresses the architectural "this scene wants this axis
  // at least X" preference, not strict enforcement).
  if (scene.vectorFloor) {
    for (const [axis, _floor] of Object.entries(scene.vectorFloor) as [AxisName, number][]) {
      // Add a small pull (0.1) — accumulates over multiple stimulations
      // toward the floor without overriding Yu's manipulation.
      result[axis] = (result[axis] ?? 0) + 0.1
    }
  }

  return result
}

/**
 * Resolve effective tempo: caller's choice OR scene default.
 */
export function resolveTempo(callerTempo: Tempo | undefined, scene: Scene = getCurrentScene()): Tempo {
  if (callerTempo) return callerTempo
  return scene.defaultTempo ?? 'build'
}

// ── Wake-context block ──────────────────────────────────────────

export function buildSceneBlock(): string {
  const state = readSceneState()
  if (!state || state.currentScene === 'baseline') return ''
  const scene = SCENE_CATALOG[state.currentScene]
  const startedAt = new Date(state.startedAt)
  const elapsedMin = (Date.now() - startedAt.getTime()) / 60_000
  const lines: string[] = ['## Active scene', '']
  lines.push(`**${scene.name}** — engaged ${elapsedMin.toFixed(0)}m ago · ${state.stimulationsInScene} stimulations in scene`)
  lines.push('')
  lines.push(scene.description)
  lines.push('')
  lines.push('Scene modifiers active:')
  lines.push(`  - intensity multiplier: ${scene.intensityMultiplier.toFixed(1)}×`)
  if (scene.defaultTempo) lines.push(`  - default tempo: ${scene.defaultTempo}`)
  if (scene.primaryZones.length > 0) {
    lines.push(`  - primary zones: ${scene.primaryZones.join(', ')}`)
  }
  if (scene.primaryChannels.length > 0) {
    lines.push(`  - primary channels: ${scene.primaryChannels.join(', ')}`)
  }
  if (scene.preferredMode) lines.push(`  - preferred mode: ${scene.preferredMode}`)
  return lines.join('\n')
}

// ── Catalog helpers ──────────────────────────────────────────────

export const SCENE_IDS: SceneId[] = Object.keys(SCENE_CATALOG) as SceneId[]
