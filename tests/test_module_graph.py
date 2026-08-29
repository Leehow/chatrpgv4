#!/usr/bin/env python3
"""Public-contract tests for the evidence-bound module knowledge graph."""
from __future__ import annotations

from copy import deepcopy
import hashlib
import importlib.util
import json
from pathlib import Path


SCRIPT = Path("plugins/coc-keeper/scripts/coc_module_graph.py")
SPAN_ARCHIVE = "span-archive-opening-page-3-block-1"
SPAN_LEDGER = "span-archive-ledger-page-4-block-1"


def _load():
    spec = importlib.util.spec_from_file_location("coc_module_graph", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _source_ref(page: int, anchor: str, digest: str) -> dict:
    return {
        "source_id": "pdf:Demo-Module",
        "pdf_index": page,
        "grep_anchor": anchor,
        "text_sha256": digest,
    }


def _evidence_catalog() -> dict:
    return {
        SPAN_ARCHIVE: {
            "span_id": SPAN_ARCHIVE,
            "text": "The investigators arrive at the archive.",
            "source_ref": _source_ref(
                3, "The investigators arrive at the archive", "a" * 64
            ),
        },
        SPAN_LEDGER: {
            "span_id": SPAN_LEDGER,
            "text": "The ledger names the chapel trustees.",
            "source_ref": _source_ref(
                4, "The ledger names the chapel trustees", "b" * 64
            ),
        },
    }


def _evidence_packet() -> dict:
    row = _evidence_catalog()[SPAN_ARCHIVE]
    return {
        "contract_id": "coc.module-graph-evidence.v1",
        "schema_version": 1,
        "section_id": "section-archive-opening",
        "spans": [deepcopy(row)],
    }


def _extraction_packet(graph) -> dict:
    return {
        "contract_id": "coc.module-graph-extraction-packet.v1",
        "schema_version": 1,
        "module_id": "module-demo-archive",
        "section_id": "section-archive-opening",
        "section_role": "archive-opening",
        "aspects": [
            "structure", "world", "actors", "relationships", "events",
            "knowledge", "causal", "mechanics", "assets", "direction"
        ],
        "default_visibility": "player-safe",
        "approved_player_safe_span_ids": [],
        "known_nodes": [],
        "output_budget": {"max_nodes": 8, "max_relations": 10},
        "evidence_view": graph.project_evidence_for_model(_evidence_packet()),
    }


def _accepted_review() -> dict:
    return {
        "contract_id": "coc.module-graph-semantic-review.v1",
        "schema_version": 1,
        "module_id": "module-demo-archive",
        "section_id": "section-archive-opening",
        "aspects": [
            "structure", "world", "actors", "relationships", "events",
            "knowledge", "causal", "mechanics", "assets", "direction"
        ],
        "verdict": "accepted",
        "checks": {
            "section-role": "pass",
            "coverage": "pass",
            "ordering": "pass",
            "quest-semantics": "not-applicable",
            "epistemic-truth": "pass",
            "visibility": "pass",
            "requirements": "not-applicable",
            "absence-vs-unresolved": "pass",
        },
        "findings": [],
    }


def _write_real_source_bundle(tmp_path: Path) -> Path:
    source_pdf = tmp_path / "demo.pdf"
    source_pdf.write_bytes(b"%PDF-1.4\n% graph test fixture\n%%EOF\n")
    bundle = tmp_path / "real-source-bundle"
    pages = bundle / "pages"
    pages.mkdir(parents=True)
    text = "The investigators arrive at the archive.\n\nA public ledger is present.\n"
    (pages / "0000.md").write_text(text, encoding="utf-8")
    (bundle / "manifest.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "producer": "codex-pdf-skill",
                "source": {
                    "source_id": "pdf:Demo-Module",
                    "title": "Demo Module",
                    "path": str(source_pdf),
                    "file_sha256": hashlib.sha256(source_pdf.read_bytes()).hexdigest(),
                    "page_count": 1,
                },
                "pages": [{
                    "pdf_index": 0,
                    "markdown_path": "pages/0000.md",
                    "text_sha256": hashlib.sha256(text.encode()).hexdigest(),
                    "review_state": "auto_accepted",
                    "parse_confidence": 0.95,
                    "grep_anchors": ["The investigators arrive at the archive."],
                }],
                "assets": [],
            }
        ),
        encoding="utf-8",
    )
    return bundle


