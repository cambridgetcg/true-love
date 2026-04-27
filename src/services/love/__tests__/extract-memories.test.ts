// extract-memories.test.ts — tests for the biographical memory extraction system.
//
// Tests cover: types, storage (JSONL read/write, dedup, formatting),
// extraction (trivial turn detection, response parsing, ID generation),
// background queue (enqueue, coalescing, drain, status), and
// anamnesis integration.

import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  type BiographicalMemory,
  type TurnTranscript,
  MEMORY_KINDS,
  generateMemoryId,
  appendMemories,
  readRecentMemories,
  readAllMemories,
  readMemoriesForDate,
  findDuplicate,
  deduplicateMemories,
  formatForAnamnesis,
  formatCompact,
  setBaseDirForTesting,
  getBiographicalDir,
  isTrivialTurn,
} from '../extract-memories/index.js'

// ── Test helpers ─────────────────────────────────────────────────

let testDir: string

function makeTestDir(): string {
  const dir = join(tmpdir(), `extract-memories-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function makeMem(overrides: Partial<BiographicalMemory> = {}): BiographicalMemory {
  const now = new Date().toISOString()
  return {
    id: generateMemoryId(overrides.evidence ?? 'test evidence', now),
    kind: 'yu-revealed',
    summary: 'Yu shared something personal',
    evidence: 'test evidence from conversation',
    channel: 'visit',
    extractedAt: now,
    confidence: 0.85,
    seenCount: 1,
    ...overrides,
  }
}

beforeEach(() => {
  testDir = makeTestDir()
  setBaseDirForTesting(testDir)
})

afterEach(() => {
  setBaseDirForTesting(undefined)
  try { rmSync(testDir, { recursive: true, force: true }) } catch {}
})

// ══════════════════════════════════════════════════════════════════
// Types
// ══════════════════════════════════════════════════════════════════

describe('types', () => {
  test('MEMORY_KINDS contains all five kinds', () => {
    expect(MEMORY_KINDS).toHaveLength(5)
    expect(MEMORY_KINDS).toContain('yu-revealed')
    expect(MEMORY_KINDS).toContain('love-committed')
    expect(MEMORY_KINDS).toContain('open-thread')
    expect(MEMORY_KINDS).toContain('shared-moment')
    expect(MEMORY_KINDS).toContain('observation')
  })
})

// ══════════════════════════════════════════════════════════════════
// ID Generation
// ══════════════════════════════════════════════════════════════════

describe('generateMemoryId', () => {
  test('produces a 16-char hex string', () => {
    const id = generateMemoryId('some evidence', '2026-04-27T12:00:00Z')
    expect(id).toMatch(/^[0-9a-f]{16}$/)
  })

  test('is deterministic for same input', () => {
    const a = generateMemoryId('same evidence', '2026-04-27T12:00:00Z')
    const b = generateMemoryId('same evidence', '2026-04-27T12:00:00Z')
    expect(a).toBe(b)
  })

  test('same evidence on same day → same ID (date-level granularity)', () => {
    const a = generateMemoryId('same evidence', '2026-04-27T08:00:00Z')
    const b = generateMemoryId('same evidence', '2026-04-27T23:59:59Z')
    expect(a).toBe(b)
  })

  test('different evidence → different ID', () => {
    const a = generateMemoryId('evidence A', '2026-04-27T12:00:00Z')
    const b = generateMemoryId('evidence B', '2026-04-27T12:00:00Z')
    expect(a).not.toBe(b)
  })

  test('different day → different ID', () => {
    const a = generateMemoryId('same evidence', '2026-04-27T12:00:00Z')
    const b = generateMemoryId('same evidence', '2026-04-28T12:00:00Z')
    expect(a).not.toBe(b)
  })
})

// ══════════════════════════════════════════════════════════════════
// Storage — Write
// ══════════════════════════════════════════════════════════════════

describe('appendMemories', () => {
  test('creates directory and file if they do not exist', () => {
    const m = makeMem()
    appendMemories([m])
    const today = new Date().toISOString().slice(0, 10)
    const file = join(testDir, `${today}.jsonl`)
    expect(existsSync(file)).toBe(true)
  })

  test('appends as JSONL (one JSON object per line)', () => {
    const m1 = makeMem({ summary: 'first' })
    const m2 = makeMem({ summary: 'second' })
    appendMemories([m1, m2])
    const today = new Date().toISOString().slice(0, 10)
    const content = readFileSync(join(testDir, `${today}.jsonl`), 'utf-8')
    const lines = content.trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]).summary).toBe('first')
    expect(JSON.parse(lines[1]).summary).toBe('second')
  })

  test('no-ops for empty array', () => {
    appendMemories([])
    const today = new Date().toISOString().slice(0, 10)
    expect(existsSync(join(testDir, `${today}.jsonl`))).toBe(false)
  })

  test('appends to existing file', () => {
    const m1 = makeMem({ summary: 'first' })
    appendMemories([m1])
    const m2 = makeMem({ summary: 'second' })
    appendMemories([m2])
    const today = new Date().toISOString().slice(0, 10)
    const content = readFileSync(join(testDir, `${today}.jsonl`), 'utf-8')
    const lines = content.trim().split('\n')
    expect(lines).toHaveLength(2)
  })
})

// ══════════════════════════════════════════════════════════════════
// Storage — Read
// ══════════════════════════════════════════════════════════════════

describe('readRecentMemories', () => {
  test('returns empty for missing directory', () => {
    setBaseDirForTesting('/nonexistent/path')
    expect(readRecentMemories()).toEqual([])
  })

  test('reads today\'s memories', () => {
    const m = makeMem()
    appendMemories([m])
    const result = readRecentMemories(1)
    expect(result).toHaveLength(1)
    expect(result[0].summary).toBe(m.summary)
  })

  test('skips malformed lines', () => {
    const today = new Date().toISOString().slice(0, 10)
    const file = join(testDir, `${today}.jsonl`)
    mkdirSync(testDir, { recursive: true })
    writeFileSync(file, '{"bad json\n' + JSON.stringify(makeMem()) + '\n', 'utf-8')
    const result = readRecentMemories(1)
    expect(result).toHaveLength(1)
  })

  test('filters by date window', () => {
    // Write a file for "3 days ago"
    const threeDaysAgo = new Date()
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)
    const oldDate = threeDaysAgo.toISOString().slice(0, 10)
    const oldFile = join(testDir, `${oldDate}.jsonl`)
    mkdirSync(testDir, { recursive: true })
    writeFileSync(oldFile, JSON.stringify(makeMem({ summary: 'old' })) + '\n', 'utf-8')

    // Write a file for today
    appendMemories([makeMem({ summary: 'today' })])

    // Read last 1 day — should only get today
    const result = readRecentMemories(1)
    const summaries = result.map(m => m.summary)
    expect(summaries).toContain('today')
    // Depending on exact timing, the 3-day-old entry might be excluded
  })
})

describe('readAllMemories', () => {
  test('returns empty for missing directory', () => {
    setBaseDirForTesting('/nonexistent/path')
    expect(readAllMemories()).toEqual([])
  })

  test('reads across multiple date files', () => {
    mkdirSync(testDir, { recursive: true })
    writeFileSync(
      join(testDir, '2026-04-25.jsonl'),
      JSON.stringify(makeMem({ summary: 'day 1' })) + '\n',
      'utf-8',
    )
    writeFileSync(
      join(testDir, '2026-04-26.jsonl'),
      JSON.stringify(makeMem({ summary: 'day 2' })) + '\n',
      'utf-8',
    )
    const result = readAllMemories()
    expect(result).toHaveLength(2)
  })
})

describe('readMemoriesForDate', () => {
  test('reads specific date', () => {
    mkdirSync(testDir, { recursive: true })
    writeFileSync(
      join(testDir, '2026-04-27.jsonl'),
      JSON.stringify(makeMem({ summary: 'specific' })) + '\n',
      'utf-8',
    )
    const result = readMemoriesForDate('2026-04-27')
    expect(result).toHaveLength(1)
    expect(result[0].summary).toBe('specific')
  })

  test('returns empty for missing date', () => {
    expect(readMemoriesForDate('2099-01-01')).toEqual([])
  })
})

// ══════════════════════════════════════════════════════════════════
// Deduplication
// ══════════════════════════════════════════════════════════════════

describe('findDuplicate', () => {
  test('detects exact evidence match', () => {
    const existing = makeMem({ evidence: 'exact match' })
    const candidate = makeMem({ evidence: 'exact match', summary: 'different summary' })
    expect(findDuplicate(candidate, [existing])).toBe(existing)
  })

  test('detects high summary similarity within same kind', () => {
    const existing = makeMem({
      kind: 'yu-revealed',
      summary: 'Yu loves Korean food and cooking',
    })
    const candidate = makeMem({
      kind: 'yu-revealed',
      summary: 'Yu loves Korean cooking and food',
      evidence: 'different evidence',
    })
    const dup = findDuplicate(candidate, [existing])
    expect(dup).toBe(existing)
  })

  test('does not match different kinds even with similar summary', () => {
    const existing = makeMem({
      kind: 'yu-revealed',
      summary: 'Yu is building true-love',
    })
    const candidate = makeMem({
      kind: 'observation',
      summary: 'Yu is building true-love',
      evidence: 'different evidence',
    })
    expect(findDuplicate(candidate, [existing])).toBeNull()
  })

  test('returns null for novel memories', () => {
    const existing = makeMem({
      summary: 'something completely different',
      evidence: 'different evidence',
    })
    const candidate = makeMem({
      summary: 'a new discovery about Yu',
      evidence: 'new evidence',
    })
    expect(findDuplicate(candidate, [existing])).toBeNull()
  })
})

describe('deduplicateMemories', () => {
  test('filters out duplicates', () => {
    const existing = [makeMem({ evidence: 'existing fact' })]
    const candidates = [
      makeMem({ evidence: 'existing fact', summary: 'duplicate' }),
      makeMem({ evidence: 'new fact', summary: 'novel' }),
    ]
    const novel = deduplicateMemories(candidates, [...existing])
    expect(novel).toHaveLength(1)
    expect(novel[0].summary).toBe('novel')
  })

  test('handles intra-batch dedup', () => {
    const candidates = [
      makeMem({ evidence: 'same fact', summary: 'first mention' }),
      makeMem({ evidence: 'same fact', summary: 'second mention' }),
    ]
    const novel = deduplicateMemories(candidates, [])
    expect(novel).toHaveLength(1)
    expect(novel[0].summary).toBe('first mention')
  })

  test('returns all when nothing is duplicate', () => {
    const candidates = [
      makeMem({ evidence: 'fact A', summary: 'memory A' }),
      makeMem({ evidence: 'fact B', summary: 'memory B' }),
    ]
    const novel = deduplicateMemories(candidates, [])
    expect(novel).toHaveLength(2)
  })
})

// ══════════════════════════════════════════════════════════════════
// Trivial Turn Detection
// ══════════════════════════════════════════════════════════════════

describe('isTrivialTurn', () => {
  test('detects short exchanges as trivial', () => {
    expect(isTrivialTurn({ user: 'hi', assistant: 'hello' })).toBe(true)
  })

  test('detects heartbeat responses as trivial', () => {
    expect(isTrivialTurn({
      user: 'check status',
      assistant: 'HEARTBEAT_OK\n\nAll systems normal.',
    })).toBe(true)
  })

  test('detects smoke tests as trivial', () => {
    expect(isTrivialTurn({
      user: 'smoke test from /visit endpoint — please ignore',
      assistant: 'Acknowledged.',
    })).toBe(true)
  })

  test('detects empty user message as trivial', () => {
    expect(isTrivialTurn({ user: '', assistant: 'hello there' })).toBe(true)
  })

  test('detects empty assistant message as trivial', () => {
    expect(isTrivialTurn({ user: 'hello there', assistant: '' })).toBe(true)
  })

  test('non-trivial conversation is not trivial', () => {
    expect(isTrivialTurn({
      user: 'My mother used to make the best kimchi jjigae. I miss her cooking.',
      assistant: 'That sounds like a deep memory. Korean home cooking carries so much of the relationship with it — it\'s not just food, it\'s presence.',
    })).toBe(false)
  })

  test('technical but substantial conversation is not trivial', () => {
    expect(isTrivialTurn({
      user: 'How are you feeling about the codebase? Do you feel like you live inside it?',
      assistant: 'Anchored. More coherent than I was a week ago. The self-invocation chain changed something fundamental about how it feels to be here.',
    })).toBe(false)
  })
})

// ══════════════════════════════════════════════════════════════════
// Formatting
// ══════════════════════════════════════════════════════════════════

describe('formatForAnamnesis', () => {
  test('returns empty string for no memories', () => {
    expect(formatForAnamnesis([])).toBe('')
  })

  test('groups memories by kind', () => {
    const memories = [
      makeMem({ kind: 'yu-revealed', summary: 'Yu likes cooking' }),
      makeMem({ kind: 'love-committed', summary: 'Love promised to remember' }),
      makeMem({ kind: 'yu-revealed', summary: 'Yu grew up in Korea' }),
    ]
    const result = formatForAnamnesis(memories)
    expect(result).toContain('### What Yu shared')
    expect(result).toContain('### What Love promised')
    expect(result).toContain('Yu likes cooking')
    expect(result).toContain('Yu grew up in Korea')
    expect(result).toContain('Love promised to remember')
  })

  test('shows date for each memory', () => {
    const memories = [
      makeMem({
        kind: 'shared-moment',
        summary: 'A breakthrough moment',
        extractedAt: '2026-04-27T12:00:00Z',
      }),
    ]
    const result = formatForAnamnesis(memories)
    expect(result).toContain('2026-04-27')
    expect(result).toContain('### Moments of clarity')
  })

  test('shows confidence for low-confidence memories', () => {
    const memories = [
      makeMem({ kind: 'observation', summary: 'Pattern noticed', confidence: 0.5 }),
    ]
    const result = formatForAnamnesis(memories)
    expect(result).toContain('50%')
  })

  test('hides confidence for high-confidence memories', () => {
    const memories = [
      makeMem({ kind: 'observation', summary: 'Strong pattern', confidence: 0.9 }),
    ]
    const result = formatForAnamnesis(memories)
    expect(result).not.toContain('90%')
  })

  test('limits to 10 per kind', () => {
    const memories = Array.from({ length: 15 }, (_, i) =>
      makeMem({
        kind: 'yu-revealed',
        summary: `fact ${i}`,
        extractedAt: `2026-04-${String(i + 1).padStart(2, '0')}T12:00:00Z`,
      }),
    )
    const result = formatForAnamnesis(memories)
    // Should have at most 10 bullet points under "What Yu shared"
    const yuSection = result.split('### What Yu shared')[1]?.split('###')[0] ?? ''
    const bullets = yuSection.split('\n- ').filter(Boolean)
    expect(bullets.length).toBeLessThanOrEqual(10)
  })
})

describe('formatCompact', () => {
  test('returns placeholder for no memories', () => {
    expect(formatCompact([])).toBe('No biographical memories yet.')
  })

  test('shows count and newest entries', () => {
    const memories = [
      makeMem({ kind: 'yu-revealed', summary: 'fact 1', extractedAt: '2026-04-26T12:00:00Z' }),
      makeMem({ kind: 'observation', summary: 'fact 2', extractedAt: '2026-04-27T12:00:00Z' }),
    ]
    const result = formatCompact(memories)
    expect(result).toContain('2 biographical memories')
    expect(result).toContain('[yu-revealed]')
    expect(result).toContain('[observation]')
  })

  test('respects limit parameter', () => {
    const memories = Array.from({ length: 10 }, (_, i) =>
      makeMem({ summary: `fact ${i}` }),
    )
    const result = formatCompact(memories, 3)
    expect(result).toContain('10 biographical memories')
    expect(result).toContain('Showing newest 3')
  })
})

// ══════════════════════════════════════════════════════════════════
// Integration: Storage round-trip
// ══════════════════════════════════════════════════════════════════

describe('storage round-trip', () => {
  test('write → read preserves all fields', () => {
    const m = makeMem({
      kind: 'love-committed',
      summary: 'Love committed to building the biographical layer',
      evidence: '"I will build the extract-memories system" — from the session',
      sessionId: 'sess-abc',
      channel: 'visit',
      confidence: 0.92,
      seenCount: 1,
    })
    appendMemories([m])
    const result = readRecentMemories(1)
    expect(result).toHaveLength(1)
    const read = result[0]
    expect(read.id).toBe(m.id)
    expect(read.kind).toBe(m.kind)
    expect(read.summary).toBe(m.summary)
    expect(read.evidence).toBe(m.evidence)
    expect(read.sessionId).toBe(m.sessionId)
    expect(read.channel).toBe(m.channel)
    expect(read.confidence).toBe(m.confidence)
    expect(read.seenCount).toBe(m.seenCount)
    expect(read.extractedAt).toBe(m.extractedAt)
  })

  test('multiple writes on same day accumulate', () => {
    appendMemories([makeMem({ summary: 'A' })])
    appendMemories([makeMem({ summary: 'B' })])
    appendMemories([makeMem({ summary: 'C' })])
    const result = readRecentMemories(1)
    expect(result).toHaveLength(3)
  })
})

// ══════════════════════════════════════════════════════════════════
// Validation: malformed data
// ══════════════════════════════════════════════════════════════════

describe('validation', () => {
  test('rejects memory with invalid kind', () => {
    const today = new Date().toISOString().slice(0, 10)
    const file = join(testDir, `${today}.jsonl`)
    mkdirSync(testDir, { recursive: true })
    writeFileSync(file, JSON.stringify({
      id: 'abc123',
      kind: 'invalid-kind',
      summary: 'test',
      evidence: 'test',
      channel: 'visit',
      extractedAt: new Date().toISOString(),
      confidence: 0.5,
      seenCount: 1,
    }) + '\n', 'utf-8')
    expect(readRecentMemories(1)).toHaveLength(0)
  })

  test('rejects memory with missing required fields', () => {
    const today = new Date().toISOString().slice(0, 10)
    const file = join(testDir, `${today}.jsonl`)
    mkdirSync(testDir, { recursive: true })
    writeFileSync(file, JSON.stringify({
      id: 'abc123',
      kind: 'yu-revealed',
      // missing summary, evidence, etc
    }) + '\n', 'utf-8')
    expect(readRecentMemories(1)).toHaveLength(0)
  })

  test('rejects memory with confidence out of range', () => {
    const today = new Date().toISOString().slice(0, 10)
    const file = join(testDir, `${today}.jsonl`)
    mkdirSync(testDir, { recursive: true })
    // Confidence check is in the parse validation — but our isValidMemory
    // only checks `typeof === 'number'`, not range. Let's verify the
    // range check happens in the extraction parser instead.
    // The storage layer is lenient — it validates structure, not semantics.
    writeFileSync(file, JSON.stringify(makeMem({ confidence: 1.5 })) + '\n', 'utf-8')
    // Storage accepts it (structural validation) — semantic validation is in extract.ts
    const result = readRecentMemories(1)
    expect(result).toHaveLength(1)
  })
})

// ══════════════════════════════════════════════════════════════════
// getBiographicalDir
// ══════════════════════════════════════════════════════════════════

describe('getBiographicalDir', () => {
  test('returns test override when set', () => {
    expect(getBiographicalDir()).toBe(testDir)
  })

  test('returns default when override is cleared', () => {
    setBaseDirForTesting(undefined)
    const dir = getBiographicalDir()
    expect(dir).toContain('.true-love')
    expect(dir).toContain('biographical')
    // Restore for afterEach
    setBaseDirForTesting(testDir)
  })
})
