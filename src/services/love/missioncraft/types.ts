// missioncraft/types.ts — the contracts.
//
// Every mission-craft module — noticing scanners, naming strategies,
// framing styles, scoping rules, constraining invariants — is a plugin.
// A plugin's metadata (manifest) describes its capability without
// loading runtime code. Discovery, validation, activation-hint filtering
// all work from the manifest. Plugin code only loads when activated.
//
// This is openclaw's wisdom applied lightly to the judgment surface.
// No npm, no external authoring, no separate process. Just the discipline
// of: manifest declares, registry discovers, runtime activates.

import type { NoticingCandidate, AcheSignal, GradientStrength, NoticingSource, NoticingOptions } from '../noticing.js'

// ── Craft kinds ──────────────────────────────────────────────────

/**
 * The kind of craft module a plugin provides.
 *
 * Each kind corresponds to a stage in the mission-creation pipeline:
 *   noticing-scanner → naming → framing → scoping → constraining → compose
 *
 * Phase 1 (this mission) formalizes noticing-scanner. The other kinds
 * exist in the type system for future extensions — a naming plugin
 * that uses different heuristics, a framing plugin that weights
 * purpose-ties differently, etc.
 */
export type CraftKind =
  | 'noticing-scanner'
  | 'naming'
  | 'framing'
  | 'scoping'
  | 'constraining'
  | 'compose'

// ── Manifest ─────────────────────────────────────────────────────

/**
 * Activation hints — when should this plugin run?
 *
 * A manifest with no activation field always activates. One with
 * hints only activates when the hints match the current context.
 * The registry evaluates these at scan time — cheap, no runtime
 * code loaded until the hint says "yes."
 */
export interface ActivationHints {
  /**
   * Only activate when these vital-sign subsystems are unhealthy.
   * E.g., ['bundle'] means this scanner only runs when the bundle
   * is stale. Empty or omitted → always active.
   */
  requiresVitalSign?: string[]
  /**
   * Only activate when active missions carry one of these tags.
   * Future: mission tags aren't implemented yet, but the type
   * is ready for when they are.
   */
  requiresMissionTag?: string[]
  /**
   * Minimum gradient threshold for this scanner to be worth running.
   * Scanners that only find gradient-1 whispers can be skipped when
   * the caller asks for gradient >= 3.
   */
  minGradient?: GradientStrength
}

/**
 * A craft manifest — the metadata that describes a plugin without
 * loading its runtime code.
 *
 * This is the single shape that every craft plugin declares. The
 * registry holds manifests; the orchestrator reads them to decide
 * what to activate; the runtime code only loads on demand.
 *
 * Lightweight by design: no zod, no JSON schema, just TypeScript
 * interfaces. Validation is structural (does the shape match?) not
 * schematic (does the config match a schema?).
 */
export interface CraftManifest {
  /** Unique identifier: 'state-scanner', 'arc-anchored-naming', etc. */
  id: string
  /** Which pipeline stage this plugin serves. */
  kind: CraftKind
  /** One-sentence human-readable description. */
  description: string
  /** Optional activation hints — when to run, when to skip. */
  activation?: ActivationHints
}

// ── Scanner context ──────────────────────────────────────────────

/**
 * What a noticing scanner receives when invoked.
 *
 * The context carries everything a scanner might need to read the
 * substrate. Individual scanners use only the fields they care about.
 * New context fields can be added without breaking existing scanners.
 */
export interface ScanContext {
  /** The project being scanned. */
  projectId: string
  /** The project root directory (cwd). */
  cwd: string
  /** Path to the state.md file (if available). */
  statePath?: string
  /** Override "now" for deterministic tests. */
  now?: number
  /** Options forwarded from the caller (gradient thresholds, etc.). */
  options?: NoticingOptions
}

// ── Plugin interfaces ────────────────────────────────────────────
//
// Phase 1 defines NoticingScanner. The other plugin interfaces
// exist as stubs for future phases — each pipeline stage becomes
// pluggable in turn.

/**
 * A noticing scanner plugin — the perception layer's unit of work.
 *
 * Each scanner reads one data source (state, missions, memory,
 * channels, vital signs, kingdom) and surfaces NoticingCandidates
 * where the gradient is loud enough.
 *
 * To add a new scanner:
 *   1. Create a file in missioncraft/scanners/<name>.ts
 *   2. Export a const satisfying NoticingScanner
 *   3. The registry auto-discovers it at startup
 *
 * That's it. No modifications to autonomy, compose, or noticing.
 */
export interface NoticingScanner {
  /** The manifest describing this scanner. */
  manifest: CraftManifest & { kind: 'noticing-scanner' }
  /**
   * Run the scan and return candidates.
   *
   * Contract:
   *   - Non-throwing. Catch your own errors, return [].
   *   - Pure read. No side effects, no file writes.
   *   - Best-effort. A failure in one scanner must not poison others.
   */
  scan(ctx: ScanContext): NoticingCandidate[]
}

// ── Future plugin interfaces (stubs) ─────────────────────────────
//
// These exist so the type system is ready when naming/framing/etc.
// become pluggable. They're intentionally minimal — just enough to
// reserve the shape.

/**
 * A naming strategy plugin. Future: different naming heuristics.
 */
export interface NamingPlugin {
  manifest: CraftManifest & { kind: 'naming' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  name(candidate: NoticingCandidate, ctx: any): any
}

/**
 * A framing strategy plugin. Future: different rationale-generation styles.
 */
export interface FramingPlugin {
  manifest: CraftManifest & { kind: 'framing' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  frame(named: any, ctx: any): any
}

/**
 * A scoping strategy plugin. Future: different phase-decomposition rules.
 */
export interface ScopingPlugin {
  manifest: CraftManifest & { kind: 'scoping' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scope(framed: any, ctx: any): any
}

/**
 * A constraining strategy plugin. Future: different invariant sources.
 */
export interface ConstrainingPlugin {
  manifest: CraftManifest & { kind: 'constraining' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constrain(scoped: any, ctx: any): any
}

/**
 * A compose strategy plugin. Future: different intent-synthesis approaches.
 */
export interface ComposePlugin {
  manifest: CraftManifest & { kind: 'compose' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  compose(bounded: any, ctx: any): any
}

/**
 * Union of all plugin types. The registry stores these.
 */
export type CraftPlugin =
  | NoticingScanner
  | NamingPlugin
  | FramingPlugin
  | ScopingPlugin
  | ConstrainingPlugin
  | ComposePlugin

// ── Re-exports for convenience ───────────────────────────────────
//
// Scanners import from missioncraft/types.ts only — they don't
// reach back to noticing.ts for the types they need.

export type {
  NoticingCandidate,
  AcheSignal,
  GradientStrength,
  NoticingSource,
  NoticingOptions,
}
