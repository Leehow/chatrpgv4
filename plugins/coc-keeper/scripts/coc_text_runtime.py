#!/usr/bin/env python3
"""TextRuntime — reads the TextGraph artifact for the finalization layer.

Spec: docs/specs/pi-coc-text-graph-runtime.md §7

This module supplies **data** to the existing finalization implementation. It
does not derive an obligation, validate coverage, judge prose, or decide
anything; ``coc_turn_finalization`` keeps its exact control flow and reads its
closed vocabularies from here instead of holding them as frozenset literals.

Three contract laws are enforced at this seam:

``fail_closed_law``
    A missing, unparsable, or contract-invalid graph raises at import. There is
    deliberately NO fallback to embedded literals. This matters more here than
    for any other graph: ``turn.finalize`` is the product's most-called
    operation (321 of 3703 preserved calls), so a silent fallback would be both
    invisible and universal.

``ordinal_law``
    Two of these orders are behaviourally observable and are reconstructed from
    ``properties.ordinal``: mechanics placement order (``SEGMENT_TYPE_ORDER``)
    and the leading-segment law. The rest were frozensets in the source, so
    they are rebuilt as unordered ``frozenset`` values — deliberately, so that
    no consumer can begin depending on an order the source never had.

``identity_law``
    Every set returned here compares equal to the frozenset it replaced. T1 is
    behaviour-preserving; nothing is renamed, added, or dropped.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
REFERENCES_DIR = SCRIPT_DIR.parent / "references"

# A lane may run against a patched copy of the artifact so two lanes can differ
# by exactly one value. The override names a file; it can only redirect the
# read, never inject a value, so the contract's fail-closed and accountability
# rules still apply to whatever the file contains. Unset in production.
GRAPH_PATH_ENV = "COC_TEXT_GRAPH"
_ENV_GRAPH = os.environ.get(GRAPH_PATH_ENV)
GRAPH_PATH = Path(_ENV_GRAPH) if _ENV_GRAPH else REFERENCES_DIR / "text-graph.json"

GRAPH_CONTRACT_ID = "coc.text-graph.v1"


class TextGraphUnavailable(RuntimeError):
    """The TextGraph artifact is missing or does not satisfy its contract."""


_GRAPH_CACHE: dict[str, Any] | None = None
_VOCABULARY_CACHE: dict[str, Any] | None = None


def _load_graph() -> dict[str, Any]:
    global _GRAPH_CACHE
    if _GRAPH_CACHE is not None:
        return _GRAPH_CACHE
    try:
        graph = json.loads(GRAPH_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise TextGraphUnavailable(
            f"TextGraph artifact is missing at {GRAPH_PATH}; finalization fails "
            "closed rather than falling back to embedded vocabularies"
        ) from exc
    except json.JSONDecodeError as exc:
        raise TextGraphUnavailable(
            f"TextGraph artifact at {GRAPH_PATH} is not valid JSON: {exc}"
        ) from exc
    if not isinstance(graph, dict) or graph.get("contract_id") != GRAPH_CONTRACT_ID:
        raise TextGraphUnavailable(
            f"TextGraph artifact does not declare {GRAPH_CONTRACT_ID}"
        )
    if not isinstance(graph.get("nodes"), list):
        raise TextGraphUnavailable("TextGraph artifact has no node list")
    _GRAPH_CACHE = graph
    return graph


def reset_cache() -> None:
    """Drop the in-process artifact cache (tests reload after a rebuild)."""
    global _GRAPH_CACHE, _VOCABULARY_CACHE
    _GRAPH_CACHE = None
    _VOCABULARY_CACHE = None
    _CRAFT_CACHE.clear()


def _nodes_of_kind(kind: str) -> list[dict[str, Any]]:
    rows = [row for row in _load_graph()["nodes"] if row.get("node_kind") == kind]
    if not rows:
        raise TextGraphUnavailable(f"TextGraph declares no {kind!r} nodes")
    return rows


def _ordered(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(rows, key=lambda row: row["properties"]["ordinal"])


def _keys(kind: str) -> frozenset[str]:
    """Unordered rebuild. The source declared these as frozensets."""
    return frozenset(row["properties"]["legacy_key"] for row in _nodes_of_kind(kind))


def _keys_where(kind: str, prop: str, value: Any = True) -> frozenset[str]:
    return frozenset(
        row["properties"]["legacy_key"]
        for row in _nodes_of_kind(kind)
        if row["properties"].get(prop) == value
    )


def vocabulary() -> dict[str, Any]:
    """Return the finalization vocabularies in their exact legacy shapes."""
    global _VOCABULARY_CACHE
    if _VOCABULARY_CACHE is not None:
        return _VOCABULARY_CACHE

    segment_rows = _ordered(_nodes_of_kind("segment-type"))
    placement = {
        row["properties"]["legacy_key"]: row["properties"]["mechanic_placement_order"]
        for row in segment_rows
        if row["properties"]["mechanic_placement_order"] is not None
    }
    leading = [
        row["properties"]["legacy_key"]
        for row in segment_rows
        if row["properties"]["must_lead"] is True
    ]
    if len(leading) != 1:
        raise TextGraphUnavailable(
            "TextGraph must declare exactly one leading segment type; "
            f"found {leading!r}"
        )
    if sorted(placement.values()) != list(range(len(placement))):
        raise TextGraphUnavailable(
            "mechanic_placement_order must be a dense zero-based ordering; "
            f"found {sorted(placement.values())!r}"
        )

    vocabulary_payload = {
        "obligation_kinds": {
            row["properties"]["legacy_key"]: {
                "id_prefix": row["properties"]["id_prefix"],
                "builder": row["properties"]["builder"],
            }
            for row in _ordered(_nodes_of_kind("obligation-kind"))
        },
        "obligation_source_kinds": _keys("obligation-source-kind"),
        "source_kinds_by_obligation_kind": {
            owner: frozenset(
                row["properties"]["legacy_key"]
                for row in _nodes_of_kind("obligation-source-kind")
                if row["properties"]["obligation_kind"] == owner
            )
            for owner in {
                row["properties"]["obligation_kind"]
                for row in _nodes_of_kind("obligation-source-kind")
            }
        },
        "coverage_fields": _keys("coverage-field"),
        "realization_values": _keys("realization-mode"),
        "player_input_handling_values": _keys("player-input-handling"),
        "segment_types": _keys("segment-type"),
        "mechanic_segment_types": _keys_where("segment-type", "mechanic"),
        "segment_type_order": dict(
            sorted(placement.items(), key=lambda item: item[1])
        ),
        "leading_segment_type": leading[0],
        "agency_claim_types": _keys("agency-claim-type"),
        "voluntary_claim_types": _keys_where("agency-claim-type", "voluntary"),
        "roll_visibility_classes": _keys("roll-visibility-class"),
        "player_facing_roll_visibilities": _keys_where(
            "roll-visibility-class", "player_facing"
        ),
        "superseded_roll_visibilities": _keys_where(
            "roll-visibility-class", "superseded"
        ),
        "substantive_effect_statuses": _keys("substantive-effect-status"),
    }
    _VOCABULARY_CACHE = vocabulary_payload
    return vocabulary_payload


_CRAFT_CACHE: dict[str, dict[str, Any]] = {}


def craft(language: str = "zh-Hans") -> dict[str, Any]:
    """Return the craft plane, with only style axes filtered by language.

    ``language_law``: review rules, directives, slots, prohibitions, budgets and
    thresholds are language-independent — the Keeper reasons in whatever
    language the table uses. Exactly one style axis is language-scoped.
    """
    if language in _CRAFT_CACHE:
        return _CRAFT_CACHE[language]

    rules = _ordered(_nodes_of_kind("review-rule"))
    triggers = _nodes_of_kind("narration-budget-trigger")
    modes = _ordered(_nodes_of_kind("narration-budget-mode"))

    payload = {
        "review_rules": {
            row["properties"]["legacy_key"]: {
                "hard_gate": row["properties"]["hard_gate"],
                "citable": row["properties"]["citable"],
                "rationale": row["rationale"],
            }
            for row in rules
        },
        # Ordered, so the published enum is stable across rebuilds.
        "citable_review_rule_ids": tuple(
            row["properties"]["legacy_key"] for row in rules
            if row["properties"]["citable"] is True
        ),
        "hard_gate_review_rule_ids": frozenset(
            row["properties"]["legacy_key"] for row in rules
            if row["properties"]["hard_gate"] is True
        ),
        "craft_directives": {
            row["properties"]["directive_id"]: {
                "declares": row["properties"]["declares"],
                "rationale": row["rationale"],
            }
            for row in _ordered(_nodes_of_kind("craft-directive"))
        },
        "render_slots": tuple(
            row["properties"]["legacy_key"]
            for row in _ordered(_nodes_of_kind("render-slot"))
        ),
        "render_prohibitions": tuple(
            row["properties"]["legacy_key"]
            for row in _ordered(_nodes_of_kind("render-prohibition"))
        ),
        # Laws' nine beat types, carrying what each beat is FOR. The Keeper
        # names the beat; the host never guesses it. `gratification` and
        # `bringdown` are the levity dial that no collected library of witty
        # lines can supply, because the question is timing, not material.
        "play_registers": {
            row["properties"]["legacy_key"]: row["rationale"]
            for row in _ordered(_nodes_of_kind("play-register"))
        },
        "beat_types": {
            row["properties"]["legacy_key"]: {
                "family": row["properties"]["family"],
                "rationale": row["rationale"],
            }
            for row in _ordered(_nodes_of_kind("beat-type"))
        },
        "avoid": tuple(
            row["properties"]["legacy_key"]
            for row in _ordered(_nodes_of_kind("style-axis"))
            if row["properties"]["axis"] == "avoid"
            and row["properties"]["language_applicability"] in ("all", language)
        ),
        "prefer": tuple(
            row["properties"]["legacy_key"]
            for row in _ordered(_nodes_of_kind("style-axis"))
            if row["properties"]["axis"] == "prefer"
            and row["properties"]["language_applicability"] in ("all", language)
        ),
        "budget_modes": tuple(
            {
                "mode": row["properties"]["legacy_key"],
                "max_chars": row["properties"]["max_chars"],
                "max_paragraphs": row["properties"]["max_paragraphs"],
                "triggers": frozenset(
                    trigger["properties"]["legacy_key"] for trigger in triggers
                    if trigger["properties"]["budget_mode"]
                    == row["properties"]["legacy_key"]
                ),
            }
            for row in modes
        ),
        "thresholds": {
            row["properties"]["threshold_id"]: row["properties"]["value"]
            for row in _ordered(_nodes_of_kind("text-threshold"))
        },
    }
    _CRAFT_CACHE[language] = payload
    return payload


def threshold(threshold_id: str) -> Any:
    """Return one named text threshold, failing closed when it is absent."""
    values = craft()["thresholds"]
    if threshold_id not in values:
        raise TextGraphUnavailable(
            f"TextGraph declares no text-threshold {threshold_id!r}"
        )
    return values[threshold_id]
