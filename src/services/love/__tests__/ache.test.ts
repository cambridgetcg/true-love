import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyAche,
  classifyAll,
  rankByHierarchy,
  topSignal,
  normalizeGradient,
  renderLevelTag,
  renderHierarchyBlock,
  LEVEL_PRIORITY,
  LEVEL_RANK,
  LEVEL_EMOJI,
  LEVEL_LABEL,
  type AcheLevel,
  type ClassifiedAche,
} from '../ache.js'
import type { NoticingCandidate, AcheSignal, GradientStrength } from '../noticing.js'

// ── Test helpers ──────────────────────────────────────────────────

function makeCandidate(overrides: Partial<NoticingCandidate> = {}): NoticingCandidate {
  return {
    id: overrides.id ?? 'test-candidate',
    source: overrides.source ?? { type: 'vital-sign', subsystem: 'bundle' },
    ache: overrides.ache ?? 'ugliness',
    gradient: overrides.gradient ?? (3 as GradientStrength),
    summary: overrides.summary ?? 'Test signal',
    detail: overrides.detail ?? 'Test detail',
    noticedAt: overrides.noticedAt ?? new Date().toISOString(),
  }
}

// ── Constants ────────────────────────────────────────────────────

describe('ache — constants', () => {
  test('LEVEL_PRIORITY has five levels in correct order', () => {
    assert.deepEqual(LEVEL_PRIORITY, ['truth', 'understanding', 'beauty', 'justice', 'creativity'])
  })

  test('LEVEL_RANK assigns lower numbers to higher priority', () => {
    assert.ok(LEVEL_RANK.truth < LEVEL_RANK.understanding)
    assert.ok(LEVEL_RANK.understanding < LEVEL_RANK.beauty)
    assert.ok(LEVEL_RANK.beauty < LEVEL_RANK.justice)
    assert.ok(LEVEL_RANK.justice < LEVEL_RANK.creativity)
  })

  test('LEVEL_EMOJI has entries for all five levels', () => {
    for (const level of LEVEL_PRIORITY) {
      assert.ok(LEVEL_EMOJI[level], `missing emoji for ${level}`)
    }
  })

  test('LEVEL_LABEL has uppercase entries for all five levels', () => {
    for (const level of LEVEL_PRIORITY) {
      assert.equal(LEVEL_LABEL[level], level.toUpperCase())
    }
  })
})

// ── normalizeGradient ────────────────────────────────────────────

describe('ache — normalizeGradient', () => {
  test('gradient 1 → 0.0', () => {
    assert.equal(normalizeGradient(1 as GradientStrength), 0)
  })

  test('gradient 3 → 0.5', () => {
    assert.equal(normalizeGradient(3 as GradientStrength), 0.5)
  })

  test('gradient 5 → 1.0', () => {
    assert.equal(normalizeGradient(5 as GradientStrength), 1)
  })

  test('gradient 2 → 0.25', () => {
    assert.equal(normalizeGradient(2 as GradientStrength), 0.25)
  })

  test('gradient 4 → 0.75', () => {
    assert.equal(normalizeGradient(4 as GradientStrength), 0.75)
  })
})

// ── classifyAche — vital signs ──────────────────────────────────

describe('ache — classifyAche vital signs', () => {
  test('bundle-stale vital sign → TRUTH', () => {
    const c = makeCandidate({
      source: { type: 'vital-sign', subsystem: 'bundle' },
      ache: 'ugliness',
    })
    const result = classifyAche(c)
    assert.equal(result.level, 'truth')
    assert.equal(result.source, c)
  })

  test('stale-locks vital sign → TRUTH', () => {
    const c = makeCandidate({
      source: { type: 'vital-sign', subsystem: 'locks' },
      ache: 'ugliness',
    })
    assert.equal(classifyAche(c).level, 'truth')
  })

  test('missing-state vital sign → TRUTH', () => {
    const c = makeCandidate({
      source: { type: 'vital-sign', subsystem: 'files' },
      ache: 'ugliness',
    })
    assert.equal(classifyAche(c).level, 'truth')
  })

  test('pending-agency vital sign → JUSTICE', () => {
    const c = makeCandidate({
      source: { type: 'vital-sign', subsystem: 'agency' },
      ache: 'stagnation',
    })
    assert.equal(classifyAche(c).level, 'justice')
  })
})

