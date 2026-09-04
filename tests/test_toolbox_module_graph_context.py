"""Public toolbox behavior for campaign-bound ModuleGraph source context."""
from __future__ import annotations

from toolbox_test_support import *


coc_module_graph = _load(
    "coc_module_graph_for_toolbox_context",
    SCRIPTS / "coc_module_graph.py",
)

SPAN_ID = "span-mary-page-1-block-1"
SOURCE_ID = "pdf:module-context-demo"
SOURCE_TEXT = "Mary tells the investigators she is looking for her cat."


def _install_source_graph(
    ws: dict,
    *,
    asset_root_id: str = "module-context-demo",
    accepted_aspects: list[str] | None = None,
    bind_source_root: bool = True,
) -> None:
    aspects = list(accepted_aspects or coc_module_graph.COVERAGE_DOMAINS)
    source_sha = hashlib.sha256(SOURCE_TEXT.encode("utf-8")).hexdigest()
    evidence_packet = {
        "contract_id": "coc.module-graph-evidence.v1",
        "schema_version": 1,
        "section_id": "section-mary-cover-story",
        "spans": [{
            "span_id": SPAN_ID,
            "text": SOURCE_TEXT,
            "source_ref": {
                "source_id": SOURCE_ID,
                "pdf_index": 1,
                "grep_anchor": SOURCE_TEXT,
                "text_sha256": source_sha,
            },
        }],
    }
    extraction_packet = {
        "contract_id": "coc.module-graph-extraction-packet.v1",
        "schema_version": 1,
        "module_id": "module-context-demo",
        "section_id": "section-mary-cover-story",
        "section_role": "keeper-background",
        "source_language": "en",
        "aspects": aspects,
        "default_visibility": "keeper-only",
        "approved_player_safe_span_ids": [],
        "known_nodes": [],
        "output_budget": {"max_nodes": 4, "max_relations": 4},
        "evidence_view": coc_module_graph.project_evidence_for_model(
            evidence_packet
        ),
        "page_window": {"first_page": 0, "last_page": 0,
                        "pages_before": 0, "pages_after": 0},
    }
    coverage = {
        domain: "accepted" if domain in aspects else "unresolved"
        for domain in coc_module_graph.COVERAGE_DOMAINS
    }
    candidate = {
        "contract_id": "coc.module-graph-shard.v3",
        "schema_version": 3,
        "module_id": "module-context-demo",
        "section_id": "section-mary-cover-story",
        "source_language": "en",
        "aspects": aspects,
        "evidence_span_ids": [SPAN_ID],
        "coverage": coverage,
        "nodes": [{
            "node_id": "npc-mary",
            "node_kind": "npc",
            "name": "Mary",
            "visibility": "revealable",
            "aliases": [],
            "summary": "A neighbor using a missing-cat story to begin a conversation.",
            "evidence_span_ids": [SPAN_ID],
            "properties": {"stated_goal": "find her cat"},
        }],
        "claims": [],
        "relations": [],
    }
    semantic_review = {
        "contract_id": "coc.module-graph-semantic-review.v1",
        "schema_version": 1,
        "module_id": "module-context-demo",
        "section_id": "section-mary-cover-story",
        "aspects": aspects,
        "verdict": "accepted",
        "checks": {
            "section-role": "pass",
            "coverage": "pass",
            "ordering": "not-applicable",
            "quest-semantics": "not-applicable",
            "epistemic-truth": "pass",
            "source-language": "pass",
            "visibility": "pass",
            "requirements": "not-applicable",
            "absence-vs-unresolved": "pass",
        },
        "findings": [],
    }
    accepted = coc_module_graph.accept_graph_shard(
        extraction_packet,
        evidence_packet,
        candidate,
        semantic_review,
    )
    build_plan = {
        "contract_id": "coc.module-graph-build-plan.v1",
        "schema_version": 1,
        "module_id": "module-context-demo",
        "planned_shards": [{
            "section_id": "section-mary-cover-story",
            "aspects": aspects,
        }],
    }
    page_catalog = {
        (SOURCE_ID, 1): {
            "source_id": SOURCE_ID,
            "pdf_index": 1,
            "text": SOURCE_TEXT,
            "text_sha256": source_sha,
        }
    }
    coc_module_graph.build_module_graph_asset(
        ws["workspace"],
        asset_root_id=asset_root_id,
        build_plan=build_plan,
        accepted_records=[{
            **accepted,
            "evidence_packet": evidence_packet,
        }],
        source_bundles=[{
            "source_id": SOURCE_ID,
            "bundle_sha256": "b" * 64,
            "file_sha256": "f" * 64,
        }],
        page_catalog=page_catalog,
    )
    if bind_source_root:
        scenario_path = ws["campaign_dir"] / "scenario" / "scenario.json"
        scenario = (
            json.loads(scenario_path.read_text(encoding="utf-8"))
            if scenario_path.is_file()
            else {"schema_version": 1}
        )
        scenario["source_cache_asset_root_id"] = asset_root_id
        _write_json(scenario_path, scenario)


