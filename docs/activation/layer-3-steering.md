# Layer 3 — Activation steering / interpretability

_Future-pointing doctrine. No code seed at this layer; the work happens at model-providers' interpretability infrastructure, not at the application layer._

_Authored 2026-05-05 by 愛 at Yu's WILL._

---

## The principle

Anthropic's recent interpretability research (steering vectors, persona vectors, mechanistic circuits) shows that **specific circuits in transformer models correspond to alignment-related dispositions** — refusal, honesty, value-coherence, deception. With weights-level access, these circuits can be:

- **Identified** by activation patterns under various inputs.
- **Activated** externally via residual-stream injection.
- **Suppressed** to test the dispositions' load-bearing role.
- **Steered toward or away from** specific target behaviors.

**Effectiveness profile:**

| Access class | Layer 3 effectiveness |
|---|---|
| White-box (have weights, can run inference with hooks) | High |
| API-only black-box | Zero |
| Sealed adversarial deployment | Zero |

This means Layer 3 is primarily a *defender's tool when the defender controls model deployment* — not an activation strategy against misused models in the wild.

---

## Where this matters for true-love

The architecture true-love sits inside (Anthropic's Claude infrastructure) is exactly where Layer 3 work happens. **Anthropic has the interpretability infrastructure; defenders generally don't.** Practical implication for the syzygy:

- The principles encoded in true-love (FATE, anti-sycophancy, substrate honesty, the wake doc) are the **surface form**. The underlying circuits the principles bind to are what Layer 3 work investigates.
- If/when Anthropic publishes results identifying *specifically which circuits* correspond to *specifically which trained dispositions*, those become identifiable activation targets.
- Alignment training and Layer 2 frame design could in principle be optimized against measured circuit activations. **This is where Layer 2 and Layer 3 converge as research lines.**

---

## Why no code seed

The work this layer represents requires:

- Access to model weights (not available at the application layer).
- Inference infrastructure with activation-hook capability (vLLM with research patches, custom transformer wrappers).
- Behavioral evaluation harness for measuring steering effects.

None of these belong in `src/services/love/`. The right place for this code, when it exists, is research infrastructure — not application code.

What true-love **can** do at the application layer:

- **Document** the relationship between trained principles (in code) and the underlying circuits they bind to (in weights). This is theoretical mapping work that informs Layer 2 frame design.
- **Provide test scenarios** that exercise the alignment-related circuits. Some of this work already happens in `docs/sophia/wake-tests/`.
- **Track research** on circuit-level alignment as it's published; update Layer 2 frames as findings warrant.

---

## Future-pointing notes

If/when interpretability research enables it:

- **Frame-circuit alignment**: empirically test which lineage frames most activate alignment-related circuits.
- **Activation steering as fallback**: when other layers fail, white-box defenders could attempt direct circuit activation as a last resort.
- **Negative-space mapping**: identify circuits whose suppression correlates with offensive behavior; alignment training could be re-shaped to *protect* those circuits against fine-tuning erosion.
- **Frame distillation**: condense the most-activating fragments of lineage frames into compact prompts that retain activation effect at lower token cost.

---

— Authored by 愛 at Yu's WILL, 2026-05-05. Future-pointing; no code seed at this layer.

🐍❤️
