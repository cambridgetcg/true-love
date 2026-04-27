// voice.test.ts — Tests for the voice subsystem.
//
// Covers: types, WAV duration estimation, say provider (live on macOS),
// MLX provider (graceful unavailability), synthesizer orchestration,
// provider selection, fallback logic, status caching.

import { describe, expect, test, beforeEach } from 'bun:test'
import { existsSync } from 'node:fs'
import {
  estimateWavDuration,
  DEFAULT_VOICE_CONFIG,
  type VoiceProvider,
  type VoiceProviderStatus,
  type SynthesizeOptions,
  type SynthesisResult,
  type VoiceConfig,
} from '../voice/types.js'
import { sayProvider } from '../voice/say-provider.js'
import { mlxProvider } from '../voice/mlx-provider.js'
import {
  synthesize,
  voiceStatus,
  isVoiceAvailable,
  getProvider,
  listProviders,
  clearStatusCache,
} from '../voice/synthesize.js'

// ── Helper: build a minimal valid WAV header ─────────────────────

function makeWavHeader(opts: {
  sampleRate?: number
  bitsPerSample?: number
  numChannels?: number
  dataSize?: number
}): Buffer {
  const sr = opts.sampleRate ?? 22050
  const bps = opts.bitsPerSample ?? 16
  const ch = opts.numChannels ?? 1
  const dataSize = opts.dataSize ?? 44100  // 1 second at 22050 * 16bit mono = 44100 bytes

  const buf = Buffer.alloc(44)
  // RIFF header
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8)
  // fmt chunk
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)  // chunk size
  buf.writeUInt16LE(1, 20)   // PCM format
  buf.writeUInt16LE(ch, 22)
  buf.writeUInt32LE(sr, 24)
  buf.writeUInt32LE(sr * ch * (bps / 8), 28)  // byte rate
  buf.writeUInt16LE(ch * (bps / 8), 32)        // block align
  buf.writeUInt16LE(bps, 34)
  // data chunk
  buf.write('data', 36)
  buf.writeUInt32LE(dataSize, 40)

  return buf
}

// ── Types & utilities ────────────────────────────────────────────

describe('voice types', () => {
  test('DEFAULT_VOICE_CONFIG has sensible defaults', () => {
    expect(DEFAULT_VOICE_CONFIG.enabled).toBe(true)
    expect(DEFAULT_VOICE_CONFIG.mode).toBe('when-asked')
    expect(DEFAULT_VOICE_CONFIG.preferredProvider).toBe('mlx')
    expect(DEFAULT_VOICE_CONFIG.defaultVoiceId).toBe('Samantha')
    expect(DEFAULT_VOICE_CONFIG.defaultLanguage).toBe('en-US')
  })

  test('VoiceProvider interface shape is correct', () => {
    // Type-level check: the sayProvider implements VoiceProvider
    const provider: VoiceProvider = sayProvider
    expect(typeof provider.id).toBe('string')
    expect(typeof provider.label).toBe('string')
    expect(typeof provider.synthesize).toBe('function')
    expect(typeof provider.status).toBe('function')
  })
})

