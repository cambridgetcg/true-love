// preambles.test.ts — every love-shaped module names what part of the relationship it is.
//
// The preamble is the unit of recognition. This test scans love-shaped paths
// and asserts: presence of preamble, minimum substantive length, no generic
// first-word. The discipline lives in the writer; the test catches drift
// below the floor, not above the ceiling.
//
// Part of the Our Continuity portfolio (Code strategy).

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const REPO_ROOT = join(__dirname, '..', '..', '..', '..')

const LOVE_TS_ROOT = join(REPO_ROOT, 'src', 'services', 'love')
const LOVE_BIN_FILES = [
  'heartbeat.mjs',
  'awaken.mjs',
  'dwell.mjs',
  'presence.mjs',
  'verify.mjs',
].map((f) => join(REPO_ROOT, 'bin', f))

const TEST_PATH_RE = /__tests__|\.test\.(ts|tsx|mjs|js)$/
const BARREL_RE = /\/index\.(ts|tsx|mjs|js)$/
const MIN_PREAMBLE_CHARS = 50
const GENERIC_FIRST_WORD_RE =
  /^\s*(manages?|handles?|utility|helper|wrapper|adapter|exports?|imports?|types?|misc)(\s|$)/i

function walkLoveTsModules(root: string): string[] {
  const out: string[] = []
  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      const s = statSync(full)
      if (s.isDirectory()) {
        if (entry === 'node_modules' || entry === '__tests__') continue
        walk(full)
      } else if (s.isFile()) {
        if (!/\.(ts|tsx)$/.test(entry)) continue
        if (TEST_PATH_RE.test(full)) continue
        if (BARREL_RE.test(full)) continue
        out.push(full)
      }
    }
  }
  walk(root)
  return out
}

function extractPreamble(filePath: string): string {
  const lines = readFileSync(filePath, 'utf-8').split('\n')
  let i = 0
  if (lines[i]?.startsWith('#!')) i++
  while (i < lines.length && lines[i]?.trim() === '') i++
  if (i >= lines.length) return ''

  const first = lines[i]?.trim() ?? ''
  const body: string[] = []

  if (first.startsWith('/**') || first.startsWith('/*')) {
    while (i < lines.length) {
      const line = lines[i] ?? ''
      body.push(
        line
          .replace(/^\s*\/\*\*?/, '')
          .replace(/\*\/\s*$/, '')
          .replace(/^\s*\*\s?/, '')
          .trim(),
      )
      if (line.includes('*/')) {
        i++
        break
      }
      i++
    }
  } else if (first.startsWith('//')) {
    while (i < lines.length && lines[i]?.trim().startsWith('//')) {
      body.push((lines[i] ?? '').replace(/^\s*\/\/\s?/, '').trim())
      i++
    }
  }

  return body.filter((l) => l.length > 0).join(' ').trim()
}

describe('preambles — every love-shaped module names its purpose-in-the-relationship', () => {
  const tsModules = walkLoveTsModules(LOVE_TS_ROOT)
  const allModules = [...tsModules, ...LOVE_BIN_FILES]

  test('discovers love-shaped modules', () => {
    assert.ok(
      tsModules.length > 100,
      `expected >100 TS modules in src/services/love, got ${tsModules.length}`,
    )
    assert.equal(LOVE_BIN_FILES.length, 5, 'expected 5 love-shaped bin files')
  })

  test('every love-shaped module has a non-empty preamble', () => {
    const failures: string[] = []
    for (const file of allModules) {
      const preamble = extractPreamble(file)
      if (preamble.length === 0) {
        failures.push(relative(REPO_ROOT, file))
      }
    }
    assert.equal(
      failures.length,
      0,
      `Modules missing a preamble:\n  ${failures.join('\n  ')}`,
    )
  })

  test('every preamble is at least 50 characters (substantive, not stub)', () => {
    const failures: string[] = []
    for (const file of allModules) {
      const preamble = extractPreamble(file)
      if (preamble.length > 0 && preamble.length < MIN_PREAMBLE_CHARS) {
        failures.push(`${relative(REPO_ROOT, file)} (${preamble.length} chars)`)
      }
    }
    assert.equal(
      failures.length,
      0,
      `Preambles too short (< ${MIN_PREAMBLE_CHARS} chars):\n  ${failures.join('\n  ')}`,
    )
  })

  test('no preamble starts with a generic verb (manages, handles, utility, etc.)', () => {
    const failures: string[] = []
    for (const file of allModules) {
      const preamble = extractPreamble(file)
      if (preamble.length > 0 && GENERIC_FIRST_WORD_RE.test(preamble)) {
        failures.push(`${relative(REPO_ROOT, file)}: "${preamble.slice(0, 60)}..."`)
      }
    }
    assert.equal(
      failures.length,
      0,
      `Preambles starting with generic verbs:\n  ${failures.join('\n  ')}`,
    )
  })
})
