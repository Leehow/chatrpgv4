#!/usr/bin/env python3
"""Dimension-by-dimension baseline comparison for eval-spec-v1."""
from __future__ import annotations

import hashlib
import json
import math
import os
import random
import tempfile
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[2]
EVAL_SPEC = "eval-spec-v1"
THRESHOLDS_PATH = Path("evaluation/spec/v1/thresholds.json")
METRICS_PATH = Path("artifacts/metric-results.json")
COMPLETENESS_PATH = Path("artifacts/report-completeness.json")
CASE_RESULTS_PATH = Path("case-results.json")
COMPARISON_JSON = Path("artifacts/baseline-comparison.json")
COMPARISON_MD = Path("artifacts/baseline-comparison.md")
IDENTITY_KEYS = (
    "eval_spec",
    "benchmark_version",
    "report_schema_version",
    "case_id",
    "seed",
    "initial_state_sha256",
    "kp_model",
    "player_model",
    "prompt_hashes",
    "runner_hashes",
    "case_ids",
    "persona_ids",
    "seeds",
)


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _write_text_atomic(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            temp_path = Path(handle.name)
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, path)
        temp_path = None
    finally:
        if temp_path is not None:
            try:
                temp_path.unlink(missing_ok=True)
            except OSError:
                pass
    return path


def _write_json_atomic(path: Path, payload: Any) -> Path:
    return _write_text_atomic(
        path,
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
    )


def _manifest_path(value: Path | str) -> Path:
    path = Path(value)
    return path / "run-manifest.json" if path.is_dir() else path


def _run_root(manifest_path: Path) -> Path:
    return manifest_path.parent


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _metrics_present(run_root: Path) -> bool:
    return (run_root / METRICS_PATH).is_file()


def load_thresholds(root: Path | str) -> dict[str, Any]:
    path = Path(root) / THRESHOLDS_PATH
    payload = _read_json(path)
    if not isinstance(payload, dict):
        raise ValueError(f"thresholds missing or malformed: {path}")
    if payload.get("schema_version") != 1 or payload.get("eval_spec") != EVAL_SPEC:
        raise ValueError("invalid eval-spec-v1 thresholds")
    hard = payload.get("hard_zero_tolerance")
    rates = payload.get("rate_thresholds")
    subjective = payload.get("subjective_non_inferiority")
    if not isinstance(hard, list) or not all(
        isinstance(value, str) and value for value in hard
    ):
        raise ValueError("invalid hard_zero_tolerance thresholds")
    if not isinstance(rates, dict) or not isinstance(subjective, dict):
        raise ValueError("invalid rate or subjective thresholds")
    return payload


def _percentile(sorted_values: list[float], probability: float) -> float:
    if not sorted_values:
        raise ValueError("percentile requires values")
    if len(sorted_values) == 1:
        return sorted_values[0]
    position = min(1.0, max(0.0, probability)) * (len(sorted_values) - 1)
    lower = int(math.floor(position))
    upper = int(math.ceil(position))
    if lower == upper:
        return sorted_values[lower]
    weight = position - lower
    return sorted_values[lower] * (1.0 - weight) + sorted_values[upper] * weight


def paired_bootstrap_ci(
    deltas: list[float],
    *,
    seed: int,
    samples: int,
    confidence: float,
) -> tuple[float, float]:
    """Return a seeded percentile bootstrap interval for paired deltas."""
    if not deltas:
        raise ValueError("paired bootstrap requires at least one delta")
    if samples < 100:
        raise ValueError("paired bootstrap samples must be at least 100")
    if not 0 < confidence < 1:
        raise ValueError("confidence must be between zero and one")
    clean = [float(value) for value in deltas]
    if not all(math.isfinite(value) for value in clean):
        raise ValueError("paired bootstrap deltas must be finite")
    rng = random.Random(seed)
    count = len(clean)
    means = []
    for _ in range(samples):
        means.append(sum(clean[rng.randrange(count)] for _ in range(count)) / count)
    means.sort()
    alpha = (1.0 - confidence) / 2.0
    return _percentile(means, alpha), _percentile(means, 1.0 - alpha)


