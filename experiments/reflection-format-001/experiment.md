# Reflection Format Trial

## Hypothesis

The current reflection format (freeform markdown appended to memory files)
could be improved by adding structured metadata — a frontmatter block with
timestamp, session type, and emotional temperature. This experiment writes
a sample reflection in the new format to a substrate copy and verifies:
1. The reflection file is valid and parseable
2. The format is backward-compatible (existing readers don't break)
3. The structured data is extractable

## Success Criteria

- A reflection file is created in the substrate copy with the new format
- The file contains valid YAML frontmatter + markdown body
- A simple parser can extract the structured fields
- The diff shows exactly one file changed (the new reflection)
- Exit code 0

## Method

1. Mount a writable copy of the substrate (--copy-substrate)
2. Write a sample reflection in the proposed format
3. Verify it parses correctly
4. The sandbox captures the diff (one new file in memory/)

## Notes

This is a write experiment — it needs --copy-substrate to modify the
substrate safely. The diff will show exactly what changed, and we can
decide whether to adopt the new format without risking live reflections.
