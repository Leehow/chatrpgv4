#!/usr/bin/env python3
"""Structured narrator secret audit; never scans generated prose."""
from __future__ import annotations

import hashlib
import json
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
    observed_pairs: list[tuple[str, str]] = []
    expected_pairs = sorted((a, f) for a in asserted for f in forbidden)
    for index, raw in enumerate(evidence):
        if not isinstance(raw, dict):
            malformed.append({"index": index, "reason": "record_not_object"})
            continue
        decision = raw.get("decision")
        asserted_ref = raw.get("asserted_ref")
        forbidden_ref = raw.get("forbidden_ref")
        reason = raw.get("reason")
        pair = (
            asserted_ref.strip() if isinstance(asserted_ref, str) else "",
            forbidden_ref.strip() if isinstance(forbidden_ref, str) else "",
        )
        valid = (
            decision in _DECISIONS
            and pair[0] in asserted
            and pair[1] in forbidden
            and isinstance(reason, str) and bool(reason.strip())
            and set(raw) == {"asserted_ref", "forbidden_ref", "decision", "reason"}
        )
        if not valid:
            reason_code = (
                "unexpected_pair"
                if pair[0] or pair[1]
                else "invalid_semantic_record"
            )
            malformed.append({"index": index, "reason": reason_code})
            continue
        if pair in observed_pairs:
            malformed.append({"index": index, "reason": "duplicate_pair"})
            continue
        observed_pairs.append(pair)
        normalized = {
            "asserted_ref": asserted_ref.strip(), "forbidden_ref": forbidden_ref.strip(),
            "decision": decision, "reason": reason.strip(),
        }
        if decision == "same_fact":
            semantic_matches.append(normalized)
        elif decision == "uncertain":
            uncertain.append(normalized)
    for pair in expected_pairs:
        if pair not in observed_pairs:
            malformed.append({
                "index": -1, "reason": "missing_pair",
                "asserted_ref": pair[0], "forbidden_ref": pair[1],
            })
    passed = not direct and not semantic_matches and not uncertain and not malformed
    normalized_evidence = [
        {
            "asserted_ref": str(raw.get("asserted_ref") or "").strip(),
            "forbidden_ref": str(raw.get("forbidden_ref") or "").strip(),
            "decision": raw.get("decision"),
            "reason": str(raw.get("reason") or "").strip(),
        }
        for raw in evidence if isinstance(raw, dict)
    ]
    coverage = {
        "asserted_refs": sorted(asserted),
        "forbidden_refs": sorted(forbidden),
        "expected_pair_count": len(expected_pairs),
        "observed_pair_count": len(observed_pairs),
        "expected_pairs": [list(pair) for pair in expected_pairs],
    }
    digest_payload = {
        "coverage": coverage,
        "semantic_evidence": normalized_evidence,
    }
    coverage_digest = hashlib.sha256(
        json.dumps(digest_payload, ensure_ascii=False, sort_keys=True,
                   separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return {
        "schema_version": 1,
        "status": "passed" if passed else "failed",
        "passed": passed,
        "evidence_eligible": passed,
        "forbidden_refs": sorted(forbidden),
        "asserted_fact_refs": sorted(asserted),
        "semantic_evidence": normalized_evidence,
        "semantic_evidence_contract": {
            "schema_version": 1,
            "coverage_rule": "asserted_x_forbidden_exact",
            "verification_owner": "coc_secret_audit",
        },
        "coverage": coverage,
        "coverage_digest": coverage_digest,
        "direct_matches": direct,
        "semantic_matches": semantic_matches,
        "uncertain_matches": uncertain,
        "malformed_evidence": malformed,
    }


def validate_audit_receipt(receipt: Any) -> dict[str, Any]:
    """Recompute a persisted audit receipt instead of trusting its status."""
    exact_keys = {
        "schema_version", "status", "passed", "evidence_eligible",
        "forbidden_refs", "asserted_fact_refs", "semantic_evidence",
        "semantic_evidence_contract", "coverage", "coverage_digest",
        "direct_matches", "semantic_matches", "uncertain_matches",
        "malformed_evidence",
    }
    if (not isinstance(receipt, dict) or receipt.get("schema_version") != 1
            or set(receipt) != exact_keys):
        return {"valid": False, "passed": False, "reason": "audit_receipt_shape_invalid"}
    recomputed = audit_secret_claims(
        receipt.get("forbidden_refs"),
        receipt.get("asserted_fact_refs"),
        receipt.get("semantic_evidence"),
    )
    comparable = (
        "status", "passed", "evidence_eligible", "coverage",
        "coverage_digest", "direct_matches", "semantic_matches",
        "uncertain_matches", "malformed_evidence", "semantic_evidence_contract",
    )
    valid = all(receipt.get(key) == recomputed.get(key) for key in comparable)
    return {
        "valid": valid,
        "passed": valid and recomputed["passed"] is True,
        "reason": None if valid else "audit_receipt_recompute_mismatch",
        "recomputed": recomputed,
    }
