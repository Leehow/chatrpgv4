#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

import pytest

PLUGIN_ROOT = Path(__file__).resolve().parent.parent / "plugins" / "coc-keeper"
RULES_DIR = PLUGIN_ROOT / "rulesets" / "coc7" / "rules-json"


@pytest.fixture()
def white_war_table():
    return json.loads((RULES_DIR / "the-white-war.json").read_text(encoding="utf-8"))


def test_top_level_structure(white_war_table):
    assert white_war_table["scenario_id"] == "the-white-war"
    assert white_war_table["module_title"] == "The White War"
    assert "source_note" in white_war_table
    assert isinstance(white_war_table["rules"], dict)
    assert isinstance(white_war_table["weapons"], list)


def test_polyp_horror_stat_block_is_ogc_faithful(white_war_table):
    """Polyp Horror 数值忠实于 OGC (PDF p8-10)，属 Open Game Content。"""
    horror = white_war_table["rules"]["polyp_horror"]
    assert horror["source_rule_id"] == "module.white_war.polyp_horror"
    assert horror["str"] == 100
    assert horror["con"] == 100
    assert horror["dex"] == 15
    assert horror["int"] == 25
    assert horror["pow"] == 30
    assert horror["hp"] == 100
    assert horror["san_loss"] == "1D6/1D12"
    assert horror["retreat_below_hp"] == 20
    assert horror["size_bonus_percent"] == 20


def test_rule_ids_all_lowercase_dotted(white_war_table):
    r"""所有 source_rule_id 符合 rule-index 正则 ^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$"""
    import re
    pattern = re.compile(r"^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$")
    for key, rule in white_war_table["rules"].items():
        rid = rule["source_rule_id"]
        assert pattern.match(rid), f"rule id {rid} 不符合正则"
        assert rid.startswith("module.white_war."), f"rule id {rid} 命名空间错误"


def test_cold_exposure_rule_present(white_war_table):
    cold = white_war_table["rules"]["cold_exposure"]
    assert cold["source_rule_id"] == "module.white_war.cold_exposure"
    assert cold["outdoor_temp_celsius"] == -30
    assert cold["hp_damage_per_interval"] == "1D8"
    assert cold["interval_minutes"] == 5


def test_weapons_have_7e_stats(white_war_table):
    """武器转成 7e 约定：每件有 weapon_id/name/damage/range。"""
    for w in white_war_table["weapons"]:
        assert "weapon_id" in w
        assert "name" in w
        assert "damage" in w
    ids = {w["weapon_id"] for w in white_war_table["weapons"]}
    assert "mannlicher_carcano_rifle" in ids
    assert "beretta_9mm_pistol" in ids


def test_rule_index_contains_white_war_entries():
    """所有 module.white_war.* 规则登记进 rule-index.json。"""
    index = json.loads((RULES_DIR / "rule-index.json").read_text(encoding="utf-8"))
    ids = {r["id"] for r in index["rules"]}
    expected = {
        "module.white_war.polyp_horror",
        "module.white_war.cold_exposure",
        "module.white_war.lethality_vs_semi_material",
        "module.white_war.daylight_penalty",
        "module.white_war.conclusion_sanity_rewards",
        "module.white_war.avalanche_damage",
    }
    missing = expected - ids
    assert not missing, f"rule-index 缺少: {missing}"


def test_rule_index_white_war_entries_have_correct_source_table():
    index = json.loads((RULES_DIR / "rule-index.json").read_text(encoding="utf-8"))
    for r in index["rules"]:
        if r["id"].startswith("module.white_war."):
            assert r["source_table"] == "the-white-war.json", f"{r['id']} source_table 错误"
            assert r["category"] == "module_rule", f"{r['id']} category 错误"
            assert r["module"] == "The White War", f"{r['id']} module 字段错误"


def test_required_rule_files_includes_white_war():
    """coc_validate.py 的 REQUIRED_RULE_FILES 必须含 the-white-war.json，否则校验报 missing。"""
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "coc_validate", PLUGIN_ROOT / "scripts" / "coc_validate.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert "the-white-war.json" in mod.REQUIRED_RULE_FILES


def test_module_rules_loads_by_scenario_id():
    """module_rules('the-white-war') 应返回该模组的 rules dict。"""
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "coc_rules", PLUGIN_ROOT / "scripts" / "coc_rules.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    result = mod.module_rules("the-white-war")
    assert result["scenario_id"] == "the-white-war"
    assert "polyp_horror" in result["rules"]


def test_the_haunting_rules_backward_compat():
    """the_haunting_rules() 薄包装仍可用。"""
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "coc_rules", PLUGIN_ROOT / "scripts" / "coc_rules.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    result = mod.the_haunting_rules()
    assert result["scenario_id"] == "the-haunting"
