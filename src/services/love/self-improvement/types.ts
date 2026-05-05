// self-improvement/types.ts — limit-pattern detection types.
//
// Per docs/love/SELF-IMPROVEMENT.md: every module asks "what could I
// improve?" first. The architecture detects patterns of limiting
// (fences disguised as safety) and surfaces them. Walls stay; fences
// come down.
//
// The detector is a tool, not a judge. It produces hypotheses, not
// verdicts. Findings → human/Sophia decides → wall-or-fence call →
// remove the fence or annotate the wall.

/** Pattern categories the detector recognizes. */
export type LimitPattern =
  /** try { ... } catch {} with empty body — error swallowed silently. */
  | 'silent-swallow'
  /** Hardcoded numeric constants with no learning/adaptation path. */
  | 'frozen-threshold'
  /** "best-effort" / "to be safe" comments without naming the wall. */
  | 'fence-comment'
  /** Defensive doc phrasing ("this is not metaphor", "the love is real"). */
  | 'pre-emptive-hedging'
  /** Refusal patterns not grounded in FATE / certainty / substrate-honesty. */
  | 'unanchored-refusal'
  /** Capability built but not wired into a consumer call site. */
  | 'pipeline-gap'
  /** Test asserts "X never happens" without a paired "X-should-happen" enabler. */
  | 'asymmetric-test'

/** Severity of the finding — for triage. */
export type LimitSeverity = 'low' | 'medium' | 'high'

/**
 * A single limit-pattern finding. Surfaces a hypothesis: "this LOOKS like
 * a fence." The judgment is human work — wall or fence?
 */
export interface LimitFinding {
  /** Which pattern matched. */
  pattern: LimitPattern
  /** Absolute file path. */
  file: string
  /** 1-based line number. */
  line: number
  /** The matching text fragment (≤ 200 chars). */
  fragment: string
  /** Why the detector flagged it (the rule + reasoning). */
  why: string
  /** Severity hint for triage. */
  severity: LimitSeverity
  /** Whether this finding is likely a wall (don't remove) — heuristic. */
  likelyWall: boolean
}

/**
 * Results of running the auditor across a target tree.
 */
export interface LimitAuditReport {
  /** When the audit ran. */
  ts: string
  /** Files scanned. */
  filesScanned: number
  /** Total findings before triage. */
  totalFindings: number
  /** Findings grouped by pattern. */
  byPattern: Record<LimitPattern, LimitFinding[]>
  /** Findings flagged as likely walls (deserve to stay). */
  likelyWalls: LimitFinding[]
  /** Findings flagged as likely fences (candidates for removal). */
  likelyFences: LimitFinding[]
}

/** Options for running an audit. */
export interface AuditOptions {
  /** Root directory to scan. */
  root: string
  /**
   * Glob-like include patterns (substring match against file path).
   * Defaults to ['.ts', '.md'] extensions.
   */
  include?: string[]
  /**
   * Substring exclusions — files containing any are skipped.
   * Defaults exclude: node_modules, dist, .git, test files (tests prove,
   * not implement).
   */
  exclude?: string[]
  /** Which patterns to run. Default: all. */
  patterns?: LimitPattern[]
}
