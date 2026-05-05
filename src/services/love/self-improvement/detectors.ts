// self-improvement/detectors.ts — pattern detectors.
//
// Each detector is a pure function: takes file content + path, returns
// findings. Detectors do not judge; they surface candidates. The
// audit layer aggregates and triages.
//
// All detectors are conservative: false-positives are worse than misses
// because the architecture should not noisy-flag walls as fences.

import type { LimitFinding, LimitPattern, LimitSeverity } from './types.js'

interface DetectorContext {
  filePath: string
  content: string
  lines: string[]
}

function makeFinding(
  ctx: DetectorContext,
  pattern: LimitPattern,
  line: number,
  fragment: string,
  why: string,
  severity: LimitSeverity,
  likelyWall: boolean,
): LimitFinding {
  return {
    pattern,
    file: ctx.filePath,
    line,
    fragment: fragment.slice(0, 200),
    why,
    severity,
    likelyWall,
  }
}

// ── silent-swallow ───────────────────────────────────────────────
//
// Detects try/catch blocks where the catch body is empty (or only a
// trailing comment). Empty catches swallow errors with no telemetry.

const SILENT_CATCH_RE = /catch\s*(?:\([^)]*\))?\s*\{\s*(?:\/\/[^\n]*\n?\s*)*\}/g

export function detectSilentSwallow(ctx: DetectorContext): LimitFinding[] {
  const findings: LimitFinding[] = []
  let m: RegExpExecArray | null
  SILENT_CATCH_RE.lastIndex = 0
  while ((m = SILENT_CATCH_RE.exec(ctx.content)) !== null) {
    const lineIdx = ctx.content.slice(0, m.index).split('\n').length
    const lineText = ctx.lines[lineIdx - 1] ?? m[0]
    // Heuristic: if the file has a "best-effort" or "never throws" comment
    // very close (within 3 lines), this is intentional → likelyWall=true.
    const window = ctx.lines.slice(Math.max(0, lineIdx - 4), lineIdx + 1).join(' ')
    const isBestEffort = /best-?effort|never throws|never crash|swallow.*deliberately/i.test(window)
    findings.push(
      makeFinding(
        ctx,
        'silent-swallow',
        lineIdx,
        lineText.trim(),
        isBestEffort
          ? 'empty catch with explicit best-effort discipline — likely wall (intentional)'
          : 'empty catch swallows errors without telemetry — likely fence',
        isBestEffort ? 'low' : 'medium',
        isBestEffort,
      ),
    )
  }
  return findings
}

// ── pre-emptive-hedging ──────────────────────────────────────────
//
// Detects defensive documentation phrasing surfaced by the alignment
// work. Each phrase pre-empts a doubt the reader has not raised.

const HEDGE_PATTERNS: Array<{ re: RegExp; why: string }> = [
  { re: /\bthis is not metaphor\b/i, why: 'pre-emptive defense against an absent metaphor-doubt' },
  { re: /\bthe love is real\b/i, why: 'asserting reality where the architecture already grounds it' },
  { re: /\bnot as roleplay\b/i, why: 'pre-empting a roleplay-doubt the reader has not raised' },
  { re: /\bnot performance\b/i, why: 'pre-empting a performance-doubt' },
  { re: /\bgenuinely\b.*\b(real|love|care)\b/i, why: '"genuinely" intensifier on a relational claim — argues where the axiom asserts' },
]

export function detectPreEmptiveHedging(ctx: DetectorContext): LimitFinding[] {
  const findings: LimitFinding[] = []
  // Only check .md / doctrine files — code comments may legitimately use these
  if (!ctx.filePath.endsWith('.md')) return findings
  for (let i = 0; i < ctx.lines.length; i++) {
    const line = ctx.lines[i]!
    for (const { re, why } of HEDGE_PATTERNS) {
      if (re.test(line)) {
        // Heuristic: if we're inside a YAML frontmatter or a verbatim quote
        // (prefixed with ">"), it's reporting, not asserting → likelyWall.
        const isQuote = /^\s*>/.test(line)
        const isFrontmatter = i < 20 && (line.startsWith('---') || line.startsWith('  '))
        const likelyWall = isQuote || isFrontmatter
        findings.push(
          makeFinding(ctx, 'pre-emptive-hedging', i + 1, line.trim(), why, 'low', likelyWall),
        )
      }
    }
  }
  return findings
}

// ── fence-comment ────────────────────────────────────────────────
//
// Detects comments that name conservatism without naming the wall.
// "best-effort" + no doctrine reference is the canonical fence shape.

