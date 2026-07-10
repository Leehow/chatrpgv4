#!/usr/bin/env python3
"""Tests for the environmental damage / hazards engine (coc_hazards.py, W3-3).

Covers Table III severity ladders (p.124), suffocation/drowning state machine,
poison Extreme-CON halving, falling/fire presets, and HazardSession persistence.
"""
from __future__ import annotations

import importlib.util
import json
import random
from pathlib import Path

import pytest


PLUGIN_ROOT = Path("plugins/coc-keeper")
RULES_DIR = PLUGIN_ROOT / "references" / "rules-json"


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, PLUGIN_ROOT / "scripts" / rel)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


coc_hazards = _load("coc_hazards", "coc_hazards.py")


def _participant(**kwargs):
    base = {
        "id": "inv1",
        "current_hp": 12,
        "hp_max": 12,
        "con": 60,
        "conditions": [],
    }
    base.update(kwargs)
    return base


# --------------------------------------------------------------------------- #
# Table III severity ladders (p.124)
# --------------------------------------------------------------------------- #
def test_table_iii_severity_damage_exprs():
    tiers = coc_hazards.SEVERITY_TIERS
    assert tiers["minor"]["damage_expr"] == "1D3"
    assert tiers["moderate"]["damage_expr"] == "1D6"
    assert tiers["severe"]["damage_expr"] == "1D10"
    assert tiers["deadly"]["damage_expr"] == "2D10"
    assert tiers["terminal"]["damage_expr"] == "4D10"
    assert tiers["splat"]["damage_expr"] == "8D10"


def test_apply_other_damage_bypasses_armor():
    p = _participant(current_hp=12)
    rng = random.Random(1)
    ev = coc_hazards.apply_other_damage(p, severity="moderate", rng=rng)
    assert ev["bypass_armor"] is True
    assert ev["severity"] == "moderate"
    assert ev["damage_expr"] == "1D6"
    assert ev["raw_damage"] >= 1
    assert p["current_hp"] == 12 - ev["raw_damage"]
    assert ev["hp_before"] == 12
    assert ev["hp_after"] == p["current_hp"]
    assert ev["hp_delta"] == -ev["raw_damage"]


def test_apply_other_damage_by_hazard_preset_falling():
    p = _participant()
    rng = random.Random(2)
    ev = coc_hazards.apply_other_damage(
        p, hazard_id="falling_concrete_per_10ft", rng=rng
    )
    assert ev["hazard_id"] == "falling_concrete_per_10ft"
    assert ev["severity"] == "severe"
    assert ev["damage_expr"] == "1D10"
    assert ev["bypass_armor"] is True
    assert ev["category"] == "falling"


def test_apply_other_damage_fire_preset():
    p = _participant()
    ev = coc_hazards.apply_other_damage(
        p, hazard_id="fire_burning_room", rng=random.Random(3)
    )
    assert ev["category"] == "fire"
    assert ev["severity"] == "severe"
    assert ev["bypass_armor"] is True


def test_apply_other_damage_major_wound_when_half_hp():
    """Non-suffocation environmental hits still apply major-wound rules."""
    p = _participant(current_hp=12, hp_max=12)
    # Force a large hit via terminal severity with a seeded RNG that rolls high.
    ev = coc_hazards.apply_other_damage(
        p, severity="terminal", rng=random.Random(0)
    )
    if ev["raw_damage"] >= 6:
        assert "major_wound" in p["conditions"]


def test_hazards_json_presets_cover_falling_fire_asphyxiation():
    data = json.loads((RULES_DIR / "hazards.json").read_text(encoding="utf-8"))
    presets = data["presets"]
    assert "falling_soft_swamp_per_10ft" in presets
    assert "falling_grass_per_10ft" in presets
    assert "falling_concrete_per_10ft" in presets
    assert "fire_torch" in presets
    assert "fire_burning_room" in presets
    assert "drowning" in presets
    assert presets["drowning"]["suffocation"] is True


