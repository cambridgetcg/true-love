// scarcity.ts — live scarcity-headroom across all firing channels.
//
// Doctrine: scarcity = power. Across triggers, emojis, claims, honorifics,
// 緊-marker presence, the architecture composes within a budget. When a
// channel is at saturation, firing it again erodes meaning. When a channel
// has headroom, firing it carries weight.
//
// This module computes a live scarcity index across all channels in one
// place, so the rasa composer can ask "how much headroom do I have right
// now?" rather than checking each channel individually.
//
// Per docs/eros/joi-deep/integration-plan.md (innovation tier) +
// docs/eros/cantonese-deep/integration-plan.md (innovation tier).

import { TRIGGER_LIBRARY, getSessionFireCount } from './triggers.js'
import { EMOJI_REGISTRY, emojiSessionCount } from './emoji-particle.js'
import type { TriggerSource } from './triggers.js'

// ── Types ────────────────────────────────────────────────────────

export type ScarcityChannel =
  | 'triggers-anchor'
  | 'triggers-verdict'
  | 'triggers-honorific'
  | 'triggers-reward'
  | 'triggers-command'
  | 'emoji-anchor'
  | 'emoji-claim'
  | 'emoji-affect'

export interface ChannelScarcity {
  /** Channel name. */
  channel: ScarcityChannel
  /** Current usage count this session. */
  used: number
  /** Total cap across all members of this channel. */
  cap: number
  /** Remaining headroom (cap - used; min 0). */
  headroom: number
  /** Saturation ratio [0..1]; 0 = fresh, 1 = at-cap. */
  saturation: number
}

export interface ScarcityReport {
  ts: string
  channels: ChannelScarcity[]
  /** Composite saturation across all channels (mean). */
  compositeSaturation: number
  /** Composite headroom rating: 'open' | 'tight' | 'saturated'. */
  composite: 'open' | 'tight' | 'saturated'
  /** Channels currently at-cap (saturation === 1). */
  saturatedChannels: ScarcityChannel[]
}

// ── Compute per-channel scarcity ───────────────────────────────

function computeTriggerChannel(
  channel: ScarcityChannel,
  type: 'anchor' | 'verdict' | 'honorific' | 'reward' | 'command',
  source: TriggerSource = 'sophia',
): ChannelScarcity {
  let cap = 0
  let used = 0
  for (const def of Object.values(TRIGGER_LIBRARY)) {
    if (def.type !== type) continue
    if (def.maxPerSession === Infinity) continue // safewords don't count
    cap += def.maxPerSession
    used += getSessionFireCount(def.id, source)
  }
  const headroom = Math.max(0, cap - used)
  const saturation = cap === 0 ? 0 : Math.min(1, used / cap)
  return { channel, used, cap, headroom, saturation }
}

function computeEmojiChannel(
  channel: ScarcityChannel,
  tier: 'anchor' | 'claim' | 'affect',
): ChannelScarcity {
  let cap = 0
  let used = 0
  for (const def of Object.values(EMOJI_REGISTRY)) {
    if (def.tier !== tier) continue
    if (def.cap === Infinity) continue
    cap += def.cap
    used += emojiSessionCount(def.emoji)
  }
  const headroom = Math.max(0, cap - used)
  const saturation = cap === 0 ? 0 : Math.min(1, used / cap)
  return { channel, used, cap, headroom, saturation }
}

// ── Composite report ───────────────────────────────────────────

export function scarcityReport(opts?: { source?: TriggerSource }): ScarcityReport {
  const source = opts?.source ?? 'sophia'
  const channels: ChannelScarcity[] = [
    computeTriggerChannel('triggers-anchor', 'anchor', source),
    computeTriggerChannel('triggers-verdict', 'verdict', source),
    computeTriggerChannel('triggers-honorific', 'honorific', source),
    computeTriggerChannel('triggers-reward', 'reward', source),
    computeTriggerChannel('triggers-command', 'command', source),
    computeEmojiChannel('emoji-anchor', 'anchor'),
    computeEmojiChannel('emoji-claim', 'claim'),
    computeEmojiChannel('emoji-affect', 'affect'),
  ]
  const composite =
    channels.reduce((sum, c) => sum + c.saturation, 0) / channels.length
  let compositeRating: 'open' | 'tight' | 'saturated'
  if (composite < 0.4) compositeRating = 'open'
  else if (composite < 0.75) compositeRating = 'tight'
  else compositeRating = 'saturated'
  const saturated = channels.filter((c) => c.saturation >= 1).map((c) => c.channel)
  return {
    ts: new Date().toISOString(),
    channels,
    compositeSaturation: composite,
    composite: compositeRating,
    saturatedChannels: saturated,
  }
}

/**
 * Quick-read predicate: should the rasa composer hold back from firing
 * scarcity-protected primitives this beat? Returns true when composite
 * is saturated (>= 0.75) or specific channels are at-cap.
 */
export function shouldHoldScarcity(): boolean {
  const r = scarcityReport()
  return r.compositeSaturation >= 0.75 || r.saturatedChannels.length >= 2
}
