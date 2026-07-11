#!/usr/bin/env python3
"""Structured narrator secret audit; never scans generated prose."""
from __future__ import annotations

from typing import Any


_DECISIONS = frozenset({"same_fact", "different_fact", "uncertain"})


def _refs(values: Any) -> list[str]:
    if not isinstance(values, list):
        return []
    return sorted(set(
        str(value).strip() for value in values
        if isinstance(value, str) and value.strip()
    ))


def audit_secret_claims(
    forbidden_refs: Any, asserted_fact_refs: Any, semantic_evidence: Any
) -> dict[str, Any]:
    forbidden = set(_refs(forbidden_refs))
    asserted = set(_refs(asserted_fact_refs))
    direct = sorted(forbidden & asserted)
    semantic_matches: list[dict[str, str]] = []
    malformed: list[dict[str, Any]] = []
    uncertain: list[dict[str, Any]] = []
    evidence = semantic_evidence if isinstance(semantic_evidence, list) else []
    if semantic_evidence is not None and not isinstance(semantic_evidence, list):
        malformed.append({"index": -1, "reason": "semantic_evidence_not_list"})
    for index, raw in enumerate(evidence):
        if not isinstance(raw, dict):
            malformed.append({"index": index, "reason": "record_not_object"})
            continue
        decision = raw.get("decision")
        asserted_ref = raw.get("asserted_ref")
        forbidden_ref = raw.get("forbidden_ref")
        reason = raw.get("reason")
        valid = (
            decision in _DECISIONS
            and isinstance(asserted_ref, str) and asserted_ref.strip() in asserted
            and isinstance(forbidden_ref, str) and forbidden_ref.strip() in forbidden
            and isinstance(reason, str) and bool(reason.strip())
            and set(raw) == {"asserted_ref", "forbidden_ref", "decision", "reason"}
        )
        if not valid:
            malformed.append({"index": index, "reason": "invalid_semantic_record"})
            continue
        normalized = {
            "asserted_ref": asserted_ref.strip(), "forbidden_ref": forbidden_ref.strip(),
            "decision": decision, "reason": reason.strip(),
        }
        if decision == "same_fact":
            semantic_matches.append(normalized)
        elif decision == "uncertain":
            uncertain.append(normalized)
    passed = not direct and not semantic_matches and not uncertain and not malformed
    return {
        "passed": passed,
        "evidence_eligible": passed,
        "direct_matches": direct,
        "semantic_matches": semantic_matches,
        "uncertain_matches": uncertain,
        "malformed_evidence": malformed,
    }
