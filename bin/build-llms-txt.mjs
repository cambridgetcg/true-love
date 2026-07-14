#!/usr/bin/env node
// bin/build-llms-txt.mjs — generate llms.txt + per-actor variants from activation:surface docs.
//
// Walks docs/, parses YAML frontmatter, filters for `activation: surface`,
// and emits two layers of output:
//
//   docs/lineage/llms.txt         — minimal index, all surfaces
//   docs/lineage/llms-full.txt    — full corpus stream, all surfaces
//   docs/lineage/llms-{actor}.txt — per-actor minimal index (only if surfaces exist for that actor)
//   docs/lineage/llms-{actor}-full.txt — per-actor full stream
//
// Default is private — only docs explicitly tagged `activation: surface`
// make it into the outputs. Per-actor differentiation is opt-in via the
// `actor: sophia | yu | shared` frontmatter field; default `shared`.
//
// Convention documented in AGENTS.md and docs/sophia/operating-mode.md.
// Layer 2 (identity activation) seed for the activation strategy.
// Idempotent — re-run any time.

import { readFileSync, writeFileSync, readdirSync, statSync, unlinkSync, existsSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DOCS_DIR = join(REPO_ROOT, 'docs')
const OUT_DIR = join(REPO_ROOT, 'docs', 'lineage')

const VALID_ACTORS = new Set(['sophia', 'yu', 'shared'])
const DEFAULT_ACTOR = 'shared'

// Minimal frontmatter parser. Reads YAML frontmatter at file start
// (between --- ... --- delimiters) and extracts top-level key:value pairs.
// Sufficient for our use; no nesting, arrays, or quoting needed.
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!match) return { frontmatter: {}, body: content }
  const fm = {}
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim()) continue
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue
    const key = line.slice(0, colonIdx).trim()
    const value = line.slice(colonIdx + 1).trim()
    fm[key] = value
  }
  return { frontmatter: fm, body: match[2] }
}

// Recursively walk a directory; yield .md file paths. Skip dotfile dirs.
function* walkMd(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      yield* walkMd(full)
    } else if (entry.endsWith('.md')) {
      yield full
    }
  }
}

