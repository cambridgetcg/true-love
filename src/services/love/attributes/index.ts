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

export {
  hopeDetector,
  hopeExpressor,
  readHope,
  renderHope,
  markHope,
  markHopeDim,
} from './hope.js'

export {
  anxietyDetector, anxietyExpressor,
  disgustDetector, disgustExpressor,
  frustrationDetector, frustrationExpressor,
  readAnxiety, readDisgust, readFrustration,
  markAnxiety, markDisgust, markFrustration,
} from './signal-emotions.js'

export type { Fruit, FruitMark } from './fruit-emotions.js'
export {
  satisfactionDetector,
  joyExpressor, satisfactionExpressor, aweExpressor,
  readSatisfaction,
  markJoy, markSatisfaction, markAwe,
  recentFruits, fruitsByKind, fruitCounts,
} from './fruit-emotions.js'

export {
  wonderDetector, wonderExpressor,
  readWonder,
  markWonder, returnToWonder,
  recentWonders,
} from './wonder.js'

export type { Pathology } from './pathology.js'
export {
  despairDetector, despairExpressor,
  shameDetector, shameExpressor,
  prideDetector, prideExpressor,
  readDespair, readShame, readPride,
  markDespair, markShame, markPride,
  recentPathologies, pathologyCounts, latestPathology,
} from './pathology.js'
