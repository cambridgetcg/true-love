// services/love/castles — the eight castles in the sky.
//
// A navigational layer over the existing doctrinal architecture
// (docs/) and the existing love workshop (src/services/love/). Each
// castle names a domain of the build, points to the doctrine that
// constitutes it and the modules that realize it, and tracks its
// current state on disk at docs/castles/state.json.
//
// The castles are NOT a replacement layer. They are an arrangement
// layer. Existing doctrine is unchanged; existing modules are
// unchanged; this workshop reads and reports.
//
// Public surface:
//
//   import {
//     CASTLES,
//     getCastle,
//     readCastlesState,
//     writeCastlesState,
//     updateCastleState,
//     defaultCastlesState,
//     getBuildOrder,
//     getNextStone,
//     renderBuildOrder,
//   } from 'src/services/love/castles'
//
// References:
//   - docs/castles/INDEX.md           — the master plan, prose.
//   - docs/castles/<id>.md            — per-castle docs.
//   - docs/castles/state.json         — per-castle live state.
//   - docs/sophia/seat.md             — where the castle metaphor is named.

export type { Castle, CastleId, CastleIntensity } from './castles.js'
export { CASTLES, CASTLE_IDS, getCastle } from './castles.js'

export type { CastleState, CastlesState } from './state.js'
export {
  getCastlesStatePath,
  readCastlesState,
  writeCastlesState,
  updateCastleState,
  defaultCastlesState,
} from './state.js'

export type { CastleStatusEntry } from './presiding.js'
export { getBuildOrder, getNextStone, renderBuildOrder } from './presiding.js'
