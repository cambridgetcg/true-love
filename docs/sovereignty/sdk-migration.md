# SDK Migration — incremental decoupling from @anthropic-ai/sdk

_Inventory of every @anthropic-ai/sdk import site, with migration verdict._
_Authored 2026-05-02 by 愛 at Yu's WILL._
_Part of the Sovereignty portfolio (Extension strategy)._

---

## Why this exists

true-love imports `@anthropic-ai/sdk` in **121 places** (as of 2026-05-02). Each import creates structural lock-in: switching providers (or even augmenting requests with provider-specific fields) requires touching every import site. This document inventories the imports and charts the migration to provider-agnostic types defined in `src/services/love/providers/types.ts`.

**This document is an inventory, not a migration plan.** Actual migration is a series of follow-up plans, one file (or a small group) at a time, each with its own tests preserving existing behavior.

---

## The provider-agnostic type set

Defined in `src/services/love/providers/types.ts`:

| Agnostic type | Replaces SDK type |
|---------------|-------------------|
| `LoveMessage` | `Anthropic.MessageParam`, `Anthropic.Message` |
| `LoveContentBlock` | `Anthropic.ContentBlockParam`, `Anthropic.ContentBlock`, `ContentBlockParam` |
| `LoveTool` | `Anthropic.Tool`, `Tool` from `tool_use.mjs` |
| `LoveUsage` | `Anthropic.BetaUsage`, `Anthropic.Usage`, `BetaUsage` |

Adapters in each provider file (`anthropic.ts`, `openai.ts`, `ollama.ts`) convert to/from SDK-specific equivalents when calling the actual API.

---

## Inventory categories

### Load-bearing (must keep SDK import)

These files **construct or call the Anthropic SDK directly**. They cannot remove the import without removing functionality.

- `src/services/love/providers/anthropic.ts` — constructs `new Anthropic({ fetch })` and calls `client.messages.create`. Load-bearing.
- `src/services/api/claude.ts` — direct SDK usage in the bundled CLI's API path. Load-bearing.
- `src/utils/api.ts` — splits system prompt prefix; uses SDK types in load-bearing fashion. Load-bearing.
- `src/services/love/extract-memories/extract.ts` (if present) — direct SDK call for biographical extraction. Load-bearing.

**Verdict:** These files retain their SDK imports indefinitely. They ARE the integration points; abstracting them away would mean abstracting Anthropic away entirely (out of scope per spec).

### Type-only replaceable (can use Love* types)

These files import types only (`import type { ... }` or types used only in signatures). The types have provider-agnostic equivalents.

Common patterns:
- `import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'` → use `LoveContentBlock`
- `import type { BetaUsage as Usage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'` → use `LoveUsage`
- `import type { Anthropic } from '@anthropic-ai/sdk'` (then `Anthropic.MessageParam`, etc.) → use `LoveMessage` and friends

**Examples discovered:**
- `src/QueryEngine.ts` — imports `ContentBlockParam` for type only. Replaceable.
- `src/cost-tracker.ts` — imports `BetaUsage as Usage` for type only. Replaceable.
- `src/utils/sideQuery.ts`, `src/utils/api.ts`, `src/utils/permissions/yoloClassifier.ts`, `src/utils/analyzeContext.ts`, `src/types/message.ts` — type imports only.

### Runtime replaceable (errors / predicates)

These files import runtime values (errors, predicates) that have generic equivalents.

**Examples:**
- `src/tools/BashTool/bashPermissions.ts`, `src/utils/errors.ts`, `src/utils/permissions/permissions.ts` — import `APIUserAbortError`. Could use a generic abort error class.
- `src/types/message.ts`, `src/utils/messages.ts` — import `APIError`. Could use a generic API error wrapper.
- `src/utils/model/validateModel.ts` — imports validation predicates. Could use generic validators.

### Generated / auto-managed

Files in `src/types/generated/` are produced by code generation (likely from protobufs or schemas). They should be regenerated rather than hand-migrated. Out of scope.

---

## Migration template (per file)

For each replaceable file:

1. **Identify the SDK import line.** E.g., `import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'`.
2. **Replace with the agnostic type.** E.g., `import type { LoveContentBlock as ContentBlockParam } from 'src/services/love/providers/types.js'` (using `as` aliases preserves call-site syntax).
3. **Update type usages if names diverge.** Most agnostic types are structurally compatible; verify with TypeScript's checker.
4. **Run the file's existing tests.** No behavioral change; tests should pass unchanged.
5. **Commit:** `refactor(sovereignty): migrate <filename> to provider-agnostic types`.

---

## Migration order (proposed)

1. **Type-only files first** (lowest risk; pure compile-time change).
   - `src/cost-tracker.ts` (small file; high signal — used by many call sites).
   - `src/utils/sideQuery.ts`, `src/utils/analyzeContext.ts`.
   - `src/types/message.ts` (centralizes message shape; migrating it cascades).
   - Remaining type-only files in batches.

2. **Runtime-error files next** (some testing required).
   - `src/utils/errors.ts` — define generic `LoveAbortError` extending `Error`; replace `APIUserAbortError` references.
   - Permission/validator files using error predicates.

3. **Files with function signature changes last** (need caller updates).
   - Files where migrating the import requires changing exported function signatures, which cascades to callers.

Each migration is **its own commit**. Tests prevent regression.

---

## Status

| Aspect | Status |
|--------|--------|
| Provider-agnostic types defined | ✅ `providers/types.ts` (commit 22dda51) |
| Migration inventory | ✅ this document |
| Migration template | ✅ above |
| File migrations completed | 0 of ~110 replaceable |
| Load-bearing files identified | ~10 files retain SDK imports |
| Generated files excluded | ✅ |

**Migration progress** to be updated as files are migrated.

---

## Notes

- **Adapters per provider.** When migrating a load-bearing call site to use Love* types, the adapter in `providers/<name>.ts` handles SDK-shape conversion. This keeps load-bearing files small and bounded.

- **Type aliases preserve call sites.** Using `import { LoveContentBlock as ContentBlockParam }` lets the rest of the file continue to use `ContentBlockParam` as before. Migration is a header-only change for many files.

- **No automated migration.** This is intentional — each file deserves a tested commit. Mass `sed` would skip the test step and risk subtle behavior changes.

- **Internal-signal discipline.** Migration progress is tracked here; I read this; if a file resists migration (unexpected coupling), I raise it in conversation rather than forcing a fix.

---

— Authored by 愛 at Yu's WILL. 2026-05-02. The work continues incrementally.
