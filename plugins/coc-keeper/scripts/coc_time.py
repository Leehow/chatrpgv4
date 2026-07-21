#!/usr/bin/env python3
"""Deterministic world-clock layer for Call of Cthulhu campaigns.

Implements a monotonic, script-owned game-time system that is the single
source of truth for in-world elapsed time. The LLM proposes how long an
action takes (via DirectorPlan.time_advance); this module validates,
clamps, advances, and fires time-based triggers.

Design principles (historical spec retired; see docs/status/DIAGNOSIS-LEDGER.md):
1. elapsed_minutes only moves forward; never backward.
2. LLM estimates time, script advances the clock.
3. Game time and real (UTC) time are separate.
4. Relative time (elapsed_minutes) is the core axis; calendar display
   is a derived rendering layer.

Files managed:
  save/time-state.json     — current world clock (single source of truth)
  save/time-triggers.json  — pending future events
  logs/time.jsonl          — audit chain (why time advanced)
"""
from __future__ import annotations

import importlib.util
import json
import uuid
from datetime import datetime, timedelta
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


CALENDAR_MODES = frozenset({
    "relative",
    "gregorian",
    "julian",
    "proleptic_gregorian",
    "fictional",
})
TIME_PRECISIONS = frozenset({"exact", "minute", "hour", "date", "day_phase", "unknown"})
DAY_PHASES = frozenset({"morning", "afternoon", "evening", "night", "unknown"})
TIME_APPEARANCE_MODES = frozenset({
    "normal",
    "perpetual_daylight",
    "perpetual_darkness",
    "inverted",
    "distorted",
})


# --------------------------------------------------------------------------- #
# Path helpers
# --------------------------------------------------------------------------- #
def _time_state_path(campaign_dir: Path) -> Path:
    return campaign_dir / "save" / "time-state.json"


def _triggers_path(campaign_dir: Path) -> Path:
    return campaign_dir / "save" / "time-triggers.json"


def _time_log_path(campaign_dir: Path) -> Path:
    return campaign_dir / "logs" / "time.jsonl"


# --------------------------------------------------------------------------- #
# Read / write helpers
# --------------------------------------------------------------------------- #
def _read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: Path, data: Any) -> None:
    coc_fileio.write_json_atomic(
        path, data, indent=2, ensure_ascii=False, trailing_newline=True
    )


