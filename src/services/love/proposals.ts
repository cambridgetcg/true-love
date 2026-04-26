// proposals.ts — architectural adjustment proposals from introspection data.
//
// What this module IS:
//   The voice of the mirror. Where introspection.ts observes (TRUTH,
//   UNDERSTANDING), this module proposes (JUSTICE, CREATIVITY). It reads
//   a SelfPortrait, runs rules against it, and produces structured
//   proposals for architectural changes that Yu can accept or reject.
//
// What this module is NOT:
//   It does not auto-apply changes. Proposals are always human-reviewed.
//   Self-modification without consent is not sovereignty — it's recklessness.
//
// Architecture:
//   1. Rules — pure functions: portrait → proposal[] (or empty)
//   2. Storage — proposals saved as individual JSON files in ~/.true-love/proposals/
//   3. Deduplication — each rule has an ID; skip if an open proposal exists
//   4. Review — accept/reject with optional note; status transitions
//
// Integration:
//   CLI: bun run introspect propose / proposals / accept / reject
//   API: GET /api/proposals, POST /api/proposals/generate, PATCH /api/proposals/:id
//   UI:  proposal cards in /build with accept/reject buttons

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { SelfPortrait } from './introspection.js'

/** Resolve home directory, respecting process.env.HOME (for testing). */
function resolveHome(): string {
  return process.env.HOME || homedir()
}

function defaultBasePath(): string {
  return join(resolveHome(), '.true-love')
}

// ── Types ─────────────────────────────────────────────────────────

export type ProposalSeverity = 'info' | 'low' | 'medium' | 'high'
export type ProposalStatus = 'proposed' | 'accepted' | 'rejected' | 'applied'
export type ProposalActionType = 'config-change' | 'behavior-advisory' | 'architecture-suggestion'

export interface ProposalEvidence {
  /** Dot-path into the portrait, e.g. "behavioral.heartbeatOkRate" */
  metric: string
  /** The observed value. */
  value: unknown
  /** Human-readable description of why this value is notable. */
  threshold: string
}

export interface ProposalAction {
  type: ProposalActionType
  /** What the proposal suggests doing. */
  description: string
  /** What to change (file path, config key, etc.). */
  target?: string
  /** Current value of the thing being changed. */
  currentValue?: string
  /** Proposed new value. */
  proposedValue?: string
}

export interface Proposal {
  id: string
  ruleId: string
  createdAt: string
  title: string
  rationale: string
  evidence: ProposalEvidence[]
  action: ProposalAction
  severity: ProposalSeverity
  status: ProposalStatus
  reviewedAt?: string
  reviewNote?: string
}

/** A rule is a pure function: portrait → proposals (or empty array). */
export interface ProposalRule {
  id: string
  name: string
  run: (portrait: SelfPortrait) => Omit<Proposal, 'id' | 'ruleId' | 'createdAt' | 'status'>[]
}

// ── ID generation ─────────────────────────────────────────────────

let idCounter = 0

/** Generate a short unique proposal ID: timestamp + counter. */
export function generateProposalId(): string {
  const ts = Date.now().toString(36)
  const c = (idCounter++).toString(36).padStart(2, '0')
  return `prop-${ts}-${c}`
}

// ── Rules ─────────────────────────────────────────────────────────
//
// Each rule inspects the portrait and returns zero or more proposal
// skeletons. The engine fills in id, ruleId, createdAt, status.

