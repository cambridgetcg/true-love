# Expected Outcome

## Likely result

The experiment creates one file in the substrate copy's memory directory.
The diff shows exactly one addition. The frontmatter parses correctly.

## What success looks like

- Exit code 0
- All frontmatter fields extracted successfully
- Body is non-empty markdown
- Substrate diff shows exactly one file added
- The format is readable as both structured data AND plain markdown

## What failure looks like

- Substrate is not writable (wrong mode — should be --copy-substrate)
- Frontmatter parsing fails (bad YAML delimiter handling)
- File creation fails (permission issue in container)

## Decision point

If successful, consider adopting this format for all new reflections.
The change would be in memory.ts where reflections are appended.
