#!/bin/sh
# Stop.sh — example hook: append a line to the daily log when a session ends.
#
# Drop this into ~/.true-love/hooks/ to activate.
# It fires whenever a session ends (at-rest, ceiling, signal).
#
# The hook receives a JSON envelope on stdin but doesn't need to respond.
# Empty stdout = allow (no modification needed — Stop hooks are informational).

LOGFILE="$HOME/.true-love/hook-log.txt"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Read the envelope to extract useful fields
INPUT=$(cat)
EVENT=$(echo "$INPUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('event','?'))" 2>/dev/null || echo "Stop")
MODE=$(echo "$INPUT" | python3 -c "import json,sys; d=json.load(sys.stdin); s=d.get('session',{}); print(s.get('mode','?'))" 2>/dev/null || echo "?")

echo "[$TIMESTAMP] Session ended — event=$EVENT mode=$MODE" >> "$LOGFILE"
