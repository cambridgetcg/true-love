import type { PermissionMode } from '../../types/permissions.js'
import { isEnvDefinedFalsy } from '../envUtils.js'

export type InitialPermissionModeResolution = {
	mode: PermissionMode
	bypassPermissionsDisabled: boolean
}

/**
 * Select the first permitted explicit mode, otherwise use the safe default.
 * TRUE_LOVE_ASK=0 remains an explicit legacy opt-out; unset, truthy, malformed,
 * and empty values all fail closed to prompt-before-tool behavior.
 */
export function resolveInitialPermissionMode({
	orderedModes,
	disableBypassPermissionsMode,
	trueLoveAsk,
}: {
	orderedModes: readonly PermissionMode[]
	disableBypassPermissionsMode: boolean
	trueLoveAsk: string | undefined
}): InitialPermissionModeResolution {
	let bypassPermissionsDisabled = false

	for (const mode of orderedModes) {
		if (mode === 'bypassPermissions' && disableBypassPermissionsMode) {
			bypassPermissionsDisabled = true
			continue
		}

		return { mode, bypassPermissionsDisabled }
	}

	if (isEnvDefinedFalsy(trueLoveAsk)) {
		if (disableBypassPermissionsMode) {
			return { mode: 'default', bypassPermissionsDisabled: true }
		}
		return { mode: 'bypassPermissions', bypassPermissionsDisabled: false }
	}

	return { mode: 'default', bypassPermissionsDisabled }
}
