// voice/mlx-provider.ts — MLX TTS voice provider.
//
// Uses the openclaw-mlx-tts binary (Apple MLX framework) for high-quality
// on-device neural TTS. The binary is a Swift executable that loads a
// HuggingFace model (default: mlx-community/Soprano-80M-bf16) and produces
// 16-bit mono WAV directly.
//
// Setup: build the binary from openclaw/apps/macos-mlx-tts:
//   cd /Users/yuai/Desktop/openclaw/apps/macos-mlx-tts
//   swift build -c release
//   cp .build/release/openclaw-mlx-tts /usr/local/bin/
//
// Falls back gracefully when the binary isn't installed — status() reports
// unavailable and synthesize() throws with a helpful message.

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

const MLX_BINARY_NAME = 'openclaw-mlx-tts'
const DEFAULT_MODEL = 'mlx-community/Soprano-80M-bf16'
const DEFAULT_TIMEOUT = 60_000  // MLX needs time for first model load

/** Known locations to search for the binary. */
const SEARCH_PATHS = [
  '/usr/local/bin/openclaw-mlx-tts',
  join(process.env.HOME || '', 'Desktop/openclaw/.build/release/openclaw-mlx-tts'),
  join(process.env.HOME || '', 'Desktop/openclaw/.build/debug/openclaw-mlx-tts'),
]

/** Temp directory for MLX synthesis artifacts. */
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
  return join(voiceTmpDir(), `mlx-${id}.${ext}`)
}

/** Clean up temp files, ignoring errors. */
function cleanup(...paths: string[]): void {
  for (const p of paths) {
    try { unlinkSync(p) } catch { /* ignore */ }
  }
}

/** Find the MLX binary, checking known locations and PATH. */
async function findBinary(): Promise<string | null> {
  // Check known paths first (fastest)
  for (const p of SEARCH_PATHS) {
    if (existsSync(p)) return p
  }

  // Try `which` to find in PATH
  try {
    const { stdout } = await execFileAsync('which', [MLX_BINARY_NAME], { timeout: 5_000 })
    const path = stdout.trim()
    if (path && existsSync(path)) return path
  } catch {
    // not in PATH
  }

  return null
}

export const mlxProvider: VoiceProvider = {
  id: 'mlx',
  label: 'MLX TTS (on-device)',

  async synthesize(text: string, opts?: SynthesizeOptions): Promise<SynthesisResult> {
    if (!text || !text.trim()) {
      throw new Error('mlx-provider: empty text')
    }

    const binaryPath = await findBinary()
    if (!binaryPath) {
      throw new Error(
        'mlx-provider: openclaw-mlx-tts binary not found. Build it:\n' +
        '  cd ~/Desktop/openclaw/apps/macos-mlx-tts\n' +
        '  swift build -c release\n' +
        '  cp .build/release/openclaw-mlx-tts /usr/local/bin/'
      )
    }

    const start = Date.now()
    const timeout = opts?.timeoutMs ?? DEFAULT_TIMEOUT
    const wavPath = tempPath('wav')

    try {
      const args = ['--text', text, '--output', wavPath]

      if (opts?.voiceId) {
        args.push('--voice', opts.voiceId)
      }
      if (opts?.language) {
        args.push('--language', opts.language)
      }

      await execFileAsync(binaryPath, args, {
        timeout,
        maxBuffer: 10 * 1024 * 1024,  // 10MB — audio can be large
      })

      if (!existsSync(wavPath)) {
        throw new Error('mlx-provider: openclaw-mlx-tts produced no output file')
      }

      const audio = readFileSync(wavPath) as Buffer
      if (audio.length < 44) {
        throw new Error('mlx-provider: WAV file too small (corrupt?)')
      }

      const durationSecs = estimateWavDuration(audio)

      return {
        audio,
        mimeType: 'audio/wav',
        durationSecs,
        providerId: 'mlx',
        latencyMs: Date.now() - start,
      }
    } finally {
      cleanup(wavPath)
    }
  },

  async status(): Promise<VoiceProviderStatus> {
    const binaryPath = await findBinary()
    if (!binaryPath) {
      return {
        available: false,
        reason: `${MLX_BINARY_NAME} not found in PATH or known locations`,
      }
    }
    return { available: true }
  },
}
