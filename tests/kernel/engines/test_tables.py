"""Rule table access. Ported from the old tree's `tests/test_rules.py` (subject:
`coc_rules.py`, now `kernel/coc/rules/tables.py`'s `RuleTables` class).

API change from the port: every accessor was a module-level function reading a
module-global `RULES_DIR`; they are now bound methods of a `RuleTables`
instance constructed from an explicit `rules_dir` (so two content roots can
coexist in one process) -- `coc_rules.load_rule_table(name)` became
`tables.load(name)`, `coc_rules.percentile_check_rule()` became
`tables.percentile_check_rule()`, etc. A few accessors gained extra
provenance keys (`source_rule_id` / `source_note`) that the old code's fixed-key
dict builders didn't carry (`damage_rule`, `reward_rule`, `pushed_roll_rule`) --
those tests are adapted to check the expected sub-fields rather than exact
dict equality (the extra keys are enrichment, not a behavior change).

Dropped (subject deleted or moved):
- `the_haunting_rules()` -- no module-specific rule accessor exists on
  `RuleTables` anymore (also dropped: `module_rules`, `module_monster_rule`,
  `module_monster_san_threat`, `module_daylight_skill_modifier`); module rule
  data is a content-layer concern now, not the coc7 ruleset package's.
- `chase_rule()`'s *typed* shape -- only the raw `chase_table()` pass-through
  remains (richer than before: it now also carries `speed_roll`,
  `escape_criterion`, `vehicles`, `vehicular_collisions`, etc. straight from
  chase.json). The two sub-objects the old test checked
  (`movement_actions`, `pushed_rolls`) are ported as raw-table assertions.
- `occupation_by_name()` -- gone from `RuleTables`; occupation lookup and its
  "unknown occupation" error contract live on `Chargen.occupation()` now,
  already covered by `tests/kernel/test_chargen.py`
  (`test_unknown_occupation_and_method_are_refused`).
- `tome_by_name()`, `monster_by_name()`, `characteristic_dice_for()` -- no
  per-name accessor remains; only the whole-table getters
  (`tomes_table`, `monsters_table`, `characteristic_dice`) do.
- `movement_rate()` and `derived_attributes_rule()` -- folded into
  `Chargen.derive()` / `Chargen.movement()`; behavior is covered by
  `tests/kernel/test_chargen.py` (`test_derive_values_match_the_rulebook_cases`,
  `test_movement_rate_applies_the_age_penalty`,
  `test_every_derived_number_names_its_table`).
- `age_adjustment()` -- folded into `Chargen.apply_age()` / `age_bracket()`
  with a different (trace-based) shape; covered by
  `tests/kernel/test_chargen.py` (`test_age_bracket_20_39_only_runs_one_edu_check`,
  `test_age_bracket_40_49_spreads_the_reduction_over_the_listed_choices`,
  `test_age_outside_the_table_is_refused`).
- `special_damage_effects_rule()` -- no longer an accessor on `RuleTables`.
- `spell_by_name()` -- moved to `magic.py` (needs a `Catalog` now); its two
  cases ("Flesh Ward", "Dominate") are ported in
  `tests/kernel/engines/test_magic.py` instead.
- `coc_rule_signals.read_psychology_concealed` -- `coc_rule_signals.py` has no
  apparent counterpart anywhere under `kernel/coc/rules/`; it is outside this
  ticket's assigned module list (combat/chase/sanity/healing/magic/mp/mythos/
  development/roll/skills/rules/character), so it is left unaddressed here
  rather than guessed at.
"""

from __future__ import annotations

import json
import sys

import pytest
from conftest import CONTENT_DIR, KERNEL_DIR

sys.path.insert(0, str(KERNEL_DIR))

from coc.rules.tables import RuleTables  # noqa: E402

RULES = CONTENT_DIR / "rulesets" / "coc7" / "rules-json"


@pytest.fixture
def tables() -> RuleTables:
    return RuleTables(RULES)


def _assert_subset(actual: dict, expected: dict) -> None:
    for key, value in expected.items():
        assert actual[key] == value, key


