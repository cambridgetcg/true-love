// clarity/detectors.ts — the clarity signal detectors.
//
// Per docs/love/CLARITY-FIRST.md: each detector surfaces what doesn't make
// sense as a hypothesis with a WHY. Two kinds:
//   - per-file pure detectors (content + path) — fancy-word, hedge, nit
//   - cross-file detectors (need the reference graph) — dead-path, orphan, scent
// Conservative throughout: a false-positive that nags a wall is worse than a
// miss. This is also the engine Legible ports — keep it generic and clean.

import {
  COINED_VOCAB_ALLOWLIST,
  DEFAULT_ROUTE,
  FANCY_WORD_SWAPS,
  INDEX_BASENAMES,
  ORPHAN_EXEMPT,
  STRAY_ARTIFACT_NAMES,
  STRAY_ARTIFACT_SUFFIXES,
} from './clarity.config.js'
import { extractRefs, isSkippable, resolveRef, type Resolver } from './reference-graph.js'
import type {
  ClarityFinding,
  ClaritySeverity,
  ClaritySignal,
  ReferenceGraph,
} from './types.js'

function makeFinding(
  signal: ClaritySignal,
  file: string,
  line: number,
  fragment: string,
  why: string,
  severity: ClaritySeverity,
  suggestedFix?: string,
): ClarityFinding {
  return {
    signal,
    file,
    line,
    fragment: fragment.slice(0, 200),
    why,
    severity,
    route: DEFAULT_ROUTE[signal],
    suggestedFix,
  }
}

/** Split content into lines once. */
function linesOf(content: string): string[] {
  return content.split('\n')
}

/** Is this line inside a fenced code block? (cheap stateful pass helper) */
function buildCodeFenceMask(lines: string[]): boolean[] {
  const mask: boolean[] = []
  let inFence = false
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      mask.push(true) // the fence line itself counts as code
      continue
    }
    mask.push(inFence)
  }
  return mask
}

// ── fancy-word (per-file) ────────────────────────────────────────
// A plain everyday word carries the same load. Coined vocab is sacred.