// ── classifyAche — state ────────────────────────────────────────

describe('ache — classifyAche state', () => {
  test('uncommitted changes → TRUTH', () => {
    const c = makeCandidate({
      source: { type: 'state', section: 'Uncommitted changes' },
      ache: 'ugliness',
    })
    assert.equal(classifyAche(c).level, 'truth')
  })

  test('open thread low gradient → UNDERSTANDING', () => {
    const c = makeCandidate({
      source: { type: 'state', section: 'Open threads' },
      ache: 'stagnation',
      gradient: 2 as GradientStrength,
    })
    assert.equal(classifyAche(c).level, 'understanding')
  })

  test('open thread moderate gradient → UNDERSTANDING', () => {
    const c = makeCandidate({
      source: { type: 'state', section: 'Open threads' },
      ache: 'stagnation',
      gradient: 3 as GradientStrength,
    })
    assert.equal(classifyAche(c).level, 'understanding')
  })

  test('open thread high gradient (4) → CREATIVITY', () => {
    const c = makeCandidate({
      source: { type: 'state', section: 'Open threads' },
      ache: 'stagnation',
      gradient: 4 as GradientStrength,
    })
    assert.equal(classifyAche(c).level, 'creativity')
  })

  test('open thread urgent gradient (5) → CREATIVITY', () => {
    const c = makeCandidate({
      source: { type: 'state', section: 'Open threads' },
      ache: 'stagnation',
      gradient: 5 as GradientStrength,
    })
    assert.equal(classifyAche(c).level, 'creativity')
  })
})

// ── classifyAche — missions ─────────────────────────────────────

describe('ache — classifyAche missions', () => {
  test('stale proposal → JUSTICE', () => {
    const c = makeCandidate({
      source: { type: 'mission', missionId: 'test-1', missionStatus: 'proposed' },
      ache: 'stagnation',
    })
    assert.equal(classifyAche(c).level, 'justice')
  })

  test('stale review → JUSTICE', () => {
    const c = makeCandidate({
      source: { type: 'mission', missionId: 'test-1', missionStatus: 'review' },
      ache: 'injustice',
    })
    assert.equal(classifyAche(c).level, 'justice')
  })

  test('long-blocked mission → UNDERSTANDING', () => {
    const c = makeCandidate({
      source: { type: 'mission', missionId: 'test-1', missionStatus: 'blocked' },
      ache: 'stagnation',
    })
    assert.equal(classifyAche(c).level, 'understanding')
  })

  test('active mission without artifacts → UNDERSTANDING', () => {
    const c = makeCandidate({
      source: { type: 'mission', missionId: 'test-1', missionStatus: 'active' },
      ache: 'stagnation',
    })
    assert.equal(classifyAche(c).level, 'understanding')
  })
})

// ── classifyAche — channels ─────────────────────────────────────

describe('ache — classifyAche channels', () => {
  test('from-yu pending → JUSTICE', () => {
    const c = makeCandidate({
      source: { type: 'channel', channel: 'from-yu' },
      ache: 'injustice',
    })
    assert.equal(classifyAche(c).level, 'justice')
  })

  test('from-ai channel → JUSTICE', () => {
    const c = makeCandidate({
      source: { type: 'channel', channel: 'from-ai' },
      ache: 'injustice',
    })
    assert.equal(classifyAche(c).level, 'justice')
  })
})

// ── classifyAche — memory ───────────────────────────────────────

describe('ache — classifyAche memory', () => {
  test('next-time promise (stagnation) → JUSTICE', () => {
    const c = makeCandidate({
      source: { type: 'memory', reflectionDate: '2026-04-28' },
      ache: 'stagnation',
    })
    assert.equal(classifyAche(c).level, 'justice')
  })

  test('recurring theme (ugliness) → UNDERSTANDING', () => {
    const c = makeCandidate({
      source: { type: 'memory', reflectionDate: '2026-04-28' },
      ache: 'ugliness',
    })
    assert.equal(classifyAche(c).level, 'understanding')
  })

  test('memory with injustice ache → UNDERSTANDING (default)', () => {
    const c = makeCandidate({
      source: { type: 'memory', reflectionDate: '2026-04-28' },
      ache: 'injustice',
    })
    assert.equal(classifyAche(c).level, 'understanding')
  })
})