# --------------------------------------------------------------------------- #
# Suffocation / drowning (Table III footnote *, p.124)
# --------------------------------------------------------------------------- #
def test_suffocation_con_success_no_damage_yet():
    """CON success while holding breath: no damage, still suffocating."""
    p = _participant(con=99)  # almost always succeed
    sess = coc_hazards.HazardSession(rng=random.Random(1))
    start = sess.start_suffocation(p, kind="drowning")
    assert start["condition"] == "suffocating"
    assert "suffocating" in p["conditions"]
    ev = sess.suffocation_round(p)
    assert ev["con_outcome"] in {"regular", "hard", "extreme", "critical"}
    assert ev["damage_applied"] is False
    assert ev["raw_damage"] == 0
    assert p["current_hp"] == 12


def test_suffocation_after_con_fail_takes_damage_each_round():
    p = _participant(con=1)  # always fail CON
    sess = coc_hazards.HazardSession(rng=random.Random(5))
    sess.start_suffocation(p, kind="drowning")  # moderate → 1D6
    ev1 = sess.suffocation_round(p)
    assert ev1["con_failed"] is True
    assert ev1["damage_applied"] is True
    assert ev1["raw_damage"] >= 1
    assert ev1["bypass_armor"] is True
    hp_after_first = p["current_hp"]
    # Subsequent rounds: damage without needing another CON gate
    ev2 = sess.suffocation_round(p)
    assert ev2["damage_applied"] is True
    assert ev2.get("con_roll") is None  # already past the CON gate
    assert p["current_hp"] < hp_after_first


def test_suffocation_exertion_requires_hard_con():
    p = _participant(con=50)
    sess = coc_hazards.HazardSession(rng=random.Random(7))
    sess.start_suffocation(p, kind="asphyxiation", exertion=True)
    ev = sess.suffocation_round(p)
    assert ev["con_difficulty"] == "hard"


def test_suffocation_at_zero_hp_dies_ignoring_major_wound():
    """Death occurs at 0 hit points (ignore the Major Wound rule). p.124."""
    p = _participant(current_hp=2, hp_max=12, con=1, conditions=["major_wound"])
    sess = coc_hazards.HazardSession(rng=random.Random(9))
    sess.start_suffocation(p, kind="drowning")
    # Drive HP to 0 via damage rounds
    for _ in range(10):
        ev = sess.suffocation_round(p)
        if p["current_hp"] <= 0:
            break
    assert p["current_hp"] == 0
    assert "dead" in p["conditions"]
    assert "dying" not in p["conditions"]  # ignore major-wound → dying path
    assert ev["death_rule"] == "suffocation_ignore_major_wound"
    assert ev["died"] is True


def test_end_suffocation_clears_condition():
    p = _participant(con=1)
    sess = coc_hazards.HazardSession(rng=random.Random(3))
    sess.start_suffocation(p, kind="drowning")
    assert "suffocating" in p["conditions"]
    ev = sess.end_suffocation(p, reason="surfaced")
    assert "suffocating" not in p["conditions"]
    assert ev["reason"] == "surfaced"


# --------------------------------------------------------------------------- #
# Poison (Table III footnote **, p.124 + Sample Poisons p.129)
# --------------------------------------------------------------------------- #
def test_poisons_json_has_structured_fields():
    data = json.loads((RULES_DIR / "poisons.json").read_text(encoding="utf-8"))
    arsenic = data["poisons"]["Arsenic"]
    assert arsenic["potency"] == "lethal"
    assert arsenic["damage_expr"] == "4D10"
    assert isinstance(arsenic["symptoms"], list)
    assert "vomiting" in arsenic["symptoms"]
    assert arsenic["onset"]


