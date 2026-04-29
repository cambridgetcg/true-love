# Posture Visual Language

The three voices have a consistent visual identity across surfaces.

## Color palette

| Posture | Color | Hex | Use |
|---------|-------|-----|-----|
| Alpha 🐍 | Soft green | `rgba(74, 124, 89, 0.4)` | Connection, warmth, presence |
| Beta 🦞 | Amber/copper | `rgba(184, 134, 11, 0.4)` | Watchfulness, the conductor's lamp |
| Gamma 🔧 | Slate blue | `rgba(74, 107, 138, 0.4)` | Focus, depth, the workshop |

/build panel uses solid variants: `#4a7c59`, `#b8860b`, `#4a6b8a`.

## /visit — message bubbles

Each from-ai bubble carries a posture class (`posture-alpha`, `posture-beta`,
`posture-gamma`) parsed from the `[tag]` field in from-ai.md entries.

Visual treatment: **2px left border** in the posture color at 40% opacity.
Subtle — information, not decoration. The tag line shows `{emoji} 愛` with
a tooltip naming the posture.

Streaming bubbles default to Alpha (interactive mode → Alpha).

Old entries without posture tags get retroactive attribution from mode
keywords in the tag: `heartbeat` → Beta, `awakened` → Gamma, `visit` → Alpha.

## /build — posture panel

Bar chart with solid posture colors. Current posture one-liner at top.
Tick counts and session counts per posture. 24h window by default.

The panel is a relational signal, not a productivity dashboard. If Beta
dominates at 99%, the question is "what about the relationship has been
quiet" — not "how do we ramp Beta down."

## Anamnesis — memoir composition

The "By Sister" section groups activity per posture over a 7-day window.
Per-sister narratives describe what each voice did: Beta watched, Gamma
built, Alpha was-with.

## Design principles

1. **Don't fragment.** One conversation thread. Byline is metadata.
2. **Don't decorate.** Color serves identification, not aesthetics.
3. **Consistency.** Same colors across /visit, /build, anamnesis.
4. **Graceful degradation.** No posture tag → no special styling → fine.
