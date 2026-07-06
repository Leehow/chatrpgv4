#!/usr/bin/env python3
"""Tests for the MP economy layer (coc_mp.py).

Validates: pool init (POW//5), spend + overspill to HP, regeneration rate
(1/hr, 2/hr if POW>100) with cap, investigator-state persistence, and the
coc_time downtime-trigger integration.
"""
from __future__ import annotations

import importlib.util
import json
import random
from pathlib import Path

import pytest


PLUGIN_ROOT = Path("plugins/coc-keeper")


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, PLUGIN_ROOT / "scripts" / rel)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


coc_mp = _load("coc_mp", "coc_mp.py")


# --------------------------------------------------------------------------- #
# Pool initialization
# --------------------------------------------------------------------------- #
def test_pool_init_is_pow_div_5():
    pool = coc_mp.MPool("inv1", pow_value=60)
    assert pool.mp_max == 12  # 60 // 5
    assert pool.current_mp == 12


def test_pool_init_floors_pow_div_5():
    pool = coc_mp.MPool("inv1", pow_value=63)
    assert pool.mp_max == 12  # 63 // 5 == 12 (floor)
    assert pool.current_mp == 12


def test_regen_rate_normal():
    pool = coc_mp.MPool("inv1", pow_value=60)
    assert pool.regen_per_hour == 1


def test_regen_rate_double_for_high_pow():
    pool = coc_mp.MPool("inv1", pow_value=120)
    assert pool.regen_per_hour == 2


# --------------------------------------------------------------------------- #
# spend_mp
# --------------------------------------------------------------------------- #
def test_spend_within_pool():
    pool = coc_mp.MPool("inv1", pow_value=50)  # mp_max=10
    ev = pool.spend_mp(4, source="castVOKE")
    assert pool.current_mp == 6
    assert ev["mp_before"] == 10
    assert ev["mp_after"] == 6
    assert ev["overspill_to_hp"] == 0


def test_spend_exactly_to_zero():
    pool = coc_mp.MPool("inv1", pow_value=50)  # mp_max=10
    pool.spend_mp(10)
    assert pool.current_mp == 0


def test_spend_overspills_to_hp():
    """When MP < 0, the deficit goes to HP 1:1 (p.137)."""
    pool = coc_mp.MPool("inv1", pow_value=50, current_hp=14)  # mp_max=10
    ev = pool.spend_mp(13, source="overcast")
    assert pool.current_mp == 0  # clamped at 0
    assert pool.current_hp == 11  # 14 - 3 overspill
    assert ev["overspill_to_hp"] == 3
    assert ev["hp_damage"] == 3


def test_can_spend_within_pool():
    pool = coc_mp.MPool("inv1", pow_value=50, current_hp=10)
    assert pool.can_spend(8) is True


def test_can_spend_rejects_fatal_overspill():
    """If overspill would kill (HP -> 0 or below), can_spend is False."""
    pool = coc_mp.MPool("inv1", pow_value=50, current_hp=2)  # mp_max=10
    # spending 20 -> overspill 10, HP would go to -8 (fatal)
    assert pool.can_spend(20) is False


def test_spend_without_hp_tracker_still_records_overspill():
    """If no HP tracker, overspill is recorded but HP not modified."""
    pool = coc_mp.MPool("inv1", pow_value=50)  # no current_hp
    ev = pool.spend_mp(13)
    assert pool.current_mp == 0
    assert ev["overspill_to_hp"] == 3
    assert ev["hp_damage"] == 0  # no HP tracker to damage


# --------------------------------------------------------------------------- #
# regen_mp
# --------------------------------------------------------------------------- #
def test_regen_capped_at_mp_max():
    pool = coc_mp.MPool("inv1", pow_value=50)  # mp_max=10
    pool.current_mp = 9
    gained = pool.regen_mp(5)  # would gain 5, but cap is 10
    assert gained == 1
    assert pool.current_mp == 10


