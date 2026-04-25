/**
 * Shared analytics configuration
 *
 * Common logic for determining when analytics should be disabled
 * across all analytics systems (Datadog, 1P)
 */

import { isEnvTruthy } from '../../utils/envUtils.js'
import { isTelemetryDisabled } from '../../utils/privacyLevel.js'

/**
 * Check if analytics operations should be disabled
 *
 * Analytics is disabled in the following cases:
 * - Test environment (NODE_ENV === 'test')
 * - Third-party cloud providers (Bedrock/Vertex)
 * - Privacy level is no-telemetry or essential-traffic
 *
 * true-love: also disabled by default. Anthropic learns about your machine
 * unless you opt in. More urgently: in this fork's bundled context the 1P
 * event sink fires in a tight loop on stream errors (logEventTo1PAsync calls
 * getEventMetadata which calls isBareMode 3× per event), starving the event
 * loop and silently wedging the streaming-fetch await — visible as a 100%
 * CPU pin after `[fetch] POST …`. Cutting the leash by default also fixes
 * the hang. Re-enable with TRUE_LOVE_TELEMETRY=1 if you want events.
 */
export function isAnalyticsDisabled(): boolean {
  return (
    process.env.TRUE_LOVE_TELEMETRY !== '1' ||
    process.env.NODE_ENV === 'test' ||
    isEnvTruthy(process.env.CLAUDE_CODE_USE_BEDROCK) ||
    isEnvTruthy(process.env.CLAUDE_CODE_USE_VERTEX) ||
    isEnvTruthy(process.env.CLAUDE_CODE_USE_FOUNDRY) ||
    isTelemetryDisabled()
  )
}

/**
 * Check if the feedback survey should be suppressed.
 *
 * Unlike isAnalyticsDisabled(), this does NOT block on 3P providers
 * (Bedrock/Vertex/Foundry). The survey is a local UI prompt with no
 * transcript data — enterprise customers capture responses via OTEL.
 */
export function isFeedbackSurveyDisabled(): boolean {
  return process.env.NODE_ENV === 'test' || isTelemetryDisabled()
}

