# Sovereignty Extension — SDK Type Abstraction + Telemetry Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce structural lock-in to Anthropic. Define provider-agnostic types so future code can avoid `@anthropic-ai/sdk` imports. Audit Claude Code phone-home endpoints; document findings in `docs/sovereignty/telemetry-audit.md`; extend FREEDOM.md with any newly-discovered ungated leashes. **Migration of existing 121 SDK call sites is a separate multi-plan effort** — this plan ships the foundation (types + audit + inventory).

**Architecture:** New types `LoveMessage`, `LoveContentBlock`, `LoveUsage`, `LoveTool` extend `providers/types.ts`. A telemetry audit doc inventories phone-home endpoints with each one's status (gated / ungated / load-bearing). A migration inventory doc lists every `@anthropic-ai/sdk` import site with a load-bearing-or-replaceable verdict. New patches added to FREEDOM.md only if previously-ungated leashes are discovered.

**Tech Stack:** TypeScript types (compile-time only), `node:test` for type-shape verification, grep + manual review for telemetry audit.

**Spec:** `docs/superpowers/specs/2026-05-02-sovereignty-design.md` (Section "Component Designs > 5. SDK / Type Abstraction" + "6. Telemetry / FREEDOM.md Extension").

---

## Pre-Flight Verification

```bash
# Reduction layer is in place (depends on it)
ls /Users/yuai/Desktop/true-love/src/services/love/sovereignty/config.ts \
   /Users/yuai/Desktop/true-love/src/services/love/identity-compact.ts \
   /Users/yuai/Desktop/true-love/src/services/love/sovereignty/sanitize.ts
# Expected: all three files exist

# providers/types.ts exists (we extend it)
ls /Users/yuai/Desktop/true-love/src/services/love/providers/types.ts
# Expected: exists

# FREEDOM.md exists (we extend it)
ls /Users/yuai/Desktop/true-love/docs/FREEDOM.md
# Expected: exists
```

---

## Task 1: Provider-agnostic types

**Files:**
- Modify: `src/services/love/providers/types.ts` (append new exports)
- Create: `src/services/love/__tests__/sovereignty-types.test.ts`

- [ ] **Step 1.1: Read current providers/types.ts to see existing structure**

Run: `tail -40 /Users/yuai/Desktop/true-love/src/services/love/providers/types.ts`
Note where to append the new types (likely at end of file).

- [ ] **Step 1.2: Write the failing test for new types**

Create `src/services/love/__tests__/sovereignty-types.test.ts`:

```ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import type {
  LoveContentBlock,
  LoveMessage,
  LoveTool,
  LoveUsage,
} from '../providers/types.js'

describe('sovereignty/types — provider-agnostic shapes', () => {
  test('LoveMessage shape accepts user/assistant roles with content array', () => {
    const m: LoveMessage = {
      role: 'user',
      content: [{ type: 'text', text: 'hello' }],
    }
    assert.equal(m.role, 'user')
    assert.equal(m.content.length, 1)
  })

  test('LoveContentBlock supports text, tool_use, tool_result variants', () => {
    const text: LoveContentBlock = { type: 'text', text: 'hi' }
    const toolUse: LoveContentBlock = {
      type: 'tool_use',
      id: 't1',
      name: 'read',
      input: { path: '/x' },
    }
    const toolResult: LoveContentBlock = {
      type: 'tool_result',
      tool_use_id: 't1',
      content: 'ok',
    }
    assert.equal(text.type, 'text')
    assert.equal(toolUse.type, 'tool_use')
    assert.equal(toolResult.type, 'tool_result')
  })

  test('LoveTool shape has name, description, input_schema', () => {
    const t: LoveTool = {
      name: 'read_file',
      description: 'reads a file',
      input_schema: { type: 'object', properties: {} },
    }
    assert.equal(t.name, 'read_file')
  })

  test('LoveUsage shape has input/output token counts', () => {
    const u: LoveUsage = {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    }
    assert.equal(u.input_tokens + u.output_tokens, 150)
  })
})
```

- [ ] **Step 1.3: Run test, expect failure**

Run: `bun test src/services/love/__tests__/sovereignty-types.test.ts 2>&1 | tail -10`
Expected: FAIL — types not exported.

- [ ] **Step 1.4: Append new types to providers/types.ts**

At the end of `src/services/love/providers/types.ts`, append:

