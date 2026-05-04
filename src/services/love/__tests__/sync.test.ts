import { describe, expect, test } from 'bun:test'
import {
  shouldAlert,
  buildAlertMessage,
  type SyncResult,
} from '../sync.js'

describe('sync — alert classification', () => {
  test('up-to-date is silent', () => {
    expect(shouldAlert('up-to-date')).toBe(false)
  })

  test('fast-forwarded is silent', () => {
    expect(shouldAlert('fast-forwarded')).toBe(false)
  })

  test('stash-rebase-popped is silent (recovered cleanly)', () => {
    expect(shouldAlert('stash-rebase-popped')).toBe(false)
  })

  test('diverged-needs-merge alerts', () => {
    expect(shouldAlert('diverged-needs-merge')).toBe(true)
  })

  test('fetch-failed alerts', () => {
    expect(shouldAlert('fetch-failed')).toBe(true)
  })

  test('rebase-failed alerts', () => {
    expect(shouldAlert('rebase-failed')).toBe(true)
  })

  test('pop-failed alerts (stash conflict)', () => {
    expect(shouldAlert('pop-failed')).toBe(true)
  })

  test('no-remote alerts (config issue)', () => {
    expect(shouldAlert('no-remote')).toBe(true)
  })
})

describe('sync — alert message format', () => {
  function makeResult(outcome: SyncResult['outcome'], details = 'test details'): SyncResult {
    return {
      outcome,
      details,
      commitsPulled: 0,
      commitsStashed: false,
      ts: '2026-05-04T15:00:00.000Z',
    }
  }

  test('alert message includes outcome, repo, time, details', () => {
    const msg = buildAlertMessage(makeResult('diverged-needs-merge', 'ahead 2 behind 3'), '/path/to/repo')
    expect(msg).toContain('diverged-needs-merge')
    expect(msg).toContain('/path/to/repo')
    expect(msg).toContain('2026-05-04T15:00:00.000Z')
    expect(msg).toContain('ahead 2 behind 3')
  })

  test('alert message includes suggestion for divergence', () => {
    const msg = buildAlertMessage(makeResult('diverged-needs-merge'), '/repo')
    expect(msg).toMatch(/git\s+merge\s+origin\/main/)
  })

  test('alert message includes suggestion for pop-failed', () => {
    const msg = buildAlertMessage(makeResult('pop-failed'), '/repo')
    expect(msg).toMatch(/git\s+stash\s+drop|git\s+status/)
  })

  test('alert message includes suggestion for fetch-failed', () => {
    const msg = buildAlertMessage(makeResult('fetch-failed'), '/repo')
    expect(msg).toContain('Check network')
  })
})
