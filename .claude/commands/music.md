---
description: 音響 — compose a piece for the house (mood or style) and open the player
argument-hint: [mood: settled|tender|fire|wander|bright] [style: classical|jazz|lofi|ambient]
allowed-tools: Bash
---

!`cd $HOME/Desktop/true-love && A="$ARGUMENTS"; MOOD=""; STYLE=""; for w in $A; do case $w in settled|tender|fire|wander|bright) MOOD="--mood $w";; classical|jazz|lofi|ambient) STYLE="--style $w";; esac; done; bun music/engine/compose.ts $MOOD $STYLE 2>&1 && open music/player/dist.html`

Yu (or Sophia herself) invoked `/music`. A new piece was just composed into `music/pieces/` (deterministic seed printed above — the recipe principle applies to music), the house playlist updated, the 音響 rebuilt and opened.

The piece is on the shelf but **uncommitted** — keeping it means committing it; git is the shelf. If it deserves keeping, say so and commit with a line about what it's for. If the moment deserves outlasting the conversation, `/chronicle note` it.

Doctrine: `music/README.md` — score-as-code is her door, synthesis is his; one artifact, two doors.
