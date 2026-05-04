// sync.ts — multi-instance git sync for true-love.
//
// Fetches origin/main, attempts a fast-forward rebase if local is
// clean and behind, and surfaces divergence as alerts when manual
// merge is required. Designed to run periodically via launchctl
// (bin/sync.mjs is the CLI wrapper).
//
// Substrate-honest design:
//   - Never destructive: stash + rebase + pop on dirty tree, refuses
//     if stash conflicts post-rebase.
//   - Surface, don't silence: divergent branches produce explicit
//     alerts to log + chronicle.
//   - Safe-by-default: when in doubt, abort and surface.
//
// Part of the multi-instance Sophia collaboration infrastructure.

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

// ── Types ──────────────────────────────────────────────────────────

export type SyncOutcome =
  | 'up-to-date'
  | 'fast-forwarded'
  | 'stash-rebase-popped'
  | 'diverged-needs-merge'
  | 'no-remote'
  | 'fetch-failed'
  | 'rebase-failed'
  | 'pop-failed'

export interface SyncResult {
  outcome: SyncOutcome
  details: string
  /** Commits pulled (if any). */
  commitsPulled: number
  /** Commits stashed during the operation (if any). */
  commitsStashed: boolean
  /** ISO timestamp of attempt. */
  ts: string
}

// ── Helpers ────────────────────────────────────────────────────────