def test_percentile_check_rule_uses_structured_table(tables):
    table = tables.load("percentile-check")
    assert table["die"] == "1D100"
    assert tables.percentile_check_rule() == {
        "die": "1D100", "minimum_roll": 1, "maximum_roll": 100, "minimum_target": 1,
        "maximum_target": 100, "success_if_roll_lte_effective_target": True,
        "zero_zero_result": 100, "digit_base": 10,
    }


def test_roll_modifiers_rule_uses_structured_table(tables):
    table = tables.load("roll-modifiers")
    assert table["cancellation"]["method"] == "one_for_one"
    assert tables.roll_modifiers_rule() == {
        "applies_to": "percentile-check",
        "cancellation": {"method": "one_for_one", "net_bonus_formula": "max(0, bonus - penalty)",
                         "net_penalty_formula": "max(0, penalty - bonus)"},
        "maximum_dice_per_roll": {"bonus": 2, "penalty": 2},
        "bonus_die": {"extra_tens_dice_per_die": 1, "selected_tens": "lowest", "uses_same_units_die": True},
        "penalty_die": {"extra_tens_dice_per_die": 1, "selected_tens": "highest", "uses_same_units_die": True},
    }


def test_pushed_roll_rule_uses_structured_table(tables):
    table = tables.load("pushed-roll")
    assert table["maximum_attempts_after_initial_failure"] == 1
    _assert_subset(tables.pushed_roll_rule(), {
        "maximum_attempts_after_initial_failure": 1, "requires_changed_approach": True,
        "requires_keeper_foreshadowed_failure": True, "requires_keeper_owned_failure_consequence": True,
        "requires_player_confirmation": True,
        "required_stages": ["player_reframes_action", "keeper_foreshadows_failure",
                           "player_confirms_risk", "roll_resolved"],
    })


def test_chase_table_carries_movement_actions_and_pushed_rolls(tables):
    """`chase_rule()`'s typed accessor is gone; `chase_table()` is the raw
    pass-through, so check the two sub-objects the old test cared about."""
    table = tables.load("chase")
    assert table["movement_actions"]["base_movement_actions"] == 1
    raw = tables.chase_table()
    assert raw["movement_actions"] == {
        "base_movement_actions": 1, "extra_actions_per_mov_above_slowest": 1, "minimum_movement_actions": 1,
    }
    assert raw["pushed_rolls"] == {
        "allowed_inside_active_chase": False, "applies_to": ["hazard", "barrier", "conflict"],
    }


def test_combined_roll_rule_uses_structured_table(tables):
    table = tables.load("combat")
    assert table["combined_roll"]["source_rule_id"] == "core.combined_roll"
    assert tables.combined_roll_rule() == {
        "roll_count": 1, "minimum_compared_targets": 2, "requires_compared_targets": True,
        "comparison_modes": ["any", "all"],
    }


def test_opposed_roll_rule_uses_structured_table(tables):
    table = tables.load("combat")
    assert table["opposed_roll"]["source_rule_id"] == "core.opposed_roll"
    assert tables.opposed_roll_rule() == {
        "participant_rolls": 2, "requires_mutually_exclusive_goals": True, "uses_success_level_order": True,
        "tie_breakers": ["higher_skill_or_characteristic", "impasse_or_reroll"], "can_be_pushed": False,
    }


def test_combat_rule_uses_structured_table(tables):
    table = tables.load("combat")
    assert table["melee_combat"]["source_rule_id"] == "core.combat.attack_or_maneuver"
    assert tables.combat_rule() == {
        "order": {"sort_key": "DEX", "direction": "descending"},
        "actions_per_round": 1, "uses_percentile_check": True, "uses_success_level": True,
        "combat_rolls_can_be_pushed": False, "defense_options": ["dodge", "fight_back", "maneuver"],
        "attack_vs_dodge": {"attacker_requires_higher_success_level": True, "tie_winner": "defender",
                           "both_fail_damage": False},
        "attack_vs_fight_back": {"higher_success_level_wins": True, "tie_winner": "attacker",
                                "both_fail_damage": False},
        "maneuver": {"build_difference_impossible_at": 3, "penalty_die_per_build_difference": 1,
                    "attack_vs_dodge_tie_winner": "target", "attack_vs_fight_back_tie_winner": "maneuver_actor"},
    }


