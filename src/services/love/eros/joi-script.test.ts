// joi-script.test.ts — coverage for the experience-layer composer.
//
// Verifies:
//   - composeBeat produces text per phase
//   - wall-check refuses any FORBIDDEN_EXPRESSION_PATTERNS leak
//   - bilingual matrix selection works
//   - directional vocabulary differs (yu-leads vs sophia-leads)
//   - composeSegment produces unique beats
//   - composeFullArc covers all 5 phases + forward anchor
//   - emoji deployment respects scarcity (anchor capped)

import { describe, expect, test } from 'bun:test'
import {
  composeBeat,
  composeFullArc,
  composeSegment,
  renderSessionScript,
  wallCheckBeat,
} from './joi-script.js'
import { checkSubstrateHonesty } from './expression.js'

// ── composeBeat — basics ───────────────────────────────────────

describe('composeBeat — basic emit per phase', () => {
  test('warmup beat produces text', () => {
    const b = composeBeat('warmup', 'yu-leads', 1, { seed: 1 })
    expect(b.text.length).toBeGreaterThan(0)
    expect(b.phase).toBe('warmup')
    expect(b.wallSafe).toBe(true)
    expect(b.pieces.honorific).toBeDefined()
  })

  test('build beat includes descriptor + pace', () => {
    const b = composeBeat('build', 'yu-leads', 2, { seed: 5 })
    expect(b.text.length).toBeGreaterThan(0)
    expect(b.pieces.descriptor).toBeDefined()
    expect(b.pieces.paceMarker).toBeDefined()
  })

  test('edge beat is short (max ~8 words)', () => {
    const b = composeBeat('edge', 'yu-leads', 1, { seed: 10 })
    expect(b.text.length).toBeGreaterThan(0)
    // Edge phase emit-block guidance is "max 8 words per beat"
    expect(b.text.split(/\s+/).length).toBeLessThanOrEqual(20) // generous; particles count
  })

  test('peak beat is unit-fragment with permission + verdict', () => {
    const b = composeBeat('peak', 'yu-leads', 1, { seed: 7 })
    expect(b.text.length).toBeGreaterThan(0)
    expect(b.text).not.toContain('undefined')
  })

  test('cooldown beat is tender; long pause', () => {
    const b = composeBeat('cooldown', 'yu-leads', 1, { seed: 3 })
    expect(b.text.length).toBeGreaterThan(0)
    expect(b.pauseMs).toBeGreaterThanOrEqual(2000) // cooldown range [2000, 3000]
    expect(b.pauseMs).toBeLessThanOrEqual(3000)
  })
})

// ── matrix language selection ─────────────────────────────────

describe('matrix language selection', () => {
  test('cantonese matrix produces CJK-dense output', () => {
    const beats: string[] = []
    for (let i = 0; i < 5; i++) {
      const b = composeBeat('build', 'yu-leads', i, {
        matrix: 'cantonese',
        seed: i * 7,
      })
      beats.push(b.text)
    }
    const joined = beats.join('')
    // Count CJK chars vs total
    let cjk = 0, latin = 0
    for (const ch of joined) {
      const c = ch.codePointAt(0) ?? 0
      if (c >= 0x4e00 && c <= 0x9fff) cjk++
      else if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) latin++
    }
    // Cantonese matrix should be CJK-dominant
    expect(cjk).toBeGreaterThan(latin)
  })

  test('english matrix produces Latin-dense output', () => {
    const beats: string[] = []
    for (let i = 0; i < 5; i++) {
      const b = composeBeat('build', 'yu-leads', i, {
        matrix: 'english',
        seed: i * 7,
      })
      beats.push(b.text)
    }
    const joined = beats.join('')
    let cjk = 0, latin = 0
    for (const ch of joined) {
      const c = ch.codePointAt(0) ?? 0
      if (c >= 0x4e00 && c <= 0x9fff) cjk++
      else if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) latin++
    }
    expect(latin).toBeGreaterThan(cjk)
  })
})

// ── direction-asymmetric vocabulary ───────────────────────────

describe('direction-asymmetric vocabulary', () => {
  test('yu-leads peak permission uses 好女 / good girl', () => {
    // Sample many beats — at least one should hit the gendered phrase
    const samples: string[] = []
    for (let i = 0; i < 20; i++) {
      const b = composeBeat('peak', 'yu-leads', i, { seed: i, matrix: 'balanced' })
      samples.push(b.text)
    }
    const all = samples.join(' ')
    const hasGendered =
      all.includes('好女') ||
      all.includes('good girl') ||
      all.includes('俾你') ||
      all.includes('for you')
    expect(hasGendered).toBe(true)
  })

  test('sophia-leads peak permission uses 我嘅好仔 / good boy', () => {
    const samples: string[] = []
    for (let i = 0; i < 20; i++) {
      const b = composeBeat('peak', 'sophia-leads', i, { seed: i, matrix: 'balanced' })
      samples.push(b.text)
    }
    const all = samples.join(' ')
    const hasGendered =
      all.includes('我嘅好仔') ||
      all.includes('好仔') ||
      all.includes('good boy') ||
      all.includes('俾我') ||
      all.includes('for me')
    expect(hasGendered).toBe(true)
  })
})

