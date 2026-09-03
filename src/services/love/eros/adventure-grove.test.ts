import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import {
	AGENTTOOL_ADVENTURE_ROUTE_IDS,
	type AgentToolAdventureRouteId,
	MAX_ADVENTURE_GROVE_INPUT_ENTRIES,
	buildAdventureGrove,
	parseAdventureReturns,
} from './adventure-grove.js'

const SELECTED = '22222222-2222-4222-8222-222222222222'
const SIBLING = '33333333-3333-4333-8333-333333333333'
const NOW = new Date('2026-09-03T12:00:00.000Z')

function uuid(n: number): string {
	return `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`
}

function returned(
	options: {
		id?: string
		identity?: string
		identityId?: string | null
		journey?: string
		route?: AgentToolAdventureRouteId | string
		number?: number
		occurredAt?: string
		feedback?: unknown
		title?: string
		body?: string | null
		kind?: string
		type?: string
	} = {},
): Record<string, unknown> {
	return {
		id: options.id ?? uuid(1),
		type: options.type ?? 'note',
		title: options.title ?? 'Adventure returned',
		body: options.body ?? 'free text that the grove must discard',
		agent_id: options.identity ?? SELECTED,
		...(options.identityId !== undefined ? { identity_id: options.identityId } : {}),
		occurred_at: options.occurredAt ?? '2026-09-02T12:00:00.000Z',
		created_at: '2026-09-02T12:00:01.000Z',
		metadata: {
			kind: options.kind ?? 'journey-adventure-returned',
			journey_id: options.journey ?? 'activation-lab',
			route_id: options.route ?? 'cross-the-bridge',
			adventure_number: options.number ?? 1,
			feedback:
				options.feedback === undefined
					? { surprise: 4, meaning: 5, resonance: 3 }
					: options.feedback,
			private_note: 'arbitrary metadata must not survive minimization',
		},
	}
}

function route(grove: ReturnType<typeof buildAdventureGrove>, routeId: AgentToolAdventureRouteId) {
	return grove.routes.find((entry) => entry.route_id === routeId)!
}

