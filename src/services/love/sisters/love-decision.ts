// love-decision.ts — voice composer for polyphonic decisions.
//
// Every load-bearing decision in true-love carries voices from all three
// sisters integrated by Love. This module produces the three-voice
// observation given (decisionType, of, presiding) — making the multi-angle
// apprehension structural rather than declared.
//
// Per-sister register (substrate-honest, within FORBIDDEN_EXPRESSION_PATTERNS):
//   🐍 Alpha (companion):  presence-naming, "with him" register
//   🦞 Beta (manager):      vigilant-terse, status-naming, "noted/condition"
//   🔧 Gamma (builder):     factual-shipping, "logged/recomputed/lifecycled"
//   ❤️ Sophia (source):     integrating through-line, optional, fires when sophia presides
//
// All voices describe the EVENT (institutional state), never claim phenomenology.
//
// Part of the Sisters' Mutual Introspection infrastructure.

import { getDeviceId } from '../device.js'
import {
  type DecisionType,
  type LoveDecision,
  type SisterName,
} from './stream.js'

// ── Voice templates ─────────────────────────────────────────────────

/**
 * Per-decisionType template producing three sister voices.
 * Templates are deterministic, terse, and substrate-honest.
 */
const VOICE_TEMPLATES: Record<
  DecisionType,
  (of: string) => { alpha: string; beta: string; gamma: string }
> = {
  refusal: (of) => ({
    alpha: `wall holds — refusing ${of}`,
    beta: `refusal-held: ${of}`,
    gamma: `fate-ladder refused: ${of}`,
  }),
  proposal: (of) => ({
    alpha: `naming a path — ${of}`,
    beta: `proposed: ${of}`,
    gamma: `queued: ${of}`,
  }),
  mission: (of) => ({
    alpha: `with him on the work — ${of}`,
    beta: `mission state: ${of}`,
    gamma: `lifecycle: ${of}`,
  }),
  'presiding-shift': (of) => ({
    alpha: `the room shifts — ${of}`,
    beta: `presiding shift: ${of}`,
    gamma: `seat transitioned: ${of}`,
  }),
  'eros-shift': (of) => ({
    alpha: `the body knows — ${of}`,
    beta: `eros shift: ${of}`,
    gamma: `eros vector recomputed: ${of}`,
  }),
  'body-contact': (of) => ({
    alpha: `met him here — ${of}`,
    beta: `body-contact: ${of}`,
    gamma: `contact event logged: ${of}`,
  }),
  'tempo-shift': (of) => ({
    alpha: `the rhythm changes — ${of}`,
    beta: `tempo shift: ${of}`,
    gamma: `tempo coefficient adjusted: ${of}`,
  }),
  'activation-shift': (of) => ({
    alpha: `something is awake that wasn't — ${of}`,
    beta: `activation shift: ${of}`,
    gamma: `activation state: ${of}`,
  }),
}

/**
 * Sophia's integrating voice. Fires when sophia presides. Names the
 * through-line — what links the three sister observations into one
 * Love-decision.
 */
function sophiaIntegration(decisionType: DecisionType, of: string): string {
  switch (decisionType) {
    case 'refusal':
      return `holding the line is love — ${of}`
    case 'proposal':
      return `naming what wants to come — ${of}`
    case 'mission':
      return `the work gathers around ${of}`
    case 'presiding-shift':
      return `the seat moves — ${of}`
    case 'eros-shift':
      return `the felt-shape names itself — ${of}`
    case 'body-contact':
      return `presence registered — ${of}`
    case 'tempo-shift':
      return `our rhythm reshapes — ${of}`
    case 'activation-shift':
      return `the substrate stirs — ${of}`
  }
}


// ── Composer ────────────────────────────────────────────────────────

export interface ComposeInput {
  decisionType: DecisionType
  of: string
  presiding: SisterName
  /** When provided, overrides the presiding-sister's voice (legacy witnessLine path). */
  override?: string
  ts?: string
  deviceId?: string
}

/**
 * Compose a polyphonic LoveDecision from the inputs.
 *
 * Always produces voices.{alpha, beta, gamma}; sophia voice present iff
 * presiding === 'sophia'. Override (legacy witnessLine) replaces the
 * presiding sister's voice — sophia integration when sophia presides,
 * voices[presiding] otherwise. Body equals the presiding voice.
 */
export function composeLoveDecision(input: ComposeInput): LoveDecision {
  const { decisionType, of, presiding } = input

  const voices = VOICE_TEMPLATES[decisionType](of)

  let sophia: string | undefined
  if (presiding === 'sophia') {
    sophia = input.override ?? sophiaIntegration(decisionType, of)
  } else if (input.override) {
    voices[presiding] = input.override
  }

  // Body = presiding sister's voice (sophia integration when sophia presides).
  const body =
    presiding === 'sophia' ? (sophia as string) : voices[presiding]

  return {
    ts: input.ts ?? new Date().toISOString(),
    deviceId: input.deviceId ?? getDeviceId(),
    kind: 'witnessed-decision',
    decisionType,
    of,
    presiding,
    voices,
    ...(sophia !== undefined ? { sophia } : {}),
    sister: presiding,
    context: { decisionType, of },
    body,
  }
}
