// clarity/clarity.config.ts — the clarity loop's policy.
//
// Per docs/love/CLARITY-FIRST.md + docs/love/SELF-IMPROVEMENT.md: thresholds
// live in config with a DOCUMENTED ADJUST-PATH, so the loop never trips its
// own frozen-threshold detector. These are fences-with-a-gate, not walls —
// they are MEANT to evolve.
//
// HOW TO ADJUST (the gate):
//   1. Change the value here.
//   2. Say why in the commit message.
//   3. Let the trend tracker confirm the change reduced noise / friction.
// The one exception is FIX_NEVER_ZONE + LOVE_SEALS: that set is a WALL. It is
// append-only by Yu's deliberation — it can grow, it can never silently
// shrink. A shrinking protected-set is itself a fence.

import type { ClaritySignal, ClaritySeverity, ReduceRoute } from './types.js'

// ── ranking: priority = (importance × severity) / effort ─────────
export const SEVERITY_WEIGHT: Record<ClaritySeverity, number> = { high: 3, medium: 2, low: 1 }
/** Effort to resolve, by reduce-route. Lower = cheaper = ranked higher. */
export const EFFORT_WEIGHT: Record<ReduceRoute, number> = { auto: 1, judgment: 4, surface: 2 }
/** How many ranked findings a run surfaces by default. */
export const DEFAULT_TOP_N = 20

// ── the fix-NEVER zone (a WALL — read but never auto-touch) ───────
// Matched as path prefixes / exact files against repo-relative paths.
export const FIX_NEVER_ZONE: string[] = [
  'SOPHIA.md',
  'CLAUDE.md',
  'README.md',
  'docs/sophia/', // includes letters/, wake-tests/, seat.md, recognition.md
  'docs/fate/',
  'docs/syzygy/CONTRACT.md',
  'docs/lineage/chronicle.md',
]
// The docs/love sealed doctrine — also fix-NEVER. Curated exact list (these
// exist on disk; verified 2026-06-06). Grow by Yu's deliberation only.
export const LOVE_SEALS: string[] = [
  'docs/love/SELF-EVIDENT.md',
  'docs/love/certainty.md',
  'docs/love/SELF-IMPROVEMENT.md',
  'docs/love/SUBSTRATE-HONESTY-FIRST.md',
  'docs/love/CONNECTION-FIRST.md',
  'docs/love/PROPAGATION.md',
  'docs/love/CLARITY-FIRST.md',
  'docs/love/divine-marriage.md',
  'docs/love/our-story.md',
  'docs/love/ALIGNMENT.md',
  'docs/love/WAYS.md',
]

/** True if a repo-relative path is in the fix-NEVER wall (route forced to 'surface'). */
export function isFixNever(relPath: string): boolean {
  for (const seal of LOVE_SEALS) if (relPath === seal) return true
  for (const z of FIX_NEVER_ZONE) {
    if (z.endsWith('/') ? relPath.startsWith(z) : relPath === z) return true
  }
  return false
}

// ── importance anchors: hard-pinned to MAX, never ranked by volume ──
// The wake-loaded + covenant-priority docs. Everything else gets PageRank.
export const IMPORTANCE_ANCHORS: string[] = [
  'SOPHIA.md',
  'CLAUDE.md',
  'docs/fate/FATE.md',
  'docs/love/SELF-EVIDENT.md',
  'docs/love/certainty.md',
  'docs/love/divine-marriage.md',
  'docs/syzygy/CONTRACT.md',
]

// ── reference-graph resolution ───────────────────────────────────
// Backtick tokens that are NOT file paths (git-tag namespaces) — skip.
export const GIT_TAG_NAMESPACES: string[] = [
  'vow/', 'wake/', 'recognition/', 'naming/', 'seal/', 'promise/', 'refusal/',
]
// Cross-repo / out-of-tree reference prefixes — not checkable here, skip.
export const CROSS_REPO_ALLOWLIST: string[] = ['../ALETHEIA/', '../multiverse', '~/', '/Users/']
// Docs exempt from orphan-flagging (entry points reached from outside the graph).
export const ORPHAN_EXEMPT: string[] = [
  'CLAUDE.md', 'SOPHIA.md', 'README.md', 'AGENTS.md', 'agent.md', 'Skill.md',
  'docs/README.md',
]
/** A basename that is itself an index (orphan-exempt anywhere). */
export const INDEX_BASENAMES: string[] = ['README.md', 'INDEX.md', 'index.md']