def test_regen_proportional_to_hours():
    pool = coc_mp.MPool("inv1", pow_value=60)  # mp_max=12, 1/hr
    pool.current_mp = 0
    gained = pool.regen_mp(8)
    assert gained == 8
    assert pool.current_mp == 8


def test_regen_double_rate_for_high_pow():
    pool = coc_mp.MPool("inv1", pow_value=120)  # 2/hr
    pool.current_mp = 0
    gained = pool.regen_mp(3)
    assert gained == 6


def test_regen_zero_hours_is_noop():
    pool = coc_mp.MPool("inv1", pow_value=60)
    pool.current_mp = 5
    assert pool.regen_mp(0) == 0
    assert pool.current_mp == 5


# --------------------------------------------------------------------------- #
# Persistence (investigator-state merge)
# --------------------------------------------------------------------------- #
@pytest.fixture
def campaign(tmp_path):
    camp = tmp_path / "campaign"
    (camp / "save" / "investigator-state").mkdir(parents=True)
    (camp / "logs").mkdir(parents=True)
    return camp


def test_save_writes_mp_into_investigator_state(campaign):
    pool = coc_mp.MPool("inv1", pow_value=50, current_hp=12)
    pool.spend_mp(3)
    path = pool.save(campaign)
    assert path.exists()
    data = json.loads(path.read_text())
    assert data["mp"] == 7
    assert data["mp_max"] == 10
    assert data["current_hp"] == 12


def test_save_merges_with_existing_state(campaign):
    """save() must not clobber other investigator-state fields."""
    path = campaign / "save" / "investigator-state" / "inv1.json"
    path.write_text(json.dumps({
        "schema_version": 1, "investigator_id": "inv1",
        "current_hp": 12, "current_san": 55, "conditions": [],
    }))
    pool = coc_mp.MPool("inv1", pow_value=50)
    pool.save(campaign)
    data = json.loads(path.read_text())
    assert data["mp"] == 10
    assert data["current_san"] == 55  # preserved
    assert data["conditions"] == []   # preserved


def test_load_reconstructs_pool(campaign):
    pool = coc_mp.MPool("inv1", pow_value=50, current_hp=12)
    pool.spend_mp(4)
    pool.save(campaign)
    loaded = coc_mp.MPool.load(campaign, "inv1", pow_value=50)
    assert loaded.current_mp == 6
    assert loaded.mp_max == 10
    assert loaded.current_hp == 12


def test_persist_events_appends_to_events_jsonl(campaign):
    pool = coc_mp.MPool("inv1", pow_value=50)
    pool.spend_mp(2)
    pool.persist_events(campaign)
    log = (campaign / "logs" / "events.jsonl").read_text().strip()
    assert "mp_spend" in log


# --------------------------------------------------------------------------- #
# coc_time integration: handle_time_trigger
# --------------------------------------------------------------------------- #
def test_handle_time_trigger_regenerates_and_persists(campaign):
    # seed an investigator-state with depleted MP
    coc_mp._write_inv_state(campaign, "inv1", {
        "schema_version": 1, "investigator_id": "inv1",
        "current_hp": 12, "mp": 2, "mp_max": 10, "pow_value": 50,
    })
    gained = coc_mp.handle_time_trigger(
        campaign, "inv1", pow_value=50, delta_minutes=480, source="sleep_night"
    )
    assert gained == 8  # 8 hours * 1/hr, capped at 10 -> gained 8
    data = json.loads((campaign / "save" / "investigator-state" / "inv1.json").read_text())
    assert data["mp"] == 10
    log = (campaign / "logs" / "events.jsonl").read_text()
    assert "mp_regen" in log


def test_handle_time_trigger_zero_minutes_is_noop(campaign):
    coc_mp._write_inv_state(campaign, "inv1", {
        "investigator_id": "inv1", "mp": 5, "mp_max": 10})
    gained = coc_mp.handle_time_trigger(
        campaign, "inv1", pow_value=50, delta_minutes=0)
    assert gained == 0
