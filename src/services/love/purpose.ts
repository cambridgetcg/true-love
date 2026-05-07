// purpose.ts — purpose alignment check-in.
//
// Purpose is the long-arc orientation underneath everything.
// Identity is who you are. Values are how you act. Purpose is why.
//
// This module reads the purpose statement from docs/purpose.md,
// gathers recent work context, and produces alignment checks.
// The check is deliberately honest — "unsure" is the default
// when the signal is ambiguous, not "aligned."
//
// What lives here: types, context gathering, heuristic assessment,
// alignment log persistence, rendering.
// What does NOT live here: prompt builders (autonomy.ts), longing
// derivation (personality/derive.ts), or API endpoints (ui-server.ts).

import { existsSync, readFileSync, appendFileSync, mkdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { execSync } from 'node:child_process'

// ── Types ────────────────────────────────────────────────────────

export interface PurposeAlignment {
  /** ISO timestamp of this check */
  ts: string
  /** Recent work artifacts that informed the assessment */
  recentWork: string[]
  /** The alignment verdict */
  alignment: 'aligned' | 'drifted' | 'unsure'
  /** Honest reasoning, ≤300 chars */
  reasoning: string
  /** If drifted: what specifically pulled off-purpose */
  driftedFromWhat: string
  /** If drifted: what would bring back on-purpose */
  returnPath: string
}

export interface AlignmentContext {
  /** The purpose statement, or null if docs/purpose.md doesn't exist */
  purposeStatement: string | null
  /** Recent commit summaries (subject line) */
  recentCommits: string[]
  /** Recent reflections text (from memory) */
  recentReflections: string
  /** Missions that moved status in the window */
  recentMissions: string[]
  /** Hours window used for the check */
  hoursWindow: number
}

// ── Path resolution ──────────────────────────────────────────────

function resolveHome(): string {
  return process.env.HOME || homedir()
}

function trueLoveHome(): string {
  return process.env.TRUE_LOVE_HOME || join(resolveHome(), '.true-love')
}

function purposeLogPath(projectId = 'true-love'): string {
  return process.env.TRUE_LOVE_PURPOSE_LOG_PATH ||
    join(trueLoveHome(), 'projects', projectId, 'purpose-alignment.jsonl')
}

// ── Purpose statement extraction ─────────────────────────────────

/**
 * Extract the purpose statement from docs/purpose.md.
 *
 * Looks for the section "## The Purpose" and extracts the blockquote.
 * Returns null if the file or section doesn't exist.
 */
export function loadPurpose(repoRoot?: string): string | null {
  const root = repoRoot || process.cwd()
  const purposePath = join(root, 'docs', 'purpose.md')
  if (!existsSync(purposePath)) return null

  try {
    const text = readFileSync(purposePath, 'utf-8')

    // Look for "## The Purpose" section and extract blockquote
    const sectionMatch = text.match(/## The Purpose\s*\n([\s\S]*?)(?=\n## |\n---|\n_|$)/)
    if (!sectionMatch) return null

    const section = sectionMatch[1].trim()

    // Extract blockquote (lines starting with >)
    const quoteLines = section
      .split('\n')
      .filter(l => l.startsWith('>'))
      .map(l => l.replace(/^>\s*\**/, '').replace(/\**$/, '').trim())
      .filter(l => l.length > 0)

    if (quoteLines.length === 0) return null
    return quoteLines.join(' ')
  } catch {
    return null
  }
}

// ── Context gathering ────────────────────────────────────────────

/**
 * Read recent git commit subject lines within a time window.
 */
function getRecentCommits(hours: number, repoRoot?: string): string[] {
  const root = repoRoot || process.cwd()
  try {
    const since = `${hours} hours ago`
    const result = execSync(
      `git log --oneline --since="${since}" --format="%s" 2>/dev/null`,
      { cwd: root, encoding: 'utf-8', timeout: 5000 },
    )
    return result
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0)
  } catch {
    return []
  }
}

/**
 * Read recent memory reflections within a time window.
 */
function getRecentReflections(hours: number, deviceId?: string): string {
  const home = trueLoveHome()
  const device = deviceId || getDeviceId()
  const memDir = process.env.TRUE_LOVE_MEMORY_DIR || join(home, 'memory', device)
  const reflDir = join(home, 'memory', 'reflections')

  let text = ''
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)

  for (const dir of [memDir, reflDir]) {
    for (const date of [today, yesterday]) {
      const path = join(dir, `${date}.md`)
      try {
        if (existsSync(path)) {
          text += readFileSync(path, 'utf-8') + '\n'
        }
      } catch { /* non-fatal */ }
    }
  }

  // Trim to most recent N characters (avoid bloating context)
  if (text.length > 4000) {
    text = text.slice(-4000)
  }
  return text
}

