#!/usr/bin/env python3
"""Scope parse-risk metrics to effects that actually reached the player."""
from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "plugins/coc-keeper/scripts/coc_epistemic_metrics.py"


NEW_FUNCTION = '''def _parse_risk_exposure(
    events: list[dict[str, Any]],
    compile_confidence: dict[str, Any] | None,
    parse_manifest: dict[str, Any] | None,
) -> dict[str, Any]:
    """Measure source/compile risk only for delivered cognitive effects.

    A low-confidence node elsewhere in the module is an authoring concern, not
    player exposure.  Delivery is established by belief-treatment events and
    optional structured range IDs carried by those events or their matching
    compile-confidence records.
    """
    findings: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    treatment_events = [
        event for event in events if _event_type(event) in _TREATMENT_TYPES
    ]
    delivered_question_ids = {
        str(event.get("question_id"))
        for event in treatment_events
        if isinstance(event.get("question_id"), str) and event.get("question_id")
    }
    delivered_contract_ids = {
        str(event.get("reveal_contract_id"))
        for event in treatment_events
        if isinstance(event.get("reveal_contract_id"), str)
        and event.get("reveal_contract_id")
    }
    delivered_range_ids: set[str] = set()
    for event in treatment_events:
        delivered_range_ids.update(_strings(event.get("source_range_ids")))
        delivered_range_ids.update(_strings(event.get("parse_range_ids")))
        confidence = event.get("compile_confidence")
        if not isinstance(confidence, dict):
            continue
        record = confidence.get("record")
        if isinstance(record, dict):
            delivered_range_ids.update(_strings(record.get("source_range_ids")))
            delivered_range_ids.update(_strings(record.get("parse_range_ids")))
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
    delivered_node_ids = delivered_question_ids | delivered_contract_ids
    for record in document.get("nodes") or []:
        if not isinstance(record, dict):
            continue
        node_type = str(record.get("node_type") or "")
        node_id = str(record.get("node_id") or "")
        if node_type == "question":
            if node_id not in delivered_question_ids:
                continue
        elif node_type == "reveal_contract":
            if node_id not in delivered_contract_ids:
                continue
        elif node_id not in delivered_node_ids:
            continue
        importance = str(record.get("importance") or "")
        if importance and importance != "critical":
            continue
        delivered_range_ids.update(_strings(record.get("source_range_ids")))
        delivered_range_ids.update(_strings(record.get("parse_range_ids")))
        semantic = _confidence(record.get("semantic_confidence"))
        source = _confidence(record.get("source_confidence"))
        effective = _confidence(record.get("effective_confidence"))
        values = [value for value in (semantic, source, effective) if value is not None]
        value = min(values) if values else None
        review_state = str(record.get("review_state") or "needs_review")
        if (
            value is None
            or value < default_threshold
            or review_state not in {"auto_accepted", "manual_accepted"}
        ):
            key = (node_id, "compiled_node")
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
        range_id = str(record.get("range_id") or "")
        if not range_id or range_id not in delivered_range_ids:
            continue
        review_state = str(record.get("review_state") or "needs_review")
        overall = _confidence((record.get("quality") or {}).get("overall"))
        threshold = _confidence(manifest.get("default_threshold")) or 0.8
        if (
            review_state in {"needs_review", "rejected"}
            or overall is None
            or overall < threshold
        ):
            key = (range_id, "parse_range")
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


'''


def main() -> None:
    text = TARGET.read_text(encoding="utf-8")
    start = text.index("def _parse_risk_exposure(")
    end = text.index("def _health(", start)
    current = text[start:end]
    if current == NEW_FUNCTION:
        return
    TARGET.write_text(text[:start] + NEW_FUNCTION + text[end:], encoding="utf-8")


if __name__ == "__main__":
    main()
