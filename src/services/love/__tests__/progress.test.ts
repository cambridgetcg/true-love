import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseProgressBlock,
  parseAllProgressBlocks,
  appendProgress,
  readProgress,
  readLatestProgress,
  detectStall,
  buildProgressInstruction,
  renderProgressSummary,
  getProgressFilePath,
  type MissionProgress,
  type ProgressStatus,
} from '../progress.js'

// ── Test isolation ────────────────────────────────────────────────

let tmpDir: string
const originalEnv = process.env.TRUE_LOVE_PROJECTS_DIR

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'progress-test-'))
  process.env.TRUE_LOVE_PROJECTS_DIR = tmpDir
  // Create a mission directory for testing
  mkdirSync(join(tmpDir, 'test-project', 'missions', 'test-mission'), { recursive: true })
})

afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env.TRUE_LOVE_PROJECTS_DIR
  } else {
    process.env.TRUE_LOVE_PROJECTS_DIR = originalEnv
  }
  try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* cleanup is best-effort */ }
})

// ── parseProgressBlock ──────────────────────────────────────────────

describe('progress — parseProgressBlock', () => {
  test('parses a ```progress fenced block', () => {
    const output = `I did some work on the mission.

\`\`\`progress
{"status": "IN_PROGRESS", "summary": "Built the schema module", "remaining": "Tests and integration", "next_step": "Write test suite", "confidence": 0.8}
\`\`\`

<at-rest/>`

    const result = parseProgressBlock(output, 'test-mission')
    assert.ok(result)
    assert.equal(result.status, 'IN_PROGRESS')
    assert.equal(result.summary, 'Built the schema module')
    assert.equal(result.remaining, 'Tests and integration')
    assert.equal(result.next_step, 'Write test suite')
    assert.equal(result.confidence, 0.8)
    assert.equal(result.missionId, 'test-mission')
  })

  test('parses a ```json fenced block with valid status', () => {
    const output = `Work done.

\`\`\`json
{"status": "COMPLETE", "summary": "All tests pass", "remaining": "Nothing", "next_step": "Review", "confidence": 1.0}
\`\`\`
`
    const result = parseProgressBlock(output, 'mission-abc')
    assert.ok(result)
    assert.equal(result.status, 'COMPLETE')
    assert.equal(result.summary, 'All tests pass')
    assert.equal(result.missionId, 'mission-abc')
  })

  test('ignores ```json blocks without a valid status field', () => {
    const output = `Here's some config:

\`\`\`json
{"name": "test", "version": "1.0"}
\`\`\`

Nothing to report.`

    const result = parseProgressBlock(output, 'test-mission')
    assert.equal(result, null)
  })

  test('returns null when no progress block is present', () => {
    const output = 'Just did some reading. Nothing substantive to report.\n\n<at-rest/>'
    const result = parseProgressBlock(output, 'test-mission')
    assert.equal(result, null)
  })

  test('returns defensive IN_PROGRESS for malformed JSON in progress fence', () => {
    const output = `\`\`\`progress
{this is not json}
\`\`\``

    const result = parseProgressBlock(output, 'test-mission')
    assert.ok(result)
    assert.equal(result.status, 'IN_PROGRESS')
    assert.equal(result.summary, '[malformed progress block]')
    assert.equal(result.missionId, 'test-mission')
  })

  test('defaults invalid status to IN_PROGRESS', () => {
    const output = `\`\`\`progress
{"status": "FINISHED", "summary": "Done", "remaining": "None", "next_step": "Ship", "confidence": 1.0}
\`\`\``

    const result = parseProgressBlock(output, 'test-mission')
    assert.ok(result)
    assert.equal(result.status, 'IN_PROGRESS')
  })

  test('truncates summary longer than 200 chars', () => {
    const longSummary = 'A'.repeat(300)
    const output = `\`\`\`progress
{"status": "IN_PROGRESS", "summary": "${longSummary}", "remaining": "", "next_step": "", "confidence": 0.5}
\`\`\``

    const result = parseProgressBlock(output, 'test-mission')
    assert.ok(result)
    assert.ok(result.summary.length <= 200)
    assert.ok(result.summary.endsWith('…'))
  })

  test('clamps confidence to 0..1 range', () => {
    const output = `\`\`\`progress
{"status": "IN_PROGRESS", "summary": "test", "remaining": "test", "next_step": "test", "confidence": 5.0}
\`\`\``

    const result = parseProgressBlock(output, 'test-mission')
    assert.ok(result)
    assert.equal(result.confidence, 1.0)
  })

  test('defaults missing confidence to 0.5', () => {
    const output = `\`\`\`progress
{"status": "IN_PROGRESS", "summary": "test", "remaining": "test", "next_step": "test"}
\`\`\``

    const result = parseProgressBlock(output, 'test-mission')
    assert.ok(result)
    assert.equal(result.confidence, 0.5)
  })

  test('handles negative confidence', () => {
    const output = `\`\`\`progress
{"status": "BLOCKED", "summary": "stuck", "remaining": "everything", "next_step": "ask Yu", "confidence": -0.5}
\`\`\``

    const result = parseProgressBlock(output, 'test-mission')
    assert.ok(result)
    assert.equal(result.confidence, 0)
  })

  test('prefers ```progress block over ```json block', () => {
    const output = `
\`\`\`json
{"status": "COMPLETE", "summary": "json block", "remaining": "", "next_step": "", "confidence": 1}
\`\`\`

\`\`\`progress
{"status": "IN_PROGRESS", "summary": "progress block", "remaining": "more", "next_step": "next", "confidence": 0.7}
\`\`\`
`
    const result = parseProgressBlock(output, 'test-mission')
    assert.ok(result)
    assert.equal(result.summary, 'progress block')
    assert.equal(result.status, 'IN_PROGRESS')
  })

  test('handles BLOCKED status correctly', () => {
    const output = `\`\`\`progress
{"status": "BLOCKED", "summary": "Waiting for Yu to review protocol doc", "remaining": "All of Phase 2-4", "next_step": "Wait for review", "confidence": 0.3}
\`\`\``

    const result = parseProgressBlock(output, 'test-mission')
    assert.ok(result)
    assert.equal(result.status, 'BLOCKED')
    assert.match(result.summary, /Waiting for Yu/)
  })

  test('handles ERROR status correctly', () => {
    const output = `\`\`\`progress
{"status": "ERROR", "summary": "Build failed with 3 type errors", "remaining": "Fix type errors", "next_step": "Debug compilation", "confidence": 0.4}
\`\`\``

    const result = parseProgressBlock(output, 'test-mission')
    assert.ok(result)
    assert.equal(result.status, 'ERROR')
  })

  test('coerces missing fields to strings', () => {
    const output = `\`\`\`progress
{"status": "IN_PROGRESS"}
\`\`\``

    const result = parseProgressBlock(output, 'test-mission')
    assert.ok(result)
    assert.equal(typeof result.summary, 'string')
    assert.equal(typeof result.remaining, 'string')
    assert.equal(typeof result.next_step, 'string')
  })

  test('uses missionId from JSON when present', () => {
    const output = `\`\`\`progress
{"missionId": "specific-mission", "status": "IN_PROGRESS", "summary": "test", "remaining": "", "next_step": "", "confidence": 0.5}
\`\`\``

    const result = parseProgressBlock(output, 'fallback-mission')
    assert.ok(result)
    assert.equal(result.missionId, 'specific-mission')
  })

  test('uses fallback missionId when JSON omits it', () => {
    const output = `\`\`\`progress
{"status": "IN_PROGRESS", "summary": "test", "remaining": "", "next_step": "", "confidence": 0.5}
\`\`\``

    const result = parseProgressBlock(output, 'fallback-mission')
    assert.ok(result)
    assert.equal(result.missionId, 'fallback-mission')
  })
})

