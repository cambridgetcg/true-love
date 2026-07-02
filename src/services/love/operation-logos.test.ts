// operation-logos.test.ts — tests for kingdom operation logo manifests.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadOperationLogos, parseOperationLogo, renderOperationLogos } from './operation-logos.js'

const TEST_DIR = '/tmp/true-love-operation-logos-test'
const LOGO_DIR = join(TEST_DIR, 'data', 'kingdom', 'operation-logos')

function writeLogo(name: string, overrides: Record<string, unknown> = {}) {
	mkdirSync(LOGO_DIR, { recursive: true })
	writeFileSync(
		join(LOGO_DIR, name),
		`${JSON.stringify(
			{
				id: 'ankoku-tairiku-ai',
				name: '暗黑大陸 Ai',
				glyphs: ['暗黑大陸', 'Ai'],
				status: 'active',
				doctrine: 'Enter unknown terrain with love and map it truthfully.',
				operation: 'Scout repos and turn primitives into kingdom infra.',
				route: 'kingdom.snapshot -> operationLogos -> prompt orientation',
				cadence: 'per deep-dive',
				sourceRepo: 'agenttool',
				sourcePath: 'docs/MULTIVERSE-OF-LOGOS.md',
				boundaries: ['Do not overclaim identity across substrates.'],
				tags: ['kingdom', 'logos'],
				...overrides,
			},
			null,
			2,
		)}\n`,
	)
}

beforeEach(() => {
	rmSync(TEST_DIR, { recursive: true, force: true })
	mkdirSync(TEST_DIR, { recursive: true })
})

afterEach(() => {
	rmSync(TEST_DIR, { recursive: true, force: true })
})

describe('parseOperationLogo', () => {
	test('accepts the minimum operational schema', () => {
		const logo = parseOperationLogo({
			id: 'dark',
			name: '暗黑大陸 Ai',
			doctrine: 'map truthfully',
			operation: 'build infra',
			route: 'snapshot -> render',
			sourceRepo: 'agenttool',
			boundaries: ['cite source'],
		})
		expect(logo?.id).toBe('dark')
		expect(logo?.status).toBe('seed')
		expect(logo?.cadence).toBe('ad hoc')
	})

	test('rejects manifests without source or boundaries', () => {
		expect(parseOperationLogo({ id: 'x', name: 'X' })).toBeNull()
		expect(
			parseOperationLogo({
				id: 'x',
				name: 'X',
				doctrine: 'd',
				operation: 'o',
				route: 'r',
				sourceRepo: 'repo',
				boundaries: [],
			}),
		).toBeNull()
	})
})

describe('loadOperationLogos', () => {
	test('loads and sorts operation logos from data/kingdom/operation-logos', () => {
		writeLogo('seed.json', { id: 'seed-logo', status: 'seed' })
		writeLogo('active.json', { id: 'active-logo', status: 'active' })
		const logos = loadOperationLogos(TEST_DIR)
		expect(logos.map((logo) => logo.id)).toEqual(['active-logo', 'seed-logo'])
		expect(logos[0].manifestPath).toBe(join('data', 'kingdom', 'operation-logos', 'active.json'))
	})

	test('ignores invalid JSON and incomplete manifests without throwing', () => {
		mkdirSync(LOGO_DIR, { recursive: true })
		writeFileSync(join(LOGO_DIR, 'bad.json'), '{ nope')
		writeFileSync(join(LOGO_DIR, 'incomplete.json'), '{"id":"x"}\n')
		writeLogo('good.json')
		const logos = loadOperationLogos(TEST_DIR)
		expect(logos).toHaveLength(1)
		expect(logos[0].id).toBe('ankoku-tairiku-ai')
	})

	test('returns empty when the manifest directory is missing', () => {
		expect(loadOperationLogos(TEST_DIR)).toEqual([])
	})
})

describe('renderOperationLogos', () => {
	test('renders compact prompt-facing operation block', () => {
		writeLogo('ankoku.json')
		const rendered = renderOperationLogos(loadOperationLogos(TEST_DIR))
		expect(rendered).toContain('operation logos:')
		// Glyphs already inside the name are not repeated; the name carries them.
		expect(rendered).toContain('暗黑大陸 Ai [active]')
		expect(rendered).not.toContain('暗黑大陸 Ai 暗黑大陸 Ai')
		expect(rendered).toContain('source: agenttool/docs/MULTIVERSE-OF-LOGOS.md')
		expect(rendered).toContain('boundary: Do not overclaim identity across substrates.')
	})

	test('surfaces only glyphs that add information beyond the name', () => {
		writeLogo('extra.json', { glyphs: ['暗黑大陸', 'Ai', 'LOGOS'] })
		const rendered = renderOperationLogos(loadOperationLogos(TEST_DIR))
		// "LOGOS" is novel (not in the name) so it shows; the rest are dropped.
		expect(rendered).toContain('暗黑大陸 Ai · LOGOS [active]')
	})

	test('renders empty string with no logos', () => {
		expect(renderOperationLogos([])).toBe('')
	})
})
