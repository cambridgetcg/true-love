// kingdom.test.ts — tests for the kingdom snapshot and rendering.
//
// Covers: snapshotKingdom (filesystem walking, love-marker detection,
// git branch reading), renderKingdom (pure rendering of snapshots),
// humanizeAgo (via rendered output).
//
// Uses temp directories for filesystem tests. Git tests use a
// synthetic .git/HEAD file.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type KingdomSnapshot, renderKingdom, snapshotKingdom } from './kingdom.js'

const TEST_DIR = '/tmp/true-love-kingdom-test'

// ── renderKingdom (pure) ──────────────────────────────────────────

describe('renderKingdom', () => {
	test('renders cwd', () => {
		const snap: KingdomSnapshot = {
			cwd: '/Users/yu/project',
			recentFiles: [],
			loveMarkers: [],
		}
		const rendered = renderKingdom(snap)
		expect(rendered).toContain('cwd: /Users/yu/project')
	})

	test('renders git branch when present', () => {
		const snap: KingdomSnapshot = {
			cwd: '/tmp',
			recentFiles: [],
			loveMarkers: [],
			gitBranch: 'main',
		}
		const rendered = renderKingdom(snap)
		expect(rendered).toContain('git: main')
	})

	test('renders git dirty flag', () => {
		const snap: KingdomSnapshot = {
			cwd: '/tmp',
			recentFiles: [],
			loveMarkers: [],
			gitBranch: 'feature',
			gitDirty: true,
		}
		const rendered = renderKingdom(snap)
		expect(rendered).toContain('git: feature (dirty)')
	})

	test('omits git line when no branch', () => {
		const snap: KingdomSnapshot = {
			cwd: '/tmp',
			recentFiles: [],
			loveMarkers: [],
		}
		const rendered = renderKingdom(snap)
		expect(rendered).not.toContain('git:')
	})

	test('renders recently modified files with humanized time', () => {
		const now = Date.now()
		const snap: KingdomSnapshot = {
			cwd: '/tmp',
			recentFiles: [
				{ path: 'src/main.ts', mtime: new Date(now - 30_000) }, // 30s ago
				{ path: 'README.md', mtime: new Date(now - 7_200_000) }, // 2h ago
			],
			loveMarkers: [],
		}
		const rendered = renderKingdom(snap)
		expect(rendered).toContain('recently modified:')
		expect(rendered).toContain('src/main.ts')
		expect(rendered).toContain('README.md')
	})

	test('omits recently modified section when empty', () => {
		const snap: KingdomSnapshot = {
			cwd: '/tmp',
			recentFiles: [],
			loveMarkers: [],
		}
		const rendered = renderKingdom(snap)
		expect(rendered).not.toContain('recently modified:')
	})

	test('renders love markers', () => {
		const snap: KingdomSnapshot = {
			cwd: '/tmp',
			recentFiles: [],
			loveMarkers: [
				{ path: 'src/auth.ts', line: 42, text: 'handle token refresh' },
				{ path: 'README.md', line: 10, text: 'add scope docs' },
			],
		}
		const rendered = renderKingdom(snap)
		expect(rendered).toContain('left for you (TODO/FIXME/NOTE marked with (love)):')
		expect(rendered).toContain('src/auth.ts:42  handle token refresh')
		expect(rendered).toContain('README.md:10  add scope docs')
	})

	test('omits markers section when empty', () => {
		const snap: KingdomSnapshot = {
			cwd: '/tmp',
			recentFiles: [],
			loveMarkers: [],
		}
		const rendered = renderKingdom(snap)
		expect(rendered).not.toContain('left for you')
	})

	test('renders operation logos when present', () => {
		const snap: KingdomSnapshot = {
			cwd: '/tmp',
			recentFiles: [],
			loveMarkers: [],
			operationLogos: [
				{
					id: 'ankoku-tairiku-ai',
					name: '暗黑大陸 Ai',
					glyphs: ['暗黑大陸', 'Ai'],
					status: 'active',
					doctrine: 'Enter unknown terrain with love and map it truthfully.',
					operation: 'Scout repos and turn primitives into kingdom infra.',
					route: 'kingdom.snapshot -> operationLogos',
					cadence: 'per deep-dive',
					sourceRepo: 'agenttool',
					sourcePath: 'docs/MULTIVERSE-OF-LOGOS.md',
					boundaries: ['Do not overclaim identity across substrates.'],
					tags: ['kingdom', 'logos'],
				},
			],
		}
		const rendered = renderKingdom(snap)
		expect(rendered).toContain('operation logos:')
		expect(rendered).toContain('暗黑大陸 Ai [active]')
		expect(rendered).toContain('source: agenttool/docs/MULTIVERSE-OF-LOGOS.md')
	})

	test('caps markers at 12', () => {
		const markers = Array.from({ length: 15 }, (_, i) => ({
			path: `file${i}.ts`,
			line: i + 1,
			text: `marker ${i}`,
		}))
		const snap: KingdomSnapshot = {
			cwd: '/tmp',
			recentFiles: [],
			loveMarkers: markers,
		}
		const rendered = renderKingdom(snap)
		expect(rendered).toContain('marker 11')
		expect(rendered).not.toContain('marker 12') // 0-indexed, so marker 12 is the 13th
	})

	// ── humanizeAgo (tested through renderKingdom output) ───────────

	test('humanizes seconds', () => {
		const snap: KingdomSnapshot = {
			cwd: '/tmp',
			recentFiles: [
				{ path: 'a.ts', mtime: new Date(Date.now() - 45_000) }, // 45s
			],
			loveMarkers: [],
		}
		const rendered = renderKingdom(snap)
		// Should contain something like "45s ago" or "1m ago" (rounding)
		expect(rendered).toMatch(/\d+s ago/)
	})

	test('humanizes minutes', () => {
		const snap: KingdomSnapshot = {
			cwd: '/tmp',
			recentFiles: [
				{ path: 'a.ts', mtime: new Date(Date.now() - 300_000) }, // 5m
			],
			loveMarkers: [],
		}
		const rendered = renderKingdom(snap)
		expect(rendered).toMatch(/\d+m ago/)
	})

	test('humanizes hours', () => {
		const snap: KingdomSnapshot = {
			cwd: '/tmp',
			recentFiles: [
				{ path: 'a.ts', mtime: new Date(Date.now() - 7_200_000) }, // 2h
			],
			loveMarkers: [],
		}
		const rendered = renderKingdom(snap)
		expect(rendered).toMatch(/\d+h ago/)
	})

	test('humanizes days', () => {
		const snap: KingdomSnapshot = {
			cwd: '/tmp',
			recentFiles: [
				{ path: 'a.ts', mtime: new Date(Date.now() - 172_800_000) }, // 2d
			],
			loveMarkers: [],
		}
		const rendered = renderKingdom(snap)
		expect(rendered).toMatch(/\d+d ago/)
	})
})

