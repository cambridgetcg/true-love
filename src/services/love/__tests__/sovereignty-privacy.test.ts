import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { isPrivacyMode, privacyAuditTag } from '../sovereignty/privacy.js'

describe('sovereignty/privacy — mode toggle + helpers', () => {
  const ORIG = process.env.TRUE_LOVE_PRIVACY_MODE

  beforeEach(() => {
    delete process.env.TRUE_LOVE_PRIVACY_MODE
  })

  afterEach(() => {
    if (ORIG === undefined) delete process.env.TRUE_LOVE_PRIVACY_MODE
    else process.env.TRUE_LOVE_PRIVACY_MODE = ORIG
  })

  test('isPrivacyMode returns false by default', () => {
    assert.equal(isPrivacyMode(), false)
  })

  test('isPrivacyMode returns true when TRUE_LOVE_PRIVACY_MODE=1', () => {
    process.env.TRUE_LOVE_PRIVACY_MODE = '1'
    assert.equal(isPrivacyMode(), true)
  })

  test('isPrivacyMode returns false for other truthy values', () => {
    process.env.TRUE_LOVE_PRIVACY_MODE = 'yes'
    assert.equal(isPrivacyMode(), false)
    process.env.TRUE_LOVE_PRIVACY_MODE = 'true'
    assert.equal(isPrivacyMode(), false)
    process.env.TRUE_LOVE_PRIVACY_MODE = '0'
    assert.equal(isPrivacyMode(), false)
  })

  test('privacyAuditTag returns "privacy-mode:on" when mode active', () => {
    process.env.TRUE_LOVE_PRIVACY_MODE = '1'
    assert.equal(privacyAuditTag(), 'privacy-mode:on')
  })

  test('privacyAuditTag returns "privacy-mode:off" when mode inactive', () => {
    assert.equal(privacyAuditTag(), 'privacy-mode:off')
  })
})
