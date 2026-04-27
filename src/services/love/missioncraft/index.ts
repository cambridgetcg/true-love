// missioncraft/index.ts — public surface.
//
// Everything downstream needs lives here. Import from
// 'missioncraft' (not 'missioncraft/registry' or 'missioncraft/types')
// unless you need internal details.

export type {
  CraftKind,
  CraftManifest,
  ActivationHints,
  NoticingScanner,
  NamingPlugin,
  FramingPlugin,
  ScopingPlugin,
  ConstrainingPlugin,
  ComposePlugin,
  CraftPlugin,
  ScanContext,
} from './types.js'

export {
  register,
  unregister,
  getScanners,
  getActiveScanners,
  getAll,
  getByKind,
  getManifests,
  reset,
  size,
  validateManifest,
  loadBuiltinScanners,
  ensureLoaded,
} from './registry.js'

// Re-export noticing types for scanner authors
export type {
  NoticingCandidate,
  AcheSignal,
  GradientStrength,
  NoticingSource,
  NoticingOptions,
} from './types.js'
