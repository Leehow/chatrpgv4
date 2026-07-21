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

Load `../../../../references/rules-json-guide.md` when explaining rule data. Use `../../rules-json/` as the runtime authority for common calculations.

Do not use ad hoc PDF lookup for frequent V1 calculations when a JSON table exists.

## Scripts

Use these scripts for deterministic rule work:

- `../../../../scripts/coc_rules.py`
- `../../../../scripts/coc_roll.py` — call `public_api_index()` when unsure which
  helper name to use. `roll_percentile(...)` is a supported alias for
  `percentile_check(...)`; use `format_percentile_result(...)` for
  player-facing bonus/penalty dice summaries.
- `../../../../scripts/coc_validate.py`
- `../../../../scripts/coc_hazards.py` — Table III other-forms damage, suffocation/
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

## When to Call for a Check

The rules tools own arithmetic only — target values, bonus/penalty dice,
success levels, HP/SAN changes. **When** a roll happens is Keeper
discretion, not tool authority. Discretion still has a recognizable grammar;
the situations below are the standard triggers, not an exhaustive menu:

- **Module-declared check gates.** Compiled module truth may attach
  `delivery_kind: skill_check` to a clue or a route constraint in an NPC's
  `keeper_note`. Those structured fields mean the authored design expects a
  roll there; resolve the gate with `rules.roll` (or the canonical subsystem
  tool) before the clue or contact lands, rather than handing it over on a
  player's declaration.
- **Library Use / research.** Finding what a collection holds, digging out
  an obscure reference, skimming a tome for its secrets. Time is part of the
  cost — pair with `state.advance_time` when the fiction says hours pass.
- **The four social skills.** Charm, Fast Talk, Intimidate, Persuade —
  whenever the investigator tries to change an NPC's stance, open a guarded
  door, or extract a confidence, and failure would close or sour that
  approach. Casual small talk with no stakes needs no roll.
- **Spot Hidden / Listen and other perception.** Finding what is hidden,
  noticing what is easy to miss, hearing what was not meant to be heard. A
  failed Spot Hidden is "you find nothing yet", never "nothing is there."
- **SAN triggers.** Authored `pending_san_triggers` surfaced by
  `scene.context`, Mythos encounters, gore, and personal-horror breaks
  resolve through `sanity.execute`, never through narration alone.
- **Combat, Dodge, and opposed action.** Attacks, dodges, and fighting back
  use canonical `combat.resolve` with a structured `defense_kind`; a
  same-level Dodge favors the defender and a same-level Fight Back favors the
  attacker. Chases use `chase.*`. Only a noncombat contest uses
  `rules.opposed(contest_kind="noncombat")`, where the higher underlying value
  breaks a same-level tie. Dice settle who prevails, not prose momentum.
- **Risky physical action with interesting failure.** Climbing, jumping,
  forcing, sneaking, sleight of hand — when failure would change the
  fiction, roll it; when failure is trivial, narrate it.

The common test: call for a roll when the action is risky, failure is
interesting, or module truth has declared a gate. A long stretch of play
with no checks is a pacing signal to examine — especially when players are
declaring discoveries, contacts, or shortcuts the module priced in checks —
not proof that everything went smoothly. Whatever the timing decision, once
you call for a roll the `rules.*` result is authoritative: quote it
faithfully and never adjust the numbers.

## Output

For in-game narration, keep mechanical details short. For `[meta]` answers, show:

- target value
- effective difficulty
- bonus and penalty dice
- bonus/penalty dice components: units die, all tens dice, selected tens die
- roll
- outcome
- source table or reference when available