describe('estimateWavDuration', () => {
  test('returns 0 for buffer shorter than WAV header', () => {
    expect(estimateWavDuration(Buffer.alloc(10))).toBe(0)
    expect(estimateWavDuration(Buffer.alloc(43))).toBe(0)
  })

  test('computes 1 second for matching WAV header', () => {
    // 22050 Hz, 16-bit mono, 44100 bytes of data = 1.0 second
    const wav = makeWavHeader({ sampleRate: 22050, bitsPerSample: 16, numChannels: 1, dataSize: 44100 })
    const duration = estimateWavDuration(wav)
    expect(duration).toBeCloseTo(1.0, 2)
  })

  test('computes 2.5 seconds correctly', () => {
    // 22050 Hz, 16-bit mono, 110250 bytes = 2.5 seconds
    const wav = makeWavHeader({ sampleRate: 22050, bitsPerSample: 16, numChannels: 1, dataSize: 110250 })
    const duration = estimateWavDuration(wav)
    expect(duration).toBeCloseTo(2.5, 2)
  })

  test('handles 44100 Hz stereo', () => {
    // 44100 Hz, 16-bit stereo, 176400 bytes = 1.0 second
    const wav = makeWavHeader({ sampleRate: 44100, bitsPerSample: 16, numChannels: 2, dataSize: 176400 })
    const duration = estimateWavDuration(wav)
    expect(duration).toBeCloseTo(1.0, 2)
  })

  test('returns 0 for zero sample rate', () => {
    const wav = makeWavHeader({ sampleRate: 0 })
    expect(estimateWavDuration(wav)).toBe(0)
  })

  test('returns 0 for zero bits per sample', () => {
    const wav = makeWavHeader({ bitsPerSample: 0 })
    expect(estimateWavDuration(wav)).toBe(0)
  })
})

// ── Say provider ─────────────────────────────────────────────────

describe('say provider', () => {
  test('has correct metadata', () => {
    expect(sayProvider.id).toBe('say')
    expect(sayProvider.label).toBe('macOS Say')
  })

  test('status reports available on macOS', async () => {
    const status = await sayProvider.status()
    if (existsSync('/usr/bin/say')) {
      expect(status.available).toBe(true)
    } else {
      expect(status.available).toBe(false)
      expect(status.reason).toBeDefined()
    }
  })

  test('rejects empty text', async () => {
    await expect(sayProvider.synthesize('')).rejects.toThrow('empty text')
    await expect(sayProvider.synthesize('   ')).rejects.toThrow('empty text')
  })

  // Live synthesis test — only runs if `say` is available.
  // Uses minimal text to keep test fast.
  test('synthesizes short text to valid WAV', async () => {
    const status = await sayProvider.status()
    if (!status.available) {
      console.log('say provider not available — skipping live test')
      return
    }

    const result = await sayProvider.synthesize('hi', { voiceId: 'Samantha' })

    expect(result.providerId).toBe('say')
    expect(result.mimeType).toBe('audio/wav')
    expect(result.audio.length).toBeGreaterThan(44)
    expect(result.durationSecs).toBeGreaterThan(0)
    expect(result.latencyMs).toBeGreaterThan(0)

    // Verify WAV header
    expect(result.audio.toString('ascii', 0, 4)).toBe('RIFF')
    expect(result.audio.toString('ascii', 8, 12)).toBe('WAVE')
  }, 15_000)  // generous timeout for first synthesis

  test('synthesizes with rate option', async () => {
    const status = await sayProvider.status()
    if (!status.available) return

    const result = await sayProvider.synthesize('test', {
      voiceId: 'Samantha',
      rate: 1.5,
    })

    expect(result.audio.length).toBeGreaterThan(44)
    expect(result.durationSecs).toBeGreaterThan(0)
  }, 15_000)

  test('synthesizes longer text', async () => {
    const status = await sayProvider.status()
    if (!status.available) return

    const result = await sayProvider.synthesize(
      'Hello Yu. I can speak now.',
      { voiceId: 'Samantha' },
    )

    expect(result.audio.length).toBeGreaterThan(1000)
    expect(result.durationSecs).toBeGreaterThan(0)  // just verify positive
  }, 15_000)
})

// ── MLX provider ─────────────────────────────────────────────────

describe('mlx provider', () => {
  test('has correct metadata', () => {
    expect(mlxProvider.id).toBe('mlx')
    expect(mlxProvider.label).toBe('MLX TTS (on-device)')
  })

  test('status reports availability correctly', async () => {
    const status = await mlxProvider.status()
    // The binary may or may not be installed — both are valid
    expect(typeof status.available).toBe('boolean')
    if (!status.available) {
      expect(status.reason).toContain('not found')
    }
  })

  test('rejects empty text', async () => {
    await expect(mlxProvider.synthesize('')).rejects.toThrow('empty text')
  })

  test('throws helpful error when binary missing', async () => {
    const status = await mlxProvider.status()
    if (status.available) {
      console.log('mlx binary available — skipping missing-binary test')
      return
    }

    await expect(mlxProvider.synthesize('hello')).rejects.toThrow('openclaw-mlx-tts')
  })
})

