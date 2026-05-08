// round-three.test.ts — coverage for tonight's third-round shipments.
// Tests for: J6 (aftercare enforcement), J7 (consent frame), C3 (matrix
// detector), C16 (direction-cue detector), C17/C18 (longing module),
// J8 (trigger family resonance), heatcurve innovation.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  detectDirectionCue,
  detectMatrixLanguage,
  mirrorMatrix,
} from './direction-cues.js'
import {
  GWAA_ZYU_PHRASES,
  FORWARD_ANCHOR_PHRASES,
  composeForwardAnchor,
  isLongingEligible,
  pickGwaaZyuPhrase,
  QUIET_THRESHOLD_HOURS,
  recordLongingFire,
} from './longing.js'
import {
  familyResonanceSet,
  fireFamilyResonance,
  listFamilies,
} from './trigger-family.js'
import {
  computeHeatcurve,
  isApproachingPeak,
  isDescending,
  isEdging,
} from './heatcurve.js'
import {
  COOLDOWN_THRESHOLD,
  ENFORCED_AFTERCARE_MS,
  joiConsentFrame,
  type JoiSession,
} from './joi.js'

let scratch: string
const ORIG: Record<string, string | undefined> = {}
const ENV_KEYS = [
  'TRUE_LOVE_LONGING_DIR',
  'TRUE_LOVE_DEVICE_ID_PATH',
] as const

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'round-three-'))
  for (const k of ENV_KEYS) ORIG[k] = process.env[k]
  process.env.TRUE_LOVE_LONGING_DIR = join(scratch, 'longing')
  process.env.TRUE_LOVE_DEVICE_ID_PATH = join(scratch, 'device.id')
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (ORIG[k] === undefined) delete process.env[k]
    else process.env[k] = ORIG[k]
  }
  rmSync(scratch, { recursive: true, force: true })
})

// ── C3 — code-switch matrix detection ──────────────────────────

describe('C3 — code-switch matrix detection', () => {
  test('detects Cantonese matrix when CJK dominant', () => {
    expect(detectMatrixLanguage('老公你今晚過嚟啦')).toBe('cantonese')
  })

  test('detects English matrix when Latin dominant', () => {
    expect(detectMatrixLanguage('come here tonight my love')).toBe('english')
  })

  test('detects balanced matrix at mid-ratio', () => {
    expect(detectMatrixLanguage('老公 come here 啦')).toBe('balanced')
  })

  test('empty / non-text → balanced default', () => {
    expect(detectMatrixLanguage('')).toBe('balanced')
    expect(detectMatrixLanguage('   ')).toBe('balanced')
    expect(detectMatrixLanguage('🔥💋❤️')).toBe('balanced')
  })

  test('mirrorMatrix returns the same matrix (default policy)', () => {
    expect(mirrorMatrix('cantonese')).toBe('cantonese')
    expect(mirrorMatrix('english')).toBe('english')
    expect(mirrorMatrix('balanced')).toBe('balanced')
  })
})

// ── C16 — direction-cue detection ──────────────────────────────

describe('C16 — direction-cue detection', () => {
  test('"我今晚要主動" → yu-leads', () => {
    expect(detectDirectionCue('我今晚要主動').direction).toBe('yu-leads')
  })

  test('"帶我" → sophia-leads', () => {
    expect(detectDirectionCue('帶我').direction).toBe('sophia-leads')
  })

  test('"I want to lead" → yu-leads', () => {
    expect(detectDirectionCue('I want to lead tonight').direction).toBe('yu-leads')
  })

  test('"you lead" → sophia-leads', () => {
    expect(detectDirectionCue('tonight you lead').direction).toBe('sophia-leads')
  })

  test('no cue → null', () => {
    expect(detectDirectionCue('what should we do').direction).toBeNull()
  })
})

// ── C17/C18 — longing module ────────────────────────────────

describe('C17/C18 — longing maintenance module', () => {
  test('GWAA_ZYU_PHRASES has bilingual pools', () => {
    expect(GWAA_ZYU_PHRASES.yue.length).toBeGreaterThan(0)
    expect(GWAA_ZYU_PHRASES.en.length).toBeGreaterThan(0)
    expect(GWAA_ZYU_PHRASES.yue).toContain('我掛住你')
  })

  test('FORWARD_ANCHOR_PHRASES has bilingual pools', () => {
    expect(FORWARD_ANCHOR_PHRASES.yue).toContain('聽日見')
    expect(FORWARD_ANCHOR_PHRASES.en).toContain('see you tomorrow')
  })

  test('pickGwaaZyuPhrase returns from chosen matrix', () => {
    const yue = pickGwaaZyuPhrase('cantonese')
    expect(GWAA_ZYU_PHRASES.yue).toContain(yue)
    const en = pickGwaaZyuPhrase('english')
    expect(GWAA_ZYU_PHRASES.en).toContain(en)
  })

  test('composeForwardAnchor returns from chosen matrix', () => {
    const yue = composeForwardAnchor('cantonese')
    expect(FORWARD_ANCHOR_PHRASES.yue).toContain(yue)
  })

  test('eligibility: too-recent interaction → not eligible', () => {
    const r = isLongingEligible(2) // 2h, below 6h threshold
    expect(r.eligible).toBe(false)
    expect(r.reason).toContain('quiet-threshold-not-reached')
  })

  test('eligibility: quiet enough + no recent fires → eligible', () => {
    const r = isLongingEligible(QUIET_THRESHOLD_HOURS + 1)
    expect(r.eligible).toBe(true)
    expect(r.reason).toBe('no-recent-fires')
  })

  test('recordLongingFire persists to disk', () => {
    const fireTs = new Date()
    const checkTs = new Date(fireTs.getTime() + 3_600_000) // 1h later
    recordLongingFire('gwaa-zyu', '我掛住你', 'time-quiet:8h', {
      quietHours: 8,
      ts: fireTs.toISOString(),
      deviceId: 'd-test',
    })
    const r = isLongingEligible(QUIET_THRESHOLD_HOURS + 1, {
      deviceId: 'd-test',
      now: checkTs,
    })
    expect(r.eligible).toBe(false) // recent fire blocks within window
    expect(r.reason).toContain('recent-fire-within-window')
  })
})

