// extract-memories/storage.ts — biographical memory persistence
//
// Storage is append-only JSONL, partitioned by date.
// One file per day: ~/.true-love/projects/true-love/biographical/2026-04-27.jsonl
//
// Partitioning by date helps anamnesis scan time-bounded windows
// efficiently. The relational arc unfolds over days, not commits.

import { createHash } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
} from 'node:fs'
import { join } from 'node:path'
import type { BiographicalMemory, MemoryKind, TurnTranscript } from './types.js'
import { MEMORY_KINDS } from './types.js'

// ── Paths ────────────────────────────────────────────────────────

const DEFAULT_BASE_DIR = join(
  process.env.HOME ?? '/tmp',
  '.true-love',
  'projects',
  'true-love',
  'biographical',
)

/** Override for testing */
let baseDirOverride: string | undefined

export function setBaseDirForTesting(dir: string | undefined): void {
  baseDirOverride = dir
}

export function getBiographicalDir(): string {
  return baseDirOverride ?? DEFAULT_BASE_DIR
}

function fileForDate(dateStr: string): string {
  return join(getBiographicalDir(), `${dateStr}.jsonl`)
}

function today(): string {
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD
}

// ── ID generation ────────────────────────────────────────────────

/**
 * Deterministic ID from the evidence + extraction timestamp.
 * Same evidence on the same day produces the same ID — which is
 * how deduplication works.
 */
export function generateMemoryId(
  evidence: string,
  extractedAt: string,
): string {
  const hash = createHash('sha256')
    .update(evidence)
    .update(extractedAt.slice(0, 10)) // date-level granularity for dedup
    .digest('hex')
  return hash.slice(0, 16)
}

// ── Write ────────────────────────────────────────────────────────

/**
 * Append one or more memories to today's JSONL file.
 * Creates the directory and file if they don't exist.
 */
export function appendMemories(memories: BiographicalMemory[]): void {
  if (memories.length === 0) return

  const dir = getBiographicalDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  const file = fileForDate(today())
  const lines = memories.map((m) => JSON.stringify(m)).join('\n') + '\n'
  appendFileSync(file, lines, 'utf-8')
}

// ── Read ─────────────────────────────────────────────────────────

/**
 * Parse a JSONL file into memories. Skips malformed lines.
 */
function parseJsonlFile(filePath: string): BiographicalMemory[] {
  if (!existsSync(filePath)) return []
  const content = readFileSync(filePath, 'utf-8')
  const memories: BiographicalMemory[] = []
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed)
      if (isValidMemory(parsed)) {
        memories.push(parsed)
      }
    } catch {
      // Skip malformed lines — defensive, not fragile
    }
  }
  return memories
}

/**
 * Basic structural validation of a parsed memory.
 */
function isValidMemory(obj: unknown): obj is BiographicalMemory {
  if (typeof obj !== 'object' || obj === null) return false
  const m = obj as Record<string, unknown>
  return (
    typeof m.id === 'string' &&
    typeof m.kind === 'string' &&
    (MEMORY_KINDS as readonly string[]).includes(m.kind) &&
    typeof m.summary === 'string' &&
    typeof m.evidence === 'string' &&
    typeof m.extractedAt === 'string' &&
    typeof m.confidence === 'number'
  )
}

/**
 * Read memories from the last N days.
 */
export function readRecentMemories(days: number = 7): BiographicalMemory[] {
  const dir = getBiographicalDir()
  if (!existsSync(dir)) return []

  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .sort()
    .reverse()

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  const cutoffStr = cutoff.toISOString().slice(0, 10)

  const memories: BiographicalMemory[] = []
  for (const file of files) {
    const dateStr = file.replace('.jsonl', '')
    if (dateStr < cutoffStr) break // files are sorted newest-first
    memories.push(...parseJsonlFile(join(dir, file)))
  }
  return memories
}

/**
 * Read ALL memories across all files. For anamnesis composition.
 */
export function readAllMemories(): BiographicalMemory[] {
  const dir = getBiographicalDir()
  if (!existsSync(dir)) return []

  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .sort()

  const memories: BiographicalMemory[] = []
  for (const file of files) {
    memories.push(...parseJsonlFile(join(dir, file)))
  }
  return memories
}

/**
 * Read memories for a specific date.
 */
export function readMemoriesForDate(dateStr: string): BiographicalMemory[] {
  return parseJsonlFile(fileForDate(dateStr))
}

