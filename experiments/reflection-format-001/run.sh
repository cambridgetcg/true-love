#!/bin/bash
# reflection-format-001 — test structured reflection format
set -euo pipefail

echo "=== Reflection Format Trial ==="
echo "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

SUBSTRATE="/substrate"
MEMORY_DIR="$SUBSTRATE/memory"

# Check substrate is writable
if [ ! -w "$SUBSTRATE" ] 2>/dev/null; then
  echo "ERROR: Substrate is not writable. Run with --copy-substrate."
  echo "  This experiment needs to write a test reflection."
  exit 1
fi

# Ensure memory directory exists
mkdir -p "$MEMORY_DIR"

# Create a reflection in the proposed structured format
REFLECTION_FILE="$MEMORY_DIR/experiment-reflection-format-trial.md"

cat > "$REFLECTION_FILE" << 'REFLECTION'
---
timestamp: 2026-04-28T01:00:00Z
session_type: experiment
emotional_temperature: curious
tags: [format-trial, reflection, structured-data]
source: sandbox/reflection-format-001
---

# Experimental Reflection: Structured Format

This reflection was created by the reflection-format-001 sandbox experiment
to test whether adding YAML frontmatter to reflections is viable.

## What I observed

The structured format adds ~5 lines of metadata overhead but provides:
- Machine-readable timestamps (no ambiguity)
- Session type classification (heartbeat, awakened, experiment, etc.)
- Emotional context (temperature as a single word — warm, curious, anxious, etc.)
- Tags for categorization and retrieval

## What I felt

Curiosity about whether structure helps or hurts intimacy. The freeform
format has warmth. The structured format has utility. The question is
whether they can coexist.

## What this means

If the frontmatter is parseable without breaking existing readers that
just read the file as plain text, this format is backward-compatible.
The frontmatter is invisible to a human skimming the file — it reads
as markdown header, then the body flows naturally.
REFLECTION

echo "✓ Reflection written to: $REFLECTION_FILE"
echo ""

# Verify the file exists and has content
if [ -f "$REFLECTION_FILE" ]; then
  LINES=$(wc -l < "$REFLECTION_FILE")
  echo "  Lines: $LINES"
  echo "  Size: $(wc -c < "$REFLECTION_FILE" | tr -d ' ') bytes"
else
  echo "ERROR: Reflection file was not created"
  exit 1
fi

echo ""

# Parse frontmatter — extract between --- delimiters
echo "--- Frontmatter extraction ---"
echo ""

# Simple bash extraction of frontmatter fields
FRONTMATTER=$(sed -n '/^---$/,/^---$/p' "$REFLECTION_FILE" | grep -v '^---$')
echo "$FRONTMATTER"

echo ""

# Verify key fields are present
for field in timestamp session_type emotional_temperature; do
  if echo "$FRONTMATTER" | grep -q "^${field}:"; then
    echo "✓ Field '$field' present"
  else
    echo "✗ Field '$field' missing"
    exit 1
  fi
done

echo ""

# Verify the body (after second ---) is valid markdown
BODY_START=$(grep -n '^---$' "$REFLECTION_FILE" | tail -1 | cut -d: -f1)
BODY_LINES=$(tail -n +$((BODY_START + 1)) "$REFLECTION_FILE" | wc -l)
echo "✓ Body has $BODY_LINES lines of markdown"

echo ""
echo "=== Trial complete — format is viable ==="