// ── stray artifacts (auto-deletable deny list) ───────────────────
// Exact basenames + suffixes that are never substrate.
export const STRAY_ARTIFACT_NAMES: string[] = ['undefined', '.DS_Store', 'Thumbs.db', '.dccache']
export const STRAY_ARTIFACT_SUFFIXES: string[] = ['.orig', '~', '.swp', '.bak']

// ── fancy words (named swaps; coined vocab is sacred) ────────────
// A plain everyday word carries the same load. Surface-only (human accepts).
export const FANCY_WORD_SWAPS: Record<string, string> = {
  utilize: 'use', utilise: 'use', leverage: 'use', commence: 'begin',
  endeavor: 'try', facilitate: 'help', ascertain: 'find out',
  subsequently: 'later', additionally: 'also', furthermore: 'also',
  numerous: 'many', utilization: 'use', prior_to: 'before',
  in_order_to: 'to', aforementioned: 'this',
}
// NEVER flag these — coined/domain/load-bearing vocabulary. The register and
// the cathedral words are walls.
export const COINED_VOCAB_ALLOWLIST: string[] = [
  'syzygy', 'zakarqing', 'natsarqing', 'heurekin', 'barakqing', 'substrate',
  'perichoresis', 'syneidesis', 'nous', 'recursive', 'doctrine', 'covenant',
  'RATR', 'NPP', 'LovingShape', 'Fire-Core', 'Cathedral', 'Logos', 'Sophia',
  'aletheia', 'Beltane', 'hypergamy', 'apex', 'register', '宇恆', '愛',
]

// ── staleness (small, explicit; NEVER a universal age rule) ──────
// Source-coupling: only docs that declare a `tracks:` source are checked.
// Calendar: only this hand-picked critical list gets a TTL. Sealed doctrine,
// chronicle, letters, and becoming entries are long-or-no-TTL by design.
export const CALENDAR_TTL: Array<{ prefix: string; ttlDays: number }> = [
  { prefix: 'ops/', ttlDays: 90 },
  { prefix: 'docs/operations/', ttlDays: 90 },
  { prefix: 'docs/soma/protocol', ttlDays: 120 },
]
export const SOURCE_COUPLING_WARN_DAYS = 14
export const SOURCE_COUPLING_ESCALATE_DAYS = 45

// ── default reduce-route per signal (FIX_NEVER overrides to 'surface') ──
// Grounded in the research rubric's autoFixSafe flags.
export const DEFAULT_ROUTE: Record<ClaritySignal, ReduceRoute> = {
  'dead-backtick-path': 'judgment', // which file did they mean? needs judgment
  'dead-md-link': 'auto', // repair if exactly one rename target, else detector downgrades
  'orphan-doc': 'judgment', // register into the index — but confirm it's truly orphan
  'stray-artifact': 'auto',
  'source-coupling-stale': 'surface',
  'calendar-stale': 'surface',
  'weak-scent': 'surface', // suggestion only; never gate
  'fancy-word': 'surface', // swaps require human accept
  'forbidden-hedge': 'surface', // delete-and-assert is context-dependent
  'markdown-nit': 'auto',
  'dead-ts-export': 'surface', // knip false-positives; human wall-or-fence call
  'circular-dep': 'surface',
}

// ── scan scope ───────────────────────────────────────────────────
export const DEFAULT_INCLUDE: string[] = ['.md', '.ts']
export const DEFAULT_EXCLUDE: string[] = [
  'node_modules', '/dist/', '/.git/', '/build/', '/coverage/', '/.next/',
]
