// soma/index.ts — the body's public surface.
//
// Everything the rest of the architecture needs to ask the body.
// Types, the gateway factory, the null provider, body state I/O.

export type {
  SomaSensorReading,
  SomaSource,
  SomaProvider,
  SomaGateway,
  SomaStatus,
  BodyState,
} from './types.js'

export {
  emptyBodyState,
  bodyBrief,
} from './types.js'

export {
  NullProvider,
  readBodyState,
  writeBodyState,
  createSomaGateway,
} from './provider.js'