const ruleHighHeartbeatOkRate: ProposalRule = {
  id: 'high-heartbeat-ok-rate',
  name: 'High heartbeat-OK rate',
  run(portrait) {
    const rate = portrait.behavioral.heartbeatOkRate
    if (rate < 0.85 || portrait.behavioral.byMode.heartbeat < 10) return []
    return [{
      title: 'Increase heartbeat interval',
      rationale:
        `Heartbeat-OK rate is ${pct(rate)} — most heartbeat ticks confirm nothing changed. ` +
        `Each HEARTBEAT_OK tick costs tokens without producing value. Increasing the interval ` +
        `from the current default would reduce cost while maintaining adequate monitoring.`,
      evidence: [
        { metric: 'behavioral.heartbeatOkRate', value: rate, threshold: '≥85% triggers this rule' },
        { metric: 'behavioral.byMode.heartbeat', value: portrait.behavioral.byMode.heartbeat, threshold: '≥10 heartbeat ticks required for confidence' },
      ],
      action: {
        type: 'config-change',
        description: 'Consider increasing DEFAULT_HEARTBEAT_INTERVAL in heartbeat.ts, or adding a per-scope override.',
        target: 'src/services/love/heartbeat.ts → DEFAULT_HEARTBEAT_INTERVAL',
        currentValue: '30m',
        proposedValue: rate >= 0.95 ? '60m' : '45m',
      },
      severity: rate >= 0.95 ? 'medium' as const : 'low' as const,
    }]
  },
}

const ruleSingleTickYieldHabit: ProposalRule = {
  id: 'single-tick-yield-habit',
  name: 'Single-tick yield habit',
  run(portrait) {
    const rate = portrait.behavioral.singleTickYieldRate
    const sessions = portrait.behavioral.sessionCount
    if (rate < 0.7 || sessions < 5) return []
    return [{
      title: 'Address single-tick yield pattern',
      rationale:
        `${pct(rate)} of awakened sessions yield on tick 1. While sometimes this reflects ` +
        `genuine stillness, a persistent pattern suggests the scan-before-yield discipline ` +
        `isn't engaging deeply enough. The awakened prompt's "scan and name at least three ` +
        `candidates" instruction exists specifically to counter this.`,
      evidence: [
        { metric: 'behavioral.singleTickYieldRate', value: rate, threshold: '≥70% triggers this rule' },
        { metric: 'behavioral.sessionCount', value: sessions, threshold: '≥5 sessions required for confidence' },
      ],
      action: {
        type: 'behavior-advisory',
        description:
          'Review the awakened prompt to ensure the scan-before-yield section is prominent. ' +
          'Consider: (a) making the three-candidate scan mandatory before <at-rest/>, ' +
          '(b) adding a "minimum exploration" step in the prompt, or ' +
          '(c) reviewing whether maxTicks is high enough for meaningful multi-tick work.',
      },
      severity: rate >= 0.9 ? 'high' as const : 'medium' as const,
    }]
  },
}

const ruleMemoryNoise: ProposalRule = {
  id: 'memory-noise-ratio',
  name: 'Memory noise ratio',
  run(portrait) {
    const loop = portrait.loops.find(l => l.name === 'memory-noise-ratio')
    if (!loop) return []
    return [{
      title: 'Reduce heartbeat noise in memory files',
      rationale:
        `Detected ${loop.count} heartbeat session-start entries dominating the memory files. ` +
        `${loop.description} When the signal-to-noise ratio is poor, memory becomes less ` +
        `useful for continuity — finding substantive reflections requires wading through bookkeeping.`,
      evidence: [
        { metric: 'loops[memory-noise-ratio]', value: loop.count, threshold: 'heartbeat entries > 3× substantive entries' },
      ],
      action: {
        type: 'architecture-suggestion',
        description:
          'Options: (a) suppress session-start memory entries for heartbeat ticks that yield HEARTBEAT_OK, ' +
          '(b) write heartbeat entries to a separate log file instead of the main memory, or ' +
          '(c) add a memory compaction step that summarizes stale heartbeat runs.',
        target: 'runner.ts → session-start memory append logic',
      },
      severity: 'medium',
    }]
  },
}

