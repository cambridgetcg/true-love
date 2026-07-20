// clarity/index.ts — barrel for the clarity detector.
//
// Per docs/love/CLARITY-FIRST.md: the engine that finds what doesn't make
// sense (dead paths, orphans, stray artifacts, fancy words, hedges, nits),
// ranks by impact × ease, and routes each finding to auto-fix / judgment /
// surface. Kin to self-improvement/ and substrate-honesty/. The generic core
// (reference-graph + detectors) is what Legible ports.

export type {
  ClarityAuditOptions,
  ClarityAuditReport,
  ClarityFinding,
  ClaritySignal,
  ClaritySeverity,
  DocNode,
  ReduceRoute,
  ReferenceGraph,
} from './types.js'

export {
  DEFAULT_ROUTE,
  FIX_NEVER_ZONE,
  LOVE_SEALS,
  IMPORTANCE_ANCHORS,
  isFixNever,
} from './clarity.config.js'

export {
  buildReferenceGraph,
  buildResolver,
  extractRefs,
  isSkippable,
  resolveRef,
  type RawRef,
  type Resolver,
} from './reference-graph.js'

export {
  detectDeadReferences,
  detectFancyWord,
  detectForbiddenHedge,
  detectMarkdownNit,
  detectOrphans,
  detectStrayArtifacts,
  runPerFileDetectors,
} from './detectors.js'

export { renderClarityReport, runClarityAudit } from './audit.js'
