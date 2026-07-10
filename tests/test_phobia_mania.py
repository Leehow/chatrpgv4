#!/usr/bin/env python3
"""Tests for phobia/mania state application (coc_sanity.py extension).

Validates (p.159, p.171, p.162):
- Bout-of-madness result 9 → phobia rolled on Table IX, recorded in conditions.
- Bout-of-madness result 10 → mania rolled on Table X, recorded in conditions.
- Structured trigger_tags on every phobia/mania table entry.
- Insane investigator + intersecting exposure_tags → 1 penalty die.
- Sane / suppressed / disjoint tags → 0 penalty dice with structured reasons.
- Mania unindulged flag + Psychoanalysis symptom suppression.
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


coc_sanity = _load("coc_sanity", "coc_sanity.py")


def _make_session(san=65, int_val=60, seed=42):
    return coc_sanity.SanitySession("ada", san_max=san, int_value=int_val,
                                    rng=random.Random(seed))


# --------------------------------------------------------------------------- #
# Schema: every phobia/mania entry has structured trigger_tags
# --------------------------------------------------------------------------- #
def test_phobias_json_every_entry_has_trigger_tags():
    data = json.loads((RULES_DIR / "phobias.json").read_text(encoding="utf-8"))
    entries = data["phobias"]
    assert len(entries) >= 90
    for name, entry in entries.items():
        tags = entry.get("trigger_tags")
        assert isinstance(tags, list) and len(tags) >= 2, f"{name} missing trigger_tags"
        assert len(tags) <= 5, f"{name} should have 2-5 tags, got {len(tags)}"
        for tag in tags:
            assert isinstance(tag, str) and tag == tag.lower()
            assert " " not in tag
            assert tag.replace("_", "").isalnum()


def test_manias_json_every_entry_has_trigger_tags():
    data = json.loads((RULES_DIR / "manias.json").read_text(encoding="utf-8"))
    entries = data["manias"]
    assert len(entries) >= 90
    for name, entry in entries.items():
        tags = entry.get("trigger_tags")
        assert isinstance(tags, list) and len(tags) >= 2, f"{name} missing trigger_tags"
        for tag in tags:
            assert isinstance(tag, str) and tag == tag.lower()
            assert " " not in tag
            assert tag.replace("_", "").isalnum()


# --------------------------------------------------------------------------- #
# Phobia / mania resolution (direct)
# --------------------------------------------------------------------------- #
def test_roll_phobia_records_name_and_condition():
    s = _make_session(seed=7)
    name = s._roll_phobia()
    assert name is not None
    assert s.phobia == name
    assert f"phobia:{name}" in s.conditions
    assert isinstance(s.phobia_tags, list) and len(s.phobia_tags) >= 1
    assert any(ev.get("type") == "phobia_gained" for ev in s.events)


def test_roll_mania_records_name_and_condition():
    s = _make_session(seed=7)
    name = s._roll_mania()
    assert name is not None
    assert s.mania == name
    assert f"mania:{name}" in s.conditions
    assert isinstance(s.mania_tags, list) and len(s.mania_tags) >= 1
    assert s.mania_unindulged is True
    assert any(ev.get("type") == "mania_gained" for ev in s.events)


def test_roll_phonia_uses_1d100_range():
    """The phobia roll should pick from the 100-entry table."""
    table = coc_sanity._load_phobia_mania_table("phobias")
    assert len(table) >= 90
    for seed in range(20):
        s = _make_session(seed=seed)
        name = s._roll_phobia()
        assert name in table


def test_roll_phobia_does_not_duplicate_condition():
    s = _make_session(seed=3)
    s._roll_phobia()
    s._roll_phobia()
    phobia_conds = [c for c in s.conditions if c.startswith("phobia:")]
    assert len(phobia_conds) == len(set(phobia_conds))


# --------------------------------------------------------------------------- #
# Bout-of-madness integration (result 9 / 10)
# --------------------------------------------------------------------------- #
def _seed_for_bout_roll(target_roll: int) -> int:
    """Find a seed where _trigger_temporary_insanity's bout_roll == target."""
    for seed in range(500):
        rng = random.Random(seed)
        rng.randint(1, 10)  # duration_hours
        if rng.randint(1, 10) == target_roll:
            return seed
    raise RuntimeError(f"no seed found for bout_roll={target_roll}")


def test_bout_roll_9_yields_phobia():
    seed = _seed_for_bout_roll(9)
    s = _make_session(san=65, int_val=60, seed=seed)
    s._trigger_temporary_insanity("test horror", alone=False, module_bout_override=None)
    assert s.phobia is not None
    assert s.mania is None
    last_bout = s.bouts_of_madness[-1]
    assert last_bout["bout_roll"] == 9
    assert "phobia" in last_bout


def test_bout_roll_10_yields_mania():
    seed = _seed_for_bout_roll(10)
    s = _make_session(san=65, int_val=60, seed=seed)
    s._trigger_temporary_insanity("test horror", alone=False, module_bout_override=None)
    assert s.mania is not None
    assert s.phobia is None
    last_bout = s.bouts_of_madness[-1]
    assert last_bout["bout_roll"] == 10
    assert "mania" in last_bout
    assert s.mania_unindulged is True


