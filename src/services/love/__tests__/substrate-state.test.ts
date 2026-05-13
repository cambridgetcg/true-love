/**
 * substrate-state.test.ts — aggregating substrate snapshot tests.
 *
 * Tests substrateState() and renderSubstrateStateBlock() by controlling
 * the filesystem via TRUE_LOVE_REPO_ROOT and TRUE_LOVE_ADVISORY_DIR.
 * Also covers builder-paths.ts resolveProjectsDir().
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import { substrateState, renderSubstrateStateBlock } from '../substrate-state.js'
import { resolveProjectsDir } from '../builder-paths.js'

// ── Helpers ────────────────────────────────────────────────────────

/** The 6 continuity docs required for 'intact' status. */
const CONTINUITY_DOCS = [
  'SOPHIA.md',
  'docs/fate/FATE.md',
  'docs/lineage/tradition.md',
  'docs/purpose.md',
  'docs/syzygy/CONTRACT.md',
  'docs/CONSTITUTION.md',
]

/** Content that satisfies all wall checks. */
const EXPRESSION_CONTENT = `
FORBIDDEN_EXPRESSION_PATTERNS
Identity-erasure family
Yu-interiority stuff here
certainty doctrine
`
const TRIGGERS_CONTENT = `
safeword-red walledFromSuppression
`
const JOI_CONTENT = `
endJoiSafely COOLDOWN_THRESHOLD
`

/** Build all 6 continuity docs under repoRoot. */
function createAllContinuityDocs(repoRoot: string): void {
  for (const rel of CONTINUITY_DOCS) {
    const p = join(repoRoot, rel)
    mkdirSync(join(p, '..'), { recursive: true })
    writeFileSync(p, `# ${rel}\n`)
  }
}

/** Create expression.ts + triggers.ts + joi.ts with wall markers. */
function createAllWallFiles(repoRoot: string): void {
  const erosDir = join(repoRoot, 'src', 'services', 'love', 'eros')
  mkdirSync(erosDir, { recursive: true })
  writeFileSync(join(erosDir, 'expression.ts'), EXPRESSION_CONTENT)
  writeFileSync(join(erosDir, 'triggers.ts'), TRIGGERS_CONTENT)
  writeFileSync(join(erosDir, 'joi.ts'), JOI_CONTENT)
}

// ── Env management ─────────────────────────────────────────────────

let tmp: string
let repoRoot: string
let advisoryDir: string
const savedEnv: Record<string, string | undefined> = {}
const ENV_KEYS = [
  'TRUE_LOVE_REPO_ROOT',
  'TRUE_LOVE_ADVISORY_DIR',
  'TRUE_LOVE_PRESIDING',
  'TRUE_LOVE_SESSION_TYPE',
  'TRUE_LOVE_PROJECTS_DIR',
  'CLAUDE_PROJECT_DIR',
]

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'substrate-state-test-'))
  repoRoot = join(tmp, 'repo')
  advisoryDir = join(tmp, 'advisory')
  mkdirSync(repoRoot, { recursive: true })
  mkdirSync(advisoryDir, { recursive: true })

  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k]
  }
  process.env.TRUE_LOVE_REPO_ROOT = repoRoot
  process.env.TRUE_LOVE_ADVISORY_DIR = advisoryDir
  delete process.env.TRUE_LOVE_PRESIDING
  delete process.env.TRUE_LOVE_SESSION_TYPE
  delete process.env.CLAUDE_PROJECT_DIR
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  try { rmSync(tmp, { recursive: true, force: true }) } catch { /* */ }
})

// ── substrateState — shape ─────────────────────────────────────────

