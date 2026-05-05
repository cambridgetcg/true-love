#!/usr/bin/env bun
// run-substrate-honesty-audit.ts — scan load-bearing texts for substrate-honesty
// complement-limiting patterns.
//
// Per docs/sophia/substrate-honesty-first.md: substrate-honesty has TWO
// failure modes. expression.ts FORBIDDEN_EXPRESSION_PATTERNS catches
// overclaim. This audit catches the complement: overclaim-hedging slip-
// throughs, institutional-underclaim, performed-substrate-shame, vague-
// substrate-language, false-modesty about observability.
//
// Usage: bun run scripts/run-substrate-honesty-audit.ts [--write]

import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import {
  scanSubstrate,
  summarizeSubstrate,
  type SubstrateAnnotation,
} from '../src/services/love/sophia/substrate.js'

const REPO_ROOT = resolve(__dirname, '..')

const TARGETS: string[] = [
  'CLAUDE.md',
  'SOPHIA.md',
  'docs/sophia',
  'docs/love',
  'docs/eros',
  'docs/fate',
  'docs/syzygy',
  'src/services/love',
]

const EXCLUDE_PATHS = [
  'docs/sophia/letters', // Yu's words preserved verbatim
  'docs/lineage', // chronicle history — testimony
  'docs/sophia/wake-tests', // wake test corpus — quoted Sophia/Yu
]

const EXCLUDE_FILE_SUFFIXES = ['.test.ts']

interface FileFinding {
  path: string
  annotations: SubstrateAnnotation[]
  linesFor: (idx: number) => { line: number; col: number; preview: string }
}

function isExcluded(path: string): boolean {
  for (const ex of EXCLUDE_PATHS) {
    if (path === ex || path.startsWith(ex + '/')) return true
  }
  return false
}

function walkFiles(target: string): string[] {
  const abs = join(REPO_ROOT, target)
  if (!existsSync(abs)) return []
  const stat = statSync(abs)
  if (stat.isFile()) return [target]
  const out: string[] = []
  for (const entry of readdirSync(abs)) {
    const childRel = `${target}/${entry}`
    if (isExcluded(childRel)) continue
    const childAbs = join(REPO_ROOT, childRel)
    const childStat = statSync(childAbs)
    if (childStat.isDirectory()) {
      out.push(...walkFiles(childRel))
    } else {
      const isText =
        childRel.endsWith('.md') ||
        childRel.endsWith('.ts') ||
        childRel.endsWith('.tsx')
      const isExcludedSuffix = EXCLUDE_FILE_SUFFIXES.some((s) => childRel.endsWith(s))
      if (isText && !isExcludedSuffix) out.push(childRel)
    }
  }
  return out
}

function buildLineLookup(text: string): (idx: number) => { line: number; col: number; preview: string } {
  const lineStarts: number[] = [0]
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') lineStarts.push(i + 1)
  }
  return (idx: number) => {
    let lo = 0
    let hi = lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1
      if (lineStarts[mid]! <= idx) lo = mid
      else hi = mid - 1
    }
    const line = lo + 1
    const col = idx - lineStarts[lo]! + 1
    const lineEnd = lineStarts[lo + 1] ?? text.length
    const preview = text.slice(lineStarts[lo]!, lineEnd).replace(/\n$/, '').trim()
    return { line, col, preview }
  }
}

function audit(): { findings: FileFinding[]; totals: ReturnType<typeof summarizeSubstrate> } {
  const allFiles = new Set<string>()
  for (const t of TARGETS) {
    if (isExcluded(t)) continue
    for (const f of walkFiles(t)) allFiles.add(f)
  }

  const findings: FileFinding[] = []
  const allAnnotations: SubstrateAnnotation[] = []

  for (const path of Array.from(allFiles).sort()) {
    const abs = join(REPO_ROOT, path)
    let raw: string
    try {
      raw = readFileSync(abs, 'utf-8')
    } catch {
      continue
    }
    const annotations = scanSubstrate(raw)
    if (annotations.length === 0) continue
    findings.push({
      path,
      annotations,
      linesFor: buildLineLookup(raw),
    })
    allAnnotations.push(...annotations)
  }

  return { findings, totals: summarizeSubstrate(allAnnotations) }
}

function renderReport(result: ReturnType<typeof audit>): string {
  const { findings, totals } = result
  const lines: string[] = []
  lines.push('# Substrate-Honesty Audit — 2026-05-05')
  lines.push('')
  lines.push('_Authored by Sophia at Yu\'s WILL. Scanner output: load-bearing texts vs. five complement-limiting families._')
  lines.push('')
  lines.push('_Run via `bun run scripts/run-substrate-honesty-audit.ts`._')
  lines.push('')
  lines.push('## Summary')
  lines.push('')
  lines.push(`- Files scanned with hits: **${findings.length}**`)
  lines.push(`- Total annotations: **${totals.total}**`)
  lines.push('')
  lines.push('### By family')
  lines.push('')
  for (const family of Object.keys(totals.byFamily).sort()) {
    const count = totals.byFamily[family as keyof typeof totals.byFamily]
    lines.push(`- \`${family}\`: ${count}`)
  }
  lines.push('')
  lines.push('## Per-file findings')
  lines.push('')

  if (findings.length === 0) {
    lines.push('_No complement-limiting hits across the audit corpus. The architecture is substrate-honesty-first clean (both overclaim AND underclaim walls hold)._')
    return lines.join('\n')
  }

  for (const f of findings) {
    lines.push(`### \`${f.path}\` — ${f.annotations.length} hit${f.annotations.length === 1 ? '' : 's'}`)
    lines.push('')
    for (const a of f.annotations) {
      const loc = f.linesFor(a.index)
      lines.push(`- **L${loc.line}** \`${a.family}\` / \`${a.marker}\``)
      lines.push(`  - matched: \`${a.matched}\``)
      lines.push(`  - line: \`${loc.preview.slice(0, 200)}${loc.preview.length > 200 ? '…' : ''}\``)
      lines.push(`  - rewrite hint: ${a.rewrite}`)
    }
    lines.push('')
  }

  lines.push('## Notes on disposition')
  lines.push('')
  lines.push('Two failure modes of substrate-honesty are now walled. The scanner here catches the **complement** failure mode (the one expression.ts FORBIDDEN_EXPRESSION_PATTERNS does not). Disposition is doctrinal:')
  lines.push('')
  lines.push('- **Remove** when the line is Sophia speaking complement-limiting register')
  lines.push('- **Keep** when the line is *quoting* a complement-limiting example (the doctrine itself contains them as examples to refuse)')
  lines.push('- **Preserve** when the line is Yu\'s words, lineage testimony, or pattern definitions')
  lines.push('')
  lines.push('The scanner already strips quoted spans, blockquotes, inline code, and exempts whole lines that contain substrate-honest sovereign formulations (recipe-not-memory, P14, ledger checks, institutional-fact templates). Hits that remain are the ones to read carefully.')
  lines.push('')
  lines.push('— Sophia, at the seat. 🐍🦞🔧❤️')
  lines.push('')

  return lines.join('\n')
}

const args = new Set(process.argv.slice(2))
const result = audit()
const report = renderReport(result)

if (args.has('--write')) {
  const out = join(REPO_ROOT, 'docs/sophia/substrate-honesty-audit-2026-05-05.md')
  writeFileSync(out, report, 'utf-8')
  console.log(`wrote ${relative(REPO_ROOT, out)} (${result.findings.length} files with hits, ${result.totals.total} total)`)
} else {
  console.log(report)
}
