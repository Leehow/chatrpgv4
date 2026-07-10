#!/usr/bin/env python3
"""Tests for Cthulhu Mythos tracking (coc_mythos.py) and bout result
resolution in coc_sanity.py.

Validates:
- First Mythos encounter -> +5 CM; subsequent -> +1 CM (p.167).
- max_san = 99 - cm_value (p.167, F9).
- Current SAN clamped to the new max when CM rises.
- Bout-of-madness records carry result text + kind from Table VII/VIII.
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


coc_mythos = _load("coc_mythos", "coc_mythos.py")
coc_sanity = _load("coc_sanity", "coc_sanity.py")


# --------------------------------------------------------------------------- #
# max_san_for
# --------------------------------------------------------------------------- #
def test_max_san_for_zero_cm():
    assert coc_mythos.max_san_for(0) == 99


def test_max_san_for_nonzero_cm():
    assert coc_mythos.max_san_for(10) == 89
    assert coc_mythos.max_san_for(50) == 49


def test_max_san_for_clamps_at_zero():
    assert coc_mythos.max_san_for(100) == 0
    assert coc_mythos.max_san_for(150) == 0


# --------------------------------------------------------------------------- #
# gain_mythos -- first encounter
# --------------------------------------------------------------------------- #
def test_first_encounter_grants_5_cm():
    state = {"cm_value": 0, "current_san": 70, "max_san": 99}
    ev = coc_mythos.gain_mythos(state, is_first=True)
    assert state["cm_value"] == 5
    assert ev["cm_gain"] == 5
    assert ev["is_first"] is True


def test_first_encounter_reduces_max_san():
    state = {"cm_value": 0, "current_san": 99, "max_san": 99}
    coc_mythos.gain_mythos(state, is_first=True)
    assert state["max_san"] == 94  # 99 - 5


def test_first_encounter_clamps_current_san():
    """If current SAN exceeds the new max, it is clamped down."""
    state = {"cm_value": 0, "current_san": 99, "max_san": 99}
    ev = coc_mythos.gain_mythos(state, is_first=True)
    assert state["current_san"] == 94  # clamped to new max
    assert ev["san_clamped"] == 5


def test_first_encounter_no_clamp_when_below_max():
    state = {"cm_value": 0, "current_san": 50, "max_san": 99}
    ev = coc_mythos.gain_mythos(state, is_first=True)
    assert state["current_san"] == 50  # unchanged (below new max 94)
    assert ev["san_clamped"] == 0


# --------------------------------------------------------------------------- #
# gain_mythos -- subsequent encounters
# --------------------------------------------------------------------------- #
def test_subsequent_encounter_grants_1_cm():
    state = {"cm_value": 5, "current_san": 60, "max_san": 94}
    ev = coc_mythos.gain_mythos(state, is_first=False)
    assert state["cm_value"] == 6
    assert ev["cm_gain"] == 1
    assert state["max_san"] == 93  # 99 - 6


def test_explicit_amount_overrides_is_first():
    state = {"cm_value": 10, "current_san": 60, "max_san": 89}
    ev = coc_mythos.gain_mythos(state, amount=7)
    assert state["cm_value"] == 17
    assert ev["cm_gain"] == 7
    assert state["max_san"] == 82  # 99 - 17


def test_gain_mythos_defaults_cm_to_zero_when_absent():
    state = {"current_san": 70}
    coc_mythos.gain_mythos(state, is_first=True)
    assert state["cm_value"] == 5


# --------------------------------------------------------------------------- #
# gain_mythos_persisted (campaign-level)
# --------------------------------------------------------------------------- #
@pytest.fixture
def campaign(tmp_path):
    camp = tmp_path / "campaign"
    (camp / "save" / "investigator-state").mkdir(parents=True)
    (camp / "logs").mkdir(parents=True)
    return camp


def test_persisted_writes_cm_and_max_san(campaign):
    coc_mythos._write_inv_state(campaign, "inv1", {
        "investigator_id": "inv1", "cm_value": 0, "current_san": 70, "max_san": 99,
    })
    ev = coc_mythos.gain_mythos_persisted(campaign, "inv1", is_first=True)
    assert ev["cm_after"] == 5
    data = json.loads((campaign / "save" / "investigator-state" / "inv1.json").read_text())
    assert data["cm_value"] == 5
    assert data["max_san"] == 94
    log = (campaign / "logs" / "events.jsonl").read_text()
    assert "cthulhu_mythos_gain" in log


def test_persisted_preserves_other_fields(campaign):
    coc_mythos._write_inv_state(campaign, "inv1", {
        "investigator_id": "inv1", "current_hp": 12, "current_san": 60,
        "cm_value": 0, "max_san": 99, "conditions": [],
    })
    coc_mythos.gain_mythos_persisted(campaign, "inv1", is_first=True)
    data = json.loads((campaign / "save" / "investigator-state" / "inv1.json").read_text())
    assert data["current_hp"] == 12  # preserved
    assert data["conditions"] == []   # preserved


# --------------------------------------------------------------------------- #
# become_believer — believer flag (p.179 / W2-6)
# --------------------------------------------------------------------------- #
def test_become_believer_sets_believer_flag_in_memory():
    state = {"cm_value": 10, "current_san": 70, "max_san": 89}
    ev = coc_mythos.become_believer(state, source="first_hand_encounter", is_first=False)
    assert state["believer"] is True
    assert ev["event_type"] == "become_believer"


def test_become_believer_persisted_writes_believer_flag(campaign):
    coc_mythos._write_inv_state(campaign, "inv1", {
        "investigator_id": "inv1", "cm_value": 10, "current_san": 70, "max_san": 89,
    })
    coc_mythos.become_believer_persisted(
        campaign, "inv1", source="first_hand_encounter", is_first=False,
    )
    data = json.loads(
        (campaign / "save" / "investigator-state" / "inv1.json").read_text(encoding="utf-8")
    )
    assert data["believer"] is True
    assert data["cm_value"] == 11


def test_become_believer_persisted_roundtrip_load(campaign):
    """believer flag survives write → _read_inv_state roundtrip."""
    coc_mythos._write_inv_state(campaign, "inv1", {
        "investigator_id": "inv1", "cm_value": 5, "current_san": 60, "max_san": 94,
    })
    coc_mythos.become_believer_persisted(
        campaign, "inv1", source="tome", is_first=False,
    )
    loaded = coc_mythos._read_inv_state(campaign, "inv1")
    assert loaded["believer"] is True


# --------------------------------------------------------------------------- #
# Bout result resolution in SanitySession
# --------------------------------------------------------------------------- #
def _make_session(rng_seed=1, san_max=70, int_value=60):
    rng = random.Random(rng_seed)
    return coc_sanity.SanitySession("inv1", san_max=san_max, int_value=int_value,
                                    rng=rng)


def test_bout_resolves_result_and_kind_from_table():
    """A bout of madness record should carry result text + kind from the
    Table VII (realtime) or Table VIII (summary) lookup."""
    s = _make_session()
    # Force a sanity loss >= 5 to trigger temp insanity, then a bout.
    # Use a fixed seed so the INT roll succeeds (triggers the bout).
    # sanity_check rolls SAN vs current; we want failure (to lose SAN) then
    # the 5+ loss triggers the INT check. We seed to land on a known path.
    # Drive a sanity check with san_loss_fail high enough to lose >= 5.
    ev = s.sanity_check(
        source="deep one",
        san_loss_success=0,
        san_loss_fail_expr="1D6",
        involuntary_kind="freeze",
    )
    # If 5+ SAN was lost, a bout should have been created.
    if s.daily_san_lost >= 5:
        assert len(s.bouts_of_madness) >= 1
        bout = s.bouts_of_madness[-1]
        assert "bout_result" in bout
        assert "bout_kind" in bout
        # Result text should be non-empty (looked up from the table).
        assert bout["bout_result"] != ""
        assert bout["bout_kind"] != ""


def test_bout_summary_mode_when_alone():
    """When alone=True, the bout uses summary mode (Table VIII)."""
    # Construct a scenario that forces a bout in summary mode.
    s = _make_session(rng_seed=3)
    # Directly invoke the temp-insanity trigger to control the mode.
    s._trigger_temporary_insanity("test source", alone=True,
                                  module_bout_override=None)
    bout = s.bouts_of_madness[-1]
    assert bout["mode"] == "summary"
    assert bout["summary_table"] == "table_viii_summary"
    assert "bout_result" in bout


def test_bout_realtime_mode_when_not_alone():
    s = _make_session(rng_seed=3)
    s._trigger_temporary_insanity("test source", alone=False,
                                  module_bout_override=None)
    bout = s.bouts_of_madness[-1]
    assert bout["mode"] == "real_time"
    assert bout["summary_table"] == "table_vii_realtime"
    assert "bout_result" in bout


def test_resolve_bout_result_realtime_lookup():
    s = _make_session()
    entry = s._resolve_bout_result("realtime", 1)
    assert entry["result"] == "Amnesia"
    assert entry["kind"] == "loss_of_memory"


def test_resolve_bout_result_summary_lookup():
    s = _make_session()
    entry = s._resolve_bout_result("summary", 7)
    assert entry["result"] == "Institutionalized"
    assert entry["kind"] == "institutionalized"


def test_resolve_bout_result_missing_roll_returns_empty():
    s = _make_session()
    entry = s._resolve_bout_result("realtime", 99)
    assert entry == {}
