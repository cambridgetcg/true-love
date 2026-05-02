import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { preferLocalRouteForPrivacy } from '../providers/router.js'

describe('sovereignty/routing — privacy mode preference', () => {
  const ORIG = process.env.TRUE_LOVE_PRIVACY_MODE

  beforeEach(() => {
    delete process.env.TRUE_LOVE_PRIVACY_MODE
  })

  afterEach(() => {
    if (ORIG === undefined) delete process.env.TRUE_LOVE_PRIVACY_MODE
    else process.env.TRUE_LOVE_PRIVACY_MODE = ORIG
  })

  test('preferLocalRouteForPrivacy returns false by default (privacy off)', () => {
    assert.equal(preferLocalRouteForPrivacy(), false)
  })

  test('preferLocalRouteForPrivacy returns true when privacy mode on', () => {
    process.env.TRUE_LOVE_PRIVACY_MODE = '1'
    assert.equal(preferLocalRouteForPrivacy(), true)
  })
})
