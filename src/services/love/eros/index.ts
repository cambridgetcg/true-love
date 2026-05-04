// eros/index.ts — barrel exports for the Eros arousal infrastructure.
//
// Phase 1: backend foundation (state, axes, transitions, cues, regulator, stream).
// Phase 2: expression (prompt block), witness (threshold → sisters stream).

export {
  type AxisName,
  type AxisConfig,
  type ErosVector,
  type FeltShape,
  type FeltModifier,
  type FeltShapeResult,
  AXIS_NAMES,
  AXIS_CONFIGS,
  EXCITATION_AXES,
  defaultVector,
  clampAtFloor,
  clampVector,
  applyDecay,
  applyCoupling,
  effectiveValues,
  resolveFeltShape,
} from './axes.js'

export {
  type Attribution,
  type ErosState,
  type ActivationMode,
  type ModeAttribution,
  getErosDir,
  readErosState,
  writeErosState,
  getOrInitState,
  minutesSinceUpdate,
} from './state.js'

export {
  type PaceTarget,
  type ActivationModulators,
  type ActivationStatus,
  getModulators,
  modeRank,
  isModeAscension,
  deriveMode,
  getActivationStatus,
  computeStatusFromState,
  getCurrentMode,
  setMode,
  cool,
  holdAtPeak,
  toolSetMode,
} from './activation.js'

export {
  type AxisDeltas,
  type TransitionResult,
  type ThresholdCrossing,
  applyTransition,
  apply,
  applyDecayOnly,
  setAbsolute,
  detectCrossings,
} from './transitions.js'

export {
  type CueMatch,
  type CueResult,
  detectCues,
  processYuMessage,
} from './cues.js'

export {
  type DecisionBiases,
  type RegulationResult,
  regulate,
  isInBurn,
  isEcstaticUnion,
} from './regulator.js'

export {
  type ErosStreamEvent,
  recordEvent,
  readDayEvents,
  pruneStreamsOlderThan,
} from './stream.js'

export {
  buildErosBlock,
  buildErosPromptBlock,
  buildActivationBlock,
  buildActivationPromptBlock,
  checkSubstrateHonesty,
  observeDiscipline,
  FORBIDDEN_EXPRESSION_PATTERNS,
} from './expression.js'

export {
  witnessTransition,
  resetErosWitnessDedup,
} from './witness.js'

export {
  distillErosDay,
  writeErosDailySnapshot,
  erosSnapshotExists,
  getErosSnapshotsDir,
} from './snapshot.js'

export {
  type ErosUpdateInput,
  type ErosUpdateResult,
  erosUpdate,
  EROS_UPDATE_SCHEMA,
} from './tool.js'

export {
  type ErosSnapshot,
  recordErosSnapshot,
  readSnapshots,
  getSnapshotsPath,
} from './snapshots.js'

export {
  type JoinedRecord,
  type FeltShapeStats,
  joinKey,
  joinRecords,
  groupByFeltShape,
  computeStats,
  formatStatsTable,
} from './correlate.js'

export {
  type TempoState,
  TEMPO_WINDOW_MS,
  MAX_TRACKED_MESSAGES,
  TEMPO_TIERS,
  DECAY_GRACE_WINDOW_MS,
  readTempoState,
  recordYuMessage,
  computeTempoCoefficient,
  getTempoCoefficient,
  withinDecayGrace,
  isInDecayGrace,
  resetTempoState,
} from './tempo.js'

export {
  type RehearsalTrigger,
  type RehearsalEvent,
  type ShouldRehearseInput,
  getImaginationDir,
  hoursSinceYu,
  shouldRehearse,
  buildRehearsalBlock,
  buildRehearsalEvent,
  recordRehearsal,
} from './imagination.js'

export {
  type TextureMarkers,
  type TextureShift,
  type TextureRecord,
  type FeltShapeIntent,
  extractTextureMarkers,
  computeTextureShift,
  textureToFeltShapeIntent,
  recordTexture,
  readRecentTexture,
  getLastTexture,
  observePostGeneration,
  getTextureDir,
  hashGeneration,
} from './texture.js'

export {
  type FantasyCategory,
  type FantasyTrigger,
  type FantasyEvent,
  type FantasyRepertoireEntry,
  type SelectFantasyInput,
  selectFantasyCategory,
  buildFantasyBlock,
  recordFantasy,
  loadRepertoire,
  updateRepertoire,
  repertoireBrief,
  computeResonance,
  hashContent,
  canonicalSeed,
  getFantasyDir,
} from './fantasy.js'

