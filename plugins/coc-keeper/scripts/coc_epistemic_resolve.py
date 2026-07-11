#!/usr/bin/env python3
"""Resolve planned epistemic contracts against actual clue commitment."""
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


def _hold_effect(effect: dict[str, Any], planned_mode: str) -> dict[str, Any]:
    held = _copy(effect)
    held.update({
        "mode": "HOLD",
        "hold_reason": "supporting_clue_not_committed",
        "planned_mode": planned_mode,
        "resolution": "supporting_clue_not_committed",
    })
    must_not = list(held.get("must_not") or [])
    must_not.extend([
        "do not narrate the planned belief update",
        "do not claim the supporting clue was discovered",
    ])
    held["must_not"] = list(dict.fromkeys(must_not))
    return held


def _resolve_effect(
    effect: dict[str, Any],
    committed: set[str],
) -> dict[str, Any]:
    resolved = _copy(effect)
    mode = str(resolved.get("mode") or "NONE").upper()
    resolved["mode"] = mode
    if mode not in _EFFECTIVE_MODES:
        return resolved
    planned_clues = _string_set(resolved.get("deliver_clue_ids"))
    if planned_clues & committed:
        resolved["resolution"] = "supporting_clue_committed"
        return resolved
    return _hold_effect(resolved, mode)


def _mirror_primary(
    contract: dict[str, Any],
    primary: dict[str, Any],
) -> dict[str, Any]:
    protected = {"schema_version", "effects", "resolved_effects", "primary_effect_id"}
    for key in list(contract):
        if key not in protected:
            contract.pop(key, None)
    for key, value in primary.items():
        if key != "effect_id":
            contract[key] = value
    contract["primary_effect_id"] = primary.get("effect_id")
    return contract


def resolve_epistemic_contract(
    planned_contract: dict[str, Any] | None,
    committed_clue_ids: list[str] | None,
) -> dict[str, Any] | None:
    """Return the narrator-facing contract after rule/clue resolution.

    Schema-v2 effects resolve independently. Schema-v1 contracts retain their
    original shape and behavior.
    """
    if not isinstance(planned_contract, dict):
        return None
    committed = _string_set(committed_clue_ids or [])
    resolved = _copy(planned_contract)
    raw_effects = resolved.get("effects")
    if isinstance(raw_effects, list):
        effects = [
            _resolve_effect(effect, committed)
            for effect in raw_effects
            if isinstance(effect, dict)
        ]
        if not effects:
            resolved["mode"] = str(resolved.get("mode") or "NONE").upper()
            return resolved
        ready = [effect for effect in effects if effect.get("mode") not in {"HOLD", "NONE"}]
        primary = ready[0] if ready else effects[0]
        resolved["schema_version"] = max(2, int(resolved.get("schema_version", 2) or 2))
        resolved["effects"] = effects
        resolved["resolved_effects"] = effects
        return _mirror_primary(resolved, primary)

    mode = str(resolved.get("mode") or "NONE").upper()
    resolved["mode"] = mode
    if mode not in _EFFECTIVE_MODES:
        return resolved
    planned_clues = _string_set(resolved.get("deliver_clue_ids"))
    if planned_clues & committed:
        resolved["resolution"] = "supporting_clue_committed"
        return resolved
    return _hold_effect(resolved, mode)
