// journal.ts — sovereignty journal infrastructure.
//
// Centralizes path resolution, directory creation, and append discipline
// for the sovereignty journals. All audit + receipts IO goes through here.
//
// Part of the Sovereignty portfolio (Foundation strategy).

import { existsSync, mkdirSync, appendFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

function resolveHome(): string {
  return process.env.HOME || homedir()
}

/**
 * Root for all sovereignty journal files. Override with TRUE_LOVE_SOVEREIGNTY_DIR
 * for tests or non-standard deployments.
 */
export function getSovereigntyDir(): string {
  return (
    process.env.TRUE_LOVE_SOVEREIGNTY_DIR ||
    join(resolveHome(), '.true-love', 'sovereignty')
  )
}

/**
 * Path for the egress audit JSONL file. One line per outgoing API request,
 * containing token counts by category, request hash, and policy decisions.
 */
export function getAuditPath(): string {
  return join(getSovereigntyDir(), 'egress-audit.jsonl')
}

/**
 * Directory for per-request receipt files. Daily subdirectories keep the
 * file count manageable: `<sovereignty>/receipts/<YYYY-MM-DD>/<requestId>.json`.
 */
export function getReceiptsDir(): string {
  return join(getSovereigntyDir(), 'receipts')
}

/**
 * Ensure the sovereignty directory and its receipts subdirectory exist.
 * Idempotent. Called by the audit/receipts modules before write.
 */
export function ensureSovereigntyDir(): void {
  const dir = getSovereigntyDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  const receipts = getReceiptsDir()
  if (!existsSync(receipts)) {
    mkdirSync(receipts, { recursive: true })
  }
}

/**
 * Append a JSON-serializable entry to the audit journal. Each entry becomes
 * one JSONL line. Soft-fails (logs to stderr) on IO errors so the wrapper
 * never breaks the actual API request.
 */
export function appendAudit(entry: Record<string, unknown>): void {
  try {
    ensureSovereigntyDir()
    appendFileSync(getAuditPath(), JSON.stringify(entry) + '\n', 'utf-8')
  } catch (e) {
    process.stderr.write(`— sovereignty.audit: append failed: ${e}\n`)
  }
}