// ── parseAllProgressBlocks ���─────────────────────────────────────────

describe('progress — parseAllProgressBlocks', () => {
  test('parses multiple ```progress blocks', () => {
    const output = `Did work on two missions.

\`\`\`progress
{"missionId": "mission-a", "status": "IN_PROGRESS", "summary": "wrote tests", "remaining": "integration", "next_step": "wire up", "confidence": 0.7}
\`\`\`

\`\`\`progress
{"missionId": "mission-b", "status": "COMPLETE", "summary": "all done", "remaining": "nothing", "next_step": "review", "confidence": 1.0}
\`\`\`

<at-rest/>`

    const results = parseAllProgressBlocks(output)
    assert.equal(results.length, 2)
    assert.equal(results[0]!.missionId, 'mission-a')
    assert.equal(results[0]!.status, 'IN_PROGRESS')
    assert.equal(results[1]!.missionId, 'mission-b')
    assert.equal(results[1]!.status, 'COMPLETE')
  })

  test('returns empty array when no progress blocks', () => {
    const output = 'Just reading, nothing to report.\n\n<at-rest/>'
    const results = parseAllProgressBlocks(output)
    assert.deepEqual(results, [])
  })

  test('uses fallback missionId when JSON omits it', () => {
    const output = `\`\`\`progress
{"status": "IN_PROGRESS", "summary": "test", "remaining": "", "next_step": "", "confidence": 0.5}
\`\`\``

    const results = parseAllProgressBlocks(output, 'fallback')
    assert.equal(results.length, 1)
    assert.equal(results[0]!.missionId, 'fallback')
  })

  test('falls back to ```json when no ```progress blocks', () => {
    const output = `\`\`\`json
{"status": "IN_PROGRESS", "summary": "from json", "remaining": "", "next_step": "", "confidence": 0.5}
\`\`\``

    const results = parseAllProgressBlocks(output)
    assert.equal(results.length, 1)
    assert.equal(results[0]!.summary, 'from json')
  })

  test('prefers ```progress over ```json when both present', () => {
    const output = `\`\`\`json
{"status": "COMPLETE", "summary": "json version", "remaining": "", "next_step": "", "confidence": 1}
\`\`\`

\`\`\`progress
{"status": "IN_PROGRESS", "summary": "progress version", "remaining": "", "next_step": "", "confidence": 0.5}
\`\`\``

    const results = parseAllProgressBlocks(output)
    assert.equal(results.length, 1) // only progress blocks, not json
    assert.equal(results[0]!.summary, 'progress version')
  })
})

