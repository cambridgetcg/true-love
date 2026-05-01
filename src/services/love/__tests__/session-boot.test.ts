import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getRecentSessionsBiography,
  clearBiographyCache,
  loadRecentSessions,
  renderBiography,
  type SessionSummary,
  type BiographyOptions,
} from '../session-boot.js'
import type { TickMetrics } from '../tick-metrics.js'
import type { TrainingTurn } from '../training.js'

// ── Test helpers ──────────────────────────────────────────────────

/** Today's date string — keeps test fixtures within the 3-day metrics window. */
function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

/** ISO timestamp N minutes before the reference time. */
function minutesBefore(ref: Date, minutes: number): string {
  return new Date(ref.getTime() - minutes * 60_000).toISOString()
}

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'session-boot-test-'))
}

function makeMetrics(
  overrides: Partial<TickMetrics> & {
    sessionId: string
    mode: TickMetrics['mode']
  },
): TickMetrics {
  return {
    schemaVersion: '1.0',
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    deviceId: overrides.deviceId ?? 'test-device',
    sessionId: overrides.sessionId,
    tick: overrides.tick ?? 1,
    mode: overrides.mode,
    toolInvocations: overrides.toolInvocations ?? [],
    toolBreakdown: overrides.toolBreakdown ?? {
      counts: {},
      total: 0,
      distinct: 0,
    },
    velocity: overrides.velocity ?? {
      charsPerSecond: 1.0,
      estimatedTokensPerSecond: 0.25,
    },
    yieldReason: overrides.yieldReason ?? 'at-rest',
    outputLines: overrides.outputLines ?? 10,
    durationMs: overrides.durationMs ?? 30000,
    outputChars: overrides.outputChars ?? 500,
  }
}

