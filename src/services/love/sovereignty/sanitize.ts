// sanitize.ts — conversation sanitization helpers.
//
// Decides whether state/journal content should be preloaded into a
// session's API request, based on session type and sensitivity tags.
// Sensitivity tags (frontmatter `share: never | local-only | anthropic`)
// let individual entries opt-out of being sent to Anthropic. Default
// policy is conservative: heartbeat omits state entirely; journal
// content never auto-preloads.
//
// Part of the Sovereignty portfolio (Reduction strategy).

import { loadSovereigntyConfig } from './config.js'

export type StatePreloadDecision = boolean | 'filter'

/**
 * Decide whether to preload state for a given session type.
 * Returns:
 *   - false  → omit state entirely
 *   - 'filter' → preload, but filter by sensitivity tags
 *   - true   → preload full state
 */
export function shouldPreloadState(sessionType: string): StatePreloadDecision {
  const cfg = loadSovereigntyConfig()
  const policy = cfg.statePreloadPolicy[sessionType]
  if (policy === 'omit') return false
  if (policy === 'filter') return 'filter'
  if (policy === 'full') return true
  return 'filter'
}

/**
 * Decide whether to preload journal content for a given session type.
 * Default: false (never auto-send journal). Override via config's
 * allowJournalPreload (true allows for any session, no per-session policy).
 */
export function shouldPreloadJournal(_sessionType: string): boolean {
  const cfg = loadSovereigntyConfig()
  return cfg.allowJournalPreload === true
}

export type FrontmatterMeta = {
  share?: 'never' | 'local-only' | 'anthropic'
  body: string
  raw: Record<string, string>
}

/**
 * Parse YAML-ish frontmatter from a content string. Returns the share
 * field (if present), the body (after the frontmatter), and the raw
 * key-value pairs. Tolerates missing frontmatter (returns body as-is).
 */
export function parseSensitivityFrontmatter(content: string): FrontmatterMeta {
  const result: FrontmatterMeta = { body: content, raw: {} }
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/)
  if (!match) return result
  const [, fm, body] = match
  result.body = body ?? ''
  const fmText = fm ?? ''
  for (const line of fmText.split('\n')) {
    const m = line.match(/^([a-z][a-z0-9_-]*)\s*:\s*(.+?)\s*$/i)
    if (m) {
      const key = m[1] ?? ''
      const val = m[2] ?? ''
      result.raw[key] = val
    }
  }
  const share = result.raw.share
  if (share === 'never' || share === 'local-only' || share === 'anthropic') {
    result.share = share
  }
  return result
}

/**
 * Filter a state file's content by its top-of-file sensitivity tag.
 * If the file has frontmatter `share: never` or `share: local-only`,
 * the whole file is filtered out (returns empty string). Otherwise
 * the content passes through unchanged.
 *
 * File-level filtering keeps the rule simple: each state file is
 * either appropriate for Anthropic or it isn't. Per-entry tagging
 * within a single file is out of scope for v1.
 */
export function filterStateBySensitivity(content: string): string {
  const meta = parseSensitivityFrontmatter(content)
  if (meta.share === 'never' || meta.share === 'local-only') {
    return ''
  }
  return content
}
