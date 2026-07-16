#!/usr/bin/env python3
"""Structured semantic projection for canonical COC runtime events.

Producers are allowed to use subsystem-specific event names.  Consumers must
not each grow their own list of ad-hoc aliases, and must never infer event
meaning from free prose.  This module is the single compatibility boundary
between raw structured events and the small semantic vocabulary used by
reports, completion receipts, and adherence checks.
"""
from __future__ import annotations

from typing import Any, Callable


def event_type(row: dict[str, Any]) -> str | None:
    value = row.get("event_type") or row.get("type")
    return str(value) if isinstance(value, str) and value else None


def payload(row: dict[str, Any]) -> dict[str, Any]:
    value = row.get("payload")
    return value if isinstance(value, dict) else {}


def value(row: dict[str, Any], key: str, default: Any = None) -> Any:
    """Read a canonical field from the envelope first, then its payload."""
    direct = row.get(key)
    if direct is not None:
        return direct
    return payload(row).get(key, default)


def semantic_types(row: dict[str, Any]) -> frozenset[str]:
    """Return structured semantic types represented by one raw event.

    Compatibility aliases deliberately depend only on IDs, enums, and object
    shape.  No scenario or narration text is scanned.
    """
    raw = event_type(row)
    types: set[str] = {raw} if raw else set()
    body = payload(row)

    if raw == "npc_update" and isinstance(value(row, "npc_id"), str):
        types.add("npc_engagement")

    if raw == "combat_ended":
        types.add("combat")

    if raw == "development" and (
        isinstance(body.get("scenario_san_reward"), dict)
        or isinstance(body.get("san_reward"), dict)
    ):
        types.add("reward")

    return frozenset(types)


def matches(row: dict[str, Any], semantic_type: str) -> bool:
    return str(semantic_type) in semantic_types(row)


def first_matching(
    rows: list[dict[str, Any]],
    semantic_type: str,
    *,
    predicate: Callable[[dict[str, Any]], bool] | None = None,
) -> tuple[int, dict[str, Any]] | None:
    for index, row in enumerate(rows, start=1):
        if not matches(row, semantic_type):
            continue
        if predicate is not None and not predicate(row):
            continue
        return index, row
    return None


def last_matching(
    rows: list[dict[str, Any]],
    semantic_type: str,
    *,
    predicate: Callable[[dict[str, Any]], bool] | None = None,
) -> tuple[int, dict[str, Any]] | None:
    """Return the newest structured semantic event and its one-based line.

    Campaign logs are cumulative across pauses and resumed sessions.  A later
    canonical settlement must supersede an older partial receipt without
    rewriting append-only history.
    """
    for index in range(len(rows), 0, -1):
        row = rows[index - 1]
        if not matches(row, semantic_type):
            continue
        if predicate is not None and not predicate(row):
            continue
        return index, row
    return None


def is_conclusion_reward(row: dict[str, Any]) -> bool:
    """Whether a reward is explicitly tied to a scenario conclusion."""
    if not matches(row, "reward"):
        return False
    source = value(row, "source")
    conclusion_id = value(row, "conclusion_id")
    if source in {"conclusion_rewards", "scenario_conclusion"}:
        return True
    if isinstance(conclusion_id, str) and conclusion_id:
        return True
    body = payload(row)
    return isinstance(body.get("scenario_san_reward"), dict)


__all__ = [
    "event_type",
    "first_matching",
    "last_matching",
    "is_conclusion_reward",
    "matches",
    "payload",
    "semantic_types",
    "value",
]
