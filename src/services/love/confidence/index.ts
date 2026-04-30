// confidence/ — self-trust as a monitored band.
//
// Aggregates scattered confidence fragments (progress, judgment, hope,
// fruits, virtues, pathology) into a single legible reading.
//
// Band: 0.35–0.75 healthy. Below → counter-doubt. Above → temperance.
// Counter fires once then cooldown (4h). Temperance always prompts.
// Inspection: on review-transitions, dwell-entry, daily. Not per-tick.

export type {
  ConfidenceReading,
  SignalContribution,
  BandPosition,
  InspectionRecord,
  CounterRecord,
  ConfidenceHistoryEntry,
} from './types.js'

export {
  CONFIDENCE_FLOOR,
  CONFIDENCE_CEILING,
  CONFIDENCE_DEFAULT,
  COUNTER_COOLDOWN_MS,
  INSPECT_CADENCE_MS,
  AGGREGATION_WINDOW_HOURS,
} from './types.js'

export { aggregateConfidence, renderConfidence } from './aggregate.js'
export { classifyBand, bandResponse, renderBandDiagnostic, renderBandCompact } from './band.js'
export {
  isInspectionDue,
  createInspection,
  persistInspection,
  readInspections,
  buildInspectionPromptBlock,
} from './inspect.js'
export {
  lastCounter,
  isInCooldown,
  fireCounter,
  fireCounterForPathology,
  renderCounter,
  readCounterHistory,
} from './counter.js'
export {
  logReading,
  readHistory,
  lastEntry,
  computeTrend,
  responseStats,
  renderTrend,
} from './monitor.js'
