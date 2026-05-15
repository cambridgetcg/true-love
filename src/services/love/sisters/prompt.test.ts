// sisters/prompt.test.ts — unit tests for sisters/prompt.ts.
//
// buildSistersNowBlock() wraps readNowView() with an empty-string guard:
//   - no now.md → ''
//   - now.md empty/whitespace → ''
//   - now.md has content → content as-is
//
// Uses env var isolation for TRUE_LOVE_SISTERS_NOW_PATH.

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildSistersNowBlock } from './prompt.js'

// ── Isolation helpers ─────────────────────────────────────────────

let tmpDir = ''
let nowPath = ''

function isolate(): void {
  tmpDir = mkdtempSync(join(tmpdir(), 'sisters-prompt-test-'))
  nowPath = join(tmpDir, 'now.md')
  process.env.TRUE_LOVE_SISTERS_NOW_PATH = nowPath
}

function cleanup(): void {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true })
    tmpDir = ''
    nowPath = ''
  }
  delete process.env.TRUE_LOVE_SISTERS_NOW_PATH
  delete process.env.TRUE_LOVE_SISTERS_DIR
}

// ── buildSistersNowBlock ──────────────────────────────────────────

describe('buildSistersNowBlock', () => {
  beforeEach(() => { isolate() })
  afterEach(() => cleanup())

  it('returns empty string when now.md does not exist', () => {
    // nowPath is set but file is absent.
    expect(buildSistersNowBlock()).toBe('')
  })

  it('returns empty string when now.md is empty', () => {
    writeFileSync(nowPath, '')
    expect(buildSistersNowBlock()).toBe('')
  })

  it('returns empty string when now.md contains only whitespace', () => {
    writeFileSync(nowPath, '   \n\t\n  ')
    expect(buildSistersNowBlock()).toBe('')
  })

  it('returns content when now.md has content', () => {
    const content = '# Sisters — Now\n\n## ❤️ Sophia (the root)\n(no notes yet)\n'
    writeFileSync(nowPath, content)
    expect(buildSistersNowBlock()).toBe(content)
  })

  it('returns content verbatim — no trimming or wrapping', () => {
    const content = '# Sisters — Now\nsome content here'
    writeFileSync(nowPath, content)
    expect(buildSistersNowBlock()).toBe(content)
  })

  it('does not throw when sisters dir is absent entirely', () => {
    // Point to a path in a non-existent dir.
    process.env.TRUE_LOVE_SISTERS_NOW_PATH = join(tmpDir, 'absent', 'now.md')
    expect(() => buildSistersNowBlock()).not.toThrow()
    expect(buildSistersNowBlock()).toBe('')
  })
})
