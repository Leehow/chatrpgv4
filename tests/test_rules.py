import importlib.util
from pathlib import Path


def load_module(name: str, relative_path: str):
    path = Path(relative_path)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_rules = load_module("coc_rules", "plugins/coc-keeper/scripts/coc_rules.py")


def test_half_and_fifth_values_round_down():
    assert coc_rules.half_value(55) == 27
    assert coc_rules.fifth_value(55) == 11
    assert coc_rules.half_value(100) == 50
    assert coc_rules.fifth_value(100) == 20


def test_damage_bonus_and_build_use_structured_table():
    result = coc_rules.damage_bonus_build(60, 70)
    assert result == {
        "total": 130,
        "damage_bonus": "+1D4",
        "build": 1,
    }


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
    assert coc_rules.success_level(1, 65) == "critical"
    assert coc_rules.success_level(12, 65) == "extreme"
    assert coc_rules.success_level(31, 65) == "hard"
    assert coc_rules.success_level(60, 65) == "regular"
    assert coc_rules.success_level(80, 65) == "failure"
    assert coc_rules.success_level(100, 65) == "fumble"
    assert coc_rules.success_level(96, 40) == "fumble"


def test_rule_index_exposes_stable_ids_for_playtest_traceability():
    ids = coc_rules.rule_ids()

    for rule_id in [
        "core.percentile_check",
        "core.difficulty.regular",
        "core.success_level",
        "core.character_creation.movement_rate",
        "core.pushed_roll",
        "core.sanity.temporary_insanity_threshold",
        "core.chase.movement_actions",
        "module.haunting.corbitt_flesh_ward",
        "module.haunting.corbitt_floating_knife_mp",
        "module.haunting.corbitt_animate_body",
        "module.haunting.corbitt_own_dagger",
    ]:
        assert rule_id in ids