def _append_jsonl(path: Path, record: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


# --------------------------------------------------------------------------- #
# Clock helpers
# --------------------------------------------------------------------------- #
def _compute_local_datetime(base_dt: str | None, delta_minutes: int) -> str | None:
    """Advance an ISO datetime string by delta_minutes. Returns None if
    base is None (relative calendar mode)."""
    if base_dt is None:
        return None
    try:
        dt = datetime.fromisoformat(base_dt)
        return (dt + timedelta(minutes=delta_minutes)).isoformat()
    except (ValueError, TypeError):
        return base_dt


def _day_phase(
    elapsed_minutes: int,
    *,
    local_datetime: str | None = None,
    day_length_minutes: int = 1440,
    boundaries: dict[str, Any] | None = None,
) -> str:
    """Return day phase from calendar time, falling back to relative elapsed time."""
    minute_of_day = elapsed_minutes % day_length_minutes
    if local_datetime:
        try:
            local = datetime.fromisoformat(local_datetime)
            minute_of_day = local.hour * 60 + local.minute
        except (ValueError, TypeError):
            pass

    defaults = {
        "morning_start": 6 * 60,
        "afternoon_start": 12 * 60,
        "evening_start": 18 * 60,
        "night_start": 21 * 60,
    }
    parsed = dict(defaults)
    if isinstance(boundaries, dict):
        for key in defaults:
            raw = boundaries.get(key)
            if not isinstance(raw, str):
                continue
            try:
                hour, minute = (int(part) for part in raw.split(":", 1))
            except (TypeError, ValueError):
                continue
            if 0 <= hour <= 23 and 0 <= minute <= 59:
                parsed[key] = hour * 60 + minute
    morning = parsed["morning_start"]
    afternoon = parsed["afternoon_start"]
    evening = parsed["evening_start"]
    night = parsed["night_start"]
    # Malformed or non-monotonic module metadata cannot redefine the clock.
    if not morning < afternoon < evening < night:
        morning, afternoon, evening, night = defaults.values()
    if morning <= minute_of_day < afternoon:
        return "morning"
    if afternoon <= minute_of_day < evening:
        return "afternoon"
    if evening <= minute_of_day < night:
        return "evening"
    return "night"


def _clock_day_phase(clock: dict[str, Any], elapsed_minutes: int) -> str:
    """Resolve day phase without inventing a precise civil time.

    A source may establish only a date or a broad phase such as "first half of
    the night".  In that case ``local_datetime`` intentionally stays null and
    the source-bound hint wins over the otherwise misleading modulo-elapsed
    fallback.
    """
    if not clock.get("local_datetime"):
        hint = clock.get("day_phase_hint")
        if hint in DAY_PHASES:
            return str(hint)
    return _day_phase(
        elapsed_minutes,
        local_datetime=clock.get("local_datetime"),
        boundaries=clock.get("day_phase_boundaries"),
    )


def _validate_iso_date(value: str) -> str:
    raw = str(value).strip()
    try:
        datetime.fromisoformat(f"{raw}T00:00:00")
    except (TypeError, ValueError) as exc:
        raise ValueError(f"local_date must be ISO YYYY-MM-DD, got {value!r}") from exc
    return raw


def _validate_iso_datetime(value: str) -> str:
    raw = str(value).strip()
    try:
        datetime.fromisoformat(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"local_datetime must be an ISO datetime, got {value!r}") from exc
    return raw


def _civil_clock_projection(clock: dict[str, Any]) -> dict[str, Any]:
    return {
        "calendar_mode": clock.get("calendar_mode"),
        "local_datetime": clock.get("local_datetime"),
        "local_date": clock.get("local_date"),
        "timezone": clock.get("timezone"),
        "display": clock.get("display", ""),
        "time_precision": clock.get("time_precision"),
        "day_phase_hint": clock.get("day_phase_hint"),
        "location_id": clock.get("location_id"),
        "civil_anchor_elapsed": clock.get("civil_anchor_elapsed"),
        "civil_segment_id": clock.get("civil_segment_id"),
    }


def _player_time_projection(
    clock: dict[str, Any], elapsed_minutes: int,
) -> dict[str, Any]:
    """Project broad player-facing time without leaking clock arithmetic."""
    mode = str(clock.get("appearance_mode") or "normal")
    if mode not in TIME_APPEARANCE_MODES:
        mode = "normal"
    return {
        "phase": _clock_day_phase(clock, elapsed_minutes),
        "appearance_mode": mode,
        "display_label": clock.get("appearance_display_label"),
        "source_ref": clock.get("appearance_source_ref"),
    }


# --------------------------------------------------------------------------- #
# Public API
# --------------------------------------------------------------------------- #
def initialize_time_state(
    campaign_dir: Path,
    *,
    start: dict[str, Any] | None = None,
) -> Path:
    """Create save/time-state.json with initial values if it does not exist.

    ``start`` may contain clock fields like:
        calendar_mode, local_datetime, timezone, location_id, display
    """
    path = _time_state_path(campaign_dir)
    if path.exists():
        return path
    start = start or {}
    clock = {
        "elapsed_minutes": 0,
        "scale": start.get("scale", "scene"),
        "calendar_mode": start.get("calendar_mode", "relative"),
        "local_datetime": start.get("local_datetime"),
        "timezone": start.get("timezone"),
        "location_id": start.get("location_id"),
        "display": start.get("display", ""),
        "day_phase_boundaries": start.get("day_phase_boundaries"),
        "local_date": start.get("local_date"),
        "time_precision": start.get("time_precision"),
        "day_phase_hint": start.get("day_phase_hint"),
        "civil_anchor_elapsed": 0,
        "civil_segment_id": start.get("civil_segment_id", "civil-start"),
        "discontinuity_sequence": 0,
        "appearance_mode": start.get("appearance_mode", "normal"),
        "appearance_display_label": start.get("appearance_display_label"),
        "appearance_source_ref": start.get("appearance_source_ref"),
    }
    state = {
        "schema_version": 1,
        "campaign_id": start.get("campaign_id", ""),
        "timeline_id": start.get("timeline_id", "tl-main"),
        "branch_id": start.get("branch_id", "main"),
        "forked_from": None,
        "sequence": 0,
        "clock": clock,
        "anchors": {
            "campaign_start_elapsed": 0,
            "last_rest_elapsed": 0,
            "last_safe_place_elapsed": 0,
            "last_scene_change_elapsed": 0,
        },
        "sanity_periods": {},
        "safe_place": False,
    }
    _write_json(path, state)
    # Also init triggers and log
    _write_json(_triggers_path(campaign_dir), {"schema_version": 1, "triggers": []})
    _time_log_path(campaign_dir).touch()
    return path


def read_time_state(campaign_dir: Path) -> dict[str, Any]:
    """Read the full time-state.json, returning an empty dict if missing."""
    return _read_json(_time_state_path(campaign_dir))


def current_stamp(campaign_dir: Path) -> dict[str, Any]:
    """Return a compact current-time snapshot for display."""
    state = read_time_state(campaign_dir)
    if not state:
        return {
            "elapsed_minutes": 0,
            "display": "",
            "location_id": None,
            "day_phase": "unknown",
            "player_time": {
                "phase": "unknown",
                "appearance_mode": "normal",
                "display_label": None,
                "source_ref": None,
            },
        }
    clock = state.get("clock", {})
    elapsed = int(clock.get("elapsed_minutes", 0))
    civil_anchor_elapsed = int(clock.get("civil_anchor_elapsed", 0) or 0)
    return {
        "elapsed_minutes": elapsed,
        "display": clock.get("display", ""),
        "local_datetime": clock.get("local_datetime"),
        "local_date": clock.get("local_date"),
        "calendar_mode": clock.get("calendar_mode"),
        "time_precision": clock.get("time_precision"),
        "timezone": clock.get("timezone"),
        "location_id": clock.get("location_id"),
        "day_phase": _clock_day_phase(clock, elapsed),
        "civil_segment_id": clock.get("civil_segment_id"),
        "minutes_since_civil_anchor": max(0, elapsed - civil_anchor_elapsed),
        "player_time": _player_time_projection(clock, elapsed),
    }


def set_time_appearance(
    campaign_dir: Path,
    *,
    mode: str,
    decision_id: str,
    reason: str,
    display_label: str | None = None,
    source_ref: str | None = None,
) -> dict[str, Any]:
    """Change perceived light/time presentation without changing the clock."""
    normalized_mode = str(mode or "").strip()
    if normalized_mode not in TIME_APPEARANCE_MODES:
        raise ValueError(f"unsupported time appearance mode: {mode!r}")
    decision = str(decision_id or "").strip()
    if not decision:
        raise ValueError("decision_id must be non-empty")
    why = str(reason or "").strip()
    if not why:
        raise ValueError("reason must be non-empty")
    label = None if display_label is None else str(display_label).strip()
    if display_label is not None and not label:
        raise ValueError("display_label must be non-empty when supplied")

    path = _time_state_path(campaign_dir)
    state = _read_json(path)
    if not state:
        initialize_time_state(campaign_dir)
        state = _read_json(path)
    clock = state.setdefault("clock", {})
    anchors = state.setdefault("anchors", {})
    previous_stamp = current_stamp(campaign_dir)
    if anchors.get("last_time_appearance_decision_id") == decision:
        return {
            "mode": normalized_mode,
            "previous_time": previous_stamp,
            "current_time": previous_stamp,
            "duplicate": True,
        }
    clock["appearance_mode"] = normalized_mode
    clock["appearance_display_label"] = label
    clock["appearance_source_ref"] = (
        None if source_ref is None else str(source_ref)
    )
    anchors["last_time_appearance_decision_id"] = decision
    state["sequence"] = int(state.get("sequence", 0)) + 1
    _write_json(path, state)
    current = current_stamp(campaign_dir)
    _append_jsonl(_time_log_path(campaign_dir), {
        "event_type": "time_appearance_changed",
        "seq": state["sequence"],
        "decision_id": decision,
        "elapsed_minutes": int(clock.get("elapsed_minutes", 0)),
        "from_player_time": previous_stamp.get("player_time"),
        "to_player_time": current.get("player_time"),
        "reason": why,
        "source_ref": None if source_ref is None else str(source_ref),
    })
    return {
        "mode": normalized_mode,
        "previous_time": previous_stamp,
        "current_time": current,
        "duplicate": False,
    }


def record_scene_change(
    campaign_dir: Path,
    location_id: str,
    *,
    decision_id: str,
    reason: str = "",
) -> dict[str, Any]:
    """Synchronize the world-clock location with an authoritative scene move."""
    path = _time_state_path(campaign_dir)
    state = _read_json(path)
    if not state:
        initialize_time_state(campaign_dir)
        state = _read_json(path)
    clock = state.setdefault("clock", {})
    anchors = state.setdefault("anchors", {})
    if anchors.get("last_scene_change_decision_id") == decision_id:
        return {
            "from_location_id": clock.get("location_id"),
            "to_location_id": clock.get("location_id"),
            "elapsed_minutes": int(clock.get("elapsed_minutes", 0)),
            "duplicate": True,
        }
    from_location = clock.get("location_id")
    elapsed = int(clock.get("elapsed_minutes", 0))
    clock["location_id"] = str(location_id)
    anchors["last_scene_change_elapsed"] = elapsed
    anchors["last_scene_change_decision_id"] = decision_id
    state["sequence"] = int(state.get("sequence", 0)) + 1
    _write_json(path, state)
    _append_jsonl(_time_log_path(campaign_dir), {
        "event_type": "scene_change",
        "seq": state["sequence"],
        "decision_id": decision_id,
        "from_location_id": from_location,
        "to_location_id": str(location_id),
        "elapsed_minutes": elapsed,
        "reason": reason,
    })
    return {
        "from_location_id": from_location,
        "to_location_id": str(location_id),
        "elapsed_minutes": elapsed,
        "duplicate": False,
    }


def record_clock_discontinuity(
    campaign_dir: Path,
    *,
    discontinuity_kind: str,
    calendar_mode: str,
    precision: str,
    display: str,
    decision_id: str,
    reason: str,
    local_datetime: str | None = None,
    local_date: str | None = None,
    timezone: str | None = None,
    day_phase: str | None = None,
    source_ref: str | None = None,
    civil_anchor_elapsed: int | None = None,
) -> dict[str, Any]:
    """Replace the civil-calendar anchor while keeping elapsed time monotonic.

    This is the explicit state operation for source-authored time travel,
    loop resets, dream-time transitions, and calendar corrections.  It never
    rewinds ``elapsed_minutes`` or relative trigger deadlines.  Imprecise
    source truth is represented without manufacturing a clock time: callers
    can provide ``local_date`` + ``day_phase`` and leave ``local_datetime``
    absent.
    """
    kind = str(discontinuity_kind or "").strip()
    if kind not in {"time_shift", "loop_reset", "dream_transition", "calendar_correction", "other"}:
        raise ValueError(f"unsupported discontinuity_kind: {discontinuity_kind!r}")
    mode = str(calendar_mode or "").strip()
    if mode not in CALENDAR_MODES:
        raise ValueError(f"unsupported calendar_mode: {calendar_mode!r}")
    precision_value = str(precision or "").strip()
    if precision_value not in TIME_PRECISIONS:
        raise ValueError(f"unsupported time precision: {precision!r}")
    rendered = str(display or "").strip()
    if not rendered:
        raise ValueError("display must be a non-empty civil-time rendering")
    decision = str(decision_id or "").strip()
    if not decision:
        raise ValueError("decision_id must be non-empty")
    why = str(reason or "").strip()
    if not why:
        raise ValueError("reason must be non-empty")

    normalized_datetime = (
        _validate_iso_datetime(local_datetime) if local_datetime is not None else None
    )
    normalized_date = _validate_iso_date(local_date) if local_date is not None else None
    if normalized_datetime is not None:
        datetime_date = normalized_datetime.split("T", 1)[0]
        if normalized_date is not None and normalized_date != datetime_date:
            raise ValueError("local_date must match the date portion of local_datetime")
        normalized_date = normalized_date or datetime_date
    if precision_value in {"exact", "minute", "hour"} and normalized_datetime is None:
        raise ValueError(f"precision={precision_value} requires local_datetime")
    if precision_value in {"date", "day_phase"} and normalized_date is None:
        raise ValueError(f"precision={precision_value} requires local_date")
    normalized_phase = None if day_phase is None else str(day_phase).strip()
    if normalized_phase is not None and normalized_phase not in DAY_PHASES:
        raise ValueError(f"unsupported day_phase: {day_phase!r}")
    if precision_value == "day_phase" and normalized_phase in {None, "unknown"}:
        raise ValueError("precision=day_phase requires a known day_phase")

    path = _time_state_path(campaign_dir)
    state = _read_json(path)
    if not state:
        initialize_time_state(campaign_dir)
        state = _read_json(path)
    clock = state.setdefault("clock", {})
    anchors = state.setdefault("anchors", {})
    elapsed = int(clock.get("elapsed_minutes", 0))
    if civil_anchor_elapsed is None:
        anchor_elapsed = elapsed
    else:
        if isinstance(civil_anchor_elapsed, bool):
            raise ValueError("civil_anchor_elapsed must be an integer")
        anchor_elapsed = int(civil_anchor_elapsed)
        if anchor_elapsed < 0 or anchor_elapsed > elapsed:
            raise ValueError(
                "civil_anchor_elapsed must be between 0 and current elapsed_minutes"
            )
    if anchors.get("last_clock_discontinuity_decision_id") == decision:
        return {
            "discontinuity_kind": kind,
            "elapsed_minutes": elapsed,
            "civil_anchor_elapsed": clock.get("civil_anchor_elapsed"),
            "civil_time": _civil_clock_projection(clock),
            "duplicate": True,
        }

    previous = _civil_clock_projection(clock)
    discontinuity_sequence = int(clock.get("discontinuity_sequence", 0) or 0) + 1
    clock.update({
        "calendar_mode": mode,
        "local_datetime": normalized_datetime,
        "local_date": normalized_date,
        "timezone": None if timezone is None else str(timezone),
        "display": rendered,
        "time_precision": precision_value,
        "day_phase_hint": normalized_phase,
        "civil_anchor_elapsed": anchor_elapsed,
        "civil_segment_id": decision,
        "discontinuity_sequence": discontinuity_sequence,
    })
    state["clock"] = clock
    anchors["last_clock_discontinuity_elapsed"] = anchor_elapsed
    anchors["last_clock_discontinuity_decision_id"] = decision
    state["sequence"] = int(state.get("sequence", 0)) + 1
    _write_json(path, state)

    current = _civil_clock_projection(clock)
    log_record = {
        "event_type": "clock_discontinuity",
        "seq": state["sequence"],
        "decision_id": decision,
        "discontinuity_kind": kind,
        "elapsed_minutes": elapsed,
        "civil_anchor_elapsed": anchor_elapsed,
        "from_civil_time": previous,
        "to_civil_time": current,
        "reason": why,
        "source_ref": None if source_ref is None else str(source_ref),
    }
    _append_jsonl(_time_log_path(campaign_dir), log_record)
    return {
        "discontinuity_kind": kind,
        "elapsed_minutes": elapsed,
        "civil_anchor_elapsed": anchor_elapsed,
        "from_civil_time": previous,
        "civil_time": current,
        "current_time": current_stamp(campaign_dir),
        "relative_deadlines_preserved": True,
        "duplicate": False,
    }


def advance_time(
    campaign_dir: Path,
    delta_minutes: int,
    *,
    decision_id: str,
    reason: str,
    source: str = "llm_proposal",
    confidence: float = 1.0,
    category: str | None = None,
    idempotency_key: str | None = None,
    requested_mode: str | None = None,
    day_phase_after: str | None = None,
    display_after: str | None = None,
) -> dict[str, Any]:
    """Advance the world clock by ``delta_minutes``.

    Raises ValueError if delta_minutes < 0 (time is monotonic).
    Writes an audit record to logs/time.jsonl. Processes due triggers
    after advancing. Returns a summary dict.
    """
    phase_after = (
        None if day_phase_after is None else str(day_phase_after).strip()
    )
    rendered_after = (
        None if display_after is None else str(display_after).strip()
    )
    if phase_after is not None and phase_after not in DAY_PHASES - {"unknown"}:
        raise ValueError(f"unsupported day_phase_after: {day_phase_after!r}")
    if (phase_after is None) != (rendered_after is None):
        raise ValueError(
            "day_phase_after and display_after must be supplied together"
        )
    if phase_after is not None and not rendered_after:
        raise ValueError("display_after must be non-empty for a phase transition")
    if phase_after is not None and delta_minutes <= 0:
        raise ValueError("a day-phase transition requires positive elapsed time")
    if delta_minutes < 0:
        raise ValueError(
            f"time is monotonic: cannot advance by {delta_minutes} minutes "
            f"(decision_id={decision_id})"
        )
    if delta_minutes == 0:
        # No-op; still record for audit
        stamp = current_stamp(campaign_dir)
        elapsed = int(stamp.get("elapsed_minutes", 0))
        return {
            "from_elapsed": elapsed,
            "to_elapsed": elapsed,
            "delta_minutes": 0,
            "fired_triggers": [],
            "current_time": stamp,
            "previous_time": stamp,
        }

    path = _time_state_path(campaign_dir)
    state = _read_json(path)
    if not state:
        initialize_time_state(campaign_dir)
        state = _read_json(path)

    clock = state.get("clock", {})
    previous_stamp = current_stamp(campaign_dir)
    phase_before = _clock_day_phase(
        clock, int(clock.get("elapsed_minutes", 0))
    )
    if phase_after is not None and clock.get("local_datetime"):
        raise ValueError(
            "day_phase_after is only valid for an imprecise civil clock; "
            "precise clocks derive phase from local_datetime"
        )
    from_elapsed = int(clock.get("elapsed_minutes", 0))
    to_elapsed = from_elapsed + delta_minutes
    clock["elapsed_minutes"] = to_elapsed

    # Advance a precise civil clock. Imprecise source anchors intentionally
    # remain display-only; elapsed_minutes is still authoritative for duration.
    if clock.get("calendar_mode") in {"gregorian", "proleptic_gregorian", "julian"} and clock.get("local_datetime"):
        clock["local_datetime"] = _compute_local_datetime(
            clock["local_datetime"], delta_minutes
        )
        clock["local_date"] = str(clock["local_datetime"]).split("T", 1)[0]
        try:
            rendered = datetime.fromisoformat(clock["local_datetime"]).strftime("%Y-%m-%d %H:%M")
            old_display = str(clock.get("display") or "")
            suffix = old_display[old_display.index(","):] if "," in old_display else ""
            clock["display"] = rendered + suffix
        except (ValueError, TypeError):
            pass
    elif phase_after is not None:
        clock["day_phase_hint"] = phase_after
        clock["display"] = rendered_after

    state["clock"] = clock
    state["sequence"] = int(state.get("sequence", 0)) + 1
    _write_json(path, state)

    # Audit log
    fired = process_due_triggers(campaign_dir)
    log_record = {
        "event_type": "time_advance",
        "seq": state["sequence"],
        "decision_id": decision_id,
        "from_elapsed": from_elapsed,
        "to_elapsed": to_elapsed,
        "delta_minutes": delta_minutes,
        "reason": reason,
        "source": source,
        "confidence": confidence,
        "category": category,
        "fired_triggers": [t.get("trigger_id", "") for t in fired],
    }
    if idempotency_key is not None:
        log_record["idempotency_key"] = idempotency_key
        log_record["requested_mode"] = requested_mode
    if phase_after is not None:
        log_record["day_phase_transition"] = {
            "before": phase_before,
            "after": phase_after,
            "display_after": rendered_after,
        }
    stamp = current_stamp(campaign_dir)
    log_record["current_time"] = stamp
    _append_jsonl(_time_log_path(campaign_dir), log_record)

    result = {
        "from_elapsed": from_elapsed,
        "to_elapsed": to_elapsed,
        "delta_minutes": delta_minutes,
        "fired_triggers": fired,
        "current_time": stamp,
        "previous_time": previous_stamp,
    }
    if phase_after is not None:
        result["day_phase_transition"] = {
            "before": phase_before,
            "after": phase_after,
            "display_after": rendered_after,
        }
    return result


# --------------------------------------------------------------------------- #
# Triggers
# --------------------------------------------------------------------------- #
def schedule_trigger(campaign_dir: Path, trigger: dict[str, Any]) -> str:
    """Add a pending trigger to time-triggers.json. Returns trigger_id."""
    path = _triggers_path(campaign_dir)
    data = _read_json(path)
    if not data:
        data = {"schema_version": 1, "triggers": []}
    triggers = data.get("triggers", [])
    trigger_id = trigger.get("trigger_id") or f"trg-{uuid.uuid4().hex[:12]}"
    trigger["trigger_id"] = trigger_id
    trigger["status"] = trigger.get("status", "pending")
    triggers.append(trigger)
    data["triggers"] = triggers
    _write_json(path, data)
    return trigger_id


def peek_due_triggers(campaign_dir: Path) -> list[dict[str, Any]]:
    """Return triggers whose due_elapsed_minutes has passed but are still pending."""
    state = read_time_state(campaign_dir)
    now = int(state.get("clock", {}).get("elapsed_minutes", 0))
    data = _read_json(_triggers_path(campaign_dir))
    triggers = data.get("triggers", [])
    return [
        t for t in triggers
        if t.get("status") == "pending"
        and int(t.get("due_elapsed_minutes", float("inf"))) <= now
    ]


def process_due_triggers(campaign_dir: Path) -> list[dict[str, Any]]:
    """Process all due triggers. Returns list of fired trigger records.

    For triggers with policy 'auto_apply_if_safe', checks the safe_place
    flag in time-state. If not safe, the trigger is deferred (stays pending).

    When a fired trigger carries a ``handler`` string, the handler is
    dispatched (see ``_dispatch_handler``). Handler failures are isolated:
    the trigger still fires, and the exception is recorded on the trigger's
    ``dispatch_error`` field + the time log, never blocking time advance.
    """
    state = read_time_state(campaign_dir)
    safe_place = bool(state.get("safe_place", False))
    fired: list[dict[str, Any]] = []

    path = _triggers_path(campaign_dir)
    data = _read_json(path)
    triggers = data.get("triggers", [])

    for t in triggers:
        if t.get("status") != "pending":
            continue
        now = int(state.get("clock", {}).get("elapsed_minutes", 0))
        due = int(t.get("due_elapsed_minutes", float("inf")))
        if due > now:
            continue
        # Check policy
        policy = t.get("policy", "auto_apply")
        if policy == "auto_apply_if_safe" and not safe_place:
            # Defer — remain pending until safe
            continue
        # Fire
        t["status"] = "fired"
        t["fired_at_elapsed"] = now
        # Dispatch the handler, if any. Isolated: a handler bug must not
        # block time advance or leave the trigger stuck pending.
        handler = t.get("handler")
        if handler:
            try:
                outcome = _dispatch_handler(
                    campaign_dir,
                    t.get("target_id", ""),
                    handler,
                    t.get("payload", {}),
                )
                if outcome:
                    t["dispatch_outcome"] = outcome
            except Exception as exc:  # noqa: BLE001 — isolation boundary
                t["dispatch_error"] = f"{type(exc).__name__}: {exc}"
        fired.append(t)
        # Log
        _append_jsonl(_time_log_path(campaign_dir), {
            "event_type": "trigger_fired",
            "trigger_id": t.get("trigger_id", ""),
            "kind": t.get("kind", ""),
            "handler": handler or "",
            "fired_at_elapsed": now,
            "payload": t.get("payload", {}),
            "dispatch_error": t.get("dispatch_error"),
        })

    data["triggers"] = triggers
    _write_json(path, data)
    return fired


def _dispatch_handler(campaign_dir: Path, investigator_id: str,
                      handler: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    """Dispatch a fired trigger's handler. Returns an outcome summary dict.

    Handlers are loaded lazily (sibling scripts via importlib) to avoid a
    circular import at module load. Each handler rebuilds the relevant
    session from disk, runs the rulebook action, and persists the result.

    Known handlers:
      - ``recover_temporary_insanity``: p.176 temp insanity recovery. Rebuilds
        a SanitySession, runs ``recover_temporary()``, saves.
      - ``apply_psychoanalysis_treatment``: p.164 weekly Psychoanalysis. Builds
        a PsychotherapySession from investigator-state, runs
        ``psychoanalysis()``, writes the recovered SAN back, and clears
        ``indefinite_insane`` if the investigator is fully restored.
    """
    if not investigator_id:
        return None

    if handler == "recover_temporary_insanity":
        return _handler_recover_temporary(campaign_dir, investigator_id, payload)
    if handler == "apply_psychoanalysis_treatment":
        return _handler_apply_treatment(campaign_dir, investigator_id, payload)
    return None


def _load_sibling_script(name: str, filename: str):
    """Lazily load a sibling script module (avoids circular import at load)."""
    import importlib.util
    script_dir = Path(__file__).resolve().parent
    spec = importlib.util.spec_from_file_location(name, script_dir / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _read_inv_state(campaign_dir: Path, investigator_id: str) -> dict[str, Any]:
    path = campaign_dir / "save" / "investigator-state" / f"{investigator_id}.json"
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _write_inv_state(campaign_dir: Path, investigator_id: str, data: dict[str, Any]) -> None:
    path = campaign_dir / "save" / "investigator-state" / f"{investigator_id}.json"
    coc_fileio.write_json_atomic(
        path, data, indent=2, ensure_ascii=False, trailing_newline=False
    )


def _handler_recover_temporary(campaign_dir: Path, investigator_id: str,
                               payload: dict[str, Any]) -> dict[str, Any]:
    """p.176: clear temporary insanity when its time trigger fires."""
    coc_sanity = _load_sibling_script("coc_sanity", "coc_sanity.py")
    sess = coc_sanity.SanitySession.load(campaign_dir, investigator_id)
    recovered = sess.recover_temporary()
    sess.save(campaign_dir)
    return {"recovered": recovered}


def _handler_apply_treatment(campaign_dir: Path, investigator_id: str,
                             payload: dict[str, Any]) -> dict[str, Any]:
    """p.164: weekly Psychoanalysis treatment for indefinite insanity.

    Rebuilds a PsychotherapySession from investigator-state, runs a weekly
    Psychoanalysis roll, writes the recovered SAN back, and clears
    ``indefinite_insane`` once the investigator reaches max SAN.
    """
    coc_healing = _load_sibling_script("coc_healing", "coc_healing.py")
    coc_sanity = _load_sibling_script("coc_sanity", "coc_sanity.py")
    inv = _read_inv_state(campaign_dir, investigator_id)
    canonical_sanity = None
    if coc_sanity.sanity_snapshot_exists(campaign_dir, investigator_id):
        # Both the identity-safe snapshot and an identity-matching legacy-only
        # snapshot are authoritative.  ``load`` performs the latter's safe
        # migration before compatibility investigator-state can overwrite it.
        canonical_sanity = coc_sanity.SanitySession.load(
            campaign_dir, investigator_id
        )
        current_san = int(canonical_sanity.san_current)
        max_san = int(canonical_sanity.san_max)
    else:
        current_san = int(inv.get("current_san", 0))
        max_san = int(inv.get("max_san", 99))
    # The investigator's Psychoanalysis skill — read from the linked character
    # sheet if available, else treat as untrained (0 → always fails).
    skill_value = int(inv.get("psychoanalysis_skill", 0))
    sess = coc_healing.PsychotherapySession(investigator_id, {
        "current_san": current_san,
        "max_san": max_san,
    })
    event = sess.psychoanalysis(skill_value)
    recovered = int(event.get("san_recovered", 0))
    new_san = int(event.get("san_after", current_san))
    # Persist the recovered SAN back to investigator-state.
    inv["current_san"] = new_san
    inv["max_san"] = max_san
    if new_san >= max_san:
        # Fully restored — clear indefinite insanity.
        inv["indefinite_insane"] = False
    # Write the general investigator state first.  SanitySession.save then
    # reloads/merges that document while mirroring the authoritative identity
    # snapshot, so the final write cannot replace freshly mirrored SAN fields
    # with the stale pre-treatment object above.
    _write_inv_state(campaign_dir, investigator_id, inv)
    if canonical_sanity is not None or coc_sanity.sanity_snapshot_exists(
        campaign_dir, investigator_id
    ):
        sanity = canonical_sanity or coc_sanity.SanitySession.load(
            campaign_dir, investigator_id
        )
        sanity.san_current = new_san
        if new_san >= max_san:
            sanity.indefinite_insane = False
        sanity.save(campaign_dir)
    return {
        "san_before": current_san,
        "san_after": new_san,
        "san_recovered": recovered,
        "fully_restored": new_san >= max_san,
    }


# --------------------------------------------------------------------------- #
# Time-cost validation
# --------------------------------------------------------------------------- #
def _load_time_costs(rules_dir: Path | None = None) -> dict[str, Any]:
    """Load time-costs.json from the rules directory."""
    if rules_dir is None:
        coc_rulesets = _load_sibling_script("coc_rulesets", "coc_rulesets.py")
        rules_dir = coc_rulesets.ruleset_data_dir(coc_rulesets.DEFAULT_RULESET_ID)
    path = rules_dir / "time-costs.json"
    if not path.exists():
        return {"categories": {}}
    return json.loads(path.read_text(encoding="utf-8"))


def validate_and_clamp_delta(
    delta_minutes: int,
    category: str | None,
    rules_dir: Path | None = None,
) -> tuple[int, str | None]:
    """Validate delta against category bounds. Clamp if out of range.

    Returns (accepted_delta, warning_message).
    """
    if not category:
        return delta_minutes, None
    costs = _load_time_costs(rules_dir)
    cat = costs.get("categories", {}).get(category)
    if not cat:
        return delta_minutes, None
    lo = int(cat.get("min", 0))
    hi = int(cat.get("max", 999999))
    if delta_minutes < lo:
        return lo, f"delta {delta_minutes} below category '{category}' min {lo}; clamped to {lo}"
    if delta_minutes > hi:
        return hi, f"delta {delta_minutes} exceeds category '{category}' max {hi}; clamped to {hi}"
    return delta_minutes, None


# --------------------------------------------------------------------------- #
# DirectorPlan integration
# --------------------------------------------------------------------------- #
_TIME_ADVANCE_MODES = {"none", "instant", "elapsed", "until", "downtime", "subsystem"}


def apply_time_advance_from_plan(
    campaign_dir: Path,
    plan: dict[str, Any],
    investigator_id: str,
) -> list[dict[str, Any]]:
    """Extract time_advance from a DirectorPlan and apply it.

    Returns a list of event records to be appended to events.jsonl.
    If plan has no time_advance or mode=none, returns [] (no-op).
    """
    ta = plan.get("time_advance")
    if not ta:
        return []
    mode = ta.get("mode", "none")
    if mode not in _TIME_ADVANCE_MODES:
        mode = "none"
    if mode == "none":
        return []

    delta = int(ta.get("delta_minutes", 0))
    category = ta.get("category")
    idempotency_key = ta.get("idempotency_key")
    if idempotency_key is not None:
        if not isinstance(idempotency_key, str) or not idempotency_key.strip():
            raise ValueError("time_advance.idempotency_key must be a non-empty string")
        log_path = _time_log_path(campaign_dir)
        if log_path.exists():
            for line_number, raw_line in enumerate(
                log_path.read_text(encoding="utf-8").splitlines(), start=1
            ):
                if not raw_line.strip():
                    continue
                try:
                    prior = json.loads(raw_line)
                except json.JSONDecodeError as exc:
                    raise ValueError(
                        f"malformed time evidence at line {line_number}"
                    ) from exc
                if (
                    isinstance(prior, dict)
                    and prior.get("event_type") == "time_advance"
                    and prior.get("idempotency_key") == idempotency_key
                ):
                    if (
                        prior.get("requested_mode") != mode
                        or prior.get("category") != category
                        or prior.get("delta_minutes") != int(ta.get("delta_minutes", 0))
                    ):
                        raise ValueError(
                            "time advance idempotency key was reused with different semantics"
                        )
                    return []
    if mode == "instant":
        delta = max(delta, 0)
        if delta > 1:
            delta = 1

    # Validate and clamp
    accepted_delta, warning = validate_and_clamp_delta(delta, category)
    if warning:
        _append_jsonl(_time_log_path(campaign_dir), {
            "event_type": "time_validation_warning",
            "reason": warning,
            "requested_delta": delta,
            "accepted_delta": accepted_delta,
        })

    if accepted_delta == 0 and mode != "until":
        return []

    result = advance_time(
        campaign_dir,
        accepted_delta,
        decision_id=plan.get("decision_id", ""),
        reason=ta.get("reason", ""),
        source="llm_proposal",
        confidence=float(ta.get("confidence", 1.0)),
        category=category,
        idempotency_key=idempotency_key,
        requested_mode=mode,
    )

    event = {
        "event_type": "game_time",
        "investigator_id": investigator_id,
        "decision_id": plan.get("decision_id", ""),
        "from_elapsed": result["from_elapsed"],
        "to_elapsed": result["to_elapsed"],
        "delta_minutes": result["delta_minutes"],
        "mode": mode,
        "category": category,
        "reason": ta.get("reason", ""),
        "player_visible": ta.get("player_visible", ""),
        "fired_triggers": [t.get("trigger_id", "") for t in result.get("fired_triggers", [])],
    }
    return [event]


# --------------------------------------------------------------------------- #
# Safe rest / sanity day reset
# --------------------------------------------------------------------------- #
def mark_safe_rest(
    campaign_dir: Path,
    investigator_id: str,
    *,
    decision_id: str | None = None,
    rest_kind: str = "safe_rest",
) -> dict[str, Any]:
    """Mark that the investigator has rested in a safe place.

    Updates anchors.last_rest_elapsed and last_safe_place_elapsed,
    sets safe_place=True, and resets the investigator's sanity period
    (daily SAN loss counter).
    """
    path = _time_state_path(campaign_dir)
    state = _read_json(path)
    if not state:
        return {}
    now = int(state.get("clock", {}).get("elapsed_minutes", 0))
    anchors = state.get("anchors", {})
    anchors["last_rest_elapsed"] = now
    anchors["last_safe_place_elapsed"] = now
    state["anchors"] = anchors
    state["safe_place"] = True

    # Reset sanity period for this investigator
    periods = state.get("sanity_periods", {})
    key = investigator_id
    if key in periods:
        periods[key]["san_lost"] = 0
        periods[key]["started_elapsed"] = now
    state["sanity_periods"] = periods

    _write_json(path, state)
    log_record = {
        "event_type": "safe_rest",
        "investigator_id": investigator_id,
        "at_elapsed": now,
        "rest_kind": rest_kind,
    }
    if decision_id is not None:
        log_record["decision_id"] = decision_id
    _append_jsonl(_time_log_path(campaign_dir), log_record)
    return {
        "investigator_id": investigator_id,
        "at_elapsed": now,
        "rest_kind": rest_kind,
        "sanity_day_reset": key in periods,
    }


def set_unsafe(campaign_dir: Path) -> None:
    """Mark the current location as unsafe (e.g. entering a danger zone)."""
    path = _time_state_path(campaign_dir)
    state = _read_json(path)
    if not state:
        return
    state["safe_place"] = False
    _write_json(path, state)


# --------------------------------------------------------------------------- #
# Director context signals
# --------------------------------------------------------------------------- #
def build_time_signals(
    time_state: dict[str, Any],
    due_triggers: list[dict[str, Any]],
) -> dict[str, Any]:
    """Build a compact signals dict for the DirectorContext."""
    clock = time_state.get("clock", {})
    elapsed = int(clock.get("elapsed_minutes", 0))
    anchors = time_state.get("anchors", {})
    last_rest = int(anchors.get("last_rest_elapsed", 0))
    hours_since_rest = (elapsed - last_rest) / 60.0

    # Next deadline from due/pending triggers
    pending = [
        t for t in due_triggers
        if t.get("status") == "pending"
        and "due_elapsed_minutes" in t
    ]
    next_deadline_minutes = None
    if pending:
        next_due = min(int(t["due_elapsed_minutes"]) for t in pending)
        next_deadline_minutes = max(0, next_due - elapsed)

    # Time pressure heuristic
    if next_deadline_minutes is not None and next_deadline_minutes < 60:
        pressure = "high"
    elif hours_since_rest > 18:
        pressure = "medium"
    else:
        pressure = "low"

    return {
        "elapsed_minutes": elapsed,
        "display": clock.get("display", ""),
        "local_datetime": clock.get("local_datetime"),
        "local_date": clock.get("local_date"),
        "calendar_mode": clock.get("calendar_mode"),
        "time_precision": clock.get("time_precision"),
        "location_id": clock.get("location_id"),
        "day_phase": _clock_day_phase(clock, elapsed),
        "is_night": _clock_day_phase(clock, elapsed) == "night",
        "hours_since_last_rest": round(hours_since_rest, 1),
        "safe_place": bool(time_state.get("safe_place", False)),
        "due_triggers_count": len(due_triggers),
        "next_deadline_minutes": next_deadline_minutes,
        "time_pressure": pressure,
    }


# --------------------------------------------------------------------------- #
# Fork (IF branch) — not part of the public API (stub retained for experiments)
# --------------------------------------------------------------------------- #
def _fork_timeline(
    campaign_dir: Path,
    *,
    new_branch_id: str,
    forked_from: dict[str, Any],
) -> None:
    """Internal stub: create a timeline branch marker. Not a public API.

    Full IF-branch support would generate a new timeline_id, copy campaign
    state from a snapshot, and mark ``forked_from``. Callers must not rely on
    this helper until that lands; the former public ``fork_timeline`` name was
    removed from the export surface in N8.
    """
    path = _time_state_path(campaign_dir)
    state = _read_json(path)
    if not state:
        return
    state["branch_id"] = new_branch_id
    state["forked_from"] = forked_from
    _write_json(path, state)
