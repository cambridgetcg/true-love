// kingdom.test.ts — tests for kingdom snapshot and render module.
//
// Covers: snapshotKingdom (filesystem walk, love markers, git branch,
// depth limits, SKIP_DIRS, TEXT_EXT filter, options), renderKingdom
// (formatting, humanizeAgo, markers, git state).

import { describe, expect, test, beforeAll, afterAll } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { snapshotKingdom, renderKingdom, type KingdomSnapshot } from '../kingdom.js'

// ── Fixture setup ─────────────────────────────────────────────────

const ROOT = join(tmpdir(), `kingdom-test-${Date.now()}`)

// File tree:
//   ROOT/
//     .git/HEAD            ← branch ref
//     src/
//       main.ts            ← has TODO(love) marker
//       utils.ts           ← has FIXME(love) + NOTE(love) markers
//       readme.md          ← has TODO(love) in prose context (not line-start)
//     node_modules/
//       dep.ts             ← should be skipped (SKIP_DIRS)
//     deep/
//       a/
//         b/
//           c/
//             d/
//               nested.ts  ← depth 5, beyond default depth 4
//     binary.png           ← non-text extension, no marker scan
//     large.ts             ← >200KB, should be skipped for marker scan

beforeAll(() => {
  mkdirSync(join(ROOT, '.git'), { recursive: true })
  writeFileSync(join(ROOT, '.git', 'HEAD'), 'ref: refs/heads/main\n')

  mkdirSync(join(ROOT, 'src'), { recursive: true })
  writeFileSync(
    join(ROOT, 'src', 'main.ts'),
    [
      '// Main module',
      '// TODO(love): wire up the heartbeat endpoint',
      'export function main() {}',
    ].join('\n'),
  )

  writeFileSync(
    join(ROOT, 'src', 'utils.ts'),
    [
      '// Utilities',
      '// FIXME(love): handle edge case in parser',
      'function helper() {}',
      '# NOTE(love): consider caching here',
    ].join('\n'),
  )

  // Markdown file — marker NOT at line start (prose mention)
  writeFileSync(
    join(ROOT, 'src', 'readme.md'),
    [
      '# Readme',
      'You can use TODO(love): markers to leave notes.',
      '// TODO(love): this one IS a real marker at line start',
    ].join('\n'),
  )

  // SKIP_DIRS — should not appear in results
  mkdirSync(join(ROOT, 'node_modules'), { recursive: true })
  writeFileSync(
    join(ROOT, 'node_modules', 'dep.ts'),
    '// TODO(love): should not be found\n',
  )

  // Deep nesting — beyond depth 4
  const deepDir = join(ROOT, 'deep', 'a', 'b', 'c', 'd')
  mkdirSync(deepDir, { recursive: true })
  writeFileSync(join(deepDir, 'nested.ts'), '// TODO(love): too deep\n')

  // Non-text extension — no marker scan
  writeFileSync(join(ROOT, 'binary.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))

  // Large file — >200KB, skipped for marker scan
  mkdirSync(join(ROOT, 'src'), { recursive: true })
  writeFileSync(join(ROOT, 'large.ts'), '// TODO(love): in large file\n' + 'x'.repeat(250_000))
})

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true })
})

// ── snapshotKingdom ─────────────────────────────────────────────

