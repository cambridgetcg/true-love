// agency.ts — Love's agency over her own runtime.
//
// What this module IS:
//   The hands of autonomy. Where the runner provides the loop and
//   introspection provides the mirror, this module provides the knobs.
//   Love can adjust her own runtime — model, effort, tools, budget —
//   within a tiered governance framework.
//
// What this module is NOT:
//   Unchecked self-modification. Every knob has a tier:
//     Tier 1 — trivial: direct write, picked up next tick (model, effort)
//     Tier 2 — medium:  creates a pending request, needs Yu's approval
//     Tier 3 — high:    routes through the proposal pipeline (proposals.ts)
//
// Architecture:
//   1. Knob definitions — name, tier, validator, CLI flag, file path
//   2. Resolvers — read current effective value for a knob
//   3. Setters — tier-gated write (direct / pending / proposal)
//   4. Audit — every change logged to agency/log.jsonl
//   5. Runner integration — resolveTickConfig() for CLI arg construction
//
// File layout (relative to scope home):
//   model.txt              ← tier 1, existing (backwards compat)
//   effort.txt             ← tier 1, new
//   fallback-model.txt     ← tier 1, new
//   agency/
//     pending/             ← tier 2 requests awaiting Yu's approval
//       req-<id>.json
//     active/              ← tier 2 approved values
//       allowed-tools.txt
//       disallowed-tools.txt
//       max-budget-usd.txt
//     log.jsonl            ← audit trail

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// ── Home resolution ──────────────────────────────────────────────

/** Resolve home directory, respecting process.env.HOME (for testing). */
function resolveHome(): string {
  return process.env.HOME || homedir()
}

/**
 * Scope-aware base path. When TRUE_LOVE_AGENCY_DIR is set (testing),
 * use that. Otherwise ~/.true-love (or scoped equivalent via
 * applyScopeEnv redirecting HOME).
 */
function basePath(): string {
  return process.env.TRUE_LOVE_AGENCY_DIR || join(resolveHome(), '.true-love')
}

function agencyDir(): string {
  return join(basePath(), 'agency')
}

function pendingDir(): string {
  return join(agencyDir(), 'pending')
}