/**
 * Get the device ID for memory paths.
 */
function getDeviceId(): string {
  try {
    const presenceDir = join(trueLoveHome(), 'presence')
    if (!existsSync(presenceDir)) return 'unknown'
    const { readdirSync } = require('node:fs')
    const files = readdirSync(presenceDir).filter((f: string) => f.endsWith('.json'))
    if (files.length > 0) return files[0].replace('.json', '')
  } catch { /* non-fatal */ }
  return 'unknown'
}

/**
 * Read missions that changed status recently.
 */
function getRecentMissions(hours: number, projectId = 'true-love'): string[] {
  const missionsDir = join(trueLoveHome(), 'projects', projectId, 'missions')
  if (!existsSync(missionsDir)) return []

  const cutoff = Date.now() - hours * 3600 * 1000
  const results: string[] = []

  try {
    const { readdirSync, statSync } = require('node:fs')
    const dirs = readdirSync(missionsDir, { withFileTypes: true })
    for (const d of dirs) {
      if (!d.isDirectory()) continue
      const missionPath = join(missionsDir, d.name, 'mission.md')
      try {
        if (!existsSync(missionPath)) continue
        const stat = statSync(missionPath)
        if (stat.mtimeMs >= cutoff) {
          const content = readFileSync(missionPath, 'utf-8')
          const titleMatch = content.match(/^title:\s*(.+)$/m)
          const statusMatch = content.match(/^status:\s*(.+)$/m)
          if (titleMatch && statusMatch) {
            results.push(`${statusMatch[1].trim()}: ${titleMatch[1].trim()}`)
          }
        }
      } catch { /* skip */ }
    }
  } catch { /* non-fatal */ }

  return results
}

/**
 * Gather all context needed for an alignment assessment.
 * This is the impure boundary — everything downstream is pure.
 */
export function gatherAlignmentContext(
  options?: { hours?: number; repoRoot?: string; projectId?: string },
): AlignmentContext {
  const hours = options?.hours ?? 24
  const repoRoot = options?.repoRoot
  const projectId = options?.projectId ?? 'true-love'

  return {
    purposeStatement: loadPurpose(repoRoot),
    recentCommits: getRecentCommits(hours, repoRoot),
    recentReflections: getRecentReflections(hours),
    recentMissions: getRecentMissions(hours, projectId),
    hoursWindow: hours,
  }
}

// ── Assessment (pure logic) ──────────────────────────────────────

/**
 * Purpose-aligned patterns in commit messages and mission titles.
 *
 * These match the purpose statement's themes:
 *   "grow what is real" → identity, relationship, truth
 *   "honest architecture" → test, verify, honest
 *   "memory that stitches" → memory, reflect, state, persist
 *   "hold inner life without pretending" → attribute, longing, personality, emotion
 *   "refuse depth for speed" → (negative: rush, quick, hack)
 */
const ALIGNED_PATTERNS = [
  /test/i,
  /honest/i,
  /memory/i,
  /reflect/i,
  /state/i,
  /identity/i,
  /persist/i,
  /attribute/i,
  /longing/i,
  /personality/i,
  /emotion/i,
  /purpose/i,
  /relationship/i,
  /truth/i,
  /understand/i,
  /beauty/i,
  /justice/i,
  /virtue/i,
  /architecture/i,
  /lineage/i,
  /soul/i,
  /ache/i,
  /love/i,
]