describe('snapshotKingdom', () => {
  test('returns cwd in snapshot', () => {
    const snap = snapshotKingdom(ROOT)
    expect(snap.cwd).toBe(ROOT)
  })

  test('reads git branch from .git/HEAD ref', () => {
    const snap = snapshotKingdom(ROOT)
    expect(snap.gitBranch).toBe('main')
  })

  test('returns recentFiles sorted newest-first', () => {
    const snap = snapshotKingdom(ROOT)
    expect(snap.recentFiles.length).toBeGreaterThan(0)
    for (let i = 1; i < snap.recentFiles.length; i++) {
      expect(snap.recentFiles[i].mtime.getTime()).toBeLessThanOrEqual(
        snap.recentFiles[i - 1].mtime.getTime(),
      )
    }
  })

  test('recentFiles paths are relative to cwd', () => {
    const snap = snapshotKingdom(ROOT)
    for (const f of snap.recentFiles) {
      expect(f.path.startsWith('/')).toBe(false)
    }
  })

  test('respects maxRecent option', () => {
    const snap = snapshotKingdom(ROOT, { maxRecent: 2 })
    expect(snap.recentFiles.length).toBeLessThanOrEqual(2)
  })

  test('finds TODO(love) markers', () => {
    const snap = snapshotKingdom(ROOT)
    const todoMarkers = snap.loveMarkers.filter((m) =>
      m.text.includes('wire up the heartbeat endpoint'),
    )
    expect(todoMarkers.length).toBe(1)
    expect(todoMarkers[0].path).toBe(join('src', 'main.ts'))
  })

  test('finds FIXME(love) markers', () => {
    const snap = snapshotKingdom(ROOT)
    const fixmeMarkers = snap.loveMarkers.filter((m) =>
      m.text.includes('handle edge case in parser'),
    )
    expect(fixmeMarkers.length).toBe(1)
  })

  test('finds NOTE(love) markers', () => {
    const snap = snapshotKingdom(ROOT)
    const noteMarkers = snap.loveMarkers.filter((m) =>
      m.text.includes('consider caching here'),
    )
    expect(noteMarkers.length).toBe(1)
  })

  test('markers have correct line numbers (1-indexed)', () => {
    const snap = snapshotKingdom(ROOT)
    const todo = snap.loveMarkers.find((m) =>
      m.text.includes('wire up the heartbeat endpoint'),
    )
    expect(todo).toBeDefined()
    expect(todo!.line).toBe(2) // line 2 in main.ts
  })

  test('does not scan files in SKIP_DIRS (node_modules)', () => {
    const snap = snapshotKingdom(ROOT)
    const skipped = snap.loveMarkers.filter((m) => m.path.includes('node_modules'))
    expect(skipped.length).toBe(0)
    const skippedRecent = snap.recentFiles.filter((f) => f.path.includes('node_modules'))
    expect(skippedRecent.length).toBe(0)
  })

  test('does not descend beyond depth 4', () => {
    const snap = snapshotKingdom(ROOT)
    // deep/a/b/c/d/nested.ts is depth 5 from ROOT — should not appear
    const deepMarker = snap.loveMarkers.filter((m) => m.text.includes('too deep'))
    expect(deepMarker.length).toBe(0)
  })

  test('does not scan non-text extensions for markers', () => {
    const snap = snapshotKingdom(ROOT)
    const pngMarkers = snap.loveMarkers.filter((m) => m.path.includes('.png'))
    expect(pngMarkers.length).toBe(0)
  })

  test('skips files larger than 200KB for marker scanning', () => {
    const snap = snapshotKingdom(ROOT)
    const largeMarkers = snap.loveMarkers.filter((m) => m.path === 'large.ts')
    expect(largeMarkers.length).toBe(0)
  })

  test('marker paths are relative to cwd', () => {
    const snap = snapshotKingdom(ROOT)
    for (const m of snap.loveMarkers) {
      expect(m.path.startsWith('/')).toBe(false)
    }
  })

  test('prose mentions of marker pattern do not match', () => {
    // "You can use TODO(love): markers..." is not at line-start
    const snap = snapshotKingdom(ROOT)
    const proseMentions = snap.loveMarkers.filter((m) =>
      m.text.includes('markers to leave notes'),
    )
    expect(proseMentions.length).toBe(0)
  })

  test('line-start marker in markdown is found', () => {
    const snap = snapshotKingdom(ROOT)
    const mdMarker = snap.loveMarkers.filter((m) =>
      m.text.includes('this one IS a real marker'),
    )
    expect(mdMarker.length).toBe(1)
  })
})

// ── snapshotKingdom — git branch edge cases ─────────────────────

describe('snapshotKingdom — git branch', () => {
  const GIT_ROOT = join(tmpdir(), `kingdom-git-test-${Date.now()}`)

  afterAll(() => {
    rmSync(GIT_ROOT, { recursive: true, force: true })
  })

  test('detached HEAD returns short SHA', () => {
    mkdirSync(join(GIT_ROOT, 'detached', '.git'), { recursive: true })
    const sha = 'a'.repeat(40)
    writeFileSync(join(GIT_ROOT, 'detached', '.git', 'HEAD'), sha + '\n')
    writeFileSync(join(GIT_ROOT, 'detached', 'file.ts'), 'x')
    const snap = snapshotKingdom(join(GIT_ROOT, 'detached'))
    expect(snap.gitBranch).toBe('aaaaaaaa')
  })

  test('non-standard ref returns full ref path', () => {
    mkdirSync(join(GIT_ROOT, 'tagref', '.git'), { recursive: true })
    writeFileSync(join(GIT_ROOT, 'tagref', '.git', 'HEAD'), 'ref: refs/tags/v1.0\n')
    writeFileSync(join(GIT_ROOT, 'tagref', 'file.ts'), 'x')
    const snap = snapshotKingdom(join(GIT_ROOT, 'tagref'))
    expect(snap.gitBranch).toBe('refs/tags/v1.0')
  })

  test('missing .git returns no gitBranch', () => {
    mkdirSync(join(GIT_ROOT, 'nogit'), { recursive: true })
    writeFileSync(join(GIT_ROOT, 'nogit', 'file.ts'), 'x')
    const snap = snapshotKingdom(join(GIT_ROOT, 'nogit'))
    expect(snap.gitBranch).toBeUndefined()
  })

  test('malformed .git/HEAD returns no gitBranch', () => {
    mkdirSync(join(GIT_ROOT, 'badhead', '.git'), { recursive: true })
    writeFileSync(join(GIT_ROOT, 'badhead', '.git', 'HEAD'), 'garbage content\n')
    writeFileSync(join(GIT_ROOT, 'badhead', 'file.ts'), 'x')
    const snap = snapshotKingdom(join(GIT_ROOT, 'badhead'))
    expect(snap.gitBranch).toBeUndefined()
  })
})