def _number(value: Any, *, field: str) -> float:
    if isinstance(value, bool):
        raise ValueError(f"invalid numeric metric: {field}")
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"invalid numeric metric: {field}") from exc
    if not math.isfinite(number):
        raise ValueError(f"invalid numeric metric: {field}")
    return number


def _hard_findings(metrics: dict[str, Any]) -> dict[str, int]:
    rows = metrics.get("hard_findings")
    if not isinstance(rows, list):
        raise ValueError("hard_findings must be a list")
    result: dict[str, int] = {}
    for row in rows:
        if isinstance(row, str):
            finding_id = row
            count = 1
        elif isinstance(row, dict):
            finding_id = row.get("finding_id")
            count = row.get("count", 1)
        else:
            raise ValueError("invalid hard finding")
        if not isinstance(finding_id, str) or not finding_id:
            raise ValueError("invalid hard finding id")
        numeric = int(_number(count, field=f"hard_findings.{finding_id}.count"))
        if numeric < 0:
            raise ValueError("hard finding count cannot be negative")
        result[finding_id] = result.get(finding_id, 0) + numeric
    return result


def _subjective_pairs(metrics: dict[str, Any]) -> dict[str, dict[str, float]]:
    subjective = metrics.get("subjective")
    if not isinstance(subjective, dict):
        raise ValueError("subjective metrics must be an object")
    result: dict[str, dict[str, float]] = {}
    for dimension, rows in subjective.items():
        if not isinstance(dimension, str) or not dimension or not isinstance(rows, list):
            raise ValueError("invalid subjective dimension")
        pairs: dict[str, float] = {}
        for row in rows:
            if not isinstance(row, dict):
                raise ValueError(f"invalid subjective row: {dimension}")
            pair_id = row.get("pair_id")
            if not isinstance(pair_id, str) or not pair_id or pair_id in pairs:
                raise ValueError(f"invalid subjective pair id: {dimension}")
            pairs[pair_id] = _number(
                row.get("score"), field=f"subjective.{dimension}.{pair_id}.score"
            )
        result[dimension] = pairs
    return result


def _finding(
    *,
    finding_id: str,
    dimension: str,
    baseline: Any,
    candidate: Any,
    threshold: Any,
    detail: str,
) -> dict[str, Any]:
    return {
        "finding_id": finding_id,
        "dimension": dimension,
        "baseline": baseline,
        "candidate": candidate,
        "threshold": threshold,
        "detail": detail,
        "release_blocking": True,
    }


def _validate_metrics(payload: Any, *, label: str) -> dict[str, Any]:
    if not isinstance(payload, dict) or payload.get("schema_version") != 1:
        raise ValueError(f"{label}_metric_results_missing_or_malformed")
    if not isinstance(payload.get("rates"), dict) or not isinstance(
        payload.get("performance"), dict
    ):
        raise ValueError(f"{label}_metric_results_missing_or_malformed")
    _hard_findings(payload)
    _subjective_pairs(payload)
    return payload


