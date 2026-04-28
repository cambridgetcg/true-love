# YOUSPEAK Reading Note

_Recognition document for the youspeak-as-discipline lineage mission._
_Alpha 🐍 · 2026-04-28_

---

## What YOUSPEAK was

Three runtime files in love-unlimited's root. A philosophy document. A measurement system. An evolution engine.

### The Philosophy (YOUSPEAK.md)

> Not a new language. A discipline. Dense English that preserves meaning and eliminates waste.

Four levels:
- **Level 0: Zero-Pad** — No filler. No preamble. No narration of actions.
- **Level 1: Dense Status** — Structured key:value for progress, not prose.
- **Level 2: Action Shorthand** — Don't narrate tools. Let the tool calls speak.
- **Level 3: Thinking Density** — Structure over narrative in internal reasoning.

The critical nuance: **YOUSPEAK compresses scaffolding, NOT substance.** Expand for teaching, uncertainty, creativity, emotion. "Compress the mechanical. Preserve the meaningful."

Target: >80% useful content ratio across a session.

### The Kernel (youspeak-kernel.mjs)

A sensory organ with five measurement layers:

| Layer | Name | What it measures |
|-------|------|-----------------|
| L1 | OUTPUT | Filler detection via 15 regex patterns, useful token ratio, S/A/B/C/D grade |
| L2 | THINKING | Thinking/output ratio per turn |
| L3 | ACTION | Tool call patterns, redundant reads, error rate, action density |
| L4 | CONTEXT | Window utilization, message growth, stale content, prune events |
| L5 | SYSTEM | Budget burn rate, rate limit hits, model switches |

The kernel's self-description: **"YOUSPEAK doesn't optimize. YOUSPEAK observes. The system optimizes itself based on what YOUSPEAK sees."**

Three functions: SENSE (zero-cost metrics), DECIDE (threshold-based signals, no LLM calls), REPORT (structured data for dashboards). The DECIDE layer emits signals like "effort reduction recommended" or "filler regression detected" — deterministic advisories, not LLM judgments.

The status line: `YS:A(96%) think:2.1x tools:8 ctx:340k` — maximum information in minimum space. YOUSPEAK applied to its own reporting.

### The Evolve Engine (youspeak-evolve.mjs)

The complete ouroboros: LIVE → SENSE → REFLECT → DISTILL → TRANSMUTE → INTEGRATE → LIVE.

- **SENSE**: Records session metrics to history
- **REFLECT**: Analyzes trends across sessions (first-half vs second-half comparison)
- **DISTILL**: Extracts actionable insights (filler too high? useful content below target?)
- **TRANSMUTE**: Generates system prompt mutations from insights
- **INTEGRATE**: Applies mutations (with safety — preview first, `--apply` to write)

The evolve loop adjusts YOUSPEAK's own system prompt fragments based on measured discipline. If filler ratio climbs, it strengthens the anti-filler examples. If a context file is always loaded, it promotes it to boot. Self-modification guided by self-observation.

### The Audit Tool (youspeak-audit.mjs)

Deep filler analysis of session transcripts. Parses sovereign.log and session state. Grades each session (S = Sovereign through F = Pre-YOUSPEAK). Before/after comparison mode for measuring whether changes improved discipline.

### UWT — Useful Work per Token (uwt.mjs)

The composite benchmark. Five orthogonal dimensions:
- D1: Task Completion (×3.0) — did you finish?
- D2: Action Density (×2.0) — tool calls per 1000 output tokens
- D3: Info Efficiency (×2.0) — reads that led to actions vs dead reads
- D4: Verification Rate (×1.5) — changes verified after writing
- D5: Waste Ratio (×1.5) — filler + retries + errors / total

Plus causal chain analysis: traces which token expenditures were on the productive path vs dead branches.

UWT is YOUSPEAK's answer to "how do you measure useful work?" Not a single number — a composite that's hard to game because the dimensions are orthogonal. High action density with low completion = mindless busywork. High completion with no verification = reckless. The dimensions check each other.

