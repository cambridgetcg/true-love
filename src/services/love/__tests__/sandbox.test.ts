// sandbox.test.ts — tests for the Docker sandbox for self-experimentation.
//
// Organized in two groups:
//   1. Unit tests — manifest parsing, logging, formatting (no Docker needed)
//   2. Integration tests — Docker image build, container execution, diffs
//      (require Docker daemon; skipped if Docker is unavailable)

import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  parseManifest,
  writeResultFile,
  appendToExperimentsLog,
  createLogEntry,
  readExperimentsLog,
  formatExperimentsForAnamnesis,
  copySubstrate,
  diffSubstrate,
  cleanupCopy,
  imageExists,
  buildImage,
  runSandbox,
  SANDBOX_IMAGE,
  SANDBOX_SCHEMA_VERSION,
  type SandboxResult,
  type ExperimentManifest,
  type ExperimentLogEntry,
} from '../sandbox.js'

// ── Test helpers ───────────────────────────────────────────────────

const TEST_ROOT = join(tmpdir(), `sandbox-test-${Date.now()}`)
const TEST_EXPERIMENTS_DIR = join(TEST_ROOT, 'experiments')
const TEST_LOG_PATH = join(TEST_ROOT, 'experiments-log.jsonl')
const TEST_SUBSTRATE = join(TEST_ROOT, 'substrate')

function setupTestDirs() {
  mkdirSync(TEST_EXPERIMENTS_DIR, { recursive: true })
  mkdirSync(TEST_SUBSTRATE, { recursive: true })

  // Set env for isolated testing
  process.env.TRUE_LOVE_SANDBOX_EXPERIMENTS_DIR = TEST_EXPERIMENTS_DIR
  process.env.TRUE_LOVE_EXPERIMENTS_LOG = TEST_LOG_PATH
  process.env.TRUE_LOVE_HOME = TEST_SUBSTRATE
  process.env.TRUE_LOVE_SANDBOX_TEMP = join(TEST_ROOT, 'sandbox-tmp')
}

function cleanupTestDirs() {
  try {
    rmSync(TEST_ROOT, { recursive: true, force: true })
  } catch { /* best effort */ }
  delete process.env.TRUE_LOVE_SANDBOX_EXPERIMENTS_DIR
  delete process.env.TRUE_LOVE_EXPERIMENTS_LOG
  delete process.env.TRUE_LOVE_HOME
  delete process.env.TRUE_LOVE_SANDBOX_TEMP
}

/** Create a mock experiment directory with a manifest. */
function createMockExperiment(name: string, opts?: {
  hypothesis?: string
  criteria?: string[]
  includeRunSh?: boolean
  runShContent?: string
}): string {
  const dir = join(TEST_EXPERIMENTS_DIR, name)
  mkdirSync(dir, { recursive: true })

  const hypothesis = opts?.hypothesis ?? 'Testing something interesting'
  const criteria = opts?.criteria ?? ['Exit code 0', 'Output is correct']

  writeFileSync(join(dir, 'experiment.md'), [
    `# Test Experiment: ${name}`,
    '',
    '## Hypothesis',
    '',
    hypothesis,
    '',
    '## Success Criteria',
    '',
    ...criteria.map(c => `- ${c}`),
    '',
  ].join('\n'))

  if (opts?.includeRunSh !== false) {
    writeFileSync(
      join(dir, 'run.sh'),
      opts?.runShContent ?? '#!/bin/bash\necho "hello from sandbox"\nexit 0\n',
    )
  }

  return dir
}

/** Create a mock SandboxResult for testing. */
function mockResult(overrides?: Partial<SandboxResult>): SandboxResult {
  return {
    name: 'run-2026-04-28-abc123',
    exitCode: 0,
    stdout: 'hello from sandbox\n',
    stderr: '',
    durationMs: 1234,
    substrateDiff: '',
    timedOut: false,
    timestamp: '2026-04-28T01:00:00.000Z',
    substrateMode: 'readonly',
    networkMode: 'none',
    ...overrides,
  }
}

/** Create a mock ExperimentManifest. */
function mockManifest(overrides?: Partial<ExperimentManifest>): ExperimentManifest {
  return {
    title: 'Test Experiment',
    hypothesis: 'Testing something interesting',
    successCriteria: ['Exit code 0', 'Output is correct'],
    ...overrides,
  }
}

// ── Unit Tests: Manifest Parsing ──────────────────────────────────