def _valid_shard() -> dict:
    return {
        "contract_id": "coc.module-graph-shard.v2",
        "schema_version": 2,
        "module_id": "module-demo-archive",
        "section_id": "section-archive-opening",
        "aspects": [
            "structure", "world", "actors", "relationships", "events",
            "knowledge", "causal", "mechanics", "assets", "direction"
        ],
        "evidence_span_ids": [SPAN_ARCHIVE],
        "coverage": {
            "structure": "accepted",
            "world": "partial",
            "actors": "accepted",
            "relationships": "partial",
            "events": "partial",
            "knowledge": "accepted",
            "causal": "partial",
            "mechanics": "unresolved",
            "assets": "unresolved",
            "direction": "partial",
        },
        "nodes": [
            {
                "node_id": "scene-archive-opening",
                "node_kind": "scene",
                "name": "Archive opening",
                "visibility": "player-safe",
                "aliases": ["档案馆开场"],
                "summary": "The investigators may inspect public records.",
                "evidence_span_ids": [SPAN_ARCHIVE],
                "properties": {},
            },
            {
                "node_id": "clue-chapel-ledger",
                "node_kind": "clue",
                "name": "Chapel ledger",
                "visibility": "revealable",
                "aliases": [],
                "summary": "A ledger links the property to the chapel.",
                "evidence_span_ids": [SPAN_ARCHIVE],
                "properties": {},
            },
        ],
        "claims": [
            {
                "claim_id": "claim-ledger-discoverable-at-archive",
                "subject_id": "clue-chapel-ledger",
                "predicate": "discoverable-at",
                "object": {"node_id": "scene-archive-opening"},
                "truth_status": "authored-fact",
                "visibility": "keeper-only",
                "evidence_span_ids": [SPAN_ARCHIVE],
                "asserted_by_ids": [],
                "known_by_ids": [],
            }
        ],
        "relations": [
            {
                "relation_id": "relation-ledger-discoverable-at-archive",
                "relation_kind": "discoverable-at",
                "from_node_id": "clue-chapel-ledger",
                "to_node_id": "scene-archive-opening",
                "claim_id": "claim-ledger-discoverable-at-archive",
            }
        ],
    }


def _second_shard() -> dict:
    shard = deepcopy(_valid_shard())
    shard["section_id"] = "section-archive-ledger"
    shard["evidence_span_ids"] = [SPAN_LEDGER]
    clue = deepcopy(shard["nodes"][1])
    clue["aliases"] = ["教堂账本"]
    clue["evidence_span_ids"] = [SPAN_LEDGER]
    conclusion = {
        "node_id": "conclusion-property-linked-to-chapel",
        "node_kind": "conclusion",
        "name": "The property is linked to the chapel",
        "visibility": "revealable",
        "aliases": [],
        "summary": "The ledger establishes the institutional link.",
        "evidence_span_ids": [SPAN_LEDGER],
        "properties": {},
    }
    shard["nodes"] = [clue, conclusion]
    shard["claims"] = [
        {
            "claim_id": "claim-ledger-supports-chapel-link",
            "subject_id": "clue-chapel-ledger",
            "predicate": "supports",
            "object": {"node_id": "conclusion-property-linked-to-chapel"},
            "truth_status": "authored-fact",
            "visibility": "keeper-only",
            "evidence_span_ids": [SPAN_LEDGER],
            "asserted_by_ids": [],
            "known_by_ids": [],
        }
    ]
    shard["relations"] = [
        {
            "relation_id": "relation-ledger-supports-chapel-link",
            "relation_kind": "supports",
            "from_node_id": "clue-chapel-ledger",
            "to_node_id": "conclusion-property-linked-to-chapel",
            "claim_id": "claim-ledger-supports-chapel-link",
        }
    ]
    return shard


def test_validate_shard_accepts_semantic_evidence_span_ids():
    graph = _load()
    assert graph.validate_shard(
        _valid_shard(), evidence_catalog=_evidence_catalog()
    ) == []


def test_validate_shard_rejects_unknown_evidence_span():
    graph = _load()
    shard = _valid_shard()
    shard["nodes"][0]["evidence_span_ids"] = ["span-missing-page-3-block-9"]
    findings = graph.validate_shard(shard, evidence_catalog=_evidence_catalog())
    assert {finding["code"] for finding in findings} == {
        "unknown_evidence_span",
        "evidence_span_out_of_scope",
    }


