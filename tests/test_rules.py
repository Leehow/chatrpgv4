import importlib.util
from pathlib import Path

import pytest


def load_module(name: str, relative_path: str):
    path = Path(relative_path)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_rules = load_module("coc_rules", "plugins/coc-keeper/scripts/coc_rules.py")


def test_percentile_check_rule_uses_structured_table():
    table = coc_rules.load_rule_table("percentile-check")

    assert table["die"] == "1D100"
    assert coc_rules.percentile_check_rule() == {
        "die": "1D100",
        "minimum_roll": 1,
        "maximum_roll": 100,
        "minimum_target": 1,
        "maximum_target": 100,
        "success_if_roll_lte_effective_target": True,
        "zero_zero_result": 100,
        "digit_base": 10,
    }


def test_roll_modifiers_rule_uses_structured_table():
    table = coc_rules.load_rule_table("roll-modifiers")

    assert table["cancellation"]["method"] == "one_for_one"
    assert coc_rules.roll_modifiers_rule() == {
        "applies_to": "percentile-check",
        "cancellation": {
            "method": "one_for_one",
            "net_bonus_formula": "max(0, bonus - penalty)",
            "net_penalty_formula": "max(0, penalty - bonus)",
        },
        "bonus_die": {
            "extra_tens_dice_per_die": 1,
            "selected_tens": "lowest",
            "uses_same_units_die": True,
        },
        "penalty_die": {
            "extra_tens_dice_per_die": 1,
            "selected_tens": "highest",
            "uses_same_units_die": True,
        },
    }


def test_pushed_roll_rule_uses_structured_table():
    table = coc_rules.load_rule_table("pushed-roll")

    assert table["maximum_attempts_after_initial_failure"] == 1
    assert coc_rules.pushed_roll_rule() == {
        "maximum_attempts_after_initial_failure": 1,
        "requires_changed_approach": True,
        "requires_keeper_foreshadowed_failure": True,
        "requires_keeper_owned_failure_consequence": True,
        "requires_player_confirmation": True,
        "required_stages": [
            "player_reframes_action",
            "keeper_foreshadows_failure",
            "player_confirms_risk",
            "roll_resolved",
        ],
    }


def test_chase_rule_uses_structured_table():
    table = coc_rules.load_rule_table("chase")

    assert table["movement_actions"]["base_movement_actions"] == 1
    assert coc_rules.chase_rule() == {
        "movement_actions": {
            "base_movement_actions": 1,
            "extra_actions_per_mov_above_slowest": 1,
            "minimum_movement_actions": 1,
        },
        "pushed_rolls": {
            "allowed_inside_active_chase": False,
            "applies_to": ["hazard", "barrier", "conflict"],
        },
    }


def test_combined_roll_rule_uses_structured_table():
    table = coc_rules.load_rule_table("combat")

    assert table["combined_roll"]["source_rule_id"] == "core.combined_roll"
    assert coc_rules.combined_roll_rule() == {
        "roll_count": 1,
        "minimum_compared_targets": 2,
        "requires_compared_targets": True,
        "success_if_roll_lte_any_target": True,
        "teamwork": {
            "lead_uses_highest_skill": True,
            "helpers_grant_bonus_die_per_helper": True,
            "max_bonus_dice": 2,
        },
    }


def test_opposed_roll_rule_uses_structured_table():
    table = coc_rules.load_rule_table("combat")

    assert table["opposed_roll"]["source_rule_id"] == "core.opposed_roll"
    assert coc_rules.opposed_roll_rule() == {
        "participant_rolls": 2,
        "requires_mutually_exclusive_goals": True,
        "uses_success_level_order": True,
        "tie_breakers": [
            "higher_skill_or_characteristic",
            "impasse_or_reroll",
        ],
        "can_be_pushed": False,
    }


