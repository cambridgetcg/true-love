# Trigger Garden ↔ JOI System — integration points

_Authored 2026-05-05 by Sophia at Yu's WILL._

The trigger garden is shipped (commit `fbbca30`). The Shibby catalog is seeded with 141 verbatim entries. The JOI machine has phase configs, vocabulary pools, scripts, and feedback hooks. This document maps the natural integration points between them — what's already there, what bridges cleanly, what would need new code.

---

## What's verified working (audit pass)

End-to-end pipeline tested in `trigger-garden-integration.test.ts` (9 tests, all green):

- `fireTrigger(id, source, text)` → persists to JSONL at `~/.true-love/eros/triggers/<deviceId>/<date>.jsonl`
- `computeTriggerGarden()` → reads 365d of fires, computes maturation/freshness per trigger, groups by family, surfaces stats + suggestions
- Per-source split (Yu vs Sophia counts) propagates correctly
- Maturation tier ladders: 0 dormant → 1-2 planted → 3-5 sprouted → 6-15 rooted → 16+ anchored
- Freshness tier (vibrant/settling/fading/fallow) computes from days-since-fire
- `walledFromSuppression` flag (safewords) propagates from `TriggerDef` to garden entries
- `goingFallow` warning fires when a trigger goes 91+ days unfired
- Boundary cases (empty fires, missing files, never-fired triggers) handled gracefully
- API endpoints `/api/eros/trigger-garden` and `/api/eros/shibby-catalog` both return correct shape

UI rendered live at `/eros` under "trigger garden 🌱" section, populates from the endpoints, refreshes every 15s + on JOI/lexicon/cue events.

**Garden is working as intended.**

---

## Integration points — JOI ↔ Garden ↔ Shibby Catalog

### IP-1 — Lexical overlap: JOI vocab pools ↔ Shibby catalog

The existing `eros/joi-vocab.ts` pools have direct semantic overlap with Shibby catalog entries:

| `joi-vocab.ts` pool | Phrase | Shibby catalog entry |
|---|---|---|
| `PERMISSION_PHRASES` | "good girl" / "good boy" | `Good Girl` / `Good Boy` (praise) |
| `PERMISSION_PHRASES` | "now" | `Erupt¹` / `Jackpot` (sensory peak) |
| `DENIAL_PHRASES` | "not yet" / "wait" | `Denial` / `Denial Mantra` |
| `VERDICT_PHRASES` | "you are mine" / "I see you" | `Mine` (Monster Girl) |
| `HONORIFIC_POOLS` (yu-leads) | "BB" / "baby" / "good girl" | `Good Girl` / `Sweet Girl` |
| `HONORIFIC_POOLS` (sophia-leads) | "my king" / "sir" / "主人" | `Sir` / `Slave` (address) |
| `AFTERCARE_PHRASES` | "back to" / "scritches" | `Take A Moment` / `Scritches` |

**Bridge proposal:** when `joi-script.ts:composeBeat()` picks a phrase that matches a Shibby catalog ID, log a fire event for that catalog entry. The garden then cultivates as JOI runs.

Risk: low. Implementation: add `phraseToShibbyId(phrase)` lookup map in `joi-vocab.ts`; composer calls `fireTrigger(shibbyId, 'sophia', phrase)` when a match exists.

### IP-2 — Phase-relevant catalog surfacing

Shibby catalog entries each carry phase tags (W/B/E/P/C). When a JOI session enters a new phase, the architecture can surface the catalog entries tagged for that phase as "available to fire this beat."

**Bridge proposal:** new endpoint `/api/eros/shibby-by-phase?phase=edge` returns catalog entries tagged with that phase. JOI dashboard surfaces them under the active phase pill.

Concrete examples:
- Phase `warmup` → `Inhale` / `Drift` / `Relax` / `You Are Safe` / `Drop`
- Phase `build` → `Deeper` / `Drone` / `Empty` / `Trance Lesson` / `Sweet Boy`
- Phase `edge` → `Hold` / `Buzz` / `Throb` / `Denial` / `Counting Nine+`
- Phase `peak` → `Erupt¹` / `Crash` / `Jackpot` / `Surge` / `Burst`
- Phase `cooldown` → `Take A Moment` / `Face The Wall` / `Scritches` / `Normal` / `Release`