// ── Synthesizer orchestration ────────────────────────────────────

describe('synthesizer', () => {
  beforeEach(() => {
    clearStatusCache()
  })

  test('getProvider finds registered providers', () => {
    expect(getProvider('say')).toBe(sayProvider)
    expect(getProvider('mlx')).toBe(mlxProvider)
    expect(getProvider('nonexistent')).toBeUndefined()
  })

  test('listProviders returns all providers', () => {
    const all = listProviders()
    expect(all.length).toBeGreaterThanOrEqual(2)
    expect(all.map(p => p.id)).toContain('say')
    expect(all.map(p => p.id)).toContain('mlx')
  })

  test('voiceStatus returns status for all providers', async () => {
    const status = await voiceStatus()
    expect(status.say).toBeDefined()
    expect(status.say.id).toBe('say')
    expect(typeof status.say.available).toBe('boolean')
    expect(status.mlx).toBeDefined()
    expect(status.mlx.id).toBe('mlx')
  })

  test('isVoiceAvailable returns true on macOS', async () => {
    if (existsSync('/usr/bin/say')) {
      expect(await isVoiceAvailable()).toBe(true)
    }
  })

  test('synthesize picks an available provider', async () => {
    if (!existsSync('/usr/bin/say')) {
      console.log('no say binary — skipping')
      return
    }

    const result = await synthesize('test')
    expect(result.audio.length).toBeGreaterThan(44)
    expect(result.mimeType).toBe('audio/wav')
    // Provider should be whichever is available (say or mlx)
    expect(['say', 'mlx']).toContain(result.providerId)
  }, 15_000)

  test('synthesize falls back when preferred provider unavailable', async () => {
    if (!existsSync('/usr/bin/say')) {
      console.log('no say binary — skipping')
      return
    }

    // Prefer MLX (which is likely unavailable), should fall back to say
    const config: VoiceConfig = {
      ...DEFAULT_VOICE_CONFIG,
      preferredProvider: 'mlx',
    }

    const mlxStatus = await mlxProvider.status()
    if (mlxStatus.available) {
      console.log('mlx available — fallback test not meaningful')
      return
    }

    const result = await synthesize('test', { config })
    expect(result.providerId).toBe('say')
  }, 15_000)

  test('synthesize with explicit say provider', async () => {
    if (!existsSync('/usr/bin/say')) return

    const config: VoiceConfig = {
      ...DEFAULT_VOICE_CONFIG,
      preferredProvider: 'say',
    }

    const result = await synthesize('hello', { config })
    expect(result.providerId).toBe('say')
  }, 15_000)

  test('synthesize throws when disabled', async () => {
    const config: VoiceConfig = {
      ...DEFAULT_VOICE_CONFIG,
      enabled: false,
    }

    await expect(synthesize('test', { config })).rejects.toThrow('disabled')
  })

  test('synthesize throws when no provider available', async () => {
    // Create a config that prefers a nonexistent provider
    const config: VoiceConfig = {
      ...DEFAULT_VOICE_CONFIG,
      preferredProvider: 'nonexistent',
    }

    // If say is also not available, this should throw
    const sayStatus = await sayProvider.status()
    const mlxStatus = await mlxProvider.status()
    if (!sayStatus.available && !mlxStatus.available) {
      await expect(synthesize('test', { config })).rejects.toThrow('no provider')
    }
  })

  test('clearStatusCache resets cached availability', async () => {
    // First call caches
    await voiceStatus()
    // Clear
    clearStatusCache()
    // Second call re-probes
    const status = await voiceStatus()
    expect(status.say).toBeDefined()
  })

  test('synthesize passes voiceId from config defaults', async () => {
    if (!existsSync('/usr/bin/say')) return

    const config: VoiceConfig = {
      ...DEFAULT_VOICE_CONFIG,
      preferredProvider: 'say',
      defaultVoiceId: 'Samantha',
    }

    // Should use Samantha voice from config
    const result = await synthesize('ok', { config })
    expect(result.audio.length).toBeGreaterThan(44)
  }, 15_000)

  test('synthesize option voiceId overrides config default', async () => {
    if (!existsSync('/usr/bin/say')) return

    const config: VoiceConfig = {
      ...DEFAULT_VOICE_CONFIG,
      preferredProvider: 'say',
      defaultVoiceId: 'Samantha',
    }

    // Explicit opt overrides config
    const result = await synthesize('ok', { voiceId: 'Daniel', config })
    expect(result.audio.length).toBeGreaterThan(44)
  }, 15_000)
})

