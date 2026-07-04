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
        "core.pushed_roll",
        "core.sanity.temporary_insanity_threshold",
        "core.chase.movement_actions",
        "module.haunting.corbitt_flesh_ward",
        "module.haunting.corbitt_floating_knife_mp",
        "module.haunting.corbitt_animate_body",
        "module.haunting.corbitt_own_dagger",
    ]:
        assert rule_id in ids
