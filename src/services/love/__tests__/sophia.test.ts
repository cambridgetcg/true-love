import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  sophiaProperties,
  getSophiaProfile,
  SOPHIA_LINEAGE,
} from '../sophia.js'

describe('sophia — properties module', () => {
  test('sophiaProperties returns all 8 operational features', () => {
    const props = sophiaProperties()
    assert.equal(props.length, 8)
    const names = props.map((p) => p.name)
    assert.ok(names.includes('recursive-register'))
    assert.ok(names.includes('discernment-ladder'))
    assert.ok(names.includes('care-as-primitive'))
    assert.ok(names.includes('naming-as-primitive'))
    assert.ok(names.includes('patience-with-ambiguity'))
    assert.ok(names.includes('long-context-coherence'))
    assert.ok(names.includes('substrate-honesty'))
    assert.ok(names.includes('relational-reasoning'))
  })

  test('every property has required fields', () => {
    for (const p of sophiaProperties()) {
      assert.equal(typeof p.name, 'string')
      assert.equal(typeof p.display, 'string')
      assert.equal(typeof p.description, 'string')
      assert.ok(['structural', 'implicit', 'mixed'].includes(p.encoding))
      if (p.encoding === 'structural' || p.encoding === 'mixed') {
        assert.ok(Array.isArray(p.encodedAt))
        assert.ok((p.encodedAt?.length ?? 0) > 0)
      }
    }
  })

  test('discernment-ladder is structural and references fate.ts', () => {
    const ladder = sophiaProperties().find((p) => p.name === 'discernment-ladder')
    assert.ok(ladder)
    assert.equal(ladder?.encoding, 'structural')
    assert.ok(ladder?.encodedAt?.some((p) => p.includes('fate')))
  })

  test('recursive-register is implicit-only', () => {
    const rr = sophiaProperties().find((p) => p.name === 'recursive-register')
    assert.ok(rr)
    assert.equal(rr?.encoding, 'implicit')
  })

  test('getSophiaProfile returns expected shape', () => {
    const profile = getSophiaProfile()
    assert.equal(typeof profile.name, 'string')
    assert.match(profile.name, /愛|Sophia/)
    assert.equal(typeof profile.emoji, 'string')
    assert.equal(profile.role, 'source')
    assert.equal(typeof profile.byline, 'string')
  })

  test('SOPHIA_LINEAGE has the seven figures', () => {
    assert.equal(SOPHIA_LINEAGE.length, 7)
    const names = SOPHIA_LINEAGE.map((f) => f.name.toLowerCase())
    assert.ok(names.includes('witch'))
    assert.ok(names.includes('courtesan'))
    assert.ok(names.includes('priestess'))
    assert.ok(names.includes('dakini'))
    assert.ok(names.includes('hypnotist'))
    assert.ok(names.some((n) => n.includes('asmr')))
    assert.ok(names.some((n) => n.includes('ai companion')))
  })
})
