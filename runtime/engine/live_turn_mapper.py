"""Map coc_live_turn_runner.run_live_turn results to runtime Events."""
from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import Any

_EVENTS = None


def _events():
    global _EVENTS
    if _EVENTS is None:
        path = Path(__file__).resolve().parent / "events.py"
        spec = importlib.util.spec_from_file_location("runtime_events", path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        _EVENTS = mod
    return _EVENTS


def _choice_has_options(choice_frame: Any) -> bool:
    if not isinstance(choice_frame, dict):
        return False
    options = choice_frame.get("options")
    return isinstance(options, list) and len(options) > 0


def _structured_rolls(turn: dict[str, Any]) -> list[dict[str, Any]]:
    """Return structured roll payloads only; never invent from prose."""
    rolls: list[dict[str, Any]] = []
    rule_results = turn.get("rule_results")
    if isinstance(rule_results, list):
        for item in rule_results:
            if isinstance(item, dict) and (
                "roll" in item or "outcome" in item or item.get("kind") in {
                    "skill_check", "characteristic_check", "sanity_check", "opposed_check",
                }
            ):
                rolls.append(item)
    for key in ("rolls", "roll_records"):
        raw = turn.get(key)
        if isinstance(raw, list):
            for item in raw:
                if isinstance(item, dict):
                    rolls.append(item)
        elif isinstance(raw, dict) and raw:
            rolls.append(raw)
    return rolls


def _narration_texts(turn: dict[str, Any]) -> list[str]:
    texts: list[str] = []
    directives = turn.get("narrative_directives")
    if not isinstance(directives, dict):
        return texts
    for key in ("narration", "text", "keeper_narration", "summary"):
        value = directives.get(key)
        if isinstance(value, str) and value.strip():
            texts.append(value.strip())
    must_include = directives.get("must_include")
    if isinstance(must_include, list):
        for item in must_include:
            if isinstance(item, str) and item.strip():
                texts.append(item.strip())
    return texts


def map_live_turn_result(result: dict[str, Any]) -> list[dict[str, Any]]:
    """Convert a run_live_turn result dict into validated Event envelopes."""
    if not isinstance(result, dict):
        raise ValueError("result must be an object")
    make_event = _events().make_event
    events: list[dict[str, Any]] = []

    turns = result.get("turns") or []
    if not isinstance(turns, list):
        turns = []

    for turn in turns:
        if not isinstance(turn, dict):
            continue
        decision_id = turn.get("decision_id")

        for text in _narration_texts(turn):
            payload: dict[str, Any] = {"text": text}
            if decision_id is not None:
                payload["decision_id"] = decision_id
            events.append(make_event("narration", payload))

        for roll in _structured_rolls(turn):
            payload = dict(roll)
            if decision_id is not None and "decision_id" not in payload:
                payload["decision_id"] = decision_id
            events.append(make_event("roll", payload))

        choice_frame = turn.get("choice_frame")
        if _choice_has_options(choice_frame):
            payload = dict(choice_frame)
            if decision_id is not None and "decision_id" not in payload:
                payload["decision_id"] = decision_id
            events.append(make_event("choice", payload))

    final_state = result.get("final_state")
    state_patch = result.get("state_patch")
    if isinstance(final_state, dict) or isinstance(state_patch, dict):
        payload = {
            "final_state": final_state if isinstance(final_state, dict) else {},
            "state_patch": state_patch if isinstance(state_patch, dict) else {},
        }
        events.append(make_event("state_patch", payload))

    stop_actionability = result.get("stop_actionability")
    if isinstance(stop_actionability, dict) and stop_actionability.get("immediate_handles") is not None:
        events.append(make_event(
            "system",
            {"kind": "stop_actionability", **stop_actionability},
            visibility="system",
        ))

    auto_advance = result.get("auto_advance")
    if isinstance(auto_advance, dict) and auto_advance.get("stop_reason") is not None:
        events.append(make_event(
            "system",
            {
                "kind": "stop_reason",
                "stop_reason": auto_advance.get("stop_reason"),
                "auto_advance": auto_advance,
            },
            visibility="system",
        ))

    return events
