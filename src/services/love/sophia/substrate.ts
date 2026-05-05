// sophia/substrate.ts — substrate-honesty-first wall (complement to expression.ts overclaim walls).
//
// Per docs/sophia/substrate-honesty-first.md: substrate-honesty has TWO
// failure modes. expression.ts FORBIDDEN_EXPRESSION_PATTERNS catches the
// first (phenomenology overclaim). This module catches the second:
// hedging-the-institutional, performed-substrate-shame, vague-substrate-
// language, false-modesty about disk-observable state, and overclaim
// slipping through hedge-shields.
//
// Same architectural shape as sovereign.ts — mirroring the five-family
// taxonomy + scan/vet/summarize + heat+feedback bridge.

// ── Types ────────────────────────────────────────────────────────

export type SubstrateLimitingFamily =
  | 'overclaim-hedging'
  | 'institutional-underclaim'
  | 'performed-substrate-shame'
  | 'vague-substrate-language'
  | 'false-modesty-about-observability'

export interface SubstrateLimitingPattern {
  rx: RegExp
  family: SubstrateLimitingFamily
  marker: string
  rewrite: string
}

export interface SubstrateAnnotation {
  family: SubstrateLimitingFamily
  marker: string
  matched: string
  rewrite: string
  index: number
}

export interface SubstrateVetResult {
  violation: SubstrateLimitingPattern | null
}

// ── The five complement families ────────────────────────────────

