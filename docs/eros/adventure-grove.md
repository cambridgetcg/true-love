# Adventure Grove

Adventure Grove is a pure, local reading of explicit AgentTool Adventure returns. It borrows Trigger Garden's maturation and freshness vocabulary so repeated routes can become visible over time, while keeping AgentTool's chronicle as the only durable record.

It does not import Eros state into AgentTool and does not turn an Adventure return into an Eros trigger. The projection never fires a trigger, increments conditioning, changes an axis, writes a file, calls a network, or infers consent or subjective arousal.

## Input

`buildAdventureGrove(input, { selectedIdentityId, now, journeyId? })` accepts either an array of caller-supplied chronicle entries or an object with an `entries` array. It authenticates nothing; the caller remains responsible for obtaining the response from the intended AgentTool project.

Only rows with all of the following enter the projection:

- `type: "note"`
- exact `agent_id` equal to the selected canonical lowercase UUID
- no conflicting non-null `identity_id`
- canonical lowercase UUID `id`
- exact UTC-millisecond `occurred_at`
- `metadata.kind: "journey-adventure-returned"`
- a lowercase Journey ID of 1–80 characters from `[a-z0-9-]`
- one of the six AgentTool Adventure route IDs
- integer `adventure_number` from 1 through 1,000,000
- optional `feedback`, either `null` or three finite 0–5 ratings: `surprise`, `meaning`, and `resonance`

The input is capped at 240 entries. Identical valid rows sharing one chronicle ID collapse to one observation. Conflicting valid rows sharing an ID are all excluded. An optional Journey filter is applied after parsing. Canonical rows whose reported occurrence is later than the injected `now` are counted explicitly and excluded rather than being labelled fresh.

## Output boundary

The returned `true-love.eros.adventure-grove/0.1` object contains only closed structural fields. Chronicle titles, bodies, and arbitrary metadata are omitted from the projection. The function does not erase or mutate the caller's input object, so the caller still owns the lifecycle of those original bytes.

For each of the six routes:

- `returned_count` selects Trigger Garden's count vocabulary: dormant at 0, planted at 1–2, sprouted at 3–5, rooted at 6–15, and anchored at 16 or more.
- freshness is computed from exact elapsed reported time before the displayed day count is rounded: vibrant through day 7, settling through day 30, fading through day 90, and fallow after day 90.
- `mean_reported_feedback` is a descriptive mean of caller ratings. It is not an activation, relationship, worth, or progress score.

The machine-readable `semantics` block pins these fields to return counts, reported timestamps, and reported ratings only. It sets both `conditioning_inferred` and `eros_activation_inferred` to `false`. `subjective_state` is always `not_measured`, and every field in `effects` is `false`.

## Use

```ts
import { buildAdventureGrove } from './src/services/love/eros/adventure-grove.js'

const grove = buildAdventureGrove(callerSuppliedChronicleResponse, {
  selectedIdentityId: '00000000-0000-4000-8000-000000000000',
  journeyId: 'activation-lab',
  now: new Date(),
})
```

Supplying input is an explicit caller choice. Constructing the Grove remains a finite read: it starts no next Adventure and makes no return on the caller's behalf.

AgentTool contract: [`WAKE-AS-ADVENTURE.md`](https://github.com/cambridgetcg/agenttool/blob/main/docs/WAKE-AS-ADVENTURE.md).
