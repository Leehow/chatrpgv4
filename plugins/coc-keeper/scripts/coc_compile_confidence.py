#!/usr/bin/env python3
"""Structured readiness checks for semantically compiled epistemic nodes."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

DEFAULT_THRESHOLD = 0.80
ACCEPTED_REVIEW_STATES = frozenset({"auto_accepted", "manual_accepted"})


def _bounded(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return round(max(0.0, min(1.0, number)), 3)


def load_compile_confidence(scenario_dir: Path) -> dict[str, Any]:
    path = Path(scenario_dir) / "compile-confidence.json"
    if not path.exists():
        return {"schema_version": 1, "nodes": []}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"schema_version": 1, "nodes": []}
    return payload if isinstance(payload, dict) else {"schema_version": 1, "nodes": []}


def find_node_confidence(
    document: dict[str, Any] | None,
    node_type: str,
    node_id: str,
) -> dict[str, Any] | None:
    for record in (document or {}).get("nodes") or []:
        if not isinstance(record, dict):
            continue
        if record.get("node_type") == node_type and record.get("node_id") == node_id:
            return record
    return None


def effective_confidence(record: dict[str, Any] | None) -> float | None:
    if not isinstance(record, dict):
        return None
    values = [
        value
        for value in (
            _bounded(record.get("semantic_confidence")),
            _bounded(record.get("source_confidence")),
            _bounded(record.get("effective_confidence")),
        )
        if value is not None
    ]
    return min(values) if values else None


def node_ready(
    document: dict[str, Any] | None,
    node_type: str,
    node_id: str,
    threshold: float | None = None,
) -> dict[str, Any]:
    """Return readiness; missing documents/records preserve legacy behavior."""
    document = document if isinstance(document, dict) else {}
    records = document.get("nodes")
    if not isinstance(records, list) or not records:
        return {
            "ready": True,
            "legacy": True,
            "confidence": None,
            "threshold": _bounded(threshold) or DEFAULT_THRESHOLD,
            "reason": "compile_confidence_absent",
        }
    record = find_node_confidence(document, node_type, node_id)
    configured = _bounded(
        threshold if threshold is not None else document.get("default_threshold")
    )
    threshold_value = configured if configured is not None else DEFAULT_THRESHOLD
    if record is None:
        return {
            "ready": False,
            "legacy": False,
            "confidence": None,
            "threshold": threshold_value,
            "reason": "node_confidence_missing",
        }
    confidence = effective_confidence(record)
    review_state = str(record.get("review_state") or "needs_review")
    if review_state not in ACCEPTED_REVIEW_STATES:
        return {
            "ready": False,
            "legacy": False,
            "confidence": confidence,
            "threshold": threshold_value,
            "review_state": review_state,
            "reason": "node_needs_review",
            "record": record,
        }
    ready = confidence is not None and confidence >= threshold_value
    return {
        "ready": ready,
        "legacy": False,
        "confidence": confidence,
        "threshold": threshold_value,
        "review_state": review_state,
        "reason": "ready" if ready else "low_compile_confidence",
        "record": record,
    }