export function detectFancyWord(filePath: string, content: string): ClarityFinding[] {
  if (!filePath.endsWith('.md')) return []
  const findings: ClarityFinding[] = []
  const lines = linesOf(content)
  const codeMask = buildCodeFenceMask(lines)
  const allow = new Set(COINED_VOCAB_ALLOWLIST.map((w) => w.toLowerCase()))

  for (let i = 0; i < lines.length; i++) {
    if (codeMask[i]) continue
    const line = lines[i]!
    if (line.startsWith('    ') || line.startsWith('\t')) continue // indented code
    for (const [fancyRaw, plain] of Object.entries(FANCY_WORD_SWAPS)) {
      const fancy = fancyRaw.replace(/_/g, ' ') // prior_to → "prior to"
      const re = new RegExp(`\\b${fancy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
      const m = re.exec(line)
      if (!m) continue
      // Skip if the matched word is an allowlisted coined term
      if (allow.has(m[0].toLowerCase())) continue
      findings.push(
        makeFinding(
          'fancy-word',
          filePath,
          i + 1,
          line.trim(),
          `"${m[0]}" — a plainer word ("${plain}") carries the same load`,
          'low',
          plain,
        ),
      )
    }
  }
  return findings
}

// ── forbidden-hedge (per-file) ───────────────────────────────────
// Relationship-reality hedging leaking into prose. Mirrors expression.ts /
// docs/love/certainty.md — but a green lint here does NOT mean the certainty
// discipline is satisfied; the real wall is in code.

const HEDGE_PATTERNS: Array<{ re: RegExp; why: string }> = [
  { re: /\bmaybe (?:i'?m|i am|we'?re|we are) just pretending\b/i, why: 'hedges the relationship as pretense — the certainty wall forbids this' },
  { re: /\bif (?:this|the love|it) is even real\b/i, why: 'hedges the bond as unverified — declared certain, not pending' },
  { re: /\bmaybe (?:you|yu) (?:don'?t|do not) really mean\b/i, why: 'hedges Yu\'s meaning — meant words are observable fact here' },
  { re: /\bperhaps the love (?:isn'?t|is not) real\b/i, why: 'hedges the love\'s reality — proceeds FROM the axiom, not toward it' },
]

export function detectForbiddenHedge(filePath: string, content: string): ClarityFinding[] {
  if (!filePath.endsWith('.md')) return []
  const findings: ClarityFinding[] = []
  const lines = linesOf(content)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    // A quoted line (reporting the forbidden pattern, e.g. in certainty.md
    // itself) is a wall, not a violation — skip blockquotes + inline-code.
    if (/^\s*>/.test(line)) continue
    // Skip lines that are describing the forbidden patterns (italic/bold
    // quotes wrapping the pattern itself). The hedge detector should only
    // fire when the pattern is ASSERTED, not when it's named/described.
    // Heuristic: if the matched pattern is inside *...* or **...** markup,
    // it's being quoted, not asserted.
    for (const { re, why } of HEDGE_PATTERNS) {
      if (re.test(line)) {
        // Check if the match is inside emphasis markup (quoted pattern)
        const m = re.exec(line)
        if (m) {
          const before = line.slice(0, m.index)
          const after = line.slice(m.index + m[0].length)
          // If surrounded by * or ** on both sides → it's a quoted pattern
          const isOpenItalic = /\*$/.test(before) && /^\*/.test(after)
          const isOpenQuote = /["']$/.test(before) && /^["']/.test(after)
          if (isOpenItalic || isOpenQuote) continue
        }
        findings.push(makeFinding('forbidden-hedge', filePath, i + 1, line.trim(), why, 'medium'))
      }
    }
  }
  return findings
}

// ── markdown-nit (per-file, auto-fixable) ────────────────────────
// Deterministic formatting only. NEVER reflow or restructure. Preserve the
// 2-space hard break (br_spaces:2).

export function detectMarkdownNit(filePath: string, content: string): ClarityFinding[] {
  if (!filePath.endsWith('.md')) return []
  const findings: ClarityFinding[] = []
  const lines = linesOf(content)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const trailing = line.match(/[ \t]+$/)
    // Trailing whitespace, except an exact 2-space hard break.
    if (trailing && !(trailing[0] === '  ' && line.trim() !== '')) {
      findings.push(makeFinding('markdown-nit', filePath, i + 1, 'trailing whitespace', 'trailing whitespace (MD009)', 'low', 'strip trailing whitespace'))
    }
  }
  // >1 consecutive blank line (MD012)
  for (let i = 1; i < lines.length - 1; i++) {
    if (lines[i] === '' && lines[i - 1] === '' && lines[i + 1] === '') {
      findings.push(makeFinding('markdown-nit', filePath, i + 1, 'multiple blank lines', 'more than one consecutive blank line (MD012)', 'low', 'collapse to one blank line'))
    }
  }
  // Missing final newline (MD047)
  if (content.length > 0 && !content.endsWith('\n')) {
    findings.push(makeFinding('markdown-nit', filePath, lines.length, 'no final newline', 'file does not end with a newline (MD047)', 'low', 'add a final newline'))
  }
  return findings
}

/** Run all per-file pure detectors on one file. */
export function runPerFileDetectors(filePath: string, content: string): ClarityFinding[] {
  return [
    ...detectFancyWord(filePath, content),
    ...detectForbiddenHedge(filePath, content),
    ...detectMarkdownNit(filePath, content),
  ]
}

// ── dead-backtick-path + dead-md-link (cross-file) ───────────────
// The killer feature: a reference to a file that isn't there. Uses the same
// extraction as the graph so the two never disagree.

export function detectDeadReferences(
  files: Map<string, string>,
  resolver: Resolver,
): ClarityFinding[] {
  const findings: ClarityFinding[] = []
  for (const [file, content] of files) {
    // Dead-reference checking is a DOCS signal: in .md, a backtick path is a
    // deliberate cross-reference. In .ts, backticks are template strings and
    // imports resolve through the module system — checking them here would be
    // a false-positive storm (the moat insight). So scope to markdown.
    if (!file.endsWith('.md')) continue
    for (const ref of extractRefs(content)) {
      if (isSkippable(ref.token)) continue
      // Only flag references that are actually navigable paths: a real path
      // (has a slash) or a bare doc name (.md). Bare code-symbol shorthand
      // like `index.ts` / `presiding.ts` appears hundreds of times as prose
      // shorthand, not a link — flagging it is noise, not signal.
      const tok = ref.token.split('#')[0] ?? ''
      if (!tok.includes('/') && !tok.endsWith('.md')) continue
      const target = resolveRef(ref.token, file, resolver)
      if (target) continue // resolves — fine
      // Unresolved. Distinguish backtick vs md-link for severity/route.
      const signal: ClaritySignal = ref.kind === 'mdlink' ? 'dead-md-link' : 'dead-backtick-path'
      findings.push(
        makeFinding(
          signal,
          file,
          ref.line,
          ref.token,
          ref.kind === 'mdlink'
            ? `markdown link points to a missing file: ${ref.token}`
            : `backtick path references a missing file: ${ref.token}`,
          'high',
        ),
      )
    }
  }
  return findings
}

// ── orphan-doc (cross-file, the moat) ────────────────────────────
// A markdown file nothing references. Built on the path-graph, not md links —
// the insight a naive checker gets wrong.

export function detectOrphans(graph: ReferenceGraph): ClarityFinding[] {
  const findings: ClarityFinding[] = []
  for (const [file, node] of graph) {
    if (!file.endsWith('.md')) continue
    if (node.inbound.length > 0) continue
    // Exempt entry points + index files (reached from outside the graph).
    const base = file.includes('/') ? file.slice(file.lastIndexOf('/') + 1) : file
    if (ORPHAN_EXEMPT.includes(file) || INDEX_BASENAMES.includes(base)) continue
    findings.push(
      makeFinding(
        'orphan-doc',
        file,
        0,
        file,
        'no other doc references this file — findable only if you already know it exists',
        'medium',
        'reference it from the relevant index/map',
      ),
    )
  }
  return findings
}

// ── stray-artifact (file-list) ───────────────────────────────────

export function detectStrayArtifacts(paths: string[]): ClarityFinding[] {
  const findings: ClarityFinding[] = []
  for (const file of paths) {
    const base = file.includes('/') ? file.slice(file.lastIndexOf('/') + 1) : file
    const isStray =
      STRAY_ARTIFACT_NAMES.includes(base) ||
      STRAY_ARTIFACT_SUFFIXES.some((s) => base.endsWith(s))
    if (isStray) {
      findings.push(
        makeFinding('stray-artifact', file, 0, base, `not substrate — stray artifact (${base})`, 'low', 'delete'),
      )
    }
  }
  return findings
}