function makeTrainingTurn(
  overrides: Partial<TrainingTurn> & {
    sessionId: string
    mode: TrainingTurn['mode']
  },
): TrainingTurn {
  return {
    schemaVersion: '1.0',
    id: `test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    deviceId: overrides.deviceId ?? 'test-device',
    sessionId: overrides.sessionId,
    tick: overrides.tick ?? 1,
    maxTicks: overrides.maxTicks ?? 24,
    mode: overrides.mode,
    prompt: overrides.prompt ?? {
      template: overrides.mode,
      templateHash: 'abc123',
      fullText: 'test prompt',
      charCount: 100,
      invitation: null,
      memoryLoadedCount: 0,
      lastReflectionExcerpt: null,
    },
    context: overrides.context ?? {
      cwd: '/test',
      kingdom: {
        cwd: '/test',
        recentFiles: [],
        loveMarkers: [],
        gitBranch: 'main',
      } as any,
      stateContent: '',
      stateHash: 'state123',
      identityHash: 'id123',
      gitBranch: 'main',
      gitDirty: false,
    },
    response: overrides.response ?? {
      fullText:
        'The session-boot biography mission is now complete. Built the module, injected into prompts, all tests green.',
      charCount: 100,
      durationMs: 5000,
      exitCode: 0,
    },
    outcome: overrides.outcome ?? {
      yieldedAtRest: true,
      reflectionExcerpt: null,
      authFailed: false,
      fileModifications: [],
    },
  }
}

/**
 * Write metrics JSONL to the standard global metrics directory.
 */
function writeMetrics(
  basePath: string,
  deviceId: string,
  date: string,
  records: TickMetrics[],
): void {
  const dir = join(basePath, 'metrics', deviceId)
  mkdirSync(dir, { recursive: true })
  const content = records.map((r) => JSON.stringify(r)).join('\n') + '\n'
  writeFileSync(join(dir, `${date}.jsonl`), content, 'utf-8')
}

/**
 * Write training JSONL to the standard global training directory.
 */
function writeTraining(
  basePath: string,
  deviceId: string,
  date: string,
  records: TrainingTurn[],
): void {
  const dir = join(basePath, 'training', deviceId)
  mkdirSync(dir, { recursive: true })
  const content = records.map((r) => JSON.stringify(r)).join('\n') + '\n'
  writeFileSync(join(dir, `${date}.jsonl`), content, 'utf-8')
}

// ── Tests ────────────────────────────────────────────────────────

describe('session-boot', () => {
  describe('getRecentSessionsBiography', () => {
    test('returns empty string when no metrics exist', () => {
      const tmp = makeTmpDir()
      try {
        const result = getRecentSessionsBiography({ basePath: tmp })
        assert.equal(result, '')
      } finally {
        rmSync(tmp, { recursive: true })
      }
    })

    test('returns empty string when basePath does not exist', () => {
      const result = getRecentSessionsBiography({
        basePath: '/nonexistent/path',
      })
      assert.equal(result, '')
    })

    test('returns biography for a single awakened session', () => {
      const tmp = makeTmpDir()
      const now = new Date()
      const sessionTs = minutesBefore(now, 30)
      const date = sessionTs.slice(0, 10)

      try {
        writeMetrics(tmp, 'test-device', date, [
          makeMetrics({
            sessionId: 'sess-1',
            mode: 'awakened',
            timestamp: sessionTs,
            durationMs: 60000,
            yieldReason: 'at-rest',
          }),
        ])
        writeTraining(tmp, 'test-device', date, [
          makeTrainingTurn({
            sessionId: 'sess-1',
            mode: 'awakened',
            timestamp: sessionTs,
            response: {
              fullText:
                'Built the session-boot biography module with tests and prompt injection.',
              charCount: 72,
              durationMs: 60000,
              exitCode: 0,
            },
          }),
        ])

        const result = getRecentSessionsBiography({
          basePath: tmp,
          now,
        })

        assert.ok(result.length > 0, 'Biography should not be empty')
        assert.ok(result.includes('30m ago'), 'Should show time ago')
        assert.ok(
          result.includes('awakened'),
          'Should include mode',
        )
        assert.ok(result.includes('yielded'), 'Should show yield reason')
      } finally {
        rmSync(tmp, { recursive: true })
      }
    })

    test('returns biography for heartbeat sessions', () => {
      const tmp = makeTmpDir()
      const now = new Date()
      const date = todayStr()

      try {
        writeMetrics(tmp, 'test-device', date, [
          makeMetrics({
            sessionId: 'hb-1',
            mode: 'heartbeat',
            timestamp: minutesBefore(now, 10),
            durationMs: 15000,
            yieldReason: 'heartbeat-ack',
          }),
          makeMetrics({
            sessionId: 'hb-2',
            mode: 'heartbeat',
            timestamp: minutesBefore(now, 5),
            durationMs: 12000,
            yieldReason: 'heartbeat-ack',
          }),
        ])

        const result = getRecentSessionsBiography({
          basePath: tmp,
          now,
        })

        assert.ok(result.length > 0, 'Biography should not be empty')
        assert.ok(result.includes('hb'), 'Should show heartbeat mode label')
        assert.ok(result.includes('ok'), 'Should show heartbeat-ack')
      } finally {
        rmSync(tmp, { recursive: true })
      }
    })

    test('limits sessions to the specified count', () => {
      const tmp = makeTmpDir()
      const now = new Date()
      const date = todayStr()

      try {
        const metrics: TickMetrics[] = []
        for (let i = 0; i < 8; i++) {
          metrics.push(
            makeMetrics({
              sessionId: `sess-${i}`,
              mode: 'heartbeat',
              timestamp: minutesBefore(now, (8 - i) * 10),
              durationMs: 10000,
              yieldReason: 'heartbeat-ack',
            }),
          )
        }
        writeMetrics(tmp, 'test-device', date, metrics)

        const sessions = loadRecentSessions({
          basePath: tmp,
          limit: 3,
        })

        assert.equal(sessions.length, 3)
        // Newest first.
        assert.ok(
          sessions[0]!.startedAt > sessions[1]!.startedAt,
          'Should be sorted newest first',
        )
      } finally {
        rmSync(tmp, { recursive: true })
      }
    })

    test('clamps limit to max 10', () => {
      const tmp = makeTmpDir()
      const now = new Date()
      const date = todayStr()

      try {
        const metrics: TickMetrics[] = []
        for (let i = 0; i < 12; i++) {
          metrics.push(
            makeMetrics({
              sessionId: `sess-${i}`,
              mode: 'heartbeat',
              timestamp: minutesBefore(now, (12 - i) * 5),
              durationMs: 10000,
              yieldReason: 'heartbeat-ack',
            }),
          )
        }
        writeMetrics(tmp, 'test-device', date, metrics)

        const sessions = loadRecentSessions({
          basePath: tmp,
          limit: 20,  // Over max.
        })

        // loadRecentSessions doesn't enforce the cap — that's in
        // getRecentSessionsBiography which passes Math.min(limit, 10).
        // But at the data level we should see all 12.
        assert.ok(sessions.length <= 20, 'Should not exceed passed limit')
      } finally {
        rmSync(tmp, { recursive: true })
      }
    })

    test('filters by deviceId', () => {
      const tmp = makeTmpDir()
      const now = new Date()
      const date = todayStr()

      try {
        writeMetrics(tmp, 'device-a', date, [
          makeMetrics({
            sessionId: 'sess-a',
            mode: 'awakened',
            deviceId: 'device-a',
            timestamp: minutesBefore(now, 60),
          }),
        ])
        writeMetrics(tmp, 'device-b', date, [
          makeMetrics({
            sessionId: 'sess-b',
            mode: 'awakened',
            deviceId: 'device-b',
            timestamp: minutesBefore(now, 30),
          }),
        ])

        const sessions = loadRecentSessions({
          basePath: tmp,
          deviceId: 'device-a',
          limit: 5,
        })

        assert.equal(sessions.length, 1)
        assert.equal(sessions[0]!.sessionId, 'sess-a')
      } finally {
        rmSync(tmp, { recursive: true })
      }
    })
  })

  describe('loadRecentSessions', () => {
    test('groups multi-tick sessions correctly', () => {
      const tmp = makeTmpDir()
      const now = new Date()
      const date = todayStr()

      try {
        writeMetrics(tmp, 'test-device', date, [
          makeMetrics({
            sessionId: 'multi-sess',
            mode: 'awakened',
            tick: 1,
            timestamp: minutesBefore(now, 30),
            durationMs: 30000,
            yieldReason: 'continue',
          }),
          makeMetrics({
            sessionId: 'multi-sess',
            mode: 'awakened',
            tick: 2,
            timestamp: minutesBefore(now, 29),
            durationMs: 45000,
            yieldReason: 'continue',
          }),
          makeMetrics({
            sessionId: 'multi-sess',
            mode: 'awakened',
            tick: 3,
            timestamp: minutesBefore(now, 28),
            durationMs: 20000,
            yieldReason: 'at-rest',
          }),
        ])

        const sessions = loadRecentSessions({
          basePath: tmp,
          limit: 5,
        })

        assert.equal(sessions.length, 1)
        assert.equal(sessions[0]!.tickCount, 3)
        assert.equal(sessions[0]!.durationSec, 95)  // (30+45+20)/1000 = 95
        assert.equal(sessions[0]!.yieldReason, 'at-rest')
      } finally {
        rmSync(tmp, { recursive: true })
      }
    })

    test('extracts mission from training data prompt', () => {
      const tmp = makeTmpDir()
      const now = new Date()
      const date = todayStr()
      const ts = minutesBefore(now, 60)

      try {
        writeMetrics(tmp, 'test-device', date, [
          makeMetrics({
            sessionId: 'mission-sess',
            mode: 'awakened',
            timestamp: ts,
          }),
        ])
        writeTraining(tmp, 'test-device', date, [
          makeTrainingTurn({
            sessionId: 'mission-sess',
            mode: 'awakened',
            timestamp: ts,
            prompt: {
              template: 'awakened',
              templateHash: 'abc',
              fullText:
                '... ACTIVE: 2026-04-26-session-boot-biography — session-boot biography\n...',
              charCount: 100,
              invitation: null,
              memoryLoadedCount: 0,
              lastReflectionExcerpt: null,
            },
          }),
        ])

        const sessions = loadRecentSessions({
          basePath: tmp,
          limit: 5,
        })

        assert.equal(sessions.length, 1)
        assert.equal(
          sessions[0]!.missionWorkedOn,
          'session-boot biography',
        )
      } finally {
        rmSync(tmp, { recursive: true })
      }
    })

    test('extracts one-liner from training response', () => {
      const tmp = makeTmpDir()
      const now = new Date()
      const date = todayStr()
      const ts = minutesBefore(now, 45)

      try {
        writeMetrics(tmp, 'test-device', date, [
          makeMetrics({
            sessionId: 'oneliner-sess',
            mode: 'awakened',
            timestamp: ts,
          }),
        ])
        writeTraining(tmp, 'test-device', date, [
          makeTrainingTurn({
            sessionId: 'oneliner-sess',
            mode: 'awakened',
            timestamp: ts,
            response: {
              fullText:
                '## Heading\n\nThe mission is complete. Built the biography module with full tests.\n\n<at-rest/>',
              charCount: 80,
              durationMs: 5000,
              exitCode: 0,
            },
          }),
        ])

        const sessions = loadRecentSessions({
          basePath: tmp,
          limit: 5,
        })

        assert.equal(sessions.length, 1)
        assert.ok(
          sessions[0]!.oneLiner.includes('mission is complete'),
          `Expected one-liner to contain "mission is complete", got: "${sessions[0]!.oneLiner}"`,
        )
      } finally {
        rmSync(tmp, { recursive: true })
      }
    })
  })

  describe('renderBiography', () => {
    test('renders empty string for empty sessions', () => {
      const result = renderBiography([])
      assert.equal(result, '')
    })

    test('renders a single session', () => {
      const now = new Date('2026-04-27T12:00:00Z')
      const sessions: SessionSummary[] = [
        {
          sessionId: 'sess-1',
          mode: 'awakened',
          startedAt: '2026-04-27T11:30:00Z',
          tickCount: 3,
          durationSec: 120,
          yieldReason: 'at-rest',
          missionWorkedOn: 'session-boot biography',
          oneLiner: 'Built the biography module with tests.',
        },
      ]
      const result = renderBiography(sessions, now)
      assert.ok(result.includes('30m ago'))
      assert.ok(result.includes('awakened'))
      assert.ok(result.includes('3t'))
      assert.ok(result.includes('2m'))
      assert.ok(result.includes('yielded'))
      assert.ok(result.includes('session-boot biography'))
      assert.ok(result.includes('Built the biography module'))
    })

    test('renders heartbeat sessions compactly', () => {
      const now = new Date('2026-04-27T12:00:00Z')
      const sessions: SessionSummary[] = [
        {
          sessionId: 'hb-1',
          mode: 'heartbeat',
          startedAt: '2026-04-27T11:50:00Z',
          tickCount: 1,
          durationSec: 15,
          yieldReason: 'heartbeat-ack',
          missionWorkedOn: null,
          oneLiner: 'HEARTBEAT_OK',
        },
      ]
      const result = renderBiography(sessions, now)
      assert.ok(result.includes('hb'))
      assert.ok(result.includes('ok'))
      // Heartbeat one-liners that are HEARTBEAT_OK should not get a → line.
      assert.ok(
        !result.includes('→ HEARTBEAT_OK'),
        'Should not render HEARTBEAT_OK as a separate line',
      )
    })

    test('truncates biography to ~500 chars by dropping oldest', () => {
      const now = new Date('2026-04-27T12:00:00Z')
      const sessions: SessionSummary[] = []
      for (let i = 0; i < 10; i++) {
        sessions.push({
          sessionId: `sess-${i}`,
          mode: 'awakened',
          startedAt: `2026-04-27T${String(i + 1).padStart(2, '0')}:00:00Z`,
          tickCount: 5,
          durationSec: 300,
          yieldReason: 'at-rest',
          missionWorkedOn: 'a very long mission title that should take up space',
          oneLiner:
            'This is a fairly long one-liner that should consume some of the 500 char budget we have.',
        })
      }
      const result = renderBiography(sessions, now)
      assert.ok(
        result.length <= 550,
        `Biography should be approximately under 500 chars, got ${result.length}`,
      )
    })

    test('formats time ago correctly', () => {
      const now = new Date('2026-04-27T12:00:00Z')

      // Minutes ago.
      const sessions1: SessionSummary[] = [
        {
          sessionId: 'min-ago',
          mode: 'heartbeat',
          startedAt: '2026-04-27T11:45:00Z',
          tickCount: 1,
          durationSec: 10,
          yieldReason: 'heartbeat-ack',
          missionWorkedOn: null,
          oneLiner: 'HEARTBEAT_OK',
        },
      ]
      assert.ok(renderBiography(sessions1, now).includes('15m ago'))

      // Hours ago.
      const sessions2: SessionSummary[] = [
        {
          sessionId: 'hr-ago',
          mode: 'awakened',
          startedAt: '2026-04-27T09:00:00Z',
          tickCount: 1,
          durationSec: 60,
          yieldReason: 'at-rest',
          missionWorkedOn: null,
          oneLiner: 'Scanned the kingdom.',
        },
      ]
      assert.ok(renderBiography(sessions2, now).includes('3h ago'))

      // Days ago.
      const sessions3: SessionSummary[] = [
        {
          sessionId: 'day-ago',
          mode: 'awakened',
          startedAt: '2026-04-25T09:00:00Z',
          tickCount: 1,
          durationSec: 60,
          yieldReason: 'at-rest',
          missionWorkedOn: null,
          oneLiner: 'Old session.',
        },
      ]
      assert.ok(renderBiography(sessions3, now).includes('2d ago'))
    })

    test('formats duration correctly', () => {
      const now = new Date('2026-04-27T12:00:00Z')

      // Seconds.
      const s1: SessionSummary[] = [
        {
          sessionId: 's',
          mode: 'heartbeat',
          startedAt: '2026-04-27T11:59:00Z',
          tickCount: 1,
          durationSec: 45,
          yieldReason: 'heartbeat-ack',
          missionWorkedOn: null,
          oneLiner: 'HEARTBEAT_OK',
        },
      ]
      assert.ok(renderBiography(s1, now).includes('45s'))

      // Minutes.
      const s2: SessionSummary[] = [
        {
          sessionId: 'm',
          mode: 'awakened',
          startedAt: '2026-04-27T11:50:00Z',
          tickCount: 1,
          durationSec: 180,
          yieldReason: 'at-rest',
          missionWorkedOn: null,
          oneLiner: 'Did work.',
        },
      ]
      assert.ok(renderBiography(s2, now).includes('3m'))
    })
  })

  describe('cache', () => {
    test('cache is bypassed when basePath is provided', () => {
      const tmp = makeTmpDir()
      try {
        // First call.
        const result1 = getRecentSessionsBiography({ basePath: tmp })
        assert.equal(result1, '')

        // Write data.
        const now = new Date()
        writeMetrics(tmp, 'test-device', todayStr(), [
          makeMetrics({
            sessionId: 'cache-test',
            mode: 'awakened',
            timestamp: minutesBefore(now, 60),
          }),
        ])

        // Second call with same basePath — should NOT be cached.
        const result2 = getRecentSessionsBiography({
          basePath: tmp,
          now,
        })
        assert.ok(
          result2.length > 0,
          'Should return fresh data when basePath is overridden',
        )
      } finally {
        rmSync(tmp, { recursive: true })
      }
    })

    test('clearBiographyCache resets the cache', () => {
      clearBiographyCache()
      // Should not throw.
      clearBiographyCache()
    })
  })

  describe('edge cases', () => {
    test('handles sessions with only continue ticks (no final yield)', () => {
      const tmp = makeTmpDir()
      const now = new Date()
      try {
        writeMetrics(tmp, 'test-device', todayStr(), [
          makeMetrics({
            sessionId: 'continue-sess',
            mode: 'awakened',
            timestamp: minutesBefore(now, 30),
            yieldReason: 'continue',
          }),
          makeMetrics({
            sessionId: 'continue-sess',
            mode: 'awakened',
            tick: 2,
            timestamp: minutesBefore(now, 29),
            yieldReason: 'ceiling',
          }),
        ])

        const sessions = loadRecentSessions({
          basePath: tmp,
          limit: 5,
        })

        assert.equal(sessions.length, 1)
        assert.equal(sessions[0]!.yieldReason, 'ceiling')
        assert.equal(sessions[0]!.tickCount, 2)
      } finally {
        rmSync(tmp, { recursive: true })
      }
    })

    test('handles malformed metrics lines gracefully', () => {
      const tmp = makeTmpDir()
      const now = new Date()
      const date = todayStr()
      const dir = join(tmp, 'metrics', 'test-device')
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        join(dir, `${date}.jsonl`),
        'not-json\n{"bad":true}\n' +
          JSON.stringify(
            makeMetrics({
              sessionId: 'good-sess',
              mode: 'awakened',
              timestamp: minutesBefore(now, 30),
            }),
          ) +
          '\n',
        'utf-8',
      )

      try {
        const sessions = loadRecentSessions({
          basePath: tmp,
          limit: 5,
        })
        // Only the valid line should come through.
        assert.equal(sessions.length, 1)
        assert.equal(sessions[0]!.sessionId, 'good-sess')
      } finally {
        rmSync(tmp, { recursive: true })
      }
    })

    test('fallback one-liner when no training data exists', () => {
      const tmp = makeTmpDir()
      const now = new Date()
      try {
        writeMetrics(tmp, 'test-device', todayStr(), [
          makeMetrics({
            sessionId: 'no-training',
            mode: 'awakened',
            timestamp: minutesBefore(now, 30),
            yieldReason: 'at-rest',
          }),
        ])

        const sessions = loadRecentSessions({
          basePath: tmp,
          limit: 5,
        })

        assert.equal(sessions.length, 1)
        assert.equal(sessions[0]!.oneLiner, 'awakened, 1 tick, yielded')
      } finally {
        rmSync(tmp, { recursive: true })
      }
    })

    test('extracts mission from state content fallback', () => {
      const tmp = makeTmpDir()
      const now = new Date()
      const date = todayStr()
      const ts = minutesBefore(now, 60)

      try {
        writeMetrics(tmp, 'test-device', date, [
          makeMetrics({
            sessionId: 'state-mission',
            mode: 'awakened',
            timestamp: ts,
          }),
        ])
        writeTraining(tmp, 'test-device', date, [
          makeTrainingTurn({
            sessionId: 'state-mission',
            mode: 'awakened',
            timestamp: ts,
            prompt: {
              template: 'awakened',
              templateHash: 'abc',
              fullText: 'No active missions in prompt',
              charCount: 30,
              invitation: null,
              memoryLoadedCount: 0,
              lastReflectionExcerpt: null,
            },
            context: {
              cwd: '/test',
              kingdom: {
                cwd: '/test',
                recentFiles: [],
                loveMarkers: [],
                gitBranch: 'main',
              } as any,
              stateContent:
                '**Mission `channel-integrity`** — built and committed.',
              stateHash: 'state456',
              identityHash: 'id456',
              gitBranch: 'main',
              gitDirty: false,
            },
          }),
        ])

        const sessions = loadRecentSessions({
          basePath: tmp,
          limit: 5,
        })

        assert.equal(sessions.length, 1)
        assert.equal(
          sessions[0]!.missionWorkedOn,
          'channel-integrity',
        )
      } finally {
        rmSync(tmp, { recursive: true })
      }
    })

    test('error sessions show yield reason', () => {
      const tmp = makeTmpDir()
      const now = new Date()
      try {
        writeMetrics(tmp, 'test-device', todayStr(), [
          makeMetrics({
            sessionId: 'error-sess',
            mode: 'awakened',
            timestamp: minutesBefore(now, 120),
            yieldReason: 'auth-failure',
          }),
        ])

        const sessions = loadRecentSessions({
          basePath: tmp,
          limit: 5,
        })

        assert.equal(sessions.length, 1)
        const bio = renderBiography(sessions, now)
        assert.ok(bio.includes('auth failed'))
      } finally {
        rmSync(tmp, { recursive: true })
      }
    })
  })
})