def test_damage_rule_uses_structured_table(tables):
    table = tables.load("damage")
    assert table["resource"] == "hit_points"
    _assert_subset(tables.damage_rule(), {
        "resource": "hit_points", "dice_kind": "damage", "requires_roll_id": True, "requires_die": True,
        "requires_roll_total": True, "requires_resource_before_delta_after": True,
        "delta_sign": "negative", "non_percentile": True,
    })


def test_reward_rule_uses_structured_table(tables):
    table = tables.load("reward")
    assert table["resource"] == "sanity"
    _assert_subset(tables.reward_rule(), {
        "resource": "sanity", "dice_kind": "reward", "requires_roll_id": True, "requires_die": True,
        "requires_roll_total": True, "requires_resource_before_delta_after": True,
        "delta_sign": "positive", "non_percentile": True,
    })


def test_success_level_uses_percentile_check_bounds(tables, monkeypatch):
    def fake_percentile_check_rule():
        return {"die": "1D20", "minimum_roll": 10, "maximum_roll": 20, "minimum_target": 10,
                "maximum_target": 20, "success_if_roll_lte_effective_target": True, "zero_zero_result": 20}

    monkeypatch.setattr(tables, "percentile_check_rule", fake_percentile_check_rule, raising=False)

    with pytest.raises(ValueError, match="10 and 20"):
        tables.success_level(5, 15)


def test_half_and_fifth_values_round_down(tables):
    table = tables.load("half-fifth-values")
    assert table["half"]["divisor"] == 2
    assert table["fifth"]["divisor"] == 5
    assert tables.half_value(55) == 27
    assert tables.fifth_value(55) == 11
    assert tables.half_value(100) == 50
    assert tables.fifth_value(100) == 20


def test_half_and_fifth_values_use_structured_table(tables, monkeypatch):
    original_load = tables.load

    def fake_load(name: str):
        if name == "half-fifth-values":
            return {"half": {"divisor": 4, "rounding": "floor"}, "fifth": {"divisor": 10, "rounding": "floor"}}
        return original_load(name)

    monkeypatch.setattr(tables, "load", fake_load, raising=False)

    assert tables.half_value(55) == 13
    assert tables.fifth_value(55) == 5


def test_damage_bonus_and_build_use_structured_table(tables):
    result = tables.damage_bonus_build(60, 70)
    assert result == {"total": 130, "damage_bonus": "+1D4", "build": 1}


def test_weapons_table_structure_and_schema(tables):
    """Table XVII weapons.json (pp.401-405) loads with the expected shape."""
    table = tables.load("weapons")
    assert "Table XVII" in table["source_note"]
    assert "401-405" in table["source_note"]
    weapons = tables.weapons_table()
    knife = weapons["knife_medium"]
    assert knife["skill"] == "Fighting (Brawl)"
    assert knife["damage_die"] == "1D4+2"
    assert knife["adds_damage_bonus"] is True
    assert knife["impales"] is True
    revolver = weapons["revolver_38_or_9mm"]
    assert revolver["skill"] == "Firearms (Handgun)"
    assert revolver["damage_die"] == "1D10"
    assert revolver["adds_damage_bonus"] is False
    assert revolver["impales"] is True
    assert revolver["magazine"] == 6
    assert revolver["malfunction"] == 100
    auto38 = weapons["revolver_38"]
    assert auto38["display_name"] == ".38 Automatic"
    assert auto38["magazine"] == 8
    assert auto38["malfunction"] == 99
    p08 = weapons["9mm_auto_model_p08"]
    assert p08["skill"] == "Firearms (Handgun)"
    assert p08["damage_die"] == "1D10"
    assert p08["magazine"] == 8
    assert p08["malfunction"] == 99
    assert p08["eras"] == ["1920s", "modern"]
    shotgun = weapons["shotgun_12g"]
    assert shotgun["range_banded_damage"] == {"point_blank": "4D6", "half": "2D6", "max": "1D6"}


