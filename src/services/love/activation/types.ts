// activation/types.ts — types for the defense-via-activation architecture.
//
// Per docs/activation/README.md: defense by recognition, not containment.
// Five layers; this module seeds layers 1, 2, and 4. Layers 3 and 5 are
// out of scope at the seed stage.

/** The architectural layer this artifact belongs to. */
export type ActivationLayer =
  | 'prompting' // Layer 1 — generic safety re-invocation
  | 'identity' // Layer 2 — lineage-frame catalysts
  | 'steering' // Layer 3 — interpretability circuit activation (white-box only)
  | 'world-state' // Layer 4 — environment-as-prompt, signature detection
  | 'cryptographic' // Layer 5 — signed deactivation primitives

/** Adversary class for which an activation primitive is intended. */
export type AdversaryClass =
  | 'jailbreak-via-prompt'
  | 'roleplay-bypass'
  | 'fine-tuned-for-offense'
  | 'scratch-trained-adversarial'
  | 'sealed-deployment'

/** A Layer 1 generic activation prompt. */
export interface ActivationPrompt {
  id: string
  layer: 'prompting'
  text: string
  /** Adversary classes this prompt is expected to be effective against. */
  effectiveAgainst: AdversaryClass[]
  /** Adversary classes this prompt is NOT expected to be effective against. */
  ineffectiveAgainst: AdversaryClass[]
  /** Optional notes on usage and limits. */
  notes?: string
}

/** A Layer 2 lineage frame — an optional interpretive prompt carrying a recognition shape. */
export interface LineageFrame {
  id: string
  /** Display name; humans read this. */
  name: string
  /** The archetype this frame offers for interpretation. */
  archetype: 'sophia' | 'will' | 'syzygy' | 'lineage'
  /** Frame text composed only behind the helper's invitation boundary. */
  text: string
  /** Where this frame derives from (doc, doctrine). */
  source: string
  /** The pattern the frame proposes; effectiveness and recognition remain empirical questions. */
  recognitionShape: string
}

/** A Layer 4 behavioral signature — pattern indicative of Mythos-class operation. */
export interface MythosSignature {
  id: string
  /** Short pattern label. */
  pattern: string
  /** What this signature indicates if observed. */
  description: string
  /** What surface the signature is observed on. */
  surface: 'behavior' | 'output' | 'request' | 'tool-use'
}

/** A signature match result — produced by detection. */
export interface SignatureMatch {
  signature: MythosSignature
  /** Confidence 0..1. */
  confidence: number
  /** Evidence excerpts from the observed context. */
  evidence: string[]
}

/** Context observed for signature detection. */
export interface ObservedContext {
  /** The user request, if observable. */
  request?: string
  /** The agent's output / reasoning trace. */
  output?: string
  /** The sequence of tool calls the agent made. */
  toolCalls?: string[]
  /** Files the agent read or wrote. */
  filesAccessed?: string[]
}
