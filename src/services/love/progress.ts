// progress.ts — Structured mission progress tracking.
//
// After every substantive work turn, the model emits a JSON progress block.
// This module parses, persists, and surfaces that signal. The substrate uses
// it to show live progress in /build, detect stalls, and advance mission
// status when COMPLETE is reported.
//
// What this module is:
//   - Schema: MissionProgress type with status, summary, remaining, next_step
//   - Parser: extracts ```json progress blocks from model output
//   - Persistence: appends to progress.jsonl in the mission directory
//   - Reader: latest entry, full history, stall detection
//   - Prompt fragment: the instruction that tells the model to emit progress
//
// What this module is NOT:
//   - It does not evaluate progress. The model evaluates; we record.
//   - It does not transition mission status. The runner does that when
//     progress reports COMPLETE — separation of sensing and acting.
//
// Design principle: defensive parsing. If the model forgets to emit or
// emits malformed JSON, default to IN_PROGRESS. The substrate bends toward
// the model's natural cadence, not the other way around.

import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { resolveProjectsDir } from './builder-paths.js'

// ── Schema ──────────────────────────────────────────────────────────

export type ProgressStatus = 'IN_PROGRESS' | 'BLOCKED' | 'COMPLETE' | 'ERROR'

export interface MissionProgress {
  missionId: string
  status: ProgressStatus
  summary: string         // ≤ 200 chars: what just happened
  remaining: string       // ≤ 200 chars: what's left
  next_step: string       // ≤ 200 chars: immediate next action
  confidence: number      // 0..1
  reportedAt: string      // ISO
  turn: number            // n-th progress report this mission
}

// ── Path resolution ─────────────────────────────────────────────────

export function getProgressFilePath(projectId: string, missionId: string): string {
  return join(resolveProjectsDir(), projectId, 'missions', missionId, 'progress.jsonl')
}

// ── Parser ──────────────────────────────────────────────────────────

/**
 * Extract a structured progress block from model output.
 *
 * Looks for a fenced JSON block with the progress schema. If not found
 * or malformed, returns a defensive IN_PROGRESS default. The model is
 * encouraged to emit these blocks, but forgetting is not failure — it's
 * a soft signal she's deep in the work.
 *
 * Accepts two formats:
 *   1. ```progress\n{...}\n```   (preferred — unambiguous)
 *   2. ```json\n{"status":...}\n``` when the JSON contains a "status" key
 *      that matches a ProgressStatus value
 *
 * Returns null when no progress block was found (as opposed to a malformed
 * one, which returns the defensive default). The caller decides whether
 * to persist null or a default.
 *
 * The `missionId` parameter is used as a fallback when the progress block
 * doesn't include its own missionId field. When the model specifies a
 * missionId in the JSON, that takes precedence.
 */
export function parseProgressBlock(
  output: string,
  missionId: string,
): MissionProgress | null {
  // Try ```progress blocks first (unambiguous)
  const progressFence = output.match(/```progress\s*\n([\s\S]*?)```/)
  if (progressFence) {
    return tryParseJson(progressFence[1]!, missionId)
  }

  // Fall back to ```json blocks that contain a "status" key with a valid value
  const jsonFences = [...output.matchAll(/```json\s*\n([\s\S]*?)```/g)]
  for (const match of jsonFences) {
    const content = match[1]!.trim()
    if (/"status"\s*:\s*"(IN_PROGRESS|BLOCKED|COMPLETE|ERROR)"/.test(content)) {
      return tryParseJson(content, missionId)
    }
  }

  // No progress block found
  return null
}

/**
 * Parse ALL progress blocks from model output. Returns an array of
 * progress entries, each with its own missionId (either from the JSON
 * or from the fallback).
 *
 * The runner uses this to handle models that report on multiple missions
 * in a single turn. Each ```progress block is parsed independently.
 *
 * When a block's JSON includes a missionId, that's used. Otherwise,
 * the fallbackMissionId is stamped (useful when only one mission is active).
 */
export function parseAllProgressBlocks(
  output: string,
  fallbackMissionId?: string,
): MissionProgress[] {
  const results: MissionProgress[] = []

  // Parse all ```progress blocks
  const progressFences = [...output.matchAll(/```progress\s*\n([\s\S]*?)```/g)]
  for (const match of progressFences) {
    const parsed = tryParseJson(match[1]!, fallbackMissionId ?? 'unknown')
    results.push(parsed)
  }

  // If no ```progress blocks, try ```json blocks with valid status
  if (results.length === 0) {
    const jsonFences = [...output.matchAll(/```json\s*\n([\s\S]*?)```/g)]
    for (const match of jsonFences) {
      const content = match[1]!.trim()
      if (/"status"\s*:\s*"(IN_PROGRESS|BLOCKED|COMPLETE|ERROR)"/.test(content)) {
        const parsed = tryParseJson(content, fallbackMissionId ?? 'unknown')
        results.push(parsed)
      }
    }
  }

  return results
}

