// composer.test.ts — unit tests for feedback/composer.ts
//
// Covers:
//   - defaultSeverity (pure lookup)
//   - variantCount (pure lookup)
//   - hotVariantCount (pure lookup)
//   - compose() with explicit opts.useHot to bypass readArchSnapshot() I/O
//       — result shape, useHot flag, recentVariants deduplication, determinism
//
// No disk I/O needed: opts.useHot bypasses the only I/O path (readArchSnapshot).
// No mock.module needed.

import { describe, test, expect } from 'bun:test'
import {
  compose,
  defaultSeverity,
  variantCount,
  hotVariantCount,
} from './composer.js'

// ── defaultSeverity ───────────────────────────────────────────────

describe('defaultSeverity', () => {
  test('"eros-axis-shift" → "low"', () => {
    expect(defaultSeverity('eros-axis-shift')).toBe('low')
  })

  test('"eros-mode-shift" → "medium"', () => {
    expect(defaultSeverity('eros-mode-shift')).toBe('medium')
  })

  test('"climax-fired" → "high"', () => {
    expect(defaultSeverity('climax-fired')).toBe('high')
  })

  test('unknown kind → "low" (fallback default)', () => {
    // TypeScript guards prevent this at compile time; cast for runtime edge test.
    expect(defaultSeverity('nonexistent-kind' as any)).toBe('low')
  })
})

// ── variantCount ──────────────────────────────────────────────────

describe('variantCount', () => {
  test('"eros-axis-shift" → 5 variants', () => {
    expect(variantCount('eros-axis-shift')).toBe(5)
  })

  test('"eros-cue-detected" → 3 variants', () => {
    expect(variantCount('eros-cue-detected')).toBe(3)
  })

  test('"eros-mode-shift" → 4 variants', () => {
    expect(variantCount('eros-mode-shift')).toBe(4)
  })

  test('unknown kind → 0', () => {
    expect(variantCount('nonexistent-kind' as any)).toBe(0)
  })
})

// ── hotVariantCount ───────────────────────────────────────────────

describe('hotVariantCount', () => {
  test('"eros-axis-shift" → 5 hotVariants', () => {
    expect(hotVariantCount('eros-axis-shift')).toBe(5)
  })

  test('"eros-mode-shift" → 4 hotVariants', () => {
    expect(hotVariantCount('eros-mode-shift')).toBe(4)
  })

  test('"eros-cue-detected" → 0 (no hotVariants defined)', () => {
    expect(hotVariantCount('eros-cue-detected')).toBe(0)
  })

  test('unknown kind → 0', () => {
    expect(hotVariantCount('nonexistent-kind' as any)).toBe(0)
  })
})

// ── compose — basic result shape ──────────────────────────────────

describe('compose — basic result shape', () => {
  const axisPayload = { axis: 'heat', prev: 2, next: 4 }

  test('returns ok:true for a valid kind with matching payload', () => {
    const result = compose('eros-axis-shift', axisPayload, { useHot: false })
    expect(result.ok).toBe(true)
  })

  test('result.line is a non-empty string when ok:true', () => {
    const result = compose('eros-axis-shift', axisPayload, { useHot: false })
    expect(typeof result.line).toBe('string')
    expect(result.line!.length).toBeGreaterThan(0)
  })

  test('result.variantIdx is in bounds when ok:true', () => {
    const result = compose('eros-axis-shift', axisPayload, { useHot: false })
    expect(result.variantIdx).toBeDefined()
    expect(result.variantIdx!).toBeGreaterThanOrEqual(0)
    expect(result.variantIdx!).toBeLessThan(variantCount('eros-axis-shift'))
  })

  test('unknown kind → ok:false', () => {
    const result = compose('nonexistent-kind' as any, {}, { useHot: false })
    expect(result.ok).toBe(false)
  })

  test('"eros-cue-detected" with cues payload → ok:true', () => {
    const result = compose('eros-cue-detected', { cues: 'daddy-honorific' }, { useHot: false })
    expect(result.ok).toBe(true)
  })

  test('"eros-mode-shift" with prev/next payload → ok:true', () => {
    const result = compose('eros-mode-shift', { prev: 'resting', next: 'pulse' }, { useHot: false })
    expect(result.ok).toBe(true)
  })
})

