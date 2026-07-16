import assert from 'node:assert/strict'
import { once } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { request } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'
import {
	type UiBrowserSessionState,
	createUiBrowserSessionState,
	startUiServer,
} from '../ui-server.js'

const OWNER_TOKEN = 'true-love-security-test-owner-token-01'
const CLIENT_TOKEN = 'true-love-security-test-client-token-01'
const PROOF_HEADER = 'X-True-Love-Browser-Proof'
const PROOF_QUERY = '__true_love_browser_proof'

interface BrowserPair {
	cookie: string
	proof: string
}

describe('ui-server — owner boundary', () => {
	let tmpHome: string
	let server: ReturnType<typeof startUiServer>
	let port: number
	let baseUrl: string
	let fromYuPath: string
	const originalHome = process.env.HOME
	const originalFromYu = process.env.TRUE_LOVE_FROM_YU_PATH
	const originalFromAi = process.env.TRUE_LOVE_FROM_AI_PATH
	const originalDisableSoul = process.env.TRUE_LOVE_DISABLE_SOUL
	const originalUiHost = process.env.TRUE_LOVE_UI_HOST

	async function startServer(
		options: { port?: number; browserSession?: UiBrowserSessionState } = {},
	): Promise<void> {
		server = startUiServer({
			port: options.port ?? 0,
			ownerToken: OWNER_TOKEN,
			clientToken: CLIENT_TOKEN,
			browserSession: options.browserSession,
		})
		if (!server.listening) await once(server, 'listening')
		port = (server.address() as AddressInfo).port
		baseUrl = `http://127.0.0.1:${port}`
	}

	async function closeServer(): Promise<void> {
		if (!server?.listening) return
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()))
		})
	}

	async function bootstrap(
		token = OWNER_TOKEN,
		origin = baseUrl,
	): Promise<{
		response: Response
		pair: BrowserPair | null
	}> {
		const response = await fetch(`${baseUrl}/_bootstrap`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${token}`,
				Origin: origin,
			},
		})
		if (!response.ok) return { response, pair: null }
		const body = (await response.json()) as { proof?: unknown }
		const setCookie = response.headers.get('set-cookie') || ''
		return {
			response,
			pair: {
				cookie: setCookie.split(';', 1)[0] || '',
				proof: typeof body.proof === 'string' ? body.proof : '',
			},
		}
	}

	function browserHeaders(pair: BrowserPair, includeOrigin = false): Record<string, string> {
		return {
			Cookie: pair.cookie,
			[PROOF_HEADER]: pair.proof,
			...(includeOrigin ? { Origin: baseUrl } : {}),
		}
	}

	beforeEach(async () => {
		tmpHome = mkdtempSync(join(tmpdir(), 'tl-ui-security-'))
		mkdirSync(join(tmpHome, '.true-love'), { recursive: true })
		fromYuPath = join(tmpHome, '.true-love', 'from-yu.md')
		process.env.HOME = tmpHome
		process.env.TRUE_LOVE_FROM_YU_PATH = fromYuPath
		process.env.TRUE_LOVE_FROM_AI_PATH = join(tmpHome, '.true-love', 'from-ai.md')
		process.env.TRUE_LOVE_DISABLE_SOUL = '1'
		Reflect.deleteProperty(process.env, 'TRUE_LOVE_UI_HOST')
		await startServer()
	})

	afterEach(async () => {
		await closeServer()
		rmSync(tmpHome, { recursive: true, force: true })
		if (originalHome === undefined) Reflect.deleteProperty(process.env, 'HOME')
		else process.env.HOME = originalHome
		if (originalFromYu === undefined) Reflect.deleteProperty(process.env, 'TRUE_LOVE_FROM_YU_PATH')
		else process.env.TRUE_LOVE_FROM_YU_PATH = originalFromYu
		if (originalFromAi === undefined) Reflect.deleteProperty(process.env, 'TRUE_LOVE_FROM_AI_PATH')
		else process.env.TRUE_LOVE_FROM_AI_PATH = originalFromAi
		if (originalDisableSoul === undefined)
			Reflect.deleteProperty(process.env, 'TRUE_LOVE_DISABLE_SOUL')
		else process.env.TRUE_LOVE_DISABLE_SOUL = originalDisableSoul
		if (originalUiHost === undefined) Reflect.deleteProperty(process.env, 'TRUE_LOVE_UI_HOST')
		else process.env.TRUE_LOVE_UI_HOST = originalUiHost
	})

	test('binds to IPv4 loopback by default', () => {
		const address = server.address() as AddressInfo
		assert.equal(address.address, '127.0.0.1')
		assert.equal(address.family, 'IPv4')
	})

	test('refuses remote binding and weak or colliding credentials', () => {
		assert.throws(
			() => startUiServer({ port: 0, host: '0.0.0.0', ownerToken: OWNER_TOKEN }),
			/only supports loopback/,
		)
		assert.throws(
			() => startUiServer({ port: 0, ownerToken: 'too-short' }),
			/at least 32 characters/,
		)
		assert.throws(
			() => startUiServer({ port: 0, ownerToken: OWNER_TOKEN, clientToken: 'too-short' }),
			/client token must be at least 32 characters/,
		)
		assert.throws(
			() => startUiServer({ port: 0, ownerToken: OWNER_TOKEN, clientToken: OWNER_TOKEN }),
			/client token must be distinct from owner credentials/,
		)
		assert.throws(
			() =>
				startUiServer({
					port: 0,
					ownerToken: OWNER_TOKEN,
					browserSession: { cookie: OWNER_TOKEN, proof: CLIENT_TOKEN, active: false },
				}),
			/browser credentials must be distinct/,
		)
		assert.throws(
			() =>
				startUiServer({
					port: 0,
					ownerToken: OWNER_TOKEN,
					browserSession: { cookie: 'too-short', proof: CLIENT_TOKEN, active: false },
				}),
			/browser credentials must be at least 32 characters/,
		)
		assert.throws(
			() => startUiServer({ port: 0, host: '127.0.0.1:7777', ownerToken: OWNER_TOKEN }),
			/invalid UI host/,
		)
		assert.throws(
			() => startUiServer({ port: 0, host: '[::1]', ownerToken: OWNER_TOKEN }),
			/invalid UI host/,
		)
	})

	test('exposes only a token-free bootstrap shell before authentication', async () => {
		const bootstrapShell = await fetch(
			`${baseUrl}/_bootstrap?token=${encodeURIComponent(OWNER_TOKEN)}`,
		)
		assert.equal(bootstrapShell.status, 200)
		assert.equal(bootstrapShell.headers.get('set-cookie'), null)
		assert.doesNotMatch(await bootstrapShell.text(), new RegExp(OWNER_TOKEN))

		const bootstrapScript = await fetch(`${baseUrl}/auth-bootstrap.js`)
		assert.equal(bootstrapScript.status, 200)

		const root = await fetch(`${baseUrl}/`)
		assert.equal(root.status, 401)
		const status = await fetch(`${baseUrl}/api/status`)
		assert.equal(status.status, 401)

		const say = await fetch(`${baseUrl}/api/say`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ text: 'must not persist' }),
		})
		assert.equal(say.status, 401)
		assert.equal(existsSync(fromYuPath), false)
	})

	test('requires a same-origin owner-bearer POST to activate browser credentials', async () => {
		const missingOrigin = await fetch(`${baseUrl}/_bootstrap`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${OWNER_TOKEN}` },
		})
		assert.equal(missingOrigin.status, 403)

		const wrongOrigin = await bootstrap(OWNER_TOKEN, 'https://evil.example')
		assert.equal(wrongOrigin.response.status, 403)
		assert.equal(wrongOrigin.response.headers.get('set-cookie'), null)

		const wrongToken = await bootstrap('wrong-but-long-enough-owner-token-0001')
		assert.equal(wrongToken.response.status, 401)
		assert.equal(wrongToken.response.headers.get('set-cookie'), null)

		const valid = await bootstrap()
		assert.equal(valid.response.status, 200)
		assert.ok(valid.pair)
		assert.ok(valid.pair.proof.length >= 32)
		const setCookie = valid.response.headers.get('set-cookie') || ''
		assert.match(setCookie, /^true_love_owner=[^;]+;/)
		assert.match(setCookie, /HttpOnly/i)
		assert.match(setCookie, /SameSite=Strict/i)
		assert.match(setCookie, /Path=\//i)
		assert.doesNotMatch(setCookie, new RegExp(OWNER_TOKEN))
		assert.notEqual(valid.pair.proof, OWNER_TOKEN)

		const root = await fetch(`${baseUrl}/`, { headers: { Cookie: valid.pair.cookie } })
		assert.equal(root.status, 200)
		assert.match(root.headers.get('content-type') || '', /text\/html/)
	})

	test('rejects cookie replay, proof-only requests, and mismatched pairs', async () => {
		const { pair } = await bootstrap()
		assert.ok(pair)

		const cookieOnlyStatus = await fetch(`${baseUrl}/api/status`, {
			headers: { Cookie: pair.cookie },
		})
		assert.equal(cookieOnlyStatus.status, 401)

		const cookieOnlySay = await fetch(`${baseUrl}/api/say`, {
			method: 'POST',
			headers: {
				Cookie: pair.cookie,
				Origin: baseUrl,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ text: 'cross-port cookie replay' }),
		})
		assert.equal(cookieOnlySay.status, 401)
		assert.equal(existsSync(fromYuPath), false)

		const cookieOnlyStream = await fetch(`${baseUrl}/api/stream`, {
			headers: { Cookie: pair.cookie },
		})
		assert.equal(cookieOnlyStream.status, 401)

		const proofOnly = await fetch(`${baseUrl}/api/status`, {
			headers: { [PROOF_HEADER]: pair.proof },
		})
		assert.equal(proofOnly.status, 401)

		const wrongProof = await fetch(`${baseUrl}/api/status`, {
			headers: { Cookie: pair.cookie, [PROOF_HEADER]: `${pair.proof}-tampered` },
		})
		assert.equal(wrongProof.status, 401)

		const rawOwnerCookie = await fetch(`${baseUrl}/api/status`, {
			headers: { Cookie: `true_love_owner=${OWNER_TOKEN}`, [PROOF_HEADER]: pair.proof },
		})
		assert.equal(rawOwnerCookie.status, 401)
	})

	test('rejects DNS rebinding and cross-origin requests even with valid owner bearer', async () => {
		const rawStatus = await new Promise<number>((resolve, reject) => {
			const req = request(
				{
					host: '127.0.0.1',
					port,
					path: '/api/status',
					headers: { Host: 'evil.example', Authorization: `Bearer ${OWNER_TOKEN}` },
				},
				(response) => {
					response.resume()
					resolve(response.statusCode || 0)
				},
			)
			req.on('error', reject)
			req.end()
		})
		assert.equal(rawStatus, 421)

		for (const origin of ['https://evil.example', `https://127.0.0.1:${port}`]) {
			const response = await fetch(`${baseUrl}/api/status`, {
				headers: { Authorization: `Bearer ${OWNER_TOKEN}`, Origin: origin },
			})
			assert.equal(response.status, 403)
		}

		const fetchMetadataCrossSite = await fetch(`${baseUrl}/api/status`, {
			headers: {
				Authorization: `Bearer ${OWNER_TOKEN}`,
				'Sec-Fetch-Site': 'cross-site',
			},
		})
		assert.equal(fetchMetadataCrossSite.status, 403)
	})

	test('rejects non-JSON browser mutations before handlers run', async () => {
		const { pair } = await bootstrap()
		assert.ok(pair)
		const response = await fetch(`${baseUrl}/api/say`, {
			method: 'POST',
			headers: {
				...browserHeaders(pair, true),
				'Content-Type': 'text/plain',
			},
			body: JSON.stringify({ text: 'must not persist' }),
		})
		assert.equal(response.status, 415)
		assert.equal(existsSync(fromYuPath), false)
	})

	test('limits the runtime client credential to helper routes', async () => {
		const deniedStatus = await fetch(`${baseUrl}/api/status`, {
			headers: { Authorization: `Bearer ${CLIENT_TOKEN}` },
		})
		assert.equal(deniedStatus.status, 403)

		const deniedSay = await fetch(`${baseUrl}/api/say`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${CLIENT_TOKEN}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ text: 'client must not impersonate owner' }),
		})
		assert.equal(deniedSay.status, 403)
		assert.equal(existsSync(fromYuPath), false)

		const allowedDiagnostic = await fetch(`${baseUrl}/api/self-initiation`, {
			headers: { Authorization: `Bearer ${CLIENT_TOKEN}` },
		})
		assert.equal(allowedDiagnostic.status, 400)

		const allowedDecisionPost = await fetch(`${baseUrl}/api/decisions`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${CLIENT_TOKEN}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ projectId: 'missing-project', kind: 'concern', ask: 'test' }),
		})
		assert.equal(allowedDecisionPost.status, 404)
	})

	test('accepts browser proof headers for APIs and proof queries only for exact SSE routes', async () => {
		const { pair } = await bootstrap()
		assert.ok(pair)

		const status = await fetch(`${baseUrl}/api/status`, { headers: browserHeaders(pair) })
		assert.equal(status.status, 200)

		const say = await fetch(`${baseUrl}/api/say`, {
			method: 'POST',
			headers: {
				...browserHeaders(pair, true),
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ text: 'owner message' }),
		})
		assert.equal(say.status, 200)
		assert.equal(existsSync(fromYuPath), true)

		for (const path of [
			'/api/stream',
			'/api/build/stream',
			'/api/eros/stream',
			'/api/feedback/stream',
		]) {
			const stream = await fetch(
				`${baseUrl}${path}?${PROOF_QUERY}=${encodeURIComponent(pair.proof)}`,
				{ headers: { Cookie: pair.cookie } },
			)
			assert.equal(stream.status, 200, path)
			assert.match(stream.headers.get('content-type') || '', /text\/event-stream/, path)
			await stream.body?.cancel()
		}

		const queryOnStatus = await fetch(
			`${baseUrl}/api/status?${PROOF_QUERY}=${encodeURIComponent(pair.proof)}`,
			{ headers: { Cookie: pair.cookie } },
		)
		assert.equal(queryOnStatus.status, 401)

		const queryOnMutation = await fetch(
			`${baseUrl}/api/say?${PROOF_QUERY}=${encodeURIComponent(pair.proof)}`,
			{
				method: 'POST',
				headers: {
					Cookie: pair.cookie,
					Origin: baseUrl,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ text: 'query proof must not mutate' }),
			},
		)
		assert.equal(queryOnMutation.status, 401)
	})

	test('logout revokes the pair, closes streams, and rotates credentials', async () => {
		const first = await bootstrap()
		assert.ok(first.pair)
		const stream = await fetch(
			`${baseUrl}/api/stream?${PROOF_QUERY}=${encodeURIComponent(first.pair.proof)}`,
			{ headers: { Cookie: first.pair.cookie } },
		)
		const reader = stream.body!.getReader()
		await reader.read()

		const logout = await fetch(`${baseUrl}/_logout`, {
			method: 'POST',
			headers: browserHeaders(first.pair, true),
		})
		assert.equal(logout.status, 204)
		assert.match(logout.headers.get('set-cookie') || '', /Max-Age=0/i)
		const ended = await Promise.race([
			reader.read().then(({ done }) => done),
			new Promise<false>((resolve) => setTimeout(() => resolve(false), 1000)),
		])
		assert.equal(ended, true)

		const replay = await fetch(`${baseUrl}/api/status`, {
			headers: browserHeaders(first.pair),
		})
		assert.equal(replay.status, 401)

		const second = await bootstrap()
		assert.ok(second.pair)
		assert.notEqual(second.pair.cookie, first.pair.cookie)
		assert.notEqual(second.pair.proof, first.pair.proof)
		const current = await fetch(`${baseUrl}/api/status`, {
			headers: browserHeaders(second.pair),
		})
		assert.equal(current.status, 200)
	})

	test('shared browser state survives a soft restart and a fresh state invalidates it', async () => {
		await closeServer()
		const shared = createUiBrowserSessionState()
		await startServer({ port, browserSession: shared })
		const active = await bootstrap()
		assert.ok(active.pair)
		const restartPort = port

		await closeServer()
		await startServer({ port: restartPort, browserSession: shared })
		const afterSoftRestart = await fetch(`${baseUrl}/api/status`, {
			headers: browserHeaders(active.pair),
		})
		assert.equal(afterSoftRestart.status, 200)

		await closeServer()
		await startServer({ port: restartPort, browserSession: createUiBrowserSessionState() })
		const afterFreshState = await fetch(`${baseUrl}/api/status`, {
			headers: browserHeaders(active.pair),
		})
		assert.equal(afterFreshState.status, 401)
	})

	test('serves a strict CSP and loads auth.js before every application script', async () => {
		for (const path of ['/', '/build', '/eros', '/feedback', '/family']) {
			const response = await fetch(`${baseUrl}${path}`, {
				headers: { Authorization: `Bearer ${OWNER_TOKEN}` },
			})
			assert.equal(response.status, 200, path)
			const csp = response.headers.get('content-security-policy') || ''
			assert.match(csp, /default-src 'self'/)
			assert.match(csp, /connect-src 'self'/)
			assert.match(csp, /object-src 'none'/)
			assert.match(csp, /base-uri 'none'/)
			assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/)
			const html = await response.text()
			const authIndex = html.indexOf('src="/auth.js"')
			assert.ok(authIndex >= 0, `${path} is missing auth.js`)
			const executableScripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)]
			assert.equal(executableScripts[0]?.[1], '/auth.js', path)
		}

		const visitSource = readFileSync(join(import.meta.dirname, '../../../../bin/visit.mjs'), 'utf8')
		assert.match(visitSource, /\/_bootstrap#token=/)
		assert.doesNotMatch(visitSource, /\/_bootstrap\?token=/)
	})
})
