---
name: coc-sanity
description: Resolve Call of Cthulhu sanity events during COC mode. Use for SAN rolls, sanity loss, temporary insanity, indefinite insanity, bouts of madness, delusions, reality checks, phobias, manias, and recovery notes.
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

## Delusions and Reality Check

Per Keeper Rulebook p.162-163, delusions may only be planted during the **underlying-insanity phase** (investigator is temporarily or indefinitely insane, and no bout of madness is active). Prefer tying the delusion to a structured personal-horror hook (`hook_id` / `backstory_field`) rather than inventing free-floating falsehoods.

- The Keeper narrates delusions **as if they are real** and never volunteers which sensory details are false.
- When the player declares suspicion ("I doubt this is real" / equivalent), run `SanitySession.reality_check()`.
- **Success:** clear the active delusion, set `delusion_resistant`, and describe the true scene faithfully. Resistance lasts until the next SAN loss of 1+.
- **Failure:** lose 1 SAN and immediately trigger a new bout of madness; the delusion remains in place.

Use `SanitySession.plant_delusion(description, backstory_field=...)` to record the structured delusion; do not plant during a bout or while the investigator is sane.

## Bout Playout

After a bout of madness is rolled (Tables VII / VIII):

- **Real-time bouts:** the Keeper announces the forced action each round and advances with `tick_bout_round()` until control returns to the player.
- **Summary bouts:** fast-forward and describe the "waking scene" per Table VIII; do not play out each round.
- When the bout ends, return control to the player and note the fragile underlying state (any further SAN loss retriggers a bout).
- During the underlying phase, everyday behavior can look completely normal (p.158). Do **not** roleplay constant madness between bouts.

## V1 Scope

Support SAN roll, loss, threshold checks, bouts of madness (real-time and summary), delusions and reality check, and bout playout guidance. Long-term recovery paths (private care / asylum monthly tables, self-help keyed to backstory), phobia/mania structured exposure tags, and development-phase SAN awards remain for later waves.
