#!/usr/bin/env python3
"""Persistent player-belief snapshot and append-only epistemic event reducer.

Beliefs describe the player's model and never mutate module truth. Bindings
are accepted only from structured evaluator/compiler output or authored
clue-to-conclusion relationships, never inferred from prose.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import re
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


def _read_json_object(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def _positive_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _opaque_conclusion_question_id(conclusion_id: str) -> str:
    digest = hashlib.sha256(conclusion_id.encode("utf-8")).hexdigest()[:16]
    return f"conclusion-ref:{digest}"


def _conclusion_projection(
    campaign_dir: Path,
    state: dict[str, Any],
    committed_clue_ids: list[str],
    explicitly_projected_clue_ids: list[str] | None = None,
) -> tuple[list[dict[str, Any]], dict[str, list[str]]]:
    """Project authored links when a clue has no semantic evidence link.

    This is deliberately narrower than semantic compilation.  It never reads a
    conclusion description or infers an effect from prose: a projection exists
    only for a newly committed clue nested under a structured conclusion with a
    stable ID, positive ``minimum_routes``, and source origin.  Explicit
    epistemic evidence links take precedence for their clue IDs.
    """
    committed = set(_ordered_strings(committed_clue_ids))
    if not committed:
        return [], {"open_question_ids": [], "answer_question_ids": []}

    scenario_dir = Path(campaign_dir) / "scenario"
    clue_graph = _read_json_object(scenario_dir / "clue-graph.json")
    epistemic_graph = _read_json_object(scenario_dir / "epistemic-graph.json")
    explicit_clues = set(_ordered_strings(explicitly_projected_clue_ids)) | {
        clue_id
        for link in epistemic_graph.get("evidence_links") or []
        if isinstance(link, dict)
        for clue_id in _ordered_strings(link.get("clue_id"))
        if link.get("question_id")
    }
    eligible_committed = committed - explicit_clues
    if not eligible_committed:
        return [], {"open_question_ids": [], "answer_question_ids": []}

    world = _read_json_object(Path(campaign_dir) / "save" / "world-state.json")
    discovered = set(_ordered_strings(world.get("discovered_clue_ids"))) | committed
    active = set(_ordered_strings(state.get("active_question_ids")))
    answered = set(_ordered_strings(state.get("answered_question_ids")))
    effects: list[dict[str, Any]] = []
    to_open: list[str] = []
    to_answer: list[str] = []

    for conclusion in clue_graph.get("conclusions") or []:
        if not isinstance(conclusion, dict):
            continue
        conclusion_id = str(conclusion.get("conclusion_id") or "").strip()
        minimum_routes = _positive_int(conclusion.get("minimum_routes"))
        source_origin = str(conclusion.get("origin") or "").strip()
        if not conclusion_id or minimum_routes is None or not source_origin:
            continue
        authored_clues = {
            clue_id: clue_origin
            for clue in conclusion.get("clues") or []
            if isinstance(clue, dict)
            for clue_origin in [str(clue.get("origin") or "").strip()]
            if clue_origin
            for clue_id in _ordered_strings(clue.get("clue_id"))
        }
        newly_supported = sorted(set(authored_clues) & eligible_committed)
        if not newly_supported:
            continue

        # Question IDs are surfaced by curiosity metrics in battle reports.
        # Keep the truth-bearing conclusion ID only on internal evidence events.
        question_id = _opaque_conclusion_question_id(conclusion_id)
        for clue_id in newly_supported:
            effects.append({
                "effect_id": f"clue-graph:{conclusion_id}:{clue_id}:expand",
                "mode": "EXPAND",
                "target_question_id": question_id,
                "deliver_clue_ids": [clue_id],
                "conclusion_id": conclusion_id,
                "minimum_routes": minimum_routes,
                "projection_source": "clue_graph_conclusion_link",
                "source_origin": authored_clues[clue_id],
                "conclusion_origin": source_origin,
            })

        support_count = len(set(authored_clues) & discovered)
        if question_id not in active and question_id not in answered:
            to_open.append(question_id)
        if support_count >= minimum_routes and question_id not in answered:
            to_answer.append(question_id)

    return effects, {
        "open_question_ids": _ordered_strings(to_open),
        "answer_question_ids": _ordered_strings(to_answer),
    }


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
    for key in (
        "conclusion_id",
        "minimum_routes",
        "projection_source",
        "source_origin",
        "conclusion_origin",
    ):
        if effect.get(key) is not None:
            event[key] = effect[key]
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


# --- Canonical event wiring (coc-events-1, plan task t4) -------------------
#
# After the authoritative belief snapshot write and legacy belief-events.jsonl
# appends succeed, mirror the settled epistemic facts into the canonical event
# stream: ``belief-asserted`` (assert/repeat) and ``belief-reframed``
# (REFRAME treatment rows). Derived evidence only — never replayed back into
# authority, and any emission failure is swallowed so play cannot break here.

_SEMANTIC_ID_FULL_RE = re.compile(r"[a-z0-9][a-z0-9._:-]*(?:-[a-z0-9][a-z0-9._:-]*)+")


def _canonical_ref_token(value: Any) -> str | None:
    """Normalize one identity into a canonical-event ``ref``/token."""
    text = re.sub(r"[^a-z0-9.-]+", "-", str(value or "").strip().lower())
    text = re.sub(r"^[^a-z0-9]+", "", text)
    text = text.rstrip("-.")
    return text[:128] or None


def _canonical_text_field(value: Any) -> str | None:
    text = str(value or "").strip()
    return text[:400] or None


def _canonical_id_refs(values: Any, *, limit: int = 16) -> list[str]:
    out: list[str] = []
    if not isinstance(values, (list, tuple)):
        return out
    for value in values:
        text = str(value or "").strip().lower()
        if text and _SEMANTIC_ID_FULL_RE.fullmatch(text) and text not in out:
            out.append(text)
            if len(out) >= limit:
                break
    return out


def _canonical_campaign_slug(campaign_dir: Path) -> str | None:
    return _canonical_ref_token(Path(campaign_dir).name)


def _belief_active_timeline(campaign_dir: Path) -> str:
    try:
        payload = json.loads(
            (Path(campaign_dir) / "save" / "timeline-state.json")
            .read_text(encoding="utf-8")
        )
        raw = payload.get("active_timeline_id") if isinstance(payload, dict) else None
    except (OSError, UnicodeError, json.JSONDecodeError):
        raw = None
    token = _canonical_ref_token(raw)
    return token or "tl-main"


def _emit_canonical_with_collision_retry(call) -> None:
    """Run one emit attempt; on same-turn event-id collision, retry a few
    ``-N`` slug suffixes. Other failures stop silently: idempotent replays and
    contract conflicts are evidence-layer outcomes, never gameplay errors."""
    for suffix in ("", "-2", "-3", "-4"):
        try:
            call(suffix)
            return
        except Exception:
            continue


def _emit_belief_canonical_events(
    campaign_dir: Path,
    *,
    decision_id: str,
    turn_number: int,
    investigator_id: str,
    claim: Any,
    belief_events: list[dict[str, Any]],
    state: dict[str, Any],
) -> None:
    import coc_canonical_events as cem

    decision = _canonical_ref_token(decision_id)
    holder = _canonical_ref_token(investigator_id)
    campaign = _canonical_campaign_slug(campaign_dir)
    if decision is None or campaign is None:
        return
    timeline = _belief_active_timeline(campaign_dir)
    try:
        turn = max(1, int(turn_number))
    except (TypeError, ValueError):
        turn = 1
    logs_dir = Path(campaign_dir) / "logs"
    game_time = f"turn-{turn}"

    def _state_hypothesis(raw_id: Any) -> dict[str, Any] | None:
        wanted = str(raw_id or "")
        return next(
            (
                record for record in state.get("hypotheses", [])
                if isinstance(record, dict)
                and str(record.get("hypothesis_id") or "") == wanted
            ),
            None,
        )

    for event in belief_events:
        legacy_type = event.get("event_type")
        if legacy_type in ("hypothesis_asserted", "hypothesis_repeated"):
            hyp = _canonical_ref_token(event.get("hypothesis_id"))
            if holder is None or hyp is None:
                continue
            data: dict[str, Any] = {
                "_v": 1,
                "hypothesis_id": hyp,
                "holder": holder,
                "mode": (
                    "asserted"
                    if legacy_type == "hypothesis_asserted"
                    else "repeated"
                ),
            }
            statement = _canonical_text_field(claim)
            if statement:
                data["statement"] = statement
            state_hyp = _state_hypothesis(event.get("hypothesis_id"))
            refs = _canonical_id_refs(
                [
                    *state_hyp.get("supporting_clue_ids", []),
                    *state_hyp.get("challenging_clue_ids", []),
                ]
            ) if isinstance(state_hyp, dict) else []
            if refs:
                data["evidence_refs"] = refs
            _emit_canonical_with_collision_retry(
                lambda suffix, _data=data, _hyp=hyp: cem.emit(
                    campaign_logs_dir=logs_dir,
                    event_type="belief-asserted",
                    campaign=campaign,
                    timeline=timeline,
                    turn=turn,
                    slug=f"{_hyp[:110]}{suffix}",
                    source="coc_belief_state.apply_belief_turn",
                    game_time=game_time,
                    privacy="public",
                    decision_id=f"{decision}:belief-assert:{_hyp}",
                    data=_data,
                )
            )
        elif legacy_type == "belief_reframed":
            clues = _canonical_id_refs(event.get("clue_ids"))
            change = _canonical_text_field(
                "REFRAME 处理成立，关联线索："
                + (",".join(clues) if clues else "无")
            )
            for target in (event.get("belief_refs") or []):
                target_token = _canonical_ref_token(target)
                if target_token is None:
                    continue
                reframe_data: dict[str, Any] = {
                    "_v": 1,
                    "hypothesis_id": target_token,
                    "change": change,
                }
                if holder is not None:
                    reframe_data["holder"] = holder
                if clues:
                    reframe_data["evidence_refs"] = clues
                _emit_canonical_with_collision_retry(
                    lambda suffix, _data=dict(reframe_data), _t=target_token: cem.emit(
                        campaign_logs_dir=logs_dir,
                        event_type="belief-reframed",
                        campaign=campaign,
                        timeline=timeline,
                        turn=turn,
                        slug=f"{_t[:96]}-reframe{suffix}",
                        source="coc_belief_state.apply_belief_turn",
                        game_time=game_time,
                        privacy="public",
                        decision_id=f"{decision}:belief-reframe:{_t}",
                        data=_data,
                    )
                )


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
    explicitly_projected_clues: list[str] = []
    if isinstance(contract, dict):
        for effect in _contract_effects(contract):
            if str(effect.get("mode") or "NONE").upper() not in {"NONE", "HOLD"}:
                explicitly_projected_clues.extend(
                    _ordered_strings(effect.get("deliver_clue_ids"))
                )
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

    projected_effects, projected_transitions = _conclusion_projection(
        campaign_dir,
        state,
        committed_clue_ids,
        explicitly_projected_clues,
    )
    for effect in projected_effects:
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

    merged_transitions = dict(question_transitions or {})
    merged_transitions["open_question_ids"] = _ordered_strings([
        *merged_transitions.get("open_question_ids", []),
        *open_from_effects,
        *projected_transitions["open_question_ids"],
    ])
    merged_transitions["answer_question_ids"] = _ordered_strings([
        *merged_transitions.get("answer_question_ids", []),
        *payoff_questions,
        *projected_transitions["answer_question_ids"],
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
        _emit_belief_canonical_events(
            campaign_dir,
            decision_id=decision_id,
            turn_number=turn_number,
            investigator_id=investigator_id,
            claim=candidate.get("claim") if candidate else None,
            belief_events=events,
            state=state,
        )
    return events


# --- Main-line objective progress -------------------------------------------
#
# A conclusion in clue-graph.json is an objective: something the investigators
# are meant to work out, with `minimum_routes` independent clues as the bar and
# `importance` saying whether the story turns on it. That is the quest-objective
# model video games use for main-line progression, and the whole of it is
# already extracted and already validated.
#
# It was computed and then went nowhere. `answered_question_ids` circulates
# inside the epistemic subsystem — metrics, lifecycle, policy — and reaches
# neither the Keeper's scene projection nor the Story Director's transition
# scoring. So the engine knew whether the main line had advanced and never said
# so, and the only automatic pacing pressure left was "play has stalled".
#
# This is deliberately a progress report and never a gate. Games gate a chapter
# on its main quest, not every door on the way, and the Keeper is not blocked by
# anything here: they read where the story stands and decide.

_OBJECTIVE_IMPORTANCE_ORDER = {"core": 0, "supporting": 1, "optional": 2}


def core_objective_progress(
    clue_graph: dict[str, Any] | None,
    discovered_clue_ids: Any,
) -> dict[str, Any]:
    """Report each authored objective against the clues actually discovered.

    Pure: reads no files and holds no state, so the toolbox and the director can
    both call it on whatever they already have in hand.
    """
    discovered = set(_ordered_strings(discovered_clue_ids))
    objectives: list[dict[str, Any]] = []
    for conclusion in (clue_graph or {}).get("conclusions") or []:
        if not isinstance(conclusion, dict):
            continue
        conclusion_id = str(conclusion.get("conclusion_id") or "").strip()
        if not conclusion_id:
            continue
        clue_ids = [
            clue_id
            for clue in conclusion.get("clues") or []
            if isinstance(clue, dict)
            for clue_id in _ordered_strings(clue.get("clue_id"))
        ]
        # What the module prints, kept honest by the extraction contract: this
        # is how many independent routes the book actually provides.
        printed = _positive_int(conclusion.get("minimum_routes")) or 1
        available = len(set(clue_ids))
        # What this engine calls "worked out", which is a play decision and not
        # a fact about the book. A majority of the routes the module offers.
        #
        # Reading the printed number as the bar made 126 of the library's 132
        # core objectives all-or-nothing — the threshold equalled the clue count,
        # so one failed roll locked the main line as unreachable for the rest of
        # the session. Observed: a nine-route conclusion stalled at 8/9 on a
        # failed Psychology check and a failed push, with no other route left to
        # try, and `main_line_complete` could never become true again.
        required = max(1, -(-min(printed, available) * 2 // 3)) if available else printed
        found = sorted(set(clue_ids) & discovered)
        objectives.append({
            "conclusion_id": conclusion_id,
            "importance": str(conclusion.get("importance") or "supporting"),
            "description": conclusion.get("description"),
            "routes_required": required,
            "routes_printed": printed,
            "routes_found": len(found),
            # Capped: a scenario whose remaining clues cannot reach the bar is
            # short of routes, not short of play, and `fallback_policy` is the
            # author's answer to that.
            "routes_outstanding": max(0, required - len(found)),
            "answered": len(found) >= required,
            "available_routes": len(clue_ids),
            "fallback_policy": conclusion.get("fallback_policy"),
        })
    objectives.sort(key=lambda row: (
        _OBJECTIVE_IMPORTANCE_ORDER.get(row["importance"], 3),
        row["conclusion_id"],
    ))
    core = [row for row in objectives if row["importance"] == "core"]
    core_answered = [row for row in core if row["answered"]]
    return {
        "schema_version": 1,
        "keeper_only": True,
        "authority": "advisory",
        "objectives": objectives,
        "core_total": len(core),
        "core_answered": len(core_answered),
        "main_line_complete": bool(core) and len(core_answered) == len(core),
    }