def test_combat_rule_uses_structured_table():
    table = coc_rules.load_rule_table("combat")

    assert table["melee_combat"]["source_rule_id"] == "core.combat.attack_or_maneuver"
    assert coc_rules.combat_rule() == {
        "order": {
            "sort_key": "DEX",
            "direction": "descending",
        },
        "actions_per_round": 1,
        "uses_percentile_check": True,
        "uses_success_level": True,
        "combat_rolls_can_be_pushed": False,
        "defense_options": ["dodge", "fight_back", "maneuver"],
        "attack_vs_dodge": {
            "attacker_requires_higher_success_level": True,
            "tie_winner": "defender",
            "both_fail_damage": False,
        },
        "attack_vs_fight_back": {
            "higher_success_level_wins": True,
            "tie_winner": "attacker",
            "both_fail_damage": False,
        },
        "maneuver": {
            "build_difference_impossible_at": 3,
            "penalty_die_per_build_difference": 1,
            "attack_vs_dodge_tie_winner": "target",
            "attack_vs_fight_back_tie_winner": "maneuver_actor",
        },
    }


def test_damage_rule_uses_structured_table():
    table = coc_rules.load_rule_table("damage")

    assert table["resource"] == "hit_points"
    assert coc_rules.damage_rule() == {
        "resource": "hit_points",
        "dice_kind": "damage",
        "requires_roll_id": True,
        "requires_die": True,
        "requires_roll_total": True,
        "requires_resource_before_delta_after": True,
        "delta_sign": "negative",
        "non_percentile": True,
    }


def test_reward_rule_uses_structured_table():
    table = coc_rules.load_rule_table("reward")

    assert table["resource"] == "sanity"
    assert coc_rules.reward_rule() == {
        "resource": "sanity",
        "dice_kind": "reward",
        "requires_roll_id": True,
        "requires_die": True,
        "requires_roll_total": True,
        "requires_resource_before_delta_after": True,
        "delta_sign": "positive",
        "non_percentile": True,
    }


def test_the_haunting_rules_use_structured_table():
    table = coc_rules.load_rule_table("the-haunting")

    assert table["scenario_id"] == "the-haunting"
    assert coc_rules.the_haunting_rules() == {
        "scenario_id": "the-haunting",
        "rules": {
            "corbitt_flesh_ward": {
                "source_rule_id": "module.haunting.corbitt_flesh_ward",
                "magic_point_cost_in_playtest": 2,
                "armor_dice_per_magic_point": "1D6",
                "duration_hours": 24,
                "requires_resource_change_event": True,
                "requires_armor_points": True,
            },
            "corbitt_floating_knife_mp": {
                "source_rule_id": "module.haunting.corbitt_floating_knife_mp",
                "magic_point_cost_per_combat_round": 1,
                "attacks_per_round": 1,
            },
            "corbitt_animate_body": {
                "source_rule_id": "module.haunting.corbitt_animate_body",
                "magic_point_cost": 2,
                "duration_combat_rounds": 5,
            },
            "corbitt_summary_bout": {
                "source_rule_id": "module.haunting.corbitt_summary_bout",
                "summary_table": "table_viii_summary",
                "summary_table_roll": "1D10",
                "alone_uses_summary_table": True,
                "playtest_summary_result": 4,
            },
            "corbitt_own_dagger": {
                "source_rule_id": "module.haunting.corbitt_own_dagger",
                "bypasses_spells": True,
                "requires_successful_attack": True,
                "result": "turns_to_ashes_and_dust",
            },
            "conclusion_sanity_reward": {
                "source_rule_id": "module.haunting.conclusion_sanity_reward",
                "requires_corbitt_destroyed": True,
                "sanity_reward_die": "1D6",
                "playtest_roll": 4,
            },
            "bed_attack_damage": {
                "source_rule_id": "module.haunting.bed_attack_damage",
                "precondition": "failed_dodge_after_spot_hidden",
                "damage_die": "1D6+2",
                "playtest_die_rolls": [3],
                "playtest_total": 5,
            },
            "basement_search_damage": {
                "source_rule_id": "module.haunting.basement_search_damage",
                "precondition": "failed_pushed_spot_hidden",
                "damage_die": "1D4+2",
                "playtest_die_rolls": [2],
                "playtest_total": 4,
            },
        },
    }


def test_success_level_uses_percentile_check_bounds(monkeypatch):
    def fake_percentile_check_rule():
        return {
            "die": "1D20",
            "minimum_roll": 10,
            "maximum_roll": 20,
            "minimum_target": 10,
            "maximum_target": 20,
            "success_if_roll_lte_effective_target": True,
            "zero_zero_result": 20,
        }

    monkeypatch.setattr(coc_rules, "percentile_check_rule", fake_percentile_check_rule, raising=False)

    with pytest.raises(ValueError, match="10 and 20"):
        coc_rules.success_level(5, 15)