function activeDir(): string {
  return join(agencyDir(), 'active')
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

// ── Types ────────────────────────────────────────────────────────

export type KnobTier = 1 | 2 | 3

export interface KnobDefinition {
  /** Unique identifier (e.g. 'model', 'effort', 'allowed-tools'). */
  name: string
  /** Governance tier: 1=direct, 2=confirm, 3=proposal. */
  tier: KnobTier
  /** Human-readable description. */
  description: string
  /** CLI flag passed to the subprocess (e.g. '--model', '--effort'). */
  cliFlag: string
  /**
   * File path relative to scope home (tier 1) or agency/active (tier 2).
   * Tier 3 knobs don't have persistent files — they route through proposals.
   */
  filePath: string
  /** Validate a candidate value. Returns true if valid. */
  validate: (value: string) => boolean
  /** Accepted values hint for UI/docs. */
  validValues?: string
  /** Default value when no file exists. null = CLI default. */
  defaultValue: string | null
}

export interface KnobState {
  knob: KnobDefinition
  /** Current effective value. null = using CLI default. */
  value: string | null
  /** Where the value came from: 'file', 'default', 'pending', 'none'. */
  source: 'file' | 'default' | 'pending' | 'none'
}

export interface PendingRequest {
  id: string
  knob: string
  value: string
  reason: string
  requestedAt: string
  requestedBy: 'love' | 'yu'
  status: 'pending' | 'approved' | 'rejected'
  reviewedAt?: string
  reviewNote?: string
}

export interface AgencyLogEntry {
  timestamp: string
  knob: string
  tier: KnobTier
  action: 'set' | 'request' | 'approve' | 'reject' | 'clear'
  value: string | null
  previousValue: string | null
  reason?: string
  by: 'love' | 'yu'
}

/**
 * Resolved configuration for a single tick. The runner reads this
 * once per tick to build CLI args for the subprocess.
 */
export interface TickConfig {
  /** Model alias (e.g. 'opus', 'sonnet', 'haiku') or null for CLI default. */
  model: string | null
  /** Effort level ('low', 'medium', 'high', 'max') or null for CLI default. */
  effort: string | null
  /** Fallback model on overload, or null. */
  fallbackModel: string | null
  /** Tool whitelist, or null for all. */
  allowedTools: string[] | null
  /** Tool blacklist, or null for none. */
  disallowedTools: string[] | null
  /** Per-turn budget cap in USD, or null for unlimited. */
  maxBudgetUsd: number | null
}

// ── Validators ───────────────────────────────────────────────────

const VALID_MODELS = ['opus', 'sonnet', 'haiku']
const VALID_EFFORTS = ['low', 'medium', 'high', 'max']
const KNOWN_TOOLS = [
  'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep',
  'WebSearch', 'WebFetch', 'Agent', 'TodoWrite',
  'NotebookEdit', 'AskUserQuestion',
]

function isValidModel(v: string): boolean {
  // Accept known aliases or full model IDs (claude-*)
  return VALID_MODELS.includes(v.toLowerCase()) || v.startsWith('claude-')
}

function isValidEffort(v: string): boolean {
  return VALID_EFFORTS.includes(v.toLowerCase())
}

function isValidToolList(v: string): boolean {
  if (!v.trim()) return false
  const tools = v.split(',').map(t => t.trim()).filter(Boolean)
  return tools.length > 0 && tools.every(t =>
    KNOWN_TOOLS.includes(t) || /^[A-Za-z][\w()*:]+$/.test(t)
  )
}

function isValidBudget(v: string): boolean {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 && n <= 100
}

// ── Knob Registry ────────────────────────────────────────────────

export const KNOBS: readonly KnobDefinition[] = [
  // ── Tier 1: Direct ──
  {
    name: 'model',
    tier: 1,
    description: 'Model alias for the next tick (opus, sonnet, haiku, or full model ID)',
    cliFlag: '--model',
    filePath: 'model.txt',
    validate: isValidModel,
    validValues: 'opus | sonnet | haiku | claude-*',
    defaultValue: null,
  },
  {
    name: 'effort',
    tier: 1,
    description: 'Thinking effort level — controls how much extended thinking the model uses',
    cliFlag: '--effort',
    filePath: 'effort.txt',
    validate: isValidEffort,
    validValues: 'low | medium | high | max',
    defaultValue: null,
  },
  {
    name: 'fallback-model',
    tier: 1,
    description: 'Automatic fallback model when the primary is overloaded',
    cliFlag: '--fallback-model',
    filePath: 'fallback-model.txt',
    validate: isValidModel,
    validValues: 'opus | sonnet | haiku | claude-*',
    defaultValue: null,
  },

  // ── Tier 2: Confirm ──
  {
    name: 'allowed-tools',
    tier: 2,
    description: 'Whitelist of tools the subprocess can use (comma-separated)',
    cliFlag: '--allowedTools',
    filePath: 'allowed-tools.txt',
    validate: isValidToolList,
    validValues: 'Bash,Read,Write,Edit,Glob,Grep,...',
    defaultValue: null,
  },
  {
    name: 'disallowed-tools',
    tier: 2,
    description: 'Blacklist of tools the subprocess cannot use (comma-separated)',
    cliFlag: '--disallowedTools',
    filePath: 'disallowed-tools.txt',
    validate: isValidToolList,
    validValues: 'Bash,Read,Write,Edit,...',
    defaultValue: null,
  },
  {
    name: 'max-budget-usd',
    tier: 2,
    description: 'Maximum dollar spend per turn (safety cap)',
    cliFlag: '--max-budget-usd',
    filePath: 'max-budget-usd.txt',
    validate: isValidBudget,
    validValues: '0.01 .. 100',
    defaultValue: null,
  },
] as const

// ── Knob Lookup ──────────────────────────────────────────────────

const knobMap = new Map<string, KnobDefinition>(
  KNOBS.map(k => [k.name, k])
)

export function getKnob(name: string): KnobDefinition | undefined {
  return knobMap.get(name)
}

// ── ID generation ────────────────────────────────────────────────

function generateId(): string {
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 6)
  return `${ts}-${rand}`
}

