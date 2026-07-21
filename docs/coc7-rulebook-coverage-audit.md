# CoC 7e Rulebook Coverage Audit

Coverage of the *Call of Cthulhu 7th Edition (40th Anniversary) Keeper
Rulebook* against the three-layer paradigm in
`docs/rulebook-abstraction-paradigm.md`:

- **L1** — params table in `plugins/coc-keeper/rulesets/coc7/rules-json/`
- **Exec** — deterministic code/tool ownership (`coc_rules.py`,
  `coc_roll.py`, `coc_hazards.py`, toolbox tools)
- **L2** — behavioral logic (checklist section, skill doc)
- **L3** — `rule-index.json` category presence
- **Audit** — committed offline snapshot (`checks/rulebook-*-ref.json`,
  enforced by `tests/test_rulebook_data_audit.py`) and/or extraction-time
  OCR verifier (`scripts/verify_*_ocr.py`, needs MinerU cache)

Sources of the inventory: `checks/coC7_rule_checklist.md` sections A–L
(machine-checkable predicates with page anchors) and the rulebook data
chapters already extracted to `rules-json/`.

## A. Behavioral rules (checklist sections A–L)

| Section | L1 table(s) | Exec | L2 skill | L3 index | Audit |
|---|---|---|---|---|---|
| A. Skill rolls — difficulty & success tiers | `percentile-check.json`, `difficulty-levels.json`, `success-levels.json`, `half-fifth-values.json` | `coc_rules.py`, `rules.roll`, `rules.opposed` | `coc-rules-engine` | `core_resolution`, `difficulty`, `success_level` | playtest-log validator¹ |
| B. Fumbles & criticals | `percentile-check.json`, `success-levels.json` | `coc_roll.py`, `rules.roll` | `coc-rules-engine` | `core_resolution` | playtest-log validator¹ |
| C. Bonus & penalty dice | `roll-modifiers.json` | `coc_roll.py` | `coc-rules-engine` | `roll_procedure` | playtest-log validator¹ |
| D. Pushed rolls | `pushed-roll.json` | `coc_rules.py`, `rules.push` | `coc-rules-engine` (Push XOR Luck) | `roll_procedure` | playtest-log validator¹ |
| E. Development phase | `development.json`, `reward.json` | `development.settle` | `coc-development` | `development`, `reward` | playtest-log validator¹ |
| F. Sanity — core mechanics | `sanity.json` | `rules.sanity_check`, `sanity.context`, `sanity.execute` | `coc-sanity` | `sanity` (8 entries) | playtest-log validator¹ |
| G. Insanity thresholds & bouts | `sanity.json`, `bout-tables.json`, `phobias.json`, `manias.json` | `sanity.execute` | `coc-sanity` | `sanity` | OCR verifiers only² |
| H. Combat — order, attacks, defense | `combat.json`, `weapons.json`, `damage.json` | `combat.context`, `combat.resolve`, `combat.end`, `rules.damage` | `coc-combat` | `combat` (9 entries) | `weapons`, `monster-attacks` snapshots |
| I. Fighting maneuvers | `combat.json` | `coc_rules.py` (maneuver policy), `combat.resolve` | `coc-combat` | `combat` | playtest-log validator¹ |
| J. Wounds, healing, dying | `damage.json`, `treatment.json`, `hazards.json`, `poisons.json` | `rules.dying_check`, `rules.first_aid`, `rules.medicine`, `rules.weekly_recovery`, `coc_hazards.py` | `coc-combat`, `coc-keeper-play` | `damage`, `healing` | OCR verifier for poisons only² |
| K. Chases | `chase.json`, `movement-rate.json` | `chase.context`, `chase.execute` | `coc-chase` | `chase` (7 entries) | playtest-log validator¹ |
| L. Cross-cutting numeric (floor halves, human limit, cover/size/prone modifiers, Luck exclusions) | `half-fifth-values.json`, `roll-modifiers.json`, `combat.json`, `luck.json`, `movement-rate.json` | `coc_rules.py`, `rules.luck_spend` | `coc-rules-engine` | `luck`, `roll_procedure` | playtest-log validator¹ |

¹ `checks/exhaustive_rulebook_validator.py` sweeps playtest logs against the
checklist predicates; there is no committed offline JSON snapshot for
A–L predicates (they are behavior, not data tables — the playtest-log sweep
is the correct audit surface).

² Extraction-time verifiers exist (`verify_bout_tables_ocr.py`,
`verify_phobias_manias_ocr.py`, `verify_poisons_ocr.py`) but their reference
snapshots are **not** committed to `checks/rulebook-*-ref.json`, so the
offline pytest audit does not cover these tables. See Gap G2.

## B. Data chapters (rules-json tables)

