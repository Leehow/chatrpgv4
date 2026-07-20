#!/usr/bin/env python3
"""Canonical, source-bound exceptional effects for settled percentile checks.

This store is intentionally small.  The Keeper chooses the fiction and the
appropriate effect kind; this module only preserves an immutable application
record, an explicit lifetime, and (for one-shot dice modifiers) a later
source-bound consumption record.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
from pathlib import Path
from typing import Any


SCHEMA_VERSION = 1
FILENAME = "exceptional-effects.json"
EFFECT_KINDS = frozenset({
    "bonus_die",
    "penalty_die",
    "condition",
    "restriction",
    "relationship_or_clock",
    "scene_event",
    "resource_delta",
})
DIRECTIONS = frozenset({"benefit", "cost"})
VISIBILITIES = frozenset({"player_visible", "concealed_observable", "keeper_only"})
BOUNDARY_KINDS = frozenset({
    "immediate",
    "until_consumed",
    "until_scene_end",
    "until_time_marker",
    "until_condition",
})
DOCUMENT_FIELDS = frozenset({"schema_version", "effects", "operations"})
EFFECT_FIELDS = frozenset({
    "schema_version",
    "effect_id",
    "source_roll",
    "direction",
    "effect_kind",
    "player_visible_impact",
    "causal_link",
    "boundary",
    "mechanics",
    "visibility",
    "status",
    "created_at",
    "created_decision_id",
    "consumed_at",
    "consumed_decision_id",
    "consumed_by_roll_id",
    "integrity_digest",
})
OPERATION_FIELDS = frozenset({
    "decision_id", "action", "fingerprint", "effect_id", "data",
})


def canonical_digest(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def stable_effect_id(decision_id: str, source_roll_id: str) -> str:
    digest = canonical_digest(
        ["exceptional-effect-v1", str(decision_id), str(source_roll_id)]
    ).split(":", 1)[1]
    return f"exceptional-effect-v1:{digest[:40]}"


def new_document() -> dict[str, Any]:
    return {"schema_version": SCHEMA_VERSION, "effects": {}, "operations": {}}


def _valid_boundary(value: Any) -> bool:
    if not isinstance(value, dict) or not isinstance(value.get("kind"), str):
        return False
    kind = value["kind"]
    if kind not in BOUNDARY_KINDS:
        return False
    expected = {"kind"}
    if kind == "until_consumed":
        expected |= {"uses"}
        if value.get("uses") != 1:
            return False
    elif kind == "until_scene_end":
        expected |= {"scene_id"}
        if not isinstance(value.get("scene_id"), str) or not value["scene_id"]:
            return False
    elif kind == "until_time_marker":
        expected |= {"marker_id"}
        if not isinstance(value.get("marker_id"), str) or not value["marker_id"]:
            return False
    elif kind == "until_condition":
        expected |= {"description"}
        if not isinstance(value.get("description"), str) or not value["description"]:
            return False
    return set(value) == expected


def _valid_source_roll(value: Any) -> bool:
    return bool(
        isinstance(value, dict)
        and set(value) == {
            "tool", "decision_id", "roll_id", "integrity_digest", "outcome",
            "pushed", "visibility",
        }
        and value.get("tool") in {
            "rules.roll", "rules.push", "npc.reaction", "combat.resolve",
        }
        and isinstance(value.get("decision_id"), str)
        and value["decision_id"]
        and isinstance(value.get("roll_id"), str)
        and value["roll_id"]
        and isinstance(value.get("integrity_digest"), str)
        and value["integrity_digest"].startswith("sha256:")
        and isinstance(value.get("outcome"), str)
        and isinstance(value.get("pushed"), bool)
        and isinstance(value.get("visibility"), str)
    )


def valid_effect(effect: Any) -> bool:
    if not isinstance(effect, dict) or set(effect) != EFFECT_FIELDS:
        return False
    if effect.get("schema_version") != SCHEMA_VERSION:
        return False
    for key in (
        "effect_id", "player_visible_impact", "causal_link", "created_at",
        "created_decision_id",
    ):
        if not isinstance(effect.get(key), str) or not effect[key]:
            return False
    if not _valid_source_roll(effect.get("source_roll")):
        return False
    if effect.get("direction") not in DIRECTIONS:
        return False
    if effect.get("effect_kind") not in EFFECT_KINDS:
        return False
    if effect.get("visibility") not in VISIBILITIES:
        return False
    if not _valid_boundary(effect.get("boundary")):
        return False
    if not isinstance(effect.get("mechanics"), dict):
        return False
    if effect.get("status") not in {"active", "applied", "consumed", "resolved"}:
        return False
    terminal = effect.get("status") in {"consumed", "resolved"}
    for key in ("consumed_at", "consumed_decision_id"):
        value = effect.get(key)
        if terminal != (isinstance(value, str) and bool(value)):
            return False
        if not terminal and value is not None:
            return False
    consumed_by_roll_id = effect.get("consumed_by_roll_id")
    if effect.get("status") == "consumed":
        if not isinstance(consumed_by_roll_id, str) or not consumed_by_roll_id:
            return False
    elif effect.get("status") == "resolved":
        if consumed_by_roll_id is not None and (
            not isinstance(consumed_by_roll_id, str) or not consumed_by_roll_id
        ):
            return False
    elif consumed_by_roll_id is not None:
        return False
    body = {key: deepcopy(value) for key, value in effect.items() if key != "integrity_digest"}
    return effect.get("integrity_digest") == canonical_digest(body)


def valid_document(document: Any) -> bool:
    if (
        not isinstance(document, dict)
        or set(document) != DOCUMENT_FIELDS
        or document.get("schema_version") != SCHEMA_VERSION
        or not isinstance(document.get("effects"), dict)
        or not isinstance(document.get("operations"), dict)
    ):
        return False
    for effect_id, effect in document["effects"].items():
        if not valid_effect(effect) or effect.get("effect_id") != effect_id:
            return False
    for decision_id, operation in document["operations"].items():
        data = operation.get("data") if isinstance(operation, dict) else None
        recorded_effect = data.get("effect") if isinstance(data, dict) else None
        if (
            not isinstance(operation, dict)
            or set(operation) != OPERATION_FIELDS
            or operation.get("decision_id") != decision_id
            or operation.get("action") not in {"apply", "consume", "resolve"}
            or not isinstance(operation.get("fingerprint"), str)
            or not operation["fingerprint"].startswith("sha256:")
            or not isinstance(operation.get("effect_id"), str)
            or operation["effect_id"] not in document["effects"]
            or not isinstance(data, dict)
            or set(data) != {"action", "effect", "player_effect"}
            or data.get("action") != operation.get("action")
            or not valid_effect(recorded_effect)
            or recorded_effect.get("effect_id") != operation.get("effect_id")
            or data.get("player_effect") != project_player_effect(recorded_effect)
            or (
                operation.get("action") in {"consume", "resolve"}
                and recorded_effect != document["effects"][operation["effect_id"]]
            )
            or (
                operation.get("action") == "apply"
                and recorded_effect.get("created_decision_id") != decision_id
            )
        ):
            return False
    return True


def load(campaign_dir: Path) -> dict[str, Any]:
    path = Path(campaign_dir) / "save" / FILENAME
    if not path.is_file():
        return new_document()
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"save/{FILENAME} is unreadable") from exc
    if not valid_document(document):
        raise ValueError(f"save/{FILENAME} does not match schema v{SCHEMA_VERSION}")
    return document


def project_player_effect(effect: dict[str, Any]) -> dict[str, Any] | None:
    """Return the safe deterministic block rendered at a causal boundary."""
    if effect.get("visibility") == "keeper_only":
        return None
    return {
        "schema_version": 1,
        "category": "exceptional_effect",
        "event_id": (
            f"{effect['effect_id']}:{effect['status']}:"
            f"{effect.get('consumed_decision_id') or effect['created_decision_id']}"
        ),
        "effect_id": effect["effect_id"],
        "direction": effect["direction"],
        "effect_kind": effect["effect_kind"],
        "player_visible_impact": effect["player_visible_impact"],
        "causal_link": effect["causal_link"],
        "boundary": deepcopy(effect["boundary"]),
        "mechanics": deepcopy(effect["mechanics"]),
        "status": effect["status"],
        "consumed_by_roll_id": effect.get("consumed_by_roll_id"),
    }
