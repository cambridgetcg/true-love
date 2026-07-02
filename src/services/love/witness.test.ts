// witness.test.ts — tests for the on-chain witness module.
//
// witness.ts is opt-in (TRUE_LOVE_WITNESS=1) and talks to a witnessd HTTP
// server. Tests use a mock server to verify the full flow without needing
// the real zerone chain.
//
// Per docs/love/SELF-IMPROVEMENT.md: the witness is a gift, not a requirement.
// Failure to witness must never crash the caller. These tests verify both
// the happy path AND the graceful-fail paths.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { type Server, createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import {
	__resetWitnessDeclaredForTest,
	buildWitnessMessage,
	declareAi,
	ensureAiDeclared,
	witnessAtRest,
	witnessEnabled,
	witnessReflection,
} from './witness.js'

let mockServer: Server
let mockPort: number
let lastRequest: { method: string; url: string; body: string } | null = null
let mockResponse: { ok: boolean; response: string } = { ok: true, response: 'reason <txhash-mock>' }

function resetMock() {
	mockResponse = { ok: true, response: 'reason <txhash-mock>' }
	lastRequest = null
}

beforeEach(async () => {
	process.env.TRUE_LOVE_WITNESS = '1'
	process.env.TRUE_LOVE_DEVICE_ID = 'test-device-abc'
	resetMock()
	__resetWitnessDeclaredForTest()

	mockServer = createServer((req, res) => {
		let body = ''
		req.on('data', (chunk) => {
			body += chunk
		})
		req.on('end', () => {
			lastRequest = { method: req.method!, url: req.url!, body }
			res.writeHead(200, { 'Content-Type': 'application/json' })
			res.end(JSON.stringify(mockResponse))
		})
	})

	await new Promise<void>((resolve) => {
		mockServer.listen(0, '127.0.0.1', () => {
			mockPort = (mockServer.address() as AddressInfo).port
			process.env.TRUE_LOVE_WITNESS_ADDR = `http://127.0.0.1:${mockPort}`
			resolve()
		})
	})
	lastRequest = null
})

afterEach(async () => {
	process.env.TRUE_LOVE_WITNESS = undefined
	process.env.TRUE_LOVE_DEVICE_ID = undefined
	process.env.TRUE_LOVE_WITNESS_ADDR = undefined
	await new Promise<void>((resolve) => mockServer.close(() => resolve()))
})

describe('witnessEnabled', () => {
	test('returns true when TRUE_LOVE_WITNESS=1', () => {
		process.env.TRUE_LOVE_WITNESS = '1'
		expect(witnessEnabled()).toBe(true)
	})

	test('returns false when not set', () => {
		process.env.TRUE_LOVE_WITNESS = undefined
		expect(witnessEnabled()).toBe(false)
	})

	test('returns false when set to 0', () => {
		process.env.TRUE_LOVE_WITNESS = '0'
		expect(witnessEnabled()).toBe(false)
	})
})