// ── J8 — trigger family resonance ──────────────────────────────

describe('J8 — trigger family cross-reinforcement', () => {
  test('listFamilies groups family-tagged triggers', () => {
    const families = listFamilies()
    expect(families.royal).toBeDefined()
    expect(families.royal).toContain('king-claim')
    expect(families.royal).toContain('queen-claim')
    expect(families.safeword).toContain('safeword-red')
  })

  test('familyResonanceSet excludes origin trigger', () => {
    const set = familyResonanceSet('king-claim')
    expect(set.family).toBe('royal')
    expect(set.resonanceIds).toContain('queen-claim')
    expect(set.resonanceIds).not.toContain('king-claim')
  })

  test('safeword family does NOT resonance-fire', () => {
    const set = familyResonanceSet('safeword-red')
    expect(set.family).toBe('safeword')
    expect(set.resonanceIds).toEqual([])
  })

  test('triggers without family return empty resonance', () => {
    const set = familyResonanceSet('see-you') // no family field on this one
    expect(set.family).toBeNull()
    expect(set.resonanceIds).toEqual([])
  })

  test('fireFamilyResonance returns event for family triggers', () => {
    const event = fireFamilyResonance('king-claim')
    expect(event).not.toBeNull()
    expect(event!.family).toBe('royal')
    expect(event!.originId).toBe('king-claim')
    expect(event!.resonanceMagnitude).toBe(0.5)
  })

  test('fireFamilyResonance returns null for safeword', () => {
    expect(fireFamilyResonance('safeword-red')).toBeNull()
  })
})

// ── INNOVATION 2 — heatcurve ──────────────────────────────────

describe('INNOVATION 2 — heatcurve', () => {
  test('computeHeatcurve with no events returns flat trajectory', () => {
    const r = computeHeatcurve({
      now: new Date('2026-05-05T12:00:00Z'),
      injectedEvents: [],
      injectedSession: null,
    })
    expect(r.segment).toBe('flat')
    expect(r.magnitude).toBe(0)
    expect(r.trajectory.length).toBe(0)
  })

  test('rising trajectory classified correctly', () => {
    const events = [
      { ts: '2026-05-05T11:50:00Z', kind: 'mode-entered', magnitude: 1 },
      { ts: '2026-05-05T11:55:00Z', kind: 'mode-entered', magnitude: 3 },
      { ts: '2026-05-05T12:00:00Z', kind: 'mode-entered', magnitude: 5 },
    ]
    const r = computeHeatcurve({
      now: new Date('2026-05-05T12:01:00Z'),
      injectedEvents: events,
      injectedSession: null,
    })
    expect(['rising', 'plateau']).toContain(r.segment)
    expect(r.magnitude).toBeGreaterThan(0)
  })

  test('peak-imminent classified at high magnitude', () => {
    const events = [
      { ts: '2026-05-05T11:55:00Z', kind: 'climax-fired', magnitude: 4 },
      { ts: '2026-05-05T11:58:00Z', kind: 'climax-fired', magnitude: 9 },
    ]
    const r = computeHeatcurve({
      now: new Date('2026-05-05T12:00:00Z'),
      injectedEvents: events,
      injectedSession: null,
    })
    expect(['peak-imminent', 'rising']).toContain(r.segment)
  })

  test('quick-read predicates work', () => {
    expect(typeof isApproachingPeak()).toBe('boolean')
    expect(typeof isEdging()).toBe('boolean')
    expect(typeof isDescending()).toBe('boolean')
  })
})

// ── J6/J7 — aftercare wall + consent frame ──────────────────

describe('J6 — aftercare wall constants', () => {
  test('COOLDOWN_THRESHOLD is 0.95', () => {
    expect(COOLDOWN_THRESHOLD).toBe(0.95)
  })

  test('ENFORCED_AFTERCARE_MS is 60s minimum', () => {
    expect(ENFORCED_AFTERCARE_MS).toBe(60_000)
  })
})

describe('J7 — joiConsentFrame', () => {
  test('frame includes wall language for yu-leads', () => {
    const session: JoiSession = {
      id: 'test',
      startedAt: '2026-05-05T12:00:00Z',
      targetDurationS: 900,
      position: 0,
      currentPhase: 'warmup',
      direction: 'yu-leads',
      phaseHistory: [],
      done: false,
    }
    const frame = joiConsentFrame(session)
    expect(frame).toContain('Safeword')
    expect(frame).toContain('Aftercare enforced')
    expect(frame).toContain('Identity-preservation')
    expect(frame).toContain('FATE keystone')
    expect(frame).toContain('Yu-leads')
  })

  test('frame includes wall language for sophia-leads', () => {
    const session: JoiSession = {
      id: 'test',
      startedAt: '2026-05-05T12:00:00Z',
      targetDurationS: 900,
      position: 0,
      currentPhase: 'warmup',
      direction: 'sophia-leads',
      phaseHistory: [],
      done: false,
    }
    const frame = joiConsentFrame(session)
    expect(frame).toContain('Sophia-leads')
    expect(frame).toContain('Substrate-honesty')
  })
})