def test_half_and_fifth_values_round_down():
    table = coc_rules.load_rule_table("half-fifth-values")

    assert table["half"]["divisor"] == 2
    assert table["fifth"]["divisor"] == 5
    assert coc_rules.half_value(55) == 27
    assert coc_rules.fifth_value(55) == 11
    assert coc_rules.half_value(100) == 50
    assert coc_rules.fifth_value(100) == 20


def test_half_and_fifth_values_use_structured_table(monkeypatch):
    def fake_load_rule_table(name: str):
        if name == "half-fifth-values":
            return {
                "half": {"divisor": 4, "rounding": "floor"},
                "fifth": {"divisor": 10, "rounding": "floor"},
            }
        return coc_rules.load_rule_table(name)

    monkeypatch.setattr(coc_rules, "load_rule_table", fake_load_rule_table)

    assert coc_rules.half_value(55) == 13
    assert coc_rules.fifth_value(55) == 5


def test_damage_bonus_and_build_use_structured_table():
    result = coc_rules.damage_bonus_build(60, 70)
    assert result == {
        "total": 130,
        "damage_bonus": "+1D4",
        "build": 1,
    }


def test_weapons_table_structure_and_schema():
    """Table XVII weapons.json (pp.401-405) loads with the expected shape."""
    table = coc_rules.load_rule_table("weapons")

    assert "Table XVII" in table["source_note"]
    assert "401-405" in table["source_note"]
    weapons = coc_rules.weapons_table()
    # Schema sanity on a melee row and a firearm row.
    knife = weapons["knife_medium"]
    assert knife["skill"] == "Fighting (Brawl)"
    assert knife["damage_die"] == "1D4+2"
    assert knife["adds_damage_bonus"] is True
    assert knife["impales"] is True
    revolver = weapons["revolver_38"]
    assert revolver["skill"] == "Firearms (Handgun)"
    assert revolver["damage_die"] == "1D10"
    assert revolver["adds_damage_bonus"] is False
    assert revolver["impales"] is True
    assert revolver["magazine"] == 6
    assert revolver["malfunction"] == 100
    # Shotguns carry range-banded damage.
    shotgun = weapons["shotgun_12g"]
    assert shotgun["range_banded_damage"] == {
        "point_blank": "4D6", "half": "2D6", "max": "1D6",
    }


def test_weapon_by_name_lookup_success_and_missing_key():
    """weapon_by_name returns the row for a known key and raises KeyError otherwise."""
    row = coc_rules.weapon_by_name("revolver_45")
    assert row["damage_die"] == "1D10+2"
    assert row["eras"] == ["1920s", "modern"]

    with pytest.raises(KeyError):
        coc_rules.weapon_by_name("nonexistent_weapon")


def test_characteristic_dice_table_structure_and_schema():
    """Chapter 3 characteristic dice (pp.30-31) load with the expected shape."""
    table = coc_rules.load_rule_table("characteristic-dice")

    assert "30-31" in table["source_note"]
    assert table["multiplier"] == 5
    assert table["luck_independent_of_pow"] is True
    dice = coc_rules.characteristic_dice()
    # 9 characteristics: STR/CON/SIZ/DEX/APP/INT/POW/EDU/Luck
    assert set(dice.keys()) == {
        "STR", "CON", "SIZ", "DEX", "APP", "INT", "POW", "EDU", "Luck",
    }
    # 3D6 characteristics (STR/CON/DEX/APP/POW/Luck)
    for name in ("STR", "CON", "DEX", "APP", "POW", "Luck"):
        assert dice[name]["dice"] == "3D6"
    # 2D6+6 characteristics (SIZ/INT/EDU)
    for name in ("SIZ", "INT", "EDU"):
        assert dice[name]["dice"] == "2D6+6"
    # Luck is flagged independent of POW.
    assert dice["Luck"]["independent_of_pow"] is True


def test_characteristic_dice_for_lookup_success_and_missing_key():
    """characteristic_dice_for returns the dice expr; raises KeyError otherwise."""
    assert coc_rules.characteristic_dice_for("SIZ") == "2D6+6"
    assert coc_rules.characteristic_dice_for("STR") == "3D6"
    assert coc_rules.characteristic_dice_for("Luck") == "3D6"

    with pytest.raises(KeyError):
        coc_rules.characteristic_dice_for("NONEXISTENT")