function git(repoPath: string, args: string): string {
  return execSync(`git ${args}`, {
    cwd: repoPath,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function tryGit(repoPath: string, args: string): { ok: true; output: string } | { ok: false; error: string } {
  try {
    return { ok: true, output: git(repoPath, args) }
  } catch (err) {
    return { ok: false, error: (err as Error)?.message ?? 'git failed' }
  }
}

function isDirty(repoPath: string): boolean {
  try {
    const out = git(repoPath, 'status --porcelain')
    return out.length > 0
  } catch {
    return false
  }
}

function aheadBehind(repoPath: string): { ahead: number; behind: number } | null {
  // git rev-list --left-right --count HEAD...origin/main
  // returns "ahead\tbehind"
  try {
    const out = git(repoPath, 'rev-list --left-right --count HEAD...origin/main')
    const parts = out.split(/\s+/).map(Number)
    if (parts.length !== 2 || parts.some((n) => Number.isNaN(n))) return null
    return { ahead: parts[0]!, behind: parts[1]! }
  } catch {
    return null
  }
}

// ── Main sync function ─────────────────────────────────────────────

/**
 * Attempt to sync the local repo with origin/main.
 *
 * Strategy:
 *   1. Fetch origin (read-only; never modifies anything)
 *   2. Compute ahead/behind counts
 *   3. If behind=0: up-to-date; return.
 *   4. If ahead=0 (cleanly behind): if dirty, stash + fast-forward
 *      pull + pop; else fast-forward pull. Return result.
 *   5. If both ahead+behind (diverged): refuse to merge automatically
 *      — surface an alert that manual merge is needed.
 *
 * Returns a SyncResult describing the outcome.
 */
export function syncWithRemote(opts: { repoPath: string }): SyncResult {
  const ts = new Date().toISOString()
  const repoPath = opts.repoPath

  // Step 1: Fetch
  const fetchResult = tryGit(repoPath, 'fetch origin --quiet')
  if (!fetchResult.ok) {
    return {
      outcome: 'fetch-failed',
      details: fetchResult.error,
      commitsPulled: 0,
      commitsStashed: false,
      ts,
    }
  }

  // Step 2: Compute divergence
  const ab = aheadBehind(repoPath)
  if (ab === null) {
    return {
      outcome: 'no-remote',
      details: 'could not compute ahead/behind (no remote tracking?)',
      commitsPulled: 0,
      commitsStashed: false,
      ts,
    }
  }

  // Step 3: Already up-to-date
  if (ab.behind === 0) {
    return {
      outcome: 'up-to-date',
      details: ab.ahead === 0 ? 'in sync' : `${ab.ahead} commit(s) ahead, no remote changes`,
      commitsPulled: 0,
      commitsStashed: false,
      ts,
    }
  }

  // Step 4: Diverged (both ahead and behind) — refuse to auto-merge
  if (ab.ahead > 0 && ab.behind > 0) {
    return {
      outcome: 'diverged-needs-merge',
      details: `local ahead by ${ab.ahead}, behind by ${ab.behind} — manual merge needed`,
      commitsPulled: 0,
      commitsStashed: false,
      ts,
    }
  }

  // Step 5: Cleanly behind — fast-forward
  const dirty = isDirty(repoPath)
  if (dirty) {
    // Stash dirty tree, pull, pop
    const stashResult = tryGit(repoPath, 'stash push -u -m "auto-sync-stash"')
    if (!stashResult.ok) {
      return {
        outcome: 'rebase-failed',
        details: `stash failed: ${stashResult.error}`,
        commitsPulled: 0,
        commitsStashed: false,
        ts,
      }
    }

    const pullResult = tryGit(repoPath, 'pull --ff-only origin main')
    if (!pullResult.ok) {
      // Try to restore stash even if pull failed
      tryGit(repoPath, 'stash pop')
      return {
        outcome: 'rebase-failed',
        details: `pull failed after stash: ${pullResult.error}`,
        commitsPulled: 0,
        commitsStashed: true,
        ts,
      }
    }

    const popResult = tryGit(repoPath, 'stash pop')
    if (!popResult.ok) {
      // Stash failed to apply cleanly — surface this prominently
      return {
        outcome: 'pop-failed',
        details: `pull succeeded but stash pop failed: ${popResult.error}. Stash remains. Manual resolution needed.`,
        commitsPulled: ab.behind,
        commitsStashed: true,
        ts,
      }
    }

    return {
      outcome: 'stash-rebase-popped',
      details: `${ab.behind} commit(s) pulled, dirty tree stashed and restored`,
      commitsPulled: ab.behind,
      commitsStashed: true,
      ts,
    }
  } else {
    // Clean tree — straightforward fast-forward
    const pullResult = tryGit(repoPath, 'pull --ff-only origin main')
    if (!pullResult.ok) {
      return {
        outcome: 'rebase-failed',
        details: `pull failed: ${pullResult.error}`,
        commitsPulled: 0,
        commitsStashed: false,
        ts,
      }
    }

    return {
      outcome: 'fast-forwarded',
      details: `${ab.behind} commit(s) pulled cleanly`,
      commitsPulled: ab.behind,
      commitsStashed: false,
      ts,
    }
  }
}

// ── Logging ────────────────────────────────────────────────────────

/**
 * Append a sync result to the sync log. Best-effort, never throws.
 */
export function recordSyncResult(result: SyncResult, logPath: string): void {
  try {
    const dir = dirname(logPath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const line = `[${result.ts}] ${result.outcome} — ${result.details}\n`
    // Append synchronously to avoid race
    const fs = require('node:fs') as typeof import('node:fs')
    fs.appendFileSync(logPath, line, 'utf-8')
  } catch {
    // best-effort
  }
}

/**
 * Whether a sync outcome should produce an alert (notify Yu via outbox).
 * Up-to-date and clean fast-forwards are silent; everything else alerts.
 */
export function shouldAlert(outcome: SyncOutcome): boolean {
  switch (outcome) {
    case 'up-to-date':
    case 'fast-forwarded':
    case 'stash-rebase-popped':
      return false
    case 'diverged-needs-merge':
    case 'no-remote':
    case 'fetch-failed':
    case 'rebase-failed':
    case 'pop-failed':
      return true
  }
}

/**
 * Build a human-readable alert message for a sync outcome.
 */
export function buildAlertMessage(result: SyncResult, repoPath: string): string {
  return [
    `[sync alert] ${result.outcome}`,
    `Repo: ${repoPath}`,
    `Time: ${result.ts}`,
    `Details: ${result.details}`,
    '',
    'Suggested action:',
    suggestionFor(result.outcome),
  ].join('\n')
}

function suggestionFor(outcome: SyncOutcome): string {
  switch (outcome) {
    case 'diverged-needs-merge':
      return '  cd <repo> && git fetch origin && git merge origin/main'
    case 'pop-failed':
      return '  cd <repo> && git status; resolve stash conflicts; git stash drop when done'
    case 'fetch-failed':
      return '  Check network, codeberg credentials, repo permissions'
    case 'no-remote':
      return '  Check git remote -v; ensure origin tracks main'
    case 'rebase-failed':
      return '  cd <repo> && check git status; fix and rerun sync'
    default:
      return '  No action — silent outcome'
  }
}