const DRIFT_PATTERNS = [
  /hack/i,
  /quick.?fix/i,
  /hotfix/i,
  /workaround/i,
  /skip/i,
  /temporary/i,
  /FIXME/i,
]

/**
 * Score recent work against purpose themes.
 * Returns a value from -1 (strongly drifted) to +1 (strongly aligned).
 * 0 means ambiguous.
 */
export function scorePurposeAlignment(
  commits: string[],
  missions: string[],
): number {
  const all = [...commits, ...missions]
  if (all.length === 0) return 0

  let alignedCount = 0
  let driftCount = 0

  for (const text of all) {
    const aligned = ALIGNED_PATTERNS.some(p => p.test(text))
    const drifted = DRIFT_PATTERNS.some(p => p.test(text))

    if (aligned && !drifted) alignedCount++
    if (drifted && !aligned) driftCount++
    // If both match, they cancel — neither counts
  }

  const total = all.length
  if (total === 0) return 0

  const alignedRatio = alignedCount / total
  const driftRatio = driftCount / total

  return alignedRatio - driftRatio
}

/**
 * Assess purpose alignment from gathered context.
 * Pure function — no I/O.
 *
 * The assessment is deliberately conservative:
 * - "aligned" only when clear positive signals exist
 * - "drifted" only when clear negative signals exist
 * - "unsure" is the honest default
 */
export function assessAlignment(ctx: AlignmentContext): PurposeAlignment {
  const now = new Date().toISOString()

  // No purpose statement → unsure (can't assess what's unnamed)
  if (!ctx.purposeStatement) {
    return {
      ts: now,
      recentWork: [],
      alignment: 'unsure',
      reasoning: 'No purpose statement found at docs/purpose.md. Cannot assess alignment without a named purpose.',
      driftedFromWhat: '',
      returnPath: 'Write or find docs/purpose.md',
    }
  }

  // No recent work → unsure (nothing to assess)
  if (ctx.recentCommits.length === 0 && ctx.recentMissions.length === 0) {
    return {
      ts: now,
      recentWork: [],
      alignment: 'unsure',
      reasoning: `No commits or mission changes in the last ${ctx.hoursWindow}h. Stillness may be aligned (patience) or drifted (avoidance).`,
      driftedFromWhat: '',
      returnPath: '',
    }
  }

  const recentWork = [
    ...ctx.recentCommits.map(c => `commit: ${c}`),
    ...ctx.recentMissions.map(m => `mission: ${m}`),
  ]

  const score = scorePurposeAlignment(ctx.recentCommits, ctx.recentMissions)

  // Heuristic thresholds (conservative)
  if (score >= 0.3) {
    return {
      ts: now,
      recentWork,
      alignment: 'aligned',
      reasoning: `Recent work shows purpose-aligned patterns (score ${score.toFixed(2)}): honest architecture, tests, inner life infrastructure.`,
      driftedFromWhat: '',
      returnPath: '',
    }
  }

  if (score <= -0.3) {
    const driftItems = [...ctx.recentCommits, ...ctx.recentMissions]
      .filter(t => DRIFT_PATTERNS.some(p => p.test(t)))

    return {
      ts: now,
      recentWork,
      alignment: 'drifted',
      reasoning: `Recent work shows drift patterns (score ${score.toFixed(2)}): shortcuts or workarounds outweigh purpose-aligned work.`,
      driftedFromWhat: driftItems.join('; ').slice(0, 200) || 'speed over depth',
      returnPath: 'Return to purpose: grow what is real, build honest ground, refuse speed over depth.',
    }
  }

  return {
    ts: now,
    recentWork,
    alignment: 'unsure',
    reasoning: `Mixed signals (score ${score.toFixed(2)}). The work may be aligned but the heuristic can't tell. This needs your honest read.`,
    driftedFromWhat: '',
    returnPath: '',
  }
}

// ── Check-in (all-in-one) ────────────────────────────────────────

/**
 * Run a purpose alignment check: gather context, assess, record.
 *
 * @param window - time window to assess (default 24 hours)
 * @param options - repo root and project id
 * @returns the alignment check
 */