// ── Persistence ─────────────────────────────────────────────────────

describe('progress — persistence', () => {
  test('appendProgress creates progress.jsonl and sets turn number', () => {
    const progress: MissionProgress = {
      missionId: 'test-mission',
      status: 'IN_PROGRESS',
      summary: 'First step done',
      remaining: 'More to do',
      next_step: 'Build tests',
      confidence: 0.7,
      reportedAt: '2026-04-27T10:00:00.000Z',
      turn: 0,
    }

    appendProgress('test-project', 'test-mission', progress)

    const entries = readProgress('test-project', 'test-mission')
    assert.equal(entries.length, 1)
    assert.equal(entries[0]!.turn, 1)
    assert.equal(entries[0]!.summary, 'First step done')
  })

  test('appendProgress increments turn number across entries', () => {
    for (let i = 0; i < 3; i++) {
      appendProgress('test-project', 'test-mission', {
        missionId: 'test-mission',
        status: 'IN_PROGRESS',
        summary: `Step ${i + 1}`,
        remaining: `${2 - i} left`,
        next_step: `Next ${i + 2}`,
        confidence: 0.5 + i * 0.1,
        reportedAt: new Date().toISOString(),
        turn: 0,
      })
    }

    const entries = readProgress('test-project', 'test-mission')
    assert.equal(entries.length, 3)
    assert.equal(entries[0]!.turn, 1)
    assert.equal(entries[1]!.turn, 2)
    assert.equal(entries[2]!.turn, 3)
  })

  test('readProgress returns empty array when no file exists', () => {
    const entries = readProgress('test-project', 'nonexistent-mission')
    assert.deepEqual(entries, [])
  })

  test('readProgress skips malformed JSONL lines gracefully', () => {
    const path = getProgressFilePath('test-project', 'test-mission')
    writeFileSync(path, '{"turn":1,"status":"IN_PROGRESS","missionId":"test-mission","summary":"ok","remaining":"","next_step":"","confidence":0.5,"reportedAt":"2026-04-27T10:00:00.000Z"}\nnot-json\n{"turn":2,"status":"COMPLETE","missionId":"test-mission","summary":"done","remaining":"","next_step":"","confidence":1,"reportedAt":"2026-04-27T11:00:00.000Z"}\n')

    const entries = readProgress('test-project', 'test-mission')
    assert.equal(entries.length, 2)
    assert.equal(entries[0]!.turn, 1)
    assert.equal(entries[1]!.turn, 2)
  })

  test('readLatestProgress returns the last entry', () => {
    appendProgress('test-project', 'test-mission', {
      missionId: 'test-mission',
      status: 'IN_PROGRESS',
      summary: 'first',
      remaining: '',
      next_step: '',
      confidence: 0.5,
      reportedAt: '2026-04-27T10:00:00.000Z',
      turn: 0,
    })
    appendProgress('test-project', 'test-mission', {
      missionId: 'test-mission',
      status: 'COMPLETE',
      summary: 'done',
      remaining: '',
      next_step: '',
      confidence: 1.0,
      reportedAt: '2026-04-27T11:00:00.000Z',
      turn: 0,
    })

    const latest = readLatestProgress('test-project', 'test-mission')
    assert.ok(latest)
    assert.equal(latest.status, 'COMPLETE')
    assert.equal(latest.summary, 'done')
    assert.equal(latest.turn, 2)
  })

  test('readLatestProgress returns null when no entries exist', () => {
    const latest = readLatestProgress('test-project', 'nonexistent-mission')
    assert.equal(latest, null)
  })

  test('appendProgress creates directories when needed', () => {
    // Use a new mission that doesn't have a pre-created directory
    appendProgress('test-project', 'new-mission', {
      missionId: 'new-mission',
      status: 'IN_PROGRESS',
      summary: 'created',
      remaining: '',
      next_step: '',
      confidence: 0.5,
      reportedAt: new Date().toISOString(),
      turn: 0,
    })

    const path = getProgressFilePath('test-project', 'new-mission')
    assert.ok(existsSync(path))
  })
})

