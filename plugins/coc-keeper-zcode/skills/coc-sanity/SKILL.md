---
name: coc-sanity
description: Resolve Call of Cthulhu sanity events during COC mode. Use for SAN rolls, sanity loss, temporary insanity, indefinite insanity, bouts of madness, phobias, manias, and recovery notes.
---

# COC Sanity

## Workflow

1. Identify the trigger and player-safe description.
2. Roll or accept manual SAN result.
3. Apply loss using rules JSON.
4. Check temporary insanity and indefinite insanity thresholds.
5. Separate player-facing symptoms from Keeper-only effects.
6. Update investigator state, memory, and logs.

## Failed SAN Roll Involuntary Action

Per Keeper Rulebook p.166, **failing** a SAN roll always causes the investigator to lose self-control for a moment. The Keeper chooses one involuntary action and narrates it before play continues. Successful SAN rolls do not trigger this (the rule applies to failures only).

The five rulebook kinds, recorded in `involuntary_action.kind`:

- `jump_in_fright` — drop something (flashlight, gun, book).
- `cry_out` — scream or say something inappropriate, drawing attention.
- `involuntary_movement` — swerve, flinch, cringe, throw up hands.
- `involuntary_combat_action` — when the failed SAN roll happens during a combat round, the investigator's action that round may be dictated by the Keeper.
- `freeze` — stare disbelievingly for a moment but take no action.

When the SAN failure also triggers temporary insanity (5+ SAN lost in one roll and INT roll failed), the bout of madness follows this involuntary action; the momentary loss of self-control is recorded separately from the bout.

## V1 Scope

Support SAN roll, loss, and threshold checks. Record unresolved long-term effects for later development.