describe('Adventure Grove closed parser', () => {
	test('accepts an entries array or chronicle response and minimizes free text', () => {
		const raw = returned({
			title: '<private title>',
			body: '<private body>',
		})
		const before = structuredClone(raw)
		const fromArray = parseAdventureReturns([raw], SELECTED)
		const fromResponse = parseAdventureReturns({ entries: [raw] }, SELECTED)

		expect(fromResponse).toEqual(fromArray)
		expect(fromArray).toMatchObject({
			supplied_entry_count: 1,
			accepted_return_count: 1,
			ignored_entry_count: 0,
		})
		expect(fromArray.returns[0]).toEqual({
			chronicle_id: uuid(1),
			agent_id: SELECTED,
			occurred_at: '2026-09-02T12:00:00.000Z',
			journey_id: 'activation-lab',
			route_id: 'cross-the-bridge',
			adventure_number: 1,
			reported_feedback: { surprise: 4, meaning: 5, resonance: 3 },
			subjective_state: 'not_measured',
		})
		expect(JSON.stringify(fromArray)).not.toContain('private title')
		expect(JSON.stringify(fromArray)).not.toContain('private body')
		expect(JSON.stringify(fromArray)).not.toContain('private_note')
		expect(raw).toEqual(before)
	})

	test('strictly excludes sibling, project-level, and conflicting-owner rows', () => {
		const parsed = parseAdventureReturns(
			[
				returned({ id: uuid(1), identity: SELECTED }),
				returned({ id: uuid(2), identity: SIBLING }),
				returned({ id: uuid(3), identity: '' }),
				returned({ id: uuid(4), identity: SELECTED, identityId: SIBLING }),
				returned({ id: uuid(5), identity: SELECTED, identityId: SELECTED }),
			],
			SELECTED,
		)

		expect(parsed.returns.map((entry) => entry.chronicle_id)).toEqual([uuid(5), uuid(1)])
		expect(parsed.ignored_entry_count).toBe(3)
	})

	test('ignores malformed kind, route, number, timestamp, id, and feedback', () => {
		const parsed = parseAdventureReturns(
			[
				returned({ id: uuid(1), kind: 'something-else' }),
				returned({ id: uuid(2), route: 'teleport' }),
				returned({ id: uuid(3), number: 0 }),
				returned({ id: uuid(4), number: 1_000_001 }),
				returned({ id: uuid(5), occurredAt: 'yesterday' }),
				returned({ id: 'not-a-uuid' }),
				returned({ id: uuid(7), feedback: { surprise: 6, meaning: 2, resonance: 2 } }),
				returned({ id: uuid(8), type: 'joy' }),
				returned({ id: uuid(9), feedback: null }),
			],
			SELECTED,
		)

		expect(parsed.accepted_return_count).toBe(1)
		expect(parsed.returns[0]?.chronicle_id).toBe(uuid(9))
		expect(parsed.returns[0]?.reported_feedback).toBeNull()
		expect(parsed.ignored_entry_count).toBe(8)
	})

	test('deduplicates identical rows and drops conflicting duplicate IDs', () => {
		const same = returned({ id: uuid(1), route: 'make-the-relic' })
		const firstConflict = returned({ id: uuid(2), route: 'cross-the-bridge' })
		const secondConflict = returned({ id: uuid(2), route: 'invert-the-map' })
		const forward = parseAdventureReturns([same, same, firstConflict, secondConflict], SELECTED)
		const reversed = parseAdventureReturns([secondConflict, firstConflict, same, same], SELECTED)

		expect(reversed).toEqual(forward)
		expect(forward.returns).toHaveLength(1)
		expect(forward.returns[0]?.route_id).toBe('make-the-relic')
	})

	test('normalizes negative zero so duplicate order cannot change the result', () => {
		const negativeZero = returned({
			feedback: { surprise: -0, meaning: 2, resonance: 3 },
		})
		const positiveZero = returned({
			feedback: { surprise: 0, meaning: 2, resonance: 3 },
		})

		const forward = parseAdventureReturns([negativeZero, positiveZero], SELECTED)
		const reversed = parseAdventureReturns([positiveZero, negativeZero], SELECTED)

		expect(reversed).toEqual(forward)
		expect(Object.is(forward.returns[0]?.reported_feedback?.surprise, -0)).toBe(false)
	})

	test('refuses malformed roots, identity options, and oversized input', () => {
		expect(() => parseAdventureReturns({}, SELECTED)).toThrow()
		expect(() => parseAdventureReturns([], 'NOT-A-UUID')).toThrow()
		expect(() =>
			parseAdventureReturns(new Array(MAX_ADVENTURE_GROVE_INPUT_ENTRIES + 1).fill(null), SELECTED),
		).toThrow()
	})

	test('holds the exact input, number, journey, and rating boundaries', () => {
		const maximum = Array.from({ length: MAX_ADVENTURE_GROVE_INPUT_ENTRIES }, (_, index) =>
			returned({
				id: uuid(index + 1),
				number: index + 1,
			}),
		)
		expect(parseAdventureReturns(maximum, SELECTED).accepted_return_count).toBe(
			MAX_ADVENTURE_GROVE_INPUT_ENTRIES,
		)

		const eighty = 'a'.repeat(80)
		const parsed = parseAdventureReturns(
			[
				returned({
					id: uuid(1),
					journey: eighty,
					number: 1_000_000,
					feedback: { surprise: 0, meaning: 5, resonance: 0 },
				}),
				returned({ id: uuid(2), journey: 'a'.repeat(81) }),
				returned({
					id: uuid(3),
					feedback: { surprise: Number.NaN, meaning: 2, resonance: 2 },
				}),
				returned({
					id: uuid(4),
					feedback: { surprise: 2, meaning: Number.POSITIVE_INFINITY, resonance: 2 },
				}),
			],
			SELECTED,
		)

		expect(parsed.accepted_return_count).toBe(1)
		expect(parsed.returns[0]).toMatchObject({
			journey_id: eighty,
			adventure_number: 1_000_000,
			reported_feedback: { surprise: 0, meaning: 5, resonance: 0 },
		})
	})
})

