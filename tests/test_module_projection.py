from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
STARTER = (
    ROOT / "plugins" / "coc-keeper" / "references"
    / "starter-scenarios" / "the-haunting"
)


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


projection = _load("coc_module_projection_tests", SCRIPTS / "coc_module_projection.py")
module_graph = projection.coc_module_graph


def _starter_graph() -> dict:
    return json.loads(
        (STARTER / "module-graph.json").read_text(encoding="utf-8")
    )


def _synthetic_graph(source_languages: list[str] | None = None) -> dict:
    return {
        "contract_id": module_graph.GRAPH_CONTRACT_ID,
        "schema_version": module_graph.SCHEMA_VERSION,
        "module_id": "module-test-mod",
        "source_languages": source_languages or ["en"],
        "nodes": [
            {
                "node_id": "module-test-mod",
                "node_kind": "module",
                "name": "Test Module",
                "visibility": "keeper-only",
                "aliases": [],
                "summary": "A synthetic module.",
                "properties": {},
                "source_refs": [],
            },
            {
                "node_id": "scene-alpha",
                "node_kind": "scene",
                "name": "Alpha",
                "visibility": "keeper-only",
                "aliases": [],
                "summary": "Opening scene.",
                "properties": {},
                "source_refs": [
                    {"source_id": "pdf:test", "pdf_index": 3, "text_sha256": "x" * 64},
                ],
            },
            {
                "node_id": "scene-beta",
                "node_kind": "scene",
                "name": "Beta",
                "visibility": "keeper-only",
                "aliases": [],
                "summary": "Final scene.",
                "properties": {},
                "source_refs": [],
            },
        ],
        "relations": [],
        "claims": [],
    }


def _story_payload() -> dict:
    return {
        "filename": "story-graph.json",
        "root": {},
        "collections": [
            {
                "name": "scenes",
                "records": [
                    {
                        "node_id": "scene-alpha",
                        "record": {
                            "scene_id": "alpha",
                            "scene_type": "investigation",
                            "is_start": True,
                        },
                    },
                    {
                        "node_id": "scene-beta",
                        "record": {
                            "scene_id": "beta",
                            "scene_type": "climax",
                            "is_final": True,
                        },
                    },
                ],
            }
        ],
    }


def test_embedded_starter_graph_validates_and_projects_identically():
    graph = _starter_graph()

    summary = projection.validate_module_projection(graph)
    assert summary["module_id"] == "module-the-haunting"
    assert summary["complete_document_set"] is True

    projected = projection.project_module_documents(graph)
    assert set(projected) == set(projection.PROJECTED_DOCUMENTS)
    for filename, document in projected.items():
        committed = json.loads((STARTER / filename).read_text(encoding="utf-8"))
        assert document == committed, filename


def test_starter_ir_directory_passes_parity():
    report = projection.check_projection_parity(_starter_graph(), STARTER)
    assert report["status"] == "equal"
    assert set(report["files"].values()) == {"equal"}


def test_sidecar_carrier_round_trips(tmp_path):
    graph = _synthetic_graph()

    sidecar = projection.write_projection_sidecar(
        tmp_path / "runtime-projection.json", graph, [_story_payload()]
    )
    loaded = projection.load_projection_sidecar(
        tmp_path / "runtime-projection.json", graph
    )
    assert loaded == sidecar

    documents = projection.project_module_documents(graph, sidecar)
    assert documents == {
        "story-graph.json": {
            "scenes": [
                {"scene_id": "alpha", "scene_type": "investigation", "is_start": True},
                {"scene_id": "beta", "scene_type": "climax", "is_final": True},
            ]
        }
    }


def test_sidecar_digest_binds_to_exact_graph(tmp_path):
    graph = _synthetic_graph()
    projection.write_projection_sidecar(
        tmp_path / "runtime-projection.json", graph, [_story_payload()]
    )
    graph["nodes"][1]["summary"] = "Edited after attach."

    with pytest.raises(projection.ModuleProjectionError, match="digest"):
        projection.load_projection_sidecar(
            tmp_path / "runtime-projection.json", graph
        )


def test_records_validation_reports_exact_findings():
    graph = _synthetic_graph()
    payload = _story_payload()
    payload["collections"][0]["records"][0]["node_id"] = "scene-missing"
    payload["collections"][0]["records"][1]["record"]["keeper_notes"] = "dead field"

    findings = projection.validate_projection_records(graph, payload)

    codes = {row["code"] for row in findings}
    assert "unknown_node" in codes
    assert "unregistered_fields" in codes
    messages = " ".join(row["message"] for row in findings)
    assert "keeper_notes" in messages


def test_records_validation_guards_source_language():
    payload = _story_payload()
    payload["collections"][0]["records"][0]["record"]["dramatic_question"] = "他们能逃出去吗"

    english = projection.validate_projection_records(_synthetic_graph(["en"]), payload)
    chinese = projection.validate_projection_records(
        _synthetic_graph(["zh-Hans"]), payload
    )

    assert any(row["code"] == "language_contamination" for row in english)
    assert not any(row["code"] == "language_contamination" for row in chinese)


def test_records_validation_rejects_duplicate_binding():
    payload = _story_payload()
    payload["collections"][0]["records"][1]["node_id"] = "scene-alpha"

    findings = projection.validate_projection_records(_synthetic_graph(), payload)

    assert any(row["code"] == "duplicate_node" for row in findings)


def test_projection_packet_is_closed_and_model_safe():
    packet = projection.prepare_projection_packet(
        _synthetic_graph(), "story-graph.json"
    )

    assert packet["contract_id"] == projection.PACKET_CONTRACT_ID
    assert packet["module_id"] == "module-test-mod"
    assert [row["name"] for row in packet["collections"]] == ["scenes"]
    assert "scene_id" in packet["collections"][0]["registered_fields"]

    text = json.dumps(packet)
    assert "sha256" not in text
    assert "grep_anchor" not in text
    assert "x" * 64 not in text
    node_ids = {row["node_id"] for row in packet["nodes"]}
    assert node_ids == {"module-test-mod", "scene-alpha", "scene-beta"}


def test_parity_reports_missing_and_drifted_files(tmp_path):
    graph = _synthetic_graph()
    sidecar = projection.build_projection_sidecar(graph, [_story_payload()])

    report = projection.check_projection_parity(graph, tmp_path, sidecar)
    assert report["files"]["story-graph.json"] == "missing"

    (tmp_path / "story-graph.json").write_text(
        json.dumps({"scenes": []}), encoding="utf-8"
    )
    report = projection.check_projection_parity(graph, tmp_path, sidecar)
    assert report["status"] == "drifted"
    assert report["files"]["story-graph.json"] == "drifted"


def test_empty_projection_never_passes_vacuously():
    graph = _synthetic_graph()

    with pytest.raises(projection.ModuleProjectionError, match="no runtime projection"):
        projection.validate_module_projection(graph)

    with pytest.raises(projection.ModuleProjectionError):
        projection.build_projection_sidecar(graph, [])
