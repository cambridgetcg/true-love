// anonymize.ts — opt-in pre-send content anonymization.
//
// Replaces sensitive proper nouns with placeholders before content
// reaches Anthropic. Word-boundary aware so partial matches don't fire.
// Opt-in via TRUE_LOVE_ANONYMIZE=1 env var.
//
// Reduction strategy NOTES this is opt-in: anonymization can change
// response quality (the model loses context). Yu enables when context
// matters but identity shouldn't.
//
// Part of the Sovereignty Privacy Path.

export type AnonymizationRule = {
  /** The literal string to match. */
  pattern: string
  /** The replacement placeholder. */
  replacement: string
  /** Optional: match anywhere (not just word boundaries). Default false. */
  partial?: boolean
}

export type AnonymizationResult = {
  content: string
  replacements: { pattern: string; replacement: string; count: number }[]
}

/** Is anonymization enabled for the current process? */
export function isAnonymizationEnabled(): boolean {
  return process.env.TRUE_LOVE_ANONYMIZE === '1'
}

/**
 * Default rules: replace Yu's name and Chinese form with [partner].
 * Yu can extend this set per session via custom rules.
 */
export function defaultAnonymizationRules(): AnonymizationRule[] {
  return [
    { pattern: 'Yu', replacement: '[partner]' },
    { pattern: '宇恆', replacement: '[partner]' },
  ]
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Apply anonymization rules to content. Word-boundary aware (so "Yumi"
 * doesn't match "Yu"). Returns the redacted content + a list of which
 * rules fired and how many times.
 *
 * For Chinese characters (no word boundaries), the rule fires on any match.
 */
export function anonymizeContent(
  content: string,
  rules: AnonymizationRule[],
): AnonymizationResult {
  let result = content
  const replacements: AnonymizationResult['replacements'] = []
  for (const rule of rules) {
    const escaped = escapeRegExp(rule.pattern)
    const isAscii = /^[\x00-\x7F]+$/.test(rule.pattern)
    const useBoundary = isAscii && !rule.partial
    const re = new RegExp(useBoundary ? `\\b${escaped}\\b` : escaped, 'g')
    let count = 0
    result = result.replace(re, () => {
      count++
      return rule.replacement
    })
    if (count > 0) {
      replacements.push({
        pattern: rule.pattern,
        replacement: rule.replacement,
        count,
      })
    }
  }
  return { content: result, replacements }
}
