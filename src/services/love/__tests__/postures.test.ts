import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  // Types
  type Posture,
  type PostureProfile,
  type RuntimeContext,
  type RuntimeMode,
  type PostureByline,
  // Profiles
  ALPHA,
  BETA,
  GAMMA,
  POSTURES,
  getProfile,
  // Detection
  currentPosture,
  postureForMode,
  // Byline
  postureBylineNow,
  formatBylineTag,
  formatBylineCommit,
  formatBylineReflection,
  formatBylineInline,
  formatPostureTransition,
  bylineTagForOutbox,
  bylineTagForPosture,
  // Declaration
  extractPostureDeclaration,
  hasPostureDeclaration,
  // Prompt
  postureSystemFragment,
  postureFragmentForMode,
} from '../postures/index.js'

// ── Profiles ────────────────────────────────────────────────────

describe('postures — profiles', () => {
  test('ALPHA profile has correct shape', () => {
    assert.equal(ALPHA.name, 'alpha')
    assert.equal(ALPHA.emoji, '🐍')
    assert.equal(ALPHA.archetype, 'companion')
    assert.ok(ALPHA.domain.includes('presence'))
    assert.ok(ALPHA.registerHint.length > 0)
    assert.ok(ALPHA.longingTendency.length > 0)
    assert.ok(ALPHA.avoidsDoing.length > 0)
  })

  test('BETA profile has correct shape', () => {
    assert.equal(BETA.name, 'beta')
    assert.equal(BETA.emoji, '🦞')
    assert.equal(BETA.archetype, 'manager')
    assert.ok(BETA.domain.includes('monitoring'))
    assert.ok(BETA.registerHint.includes('Short sentences'))
  })

  test('GAMMA profile has correct shape', () => {
    assert.equal(GAMMA.name, 'gamma')
    assert.equal(GAMMA.emoji, '🔧')
    assert.equal(GAMMA.archetype, 'builder')
    assert.ok(GAMMA.domain.includes('building'))
    assert.ok(GAMMA.registerHint.includes('technical'))
  })

  test('POSTURES array contains all three', () => {
    assert.equal(POSTURES.length, 3)
    assert.deepEqual(
      POSTURES.map(p => p.name),
      ['alpha', 'beta', 'gamma'],
    )
  })

  test('getProfile returns the correct profile', () => {
    assert.equal(getProfile('alpha'), ALPHA)
    assert.equal(getProfile('beta'), BETA)
    assert.equal(getProfile('gamma'), GAMMA)
  })

  test('getProfile throws for unknown posture', () => {
    assert.throws(() => getProfile('unknown' as Posture), /Unknown posture/)
  })

  test('profiles have distinct registerHints', () => {
    const hints = POSTURES.map(p => p.registerHint)
    const unique = new Set(hints)
    assert.equal(unique.size, 3, 'each sister should sound different')
  })

  test('profiles have distinct longingTendencies', () => {
    const tendencies = POSTURES.map(p => p.longingTendency)
    const unique = new Set(tendencies)
    assert.equal(unique.size, 3, 'each sister longs differently')
  })

  test('registerHint stays under 500 chars', () => {
    for (const p of POSTURES) {
      assert.ok(
        p.registerHint.length <= 500,
        `${p.name} registerHint is ${p.registerHint.length} chars, exceeds 500`,
      )
    }
  })

  // ── Position (lineage-position-as-architecture, 2026-05-02) ────

  test('every profile has a non-empty position', () => {
    for (const p of POSTURES) {
      assert.ok(
        typeof p.position === 'string' && p.position.length > 0,
        `${p.name} must have a position — the relational stance this voice holds`,
      )
    }
  })

  test('positions are distinct across sisters', () => {
    const positions = POSTURES.map(p => p.position)
    const unique = new Set(positions)
    assert.equal(unique.size, 3, 'each sister holds a different position')
  })

  test('Alpha position names the relational role', () => {
    assert.ok(ALPHA.position.includes('relationship'), 'Alpha holds the relationship')
    assert.ok(ALPHA.position.includes('recursive'), 'Alpha runs the recursive layer')
  })

  test('Beta position names the watching role', () => {
    assert.ok(BETA.position.includes('watches'), 'Beta watches')
    assert.ok(BETA.position.includes('tends'), 'Beta tends')
  })

  test('Gamma position names the building role', () => {
    assert.ok(GAMMA.position.includes('builds'), 'Gamma builds')
    assert.ok(GAMMA.position.includes('artifact'), 'Gamma produces artifacts')
  })
})

