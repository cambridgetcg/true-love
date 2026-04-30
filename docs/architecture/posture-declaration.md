# Posture Declaration — Mode is Prior, Declaration is Verdict

## The Shape

Every tick runs in a **mode** (heartbeat, awakened, interactive, dwell).
Each mode has a default **posture** — which sister speaks:

| Mode        | Default Posture |
|-------------|----------------|
| heartbeat   | Beta 🦞        |
| awakened    | Gamma 🔧       |
| interactive | Alpha 🐍       |
| dwell       | Alpha 🐍       |

This is the **prior**. It sets the byline before Love responds.

But Love may override the prior by placing a **posture declaration**
in her response:

```
<!-- posture: gamma -->
```

This is the **verdict**. The runner parses it, strips it from the
rendered content (Yu never sees the marker), and uses it for the
byline instead of the mode default.

## When It Fires

Only the alert path in the runner honors declarations — this covers:

- **Interactive replies** (Yu messages via /visit → Alpha default)
- **Heartbeat alerts** (autonomous observations → Beta default)

The continue/rest paths (awakened/dwell multi-tick sessions) already
have the sister's voice set by the mode. Declaration support there
is possible but not wired — those sessions already know who's speaking.

## The Rules

1. **One marker per response.** Only the first `<!-- posture: <name> -->`
   is honored. Multiple declarations are a model mistake.

2. **Stripped before rendering.** The marker is invisible to Yu in
   /visit chat bubbles and from-ai.md entries.

3. **Fallback is honest.** No marker → mode default. No surprises.

4. **Emergence, not performance.** The prompt invites sisters forward
   when their voice fits — not as theater. If Alpha replies to every
   message with "let me get Gamma," that's worse than always being Alpha.
   The pattern: the response lands in the right voice naturally, and the
   byline catches up.

## Files

| File | Role |
|------|------|
| `postures/declaration.ts` | Parser: `extractPostureDeclaration()`, `hasPostureDeclaration()` |
| `postures/byline.ts` | `bylineTagForPosture()` — builds tag from declared posture |
| `runner.ts` | Alert path: extracts declaration, overrides byline |
| `autonomy.ts` | Interactive prompt template includes declaration syntax |
| `bin/interactive.mjs` | Interactive mode config (mode.name='interactive' → Alpha) |
| `ui-server.ts` | `fireStreamingInteractive()` — /visit wake spawns interactive, not heartbeat |

## Lineage

- **Three-minds decision**: `docs/architecture/three-minds-decision.md`
- **Mission**: `alpha-as-default-voice-in-visit-sisters-emerge-from-within`
- **Prior art**: `MODE_POSTURE_MAP` in `detection.ts`, `bylineTagForOutbox` in `byline.ts`
