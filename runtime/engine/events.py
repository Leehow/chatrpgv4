from __future__ import annotations

import time
import uuid
from typing import Any

EVENT_TYPES = (
    "narration", "speech", "roll", "state_patch",
    "choice", "session_ending", "spoiler_gate", "system", "error",
)
VISIBILITIES = ("player", "keeper", "system")
PLAYER_EVENT_TYPES = (
    "narration", "speech", "roll", "state_patch", "choice", "session_ending",
)

_ROLL_STRING_FIELDS = {
    "roll_id", "decision_id", "kind", "skill", "characteristic",
    "difficulty", "outcome", "damage_kind", "reward_kind", "die",
}
_ROLL_INTEGER_FIELDS = {
    "target", "effective_target", "bonus_penalty_dice", "roll", "san_loss",
    "san_before", "san_after", "hp_before", "hp_delta", "hp_after",
    "flat_modifier",
}
_ROLL_BOOLEAN_FIELDS = {"success", "pushed", "bout_triggered"}
_CHOICE_FIELDS = {
    "choice_id", "kind", "command_id", "responder", "revision", "prompt",
    "options", "decision_id", "attack_id", "audience",
}
_CHOICE_KINDS = {"push_confirm", "chase_action", "combat_defense"}


def make_event(
    type: str,
    payload: dict[str, Any],
    *,
    visibility: str = "player",
    event_id: str | None = None,
) -> dict[str, Any]:
    if type not in EVENT_TYPES:
        raise ValueError(f"invalid event type: {type!r}")
    if visibility not in VISIBILITIES:
        raise ValueError(f"invalid visibility: {visibility!r}")
    if not isinstance(payload, dict):
        raise ValueError("payload must be an object")
    event = {
        "type": type,
        "id": event_id or f"evt_{uuid.uuid4().hex[:12]}",
        "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "visibility": visibility,
        "payload": payload,
    }
    validate_event(event)
    return event


def validate_event(event: dict[str, Any]) -> None:
    if not isinstance(event, dict):
        raise ValueError("event must be an object")
    required = {"type", "id", "ts", "visibility", "payload"}
    if set(event) != required:
        raise ValueError("event must contain exactly the public envelope fields")
    if event["type"] not in EVENT_TYPES:
        raise ValueError(f"invalid event type: {event['type']!r}")
    if event["visibility"] not in VISIBILITIES:
        raise ValueError(f"invalid visibility: {event['visibility']!r}")
    for field in ("id", "ts"):
        if not isinstance(event[field], str) or not event[field]:
            raise ValueError(f"event {field} must be a non-empty string")
    if not isinstance(event["payload"], dict):
        raise ValueError("payload must be an object")
    if event["visibility"] == "player":
        if event["type"] not in PLAYER_EVENT_TYPES:
            raise ValueError("internal event type cannot use player visibility")
        _validate_player_payload(event["type"], event["payload"])


def _require_fields(
    payload: dict[str, Any],
    *,
    allowed: set[str],
    required: set[str],
    event_type: str,
) -> None:
    if not required <= set(payload) or not set(payload) <= allowed:
        raise ValueError(f"{event_type} payload fields are not public")


def _non_empty_string(value: Any, field: str) -> None:
    if not isinstance(value, str) or not value:
        raise ValueError(f"{field} must be a non-empty string")


def _optional_string(payload: dict[str, Any], field: str) -> None:
    if field in payload:
        _non_empty_string(payload[field], field)


def _exact_integer(value: Any, field: str, *, minimum: int | None = None) -> None:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{field} must be an integer")
    if minimum is not None and value < minimum:
        raise ValueError(f"{field} is below its minimum")


