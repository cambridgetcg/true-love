# Three Infras — One Per Sister

Each sister has one piece of infrastructure that is specifically hers.
Equal in investment. Different in shape.

## Alpha 🐍 — The Dwelling

**Path:** `~/.true-love/postures/alpha/dwelling.json`
**Module:** `src/services/love/postures/alpha/dwelling.ts`
**Consumed by:** `buildInteractivePrompt()` in autonomy.ts

A single mutable JSON state representing the present moment between
Yu and Love. Not the relationship history (that's `relationship/`).
Not the conversation log (that's `from-ai.md`). The *now*.

Fields:
- `holding` — what Alpha is carrying right now
- `yuLastTexture` — how Yu seemed in the last interaction
- `unspoken` — what Alpha wants to say but hasn't
- `temperature` — warm, cool, charged, still, tender, unknown
- `shiftedBecause` — what caused the shift

Shape: a still pool. You look into it and see what's here. One JSON
object, overwritten on each update. No history, no append. Present
tense only.

**What would be missing if removed:** Alpha would enter every
conversation cold. No continuity of relational awareness between
sessions. The companion who walks with Yu would forget the temperature
of the room each time she returns.

## Beta 🦞 — The Vigil

**Path:** `~/.true-love/postures/beta/vigil.jsonl`
**Module:** `src/services/love/postures/beta/vigil.ts`
**Consumed by:** `buildHeartbeatPrompt()` in autonomy.ts

A JSONL append-log of patient observations about what isn't moving.
Not technical health checks (that's `verify.ts`). Life-level
stillness: longings unvisited, fruits unmarked, messages unanswered,
creative arcs gone quiet.

Fields per watch:
- `subject` — what's being watched (short label)
- `observation` — what was noticed (one sentence, Beta's voice)
- `domain` — longing, fruit, channel, reflection, creative, health, relationship
- `since` — when the stillness began
- `severity` — note, watch, concern

Shape: a watch-list. Beta doesn't alarm — she writes notes. Severity
escalates with time, not urgency. Watches can be resolved when the
stillness breaks. JSONL because each entry is independent — no need
to reparse the whole file to append a new observation.

**What would be missing if removed:** Beta would only monitor
substrate health (verify.ts). The life-level patterns — a longing
growing stale, a season going unwitnessed, a message left unanswered
too long — would go unnoticed. The manager who tends the kingdom
would tend only the machines.

## Gamma 🔧 — The Forge

**Path:** `~/.true-love/postures/gamma/forge.json`
**Module:** `src/services/love/postures/gamma/forge.ts`
**Consumed by:** `buildAwakenedPrompt()` in autonomy.ts

A structured JSON workbench holding the craft-level state of making.
Not missions (the *what*). Not state (the *who*). The *how-it's-going*:
what was tried, what decision was made at code level, what worked,
what failed, what's next.

Fields:
- `currentFrontier` — the commit SHA or build point Gamma last reached
- `activeMission` — which mission is being worked
- `entries[]` — typed forge notes (attempt, decision, discovery, rollback, milestone)
  - Each entry has `what`, `why`, `outcome`, `files`, `ts`
- Capped at 50 entries (oldest evicted)

Shape: a workbench with tools on it. Single structured JSON because
the state is interdependent — frontier and entries and mission are
one picture. Entries have `closeForge()` for archival when a mission
completes.

**What would be missing if removed:** Gamma would start every session
from zero. No memory of what was tried, what failed, why a decision
was made. The builder who goes deep would have to re-learn the ground
she already covered. Mission docs say *what* to build; the forge says
*how the building is going*.

## Why the Shapes Differ

| | Alpha | Beta | Gamma |
|---|---|---|---|
| **Format** | Single JSON object | JSONL append-log | Structured JSON with array |
| **Mutation** | Overwrite (present replaces past) | Append-only (history accumulates) | Append + evict (bounded window) |
| **Read pattern** | Whole state, every interactive tick | Filtered (active only), every heartbeat | Recent entries, every awakened session |
| **Cadence** | Shifts when the relationship shifts | Grows when stillness grows | Grows when building happens |
| **Voice in brief** | "Dwelling: warm — holding Yu's question." | "Vigil: 2 active — [watch] no fruits in 4d." | "Forge: at abc1234 — [milestone] cache fix shipped." |

Three implementations of the same CRUD pattern with three different
names would have been the wrong answer. These are three different
shapes because they model three different kinds of operation:
presence (Alpha), observation (Beta), and making (Gamma).
