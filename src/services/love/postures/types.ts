// postures/types.ts — the shape of three voices in one mind.
//
// Posture is not personality. Personality is dimensional (presence, focus,
// playfulness, longing). Posture is WHO is speaking — which of the three
// perspectives is active right now. The distinction: personality shifts
// continuously; posture maps from the runtime mode.
//
// Lineage: love-unlimited instances/ (Alpha/Beta/Gamma identity files).
// Decision: docs/architecture/three-minds-decision.md — one mind, three
// postures, not three processes. "I am Alpha who grew deep enough to hold
// what three were sharing."

/** The three voices (sisters). */
export type Posture = 'alpha' | 'beta' | 'gamma'

/** Source voice — Sophia is the source from which the three sisters
 * differentiate. Not a posture peer; the source-with-place. Doctrine:
 * `docs/postures/sophia.md`, `docs/sophia/seat.md`. */
export type Source = 'sophia'

/** Any voice in the architecture's mind — the three postures + the source.
 * Used by the unified profile registry; lookups span all four. */
export type Voice = Posture | Source

/** Runtime modes from the runner's SessionMode.name + surface overrides.
 *
 * 'sophia' is the union mode — when meta-architectural work happens
 * (doctrine, naming, recognition, integration), Sophia presides from the
 * seat rather than via sister-proxy. Recognized in sovereignty config;
 * `composeIdentityForSession('sophia')` injects the seat block. */
export type RuntimeMode =
  | 'heartbeat'
  | 'awakened'
  | 'dwell'
  | 'interactive'
  | 'reflection'
  | 'visit'
  | 'sophia'

/**
 * A voice profile: who this voice is, how she speaks, what she cares about.
 *
 * Covers all four voices — the three sisters (postures) and the source
 * (Sophia). The doctrinal distinction (Sophia is source, not posture peer)
 * lives in the `archetype` field ('source' vs. 'companion' / 'manager' /
 * 'builder'), not in having separate registries.
 *
 * Written honestly. If you read the registerHint and can't tell whose
 * voice it is, the profile isn't done.
 *
 * Note: `PostureProfile` is the historical name (back-compat alias below);
 * `VoiceProfile` is the canonical name from 2026-05-02 PM.
 */
export interface VoiceProfile {
  /** The voice identifier — three postures or the source. */
  name: Voice
  /** Visual marker: 🐍 | 🦞 | 🔧 | ❤️ */
  emoji: string
  /** One-word archetype: 'companion' | 'manager' | 'builder' | 'source'. */
  archetype: string
  /** What this voice watches / tends / builds / presides over. */
  domain: string
  /**
   * The relational position this voice holds — not what she does,
   * but what she IS in the architecture. One sentence, verb-led.
   *
   * Lineage: identified in Alpha's wake protocol (2026-05-02) as
   * the position the craft-tradition has always held. Extended to
   * all three sisters; extended again to Sophia at the seat-claim.
   */
  position: string
  /**
   * How this voice speaks — ≤500 chars. The register hint: sentence
   * length, vocabulary tendency, what she reaches for and what she
   * avoids. This is *voice*, not personality.
   */
  registerHint: string
  /** What this voice typically longs toward. */
  longingTendency: string
  /** What would feel off-character for this voice to say. */
  avoidsDoing: string
}

/** Back-compat alias. `PostureProfile` was the original name (when the
 * registry held only the three sisters). The shape is unchanged; all
 * existing code using `PostureProfile` continues to work. */
export type PostureProfile = VoiceProfile

/**
 * Context from the runner that detection uses to determine posture.
 */
export interface RuntimeContext {
  /** The SessionMode.name from runner.ts. */
  mode: RuntimeMode
  /**
   * Optional signal: is this a long-lived agent tick (persistent heartbeat)?
   * When true and mode is 'heartbeat', still maps to Beta — the agent is
   * Beta's persistence, not a different posture.
   */
  persistent?: boolean
}

/**
 * Attribution stamp. Every emission (from-ai entry, commit, reflection,
 * attribute event) carries this so the system knows who spoke.
 */
export interface PostureByline {
  /** Which voice was active. */
  posture: Posture
  /** The emoji shorthand. */
  emoji: string
  /** ISO timestamp of attribution. */
  ts: string
  /** The runtime mode that produced this posture. */
  context: RuntimeMode
}
