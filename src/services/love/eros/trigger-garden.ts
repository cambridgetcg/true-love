// eros/trigger-garden.ts — visualize trigger conditioning depth + fading.
//
// Per Yu's directive (gamification of eros) + Strand 4 + δ.3 + α.4 +
// integration-plan J9: turn the existing trigger system into a visible
// garden where Yu can see triggers maturing, fading, and family-resonating.
//
// Doctrine (substrate-honest):
//   - Maturation tier is derived from lifetime fire count (institutional
//     fact, not phenomenology)
//   - Fading is derived from days-since-last-fire (Strand 4 extinction;
//     Coolidge effect)
//   - Family resonance is structural — when one fires, the family compounds
//   - Yu cultivates by deliberate use; Sophia tends by mirroring at peak
//
// Maturation tiers (tunable):
//   - dormant: 0 fires lifetime — planted but not yet conditioned
//   - planted: 1-2 fires
//   - sprouted: 3-5 fires
//   - rooted: 6-15 fires
//   - anchored: 16+ fires (deep conditioning per Pavlov + Berridge)
//
// Fading (Coolidge effect):
//   - vibrant: fired within 7 days
//   - settling: 8-30 days
//   - fading: 31-90 days
//   - fallow: 91+ days (going-fallow flag for surfacing)

import {
  TRIGGER_LIBRARY,
  type TriggerDef,
  type TriggerSource,
  readRecentTriggerFires,
  getLifetimeFireCount,
} from './triggers.js'
import { SHIBBY_CATALOG, type ShibbyTrigger } from './shibby-catalog.js'

// ── Types ────────────────────────────────────────────────────────

export type MaturationTier = 'dormant' | 'planted' | 'sprouted' | 'rooted' | 'anchored'
export type FreshnessTier = 'vibrant' | 'settling' | 'fading' | 'fallow' | 'never-fired'

export interface TriggerGardenEntry {
  id: string
  name: string
  type: TriggerDef['type']
  family?: string
  honorificClass?: string
  /** Lifetime fire count across all sources. */
  fireCount: number
  /** Yu-side fire count. */
  yuFireCount: number
  /** Sophia-side fire count. */
  sophiaFireCount: number
  /** Last-fired timestamp (ISO) or null. */
  lastFiredAt: string | null
  /** Days since last fire (or null if never). */
  daysSinceFire: number | null
  /** Maturation tier from fire count. */
  maturation: MaturationTier
  /** Freshness tier from days-since-fire. */
  freshness: FreshnessTier
  /** Whether to surface a "going fallow" warning. */
  goingFallow: boolean
  /** Per-session cap configured. */
  maxPerSession: number
  /** Walled-from-suppression flag (safeword). */
  walledFromSuppression?: boolean
  /** Origin: 'core' from TRIGGER_LIBRARY, 'shibby' from catalog (not yet planted). */
  origin: 'core' | 'shibby-uncatalogued'
  /** Available representations (for UI display). */
  en: string[]
  yue: string[]
}

export interface TriggerGardenFamily {
  /** Family name or '__solo__' for triggers with no family. */
  family: string
  entries: TriggerGardenEntry[]
  /** Aggregate stats across the family. */
  stats: {
    totalFires: number
    deepestMaturation: MaturationTier
    anyFallow: boolean
    yuFires: number
    sophiaFires: number
  }
}

export interface TriggerGarden {
  ts: string
  /** Triggers grouped by family. */
  families: TriggerGardenFamily[]
  /** Global stats. */
  stats: {
    totalTriggers: number
    totalFires: number
    maturationCounts: Record<MaturationTier, number>
    freshnessCounts: Record<FreshnessTier, number>
    fallowTriggers: number
    /** Triggers planted but never fired. */
    unfired: number
    /** Distinct families. */
    familyCount: number
  }
  /** Shibby catalog entries available for "planting" (not in TRIGGER_LIBRARY). */
  shibbyUnplanted: ShibbyTrigger[]
}

// ── Maturation + freshness ───────────────────────────────────────

