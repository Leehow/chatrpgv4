#!/usr/bin/env python3
"""Deterministic metrics for the player's evolving understanding.

Metrics consume structured belief/question events and confidence records. They
do not evaluate prose quality or infer whether natural-language text was
surprising.
"""
from __future__ import annotations

from typing import Any

_TREATMENT_TYPES = {
    "belief_confirmed": ("confirm", 1.0),
    "belief_expanded": ("expand", 1.25),
    "belief_complicated": ("complicate", 1.25),
    "belief_reframed": ("reframe", 2.0),
    "belief_payoff": ("payoff", 2.0),
}


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


def _event_type(event: dict[str, Any]) -> str:
    return str(event.get("event_type") or event.get("type") or "")


def _confidence(value: Any) -> float | None:
    try:
        return max(0.0, min(1.0, float(value)))
    except (TypeError, ValueError):
        return None


def _belief_gain(events: list[dict[str, Any]]) -> dict[str, Any]:
    by_mode = {mode: 0 for mode, _weight in _TREATMENT_TYPES.values()}
    weighted = 0.0
    count = 0
    for event in events:
        treatment = _TREATMENT_TYPES.get(_event_type(event))
        if treatment is None:
            continue
        mode, weight = treatment
        by_mode[mode] += 1
        count += 1
        weighted += weight
    return {
        "count": count,
        "weighted_score": round(weighted, 2),
        "by_mode": by_mode,
    }


def _curiosity_load(
    events: list[dict[str, Any]],
    belief_state: dict[str, Any] | None,
) -> dict[str, Any]:
    state = belief_state if isinstance(belief_state, dict) else {}
    answered = set(_strings(state.get("answered_question_ids")))
    active = [
        question_id
        for question_id in _strings(state.get("active_question_ids"))
        if question_id not in answered
    ]
    if not belief_state:
        opened: list[str] = []
        closed: set[str] = set()
        for event in events:
            event_type = _event_type(event)
            question_id = event.get("question_id")
            if not isinstance(question_id, str) or not question_id:
                continue
            if event_type == "question_opened" and question_id not in opened:
                opened.append(question_id)
            elif event_type == "question_answered":
                closed.add(question_id)
        active = [question_id for question_id in opened if question_id not in closed]
    active_count = len(active)
    if active_count == 0:
        load_state = "empty"
    elif active_count <= 4:
        load_state = "workable"
    else:
        load_state = "overloaded"
    return {
        "active_count": active_count,
        "active_question_ids": active,
        "state": load_state,
    }


def _explanation_compression(events: list[dict[str, Any]]) -> dict[str, Any]:
    records: list[dict[str, Any]] = []
    for event in events:
        if _event_type(event) not in {"belief_reframed", "belief_payoff"}:
            continue
        setup = set(_strings(event.get("setup_refs")))
        targets = set(_strings(event.get("explanation_targets")))
        unified = setup | targets
        records.append({
            "question_id": event.get("question_id"),
            "setup_count": len(setup),
            "explanation_target_count": len(targets),
            "items_unified": len(unified),
        })
    values = [record["items_unified"] for record in records]
    return {
        "event_count": len(records),
        "max_items_unified": max(values, default=0),
        "average_items_unified": round(sum(values) / len(values), 2) if values else 0.0,
        "records": records,
    }


def _reframe_fairness(events: list[dict[str, Any]]) -> dict[str, Any]:
    records: list[dict[str, Any]] = []
    for event in events:
        if _event_type(event) != "belief_reframed":
            continue
        required = set(_strings(event.get("setup_refs")))
        available_raw = event.get("available_setup_refs")
        if available_raw is None:
            # A committed runtime reframe can only be emitted after the policy's
            # setup gate. Older events therefore treat declared setup as available.
            available = set(required)
        else:
            available = set(_strings(available_raw))
        ratio = 1.0 if not required else len(required & available) / len(required)
        records.append({
            "question_id": event.get("question_id"),
            "required": sorted(required),
            "available": sorted(available),
            "ratio": round(ratio, 3),
        })
    ratios = [record["ratio"] for record in records]
    return {
        "reframe_count": len(records),
        "minimum_ratio": min(ratios, default=1.0),
        "average_ratio": round(sum(ratios) / len(ratios), 3) if ratios else 1.0,
        "unfair_count": sum(1 for ratio in ratios if ratio < 1.0),
        "records": records,
    }


def _confirmation_saturation(events: list[dict[str, Any]]) -> dict[str, Any]:
    longest = 0
    current_question: str | None = None
    current_run = 0
    by_question: dict[str, int] = {}
    for event in events:
        if _event_type(event) != "belief_confirmed":
            current_question = None
            current_run = 0
            continue
        question_id = str(event.get("question_id") or "unbound")
        if question_id == current_question:
            current_run += 1
        else:
            current_question = question_id
            current_run = 1
        longest = max(longest, current_run)
        by_question[question_id] = max(by_question.get(question_id, 0), current_run)
    return {
        "longest_run": longest,
        "by_question": by_question,
        "saturated_question_ids": sorted(
            question_id for question_id, run in by_question.items() if run >= 3
        ),
    }


def _unexplained_surprise(events: list[dict[str, Any]]) -> dict[str, Any]:
    findings: list[dict[str, Any]] = []
    for event in events:
        event_type = _event_type(event)
        if event_type not in {"belief_reframed", "belief_payoff"}:
            continue
        missing: list[str] = []
        if event_type == "belief_reframed":
            if not event.get("reveal_contract_id"):
                missing.append("reveal_contract_id")
            if not _strings(event.get("preserve_fact_refs")):
                missing.append("preserve_fact_refs")
            if not _strings(event.get("setup_refs")):
                missing.append("setup_refs")
        elif not event.get("effect_id") and not event.get("reveal_contract_id"):
            missing.append("compiled_effect_identity")
        if missing:
            findings.append({
                "code": "unexplained_surprise",
                "question_id": event.get("question_id"),
                "missing": missing,
            })
    return {"count": len(findings), "findings": findings}


