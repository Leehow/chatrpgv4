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
