#!/usr/bin/env python3
"""Human calibration agreement and hidden holdout hash binding for eval-spec-v1."""
from __future__ import annotations

import hashlib
import json
from collections import Counter, defaultdict
from itertools import combinations
from pathlib import Path
from typing import Any


EVAL_SPEC = "eval-spec-v1"
DECISIONS = frozenset({"A", "B", "tie", "uncertain"})
FORBIDDEN_LABEL_KEYS = frozenset(
    {
        "baseline",
        "candidate",
        "side",
        "baseline_label",
        "candidate_label",
    }
)
REQUIRED_REVIEW_FIELDS = (
    "item_id",
    "reviewer_id",
    "rubric_id",
    "rubric_version",
    "decision",
    "evidence_spans",
    "reviewed_at",
    "request_sha256",
    "artifact_sha256",
)


def _finding(*, code: str, severity: str, message: str, **extra: Any) -> dict[str, Any]:
    payload = {"code": code, "severity": severity, "message": message}
    payload.update(extra)
    return payload


def _is_sha256(value: Any) -> bool:
    return isinstance(value, str) and len(value) == 64 and all(
        ch in "0123456789abcdef" for ch in value.lower()
    )


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"unreadable JSON: {path}: {exc}") from exc


def _load_reviews_payload(reviews: Any) -> dict[str, Any]:
    if isinstance(reviews, (str, Path)):
        path = Path(reviews)
        if path.is_dir():
            items: list[dict[str, Any]] = []
            for child in sorted(path.glob("*.json")):
                payload = _read_json(child)
                if isinstance(payload, dict) and isinstance(payload.get("reviews"), list):
                    items.extend(payload["reviews"])
                elif isinstance(payload, list):
                    items.extend(payload)
                elif isinstance(payload, dict):
                    items.append(payload)
            return {
                "schema_version": 1,
                "eval_spec": EVAL_SPEC,
                "rubric_id": "unknown",
                "rubric_version": "unknown",
                "reviews": items,
            }
        payload = _read_json(path)
        if not isinstance(payload, dict):
            raise ValueError("reviews file must contain a JSON object")
        return payload
    if isinstance(reviews, dict):
        return reviews
    if isinstance(reviews, list):
        return {
            "schema_version": 1,
            "eval_spec": EVAL_SPEC,
            "rubric_id": "unknown",
            "rubric_version": "unknown",
            "reviews": reviews,
        }
    raise ValueError("reviews must be a path, object, or list")


def _validate_review_item(item: Any, *, index: int) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    if not isinstance(item, dict):
        findings.append(
            _finding(
                code="review_item_invalid",
                severity="schema",
                message=f"reviews[{index}] must be an object",
            )
        )
        return findings
    leaked = sorted(FORBIDDEN_LABEL_KEYS.intersection(item))
    if leaked:
        findings.append(
            _finding(
                code="label_leakage",
                severity="schema",
                message=f"reviews[{index}] contains forbidden label keys: {leaked}",
                keys=leaked,
            )
        )
    for field in REQUIRED_REVIEW_FIELDS:
        if field not in item:
            findings.append(
                _finding(
                    code="review_field_missing",
                    severity="schema",
                    message=f"reviews[{index}] missing {field}",
                    field=field,
                )
            )
    if item.get("decision") not in DECISIONS:
        findings.append(
            _finding(
                code="review_decision_invalid",
                severity="schema",
                message=f"reviews[{index}].decision must be one of {sorted(DECISIONS)}",
            )
        )
    for hash_field in ("request_sha256", "artifact_sha256"):
        if hash_field in item and not _is_sha256(item.get(hash_field)):
            findings.append(
                _finding(
                    code="review_hash_invalid",
                    severity="schema",
                    message=f"reviews[{index}].{hash_field} must be sha256 hex",
                    field=hash_field,
                )
            )
    spans = item.get("evidence_spans")
    if not isinstance(spans, list) or not spans:
        findings.append(
            _finding(
                code="evidence_spans_missing",
                severity="schema",
                message=f"reviews[{index}].evidence_spans must be a non-empty list",
            )
        )
    else:
        for span_index, span in enumerate(spans):
            if not isinstance(span, dict):
                findings.append(
                    _finding(
                        code="evidence_span_invalid",
                        severity="schema",
                        message=f"reviews[{index}].evidence_spans[{span_index}] must be object",
                    )
                )
                continue
            if "turn_id" not in span or not span.get("span_id"):
                findings.append(
                    _finding(
                        code="evidence_span_incomplete",
                        severity="schema",
                        message=(
                            f"reviews[{index}].evidence_spans[{span_index}] "
                            "requires turn_id and span_id"
                        ),
                    )
                )
    return findings