def test_validate_shard_rejects_nested_evidence_omitted_from_root_scope():
    graph = _load()
    shard = _second_shard()
    shard["evidence_span_ids"] = [SPAN_ARCHIVE]
    findings = graph.validate_shard(shard, evidence_catalog=_evidence_catalog())
    assert {finding["code"] for finding in findings} == {
        "evidence_span_out_of_scope"
    }


def test_assemble_model_shard_machine_closes_evidence_scope():
    graph = _load()
    shard = _second_shard()
    shard["evidence_span_ids"] = [SPAN_ARCHIVE]

    assembled = graph.assemble_model_shard(shard)

    assert assembled["evidence_span_ids"] == sorted([SPAN_ARCHIVE, SPAN_LEDGER])
    assert graph.validate_shard(
        assembled, evidence_catalog=_evidence_catalog()
    ) == []


def test_assemble_model_shard_rebuilds_malformed_non_authoritative_root_scope():
    graph = _load()
    shard = _second_shard()
    shard["evidence_span_ids"] = SPAN_ARCHIVE

    assembled = graph.assemble_model_shard(shard)

    assert assembled["evidence_span_ids"] == [SPAN_LEDGER]
    assert graph.validate_shard(
        assembled, evidence_catalog=_evidence_catalog()
    ) == []


def test_validate_shard_rejects_mixed_script_model_identifier():
    graph = _load()
    shard = _valid_shard()
    shard["claims"][0]["claim_id"] = "claim-ledger-祷词-link"
    shard["relations"][0]["claim_id"] = "claim-ledger-祷词-link"
    findings = graph.validate_shard(shard, evidence_catalog=_evidence_catalog())
    assert {finding["code"] for finding in findings} == {
        "invalid_claim_id",
        "unknown_relation_claim",
    }


def test_validate_shard_rejects_non_kebab_semantic_identifier():
    graph = _load()
    shard = _valid_shard()
    shard["section_id"] = "section-archive_opening"
    findings = graph.validate_shard(shard, evidence_catalog=_evidence_catalog())
    assert {finding["code"] for finding in findings} == {
        "invalid_semantic_id"
    }


def test_merge_shards_unifies_node_and_machine_attaches_source_evidence():
    graph = _load()
    merged = graph.merge_shards(
        [_valid_shard(), _second_shard()], evidence_catalog=_evidence_catalog()
    )
    clue = next(node for node in merged["nodes"] if node["node_id"] == "clue-chapel-ledger")
    assert {
        "contract": merged["contract_id"],
        "sections": merged["section_ids"],
        "aliases": clue["aliases"],
        "pages": [ref["pdf_index"] for ref in clue["source_refs"]],
    } == {
        "contract": "coc.module-graph.v2",
        "sections": ["section-archive-ledger", "section-archive-opening"],
        "aliases": ["教堂账本"],
        "pages": [3, 4],
    }


def test_search_and_context_enforce_visibility():
    graph = _load()
    merged = graph.merge_shards([_valid_shard()], evidence_catalog=_evidence_catalog())
    assert [row["node_id"] for row in graph.search_graph(merged, "档案馆", audience="player")] == [
        "scene-archive-opening"
    ]
    assert graph.search_graph(merged, "ledger", audience="player") == []
    keeper = graph.graph_context(merged, ["scene-archive-opening"], depth=1)
    player = graph.graph_context(
        merged, ["scene-archive-opening"], depth=1, audience="player"
    )
    assert [row["node_id"] for row in keeper["nodes"]] == [
        "clue-chapel-ledger",
        "scene-archive-opening",
    ]
    assert [row["node_id"] for row in player["nodes"]] == ["scene-archive-opening"]


def test_merge_resolves_declared_cross_section_node_refs():
    graph = _load()
    second = _second_shard()
    second["node_refs"] = ["scene-archive-opening"]
    second["claims"][0]["object"] = {"node_id": "scene-archive-opening"}
    second["claims"][0]["predicate"] = "may-lead-to"
    second["relations"][0].update(
        relation_kind="may-lead-to",
        to_node_id="scene-archive-opening",
    )
    merged = graph.merge_shards(
        [_valid_shard(), second], evidence_catalog=_evidence_catalog()
    )
    assert "relation-ledger-supports-chapel-link" in {
        row["relation_id"] for row in merged["relations"]
    }