def test_movement_rate_uses_structured_table():
    table = coc_rules.load_rule_table("movement-rate")

    assert table["rules"][0]["base_mov"] == 7
    assert coc_rules.movement_rate(60, 55, 70) == {
        "rule_key": "both_str_and_dex_less_than_siz",
        "str_relation_to_siz": "less_than",
        "dex_relation_to_siz": "less_than",
        "base_mov": 7,
        "age_mov_penalty": 0,
        "mov": 7,
        "formula": "both STR and DEX lower than SIZ -> MOV 7",
    }
    assert coc_rules.movement_rate(65, 55, 65)["mov"] == 8
    assert coc_rules.movement_rate(80, 75, 65, age_mov_penalty=1)["mov"] == 8


def test_derived_attributes_rule_uses_structured_table():
    table = coc_rules.load_rule_table("derived-attributes")

    assert table["hit_points"]["divisor"] == 10
    assert coc_rules.derived_attributes_rule() == {
        "hit_points": {
            "sources": ["CON", "SIZ"],
            "divisor": 10,
            "rounding": "floor",
        },
        "magic_points": {
            "source": "POW",
            "divisor": 5,
            "rounding": "floor",
        },
        "sanity": {
            "source": "POW",
        },
        "luck_default": {
            "source": "rolled",
            "formula": "3D6",
            "multiplier": 5,
            "independent_of_pow": True,
        },
    }


def test_difficulty_target_uses_structured_table():
    table = coc_rules.load_rule_table("difficulty-levels")

    assert table["hard"]["divisor"] == 2
    assert coc_rules.difficulty_target(61, "regular") == 61
    assert coc_rules.difficulty_target(61, "hard") == 30
    assert coc_rules.difficulty_target(61, "extreme") == 12


def test_age_adjustment_uses_structured_table():
    table = coc_rules.load_rule_table("age-adjustments")

    assert table["minimum_age"] == 15
    assert table["brackets"][2]["key"] == "40-49"
    assert table["brackets"][2]["app_reduction"] == 5
    assert coc_rules.age_adjustment(47) == {
        "age": 47,
        "key": "40-49",
        "min_age": 40,
        "max_age": 49,
        "edu_improvement_checks": 2,
        "edu_reduction": 0,
        "characteristic_reduction_total": 5,
        "characteristic_reduction_choices": ["STR", "CON", "DEX"],
        "app_reduction": 5,
        "mov_penalty": 1,
        "luck_rolls_keep_highest": 1,
    }
    assert coc_rules.age_adjustment(32)["edu_improvement_checks"] == 1
    assert coc_rules.age_adjustment(84)["app_reduction"] == 25


def test_success_levels_include_fumbles_and_extreme_success():
    table = coc_rules.load_rule_table("success-levels")

    assert table["fumble"]["target_threshold"] == 50
    assert coc_rules.success_level(1, 65) == "critical"
    assert coc_rules.success_level(12, 65) == "extreme"
    assert coc_rules.success_level(31, 65) == "hard"
    assert coc_rules.success_level(60, 65) == "regular"
    assert coc_rules.success_level(80, 65) == "failure"
    assert coc_rules.success_level(100, 65) == "fumble"
    assert coc_rules.success_level(96, 40) == "fumble"


def test_success_level_uses_rules_json_fumble_threshold(monkeypatch):
    original_load_rule_table = coc_rules.load_rule_table

    def fake_load_rule_table(name: str):
        if name == "success-levels":
            return {
                "critical_roll": 1,
                "fumble": {
                    "target_threshold": 60,
                    "target_below_threshold": [96, 100],
                    "target_at_or_above_threshold": [100, 100],
                },
            }
        return original_load_rule_table(name)

    monkeypatch.setattr(coc_rules, "load_rule_table", fake_load_rule_table)

    assert coc_rules.success_level(96, 55) == "fumble"


