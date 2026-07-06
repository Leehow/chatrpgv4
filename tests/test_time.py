#!/usr/bin/env python3
"""Tests for the deterministic world-clock layer (coc_time.py).

Validates: monotonic time, audit trail, trigger scheduling/firing,
safe-rest sanity reset, DirectorPlan integration, and category clamping.
"""
from __future__ import annotations

import json
import importlib.util
from pathlib import Path

import pytest


# --------------------------------------------------------------------------- #
# Module loading
# --------------------------------------------------------------------------- #
PLUGIN_ROOT = Path("plugins/coc-keeper")


def _load_coc_time():
    spec = importlib.util.spec_from_file_location(
        "coc_time", PLUGIN_ROOT / "scripts" / "coc_time.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


coc_time = _load_coc_time()


# --------------------------------------------------------------------------- #
# Fixtures
# --------------------------------------------------------------------------- #
@pytest.fixture
def campaign(tmp_path):
    """Create a minimal campaign directory with initialized time state."""
    camp = tmp_path / "campaign"
    (camp / "save").mkdir(parents=True)
    (camp / "logs").mkdir(parents=True)
    coc_time.initialize_time_state(
        camp,
        start={
            "campaign_id": "test",
            "calendar_mode": "gregorian",
            "local_datetime": "1925-01-15T20:00:00",
            "timezone": "America/New_York",
            "location_id": "arkham",
            "display": "1925-01-15 20:00, Arkham",
        },
    )
    return camp


# --------------------------------------------------------------------------- #
# Tests
# --------------------------------------------------------------------------- #
def test_time_state_initialized_for_new_campaign(campaign):
    state = coc_time.read_time_state(campaign)
    assert state["schema_version"] == 1
    assert state["clock"]["elapsed_minutes"] == 0
    assert state["sequence"] == 0
    assert state["clock"]["calendar_mode"] == "gregorian"
    assert state["clock"]["local_datetime"] == "1925-01-15T20:00:00"
    # triggers file also initialized
    trig = json.loads((campaign / "save" / "time-triggers.json").read_text())
    assert trig["triggers"] == []


def test_advance_time_is_monotonic(campaign):
    """Time never goes backward."""
    with pytest.raises(ValueError, match="monotonic"):
        coc_time.advance_time(campaign, -10, decision_id="bad", reason="test")


def test_advance_time_updates_elapsed_and_sequence(campaign):
    result = coc_time.advance_time(campaign, 30, decision_id="d1", reason="search room")
    assert result["from_elapsed"] == 0
    assert result["to_elapsed"] == 30
    state = coc_time.read_time_state(campaign)
    assert state["clock"]["elapsed_minutes"] == 30
    assert state["sequence"] == 1


def test_advance_time_writes_time_jsonl(campaign):
    coc_time.advance_time(campaign, 20, decision_id="d1", reason="search")
    log_lines = (campaign / "logs" / "time.jsonl").read_text().strip().split("\n")
    assert len(log_lines) >= 1
    record = json.loads(log_lines[-1])
    assert record["event_type"] == "time_advance"
    assert record["delta_minutes"] == 20
    assert record["reason"] == "search"
    assert record["decision_id"] == "d1"


def test_advance_time_updates_gregorian_datetime(campaign):
    """In gregorian mode, local_datetime should advance."""
    coc_time.advance_time(campaign, 120, decision_id="d1", reason="2 hours")
    state = coc_time.read_time_state(campaign)
    # Started at 20:00, +120 min = 22:00
    assert "22:00" in state["clock"]["local_datetime"]


def test_meta_turn_does_not_advance_time(campaign):
    """mode=none should not advance time."""
    plan = {
        "decision_id": "d-meta",
        "time_advance": {"mode": "none", "reason": "OOC question"},
    }
    events = coc_time.apply_time_advance_from_plan(campaign, plan, "inv1")
    assert events == []
    state = coc_time.read_time_state(campaign)
    assert state["clock"]["elapsed_minutes"] == 0


def test_apply_plan_applies_time_advance(campaign):
    plan = {
        "decision_id": "d1",
        "time_advance": {
            "mode": "elapsed",
            "category": "single_room_search",
            "delta_minutes": 20,
            "confidence": 0.8,
            "reason": "careful search",
        },
    }
    events = coc_time.apply_time_advance_from_plan(campaign, plan, "inv1")
    assert len(events) == 1
    assert events[0]["event_type"] == "game_time"
    assert events[0]["delta_minutes"] == 20
    state = coc_time.read_time_state(campaign)
    assert state["clock"]["elapsed_minutes"] == 20


def test_time_cost_clamping(campaign):
    """LLM proposes absurd delta → clamped to category max."""
    plan = {
        "decision_id": "d-clamp",
        "time_advance": {
            "mode": "elapsed",
            "category": "single_room_search",
            "delta_minutes": 999,  # way over max 45
            "reason": "overly thorough search",
        },
    }
    events = coc_time.apply_time_advance_from_plan(campaign, plan, "inv1")
    assert events[0]["delta_minutes"] == 45  # clamped
    # Warning should be logged
    log = (campaign / "logs" / "time.jsonl").read_text()
    assert "time_validation_warning" in log


def test_trigger_scheduling_and_peek(campaign):
    """Schedule a trigger and peek at due triggers."""
    trig_id = coc_time.schedule_trigger(campaign, {
        "kind": "condition_expiry",
        "scope": "investigator",
        "target_id": "inv1",
        "due_elapsed_minutes": 60,
        "policy": "auto_apply_if_safe",  # won't fire automatically since we test peek
        "handler": "recover_temporary_insanity",
        "payload": {"condition": "temporary_insane"},
    })
    # Not due yet at elapsed=0
    due = coc_time.peek_due_triggers(campaign)
    assert len(due) == 0
    # Advance past 60 — trigger is due but policy=auto_apply_if_safe
    # with safe_place=True so advance_time will fire it internally.
    # Use set_unsafe to keep it pending for peek test.
    coc_time.set_unsafe(campaign)
    coc_time.advance_time(campaign, 70, decision_id="d1", reason="wait")
    due = coc_time.peek_due_triggers(campaign)
    assert len(due) == 1
    assert due[0]["handler"] == "recover_temporary_insanity"


def test_trigger_fires_on_auto_apply(campaign):
    """auto_apply trigger fires when due."""
    coc_time.schedule_trigger(campaign, {
        "kind": "condition_expiry",
        "due_elapsed_minutes": 30,
        "policy": "auto_apply",
        "handler": "recover_temporary_insanity",
    })
    result = coc_time.advance_time(campaign, 40, decision_id="d1", reason="time passes")
    fired = result["fired_triggers"]
    assert len(fired) == 1
    assert fired[0]["status"] == "fired"


def test_trigger_defers_when_unsafe(campaign):
    """auto_apply_if_safe trigger defers when not in safe place."""
    coc_time.set_unsafe(campaign)  # explicitly unsafe
    coc_time.schedule_trigger(campaign, {
        "kind": "condition_expiry",
        "due_elapsed_minutes": 30,
        "policy": "auto_apply_if_safe",
        "handler": "recover_temporary_insanity",
    })
    result = coc_time.advance_time(campaign, 40, decision_id="d1", reason="danger")
    assert len(result["fired_triggers"]) == 0  # deferred
    # Trigger still pending
    due = coc_time.peek_due_triggers(campaign)
    assert len(due) == 1


def test_temp_insanity_schedules_recovery_trigger(campaign):
    """Simulate temp insanity trigger scheduling."""
    state = coc_time.read_time_state(campaign)
    now = state["clock"]["elapsed_minutes"]  # 0
    # Temp insanity: 1D10 hours → say 7 hours = 420 minutes
    duration_min = 7 * 60
    trig_id = coc_time.schedule_trigger(campaign, {
        "kind": "condition_expiry",
        "scope": "investigator",
        "target_id": "inv1",
        "due_elapsed_minutes": now + duration_min,
        "policy": "auto_apply_if_safe",
        "handler": "recover_temporary_insanity",
        "payload": {"condition": "temporary_insane"},
    })
    assert trig_id.startswith("trg-")
    # Not due yet
    coc_time.advance_time(campaign, 300, decision_id="d1", reason="5 hours pass")
    due = coc_time.peek_due_triggers(campaign)
    assert len(due) == 0  # still not due (need 420)


def test_temp_insanity_recovers_after_due_time_and_safe_rest(campaign):
    """Temp insanity recovers after duration passes AND safe rest."""
    coc_time.schedule_trigger(campaign, {
        "kind": "condition_expiry",
        "due_elapsed_minutes": 420,
        "policy": "auto_apply_if_safe",
        "handler": "recover_temporary_insanity",
    })
    # Advance past due but unsafe → deferred
    coc_time.advance_time(campaign, 450, decision_id="d1", reason="7.5 hours")
    due = coc_time.peek_due_triggers(campaign)
    assert len(due) == 1  # still pending
    # Now rest in safe place
    coc_time.mark_safe_rest(campaign, "inv1")
    # Process triggers again
    fired = coc_time.process_due_triggers(campaign)
    assert len(fired) == 1
    assert fired[0]["status"] == "fired"


def test_sanity_day_resets_after_safe_rest(campaign):
    """mark_safe_rest resets the investigator's sanity period."""
    state = coc_time.read_time_state(campaign)
    state["sanity_periods"]["inv1"] = {
        "started_elapsed": 0,
        "san_lost": 8,
        "threshold": 12,
    }
    import json
    (campaign / "save" / "time-state.json").write_text(json.dumps(state))
    # Advance time
    coc_time.advance_time(campaign, 480, decision_id="d1", reason="sleep 8h")
    # Mark safe rest
    result = coc_time.mark_safe_rest(campaign, "inv1")
    assert result["sanity_day_reset"] is True
    state = coc_time.read_time_state(campaign)
    assert state["sanity_periods"]["inv1"]["san_lost"] == 0


def test_build_time_signals(campaign):
    """build_time_signals produces correct director-facing signals."""
    coc_time.advance_time(campaign, 600, decision_id="d1", reason="10 hours")
    state = coc_time.read_time_state(campaign)
    signals = coc_time.build_time_signals(state, [])
    assert signals["elapsed_minutes"] == 600
    assert signals["hours_since_last_rest"] == 10.0
    assert "day_phase" in signals
    assert "time_pressure" in signals


def test_current_stamp(campaign):
    coc_time.advance_time(campaign, 120, decision_id="d1", reason="2h")
    stamp = coc_time.current_stamp(campaign)
    assert stamp["elapsed_minutes"] == 120
    assert "day_phase" in stamp
    assert "1925" in stamp["display"]
