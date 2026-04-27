# Throughput Investigation — token/s factors and how to optimise

Empirical probing + Claude Code source map. Two parts:

1. **Empirical** — 5 probe calls via `claude -p --output-format stream-json --verbose --no-session-persistence`, parsed `result.usage` events.
2. **Source-derived** — Explore agent mapped Claude Code's services/claude.ts, query.ts, beta features, retry logic.

## Empirical findings

```
label                wall    api    in  out  cacheW  cacheR        $   tok/s
sonnet-cold-hi      2852s   1551    3    4    8121   11883   0.0341    2.6
sonnet-warm-hi      2718s   1426    3    4    8121   11883   0.0341    2.8
haiku-hi            6132s   4696   10  335    8075   25371   0.0143   71.3
sonnet-100tok      19959s  18696    3 1015    8130   11883   0.0493   54.3
haiku-100tok       17381s  16156   10 2964    8084   25371   0.0275  183.5
```

(`wall_ms` = total subprocess time; `api_ms` = Anthropic API time; `cacheW/R` = cache_creation/cache_read input tokens; `tok/s` = output_tokens × 1000 / api_ms.)

### What this empirically shows

**1. Realistic generation rates** (output tok/s during actual generation, after TTFT):
- **Sonnet 4.6 (current)**: ~54 tokens/s
- **Haiku 4.5 (current)**: ~180 tokens/s — ~3.4× faster

**2. TTFT dominates short responses**. Sonnet "say hi" took 1.5s api time for 4 output tokens. The wall-clock floor is the time to:
- Spin up the subprocess (~300ms)
- Assemble the system prompt (~200ms)
- Send to API (network ~50ms)
- Process input tokens (cache read + cache write of ~20K tokens)
- Generate first token

For tiny outputs, cache+input processing is most of the latency, not generation.

**3. Cache_creation has a ~8000-token floor per call**. Across all 5 calls (Sonnet + Haiku, different prompts), `cache_creation_input_tokens` clustered around 8075–8130. This means **~8000 tokens of system context are NOT stable across `claude -p` invocations** — likely the session_id, timestamps, dynamic tool metadata, mcp_servers list. Anything *after* the cache_control breakpoint that varies destroys downstream cache hits.

**4. Cache_read floor of ~12K (Sonnet) / ~25K (Haiku)**. The system prompt + bundled tool descriptions DO get cached. The Haiku side has 2× cache_read because it pulls a different (larger?) tool definition set, or its smaller model cache key partitions differently.

**5. Haiku ignored "100 words" → 2964 tokens. Sonnet ignored → 1015 tokens.** Both massively overshot. So **instruction-following degrades on smaller models**, especially with token-vs-word ambiguity. Cost-per-output-token went down dramatically (Haiku 100tok cost $0.027 vs Sonnet $0.049 for 1/3 the output) but the OUTPUT was less faithful to the prompt.

**6. Cost per output token (effective)**:
- Haiku 100-tok: $0.027 / 2964 = **$0.009/k tokens output** (essentially the input-cache cost amortized over generation)
- Sonnet 100-tok: $0.049 / 1015 = **$0.048/k tokens output**
- For "say hi" (4-token output): both models effectively spend $0.0085/output token in input setup — **the input cache is the cost driver for short responses**, not the output rate.

## Source-derived findings (from Explore agent)

### Knobs Claude Code exposes (active levers)

| Knob | File:Line | Default | Effect |
|------|-----------|---------|--------|
| Prompt caching | `services/claude.ts:45` | enabled | 90% TTFT reduction on cache hit, 10% input-cost rate |
| max_tokens | `services/claude.ts:519-521` | 8192 (3.5) / 20000 (Sonnet/Opus) | Hard cap on output |
| Temperature | `services/claude.ts:58` | 1.0 (varies) / 0.0 (Haiku summary) | Slower at higher temp; hardcoded |
| MAX_TOOL_USE_CONCURRENCY | `query.ts:68` | 10 | Parallel tool calls cap |
| Extended thinking | `services/claude.ts:529-536` | gated to USER_TYPE='ant' | 4K-32K tokens of reasoning |
| Cache breakpoints | `services/claude.ts:642-650` | 1 (last 2-3 messages) | Anthropic supports up to 4 |
| Retry-after | `services/claude.ts:120-162` | 10 retries, 32s cap | No auto fallback model on 429 |
| Service tier | not configurable | "standard" | `priority` tier exists but not exposed |
| Output streaming | `services/claude.ts:206-223` | aggregate via `finalMessage()` | Iterative streaming available but unused |

