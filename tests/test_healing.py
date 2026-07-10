#!/usr/bin/env python3
"""Tests for the healing/recovery layer (coc_healing.py).

Validates: First Aid (+1 HP, push, once-per-wound), Medicine (+1D3, hard if
not same day), weekly_recovery (1 HP/day; major wound CON roll rate), HP
capping, persistence, and the coc_time downtime-trigger integration.
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


coc_healing = _load("coc_healing", "coc_healing.py")


def _roll(outcome: str) -> dict:
    """A pre-resolved skill roll result with a given outcome."""
    return {"outcome": outcome, "roll": 50, "target": 60, "effective_target": 60,
            "difficulty": "regular", "bonus": 0, "penalty": 0}


# --------------------------------------------------------------------------- #
# First Aid (p.119)
# --------------------------------------------------------------------------- #
def test_first_aid_success_heals_one_hp():
    sess = coc_healing.HealingSession("inv1", hp_max=12, con_value=60, current_hp=8)
    ev = sess.first_aid(skill_value=60, skill_roll_result=_roll("regular"))
    assert sess.current_hp == 9
    assert ev["hp_gained"] == 1


def test_first_aid_failure_heals_nothing():
    sess = coc_healing.HealingSession("inv1", hp_max=12, con_value=60, current_hp=8)
    ev = sess.first_aid(skill_value=60, skill_roll_result=_roll("failure"))
    assert sess.current_hp == 8
    assert ev["hp_gained"] == 0


def test_first_aid_capped_at_hp_max():
    sess = coc_healing.HealingSession("inv1", hp_max=12, con_value=60, current_hp=12)
    ev = sess.first_aid(skill_value=60, skill_roll_result=_roll("regular"))
    assert sess.current_hp == 12
    assert ev["hp_gained"] == 0  # already at max


def test_first_aid_can_be_pushed():
    """Pushing allows a second attempt (first_aid_used_today is reset on push)."""
    sess = coc_healing.HealingSession("inv1", hp_max=12, con_value=60, current_hp=8)
    # First use succeeds
    sess.first_aid(skill_value=60, skill_roll_result=_roll("regular"))
    assert sess.current_hp == 9
    # Second use same day without push -> already used
    ev2 = sess.first_aid(skill_value=60, skill_roll_result=_roll("regular"))
    assert ev2["already_used_today"] is True
    assert sess.current_hp == 9  # no further gain
    # Pushed attempt -> allowed
    ev3 = sess.first_aid(skill_value=60, skill_roll_result=_roll("regular"), pushed=True)
    assert ev3["pushed"] is True
    assert sess.current_hp == 10


# --------------------------------------------------------------------------- #
# Dying chain (p.121): First Aid stabilizes -> hourly CON -> Medicine clears
# --------------------------------------------------------------------------- #
def _dying_session(seed: int = 7) -> "coc_healing.HealingSession":
    return coc_healing.HealingSession(
        "harvey", hp_max=12, con_value=60, rng=random.Random(seed),
        current_hp=0, conditions=["major_wound", "dying"])


def test_first_aid_stabilizes_dying_character():
    sess = _dying_session()
    ev = sess.first_aid(99, skill_roll_result=_roll("regular"))
    assert ev["event_type"] == "first_aid_stabilize"
    assert sess.current_hp == 1
    assert "stabilized" in sess.conditions
    assert "dying" in sess.conditions  # dying 勾要等 Medicine 才清（p.121）


def test_first_aid_on_stabilized_dying_does_not_heal_further():
    sess = _dying_session()
    sess.first_aid(99, skill_roll_result=_roll("regular"))
    ev = sess.first_aid(99, skill_roll_result=_roll("regular"))
    assert ev["event_type"] == "healing_skipped"
    assert sess.current_hp == 1


def test_first_aid_failure_does_not_stabilize():
    sess = _dying_session()
    ev = sess.first_aid(10, skill_roll_result=_roll("failure"))
    assert ev["event_type"] == "first_aid"
    assert ev["stabilized"] is False
    assert sess.current_hp == 0
    assert "stabilized" not in sess.conditions


def test_medicine_cannot_stabilize_dying():
    sess = _dying_session()
    ev = sess.medicine(99, skill_roll_result=_roll("regular"))
    assert ev["event_type"] == "healing_skipped"
    assert "First Aid" in ev["reason"]


def test_medicine_clears_dying_after_stabilization():
    sess = _dying_session()
    sess.first_aid(99, skill_roll_result=_roll("regular"))
    ev = sess.medicine(99, skill_roll_result=_roll("regular"))
    assert ev["event_type"] == "medicine"
    assert "dying" not in sess.conditions
    assert "stabilized" not in sess.conditions
    assert sess.current_hp >= 2  # 1 临时 + 1D3


def test_dying_con_roll_failure_kills():
    sess = _dying_session()
    ev = sess.dying_con_roll(roll_result=_roll("failure"))
    assert ev["died"] is True
    assert "dead" in sess.conditions


def test_dying_con_roll_success_holds_on():
    sess = _dying_session()
    ev = sess.dying_con_roll(roll_result=_roll("regular"))
    assert ev["died"] is False
    assert "dead" not in sess.conditions


def test_stabilized_con_roll_failure_reverts_to_dying():
    sess = _dying_session()
    sess.first_aid(99, skill_roll_result=_roll("regular"))
    sess.stabilized_con_roll(roll_result=_roll("failure"))
    assert sess.current_hp == 0
    assert "stabilized" not in sess.conditions
    assert "dying" in sess.conditions


# --------------------------------------------------------------------------- #
# Medicine (p.120)
# --------------------------------------------------------------------------- #
def test_medicine_success_heals_1d3():
    rng = random.Random(1)
    sess = coc_healing.HealingSession("inv1", hp_max=12, con_value=60, current_hp=5, rng=rng)
    ev = sess.medicine(skill_value=60)
    assert ev["hp_gained"] >= 1 and ev["hp_gained"] <= 3
    assert sess.current_hp == 5 + ev["hp_gained"]


def test_medicine_hard_difficulty_if_not_same_day():
    sess = coc_healing.HealingSession("inv1", hp_max=12, con_value=60, current_hp=5)
    ev = sess.medicine(skill_value=60, same_day=False)
    assert ev["difficulty"] == "hard"


def test_medicine_once_per_day():
    rng = random.Random(2)
    sess = coc_healing.HealingSession("inv1", hp_max=12, con_value=60, current_hp=5, rng=rng)
    sess.medicine(skill_value=60)
    hp_after_first = sess.current_hp
    ev2 = sess.medicine(skill_value=60)
    assert sess.current_hp == hp_after_first  # no double-medicine same day


# --------------------------------------------------------------------------- #
# Weekly recovery (p.122)
# --------------------------------------------------------------------------- #
def test_weekly_recovery_no_major_wound():
    """No major wound: 1 HP per day of rest."""
    sess = coc_healing.HealingSession("inv1", hp_max=12, con_value=60, current_hp=5)
    ev = sess.weekly_recovery(days_of_rest=3)
    assert ev["hp_gained"] == 3
    assert sess.current_hp == 8


def test_weekly_recovery_capped_at_max():
    sess = coc_healing.HealingSession("inv1", hp_max=10, con_value=60, current_hp=9)
    ev = sess.weekly_recovery(days_of_rest=5)
    assert sess.current_hp == 10
    assert ev["hp_gained"] == 1


def test_weekly_recovery_major_wound_con_roll():
    """Major wound: rate determined by daily CON roll (reg=1D3, extreme=2D3, fail=0)."""
    rng = random.Random(42)
    sess = coc_healing.HealingSession(
        "inv1", hp_max=12, con_value=70, current_hp=2,
        conditions=["major_wound"], rng=rng)
    ev = sess.weekly_recovery(days_of_rest=3)
    assert ev["had_major_wound"] is True
    assert ev["con_rolls"] is not None
    assert len(ev["con_rolls"]) == 3
    # total gained must be a plausible sum of 0/1D3/2D3 over 3 days (0..18)
    assert 0 <= ev["hp_gained"] <= 18
    assert sess.current_hp == 2 + ev["hp_gained"]


def test_weekly_recovery_zero_days_is_noop():
    sess = coc_healing.HealingSession("inv1", hp_max=12, con_value=60, current_hp=5)
    ev = sess.weekly_recovery(days_of_rest=0)
    assert ev["hp_gained"] == 0


def test_healing_clears_major_wound_above_half_hp():
    """major_wound clears once HP restored to >= half max (p.122 heuristic)."""
    sess = coc_healing.HealingSession(
        "inv1", hp_max=12, con_value=60, current_hp=4, conditions=["major_wound"])
    # half of 12 = 6; heal to 7 -> clears
    sess._heal(3)
    assert sess.current_hp == 7
    assert "major_wound" not in sess.conditions


# --------------------------------------------------------------------------- #
# Persistence
# --------------------------------------------------------------------------- #
@pytest.fixture
def campaign(tmp_path):
    camp = tmp_path / "campaign"
    (camp / "save" / "investigator-state").mkdir(parents=True)
    (camp / "logs").mkdir(parents=True)
    return camp


def test_save_writes_hp_and_conditions(campaign):
    sess = coc_healing.HealingSession(
        "inv1", hp_max=12, con_value=60, current_hp=3, conditions=["major_wound"])
    sess.first_aid(skill_value=60, skill_roll_result=_roll("regular"))
    path = sess.save(campaign)
    data = json.loads(path.read_text())
    assert data["current_hp"] == 4
    assert "major_wound" in data["conditions"]  # 4 < half-max(6), wound persists


def test_save_merges_with_existing_state(campaign):
    path = campaign / "save" / "investigator-state" / "inv1.json"
    path.write_text(json.dumps({
        "schema_version": 1, "investigator_id": "inv1",
        "current_san": 55, "current_mp": 10}))
    sess = coc_healing.HealingSession("inv1", hp_max=12, con_value=60, current_hp=8)
    sess.save(campaign)
    data = json.loads(path.read_text())
    assert data["current_hp"] == 8
    assert data["current_san"] == 55  # preserved
    assert data["current_mp"] == 10   # preserved


def test_load_reconstructs_session(campaign):
    sess = coc_healing.HealingSession(
        "inv1", hp_max=12, con_value=60, current_hp=8, conditions=["major_wound"])
    sess.save(campaign)
    loaded = coc_healing.HealingSession.load(campaign, "inv1", hp_max=12, con_value=60)
    assert loaded.current_hp == 8
    assert "major_wound" in loaded.conditions


# --------------------------------------------------------------------------- #
# coc_time integration
# --------------------------------------------------------------------------- #
def test_handle_time_trigger_sleep_heals(campaign):
    """A sleep_night advance (>=6h) heals via weekly_recovery."""
    coc_healing._write_inv_state(campaign, "inv1", {
        "schema_version": 1, "investigator_id": "inv1",
        "current_hp": 6, "hp_max": 12, "conditions": []})
    gained = coc_healing.handle_time_trigger(
        campaign, "inv1", hp_max=12, con_value=60, delta_minutes=480)
    assert gained == 1  # one day of rest
    data = json.loads((campaign / "save" / "investigator-state" / "inv1.json").read_text())
    assert data["current_hp"] == 7


def test_handle_time_trigger_zero_minutes_noop(campaign):
    coc_healing._write_inv_state(campaign, "inv1", {"current_hp": 6, "hp_max": 12})
    gained = coc_healing.handle_time_trigger(
        campaign, "inv1", hp_max=12, con_value=60, delta_minutes=0)
    assert gained == 0


def test_reset_daily_treatments():
    sess = coc_healing.HealingSession("inv1", hp_max=12, con_value=60, current_hp=8)
    sess.first_aid(skill_value=60, skill_roll_result=_roll("regular"))
    assert sess._first_aid_used_today is True
    sess.reset_daily_treatments()
    assert sess._first_aid_used_today is False
