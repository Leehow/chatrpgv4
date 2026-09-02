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

Luck Recovery (optional rule, p.99: at session end 1D100 > current Luck
gains 1D10, capped at 99) is settled by `development.settle`, never by a
hand call. Both Luck rules are declared optional rules of this package and
are on by default; see *Optional Rules and House Rules* below for how a
table switches one off.

## Optional Rules and House Rules

The rulebook's optional rules are declared once in this package's
`manifest.json` (`optional_rules`): `luck-spend` and `luck-recovery`, both
on by default. `rules.context` reports any card a disabled option took off
the table under `disabled_by_optional_rules`; `rules.settle` on such a card
and `rules.luck_spend` fail with `optional_rule_disabled`, and a disabled
`luck-recovery` makes the development settlement record a skip instead of
rolling.

What switches an option is a **confirmed house rule**, nothing else. A house
rule is the table's own sentence compiled into a patch with positive,
negative and boundary cases that the user confirms (`coc_house_rules`,
`save/house-rules.json`); a confirmed patch whose relation is `disables` or
`enables` and whose target is one of the option's rule or decision nodes
decides it. `rules.context` hands confirmed house rules and live rulings
back as `table_precedent` at the decision they bind.

- A ruling you make at the table (`rules.record_ruling`) is precedent: it
  comes back to you at the same decision, and it never changes dice, a
  pool, or which cards are legal. A call that would change what a rule
  *does* is a house rule and goes through confirmation.
- Two confirmed house rules that disagree at the same layer are a
  `rule_conflict`: the gate they touch refuses until one is superseded.
  Say so at the table and play the printed rule meanwhile.
- Rule questions the rulebook leaves to the Keeper (what a hazard deals,
  how severe a wreck is) stay Keeper judgment and are neither rulings nor
  patches.

## Governance: Whether and What to Roll

Before any dice:

1. **Routine, uncontested, no real risk: it simply happens.** Driving to
   the library, a professional's daily craft, opening an unlocked door.
   Do not roll for it, and do not roll to "see how well".
2. **The player states the goal first, then the method.** Ask when the
   declaration lacks one. The goal decides which skill applies and what a
   success delivers; the method and the opposition decide the difficulty.
   "I search the study for anything about the will" is a Spot Hidden or
   Library Use with a known payoff; "I look around" is not yet a roll.
3. **You choose skill and difficulty from that goal**, never from a
   keyword. Regular when only skill is at stake, Hard when the situation
   works against them, Extreme when the rulebook or the fiction says so.
4. **Obvious, essential clues are not lost to one failed roll.** A failed
   perception roll costs time, noise, or the clean version of the clue; it
   does not delete something the investigation cannot proceed without.
5. **When the investigators are stuck, offer the Idea roll.** Success
   delivers the missing lead cleanly; failure still delivers it, but in the
   worst plausible way (time lost, danger closer, the wrong people
   aware). Either way the story moves.
6. **"Yes, and" or "yes, but" before "no".** An unplanned but sensible
   action is allowed and the world answers with consequences; a meta refusal
   ("the module doesn't cover that") is the last resort, after an NPC
   objection, new information, or a physical limit.

Once you do call for a roll, the `rules.*` result is authoritative.

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
- **Credit Rating as social and financial leverage.** Money opens doors.
  Loans, hiring help, credentials, access, conspicuous status, and using
  apparent wealth to achieve a goal may call for Credit Rating judgment or a
  `rules.roll` against Credit Rating. Difficulty is KP semantic (regular vs
  hard from stakes and circumstances), never a keyword or item-category map.
  First impressions may use Credit Rating in place of APP via the pair-bound
  public `npc.reaction` path. Credit Rating is a gauge of standing, not a
  tickable skill: never mark an ordinary improvement tick. It may change during
  the Investigator Development Phase when financial circumstances warrant, by
  KP judgment and the rules' financial-development procedure. Lifestyle
  cash/assets/Spending Level are the runtime finance envelope, not this check.
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