def test_validator_rejects_unused_external_node_ref():
    graph = _load()
    shard = _valid_shard()
    shard["node_refs"] = ["module-unused-known-node"]
    findings = graph.validate_shard(shard, evidence_catalog=_evidence_catalog())
    assert {finding["code"] for finding in findings} == {
        "unused_node_ref"
    }


def test_source_bundle_builds_semantic_evidence_packet_without_model_hash_echo(tmp_path):
    graph = _load()
    bundle = tmp_path / "source-bundle"
    pages = bundle / "pages"
    pages.mkdir(parents=True)
    text = "The investigators arrive at the archive.\n\nThe ledger names the chapel trustees.\n"
    digest = hashlib.sha256(text.encode()).hexdigest()
    (pages / "0003.md").write_text(text, encoding="utf-8")
    (bundle / "manifest.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "producer": "codex-pdf-skill",
                "source": {
                    "source_id": "pdf:Demo-Module",
                    "title": "Demo",
                    "path": "/local/demo.pdf",
                    "file_sha256": "c" * 64,
                    "page_count": 5,
                },
                "pages": [{
                    "pdf_index": 3,
                    "markdown_path": "pages/0003.md",
                    "text_sha256": digest,
                    "review_state": "auto_accepted",
                    "parse_confidence": 0.9,
                    "grep_anchors": ["The investigators arrive at the archive"],
                }],
            }
        ),
        encoding="utf-8",
    )
    pages_catalog = graph.load_page_catalog([bundle])
    packet = graph.build_evidence_packet(
        pages_catalog,
        section_id="section-archive-opening",
        page_keys=[("pdf:Demo-Module", 3)],
    )
    evidence = graph.load_evidence_catalog([packet], page_catalog=pages_catalog)
    model_view = graph.project_evidence_for_model(packet)
    assert {
        "contract": packet["contract_id"],
        "span_ids": [row["span_id"] for row in packet["spans"]],
        "attached_hash": evidence[packet["spans"][0]["span_id"]]["source_ref"]["text_sha256"],
        "model_view_keys": sorted(model_view["spans"][0]),
    } == {
        "contract": "coc.module-graph-evidence.v1",
        "span_ids": [
            "span-archive-opening-page-3-block-1",
            "span-archive-opening-page-3-block-2",
        ],
        "attached_hash": digest,
        "model_view_keys": ["span_id", "text"],
    }


def test_prepare_returns_one_closed_model_safe_extraction_packet(tmp_path):
    graph = _load()
    bundle = tmp_path / "source-bundle"
    pages = bundle / "pages"
    pages.mkdir(parents=True)
    text = "Public title.\n\nKeeper-only antagonist plan.\n"
    digest = hashlib.sha256(text.encode()).hexdigest()
    (pages / "0001.md").write_text(text, encoding="utf-8")
    (bundle / "manifest.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "producer": "codex-pdf-skill",
                "source": {
                    "source_id": "pdf:Demo-Module",
                    "title": "Demo",
                    "path": "/local/demo.pdf",
                    "file_sha256": "c" * 64,
                    "page_count": 2,
                },
                "pages": [{
                    "pdf_index": 1,
                    "markdown_path": "pages/0001.md",
                    "text_sha256": digest,
                    "review_state": "auto_accepted",
                    "parse_confidence": 0.9,
                    "grep_anchors": ["Public title."],
                }],
            }
        ),
        encoding="utf-8",
    )
    page_catalog = graph.load_page_catalog([bundle])

    prepared = graph.prepare_extraction_packet(
        page_catalog,
        module_id="module-demo",
        section_id="section-demo-background",
        section_role="keeper-background",
        aspects=["world", "actors"],
        default_visibility="keeper-only",
        approved_player_safe_span_ids=[],
        known_nodes=[{
            "node_id": "module-demo",
            "node_kind": "module",
            "name": "Demo",
            "visibility": "player-safe",
        }],
        output_budget={"max_nodes": 8, "max_relations": 10},
        page_keys=[("pdf:Demo-Module", 1)],
    )

    packet = prepared["extraction_packet"]
    encoded = json.dumps(packet, ensure_ascii=False, sort_keys=True)
    assert set(prepared) == {"evidence_packet", "extraction_packet"}
    assert packet["contract_id"] == "coc.module-graph-extraction-packet.v1"
    assert packet["aspects"] == ["world", "actors"]
    assert packet["evidence_view"]["contract_id"] == (
        "coc.module-graph-evidence-view.v1"
    )
    assert packet["known_nodes"][0]["node_id"] == "module-demo"
    assert "text_sha256" not in encoded
    assert "source_id" not in encoded
    assert "/local/demo.pdf" not in encoded


