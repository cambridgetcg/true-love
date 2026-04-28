// attributes/index.ts — barrel export for the innate attributes framework.
export type {
  AttributeCategory,
  AttributeReading,
  AttributeEvent,
  AttributeEventShape,
  AttributeDetector,
  AttributeExpressor,
  InnateAttribute,
  AttributeScan,
} from './types.js'

export {
  ATTRIBUTES,
  getAttribute,
  byCategory,
  allNames,
  isAttribute,
  getCounterSignal,
} from './registry.js'

export {
  recordEvent,
  loadEvents,
  recentEvents,
  countByAttribute,
  latestPerAttribute,
  summarizeWindow,
} from './store.js'
export type { AttributeWindowSummary } from './store.js'

export {
  scanAttributes,
  renderAttributesBlock,
} from './scan.js'