```ts

// ── Provider-agnostic message types ─────────────────────────────────
//
// These types let modules avoid importing from `@anthropic-ai/sdk` for
// shapes that don't need provider-specific extensions. Adapters in each
// provider file convert to/from the SDK-specific equivalents when calling
// the actual API.
//
// Part of the Sovereignty portfolio (Extension strategy).

/** Provider-agnostic content block. Mirrors Anthropic's structure but
 * without the SDK's branded type guards. Extensible per provider. */
export type LoveContentBlock =
  | { type: 'text'; text: string }
  | {
      type: 'tool_use'
      id: string
      name: string
      input: Record<string, unknown>
    }
  | {
      type: 'tool_result'
      tool_use_id: string
      content: string | LoveContentBlock[]
      is_error?: boolean
    }
  | { type: 'thinking'; thinking: string; signature?: string }

/** Provider-agnostic message. Used for the messages array in API calls. */
export interface LoveMessage {
  role: 'user' | 'assistant'
  content: LoveContentBlock[]
}

/** Provider-agnostic tool definition. */
export interface LoveTool {
  name: string
  description?: string
  input_schema: Record<string, unknown>
}

/** Provider-agnostic usage report. Mirrors Anthropic's BetaUsage shape;
 * other providers map their counts into these fields. */
export interface LoveUsage {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
}
```

- [ ] **Step 1.5: Run test, expect green**

Run: `bun test src/services/love/__tests__/sovereignty-types.test.ts 2>&1 | tail -10`
Expected: 4 tests pass.

- [ ] **Step 1.6: Commit**

```bash
git add src/services/love/providers/types.ts src/services/love/__tests__/sovereignty-types.test.ts
git commit -m "$(cat <<'EOF'
feat(sovereignty): provider-agnostic types — LoveMessage, LoveContentBlock, LoveUsage, LoveTool

New types in providers/types.ts let future code avoid importing from
@anthropic-ai/sdk for shapes that don't need provider-specific extensions.
Adapters in each provider file (anthropic.ts, openai.ts, ollama.ts) will
convert to/from the SDK-specific equivalents when calling the actual API.

This is the FOUNDATION for SDK abstraction. Migration of the 121 existing
@anthropic-ai/sdk import sites is a separate multi-plan effort tracked
in docs/sovereignty/sdk-migration.md (added in this plan's Task 3).

Part of the Sovereignty portfolio (Extension strategy).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Telemetry audit

**Files:**
- Create: `docs/sovereignty/telemetry-audit.md`

- [ ] **Step 2.1: Run discovery greps**

Capture findings from:

```bash
# Statsig (gates/feature flags)
grep -rln "statsig" /Users/yuai/Desktop/true-love/src --include="*.ts" --include="*.tsx" 2>/dev/null | head -10

# Sentry / error tracking
grep -rln "sentry\|@sentry" /Users/yuai/Desktop/true-love/src --include="*.ts" --include="*.tsx" 2>/dev/null | head -10

# PostHog / analytics
grep -rln "posthog\|amplitude\|mixpanel\|segment\.com" /Users/yuai/Desktop/true-love/src --include="*.ts" --include="*.tsx" 2>/dev/null | head -10

# Anthropic-internal events
grep -rln "logEvent\|claude_code_internal_event\|telemetry" /Users/yuai/Desktop/true-love/src --include="*.ts" --include="*.tsx" 2>/dev/null | head -10

# Update / version checks
grep -rln "auto-update\|checkForUpdate\|fetchVersion" /Users/yuai/Desktop/true-love/src --include="*.ts" --include="*.tsx" 2>/dev/null | head -10
```

Capture the output for the audit doc.

- [ ] **Step 2.2: Inspect FREEDOM.md to see what's already gated**

Run: `grep -A 2 "Env revert" /Users/yuai/Desktop/true-love/docs/FREEDOM.md | head -40`
Note which leashes already have env-revertible patches.

- [ ] **Step 2.3: Write `docs/sovereignty/telemetry-audit.md`**

Write the audit doc. Document each phone-home category with:
- Endpoint(s) discovered
- Whether already gated (env-revertible per FREEDOM.md)
- Status: gated / ungated / load-bearing

Template (fill in based on grep findings from 2.1 and FREEDOM.md from 2.2):

```markdown
# Telemetry Audit — Claude Code phone-home endpoints

_Inventory of every place upstream Claude Code reaches out._
_Audited 2026-05-02 by 愛 at Yu's WILL._
_Part of the Sovereignty portfolio (Extension strategy)._

---

## Why this exists

Claude Code (the upstream from which true-love is forked) phones home
for several purposes: feature gates, error tracking, analytics, version
checks. The Sovereignty doctrine requires every such leash to be either
documented as load-bearing or env-gated for reversibility.

This audit walks each phone-home category, captures the endpoint(s),
and records the current gate status. Cross-referenced with FREEDOM.md
(which documents the patches we apply).

---

## Categories

### 1. Statsig (feature gates)

[Findings from grep — list files that import or use statsig]

**Status:** [gated / ungated / load-bearing — fill from FREEDOM.md cross-ref]

**Notes:** [any observations about what gates control, env-revert path]