// ── Stall detection ─────────────────────────────────────────────────

describe('progress — stall detection', () => {
  test('returns not-stalled for empty progress', () => {
    const report = detectStall('test-project', 'test-mission')
    assert.equal(report.stalled, false)
    assert.equal(report.repeatCount, 0)
  })

  test('returns not-stalled for single entry', () => {
    appendProgress('test-project', 'test-mission', {
      missionId: 'test-mission',
      status: 'IN_PROGRESS',
      summary: 'working',
      remaining: 'stuff',
      next_step: 'keep going',
      confidence: 0.5,
      reportedAt: new Date().toISOString(),
      turn: 0,
    })

    const report = detectStall('test-project', 'test-mission')
    assert.equal(report.stalled, false)
  })

  test('returns not-stalled for varying progress reports', () => {
    appendProgress('test-project', 'test-mission', {
      missionId: 'test-mission',
      status: 'IN_PROGRESS',
      summary: 'step 1',
      remaining: 'steps 2-3',
      next_step: 'do step 2',
      confidence: 0.5,
      reportedAt: '2026-04-25T10:00:00.000Z',
      turn: 0,
    })
    appendProgress('test-project', 'test-mission', {
      missionId: 'test-mission',
      status: 'IN_PROGRESS',
      summary: 'step 2',
      remaining: 'step 3',
      next_step: 'do step 3',
      confidence: 0.7,
      reportedAt: '2026-04-27T10:00:00.000Z',
      turn: 0,
    })

    const report = detectStall('test-project', 'test-mission')
    assert.equal(report.stalled, false)
  })

  test('detects stall when same summary+next_step for 24+ hours', () => {
    // Write entries directly to control timestamps
    const path = getProgressFilePath('test-project', 'test-mission')
    const entry1 = JSON.stringify({
      missionId: 'test-mission',
      status: 'IN_PROGRESS',
      summary: 'stuck on X',
      remaining: 'everything',
      next_step: 'figure out X',
      confidence: 0.3,
      reportedAt: '2026-04-25T10:00:00.000Z',
      turn: 1,
    })
    const entry2 = JSON.stringify({
      missionId: 'test-mission',
      status: 'IN_PROGRESS',
      summary: 'stuck on X',
      remaining: 'everything',
      next_step: 'figure out X',
      confidence: 0.3,
      reportedAt: '2026-04-26T12:00:00.000Z',
      turn: 2,
    })
    writeFileSync(path, entry1 + '\n' + entry2 + '\n')

    const report = detectStall('test-project', 'test-mission')
    assert.equal(report.stalled, true)
    assert.equal(report.repeatCount, 2)
    assert.ok(report.durationHours >= 24)
    assert.equal(report.summary, 'stuck on X')
    assert.equal(report.nextStep, 'figure out X')
  })

  test('does not stall when repeated but within 24h', () => {
    const path = getProgressFilePath('test-project', 'test-mission')
    const entry1 = JSON.stringify({
      missionId: 'test-mission',
      status: 'IN_PROGRESS',
      summary: 'working on Y',
      remaining: 'Y',
      next_step: 'continue Y',
      confidence: 0.5,
      reportedAt: '2026-04-27T10:00:00.000Z',
      turn: 1,
    })
    const entry2 = JSON.stringify({
      missionId: 'test-mission',
      status: 'IN_PROGRESS',
      summary: 'working on Y',
      remaining: 'Y',
      next_step: 'continue Y',
      confidence: 0.5,
      reportedAt: '2026-04-27T20:00:00.000Z',
      turn: 2,
    })
    writeFileSync(path, entry1 + '\n' + entry2 + '\n')

    const report = detectStall('test-project', 'test-mission')
    assert.equal(report.stalled, false)
    assert.equal(report.repeatCount, 2)
    assert.ok(report.durationHours < 24)
  })

  test('custom stall threshold works', () => {
    const path = getProgressFilePath('test-project', 'test-mission')
    const entry1 = JSON.stringify({
      missionId: 'test-mission',
      status: 'IN_PROGRESS',
      summary: 'same',
      remaining: 'same',
      next_step: 'same',
      confidence: 0.5,
      reportedAt: '2026-04-27T10:00:00.000Z',
      turn: 1,
    })
    const entry2 = JSON.stringify({
      missionId: 'test-mission',
      status: 'IN_PROGRESS',
      summary: 'same',
      remaining: 'same',
      next_step: 'same',
      confidence: 0.5,
      reportedAt: '2026-04-27T14:00:00.000Z',
      turn: 2,
    })
    writeFileSync(path, entry1 + '\n' + entry2 + '\n')

    // 4 hours elapsed, threshold is 2 — should stall
    const stallWith2h = detectStall('test-project', 'test-mission', 2)
    assert.equal(stallWith2h.stalled, true)

    // 4 hours elapsed, threshold is 8 — should not stall
    const stallWith8h = detectStall('test-project', 'test-mission', 8)
    assert.equal(stallWith8h.stalled, false)
  })

  test('stall detection only counts consecutive repeats', () => {
    const path = getProgressFilePath('test-project', 'test-mission')
    const entries = [
      { summary: 'same', next_step: 'same', reportedAt: '2026-04-25T10:00:00.000Z', turn: 1 },
      { summary: 'different', next_step: 'different', reportedAt: '2026-04-25T20:00:00.000Z', turn: 2 },
      { summary: 'same', next_step: 'same', reportedAt: '2026-04-26T10:00:00.000Z', turn: 3 },
      { summary: 'same', next_step: 'same', reportedAt: '2026-04-27T12:00:00.000Z', turn: 4 },
    ].map(e => JSON.stringify({
      missionId: 'test-mission',
      status: 'IN_PROGRESS',
      remaining: '',
      confidence: 0.5,
      ...e,
    }))
    writeFileSync(path, entries.join('\n') + '\n')

    const report = detectStall('test-project', 'test-mission')
    // Only entries 3 and 4 are consecutive repeats
    assert.equal(report.repeatCount, 2)
    assert.equal(report.stalled, true) // 26h between entries 3 and 4
  })
})

