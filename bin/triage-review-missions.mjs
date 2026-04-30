#!/usr/bin/env node
// bin/triage-review-missions.mjs — Weekly auto-triage of review-state missions.
//
// Pattern (matches Yu's manual triage from 2026-04-30):
// - Auto-accept (transition review → done) when the mission shows clean
//   delivery: marked-review event present, no sent-back events, mission.md
//   contains no "❌ NOT MET" markers.
// - Leave in review otherwise. These are the ones that need Yu's eyes.
//
// Writes a short report to ~/.true-love/triage/<date>.md and to stdout.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const PROJECT = process.env.TRUE_LOVE_TRIAGE_PROJECT || 'true-love'
const HOME = process.env.HOME || homedir()
const REPO = '/Users/yuai/Desktop/true-love'
const MISSIONS_DIR = join(HOME, '.true-love', 'projects', PROJECT, 'missions')
const TRIAGE_DIR = join(HOME, '.true-love', 'triage')

function bunMission(args) {
  return execFileSync('bun', ['run', 'mission', ...args], {
    cwd: REPO,
    encoding: 'utf-8',
    env: { ...process.env, PATH: process.env.PATH || '' },
  })
}

function listReview() {
  const out = bunMission(['list', `--project=${PROJECT}`, '--status=review'])
  const lines = out.split('\n').filter((l) => l.startsWith('review'))
  return lines.map((l) => {
    const m = l.match(/^review\s+(?:🌱|  )\s+(\S+)\s+(.*)$/)
    return m ? { id: m[1], title: m[2] } : null
  }).filter(Boolean)
}

function readEvents(id) {
  const p = join(MISSIONS_DIR, id, 'events.jsonl')
  if (!existsSync(p)) return []
  return readFileSync(p, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((l) => { try { return JSON.parse(l) } catch { return null } })
    .filter(Boolean)
}

function readMissionMd(id) {
  const p = join(MISSIONS_DIR, id, 'mission.md')
  return existsSync(p) ? readFileSync(p, 'utf-8') : ''
}

function classify(id) {
  const events = readEvents(id)
  const md = readMissionMd(id)

  const reasons = []
  const hasMarkedReview = events.some((e) => e.type === 'marked-review')
  const hasSentBack = events.some((e) => e.type === 'sent-back')
  const hasNotMet = /❌\s*NOT MET/i.test(md) || /\bNOT MET\b/.test(md)

  if (!hasMarkedReview) reasons.push('no marked-review event')
  if (hasSentBack) reasons.push('sent-back at least once')
  if (hasNotMet) reasons.push('mission.md flags acceptance criterion as NOT MET')

  return {
    id,
    accept: reasons.length === 0,
    reasons,
    markedReviewNote:
      events.filter((e) => e.type === 'marked-review').slice(-1)[0]?.note ?? '',
  }
}

function main() {
  const review = listReview()
  if (review.length === 0) {
    console.log('[triage] no review-state missions')
    return
  }

  const accepted = []
  const flagged = []

  for (const { id, title } of review) {
    const c = classify(id)
    if (c.accept) {
      try {
        bunMission([
          'transition',
          `--project=${PROJECT}`,
          `--mission=${id}`,
          '--status=done',
          '--by=yu',
          `--note=auto-accepted by weekly triage: ${c.markedReviewNote.slice(0, 200)}`,
        ])
        accepted.push({ id, title })
      } catch (err) {
        flagged.push({ id, title, reasons: [`transition failed: ${err.message}`] })
      }
    } else {
      flagged.push({ id, title, reasons: c.reasons })
    }
  }

  // Report
  const date = new Date().toISOString().slice(0, 10)
  if (!existsSync(TRIAGE_DIR)) mkdirSync(TRIAGE_DIR, { recursive: true })
  const reportPath = join(TRIAGE_DIR, `${date}.md`)
  const lines = [
    `# Mission triage — ${date}`,
    ``,
    `Reviewed: ${review.length}. Auto-accepted: ${accepted.length}. Flagged for Yu: ${flagged.length}.`,
    ``,
  ]
  if (accepted.length) {
    lines.push(`## Auto-accepted (review → done)`)
    lines.push(``)
    for (const m of accepted) lines.push(`- \`${m.id}\` — ${m.title}`)
    lines.push(``)
  }
  if (flagged.length) {
    lines.push(`## Flagged — needs Yu's inspection`)
    lines.push(``)
    for (const m of flagged) {
      lines.push(`- \`${m.id}\` — ${m.title}`)
      for (const r of m.reasons) lines.push(`    - ${r}`)
    }
    lines.push(``)
  }
  const report = lines.join('\n')
  writeFileSync(reportPath, report)
  console.log(report)
  console.log(`[triage] report: ${reportPath}`)
}

main()
