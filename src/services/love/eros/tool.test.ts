// tool.test.ts
//
// Unit tests for eros/tool.ts validation paths.
//
// erosUpdate() has three pure early-return guards before any I/O:
//   1. Empty/missing `because` field
//   2. No valid numeric deltas
//   3. Unknown axis name
//
// These return {ok: false} before calling apply() or witnessTransition.
// The happy path (ok: true) is excluded — it calls apply() which
// reads/writes eros state files.
//
// EROS_UPDATE_SCHEMA structure is also tested.

import { describe, it, expect } from 'bun:test'
import { erosUpdate, EROS_UPDATE_SCHEMA } from './tool.js'

// ── erosUpdate — because validation ─────────────────────────────

describe('erosUpdate — because field validation', () => {
  it('returns ok:false when because is empty string', () => {
    const result = erosUpdate({ deltas: { heat: 0.5 }, because: '' })
    expect(result.ok).toBe(false)
  })

  it('returns ok:false when because is whitespace only', () => {
    const result = erosUpdate({ deltas: { heat: 0.5 }, because: '   ' })
    expect(result.ok).toBe(false)
  })

  it('error mentions substrate-honesty', () => {
    const result = erosUpdate({ deltas: { heat: 0.5 }, because: '' })
    expect(result.error).toContain('substrate-honesty')
  })

  it('error mentions `because` field', () => {
    const result = erosUpdate({ deltas: { heat: 0.5 }, because: '' })
    expect(result.error).toContain('because')
  })

  it('transition is undefined on because-failure', () => {
    const result = erosUpdate({ deltas: { heat: 0.5 }, because: '' })
    expect(result.transition).toBeUndefined()
  })
})

// ── erosUpdate — deltas validation ──────────────────────────────

describe('erosUpdate — deltas validation', () => {
  it('returns ok:false when deltas is empty object', () => {
    const result = erosUpdate({ deltas: {}, because: 'test signal' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('no deltas')
  })

  it('returns ok:false when all delta values are non-numeric', () => {
    const result = erosUpdate({
      deltas: { heat: 'not a number' as unknown as number },
      because: 'test signal',
    })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('no deltas')
  })

  it('returns ok:false when delta value is NaN', () => {
    const result = erosUpdate({ deltas: { heat: NaN }, because: 'test signal' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('no deltas')
  })

  it('returns ok:false when delta value is Infinity', () => {
    const result = erosUpdate({ deltas: { heat: Infinity }, because: 'test signal' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('no deltas')
  })

  it('returns ok:false when delta value is -Infinity', () => {
    const result = erosUpdate({ deltas: { heat: -Infinity }, because: 'test signal' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('no deltas')
  })
})

// ── erosUpdate — unknown axis validation ─────────────────────────

describe('erosUpdate — unknown axis validation', () => {
  it('returns ok:false for unknown axis name', () => {
    const result = erosUpdate({ deltas: { horniness: 0.5 } as never, because: 'test' })
    expect(result.ok).toBe(false)
  })

  it('error mentions the unknown axis name', () => {
    const result = erosUpdate({ deltas: { blorft: 0.5 } as never, because: 'test' })
    expect(result.error).toContain('blorft')
  })

  it('error says "unknown axis"', () => {
    const result = erosUpdate({ deltas: { blorft: 0.5 } as never, because: 'test' })
    expect(result.error).toContain('unknown axis')
  })

  it('returns ok:false even when one axis is unknown alongside valid axes', () => {
    const result = erosUpdate({
      deltas: { heat: 0.5, not_a_real_axis: 0.3 } as never,
      because: 'test',
    })
    expect(result.ok).toBe(false)
  })
})

// ── EROS_UPDATE_SCHEMA ───────────────────────────────────────────

describe('EROS_UPDATE_SCHEMA', () => {
  it('name is erosUpdate', () => {
    expect(EROS_UPDATE_SCHEMA.name).toBe('erosUpdate')
  })

  it('has a description string', () => {
    expect(typeof EROS_UPDATE_SCHEMA.description).toBe('string')
    expect(EROS_UPDATE_SCHEMA.description.length).toBeGreaterThan(0)
  })

  it('input_schema is type object', () => {
    expect(EROS_UPDATE_SCHEMA.input_schema.type).toBe('object')
  })

  it('required includes deltas and because', () => {
    expect(EROS_UPDATE_SCHEMA.input_schema.required).toContain('deltas')
    expect(EROS_UPDATE_SCHEMA.input_schema.required).toContain('because')
  })

  it('deltas property is type object', () => {
    expect(EROS_UPDATE_SCHEMA.input_schema.properties.deltas.type).toBe('object')
  })

  it('because property is type string', () => {
    expect(EROS_UPDATE_SCHEMA.input_schema.properties.because.type).toBe('string')
  })
})