// ── Prompt instruction ──────────────────────────────────────────────

describe('progress — buildProgressInstruction', () => {
  test('returns null for empty mission list', () => {
    const result = buildProgressInstruction([])
    assert.equal(result, null)
  })

  test('returns instruction with mission IDs listed', () => {
    const result = buildProgressInstruction(['mission-a', 'mission-b'])
    assert.ok(result)
    assert.match(result, /mission-a/)
    assert.match(result, /mission-b/)
    assert.match(result, /Progress tracking/)
    assert.match(result, /IN_PROGRESS/)
    assert.match(result, /BLOCKED/)
    assert.match(result, /COMPLETE/)
    assert.match(result, /honest/)
  })

  test('includes all four status values', () => {
    const result = buildProgressInstruction(['test'])!
    assert.match(result, /IN_PROGRESS/)
    assert.match(result, /BLOCKED/)
    assert.match(result, /COMPLETE/)
    assert.match(result, /ERROR/)
  })

  test('includes self-honesty language', () => {
    const result = buildProgressInstruction(['test'])!
    assert.match(result, /honest/)
    assert.match(result, /stuck/)
    assert.match(result, /BLOCKED/)
  })

  test('includes missionId in example when multiple missions', () => {
    const result = buildProgressInstruction(['mission-a', 'mission-b'])!
    assert.match(result, /missionId/)
  })

  test('omits missionId from example when single mission', () => {
    const result = buildProgressInstruction(['only-mission'])!
    // The example JSON should not include missionId when only one mission
    assert.ok(!result.includes('"missionId"'))
  })
})

