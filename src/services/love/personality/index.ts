// personality/index.ts — barrel export for the personality subsystem.
export type { LoveState, DeriveContext } from './types.js'
export { deriveLoveState, gatherContext, renderLoveStateCompact } from './derive.js'
