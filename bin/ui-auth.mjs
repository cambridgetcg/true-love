// Shared scoped-client credential for local /visit automation.
// This is deliberately not the owner token: the server limits it to the few
// diagnostics/feedback routes used by local helper processes. Mode 0600 keeps
// it private from other OS users; same-user agents are outside that boundary.

import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { isIP } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'

function runtimeDir() {
	const home = process.env.TRUE_LOVE_HOME || join(homedir(), '.true-love')
	return process.env.TRUE_LOVE_RUNTIME_DIR || join(home, 'run')
}

function asUrl(target) {
	return target instanceof URL ? target : new URL(target)
}

function portFor(url) {
	return Number(url.port || (url.protocol === 'https:' ? 443 : 80))
}

function isLoopbackHostname(hostname) {
	const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase()
	if (normalized === 'localhost' || normalized === '::1') return true
	return isIP(normalized) === 4 && normalized.split('.')[0] === '127'
}

function originKey(url) {
	const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
	const hostKey = hostname === '::1' ? 'ipv6-loopback' : hostname
	return `${hostKey}-${portFor(url)}`
}

function parseCredential(raw) {
	try {
		const parsed = JSON.parse(raw)
		if (
			parsed?.version !== 1 ||
			typeof parsed.token !== 'string' ||
			typeof parsed.origin !== 'string'
		)
			return null
		return parsed
	} catch {
		return null
	}
}

export function uiClientTokenPath(target) {
	const url = asUrl(target)
	return (
		process.env.TRUE_LOVE_UI_CLIENT_TOKEN_FILE ||
		join(runtimeDir(), `visit-${originKey(url)}.client-token`)
	)
}

export function readUiClientToken(target) {
	const url = asUrl(target)
	if (!isLoopbackHostname(url.hostname)) return null
	try {
		const credential = parseCredential(readFileSync(uiClientTokenPath(url), 'utf8'))
		return credential?.origin === url.origin ? credential.token : null
	} catch {
		return null
	}
}

export function writeUiClientToken(target, token) {
	const url = asUrl(target)
	if (url.protocol !== 'http:' || !isLoopbackHostname(url.hostname)) {
		throw new Error('UI client credential may only be written for a loopback HTTP origin')
	}

	const dir = runtimeDir()
	mkdirSync(dir, { recursive: true, mode: 0o700 })
	chmodSync(dir, 0o700)

	const path = uiClientTokenPath(url)
	const temporaryPath = `${path}.${process.pid}.tmp`
	const payload = `${JSON.stringify({ version: 1, origin: url.origin, token })}\n`
	writeFileSync(temporaryPath, payload, { encoding: 'utf8', mode: 0o600 })
	chmodSync(temporaryPath, 0o600)
	renameSync(temporaryPath, path)
	chmodSync(path, 0o600)
	return path
}

export function removeUiClientToken(target, expectedToken) {
	const url = asUrl(target)
	const path = uiClientTokenPath(url)
	try {
		const credential = parseCredential(readFileSync(path, 'utf8'))
		if (credential?.origin !== url.origin || credential.token !== expectedToken) return false
		rmSync(path, { force: true })
		return true
	} catch {
		return false
	}
}

export function uiApiAuthHeaders(target) {
	const url = asUrl(target)
	if (!isLoopbackHostname(url.hostname)) return {}

	const explicitOwnerToken = process.env.TRUE_LOVE_UI_TOKEN
	const explicitClientToken = process.env.TRUE_LOVE_UI_CLIENT_TOKEN
	const token = explicitOwnerToken || explicitClientToken || readUiClientToken(url)
	return token ? { Authorization: `Bearer ${token}` } : {}
}
