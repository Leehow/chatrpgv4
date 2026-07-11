#!/usr/bin/env python3
"""Deterministic opening and closure of compiled epistemic questions."""
from __future__ import annotations

from typing import Any

VALID_CLOSURE_KINDS = frozenset({
    "clue_any",
    "clue_all",
    "evidence_count",
    "flag_set",
    "scene_entered",
    "payoff",
    "explicit",
})
VALID_OPEN_KINDS = frozenset({
    "clue_any",
    "clue_all",
    "evidence_count",
    "flag_set",
    "scene_entered",
    "question_answered",
    "explicit",
})


def _strings(value: Any) -> list[str]:
    if value is None:
        source: list[Any] = []
    elif isinstance(value, list):
        source = value
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


def _question_map(graph: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        str(question["question_id"]): question
        for question in graph.get("questions") or []
        if isinstance(question, dict) and question.get("question_id")
    }


def _condition_satisfied(
    condition: dict[str, Any],
    *,
    discovered: set[str],
    flags: set[str],
    visited: set[str],
    answered: set[str],
    payoff_questions: set[str],
    explicit_ids: set[str],
    question_id: str,
) -> bool:
    kind = str(condition.get("kind") or "").strip()
    clue_ids = set(_strings(condition.get("clue_ids")))
    if kind == "clue_any":
        return bool(clue_ids & discovered)
    if kind == "clue_all":
        return bool(clue_ids) and clue_ids.issubset(discovered)
    if kind == "evidence_count":
        try:
            required = max(1, int(condition.get("count", 1) or 1))
        except (TypeError, ValueError):
            required = 1
        pool = clue_ids if clue_ids else discovered
        return len(pool & discovered) >= required
    if kind == "flag_set":
        flag_id = condition.get("flag_id")
        return isinstance(flag_id, str) and flag_id in flags
    if kind == "scene_entered":
        scene_id = condition.get("scene_id")
        return isinstance(scene_id, str) and scene_id in visited
    if kind == "question_answered":
        target = condition.get("question_id")
        return isinstance(target, str) and target in answered
    if kind == "payoff":
        return question_id in payoff_questions
    if kind == "explicit":
        return question_id in explicit_ids
    return False


def _conditions_satisfied(
    raw: Any,
    *,
    discovered: set[str],
    flags: set[str],
    visited: set[str],
    answered: set[str],
    payoff_questions: set[str],
    explicit_ids: set[str],
    question_id: str,
) -> bool:
    if isinstance(raw, dict):
        conditions = [raw]
        mode = str(raw.get("match") or "all")
    elif isinstance(raw, list):
        conditions = [item for item in raw if isinstance(item, dict)]
        mode = "all"
    else:
        return False
    if not conditions:
        return False
    results = [
        _condition_satisfied(
            condition,
            discovered=discovered,
            flags=flags,
            visited=visited,
            answered=answered,
            payoff_questions=payoff_questions,
            explicit_ids=explicit_ids,
            question_id=question_id,
        )
        for condition in conditions
    ]
    return any(results) if mode == "any" else all(results)