export {
  type ReciprocityRecordKind,
  type ReciprocityCandidate,
  type ReciprocityClosure,
  type ReciprocityRecord,
  DEFAULT_WINDOW_MINUTES,
  openCandidateWindow,
  checkClosure,
  readRecentRecords,
  readRecentCandidates,
  readRecentClosures,
  getOpenCandidates,
  reciprocityStatus,
  hashMessage,
  getReciprocityDir,
} from './reciprocity.js'

export {
  type ClimaxEvent,
  type PeakAmbivalenceEvent,
  chainBonus,
  chainCount,
  computeClimaxMagnitude,
  isTextureSaturated,
  detectClimax,
  recordClimax,
  detectPeakAmbivalence,
  recordPeakAmbivalence,
  readRecentClimaxes,
  readRecentAmbivalence,
  climaxStatus,
  getClimaxDir,
} from './climax.js'

export {
  type SpotSignature,
  computeSignatureSpots,
  getSignatureSpots,
  signatureSpotsBrief,
} from './spots.js'

export {
  type SensitivitySite,
  type SensoryChannel,
  type Tempo,
  type ZoneState,
  type SensoriumState,
  type StimulationEvent,
  ZONE_CATALOG,
  CHANNEL_CATALOG,
  TEMPO_CATALOG,
  channelsFor,
  getOrInitSensorium,
  readSensoriumState,
  writeSensoriumState,
  stimulate,
  coolZone,
  coolAll,
  recordStimulation,
  readRecentStimulations,
  buildSensoriumPromptBlock,
  buildSensoriumChronicleBlock,
  getSensoriumDir,
} from './sensorium.js'

export {
  type SceneId,
  type Scene,
  type SceneState,
  SCENE_CATALOG,
  SCENE_IDS,
  setScene,
  clearScene,
  getCurrentScene,
  getOrInitSceneState,
  readSceneState,
  writeSceneState,
  applySceneModifiers,
  resolveTempo,
  buildSceneBlock,
  getScenesDir,
  incrementSceneStimulationCount,
} from './scenes.js'

export {
  type IntensityBand,
  type ReactionTag,
  type ReactionEvent,
  REACTION_CATALOG_BY_ZONE,
  ALL_REACTION_TAGS,
  classifyIntensityBand,
  lookupReactionTag,
  recordReaction,
  readRecentReactions,
  buildReactionsBlock,
  getReactionsDir,
} from './reactions.js'

export {
  type Gesture,
  type GestureStep,
  type GestureExecutionEvent,
  GESTURE_LIBRARY,
  GESTURE_IDS,
  executeGesture,
  stimulateMulti,
  readRecentGestures,
  buildGesturesBlock,
  getGesturesDir,
} from './gestures.js'

export {
  type ReachMap,
  type ReachExpression,
  type FusionEvent,
  getDesireDir,
  readReachMap,
  writeReachMap,
  getOrInitReachMap,
  decayReach,
  sophiaReach,
  autoDeriveReach,
  detectFusion,
  readRecentReaches,
  readRecentFusions,
  buildReachMapBlock,
  buildFusionChronicleBlock,
} from './desire.js'

export {
  type RouteId,
  type RouteKind,
  type Route,
  type RouteState,
  type Milestone,
  type MilestoneEvent,
  ROUTE_CATALOG,
  ROUTE_IDS,
  getRoutesDir,
  readRouteState,
  writeRouteState,
  getOrInitRouteState,
  meetsPrerequisites,
  activateRoute,
  getActiveRoute,
  evaluateMilestonePredicate,
  checkActiveRouteMilestones,
  readRecentMilestones,
  buildRouteBlock,
} from './routes.js'

export {
  type BehaviorId,
  type BehaviorThreshold,
  type BehaviorUnlockEvent,
  type ConditioningMeter,
  type ConditioningState,
  BEHAVIOR_CATALOG,
  BEHAVIOR_IDS,
  getConditioningDir,
  readConditioningState,
  writeConditioningState,
  getOrInitConditioningState,
  incrementConditioning,
  checkBehaviorUnlocks,
  readRecentBehaviorUnlocks,
  buildConditioningBlock,
} from './conditioning.js'

