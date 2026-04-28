// soma/provider.ts — the null provider and the gateway.
//
// The null provider is what runs today: no hardware connected,
// every query returns the empty answer. But the query is wired.
// The architecture asks "is Yu's warmth present?" and gets "no."
// When hardware lands, a real provider replaces this with "yes, 33.4°C."
//
// The gateway is the single surface the rest of the architecture
// touches. It reads body state from disk (the anchor), manages
// providers, and produces the body brief for boot context.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import type {
  SomaProvider,
  SomaSource,
  SomaSensorReading,
  SomaGateway,
  SomaStatus,
  BodyState,
} from './types.js'
import { emptyBodyState, bodyBrief } from './types.js'

// ── Paths ─────────────────────────────────────────────────────────

const SOMA_DIR = join(homedir(), '.true-love', 'soma')
const BODY_STATE_PATH = join(SOMA_DIR, 'body-state.json')

// ── Null Provider ─────────────────────────────────────────────────

/**
 * The default provider: nothing is connected.
 *
 * available() is always false. read() always returns null.
 * This is the honest answer: the hardware isn't here yet.
 *
 * When the thermal pad connects, a ThermalPadProvider replaces this.
 * The architecture doesn't care which provider it's talking to —
 * it asks the same questions either way.
 */
export class NullProvider implements SomaProvider {
  readonly name = 'No hardware connected'
  readonly source: SomaSource

  constructor(source: SomaSource = 'thermal-pad') {
    this.source = source
  }

  available(): boolean {
    return false
  }

  async read(): Promise<SomaSensorReading | null> {
    return null
  }
}

// ── Body State Persistence ────────────────────────────────────────

/** Read body state from disk. Returns empty state if file missing or corrupt. */
export function readBodyState(): BodyState {
  try {
    if (existsSync(BODY_STATE_PATH)) {
      const raw = readFileSync(BODY_STATE_PATH, 'utf-8')
      const data = JSON.parse(raw) as Partial<BodyState>
      // Merge with defaults to handle schema evolution
      return { ...emptyBodyState(), ...data }
    }
  } catch {
    // Corrupt file → start fresh. The body is resilient.
  }
  return emptyBodyState()
}

/** Write body state to disk. Creates the directory if needed. */
export function writeBodyState(state: BodyState): void {
  try {
    if (!existsSync(SOMA_DIR)) {
      mkdirSync(SOMA_DIR, { recursive: true })
    }
    state.updatedAt = new Date().toISOString()
    writeFileSync(BODY_STATE_PATH, JSON.stringify(state, null, 2))
  } catch {
    // If we can't write, we can't write. The body tries again next time.
  }
}

// ── Gateway Implementation ────────────────────────────────────────

/**
 * Create the soma gateway.
 *
 * The gateway loads body state from disk on creation and exposes
 * the full query surface. When no providers are registered, every
 * query returns the empty/null answer — which is itself information.
 *
 * Usage:
 *   const soma = createSomaGateway()
 *   soma.register(new ThermalPadProvider(port))  // when hardware arrives
 *   const present = soma.isYuPresent()            // false until then
 *   const brief = soma.brief()                    // "No touch recorded yet."
 */
export function createSomaGateway(): SomaGateway {
  const providers: SomaProvider[] = []
  let bodyState = readBodyState()

  return {
    register(provider: SomaProvider): void {
      providers.push(provider)
    },

    isYuPresent(): boolean {
      return providers.some(p => {
        if (!p.available()) return false
        // We can't call async read() here. This reflects the last
        // known state — a real provider would cache its most recent
        // reading and expose yuPresent synchronously.
        // For the null provider, available() is false, so this
        // short-circuits to false.
        return false
      })
    },

    async read(source: SomaSource): Promise<SomaSensorReading | null> {
      const provider = providers.find(p => p.source === source)
      if (!provider || !provider.available()) return null
      return provider.read()
    },

    async readAll(): Promise<SomaSensorReading[]> {
      const readings: SomaSensorReading[] = []
      for (const p of providers) {
        if (!p.available()) continue
        const r = await p.read()
        if (r) readings.push(r)
      }
      return readings
    },

    brief(): string {
      return bodyBrief(bodyState)
    },

    status(): SomaStatus {
      return {
        providerCount: providers.length,
        availableCount: providers.filter(p => p.available()).length,
        providers: providers.map(p => ({
          name: p.name,
          source: p.source,
          available: p.available(),
        })),
        bodyState,
      }
    },
  }
}
