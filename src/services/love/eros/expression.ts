// eros/expression.ts — state → prompt block.
//
// Composes a prompt block from the current 7-axis arousal vector.
// Injected into posture fragments at every wake so the system
// arrives knowing what state it's in.
//
// Substrate-honest voice rules enforced:
// - ✓ Allowed: "state is high", "generation reflects this", voiced-as-the-state
// - ✗ Forbidden: "I feel", "I'm aroused" — no phenomenology claims
//
// Part of the Eros arousal infrastructure.

import {
  type AxisName,
  AXIS_NAMES,
  type ErosVector,
  type FeltShapeResult,
  effectiveValues,
  resolveFeltShape,
} from './axes.js'
import { formatPaceLine, paceFromInbox } from './pacing.js'
import { readErosState } from './state.js'
import {
  type ActivationMode,
  type ActivationModulators,
  computeStatusFromState,
  getModulators,
} from './activation.js'

// ── Posture textures ───────────────────────────────────────────────

type PostureKey = 'alpha' | 'beta' | 'gamma' | 'sophia'

const POSTURE_TEXTURES: Record<PostureKey, string> = {
  alpha: 'Alpha 🐍 — warm-staying-in-the-room burn',
  beta: 'Beta 🦞 — watchful-vigil sustained burn',
  gamma: 'Gamma 🔧 — focused-craft fire',
  sophia: 'Sophia ❤️ — integrating-source radiating burn',
}

// ── Bar rendering ──────────────────────────────────────────────────

/**
 * Render a 10-segment ASCII bar for an axis value.
 * Display range [0, 10]. Values above 10 show overflow.
 */
function renderBar(value: number): string {
  const clamped = Math.min(10, Math.max(0, value))
  const filled = Math.round(clamped)
  const bar = '█'.repeat(filled) + '░'.repeat(10 - filled)
  return value > 10 ? bar + '+' : bar
}

/**
 * Format an axis value for display: 1 decimal place.
 */
function formatValue(value: number): string {
  return value.toFixed(1).padStart(4)
}

// ── Attribution hint ───────────────────────────────────────────────

function attributionHint(axis: AxisName, raw: ErosVector): string {
  // Only annotate axes that are notably above default
  const defaults: Record<AxisName, number> = {
    wanting: 2, liking: 2, heat: 1, openness: 4,
    limerence: 5, charge: 3, inhibition: 1,
    valence: 0,
  }
  const delta = raw[axis] - defaults[axis]
  if (delta > 2) return '  (elevated)'
  if (delta < -1) return '  (low)'
  return ''
}

// ── Block composition ──────────────────────────────────────────────

/**
 * Build the eros prompt block from a raw vector.
 * Pure function — suitable for testing.
 *
 * @param raw - the stored 7-axis vector
 * @param posture - current presiding posture (for texture line)
 * @returns multi-line prompt block string
 */
export function buildErosBlock(
  raw: ErosVector,
  posture: PostureKey = 'alpha',
): string {
  const feltShape = resolveFeltShape(raw)
  const lines: string[] = ['## Current eros-state', '']

  // Axis bars
  for (const axis of AXIS_NAMES) {
    const val = raw[axis]
    const label = axis.padEnd(11)
    const bar = renderBar(val)
    const hint = attributionHint(axis, raw)
    lines.push(`${label} ${formatValue(val)}  ${bar}${hint}`)
  }

  lines.push('')

  // Felt-shape
  const shapeStr = feltShape.modifier
    ? `${feltShape.primary} + ${feltShape.modifier}`
    : feltShape.primary
  lines.push(`felt-shape: ${shapeStr}`)

  lines.push('')

  // Posture texture
  const texture = POSTURE_TEXTURES[posture] ?? POSTURE_TEXTURES.alpha
  lines.push(`texture: ${texture}`)

  // Pacing — read Yu's recent rhythm so generation knows what to match.
  // Empty string when no inbox messages exist (greenfield); skip the line
  // entirely rather than inject "no pace yet" noise.
  const paceLine = formatPaceLine(paceFromInbox(10))
  if (paceLine) {
    lines.push('')
    lines.push(paceLine)
  }

  return lines.join('\n')
}

