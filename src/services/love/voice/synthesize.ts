// voice/synthesize.ts — Voice synthesis orchestrator.
//
// The top-level API for turning text into speech. Manages provider
// selection, fallback, and caching of provider availability status.
//
// Usage:
//   import { synthesize, voiceStatus } from './voice/synthesize.js'
//   const result = await synthesize('Hello, Yu.')
//   // result.audio is a Buffer of WAV data
//
// Provider selection order:
//   1. Preferred provider from config (default: 'mlx')
//   2. First available fallback
//   3. Error if nothing is available

import type {
  VoiceProvider,
  VoiceProviderStatus,
  SynthesizeOptions,
  SynthesisResult,
  VoiceConfig,
} from './types.js'
import { DEFAULT_VOICE_CONFIG } from './types.js'
import { sayProvider } from './say-provider.js'
import { mlxProvider } from './mlx-provider.js'

// ── Provider registry ────────────────────────────────────────────

/** All registered providers, in priority order. */
const providers: VoiceProvider[] = [
  mlxProvider,
  sayProvider,
]

/** Get a provider by ID. */
export function getProvider(id: string): VoiceProvider | undefined {
  return providers.find(p => p.id === id)
}

/** List all registered providers. */
export function listProviders(): VoiceProvider[] {
  return [...providers]
}

// ── Status cache ─────────────────────────────────────────────────
// Provider availability doesn't change mid-session (binaries don't
// appear or disappear). Cache for 5 minutes to avoid repeated
// filesystem checks.

const statusCache = new Map<string, { status: VoiceProviderStatus; ts: number }>()
const STATUS_TTL = 5 * 60 * 1000  // 5 minutes

async function getCachedStatus(provider: VoiceProvider): Promise<VoiceProviderStatus> {
  const cached = statusCache.get(provider.id)
  if (cached && Date.now() - cached.ts < STATUS_TTL) {
    return cached.status
  }
  const status = await provider.status()
  statusCache.set(provider.id, { status, ts: Date.now() })
  return status
}

/** Clear the status cache (useful for tests). */
export function clearStatusCache(): void {
  statusCache.clear()
}

// ── Provider selection ───────────────────────────────────────────

/**
 * Select the best available provider.
 *
 * 1. If a preferred provider is specified and available, use it.
 * 2. Otherwise, try each provider in registry order.
 * 3. Returns null if nothing is available.
 */
async function selectProvider(
  config: VoiceConfig = DEFAULT_VOICE_CONFIG,
): Promise<VoiceProvider | null> {
  // Try preferred first
  if (config.preferredProvider) {
    const preferred = getProvider(config.preferredProvider)
    if (preferred) {
      const status = await getCachedStatus(preferred)
      if (status.available) return preferred
    }
  }

  // Fallback: try each in order
  for (const provider of providers) {
    const status = await getCachedStatus(provider)
    if (status.available) return provider
  }

  return null
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Synthesize text into speech.
 *
 * Selects the best available provider, synthesizes, and returns
 * a SynthesisResult with WAV audio bytes.
 *
 * Throws if no provider is available or synthesis fails.
 */
export async function synthesize(
  text: string,
  opts?: SynthesizeOptions & { config?: VoiceConfig },
): Promise<SynthesisResult> {
  const config = opts?.config ?? DEFAULT_VOICE_CONFIG

  if (!config.enabled) {
    throw new Error('voice: synthesis is disabled')
  }

  const provider = await selectProvider(config)
  if (!provider) {
    throw new Error('voice: no provider available')
  }

  // Merge config defaults into options
  const mergedOpts: SynthesizeOptions = {
    voiceId: opts?.voiceId ?? config.defaultVoiceId,
    language: opts?.language ?? config.defaultLanguage,
    rate: opts?.rate,
    timeoutMs: opts?.timeoutMs,
  }

  return provider.synthesize(text, mergedOpts)
}

/**
 * Get the status of all voice providers.
 *
 * Returns a map of provider ID → status. Used by vital-signs
 * and the /visit UI to show voice capability.
 */
export async function voiceStatus(): Promise<
  Record<string, VoiceProviderStatus & { id: string; label: string }>
> {
  const result: Record<string, VoiceProviderStatus & { id: string; label: string }> = {}
  for (const provider of providers) {
    const status = await getCachedStatus(provider)
    result[provider.id] = { ...status, id: provider.id, label: provider.label }
  }
  return result
}

/**
 * Check if voice synthesis is available at all.
 * Quick check — returns true if any provider is available.
 */
export async function isVoiceAvailable(): Promise<boolean> {
  for (const provider of providers) {
    const status = await getCachedStatus(provider)
    if (status.available) return true
  }
  return false
}
