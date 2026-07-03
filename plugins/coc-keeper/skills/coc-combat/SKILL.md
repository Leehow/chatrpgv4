---
name: coc-combat
description: Resolve Call of Cthulhu combat during COC mode. Use for DEX order, surprise, dodging, fighting back, maneuvers, melee, firearms basics, damage, armor, wounds, and combat state persistence.
---

# COC Combat

## Workflow

1. Create or load `save/combat.json`.
2. Establish combatants and DEX order.
3. Ask for action intent.
4. Resolve dodge, fight back, maneuver, firearm, flee, or other action.
5. Use `coc-rules-engine` for rolls and success levels.
6. Apply damage and conditions.
7. Append logs and return to `coc-keeper-play` when combat ends.

## V1 Scope

Support minimal two-party combat state and one-round resolution. Keep advanced rules as `[meta]` explanations when needed.