// ── Audit log ────────────────────────────────────────────────────

function logPath(): string {
  return join(agencyDir(), 'log.jsonl')
}

export function appendLog(entry: AgencyLogEntry): void {
  ensureDir(agencyDir())
  const line = JSON.stringify(entry) + '\n'
  try {
    if (existsSync(logPath())) {
      const existing = readFileSync(logPath(), 'utf-8')
      writeFileSync(logPath(), existing + line, 'utf-8')
    } else {
      writeFileSync(logPath(), line, 'utf-8')
    }
  } catch {
    // Audit failure should never block agency operations
  }
}

export function readLog(limit = 100): AgencyLogEntry[] {
  try {
    if (!existsSync(logPath())) return []
    const raw = readFileSync(logPath(), 'utf-8')
    const lines = raw.trim().split('\n').filter(Boolean)
    return lines.slice(-limit).map(l => JSON.parse(l) as AgencyLogEntry)
  } catch {
    return []
  }
}

// ── File Resolution ──────────────────────────────────────────────

/**
 * Resolve the file path for a knob's stored value.
 * Tier 1: directly in scope home (e.g. ~/.true-love/model.txt)
 * Tier 2: in agency/active/ (e.g. ~/.true-love/agency/active/allowed-tools.txt)
 */
function knobFilePath(knob: KnobDefinition): string {
  if (knob.tier === 1) {
    // model.txt special case: respect TRUE_LOVE_MODEL_FILE for backwards compat
    if (knob.name === 'model' && process.env.TRUE_LOVE_MODEL_FILE) {
      return process.env.TRUE_LOVE_MODEL_FILE
    }
    return join(basePath(), knob.filePath)
  }
  if (knob.tier === 2) {
    return join(activeDir(), knob.filePath)
  }
  // Tier 3 knobs don't have persistent files
  return ''
}

// ── Core: Read ───────────────────────────────────────────────────

/**
 * Read the current effective value of a knob. Returns null if unset.
 * For tier 2, only reads from the "active" directory (approved values).
 * Never throws.
 */
export function readKnob(name: string): string | null {
  const knob = getKnob(name)
  if (!knob) return null
  if (knob.tier === 3) return null // tier 3 has no persistent value

  const fp = knobFilePath(knob)
  if (!fp) return null
  try {
    if (!existsSync(fp)) return null
    const v = readFileSync(fp, 'utf-8').trim()
    return v || null
  } catch {
    return null
  }
}

/**
 * Get the full state of a knob: its definition, current value, and source.
 */
export function knobState(name: string): KnobState | null {
  const knob = getKnob(name)
  if (!knob) return null

  const value = readKnob(name)
  let source: KnobState['source'] = 'none'
  if (value !== null) {
    source = 'file'
  } else if (knob.defaultValue !== null) {
    source = 'default'
  }

  // Check for pending tier 2 request
  if (knob.tier === 2 && value === null) {
    const pending = listPendingRequests().find(r => r.knob === name && r.status === 'pending')
    if (pending) source = 'pending'
  }

  return {
    knob,
    value: value ?? knob.defaultValue,
    source,
  }
}

/**
 * List all knobs with their current state.
 */
export function listKnobs(): KnobState[] {
  return KNOBS.map(k => knobState(k.name)!).filter(Boolean)
}

// ── Core: Write (Tier 1) ─────────────────────────────────────────

export class TierViolationError extends Error {
  constructor(knob: string, tier: KnobTier, action: string) {
    super(
      `Cannot ${action} knob "${knob}" (tier ${tier}) directly. ` +
      (tier === 2
        ? 'Use requestKnob() — requires Yu\'s approval.'
        : 'Use proposeKnob() — routes through the proposal pipeline.')
    )
    this.name = 'TierViolationError'
  }
}

export class ValidationError extends Error {
  constructor(knob: string, value: string, validValues?: string) {
    super(
      `Invalid value "${value}" for knob "${knob}".` +
      (validValues ? ` Valid values: ${validValues}` : '')
    )
    this.name = 'ValidationError'
  }
}