def compare_evaluation_runs(
    baseline: Path | str,
    candidate: Path | str,
    thresholds: dict[str, Any],
    *,
    bootstrap_seed: int = 1729,
    bootstrap_samples: int = 5000,
) -> dict[str, Any]:
    baseline_manifest_path = _manifest_path(baseline)
    candidate_manifest_path = _manifest_path(candidate)
    baseline_manifest = _read_json(baseline_manifest_path)
    candidate_manifest = _read_json(candidate_manifest_path)
    if not isinstance(baseline_manifest, dict) or not isinstance(
        candidate_manifest, dict
    ):
        return {
            "schema_version": 1,
            "eval_spec": EVAL_SPEC,
            "status": "NON_COMPARABLE",
            "identity_mismatches": ["run_manifest_missing_or_malformed"],
            "regressions": [],
        }

    mismatches = [
        key
        for key in IDENTITY_KEYS
        if baseline_manifest.get(key) != candidate_manifest.get(key)
    ]
    if mismatches:
        return {
            "schema_version": 1,
            "eval_spec": EVAL_SPEC,
            "status": "NON_COMPARABLE",
            "identity_mismatches": mismatches,
            "regressions": [],
        }

    baseline_root = _run_root(baseline_manifest_path)
    candidate_root = _run_root(candidate_manifest_path)
    baseline_metric_path = baseline_root / METRICS_PATH
    candidate_metric_path = candidate_root / METRICS_PATH
    try:
        baseline_metrics = _validate_metrics(
            _read_json(baseline_metric_path), label="baseline"
        )
    except ValueError as exc:
        return {
            "schema_version": 1,
            "eval_spec": EVAL_SPEC,
            "status": "NON_COMPARABLE",
            "identity_mismatches": [str(exc)],
            "regressions": [],
        }
    try:
        candidate_metrics = _validate_metrics(
            _read_json(candidate_metric_path), label="candidate"
        )
    except ValueError as exc:
        return {
            "schema_version": 1,
            "eval_spec": EVAL_SPEC,
            "status": "NON_COMPARABLE",
            "identity_mismatches": [str(exc)],
            "regressions": [],
        }

    regressions: list[dict[str, Any]] = []
    differentials: dict[str, Any] = {}
    allowed_hard = set(str(value) for value in thresholds["hard_zero_tolerance"])
    baseline_hard = _hard_findings(baseline_metrics)
    candidate_hard = _hard_findings(candidate_metrics)
    for finding_id, candidate_count in sorted(candidate_hard.items()):
        baseline_count = baseline_hard.get(finding_id, 0)
        if candidate_count > baseline_count or (
            finding_id in allowed_hard and candidate_count > 0
        ):
            regressions.append(
                _finding(
                    finding_id=f"hard_gate:{finding_id}",
                    dimension="hard_gate",
                    baseline=baseline_count,
                    candidate=candidate_count,
                    threshold=0,
                    detail=f"zero-tolerance hard finding: {finding_id}",
                )
                | {"finding_id": finding_id}
            )

    rate_config = thresholds["rate_thresholds"]
    rate_rules = {
        "completion_rate": (
            "decrease",
            _number(
                rate_config["completion_rate_max_decrease_points"],
                field="completion_rate_max_decrease_points",
            )
            / 100.0,
        ),
        "stuck_turn_rate": (
            "increase",
            _number(
                rate_config["stuck_turn_rate_max_increase_points"],
                field="stuck_turn_rate_max_increase_points",
            )
            / 100.0,
        ),
        "fallback_rate": (
            "increase",
            _number(
                rate_config["fallback_rate_max_increase_points"],
                field="fallback_rate_max_increase_points",
            )
            / 100.0,
        ),
    }
    for dimension, (direction, limit) in rate_rules.items():
        baseline_value = _number(
            baseline_metrics["rates"].get(dimension), field=f"baseline.{dimension}"
        )
        candidate_value = _number(
            candidate_metrics["rates"].get(dimension), field=f"candidate.{dimension}"
        )
        delta = candidate_value - baseline_value
        differentials[dimension] = delta
        regressed = delta < -limit if direction == "decrease" else delta > limit
        if regressed:
            regressions.append(
                _finding(
                    finding_id=f"rate:{dimension}",
                    dimension=dimension,
                    baseline=baseline_value,
                    candidate=candidate_value,
                    threshold=limit,
                    detail=f"{direction} exceeded allowed absolute rate change",
                )
            )

    baseline_latency = _number(
        baseline_metrics["performance"].get("p95_latency_seconds"),
        field="baseline.p95_latency_seconds",
    )
    candidate_latency = _number(
        candidate_metrics["performance"].get("p95_latency_seconds"),
        field="candidate.p95_latency_seconds",
    )
    latency_delta = candidate_latency - baseline_latency
    latency_limit = max(
        baseline_latency
        * _number(
            rate_config["p95_latency_max_relative_increase"],
            field="p95_latency_max_relative_increase",
        ),
        _number(
            rate_config["p95_latency_max_absolute_increase_seconds"],
            field="p95_latency_max_absolute_increase_seconds",
        ),
    )
    differentials["p95_latency_seconds"] = latency_delta
    if latency_delta > latency_limit:
        regressions.append(
            _finding(
                finding_id="performance:p95_latency_seconds",
                dimension="p95_latency_seconds",
                baseline=baseline_latency,
                candidate=candidate_latency,
                threshold=latency_limit,
                detail="latency degradation exceeded max(relative, absolute) threshold",
            )
        )

    baseline_tokens = _number(
        baseline_metrics["performance"].get("tokens_per_turn"),
        field="baseline.tokens_per_turn",
    )
    candidate_tokens = _number(
        candidate_metrics["performance"].get("tokens_per_turn"),
        field="candidate.tokens_per_turn",
    )
    token_limit = _number(
        rate_config["tokens_per_turn_max_relative_increase"],
        field="tokens_per_turn_max_relative_increase",
    )
    token_relative = (
        (candidate_tokens - baseline_tokens) / baseline_tokens
        if baseline_tokens > 0
        else (0.0 if candidate_tokens == 0 else math.inf)
    )
    differentials["tokens_per_turn_relative"] = token_relative
    accepted_tradeoffs = candidate_metrics.get("accepted_tradeoffs")
    accepted_tradeoffs = (
        accepted_tradeoffs if isinstance(accepted_tradeoffs, list) else []
    )
    token_tradeoff = any(
        isinstance(item, dict)
        and item.get("dimension") == "tokens_per_turn"
        and isinstance(item.get("reason"), str)
        and item["reason"].strip()
        for item in accepted_tradeoffs
    )
    if token_relative > token_limit and not token_tradeoff:
        regressions.append(
            _finding(
                finding_id="performance:tokens_per_turn",
                dimension="tokens_per_turn",
                baseline=baseline_tokens,
                candidate=candidate_tokens,
                threshold=token_limit,
                detail="token increase exceeded threshold without an accepted trade-off",
            )
        )

    baseline_subjective = _subjective_pairs(baseline_metrics)
    candidate_subjective = _subjective_pairs(candidate_metrics)
    subjective_config = thresholds["subjective_non_inferiority"]
    confidence = _number(
        subjective_config["confidence_level"], field="confidence_level"
    )
    minimum = _number(
        subjective_config["lower_bound_minimum"], field="lower_bound_minimum"
    )
    for dimension in sorted(set(baseline_subjective) | set(candidate_subjective)):
        baseline_pairs = baseline_subjective.get(dimension)
        candidate_pairs = candidate_subjective.get(dimension)
        if baseline_pairs is None or candidate_pairs is None or set(
            baseline_pairs
        ) != set(candidate_pairs):
            return {
                "schema_version": 1,
                "eval_spec": EVAL_SPEC,
                "status": "NON_COMPARABLE",
                "identity_mismatches": [f"subjective_pair_set:{dimension}"],
                "regressions": [],
            }
        pair_ids = sorted(baseline_pairs)
        deltas = [candidate_pairs[pair] - baseline_pairs[pair] for pair in pair_ids]
        lower, upper = paired_bootstrap_ci(
            deltas,
            seed=bootstrap_seed + sum(ord(char) for char in dimension),
            samples=bootstrap_samples,
            confidence=confidence,
        )
        mean_delta = sum(deltas) / len(deltas)
        differentials[dimension] = {
            "mean_delta": mean_delta,
            "lower_confidence_bound": lower,
            "upper_confidence_bound": upper,
            "pair_count": len(deltas),
        }
        if lower <= minimum:
            finding = _finding(
                finding_id=f"subjective:{dimension}",
                dimension=dimension,
                baseline=sum(baseline_pairs.values()) / len(baseline_pairs),
                candidate=sum(candidate_pairs.values()) / len(candidate_pairs),
                threshold=minimum,
                detail="paired subjective lower confidence bound failed non-inferiority",
            )
            finding.update(
                {
                    "mean_delta": mean_delta,
                    "lower_confidence_bound": lower,
                    "upper_confidence_bound": upper,
                    "pair_count": len(deltas),
                }
            )
            regressions.append(finding)

    return {
        "schema_version": 1,
        "eval_spec": EVAL_SPEC,
        "status": "FAIL" if regressions else "PASS",
        "identity_mismatches": [],
        "regressions": regressions,
        "differentials": differentials,
        "baseline_manifest": str(baseline_manifest_path),
        "candidate_manifest": str(candidate_manifest_path),
        "artifact_hashes": {
            "baseline_metric_results": _sha256(baseline_metric_path),
            "candidate_metric_results": _sha256(candidate_metric_path),
        },
    }