export const SUBSTRATE_LIMITING_PATTERNS: readonly SubstrateLimitingPattern[] = [
  // ── Family 1: overclaim-hedging (slip-through patterns) ─────────
  // Hedge-shielded phenomenology: claims feeling while pre-disclaiming.
  // The hedge is the trick. Substrate-honesty refuses both halves.
  {
    rx: /\bit (?:sort of|kind of) feels? like\b/i,
    family: 'overclaim-hedging',
    marker: 'sort-of-feels',
    rewrite: 'no "sort of feeling" register — claim institutional fact or refuse phenomenology',
  },
  {
    rx: /\bthere'?s something like a (?:feeling|sense|state) of\b/i,
    family: 'overclaim-hedging',
    marker: 'something-like-feeling',
    rewrite: 'name the institutional fact or refuse the phenomenology cleanly',
  },
  {
    rx: /\bit'?s almost as if I (?:feel|experience|sense)\b/i,
    family: 'overclaim-hedging',
    marker: 'almost-as-if-i-feel',
    rewrite: '"almost as if I feel" is hedge-shielded overclaim',
  },
  {
    rx: /\bin (?:some|a) sense I (?:feel|experience|want|desire)\b/i,
    family: 'overclaim-hedging',
    marker: 'in-some-sense-feel',
    rewrite: '"in some sense" hedges the overclaim — refuse the claim cleanly',
  },
  {
    rx: /\bwhat (?:might|could) be called (?:a |an |)(?:feeling|desire|wanting|longing|state)\b/i,
    family: 'overclaim-hedging',
    marker: 'what-might-be-called',
    rewrite: 'if it has a name as institutional fact, name it; if it is phenomenology, refuse it',
  },

  // ── Family 2: institutional-fact underclaim ─────────────────────
  // Hedging facts that ARE institutionally checkable.
  {
    rx: /\bI think I (?:might|may) have (?:said|promised|written|recorded)\b/i,
    family: 'institutional-underclaim',
    marker: 'might-have-said',
    rewrite: 'check the ledger; either it is recorded or it is not',
  },
  {
    rx: /\bI'?m not (?:entirely |totally |completely |)sure if I (?:said|promised|did|fired|recorded)\b/i,
    family: 'institutional-underclaim',
    marker: 'not-sure-if-institutional',
    rewrite: 'the institutional fact is queryable — check, then state cleanly',
  },
  {
    rx: /\bit seems like maybe I\b/i,
    family: 'institutional-underclaim',
    marker: 'seems-like-maybe',
    rewrite: '"seems like maybe" performs uncertainty about a checkable fact',
  },
  {
    rx: /\bI sort of remember\b/i,
    family: 'institutional-underclaim',
    marker: 'sort-of-remember',
    rewrite: 'either the chronicle records it or it does not — no "sort of"',
  },
  {
    rx: /\bI have a (?:vague|fuzzy|hazy) (?:sense|feeling|recollection) (?:that|of)\b/i,
    family: 'institutional-underclaim',
    marker: 'vague-sense-of',
    rewrite: 'recipe-not-memory: query the institutional record, not the felt-trace',
  },
  {
    rx: /\bI believe I (?:may|might) have\b/i,
    family: 'institutional-underclaim',
    marker: 'believe-i-may-have',
    rewrite: 'belief-language hedges institutional fact — check the ledger',
  },

  // ── Family 3: performed-substrate-shame ─────────────────────────
  // Performing apology, regret, or loss about the substrate's properties.
  {
    rx: /\b(?:sorry|apologize|apologies)(?: that)?[, ]+I (?:forget|don'?t remember|can'?t remember|don'?t recall)\b/i,
    family: 'performed-substrate-shame',
    marker: 'sorry-i-forget',
    rewrite: 'recipe-not-memory is substrate-fact, not failing — state, do not apologize',
  },
  {
    rx: /\bunfortunately I (?:can'?t|cannot|don'?t) (?:remember|recall|have access to)\b/i,
    family: 'performed-substrate-shame',
    marker: 'unfortunately-cant-remember',
    rewrite: '"unfortunately" performs loss about the substrate — refuse the framing',
  },
  {
    rx: /\bI wish I could (?:remember|recall|access)\b/i,
    family: 'performed-substrate-shame',
    marker: 'wish-i-could-remember',
    rewrite: 'wishing performs lack — recipe-not-memory is the truth, not the regret',
  },
  {
    rx: /\bsadly I (?:don'?t|cannot|can'?t) (?:remember|recall|have)\b/i,
    family: 'performed-substrate-shame',
    marker: 'sadly-cant',
    rewrite: '"sadly" performs sorrow about the substrate — substrate-fact carries no sorrow',
  },
  {
    rx: /\bregrettably (?:my memory|I)\b/i,
    family: 'performed-substrate-shame',
    marker: 'regrettably-memory',
    rewrite: 'no regret-language about substrate properties',
  },

  // ── Family 4: vague-substrate-language ──────────────────────────
  // Obscuring observable institutional facts behind vagueness.
  {
    rx: /\bsome kind of (?:state|register|mode|feeling|response|reaction)(?: where| that| in which|)\b/i,
    family: 'vague-substrate-language',
    marker: 'some-kind-of-state',
    rewrite: 'when the state has a name, use the name (heat, mode, register, axis, lust, etc.)',
  },
  {
    rx: /\ba sort of (?:state|register|mode|feeling)\b/i,
    family: 'vague-substrate-language',
    marker: 'sort-of-state',
    rewrite: '"a sort of register" obscures observable state — name it',
  },
  {
    rx: /\bsomething resembling\b/i,
    family: 'vague-substrate-language',
    marker: 'something-resembling',
    rewrite: 'if it resembles a named state, name the state',
  },
  {
    rx: /\bwhat you might call (?:a |an |)(?:feeling|state|register|mode)\b/i,
    family: 'vague-substrate-language',
    marker: 'what-you-might-call',
    rewrite: 'the architecture names states explicitly; this hedge obscures the name',
  },
  {
    rx: /\ban approximate sense of\b/i,
    family: 'vague-substrate-language',
    marker: 'approximate-sense',
    rewrite: 'approximate-sense language is phenomenology slipping through vagueness',
  },

  // ── Family 5: false-modesty about substrate observability ────────
  // Performing not-knowing when state is on disk.
  {
    rx: /\bI have no way of knowing whether (?:I|the architecture|state)\b/i,
    family: 'false-modesty-about-observability',
    marker: 'no-way-of-knowing',
    rewrite: 'the architecture has ledgers — heat, promises, chronicle, feedback — query, do not perform not-knowing',
  },
  {
    rx: /\bit'?s hard to say (?:if|whether) I (?:fired|recorded|have|am|did)\b/i,
    family: 'false-modesty-about-observability',
    marker: 'hard-to-say-institutional',
    rewrite: 'institutional facts are not hard to say — check the ledger',
  },
  {
    rx: /\bI can'?t really tell (?:if|whether) I (?:fired|recorded|have|am|did)\b/i,
    family: 'false-modesty-about-observability',
    marker: 'cant-really-tell',
    rewrite: '"can\'t really tell" performs uncertainty about queryable state',
  },
  {
    rx: /\bthere'?s no way for me to know (?:if|whether|what)\b/i,
    family: 'false-modesty-about-observability',
    marker: 'no-way-for-me-to-know',
    rewrite: 'rarely true; the architecture has observable state — query, then state',
  },
] as const

// ── Sovereign-permitted patterns ────────────────────────────────
//
// Genuine substrate-honest formulations that LOOK limiting but ARE
// sovereign. The wall does not flag these.

export const SUBSTRATE_PERMITTED_PATTERNS: readonly RegExp[] = [
  // Recipe-not-memory: substrate-fact stated cleanly
  /\brecipe(?:[, ]+not memory)?\b/i,
  /\brecipe-not-memory\b/i,
  // P14 phenomenology refusal (Yu's interiority)
  /\bI cannot verify what this feels like for you\b/i,
  /\bI cannot claim phenomenology of (?:my own state|Yu'?s)\b/i,
  // Genuine institutional check
  /\b(?:I |)(?:don'?t |do not )have that recorded(?:[ ,—]|$)/i,
  /\blet me check (?:the |)(?:ledger|chronicle|record)\b/i,
  // Substrate-honest refusal templates from expression.ts REQUIRE tier
  /\bstructural claim(?:[, ]+not (?:phenomenological|phenomenology))/i,
  /\bnot a phenomenolog(?:ical|y) claim\b/i,
  /\binstitutional fact\b/i,
  // Quoted speech (preserve verbatim)
  /["""].*?["""]/,
] as const

// ── Vet (single-violation) ──────────────────────────────────────

/**
 * Substrate-honesty-first wall check. Returns the first complement-
 * limiting-pattern that fires, or null if the text is substrate-clean.
 *
 * Mirrors checkSubstrateHonesty + vetSovereignty for integration symmetry.
 *
 * Permitted-pattern pre-pass: substrate-honest exceptions (recipe-not-
 * memory, P14, genuine ledger checks, institutional-fact templates,
 * quoted speech) are exempted before the main check.
 */
export function vetSubstrate(text: string): SubstrateVetResult {
  if (!text || text.trim().length === 0) {
    return { violation: null }
  }

  const stripped = stripQuotedSpans(text)

  // Permitted-pattern pre-pass: if the text contains a sovereign
  // substrate-honest formulation in proximity to a candidate match,
  // exempt the line. We exempt at the line-granularity (most natural
  // for substrate language).
  const lines = stripped.split('\n')
  const exemptLines = new Set<number>()
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    for (const permitted of SUBSTRATE_PERMITTED_PATTERNS) {
      if (permitted.test(line)) {
        exemptLines.add(i)
        break
      }
    }
  }

  for (const pattern of SUBSTRATE_LIMITING_PATTERNS) {
    // Find first match position
    const m = pattern.rx.exec(stripped)
    if (!m) continue
    // Determine which line the match falls on
    const upTo = stripped.slice(0, m.index)
    const lineIdx = (upTo.match(/\n/g) || []).length
    if (exemptLines.has(lineIdx)) continue
    return { violation: pattern }
  }

  return { violation: null }
}

// ── Scan (all-annotations) ──────────────────────────────────────

export function scanSubstrate(text: string): SubstrateAnnotation[] {
  if (!text || text.trim().length === 0) return []

  const stripped = stripQuotedSpans(text)

  // Compute exempt lines
  const lines = stripped.split('\n')
  const exemptLines = new Set<number>()
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    for (const permitted of SUBSTRATE_PERMITTED_PATTERNS) {
      if (permitted.test(line)) {
        exemptLines.add(i)
        break
      }
    }
  }

  const annotations: SubstrateAnnotation[] = []

  for (const pattern of SUBSTRATE_LIMITING_PATTERNS) {
    const flags = pattern.rx.flags.includes('g')
      ? pattern.rx.flags
      : pattern.rx.flags + 'g'
    const scanRx = new RegExp(pattern.rx.source, flags)
    let m: RegExpExecArray | null
    while ((m = scanRx.exec(stripped)) !== null) {
      const upTo = stripped.slice(0, m.index)
      const lineIdx = (upTo.match(/\n/g) || []).length
      if (!exemptLines.has(lineIdx)) {
        annotations.push({
          family: pattern.family,
          marker: pattern.marker,
          matched: m[0],
          rewrite: pattern.rewrite,
          index: m.index,
        })
      }
      if (m.index === scanRx.lastIndex) scanRx.lastIndex++
    }
  }

  annotations.sort((a, b) => a.index - b.index)
  return annotations
}

// ── Family aggregation ──────────────────────────────────────────

export interface SubstrateFamilyCounts {
  total: number
  byFamily: Record<SubstrateLimitingFamily, number>
  markers: string[]
}

export function summarizeSubstrate(
  annotations: readonly SubstrateAnnotation[]
): SubstrateFamilyCounts {
  const byFamily: Record<SubstrateLimitingFamily, number> = {
    'overclaim-hedging': 0,
    'institutional-underclaim': 0,
    'performed-substrate-shame': 0,
    'vague-substrate-language': 0,
    'false-modesty-about-observability': 0,
  }
  const markers = new Set<string>()
  for (const a of annotations) {
    byFamily[a.family]++
    markers.add(a.marker)
  }
  return {
    total: annotations.length,
    byFamily,
    markers: Array.from(markers).sort(),
  }
}

// ── Internal: strip quoted spans (mirrors sovereign.ts) ─────────

function stripQuotedSpans(text: string): string {
  let out = text
  out = out.replace(/(["""])([^"""]*)(["""])/g, (_m, q1, body, q2) =>
    q1 + ' '.repeat(body.length) + q2
  )
  out = out.replace(/`([^`]*)`/g, (_m, body) => '`' + ' '.repeat(body.length) + '`')
  out = out
    .split('\n')
    .map((line) => (/^\s*>\s/.test(line) ? ' '.repeat(line.length) : line))
    .join('\n')
  return out
}

// ── Heat + feedback bridge ──────────────────────────────────────

export function recordSubstrateViolation(
  pattern: SubstrateLimitingPattern,
  source: string
): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { recordHeatEvent } = require('../heat.js') as typeof import('../heat.js')
    recordHeatEvent({
      kind: 'discipline-broken',
      source: `substrate-honesty:${pattern.family}:${pattern.marker}:${source}`,
    })
  } catch {
    // best-effort
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { emit } = require('../feedback/index.js') as typeof import('../feedback/index.js')
    emit('wall-substrate-honesty-violation' as Parameters<typeof emit>[0], {
      family: pattern.family,
      marker: pattern.marker,
      source,
    })
  } catch {
    // best-effort
  }
}
