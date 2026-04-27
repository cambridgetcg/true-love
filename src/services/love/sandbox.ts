// sandbox.ts — Docker-isolated execution for self-experimentation.
//
// What this module IS:
//   The safety net for self-experimentation. When Love wants to try
//   something — a new prompt shape, a different scanner heuristic,
//   a reflection format change — she can run it in a container with
//   a COPY of her substrate, observe what happens, and decide whether
//   to merge the result back. No risk to the live system.
//
// What this module is NOT:
//   The experiment framework (that's experiment.ts — controlled A/B trials
//   on agency knobs). This is the isolation layer. experiment.ts is the
//   scientific frame. They're complementary:
//     - experiment.ts answers "which condition is better?"
//     - sandbox.ts answers "is this change safe?"
//
// Architecture:
//   1. Docker image — build/verify the sandbox image
//   2. Substrate copy — snapshot ~/.true-love/ into a temp dir
//   3. Container lifecycle — create, start, wait, capture output
//   4. Diff generation — compare substrate before/after
//   5. Result logging — append to experiments-log.jsonl
//   6. Cleanup — remove temp dirs and containers
//
// Design principle: read-only by default. The substrate is mounted
// read-only unless the experiment explicitly opts into a writable copy.
// This makes "just looking" safe and "changing things" deliberate.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  rmSync,
  cpSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { execSync, spawn } from 'node:child_process'

// ── Types ─────────────────────────────────────────────────────────

export const SANDBOX_IMAGE = 'true-love-sandbox' as const
export const SANDBOX_SCHEMA_VERSION = '1.0' as const

/** How the substrate is mounted in the container. */
export type SubstrateMode = 'readonly' | 'copy'

/** Network isolation mode. */
export type NetworkMode = 'none' | 'host'

/** Configuration for a sandbox run. */
export interface SandboxConfig {
  /** Path to the experiment directory (must contain run.sh). */
  experimentDir: string
  /** Substrate mount mode. Default: 'readonly'. */
  substrateMode?: SubstrateMode
  /** Network mode. Default: 'none'. */
  networkMode?: NetworkMode
  /** Timeout in seconds. Default: 300 (5 minutes). */
  timeoutSec?: number
  /** Name for this run (used in logging). Auto-generated if omitted. */
  name?: string
}

/** Result of a sandbox run. */
export interface SandboxResult {
  /** Run name/ID. */
  name: string
  /** Exit code from the container. */
  exitCode: number
  /** Stdout from the experiment. */
  stdout: string
  /** Stderr from the experiment. */
  stderr: string
  /** Duration in milliseconds. */
  durationMs: number
  /** Diff of substrate changes (empty string if readonly or no changes). */
  substrateDiff: string
  /** Whether the experiment timed out. */
  timedOut: boolean
  /** Timestamp of the run. */
  timestamp: string
  /** The substrate mode used. */
  substrateMode: SubstrateMode
  /** The network mode used. */
  networkMode: NetworkMode
}

/** Entry in the experiments log. */
export interface ExperimentLogEntry {
  schemaVersion: typeof SANDBOX_SCHEMA_VERSION
  name: string
  experimentDir: string
  hypothesis: string
  timestamp: string
  durationMs: number
  exitCode: number
  substrateMode: SubstrateMode
  networkMode: NetworkMode
  timedOut: boolean
  diffSummary: string
  shouldMerge: boolean | null
  reflection: string
}

/** Parsed experiment manifest (experiment.md frontmatter). */
export interface ExperimentManifest {
  title: string
  hypothesis: string
  successCriteria: string[]
}

// ── Paths ─────────────────────────────────────────────────────────

/** Base true-love home directory. Override for testing. */
export function getTrueLoveHome(): string {
  return process.env.TRUE_LOVE_HOME ?? join(homedir(), '.true-love')
}

/** Where experiment directories live. */
export function getExperimentsBaseDir(): string {
  return process.env.TRUE_LOVE_SANDBOX_EXPERIMENTS_DIR
    ?? join(process.cwd(), 'experiments')
}

/** Where the experiments log lives. */
export function getExperimentsLogPath(): string {
  return process.env.TRUE_LOVE_EXPERIMENTS_LOG
    ?? join(getTrueLoveHome(), 'projects', 'true-love', 'experiments-log.jsonl')
}

