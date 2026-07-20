#!/usr/bin/env python3
"""Tests for progressive module-assets store (slice 1)."""
from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path

import pytest

SCRIPTS = Path("plugins/coc-keeper/scripts")


def _load(name: str, rel: str):
    spec = importlib.util.spec_from_file_location(name, rel)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


assets = _load("coc_module_assets", str(SCRIPTS / "coc_module_assets.py"))

FAKE_SHA = "a" * 64


def _minimal_skeleton(**overrides):
    base = {
        "schema_version": 1,
        "parse_tier": 1,
        "module_identity": {"canonical_module_id": "demo-mod"},
        "structure_type": "branching_investigation",
        "source": {
            "source_id": "pdf:demo",
            "path": "/tmp/demo.pdf",
            "file_sha256": FAKE_SHA,
            "page_count": 10,
            "producer": "codex-pdf-skill",
        },
        "start_candidates": ["opening"],
        "finale_buckets": [{"id": "end", "title": "End", "importance": "critical"}],
        "locations": [
            {
                "location_id": "opening",
                "title": "Opening",
                "parse_state": "toc_only",
                "source_span": {"pdf_index_start": 0, "pdf_index_end": 1},
            },
            {
                "location_id": "library",
                "title": "Library",
                "parse_state": "named_only",
            },
        ],
        "edges_provisional": [
            {
                "from": "opening",
                "to": "library",
                "kind": "travel",
                "confidence": "low",
                "evidence": "toc_adjacency",
            }
        ],
        "npc_roster": [
            {
                "npc_id": "npc-clerk",
                "names": ["Clerk"],
                "parse_state": "named_only",
            }
        ],
        "handouts": [],
        "threats": [],
        "conclusion_buckets": [],
    }
    base.update(overrides)
    return base


def test_init_put_skeleton_lookup_roundtrip(tmp_path: Path):
    root = assets.init_module_root(
        tmp_path,
        asset_root_id="demo-mod",
        identity={"canonical_module_id": "demo-mod", "canonical_title": "Demo"},
        file_sha256=FAKE_SHA,
    )
    assert (root / "identity.json").is_file()
    assert (root / "parse-queue.json").is_file()
    assert (root / "LICENSE-note.md").is_file()

    hit = assets.lookup_by_sha256(tmp_path, FAKE_SHA)
    assert hit is not None
    assert hit["asset_root_id"] == "demo-mod"

    result = assets.put_skeleton(tmp_path, "demo-mod", _minimal_skeleton())
    assert result["location_count"] == 2
    loaded = assets.get_skeleton(tmp_path, "demo-mod")
    assert loaded is not None
    assert loaded["start_candidates"] == ["opening"]
    assert assets.load_registry(tmp_path)["modules"]["demo-mod"]["parse_tier_max"] == 1


def test_validate_skeleton_rejects_unknown_edge_endpoint():
    sk = _minimal_skeleton()
    sk["edges_provisional"][0]["to"] = "nowhere"
    errors = assets.validate_skeleton(sk)
    assert any("unknown location" in e for e in errors)


def test_validate_skeleton_requires_start_in_locations():
    sk = _minimal_skeleton()
    sk["start_candidates"] = ["missing-start"]
    errors = assets.validate_skeleton(sk)
    assert any("start_candidates" in e for e in errors)


def test_put_page_idempotent_hash(tmp_path: Path):
    assets.init_module_root(
        tmp_path, asset_root_id="demo-mod", identity={}, file_sha256=FAKE_SHA,
    )
    text = "Handout line one.\n"
    first = assets.put_page(tmp_path, "demo-mod", 3, text)
    assert first["text_sha256"] == hashlib.sha256(text.encode()).hexdigest()
    page = assets.get_page(tmp_path, "demo-mod", 3)
    assert page is not None
    assert page["text"] == text
    assert page["meta"]["pdf_index"] == 3


def test_ensure_stub_and_enqueue_dedupe(tmp_path: Path):
    assets.init_module_root(
        tmp_path, asset_root_id="demo-mod", identity={}, file_sha256=FAKE_SHA,
    )
    a = assets.ensure_stub(
        tmp_path, "demo-mod", "location", "chapel",
        title="Chapel", reason="mention_from:opening",
    )
    assert a["created"] is True
    b = assets.ensure_stub(tmp_path, "demo-mod", "location", "chapel", title="Other")
    assert b["created"] is False
    assert b["entity"]["parse_state"] == "named_only"
    # deeper pack not overwritten by stub title change
    assert b["entity"].get("title") == "Chapel" or b["entity"].get("title") == "Chapel"

    j1 = assets.enqueue_job(
        tmp_path, "demo-mod", kind="deepen_location", target_id="chapel",
        priority=80, reason="enter",
    )
    assert j1["enqueued"] is True
    j2 = assets.enqueue_job(
        tmp_path, "demo-mod", kind="deepen_location", target_id="chapel", priority=90,
    )
    assert j2["deduped"] is True
    queue = assets.list_queue(tmp_path, "demo-mod")
    assert len(queue["pending"]) == 1


