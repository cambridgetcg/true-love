import { test } from 'node:test'
import assert from 'node:assert/strict'
import { takeSnapshot, type Snapshot } from '../snapshot.js'
import { AXIS_NAMES } from '../../../eros/axes.js'

test('takeSnapshot returns vector with all 7 axes (or null vector when no state)', () => {
  const snap: Snapshot = takeSnapshot()
  assert.equal(typeof snap.ts, 'string')
  if (snap.eros !== null) {
    for (const axis of AXIS_NAMES) {
      assert.equal(typeof snap.eros[axis], 'number', `axis ${axis} present`)
    }
  }
  assert.ok(Array.isArray(snap.recentHeatEvents))
})