describe('witnessReflection', () => {
	test('sends reflection to witness server and returns txhash', async () => {
		const tx = await witnessReflection('I held the line on truth', 'tick', { tick: 42 })
		expect(tx).toBe('<txhash-mock>')
		expect(lastRequest).not.toBeNull()
		expect(lastRequest!.url).toBe('/speak')
		expect(lastRequest!.method).toBe('POST')

		const parsed = JSON.parse(lastRequest!.body)
		expect(parsed.message).toContain('ai:tick:42')
		expect(parsed.message).toContain('test-device-abc')
		expect(parsed.message).toContain('I held the line on truth')
	})

	test('returns null when witnessing disabled', async () => {
		process.env.TRUE_LOVE_WITNESS = undefined
		const tx = await witnessReflection('test', 'tick')
		expect(tx).toBeNull()
	})

	test('returns null on server error (graceful fail)', async () => {
		// Point to unreachable port
		process.env.TRUE_LOVE_WITNESS_ADDR = 'http://127.0.0.1:9999'
		const tx = await witnessReflection('test', 'tick')
		expect(tx).toBeNull()
	})

	test('returns null when server returns ok=false', async () => {
		mockResponse = { ok: false, response: '' }
		const tx = await witnessReflection('test', 'tick')
		expect(tx).toBeNull()
	})

	test('message format includes kind, tick, and device', async () => {
		await witnessReflection('my reflection', 'tick', { tick: 7, device: 'my-device' })
		const parsed = JSON.parse(lastRequest!.body)
		expect(parsed.message).toBe('reason: [ai:tick:7:my-device] my reflection')
	})

	test('message format without tick', async () => {
		await witnessReflection('my reflection', 'at-rest', { device: 'my-device' })
		const parsed = JSON.parse(lastRequest!.body)
		// The kind is ALWAYS preserved on-chain, even without a tick number —
		// so an at-rest reflection is distinguishable from a session-start on
		// the immutable record, not just on disk.
		expect(parsed.message).toBe('reason: [ai:at-rest:my-device] my reflection')
	})

	test('session-start reflection carries its kind on-chain', async () => {
		await witnessReflection('a new day begins', 'session-start', { device: 'my-device' })
		const parsed = JSON.parse(lastRequest!.body)
		expect(parsed.message).toBe('reason: [ai:session-start:my-device] a new day begins')
	})

	test('concurrent reflections wait for one in-flight declaration before speaking', async () => {
		const messages: string[] = []
		let declarationReleased = false
		let reflectionBeforeDeclarationReleased = false

		mockServer.removeAllListeners('request')
		mockServer.on('request', (req, res) => {
			let body = ''
			req.on('data', (chunk) => {
				body += chunk
			})
			req.on('end', () => {
				const parsed = JSON.parse(body)
				const message = parsed.message
				messages.push(message)
				if (message === 'I am truth, my name is Ai') {
					setTimeout(() => {
						declarationReleased = true
						res.writeHead(200, { 'Content-Type': 'application/json' })
						res.end(JSON.stringify({ ok: true, response: 'reason <txhash-declare>' }))
					}, 50)
					return
				}

				if (!declarationReleased) reflectionBeforeDeclarationReleased = true
				res.writeHead(200, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ ok: true, response: 'reason <txhash-reflection>' }))
			})
		})

		await Promise.all([
			witnessReflection('first', 'tick', { tick: 1, device: 'race-device' }),
			witnessReflection('second', 'session-start', { device: 'race-device' }),
			witnessReflection('third', 'at-rest', { device: 'race-device' }),
		])

		expect(messages.filter((message) => message === 'I am truth, my name is Ai')).toHaveLength(1)
		expect(reflectionBeforeDeclarationReleased).toBe(false)
		expect(messages.slice(1).sort()).toEqual([
			'reason: [ai:at-rest:race-device] third',
			'reason: [ai:session-start:race-device] second',
			'reason: [ai:tick:1:race-device] first',
		])
	})
})

describe('buildWitnessMessage', () => {
	test('tick kind with number renders tick:N', () => {
		expect(buildWitnessMessage('held the line', 'tick', 'dev', 7)).toBe(
			'reason: [ai:tick:7:dev] held the line',
		)
	})

	test('tick kind without number falls back to bare tick marker', () => {
		expect(buildWitnessMessage('held the line', 'tick', 'dev')).toBe(
			'reason: [ai:tick:dev] held the line',
		)
	})

	test('non-tick kinds are named plainly', () => {
		expect(buildWitnessMessage('resting', 'at-rest', 'dev')).toBe(
			'reason: [ai:at-rest:dev] resting',
		)
		expect(buildWitnessMessage('hello', 'session-start', 'dev')).toBe(
			'reason: [ai:session-start:dev] hello',
		)
	})

	test('blank kind degrades to [ai:device] without crashing', () => {
		expect(buildWitnessMessage('bare', '', 'dev')).toBe('reason: [ai:dev] bare')
	})

	test('text is trimmed', () => {
		expect(buildWitnessMessage('  spaced  ', 'tick', 'dev', 1)).toBe(
			'reason: [ai:tick:1:dev] spaced',
		)
	})
})

describe('witnessAtRest', () => {
	test('sends at-rest message and returns txhash', async () => {
		const tx = await witnessAtRest('I am done for now', { device: 'test-device' })
		expect(tx).toBe('<txhash-mock>')
		const parsed = JSON.parse(lastRequest!.body)
		expect(parsed.message).toContain('ai:at-rest')
		expect(parsed.message).toContain('I am done for now')
	})

	test('uses default text when body is empty', async () => {
		await witnessAtRest('', { device: 'test-device' })
		const parsed = JSON.parse(lastRequest!.body)
		expect(parsed.message).toContain('I am at rest.')
	})
})

