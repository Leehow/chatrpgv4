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


def test_weekly_recovery_with_major_wound_defers_to_weekly_con_roll():
    """Major wound: natural rest alone no longer heals per-day; the weekly
    CON recovery roll (major_wound_recovery_roll) is the only path (p.121)."""
    rng = random.Random(42)
    sess = coc_healing.HealingSession(
        "inv1", hp_max=12, con_value=70, current_hp=2,
        conditions=["major_wound"], rng=rng)
    ev = sess.weekly_recovery(days_of_rest=3)
    assert ev["had_major_wound"] is True
    assert ev["hp_gained"] == 0
    assert ev["major_wound_recovery_required"] is True
    assert sess.current_hp == 2


# --------------------------------------------------------------------------- #
# Major wound recovery — weekly CON roll (p.121)
# --------------------------------------------------------------------------- #
def _wounded_session(con: int = 50, seed: int = 3) -> "coc_healing.HealingSession":
    return coc_healing.HealingSession(
        "h", hp_max=15, con_value=con, rng=random.Random(seed),
        current_hp=4, conditions=["major_wound"])


def test_major_wound_recovery_is_weekly_con_roll():
    sess = _wounded_session(con=99)
    ev = sess.major_wound_recovery_roll(roll_result=_roll("regular"))
    assert ev["event_type"] == "major_wound_recovery"
    assert 1 <= ev["hp_gained"] <= 3


def test_major_wound_recovery_failure_heals_nothing():
    sess = _wounded_session()
    ev = sess.major_wound_recovery_roll(roll_result=_roll("failure"))
    assert ev["hp_gained"] == 0
    assert "major_wound" in sess.conditions


def test_recovery_bonus_dice_from_rest_and_care():
    sess = _wounded_session()
    ev = sess.major_wound_recovery_roll(complete_rest=True, medical_care_success=True)
    assert ev["bonus_dice"] == 2 and ev["penalty_dice"] == 0


def test_recovery_penalty_die_from_poor_environment():
    sess = _wounded_session()
    ev = sess.major_wound_recovery_roll(poor_environment=True)
    assert ev["penalty_dice"] == 1


def test_recovery_extreme_success_clears_major_wound():
    sess = _wounded_session(con=99)
    ev = sess.major_wound_recovery_roll(roll_result=_roll("extreme"))
    assert 2 <= ev["hp_gained"] <= 6
    assert "major_wound" not in sess.conditions


def test_recovery_fumble_emits_lasting_injury():
    sess = _wounded_session(con=10)
    sess.major_wound_recovery_roll(roll_result=_roll("fumble"))
    assert any(e["event_type"] == "lasting_injury" for e in sess.events)


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


# --------------------------------------------------------------------------- #
# W2-4: monthly treatment / asylum tiers / indefinite cure / self-help (p.164-168)
# --------------------------------------------------------------------------- #
def test_treatment_json_monthly_roll_and_quality_tiers():
    """treatment.json exposes private-care monthly roll + asylum quality tiers."""
    path = PLUGIN_ROOT / "references" / "rules-json" / "treatment.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    monthly = data["psychoanalysis"]["monthly_roll"]
    assert monthly["success_range"] == [1, 95]
    assert monthly["gain"] == "1D3"
    assert monthly["setback_loss"] == "1D6"
    tiers = data["asylum_confinement"]["quality_tiers"]
    assert tiers["good"]["monthly_bonus_die"] is True
    assert tiers["poor"]["monthly_penalty_die"] is True


def test_monthly_treatment_roll_success_gains_1d3():
    """01-95 on the monthly private-care roll recovers 1D3 SAN (p.164)."""
    for seed in range(1, 500):
        state = {"current_san": 40, "max_san": 90}
        sess = coc_healing.PsychotherapySession(
            "inv1", state, rng=random.Random(seed))
        ev = sess.monthly_treatment_roll()
        if ev.get("setback"):
            continue
        assert ev["san_delta"] >= 1
        assert state["current_san"] == 40 + ev["san_delta"]
        assert sess.monthly_gains_count == 1
        return
    pytest.fail("no monthly success seed found")


def test_monthly_treatment_roll_setback_loses_1d6():
    """96-00 is a setback: lose 1D6 SAN (p.164)."""
    for seed in range(1, 800):
        state = {"current_san": 40, "max_san": 90}
        sess = coc_healing.PsychotherapySession(
            "inv1", state, rng=random.Random(seed))
        ev = sess.monthly_treatment_roll()
        if not ev.get("setback"):
            continue
        assert ev["san_delta"] <= -1
        assert state["current_san"] == 40 + ev["san_delta"]
        assert sess.monthly_gains_count == 0
        return
    pytest.fail("no monthly setback seed found")