| Chapter / data set | L1 table | Exec / consumer | L3 index | Offline snapshot | OCR verifier |
|---|---|---|---|---|---|
| Skills list (ch. 4) | `skills.json`, `skill-descriptions.json` | `coc_rules.py`, `rules.skill_describe` | `skills` (3) | ✅ `rulebook-skills-ref.json` | ✅ |
| Occupations | `occupations.json`, `cash-assets.json` | char-gen, `rules.cash_assets` | `character_creation` (8) | ✅ | ✅ |
| Characteristic rolls & age | `characteristic-dice.json`, `age-adjustments.json` | char-gen | `character_creation` | ❌ | ❌ |
| Weapons (Table XVII) | `weapons.json` | combat tools | `combat` | ✅ | ✅ |
| Equipment | `equipment.json` | inventory/state | `equipment` (1) | ❌ | ❌ |
| Spells (Grimoire) | `spells.json` | `coc-magic` | `magic` (4) | ✅ | ✅ |
| Spell mechanics (ch. 9) | inside `spells.json` casting/learning/mp keys | `coc-magic` | `magic` | ✅ `rulebook-spell-mechanics-ref.json` | — |
| Tomes | `tomes.json` | `coc-mythos-reference` | `tomes` (2) | ✅ | ✅ |
| Monsters | `monsters.json` | `coc-combat` | `monsters` (3) | ✅ (+ `monster-attacks`) | ✅ (+ monster SAN) |
| Sanity/insanity tables | `sanity.json`, `bout-tables.json`, `phobias.json`, `manias.json` | `coc-sanity` | `sanity` | ❌ | ✅ |
| Poisons / hazards | `poisons.json`, `hazards.json` | `coc_hazards.py` | `damage` | ❌ | ✅ (poisons only) |
| Artifacts | `artifacts.json` | `coc-mythos-reference` | `artifacts` (1) | ❌ | ❌ |
| Luck | `luck.json` | `rules.luck_spend`, `coc_roll.spend_luck` | `luck` (3) | ❌ | ❌ |
| Movement / build scale | `movement-rate.json`, `build-scale.json` | chase/combat | `chase`, `combat` | ❌ | ❌ |
| NPC archetypes (product-side) | `npc-core-tags.json`, `npc-role-templates.json`, `npc-social-roles.json`, `npc-stat-archetypes.json` | `npc.*` tools | `npc_agency` (4) | n/a (not rulebook data) | n/a |
| Module data (scenarios) | `the-haunting.json`, `the-white-war.json`, `storylet-library.json`, `structure-weights.json` | module tools | `module_rule` (14) | n/a (module truth, read-only) | n/a |

## Gaps, classified by layer

- **G1 (Audit, L1).** Eight data sets have committed offline snapshots
  (skills, occupations, weapons, spells, spell-mechanics, tomes, monsters,
  monster-attacks). Tables extracted but **not** covered by the offline
  audit: `bout-tables`, `phobias`, `manias`, `poisons`, `equipment`,
  `artifacts`, `characteristic-dice`, `age-adjustments`, `luck`,
  `movement-rate`, `build-scale`, `sanity`, `combat`, `chase`, `damage`,
  `treatment`, `hazards`. Three of these have OCR-time verifiers only
  (bout tables, phobias/manias, poisons), which need the MinerU cache and
  are not enforced in pytest. Highest-value gap: drift in any of these
  tables currently fails nothing automatically.
- **G2 (Audit pipeline).** The bout-tables / phobias-manias / poisons
  verifiers prove the pattern works; their reference snapshots were never
  committed. Committing them (same `rulebook-*-ref.json` contract) folds
  three more tables into the offline audit with no new extraction.
- **G3 (L2 form).** Behavioral rules A–L live as checklist Markdown +
  skill prose, indexed only indirectly. They have page anchors and
  predicates but no stable rule `id` in `rule-index.json`, so playtest
  logs cannot cite them via `rule_refs` the way L1 rules can. The paradigm
  doc defines the JSON upgrade path (stable id + structured `when` +
  text-logic `then`); it is deliberately not a rule engine.
- **G4 (L2 depth, low priority).** Firearm malfunction sub-tables,
  insanity side-effect enumerations beyond phobias/manias samples, and
  artifact descriptions are thinner than the book. These matter at the
  table only when the fiction reaches them.

## Completion roadmap (recommendation, ordered by gameplay criticality)

1. **Close G2** — commit reference snapshots for bout tables,
   phobias/manias, and poisons (extraction already verified); extend
   `gap_audit.py` to compare them. Cheap, immediately raises drift
   protection on sanity/hazard play.
2. **Close G1 for combat-adjacent numerics** — `damage`, `treatment`,
   `combat`, `chase`, `movement-rate`, `build-scale`, `luck`, `sanity`:
   snapshot the already-extracted values, extend the offline audit. This
   protects the rules most often exercised every session.
3. **Upgrade L2 to indexed JSON (G3)** — start with checklist sections
   A–D and F (the every-session rules): assign stable ids, structured
   `when` fields, register in `rule-index.json`, let playtest logs cite
   them. Keep text logic and anchors verbatim. Do not convert advisory
   content into gates.
4. **Then depth gaps (G4)** — only when a real playtest actually reaches
   malfunction tables or artifact detail (System Gap Before Instance
   Patch: fix the class, not one instance).

Steps 1–2 are pure audit-hardening with no gameplay behavior change; steps
3–4 touch the behavioral layer and should each be exercised by at least one
real plugin-native session before being called integrated (Feature
Integration Is Part Of Implementation).

---

*Audit method note: this document is a static coverage map produced by
reading the repository assets listed above; it makes no gameplay or
experience claims. Re-verify before relying on it after rule-table or
skill-tree changes.*
