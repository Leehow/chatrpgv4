#!/usr/bin/env python3
"""Deterministic player-belief update planning for COC Story Director.

This module consumes only structured scenario sidecars, belief-state records,
world-state ids, and the already-selected clue policy. It never scans player or
module prose to infer meaning (Semantic Matcher Constitution).
"""
from __future__ import annotations

from typing import Any

SCHEMA_VERSION = 1
VALID_EFFECTS = frozenset({"confirm", "expand", "complicate", "reframe", "payoff"})
_EFFECT_TO_MODE = {
    "confirm": "CONFIRM",
    "expand": "EXPAND",
    "complicate": "COMPLICATE",
    "reframe": "REFRAME",
    "payoff": "PAYOFF",
}
_IMPORTANCE_WEIGHT = {"critical": 0.3, "major": 0.2, "minor": 0.1}


def empty_contract() -> dict[str, Any]:
    """Return the canonical legacy/no-op epistemic contract."""
    return {"schema_version": SCHEMA_VERSION, "mode": "NONE"}


def _as_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    return [value]


def _selected_clue_id(clue_policy: dict[str, Any] | None) -> str | None:
    policy = clue_policy if isinstance(clue_policy, dict) else {}
    for key in ("reveal", "fallback_routes"):
        for value in _as_list(policy.get(key)):
            if isinstance(value, str) and value.strip():
                return value.strip()
    return None


def _find_question(graph: dict[str, Any], question_id: str) -> dict[str, Any] | None:
    for question in _as_list(graph.get("questions")):
        if isinstance(question, dict) and question.get("question_id") == question_id:
            return question
    return None


def _active_belief_refs(belief_state: dict[str, Any], question_id: str) -> list[str]:
    refs: list[str] = []
    retired = {"abandoned", "retired"}
    for hypothesis in _as_list(belief_state.get("hypotheses")):
        if not isinstance(hypothesis, dict):
            continue
        if hypothesis.get("question_id") != question_id:
            continue
        if str(hypothesis.get("status") or "active").lower() in retired:
            continue
        hypothesis_id = hypothesis.get("hypothesis_id")
        if isinstance(hypothesis_id, str) and hypothesis_id:
            refs.append(hypothesis_id)
    return refs


def _strength(value: Any) -> float:
    try:
        return max(0.0, min(1.0, float(value)))
    except (TypeError, ValueError):
        return 0.5


def _select_evidence_link(
    graph: dict[str, Any],
    clue_id: str,
    belief_state: dict[str, Any],
) -> dict[str, Any] | None:
    """Choose one clue→question effect using the player's active model.

    A clue may legitimately serve several question layers. Source-array order
    must not decide which cognitive contract wins. Active questions dominate,
    then questions with live hypotheses, then source strength and importance.
    Ties remain deterministic through original list order.
    """
    active_questions = {
        str(value)
        for value in _as_list(belief_state.get("active_question_ids"))
        if isinstance(value, str) and value
    }
    candidates: list[tuple[float, int, dict[str, Any]]] = []
    for index, link in enumerate(_as_list(graph.get("evidence_links"))):
        if not isinstance(link, dict) or link.get("clue_id") != clue_id:
            continue
        effect = str(link.get("effect") or "").strip().lower()
        question_id = link.get("question_id")
        if effect not in VALID_EFFECTS or not isinstance(question_id, str) or not question_id:
            continue
        question = _find_question(graph, question_id)
        if question is None:
            continue
        score = _strength(link.get("strength"))
        if question_id in active_questions:
            score += 4.0
        if _active_belief_refs(belief_state, question_id):
            score += 3.0
        score += _IMPORTANCE_WEIGHT.get(str(question.get("importance") or "").lower(), 0.0)
        candidates.append((score, -index, link))
    if not candidates:
        return None
    return max(candidates, key=lambda item: (item[0], item[1]))[2]


def _find_reframe_contract(
    contracts_doc: dict[str, Any],
    *,
    question_id: str,
    clue_id: str,
) -> dict[str, Any] | None:
    for contract in _as_list(contracts_doc.get("contracts")):
        if not isinstance(contract, dict):
            continue
        if str(contract.get("mode") or "").lower() != "reframe":
            continue
        if contract.get("target_question_id") != question_id:
            continue
        triggers = {
            str(value)
            for value in _as_list(contract.get("trigger_clue_ids"))
            if isinstance(value, str) and value
        }
        if clue_id not in triggers:
            continue
        return contract
    return None


