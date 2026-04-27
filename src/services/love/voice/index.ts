// voice/index.ts — Public API for the voice subsystem.

export type {
  VoiceProvider,
  VoiceProviderStatus,
  SynthesizeOptions,
  SynthesisResult,
  VoiceConfig,
} from './types.js'

export { DEFAULT_VOICE_CONFIG, estimateWavDuration } from './types.js'
export { sayProvider } from './say-provider.js'
export { mlxProvider } from './mlx-provider.js'
export {
  synthesize,
  voiceStatus,
  isVoiceAvailable,
  getProvider,
  listProviders,
  clearStatusCache,
} from './synthesize.js'