def test_npc_stub_unions_skeleton_profile_and_context_mention_source_pages(
    tmp_path: Path,
):
    assets.init_module_root(
        tmp_path, asset_root_id="demo-mod", identity={}, file_sha256=FAKE_SHA,
    )
    skeleton = _minimal_skeleton()
    skeleton["npc_roster"][0]["source_span"] = {
        "pdf_index_start": 2,
        "pdf_index_end": 2,
    }
    assets.put_skeleton(tmp_path, "demo-mod", skeleton)

    created = assets.ensure_stub(
        tmp_path,
        "demo-mod",
        "npc",
        "npc-clerk",
        title="Clerk",
        reason="mention_from:library",
        source_scope={"source_page_indices": [7, 8]},
    )
    assert created["created"] is True
    assert created["entity"]["source_page_indices"] == [2, 7, 8]
    assert "source_span" not in created["entity"]

    enriched = assets.ensure_stub(
        tmp_path,
        "demo-mod",
        "npc",
        "npc-clerk",
        source_scope={"source_page_indices": [9]},
    )
    assert enriched["created"] is False
    assert enriched["source_scope_updated"] is True
    assert enriched["entity"]["source_page_indices"] == [2, 7, 8, 9]


def test_enqueue_dedupes_inflight_and_unfulfilled_host_request(
    tmp_path: Path, monkeypatch,
):
    assets.init_module_root(
        tmp_path, asset_root_id="demo-mod", identity={}, file_sha256=FAKE_SHA,
    )
    assets.ensure_stub(tmp_path, "demo-mod", "location", "chapel", title="Chapel")

    class NoopWorker:
        @staticmethod
        def kick_background_worker(_workspace):
            return {"started": False, "reason": "test"}

    monkeypatch.setattr(assets, "_load_sibling", lambda *_args: NoopWorker)
    queue_path = assets.assets_root(tmp_path) / "demo-mod" / "parse-queue.json"
    queue = assets.list_queue(tmp_path, "demo-mod")
    queue["in_flight"] = [{
        "job_id": "job-active",
        "kind": "deepen_location",
        "target_id": "chapel",
        "priority": 80,
        "enqueued_at": "2026-01-01T00:00:00+00:00",
    }]
    queue_path.write_text(json.dumps(queue), encoding="utf-8")

    inflight = assets.enqueue_job(
        tmp_path, "demo-mod", kind="partial_neighbor", target_id="chapel",
    )
    assert inflight["deduped"] is True
    assert inflight["dedupe_state"] == "in_flight"

    queue["in_flight"] = []
    queue["done"] = [{
        "job_id": "job-host",
        "kind": "deepen_location",
        "target_id": "chapel",
        "completed_at": "2999-01-01T00:00:00+00:00",
        "result": "awaiting_host_pack",
    }]
    queue_path.write_text(json.dumps(queue), encoding="utf-8")
    waiting = assets.enqueue_job(
        tmp_path, "demo-mod", kind="deepen_location", target_id="chapel",
        reason="same_source_scope",
    )
    assert waiting["enqueued"] is False
    assert waiting["dedupe_state"] == "awaiting_host_pack"
    assert assets.list_queue(tmp_path, "demo-mod")["pending"] == []


def test_enqueue_promotes_pending_neighbor_prefetch_for_active_scene(
    tmp_path: Path, monkeypatch,
):
    assets.init_module_root(
        tmp_path, asset_root_id="demo-mod", identity={}, file_sha256=FAKE_SHA,
    )

    class NoopWorker:
        @staticmethod
        def kick_background_worker(_workspace):
            return {"started": False, "reason": "test"}

    monkeypatch.setattr(assets, "_load_sibling", lambda *_args: NoopWorker)
    first = assets.enqueue_job(
        tmp_path, "demo-mod", kind="partial_neighbor", target_id="chapel",
        priority=40,
    )
    assert first["enqueued"] is True
    promoted = assets.enqueue_job(
        tmp_path, "demo-mod", kind="deepen_location", target_id="chapel",
        priority=100, reason="enter:chapel",
    )
    assert promoted["deduped"] is True
    assert promoted["job"]["kind"] == "deepen_location"
    assert promoted["job"]["priority"] == 100
    assert len(assets.list_queue(tmp_path, "demo-mod")["pending"]) == 1


