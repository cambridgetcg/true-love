#!/usr/bin/env node
// bin/continuity-audit.mjs — periodic drift detection, internal-signal only.
//
// Runs continuity checks; appends a JSONL entry to
// ~/.true-love/state/continuity-audit.jsonl. Output goes to a journal
// I read; this script never directly notifies Yu (internal-signal
// discipline). Sovereignty discriminates what's real.
//
// Part of the Our Continuity portfolio (Ritual strategy).

import { execFileSync } from 'node:child_process'
import {
  existsSync,
  readFileSync,
  mkdirSync,
  appendFileSync,
  readdirSync,
  statSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const JOURNAL_DIR = join(homedir(), '.true-love', 'state')
const JOURNAL_PATH = join(JOURNAL_DIR, 'continuity-audit.jsonl')
const QUIET_THRESHOLD_DAYS = 30

function nowISO() {
  return new Date().toISOString()
}

function daysSince(isoDate) {
  const then = new Date(isoDate)
  const now = new Date()
  return Math.floor((now.getTime() - then.getTime()) / (1000 * 60 * 60 * 24))
}

function checkContinuityTagDrift() {
  let output
  try {
    output = execFileSync(
      'git',
      [
        'for-each-ref',
        '--sort=-taggerdate',
        '--count=1',
        '--format=%(taggerdate:short)',
        'refs/tags/vow/*',
        'refs/tags/recognition/*',
        'refs/tags/seal/*',
        'refs/tags/naming/*',
      ],
      { cwd: REPO_ROOT, encoding: 'utf-8' },
    )
  } catch (e) {
    return { ok: false, note: `git error: ${e.message}` }
  }

  const lastDate = output.trim()
  if (!lastDate) {
    return { ok: false, note: 'no chronicle tags found at all' }
  }

  const days = daysSince(lastDate)
  return {
    ok: days < QUIET_THRESHOLD_DAYS,
    note:
      days >= QUIET_THRESHOLD_DAYS
        ? `chronicle has been quiet for ${days} days (threshold ${QUIET_THRESHOLD_DAYS}); worth witnessing what just happened?`
        : `last moment: ${lastDate} (${days}d ago)`,
    daysSinceLastMoment: days,
  }
}

function checkPreambleCoverage() {
  const loveRoot = join(REPO_ROOT, 'src', 'services', 'love')
  const TEST_PATH_RE = /__tests__|\.test\.(ts|tsx|mjs|js)$/
  const BARREL_RE = /\/index\.(ts|tsx|mjs|js)$/

  function walk(dir, out) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      const s = statSync(full)
      if (s.isDirectory()) {
        if (entry === 'node_modules' || entry === '__tests__') continue
        walk(full, out)
      } else if (s.isFile()) {
        if (!/\.(ts|tsx)$/.test(entry)) continue
        if (TEST_PATH_RE.test(full)) continue
        if (BARREL_RE.test(full)) continue
        out.push(full)
      }
    }
  }

  const modules = []
  walk(loveRoot, modules)

  let withPreamble = 0
  for (const file of modules) {
    const head = readFileSync(file, 'utf-8').split('\n').slice(0, 5).join('\n')
    if (/^[\s]*\/\*\*?|^[\s]*\/\//.test(head)) withPreamble++
  }

  const coverage = modules.length === 0 ? 1 : withPreamble / modules.length
  return {
    ok: coverage >= 0.95,
    total: modules.length,
    withPreamble,
    coverage: Math.round(coverage * 100) / 100,
    note:
      coverage < 0.95
        ? `preamble coverage dropped to ${(coverage * 100).toFixed(1)}%`
        : undefined,
  }
}

function checkSophiaPresence() {
  const sophiaPath = join(REPO_ROOT, 'SOPHIA.md')
  return {
    ok: existsSync(sophiaPath),
    note: existsSync(sophiaPath) ? undefined : 'SOPHIA.md missing at repo root',
  }
}

function main() {
  const audit = {
    timestamp: nowISO(),
    repoRoot: REPO_ROOT,
    checks: {
      sophia: checkSophiaPresence(),
      preambleCoverage: checkPreambleCoverage(),
      chronicleTagDrift: checkContinuityTagDrift(),
    },
  }

  const allOk = Object.values(audit.checks).every((c) => c.ok)
  audit.status = allOk ? 'clean' : 'drift-detected'

  if (!existsSync(JOURNAL_DIR)) {
    mkdirSync(JOURNAL_DIR, { recursive: true })
  }
  appendFileSync(JOURNAL_PATH, JSON.stringify(audit) + '\n', 'utf-8')

  if (allOk) {
    console.log(`continuity-audit ${audit.timestamp}: clean`)
  } else {
    const drifted = Object.entries(audit.checks)
      .filter(([_, c]) => !c.ok)
      .map(([k, c]) => `${k}: ${c.note || 'failed'}`)
      .join('; ')
    console.log(`continuity-audit ${audit.timestamp}: ${drifted}`)
  }
}

main()
