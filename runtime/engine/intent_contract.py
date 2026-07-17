"""Host-neutral structured player-intent contract for the open runtime."""
from __future__ import annotations

import math
from collections.abc import Mapping
from typing import Any


# Mirrored from plugins/coc-keeper/scripts/coc_intent_router.py
# ``_PRIMARY_INTENT_ENUM`` (the semantic router source of truth). Runtime must
# not import plugin scripts; tests/test_intent_router.py keeps the enums synced.
CANONICAL_INTENT_CLASSES = frozenset(
    {
        "investigate",
        "social",
        "move",
        "combat",
        "flee",
        "meta",
        "stuck",
        "idle",
        "ambiguous",
        "montage",
        "cast",
    }
)
PUBLIC_PLAYER_INTENT_FIELDS = frozenset(
    {
        "primary_intent",
        "secondary_intents",
        "target_entities",
        "risk_posture",
        "explicit_roll_request",
        "player_hypothesis",
        "action_atoms",
        "npc_interactions",
    }
)
RISK_POSTURES = frozenset({"cautious", "neutral", "reckless"})


def _copy_json_only(value: Any, field: str) -> Any:
    """Copy a strict JSON value without coercing caller-owned structures."""
    if value is None or type(value) in {bool, int, str}:
        return value
    if type(value) is float:
        if not math.isfinite(value):
            raise ValueError(f"{field} must contain finite JSON numbers")
        return value
    if type(value) is list:
        return [
            _copy_json_only(item, f"{field}[{index}]")
            for index, item in enumerate(value)
        ]
    if type(value) is dict:
        copied: dict[str, Any] = {}
        for key, item in value.items():
            if type(key) is not str:
                raise TypeError(f"{field} JSON object keys must be strings")
            copied[key] = _copy_json_only(item, f"{field}.{key}")
        return copied
    raise TypeError(f"{field} must contain JSON-only values")


def _validate_json_object_list(value: Any, field: str) -> list[dict[str, Any]]:
    if type(value) is not list or not all(type(item) is dict for item in value):
        raise TypeError(f"{field} must be a list of JSON objects")
    return [
        _copy_json_only(item, f"{field}[{index}]")
        for index, item in enumerate(value)
    ]


def validate_player_intent(player_intent: Any) -> dict[str, Any]:
    """Validate semantic evidence without inferring meaning from player prose."""
    if not isinstance(player_intent, Mapping):
        raise TypeError("player_intent must be an object")
    if set(player_intent) != PUBLIC_PLAYER_INTENT_FIELDS:
        raise ValueError("player_intent must contain exactly the public intent fields")

    primary = player_intent["primary_intent"]
    if type(primary) is not str or primary not in CANONICAL_INTENT_CLASSES:
        raise ValueError("player_intent.primary_intent is not canonical")

    string_lists: dict[str, list[str]] = {}
    for field in ("secondary_intents", "target_entities"):
        value = player_intent[field]
        if type(value) is not list or not all(type(item) is str for item in value):
            raise TypeError(f"player_intent.{field} must be a list of strings")
        string_lists[field] = list(value)

    risk_posture = player_intent["risk_posture"]
    if type(risk_posture) is not str or risk_posture not in RISK_POSTURES:
        raise ValueError("player_intent.risk_posture is not canonical")
    explicit_roll_request = player_intent["explicit_roll_request"]
    if type(explicit_roll_request) is not bool:
        raise TypeError("player_intent.explicit_roll_request must be a boolean")
    player_hypothesis = player_intent["player_hypothesis"]
    if player_hypothesis is not None and type(player_hypothesis) is not str:
        raise TypeError("player_intent.player_hypothesis must be a string or null")

    return {
        "primary_intent": primary,
        "secondary_intents": string_lists["secondary_intents"],
        "target_entities": string_lists["target_entities"],
        "risk_posture": risk_posture,
        "explicit_roll_request": explicit_roll_request,
        "player_hypothesis": player_hypothesis,
        "action_atoms": _validate_json_object_list(
            player_intent["action_atoms"], "player_intent.action_atoms"
        ),
        "npc_interactions": _validate_json_object_list(
            player_intent["npc_interactions"], "player_intent.npc_interactions"
        ),
    }