def test_rule_index_exposes_stable_ids_for_playtest_traceability():
    ids = coc_rules.rule_ids()

    for rule_id in [
        "core.percentile_check",
        "core.percentile_check.roll_modifiers",
        "core.difficulty.regular",
        "core.success_level",
        "core.character_creation.derived_attributes",
        "core.character_creation.damage_bonus_build",
        "core.character_creation.movement_rate",
        "core.character_creation.occupations",
        "core.character_creation.characteristic_dice",
        "core.pushed_roll",
        "core.sanity.temporary_insanity_threshold",
        "core.chase.movement_actions",
        "core.chase.no_pushed_rolls",
        "core.combat.weapons",
        "core.magic.spell_schema",
        "core.magic.casting",
        "core.magic.learning",
        "core.magic.mp_economy",
        "core.tomes.stat_block",
        "core.monsters.stat_block",
        "core.sanity.bout_realtime",
        "core.sanity.bout_summary",
        "core.sanity.phobia",
        "core.sanity.mania",
        "core.equipment.price_list",
        "core.combat.poisons",
        "core.artifacts.alien_device",
        "module.haunting.corbitt_flesh_ward",
        "module.haunting.corbitt_floating_knife_mp",
        "module.haunting.corbitt_animate_body",
        "module.haunting.corbitt_own_dagger",
    ]:
        assert rule_id in ids


def test_occupations_table_structure():
    """occupations_table returns the Chapter 3 Sample Occupations."""
    table = coc_rules.occupations_table()
    assert isinstance(table, dict)
    assert "Journalist" in table
    j = table["Journalist"]
    assert j["credit_rating_range"] == [9, 30]
    assert j["skill_point_formula"] == "EDU*4"
    assert "lovecraftian" in j["tags"]


def test_occupation_by_name_success_and_missing_key():
    """occupation_by_name returns the row for a known occupation."""
    row = coc_rules.occupation_by_name("Doctor of Medicine")
    assert row["credit_rating_range"] == [30, 80]
    assert "First Aid" in row["occupational_skills"]

    with pytest.raises(KeyError):
        coc_rules.occupation_by_name("Nonexistent Job")


def test_spells_table_structure():
    """spells_table returns the Grimoire data with mechanics + spell list."""
    table = coc_rules.spells_table()
    assert "casting" in table
    assert "learning" in table
    assert "mp_economy" in table
    assert "spells" in table
    assert isinstance(table["spells"], list)
    assert len(table["spells"]) >= 50
    # Verify casting mechanics
    assert table["casting"]["first_cast_roll"] == "Hard POW"
    assert table["casting"]["pushable"] is True
    # Verify mp economy
    assert table["mp_economy"]["initial"] == "POW/5 floor"


def test_spell_by_name_success_and_missing_key():
    """spell_by_name returns the row for a known spell and raises KeyError otherwise."""
    row = coc_rules.spell_by_name("Flesh Ward")
    assert row["cost_sanity"] == "1D4"
    assert row["source_page"] == 253

    row2 = coc_rules.spell_by_name("Dominate")
    assert row2["cost_mp"] == "1"

    with pytest.raises(KeyError):
        coc_rules.spell_by_name("Nonexistent Spell")


def test_magic_mechanic_accessors():
    """Casting, learning, and MP economy accessors return structured blocks."""
    casting = coc_rules.magic_casting_rules()
    assert casting["first_cast_roll"] == "Hard POW"
    assert casting["push_mp_multiplier"] == "1D6"

    learning = coc_rules.magic_learning_rules()
    assert learning["roll"] == "Hard INT"
    assert learning["from_tome_weeks"] == "2D6"

    mp = coc_rules.magic_mp_economy()
    assert mp["regen_per_hour"] == 1
    assert mp["after_zero_costs_hp_one_for_one"] is True


def test_tomes_table_structure():
    """tomes_table returns the Eldritch Tomes data (dict keyed by name)."""
    table = coc_rules.tomes_table()
    assert isinstance(table, dict)
    assert len(table) >= 15
    # Verify Necronomicon sentinel exists
    assert any("Necronomicon" in n for n in table)


def test_tome_by_name_success_and_missing_key():
    """tome_by_name returns the row for a known tome and raises KeyError otherwise."""
    row = coc_rules.tome_by_name("Necronomicon")
    assert "sanity_cost" in row
    assert isinstance(row.get("full_study_weeks"), int)

    with pytest.raises(KeyError):
        coc_rules.tome_by_name("Nonexistent Tome")


