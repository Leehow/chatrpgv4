#!/usr/bin/env python3
"""Minimum-privilege projection of resolved epistemic contracts for narration.

The narrator receives player-safe question labels and structured constraints,
never truth bodies, source prose, compiler reasons, or Keeper-secret text.
"""
from __future__ import annotations

from typing import Any

_READY_MODES = frozenset({"CONFIRM", "EXPAND", "COMPLICATE", "REFRAME", "PAYOFF"})


def _strings(value: Any) -> list[str]:
    if value is None:
        source: list[Any] = []
    elif isinstance(value, (list, tuple, set)):
        source = list(value)
    else:
        source = [value]
    result: list[str] = []
    seen: set[str] = set()
    for item in source:
        if not isinstance(item, str):
            continue
        text = item.strip()
        if text and text not in seen:
            seen.add(text)
            result.append(text)
    return result


def _effects(contract: dict[str, Any]) -> list[dict[str, Any]]:
    raw = contract.get("resolved_effects")
    if not isinstance(raw, list):
        raw = contract.get("effects")
    if isinstance(raw, list):
        return [effect for effect in raw if isinstance(effect, dict)]
    return [contract]


def _question_labels(graph: dict[str, Any] | None) -> dict[str, str]:
    labels: dict[str, str] = {}
    for question in (graph or {}).get("questions") or []:
        if not isinstance(question, dict):
            continue
        question_id = question.get("question_id")
        label = question.get("player_facing_question")
        if isinstance(question_id, str) and question_id and isinstance(label, str) and label.strip():
            labels[question_id] = label.strip()
    return labels


def _question_ref(question_id: Any, labels: dict[str, str]) -> dict[str, str] | None:
    if not isinstance(question_id, str) or not question_id.strip():
        return None
    qid = question_id.strip()
    result = {"question_id": qid}
    if labels.get(qid):
        result["label"] = labels[qid]
    return result


def _append_ref(target: list[dict[str, str]], ref: dict[str, str] | None) -> None:
    if ref is None:
        return
    if any(item.get("question_id") == ref.get("question_id") for item in target):
        return
    target.append(ref)


def _safe_effect(effect: dict[str, Any], labels: dict[str, str]) -> dict[str, Any]:
    mode = str(effect.get("mode") or "NONE").upper()
    result: dict[str, Any] = {
        "effect_id": effect.get("effect_id"),
        "mode": mode,
        "question": _question_ref(effect.get("target_question_id"), labels),
        "target_layer": effect.get("target_layer"),
        "deliver_clue_ids": _strings(effect.get("deliver_clue_ids")),
    }
    if effect.get("planned_mode"):
        result["planned_mode"] = str(effect.get("planned_mode")).upper()
    if effect.get("hold_reason"):
        result["hold_reason"] = str(effect.get("hold_reason"))
    if effect.get("reveal_contract_id"):
        result["reveal_contract_id"] = str(effect.get("reveal_contract_id"))
    return {key: value for key, value in result.items() if value not in (None, [], {})}


def build_belief_update_projection(
    resolved_contract: dict[str, Any] | None,
    epistemic_graph: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Return a narrator-safe projection of a resolved contract.

    `truth_ref`, `source_refs`, confidence records, semantic reasons, hypothesis
    claims, and any raw prose are deliberately excluded.
    """
    if not isinstance(resolved_contract, dict):
        return None
    top_mode = str(resolved_contract.get("mode") or "NONE").upper()
    if top_mode == "NONE":
        return None

    labels = _question_labels(epistemic_graph)
    effects = _effects(resolved_contract)
    safe_effects = [_safe_effect(effect, labels) for effect in effects]
    safe_effects = [effect for effect in safe_effects if effect.get("mode") != "NONE"]

    projection: dict[str, Any] = {
        "schema_version": 1,
        "mode": top_mode,
        "effects": safe_effects,
        "preserve_as_true": [],
        "newly_supported": [],
        "newly_uncertain": [],
        "reframed": [],
        "new_questions": [],
        "explanation_targets": [],
        "must_not": [],
    }

    ready_effects = [
        effect for effect in effects
        if str(effect.get("mode") or "NONE").upper() in _READY_MODES
    ]
    for effect in effects:
        mode = str(effect.get("mode") or "NONE").upper()
        question = _question_ref(effect.get("target_question_id"), labels)
        if mode in {"CONFIRM", "EXPAND", "PAYOFF"}:
            _append_ref(projection["newly_supported"], question)
        elif mode == "COMPLICATE":
            _append_ref(projection["newly_uncertain"], question)
        elif mode == "REFRAME":
            _append_ref(projection["reframed"], question)

        if mode != "HOLD":
            for question_id in _strings(effect.get("open_question_ids")):
                _append_ref(projection["new_questions"], _question_ref(question_id, labels))
        projection["preserve_as_true"] = _strings([
            *projection["preserve_as_true"],
            *_strings(effect.get("preserve_fact_refs")),
        ])
        projection["explanation_targets"] = _strings([
            *projection["explanation_targets"],
            *_strings(effect.get("explanation_targets")),
        ])
        projection["must_not"] = _strings([
            *projection["must_not"],
            *_strings(effect.get("must_not")),
        ])

    if not ready_effects and top_mode == "HOLD":
        projection["planned_mode"] = str(
            resolved_contract.get("planned_mode")
            or next(
                (
                    effect.get("planned_mode")
                    for effect in effects
                    if effect.get("planned_mode")
                ),
                "",
            )
        ).upper()
        projection["hold_reason"] = str(
            resolved_contract.get("hold_reason")
            or next(
                (
                    effect.get("hold_reason")
                    for effect in effects
                    if effect.get("hold_reason")
                ),
                "evidence_not_ready",
            )
        )
        projection["must_not"] = _strings([
            *projection["must_not"],
            "do not narrate the planned belief update",
            "do not claim uncommitted or unapproved evidence was discovered",
        ])

    return projection
