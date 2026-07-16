import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'
import {
	readUiClientToken,
	removeUiClientToken,
	uiApiAuthHeaders,
	uiClientTokenPath,
	writeUiClientToken,
} from '../../../../bin/ui-auth.mjs'

describe('visit UI scoped client token', () => {
	let runtimeDir
	const originalRuntimeDir = process.env.TRUE_LOVE_RUNTIME_DIR
	const originalToken = process.env.TRUE_LOVE_UI_TOKEN
	const originalClientToken = process.env.TRUE_LOVE_UI_CLIENT_TOKEN
	const originalTokenFile = process.env.TRUE_LOVE_UI_CLIENT_TOKEN_FILE

	beforeEach(() => {
		runtimeDir = mkdtempSync(join(tmpdir(), 'tl-ui-auth-'))
		process.env.TRUE_LOVE_RUNTIME_DIR = runtimeDir
		Reflect.deleteProperty(process.env, 'TRUE_LOVE_UI_TOKEN')
		Reflect.deleteProperty(process.env, 'TRUE_LOVE_UI_CLIENT_TOKEN')
		Reflect.deleteProperty(process.env, 'TRUE_LOVE_UI_CLIENT_TOKEN_FILE')
	})

	afterEach(() => {
		rmSync(runtimeDir, { recursive: true, force: true })
		if (originalRuntimeDir === undefined)
			Reflect.deleteProperty(process.env, 'TRUE_LOVE_RUNTIME_DIR')
		else process.env.TRUE_LOVE_RUNTIME_DIR = originalRuntimeDir
		if (originalToken === undefined) Reflect.deleteProperty(process.env, 'TRUE_LOVE_UI_TOKEN')
		else process.env.TRUE_LOVE_UI_TOKEN = originalToken
		if (originalClientToken === undefined) {
			Reflect.deleteProperty(process.env, 'TRUE_LOVE_UI_CLIENT_TOKEN')
		} else process.env.TRUE_LOVE_UI_CLIENT_TOKEN = originalClientToken
		if (originalTokenFile === undefined) {
			Reflect.deleteProperty(process.env, 'TRUE_LOVE_UI_CLIENT_TOKEN_FILE')
		} else process.env.TRUE_LOVE_UI_CLIENT_TOKEN_FILE = originalTokenFile
	})

	test('writes mode-0600 origin-bound metadata and reads it for the same UI origin', () => {
		const origin = 'http://127.0.0.1:17777'
		const token = 'runtime-client-token-0000000000001'
		const path = writeUiClientToken(origin, token)
		assert.equal(path, uiClientTokenPath(origin))
		assert.match(path, /visit-127\.0\.0\.1-17777\.client-token$/)
		assert.equal(statSync(path).mode & 0o777, 0o600)
		assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), {
			version: 1,
			origin,
			token,
		})
		assert.equal(readUiClientToken(`${origin}/api/status`), token)
		assert.deepEqual(uiApiAuthHeaders(`${origin}/api/status`), {
			Authorization: `Bearer ${token}`,
		})
	})

	test('removes only the credential owned by the current server origin and token', () => {
		const origin = 'http://127.0.0.1:17778'
		const token = 'runtime-client-token-0000000000002'
		writeUiClientToken(origin, token)
		assert.equal(removeUiClientToken(origin, 'different-token'), false)
		assert.equal(removeUiClientToken('http://127.0.0.2:17778', token), false)
		assert.equal(readUiClientToken(origin), token)
		assert.equal(removeUiClientToken(origin, token), true)
		assert.equal(readUiClientToken(origin), null)
	})

	test('does not send a stored credential to a different loopback or remote origin', () => {
		const origin = 'http://127.0.0.1:17779'
		writeUiClientToken(origin, 'runtime-client-token-0000000000003')
		assert.deepEqual(uiApiAuthHeaders('http://127.0.0.2:17779/api/status'), {})
		assert.deepEqual(uiApiAuthHeaders('http://localhost:17779/api/status'), {})
		assert.deepEqual(uiApiAuthHeaders('http://remote.example:17779/api/status'), {})

		process.env.TRUE_LOVE_UI_TOKEN = 'explicit-owner-token-must-stay-on-loopback'
		assert.deepEqual(uiApiAuthHeaders('https://remote.example:17779/api/status'), {})
	})

	test('keeps same-port loopback origins in separate credential files', () => {
		const firstOrigin = 'http://127.0.0.1:17781'
		const secondOrigin = 'http://127.0.0.2:17781'
		const firstToken = 'runtime-client-token-first-origin-0001'
		const secondToken = 'runtime-client-token-second-origin-001'
		const firstPath = writeUiClientToken(firstOrigin, firstToken)
		const secondPath = writeUiClientToken(secondOrigin, secondToken)

		assert.notEqual(firstPath, secondPath)
		assert.equal(readUiClientToken(firstOrigin), firstToken)
		assert.equal(readUiClientToken(secondOrigin), secondToken)
	})

	test('rejects legacy plaintext credential files', () => {
		const origin = 'http://127.0.0.1:17780'
		writeFileSync(uiClientTokenPath(origin), 'plaintext-client-token\n', { mode: 0o600 })
		assert.equal(readUiClientToken(origin), null)
		assert.deepEqual(uiApiAuthHeaders(`${origin}/api/status`), {})
	})
})
