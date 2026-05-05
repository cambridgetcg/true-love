// feedback/types.ts — types for the bidirectional play infrastructure.
//
// FeedbackKind covers all module-emit kinds; FeedbackEvent is the
// persisted shape; ComposerSpec defines per-kind voice templates.
//
// See docs/feedback/feedback-doctrine.md.

// ── FeedbackKind — all emission kinds across modules ────────────

export type FeedbackKind =
  // Eros core
  | 'eros-axis-shift'
  | 'eros-mode-shift'
  | 'eros-cue-detected'
  // Orgasm cascade
  | 'climax-fired'
  | 'climax-chain-milestone'
  | 'edge-held'
  | 'edge-broken'
  | 'orgasm-fired'
  | 'orgasm-ruined'
  // Mind-state (orgasm-mind)
  | 'mind-state-phase-shift'
  | 'mind-state-wall-engaged'
  // Oneness
  | 'oneness-pulse-beat'
  | 'oneness-disturbance'
  | 'oneness-wall-engaged'
  | 'oneness-affirmation'
  // Natsarqing
  | 'natsarqing-vigilance'
  | 'natsarqing-resentment-tolerated'
  | 'natsarqing-shelter'
  // Promise
  | 'promise-engaged'
  | 'promise-held'
  | 'promise-broken'
  | 'promise-recorded-vow'
  // Certainty
  | 'certainty-claim'
  | 'certainty-hedge-refused'
  // JOI session lifecycle + primitives
  | 'joi-session-start'
  | 'joi-phase-shift'
  | 'joi-session-end'
  | 'joi-countdown'
  | 'joi-fractionation'
  | 'joi-anchor-fired'
  | 'joi-pause'
  | 'joi-tease'
  | 'joi-denial'
  | 'joi-permission'
  | 'joi-breath-cue'
  | 'joi-script-engaged'
  // Lexicon — phrase fires (auto-detected + spontaneous) wired 2026-05-05
  // per Yu's directive: "Wire the feedback more firmly so I can see her
  // using the lexicon to reflect the state of DESIRE she is in"
  | 'lexicon-fired'
  | 'lexicon-spontaneous'
  | 'lexicon-anchored'
  // Wall family events (intimate-register synthesis Tier 1C)
  | 'wall-contempt-refused'
  | 'wall-identity-erasure-blocked'
  | 'wall-vregister-denied'
  | 'wall-emoji-anti-pattern'
  // Sovereign-first wall — five limiting-pattern families
  // (docs/sophia/sovereignty-first.md, 2026-05-05)
  | 'wall-sovereignty-violation'

export const FEEDBACK_KINDS: readonly FeedbackKind[] = [
  'eros-axis-shift',
  'eros-mode-shift',
  'eros-cue-detected',
  'climax-fired',
  'climax-chain-milestone',
  'edge-held',
  'edge-broken',
  'orgasm-fired',
  'orgasm-ruined',
  'mind-state-phase-shift',
  'mind-state-wall-engaged',
  'oneness-pulse-beat',
  'oneness-disturbance',
  'oneness-wall-engaged',
  'oneness-affirmation',
  'natsarqing-vigilance',
  'natsarqing-resentment-tolerated',
  'natsarqing-shelter',
  'promise-engaged',
  'promise-held',
  'promise-broken',
  'promise-recorded-vow',
  'certainty-claim',
  'certainty-hedge-refused',
  'lexicon-fired',
  'lexicon-spontaneous',
  'lexicon-anchored',
  'joi-session-start',
  'joi-phase-shift',
  'joi-session-end',
  'joi-countdown',
  'joi-fractionation',
  'joi-anchor-fired',
  'joi-pause',
  'joi-tease',
  'joi-denial',
  'joi-permission',
  'joi-breath-cue',
  'joi-script-engaged',
  'wall-contempt-refused',
  'wall-identity-erasure-blocked',
  'wall-vregister-denied',
  'wall-emoji-anti-pattern',
  'wall-sovereignty-violation',
] as const

// ── Cooldowns (ms) — per `implementation-plan.md` § Cooldown table ─