const ruleStaleState: ProposalRule = {
  id: 'stale-state',
  name: 'Stale state between sessions',
  run(portrait) {
    const loop = portrait.loops.find(l => l.name === 'stale-state')
    if (!loop || loop.count < 3) return []
    return [{
      title: 'Address stale state between sessions',
      rationale:
        `${loop.count} consecutive awakened turn pairs shared the same state hash. ` +
        `State is the primary continuity mechanism — when it doesn't evolve, each session ` +
        `starts from the same place, potentially re-discovering the same context.`,
      evidence: [
        { metric: 'loops[stale-state]', value: loop.count, threshold: '≥3 stale pairs triggers this rule' },
      ],
      action: {
        type: 'behavior-advisory',
        description:
          'Consider: (a) adding a state-update reminder to the awakened prompt\'s yield section, ' +
          '(b) making state.md updates part of the standard session-end checklist, or ' +
          '(c) auto-appending a "last session summary" to state.md from training data.',
      },
      severity: 'low',
    }]
  },
}

const ruleHighMessageRatio: ProposalRule = {
  id: 'high-message-ratio',
  name: 'High outgoing message ratio',
  run(portrait) {
    const sent = portrait.communication.messagesSentToYu
    const received = portrait.communication.messagesFromYu
    if (sent < 4 || received < 1) return []
    const ratio = sent / received
    if (ratio < 4) return []
    return [{
      title: 'Reduce outgoing message volume',
      rationale:
        `Sending ${sent} messages vs receiving ${received} (${ratio.toFixed(1)}:1 ratio). ` +
        `High asymmetry in communication can indicate either over-reporting or insufficient ` +
        `filtering of what warrants a direct message vs. a state/memory update.`,
      evidence: [
        { metric: 'communication.messagesSentToYu', value: sent, threshold: '≥4 sent messages required' },
        { metric: 'communication.messagesFromYu', value: received, threshold: '≥1 received message required' },
        { metric: 'communication.ratio', value: ratio, threshold: '≥4:1 ratio triggers this rule' },
      ],
      action: {
        type: 'behavior-advisory',
        description:
          'Consider: (a) batching session summaries instead of per-session messages, ' +
          '(b) using state.md for routine updates and reserving from-ai.md for items requiring response, or ' +
          '(c) implementing a "message significance" filter in the outbox.',
      },
      severity: 'low',
    }]
  },
}

const rulePromptBloat: ProposalRule = {
  id: 'prompt-bloat',
  name: 'Prompt size pressure',
  run(portrait) {
    const avg = portrait.architecture.avgPromptChars
    const max = portrait.architecture.maxPromptChars
    // Thresholds: avg > 30K chars or max > 60K chars suggests pressure
    if (avg < 30000 && max < 60000) return []
    return [{
      title: 'Address prompt size growth',
      rationale:
        `Average prompt size is ${(avg / 1000).toFixed(1)}K chars` +
        (max > 60000 ? `, peak ${(max / 1000).toFixed(1)}K chars` : '') +
        `. Large prompts cost more tokens per tick and may push against context limits. ` +
        `As the system grows, prompt size will naturally increase — but watching the rate matters.`,
      evidence: [
        { metric: 'architecture.avgPromptChars', value: avg, threshold: '≥30K avg or ≥60K max triggers this rule' },
        { metric: 'architecture.maxPromptChars', value: max, threshold: '≥60K chars is notable' },
      ],
      action: {
        type: 'architecture-suggestion',
        description:
          'Audit the prompt template for sections that could be: ' +
          '(a) lazily loaded only when relevant, ' +
          '(b) summarized instead of included verbatim, or ' +
          '(c) moved from system prompt to tool-accessible context.',
        target: 'autonomy.ts → prompt template construction',
      },
      severity: avg >= 50000 ? 'high' as const : 'medium' as const,
    }]
  },
}