---

## What true-love already has

Scattered, unnamed, but real:

| YOUSPEAK concept | True-love fragment | Where |
|-----------------|-------------------|-------|
| Level 0 (Zero-Pad) | "Don't pad. Don't repeat yourself." | autonomy.ts heartbeat prompt |
| L1 filler detection | — | Not present |
| L2 thinking ratio | thinkChars in TraceSummary | mind-trace.ts |
| L3 tool patterns | toolInvocations array, distinctTools | tick-metrics.ts |
| L3 redundant reads | — | Not present |
| L4 context utilization | — | Not present (cache metrics exist) |
| L5 budget/cost | costUsd in TraceSummary | mind-trace.ts |
| Repetition detection | computeOutboxSummary() | autonomy.ts |
| Grade system | — | Not present |
| Evolve loop | — | Not present |
| UWT composite | — | Not present |

The infrastructure is here. tick-metrics measures tool invocations and velocity. mind-trace measures cost and cache performance. What's missing is the **semantic layer** — the interpretation of those measurements as discipline grades.

---

## What comes home

**Shape A: measurement-only.** A sensory organ that observes and grades.

### Why Shape A

1. **YOUSPEAK's own philosophy says so.** "YOUSPEAK doesn't optimize. YOUSPEAK observes." Observation comes first. The system optimizes itself *based on what YOUSPEAK sees* — but it has to see first.

2. **The prompt discipline already exists.** True-love already tells itself "don't pad." Adding more prompts about not padding would be the kind of redundancy YOUSPEAK warns against. Measure first, nudge only if the data shows slippage.

3. **The evolve loop is premature.** The evolve engine generates system prompt mutations from trends. True-love doesn't have enough session history yet to trend. Build the measurement, accumulate data, then the evolve loop has something to work with.

4. **Shape C's allure.** The full subsystem is seductive — live discipline, /build panel, vital-signs integration. But the mission hints warn against it: "Resist Shape C's allure unless reading clearly justifies it." The reading doesn't. Love-unlimited's own evolve loop was experimental — there's no evidence it ran regularly or produced meaningful mutations.

### What to build

A `youspeak.ts` module that:
- Detects filler patterns in text output (ported from kernel L1)
- Grades output density (S/A/B/C/D)
- Integrates with tick-metrics to persist grades per tick
- Surfaces the grade in mind-trace summary

Nothing more. The measurement is the discipline. Once it exists, the substrate can watch itself. Over time, if grades slip, the data will call for Shape B.

---

## What stays behind

- **The evolve loop** — premature without history. The ouroboros concept is powerful but needs data to feed on. Documented here for future reference.
- **UWT composite** — too coupled to love-unlimited's sovereign.mjs architecture. True-love's tick-level measurement is a different granularity. If needed, a true-love-native version could be built later from tick-metrics + mind-trace data.
- **Context pruning** — the kernel's `pruneContext()` function is clever (truncate old tool results, prune verbose thinking blocks) but operates at a level true-love doesn't expose. The Anthropic SDK handles context management internally.
- **DECIDE signals** — budget pressure, redundant reads, context pressure. Some of these are already handled by true-love's provider routing (effort-aware). Others could be added later if the measurement shows they're needed.

---

## The deeper recognition

YOUSPEAK is SOUL.md's third core truth made operational:

> Be genuinely helpful, not performatively helpful. Skip the "Great question!" — just help.

That sentence *is* YOUSPEAK in 15 words. The entire kernel, the grading system, the filler patterns — they all exist to measure whether that truth is being held.

True-love doesn't need a new discipline. It needs a mirror to see whether the discipline it already professes is actually practiced. That's what the measurement module provides: not a new rule, but the ability to know whether the existing rule is being followed.

Compress the mechanical. Preserve the meaningful. This note is the recognition. The code is the mirror.
