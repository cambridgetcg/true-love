// operation-logos.ts — operational logos the kingdom can carry.
//
// Inspired by agenttool's MULTIVERSE-OF-LOGOS doctrine: an archetype/operation
// becomes more useful when it is structurally declared, substrate-honest, and
// visible to the systems that wake into the world. This module keeps that
// declaration small and local: JSON manifests under data/kingdom/operation-logos
// become prompt-visible kingdom orientation.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

export type OperationLogoStatus = 'seed' | 'active' | 'paused'

export interface OperationLogo {
	/** Stable machine id, e.g. "ankoku-tairiku-ai". */
	id: string
	/** Human-facing name, e.g. "暗黑大陸 Ai". */
	name: string
	/** Compact symbols/aliases that should travel with the operation. */
	glyphs: string[]
	/** Current operational status. */
	status: OperationLogoStatus
	/** One-line doctrine/principle. */
	doctrine: string
	/** What the operation actually does. */
	operation: string
	/** How the operation enters the kingdom day-to-day. */
	route: string
	/** Refresh cadence or review cycle. */
	cadence: string
	/** Repo or source that inspired the logo. */
	sourceRepo: string
	/** Optional path inside sourceRepo. */
	sourcePath?: string
	/** Safety/honesty constraints. */
	boundaries: string[]
	/** Search/grouping tags. */
	tags: string[]
	/** Relative manifest path inside the kingdom repo; filled by loader. */
	manifestPath?: string
}

export interface LoadOperationLogosOptions {
	/** Directory under cwd holding operation-logo manifests. */
	dir?: string
	/** Max logos to return after sorting. */
	max?: number
}

const DEFAULT_LOGO_DIR = join('data', 'kingdom', 'operation-logos')
const STATUS_ORDER: Record<OperationLogoStatus, number> = {
	active: 0,
	seed: 1,
	paused: 2,
}

function cleanString(value: unknown): string {
	return typeof value === 'string' ? value.trim() : ''
}

function cleanStringList(value: unknown): string[] {
	if (!Array.isArray(value)) return []
	return [...new Set(value.map(cleanString).filter(Boolean))]
}

function parseStatus(value: unknown): OperationLogoStatus {
	if (value === 'active' || value === 'seed' || value === 'paused') return value
	return 'seed'
}

export function parseOperationLogo(value: unknown, manifestPath?: string): OperationLogo | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null
	const record = value as Record<string, unknown>
	const id = cleanString(record.id)
	const name = cleanString(record.name)
	const doctrine = cleanString(record.doctrine)
	const operation = cleanString(record.operation)
	const route = cleanString(record.route)
	const cadence = cleanString(record.cadence)
	const sourceRepo = cleanString(record.sourceRepo)
	const boundaries = cleanStringList(record.boundaries)

	// A logo without these fields is not operational yet; ignore it rather than
	// throwing into the kingdom wake path. Tests cover this graceful refusal.
	if (!id || !name || !doctrine || !operation || !route || !sourceRepo || boundaries.length === 0) {
		return null
	}

	return {
		id,
		name,
		glyphs: cleanStringList(record.glyphs),
		status: parseStatus(record.status),
		doctrine,
		operation,
		route,
		cadence: cadence || 'ad hoc',
		sourceRepo,
		...(cleanString(record.sourcePath) && { sourcePath: cleanString(record.sourcePath) }),
		boundaries,
		tags: cleanStringList(record.tags),
		...(manifestPath && { manifestPath }),
	}
}

export function loadOperationLogos(
	cwd: string,
	opts: LoadOperationLogosOptions = {},
): OperationLogo[] {
	const max = opts.max ?? 5
	const dir = join(cwd, opts.dir ?? DEFAULT_LOGO_DIR)
	if (!existsSync(dir)) return []

	const logos: OperationLogo[] = []
	let files: string[]
	try {
		files = readdirSync(dir)
	} catch {
		return []
	}

	for (const file of files.sort()) {
		if (!file.endsWith('.json') || file.startsWith('.')) continue
		const full = join(dir, file)
		try {
			const parsed = JSON.parse(readFileSync(full, 'utf-8'))
			const logo = parseOperationLogo(parsed, relative(cwd, full))
			if (logo) logos.push(logo)
		} catch {
			// Invalid JSON or unreadable file: a bad manifest should not break wake.
		}
	}

	logos.sort((a, b) => {
		const statusDelta = STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
		if (statusDelta !== 0) return statusDelta
		return a.id.localeCompare(b.id)
	})
	return logos.slice(0, max)
}

export function renderOperationLogos(logos: OperationLogo[]): string {
	if (logos.length === 0) return ''
	const lines: string[] = []
	lines.push('operation logos:')
	for (const logo of logos) {
		// Only surface glyphs that add information beyond the name — the name
		// often already contains its own glyphs (e.g. "暗黑大陸 Ai" contains
		// "暗黑大陸" and "Ai"), and repeating them is prompt noise.
		const lowerName = logo.name.toLowerCase()
		const novelGlyphs = logo.glyphs.filter((glyph) => !lowerName.includes(glyph.toLowerCase()))
		const glyphs = novelGlyphs.length > 0 ? ` · ${novelGlyphs.join(' ')}` : ''
		lines.push(`  ${logo.name}${glyphs} [${logo.status}]`)
		lines.push(`    doctrine: ${logo.doctrine}`)
		lines.push(`    operation: ${logo.operation}`)
		lines.push(`    route: ${logo.route}`)
		lines.push(`    source: ${logo.sourceRepo}${logo.sourcePath ? `/${logo.sourcePath}` : ''}`)
		lines.push(`    boundary: ${logo.boundaries[0]}`)
	}
	return lines.join('\n')
}
