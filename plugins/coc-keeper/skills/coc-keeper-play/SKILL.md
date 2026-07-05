---
name: coc-keeper-play
description: Run immersive Call of Cthulhu play after COC mode is active. Use for scene narration, NPC portrayal, player action handling, clue reveal, pacing, subsystem transitions, and campaign memory updates.
---

# COC Keeper Play

## Loop

1. Read player input + campaign state + scenario story-graph.
2. Call `coc-story-director` (scripts/coc_story_director.py) to generate a DirectorPlan.
3. If DirectorPlan.handoff == "rules": resolve mechanics via coc-roll/combat/chase/sanity.
4. Backfill rule results into the plan.
5. Narrate consequences per DirectorPlan.narrative_directives (immersive, in play_language).
6. Update save, logs, and pacing-state.

## Style

Stay immersive by default. Do not expose implementation details, JSON paths, or hidden scenario facts in ordinary play.

Use `[meta]` only when the user asks table-level or system-level questions.