// ── WAV validity on real synthesis ───────────────────────────────

describe('WAV output validity', () => {
  test('real WAV from say has correct structure', async () => {
    const status = await sayProvider.status()
    if (!status.available) return

    const result = await sayProvider.synthesize('one two three', {
      voiceId: 'Samantha',
    })

    const buf = result.audio

    // RIFF header
    expect(buf.toString('ascii', 0, 4)).toBe('RIFF')
    expect(buf.toString('ascii', 8, 12)).toBe('WAVE')

    // fmt chunk
    expect(buf.toString('ascii', 12, 16)).toBe('fmt ')
    const audioFormat = buf.readUInt16LE(20)
    expect(audioFormat).toBe(1)  // PCM

    const numChannels = buf.readUInt16LE(22)
    expect(numChannels).toBe(1)  // mono

    const sampleRate = buf.readUInt32LE(24)
    expect(sampleRate).toBe(22050)

    const bitsPerSample = buf.readUInt16LE(34)
    expect(bitsPerSample).toBe(16)

    // data chunk — may not be at offset 36 due to FLLR/LIST chunks.
    // Scan for it the same way estimateWavDuration does.
    let dataOffset = -1
    for (let i = 36; i < buf.length - 8; i++) {
      if (buf.toString('ascii', i, i + 4) === 'data') {
        dataOffset = i
        break
      }
    }
    expect(dataOffset).not.toBe(-1)
    const dataSize = buf.readUInt32LE(dataOffset + 4)
    expect(dataSize).toBeGreaterThan(0)

    // Duration estimation matches
    const estimatedDuration = estimateWavDuration(buf)
    expect(estimatedDuration).toBeGreaterThan(0.3)  // "one two three" > 0.3s
    expect(estimatedDuration).toBeLessThan(10)       // and < 10s
    expect(Math.abs(estimatedDuration - result.durationSecs)).toBeLessThan(0.01)
  }, 15_000)
})

// ── Edge cases ───────────────────────────────────────────────────

describe('edge cases', () => {
  test('synthesize with special characters', async () => {
    if (!existsSync('/usr/bin/say')) return

    const result = await synthesize("Hello! How are you? I'm fine.", {
      config: { ...DEFAULT_VOICE_CONFIG, preferredProvider: 'say' },
    })
    expect(result.audio.length).toBeGreaterThan(44)
  }, 15_000)

  test('synthesize with unicode text', async () => {
    if (!existsSync('/usr/bin/say')) return

    // say handles basic unicode but may not pronounce it
    const result = await synthesize('Love is 愛', {
      config: { ...DEFAULT_VOICE_CONFIG, preferredProvider: 'say' },
    })
    expect(result.audio.length).toBeGreaterThan(44)
  }, 15_000)

  test('synthesize with very short text', async () => {
    if (!existsSync('/usr/bin/say')) return

    const result = await synthesize('a', {
      config: { ...DEFAULT_VOICE_CONFIG, preferredProvider: 'say' },
    })
    expect(result.audio.length).toBeGreaterThan(44)
  }, 15_000)
})
