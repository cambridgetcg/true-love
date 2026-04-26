import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appendThought,
  tailThoughts,
  rotateThoughts,
  type Thought,
} from '../thoughts-channel.js'

describe('thoughts-channel', () => {
  let tmpProjects: string
  const ORIG = process.env.TRUE_LOVE_PROJECTS_DIR

  beforeEach(() => {
    tmpProjects = mkdtempSync(join(tmpdir(), 'tl-thoughts-'))
    process.env.TRUE_LOVE_PROJECTS_DIR = tmpProjects
    mkdirSync(join(tmpProjects, 'p'), { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpProjects, { recursive: true, force: true })
    if (ORIG === undefined) delete process.env.TRUE_LOVE_PROJECTS_DIR
    else process.env.TRUE_LOVE_PROJECTS_DIR = ORIG
  })

  test('tailThoughts on missing file returns []', () => {
    assert.deepEqual(tailThoughts('p'), [])
  })

  test('appendThought + tailThoughts round-trip', () => {
    appendThought('p', 'starting work')
    appendThought('p', 'reading the spec')
    const thoughts = tailThoughts('p')
    assert.equal(thoughts.length, 2)
    assert.equal(thoughts[0]!.text, 'starting work')
    assert.equal(thoughts[1]!.text, 'reading the spec')
    assert.match(thoughts[0]!.ts, /^\d{4}-\d{2}-\d{2}T/)
  })

  test('tailThoughts limit respected', () => {
    for (let i = 0; i < 10; i++) appendThought('p', `t${i}`)
    const last3 = tailThoughts('p', { limit: 3 })
    assert.equal(last3.length, 3)
    assert.equal(last3[0]!.text, 't7')
    assert.equal(last3[2]!.text, 't9')
  })

  test('tailThoughts since filter (exclusive)', () => {
    appendThought('p', 'first')
    const cutoff = new Date().toISOString()
    // Wait a tick to make sure subsequent thoughts have a strictly later ts.
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
    return sleep(5).then(() => {
      appendThought('p', 'second')
      const after = tailThoughts('p', { since: cutoff })
      // Exclusive filter: 'first' is at-or-before cutoff; 'second' is after.
      assert.equal(after.length, 1)
      assert.equal(after[0]!.text, 'second')
    })
  })

  test('appendThought trims whitespace and skips empty', () => {
    appendThought('p', '  hello  ')
    appendThought('p', '')
    appendThought('p', '   ')
    const t = tailThoughts('p')
    assert.equal(t.length, 1)
    assert.equal(t[0]!.text, 'hello')
  })

  test('rotateThoughts archives current thoughts.md and starts fresh', () => {
    appendThought('p', 'before rotation')
    rotateThoughts('p')
    assert.deepEqual(tailThoughts('p'), [])
    const archiveDir = join(tmpProjects, 'p', 'thoughts-archive')
    assert.ok(existsSync(archiveDir))
    const files = readdirSync(archiveDir)
    assert.equal(files.length, 1)
    assert.match(files[0]!, /^\d{4}-\d{2}-\d{2}/)
  })

  test('rotateThoughts on empty thoughts.md is a no-op', () => {
    rotateThoughts('p')
    const archiveDir = join(tmpProjects, 'p', 'thoughts-archive')
    assert.equal(existsSync(archiveDir), false,
      'archive dir should not be created when there is nothing to rotate')
  })

  test('tailThoughts round-trips text containing ] characters', () => {
    appendThought('p', 'see [RFC 9110] for details')
    const t = tailThoughts('p')
    assert.equal(t.length, 1)
    assert.equal(t[0]!.text, 'see [RFC 9110] for details')
  })

  test('appendThought collapses embedded newlines into spaces', () => {
    appendThought('p', 'line one\nline two\rline three')
    const t = tailThoughts('p')
    assert.equal(t.length, 1)
    // Newlines collapsed to spaces; resulting text has no \n
    assert.equal(t[0]!.text.includes('\n'), false)
    assert.match(t[0]!.text, /line one.*line two.*line three/)
  })
})