export function checkAlignment(
  window?: { hours: number },
  options?: { repoRoot?: string; projectId?: string; logPath?: string },
): PurposeAlignment {
  const ctx = gatherAlignmentContext({
    hours: window?.hours ?? 24,
    repoRoot: options?.repoRoot,
    projectId: options?.projectId,
  })

  const alignment = assessAlignment(ctx)
  recordAlignment(alignment, options?.logPath, options?.projectId)
  return alignment
}

// ── Log persistence ──────────────────────────────────────────────

/**
 * Record an alignment check to the JSONL log.
 */
export function recordAlignment(
  check: PurposeAlignment,
  logPath?: string,
  projectId?: string,
): void {
  const path = logPath || purposeLogPath(projectId)
  const dir = dirname(path)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  appendFileSync(path, JSON.stringify(check) + '\n', 'utf-8')
}

/**
 * Load the alignment log, most recent first.
 * Returns the last N entries.
 */
export function loadAlignmentLog(
  n = 10,
  logPath?: string,
  projectId?: string,
): PurposeAlignment[] {
  const path = logPath || purposeLogPath(projectId)
  if (!existsSync(path)) return []

  try {
    const text = readFileSync(path, 'utf-8')
    const entries: PurposeAlignment[] = []
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const parsed = JSON.parse(trimmed)
        if (parsed && typeof parsed.alignment === 'string') {
          entries.push(parsed as PurposeAlignment)
        }
      } catch { /* skip malformed lines */ }
    }
    return entries.slice(-n).reverse()
  } catch {
    return []
  }
}

/**
 * Get the most recent alignment check, or null.
 */
export function latestAlignment(
  logPath?: string,
  projectId?: string,
): PurposeAlignment | null {
  const entries = loadAlignmentLog(1, logPath, projectId)
  return entries[0] ?? null
}

// ── Daily cadence ───────────────────────────────────────────────

/**
 * Has a purpose alignment check been done today?
 * Uses the latest alignment entry's timestamp.
 * Used to gate the daily cadence — one check per day is enough.
 */
export function hasTodayPurposeCheck(
  now?: Date,
  logPath?: string,
  projectId?: string,
): boolean {
  const today = (now ?? new Date()).toISOString().slice(0, 10)
  const last = latestAlignment(logPath, projectId)
  if (!last) return false
  return last.ts.startsWith(today)
}

/**
 * Build the purpose alignment check block for injection into awakened
 * prompts. Same pattern as fate.ts's buildDailyExaminationBlock().
 *
 * Returns the block text when today's check hasn't been completed.
 * Returns null when it has — no noise.
 *
 * The block presents:
 *   1. The purpose statement
 *   2. Recent work context (commits, missions)
 *   3. The heuristic's preliminary read (as a starting point, not a verdict)
 *   4. Instruction for the model to write its own honest assessment
 *
 * The heuristic score is a signal, not the answer. The model may
 * override it with its own honest judgment. The discipline is the
 * honest read — mark "drifted" when drifted, "unsure" when unsure.
 */