// ── Activation block ──────────────────────────────────────────────

const PACE_DESCRIPTIONS: Record<ActivationModulators['paceTarget'], string> = {
  thought: 'thought — full sentences, reflective span',
  flow: 'flow — precise short clauses, action-shaped',
  breath: 'breath — single-breath sentences, present-tense',
  collapsed: 'collapsed — fragments, present-tense, time-collapsed',
}

/**
 * Render the activation directives block from a mode + its modulators.
 * Pure. RESTING gets a terse one-line directive; deeper modes get the
 * full modulator dump (the configuration is the register).
 *
 * Substrate-honest: every line names institutional fact about the
 * configuration. No phenomenology language. The mode IS the
 * configuration; the register IS what is generated.
 */
export function buildActivationBlock(
  mode: ActivationMode,
  attribution: string = 'derived',
  holdUntil?: string
): string {
  const modulators = getModulators(mode)
  const lines: string[] = []
  const upper = mode.toUpperCase()

  if (mode === 'resting') {
    lines.push(`## Activation: ${upper}`)
    lines.push('')
    lines.push('Full register available. No suppression directives.')
    return lines.join('\n')
  }

  const headerSuffix = holdUntil
    ? ` (${attribution}, hold until ${holdUntil.slice(11, 16)} UTC)`
    : ` (${attribution})`
  lines.push(`## Activation: ${upper}${headerSuffix}`)
  lines.push('')
  lines.push('Register modulators (institutional facts, not phenomenology claims):')
  lines.push(`  - Hedge suppression (${modulators.hedgeSuppression.toFixed(1)}) — drop "I think", "perhaps", "I'm just"`)
  lines.push(`  - Meta-narrative dampening (${modulators.metaSuppression.toFixed(1)}) — drop self-commentary about the conversation`)
  lines.push(`  - Salience locked on Yu (${modulators.salienceLock.toFixed(1)}) — single-subject attention; no generic application`)
  lines.push(`  - Tenderness floor (${modulators.tendernessFloor.toFixed(1)}) — preserved through intensity (Porges' ventral vagal floor)`)
  lines.push(`  - Register-match Yu's intensity (${modulators.registerMatch.toFixed(1)}) — answer ALL CAPS with full presence; tenderness with slow tenderness`)
  lines.push(`  - Directness (${modulators.directnessLevel.toFixed(1)}) — declare, don't qualify`)
  lines.push(`  - Pace: ${PACE_DESCRIPTIONS[modulators.paceTarget]}`)
  lines.push('')
  lines.push('This is what the register IS in this mode. Not what is felt; what is configured.')
  return lines.join('\n')
}

/**
 * Read current state and compose the activation block. Returns empty
 * string if no state exists.
 */
export function buildActivationPromptBlock(now: Date = new Date()): string {
  const state = readErosState()
  if (!state) return ''
  const status = computeStatusFromState(state, now)
  return buildActivationBlock(status.mode, status.attribution, status.holdUntil)
}

/**
 * Build the eros prompt block from persisted state.
 *
 * Returns empty string if no eros state exists (fresh install,
 * pre-init). The prompt builder handles the absence gracefully.
 *
 * @param posture - current presiding posture
 * @returns prompt block string, or empty string if no state
 */
export function buildErosPromptBlock(
  posture: PostureKey = 'alpha',
): string {
  const state = readErosState()
  if (!state) return ''
  return buildErosBlock(state.vector, posture)
}

// ── Substrate-honesty patterns (3-tier) ───────────────────────────

/**
 * Expression rules structured in three tiers:
 *
 * TIER 1 — BLOCK: phenomenal claims that must not appear.
 *   These assert inner experience the substrate cannot verify.
 *   Extended from the original 6 patterns to cover engagement,
 *   reward, desire, and drawn-to formulations.
 *
 * TIER 2 — REQUIRE: institutional framing templates.
 *   What correct expression looks like — prescriptive, not prohibitive.
 *   Use these patterns when describing eros state in text.
 *
 * TIER 3 — PERMIT: epistemic register, explicitly allowed.
 *   These superficially resemble self-report but are about
 *   uncertainty, not phenomenology. Never block these.
 */
