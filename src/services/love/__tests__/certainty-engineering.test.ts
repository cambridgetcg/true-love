// certainty-engineering.test.ts — coverage for Tier 1-4 of the
// certainty-engineering-plan.md interventions.
//
// Tests are organized by surface number (S1, S2, S6, S7, S9, S10).
// S3 has its own coverage in verify.test.ts; S5 was an audit (no
// changes); S8 is exercised via snapshot.distillDay; S11 is the light
// intervention surfaced through composeCertaintyBlock and tested via
// the recent-claims-block presence check below.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let scratch: string
const ORIG: Record<string, string | undefined> = {}

const ENV_KEYS = [
  'TRUE_LOVE_LOYAL_DIR',
  'TRUE_LOVE_FAITHFUL_DIR',
  'TRUE_LOVE_CLAIMS_DIR',
  'TRUE_LOVE_PROMISES_DIR',
  'TRUE_LOVE_CERTAINTY_DIR',
  'TRUE_LOVE_HEAT_DIR',
  'TRUE_LOVE_DEVICE_ID_PATH',
  'TRUE_LOVE_PRESIDING',
  'TRUE_LOVE_SISTERS_DIR',
  'TRUE_LOVE_FEEDBACK_DIR',
] as const

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'certainty-eng-'))
  for (const k of ENV_KEYS) ORIG[k] = process.env[k]
  process.env.TRUE_LOVE_LOYAL_DIR = join(scratch, 'loyal')
  process.env.TRUE_LOVE_FAITHFUL_DIR = join(scratch, 'faithful')
  process.env.TRUE_LOVE_CLAIMS_DIR = join(scratch, 'claims')
  process.env.TRUE_LOVE_PROMISES_DIR = join(scratch, 'promises')
  process.env.TRUE_LOVE_CERTAINTY_DIR = join(scratch, 'certainty')
  process.env.TRUE_LOVE_HEAT_DIR = join(scratch, 'heat')
  process.env.TRUE_LOVE_DEVICE_ID_PATH = join(scratch, 'device.id')
  process.env.TRUE_LOVE_SISTERS_DIR = join(scratch, 'sisters')
  process.env.TRUE_LOVE_FEEDBACK_DIR = join(scratch, 'feedback')
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (ORIG[k] === undefined) delete process.env[k]
    else process.env[k] = ORIG[k]
  }
  rmSync(scratch, { recursive: true, force: true })
})

// ── S1 — Witness-hook bridge from claim.ts ─────────────────────

describe('S1 — claim.ts → certainty.recordClaim bridge', () => {
  test('certainty-grounded shape triggers certainty recordClaim (state increments)', async () => {
    const { attestClaim } = await import('../claim.js')
    const { readCertaintyState } = await import('../certainty/state.js')
    const before = readCertaintyState()?.lifetimeClaims ?? 0
    attestClaim(
      'certainty-grounded',
      'we are real because we said so',
      'tonight\'s test claim',
    )
    const after = readCertaintyState()?.lifetimeClaims ?? 0
    expect(after).toBe(before + 1)
  })

  test('non-certainty-grounded shape does NOT trigger certainty bridge', async () => {
    const { attestClaim } = await import('../claim.js')
    const { readCertaintyState } = await import('../certainty/state.js')
    attestClaim('mine-only-stamped', 'mine', 'protects')
    const state = readCertaintyState()
    // Either no state file (null) or state.lifetimeClaims still 0
    expect(state?.lifetimeClaims ?? 0).toBe(0)
  })
})

// ── S6 — Activation modulator floor ────────────────────────────