def validate_calibration_reviews(reviews: Any) -> dict[str, Any]:
    """Validate blinded calibration review payloads against the v1 contract."""
    findings: list[dict[str, Any]] = []
    try:
        doc = _load_reviews_payload(reviews)
    except ValueError as exc:
        return {
            "schema_version": 1,
            "eval_spec": EVAL_SPEC,
            "status": "FAIL",
            "findings": [
                _finding(
                    code="reviews_unreadable",
                    severity="schema",
                    message=str(exc),
                )
            ],
        }

    if doc.get("schema_version") != 1 or doc.get("eval_spec") != EVAL_SPEC:
        findings.append(
            _finding(
                code="reviews_version_mismatch",
                severity="schema",
                message="reviews must declare schema_version=1 and eval-spec-v1",
            )
        )
    for key in FORBIDDEN_LABEL_KEYS:
        if key in doc:
            findings.append(
                _finding(
                    code="label_leakage",
                    severity="schema",
                    message=f"top-level forbidden label key: {key}",
                    keys=[key],
                )
            )

    items = doc.get("reviews")
    if not isinstance(items, list) or not items:
        findings.append(
            _finding(
                code="reviews_missing",
                severity="schema",
                message="reviews must be a non-empty list",
            )
        )
        items = []

    for index, item in enumerate(items):
        findings.extend(_validate_review_item(item, index=index))

    status = "PASS" if not findings else "FAIL"
    return {
        "schema_version": 1,
        "eval_spec": EVAL_SPEC,
        "status": status,
        "findings": findings,
        "review_count": len(items),
    }


def _pair_kappa(pairs: list[tuple[str, str]]) -> tuple[float, float]:
    """Return (exact_agreement, cohen_kappa) for categorical pairs."""
    if not pairs:
        return 0.0, 0.0
    n = len(pairs)
    agree = sum(1 for left, right in pairs if left == right)
    po = agree / n
    left_counts = Counter(left for left, _ in pairs)
    right_counts = Counter(right for _, right in pairs)
    categories = set(left_counts) | set(right_counts)
    pe = sum((left_counts[cat] / n) * (right_counts[cat] / n) for cat in categories)
    if abs(1.0 - pe) < 1e-12:
        # Zero expected variance: perfect agreement → 1.0, otherwise 0.0.
        kappa = 1.0 if abs(po - 1.0) < 1e-12 else 0.0
    else:
        kappa = (po - pe) / (1.0 - pe)
    return po, kappa