def evaluate_question_transitions(
    graph: dict[str, Any] | None,
    belief_state: dict[str, Any] | None,
    world_state: dict[str, Any] | None,
    committed_clue_ids: list[str] | None,
    *,
    flags_set: set[str] | list[str] | None = None,
    visited_scene_ids: set[str] | list[str] | None = None,
    explicit_close_ids: set[str] | list[str] | None = None,
    explicit_open_ids: set[str] | list[str] | None = None,
    resolved_effects: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Evaluate authored question transitions from structured state only."""
    graph = graph if isinstance(graph, dict) else {}
    state = belief_state if isinstance(belief_state, dict) else {}
    world = world_state if isinstance(world_state, dict) else {}
    questions = _question_map(graph)
    active = set(_strings(state.get("active_question_ids")))
    answered = set(_strings(state.get("answered_question_ids")))
    discovered = set(_strings(world.get("discovered_clue_ids")))
    discovered.update(_strings(committed_clue_ids))
    flags = set(_strings(flags_set))
    visited = set(_strings(visited_scene_ids))
    visited.update(_strings(world.get("visited_scene_ids")))
    explicit_close = set(_strings(explicit_close_ids))
    explicit_open = set(_strings(explicit_open_ids))
    payoff_questions = {
        str(effect.get("target_question_id"))
        for effect in (resolved_effects or [])
        if isinstance(effect, dict)
        and str(effect.get("mode") or "").upper() == "PAYOFF"
        and effect.get("target_question_id")
    }

    to_open: list[str] = []
    to_answer: list[str] = []
    findings: list[dict[str, Any]] = []

    # Authored open conditions and explicit openings.
    for question_id, question in questions.items():
        if question_id in active or question_id in answered:
            continue
        should_open = question_id in explicit_open
        if not should_open and question.get("opens_when") is not None:
            should_open = _conditions_satisfied(
                question.get("opens_when"),
                discovered=discovered,
                flags=flags,
                visited=visited,
                answered=answered,
                payoff_questions=payoff_questions,
                explicit_ids=explicit_open,
                question_id=question_id,
            )
        if should_open:
            to_open.append(question_id)

    # Open questions introduced by effects become explicit transitions.
    for effect in resolved_effects or []:
        if not isinstance(effect, dict) or str(effect.get("mode") or "").upper() == "HOLD":
            continue
        for question_id in _strings(effect.get("open_question_ids")):
            if question_id in questions and question_id not in active and question_id not in answered and question_id not in to_open:
                to_open.append(question_id)

    # Only active questions (including those opened this turn) may close.
    close_candidates = active | set(to_open)
    for question_id in sorted(close_candidates):
        if question_id in answered:
            continue
        question = questions.get(question_id)
        if question is None:
            continue
        closure = question.get("closes_when")
        if closure is None:
            continue
        if _conditions_satisfied(
            closure,
            discovered=discovered,
            flags=flags,
            visited=visited,
            answered=answered,
            payoff_questions=payoff_questions,
            explicit_ids=explicit_close,
            question_id=question_id,
        ):
            to_answer.append(question_id)

    return {
        "schema_version": 1,
        "open_question_ids": to_open,
        "answer_question_ids": to_answer,
        "findings": findings,
    }


def validate_question_lifecycle(
    graph: dict[str, Any] | None,
    *,
    clue_ids: set[str] | None = None,
    scene_ids: set[str] | None = None,
) -> list[dict[str, Any]]:
    """Shape- and reference-check authored open/close conditions."""
    graph = graph if isinstance(graph, dict) else {}
    question_ids = set(_question_map(graph))
    clue_ids = set(clue_ids or set())
    scene_ids = set(scene_ids or set())
    findings: list[dict[str, Any]] = []

    def inspect(raw: Any, path: str, valid_kinds: set[str]) -> None:
        if raw is None:
            return
        conditions = [raw] if isinstance(raw, dict) else raw if isinstance(raw, list) else []
        if not conditions:
            findings.append({
                "code": "invalid_question_closure",
                "severity": "error",
                "path": path,
                "message": "question lifecycle condition must be an object or non-empty list",
            })
            return
        for index, condition in enumerate(conditions):
            condition_path = f"{path}[{index}]" if isinstance(raw, list) else path
            if not isinstance(condition, dict):
                findings.append({
                    "code": "invalid_question_closure",
                    "severity": "error",
                    "path": condition_path,
                    "message": "question lifecycle condition must be an object",
                })
                continue
            kind = str(condition.get("kind") or "")
            if kind not in valid_kinds:
                findings.append({
                    "code": "invalid_question_closure",
                    "severity": "error",
                    "path": condition_path,
                    "message": f"unsupported question lifecycle kind {kind!r}",
                })
                continue
            for clue_id in _strings(condition.get("clue_ids")):
                if clue_ids and clue_id not in clue_ids:
                    findings.append({
                        "code": "broken_epistemic_reference",
                        "severity": "error",
                        "path": condition_path,
                        "message": f"question lifecycle clue {clue_id!r} does not resolve",
                    })
            scene_id = condition.get("scene_id")
            if kind == "scene_entered" and scene_ids and scene_id not in scene_ids:
                findings.append({
                    "code": "broken_epistemic_reference",
                    "severity": "error",
                    "path": condition_path,
                    "message": f"question lifecycle scene {scene_id!r} does not resolve",
                })
            target_question = condition.get("question_id")
            if kind == "question_answered" and target_question not in question_ids:
                findings.append({
                    "code": "broken_epistemic_reference",
                    "severity": "error",
                    "path": condition_path,
                    "message": f"question lifecycle question {target_question!r} does not resolve",
                })

    for index, question in enumerate(graph.get("questions") or []):
        if not isinstance(question, dict):
            continue
        inspect(
            question.get("opens_when"),
            f"epistemic_graph.questions[{index}].opens_when",
            set(VALID_OPEN_KINDS),
        )
        inspect(
            question.get("closes_when"),
            f"epistemic_graph.questions[{index}].closes_when",
            set(VALID_CLOSURE_KINDS),
        )
    return findings
