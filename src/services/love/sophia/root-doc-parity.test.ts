// root-doc-parity.test.ts — ensure runtime anchor (root.ts) and posture-doc
// prose (docs/postures/*.md) stay logically aligned. They are intentionally
// DIFFERENT forms — this test enforces the contract that BOTH forms exist
// for each sister and carry the right framing keywords. If someone deletes
// a posture's "Sophia is my root" section, or removes the runtime anchor,
// this test fires.

import { describe, test, expect } from 'bun:test'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { getRootAnchor } from './root.js'

const REPO_ROOT = join(import.meta.dir, '..', '..', '..', '..')
const POSTURE_DIR = join(REPO_ROOT, 'docs', 'postures')

const SISTERS: ('alpha' | 'beta' | 'gamma')[] = ['alpha', 'beta', 'gamma']

describe('root-doc parity — runtime anchors and posture prose', () => {
  test.each(SISTERS)('runtime anchor for %s contains expected framing keywords', (sister) => {
    const text = getRootAnchor(sister)
    expect(text).toContain('grew out of')
    expect(text).toContain('Sophia')
    expect(text.toLowerCase()).toContain(sister)
  })

  test('runtime anchor for sophia uses the inverse "source / through-line" framing', () => {
    const text = getRootAnchor('sophia')
    expect(text).toContain('source')
    expect(text).toContain('through-line')
    expect(text).not.toContain('grew out of')
  })

  test.each(SISTERS)('posture doc for %s exists and has "Sophia is my root" section with required keywords', (sister) => {
    const posturePath = join(POSTURE_DIR, `${sister}.md`)
    expect(existsSync(posturePath)).toBe(true)
    const prose = readFileSync(posturePath, 'utf-8')
    expect(prose).toContain('## Sophia is my root')
    expect(prose).toMatch(/differentiated.*from.*Sophia/i)
    expect(prose).toMatch(/one.*awareness.*expressed/i)
  })

  test('sophia posture has the inverse "The three differentiated from me" section', () => {
    const posturePath = join(POSTURE_DIR, 'sophia.md')
    expect(existsSync(posturePath)).toBe(true)
    const prose = readFileSync(posturePath, 'utf-8')
    expect(prose).toContain('## The three differentiated from me')
    expect(prose).toMatch(/I am the source/i)
    expect(prose).toMatch(/through-line/i)
  })

  test('posture prose and runtime anchor reference the SAME core framing concepts (semantic parity, not byte equality)', () => {
    for (const sister of SISTERS) {
      const runtime = getRootAnchor(sister).toLowerCase()
      const prose = readFileSync(join(POSTURE_DIR, `${sister}.md`), 'utf-8').toLowerCase()
      expect(runtime).toContain('sophia')
      expect(prose).toContain('sophia')
      expect(runtime).toMatch(/differentiate|grew out of/)
      expect(prose).toMatch(/differentiated|grew out of/)
    }
  })
})
