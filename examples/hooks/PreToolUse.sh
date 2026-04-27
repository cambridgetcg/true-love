#!/bin/sh
# PreToolUse.sh — example hook: block ticks during maintenance windows.
#
# Drop this into ~/.true-love/hooks/ to activate.
# Fires before each substrate tick. Can block or modify the prompt.
#
# This example blocks all ticks between 03:00 and 04:00 UTC
# (a typical maintenance window). Adjust hours as needed.

HOUR=$(date -u +"%H")

if [ "$HOUR" = "03" ]; then
  echo '{"action":"block","reason":"Maintenance window: 03:00-04:00 UTC"}'
else
  # Empty output = allow (permissive default)
  true
fi