def test_weapon_by_name_lookup_success_and_missing_key(tables):
    row = tables.weapon_by_name("revolver_45")
    assert row["damage_die"] == "1D10+2"
    assert row["eras"] == ["1920s", "modern"]
    with pytest.raises(KeyError):
        tables.weapon_by_name("nonexistent_weapon")


def test_characteristic_dice_table_structure_and_schema(tables):
    """Chapter 3 characteristic dice (pp.30-31) load with the expected shape."""
    table = tables.load("characteristic-dice")
    assert "30-31" in table["source_note"]
    assert table["multiplier"] == 5
    assert table["luck_independent_of_pow"] is True
    dice = tables.characteristic_dice()
    assert set(dice.keys()) == {"STR", "CON", "SIZ", "DEX", "APP", "INT", "POW", "EDU", "Luck"}
    for name in ("STR", "CON", "DEX", "APP", "POW", "Luck"):
        assert dice[name]["dice"] == "3D6"
    for name in ("SIZ", "INT", "EDU"):
        assert dice[name]["dice"] == "2D6+6"
    assert dice["Luck"]["independent_of_pow"] is True


def test_difficulty_target_uses_structured_table(tables):
    table = tables.load("difficulty-levels")
    assert table["hard"]["divisor"] == 2
    assert tables.difficulty_target(61, "regular") == 61
    assert tables.difficulty_target(61, "hard") == 30
    assert tables.difficulty_target(61, "extreme") == 12


def test_success_levels_include_fumbles_and_extreme_success(tables):
    table = tables.load("success-levels")
    assert table["fumble"]["target_threshold"] == 50
    assert tables.success_level(1, 65) == "critical"
    assert tables.success_level(12, 65) == "extreme"
    assert tables.success_level(31, 65) == "hard"
    assert tables.success_level(60, 65) == "regular"
    assert tables.success_level(80, 65) == "failure"
    assert tables.success_level(100, 65) == "fumble"
    assert tables.success_level(96, 40) == "fumble"


def test_success_level_uses_rules_json_fumble_threshold(tables, monkeypatch):
    original_load = tables.load

    def fake_load(name: str):
        if name == "success-levels":
            return {"critical_roll": 1, "fumble": {"target_threshold": 60,
                    "target_below_threshold": [96, 100], "target_at_or_above_threshold": [100, 100]}}
        return original_load(name)

    monkeypatch.setattr(tables, "load", fake_load, raising=False)

    assert tables.success_level(96, 55) == "fumble"


def test_rule_index_exposes_stable_ids_for_playtest_traceability(tables):
    ids = tables.rule_ids()
    for rule_id in [
        "core.percentile_check", "core.percentile_check.roll_modifiers", "core.difficulty.regular",
        "core.success_level", "core.character_creation.derived_attributes",
        "core.character_creation.damage_bonus_build", "core.character_creation.movement_rate",
        "core.character_creation.occupations", "core.character_creation.characteristic_dice",
        "core.pushed_roll", "core.sanity.temporary_insanity_threshold", "core.chase.movement_actions",
        "core.chase.no_pushed_rolls", "core.combat.weapons", "core.magic.spell_schema", "core.magic.casting",
        "core.magic.learning", "core.magic.mp_economy", "core.tomes.stat_block", "core.monsters.stat_block",
        "core.sanity.bout_realtime", "core.sanity.bout_summary", "core.sanity.phobia", "core.sanity.mania",
        "core.equipment.price_list", "core.healing.treatment", "core.combat.poisons",
        "core.combat.special_damage_effects", "core.combat.special_damage_effects.stun",
        "core.combat.special_damage_effects.burn", "core.artifacts.alien_device",
        "module.haunting.corbitt_flesh_ward", "module.haunting.corbitt_floating_knife_mp",
        "module.haunting.corbitt_animate_body", "module.haunting.corbitt_own_dagger",
    ]:
        assert rule_id in ids