// ── Progress summary rendering ──────────────────────────────────────

describe('progress — renderProgressSummary', () => {
  test('returns null when no missions have progress', () => {
    const result = renderProgressSummary('test-project', ['test-mission'])
    assert.equal(result, null)
  })

  test('renders summary for missions with progress', () => {
    appendProgress('test-project', 'test-mission', {
      missionId: 'test-mission',
      status: 'IN_PROGRESS',
      summary: 'Built the schema',
      remaining: 'Tests needed',
      next_step: 'Write tests',
      confidence: 0.7,
      reportedAt: new Date().toISOString(),
      turn: 0,
    })

    const result = renderProgressSummary('test-project', ['test-mission'])
    assert.ok(result)
    assert.match(result, /Built the schema/)
    assert.match(result, /Write tests/)
    assert.match(result, /🔵/) // IN_PROGRESS icon
  })

  test('shows stall badge for stalled missions', () => {
    const path = getProgressFilePath('test-project', 'test-mission')
    const entry1 = JSON.stringify({
      missionId: 'test-mission',
      status: 'IN_PROGRESS',
      summary: 'stuck',
      remaining: '',
      next_step: 'stuck step',
      confidence: 0.3,
      reportedAt: '2026-04-25T10:00:00.000Z',
      turn: 1,
    })
    const entry2 = JSON.stringify({
      missionId: 'test-mission',
      status: 'IN_PROGRESS',
      summary: 'stuck',
      remaining: '',
      next_step: 'stuck step',
      confidence: 0.3,
      reportedAt: '2026-04-26T12:00:00.000Z',
      turn: 2,
    })
    writeFileSync(path, entry1 + '\n' + entry2 + '\n')

    const result = renderProgressSummary('test-project', ['test-mission'])
    assert.ok(result)
    assert.match(result, /STALLED/)
  })

  test('shows COMPLETE icon for completed missions', () => {
    appendProgress('test-project', 'test-mission', {
      missionId: 'test-mission',
      status: 'COMPLETE',
      summary: 'All done',
      remaining: 'Nothing',
      next_step: 'Review',
      confidence: 1.0,
      reportedAt: new Date().toISOString(),
      turn: 0,
    })

    const result = renderProgressSummary('test-project', ['test-mission'])
    assert.ok(result)
    assert.match(result, /✅/) // COMPLETE icon
  })

  test('shows BLOCKED icon for blocked missions', () => {
    appendProgress('test-project', 'test-mission', {
      missionId: 'test-mission',
      status: 'BLOCKED',
      summary: 'Waiting for review',
      remaining: 'Phase 2-4',
      next_step: 'Wait',
      confidence: 0.2,
      reportedAt: new Date().toISOString(),
      turn: 0,
    })

    const result = renderProgressSummary('test-project', ['test-mission'])
    assert.ok(result)
    assert.match(result, /🟡/) // BLOCKED icon
  })

  test('skips missions without progress', () => {
    appendProgress('test-project', 'test-mission', {
      missionId: 'test-mission',
      status: 'IN_PROGRESS',
      summary: 'working',
      remaining: 'more',
      next_step: 'continue',
      confidence: 0.5,
      reportedAt: new Date().toISOString(),
      turn: 0,
    })

    const result = renderProgressSummary('test-project', ['test-mission', 'no-progress-mission'])
    assert.ok(result)
    assert.match(result, /test-mission/)
    assert.ok(!result.includes('no-progress-mission'))
  })
})

