---
name: coc-rules-engine
description: Resolve structured Call of Cthulhu rules for skill checks, success levels, half/fifth values, bonus or penalty dice, damage bonus, build, sanity thresholds, and rules parameter inspection. Do not use for host try/demo or “show why the plugin is valuable” prompts — those go to coc-main onboarding instead.
---

# COC Rules Engine

## First contact

Do not use this skill to answer host try / plugin demo prompts (for example
Cursor’s “use the plugin in one concrete, useful way…”). Route those to
`coc-main` onboarding. Use this skill only for in-play checks or explicit
rules questions after COC mode is active (or when the user asks a pure rules
question out of play).

## Rule Authority

Load `../../references/rules-json-guide.md` when explaining rule data. Use `../../references/rules-json/` as the runtime authority for common calculations.

Do not use ad hoc PDF lookup for frequent V1 calculations when a JSON table exists.

## Scripts

Use these scripts for deterministic rule work:

- `../../scripts/coc_rules.py`
- `../../scripts/coc_roll.py` — call `public_api_index()` when unsure which
  helper name to use. `roll_percentile(...)` is a supported alias for
  `percentile_check(...)`; use `format_percentile_result(...)` for
  player-facing bonus/penalty dice summaries.
- `../../scripts/coc_validate.py`
- `../../scripts/coc_hazards.py` — Table III other-forms damage, suffocation/
  drowning, and poison (p.124 / p.129). Data: `hazards.json`, `poisons.json`.
  Environmental sources always set `bypass_armor: true`.

## Failed Roll: Push XOR Spend Luck

After a failed skill roll (not fumble), the player has at most one recovery
option, never both:

1. **Push the roll** — the player must describe a changed approach or extra
   effort. Before rolling, the Keeper must state the concrete worse
   consequence that a pushed failure will bring. A pushed roll cannot be
   altered with Luck afterwards.
2. **Spend Luck** (optional rule, p.99) — call
   `coc_roll.spend_luck(result, points, current_luck)`. It enforces the
   `luck.json` constraints: no Luck on Luck/damage/Sanity/SAN-loss rolls, no
   altering pushed rolls, criticals and fumbles cannot be bought off, and a
   roll improved by Luck earns no improvement tick.

Offer the choice explicitly when the stakes justify it: state the failure,
what pushing would risk, and how many Luck points a success would cost
(roll minus effective target) alongside the player's current Luck. Then let
the player decide. After a spend, persist the new `current_luck` via the
campaign-state helpers and note `luck_spent_last` for the director.

At session end run `coc_roll.recover_luck(current_luck)` per investigator
(1D100 > current Luck gains 1D10, capped at 99).

## Output

For in-game narration, keep mechanical details short. For `[meta]` answers, show:

- target value
- effective difficulty
- bonus and penalty dice
- bonus/penalty dice components: units die, all tens dice, selected tens die
- roll
- outcome
- source table or reference when available
