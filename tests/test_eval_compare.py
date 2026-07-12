from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path


REPO = Path(__file__).resolve().parents[1]
MODULE_PATH = REPO / "plugins" / "coc-keeper" / "scripts" / "coc_eval_compare.py"


def _load():
    assert MODULE_PATH.is_file(), f"missing implementation module: {MODULE_PATH}"
    spec = importlib.util.spec_from_file_location("coc_eval_compare_test", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules["coc_eval_compare_test"] = module
    spec.loader.exec_module(module)
    return module


def _write(path: Path, payload: object) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return path


def _identity(*, benchmark_version: str = "2026.07.1") -> dict:
    return {
        "schema_version": 1,
        "eval_spec": "eval-spec-v1",
        "benchmark_version": benchmark_version,
        "report_schema_version": 2,
        "case_id": "matrix:fixture",
        "seed": 42,
        "initial_state_sha256": "state-a",
        "kp_model": {"provider": "fixture", "id": "kp-1"},
        "player_model": {"provider": "fixture", "id": "player-1"},
        "prompt_hashes": {"kp": "a" * 64, "player": "b" * 64},
        "runner_hashes": {"kp": "c" * 64, "player": "d" * 64},
        "case_ids": ["case-a", "case-b"],
        "persona_ids": ["careful-investigator"],
        "seeds": [42, 43],
    }


def _metrics(**overrides) -> dict:
    value = {
        "schema_version": 1,
        "hard_findings": [],
        "rates": {
            "completion_rate": 0.90,
            "stuck_turn_rate": 0.10,
            "fallback_rate": 0.05,
        },
        "performance": {
            "p95_latency_seconds": 2.0,
            "tokens_per_turn": 100.0,
        },
        "subjective": {
            "player_agency": [
                {"pair_id": "p1", "score": 4.0},
                {"pair_id": "p2", "score": 4.0},
                {"pair_id": "p3", "score": 4.0},
                {"pair_id": "p4", "score": 4.0},
            ]
        },
        "accepted_tradeoffs": [],
    }
    value.update(overrides)
    return value


def _run(root: Path, name: str, *, identity=None, metrics=None) -> Path:
    run = root / name
    _write(run / "run-manifest.json", identity or _identity())
    _write(run / "artifacts" / "metric-results.json", metrics or _metrics())
    _write(run / "artifacts" / "report-completeness.json", {"passed": True})
    _write(run / "case-results.json", {"status": "PASS", "cases": []})
    return run


def test_paired_bootstrap_ci_is_seeded_and_contains_mean():
    compare = _load()
    deltas = [0.0, 0.2, -0.1, 0.1, 0.0, 0.2]

    first = compare.paired_bootstrap_ci(
        deltas, seed=23, samples=2000, confidence=0.95
    )
    second = compare.paired_bootstrap_ci(
        deltas, seed=23, samples=2000, confidence=0.95
    )

    assert first == second
    lower, upper = first
    mean = sum(deltas) / len(deltas)
    assert lower <= mean <= upper


def test_compare_rejects_identity_mismatch(tmp_path: Path):
    compare = _load()
    baseline = _run(tmp_path, "baseline")
    candidate = _run(
        tmp_path,
        "candidate",
        identity=_identity(benchmark_version="2026.08.0"),
    )

    result = compare.compare_evaluation_runs(
        baseline, candidate, compare.load_thresholds(REPO)
    )

    assert result["status"] == "NON_COMPARABLE"
    assert "benchmark_version" in result["identity_mismatches"]


def test_hard_gate_regression_is_zero_tolerance(tmp_path: Path):
    compare = _load()
    baseline = _run(tmp_path, "baseline")
    candidate = _run(
        tmp_path,
        "candidate",
        metrics=_metrics(hard_findings=[{"finding_id": "secret_leak", "count": 1}]),
    )

    result = compare.compare_evaluation_runs(
        baseline, candidate, compare.load_thresholds(REPO)
    )

    assert result["status"] == "FAIL"
    hard = next(reg for reg in result["regressions"] if reg["dimension"] == "hard_gate")
    assert hard["finding_id"] == "secret_leak"
    assert hard["release_blocking"] is True


def test_subjective_lower_confidence_bound_below_margin_fails(tmp_path: Path):
    compare = _load()
    baseline = _run(tmp_path, "baseline")
    candidate_subjective = {
        "player_agency": [
            {"pair_id": "p1", "score": 3.4},
            {"pair_id": "p2", "score": 3.5},
            {"pair_id": "p3", "score": 3.6},
            {"pair_id": "p4", "score": 3.4},
        ]
    }
    candidate = _run(
        tmp_path,
        "candidate",
        metrics=_metrics(subjective=candidate_subjective),
    )

    result = compare.compare_evaluation_runs(
        baseline, candidate, compare.load_thresholds(REPO), bootstrap_seed=7
    )

    assert result["status"] == "FAIL"
    regression = next(
        reg for reg in result["regressions"] if reg["dimension"] == "player_agency"
    )
    assert regression["lower_confidence_bound"] <= -0.25


def test_latency_change_within_max_relative_or_absolute_threshold_passes(
    tmp_path: Path,
):
    compare = _load()
    baseline = _run(tmp_path, "baseline")
    candidate = _run(
        tmp_path,
        "candidate",
        metrics=_metrics(
            performance={
                "p95_latency_seconds": 2.8,
                "tokens_per_turn": 110.0,
            }
        ),
    )

    result = compare.compare_evaluation_runs(
        baseline, candidate, compare.load_thresholds(REPO)
    )

    assert result["status"] == "PASS"
    assert result["regressions"] == []


def test_completion_and_fallback_rate_thresholds_are_dimension_specific(
    tmp_path: Path,
):
    compare = _load()
    baseline = _run(tmp_path, "baseline")
    candidate = _run(
        tmp_path,
        "candidate",
        metrics=_metrics(
            rates={
                "completion_rate": 0.83,
                "stuck_turn_rate": 0.10,
                "fallback_rate": 0.12,
            }
        ),
    )

    result = compare.compare_evaluation_runs(
        baseline, candidate, compare.load_thresholds(REPO)
    )

    assert result["status"] == "FAIL"
    assert {item["dimension"] for item in result["regressions"]} >= {
        "completion_rate",
        "fallback_rate",
    }


def test_missing_metric_artifact_is_non_comparable(tmp_path: Path):
    compare = _load()
    baseline = _run(tmp_path, "baseline")
    candidate = _run(tmp_path, "candidate")
    (candidate / "artifacts" / "metric-results.json").unlink()

    result = compare.compare_evaluation_runs(
        baseline, candidate, compare.load_thresholds(REPO)
    )

    assert result["status"] == "NON_COMPARABLE"
    assert "candidate_metric_results_missing_or_malformed" in result["identity_mismatches"]
