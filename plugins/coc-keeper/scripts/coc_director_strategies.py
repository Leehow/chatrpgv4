#!/usr/bin/env python3
"""Deterministic Director strategies for explicitly authored structures.

Only structured ids, counters, numeric signals and booleans are consumed.
Free-form module or scene prose is deliberately ignored.
"""
from __future__ import annotations

import math
from typing import Any


def _ids(values: Any) -> list[str]:
    return list(dict.fromkeys(
        str(value).strip() for value in (values or [])
        if isinstance(value, str) and value.strip()
    ))


class DirectorStrategy:
    strategy_type = "generic"

    def compile(self, prior_state: dict[str, Any], signals: dict[str, Any]) -> dict[str, Any]:
        return {
            "strategy_state": {"strategy_type": self.strategy_type},
            "faction_rankings": [],
            "capability_findings": [],
        }


class TimeLoopStrategy(DirectorStrategy):
    strategy_type = "time_loop"

    def compile(self, prior_state: dict[str, Any], signals: dict[str, Any]) -> dict[str, Any]:
        loop = prior_state.get("loop_number", 0)
        if not isinstance(loop, int) or isinstance(loop, bool) or loop < 0:
            loop = 0
        if signals.get("loop_boundary") is True:
            loop += 1
        retained = _ids(
            list(prior_state.get("player_retained_memory_ids") or [])
            + list(signals.get("player_retained_memory_ids") or [])
        )
        return {
            "strategy_state": {
                "strategy_type": self.strategy_type,
                "loop_number": loop,
                "player_retained_memory_ids": retained,
            },
            "faction_rankings": [], "capability_findings": [],
        }


class MultiFactionStrategy(DirectorStrategy):
    strategy_type = "multi_faction"

    def compile(self, prior_state: dict[str, Any], signals: dict[str, Any]) -> dict[str, Any]:
        rows = []
        for raw in signals.get("factions") or []:
            if not isinstance(raw, dict):
                continue
            faction_id = raw.get("faction_id")
            pressure = raw.get("pressure", 0.0)
            momentum = raw.get("momentum", 0.0)
            if not isinstance(faction_id, str) or not faction_id.strip():
                continue
            if not isinstance(pressure, (int, float)) or isinstance(pressure, bool):
                continue
            if not isinstance(momentum, (int, float)) or isinstance(momentum, bool):
                continue
            rows.append({
                "faction_id": faction_id.strip(),
                "pressure": max(0.0, min(1.0, float(pressure))),
                "momentum": max(-1.0, min(1.0, float(momentum))),
            })
        rows.sort(key=lambda row: (-row["pressure"], -row["momentum"], row["faction_id"]))
        return {
            "strategy_state": {
                "strategy_type": self.strategy_type,
                "ranked_faction_ids": [row["faction_id"] for row in rows],
            },
            "faction_rankings": rows, "capability_findings": [],
        }


_STRATEGIES = {
    "time_loop": TimeLoopStrategy(),
    "multi_faction": MultiFactionStrategy(),
}
_SUPPORTED_MECHANICS = frozenset({"time_loop", "multi_faction"})


def _finding(code: str, detail: str) -> dict[str, str]:
    return {"code": code, "detail": detail, "severity": "warning"}


def validate_time_loop_signals(
    value: Any,
) -> tuple[dict[str, Any], list[dict[str, str]]]:
    """Canonicalize the only two authored time-loop scene signals."""
    fallback = {"loop_boundary": False, "player_retained_memory_ids": []}
    if not isinstance(value, dict) or set(value) != set(fallback):
        return fallback, [_finding("strategy_signals_invalid", "time_loop_shape")]
    boundary = value.get("loop_boundary")
    memories = value.get("player_retained_memory_ids")
    if (not isinstance(boundary, bool) or not isinstance(memories, list)
            or any(not isinstance(item, str) or not item.strip() for item in memories)):
        return fallback, [_finding("strategy_signals_invalid", "time_loop_types")]
    normalized = [item.strip() for item in memories]
    if len(normalized) != len(set(normalized)):
        return fallback, [_finding("strategy_signals_invalid", "time_loop_duplicate_ids")]
    return {
        "loop_boundary": boundary,
        "player_retained_memory_ids": normalized,
    }, []


