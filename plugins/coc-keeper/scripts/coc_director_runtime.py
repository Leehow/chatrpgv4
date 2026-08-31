#!/usr/bin/env python3
"""DirectorRuntime — reads the DirectorGraph artifact for the scoring layer.

Spec: docs/specs/pi-coc-director-graph-runtime.md §7

This module supplies **data** to the existing Director implementation. It does
not score, select, traverse, or decide anything; ``coc_story_director`` keeps
its exact control flow and reads named constants from here instead of holding
them as literals.

Two contract laws are enforced at this seam:

``fail_closed_law``
    A missing, unparsable, or contract-invalid graph raises at load. There is
    deliberately NO fallback to embedded literals — a silent fallback would
    reintroduce exactly the untracked values the graph exists to eliminate.

``ordinal_law``
    Node ids sort alphabetically, but legacy declaration order is
    behaviourally observable (``select_action`` seeds its score dict from
    ACTIONS order, uses ACTIONS as the fallback tiebreak order, and returns
    ``candidates[0]``). Order is therefore reconstructed from
    ``properties.ordinal``, never from artifact order.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
REFERENCES_DIR = SCRIPT_DIR.parent / "references"
GRAPH_PATH = REFERENCES_DIR / "director-graph.json"
CONTRACT_PATH = REFERENCES_DIR / "director-graph-contract-v1.json"

GRAPH_CONTRACT_ID = "coc.director-graph.v1"


class DirectorGraphUnavailable(RuntimeError):
    """The DirectorGraph artifact is missing or does not satisfy its contract."""


_GRAPH_CACHE: dict[str, Any] | None = None
_VOCABULARY_CACHE: dict[str, Any] | None = None


def _load_graph() -> dict[str, Any]:
    global _GRAPH_CACHE
    if _GRAPH_CACHE is not None:
        return _GRAPH_CACHE
    try:
        graph = json.loads(GRAPH_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise DirectorGraphUnavailable(
            f"DirectorGraph artifact is missing at {GRAPH_PATH}; "
            "the Director fails closed rather than falling back to literals"
        ) from exc
    except json.JSONDecodeError as exc:
        raise DirectorGraphUnavailable(
            f"DirectorGraph artifact at {GRAPH_PATH} is not valid JSON: {exc}"
        ) from exc
    if not isinstance(graph, dict) or graph.get("contract_id") != GRAPH_CONTRACT_ID:
        raise DirectorGraphUnavailable(
            f"DirectorGraph artifact does not declare {GRAPH_CONTRACT_ID}"
        )
    if not isinstance(graph.get("nodes"), list):
        raise DirectorGraphUnavailable("DirectorGraph artifact has no node list")
    _GRAPH_CACHE = graph
    return graph


def reset_cache() -> None:
    """Drop the in-process artifact cache (tests reload after a rebuild)."""
    global _GRAPH_CACHE, _VOCABULARY_CACHE, _DOCTRINE_CACHE
    _GRAPH_CACHE = None
    _VOCABULARY_CACHE = None
    _DOCTRINE_CACHE = None


def _ordered(nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(nodes, key=lambda row: row["properties"]["ordinal"])


def _nodes_of_kind(kind: str) -> list[dict[str, Any]]:
    return [row for row in _load_graph()["nodes"] if row.get("node_kind") == kind]


def _legacy_keys(kind: str) -> list[str]:
    return [row["properties"]["legacy_key"] for row in _ordered(_nodes_of_kind(kind))]


def _signal_tags(group: str) -> list[str]:
    rows = [
        row for row in _nodes_of_kind("player-signal")
        if row["properties"].get("signal_group") == group
    ]
    if not rows:
        raise DirectorGraphUnavailable(
            f"DirectorGraph declares no player-signal tags for group {group!r}"
        )
    return [row["properties"]["legacy_key"] for row in _ordered(rows)]


def vocabulary() -> dict[str, Any]:
    """Return the Director vocabulary in its exact legacy shapes and order."""
    global _VOCABULARY_CACHE
    if _VOCABULARY_CACHE is not None:
        return _VOCABULARY_CACHE

    actions = _legacy_keys("director-action")
    if not actions:
        raise DirectorGraphUnavailable("DirectorGraph declares no director actions")

    vocab = {
        "actions": actions,
        "low_agency_tags": frozenset(_signal_tags("low-agency")),
        "low_agency_recent_classes": frozenset(
            _signal_tags("low-agency-recent-class")
        ),
        "routine_progress_tags": frozenset(_signal_tags("routine-progress")),
        "dramatic_progress_advance_until": _signal_tags(
            "dramatic-progress-advance-until"
        ),
        "non_blocking_rule_request_kinds": set(
            _signal_tags("non-blocking-rule-request")
        ),
        "social_reveal_delivery_kinds": set(
            _signal_tags("social-reveal-delivery")
        ),
        "structure_types": _legacy_keys("structure-type"),
        "conflict_levels": _legacy_keys("conflict-level"),
        "storylet_ids": _legacy_keys("storylet"),
        "time_cost_categories": _legacy_keys("time-cost-category"),
    }
    _VOCABULARY_CACHE = vocab
    return vocab


class _Doctrine:
    """Read-only accessor over the DirectorGraph doctrine plane.

    This class holds no policy. It looks values up by semantic id so the
    scoring implementation in ``coc_story_director`` keeps its exact control
    flow while the values themselves become accountable graph data.
    """

    __slots__ = ("_scores", "_thresholds", "_weights", "_tiebreak", "_ladders")

    def __init__(self, nodes: list[dict[str, Any]]) -> None:
        self._scores: dict[tuple[str, str], Any] = {}
        self._thresholds: dict[str, Any] = {}
        self._weights: dict[str, dict[str, float]] = {}
        self._tiebreak: list[str] = []
        self._ladders: dict[str, list[dict[str, Any]]] = {}
        # Semantic ids are kebab-case; the runtime must hand back the exact
        # legacy tokens (ACTIONS are uppercase, structure types snake_case),
        # so resolve every reference through the vocabulary plane.
        legacy: dict[str, str] = {
            node["node_id"]: node["properties"]["legacy_key"]
            for node in nodes
            if node.get("plane") == "vocabulary"
            and "legacy_key" in (node.get("properties") or {})
        }
        for node in nodes:
            kind = node.get("node_kind")
            props = node.get("properties") or {}
            if kind == "scoring-rule":
                action = legacy[props["action_ref"]]
                self._scores[(action, props["condition_id"])] = props["value"]
            elif kind == "threshold":
                self._thresholds[props["threshold_id"]] = props["value"]
            elif kind == "structure-weight":
                structure = legacy[props["structure_ref"]]
                action = legacy[props["action_ref"]]
                self._weights.setdefault(structure, {})[action] = props["value"]
            elif kind == "tiebreak-order":
                self._tiebreak = list(props["order"])
            elif kind == "affinity-ladder":
                self._ladders[props["ladder_id"]] = list(props["rungs"])

    def score(self, action: str, condition_id: str) -> Any:
        key = (action, condition_id)
        try:
            return self._scores[key]
        except KeyError:
            raise DirectorGraphUnavailable(
                f"DirectorGraph declares no scoring rule for {key}"
            ) from None

    def threshold(self, threshold_id: str) -> Any:
        try:
            return self._thresholds[threshold_id]
        except KeyError:
            raise DirectorGraphUnavailable(
                f"DirectorGraph declares no threshold {threshold_id!r}"
            ) from None

    def ladder(self, ladder_id: str) -> list[dict[str, Any]]:
        try:
            return self._ladders[ladder_id]
        except KeyError:
            raise DirectorGraphUnavailable(
                f"DirectorGraph declares no affinity ladder {ladder_id!r}"
            ) from None

    def structure_weights(self) -> dict[str, Any]:
        """Return the legacy structure-weights document shape."""
        return {
            "weights": {
                structure: dict(row) for structure, row in self._weights.items()
            },
            "tiebreak_order": list(self._tiebreak),
        }


_DOCTRINE_CACHE: _Doctrine | None = None


def doctrine() -> _Doctrine:
    """Return the doctrine accessor for the loaded DirectorGraph."""
    global _DOCTRINE_CACHE
    if _DOCTRINE_CACHE is None:
        _DOCTRINE_CACHE = _Doctrine(_load_graph()["nodes"])
    return _DOCTRINE_CACHE