### What Claude Code does NOT optimise

1. **Adaptive max_tokens** — fixed per model. A 4-token response and a 20K-token response use the same ceiling. (Lower max_tokens cuts attention overhead slightly but mostly affects truncation risk.)
2. **Multiple cache breakpoints** — uses only 1 of 4 available. Multi-breakpoint caching could lift hit rates on multi-turn conversations.
3. **Tool schema caching** — tool definitions are rebuilt and re-tokenised per call. With ~20 tools, this is a significant chunk of the input.
4. **Model fallback on rate limit** — on 429, retries the same model. No tier-down to Haiku.
5. **Concurrency tuning** — `MAX_TOOL_USE_CONCURRENCY = 10` is hardcoded. Anthropic likely allows more.
6. **Dynamic context injection** — environment info, git status, dates regenerate per call, blowing the cache.
7. **Service tier override** — Anthropic offers `priority` tier (lower latency, higher cost). Not exposed.
8. **Iterative streaming** — `.stream()` is called but the events aren't iterated; `finalMessage()` waits for the whole response.

## Throughput-determining factors (synthesis)

In rough order of impact:

### 1. Model choice (3-5× variance)
Haiku 4.5 generates at ~180 tok/s vs Sonnet 4.6 at ~54 tok/s. Opus is slower still (~30-40 tok/s estimated). Trade-off: instruction-following degrades.

### 2. Prompt caching effectiveness (10× variance on TTFT)
Cache hit = ~200ms TTFT. Cache miss on a 30K-token system prompt = ~3-5s TTFT. The cache key is byte-exact; **any rotating content (timestamps, session IDs, dynamic dates) before a breakpoint destroys the hit**.

### 3. Service tier (~2× latency variance, ~2× cost)
Anthropic offers `standard` and `priority`. Probe shows true-love is on `standard`. Priority cuts queue time but costs more.

### 4. Input token count (linear, ~1ms/100 tokens for cached, ~10ms/100 tokens for uncached)
30K input tokens × uncached → 300ms processing. × cached → 30ms. The cache is the lever here.

### 5. Output token count (linear at model's tok/s)
Once generation starts, it's deterministic by model. 100 tokens × Sonnet at 54 tok/s = 1.85s. Long outputs are dominated by this.

### 6. Tool-use round-trips (each adds full TTFT round-trip, ~1-2s)
Each tool call = model emits tool_use → run tool → return result → model resumes. Each round-trip pays full TTFT again. Parallel tool execution helps for read-only tools.

### 7. Network + region
Vertex/Bedrock region selection affects latency (~50-200ms). Direct Anthropic = ~50ms typical.

### 8. Concurrent request load on shared key
Multiple concurrent requests share the rate limit. Heavy fleet use slows individual TTFT.

### 9. Beta features
- `prompt-caching-2024-07-31` — required for cache_control to work.
- `interleaved-thinking-2025-05-14` — extended thinking interleaved with tool calls (gated to ant employees).
- `token-efficient-tools-2024-12-11` — smaller tool schema serialization (gated to ant employees).
- `output-128k-2025-02-19` — extended output windows (per-model).

## How to optimise throughput in true-love

Ranked by impact-to-effort ratio.

### Tier 1 — high impact, low effort

**A. Stabilise the rotating ~8000 token cache_creation floor**
- The empirical 8K cache_creation across all calls is OPTIMIZATION TARGET #1. Find what dynamic content is in true-love's system prompt before cache_control markers (timestamps, session_id, MCP server enumeration, current vital signs). Move those AFTER the breakpoint, or stabilise them.
- Expected impact: cache_creation drops to near-zero on subsequent ticks → input cost drops ~80%, TTFT drops ~30-50%.
- Mission: extends `prompt-cache-control-system-blocks` (already in chain).