def _parse_risk_exposure(
    events: list[dict[str, Any]],
    compile_confidence: dict[str, Any] | None,
    parse_manifest: dict[str, Any] | None,
) -> dict[str, Any]:
    findings: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for event in events:
        confidence = event.get("compile_confidence")
        if not isinstance(confidence, dict):
            continue
        ready = confidence.get("ready")
        value = _confidence(confidence.get("confidence"))
        threshold = _confidence(confidence.get("threshold")) or 0.8
        if ready is False or value is None or value < threshold:
            key = (str(event.get("question_id") or ""), "event_confidence")
            if key not in seen:
                seen.add(key)
                findings.append({
                    "code": "low_compile_confidence",
                    "question_id": event.get("question_id"),
                    "confidence": value,
                    "threshold": threshold,
                })
    document = compile_confidence if isinstance(compile_confidence, dict) else {}
    default_threshold = _confidence(document.get("default_threshold")) or 0.8
    for record in document.get("nodes") or []:
        if not isinstance(record, dict):
            continue
        importance = str(record.get("importance") or "")
        if importance and importance != "critical":
            continue
        semantic = _confidence(record.get("semantic_confidence"))
        source = _confidence(record.get("source_confidence"))
        effective = _confidence(record.get("effective_confidence"))
        values = [value for value in (semantic, source, effective) if value is not None]
        value = min(values) if values else None
        review_state = str(record.get("review_state") or "needs_review")
        if value is None or value < default_threshold or review_state not in {"auto_accepted", "manual_accepted"}:
            key = (str(record.get("node_id") or ""), "compiled_node")
            if key in seen:
                continue
            seen.add(key)
            findings.append({
                "code": "parse_risk_exposure",
                "node_type": record.get("node_type"),
                "node_id": record.get("node_id"),
                "confidence": value,
                "threshold": default_threshold,
                "review_state": review_state,
            })
    manifest = parse_manifest if isinstance(parse_manifest, dict) else {}
    for record in manifest.get("ranges") or []:
        if not isinstance(record, dict):
            continue
        review_state = str(record.get("review_state") or "needs_review")
        overall = _confidence((record.get("quality") or {}).get("overall"))
        threshold = _confidence(manifest.get("default_threshold")) or 0.8
        if review_state in {"needs_review", "rejected"} or overall is None or overall < threshold:
            key = (str(record.get("range_id") or ""), "parse_range")
            if key in seen:
                continue
            seen.add(key)
            findings.append({
                "code": "parse_range_risk",
                "range_id": record.get("range_id"),
                "confidence": overall,
                "threshold": threshold,
                "review_state": review_state,
            })
    return {"count": len(findings), "findings": findings}


def _health(
    belief_gain: dict[str, Any],
    curiosity: dict[str, Any],
    fairness: dict[str, Any],
    saturation: dict[str, Any],
    unexplained: dict[str, Any],
    parse_risk: dict[str, Any],
) -> dict[str, Any]:
    score = 100
    findings: list[dict[str, Any]] = []
    if belief_gain["count"] == 0:
        score -= 20
        findings.append({"code": "no_belief_gain", "severity": "warning"})
    if curiosity["state"] == "empty":
        score -= 10
        findings.append({"code": "curiosity_empty", "severity": "warning"})
    elif curiosity["state"] == "overloaded":
        score -= 10
        findings.append({"code": "curiosity_overload", "severity": "warning"})
    if fairness["unfair_count"]:
        score -= min(30, fairness["unfair_count"] * 15)
        findings.append({"code": "unfair_reframe", "severity": "error"})
    if saturation["longest_run"] >= 4:
        score -= min(15, (saturation["longest_run"] - 3) * 5)
        findings.append({"code": "confirmation_saturation", "severity": "warning"})
    if unexplained["count"]:
        score -= min(30, unexplained["count"] * 15)
        findings.append({"code": "unexplained_surprise", "severity": "error"})
    if parse_risk["count"]:
        score -= min(25, parse_risk["count"] * 5)
        findings.append({"code": "parse_risk_exposure", "severity": "warning"})
    score = max(0, min(100, score))
    grade = "healthy" if score >= 85 else "watch" if score >= 65 else "at_risk"
    return {"score": score, "grade": grade, "findings": findings}


def compute_epistemic_metrics(
    belief_events: list[dict[str, Any]] | None,
    belief_state: dict[str, Any] | None = None,
    compile_confidence: dict[str, Any] | None = None,
    parse_manifest: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Compute all seven blueprint metrics plus a compact health summary."""
    events = [event for event in (belief_events or []) if isinstance(event, dict)]
    belief_gain = _belief_gain(events)
    curiosity = _curiosity_load(events, belief_state)
    compression = _explanation_compression(events)
    fairness = _reframe_fairness(events)
    saturation = _confirmation_saturation(events)
    unexplained = _unexplained_surprise(events)
    parse_risk = _parse_risk_exposure(
        events, compile_confidence, parse_manifest
    )
    return {
        "schema_version": 1,
        "belief_gain": belief_gain,
        "curiosity_load": curiosity,
        "explanation_compression": compression,
        "reframe_fairness": fairness,
        "confirmation_saturation": saturation,
        "unexplained_surprise": unexplained,
        "parse_risk_exposure": parse_risk,
        "epistemic_health": _health(
            belief_gain,
            curiosity,
            fairness,
            saturation,
            unexplained,
            parse_risk,
        ),
    }
