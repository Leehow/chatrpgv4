#!/usr/bin/env python3
"""Tests for the threat-engine: persistent clock state, SAN settlement,
and danger attack profiles driven by the Story Director."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

PLUGIN_ROOT = Path(__file__).resolve().parent.parent / "plugins" / "coc-keeper"
SCRIPTS_DIR = PLUGIN_ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import coc_threat_state  # noqa: E402


# ---------------------------------------------------------------------------
# Task 2: clock tick wired into apply layer
# ---------------------------------------------------------------------------

def _mini_campaign(tmp_path: Path) -> Path:
    """Build a minimal campaign dir with scenario threat-fronts + save state."""
    camp = tmp_path / "campaign"
    (camp / "scenario").mkdir(parents=True)
    (camp / "save").mkdir(parents=True)
    (camp / "logs").mkdir(parents=True)
    # threat-fronts with a 3-segment clock
    (camp / "scenario" / "threat-fronts.json").write_text(json.dumps({
        "fronts": [{"front_id": "siege", "scope": "scenario",
                     "clocks": [{"clock_id": "door", "segments": 3,
                                 "on_tick_visible": ["creak", "crack", "gap"],
                                 "on_full": "door breached"}]}],
                     "dangers": []}))
    # minimal world-state + pacing-state
    (camp / "save" / "world-state.json").write_text(json.dumps({"active_scene_id": "s1", "discovered_clue_ids": []}))
    (camp / "save" / "pacing-state.json").write_text(json.dumps({"tension_level": "low", "turn_number": 0}))
    return camp


def test_apply_pressure_tick_persists_clock(tmp_path):
    """apply_plan with a pressure_move should tick the clock in threat-state.json."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("coc_director_apply", SCRIPTS_DIR / "coc_director_apply.py")
    apply_mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(apply_mod)

    camp = _mini_campaign(tmp_path)
    plan = {"decision_id": "t1", "scene_action": "PRESSURE",
            "pressure_moves": [{"clock_id": "door", "tick": 1, "visible_symptom": "creak", "reason": "test"}]}
    apply_mod.apply_plan(camp, plan, "inv1")
    state = coc_threat_state.load_threat_state(camp / "save")
    assert state["clocks"]["door"]["current_segments"] == 1
    assert state["clocks"]["door"]["full"] is False


def test_apply_pressure_tick_fires_clock_full_event(tmp_path):
    """When a tick fills a clock, apply emits a clock_full event with on_full text."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("coc_director_apply", SCRIPTS_DIR / "coc_director_apply.py")
    apply_mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(apply_mod)

    camp = _mini_campaign(tmp_path)
    # Pre-fill to 2/3 so one tick fills it
    coc_threat_state.tick_clock(camp / "save", "door", segments=3)
    coc_threat_state.tick_clock(camp / "save", "door", segments=3)
    assert coc_threat_state.get_clock_segments(camp / "save", "door") == 2

    plan = {"decision_id": "t2", "scene_action": "PRESSURE",
            "pressure_moves": [{"clock_id": "door", "tick": 1, "visible_symptom": "gap", "reason": "test"}]}
    events = apply_mod.apply_plan(camp, plan, "inv1")
    # clock now full
    assert coc_threat_state.is_clock_full(camp / "save", "door")
    # a clock_full event was emitted
    full_events = [e for e in events if e.get("event_type") == "clock_full"]
    assert len(full_events) == 1
    assert "door breached" in full_events[0].get("on_full", "")


# ---------------------------------------------------------------------------
# Task 3: scene on_enter hook (clock ticks on scene entry)
# ---------------------------------------------------------------------------

def _campaign_with_on_enter(tmp_path: Path) -> Path:
    """A campaign where scene-2 has on_enter.clock_ticks."""
    camp = tmp_path / "campaign"
    (camp / "scenario").mkdir(parents=True)
    (camp / "save").mkdir(parents=True)
    (camp / "logs").mkdir(parents=True)
    (camp / "scenario" / "story-graph.json").write_text(json.dumps({"scenes": [
        {"scene_id": "s1", "dramatic_question": "q1", "available_clues": ["c1"],
         "exit_conditions": [], "npc_ids": [], "pressure_moves": [], "tone": [],
         "entry_conditions": [], "allowed_improvisation": []},
        {"scene_id": "s2", "dramatic_question": "q2", "available_clues": [],
         "exit_conditions": [], "npc_ids": [], "pressure_moves": [], "tone": [],
         "entry_conditions": [], "allowed_improvisation": [],
         "on_enter": {"clock_ticks": [{"clock_id": "door", "reason": "entering siege"}]}},
    ]}))
    (camp / "scenario" / "threat-fronts.json").write_text(json.dumps({
        "fronts": [{"front_id": "siege", "scope": "scenario",
                     "clocks": [{"clock_id": "door", "segments": 3,
                                 "on_tick_visible": ["creak"], "on_full": "breached"}],
                     "dangers": []}]}))
    (camp / "save" / "world-state.json").write_text(json.dumps(
        {"active_scene_id": "s1", "discovered_clue_ids": ["c1"]}))
    (camp / "save" / "pacing-state.json").write_text(json.dumps({"tension_level": "low", "turn_number": 0}))
    return camp


def test_scene_enter_ticks_clock(tmp_path):
    """Advancing into a scene with on_enter.clock_ticks should tick the clock."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("coc_director_apply2", SCRIPTS_DIR / "coc_director_apply.py")
    apply_mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(apply_mod)

    camp = _campaign_with_on_enter(tmp_path)
    # s1's only clue c1 is already discovered → scene should advance to s2
    plan = {"decision_id": "t1", "scene_action": "REVEAL", "clue_policy": {},
            "rules_requests": [], "pressure_moves": []}
    events = apply_mod.apply_plan(camp, plan, "inv1")

    # scene advanced to s2
    world = json.loads((camp / "save" / "world-state.json").read_text())
    assert world["active_scene_id"] == "s2"
    # a scene_enter event fired
    enter_events = [e for e in events if e.get("event_type") == "scene_enter"]
    assert len(enter_events) == 1
    assert enter_events[0]["to_scene"] == "s2"
    # the door clock was ticked by on_enter
    assert coc_threat_state.get_clock_segments(camp / "save", "door") == 1


