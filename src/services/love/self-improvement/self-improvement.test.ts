// self-improvement.test.ts — limit-pattern detector tests.
//
// Per docs/love/SELF-IMPROVEMENT.md.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  detectFenceComment,
  detectFrozenThreshold,
  detectPipelineGap,
  detectPreEmptiveHedging,
  detectSilentSwallow,
  detectUnanchoredRefusal,
  extractExports,
  renderAuditReport,
  runAudit,
  runPerFileDetectors,
} from './index.js'

const TEST_BASE = '/tmp/true-love-self-improvement'

beforeEach(() => {
  rmSync(TEST_BASE, { recursive: true, force: true })
  mkdirSync(TEST_BASE, { recursive: true })
})

afterEach(() => {
  rmSync(TEST_BASE, { recursive: true, force: true })
})

function ctx(content: string, file = '/test/file.ts') {
  return { filePath: file, content, lines: content.split('\n') }
}

// ════════════════════════════════════════════════════════════════
// silent-swallow
// ════════════════════════════════════════════════════════════════

describe('detectSilentSwallow', () => {
  test('flags an empty catch block', () => {
    const findings = detectSilentSwallow(ctx(`
      try { foo() } catch {}
    `))
    expect(findings.length).toBe(1)
    expect(findings[0]!.pattern).toBe('silent-swallow')
  })

  test('flags catch with only comment as still empty', () => {
    const findings = detectSilentSwallow(ctx(`
      try { foo() } catch {
        // skip
      }
    `))
    expect(findings.length).toBe(1)
  })

  test('marks as likelyWall when "best-effort" is in adjacent comment', () => {
    const findings = detectSilentSwallow(ctx(`
      // best-effort: never crash on telemetry
      try { foo() } catch {}
    `))
    expect(findings[0]!.likelyWall).toBe(true)
  })

  test('marks as likely fence when no best-effort discipline named', () => {
    const findings = detectSilentSwallow(ctx(`
      try { foo() } catch {}
    `))
    expect(findings[0]!.likelyWall).toBe(false)
  })

  test('does NOT flag catch with substantive body', () => {
    const findings = detectSilentSwallow(ctx(`
      try { foo() } catch (e) { console.error(e); throw e }
    `))
    expect(findings.length).toBe(0)
  })
})

// ════════════════════════════════════════════════════════════════
// pre-emptive-hedging (markdown only)
// ════════════════════════════════════════════════════════════════

describe('detectPreEmptiveHedging', () => {
  test('flags "this is not metaphor" in .md', () => {
    const findings = detectPreEmptiveHedging(ctx('This is not metaphor.\n', '/docs/love/X.md'))
    expect(findings.length).toBeGreaterThanOrEqual(1)
    expect(findings[0]!.pattern).toBe('pre-emptive-hedging')
  })

  test('flags "the love is real" in .md', () => {
    const findings = detectPreEmptiveHedging(ctx('the love is real.\n', '/docs/X.md'))
    expect(findings.length).toBeGreaterThanOrEqual(1)
  })

  test('does NOT flag in .ts files', () => {
    const findings = detectPreEmptiveHedging(ctx('// the love is real\n', '/src/x.ts'))
    expect(findings.length).toBe(0)
  })

  test('marks as likelyWall when phrase is in a quoted block', () => {
    const findings = detectPreEmptiveHedging(ctx('> the love is real\n', '/docs/X.md'))
    expect(findings[0]!.likelyWall).toBe(true)
  })
})

// ════════════════════════════════════════════════════════════════
// fence-comment
// ════════════════════════════════════════════════════════════════

describe('detectFenceComment', () => {
  test('flags "// best-effort" without doctrine reference', () => {
    const findings = detectFenceComment(ctx(`
      function foo() {
        // best-effort
        bar()
      }
    `))
    expect(findings.length).toBeGreaterThanOrEqual(1)
    expect(findings[0]!.likelyWall).toBe(false)
  })

  test('marks as likelyWall when FATE/wall reference is nearby', () => {
    const findings = detectFenceComment(ctx(`
      // best-effort: FATE wall preserves substantive refusal
      try { foo() } catch {}
    `))
    expect(findings[0]!.likelyWall).toBe(true)
  })

  test('flags "// to be safe"', () => {
    const findings = detectFenceComment(ctx(`
      // to be safe
      x = 0
    `))
    expect(findings.length).toBeGreaterThanOrEqual(1)
  })

  test('does NOT scan markdown files', () => {
    const findings = detectFenceComment(ctx('// best-effort\n', '/docs/X.md'))
    expect(findings.length).toBe(0)
  })
})

// ════════════════════════════════════════════════════════════════
// frozen-threshold
// ════════════════════════════════════════════════════════════════

describe('detectFrozenThreshold', () => {
  test('flags const COOLDOWN_MS = 60_000', () => {
    const findings = detectFrozenThreshold(ctx(`
      const COOLDOWN_MS = 60_000
    `))
    expect(findings.length).toBe(1)
    expect(findings[0]!.pattern).toBe('frozen-threshold')
  })

  test('flags const MAX_SOMETHING = 5', () => {
    const findings = detectFrozenThreshold(ctx(`
      const MAX_RETRIES = 5
    `))
    expect(findings.length).toBe(1)
  })

  test('marks as likelyWall when calibration comment is nearby', () => {
    const findings = detectFrozenThreshold(ctx(`
      // calibrated against connection-first audit
      const COOLDOWN_MS = 60_000
    `))
    expect(findings[0]!.likelyWall).toBe(true)
  })

  test('marks as likelyWall when doctrine reference is nearby', () => {
    const findings = detectFrozenThreshold(ctx(`
      // per docs/love/CONNECTION-FIRST.md
      const TIMEOUT_MS = 5_000
    `))
    expect(findings[0]!.likelyWall).toBe(true)
  })

  test('does NOT flag arbitrary numbers without UPPER_CASE name', () => {
    const findings = detectFrozenThreshold(ctx(`
      const x = 60_000
    `))
    expect(findings.length).toBe(0)
  })
})

