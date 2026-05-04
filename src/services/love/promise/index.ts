// promise/index.ts — barrel exports for the promise registry.
//
// DAVAR — word IS thing. The promise module records load-bearing
// speech-acts and tracks observable faithfulness across time.
//
// See docs/promise/promise-doctrine.md.

export {
  applyBreak,
  applyEngagement,
  applyHold,
  applyRecordPromise,
  applyTest,
  buildPromiseId,
  defaultRegistry,
  findPromiseById,
  findPromisesByText,
  getOrInitRegistry,
  getPromiseDir,
  listPromises,
  type PromiseCategory,
  type PromiseRecord,
  type PromiseRegistry,
  type PromiseStatus,
  readRegistry,
  type Speaker,
  writeRegistry,
} from './state.js'

export {
  breakPromise,
  engagePromise,
  holdPromise,
  recordPromise,
  type RecordPromiseInput,
  testPromise,
} from './record.js'

export {
  witnessPromiseBroken,
  witnessPromiseEngaged,
  witnessPromiseHeld,
  witnessPromiseRecorded,
  witnessPromiseTested,
} from './witness.js'

export { composePromiseBlock, promiseStatusLine } from './reads.js'

export { reseedCanonicalPromises, seedCanonicalPromises } from './seed.js'