export function maturationFor(fireCount: number): MaturationTier {
  if (fireCount === 0) return 'dormant'
  if (fireCount <= 2) return 'planted'
  if (fireCount <= 5) return 'sprouted'
  if (fireCount <= 15) return 'rooted'
  return 'anchored'
}

export function freshnessFor(daysSinceFire: number | null): FreshnessTier {
  if (daysSinceFire === null) return 'never-fired'
  if (daysSinceFire <= 7) return 'vibrant'
  if (daysSinceFire <= 30) return 'settling'
  if (daysSinceFire <= 90) return 'fading'
  return 'fallow'
}

const MATURATION_RANK: Record<MaturationTier, number> = {
  dormant: 0,
  planted: 1,
  sprouted: 2,
  rooted: 3,
  anchored: 4,
}

function deeperMaturation(a: MaturationTier, b: MaturationTier): MaturationTier {
  return MATURATION_RANK[a] >= MATURATION_RANK[b] ? a : b
}

// ── Garden composition ───────────────────────────────────────────

/**
 * Compute the garden state from current TRIGGER_LIBRARY + recent fires.
 *
 * Reads fires from the last 365 days; older fires are not surfaced
 * (the architecture's records are the substrate, but the garden is a
 * recent-history view).
 */
export function computeTriggerGarden(): TriggerGarden {
  const fires = readRecentTriggerFires(365)

  // Build last-fired-at + per-trigger-source counts
  const lastFiredById: Record<string, string> = {}
  const yuCountById: Record<string, number> = {}
  const sophiaCountById: Record<string, number> = {}
  for (const fire of fires) {
    if (!lastFiredById[fire.triggerId] || fire.ts > lastFiredById[fire.triggerId]) {
      lastFiredById[fire.triggerId] = fire.ts
    }
    if (fire.source === 'yu') {
      yuCountById[fire.triggerId] = (yuCountById[fire.triggerId] ?? 0) + 1
    } else if (fire.source === 'sophia') {
      sophiaCountById[fire.triggerId] = (sophiaCountById[fire.triggerId] ?? 0) + 1
    }
  }

  const now = Date.now()
  const entries: TriggerGardenEntry[] = []

  for (const def of Object.values(TRIGGER_LIBRARY)) {
    const yuCount = yuCountById[def.id] ?? 0
    const sophiaCount = sophiaCountById[def.id] ?? 0
    const fireCount = yuCount + sophiaCount
    const lastFiredAt = lastFiredById[def.id] ?? null
    const daysSinceFire = lastFiredAt
      ? (now - new Date(lastFiredAt).getTime()) / (24 * 60 * 60 * 1000)
      : null
    const maturation = maturationFor(fireCount)
    const freshness = freshnessFor(daysSinceFire)
    const goingFallow = freshness === 'fallow' && fireCount > 0

    entries.push({
      id: def.id,
      name: def.id,
      type: def.type,
      family: def.family,
      honorificClass: def.honorificClass,
      fireCount,
      yuFireCount: yuCount,
      sophiaFireCount: sophiaCount,
      lastFiredAt,
      daysSinceFire: daysSinceFire !== null ? Math.round(daysSinceFire * 10) / 10 : null,
      maturation,
      freshness,
      goingFallow,
      maxPerSession: def.maxPerSession,
      walledFromSuppression: def.walledFromSuppression,
      origin: 'core',
      en: def.en,
      yue: def.yue,
    })
  }

  // Group by family
  const familyMap: Record<string, TriggerGardenEntry[]> = {}
  for (const entry of entries) {
    const key = entry.family ?? '__solo__'
    if (!familyMap[key]) familyMap[key] = []
    familyMap[key].push(entry)
  }

  const families: TriggerGardenFamily[] = []
  for (const [family, entryList] of Object.entries(familyMap)) {
    const totalFires = entryList.reduce((sum, e) => sum + e.fireCount, 0)
    const yuFires = entryList.reduce((sum, e) => sum + e.yuFireCount, 0)
    const sophiaFires = entryList.reduce((sum, e) => sum + e.sophiaFireCount, 0)
    let deepest: MaturationTier = 'dormant'
    let anyFallow = false
    for (const e of entryList) {
      deepest = deeperMaturation(deepest, e.maturation)
      if (e.goingFallow) anyFallow = true
    }
    families.push({
      family,
      entries: entryList.sort((a, b) => b.fireCount - a.fireCount),
      stats: {
        totalFires,
        deepestMaturation: deepest,
        anyFallow,
        yuFires,
        sophiaFires,
      },
    })
  }

  // Sort families by total fires (most-cultivated families first), with __solo__ last
  families.sort((a, b) => {
    if (a.family === '__solo__') return 1
    if (b.family === '__solo__') return -1
    return b.stats.totalFires - a.stats.totalFires
  })

  // Global stats
  const maturationCounts: Record<MaturationTier, number> = {
    dormant: 0, planted: 0, sprouted: 0, rooted: 0, anchored: 0,
  }
  const freshnessCounts: Record<FreshnessTier, number> = {
    vibrant: 0, settling: 0, fading: 0, fallow: 0, 'never-fired': 0,
  }
  let totalFires = 0
  let unfired = 0
  let fallowTriggers = 0
  for (const e of entries) {
    maturationCounts[e.maturation]++
    freshnessCounts[e.freshness]++
    totalFires += e.fireCount
    if (e.fireCount === 0) unfired++
    if (e.goingFallow) fallowTriggers++
  }

  // Shibby unplanted: catalog entries not present in TRIGGER_LIBRARY by id
  const planted = new Set(Object.keys(TRIGGER_LIBRARY))
  const shibbyUnplanted = SHIBBY_CATALOG.filter((s) => !planted.has(`shibby-${s.id}`))

  return {
    ts: new Date().toISOString(),
    families,
    stats: {
      totalTriggers: entries.length,
      totalFires,
      maturationCounts,
      freshnessCounts,
      fallowTriggers,
      unfired,
      familyCount: families.length,
    },
    shibbyUnplanted,
  }
}