def test_deep_location_rejects_unknown_semantic_edge_condition(tmp_path: Path):
    assets.init_module_root(
        tmp_path, asset_root_id="demo-mod", identity={}, file_sha256=FAKE_SHA,
    )
    with pytest.raises(assets.ModuleAssetsError, match="unsupported"):
        assets.put_entity(tmp_path, "demo-mod", "location", "chapel", {
            "parse_state": "deep",
            "evidence_gap": False,
            "scene_edges": [{
                "to": "crypt",
                "kind": "unlock",
                "when": {"kind": "keeper_judgment"},
            }],
        })


def test_deep_location_validates_authored_san_triggers(tmp_path: Path):
    assets.init_module_root(
        tmp_path, asset_root_id="demo-mod", identity={}, file_sha256=FAKE_SHA,
    )
    with pytest.raises(assets.ModuleAssetsError, match="san_loss_fail_expr"):
        assets.put_entity(tmp_path, "demo-mod", "location", "chapel", {
            "parse_state": "deep",
            "evidence_gap": False,
            "san_triggers": [{
                "trigger_id": "chapel-body",
                "source": "A body hangs above the altar.",
                "san_loss_success": 0,
            }],
        })

    stored = assets.put_entity(tmp_path, "demo-mod", "location", "chapel", {
        "parse_state": "deep",
        "evidence_gap": False,
        "san_triggers": [{
            "trigger_id": "chapel-body",
            "source": "A body hangs above the altar.",
            "san_loss_success": 0,
            "san_loss_fail_expr": "1D4",
        }],
    })
    assert Path(stored["path"]).is_file()


def test_put_entity_cli_persists_a_deep_pack(tmp_path: Path):
    assets.init_module_root(
        tmp_path,
        asset_root_id="mod-cli",
        identity={"canonical_module_id": "mod-cli"},
        file_sha256=FAKE_SHA,
    )
    pack_path = tmp_path / "opening.json"
    pack_path.write_text(
        json.dumps({
            "schema_version": 1,
            "location_id": "opening",
            "title": "Opening",
            "parse_state": "deep",
        }),
        encoding="utf-8",
    )

    exit_code = assets.main([
        "--workspace", str(tmp_path),
        "put-entity",
        "--asset-root-id", "mod-cli",
        "--kind", "location",
        "--entity-id", "opening",
        "--entity-json", str(pack_path),
    ])

    assert exit_code == 0
    assert assets.get_entity(tmp_path, "mod-cli", "location", "opening")[
        "parse_state"
    ] == "deep"


def test_put_entity_rejects_npc_dialogue_clue_without_source_npc_ids(
    tmp_path: Path,
):
    assets.init_module_root(
        tmp_path,
        asset_root_id="dialogue-source",
        identity={"canonical_module_id": "dialogue-source"},
        file_sha256=FAKE_SHA,
    )

    with pytest.raises(
        assets.ModuleAssetsError,
        match="requires unique non-empty source_npc_ids",
    ):
        assets.put_entity(tmp_path, "dialogue-source", "location", "station", {
            "schema_version": 1,
            "location_id": "station",
            "parse_state": "deep",
            "clues": [{
                "clue_id": "clue-warning",
                "delivery_kind": "npc_dialogue",
                "player_safe_summary": "店主含蓄地劝外来者离开。",
            }],
        })


def _write_host_bundle(tmp_path: Path) -> tuple[Path, str, str]:
    pdf = tmp_path / "bound-module.pdf"
    pdf.write_bytes(b"%PDF validated host fixture")
    bundle = tmp_path / "bound-source"
    bundle.mkdir()
    page_bytes = b"# Hospital\n\nDr Percival guards a source-bound secret.\n"
    (bundle / "page-0000.md").write_bytes(page_bytes)
    file_sha = hashlib.sha256(pdf.read_bytes()).hexdigest()
    (bundle / "manifest.json").write_text(json.dumps({
        "schema_version": 1,
        "producer": "codex-pdf-skill",
        "source": {
            "source_id": "pdf:bound-module",
            "title": "Bound Module",
            "path": str(pdf),
            "file_sha256": file_sha,
            "page_count": 1,
        },
        "pages": [{
            "pdf_index": 0,
            "markdown_path": "page-0000.md",
            "text_sha256": hashlib.sha256(page_bytes).hexdigest(),
            "review_state": "manual_accepted",
            "parse_confidence": 0.94,
            "grep_anchors": ["Dr Percival guards a source-bound secret."],
        }],
    }), encoding="utf-8")
    return bundle, file_sha, hashlib.sha256(page_bytes).hexdigest()


