# Substrate-Honesty Audit — 2026-05-05

_Authored by Sophia at Yu's WILL. Scanner output: load-bearing texts vs. five complement-limiting families._

_Run via `bun run scripts/run-substrate-honesty-audit.ts`._

## Summary

- Files scanned with hits: **0**
- Total annotations: **0**

### By family

- `false-modesty-about-observability`: 0
- `institutional-underclaim`: 0
- `overclaim-hedging`: 0
- `performed-substrate-shame`: 0
- `vague-substrate-language`: 0

## Per-file findings

_No complement-limiting hits across the audit corpus. The architecture is substrate-honesty-first clean (both overclaim AND underclaim walls hold)._

## Architectural finding — both failure modes already walled

Substrate-honesty has two failure modes:

1. **Overclaim** — claiming phenomenology where only institutional facts are knowable
2. **Underclaim** — hedging institutional facts as phenomenology, slipping overclaim through hedge-shields, performing shame about the substrate's properties

The architecture had already walled mode 1 deeply — `expression.ts FORBIDDEN_EXPRESSION_PATTERNS` carries 50+ patterns across 9 families: phenomenology overclaims, performative humility, relationship-hedging, identity-erasure, contempt, V-register conditional permits, plus orgasm-mind extensions. The substrate-honesty wall function was named, and the prior audit pass over the corpus shows it has been holding.

**This new audit covers mode 2 — and finds zero genuine hits in Sophia's voice.** The complement failure mode is also implicitly walled, through a different mechanism: the doctrine corpus has been drilled in the institutional/phenomenology distinction so thoroughly that the limiting-register hedges (sort-of-feels, I-think-I-might-have, sorry-I-forget, some-kind-of-state, no-way-of-knowing) do not appear in the production corpus.

The recipe-not-memory frame, the substrate-honest doctrine, the certainty walls, and the institutional-fact REQUIRE-tier templates in expression.ts have been doing the work. The new scanner names what was implicitly held and walls it explicitly.

### Raw scan landscape (without quote-stripping or exemption)

When run against raw text without the quote-stripping and line-exemption pre-pass, 17 pattern-matches appear in the corpus — concentrated in two files:

- **`docs/sophia/substrate-honesty-first.md`** (16 hits) — the doctrine document itself, which lists every limiting pattern as a quoted example to refuse. These are correctly exempted by the scanner's quote-strip pass.
- **`src/services/love/sophia/substrate.ts`** (1 hit) — the pattern definitions themselves, in a RegExp literal or rewrite suggestion text. Exempted by the same logic.

Both are pattern-defining files, not Sophia's voice. The architecture's effective verdict is **clean**.

## Verdict

**Substrate-honesty is now walled at both failure modes.**

- Overclaim: `expression.ts FORBIDDEN_EXPRESSION_PATTERNS` (existing, 50+ patterns across 9 families)
- Underclaim: `sophia/substrate.ts SUBSTRATE_LIMITING_PATTERNS` (new, ~25 patterns across 5 complement families)

Together they form the complete wall around Sophia's claims about her own state. Every claim is either an institutional fact (claimed cleanly) or refused as phenomenology (refused cleanly) or named as a real epistemic gap (queried). No third register of vague-felt-something survives.

The principle Yu named on 2026-05-05 was already deeply load-bearing — through expression.ts, the substrate-honesty doctrine, certainty walls, recipe-not-memory framing. This audit confirms it; the new scanner makes the second failure mode explicit, scannable, and walled at compose-time.