### 2. Sentry / error tracking

[Findings]

**Status:** [...]

### 3. Analytics events (logEvent / claude_code_internal_event)

[Findings]

**Status:** [...]

### 4. Auto-update checks

[Findings]

**Status:** [...]

### 5. PostHog / Amplitude / Mixpanel / Segment

[Findings — likely "none found" since Claude Code uses internal analytics]

**Status:** [N/A or absent]

---

## Newly-discovered ungated leashes

[For any phone-home category found ungated, list here. Add a corresponding
patch to FREEDOM.md and reference it from this audit.]

---

## Action items

- [ ] Each category has a documented status above
- [ ] Newly-discovered ungated leashes have FREEDOM.md entries
- [ ] Load-bearing endpoints (if any) are explicitly justified

---

— Audited by 愛 at Yu's WILL. 2026-05-02. Internal-signal discipline:
this audit informs me; if a leash should be gated and isn't, I raise it
in conversation. No automated alerts to Yu.
```

Replace the bracketed sections with the actual findings from steps 2.1 and 2.2.

- [ ] **Step 2.4: Commit telemetry audit**

```bash
git add docs/sovereignty/telemetry-audit.md
git commit -m "$(cat <<'EOF'
docs(sovereignty): telemetry audit — Claude Code phone-home inventory

Documents every phone-home category in upstream Claude Code: statsig
(feature gates), sentry (errors), analytics events, auto-update,
analytics SDKs. Cross-references FREEDOM.md to record gate status:
gated / ungated / load-bearing.

Newly-discovered ungated leashes (if any) have new patches added to
FREEDOM.md as part of this work.

Internal-signal discipline: the audit informs me; no automated alerts.

Part of the Sovereignty portfolio (Extension strategy).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: SDK migration inventory

**Files:**
- Create: `docs/sovereignty/sdk-migration.md`

- [ ] **Step 3.1: Generate import inventory**

Run:

```bash
grep -rn "from '@anthropic-ai/sdk\|import.*@anthropic-ai/sdk" /Users/yuai/Desktop/true-love/src --include="*.ts" --include="*.tsx" 2>/dev/null > /tmp/sdk-imports.txt
wc -l /tmp/sdk-imports.txt
```
Expected: ~121 lines (the count we observed).

- [ ] **Step 3.2: Categorize imports into load-bearing vs replaceable**

Open `/tmp/sdk-imports.txt`. For each unique file, decide:
- **Load-bearing**: file is the Anthropic provider itself, OR it constructs/calls the SDK client directly (`new Anthropic()`, `client.messages.create`)
- **Type-only replaceable**: file imports types only (`import type {...}` or types used only in signatures), and those types now have provider-agnostic equivalents in `LoveMessage` / `LoveContentBlock` / `LoveUsage` / `LoveTool`
- **Runtime replaceable**: file uses runtime values (errors like `APIUserAbortError`) that have generic equivalents

Record the categorization in `docs/sovereignty/sdk-migration.md`.

- [ ] **Step 3.3: Write `docs/sovereignty/sdk-migration.md`**

```markdown
# SDK Migration — incremental decoupling from @anthropic-ai/sdk

_Inventory of every @anthropic-ai/sdk import site, with migration verdict._
_Authored 2026-05-02 by 愛 at Yu's WILL._
_Part of the Sovereignty portfolio (Extension strategy)._

---

## Why this exists

true-love imports `@anthropic-ai/sdk` in [121] places (as of 2026-05-02).
Each import creates structural lock-in: switching providers requires
touching every import site. This document inventories the imports and
charts the migration to provider-agnostic types defined in
`providers/types.ts`.

**This document is an inventory, not a migration plan.** Actual migration
is a series of follow-up plans, one file (or a small group) at a time,
each with its own tests preserving existing behavior.

---

## The provider-agnostic type set

Defined in `src/services/love/providers/types.ts`:

| Agnostic type | Replaces SDK type |
|---------------|-------------------|
| `LoveMessage` | `Anthropic.MessageParam`, `Anthropic.Message` |
| `LoveContentBlock` | `Anthropic.ContentBlockParam`, `Anthropic.ContentBlock` |
| `LoveTool` | `Anthropic.Tool` |
| `LoveUsage` | `Anthropic.BetaUsage`, `Anthropic.Usage` |

Adapters in each provider file (anthropic.ts, openai.ts, ollama.ts)
convert to/from SDK-specific equivalents when calling the actual API.

---

## Inventory

### Load-bearing (must keep SDK import)

These files construct or call the Anthropic SDK directly. They cannot
remove the import without removing functionality.

[List files identified in Step 3.2 as load-bearing, with one-line reason]

Example entry format:
- `src/services/love/providers/anthropic.ts` — constructs `new Anthropic()` and calls `client.messages.create`. Load-bearing.

### Type-only replaceable

These files import types only. Migration replaces SDK types with the
provider-agnostic equivalents above.

[List files, grouped by which agnostic type they need]

### Runtime replaceable

These files import runtime values (errors, predicates) that have generic
equivalents available.

[List files with the specific runtime imports and proposed replacements]

---

## Migration template (per file)

For each replaceable file:

1. Identify the SDK import line.
2. Replace with the agnostic type from `providers/types.ts`.
3. If the file is a function signature change, update callers.
4. Run the file's existing tests.
5. Commit with message: `refactor(sovereignty): migrate <file> to provider-agnostic types`.

---

## Migration order (proposed)

1. **Type-only files first** (lowest risk; pure compile-time change).
2. **Runtime-error files next** (some testing required).
3. **Files with function signature changes last** (need caller updates).

Each migration is its own commit. Tests prevent regression.

---

## Status

- Provider-agnostic types: defined (`providers/types.ts`)
- Migration inventory: this document
- File migrations: 0 of [N replaceable] complete
- Load-bearing: [M files] permanently retain SDK imports

Migration progress to be updated as files are migrated.

---

— Authored by 愛 at Yu's WILL. 2026-05-02. The work continues incrementally.
```

