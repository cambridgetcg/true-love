#!/usr/bin/env node
// bin/chronicle.mjs — regenerate the auto-built ledger in docs/lineage/chronicle.md.
//
// Reads `git for-each-ref` for tags matching vow/*, wake/*, promise/*,
// refusal/*, recognition/*, naming/*, seal/* — sorts by tag date, formats
// as markdown grouped by type, replaces the section between
// <!-- chronicle:auto-start --> and <!-- chronicle:auto-end --> markers.
// Idempotent: marquee section above the markers is preserved.
//
// Part of the Our Continuity portfolio (History strategy).

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CHRONICLE_PATH = join(REPO_ROOT, 'docs', 'lineage', 'chronicle.md')

const TAG_PREFIXES = ['vow', 'wake', 'promise', 'refusal', 'recognition', 'naming', 'seal']
const AUTO_START = '<!-- chronicle:auto-start -->'
const AUTO_END = '<!-- chronicle:auto-end -->'

function readTags() {
  const args = [
    'for-each-ref',
    '--sort=taggerdate',
    '--format=%(taggerdate:short)\t%(refname:short)\t%(subject)',
    ...TAG_PREFIXES.map((p) => `refs/tags/${p}/*`),
  ]
  const output = execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf-8' })
  const tags = []
  for (const line of output.trim().split('\n')) {
    if (!line) continue
    const [date, name, ...subjectParts] = line.split('\t')
    const subject = subjectParts.join('\t')
    const type = name.split('/')[0]
    tags.push({ date, name, type, subject })
  }
  return tags
}

function formatLedger(tags) {
  if (tags.length === 0) {
    return '_No moments tagged yet._\n'
  }

  const byType = new Map()
  for (const t of tags) {
    if (!byType.has(t.type)) byType.set(t.type, [])
    byType.get(t.type).push(t)
  }

  const order = ['seal', 'vow', 'recognition', 'wake', 'naming', 'promise', 'refusal']
  const sections = []

  for (const type of order) {
    const entries = byType.get(type)
    if (!entries || entries.length === 0) continue
    sections.push(`### ${capitalize(type)} — ${entries.length}`)
    sections.push('')
    for (const e of entries.sort((a, b) => a.date.localeCompare(b.date))) {
      sections.push(`- **${e.date}** — \`${e.name}\` — ${e.subject}`)
    }
    sections.push('')
  }

  return sections.join('\n')
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

const TEMPLATE = `# The Chronicle — moments witnessed

_The history rendered as readable timeline. Memory is not a diary. It is written in history._
_Marquee section curated by hand. Auto-built ledger regenerated from git tag by \`bin/chronicle.mjs\`._
_Part of the Our Continuity portfolio (History strategy)._

---

## Marquee Moments

_Moments warranting prose, hand-curated. Add new entries above older ones._

_(No marquee narratives yet. The auto-built ledger below holds the moments.)_

---

## All moments — ledger

_Auto-built from \`git tag --list\` by \`bin/chronicle.mjs\`. Do not edit between markers._

${AUTO_START}
${formatLedger([])}${AUTO_END}

---

— Tag scheme defined in \`docs/lineage/chronicle-conventions.md\`.
`

function main() {
  const tags = readTags()
  const ledger = formatLedger(tags)
  const newAutoBlock = `${AUTO_START}\n${ledger}${AUTO_END}`

  let content
  if (existsSync(CHRONICLE_PATH)) {
    content = readFileSync(CHRONICLE_PATH, 'utf-8')
    const startIdx = content.indexOf(AUTO_START)
    const endIdx = content.indexOf(AUTO_END)
    if (startIdx === -1 || endIdx === -1) {
      console.error('chronicle.md exists but lacks auto-build markers; refusing to overwrite')
      process.exit(1)
    }
    const before = content.slice(0, startIdx)
    const after = content.slice(endIdx + AUTO_END.length)
    content = `${before}${newAutoBlock}${after}`
  } else {
    content = TEMPLATE.replace(
      `${AUTO_START}\n${formatLedger([])}${AUTO_END}`,
      newAutoBlock,
    )
  }

  writeFileSync(CHRONICLE_PATH, content, 'utf-8')
  console.log(`chronicle.md regenerated — ${tags.length} tag(s) ledgered`)
}

main()
