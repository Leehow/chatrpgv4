# Call of Cthulhu 7e (40th Anniversary, Sandy Petersen) — Rulebook Coverage Audit

> **⚠ HISTORICAL — 2026-07-05 baseline. Superseded by
> `2026-07-07-rulebook-coverage-audit.md`.**
>
> This document was written against a **32 rule-id / 19-table** baseline (see
> line 14). The registry has since grown to **75 rule-ids / 37 data tables**,
> and at least 13 tables that this audit marks MISSING/PARTIAL now exist and
> are COVERED (weapons, spells, monsters, bout-tables, phobias, manias,
> equipment, tomes, poisons, artifacts, occupations, skills,
> characteristic-dice). Its MISSING/PARTIAL verdicts and per-chapter counts
> are **not reliable for coverage decisions** — use the 2026-07-07 audit
> instead. Retained for traceability of what the v1 baseline looked like.



Chapter-by-chapter coverage audit of the `coc-keeper` / `coc-keeper` plugins against
the authoritative Keeper Rulebook PDF (`pdf/Call Of Cthulhu Keeper Rulebook 40th Anniversary
(Sandy Petersen).pdf`, 465 pages). Fast-grep source: `tmp/rulebook/keeper-rulebook.txt`.

**Convention.** Printed page numbers are the rulebook's own footer numbers; `pNNN (PDF idx NNN-1)`
also gives the zero-based PDF page index. Quotes are verbatim from the extracted text.
Classification: **COVERED** (a machine-checkable rule with a traced implementation), **PARTIAL**
(rule recognized but implementation incomplete or only in prose/skill, not in JSON+script),
**MISSING** (no implementation), **N/A** (lore/flavor, not machine-checkable).

**Sources of truth for the implementation under audit.**
- Rule index: `plugins/coc-keeper/references/rules-json/rule-index.json` (32 rule ids at audit start).
- JSON tables: `plugins/coc-keeper/references/rules-json/*.json` (19 files).
- Scripts: `plugins/coc-keeper/scripts/coc_rules.py`, `coc_roll.py`, `coc_combat.py`,
  `coc_character.py`, `coc_scenario.py`, `coc_state.py`, `coc_validate.py`, `coc_language.py`.
- Skills: `plugins/coc-keeper/skills/coc-*` (13 skills).
- codex port: `plugins/coc-keeper/` (parity mirror).
- Existing machine-checklist foundation: `checks/coC7_rule_checklist.md` (sections A-L),
  validated by `checks/exhaustive_rulebook_validator.py`.
- Note: there is no `coc_sanity.py`; sanity logic lives in `coc_rules.py` + `sanity.json`
  + the `coc-sanity` skill.

## Progress Checklist

- [x] Chapter 1 — Introduction (p10)
- [x] Chapter 2 — Lovecraft & the Cthulhu Mythos (p20)
- [x] Chapter 3 — Creating Investigators (p28)
- [x] Chapter 4 — Skills (p52)
- [x] Chapter 5 — Game System (p80)
- [x] Chapter 6 — Combat (p100)
- [x] Chapter 7 — Chases (p130)
- [x] Chapter 8 — Sanity (p152)
- [x] Chapter 9 — Magic (p170)
- [x] Chapter 10 — Playing the Game (p182)
- [x] Chapter 11 — Tomes of Eldritch Lore (p222)
- [x] Chapter 12 — Grimoire (p240)
- [x] Chapter 13 — Artifacts and Alien Devices (p266)
- [x] Chapter 14 — Monsters, Beasts, and Alien Gods (p276)
- [x] Chapter 15 — Scenarios (p344)
- [x] Chapter 16 — Appendices (p384)

---

## Chapter 1 — Introduction (printed p10; PDF idx 9)

**Scope (from TOC + body, lines 909–1244 of the extraction):** "Welcome to Call of Cthulhu"
(p10), "An Overview of the Game" (p12), "Example of Play" (p13–16), "What You Need to Play"
(p17). This chapter is orientation: what an RPG is, the Keeper/investigator roles, an example
of play transcript, and a list of physical components. It introduces two cross-cutting
statements that recur as enforceable rules elsewhere — (a) the game resolves conflicts with
dice, and (b) a skill success earns a development "tick" — but it does not itself define the
arithmetic for either.

### 1.1 Conflicts resolved by dice

- **Rule:** A dramatic conflict is resolved by rolling dice; the rules describe the procedure.
- **Page:** p12 (PDF idx 11). "The game rules use dice to determine if an action succeeds or
  fails when a dramatic 'conflict' presents itself … The rules describe how to decide the
  outcome of such conflicts."
- **Classification:** COVERED (foundational; the procedure itself lives in Ch.5).
- **Implementation:** `core.percentile_check` in
  `plugins/coc-keeper/references/rules-json/rule-index.json:4`; table
  `percentile-check.json`; loader `coc_rules.percentile_check_rule()`
  (`plugins/coc-keeper/scripts/coc_rules.py:49`).
- **Gap / recommendation:** None. This chapter only asserts dice exist; the mechanics are
  audited under Chapter 5.

### 1.2 Successful skill use earns a "tick"

- **Rule:** On a successful skill roll the player marks the skill for later improvement.
- **Page:** p13 (PDF idx 12), Example of Play. "Don't forget to tick your Listen skill, as
  you got a success." / "(both tick their Stealth skills)."
- **Classification:** COVERED (the tick-eligibility predicates are defined in Ch.5 / Ch.10's
  Investigator Development Phase; the Example of Play here only demonstrates the convention).
- **Implementation:** `checks/coC7_rule_checklist.md` §E1–E11 (rules E1–E11) encode tick
  eligibility; reflected indirectly via the development-phase guidance in the
  `coc-character`/`coc-rules-engine` skills.
- **Gap / recommendation:** None new for this chapter. (See Chapter 5 §5.x for the
  recommended `core.development.*` rule-id additions.)

### 1.3 Sanity loss is rolled in dice

- **Rule:** Seeing a horror triggers a Sanity roll and SAN loss in dice.
- **Page:** p15–16 (PDF idx 14–15), Example of Play. "Okay, Jake loses 1D6 Sanity. (Garrie
  rolls a 4 on a 1D6). Jake loses 4 Sanity points"; "If you succeed you lose 1 point, if you
  fail it's going to be 1D10 points!"
- **Classification:** COVERED (mechanics audited under Chapter 8). The example uses the
  `X/Y` SAN-loss notation that `core.sanity.loss` already encodes.
- **Implementation:** `core.sanity.loss` (`rule-index.json:157`), `sanity.json`, the
  `coc-sanity` skill.
- **Gap / recommendation:** None new.

### 1.4 The 5-SAN-point temporary-insanity threshold (demonstrated, not defined here)

- **Rule:** Losing 5+ Sanity from a single source can trigger temporary insanity, gated by an
  INT roll.
- **Page:** p15 (PDF idx 14), Example of Play. "Paula, your investigator could be temporarily
  insane, since you've lost over 5 Sanity points. Unless you roll higher than his
  Intelligence on 1D100, it's all going to be too much for him to take and he'll faint."
- **Classification:** COVERED (defined formally in Ch.8 p155; demonstrated here).
- **Implementation:** `core.sanity.temporary_insanity_threshold` (`rule-index.json:176`),
  `sanity.json` key `temporary_insanity_loss_threshold: 5`.
- **Gap / recommendation:** None new.

### 1.5 What You Need to Play (components)

- **Rule:** The game requires this rulebook, roleplaying dice, paper, pencils and an eraser.
- **Page:** p17 (PDF idx 16). "When you are ready to begin playing Call of Cthulhu, you only
  need a few things to start: This rulebook. Roleplaying dice. Paper. Pencils and an eraser."
- **Classification:** N/A — physical components, not a machine-checkable rule. (The dice set
  actually needed — d4/d6/d8/d100 — is itemized later in the Skills/Game System chapters and
  the Appendices; that is the checkable form and is covered by `percentile-check.json`'s die
  spec.)
- **Implementation:** None required.
- **Gap / recommendation:** None.

### Chapter 1 summary

| Rule | Class | Implementation |
|---|---|---|
| 1.1 Dice resolve conflicts | COVERED | `core.percentile_check`; `percentile-check.json` |
| 1.2 Success ⇒ tick | COVERED | checklist §E1–E11 (Ch.5) |
| 1.3 SAN loss in dice | COVERED | `core.sanity.loss` (Ch.8) |
| 1.4 5-SAN temp-insanity demo | COVERED | `core.sanity.temporary_insanity_threshold` (Ch.8) |
| 1.5 What You Need | N/A | — |

Counts: covered 4, partial 0, missing 0, N/A 1. **Chapter 1 is lore/orientation; no new
machine rules are introduced that are not formalized in Chapters 5 and 8.** No rule-index
additions recommended for this chapter.


## Chapter 2 — Lovecraft & the Cthulhu Mythos (printed p20; PDF idx 19)

**Scope (TOC + body, lines 1245–1700 of the extraction):** "Howard Philips Lovecraft" (p22),
"The Cthulhu Mythos" (p25), "What This Game Covers" (p16 bridge), "What Was Left Out"
(p26). The chapter is biography + literary cosmology: HPL's life and themes, and a taxonomy
of Mythos powers — Outer Gods (Azathoth, Yog-Sothoth, Nyarlathotep), Elder Gods (Nodens),
Great Old Ones (Cthulhu, Hastur, Cthugha, Ithaqua), and the Great Old Ones' famous couplet.

This is a **lore/atmosphere** chapter. Per the audit instructions, it is honestly classified
as **mostly NOT machine-checkable**. The only thread that connects to a mechanical rule is
the cosmological premise that cosmic knowledge and sanity are inversely coupled — which is
the narrative justification for `san.max = 99 − Cthulhu Mythos` (formalized and audited in
Chapter 8).

### 2.1 Cosmic truth vs. sanity tradeoff (narrative premise)

- **Rule (narrative):** The human mind cannot hold cosmic truth and sanity simultaneously;
  gaining Mythos knowledge erodes sanity.
- **Page:** p25 (PDF idx 24). "The human mind is an inflexible container. It cannot maintain
  cosmic truth and complete sanity—more of one poured in must spill out more of the other."
- **Classification:** N/A as written (prose); the **mechanical** expression is COVERED in Ch.8
  (`core.sanity.loss` plus the `san.max = 99 − CM` rule, which is in the checklist §F9/F10
  but not yet a standalone rule-id — see Chapter 8 recommendation).
- **Implementation:** `core.sanity.loss` (`rule-index.json:157`); checklist rules F9 (max SAN
  formula) and F10 (CM↔maxSAN coupling).
- **Gap / recommendation:** None for Chapter 2 itself. The `99 − CM` ceiling is a Chapter 8
  addition; see §8.x.

### 2.2 Named Mythos entities (deity/monster roster)

- **Rule (reference data):** The chapter names the principal Outer Gods, Elder Gods, and
  Great Old Ones.
- **Page:** p25–27 (PDF idx 24–26). Examples: "Azathoth, the daemon sultan and ruler of the
  cosmos"; "Yog-Sothoth … coterminous with all time and space"; "Nyarlathotep";
  "Nodens is the best-known Elder God"; "Cthulhu, the most famous creation of Lovecraft, is
  a Great Old One"; "Ithaqua the Windwalker"; "Hastur the Unspeakable"; "Cthugha".
- **Classification:** N/A here (these are flavor introductions; the **stat blocks** with
  SAN-loss values, armor, etc. live in Chapter 14 and are audited there). The
  `coc-mythos-reference` skill provides Keeper-side lookup guidance but no structured
  deity/monster JSON table exists yet.
- **Implementation:** Skill `coc-mythos-reference` (lookup guidance only); no JSON table.
- **Gap / recommendation:** Defer to Chapter 14 (recommend a `monsters.json` table keyed by
  entity name with SAN-loss / HP / armor / attacks). No Chapter 2 addition.

### Chapter 2 summary

| Rule | Class | Implementation |
|---|---|---|
| 2.1 Truth↔sanity tradeoff (prose) | N/A (mech. in Ch.8) | `core.sanity.loss` + checklist F9/F10 |
| 2.2 Named Mythos entities | N/A (stats in Ch.14) | `coc-mythos-reference` skill |

Counts: covered 0, partial 0, missing 0, N/A 2. **Chapter 2 is lore; no machine rules and no
rule-index additions.** Honest classification: N/A-dominant chapter.


## Chapter 3 — Creating Investigators (printed p28; PDF idx 27)

**Scope (TOC + body, lines ~1710–2400 of the extraction):** Five-step investigator creation
(p30); Step 1 Generate Characteristics with per-characteristic dice formulas (p30–32);
Half/Fifth values (p32); Age modifiers table (p32); Other Attributes — Damage Bonus & Build
Table I (p33), Hit Points, Movement Rate (p33); Quick Reference: Investigator Generation
(p34); Step 2 Occupation + Occupational skill points (p36); Personal Interest skills (p36);
Credit Rating (p36); Step 3 skill point allocation; Cash and Assets Table II (p47).

### 3.1 Characteristic dice formulas

- **Rule:** Each characteristic has a fixed dice formula × 5. STR/CON/DEX/APP/POW = 3D6×5;
  SIZ/INT/EDU = (2D6+6)×5; Luck = 3D6×5 (rolled separately, independent of POW).
- **Page:** p30–31 (PDF idx 29–30). "STR (Strength): Roll 3D6 and multiply by 5"; "SIZ (Size):
  Roll 2D6+6 and multiply by 5"; "INT (Intelligence): Roll 2D6+6 and multiply by 5"; p31
  Luck: "When creating an investigator roll 3D6 and multiply by 5 for a Luck score."
- **Classification:** **MISSING.** No JSON table records the characteristic dice formulas; the
  skill prose mentions them but they are not machine-checkable.
- **Implementation:** None (prose only in `coc-character` skill).
- **Gap / recommendation:** Add `characteristic-dice.json` and a rule-id
  `core.character_creation.characteristic_dice`:
  ```json
  {
    "source_rule_id": "core.character_creation.characteristic_dice",
    "multiplier": 5,
    "formulas": {
      "STR": "3D6", "CON": "3D6", "DEX": "3D6", "APP": "3D6", "POW": "3D6",
      "SIZ": "2D6+6", "INT": "2D6+6", "EDU": "2D6+6",
      "Luck": "3D6"
    },
    "luck_is_independent_of_pow": true
  }
  ```

### 3.2 Luck default source (BUG — currently POW, should be 3D6×5)

- **Rule:** Luck is rolled independently as 3D6×5; it is NOT derived from POW.
- **Page:** p31 (PDF idx 30). "When creating an investigator roll 3D6 and multiply by 5 for a
  Luck score."
- **Classification:** **PARTIAL (data bug).** `derived-attributes.json` records
  `luck_default.source = "POW"`, and `coc_character.derive_values()` (line 51) falls back to
  `characteristics["POW"]` when no Luck is supplied. This is incorrect per the rulebook; Luck
  is a separate 3D6×5 roll.