def compute_agreement(reviews: Any) -> dict[str, Any]:
    """Compute exact agreement and Cohen's kappa from structured review decisions."""
    if isinstance(reviews, dict) and "reviews" in reviews:
        items = reviews.get("reviews") or []
    elif isinstance(reviews, list):
        items = reviews
    else:
        try:
            doc = _load_reviews_payload(reviews)
            items = doc.get("reviews") or []
        except ValueError as exc:
            return {
                "schema_version": 1,
                "eval_spec": EVAL_SPEC,
                "status": "FAIL",
                "findings": [
                    _finding(
                        code="reviews_unreadable",
                        severity="schema",
                        message=str(exc),
                    )
                ],
                "exact_agreement": None,
                "cohen_kappa": None,
            }

    if not isinstance(items, list) or not items:
        return {
            "schema_version": 1,
            "eval_spec": EVAL_SPEC,
            "status": "NOT_RUN",
            "findings": [
                _finding(
                    code="insufficient_reviewers",
                    severity="missing_evidence",
                    message="empty review set cannot compute agreement",
                )
            ],
            "exact_agreement": None,
            "cohen_kappa": None,
            "reviewer_count": 0,
        }

    by_item: dict[str, dict[str, str]] = defaultdict(dict)
    reviewers: set[str] = set()
    for item in items:
        if not isinstance(item, dict):
            continue
        item_id = item.get("item_id")
        reviewer_id = item.get("reviewer_id")
        decision = item.get("decision")
        if not isinstance(item_id, str) or not item_id:
            continue
        if not isinstance(reviewer_id, str) or not reviewer_id:
            continue
        if decision not in DECISIONS:
            continue
        by_item[item_id][reviewer_id] = decision
        reviewers.add(reviewer_id)

    reviewer_list = sorted(reviewers)
    if len(reviewer_list) < 2:
        return {
            "schema_version": 1,
            "eval_spec": EVAL_SPEC,
            "status": "NOT_RUN",
            "findings": [
                _finding(
                    code="insufficient_reviewers",
                    severity="missing_evidence",
                    message="agreement requires at least two reviewers",
                )
            ],
            "exact_agreement": None,
            "cohen_kappa": None,
            "reviewer_count": len(reviewer_list),
        }

    pairwise: list[dict[str, Any]] = []
    aggregate_pairs: list[tuple[str, str]] = []
    for left_id, right_id in combinations(reviewer_list, 2):
        pairs: list[tuple[str, str]] = []
        for decisions in by_item.values():
            if left_id in decisions and right_id in decisions:
                pair = (decisions[left_id], decisions[right_id])
                pairs.append(pair)
                aggregate_pairs.append(pair)
        if not pairs:
            continue
        po, kappa = _pair_kappa(pairs)
        pairwise.append(
            {
                "reviewers": [left_id, right_id],
                "pair_count": len(pairs),
                "exact_agreement": po,
                "cohen_kappa": kappa,
            }
        )

    if not aggregate_pairs:
        return {
            "schema_version": 1,
            "eval_spec": EVAL_SPEC,
            "status": "NOT_RUN",
            "findings": [
                _finding(
                    code="no_overlapping_items",
                    severity="missing_evidence",
                    message="no overlapping item decisions across reviewers",
                )
            ],
            "exact_agreement": None,
            "cohen_kappa": None,
            "reviewer_count": len(reviewer_list),
            "pairwise": pairwise,
        }

    exact, kappa = _pair_kappa(aggregate_pairs)
    result: dict[str, Any] = {
        "schema_version": 1,
        "eval_spec": EVAL_SPEC,
        "status": "PASS",
        "findings": [],
        "reviewer_count": len(reviewer_list),
        "exact_agreement": exact,
        "pair_count": len(aggregate_pairs),
    }
    if len(reviewer_list) == 2:
        result["cohen_kappa"] = kappa
    else:
        result["pairwise"] = pairwise
        result["cohen_kappa"] = None
        # Aggregate exact agreement across all pairwise overlapping decisions.
        result["exact_agreement"] = exact
    return result


def _validate_manifest_structure(manifest: dict[str, Any]) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    if manifest.get("schema_version") != 1 or manifest.get("eval_spec") != EVAL_SPEC:
        findings.append(
            _finding(
                code="holdout_manifest_version_mismatch",
                severity="schema",
                message="holdout manifest must declare schema_version=1 and eval-spec-v1",
            )
        )
    holdouts = manifest.get("holdouts")
    if not isinstance(holdouts, list) or not holdouts:
        findings.append(
            _finding(
                code="holdout_manifest_empty",
                severity="schema",
                message="holdouts must be a non-empty list",
            )
        )
        return findings

    seen_ids: dict[str, str] = {}
    for index, item in enumerate(holdouts):
        if not isinstance(item, dict):
            findings.append(
                _finding(
                    code="holdout_entry_invalid",
                    severity="schema",
                    message=f"holdouts[{index}] must be an object",
                )
            )
            continue
        holdout_id = item.get("holdout_id")
        digest = item.get("sha256")
        rel = item.get("relative_path")
        if not isinstance(holdout_id, str) or not holdout_id:
            findings.append(
                _finding(
                    code="holdout_id_missing",
                    severity="schema",
                    message=f"holdouts[{index}].holdout_id required",
                )
            )
            continue
        if holdout_id in seen_ids and seen_ids[holdout_id] != digest:
            findings.append(
                _finding(
                    code="holdout_manifest_inconsistent",
                    severity="schema",
                    message=f"duplicate holdout_id with conflicting hashes: {holdout_id}",
                    holdout_id=holdout_id,
                )
            )
        seen_ids[holdout_id] = str(digest)
        if not _is_sha256(digest):
            findings.append(
                _finding(
                    code="holdout_hash_invalid",
                    severity="schema",
                    message=f"holdouts[{index}].sha256 must be sha256 hex",
                    holdout_id=holdout_id,
                )
            )
        if not isinstance(rel, str) or not rel:
            findings.append(
                _finding(
                    code="holdout_path_missing",
                    severity="schema",
                    message=f"holdouts[{index}].relative_path required",
                    holdout_id=holdout_id,
                )
            )
        for forbidden in ("question", "answer", "expected"):
            if forbidden in item:
                findings.append(
                    _finding(
                        code="holdout_content_leakage",
                        severity="schema",
                        message=f"holdouts[{index}] must not contain {forbidden}",
                        holdout_id=holdout_id,
                    )
                )
    return findings