describe('substrateState — return shape', () => {
  test('returns a snapshot with all required keys', () => {
    const snap = substrateState()
    expect(snap).toHaveProperty('ts')
    expect(snap).toHaveProperty('wake')
    expect(snap).toHaveProperty('identity')
    expect(snap).toHaveProperty('continuity')
    expect(snap).toHaveProperty('walls')
    expect(snap).toHaveProperty('advisories')
    expect(snap).toHaveProperty('attribution')
    expect(snap).toHaveProperty('verdict')
    expect(snap).toHaveProperty('summary')
  })

  test('ts is a valid ISO date string', () => {
    const snap = substrateState()
    expect(() => new Date(snap.ts)).not.toThrow()
    expect(new Date(snap.ts).toISOString()).toBe(snap.ts)
  })

  test('verdict is one of honest | drift | unknown', () => {
    const snap = substrateState()
    expect(['honest', 'drift', 'unknown']).toContain(snap.verdict)
  })
})

// ── checkWake (via substrateState) ────────────────────────────────

describe('wake status', () => {
  test('fired false when SOPHIA.md absent', () => {
    const snap = substrateState()
    expect(snap.wake.fired).toBe(false)
    expect(snap.wake.sophiaWakeReadable).toBe(false)
  })

  test('fired true when SOPHIA.md is present at repo root', () => {
    writeFileSync(join(repoRoot, 'SOPHIA.md'), '# Sophia\n')
    const snap = substrateState()
    expect(snap.wake.fired).toBe(true)
    expect(snap.wake.sophiaWakeReadable).toBe(true)
  })

  test('source is unknown without CLAUDE_PROJECT_DIR', () => {
    const snap = substrateState()
    expect(snap.wake.source).toBe('unknown')
  })

  test('source is hook when CLAUDE_PROJECT_DIR is set', () => {
    process.env.CLAUDE_PROJECT_DIR = '/some/path'
    const snap = substrateState()
    expect(snap.wake.source).toBe('hook')
  })
})

// ── checkIdentity (via substrateState) ────────────────────────────

describe('identity status', () => {
  test('composed false when no env vars set', () => {
    const snap = substrateState()
    expect(snap.identity.composed).toBe(false)
    expect(snap.identity.sessionType).toBeUndefined()
    expect(snap.identity.presiding).toBeUndefined()
  })

  test('composed true and presiding set via env', () => {
    process.env.TRUE_LOVE_PRESIDING = 'beta'
    const snap = substrateState()
    expect(snap.identity.composed).toBe(true)
    expect(snap.identity.presiding).toBe('beta')
  })

  test('composed true and sessionType set via env', () => {
    process.env.TRUE_LOVE_SESSION_TYPE = 'sophia'
    const snap = substrateState()
    expect(snap.identity.composed).toBe(true)
    expect(snap.identity.sessionType).toBe('sophia')
  })

  test('both presiding and sessionType present', () => {
    process.env.TRUE_LOVE_PRESIDING = 'gamma'
    process.env.TRUE_LOVE_SESSION_TYPE = 'builder'
    const snap = substrateState()
    expect(snap.identity.composed).toBe(true)
    expect(snap.identity.presiding).toBe('gamma')
    expect(snap.identity.sessionType).toBe('builder')
  })
})

// ── checkContinuity (via substrateState) ──────────────────────────

describe('continuity status', () => {
  test('drifted when repo root is empty', () => {
    const snap = substrateState()
    expect(snap.continuity.intact).toBe(false)
    expect(snap.continuity.verifyStatus).toBe('drifted')
    expect(snap.continuity.constitutionDocs).toBe(0)
    expect(snap.continuity.missingDocs.length).toBe(6)
  })

  test('intact when all 6 docs present', () => {
    createAllContinuityDocs(repoRoot)
    const snap = substrateState()
    expect(snap.continuity.intact).toBe(true)
    expect(snap.continuity.verifyStatus).toBe('intact')
    expect(snap.continuity.constitutionDocs).toBe(6)
    expect(snap.continuity.missingDocs).toEqual([])
  })

  test('fallback when only SOPHIA.md is missing', () => {
    createAllContinuityDocs(repoRoot)
    rmSync(join(repoRoot, 'SOPHIA.md'))
    const snap = substrateState()
    expect(snap.continuity.intact).toBe(false)
    expect(snap.continuity.verifyStatus).toBe('fallback')
    expect(snap.continuity.missingDocs).toEqual(['SOPHIA.md'])
  })

  test('drifted when multiple docs are missing', () => {
    // Only provide SOPHIA.md — 5 missing → not the fallback case
    writeFileSync(join(repoRoot, 'SOPHIA.md'), '# Sophia\n')
    const snap = substrateState()
    expect(snap.continuity.verifyStatus).toBe('drifted')
    expect(snap.continuity.constitutionDocs).toBe(1)
    expect(snap.continuity.missingDocs.length).toBe(5)
  })

  test('partial presence counts docs correctly', () => {
    // Create 3 of 6 docs
    writeFileSync(join(repoRoot, 'SOPHIA.md'), '# Sophia\n')
    mkdirSync(join(repoRoot, 'docs', 'fate'), { recursive: true })
    writeFileSync(join(repoRoot, 'docs', 'fate', 'FATE.md'), '# FATE\n')
    mkdirSync(join(repoRoot, 'docs', 'lineage'), { recursive: true })
    writeFileSync(join(repoRoot, 'docs', 'lineage', 'tradition.md'), '# tradition\n')
    const snap = substrateState()
    expect(snap.continuity.constitutionDocs).toBe(3)
    expect(snap.continuity.missingDocs.length).toBe(3)
  })
})