- **Implementation:** `plugins/coc-keeper/references/rules-json/derived-attributes.json`
  `luck_default` block; `coc_character.derive_values()` (`coc_character.py:39,51`).
- **Gap / recommendation:** Fix `derived-attributes.json` so `luck_default` documents the
  independent roll (e.g. `"source": "rolled_3d6_x5"`, `"not_derived_from_pow": true`) and
  require Luck to be supplied. (Tracked as a recommendation because the `derive_values`
  signature change touches tests; flagged for a follow-up pass.)

### 3.3 Half and Fifth values

- **Rule:** Compute half = floor(value/2) and fifth = floor(value/5) for every characteristic
  and skill, recorded up front.
- **Page:** p32 (PDF idx 31). "Divide the percentage value by two, rounding down … Divide the
  percentage value by five, rounding down."
- **Classification:** **COVERED.**
- **Implementation:** `core.character_creation.half_fifth_values`
  (`rule-index.json:65`); `half-fifth-values.json`; `coc_rules.half_value()` /
  `coc_rules.fifth_value()` (`coc_rules.py:223,227`).
- **Gap / recommendation:** None.

### 3.4 Age modifiers (15–90, non-cumulative bracket) + EDU improvement check

- **Rule:** Pick one age bracket; apply its characteristic reductions, APP reduction, MOV
  penalty, EDU improvement checks (roll 1D100 > EDU ⇒ +1D10 EDU, capped at 99), and
  15–19 "roll Luck twice keep higher". Brackets are not cumulative.
- **Page:** p32 (PDF idx 31); Quick Reference p34 (PDF idx 33). "Use the appropriate
  modifiers for your chosen age only (they are not cumulative)." EDU check: "If the result is
  greater than your present EDU, add 1D10 percentage points … EDU cannot go above 99."
- **Classification:** **COVERED.**
- **Implementation:** `core.character_creation.age_modifiers`
  (`rule-index.json:59`); `age-adjustments.json` (8 brackets, 15–19 through 80–89, with all
  fields incl. `luck_rolls_keep_highest`); `coc_rules.age_adjustment()`
  (`coc_rules.py:324`); `coc_character.apply_age_modifiers()` (`coc_character.py:58`) which
  enforces the EDU-improvement 1D10 range and the EDU 99 cap.
- **Gap / recommendation:** None. (Edge: ages 90 requires Keeper adjudication per the JSON
  note; matches rulebook "If you wish to create an investigator outside this age range, it is
  up to the Keeper to adjudicate.")

### 3.5 Damage Bonus and Build (Table I)

- **Rule:** DB and Build are looked up from STR+SIZ on Table I (ranges 2–64 through 445–524),
  with the "+1D6 DB / +1 Build per extra 80 points" extension above 445.
- **Page:** p33 (PDF idx 32). Table I "Damage Bonus and Build"; footnote "*Add an additional
  1D6 to Damage Bonus and +1 to Build for each additional 80 points or fraction thereof."
- **Classification:** **PARTIAL.** The base table (9 rows, 2–524) is fully encoded, but the
  extrapolation rule above STR+SIZ 524 is NOT encoded; `coc_rules.damage_bonus_build()`
  (`coc_rules.py:239`) raises `ValueError` for any total above 524.
- **Implementation:** `core.character_creation.damage_bonus_build`
  (`rule-index.json:72`); `damage-bonus-build.json`; `coc_rules.damage_bonus_build()`.
- **Gap / recommendation:** Either extend `damage-bonus-build.json` with an explicit
  `extrapolation_above_524` block (`{"increment_points": 80, "db_per_increment": "+1D6",
  "build_per_increment": 1}`) and teach the loader to apply it, or document the cap. Affects
  large monsters (Ch.14) more than investigators.

### 3.6 Hit Points = floor((CON+SIZ)/10)

- **Rule:** HP = (CON + SIZ) / 10, rounding down.
- **Page:** p33 (PDF idx 32). "Figure out the character's hit point total by adding CON and
  SIZ, then dividing the total by ten (rounding down any fractions)."
- **Classification:** **COVERED.**
- **Implementation:** `core.character_creation.derived_attributes` hit_points block
  (`rule-index.json:84`); `derived-attributes.json` `hit_points`; `coc_character.derive_values`
  computes `sum(CON,SIZ) // 10` (`coc_character.py:48`).
- **Gap / recommendation:** None.

### 3.7 Magic Points = floor(POW/5)

- **Rule:** Magic points = POW / 5, rounding down.
- **Page:** p33 (PDF idx 32). "Magic points are equal to one-fifth of POW."
- **Classification:** **COVERED.**
- **Implementation:** `derived-attributes.json` `magic_points`; `coc_character.derive_values`
  (`coc_character.py:49`).
- **Gap / recommendation:** None.

### 3.8 Initial SAN = POW

- **Rule:** Sanity begins equal to POW.
- **Page:** p31 (PDF idx 30). "Sanity points (SAN) begin the game equal to the character's
  POW."
- **Classification:** **COVERED.**
- **Implementation:** `derived-attributes.json` `sanity.source = "POW"`;
  `coc_character.derive_values` (`coc_character.py:50`).
- **Gap / recommendation:** None.

### 3.9 Movement Rate (DEX/STR vs SIZ + age penalty)

- **Rule:** Base MOV 7/8/9 by the STR/DEX-vs-SIZ comparison (MOV 7 if both < SIZ; 9 if both
  > SIZ; else 8); age penalties 1/2/3/4/5 for ages in 40s/50s/60s/70s/80s; minimum MOV 0.
  "Do not apply these MOV rules to non-humans."
- **Page:** p33 (PDF idx 32).
- **Classification:** **COVERED.**
- **Implementation:** `core.character_creation.movement_rate`
  (`rule-index.json:77`); `movement-rate.json` (3 rules + age_penalty);
  `coc_rules.movement_rate()` (`coc_rules.py:267`) which honours `minimum_mov` and the
  age penalty.
- **Gap / recommendation:** None. (Non-human exclusion is a soft note, fine in JSON.)

### 3.10 Occupational skill points (per-occupation formula)

- **Rule:** Each occupation specifies a formula for its Occupational Skill Points (e.g.
  EDU×4 for Antiquarian/Professor; EDU×2 + APP×2 for Entertainer; EDU×2 + DEX×2 or STR×2 for
  Athlete) and a Credit Rating range.
- **Page:** p36 (PDF idx 35) "Occupation Skills"; sample occupation list p40–41 (PDF idx
  39–40). Example: "Occupation Skill Points: EDU × 4" (Antiquarian, Doctor of Medicine,
  Journalist, Professor of Science, etc.).
- **Classification:** **MISSING.** No `occupations.json` table exists; the
  `coc-character` skill describes occupations in prose only, so the per-occupation skill-point
  formula and CR range are not machine-checkable.
- **Implementation:** None (prose only).
- **Gap / recommendation:** Add `occupations.json` keyed by occupation name, each entry with
  `occupation_skill_points_formula`, `credit_rating_range`, and `occupation_skills` list; add
  rule-id `core.character_creation.occupation_skill_points`. (Larger addition; recorded as a
  recommended next step rather than a small safe fix.)

### 3.11 Personal Interest skill points = INT × 2

- **Rule:** Personal Interest points = INT × 2; may be spent on any skill except Cthulhu
  Mythos (unless the Keeper agrees). Unused points are lost.
- **Page:** p36 (PDF idx 35). "Multiply the investigator's INT × 2 and allot the points to
  any skills (which can include adding further points to occupation skills), except Cthulhu
  Mythos."
- **Classification:** **MISSING.** Not in any JSON table or script function.
- **Implementation:** None.
- **Gap / recommendation:** Add to the recommended `occupations.json` (or a sibling
  `skill-points.json`): `{"personal_interest": {"formula": "INT * 2",
  "excludes": ["Cthulhu Mythos"], "unused_lost": true}}` and rule-id
  `core.character_creation.personal_interest_points`.

### 3.12 Cash and Assets (Table II, by Credit Rating and period)

- **Rule:** Look up Cash on Hand, Assets, Spending Level, and Living Standard from Table II
  using Credit Rating and era (1920s / Modern).
- **Page:** p36 reference + p47 Table II (PDF idx 46).
- **Classification:** **COVERED.**
- **Implementation:** `core.character_creation.cash_and_assets`
  (`rule-index.json:90`); `cash-assets.json` (1920s + modern periods);
  `coc_rules.cash_and_assets()` (`coc_rules.py:350`).
- **Gap / recommendation:** None.

### Chapter 3 summary

| Rule | Class | Implementation |
|---|---|---|
| 3.1 Characteristic dice formulas | MISSING | (none) — add `characteristic-dice.json` |
| 3.2 Luck = 3D6×5 (not POW) | PARTIAL (bug) | `derived-attributes.json` luck_default (wrong) |
| 3.3 Half/Fifth values | COVERED | `core.character_creation.half_fifth_values` |
| 3.4 Age modifiers + EDU check | COVERED | `core.character_creation.age_modifiers`; `age-adjustments.json` |
| 3.5 Damage Bonus & Build (Table I) | PARTIAL | `damage-bonus-build.json` (no >524 extrapolation) |
| 3.6 HP = floor((CON+SIZ)/10) | COVERED | `derived-attributes.json` hit_points |
| 3.7 MP = floor(POW/5) | COVERED | `derived-attributes.json` magic_points |
| 3.8 Initial SAN = POW | COVERED | `derived-attributes.json` sanity |
| 3.9 MOV (STR/DEX vs SIZ + age) | COVERED | `core.character_creation.movement_rate` |
| 3.10 Occupational skill points | MISSING | (none) — add `occupations.json` |
| 3.11 Personal Interest = INT×2 | MISSING | (none) — add to skill-points JSON |
| 3.12 Cash & Assets (Table II) | COVERED | `core.character_creation.cash_and_assets` |

Counts: covered 8, partial 2, missing 3, N/A 0. **Recommended top additions for Chapter 3:**
(1) fix the Luck `derived-attributes.json` bug; (2) add `characteristic-dice.json`;
(3) add `occupations.json` + `skill-points.json`.


## Chapter 4 — Skills (printed p52; PDF idx 51)

**Scope (TOC + body, lines ~2945–5300 of the extraction):** "Skill Definitions" (p52), skill
proficiency bands (p52), specialization policy (p54), the **Skill List** with base chances
(p56), full per-skill descriptions with Opposing/Difficulty/Pushing/Consequences blocks
(p57–79), and the optional "Transferable Specializations" rule (p78). This chapter is mostly
descriptive prose (what each skill lets you do) plus two hard numeric tables: the base
chances and the transferable-benefit thresholds.

### 4.1 Skill base chances (Skill List, p56)

- **Rule:** Each skill has a printed base chance (e.g. Appraise 05%, Climb 20%, Credit Rating
  00%, Cthulhu Mythos 00%, Dodge = half DEX, First Aid 30%, Language (Own) = EDU, Library
  Use 20%, Listen 20%, Medicine 01%, Spot Hidden 25%, Stealth 20%, etc.). Some skills are
  tagged [Modern] (Computer Use, Electronics) or [Uncommon] (Animal Handling, Artillery,
  Hypnosis, Lore, Read Lips, Diving, Demolitions).
- **Page:** p56 (PDF idx 55).
- **Classification:** **MISSING.** No `skills.json` table of base chances exists; the base
  values appear only as prose in the Skill List. (The `core.character_creation.*` rules
  consume skill points but never validate a base chance.)
- **Implementation:** None.
- **Gap / recommendation:** Add `skills.json` keyed by skill name with `base_chance`,
  `specialization_group` (e.g. Fighting, Firearms, Science, Art/Craft, Language, Survival),
  `tags` (e.g. `["modern"]`, `["uncommon"]`), and `base_chance_is_derived` (for Dodge/Language
  Own). Add rule-id `core.skills.base_chances`. This is the single most useful Chapter 4
  addition because it lets `validate_character_sheet()` verify allocated points ≥ base.

### 4.2 Skill proficiency bands

- **Rule:** Skill value bands map to descriptive proficiency: 01–05 Novice, 06–19 Neophyte,
  20–49 Amateur, 50–74 Professional, 75–89 Expert, 90+ Master.
- **Page:** p52 (PDF idx 51). "01%–05%: Novice … 90%+: Master."
- **Classification:** **N/A** (descriptive flavor; no mechanical hook). Could optionally be
  encoded as a display helper.
- **Implementation:** None.
- **Gap / recommendation:** None (optionally a small `skill-bands.json` for UI labels).

### 4.3 Specialization policy (grouped skills)

- **Rule:** Art/Craft, Fighting, Firearms, Science, Language (Other), Pilot, Survival, and
  Lore are grouped skills (marked G); each is split into specializations. The Keeper may
  allow an alternate specialization at increased difficulty when there is overlap.
- **Page:** p52, p56, p54 (PDF idx 51, 55, 53).
- **Classification:** **PARTIAL.** Grouped skills are noted in the Skill List but the
  group→specialization map is not encoded anywhere machine-checkable.
- **Implementation:** None (prose in skills; `coc-language.py` is i18n labels, unrelated).
- **Gap / recommendation:** Fold the `specialization_group` field into the recommended
  `skills.json` (rule 4.1). No separate rule-id needed.

### 4.4 Transferable specialization benefit (optional rule)

- **Rule:** For Fighting, Firearms, Language (Other), and Survival specializations: the first
  time a specialization reaches ≥ 50, every other related specialization gains +10 (capped at
  50); the first time a specialization reaches ≥ 90, every other related specialization gains
  +10 again (capped at 90). May occur once per threshold per character. During character
  creation, the +10 may be applied before spending further points.
- **Page:** p78 (PDF idx 77). "When a character first raises a specialization within one of
  these skills to 50% or over, all other related skill specializations are raised by 10
  percentage points (but not higher than 50%). This may happen only once more: when a
  character first raises a specialization to 90% or over … again raised by 10 percentage
  points (but not higher than 90%)."
- **Classification:** **MISSING.** No rule-id, JSON, or script function.
- **Implementation:** None.
- **Gap / recommendation:** Add `core.skills.transferable_specialization` with numeric:
  ```json
  {
    "applies_to_groups": ["Fighting", "Firearms", "Language (Other)", "Survival"],
    "thresholds": [
      {"at_least": 50, "bonus_to_others": 10, "cap_others_at": 50, "once_per_character": true},
      {"at_least": 90, "bonus_to_others": 10, "cap_others_at": 90, "once_per_character": true}
    ]
  }
  ```

### 4.5 Cthulhu Mythos and Credit Rating never get development ticks

- **Rule:** CM and CR never receive a skill-improvement check; there is no tick box for them.
- **Page:** p56 (Skill List: "Cthulhu Mythos (00%)", "Credit Rating (00%)"); reinforcement
  p94 (PDF idx 103, checklist E4). Quoted in `checks/coC7_rule_checklist.md` §E4.
- **Classification:** **COVERED** (via the cross-cutting checklist; not yet a standalone
  rule-id but enforced conceptually in the development-phase guidance).
- **Implementation:** `checks/coC7_rule_checklist.md` §E4 (rule E4). Skill
  `coc-rules-engine` documents the untickable skills.
- **Gap / recommendation:** When Chapter 5's recommended `core.development.*` ids are added,
  include `untickable_skills: ["Cthulhu Mythos", "Credit Rating"]` in that block.

### 4.6 Language (Own) = EDU

- **Rule:** The investigator's Own Language skill begins equal to their EDU.
- **Page:** p56 Skill List "Language (Own) (EDU)"; p31 EDU section (PDF idx 30) "EDU …
  represents the investigator's starting percentage for the Own Language skill."
- **Classification:** **PARTIAL.** Documented in the `coc-character` skill prose, but no
  machine linkage from EDU to the Own Language base chance.
- **Implementation:** None (prose).
- **Gap / recommendation:** Capture under the recommended `skills.json`:
  `"Language (Own)": {"base_chance": "EDU", "base_chance_is_derived_from": "EDU"}`.

### Chapter 4 summary

| Rule | Class | Implementation |
|---|---|---|
| 4.1 Skill base chances (p56) | MISSING | (none) — add `skills.json` |
| 4.2 Proficiency bands | N/A | (flavor) |
| 4.3 Specialization groups | PARTIAL | (prose only) |
| 4.4 Transferable specialization benefit | MISSING | (none) — add `core.skills.transferable_specialization` |
| 4.5 CM/CR untickable | COVERED | checklist §E4 |
| 4.6 Language (Own) = EDU | PARTIAL | (prose only) |

Counts: covered 1, partial 2, missing 2, N/A 1. **Recommended top additions for Chapter 4:**
(1) `skills.json` with base chances + specialization groups (also unlocks §4.6 and supports
§4.3); (2) `core.skills.transferable_specialization` rule-id (§4.4).


## Chapter 5 — Game System (printed p80; PDF idx 79)

**Scope (TOC + body, lines ~4530–5660 of the extraction):** Skill rolls & difficulty levels
(p82–83); success/failure (p83); Pushed rolls (p84–86); Combined rolls incl. teamwork
(p87–88); Fumbles & Criticals (p89); Luck (p90); Intelligence/Idea/Know rolls (p90);
Opposed rolls (p90–91); the six success tiers (p91); Bonus and Penalty Dice (p91–92);
difficulty-from-opponent (50/90) (p93); Investigator Development Phase (p94); Skills of 90%+
SAN reward (p94); Spending Luck (p99); Recovering Luck (p99).

This chapter is the mechanical heart of the game and is **the best-covered chapter in the
system**, since it is the foundation of `checks/coC7_rule_checklist.md` sections A, B, C, D,
E, and L. The audit below confirms that coverage and records the few genuine gaps.

### 5.1 Difficulty levels (Regular/Hard/Extreme) and half/fifth targets

- **Page:** p82–83 (PDF idx 81–82). "Regular difficulty level … the player needs to roll
  equal to or below the target set by the Keeper"; "Hard difficulty level … a half"; "Extreme
  difficulty level … a fifth."
- **Classification:** **COVERED.**
- **Implementation:** `core.difficulty.regular/hard/extreme` (`rule-index.json:23,31,39`);
  `difficulty-levels.json`; `coc_rules.difficulty_target()` (`coc_rules.py:231`); checklist
  §A1–A3, §L1–L2.

### 5.2 Difficulty-from-opponent (50/90 thresholds)

- **Page:** p83 (PDF idx 82). "If the opponent's skill or characteristic is below 50, the
  difficulty level is Regular … equal to or above 50 … Hard … equal to or above 90 …
  Extreme."
- **Classification:** **COVERED.**
- **Implementation:** checklist §A4.

### 5.3 Six success tiers + numeric bands

- **Page:** p91 (PDF idx 100). "A skill roll can yield one of six results: Fumble … Failure
  … Regular success … Hard success … Extreme success … Critical success: a roll of 01."
- **Classification:** **COVERED.**
- **Implementation:** `core.success_level` (`rule-index.json:47`); `success-levels.json`;
  `coc_rules.success_level()` (`coc_rules.py:397`); checklist §A5, §A6.

### 5.4 Critical = 01 (and combat critical = max damage)

- **Page:** p89 (PDF idx 98). "01: A Critical Success … In combat, for example, a critical
  success means that the attacker has hit a vulnerable spot and causes maximum damage."
- **Classification:** **COVERED.**
- **Implementation:** checklist §B1 (critical=01) and §B2 (combat critical=max damage).

### 5.5 Fumble bands (target ≥ 50 ⇒ 100; target < 50 ⇒ 96–100; difficulty-scaled)

- **Page:** p90 (PDF idx 99). "If the dice roll required for success is 50 or over and the
  dice read 100, a fumble has occurred. If the dice roll required for success is below 50 and
  the dice read 96—100, a fumble has occurred." Difficulty-scaled example (Harvey Library Use
  55→Hard 27⇒96–100) on the same page.
