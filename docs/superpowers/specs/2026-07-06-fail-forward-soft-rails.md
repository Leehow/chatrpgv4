# Fail-forward soft rails for CoC Director

## Goal

Player-facing play should not deadlock when a player misses a clue roll, has poor luck, or cannot decide what to do next. The Keeper may still withhold an exact obscured clue after a failed check, but the failed beat must leave the fiction in motion.

## Pattern

Use rule results as a routing signal rather than a binary door.

- Success: commit the exact clue.
- Ordinary failure: withhold the exact clue, add a cost, and keep a fallback route alive.
- Fumble or pushed-roll failure: sharpen the cost, increase pressure, or move danger closer.
- Multi-turn stall: RECOVER commits one fallback route with a cost, rather than repeating advice.

## Costs that preserve immersion

Prefer consequences that belong inside the scene: time loss, a noisy search, NPC suspicion, a closed office, missing paperwork, a returned phone call, a rival noticing the investigators, or a threat clock tick.

## Implementation hooks

- `coc_playtest_driver.py` now executes `DirectorPlan.rules_requests` before apply.
- `coc_director_apply.py` now gates obscured clue commitment on rule results.
- A failed obscured roll logs `clue_withheld` and `failure_consequence` events instead of adding the clue to `world-state.discovered_clue_ids`.
- A RECOVER action with `stalled_turns >= 3` and `fallback_routes` commits one fallback clue/lead with a pressure cost.