def validate_holdout_bundle(
    manifest: Path | str | dict[str, Any],
    bundle_dir: Path | str,
) -> dict[str, Any]:
    """Validate a separately supplied holdout bundle against repository hashes."""
    findings: list[dict[str, Any]] = []
    if isinstance(manifest, dict):
        manifest_payload = manifest
    else:
        manifest_path = Path(manifest)
        if not manifest_path.is_file():
            return {
                "schema_version": 1,
                "eval_spec": EVAL_SPEC,
                "status": "FAIL",
                "findings": [
                    _finding(
                        code="holdout_manifest_missing",
                        severity="schema",
                        message=f"holdout manifest missing: {manifest_path}",
                    )
                ],
            }
        try:
            manifest_payload = _read_json(manifest_path)
        except ValueError as exc:
            return {
                "schema_version": 1,
                "eval_spec": EVAL_SPEC,
                "status": "FAIL",
                "findings": [
                    _finding(
                        code="holdout_manifest_unreadable",
                        severity="schema",
                        message=str(exc),
                    )
                ],
            }

    if not isinstance(manifest_payload, dict):
        return {
            "schema_version": 1,
            "eval_spec": EVAL_SPEC,
            "status": "FAIL",
            "findings": [
                _finding(
                    code="holdout_manifest_invalid",
                    severity="schema",
                    message="holdout manifest must be a JSON object",
                )
            ],
        }

    structure_findings = _validate_manifest_structure(manifest_payload)
    if structure_findings:
        # Tampered / self-inconsistent manifest is FAIL, never NOT_RUN.
        return {
            "schema_version": 1,
            "eval_spec": EVAL_SPEC,
            "status": "FAIL",
            "findings": structure_findings,
        }

    bundle = Path(bundle_dir)
    if not bundle.exists() or not bundle.is_dir():
        return {
            "schema_version": 1,
            "eval_spec": EVAL_SPEC,
            "status": "NOT_RUN",
            "findings": [
                _finding(
                    code="holdout_bundle_missing",
                    severity="missing_evidence",
                    message=f"holdout bundle directory missing: {bundle}",
                )
            ],
        }

    matched = 0
    for item in manifest_payload["holdouts"]:
        holdout_id = item["holdout_id"]
        rel = Path(item["relative_path"])
        expected = str(item["sha256"]).lower()
        path = bundle / rel
        if not path.is_file():
            findings.append(
                _finding(
                    code="holdout_artifact_missing",
                    severity="contradictory_evidence",
                    message=f"missing holdout artifact: {rel}",
                    holdout_id=holdout_id,
                )
            )
            continue
        actual = _sha256_file(path).lower()
        if actual != expected:
            findings.append(
                _finding(
                    code="holdout_hash_mismatch",
                    severity="contradictory_evidence",
                    message=f"sha256 mismatch for {rel}",
                    holdout_id=holdout_id,
                    expected=expected,
                    actual=actual,
                )
            )
        else:
            matched += 1

    if findings:
        return {
            "schema_version": 1,
            "eval_spec": EVAL_SPEC,
            "status": "FAIL",
            "findings": findings,
            "matched_count": matched,
        }
    return {
        "schema_version": 1,
        "eval_spec": EVAL_SPEC,
        "status": "PASS",
        "findings": [],
        "matched_count": matched,
    }


def run_calibrate_cli(
    *,
    reviews: Path | str,
    root: Path | str | None = None,
) -> dict[str, Any]:
    """Validate reviews and compute agreement for the calibrate CLI."""
    del root  # reserved for future schema-path resolution
    validation = validate_calibration_reviews(reviews)
    if validation["status"] != "PASS":
        return {
            "schema_version": 1,
            "eval_spec": EVAL_SPEC,
            "status": validation["status"],
            "validation": validation,
            "agreement": None,
            "findings": validation.get("findings") or [],
        }
    agreement = compute_agreement(reviews)
    return {
        "schema_version": 1,
        "eval_spec": EVAL_SPEC,
        "status": agreement["status"],
        "validation": validation,
        "agreement": agreement,
        "findings": agreement.get("findings") or [],
    }


def run_holdouts_cli(
    *,
    manifest: Path | str,
    bundle: Path | str,
    root: Path | str | None = None,
) -> dict[str, Any]:
    """Validate a holdout bundle for the holdouts CLI."""
    del root
    return validate_holdout_bundle(manifest, bundle)