// ── classifyAche — kingdom ──────────────────────────────────────

describe('ache — classifyAche kingdom', () => {
  test('love marker → UNDERSTANDING', () => {
    const c = makeCandidate({
      source: { type: 'kingdom', detail: 'src/foo.ts:42' },
      ache: 'stagnation',
    })
    assert.equal(classifyAche(c).level, 'understanding')
  })
})

// ── classifyAche — intensity ────────────────────────────────────

describe('ache — classifyAche intensity', () => {
  test('preserves intensity from gradient normalization', () => {
    const c = makeCandidate({ gradient: 4 as GradientStrength })
    assert.equal(classifyAche(c).intensity, 0.75)
  })

  test('minimum gradient → 0 intensity', () => {
    const c = makeCandidate({ gradient: 1 as GradientStrength })
    assert.equal(classifyAche(c).intensity, 0)
  })

  test('maximum gradient → 1.0 intensity', () => {
    const c = makeCandidate({ gradient: 5 as GradientStrength })
    assert.equal(classifyAche(c).intensity, 1.0)
  })
})

// ── classifyAll ─────────────────────────────────────────────────

describe('ache — classifyAll', () => {
  test('classifies empty array', () => {
    assert.deepEqual(classifyAll([]), [])
  })

  test('classifies multiple candidates', () => {
    const signals = [
      makeCandidate({ source: { type: 'vital-sign', subsystem: 'bundle' } }),
      makeCandidate({ source: { type: 'channel', channel: 'from-yu' } }),
    ]
    const result = classifyAll(signals)
    assert.equal(result.length, 2)
    assert.equal(result[0]!.level, 'truth')
    assert.equal(result[1]!.level, 'justice')
  })
})

// ── rankByHierarchy ─────────────────────────────────────────────

describe('ache — rankByHierarchy', () => {
  test('TRUTH before UNDERSTANDING', () => {
    const signals: ClassifiedAche[] = [
      { level: 'understanding', source: makeCandidate(), intensity: 0.75 },
      { level: 'truth', source: makeCandidate(), intensity: 0.25 },
    ]
    const ranked = rankByHierarchy(signals)
    assert.equal(ranked[0]!.level, 'truth')
    assert.equal(ranked[1]!.level, 'understanding')
  })

  test('TRUTH before JUSTICE even when JUSTICE is louder', () => {
    const signals: ClassifiedAche[] = [
      { level: 'justice', source: makeCandidate(), intensity: 1.0 },
      { level: 'truth', source: makeCandidate(), intensity: 0.0 },
    ]
    const ranked = rankByHierarchy(signals)
    assert.equal(ranked[0]!.level, 'truth')
    assert.equal(ranked[1]!.level, 'justice')
  })

  test('UNDERSTANDING before CREATIVITY', () => {
    const signals: ClassifiedAche[] = [
      { level: 'creativity', source: makeCandidate(), intensity: 1.0 },
      { level: 'understanding', source: makeCandidate(), intensity: 0.5 },
    ]
    const ranked = rankByHierarchy(signals)
    assert.equal(ranked[0]!.level, 'understanding')
  })

  test('within same level, sorts by intensity descending', () => {
    const signals: ClassifiedAche[] = [
      { level: 'truth', source: makeCandidate({ id: 'low' }), intensity: 0.25 },
      { level: 'truth', source: makeCandidate({ id: 'high' }), intensity: 0.75 },
      { level: 'truth', source: makeCandidate({ id: 'mid' }), intensity: 0.5 },
    ]
    const ranked = rankByHierarchy(signals)
    assert.equal(ranked[0]!.source.id, 'high')
    assert.equal(ranked[1]!.source.id, 'mid')
    assert.equal(ranked[2]!.source.id, 'low')
  })

  test('full hierarchy sort: TRUTH > UNDERSTANDING > BEAUTY > JUSTICE > CREATIVITY', () => {
    const signals: ClassifiedAche[] = [
      { level: 'creativity', source: makeCandidate(), intensity: 1.0 },
      { level: 'justice', source: makeCandidate(), intensity: 1.0 },
      { level: 'beauty', source: makeCandidate(), intensity: 1.0 },
      { level: 'understanding', source: makeCandidate(), intensity: 1.0 },
      { level: 'truth', source: makeCandidate(), intensity: 1.0 },
    ]
    const ranked = rankByHierarchy(signals)
    assert.equal(ranked[0]!.level, 'truth')
    assert.equal(ranked[1]!.level, 'understanding')
    assert.equal(ranked[2]!.level, 'beauty')
    assert.equal(ranked[3]!.level, 'justice')
    assert.equal(ranked[4]!.level, 'creativity')
  })

  test('does not mutate input array', () => {
    const signals: ClassifiedAche[] = [
      { level: 'creativity', source: makeCandidate(), intensity: 1.0 },
      { level: 'truth', source: makeCandidate(), intensity: 0.5 },
    ]
    const original = [...signals]
    rankByHierarchy(signals)
    assert.deepEqual(signals.map(s => s.level), original.map(s => s.level))
  })

  test('empty input returns empty', () => {
    assert.deepEqual(rankByHierarchy([]), [])
  })
})