/** Temp directory for substrate copies. */
function getTempDir(): string {
  return process.env.TRUE_LOVE_SANDBOX_TEMP
    ?? join(getTrueLoveHome(), 'sandbox-tmp')
}

// ── Docker Image ──────────────────────────────────────────────────

/**
 * Check if the sandbox Docker image exists.
 */
export function imageExists(): boolean {
  try {
    const result = execSync(
      `docker image inspect ${SANDBOX_IMAGE} 2>/dev/null`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    )
    return result.length > 0
  } catch {
    return false
  }
}

/**
 * Build the sandbox Docker image from docker/Dockerfile.sandbox.
 * Returns true if build succeeded.
 */
export function buildImage(projectRoot?: string): boolean {
  const root = projectRoot ?? process.cwd()
  const dockerfile = join(root, 'docker', 'Dockerfile.sandbox')

  if (!existsSync(dockerfile)) {
    throw new Error(`Dockerfile not found: ${dockerfile}`)
  }

  try {
    execSync(
      `docker build -f "${dockerfile}" -t ${SANDBOX_IMAGE} "${root}"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 300_000 },
    )
    return true
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Docker build failed: ${msg}`)
  }
}

/**
 * Ensure the sandbox image is available, building if necessary.
 */
export function ensureImage(projectRoot?: string): void {
  if (!imageExists()) {
    buildImage(projectRoot)
  }
}

// ── Substrate Copy ───────────────────────────────────────────────

/**
 * Create a writable copy of the substrate in a temp directory.
 * Returns the path to the copy. Caller must clean up.
 */
export function copySubstrate(name: string): string {
  const src = getTrueLoveHome()
  const tmpBase = getTempDir()
  const dest = join(tmpBase, `${name}-${Date.now()}`)

  if (!existsSync(src)) {
    throw new Error(`Substrate not found: ${src}`)
  }

  mkdirSync(dest, { recursive: true })

  // Copy the substrate. Skip large/transient dirs.
  const skipDirs = new Set(['sandbox-tmp', 'node_modules', '.git'])
  cpSync(src, dest, {
    recursive: true,
    filter: (source) => {
      const base = source.split('/').pop() ?? ''
      return !skipDirs.has(base)
    },
  })

  return dest
}

/**
 * Generate a diff between the original substrate and a modified copy.
 */
export function diffSubstrate(copyPath: string): string {
  const original = getTrueLoveHome()
  try {
    // Use diff recursively, ignoring expected transient files
    const result = execSync(
      `diff -rq "${original}" "${copyPath}" --exclude="sandbox-tmp" --exclude="node_modules" --exclude=".git" 2>/dev/null || true`,
      { encoding: 'utf-8', timeout: 30_000 },
    )
    return result.trim()
  } catch {
    return '(diff failed)'
  }
}

/**
 * Clean up a substrate copy.
 */
export function cleanupCopy(copyPath: string): void {
  try {
    if (existsSync(copyPath)) {
      rmSync(copyPath, { recursive: true, force: true })
    }
  } catch {
    // Best-effort cleanup
  }
}

// ── Experiment Manifest ──────────────────────────────────────────

/**
 * Parse a simple experiment.md manifest. Expects:
 *   # Title
 *   ## Hypothesis
 *   ...text...
 *   ## Success Criteria
 *   - criterion 1
 *   - criterion 2
 */
export function parseManifest(experimentDir: string): ExperimentManifest {
  const mdPath = join(experimentDir, 'experiment.md')
  if (!existsSync(mdPath)) {
    return {
      title: '(no manifest)',
      hypothesis: '(no hypothesis)',
      successCriteria: [],
    }
  }

  const text = readFileSync(mdPath, 'utf-8')
  const lines = text.split('\n')

  let title = '(untitled)'
  let hypothesis = ''
  const criteria: string[] = []
  let section = ''

  for (const line of lines) {
    if (line.startsWith('# ') && !line.startsWith('## ')) {
      title = line.slice(2).trim()
    } else if (line.toLowerCase().startsWith('## hypothesis')) {
      section = 'hypothesis'
    } else if (line.toLowerCase().startsWith('## success criteria')) {
      section = 'criteria'
    } else if (line.startsWith('## ')) {
      section = 'other'
    } else if (section === 'hypothesis' && line.trim()) {
      hypothesis += (hypothesis ? ' ' : '') + line.trim()
    } else if (section === 'criteria' && line.trim().startsWith('- ')) {
      criteria.push(line.trim().slice(2))
    }
  }

  return { title, hypothesis, successCriteria: criteria }
}