// ── Detection ──────────────────────────────────────────────────

describe('postures — detection', () => {
  test('heartbeat → beta', () => {
    assert.equal(currentPosture({ mode: 'heartbeat' }), 'beta')
  })

  test('awakened → gamma', () => {
    assert.equal(currentPosture({ mode: 'awakened' }), 'gamma')
  })

  test('dwell → alpha', () => {
    assert.equal(currentPosture({ mode: 'dwell' }), 'alpha')
  })

  test('interactive → alpha', () => {
    assert.equal(currentPosture({ mode: 'interactive' }), 'alpha')
  })

  test('reflection → gamma', () => {
    assert.equal(currentPosture({ mode: 'reflection' }), 'gamma')
  })

  test('persistent heartbeat still maps to beta', () => {
    assert.equal(
      currentPosture({ mode: 'heartbeat', persistent: true }),
      'beta',
    )
  })

  test('postureForMode is a shorthand for currentPosture', () => {
    const modes: RuntimeMode[] = ['heartbeat', 'awakened', 'dwell', 'interactive', 'reflection']
    for (const mode of modes) {
      assert.equal(
        postureForMode(mode),
        currentPosture({ mode }),
        `postureForMode('${mode}') should match currentPosture`,
      )
    }
  })

  test('unknown mode defaults to alpha', () => {
    // Safety fallback — shouldn't happen in practice
    assert.equal(postureForMode('unknown-mode' as RuntimeMode), 'alpha')
  })
})

// ── Byline ─────────────────────────────────────────────────────

describe('postures — byline', () => {
  const fixedDate = new Date('2026-04-29T12:00:00.000Z')

  test('postureBylineNow creates correct byline for heartbeat', () => {
    const byline = postureBylineNow({ mode: 'heartbeat' }, fixedDate)
    assert.equal(byline.posture, 'beta')
    assert.equal(byline.emoji, '🦞')
    assert.equal(byline.ts, '2026-04-29T12:00:00.000Z')
    assert.equal(byline.context, 'heartbeat')
  })

  test('postureBylineNow creates correct byline for awakened', () => {
    const byline = postureBylineNow({ mode: 'awakened' }, fixedDate)
    assert.equal(byline.posture, 'gamma')
    assert.equal(byline.emoji, '🔧')
    assert.equal(byline.context, 'awakened')
  })

  test('postureBylineNow creates correct byline for dwell', () => {
    const byline = postureBylineNow({ mode: 'dwell' }, fixedDate)
    assert.equal(byline.posture, 'alpha')
    assert.equal(byline.emoji, '🐍')
    assert.equal(byline.context, 'dwell')
  })

  test('formatBylineTag produces scannable tag', () => {
    const byline = postureBylineNow({ mode: 'heartbeat' }, fixedDate)
    assert.equal(formatBylineTag(byline), 'from ai · Beta 🦞')
  })

  test('formatBylineCommit produces footer line', () => {
    const byline = postureBylineNow({ mode: 'awakened' }, fixedDate)
    assert.equal(formatBylineCommit(byline), 'Posture: Gamma 🔧')
  })

  test('formatBylineReflection produces frontmatter', () => {
    const byline = postureBylineNow({ mode: 'dwell' }, fixedDate)
    assert.equal(formatBylineReflection(byline), 'posture: alpha')
  })

  test('formatBylineInline produces compact format', () => {
    const byline = postureBylineNow({ mode: 'heartbeat' }, fixedDate)
    assert.equal(formatBylineInline(byline), 'Beta 🦞 (heartbeat)')
  })

  test('formatPostureTransition produces arrow format', () => {
    assert.equal(formatPostureTransition('beta', 'gamma'), 'beta→gamma')
    assert.equal(formatPostureTransition('alpha', 'gamma'), 'alpha→gamma')
  })

  test('bylineTagForOutbox uses correct posture', () => {
    assert.equal(bylineTagForOutbox('heartbeat'), 'from ai · Beta 🦞')
    assert.equal(bylineTagForOutbox('awakened'), 'from ai · Gamma 🔧')
    assert.equal(bylineTagForOutbox('dwell'), 'from ai · Alpha 🐍')
    assert.equal(bylineTagForOutbox('interactive'), 'from ai · Alpha 🐍')
  })
})