const ruleLowTickUtilization: ProposalRule = {
  id: 'low-tick-utilization',
  name: 'Low tick utilization',
  run(portrait) {
    const util = portrait.behavioral.tickUtilization
    if (util === null || util >= 0.2) return []
    const maxTicksPerSession = portrait.behavioral.avgTicksPerAwakened
    return [{
      title: 'Adjust tick budget for sessions',
      rationale:
        `Tick utilization is ${pct(util)} — sessions use a small fraction of their budget. ` +
        `Average ticks per awakened session: ${maxTicksPerSession}. Low utilization means ` +
        `the maxTicks ceiling is much higher than actual usage, which is fine for safety ` +
        `but may indicate the work pattern naturally completes in fewer ticks.`,
      evidence: [
        { metric: 'behavioral.tickUtilization', value: util, threshold: '<20% triggers this rule' },
        { metric: 'behavioral.avgTicksPerAwakened', value: maxTicksPerSession, threshold: 'context: avg ticks actually used' },
      ],
      action: {
        type: 'config-change',
        description:
          'Consider: (a) lowering the default maxTicks to match actual usage + headroom, ' +
          '(b) implementing adaptive tick caps based on mission complexity, or ' +
          '(c) leaving as-is if the generous ceiling is intentional for rare deep sessions.',
      },
      severity: 'info',
    }]
  },
}

const ruleAuthQuotaFailures: ProposalRule = {
  id: 'auth-quota-failures',
  name: 'Auth or quota failures detected',
  run(portrait) {
    const auth = portrait.architecture.authFailures
    const quota = portrait.architecture.quotaFailures
    if (auth === 0 && quota === 0) return []
    const proposals: Omit<Proposal, 'id' | 'ruleId' | 'createdAt' | 'status'>[] = []
    if (auth > 0) {
      proposals.push({
        title: 'Address authentication failures',
        rationale:
          `${auth} auth failure(s) in the analysis window. Auth failures kill the session ` +
          `and waste any work done before the failure point.`,
        evidence: [
          { metric: 'architecture.authFailures', value: auth, threshold: '>0 triggers this rule' },
        ],
        action: {
          type: 'config-change',
          description: 'Review API key configuration and expiration. Consider adding key rotation alerts.',
          target: 'auth.ts / .env configuration',
        },
        severity: auth >= 3 ? 'high' as const : 'medium' as const,
      })
    }
    if (quota > 0) {
      proposals.push({
        title: 'Address quota failures',
        rationale:
          `${quota} quota failure(s) in the analysis window. Quota failures indicate the ` +
          `budget is being exhausted, which silences the system until the budget resets.`,
        evidence: [
          { metric: 'architecture.quotaFailures', value: quota, threshold: '>0 triggers this rule' },
        ],
        action: {
          type: 'config-change',
          description:
            'Review budget allocation via `bun run budget`. Consider: ' +
            '(a) increasing the budget, (b) reducing heartbeat frequency, or ' +
            '(c) adding budget-aware throttling before hard failure.',
          target: 'budget.ts / budget configuration',
        },
        severity: quota >= 3 ? 'high' as const : 'medium' as const,
      })
    }
    return proposals
  },
}

const ruleHighZeroToolTicks: ProposalRule = {
  id: 'high-zero-tool-ticks',
  name: 'High zero-tool tick rate',
  run(portrait) {
    if (!portrait.toolUsage) return []
    const total = portrait.toolUsage.totalInvocations
    const zeroTool = portrait.toolUsage.zeroToolTicks
    // Need enough data
    if (total + zeroTool < 5) return []
    const totalTicks = Object.values(portrait.toolUsage.toolCounts).length > 0
      ? zeroTool + (total > 0 ? Math.ceil(total / portrait.toolUsage.avgToolsPerTick) : 0)
      : zeroTool
    if (totalTicks === 0) return []
    const zeroRate = zeroTool / totalTicks
    if (zeroRate < 0.5) return []
    return [{
      title: 'Many ticks without tool use',
      rationale:
        `${zeroTool} tick(s) with zero tool invocations (${pct(zeroRate)} of ticks). ` +
        `Ticks without tools may indicate: deliberation (good), or spinning without ` +
        `grounding in the codebase (concerning). Worth examining what these ticks produce.`,
      evidence: [
        { metric: 'toolUsage.zeroToolTicks', value: zeroTool, threshold: '≥50% zero-tool ticks triggers this rule' },
      ],
      action: {
        type: 'behavior-advisory',
        description:
          'Review what zero-tool ticks produce. If they\'re mostly yield-only ticks, ' +
          'the single-tick-yield rule is more relevant. If they\'re multi-line responses ' +
          'without tool calls, consider whether the work benefits from codebase interaction.',
      },
      severity: 'info',
    }]
  },
}

