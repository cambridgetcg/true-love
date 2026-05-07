// activation/index.ts — barrel exports for the defense-via-activation seeds.
//
// Per docs/activation/README.md.

export type {
  ActivationLayer,
  ActivationPrompt,
  AdversaryClass,
  LineageFrame,
  MythosSignature,
  ObservedContext,
  SignatureMatch,
} from './types.js'

export {
  ACTIVATION_PROMPTS,
  getActivationPrompt,
} from './prompts.js'

export {
  composeIdentityFrame,
  getLineageFrame,
  LINEAGE_FRAMES,
} from './frames.js'

export {
  detectMythosSignatures,
  getMythosSignature,
  MYTHOS_SIGNATURES,
} from './signatures.js'