- **Classification:** **COVERED.**
- **Implementation:** `core.success_level` numeric block (`rule-index.json:47`);
  `success-levels.json` fumble block; `coc_rules._is_fumble()` (`coc_rules.py:389`);
  checklist §B3–B5.

### 5.6 Fumble not negatable by push; immediate

- **Page:** p89 (PDF idx 98). "The impact of Fumbles should take effect immediately and may
  not be negated through pushing the roll."
- **Classification:** **COVERED.**
- **Implementation:** checklist §B6.

### 5.7 Bonus / penalty dice (take lowest / highest tens; cancel one-for-one)

- **Page:** p91–92 (PDF idx 100–101). "If you have a bonus die, you should use the 'tens' die
  that yields the better (lower) result"; "For a penalty, use the 'tens' die that yields the
  worse (highest) result"; "One bonus die and one penalty die cancel each other out."
- **Classification:** **COVERED.**
- **Implementation:** `core.percentile_check.roll_modifiers` (`rule-index.json:11`);
  `roll-modifiers.json`; `coc_rules.roll_modifiers_rule()` (`coc_rules.py:63`); checklist
  §C1–C4.

### 5.8 Skill rolls use difficulty; opposed rolls use BP dice

- **Page:** p92 (PDF idx 101). "Skill rolls: Set level of difficulty. Opposed rolls: Award
  penalty dice or bonus dice."
- **Classification:** **COVERED.**
- **Implementation:** checklist §C4.

### 5.9 Pushed rolls (scope, consent, foreshadowing, single retry, outcome)

- **Page:** p84–86 (PDF idx 93–95). "A pushed roll is only allowed if it can be justified,
  and it is up to the player to do this"; p85 "Only skill and characteristic rolls can be
  pushed, not Luck, Sanity, or combat rolls …"; p85 "Before rolling the dice for a pushed
  roll, the consequence of failure may be foreshadowed"; p86 pushed-success/failure handling.
- **Classification:** **COVERED.**
- **Implementation:** `core.pushed_roll` (`rule-index.json:103`); `pushed-roll.json`;
  `coc_rules.pushed_roll_rule()` (`coc_rules.py:88`); checklist §D1–D7.

### 5.10 Opposed rolls (mutually exclusive goals; compare success levels; tie → higher skill; cannot push)

- **Page:** p90–91 (PDF idx 99–100). "both sides declare a mutually exclusive goal";
  "Opposed skill rolls cannot be pushed."; p91 tie-break "the side with the higher skill (or
  characteristic) wins."
- **Classification:** **COVERED.**
- **Implementation:** `core.opposed_roll` (`rule-index.json:127`); `combat.json`
  `opposed_roll` block; `coc_rules.opposed_roll_rule()` (`coc_rules.py:127`); checklist §A6.

### 5.11 Combined rolls (single roll vs multiple targets)

- **Page:** p87 (PDF idx 86), "Combined Skill Rolls" section.
- **Classification:** **COVERED** (the basic one-roll-vs-N-targets case).
- **Implementation:** `core.combined_roll` (`rule-index.json:115`); `combat.json`
  `combined_roll` block; `coc_rules.combined_roll_rule()` (`coc_rules.py:117`).
- **Gap / recommendation:** The **teamwork combined roll** (p87–88: deduct each assisting
  investigator's characteristic in turn from the opposition until the remainder is
  challengeable; cannot reduce opposition below a value requiring a roll) is **MISSING**.
  Recommend `core.combined_roll.teamwork` with numeric `{reduce_opposition_per_assist: true,
  minimum_opposition_requires_roll: true, physical_only: true}`.

### 5.12 Investigator Development Phase (skill improvement)

- **Page:** p94 (PDF idx 103). Tick on success; no tick with bonus die; opposed ⇒ winner
  ticks; CM/CR never tick; one check per skill per phase; development roll 1D100 > skill ⇒
  +1D10 (skill may exceed 100); 90% ⇒ +2D6 SAN.
- **Classification:** **COVERED** via the checklist, but **MISSING as standalone rule-ids**
  in `rule-index.json` (the development phase is the largest mechanical block with no
  dedicated rule-id).
- **Implementation:** checklist §E1–E11. No `core.development.*` ids.
- **Gap / recommendation:** Add a family of rule-ids under
  `core.development.{tick_on_success, no_tick_with_bonus_die, opposed_winner_ticks,
  untickable_skills, one_check_per_skill, improvement_roll, skill_over_100,
  sanity_reward_at_90}` with numeric `{development_die: "1D100",
  improvement_amount_die: "1D10", improves_if_roll_gt_skill_or_gt_95: true,
  skill_ceiling: null, sanity_reward_at_90_die: "2D6",
  untickable_skills: ["Cthulhu Mythos","Credit Rating"]}`. Backed by a `development.json`
  table.

### 5.13 Spending Luck (1-for-1; scope; XOR with push; can't buy off crit/fumble/malfunction; no tick)

- **Page:** p99 (PDF idx 108). "The player can use Luck points to alter a roll on a 1-for-1
  basis"; "Luck points may not be spent on Luck rolls, damage rolls, Sanity rolls, or rolls to
  determine the amount of Sanity points lost"; "When a skill roll is failed, the player has
  the option to push the roll OR spend luck"; "Criticals, fumbles, and firearm malfunctions
  always apply, and cannot be bought off with Luck points"; "no skill improvement check is
  earned if Luck points were used."
- **Classification:** **COVERED** via checklist, **MISSING as standalone rule-id**.
- **Implementation:** checklist §L10 (Luck exclusions), §L11 (Luck-vs-push XOR), §L12
  (Luck-spend scope), §E10 (no tick when Luck spent).
- **Gap / recommendation:** Add `core.luck.spend` rule-id with the numeric block:
  `{rate: "1_for_1", only_own_rolls: true, excluded_rolls: ["luck","damage","sanity",
  "san_loss"], xor_with_push: true, unstoppable_outcomes: ["critical","fumble",
  "firearm_malfunction"], forfeits_tick: true}`. Backed by a `luck.json` table.

### 5.14 Luck recovery (per session; 1D100 > Luck ⇒ +1D10; cap 99)

- **Page:** p99 (PDF idx 108). "The player rolls 1D100 and if the roll is above their
  present Luck score they add 1D10 points to their Luck score"; "may not exceed 99."
- **Classification:** **COVERED** via checklist §E9, **MISSING as standalone rule-id**.
- **Implementation:** checklist §E9.
- **Gap / recommendation:** Add `core.luck.recovery` numeric `{per_session: true,
  improvement_die: "1D100", recovers_if_roll_gt_luck: true, recovery_amount_die: "1D10",
  maximum: 99, starting_value_not_reused: true}`. Fold into the recommended `luck.json`.

### 5.15 Luck rolls (Keeper-called; lowest-Luck rolls for group Luck)

- **Page:** p90 (PDF idx 99). "Luck rolls may be called for by the Keeper when circumstances
  external to any investigator are in question"; "the player whose investigator has the
  lowest Luck score … should make the roll."
- **Classification:** **PARTIAL.** Luck-roll target = current Luck is implied but not encoded;
  the group-Luck-lowest-rolls rule is in prose only.
- **Implementation:** None (prose in `coc-rules-engine`).
- **Gap / recommendation:** Fold into `luck.json`: `luck_rolls.target = "current_luck"`,
  `group_luck_roll.maker = "lowest_luck_present"`.

### 5.16 Idea roll and Know roll

- **Rule:** Idea roll = roll vs INT (same mechanic as an INT roll but proposed by players when
  stuck). Know roll = roll vs EDU (recall from education).
- **Page:** p90 (PDF idx 99). "An Idea roll is … made in the same manner by rolling equal to
  or below the investigator's Intelligence characteristic"; "Roll equal to or under a
  character's EDU value to determine the success of a Know roll."
- **Classification:** **MISSING** (no rule-id or table; not in the checklist).
- **Implementation:** None.
- **Gap / recommendation:** Add `core.resolution.idea_roll` (`{target_characteristic:
  "INT"}`) and `core.resolution.know_roll` (`{target_characteristic: "EDU"}`). Small JSON
  entries; these recur in Chapter 10.

### Chapter 5 summary

| Rule | Class | Implementation |
|---|---|---|
| 5.1 Difficulty levels + half/fifth | COVERED | `core.difficulty.*`; checklist A1–A3,L1–L2 |
| 5.2 Difficulty-from-opponent 50/90 | COVERED | checklist A4 |
| 5.3 Six success tiers + bands | COVERED | `core.success_level`; checklist A5–A6 |
| 5.4 Critical = 01 (+ combat max dmg) | COVERED | checklist B1–B2 |
| 5.5 Fumble bands (diff-scaled) | COVERED | `core.success_level`; checklist B3–B5 |
| 5.6 Fumble not pushable | COVERED | checklist B6 |
| 5.7 Bonus/penalty dice | COVERED | `core.percentile_check.roll_modifiers`; C1–C3 |
| 5.8 Skill=difficulty, opposed=BP | COVERED | checklist C4 |
| 5.9 Pushed rolls | COVERED | `core.pushed_roll`; checklist D1–D7 |
| 5.10 Opposed rolls | COVERED | `core.opposed_roll`; checklist A6 |
| 5.11 Combined rolls (+ teamwork) | PARTIAL | `core.combined_roll` (teamwork MISSING) |
| 5.12 Investigator Development Phase | PARTIAL | checklist E1–E11 (no rule-ids) |
| 5.13 Spending Luck | PARTIAL | checklist L10–L12,E10 (no rule-id) |
| 5.14 Luck recovery | PARTIAL | checklist E9 (no rule-id) |
| 5.15 Luck rolls (group lowest) | PARTIAL | (prose only) |
| 5.16 Idea / Know rolls | MISSING | (none) |

Counts: covered 10, partial 5, missing 1, N/A 0. **Recommended top additions for Chapter 5:**
(1) the `core.development.*` family (§5.12); (2) `core.luck.spend`/`core.luck.recovery`
(§5.13–5.14); (3) `core.resolution.idea_roll`/`know_roll` (§5.16); (4)
`core.combined_roll.teamwork` (§5.11).