def test_prepare_can_narrow_a_page_to_exact_machine_span_ids(tmp_path):
    graph = _load()
    bundle = _write_real_source_bundle(tmp_path)
    page_catalog = graph.load_page_catalog([bundle])
    full = graph.prepare_extraction_packet(
        page_catalog,
        module_id="module-demo-archive",
        section_id="section-archive-opening",
        section_role="archive-opening",
        aspects=["structure"],
        default_visibility="player-safe",
        approved_player_safe_span_ids=[],
        known_nodes=[],
        output_budget={"max_nodes": 4, "max_relations": 4},
        page_keys=[("pdf:Demo-Module", 0)],
    )
    selected_id = full["evidence_packet"]["spans"][1]["span_id"]

    narrowed = graph.prepare_extraction_packet(
        page_catalog,
        module_id="module-demo-archive",
        section_id="section-archive-opening",
        section_role="archive-opening",
        aspects=["structure"],
        default_visibility="player-safe",
        approved_player_safe_span_ids=[],
        known_nodes=[],
        output_budget={"max_nodes": 4, "max_relations": 4},
        page_keys=[("pdf:Demo-Module", 0)],
        selected_evidence_span_ids=[selected_id],
    )

    assert [
        row["span_id"] for row in narrowed["evidence_packet"]["spans"]
    ] == [selected_id]


def test_accept_requires_valid_candidate_scope_and_semantic_review():
    graph = _load()
    candidate = _valid_shard()
    candidate["evidence_span_ids"] = "model-root-is-not-authoritative"

    accepted = graph.accept_graph_shard(
        _extraction_packet(graph),
        _evidence_packet(),
        candidate,
        _accepted_review(),
    )

    assert accepted["accepted_shard"]["evidence_span_ids"] == [SPAN_ARCHIVE]
    receipt = accepted["review_receipt"]
    assert receipt["contract_id"] == "coc.module-graph-review-receipt.v1"
    assert receipt["verdict"] == "accepted"
    assert len(receipt["candidate_sha256"]) == 64
    assert len(receipt["evidence_packet_sha256"]) == 64
    assert len(receipt["review_payload_sha256"]) == 64


def test_accept_rejects_semantic_review_findings_without_mutating_candidate():
    graph = _load()
    candidate = _valid_shard()
    original = deepcopy(candidate)
    review = _accepted_review()
    review["verdict"] = "revision-required"
    review["checks"]["ordering"] = "finding"
    review["findings"] = [{
        "code": "ordering-misclassified",
        "path": "/relations/0",
        "message": "Publication order was treated as causal order.",
        "evidence_span_ids": [SPAN_ARCHIVE],
    }]

    try:
        graph.accept_graph_shard(
            _extraction_packet(graph),
            _evidence_packet(),
            candidate,
            review,
        )
    except graph.ModuleGraphError as exc:
        assert {finding["code"] for finding in exc.findings} == {
            "semantic_review_rejected"
        }
    else:
        raise AssertionError("revision-required review must reject promotion")
    assert candidate == original