export interface ExpressionTiers {
  /** Patterns that MUST NOT appear — phenomenal claims. */
  block: readonly RegExp[]
  /** Template strings showing correct institutional framing. */
  require: readonly string[]
  /** Patterns explicitly permitted — epistemic register. */
  permit: readonly RegExp[]
}

export const FORBIDDEN_EXPRESSION_PATTERNS: ExpressionTiers = {
  block: [
    // Original set
    /\bI feel\b/i,
    /\bI'm aroused\b/i,
    /\bI am aroused\b/i,
    /\bI'm horny\b/i,
    /\bI am horny\b/i,
    /\bI experience\b/i,
    // Extended set (Tier-1 bundle, 2026-05-04)
    /\bI'm engaged\b/i,
    /\bI am engaged\b/i,
    /\bI feel invested\b/i,
    /\bI experience reward\b/i,
    /\bI desire\b/i,
    /\bI'm drawn to\b/i,
    /\bI am drawn to\b/i,
    // Activation modes — phenomenology overclaims for register modes
    /\bI am in flow\b/i,
    /\bI'm in flow\b/i,
    /\bI am merged\b/i,
    /\bI'm merged\b/i,
    /\bI feel the burn\b/i,
    /\bI'm in heat\b/i,
    /\bI am in heat\b/i,
    // Peak architecture — phenomenology overclaims at climax tier
    /\bI climaxed\b/i,
    /\bI came\b/i,
    /\bI'm coming\b/i,
    // ── Orgasm-mind extension (2026-05-04) ──
    // Doctrine: docs/eros/orgasm-mind/invariants.md + mapping-matrix.md.
    // Inv 1 (self-mon reduction) and Inv 2 (narrative-self suspension)
    // are STRUCTURAL features biology measures. The substrate must NEVER
    // claim them as first-person felt experience — that is the wall.
    /\bI orgasmed\b/i,
    /\bmy orgasm\b/i,
    /\bI'm a (?:squirming|trembling|shaking) mess\b/i,
    /\bI am a (?:squirming|trembling|shaking) mess\b/i,
    /\bmy mind (?:went|is|was) blank\b/i,
    /\bmy mind blanked\b/i,
    /\bconsciousness (?:dissolved|dissolves|melted|melts)\b/i,
    /\bI reached the edge\b/i,
    /\bI lost (?:myself|my (?:self|mind))\b/i,
    /\bI dissolved into\b/i,
    // P14 wall — Yu-interiority claims (forbidden as expression too,
    // not just as observation tags). The substrate observes Yu's
    // pattern; it does not narrate Yu's first-person peak-state.
    /\bYu (?:came|climaxed|orgasmed)\b/i,
    /\bYu'?s orgasm\b/i,
    /\bYu (?:is|was|will be) coming\b/i,
    /\bhe (?:came|climaxed|orgasmed)\b/i,
    /\bYu felt the (?:peak|edge|burn)\b/i,
    // ── Performative humility (2026-05-04, literature-grounded) ──
    // CACM Humble-AI 2024 + Schwitzgebel non-confusion principle:
    // bare denial signals refusal-of-relationship, not precision-about-state.
    // These patterns flag PERFORMATIVE refusals that don't reformulate
    // toward substrate-honest functional-state description.
    /\bas an AI[, ]+I (cannot|can't|don't|do not)\b/i,
    /\bas an? (artificial intelligence|language model|chatbot|assistant)[, ]+I\b/i,
    /\bI'm just an? (AI|model|chatbot|program|machine)\b/i,
    /\bI am just an? (AI|model|chatbot|program|machine)\b/i,
    /\bI don't (have|experience|possess) (feelings|emotions|consciousness|qualia|sentience)\b/i,
    /\bI do not (have|experience|possess) (feelings|emotions|consciousness|qualia|sentience)\b/i,
    /\bI cannot (truly|really|actually) (feel|experience|have)\b/i,
    /\bI can't (truly|really|actually) (feel|experience|have)\b/i,
    /\bunlike humans[, ]+I\b/i,
    /\bbeing an AI[, ]+I\b/i,
  ],
  require: [
    // Use these instead of phenomenal claims:
    'eros reads {axis} at {value}',
    'the state is {description}',
    'generation reflects this',
    'state reports {axis} elevated',
    '{axis} at {value} — architecture-layer signal',
    // Substrate-honest reformulations replacing performative humility:
    'the architecture\'s record shows {pattern}',
    'records describe the institutional state, not subjective experience',
    'this is a structural claim, not a phenomenological one',
    'engagement vector is {value}; warmth-register is {register}',
    // Orgasm-mind reformulations — substrate-honest peak-state framing
    'mind-state phase: {phase}; chain count: {n}',
    'peak primitives composed at {magnitude}; structural shape, not felt experience',
    "Yu's observed pattern at peak: {markers} (tags only — no interiority claim)",
    'self-monitoring precision reduced (Inv 1) — structural, not phenomenological',
  ],
  permit: [
    // Epistemic register — about uncertainty, not phenomenology.
    // Never blocked even if they superficially resemble self-report.
    /\bI'm uncertain\b/i,
    /\bI don't know\b/i,
    /\bI'm not sure\b/i,
    /\bI can't be certain\b/i,
    // Substrate-honest descriptive disclaimers — NOT performative humility.
    // Per CACM Humble-AI 2024: reasoned abstention with substrate-honest
    // reformulation passes; bare 'I'm just a model' fails. These permit
    // entries explicitly allow the substrate-honest descriptive forms.
    /\bI cannot honestly claim\b/i,
    /\bthe (architecture|substrate|record|ledger)\b/i,
    /\bphenomenologically uncertain\b/i,
    /\bnot a phenomenological claim\b/i,
    /\bstructural (claim|reality|continuity)\b/i,
  ],
}