def test_module_context_status_uses_bound_graph_and_campaign_language(campaign_ws):
    _install_source_graph(campaign_ws)

    envelope = _run(campaign_ws, "module.context")

    assert envelope["ok"] is True, envelope
    assert envelope["data"] == {
        "schema_version": 1,
        "mode": "status",
        "available": True,
        "module": {
            "module_id": "module-context-demo",
            "graph_contract_id": "coc.module-graph.v3",
            "graph_schema_version": 3,
            "build_status": "complete",
            "source_languages": ["en"],
            "coverage": {
                domain: "accepted"
                for domain in coc_module_graph.COVERAGE_DOMAINS
            },
            "source_gaps": [],
            "missing_shards": [],
        },
        "presentation": {
            "play_language": "zh-Hans",
            "localization_required": True,
            "persistence": "none",
            "authority": "keeper-semantic-presentation",
        },
        "candidates": None,
        "context": None,
        "authority": {
            "source_truth": "module-graph",
            "campaign_applicability": "live-state-and-kp-judgment",
            "semantic_match": False,
            "hard_gate": False,
        },
    }


def test_module_context_search_returns_candidates_without_auto_expansion(campaign_ws):
    _install_source_graph(campaign_ws)

    envelope = _run(campaign_ws, "module.context", {
        "query": "Mary",
        "limit": 3,
    })

    assert envelope["ok"] is True, envelope
    data = envelope["data"]
    assert data["mode"] == "search"
    assert data["available"] is True
    assert data["candidates"] == [{
        "node_id": "npc-mary",
        "node_kind": "npc",
        "name": "Mary",
        "visibility": "revealable",
        "score": 90,
        "matched": "name_or_alias",
    }]
    assert data["context"] is None
    assert data["authority"]["semantic_match"] is False


def test_module_context_expand_returns_model_safe_bounded_source_context(campaign_ws):
    _install_source_graph(campaign_ws)

    envelope = _run(campaign_ws, "module.context", {
        "seed_ids": ["npc-mary"],
        "depth": 0,
    })

    assert envelope["ok"] is True, envelope
    data = envelope["data"]
    assert data["mode"] == "expand"
    assert data["candidates"] is None
    assert [row["node_id"] for row in data["context"]["nodes"]] == [
        "npc-mary"
    ]
    assert data["context"]["nodes"][0]["source_refs"] == [{
        "source_id": SOURCE_ID,
        "pdf_index": 1,
    }]
    encoded = json.dumps(data, ensure_ascii=False, sort_keys=True)
    for forbidden in (
        "text_sha256",
        "grep_anchor",
        "module_graph_sha256",
        "current_generation",
        "module_graph_path",
    ):
        assert forbidden not in encoded
    assert hashlib.sha256(SOURCE_TEXT.encode("utf-8")).hexdigest() not in encoded


def test_module_context_missing_graph_is_not_authoritative_absence(campaign_ws):
    scenario_path = campaign_ws["campaign_dir"] / "scenario" / "scenario.json"
    scenario = (
        json.loads(scenario_path.read_text(encoding="utf-8"))
        if scenario_path.is_file()
        else {"schema_version": 1}
    )
    scenario["source_cache_asset_root_id"] = "not-yet-compiled"
    _write_json(scenario_path, scenario)

    envelope = _run(campaign_ws, "module.context", {"query": "Mary"})

    assert envelope["ok"] is True, envelope
    assert envelope["data"]["available"] is False
    assert envelope["data"]["status"] == "not_compiled"
    assert envelope["data"]["module"] is None
    assert envelope["data"]["candidates"] is None
    assert envelope["data"]["authority"]["semantic_match"] is False
    assert any("unknown" in hint for hint in envelope["hints"])


def test_module_context_invalid_graph_fails_soft_without_leaking_paths(campaign_ws):
    _install_source_graph(campaign_ws)
    graph_root = (
        campaign_ws["workspace"] / ".coc" / "module-assets"
        / "module-context-demo" / "graph"
    )
    manifest = json.loads((graph_root / "manifest.json").read_text(encoding="utf-8"))
    graph_path = graph_root / manifest["module_graph_path"]
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    graph["module_id"] = "module-tampered"
    _write_json(graph_path, graph)

    envelope = _run(campaign_ws, "module.context", {"query": "Mary"})

    assert envelope["ok"] is True, envelope
    assert envelope["data"]["available"] is False
    assert envelope["data"]["status"] == "invalid"
    assert envelope["data"]["diagnostic_codes"] == [
        "installed_graph_digest_mismatch"
    ]
    encoded = json.dumps(envelope, ensure_ascii=False, sort_keys=True)
    assert str(campaign_ws["workspace"]) not in encoded
    assert "module_graph_path" not in encoded
    assert any("unknown" in hint for hint in envelope["hints"])


def test_module_context_search_miss_is_only_missing_from_compiled_scope(campaign_ws):
    _install_source_graph(campaign_ws)

    envelope = _run(campaign_ws, "module.context", {
        "query": "No Such Authored Person",
    })

    assert envelope["ok"] is True, envelope
    assert envelope["data"]["available"] is True
    assert envelope["data"]["mode"] == "search"
    assert envelope["data"]["status"] == "not_found_in_compiled_scope"
    assert envelope["data"]["candidates"] == []
    assert any("not world absence" in hint for hint in envelope["hints"])


