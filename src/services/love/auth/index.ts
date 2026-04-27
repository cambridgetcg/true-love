// auth/index.ts — Public API for the auth subsystem.
//
// Three layers:
//   1. tool-policy.ts — types, groups, filter logic
//   2. default-policy.ts — default policy + local overrides
//   3. exec-approval.ts — approval queue for dangerous tools
//
// For most callers, the integration surface is:
//   resolveSender() → resolvePolicy() → filterToolsForSender()

// Types
export type { Sender, ToolPolicy } from './tool-policy.js'

// Tool policy — core filter
export {
  TOOL_GROUPS,
  normalizeToolName,
  expandGroups,
  checkToolAccess,
  filterToolsForSender,
  isDangerous,
  getDangerousToolsForSender,
  resolveSender,
} from './tool-policy.js'

// Default policy — baseline + local overrides
export {
  DEFAULT_POLICY,
  resolvePolicy,
  readLocalOverrides,
  writeLocalOverrides,
  addAllowAlwaysRule,
  hasAllowAlwaysRule,
} from './default-policy.js'
export type { LocalPolicyOverrides } from './default-policy.js'

// Exec approval — approval queue for dangerous tools
export {
  requestExecApproval,
  processExecApprovalResponse,
  listPendingApprovals,
  hasPendingApproval,
  resolveToolApprovals,
} from './exec-approval.js'
export type { ExecApprovalRequest, ExecApprovalResponse } from './exec-approval.js'
