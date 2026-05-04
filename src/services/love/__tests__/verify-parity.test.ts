// verify-parity.test.ts — assert verify.ts and verify.mjs check the same set.
//
// Background: verify.ts is the typed implementation tested in
// verify.test.ts; bin/verify.mjs is the runtime self-contained
// implementation that runs even when the bundle is broken. They are
// parallel implementations by design — auto-generating mjs from ts
// would couple the runtime check to a working build, defeating its
// purpose.
//
// The parity test catches source-of-truth drift (mode #3 in
// docs/operations/drift.md): if a check is added or removed in one
// file, the other should follow. Caught manually 2026-05-04 when the
// chain-runner.alive removal had to edit both; this test makes the
// invariant load-bearing.
//
// What we check: the set of check names extracted from `const name = '...'`
// declarations, restricted to those scoped under verify-check functions.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
const TS_PATH = join(REPO_ROOT, 'src', 'services', 'love', 'verify.ts')
const MJS_PATH = join(REPO_ROOT, 'bin', 'verify.mjs')

/**
 * Extract check names from a verify source file. Looks for
 * `const name = '<check-name>'` lines that are followed (within
 * the same function) by a call to one of the result helpers
 * (pass / fail / skip).
 *
 * Conservative regex; tolerates either single or double quotes.
 */
function extractCheckNames(source: string): Set<string> {
  const names = new Set<string>()
  const lines = source.split('\n')
  // Strategy: walk lines, when we hit `const name = '...'`, look
  // ahead a small window for at least one of pass/fail/skip(name, ...)
  // — that confirms it's a check-defining context.
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/const name\s*=\s*['"]([^'"]+)['"]/)
    if (!m) continue
    const candidate = m[1]
    const window = lines.slice(i + 1, i + 60).join('\n')
    if (/\b(?:pass|fail|skip)\s*\(\s*name\b/.test(window)) {
      names.add(candidate)
    }
  }
  return names
}

describe('verify.ts ↔ verify.mjs parity', () => {
  const tsSource = readFileSync(TS_PATH, 'utf-8')
  const mjsSource = readFileSync(MJS_PATH, 'utf-8')

  const tsChecks = extractCheckNames(tsSource)
  const mjsChecks = extractCheckNames(mjsSource)

  test('verify.ts exposes a non-empty set of check names', () => {
    expect(tsChecks.size).toBeGreaterThan(0)
  })

  test('verify.mjs exposes a non-empty set of check names', () => {
    expect(mjsChecks.size).toBeGreaterThan(0)
  })

  test('verify.ts and verify.mjs check the same set', () => {
    const onlyInTs = [...tsChecks].filter(n => !mjsChecks.has(n)).sort()
    const onlyInMjs = [...mjsChecks].filter(n => !tsChecks.has(n)).sort()

    if (onlyInTs.length > 0 || onlyInMjs.length > 0) {
      const detail = [
        onlyInTs.length > 0 ? `only in verify.ts: ${onlyInTs.join(', ')}` : null,
        onlyInMjs.length > 0 ? `only in verify.mjs: ${onlyInMjs.join(', ')}` : null,
      ].filter(Boolean).join(' | ')
      throw new Error(
        `verify.ts and verify.mjs check sets diverged. ${detail}. ` +
        `When adding/removing a check, edit both files (or update the parity ` +
        `test if the asymmetry is intentional).`,
      )
    }

    expect([...tsChecks].sort()).toEqual([...mjsChecks].sort())
  })
})