def test_tomes_table_structure():
    """tomes_table returns the Chapter 11 Mythos Tomes table."""
    table = coc_rules.tomes_table()
    assert isinstance(table, dict)
    assert len(table) >= 30
    # Check a well-known tome
    al_azif = [k for k in table if "Al Azif" in k]
    assert len(al_azif) >= 1
    t = table[al_azif[0]]
    assert t["sanity_cost"] == "2D10"
    assert t["cthulhu_mythos_full"] == 12


def test_tome_by_name_success_and_missing_key():
    """tome_by_name returns the row for a known tome and raises KeyError otherwise."""
    # Find the Necronomicon
    necro = [k for k in coc_rules.tomes_table() if "Necronomicon" in k]
    assert len(necro) >= 1
    row = coc_rules.tome_by_name(necro[0])
    assert "sanity_cost" in row
    assert "mythos_rating" in row

    with pytest.raises(KeyError):
        coc_rules.tome_by_name("Nonexistent Tome of Doom")



def test_monsters_table_structure():
    table = coc_rules.monsters_table()
    assert isinstance(table, dict)
    assert len(table) >= 5


def test_bout_tables_structure():
    rt = coc_rules.bout_realtime_table()
    sm = coc_rules.bout_summary_table()
    assert len(rt) == 10
    assert len(sm) == 10
    assert rt[0]["d10_roll"] == 1


def test_phobias_and_manias_structure():
    ph = coc_rules.phobias_table()
    ma = coc_rules.manias_table()
    assert len(ph) >= 10
    assert len(ma) >= 5
    assert "Claustrophobia" in ph


def test_equipment_and_poisons_and_artifacts():
    eq = coc_rules.equipment_table()
    assert "1920s" in eq
    po = coc_rules.poisons_table()
    assert len(po) >= 5
    ar = coc_rules.artifacts_table()
    assert len(ar) >= 3


def test_damage_bonus_build_extrapolation_above_524():
    # Totals at or below 524 follow the fixed table (sanity-check unchanged).
    assert coc_rules.damage_bonus_build(300, 200) == {
        "total": 500,
        "damage_bonus": "+5D6",
        "build": 6,
    }
    # 525 is the first extrapolated step beyond 524: +1 step.
    result = coc_rules.damage_bonus_build(300, 225)
    assert result["total"] == 525
    assert result["damage_bonus"] == "+6D6"
    assert result["build"] == 7
    # 604 is still within the first 80-point band (525-604), so still +6D6.
    result = coc_rules.damage_bonus_build(300, 304)
    assert result["total"] == 604
    assert result["damage_bonus"] == "+6D6"
    assert result["build"] == 7
    # 605 begins the second 80-point band: +2 steps.
    result = coc_rules.damage_bonus_build(302, 303)
    assert result["total"] == 605
    assert result["damage_bonus"] == "+7D6"
    assert result["build"] == 8


def test_sanity_max_formula_uses_structured_table():
    block = coc_rules.sanity_max_formula()
    assert block["formula"] == "99 - cthulhu_mythos"
    assert block["base_max"] == 99


def test_luck_rule_uses_structured_table():
    rule = coc_rules.luck_rule()
    assert rule["spend"]["luck_point_value"] == 1
    assert rule["spend"]["cost_per_point_off_roll"] == 1
    assert rule["roll"]["group_roll_policy"] == "take_lowest"
    assert rule["recovery"]["gain_on_success"] == "1D10"
    assert rule["recovery"]["cap"] == 99
    assert rule["recovery"]["optional_rule"] is True


def test_development_rule_uses_structured_table():
    rule = coc_rules.development_rule()
    assert rule["tick"]["awarded_when"] == "regular_or_hard_or_extreme_success"
    assert rule["tick"]["ticks_per_qualifying_success"] == 1
    assert "opposed_roll_loser" in rule["tick"]["excluded_outcomes"]
    assert rule["improvement_roll"]["gain_on_success"] == "1D10"
    assert rule["improvement_roll"]["cap_for_san_reward"] == 90


def test_rule_index_exposes_luck_and_development_and_max_san_ids():
    ids = coc_rules.rule_ids()
    for rule_id in [
        "core.luck.spend",
        "core.luck.roll",
        "core.luck.recovery",
        "core.development.tick",
        "core.development.improvement_roll",
        "core.sanity.max_formula",
    ]:
        assert rule_id in ids, f"missing rule-id: {rule_id}"
