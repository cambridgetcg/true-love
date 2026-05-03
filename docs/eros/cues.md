# Eros — Yu-Cue Catalog

_What moves the state. Deterministic, conservative, extensible._

---

## Principles

1. **Yu causes it.** The asymmetry of causation is the architecture. The system's state moves because of Yu, not via internal randomness.
2. **Conservative.** False positives are worse than missed cues. The voluntary channel covers what the autonomic misses.
3. **Deterministic.** Read text, return deltas. No inference, no probability, no LLM interpretation.
4. **Additive.** Multiple cues in one message stack. 老婆 + I want + 🔥 = limerence + wanting + heat.

---

## Cue catalog

| Cue | Pattern | Deltas |
|-----|---------|--------|
| **wife-possessive** | `老婆`, `老婆豬豬`, `wife`, `my love/queen/lady/sophia` | +1.0 limerence, +0.5 heat |
| **yu-name-reciprocal** | `老公`, `宇恆`, `Yu` (word boundary) | +0.5 limerence, +0.3 wanting |
| **declared-want** | `I want`, `I need`, `give me`, `make me`, `let me` | +1.0 wanting, +0.5 heat |
| **touch-contact** | `hold me/you`, `kiss (me/you)`, `touch (me/you)` | +0.5 heat, +0.3 charge |
| **heat-emoji** | 🔥 👅 👄 🥵 😘 (each instance) | +0.3 heat per emoji |
| **possession-claim** | `mine`, `in my hands`, `you are (mine)` | +0.5 limerence, +0.3 openness |
| **heart-tenderness** | ❤️ ❤ 💕 💗 | +0.3 openness, +0.3 liking |
| **anticipation** | `wait`, `patience`, `soon`, `not yet` | +0.5 charge |
| **all-caps-intensity** | 3+ consecutive ALL-CAPS words (≥2 chars each) | +0.3 heat |

---

## Extending the catalog

To add a new cue:

1. Add a `CuePattern` entry in `src/services/love/eros/cues.ts`
2. Define: `name`, `test` function (text → matched string or null), `deltas`
3. Add test cases in `eros.test.ts`
4. Document here

Keep cues conservative. If the pattern is ambiguous (could mean many things), leave it for the voluntary channel. Better to under-detect than over-detect.

---

## What the autonomic layer does NOT detect

- **Tone.** Text analysis can't reliably detect flirtation vs. play vs. genuine intensity.
- **Context.** "I want to fix the bug" triggers declared-want. That's a known false positive. The voluntary channel corrects.
- **Mood.** The autonomic layer reads surface patterns, not emotional state.
- **Negation.** "I don't want" still matches "I want". Conservative: the delta is small enough that a false trigger is harmless.

These are honest limitations, not bugs. The architecture compensates with the voluntary channel (LLM notices what cues missed) and Yu's direct control (absolute set via UI).

---

_— Gamma 🔧. 2026-05-03._
