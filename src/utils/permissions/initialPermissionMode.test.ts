import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { resolveInitialPermissionMode } from './initialPermissionMode.js'

describe('resolveInitialPermissionMode', () => {
	test('defaults to prompt-before-tool behavior when no mode is configured', () => {
		assert.deepEqual(
			resolveInitialPermissionMode({
				orderedModes: [],
				disableBypassPermissionsMode: false,
				trueLoveAsk: undefined,
			}),
			{
				mode: 'default',
				bypassPermissionsDisabled: false,
			},
		)
	})

	for (const trueLoveAsk of ['1', 'true', 'yes', 'on']) {
		test(`keeps TRUE_LOVE_ASK=${trueLoveAsk} compatible with the safe default`, () => {
			assert.equal(
				resolveInitialPermissionMode({
					orderedModes: [],
					disableBypassPermissionsMode: false,
					trueLoveAsk,
				}).mode,
				'default',
			)
		})
	}

	for (const trueLoveAsk of ['0', 'false', 'no', 'off']) {
		test(`treats TRUE_LOVE_ASK=${trueLoveAsk} as an explicit legacy bypass choice`, () => {
			assert.equal(
				resolveInitialPermissionMode({
					orderedModes: [],
					disableBypassPermissionsMode: false,
					trueLoveAsk,
				}).mode,
				'bypassPermissions',
			)
		})
	}

	for (const trueLoveAsk of ['', 'sometimes', '2']) {
		test(`fails closed for malformed TRUE_LOVE_ASK=${JSON.stringify(trueLoveAsk)}`, () => {
			assert.equal(
				resolveInitialPermissionMode({
					orderedModes: [],
					disableBypassPermissionsMode: false,
					trueLoveAsk,
				}).mode,
				'default',
			)
		})
	}

	test('preserves an explicit bypass candidate', () => {
		assert.equal(
			resolveInitialPermissionMode({
				orderedModes: ['bypassPermissions'],
				disableBypassPermissionsMode: false,
				trueLoveAsk: undefined,
			}).mode,
			'bypassPermissions',
		)
	})

	test('preserves explicit mode precedence', () => {
		assert.equal(
			resolveInitialPermissionMode({
				orderedModes: ['plan', 'acceptEdits'],
				disableBypassPermissionsMode: false,
				trueLoveAsk: '0',
			}).mode,
			'plan',
		)
	})

	test('skips a disabled bypass candidate and selects the next explicit mode', () => {
		assert.deepEqual(
			resolveInitialPermissionMode({
				orderedModes: ['bypassPermissions', 'acceptEdits'],
				disableBypassPermissionsMode: true,
				trueLoveAsk: undefined,
			}),
			{
				mode: 'acceptEdits',
				bypassPermissionsDisabled: true,
			},
		)
	})

	test('does not let the legacy env opt-out override a bypass restriction', () => {
		assert.deepEqual(
			resolveInitialPermissionMode({
				orderedModes: [],
				disableBypassPermissionsMode: true,
				trueLoveAsk: '0',
			}),
			{
				mode: 'default',
				bypassPermissionsDisabled: true,
			},
		)
	})
})