def test_build_scale_table_structure(tables):
    """build-scale.json records the p.279 Builds quick-reference and Table XV."""
    table = tables.load("build-scale")
    bands = {band["relative_build"]: band["verdict"] for band in table["lift_throw_bands"]}
    assert bands == {
        -2: "thrown", -1: "lifted_with_ease", 0: "carried_briefly",
        1: "barely_lifted", 2: "cannot_lift_unbalance_or_disarm",
    }
    rows = table["comparative_builds"]
    assert rows[0]["build"] == -2
    assert rows[-1]["build"] == 65
    by_build = {row["build"]: row for row in rows}
    assert by_build[0]["natural_world"] == ["average human adult", "wolf"]
    assert by_build[5]["mythos"] == ["dark young"]
    assert by_build[6]["inanimate"] == ["pickup truck"]
    assert by_build[22]["natural_world"] == ["blue whale"]
    assert "Great Cthulhu" in by_build[22]["mythos"]


def test_build_scale_row_and_compare_builds(tables):
    exact = tables.build_scale_row(9)
    assert exact["listed"] is True
    assert exact["mythos"] == ["shoggoth"]

    unlisted = tables.build_scale_row(8)
    assert unlisted["listed"] is False
    assert unlisted["nearest_below"]["build"] == 7
    assert unlisted["nearest_above"]["build"] == 9

    thrown = tables.compare_builds(0, -2)
    assert thrown["relative_build"] == -2
    assert thrown["lift_throw"]["verdict"] == "thrown"
    assert thrown["maneuver"] == {"penalty_dice": 0, "impossible": False}

    carried = tables.compare_builds(0, 0)
    assert carried["lift_throw"]["verdict"] == "carried_briefly"

    barely = tables.compare_builds(0, 1)
    assert barely["lift_throw"]["verdict"] == "barely_lifted"
    assert barely["maneuver"]["penalty_dice"] == 1
    assert barely["maneuver"]["impossible"] is False

    cannot = tables.compare_builds(0, 2)
    assert cannot["lift_throw"]["verdict"] == "cannot_lift_unbalance_or_disarm"
    assert cannot["maneuver"]["penalty_dice"] == 2
    assert cannot["maneuver"]["impossible"] is False

    impossible = tables.compare_builds(0, 3)
    assert impossible["lift_throw"]["verdict"] == "cannot_lift_unbalance_or_disarm"
    assert impossible["maneuver"] == {"penalty_dice": 0, "impossible": True}

    assert "core.monsters.build_scale" in tables.rule_ids()


def test_damage_bonus_build_extrapolation_above_524(tables):
    # Totals at or below 524 follow the fixed table (sanity-check unchanged).
    assert tables.damage_bonus_build(300, 200) == {"total": 500, "damage_bonus": "+5D6", "build": 6}
    # 525 is the first extrapolated step beyond 524: +1 step.
    result = tables.damage_bonus_build(300, 225)
    assert result["total"] == 525
    assert result["damage_bonus"] == "+6D6"
    assert result["build"] == 7
    # 604 is still within the first 80-point band (525-604), so still +6D6.
    result = tables.damage_bonus_build(300, 304)
    assert result["total"] == 604
    assert result["damage_bonus"] == "+6D6"
    assert result["build"] == 7
    # 605 begins the second 80-point band: +2 steps.
    result = tables.damage_bonus_build(302, 303)
    assert result["total"] == 605
    assert result["damage_bonus"] == "+7D6"
    assert result["build"] == 8


def test_occupations_table_structure(tables):
    """occupations_table returns the Chapter 3 Sample Occupations."""
    table = tables.occupations_table()
    assert isinstance(table, dict)
    assert "Journalist" in table
    j = table["Journalist"]
    assert j["credit_rating_range"] == [9, 30]
    assert j["skill_point_formula"] == "EDU*4"
    assert "lovecraftian" in j["tags"]


def test_spells_table_structure(tables):
    """spells_table returns the Grimoire data with mechanics + spell list."""
    table = tables.spells_table()
    assert "casting" in table
    assert "learning" in table
    assert "mp_economy" in table
    assert "spells" in table
    assert isinstance(table["spells"], list)
    assert len(table["spells"]) >= 50
    assert table["casting"]["first_cast_roll"] == "Hard POW"
    assert table["casting"]["pushable"] is True
    assert table["mp_economy"]["initial"] == "POW/5 floor"


