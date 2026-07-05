---
name: coc-chase
description: Resolve Call of Cthulhu chase scenes during COC mode. Use for establishing pursuits, MOV comparisons, location chains, movement actions, barriers, hazards, conflict, and chase state persistence.
---

# COC Chase

## Workflow

1. Create or load `save/chase.json`.
2. Establish pursuers, quarry, and goals.
3. Compare MOV and relevant speed rolls.
4. Create or import a location chain.
5. Determine DEX order and record each chase round's `turns[].actor_id` in that order.
6. Resolve movement, hazards, barriers, and conflict.
7. Update world state and logs.
8. Return to immersive play when the chase ends.

## V1 Scope

Support basic chase state and one movement exchange. Use `[meta]` for detailed explanation when the player asks.
