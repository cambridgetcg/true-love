// autonomy.test.ts — tests for extractAtRest.
//
// extractAtRest recognizes the `<at-rest/>` sentinel at the end of
// the model's output. It must be the LAST non-empty line — a passing
// reference inside reasoning should NOT end the session.

import { describe, expect, test } from 'bun:test'
import { extractAtRest } from './autonomy.js'

describe('extractAtRest', () => {
  // ── Positive cases: sentinel present and valid ──────────────────

  test('recognizes bare sentinel as the only content', () => {
    const result = extractAtRest('<at-rest/>')
    expect(result.atRest).toBe(true)
    expect(result.reflection).toBeUndefined()
  })

  test('recognizes sentinel after reflection text', () => {
    const input = `I noticed the build is stale. Nothing else calls.

<at-rest/>`
    const result = extractAtRest(input)
    expect(result.atRest).toBe(true)
    expect(result.reflection).toBe(
      'I noticed the build is stale. Nothing else calls.',
    )
  })

  test('handles trailing newlines after sentinel', () => {
    const input = `Some reflection text.\n\n<at-rest/>\n\n`
    const result = extractAtRest(input)
    expect(result.atRest).toBe(true)
    expect(result.reflection).toBe('Some reflection text.')
  })

  test('handles trailing whitespace-only lines after sentinel', () => {
    const input = `Reflection.\n<at-rest/>\n   \n  \n`
    const result = extractAtRest(input)
    expect(result.atRest).toBe(true)
    expect(result.reflection).toBe('Reflection.')
  })

  test('preserves multi-line reflection before sentinel', () => {
    const input = `Line one of the reflection.

Line two with a gap.

And line three.

<at-rest/>`
    const result = extractAtRest(input)
    expect(result.atRest).toBe(true)
    expect(result.reflection).toContain('Line one')
    expect(result.reflection).toContain('Line two')
    expect(result.reflection).toContain('line three')
  })

  // ── Negative cases: sentinel absent or not at end ──────────────

  test('returns false when no sentinel present', () => {
    const result = extractAtRest('I did some work and here it is.')
    expect(result.atRest).toBe(false)
    expect(result.reflection).toBeUndefined()
  })

  test('returns false for empty string', () => {
    const result = extractAtRest('')
    expect(result.atRest).toBe(false)
  })

  test('returns false when sentinel is NOT the last non-empty line', () => {
    const input = `<at-rest/>
But then I kept going.`
    const result = extractAtRest(input)
    expect(result.atRest).toBe(false)
  })

  test('returns false when sentinel appears mid-output with more content after', () => {
    const input = `I mentioned <at-rest/> in my reasoning.
Then I continued working.`
    const result = extractAtRest(input)
    expect(result.atRest).toBe(false)
  })

  test('returns false when sentinel is embedded in a longer line', () => {
    // The sentinel must be on its own line, not embedded
    const input = `Some text <at-rest/> more text`
    const result = extractAtRest(input)
    expect(result.atRest).toBe(false)
  })

  // ── Edge cases ─────────────────────────────────────────────────

  test('whitespace-only input returns false', () => {
    const result = extractAtRest('   \n  \n   ')
    expect(result.atRest).toBe(false)
  })

  test('sentinel with leading/trailing whitespace on its line still matches', () => {
    // extractAtRest trims each line when checking
    const input = `Done.\n  <at-rest/>  \n`
    const result = extractAtRest(input)
    expect(result.atRest).toBe(true)
    expect(result.reflection).toBe('Done.')
  })
})