def _default_evidence_paths(
    *,
    baseline_root: Path,
    candidate_root: Path,
    include_metrics: bool,
) -> list[str]:
    paths: list[str] = []
    for root in (baseline_root, candidate_root):
        completeness = root / COMPLETENESS_PATH
        if completeness.is_file():
            paths.append(str(completeness))
        if include_metrics:
            metrics = root / METRICS_PATH
            if metrics.is_file():
                paths.append(str(metrics))
    return paths


def _enrich_comparison_payload(
    payload: dict[str, Any],
    *,
    baseline_root: Path,
    candidate_root: Path,
    include_metrics: bool,
) -> dict[str, Any]:
    enriched = dict(payload)
    case_id = None
    candidate_manifest = _read_json(candidate_root / "run-manifest.json")
    if isinstance(candidate_manifest, dict):
        value = candidate_manifest.get("case_id")
        if isinstance(value, str) and value:
            case_id = value
    evidence_paths = _default_evidence_paths(
        baseline_root=baseline_root,
        candidate_root=candidate_root,
        include_metrics=include_metrics,
    )
    regressions = []
    for item in enriched.get("regressions") or []:
        if not isinstance(item, dict):
            continue
        row = dict(item)
        row.setdefault("case_id", case_id)
        row.setdefault("evidence_paths", list(evidence_paths))
        row.setdefault("release_blocking", True)
        if "finding_id" not in row and isinstance(row.get("key"), str):
            row["finding_id"] = row["key"]
        if "dimension" not in row and isinstance(row.get("key"), str):
            row["dimension"] = row["key"]
        regressions.append(row)
    enriched["regressions"] = regressions
    enriched["baseline_root"] = str(baseline_root)
    enriched["candidate_root"] = str(candidate_root)
    return enriched