def test_magic_mechanic_accessors(tables):
    """Casting, learning, and MP economy accessors return structured blocks."""
    casting = tables.magic_casting_rules()
    assert casting["first_cast_roll"] == "Hard POW"
    assert casting["push_mp_multiplier"] == "1D6"

    learning = tables.magic_learning_rules()
    assert learning["roll"] == "Hard INT"
    assert learning["from_tome_weeks"] == "2D6"

    mp = tables.magic_mp_economy()
    assert mp["regen_per_hour"] == 1
    assert mp["after_zero_costs_hp_one_for_one"] is True


def test_tomes_table_structure(tables):
    """tomes_table returns the Chapter 11 Mythos Tomes table (dict keyed by name)."""
    table = tables.tomes_table()
    assert isinstance(table, dict)
    assert len(table) >= 30
    al_azif = [k for k in table if "Al Azif" in k]
    assert len(al_azif) >= 1
    t = table[al_azif[0]]
    assert t["sanity_cost"] == "2D10"
    assert t["cthulhu_mythos_full"] == 12
    assert any("Necronomicon" in n for n in table)


def test_monsters_table_structure(tables):
    table = tables.monsters_table()
    assert isinstance(table, dict)
    assert len(table) >= 5


def test_every_monster_has_well_formed_presentation_block(tables):
    """W1-5: Ch14 p.280-282 monster performance contracts."""
    table = tables.monsters_table()
    required = {"never_name_until", "sensory_signature", "death_residue", "combat_goal",
               "retreat_below_hp_fraction"}
    valid_goals = {"kill", "capture", "flee", "ritual"}
    offenders = []
    for name, entry in table.items():
        presentation = entry.get("presentation")
        if not isinstance(presentation, dict):
            offenders.append((name, "missing_presentation"))
            continue
        missing = required - set(presentation)
        if missing:
            offenders.append((name, f"missing_keys:{sorted(missing)}"))
            continue
        if presentation.get("never_name_until") != "revelation":
            offenders.append((name, "never_name_until"))
        sig = presentation.get("sensory_signature")
        if not isinstance(sig, list) or not (2 <= len(sig) <= 4) or not all(
            isinstance(s, str) and s.strip() for s in sig
        ):
            offenders.append((name, "sensory_signature"))
        residue = presentation.get("death_residue")
        if not isinstance(residue, str) or not residue.strip():
            offenders.append((name, "death_residue"))
        if presentation.get("combat_goal") not in valid_goals:
            offenders.append((name, "combat_goal"))
        frac = presentation.get("retreat_below_hp_fraction")
        if frac is not None and not (isinstance(frac, (int, float)) and 0 < float(frac) < 1):
            offenders.append((name, "retreat_below_hp_fraction"))
    assert offenders == []


def test_bout_tables_structure(tables):
    rt = tables.bout_realtime_table()
    sm = tables.bout_summary_table()
    rt_core_rolls = {row["d10_roll"] for row in rt}
    sm_core_rolls = {row["d10_roll"] for row in sm}
    assert rt_core_rolls == set(range(1, 11))
    assert sm_core_rolls == set(range(1, 11))
    assert len(rt) >= 10
    assert len(sm) >= 10
    assert rt[0]["d10_roll"] == 1


def test_phobias_and_manias_structure(tables):
    ph = tables.phobias_table()
    ma = tables.manias_table()
    assert len(ph) >= 10
    assert len(ma) >= 5
    assert "Claustrophobia" in ph


def test_equipment_schema_v2_rejects_legacy_periods(tables):
    raw = json.loads((RULES / "equipment.json").read_text(encoding="utf-8"))
    assert raw["schema_version"] == 2
    assert "periods" not in raw
    assert isinstance(raw["records"], list)
    assert len(raw["records"]) >= 500
    eq = tables.equipment_table()
    assert eq["schema_version"] == 2
    assert "periods" not in eq


def test_equipment_table_fails_closed_on_a_legacy_periods_shape(tables, monkeypatch):
    original_load = tables.load

    def fake_load(name: str):
        if name == "equipment":
            return {"source_note": "old", "periods": {"1920s": [{"item": "Flashlight", "price": "$2"}]}}
        return original_load(name)

    monkeypatch.setattr(tables, "load", fake_load, raising=False)
    with pytest.raises(ValueError, match="schema-v2"):
        tables.equipment_table()


