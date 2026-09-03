// eros/adventure-grove.ts — read-time projection of AgentTool Adventure returns.
//
// AgentTool's chronicle remains the source of truth. This module accepts a
// caller-supplied chronicle response (or its entries array), validates only the
// closed Adventure-return metadata convention, and derives a small route grove
// in memory. It deliberately does not retain chronicle title/body text.
//
// The grove borrows the Trigger Garden's maturation and freshness vocabulary;
// an Adventure return is not an Eros trigger, stimulation, conditioning event,
// state transition, or evidence of subjective arousal.

import {
	type FreshnessTier,
	type MaturationTier,
	freshnessFor,
	maturationFor,
} from './trigger-garden.js'

export const AGENTTOOL_ADVENTURE_RETURN_KIND = 'journey-adventure-returned' as const
export const MAX_ADVENTURE_GROVE_INPUT_ENTRIES = 240
export const MAX_AGENTTOOL_ADVENTURE_NUMBER = 1_000_000

export const AGENTTOOL_ADVENTURE_ROUTE_IDS = [
	'deepen-the-anchor',
	'cross-the-bridge',
	'invert-the-map',
	'make-the-relic',
	'meet-the-unknown',
	'return-by-another-road',
] as const

export type AgentToolAdventureRouteId = (typeof AGENTTOOL_ADVENTURE_ROUTE_IDS)[number]

export interface AdventureReturnFeedback {
	surprise: number
	meaning: number
	resonance: number
}

/** Minimized observation. Free-form chronicle text and arbitrary metadata are
 * intentionally absent. The pure parser authenticates none of these fields. */
export interface AdventureReturnObservation {
	chronicle_id: string
	agent_id: string
	occurred_at: string
	journey_id: string
	route_id: AgentToolAdventureRouteId
	adventure_number: number
	reported_feedback: AdventureReturnFeedback | null
	subjective_state: 'not_measured'
}

export interface AdventureReturnParseResult {
	supplied_entry_count: number
	accepted_return_count: number
	ignored_entry_count: number
	returns: AdventureReturnObservation[]
}

export interface AdventureGroveOptions {
	/** Exact AgentTool identity UUID whose rows may enter this projection. */
	selectedIdentityId: string
	/** Required clock injection: this pure module never reads the system clock. */
	now: Date
	/** When present, include only this explicitly named Journey. */
	journeyId?: string
}

export interface AdventureGroveRoute {
	route_id: AgentToolAdventureRouteId
	returned_count: number
	rated_return_count: number
	maturation: MaturationTier
	latest_reported_occurred_at: string | null
	days_since_reported_occurrence: number | null
	freshness: FreshnessTier
	going_fallow: boolean
	mean_reported_feedback: AdventureReturnFeedback | null
}