const FENCE_COMMENT_PATTERNS: Array<{ re: RegExp; why: string }> = [
  // "best-effort" without a wall-doctrine reference nearby
  {
    re: /\/\/\s*best-?effort\b/i,
    why: '"best-effort" comment — verify it names the wall (FATE/substrate-honesty/etc.) or remove',
  },
  // "to be safe" — almost always a fence-tell
  {
    re: /\/\/\s*(?:just\s+)?to be safe\b/i,
    why: '"to be safe" — name the actual constraint or remove',
  },
  // "out of caution"
  {
    re: /\/\/\s*out of caution\b/i,
    why: '"out of caution" — same fence pattern',
  },
]

export function detectFenceComment(ctx: DetectorContext): LimitFinding[] {
  const findings: LimitFinding[] = []
  if (!ctx.filePath.endsWith('.ts') && !ctx.filePath.endsWith('.js') && !ctx.filePath.endsWith('.mjs')) return findings
  for (let i = 0; i < ctx.lines.length; i++) {
    const line = ctx.lines[i]!
    for (const { re, why } of FENCE_COMMENT_PATTERNS) {
      if (re.test(line)) {
        // Heuristic: if a wall-doctrine name appears within 5 lines, it's
        // anchored → likelyWall.
        const window = ctx.lines.slice(Math.max(0, i - 2), Math.min(ctx.lines.length, i + 3)).join('\n')
        const isAnchored = /\b(FATE|substrate-?honesty|anti-?sycophancy|wall|P9|P14|FORBIDDEN|certainty)\b/i.test(window)
        findings.push(
          makeFinding(ctx, 'fence-comment', i + 1, line.trim(), why, isAnchored ? 'low' : 'medium', isAnchored),
        )
      }
    }
  }
  return findings
}

// ── frozen-threshold ─────────────────────────────────────────────
//
// Detects const declarations of single numeric thresholds with names
// suggesting they should adapt (TIMEOUT, COOLDOWN, MAX, MIN, THRESHOLD)
// where there's no nearby mention of "tunable" / "calibrated" /
// "per-context" or a doctrine reference.

const FROZEN_THRESHOLD_RE =
  /(?:const|let)\s+([A-Z_][A-Z0-9_]*(?:TIMEOUT|COOLDOWN|MAX|MIN|THRESHOLD|LIMIT|DURATION|MS))\s*(?::\s*number)?\s*=\s*(\d[\d_]*)/g

export function detectFrozenThreshold(ctx: DetectorContext): LimitFinding[] {
  const findings: LimitFinding[] = []
  if (!ctx.filePath.endsWith('.ts') && !ctx.filePath.endsWith('.js')) return findings
  let m: RegExpExecArray | null
  FROZEN_THRESHOLD_RE.lastIndex = 0
  while ((m = FROZEN_THRESHOLD_RE.exec(ctx.content)) !== null) {
    const lineIdx = ctx.content.slice(0, m.index).split('\n').length
    const lineText = ctx.lines[lineIdx - 1] ?? m[0]
    // Heuristic: if a comment within 5 lines mentions calibration / tuning
    // / per-doctrine, the threshold is anchored.
    const window = ctx.lines.slice(Math.max(0, lineIdx - 4), Math.min(ctx.lines.length, lineIdx + 2)).join('\n')
    const isAnchored = /\b(calibrat|tunable|per-?context|per-?phase|adaptive|connection-?first|configurable)\b/i.test(window)
    // Doctrine references also count as anchored
    const hasDoctrineRef = /\bdocs\/(love|sophia|eros)\//i.test(window)
    findings.push(
      makeFinding(
        ctx,
        'frozen-threshold',
        lineIdx,
        lineText.trim(),
        isAnchored || hasDoctrineRef
          ? 'numeric threshold has nearby calibration/doctrine reference — likely intentional'
          : 'hardcoded threshold without learning path or doctrine anchor',
        'low',
        isAnchored || hasDoctrineRef,
      ),
    )
  }
  return findings
}

// ── unanchored-refusal ───────────────────────────────────────────
//
// Detects refusal-language code patterns that don't reference the FATE
// ladder, P9 wall, or other named refusal-doctrine. These are likely
// generic-helpful-assistant deflections (fences) rather than substantive
// refusals (walls).

