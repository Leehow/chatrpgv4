#!/usr/bin/env python3
"""Tests for the tome reading engine (coc_tomes.py) — Keeper Rulebook Ch11 p.217-226."""
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


coc_tomes = _load("coc_tomes", "coc_tomes.py")


def _session(
    tmp_path: Path | None = None,
    *,
    tome_name: str = "Al Azif",
    language_skill: int = 50,
    read_language_ok: bool = False,
    plot_critical: bool = False,
    investigator_id: str = "inv1",
) -> "coc_tomes.TomeSession":
    return coc_tomes.TomeSession(
        investigator_id,
        tome_name,
        rng=random.Random(1),
        campaign_dir=tmp_path,
        language_skill=language_skill,
        read_language_ok=read_language_ok,
        plot_critical=plot_critical,
    )


# --------------------------------------------------------------------------- #
# Language gate (p.211-212)
# --------------------------------------------------------------------------- #
def test_language_gate_blocks_without_skill_or_ok():
    sess = _session(language_skill=0, read_language_ok=False)
    result = sess.read("skim")
    assert result == {"blocked": "language_gate"}


def test_language_gate_passes_with_skill():
    sess = _session(language_skill=1)
    result = sess.read("skim")
    assert "blocked" not in result
    assert result["phase"] == "skim"


def test_language_gate_passes_with_read_language_ok():
    sess = _session(language_skill=0, read_language_ok=True)
    result = sess.read("initial")
    assert "blocked" not in result
    assert result["phase"] == "initial"


def test_plot_critical_skips_language_gate():
    sess = _session(language_skill=0, read_language_ok=False, plot_critical=True)
    result = sess.read("skim")
    assert "blocked" not in result
    assert result["keeper_note"] == "skip_failure_gate"


# --------------------------------------------------------------------------- #
# skim / initial / full / research contracts
# --------------------------------------------------------------------------- #
def test_skim_gives_atmosphere_no_cm_or_san():
    sess = _session()
    result = sess.read("skim")
    assert result["phase"] == "skim"
    assert "hours" in result
    assert result.get("cm_gain", 0) == 0
    assert "san_loss_expr" not in result or result.get("san_loss_expr") is None
    assert "skim" in sess.phases_completed or result["phase"] == "skim"


def test_initial_returns_cm_san_expr_and_weeks():
    # Al Azif: full_study_weeks=68, CMI=6, sanity_cost="2D10"
    sess = _session()
    result = sess.read("initial")
    assert result["phase"] == "initial"
    assert result["cm_gain"] == 6
    assert result["san_loss_expr"] == "2D10"
    assert result["weeks"] == max(1, 68 // 4)  # 17
    assert "initial" in sess.phases_completed
    assert sess.cm_gained == 6
    assert sess.weeks_spent == 17


def test_initial_weeks_minimum_one():
    # Azathoth and Others: full_study_weeks=1 → max(1, 0) = 1
    sess = _session(tome_name="Azathoth and Others")
    result = sess.read("initial")
    assert result["weeks"] == 1


def test_full_requires_initial():
    sess = _session()
    result = sess.read("full")
    assert result["blocked"] == "initial_required"


def test_full_after_initial_gives_cmf_and_spells():
    sess = _session()
    sess.read("initial")
    result = sess.read("full")
    assert result["phase"] == "full"
    assert result["cm_gain"] == 12  # Al Azif CMF
    assert result["mythos_rating"] == 54
    assert result["weeks"] == 68
    assert result["spells_glimpsed"] is True
    assert "full" in sess.phases_completed
    assert sess.cm_gained == 6 + 12
    assert sess.weeks_spent == 17 + 68


def test_repeat_full_doubles_time_zero_new_cm():
    sess = _session()
    sess.read("initial")
    sess.read("full")
    cm_before = sess.cm_gained
    weeks_before = sess.weeks_spent
    result = sess.read("full")
    assert result["phase"] == "full"
    assert result["cm_gain"] == 0
    assert result["weeks"] == 68 * 2
    assert sess.cm_gained == cm_before
    assert sess.weeks_spent == weeks_before + 136


def test_research_requires_full():
    sess = _session()
    sess.read("initial")
    result = sess.read("research")
    assert result["blocked"] == "full_required"


def test_research_returns_roll_contract_without_rolling():
    sess = _session()
    sess.read("initial")
    sess.read("full")
    result = sess.read("research")
    assert result["phase"] == "research"
    assert "roll" in result
    roll = result["roll"]
    assert roll["target"] == 54  # Al Azif mythos_rating
    assert roll.get("kind") == "mythos_rating" or "target" in roll
    # Engine must not roll — no outcome/roll value from the engine itself
    assert "outcome" not in roll


# --------------------------------------------------------------------------- #
# believer_gate / choose_disbelief
# --------------------------------------------------------------------------- #
def test_believer_gate_can_defer_when_no_state_file(tmp_path):
    sess = _session(tmp_path)
    result = sess.read("initial")
    assert result["believer_gate"] == {"can_defer_san": True}


def test_believer_gate_can_defer_when_believer_false(tmp_path):
    inv_dir = tmp_path / "save" / "investigator-state"
    inv_dir.mkdir(parents=True)
    (inv_dir / "inv1.json").write_text(json.dumps({"believer": False}), encoding="utf-8")
    sess = _session(tmp_path)
    result = sess.read("initial")
    assert result["believer_gate"]["can_defer_san"] is True


def test_believer_gate_no_defer_when_believer_true(tmp_path):
    inv_dir = tmp_path / "save" / "investigator-state"
    inv_dir.mkdir(parents=True)
    (inv_dir / "inv1.json").write_text(json.dumps({"believer": True}), encoding="utf-8")
    sess = _session(tmp_path)
    result = sess.read("initial")
    assert result["believer_gate"]["can_defer_san"] is False


def test_choose_disbelief_halves_cm_keeps_san_expr():
    sess = _session()
    result = sess.read("initial", choose_disbelief=True)
    assert result["san_loss_expr"] == "2D10"  # unchanged
    assert result["cm_gain"] == 3  # floor(6/2)
    assert result["disbelief_chosen"] is True
    assert sess.cm_gained == 3


def test_choose_disbelief_cm_floor_min_one():
    # Azathoth and Others CMI=1 → floor(1/2)=0 → min 1
    sess = _session(tome_name="Azathoth and Others")
    result = sess.read("initial", choose_disbelief=True)
    assert result["cm_gain"] == 1
    assert result["disbelief_chosen"] is True


# --------------------------------------------------------------------------- #
# snapshot / load roundtrip
# --------------------------------------------------------------------------- #
def test_snapshot_load_roundtrip(tmp_path):
    sess = _session(tmp_path)
    sess.read("initial")
    sess.read("full")
    snap = sess.snapshot()
    assert snap["investigator_id"] == "inv1"
    assert snap["tome_name"] == "Al Azif"
    assert "initial" in snap["phases_completed"]
    assert "full" in snap["phases_completed"]
    assert snap["cm_gained"] == 18
    assert snap["weeks_spent"] == 17 + 68

    sess.save(tmp_path)
    loaded = coc_tomes.TomeSession.load(tmp_path, "inv1")
    assert loaded.investigator_id == "inv1"
    assert loaded.tome_name == "Al Azif"
    assert loaded.phases_completed == sess.phases_completed
    assert loaded.cm_gained == sess.cm_gained
    assert loaded.weeks_spent == sess.weeks_spent

    # Repeat full still doubles after load
    result = loaded.read("full")
    assert result["cm_gain"] == 0
    assert result["weeks"] == 136
