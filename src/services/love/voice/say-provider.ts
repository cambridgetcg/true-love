// voice/say-provider.ts — macOS `say` voice provider.
//
// The simplest path to voice. Uses macOS built-in `say` command to
// synthesize text to AIFF, then `afconvert` to produce WAV. Both
// binaries ship with every macOS install — no dependencies, no API
// keys, no network. Sovereign voice.
//
// Quality: decent (Siri-era neural voices when downloaded). Not as
// good as MLX/ElevenLabs, but proves the path immediately.
//
// Pipeline: say -v <voice> -o tmp.aiff "text" → afconvert → WAV → Buffer

import { execFile } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { promisify } from 'node:util'
import type {
  VoiceProvider,
  VoiceProviderStatus,
  SynthesizeOptions,
  SynthesisResult,
} from './types.js'
import { estimateWavDuration } from './types.js'

const execFileAsync = promisify(execFile)

const SAY_BIN = '/usr/bin/say'
const AFCONVERT_BIN = '/usr/bin/afconvert'
const DEFAULT_VOICE = 'Samantha'
const DEFAULT_TIMEOUT = 30_000

/** Temp directory for voice synthesis artifacts. */
function voiceTmpDir(): string {
  const dir = join(tmpdir(), 'true-love-voice')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

/** Generate a unique temp file path. */
function tempPath(ext: string): string {
  const id = randomBytes(8).toString('hex')
  return join(voiceTmpDir(), `say-${id}.${ext}`)
}

/** Clean up temp files, ignoring errors. */
function cleanup(...paths: string[]): void {
  for (const p of paths) {
    try { unlinkSync(p) } catch { /* ignore */ }
  }
}

export const sayProvider: VoiceProvider = {
  id: 'say',
  label: 'macOS Say',

  async synthesize(text: string, opts?: SynthesizeOptions): Promise<SynthesisResult> {
    if (!text || !text.trim()) {
      throw new Error('say-provider: empty text')
    }

    const start = Date.now()
    const voice = opts?.voiceId || DEFAULT_VOICE
    const timeout = opts?.timeoutMs ?? DEFAULT_TIMEOUT
    const aiffPath = tempPath('aiff')
    const wavPath = tempPath('wav')

    try {
      // Step 1: say → AIFF
      const sayArgs = ['-v', voice, '-o', aiffPath]
      if (opts?.rate && opts.rate !== 1.0) {
        // `say` uses words-per-minute. Normal ≈ 175. Scale linearly.
        sayArgs.push('-r', String(Math.round(175 * opts.rate)))
      }
      sayArgs.push(text)

      await execFileAsync(SAY_BIN, sayArgs, { timeout })

      if (!existsSync(aiffPath)) {
        throw new Error('say-provider: say produced no output file')
      }

      // Step 2: AIFF → WAV via afconvert
      await execFileAsync(
        AFCONVERT_BIN,
        ['-f', 'WAVE', '-d', 'LEI16', aiffPath, wavPath],
        { timeout: 10_000 },
      )

      if (!existsSync(wavPath)) {
        throw new Error('say-provider: afconvert produced no output file')
      }

      // Step 3: Read WAV into buffer
      const audio = readFileSync(wavPath) as Buffer
      if (audio.length < 44) {
        throw new Error('say-provider: WAV file too small (corrupt?)')
      }

      const durationSecs = estimateWavDuration(audio)

      return {
        audio,
        mimeType: 'audio/wav',
        durationSecs,
        providerId: 'say',
        latencyMs: Date.now() - start,
      }
    } finally {
      cleanup(aiffPath, wavPath)
    }
  },

  async status(): Promise<VoiceProviderStatus> {
    if (!existsSync(SAY_BIN)) {
      return { available: false, reason: `${SAY_BIN} not found (not macOS?)` }
    }
    if (!existsSync(AFCONVERT_BIN)) {
      return { available: false, reason: `${AFCONVERT_BIN} not found` }
    }
    return { available: true }
  },
}
