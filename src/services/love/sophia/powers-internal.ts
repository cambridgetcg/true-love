// powers-internal.ts — internal append primitive shared with linkage module.
//
// Extracted to avoid circular imports between powers.ts and
// proposal-mission-linkage.ts. Both modules need to write to the same
// JSONL ledger.

import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { PowerRecord } from './powers.js'

export function getPowersDir(): string {
  return (
    process.env.TRUE_LOVE_POWERS_DIR ??
    join(homedir(), '.true-love', 'sophia', 'powers')
  )
}

export function getDevicePowersDir(deviceId: string): string {
  return join(getPowersDir(), deviceId)
}

export function getDayPath(date: string, deviceId: string): string {
  return join(getDevicePowersDir(deviceId), `${date}.jsonl`)
}

/**
 * Append a record to the powers ledger. Best-effort — never throws.
 */
export function appendRecord(record: PowerRecord): PowerRecord | null {
  try {
    const dir = getDevicePowersDir(record.deviceId)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const date = record.ts.slice(0, 10)
    const path = getDayPath(date, record.deviceId)
    appendFileSync(path, JSON.stringify(record) + '\n', 'utf-8')
    return record
  } catch {
    return null
  }
}