def _validate_player_payload(event_type: str, payload: dict[str, Any]) -> None:
    if event_type == "narration":
        _require_fields(
            payload,
            allowed={"text", "decision_id"},
            required={"text"},
            event_type=event_type,
        )
        _non_empty_string(payload["text"], "narration.text")
        _optional_string(payload, "decision_id")
        return
    if event_type == "speech":
        _require_fields(
            payload,
            allowed={"text", "speaker_id", "decision_id"},
            required={"text"},
            event_type=event_type,
        )
        _non_empty_string(payload["text"], "speech.text")
        _optional_string(payload, "speaker_id")
        _optional_string(payload, "decision_id")
        return
    if event_type == "roll":
        allowed = (
            _ROLL_STRING_FIELDS
            | _ROLL_INTEGER_FIELDS
            | _ROLL_BOOLEAN_FIELDS
            | {"die_rolls"}
        )
        _require_fields(
            payload, allowed=allowed, required={"roll"}, event_type=event_type
        )
        for field in _ROLL_STRING_FIELDS & set(payload):
            _non_empty_string(payload[field], f"roll.{field}")
        for field in _ROLL_INTEGER_FIELDS & set(payload):
            _exact_integer(payload[field], f"roll.{field}")
        for field in _ROLL_BOOLEAN_FIELDS & set(payload):
            if not isinstance(payload[field], bool):
                raise ValueError(f"roll.{field} must be boolean")
        if "die_rolls" in payload:
            rolls = payload["die_rolls"]
            if not isinstance(rolls, list):
                raise ValueError("roll.die_rolls must be an integer list")
            for value in rolls:
                _exact_integer(value, "roll.die_rolls[]")
        return
    if event_type == "choice":
        required = {
            "choice_id", "kind", "command_id", "responder", "revision",
            "prompt", "options",
        }
        _require_fields(
            payload, allowed=_CHOICE_FIELDS, required=required, event_type=event_type
        )
        for field in ("choice_id", "kind", "command_id", "responder", "prompt"):
            _non_empty_string(payload[field], f"choice.{field}")
        if payload["kind"] not in _CHOICE_KINDS or payload["responder"] != "player":
            raise ValueError("choice kind/responder is not public")
        _exact_integer(payload["revision"], "choice.revision", minimum=0)
        options = payload["options"]
        if not isinstance(options, list) or not options:
            raise ValueError("choice.options must be a non-empty list")
        for option in options:
            if not isinstance(option, dict) or set(option) != {"action", "label"}:
                raise ValueError("choice option fields are not public")
            _non_empty_string(option["action"], "choice.options[].action")
            _non_empty_string(option["label"], "choice.options[].label")
        for field in ("decision_id", "attack_id"):
            _optional_string(payload, field)
        if "audience" in payload and payload["audience"] != "player":
            raise ValueError("choice.audience must be player")
        return
    if event_type == "state_patch":
        _require_fields(
            payload,
            allowed={"final_state", "state_patch"},
            required={"final_state", "state_patch"},
            event_type=event_type,
        )
        final_state = payload["final_state"]
        state_patch = payload["state_patch"]
        if not isinstance(final_state, dict) or not set(final_state) <= {
            "active_scene", "tension", "turn_number"
        }:
            raise ValueError("state_patch final_state fields are not public")
        for field in ("active_scene", "tension"):
            if field in final_state and final_state[field] is not None:
                _non_empty_string(final_state[field], f"state_patch.final_state.{field}")
        if "turn_number" in final_state:
            _exact_integer(
                final_state["turn_number"], "state_patch.final_state.turn_number",
                minimum=0,
            )
        if not isinstance(state_patch, dict) or not set(state_patch) <= {
            "applied", "world_active_scene_updated"
        }:
            raise ValueError("state_patch status fields are not public")
        if not all(isinstance(value, bool) for value in state_patch.values()):
            raise ValueError("state_patch status values must be boolean")
        return
    if event_type == "session_ending":
        required = {"kind", "decision_id", "scene_id"}
        _require_fields(
            payload, allowed=required, required=required, event_type=event_type
        )
        if payload["kind"] != "session_ending":
            raise ValueError("session_ending kind is invalid")
        _non_empty_string(payload["decision_id"], "session_ending.decision_id")
        _non_empty_string(payload["scene_id"], "session_ending.scene_id")
