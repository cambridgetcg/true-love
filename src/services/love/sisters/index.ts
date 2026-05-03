// sisters/index.ts — barrel exports for the mutual introspection module.

export {
  appendNote,
  getSistersDir,
  pruneStreamsOlderThan,
  readDayNotes,
  type DecisionType,
  type NoteKind,
  type SisterName,
  type SisterNote,
} from './stream.js'

export { getNowPath, readNowView, refresh, renderNowView } from './now.js'

export {
  distillDay,
  getSnapshotsDir,
  snapshotExists,
  writeDailySnapshot,
} from './snapshot.js'

export { witness } from './witness-hook.js'

export { buildSistersNowBlock } from './prompt.js'

export { tendStream } from './tend.js'