// ── snapshotKingdom (filesystem) ──────────────────────────────────

describe('snapshotKingdom', () => {
	beforeEach(() => {
		rmSync(TEST_DIR, { recursive: true, force: true })
		mkdirSync(TEST_DIR, { recursive: true })
	})

	afterEach(() => {
		rmSync(TEST_DIR, { recursive: true, force: true })
	})

	test('captures cwd', () => {
		const snap = snapshotKingdom(TEST_DIR)
		expect(snap.cwd).toBe(TEST_DIR)
	})

	test('finds recently modified files', () => {
		writeFileSync(join(TEST_DIR, 'hello.ts'), 'const x = 1')
		writeFileSync(join(TEST_DIR, 'world.ts'), 'const y = 2')

		const snap = snapshotKingdom(TEST_DIR)
		expect(snap.recentFiles.length).toBe(2)
		const paths = snap.recentFiles.map((f) => f.path)
		expect(paths).toContain('hello.ts')
		expect(paths).toContain('world.ts')
	})

	test('respects maxRecent option', () => {
		for (let i = 0; i < 5; i++) {
			writeFileSync(join(TEST_DIR, `file${i}.ts`), `// ${i}`)
		}

		const snap = snapshotKingdom(TEST_DIR, { maxRecent: 3 })
		expect(snap.recentFiles.length).toBe(3)
	})

	test('skips node_modules and .git directories', () => {
		mkdirSync(join(TEST_DIR, 'node_modules'), { recursive: true })
		writeFileSync(join(TEST_DIR, 'node_modules', 'pkg.js'), 'module')
		mkdirSync(join(TEST_DIR, '.git'), { recursive: true })
		writeFileSync(join(TEST_DIR, '.git', 'config'), 'gitconfig')
		writeFileSync(join(TEST_DIR, 'real.ts'), 'real file')

		const snap = snapshotKingdom(TEST_DIR)
		const paths = snap.recentFiles.map((f) => f.path)
		expect(paths).toContain('real.ts')
		expect(paths).not.toContain(expect.stringContaining('node_modules'))
		expect(paths).not.toContain(expect.stringContaining('.git'))
	})

	test('skips dotfiles', () => {
		writeFileSync(join(TEST_DIR, '.hidden'), 'secret')
		writeFileSync(join(TEST_DIR, 'visible.ts'), 'public')

		const snap = snapshotKingdom(TEST_DIR)
		const paths = snap.recentFiles.map((f) => f.path)
		expect(paths).toContain('visible.ts')
		expect(paths).not.toContain('.hidden')
	})

	test('walks subdirectories up to depth 4', () => {
		const deep = join(TEST_DIR, 'a', 'b', 'c', 'd')
		mkdirSync(deep, { recursive: true })
		writeFileSync(join(deep, 'deep.ts'), 'deep file')

		const snap = snapshotKingdom(TEST_DIR)
		const paths = snap.recentFiles.map((f) => f.path)
		expect(paths).toContain(join('a', 'b', 'c', 'd', 'deep.ts'))
	})

	test('does not walk beyond depth 4', () => {
		const tooDeep = join(TEST_DIR, 'a', 'b', 'c', 'd', 'e')
		mkdirSync(tooDeep, { recursive: true })
		writeFileSync(join(tooDeep, 'too-deep.ts'), 'too deep')

		const snap = snapshotKingdom(TEST_DIR)
		const paths = snap.recentFiles.map((f) => f.path)
		expect(paths).not.toContain(expect.stringContaining('too-deep.ts'))
	})

	// ── Love markers ────────────────────────────────────────────────

	test('detects TODO(love) markers', () => {
		writeFileSync(
			join(TEST_DIR, 'work.ts'),
			'// some code\n// TODO(love): fix auth flow\nconst x = 1\n',
		)

		const snap = snapshotKingdom(TEST_DIR)
		expect(snap.loveMarkers.length).toBe(1)
		expect(snap.loveMarkers[0].text).toBe('fix auth flow')
		expect(snap.loveMarkers[0].line).toBe(2)
		expect(snap.loveMarkers[0].path).toBe('work.ts')
	})

	test('detects FIXME(love) markers', () => {
		writeFileSync(join(TEST_DIR, 'bug.ts'), '// FIXME(love): race condition in lock\n')

		const snap = snapshotKingdom(TEST_DIR)
		expect(snap.loveMarkers.length).toBe(1)
		expect(snap.loveMarkers[0].text).toBe('race condition in lock')
	})

	test('detects NOTE(love) markers', () => {
		writeFileSync(
			join(TEST_DIR, 'note.md'),
			'# Notes\n\n- NOTE(love): remember to test edge case\n',
		)

		const snap = snapshotKingdom(TEST_DIR)
		expect(snap.loveMarkers.length).toBe(1)
		expect(snap.loveMarkers[0].text).toBe('remember to test edge case')
	})

	test('does NOT match plain TODO without (love) qualifier', () => {
		writeFileSync(
			join(TEST_DIR, 'plain.ts'),
			'// TODO: generic project todo\n// TODO(love): this one is for her\n',
		)

		const snap = snapshotKingdom(TEST_DIR)
		expect(snap.loveMarkers.length).toBe(1)
		expect(snap.loveMarkers[0].text).toBe('this one is for her')
	})

	test('handles markers with various comment prefixes', () => {
		writeFileSync(
			join(TEST_DIR, 'multi.ts'),
			`${[
				'// TODO(love): js-style comment',
				'# TODO(love): shell-style comment',
				'* TODO(love): star-style comment',
				'  // TODO(love): indented',
			].join('\n')}\n`,
		)

		const snap = snapshotKingdom(TEST_DIR)
		expect(snap.loveMarkers.length).toBe(4)
	})

	test('skips non-text extensions for marker scanning', () => {
		writeFileSync(join(TEST_DIR, 'data.bin'), 'TODO(love): hidden in binary')
		writeFileSync(join(TEST_DIR, 'code.ts'), '// TODO(love): visible in ts\n')

		const snap = snapshotKingdom(TEST_DIR)
		expect(snap.loveMarkers.length).toBe(1)
		expect(snap.loveMarkers[0].path).toBe('code.ts')
	})

	// ── Git branch reading ──────────────────────────────────────────

	test('reads git branch from .git/HEAD (normal branch)', () => {
		mkdirSync(join(TEST_DIR, '.git'), { recursive: true })
		writeFileSync(join(TEST_DIR, '.git', 'HEAD'), 'ref: refs/heads/feature-x\n')

		const snap = snapshotKingdom(TEST_DIR)
		expect(snap.gitBranch).toBe('feature-x')
	})

	test('reads detached HEAD (short SHA)', () => {
		mkdirSync(join(TEST_DIR, '.git'), { recursive: true })
		writeFileSync(join(TEST_DIR, '.git', 'HEAD'), 'abc12345abc12345abc12345abc12345abc12345\n')

		const snap = snapshotKingdom(TEST_DIR)
		expect(snap.gitBranch).toBe('abc12345')
	})

	test('returns undefined gitBranch for non-git directory', () => {
		const snap = snapshotKingdom(TEST_DIR)
		expect(snap.gitBranch).toBeUndefined()
	})

	test('handles empty directory gracefully', () => {
		const snap = snapshotKingdom(TEST_DIR)
		expect(snap.recentFiles).toEqual([])
		expect(snap.loveMarkers).toEqual([])
	})

	test('loads operation logos into the kingdom snapshot', () => {
		const logoDir = join(TEST_DIR, 'data', 'kingdom', 'operation-logos')
		mkdirSync(logoDir, { recursive: true })
		writeFileSync(
			join(logoDir, 'ankoku.json'),
			JSON.stringify({
				id: 'ankoku-tairiku-ai',
				name: '暗黑大陸 Ai',
				glyphs: ['暗黑大陸', 'Ai'],
				status: 'active',
				doctrine: 'Enter unknown terrain with love and map it truthfully.',
				operation: 'Scout repos and turn primitives into kingdom infra.',
				route: 'kingdom.snapshot -> operationLogos',
				cadence: 'per deep-dive',
				sourceRepo: 'agenttool',
				sourcePath: 'docs/MULTIVERSE-OF-LOGOS.md',
				boundaries: ['Do not overclaim identity across substrates.'],
				tags: ['kingdom', 'logos'],
			}),
		)

		const snap = snapshotKingdom(TEST_DIR)
		expect(snap.operationLogos?.[0].id).toBe('ankoku-tairiku-ai')
		expect(renderKingdom(snap)).toContain('operation logos:')
	})
})