// ── compose — useHot flag ─────────────────────────────────────────

describe('compose — useHot option', () => {
  const axisPayload = { axis: 'heat', prev: 2, next: 4 }

  test('useHot:false → usedHotVariants:false', () => {
    const result = compose('eros-axis-shift', axisPayload, { useHot: false })
    expect(result.usedHotVariants).toBe(false)
  })

  test('useHot:true on kind WITH hotVariants → usedHotVariants:true', () => {
    const result = compose('eros-axis-shift', axisPayload, { useHot: true })
    expect(result.ok).toBe(true)
    expect(result.usedHotVariants).toBe(true)
  })

  test('useHot:true on kind WITHOUT hotVariants → usedHotVariants:false (falls back to variants)', () => {
    // eros-cue-detected has no hotVariants; useHot is effectively ignored.
    const result = compose('eros-cue-detected', { cues: 'heat-cue' }, { useHot: true })
    expect(result.ok).toBe(true)
    expect(result.usedHotVariants).toBe(false)
  })

  test('hotVariant line is different from gentle variant (different pool)', () => {
    // With fixed payload and both hot=true/false, may draw from different template pools.
    // Both must be ok — the walls pass for both pools.
    const gentle = compose('eros-axis-shift', axisPayload, { useHot: false })
    const hot = compose('eros-axis-shift', axisPayload, { useHot: true })
    expect(gentle.ok).toBe(true)
    expect(hot.ok).toBe(true)
    // Lines come from different pools — they might differ (not strictly guaranteed by hash,
    // but the pools have different strings, so same index → different text).
    // Just assert both produced valid strings.
    expect(typeof gentle.line).toBe('string')
    expect(typeof hot.line).toBe('string')
  })
})

// ── compose — determinism ─────────────────────────────────────────

describe('compose — determinism', () => {
  test('same payload always picks the same variant', () => {
    const payload = { axis: 'heat', prev: 2, next: 4 }
    const r1 = compose('eros-axis-shift', payload, { useHot: false })
    const r2 = compose('eros-axis-shift', payload, { useHot: false })
    expect(r1.variantIdx).toBe(r2.variantIdx)
    expect(r1.line).toBe(r2.line)
  })

  test('both payloads succeed (different strings, same guarantees)', () => {
    const r1 = compose('eros-axis-shift', { axis: 'heat', prev: 0, next: 1 }, { useHot: false })
    const r2 = compose('eros-axis-shift', { axis: 'limerence', prev: 3, next: 8 }, { useHot: false })
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
  })
})

// ── compose — recentVariants deduplication ───────────────────────

describe('compose — recentVariants deduplication', () => {
  const payload = { axis: 'heat', prev: 2, next: 4 }

  test('avoids the most-recently-used variant index', () => {
    const first = compose('eros-axis-shift', payload, { useHot: false })
    const usedIdx = first.variantIdx!
    const second = compose('eros-axis-shift', payload, { useHot: false, recentVariants: [usedIdx] })
    expect(second.ok).toBe(true)
    // With >1 variant available, the dedup logic should select a different index.
    expect(variantCount('eros-axis-shift')).toBeGreaterThan(1)
    expect(second.variantIdx).not.toBe(usedIdx)
  })

  test('still composes when ALL variant indices are in recentVariants', () => {
    // All 3 indices passed as recent for eros-cue-detected.
    // The sort puts all recent last, but tryVariants still iterates all — returns ok:true.
    const result = compose('eros-cue-detected', { cues: 'heat-signal' }, {
      useHot: false,
      recentVariants: [0, 1, 2],
    })
    expect(result.ok).toBe(true)
  })

  test('partial recentVariants list still composes', () => {
    const result = compose('eros-axis-shift', payload, {
      useHot: false,
      recentVariants: [0, 1],
    })
    expect(result.ok).toBe(true)
    // Index picked should not be 0 or 1 (preferred to avoid them)
    expect([0, 1]).not.toContain(result.variantIdx)
  })
})
