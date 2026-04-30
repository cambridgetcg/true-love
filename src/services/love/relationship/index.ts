// relationship/index.ts — barrel exports.

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