def validate_strategy_state(
    value: Any, *, expected_strategy_type: str | None = None,
) -> tuple[dict[str, Any] | None, list[dict[str, str]]]:
    """Return a canonical persisted strategy state or fail closed."""
    if value in ({}, {"schema_version": 1}):
        return {}, []
    if not isinstance(value, dict) or value.get("schema_version") != 1:
        return None, [_finding("strategy_state_invalid", "root/schema_version")]
    strategy_type = value.get("strategy_type")
    if strategy_type not in {"generic", "time_loop", "multi_faction"}:
        return None, [_finding("strategy_state_invalid", "strategy_type")]
    if expected_strategy_type and strategy_type != expected_strategy_type:
        return None, [_finding("strategy_state_invalid", "strategy_type_mismatch")]
    common = {"schema_version", "strategy_type", "last_decision_id"}
    canonical: dict[str, Any] = {"schema_version": 1, "strategy_type": strategy_type}
    last = value.get("last_decision_id")
    if "last_decision_id" in value:
        if not isinstance(last, str) or not last.strip():
            return None, [_finding("strategy_state_invalid", "last_decision_id")]
        canonical["last_decision_id"] = last.strip()
    if strategy_type == "generic":
        allowed = common
    elif strategy_type == "time_loop":
        allowed = common | {"loop_number", "player_retained_memory_ids"}
        loop = value.get("loop_number")
        memories = value.get("player_retained_memory_ids")
        normalized_memories = (
            [item.strip() for item in memories]
            if isinstance(memories, list)
            and all(isinstance(item, str) for item in memories)
            else []
        )
        if (isinstance(loop, bool) or not isinstance(loop, int) or loop < 0
                or not isinstance(memories, list)
                or any(not isinstance(item, str) or not item.strip() for item in memories)
                or len(normalized_memories) != len(set(normalized_memories))):
            return None, [_finding("strategy_state_invalid", "time_loop_fields")]
        canonical.update({
            "loop_number": loop,
            "player_retained_memory_ids": normalized_memories,
        })
    else:
        allowed = common | {"ranked_faction_ids"}
        faction_ids = value.get("ranked_faction_ids")
        normalized_factions = (
            [item.strip() for item in faction_ids]
            if isinstance(faction_ids, list)
            and all(isinstance(item, str) for item in faction_ids)
            else []
        )
        if (not isinstance(faction_ids, list)
                or any(not isinstance(item, str) or not item.strip() for item in faction_ids)
                or len(normalized_factions) != len(set(normalized_factions))):
            return None, [_finding("strategy_state_invalid", "ranked_faction_ids")]
        canonical["ranked_faction_ids"] = normalized_factions
    if set(value) - allowed:
        return None, [_finding("strategy_state_invalid", "unknown_fields")]
    return canonical, []


def _validate_factions(value: Any) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    if not isinstance(value, list):
        return [], [_finding("strategy_factions_invalid", "factions_not_list")]
    ids: list[str] = []
    rows: list[dict[str, Any]] = []
    for raw in value:
        if not isinstance(raw, dict) or set(raw) != {"faction_id", "pressure", "momentum"}:
            return [], [_finding("strategy_factions_invalid", "faction_shape")]
        faction_id = raw.get("faction_id")
        pressure = raw.get("pressure")
        momentum = raw.get("momentum")
        if (not isinstance(faction_id, str) or not faction_id.strip()
                or isinstance(pressure, bool) or not isinstance(pressure, (int, float))
                or not math.isfinite(float(pressure))
                or isinstance(momentum, bool) or not isinstance(momentum, (int, float))
                or not math.isfinite(float(momentum))):
            return [], [_finding("strategy_factions_invalid", "faction_values")]
        ids.append(faction_id.strip())
        rows.append(dict(raw))
    if len(ids) != len(set(ids)):
        return [], [_finding("strategy_faction_ids_duplicate", "faction_id")]
    return rows, []


def strategy_for(structure_type: str) -> DirectorStrategy:
    return _STRATEGIES.get(str(structure_type or "").strip(), DirectorStrategy())


def compile_strategy(
    module_meta: dict[str, Any], prior_state: dict[str, Any], signals: dict[str, Any]
) -> dict[str, Any]:
    meta = module_meta if isinstance(module_meta, dict) else {}
    signal_map = signals if isinstance(signals, dict) else {}
    structure = str(meta.get("structure_type") or "").strip()
    expected = structure if structure in _STRATEGIES else "generic"
    prior, state_findings = validate_strategy_state(
        prior_state, expected_strategy_type=expected,
    )
    if prior is None:
        prior = {}
    findings = list(state_findings)
    faction_findings: list[dict[str, str]] = []
    signal_findings: list[dict[str, str]] = []
    if structure == "time_loop":
        signal_map, signal_findings = validate_time_loop_signals(signal_map)
        findings.extend(signal_findings)
    if structure == "multi_faction":
        factions, faction_findings = _validate_factions(signal_map.get("factions", []))
        findings.extend(faction_findings)
        signal_map = {**signal_map, "factions": factions}
    result = strategy_for(structure).compile(prior, signal_map)
    generated = {"schema_version": 1, **(result.get("strategy_state") or {})}
    canonical, generated_findings = validate_strategy_state(
        generated, expected_strategy_type=expected,
    )
    findings.extend(generated_findings)
    if canonical is None:
        canonical = {"schema_version": 1, "strategy_type": expected}
        if expected == "time_loop":
            canonical.update({"loop_number": 0, "player_retained_memory_ids": []})
        elif expected == "multi_faction":
            canonical["ranked_faction_ids"] = []
    if faction_findings:
        canonical = {"schema_version": 1, "strategy_type": "multi_faction", "ranked_faction_ids": []}
        result["faction_rankings"] = []
    result["strategy_state"] = canonical
    findings.extend(result.get("capability_findings") or [])
    for mechanic in _ids(meta.get("special_mechanics")):
        if mechanic not in _SUPPORTED_MECHANICS:
            findings.append({
                "code": "unsupported_special_mechanic",
                "mechanic_id": mechanic,
                "severity": "warning",
            })
    result["capability_findings"] = findings
    return result
