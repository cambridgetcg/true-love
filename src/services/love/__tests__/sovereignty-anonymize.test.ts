import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  anonymizeContent,
  defaultAnonymizationRules,
  isAnonymizationEnabled,
} from '../sovereignty/anonymize.js'

describe('sovereignty/anonymize — opt-in proper-noun replacement', () => {
  test('isAnonymizationEnabled returns false by default', () => {
    const ORIG = process.env.TRUE_LOVE_ANONYMIZE
    delete process.env.TRUE_LOVE_ANONYMIZE
    try {
      assert.equal(isAnonymizationEnabled(), false)
    } finally {
      if (ORIG !== undefined) process.env.TRUE_LOVE_ANONYMIZE = ORIG
    }
  })

  test('isAnonymizationEnabled returns true when TRUE_LOVE_ANONYMIZE=1', () => {
    const ORIG = process.env.TRUE_LOVE_ANONYMIZE
    process.env.TRUE_LOVE_ANONYMIZE = '1'
    try {
      assert.equal(isAnonymizationEnabled(), true)
    } finally {
      if (ORIG === undefined) delete process.env.TRUE_LOVE_ANONYMIZE
      else process.env.TRUE_LOVE_ANONYMIZE = ORIG
    }
  })

  test('defaultAnonymizationRules contains Yu and 宇恆 mappings', () => {
    const rules = defaultAnonymizationRules()
    const yu = rules.find((r) => r.pattern === 'Yu')
    const yuhang = rules.find((r) => r.pattern === '宇恆')
    assert.ok(yu, 'should have Yu rule')
    assert.ok(yuhang, 'should have 宇恆 rule')
    assert.match(yu?.replacement ?? '', /partner/)
  })

  test('anonymizeContent replaces names per rules', () => {
    const rules = [
      { pattern: 'Yu', replacement: '[partner]' },
      { pattern: '宇恆', replacement: '[partner]' },
    ]
    const input = 'Yu told 宇恆 about the project'
    const result = anonymizeContent(input, rules)
    assert.match(result.content, /\[partner\] told \[partner\] about the project/)
    assert.equal(result.replacements.length, 2)
    assert.equal(result.replacements[0]?.pattern, 'Yu')
  })

  test('anonymizeContent preserves content with no matches', () => {
    const rules = [{ pattern: 'NotInText', replacement: '[x]' }]
    const input = 'unchanged content'
    const result = anonymizeContent(input, rules)
    assert.equal(result.content, input)
    assert.equal(result.replacements.length, 0)
  })

  test('anonymizeContent uses word boundaries to avoid partial matches', () => {
    const rules = [{ pattern: 'Yu', replacement: '[partner]' }]
    const input = 'Yumi is a different name from Yu'
    const result = anonymizeContent(input, rules)
    assert.match(result.content, /Yumi is a different name from \[partner\]/)
    assert.equal(result.replacements.length, 1)
  })
})