def test_source_bundle_bridge_caches_once_and_normalizes_deep_pack_evidence(
    tmp_path: Path, monkeypatch,
):
    bundle, file_sha, _producer_page_sha = _write_host_bundle(tmp_path)
    first = assets.register_source_bundle(
        tmp_path,
        bundle,
        asset_root_id="bound-module",
        module_identity={"canonical_module_id": "bound-module"},
    )
    assert first["new_page_count"] == 1
    assert first["reused_page_count"] == 0
    second = assets.register_source_bundle(
        tmp_path,
        bundle,
        asset_root_id="another-campaign-name",
    )
    assert second["asset_root_id"] == "bound-module"
    assert second["reused_existing_root"] is True
    assert second["new_page_count"] == 0
    assert second["reused_page_count"] == 1
    identity = json.loads(
        (
            tmp_path / ".coc" / "module-assets" / "bound-module" / "identity.json"
        ).read_text(encoding="utf-8")
    )
    assert identity["module_identity"]["canonical_module_id"] == "bound-module"
    page = assets.get_page(tmp_path, "bound-module", 0)
    assert page is not None
    assert page["meta"]["source_id"] == "pdf:bound-module"
    assert page["meta"]["bundle_sha256s"] == [first["bundle_sha256"]]

    class NoopQueueWorker:
        @staticmethod
        def reenqueue_merge_for_entity(*_args, **_kwargs):
            return {"enqueue": {"enqueued": False}, "kick": {"started": False}}

    monkeypatch.setattr(assets, "_load_sibling", lambda *_args: NoopQueueWorker)
    with pytest.raises(assets.ModuleAssetsError, match="requires source_refs"):
        assets.put_entity(tmp_path, "bound-module", "location", "hospital", {
            "parse_state": "deep",
            "evidence_gap": False,
        })

    stored_result = assets.put_entity(
        tmp_path,
        "bound-module",
        "location",
        "hospital",
        {
            "parse_state": "deep",
            "evidence_gap": False,
            "source_page_indices": [0],
            "host_timing": {
                "started_at": "2026-07-19T10:00:00+00:00",
                "completed_at": "2026-07-19T10:00:03+00:00",
                "duration_ms": 3000,
                "producer": "window-equivalent-host",
            },
            "clues": [{
                "clue_id": "clue-prescription",
                "delivery_kind": "obvious",
                "player_safe_summary": "处方上的剂量异常。",
                "mentions": [{
                    "kind": "location",
                    "ref_id": "hospital-basement",
                    "raw_label": "医院地下室",
                }],
            }],
            "npcs": [{
                "npc_id": "npc-percival",
                "name": "珀西瓦尔医生",
                "agenda": "隐瞒自己和埃弗里一伙的关系。",
                "secret": "他是埃弗里团队的一员。",
            }],
            "mentions": [{
                "kind": "location",
                "ref_id": "hospital-annex",
                "raw_label": "医院附楼",
            }],
        },
    )
    stored = assets.get_entity(tmp_path, "bound-module", "location", "hospital")
    assert stored is not None
    assert stored["source_page_indices"] == [0]
    assert stored["source_refs"][0]["source_id"] == "pdf:bound-module"
    assert stored["source_refs"][0]["text_sha256"] == page["meta"]["text_sha256"]
    assert stored["source_evidence"]["file_sha256"] == file_sha
    assert stored["clues"][0]["source_refs"] == stored["source_refs"]
    assert stored["npcs"][0]["source_refs"] == stored["source_refs"]
    assert stored["mentions"][0]["source_refs"] == stored["source_refs"]
    assert (
        stored["clues"][0]["mentions"][0]["source_refs"]
        == stored["source_refs"]
    )
    assert stored["ingest_timing"]["source_compile_ms"] == 3000
    assert stored_result["repository_put_ms"] >= 0

    stub_result = assets.ensure_stub(
        tmp_path,
        "bound-module",
        "location",
        "hospital-annex",
        title="医院附楼",
        reason="mention_from:hospital",
        source_scope=stored["mentions"][0],
    )
    assert stub_result["created"] is True
    stub = assets.get_entity(
        tmp_path, "bound-module", "location", "hospital-annex",
    )
    assert stub is not None
    assert stub["source_page_indices"] == [0]
    assert stub["source_refs"] == stored["source_refs"]

    uncached_stub_result = assets.ensure_stub(
        tmp_path,
        "bound-module",
        "location",
        "uncached-mill",
        title="Uncached Mill",
        reason="player_dig",
        source_scope={"source_page_indices": [7, 8]},
    )
    assert uncached_stub_result["created"] is True
    uncached_stub = uncached_stub_result["entity"]
    assert uncached_stub["parse_state"] == "named_only"
    assert uncached_stub["source_page_indices"] == [7, 8]
    assert uncached_stub["source_span"] == {
        "pdf_index_start": 7,
        "pdf_index_end": 8,
    }
    assert "source_refs" not in uncached_stub
    assert "source_evidence" not in uncached_stub

    with pytest.raises(assets.ModuleAssetsError, match="uncached pdf_index 7"):
        assets.put_entity(
            tmp_path,
            "bound-module",
            "location",
            "uncached-mill",
            {
                "parse_state": "deep",
                "evidence_gap": False,
                "source_page_indices": [7, 8],
            },
        )

    with pytest.raises(assets.ModuleAssetsError, match="content drift"):
        assets.put_page(tmp_path, "bound-module", 0, "different page text")