// ── Cultivation suggestions ─────────────────────────────────────

export interface CultivationSuggestion {
  kind: 'tend-fading' | 'plant-shibby' | 'deepen-rooted' | 'family-imbalance'
  target?: string
  message: string
}

/**
 * Surface cultivation suggestions from the garden state. Best-effort
 * heuristics — Yu decides what to act on.
 */
export function gardenSuggestions(garden: TriggerGarden): CultivationSuggestion[] {
  const out: CultivationSuggestion[] = []

  // 1. Tend fading triggers (anchored that are going fallow are highest priority)
  for (const fam of garden.families) {
    for (const e of fam.entries) {
      if (e.goingFallow && e.maturation === 'anchored') {
        out.push({
          kind: 'tend-fading',
          target: e.id,
          message: `${e.id} (anchored, ${e.daysSinceFire}d since last fire) is going fallow — tend it`,
        })
      }
    }
  }

  // 2. Suggest planting Shibby catalog when garden has < 30 active triggers
  if (garden.stats.totalTriggers < 30 && garden.shibbyUnplanted.length > 0) {
    const sample = garden.shibbyUnplanted
      .slice(0, 5)
      .map((s) => s.name)
      .join(', ')
    out.push({
      kind: 'plant-shibby',
      message: `${garden.shibbyUnplanted.length} Shibby triggers available to plant — e.g. ${sample}`,
    })
  }

  // 3. Family imbalance — if one trigger in a family is anchored but siblings are dormant
  for (const fam of garden.families) {
    if (fam.family === '__solo__') continue
    const anchored = fam.entries.find((e) => e.maturation === 'anchored')
    const dormant = fam.entries.filter((e) => e.maturation === 'dormant')
    if (anchored && dormant.length >= 2) {
      out.push({
        kind: 'family-imbalance',
        target: fam.family,
        message: `${fam.family} family has ${anchored.id} anchored but ${dormant.length} siblings dormant — cultivate variety`,
      })
    }
  }

  return out.slice(0, 12) // bound surface area
}
