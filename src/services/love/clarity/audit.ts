// clarity/audit.ts — orchestrate the detectors across a tree.
//
// Per docs/love/CLARITY-FIRST.md: SCAN → RANK → (REDUCE) → RECORD. This file
// is SCAN + RANK + the report. REDUCE (auto-fix / judgment / surface) reads
// the routed buckets this produces. Pure read + analysis — no mutation here.
//
// v0 runs the deterministic signals (dead-path, orphan, stray, fancy-word,
// hedge, nit). The git/tool-backed signals (source-coupling, calendar,
// dead-ts-export via knip, circular-dep via madge) are declared deferred in
// the report — surfaced, never silently dropped.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import {
  DEFAULT_EXCLUDE,
  DEFAULT_INCLUDE,
  DEFAULT_TOP_N,
  EFFORT_WEIGHT,
  SEVERITY_WEIGHT,
  isFixNever,
} from './clarity.config.js'
import {
  detectDeadReferences,
  detectOrphans,
  detectStrayArtifacts,
  runPerFileDetectors,
} from './detectors.js'
import { buildReferenceGraph, buildResolver } from './reference-graph.js'
import type {
  ClarityAuditOptions,
  ClarityAuditReport,
  ClarityFinding,
  ClaritySignal,
} from './types.js'

/** Signals v0 actually runs; the rest are reported as deferred. */
const ACTIVE_SIGNALS: ClaritySignal[] = [
  'dead-backtick-path', 'dead-md-link', 'orphan-doc', 'stray-artifact',
  'fancy-word', 'forbidden-hedge', 'markdown-nit',
]
const DEFERRED_SIGNALS: ClaritySignal[] = [
  'source-coupling-stale', 'calendar-stale', 'weak-scent', 'dead-ts-export', 'circular-dep',
]

const EMPTY_BY_SIGNAL = (): Record<ClaritySignal, ClarityFinding[]> => ({
  'dead-backtick-path': [], 'dead-md-link': [], 'orphan-doc': [], 'stray-artifact': [],
  'source-coupling-stale': [], 'calendar-stale': [], 'weak-scent': [], 'fancy-word': [],
  'forbidden-hedge': [], 'markdown-nit': [], 'dead-ts-export': [], 'circular-dep': [],
})

function shouldIncludeContent(path: string, opts: ClarityAuditOptions): boolean {
  const include = opts.include ?? DEFAULT_INCLUDE
  const exclude = opts.exclude ?? DEFAULT_EXCLUDE
  if (exclude.some((ex) => path.includes(ex))) return false
  return include.some((inc) => path.endsWith(inc))
}

function isExcludedDir(path: string, opts: ClarityAuditOptions): boolean {
  const exclude = opts.exclude ?? DEFAULT_EXCLUDE
  return exclude.some((ex) => path.includes(ex))
}

/** Walk the tree once: return every file's absolute path. */
function walk(root: string, opts: ClarityAuditOptions, out: string[] = []): string[] {
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
      if (!isExcludedDir(full + '/', opts)) walk(full, opts, out)
    } else {
      out.push(full)
    }
  }
  return out
}

/**
 * Run a clarity audit over a directory tree.
 * Keys in the file map are REPO-RELATIVE (for graph + fix-NEVER matching).
 */
export function runClarityAudit(opts: ClarityAuditOptions): ClarityAuditReport {
  const root = opts.root
  const allAbs = walk(root, opts)
  const allRel = allAbs.map((p) => relative(root, p))

  // Content map (included extensions only), repo-relative keys.
  const files = new Map<string, string>()
  for (const abs of allAbs) {
    if (!shouldIncludeContent(abs, opts)) continue
    try {
      files.set(relative(root, abs), readFileSync(abs, 'utf-8'))
    } catch {
      /* unreadable — skip; a real failure surfaces as a missing node, not a crash */
    }
  }

  const resolver = buildResolver(allRel)
  const graph = buildReferenceGraph(files, resolver)

  // Gather findings.
  const findings: ClarityFinding[] = []
  for (const [rel, content] of files) findings.push(...runPerFileDetectors(rel, content))
  findings.push(...detectDeadReferences(files, resolver))
  findings.push(...detectOrphans(graph))
  findings.push(...detectStrayArtifacts(allRel))

  // Filter to requested signals, if any.
  const wanted = opts.signals
  const filtered = wanted ? findings.filter((f) => wanted.includes(f.signal)) : findings

  // Rank + apply the fix-NEVER wall (forces route → 'surface').
  for (const f of filtered) {
    if (isFixNever(f.file)) f.route = 'surface'
    f.importance = graph.get(f.file)?.importance ?? 0
    f.priority = (f.importance * SEVERITY_WEIGHT[f.severity]) / EFFORT_WEIGHT[f.route]
  }
  const ranked = [...filtered].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))

  // Group + bucket.
  const bySignal = EMPTY_BY_SIGNAL()
  for (const f of filtered) bySignal[f.signal].push(f)

  return {
    ts: new Date().toISOString(),
    filesScanned: files.size,
    totalFindings: filtered.length,
    bySignal,
    topFindings: ranked.slice(0, opts.topN ?? DEFAULT_TOP_N),
    autoFixable: filtered.filter((f) => f.route === 'auto'),
    judgment: filtered.filter((f) => f.route === 'judgment'),
    surfaceOnly: filtered.filter((f) => f.route === 'surface'),
  }
}

/** Render a clarity audit as a plain, scannable report. */
export function renderClarityReport(report: ClarityAuditReport): string {
  const out: string[] = []
  out.push(`# Clarity audit — ${report.ts}`)
  out.push('')
  out.push(`Files scanned: ${report.filesScanned}`)
  out.push(`Total findings: ${report.totalFindings}`)
  out.push(`  auto-fixable: ${report.autoFixable.length} · judgment: ${report.judgment.length} · surface-only: ${report.surfaceOnly.length}`)
  out.push('')

  out.push('## By signal')
  out.push('')
  for (const sig of ACTIVE_SIGNALS) {
    const n = report.bySignal[sig].length
    out.push(`- ${sig}: ${n}`)
  }
  out.push('')
  out.push(`_Deferred (not run in v0): ${DEFERRED_SIGNALS.join(', ')}._`)
  out.push('')

  out.push(`## Top ${report.topFindings.length} by priority (impact × ease)`)
  out.push('')
  for (const f of report.topFindings) {
    const imp = (f.importance ?? 0).toFixed(2)
    out.push(`- [${f.severity}/${f.route}] **${f.signal}** — ${f.file}${f.line ? `:${f.line}` : ''} (importance ${imp})`)
    out.push(`    ${f.fragment}`)
    out.push(`    *${f.why}*`)
  }
  return out.join('\n')
}
