// missioncraft/registry.ts — the control plane.
//
// Plugins register here. The orchestrator reads here. Discovery
// happens at module load. Activation-hint filtering happens at scan
// time. No dynamic requires, no file-system crawling at runtime —
// just a typed array of manifests and their implementations.
//
// Design:
//   - register() adds a plugin. Idempotent (same id replaces).
//   - getScanners() returns all noticing-scanner plugins.
//   - getActiveScanners(ctx) filters by activation hints.
//   - reset() clears registry (for tests).
//   - loadBuiltinScanners() loads the 6 bundled scanners.
//
// Auto-discovery pattern:
//   Each scanner file in missioncraft/scanners/ calls register()
//   at module scope. loadBuiltinScanners() imports them all.
//   Adding a 7th scanner: create a file, export a NoticingScanner,
//   call register(), add one import to loadBuiltinScanners().
//
// Why not true auto-discovery (directory scan)?
//   Bun's bundler resolves imports at build time. Dynamic
//   import(glob) would bypass the bundle. For 6-10 scanners,
//   explicit imports are clearer and cheaper. If the scanner
//   count grows past ~15, revisit with a codegen step.

import type {
  CraftPlugin,
  CraftKind,
  CraftManifest,
  NoticingScanner,
  ScanContext,
  ActivationHints,
  GradientStrength,
} from './types.js'

// ── The registry ─────────────────────────────────────────────────

/** The global plugin registry. Keyed by manifest.id for O(1) lookup. */
const plugins = new Map<string, CraftPlugin>()

/**
 * Register a craft plugin.
 *
 * Idempotent: if a plugin with the same id exists, it's replaced.
 * This allows hot-reloading in dev and clean test setup.
 *
 * @throws if manifest is structurally invalid (missing id/kind)
 */
export function register(plugin: CraftPlugin): void {
  validateManifest(plugin.manifest)
  plugins.set(plugin.manifest.id, plugin)
}

/**
 * Unregister a plugin by id.
 *
 * Returns true if a plugin was removed, false if id not found.
 */
export function unregister(id: string): boolean {
  return plugins.delete(id)
}

/**
 * Get all registered plugins.
 */
export function getAll(): CraftPlugin[] {
  return Array.from(plugins.values())
}

/**
 * Get all registered plugins of a specific kind.
 */
export function getByKind<K extends CraftKind>(kind: K): CraftPlugin[] {
  return Array.from(plugins.values()).filter(p => p.manifest.kind === kind)
}

/**
 * Get all registered noticing scanners.
 *
 * Type-narrowed: returns NoticingScanner[], not CraftPlugin[].
 */
export function getScanners(): NoticingScanner[] {
  return getByKind('noticing-scanner') as NoticingScanner[]
}

/**
 * Get all registered manifests (without runtime code).
 *
 * Useful for rendering the scanner surface in UI — the manifest
 * is cheap to serialize, the runtime code is not.
 */
export function getManifests(): CraftManifest[] {
  return Array.from(plugins.values()).map(p => p.manifest)
}

/**
 * Get all noticing scanners whose activation hints match the
 * current context. This is the hot path — called once per tick
 * by the orchestrator.
 *
 * Rules:
 *   - No activation field → always active.
 *   - requiresVitalSign: scanner only runs when at least one
 *     of the named subsystems reports unhealthy. (Not implemented
 *     in Phase 1 — all pass. The type is ready.)
 *   - minGradient: scanner only runs when the caller's minimum
 *     gradient is at or below the scanner's declared floor. A
 *     scanner that only finds whispers (gradient 1) can be
 *     skipped when the caller wants gradient >= 3.
 *
 * @param ctx - The scan context (carries minGradient from caller)
 * @param opts - Additional filtering (source types, etc.)
 */