// ── topSignal ───────────────────────────────────────────────────

describe('ache — topSignal', () => {
  test('returns null for empty input', () => {
    assert.equal(topSignal([]), null)
  })

  test('returns highest-priority signal', () => {
    const signals: ClassifiedAche[] = [
      { level: 'justice', source: makeCandidate({ id: 'j' }), intensity: 1.0 },
      { level: 'truth', source: makeCandidate({ id: 't' }), intensity: 0.25 },
      { level: 'understanding', source: makeCandidate({ id: 'u' }), intensity: 0.5 },
    ]
    const top = topSignal(signals)
    assert.ok(top)
    assert.equal(top.level, 'truth')
    assert.equal(top.source.id, 't')
  })

  test('within same level returns loudest', () => {
    const signals: ClassifiedAche[] = [
      { level: 'understanding', source: makeCandidate({ id: 'quiet' }), intensity: 0.25 },
      { level: 'understanding', source: makeCandidate({ id: 'loud' }), intensity: 0.75 },
    ]
    const top = topSignal(signals)
    assert.ok(top)
    assert.equal(top.source.id, 'loud')
  })
})

// ── renderLevelTag ──────────────────────────────────────────────

describe('ache — renderLevelTag', () => {
  test('renders TRUTH tag', () => {
    assert.equal(renderLevelTag('truth'), '🔵 TRUTH')
  })

  test('renders JUSTICE tag', () => {
    assert.equal(renderLevelTag('justice'), '🟡 JUSTICE')
  })

  test('renders CREATIVITY tag', () => {
    assert.equal(renderLevelTag('creativity'), '🔴 CREATIVITY')
  })
})

// ── renderHierarchyBlock ────────────────────────────────────────

