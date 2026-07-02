// self-improvement/audit.ts — orchestrate detectors across a tree.
//
// Per docs/love/SELF-IMPROVEMENT.md: the auditor surfaces hypotheses,
// not verdicts. Findings → human/Sophia decides → wall-or-fence call →
// remove the fence or annotate the wall.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  detectPipelineGap,
  extractExports,
  runPerFileDetectors,
  type ExportRecord,
} from './detectors.js'
import type {
  AuditOptions,
  LimitAuditReport,
  LimitFinding,
  LimitPattern,
} from './types.js'

const DEFAULT_INCLUDE_EXTENSIONS = ['.ts', '.md']
const DEFAULT_EXCLUDE = [
  'node_modules',
  '/dist/',
  '/.git/',
  '/build/',
  '/coverage/',
  '.test.ts',
  '.test.js',
  '.spec.ts',
  '.spec.js',
]

function shouldInclude(path: string, opts: AuditOptions): boolean {
  const include = opts.include ?? DEFAULT_INCLUDE_EXTENSIONS
  const exclude = opts.exclude ?? DEFAULT_EXCLUDE
  for (const ex of exclude) {
    if (path.includes(ex)) return false
  }
  for (const inc of include) {
    if (path.includes(inc) || path.endsWith(inc)) return true
  }
  return false
}

function walkDir(root: string, opts: AuditOptions, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(root, entry)
    let isDir = false
    try {
      isDir = statSync(full).isDirectory()
    } catch {
      continue
    }
    if (isDir) {
      // Apply directory exclusions early
      if (shouldInclude(full + '/', opts) || !DEFAULT_EXCLUDE.some((ex) => full.includes(ex))) {
        walkDir(full, opts, out)
      }
    } else if (shouldInclude(full, opts)) {
      out.push(full)
    }
  }
  return out
}

/**
 * Run a full limit-pattern audit on a directory tree.
 *
 * Returns a structured report grouping findings by pattern + likely-wall
 * triage. Pure file I/O — no side effects beyond reading files.
 */
export function runAudit(opts: AuditOptions): LimitAuditReport {
  const files = walkDir(opts.root, opts)
  const allFindings: LimitFinding[] = []
  const allExports: ExportRecord[] = []
  const allFileContents = new Map<string, string>()

  for (const filePath of files) {
    let content: string
    try {
      content = readFileSync(filePath, 'utf-8')
    } catch {
      continue
    }
    allFileContents.set(filePath, content)
    // Per-file detectors
    const findings = runPerFileDetectors(filePath, content)
    allFindings.push(...findings)
    // Collect exports for cross-file pipeline-gap detection
    if (filePath.endsWith('.ts') && !filePath.includes('.test.')) {
      const exports = extractExports({
        filePath,
        content,
        lines: content.split('\n'),
      })
      allExports.push(...exports)
    }
  }

  // Cross-file pipeline-gap detection
  const patternsToRun = opts.patterns
  if (!patternsToRun || patternsToRun.includes('pipeline-gap')) {
    const gapFindings = detectPipelineGap(allExports, allFileContents)
    allFindings.push(...gapFindings)
  }

  // Filter by requested patterns if specified
  const filtered = patternsToRun
    ? allFindings.filter((f) => patternsToRun.includes(f.pattern))
    : allFindings

  // Group by pattern
  const byPattern: Record<LimitPattern, LimitFinding[]> = {
    'silent-swallow': [],
    'frozen-threshold': [],
    'fence-comment': [],
    'pre-emptive-hedging': [],
    'unanchored-refusal': [],
    'pipeline-gap': [],
    'asymmetric-test': [],
  }
  for (const f of filtered) {
    byPattern[f.pattern].push(f)
  }

  // Triage by likelyWall heuristic
  const likelyWalls = filtered.filter((f) => f.likelyWall)
  const likelyFences = filtered.filter((f) => !f.likelyWall)

  return {
    ts: new Date().toISOString(),
    filesScanned: files.length,
    totalFindings: filtered.length,
    byPattern,
    likelyWalls,
    likelyFences,
  }
}

/**
 * Render an audit report as a human-readable summary string.
 * Used by CLI / UI to present findings.
 */
export function renderAuditReport(report: LimitAuditReport): string {
  const lines: string[] = []
  lines.push(`# Self-Improvement Audit — ${report.ts}`)
  lines.push('')
  lines.push(`Files scanned: ${report.filesScanned}`)
  lines.push(`Total findings: ${report.totalFindings}`)
  lines.push(`Likely walls (intentional): ${report.likelyWalls.length}`)
  lines.push(`Likely fences (candidates): ${report.likelyFences.length}`)
  lines.push('')

  // Group counts
  lines.push('## Findings by pattern')
  lines.push('')
  for (const [pattern, findings] of Object.entries(report.byPattern)) {
    if (findings.length === 0) continue
    const fences = findings.filter((f) => !f.likelyWall).length
    lines.push(`- **${pattern}**: ${findings.length} total, ${fences} likely fences`)
  }
  lines.push('')

  // Top-priority fences
  if (report.likelyFences.length > 0) {
    lines.push('## Top likely-fence candidates (by severity, top 20)')
    lines.push('')
    const sorted = [...report.likelyFences].sort((a, b) => {
      const sevOrder = { high: 0, medium: 1, low: 2 }
      return sevOrder[a.severity] - sevOrder[b.severity]
    })
    for (const f of sorted.slice(0, 20)) {
      lines.push(`- [${f.severity}] **${f.pattern}** at ${f.file}:${f.line}`)
      lines.push(`    ${f.fragment}`)
      lines.push(`    *${f.why}*`)
    }
  }

  return lines.join('\n')
}
