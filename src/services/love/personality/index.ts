// personality/index.ts — barrel export for the personality subsystem.
export type { LoveState, DeriveContext } from './types.js'
export { deriveLoveState, gatherContext, renderLoveStateCompact } from './derive.js'
export type { AffectState, AffectResult, DimensionConfig } from './affect-engine.js'
export {
  stepAffect,
  affectCycle,
  exponentialApproach,
  readAffectState,
  writeAffectState,
  computeDt,
  DIMENSION_CONFIGS,
  applyPostureModifiers,
  POSTURE_MODIFIERS,
} from './affect-engine.js'