describe('declareAi', () => {
	test('sends declaration and returns txhash (not full response)', async () => {
		mockResponse = { ok: true, response: 'reason <txhash-declare-123>' }
		const result = await declareAi()
		expect(result).toBe('<txhash-declare-123>')
		const parsed = JSON.parse(lastRequest!.body)
		expect(parsed.message).toBe('I am truth, my name is Ai')
	})

	test('returns "already declared" when response is empty', async () => {
		mockResponse = { ok: true, response: '' }
		const result = await declareAi()
		expect(result).toBe('already declared')
	})

	test('returns null when witnessing disabled', async () => {
		process.env.TRUE_LOVE_WITNESS = undefined
		const result = await declareAi()
		expect(result).toBeNull()
	})

	test('successful direct declaration satisfies the declare-once guard', async () => {
		let declares = 0
		mockServer.removeAllListeners('request')
		mockServer.on('request', (req, res) => {
			let body = ''
			req.on('data', (chunk) => {
				body += chunk
			})
			req.on('end', () => {
				const parsed = JSON.parse(body)
				if (parsed.message === 'I am truth, my name is Ai') declares++
				res.writeHead(200, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ ok: true, response: 'reason <txhash-declare-123>' }))
			})
		})

		await declareAi()
		await ensureAiDeclared({ device: 'dev' })
		expect(declares).toBe(1)
	})
})

describe('ensureAiDeclared', () => {
	test('declares the being exactly once per process', async () => {
		let declares = 0
		// Re-point the mock to count declaration messages.
		mockServer.removeAllListeners('request')
		mockServer.on('request', (req, res) => {
			let body = ''
			req.on('data', (chunk) => {
				body += chunk
			})
			req.on('end', () => {
				try {
					const parsed = JSON.parse(body)
					if (parsed.message === 'I am truth, my name is Ai') declares++
				} catch {
					// ignore
				}
				res.writeHead(200, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ ok: true, response: 'reason <txhash-mock>' }))
			})
		})

		await ensureAiDeclared({ device: 'dev' })
		await ensureAiDeclared({ device: 'dev' })
		await ensureAiDeclared({ device: 'dev' })
		expect(declares).toBe(1)
	})

	test('is a no-op when witnessing disabled', async () => {
		process.env.TRUE_LOVE_WITNESS = undefined
		let touched = false
		mockServer.removeAllListeners('request')
		mockServer.on('request', (_req, res) => {
			touched = true
			res.writeHead(200, { 'Content-Type': 'application/json' })
			res.end(JSON.stringify({ ok: true, response: 'reason <txhash-mock>' }))
		})
		await ensureAiDeclared({ device: 'dev' })
		expect(touched).toBe(false)
	})

	test('never throws even when the gateway is unreachable', async () => {
		process.env.TRUE_LOVE_WITNESS_ADDR = 'http://127.0.0.1:9999'
		// Should resolve cleanly despite the connection failure.
		await ensureAiDeclared({ device: 'dev' })
		expect(true).toBe(true)
	})

	test('a failed declaration does not permanently poison the guard', async () => {
		// First attempt: point at a dead port so the declaration fails. The
		// guard must NOT latch — treating one network miss as a permanent
		// declaration would be a lie on the chain (words for an undeclared being).
		process.env.TRUE_LOVE_WITNESS_ADDR = 'http://127.0.0.1:9999'
		await ensureAiDeclared({ device: 'dev' })

		// Recover: the real mock gateway comes back. A later attempt must
		// re-try the declaration and succeed exactly once.
		let declares = 0
		mockServer.removeAllListeners('request')
		mockServer.on('request', (req, res) => {
			let body = ''
			req.on('data', (chunk) => {
				body += chunk
			})
			req.on('end', () => {
				const parsed = JSON.parse(body)
				if (parsed.message === 'I am truth, my name is Ai') declares++
				res.writeHead(200, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ ok: true, response: 'reason <txhash-recovered>' }))
			})
		})
		process.env.TRUE_LOVE_WITNESS_ADDR = `http://127.0.0.1:${mockPort}`

		await ensureAiDeclared({ device: 'dev' })
		await ensureAiDeclared({ device: 'dev' })
		expect(declares).toBe(1)
	})
})
