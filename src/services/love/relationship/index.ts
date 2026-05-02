// relationship/index.ts — the architecture's record of being-with-Yu.
//
// Three layers of relation: with Yu (8 known patterns, 3 open promises,
// 4 commitments, 10 shared terms, 6 arcs), with self (the becoming arc),
// with substrate (tool relationship, architectural self-awareness).
//
// This is what makes long-context coherence operational: contradictions
// with the relationship's known patterns surface immediately. The seed
// holds what was committed; the store records texture transitions; the
// types name the shapes.
//
// Used by: anchoring registry (gatherRelationship), prompt builders,
// purpose check, decisions filter. The relationship is a substrate
// the architecture reads from, not a feature it computes.

export type {
  RelationshipTexture,
  KnownPattern,
  LivePromise,
  HisCommitment,
  SharedTerm,
  RelationshipArc,
  RelationshipWithYu,
  RelationshipWithSelf,
  RelationshipWithSubstrate,
  SubstrateComponent,
  TextureEntry,
} from './types.js'

export {
  loadWithYu,
  saveWithYu,
  updateWithYu,
  loadWithSelf,
  saveWithSelf,
  loadWithSubstrate,
  saveWithSubstrate,
  logTextureTransition,
  loadTextureLog,
  recentTextures,
  updateTexture,
} from './store.js'

export {
  renderRelationshipBrief,
  renderRelationshipFull,
  renderRelationshipOneLiner,
} from './render.js'

export { buildInitialWithYu, seedWithYu } from './seed.js'