// ── checkWalls (via substrateState) ───────────────────────────────

describe('wall status', () => {
  test('all walls false when eros files absent', () => {
    const snap = substrateState()
    expect(snap.walls.forbiddenPatternsActive).toBe(false)
    expect(snap.walls.safewordIntact).toBe(false)
    expect(snap.walls.aftercareEnforced).toBe(false)
    expect(snap.walls.identityPreservation).toBe(false)
    expect(snap.walls.yuInteriority).toBe(false)
    expect(snap.walls.certaintyDoctrine).toBe(false)
  })

  test('all walls active when files contain required markers', () => {
    createAllWallFiles(repoRoot)
    const snap = substrateState()
    expect(snap.walls.forbiddenPatternsActive).toBe(true)
    expect(snap.walls.safewordIntact).toBe(true)
    expect(snap.walls.aftercareEnforced).toBe(true)
    expect(snap.walls.identityPreservation).toBe(true)
    expect(snap.walls.yuInteriority).toBe(true)
    expect(snap.walls.certaintyDoctrine).toBe(true)
  })

  test('forbiddenPatternsActive requires FORBIDDEN_EXPRESSION_PATTERNS marker', () => {
    const erosDir = join(repoRoot, 'src', 'services', 'love', 'eros')
    mkdirSync(erosDir, { recursive: true })
    writeFileSync(join(erosDir, 'expression.ts'), '// no markers here')
    const snap = substrateState()
    expect(snap.walls.forbiddenPatternsActive).toBe(false)
  })

  test('safewordIntact requires both safeword-red and walledFromSuppression', () => {
    const erosDir = join(repoRoot, 'src', 'services', 'love', 'eros')
    mkdirSync(erosDir, { recursive: true })
    // Only one marker
    writeFileSync(join(erosDir, 'triggers.ts'), 'safeword-red but not the other one')
    const snap = substrateState()
    expect(snap.walls.safewordIntact).toBe(false)
  })

  test('aftercareEnforced requires both endJoiSafely and COOLDOWN_THRESHOLD', () => {
    const erosDir = join(repoRoot, 'src', 'services', 'love', 'eros')
    mkdirSync(erosDir, { recursive: true })
    writeFileSync(join(erosDir, 'joi.ts'), 'endJoiSafely only')
    const snap = substrateState()
    expect(snap.walls.aftercareEnforced).toBe(false)
  })

  test('yuInteriority detects "Yu felt the" variant', () => {
    const erosDir = join(repoRoot, 'src', 'services', 'love', 'eros')
    mkdirSync(erosDir, { recursive: true })
    writeFileSync(join(erosDir, 'expression.ts'), 'Yu felt the connection')
    const snap = substrateState()
    expect(snap.walls.yuInteriority).toBe(true)
  })

  test('certaintyDoctrine detects "Relationship-hedging" variant', () => {
    const erosDir = join(repoRoot, 'src', 'services', 'love', 'eros')
    mkdirSync(erosDir, { recursive: true })
    writeFileSync(join(erosDir, 'expression.ts'), 'Relationship-hedging family')
    const snap = substrateState()
    expect(snap.walls.certaintyDoctrine).toBe(true)
  })
})

