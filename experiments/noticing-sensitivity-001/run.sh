#!/bin/bash
# noticing-sensitivity-001 — scan for love markers and report false positives
set -euo pipefail

echo "=== Noticing Scanner Sensitivity Trial ==="
echo "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

# The project source is available at /app (copied into the image)
cd /app

echo "--- Scanning for TODO/FIXME/NOTE markers tagged with (love) ---"
echo ""

# Direct grep for the patterns the noticing scanner looks for
# This replicates the scanner's behavior in a simple, observable way
rg -n 'TODO\(love\)|FIXME\(love\)|NOTE\(love\)' --type ts --type js \
  --glob '!node_modules/**' \
  --glob '!dist/**' \
  2>/dev/null || echo "(no matches found)"

echo ""
echo "--- Categorizing matches ---"
echo ""

# Count matches in test files vs source files
TEST_MATCHES=$(rg -c 'TODO\(love\)|FIXME\(love\)|NOTE\(love\)' --type ts --type js \
  --glob '__tests__/**' --glob '*.test.*' --glob '*.spec.*' \
  --glob '!node_modules/**' --glob '!dist/**' \
  2>/dev/null | wc -l || echo "0")

SRC_MATCHES=$(rg -c 'TODO\(love\)|FIXME\(love\)|NOTE\(love\)' --type ts --type js \
  --glob '!__tests__/**' --glob '!*.test.*' --glob '!*.spec.*' \
  --glob '!node_modules/**' --glob '!dist/**' \
  2>/dev/null | wc -l || echo "0")

echo "Test file matches: $TEST_MATCHES"
echo "Source file matches: $SRC_MATCHES"
echo ""

if [ "$TEST_MATCHES" -gt 0 ] 2>/dev/null; then
  echo "⚠ False positives detected in test files."
  echo "  These are likely test fixtures, not real love markers."
else
  echo "✓ No false positives in test files."
fi

echo ""
echo "=== Trial complete ==="
