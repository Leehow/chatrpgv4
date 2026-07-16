from __future__ import annotations

import importlib.util
import json
import subprocess
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
ADAPTER_PATH = ROOT / "runtime/adapters/compiler/adapter.py"
PROMPT_PATH = ROOT / "runtime/adapters/compiler/scenario_compile_prompt.mjs"


def _load_adapter():
    spec = importlib.util.spec_from_file_location("scenario_compile_adapter_test", ADAPTER_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


adapter = _load_adapter()


def _request() -> dict:
    return {
        "schema_version": 1,
        "module_identity": {"scenario_id": "test"},
        "source": {"source_id": "pdf:test"},
        "pages": [{"pdf_index": 1, "text": "source"}],
        "required_files": ["story-graph.json", "clue-graph.json"],
        "compile_contract": {"truth": "structured"},
    }


def _prompt(request: dict) -> str:
    program = """
const { buildPrompt } = await import(process.argv[1]);
process.stdout.write(buildPrompt(JSON.parse(process.argv[2])));
"""
    completed = subprocess.run(
        [
            "node", "--input-type=module", "--eval", program,
            PROMPT_PATH.as_uri(), json.dumps(request),
        ],
        capture_output=True,
        text=True,
        check=False,
        cwd=ROOT,
    )
    assert completed.returncode == 0, completed.stderr
    return completed.stdout


def test_adapter_preserves_bounded_structured_revision_feedback():
    request = {
        **_request(),
        "revision_attempt": 4,
        "parent_attempt": 2,
        "best_attempt": 2,
        "parent_bundle_sha256": "a" * 64,
        "previous_scenario_bundle": {"story-graph.json": {}, "clue-graph.json": {}},
        "validation_findings": [{
            "code": "broken_reference",
            "severity": "error",
            "path": "story_graph.scenes[2].available_clues",
            "details": {"ref_id": "survey_maps", "owner_id": "archive"},
        }],
        "regression_findings": [],
        "reference_snapshot": {
            "available_clue_references": [{
                "scene_id": "archive", "clue_id": "survey_maps", "resolves": False,
            }],
        },
        "revision_lineage": [{"attempt": 1}, {"attempt": 2}, {"attempt": 3}],
    }

    prepared = adapter.prepare_compile_request(request)

    assert prepared["validation_findings"] == request["validation_findings"]
    assert prepared["parent_bundle_sha256"] == "a" * 64
    assert prepared["previous_scenario_bundle"] == request["previous_scenario_bundle"]


@pytest.mark.parametrize("attempt", [1, 6])
def test_adapter_rejects_revision_attempt_outside_internal_budget(attempt):
    with pytest.raises(ValueError, match="2 through 5"):
        adapter.prepare_compile_request({**_request(), "revision_attempt": attempt})


def test_adapter_rejects_boolean_parent_attempt():
    with pytest.raises(ValueError, match="parent_attempt"):
        adapter.prepare_compile_request({
            **_request(),
            "revision_attempt": 3,
            "parent_attempt": True,
        })


def test_adapter_rejects_oversized_previous_bundle_without_echoing_content():
    marker = "private-parent-sentinel-"
    request = {
        **_request(),
        "revision_attempt": 2,
        "previous_scenario_bundle": {
            "blob": marker + "x" * adapter.MAX_PARENT_BUNDLE_BYTES,
        },
    }

    with pytest.raises(ValueError, match="previous_scenario_bundle exceeds byte limit") as exc:
        adapter.prepare_compile_request(request)

    assert marker not in str(exc.value)


def test_adapter_rejects_oversized_total_revision_request_without_truncation():
    parent_padding = "x" * (adapter.MAX_PARENT_BUNDLE_BYTES - 100)
    source_padding = "y" * (
        adapter.MAX_REVISION_REQUEST_BYTES - adapter.MAX_PARENT_BUNDLE_BYTES + 1_000
    )
    request = {
        **_request(),
        "revision_attempt": 2,
        "source": {"source_id": "pdf:test", "private_padding": source_padding},
        "previous_scenario_bundle": {"blob": parent_padding},
    }

    with pytest.raises(
        ValueError, match="scenario compile revision request exceeds byte limit"
    ):
        adapter.prepare_compile_request(request)

    assert request["previous_scenario_bundle"]["blob"] == parent_padding
    assert request["source"]["private_padding"] == source_padding


def test_runner_prompt_uses_structured_best_parent_contract_and_exact_clue_self_check():
    request = {
        **_request(),
        "revision_attempt": 4,
        "parent_attempt": 2,
        "best_attempt": 2,
        "parent_bundle_sha256": "b" * 64,
        "previous_scenario_bundle": {"marker": "attempt-2-best"},
        "validation_findings": [{
            "code": "broken_reference", "severity": "error",
            "path": "story_graph.scenes[0].available_clues",
            "details": {"ref_id": "hunter_artist_camp"},
        }],
        "regression_findings": [{
            "code": "broken_reference", "severity": "error",
            "path": "story_graph.scenes[3].available_clues",
            "details": {"ref_id": "survey_maps"},
        }],
        "reference_snapshot": {"available_clue_reference_count": 9},
        "regression_reference_snapshot": {"available_clue_reference_count": 10},
        "revision_lineage": [{"attempt": 1}, {"attempt": 2}, {"attempt": 3}],
    }

    prompt = _prompt(request)

    assert "best validated parent so far" in prompt
    assert "Preserve every valid object, ID" in prompt
    assert "complete set of story-graph available_clues" in prompt
    assert '"marker": "attempt-2-best"' in prompt
    assert '"ref_id": "hunter_artist_camp"' in prompt
    assert '"regression_findings"' in prompt
    assert '"parent_bundle_sha256": "' + "b" * 64 + '"' in prompt
