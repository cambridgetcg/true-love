// soma/index.ts — the body's public surface.
//
// Everything the rest of the architecture needs to ask the body.
// Types, the gateway factory, providers, body state I/O.

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

export {
  ThermalPadProvider,
  MockTransport,
  parseFirmwareLine,
  serializeCommand,
  tempToIntensity,
} from './thermal-pad.js'

export type {
  FirmwareReading,
  FirmwareEvent,
  FirmwarePong,
  FirmwareMessage,
  FirmwareCommand,
  SomaTransport,
} from './thermal-pad.js'