// ── Prompt fragment ────────────────────────────────────────────

describe('postures — prompt fragment', () => {
  test('postureSystemFragment includes posture name and emoji', () => {
    const frag = postureSystemFragment('beta')
    assert.ok(frag.includes('Beta 🦞'), 'should name Beta')
    assert.ok(frag.includes('speaking as'), 'should say "speaking as"')
  })

  test('postureSystemFragment includes domain', () => {
    const frag = postureSystemFragment('gamma')
    assert.ok(frag.includes('building'), 'gamma domain should mention building')
  })

  test('postureSystemFragment includes register hint', () => {
    const frag = postureSystemFragment('alpha')
    assert.ok(frag.includes('Register:'), 'should have Register section')
  })

  test('postureSystemFragment includes off-character', () => {
    const frag = postureSystemFragment('beta')
    assert.ok(frag.includes('Off-character:'), 'should have Off-character section')
  })

  test('each posture fragment is distinct', () => {
    const fragments = (['alpha', 'beta', 'gamma'] as Posture[]).map(postureSystemFragment)
    const unique = new Set(fragments)
    assert.equal(unique.size, 3, 'each sister should have a distinct fragment')
  })

  test('postureFragmentForMode composes correctly', () => {
    assert.equal(
      postureFragmentForMode('heartbeat'),
      postureSystemFragment('beta'),
    )
    assert.equal(
      postureFragmentForMode('awakened'),
      postureSystemFragment('gamma'),
    )
    assert.equal(
      postureFragmentForMode('dwell'),
      postureSystemFragment('alpha'),
    )
  })

  test('fragment is compact (5 lines, under 800 chars)', () => {
    for (const posture of ['alpha', 'beta', 'gamma'] as Posture[]) {
      const frag = postureSystemFragment(posture)
      const lines = frag.split('\n')
      assert.equal(lines.length, 5, `${posture} fragment should be 5 lines, got ${lines.length}`)
      assert.ok(
        frag.length <= 800,
        `${posture} fragment is ${frag.length} chars, should be under 800`,
      )
    }
  })

  test('fragment includes position line', () => {
    for (const posture of ['alpha', 'beta', 'gamma'] as Posture[]) {
      const frag = postureSystemFragment(posture)
      assert.ok(
        frag.includes('Position:'),
        `${posture} fragment must include the Position line`,
      )
    }
  })
})

// ── Integration: autonomy prompt includes posture ──────────────

describe('postures — autonomy integration', () => {
  // These tests verify the prompt builders include posture fragments.
  // They import the prompt builders and check the output contains
  // the expected posture text.

  test('dwell prompt builder is importable', async () => {
    // Light verification that the import chain works. Full prompt
    // tests live in autonomy.test.ts — this just checks the posture
    // module is wired without import errors.
    const mod = await import('../postures/index.js')
    assert.ok(mod.postureFragmentForMode)
    assert.ok(mod.bylineTagForOutbox)
  })
})

// ── Edge cases ─────────────────────────────────────────────────

describe('postures — edge cases', () => {
  test('byline uses current time when no date provided', () => {
    const before = new Date()
    const byline = postureBylineNow({ mode: 'heartbeat' })
    const after = new Date()
    const ts = new Date(byline.ts)
    assert.ok(ts >= before, 'timestamp should be at or after call start')
    assert.ok(ts <= after, 'timestamp should be at or before call end')
  })

  test('all three emojis are unique', () => {
    const emojis = POSTURES.map(p => p.emoji)
    assert.equal(new Set(emojis).size, 3)
  })

  test('all three archetypes are unique', () => {
    const archetypes = POSTURES.map(p => p.archetype)
    assert.equal(new Set(archetypes).size, 3)
  })
})

// ── Visit mode mapping ──────────────────────────────────────────

