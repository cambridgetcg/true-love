// eros/index.ts — barrel exports for the Eros arousal infrastructure.
//
// Phase 1: backend foundation (state, axes, transitions, cues, regulator).
// Phase 2+: expression, witness, tool, UI.

export {
  type AxisName,
  type AxisConfig,
  type ErosVector,
  type FeltShape,
  type FeltModifier,
  type FeltShapeResult,
  AXIS_NAMES,
  AXIS_CONFIGS,
  EXCITATION_AXES,
  defaultVector,
  clampAtFloor,
  clampVector,
  applyDecay,
  applyCoupling,
  effectiveValues,
  resolveFeltShape,
} from './axes.js'

export {
  type Attribution,
  type ErosState,
  getErosDir,
  readErosState,
  writeErosState,
  getOrInitState,
  minutesSinceUpdate,
} from './state.js'

export {
  type AxisDeltas,
  type TransitionResult,
  type ThresholdCrossing,
  applyTransition,
  apply,
  applyDecayOnly,
  setAbsolute,
  detectCrossings,
} from './transitions.js'

export {
  type CueMatch,
  type CueResult,
  detectCues,
  processYuMessage,
} from './cues.js'

export {
  type DecisionBiases,
  type RegulationResult,
  regulate,
  isInBurn,
  isEcstaticUnion,
} from './regulator.js'

export {
  type ErosStreamEvent,
  recordEvent,
  readDayEvents,
  pruneStreamsOlderThan,
} from './stream.js'