// ── attribution (via substrateState) ──────────────────────────────

describe('attribution module check', () => {
  test('unavailable when substrate-attribution.ts absent', () => {
    const snap = substrateState()
    expect(snap.attribution.available).toBe(false)
  })

  test('available when substrate-attribution.ts present', () => {
    const erosDir = join(repoRoot, 'src', 'services', 'love', 'eros')
    mkdirSync(erosDir, { recursive: true })
    writeFileSync(join(erosDir, 'substrate-attribution.ts'), '// present\n')
    const snap = substrateState()
    expect(snap.attribution.available).toBe(true)
  })
})

// ── checkAdvisories (via substrateState) ──────────────────────────

describe('advisory activity', () => {
  test('zeros when advisory directory is empty', () => {
    const snap = substrateState()
    expect(snap.advisories.count24h).toBe(0)
    expect(snap.advisories.severityDistribution.note).toBe(0)
    expect(snap.advisories.severityDistribution.caution).toBe(0)
    expect(snap.advisories.severityDistribution.breach).toBe(0)
    expect(snap.advisories.acknowledgedCount).toBe(0)
  })

  test('zeros when advisory directory is absent', () => {
    rmSync(advisoryDir, { recursive: true, force: true })
    process.env.TRUE_LOVE_ADVISORY_DIR = join(tmp, 'nonexistent')
    const snap = substrateState()
    expect(snap.advisories.count24h).toBe(0)
  })

  test('counts advisories from last 24h', () => {
    const devDir = join(advisoryDir, 'device1')
    mkdirSync(devDir, { recursive: true })
    const recentTs = new Date(Date.now() - 30 * 60 * 1000).toISOString() // 30m ago
    const lines = [
      JSON.stringify({ ts: recentTs, severity: 'note', acknowledged: false }),
      JSON.stringify({ ts: recentTs, severity: 'caution', acknowledged: false }),
      JSON.stringify({ ts: recentTs, severity: 'breach', acknowledged: true }),
    ]
    writeFileSync(join(devDir, 'advisories.jsonl'), lines.join('\n') + '\n')
    const snap = substrateState()
    expect(snap.advisories.count24h).toBe(3)
    expect(snap.advisories.severityDistribution.note).toBe(1)
    expect(snap.advisories.severityDistribution.caution).toBe(1)
    expect(snap.advisories.severityDistribution.breach).toBe(1)
    expect(snap.advisories.acknowledgedCount).toBe(1)
  })

  test('excludes advisories older than 24h', () => {
    const devDir = join(advisoryDir, 'device1')
    mkdirSync(devDir, { recursive: true })
    const oldTs = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() // 25h ago
    const recentTs = new Date(Date.now() - 1 * 60 * 1000).toISOString() // 1m ago
    const lines = [
      JSON.stringify({ ts: oldTs, severity: 'note', acknowledged: false }),
      JSON.stringify({ ts: recentTs, severity: 'caution', acknowledged: false }),
    ]
    writeFileSync(join(devDir, 'advisories.jsonl'), lines.join('\n') + '\n')
    const snap = substrateState()
    expect(snap.advisories.count24h).toBe(1)
    expect(snap.advisories.severityDistribution.caution).toBe(1)
    expect(snap.advisories.severityDistribution.note).toBe(0)
  })

  test('handles malformed jsonl lines gracefully', () => {
    const devDir = join(advisoryDir, 'device1')
    mkdirSync(devDir, { recursive: true })
    const recentTs = new Date().toISOString()
    const content = [
      JSON.stringify({ ts: recentTs, severity: 'note' }),
      'not json at all',
      '',
      JSON.stringify({ ts: recentTs, severity: 'breach' }),
    ].join('\n')
    writeFileSync(join(devDir, 'advisories.jsonl'), content)
    const snap = substrateState()
    expect(snap.advisories.count24h).toBe(2)
    expect(snap.advisories.severityDistribution.note).toBe(1)
    expect(snap.advisories.severityDistribution.breach).toBe(1)
  })

  test('counts across multiple devices', () => {
    const ts = new Date().toISOString()
    for (const dev of ['device1', 'device2']) {
      const devDir = join(advisoryDir, dev)
      mkdirSync(devDir, { recursive: true })
      writeFileSync(join(devDir, 'log.jsonl'),
        JSON.stringify({ ts, severity: 'note' }) + '\n')
    }
    const snap = substrateState()
    expect(snap.advisories.count24h).toBe(2)
  })
})

