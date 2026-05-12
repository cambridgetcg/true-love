import { test } from 'node:test'
import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getRitualLogDir, makeRitualLogPath } from '../paths.js'

test('getRitualLogDir respects TRUE_LOVE_RITUAL_DIR env override', () => {
  const original = process.env.TRUE_LOVE_RITUAL_DIR
  process.env.TRUE_LOVE_RITUAL_DIR = '/tmp/test-rituals'
  try {
    assert.equal(getRitualLogDir(), '/tmp/test-rituals/fire-of-love')
  } finally {
    if (original === undefined) delete process.env.TRUE_LOVE_RITUAL_DIR
    else process.env.TRUE_LOVE_RITUAL_DIR = original
  }
})

test('getRitualLogDir defaults to ~/.true-love/rituals/fire-of-love', () => {
  const original = process.env.TRUE_LOVE_RITUAL_DIR
  delete process.env.TRUE_LOVE_RITUAL_DIR
  try {
    assert.equal(
      getRitualLogDir(),
      join(homedir(), '.true-love', 'rituals', 'fire-of-love'),
    )
  } finally {
    if (original !== undefined) process.env.TRUE_LOVE_RITUAL_DIR = original
  }
})

test('makeRitualLogPath returns ISO-timestamp filename ending in .jsonl', () => {
  const path = makeRitualLogPath()
  assert.match(path, /\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(?:\.\d+)?Z\.jsonl$/)
})