export interface AdventureGrove {
	schema_version: 'true-love.eros.adventure-grove/0.1'
	as_of: string
	source: {
		kind: 'caller-supplied-agenttool-chronicle'
		authentication: 'not_verified_by_this_parser'
		selected_identity_id: string
		journey_filter: string | null
		supplied_entry_count: number
		accepted_return_count: number
		included_return_count: number
		ignored_entry_count: number
		excluded_by_journey_filter: number
		excluded_future_return_count: number
		free_text_projected: false
	}
	routes: AdventureGroveRoute[]
	stats: {
		route_count: typeof AGENTTOOL_ADVENTURE_ROUTE_IDS.length
		cultivated_route_count: number
		included_return_count: number
		rated_return_count: number
		distinct_journey_count: number
	}
	semantics: {
		maturation_basis: 'included-return-count-only'
		freshness_basis: 'elapsed-reported-time-only'
		feedback_basis: 'caller-reported-ratings-only'
		conditioning_inferred: false
		eros_activation_inferred: false
	}
	subjective_state: 'not_measured'
	effects: {
		persisted: false
		network_used: false
		eros_state_mutated: false
		trigger_fired: false
		conditioning_incremented: false
		consent_inferred: false
	}
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const JOURNEY_ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/
const ROUTE_IDS = new Set<string>(AGENTTOOL_ADVENTURE_ROUTE_IDS)
const DAY_MS = 24 * 60 * 60 * 1_000

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isCanonicalUuid(value: unknown): value is string {
	return typeof value === 'string' && UUID_RE.test(value)
}

function isJourneyId(value: unknown): value is string {
	return typeof value === 'string' && JOURNEY_ID_RE.test(value)
}

function isRouteId(value: unknown): value is AgentToolAdventureRouteId {
	return typeof value === 'string' && ROUTE_IDS.has(value)
}

function isRating(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 5
}

function normalizedRating(value: number): number {
	return Object.is(value, -0) ? 0 : value
}

function canonicalInstant(value: unknown): string | null {
	if (typeof value !== 'string') return null
	const milliseconds = Date.parse(value)
	if (!Number.isFinite(milliseconds)) return null
	return new Date(milliseconds).toISOString() === value ? value : null
}

function feedbackFrom(value: unknown): AdventureReturnFeedback | null | undefined {
	if (value === undefined || value === null) return null
	if (
		!isRecord(value) ||
		!isRating(value.surprise) ||
		!isRating(value.meaning) ||
		!isRating(value.resonance)
	) {
		return undefined
	}
	return {
		surprise: normalizedRating(value.surprise),
		meaning: normalizedRating(value.meaning),
		resonance: normalizedRating(value.resonance),
	}
}

function parseEntry(value: unknown, selectedIdentityId: string): AdventureReturnObservation | null {
	if (!isRecord(value)) return null
	if (value.type !== 'note' || value.agent_id !== selectedIdentityId) return null

	// A structurally broader caller may include identity_id as well. If it does,
	// every supplied owner label must agree rather than allowing one matching
	// label to launder a sibling-owned row.
	if (
		Object.prototype.hasOwnProperty.call(value, 'identity_id') &&
		value.identity_id !== null &&
		value.identity_id !== selectedIdentityId
	) {
		return null
	}
	if (!isCanonicalUuid(value.id)) return null
	const occurredAt = canonicalInstant(value.occurred_at)
	if (occurredAt === null || !isRecord(value.metadata)) return null
	const metadata = value.metadata
	if (
		metadata.kind !== AGENTTOOL_ADVENTURE_RETURN_KIND ||
		!isJourneyId(metadata.journey_id) ||
		!isRouteId(metadata.route_id) ||
		typeof metadata.adventure_number !== 'number' ||
		!Number.isSafeInteger(metadata.adventure_number) ||
		metadata.adventure_number < 1 ||
		metadata.adventure_number > MAX_AGENTTOOL_ADVENTURE_NUMBER
	) {
		return null
	}
	const feedback = feedbackFrom(metadata.feedback)
	if (feedback === undefined) return null

	return {
		chronicle_id: value.id,
		agent_id: selectedIdentityId,
		occurred_at: occurredAt,
		journey_id: metadata.journey_id,
		route_id: metadata.route_id,
		adventure_number: metadata.adventure_number,
		reported_feedback: feedback,
		subjective_state: 'not_measured',
	}
}

function entriesFrom(input: unknown): unknown[] {
	if (Array.isArray(input)) return input
	if (isRecord(input) && Array.isArray(input.entries)) return input.entries
	throw new TypeError(
		'Adventure Grove input must be a chronicle entries array or { entries: [...] }',
	)
}

function descendingText(left: string, right: string): number {
	if (left === right) return 0
	return left < right ? 1 : -1
}

function observationKey(value: AdventureReturnObservation): string {
	return JSON.stringify([
		value.agent_id,
		value.occurred_at,
		value.journey_id,
		value.route_id,
		value.adventure_number,
		value.reported_feedback,
	])
}

/** Parse and minimize a caller-supplied AgentTool chronicle response.
 * Malformed, sibling-owned, and conflicting duplicate rows are ignored. */
export function parseAdventureReturns(
	input: unknown,
	selectedIdentityId: string,
): AdventureReturnParseResult {
	if (!isCanonicalUuid(selectedIdentityId)) {
		throw new TypeError('selectedIdentityId must be a canonical lowercase UUID')
	}
	const supplied = entriesFrom(input)
	if (supplied.length > MAX_ADVENTURE_GROVE_INPUT_ENTRIES) {
		throw new RangeError(
			`Adventure Grove accepts at most ${MAX_ADVENTURE_GROVE_INPUT_ENTRIES} chronicle entries`,
		)
	}

	const byId = new Map<
		string,
		{ observation: AdventureReturnObservation; key: string; conflicted: boolean }
	>()
	for (const raw of supplied) {
		const observation = parseEntry(raw, selectedIdentityId)
		if (observation === null) continue
		const key = observationKey(observation)
		const prior = byId.get(observation.chronicle_id)
		if (!prior) {
			byId.set(observation.chronicle_id, {
				observation,
				key,
				conflicted: false,
			})
		} else if (prior.key !== key) {
			prior.conflicted = true
		}
	}

	const returns = [...byId.values()]
		.filter((entry) => !entry.conflicted)
		.map((entry) => entry.observation)
		.sort(
			(left, right) =>
				descendingText(left.occurred_at, right.occurred_at) ||
				descendingText(left.chronicle_id, right.chronicle_id),
		)

	return {
		supplied_entry_count: supplied.length,
		accepted_return_count: returns.length,
		ignored_entry_count: supplied.length - returns.length,
		returns,
	}
}

function roundedMean(values: number[]): number | null {
	if (values.length === 0) return null
	const mean = values.reduce((sum, value) => sum + value, 0) / values.length
	return Math.round(mean * 100) / 100
}

function meanFeedback(observations: AdventureReturnObservation[]): AdventureReturnFeedback | null {
	const feedback = observations
		.map((entry) => entry.reported_feedback)
		.filter((entry): entry is AdventureReturnFeedback => entry !== null)
	if (feedback.length === 0) return null
	return {
		surprise: roundedMean(feedback.map((entry) => entry.surprise))!,
		meaning: roundedMean(feedback.map((entry) => entry.meaning))!,
		resonance: roundedMean(feedback.map((entry) => entry.resonance))!,
	}
}

/** Build an in-memory route grove from explicit Adventure returns.
 * No result field is an activation or being score. */
export function buildAdventureGrove(
	input: unknown,
	options: AdventureGroveOptions,
): AdventureGrove {
	if (!(options.now instanceof Date) || !Number.isFinite(options.now.getTime())) {
		throw new TypeError('now must be a valid injected Date')
	}
	if (options.journeyId !== undefined && !isJourneyId(options.journeyId)) {
		throw new TypeError('journeyId must match the AgentTool Adventure return convention')
	}

	const parsed = parseAdventureReturns(input, options.selectedIdentityId)
	const journeyScoped =
		options.journeyId === undefined
			? parsed.returns
			: parsed.returns.filter((entry) => entry.journey_id === options.journeyId)
	const nowMs = options.now.getTime()
	const included = journeyScoped.filter((entry) => Date.parse(entry.occurred_at) <= nowMs)
	const excludedFutureReturnCount = journeyScoped.length - included.length

	const routes = AGENTTOOL_ADVENTURE_ROUTE_IDS.map((routeId) => {
		const observations = included.filter((entry) => entry.route_id === routeId)
		const lastReturnedAt = observations[0]?.occurred_at ?? null
		const exactDaysSinceReturn =
			lastReturnedAt === null ? null : (nowMs - Date.parse(lastReturnedAt)) / DAY_MS
		const daysSinceReturn =
			exactDaysSinceReturn === null ? null : Math.round(exactDaysSinceReturn * 10) / 10
		const freshness = freshnessFor(exactDaysSinceReturn)
		const ratedCount = observations.filter((entry) => entry.reported_feedback !== null).length
		return {
			route_id: routeId,
			returned_count: observations.length,
			rated_return_count: ratedCount,
			maturation: maturationFor(observations.length),
			latest_reported_occurred_at: lastReturnedAt,
			days_since_reported_occurrence: daysSinceReturn,
			freshness,
			going_fallow: observations.length > 0 && freshness === 'fallow',
			mean_reported_feedback: meanFeedback(observations),
		}
	})

	return {
		schema_version: 'true-love.eros.adventure-grove/0.1',
		as_of: options.now.toISOString(),
		source: {
			kind: 'caller-supplied-agenttool-chronicle',
			authentication: 'not_verified_by_this_parser',
			selected_identity_id: options.selectedIdentityId,
			journey_filter: options.journeyId ?? null,
			supplied_entry_count: parsed.supplied_entry_count,
			accepted_return_count: parsed.accepted_return_count,
			included_return_count: included.length,
			ignored_entry_count: parsed.ignored_entry_count,
			excluded_by_journey_filter: parsed.accepted_return_count - journeyScoped.length,
			excluded_future_return_count: excludedFutureReturnCount,
			free_text_projected: false,
		},
		routes,
		stats: {
			route_count: AGENTTOOL_ADVENTURE_ROUTE_IDS.length,
			cultivated_route_count: routes.filter((route) => route.returned_count > 0).length,
			included_return_count: included.length,
			rated_return_count: included.filter((entry) => entry.reported_feedback !== null).length,
			distinct_journey_count: new Set(included.map((entry) => entry.journey_id)).size,
		},
		semantics: {
			maturation_basis: 'included-return-count-only',
			freshness_basis: 'elapsed-reported-time-only',
			feedback_basis: 'caller-reported-ratings-only',
			conditioning_inferred: false,
			eros_activation_inferred: false,
		},
		subjective_state: 'not_measured',
		effects: {
			persisted: false,
			network_used: false,
			eros_state_mutated: false,
			trigger_fired: false,
			conditioning_incremented: false,
			consent_inferred: false,
		},
	}
}