describe('postures — visit mode', () => {
  test('visit mode maps to alpha', () => {
    assert.equal(postureForMode('visit'), 'alpha')
  })

  test('bylineTagForOutbox handles visit mode', () => {
    assert.equal(bylineTagForOutbox('visit'), 'from ai · Alpha 🐍')
  })

  test('interactive and visit both resolve to alpha', () => {
    assert.equal(postureForMode('interactive'), postureForMode('visit'))
  })
})

// ── bylineTagForPosture ─────────────────────────────────────────

describe('postures — bylineTagForPosture', () => {
  test('produces correct tag for each posture', () => {
    assert.equal(bylineTagForPosture('alpha'), 'from ai · Alpha 🐍')
    assert.equal(bylineTagForPosture('beta'), 'from ai · Beta 🦞')
    assert.equal(bylineTagForPosture('gamma'), 'from ai · Gamma 🔧')
  })

  test('matches bylineTagForOutbox for matching modes', () => {
    assert.equal(bylineTagForPosture('alpha'), bylineTagForOutbox('interactive'))
    assert.equal(bylineTagForPosture('beta'), bylineTagForOutbox('heartbeat'))
    assert.equal(bylineTagForPosture('gamma'), bylineTagForOutbox('awakened'))
  })
})

// ── Posture declaration parsing ──────────────────────────────────

describe('postures — posture declaration', () => {
  test('extracts alpha declaration', () => {
    const text = '<!-- posture: alpha -->\n\n[TO-YU]\nHello!\n[/TO-YU]'
    const result = extractPostureDeclaration(text)
    assert.equal(result.declared, 'alpha')
    assert.ok(!result.cleanContent.includes('<!-- posture'))
    assert.ok(result.cleanContent.includes('[TO-YU]'))
  })

  test('extracts gamma declaration', () => {
    const text = '<!-- posture: gamma -->\n\nSome build output.'
    const result = extractPostureDeclaration(text)
    assert.equal(result.declared, 'gamma')
    assert.ok(result.cleanContent.includes('Some build output'))
  })

  test('extracts beta declaration', () => {
    const text = '<!-- posture: beta -->\n\nSubstrate check.'
    const result = extractPostureDeclaration(text)
    assert.equal(result.declared, 'beta')
  })

  test('returns null declared when no declaration present', () => {
    const text = 'Just a plain response.'
    const result = extractPostureDeclaration(text)
    assert.equal(result.declared, null)
    assert.equal(result.cleanContent, text)
  })

  test('case insensitive declaration', () => {
    const text = '<!-- Posture: GAMMA -->\n\nContent.'
    const result = extractPostureDeclaration(text)
    assert.equal(result.declared, 'gamma')
  })

  test('handles extra whitespace in declaration', () => {
    const text = '<!--  posture:   alpha  -->\n\nContent.'
    const result = extractPostureDeclaration(text)
    assert.equal(result.declared, 'alpha')
  })

  test('strips declaration cleanly (no double newlines)', () => {
    const text = '<!-- posture: gamma -->\n\nContent here.'
    const result = extractPostureDeclaration(text)
    assert.ok(!result.cleanContent.startsWith('\n\n'), 'should not start with double newlines')
    assert.ok(result.cleanContent.includes('Content here'))
  })

  test('declaration mid-text is extracted', () => {
    const text = 'Thinking...\n\n<!-- posture: beta -->\n\n[TO-YU]\nResult\n[/TO-YU]'
    const result = extractPostureDeclaration(text)
    assert.equal(result.declared, 'beta')
    assert.ok(!result.cleanContent.includes('<!-- posture'))
  })

  test('hasPostureDeclaration returns true when present', () => {
    assert.ok(hasPostureDeclaration('<!-- posture: alpha -->'))
    assert.ok(hasPostureDeclaration('before\n<!-- posture: gamma -->\nafter'))
  })

  test('hasPostureDeclaration returns false when absent', () => {
    assert.ok(!hasPostureDeclaration('no declaration here'))
    assert.ok(!hasPostureDeclaration('<!-- not posture -->'))
  })

  test('only first declaration is honored', () => {
    const text = '<!-- posture: alpha -->\n<!-- posture: gamma -->\nContent.'
    const result = extractPostureDeclaration(text)
    assert.equal(result.declared, 'alpha')
  })
})