# ---------------------------------------------------------------------------
# Task 1: threat-state.json persistence layer
# ---------------------------------------------------------------------------

def _save_with_clocks(tmp_path: Path, clocks: dict) -> Path:
    """Write a threat-state.json with the given clock states. Returns the save dir."""
    save = tmp_path / "save"
    save.mkdir(parents=True, exist_ok=True)
    state = {"schema_version": 1, "clocks": clocks}
    (save / "threat-state.json").write_text(json.dumps(state), encoding="utf-8")
    return save


def test_load_threat_state_returns_empty_when_missing(tmp_path):
    save = tmp_path / "save"
    save.mkdir(parents=True, exist_ok=True)
    state = coc_threat_state.load_threat_state(save)
    assert state["clocks"] == {}


def test_tick_clock_increments_and_persists(tmp_path):
    save = _save_with_clocks(tmp_path, {"siege-door": {"current_segments": 1, "full": False}})
    coc_threat_state.tick_clock(save, "siege-door", segments=4)
    state = coc_threat_state.load_threat_state(save)
    assert state["clocks"]["siege-door"]["current_segments"] == 2
    assert state["clocks"]["siege-door"]["full"] is False


def test_tick_clock_detects_full(tmp_path):
    save = _save_with_clocks(tmp_path, {"siege-door": {"current_segments": 3, "full": False}})
    became_full = coc_threat_state.tick_clock(save, "siege-door", segments=4)
    assert became_full is True
    state = coc_threat_state.load_threat_state(save)
    assert state["clocks"]["siege-door"]["full"] is True
    assert state["clocks"]["siege-door"]["current_segments"] == 4


def test_tick_clock_does_not_exceed_segments(tmp_path):
    """A full clock should not tick past its segment count."""
    save = _save_with_clocks(tmp_path, {"entity": {"current_segments": 6, "full": True}})
    became_full = coc_threat_state.tick_clock(save, "entity", segments=6)
    # Already full — tick is a no-op, returns False (did not *become* full this tick)
    assert became_full is False
    state = coc_threat_state.load_threat_state(save)
    assert state["clocks"]["entity"]["current_segments"] == 6


def test_tick_clock_unknown_creates_entry(tmp_path):
    """Ticking a clock that has no saved state starts from 0 then increments."""
    save = _save_with_clocks(tmp_path, {})
    became_full = coc_threat_state.tick_clock(save, "new-clock", segments=4)
    assert became_full is False
    state = coc_threat_state.load_threat_state(save)
    assert state["clocks"]["new-clock"]["current_segments"] == 1
    assert state["clocks"]["new-clock"]["full"] is False


def test_get_clock_segments_returns_live_or_zero(tmp_path):
    """Merge helper: return live current_segments from threat-state, or 0."""
    save = _save_with_clocks(tmp_path, {"known": {"current_segments": 2, "full": False}})
    assert coc_threat_state.get_clock_segments(save, "known") == 2
    assert coc_threat_state.get_clock_segments(save, "unknown") == 0


def test_init_threat_state_creates_file(tmp_path):
    """Initialization creates an empty threat-state.json."""
    save = tmp_path / "save"
    save.mkdir(parents=True, exist_ok=True)
    coc_threat_state.init_threat_state(save)
    assert (save / "threat-state.json").exists()
    state = json.loads((save / "threat-state.json").read_text())
    assert state["clocks"] == {}
