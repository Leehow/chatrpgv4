#!/usr/bin/env python3
"""Deterministic Director strategies for explicitly authored structures.

Only structured ids, counters, numeric signals and booleans are consumed.
Free-form module or scene prose is deliberately ignored.
"""
from __future__ import annotations

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


def strategy_for(structure_type: str) -> DirectorStrategy:
    return _STRATEGIES.get(str(structure_type or "").strip(), DirectorStrategy())


def compile_strategy(
    module_meta: dict[str, Any], prior_state: dict[str, Any], signals: dict[str, Any]
) -> dict[str, Any]:
    structure = str(module_meta.get("structure_type") or "").strip()
    result = strategy_for(structure).compile(prior_state or {}, signals or {})
    findings = list(result.get("capability_findings") or [])
    for mechanic in _ids(module_meta.get("special_mechanics")):
        if mechanic not in _SUPPORTED_MECHANICS:
            findings.append({
                "code": "unsupported_special_mechanic",
                "mechanic_id": mechanic,
                "severity": "warning",
            })
    result["capability_findings"] = findings
    return result
