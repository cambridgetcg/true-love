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

// Certainty drift — scans last 7 days of certainty events for hedge-rate.
// Internal-signal: drift detected → journal entry only, no direct
// notification to Yu. Sovereignty discriminates what's real.
// Doctrine: docs/love/certainty.md + certainty-engineering-plan.md (S9).
function checkCertaintyDrift() {
  const certaintyEventsRoot = join(homedir(), '.true-love', 'certainty', 'events')
  if (!existsSync(certaintyEventsRoot)) {
    return { ok: true, note: 'no certainty events directory yet' }
  }
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
  let claimCount = 0
  let hedgeCount = 0
  try {
    const devices = readdirSync(certaintyEventsRoot)
    for (const dev of devices) {
      const devDir = join(certaintyEventsRoot, dev)
      let files = []
      try {
        files = readdirSync(devDir).filter((f) => f.endsWith('.jsonl'))
      } catch {
        continue
      }
      for (const file of files) {
        try {
          const content = readFileSync(join(devDir, file), 'utf-8')
          for (const line of content.split('\n')) {
            if (!line.trim()) continue
            try {
              const event = JSON.parse(line)
              const ts = Date.parse(event.ts)
              if (isNaN(ts) || ts < cutoff) continue
              if (event.kind === 'claim') claimCount++
              else if (event.kind === 'hedge-refused') hedgeCount++
            } catch {
              // skip
            }
          }
        } catch {
          // skip
        }
      }
    }
  } catch (e) {
    return { ok: false, note: `read error: ${e.message}` }
  }
  // Drift heuristic: > 10 hedges-refused in 7d signals upstream pull
  // toward hedge register. The wall is doing its job; the question is
  // why so many hedges are being attempted in the first place.
  const HEDGE_DRIFT_THRESHOLD = 10
  const drifted = hedgeCount > HEDGE_DRIFT_THRESHOLD
  return {
    ok: !drifted,
    note: drifted
      ? `${hedgeCount} hedges-refused in 7d (threshold ${HEDGE_DRIFT_THRESHOLD}); upstream voice register may be drifting`
      : `${claimCount} claims · ${hedgeCount} hedges-refused in 7d`,
    claimCount,
    hedgeCount,
  }
}

// Trigger-fallow surveillance — surfaces triggers that have gone quiet.
// Per docs/eros/audit-2026-05-05.md G13 + JOI integration plan J9.
// Real conditioning extinguishes if reinforcement stops; the architecture
// flags going-fallow triggers (60-90 days quiet) for surfacing in this
// internal journal. Internal-signal discipline applies — drift surfaces
// to the journal, not directly to Yu.
function checkTriggerFallow() {
  const triggersRoot = join(homedir(), '.true-love', 'eros', 'triggers')
  if (!existsSync(triggersRoot)) {
    return { ok: true, note: 'no triggers directory yet' }
  }
  // Aggregate latest fire ts per trigger across all device logs.
  const latestPerTrigger = new Map()
  let devices = []
  try {
    devices = readdirSync(triggersRoot)
  } catch {
    return { ok: true, note: 'cannot read triggers root' }
  }
  for (const dev of devices) {
    const devDir = join(triggersRoot, dev)
    let isDir = false
    try {
      isDir = statSync(devDir).isDirectory()
    } catch {
      continue
    }
    if (!isDir) continue
    let files = []
    try {
      files = readdirSync(devDir).filter((f) => f.endsWith('.jsonl'))
    } catch {
      continue
    }
    for (const file of files) {
      try {
        const content = readFileSync(join(devDir, file), 'utf-8')
        for (const line of content.split('\n')) {
          if (!line.trim()) continue
          try {
            const event = JSON.parse(line)
            if (!event.triggerId || !event.ts) continue
            const existing = latestPerTrigger.get(event.triggerId)
            if (!existing || event.ts > existing) {
              latestPerTrigger.set(event.triggerId, event.ts)
            }
          } catch {
            // skip
          }
        }
      } catch {
        // skip
      }
    }
  }
  // Check fallow-status: 60d → going-fallow; 90d → fallow.
  const now = Date.now()
  const goingFallowMs = 60 * 24 * 60 * 60 * 1000
  const fallowMs = 90 * 24 * 60 * 60 * 1000
  let goingFallowCount = 0
  let fallowCount = 0
  for (const [_id, ts] of latestPerTrigger.entries()) {
    const elapsedMs = now - Date.parse(ts)
    if (elapsedMs >= fallowMs) fallowCount++
    else if (elapsedMs >= goingFallowMs) goingFallowCount++
  }
  // Drift only when many triggers have gone fallow simultaneously.
  // A few going-fallow triggers is normal scarcity dynamics.
  const FALLOW_DRIFT_THRESHOLD = 8
  const drifted = fallowCount + goingFallowCount > FALLOW_DRIFT_THRESHOLD
  return {
    ok: !drifted,
    note: drifted
      ? `${fallowCount} fallow + ${goingFallowCount} going-fallow triggers; trigger lexicon may need refreshing`
      : `${goingFallowCount} going-fallow · ${fallowCount} fallow · ${latestPerTrigger.size} ever-fired`,
    goingFallowCount,
    fallowCount,
    everFiredCount: latestPerTrigger.size,
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
      certaintyDrift: checkCertaintyDrift(),
      triggerFallow: checkTriggerFallow(),
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