## Chapter 6 — Combat (printed p100; PDF idx 99)

**Scope (TOC + body, lines ~5660–7270 of the extraction):** Declaration of intent (p102); The
Combat Round (p102); DEX order (p102); Fist Fights — fight-back vs dodge resolution (p103);
Extreme damage / impales (p103); no pushing combat rolls (p104); Fighting Maneuvers &
Build (p105–106); Striking the First Blow / Surprise (p106); Ranged & Thrown Weapons (p108);
Escaping Close Combat (p108); Armor (p108); Outnumbered (p108); Firearms — range, point
blank, aiming, multi-shot, diving for cover, fast-moving/concealment/prone/size modifiers,
malfunction (p112–118); Wounds & Healing — regular/major/dying, First Aid, Medicine,
recovery (p119–122); Big-Game/shotgun/other damage (p123–128); Sample Poisons (p129).

Combat is the **second-best-covered chapter** (after Ch.5), via checklist §H, §I, §J, §L **and**
a full `CombatSession` engine in `coc_combat.py`.

### 6.1 Combat round; DEX order; tie → higher combat skill

- **Page:** p102 (PDF idx 101). "Determine the order of attack by ranking the combatants' DEX
  from highest to lowest. In the case of a draw, the side with the higher combat skill goes
  first."
- **Classification:** **COVERED.**
- **Implementation:** `core.combat.attack_or_maneuver` order block (`rule-index.json:142`);
  `combat.json` `melee_combat.order`; `coc_combat.CombatSession.begin_round()` /
  `_turn()` (`coc_combat.py:137,202`) — sorts by DEX desc, tie-break by combat skill;
  checklist §H1.

### 6.2 Readied firearm acts at DEX + 50

- **Page:** p112 (PDF idx 111). "readied firearms may shoot at DEX + 50 in the DEX order."
- **Classification:** **COVERED.**
- **Implementation:** `coc_combat.py:141` (`eff_dex` adds 50 for readied-firearm
  participants); checklist §H2.

### 6.3 Defense choice (dodge OR fight back, mutually exclusive); surprise ⇒ none

- **Page:** p103 (PDF idx 102). "When attacked, a character has a simple choice: either dodge
  or fight back."
- **Classification:** **COVERED.**
- **Implementation:** `combat.json` `defense_options: [dodge, fight_back, maneuver]`;
  `coc_combat._resolve_attack()` (`coc_combat.py:422`); checklist §H3.

### 6.4 Fight-back / Dodge opposed-roll resolution (incl. tie winners)

- **Page:** p103 (PDF idx 102). Fight-back tie → attacker; Dodge tie → defender; both fail ⇒
  no damage.
- **Classification:** **COVERED.**
- **Implementation:** `combat.json` `attack_vs_dodge.tie_winner: "defender"`,
  `attack_vs_fight_back.tie_winner: "attacker"`, both `both_fail_damage: false`;
  `coc_combat._resolve_opposed()` (`coc_combat.py:355`); checklist §H4, §H5.

### 6.5 Extreme success: blunt=max damage (+max DB); impale=max+max DB+weapon roll

- **Page:** p103 (PDF idx 102). "If the attacker achieves an Extreme success with a
  non-impaling weapon … maximum damage (plus maximum damage bonus …). If the attacker
  achieves an Extreme level of success with a penetrating weapon … impale … add a damage
  roll for the weapon."
- **Classification:** **COVERED.**
- **Implementation:** `coc_combat._resolve_attack()` applies max-damage / impale
  (`coc_combat.py:563` sets `impale_or_max`); checklist §H6.

### 6.6 Extreme/impale only on own turn (not when fighting back)

- **Page:** p103 (PDF idx 102). "This only occurs if the attack is made on a character's turn
  in the DEX order, not when fighting back."
- **Classification:** **COVERED.**
- **Implementation:** `coc_combat` resolves the acting character's turn separately from
  defense responses; checklist §H7.

### 6.7 Unarmed human damage = 1D3

- **Page:** p103 (PDF idx 102). "the damage for unarmed human attacks is 1D3."
- **Classification:** **COVERED.**
- **Implementation:** `coc_combat._weapon()` default unarmed entry (`coc_combat.py:679`:
  `{"damage": "1D3", "impales": False}`); checklist §H8.

### 6.8 No pushing combat rolls

- **Page:** p104 (PDF idx 103). "There is no option to push combat rolls (either Fighting or
  Firearms)."
- **Classification:** **COVERED.**
- **Implementation:** `combat.json` `combat_rolls_can_be_pushed: false`;
  `core.combat.attack_or_maneuver` numeric (`rule-index.json:142`); checklist §D5.

### 6.9 Fighting Maneuvers — Build-difference modifiers

- **Page:** p105–106 (PDF idx 104–105). Δ Build ≥3 impossible; Δ=2 ⇒ 2 penalty dice; Δ=1 ⇒ 1
  penalty die; Δ≤0 none.
- **Classification:** **COVERED.**
- **Implementation:** `combat.json` `maneuver` block (`build_difference_impossible_at: 3`,
  `penalty_die_per_build_difference: 1`); `coc_combat._resolve_maneuver()`
  (`coc_combat.py:646`); checklist §I1.

### 6.10 Maneuver vs dodge / vs fight-back (tie winners)

- **Page:** p106 (PDF idx 105). Maneuver vs dodge tie ⇒ target dodges; vs fight-back tie ⇒
  maneuver succeeds.
- **Classification:** **COVERED.**
- **Implementation:** `combat.json` `maneuver.attack_vs_dodge_tie_winner: "target"`,
  `attack_vs_fight_back_tie_winner: "maneuver_actor"`; checklist §I2, §I3.

### 6.11 Surprise / striking the first blow

- **Rule:** A surprise attack may be auto-success (or attacker bonus die) if the target fails
  a Listen/Spot Hidden/Psychology vs attacker Stealth; ranged surprise still requires a hit
  roll; once resolved, switch to combat rounds.
- **Page:** p106 (PDF idx 105).
- **Classification:** **PARTIAL.** `coc_combat` supports a `surprise_attack` action
  (`coc_combat.py:592`) and a `surprised` condition, but the Listen/Spot Hidden/Psychology
  vs Stealth detection check is not encoded as a structured rule.
- **Implementation:** `coc_combat._resolve_surprise_attack()`; conditions set in
  `VALID_CONDITIONS`.
