#!/usr/bin/env python3
"""Tests for Batch 4 subsystems:
1. Idea roll (target INT) and Know roll (target EDU).
2. Becoming a believer (p.179) + believer-bomb signal.
3. Psychotherapy / asylum / self-help recovery (p.164).
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


coc_roll = _load("coc_roll", "coc_roll.py")
coc_mythos = _load("coc_mythos", "coc_mythos.py")
coc_rule_signals = _load("coc_rule_signals", "coc_rule_signals.py")
coc_healing = _load("coc_healing", "coc_healing.py")


# --------------------------------------------------------------------------- #
# 1. Idea / Know rolls
# --------------------------------------------------------------------------- #
def test_idea_roll_uses_int_as_target():
    res = coc_roll.idea_roll(60, rng=random.Random(5))
    assert res["target"] == 60
    assert res["roll_kind"] == "idea"
    assert res["characteristic"] == "INT"


def test_idea_roll_success_on_low_roll():
    # Find a seed that rolls low (<= 60).
    for seed in range(1, 200):
        res = coc_roll.idea_roll(60, rng=random.Random(seed))
        if res["roll"] <= 60:
            assert res["outcome"] in ("regular", "hard", "extreme", "critical")
            return
    pytest.skip("no low-roll seed")


def test_idea_roll_failure_on_high_roll():
    for seed in range(1, 200):
        res = coc_roll.idea_roll(60, rng=random.Random(seed))
        if res["roll"] > 60:
            assert res["outcome"] in ("failure", "fumble")
            return
    pytest.skip("no high-roll seed")


def test_know_roll_uses_edu_as_target():
    res = coc_roll.know_roll(75, rng=random.Random(3))
    assert res["target"] == 75
    assert res["roll_kind"] == "know"
    assert res["characteristic"] == "EDU"


def test_idea_roll_respects_difficulty():
    # Hard difficulty halves the effective target (60 -> 30).
    res = coc_roll.idea_roll(60, difficulty="hard", rng=random.Random(1))
    assert res["effective_target"] == 30
    assert res["difficulty"] == "hard"


# --------------------------------------------------------------------------- #
# 2. Becoming a believer (p.179) + believer-bomb signal
# --------------------------------------------------------------------------- #
def test_read_believer_bomb_computes_pending_loss():
    sig = coc_rule_signals.read_believer_bomb(cm_value=15, current_san=50)
    assert sig["implemented"] is True
    assert sig["pending_san_loss"] == 15
    assert sig["resulting_san"] == 35
    assert sig["would_be_permanently_insane"] is False


def test_read_believer_bomb_flags_permanent_insanity():
    sig = coc_rule_signals.read_believer_bomb(cm_value=60, current_san=40)
    assert sig["resulting_san"] == 0
    assert sig["would_be_permanently_insane"] is True


def test_become_believer_first_hand_loses_san_equal_to_cm():
    # First-hand encounter: SAN loss = current CM (10).
    state = {"cm_value": 10, "current_san": 70, "max_san": 89}
    ev = coc_mythos.become_believer(state, source="first_hand_encounter",
                                    is_first=False)
    assert ev["san_lost"] == 10
    assert state["current_san"] == 60  # 70 - 10, then +1 CM clamps max to 88
    # CM rose by 1 (subsequent) -> cm_after 11, max_san 88.
    assert state["cm_value"] == 11
    assert state["max_san"] == 88


def test_become_believer_first_hand_with_first_encounter_grants_5():
    state = {"cm_value": 0, "current_san": 99, "max_san": 99}
    ev = coc_mythos.become_believer(state, source="first_hand_encounter",
                                    is_first=True)
    # SAN bomb = current CM before gain = 0, so no SAN lost from the bomb.
    # Then +5 CM -> max_san 94, current SAN clamped to 94.
    assert ev["san_lost"] == 0  # CM was 0 before
    assert state["cm_value"] == 5
    assert state["max_san"] == 94


def test_become_believer_tome_no_san_lost():
    """Reading a tome: may choose not to believe -> no SAN points lost."""
    state = {"cm_value": 10, "current_san": 70, "max_san": 89}
    ev = coc_mythos.become_believer(state, source="tome", is_first=False)
    assert ev["san_lost"] == 0  # no SAN lost (chose not to believe)
    # Still gains CM (max SAN drops).
    assert state["cm_value"] == 11
    assert state["max_san"] == 88
    # current SAN unchanged (70 <= new max 88).
    assert state["current_san"] == 70


def test_become_believer_invalid_source_raises():
    state = {"cm_value": 5, "current_san": 70, "max_san": 94}
    with pytest.raises(ValueError):
        coc_mythos.become_believer(state, source="vision")


def test_become_believer_permanent_insanity_when_san_drops_to_zero():
    state = {"cm_value": 50, "current_san": 50, "max_san": 49}
    ev = coc_mythos.become_believer(state, source="first_hand_encounter",
                                    is_first=False)
    assert ev["san_lost"] == 50
    assert state["current_san"] == 0
    assert ev["permanently_insane"] is True


@pytest.fixture
def campaign(tmp_path):
    camp = tmp_path / "campaign"
    (camp / "save" / "investigator-state").mkdir(parents=True)
    (camp / "logs").mkdir(parents=True)
    return camp


def test_become_believer_persisted_writes_state(campaign):
    coc_mythos._write_inv_state(campaign, "inv1", {
        "investigator_id": "inv1", "cm_value": 10, "current_san": 70, "max_san": 89,
    })
    ev = coc_mythos.become_believer_persisted(campaign, "inv1",
                                              source="first_hand_encounter")
    assert ev["san_lost"] == 10
    data = json.loads((campaign / "save" / "investigator-state" / "inv1.json").read_text())
    assert data["cm_value"] == 11
    assert "become_believer" in (campaign / "logs" / "events.jsonl").read_text()


# --------------------------------------------------------------------------- #
# 3. Psychotherapy / asylum / self-help (p.164)
# --------------------------------------------------------------------------- #
def test_psychoanalysis_regular_success_recovers_1d3():
    # Find a seed where Psychoanalysis (skill 60) succeeds regular (31-60).
    for seed in range(1, 300):
        state = {"current_san": 50, "max_san": 90}
        sess = coc_healing.PsychotherapySession("inv1", state, rng=random.Random(seed))
        ev = sess.psychoanalysis(60)
        if ev["outcome"] == "regular":
            assert ev["san_recovered"] >= 1
            assert state["current_san"] == 50 + ev["san_recovered"]
            return
    pytest.skip("no regular-success seed")


def test_psychoanalysis_extreme_success_recovers_3d3():
    for seed in range(1, 500):
        state = {"current_san": 50, "max_san": 90}
        sess = coc_healing.PsychotherapySession("inv1", state, rng=random.Random(seed))
        ev = sess.psychoanalysis(60)
        if ev["outcome"] == "extreme":
            assert ev["san_recovered"] >= 3  # 3D3 min
            return
    pytest.skip("no extreme-success seed")


def test_psychoanalysis_failure_recovers_zero():
    for seed in range(1, 400):
        state = {"current_san": 50, "max_san": 90}
        sess = coc_healing.PsychotherapySession("inv1", state, rng=random.Random(seed))
        ev = sess.psychoanalysis(60)
        if ev["outcome"] in ("failure", "fumble"):
            assert ev["san_recovered"] == 0
            assert state["current_san"] == 50  # unchanged
            return
    pytest.skip("no failure seed")


def test_psychoanalysis_capped_at_max_san():
    state = {"current_san": 89, "max_san": 90}
    sess = coc_healing.PsychotherapySession("inv1", state, rng=random.Random(1))
    # Force an extreme success for max gain, but cap at 90.
    for seed in range(1, 500):
        state2 = {"current_san": 89, "max_san": 90}
        sess2 = coc_healing.PsychotherapySession("inv1", state2, rng=random.Random(seed))
        ev = sess2.psychoanalysis(80)
        if ev["outcome"] == "extreme":
            assert state2["current_san"] == 90  # capped
            assert ev["san_recovered"] == 1
            return
    pytest.skip("no extreme-success seed")


def test_asylum_confinement_rolls_1d6_months():
    state = {"current_san": 30, "max_san": 90}
    sess = coc_healing.PsychotherapySession("inv1", state, rng=random.Random(2))
    ev = sess.confine_to_asylum()
    assert 1 <= ev["months"] <= 6
    assert sess.asylum_months_remaining == ev["months"]


def test_asylum_release_success_recovers_to_max():
    state = {"current_san": 40, "max_san": 90}
    sess = coc_healing.PsychotherapySession("inv1", state, rng=random.Random(1))
    sess.confine_to_asylum()
    # Find a success seed for the release roll.
    for seed in range(1, 400):
        state2 = {"current_san": 40, "max_san": 90}
        sess2 = coc_healing.PsychotherapySession("inv1", state2, rng=random.Random(seed))
        sess2.asylum_months_remaining = 4
        ev = sess2.resolve_asylum_release(psychoanalysis_skill=60)
        if ev["psychoanalysis_outcome"] in ("regular", "hard", "extreme", "critical"):
            assert state2["current_san"] == 90  # recovered to max
            assert sess2.asylum_months_remaining == 0
            return
    pytest.skip("no release-success seed")


def test_asylum_release_failure_no_recovery():
    for seed in range(1, 400):
        state = {"current_san": 40, "max_san": 90}
        sess = coc_healing.PsychotherapySession("inv1", state, rng=random.Random(seed))
        sess.asylum_months_remaining = 4
        ev = sess.resolve_asylum_release(psychoanalysis_skill=20)
        if ev["psychoanalysis_outcome"] in ("failure", "fumble"):
            assert state["current_san"] == 40  # unchanged
            assert sess.asylum_months_remaining == 0
            return
    pytest.skip("no release-failure seed")


def test_self_help_success_recovers_1d6():
    for seed in range(1, 400):
        state = {"current_san": 50, "max_san": 90}
        sess = coc_healing.PsychotherapySession("inv1", state, rng=random.Random(seed))
        ev = sess.self_help()
        if ev["outcome"] in ("regular", "hard", "extreme", "critical"):
            assert ev["san_delta"] >= 1
            assert state["current_san"] == 50 + ev["san_delta"]
            return
    pytest.skip("no self-help success seed")


def test_self_help_failure_loses_1_san():
    for seed in range(1, 400):
        state = {"current_san": 50, "max_san": 90}
        sess = coc_healing.PsychotherapySession("inv1", state, rng=random.Random(seed))
        ev = sess.self_help()
        if ev["outcome"] in ("failure", "fumble"):
            assert ev["san_delta"] == -1
            assert state["current_san"] == 49
            return
    pytest.skip("no self-help failure seed")


def test_psychotherapy_snapshot():
    state = {"current_san": 50, "max_san": 90}
    sess = coc_healing.PsychotherapySession("inv1", state, rng=random.Random(1))
    snap = sess.snapshot()
    assert snap["current_san"] == 50
    assert snap["max_san"] == 90
    assert snap["asylum_months_remaining"] == 0
