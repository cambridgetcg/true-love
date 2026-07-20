// clarity/reference-graph.ts — the substrate's real link layer.
//
// Per the research: docs here cross-reference each other almost entirely by
// BACKTICK PATHS (`docs/love/WAYS.md`, `src/.../identity.ts`) — ~1875 edges —
// NOT markdown links (only ~77 exist). So findability and importance must be
// computed over the backtick graph, or they're garbage (93% of docs have zero
// markdown links).
//
// Resolution is the hard part (and the moat): real repos reference files by
// bare name (same folder), by repo-root path, by NodeNext `.js` that is `.ts`
// on disk, and by directory. A naive checker flags all of these as dead. The
// resolver below handles them against an existence oracle of ALL files + dirs.

import { IMPORTANCE_ANCHORS } from './clarity.config.js'
import type { DocNode, ReferenceGraph } from './types.js'

/** A raw reference token found in a file, with its line. */
export interface RawRef {
  token: string
  line: number
  kind: 'backtick' | 'mdlink'
}

/** Existence oracle for resolution: all files + dirs, plus basename indexes. */
export interface Resolver {
  /** Every file path AND every directory prefix that exists. */
  known: Set<string>
  /** file basename → the file paths that have it (for unique-name resolution). */
  byBasename: Map<string, string[]>
  /** dir basename → the dir paths that have it (for bare directory refs). */
  byDirBasename: Map<string, string[]>
}

