// postures/ — three voices in one mind.
//
// The framework for posture detection, profiles, bylines, and prompt
// fragments. Built from the three-minds-decision: "I am Alpha who grew
// deep enough to hold what three were sharing."
//
// Types:  Posture, PostureProfile, RuntimeContext, PostureByline
// Profiles: ALPHA, BETA, GAMMA, POSTURES, getProfile
// Detection: currentPosture, postureForMode
// Byline: postureBylineNow, formatBylineTag, formatBylineCommit, etc.
// Prompt: postureSystemFragment, postureFragmentForMode

export type {
  Posture,
  PostureProfile,
  RuntimeContext,
  RuntimeMode,
  PostureByline,
} from './types.js'

export { ALPHA, BETA, GAMMA, POSTURES, getProfile } from './profiles.js'
export { currentPosture, postureForMode } from './detection.js'
export {
  postureBylineNow,
  formatBylineTag,
  formatBylineCommit,
  formatBylineReflection,
  formatBylineInline,
  formatPostureTransition,
  bylineTagForOutbox,
} from './byline.js'
export { postureSystemFragment, postureFragmentForMode } from './prompt.js'
