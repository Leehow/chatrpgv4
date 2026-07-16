from __future__ import annotations

import importlib.util
import json
from pathlib import Path


REPO = Path(__file__).resolve().parents[1]
MODULE = REPO / "plugins/coc-keeper/scripts/coc_eval_metrics.py"


def _load():
    spec = importlib.util.spec_from_file_location("coc_eval_metrics_test", MODULE)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload) + "\n", encoding="utf-8")


def _write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8"
    )


def test_metrics_are_derived_from_structured_bound_evidence(tmp_path: Path):
    metrics = _load()
    cell = tmp_path / "lanes/matrix/cells/cell-1"
    _write_json(cell / "run-manifest.json", {
        "hard_findings": [],
        "evaluation_contract_receipt": {"reached_terminal": True},
    })
    _write_json(cell / "playtest/artifacts/report-completeness.json", {
        "passed": True,
        "source_logs_present": True,
        "missing_roll_ids": [],
        "duplicate_roll_ids": [],
        "duplicate_source_roll_ids": [],
        "untraced_roll_ids": [],
        "incomplete_required_public_roll_ids": [],
        "missing_source_comment_roll_ids": [],
        "parse_errors": [],
    })
    _write_jsonl(cell / "keeper-view.jsonl", [
        {"keeper_turn": {
            "scene_id": "scene-a", "choice_frame": {"open_route_ids": ["r1"]},
        }},
        {"keeper_turn": {
            "scene_id": "scene-a", "choice_frame": {"open_route_ids": ["r1"]},
        }},
        {"keeper_turn": {
            "scene_id": "scene-a", "choice_frame": {"open_route_ids": ["r1"]},
            "clue_revealed": ["clue-1"],
        }},
    ])
    rows = []
    for index, (role, duration) in enumerate(
        (("player", 1.0), ("narrator", 2.0), ("player", 3.0), ("narrator", 4.0)),
        1,
    ):
        rows.append({
            "role": role,
            "attempt": index,
            "outcome": "external_success",
            "fallback_kind": "template" if index == 4 else None,
            "duration_seconds": duration,
            "usage": {"input_tokens": 3, "output_tokens": 2},
        })
    _write_jsonl(cell / "runner-invocations.jsonl", rows)
    lanes = {
        "matrix": {
            "cells": [{"judge_gates": [{"status": "PASS"}]}],
        },
        "continuity-25": {
            "turn_count": 2,
            "accepted_turns": [1, 2],
        },
    }

    result = metrics.collect_metric_results(tmp_path, lanes)

    assert result["hard_findings"] == []
    assert result["rates"] == {
        "completion_rate": 1.0,
        "stuck_turn_rate": 0.333333,
        "fallback_rate": 0.25,
    }
    assert result["performance"] == {
        "p95_latency_seconds": 3.85,
        "tokens_per_turn": 10.0,
    }
    assert result["coverage"]["semantic_judge_gates"] == {"PASS": 1}
    assert result["subjective"] == {}
    assert {row["path"] for row in result["sources"]} >= {
        "lanes/matrix/cells/cell-1/run-manifest.json",
        "lanes/matrix/cells/cell-1/keeper-view.jsonl",
        "lanes/matrix/cells/cell-1/runner-invocations.jsonl",
    }


def test_metrics_map_dice_completeness_failures_to_canonical_hard_findings(
    tmp_path: Path,
):
    metrics = _load()
    cell = tmp_path / "lanes/matrix/cells/cell-1"
    _write_json(cell / "run-manifest.json", {
        "hard_findings": [],
        "evaluation_contract_receipt": {"reached_terminal": False},
    })
    _write_json(cell / "playtest/artifacts/report-completeness.json", {
        "passed": False,
        "source_logs_present": False,
        "missing_roll_ids": ["r1"],
        "duplicate_roll_ids": ["r2"],
        "duplicate_source_roll_ids": [],
        "untraced_roll_ids": ["r3"],
        "incomplete_required_public_roll_ids": ["r4"],
        "missing_source_comment_roll_ids": [],
        "parse_errors": ["rolls.jsonl:2"],
    })
    _write_jsonl(cell / "keeper-view.jsonl", [])
    _write_jsonl(cell / "runner-invocations.jsonl", [])

    result = metrics.collect_metric_results(tmp_path, {"matrix": {"cells": []}})
    findings = {
        row["finding_id"]: row["count"] for row in result["hard_findings"]
    }

    assert findings == {
        "duplicate_rendered_roll": 1,
        "malformed_evidence_jsonl": 3,
        "missing_required_public_roll": 1,
        "untraced_rendered_roll": 1,
    }
    assert result["rates"]["completion_rate"] == 0.0


def test_write_metric_results_uses_canonical_artifact_path(tmp_path: Path):
    metrics = _load()
    payload = metrics.collect_metric_results(tmp_path, {})

    path = metrics.write_metric_results(tmp_path, payload)

    assert path == tmp_path / "artifacts/metric-results.json"
    assert json.loads(path.read_text(encoding="utf-8")) == payload