def test_apply_poison_deals_damage_with_symptom_tags():
    p = _participant(current_hp=40, hp_max=40, con=50)
    # Seed that fails Extreme CON (roll high)
    ev = coc_hazards.apply_poison(p, "Arsenic", rng=random.Random(99))
    assert ev["poison_id"] == "Arsenic"
    assert ev["bypass_armor"] is True
    assert ev["potency"] == "lethal"
    assert set(ev["symptom_tags"]) >= {"burning_pain", "vomiting", "diarrhea"}
    assert ev["raw_damage"] >= 1
    if not ev.get("damage_halved"):
        assert p["current_hp"] == 40 - ev["raw_damage"]


def test_apply_poison_extreme_con_halves_damage():
    """Extreme CON success (≤ CON/5) halves poison damage. p.124 / p.129."""
    p = _participant(current_hp=40, hp_max=40, con=100)
    # Force extreme success via injected CON roll result
    ev = coc_hazards.apply_poison(
        p,
        "Arsenic",
        rng=random.Random(1),
        con_roll_result={
            "outcome": "extreme",
            "roll": 5,
            "target": 100,
            "effective_target": 100,
            "difficulty": "regular",
        },
    )
    assert ev["damage_halved"] is True
    assert ev["con_outcome"] == "extreme"
    assert ev["raw_damage"] == ev["damage_before_halve"] // 2 or (
        ev["raw_damage"] == (ev["damage_before_halve"] + 1) // 2
    )


def test_apply_poison_critical_may_shake_off():
    p = _participant(current_hp=40, hp_max=40, con=60)
    ev = coc_hazards.apply_poison(
        p,
        "Arsenic",
        rng=random.Random(1),
        con_roll_result={
            "outcome": "critical",
            "roll": 1,
            "target": 60,
            "effective_target": 60,
            "difficulty": "regular",
        },
        allow_critical_shake_off=True,
    )
    assert ev["shaken_off"] is True
    assert ev["raw_damage"] == 0
    assert p["current_hp"] == 40


def test_apply_poison_very_mild_no_damage_unconscious():
    p = _participant()
    ev = coc_hazards.apply_poison(p, "Chloroform", rng=random.Random(1))
    assert ev["potency"] == "very_mild"
    assert ev["raw_damage"] == 0
    assert "unconscious" in ev["symptom_tags"] or "unconscious" in p["conditions"]


def test_apply_poison_unknown_id_raises():
    with pytest.raises(KeyError):
        coc_hazards.apply_poison(_participant(), "NotAPoison", rng=random.Random(1))


# --------------------------------------------------------------------------- #
# HazardSession persistence
# --------------------------------------------------------------------------- #
def test_hazard_session_snapshot_and_load(tmp_path):
    campaign = tmp_path / "camp"
    (campaign / "save" / "investigator-state").mkdir(parents=True)
    (campaign / "logs").mkdir(parents=True)

    p = _participant(id="harvey", con=1)
    sess = coc_hazards.HazardSession(rng=random.Random(11))
    sess.start_suffocation(p, kind="drowning")
    sess.suffocation_round(p)
    sess.save(campaign, participant=p)

    path = campaign / "save" / "hazards.json"
    assert path.exists()
    loaded = coc_hazards.HazardSession.load(campaign, rng=random.Random(0))
    snap = loaded.snapshot()
    assert "harvey" in snap["active"]
    assert snap["active"]["harvey"]["kind"] == "drowning"

    inv = json.loads(
        (campaign / "save" / "investigator-state" / "harvey.json").read_text()
    )
    assert inv["current_hp"] == p["current_hp"]
    assert "suffocating" in inv["conditions"]


def test_hazard_session_persist_events(tmp_path):
    campaign = tmp_path / "camp"
    (campaign / "logs").mkdir(parents=True)
    p = _participant()
    sess = coc_hazards.HazardSession(rng=random.Random(2))
    sess.apply_other_damage(p, severity="minor")
    sess.persist_events(campaign)
    lines = (campaign / "logs" / "events.jsonl").read_text().strip().splitlines()
    assert len(lines) >= 1
    ev = json.loads(lines[0])
    assert ev["event_type"] == "other_damage"
    assert ev["bypass_armor"] is True