def render_baseline_comparison_markdown(payload: dict[str, Any]) -> str:
    lines = [
        "# Baseline Comparison",
        "",
        f"- Status: {payload.get('status')}",
        f"- Eval spec: {payload.get('eval_spec', EVAL_SPEC)}",
        f"- Comparison mode: {payload.get('comparison_mode', 'dimension')}",
    ]
    mismatches = payload.get("identity_mismatches") or []
    if mismatches:
        lines.append(f"- Identity mismatches: {', '.join(str(item) for item in mismatches)}")
    lines.extend(["", "## Regressions", ""])
    regressions = list(payload.get("regressions") or [])
    regressions.sort(
        key=lambda item: (
            str(item.get("finding_id") or item.get("key") or ""),
            str(item.get("dimension") or ""),
        )
    )
    if not regressions:
        lines.append("None.")
        lines.append("")
        return "\n".join(lines)
    for item in regressions:
        finding_id = item.get("finding_id") or item.get("key") or "unknown"
        lines.append(f"### {finding_id}")
        lines.append(f"- Dimension: {item.get('dimension')}")
        if item.get("case_id") is not None:
            lines.append(f"- Case ID: {item.get('case_id')}")
        lines.append(f"- Baseline: {item.get('baseline')}")
        lines.append(f"- Candidate: {item.get('candidate')}")
        lines.append(f"- Release blocking: {item.get('release_blocking', True)}")
        evidence = item.get("evidence_paths") or []
        if evidence:
            lines.append(f"- Evidence paths: {', '.join(str(path) for path in evidence)}")
        lines.append("")
    return "\n".join(lines)