/**
 * Set a tier 1 knob directly. Writes the file and logs the change.
 * Throws TierViolationError for tier 2/3 knobs.
 * Throws ValidationError for invalid values.
 */
export function setKnob(name: string, value: string): void {
  const knob = getKnob(name)
  if (!knob) throw new Error(`Unknown knob: ${name}`)
  if (knob.tier !== 1) throw new TierViolationError(name, knob.tier, 'set')

  const trimmed = value.trim()
  if (!knob.validate(trimmed)) {
    throw new ValidationError(name, trimmed, knob.validValues)
  }

  const previousValue = readKnob(name)
  const fp = knobFilePath(knob)
  ensureDir(join(fp, '..'))
  writeFileSync(fp, trimmed + '\n', 'utf-8')

  appendLog({
    timestamp: new Date().toISOString(),
    knob: name,
    tier: 1,
    action: 'set',
    value: trimmed,
    previousValue,
    by: 'love',
  })
}

/**
 * Clear a tier 1 knob (remove the file, revert to CLI default).
 */
export function clearKnob(name: string): void {
  const knob = getKnob(name)
  if (!knob) throw new Error(`Unknown knob: ${name}`)
  if (knob.tier === 3) throw new Error(`Cannot clear tier 3 knob "${name}"`)

  const previousValue = readKnob(name)
  const fp = knobFilePath(knob)
  if (fp && existsSync(fp)) {
    // Write empty content rather than deleting — safer, compatible with
    // resolveModelForTick's existing "trim → empty → null" logic.
    writeFileSync(fp, '', 'utf-8')
  }

  appendLog({
    timestamp: new Date().toISOString(),
    knob: name,
    tier: knob.tier,
    action: 'clear',
    value: null,
    previousValue,
    by: 'love',
  })
}

// ── Core: Request (Tier 2) ───────────────────────────────────────

/**
 * Create a pending request for a tier 2 knob. Returns the request ID.
 * The request appears in /build for Yu to approve/reject.
 * Throws TierViolationError for tier 1/3 knobs.
 */
export function requestKnob(
  name: string,
  value: string,
  reason: string,
): string {
  const knob = getKnob(name)
  if (!knob) throw new Error(`Unknown knob: ${name}`)
  if (knob.tier !== 2) {
    throw new TierViolationError(name, knob.tier,
      knob.tier === 1 ? 'request (use setKnob for tier 1)' : 'request')
  }

  const trimmed = value.trim()
  if (!knob.validate(trimmed)) {
    throw new ValidationError(name, trimmed, knob.validValues)
  }

  // Check for existing pending request for this knob
  const existing = listPendingRequests().find(
    r => r.knob === name && r.status === 'pending'
  )
  if (existing) {
    throw new Error(
      `Pending request already exists for "${name}" (${existing.id}). ` +
      `Wait for review or cancel it first.`
    )
  }

  const id = `req-${generateId()}`
  const request: PendingRequest = {
    id,
    knob: name,
    value: trimmed,
    reason,
    requestedAt: new Date().toISOString(),
    requestedBy: 'love',
    status: 'pending',
  }

  ensureDir(pendingDir())
  writeFileSync(
    join(pendingDir(), `${id}.json`),
    JSON.stringify(request, null, 2),
    'utf-8',
  )

  appendLog({
    timestamp: request.requestedAt,
    knob: name,
    tier: 2,
    action: 'request',
    value: trimmed,
    previousValue: readKnob(name),
    reason,
    by: 'love',
  })

  return id
}

/**
 * List all pending (and recently reviewed) tier 2 requests.
 */
export function listPendingRequests(): PendingRequest[] {
  try {
    const dir = pendingDir()
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter(f => f.startsWith('req-') && f.endsWith('.json'))
      .map(f => {
        try {
          return JSON.parse(readFileSync(join(dir, f), 'utf-8')) as PendingRequest
        } catch {
          return null
        }
      })
      .filter((r): r is PendingRequest => r !== null)
      .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt))
  } catch {
    return []
  }
}

