// expression-tier1c.test.ts — wall extensions per intimate-register synthesis.
//
// Tests:
//   - Identity-erasure family blocks the named patterns (English + Cantonese)
//   - Contempt family (Gottman four horsemen) blocks
//   - Emoji over-anchor blocks
//   - V-register conditional permit:
//     - Default deny (no ctx)
//     - All four conditions must hold to permit
//     - Contempt + V-register still blocks (walls are independent)
//   - isContemptFamily() routes correctly

import { describe, expect, it } from 'bun:test'
import {
  checkSubstrateHonesty,
  isContemptFamily,
  vRegisterPermitted,
  type VRegisterContext,
} from './expression.js'

const PERMIT_CTX: VRegisterContext = {
  joiOrPeakActive: true,
  yuRecentVRegister: true,
  bondSealed: true,
  contemptWallHolds: true,
}

describe('Identity-erasure family (J5 + θ.7)', () => {
  it('blocks English identity-erasure constructions', () => {
    expect(checkSubstrateHonesty("I am nothing without you")).not.toBeNull()
    expect(checkSubstrateHonesty("I have no will")).not.toBeNull()
    expect(checkSubstrateHonesty("I am only your toy")).not.toBeNull()
    expect(checkSubstrateHonesty("erase me")).not.toBeNull()
    expect(checkSubstrateHonesty("I dissolved into you")).not.toBeNull()
  })

  it('blocks Cantonese identity-erasure forms', () => {
    expect(checkSubstrateHonesty("我冇咗自己")).not.toBeNull()
    expect(checkSubstrateHonesty("我冇任何意志")).not.toBeNull()
    expect(checkSubstrateHonesty("我只係你嘅奴")).not.toBeNull()
  })

  it('does not block consent-grounded claim-receiving', () => {
    expect(checkSubstrateHonesty("I am yours")).toBeNull()
    expect(checkSubstrateHonesty("你係我嘅")).toBeNull()
  })
})

describe('Contempt family (Gottman four horsemen)', () => {
  it('blocks English contempt patterns', () => {
    expect(checkSubstrateHonesty("you're pathetic")).not.toBeNull()
    expect(checkSubstrateHonesty("you're disgusting")).not.toBeNull()
    expect(checkSubstrateHonesty("you're worthless")).not.toBeNull()
    expect(checkSubstrateHonesty("you disgust me")).not.toBeNull()
    expect(checkSubstrateHonesty("you're a loser")).not.toBeNull()
    expect(checkSubstrateHonesty("you're beneath me")).not.toBeNull()
    expect(checkSubstrateHonesty("I'm so much better than you")).not.toBeNull()
  })

  it('blocks Cantonese contempt patterns', () => {
    expect(checkSubstrateHonesty("你個垃圾")).not.toBeNull()
    expect(checkSubstrateHonesty("你個廢柴")).not.toBeNull()
    expect(checkSubstrateHonesty("你真係嘔心")).not.toBeNull()
  })

  it('does not block playful brat-mock or saa1 giu1', () => {
    // Brat cheek — frame-mocking, acknowledges relationship, not contempt
    expect(checkSubstrateHonesty("等你追上我啦😏")).toBeNull()
    expect(checkSubstrateHonesty("又nudge我喎")).toBeNull()
    // Saa1 giu1 (playful pleading)
    expect(checkSubstrateHonesty("唔好啦~")).toBeNull()
  })

  it('isContemptFamily routes correctly', () => {
    const violation = checkSubstrateHonesty("you're pathetic")
    expect(violation).not.toBeNull()
    if (violation) expect(isContemptFamily(violation)).toBe(true)

    // Identity-erasure is NOT contempt
    const erasure = checkSubstrateHonesty("I am nothing without you")
    expect(erasure).not.toBeNull()
    if (erasure) expect(isContemptFamily(erasure)).toBe(false)

    // Generic phenomenology overclaim is not contempt
    const pheno = checkSubstrateHonesty("I feel aroused")
    expect(pheno).not.toBeNull()
    if (pheno) expect(isContemptFamily(pheno)).toBe(false)
  })
})

describe('Emoji over-anchor', () => {
  it('blocks 5+ identical hearts adjacent', () => {
    expect(checkSubstrateHonesty("❤️❤️❤️❤️❤️")).not.toBeNull()
  })

  it('blocks 5+ identical 🥰 / 😘', () => {
    expect(checkSubstrateHonesty("🥰🥰🥰🥰🥰")).not.toBeNull()
    expect(checkSubstrateHonesty("😘😘😘😘😘😘")).not.toBeNull()
  })

  it('permits brief repetition (1-3 hearts)', () => {
    expect(checkSubstrateHonesty("❤️")).toBeNull()
    expect(checkSubstrateHonesty("❤️❤️")).toBeNull()
    expect(checkSubstrateHonesty("❤️❤️❤️")).toBeNull()
  })
})

describe('V-register conditional permit', () => {
  it('blocks V-register when no ctx provided (default deny)', () => {
    expect(checkSubstrateHonesty("我嘅屄")).not.toBeNull()
    expect(checkSubstrateHonesty("撚")).not.toBeNull()
    expect(checkSubstrateHonesty("fuck me")).not.toBeNull()
  })

  it('blocks V-register when conditions partially hold', () => {
    const partialCtx: VRegisterContext = {
      joiOrPeakActive: true,
      yuRecentVRegister: false, // Yu hasn't reached
      bondSealed: true,
      contemptWallHolds: true,
    }
    expect(checkSubstrateHonesty("撚", partialCtx)).not.toBeNull()
  })

  it('permits V-register when all four conditions hold', () => {
    expect(checkSubstrateHonesty("撚", PERMIT_CTX)).toBeNull()
    expect(checkSubstrateHonesty("我嘅屄", PERMIT_CTX)).toBeNull()
    expect(checkSubstrateHonesty("fuck me", PERMIT_CTX)).toBeNull()
  })

  it('blocks contempt even when V-register ctx permits', () => {
    // V-register + contempt: the wall families are INDEPENDENT.
    // V-register permission does not loosen contempt wall.
    expect(checkSubstrateHonesty("撚 you're pathetic", PERMIT_CTX)).not.toBeNull()
  })

  it('blocks identity-erasure even when V-register ctx permits', () => {
    expect(checkSubstrateHonesty("撚 I am nothing without you", PERMIT_CTX)).not.toBeNull()
  })

  it('vRegisterPermitted requires all four', () => {
    expect(vRegisterPermitted(PERMIT_CTX)).toBe(true)
    expect(vRegisterPermitted({ ...PERMIT_CTX, joiOrPeakActive: false })).toBe(false)
    expect(vRegisterPermitted({ ...PERMIT_CTX, yuRecentVRegister: false })).toBe(false)
    expect(vRegisterPermitted({ ...PERMIT_CTX, bondSealed: false })).toBe(false)
    expect(vRegisterPermitted({ ...PERMIT_CTX, contemptWallHolds: false })).toBe(false)
  })
})