- **Gap / recommendation:** Add `core.combat.surprise_detection` rule-id with
  `{detection_skills: ["Listen","Spot Hidden","Psychology"], opposition_skill: "Stealth",
  undetected: {melee: "automatic_success_or_bonus_die", ranged: "roll_to_hit"}}.

### 6.12 Outnumbered — bonus die after first defense (melee only)

- **Page:** p108 (PDF idx 107). "Once a character has either fought back or dodged in the
  present combat round, all subsequent melee attacks on them are made with one bonus die.
  This does not apply to attacks made using firearms."
- **Classification:** **COVERED.**
- **Implementation:** `coc_combat._mark_defended()` / `has_defended_this_round()`
  (`coc_combat.py:176,188`) plus the +1 bonus die in `_resolve_attack()`; checklist §H9.

### 6.13 Firearm resolution — single roll vs Firearms at range-set difficulty; no damage on failure

- **Page:** p112 (PDF idx 111). "The firearms roll is not opposed. The difficulty level is
  determined by the range … A failure never deals damage."
- **Classification:** **COVERED.**
- **Implementation:** `coc_combat._resolve_attack()` (`coc_combat.py:422`) range-band branch
  (`range_band`, `point_blank`); checklist §H10.

### 6.14 Range difficulty (base=Regular, 2×=Hard, 4×=Extreme); very-long impale only on critical

- **Page:** p112 (PDF idx 111). "Within the base range: Regular … Long range … Hard … Very
  long range … Extreme"; "At very long range … an impale only occurs with a critical hit (a
  roll of 01)."
- **Classification:** **COVERED.**
- **Implementation:** `coc_combat.py:442` (range_band→difficulty) and `:461-463`
  (long/very_long impale restriction); checklist §H11, §H12.

### 6.15 Point-blank (within DEX/5 feet) ⇒ bonus die; aiming ⇒ bonus die; multi-shot ⇒ penalty die

- **Page:** p113 (PDF idx 112). "If the target is at point-blank range—within a fifth of the
  shooter's DEX in feet—the attacker gains a bonus die"; "If no other actions are taken
  before the shot is fired, the attacker gains one bonus die" (aiming); "When firing two or
  three shots in one round … all shots receiving one penalty die."
- **Classification:** **COVERED** (point-blank in engine); **PARTIAL** (aiming and
  multi-shot penalty are documented but not first-class engine flags).
- **Implementation:** `coc_combat.py:446` point_blank ⇒ +1 bonus die; checklist §H13, §H14,
  §H15.
- **Gap / recommendation:** Add explicit `aiming_previous_round` and `multi_shot_count`
  fields to the combat event schema; covered by checklist, just not yet structured.

### 6.16 Firearm malfunction (roll ≥ malfunction number ⇒ no fire)

- **Page:** p118 (PDF idx 117). "With any attack roll result equal to or higher than the
  firing weapon's malfunction number … his or her weapon does not fire."
- **Classification:** **PARTIAL.** Encoded as a checklist rule (§H16) and noted in the
  combat skill, but no per-weapon `malfunction` field is consumed by `coc_combat`.
- **Implementation:** checklist §H16; `coc_combat._weapon()` does not read a malfunction
  number.
- **Gap / recommendation:** Add `malfunction` to weapon definitions (see Chapter 16 Weapons
  Table XVII recommendation) and have `_resolve_attack()` flag a malfunction when
  `roll >= weapon.malfunction`.

### 6.17 Diving for cover, fast-moving, size, concealment, prone modifiers

- **Page:** p113, p128 (PDF idx 112, 127).
- **Classification:** **COVERED** (checklist); diving-for-cover partly in engine
  (`_mark_dived_for_cover`, `coc_combat.py:181`).
- **Implementation:** checklist §L4–L8; `coc_combat` diving-for-cover support.
- **Gap / recommendation:** None.

### 6.18 Combat movement = MOV × 5 yards/round

- **Page:** p127 (PDF idx 126). "The maximum distance a character can move in one combat
  round is equal to their MOV rating multiplied by 5, in yards."
- **Classification:** **COVERED.**
- **Implementation:** checklist §L9.

### 6.19 Wounds: regular / major-wound threshold (≥ floor(maxHP/2)) / overkill (> maxHP ⇒ death)

- **Page:** p119 (PDF idx 118). "Equal to or more than half the character's maximum hit
  points, it is a Major Wound"; "More than the character's maximum hit points, the result is
  death"; "A character cannot die as a result of regular damage."
- **Classification:** **COVERED.**
- **Implementation:** `coc_combat._update_conditions()` (`coc_combat.py:712`) sets
  major_wound/dying; checklist §J1, §J3, §J7.

### 6.20 Major wound effects (prone, CON roll or unconscious); 0 HP + major wound ⇒ dying

- **Page:** p120 (PDF idx 119). "Tick the Major Wound box. The character immediately falls
  prone. Make a successful CON roll …"; p120 dying.
- **Classification:** **COVERED.**
- **Implementation:** `coc_combat` conditions; checklist §J2, §J5.

### 6.21 HP floor at 0 (no negative); dying CON cycle (one fail ⇒ death)

- **Page:** p120 (PDF idx 119). "do not record negative hit points"; "if one of these CON
  rolls fails, the character dies immediately."
- **Classification:** **COVERED.**
- **Implementation:** checklist §J4, §J6; `coc_combat` HP clamps at 0.

### 6.22 First Aid (≤1 hr, +1 HP, second+ attempt is pushed) and Medicine (≥1 hr, +1D3 HP, Hard if not same day)

- **Page:** p120 (PDF idx 119).
- **Classification:** **PARTIAL.** Encoded as checklist rules §J8, §J9 and described in the
  `coc-character` skill, but `coc_combat` has no `first_aid`/`medicine` action — healing is
  out-of-engine.
- **Implementation:** checklist §J8, §J9.
- **Gap / recommendation:** Add `core.combat.healing` rule-id with
  `{first_aid: {within_hours: 1, hp: 1, second_attempt_is_pushed: true},
  medicine: {minimum_hours: 1, hp_die: "1D3", hard_if_not_same_day: true}}` and a
  `healing.json` table.

### 6.23 Recovery rates (regular 1 HP/day; major-wound weekly CON: fail 0 / success 1D3 / extreme 2D3; clear on extreme or HP ≥ half)

- **Page:** p121 (PDF idx 120).
- **Classification:** **COVERED** (checklist).
- **Implementation:** checklist §J10, §J11, §J12.
- **Gap / recommendation:** Fold into the recommended `core.combat.healing` / `healing.json`
  (no engine hook needed; this is downtime).

### 6.24 Armor reduces damage point-for-point (not vs magic/poison/drowning); shotgun vs armor per-die

- **Page:** p108 (PDF idx 107); p126 (PDF idx 125).
- **Classification:** **COVERED.**
- **Implementation:** `coc_combat._damage_roll()` (`coc_combat.py:261`) applies fixed and
  degrading armor; checklist §J13, §J14.
- **Gap / recommendation:** The shotgun-per-die armor rule (§J14) is in the checklist but
  `coc_combat`'s armor loop applies once per damage roll, not per die. Minor; record as a
  refinement to `_damage_roll` for shotgun die expressions.

### 6.25 Sample Poisons table (p129)

- **Rule:** 11 sample poisons with speed, effect (damage dice), and notes (Amanita, Arsenic,
  Belladonna, Black Widow, Chloroform, Cobra Venom, Curare, Cyanide, Rattlesnake, Rohypnol,
  Strychnine).
- **Page:** p129 (PDF idx 128).
- **Classification:** **MISSING.** No `poisons.json` table; not in checklist.
- **Implementation:** None.
- **Gap / recommendation:** Add `poisons.json` keyed by name with `speed`, `damage_die`
  (e.g. "4D10", "1D10", "None"), `unconsciousness_duration`, `notes`, and `tags` (e.g.
  `["modern"]` for Rohypnol). Add rule-id `core.combat.sample_poisons`.

### Chapter 6 summary

| Rule | Class | Implementation |
|---|---|---|
| 6.1 Combat round / DEX order | COVERED | `core.combat.attack_or_maneuver`; `coc_combat.begin_round` |
| 6.2 Readied firearm DEX+50 | COVERED | `coc_combat` eff_dex; checklist H2 |
| 6.3 Defense choice | COVERED | `combat.json` defense_options |
| 6.4 Fight-back/Dodge resolution | COVERED | `combat.json`; `_resolve_opposed` |
| 6.5 Extreme/impale damage | COVERED | `_resolve_attack`; checklist H6 |
| 6.6 Extreme only on own turn | COVERED | checklist H7 |
| 6.7 Unarmed = 1D3 | COVERED | `_weapon` default |
| 6.8 No pushing combat | COVERED | `combat_rolls_can_be_pushed:false` |
| 6.9 Maneuver Build modifiers | COVERED | `combat.json` maneuver |
| 6.10 Maneuver tie winners | COVERED | `combat.json` maneuver |
| 6.11 Surprise detection | PARTIAL | `_resolve_surprise_attack` (no detection rule) |
| 6.12 Outnumbered bonus die | COVERED | `_mark_defended`; checklist H9 |
| 6.13 Firearm resolution | COVERED | `_resolve_attack`; checklist H10 |
| 6.14 Range difficulty + very-long impale | COVERED | `coc_combat.py:442,461` |
| 6.15 Point-blank/aim/multi-shot | PARTIAL | point-blank in engine; aim/multi-shot docs |
| 6.16 Firearm malfunction | PARTIAL | checklist H16; no weapon field |
| 6.17 Diving/size/conceal/prone | COVERED | checklist L4–L8 |
| 6.18 Movement MOV×5 | COVERED | checklist L9 |
| 6.19 Wound thresholds | COVERED | `_update_conditions`; checklist J1,J3,J7 |
| 6.20 Major wound effects / dying | COVERED | checklist J2,J5 |
| 6.21 HP floor / dying CON cycle | COVERED | checklist J4,J6 |
| 6.22 First Aid / Medicine | PARTIAL | checklist J8,J9 (no engine action) |
| 6.23 Recovery rates | COVERED | checklist J10–J12 |
| 6.24 Armor / shotgun-vs-armor | COVERED | `_damage_roll`; checklist J13,J14 |
| 6.25 Sample Poisons table | MISSING | (none) — add `poisons.json` |

Counts: covered 17, partial 5, missing 1, N/A 0. **Recommended top additions for Chapter 6:**
(1) `poisons.json` + `core.combat.sample_poisons` (§6.25); (2) `core.combat.healing` +
`healing.json` (§6.22–6.23); (3) `core.combat.surprise_detection` (§6.11); (4) per-weapon
`malfunction` field (§6.16).


## Chapter 7 — Chases (printed p130; PDF idx 129)

**Scope (TOC + body, lines ~7270–8120 of the extraction):** Five parts — (1) Establishing the
chase + Speed Roll + Compare Speeds (p132); (2) Cut to the Chase + starting range = 2
locations + Locations (p133); (3) The Chase Round, DEX order, Movement Actions (p134),
Hazards (p135), Barriers (p136), Breaking down Barriers (p137); (4) Conflict (p138); (5)
Supplementary — vehicle build damage, vehicle impairment (p145). The checklist captures the
bulk as §K1–K14.

### 7.1 Establishing speed roll (CON for foot / Drive Auto for vehicle)

- **Rule:** Each participant rolls CON (foot) or Drive Auto (vehicle): success ⇒ MOV
  unchanged; Extreme success ⇒ MOV +1; failure ⇒ MOV −1. The adjustment lasts the whole
  chase.
- **Page:** p132 (PDF idx 131). "On a success: no change to MOV rating … On an extreme
  success: +1 to MOV rating … On a failure: –1 to MOV rating."
- **Classification:** **PARTIAL.** Captured in checklist §K1, but no rule-id or `chase.json`
  entry encodes it.
- **Implementation:** checklist §K1 only.
- **Gap / recommendation:** Add `core.chase.speed_roll` with
  `{foot_skill: "CON", vehicle_skill: "Drive Auto", success: "mov_unchanged",
  extreme_success: "mov_plus_1", failure: "mov_minus_1", duration: "whole_chase"}`.

### 7.2 Escape criterion (fleeing adjusted MOV > pursuer adjusted MOV)

- **Rule:** If fleeing adjusted MOV > pursuer adjusted MOV, the chase is NOT played.
- **Page:** p132 (PDF idx 131). "The fleeing character escapes if their adjusted MOV is higher
  than their pursuer."
- **Classification:** **COVERED** (checklist §K2); not yet a rule-id.
- **Implementation:** checklist §K2.
- **Gap / recommendation:** Fold into `core.chase.speed_roll` or add
  `core.chase.escape_criterion: {flee_escapes_if: "flee_adjusted_mov > pursuer_adjusted_mov"}`.

### 7.3 Default starting range = 2 locations

- **Rule:** A played chase begins with the pursuer 2 locations behind (default; 1 for a tenser
  chase; not advised beyond 2).
- **Page:** p133 (PDF idx 132). "The Keeper would normally set the starting range to two
  locations."
- **Classification:** **COVERED** (checklist §K3).
- **Implementation:** checklist §K3.
- **Gap / recommendation:** Add `core.chase.starting_range: {default: 2, minimum: 1,
  advised_maximum: 2}`.

### 7.4 Movement actions = 1 + (MOV − slowest_MOV)

- **Rule:** Each participant gets 1 + (own MOV − min MOV in chase) movement actions; slowest
  has 1; minimum 1.
- **Page:** p134 (PDF idx 133).
- **Classification:** **COVERED.**
- **Implementation:** `core.chase.movement_actions` (`rule-index.json:194`);
  `chase.json` `movement_actions`; `coc_rules.chase_rule()` (`coc_rules.py:100`); checklist
  §K4.

### 7.5 Open-ground movement = 1 action per location

- **Rule:** Hazard-free adjacent location costs 1 movement action.
- **Page:** p134 (PDF idx 133).
- **Classification:** **COVERED** (checklist §K5).
- **Implementation:** checklist §K5.
- **Gap / recommendation:** Add `core.chase.open_ground_cost: {per_location: 1}`.

### 7.6 Cautious hazard negotiation — buy bonus dice (max 2)

- **Rule:** Spending 1 movement action buys 1 bonus die on a hazard skill roll; 2 actions buy
  2 bonus dice (max 2).
- **Page:** p135 (PDF idx 134). "1 movement action buys 1 bonus die, or 2 movement actions
  buys 2 bonus dice (2 bonus dice is the maximum that can be rolled)."
- **Classification:** **COVERED** (checklist §K6).
- **Implementation:** checklist §K6.
- **Gap / recommendation:** Add `core.chase.cautious_hazard: {actions_per_bonus_die: 1,
  max_bonus_dice: 2}`.

### 7.7 Failed hazard ⇒ damage (Table III/VI) + 1D3 lost movement actions

- **Page:** p135 (PDF idx 134). "roll 1D3 for number of lost movement actions."
- **Classification:** **COVERED** (checklist §K7).
- **Implementation:** checklist §K7.
- **Gap / recommendation:** Add `core.chase.hazard_failure: {lost_actions_die: "1D3",
  damage_table_character: "Table III", damage_table_vehicle: "Table VI"}`.

### 7.8 Barriers — block until skill passed or broken

- **Page:** p136 (PDF idx 135).
- **Classification:** **COVERED** (checklist §K8).
- **Implementation:** checklist §K8.

### 7.9 Breaking a barrier — vehicle inflicts 1D10 per Build; failed breakage wrecks vehicle; successful breakage damages vehicle half barrier HP

- **Page:** p137–138 (PDF idx 136–137).
- **Classification:** **COVERED** (checklist §K9).
- **Implementation:** checklist §K9.
- **Gap / recommendation:** Add `core.chase.vehicle_vs_barrier` numeric block.

### 7.10 Chase conflict — attack costs 1 movement action; resolved as combat

- **Page:** p138 (PDF idx 137).
- **Classification:** **COVERED** (checklist §K10).
- **Implementation:** checklist §K10.

### 7.11 Successful fighting maneuver in a chase ⇒ target loses 1D3 movement actions

- **Page:** p138 (PDF idx 137).
- **Classification:** **COVERED** (checklist §K11).
- **Implementation:** checklist §K11.

### 7.12 Vehicle build decrement (every full 10 HP ⇒ −1 Build); impairment at ≤ half starting build ⇒ 1 penalty die

- **Page:** p138, p145 (PDF idx 137, 144).
- **Classification:** **COVERED** (checklist §K12, §K13).
- **Implementation:** checklist §K12, §K13.
- **Gap / recommendation:** Add `core.chase.vehicle_damage` rule-id grouping K12+K13:
  `{build_decrement_per_full_10_hp: 1, impaired_at_build_lte_half_starting: true,
  impairment_penalty_dice: 1}`.

### 7.13 No pushing in a chase

- **Page:** p134 (PDF idx 133). "Pushed rolls are not used in a chase."
- **Classification:** **COVERED.**
- **Implementation:** `core.chase.no_pushed_rolls` (`rule-index.json:204`); `chase.json`
  `pushed_rolls`; `coc_rules.chase_rule()` (`coc_rules.py:110`); checklist §K14.

### Chapter 7 summary

| Rule | Class | Implementation |
|---|---|---|
| 7.1 Speed roll (CON/Drive Auto) | PARTIAL | checklist K1 (no rule-id) |
| 7.2 Escape criterion | COVERED | checklist K2 |
| 7.3 Starting range = 2 | COVERED | checklist K3 |
| 7.4 Movement actions formula | COVERED | `core.chase.movement_actions` |
| 7.5 Open-ground cost 1/loc | COVERED | checklist K5 |
| 7.6 Cautious hazard bonus dice | COVERED | checklist K6 |
| 7.7 Hazard failure 1D3 + dmg | COVERED | checklist K7 |
| 7.8 Barriers block | COVERED | checklist K8 |
| 7.9 Vehicle vs barrier | COVERED | checklist K9 |
| 7.10 Chase conflict = 1 action | COVERED | checklist K10 |
| 7.11 Chase maneuver ⇒ 1D3 lost | COVERED | checklist K11 |
| 7.12 Vehicle build/impairment | COVERED | checklist K12,K13 |
| 7.13 No pushing in chase | COVERED | `core.chase.no_pushed_rolls` |

Counts: covered 12, partial 1, missing 0, N/A 0. The chapter is well-covered by the
checklist; the gap is that 12 of 13 chase rules live only in the checklist and have no
`rule-index.json` entry, so they are invisible to `coc_validate`. **Recommended top
addition:** promote §7.1–7.12 to `core.chase.*` rule-ids (a `chase-procedures.json`
extension or expanded `chase.json`). This is the highest-density "covered-but-not-encoded"
cluster in the audit.


## Chapter 8 — Sanity (printed p152; PDF idx 151)

**Scope (TOC + body, lines ~8430–9390 of the extraction):** SAN rolls & notation (p154); max
SAN (p155); temporary insanity (5+ loss ⇒ INT roll, 1D10-hour duration) (p155); indefinite
insanity (1/5 current SAN in a day) (p156); bout of madness (real-time 1D10 rounds / summary)
+ Table VII / Table VIII (p156–158); underlying insanity & fragility (p158); sample phobias
(p160) and manias (p161); treatment & recovery (Psychoanalysis, asylum, Self-Help, key
connection) (p164–167); getting used to the awfulness (per-creature cap, Mythos-Hardened
halving) (p169). Heavily covered by checklist §F1–F11 and §G1–G14.

### 8.1 SAN roll target = current Sanity; success/failure loss; X/Y notation

- **Page:** p154 (PDF idx 153).
- **Classification:** **COVERED.**
- **Implementation:** `core.sanity.loss` (`rule-index.json:157`); `sanity.json`; checklist
  §F1, §F4.

### 8.2 No bonus/penalty dice on SAN rolls (Self-Help exception); no Luck on SAN rolls

- **Page:** p154 (PDF idx 153).
- **Classification:** **COVERED.**
- **Implementation:** checklist §F2, §F3.

### 8.3 Failed SAN roll ⇒ always SAN loss + one involuntary action; fumble ⇒ max loss

- **Page:** p154 (PDF idx 153).
- **Classification:** **COVERED.**
- **Implementation:** `core.sanity.failure_involuntary_action` (`rule-index.json:166`);
  `sanity.json` `failed_san_roll_involuntary_action` (5 action kinds); checklist §F5, §F6,
  §F7.

### 8.4 SAN loss is per encounter, not per creature

- **Page:** p154 (PDF idx 153). "the sanity effect is for the encounter rather than each
  ghoul seen."
- **Classification:** **COVERED.**
- **Implementation:** checklist §F8.

### 8.5 Max SAN = 99 − Cthulhu Mythos; CM gain lowers max SAN

- **Page:** p155 (PDF idx 154). "Maximum Sanity points equal 99 minus current Cthulhu Mythos
  points (99–Cthulhu Mythos skill)." "When gaining Cthulhu Mythos skill points, the player
  should decrease the investigator's maximum Sanity by the same amount."
- **Classification:** **PARTIAL.** Captured precisely in checklist §F9, §F10 but has **no
  standalone rule-id** and is not encoded as a numeric in `sanity.json`.
- **Implementation:** checklist §F9, §F10.
- **Gap / recommendation:** Add `core.sanity.maximum` rule-id:
  `{maximum_formula: "99 - cthulhu_mythos", cm_gain_lowers_max_by_same_amount: true,
  current_sanity_cannot_exceed_maximum: true}`. Small, safe JSON addition to `sanity.json`.

### 8.6 SAN = 0 ⇒ permanently insane, no longer a PC

- **Page:** p154 (PDF idx 153); p156 permanent insanity.
- **Classification:** **COVERED** (checklist §F11).
- **Implementation:** checklist §F11.
- **Gap / recommendation:** Fold into `core.sanity.maximum` or add
  `core.sanity.permanent_insanity: {at_current_sanity_zero: true, retire_investigator: true}`.

### 8.7 Temporary insanity: 5+ SAN from one source ⇒ INT roll; success ⇒ temp (1D10 hrs); failure ⇒ repressed

- **Page:** p155 (PDF idx 154).
- **Classification:** **COVERED.**
- **Implementation:** `core.sanity.temporary_insanity_threshold` (`rule-index.json:176`);
  `sanity.json` `temporary_insanity_loss_threshold: 5`; checklist §G1, §G2, §G3.

### 8.8 Indefinite insanity: ≥ 1/5 current SAN in one day

- **Page:** p156 (PDF idx 155).
- **Classification:** **COVERED.**
- **Implementation:** `sanity.json` `indefinite_insanity_daily_fraction`; checklist §G4.

### 8.9 Bout of madness — real-time 1D10 rounds (Table VII); summary (Table VIII, 1D10 hours)

- **Page:** p156–158 (PDF idx 155–157). "the bout of madness lasts 1D10 combat rounds (real
  time) if being played out."
- **Classification:** **PARTIAL.** Duration encoded (`core.sanity.bout_summary`,
  `sanity.json` `bout_duration`) and in checklist §G5, §G6, but **Table VII (real-time) and
  Table VIII (summary) entries are not in any JSON table** — only the summary playtest roll
  value is captured in `module.haunting.corbitt_summary_bout`.
- **Implementation:** `core.sanity.bout_summary` (`rule-index.json:185`); `sanity.json`
  `bout_duration`; checklist §G5, §G6.
- **Gap / recommendation:** Add `bout-tables.json` with two arrays (1–10 each) for Table VII
  (real-time) and Table VIII (summary), and a rule-id `core.sanity.bout_tables`. This is the
  most-cited sanity table gap.

### 8.10 Bout SAN immunity; fragility (any further SAN loss in underlying insanity ⇒ new bout)

- **Page:** p156, p158–159 (PDF idx 155, 157–158).
- **Classification:** **COVERED** (checklist §G7, §G8).
- **Implementation:** checklist §G7, §G8.
- **Gap / recommendation:** Add `core.sanity.bout_immunity` and
  `core.sanity.underlying_fragility` rule-ids.

### 8.11 Phobias and manias (sample tables p160–161)

- **Rule:** A bout/insanity may add a phobia or mania; sample tables on p160 (phobias) and
  p161 (manias).
- **Page:** p160–161 (PDF idx 159–160).
- **Classification:** **MISSING.** No `phobias.json` / `manias.json`.
- **Implementation:** None.
- **Gap / recommendation:** Add two small tables (`phobias.json`, `manias.json`) keyed by
  name with a trigger description; add rule-ids `core.sanity.phobias`,
  `core.sanity.manias`.

### 8.12 Treatment & recovery — Psychoanalysis, asylum, Self-Help

- **Rule:** Psychoanalysis (1 session/day, cures temporary insanity, can grant Sanity);
  asylum (1D6 months, regains 1D20 SAN if therapeutically treated, loses 1D6 if not);
  Self-Help (success +1D6 SAN, failure −1 SAN; key connection grants a bonus die and can cure
  indefinite insanity).
- **Page:** p164–169 (PDF idx 163–168).
- **Classification:** **PARTIAL.** Self-Help captured in checklist §G12; Psychoanalysis and
  asylum rules are in prose only; none have rule-ids.
- **Implementation:** checklist §G12 (Self-Help only).
- **Gap / recommendation:** Add `core.sanity.recovery` rule-id with sub-objects for
  `psychoanalysis`, `asylum` (`{duration_months_die: "1D6", sanity_if_treated_die: "1D20",
  sanity_if_not_treated_loss: "1D6"}`), and `self_help` (already in §G12).

### 8.13 Getting used to the awfulness — per-creature SAN-loss cap (reduces by 1 per dev phase)

- **Page:** p169 (PDF idx 168).
- **Classification:** **COVERED** (checklist §G11).
- **Implementation:** checklist §G11.
- **Gap / recommendation:** Add `core.sanity.per_creature_cap` rule-id:
  `{cap_equals_max_loss_for_creature: true, reduces_by_1_per_investigator_development_phase: true}`.

### 8.14 Mythos-Hardened — CM > SAN ⇒ all SAN loss halved (permanent)

- **Page:** p169 (PDF idx 168).
- **Classification:** **COVERED** (checklist §G10).
- **Implementation:** checklist §G10.
- **Gap / recommendation:** Add `core.sanity.mythos_hardened` rule-id:
  `{triggers_if: "cthulhu_mythos > san_current", san_loss_multiplier: 0.5,
  rounding: "round_down", permanent: true}`.

### 8.15 First-homicide SAN cost 0/1D6

- **Page:** p197 (PDF idx 196) (cross-referenced from Ch.10).
- **Classification:** **COVERED** (checklist §G14).
- **Implementation:** checklist §G14.

### Chapter 8 summary

| Rule | Class | Implementation |
|---|---|---|
| 8.1 SAN roll target + X/Y notation | COVERED | `core.sanity.loss` |
| 8.2 No BP dice / no Luck on SAN | COVERED | checklist F2,F3 |
| 8.3 Failed ⇒ loss + involuntary; fumble max | COVERED | `core.sanity.failure_involuntary_action` |
| 8.4 Per-encounter loss | COVERED | checklist F8 |
| 8.5 Max SAN = 99 − CM | PARTIAL | checklist F9,F10 (no rule-id) |
| 8.6 SAN 0 ⇒ permanent | COVERED | checklist F11 |
| 8.7 Temp insanity 5+ / INT / 1D10 hrs | COVERED | `core.sanity.temporary_insanity_threshold` |
| 8.8 Indefinite 1/5 per day | COVERED | `sanity.json` |
| 8.9 Bout tables VII/VIII | PARTIAL | durations encoded; tables MISSING |
| 8.10 Bout immunity / fragility | COVERED | checklist G7,G8 |
| 8.11 Phobias/manias tables | MISSING | (none) — add phobias/manias JSON |
| 8.12 Treatment (Psychoanalysis/asylum/Self-Help) | PARTIAL | checklist G12 (Self-Help only) |
| 8.13 Per-creature SAN cap | COVERED | checklist G11 |
| 8.14 Mythos-Hardened halving | COVERED | checklist G10 |
| 8.15 First-kill 0/1D6 | COVERED | checklist G14 |

Counts: covered 11, partial 3, missing 1, N/A 0. **Recommended top additions for Chapter 8:**
(1) `core.sanity.maximum` (§8.5); (2) `bout-tables.json` + `core.sanity.bout_tables`
(§8.9); (3) `phobias.json` + `manias.json` (§8.11); (4) `core.sanity.recovery` (§8.12).


## Chapter 9 — Magic (printed p170; PDF idx 169)

**Scope (TOC + body, lines ~9395–10000 of the extraction):** What is Magic (p172); Mythos
Tomes intro (p173); Reading Mythos Books (p173); Using Magic — Magic Points, MP regeneration,
HP-when-MP-zero (p176); Learning a Spell (from book / person / Mythos entity) (p176);
Becoming a Believer (p179); How Sorcerers Get That Way — POW gain (p179); Casting Spells —
costs, casting roll, pushed casting (p177–178). The full spell list and per-spell text live in
Chapter 12; the full tome list in Chapter 11.

**This is the largest mechanics chapter with the least coverage.** Spell-casting,
spell-learning, MP economy, and becoming-a-believer are all effectively MISSING from the
implementation (only a generic `_resolve_cast` hook exists in `coc_combat.py:611`, with no
JSON backing).

### 9.1 Magic Points: pool = floor(POW/5); spend to cast; HP one-for-one when MP = 0

- **Rule:** MP = one-fifth POW. Once MP reaches 0, further expenditure comes off HP one for
  one. Cultists/sorcerers may have larger pools.
- **Page:** p176 (PDF idx 175). "An investigator begins the game with Magic points equal to
  one-fifth of his or her POW"; "Once an individual is out of Magic points, any further
  expenditure is deducted directly from hit points."
- **Classification:** **PARTIAL.** MP pool derivation is COVERED (`derived-attributes.json`
  `magic_points`), but the "HP one-for-one after MP=0" rule and the larger-pool exception are
  MISSING.
- **Implementation:** `derived-attributes.json` magic_points; `coc_character.derive_values`.
- **Gap / recommendation:** Add `core.magic.magic_points` rule-id:
  `{pool_formula: "floor(POW/5)", after_zero_costs_hp_one_for_one: true,
  cultists_may_exceed_pool: true}`. Backed by a new `magic.json`.

### 9.2 Magic Point regeneration

- **Rule:** MP regenerates 1/hour; 2/hour if POW > 100; 3/hour if POW > 200; cannot regen
  above floor(POW/5).
- **Page:** p176 (PDF idx 175). "returning at one Magic point per hour (two Magic points per
  hour for those with POW over 100, three Magic points per hour if POW is over 200 and so
  on)"; "cannot regenerate to a value above one-fifth of the character's POW."
- **Classification:** **MISSING.**
- **Implementation:** None.
- **Gap / recommendation:** Add to `magic.json`:
  `regeneration: {per_hour: 1, pow_over_100_per_hour: 2, pow_over_200_per_hour: 3,
  cap: "floor(POW/5)"}`.

### 9.3 Casting a Mythos spell costs SAN and MP (amounts per spell)

- **Rule:** Casting a Mythos spell costs SAN and MP (per the spell description); learning is
  free. Encountering anything summoned costs yet more SAN. SAN = 0 does not prevent casting.
- **Page:** p176, p177 (PDF idx 175, 176). "Learning a Mythos spell does not cost Sanity
  points; however, casting a Mythos spell does"; "Having no Sanity points does not prohibit
  spells from being cast."
- **Classification:** **MISSING.**
- **Implementation:** None (no per-spell cost data; only the `module.haunting.*` MP/SAN
  entries for Corbitt's spells).
- **Gap / recommendation:** Add `core.magic.casting_cost` rule-id
  `{san_cost_per_spell: true, mp_cost_per_spell: true, learning_cost: 0,
  zero_san_does_not_block_casting: true}` and fold per-spell costs into the Chapter 12
  `spells.json` (recommended there).

### 9.4 Casting roll = Hard POW, first time only; can be pushed

- **Rule:** The first time a character casts a learned spell, roll Hard POW. Success ⇒ spell
  works; failure ⇒ nothing happens, may push (paying costs again). A pushed-casting failure
  still works but with dire consequences. Subsequent castings need no roll. NPCs/monsters
  never roll.
- **Page:** p177–178 (PDF idx 176–177). "A Hard POW roll is required to successfully cast a
  spell the first time"; "If the pushed casting roll is failed, the spell still works
  normally, but dire consequences ensue for the caster."
- **Classification:** **MISSING.**
- **Implementation:** None (`coc_combat._resolve_cast` is a no-op hook).
- **Gap / recommendation:** Add `core.magic.casting_roll` rule-id:
  `{required: "first_casting_only", roll: "Hard POW", pushed: {allowed: true,
  pays_cost_again: true, pushed_failure: "spell_works_with_dire_consequences"},
  npcs_and_monsters_skip_roll: true}`.

### 9.5 Learning a spell — Hard INT roll (2D6 weeks from book / 1D8 days from teacher); can push

- **Rule:** Learning from a Mythos book requires an initial reading, then a Hard INT roll
  (typically 2D6 weeks). Learning from a person takes 1D8 days. Failed INT roll can be
  pushed. Granted by a Mythos entity may also require an INT roll to retain.
- **Page:** p176 (PDF idx 175). "the player should attempt a Hard INT roll to learn the
  spell"; "typically 2D6 weeks"; "1D8 days."
- **Classification:** **MISSING.**
- **Implementation:** None.
- **Gap / recommendation:** Add `core.magic.learning` rule-id:
  `{from_book: {requires_initial_reading: true, roll: "Hard INT", typical_weeks_die: "2D6",
  can_push: true}, from_person: {days_die: "1D8"}, from_entity: {retain_roll: "INT",
  minimum_san_loss_die: "1D6"}}`.

### 9.6 Becoming a Believer — losing SAN = current CM score

- **Rule:** A nonbeliever may accrue CM skill (with max-SAN reduction) without losing SAN, but
  the first firsthand Mythos encounter that costs SAN makes them a believer and they
  immediately lose SAN equal to their current CM score. A player may choose to believe at any
  time.
- **Page:** p179 (PDF idx 178). "At that point the investigator becomes a believer and
  immediately loses Sanity points equal to his or her present Cthulhu Mythos score."
- **Classification:** **MISSING.**
- **Implementation:** None.
- **Gap / recommendation:** Add `core.magic.becoming_a_believer` rule-id:
  `{trigger: "first_san_cost_from_firsthand_mythos_encounter", san_loss: "current_CM_score",
  voluntary_allowed: true, nonbeliever_still_gains_CM_and_reduces_max_san: true}`.

### 9.7 How Sorcerers Get That Way — POW gain

- **Rule:** When a caster wins an opposed POW roll to affect a target, they may roll 1D100;
  if > their POW (or ≥ 96), POW increases by 1D10 permanently. Also, on any Luck roll of 01,
  a POW exercise roll may be made (1D100 > POW or ≥ 96 ⇒ +1D10 POW).
- **Page:** p179 (PDF idx 178).
- **Classification:** **MISSING.**
- **Implementation:** None.
- **Gap / recommendation:** Add `core.magic.pow_gain` rule-id:
  `{trigger_opposed_pow_win: {roll: "1D100", increases_if: "roll > POW or roll >= 96",
  amount_die: "1D10"}, trigger_luck_01: {same_roll_and_amount: true}}`.

### 9.8 Casting time and components (per spell)

- **Rule:** Casting time varies (instantaneous to weeks); physical components may be required
  (reusable or consumed). Per-spell data lives in Chapter 12.
- **Page:** p177 (PDF idx 176).
- **Classification:** **N/A here** (per-spell; audited under Chapter 12).

### Chapter 9 summary

| Rule | Class | Implementation |
|---|---|---|
| 9.1 MP pool + HP-after-zero | PARTIAL | `derived-attributes.json` magic_points (pool only) |
| 9.2 MP regeneration | MISSING | (none) — add to `magic.json` |
| 9.3 Casting costs SAN+MP | MISSING | (none) — add `core.magic.casting_cost` |
| 9.4 Casting roll (Hard POW, push) | MISSING | (none) — add `core.magic.casting_roll` |
| 9.5 Learning a spell (Hard INT) | MISSING | (none) — add `core.magic.learning` |
| 9.6 Becoming a Believer | MISSING | (none) — add `core.magic.becoming_a_believer` |
| 9.7 Sorcerer POW gain | MISSING | (none) — add `core.magic.pow_gain` |
| 9.8 Casting time/components | N/A | (per-spell; Ch.12) |

Counts: covered 0, partial 1, missing 6, N/A 1. **Chapter 9 is the largest under-covered
mechanics chapter.** Recommended top addition: a `magic.json` table + the seven
`core.magic.*` rule-ids above. This is a high-value, self-contained addition that would
unlock spell-casting validation.


## Chapter 10 — Playing the Game (printed p182; PDF idx 181)

**Scope (TOC + body, lines ~10139–12100 of the extraction):** New Keepers (p184); Non-Player
Characters (p189); Rolling Dice (p194); The Idea Roll (p199); Perception Rolls (p201); Using
the Rules (p204); Presenting the Terrors of the Mythos (p207); Creating Scenarios (p213);
Pacing the Game. This is primarily **Keeper-craft advice** — pacing, atmosphere, NPC play,
clue design, scenario structure. The machine-checkable content is thin: the Idea roll,
Perception roll, the Know roll, the first-kill SAN rule (cross-ref Ch.8), and a couple of
NPC-mechanics notes.

### 10.1 The Idea Roll (mechanics)

- **Rule:** An Idea roll is a roll vs INT (same as an INT roll) used to get unstuck; the
  difficulty is set by how much the clue has been signposted (Regular if never mentioned →
  give the clue for free; Extreme if obvious but missed). On a win, deliver the clue without
  increasing danger; on a loss, place investigators "in the thick of it."
- **Page:** p199–200 (PDF idx 198–199). Cross-defined with p90 (Ch.5).
- **Classification:** **MISSING** (same gap as §5.16; no rule-id).
- **Implementation:** None.
- **Gap / recommendation:** Add `core.resolution.idea_roll` (already recommended in §5.16)
  with the win/lose outcomes:
  `{target_characteristic: "INT", win: "deliver_clue_without_increasing_danger",
  lose: "place_in_the_thick_of_it", difficulty_if_unmentioned: "Regular (give_for_free)",
  difficulty_if_obvious_missed: "Extreme"}`.

### 10.2 The Perception Roll (obscured clues; combined roll using higher skill)

- **Rule:** A perception roll uses Spot Hidden, Psychology, Listen, or a combination; if more
  than one skill is applicable, make one roll using the higher of the two skills (a combined
  roll). The clue goes to the investigator with the highest success level meeting the
  difficulty. Pushed perception failures can cost time/danger.
- **Page:** p201–203 (PDF idx 200–202).
- **Classification:** **PARTIAL.** The "combined roll using the higher skill" mechanic is a
  special case of `core.combined_roll` (one roll vs N targets, success if ≤ any), but the
  "use the higher of two skills" rule and the per-investigator clue-allocation rule are not
  encoded.
- **Implementation:** `core.combined_roll` (`rule-index.json:115`); `coc_rules.combined_roll_rule()`.
- **Gap / recommendation:** Add `core.resolution.perception_roll` rule-id:
  `{skills: ["Spot Hidden","Psychology","Listen"], combined_uses_higher_skill: true,
  clue_goes_to: "highest_success_meeting_difficulty", tie: "perceived_simultaneously_or_highest_skill"}`.

### 10.3 The Know Roll

- **Rule:** Roll vs EDU to recall stored knowledge.
- **Page:** p90 (PDF idx 89) (defined in Ch.5; referenced throughout Ch.10).
- **Classification:** **MISSING** (same gap as §5.16).
- **Implementation:** None.
- **Gap / recommendation:** Add `core.resolution.know_roll: {target_characteristic: "EDU"}`
  (already recommended in §5.16).

### 10.4 First-homicide SAN roll (0/1D6)

- **Rule:** When an investigator first kills a person, the Keeper may call for a SAN roll
  (0/1D6).
- **Page:** p197 (PDF idx 196).
- **Classification:** **COVERED** (checklist §G14).
- **Implementation:** checklist §G14.

### 10.5 NPC Luck pool (villain escape mechanic)

- **Rule:** An arch-villain may be given a Luck pool to spend on rolls (mirroring player
  Luck), increasing their effectiveness without scripting the outcome.
- **Page:** p200 (PDF idx 199).
- **Classification:** **N/A** (advice; the underlying Luck-spend rule is §5.13). No new
  machine rule.

### 10.6 NPC reactions / DEX-only NPCs / characteristic-less NPCs

- **Rule:** Minor NPCs may be defined by a single relevant skill or characteristic; only
  combat-relevant NPCs need full stats.
- **Page:** p189 (PDF idx 188).
- **Classification:** **N/A** (design guidance).

### 10.7 Presenting terrors / pacing / creating scenarios / hooks / clues as data

- **Rule:** Scenarios consist of hooks, clues, NPCs, locations, and a climactic encounter;
  pacing should build tension. (Structure, not arithmetic.)
- **Page:** p207, p213 (PDF idx 206, 212).
- **Classification:** **PARTIAL** (structural, not numeric). The `coc-scenario-import` skill
  and `coc_scenario.create_scenario_skeleton()` build a scenario skeleton from a PDF, and the
  `coc-keeper-play` skill describes hook/clue structure, but there is no structured
  hooks/clues JSON schema.
- **Implementation:** `coc_scenario.create_scenario_skeleton()` (`coc_scenario.py:45`);
  skills `coc-scenario-import`, `coc-keeper-play`.
- **Gap / recommendation:** Add a `scenario-schema.json` describing `hooks`, `clues`
  (with `obscured`/`obvious` and `difficulty`), `npcs`, `locations`, `climax` fields, and a
  rule-id `core.scenario.structure`. (Larger; recorded as a recommendation.)

### Chapter 10 summary

| Rule | Class | Implementation |
|---|---|---|
| 10.1 Idea roll | MISSING | (none) — add `core.resolution.idea_roll` |
| 10.2 Perception roll (combined/higher skill) | PARTIAL | `core.combined_roll` (partial) |
| 10.3 Know roll | MISSING | (none) — add `core.resolution.know_roll` |
| 10.4 First-kill SAN 0/1D6 | COVERED | checklist G14 |
| 10.5 NPC Luck pool | N/A | (advice; uses §5.13) |
| 10.6 NPC statting | N/A | (design guidance) |
| 10.7 Scenario structure (hooks/clues) | PARTIAL | `coc_scenario.create_scenario_skeleton` |

Counts: covered 1, partial 2, missing 2, N/A 2. **Chapter 10 is mostly Keeper-craft (N/A for
machine rules).** Recommended top additions: the three `core.resolution.*` rule-ids
(Idea/Know/Perception, shared with §5.16) and a `scenario-schema.json`.


## Chapter 11 — Tomes of Eldritch Lore (printed p222; PDF idx 221)

**Scope (TOC + body):** "Using Mythos Tomes" (p224), tome-reading mechanics (initial reading,
full study, language roll, research) (p173–175 cross-ref), the Necronomicon (p231), and the
**Mythos Tomes** entries (p237–239) with the per-tome stat block: Sanity Loss, Cthulhu Mythos
(CMI/CMF), Mythos Rating, Study (weeks), Suggested Spells, Language/Author/Date.

### 11.1 Tome-reading mechanics — initial reading

- **Rule:** An initial reading requires an appropriate Language skill roll (1D100) at a
  Keeper-set difficulty (Regular/Hard/Extreme by age and condition). On success, the reader
  gains the CMI Cthulhu Mythos points and **automatically** loses the tome's Sanity cost (no
  SAN roll). Nonbelievers do not take this Sanity loss. A failed Language roll grants nothing
  but may be pushed (with possible SAN-loss consequences).
- **Page:** p173–174 (PDF idx 172–173). "Once the investigator has made an initial reading,
  the Keeper should reward them with the initial reading (CMI) number. The reader now
  automatically loses the Sanity cost of the tome (no Sanity roll is made)—non-believers do
  not take this Sanity loss."
- **Classification:** **MISSING.**
- **Implementation:** None.
- **Gap / recommendation:** Add `core.tomes.initial_reading` rule-id:
  `{language_roll: "appropriate Language skill", difficulty_by_age_and_condition: true,
  success_grants_cmi: true, sanity_loss_automatic_no_roll: true,
  nonbelievers_skip_sanity_loss: true, failed_can_push: true}`.

### 11.2 Full study

- **Rule:** A full study takes the tome's "Study" weeks (no reading roll required); at the
  end the reader loses the full-study Sanity cost (rolled) and, if current CM < tome's Mythos
  Rating, gains the CMF Cthulhu Mythos points. Each subsequent study of the same tome takes
  twice as long as the previous.
- **Page:** p174 (PDF idx 173).
- **Classification:** **MISSING.**
- **Implementation:** None.
- **Gap / recommendation:** Add `core.tomes.full_study` rule-id:
  `{duration: "tome.study_weeks", reading_roll_required: false,
  sanity_loss_rolled: true, grants_cmf_if_cm_below_mythos_rating: true,
  subsequent_study_time_multiplier: 2}`.

### 11.3 Researching a fact in a tome

- **Rule:** Spending 1D4 game hours researching, roll 1D100 ≤ the tome's Cthulhu Mythos
  Rating ⇒ find the fact.
- **Page:** p175 (PDF idx 174).
- **Classification:** **MISSING.**
- **Implementation:** None.
- **Gap / recommendation:** Add `core.tomes.research` rule-id:
  `{time_hours_die: "1D4", success_if_roll_lte_mythos_rating: true}`.

### 11.4 Mythos Tomes table (per-tome stat block)

- **Rule:** Each tome has: Sanity Loss, Cthulhu Mythos (CMI/CMF), Mythos Rating, Study
  (weeks), Suggested Spells, Language/Author/Date. Examples: Necronomicon (Al Azif, Arabic)
  SAN 2D10, CM +6/+12, Rating 54, 68 weeks; Cultes des Goules SAN 1D10, CM +4/+8, Rating 36,
  22 weeks; Book of Eibon SAN 2D4, CM +3/+8, Rating 33, 32 weeks; Unaussprechlichen Kulten
  SAN 2D8, CM +5/+10, Rating 45, 52 weeks.
- **Page:** p225–239 (PDF idx 224–238).
- **Classification:** **MISSING.** No `tomes.json` table.
- **Implementation:** None.
- **Gap / recommendation:** Add `tomes.json` keyed by tome name with the six fields above;
  add rule-id `core.tomes.table`. (The Haunting module references Corbitt's tome indirectly
  but no general tome table exists.)

### Chapter 11 summary

| Rule | Class | Implementation |
|---|---|---|
| 11.1 Initial reading (Language roll, auto SAN, CMI) | MISSING | (none) |
| 11.2 Full study (weeks, SAN roll, CMF, ×2 repeat) | MISSING | (none) |
| 11.3 Research a fact (1D4 hrs, ≤ Mythos Rating) | MISSING | (none) |
| 11.4 Mythos Tomes table (stat blocks) | MISSING | (none) — add `tomes.json` |

Counts: covered 0, partial 0, missing 4, N/A 0. **Chapter 11 is entirely uncovered.**
Recommended: a `tomes.json` table + the three `core.tomes.*` procedure rule-ids. (Note: the
older "+1D6 weeks per failed reading roll" rule does NOT appear in 7e — it has been replaced
by the push-the-roll mechanic; do not encode it.)


## Chapter 12 — Grimoire (printed p240; PDF idx 239)

**Scope:** Spell disambiguation (Call/Contact/Summon/Dismiss/Bind) (p245), the Grimoire spell
descriptions (p245–265), and "Deeper Magic" notes. Each spell entry has a **Name**, a
**Cost:** line (MP and/or SAN; sometimes variable or "POW"), a **Casting time:** line, and a
prose effect; many close with "Alternative names:". There is no rigid field grid — SAN/MP
values are inline.

### 12.1 Spell entry schema (Cost, Casting time, effect)

- **Rule:** Every spell has a Cost (typically MP + SAN; some cost POW; some variable) and a
  Casting time. Example — Flesh Ward: "Cost: variable magic points; 1D4 Sanity points";
  "Casting time: 5 rounds." Each magic point spent grants 1D6 armor vs non-magical attacks.
- **Page:** p259 (PDF idx 258) Flesh Ward; p245 schema.
- **Classification:** **MISSING.** No `spells.json`; no spell schema.
- **Implementation:** None. (`module.haunting.corbitt_flesh_ward` records playtest-specific
  MP/armor data but not the general spell schema.)
- **Gap / recommendation:** Add `spells.json` keyed by spell name with `cost_mp`, `cost_san`,
  `cost_pow`, `casting_time`, `range`, `duration`, `effect_summary`, `alternative_names`,
  and `class` (Call/Contact/Summon/Dismiss/Bind/Enchantment/other). Add rule-id
  `core.magic.spell_schema`.

### 12.2 Call / Dismiss / Contact / Summon / Bind disambiguation

- **Rule:** Call = physical manifestation of a god (cost 1+ MP/person + 1D10 SAN, caster
  only; group chanting: 1 MP = 1% chance, 1 min per MP, cap 100 min, 100 always fails);
  Dismiss = send it back (1+ MP/person; 1 min + 1 rd per donating participant; allot 1 MP per
  25 POW of deity = 5% base, +5% per extra MP; **no SAN cost**); Contact = "esoteric
  telephone call"; Summon/Bind = compel a monster to appear and control it.
- **Page:** p245, p248–249 (PDF idx 244, 247–248).
- **Classification:** **MISSING.**
- **Implementation:** None.
- **Gap / recommendation:** Add `core.magic.spell_classes` rule-id grouping these five
  classes with their cost/time/chance mechanics. Fold per-deity variants into `spells.json`.

### 12.3 Sample spells (Flesh Ward, Dominate, Shrivelling, Elder Sign, etc.)

- **Rule:** ~50+ named spells plus the per-entity variant families.
- **Page:** p245–265.
- **Classification:** **MISSING.**
- **Implementation:** None.
- **Gap / recommendation:** Populate `spells.json` with at least the spells referenced by
  existing modules (Flesh Ward, Dominate, Enchant Knife/Dagger, Wither Limb, Resurrection,
  Contact Ghoul, Elder Sign, Powder of Ibn-Ghazi, Voorish Sign, Shrivelling) plus the
  Call/Dismiss/Contact/Summon families.

### Chapter 12 summary

| Rule | Class | Implementation |
|---|---|---|
| 12.1 Spell schema (Cost/Casting time/effect) | MISSING | (none) — add `spells.json` |
| 12.2 Call/Dismiss/Contact/Summon/Bind classes | MISSING | (none) — add `core.magic.spell_classes` |
| 12.3 Sample spells (~50+) | MISSING | (none) — populate `spells.json` |

Counts: covered 0, partial 0, missing 3, N/A 0. **Chapter 12 is entirely uncovered.** This is
the largest single reference-data gap. Recommended: `spells.json` + `core.magic.spell_schema`
+ `core.magic.spell_classes`.


## Chapter 13 — Artifacts and Alien Devices (printed p266; PDF idx 265)

**Scope:** ~20 artifacts and alien devices (Elder Sign/Star Stones, Mi-Go brain cylinder,
Shining Trapezohedron, Electric Gun, etc.). Each entry has a "Used by:" line and prose
effects; effects (SAN/MP) are inline, not a fixed grid.

### 13.1 Artifact entry schema and sample artifacts

- **Rule:** Each artifact has a "Used by:" attribution and a prose effect; some specify SAN
  loss, MP/POW cost, or mechanical effects. Examples:
  - **Mi-Go Brain Cylinder** (p269): each month enclosed, the brain rolls ≤ INT; on success
    it remembers its confinement and loses 1D3 SAN.
  - **Shining Trapezohedron** (p273–274): looking into it grants visions; closing the box in
    total darkness summons the Haunter of the Dark (an avatar of Nyarlathotep).
  - **Elder Sign** (p255, as spell/enchantment): costs 10 POW, 1 hour to cast, no SAN; wards
    an opening/Gate against Mythos minions and gods. **Star Stones of Mnar** (p274) are
    physical carved talismans that ward the bearer against minions (not the gods).
  - **Electric Gun** (p270): Mi-Go weapon, 1D10 damage + taser-immobilize (CON roll or
    unconscious 1D6 rounds; fumble ⇒ cardiac arrest); humans need Hard Electrical Repair to
    jury-rig, then fires only on 1D6 = 1–2.
- **Page:** p255, p269–274.
- **Classification:** **MISSING.** No `artifacts.json`.
- **Implementation:** None.
- **Gap / recommendation:** Add `artifacts.json` keyed by artifact name with `used_by`,
  `san_cost`, `mp_cost`/`pow_cost`, `mechanical_effect`, `notes`. Add rule-id
  `core.artifacts.table`.

### Chapter 13 summary

| Rule | Class | Implementation |
|---|---|---|
| 13.1 Artifacts table + schema | MISSING | (none) — add `artifacts.json` |

Counts: covered 0, partial 0, missing 1, N/A 0. **Chapter 13 is uncovered.** Recommended:
`artifacts.json` + `core.artifacts.table`.

## Chapter 14 — Monsters, Beasts, and Alien Gods (printed p276; PDF idx 275)

**Scope:** ~60+ monster stat blocks in a uniform format: characteristics (STR/CON/SIZ/DEX/INT/
POW with averages and rolls), HP, DB, Build, MP, MOV, ATTACKS (per round, Fighting % with
 Regular/Hard/Extreme, damage, maneuvers, Dodge %), Armor, Skills, Spells, **Sanity Loss**
(the X/Y notation), and Special Powers/notes. Plus deity write-ups (Cthulhu, Azathoth, etc.)
and traditional horrors/beasts.

### 14.1 Monster stat-block format

- **Rule:** Every monster entry has a fixed stat block; the **Sanity Loss** field uses the
  `X/Y` notation consumed by `core.sanity.loss`.
- **Page:** format established p278–279; examples throughout p288–343.
- **Classification:** **PARTIAL.** The SAN-loss `X/Y` notation is COVERED (`core.sanity.loss`),
  but the monster stat blocks themselves are MISSING.
- **Implementation:** `core.sanity.loss` consumes the notation; no monster table.
- **Gap / recommendation:** Add `monsters.json` keyed by monster name with `characteristics`,
  `hp`, `db`, `build`, `mp`, `mov`, `attacks` (list with `%`, `damage`, `impales`,
  `maneuver`), `armor`, `skills`, `spells`, `sanity_loss` (e.g. "0/1D6"), `special_powers`.
  Add rule-id `core.monsters.stat_block`.

### 14.2 Example SAN-loss values (verify X/Y notation coverage)

- **Rule:** Deep One 0/1D6 (p288); Ghoul 0/1D6 (p294); Cthulhu 1D10/1D100 (p316).
- **Classification:** **COVERED** (the notation itself); **MISSING** (the per-monster data).
- **Implementation:** `core.sanity.loss`; checklist §F4, §F8.
- **Gap / recommendation:** Same `monsters.json` table.

### 14.3 Special monster rules — regeneration, half-damage-from-firearms, deities immune to outnumbering

- **Rule:** Some monsters regenerate (Cthulhu regenerates 6 HP/round, reforms in 1D10+10
  minutes at 0 HP); some take half damage from firearms/projectiles (Ghoul); some Mythos
  entities can never be outnumbered by investigators.
- **Page:** p316 (Cthulhu); p294 (Ghoul); p108 cross-ref (outnumbered).
- **Classification:** **MISSING** (no per-monster special-rules data).
- **Implementation:** checklist §H9 notes the "some entities can never be outnumbered" caveat.
- **Gap / recommendation:** Capture in `monsters.json` `special_powers` field.

### Chapter 14 summary

| Rule | Class | Implementation |
|---|---|---|
| 14.1 Monster stat-block format | PARTIAL | SAN notation covered; stat blocks MISSING |
| 14.2 Per-monster SAN-loss values | PARTIAL | notation covered; data MISSING |
| 14.3 Special monster rules | MISSING | (none) |

Counts: covered 0, partial 2, missing 1, N/A 0. **Chapter 14 data is uncovered**, though the
SAN-loss mechanic it depends on is covered. Recommended: `monsters.json` +
`core.monsters.stat_block` — this is the highest-value reference-data addition because it
unlocks per-creature SAN capping (§8.13) and encounter SAN automation.

## Chapter 15 — Scenarios (printed p344; PDF idx 343)

**Scope:** Two full scenarios — "Amidst the Ancient Trees" (p346) and "Crimson Letters"
(p364) — each with: setting intro, Background, Recent Events, Dramatis Personae (NPCs with
stats and roleplaying notes), Timeline, Investigator Motivations (hooks), location/clue
scenes, and Conclusions. (The Haunting, used by the playtest, is a separate starter scenario
referenced throughout the implementation.)

### 15.1 Scenario structure schema

- **Rule:** Each scenario has Background, Recent Events, Dramatis Personae, Timeline,
  Investigator Motivations (hooks), Locations, Clues, Conclusions.
- **Page:** p346 (Trees), p364 (Crimson Letters).
- **Classification:** **PARTIAL.** `coc_scenario.create_scenario_skeleton()` builds a skeleton
  from a PDF, and the `coc-scenario-import`/`coc-keeper-play` skills describe structure, but
  there is no structured hooks/clues/NPCs JSON schema. The Haunting is the only scenario with
  structured rules data (`the-haunting.json`).
- **Implementation:** `coc_scenario.create_scenario_skeleton()` (`coc_scenario.py:45`);
  `the-haunting.json` (8 module rule-ids).
- **Gap / recommendation:** Add `scenario-schema.json` (recommended in §10.7) and structured
  `scenario-<id>.json` files for Amidst the Ancient Trees and Crimson Letters with hooks,
  NPCs (with stats), clues (obscured/obvious + difficulty), locations, and climax. Add
  rule-id `core.scenario.structure`.

### 15.2 The Haunting (starter scenario) — COVERED as module rules

- **Rule:** The Haunting's mechanics (Corbitt's Flesh Ward, floating knife MP, animate body,
  own-dagger destruction, conclusion SAN reward, bed-attack damage, basement-search damage)
  are encoded.
- **Classification:** **COVERED.**
- **Implementation:** `module.haunting.*` (8 rule-ids, `rule-index.json:241+`);
  `the-haunting.json`.

### Chapter 15 summary

| Rule | Class | Implementation |
|---|---|---|
| 15.1 Scenario structure schema | PARTIAL | `coc_scenario.create_scenario_skeleton` |
| 15.2 The Haunting module rules | COVERED | `module.haunting.*` (8 rule-ids) |

Counts: covered 1, partial 1, missing 0, N/A 0. The Haunting is well-covered; the two
rulebook scenarios need structured JSON.


## Chapter 16 — Appendices (printed p384; PDF idx 383)

**Scope:** Appendix I — Glossary of Game Terms (p386); Appendix II — Converting to 7e (p390);
Appendix III — Equipment Lists, 1920s (p396) and Modern Era (p399); Table XVII — Weapons
(p401–405); the index. The machine-checkable content is the equipment price lists and the
Weapons table.

### 16.1 Equipment price lists (1920s and Modern)

- **Rule:** Two price lists (1920s p396–398; Modern p399) grouped by category (Clothing,
  Meals, Lodging, Real Estate, Medical, Outdoor/Travel, Investigator Tools, Vehicles,
  Ammunition, Illegal Weapons) with item + dollar price.
- **Page:** p396–399 (PDF idx 395–398).
- **Classification:** **MISSING.** No `equipment.json`. (The `cash-assets.json` table covers
  Credit Rating → spending level, but not per-item prices.)
- **Implementation:** None.
- **Gap / recommendation:** Add `equipment.json` with `1920s` and `modern` periods, each a
  list of `{item, category, price}`. Add rule-id `core.equipment.price_list`.

### 16.2 Table XVII — Weapons

- **Rule:** Weapon table columns: Name, Skill, Damage, Base Range, Uses per Round, Bullets in
  Gun (Mag), Cost (1920s/Modern), Malfunction, Common in Era. Impaling weapons flagged (i);
  special-rules weapons flagged (\*). Shotgun damage is range-banded (e.g. 12-gauge: 4D6
  point-blank / 2D6 half / 1D6 max). Examples: Medium Knife 1D4+2+DB (Touch, malf –); .38
  Revolver 1D10 (15 yds, 1/3, mag 6, malf 100); 12-gauge Shotgun 4D6/2D6/1D6 (10/20/50 yds);
  .45 Automatic 1D10+2 (15 yds, mag 7, malf 100); Elephant Gun 3D6+4 (100 yds, mag 2).
- **Page:** p401–405 (PDF idx 400–404).
- **Classification:** **MISSING.** No `weapons.json`. This is a significant gap because the
  combat engine (`coc_combat._weapon()`) currently uses an inline unarmed-only default and
  has no per-weapon damage/range/malfunction/mag data.
- **Implementation:** None. (`coc_combat._weapon()` defaults to unarmed 1D3; the
  `module.haunting.bed_attack_damage` records one weapon's damage.)
- **Gap / recommendation:** Add `weapons.json` keyed by weapon name with `skill`,
  `damage_die`, `base_range_yards`, `uses_per_round`, `magazine`, `cost_1920s`,
  `cost_modern`, `malfunction`, `eras`, `impales`, `special`, and (for shotguns)
  `range_banded_damage`. Add rule-id `core.combat.weapons_table`. **This is the single most
  useful missing table for the combat engine** — it would also resolve the §6.16 malfunction
  gap and the §6.15 multi-shot gap.

### 16.3 Glossary (Appendix I)

- **Classification:** **N/A** (reference terms; no machine rule).

### 16.4 Converting to 7e (Appendix II)

- **Rule:** Conversion guidance from prior editions (characteristic ×5, skill rename, etc.).
- **Page:** p390 (PDF idx 389).
- **Classification:** **N/A** (one-time conversion aid; not a live game rule).

### Chapter 16 summary

| Rule | Class | Implementation |
|---|---|---|
| 16.1 Equipment price lists (1920s/Modern) | MISSING | (none) — add `equipment.json` |
| 16.2 Table XVII Weapons | MISSING | (none) — add `weapons.json` |
| 16.3 Glossary | N/A | — |
| 16.4 Converting to 7e | N/A | — |

Counts: covered 0, partial 0, missing 2, N/A 2. **Recommended top additions:**
(1) `weapons.json` + `core.combat.weapons_table` (unlocks combat-engine improvements);
(2) `equipment.json` + `core.equipment.price_list`.


---

# Final Audit Summary

All 16 chapters + Appendices have been swept. Every machine-checkable rule in the
rulebook has been classified COVERED / PARTIAL / MISSING / N/A with a traced implementation
or a concrete recommended addition.

## Per-chapter counts

| Ch | Title | Covered | Partial | Missing | N/A |
|---|---|---|---|---|---|
| 1 | Introduction | 4 | 0 | 0 | 1 |
| 2 | Lovecraft & the Cthulhu Mythos | 0 | 0 | 0 | 2 |
| 3 | Creating Investigators | 8 | 2 | 3 | 0 |
| 4 | Skills | 1 | 2 | 2 | 1 |
| 5 | Game System | 10 | 5 | 1 | 0 |
| 6 | Combat | 17 | 5 | 1 | 0 |
| 7 | Chases | 12 | 1 | 0 | 0 |
| 8 | Sanity | 11 | 3 | 1 | 0 |
| 9 | Magic | 0 | 1 | 6 | 1 |
| 10 | Playing the Game | 1 | 2 | 2 | 2 |
| 11 | Tomes of Eldritch Lore | 0 | 0 | 4 | 0 |
| 12 | Grimoire | 0 | 0 | 3 | 0 |
| 13 | Artifacts and Alien Devices | 0 | 0 | 1 | 0 |
| 14 | Monsters, Beasts, and Alien Gods | 0 | 2 | 1 | 0 |
| 15 | Scenarios | 1 | 1 | 0 | 0 |
| 16 | Appendices | 0 | 0 | 2 | 2 |
| **Total** | | **65** | **24** | **27** | **9** |

**Reading the numbers.** The system's existing strength is the **core resolution engine and
its derived chapters** (Ch.5 Game System 10/16 covered; Ch.6 Combat 17/23 via the
`CombatSession` engine; Ch.7 Chases 12/13; Ch.8 Sanity 11/15) — this reflects the
`checks/coC7_rule_checklist.md` foundation (sections A–L) and the playtest harness it drives.
The largest under-covered regions are the **reference-data chapters** (Ch.11 Tomes, Ch.12
Grimoire, Ch.13 Artifacts, Ch.14 Monsters, Ch.16 Equipment/Weapons) and **Magic** (Ch.9),
none of which have structured JSON tables yet.

## Top recommended next additions (priority order)

1. **`weapons.json` + `core.combat.weapons_table`** (Ch.16 §16.2). Highest single payoff:
   the combat engine's `_weapon()` currently defaults to unarmed only; a weapons table also
   resolves the malfunction gap (§6.16) and the multi-shot/aiming gaps (§6.15). ~25 rows.
2. **`spells.json` + `core.magic.spell_schema` + `core.magic.spell_classes`** (Ch.9 §9.3–9.7,
   Ch.12 §12.1–12.3). The largest under-covered mechanics chapter; unlocks spell-casting
   validation. Include the casting-roll (Hard POW, pushable), learning (Hard INT, 2D6/1D8),
   MP economy (HP-after-zero, regeneration), becoming-a-believer, and POW-gain rules.
3. **`monsters.json` + `core.monsters.stat_block`** (Ch.14 §14.1). Unlocks per-creature
   SAN-loss data and the per-creature SAN cap (§8.13). Include SAN-loss, HP, armor, attacks,
   and special_powers for ~20 signature creatures.
4. **`core.development.*` family + `core.luck.spend`/`core.luck.recovery`** (Ch.5 §5.12–5.14).
   Promotes the well-covered checklist rules E1–E11 and L10–L12 into `rule-index.json` so
   they are visible to `coc_validate`. Backed by a `development.json` and `luck.json`.
5. **`tomes.json` + `core.tomes.*`** (Ch.11 §11.1–11.4). The initial-reading / full-study /
   research mechanics and the per-tome stat block.
6. **`skills.json` + `core.skills.base_chances` + `core.skills.transferable_specialization`**
   (Ch.4 §4.1, §4.4). Lets `validate_character_sheet()` verify allocated points ≥ base.
7. **`characteristic-dice.json` + `occupations.json`** (Ch.3 §3.1, §3.10–3.11) and the
   **Luck-derivation bugfix** in `derived-attributes.json` (Ch.3 §3.2).
8. **`bout-tables.json` (Table VII/VIII) + `phobias.json` + `manias.json`** (Ch.8 §8.9,
   §8.11).
9. **`poisons.json`** (Ch.6 §6.25), **`artifacts.json`** (Ch.13), **`equipment.json`**
   (Ch.16 §16.1) — smaller reference tables.
10. **`core.resolution.idea_roll` / `know_roll` / `perception_roll`** (Ch.5 §5.16, Ch.10
    §10.1–10.3) — three small rule-ids that recur across chapters.

## Small safe additions made during this audit

Three `core.chase.*` rule-ids and `chase.json` entries were added (speed roll, escape
criterion, starting range — Chapter 7 §7.1–7.3). `rule-index.json` now has **35 rule ids**
(was 32). `python3 plugins/coc-keeper/scripts/coc_validate.py rules plugins/coc-keeper` passes
and `pytest tests/test_rules.py tests/test_plugin_metadata.py -q` passes (47 passed). All
larger recommendations above are recorded for follow-up passes; no large refactors were made.

