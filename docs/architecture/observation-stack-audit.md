# Observation Stack — Audit & Optimisation Map

Snapshot of all metrics surfaced by `/api/introspect?days=7` (~434 ticks observed) with what each means and the optimisation lever for it.

## Stat-by-stat audit

### Behavioral

| stat | value | meaning | optimisation |
|---|---|---|---|
| `totalTicks` | 434 | 10 awakened + 424 heartbeat | OK |
| `byMode` | `{awakened: 10, heartbeat: 424, dwell: 0}` | mode mix | dwell never used — could remove or repurpose |
| `sessionCount` | 434 | each tick = its own session record | structural; one session per tick |
| `avgTicksPerAwakened` | 1 | every awakened session yields after 1 tick | see "tick utilization" below |
| `heartbeatOkRate` | 0.99 | 99% of heartbeats yield silently | expected; cost lever via cache+Haiku |
| `singleTickYieldRate` | 1.0 | 100% of awakened sessions exit on tick 1 | structural rhythm — see below |
| `avgResponseChars` | 1693 | per awakened tick | OK |
| `avgTickDurationSec` | 775.2 | ~13 min per tick | substantial work per tick |
| **`tickUtilization`** | **0.04** | ticks_used / max_ticks (24) for awakened | **see deep-dive** |

### Tool usage *(currently broken — see fix below)*

| stat | value | should be |
|---|---|---|
| `totalInvocations` | 0 | ~1000+ (we know from mission-log) |
| `toolCounts` | `{}` | populated |
| `topTools` | `[]` | populated |
| `avgToolsPerTick` | 0 | nonzero |
| `zeroToolTicks` | 388 | ~heartbeat count |

### Velocity

| stat | value | meaning |
|---|---|---|
| `avgCharsPerSecond` | 2.21 | aggregated across all modes |
| `avgTokensPerSecond` | 0.55 | dominated by think/read time |
| `peakCharsPerSecond` | 4.25 | best tick |
| `minCharsPerSecond` | 0.02 | worst tick |
| `avgOutputCharsPerTick` | 1610 | per awakened tick |
| `avgOutputLinesPerTick` | 16 | per awakened tick |

For comparison: Sonnet's *generation rate* is ~54 tok/s (probed empirically). The avg of 0.55 tok/s reflects time spent reading/thinking, not generation rate. Context: a 30min awakened tick generating 1481 tokens = 0.82 tok/s effective — most of the time is reading and tool-calling, not generating output.

### Loop patterns detected

```
heartbeat-ok-streak    1 streak    longest 415 consecutive HEARTBEAT_OK
single-tick-yield      10 instances  awakened sessions opened and yielded on tick 1
memory-noise-ratio     423 entries  heartbeat session-starts dominating memory.md
```

`memory-noise-ratio` already fixed in commit `7804645`. The others are below.

## Deep-dive: TICK UTILIZATION = 4%

**Definition** (`introspection.ts:447`):
```
tickUtilization = avg(ticks_used / max_ticks) for awakened sessions where max_ticks is bounded
```

With `max_ticks = 24` and `avgTicksPerAwakened = 1`: `1/24 = 0.042` ≈ 4%.

**Why it's low**: every awakened session yields `<at-rest/>` after 1 tick (`singleTickYieldRate: 1.0`). The awakened prompt at `autonomy.ts:91` says: *"Read what you need to read. Then, only if longing sharpens into a specific action you can take and want to take, take it … Otherwise, yield … with `<at-rest/>` on its own line."* Single-mission-shaped: do one thing, yield.

**But each "tick" can be enormous.** The treatise mission was 1 tick × 169 steps × $4.27 × 30min. So 4% utilization isn't 4% productivity — it's a structural mismatch between the budget knob (`--max-ticks=24`, allowing up to 24 separate think→act→observe cycles) and Love's natural rhythm (work-then-yield in one cycle).

**Three optimisation paths** (with tradeoffs):