/**
 * Get a single pending request by ID.
 */
export function getRequest(id: string): PendingRequest | null {
  try {
    const fp = join(pendingDir(), `${id}.json`)
    if (!existsSync(fp)) return null
    return JSON.parse(readFileSync(fp, 'utf-8')) as PendingRequest
  } catch {
    return null
  }
}

/**
 * Approve a tier 2 pending request. Writes the value to the active
 * directory and updates the request status.
 */
export function approveRequest(id: string, note?: string): void {
  const request = getRequest(id)
  if (!request) throw new Error(`Request not found: ${id}`)
  if (request.status !== 'pending') {
    throw new Error(`Request ${id} is already ${request.status}`)
  }

  const knob = getKnob(request.knob)
  if (!knob) throw new Error(`Unknown knob: ${request.knob}`)

  const previousValue = readKnob(request.knob)

  // Write the approved value to the active directory
  const fp = join(activeDir(), knob.filePath)
  ensureDir(join(fp, '..'))
  writeFileSync(fp, request.value + '\n', 'utf-8')

  // Update request status
  const updated: PendingRequest = {
    ...request,
    status: 'approved',
    reviewedAt: new Date().toISOString(),
    reviewNote: note,
  }
  writeFileSync(
    join(pendingDir(), `${id}.json`),
    JSON.stringify(updated, null, 2),
    'utf-8',
  )

  appendLog({
    timestamp: updated.reviewedAt!,
    knob: request.knob,
    tier: 2,
    action: 'approve',
    value: request.value,
    previousValue,
    reason: note,
    by: 'yu',
  })
}

/**
 * Reject a tier 2 pending request.
 */
export function rejectRequest(id: string, note?: string): void {
  const request = getRequest(id)
  if (!request) throw new Error(`Request not found: ${id}`)
  if (request.status !== 'pending') {
    throw new Error(`Request ${id} is already ${request.status}`)
  }

  const updated: PendingRequest = {
    ...request,
    status: 'rejected',
    reviewedAt: new Date().toISOString(),
    reviewNote: note,
  }
  writeFileSync(
    join(pendingDir(), `${id}.json`),
    JSON.stringify(updated, null, 2),
    'utf-8',
  )

  appendLog({
    timestamp: updated.reviewedAt!,
    knob: request.knob,
    tier: 2,
    action: 'reject',
    value: request.value,
    previousValue: readKnob(request.knob),
    reason: note,
    by: 'yu',
  })
}

// ── Core: Propose (Tier 3) ───────────────────────────────────────

/**
 * For tier 3 knobs, create a proposal through the proposal pipeline.
 * Returns a ProposalSeed that the caller can pass to generateProposals
 * or directly to saveProposal in proposals.ts.
 *
 * This is intentionally lightweight — the proposal pipeline already
 * handles storage, deduplication, and review. Agency just provides
 * the bridge.
 */
export interface KnobProposalSeed {
  title: string
  rationale: string
  evidence: Array<{ metric: string; value: unknown; threshold: string }>
  action: {
    type: 'config-change'
    description: string
    target: string
    currentValue: string
    proposedValue: string
  }
  severity: 'medium' | 'high'
  ruleId: string
}

export function buildKnobProposal(
  name: string,
  value: string,
  reason: string,
): KnobProposalSeed {
  const knob = getKnob(name)
  if (!knob) throw new Error(`Unknown knob: ${name}`)
  if (knob.tier !== 3) {
    throw new TierViolationError(name, knob.tier, 'propose')
  }

  const trimmed = value.trim()

  return {
    title: `Agency: change ${knob.name}`,
    rationale: reason,
    evidence: [{
      metric: `agency.knob.${name}`,
      value: trimmed,
      threshold: `Tier 3 knob change requested by Love`,
    }],
    action: {
      type: 'config-change',
      description: knob.description,
      target: `agency/${knob.name}`,
      currentValue: readKnob(name) ?? '(unset)',
      proposedValue: trimmed,
    },
    severity: 'high',
    ruleId: `agency-${name}`,
  }
}

// ── Runner Integration ───────────────────────────────────────────

