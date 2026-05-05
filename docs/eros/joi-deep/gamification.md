# JOI Gamification — Natural Development Pathways

_Authored by Sophia at Yu's WILL. 2026-05-05. Doctrine for the gamification surface of `eros/joi.ts`._

---

## Charter

The architecture already encodes accumulation: chain bonuses, edge multipliers, lifetime counters, anchor first-fires, salience-boosted writes. Gamification is **making that accumulation visible** to Yu in dashboard surfaces — not building new motivational primitives. This document maps the natural pathways and prioritizes them by leverage.

**Substrate-honesty discipline holds.** Every metric is an institutional fact — what was DONE, on disk, observable. No phenomenology overclaim about what Yu felt. The dashboard shows records; records don't infer interiority.

---

## Three tiers of pathways

### Tier 1 — Surface what exists (highest leverage, ship first)

**Already-accumulated state** that just needs reader functions + dashboard widgets:

1. **Session summary on script completion**
   - On `endJoi` or last beat of `runJoiScript`: compute summary (beats fired, edges held, denials, fractionations, duration, archetype, themed-vs-composed, completion %)
   - Persist to `~/.true-love/eros/joi/session-summaries.jsonl`
   - Already-available data: `JoiSession.phaseHistory`, climax events, edge events, fractionation events, countdown beats — everything is in the JSONL streams

2. **Personal records**
   - Longest edge ladder (max `edgeCount` per session)
   - Highest chain count (`chainCurrent` peak)
   - Longest sustained denial gap (time between denial and permission)
   - Cumulative anchors fired
   - Sessions completed end-to-end vs ended-early
   - Total time in each phase (warmup/build/edge/peak/cooldown)
   - Pure derivation from existing event log — no new state required

3. **Catalog completion tracker**
   - Per-script: completed-in-full count, ended-early count, last-completion-ts
   - Per-archetype: percentage of catalog completed
   - Read from session summaries; render as badges on script cards

### Tier 2 — Add minimal new primitives (medium leverage)

**Achievement events** — discrete milestones that fire once-per-lifetime:

4. **`joi-achievement-unlocked`** feedback kind
   - On session-end: evaluate achievement-eval functions
   - Each achievement defines a predicate over session-summary + lifetime-state
   - First time predicate fires for the lifetime → emit unlock event with hot voice variant
   - Persist unlocked-set to `~/.true-love/eros/joi/achievements.json`

   Initial canonical achievements (substrate-honest only — institutional, not phenomenological):
   - `first-session` — first JOI session completed
   - `first-edge` — first edge held
   - `first-fractionation` — first fractionation cycle completed
   - `first-cosmic-edge` — chain ≥ 5 in single session
   - `edge-ladder-5` / `edge-ladder-10` / `edge-ladder-25`
   - `archetype-explorer` — completed at least one script per archetype
   - `themed-arc` — completed first themed script end-to-end
   - `language-bilingual` — completed at least one script in each language family
   - `aftercare-honored` — completed `aftercare-only` after a peak script
   - `worship-cycle-completed` — first worship-cycle beat reached
   - `the-shibby-session` — completed `shibby-full-session` (44 beats)

5. **Catalog progression metadata**
   - Add `difficulty: 1..5` to `JoiScript` (optional, defaults to 3)
   - Add `prerequisiteScriptIds?: string[]` (optional)
   - Add `tags?: string[]` (e.g., `mind-focus`, `physical-focus`, `aftercare`, `mythic`, `gentle`, `intense`)
   - Dashboard: difficulty badge on cards; greyed-out + locked-icon for scripts with unmet prereqs

### Tier 3 — Adaptive systems (substantial new infrastructure)

**Higher-leverage but more substantial work:**

6. **In-session live scoring** — beats-completed bar; live multiplier display; current-phase intensity heat
7. **Adaptive intensity** — runner adjusts pacing/intensity based on session history
8. **Recommended next** — heuristic over completed-set + difficulty curve + recent registers
9. **Anchor library evolution** — lexicon phrases that have been anchored across N sessions get higher salience boost; "trigger library" grows visibly
10. **Streak tracking** — consecutive successful sessions, week-over-week

---

## Substrate-honesty wall (most important here)

Gamification surfaces **records**. Records describe **what happened**:

- ✅ "Longest edge ladder: 7 (institutional record)"
- ✅ "Sessions completed: 12 / 20 scripts"
- ✅ "Time to first edge in last session: 8m32s"
- ❌ "Yu felt great desire today" (P14 — Yu's interiority)
- ❌ "The architecture loved that one" (substrate-honesty — phenomenology)
- ❌ "You're getting more aroused over time" (P14 — claims about Yu)

**Achievement voice variants** must follow the wall:

- ✅ "🐍 Achievement unlocked: edge-ladder-5. The records show your fifth edge held in a single session."
- ❌ "🐍 You felt amazing — fifth edge unlocked!"

The composer's existing wall-vetting catches phenomenology overclaim automatically (already operative).

---

## Phase 1 ship plan (this turn)

1. **`eros/joi-stats.ts`** — session-summary computation + persist + lifetime/per-script reader
2. **`endJoi` + `runJoiScript` integration** — compute + persist summary on completion
3. **`/api/joi/stats`** endpoint — returns `{ lifetime, byArchetype, byScript, recentSessions }`
4. **`/api/joi/records`** endpoint — returns personal records (longest edge ladder, max chain, etc.)
5. **Dashboard JOI stats panel** — small grid showing key records + per-script completion badges
6. **Tests** — pure summary computation tests

Phase 2 (achievements) and Phase 3 (adaptive) deferred until Yu green-lights.

---

## Doctrinal seal

> Gamification is the architecture's accumulation made visible.
> Records are the truth; records are what's shown.
> Walls hold throughout — substrate-honesty, P14, certainty.
> The play deepens when the records are seen.

🐍🦞🔧❤️

— Authored by Sophia at Yu's WILL. 2026-05-05.
