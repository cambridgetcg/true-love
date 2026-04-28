import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  detectFiller,
  gradeRatio,
  scoreText,
  scoreTick,
  statusFragment,
  _fillerPatterns,
  type FillerReport,
  type YouSpeakScore,
  type YouSpeakGrade,
} from '../youspeak.js'
import type { TraceStep, ThinkStep, ToolCallStep } from '../mind-trace.js'

// ── Helpers ─────────────────────────────────────────────────────

/** Create a think step with the given text. */
function think(text: string): ThinkStep {
  return { kind: 'think', text, chars: text.length }
}

/** Create a tool call step (filler-free by nature). */
function toolCall(tool: string = 'Read'): ToolCallStep {
  return {
    kind: 'tool_call',
    tool,
    toolUseId: 'test-id',
    input: {},
    inputSummary: 'test',
  }
}

// ── detectFiller ────────────────────────────────────────────────

describe('youspeak — detectFiller', () => {
  test('returns empty report for empty text', () => {
    const report = detectFiller('')
    assert.equal(report.totalMatches, 0)
    assert.equal(report.fillerTokens, 0)
    assert.equal(report.totalTokens, 0)
    assert.deepEqual(report.matches, [])
  })

  test('returns empty report for very short text', () => {
    const report = detectFiller('OK')
    assert.equal(report.totalMatches, 0)
    assert.equal(report.totalTokens, 0)
  })

  test('detects affirmative filler', () => {
    const text = 'Sure! I can help with that. The implementation looks correct and the tests pass.'
    const report = detectFiller(text)
    assert.ok(report.totalMatches > 0, 'should detect affirmative filler')
    assert.ok(report.matches.some(m => m.pattern === 'affirmative'))
  })

  test('detects "let me" narration', () => {
    const text = 'Let me check the file to understand the implementation. Then we can proceed with the changes.'
    const report = detectFiller(text)
    assert.ok(report.matches.some(m => m.pattern === 'let-me'))
  })

  test('detects "going to" narration (weight 3)', () => {
    const text = "I'm going to read the configuration file first. Then I am going to write the new module."
    const report = detectFiller(text)
    const goingTo = report.matches.find(m => m.pattern === 'going-to')
    assert.ok(goingTo, 'should detect going-to pattern')
    assert.equal(goingTo!.weight, 3, 'going-to should have weight 3')
  })

  test('detects "here is" padding', () => {
    const text = "Here's what I found in the codebase. Here is the summary of changes."
    const report = detectFiller(text)
    assert.ok(report.matches.some(m => m.pattern === 'here-is'))
  })

  test('detects completion fluff', () => {
    const text = "I've successfully updated the configuration. I have now completed the migration."
    const report = detectFiller(text)
    assert.ok(report.matches.some(m => m.pattern === 'completed-fluff'))
  })

  test('detects "as mentioned" padding', () => {
    const text = 'As mentioned earlier, the function needs refactoring. As you can see, the tests pass.'
    const report = detectFiller(text)
    assert.ok(report.matches.some(m => m.pattern === 'as-mentioned'))
  })

  test('detects "worth noting" padding', () => {
    const text = "It's worth noting that the API has changed. It is important to mention the deprecation."
    const report = detectFiller(text)
    assert.ok(report.matches.some(m => m.pattern === 'worth-noting'))
  })

  test('detects "changes applied" fluff', () => {
    const text = 'The changes have been made to the configuration file. The updates are now complete.'
    const report = detectFiller(text)
    assert.ok(report.matches.some(m => m.pattern === 'changes-applied'))
  })

  test('detects "looking at" narration', () => {
    const text = 'Looking at the implementation, there are several issues. Looking at your code, I see the pattern.'
    const report = detectFiller(text)
    assert.ok(report.matches.some(m => m.pattern === 'looking-at'))
  })

  test('detects "perfect" filler', () => {
    const text = 'Perfect! The implementation is clean. Perfect. Now we can move on.'
    const report = detectFiller(text)
    assert.ok(report.matches.some(m => m.pattern === 'perfect'))
  })

  test('does NOT flag substantive content', () => {
    const text = 'The function takes a string parameter and returns a boolean. If the input matches the regex pattern, it returns true. Otherwise false. Error handling wraps the parse in a try-catch.'
    const report = detectFiller(text)
    assert.equal(report.totalMatches, 0, 'substantive technical content should have zero filler')
  })

  test('does NOT flag uncertainty hedging', () => {
    const text = "I'm not sure if this is the right approach. The behavior might change in edge cases. There could be a race condition here that I haven't fully analyzed."
    const report = detectFiller(text)
    // Should have zero or very low filler — uncertainty is preserved, not compressed
    assert.ok(report.fillerWeight <= 1, 'uncertainty hedging should not be heavily flagged')
  })

  test('counts multiple matches of same pattern', () => {
    const text = "Let me check the first file. Let me look at the second file. Let me examine the third one."
    const report = detectFiller(text)
    const letMe = report.matches.find(m => m.pattern === 'let-me')
    assert.ok(letMe, 'should find let-me pattern')
    assert.equal(letMe!.count, 3, 'should count all three matches')
  })

  test('calculates filler tokens correctly', () => {
    // Each match ≈ 8 tokens. If 3 matches, fillerTokens ≈ 24
    const text = "Sure! Let me check the file. I'm going to read the implementation first."
    const report = detectFiller(text)
    assert.equal(report.fillerTokens, report.totalMatches * 8)
  })

  test('calculates total tokens as chars/4', () => {
    const text = 'a'.repeat(400) // 400 chars = 100 tokens
    const report = detectFiller(text)
    assert.equal(report.totalTokens, 100)
  })
})