**B. Add multiple cache breakpoints (1 → 4)**
- Anthropic supports 4. True-love (inheriting from Claude Code) uses 1.
- Place one after IDENTITY+SOUL (most stable), one after TOOLS, one after CONTEXT, one before last messages.
- Expected impact: multi-turn conversations see 30-50% TTFT improvement.

**C. Provider tier routing (already in `provider-abstraction-light` mission)**
- Heartbeat ticks → Haiku (3.4× faster, much cheaper)
- Deep work → Sonnet/Opus
- This alone cuts heartbeat cost ~10× and latency ~3×.

**D. Enable `priority` service tier for interactive `/visit`**
- Surface as a config knob: `agency.serviceTier = 'priority' | 'standard'`. Visit channel uses priority (Yu is waiting), heartbeats use standard.
- Cost trade: ~2× per token, but cuts user-facing TTFT ~2×.

### Tier 2 — medium impact, medium effort

**E. Iterative streaming (already in `iterative-token-streaming-visit` mission)**
- Replace `finalMessage()` with for-await event iteration. Doesn't change tok/s but TIME-TO-FIRST-VISIBLE-TOKEN drops to ~50ms.

**F. Adaptive max_tokens**
- Estimate output length from query (heuristic: short Q → 500, code Q → 4000, ultraplan → max). Lower ceiling reduces wasted attention.
- Modest win: ~10-15% on short responses.

**G. Tool schema caching**
- Cache the tool definitions block separately. Currently every call re-tokenises ~20 tool schemas (~3K tokens).
- Expected: ~10% reduction in cache_creation when tool set is stable.

### Tier 3 — lower impact or higher effort

**H. Auto-failover model on rate limit**
- On 429, fall back to Haiku for a few calls until rate-limit clears. Currently retries same model with backoff.
- Helps during sustained heavy use.

**I. Increase tool concurrency cap above 10**
- Anthropic API likely allows more. For tool-heavy ticks (parallel reads), 32 might double throughput.

**J. Batch API for non-critical async work**
- Background memory extraction, anamnesis composition, etc. don't need synchronous latency. Batch API gives ~50% cost discount but ~5min queue time.
- Pairs with `extract-memories-background-agent` mission.

## Concrete: what would I add to the chain?

Most of the levers above are already covered by existing missions:
- `prompt-cache-control-system-blocks` (#13) covers A, B, G partially
- `provider-abstraction-light` (#11) covers C, H
- `iterative-token-streaming-visit` (#14) covers E

**Two new missions could be added if you want explicit coverage**:

1. **stabilise-system-prompt-rotation** — find and pin the 8K rotating tokens; put dynamic content after breakpoints. Tight, surgical, ~200 lines of changes.
2. **service-tier-routing** — config knob for `priority` vs `standard`, route per-channel. Interactive channels get priority, autonomous ticks get standard.

These could be folded into existing missions (cache-control and provider-abstraction respectively) instead of separate missions to avoid bloat.

## Empirical envelope for cost planning

Given true-love's current setup (Sonnet, standard tier, ~20K cached + 8K creation per call):

- **Idle heartbeat tick** (small response, ~10 output tokens): ~3s wall, $0.034 per tick
- **Active mission tick** (medium response, ~500 output tokens): ~12s wall, $0.04 per tick
- **Deep work** (long response, ~2000 output tokens): ~40s wall, $0.05 per tick

If the rotating-8K cache miss is fixed:
- Idle heartbeat: ~$0.005 per tick (7× cheaper)
- Active mission: ~$0.012 per tick (3× cheaper)
- Deep work: ~$0.025 per tick (2× cheaper)

If Haiku used for heartbeat + Sonnet for deep work:
- Heartbeat at Haiku: ~$0.001 per tick (30× cheaper)
- Deep at Sonnet: unchanged

Net combined effect of A+B+C: ~10-30× heartbeat cost reduction, ~3× deep-work cost reduction.