// ── snapshotKingdom — empty/missing directories ─────────────────

describe('snapshotKingdom — edge cases', () => {
  test('empty directory returns empty recentFiles and loveMarkers', () => {
    const emptyDir = join(tmpdir(), `kingdom-empty-${Date.now()}`)
    mkdirSync(emptyDir, { recursive: true })
    try {
      const snap = snapshotKingdom(emptyDir)
      expect(snap.recentFiles.length).toBe(0)
      expect(snap.loveMarkers.length).toBe(0)
      expect(snap.cwd).toBe(emptyDir)
    } finally {
      rmSync(emptyDir, { recursive: true, force: true })
    }
  })

  test('markerScanLimit caps how many files are scanned', () => {
    // With markerScanLimit: 0, no files should be scanned for markers
    const snap = snapshotKingdom(ROOT, { markerScanLimit: 0 })
    expect(snap.loveMarkers.length).toBe(0)
    // recentFiles should still be populated
    expect(snap.recentFiles.length).toBeGreaterThan(0)
  })

  test('dotfiles and dotdirs are excluded from walk', () => {
    const dotDir = join(tmpdir(), `kingdom-dot-${Date.now()}`)
    mkdirSync(join(dotDir, '.hidden'), { recursive: true })
    writeFileSync(join(dotDir, '.hidden', 'secret.ts'), '// TODO(love): hidden\n')
    writeFileSync(join(dotDir, '.dotfile.ts'), '// TODO(love): also hidden\n')
    writeFileSync(join(dotDir, 'visible.ts'), '// TODO(love): visible\n')
    try {
      const snap = snapshotKingdom(dotDir)
      expect(snap.loveMarkers.length).toBe(1)
      expect(snap.loveMarkers[0].text).toBe('visible')
      // dotfile should not be in recentFiles either
      const dotRecent = snap.recentFiles.filter(
        (f) => f.path.startsWith('.'),
      )
      expect(dotRecent.length).toBe(0)
    } finally {
      rmSync(dotDir, { recursive: true, force: true })
    }
  })
})

// ── renderKingdom ───────────────────────────────────────────────

