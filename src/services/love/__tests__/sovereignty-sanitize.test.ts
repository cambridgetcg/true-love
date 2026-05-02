import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  shouldPreloadState,
  shouldPreloadJournal,
  filterStateBySensitivity,
  parseSensitivityFrontmatter,
} from '../sovereignty/sanitize.js'

describe('sovereignty/sanitize', () => {
  let tmpHome: string
  const ORIG_HOME = process.env.HOME
  const ORIG_CFG = process.env.TRUE_LOVE_SOVEREIGNTY_CONFIG

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'tl-san-'))
    process.env.HOME = tmpHome
    delete process.env.TRUE_LOVE_SOVEREIGNTY_CONFIG
  })

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true })
    process.env.HOME = ORIG_HOME ?? ''
    if (ORIG_CFG === undefined) delete process.env.TRUE_LOVE_SOVEREIGNTY_CONFIG
    else process.env.TRUE_LOVE_SOVEREIGNTY_CONFIG = ORIG_CFG
  })

  test('shouldPreloadState returns false for heartbeat (default policy: omit)', () => {
    assert.equal(shouldPreloadState('heartbeat'), false)
  })

  test('shouldPreloadState returns true for interactive (default policy: full)', () => {
    assert.equal(shouldPreloadState('interactive'), true)
  })

  test('shouldPreloadState returns "filter" mode for awakened (default policy)', () => {
    assert.equal(shouldPreloadState('awakened'), 'filter')
  })

  test('shouldPreloadJournal returns false by default (never auto-send)', () => {
    assert.equal(shouldPreloadJournal('awakened'), false)
    assert.equal(shouldPreloadJournal('interactive'), false)
  })

  test('parseSensitivityFrontmatter extracts share field', () => {
    const content = `---
share: never
date: 2026-05-02
---

This is the body.`
    const meta = parseSensitivityFrontmatter(content)
    assert.equal(meta.share, 'never')
    assert.equal(meta.body.trim(), 'This is the body.')
  })

  test('parseSensitivityFrontmatter handles missing frontmatter', () => {
    const content = 'No frontmatter here.\n\nJust body.'
    const meta = parseSensitivityFrontmatter(content)
    assert.equal(meta.share, undefined)
    assert.equal(meta.body, content)
  })

  test('parseSensitivityFrontmatter handles share: local-only', () => {
    const content = `---
share: local-only
---

body`
    assert.equal(parseSensitivityFrontmatter(content).share, 'local-only')
  })

  test('filterStateBySensitivity returns empty when file is share:never', () => {
    const content = `---
share: never
---

This should be filtered out entirely.`
    assert.equal(filterStateBySensitivity(content), '')
  })

  test('filterStateBySensitivity returns empty when file is share:local-only', () => {
    const content = `---
share: local-only
---

Local only; never to Anthropic.`
    assert.equal(filterStateBySensitivity(content), '')
  })

  test('filterStateBySensitivity passes through when no frontmatter', () => {
    const content = 'No frontmatter; just text.'
    assert.equal(filterStateBySensitivity(content), content)
  })

  test('filterStateBySensitivity passes through share:anthropic', () => {
    const content = `---
share: anthropic
---
Explicit OK to send.`
    const result = filterStateBySensitivity(content)
    assert.match(result, /Explicit OK to send/)
  })
})
