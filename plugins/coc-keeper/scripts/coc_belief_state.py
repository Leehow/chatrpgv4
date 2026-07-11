#!/usr/bin/env python3
"""Persistent player-belief snapshot and append-only epistemic event reducer.

The module records what the player appears to believe; it never promotes a
hypothesis into module truth. Meaning-bearing bindings (question_id and
hypothesis_kind) must be supplied by a semantic evaluator or compiled data.
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
SCHEMA_VERSION = 1
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


def normalize_belief_state(payload: dict[str, Any] | None) -> dict[str, Any]:
    state = dict(payload or {})
    state["schema_version"] = SCHEMA_VERSION
    if not isinstance(state.get("hypotheses"), list):
        state["hypotheses"] = []
    else:
        state["hypotheses"] = [
            item for item in state["hypotheses"] if isinstance(item, dict)
        ]
    for key in ("active_question_ids", "answered_question_ids"):
        values = state.get(key)
        if not isinstance(values, list):
            values = []
        state[key] = _ordered_strings(values)
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
    path = Path(campaign_dir) / "save" / "belief-state.json"
    coc_fileio.write_json_atomic(
        path,
        normalize_belief_state(state),
        indent=2,
        ensure_ascii=False,
        trailing_newline=True,
    )


def _append_jsonl(path: Path, record: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False) + "\n")


def _ordered_strings(values: Any) -> list[str]:
    if values is None:
        source: list[Any] = []
    elif isinstance(values, (list, tuple, set)):
        source = list(values)
    else:
        source = [values]
    seen: set[str] = set()
    result: list[str] = []
    for value in source:
        if not isinstance(value, str):
            continue
        text = value.strip()
        if not text or text in seen:
            continue
        seen.add(text)
        result.append(text)
    return result


def _treatment_history(values: Any, treatment: str, limit: int = 8) -> list[str]:
    """Keep recent treatments in order, including repeated confirmations."""
    source = values if isinstance(values, list) else []
    history = [
        str(value).strip().lower()
        for value in source
        if isinstance(value, str) and str(value).strip()
    ]
    history.append(treatment)
    return history[-limit:]


def _bounded_confidence(value: Any, default: float = 0.5) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        parsed = default
    return round(max(0.0, min(1.0, parsed)), 3)


def _next_hypothesis_id(state: dict[str, Any]) -> str:
    highest = 0
    for hypothesis in state.get("hypotheses", []):
        raw = str(hypothesis.get("hypothesis_id") or "")
        if raw.startswith("hyp-"):
            try:
                highest = max(highest, int(raw.split("-", 1)[1]))
            except ValueError:
                continue
    return f"hyp-{highest + 1:06d}"


def _candidate_from_plan(plan: dict[str, Any]) -> dict[str, Any] | None:
    turn_input = plan.get("turn_input") or {}
    rich = turn_input.get("player_intent_rich") or {}
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
    if not isinstance(question_id, str) or not question_id.strip():
        question_id = None
    else:
        question_id = question_id.strip()
    hypothesis_kind = raw.get("hypothesis_kind")
    if not isinstance(hypothesis_kind, str) or not hypothesis_kind.strip():
        hypothesis_kind = None
    else:
        hypothesis_kind = hypothesis_kind.strip()
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
    existing = next(
        (
            hypothesis
            for hypothesis in state.get("hypotheses", [])
            if _same_hypothesis(hypothesis, candidate)
        ),
        None,
    )
    if existing is None:
        existing = {
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
        state["hypotheses"].append(existing)
        event_type = "hypothesis_asserted"
    else:
        existing["claim"] = candidate["claim"]
        existing["confidence"] = candidate["confidence"]
        if candidate.get("question_id") is not None:
            existing["question_id"] = candidate.get("question_id")
        if candidate.get("hypothesis_kind") is not None:
            existing["hypothesis_kind"] = candidate.get("hypothesis_kind")
        existing["updated_turn"] = turn_number
        event_type = "hypothesis_repeated"

    event = {
        "schema_version": SCHEMA_VERSION,
        "event_type": event_type,
        "decision_id": decision_id,
        "turn_number": turn_number,
        "investigator_id": investigator_id,
        "hypothesis_id": existing["hypothesis_id"],
        "question_id": existing.get("question_id"),
        "hypothesis_kind": existing.get("hypothesis_kind"),
        "confidence": existing.get("confidence"),
        "ts": ts,
    }
    return existing, event


def _targets_for_contract(
    state: dict[str, Any],
    contract: dict[str, Any],
    *,
    newly_asserted_id: str | None = None,
) -> list[dict[str, Any]]:
    mode = str(contract.get("mode") or "NONE").upper()
    if mode == "REFRAME" and _ordered_strings(contract.get("revise_hypothesis_refs")):
        refs = set(_ordered_strings(contract.get("revise_hypothesis_refs")))
    else:
        refs = set(_ordered_strings(contract.get("belief_refs")))

    question_id = contract.get("target_question_id")
    if newly_asserted_id and mode != "REFRAME":
        new_record = next(
            (
                hypothesis
                for hypothesis in state.get("hypotheses", [])
                if hypothesis.get("hypothesis_id") == newly_asserted_id
            ),
            None,
        )
        if isinstance(new_record, dict) and new_record.get("question_id") == question_id:
            refs.add(newly_asserted_id)

    if refs:
        return [
            hypothesis
            for hypothesis in state.get("hypotheses", [])
            if hypothesis.get("hypothesis_id") in refs
        ]
    if question_id:
        return [
            hypothesis
            for hypothesis in state.get("hypotheses", [])
            if hypothesis.get("question_id") == question_id
            and str(hypothesis.get("status") or "active") not in {"abandoned", "retired"}
        ]
    return []


def _apply_treatment(
    state: dict[str, Any],
    contract: dict[str, Any],
    committed_clue_ids: list[str],
    *,
    decision_id: str,
    turn_number: int,
    investigator_id: str,
    ts: str,
    newly_asserted_id: str | None = None,
) -> list[dict[str, Any]]:
    mode = str(contract.get("mode") or "NONE").upper()
    event_type = _TREATMENT_EVENT.get(mode)
    if event_type is None:
        return []
    planned = set(_ordered_strings(contract.get("deliver_clue_ids")))
    committed = [clue for clue in _ordered_strings(committed_clue_ids) if clue in planned]
    if not committed:
        return []

    targets = _targets_for_contract(
        state,
        contract,
        newly_asserted_id=newly_asserted_id,
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

    events: list[dict[str, Any]] = [{
        "schema_version": SCHEMA_VERSION,
        "event_type": event_type,
        "decision_id": decision_id,
        "turn_number": turn_number,
        "investigator_id": investigator_id,
        "question_id": contract.get("target_question_id"),
        "belief_refs": [
            hypothesis.get("hypothesis_id") for hypothesis in targets if hypothesis.get("hypothesis_id")
        ],
        "clue_ids": committed,
        "mode": mode,
        "preserve_fact_refs": _ordered_strings(contract.get("preserve_fact_refs")),
        "ts": ts,
    }]

    active = _ordered_strings(state.get("active_question_ids"))
    answered = _ordered_strings(state.get("answered_question_ids"))
    target_question = contract.get("target_question_id")
    if mode == "PAYOFF" and isinstance(target_question, str) and target_question:
        answered = _ordered_strings([*answered, target_question])
        active = [question for question in active if question != target_question]
        events.append({
            "schema_version": SCHEMA_VERSION,
            "event_type": "question_answered",
            "decision_id": decision_id,
            "turn_number": turn_number,
            "investigator_id": investigator_id,
            "question_id": target_question,
            "ts": ts,
        })

    for question_id in _ordered_strings(contract.get("open_question_ids")):
        if question_id in answered or question_id in active:
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

    state["active_question_ids"] = active
    state["answered_question_ids"] = answered
    return events


def apply_belief_turn(
    campaign_dir: Path,
    plan: dict[str, Any],
    committed_clue_ids: list[str],
    investigator_id: str,
    ts: str,
) -> list[dict[str, Any]]:
    """Reduce one resolved turn into belief snapshot + append-only events."""
    campaign_dir = Path(campaign_dir)
    state = read_belief_state(campaign_dir)
    decision_id = str(plan.get("decision_id") or "unknown")
    turn_input = plan.get("turn_input") or {}
    try:
        turn_number = int(turn_input.get("turn_number", 0) or 0)
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
    if isinstance(contract, dict):
        events.extend(
            _apply_treatment(
                state,
                contract,
                committed_clue_ids,
                decision_id=decision_id,
                turn_number=turn_number,
                investigator_id=investigator_id,
                ts=ts,
                newly_asserted_id=newly_asserted_id,
            )
        )

    if events:
        _write_state(campaign_dir, state)
        path = campaign_dir / "logs" / "belief-events.jsonl"
        for event in events:
            _append_jsonl(path, event)
    return events
