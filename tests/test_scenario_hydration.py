import importlib.util
import hashlib
import json
import shutil
from pathlib import Path

import pytest


def _load():
    path = Path("plugins/coc-keeper/scripts/coc_scenario_hydration.py")
    spec = importlib.util.spec_from_file_location("coc_scenario_hydration_test", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


hydration = _load()
HAUNTING = Path("plugins/coc-keeper/references/starter-scenarios/the-haunting")


def _campaign(tmp_path: Path) -> Path:
    campaign = tmp_path / ".coc" / "campaigns" / "cold"
    (campaign / "scenario").mkdir(parents=True)
    (campaign / "save").mkdir(parents=True)
    (campaign / "logs").mkdir(parents=True)
    (campaign / "save" / "world-state.json").write_text(
        json.dumps({"schema_version": 1, "campaign_id": "cold"}),
        encoding="utf-8",
    )
    return campaign


def _haunting_bundle() -> dict[str, dict]:
    return {
        name: json.loads((HAUNTING / name).read_text(encoding="utf-8"))
        for name in hydration.REQUIRED_FILES
    }


def _retarget_source_refs(value):
    if isinstance(value, list):
        return [_retarget_source_refs(item) for item in value]
    if not isinstance(value, dict):
        return value
    result = {key: _retarget_source_refs(item) for key, item in value.items()}
    if isinstance(result.get("source_refs"), list):
        result["source_refs"] = [{
            "source_id": "pdf:keeper-rulebook",
            "pdf_index": 446,
        } for _item in result["source_refs"]]
    return result


def _source_fixture():
    return ({
        "source_id": "pdf:keeper-rulebook",
        "path": "/private/local/module.pdf",
        "title": "Keeper Rulebook",
        "file_sha256": "a" * 64,
        "page_count": 465,
        "pdf_index_start": 446,
        "pdf_index_end": 446,
    }, [{
        "pdf_index": 446,
        "text": "Keeper-only source text for a local module.",
        "text_sha256": "b" * 64,
    }])


def _bundle_with_dangling_refs(count: int, prefix: str) -> dict[str, dict]:
    bundle = _retarget_source_refs(_haunting_bundle())
    scene = bundle["story-graph.json"]["scenes"][0]
    scene["available_clues"] = [
        *(scene.get("available_clues") or []),
        *(f"{prefix}-{index}" for index in range(count)),
    ]
    return bundle


def test_valid_campaign_is_warm_hit_without_compiler(tmp_path):
    campaign = _campaign(tmp_path)
    for name in hydration.REQUIRED_FILES:
        shutil.copy2(HAUNTING / name, campaign / "scenario" / name)

    receipt = hydration.ensure_scenario_ready(
        campaign,
        compiler=lambda _request: pytest.fail("warm hit must not compile source"),
    )

    assert receipt["status"] == "PASS"
    assert receipt["mode"] == "warm_validated"
    assert receipt["cache"] == "campaign"
    assert (campaign / "scenario" / "resolution-receipt.json").is_file()


def test_warm_check_does_not_rewrite_identical_resolution_receipt(tmp_path):
    campaign = _campaign(tmp_path)
    for name in hydration.REQUIRED_FILES:
        shutil.copy2(HAUNTING / name, campaign / "scenario" / name)
    hydration.ensure_scenario_ready(campaign)
    path = campaign / "scenario" / "resolution-receipt.json"
    before = path.read_bytes()

    receipt = hydration.ensure_scenario_ready(campaign)

    assert path.read_bytes() == before
    assert receipt["mode"] == "warm_validated"
    assert receipt["persisted_receipt_mode"] == "warm_validated"


def test_missing_ir_uses_exact_builtin_cache_and_persists(tmp_path):
    campaign = _campaign(tmp_path)
    (campaign / "scenario" / "scenario.json").write_text(
        json.dumps({
            "schema_version": 1,
            "scenario_id": "the-haunting",
            "title": "The Haunting",
            "source": {},
        }),
        encoding="utf-8",
    )

    receipt = hydration.ensure_scenario_ready(
        campaign,
        compiler=lambda _request: pytest.fail("exact cache hit must not compile source"),
    )

    assert receipt["mode"] == "cold_cache_install"
    assert receipt["cache"] == "builtin_starter"
    assert hydration._validation(campaign / "scenario")["ok"] is True
    world = json.loads((campaign / "save" / "world-state.json").read_text())
    assert world["active_scene_id"]


def test_source_first_compiles_keeper_pages_validates_and_warms(tmp_path, monkeypatch):
    campaign = _campaign(tmp_path)
    (campaign / "scenario" / "scenario.json").write_text(
        json.dumps({
            "schema_version": 1,
            "scenario_id": "the-haunting",
            "title": "The Haunting",
            "resolution_policy": "source_first",
            "source": {"path": "/private/local/module.pdf", "pdf_index_start": 446},
        }),
        encoding="utf-8",
    )
    source = {
        "source_id": "pdf:keeper-rulebook",
        "path": "/private/local/module.pdf",
        "title": "Keeper Rulebook",
        "file_sha256": "a" * 64,
        "page_count": 465,
        "pdf_index_start": 446,
        "pdf_index_end": 446,
    }
    pages = [{
        "pdf_index": 446,
        "text": "Keeper-only source text for a local module.",
        "text_sha256": hashlib.sha256(
            b"Keeper-only source text for a local module."
        ).hexdigest(),
    }]
    monkeypatch.setattr(hydration, "_extract_source", lambda _seed: (source, pages))
    calls = []

    def compile_source(request):
        calls.append(request)
        assert request["pages"][0]["text"].startswith("Keeper-only")
        assert request["compile_contract"]["player_boundary"].startswith("raw source")
        return {
            "ok": True,
            "scenario_bundle": _retarget_source_refs(_haunting_bundle()),
            "model_identity": {"provider": "fixture", "id": "semantic-compiler"},
        }

    cold = hydration.ensure_scenario_ready(campaign, compiler=compile_source)
    warm = hydration.ensure_scenario_ready(
        campaign,
        compiler=lambda _request: pytest.fail("persisted IR must be reused"),
    )

    assert len(calls) == 1
    assert cold["mode"] == "cold_source_compile"
    assert cold["source_pdf_indices"] == [446]
    assert warm["mode"] == "warm_validated"
    assert hydration._validation(campaign / "scenario")["ok"] is True
    request_receipt = campaign / "logs" / "scenario-resolution" / f"{cold['request_sha256']}.json"
    assert "Keeper-only source text" not in request_receipt.read_text(encoding="utf-8")
    segments = (campaign / "index" / "evidence-segments.jsonl").read_text(encoding="utf-8")
    assert "Keeper-only source text" in segments


def test_cold_source_compile_installs_epistemic_sidecars_in_same_publish(tmp_path, monkeypatch):
    campaign = _campaign(tmp_path)
    (campaign / "scenario" / "scenario.json").write_text(json.dumps({
        "schema_version": 1,
        "scenario_id": "the-haunting",
        "title": "The Haunting",
        "resolution_policy": "source_first",
        "source": {"path": "/private/local/module.pdf", "pdf_index_start": 446},
    }), encoding="utf-8")
    source = {
        "source_id": "pdf:keeper-rulebook", "path": "/private/local/module.pdf",
        "title": "Keeper Rulebook", "file_sha256": "a" * 64,
        "page_count": 465, "pdf_index_start": 446, "pdf_index_end": 446,
    }
    pages = [{
        "pdf_index": 446,
        "text": "Keeper-only source text that must not enter the sidecar request.",
        "text_sha256": "b" * 64,
    }]
    monkeypatch.setattr(hydration, "_extract_source", lambda _seed: (source, pages))
    seen = {}

    def compile_epistemic(request):
        seen["request"] = request
        digest = hydration.coc_epistemic_compile.request_sha256(request)
        return {
            "ok": True,
            "model_identity": {"provider": "fixture", "id": "epistemic"},
            "compile_result": {
                "schema_version": 1,
                "evaluator_id": hydration.coc_epistemic_compile.EVALUATOR_ID,
                "evaluation_provenance": {
                    "kind": "llm",
                    "request_sha256": digest,
                    "reviewed_artifact": hydration.coc_epistemic_compile.REQUEST_FILENAME,
                },
                "epistemic_graph": {"schema_version": 2, "questions": [], "evidence_links": []},
                "reveal_contracts": {"schema_version": 2, "contracts": []},
                "compile_confidence": {"schema_version": 1, "default_threshold": 0.8, "nodes": []},
                "reasons": {},
            },
        }

    receipt = hydration.ensure_scenario_ready(
        campaign,
        compiler=lambda _request: {
            "ok": True,
            "scenario_bundle": _retarget_source_refs(_haunting_bundle()),
        },
        epistemic_compiler=compile_epistemic,
        compile_epistemic_sidecars=True,
    )

    assert receipt["epistemic_sidecars"]["status"] == "PASS"
    assert all((campaign / "scenario" / name).is_file() for name in hydration.EPISTEMIC_FILES)
    assert "Keeper-only source text" not in json.dumps(seen["request"], ensure_ascii=False)


def test_invalid_compiler_bundle_is_rejected_without_partial_install(tmp_path, monkeypatch):
    campaign = _campaign(tmp_path)
    marker = campaign / "scenario" / "scenario.json"
    marker.write_text(json.dumps({
        "scenario_id": "unknown-module",
        "resolution_policy": "source_first",
        "source": {"path": "/private/local/module.pdf", "pdf_index_start": 0},
    }), encoding="utf-8")
    monkeypatch.setattr(hydration, "_extract_source", lambda _seed: (
        {
            "source_id": "pdf:unknown", "path": "/private/local/module.pdf",
            "title": "Unknown", "file_sha256": "a" * 64, "page_count": 1,
            "pdf_index_start": 0, "pdf_index_end": 0,
        },
        [{"pdf_index": 0, "text": "source", "text_sha256": "b" * 64}],
    ))
    bad = _haunting_bundle()
    bad.pop("story-graph.json")

    with pytest.raises(hydration.ScenarioHydrationError, match="bundle keys"):
        hydration.ensure_scenario_ready(
            campaign, compiler=lambda _request: {"ok": True, "scenario_bundle": bad},
            max_compile_attempts=1,
        )

    assert json.loads(marker.read_text(encoding="utf-8"))["scenario_id"] == "unknown-module"
    assert not (campaign / "scenario" / "module-meta.json").exists()


def test_printed_page_range_is_not_guessed():
    with pytest.raises(hydration.ScenarioHydrationError, match="never guessed"):
        hydration._source_page_bounds({"page_start": 435, "page_end": 450}, 465)


def test_compiler_global_clue_aliases_normalize_without_prose_matching():
    bundle = {"clue-graph.json": {
        "conclusions": [{
            "conclusion_id": "truth",
            "critical": True,
            "minimum_routes": 1,
            "clue_ids": ["clue-a"],
        }],
        "clues": [{
            "clue_id": "clue-a",
            "summary": "Player-safe observation.",
            "route_id": "archive",
            "source_refs": [{"source_id": "pdf:x", "pdf_index": 1}],
        }],
    }}

    normalized = hydration._normalize_compiler_bundle(bundle)
    graph = normalized["clue-graph.json"]
    clue = graph["conclusions"][0]["clues"][0]

    assert "clues" not in graph
    assert graph["conclusions"][0]["importance"] == "critical"
    assert clue["delivery"] == "archive"
    assert clue["delivery_kind"] == "direct"
    assert clue["player_safe_summary"] == "Player-safe observation."


def test_compiler_scene_edge_aliases_normalize_without_prose_matching():
    bundle = {"story-graph.json": {"scenes": [{
        "scene_id": "intro",
        "edges": [{"to_scene_id": "archive"}],
    }, {
        "scene_id": "archive",
        "edges": [],
    }]}}

    normalized = hydration._normalize_compiler_bundle(bundle)
    scenes = normalized["story-graph.json"]["scenes"]

    assert "edges" not in scenes[0]
    assert scenes[0]["scene_edges"] == [{
        "to": "archive",
        "kind": "route",
        "when": {"kind": "always"},
    }]
    assert scenes[1]["scene_edges"] == []


def test_new_compile_promotes_structured_unreachable_and_untraceable_warnings():
    promoted = hydration._blocking_compile_findings([
        {"code": "unreachable_scene", "severity": "warning", "path": "scene/a"},
        {"code": "missing_origin", "severity": "warning", "path": "scene/b"},
        {"code": "missing_delivery_skill", "severity": "warning", "path": "clue/c"},
        {"code": "thin_affordances", "severity": "warning", "path": "scene/d"},
    ])

    assert len(promoted) == 3
    assert {item["code"] for item in promoted} == {
        "unreachable_scene", "missing_origin", "missing_delivery_skill",
    }


def test_base_revision_uses_best_parent_after_regression_and_then_passes(tmp_path, monkeypatch):
    campaign = _campaign(tmp_path)
    (campaign / "scenario" / "scenario.json").write_text(json.dumps({
        "scenario_id": "best-parent",
        "resolution_policy": "source_first",
        "source": {"path": "/private/local/module.pdf", "pdf_index_start": 446},
    }), encoding="utf-8")
    monkeypatch.setattr(hydration, "_extract_source", lambda _seed: _source_fixture())
    candidates = [
        _bundle_with_dangling_refs(13, "attempt-1"),
        _bundle_with_dangling_refs(1, "attempt-2"),
        _bundle_with_dangling_refs(2, "attempt-3"),
    ]
    calls = []

    def compile_source(request):
        calls.append(request)
        if len(calls) <= 3:
            return {"ok": True, "scenario_bundle": candidates[len(calls) - 1]}
        parent = json.loads(json.dumps(request["previous_scenario_bundle"]))
        defined = {
            clue["clue_id"]
            for conclusion in parent["clue-graph.json"]["conclusions"]
            for clue in conclusion.get("clues") or []
        }
        for scene in parent["story-graph.json"]["scenes"]:
            scene["available_clues"] = [
                clue_id for clue_id in scene.get("available_clues") or []
                if clue_id in defined
            ]
        return {"ok": True, "scenario_bundle": parent}

    receipt = hydration.ensure_scenario_ready(campaign, compiler=compile_source)

    assert receipt["status"] == "PASS"
    assert receipt["compile_attempts"] == 4
    assert len(calls) == 4
    assert calls[3]["parent_attempt"] == 2
    assert calls[3]["best_attempt"] == 2
    assert calls[3]["previous_scenario_bundle"] == candidates[1]
    assert calls[3]["parent_bundle_sha256"] == hydration._json_digest(candidates[1])
    assert any(
        item.get("details", {}).get("ref_id") == "attempt-2-0"
        and item.get("details", {}).get("owner_id")
        for item in calls[3]["validation_findings"]
    )
    assert [
        item["candidate_score"]["blocking_count"]
        for item in receipt["revision_lineage"]
    ] == [13, 1, 2, 0]
    assert receipt["revision_lineage"][2]["best_attempt_after"] == 2
    assert calls[3]["reference_snapshot"]["available_clue_reference_count"] > 0
    assert any(
        not item["resolves"]
        for item in calls[3]["reference_snapshot"]["available_clue_references"]
    )


def test_rejection_evidence_retains_independent_raw_and_normalized_candidates(tmp_path, monkeypatch):
    campaign = _campaign(tmp_path)
    (campaign / "scenario" / "scenario.json").write_text(json.dumps({
        "scenario_id": "normalization-evidence",
        "resolution_policy": "source_first",
        "source": {"path": "/private/local/module.pdf", "pdf_index_start": 446},
    }), encoding="utf-8")
    monkeypatch.setattr(hydration, "_extract_source", lambda _seed: _source_fixture())
    raw = _bundle_with_dangling_refs(1, "raw-dangling")
    first_scene = raw["story-graph.json"]["scenes"][0]
    original_edges = first_scene.pop("scene_edges")
    first_scene["edges"] = [{
        **{key: value for key, value in edge.items() if key != "to"},
        "to_scene_id": edge["to"],
    } for edge in original_edges]
    calls = []

    def compile_source(request):
        calls.append(request)
        if len(calls) == 1:
            return {"ok": True, "scenario_bundle": raw}
        parent = json.loads(json.dumps(request["previous_scenario_bundle"]))
        defined = {
            clue["clue_id"]
            for conclusion in parent["clue-graph.json"]["conclusions"]
            for clue in conclusion.get("clues") or []
        }
        for scene in parent["story-graph.json"]["scenes"]:
            scene["available_clues"] = [
                clue_id for clue_id in scene.get("available_clues") or []
                if clue_id in defined
            ]
        return {"ok": True, "scenario_bundle": parent}

    receipt = hydration.ensure_scenario_ready(campaign, compiler=compile_source)
    evidence_path = next(
        (campaign / "logs/scenario-resolution").glob("*.rejected-1.json")
    )
    evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
    raw_evidence = evidence["raw_scenario_bundle"]
    normalized_evidence = evidence["scenario_bundle"]

    assert receipt["status"] == "PASS"
    assert evidence["visibility"] == "keeper_only"
    assert raw_evidence is not normalized_evidence
    assert raw_evidence != normalized_evidence
    assert "edges" in raw_evidence["story-graph.json"]["scenes"][0]
    assert "scene_edges" not in raw_evidence["story-graph.json"]["scenes"][0]
    assert "edges" not in normalized_evidence["story-graph.json"]["scenes"][0]
    assert "scene_edges" in normalized_evidence["story-graph.json"]["scenes"][0]
    assert hydration._json_digest(raw_evidence) == evidence["raw_bundle_sha256"]
    assert hydration._json_digest(normalized_evidence) == evidence["normalized_bundle_sha256"]
    assert calls[1]["previous_scenario_bundle"] == normalized_evidence
    assert calls[1]["previous_scenario_bundle"] != raw_evidence
    assert calls[1]["parent_bundle_sha256"] == evidence["normalized_bundle_sha256"]


def test_repeated_missing_origin_findings_keep_exact_distinct_paths():
    findings = hydration.coc_scenario_compile.validate_compiled_scenario({
        "story_graph": {"scenes": [
            {"scene_id": "first"},
            {"scene_id": "second"},
        ]},
    })
    missing = [item for item in findings if item.get("code") == "missing_origin"]

    assert [item["path"] for item in missing] == [
        "story_graph.scenes[0]", "story_graph.scenes[1]",
    ]
    assert [item["details"]["entry_path"] for item in missing] == [
        "story_graph.scenes[0]", "story_graph.scenes[1]",
    ]
    assert len({hydration._finding_identity(item) for item in missing}) == 2


def test_duplicate_clue_finding_keeps_id_and_all_definition_paths():
    findings = hydration.coc_scenario_compile.validate_compiled_scenario({
        "clue_graph": {"conclusions": [{
            "conclusion_id": "first",
            "clues": [{"clue_id": "same"}],
        }, {
            "conclusion_id": "second",
            "clues": [{"clue_id": "same"}],
        }]},
    })
    duplicate = next(item for item in findings if item.get("code") == "duplicate_id")

    assert duplicate["details"] == {
        "entity_kind": "clue",
        "entity_id": "same",
        "definition_paths": [
            "clue_graph.conclusions[first].clues[same]",
            "clue_graph.conclusions[second].clues[same]",
        ],
    }


def test_base_revision_exhausts_all_five_attempts_without_publish_or_epistemic(tmp_path, monkeypatch):
    campaign = _campaign(tmp_path)
    original = {}
    for name in hydration.REQUIRED_FILES:
        shutil.copy2(HAUNTING / name, campaign / "scenario" / name)
        original[name] = (campaign / "scenario" / name).read_bytes()
    monkeypatch.setattr(hydration, "_extract_source", lambda _seed: _source_fixture())
    calls = []

    def compile_source(request):
        calls.append(request)
        return {
            "ok": True,
            "scenario_bundle": _bundle_with_dangling_refs(
                1 if len(calls) != 3 else 2,
                f"attempt-{len(calls)}",
            ),
        }

    with pytest.raises(hydration.ScenarioHydrationError, match="canonical validation"):
        hydration.ensure_scenario_ready(
            campaign,
            compiler=compile_source,
            epistemic_compiler=lambda _request: pytest.fail(
                "epistemic compile must not run for an invalid base bundle"
            ),
            compile_epistemic_sidecars=True,
            force_recompile=True,
        )

    assert len(calls) == 5
    assert all(
        (campaign / "scenario" / name).read_bytes() == original[name]
        for name in hydration.REQUIRED_FILES
    )
    evidence = sorted((campaign / "logs/scenario-resolution").glob("*.rejected-*.json"))
    assert len(evidence) == 5
    records = [json.loads(path.read_text(encoding="utf-8")) for path in evidence]
    assert [record["attempt"] for record in records] == [1, 2, 3, 4, 5]
    assert all(record["scenario_bundle"] for record in records)
    assert all(record["normalized_bundle_sha256"] for record in records)
    assert records[-1]["revision_lineage"][-1]["attempt"] == 5