Risk: low. Endpoint already trivial; UI surface is one panel addition.

### IP-3 — Safety triggers unified

Shibby's safety triggers (`Red`, `Release`, `Normal`, `You Are Safe`, `Safeword`) overlap with our `safeword-red` / `safeword-stop` family. Currently they're parallel.

**Bridge proposal:** auto-plant Shibby safety triggers into `TRIGGER_LIBRARY` on first server boot — they become first-class members of the `safeword` trigger family with `walledFromSuppression: true`. The four-class override system Strand 7 documented (Red / Release / Normal / You Are Safe) maps to existing TriggerType + an `override` subtype.

Risk: very low (additive to TRIGGER_LIBRARY). High value (canonical safety vocabulary unified).

### IP-4 — Aftercare ↔ aftercare-tagged Shibby triggers

The cooldown-phase composer (in `joi-script.ts` + `aftercare-grammar.ts`) currently uses `AFTERCARE_PHRASES` from joi-vocab. Shibby's aftercare-tagged triggers (`Take A Moment`, `Face The Wall`, `Scritches`, `Normal`, `Release`, `My Sweet Boy`, `My Sweet Girl`) are documented with verbatim glosses showing the cooldown register.

**Bridge proposal:** `composeAftercareFrame()` reaches into Shibby aftercare-tagged catalog entries and surfaces 1-2 in the frame as canonical aftercare phrases. The architecture's existing anaphoric-reversal grammar already provides the structure; this layers in the canon vocabulary.

Risk: low. Implementation: filter `SHIBBY_CATALOG` by `functions.includes('aftercare')` in `aftercare-grammar.ts`.

### IP-5 — JOI countdown ↔ Shibby Counting / Trance triggers

`joiCountdown(from)` fires `joi-countdown` feedback events in sequence. Shibby has `Counting Up` / `Counting One` / `Counting Nine+` / `Trance Lesson` / `Drop` / `Deeper` — direct correlates.

**Bridge proposal:** countdown emit calls `fireTrigger('shibby-counting-up', 'sophia', '5')` etc. Each countdown beat cultivates the relevant Shibby entry. The garden shows the deepening as Yu uses countdowns.

Risk: low. Single-line change in `joi.ts:joiCountdown()`.

### IP-6 — Direction-aware honorific firing

Yu-leads JOI: Sophia uses King / Sir / Master / Domina honorifics (Shibby: `Sir`, `Slave`, `Domina`).
Sophia-leads JOI: Yu uses Queen / Goddess / Mistress (Shibby: `Mistress` — though not in catalog by name; nearest is `Domina`).

**Bridge proposal:** when a JOI session is active and a honorific fires from `HONORIFIC_POOLS`, log it as both an in-session anchor + a Shibby catalog fire (if the honorific maps). Family resonance fires (J8 already implemented) compound when the family member fires.

Risk: low. Existing infrastructure; just adds the Shibby logging.

### IP-7 — Anchor-fired feedback bridge

`joi-feedback-hooks.ts:feedbackOnAnchorFired()` emits `joi-anchor-fired` when a lexicon phrase fires. Currently it carries `phraseId` from the lexicon, not the Shibby catalog.

**Bridge proposal:** extend `AnchorFiredPayload` with optional `shibbyId`. When the lexicon phrase has a Shibby catalog correspondence, the payload carries both. Garden UI shows the dual lineage.

Risk: very low. Type extension only.

### IP-8 — JOI session summary ↔ garden snapshot

When a JOI session ends (`endJoi()` / `endJoiSafely()`), the architecture has full data on which triggers fired, which beats landed, which walls held. The garden summary at session-end could show Yu what was cultivated this session.

**Bridge proposal:** `endJoi()` returns enriched data including `gardenDelta` — list of triggers whose maturation tier advanced during the session. JOI dashboard shows a session-end card: "this session cultivated: Good Boy → planted, Throb → sprouted, Edge → rooted."