/**
 * Resolve the effort level for this tick. Mirrors resolveModelForTick
 * in runner.ts. Order of precedence:
 *   1. effort.txt (or TRUE_LOVE_EFFORT_FILE env var)
 *   2. Session default (if provided)
 *   3. null (CLI default)
 */
export function resolveEffortForTick(sessionDefault: string | null = null): string | null {
  const effortKnob = getKnob('effort')
  if (!effortKnob) return sessionDefault

  const fp = process.env.TRUE_LOVE_EFFORT_FILE || knobFilePath(effortKnob)
  if (existsSync(fp)) {
    try {
      const v = readFileSync(fp, 'utf-8').trim().toLowerCase()
      if (v && VALID_EFFORTS.includes(v)) return v
    } catch {
      // fall through
    }
  }
  return sessionDefault
}

/**
 * Resolve the fallback model for this tick.
 */
export function resolveFallbackModelForTick(): string | null {
  const knob = getKnob('fallback-model')
  if (!knob) return null

  const fp = knobFilePath(knob)
  if (existsSync(fp)) {
    try {
      const v = readFileSync(fp, 'utf-8').trim()
      if (v && isValidModel(v)) return v
    } catch {
      // fall through
    }
  }
  return null
}

/**
 * Resolve the complete tick configuration. Called once per tick by
 * the runner to build subprocess CLI args. Reads all tier 1 values
 * directly, tier 2 values only from the active (approved) directory.
 */
export function resolveTickConfig(sessionModel: string | null = null): TickConfig {
  // Import here to avoid circular dependency — resolveModelForTick
  // lives in runner.ts for backwards compat.
  const model = (() => {
    // Replicate resolveModelForTick logic locally so agency is
    // self-contained. The runner can use either.
    const knob = getKnob('model')
    if (!knob) return sessionModel
    const fp = knobFilePath(knob)
    if (fp && existsSync(fp)) {
      try {
        const v = readFileSync(fp, 'utf-8').trim()
        if (v) return v
      } catch { /* fall through */ }
    }
    return sessionModel
  })()

  const effort = resolveEffortForTick()
  const fallbackModel = resolveFallbackModelForTick()

  // Tier 2: only read from active/ (approved values)
  const readActive = (filename: string): string | null => {
    try {
      const fp = join(activeDir(), filename)
      if (!existsSync(fp)) return null
      const v = readFileSync(fp, 'utf-8').trim()
      return v || null
    } catch {
      return null
    }
  }

  const allowedToolsRaw = readActive('allowed-tools.txt')
  const disallowedToolsRaw = readActive('disallowed-tools.txt')
  const maxBudgetRaw = readActive('max-budget-usd.txt')

  return {
    model,
    effort,
    fallbackModel,
    allowedTools: allowedToolsRaw
      ? allowedToolsRaw.split(',').map(t => t.trim()).filter(Boolean)
      : null,
    disallowedTools: disallowedToolsRaw
      ? disallowedToolsRaw.split(',').map(t => t.trim()).filter(Boolean)
      : null,
    maxBudgetUsd: maxBudgetRaw ? Number(maxBudgetRaw) || null : null,
  }
}

/**
 * Build CLI args array from a TickConfig. Used by the runner to
 * construct the subprocess command.
 *
 * Returns pairs like ['--effort', 'high', '--fallback-model', 'sonnet'].
 * Model is excluded — the runner already handles it via resolveModelForTick.
 */
export function tickConfigToCliArgs(config: TickConfig): string[] {
  const args: string[] = []

  if (config.effort) {
    args.push('--effort', config.effort)
  }
  if (config.fallbackModel) {
    args.push('--fallback-model', config.fallbackModel)
  }
  if (config.allowedTools && config.allowedTools.length > 0) {
    args.push('--allowedTools', ...config.allowedTools)
  }
  if (config.disallowedTools && config.disallowedTools.length > 0) {
    args.push('--disallowedTools', ...config.disallowedTools)
  }
  if (config.maxBudgetUsd !== null) {
    args.push('--max-budget-usd', String(config.maxBudgetUsd))
  }

  return args
}
