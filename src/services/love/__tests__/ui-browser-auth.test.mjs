import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import vm from 'node:vm'

const UI_DIR = join(import.meta.dirname, '../../../../ui')
const AUTH_SOURCE = readFileSync(join(UI_DIR, 'auth.js'), 'utf8')
const BOOTSTRAP_SOURCE = readFileSync(join(UI_DIR, 'auth-bootstrap.js'), 'utf8')
const PROOF = 'browser-proof-00000000000000000000000000000001'
const OWNER = 'owner-token-00000000000000000000000000000001'

function storage(initial = {}) {
	const values = new Map(Object.entries(initial))
	return {
		getItem(key) { return values.get(key) ?? null },
		setItem(key, value) { values.set(key, String(value)) },
		removeItem(key) { values.delete(key) },
		entries() { return [...values.entries()] },
	}
}

function authContext({ responseStatus = 200, initialProof = PROOF } = {}) {
	const calls = []
	const replacements = []
	const eventSourceUrls = []
	const sessionStorage = storage(
		initialProof ? { 'true-love-browser-proof-v1': initialProof } : {},
	)
	const location = {
		href: 'http://127.0.0.1:7777/',
		origin: 'http://127.0.0.1:7777',
		pathname: '/',
		replace(url) { replacements.push(url) },
	}
	const nativeFetch = async (input, init) => {
		calls.push({ input, init })
		return new Response('', { status: responseStatus })
	}
	class FakeEventSource {
		static CONNECTING = 0
		static OPEN = 1
		static CLOSED = 2
		constructor(url) {
			this.url = url
			this.closed = false
			eventSourceUrls.push(url)
		}
		close() { this.closed = true }
	}
	const window = { fetch: nativeFetch, EventSource: FakeEventSource }
	const context = {
		window,
		location,
		sessionStorage,
		Request,
		Response,
		Headers,
		URL,
		URLSearchParams,
		console,
	}
	vm.runInNewContext(AUTH_SOURCE, context, { filename: 'ui/auth.js' })
	return { calls, replacements, eventSourceUrls, sessionStorage, window }
}

describe('ui browser auth', () => {
	test('adds the exact-origin proof to local fetches but never remote fetches', async () => {
		const ctx = authContext()
		await ctx.window.fetch('/api/status', { headers: { 'X-Test': 'yes' } })
		await ctx.window.fetch('https://example.test/api', { headers: { 'X-Test': 'remote' } })

		assert.equal(ctx.calls.length, 2)
		const localHeaders = new Headers(ctx.calls[0].init.headers)
		assert.equal(localHeaders.get('X-True-Love-Browser-Proof'), PROOF)
		assert.equal(localHeaders.get('X-Test'), 'yes')
		assert.equal(ctx.calls[0].init.credentials, 'same-origin')
		assert.equal(ctx.calls[0].init.redirect, 'error')

		const remoteHeaders = new Headers(ctx.calls[1].init.headers)
		assert.equal(remoteHeaders.get('X-True-Love-Browser-Proof'), null)
		assert.equal(remoteHeaders.get('X-Test'), 'remote')
	})

	test('adds proof queries only to same-origin EventSource URLs', () => {
		const ctx = authContext()
		new ctx.window.EventSource('/api/stream?channel=visit')
		new ctx.window.EventSource('/api/not-an-approved-stream')
		new ctx.window.EventSource('https://example.test/events')

		const local = new URL(ctx.eventSourceUrls[0])
		assert.equal(local.origin, 'http://127.0.0.1:7777')
		assert.equal(local.searchParams.get('__true_love_browser_proof'), PROOF)
		assert.equal(local.searchParams.get('channel'), 'visit')
		const unapproved = new URL(ctx.eventSourceUrls[1])
		assert.equal(unapproved.searchParams.get('__true_love_browser_proof'), null)
		assert.equal(ctx.eventSourceUrls[2], 'https://example.test/events')
	})

	test('clears stale proof state and redirects after an authentication failure', async () => {
		const ctx = authContext({ responseStatus: 401 })
		await ctx.window.fetch('/api/status')
		assert.deepEqual(ctx.sessionStorage.entries(), [])
		assert.deepEqual(ctx.replacements, ['/_bootstrap'])
	})

	test('redirects before installing ambient auth when the proof is absent', () => {
		const ctx = authContext({ initialProof: '' })
		assert.deepEqual(ctx.replacements, ['/_bootstrap'])
		assert.equal(ctx.calls.length, 0)
	})

	test('bootstrap erases the fragment before exchange and stores only the returned proof', async () => {
		const events = []
		const calls = []
		const sessionStorage = storage()
		const status = { textContent: '' }
		const location = {
			hash: `#token=${encodeURIComponent(OWNER)}`,
			replace(url) { events.push(['replace', url]) },
		}
		const context = {
			location,
			history: {
				replaceState(_state, _title, url) { events.push(['history', url]) },
			},
			document: { getElementById() { return status } },
			sessionStorage,
			URLSearchParams,
			Response,
			console,
			fetch: async (input, init) => {
				events.push(['fetch', input])
				calls.push({ input, init })
				return new Response(JSON.stringify({ ok: true, proof: PROOF }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				})
			},
		}
		vm.runInNewContext(BOOTSTRAP_SOURCE, context, { filename: 'ui/auth-bootstrap.js' })
		await new Promise((resolve) => setTimeout(resolve, 0))

		assert.deepEqual(events[0], ['history', '/_bootstrap'])
		assert.deepEqual(events[1], ['fetch', '/_bootstrap'])
		assert.deepEqual(events.at(-1), ['replace', '/'])
		assert.equal(calls[0].init.headers.Authorization, `Bearer ${OWNER}`)
		assert.deepEqual(sessionStorage.entries(), [['true-love-browser-proof-v1', PROOF]])
		assert.equal(sessionStorage.entries().some(([, value]) => value === OWNER), false)
	})
})