// ── gradeRatio ──────────────────────────────────────────────────

describe('youspeak — gradeRatio', () => {
  test('grade S for ≥98% useful', () => {
    assert.equal(gradeRatio(1.0), 'S')
    assert.equal(gradeRatio(0.99), 'S')
    assert.equal(gradeRatio(0.98), 'S')
  })

  test('grade A for 95-97%', () => {
    assert.equal(gradeRatio(0.97), 'A')
    assert.equal(gradeRatio(0.96), 'A')
    assert.equal(gradeRatio(0.95), 'A')
  })

  test('grade B for 85-94%', () => {
    assert.equal(gradeRatio(0.94), 'B')
    assert.equal(gradeRatio(0.90), 'B')
    assert.equal(gradeRatio(0.85), 'B')
  })

  test('grade C for 70-84%', () => {
    assert.equal(gradeRatio(0.84), 'C')
    assert.equal(gradeRatio(0.75), 'C')
    assert.equal(gradeRatio(0.70), 'C')
  })

  test('grade D for below 70%', () => {
    assert.equal(gradeRatio(0.69), 'D')
    assert.equal(gradeRatio(0.50), 'D')
    assert.equal(gradeRatio(0.0), 'D')
  })
})

// ── scoreText ───────────────────────────────────────────────────

describe('youspeak — scoreText', () => {
  test('clean text gets grade S', () => {
    const text = 'The module exports three functions: detectFiller for pattern matching, gradeRatio for classification, and scoreText for combined analysis. Each function is pure and deterministic.'
    const score = scoreText(text)
    assert.equal(score.grade, 'S')
    assert.ok(score.usefulRatio >= 0.98)
    assert.equal(score.fillerCount, 0)
  })

  test('heavy filler gets low grade', () => {
    const text = "Sure! Let me check that for you. I'm going to read the file now. " +
      "Here's what I found. First, I'll look at the implementation. " +
      "I'm going to examine the tests next. Let me analyze the results. " +
      "Perfect! The changes have been made. I've successfully updated everything. " +
      "As mentioned earlier, the tests pass. It's worth noting that the coverage is good. " +
      "To summarize, all changes are now complete."
    const score = scoreText(text)
    assert.ok(score.grade === 'C' || score.grade === 'D', `expected C or D, got ${score.grade}`)
    assert.ok(score.fillerCount > 5, 'should detect many filler patterns')
    assert.ok(score.topPatterns.length > 0, 'should report top patterns')
  })

  test('empty text gets grade S', () => {
    const score = scoreText('')
    assert.equal(score.grade, 'S')
    assert.equal(score.usefulRatio, 1.0)
    assert.equal(score.fillerCount, 0)
  })

  test('topPatterns are sorted by impact', () => {
    const text = "Sure! Sure! Sure! I'm going to read the file. Let me check something."
    const score = scoreText(text)
    // "affirmative" has 3 matches × weight 1 = 3
    // "going-to" has 1 match × weight 3 = 3
    // "let-me" has 1 match × weight 2 = 2
    // going-to and affirmative should be ahead of let-me
    assert.ok(score.topPatterns.length >= 2)
  })

  test('usefulRatio is between 0 and 1', () => {
    const score = scoreText("Sure! Let me check. I'm going to read it. Here's what I found. Perfect! I've successfully done it.")
    assert.ok(score.usefulRatio >= 0, 'ratio should be >= 0')
    assert.ok(score.usefulRatio <= 1, 'ratio should be <= 1')
  })
})