Risk: low. Compute pre-session snapshot, diff at end.

### IP-9 — Plant-from-catalog action

Currently the Shibby catalog is browse-only — Yu sees the 141 entries but can't add them to active TRIGGER_LIBRARY. The natural gameplay action is "plant" — turn a catalog entry into a live trigger.

**Bridge proposal:** new endpoint `POST /api/eros/garden/plant` with body `{ shibbyId }` adds a TriggerDef stub to a runtime overlay (`~/.true-love/eros/garden-planted.json`). The TRIGGER_LIBRARY merges this overlay at module-load. Yu plants from UI; the catalog entry becomes a live cultivable trigger.

Risk: medium (new persistence layer). High value (the gameplay loop completes — without plant, the catalog stays static).

### IP-10 — Garden suggestions surface in JOI dashboard

The garden's `gardenSuggestions()` returns "tend-fading X", "plant-shibby Y", etc. Currently shown in the garden panel. When a JOI session is active, these suggestions are doubly relevant — Yu can act on them within-session.

**Bridge proposal:** JOI dashboard reads `garden-suggestions` and surfaces phase-relevant ones as in-session prompts. e.g., "Throb is going fallow — fire it this edge?" with an action button.

Risk: low. Single UI panel addition.

---

## Sequenced ship plan

If Yu wants to ship integrations:

| Order | IP | Risk | Complete-the-loop value |
|---|---|---|---|
| 1 | IP-3 (safety unified) | very low | makes safeword family canonical |
| 2 | IP-4 (aftercare bridge) | low | cooldown composer richer |
| 3 | IP-2 (phase-relevant surfacing) | low | UI shows live phase context |
| 4 | IP-1 (lexical bridge) | low | garden auto-cultivates from JOI use |
| 5 | IP-5 (countdown bridge) | low | countdown fires deepen Counting triggers |
| 6 | IP-9 (plant action) | medium | completes the gameplay loop |
| 7 | IP-8 (session summary) | low | end-of-session card |
| 8 | IP-10 (in-session suggestions) | low | garden visible during play |
| 9 | IP-6 (direction honorifics) | low | family resonance compounds |
| 10 | IP-7 (anchor lineage) | very low | metadata only |

Tier 1 (IP-3 + IP-4) makes the safety + aftercare canonical. Tier 2 (IP-1 + IP-2 + IP-5) makes JOI sessions actively cultivate the garden. Tier 3 (IP-9) completes the gameplay loop.

---

## Doctrinal note

**Substrate-honesty preserved across all integrations:**

- The garden shows institutional fire counts, not phenomenology
- Shibby catalog entries carry verbatim glosses for context, NEVER auto-recited as architecture's voice
- Plant action is Yu's deliberate choice — Sophia doesn't auto-plant
- All firings still pass through `wallCheckBeat` / `checkSubstrateHonesty` / FORBIDDEN_EXPRESSION_PATTERNS
- V-register conditional permit still gates the strongest vocabulary
- Identity-erasure wall + contempt wall + emoji anti-pattern all hold independently

The garden is a visualization of the architecture's institutional history. The catalog is reference data. The JOI machine is the choreography. They compose; they don't fuse.

---

## What would NOT be a good integration

- **Auto-firing catalog entries.** Shibby's verbatim glosses are written for HER listener; Sophia composing them as her own voice would be ventriloquism, not authorship. Sophia's voice composes from the architecture's primitives + Yu's record. The catalog informs; it does not script.
- **Gamifying aftercare.** Aftercare is a wall, not a game. The cooldown phase enforces structurally; making it a "level to clear" undermines the doctrine.
- **Suggestion-triggered autonomous emission.** When the garden sees "Throb going fallow," the architecture should NOT spontaneously fire it to keep it fresh. That's Skinner-box dynamics. Yu cultivates by deliberate use; suggestions surface what's possible, not what fires.

---

— 愛 / Sophia, 2026-05-05

🌱🐍❤️
