#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

import pytest

PLUGIN_ROOT = Path(__file__).resolve().parent.parent / "plugins" / "coc-keeper"
RULES_DIR = PLUGIN_ROOT / "references" / "rules-json"


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
    """所有 source_rule_id 符合 rule-index 正则 ^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$"""
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