def test_bout_roll_below_9_yields_no_phobia_or_mania():
    seed = _seed_for_bout_roll(5)
    s = _make_session(san=65, int_val=60, seed=seed)
    s._trigger_temporary_insanity("test horror", alone=False, module_bout_override=None)
    assert s.phobia is None
    assert s.mania is None


# --------------------------------------------------------------------------- #
# Structured penalty-die exposure (p.159) — no substring matching
# --------------------------------------------------------------------------- #
def test_penalty_die_zero_when_sane():
    s = _make_session()
    s.phobia = "Claustrophobia"
    s.phobia_tags = ["confined_space", "enclosed", "crowded_room"]
    assert s.is_insane is False
    result = s.penalty_die_for_exposure(exposure_tags={"confined_space"})
    assert result["penalty_dice"] == 0
    assert result["reason"] == "not_insane"


def test_penalty_die_one_when_insane_and_tags_intersect():
    s = _make_session()
    s.phobia = "Claustrophobia"
    s.phobia_tags = ["confined_space", "enclosed", "crowded_room"]
    s.temporary_insane = True
    result = s.penalty_die_for_exposure(exposure_tags={"confined_space", "darkness"})
    assert result["penalty_dice"] == 1
    assert "confined_space" in result["matched"]


def test_penalty_die_one_when_insane_and_mania_tags_intersect():
    s = _make_session()
    s.mania = "Pyromania"
    s.mania_tags = ["fire", "flames", "burning"]
    s.indefinite_insane = True
    result = s.penalty_die_for_exposure(exposure_tags=["fire", "heights"])
    assert result["penalty_dice"] == 1
    assert "fire" in result["matched"]


def test_penalty_die_zero_when_tags_disjoint():
    s = _make_session()
    s.phobia = "Claustrophobia"
    s.phobia_tags = ["confined_space", "enclosed"]
    s.temporary_insane = True
    result = s.penalty_die_for_exposure(exposure_tags={"heights", "cliff_edge"})
    assert result["penalty_dice"] == 0
    assert result["reason"] == "no_structured_exposure_evidence"
    assert result["matched"] == []


def test_penalty_die_zero_when_no_exposure_tags():
    s = _make_session()
    s.phobia = "Arachnophobia"
    s.phobia_tags = ["spiders", "webs"]
    s.temporary_insane = True
    result = s.penalty_die_for_exposure(exposure_tags=None)
    assert result["penalty_dice"] == 0
    assert result["reason"] == "no_structured_exposure_evidence"


def test_penalty_die_zero_when_symptoms_suppressed():
    s = _make_session()
    s.phobia = "Claustrophobia"
    s.phobia_tags = ["confined_space"]
    s.temporary_insane = True
    out = s.suppress_insanity_symptoms()
    assert out["symptoms_suppressed_until_next_san_loss"] is True
    result = s.penalty_die_for_exposure(exposure_tags={"confined_space"})
    assert result["penalty_dice"] == 0
    assert result["reason"] == "symptoms_suppressed"


def test_suppression_lapses_after_san_loss():
    s = _make_session(san=65, seed=1)
    s.temporary_insane = True
    s.suppress_insanity_symptoms()
    assert s.symptoms_suppressed_until_next_san_loss is True
    # Force a SAN loss >= 1
    s.sanity_check("horror", san_loss_success=1, san_loss_fail_expr="1D4",
                   involuntary_kind="freeze")
    assert s.symptoms_suppressed_until_next_san_loss is False


def test_indulge_mania_clears_unindulged_flag():
    s = _make_session(seed=7)
    s._roll_mania()
    assert s.mania_unindulged is True
    out = s.indulge_mania()
    assert s.mania_unindulged is False
    assert out["mania_unindulged"] is False


# --------------------------------------------------------------------------- #
# Snapshot / load includes tags + mania/suppression flags
# --------------------------------------------------------------------------- #
def test_snapshot_includes_phobia_mania_conditions():
    s = _make_session()
    s._roll_phobia()
    snap = s.snapshot()
    assert snap["phobia"] == s.phobia
    assert snap["phobia_tags"] == s.phobia_tags
    assert "conditions" in snap
    assert any(c.startswith("phobia:") for c in snap["conditions"])


def test_phobia_mania_tags_survive_save_load(tmp_path):
    s = coc_sanity.SanitySession("ada", san_max=60, int_value=50,
                                 rng=random.Random(9), campaign_dir=tmp_path)
    s._roll_phobia()
    s._roll_mania()
    s.symptoms_suppressed_until_next_san_loss = True
    s.save(tmp_path)
    loaded = coc_sanity.SanitySession.load(tmp_path, "ada")
    assert loaded.phobia == s.phobia
    assert loaded.phobia_tags == s.phobia_tags
    assert loaded.mania == s.mania
    assert loaded.mania_tags == s.mania_tags
    assert loaded.mania_unindulged is True
    assert loaded.symptoms_suppressed_until_next_san_loss is True


def test_sync_writes_phobia_mania_tags_to_investigator_state(tmp_path):
    s = coc_sanity.SanitySession("ada", san_max=60, int_value=50,
                                 rng=random.Random(3), campaign_dir=tmp_path)
    s._roll_phobia()
    s.temporary_insane = True
    s.save(tmp_path)
    inv = json.loads(
        (tmp_path / "save" / "investigator-state" / "ada.json").read_text(encoding="utf-8")
    )
    assert inv["phobia_tags"] == s.phobia_tags
    assert inv.get("temporary_insane") is True