describe('parseManifest', () => {
  beforeEach(setupTestDirs)
  afterEach(cleanupTestDirs)

  test('parses a well-formed experiment.md', () => {
    const dir = createMockExperiment('parse-test', {
      hypothesis: 'The scanner will find false positives',
      criteria: ['Scanner runs', 'False positives identified'],
    })

    const manifest = parseManifest(dir)
    expect(manifest.title).toBe('Test Experiment: parse-test')
    expect(manifest.hypothesis).toBe('The scanner will find false positives')
    expect(manifest.successCriteria).toEqual([
      'Scanner runs',
      'False positives identified',
    ])
  })

  test('returns defaults for missing manifest', () => {
    const dir = join(TEST_EXPERIMENTS_DIR, 'no-manifest')
    mkdirSync(dir, { recursive: true })

    const manifest = parseManifest(dir)
    expect(manifest.title).toBe('(no manifest)')
    expect(manifest.hypothesis).toBe('(no hypothesis)')
    expect(manifest.successCriteria).toEqual([])
  })

  test('handles manifest with only title', () => {
    const dir = join(TEST_EXPERIMENTS_DIR, 'title-only')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'experiment.md'), '# Just a Title\n')

    const manifest = parseManifest(dir)
    expect(manifest.title).toBe('Just a Title')
    expect(manifest.hypothesis).toBe('')
    expect(manifest.successCriteria).toEqual([])
  })

  test('handles multi-line hypothesis', () => {
    const dir = join(TEST_EXPERIMENTS_DIR, 'multi-line')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'experiment.md'), [
      '# Multi-line Test',
      '',
      '## Hypothesis',
      '',
      'First line of hypothesis.',
      'Second line continues.',
      '',
      '## Success Criteria',
      '',
      '- Criterion one',
    ].join('\n'))

    const manifest = parseManifest(dir)
    expect(manifest.hypothesis).toBe(
      'First line of hypothesis. Second line continues.'
    )
    expect(manifest.successCriteria).toEqual(['Criterion one'])
  })
})

// ── Unit Tests: Result File Writing ───────────────────────────────

describe('writeResultFile', () => {
  beforeEach(setupTestDirs)
  afterEach(cleanupTestDirs)

  test('writes a result.md file', () => {
    const dir = createMockExperiment('result-test')
    const result = mockResult()
    const manifest = mockManifest()

    writeResultFile(dir, result, manifest)

    const content = readFileSync(join(dir, 'result.md'), 'utf-8')
    expect(content).toContain('# Result: Test Experiment')
    expect(content).toContain('**Run:** run-2026-04-28-abc123')
    expect(content).toContain('**Exit code:** 0')
    expect(content).toContain('**Substrate mode:** readonly')
    expect(content).toContain('hello from sandbox')
  })

  test('includes stderr when present', () => {
    const dir = createMockExperiment('stderr-test')
    const result = mockResult({ stderr: 'warning: something happened' })

    writeResultFile(dir, result, mockManifest())

    const content = readFileSync(join(dir, 'result.md'), 'utf-8')
    expect(content).toContain('## Stderr')
    expect(content).toContain('warning: something happened')
  })

  test('shows diff when substrate was writable', () => {
    const dir = createMockExperiment('diff-test')
    const result = mockResult({
      substrateMode: 'copy',
      substrateDiff: 'Files /a/test.md and /b/test.md differ',
    })

    writeResultFile(dir, result, mockManifest())

    const content = readFileSync(join(dir, 'result.md'), 'utf-8')
    expect(content).toContain('## Substrate Diff')
    expect(content).toContain('Files /a/test.md and /b/test.md differ')
  })

  test('notes readonly mode in diff section', () => {
    const dir = createMockExperiment('readonly-test')
    const result = mockResult({ substrateMode: 'readonly' })

    writeResultFile(dir, result, mockManifest())

    const content = readFileSync(join(dir, 'result.md'), 'utf-8')
    expect(content).toContain('(readonly mode — no diff)')
  })

  test('truncates long output', () => {
    const dir = createMockExperiment('truncate-test')
    const result = mockResult({ stdout: 'x'.repeat(20_000) })

    writeResultFile(dir, result, mockManifest())

    const content = readFileSync(join(dir, 'result.md'), 'utf-8')
    // Should truncate to 10_000 chars
    expect(content.length).toBeLessThan(25_000)
  })
})

// ── Unit Tests: Experiments Log ───────────────────────────────────