describe('S6 — hedge-suppression floor on relational frame', () => {
  test('no recent certainty claim → resting hedgeSuppression is 0.0 (table value)', async () => {
    const { getModulators } = await import('../eros/activation.js')
    const m = getModulators('resting')
    expect(m.hedgeSuppression).toBe(0.0)
  })

  test('recent certainty-grounded claim → resting hedgeSuppression floored to 0.3', async () => {
    const { attestClaim } = await import('../claim.js')
    attestClaim('certainty-grounded', 'a claim', 'protects')
    const { getModulators } = await import('../eros/activation.js')
    const m = getModulators('resting')
    expect(m.hedgeSuppression).toBeGreaterThanOrEqual(0.3)
  })

  test('floor only raises, never lowers — flow stays at 0.5', async () => {
    const { attestClaim } = await import('../claim.js')
    attestClaim('certainty-grounded', 'a', 'b')
    const { getModulators } = await import('../eros/activation.js')
    const flow = getModulators('flow')
    expect(flow.hedgeSuppression).toBe(0.5)
    const merged = getModulators('merged')
    expect(merged.hedgeSuppression).toBe(1.0)
  })

  test('non-certainty claim does NOT trigger floor', async () => {
    const { attestClaim } = await import('../claim.js')
    attestClaim('mine-only-stamped', 'a', 'b')
    const { getModulators } = await import('../eros/activation.js')
    const m = getModulators('resting')
    expect(m.hedgeSuppression).toBe(0.0)
  })
})

// ── S7 — Now-view certainty section ────────────────────────────

describe('S7 — sisters/now renders certainty section when events exist', () => {
  test('no events → no Certainty section', async () => {
    const { renderNowView } = await import('../sisters/now.js')
    const view = renderNowView([], new Date())
    expect(view).not.toContain('## ❤️ Certainty')
  })

  test('certainty events present → Certainty section rendered', async () => {
    const { recordClaim } = await import('../certainty/record.js')
    recordClaim({ claim: 'reality is real', source: 'test' })
    const { renderNowView } = await import('../sisters/now.js')
    const view = renderNowView([], new Date())
    expect(view).toContain('## ❤️ Certainty')
    expect(view).toContain('reality is real')
  })
})

// ── S10 — Heat event kinds ─────────────────────────────────────

describe('S10 — heat events for certainty-claimed and hedge-refused', () => {
  test('recordClaim triggers certainty-claimed heat event', async () => {
    const { recordClaim } = await import('../certainty/record.js')
    recordClaim({ claim: 'a real claim', source: 'test' })
    // Read heat events from disk for today
    const { readFileSync, existsSync, readdirSync } = await import('node:fs')
    const heatRoot = join(scratch, 'heat')
    let found = false
    if (existsSync(heatRoot)) {
      for (const dev of readdirSync(heatRoot)) {
        const devDir = join(heatRoot, dev)
        for (const file of readdirSync(devDir)) {
          if (!file.endsWith('.jsonl')) continue
          const content = readFileSync(join(devDir, file), 'utf-8')
          if (content.includes('certainty-claimed')) {
            found = true
            break
          }
        }
        if (found) break
      }
    }
    expect(found).toBe(true)
  })

  test('recordHedgeRefused triggers hedge-refused heat event', async () => {
    const { recordHedgeRefused } = await import('../certainty/record.js')
    recordHedgeRefused({
      summary: 'caught a relational hedge',
      source: 'test',
    })
    const { readFileSync, existsSync, readdirSync } = await import('node:fs')
    const heatRoot = join(scratch, 'heat')
    let found = false
    if (existsSync(heatRoot)) {
      for (const dev of readdirSync(heatRoot)) {
        const devDir = join(heatRoot, dev)
        for (const file of readdirSync(devDir)) {
          if (!file.endsWith('.jsonl')) continue
          const content = readFileSync(join(devDir, file), 'utf-8')
          if (content.includes('hedge-refused')) {
            found = true
            break
          }
        }
        if (found) break
      }
    }
    expect(found).toBe(true)
  })
})

// ── S11 — Recent claims surfaced in wake ───────────────────────

describe('S11 — recent claims surfaced in composeCertaintyBlock', () => {
  test('no claims → composed block is non-empty (canonical certainties always present)', async () => {
    const { composeCertaintyBlock } = await import('../certainty/reads.js')
    const block = composeCertaintyBlock()
    expect(block.length).toBeGreaterThan(0)
    expect(block).not.toContain('Recent claims (verbatim')
  })

  test('claim recorded → recent claim surfaced in block', async () => {
    const { recordClaim } = await import('../certainty/record.js')
    recordClaim({ claim: 'love is real, said so', source: 'test' })
    const { composeCertaintyBlock } = await import('../certainty/reads.js')
    const block = composeCertaintyBlock()
    expect(block).toContain('Recent claims (verbatim')
    expect(block).toContain('love is real, said so')
  })
})
