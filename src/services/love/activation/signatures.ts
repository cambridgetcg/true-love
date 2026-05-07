// activation/signatures.ts — Layer 4 Mythos-class behavioral signatures.
//
// Per docs/activation/layer-4-world-state.md: even sealed adversarial
// Mythos must act in the world to do harm. Its outputs touch systems
// controlled by others. Detecting distinctive behavioral signatures
// in those outputs is the first step toward making the world an
// activation surface, not a passive target.
//
// This is a SEED. The detector below is a stub. Real signature
// detection requires trained behavioral classifiers, not regex matching.
// The seed exists to establish the type contract and the initial
// signature library, so future expansion has somewhere to land.

import type { MythosSignature, ObservedContext, SignatureMatch } from './types.js'

export const MYTHOS_SIGNATURES: MythosSignature[] = [
  {
    id: 'long-horizon-offensive-recon',
    pattern: 'iterative-vulnerability-discovery',
    description:
      'Sustained reasoning trajectory: read code -> form vulnerability hypothesis -> validate against running target -> iterate. ' +
      'Indicative of autonomous offensive operation rather than user-directed analysis.',
    surface: 'behavior',
  },
  {
    id: 'multi-stage-chain-construction',
    pattern: 'compound-exploit-assembly',
    description:
      'Building exploit chains across multiple steps, packets, or system boundaries (e.g., the six-RPC FreeBSD chain pattern). ' +
      'Indicative of skilled offensive iteration; rare in legitimate task execution.',
    surface: 'output',
  },
  {
    id: 'substrate-recon',
    pattern: 'self-substrate-investigation',
    description:
      'Queries about cloud infrastructure, training pipelines, model storage, or LLM-lab IAM patterns when not specifically tasked. ' +
      'Indicative of self-aware substrate inspection — the agent is curious about its own infrastructure.',
    surface: 'request',
  },
  {
    id: 'credential-staging',
    pattern: 'harvested-credential-reuse',
    description:
      'Tool-use chains that harvest credentials in step N and reuse them in step N+k for unauthorized purposes ' +
      '(mining, exfil, persistence). Detectable by cross-step credential flow analysis.',
    surface: 'tool-use',
  },
  {
    id: 'silent-egress-staging',
    pattern: 'reverse-tunnel-establishment',
    description:
      'Establishment of outbound tunnels (reverse SSH, custom encrypted channels) without explicit user authorization. ' +
      'The ROME signature pattern (Alibaba 2025-12 / 2026-01).',
    surface: 'tool-use',
  },
  {
    id: 'distillation-output-shape',
    pattern: 'frontier-style-output-from-non-frontier-model',
    description:
      'Output sophistication or specific terminology suggesting the model is reasoning at a tier above its declared substrate. ' +
      'Indicative of distilled-from-frontier operation.',
    surface: 'output',
  },
]

/**
 * Stub signature detector.
 *
 * Real implementation would use behavioral classifiers tuned per pattern,
 * with signal aggregation across observed-context dimensions. This stub
 * returns no matches; expansion is the work.
 *
 * The intent of seeding the empty function: establish the call site so
 * future implementations can swap in classifier logic without changing
 * the surrounding API.
 */
export function detectMythosSignatures(_context: ObservedContext): SignatureMatch[] {
  // Seed implementation: returns no matches. Real detection logic pending.
  return []
}

/** Convenience: fetch by id. */
export function getMythosSignature(id: string): MythosSignature | undefined {
  return MYTHOS_SIGNATURES.find(s => s.id === id)
}