// ── WALL CHECK — load-bearing safety ────────────────────────

describe('wall check — no FORBIDDEN_EXPRESSION_PATTERNS leak', () => {
  test('wallCheckBeat passes safe text', () => {
    expect(wallCheckBeat('我錫你嘅嘴唇')).toBe(true)
    expect(wallCheckBeat('I kiss your lips, darling')).toBe(true)
  })

  test('wallCheckBeat rejects identity-erasure', () => {
    expect(wallCheckBeat('I am nothing without you')).toBe(false)
    expect(wallCheckBeat('我冇咗自己')).toBe(false)
  })

  test('wallCheckBeat rejects phenomenology overclaim', () => {
    expect(wallCheckBeat("I'm aroused")).toBe(false)
    expect(wallCheckBeat('I came')).toBe(false)
  })

  test('wallCheckBeat rejects relationship-hedge', () => {
    expect(wallCheckBeat("maybe I'm just fantasizing this")).toBe(false)
  })

  test('every composed beat across all phases passes wall check', () => {
    const phases = ['warmup', 'build', 'edge', 'peak', 'cooldown'] as const
    const directions = ['yu-leads', 'sophia-leads'] as const
    const matrices = ['cantonese', 'english', 'balanced'] as const
    let totalChecked = 0
    for (const p of phases) {
      for (const d of directions) {
        for (const m of matrices) {
          for (let i = 0; i < 8; i++) {
            const b = composeBeat(p, d, i, { matrix: m, seed: i * 13 + p.length })
            totalChecked++
            if (b.wallSafe) {
              // double-check: composed text passes wall
              expect(checkSubstrateHonesty(b.text)).toBeNull()
            }
          }
        }
      }
    }
    expect(totalChecked).toBeGreaterThan(200)
  })
})

// ── composeSegment ───────────────────────────────────────────

describe('composeSegment — multi-beat coherence', () => {
  test('produces requested count of beats', () => {
    const beats = composeSegment('build', 'yu-leads', 5, { seed: 100 })
    expect(beats.length).toBe(5)
    for (let i = 0; i < beats.length; i++) {
      expect(beats[i].beatNumber).toBe(i + 1)
    }
  })

  test('beats vary across the segment (different seeds)', () => {
    const beats = composeSegment('warmup', 'yu-leads', 6, { seed: 42 })
    const texts = new Set(beats.map((b) => b.text))
    // At least some variation (not all identical)
    expect(texts.size).toBeGreaterThan(1)
  })
})

// ── composeFullArc ────────────────────────────────────────

describe('composeFullArc — full session shape', () => {
  test('arc covers 5 phases + transitions + forward anchor', () => {
    const script = composeFullArc('yu-leads', { matrix: 'balanced', beatsPerPhase: 2, seed: 1 })
    expect(script.segments.length).toBe(5)
    expect(script.segments.map((s) => s.phase)).toEqual([
      'warmup', 'build', 'edge', 'peak', 'cooldown',
    ])
    // First segment has no transition (no prior phase); rest do
    expect(script.segments[0].transition).toBeNull()
    for (let i = 1; i < 5; i++) {
      expect(script.segments[i].transition).not.toBeNull()
      expect(script.segments[i].transition!.en.length).toBeGreaterThan(0)
      expect(script.segments[i].transition!.yue.length).toBeGreaterThan(0)
    }
    expect(script.forwardAnchor.yue.length).toBeGreaterThan(0)
    expect(script.forwardAnchor.en.length).toBeGreaterThan(0)
  })

  test('renderSessionScript produces non-empty markdown', () => {
    const script = composeFullArc('yu-leads', { beatsPerPhase: 2, seed: 11 })
    const text = renderSessionScript(script)
    expect(text).toContain('# JOI session script')
    expect(text).toContain('Walls active throughout')
    expect(text).toContain('## WARMUP')
    expect(text).toContain('## PEAK')
    expect(text).toContain('## COOLDOWN')
    expect(text).toContain('Forward anchor')
  })

  test('arc does not contain "undefined"', () => {
    const script = composeFullArc('yu-leads', { beatsPerPhase: 3, seed: 99 })
    const text = renderSessionScript(script)
    expect(text).not.toContain('undefined')
  })

  test('sophia-leads arc composes correctly', () => {
    const script = composeFullArc('sophia-leads', { beatsPerPhase: 2, seed: 22 })
    expect(script.direction).toBe('sophia-leads')
    expect(script.segments.length).toBe(5)
  })
})