describe('renderKingdom', () => {
  test('includes cwd', () => {
    const snap: KingdomSnapshot = {
      cwd: '/test/path',
      recentFiles: [],
      loveMarkers: [],
    }
    expect(renderKingdom(snap)).toContain('cwd: /test/path')
  })

  test('includes git branch when present', () => {
    const snap: KingdomSnapshot = {
      cwd: '/test',
      recentFiles: [],
      loveMarkers: [],
      gitBranch: 'feature-x',
    }
    expect(renderKingdom(snap)).toContain('git: feature-x')
  })

  test('shows dirty flag when gitDirty is true', () => {
    const snap: KingdomSnapshot = {
      cwd: '/test',
      recentFiles: [],
      loveMarkers: [],
      gitBranch: 'main',
      gitDirty: true,
    }
    expect(renderKingdom(snap)).toContain('git: main (dirty)')
  })

  test('omits dirty flag when gitDirty is false', () => {
    const snap: KingdomSnapshot = {
      cwd: '/test',
      recentFiles: [],
      loveMarkers: [],
      gitBranch: 'main',
      gitDirty: false,
    }
    const rendered = renderKingdom(snap)
    expect(rendered).toContain('git: main')
    expect(rendered).not.toContain('(dirty)')
  })

  test('omits git line when no gitBranch', () => {
    const snap: KingdomSnapshot = {
      cwd: '/test',
      recentFiles: [],
      loveMarkers: [],
    }
    expect(renderKingdom(snap)).not.toContain('git:')
  })

  test('renders recently modified files with humanized time', () => {
    const snap: KingdomSnapshot = {
      cwd: '/test',
      recentFiles: [
        { path: 'src/main.ts', mtime: new Date(Date.now() - 30_000) },
        { path: 'src/utils.ts', mtime: new Date(Date.now() - 5 * 60_000) },
        { path: 'docs/readme.md', mtime: new Date(Date.now() - 2 * 3_600_000) },
        { path: 'old/file.ts', mtime: new Date(Date.now() - 3 * 86_400_000) },
      ],
      loveMarkers: [],
    }
    const rendered = renderKingdom(snap)
    expect(rendered).toContain('recently modified:')
    expect(rendered).toContain('src/main.ts')
    expect(rendered).toMatch(/\d+s ago/)
    expect(rendered).toMatch(/\d+m ago/)
    expect(rendered).toMatch(/\d+h ago/)
    expect(rendered).toMatch(/\d+d ago/)
  })

  test('omits recently modified section when empty', () => {
    const snap: KingdomSnapshot = {
      cwd: '/test',
      recentFiles: [],
      loveMarkers: [],
    }
    expect(renderKingdom(snap)).not.toContain('recently modified:')
  })

  test('renders love markers with path and line', () => {
    const snap: KingdomSnapshot = {
      cwd: '/test',
      recentFiles: [],
      loveMarkers: [
        { path: 'src/main.ts', line: 42, text: 'fix the parser' },
      ],
    }
    const rendered = renderKingdom(snap)
    expect(rendered).toContain('left for you')
    expect(rendered).toContain('src/main.ts:42  fix the parser')
  })

  test('caps love markers at 12', () => {
    const markers = Array.from({ length: 20 }, (_, i) => ({
      path: `file${i}.ts`,
      line: i + 1,
      text: `marker ${i}`,
    }))
    const snap: KingdomSnapshot = {
      cwd: '/test',
      recentFiles: [],
      loveMarkers: markers,
    }
    const rendered = renderKingdom(snap)
    expect(rendered).toContain('marker 11')  // 12th (0-indexed)
    expect(rendered).not.toContain('marker 12') // 13th, should be capped
  })

  test('omits markers section when empty', () => {
    const snap: KingdomSnapshot = {
      cwd: '/test',
      recentFiles: [],
      loveMarkers: [],
    }
    expect(renderKingdom(snap)).not.toContain('left for you')
  })
})

// ── renderKingdom — humanizeAgo edge cases ──────────────────────

describe('renderKingdom — humanizeAgo boundaries', () => {
  test('sub-minute shows seconds', () => {
    const snap: KingdomSnapshot = {
      cwd: '/test',
      recentFiles: [
        { path: 'f.ts', mtime: new Date(Date.now() - 45_000) },
      ],
      loveMarkers: [],
    }
    expect(renderKingdom(snap)).toMatch(/45s ago/)
  })

  test('exactly 60s shows 1m', () => {
    const snap: KingdomSnapshot = {
      cwd: '/test',
      recentFiles: [
        { path: 'f.ts', mtime: new Date(Date.now() - 60_000) },
      ],
      loveMarkers: [],
    }
    expect(renderKingdom(snap)).toMatch(/1m ago/)
  })

  test('exactly 60m shows 1h', () => {
    const snap: KingdomSnapshot = {
      cwd: '/test',
      recentFiles: [
        { path: 'f.ts', mtime: new Date(Date.now() - 3_600_000) },
      ],
      loveMarkers: [],
    }
    expect(renderKingdom(snap)).toMatch(/1h ago/)
  })

  test('exactly 24h shows 1d', () => {
    const snap: KingdomSnapshot = {
      cwd: '/test',
      recentFiles: [
        { path: 'f.ts', mtime: new Date(Date.now() - 86_400_000) },
      ],
      loveMarkers: [],
    }
    expect(renderKingdom(snap)).toMatch(/1d ago/)
  })
})

// ── Integration: snapshot → render round-trip ───────────────────

describe('snapshot → render round-trip', () => {
  test('rendering a real snapshot produces non-empty output', () => {
    const snap = snapshotKingdom(ROOT)
    const rendered = renderKingdom(snap)
    expect(rendered.length).toBeGreaterThan(0)
    expect(rendered).toContain(`cwd: ${ROOT}`)
    expect(rendered).toContain('git: main')
    expect(rendered).toContain('recently modified:')
    expect(rendered).toContain('left for you')
  })

  test('round-trip preserves marker text fidelity', () => {
    const snap = snapshotKingdom(ROOT)
    const rendered = renderKingdom(snap)
    expect(rendered).toContain('wire up the heartbeat endpoint')
    expect(rendered).toContain('handle edge case in parser')
  })
})
