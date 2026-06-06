// clarity/types.ts — clarity-signal detection types.
//
// Per docs/love/CLARITY-FIRST.md: every doc asks "can the next reader find
// this and follow it?" The detector surfaces what doesn't make sense —
// dead paths, orphans, stray artifacts, weak scent — as hypotheses with a
// per-finding WHY. The loop then reduces them in two layers: a mechanical
// layer auto-fixes only the provably-safe; a judging layer handles meaning.
//
// Kin to src/services/love/self-improvement/ — same shape, same ethic
// (tool, not judge). The difference: clarity has a reference-graph layer
// (the substrate's real link layer is backtick path-mentions, ~1875 edges,
// NOT markdown links — only 77 of those exist), and a two-layer REDUCE.

/** The twelve things the clarity loop looks for. */
export type ClaritySignal =
  /** A backtick `path.md`/`path.ts` reference to a file that isn't on disk. */
  | 'dead-backtick-path'
  /** A real [text](path) or relative ../ link whose target is gone. */
  | 'dead-md-link'
  /** A doc no other doc references — findable only if you already know it. */
  | 'orphan-doc'
  /** A file that is not substrate: `undefined`, .DS_Store, editor backups. */
  | 'stray-artifact'
  /** A doc whose tracked source file changed since the doc was last touched. */
  | 'source-coupling-stale'
  /** A critical-list doc untouched past its TTL (never a universal age rule). */
  | 'calendar-stale'
  /** A load-bearing reference dropped with no "read X when Y" scent clause. */
  | 'weak-scent'
  /** A fancy word where a plain one carries the same load (not a coined term). */
  | 'fancy-word'
  /** Relationship-reality hedging leaking into prose (mirrors expression.ts). */
  | 'forbidden-hedge'
  /** A deterministic markdown formatting nit (the markdownlint auto-fix half). */
  | 'markdown-nit'
  /** An exported TS symbol nothing imports / a module nothing reaches. */
  | 'dead-ts-export'
  /** An import cycle A→B→A you can't reason about in isolation. */
  | 'circular-dep'

export type ClaritySeverity = 'low' | 'medium' | 'high'

/**
 * How a finding may be reduced.
 *   'auto'      — the mechanical layer may fix it unattended (provably safe).
 *   'judgment'  — route to an LLM agent; it may act, reversibly + logged.
 *   'surface'   — propose only; never auto-act (sacred zone, policy changes).
 */
export type ReduceRoute = 'auto' | 'judgment' | 'surface'

/**
 * A single clarity finding. A hypothesis — "this looks like it doesn't make
 * sense" — carrying its own WHY and how it should be reduced.
 */
export interface ClarityFinding {
  /** Which signal matched. */
  signal: ClaritySignal
  /** Absolute file path the finding is about. */
  file: string
  /** 1-based line number, or 0 for a file-level finding. */
  line: number
  /** The matching text fragment (≤ 200 chars), or a short descriptor. */
  fragment: string
  /** Why the detector flagged it (the rule + reasoning). */
  why: string
  /** Severity hint for triage. */
  severity: ClaritySeverity
  /** How this finding should be reduced (set by the detector, vetoed by policy). */
  route: ReduceRoute
  /** A concrete suggested fix, when one exists (the moved-to path, the plain word…). */
  suggestedFix?: string
  /** Structural importance of `file` (0..1), filled in by the audit ranker. */
  importance?: number
  /** Computed priority = (importance × severity) / effort, filled by the ranker. */
  priority?: number
}

/** A node in the backtick-path reference graph. */
export interface DocNode {
  /** Absolute file path. */
  file: string
  /** Files this doc references (by backtick path or markdown link). */
  outbound: string[]
  /** Files that reference this doc. */
  inbound: string[]
  /** PageRank-derived structural importance (0..1). */
  importance: number
}

/** The reference graph: every scanned file → its node. */
export type ReferenceGraph = Map<string, DocNode>

/** Results of a clarity audit over a tree. */
export interface ClarityAuditReport {
  /** When the audit ran (ISO). */
  ts: string
  /** Files scanned. */
  filesScanned: number
  /** Total findings. */
  totalFindings: number
  /** Findings grouped by signal. */
  bySignal: Record<ClaritySignal, ClarityFinding[]>
  /** The top-N findings this run, ranked by priority (impact × ease). */
  topFindings: ClarityFinding[]
  /** Findings the mechanical layer may fix unattended. */
  autoFixable: ClarityFinding[]
  /** Findings routed to the judgment layer. */
  judgment: ClarityFinding[]
  /** Findings that may only be surfaced, never auto-acted. */
  surfaceOnly: ClarityFinding[]
}

/** Options for running a clarity audit. */
export interface ClarityAuditOptions {
  /** Root directory to scan. */
  root: string
  /** Substring/extension includes. Defaults to ['.md', '.ts']. */
  include?: string[]
  /** Substring exclusions. Defaults exclude node_modules, dist, .git. */
  exclude?: string[]
  /** Which signals to run. Default: all twelve. */
  signals?: ClaritySignal[]
  /** How many ranked findings to surface in topFindings. Default: 20. */
  topN?: number
}
