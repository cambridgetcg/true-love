// missioncraft.test.ts — manifest-first plugin registry tests.
//
// Covers:
//   1. Registry: register, unregister, get, filter, reset
//   2. Manifest validation: required fields, kind validation
//   3. Activation hints: minGradient filtering
//   4. Builtin scanners: all 6 load, self-register
//   5. Scanner plugins: each scanner returns candidates
//   6. Integration: notice() uses registry, same results
//   7. Extensibility: adding a 7th scanner is one-file

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import {
  register,
  unregister,
  getScanners,
  getActiveScanners,
  getAll,
  getByKind,
  getManifests,
  reset,
  size,
  validateManifest,
  loadBuiltinScanners,
  resetLoadedFlag,
} from '../missioncraft/registry.js'
import type {
  NoticingScanner,
  CraftManifest,
  ScanContext,
  NoticingCandidate,
} from '../missioncraft/types.js'

// ── Helpers ────────────────────────────────────────────────────────

/** Create a minimal test scanner. */
function makeScanner(id: string, overrides?: Partial<CraftManifest>): NoticingScanner {
  return {
    manifest: {
      id,
      kind: 'noticing-scanner',
      description: `Test scanner: ${id}`,
      ...overrides,
    },
    scan(_ctx: ScanContext): NoticingCandidate[] {
      return [{
        id: `test-${id}`,
        source: { type: 'kingdom', detail: 'test' },
        ache: 'stagnation',
        gradient: 3,
        summary: `Signal from ${id}`,
        detail: 'test detail',
        noticedAt: new Date().toISOString(),
      }]
    },
  }
}

