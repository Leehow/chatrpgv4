#!/usr/bin/env python3
"""Tests for the final two subsystems:

1. read_failed_san_involuntary (p.166) -- the 5 involuntary-action kinds.
2. read_believer_bomb (p.179) -- augmented return shape (is_believer +
   pending-loss model coexist).
3. Vehicle stats + vehicular collisions (Table V p.145-146, Table VI p.147).
4. Engine-state readers (read_sanity_engine_state / read_chase_state) and
   their wiring into build_director_context.
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


coc_rule_signals = _load("coc_rule_signals", "coc_rule_signals.py")
coc_chase = _load("coc_chase", "coc_chase.py")


# --------------------------------------------------------------------------- #
# 1. read_failed_san_involuntary
# --------------------------------------------------------------------------- #
def test_failed_san_involuntary_returns_one_of_five_kinds():
    kinds_seen = set()
    for seed in range(1, 200):
        sig = coc_rule_signals.read_failed_san_involuntary(
            san_lost=2, rng=random.Random(seed)
        )
        assert sig["implemented"] is True
        assert sig["kind"] in (
            "jump_in_fright", "cry_out", "involuntary_movement",
            "involuntary_combat_action", "freeze",
        )
        assert isinstance(sig["description"], str) and sig["description"]
        kinds_seen.add(sig["kind"])
    # Random pick across 200 seeds should hit all five kinds.
    assert kinds_seen == {
        "jump_in_fright", "cry_out", "involuntary_movement",
        "involuntary_combat_action", "freeze",
    }


def test_failed_san_involuntary_respects_keeper_subset():
    # Keeper constrains to a single kind.
    sig = coc_rule_signals.read_failed_san_involuntary(
        san_lost=1, involuntary_kinds=["freeze"], rng=random.Random(1)
    )
    assert sig["kind"] == "freeze"


def test_failed_san_involuntary_subset_picks_only_from_candidates():
    for seed in range(1, 100):
        sig = coc_rule_signals.read_failed_san_involuntary(
            san_lost=1,
            involuntary_kinds=["cry_out", "freeze"],
            rng=random.Random(seed),
        )
        assert sig["kind"] in ("cry_out", "freeze")


def test_failed_san_involuntary_unknown_kinds_fall_back_to_all():
    sig = coc_rule_signals.read_failed_san_involuntary(
        san_lost=1, involuntary_kinds=["bogus_kind"], rng=random.Random(1)
    )
    assert sig["implemented"] is True
    assert sig["kind"] in (
        "jump_in_fright", "cry_out", "involuntary_movement",
        "involuntary_combat_action", "freeze",
    )


def test_failed_san_involuntary_carries_san_lost():
    sig = coc_rule_signals.read_failed_san_involuntary(
        san_lost=4, rng=random.Random(1)
    )
    assert sig["san_lost"] == 4
    assert sig["rule_ref"] == "core.sanity.failure_involuntary_action"


# --------------------------------------------------------------------------- #
# 2. read_believer_bomb (augmented shape)
# --------------------------------------------------------------------------- #
def test_read_believer_bomb_pending_loss_model_preserved():
    # Existing behaviour must remain: pending_san_loss + resulting_san.
    sig = coc_rule_signals.read_believer_bomb(cm_value=15, current_san=50)
    assert sig["implemented"] is True
    assert sig["pending_san_loss"] == 15
    assert sig["resulting_san"] == 35
    assert sig["would_be_permanently_insane"] is False


def test_read_believer_bomb_new_believer_shape():
    sig = coc_rule_signals.read_believer_bomb(cm_value=15, current_san=50, is_first=True)
    assert sig["is_believer"] is True
    assert sig["san_loss_pending"] == "see_source"
    assert sig["cm_gain"] == 5  # first encounter


def test_read_believer_bomb_subsequent_cm_gain_is_one():
    sig = coc_rule_signals.read_believer_bomb(cm_value=10, current_san=60, is_first=False)
    assert sig["is_believer"] is True
    assert sig["cm_gain"] == 1


def test_read_believer_bomb_already_believer():
    sig = coc_rule_signals.read_believer_bomb(
        cm_value=10, current_san=50, already_believer=True
    )
    assert sig["is_believer"] is True
    assert sig["already_believer"] is True
    assert sig["pending_san_loss"] == 0
    assert sig["resulting_san"] == 50


def test_read_believer_bomb_cm_zero_not_believer():
    sig = coc_rule_signals.read_believer_bomb(cm_value=0, current_san=50)
    assert sig["is_believer"] is False
    assert "pending_san_loss" not in sig or sig.get("pending_san_loss", 0) == 0


def test_read_believer_bomb_permanent_insanity_flag():
    sig = coc_rule_signals.read_believer_bomb(cm_value=60, current_san=40)
    assert sig["resulting_san"] == 0
    assert sig["would_be_permanently_insane"] is True


# --------------------------------------------------------------------------- #
# 3. Vehicle stats + vehicular collisions
# --------------------------------------------------------------------------- #
def test_get_vehicle_stats_known_vehicle():
    # Table V p.145: motorcycle alias → motorcycle_light (MOV 13, Build 1).
    stats = coc_chase.get_vehicle_stats("motorcycle")
    assert stats["vehicle"] == "motorcycle_light"
    assert stats["mov"] == 13
    assert stats["build"] == 1
    assert stats["armor"] == 0
    assert stats["passengers"] == 1


def test_get_vehicle_stats_case_insensitive():
    stats = coc_chase.get_vehicle_stats("Car_Standard")
    assert stats["vehicle"] == "car_standard"
    assert stats["mov"] == 14
    assert stats["build"] == 5


def test_get_vehicle_stats_unknown_raises():
    with pytest.raises(KeyError):
        coc_chase.get_vehicle_stats("hovercraft")


def test_vehicle_collision_severe_tier_ranges():
    # Severe: 1D10 build, 2D6 passenger.
    for seed in range(1, 100):
        res = coc_chase.vehicle_collision("severe", rng=random.Random(seed))
        assert res["severity"] == "severe"
        assert 0 <= res["build_damage"] <= 10
        assert 2 <= res["passenger_damage"] <= 12
        assert isinstance(res["description"], str) and res["description"]
        assert res["rule_ref"] == "core.chase.vehicular_collisions"


def test_vehicle_collision_minor_can_be_zero_build():
    # Minor: 1D3-1 build -> 0..2.
    seen_zero = False
    for seed in range(1, 200):
        res = coc_chase.vehicle_collision("minor", rng=random.Random(seed))
        assert res["severity"] == "minor"
        assert 0 <= res["build_damage"] <= 2
        if res["build_damage"] == 0:
            seen_zero = True
    assert seen_zero


def test_vehicle_collision_mayhem_2d10():
    for seed in range(1, 100):
        res = coc_chase.vehicle_collision("mayhem", rng=random.Random(seed))
        assert 2 <= res["build_damage"] <= 20
        assert 3 <= res["passenger_damage"] <= 18


def test_vehicle_collision_roadkill_5d10_build():
    for seed in range(1, 100):
        res = coc_chase.vehicle_collision("roadkill", rng=random.Random(seed))
        assert 5 <= res["build_damage"] <= 50


def test_vehicle_collision_unknown_severity_uses_default():
    res = coc_chase.vehicle_collision("cataclysm", rng=random.Random(1))
    assert res["severity"] == "moderate"  # default


def test_vehicle_collision_moderate_ranges():
    for seed in range(1, 100):
        res = coc_chase.vehicle_collision("moderate", rng=random.Random(seed))
        assert 1 <= res["build_damage"] <= 6
        assert 1 <= res["passenger_damage"] <= 6


# --------------------------------------------------------------------------- #
# 4. Engine-state readers
# --------------------------------------------------------------------------- #
@pytest.fixture
def campaign(tmp_path):
    return tmp_path / "campaign"


def test_read_sanity_engine_state_empty_when_no_file(campaign):
    sig = coc_rule_signals.read_sanity_engine_state(campaign, "inv1")
    assert sig["has_state"] is False
    assert sig["investigator_id"] == "inv1"
    assert sig["current_san"] is None
    assert sig["bout_active"] is False


def test_read_sanity_engine_state_from_investigator_state(campaign):
    d = campaign / "save" / "investigator-state"
    d.mkdir(parents=True)
    (d / "inv1.json").write_text(json.dumps({
        "investigator_id": "inv1",
        "current_san": 55,
        "max_san": 89,
        "cm_value": 10,
        "conditions": ["bout_active"],
        "daily_san_lost": 6,
        "phobia": "arachnophobia",
    }))
    sig = coc_rule_signals.read_sanity_engine_state(campaign, "inv1")
    assert sig["has_state"] is True
    assert sig["current_san"] == 55
    assert sig["max_san"] == 89
    assert sig["cm_value"] == 10
    assert sig["bout_active"] is True
    assert sig["daily_san_lost"] == 6
    assert sig["phobia"] == "arachnophobia"


def test_read_sanity_engine_state_falls_back_to_sanity_snapshot(campaign):
    save = campaign / "save"
    save.mkdir(parents=True)
    (save / "sanity.json").write_text(json.dumps({
        "investigator_id": "inv1",
        "san_current": 40,
        "san_max": 90,
        "cm_value": 5,
        "temporary_insane": True,
        "temporary_insane_remaining_hours": 3,
        "conditions": [],
        "daily_san_lost": 2,
    }))
    sig = coc_rule_signals.read_sanity_engine_state(campaign, "inv1")
    assert sig["has_state"] is True
    assert sig["current_san"] == 40
    assert sig["max_san"] == 90
    assert sig["temporary_insane"] is True
    assert sig["temporary_insane_remaining_hours"] == 3


def test_read_chase_state_inactive_when_no_file(campaign):
    sig = coc_rule_signals.read_chase_state(campaign)
    assert sig["active"] is False


def test_read_chase_state_active(campaign):
    save = campaign / "save"
    save.mkdir(parents=True)
    (save / "chase.json").write_text(json.dumps({
        "chase_id": "ch1",
        "status": "active",
        "outcome": None,
        "participants": [
            {"actor_id": "inv1", "side": "pursuer", "mov_adjusted": 4,
             "position": 1, "escaped": False, "captured": False, "is_vehicle": False},
        ],
        "rounds": [{"round": 2, "dex_order": ["inv1"], "turns": []}],
    }))
    sig = coc_rule_signals.read_chase_state(campaign)
    assert sig["active"] is True
    assert sig["chase_id"] == "ch1"
    assert sig["round"] == 2
    assert sig["outcome"] is None
    assert sig["participants"][0]["actor_id"] == "inv1"


def test_read_chase_state_concluded(campaign):
    save = campaign / "save"
    save.mkdir(parents=True)
    (save / "chase.json").write_text(json.dumps({
        "chase_id": "ch2", "status": "concluded", "outcome": "escaped",
        "participants": [], "rounds": [],
    }))
    sig = coc_rule_signals.read_chase_state(campaign)
    assert sig["active"] is False
    assert sig["outcome"] == "escaped"


# --------------------------------------------------------------------------- #
# 5. Director wiring
# --------------------------------------------------------------------------- #
def test_build_director_context_includes_engine_signals(tmp_path):
    coc_story_director = _load("coc_story_director", "coc_story_director.py")
    campaign = tmp_path / "campaign"
    (campaign / "save" / "investigator-state").mkdir(parents=True)
    (campaign / "save" / "investigator-state" / "inv1.json").write_text(json.dumps({
        "current_san": 60, "max_san": 90, "cm_value": 5,
        "conditions": [], "daily_san_lost": 0,
    }))
    (campaign / "scenario").mkdir(parents=True)
    char_path = tmp_path / "investigators" / "inv1" / "character.json"
    char_path.parent.mkdir(parents=True)
    char_path.write_text(json.dumps({
        "derived": {"HP": 12, "Luck": 50, "SAN": 60},
        "characteristics": {"APP": 50},
        "skills": {"Credit Rating": 30},
    }))

    ctx = coc_story_director.build_director_context(
        campaign_dir=campaign,
        character_path=char_path,
        investigator_id="inv1",
        player_intent="look around",
        player_intent_class="investigate",
    )
    assert ctx["sanity_engine_state"] is not None
    assert ctx["sanity_engine_state"]["current_san"] == 60
    assert ctx["chase_state"] is not None
    assert ctx["chase_state"]["active"] is False