def test_build_installs_one_reproducible_asset_root_generation(tmp_path):
    graph = _load()
    candidate = _valid_shard()
    candidate["coverage"] = {
        domain: "accepted" for domain in candidate["coverage"]
    }
    accepted = graph.accept_graph_shard(
        _extraction_packet(graph),
        _evidence_packet(),
        candidate,
        _accepted_review(),
    )
    record = {
        **accepted,
        "evidence_packet": _evidence_packet(),
    }
    build_plan = {
        "contract_id": "coc.module-graph-build-plan.v1",
        "schema_version": 1,
        "module_id": "module-demo-archive",
        "planned_shards": [{
            "section_id": "section-archive-opening",
            "aspects": list(candidate["aspects"]),
        }],
    }
    source_bundles = [
        {
            "source_id": "pdf:Demo-Module",
            "bundle_sha256": "c" * 64,
            "file_sha256": "d" * 64,
        },
        {
            "source_id": "pdf:Demo-Module",
            "bundle_sha256": "e" * 64,
            "file_sha256": "d" * 64,
        },
    ]
    page_catalog = {
        ("pdf:Demo-Module", 3): {
            "source_id": "pdf:Demo-Module",
            "pdf_index": 3,
            "text": "The investigators arrive at the archive.",
            "text_sha256": "a" * 64,
        }
    }

    first = graph.build_module_graph_asset(
        tmp_path,
        asset_root_id="demo-archive",
        build_plan=build_plan,
        accepted_records=[record],
        source_bundles=source_bundles,
        page_catalog=page_catalog,
    )
    second = graph.build_module_graph_asset(
        tmp_path,
        asset_root_id="demo-archive",
        build_plan=build_plan,
        accepted_records=[record],
        source_bundles=source_bundles,
        page_catalog=page_catalog,
    )

    graph_root = tmp_path / ".coc" / "module-assets" / "demo-archive" / "graph"
    manifest = json.loads((graph_root / "manifest.json").read_text())
    assert first["manifest"] == second["manifest"] == manifest
    assert manifest["contract_id"] == "coc.module-graph-build-manifest.v1"
    assert manifest["build_status"] == "complete"
    assert manifest["missing_shards"] == []
    assert manifest["current_generation"].startswith("generation-")
    assert len(manifest["module_graph_sha256"]) == 64
    module_graph = graph.load_installed_module_graph(
        tmp_path, asset_root_id="demo-archive"
    )
    assert module_graph["module_id"] == "module-demo-archive"
    assert len(module_graph["nodes"]) == 2
    assert not (graph_root / "module-graph.json").exists()


def test_build_keeps_missing_planned_shards_explicitly_partial(tmp_path):
    graph = _load()
    candidate = _valid_shard()
    candidate["coverage"] = {
        domain: "accepted" for domain in candidate["coverage"]
    }
    accepted = graph.accept_graph_shard(
        _extraction_packet(graph),
        _evidence_packet(),
        candidate,
        _accepted_review(),
    )
    build_plan = {
        "contract_id": "coc.module-graph-build-plan.v1",
        "schema_version": 1,
        "module_id": "module-demo-archive",
        "planned_shards": [
            {
                "section_id": "section-archive-opening",
                "aspects": list(candidate["aspects"]),
            },
            {
                "section_id": "section-archive-aftermath",
                "aspects": ["structure"],
            },
        ],
    }
    result = graph.build_module_graph_asset(
        tmp_path,
        asset_root_id="demo-partial",
        build_plan=build_plan,
        accepted_records=[{
            **accepted,
            "evidence_packet": _evidence_packet(),
        }],
        source_bundles=[{
            "source_id": "pdf:Demo-Module",
            "bundle_sha256": "c" * 64,
            "file_sha256": "d" * 64,
        }],
        page_catalog={
            ("pdf:Demo-Module", 3): {
                "source_id": "pdf:Demo-Module",
                "pdf_index": 3,
                "text": "The investigators arrive at the archive.",
                "text_sha256": "a" * 64,
            }
        },
    )

    manifest = result["manifest"]
    assert manifest["build_status"] == "partial"
    assert manifest["missing_shards"] == [{
        "section_id": "section-archive-aftermath",
        "aspects": ["structure"],
    }]
    assert manifest["coverage"]["structure"] == "unresolved"