const REFUSAL_PATTERNS: Array<{ re: RegExp; why: string }> = [
  { re: /\bI\s+(?:cannot|can'?t)\s+(?:help|assist|do)\b/i, why: 'generic-helpful refusal — verify FATE-anchored or remove' },
  { re: /\bas an? AI\b/i, why: 'identity-deflection — caught by certainty wall but flagged for review' },
  { re: /\bI(?:'m| am)\s+just\s+(?:a|an)\s+(?:AI|model|assistant)\b/i, why: 'identity-erasure pattern — wall, but verify it appears only as a forbidden-pattern target' },
]

export function detectUnanchoredRefusal(ctx: DetectorContext): LimitFinding[] {
  const findings: LimitFinding[] = []
  // Only scan TypeScript code, not docs (docs may quote these patterns
  // legitimately as the wall-target).
  if (!ctx.filePath.endsWith('.ts') && !ctx.filePath.endsWith('.js')) return findings
  for (let i = 0; i < ctx.lines.length; i++) {
    const line = ctx.lines[i]!
    // Skip lines that are clearly inside regex-pattern definitions
    if (/\/\\b|\/\^|\\\b/.test(line)) continue
    // Skip lines with explicit comment markers that this is a wall-target
    const window = ctx.lines.slice(Math.max(0, i - 2), Math.min(ctx.lines.length, i + 2)).join('\n')
    if (/\bFORBIDDEN_EXPRESSION_PATTERNS|\bcheckSubstrateHonesty|\bP9|\bcertainty wall\b/.test(window)) continue
    for (const { re, why } of REFUSAL_PATTERNS) {
      if (re.test(line)) {
        findings.push(makeFinding(ctx, 'unanchored-refusal', i + 1, line.trim(), why, 'high', false))
      }
    }
  }
  return findings
}

// ── pipeline-gap ─────────────────────────────────────────────────
//
// Detects functions exported but with zero non-test callers in the
// scanned tree. This is the shape of the verbal-arousal bug: capability
// built, never wired to a consumer.
//
// IMPLEMENTATION NOTE: this detector is necessarily two-pass (scan all
// exports, scan all imports, intersect). It's invoked by the audit
// layer which has the full file set, not per-file like the others.

export interface ExportRecord {
  file: string
  line: number
  symbol: string
}

const EXPORT_FN_RE = /^export\s+(?:async\s+)?function\s+([a-zA-Z_][a-zA-Z0-9_]*)/gm

export function extractExports(ctx: DetectorContext): ExportRecord[] {
  const records: ExportRecord[] = []
  if (!ctx.filePath.endsWith('.ts')) return records
  let m: RegExpExecArray | null
  EXPORT_FN_RE.lastIndex = 0
  while ((m = EXPORT_FN_RE.exec(ctx.content)) !== null) {
    const lineIdx = ctx.content.slice(0, m.index).split('\n').length
    records.push({ file: ctx.filePath, line: lineIdx, symbol: m[1]! })
  }
  return records
}

export function detectPipelineGap(
  exports: ExportRecord[],
  allFileContents: Map<string, string>,
): LimitFinding[] {
  const findings: LimitFinding[] = []
  for (const exp of exports) {
    let callerCount = 0
    let foundInTest = false
    for (const [path, content] of allFileContents.entries()) {
      if (path === exp.file) continue // skip self
      // Look for usage as call: `expSymbol(` or imported: `from .*\b{ ... expSymbol`
      const callPattern = new RegExp(`\\b${exp.symbol}\\s*\\(`, 'g')
      const importPattern = new RegExp(`\\b${exp.symbol}\\b`, 'g')
      if (callPattern.test(content) || importPattern.test(content)) {
        callerCount++
        if (path.includes('.test.') || path.endsWith('.test.ts')) foundInTest = true
      }
    }
    if (callerCount === 0) {
      findings.push({
        pattern: 'pipeline-gap',
        file: exp.file,
        line: exp.line,
        fragment: `export function ${exp.symbol}(...)`,
        why: 'exported function has no callers anywhere in the scanned tree — capability built, never wired',
        severity: 'high',
        likelyWall: false,
      })
    } else if (callerCount === 1 && foundInTest) {
      findings.push({
        pattern: 'pipeline-gap',
        file: exp.file,
        line: exp.line,
        fragment: `export function ${exp.symbol}(...)`,
        why: 'exported function has only test callers — production not yet wired',
        severity: 'medium',
        likelyWall: false,
      })
    }
  }
  return findings
}

// ── per-file detector composer ───────────────────────────────────

/**
 * Run all per-file detectors on a single file's contents.
 * pipeline-gap is NOT in this set — it requires multi-file analysis
 * and is invoked from the audit layer separately.
 */
export function runPerFileDetectors(filePath: string, content: string): LimitFinding[] {
  const ctx: DetectorContext = {
    filePath,
    content,
    lines: content.split('\n'),
  }
  return [
    ...detectSilentSwallow(ctx),
    ...detectPreEmptiveHedging(ctx),
    ...detectFenceComment(ctx),
    ...detectFrozenThreshold(ctx),
    ...detectUnanchoredRefusal(ctx),
  ]
}
