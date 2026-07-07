# Call of Cthulhu 7e (40th Anniversary, Sandy Petersen) — Rulebook Coverage Audit (2026-07-07)

Re-generated coverage audit of the `coc-keeper` / `coc-keeper-zcode` plugins
against the authoritative Keeper Rulebook PDF (`pdf/Call Of Cthulhu Keeper
Rulebook 40th Anniversary (Sandy Petersen).pdf`, 465 pages). Supersedes the
2026-07-05 audit, which was written against a 32 rule-id / 19-table baseline
and is now retained only as `HISTORICAL`.

## Baseline (measured 2026-07-07)

| Metric | Count |
|---|---|
| Rule-ids in `rule-index.json` | **75** |
| `.json` data files in `references/rules-json/` | **37** |
| Files referenced by ≥1 rule-id | **35** |
| Meta/index files (unreferenced by design) | **2** (`metadata.json`, `rule-index.json`) |
| Rule-ids referencing a missing file | **0** |
| Categories | **23** |

**Sources of truth.**
- Rule index: `plugins/coc-keeper/references/rules-json/rule-index.json`.
- JSON tables: `plugins/coc-keeper/references/rules-json/*.json`.
- Accessors: `plugins/coc-keeper/scripts/coc_rules.py` (`load_rule_table`, per-rule accessors).
- Page citations live in each table's `source_note` and each rule-id's `source_note`.

**Convention.** Printed page numbers are the rulebook's own footer numbers.
Classification:
- **COVERED** — a machine-checkable rule with a `rule-index.json` entry, a backing data file, and (where behavior is modeled) a script accessor.
- **PARTIAL** — rule recognized but with a tracked gap (e.g. declared count in `numeric` does not match the actual data-table size, or behavior is only partially implemented).
- **MISSING** — no implementation.
- **N/A** — lore/flavor, not machine-checkable.

## Overall verdict

