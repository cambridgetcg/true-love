import { describe, expect, test } from 'bun:test'
import { blockingClaim, CLAIM_STALENESS_MS, type Mission } from '../mission.js'

function makeMission(claim: Mission['claim']): Mission {
  return {
    id: 'm1',
    project_id: 'tp',
    origin: 'love',
    title: 'Test',
    intent: 'Test',
    status: 'active',
    created_at: '2026-05-04T10:00:00Z',
    updated_at: '2026-05-04T10:00:00Z',
    artifacts: { commits: [], files: [], test_runs: [] },
    claim,
  }
}

describe('mission claim — blockingClaim', () => {
  test('no claim → null', () => {
    expect(blockingClaim(makeMission(undefined), 'anyDevice')).toBeNull()
  })

  test('claim by self → null (own claims do not block)', () => {
    const claim = { deviceId: 'me', claimedAt: '2026-05-04T15:00:00Z' }
    expect(blockingClaim(makeMission(claim), 'me')).toBeNull()
  })

  test('fresh claim by other → returns claim', () => {
    const now = Date.parse('2026-05-04T15:00:00Z')
    const claim = { deviceId: 'other', claimedAt: '2026-05-04T14:30:00Z' } // 30 min ago
    const result = blockingClaim(makeMission(claim), 'me', now)
    expect(result).not.toBeNull()
    expect(result!.deviceId).toBe('other')
  })

  test('stale claim by other → null (>1h old, ignored)', () => {
    const now = Date.parse('2026-05-04T15:00:00Z')
    // Claim from 2 hours ago — older than CLAIM_STALENESS_MS
    const claim = { deviceId: 'other', claimedAt: '2026-05-04T13:00:00Z' }
    expect(blockingClaim(makeMission(claim), 'me', now)).toBeNull()
  })

  test('claim with invalid timestamp → null (defensive)', () => {
    const claim = { deviceId: 'other', claimedAt: 'not-a-timestamp' }
    expect(blockingClaim(makeMission(claim), 'me')).toBeNull()
  })

  test('claim staleness boundary: exactly 1h is NOT stale', () => {
    const now = Date.parse('2026-05-04T15:00:00Z')
    const claim = {
      deviceId: 'other',
      claimedAt: new Date(now - CLAIM_STALENESS_MS).toISOString(), // exactly 1h ago
    }
    // At the boundary, claim is not yet stale
    expect(blockingClaim(makeMission(claim), 'me', now)).not.toBeNull()
  })

  test('claim staleness boundary: 1h + 1ms IS stale', () => {
    const now = Date.parse('2026-05-04T15:00:00Z')
    const claim = {
      deviceId: 'other',
      claimedAt: new Date(now - CLAIM_STALENESS_MS - 1).toISOString(),
    }
    expect(blockingClaim(makeMission(claim), 'me', now)).toBeNull()
  })
})