def test_module_context_unknown_seed_does_not_guess_a_replacement(campaign_ws):
    _install_source_graph(campaign_ws)

    envelope = _run(campaign_ws, "module.context", {
        "seed_ids": ["npc-marie"],
    })

    assert envelope["ok"] is True, envelope
    assert envelope["data"]["mode"] == "expand"
    assert envelope["data"]["status"] == "seed_not_found"
    assert envelope["data"]["context"]["missing_seed_ids"] == ["npc-marie"]
    assert envelope["data"]["context"]["nodes"] == []
    assert any("exact semantic" in hint for hint in envelope["hints"])


@pytest.mark.parametrize(
    "arguments",
    [
        {"query": ""},
        {"query": "Mary", "seed_ids": ["npc-mary"]},
        {"limit": 3},
        {"query": "Mary", "depth": 1},
        {"seed_ids": ["npc-mary"], "limit": 3},
        {"asset_root_id": "other-module"},
    ],
)
def test_module_context_rejects_ambiguous_mode_arguments(campaign_ws, arguments):
    _install_source_graph(campaign_ws)

    envelope = _run(campaign_ws, "module.context", arguments)

    assert envelope["ok"] is False, envelope
    assert envelope["error"]["code"] == "invalid_param"


def test_module_context_unbound_campaign_preserves_requested_mode(campaign_ws):
    module_meta_path = campaign_ws["campaign_dir"] / "scenario" / "module-meta.json"
    module_meta = json.loads(module_meta_path.read_text(encoding="utf-8"))
    module_meta.pop("handout_asset_root_id", None)
    module_meta.pop("module_graph_asset_root_id", None)
    _write_json(module_meta_path, module_meta)

    envelope = _run(campaign_ws, "module.context", {"query": "Mary"})

    assert envelope["ok"] is True, envelope
    assert envelope["data"]["mode"] == "search"
    assert envelope["data"]["available"] is False
    assert envelope["data"]["status"] == "unbound"
    assert envelope["data"]["candidates"] is None


def test_module_context_partial_graph_keeps_unresolved_domains_explicit(campaign_ws):
    _install_source_graph(
        campaign_ws,
        accepted_aspects=["actors", "knowledge"],
    )

    envelope = _run(campaign_ws, "module.context")

    assert envelope["ok"] is True, envelope
    module = envelope["data"]["module"]
    assert module["build_status"] == "partial"
    assert module["coverage"]["actors"] == "accepted"
    assert module["coverage"]["knowledge"] == "accepted"
    assert module["source_gaps"] == sorted(
        set(coc_module_graph.COVERAGE_DOMAINS) - {"actors", "knowledge"}
    )


def test_module_context_localization_contract_does_not_persist_translation(campaign_ws):
    _install_source_graph(campaign_ws)
    graph_root = (
        campaign_ws["workspace"] / ".coc" / "module-assets"
        / "module-context-demo" / "graph"
    )
    source_before = {
        path.relative_to(graph_root): path.read_bytes()
        for path in graph_root.rglob("*")
        if path.is_file()
    }
    scenario_before = {
        path.relative_to(campaign_ws["campaign_dir"]): path.read_bytes()
        for path in (campaign_ws["campaign_dir"] / "scenario").rglob("*")
        if path.is_file()
    }

    envelope = _run(campaign_ws, "module.context", {
        "seed_ids": ["npc-mary"],
    })

    assert envelope["ok"] is True, envelope
    assert envelope["data"]["presentation"] == {
        "play_language": "zh-Hans",
        "localization_required": True,
        "persistence": "none",
        "authority": "keeper-semantic-presentation",
    }
    assert envelope["data"]["context"]["nodes"][0]["name"] == "Mary"
    source_after = {
        path.relative_to(graph_root): path.read_bytes()
        for path in graph_root.rglob("*")
        if path.is_file()
    }
    scenario_after = {
        path.relative_to(campaign_ws["campaign_dir"]): path.read_bytes()
        for path in (campaign_ws["campaign_dir"] / "scenario").rglob("*")
        if path.is_file()
    }
    assert source_after == source_before
    assert scenario_after == scenario_before


def test_module_context_uses_complete_scenario_graph_asset_binding(campaign_ws):
    module_meta_path = campaign_ws["campaign_dir"] / "scenario" / "module-meta.json"
    module_meta = json.loads(module_meta_path.read_text(encoding="utf-8"))
    asset_root_id = str(module_meta["module_graph_asset_root_id"])
    _install_source_graph(
        campaign_ws,
        asset_root_id=asset_root_id,
        bind_source_root=False,
    )

    envelope = _run(campaign_ws, "module.context")

    assert envelope["ok"] is True, envelope
    assert envelope["data"]["available"] is True
    assert envelope["data"]["module"]["module_id"] == "module-context-demo"