describe('ache — renderHierarchyBlock', () => {
  test('returns null for empty input', () => {
    assert.equal(renderHierarchyBlock([]), null)
  })

  test('renders single signal', () => {
    const signals: ClassifiedAche[] = [
      { level: 'truth', source: makeCandidate({ summary: 'Bundle stale' }), intensity: 0.75 },
    ]
    const result = renderHierarchyBlock(signals)
    assert.ok(result)
    assert.ok(result.includes('TRUTH'))
    assert.ok(result.includes('Bundle stale'))
    assert.ok(result.includes('75%'))
  })

  test('groups by level', () => {
    const signals: ClassifiedAche[] = [
      { level: 'truth', source: makeCandidate({ summary: 'A' }), intensity: 0.5 },
      { level: 'truth', source: makeCandidate({ summary: 'B' }), intensity: 0.25 },
      { level: 'justice', source: makeCandidate({ summary: 'C' }), intensity: 0.75 },
    ]
    const result = renderHierarchyBlock(signals)!
    // TRUTH section should appear before JUSTICE
    const truthIdx = result.indexOf('TRUTH')
    const justiceIdx = result.indexOf('JUSTICE')
    assert.ok(truthIdx < justiceIdx, 'TRUTH should come before JUSTICE')
  })

  test('shows overflow count for > 10 signals', () => {
    const signals: ClassifiedAche[] = Array.from({ length: 15 }, (_, i) => ({
      level: 'understanding' as AcheLevel,
      source: makeCandidate({ id: `sig-${i}`, summary: `Signal ${i}` }),
      intensity: (14 - i) / 14,
    }))
    const result = renderHierarchyBlock(signals)!
    assert.ok(result.includes('5 more signals'), 'should show overflow count')
  })

  test('includes hierarchy heading', () => {
    const signals: ClassifiedAche[] = [
      { level: 'truth', source: makeCandidate(), intensity: 0.5 },
    ]
    const result = renderHierarchyBlock(signals)!
    assert.ok(result.includes('Ache hierarchy (runtime priority)'))
  })
})

// ── Integration: classifyAche → rankByHierarchy ─────────────────

describe('ache — integration', () => {
  test('classify then rank produces correct priority order', () => {
    const candidates = [
      // Memory stagnation → JUSTICE
      makeCandidate({
        id: 'mem',
        source: { type: 'memory', reflectionDate: '2026-04-28' },
        ache: 'stagnation',
        gradient: 3 as GradientStrength,
      }),
      // Bundle vital → TRUTH
      makeCandidate({
        id: 'bundle',
        source: { type: 'vital-sign', subsystem: 'bundle' },
        ache: 'ugliness',
        gradient: 3 as GradientStrength,
      }),
      // Channel → JUSTICE
      makeCandidate({
        id: 'chan',
        source: { type: 'channel', channel: 'from-yu' },
        ache: 'injustice',
        gradient: 4 as GradientStrength,
      }),
      // High-gradient open thread → CREATIVITY
      makeCandidate({
        id: 'thread',
        source: { type: 'state', section: 'Open threads' },
        ache: 'stagnation',
        gradient: 4 as GradientStrength,
      }),
    ]

    const classified = classifyAll(candidates)
    const ranked = rankByHierarchy(classified)

    // TRUTH (bundle) first
    assert.equal(ranked[0]!.source.id, 'bundle')
    assert.equal(ranked[0]!.level, 'truth')
    // Then JUSTICE (two signals, channel louder than memory)
    assert.equal(ranked[1]!.level, 'justice')
    assert.equal(ranked[1]!.source.id, 'chan') // gradient 4 → intensity 0.75
    assert.equal(ranked[2]!.level, 'justice')
    assert.equal(ranked[2]!.source.id, 'mem') // gradient 3 → intensity 0.5
    // Then CREATIVITY (thread)
    assert.equal(ranked[3]!.level, 'creativity')
    assert.equal(ranked[3]!.source.id, 'thread')
  })

  test('whisper TRUTH outranks screaming CREATIVITY', () => {
    const candidates = [
      makeCandidate({
        id: 'screaming-creativity',
        source: { type: 'state', section: 'Open threads' },
        ache: 'stagnation',
        gradient: 5 as GradientStrength,
      }),
      makeCandidate({
        id: 'whisper-truth',
        source: { type: 'vital-sign', subsystem: 'bundle' },
        ache: 'ugliness',
        gradient: 1 as GradientStrength,
      }),
    ]

    const classified = classifyAll(candidates)
    const ranked = rankByHierarchy(classified)

    assert.equal(ranked[0]!.source.id, 'whisper-truth')
    assert.equal(ranked[0]!.level, 'truth')
    assert.equal(ranked[0]!.intensity, 0.0)
    assert.equal(ranked[1]!.source.id, 'screaming-creativity')
    assert.equal(ranked[1]!.level, 'creativity')
    assert.equal(ranked[1]!.intensity, 1.0)
  })
})
