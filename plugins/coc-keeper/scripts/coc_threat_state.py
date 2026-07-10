#!/usr/bin/env python3
"""Persistent threat-clock state for the Story Director.

Threat clocks (defined in ``threat-fronts.json`` as scenario data) track
escalating danger — a siege door being breached, an entity's curiosity
exhausting, etc.  The scenario file is an immutable definition; this module
owns the **runtime** progress in ``save/threat-state.json``.

This closes the gap where ``current_segments`` was read by the director
(``coc_story_director._clock_segments``) but never written anywhere, so
clocks were perpetually at 0 and ``on_full`` consequences never fired.
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from typing import Any

_SCRIPT_DIR = Path(__file__).resolve().parent


def _load_fileio():
    spec = importlib.util.spec_from_file_location("coc_fileio", _SCRIPT_DIR / "coc_fileio.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_fileio = _load_fileio()

THREAT_STATE_FILENAME = "threat-state.json"


def _state_path(save_dir: Path) -> Path:
    return save_dir / THREAT_STATE_FILENAME


def load_threat_state(save_dir: Path) -> dict[str, Any]:
    """Load threat-state.json, returning a well-formed shell if absent."""
    path = _state_path(save_dir)
    if not path.is_file():
        return {"schema_version": 1, "clocks": {}}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"schema_version": 1, "clocks": {}}
    if not isinstance(data, dict):
        return {"schema_version": 1, "clocks": {}}
    data.setdefault("schema_version", 1)
    data.setdefault("clocks", {})
    return data


def _save_state(save_dir: Path, state: dict[str, Any]) -> None:
    path = _state_path(save_dir)
    coc_fileio.write_json_atomic(
        path, state, indent=2, ensure_ascii=False, trailing_newline=True
    )


def init_threat_state(save_dir: Path) -> None:
    """Create an empty threat-state.json if one does not exist."""
    path = _state_path(save_dir)
    if not path.is_file():
        _save_state(save_dir, {"schema_version": 1, "clocks": {}})


def get_clock_segments(save_dir: Path, clock_id: str) -> int:
    """Return the live ``current_segments`` for a clock, or 0 if unrecorded."""
    state = load_threat_state(save_dir)
    clock = state["clocks"].get(clock_id, {})
    try:
        return int(clock.get("current_segments", 0))
    except (TypeError, ValueError):
        return 0


def tick_clock(save_dir: Path, clock_id: str, segments: int) -> bool:
    """Advance a clock by one segment and persist.

    Returns True if the clock **became full** as a result of this tick
    (i.e. it was not full before and reached ``segments`` now).  Ticking an
    already-full clock is a no-op returning False.
    """
    state = load_threat_state(save_dir)
    clocks = state["clocks"]
    clock = clocks.get(clock_id, {"current_segments": 0, "full": False})
    current = int(clock.get("current_segments", 0))
    was_full = bool(clock.get("full", False))
    if was_full or current >= segments:
        # Already full — no-op.
        clock["full"] = True
        clock["current_segments"] = min(current, segments)
        clocks[clock_id] = clock
        state["clocks"] = clocks
        _save_state(save_dir, state)
        return False
    current += 1
    became_full = current >= segments
    clock["current_segments"] = current
    clock["full"] = became_full
    clocks[clock_id] = clock
    state["clocks"] = clocks
    _save_state(save_dir, state)
    return became_full


def is_clock_full(save_dir: Path, clock_id: str) -> bool:
    """Check whether a clock has reached its segment total."""
    state = load_threat_state(save_dir)
    return bool(state["clocks"].get(clock_id, {}).get("full", False))
