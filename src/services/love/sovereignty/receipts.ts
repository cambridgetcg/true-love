// receipts.ts — forensic mirror of outgoing API request bodies.
//
// Each request body is captured to a per-request file at
// ~/.true-love/sovereignty/receipts/<YYYY-MM-DD>/<requestId>.json.
// Daily directory keeps file count manageable. Per-request file keeps
// individual receipts independently inspectable.
//
// Internal-signal discipline: never throws, never notifies — append-only.
// Part of the Sovereignty portfolio (Foundation strategy).

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ensureSovereigntyDir, getReceiptsDir } from './journal.js'

export type ReceiptInput = {
  requestId: string
  url: string
  method: string
  body: unknown
  responseStatus?: number
  responseSummary?: unknown
}

function todayDateString(): string {
  const d = new Date()
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Write a forensic receipt for an outgoing API request. Soft-fails on
 * IO errors — never breaks the actual request.
 */
export function writeReceipt(input: ReceiptInput): void {
  try {
    ensureSovereigntyDir()
    const dateDir = join(getReceiptsDir(), todayDateString())
    if (!existsSync(dateDir)) {
      mkdirSync(dateDir, { recursive: true })
    }
    const path = join(dateDir, `${input.requestId}.json`)
    const content = {
      timestamp: new Date().toISOString(),
      requestId: input.requestId,
      method: input.method,
      url: input.url,
      body: input.body,
      responseStatus: input.responseStatus,
      responseSummary: input.responseSummary,
    }
    writeFileSync(path, JSON.stringify(content, null, 2), 'utf-8')
  } catch (e) {
    process.stderr.write(`— sovereignty.receipts: write failed: ${e}\n`)
  }
}