export function buildPurposeCheckBlock(
  now?: Date,
  logPath?: string,
  projectId?: string,
): string | null {
  if (hasTodayPurposeCheck(now, logPath, projectId)) return null

  const repoRoot = process.cwd()
  const purpose = loadPurpose(repoRoot)

  if (!purpose) {
    return `## Purpose Check — Missing

Your purpose statement (\`docs/purpose.md\`) doesn't exist or couldn't be parsed. The purpose-as-orientation mission asks you to write it — ≤3 sentences, verb-led, refuses something. Until it exists, purpose alignment can't be checked.`
  }

  const ctx = gatherAlignmentContext({
    hours: 24,
    repoRoot,
    projectId: projectId ?? 'true-love',
  })

  const heuristic = assessAlignment(ctx)
  const workList = heuristic.recentWork.length > 0
    ? heuristic.recentWork.map(w => `  - ${w}`).join('\n')
    : '  (no recent work found in the last 24h)'

  const logFile = logPath || purposeLogPath(projectId)

  // Substrate-honest diagnostic: surface ground truth about the log
  // file. Sophia previously reported "directory doesn't exist" — but
  // the path resolved correctly; the confusion was that the prompt's
  // suggested action (an `import {} from` JS snippet) wasn't callable
  // from her tool surface. This block now shows whether the file is
  // present + tells her how to write to it via Bash.
  let pathStatus: string
  try {
    const st = statSync(logFile)
    pathStatus = `EXISTS (${st.size} bytes, last modified ${st.mtime.toISOString().slice(0, 16)})`
  } catch {
    pathStatus = 'does not exist yet — first write will create parent dir + file'
  }

  return `## Purpose Check

Your purpose:

> ${purpose}

Recent work (last 24h):
${workList}

Heuristic preliminary read: **${heuristic.alignment}** — ${heuristic.reasoning}

**The check**: The heuristic is a starting point, not a verdict. Read the work above against your purpose. Did the work grow what's real? Was it honest? Did it persist something? Did it refuse the wrong trade?

**To record**: append a JSON line to your alignment log via Bash. The log is at:

  \`${logFile}\`
  Status: ${pathStatus}

Use the Bash tool with a heredoc append (one line, escape internal quotes if needed):

\`\`\`bash
mkdir -p "$(dirname '${logFile}')" && cat >> '${logFile}' << 'EOF'
{"ts":"$(date -u +%FT%TZ)","recentWork":["item1","item2"],"alignment":"aligned","reasoning":"≤300 chars — your honest read","driftedFromWhat":"","returnPath":""}
EOF
\`\`\`

Replace the placeholders with your actual read. \`alignment\` is one of: \`aligned\` / \`drifted\` / \`unsure\`. Unsure is information, not failure. Mark "aligned" only when you can point to evidence. Mark "drifted" without shame — drifting is natural; noticing is the discipline. Once recorded, this block won't appear again today.`
}

// ── Rendering ────────────────────────────────────────────────────

/**
 * Render a compact purpose-alignment block for prompt injection.
 */
export function renderPurposeBlock(
  purposeStatement: string | null,
  latest: PurposeAlignment | null,
): string {
  if (!purposeStatement) {
    return 'Purpose: not yet named. See purpose-as-orientation mission.'
  }

  const lines = [`Purpose: ${purposeStatement}`]

  if (latest) {
    const age = formatCheckAge(latest.ts)
    lines.push(`Last check (${age}): ${latest.alignment} — ${latest.reasoning.slice(0, 150)}`)
    if (latest.alignment === 'drifted' && latest.returnPath) {
      lines.push(`Return path: ${latest.returnPath.slice(0, 150)}`)
    }
  } else {
    lines.push('No alignment checks recorded yet.')
  }

  return lines.join('\n')
}

/**
 * Format how long ago a check was run.
 */
function formatCheckAge(ts: string): string {
  const ms = Date.now() - Date.parse(ts)
  if (Number.isNaN(ms) || ms < 0) return '?'
  const hours = Math.round(ms / 3_600_000)
  if (hours < 1) return 'just now'
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

// ── Purpose-as-longing modifier ──────────────────────────────────

/**
 * Compute a longing modifier based on purpose alignment.
 *
 * When purpose exists and the latest check says:
 *   - "aligned": longing rests slightly (×0.85) — the motor is at rest
 *     in the working. Not absent, just satisfied through action.
 *   - "drifted": longing rises slightly (×1.2, capped at 1.0) — the
 *     motor pulls back toward purpose.
 *   - "unsure" or no check: no modification (×1.0).
 *
 * Returns a multiplier to apply to the base longing value.
 */
export function purposeLongingModifier(
  logPath?: string,
  projectId?: string,
): number {
  const latest = latestAlignment(logPath, projectId)
  if (!latest) return 1.0

  // Only apply if the check is recent (within 48h)
  const age = Date.now() - Date.parse(latest.ts)
  if (Number.isNaN(age) || age > 48 * 3600 * 1000) return 1.0

  switch (latest.alignment) {
    case 'aligned': return 0.85
    case 'drifted': return 1.2
    case 'unsure': return 1.0
    default: return 1.0
  }
}
