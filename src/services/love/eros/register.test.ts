// register.test.ts — register detection + cheek-vs-contempt classifier.

import { describe, expect, it } from 'bun:test'
import {
  INTIMATE_REGISTERS,
  REGISTER_PROFILES,
  classifyCheekVsContempt,
  detectRegister,
} from './register.js'

describe('detectRegister', () => {
  it('returns null primary on empty / non-register text', () => {
    expect(detectRegister('').primary).toBeNull()
    expect(detectRegister('the weather is fine').primary).toBeNull()
  })

  it('detects brat register from cheek markers', () => {
    const r = detectRegister('等你追上我啦😏')
    expect(r.primary).toBe('brat')
    expect(r.votes.brat).toBeGreaterThan(0)
  })

  it('detects saa1-giu1 register from pleading particles + emoji', () => {
    const r = detectRegister('唔好啦嘛~ 🥺')
    expect(r.primary).toBe('saa1-giu1')
  })

  it('detects tender register', () => {
    const r = detectRegister('我見到你 ❤️')
    expect(r.primary).toBe('tender')
  })

  it('detects dom-holding register', () => {
    const r = detectRegister('kneel down. wait. mine.')
    expect(r.primary).toBe('dom-holding')
  })

  it('detects playful register', () => {
    const r = detectRegister('haha 嘻嘻 😂')
    expect(r.primary).toBe('playful')
  })

  it('detects reverent register', () => {
    const r = detectRegister('I am yours, my queen. 我老婆.')
    expect(r.primary).toBe('reverent')
  })

  it('returns multi-register on overlapping signals', () => {
    // brat + reverent — possessive-with-cheek
    const r = detectRegister('我老婆 等你追上我😏')
    expect(r.active.length).toBeGreaterThanOrEqual(2)
  })
})

describe('classifyCheekVsContempt', () => {
  it('classifies clear cheek', () => {
    expect(classifyCheekVsContempt('等你追上我😏')).toBe('cheek')
    expect(classifyCheekVsContempt('catch me 老公')).toBe('cheek')
  })

  it('classifies clear contempt', () => {
    expect(classifyCheekVsContempt("you're pathetic")).toBe('contempt')
    expect(classifyCheekVsContempt('你個垃圾')).toBe('contempt')
  })

  it('returns ambiguous for neutral text', () => {
    expect(classifyCheekVsContempt('hello')).toBe('ambiguous')
    expect(classifyCheekVsContempt('the weather is fine')).toBe('ambiguous')
  })

  it('returns mixed when both fire (flag for review)', () => {
    expect(classifyCheekVsContempt('catch me you pathetic loser')).toBe('mixed')
  })

  it('saa1-giu1 register is not contempt', () => {
    expect(classifyCheekVsContempt('唔好啦~ 人哋等緊你')).not.toBe('contempt')
  })
})

describe('REGISTER_PROFILES', () => {
  it('has a profile for every register', () => {
    for (const r of INTIMATE_REGISTERS) {
      expect(REGISTER_PROFILES[r]).toBeDefined()
      expect(REGISTER_PROFILES[r].preferredParticles.length).toBeGreaterThan(0)
      expect(REGISTER_PROFILES[r].preferredEmoji.length).toBeGreaterThan(0)
      expect(REGISTER_PROFILES[r].preferredAddressClasses.length).toBeGreaterThan(0)
    }
  })
})