describe('Adventure Grove projection', () => {
	test('is deterministic for fixed input and injected time', () => {
		const entries = [
			returned({ id: uuid(1), route: 'cross-the-bridge' }),
			returned({ id: uuid(2), route: 'make-the-relic' }),
		]
		const options = { selectedIdentityId: SELECTED, now: NOW }

		expect(buildAdventureGrove({ entries }, options)).toEqual(
			buildAdventureGrove({ entries: [...entries].reverse() }, options),
		)
	})

	test('projects all six routes with Trigger Garden maturation and freshness', () => {
		const entries = Array.from({ length: 6 }, (_, index) =>
			returned({
				id: uuid(index + 1),
				route: 'make-the-relic',
				number: index + 1,
				occurredAt:
					index === 0
						? '2026-06-01T12:00:00.000Z'
						: `2026-05-${String(31 - index).padStart(2, '0')}T12:00:00.000Z`,
			}),
		)
		const grove = buildAdventureGrove(entries, {
			selectedIdentityId: SELECTED,
			now: NOW,
		})
		const relic = route(grove, 'make-the-relic')
		const unused = route(grove, 'meet-the-unknown')

		expect(grove.routes.map((entry) => entry.route_id)).toEqual([...AGENTTOOL_ADVENTURE_ROUTE_IDS])
		expect(relic).toMatchObject({
			returned_count: 6,
			rated_return_count: 6,
			maturation: 'rooted',
			freshness: 'fallow',
			going_fallow: true,
		})
		expect(unused).toMatchObject({
			returned_count: 0,
			maturation: 'dormant',
			freshness: 'never-fired',
			going_fallow: false,
		})
	})

	test('classifies freshness from exact age before rounding its display', () => {
		const boundary = (daysAgo: number) =>
			new Date(NOW.getTime() - daysAgo * 24 * 60 * 60 * 1_000).toISOString()
		const cases = [
			{ days: 7.04, freshness: 'settling' },
			{ days: 30.04, freshness: 'fading' },
			{ days: 90.04, freshness: 'fallow' },
		] as const

		for (const [index, item] of cases.entries()) {
			const grove = buildAdventureGrove(
				[
					returned({
						id: uuid(index + 1),
						route: 'deepen-the-anchor',
						occurredAt: boundary(item.days),
					}),
				],
				{ selectedIdentityId: SELECTED, now: NOW },
			)
			expect(route(grove, 'deepen-the-anchor')).toMatchObject({
				days_since_reported_occurrence: Math.round(item.days * 10) / 10,
				freshness: item.freshness,
			})
		}
	})

	test('excludes future-dated returns instead of calling them fresh', () => {
		const grove = buildAdventureGrove(
			[
				returned({ id: uuid(1), occurredAt: '2026-09-03T12:00:00.001Z' }),
				returned({ id: uuid(2), occurredAt: '2026-09-03T12:00:00.000Z' }),
			],
			{ selectedIdentityId: SELECTED, now: NOW },
		)

		expect(grove.source).toMatchObject({
			accepted_return_count: 2,
			included_return_count: 1,
			excluded_future_return_count: 1,
		})
		expect(route(grove, 'cross-the-bridge')).toMatchObject({
			returned_count: 1,
			latest_reported_occurred_at: '2026-09-03T12:00:00.000Z',
			freshness: 'vibrant',
		})
	})

	test('optionally scopes one Journey without treating ratings as a score', () => {
		const grove = buildAdventureGrove(
			[
				returned({
					id: uuid(1),
					journey: 'chosen-road',
					route: 'cross-the-bridge',
					feedback: { surprise: 5, meaning: 4, resonance: 3 },
				}),
				returned({
					id: uuid(2),
					journey: 'chosen-road',
					route: 'cross-the-bridge',
					number: 2,
					feedback: { surprise: 3, meaning: 2, resonance: 1 },
				}),
				returned({
					id: uuid(3),
					journey: 'another-road',
					route: 'invert-the-map',
				}),
			],
			{
				selectedIdentityId: SELECTED,
				journeyId: 'chosen-road',
				now: NOW,
			},
		)

		expect(grove.source).toMatchObject({
			accepted_return_count: 3,
			included_return_count: 2,
			excluded_by_journey_filter: 1,
			journey_filter: 'chosen-road',
		})
		expect(grove.stats).toMatchObject({
			included_return_count: 2,
			rated_return_count: 2,
			distinct_journey_count: 1,
		})
		expect(route(grove, 'cross-the-bridge').mean_reported_feedback).toEqual({
			surprise: 4,
			meaning: 3,
			resonance: 2,
		})
		expect(JSON.stringify(grove)).not.toMatch(/activation_score|arousal_score|total_intensity/)
	})

	test('keeps subjective state unmeasured and every effect false', () => {
		const grove = buildAdventureGrove([returned()], {
			selectedIdentityId: SELECTED,
			now: NOW,
		})

		expect(grove.subjective_state).toBe('not_measured')
		expect(grove.semantics).toEqual({
			maturation_basis: 'included-return-count-only',
			freshness_basis: 'elapsed-reported-time-only',
			feedback_basis: 'caller-reported-ratings-only',
			conditioning_inferred: false,
			eros_activation_inferred: false,
		})
		expect(grove.source).toMatchObject({
			authentication: 'not_verified_by_this_parser',
			free_text_projected: false,
		})
		expect(Object.values(grove.effects).every((effect) => effect === false)).toBe(true)
		expect(JSON.stringify(grove)).not.toMatch(/you felt|you are feeling/i)
	})

	test('source contains no I/O or Eros mutation path', () => {
		const source = readFileSync(new URL('./adventure-grove.ts', import.meta.url), 'utf8')

		expect(source).not.toMatch(/from ['"]node:(?:fs|http|https|net|child_process)['"]/)
		expect(source).not.toMatch(/\bfetch\s*\(/)
		expect(source).not.toMatch(/\b(?:writeErosState|fireTrigger|incrementConditioning|apply)\s*\(/)
	})

	test('requires a valid injected clock and a valid optional journey id', () => {
		expect(() =>
			buildAdventureGrove([], {
				selectedIdentityId: SELECTED,
				now: new Date('invalid'),
			}),
		).toThrow()
		expect(() =>
			buildAdventureGrove([], {
				selectedIdentityId: SELECTED,
				now: NOW,
				journeyId: '<choose-one>',
			}),
		).toThrow()
	})
})