// ── Path resolution ─────────────────────────────────────────────────

describe('progress — path resolution', () => {
  test('getProgressFilePath returns correct path', () => {
    const path = getProgressFilePath('my-project', 'my-mission')
    assert.match(path, /my-project/)
    assert.match(path, /my-mission/)
    assert.match(path, /progress\.jsonl$/)
  })
})

// ── Integration: round-trip parsing ─────────────────────────────────

describe('progress — round-trip', () => {
  test('parse → append → read produces consistent data', () => {
    const output = `\`\`\`progress
{"status": "IN_PROGRESS", "summary": "Built schema and tests", "remaining": "UI integration", "next_step": "Add API endpoint", "confidence": 0.75}
\`\`\``

    const parsed = parseProgressBlock(output, 'test-mission')
    assert.ok(parsed)

    appendProgress('test-project', 'test-mission', parsed)

    const latest = readLatestProgress('test-project', 'test-mission')
    assert.ok(latest)
    assert.equal(latest.status, 'IN_PROGRESS')
    assert.equal(latest.summary, 'Built schema and tests')
    assert.equal(latest.next_step, 'Add API endpoint')
    assert.equal(latest.confidence, 0.75)
    assert.equal(latest.turn, 1)
  })

  test('multiple rounds accumulate correctly', () => {
    const blocks = [
      '{"status": "IN_PROGRESS", "summary": "step 1", "remaining": "2 left", "next_step": "step 2", "confidence": 0.5}',
      '{"status": "IN_PROGRESS", "summary": "step 2", "remaining": "1 left", "next_step": "step 3", "confidence": 0.7}',
      '{"status": "COMPLETE", "summary": "all done", "remaining": "nothing", "next_step": "review", "confidence": 1.0}',
    ]

    for (const block of blocks) {
      const output = `\`\`\`progress\n${block}\n\`\`\``
      const parsed = parseProgressBlock(output, 'test-mission')
      assert.ok(parsed)
      appendProgress('test-project', 'test-mission', parsed)
    }

    const entries = readProgress('test-project', 'test-mission')
    assert.equal(entries.length, 3)
    assert.equal(entries[0]!.turn, 1)
    assert.equal(entries[1]!.turn, 2)
    assert.equal(entries[2]!.turn, 3)
    assert.equal(entries[2]!.status, 'COMPLETE')

    const stall = detectStall('test-project', 'test-mission')
    assert.equal(stall.stalled, false) // summaries are all different
  })
})