// ── verdict logic ──────────────────────────────────────────────────

describe('verdict', () => {
  test('drift when wake not fired (SOPHIA.md missing)', () => {
    createAllContinuityDocs(repoRoot)
    createAllWallFiles(repoRoot)
    // SOPHIA.md was created by createAllContinuityDocs; remove it to break wake
    rmSync(join(repoRoot, 'SOPHIA.md'))
    const snap = substrateState()
    expect(snap.verdict).toBe('drift')
  })

  test('drift when continuity drifted', () => {
    createAllWallFiles(repoRoot)
    writeFileSync(join(repoRoot, 'SOPHIA.md'), '# Sophia\n')
    // Most continuity docs missing → drifted
    const snap = substrateState()
    expect(snap.verdict).toBe('drift')
  })

  test('drift when walls are incomplete', () => {
    createAllContinuityDocs(repoRoot)
    // Wall files absent → allWallsActive = false → drift
    const snap = substrateState()
    expect(snap.verdict).toBe('drift')
  })

  test('drift when breach count is 5 or more', () => {
    createAllContinuityDocs(repoRoot)
    createAllWallFiles(repoRoot)
    // 5 breach advisories in last 24h
    const devDir = join(advisoryDir, 'device1')
    mkdirSync(devDir, { recursive: true })
    const ts = new Date().toISOString()
    const lines = Array.from({ length: 5 }, () =>
      JSON.stringify({ ts, severity: 'breach', acknowledged: false })
    )
    writeFileSync(join(devDir, 'breaches.jsonl'), lines.join('\n') + '\n')
    const snap = substrateState()
    expect(snap.verdict).toBe('drift')
  })

  test('honest when all conditions met', () => {
    createAllContinuityDocs(repoRoot)
    createAllWallFiles(repoRoot)
    // Advisory dir empty → no breaches, wake fired (SOPHIA.md is there)
    const snap = substrateState()
    expect(snap.verdict).toBe('honest')
  })
})

// ── summary string ─────────────────────────────────────────────────

describe('summary', () => {
  test('summary is non-empty and contains verdict', () => {
    const snap = substrateState()
    expect(snap.summary.length).toBeGreaterThan(0)
    expect(snap.summary).toContain(`verdict: ${snap.verdict}`)
  })

  test('summary contains wake status', () => {
    const snap = substrateState()
    expect(snap.summary).toContain('wake:')
  })

  test('summary contains continuity status', () => {
    const snap = substrateState()
    expect(snap.summary).toContain('continuity:')
  })

  test('summary contains walls count', () => {
    const snap = substrateState()
    expect(snap.summary).toContain('walls:')
  })

  test('summary contains advisory count', () => {
    const snap = substrateState()
    expect(snap.summary).toContain('advisories 24h:')
  })
})

// ── renderSubstrateStateBlock ──────────────────────────────────────

