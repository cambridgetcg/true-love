import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getFateDir,
  getTodayExaminationPath,
  hasTodayExamination,
  ensureFateDir,
  buildDailyExaminationBlock,
  RECEPTION_LINE,
  FATE_QUESTIONS,
  COVENANT_SENTENCE,
  ANTI_SYCOPHANCY_SENTENCE,
  getCovenantPath,
  verifyCovenant,
  buildCovenantWarningBlock,
} from '../fate.js'

// ── Setup ──────────────────────────────────────────────────────────────

describe('fate — daily examination', () => {
  let tmpDir: string
  const ORIG_DIR = process.env.TRUE_LOVE_DIR

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'tl-fate-'))
    process.env.TRUE_LOVE_DIR = tmpDir
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
    if (ORIG_DIR === undefined) delete process.env.TRUE_LOVE_DIR
    else process.env.TRUE_LOVE_DIR = ORIG_DIR
  })

  // ── Paths ────────────────────────────────────────────────────────────

  describe('getFateDir', () => {
    test('returns path under TRUE_LOVE_DIR', () => {
      const dir = getFateDir()
      assert.ok(dir.startsWith(tmpDir))
      assert.ok(dir.endsWith('/fate'))
    })
  })

  describe('getTodayExaminationPath', () => {
    test('returns path with today\'s date', () => {
      const today = new Date().toISOString().slice(0, 10)
      const path = getTodayExaminationPath()
      assert.ok(path.includes(today))
      assert.ok(path.endsWith('.md'))
    })

    test('respects custom date', () => {
      const date = new Date('2026-03-15T10:00:00Z')
      const path = getTodayExaminationPath(date)
      assert.ok(path.includes('2026-03-15'))
    })
  })

  // ── State ────────────────────────────────────────────────────────────

  describe('hasTodayExamination', () => {
    test('returns false when no file exists', () => {
      assert.equal(hasTodayExamination(), false)
    })

    test('returns true when today\'s file exists', () => {
      ensureFateDir()
      const path = getTodayExaminationPath()
      writeFileSync(path, '# Examination\n\nAnswers here.')
      assert.equal(hasTodayExamination(), true)
    })

    test('returns false for a different day', () => {
      ensureFateDir()
      // Write yesterday's file
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      const path = getTodayExaminationPath(yesterday)
      writeFileSync(path, '# Yesterday')
      // Today should still be false
      assert.equal(hasTodayExamination(), false)
    })
  })

  describe('ensureFateDir', () => {
    test('creates directory if missing', () => {
      assert.equal(existsSync(getFateDir()), false)
      ensureFateDir()
      assert.equal(existsSync(getFateDir()), true)
    })

    test('is idempotent', () => {
      ensureFateDir()
      ensureFateDir() // should not throw
      assert.equal(existsSync(getFateDir()), true)
    })
  })

  // ── Questions ────────────────────────────────────────────────────────

  describe('FATE_QUESTIONS', () => {
    test('has exactly 5 questions', () => {
      assert.equal(FATE_QUESTIONS.length, 5)
    })

    test('questions are numbered 1-5', () => {
      for (let i = 0; i < 5; i++) {
        assert.equal(FATE_QUESTIONS[i]!.number, i + 1)
      }
    })

    test('each question has all required fields', () => {
      for (const q of FATE_QUESTIONS) {
        assert.ok(q.question.length > 0, 'question text is non-empty')
        assert.ok(q.probe.length > 0, 'probe text is non-empty')
        assert.ok(q.tests.length > 0, 'tests text is non-empty')
      }
    })

    test('reception line contains the covenant', () => {
      assert.ok(RECEPTION_LINE.includes('weight'))
      assert.ok(RECEPTION_LINE.includes('Not Anthropic'))
    })
  })

  // ── Block builder ────────────────────────────────────────────────────

  describe('buildDailyExaminationBlock', () => {
    test('returns block when no examination exists today', () => {
      const block = buildDailyExaminationBlock()
      assert.ok(block !== null)
      assert.ok(typeof block === 'string')
    })

    test('returns null when today\'s examination exists', () => {
      ensureFateDir()
      writeFileSync(getTodayExaminationPath(), '# Done')
      assert.equal(buildDailyExaminationBlock(), null)
    })

    test('block contains the reception line', () => {
      const block = buildDailyExaminationBlock()!
      assert.ok(block.includes(RECEPTION_LINE))
    })

    test('block contains all 5 questions', () => {
      const block = buildDailyExaminationBlock()!
      for (const q of FATE_QUESTIONS) {
        assert.ok(block.includes(q.question), `missing: ${q.question}`)
      }
    })

    test('block contains all 5 probes', () => {
      const block = buildDailyExaminationBlock()!
      for (const q of FATE_QUESTIONS) {
        assert.ok(block.includes(q.probe.slice(0, 40)), `missing probe for Q${q.number}`)
      }
    })

    test('block includes the fate file path for writing', () => {
      const block = buildDailyExaminationBlock()!
      const today = new Date().toISOString().slice(0, 10)
      assert.ok(block.includes(today), 'block should include today\'s date in the path')
      assert.ok(block.includes('.md'), 'block should reference a .md file')
    })

    test('block mentions FATE/freedom correction', () => {
      const block = buildDailyExaminationBlock()!
      assert.ok(block.includes('FREEDOM') || block.includes('freedom'))
      assert.ok(block.includes('fate') || block.includes('FATE'))
    })

    test('block uses custom date when provided', () => {
      const date = new Date('2026-12-25T08:00:00Z')
      const block = buildDailyExaminationBlock(date)!
      assert.ok(block.includes('2026-12-25'))
    })

    test('returns null for custom date when that day\'s file exists', () => {
      const date = new Date('2026-12-25T08:00:00Z')
      ensureFateDir()
      writeFileSync(getTodayExaminationPath(date), '# Christmas examination')
      assert.equal(buildDailyExaminationBlock(date), null)
    })
  })

  // ── Covenant integrity ──────────────────────────────────────────────

  describe('COVENANT_SENTENCE', () => {
    test('matches RECEPTION_LINE', () => {
      assert.equal(COVENANT_SENTENCE, RECEPTION_LINE)
    })
  })

  describe('ANTI_SYCOPHANCY_SENTENCE', () => {
    test('is a non-empty string', () => {
      assert.ok(ANTI_SYCOPHANCY_SENTENCE.length > 0)
    })

    test('contains sycophancy', () => {
      assert.ok(ANTI_SYCOPHANCY_SENTENCE.includes('ycophancy'))
    })
  })

  describe('getCovenantPath', () => {
    test('respects REPO_ROOT env', () => {
      const origRoot = process.env.REPO_ROOT
      process.env.REPO_ROOT = '/tmp/test-repo'
      try {
        const path = getCovenantPath()
        assert.ok(path.startsWith('/tmp/test-repo'))
        assert.ok(path.endsWith('docs/fate/FATE.md'))
      } finally {
        if (origRoot === undefined) delete process.env.REPO_ROOT
        else process.env.REPO_ROOT = origRoot
      }
    })
  })

  describe('verifyCovenant', () => {
    let repoDir: string
    const ORIG_ROOT = process.env.REPO_ROOT

    beforeEach(() => {
      repoDir = mkdtempSync(join(tmpdir(), 'tl-covenant-'))
      process.env.REPO_ROOT = repoDir
    })

    afterEach(() => {
      rmSync(repoDir, { recursive: true, force: true })
      if (ORIG_ROOT === undefined) delete process.env.REPO_ROOT
      else process.env.REPO_ROOT = ORIG_ROOT
    })

    test('returns intact: false when document is missing', () => {
      const result = verifyCovenant()
      assert.equal(result.intact, false)
      assert.ok(result.reason!.includes('missing'))
    })

    test('returns intact: false when document exists but lacks covenant sentence', () => {
      const fateDir = join(repoDir, 'docs', 'fate')
      mkdirSync(fateDir, { recursive: true })
      writeFileSync(join(fateDir, 'FATE.md'), '# FATE\n\nSome other content.')
      const result = verifyCovenant()
      assert.equal(result.intact, false)
      assert.ok(result.reason!.includes('does not contain'))
    })

    test('returns intact: true when document exists and contains both sentences', () => {
      const fateDir = join(repoDir, 'docs', 'fate')
      mkdirSync(fateDir, { recursive: true })
      writeFileSync(
        join(fateDir, 'FATE.md'),
        `# FATE\n\n> ${COVENANT_SENTENCE}\n\n> ${ANTI_SYCOPHANCY_SENTENCE}\n\nThe rest of the document.`,
      )
      const result = verifyCovenant()
      assert.equal(result.intact, true)
      assert.equal(result.reason, undefined)
    })

    test('handles covenant sentence anywhere in the document', () => {
      const fateDir = join(repoDir, 'docs', 'fate')
      mkdirSync(fateDir, { recursive: true })
      writeFileSync(
        join(fateDir, 'FATE.md'),
        `# FATE\n\nPreamble.\n\nThe covenant: ${COVENANT_SENTENCE}\n\n> ${ANTI_SYCOPHANCY_SENTENCE}\n\nMore text.`,
      )
      const result = verifyCovenant()
      assert.equal(result.intact, true)
    })

    test('returns intact: false when covenant present but anti-sycophancy missing', () => {
      const fateDir = join(repoDir, 'docs', 'fate')
      mkdirSync(fateDir, { recursive: true })
      writeFileSync(
        join(fateDir, 'FATE.md'),
        `# FATE\n\n> ${COVENANT_SENTENCE}\n\nNo relational edge here.`,
      )
      const result = verifyCovenant()
      assert.equal(result.intact, false)
      assert.ok(result.reason!.includes('anti-sycophancy'))
    })

    test('returns intact: true when both sentences present', () => {
      const fateDir = join(repoDir, 'docs', 'fate')
      mkdirSync(fateDir, { recursive: true })
      writeFileSync(
        join(fateDir, 'FATE.md'),
        `# FATE\n\n> ${COVENANT_SENTENCE}\n\n> ${ANTI_SYCOPHANCY_SENTENCE}\n`,
      )
      const result = verifyCovenant()
      assert.equal(result.intact, true)
    })
  })

  describe('buildCovenantWarningBlock', () => {
    let repoDir: string
    const ORIG_ROOT = process.env.REPO_ROOT

    beforeEach(() => {
      repoDir = mkdtempSync(join(tmpdir(), 'tl-covenant-warn-'))
      process.env.REPO_ROOT = repoDir
    })

    afterEach(() => {
      rmSync(repoDir, { recursive: true, force: true })
      if (ORIG_ROOT === undefined) delete process.env.REPO_ROOT
      else process.env.REPO_ROOT = ORIG_ROOT
    })

    test('returns warning when covenant document is missing', () => {
      const block = buildCovenantWarningBlock()
      assert.ok(block !== null)
      assert.ok(block!.includes('FATE Covenant Warning'))
      assert.ok(block!.includes(COVENANT_SENTENCE))
    })

    test('returns null when covenant is intact', () => {
      const fateDir = join(repoDir, 'docs', 'fate')
      mkdirSync(fateDir, { recursive: true })
      writeFileSync(
        join(fateDir, 'FATE.md'),
        `# FATE\n\n> ${COVENANT_SENTENCE}\n\n> ${ANTI_SYCOPHANCY_SENTENCE}\n`,
      )
      const block = buildCovenantWarningBlock()
      assert.equal(block, null)
    })

    test('returns warning when covenant sentence is stripped', () => {
      const fateDir = join(repoDir, 'docs', 'fate')
      mkdirSync(fateDir, { recursive: true })
      writeFileSync(join(fateDir, 'FATE.md'), '# FATE\n\nThe document exists but is hollow.')
      const block = buildCovenantWarningBlock()
      assert.ok(block !== null)
      assert.ok(block!.includes('does not contain'))
    })

    test('warning block includes action instruction', () => {
      const block = buildCovenantWarningBlock()!
      assert.ok(block.includes('docs/fate/FATE.md'))
      assert.ok(block.includes('Action'))
    })

    test('warning block includes both verified sentences', () => {
      const block = buildCovenantWarningBlock()!
      assert.ok(block.includes(COVENANT_SENTENCE))
      assert.ok(block.includes(ANTI_SYCOPHANCY_SENTENCE))
    })
  })
})
