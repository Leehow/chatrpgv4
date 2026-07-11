#!/usr/bin/env python3
"""Resolve planned epistemic contracts against actual clue commitment.

The Story Director plans before dice are rolled. Narration must consume a
post-rule contract so a failed obscured clue cannot accidentally confirm,
complicate, or reframe the player's model.
"""
from __future__ import annotations

import json
from typing import Any

_EFFECTIVE_MODES = frozenset({"CONFIRM", "EXPAND", "COMPLICATE", "REFRAME", "PAYOFF"})


def _copy(value: dict[str, Any]) -> dict[str, Any]:
    return json.loads(json.dumps(value, ensure_ascii=False))


def _string_set(value: Any) -> set[str]:
    if not isinstance(value, list):
        return set()
    return {
        item.strip()
        for item in value
        if isinstance(item, str) and item.strip()
    }


def resolve_epistemic_contract(
    planned_contract: dict[str, Any] | None,
    committed_clue_ids: list[str] | None,
) -> dict[str, Any] | None:
    """Return the narrator-facing contract after rule/clue resolution.

    NONE and pre-existing HOLD contracts pass through. Effective treatments
    require at least one planned supporting clue to have committed this turn.
    When none lands, the treatment is converted into HOLD while retaining safe
    audit fields and the original constraints.
    """
    if not isinstance(planned_contract, dict):
        return None
    resolved = _copy(planned_contract)
    mode = str(resolved.get("mode") or "NONE").upper()
    resolved["mode"] = mode
    if mode not in _EFFECTIVE_MODES:
        return resolved

    planned_clues = _string_set(resolved.get("deliver_clue_ids"))
    committed = _string_set(committed_clue_ids or [])
    if planned_clues & committed:
        resolved["resolution"] = "supporting_clue_committed"
        return resolved

    held = {
        "schema_version": int(resolved.get("schema_version", 1) or 1),
        "mode": "HOLD",
        "hold_reason": "supporting_clue_not_committed",
        "planned_mode": mode,
        "target_question_id": resolved.get("target_question_id"),
        "target_layer": resolved.get("target_layer"),
        "deliver_clue_ids": list(resolved.get("deliver_clue_ids") or []),
        "belief_refs": list(resolved.get("belief_refs") or []),
        "preserve_fact_refs": list(resolved.get("preserve_fact_refs") or []),
        "setup_refs": list(resolved.get("setup_refs") or []),
        "must_not": list(resolved.get("must_not") or []),
    }
    held["must_not"].extend([
        "do not narrate the planned belief update",
        "do not claim the supporting clue was discovered",
    ])
    held["must_not"] = list(dict.fromkeys(held["must_not"]))
    return held
