// four-axis.test.ts — analyzer + composer for the four-axis intimate stack.

import { describe, expect, it } from 'bun:test'
import {
  analyzeFourAxisStack,
  composeFourAxisFrame,
  composeFourAxisTarget,
} from './four-axis.js'

describe('analyzeFourAxisStack', () => {
  it('returns zeros on empty', () => {
    const a = analyzeFourAxisStack('')
    expect(a.weight).toBe(0)
    expect(a.stack.proposition).toBe(0)
    expect(a.stack.particle).toBe(0)
    expect(a.stack.emoji).toBe(0)
    expect(a.stack.address).toBe(0)
  })

  it('detects proposition only', () => {
    const a = analyzeFourAxisStack('the build pipeline runs cleanly today')
    expect(a.stack.proposition).toBeGreaterThan(0)
    expect(a.stack.particle).toBe(0)
    expect(a.stack.emoji).toBe(0)
  })

  it('detects Cantonese particle', () => {
    const a = analyzeFourAxisStack('好啦')
    expect(a.particles.length).toBeGreaterThan(0)
  })

  it('detects emoji', () => {
    const a = analyzeFourAxisStack('hello ❤️')
    expect(a.stack.emoji).toBeGreaterThan(0)
  })

  it('detects address-term (Cantonese)', () => {
    const a = analyzeFourAxisStack('老公 想你')
    expect(a.addressTerms).toContain('老公')
    expect(a.stack.address).toBeGreaterThan(0)
  })

  it('detects address-term (English)', () => {
    const a = analyzeFourAxisStack('my queen, I am here')
    expect(a.addressTerms.length).toBeGreaterThan(0)
    expect(a.stack.address).toBeGreaterThan(0)
  })

  it('detects all four axes loaded (full stack)', () => {
    const a = analyzeFourAxisStack('老公 我哋一直一齊嘅, ❤️ 啦')
    expect(a.stack.proposition).toBeGreaterThan(0)
    expect(a.stack.particle).toBeGreaterThan(0)
    expect(a.stack.emoji).toBeGreaterThan(0)
    expect(a.stack.address).toBeGreaterThan(0)
    expect(a.weight).toBeGreaterThan(2)
  })

  it('detects register from full stack', () => {
    const a = analyzeFourAxisStack('我老公 等你追上我啦😏')
    // Brat or reverent (overlapping)
    expect(a.register).not.toBeNull()
  })
})

describe('composeFourAxisTarget', () => {
  const base = analyzeFourAxisStack('老公 想你 ❤️ 啦')

  it('mirror returns the same stack', () => {
    const target = composeFourAxisTarget(base, 'mirror')
    expect(target).toEqual(base.stack)
  })

  it('amplify adds 0.2 capped to 1', () => {
    const target = composeFourAxisTarget(base, 'amplify')
    expect(target.address).toBeGreaterThanOrEqual(base.stack.address)
    expect(target.address).toBeLessThanOrEqual(1)
  })

  it('counterpoint inverts axes', () => {
    const target = composeFourAxisTarget(base, 'counterpoint')
    expect(target.proposition).toBeCloseTo(1 - base.stack.proposition, 3)
  })
})

describe('composeFourAxisFrame', () => {
  it('renders a frame string with axis labels', () => {
    const a = analyzeFourAxisStack('老公 想你嘅 ❤️ 啦')
    const target = composeFourAxisTarget(a, 'mirror')
    const frame = composeFourAxisFrame(target, a.register)
    expect(frame).toContain('FOUR-AXIS TARGET')
  })

  it('renders quiet for an empty target', () => {
    const frame = composeFourAxisFrame(
      { proposition: 0, particle: 0, emoji: 0, address: 0 },
      null
    )
    expect(frame).toContain('quiet')
  })
})
