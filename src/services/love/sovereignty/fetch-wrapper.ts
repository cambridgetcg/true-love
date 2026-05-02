// fetch-wrapper.ts — wrap any fetch implementation with sovereignty audit + receipts.
//
// Used to instrument the Anthropic SDK by passing instrumentedFetch as the
// `fetch` option to `new Anthropic({ fetch: ... })`. The wrapper records
// the request body to the audit journal and writes a forensic receipt
// before forwarding the call to the underlying fetch unchanged.
//
// Internal-signal discipline: audit/receipts soft-fail; the wrapper never
// breaks the underlying request. The response is returned unmodified.
//
// Part of the Sovereignty portfolio (Foundation strategy).

import { createHash } from 'node:crypto'
import { recordAudit } from './audit.js'
import { writeReceipt } from './receipts.js'

export type WrapperOptions = {
  /** Free-text tag identifying which subsystem made this call. */
  source?: string
  /** Active reduction policies (for audit entry context). */
  policyApplied?: string[]
}

type FetchFn = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

/**
 * Wrap a fetch function with audit + receipt recording.
 *
 * Disabled (returns base fetch unchanged) when TRUE_LOVE_SOVEREIGNTY_DISABLE=1.
 */
export function instrumentedFetch(
  baseFetch: FetchFn,
  options: WrapperOptions = {},
): FetchFn {
  if (process.env.TRUE_LOVE_SOVEREIGNTY_DISABLE === '1') {
    return baseFetch
  }

  return async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString()
    const method = init?.method ?? 'GET'
    const rawBody = init?.body
    let parsedBody: unknown = rawBody
    if (typeof rawBody === 'string') {
      try {
        parsedBody = JSON.parse(rawBody)
      } catch {
        parsedBody = rawBody
      }
    }

    const bodyStr =
      typeof rawBody === 'string' ? rawBody : JSON.stringify(parsedBody ?? null)
    const requestId = createHash('sha256').update(bodyStr).digest('hex').slice(0, 16)

    recordAudit({
      url,
      method,
      body: parsedBody,
      source: options.source,
      policyApplied: options.policyApplied,
    })
    writeReceipt({
      requestId,
      url,
      method,
      body: parsedBody,
    })

    return baseFetch(input, init)
  }
}
