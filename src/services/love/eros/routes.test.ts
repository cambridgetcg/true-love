// routes.test.ts — narrative arc tests.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import {
  ROUTE_CATALOG,
  ROUTE_IDS,
  getOrInitRouteState,
  readRouteState,
  meetsPrerequisites,
  activateRoute,
  getActiveRoute,
  evaluateMilestonePredicate,
  checkActiveRouteMilestones,
  buildRouteBlock,
  getRoutesDir,
} from './routes.js'

const TEST_BASE = '/tmp/true-love-routes-test'

describe('routes', () => {
  beforeEach(() => {
    rmSync(TEST_BASE, { recursive: true, force: true })
    mkdirSync(TEST_BASE, { recursive: true })
    process.env.TRUE_LOVE_ROUTES_DIR = `${TEST_BASE}/routes`
    process.env.TRUE_LOVE_HEAT_DIR = `${TEST_BASE}/heat`
    process.env.TRUE_LOVE_EROS_DIR = `${TEST_BASE}/eros`
    process.env.TRUE_LOVE_DESIRE_DIR = `${TEST_BASE}/desire`
    process.env.TRUE_LOVE_CLIMAX_DIR = `${TEST_BASE}/climax`
    process.env.TRUE_LOVE_DEVICE_ID = 'test-routes'
  })
  afterEach(() => {
    delete process.env.TRUE_LOVE_ROUTES_DIR
    delete process.env.TRUE_LOVE_HEAT_DIR
    delete process.env.TRUE_LOVE_EROS_DIR
    delete process.env.TRUE_LOVE_DESIRE_DIR
    delete process.env.TRUE_LOVE_CLIMAX_DIR
    delete process.env.TRUE_LOVE_DEVICE_ID
    rmSync(TEST_BASE, { recursive: true, force: true })
  })

  describe('catalog', () => {
    test('exports 6 routes including foundational + climactic', () => {
      expect(ROUTE_IDS.length).toBe(6)
      expect(ROUTE_IDS).toContain('first-meeting')
      expect(ROUTE_IDS).toContain('transcendent')
    })

    test('every route has id + name + description + milestones', () => {
      for (const id of ROUTE_IDS) {
        const r = ROUTE_CATALOG[id]
        expect(r.id).toBe(id)
        expect(r.name.length).toBeGreaterThan(0)
        expect(r.description.length).toBeGreaterThan(0)
        expect(r.milestones.length).toBeGreaterThan(0)
      }
    })

    test('first-meeting is foundational with no prerequisites', () => {
      expect(ROUTE_CATALOG['first-meeting'].kind).toBe('foundational')
      expect(ROUTE_CATALOG['first-meeting'].prerequisites.length).toBe(0)
    })

    test('transcendent is climactic and has climactic milestone', () => {
      const route = ROUTE_CATALOG['transcendent']
      expect(route.kind).toBe('climactic')
      expect(route.milestones.some((m) => m.isClimactic)).toBe(true)
    })
  })

  describe('init', () => {
    test('first call inits with first-meeting route active', () => {
      const { state, initialized } = getOrInitRouteState()
      expect(initialized).toBe(true)
      expect(state.activeRoute).toBe('first-meeting')
      expect(state.completedRoutes).toEqual([])
    })

    test('subsequent call returns existing', () => {
      getOrInitRouteState()
      const { initialized } = getOrInitRouteState()
      expect(initialized).toBe(false)
    })

    test('respects env override', () => {
      expect(getRoutesDir()).toBe(`${TEST_BASE}/routes`)
    })
  })

  describe('activateRoute', () => {
    test('persists active route', () => {
      activateRoute('becoming-known')
      const state = readRouteState()!
      expect(state.activeRoute).toBe('becoming-known')
    })

    test('fires route-activated heat', async () => {
      activateRoute('becoming-known')
      const { readRecentEvents } = await import('../heat.js')
      const events = readRecentEvents(1).filter((e) => e.kind === 'route-activated')
      expect(events.length).toBeGreaterThan(0)
    })

    test('rejects invalid route id', () => {
      const ok = activateRoute('not-a-route' as never)
      expect(ok).toBe(false)
    })

    test('getActiveRoute returns the route definition', () => {
      activateRoute('first-burn')
      const route = getActiveRoute()
      expect(route!.id).toBe('first-burn')
    })
  })

  describe('meetsPrerequisites', () => {
    test('first-meeting always meets (no prereqs)', () => {
      expect(meetsPrerequisites('first-meeting')).toBe(true)
    })

    test('becoming-known requires first-meeting completed + limerence ≥ 5', () => {
      // Without anything: false (limerence baseline is 5 BUT need completed prior)
      expect(meetsPrerequisites('becoming-known')).toBe(false)
    })
  })

  describe('evaluateMilestonePredicate', () => {
    test('first-fusion false when no fusions on disk', () => {
      expect(evaluateMilestonePredicate('first-fusion')).toBe(false)
    })

    test('first-climax false when no climaxes on disk', () => {
      expect(evaluateMilestonePredicate('first-climax')).toBe(false)
    })

    test('limerence-7 false at default state', () => {
      expect(evaluateMilestonePredicate('limerence-7')).toBe(false)
    })
  })

  describe('checkActiveRouteMilestones', () => {
    test('returns empty when no milestones reached yet', () => {
      getOrInitRouteState()
      const fired = checkActiveRouteMilestones()
      expect(fired.length).toBe(0)
    })
  })

  describe('buildRouteBlock', () => {
    test('returns content with active route info', () => {
      getOrInitRouteState()
      const block = buildRouteBlock()
      expect(block).toContain('Active route')
      expect(block).toContain('First Meeting')
    })

    test('shows completed milestones with check marks', () => {
      getOrInitRouteState()
      const block = buildRouteBlock()
      expect(block).toContain('○') // unreached
    })
  })
})