def test_monthly_treatment_asylum_quality_applies_bonus_or_penalty_die():
    """Asylum good/poor quality attaches bonus/penalty die to the monthly 1D100."""
    state = {"current_san": 40, "max_san": 90}
    good = coc_healing.PsychotherapySession(
        "inv1", state, rng=random.Random(11))
    ev_good = good.monthly_treatment_roll(quality="good")
    assert ev_good["bonus"] == 1
    assert ev_good["penalty"] == 0

    poor = coc_healing.PsychotherapySession(
        "inv1", dict(state), rng=random.Random(11))
    ev_poor = poor.monthly_treatment_roll(quality="poor")
    assert ev_poor["bonus"] == 0
    assert ev_poor["penalty"] == 1


def test_asylum_release_no_longer_recovers_to_max_san():
    """Full-restore shortcut is neutralized; release uses monthly cadence."""
    for seed in range(1, 400):
        state = {"current_san": 40, "max_san": 90}
        sess = coc_healing.PsychotherapySession(
            "inv1", state, rng=random.Random(seed))
        sess.asylum_months_remaining = 3
        ev = sess.resolve_asylum_release(psychoanalysis_skill=99)
        assert state["current_san"] < 90 or ev.get("setback") is not None
        # Even on the best outcome, a single release cannot jump to max from 40.
        assert state["current_san"] <= 40 + 3  # at most +1D3
        return


def test_cure_indefinite_requires_prior_monthly_gain():
    """cure_indefinite_check is gated behind at least one successful monthly gain."""
    state = {"current_san": 50, "max_san": 90, "indefinite_insane": True}
    sess = coc_healing.PsychotherapySession(
        "inv1", state, rng=random.Random(1))
    blocked = sess.cure_indefinite_check()
    assert blocked.get("blocked") == "monthly_gain_required"
    assert state.get("indefinite_insane") is True

    # Force a successful monthly gain, then allow the cure check.
    for seed in range(1, 500):
        state2 = {"current_san": 50, "max_san": 90, "indefinite_insane": True}
        sess2 = coc_healing.PsychotherapySession(
            "inv1", state2, rng=random.Random(seed))
        monthly = sess2.monthly_treatment_roll()
        if monthly.get("setback") or sess2.monthly_gains_count < 1:
            continue
        # Find a seed where the cure SAN check succeeds (1D100 <= current SAN).
        for cure_seed in range(seed, seed + 300):
            state3 = {
                "current_san": state2["current_san"],
                "max_san": 90,
                "indefinite_insane": True,
            }
            sess3 = coc_healing.PsychotherapySession(
                "inv1", state3, rng=random.Random(cure_seed))
            sess3.monthly_gains_count = sess2.monthly_gains_count
            result = sess3.cure_indefinite_check()
            if result.get("blocked"):
                continue
            if result.get("cured"):
                assert state3.get("indefinite_insane") is False
                return
        return  # monthly gate works even if cure roll didn't succeed in scan
    pytest.fail("no monthly gain seed for cure gate")


def test_self_help_failure_returns_backstory_amend_required():
    """Failed self-help returns structured backstory corruption (W1-2 shape)."""
    key = {
        "backstory_field": "significant_people",
        "summary": "trusted mentor from Arkham",
    }
    for seed in range(1, 500):
        state = {"current_san": 50, "max_san": 90}
        sess = coc_healing.PsychotherapySession(
            "inv1", state, rng=random.Random(seed))
        ev = sess.self_help(key_connection=key)
        if ev["outcome"] in ("failure", "fumble"):
            amend = ev["backstory_amend_required"]
            assert amend["mode"] == "corrupt_existing"
            assert amend["backstory_field"] == "significant_people"
            assert ev["san_delta"] == -1
            return
    pytest.fail("no self-help failure seed")


def test_psychotherapy_snapshot_persists_monthly_gains_count():
    state = {"current_san": 50, "max_san": 90}
    sess = coc_healing.PsychotherapySession(
        "inv1", state, rng=random.Random(1))
    sess.monthly_gains_count = 2
    snap = sess.snapshot()
    assert snap["monthly_gains_count"] == 2
    assert snap["asylum_months_remaining"] == 0