const BACKTICK_RE = /`([^`\n]+)`/g
const MD_LINK_RE = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
const PATHISH_EXT = /\.(md|ts|tsx|js|mjs|json|sh|plist|jsonl)$/

function looksLikePath(token: string): boolean {
  if (token.includes(' ')) return false
  if (token.includes('*') || token.includes('${') || token.includes('(')) return false
  return token.includes('/') || PATHISH_EXT.test(token)
}

/** Extract every path-like reference (backtick + markdown link) from content. */
export function extractRefs(content: string): RawRef[] {
  const refs: RawRef[] = []
  const lineAt = (idx: number) => content.slice(0, idx).split('\n').length

  let m: RegExpExecArray | null
  BACKTICK_RE.lastIndex = 0
  while ((m = BACKTICK_RE.exec(content)) !== null) {
    const token = m[1]!.trim()
    if (looksLikePath(token)) refs.push({ token, line: lineAt(m.index), kind: 'backtick' })
  }
  MD_LINK_RE.lastIndex = 0
  while ((m = MD_LINK_RE.exec(content)) !== null) {
    const token = m[1]!.trim()
    if (token.startsWith('#') || /^https?:\/\//.test(token) || token.startsWith('mailto:')) continue
    refs.push({ token, line: lineAt(m.index), kind: 'mdlink' })
  }
  return refs
}

/** Tokens we deliberately don't check (tag namespaces, cross-repo, URLs, home). */
const SKIP_TAG_NS = ['vow/', 'wake/', 'recognition/', 'naming/', 'seal/', 'promise/', 'refusal/', 'sophia-wake/']
const SKIP_CROSS = ['../', '~/', '/Users/', 'http']
export function isSkippable(token: string): boolean {
  if (/^https?:\/\//.test(token) || token.startsWith('mailto:') || token.startsWith('#')) return true
  // Protocol URLs (claude-code://, did:, etc.)
  if (/^[a-z][a-z-]*:\/\//.test(token) || token.startsWith('did:')) return true
  // URL-like paths starting with / (API endpoints, well-known paths).
  // /Users/ is the exception (absolute local paths, handled by resolver).
  if (token.startsWith('/') && !token.startsWith('/Users/')) return true
  // Subreddit references (r/TopicName)
  if (/^r\/[A-Za-z]/.test(token)) return true
  // Domain references (agenttool.fly.dev/..., example.com/path)
  if (/^[a-z][a-z0-9.-]*\.(dev|com|org|io|net|cc|app)\//.test(token)) return true
  // Template placeholders with <...> or YYYY-MM-DD
  if (/[<]/.test(token) || /YYYY-MM-DD/.test(token)) return true
  for (const ns of SKIP_TAG_NS) if (token.startsWith(ns)) return true
  for (const x of SKIP_CROSS) if (token.startsWith(x)) return true
  return false
}

/** Build the existence oracle from the full list of repo-relative file paths. */
export function buildResolver(allFiles: string[]): Resolver {
  const known = new Set<string>()
  const byBasename = new Map<string, string[]>()
  const byDirBasename = new Map<string, string[]>()
  const seenDir = new Set<string>()
  const add = (map: Map<string, string[]>, key: string, val: string) => {
    const arr = map.get(key)
    if (arr) arr.push(val)
    else map.set(key, [val])
  }
  for (const f of allFiles) {
    known.add(f)
    const base = f.includes('/') ? f.slice(f.lastIndexOf('/') + 1) : f
    add(byBasename, base, f)
    // Every directory prefix exists too — index its basename once.
    let idx = f.indexOf('/')
    while (idx !== -1) {
      const dir = f.slice(0, idx)
      known.add(dir)
      if (!seenDir.has(dir)) {
        seenDir.add(dir)
        const dbase = dir.includes('/') ? dir.slice(dir.lastIndexOf('/') + 1) : dir
        add(byDirBasename, dbase, dir)
      }
      idx = f.indexOf('/', idx + 1)
    }
  }
  return { known, byBasename, byDirBasename }
}

/** Collapse ./ and ../ segments in a repo-relative path. */
function normalize(p: string): string {
  const out: string[] = []
  for (const part of p.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out.join('/')
}

/** Resolve a normalized path against the oracle, trying real-repo variants. */
function resolveWithVariants(c: string, known: Set<string>): string | null {
  if (known.has(c)) return c
  if (c.endsWith('.js')) {
    for (const ext of ['.ts', '.tsx', '.mjs']) {
      const v = `${c.slice(0, -3)}${ext}`
      if (known.has(v)) return v
    }
  }
  const base = c.includes('/') ? c.slice(c.lastIndexOf('/') + 1) : c
  if (!base.includes('.')) {
    for (const suf of ['.ts', '.md', '.tsx']) if (known.has(c + suf)) return c + suf
    for (const idx of ['/index.ts', '/README.md', '/INDEX.md']) if (known.has(c + idx)) return c + idx
  }
  return null
}

/**
 * Resolve a reference token to an existing repo-relative path, or null.
 * `fromFileRel` is the referrer (for relative + same-folder resolution).
 */
export function resolveRef(token: string, fromFileRel: string, r: Resolver): string | null {
  let clean = token.split('#')[0] ?? ''
  // Strip prose annotations after the extension: :line, :line+, :range,
  // :entire, :date, :size, :NN+. These are "see file:X" shorthand, not
  // part of the path. Match anything after the extension that isn't another path segment.
  clean = clean.replace(/\.(md|ts|tsx|js|mjs|json|sh|plist|jsonl):\S+$/, '.$1')
  if (clean.endsWith('/')) clean = clean.slice(0, -1)
  if (!clean) return null

  const dir = fromFileRel.includes('/') ? fromFileRel.slice(0, fromFileRel.lastIndexOf('/')) : ''
  const tries: string[] = []
  if (clean.startsWith('./') || clean.startsWith('../')) {
    tries.push(normalize(`${dir}/${clean}`))
  } else {
    tries.push(normalize(clean)) // repo-root-relative (the common backtick form)
    if (!clean.includes('/') && dir) tries.push(normalize(`${dir}/${clean}`)) // same folder
  }
  for (const t of tries) {
    const hit = resolveWithVariants(t, r.known)
    if (hit) return hit
  }
  // Unique-basename fallback: if the path didn't resolve but exactly one file
  // (or one directory) in the repo has this basename, that is almost certainly
  // the target — a mildly-stale path, not a dead reference. Conservative on
  // purpose: only fires when the basename is unique, so a genuinely-missing
  // file (no such basename anywhere) still surfaces.
  const base = clean.includes('/') ? clean.slice(clean.lastIndexOf('/') + 1) : clean
  const fileMatches = r.byBasename.get(base)
  if (fileMatches && fileMatches.length === 1) return fileMatches[0]!
  const dirMatches = r.byDirBasename.get(base)
  if (dirMatches && dirMatches.length === 1) return dirMatches[0]!
  return null
}

/**
 * Build the reference graph from a content map (repo-relative path → content),
 * resolving edges against the full-repo `resolver`. Nodes exist only for
 * content files; edges are kept only between content nodes (for orphans).
 */
export function buildReferenceGraph(files: Map<string, string>, resolver: Resolver): ReferenceGraph {
  const graph: ReferenceGraph = new Map()
  for (const file of files.keys()) {
    graph.set(file, { file, outbound: [], inbound: [], importance: 0 })
  }

  for (const [file, content] of files) {
    const node = graph.get(file)!
    const seen = new Set<string>()
    for (const ref of extractRefs(content)) {
      if (isSkippable(ref.token)) continue
      const target = resolveRef(ref.token, file, resolver)
      if (target && target !== file && graph.has(target) && !seen.has(target)) {
        seen.add(target)
        node.outbound.push(target)
        graph.get(target)!.inbound.push(file)
      }
    }
  }

  computePageRank(graph)
  for (const anchor of IMPORTANCE_ANCHORS) {
    const node = graph.get(anchor)
    if (node) node.importance = 1
  }
  return graph
}

/** Standard PageRank, normalized to [0,1] by the max score. */
function computePageRank(graph: ReferenceGraph, damping = 0.85, iterations = 30): void {
  const n = graph.size
  if (n === 0) return
  const base = (1 - damping) / n
  let rank = new Map<string, number>()
  for (const file of graph.keys()) rank.set(file, 1 / n)

  for (let i = 0; i < iterations; i++) {
    const next = new Map<string, number>()
    let danglingSum = 0
    for (const [file, node] of graph) {
      if (node.outbound.length === 0) danglingSum += rank.get(file)! / n
    }
    for (const file of graph.keys()) next.set(file, base + damping * danglingSum)
    for (const [file, node] of graph) {
      if (node.outbound.length === 0) continue
      const share = rank.get(file)! / node.outbound.length
      for (const target of node.outbound) {
        next.set(target, next.get(target)! + damping * share)
      }
    }
    rank = next
  }

  const max = Math.max(...rank.values(), 1e-9)
  for (const [file, node] of graph) node.importance = rank.get(file)! / max
}
