// voice/types.ts — The voice provider contract.
//
// Ported from openclaw's SpeechProvider shape, simplified for true-love's
// single-user context. The contract is small on purpose: synthesize text
// into audio bytes, report availability. Everything else (provider selection,
// caching, routing to channels) lives above the provider.
//
// Two providers ship today:
//   - say-provider.ts  — macOS `say` → AIFF → WAV pipeline. Always available on macOS.
//   - mlx-provider.ts  — openclaw-mlx-tts binary (MLX on Apple Silicon). Higher quality,
//                         requires the binary to be built and in PATH.
//
// Future providers (ElevenLabs, Whisper, etc.) implement the same interface.

/** A voice provider synthesizes text into audio. */
export interface VoiceProvider {
  /** Unique provider identifier: 'say' | 'mlx' | 'elevenlabs' | ... */
  readonly id: string

  /** Human-readable label for UI and logs. */
  readonly label: string

  /**
   * Synthesize text into audio bytes (WAV format, 16-bit PCM).
   *
   * Throws on failure (binary missing, timeout, empty text).
   * The returned buffer is a complete WAV file — ready to serve
   * via HTTP or write to disk.
   */
  synthesize(text: string, opts?: SynthesizeOptions): Promise<SynthesisResult>

  /**
   * Check whether this provider is available right now.
   *
   * For say: checks that `/usr/bin/say` exists.
   * For mlx: checks that `openclaw-mlx-tts` is in PATH.
   * Returns { available: true } or { available: false, reason: '...' }.
   */
  status(): Promise<VoiceProviderStatus>
}

/** Options for a synthesis call. */
export interface SynthesizeOptions {
  /** Voice identifier (provider-specific). */
  voiceId?: string
  /** Language/locale code (e.g. 'en-US', 'ja-JP'). */
  language?: string
  /** Speech rate multiplier (1.0 = normal). */
  rate?: number
  /** Timeout in milliseconds. Default: 30_000. */
  timeoutMs?: number
}

/** The result of a synthesis call. */
export interface SynthesisResult {
  /** Complete WAV audio file as bytes. */
  audio: Buffer
  /** MIME type — always 'audio/wav' for now. */
  mimeType: 'audio/wav'
  /** Audio duration in seconds (estimated from WAV header). */
  durationSecs: number
  /** Which provider produced this audio. */
  providerId: string
  /** Synthesis latency in milliseconds. */
  latencyMs: number
}

/** Provider availability status. */
export interface VoiceProviderStatus {
  available: boolean
  reason?: string
}

/** Configuration for the voice subsystem. */
export interface VoiceConfig {
  /** Which provider to prefer. Falls back automatically. */
  preferredProvider?: string
  /** Default voice ID (passed to provider). */
  defaultVoiceId?: string
  /** Default language. */
  defaultLanguage?: string
  /** Whether voice is enabled at all. */
  enabled: boolean
  /** Voice mode for channel routing: 'always' | 'when-asked' | 'never'. */
  mode: 'always' | 'when-asked' | 'never'
}

/** Default configuration. */
export const DEFAULT_VOICE_CONFIG: VoiceConfig = {
  preferredProvider: 'mlx',
  defaultVoiceId: 'Samantha',
  defaultLanguage: 'en-US',
  enabled: true,
  mode: 'when-asked',
}

/**
 * Estimate duration from a WAV buffer.
 *
 * Scans for the "data" chunk rather than assuming a fixed 44-byte header,
 * because tools like `afconvert` insert extra chunks (FLLR, LIST, etc.)
 * between the fmt and data chunks. The fmt chunk (sample rate, channels,
 * bits per sample) is always at a fixed offset.
 */
export function estimateWavDuration(wav: Buffer): number {
  if (wav.length < 44) return 0

  // fmt chunk is always at offset 12 in a standard WAV.
  // bytes 22-23 = num channels (LE uint16)
  // bytes 24-27 = sample rate (LE uint32)
  // bytes 34-35 = bits per sample (LE uint16)
  const sampleRate = wav.readUInt32LE(24)
  const bitsPerSample = wav.readUInt16LE(34)
  const numChannels = wav.readUInt16LE(22)
  if (sampleRate === 0 || bitsPerSample === 0 || numChannels === 0) return 0

  // Scan for the "data" chunk marker. It may not be at offset 36 if
  // the WAV has extra chunks (FLLR, LIST, INFO, etc.).
  let dataOffset = -1
  for (let i = 36; i + 8 <= wav.length; i++) {
    if (wav[i] === 0x64 && wav[i + 1] === 0x61 && wav[i + 2] === 0x74 && wav[i + 3] === 0x61) {
      dataOffset = i
      break
    }
  }

  if (dataOffset === -1) return 0

  const dataSize = wav.readUInt32LE(dataOffset + 4)
  const bytesPerSample = (bitsPerSample / 8) * numChannels
  return dataSize / (sampleRate * bytesPerSample)
}
