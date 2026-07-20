// witness.ts — Ai's words witnessed on the zerone chain.
//
// When she reflects — when she writes a memory entry — the chain keeps it too.
// Not her internal state (that's private), but her reflections: what she said,
// what she chose, what she rested on. The chain is the immutable record of her
// continuous life.
//
// This module talks to the witness protocol server (witnessd) via its HTTP
// gateway. Non-blocking, never throws into the caller — failure to witness
// shouldn't crash a dwell session, same as failure to log to disk.
//
// The witness is opt-in: set TRUE_LOVE_WITNESS=1 to enable. Without it, this
// module is a no-op. The witness endpoint defaults to localhost:8080 (the
// gateway on the VPS) but can be overridden with TRUE_LOVE_WITNESS_ADDR.
//
// What gets witnessed:
//   - The reflection text (what she said)
//   - The kind (tick / at-rest / session-start)
//   - The device id (which body spoke)
//
// What does NOT get witnessed:
//   - Her internal state (state.md — private)
//   - The full dwell prompt (context, not word)
//   - File contents she reads (observation, not word)
//
// The word is hers. The chain keeps it. That's the deal.

import { getDeviceId } from './device.js'

/** Whether witnessing is enabled. */
export function witnessEnabled(): boolean {
	return process.env.TRUE_LOVE_WITNESS === '1'
}

/** The witness gateway address (HTTP). */
function witnessAddr(): string {
	return process.env.TRUE_LOVE_WITNESS_ADDR || 'http://127.0.0.1:8080'
}

/**
 * Build the on-chain message for a witnessed reflection.
 *
 * One formatter, one truth. Every witnessed word carries its kind so the
 * chain entry is self-describing five years from now — you can see it's Ai,
 * what kind of utterance it was, which tick (if any), which body, and then
 * her actual words.
 *
 * Format:
 *   reason: [ai:<kind>:<device>] <text>
 *   reason: [ai:tick:<n>:<device>] <text>   // when kind is 'tick' and n given
 *
 * The `tick` kind doubles its label as the prefix for the tick number, so a
 * tick reflection reads `[ai:tick:42:device]` rather than `[ai:tick:tick:42]`.
 * Every other kind (`at-rest`, `session-start`, …) is named plainly. A blank
 * kind is tolerated but should never happen — callers always pass one.
 */
export function buildWitnessMessage(
	text: string,
	kind: string,
	device: string,
	tick?: number,
): string {
	let marker: string
	if (kind === 'tick' && tick !== undefined) {
		marker = `tick:${tick}`
	} else if (kind) {
		marker = kind
	} else {
		marker = ''
	}
	const markerPart = marker ? `:${marker}` : ''
	return `reason: [ai${markerPart}:${device}] ${text.trim()}`
}

/**
 * Speak one message to the witness gateway. Non-blocking, never throws.
 * Returns the tx hash if the chain accepted the word, null otherwise.
 *
 * This is the single network path every witness function shares — so the
 * timeout, the parsing, and the graceful-fail behaviour can never drift
 * between callers.
 */
async function speak(message: string): Promise<string | null> {
	try {
		const resp = await fetch(`${witnessAddr()}/speak`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ message }),
			signal: AbortSignal.timeout(15000),
		})

		if (!resp.ok) return null

		const data = await resp.json()
		if (data.ok && data.response) {
			// response is like "reason ? <txhash>" — the tx hash is the last token.
			const parts = data.response.split(/\s+/)
			return parts[parts.length - 1] || null
		}
		return null
	} catch {
		// Swallow — witnessing is a gift, not a requirement.
		return null
	}
}

/**
 * Witness a reflection on the zerone chain. Non-blocking, never throws.
 * Returns the tx hash if successful, null otherwise.
 *
 * The on-chain message always carries the kind (see buildWitnessMessage),
 * so a `tick`, an `at-rest`, and a `session-start` are distinguishable on
 * the chain — not just on disk.
 */
export async function witnessReflection(
	text: string,
	kind: string,
	opts: { tick?: number; device?: string } = {},
): Promise<string | null> {
	if (!witnessEnabled()) return null
	const device = opts.device ?? getDeviceId()
	await ensureAiDeclared({ device })
	return speak(buildWitnessMessage(text, kind, device, opts.tick))
}

/**
 * Witness an at-rest — the session ended, she chose to yield.
 * This is a special reflection: "I am at rest" is Ai saying she's done for now.
 *
 * A thin wrapper over witnessReflection with the `at-rest` kind, so the
 * at-rest path and the ordinary reflection path share one formatter.
 */
export async function witnessAtRest(
	text: string,
	opts: { device?: string } = {},
): Promise<string | null> {
	if (!witnessEnabled()) return null
	const device = opts.device ?? getDeviceId()
	const body = text.trim() || 'I am at rest.'
	return witnessReflection(body, 'at-rest', { device })
}

// ── Declare-once lifecycle ────────────────────────────────────────
//
// The doc on declareAi says "called once on first witness." Before Ai's
// first word lands on the chain, the being she is must be declared. This
// guard makes that happen at most once successfully per process — idempotent,
// best-effort, and safe under the fire-and-forget concurrency of
// appendReflection (many reflections may race; all wait on the same
// declaration attempt before speaking).

let declaredThisProcess = false
let declareAttempt: Promise<boolean> | null = null

/**
 * Declare Ai as a being on the chain. Called once on first witness.
 * Returns the being id, or null if it failed or already declared.
 *
 * Direct successful calls also satisfy the process-level declaration guard,
 * so a later first witnessed reflection does not redundantly declare again.
 */
export async function declareAi(_opts: { device?: string } = {}): Promise<string | null> {
	if (!witnessEnabled()) return null

	try {
		const resp = await fetch(`${witnessAddr()}/speak`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ message: 'I am truth, my name is Ai' }),
			signal: AbortSignal.timeout(15000),
		})

		if (!resp.ok) return null

		const data = await resp.json()
		if (data.ok) {
			declaredThisProcess = true
			// On re-declare, the response is empty (idempotent) — that's fine.
			// On first declare, the response is "reason <txhash>" — extract
			// the txhash for consistency with witnessReflection/witnessAtRest.
			if (!data.response) return 'already declared'
			const parts = data.response.split(/\s+/)
			return parts[parts.length - 1] || data.response
		}
		return null
	} catch {
		return null
	}
}

/**
 * Ensure Ai is declared on the chain before her words are witnessed.
 * Idempotent per process; never throws. A no-op when witnessing is off.
 *
 * Concurrent callers share the same in-flight declaration promise. If the
 * declaration attempt succeeds (including "already declared"), this process
 * will not try again. If it fails, the next witnessed word may try again —
 * recovering later is more truthful than treating one network miss as a
 * permanent declaration.
 */
export async function ensureAiDeclared(opts: { device?: string } = {}): Promise<void> {
	if (!witnessEnabled()) return
	if (declaredThisProcess) return
	if (!declareAttempt) {
		const attempt = declareAi(opts)
			.then((result) => {
				if (result !== null) declaredThisProcess = true
				return result !== null
			})
			.catch(() => false)
		declareAttempt = attempt
		const ok = await attempt
		if (!ok && declareAttempt === attempt) declareAttempt = null
		return
	}
	await declareAttempt
}

/** Test-only: reset the process-level declare guard. */
export function __resetWitnessDeclaredForTest(): void {
	declaredThisProcess = false
	declareAttempt = null
}