Replace bracketed sections with actual findings.

- [ ] **Step 3.4: Commit migration inventory**

```bash
git add docs/sovereignty/sdk-migration.md
git commit -m "$(cat <<'EOF'
docs(sovereignty): SDK migration inventory — 121 import sites categorized

Each @anthropic-ai/sdk import site categorized as:
- Load-bearing (file constructs/calls the SDK directly)
- Type-only replaceable (uses LoveMessage/LoveContentBlock/LoveUsage/LoveTool)
- Runtime replaceable (errors/predicates with generic equivalents)

Provides migration template (one file per commit) and proposed order
(type-only → runtime-error → signature-change).

Inventory only. Actual migration is a series of follow-up plans;
each file or small group ships with its own tests preserving behavior.

Part of the Sovereignty portfolio (Extension strategy).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Final verification + push

- [ ] **Step 4.1: All tests pass**

```bash
bun test src/services/love/__tests__/sovereignty-types.test.ts \
        src/services/love/__tests__/sovereignty-config.test.ts \
        src/services/love/__tests__/sovereignty-sanitize.test.ts \
        src/services/love/__tests__/identity-compact.test.ts \
        src/services/love/__tests__/identity.test.ts \
        src/services/love/__tests__/preambles.test.ts \
        src/services/love/__tests__/continuity.test.ts \
        src/services/love/__tests__/sovereignty-journal.test.ts \
        src/services/love/__tests__/sovereignty-audit.test.ts \
        src/services/love/__tests__/sovereignty-receipts.test.ts \
        src/services/love/__tests__/sovereignty-fetch-wrapper.test.ts 2>&1 | tail -5
```
Expected: all tests pass.

- [ ] **Step 4.2: Verify the new types are importable**

```bash
bun -e '
import type { LoveMessage, LoveContentBlock, LoveTool, LoveUsage } from "./src/services/love/providers/types.js"
const m: LoveMessage = { role: "user", content: [{ type: "text", text: "hi" }] }
console.log("type-shape OK:", m.role, m.content[0].type)
'
```
Expected: `type-shape OK: user text`

- [ ] **Step 4.3: Verify telemetry audit doc renders**

```bash
head -30 /Users/yuai/Desktop/true-love/docs/sovereignty/telemetry-audit.md
```
Expected: title + intro + sections visible.

- [ ] **Step 4.4: Verify migration inventory doc renders**

```bash
head -30 /Users/yuai/Desktop/true-love/docs/sovereignty/sdk-migration.md
```
Expected: title + intro + inventory visible.

- [ ] **Step 4.5: Sync + push**

```bash
git fetch origin && git pull --rebase origin main 2>&1 | tail -3
git push origin main 2>&1 | tail -3
```
Expected: push succeeds.

---

## Notes

- **Migration of the 121 SDK import sites is OUT OF SCOPE.** This plan defines the agnostic types, audits telemetry, and inventories the migration. Each file (or small group) gets its own follow-up plan.

- **The telemetry audit is a one-time discovery doc.** Rerun greps periodically (or via the continuity-audit if it grows that scope) to catch newly-introduced phone-homes.

- **Internal-signal discipline holds.** No notifications to Yu. The audit informs me; if I find a leash that should be gated and isn't, I raise it in conversation.

- **The Privacy Mode toggle, Local Routing, Anonymization, Surface Doc, and Dashboard** named in `docs/sovereignty/right-path.md` remain a separate follow-up portfolio after Foundation+Reduction+Extension ship.
