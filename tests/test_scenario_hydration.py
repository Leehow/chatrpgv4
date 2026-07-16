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
            campaign, compiler=lambda _request: {"ok": True, "scenario_bundle": bad}
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


def test_new_compile_promotes_unreachable_and_untraceable_warnings():
    promoted = hydration._blocking_compile_warnings([
        "scene 'orphan' is unreachable from start 'intro' (orphan/dead node)",
        "entry missing origin (expected source|inferred|improvised)",
        "clue 'c' has delivery_kind=skill_check but no skill",
        "scene 'intro' has fewer than 2 affordances",
    ])

    assert len(promoted) == 3
    assert all("fewer than 2 affordances" not in item for item in promoted)