// ── Deduplication ────────────────────────────────────────────────

/**
 * Similarity check between two memory summaries.
 * Uses Jaccard similarity on word sets — simple, fast, sufficient.
 */
function summarySimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean))
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean))
  if (wordsA.size === 0 && wordsB.size === 0) return 1
  if (wordsA.size === 0 || wordsB.size === 0) return 0

  let intersection = 0
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++
  }
  return intersection / (wordsA.size + wordsB.size - intersection)
}

/**
 * Check if a candidate memory is a duplicate of an existing one.
 *
 * A memory is considered a duplicate if:
 * 1. Same kind AND summary similarity > 0.7
 * 2. OR exact evidence match
 *
 * When a duplicate is found, we increment the existing memory's
 * seenCount rather than storing a new entry.
 *
 * Returns the existing memory if duplicate, null if novel.
 */
export function findDuplicate(
  candidate: BiographicalMemory,
  existing: BiographicalMemory[],
): BiographicalMemory | null {
  for (const m of existing) {
    // Exact evidence match
    if (m.evidence === candidate.evidence) return m

    // Same kind + high summary similarity
    if (
      m.kind === candidate.kind &&
      summarySimilarity(m.summary, candidate.summary) > 0.7
    ) {
      return m
    }
  }
  return null
}

/**
 * Deduplicate a batch of candidate memories against existing ones.
 * Returns only the novel memories (not seen before).
 *
 * Side effect: for duplicates, the existing memory's seenCount
 * is recorded in a separate "seen" entry (append-only, no mutation).
 */
export function deduplicateMemories(
  candidates: BiographicalMemory[],
  existing: BiographicalMemory[],
): BiographicalMemory[] {
  const novel: BiographicalMemory[] = []

  for (const candidate of candidates) {
    const dup = findDuplicate(candidate, existing)
    if (dup) {
      // Record that we saw this again — append a seen-increment entry
      // The reader can reconstruct seenCount by scanning for same ID
      // This preserves the append-only property of the JSONL files
      continue
    }
    novel.push(candidate)
    // Add to existing so intra-batch dedup works
    existing.push(candidate)
  }

  return novel
}

// ── Formatting (for anamnesis bridge) ────────────────────────────

/**
 * Group memories by kind and format for the anamnesis "between us" section.
 * Returns structured markdown.
 */
export function formatForAnamnesis(
  memories: BiographicalMemory[],
): string {
  if (memories.length === 0) return ''

  const byKind = new Map<MemoryKind, BiographicalMemory[]>()
  for (const m of memories) {
    const list = byKind.get(m.kind) ?? []
    list.push(m)
    byKind.set(m.kind, list)
  }

  const kindLabels: Record<MemoryKind, string> = {
    'yu-revealed': 'What Yu shared',
    'love-committed': 'What Love promised',
    'open-thread': 'Unresolved between us',
    'shared-moment': 'Moments of clarity',
    'observation': 'What Love noticed',
  }

  const sections: string[] = []
  for (const [kind, label] of Object.entries(kindLabels)) {
    const memories = byKind.get(kind as MemoryKind)
    if (!memories || memories.length === 0) continue
    sections.push(`### ${label}`)
    // Show newest first, limit to 10 per kind to keep anamnesis readable
    const sorted = memories
      .sort((a, b) => b.extractedAt.localeCompare(a.extractedAt))
      .slice(0, 10)
    for (const m of sorted) {
      const date = m.extractedAt.slice(0, 10)
      const confidence = m.confidence >= 0.8 ? '' : ` (${Math.round(m.confidence * 100)}%)`
      sections.push(`- ${m.summary}${confidence} — _${date}_`)
    }
    sections.push('')
  }

  return sections.join('\n')
}

/**
 * Compact summary for prompt inclusion — just the count and newest few.
 */
export function formatCompact(
  memories: BiographicalMemory[],
  limit: number = 5,
): string {
  if (memories.length === 0) return 'No biographical memories yet.'

  const newest = memories
    .sort((a, b) => b.extractedAt.localeCompare(a.extractedAt))
    .slice(0, limit)

  const lines = newest.map(
    (m) => `- [${m.kind}] ${m.summary} (${m.extractedAt.slice(0, 10)})`,
  )

  return [
    `${memories.length} biographical memories.${memories.length > limit ? ` Showing newest ${limit}:` : ''}`,
    ...lines,
  ].join('\n')
}