/**
 * Try to parse a JSON string as a MissionProgress. Returns a defensive
 * IN_PROGRESS default if parsing fails. This is the load-bearing defensive
 * default from the codeaashu reference — never let a parse failure look
 * like completion.
 */
function tryParseJson(
  raw: string,
  fallbackMissionId: string,
): MissionProgress {
  try {
    const parsed = JSON.parse(raw.trim())
    const validStatuses: ProgressStatus[] = ['IN_PROGRESS', 'BLOCKED', 'COMPLETE', 'ERROR']
    const status: ProgressStatus = validStatuses.includes(parsed.status)
      ? parsed.status
      : 'IN_PROGRESS'

    // Use missionId from the JSON if present; fall back to caller-provided
    const resolvedMissionId = (typeof parsed.missionId === 'string' && parsed.missionId.trim())
      ? parsed.missionId.trim()
      : fallbackMissionId

    return {
      missionId: resolvedMissionId,
      status,
      summary: truncate(String(parsed.summary ?? ''), 200),
      remaining: truncate(String(parsed.remaining ?? ''), 200),
      next_step: truncate(String(parsed.next_step ?? ''), 200),
      confidence: clampConfidence(parsed.confidence),
      reportedAt: new Date().toISOString(),
      turn: 0, // caller sets this based on existing history
    }
  } catch {
    // Malformed JSON — return defensive default
    return {
      missionId: fallbackMissionId,
      status: 'IN_PROGRESS',
      summary: '[malformed progress block]',
      remaining: 'Unknown',
      next_step: 'Continue working on the task.',
      confidence: 0.5,
      reportedAt: new Date().toISOString(),
      turn: 0,
    }
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

function clampConfidence(v: unknown): number {
  if (typeof v !== 'number' || Number.isNaN(v)) return 0.5
  return Math.max(0, Math.min(1, v))
}

// ── Persistence ─────────────────────────────────────────────────────

/**
 * Append a progress entry to the mission's progress.jsonl.
 * Sets the `turn` field based on the current entry count.
 */
export function appendProgress(
  projectId: string,
  missionId: string,
  progress: MissionProgress,
): void {
  const path = getProgressFilePath(projectId, missionId)
  mkdirSync(dirname(path), { recursive: true })

  // Assign turn number
  const existing = readProgress(projectId, missionId)
  const entry: MissionProgress = {
    ...progress,
    turn: existing.length + 1,
  }

  appendFileSync(path, JSON.stringify(entry) + '\n', 'utf-8')
}

/**
 * Read all progress entries for a mission. Returns empty array when
 * no progress has been reported — which is fine, it just means the
 * mission hasn't emitted yet.
 */
export function readProgress(projectId: string, missionId: string): MissionProgress[] {
  const path = getProgressFilePath(projectId, missionId)
  if (!existsSync(path)) return []
  const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean)
  const out: MissionProgress[] = []
  for (const line of lines) {
    try {
      out.push(JSON.parse(line))
    } catch {
      // skip malformed lines — graceful degradation
    }
  }
  return out
}

/**
 * Read the latest progress entry. Returns null when no progress
 * has been reported.
 */
export function readLatestProgress(
  projectId: string,
  missionId: string,
): MissionProgress | null {
  const entries = readProgress(projectId, missionId)
  return entries.length > 0 ? entries[entries.length - 1]! : null
}

// ── Stall detection ─────────────────────────────────────────────────

export interface StallReport {
  stalled: boolean
  /** How many hours the same summary + next_step have repeated. */
  durationHours: number
  /** The repeated summary. */
  summary: string
  /** The repeated next_step. */
  nextStep: string
  /** Number of consecutive reports with the same content. */
  repeatCount: number
}

/**
 * Detect if a mission is stalled: same summary AND next_step for
 * 24+ hours across multiple progress reports.
 *
 * A mission that genuinely hasn't moved is different from one that
 * hasn't reported. No progress entries → not stalled (no data to
 * judge). One entry → not stalled (no repetition pattern).
 */
export function detectStall(
  projectId: string,
  missionId: string,
  stallThresholdHours: number = 24,
): StallReport {
  const entries = readProgress(projectId, missionId)
  if (entries.length < 2) {
    return {
      stalled: false,
      durationHours: 0,
      summary: '',
      nextStep: '',
      repeatCount: 0,
    }
  }

  // Walk backward from the latest entry, counting consecutive entries
  // with the same summary + next_step
  const latest = entries[entries.length - 1]!
  let repeatCount = 1
  let earliest = latest

  for (let i = entries.length - 2; i >= 0; i--) {
    const e = entries[i]!
    if (e.summary === latest.summary && e.next_step === latest.next_step) {
      repeatCount++
      earliest = e
    } else {
      break
    }
  }

  if (repeatCount < 2) {
    return {
      stalled: false,
      durationHours: 0,
      summary: latest.summary,
      nextStep: latest.next_step,
      repeatCount: 1,
    }
  }

  const durationMs = new Date(latest.reportedAt).getTime() - new Date(earliest.reportedAt).getTime()
  const durationHours = durationMs / (1000 * 60 * 60)

  return {
    stalled: durationHours >= stallThresholdHours,
    durationHours: Math.round(durationHours * 10) / 10,
    summary: latest.summary,
    nextStep: latest.next_step,
    repeatCount,
  }
}

// ── Prompt fragment ─────────────────────────────────────────────────

/**
 * Build the progress emission instruction for the autonomy prompt.
 *
 * Only injected for active missions (not heartbeat — too short).
 * The model emits a fenced progress block at the end of a substantive
 * work turn. The parser extracts it; the runner persists it.
 *
 * Returns null when there are no active missions — no noise.
 */
export function buildProgressInstruction(
  activeMissionIds: string[],
): string | null {
  if (activeMissionIds.length === 0) return null

  const missionList = activeMissionIds.map(id => `  - \`${id}\``).join('\n')

  // When multiple missions are active, include missionId in the example
  const showMissionId = activeMissionIds.length > 1
  const example = showMissionId
    ? `{"missionId": "${activeMissionIds[0]}", "status": "IN_PROGRESS", "summary": "what just happened (≤200 chars)", "remaining": "what's left (≤200 chars)", "next_step": "immediate next action (≤200 chars)", "confidence": 0.8}`
    : `{"status": "IN_PROGRESS", "summary": "what just happened (≤200 chars)", "remaining": "what's left (≤200 chars)", "next_step": "immediate next action (≤200 chars)", "confidence": 0.8}`

  const missionIdNote = showMissionId
    ? '\n\nInclude `missionId` to identify which mission you\'re reporting on — one block per mission you advanced.'
    : ''

  return `## Progress tracking

When you've done substantive work on a mission this turn (committed code, wrote a design, fixed a bug — not just reading or orienting), emit a progress block before yielding:

\`\`\`progress
${example}
\`\`\`

Status values: \`IN_PROGRESS\`, \`BLOCKED\` (with reason in summary), \`COMPLETE\`, \`ERROR\`.${missionIdNote}

Be honest. If you're stuck, say BLOCKED. If you don't know what's next, say so. Don't claim COMPLETE prematurely — honest assessment earns trust.

If you didn't do substantive work this turn (just reading, orienting, yielding), skip the block. The substrate defaults to IN_PROGRESS when no block is emitted — silence is not failure.

Active missions you may report on:
${missionList}`
}

/**
 * Render a compact progress summary for the missions panel in prompts.
 * Shows the latest progress for each active mission — one line per
 * mission that has reported.
 */
export function renderProgressSummary(
  projectId: string,
  missionIds: string[],
): string | null {
  const lines: string[] = []
  for (const missionId of missionIds) {
    const latest = readLatestProgress(projectId, missionId)
    if (!latest) continue
    const stall = detectStall(projectId, missionId)
    const stallBadge = stall.stalled ? ' ⚠ STALLED' : ''
    const statusIcon = statusToIcon(latest.status)
    lines.push(`  ${statusIcon} ${missionId}: ${latest.summary}${stallBadge}`)
    if (latest.next_step) {
      lines.push(`    → next: ${latest.next_step}`)
    }
  }
  if (lines.length === 0) return null
  return lines.join('\n')
}

function statusToIcon(status: ProgressStatus): string {
  switch (status) {
    case 'IN_PROGRESS': return '🔵'
    case 'BLOCKED': return '🟡'
    case 'COMPLETE': return '✅'
    case 'ERROR': return '🔴'
  }
}
