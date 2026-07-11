#!/usr/bin/env python3
"""Deterministic player-belief update planning for COC Story Director.

The policy consumes only structured scenario sidecars, belief-state records,
world-state IDs, compile-confidence records, and the selected clue policy. It
never scans player or module prose to infer meaning.
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import coc_compile_confidence
import coc_source_resolution

SCHEMA_VERSION = 2
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
    """Return the exact v1 no-op shape for strict backward compatibility."""
    return {"schema_version": 1, "mode": "NONE"}


def _as_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    return [value]


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


def _candidate_links(
    graph: dict[str, Any],
    clue_id: str,
    belief_state: dict[str, Any],
) -> list[tuple[float, int, dict[str, Any], dict[str, Any]]]:
    active_questions = {
        str(value)
        for value in _as_list(belief_state.get("active_question_ids"))
        if isinstance(value, str) and value
    }
    candidates: list[tuple[float, int, dict[str, Any], dict[str, Any]]] = []
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
        candidates.append((score, -index, link, question))
    return sorted(candidates, key=lambda item: (item[0], item[1]), reverse=True)


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
        triggers = set(_ordered_strings(contract.get("trigger_clue_ids")))
        if clue_id not in triggers:
            continue
        return contract
    return None


def _confidence_hold(
    ctx: dict[str, Any],
    *,
    question: dict[str, Any],
    node_type: str,
    node_id: str,
    source_refs: list[dict[str, Any]],
) -> dict[str, Any] | None:
    importance = str(question.get("importance") or "").lower()
    if importance != "critical":
        return None
    readiness = coc_compile_confidence.node_ready(
        ctx.get("compile_confidence"), node_type, node_id
    )
    if readiness.get("ready"):
        return None
    return {
        "mode": "HOLD",
        "hold_reason": str(readiness.get("reason") or "low_compile_confidence"),
        "compile_confidence": readiness,
        "source_resolution_request": coc_source_resolution.build_source_resolution_request(
            node_id,
            "critical_reveal_low_confidence",
            source_refs,
        ),
    }


def _base_effect(
    clue_id: str,
    link: dict[str, Any],
    question: dict[str, Any],
    belief_state: dict[str, Any],
) -> dict[str, Any]:
    effect = str(link.get("effect") or "").lower()
    question_id = str(link.get("question_id"))
    return {
        "effect_id": f"{clue_id}:{question_id}:{effect}",
        "mode": _EFFECT_TO_MODE[effect],
        "target_question_id": question_id,
        "target_layer": question.get("layer"),
        "belief_refs": _active_belief_refs(belief_state, question_id),
        "deliver_clue_ids": [clue_id],
        "evidence_strength": _strength(link.get("strength")),
        "preserve_fact_refs": [],
        "revise_hypothesis_refs": [],
        "setup_refs": [],
        "open_question_ids": _ordered_strings(question.get("opens_questions")),
        "explanation_targets": [],
        "must_not": [],
    }


def _build_effect(
    ctx: dict[str, Any],
    *,
    clue_id: str,
    link: dict[str, Any],
    question: dict[str, Any],
    belief_state: dict[str, Any],
) -> dict[str, Any]:
    effect_name = str(link.get("effect") or "").lower()
    effect = _base_effect(clue_id, link, question, belief_state)

    question_hold = _confidence_hold(
        ctx,
        question=question,
        node_type="question",
        node_id=str(question.get("question_id") or ""),
        source_refs=[ref for ref in (question.get("source_refs") or []) if isinstance(ref, dict)],
    )
    if question_hold is not None:
        effect.update(question_hold)
        effect["planned_mode"] = _EFFECT_TO_MODE[effect_name]
        return effect

    if effect_name != "reframe":
        return effect

    contracts_doc = ctx.get("reveal_contracts")
    if not isinstance(contracts_doc, dict):
        contracts_doc = {}
    question_id = str(question.get("question_id") or "")
    reveal = _find_reframe_contract(
        contracts_doc, question_id=question_id, clue_id=clue_id
    )
    if reveal is None:
        effect["planned_mode"] = "REFRAME"
        effect["mode"] = "HOLD"
        effect["hold_reason"] = "missing_reveal_contract"
        return effect

    effect.update({
        "preserve_fact_refs": _ordered_strings(reveal.get("preserve_as_true")),
        "setup_refs": _ordered_strings(reveal.get("setup_refs")),
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
        if not isinstance(hypothesis, dict) or hypothesis.get("question_id") != question_id:
            continue
        if revise_kinds and hypothesis.get("hypothesis_kind") not in revise_kinds:
            continue
        hypothesis_id = hypothesis.get("hypothesis_id")
        if isinstance(hypothesis_id, str) and hypothesis_id:
            revise_refs.append(hypothesis_id)
    effect["revise_hypothesis_refs"] = revise_refs

    reveal_id = str(reveal.get("reveal_contract_id") or "")
    reveal_hold = _confidence_hold(
        ctx,
        question=question,
        node_type="reveal_contract",
        node_id=reveal_id,
        source_refs=[ref for ref in (reveal.get("source_refs") or question.get("source_refs") or []) if isinstance(ref, dict)],
    )
    if reveal_hold is not None:
        effect.update(reveal_hold)
        effect["planned_mode"] = "REFRAME"
        return effect

    discovered = {
        str(value)
        for value in _as_list((ctx.get("world_state") or {}).get("discovered_clue_ids"))
        if value
    }
    available_setup = discovered | {clue_id}
    missing_setup = [setup for setup in effect["setup_refs"] if setup not in available_setup]
    if missing_setup:
        effect["planned_mode"] = "REFRAME"
        effect["mode"] = "HOLD"
        effect["hold_reason"] = "insufficient_setup"
        effect["missing_setup_refs"] = missing_setup
    return effect


def _top_level_from_effect(effect: dict[str, Any], effects: list[dict[str, Any]]) -> dict[str, Any]:
    contract = {
        "schema_version": SCHEMA_VERSION,
        **{key: value for key, value in effect.items() if key != "effect_id"},
        "effects": effects,
    }
    contract["primary_effect_id"] = effect.get("effect_id")
    return contract


def plan_epistemic_contract(
    ctx: dict[str, Any],
    clue_policy: dict[str, Any],
    scene_action: str,
) -> dict[str, Any]:
    """Build a multi-effect belief-update contract for the selected clue."""
    del scene_action
    graph = ctx.get("epistemic_graph")
    if not isinstance(graph, dict) or not graph.get("questions"):
        return empty_contract()
    clue_id = _selected_clue_id(clue_policy)
    if clue_id is None:
        return empty_contract()
    belief_state = ctx.get("belief_state")
    if not isinstance(belief_state, dict):
        belief_state = {}
    candidates = _candidate_links(graph, clue_id, belief_state)
    if not candidates:
        return empty_contract()

    built: list[tuple[float, int, dict[str, Any]]] = []
    for score, order, link, question in candidates:
        built.append((
            score,
            order,
            _build_effect(
                ctx,
                clue_id=clue_id,
                link=link,
                question=question,
                belief_state=belief_state,
            ),
        ))
    # A ready effect is primary whenever one exists; an unready high-ranked
    # reframe remains visible as a secondary HOLD instead of suppressing progress.
    ready = [item for item in built if item[2].get("mode") != "HOLD"]
    primary_item = ready[0] if ready else built[0]
    ordered_items = [primary_item] + [item for item in built if item is not primary_item]
    effects = [item[2] for item in ordered_items]
    return _top_level_from_effect(effects[0], effects)
