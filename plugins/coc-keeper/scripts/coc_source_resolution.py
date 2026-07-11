#!/usr/bin/env python3
"""Minimum-privilege requests for repairing unresolved module source evidence."""
from __future__ import annotations

from typing import Any

_ALLOWED_OUTPUTS = (
    "player_safe_summary",
    "delivery_kind",
    "source_refs",
    "confidence",
)
_FORBIDDEN_OUTPUTS = (
    "raw_keeper_prose",
    "raw_module_text_to_narrator",
    "new_core_truth",
)
_ALLOWED_REASONS = frozenset({
    "critical_reveal_low_confidence",
    "missing_source_anchor",
    "player_safe_handout_extraction",
    "atmospheric_detail",
})


def build_source_resolution_request(
    node_id: str,
    reason: str,
    source_refs: list[dict[str, Any]],
    allowed_outputs: list[str] | None = None,
) -> dict[str, Any]:
    """Build a structured lookup request without exposing Keeper prose."""
    normalized_reason = str(reason or "critical_reveal_low_confidence")
    if normalized_reason not in _ALLOWED_REASONS:
        normalized_reason = "critical_reveal_low_confidence"
    requested = list(allowed_outputs or _ALLOWED_OUTPUTS)
    safe_outputs = [value for value in _ALLOWED_OUTPUTS if value in requested]
    if not safe_outputs:
        safe_outputs = list(_ALLOWED_OUTPUTS)
    safe_refs = [
        {
            key: ref[key]
            for key in (
                "source_id", "path", "pdf_index", "printed_page", "printed_label",
                "page", "page_kind", "grep_anchor",
            )
            if key in ref
        }
        for ref in (source_refs or [])
        if isinstance(ref, dict)
    ]
    return {
        "schema_version": 1,
        "node_id": str(node_id or ""),
        "reason": normalized_reason,
        "source_refs": safe_refs,
        "allowed_outputs": safe_outputs,
        "must_not_return": list(_FORBIDDEN_OUTPUTS),
        "runtime_policy": "planner_or_compiler_only; never inject raw source prose into narration",
    }