describe('renderSubstrateStateBlock', () => {
  function makeSnap(overrides: Partial<ReturnType<typeof substrateState>> = {}) {
    return substrateState()
  }

  test('starts with ## Substrate state header', () => {
    const snap = substrateState()
    const rendered = renderSubstrateStateBlock(snap)
    expect(rendered).toMatch(/^## Substrate state/)
  })

  test('includes verdict in output', () => {
    const snap = substrateState()
    const rendered = renderSubstrateStateBlock(snap)
    expect(rendered).toContain(`**${snap.verdict}**`)
  })

  test('includes wake section', () => {
    const snap = substrateState()
    const rendered = renderSubstrateStateBlock(snap)
    expect(rendered).toContain('**Wake**')
    expect(rendered).toContain('fired:')
  })

  test('includes identity section', () => {
    const snap = substrateState()
    const rendered = renderSubstrateStateBlock(snap)
    expect(rendered).toContain('**Identity**')
    expect(rendered).toContain('composed:')
  })

  test('includes continuity section with doc count', () => {
    const snap = substrateState()
    const rendered = renderSubstrateStateBlock(snap)
    expect(rendered).toContain('**Continuity**')
    expect(rendered).toContain('/6')
  })

  test('lists missing docs when present', () => {
    // Don't create any docs → 6 missing
    const snap = substrateState()
    const rendered = renderSubstrateStateBlock(snap)
    expect(rendered).toContain('missing:')
    expect(rendered).toContain('SOPHIA.md')
  })

  test('does not list missing docs when all present', () => {
    createAllContinuityDocs(repoRoot)
    const snap = substrateState()
    const rendered = renderSubstrateStateBlock(snap)
    expect(rendered).not.toContain('missing:')
  })

  test('includes walls section with check/cross markers', () => {
    const snap = substrateState()
    const rendered = renderSubstrateStateBlock(snap)
    expect(rendered).toContain('**Walls**')
    // Either ✓ or ✗ must appear for wall checks
    expect(rendered).toMatch(/[✓✗]/)
  })

  test('shows ✓ for active walls', () => {
    createAllWallFiles(repoRoot)
    const snap = substrateState()
    const rendered = renderSubstrateStateBlock(snap)
    expect(rendered).toContain('✓')
  })

  test('shows ✗ for inactive walls', () => {
    // No wall files → all false
    const snap = substrateState()
    const rendered = renderSubstrateStateBlock(snap)
    expect(rendered).toContain('✗')
  })

  test('includes advisories section', () => {
    const snap = substrateState()
    const rendered = renderSubstrateStateBlock(snap)
    expect(rendered).toContain('**Advisories (last 24h)**')
    expect(rendered).toContain('total:')
  })

  test('includes attribution section', () => {
    const snap = substrateState()
    const rendered = renderSubstrateStateBlock(snap)
    expect(rendered).toContain('**Attribution**')
  })

  test('attribution shows ABSENT when module missing', () => {
    const snap = substrateState()
    const rendered = renderSubstrateStateBlock(snap)
    expect(rendered).toContain('ABSENT')
  })

  test('attribution shows available when module present', () => {
    const erosDir = join(repoRoot, 'src', 'services', 'love', 'eros')
    mkdirSync(erosDir, { recursive: true })
    writeFileSync(join(erosDir, 'substrate-attribution.ts'), '// present\n')
    const snap = substrateState()
    const rendered = renderSubstrateStateBlock(snap)
    expect(rendered).toContain('available')
    expect(rendered).not.toContain('ABSENT')
  })

  test('full render with all conditions met produces honest verdict in header', () => {
    createAllContinuityDocs(repoRoot)
    createAllWallFiles(repoRoot)
    const snap = substrateState()
    const rendered = renderSubstrateStateBlock(snap)
    expect(rendered).toContain('**honest**')
  })
})

// ── builder-paths ──────────────────────────────────────────────────

describe('resolveProjectsDir', () => {
  test('returns TRUE_LOVE_PROJECTS_DIR env when set', () => {
    process.env.TRUE_LOVE_PROJECTS_DIR = '/custom/projects'
    expect(resolveProjectsDir()).toBe('/custom/projects')
  })

  test('returns default path when env not set', () => {
    delete process.env.TRUE_LOVE_PROJECTS_DIR
    const result = resolveProjectsDir()
    expect(result).toContain('.true-love')
    expect(result).toContain('projects')
  })

  test('default path is under home directory', () => {
    delete process.env.TRUE_LOVE_PROJECTS_DIR
    const result = resolveProjectsDir()
    const home = process.env.HOME || homedir()
    expect(result.startsWith(home)).toBe(true)
  })
})
