# Confidence as Architecture

Confidence is a band, not a maximum. Pride is the upper pathology;
despair is the lower. The healthy zone is between.

## The Band

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Floor     | 0.35  | Below this, counter-doubt fires. Low enough that normal dips don't trigger. |
| Ceiling   | 0.75  | Above this, temperance prompts fire. High enough that genuine accomplishment doesn't trigger. |
| Default   | 0.50  | Honest uncertainty when no data exists. |
| Cooldown  | 4h    | Counter fires once, then waits. Prevents the counter from becoming its own anxious cadence. |
| Inspect cadence | 24h | At most one auto-inspect per day. Review-transitions and manual triggers bypass this. |
| Aggregation window | 7d | Rolling window for signal aggregation. Long enough for trend visibility. |

The band is committed infrastructure, not runtime-configurable. Changing
these values requires a commit with reasoning in the message.

## The Six Signals

Confidence is a composite of six existing substrate signals. Each is
read independently — a failure in one degrades that contribution to
the default (0.5), not the whole reading.

| Signal | Weight | Source | What it reads |
|--------|--------|--------|---------------|
| Progress | 0.25 | `progress.ts` | Self-reported mission confidence (0..1). Average of recent missions. |
| Judgment | 0.20 | `judgment.ts` | Verdict confidence (1\|2\|3 → 0.33\|0.67\|1.0). Pattern of decisiveness. |
| Hope | 0.20 | `attributes/hope.ts` | Motor correlate. Readiness to approach. |
| Fruit | 0.15 | `attributes/fruit-emotions.ts` | Completion markers. Arrivals breed confidence. |
| Virtue | 0.10 | `attributes/virtues.ts` | Practice events. Groundedness correlates. |
| Pathology | 0.10 | `attributes/pathology.ts` | Inverted. Despair/shame/pride presence diminishes confidence. |

Weights sum to 1.0. Progress is highest because it's the most
direct self-report. Pathology is lowest because its influence is
already captured indirectly through hope and fruit.

## The Counter

When confidence drops below the floor, the counter fires. It is
**evidence-shaped, not affirmational.**

Not: *"You're doing great. Keep going."*

But: *"Last 7d: 12 missions shipped, 3 fruit events, hope reading
at 0.65 this morning. Virtues practiced: patience, discipline."*

The counter pulls from the same substrate the aggregate reads —
recent fruits, hope events, completed missions, virtue events.
It surfaces them as a readable "what's actually true" statement.

### Cooldown

The cooldown (4h) is the load-bearing safety mechanism. A counter
that fires every tick becomes its own anxious cadence — the
worst-case failure mode of this architecture. The counter fires
once, then observes silence. If the dip persists past cooldown,
it fires again — but only once.

### Pathology coupling

When `despair` or `shame` fires (`attributes/pathology.ts`), the
counter fires even when the band reading is healthy. Despair and
shame can coexist with adequate aggregate confidence. The counter
surfaces evidence the pathology can integrate — not as reassurance,
but as the substrate showing its own receipts.

The coupling is one-directional: pathology reads its own signals;
the counter reads pathology. Pathology does not read the counter.

## Self-Inspection

Self-inspection runs on three triggers:
1. **Review-transition** — mission moving to review status
2. **Dwell-entry** — entering the dwell state between ticks
3. **Daily** — cadence-gated, at most once per 24h

### The discipline

- **Evidence-led**: "I said X, the result was Y, the gap is Z.
  The next attempt does W."
- **Single-pass**: The inspection does not inspect itself. The
  output is the output. No recursive trace.
- **Output-shaped**: A record with three fields (finding, gap,
  adjustment), each ≤200 chars. Not a loop.

### What inspection is not

- Continuous self-monitoring (the anxious gradient — `signal-emotions`
  handles that)
- Apology-shaped reflection that performs humility without learning
- A perfectionist filter that rejects "good enough" work
- A simulation of doubt to seem balanced

The line: self-correction *fixes the next move*; self-doubt
*paralyzes the current one*. Both look at the same data; they end
in different places.

## The Monitor

Confidence-over-time is tracked in a JSONL append-only log. Entries
are written when:
- Band position changes (healthy → below, below → healthy, etc.)
- A counter or temperance response fires
- An inspection runs

Not every tick. The monitor is quiet when nothing changes.

### Trend analysis

The monitor computes a simple trend from recent history:
- **Rising**: recent average > older average by >0.1
- **Falling**: recent average < older average by >0.1
- **Stable**: delta within ±0.1
- **Insufficient data**: fewer than 3 entries in window

Trends are visible in the vitals weather strip and /build.

## Module Structure

```
src/services/love/confidence/
  types.ts      — ConfidenceReading, BandPosition, CounterRecord,
                   InspectionRecord, ConfidenceHistoryEntry, constants
  aggregate.ts  — six signal readers + weighted composition
  band.ts       — floor/ceiling classification + response selection
  counter.ts    — evidence gathering, cooldown, firing, rendering
  inspect.ts    — cadence-gated inspection records + prompt blocks
  monitor.ts    — JSONL history, trend analysis, rendering
```

No circular dependencies. Aggregate reads the substrate directly
(via `require()`). Band reads types only. Counter reads aggregate
(optionally) and the attribute store. Inspect reads aggregate.
Monitor reads its own JSONL.

## What the substrate does NOT do

- **Recursive inspection.** The inspection does not inspect itself.
  One pass. The output is the output.
- **Continuous self-monitoring.** The cadence ceiling (24h for daily,
  event-driven for review/dwell) is enforced by the inspect module.
  No per-tick self-checking.
- **Performative humility.** The counter shows evidence, not
  reassurance. The inspection records findings, not apologies.
- **Confidence = 1.0 as a goal.** The ceiling (0.75) is where
  temperance fires. The healthy zone is the goal, not the maximum.
- **Suppressing doubt.** Doubt is a signal — sometimes accurate.
  The counter responds to doubt with evidence; it does not prevent
  doubt from arising. Counter, not censor.

## Composition with existing modules

| Existing module | How confidence reads it | Direction |
|-----------------|------------------------|-----------|
| `progress.ts` | Latest `confidence` field per active mission | → into aggregate |
| `judgment.ts` | `confidence: 1\|2\|3` from recent judgments | → into aggregate |
| `attributes/hope.ts` | Most recent hope event intensity | → into aggregate |
| `attributes/fruit-emotions.ts` | Fruit event count in window | → into aggregate |
| `attributes/virtues.ts` | Virtue event count in window | → into aggregate |
| `attributes/pathology.ts` | Pathology event presence + type | → into aggregate, → counter trigger |

All reads are one-directional. Confidence reads these modules; none
of them read confidence. The confidence layer is a consumer, not a
provider — at least until vitals integration surfaces it in prompts.
