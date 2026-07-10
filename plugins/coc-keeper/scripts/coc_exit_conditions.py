#!/usr/bin/env python3
"""Structured scene exit-condition normalization + evaluation.

Single choke point shared by the Story Director (CUT scoring), the apply
layer (clue-reveal auto-advance), and the scene-graph unlock model (R-3).
Semantic Matcher Constitution: runtime logic must not infer meaning by
scanning free text, so exit conditions are structured objects:

    {"kind": "clue_discovered", "clue_id": "clue-chapel-link"}
    {"kind": "clock_reaches", "threshold": 3}            # any tracked clock
    {"kind": "clock_reaches", "clock_id": "c1", "threshold": 3}
    {"kind": "flag_set", "flag_id": "met_informant"}
    {"kind": "always"}
    {"kind": "narrative", "description": "investigators accept the job"}

``narrative`` conditions are never machine-checkable; they always evaluate
False so the scene waits for an explicit CUT / force_transition.

``always`` is unconditionally True (used by open travel edges and legacy
linear fallbacks).

``flag_set`` reads structured boolean/presence flags supplied by the caller
(typically ``save/flags.json`` ``flags`` map keys that are truthy).

Legacy string forms are converted here and ONLY here. The two historical
machine-checkable string patterns ("<clue-id> discovered" and
"... pressure clock reaches N") are parsed with anchored patterns as a
constrained legacy DSL — not free-prose keyword scanning — and the converted
object carries ``legacy_source`` so audits can track remaining string-DSL
debt. Any other string becomes a ``narrative`` condition.
"""
from __future__ import annotations

import re
from typing import Any, Callable

EXIT_CONDITION_KINDS = (
    "clue_discovered",
    "clock_reaches",
    "flag_set",
    "always",
    "narrative",
)

# Anchored legacy DSL patterns (constrained machine formats, single choke point).
_LEGACY_CLUE_DISCOVERED = re.compile(r"^(?P<clue_id>\S+)\s+discovered$", re.IGNORECASE)
_LEGACY_CLOCK_REACHES = re.compile(r"pressure clock reaches\s+(?P<threshold>\d+)\s*$", re.IGNORECASE)


def normalize_exit_condition(raw: Any) -> dict[str, Any]:
    """Normalize a raw exit condition (structured dict or legacy string).

    Always returns a dict with a valid ``kind``. Anything unrecognized becomes
    ``{"kind": "narrative", ...}`` which machine evaluation treats as not-met.
    """
    if isinstance(raw, dict):
        kind = str(raw.get("kind") or "")
        if kind == "clue_discovered":
            clue_id = str(raw.get("clue_id") or "").strip()
            if clue_id:
                return {"kind": "clue_discovered", "clue_id": clue_id}
        elif kind == "clock_reaches":
            try:
                threshold = int(raw.get("threshold"))
            except (TypeError, ValueError):
                threshold = None
            if threshold is not None:
                out: dict[str, Any] = {"kind": "clock_reaches", "threshold": threshold}
                clock_id = str(raw.get("clock_id") or "").strip()
                if clock_id:
                    out["clock_id"] = clock_id
                return out
        elif kind == "flag_set":
            flag_id = str(raw.get("flag_id") or "").strip()
            if flag_id:
                return {"kind": "flag_set", "flag_id": flag_id}
        elif kind == "always":
            return {"kind": "always"}
        elif kind == "narrative":
            return {"kind": "narrative", "description": str(raw.get("description") or "")}
        return {"kind": "narrative", "description": str(raw.get("description") or raw)}

    text = str(raw or "").strip()
    match = _LEGACY_CLUE_DISCOVERED.match(text)
    if match:
        return {
            "kind": "clue_discovered",
            "clue_id": match.group("clue_id"),
            "legacy_source": text,
        }
    match = _LEGACY_CLOCK_REACHES.search(text)
    if match:
        return {
            "kind": "clock_reaches",
            "threshold": int(match.group("threshold")),
            "legacy_source": text,
        }
    return {"kind": "narrative", "description": text}


def evaluate_exit_condition(
    raw: Any,
    *,
    discovered_clue_ids: set[str],
    clock_reached: Callable[[str | None, int], bool],
    flags_set: set[str] | None = None,
) -> bool:
    """Evaluate one exit condition against structured state.

    ``clock_reached(clock_id, threshold)`` is supplied by the caller because
    the director reads clocks from its in-memory context while the apply layer
    reads persisted threat-state files. ``clock_id=None`` means "any tracked
    clock".

    ``flags_set`` is the set of flag ids that are currently true/present.
    """
    condition = normalize_exit_condition(raw)
    kind = condition["kind"]
    if kind == "always":
        return True
    if kind == "clue_discovered":
        return condition["clue_id"] in discovered_clue_ids
    if kind == "clock_reaches":
        return bool(clock_reached(condition.get("clock_id"), condition["threshold"]))
    if kind == "flag_set":
        return condition["flag_id"] in (flags_set or set())
    return False


__all__ = [
    "EXIT_CONDITION_KINDS",
    "normalize_exit_condition",
    "evaluate_exit_condition",
]