def _ordered_strings(value: Any) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for item in _as_list(value):
        if not isinstance(item, str):
            continue
        text = item.strip()
        if not text or text in seen:
            continue
        seen.add(text)
        result.append(text)
    return result


def plan_epistemic_contract(
    ctx: dict[str, Any],
    clue_policy: dict[str, Any],
    scene_action: str,
) -> dict[str, Any]:
    """Build a belief-update contract for the clue selected this turn.

    The current v1 policy is intentionally conservative: it only acts when a
    compiled evidence link points from the selected clue to a known question.
    A reframe additionally requires a compiled reveal contract and all setup
    clue ids to be discovered (the triggering clue may count as this-turn
    evidence). Missing or malformed data degrades to NONE or HOLD.
    """
    del scene_action  # reserved for later action-specific policies

    graph = ctx.get("epistemic_graph")
    if not isinstance(graph, dict) or not graph.get("questions"):
        return empty_contract()

    clue_id = _selected_clue_id(clue_policy)
    if clue_id is None:
        return empty_contract()

    belief_state = ctx.get("belief_state")
    if not isinstance(belief_state, dict):
        belief_state = {}
    link = _select_evidence_link(graph, clue_id, belief_state)
    if not isinstance(link, dict):
        return empty_contract()

    effect = str(link.get("effect") or "").strip().lower()
    question_id = link.get("question_id")
    if effect not in VALID_EFFECTS or not isinstance(question_id, str) or not question_id:
        return empty_contract()
    question = _find_question(graph, question_id)
    if question is None:
        return empty_contract()

    belief_refs = _active_belief_refs(belief_state, question_id)
    base: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "mode": _EFFECT_TO_MODE[effect],
        "target_question_id": question_id,
        "target_layer": question.get("layer"),
        "belief_refs": belief_refs,
        "deliver_clue_ids": [clue_id],
        "evidence_strength": _strength(link.get("strength")),
        "preserve_fact_refs": [],
        "revise_hypothesis_refs": [],
        "setup_refs": [],
        "open_question_ids": _ordered_strings(question.get("opens_questions")),
        "explanation_targets": [],
        "must_not": [],
    }

    if effect != "reframe":
        return base

    contracts_doc = ctx.get("reveal_contracts")
    if not isinstance(contracts_doc, dict):
        contracts_doc = {}
    reveal = _find_reframe_contract(
        contracts_doc,
        question_id=question_id,
        clue_id=clue_id,
    )
    if reveal is None:
        base["mode"] = "HOLD"
        base["hold_reason"] = "missing_reveal_contract"
        return base

    setup_refs = _ordered_strings(reveal.get("setup_refs"))
    discovered = {
        str(value)
        for value in _as_list((ctx.get("world_state") or {}).get("discovered_clue_ids"))
        if value
    }
    available_setup = discovered | {clue_id}
    missing_setup = [setup for setup in setup_refs if setup not in available_setup]

    base.update({
        "preserve_fact_refs": _ordered_strings(reveal.get("preserve_as_true")),
        "setup_refs": setup_refs,
        "open_question_ids": _ordered_strings(
            reveal.get("opens_questions") or question.get("opens_questions")
        ),
        "explanation_targets": _ordered_strings(reveal.get("explanation_targets")),
        "must_not": _ordered_strings(reveal.get("must_not")),
        "reveal_contract_id": reveal.get("reveal_contract_id"),
    })

    revise_kinds = set(_ordered_strings(reveal.get("revise_hypothesis_kinds")))
    revise_refs: list[str] = []
    for hypothesis in _as_list(belief_state.get("hypotheses")):
        if not isinstance(hypothesis, dict):
            continue
        if hypothesis.get("question_id") != question_id:
            continue
        if revise_kinds and hypothesis.get("hypothesis_kind") not in revise_kinds:
            continue
        hypothesis_id = hypothesis.get("hypothesis_id")
        if isinstance(hypothesis_id, str) and hypothesis_id:
            revise_refs.append(hypothesis_id)
    base["revise_hypothesis_refs"] = revise_refs

    if missing_setup:
        base["mode"] = "HOLD"
        base["hold_reason"] = "insufficient_setup"
        base["missing_setup_refs"] = missing_setup
        return base

    return base
