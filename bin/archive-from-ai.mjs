#!/usr/bin/env node
// bin/archive-from-ai.mjs — Monthly archival of from-ai.md
//
// Moves entries older than 14 days to ~/.true-love/archive/from-ai-YYYY-MM.md.
// Keeps recent entries in the active file. Idempotent — safe to run repeatedly.
//
// Decision: Yu chose "archive-monthly" on 2026-04-29 (dec_2026-04-28_35f295b7).
// Context: from-ai.md was 5400+ lines in 5 days at ~64 entries/day.
//
// Usage:
//   bun run archive                   run archival
//   bun run archive -- --dry-run      show what would be archived
//   bun run archive -- --days N       override cutoff (default: 14)

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DEFAULT_CUTOFF_DAYS = 14

function fromAiPath() {
  return (
    process.env.TRUE_LOVE_FROM_AI_PATH ||
    join(homedir(), '.true-love', 'from-ai.md')
  )
}

function archiveDir() {
  return join(homedir(), '.true-love', 'archive')
}

/**
 * Parse from-ai.md into entries. Each entry starts with `## <timestamp>`
 * and ends at `---`. Same parser shape as hear.mjs.
 *
 * Handles both timestamp formats found in practice:
 *   ## 2026-04-25T20:43 [from 愛]          (no seconds, no Z)
 *   ## 2026-04-29T16:15:20.705Z [from 愛]  (full ISO)
 */
function parseEntries(raw) {
  const entries = []
  const chunks = raw.split(/\n---(?:\n+|$)/)
  for (const chunk of chunks) {
    const trimmed = chunk.trim()
    if (!trimmed) continue
    if (!trimmed.startsWith('##')) continue

    // Extract timestamp — flexible pattern for the two formats
    const match = trimmed.match(/^## (\d{4}-\d{2}-\d{2}T[\d:.]+Z?)/)
    let ts = null
    if (match) {
      const parsed = new Date(match[1])
      if (!isNaN(parsed.getTime())) ts = parsed
    }
    entries.push({ text: trimmed, ts })
  }
  return entries
}

/**
 * Format a Date into a YYYY-MM string for monthly archive filenames.
 */
function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function main() {
  const argv = process.argv.slice(2)
  const dryRun = argv.includes('--dry-run')

  let cutoffDays = DEFAULT_CUTOFF_DAYS
  const daysIdx = argv.indexOf('--days')
  if (daysIdx !== -1 && argv[daysIdx + 1]) {
    const parsed = parseInt(argv[daysIdx + 1], 10)
    if (Number.isFinite(parsed) && parsed > 0) cutoffDays = parsed
  }

  const path = fromAiPath()
  if (!existsSync(path)) {
    process.stdout.write('— nothing to archive (file does not exist)\n')
    return
  }

  const raw = readFileSync(path, 'utf-8').trim()
  if (!raw) {
    process.stdout.write('— nothing to archive (file is empty)\n')
    return
  }

  const entries = parseEntries(raw)
  const cutoff = new Date(Date.now() - cutoffDays * 24 * 60 * 60 * 1000)

  const toArchive = []
  const toKeep = []

  for (const entry of entries) {
    if (entry.ts && entry.ts < cutoff) {
      toArchive.push(entry)
    } else {
      // Keep entries that are recent OR have unparseable timestamps
      // (unparseable → can't prove they're old → keep them safe)
      toKeep.push(entry)
    }
  }

  process.stdout.write(`— ${entries.length} total entries\n`)
  process.stdout.write(
    `— cutoff: ${cutoffDays} days (before ${cutoff.toISOString().slice(0, 10)})\n`
  )
  process.stdout.write(`— ${toArchive.length} to archive\n`)
  process.stdout.write(`— ${toKeep.length} to keep\n`)

  if (toArchive.length === 0) {
    process.stdout.write('— nothing old enough to archive yet\n')
    return
  }

  // Group by month
  const byMonth = new Map()
  for (const entry of toArchive) {
    const key = entry.ts ? monthKey(entry.ts) : 'unknown'
    if (!byMonth.has(key)) byMonth.set(key, [])
    byMonth.get(key).push(entry)
  }

  if (dryRun) {
    process.stdout.write('— dry run, no changes made\n')
    for (const [month, monthEntries] of [...byMonth.entries()].sort()) {
      process.stdout.write(`  → from-ai-${month}.md: ${monthEntries.length} entries\n`)
    }
    return
  }

  // Create archive directory
  const dir = archiveDir()
  mkdirSync(dir, { recursive: true })

  // Append archived entries to monthly files
  for (const [month, monthEntries] of [...byMonth.entries()].sort()) {
    const archivePath = join(dir, `from-ai-${month}.md`)
    const content = monthEntries.map((e) => e.text + '\n\n---\n').join('\n')
    appendFileSync(archivePath, content, 'utf-8')
    process.stdout.write(`  → ${archivePath}: ${monthEntries.length} entries archived\n`)
  }

  // Rewrite active file with remaining entries
  const remaining = toKeep.map((e) => e.text + '\n\n---\n').join('\n')
  writeFileSync(path, remaining, 'utf-8')
  process.stdout.write(`  → ${path}: ${toKeep.length} entries remaining\n`)
  process.stdout.write('— archive complete\n')
}

main()