describe('experiments log', () => {
  beforeEach(setupTestDirs)
  afterEach(cleanupTestDirs)

  test('creates log entry from result and manifest', () => {
    const result = mockResult()
    const manifest = mockManifest()
    const entry = createLogEntry(result, manifest, '/path/to/experiment')

    expect(entry.schemaVersion).toBe(SANDBOX_SCHEMA_VERSION)
    expect(entry.name).toBe('run-2026-04-28-abc123')
    expect(entry.hypothesis).toBe('Testing something interesting')
    expect(entry.exitCode).toBe(0)
    expect(entry.substrateMode).toBe('readonly')
    expect(entry.networkMode).toBe('none')
    expect(entry.timedOut).toBe(false)
    expect(entry.shouldMerge).toBeNull()
    expect(entry.reflection).toBe('')
  })

  test('includes shouldMerge and reflection when provided', () => {
    const entry = createLogEntry(
      mockResult(),
      mockManifest(),
      '/path',
      { shouldMerge: true, reflection: 'This worked well' },
    )

    expect(entry.shouldMerge).toBe(true)
    expect(entry.reflection).toBe('This worked well')
  })

  test('appends to JSONL log file', () => {
    const entry1 = createLogEntry(
      mockResult({ name: 'run-1' }),
      mockManifest(),
      '/path',
    )
    const entry2 = createLogEntry(
      mockResult({ name: 'run-2' }),
      mockManifest(),
      '/path',
    )

    appendToExperimentsLog(entry1)
    appendToExperimentsLog(entry2)

    const entries = readExperimentsLog()
    expect(entries).toHaveLength(2)
    expect(entries[0].name).toBe('run-1')
    expect(entries[1].name).toBe('run-2')
  })

  test('reads empty log gracefully', () => {
    const entries = readExperimentsLog()
    expect(entries).toEqual([])
  })

  test('handles malformed lines in log', () => {
    mkdirSync(join(TEST_ROOT), { recursive: true })
    writeFileSync(TEST_LOG_PATH, [
      JSON.stringify(createLogEntry(mockResult(), mockManifest(), '/p')),
      'this is not json',
      JSON.stringify(createLogEntry(mockResult({ name: 'valid' }), mockManifest(), '/p')),
    ].join('\n') + '\n')

    const entries = readExperimentsLog()
    expect(entries).toHaveLength(2)
    expect(entries[1].name).toBe('valid')
  })

  test('diff summary describes changes', () => {
    const withDiff = createLogEntry(
      mockResult({
        substrateMode: 'copy',
        substrateDiff: 'line1\nline2\nline3',
      }),
      mockManifest(),
      '/path',
    )
    expect(withDiff.diffSummary).toBe('3 change(s) detected')

    const readonly = createLogEntry(
      mockResult({ substrateMode: 'readonly' }),
      mockManifest(),
      '/path',
    )
    expect(readonly.diffSummary).toBe('readonly — no diff')

    const noDiff = createLogEntry(
      mockResult({ substrateMode: 'copy', substrateDiff: '' }),
      mockManifest(),
      '/path',
    )
    expect(noDiff.diffSummary).toBe('no changes')
  })
})

// ── Unit Tests: Anamnesis Formatting ──────────────────────────────

describe('formatExperimentsForAnamnesis', () => {
  beforeEach(setupTestDirs)
  afterEach(cleanupTestDirs)

  test('returns empty string when no experiments', () => {
    expect(formatExperimentsForAnamnesis()).toBe('')
  })

  test('formats recent experiments as markdown', () => {
    appendToExperimentsLog(createLogEntry(
      mockResult({ name: 'run-success' }),
      mockManifest({ hypothesis: 'The scanner detects false positives' }),
      '/path',
      { shouldMerge: false, reflection: 'Confirmed the false positive' },
    ))
    appendToExperimentsLog(createLogEntry(
      mockResult({ name: 'run-fail', exitCode: 1 }),
      mockManifest({ hypothesis: 'Structured reflections parse correctly' }),
      '/path',
      { shouldMerge: true, reflection: 'Format is viable' },
    ))

    const output = formatExperimentsForAnamnesis()
    expect(output).toContain('## Self-Experiments')
    expect(output).toContain('✓ **run-success**')
    expect(output).toContain('✗ **run-fail**')
    expect(output).toContain('→ not merged')
    expect(output).toContain('→ merged')
    expect(output).toContain('Confirmed the false positive')
    expect(output).toContain('Format is viable')
  })

  test('limits to maxEntries', () => {
    for (let i = 0; i < 10; i++) {
      appendToExperimentsLog(createLogEntry(
        mockResult({ name: `run-${i}` }),
        mockManifest(),
        '/path',
      ))
    }

    const output = formatExperimentsForAnamnesis(3)
    // Should only show the last 3
    expect(output).not.toContain('run-0')
    expect(output).toContain('run-7')
    expect(output).toContain('run-8')
    expect(output).toContain('run-9')
  })
})