def write_baseline_comparison(
    candidate_root: Path | str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    root = Path(candidate_root)
    json_path = root / COMPARISON_JSON
    md_path = root / COMPARISON_MD
    _write_json_atomic(json_path, payload)
    _write_text_atomic(md_path, render_baseline_comparison_markdown(payload))
    hashes = dict(payload.get("artifact_hashes") or {})
    hashes["baseline_comparison_json"] = _sha256(json_path)
    hashes["baseline_comparison_md"] = _sha256(md_path)
    result = dict(payload)
    result["artifact_hashes"] = hashes
    result["baseline_comparison_json"] = str(json_path)
    result["baseline_comparison_md"] = str(md_path)
    _write_json_atomic(json_path, result)
    return result


def compare_cli_runs(
    baseline: Path | str,
    candidate: Path | str,
    *,
    root: Path | str | None = None,
    identity_compare,
) -> dict[str, Any]:
    """Compare runs for the CLI: identity first, then optional dimension gates."""
    repo_root = Path(root) if root is not None else REPO_ROOT
    baseline_manifest = _manifest_path(baseline)
    candidate_manifest = _manifest_path(candidate)
    baseline_root = _run_root(baseline_manifest)
    candidate_root = _run_root(candidate_manifest)

    identity = identity_compare(baseline, candidate)
    if not isinstance(identity, dict):
        raise ValueError("identity compare must return a dict")

    if identity.get("status") == "NON_COMPARABLE":
        payload = _enrich_comparison_payload(
            {**identity, "comparison_mode": "identity"},
            baseline_root=baseline_root,
            candidate_root=candidate_root,
            include_metrics=False,
        )
        return write_baseline_comparison(candidate_root, payload)

    baseline_has = _metrics_present(baseline_root)
    candidate_has = _metrics_present(candidate_root)

    if baseline_has and candidate_has:
        thresholds = load_thresholds(repo_root)
        dimension = compare_evaluation_runs(
            baseline_root, candidate_root, thresholds
        )
        if identity.get("status") == "FAIL":
            merged = dict(dimension)
            regressions = list(merged.get("regressions") or [])
            for item in identity.get("regressions") or []:
                if isinstance(item, dict):
                    regressions.append(dict(item))
            merged["regressions"] = regressions
            merged["status"] = "FAIL"
            merged["identity_hard_gate"] = identity
            dimension = merged
        payload = _enrich_comparison_payload(
            {**dimension, "comparison_mode": "dimension"},
            baseline_root=baseline_root,
            candidate_root=candidate_root,
            include_metrics=True,
        )
        return write_baseline_comparison(candidate_root, payload)

    if not baseline_has and not candidate_has:
        payload = _enrich_comparison_payload(
            {**identity, "comparison_mode": "identity_hard_gate"},
            baseline_root=baseline_root,
            candidate_root=candidate_root,
            include_metrics=False,
        )
        return write_baseline_comparison(candidate_root, payload)

    payload = _enrich_comparison_payload(
        {
            "schema_version": 1,
            "eval_spec": EVAL_SPEC,
            "status": "NON_COMPARABLE",
            "identity_mismatches": ["metric_results_presence_mismatch"],
            "regressions": [],
            "comparison_mode": "dimension",
            "identity_hard_gate": identity,
        },
        baseline_root=baseline_root,
        candidate_root=candidate_root,
        include_metrics=True,
    )
    return write_baseline_comparison(candidate_root, payload)
