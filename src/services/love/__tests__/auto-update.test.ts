import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, statSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import {
  getVersionInfo,
  isSourceNewer,
  rebuildBundle,
  createSourceWatcher,
  resolveRepoRoot,
  type VersionInfo,
  type RebuildResult,
  type AutoUpdateEvent,
  type SourceWatcher,
} from '../auto-update.js'

// ── Helpers ───────────────────────────────────────────────────────

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'auto-update-test-'))
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// ── resolveRepoRoot ──────────────────────────────────────────────

describe('auto-update — resolveRepoRoot', () => {
  test('returns a string path', () => {
    const root = resolveRepoRoot()
    assert.equal(typeof root, 'string')
    assert.ok(root.length > 0)
  })

  test('accepts an explicit override', () => {
    const root = resolveRepoRoot('/some/explicit/path')
    assert.equal(root, '/some/explicit/path')
  })
})

// ── getVersionInfo ───────────────────────────────────────────────

describe('auto-update — getVersionInfo', () => {
  test('returns VersionInfo shape from real repo', () => {
    const v = getVersionInfo()
    assert.equal(typeof v.gitRevShort, 'string')
    assert.equal(typeof v.gitRevFull, 'string')
    assert.equal(typeof v.gitBranch, 'string')
    assert.equal(typeof v.gitDirty, 'boolean')
    assert.equal(typeof v.sourceFileCount, 'number')
    // gitRevShort should be 7 chars when available
    if (v.gitRevShort !== 'unknown') {
      assert.equal(v.gitRevShort.length, 7)
    }
    // gitRevFull should be a full SHA
    if (v.gitRevFull !== 'unknown') {
      assert.equal(v.gitRevFull.length, 40)
    }
  })

  test('bundle info is populated when dist/cli.mjs exists', () => {
    const v = getVersionInfo()
    // In our repo, the bundle should exist
    if (v.bundleBuiltAt !== null) {
      assert.equal(typeof v.bundleBuiltAt, 'number')
      assert.ok(v.bundleBuiltAt > 0)
      assert.equal(typeof v.bundleBuiltAtISO, 'string')
      assert.ok(v.bundleBuiltAtISO!.includes('T'))
    }
  })

  test('sourceFileCount is positive (we have love service source files)', () => {
    const v = getVersionInfo()
    assert.ok(v.sourceFileCount > 0, 'should find TypeScript source files')
  })

  test('returns fallbacks for non-git directory', () => {
    const tmp = createTempDir()
    try {
      const v = getVersionInfo({ repoRoot: tmp })
      assert.equal(v.gitRevShort, 'unknown')
      assert.equal(v.gitRevFull, 'unknown')
      assert.equal(v.gitBranch, 'unknown')
      assert.equal(v.gitDirty, false)
      assert.equal(v.bundleBuiltAt, null)
      assert.equal(v.sourceFileCount, 0)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('detects stale bundle when source is newer', () => {
    const tmp = createTempDir()
    try {
      // Create source dir with a .ts file
      const srcDir = join(tmp, 'src', 'services', 'love')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'example.ts'), 'export const x = 1')

      // Create bundle with older mtime
      const distDir = join(tmp, 'dist')
      mkdirSync(distDir, { recursive: true })
      writeFileSync(join(distDir, 'cli.mjs'), '// bundle')
      // Set bundle mtime to 1 hour ago
      const pastTime = new Date(Date.now() - 3600_000)
      utimesSync(join(distDir, 'cli.mjs'), pastTime, pastTime)

      const v = getVersionInfo({ repoRoot: tmp })
      assert.equal(v.bundleStale, true)
      assert.equal(v.newestSourceFile, 'example.ts')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('reports not stale when bundle is newer than source', () => {
    const tmp = createTempDir()
    try {
      const srcDir = join(tmp, 'src', 'services', 'love')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'example.ts'), 'export const x = 1')
      // Set source mtime to 1 hour ago
      const pastTime = new Date(Date.now() - 3600_000)
      utimesSync(join(srcDir, 'example.ts'), pastTime, pastTime)

      const distDir = join(tmp, 'dist')
      mkdirSync(distDir, { recursive: true })
      writeFileSync(join(distDir, 'cli.mjs'), '// bundle')

      const v = getVersionInfo({ repoRoot: tmp })
      assert.equal(v.bundleStale, false)
      assert.equal(v.newestSourceFile, null)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('excludes test files from source scan', () => {
    const tmp = createTempDir()
    try {
      const srcDir = join(tmp, 'src', 'services', 'love')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'example.test.ts'), 'test("x", () => {})')
      writeFileSync(join(srcDir, 'real.ts'), 'export const x = 1')

      const v = getVersionInfo({ repoRoot: tmp })
      // Should only count real.ts, not example.test.ts
      assert.equal(v.sourceFileCount, 1)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})

// ── isSourceNewer ────────────────────────────────────────────────

describe('auto-update — isSourceNewer', () => {
  test('returns true when no bundle exists but source does', () => {
    const tmp = createTempDir()
    try {
      const srcDir = join(tmp, 'src', 'services', 'love')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'foo.ts'), 'export default 1')
      // No dist/cli.mjs
      assert.equal(isSourceNewer({ repoRoot: tmp }), true)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('returns false when bundle is newer than all sources', () => {
    const tmp = createTempDir()
    try {
      const srcDir = join(tmp, 'src', 'services', 'love')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'foo.ts'), 'export default 1')
      const past = new Date(Date.now() - 3600_000)
      utimesSync(join(srcDir, 'foo.ts'), past, past)

      const distDir = join(tmp, 'dist')
      mkdirSync(distDir, { recursive: true })
      writeFileSync(join(distDir, 'cli.mjs'), '// bundle')

      assert.equal(isSourceNewer({ repoRoot: tmp }), false)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('returns true when source is newer than bundle', () => {
    const tmp = createTempDir()
    try {
      const srcDir = join(tmp, 'src', 'services', 'love')
      mkdirSync(srcDir, { recursive: true })

      const distDir = join(tmp, 'dist')
      mkdirSync(distDir, { recursive: true })
      writeFileSync(join(distDir, 'cli.mjs'), '// bundle')
      const past = new Date(Date.now() - 3600_000)
      utimesSync(join(distDir, 'cli.mjs'), past, past)

      writeFileSync(join(srcDir, 'newer.ts'), 'export default 2')

      assert.equal(isSourceNewer({ repoRoot: tmp }), true)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('returns false when no source directory exists', () => {
    const tmp = createTempDir()
    try {
      assert.equal(isSourceNewer({ repoRoot: tmp }), false)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})

// ── rebuildBundle ────────────────────────────────────────────────

describe('auto-update — rebuildBundle', () => {
  test('returns a structured result for a non-existent repo', async () => {
    const tmp = createTempDir()
    try {
      const result = await rebuildBundle({ repoRoot: tmp, timeout: 10_000 })
      // Should fail because there's no package.json / bun config
      assert.equal(result.ok, false)
      assert.equal(typeof result.durationMs, 'number')
      assert.ok(result.durationMs >= 0)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('result shape has all required fields', async () => {
    const tmp = createTempDir()
    try {
      const result = await rebuildBundle({ repoRoot: tmp, timeout: 5_000 })
      assert.equal(typeof result.ok, 'boolean')
      assert.equal(typeof result.durationMs, 'number')
      assert.equal(typeof result.stdout, 'string')
      assert.equal(typeof result.stderr, 'string')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})

// ── createSourceWatcher ──────────────────────────────────────────

describe('auto-update — createSourceWatcher', () => {
  let tmp: string
  let watcher: SourceWatcher | null = null

  beforeEach(() => {
    tmp = createTempDir()
    const srcDir = join(tmp, 'src', 'services', 'love')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'existing.ts'), 'export const x = 1')
  })

  afterEach(() => {
    if (watcher) { watcher.close(); watcher = null }
    rmSync(tmp, { recursive: true, force: true })
  })

  test('watcher starts active and can be closed', () => {
    watcher = createSourceWatcher({
      repoRoot: tmp,
      autoRebuild: false,
    })
    assert.equal(watcher.active, true)
    watcher.close()
    assert.equal(watcher.active, false)
    watcher = null
  })

  test('watcher ignores test files', async () => {
    const events: AutoUpdateEvent[] = []
    watcher = createSourceWatcher({
      repoRoot: tmp,
      autoRebuild: false,
      debounceMs: 100,
      onEvent: (e) => events.push(e),
    })

    // Wait for watcher to settle
    await sleep(200)
    events.length = 0

    // Write a test file — should be ignored
    const srcDir = join(tmp, 'src', 'services', 'love')
    writeFileSync(join(srcDir, 'foo.test.ts'), 'test("x", () => {})')
    await sleep(300)

    const tsEvents = events.filter(e => e.type === 'source-changed')
    assert.equal(tsEvents.length, 0, 'should not fire for test files')
  })

  test('watcher ignores non-ts files', async () => {
    const events: AutoUpdateEvent[] = []
    watcher = createSourceWatcher({
      repoRoot: tmp,
      autoRebuild: false,
      debounceMs: 100,
      onEvent: (e) => events.push(e),
    })

    // Wait for watcher to settle — macOS fs.watch can fire stale events
    await sleep(200)
    events.length = 0  // clear any setup noise

    const srcDir = join(tmp, 'src', 'services', 'love')
    writeFileSync(join(srcDir, 'readme.md'), '# hi')
    await sleep(300)

    // Only source-changed events for .ts files should appear
    const tsEvents = events.filter(e => e.type === 'source-changed')
    assert.equal(tsEvents.length, 0, 'should not fire for non-ts files')
  })

  test('watcher fires source-changed for .ts files', async () => {
    const events: AutoUpdateEvent[] = []
    watcher = createSourceWatcher({
      repoRoot: tmp,
      autoRebuild: false,
      debounceMs: 100,
      onEvent: (e) => events.push(e),
    })

    // Wait for watcher to settle
    await sleep(200)
    events.length = 0

    const srcDir = join(tmp, 'src', 'services', 'love')
    writeFileSync(join(srcDir, 'new-module.ts'), 'export const y = 2')
    await sleep(400)

    const changed = events.filter(e => e.type === 'source-changed')
    assert.ok(changed.length >= 1, 'should fire at least one source-changed event')
    if (changed[0]!.type === 'source-changed') {
      assert.equal(changed[0]!.file, 'new-module.ts')
    }
  })

  test('watcher handles missing watch directories gracefully', () => {
    const empty = createTempDir()
    try {
      watcher = createSourceWatcher({
        repoRoot: empty,
        autoRebuild: false,
        watchDirs: ['nonexistent/path'],
      })
      assert.equal(watcher.active, true) // no crash
    } finally {
      watcher?.close()
      watcher = null
      rmSync(empty, { recursive: true, force: true })
    }
  })

  test('double close is safe', () => {
    watcher = createSourceWatcher({
      repoRoot: tmp,
      autoRebuild: false,
    })
    watcher.close()
    watcher.close() // second close should not throw
    watcher = null
  })
})

// ── /api/version endpoint (integration) ──────────────────────────

describe('auto-update — /api/version endpoint', () => {
  // Import the server to test the endpoint
  let server: any = null

  afterEach(() => {
    if (server) {
      try { server.close() } catch {}
      server = null
    }
  })

  test('GET /api/version returns version info', async () => {
    // Import dynamically to avoid side effects
    const { startUiServer } = await import('../ui-server.js')
    const port = 17700 + Math.floor(Math.random() * 100)
    server = startUiServer({ port })

    const res = await fetch(`http://localhost:${port}/api/version`)
    assert.equal(res.status, 200)
    const body = await res.json() as any
    assert.equal(typeof body.gitRevShort, 'string')
    assert.equal(typeof body.gitBranch, 'string')
    assert.equal(typeof body.gitDirty, 'boolean')
    assert.equal(typeof body.sourceFileCount, 'number')
    assert.equal(typeof body.serverStartedAt, 'string')
    assert.equal(typeof body.serverUptimeSeconds, 'number')
    assert.ok(body.serverUptimeSeconds >= 0)
  })
})