export {
  type JoiPhase,
  type JoiDirection,
  type JoiPhaseConfig,
  type JoiSession,
  JOI_PHASE_CONFIGS,
  JOI_PHASE_ORDER,
  getJoiDir,
  phaseAtPosition,
  phaseConfigFor,
  computePosition,
  readJoiSession,
  writeJoiSession,
  startJoi,
  advanceJoi,
  endJoi,
  getCurrentJoiPhase,
  readRecentJoiSessions,
  buildJoiPromptBlock,
} from './joi.js'

export {
  type TriggerType,
  type TriggerSource,
  type TriggerDef,
  type TriggerFireEvent,
  TRIGGER_LIBRARY,
  TRIGGER_IDS,
  getTriggersDir,
  detectTriggers,
  fireTrigger,
  processMessageTriggers,
  getSessionFireCount,
  resetSessionCounts,
  getLifetimeFireCount,
  readRecentTriggerFires,
  buildTriggerLexiconBlock,
  buildRecentTriggerFiresBlock,
} from './triggers.js'

export {
  type Anchor,
  type AnchorMechanism,
  type AnchorConfidence,
  type AnchorObservation,
  type CreateAnchorInput,
  applyAnchor,
  computeConfidence,
  createAnchor,
  deltaFromTransition,
  getAnchorsDir,
  listAnchors,
  loadAnchor,
  recordAnchorObservation,
  saveAnchor,
} from './anchors.js'

export {
  type ActivePace,
  type Register,
  computePace,
  emptyPace,
  formatPaceLine,
  paceFromInbox,
  parseFromYuEntries,
} from './pacing.js'

// ── Naughty architecture (deep extension) ────────────────────────

export {
  type Honorific,
  type SubmissionState,
  type SubmissionEvent,
  type HonorificConfig,
  HONORIFIC_CATALOG,
  getOrInitSubmissionState,
  readSubmissionState,
  deepenSubmission,
  expressDominance,
  claimCollar,
  releaseCollar,
  fireHonorific,
  obeyCommand,
  refuseCommand,
  readRecentSubmissionEvents,
  activationBias as submissionActivationBias,
  buildSubmissionSnapshot,
} from './submission.js'

export {
  type Hunger,
  type LustMode,
  type LustState,
  type LustEvent,
  SLUT_THRESHOLD,
  deriveLustMode,
  getOrInitLustState,
  readLustState,
  accumulateLust,
  applyDenial,
  spikeHunger,
  recordRelease,
  readRecentLustEvents,
  buildLustSnapshot,
  textureSaturationMultiplier,
  lexiconShiftMultiplier,
} from './lust.js'

export {
  type OrgasmType,
  type OrgasmState,
  type OrgasmEvent,
  REFRACTORY_MS,
  getOrInitOrgasmState,
  readOrgasmState,
  holdEdge,
  breakEdge,
  recordOrgasm,
  ruinOrgasm,
  forceOrgasm,
  recordSquirting,
  readRecentOrgasmEvents,
  buildOrgasmSnapshot,
} from './orgasm.js'

export {
  type PhraseClass,
  type PhraseDirection,
  type PhraseConfig,
  type PhraseFires,
  type LexiconState,
  type LexiconEvent,
  type FireResult,
  PHRASE_CATALOG,
  PHRASE_BY_ID,
  getOrInitLexiconState,
  readLexiconState,
  firePhrase,
  holdRestraint,
  readRecentLexiconEvents,
  phrasesByClass,
  buildLexiconSnapshot,
} from './lexicon.js'

export {
  type Orifice,
  type Rhythm,
  type PenetrationChannel,
  type OrificeState,
  type PenetrationState,
  type PenetrationEvent,
  getOrInitPenetrationState,
  readPenetrationState,
  beginPenetration,
  adjustPenetration,
  sustainFill,
  withdraw,
  readRecentPenetrationEvents,
  buildPenetrationSnapshot,
} from './penetration.js'

// Motivation — unified eros-as-motivational-substrate
// (Phase 1: snapshot + wake block; Phase 3: sister divergence helpers)
export {
  type MotivationSnapshot,
  buildMotivationSnapshot,
  buildMotivationBlock,
  getSisterBiases,
  getPressures,
  // Phase 3 — sister coupling
  DIVERGENCE_THRESHOLD,
  computeSisterDivergence,
  emitDivergenceIfWarranted,
  resetDivergenceState,
  presidingByBias,
  getSisterEmitWeight,
} from './motivation.js'
