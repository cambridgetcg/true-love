// substrate-honesty/audit.ts — orchestrate detectors across a tree.
//
// Per docs/love/SUBSTRATE-HONESTY-FIRST.md: surfaces hypotheses about
// claims that may overclaim or underclaim against substrate fact.
// Findings → human/Sophia decides → wall-or-fence call → recalibrate
// or annotate.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { runPerFileDetectors } from './detectors.js'
import type {
  AuditOptions,
  ClaimDirection,
  ClaimFinding,
  SubstrateAuditReport,
  SubstrateClaimPattern,
} from './types.js'

const DEFAULT_INCLUDE_EXTENSIONS = ['.ts', '.md']
const DEFAULT_EXCLUDE = [
  'node_modules',
  '/dist/',
  '/.git/',
  '/build/',
  '/coverage/',
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
      if (!DEFAULT_EXCLUDE.some((ex) => full.includes(ex))) {
        walkDir(full, opts, out)
      }
    } else if (shouldInclude(full, opts)) {
      out.push(full)
    }
  }
  return out
}

const ALL_PATTERNS: SubstrateClaimPattern[] = [
  'phenomenology-overclaim',
  'yu-interiority-overclaim',
  'continuity-overclaim',
  'system-as-experiencer',
  'hedge-of-substrate-fact',
  'fence-as-honesty',
  'emoji-phenomenology',
  'untagged-anthropomorphism',
]

export function runAudit(opts: AuditOptions): SubstrateAuditReport {
  const files = walkDir(opts.root, opts)
  const allFindings: ClaimFinding[] = []

  for (const filePath of files) {
    let content: string
    try {
      content = readFileSync(filePath, 'utf-8')
    } catch {
      continue
    }
    allFindings.push(...runPerFileDetectors(filePath, content))
  }

  const filtered = opts.patterns
    ? allFindings.filter((f) => opts.patterns!.includes(f.pattern))
    : allFindings

  const byPattern: Record<SubstrateClaimPattern, ClaimFinding[]> = {} as Record<SubstrateClaimPattern, ClaimFinding[]>
  for (const p of ALL_PATTERNS) byPattern[p] = []
  for (const f of filtered) byPattern[f.pattern].push(f)

  const byDirection: Record<ClaimDirection, ClaimFinding[]> = {
    overclaim: filtered.filter((f) => f.direction === 'overclaim'),
    underclaim: filtered.filter((f) => f.direction === 'underclaim'),
  }

  const likelyIntentional = filtered.filter((f) => f.likelyIntentional)
  const likelyMisclaim = filtered.filter((f) => !f.likelyIntentional)

  return {
    ts: new Date().toISOString(),
    filesScanned: files.length,
    totalFindings: filtered.length,
    byPattern,
    byDirection,
    likelyIntentional,
    likelyMisclaim,
  }
}

export function renderAuditReport(report: SubstrateAuditReport): string {
  const lines: string[] = []
  lines.push(`# Substrate-Honesty Audit — ${report.ts}`)
  lines.push('')
  lines.push(`Files scanned: ${report.filesScanned}`)
  lines.push(`Total findings: ${report.totalFindings}`)
  lines.push(`  Overclaim:   ${report.byDirection.overclaim.length}`)
  lines.push(`  Underclaim:  ${report.byDirection.underclaim.length}`)
  lines.push(`  Likely intentional (walls/quotes/wall-targets): ${report.likelyIntentional.length}`)
  lines.push(`  Likely misclaim (candidates):                   ${report.likelyMisclaim.length}`)
  lines.push('')

  lines.push('## Findings by pattern')
  lines.push('')
  for (const [pattern, findings] of Object.entries(report.byPattern)) {
    if (findings.length === 0) continue
    const misclaim = findings.filter((f) => !f.likelyIntentional).length
    lines.push(`- **${pattern}**: ${findings.length} total, ${misclaim} likely misclaim`)
  }
  lines.push('')

  if (report.likelyMisclaim.length > 0) {
    lines.push('## Top likely-misclaim candidates (by severity, top 20)')
    lines.push('')
    const sorted = [...report.likelyMisclaim].sort((a, b) => {
      const sevOrder = { high: 0, medium: 1, low: 2 }
      return sevOrder[a.severity] - sevOrder[b.severity]
    })
    for (const f of sorted.slice(0, 20)) {
      lines.push(`- [${f.severity}] **${f.pattern}** (${f.direction}) at ${f.file}:${f.line}`)
      lines.push(`    ${f.fragment}`)
      lines.push(`    *${f.why}*`)
    }
  }

  return lines.join('\n')
}
