"""Map coc_live_turn_runner.run_live_turn results to runtime Events."""
from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import Any

_EVENTS = None

_ROLL_STRING_FIELDS = (
    "roll_id", "decision_id", "kind", "skill", "characteristic",
    "difficulty", "outcome", "damage_kind", "reward_kind", "die",
)
_ROLL_INTEGER_FIELDS = (
    "target", "effective_target", "bonus_penalty_dice", "roll", "san_loss",
    "san_before", "san_after", "hp_before", "hp_delta", "hp_after",
    "flat_modifier",
)
_ROLL_BOOLEAN_FIELDS = ("success", "pushed", "bout_triggered")
_PENDING_CHOICE_KINDS = frozenset({"push_confirm", "chase_action", "combat_defense"})


def _events():
    global _EVENTS
    if _EVENTS is None:
        path = Path(__file__).resolve().parent / "events.py"
        spec = importlib.util.spec_from_file_location("runtime_events", path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        _EVENTS = mod
    return _EVENTS


def _non_empty_string(value: Any) -> str | None:
    return value if isinstance(value, str) and value else None


def _project_player_roll(
    raw: dict[str, Any],
    decision_id: str | None,
) -> dict[str, Any] | None:
    """Project one mechanics row onto the closed player-visible roll shape."""
    payload: dict[str, Any] = {}
    for field in _ROLL_STRING_FIELDS:
        value = _non_empty_string(raw.get(field))
        if value is not None:
            payload[field] = value
    for field in _ROLL_INTEGER_FIELDS:
        value = raw.get(field)
        if isinstance(value, int) and not isinstance(value, bool):
            payload[field] = value
    for field in _ROLL_BOOLEAN_FIELDS:
        value = raw.get(field)
        if isinstance(value, bool):
            payload[field] = value
    die_rolls = raw.get("die_rolls")
    if (
        isinstance(die_rolls, list)
        and all(isinstance(value, int) and not isinstance(value, bool) for value in die_rolls)
    ):
        payload["die_rolls"] = list(die_rolls)
    if "roll" not in payload:
        return None
    if "decision_id" not in payload and decision_id is not None:
        payload["decision_id"] = decision_id
    return payload


def _structured_rolls(turn: dict[str, Any]) -> list[dict[str, Any]]:
    """Return closed player-visible roll payloads; never copy raw rule rows."""
    rolls: list[dict[str, Any]] = []
    decision_id = _non_empty_string(turn.get("decision_id"))

    def append(raw: Any) -> None:
        if isinstance(raw, dict):
            projected = _project_player_roll(raw, decision_id)
            if projected is not None:
                rolls.append(projected)

    rule_results = turn.get("rule_results")
    if isinstance(rule_results, list):
        for item in rule_results:
            append(item)
    for key in ("rolls", "roll_records"):
        raw = turn.get(key)
        if isinstance(raw, list):
            for item in raw:
                append(item)
        else:
            append(raw)
    return rolls


def _narration_texts(turn: dict[str, Any]) -> list[str]:
    """Read only already-rendered player narration, never Keeper directives."""
    narration = turn.get("narration")
    if isinstance(narration, dict):
        final = narration.get("final_text")
        if isinstance(final, str) and final.strip():
            return [final.strip()]
    elif isinstance(narration, str) and narration.strip():
        return [narration.strip()]
    return []


def _project_player_pending_choice(
    raw: Any,
    decision_id: str | None,
) -> dict[str, Any] | None:
    """Copy only the canonical public pending-choice contract."""
    if not isinstance(raw, dict) or raw.get("responder") != "player":
        return None
    required_strings = ("choice_id", "kind", "command_id", "responder", "prompt")
    values = {field: _non_empty_string(raw.get(field)) for field in required_strings}
    revision = raw.get("revision")
    options = raw.get("options")
    if (
        any(value is None for value in values.values())
        or values["kind"] not in _PENDING_CHOICE_KINDS
        or isinstance(revision, bool)
        or not isinstance(revision, int)
        or revision < 0
        or not isinstance(options, list)
        or not options
    ):
        return None
    projected_options: list[dict[str, str]] = []
    for option in options:
        if not isinstance(option, dict):
            return None
        action = _non_empty_string(option.get("action"))
        label = _non_empty_string(option.get("label"))
        if action is None or label is None:
            return None
        projected_options.append({"action": action, "label": label})
    payload: dict[str, Any] = {
        **values,
        "revision": revision,
        "options": projected_options,
    }
    attack_id = _non_empty_string(raw.get("attack_id"))
    if attack_id is not None:
        payload["attack_id"] = attack_id
    if raw.get("audience") == "player":
        payload["audience"] = "player"
    if decision_id is not None:
        payload["decision_id"] = decision_id
    return payload


def _project_state_patch(result: dict[str, Any]) -> dict[str, Any] | None:
    final_raw = result.get("final_state")
    patch_raw = result.get("state_patch")
    final_state: dict[str, Any] = {}
    state_patch: dict[str, Any] = {}
    if isinstance(final_raw, dict):
        for field in ("active_scene", "tension"):
            value = final_raw.get(field)
            if value is None or isinstance(value, str):
                final_state[field] = value
        turn_number = final_raw.get("turn_number")
        if isinstance(turn_number, int) and not isinstance(turn_number, bool):
            final_state["turn_number"] = turn_number
    if isinstance(patch_raw, dict):
        for field in ("applied", "world_active_scene_updated"):
            value = patch_raw.get(field)
            if isinstance(value, bool):
                state_patch[field] = value
    if not final_state and not state_patch:
        return None
    return {"final_state": final_state, "state_patch": state_patch}


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
        decision_id = _non_empty_string(turn.get("decision_id"))

        for text in _narration_texts(turn):
            payload: dict[str, Any] = {"text": text}
            if decision_id is not None:
                payload["decision_id"] = decision_id
            events.append(make_event("narration", payload))

        for roll in _structured_rolls(turn):
            events.append(make_event("roll", roll))

        pending_choice = _project_player_pending_choice(
            turn.get("pending_choice"), decision_id
        )
        if pending_choice is not None:
            events.append(make_event("choice", pending_choice))

        event_types = turn.get("event_types")
        if (
            isinstance(event_types, list)
            and "session_ending" in event_types
            and isinstance(decision_id, str)
            and decision_id
            and isinstance(turn.get("scene_id"), str)
            and turn["scene_id"]
        ):
            events.append(make_event("session_ending", {
                "kind": "session_ending",
                "decision_id": decision_id,
                "scene_id": turn["scene_id"],
            }))

    state_patch = _project_state_patch(result)
    if state_patch is not None:
        events.append(make_event("state_patch", state_patch))

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