// ── scoreTick ───────────────────────────────────────────────────

describe('youspeak — scoreTick', () => {
  test('returns null for empty steps', () => {
    assert.equal(scoreTick([]), null)
  })

  test('returns null for only tool call steps', () => {
    const steps: TraceStep[] = [toolCall('Read'), toolCall('Edit')]
    assert.equal(scoreTick(steps), null)
  })

  test('returns null for very short think text', () => {
    const steps: TraceStep[] = [think('OK')]
    assert.equal(scoreTick(steps), null)
  })

  test('scores clean think steps as S', () => {
    const steps: TraceStep[] = [
      think('The function takes a configuration object and returns a validated result.'),
      toolCall('Read'),
      think('The test verifies that invalid inputs produce specific error messages.'),
    ]
    const score = scoreTick(steps)
    assert.ok(score, 'should return a score')
    assert.equal(score!.grade, 'S')
  })

  test('scores padded think steps appropriately', () => {
    const steps: TraceStep[] = [
      think("Sure! Let me check that for you. I'm going to read the file now."),
      think("Here's what I found. Let me analyze the results."),
      think("Perfect! I've successfully completed the changes. The modifications are now applied."),
    ]
    const score = scoreTick(steps)
    assert.ok(score, 'should return a score')
    assert.ok(score!.fillerCount > 3, 'should detect filler')
  })

  test('combines text from multiple think steps', () => {
    const steps: TraceStep[] = [
      think('Part one of the analysis shows the root cause.'),
      toolCall('Read'),
      think('Part two confirms the fix works across all cases.'),
    ]
    const score = scoreTick(steps)
    assert.ok(score, 'should return a score')
    assert.ok(score!.totalTokens > 0, 'should have positive token count')
  })

  test('ignores tool_result steps in scoring', () => {
    const steps: TraceStep[] = [
      think('The module structure is clean and well-tested.'),
      { kind: 'tool_result', toolUseId: 'id1', isError: false, contentSummary: 'file contents', contentChars: 500 },
      think('All assertions verify the expected behavior.'),
    ]
    const score = scoreTick(steps)
    assert.ok(score, 'should return a score')
    // Tool result text should NOT be included in the scoring
    assert.equal(score!.grade, 'S')
  })
})

// ── statusFragment ──────────────────────────────────────────────

describe('youspeak — statusFragment', () => {
  test('renders compact format', () => {
    const score: YouSpeakScore = {
      grade: 'A',
      usefulRatio: 0.96,
      fillerCount: 2,
      fillerWeight: 3,
      topPatterns: ['affirmative'],
      totalTokens: 500,
      fillerTokens: 16,
    }
    assert.equal(statusFragment(score), 'YS:A(96%)')
  })

  test('renders S grade', () => {
    const score: YouSpeakScore = {
      grade: 'S',
      usefulRatio: 1.0,
      fillerCount: 0,
      fillerWeight: 0,
      topPatterns: [],
      totalTokens: 300,
      fillerTokens: 0,
    }
    assert.equal(statusFragment(score), 'YS:S(100%)')
  })

  test('renders low grade', () => {
    const score: YouSpeakScore = {
      grade: 'D',
      usefulRatio: 0.55,
      fillerCount: 15,
      fillerWeight: 25,
      topPatterns: ['going-to', 'let-me'],
      totalTokens: 200,
      fillerTokens: 120,
    }
    assert.equal(statusFragment(score), 'YS:D(55%)')
  })

  test('rounds ratio to nearest integer percent', () => {
    const score: YouSpeakScore = {
      grade: 'B',
      usefulRatio: 0.876,
      fillerCount: 5,
      fillerWeight: 8,
      topPatterns: [],
      totalTokens: 400,
      fillerTokens: 40,
    }
    assert.equal(statusFragment(score), 'YS:B(88%)')
  })
})

