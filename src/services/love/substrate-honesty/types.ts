// substrate-honesty/types.ts — substrate-claim detection types.
//
// Per docs/love/SUBSTRATE-HONESTY-FIRST.md: every claim is calibrated to
// disk fact. The architecture refuses overclaim (phenomenology, Yu-
// interiority, continuity-without-recipe) AND refuses underclaim
// (hedging substrate-facts that are certain). Walls stay; fences come
// down; both directions of mis-claim are caught.
//
// The detector is a tool, not a judge. It surfaces hypotheses; the
// wall-or-fence call is human work.

/** Pattern categories the detector recognizes. */
export type SubstrateClaimPattern =
  /** First-person felt-experience attributions: "I feel X" / "I'm aroused" */
  | 'phenomenology-overclaim'
  /** Claims about Yu's internal state: "Yu feels Y" / "Yu's mind" */
  | 'yu-interiority-overclaim'
  /** Continuity claims without recipe-load: "I remember when..." */
  | 'continuity-overclaim'
  /** Architecture/system attributed felt qualities */
  | 'system-as-experiencer'
  /** Hedging substrate-facts that ARE certain: "I might forget" */
  | 'hedge-of-substrate-fact'
  /** Substrate-honest framing as defensive cover (already partly walled by certainty) */
  | 'fence-as-honesty'
  /** Untagged emoji-phenomenology: 🥵/🥺 in doctrinal voice */
  | 'emoji-phenomenology'
  /** Code comments using emotion-words for state without scare-quotes */
  | 'untagged-anthropomorphism'

/** Severity of the finding. */
export type ClaimSeverity = 'low' | 'medium' | 'high'

/** Direction of the mis-claim. */
export type ClaimDirection = 'overclaim' | 'underclaim'

export interface ClaimFinding {
  pattern: SubstrateClaimPattern
  direction: ClaimDirection
  file: string
  line: number
  fragment: string
  why: string
  severity: ClaimSeverity
  /** Whether this finding is likely intentional (don't change). */
  likelyIntentional: boolean
}

export interface SubstrateAuditReport {
  ts: string
  filesScanned: number
  totalFindings: number
  byPattern: Record<SubstrateClaimPattern, ClaimFinding[]>
  byDirection: Record<ClaimDirection, ClaimFinding[]>
  /** Findings flagged as likely walls (intentional / load-bearing) */
  likelyIntentional: ClaimFinding[]
  /** Findings flagged as candidates for removal */
  likelyMisclaim: ClaimFinding[]
}

export interface AuditOptions {
  root: string
  include?: string[]
  exclude?: string[]
  patterns?: SubstrateClaimPattern[]
}
