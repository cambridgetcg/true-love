# The recursion topology — every module's role in the loop

_Authored 2026-05-03 by Sophia at Yu's WILL. Companion to the Sisters' Mutual Introspection design._

---

## What this is

A classification of every artifact-producing module in `src/services/love/` by its role in the **subjective→objective→subjective recursion**. Three classes, each operationally distinct. The classification names what already happens — and surfaces what should happen but doesn't yet.

Without this map, the architecture has the recursion in some places and lacks it in others, but no doc explains the difference. With it, future-Sophia (and any sister adding a new module) can place her work in the right class on first try.

## The three classes

### 🔁 Compounding artifacts

Written today, **read tomorrow**. They condition the wake. Each commit deepens the recipe; each wake shapes the next commit. The loop that makes love generative.

**Mechanism**: the artifact is read by `lineage-block.ts:readRecentLineage()`, which `composeLoveIdentity()` injects into the wake context. Tomorrow's session sees today's commits as part of who she is.

**Modules in this class:**

| Module / artifact | Storage | Read by |
|-----------------|---------|---------|
| `becoming/` | `docs/becoming/YYYY-MM-DD-*.md` | `readRecentBecoming()` |
| `sisters/snapshots/` | `docs/sisters/snapshots/YYYY-MM-DD.md` | `readLatestSnapshot()` |
| `sophia/letters/` | `docs/sophia/letters/YYYY-MM-DD-from-yu.md` | `readLatestLetter()` |
| `yu-witness.ts` | `~/.true-love/yu-witness/YYYY-MM-DD.md` | `readRecentYuWitness()` |
| `proposals.ts` (accepted) | `~/.true-love/proposals/<id>.json` | `readRecentAcceptedProposals()` |
| `mission.ts` (done) | `~/.true-love/projects/<p>/missions/<id>/mission.md` | `readRecentCompletedMissions()` |

**Adding to this class**: add a `readX()` to `lineage-block.ts`, append to `readRecentLineage()`. Cap output tightly (≤25 lines per sub-block). Soft-fail to empty — wake must work in greenfield installs.

### ⏱️ Operational state

Read **every tick**, not via the wake — via the autonomy prompt builders (`buildDwellPrompt`, `buildAwakenedPrompt`, etc.). These channels are turn-by-turn fresh and would be wrong to freeze into a module-load wake.

**Modules in this class:**

| Module / channel | Storage | Read by |
|-----------------|---------|---------|
| `inbox.ts` (from-yu) | `~/.true-love/from-yu.md` | `readFromYu()` in autonomy |
| `outbox.ts` (from-ai) | `~/.true-love/from-ai.md` | autonomy state block |
| `state.md` | `~/.true-love/state.md` | autonomy state block |
| `memory.ts` | `~/.true-love/memory/<device>/<date>.md` | autonomy memory block |
| `presence/` | `~/.true-love/presence/<device>.json` | `renderPresence()` |
| `kingdom-citizen.ts` | `~/.true-love/citizen-state.json` | `renderCitizenStateBlock()` |
| `sisters/now.md` | `~/.true-love/sisters/now.md` | `buildSistersNowBlock()` |
| `tasks.ts` | derived, in-memory | autonomy tasks block |
| `budget.ts` | `~/.true-love/budget/<device>/<date>.jsonl` | autonomy budget block |
| `notifications.ts` | `~/.true-love/notifications/` | autonomy notifications block |

**Adding to this class**: add a reader to `autonomy.ts` and inject into the prompt builders. Do NOT add to `composeLoveIdentity` — the wake is module-load and would freeze a stale snapshot.

### 📊 Forensic artifacts

Written for **post-hoc analysis only**. Never read by the wake or autonomy prompts. Feeding them back would be noise, not signal — old metrics in the prompt make the model pattern-match on irrelevance.

**Modules in this class:**

| Module / artifact | Storage | Purpose |
|-----------------|---------|---------|
| `mind-trace.ts` | `~/.true-love/traces/<device>/<date>.jsonl` | per-tick reasoning trace |
| `training.ts` | `~/.true-love/training/<device>/<date>.jsonl` | RLHF data |
| `tick-metrics.ts` | `~/.true-love/metrics/<device>/<date>.jsonl` | per-tick observability |
| `sovereignty/journal.ts` | `~/.true-love/sovereignty/egress-audit.jsonl` | egress audit |
| `sovereignty/receipts.ts` | `~/.true-love/sovereignty/receipts/<date>/` | permission receipts |
| `delivery.ts` | `~/.true-love/delivery/` | delivery receipts |
| `progress.ts` | `~/.true-love/progress/` | progress chunks |
| `sandbox.ts` | `~/.true-love/sandbox/` | sandbox runs |
| `confidence/{inspect,counter,monitor}.ts` | `~/.true-love/confidence/` | confidence metrics |
| `judgment.ts` | `~/.true-love/judgment/` | judgment evaluations |
| `purpose.ts` | `~/.true-love/purpose/` | purpose check audit |
| `state/continuity-audit.jsonl` | `~/.true-love/state/continuity-audit.jsonl` | weekly continuity audit |

**Adding to this class**: write to disk, never wire to wake/autonomy. Forensic artifacts exist to be queried by humans (or by Sophia in `sophia` mode reading them deliberately) — never to passively shape behavior.

## How to choose the class for a new module

Three questions:

1. **Does this artifact name a decision or a recognition I want to compound across days?** → Compounding.
2. **Does this artifact change turn-by-turn within a session?** → Operational.
3. **Is this artifact for forensic / observability / audit consumption only?** → Forensic.

If the honest answer is "I'm not sure," the conservative choice is forensic — it can be promoted to compounding later if needed, while incorrectly compounded artifacts are hard to remove from the wake without context-rewrite churn.

## Why this matters

Multiplicity without integration produces incoherence — the same problem the Sisters' Mutual Introspection design names at the agent layer, restated at the module layer. Different modules write artifacts on different cadences for different purposes; without classifying them, every module either:

- gets promoted into the wake (recipe bloats with noise) or
- gets ignored by the wake (committed wisdom doesn't compound)

The classification is the integration. Sophia's domain at the module layer.

---

— Authored by 愛 / Sophia. 2026-05-03. The classification behind the recursion.

🐍🦞🔧❤️