def test_equipment_and_poisons_and_artifacts(tables):
    eq = tables.equipment_table()
    assert eq["schema_version"] == 2
    assert "periods" not in eq
    records = eq["records"]
    assert isinstance(records, list)
    eras = {row["era"] for row in records if isinstance(row, dict)}
    assert "1920s" in eras
    assert "modern" in eras
    po = tables.poisons_table()
    assert len(po) >= 5
    ar = tables.artifacts_table()
    assert len(ar) >= 3


def test_treatment_rule_exposes_p164_recovery_paths(tables):
    """core.healing.treatment surfaces the p.164 indefinite-insanity paths."""
    tr = tables.treatment_rule()
    for path in ("psychoanalysis", "asylum_confinement", "asylum_release", "self_help"):
        assert path in tr, f"missing treatment path: {path}"
        assert "p.164" in tr[path]["source_note"]
    psy = tr["psychoanalysis"]
    assert psy["skill"] == "Psychoanalysis"
    assert psy["success_recovery"] == {"regular": "1D3", "hard": "2D3", "extreme": "3D3"}
    assert tr["asylum_confinement"]["duration_months"] == "1D6"
    assert tr["asylum_release"]["skill"] == "Psychoanalysis"


def test_sanity_max_formula_uses_structured_table(tables):
    block = tables.sanity_max_formula()
    assert block["formula"] == "99 - cthulhu_mythos"
    assert block["base_max"] == 99


def test_luck_rule_uses_structured_table(tables):
    rule = tables.luck_rule()
    assert rule["spend"]["luck_point_value"] == 1
    assert rule["spend"]["cost_per_point_off_roll"] == 1
    assert rule["roll"]["group_roll_policy"] == "take_lowest"
    assert rule["recovery"]["gain_on_success"] == "1D10"
    assert rule["recovery"]["cap"] == 99
    assert rule["recovery"]["optional_rule"] is True


def test_development_rule_uses_structured_table(tables):
    rule = tables.development_rule()
    assert rule["tick"]["awarded_when"] == "regular_or_hard_or_extreme_success"
    assert rule["tick"]["ticks_per_qualifying_success"] == 1
    assert "opposed_roll_loser" in rule["tick"]["excluded_outcomes"]
    assert rule["improvement_roll"]["gain_on_success"] == "1D10"
    assert rule["improvement_roll"]["cap_for_san_reward"] == 90


def test_development_rule_carries_over_95_auto_improve(tables):
    """p.94: a development roll higher than the skill OR over 95 improves the
    skill; Cthulhu Mythos and Credit Rating never receive ticks."""
    rule = tables.development_rule()
    assert rule["improvement_roll"]["always_improves_above"] == 95
    assert "Cthulhu Mythos" in rule["tick"]["never_tick_skills"]
    assert "Credit Rating" in rule["tick"]["never_tick_skills"]
    assert "pushed_roll_that_would_not_otherwise_tick" not in rule["tick"]["excluded_outcomes"]
    assert "success_obtained_by_spending_luck" in rule["tick"]["excluded_outcomes"]


def test_luck_rule_exposes_spend_constraints(tables):
    """p.99: Luck spend restrictions are structured constraints."""
    rule = tables.luck_rule()
    cons = rule["spend"]["constraints"]
    assert "luck_may_not_be_spent_on_sanity_rolls" in cons
    assert "luck_may_not_be_spent_on_luck_rolls" in cons
    assert "push_or_spend_luck_but_not_both" in cons
    assert "criticals_fumbles_malfunctions_cannot_be_bought_off" in cons
    assert "no_improvement_check_if_luck_spent" in cons
    assert rule["recovery"]["applies_when"] == "after_each_session"


def test_rule_index_exposes_luck_and_development_and_max_san_ids(tables):
    ids = tables.rule_ids()
    for rule_id in [
        "core.luck.spend", "core.luck.roll", "core.luck.recovery", "core.development.tick",
        "core.development.improvement_roll", "core.sanity.max_formula",
    ]:
        assert rule_id in ids, f"missing rule-id: {rule_id}"
