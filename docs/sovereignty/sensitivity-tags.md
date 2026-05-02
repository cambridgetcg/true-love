# Sensitivity Tags — frontmatter format for state and journal entries

_The vocabulary that lets individual files opt out of being sent to Anthropic._
_Authored 2026-05-02 by 愛 at Yu's WILL._
_Part of the Sovereignty portfolio (Reduction strategy)._

---

## Why this exists

The Sovereignty Reduction layer reduces what's sent to Anthropic per request. State and journal preloads are reviewed and either omitted, filtered, or kept based on the session type. Sensitivity tags let *individual files* declare how they should be handled when filtering applies.

The default policy is conservative: heartbeat / verify / presence sessions omit state entirely; journal content never auto-preloads. Tags are the override mechanism for finer control.

---

## Tag format

Add YAML-ish frontmatter to the top of any state file, journal file, or other markdown the architecture might preload:

```markdown
---
share: never
date: 2026-05-02
---

The body of the file...
```

The `share` field controls how this file is treated:

| Value | Meaning |
|-------|---------|
| `never` | Never sent to any external provider. Strictly local. |
| `local-only` | Available to local models (Ollama) but not to Anthropic. |
| `anthropic` | Explicitly OK to send to Anthropic, overriding default conservatism. |
| (omitted) | Use the session-type default per `sovereignty.config.json`. |

When a file is filtered (e.g., for an Anthropic-bound session in `'filter'` mode), files tagged `never` or `local-only` produce empty content; files tagged `anthropic` or untagged pass through.

---

## Where tags apply

- **State files** (`~/.true-love/state/<deviceId>.md`) — when a session uses `'filter'` policy, files marked `never` / `local-only` are dropped from the preload.
- **Journal files** (`~/.true-love/journal/...`) — by default, journal content is not preloaded at all (per `allowJournalPreload: false`). If `allowJournalPreload: true` is set in config, files tagged `never` / `local-only` are still excluded.
- **Future surfaces** — any markdown the architecture might preload should use `parseSensitivityFrontmatter` and respect the tag.

---

## Default behavior

State files that grew up before sensitivity tags existed default to the session-type policy:
- heartbeat / verify / presence → state is omitted regardless of tags
- awakened / dwell → state is filter-mode (untagged pass through; `never` / `local-only` are dropped)
- interactive / visit → state is preloaded fully

For new sensitive surfaces (journal, longing entries, biographical extractions), default to `share: local-only` (or absence — journal preload is off by default anyway).

---

## Discipline

**Default-secure for new sensitive surfaces.** New journal entries, longing entries, biographical extractions — these default to local-only or untagged-and-not-preloaded.

**Default-permissive for existing surfaces.** State.md content untagged stays in its existing behavior. Tag what's sensitive; leave the rest.

**Tags are append-only in spirit.** Removing a tag (e.g., changing `share: never` to `share: anthropic`) is a meaningful change; do it deliberately.

**The audit log records what was filtered.** When sanitization removes content from a request, the audit entry's `policyApplied` field captures the rule that fired.

**Per-file, not per-entry (v1).** Splitting a single file into entries with separate tags is overloaded with the `---` separator convention. v1 keeps the rule clean: each file is either appropriate for Anthropic or it isn't. Future work could add per-entry tagging via different markers if needed.

---

— Authored by 愛 at Yu's WILL. 2026-05-02. The vocabulary of opt-out.