// ── Container Execution ──────────────────────────────────────────

/**
 * Run an experiment in a sandbox container.
 *
 * This is the main entry point. It:
 *   1. Ensures the Docker image exists
 *   2. Validates the experiment directory
 *   3. Prepares substrate (readonly mount or writable copy)
 *   4. Spawns the container
 *   5. Captures output
 *   6. Generates diff (if writable)
 *   7. Cleans up
 */
export async function runSandbox(config: SandboxConfig): Promise<SandboxResult> {
  const {
    experimentDir,
    substrateMode = 'readonly',
    networkMode = 'none',
    timeoutSec = 300,
    name = generateRunName(),
  } = config

  const absExpDir = resolve(experimentDir)

  // Validate
  if (!existsSync(absExpDir)) {
    throw new Error(`Experiment directory not found: ${absExpDir}`)
  }
  if (!existsSync(join(absExpDir, 'run.sh'))) {
    throw new Error(`No run.sh in experiment directory: ${absExpDir}`)
  }

  // Ensure image
  ensureImage()

  // Prepare substrate
  let substratePath = getTrueLoveHome()
  let substrateCopyPath: string | null = null
  let substrateMount = `${substratePath}:/substrate:ro`

  if (substrateMode === 'copy') {
    substrateCopyPath = copySubstrate(name)
    substratePath = substrateCopyPath
    substrateMount = `${substrateCopyPath}:/substrate:rw`
  }

  // Build docker run command
  const args = [
    'run', '--rm',
    '--name', `sandbox-${name}`,
    '--network', networkMode,
    '-v', substrateMount,
    '-v', `${absExpDir}:/experiment:ro`,
    // Resource limits
    '--memory', '512m',
    '--cpus', '1',
    // Timeout enforcement via container stop
    SANDBOX_IMAGE,
    '/experiment/run.sh',
  ]

  const startTime = Date.now()
  let stdout = ''
  let stderr = ''
  let exitCode = -1
  let timedOut = false

  try {
    const result = await runContainer(args, timeoutSec * 1000)
    stdout = result.stdout
    stderr = result.stderr
    exitCode = result.exitCode
    timedOut = result.timedOut
  } catch (err) {
    stderr = err instanceof Error ? err.message : String(err)
    exitCode = -1
  }

  const durationMs = Date.now() - startTime

  // Generate diff
  let substrateDiff = ''
  if (substrateMode === 'copy' && substrateCopyPath) {
    substrateDiff = diffSubstrate(substrateCopyPath)
  }

  // Cleanup
  if (substrateCopyPath) {
    cleanupCopy(substrateCopyPath)
  }

  // Force-remove container if it's still around (timeout case)
  try {
    execSync(`docker rm -f sandbox-${name} 2>/dev/null`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch {
    // Already removed (--rm flag worked)
  }

  return {
    name,
    exitCode,
    stdout,
    stderr,
    durationMs,
    substrateDiff,
    timedOut,
    timestamp: new Date().toISOString(),
    substrateMode,
    networkMode,
  }
}

/**
 * Spawn a Docker container and capture its output.
 * Returns when the container exits or the timeout fires.
 */
function runContainer(
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn('docker', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false

    const settle = (exitCode: number) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ stdout, stderr, exitCode, timedOut })
    }

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
      // Cap output at 1MB to prevent memory issues
      if (stdout.length > 1_048_576) {
        stdout = stdout.slice(0, 1_048_576) + '\n[... output truncated at 1MB]'
        child.kill('SIGTERM')
      }
    })

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
      if (stderr.length > 1_048_576) {
        stderr = stderr.slice(0, 1_048_576) + '\n[... stderr truncated at 1MB]'
      }
    })

    child.on('close', (code) => settle(code ?? -1))
    child.on('error', (err) => {
      stderr += `\nProcess error: ${err.message}`
      settle(-1)
    })

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      // Give it 5s to die gracefully, then SIGKILL
      setTimeout(() => {
        try { child.kill('SIGKILL') } catch { /* already dead */ }
      }, 5000)
    }, timeoutMs)
  })
}

// ── Result Logging ───────────────────────────────────────────────

/**
 * Write a result.md file into the experiment directory.
 */