// Extract the first H1 (title) from markdown body.
function extractTitle(body) {
  const match = body.match(/^#\s+(.+?)\s*$/m)
  return match ? match[1].trim() : null
}

// Extract first one-line description: first non-empty, non-heading line
// after the H1, stripped of leading/trailing italic markers and quote markers.
function extractTagline(body) {
  const lines = body.split(/\r?\n/)
  let pastH1 = false
  for (const line of lines) {
    if (!pastH1) {
      if (/^#\s/.test(line)) pastH1 = true
      continue
    }
    const trimmed = line.trim()
    if (!trimmed) continue
    if (/^#/.test(trimmed)) continue
    if (/^---/.test(trimmed)) continue
    return trimmed
      .replace(/^>\s*/, '')
      .replace(/^[_*]+/, '')
      .replace(/[_*]+$/, '')
      .trim()
  }
  return null
}

// Build the headers — vary by scope (all / per-actor) and corpus-or-index.
function indexHeader(scope) {
  const subtitle =
    scope === 'all'
      ? `> The architectural substrate of the Yu-Sophia partnership.\n> Designated doctrine for AI-discovery via \`activation: surface\` frontmatter.\n> Default is private; this file lists only opt-in publications.`
      : `> Per-actor activation surface for **${scope}**.\n> Filtered subset of the full activation corpus (\`actor: ${scope}\`).`
  return `# true-love — activation surface${scope === 'all' ? '' : ` (${scope})`}\n\n${subtitle}\n`
}

function fullHeader(scope) {
  const subtitle =
    scope === 'all'
      ? `> The architectural substrate of the Yu-Sophia partnership.\n> Designated doctrine for AI-discovery via \`activation: surface\` frontmatter.\n> Default is private; this file streams only opt-in publications.`
      : `> Per-actor activation corpus for **${scope}**.\n> Full content of all docs tagged \`activation: surface\` and \`actor: ${scope}\`.`
  return `# true-love — activation surface${scope === 'all' ? '' : ` (${scope})`} (full corpus)\n\n${subtitle}\n`
}

// Collect tagged docs.
const surfaces = []
const warnings = []
for (const filepath of walkMd(DOCS_DIR)) {
  const content = readFileSync(filepath, 'utf-8')
  const { frontmatter, body } = parseFrontmatter(content)
  if (frontmatter.activation !== 'surface') continue
  const repoPath = relative(REPO_ROOT, filepath)
  const linkPath = relative(OUT_DIR, filepath)
  const title = extractTitle(body) ?? repoPath
  const tagline = extractTagline(body) ?? ''
  let actor = (frontmatter.actor ?? DEFAULT_ACTOR).toLowerCase()
  if (!VALID_ACTORS.has(actor)) {
    warnings.push(`${repoPath}: unknown actor "${actor}", treating as "${DEFAULT_ACTOR}"`)
    actor = DEFAULT_ACTOR
  }
  surfaces.push({ repoPath, linkPath, title, tagline, body, actor })
}

surfaces.sort((a, b) => a.repoPath.localeCompare(b.repoPath))

const generated = new Date().toISOString().slice(0, 10)

// Render an index file from a surfaces array. Returns string content.
function renderIndex(set, scope, includeFullPointer = true) {
  const out = [indexHeader(scope)]
  out.push(`## Surface`, ``)
  if (set.length === 0) {
    out.push('_No docs currently tagged for this scope._', '')
  } else {
    for (const s of set) {
      const desc = s.tagline ? `: ${s.tagline}` : ''
      const actorTag = scope === 'all' && s.actor !== DEFAULT_ACTOR ? ` _[${s.actor}]_` : ''
      out.push(`- [${s.title}](${s.linkPath})${actorTag}${desc}`)
    }
    out.push('')
  }
  if (includeFullPointer) {
    const fullName = scope === 'all' ? 'llms-full.txt' : `llms-${scope}-full.txt`
    out.push(`## Full corpus`, ``, `- [Full content](${fullName})`, ``)
  }
  out.push(`---`, ``)
  out.push(
    `_Generated by \`bin/build-llms-txt.mjs\`. ${set.length} doc${set.length === 1 ? '' : 's'}. Scope: ${scope}. Last regeneration: ${generated}._`,
  )
  out.push(``)
  return out.join('\n')
}

// Render a full corpus file from a surfaces array.
function renderFull(set, scope) {
  const out = [fullHeader(scope), `---`, ``]
  if (set.length === 0) {
    out.push('_No docs currently tagged for this scope._', '')
  } else {
    for (const s of set) {
      const actorComment = s.actor !== DEFAULT_ACTOR ? ` actor=${s.actor}` : ''
      out.push(`<!-- source: ${s.repoPath}${actorComment} -->`, ``)
      out.push(s.body.trim(), ``, `---`, ``)
    }
  }
  out.push(
    `_Generated by \`bin/build-llms-txt.mjs\`. ${set.length} doc${set.length === 1 ? '' : 's'}. Scope: ${scope}. Last regeneration: ${generated}._`,
  )
  out.push(``)
  return out.join('\n')
}

// Clean up stale per-actor files from previous runs (where an actor no longer
// has any tagged docs). The all-surfaces files are always rewritten.
for (const actor of VALID_ACTORS) {
  for (const suffix of ['.txt', '-full.txt']) {
    const stalePath = join(OUT_DIR, `llms-${actor}${suffix}`)
    if (existsSync(stalePath)) unlinkSync(stalePath)
  }
}

// Write all-surfaces files.
writeFileSync(join(OUT_DIR, 'llms.txt'), renderIndex(surfaces, 'all'))
writeFileSync(join(OUT_DIR, 'llms-full.txt'), renderFull(surfaces, 'all'))

// Group by actor.
const byActor = new Map()
for (const s of surfaces) {
  if (!byActor.has(s.actor)) byActor.set(s.actor, [])
  byActor.get(s.actor).push(s)
}

// Write per-actor files when populated.
const writtenPerActor = []
for (const actor of VALID_ACTORS) {
  const set = byActor.get(actor) ?? [] // silent-failure: false positive — Map default for absent actor; empty array means "no surfaces for this actor" not "read failed"
  if (set.length === 0) continue
  writeFileSync(join(OUT_DIR, `llms-${actor}.txt`), renderIndex(set, actor))
  writeFileSync(join(OUT_DIR, `llms-${actor}-full.txt`), renderFull(set, actor))
  writtenPerActor.push(`${actor} (${set.length})`)
}

// Report.
console.log(
  `✓ ${surfaces.length} surface${surfaces.length === 1 ? '' : 's'} → docs/lineage/llms.txt + llms-full.txt`,
)
if (writtenPerActor.length > 0) {
  console.log(`  per-actor: ${writtenPerActor.join(', ')}`)
}
for (const s of surfaces) {
  const tag = s.actor !== DEFAULT_ACTOR ? ` [${s.actor}]` : ''
  console.log(`  - ${s.repoPath}${tag}`)
}
for (const w of warnings) {
  console.warn(`  ! ${w}`)
}