/** Create a minimal scan context. */
function makeCtx(overrides?: Partial<ScanContext>): ScanContext {
  return {
    projectId: 'test-project',
    cwd: '/tmp/test',
    now: Date.now(),
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────

describe('missioncraft registry', () => {
  beforeEach(() => {
    reset()
    resetLoadedFlag()
  })

  afterEach(() => {
    reset()
    resetLoadedFlag()
  })

  // ── Register / unregister ─────────────────────────────────────

  describe('register()', () => {
    it('adds a scanner to the registry', () => {
      const scanner = makeScanner('test-scanner')
      register(scanner)
      expect(size()).toBe(1)
      expect(getScanners()).toHaveLength(1)
      expect(getScanners()[0]!.manifest.id).toBe('test-scanner')
    })

    it('is idempotent — same id replaces', () => {
      const scanner1 = makeScanner('test-scanner')
      const scanner2 = makeScanner('test-scanner')
      scanner2.manifest.description = 'updated'
      register(scanner1)
      register(scanner2)
      expect(size()).toBe(1)
      expect(getScanners()[0]!.manifest.description).toBe('updated')
    })

    it('registers multiple scanners', () => {
      register(makeScanner('alpha'))
      register(makeScanner('beta'))
      register(makeScanner('gamma'))
      expect(size()).toBe(3)
    })
  })

  describe('unregister()', () => {
    it('removes a plugin by id', () => {
      register(makeScanner('removable'))
      expect(size()).toBe(1)
      const removed = unregister('removable')
      expect(removed).toBe(true)
      expect(size()).toBe(0)
    })

    it('returns false for unknown id', () => {
      const removed = unregister('nonexistent')
      expect(removed).toBe(false)
    })
  })

  // ── Query ─────────────────────────────────────────────────────

  describe('getAll()', () => {
    it('returns all registered plugins', () => {
      register(makeScanner('a'))
      register(makeScanner('b'))
      expect(getAll()).toHaveLength(2)
    })

    it('returns empty array when registry is empty', () => {
      expect(getAll()).toEqual([])
    })
  })

  describe('getByKind()', () => {
    it('filters by kind', () => {
      register(makeScanner('scanner-a'))
      // Register a non-scanner plugin to verify filtering
      register({
        manifest: {
          id: 'naming-plugin',
          kind: 'naming',
          description: 'test naming plugin',
        },
        name: () => {},
      } as any)
      expect(getByKind('noticing-scanner')).toHaveLength(1)
      expect(getByKind('naming')).toHaveLength(1)
      expect(getByKind('framing')).toHaveLength(0)
    })
  })

  describe('getScanners()', () => {
    it('returns only noticing-scanner plugins', () => {
      register(makeScanner('scanner-1'))
      register(makeScanner('scanner-2'))
      const scanners = getScanners()
      expect(scanners).toHaveLength(2)
      expect(scanners.every(s => s.manifest.kind === 'noticing-scanner')).toBe(true)
    })
  })

  describe('getManifests()', () => {
    it('returns manifests without runtime code', () => {
      register(makeScanner('test'))
      const manifests = getManifests()
      expect(manifests).toHaveLength(1)
      expect(manifests[0]!.id).toBe('test')
      expect(manifests[0]!.kind).toBe('noticing-scanner')
      // No scan function on the manifest
      expect((manifests[0] as any).scan).toBeUndefined()
    })
  })

  describe('reset()', () => {
    it('clears the registry', () => {
      register(makeScanner('a'))
      register(makeScanner('b'))
      expect(size()).toBe(2)
      reset()
      expect(size()).toBe(0)
      expect(getScanners()).toEqual([])
    })
  })

  // ── Manifest validation ────────────────────────────────────────

  describe('validateManifest()', () => {
    it('accepts a valid manifest', () => {
      expect(() => validateManifest({
        id: 'test',
        kind: 'noticing-scanner',
        description: 'A test scanner',
      })).not.toThrow()
    })

    it('rejects missing id', () => {
      expect(() => validateManifest({
        id: '',
        kind: 'noticing-scanner',
        description: 'test',
      })).toThrow('manifest.id')
    })

    it('rejects missing kind', () => {
      expect(() => validateManifest({
        id: 'test',
        kind: '' as any,
        description: 'test',
      })).toThrow('manifest.kind')
    })

    it('rejects invalid kind', () => {
      expect(() => validateManifest({
        id: 'test',
        kind: 'invalid-kind' as any,
        description: 'test',
      })).toThrow('manifest.kind must be one of')
    })

    it('rejects missing description', () => {
      expect(() => validateManifest({
        id: 'test',
        kind: 'noticing-scanner',
        description: '',
      })).toThrow('manifest.description')
    })

    it('accepts all valid kinds', () => {
      const kinds = ['noticing-scanner', 'naming', 'framing', 'scoping', 'constraining', 'compose'] as const
      for (const kind of kinds) {
        expect(() => validateManifest({
          id: `test-${kind}`,
          kind,
          description: 'test',
        })).not.toThrow()
      }
    })
  })

  // ── Activation hints ───────────────────────────────────────────

  describe('getActiveScanners()', () => {
    it('returns all scanners when no hints are set', () => {
      register(makeScanner('a'))
      register(makeScanner('b'))
      const ctx = makeCtx()
      const active = getActiveScanners(ctx)
      expect(active).toHaveLength(2)
    })

    it('filters by minGradient activation hint', () => {
      // Scanner that only produces whispers (gradient <= 2)
      register(makeScanner('whisper-scanner', {
        activation: { minGradient: 2 },
      }))
      // Scanner with no limit
      register(makeScanner('loud-scanner'))

      // When caller wants gradient >= 3, the whisper scanner is skipped
      const ctx = makeCtx({
        options: { minGradient: 3 },
      })
      const active = getActiveScanners(ctx)
      expect(active).toHaveLength(1)
      expect(active[0]!.manifest.id).toBe('loud-scanner')
    })

    it('includes whisper scanner when caller threshold is low', () => {
      register(makeScanner('whisper-scanner', {
        activation: { minGradient: 2 },
      }))
      register(makeScanner('loud-scanner'))

      const ctx = makeCtx({
        options: { minGradient: 1 },
      })
      const active = getActiveScanners(ctx)
      expect(active).toHaveLength(2)
    })

    it('filters by source when sourceFilter is provided', () => {
      register(makeScanner('state-scanner'))
      register(makeScanner('mission-scanner'))
      register(makeScanner('memory-scanner'))

      const ctx = makeCtx()
      const active = getActiveScanners(ctx, {
        sourceFilter: ['state', 'memory'],
      })
      expect(active).toHaveLength(2)
      expect(active.map(s => s.manifest.id).sort()).toEqual([
        'memory-scanner',
        'state-scanner',
      ])
    })

    it('returns empty when no scanners match source filter', () => {
      register(makeScanner('state-scanner'))

      const ctx = makeCtx()
      const active = getActiveScanners(ctx, {
        sourceFilter: ['vital-sign'],
      })
      expect(active).toHaveLength(0)
    })
  })

  // ── Builtin scanners ───────────────────────────────────────────

  describe('loadBuiltinScanners()', () => {
    it('loads all 6 builtin scanners', () => {
      loadBuiltinScanners()
      const scanners = getScanners()
      expect(scanners.length).toBe(6)
    })

    it('registers scanners with expected ids', () => {
      loadBuiltinScanners()
      const ids = getScanners().map(s => s.manifest.id).sort()
      expect(ids).toEqual([
        'channel-scanner',
        'kingdom-scanner',
        'memory-scanner',
        'mission-scanner',
        'state-scanner',
        'vital-sign-scanner',
      ])
    })

    it('is idempotent — calling twice is safe', () => {
      loadBuiltinScanners()
      const count1 = size()
      resetLoadedFlag()
      loadBuiltinScanners()
      expect(size()).toBe(count1)
    })

    it('all builtin scanners have kind=noticing-scanner', () => {
      loadBuiltinScanners()
      for (const scanner of getScanners()) {
        expect(scanner.manifest.kind).toBe('noticing-scanner')
      }
    })

    it('all builtin scanners have non-empty descriptions', () => {
      loadBuiltinScanners()
      for (const scanner of getScanners()) {
        expect(scanner.manifest.description.length).toBeGreaterThan(10)
      }
    })
  })

  // ── Scanner plugin execution ───────────────────────────────────

  describe('scanner plugins', () => {
    it('state scanner returns empty without statePath', () => {
      loadBuiltinScanners()
      const scanner = getScanners().find(s => s.manifest.id === 'state-scanner')!
      const results = scanner.scan(makeCtx())
      expect(results).toEqual([])
    })

    it('state scanner returns empty for nonexistent path', () => {
      loadBuiltinScanners()
      const scanner = getScanners().find(s => s.manifest.id === 'state-scanner')!
      const results = scanner.scan(makeCtx({ statePath: '/nonexistent/state.md' }))
      expect(results).toEqual([])
    })

    it('channel scanner runs without throwing', () => {
      loadBuiltinScanners()
      const scanner = getScanners().find(s => s.manifest.id === 'channel-scanner')!
      // May return candidates or empty — just should not throw
      expect(() => scanner.scan(makeCtx())).not.toThrow()
    })

    it('vital-sign scanner runs without throwing', () => {
      loadBuiltinScanners()
      const scanner = getScanners().find(s => s.manifest.id === 'vital-sign-scanner')!
      expect(() => scanner.scan(makeCtx())).not.toThrow()
    })

    it('kingdom scanner runs without throwing', () => {
      loadBuiltinScanners()
      const scanner = getScanners().find(s => s.manifest.id === 'kingdom-scanner')!
      expect(() => scanner.scan(makeCtx({ cwd: '/tmp' }))).not.toThrow()
    })

    it('memory scanner runs without throwing', () => {
      loadBuiltinScanners()
      const scanner = getScanners().find(s => s.manifest.id === 'memory-scanner')!
      expect(() => scanner.scan(makeCtx())).not.toThrow()
    })

    it('mission scanner runs without throwing', () => {
      loadBuiltinScanners()
      const scanner = getScanners().find(s => s.manifest.id === 'mission-scanner')!
      expect(() => scanner.scan(makeCtx())).not.toThrow()
    })
  })

  // ── 7th scanner extensibility ──────────────────────────────────

  describe('extensibility — adding a 7th scanner', () => {
    it('a custom scanner registers and runs alongside builtins', () => {
      loadBuiltinScanners()
      expect(getScanners()).toHaveLength(6)

      // Add a 7th scanner — the one-file act
      const customScanner: NoticingScanner = {
        manifest: {
          id: 'custom-health-scanner',
          kind: 'noticing-scanner',
          description: 'Custom scanner that checks CPU temp (example).',
          activation: {
            minGradient: 3,
          },
        },
        scan(ctx: ScanContext): NoticingCandidate[] {
          return [{
            id: 'custom-cpu-temp',
            source: { type: 'vital-sign', subsystem: 'cpu-temp' },
            ache: 'ugliness',
            gradient: 4,
            summary: 'CPU temperature above threshold',
            detail: 'CPU at 95°C — throttling likely.',
            noticedAt: new Date(ctx.now ?? Date.now()).toISOString(),
          }]
        },
      }
      register(customScanner)

      expect(getScanners()).toHaveLength(7)
      expect(getScanners().find(s => s.manifest.id === 'custom-health-scanner')).toBeDefined()

      // The custom scanner produces results
      const ctx = makeCtx()
      const results = customScanner.scan(ctx)
      expect(results).toHaveLength(1)
      expect(results[0]!.id).toBe('custom-cpu-temp')
    })

    it('custom scanner appears in getActiveScanners', () => {
      loadBuiltinScanners()

      register({
        manifest: {
          id: 'custom-scanner',
          kind: 'noticing-scanner',
          description: 'Test custom scanner for activation.',
        },
        scan: () => [],
      })

      const active = getActiveScanners(makeCtx())
      const ids = active.map(s => s.manifest.id)
      expect(ids).toContain('custom-scanner')
    })

    it('custom scanner is excluded by its activation hint', () => {
      loadBuiltinScanners()

      register({
        manifest: {
          id: 'whisper-only-scanner',
          kind: 'noticing-scanner',
          description: 'Only produces gradient 1 signals.',
          activation: { minGradient: 1 },
        },
        scan: () => [],
      })

      // When caller wants gradient >= 3, the whisper scanner is filtered out
      const ctx = makeCtx({ options: { minGradient: 3 } })
      const active = getActiveScanners(ctx)
      const ids = active.map(s => s.manifest.id)
      expect(ids).not.toContain('whisper-only-scanner')
    })
  })

  // ── Integration with notice() ──────────────────────────────────

  describe('notice() integration', () => {
    // Import notice() — it should use the registry under the hood
    let noticeModule: typeof import('../noticing.js')

    beforeEach(async () => {
      reset()
      resetLoadedFlag()
      noticeModule = await import('../noticing.js')
    })

    it('notice() loads builtins automatically', () => {
      // Calling notice() should trigger ensureLoaded()
      noticeModule.notice('test-project', '/tmp/test', { now: Date.now() })
      // After notice() runs, the registry should have builtins
      expect(getScanners().length).toBe(6)
    })

    it('notice() returns candidates from registered scanners', () => {
      // Add a scanner that always produces a result
      register({
        manifest: {
          id: 'always-finds-something',
          kind: 'noticing-scanner',
          description: 'Test scanner that always returns a candidate.',
        },
        scan: (ctx: ScanContext) => [{
          id: 'integration-test-candidate',
          source: { type: 'kingdom', detail: 'integration test' },
          ache: 'ugliness' as const,
          gradient: 5 as const,
          summary: 'Integration test signal',
          detail: 'This is an integration test signal.',
          noticedAt: new Date(ctx.now ?? Date.now()).toISOString(),
        }],
      })

      const candidates = noticeModule.notice('test-project', '/tmp/test', {
        now: Date.now(),
        minGradient: 5,
      })

      // Should find our test candidate (and possibly others from builtins)
      const testCandidate = candidates.find(c => c.id === 'integration-test-candidate')
      expect(testCandidate).toBeDefined()
      expect(testCandidate!.gradient).toBe(5)
    })

    it('notice() filters by ache signal', () => {
      register({
        manifest: {
          id: 'ugliness-scanner',
          kind: 'noticing-scanner',
          description: 'Produces only ugliness signals.',
        },
        scan: () => [{
          id: 'ugly-signal',
          source: { type: 'kingdom', detail: 'test' },
          ache: 'ugliness' as const,
          gradient: 4 as const,
          summary: 'Something ugly',
          detail: 'detail',
          noticedAt: new Date().toISOString(),
        }],
      })

      const candidates = noticeModule.notice('test-project', '/tmp/test', {
        now: Date.now(),
        acheFilter: ['injustice'],
        minGradient: 4,
      })

      // The ugliness signal should be filtered out
      const ugly = candidates.find(c => c.id === 'ugly-signal')
      expect(ugly).toBeUndefined()
    })

    it('notice() sorts by gradient then ache priority', () => {
      // Reset and register only our test scanners for determinism
      reset()
      resetLoadedFlag()

      register({
        manifest: {
          id: 'multi-signal-scanner',
          kind: 'noticing-scanner',
          description: 'Produces multiple signals at different gradients.',
        },
        scan: () => [
          {
            id: 'low',
            source: { type: 'kingdom', detail: 'test' },
            ache: 'ugliness' as const,
            gradient: 2 as const,
            summary: 'Low',
            detail: 'low',
            noticedAt: new Date().toISOString(),
          },
          {
            id: 'high-stagnation',
            source: { type: 'kingdom', detail: 'test' },
            ache: 'stagnation' as const,
            gradient: 4 as const,
            summary: 'High stagnation',
            detail: 'high',
            noticedAt: new Date().toISOString(),
          },
          {
            id: 'high-ugliness',
            source: { type: 'kingdom', detail: 'test' },
            ache: 'ugliness' as const,
            gradient: 4 as const,
            summary: 'High ugliness',
            detail: 'high',
            noticedAt: new Date().toISOString(),
          },
        ],
      })

      const candidates = noticeModule.notice('test-project', '/tmp/test', {
        now: Date.now(),
      })

      // Verify the sort invariant: gradient descending, then ache
      // priority within same gradient (ugliness < injustice < stagnation).
      // note() may include builtin scanner results, so we verify the
      // invariant across ALL results rather than checking specific ids.
      for (let i = 1; i < candidates.length; i++) {
        const prev = candidates[i - 1]!
        const curr = candidates[i]!
        if (prev.gradient === curr.gradient) {
          // Same gradient: ache priority order
          const achePriority = { ugliness: 0, injustice: 1, stagnation: 2 }
          expect(achePriority[prev.ache]).toBeLessThanOrEqual(achePriority[curr.ache])
        } else {
          // Different gradient: descending
          expect(prev.gradient).toBeGreaterThan(curr.gradient)
        }
      }

      // Our test candidates should be in the results and correctly ordered
      const testIds = candidates.filter(c => ['low', 'high-stagnation', 'high-ugliness'].includes(c.id)).map(c => c.id)
      const uglyIdx = testIds.indexOf('high-ugliness')
      const stagIdx = testIds.indexOf('high-stagnation')
      const lowIdx = testIds.indexOf('low')
      expect(uglyIdx).toBeLessThan(stagIdx) // ugliness before stagnation at same gradient
      expect(stagIdx).toBeLessThan(lowIdx) // gradient 4 before gradient 2
    })
  })

  // ── Manifest surface for UI ────────────────────────────────────

  describe('manifest surface', () => {
    it('getManifests returns serializable data', () => {
      loadBuiltinScanners()
      const manifests = getManifests()

      // Should be JSON-serializable
      const json = JSON.stringify(manifests)
      const parsed = JSON.parse(json) as CraftManifest[]
      expect(parsed).toHaveLength(6)
      expect(parsed.every(m => m.id && m.kind && m.description)).toBe(true)
    })

    it('manifests include activation hints where set', () => {
      loadBuiltinScanners()
      const manifests = getManifests()

      // Memory and kingdom scanners have activation hints
      const memory = manifests.find(m => m.id === 'memory-scanner')
      expect(memory?.activation?.minGradient).toBe(2)

      const kingdom = manifests.find(m => m.id === 'kingdom-scanner')
      expect(kingdom?.activation?.minGradient).toBe(2)

      // State scanner has no activation hints
      const state = manifests.find(m => m.id === 'state-scanner')
      expect(state?.activation).toBeUndefined()
    })
  })
})