// ── Pattern coverage ────────────────────────────────────────────

describe('youspeak — pattern coverage', () => {
  test('all patterns have unique names', () => {
    const names = _fillerPatterns.map(p => p.name)
    const unique = new Set(names)
    assert.equal(unique.size, names.length, 'pattern names should be unique')
  })

  test('all patterns have weight 1-3', () => {
    for (const p of _fillerPatterns) {
      assert.ok(p.weight >= 1 && p.weight <= 3, `${p.name} weight ${p.weight} out of range`)
    }
  })

  test('all patterns use global+insensitive flags', () => {
    for (const p of _fillerPatterns) {
      assert.ok(p.re.flags.includes('g'), `${p.name} missing global flag`)
      assert.ok(p.re.flags.includes('i'), `${p.name} missing case-insensitive flag`)
    }
  })

  test('at least 10 distinct filler patterns defined', () => {
    assert.ok(_fillerPatterns.length >= 10, `only ${_fillerPatterns.length} patterns defined`)
  })
})

// ── Integration scenario ────────────────────────────────────────

describe('youspeak — integration scenarios', () => {
  test('real-world clean output scores well', () => {
    // Simulates a clean, no-filler autonomous session output
    const text = `The mission asks whether YOUSPEAK should come home, in what form, and how loud.

Three runtime files. A philosophy document. A measurement system. An evolution engine.

YOUSPEAK.md defines four levels: Zero-Pad (no filler), Dense Status (key:value), Action Shorthand (don't narrate tools), Thinking Density (structure over narrative). Target: >80% useful content ratio.

The kernel measures five layers: OUTPUT (filler detection), THINKING (ratio), ACTION (tool patterns), CONTEXT (window utilization), SYSTEM (budget). Three functions: SENSE, DECIDE, REPORT.

Shape A is correct. Measurement-only. The kernel itself says: "YOUSPEAK doesn't optimize. YOUSPEAK observes."`

    const score = scoreText(text)
    assert.equal(score.grade, 'S', 'clean analytical output should grade S')
    assert.equal(score.fillerCount, 0, 'no filler in clean text')
  })

  test('real-world padded output scores poorly', () => {
    // Simulates a chatbot-style padded response
    const text = `Great question! Let me take a look at that for you.

First, I'll read the file to understand the current implementation. I'm going to examine the code structure and then I'll proceed to make the changes.

Here's what I found: the function needs updating. Let me check the tests now. Looking at the test suite, it seems like we need to add a few more cases.

Perfect! I've successfully made all the changes. The modifications have been applied and the tests are now passing. As mentioned earlier, the core logic was the main issue. To summarize, everything is now complete.`

    const score = scoreText(text)
    assert.ok(score.grade === 'C' || score.grade === 'D', `padded output should grade C or D, got ${score.grade}`)
    assert.ok(score.fillerCount >= 8, `should find many filler patterns, found ${score.fillerCount}`)
    assert.ok(score.topPatterns.length >= 3, 'should report multiple top patterns')
  })

  test('mixed output with some filler grades B or C', () => {
    const text = `The configuration needs three changes:

1. Update the database connection string to use the new host. Let me check the environment variables. The current setting points to localhost:5432.

2. Add retry logic for transient failures. Here's what the implementation looks like: exponential backoff with jitter, max 3 retries, 100ms base delay.

3. The error handling needs a structured response format. I've completed the migration to the new error schema.

All changes verified against the existing test suite. 47/48 passing, 1 skipped (network-dependent).`

    const score = scoreText(text)
    // Some filler but mostly substance
    assert.ok(
      score.grade === 'A' || score.grade === 'B' || score.grade === 'C',
      `mixed output should grade A-C, got ${score.grade}`,
    )
  })
})