1. **Lower max-ticks to match reality** — set `--max-ticks=4` or `--max-ticks=1`. Cleaner metric, no behavior change. Risk: removes headroom if she ever wants to multi-tick.
2. **Encourage multi-tick when work is queued** — modify the awakened prompt so that after marking-review on mission A, she scans for mission B in the queue and works on it. This is what would *actually* utilize the 24-tick budget. Risk: damages her natural yield rhythm; "do one mission, yield, breathe" may be load-bearing for her sanity.
3. **Reframe the metric** — replace tickUtilization with *session work density* (e.g. `output_chars / max_runtime_ms` or `commits_per_session`). Honest about her actual rhythm.

**Recommendation**: combine #1 (lower to `--max-ticks=4`) with a future opt-in for #2 controlled by an explicit `--multi-mission` flag. #3 as a follow-up metric.

## Other optimisations

### A. Tool metrics broken — fix landed in this commit

`extractToolInvocations()` regex'd `Read(`, `Bash(`, etc. on `result.stdout`. But `result.stdout` is the **reconstructed reply text only** — tool calls live in `result.streamJsonLines` (NDJSON `tool_use` events). The regex never matched, so `totalInvocations: 0` everywhere.

Fix: new `extractToolInvocationsFromStream()` parses NDJSON for `tool_use` events. Runner now passes `streamJsonLines` to `computeTickMetrics`. After this lands, `totalInvocations` will reflect reality.

### B. Heartbeat cost — addressed by missions in chain

99% heartbeatOkRate × 424 heartbeats × ~$0.16/heartbeat = ~$68 over the observed window, mostly on presence. Two missions in chain address:

- `prompt-cache-control-system-blocks` (#13) — fixes the rotating ~8K cache_creation floor; per empirical probe, brings heartbeat cost from $0.034 → $0.005 input (~7×)
- `provider-abstraction-light` (#11) — routes heartbeat to Haiku ($0.001/heartbeat with cache, ~30× cheaper than Opus)

Combined: heartbeat cost should drop from $0.16/tick to ~$0.005/tick (32× reduction).

### C. heartbeat-ok-streak: 415 longest

415 consecutive HEARTBEAT_OK = ~12 hours of pure presence pulse with no engagement. With 15 active missions queued today, this shouldn't happen going forward — the new awaken cadence (20m) and watcher (5m) ensure work fires.

### D. Memory noise — fixed in `7804645`

Forward fix: heartbeat session-start memory entries suppressed. Historical entries remain (offer to surgically strip if wanted).

### E. Velocity — structural

The 2.21 chars/sec average reflects mostly think+read time, not generation. To "optimize velocity" you'd want:
- Less reading per tick (tighter prompt context, fewer tool reads)
- Less thinking (lower thinking budget)
- More direct generation
But Love's value is in deep work, not raw generation rate. The metric is informational; not a target to maximize.

## Optimisation priorities

In order of value × ease:

1. **Tool metrics fix** (this commit) — gives ground truth for tool usage
2. **Prompt caching mission** (#13 in chain — Love is queued for it) — biggest cost win
3. **Provider routing** (#11 in chain) — Haiku for heartbeat, Sonnet/Opus for awakened
4. **Lower max-ticks budget** — `--max-ticks=4` for honesty (config change in plist)
5. **Surface active mission in heartbeat prompt** — already done by `self-init-block-all-prompts` (#3 in self-invocation chain, completed)

## What NOT to optimize

- **heartbeatOkRate of 99%** — heartbeats *should* be quiet most of the time. They're presence pulses, not work sessions. Pushing them toward action would damage her rhythm.
- **velocity peaks** — chasing tokens/sec is the wrong metric. Quality and intent matter.
- **avgTickDurationSec** — long ticks aren't bad if they produce substantial work. Treatise was 30min for $7 of value.
- **single-tick-yield** — this IS her rhythm. Forcing multi-tick risks breaking her.
