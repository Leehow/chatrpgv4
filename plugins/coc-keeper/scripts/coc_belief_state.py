#!/usr/bin/env python3
"""Persistent player-belief snapshot and append-only epistemic event reducer.

Beliefs describe the player's model and never mutate module truth. Semantic
bindings are accepted only from structured evaluator/compiler output.
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
SCHEMA_VERSION = 2
_TREATMENT_EVENT = {
    "CONFIRM": "belief_confirmed",
    "EXPAND": "belief_expanded",
    "COMPLICATE": "belief_complicated",
    "REFRAME": "belief_reframed",
    "PAYOFF": "belief_payoff",
}
_STATUS_FOR_MODE = {
    "CONFIRM": "confirmed",
    "EXPAND": "expanded",
    "COMPLICATE": "complicated",
    "REFRAME": "reframed",
    "PAYOFF": "answered",
}


def _load_sibling(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPT_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_fileio = _load_sibling("coc_fileio_belief", "coc_fileio.py")


def _ordered_strings(values: Any) -> list[str]:
    if values is None:
        source: list[Any] = []
    elif isinstance(values, (list, tuple, set)):
        source = list(values)
    else:
        source = [values]
    result: list[str] = []
    seen: set[str] = set()
    for value in source:
        if not isinstance(value, str):
            continue
        text = value.strip()
        if text and text not in seen:
            seen.add(text)
            result.append(text)
    return result


def normalize_belief_state(payload: dict[str, Any] | None) -> dict[str, Any]:
    state = dict(payload or {})
    state["schema_version"] = SCHEMA_VERSION
    hypotheses = state.get("hypotheses")
    state["hypotheses"] = [
        item for item in hypotheses if isinstance(item, dict)
    ] if isinstance(hypotheses, list) else []
    for key in (
        "active_question_ids",
        "answered_question_ids",
        "applied_effect_ids",
    ):
        state[key] = _ordered_strings(state.get(key))
    return state


def read_belief_state(campaign_dir: Path) -> dict[str, Any]:
    path = Path(campaign_dir) / "save" / "belief-state.json"
    if not path.exists():
        return normalize_belief_state(None)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        payload = {}
    return normalize_belief_state(payload if isinstance(payload, dict) else {})


def _write_state(campaign_dir: Path, state: dict[str, Any]) -> None:
    coc_fileio.write_json_atomic(
        Path(campaign_dir) / "save" / "belief-state.json",
        normalize_belief_state(state),
        indent=2,
        ensure_ascii=False,
        trailing_newline=True,
    )


def _append_jsonl(path: Path, record: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False) + "\n")


def _bounded_confidence(value: Any, default: float = 0.5) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        parsed = default
    return round(max(0.0, min(1.0, parsed)), 3)


def _treatment_history(values: Any, treatment: str, limit: int = 8) -> list[str]:
    history = [
        str(value).strip().lower()
        for value in (values if isinstance(values, list) else [])
        if isinstance(value, str) and str(value).strip()
    ]
    history.append(treatment)
    return history[-limit:]


def _next_hypothesis_id(state: dict[str, Any]) -> str:
    highest = 0
    for hypothesis in state.get("hypotheses", []):
        raw = str(hypothesis.get("hypothesis_id") or "")
        if not raw.startswith("hyp-"):
            continue
        try:
            highest = max(highest, int(raw.split("-", 1)[1]))
        except ValueError:
            continue
    return f"hyp-{highest + 1:06d}"


def _candidate_from_plan(plan: dict[str, Any]) -> dict[str, Any] | None:
    rich = ((plan.get("turn_input") or {}).get("player_intent_rich") or {})
    if not isinstance(rich, dict):
        return None
    raw = rich.get("belief_candidate")
    if raw is None:
        raw = rich.get("player_hypothesis")
    if isinstance(raw, str):
        claim = raw.strip()
        if not claim:
            return None
        return {
            "claim": claim,
            "question_id": None,
            "hypothesis_kind": None,
            "confidence": 0.5,
        }
    if not isinstance(raw, dict):
        return None
    claim = str(raw.get("claim") or "").strip()
    if not claim:
        return None
    question_id = raw.get("question_id")
    question_id = question_id.strip() if isinstance(question_id, str) and question_id.strip() else None
    hypothesis_kind = raw.get("hypothesis_kind")
    hypothesis_kind = hypothesis_kind.strip() if isinstance(hypothesis_kind, str) and hypothesis_kind.strip() else None
    return {
        "claim": claim,
        "question_id": question_id,
        "hypothesis_kind": hypothesis_kind,
        "confidence": _bounded_confidence(raw.get("confidence"), 0.5),
    }


def _same_hypothesis(record: dict[str, Any], candidate: dict[str, Any]) -> bool:
    if candidate.get("question_id") and candidate.get("hypothesis_kind"):
        return (
            record.get("question_id") == candidate.get("question_id")
            and record.get("hypothesis_kind") == candidate.get("hypothesis_kind")
        )
    return str(record.get("claim") or "").strip() == candidate.get("claim")


def _assert_hypothesis(
    state: dict[str, Any],
    candidate: dict[str, Any],
    *,
    decision_id: str,
    turn_number: int,
    investigator_id: str,
    ts: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    record = next(
        (
            hypothesis
            for hypothesis in state.get("hypotheses", [])
            if _same_hypothesis(hypothesis, candidate)
        ),
        None,
    )
    if record is None:
        record = {
            "hypothesis_id": _next_hypothesis_id(state),
            "owner": "party",
            "question_id": candidate.get("question_id"),
            "hypothesis_kind": candidate.get("hypothesis_kind"),
            "claim": candidate["claim"],
            "confidence": candidate["confidence"],
            "status": "active",
            "supporting_clue_ids": [],
            "challenging_clue_ids": [],
            "recent_treatments": [],
            "created_turn": turn_number,
            "updated_turn": turn_number,
        }
        state["hypotheses"].append(record)
        event_type = "hypothesis_asserted"
    else:
        record["claim"] = candidate["claim"]
        record["confidence"] = candidate["confidence"]
        if candidate.get("question_id") is not None:
            record["question_id"] = candidate["question_id"]
        if candidate.get("hypothesis_kind") is not None:
            record["hypothesis_kind"] = candidate["hypothesis_kind"]
        record["updated_turn"] = turn_number
        event_type = "hypothesis_repeated"
    return record, {
        "schema_version": SCHEMA_VERSION,
        "event_type": event_type,
        "decision_id": decision_id,
        "turn_number": turn_number,
        "investigator_id": investigator_id,
        "hypothesis_id": record["hypothesis_id"],
        "question_id": record.get("question_id"),
        "hypothesis_kind": record.get("hypothesis_kind"),
        "confidence": record.get("confidence"),
        "ts": ts,
    }


def _contract_effects(contract: dict[str, Any]) -> list[dict[str, Any]]:
    effects = contract.get("resolved_effects")
    if not isinstance(effects, list):
        effects = contract.get("effects")
    if isinstance(effects, list):
        return [effect for effect in effects if isinstance(effect, dict)]
    return [contract]


def _targets_for_effect(
    state: dict[str, Any],
    effect: dict[str, Any],
    *,
    newly_asserted_id: str | None,
) -> list[dict[str, Any]]:
    mode = str(effect.get("mode") or "NONE").upper()
    if mode == "REFRAME" and _ordered_strings(effect.get("revise_hypothesis_refs")):
        refs = set(_ordered_strings(effect.get("revise_hypothesis_refs")))
    else:
        refs = set(_ordered_strings(effect.get("belief_refs")))
    question_id = effect.get("target_question_id")
    if newly_asserted_id and mode != "REFRAME":
        newly = next(
            (record for record in state.get("hypotheses", []) if record.get("hypothesis_id") == newly_asserted_id),
            None,
        )
        if isinstance(newly, dict) and newly.get("question_id") == question_id:
            refs.add(newly_asserted_id)
    if refs:
        return [
            record for record in state.get("hypotheses", [])
            if record.get("hypothesis_id") in refs
        ]
    if question_id:
        return [
            record for record in state.get("hypotheses", [])
            if record.get("question_id") == question_id
            and str(record.get("status") or "active") not in {"abandoned", "retired"}
        ]
    return []


def _apply_effect(
    state: dict[str, Any],
    effect: dict[str, Any],
    committed_clue_ids: list[str],
    *,
    decision_id: str,
    turn_number: int,
    investigator_id: str,
    ts: str,
    newly_asserted_id: str | None,
) -> list[dict[str, Any]]:
    mode = str(effect.get("mode") or "NONE").upper()
    event_type = _TREATMENT_EVENT.get(mode)
    if event_type is None:
        return []
    planned = set(_ordered_strings(effect.get("deliver_clue_ids")))
    committed = [clue for clue in _ordered_strings(committed_clue_ids) if clue in planned]
    if not committed:
        return []
    effect_id = str(effect.get("effect_id") or "").strip()
    applied = set(_ordered_strings(state.get("applied_effect_ids")))
    if effect_id and effect_id in applied:
        return []

    targets = _targets_for_effect(
        state, effect, newly_asserted_id=newly_asserted_id
    )
    treatment = mode.lower()
    for hypothesis in targets:
        support = _ordered_strings(hypothesis.get("supporting_clue_ids"))
        challenge = _ordered_strings(hypothesis.get("challenging_clue_ids"))
        if mode in {"CONFIRM", "EXPAND", "PAYOFF"}:
            support = _ordered_strings([*support, *committed])
        else:
            challenge = _ordered_strings([*challenge, *committed])
        hypothesis["supporting_clue_ids"] = support
        hypothesis["challenging_clue_ids"] = challenge
        hypothesis["recent_treatments"] = _treatment_history(
            hypothesis.get("recent_treatments"), treatment
        )
        hypothesis["updated_turn"] = turn_number
        hypothesis["status"] = _STATUS_FOR_MODE[mode]

    if effect_id:
        state["applied_effect_ids"] = _ordered_strings([
            *state.get("applied_effect_ids", []), effect_id
        ])

    event = {
        "schema_version": SCHEMA_VERSION,
        "event_type": event_type,
        "decision_id": decision_id,
        "turn_number": turn_number,
        "investigator_id": investigator_id,
        "effect_id": effect_id or None,
        "question_id": effect.get("target_question_id"),
        "target_layer": effect.get("target_layer"),
        "belief_refs": [
            target.get("hypothesis_id") for target in targets if target.get("hypothesis_id")
        ],
        "clue_ids": committed,
        "mode": mode,
        "preserve_fact_refs": _ordered_strings(effect.get("preserve_fact_refs")),
        "setup_refs": _ordered_strings(effect.get("setup_refs")),
        "explanation_targets": _ordered_strings(effect.get("explanation_targets")),
        "reveal_contract_id": effect.get("reveal_contract_id"),
        "compile_confidence": effect.get("compile_confidence"),
        "ts": ts,
    }
    return [event]


def _apply_question_transitions(
    state: dict[str, Any],
    transitions: dict[str, Any] | None,
    *,
    decision_id: str,
    turn_number: int,
    investigator_id: str,
    ts: str,
) -> list[dict[str, Any]]:
    transitions = transitions if isinstance(transitions, dict) else {}
    active = _ordered_strings(state.get("active_question_ids"))
    answered = _ordered_strings(state.get("answered_question_ids"))
    events: list[dict[str, Any]] = []
    for question_id in _ordered_strings(transitions.get("open_question_ids")):
        if question_id in active or question_id in answered:
            continue
        active.append(question_id)
        events.append({
            "schema_version": SCHEMA_VERSION,
            "event_type": "question_opened",
            "decision_id": decision_id,
            "turn_number": turn_number,
            "investigator_id": investigator_id,
            "question_id": question_id,
            "ts": ts,
        })
    for question_id in _ordered_strings(transitions.get("answer_question_ids")):
        if question_id in answered:
            continue
        answered.append(question_id)
        active = [value for value in active if value != question_id]
        events.append({
            "schema_version": SCHEMA_VERSION,
            "event_type": "question_answered",
            "decision_id": decision_id,
            "turn_number": turn_number,
            "investigator_id": investigator_id,
            "question_id": question_id,
            "ts": ts,
        })
    state["active_question_ids"] = active
    state["answered_question_ids"] = answered
    return events


def apply_belief_turn(
    campaign_dir: Path,
    plan: dict[str, Any],
    committed_clue_ids: list[str],
    investigator_id: str,
    ts: str,
    *,
    question_transitions: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Reduce one resolved turn into belief snapshot and append-only events."""
    campaign_dir = Path(campaign_dir)
    state = read_belief_state(campaign_dir)
    decision_id = str(plan.get("decision_id") or "unknown")
    try:
        turn_number = int(((plan.get("turn_input") or {}).get("turn_number", 0)) or 0)
    except (TypeError, ValueError):
        turn_number = 0

    events: list[dict[str, Any]] = []
    newly_asserted_id: str | None = None
    candidate = _candidate_from_plan(plan)
    if candidate is not None:
        record, event = _assert_hypothesis(
            state,
            candidate,
            decision_id=decision_id,
            turn_number=turn_number,
            investigator_id=investigator_id,
            ts=ts,
        )
        newly_asserted_id = record.get("hypothesis_id")
        events.append(event)

    contract = plan.get("epistemic_contract")
    open_from_effects: list[str] = []
    payoff_questions: list[str] = []
    if isinstance(contract, dict):
        for effect in _contract_effects(contract):
            before = len(events)
            events.extend(_apply_effect(
                state,
                effect,
                committed_clue_ids,
                decision_id=decision_id,
                turn_number=turn_number,
                investigator_id=investigator_id,
                ts=ts,
                newly_asserted_id=newly_asserted_id,
            ))
            if len(events) > before:
                open_from_effects.extend(_ordered_strings(effect.get("open_question_ids")))
                if str(effect.get("mode") or "").upper() == "PAYOFF" and effect.get("target_question_id"):
                    payoff_questions.append(str(effect["target_question_id"]))

    merged_transitions = dict(question_transitions or {})
    merged_transitions["open_question_ids"] = _ordered_strings([
        *merged_transitions.get("open_question_ids", []), *open_from_effects
    ])
    merged_transitions["answer_question_ids"] = _ordered_strings([
        *merged_transitions.get("answer_question_ids", []), *payoff_questions
    ])
    events.extend(_apply_question_transitions(
        state,
        merged_transitions,
        decision_id=decision_id,
        turn_number=turn_number,
        investigator_id=investigator_id,
        ts=ts,
    ))

    if events:
        _write_state(campaign_dir, state)
        path = campaign_dir / "logs" / "belief-events.jsonl"
        for event in events:
            _append_jsonl(path, event)
    return events
