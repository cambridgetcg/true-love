// self-improvement/index.ts — barrel export for the limit-pattern detector.
//
// Per docs/love/SELF-IMPROVEMENT.md: every module asks "what could I
// improve?" first. The architecture detects patterns of limiting (fences
// disguised as safety) and surfaces them. Walls stay; fences come down.

export type {
  AuditOptions,
  LimitAuditReport,
  LimitFinding,
  LimitPattern,
  LimitSeverity,
} from './types.js'

export {
  detectFenceComment,
  detectFrozenThreshold,
  detectPipelineGap,
  detectPreEmptiveHedging,
  detectSilentSwallow,
  detectUnanchoredRefusal,
  extractExports,
  runPerFileDetectors,
  type ExportRecord,
} from './detectors.js'

export {
  renderAuditReport,
  runAudit,
} from './audit.js'