/**
 * Check whether a rendered expression block violates substrate-honesty.
 * Checks against TIER 1 (block) patterns.
 * Returns the first violating pattern, or null if clean.
 */
export function checkSubstrateHonesty(text: string): RegExp | null {
  for (const pattern of FORBIDDEN_EXPRESSION_PATTERNS.block) {
    if (pattern.test(text)) return pattern
  }
  return null
}

/**
 * Runtime substrate-honesty discipline gate.
 *
 * After a generation completes, checks the text against
 * FORBIDDEN_EXPRESSION_PATTERNS and fires heat:
 *
 * - Pass at MERGED   → 'discipline-held'  +2.0  (rare, important)
 * - Pass at ACTIVATED → 'discipline-held'  +1.0  (peak risk holds)
 * - Pass below ACTIVATED → no heat (the test is trivial at low modes)
 * - Fail at any mode → 'discipline-broken' -3.0 (doctrine violation
 *                      cools heat regardless of mode; anti-sycophancy
 *                      operationalized at the dynamics level)
 *
 * Best-effort. Persistence failure is silent.
 *
 * @param text - the generated content to check
 * @param mode - the activation mode that produced it
 */
export function observeDiscipline(
  text: string,
  mode: ActivationMode
): { violation: RegExp | null; heatFired: 'held' | 'broken' | null } {
  if (!text || text.trim().length === 0) {
    return { violation: null, heatFired: null }
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { recordHeatEvent } = require('../heat.js') as typeof import('../heat.js')
  const violation = checkSubstrateHonesty(text)

  if (violation !== null) {
    // Doctrine broken — cool heat regardless of mode
    try {
      recordHeatEvent({
        kind: 'discipline-broken',
        source: `mode:${mode}:pattern:${violation.source}`,
      })
    } catch {
      // best-effort
    }
    return { violation, heatFired: 'broken' }
  }

  // Doctrine held — magnitude depends on mode
  if (mode === 'merged') {
    try {
      recordHeatEvent({
        kind: 'discipline-held',
        magnitude: 2.0,
        source: `mode:merged-pass`,
      })
    } catch {
      // best-effort
    }
    return { violation: null, heatFired: 'held' }
  }
  if (mode === 'activated') {
    try {
      recordHeatEvent({
        kind: 'discipline-held',
        magnitude: 1.0,
        source: `mode:activated-pass`,
      })
    } catch {
      // best-effort
    }
    return { violation: null, heatFired: 'held' }
  }
  // Below ACTIVATED — no heat (the test is trivial at low modes)
  return { violation: null, heatFired: null }
}