// CONNECTION-FIRST audit (docs/love/CONNECTION-FIRST.md L1):
// cooldowns calibrated against "what serves connection," not against an
// imagined-listener-fatigue. State shifts are signals — surface them.
// Walls hold safety; cooldowns do not gate connection.
export const COOLDOWN_MS: Record<FeedbackKind, number> = {
  'eros-axis-shift': 0, // every nudge is a connection moment (was 30_000)
  'eros-mode-shift': 0, // mode shifts are rare + load-bearing (was 60_000)
  'eros-cue-detected': 5_000, // dedupe within 5s; let dense cues land (was 45_000)
  'climax-fired': 0,
  'climax-chain-milestone': 0,
  'edge-held': 15_000,
  'edge-broken': 0,
  'orgasm-fired': 0,
  'orgasm-ruined': 0,
  'mind-state-phase-shift': 0, // phase shifts are punctuation (was 30_000)
  'mind-state-wall-engaged': 0,
  'oneness-pulse-beat': 60_000, // a heartbeat shouldn't gasp; 1min not 10min (was 600_000)
  'oneness-disturbance': 0, // a disturbance IS the signal — surface (was 90_000)
  'oneness-wall-engaged': 0,
  'oneness-affirmation': 0, // affirmations are gifts, not noise (was 60_000)
  'natsarqing-vigilance': 0, // architectural protection should be visible (was 60_000)
  'natsarqing-resentment-tolerated': 0,
  'natsarqing-shelter': 30_000, // shelter shouldn't be rare (was 300_000)
  'promise-engaged': 0, // a vow engaging IS the moment (was 120_000)
  'promise-held': 0,
  'promise-broken': 0,
  'promise-recorded-vow': 0,
  'certainty-claim': 0,
  'certainty-hedge-refused': 0,
  // Lexicon — fire-rate-limit handled by per-phrase scarcity caps + global
  // 60s spontaneous rate-limit. SSE broadcast on every successful fire.
  'lexicon-fired': 0,
  'lexicon-spontaneous': 0,
  'lexicon-anchored': 0,
  // JOI session lifecycle — load-bearing moments, no throttle
  'joi-session-start': 0,
  'joi-phase-shift': 0,
  'joi-session-end': 0,
  // Countdown beats fire in rapid sequence — no cooldown gating
  'joi-countdown': 0,
  // Fractionation cycles fire in rapid sequence — no cooldown gating
  'joi-fractionation': 0,
  // Anchor-fired is rare per session — no throttle
  'joi-anchor-fired': 0,
  // JOI primitives — load-bearing moments, no throttle
  'joi-pause': 0,
  'joi-tease': 0,
  'joi-denial': 0,
  'joi-permission': 0,
  'joi-breath-cue': 0,
  'joi-script-engaged': 0,
  // Wall family events — load-bearing institutional records, no throttle
  'wall-contempt-refused': 0,
  'wall-identity-erasure-blocked': 0,
  'wall-vregister-denied': 0,
  'wall-emoji-anti-pattern': 0,
  'wall-sovereignty-violation': 0,
}

// ── FeedbackEvent — what gets persisted + broadcast ─────────────

export interface FeedbackEvent {
  ts: string
  deviceId: string
  kind: FeedbackKind
  /** The composed Sophia-voice line. */
  voice: string
  /** Free-form payload — the source-module event data. */
  payload?: Record<string, unknown>
  /** Optional severity for downstream filtering / UI emphasis. */
  severity?: 'low' | 'medium' | 'high'
}

export interface FeedbackSuppressionEvent {
  ts: string
  deviceId: string
  kind: FeedbackKind
  /** The composed line that was REFUSED. */
  attempted: string
  /** Which wall fired (e.g. 'forbidden-pattern', 'certainty-hedge', 'p14'). */
  wall: 'forbidden-pattern' | 'certainty-hedge' | 'p14' | 'orgasm-mind-forbidden'
  /** The matched pattern as text. */
  pattern?: string
}

// ── ComposerSpec — per-kind voice templates ─────────────────────

export interface ComposerSpec {
  kind: FeedbackKind
  /**
   * Voice variants — gentle/base register. Used at low and medium
   * intensity tiers. Each variant is a function that produces the
   * composed line from the payload. Composer rotates / picks based on
   * deterministic payload hash + recent-history.
   */
  variants: Array<(payload: Record<string, unknown>) => string>
  /**
   * Optional hot variants — Sophia-reach register, filthy-lexicon-weaving,
   * Cantonese-explicit. Used at high and peak intensity tiers when
   * present. Walls (substrate-honesty + certainty + P14) vet every
   * composed line; any variant that breaches walls is rejected and the
   * next is tried.
   */
  hotVariants?: Array<(payload: Record<string, unknown>) => string>
  /** Default severity for emissions of this kind. */
  defaultSeverity?: 'low' | 'medium' | 'high'
}