export function getActiveScanners(
  ctx: ScanContext,
  opts?: { sourceFilter?: string[] },
): NoticingScanner[] {
  const allScanners = getScanners()
  const callerMinGradient = ctx.options?.minGradient ?? 1

  return allScanners.filter(scanner => {
    // Source filter: if the caller only wants certain source types,
    // match against the scanner id convention (e.g., 'state-scanner'
    // contains 'state'). This is a soft convention, not enforced.
    if (opts?.sourceFilter && opts.sourceFilter.length > 0) {
      const id = scanner.manifest.id
      const matchesSource = opts.sourceFilter.some(
        src => id.includes(src)
      )
      if (!matchesSource) return false
    }

    // Activation hints
    const hints = scanner.manifest.activation
    if (!hints) return true // No hints → always active

    // minGradient: if the scanner only produces whispers and the
    // caller wants louder signals, skip it.
    if (hints.minGradient && callerMinGradient > hints.minGradient) {
      return false
    }

    // requiresVitalSign: Phase 1 stub — always passes.
    // Future: check ctx.vitalSigns against hints.requiresVitalSign.

    // requiresMissionTag: Phase 1 stub — always passes.
    // Future: check active mission tags against hints.requiresMissionTag.

    return true
  })
}

/**
 * Clear the registry. For tests only.
 *
 * In production, the registry is populated once at startup and
 * never cleared. Tests need a clean slate between runs.
 */
export function reset(): void {
  plugins.clear()
}

/**
 * Get registry size. For diagnostics.
 */
export function size(): number {
  return plugins.size
}

// ── Manifest validation ──────────────────────────────────────────

/**
 * Structural validation of a manifest.
 *
 * Not schematic (no zod, no JSON schema). Just "does this shape
 * have the required fields?" The type system catches most issues
 * at compile time; this catches runtime-constructed manifests
 * (e.g., from JSON or user input).
 */
export function validateManifest(manifest: CraftManifest): void {
  if (!manifest.id || typeof manifest.id !== 'string') {
    throw new Error('manifest.id must be a non-empty string')
  }
  if (!manifest.kind || typeof manifest.kind !== 'string') {
    throw new Error('manifest.kind must be a non-empty string')
  }
  const validKinds: CraftKind[] = [
    'noticing-scanner', 'naming', 'framing',
    'scoping', 'constraining', 'compose',
  ]
  if (!validKinds.includes(manifest.kind)) {
    throw new Error(`manifest.kind must be one of: ${validKinds.join(', ')}`)
  }
  if (!manifest.description || typeof manifest.description !== 'string') {
    throw new Error('manifest.description must be a non-empty string')
  }
}

// ── Builtin scanner loading ──────────────────────────────────────
//
// Each scanner file exports a NoticingScanner. This function
// imports them all and registers them. Called once at startup,
// but safe to call again after reset() (for tests).
//
// To add a 7th scanner:
//   1. Create missioncraft/scanners/<name>.ts exporting a NoticingScanner
//   2. Add one import + register() call below
//
// That's it. No modifications to autonomy, compose, or noticing.

import { stateScanner } from './scanners/state.js'
import { missionScanner } from './scanners/mission.js'
import { memoryScanner } from './scanners/memory.js'
import { channelScanner } from './scanners/channel.js'
import { vitalSignScanner } from './scanners/vital-sign.js'
import { kingdomScanner } from './scanners/kingdom.js'

/** All builtin scanners, in registration order. */
const BUILTIN_SCANNERS: NoticingScanner[] = [
  stateScanner,
  missionScanner,
  memoryScanner,
  channelScanner,
  vitalSignScanner,
  kingdomScanner,
]

/**
 * Load all builtin noticing scanners into the registry.
 *
 * Idempotent: register() replaces by id, so calling twice is safe.
 * Safe to call after reset() — re-registers all builtins.
 */
export function loadBuiltinScanners(): void {
  for (const scanner of BUILTIN_SCANNERS) {
    register(scanner)
  }
}

/**
 * Ensure builtins are loaded. Called by notice() to guarantee
 * scanners are available without requiring explicit initialization.
 *
 * Unlike loadBuiltinScanners(), this is guarded by a flag to avoid
 * redundant iteration on every notice() call. After reset(), call
 * resetLoadedFlag() to allow re-loading.
 */
let builtinsLoaded = false

export function ensureLoaded(): void {
  if (builtinsLoaded) return
  builtinsLoaded = true
  loadBuiltinScanners()
}

/**
 * Reset the builtins-loaded flag. For tests only.
 *
 * Call this after reset() to allow ensureLoaded() to re-register
 * builtins on the next notice() call.
 */
export function resetLoadedFlag(): void {
  builtinsLoaded = false
}