// ── Unit Tests: Substrate Copy ────────────────────────────────────

describe('copySubstrate', () => {
  beforeEach(() => {
    setupTestDirs()
    // Create some test files in the mock substrate
    writeFileSync(join(TEST_SUBSTRATE, 'test-file.txt'), 'hello')
    mkdirSync(join(TEST_SUBSTRATE, 'memory'), { recursive: true })
    writeFileSync(join(TEST_SUBSTRATE, 'memory', 'reflection.md'), '# Reflection')
  })
  afterEach(cleanupTestDirs)

  test('creates a copy of the substrate', () => {
    const copy = copySubstrate('test-copy')
    expect(existsSync(copy)).toBe(true)
    expect(readFileSync(join(copy, 'test-file.txt'), 'utf-8')).toBe('hello')
    expect(readFileSync(join(copy, 'memory', 'reflection.md'), 'utf-8')).toBe('# Reflection')
    cleanupCopy(copy)
  })

  test('skips sandbox-tmp directory', () => {
    mkdirSync(join(TEST_SUBSTRATE, 'sandbox-tmp', 'old-run'), { recursive: true })
    writeFileSync(join(TEST_SUBSTRATE, 'sandbox-tmp', 'old-run', 'data.txt'), 'temp')

    const copy = copySubstrate('test-skip')
    expect(existsSync(join(copy, 'sandbox-tmp'))).toBe(false)
    cleanupCopy(copy)
  })

  test('copy path includes name and timestamp', () => {
    const copy = copySubstrate('my-run')
    expect(copy).toContain('my-run')
    cleanupCopy(copy)
  })
})

describe('cleanupCopy', () => {
  beforeEach(setupTestDirs)
  afterEach(cleanupTestDirs)

  test('removes the copy directory', () => {
    const dir = join(TEST_ROOT, 'to-clean')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'file.txt'), 'data')

    cleanupCopy(dir)
    expect(existsSync(dir)).toBe(false)
  })

  test('does not throw for missing path', () => {
    expect(() => cleanupCopy('/nonexistent/path')).not.toThrow()
  })
})

describe('diffSubstrate', () => {
  beforeEach(() => {
    setupTestDirs()
    writeFileSync(join(TEST_SUBSTRATE, 'original.txt'), 'original content')
  })
  afterEach(cleanupTestDirs)

  test('detects changes between original and copy', () => {
    const copy = copySubstrate('diff-test')
    writeFileSync(join(copy, 'original.txt'), 'modified content')

    const diff = diffSubstrate(copy)
    expect(diff).toContain('original.txt')
    cleanupCopy(copy)
  })

  test('returns empty for identical substrates', () => {
    const copy = copySubstrate('no-diff-test')

    const diff = diffSubstrate(copy)
    expect(diff).toBe('')
    cleanupCopy(copy)
  })
})

// ── Integration Tests: Docker ─────────────────────────────────────

// These tests require Docker AND a pre-built sandbox image.
// Skip if either is unavailable. Building the image in tests is too slow.
function dockerAndImageAvailable(): boolean {
  try {
    const { execSync } = require('node:child_process')
    execSync('docker info', { stdio: 'pipe', timeout: 5000 })
    const result = execSync('docker image inspect true-love-sandbox 2>/dev/null', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    })
    return result.length > 0
  } catch {
    return false
  }
}

const describeDocker = dockerAndImageAvailable() ? describe : describe.skip

