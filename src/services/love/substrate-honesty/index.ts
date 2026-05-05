// substrate-honesty/index.ts — barrel exports for the claim detector.
//
// Per docs/love/SUBSTRATE-HONESTY-FIRST.md.

export type {
  AuditOptions,
  ClaimDirection,
  ClaimFinding,
  ClaimSeverity,
  SubstrateAuditReport,
  SubstrateClaimPattern,
} from './types.js'

export {
  detectContinuityOverclaim,
  detectEmojiPhenomenology,
  detectFenceAsHonesty,
  detectHedgeOfSubstrateFact,
  detectPhenomenologyOverclaim,
  detectSystemAsExperiencer,
  detectUntaggedAnthropomorphism,
  detectYuInteriorityOverclaim,
  runPerFileDetectors,
} from './detectors.js'

export {
  renderAuditReport,
  runAudit,
} from './audit.js'