**No chapter is MISSING.** The 2026-07-05 audit's MISSING/PARTIAL verdicts on
weapons, spells, monsters, bout-tables, phobias, manias, equipment, tomes,
poisons, artifacts, occupations, skills, and characteristic-dice were stale —
all of those tables now exist and are COVERED (see "Stale-verdict correction
log" below). The remaining debt is a set of **index/data count mismatches**
inside already-covered rules (PARTIAL), plus a few modeling gaps noted per
chapter.

## Coverage by category

All 75 rule-ids resolve to an existing `source_table`. Coverage is assessed
per category against the data file + accessor.

| Category | Rule-ids | Status | Notes |
|---|---|---|---|
| core_resolution | 4 | COVERED | percentile-check.json, roll-modifiers.json |
| difficulty | 4 | COVERED | difficulty-levels.json |
| success_level | 1 | COVERED | success-levels.json |
| character_creation | 8 | COVERED | age-adjustments, characteristic-dice, half-fifth-values, damage-bonus-build, movement-rate, derived-attributes, cash-assets, occupations |
| roll_procedure | 3 | COVERED | pushed-roll.json, combat.json (combined/opposed) |
| combat | 8 | COVERED | combat.json, weapons.json (100 weapons), poisons.json |
| sanity | 8 | COVERED | sanity.json, bout-tables.json, phobias.json (100), manias.json (100) |
| chase | 7 | COVERED | chase.json |
| reward | 1 | COVERED | reward.json |
| damage | 1 | COVERED | damage.json |
| skills | 2 | COVERED | skills.json (79 skills) |
| equipment | 1 | COVERED | equipment.json (1920s=21, modern=21) |
| artifacts | 1 | COVERED | artifacts.json (6) |
| monsters | 2 | COVERED | monsters.json (37) |
| mythos | 1 | COVERED | sanity.json max_san block + coc_mythos.max_san_for |
| luck | 3 | COVERED | luck.json |
| development | 3 | COVERED | development.json |
| magic | 4 | COVERED | spells.json (66 spells) |
| tomes | 2 | COVERED | tomes.json (98 tomes) |
| time | 1 | COVERED | time-costs.json (15 categories) |
| director | 1 | COVERED | structure-weights.json |
| healing | 1 | COVERED | treatment.json (p.164 recovery paths) — **new this audit** |
| module_rule | 8 | COVERED | the-haunting.json (8 scenario rules) |

## PARTIAL — index/data count mismatches (real debt)

These rules are COVERED in structure (file + accessor exist) but their
`rule-index.json` `numeric.*_count` field declares a count that disagrees with
the actual data-table size. The 2026-07-05 audit's MISSING verdicts on these
tables were caused partly by trusting the stale declared counts. Fix: update
the `numeric` count in `rule-index.json` to match the live table.

| rule-id | field | declared | actual | data table |
|---|---|---|---|---|
| core.magic.spell_schema | spell_count | 82 | 66 | spells.json (29 spells are supplement-sourced, audit-exempt) |
| core.tomes.stat_block | tome_count | 17 | 98 | tomes.json |
| core.monsters.stat_block | monster_count | 9 | 37 | monsters.json |
| core.sanity.phobia | phobia_count | 29 | 100 | phobias.json |
| core.sanity.mania | mania_count | 23 | 100 | manias.json |
| core.combat.poisons | poison_count | 8 | 11 | poisons.json |
| core.skills.base_chances | skill_count | 80 | 79 | skills.json |
| core.chase.vehicles | vehicle_count | 5 | 3 | chase.json |

**Recommended fix (small, mechanical):** correct each declared count to the
actual. This is a one-line-per-rule edit in `rule-index.json`. (Out of scope
for this audit pass; recorded as a follow-up.)

## Wiring gaps (behavioral, recorded for follow-up)

These are cases where the correct rule *data* and *engine* exist but are not
yet wired into the consuming entry point:

1. **max SAN in Story Director** — `core.sanity.max_formula` (rule-id), the
   `max_san` block in `sanity.json`, and `coc_mythos.max_san_for(cm)` all
   existed, but `coc_story_director.py` hardcoded `max_san = 99`. **Fixed in
   this pass (2026-07-07):** the director now reads Cthulhu Mythos and calls
   `coc_mythos.max_san_for`. See `test_director_uses_mythos_based_max_san`.

2. **PsychotherapySession not wired into the Director/time pipeline** —
   `core.healing.treatment` (rule-id, new this pass) + `treatment.json` +
   `PsychotherapySession` in `coc_healing.py` exist, but the session class is
   not imported by the director, harness, or `coc_time`. Data-layer is
   COMPLETE; behavioral wiring is a follow-up (same status as the pre-existing
   intent-router gap, now resolved separately — see below).

3. **Player-intent parser compliance** — `coc_intent_router.py` previously
   classified player intent by keyword matching, which violated the Semantic
   Matcher Constitution (`2026-07-03-coc-keeper-design.md:541`). **Fixed in
   this pass:** the router now delegates semantic judgment to an
   `IntentEvaluator` Protocol (default = file-mediated LLM evaluator mirroring
   `coc_playtest_suite.py`'s semantic-eval contract; tests inject a fixture).
   The module remains an optional enrichment layer (zero production consumers),
   not wired into the Director.

## Stale-verdict correction log (vs 2026-07-05 audit)

The 2026-07-05 audit marked these as MISSING/PARTIAL based on its 19-table
baseline. All are now COVERED — verified by the presence of the data file,
its rule-id, and (where applicable) an accessor in `coc_rules.py`.

| Table | 2026-07-05 verdict | 2026-07-07 verdict | Actual size |
|---|---|---|---|
| weapons.json | MISSING | COVERED | 100 weapons |
| spells.json | MISSING | COVERED (count PARTIAL) | 66 spells |
| monsters.json | MISSING | COVERED (count PARTIAL) | 37 monsters |
| bout-tables.json | PARTIAL | COVERED | realtime=10, summary=10 |
| phobias.json | MISSING | COVERED (count PARTIAL) | 100 |
| manias.json | MISSING | COVERED (count PARTIAL) | 100 |
| equipment.json | MISSING | COVERED | 1920s=21, modern=21 |
| tomes.json | MISSING | COVERED (count PARTIAL) | 98 tomes |
| poisons.json | MISSING | COVERED (count PARTIAL) | 11 poisons |
| artifacts.json | MISSING | COVERED | 6 artifacts |
| occupations.json | MISSING | COVERED | 28 occupations |
| skills.json | MISSING | COVERED (count PARTIAL) | 79 skills |
| characteristic-dice.json | MISSING | COVERED | 9 characteristics |
| treatment.json | (did not exist) | COVERED — new | 4 recovery paths |

## Chapters with no machine-checkable rules (N/A)

Per the 2026-07-05 audit's chapter scope: Chapter 1 (orientation), Chapter 2
(lore), and purely flavor sections remain **N/A** (lore/flavor, not
machine-checkable). No change.

## How to keep this audit fresh

This audit was regenerated from the live `rule-index.json` + data files rather
than transcribed by hand. To detect drift early: any new data table must be
added to `rules-json-guide.md` (enforced by
`test_rules_json_guide_lists_all_rule_json_files`), and any new rule-id must
be loadable via `coc_rules.rule_ids()` (enforced by
`test_rule_index_exposes_stable_ids_for_playtest_traceability`). The declared
`numeric.*_count` fields are **not** currently machine-checked against actual
table sizes — fixing the PARTIAL items above, and optionally adding such a
check, would prevent the stale-count drift that misled the prior audit.