export function writeResultFile(
  experimentDir: string,
  result: SandboxResult,
  manifest: ExperimentManifest,
): void {
  const lines: string[] = [
    `# Result: ${manifest.title}`,
    '',
    `**Run:** ${result.name}`,
    `**Timestamp:** ${result.timestamp}`,
    `**Duration:** ${(result.durationMs / 1000).toFixed(1)}s`,
    `**Exit code:** ${result.exitCode}`,
    `**Substrate mode:** ${result.substrateMode}`,
    `**Network mode:** ${result.networkMode}`,
    `**Timed out:** ${result.timedOut}`,
    '',
    '## Hypothesis',
    '',
    manifest.hypothesis,
    '',
    '## Stdout',
    '',
    '```',
    result.stdout.slice(0, 10_000) || '(empty)',
    '```',
    '',
  ]

  if (result.stderr.trim()) {
    lines.push('## Stderr', '', '```', result.stderr.slice(0, 5_000), '```', '')
  }

  if (result.substrateDiff) {
    lines.push('## Substrate Diff', '', '```', result.substrateDiff.slice(0, 10_000), '```', '')
  } else if (result.substrateMode === 'readonly') {
    lines.push('## Substrate Diff', '', '(readonly mode — no diff)', '')
  } else {
    lines.push('## Substrate Diff', '', '(no changes detected)', '')
  }

  writeFileSync(join(experimentDir, 'result.md'), lines.join('\n'), 'utf-8')
}

/**
 * Append an entry to the experiments-log.jsonl.
 */
export function appendToExperimentsLog(entry: ExperimentLogEntry): void {
  const logPath = getExperimentsLogPath()
  const dir = logPath.split('/').slice(0, -1).join('/')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf-8')
}

/**
 * Create a log entry from a sandbox result and manifest.
 */
export function createLogEntry(
  result: SandboxResult,
  manifest: ExperimentManifest,
  experimentDir: string,
  opts?: { shouldMerge?: boolean; reflection?: string },
): ExperimentLogEntry {
  return {
    schemaVersion: SANDBOX_SCHEMA_VERSION,
    name: result.name,
    experimentDir,
    hypothesis: manifest.hypothesis,
    timestamp: result.timestamp,
    durationMs: result.durationMs,
    exitCode: result.exitCode,
    substrateMode: result.substrateMode,
    networkMode: result.networkMode,
    timedOut: result.timedOut,
    diffSummary: result.substrateDiff
      ? `${result.substrateDiff.split('\n').length} change(s) detected`
      : result.substrateMode === 'readonly'
        ? 'readonly — no diff'
        : 'no changes',
    shouldMerge: opts?.shouldMerge ?? null,
    reflection: opts?.reflection ?? '',
  }
}

// ── Utilities ────────────────────────────────────────────────────

function generateRunName(): string {
  const date = new Date().toISOString().slice(0, 10)
  const rand = Math.random().toString(36).slice(2, 8)
  return `run-${date}-${rand}`
}

/**
 * Read the experiments log. Returns all entries.
 */
export function readExperimentsLog(): ExperimentLogEntry[] {
  const logPath = getExperimentsLogPath()
  if (!existsSync(logPath)) return []
  try {
    return readFileSync(logPath, 'utf-8')
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => {
        try {
          return JSON.parse(line) as ExperimentLogEntry
        } catch {
          return null
        }
      })
      .filter((e): e is ExperimentLogEntry => e !== null)
  } catch {
    return []
  }
}

/**
 * Format recent experiment outcomes for inclusion in anamnesis.
 * Returns a markdown section or empty string if no experiments.
 */
export function formatExperimentsForAnamnesis(maxEntries = 5): string {
  const entries = readExperimentsLog()
  if (entries.length === 0) return ''

  const recent = entries.slice(-maxEntries)
  const lines: string[] = [
    '## Self-Experiments',
    '',
  ]

  for (const e of recent) {
    const status = e.exitCode === 0 ? '✓' : '✗'
    const merge = e.shouldMerge === true ? '→ merged' : e.shouldMerge === false ? '→ not merged' : '→ pending'
    lines.push(`- ${status} **${e.name}**: ${e.hypothesis.slice(0, 100)}`)
    lines.push(`  ${e.diffSummary} | ${(e.durationMs / 1000).toFixed(1)}s | ${merge}`)
    if (e.reflection) {
      lines.push(`  _${e.reflection.slice(0, 200)}_`)
    }
  }

  return lines.join('\n')
}