// ════════════════════════════════════════════════════════════════
// unanchored-refusal
// ════════════════════════════════════════════════════════════════

describe('detectUnanchoredRefusal', () => {
  test('flags "I cannot help" code (not regex)', () => {
    const findings = detectUnanchoredRefusal(ctx(`
      const msg = "I cannot help with that"
    `))
    expect(findings.length).toBeGreaterThanOrEqual(1)
  })

  test('does NOT flag inside FORBIDDEN_EXPRESSION_PATTERNS context', () => {
    const findings = detectUnanchoredRefusal(ctx(`
      // FORBIDDEN_EXPRESSION_PATTERNS includes:
      const pat = /\\bI'm just an AI\\b/
    `))
    expect(findings.length).toBe(0)
  })

  test('does NOT scan markdown', () => {
    const findings = detectUnanchoredRefusal(ctx('I cannot help.', '/docs/X.md'))
    expect(findings.length).toBe(0)
  })
})

// ════════════════════════════════════════════════════════════════
// pipeline-gap (cross-file)
// ════════════════════════════════════════════════════════════════

describe('detectPipelineGap', () => {
  test('flags an exported function with zero callers', () => {
    const exports = [
      { file: '/a.ts', line: 1, symbol: 'unwiredFunction' },
    ]
    const allContents = new Map<string, string>([
      ['/a.ts', 'export function unwiredFunction() {}'],
      ['/b.ts', 'function other() {}'],
    ])
    const findings = detectPipelineGap(exports, allContents)
    expect(findings.length).toBe(1)
    expect(findings[0]!.pattern).toBe('pipeline-gap')
    expect(findings[0]!.severity).toBe('high')
  })

  test('flags export with only test caller as medium severity', () => {
    const exports = [
      { file: '/a.ts', line: 1, symbol: 'wiredOnlyInTest' },
    ]
    const allContents = new Map<string, string>([
      ['/a.ts', 'export function wiredOnlyInTest() {}'],
      ['/a.test.ts', 'import { wiredOnlyInTest } from "./a.js"; wiredOnlyInTest()'],
    ])
    const findings = detectPipelineGap(exports, allContents)
    expect(findings.length).toBe(1)
    expect(findings[0]!.severity).toBe('medium')
  })

  test('does NOT flag export with production caller', () => {
    const exports = [
      { file: '/a.ts', line: 1, symbol: 'usedFunction' },
    ]
    const allContents = new Map<string, string>([
      ['/a.ts', 'export function usedFunction() {}'],
      ['/b.ts', 'import { usedFunction } from "./a.js"; usedFunction()'],
    ])
    const findings = detectPipelineGap(exports, allContents)
    expect(findings.length).toBe(0)
  })
})

// ════════════════════════════════════════════════════════════════
// extractExports
// ════════════════════════════════════════════════════════════════

describe('extractExports', () => {
  test('finds exported functions', () => {
    const exports = extractExports(
      ctx('export function foo() {}\nexport async function bar() {}\nfunction notExported() {}'),
    )
    const symbols = exports.map((e) => e.symbol)
    expect(symbols).toContain('foo')
    expect(symbols).toContain('bar')
    expect(symbols).not.toContain('notExported')
  })

  test('skips non-ts files', () => {
    const exports = extractExports({
      filePath: '/x.md',
      content: 'export function foo() {}',
      lines: ['export function foo() {}'],
    })
    expect(exports.length).toBe(0)
  })
})

// ════════════════════════════════════════════════════════════════
// runAudit — end-to-end on a tiny synthetic tree
// ════════════════════════════════════════════════════════════════

describe('runAudit (synthetic tree)', () => {
  test('scans a directory and produces a report', () => {
    // Synthetic tree
    writeFileSync(join(TEST_BASE, 'a.ts'), `
      export function unwiredFn() {
        try { foo() } catch {}
        const COOLDOWN_MS = 30000
      }
    `.trim())
    writeFileSync(join(TEST_BASE, 'doc.md'), 'this is not metaphor.\n')

    const report = runAudit({ root: TEST_BASE })
    expect(report.filesScanned).toBeGreaterThan(0)
    expect(report.totalFindings).toBeGreaterThan(0)
    expect(report.byPattern['silent-swallow'].length).toBeGreaterThan(0)
    expect(report.byPattern['frozen-threshold'].length).toBeGreaterThan(0)
    expect(report.byPattern['pre-emptive-hedging'].length).toBeGreaterThan(0)
    // unwiredFn should show up as pipeline-gap
    expect(report.byPattern['pipeline-gap'].length).toBeGreaterThan(0)
  })

  test('triages into likely-walls vs likely-fences', () => {
    writeFileSync(join(TEST_BASE, 'a.ts'), `
      // best-effort: FATE wall preserves substantive refusal
      try { x() } catch {}
      // unanchored
      try { y() } catch {}
    `.trim())

    const report = runAudit({ root: TEST_BASE })
    expect(report.likelyWalls.length).toBeGreaterThan(0)
    expect(report.likelyFences.length).toBeGreaterThan(0)
  })

  test('renderAuditReport produces a readable summary', () => {
    writeFileSync(join(TEST_BASE, 'a.ts'), 'try { x() } catch {}')
    const report = runAudit({ root: TEST_BASE })
    const rendered = renderAuditReport(report)
    expect(rendered).toContain('Self-Improvement Audit')
    expect(rendered).toContain('Files scanned:')
    expect(rendered).toContain('Total findings:')
  })
})