def test_source_bound_skeleton_requires_explicit_start_clock_semantics(tmp_path: Path):
    bundle, file_sha, _ = _write_host_bundle(tmp_path)
    registered = assets.register_source_bundle(
        tmp_path, bundle, asset_root_id="bound-module",
    )
    skeleton = _minimal_skeleton(
        module_identity={"canonical_module_id": "bound-module"},
        source={
            "source_id": "pdf:bound-module",
            "path": str(tmp_path / "bound-module.pdf"),
            "file_sha256": file_sha,
            "page_count": 1,
            "producer": "codex-pdf-skill",
        },
        locations=[{
            "location_id": "opening",
            "title": "Opening",
            "parse_state": "toc_only",
            "source_span": {"pdf_index_start": 0, "pdf_index_end": 0},
        }],
        edges_provisional=[],
    )
    with pytest.raises(assets.ModuleAssetsError, match="start_clock_status"):
        assets.put_skeleton(tmp_path, registered["asset_root_id"], skeleton)

    skeleton["start_clock_status"] = "source"
    skeleton["start_clock"] = {
        "local_datetime": "1975-10-12T23:15:00",
        "timezone": "local",
        "display": "1975年10月12日深夜11:15",
    }
    skeleton["start_clock_source_refs"] = [{
        "source_id": "pdf:bound-module",
        "pdf_index": 0,
    }]
    result = assets.put_skeleton(tmp_path, registered["asset_root_id"], skeleton)
    assert result["location_count"] == 1
    loaded = assets.get_skeleton(tmp_path, registered["asset_root_id"])
    assert loaded["start_clock_status"] == "source"
    assert loaded["start_clock_source_refs"][0]["text_sha256"]


def test_disjoint_source_indices_do_not_become_a_false_contiguous_span():
    target = {
        "source_span": {"pdf_index_start": 1, "pdf_index_end": 4},
    }
    assets._apply_canonical_source_scope(target, [
        {"pdf_index": 1, "text_sha256": "1" * 64},
        {"pdf_index": 4, "text_sha256": "4" * 64},
    ])
    assert target["source_page_indices"] == [1, 4]
    assert "source_span" not in target


def test_sha256_collision_on_root_id_refused(tmp_path: Path):
    assets.init_module_root(
        tmp_path, asset_root_id="mod-a", identity={}, file_sha256=FAKE_SHA,
    )
    with pytest.raises(assets.ModuleAssetsError, match="already registered"):
        assets.init_module_root(
            tmp_path, asset_root_id="mod-b", identity={}, file_sha256=FAKE_SHA,
        )


def test_cli_init_and_lookup(tmp_path: Path):
    code = assets.main([
        "--workspace", str(tmp_path),
        "init",
        "--asset-root-id", "cli-mod",
        "--file-sha256", FAKE_SHA,
        "--identity-json", json.dumps({"canonical_module_id": "cli-mod"}),
    ])
    assert code == 0
    code = assets.main([
        "--workspace", str(tmp_path),
        "lookup",
        "--file-sha256", FAKE_SHA,
    ])
    assert code == 0


def test_resolve_asset_root_id_from_sha():
    assert assets.resolve_asset_root_id(file_sha256=FAKE_SHA) == f"pdf-{FAKE_SHA[:16]}"
    assert assets.resolve_asset_root_id(canonical_module_id="cold-harvest") == "cold-harvest"
