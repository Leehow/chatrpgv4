from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path

import pytest


REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / "plugins" / "coc-keeper" / "scripts" / "coc_playtest_route_compare.py"


def _load():
    spec = importlib.util.spec_from_file_location("coc_playtest_route_compare_test", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _ledger(*, scenes, edges):
    return {
        "scenes": [{"scene_id": scene_id} for scene_id in scenes],
        "edges": [{"edge_id": edge_id} for edge_id in edges],
        "choices": [],
    }


def test_route_compare_requires_exact_classification_coverage(tmp_path):
    compare = _load()
    run_a = _ledger(
        scenes=["harbor", "museum", "optional-attic"],
        edges=["harbor->museum", "museum->attic"],
    )
    run_b = _ledger(scenes=["harbor", "museum"], edges=["harbor->museum"])
    request = compare.build_route_comparison_request(run_a, run_b)
    result = {
        "evaluator_id": "codex-route-compare-v1",
        "request_sha256": compare.request_sha256(request),
        "classification_method": "artifact_mediated_semantic",
        "classifications": [
            {
                "route_kind": "scene",
                "route_id": "optional-attic",
                "classification": "optional",
                "evidence_refs": ["scene:optional-attic", "turn:12"],
                "reason": "Side room with no critical conclusion dependency.",
            },
            {
                "route_kind": "edge",
                "route_id": "museum->attic",
                "classification": "insufficiently_signposted",
                "evidence_refs": ["edge:museum->attic", "affordance:ladder"],
                "reason": "Blind player never saw a structured ladder affordance.",
            },
        ],
    }
    outcome = compare.compare_routes(tmp_path, run_a, run_b, result, request=request)
    assert (tmp_path / "artifacts" / "route-comparison.json").is_file()
    assert (tmp_path / "artifacts" / "route-comparison.md").is_file()
    assert len(outcome["comparison"]["classifications"]) == 2


def test_route_compare_rejects_missing_or_duplicate_classifications():
    compare = _load()
    run_a = _ledger(scenes=["a", "b"], edges=["a->b"])
    run_b = _ledger(scenes=["a"], edges=[])
    request = compare.build_route_comparison_request(run_a, run_b)
    base = {
        "evaluator_id": "codex-route-compare-v1",
        "request_sha256": compare.request_sha256(request),
        "classification_method": "artifact_mediated_semantic",
        "classifications": [
            {
                "route_kind": "scene",
                "route_id": "b",
                "classification": "reasonably_undiscovered",
                "evidence_refs": ["scene:b"],
                "reason": "Never entered.",
            }
        ],
    }
    with pytest.raises(ValueError, match="exactly once"):
        compare.validate_route_comparison_result(request, base)

    base["classifications"].append(
        {
            "route_kind": "edge",
            "route_id": "a->b",
            "classification": "mechanically_blocked",
            "evidence_refs": ["edge:a->b"],
            "reason": "Locked door without key.",
        }
    )
    valid = compare.validate_route_comparison_result(request, base)
    assert len(valid["classifications"]) == 2

    dup = json.loads(json.dumps(base))
    dup["classifications"].append(dup["classifications"][0])
    with pytest.raises(ValueError, match="duplicate"):
        compare.validate_route_comparison_result(request, dup)


def test_route_compare_rejects_keyword_method_and_bad_request_sha():
    compare = _load()
    run_a = _ledger(scenes=["a", "b"], edges=[])
    run_b = _ledger(scenes=["a"], edges=[])
    request = compare.build_route_comparison_request(run_a, run_b)
    keyword = {
        "evaluator_id": "local-keyword",
        "request_sha256": compare.request_sha256(request),
        "classification_method": "keyword",
        "classifications": [
            {
                "route_kind": "scene",
                "route_id": "b",
                "classification": "optional",
                "evidence_refs": ["scene:b"],
                "reason": "matched optional",
            }
        ],
    }
    with pytest.raises(ValueError, match="keyword"):
        compare.validate_route_comparison_result(request, keyword)

    bad_sha = {
        "evaluator_id": "codex-route-compare-v1",
        "request_sha256": "0" * 64,
        "classification_method": "artifact_mediated_semantic",
        "classifications": keyword["classifications"],
    }
    with pytest.raises(ValueError, match="request_sha256"):
        compare.validate_route_comparison_result(request, bad_sha)


def test_route_compare_requires_nonempty_reason_and_evidence():
    compare = _load()
    run_a = _ledger(scenes=["a", "b"], edges=[])
    run_b = _ledger(scenes=["a"], edges=[])
    request = compare.build_route_comparison_request(run_a, run_b)
    result = {
        "evaluator_id": "codex-route-compare-v1",
        "request_sha256": compare.request_sha256(request),
        "classification_method": "semantic_evaluator",
        "classifications": [
            {
                "route_kind": "scene",
                "route_id": "b",
                "classification": "optional",
                "evidence_refs": [],
                "reason": "   ",
            }
        ],
    }
    with pytest.raises(ValueError, match="evidence_refs"):
        compare.validate_route_comparison_result(request, result)