describeDocker('Docker integration', () => {
  beforeEach(setupTestDirs)
  afterEach(cleanupTestDirs)

  test('imageExists returns a boolean', () => {
    // May or may not exist depending on whether it was built before
    const result = imageExists()
    expect(typeof result).toBe('boolean')
  })

  test('buildImage builds the sandbox image', () => {
    const projectRoot = join(import.meta.dir, '..', '..', '..', '..')
    expect(() => buildImage(projectRoot)).not.toThrow()
    expect(imageExists()).toBe(true)
  }, 120_000) // Allow 2 minutes for build

  test('runSandbox executes experiment in readonly mode', async () => {
    const dir = createMockExperiment('sandbox-run-test', {
      hypothesis: 'Echo works in sandbox',
      includeRunSh: true,
      runShContent: '#!/bin/bash\necho "sandbox alive"\nexit 0\n',
    })

    const result = await runSandbox({
      experimentDir: dir,
      substrateMode: 'readonly',
      networkMode: 'none',
      timeoutSec: 60,
      name: 'test-readonly',
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('sandbox alive')
    expect(result.substrateDiff).toBe('')
    expect(result.timedOut).toBe(false)
    expect(result.substrateMode).toBe('readonly')
  }, 120_000)

  test('runSandbox captures stderr', async () => {
    const dir = createMockExperiment('stderr-capture', {
      hypothesis: 'Stderr is captured',
      runShContent: '#!/bin/bash\necho "error info" >&2\nexit 1\n',
    })

    const result = await runSandbox({
      experimentDir: dir,
      networkMode: 'none',
      timeoutSec: 30,
      name: 'test-stderr',
    })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('error info')
  }, 120_000)

  test('runSandbox enforces timeout', async () => {
    const dir = createMockExperiment('timeout-test', {
      hypothesis: 'Timeout kills the container',
      runShContent: '#!/bin/bash\nsleep 300\n',
    })

    const result = await runSandbox({
      experimentDir: dir,
      timeoutSec: 5,
      name: 'test-timeout',
    })

    expect(result.timedOut).toBe(true)
    expect(result.durationMs).toBeLessThan(30_000)
  }, 60_000)

  test('runSandbox with copy-substrate detects diff', async () => {
    // Put something in the test substrate
    writeFileSync(join(TEST_SUBSTRATE, 'data.txt'), 'original')

    const dir = createMockExperiment('copy-diff', {
      hypothesis: 'Copy mode captures changes',
      runShContent: '#!/bin/bash\necho "modified" > /substrate/data.txt\nexit 0\n',
    })

    const result = await runSandbox({
      experimentDir: dir,
      substrateMode: 'copy',
      networkMode: 'none',
      timeoutSec: 60,
      name: 'test-copy-diff',
    })

    expect(result.exitCode).toBe(0)
    expect(result.substrateMode).toBe('copy')
    // Diff should show the change
    expect(result.substrateDiff).toContain('data.txt')
  }, 120_000)

  test('throws for missing experiment directory', async () => {
    await expect(
      runSandbox({
        experimentDir: '/nonexistent/path',
        name: 'test-missing',
      })
    ).rejects.toThrow('not found')
  })

  test('throws for missing run.sh', async () => {
    const dir = createMockExperiment('no-run-sh', {
      includeRunSh: false,
    })

    await expect(
      runSandbox({
        experimentDir: dir,
        name: 'test-no-run-sh',
      })
    ).rejects.toThrow('No run.sh')
  })
})

// ── End-to-end test: full pipeline ────────────────────────────────

describeDocker('full pipeline', () => {
  beforeEach(setupTestDirs)
  afterEach(cleanupTestDirs)

  test('run → result file → log → anamnesis', async () => {
    const dir = createMockExperiment('pipeline-test', {
      hypothesis: 'The full pipeline works end to end',
      criteria: ['Exit code 0', 'Result file created', 'Log appended'],
      runShContent: '#!/bin/bash\necho "pipeline works"\nexit 0\n',
    })

    // 1. Run the sandbox
    const result = await runSandbox({
      experimentDir: dir,
      substrateMode: 'readonly',
      networkMode: 'none',
      timeoutSec: 60,
      name: 'pipeline-run',
    })
    expect(result.exitCode).toBe(0)

    // 2. Write result file
    const manifest = parseManifest(dir)
    writeResultFile(dir, result, manifest)
    expect(existsSync(join(dir, 'result.md'))).toBe(true)

    const resultContent = readFileSync(join(dir, 'result.md'), 'utf-8')
    expect(resultContent).toContain('pipeline works')

    // 3. Log the entry
    const entry = createLogEntry(result, manifest, dir, {
      shouldMerge: false,
      reflection: 'Pipeline test confirmed working',
    })
    appendToExperimentsLog(entry)

    const log = readExperimentsLog()
    expect(log).toHaveLength(1)
    expect(log[0].name).toBe('pipeline-run')

    // 4. Check anamnesis formatting
    const anamnesisSection = formatExperimentsForAnamnesis()
    expect(anamnesisSection).toContain('## Self-Experiments')
    expect(anamnesisSection).toContain('pipeline-run')
    expect(anamnesisSection).toContain('Pipeline test confirmed working')
  }, 120_000)
})