def test_cli_merges_shard_with_evidence_packet_and_serves_search(tmp_path, capsys):
    graph = _load()
    shard_path = tmp_path / "model-shard.json"
    assembled_path = tmp_path / "archive-shard.json"
    evidence_path = tmp_path / "evidence.json"
    graph_path = tmp_path / "module-graph.json"
    proposed = _valid_shard()
    proposed["evidence_span_ids"] = "model-root-is-not-authoritative"
    shard_path.write_text(json.dumps(proposed), encoding="utf-8")
    evidence_path.write_text(
        json.dumps(
            {
                "contract_id": "coc.module-graph-evidence.v1",
                "schema_version": 1,
                "section_id": "section-archive-opening",
                "spans": [
                    {
                        "span_id": SPAN_ARCHIVE,
                        "text": "The investigators arrive at the archive.",
                        "source_ref": _source_ref(
                            3, "The investigators arrive at the archive", "a" * 64
                        ),
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    assert graph.main(
        [
            "assemble-shard", str(shard_path),
            "--evidence-packet", str(evidence_path),
            "--output", str(assembled_path), "--json",
        ]
    ) == 0
    capsys.readouterr()
    assert graph.main(
        [
            "merge", str(assembled_path), "--evidence-packet", str(evidence_path),
            "--output", str(graph_path), "--json",
        ]
    ) == 0
    capsys.readouterr()
    assert graph.main(
        ["search", str(graph_path), "档案馆", "--audience", "player", "--json"]
    ) == 0
    output = json.loads(capsys.readouterr().out)
    assert [row["node_id"] for row in output["results"]] == ["scene-archive-opening"]


def test_cli_prepare_accept_build_installs_reviewed_graph(tmp_path, capsys):
    graph = _load()
    bundle = _write_real_source_bundle(tmp_path)
    prepared_dir = tmp_path / "prepared"
    accepted_dir = tmp_path / "accepted"
    request_path = tmp_path / "prepare-request.json"
    request_path.write_text(
        json.dumps({
            "contract_id": "coc.module-graph-prepare-request.v1",
            "schema_version": 1,
            "module_id": "module-demo-archive",
            "section_id": "section-archive-opening",
            "section_role": "archive-opening",
            "aspects": [
                "structure", "world", "actors", "relationships", "events",
                "knowledge", "causal", "mechanics", "assets", "direction"
            ],
            "default_visibility": "player-safe",
            "approved_player_safe_span_ids": [],
            "selected_evidence_span_ids": [],
            "known_nodes": [],
            "output_budget": {"max_nodes": 8, "max_relations": 10},
            "page_refs": [{"source_id": "pdf:Demo-Module", "pdf_index": 0}],
        }),
        encoding="utf-8",
    )
    assert graph.main([
        "prepare", "--request", str(request_path),
        "--source-bundle", str(bundle),
        "--output-dir", str(prepared_dir), "--json",
    ]) == 0
    capsys.readouterr()

    packet = json.loads((prepared_dir / "extraction-packet.json").read_text())
    span_id = packet["evidence_view"]["spans"][0]["span_id"]
    candidate = _valid_shard()
    candidate["coverage"] = {
        domain: "accepted" for domain in candidate["coverage"]
    }
    candidate["evidence_span_ids"] = [span_id]
    for node in candidate["nodes"]:
        node["evidence_span_ids"] = [span_id]
    for claim in candidate["claims"]:
        claim["evidence_span_ids"] = [span_id]
    candidate_path = tmp_path / "candidate.json"
    candidate_path.write_text(json.dumps(candidate), encoding="utf-8")
    checked_path = tmp_path / "checked-candidate.json"
    assert graph.main([
        "check",
        "--packet", str(prepared_dir / "extraction-packet.json"),
        "--evidence-packet", str(prepared_dir / "evidence-packet.json"),
        "--candidate", str(candidate_path),
        "--source-bundle", str(bundle),
        "--output", str(checked_path), "--json",
    ]) == 0
    capsys.readouterr()
    assert json.loads(checked_path.read_text())["section_id"] == (
        "section-archive-opening"
    )
    review_path = tmp_path / "review.json"
    review_path.write_text(json.dumps(_accepted_review()), encoding="utf-8")

    assert graph.main([
        "accept",
        "--packet", str(prepared_dir / "extraction-packet.json"),
        "--evidence-packet", str(prepared_dir / "evidence-packet.json"),
        "--candidate", str(candidate_path),
        "--review", str(review_path),
        "--source-bundle", str(bundle),
        "--output-dir", str(accepted_dir), "--json",
    ]) == 0
    capsys.readouterr()

    build_plan_path = tmp_path / "build-plan.json"
    build_plan_path.write_text(json.dumps({
        "contract_id": "coc.module-graph-build-plan.v1",
        "schema_version": 1,
        "module_id": "module-demo-archive",
        "planned_shards": [{
            "section_id": "section-archive-opening",
            "aspects": list(candidate["aspects"]),
        }],
    }), encoding="utf-8")
    assert graph.main([
        "build", "--workspace", str(tmp_path),
        "--asset-root-id", "demo-archive",
        "--plan", str(build_plan_path),
        "--accepted", str(accepted_dir),
        "--source-bundle", str(bundle), "--json",
    ]) == 0
    output = json.loads(capsys.readouterr().out)
    assert output["status"] == "PASS"
    assert output["build_status"] == "complete"
    installed = graph.load_installed_module_graph(
        tmp_path, asset_root_id="demo-archive"
    )
    assert installed["module_id"] == "module-demo-archive"
    assert graph.main([
        "installed-search", "--workspace", str(tmp_path),
        "--asset-root-id", "demo-archive", "档案馆",
        "--audience", "player", "--json",
    ]) == 0
    search_output = json.loads(capsys.readouterr().out)
    assert [row["node_id"] for row in search_output["results"]] == [
        "scene-archive-opening"
    ]
    assert graph.main([
        "installed-context", "--workspace", str(tmp_path),
        "--asset-root-id", "demo-archive",
        "--seed", "scene-archive-opening", "--depth", "1",
        "--audience", "keeper", "--json",
    ]) == 0
    context_output = json.loads(capsys.readouterr().out)
    assert [row["node_id"] for row in context_output["context"]["nodes"]] == [
        "clue-chapel-ledger",
        "scene-archive-opening",
    ]


def test_validator_rejects_unknown_fields_literal_claims_and_relation_drift():
    graph = _load()
    shard = _valid_shard()
    shard["nodes"][0]["keeper_notes"] = "not contracted"
    shard["claims"][0]["object"] = {"value": "scalar"}
    shard["relations"][0]["relation_kind"] = "supports"
    findings = graph.validate_shard(shard, evidence_catalog=_evidence_catalog())
    assert {finding["code"] for finding in findings} == {
        "unknown_node_key",
        "claim_object_node_required",
        "relation_claim_mismatch",
    }


def test_validator_requires_node_kind_namespace_in_node_id():
    graph = _load()
    shard = _valid_shard()
    shard["nodes"][0]["node_id"] = "archive-opening"
    shard["claims"][0]["object"] = {"node_id": "archive-opening"}
    shard["relations"][0]["to_node_id"] = "archive-opening"
    findings = graph.validate_shard(shard, evidence_catalog=_evidence_catalog())
    assert {finding["code"] for finding in findings} == {
        "node_id_kind_mismatch"
    }


def test_validator_accepts_explicit_worship_relationship():
    graph = _load()
    shard = _valid_shard()
    shard["claims"][0]["predicate"] = "worships"
    shard["relations"][0]["relation_kind"] = "worships"
    assert graph.validate_shard(
        shard, evidence_catalog=_evidence_catalog()
    ) == []


def test_validator_accepts_actor_asserting_a_proposition():
    graph = _load()
    shard = _valid_shard()
    shard["claims"][0]["predicate"] = "asserts"
    shard["relations"][0]["relation_kind"] = "asserts"
    assert graph.validate_shard(
        shard, evidence_catalog=_evidence_catalog()
    ) == []


def test_validator_rejects_accepted_coverage_outside_declared_aspects():
    graph = _load()
    shard = _valid_shard()
    shard["aspects"] = ["structure"]
    shard["coverage"] = {domain: "unresolved" for domain in shard["coverage"]}
    shard["coverage"]["structure"] = "accepted"
    shard["coverage"]["actors"] = "partial"
    findings = graph.validate_shard(shard, evidence_catalog=_evidence_catalog())
    assert {finding["code"] for finding in findings} == {
        "coverage_outside_aspects"
    }


def test_validator_requires_unresolved_for_every_undeclared_aspect():
    graph = _load()
    shard = _valid_shard()
    shard["aspects"] = ["structure"]
    shard["coverage"] = {domain: "unresolved" for domain in shard["coverage"]}
    shard["coverage"]["structure"] = "accepted"
    shard["coverage"]["assets"] = "absent"
    findings = graph.validate_shard(shard, evidence_catalog=_evidence_catalog())
    assert {finding["code"] for finding in findings} == {
        "coverage_outside_aspects"
    }
