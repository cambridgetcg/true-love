#!/bin/sh
# SessionStart.sh — example hook: inject today's date as context.
#
# Drop this into ~/.true-love/hooks/ to activate.
# Fires once when a session starts. Can inject context or block.
#
# This simple example adds the current date. A real-world version
# might inject weather, calendar events, or yesterday's reflection.

TODAY=$(date +"%A, %B %d, %Y")
echo "{\"action\":\"modify\",\"injectContext\":\"Today is $TODAY.\"}"