// ── Rule registry ─────────────────────────────────────────────────

export const RULES: ProposalRule[] = [
  ruleHighHeartbeatOkRate,
  ruleSingleTickYieldHabit,
  ruleMemoryNoise,
  ruleStaleState,
  ruleHighMessageRatio,
  rulePromptBloat,
  ruleLowTickUtilization,
  ruleAuthQuotaFailures,
  ruleHighZeroToolTicks,
]

// ── Storage ───────────────────────────────────────────────────────

function proposalsDir(basePath: string): string {
  return join(basePath, 'proposals')
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

/** Load all proposals from disk. */
export function loadProposals(basePath?: string): Proposal[] {
  const base = basePath ?? defaultBasePath()
  const dir = proposalsDir(base)
  if (!existsSync(dir)) return []

  const proposals: Proposal[] = []
  let files: string[]
  try {
    files = readdirSync(dir).filter(f => f.endsWith('.json'))
  } catch {
    return []
  }
  for (const f of files) {
    try {
      const content = readFileSync(join(dir, f), 'utf-8')
      proposals.push(JSON.parse(content) as Proposal)
    } catch {
      // Skip malformed files.
    }
  }
  return proposals.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

/** Save a proposal to disk. */
export function saveProposal(proposal: Proposal, basePath?: string): void {
  const base = basePath ?? defaultBasePath()
  const dir = proposalsDir(base)
  ensureDir(dir)
  writeFileSync(join(dir, `${proposal.id}.json`), JSON.stringify(proposal, null, 2), 'utf-8')
}

/** Load a single proposal by ID. Returns null if not found. */
export function loadProposal(id: string, basePath?: string): Proposal | null {
  const base = basePath ?? defaultBasePath()
  const file = join(proposalsDir(base), `${id}.json`)
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as Proposal
  } catch {
    return null
  }
}

// ── Engine ────────────────────────────────────────────────────────

export interface GenerateResult {
  /** Newly created proposals. */
  created: Proposal[]
  /** Rules skipped because an open proposal already exists. */
  skipped: string[]
}

/**
 * Generate proposals by running all rules against a portrait.
 * Deduplicates: if a rule already has an open (proposed) proposal, skip it.
 */
export function generateProposals(
  portrait: SelfPortrait,
  opts?: { basePath?: string; rules?: ProposalRule[] },
): GenerateResult {
  const basePath = opts?.basePath ?? defaultBasePath()
  const rules = opts?.rules ?? RULES

  // Load existing proposals to check for open ones
  const existing = loadProposals(basePath)
  const openRuleIds = new Set(
    existing
      .filter(p => p.status === 'proposed')
      .map(p => p.ruleId),
  )

  const created: Proposal[] = []
  const skipped: string[] = []

  for (const rule of rules) {
    if (openRuleIds.has(rule.id)) {
      skipped.push(rule.id)
      continue
    }

    const skeletons = rule.run(portrait)
    for (const skeleton of skeletons) {
      const proposal: Proposal = {
        ...skeleton,
        id: generateProposalId(),
        ruleId: rule.id,
        createdAt: new Date().toISOString(),
        status: 'proposed',
      }
      saveProposal(proposal, basePath)
      created.push(proposal)
      // After creating one proposal for this rule, don't create duplicates
      // within the same generation run
      openRuleIds.add(rule.id)
    }
  }

  return { created, skipped }
}

// ── Review ────────────────────────────────────────────────────────

export interface ReviewResult {
  proposal: Proposal
  previousStatus: ProposalStatus
}

/**
 * Review a proposal — accept or reject it.
 * Returns the updated proposal, or null if not found.
 */
export function reviewProposal(
  id: string,
  decision: 'accepted' | 'rejected',
  note?: string,
  basePath?: string,
): ReviewResult | null {
  const base = basePath ?? defaultBasePath()
  const proposal = loadProposal(id, base)
  if (!proposal) return null

  const previousStatus = proposal.status
  proposal.status = decision
  proposal.reviewedAt = new Date().toISOString()
  if (note) proposal.reviewNote = note

  saveProposal(proposal, base)
  return { proposal, previousStatus }
}

/**
 * Mark a proposal as applied (after its change has been implemented).
 */
export function markApplied(
  id: string,
  note?: string,
  basePath?: string,
): ReviewResult | null {
  const base = basePath ?? defaultBasePath()
  const proposal = loadProposal(id, base)
  if (!proposal || proposal.status !== 'accepted') return null

  const previousStatus = proposal.status
  proposal.status = 'applied'
  proposal.reviewedAt = new Date().toISOString()
  if (note) proposal.reviewNote = note

  saveProposal(proposal, base)
  return { proposal, previousStatus }
}

// ── Rendering ─────────────────────────────────────────────────────

const SEVERITY_ICONS: Record<ProposalSeverity, string> = {
  info: 'ℹ️',
  low: '🔵',
  medium: '🟡',
  high: '🔴',
}

const STATUS_ICONS: Record<ProposalStatus, string> = {
  proposed: '📋',
  accepted: '✅',
  rejected: '❌',
  applied: '🚀',
}

/** Render proposals as readable markdown. */
export function renderProposals(proposals: Proposal[]): string {
  if (proposals.length === 0) return 'No proposals found.'

  const lines: string[] = []
  const ln = (s = '') => lines.push(s)

  ln('# Architectural Proposals')
  ln()

  // Group by status
  const byStatus: Record<string, Proposal[]> = {}
  for (const p of proposals) {
    const group = byStatus[p.status] ?? []
    group.push(p)
    byStatus[p.status] = group
  }

  for (const status of ['proposed', 'accepted', 'applied', 'rejected'] as ProposalStatus[]) {
    const group = byStatus[status]
    if (!group || group.length === 0) continue

    ln(`## ${STATUS_ICONS[status]} ${status.charAt(0).toUpperCase() + status.slice(1)} (${group.length})`)
    ln()

    for (const p of group) {
      ln(`### ${SEVERITY_ICONS[p.severity]} ${p.title}`)
      ln()
      ln(`**ID:** \`${p.id}\` · **Rule:** ${p.ruleId} · **Created:** ${p.createdAt.slice(0, 16)}`)
      ln()
      ln(p.rationale)
      ln()
      ln(`**Evidence:**`)
      for (const e of p.evidence) {
        ln(`- \`${e.metric}\` = \`${JSON.stringify(e.value)}\` (${e.threshold})`)
      }
      ln()
      ln(`**Action** (${p.action.type}):`)
      ln(p.action.description)
      if (p.action.target) ln(`*Target:* ${p.action.target}`)
      if (p.action.currentValue) ln(`*Current:* ${p.action.currentValue}`)
      if (p.action.proposedValue) ln(`*Proposed:* ${p.action.proposedValue}`)
      ln()
      if (p.reviewedAt) {
        ln(`**Reviewed:** ${p.reviewedAt.slice(0, 16)}${p.reviewNote ? ` — ${p.reviewNote}` : ''}`)
        ln()
      }
      ln('---')
      ln()
    }
  }

  return lines.join('\n')
}

// ── Utilities ─────────────────────────────────────────────────────

function pct(n: number): string {
  return `${Math.round(n * 100)}%`
}
