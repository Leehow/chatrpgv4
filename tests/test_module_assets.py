#!/usr/bin/env python3
"""Tests for progressive module-assets store (slice 1)."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import shutil
import threading

import pytest

SCRIPTS = Path("plugins/coc-keeper/scripts")


def _load(name: str, rel: str):
    spec = importlib.util.spec_from_file_location(name, rel)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


assets = _load("coc_module_assets", str(SCRIPTS / "coc_module_assets.py"))
mechanics = _load("coc_mechanics_assets_test", str(SCRIPTS / "coc_mechanics.py"))

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
        "mechanics_locator_pass_status": "pending",
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


def test_put_skeleton_distinguishes_post_write_parse_tier_failure(
    tmp_path: Path, monkeypatch,
):
    assets.init_module_root(
        tmp_path,
        asset_root_id="demo-mod",
        identity={"canonical_module_id": "demo-mod"},
        file_sha256=FAKE_SHA,
    )
    real_bump = assets._bump_parse_tier

    def fail_metadata(*_args, **_kwargs):
        raise assets.ModuleAssetsError("injected parse-tier metadata failure")

    monkeypatch.setattr(assets, "_bump_parse_tier", fail_metadata)
    with pytest.raises(assets.SkeletonStorePhaseError) as raised:
        assets.put_skeleton(tmp_path, "demo-mod", _minimal_skeleton())

    error = raised.value
    assert error.stored is True
    assert error.store_result["location_count"] == 2
    assert error.metadata_error == {
        "type": "ModuleAssetsError",
        "message": "injected parse-tier metadata failure",
    }
    assert assets.get_skeleton(tmp_path, "demo-mod") == _minimal_skeleton()
    assert assets.load_registry(tmp_path)["modules"]["demo-mod"]["parse_tier_max"] == 0

    monkeypatch.setattr(assets, "_bump_parse_tier", real_bump)
    retried = assets.put_skeleton(tmp_path, "demo-mod", _minimal_skeleton())
    assert retried == error.store_result
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


def test_npc_stub_unions_overlapping_roster_and_locator_source_refs_once(
    tmp_path: Path,
):
    assets.init_module_root(
        tmp_path, asset_root_id="demo-mod", identity={}, file_sha256=FAKE_SHA,
    )
    ref = {
        "source_id": "pdf:demo",
        "pdf_index": 2,
        "text_sha256": "b" * 64,
    }
    skeleton = _minimal_skeleton(
        npc_roster=[{
            "npc_id": "npc-clerk",
            "names": ["Clerk"],
            "parse_state": "named_only",
            "source_page_indices": [2],
            "source_refs": [ref],
        }],
        mechanics_index=[{
            "subject_kind": "npc",
            "subject_id": "npc-clerk",
            "status": "located",
            "locator_pass_status": "complete",
            "locator_scope": {
                "scope_kind": "explicit_pdf_indices",
                "pdf_indices": [2],
                "source_file_sha256": FAKE_SHA,
            },
            "source_page_indices": [2],
            "source_refs": [ref],
        }],
    )
    assets.put_skeleton(tmp_path, "demo-mod", skeleton)
    assets.put_entity(
        tmp_path,
        "demo-mod",
        "npc",
        "npc-clerk",
        {"parse_state": "named_only", "source_page_indices": [0]},
    )

    scope = assets._skeleton_entity_source_scope(
        tmp_path, "demo-mod", "npc", "npc-clerk",
    )
    assert scope == {
        "source_page_indices": [2],
        "source_refs": [ref],
    }
    enriched = assets.ensure_stub(
        tmp_path, "demo-mod", "npc", "npc-clerk",
    )
    assert enriched["source_scope_updated"] is True
    assert enriched["entity"]["source_page_indices"] == [0, 2]


@pytest.mark.parametrize(
    ("identity_field", "conflicting_value"),
    [("source_id", "pdf:other"), ("text_sha256", "c" * 64)],
)
def test_skeleton_entity_scope_rejects_conflicting_same_page_source_identity(
    tmp_path: Path,
    identity_field: str,
    conflicting_value: str,
):
    assets.init_module_root(
        tmp_path, asset_root_id="demo-mod", identity={}, file_sha256=FAKE_SHA,
    )
    roster_ref = {
        "source_id": "pdf:demo",
        "pdf_index": 2,
        "text_sha256": "b" * 64,
    }
    locator_ref = {**roster_ref, identity_field: conflicting_value}
    skeleton = _minimal_skeleton(
        npc_roster=[{
            "npc_id": "npc-clerk",
            "names": ["Clerk"],
            "parse_state": "named_only",
            "source_page_indices": [2],
            "source_refs": [roster_ref],
        }],
        mechanics_index=[{
            "subject_kind": "npc",
            "subject_id": "npc-clerk",
            "status": "located",
            "locator_pass_status": "complete",
            "locator_scope": {
                "scope_kind": "explicit_pdf_indices",
                "pdf_indices": [2],
                "source_file_sha256": FAKE_SHA,
            },
            "source_page_indices": [2],
            "source_refs": [locator_ref],
        }],
    )
    assets.put_skeleton(tmp_path, "demo-mod", skeleton)

    with pytest.raises(
        assets.ModuleAssetsError,
        match=rf"skeleton scopes conflict for pdf_index 2: {identity_field} differs",
    ):
        assets._skeleton_entity_source_scope(
            tmp_path, "demo-mod", "npc", "npc-clerk",
        )


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
    bundle, _file_sha, _page_sha = _write_host_bundle(tmp_path)
    root_id = assets.register_source_bundle(
        tmp_path, bundle, asset_root_id="dialogue-source",
    )["asset_root_id"]

    with pytest.raises(
        assets.ModuleAssetsError,
        match="requires unique non-empty source_npc_ids",
    ):
        assets.put_entity(tmp_path, root_id, "location", "station", {
            "schema_version": 1,
            "location_id": "station",
            "parse_state": "deep",
            "source_page_indices": [0],
            "clues": [{
                "clue_id": "clue-warning",
                "delivery_kind": "npc_dialogue",
                "player_safe_summary": "店主含蓄地劝外来者离开。",
                "discovery": {
                    "mode": "automatic",
                    "skill": None,
                    "difficulty": None,
                },
                "provenance": {
                    "authority": "source_authored",
                    "source_refs": [{"pdf_index": 0}],
                },
                "source_refs": [{"pdf_index": 0}],
            }],
        })


def _write_host_bundle(
    tmp_path: Path,
    *,
    page_count: int = 1,
    include_page_one: bool = False,
) -> tuple[Path, str, str]:
    pdf = tmp_path / "bound-module.pdf"
    pdf.write_bytes(b"%PDF validated host fixture")
    bundle = tmp_path / "bound-source"
    bundle.mkdir()
    page_bytes = b"# Hospital\n\nDr Percival guards a source-bound secret.\n"
    (bundle / "page-0000.md").write_bytes(page_bytes)
    pages = [{
        "pdf_index": 0,
        "markdown_path": "page-0000.md",
        "text_sha256": hashlib.sha256(page_bytes).hexdigest(),
        "review_state": "manual_accepted",
        "parse_confidence": 0.94,
        "grep_anchors": ["Dr Percival guards a source-bound secret."],
    }]
    if include_page_one:
        appendix_bytes = b"# Appendix\n\nA complete accepted mechanics appendix.\n"
        (bundle / "page-0001.md").write_bytes(appendix_bytes)
        pages.append({
            "pdf_index": 1,
            "markdown_path": "page-0001.md",
            "text_sha256": hashlib.sha256(appendix_bytes).hexdigest(),
            "review_state": "manual_accepted",
            "parse_confidence": 0.97,
            "grep_anchors": ["A complete accepted mechanics appendix."],
        })
    file_sha = hashlib.sha256(pdf.read_bytes()).hexdigest()
    (bundle / "manifest.json").write_text(json.dumps({
        "schema_version": 1,
        "producer": "codex-pdf-skill",
        "source": {
            "source_id": "pdf:bound-module",
            "title": "Bound Module",
            "path": str(pdf),
            "file_sha256": file_sha,
            "page_count": page_count,
        },
        "pages": pages,
    }), encoding="utf-8")
    return bundle, file_sha, hashlib.sha256(page_bytes).hexdigest()


def _write_revision_bundle(
    tmp_path: Path,
    *,
    name: str,
    pdf_index: int,
    revision: int,
    text: bytes,
) -> Path:
    pdf = tmp_path / "revision-source.pdf"
    if not pdf.is_file():
        pdf.write_bytes(b"%PDF revision source fixture")
    bundle = tmp_path / name
    bundle.mkdir()
    (bundle / "page.md").write_bytes(text)
    (bundle / "manifest.json").write_text(json.dumps({
        "schema_version": 1,
        "producer": "codex-pdf-skill",
        "source": {
            "source_id": "pdf:revision-source",
            "title": "Revision Source",
            "path": str(pdf),
            "file_sha256": hashlib.sha256(pdf.read_bytes()).hexdigest(),
            "page_count": 2,
        },
        "pages": [{
            "pdf_index": pdf_index,
            "markdown_path": "page.md",
            "text_sha256": hashlib.sha256(text).hexdigest(),
            "review_state": "manual_accepted",
            "parse_confidence": 1.0,
            "grep_anchors": [],
            "ocr_revision": {
                "stable_id": f"page:{pdf_index}:fast",
                "pdf_index": pdf_index,
                "layer": "fast",
                "revision": revision,
                "content_sha256": hashlib.sha256(
                    b"ocr:" + text
                ).hexdigest(),
            },
        }],
    }), encoding="utf-8")
    return bundle


def test_exact_opening_window_and_partial_job_are_scope_bound(
    tmp_path: Path, monkeypatch,
):
    bundle, _file_sha, _page_sha = _write_host_bundle(
        tmp_path, page_count=2, include_page_one=True,
    )
    registration = assets.register_source_bundle(
        tmp_path, bundle, asset_root_id="opening-exact",
    )

    class NoopWorker:
        @staticmethod
        def kick_background_worker(_workspace):
            return {"started": False, "reason": "test"}

    monkeypatch.setattr(assets, "_load_sibling", lambda *_args: NoopWorker)
    scope = assets.validate_opening_source_window(
        tmp_path,
        "opening-exact",
        bundle_sha256=registration["bundle_sha256"],
        pdf_indices=[1, 0],
    )
    assert scope["pdf_indices"] == [0, 1]
    assert [row["pdf_index"] for row in scope["page_refs"]] == [0, 1]
    assert all(len(row["text_sha256"]) == 64 for row in scope["page_refs"])

    first = assets.enqueue_job(
        tmp_path,
        "opening-exact",
        kind="partial_opening",
        target_id="opening",
        priority=1,
        request_purpose=assets.FOREGROUND_OPENING_PURPOSE,
        requested_source_scope=scope,
    )
    assert first["job"]["priority"] == 100
    assert first["job"]["requested_source_scope"] == scope
    repeated = assets.enqueue_job(
        tmp_path,
        "opening-exact",
        kind="partial_opening",
        target_id="opening",
        request_purpose=assets.FOREGROUND_OPENING_PURPOSE,
        requested_source_scope=scope,
    )
    assert repeated["deduped"] is True
    assert repeated["job"]["job_id"] == first["job"]["job_id"]

    narrower = assets.validate_opening_source_window(
        tmp_path,
        "opening-exact",
        bundle_sha256=registration["bundle_sha256"],
        pdf_indices=[0],
    )
    with pytest.raises(assets.ModuleAssetsError, match="opening_source_scope_conflict"):
        assets.enqueue_job(
            tmp_path,
            "opening-exact",
            kind="partial_opening",
            target_id="opening",
            request_purpose=assets.FOREGROUND_OPENING_PURPOSE,
            requested_source_scope=narrower,
        )

    reversed_scope = json.loads(json.dumps(scope))
    reversed_scope["pdf_indices"] = [1, 0]
    with pytest.raises(assets.ModuleAssetsError, match="canonical ascending"):
        assets.validate_opening_source_scope(
            tmp_path, "opening-exact", reversed_scope,
        )


def test_opening_page_candidate_catalog_is_bundle_scoped_and_meta_only(
    tmp_path: Path, monkeypatch,
):
    first_bundle, file_sha, _page_sha = _write_host_bundle(
        tmp_path, page_count=3, include_page_one=True,
    )
    first = assets.register_source_bundle(
        tmp_path, first_bundle, asset_root_id="opening-catalog",
    )
    second_bundle = tmp_path / "bound-source-second"
    second_bundle.mkdir()
    long_anchor = "开场线索" * 40
    page_two = f"# Later Place\n\n{long_anchor}\n".encode()
    (second_bundle / "page-0002.md").write_bytes(page_two)
    (second_bundle / "manifest.json").write_text(json.dumps({
        "schema_version": 1,
        "producer": "codex-pdf-skill",
        "source": {
            "source_id": "pdf:bound-module",
            "title": "Bound Module",
            "path": str(tmp_path / "bound-module.pdf"),
            "file_sha256": file_sha,
            "page_count": 3,
        },
        "pages": [{
            "pdf_index": 2,
            "markdown_path": "page-0002.md",
            "text_sha256": hashlib.sha256(page_two).hexdigest(),
            "review_state": "auto_accepted",
            "parse_confidence": 0.91,
            "grep_anchors": [long_anchor],
        }],
    }), encoding="utf-8")
    second = assets.register_source_bundle(
        tmp_path, second_bundle, asset_root_id="opening-catalog",
    )

    original_read_text = Path.read_text

    def reject_page_body_reads(path: Path, *args, **kwargs):
        if path.suffix == ".md":
            raise AssertionError("candidate catalog must not read page bodies")
        return original_read_text(path, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", reject_page_body_reads)
    catalog = assets.opening_page_candidate_catalog(
        tmp_path,
        "opening-catalog",
        bundle_sha256=first["bundle_sha256"],
    )
    assert [row["pdf_index"] for row in catalog["opening_page_candidates"]] == [
        0, 1,
    ]
    assert catalog["opening_page_candidate_total"] == 2
    assert catalog["opening_page_candidate_complete"] is True
    assert catalog["opening_page_candidate_role"] == (
        "selection_hint_only_not_provenance"
    )
    assert all(
        set(row) == {
            "pdf_index", "review_state", "parse_confidence",
            "grep_anchor_preview",
        }
        for row in catalog["opening_page_candidates"]
    )
    assert all(
        len(row["grep_anchor_preview"].encode("utf-8"))
        <= assets.OPENING_PAGE_CANDIDATE_PREVIEW_MAX_BYTES
        for row in catalog["opening_page_candidates"]
    )
    second_catalog = assets.opening_page_candidate_catalog(
        tmp_path,
        "opening-catalog",
        bundle_sha256=second["bundle_sha256"],
    )
    assert [
        row["pdf_index"] for row in second_catalog["opening_page_candidates"]
    ] == [2]
    second_preview = second_catalog["opening_page_candidates"][0][
        "grep_anchor_preview"
    ]
    assert second_preview.endswith("...")
    assert len(second_preview.encode("utf-8")) <= (
        assets.OPENING_PAGE_CANDIDATE_PREVIEW_MAX_BYTES
    )


@pytest.mark.parametrize(
    "corruption, error_match",
    [
        ("review_state", "accepted review state"),
        ("source_id", "different source_id"),
        ("file_sha256", "different source file identity"),
        ("bundle_sha256", "not bound to the selected source bundle"),
    ],
)
def test_opening_page_candidate_catalog_rejects_drifted_meta(
    tmp_path: Path, corruption: str, error_match: str,
):
    bundle, _file_sha, _page_sha = _write_host_bundle(tmp_path)
    registration = assets.register_source_bundle(
        tmp_path, bundle, asset_root_id="opening-catalog-drift",
    )
    meta_path = (
        assets._module_dir(tmp_path, "opening-catalog-drift")
        / "pages" / "0000.meta.json"
    )
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    if corruption == "review_state":
        meta["review_state"] = "pending"
    elif corruption == "source_id":
        meta["source_id"] = "pdf:different"
    elif corruption == "file_sha256":
        meta["file_sha256"] = "b" * 64
    else:
        meta["bundle_sha256"] = "b" * 64
        meta["bundle_sha256s"] = []
    meta_path.write_text(json.dumps(meta), encoding="utf-8")

    with pytest.raises(assets.ModuleAssetsError, match=error_match):
        assets.opening_page_candidate_catalog(
            tmp_path,
            "opening-catalog-drift",
            bundle_sha256=registration["bundle_sha256"],
        )


def _write_opening_host_request(
    workspace: Path,
    asset_root_id: str,
    *,
    job_id: str,
    scope: dict,
) -> Path:
    path = (
        assets._module_dir(workspace, asset_root_id)
        / "host-work"
        / f"{job_id}.json"
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    assets._write_json(path, {
        "schema_version": assets.HOST_WORK_SCHEMA_VERSION,
        "job_id": job_id,
        "asset_root_id": asset_root_id,
        "kind": "partial_opening",
        "target_id": "opening",
        "status": "open",
        "dispatch_state": "ready",
        "created_at": "2026-07-20T00:00:00+00:00",
        "source_id": scope["source_id"],
        "file_sha256": scope["file_sha256"],
        "requested_pdf_indices": list(scope["pdf_indices"]),
        "requested_source_scope": json.loads(json.dumps(scope)),
        "request_purpose": assets.FOREGROUND_OPENING_PURPOSE,
        "source_scope_signature": assets.opening_source_scope_signature(scope),
        "cached_page_refs": json.loads(json.dumps(scope["page_refs"])),
        "cached_scope_complete": True,
        "work_level": "current_dependency",
        "dependency_ref": {
            "operation": "progressive.project_opening",
            "subject": {"kind": "location", "id": "opening"},
            "source_scope_signature": assets.opening_source_scope_signature(
                scope
            ),
        },
    })
    return path


def test_fulfilled_pack_receipt_tracks_exact_current_canonical_content(
    tmp_path: Path,
):
    bundle, _file_sha, _page_sha = _write_host_bundle(
        tmp_path, page_count=2, include_page_one=True,
    )
    registration = assets.register_source_bundle(
        tmp_path, bundle, asset_root_id="opening-receipt",
    )
    first_scope = assets.validate_opening_source_window(
        tmp_path,
        "opening-receipt",
        bundle_sha256=registration["bundle_sha256"],
        pdf_indices=[0],
    )
    first_request_path = _write_opening_host_request(
        tmp_path,
        "opening-receipt",
        job_id="job-opening-first",
        scope=first_scope,
    )
    initial_pack = {
        "location_id": "opening",
        "parse_state": "partial",
        "evidence_gap": False,
        "source_page_indices": [0],
        "player_safe_summary": "First fulfilled authored opening.",
        "host_work_job_id": "job-opening-first",
        "host_timing": {
            "started_at": "2026-07-20T00:00:00+00:00",
            "completed_at": "2026-07-20T00:00:01+00:00",
            "duration_ms": 1000,
        },
    }
    assets.put_entity(
        tmp_path, "opening-receipt", "location", "opening", initial_pack,
    )

    stored = assets.get_entity(
        tmp_path, "opening-receipt", "location", "opening",
    )
    assert "host_work_job_id" not in stored
    assert "host_work_job_id" not in stored["ingest_timing"]
    request = json.loads(first_request_path.read_text(encoding="utf-8"))
    expected_entity = assets.canonical_fulfilled_entity_receipt(
        "location", "opening", stored,
    )
    expected_ingest = {
        "job_id": "job-opening-first",
        **expected_entity,
    }
    assert request["fulfilled_entity"] == expected_entity
    assert assets.current_ingest_fulfillment_receipt(stored) == expected_ingest
    assert assets.fulfilled_request_matches_current_pack(
        request, stored, kind="location", entity_id="opening",
    ) is True

    # Repository timing/queue metadata is outside the semantic receipt.  The
    # unchanged reuse path keeps the exact first fulfillment instead of
    # rewriting the already-closed request.
    first_fulfilled_at = request["fulfilled_at"]
    entity_path = (
        tmp_path / ".coc" / "module-assets" / "opening-receipt"
        / "entities" / "location-opening.json"
    )
    legacy_stored = json.loads(entity_path.read_text(encoding="utf-8"))
    legacy_stored["ingest_timing"]["host_work_job_id"] = (
        "job-opening-first"
    )
    entity_path.write_text(
        json.dumps(legacy_stored, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    unchanged = json.loads(json.dumps(stored))
    unchanged["dig_pending"] = True
    unchanged["host_timing"] = {
        "started_at": "2026-07-20T00:01:00+00:00",
        "completed_at": "2026-07-20T00:01:09+00:00",
        "duration_ms": 9000,
    }
    assets.put_entity(
        tmp_path, "opening-receipt", "location", "opening", unchanged,
    )
    reused = assets.get_entity(
        tmp_path, "opening-receipt", "location", "opening",
    )
    assert assets.current_ingest_fulfillment_receipt(reused) == expected_ingest
    assert "host_work_job_id" not in reused["ingest_timing"]
    assert reused["ingest_timing"]["pack_reuse_count"] == 1
    assert json.loads(first_request_path.read_text(encoding="utf-8"))[
        "fulfilled_at"
    ] == first_fulfilled_at

    # Copying the old top-level selector cannot authorize changed content.
    changed = json.loads(json.dumps(reused))
    changed["player_safe_summary"] = "Replacement text after fulfillment."
    changed["host_work_job_id"] = "job-opening-first"
    assets.put_entity(
        tmp_path, "opening-receipt", "location", "opening", changed,
    )
    rewritten = assets.get_entity(
        tmp_path, "opening-receipt", "location", "opening",
    )
    assert "host_work_job_id" not in rewritten
    assert assets.current_ingest_fulfillment_receipt(rewritten) is None
    assert assets.fulfilled_request_matches_current_pack(
        request, rewritten, kind="location", entity_id="opening",
    ) is False

    # A source-evidence rewrite is likewise different content and remains
    # unbound until a newly live matching request is fulfilled.
    evidence_changed = json.loads(json.dumps(rewritten))
    evidence_changed["source_page_indices"] = [1]
    evidence_changed["host_work_job_id"] = "job-opening-first"
    for field in (
        "source_refs", "source_span", "page_text_sha256", "source_evidence",
    ):
        evidence_changed.pop(field, None)
    assets.put_entity(
        tmp_path,
        "opening-receipt",
        "location",
        "opening",
        evidence_changed,
    )
    unbound_page_one = assets.get_entity(
        tmp_path, "opening-receipt", "location", "opening",
    )
    assert unbound_page_one["source_page_indices"] == [1]
    assert assets.current_ingest_fulfillment_receipt(unbound_page_one) is None

    replacement_scope = assets.validate_opening_source_window(
        tmp_path,
        "opening-receipt",
        bundle_sha256=registration["bundle_sha256"],
        pdf_indices=[1],
    )
    replacement_request_path = _write_opening_host_request(
        tmp_path,
        "opening-receipt",
        job_id="job-opening-replacement",
        scope=replacement_scope,
    )
    replacement = json.loads(json.dumps(unbound_page_one))
    replacement["host_work_job_id"] = "job-opening-replacement"
    assets.put_entity(
        tmp_path, "opening-receipt", "location", "opening", replacement,
    )
    rebound = assets.get_entity(
        tmp_path, "opening-receipt", "location", "opening",
    )
    replacement_request = json.loads(
        replacement_request_path.read_text(encoding="utf-8")
    )
    assert assets.current_ingest_fulfillment_receipt(rebound)["job_id"] == (
        "job-opening-replacement"
    )
    assert assets.fulfilled_request_matches_current_pack(
        replacement_request, rebound, kind="location", entity_id="opening",
    ) is True


def test_fulfilled_pack_receipt_rejects_each_request_or_ingest_mismatch(
    tmp_path: Path,
):
    doc = {
        "schema_version": 1,
        "location_id": "opening",
        "parse_state": "partial",
        "player_safe_summary": "Canonical content.",
        "source_evidence": {
            "schema_version": 1,
            "source_id": "pdf:test",
            "file_sha256": "a" * 64,
            "bundle_sha256s": ["b" * 64],
            "pdf_indices": [0],
            "page_text_sha256": ["c" * 64],
        },
    }
    entity_receipt = assets.canonical_fulfilled_entity_receipt(
        "location", "opening", doc,
    )
    current = {
        **doc,
        "ingest_timing": {
            assets.FULFILLED_PACK_INGEST_FIELD: {
                "job_id": "job-exact",
                **entity_receipt,
            },
        },
    }
    request = {
        "job_id": "job-exact",
        "status": "fulfilled",
        "fulfilled_entity": entity_receipt,
    }
    assert assets.fulfilled_request_matches_current_pack(
        request, current, kind="location", entity_id="opening",
    ) is True

    for field, replacement in (
        ("kind", "npc"),
        ("entity_id", "other"),
        ("fulfilled_pack_sha256", "d" * 64),
        ("source_evidence_sha256", "e" * 64),
    ):
        mismatched_request = json.loads(json.dumps(request))
        mismatched_request["fulfilled_entity"][field] = replacement
        assert assets.fulfilled_request_matches_current_pack(
            mismatched_request,
            current,
            kind="location",
            entity_id="opening",
        ) is False

    stale_current = json.loads(json.dumps(current))
    stale_current["ingest_timing"][assets.FULFILLED_PACK_INGEST_FIELD][
        "fulfilled_pack_sha256"
    ] = "f" * 64
    assert assets.fulfilled_request_matches_current_pack(
        request, stale_current, kind="location", entity_id="opening",
    ) is False


@pytest.mark.parametrize(
    "indices, message",
    [
        ([], "1..3"),
        ([0, 0], "duplicates"),
        ([0, 2], "contiguous"),
        ([0, 1, 2, 3], "1..3"),
    ],
)
def test_opening_window_rejects_invalid_shapes(
    tmp_path: Path, indices: list[int], message: str,
):
    bundle, _file_sha, _page_sha = _write_host_bundle(
        tmp_path, page_count=2, include_page_one=True,
    )
    registration = assets.register_source_bundle(
        tmp_path, bundle, asset_root_id="opening-window-invalid",
    )
    with pytest.raises(assets.ModuleAssetsError, match=message):
        assets.validate_opening_source_window(
            tmp_path,
            "opening-window-invalid",
            bundle_sha256=registration["bundle_sha256"],
            pdf_indices=indices,
        )


def _source_bound_skeleton(
    tmp_path: Path,
    file_sha: str,
    *,
    page_count: int,
    mechanics_index: list[dict],
    global_pass: str = "pending",
    global_scope: dict | None = None,
) -> dict:
    skeleton = _minimal_skeleton(
        module_identity={"canonical_module_id": "bound-module"},
        source={
            "source_id": "pdf:bound-module",
            "path": str(tmp_path / "bound-module.pdf"),
            "file_sha256": file_sha,
            "page_count": page_count,
            "producer": "codex-pdf-skill",
        },
        mechanics_locator_pass_status=global_pass,
        mechanics_index=mechanics_index,
        start_clock_status="unresolved",
    )
    if global_scope is not None:
        skeleton["mechanics_locator_scope"] = global_scope
    return skeleton


def _absence_row(*, pdf_index: int, file_sha: str) -> dict:
    scope = {
        "scope_kind": "explicit_pdf_indices",
        "pdf_indices": [pdf_index],
        "source_file_sha256": file_sha,
    }
    return {
        "subject_kind": "npc",
        "subject_id": "npc-clerk",
        "status": "not_authored",
        "locator_pass_status": "complete",
        "locator_scope": scope,
        "absence_receipt": {
            "review_state": "manual_accepted",
            "checked_scope": json.loads(json.dumps(scope)),
            "source_file_sha256": file_sha,
        },
    }


def _source_actor_record(
    pdf_index: int,
    *,
    source_id: str = "pdf:bound-module",
    provenance_refs: list[dict] | None = None,
) -> dict:
    extracted = {
        "characteristics.STR",
        "characteristics.CON",
        "characteristics.SIZ",
        "characteristics.DEX",
        "characteristics.POW",
    }
    provenance: dict = {"authority": "source_authored"}
    if provenance_refs is not None:
        provenance["source_refs"] = provenance_refs
    return {
        "status": "authored",
        "source_refs": [{"source_id": source_id, "pdf_index": pdf_index}],
        "fields_observed": sorted(extracted),
        "fields_extracted": sorted(extracted),
        "fields_not_authored": sorted(mechanics.ACTOR_FIELD_IDS - extracted),
        "provenance": provenance,
        "profile": {
            "profile_kind": "actor",
            "authority": "source_authored",
            "characteristic_scale": "percentile",
            "characteristics": {
                "STR": 60, "CON": 50, "SIZ": 65, "DEX": 55, "POW": 45,
            },
        },
    }


_PARALLEL_PROVENANCE_SOURCE_FIELDS = [
    ("source_page_indices", [999]),
    ("source_span", {"pdf_index_start": 999, "pdf_index_end": 999}),
    ("page_text_sha256", ["b" * 64]),
    ("source_evidence", {
        "schema_version": 1,
        "source_id": "pdf:foreign",
        "file_sha256": "b" * 64,
        "bundle_sha256s": ["b" * 64],
        "pdf_indices": [999],
        "page_text_sha256": ["b" * 64],
    }),
]


def _automatic_clue(clue_id: str) -> dict:
    return {
        "clue_id": clue_id,
        "player_safe_summary": "Automatic source-bound clue.",
        "delivery_kind": "obvious",
        "discovery": {
            "mode": "automatic",
            "skill": None,
            "difficulty": None,
        },
        "source_refs": [{
            "source_id": "pdf:bound-module",
            "pdf_index": 0,
        }],
        "provenance": {"authority": "source_authored"},
    }


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
                "discovery": {
                    "mode": "automatic",
                    "skill": None,
                    "difficulty": None,
                },
                "provenance": {
                    "authority": "source_authored",
                    "source_refs": [{"pdf_index": 0}],
                },
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


def test_source_bundle_caches_structured_ocr_once_and_projects_bounded_ref(
    tmp_path: Path,
):
    bundle, _file_sha, _producer_page_sha = _write_host_bundle(tmp_path)
    structured = {
        "schema_version": 1,
        "producer": "baidu-paddleocr-jobs",
        "model": "PaddleOCR-VL-1.6",
        "source_page_ordinal": 0,
        "dataInfo": {"width": 1200, "height": 1600, "type": "image"},
        "prunedResult": {
            "parsing_res_list": [{
                "block_label": "text",
                "block_content": "Dr Percival guards a source-bound secret.",
                "block_bbox": [1, 2, 3, 4],
            }],
        },
    }
    structured_bytes = (
        json.dumps(structured, ensure_ascii=False, sort_keys=True) + "\n"
    ).encode("utf-8")
    structured_path = bundle / "page-0000.ocr.json"
    structured_path.write_bytes(structured_bytes)
    manifest = json.loads(
        (bundle / "manifest.json").read_text(encoding="utf-8")
    )
    manifest["pages"][0]["structured_data"] = {
        "path": "page-0000.ocr.json",
        "sha256": hashlib.sha256(structured_bytes).hexdigest(),
        "format": "paddleocr-vl-layout-v1",
        "producer": "baidu-paddleocr-jobs",
        "model": "PaddleOCR-VL-1.6",
    }
    (bundle / "manifest.json").write_text(
        json.dumps(manifest), encoding="utf-8"
    )

    registered = assets.register_source_bundle(
        tmp_path, bundle, asset_root_id="bound-module-ocr",
    )
    page = assets.get_page(tmp_path, registered["asset_root_id"], 0)
    assert page is not None
    structured_cache_path = Path(page["meta"]["structured_data_path"])
    assert structured_cache_path.read_bytes() == structured_bytes
    refs = assets._cached_source_refs(
        tmp_path,
        registered["asset_root_id"],
        {"source_page_indices": [0]},
        field="test_structured_ocr",
    )
    assert refs[0]["structured_data"] == {
        "path": str(structured_cache_path.resolve()),
        "sha256": hashlib.sha256(structured_bytes).hexdigest(),
        "format": "paddleocr-vl-layout-v1",
        "producer": "baidu-paddleocr-jobs",
        "model": "PaddleOCR-VL-1.6",
    }


def test_revisioned_pages_publish_fast_then_detail_and_pin_exact_refs(tmp_path: Path):
    bundle, _file_sha, _ = _write_host_bundle(tmp_path)
    manifest = json.loads((bundle / "manifest.json").read_text(encoding="utf-8"))
    manifest["pages"][0]["ocr_revision"] = {
        "stable_id": "page:0:fast", "pdf_index": 0, "layer": "fast",
        "revision": 1, "content_sha256": "a" * 64,
        "fast_confidence_revision": 1,
    }
    (bundle / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    first = assets.register_source_bundle(tmp_path, bundle, asset_root_id="revisioned")
    fast_ref = assets._cached_source_refs(
        tmp_path, "revisioned", {"source_page_indices": [0]}, field="fast",
    )[0]
    assert fast_ref["ocr_revision"]["layer"] == "fast"

    detail = tmp_path / "detail-source"
    detail.mkdir()
    detail_bytes = b"# Hospital\n\nDetailed layout-backed text.\n"
    (detail / "page.md").write_bytes(detail_bytes)
    structured = {
        "schema_version": 1, "producer": "baidu-paddleocr-jobs",
        "model": "PaddleOCR-VL-1.6", "prunedResult": {"blocks": []},
    }
    structured_bytes = (json.dumps(structured, sort_keys=True) + "\n").encode()
    (detail / "layout.json").write_bytes(structured_bytes)
    detail_manifest = {
        **manifest,
        "pages": [{
            "pdf_index": 0, "markdown_path": "page.md",
            "text_sha256": hashlib.sha256(detail_bytes).hexdigest(),
            "review_state": "manual_accepted", "parse_confidence": 0.95,
            "grep_anchors": ["Detailed layout-backed text."],
            "ocr_revision": {
                "stable_id": "page:0:detail", "pdf_index": 0,
                "layer": "detail", "revision": 1,
                "content_sha256": "b" * 64,
                "fast_confidence_revision": 1,
            },
            "structured_data": {
                "path": "layout.json",
                "sha256": hashlib.sha256(structured_bytes).hexdigest(),
                "format": "paddleocr-vl-layout-v1",
                "producer": "baidu-paddleocr-jobs",
                "model": "PaddleOCR-VL-1.6",
            },
        }],
    }
    (detail / "manifest.json").write_text(json.dumps(detail_manifest), encoding="utf-8")
    second = assets.register_source_bundle(tmp_path, detail, asset_root_id="revisioned")
    page = assets.get_page(tmp_path, "revisioned", 0)
    assert page["text"] == detail_bytes.decode()
    detail_ref = assets._cached_source_refs(
        tmp_path, "revisioned", {"source_page_indices": [0]}, field="detail",
    )[0]
    assert detail_ref["ocr_revision"]["layer"] == "detail"
    assert detail_ref["ocr_revision"]["revision"] == 1
    assert detail_ref["bundle_sha256s"] == [second["bundle_sha256"]]
    assert detail_ref["bundle_sha256s"] != [first["bundle_sha256"]]

    (detail / "page.md").write_bytes(b"changed same revision\n")
    detail_manifest["pages"][0]["text_sha256"] = hashlib.sha256(
        b"changed same revision\n"
    ).hexdigest()
    detail_manifest["pages"][0]["grep_anchors"] = []
    (detail / "manifest.json").write_text(json.dumps(detail_manifest), encoding="utf-8")
    with pytest.raises(assets.ModuleAssetsError, match="immutable revision hash drift"):
        assets.register_source_bundle(tmp_path, detail, asset_root_id="revisioned")


def test_revisioned_page_same_revision_is_noop_and_history_does_not_move_head(
    tmp_path: Path,
):
    assets.init_module_root(
        tmp_path, asset_root_id="revision-order",
        identity={"canonical_module_id": "revision-order"},
        file_sha256=FAKE_SHA,
    )
    base_meta = {
        "source_id": "pdf:revision-order", "file_sha256": FAKE_SHA,
        "review_state": "manual_accepted", "parse_confidence": 1.0,
        "grep_anchors": [], "bundle_sha256": "b" * 64,
    }
    revision_one = {
        "stable_id": "page:0:fast", "pdf_index": 0, "layer": "fast",
        "revision": 1, "content_sha256": "d" * 64,
    }
    first = assets.put_page(
        tmp_path, "revision-order", 0, "older\n",
        meta={**base_meta, "ocr_revision": revision_one},
    )
    revision_two = {
        "stable_id": "page:0:fast", "pdf_index": 0, "layer": "fast",
        "revision": 2, "content_sha256": "c" * 64,
    }
    second = assets.put_page(
        tmp_path, "revision-order", 0, "stable\n",
        meta={**base_meta, "ocr_revision": revision_two},
    )
    repeated = assets.put_page(
        tmp_path, "revision-order", 0, "older\n",
        meta={**base_meta, "ocr_revision": revision_one},
    )
    assert first["reused"] is False
    assert second["reused"] is False
    assert repeated["reused"] is True
    head = json.loads((
        tmp_path / ".coc/module-assets/revision-order/pages/0000/fast/head.json"
    ).read_text(encoding="utf-8"))
    assert head["active_revision"] == 2


def test_historical_page_bundle_reregistration_and_backfill_keep_active_head(
    tmp_path: Path,
):
    revision_one = _write_revision_bundle(
        tmp_path, name="revision-one", pdf_index=0, revision=1,
        text=b"Fast revision one\n",
    )
    revision_two = _write_revision_bundle(
        tmp_path, name="revision-two", pdf_index=0, revision=2,
        text=b"Fast revision two\n",
    )
    first = assets.register_source_bundle(
        tmp_path, revision_one, asset_root_id="historical-reregister",
    )
    second = assets.register_source_bundle(
        tmp_path, revision_two, asset_root_id="historical-reregister",
    )
    repeated = assets.register_source_bundle(
        tmp_path, revision_one, asset_root_id="historical-reregister",
    )
    assert repeated["reused_page_count"] == 1
    root = tmp_path / ".coc/module-assets/historical-reregister"
    head = json.loads((root / "pages/0000/fast/head.json").read_text())
    assert head["active_revision"] == 2
    identity = json.loads((root / "identity.json").read_text())
    assert {row["bundle_sha256"] for row in identity["source_bundles"]} == {
        first["bundle_sha256"], second["bundle_sha256"],
    }

    backfill_root = "historical-backfill"
    backfill_workspace = tmp_path / "backfill-workspace"
    backfill_workspace.mkdir()
    assets.register_source_bundle(
        backfill_workspace, revision_two, asset_root_id=backfill_root,
    )
    backfilled = assets.register_source_bundle(
        backfill_workspace, revision_one, asset_root_id=backfill_root,
    )
    assert backfilled["new_page_count"] == 1
    backfill_path = backfill_workspace / ".coc/module-assets" / backfill_root
    backfill_head = json.loads((
        backfill_path / "pages/0000/fast/head.json"
    ).read_text())
    assert backfill_head["active_revision"] == 2
    assert sorted(path.name for path in (
        backfill_path / "pages/0000/fast/revisions"
    ).iterdir()) == ["000001", "000002"]


def test_concurrent_page_publications_cannot_overwrite_one_revision_slot(
    tmp_path: Path,
):
    assets.init_module_root(
        tmp_path, asset_root_id="page-concurrency",
        identity={"canonical_module_id": "page-concurrency"},
        file_sha256=FAKE_SHA,
    )
    barrier = threading.Barrier(2)

    def publish(text: str) -> str:
        barrier.wait()
        content_sha = hashlib.sha256(text.encode()).hexdigest()
        assets.put_page(
            tmp_path, "page-concurrency", 0, text,
            meta={
                "source_id": "pdf:page-concurrency",
                "file_sha256": FAKE_SHA,
                "review_state": "manual_accepted",
                "parse_confidence": 1.0,
                "grep_anchors": [],
                "ocr_revision": {
                    "stable_id": "page:0:fast", "pdf_index": 0,
                    "layer": "fast", "revision": 1,
                    "content_sha256": content_sha,
                },
            },
        )
        return text

    successes: list[str] = []
    failures: list[Exception] = []
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(publish, text) for text in ("alpha", "beta")]
        for future in futures:
            try:
                successes.append(future.result())
            except Exception as exc:  # noqa: BLE001 - assertion captures contract
                failures.append(exc)
    assert len(successes) == 1
    assert len(failures) == 1
    assert "immutable revision hash drift" in str(failures[0])
    stored = assets.get_page(tmp_path, "page-concurrency", 0)
    assert stored["text"] == successes[0] + "\n"


def test_concurrent_bundle_registrations_retain_both_identity_rows(tmp_path: Path):
    first_bundle = _write_revision_bundle(
        tmp_path, name="concurrent-bundle-zero", pdf_index=0, revision=1,
        text=b"Concurrent page zero\n",
    )
    second_bundle = _write_revision_bundle(
        tmp_path, name="concurrent-bundle-one", pdf_index=1, revision=1,
        text=b"Concurrent page one\n",
    )
    barrier = threading.Barrier(2)

    def register(bundle: Path) -> dict:
        barrier.wait()
        return assets.register_source_bundle(
            tmp_path, bundle, asset_root_id="bundle-concurrency",
        )

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(register, (first_bundle, second_bundle)))
    identity = json.loads((
        tmp_path / ".coc/module-assets/bundle-concurrency/identity.json"
    ).read_text(encoding="utf-8"))
    assert {row["bundle_sha256"] for row in identity["source_bundles"]} == {
        row["bundle_sha256"] for row in results
    }
    assert {tuple(row["pdf_indices"]) for row in identity["source_bundles"]} == {
        (0,), (1,),
    }


def test_authored_npc_mechanics_revisions_are_semantic_and_immutable(tmp_path: Path):
    bundle, _file_sha, _ = _write_host_bundle(tmp_path)
    root_id = assets.register_source_bundle(
        tmp_path, bundle, asset_root_id="npc-revisions",
    )["asset_root_id"]
    first_payload = {
        "parse_state": "named_only",
        "mechanics": _source_actor_record(0),
    }
    assets.put_entity(tmp_path, root_id, "npc", "keeper", first_payload)
    first = assets.get_entity(tmp_path, root_id, "npc", "keeper")
    assert first["mechanics_revision_ref"]["revision"] == 1
    assets.put_entity(tmp_path, root_id, "npc", "keeper", first)
    repeated = assets.get_entity(tmp_path, root_id, "npc", "keeper")
    assert repeated["mechanics_revision_ref"] == first["mechanics_revision_ref"]

    second_payload = json.loads(json.dumps(first_payload))
    second_payload["mechanics"]["profile"]["characteristics"]["DEX"] = 65
    assets.put_entity(tmp_path, root_id, "npc", "keeper", second_payload)
    second = assets.get_entity(tmp_path, root_id, "npc", "keeper")
    assert second["mechanics_revision_ref"]["revision"] == 2
    assert second["mechanics_revision_ref"]["content_sha256"] != first[
        "mechanics_revision_ref"
    ]["content_sha256"]
    history = (
        tmp_path / ".coc/module-assets" / root_id /
        "entities/npc-keeper-mechanics/revisions"
    )
    assert sorted(path.name for path in history.glob("*.json")) == [
        "000001.json", "000002.json",
    ]


def _make_authored_npc_legacy(
    tmp_path: Path, root_id: str, npc_id: str, payload: dict,
) -> dict:
    assets.put_entity(tmp_path, root_id, "npc", npc_id, payload)
    entity_path = (
        tmp_path / ".coc/module-assets" / root_id / "entities" /
        f"npc-{npc_id}.json"
    )
    legacy = json.loads(entity_path.read_text(encoding="utf-8"))
    legacy.pop("mechanics_revision_ref", None)
    entity_path.write_text(json.dumps(legacy), encoding="utf-8")
    revision_root = entity_path.parent / f"npc-{npc_id}-mechanics"
    shutil.rmtree(revision_root)
    return legacy


@pytest.mark.parametrize("changed", [False, True])
def test_legacy_authored_npc_bootstraps_previous_mechanics_before_candidate(
    tmp_path: Path, changed: bool,
):
    bundle, _file_sha, _ = _write_host_bundle(tmp_path)
    root_id = assets.register_source_bundle(
        tmp_path, bundle, asset_root_id=f"legacy-npc-{changed}",
    )["asset_root_id"]
    original_payload = {
        "parse_state": "named_only", "mechanics": _source_actor_record(0),
    }
    legacy = _make_authored_npc_legacy(
        tmp_path, root_id, "keeper", original_payload,
    )
    candidate = json.loads(json.dumps(legacy))
    if changed:
        candidate["mechanics"]["profile"]["characteristics"]["DEX"] = 75
    assets.put_entity(tmp_path, root_id, "npc", "keeper", candidate)

    current = assets.get_entity(tmp_path, root_id, "npc", "keeper")
    assert current["mechanics_revision_ref"]["revision"] == (2 if changed else 1)
    revision_root = (
        tmp_path / ".coc/module-assets" / root_id /
        "entities/npc-keeper-mechanics/revisions"
    )
    paths = sorted(revision_root.glob("*.json"))
    assert [path.name for path in paths] == (
        ["000001.json", "000002.json"] if changed else ["000001.json"]
    )
    first = json.loads(paths[0].read_text(encoding="utf-8"))
    assert first["content"]["mechanics"]["profile"]["characteristics"]["DEX"] == 55
    if changed:
        second = json.loads(paths[1].read_text(encoding="utf-8"))
        assert second["content"]["mechanics"]["profile"]["characteristics"]["DEX"] == 75


def test_current_npc_projection_must_equal_active_head_and_retry_repairs_it(
    tmp_path: Path,
):
    bundle, _file_sha, _ = _write_host_bundle(tmp_path)
    root_id = assets.register_source_bundle(
        tmp_path, bundle, asset_root_id="npc-current-head",
    )["asset_root_id"]
    first_payload = {
        "parse_state": "named_only", "mechanics": _source_actor_record(0),
    }
    assets.put_entity(tmp_path, root_id, "npc", "keeper", first_payload)
    first = assets.get_entity(tmp_path, root_id, "npc", "keeper")
    second_payload = json.loads(json.dumps(first_payload))
    second_payload["mechanics"]["profile"]["characteristics"]["DEX"] = 65
    assets.put_entity(tmp_path, root_id, "npc", "keeper", second_payload)

    entity_path = (
        tmp_path / ".coc/module-assets" / root_id /
        "entities/npc-keeper.json"
    )
    stale = json.loads(entity_path.read_text(encoding="utf-8"))
    stale["mechanics"] = first["mechanics"]
    stale["mechanics_revision_ref"] = first["mechanics_revision_ref"]
    entity_path.write_text(json.dumps(stale), encoding="utf-8")
    with pytest.raises(assets.ModuleAssetsError, match="immutable revision hash drift"):
        assets.get_entity(tmp_path, root_id, "npc", "keeper")

    assets.put_entity(tmp_path, root_id, "npc", "keeper", second_payload)
    repaired = assets.get_entity(tmp_path, root_id, "npc", "keeper")
    assert repaired["mechanics_revision_ref"]["revision"] == 2


def test_concurrent_npc_mechanics_publications_use_distinct_revision_slots(
    tmp_path: Path,
):
    bundle, _file_sha, _ = _write_host_bundle(tmp_path)
    root_id = assets.register_source_bundle(
        tmp_path, bundle, asset_root_id="npc-concurrency",
    )["asset_root_id"]
    barrier = threading.Barrier(2)

    def publish(dex: int) -> None:
        payload = {
            "parse_state": "named_only", "mechanics": _source_actor_record(0),
        }
        payload["mechanics"]["profile"]["characteristics"]["DEX"] = dex
        barrier.wait()
        assets.put_entity(tmp_path, root_id, "npc", "keeper", payload)

    with ThreadPoolExecutor(max_workers=2) as executor:
        list(executor.map(publish, (65, 75)))
    current = assets.get_entity(tmp_path, root_id, "npc", "keeper")
    assert current["mechanics_revision_ref"]["revision"] == 2
    root = (
        tmp_path / ".coc/module-assets" / root_id /
        "entities/npc-keeper-mechanics"
    )
    head = json.loads((root / "head.json").read_text(encoding="utf-8"))
    assert head["active_revision"] == 2
    assert head["content_sha256"] == current[
        "mechanics_revision_ref"
    ]["content_sha256"]
    assert sorted(path.name for path in (root / "revisions").glob("*.json")) == [
        "000001.json", "000002.json",
    ]


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


def test_skeleton_rejects_weak_not_authored_and_pending_absence():
    sk = _minimal_skeleton(
        mechanics_index=[
            {
                "subject_kind": "npc",
                "subject_id": "npc-clerk",
                "status": "not_authored",
                "locator_pass_status": "pending",
                "absence_receipt": {
                    "reason": "named_in_opening_no_stat_block",
                    "source_page_indices": [1],
                },
            }
        ]
    )
    errors = assets.validate_skeleton(sk)
    assert any("locator_pass_status=pending" in e for e in errors)
    assert any("absence_receipt" in e or "review_state" in e for e in errors)


def test_skeleton_pending_locator_cannot_be_not_authored():
    sk = _minimal_skeleton(
        mechanics_index=[
            {
                "subject_kind": "npc",
                "subject_id": "npc-clerk",
                "status": "not_authored",
                "locator_pass_status": "pending",
            }
        ]
    )
    errors = assets.validate_skeleton(sk)
    assert any("pending" in e and "unresolved" in e for e in errors)


def test_skeleton_complete_not_authored_requires_bound_receipt():
    sk = _minimal_skeleton(
        mechanics_locator_pass_status="complete",
        mechanics_locator_scope={
            "scope_kind": "explicit_pdf_indices",
            "pdf_indices": [2],
            "source_file_sha256": FAKE_SHA,
        },
        mechanics_index=[
            {
                "subject_kind": "npc",
                "subject_id": "npc-clerk",
                "status": "not_authored",
                "locator_pass_status": "complete",
                "locator_scope": {
                    "scope_kind": "explicit_pdf_indices",
                    "pdf_indices": [2],
                    "source_file_sha256": FAKE_SHA,
                },
                "absence_receipt": {
                    "review_state": "manual_accepted",
                    "checked_scope": {
                        "scope_kind": "explicit_pdf_indices",
                        "pdf_indices": [2],
                        "source_file_sha256": FAKE_SHA,
                    },
                    "source_file_sha256": FAKE_SHA,
                },
            }
        ]
    )
    assert assets.validate_skeleton(sk) == []


def test_skeleton_rejects_string_or_list_checked_scope_bypass():
    base_row = {
        "subject_kind": "npc",
        "subject_id": "npc-clerk",
        "status": "not_authored",
        "locator_pass_status": "complete",
        "locator_scope": {
            "scope_kind": "explicit_pdf_indices",
            "pdf_indices": [373],
            "source_file_sha256": FAKE_SHA,
        },
    }
    for checked in ("opening only", [361]):
        sk = _minimal_skeleton(
            mechanics_locator_pass_status="complete",
            mechanics_locator_scope={
                "scope_kind": "explicit_pdf_indices",
                "pdf_indices": [373],
                "source_file_sha256": FAKE_SHA,
            },
            mechanics_index=[{
                **base_row,
                "absence_receipt": {
                    "review_state": "manual_accepted",
                    "checked_scope": checked,
                    "source_file_sha256": FAKE_SHA,
                },
            }],
        )
        errors = assets.validate_skeleton(sk)
        assert any("checked_scope" in e for e in errors), errors


def test_skeleton_empty_index_with_roster_cannot_be_complete():
    sk = _minimal_skeleton(
        mechanics_locator_pass_status="complete",
        mechanics_locator_scope={
            "scope_kind": "explicit_pdf_indices",
            "pdf_indices": [2],
            "source_file_sha256": FAKE_SHA,
        },
        mechanics_index=[],
    )
    errors = assets.validate_skeleton(sk)
    assert any("empty mechanics_index" in e or "missing mechanics_index" in e for e in errors)

    pending = _minimal_skeleton(
        mechanics_locator_pass_status="pending",
        mechanics_index=[],
    )
    assert assets.validate_skeleton(pending) == []


def test_skeleton_global_complete_requires_full_roster_coverage():
    sk = _minimal_skeleton(
        mechanics_locator_pass_status="complete",
        mechanics_locator_scope={
            "scope_kind": "explicit_pdf_indices",
            "pdf_indices": [2],
            "source_file_sha256": FAKE_SHA,
        },
        item_roster=[{"item_id": "ritual-knife", "label": "Knife", "parse_state": "named_only"}],
        mechanics_index=[
            {
                "subject_kind": "npc",
                "subject_id": "npc-clerk",
                "status": "located",
                "locator_pass_status": "complete",
                "locator_scope": {
                    "scope_kind": "explicit_pdf_indices",
                    "pdf_indices": [2],
                    "source_file_sha256": FAKE_SHA,
                },
                "source_page_indices": [2],
            }
        ],
    )
    errors = assets.validate_skeleton(sk)
    assert any("ritual-knife" in e for e in errors)


def test_clue_discovery_contract_on_location_pack(tmp_path: Path):
    bundle, _file_sha, _page_sha = _write_host_bundle(
        tmp_path, page_count=2, include_page_one=True,
    )
    root_id = assets.register_source_bundle(
        tmp_path, bundle, asset_root_id="disc-mod",
    )["asset_root_id"]
    with pytest.raises(assets.ModuleAssetsError, match="discovery|non-canonical"):
        assets.put_entity(tmp_path, root_id, "location", "archives", {
            "location_id": "archives",
            "parse_state": "deep",
            "title": "Archives",
            "source_page_indices": [0],
            "clues": [{
                "clue_id": "archive-history",
                "player_safe_summary": "Civil War articles; no check required.",
                "skill": "Library Use",
                "delivery_kind": "obvious",
            }],
        })

    with pytest.raises(assets.ModuleAssetsError, match="requires discovery"):
        assets.put_entity(tmp_path, root_id, "location", "archives", {
            "location_id": "archives",
            "parse_state": "deep",
            "title": "Archives",
            "source_page_indices": [0],
            "clues": [{
                "clue_id": "starter-shaped",
                "player_safe_summary": "A diary.",
                "delivery_kind": "skill_check",
                "skill": "Library Use",
                "difficulty": "regular",
            }],
        })

    with pytest.raises(assets.ModuleAssetsError, match="summary"):
        assets.put_entity(tmp_path, root_id, "location", "archives", {
            "location_id": "archives",
            "parse_state": "deep",
            "title": "Archives",
            "source_page_indices": [0],
            "clues": [{
                "clue_id": "archive-history",
                "summary": "legacy alias",
                "discovery": {
                    "mode": "automatic",
                    "skill": None,
                    "difficulty": None,
                },
                "provenance": {"authority": "source_authored"},
                "source_refs": [{"pdf_index": 1}],
            }],
        })

    result = assets.put_entity(tmp_path, root_id, "location", "archives", {
        "location_id": "archives",
        "parse_state": "deep",
        "title": "Archives",
        "source_page_indices": [0],
        "clues": [{
            "clue_id": "archive-history",
            "player_safe_summary": (
                "Articles going back to the Civil War (no Library Use required)."
            ),
            "delivery_kind": "obvious",
            "discovery": {
                "mode": "automatic",
                "skill": None,
                "difficulty": None,
            },
            "provenance": {
                "authority": "source_authored",
                "source_refs": [{"pdf_index": 1}],
            },
            "source_refs": [{"pdf_index": 1}],
        }],
    })
    stored = assets.get_entity(tmp_path, root_id, "location", "archives")
    assert stored is not None
    assert stored["clues"][0]["discovery"]["mode"] == "automatic"
    assert stored["clues"][0]["discovery"].get("difficulty") is None
    assert "difficulty" not in stored["clues"][0] or stored["clues"][0].get("difficulty") is None
    assert result["entity_id"] == "archives"


def test_put_entity_rejects_located_mechanics_with_flat_stats(tmp_path: Path):
    assets.init_module_root(
        tmp_path, asset_root_id="mech-mod", identity={}, file_sha256=FAKE_SHA,
    )
    with pytest.raises(assets.ModuleAssetsError, match="locator-thin"):
        assets.put_entity(tmp_path, "mech-mod", "npc", "npc-appendix", {
            "npc_id": "npc-appendix",
            "parse_state": "named_only",
            "name": "Appendix NPC",
            "mechanics": {
                "status": "located",
                "source_page_indices": [3],
                "characteristics": {"STR": 70, "CON": 60, "SIZ": 65, "DEX": 50, "POW": 55},
                "spells": ["Bind"],
            },
        })


def test_put_entity_not_authored_requires_skeleton_row_and_complete(tmp_path: Path):
    assets.init_module_root(
        tmp_path, asset_root_id="abs-mod", identity={}, file_sha256=FAKE_SHA,
    )
    # No skeleton mechanics row → reject self-asserted absence.
    with pytest.raises(assets.ModuleAssetsError, match="matching skeleton mechanics_index"):
        assets.put_entity(tmp_path, "abs-mod", "npc", "npc-clerk", {
            "npc_id": "npc-clerk",
            "parse_state": "named_only",
            "name": "Clerk",
            "mechanics": {
                "status": "not_authored",
                "locator_pass_status": "complete",
                "locator_scope": {
                    "scope_kind": "explicit_pdf_indices",
                    "pdf_indices": [2],
                    "source_file_sha256": FAKE_SHA,
                },
                "absence_receipt": {
                    "review_state": "manual_accepted",
                    "checked_scope": {
                        "scope_kind": "explicit_pdf_indices",
                        "pdf_indices": [2],
                        "source_file_sha256": FAKE_SHA,
                    },
                    "source_file_sha256": FAKE_SHA,
                },
            },
        })

    assets.put_skeleton(
        tmp_path,
        "abs-mod",
        _minimal_skeleton(
            mechanics_locator_pass_status="complete",
            mechanics_locator_scope={
                "scope_kind": "explicit_pdf_indices",
                "pdf_indices": [2],
                "source_file_sha256": FAKE_SHA,
            },
            mechanics_index=[{
                "subject_kind": "npc",
                "subject_id": "npc-clerk",
                "status": "not_authored",
                "locator_pass_status": "complete",
                "locator_scope": {
                    "scope_kind": "explicit_pdf_indices",
                    "pdf_indices": [2],
                    "source_file_sha256": FAKE_SHA,
                },
                "absence_receipt": {
                    "review_state": "manual_accepted",
                    "checked_scope": {
                        "scope_kind": "explicit_pdf_indices",
                        "pdf_indices": [2],
                        "source_file_sha256": FAKE_SHA,
                    },
                    "source_file_sha256": FAKE_SHA,
                },
            }],
        ),
    )
    result = assets.put_entity(tmp_path, "abs-mod", "npc", "npc-clerk", {
        "npc_id": "npc-clerk",
        "parse_state": "named_only",
        "name": "Clerk",
        "mechanics": {
            "status": "not_authored",
            "locator_pass_status": "complete",
            "locator_scope": {
                "scope_kind": "explicit_pdf_indices",
                "pdf_indices": [2],
                "source_file_sha256": FAKE_SHA,
            },
            "absence_receipt": {
                "review_state": "manual_accepted",
                "checked_scope": {
                    "scope_kind": "explicit_pdf_indices",
                    "pdf_indices": [2],
                    "source_file_sha256": FAKE_SHA,
                },
                "source_file_sha256": FAKE_SHA,
            },
        },
    })
    assert result["entity_id"] == "npc-clerk"


def test_pure_skeleton_rejects_foreign_locator_identity_and_out_of_range_pages():
    foreign_sha = "b" * 64
    skeleton = _minimal_skeleton(
        mechanics_locator_pass_status="pending",
        mechanics_index=[_absence_row(pdf_index=999, file_sha=foreign_sha)],
    )

    errors = assets.validate_skeleton(skeleton)

    assert any("must match source.file_sha256" in error for error in errors), errors
    assert any("source.page_count" in error for error in errors), errors


def test_not_authored_npc_cannot_borrow_item_locator_with_same_id(tmp_path: Path):
    assets.init_module_root(
        tmp_path, asset_root_id="kind-bound", identity={}, file_sha256=FAKE_SHA,
    )
    row = _absence_row(pdf_index=2, file_sha=FAKE_SHA)
    row["subject_kind"] = "item"
    row["subject_id"] = "shared-subject"
    skeleton = _minimal_skeleton(
        npc_roster=[{
            "npc_id": "shared-subject",
            "names": ["Shared"],
            "parse_state": "named_only",
        }],
        item_roster=[{
            "item_id": "shared-subject",
            "label": "Shared",
            "parse_state": "named_only",
        }],
        mechanics_locator_pass_status="pending",
        mechanics_index=[row],
    )
    assets.put_skeleton(tmp_path, "kind-bound", skeleton)
    mechanics_record = {
        key: value
        for key, value in row.items()
        if key not in {"subject_kind", "subject_id"}
    }

    with pytest.raises(
        assets.ModuleAssetsError, match="matching skeleton mechanics_index",
    ):
        assets.put_entity(
            tmp_path,
            "kind-bound",
            "npc",
            "shared-subject",
            {"parse_state": "named_only", "mechanics": mechanics_record},
        )


def test_source_bound_locator_scope_requires_registered_accepted_cache(
    tmp_path: Path,
):
    bundle, file_sha, _ = _write_host_bundle(tmp_path, page_count=2)
    registered = assets.register_source_bundle(
        tmp_path, bundle, asset_root_id="bound-module",
    )

    foreign = _source_bound_skeleton(
        tmp_path,
        file_sha,
        page_count=2,
        mechanics_index=[_absence_row(pdf_index=999, file_sha="b" * 64)],
    )
    with pytest.raises(assets.ModuleAssetsError, match="source.file_sha256|page_count"):
        assets.put_skeleton(tmp_path, registered["asset_root_id"], foreign)

    uncached = _source_bound_skeleton(
        tmp_path,
        file_sha,
        page_count=2,
        mechanics_index=[_absence_row(pdf_index=1, file_sha=file_sha)],
    )
    assert assets.validate_skeleton(uncached) == []
    with pytest.raises(assets.ModuleAssetsError, match="uncached pdf_index 1"):
        assets.put_skeleton(tmp_path, registered["asset_root_id"], uncached)

    assets.put_page(
        tmp_path,
        registered["asset_root_id"],
        1,
        "manually cached but not source-bundle-registered\n",
        meta={
            "source_id": "pdf:bound-module",
            "file_sha256": file_sha,
            "review_state": "manual_accepted",
        },
    )
    with pytest.raises(assets.ModuleAssetsError, match="not covered by a registered"):
        assets.put_skeleton(tmp_path, registered["asset_root_id"], uncached)

    accepted = _source_bound_skeleton(
        tmp_path,
        file_sha,
        page_count=2,
        mechanics_index=[_absence_row(pdf_index=0, file_sha=file_sha)],
    )
    assets.put_skeleton(tmp_path, registered["asset_root_id"], accepted)
    stored_skeleton = assets.get_skeleton(
        tmp_path, registered["asset_root_id"],
    )
    assert stored_skeleton["mechanics_locator_pass_status"] == "pending"
    assert stored_skeleton["mechanics_index"][0]["locator_pass_status"] == "complete"

    accepted_record = _absence_row(pdf_index=0, file_sha=file_sha)
    result = assets.put_entity(
        tmp_path,
        registered["asset_root_id"],
        "npc",
        "npc-clerk",
        {
            "parse_state": "named_only",
            "mechanics": {
                key: value
                for key, value in accepted_record.items()
                if key not in {"subject_kind", "subject_id"}
            },
        },
    )
    assert result["entity_id"] == "npc-clerk"

    foreign_record = _absence_row(pdf_index=999, file_sha="b" * 64)
    with pytest.raises(assets.ModuleAssetsError, match="source.file_sha256|page_count"):
        assets.put_entity(
            tmp_path,
            registered["asset_root_id"],
            "npc",
            "npc-clerk",
            {
                "parse_state": "named_only",
                "mechanics": {
                    key: value
                    for key, value in foreign_record.items()
                    if key not in {"subject_kind", "subject_id"}
                },
            },
        )


def test_locator_scope_kind_and_located_page_must_match_reviewed_scope():
    global_scope = {
        "scope_kind": "global_appendix",
        "pdf_indices": [2, 3],
        "source_file_sha256": FAKE_SHA,
    }
    skeleton = _minimal_skeleton(
        mechanics_locator_pass_status="complete",
        mechanics_locator_scope=global_scope,
        mechanics_index=[{
            "subject_kind": "npc",
            "subject_id": "npc-clerk",
            "status": "located",
            "locator_pass_status": "complete",
            "locator_scope": {
                "scope_kind": "explicit_pdf_indices",
                "pdf_indices": [2],
                "source_file_sha256": FAKE_SHA,
            },
            "source_page_indices": [3],
        }],
    )

    errors = assets.validate_skeleton(skeleton)

    assert any("scope_kind must match" in error for error in errors), errors
    assert any("contained in locator_scope" in error for error in errors), errors

    duplicate_scope = _minimal_skeleton(
        mechanics_locator_pass_status="pending",
        mechanics_index=[{
            "subject_kind": "npc",
            "subject_id": "npc-clerk",
            "status": "located",
            "locator_pass_status": "complete",
            "locator_scope": {
                "scope_kind": "explicit_pdf_indices",
                "pdf_indices": [2, 2],
                "source_file_sha256": FAKE_SHA,
            },
            "source_page_indices": [2],
        }],
    )
    duplicate_errors = assets.validate_skeleton(duplicate_scope)
    assert any("duplicates" in error for error in duplicate_errors), duplicate_errors


def test_source_bound_authored_mechanics_uses_independent_accepted_appendix_scope(
    tmp_path: Path,
):
    bundle, file_sha, _ = _write_host_bundle(
        tmp_path, page_count=2, include_page_one=True,
    )
    registered = assets.register_source_bundle(
        tmp_path, bundle, asset_root_id="bound-module",
    )
    root_id = registered["asset_root_id"]

    with pytest.raises(assets.ModuleAssetsError, match="uncached pdf_index 999"):
        assets.put_entity(tmp_path, root_id, "npc", "foreign-page", {
            "parse_state": "named_only",
            "mechanics": _source_actor_record(999),
        })

    with pytest.raises(assets.ModuleAssetsError, match="different source_id"):
        assets.put_entity(tmp_path, root_id, "npc", "foreign-source", {
            "parse_state": "named_only",
            "mechanics": _source_actor_record(0, source_id="pdf:foreign"),
        })

    with pytest.raises(assets.ModuleAssetsError, match="source.file_sha256|page_count"):
        assets.put_entity(tmp_path, root_id, "npc", "foreign-locator", {
            "parse_state": "named_only",
            "mechanics": {
                "status": "located",
                "locator_pass_status": "complete",
                "locator_scope": {
                    "scope_kind": "explicit_pdf_indices",
                    "pdf_indices": [999],
                    "source_file_sha256": "b" * 64,
                },
                "source_page_indices": [999],
            },
        })

    with pytest.raises(assets.ModuleAssetsError, match="bind exactly"):
        assets.put_entity(tmp_path, root_id, "npc", "mismatched-provenance", {
            "parse_state": "named_only",
            "mechanics": _source_actor_record(
                0,
                provenance_refs=[{
                    "source_id": "pdf:bound-module",
                    "pdf_index": 1,
                }],
            ),
        })

    assets.put_entity(tmp_path, root_id, "npc", "appendix-subject", {
        "parse_state": "named_only",
        "mechanics": _source_actor_record(1),
    })
    stored = assets.get_entity(tmp_path, root_id, "npc", "appendix-subject")
    assert stored["parse_state"] == "named_only"
    assert "source_refs" not in stored
    assert stored["mechanics"]["source_page_indices"] == [1]
    assert stored["mechanics"]["source_refs"][0]["source_id"] == "pdf:bound-module"
    assert stored["mechanics"]["source_refs"][0]["text_sha256"]


def test_source_bound_clue_provenance_is_exact_for_nested_and_standalone_facts(
    tmp_path: Path,
):
    bundle, _file_sha, _ = _write_host_bundle(
        tmp_path, page_count=2, include_page_one=True,
    )
    root_id = assets.register_source_bundle(
        tmp_path, bundle, asset_root_id="bound-module",
    )["asset_root_id"]
    automatic = {
        "mode": "automatic",
        "skill": None,
        "difficulty": None,
    }

    with pytest.raises(assets.ModuleAssetsError, match="bind exactly"):
        assets.put_entity(tmp_path, root_id, "location", "archives-bad", {
            "parse_state": "deep",
            "source_page_indices": [0],
            "clues": [{
                "clue_id": "nested-bad",
                "player_safe_summary": "No roll is required.",
                "delivery_kind": "obvious",
                "discovery": automatic,
                "source_refs": [{"pdf_index": 0}],
                "provenance": {
                    "authority": "source_authored",
                    "source_refs": [{"pdf_index": 1}],
                },
            }],
        })

    with pytest.raises(assets.ModuleAssetsError, match="uncached pdf_index 999"):
        assets.put_entity(tmp_path, root_id, "location", "archives-foreign", {
            "parse_state": "deep",
            "source_page_indices": [0],
            "clues": [{
                "clue_id": "nested-foreign",
                "player_safe_summary": "No roll is required.",
                "delivery_kind": "obvious",
                "discovery": automatic,
                "source_refs": [{"pdf_index": 0}],
                "provenance": {
                    "authority": "source_authored",
                    "source_refs": [{"pdf_index": 999}],
                },
            }],
        })

    with pytest.raises(assets.ModuleAssetsError, match="bind exactly"):
        assets.put_entity(tmp_path, root_id, "clue", "standalone-bad", {
            "parse_state": "deep",
            "player_safe_summary": "Still automatic.",
            "delivery_kind": "obvious",
            "discovery": automatic,
            "source_refs": [{"pdf_index": 0}],
            "provenance": {
                "authority": "source_authored",
                "source_refs": [{"pdf_index": 1}],
            },
        })

    with pytest.raises(assets.ModuleAssetsError, match="different source_id"):
        assets.put_entity(tmp_path, root_id, "clue", "standalone-foreign", {
            "parse_state": "deep",
            "player_safe_summary": "Still automatic.",
            "delivery_kind": "obvious",
            "discovery": automatic,
            "source_refs": [{"pdf_index": 0}],
            "provenance": {
                "authority": "source_authored",
                "source_refs": [{"source_id": "pdf:foreign", "pdf_index": 0}],
            },
        })

    assets.put_entity(tmp_path, root_id, "location", "archives-good", {
        "parse_state": "deep",
        "source_page_indices": [0],
        "clues": [{
            "clue_id": "archive-automatic",
            "player_safe_summary": "No Library Use roll is required.",
            "delivery_kind": "obvious",
            "discovery": automatic,
            "source_refs": [{"pdf_index": 0}],
            "provenance": {
                "authority": "source_authored",
                "source_refs": [{"pdf_index": 0}],
            },
        }],
    })
    stored = assets.get_entity(tmp_path, root_id, "location", "archives-good")
    clue = stored["clues"][0]
    assert clue["discovery"]["mode"] == "automatic"
    assert clue["provenance"]["source_refs"] == clue["source_refs"]

    assets.put_entity(tmp_path, root_id, "clue", "standalone-good", {
        "parse_state": "deep",
        "player_safe_summary": "Automatic standalone clue.",
        "delivery_kind": "obvious",
        "discovery": automatic,
        "source_refs": [{"pdf_index": 0}],
        "provenance": {"authority": "source_authored"},
    })
    standalone = assets.get_entity(tmp_path, root_id, "clue", "standalone-good")
    assert standalone["discovery"]["mode"] == "automatic"
    assert standalone["source_refs"][0]["text_sha256"]


@pytest.mark.parametrize(
    "fact_form", ["mechanics", "nested_clue", "standalone_clue"],
)
@pytest.mark.parametrize(
    ("parallel_field", "parallel_value"),
    _PARALLEL_PROVENANCE_SOURCE_FIELDS,
)
def test_source_bound_facts_reject_every_parallel_provenance_source_field(
    tmp_path: Path,
    fact_form: str,
    parallel_field: str,
    parallel_value: object,
):
    bundle, _file_sha, _ = _write_host_bundle(
        tmp_path, page_count=2, include_page_one=True,
    )
    root_id = assets.register_source_bundle(
        tmp_path, bundle, asset_root_id="bound-module",
    )["asset_root_id"]
    target_id = f"reject-{fact_form}-{parallel_field}"

    if fact_form == "mechanics":
        record = _source_actor_record(0)
        record["provenance"][parallel_field] = json.loads(
            json.dumps(parallel_value)
        )
        kind = "npc"
        payload = {"parse_state": "named_only", "mechanics": record}
    else:
        clue = _automatic_clue(f"clue-{target_id}")
        clue["provenance"][parallel_field] = json.loads(
            json.dumps(parallel_value)
        )
        if fact_form == "nested_clue":
            kind = "location"
            payload = {
                "parse_state": "deep",
                "source_page_indices": [0],
                "clues": [clue],
            }
        else:
            kind = "clue"
            payload = {"parse_state": "deep", **clue}

    with pytest.raises(assets.ModuleAssetsError, match=parallel_field):
        assets.put_entity(tmp_path, root_id, kind, target_id, payload)
    assert assets.get_entity(tmp_path, root_id, kind, target_id) is None


@pytest.mark.parametrize(
    "fact_form", ["mechanics", "nested_clue", "standalone_clue"],
)
@pytest.mark.parametrize(
    ("evidence_field", "foreign_value"),
    [
        ("file_sha256", "b" * 64),
        ("pdf_indices", [1]),
        ("source_id", "pdf:foreign"),
        ("page_text_sha256", ["b" * 64]),
        ("bundle_sha256s", ["b" * 64]),
    ],
)
def test_source_bound_facts_reject_mismatched_record_source_evidence(
    tmp_path: Path,
    fact_form: str,
    evidence_field: str,
    foreign_value: object,
):
    bundle, _file_sha, _ = _write_host_bundle(
        tmp_path, page_count=2, include_page_one=True,
    )
    root_id = assets.register_source_bundle(
        tmp_path, bundle, asset_root_id="bound-module",
    )["asset_root_id"]
    assets.put_entity(tmp_path, root_id, "npc", "canonical-evidence-seed", {
        "parse_state": "named_only",
        "mechanics": _source_actor_record(0),
    })
    canonical = assets.get_entity(
        tmp_path, root_id, "npc", "canonical-evidence-seed",
    )["mechanics"]["source_evidence"]
    foreign_evidence = json.loads(json.dumps(canonical))
    foreign_evidence[evidence_field] = json.loads(json.dumps(foreign_value))
    target_id = f"reject-evidence-{fact_form}-{evidence_field}"

    if fact_form == "mechanics":
        record = _source_actor_record(0)
        record["source_evidence"] = foreign_evidence
        kind = "npc"
        payload = {"parse_state": "named_only", "mechanics": record}
    else:
        clue = _automatic_clue(f"clue-{target_id}")
        clue["source_evidence"] = foreign_evidence
        if fact_form == "nested_clue":
            kind = "location"
            payload = {
                "parse_state": "deep",
                "source_page_indices": [0],
                "clues": [clue],
            }
        else:
            kind = "clue"
            payload = {"parse_state": "deep", **clue}

    with pytest.raises(assets.ModuleAssetsError, match="source_evidence"):
        assets.put_entity(tmp_path, root_id, kind, target_id, payload)
    assert assets.get_entity(tmp_path, root_id, kind, target_id) is None


@pytest.mark.parametrize(
    "fact_form", ["mechanics", "nested_clue", "standalone_clue"],
)
def test_source_bound_facts_reject_combined_foreign_record_source_evidence(
    tmp_path: Path,
    fact_form: str,
):
    bundle, _file_sha, _ = _write_host_bundle(
        tmp_path, page_count=2, include_page_one=True,
    )
    root_id = assets.register_source_bundle(
        tmp_path, bundle, asset_root_id="bound-module",
    )["asset_root_id"]
    foreign_evidence = {
        "schema_version": 1,
        "source_id": "pdf:foreign",
        "file_sha256": "b" * 64,
        "bundle_sha256s": ["b" * 64],
        "pdf_indices": [1],
        "page_text_sha256": ["b" * 64],
    }
    target_id = f"combined-foreign-{fact_form}"
    if fact_form == "mechanics":
        record = _source_actor_record(0)
        record["source_evidence"] = foreign_evidence
        kind = "npc"
        payload = {"parse_state": "named_only", "mechanics": record}
    else:
        clue = _automatic_clue(f"clue-{target_id}")
        clue["source_evidence"] = foreign_evidence
        if fact_form == "nested_clue":
            kind = "location"
            payload = {
                "parse_state": "deep",
                "source_page_indices": [0],
                "clues": [clue],
            }
        else:
            kind = "clue"
            payload = {"parse_state": "deep", **clue}

    with pytest.raises(assets.ModuleAssetsError, match="source_evidence"):
        assets.put_entity(tmp_path, root_id, kind, target_id, payload)
    assert assets.get_entity(tmp_path, root_id, kind, target_id) is None


def test_source_bound_fact_canonical_evidence_is_idempotent_for_every_consumer(
    tmp_path: Path,
):
    bundle, file_sha, _ = _write_host_bundle(
        tmp_path, page_count=2, include_page_one=True,
    )
    registration = assets.register_source_bundle(
        tmp_path, bundle, asset_root_id="bound-module",
    )
    root_id = registration["asset_root_id"]

    assets.put_entity(tmp_path, root_id, "npc", "canonical-mechanics", {
        "parse_state": "named_only",
        "mechanics": _source_actor_record(0),
    })
    mechanics_entity = assets.get_entity(
        tmp_path, root_id, "npc", "canonical-mechanics",
    )
    mechanics_fact = mechanics_entity["mechanics"]
    assert "source_refs" not in mechanics_fact["provenance"]
    assert mechanics_fact["source_evidence"] == {
        "schema_version": 1,
        "source_id": "pdf:bound-module",
        "file_sha256": file_sha,
        "bundle_sha256s": [registration["bundle_sha256"]],
        "pdf_indices": [0],
        "page_text_sha256": [mechanics_fact["source_refs"][0]["text_sha256"]],
    }
    assets.put_entity(
        tmp_path, root_id, "npc", "canonical-mechanics", mechanics_entity,
    )

    nested = _automatic_clue("canonical-nested-clue")
    nested["provenance"]["source_refs"] = [{"pdf_index": 0}]
    assets.put_entity(tmp_path, root_id, "location", "canonical-location", {
        "parse_state": "deep",
        "source_page_indices": [0],
        "clues": [nested],
    })
    location_entity = assets.get_entity(
        tmp_path, root_id, "location", "canonical-location",
    )
    nested_fact = location_entity["clues"][0]
    assert nested_fact["provenance"]["source_refs"] == nested_fact["source_refs"]
    assert nested_fact["source_evidence"]["pdf_indices"] == [0]
    assets.put_entity(
        tmp_path, root_id, "location", "canonical-location", location_entity,
    )

    standalone = _automatic_clue("canonical-standalone-clue")
    assets.put_entity(tmp_path, root_id, "clue", "canonical-standalone-clue", {
        "parse_state": "deep",
        **standalone,
    })
    standalone_entity = assets.get_entity(
        tmp_path, root_id, "clue", "canonical-standalone-clue",
    )
    assert "source_refs" not in standalone_entity["provenance"]
    assert standalone_entity["source_evidence"]["source_id"] == "pdf:bound-module"
    assets.put_entity(
        tmp_path,
        root_id,
        "clue",
        "canonical-standalone-clue",
        standalone_entity,
    )


@pytest.mark.parametrize(
    ("fact_form", "expected_field"),
    [
        ("mechanics", "npc.mechanics"),
        ("nested_clue", "location.clues[0]"),
        ("standalone_clue", "clue"),
    ],
)
def test_unregistered_root_rejects_every_source_authored_fact_before_write(
    tmp_path: Path,
    fact_form: str,
    expected_field: str,
):
    root_id = "unregistered-source"
    assets.init_module_root(
        tmp_path,
        asset_root_id=root_id,
        identity={"canonical_module_id": root_id},
        file_sha256=FAKE_SHA,
    )
    target_id = f"unregistered-{fact_form}"
    if fact_form == "mechanics":
        kind = "npc"
        payload = {
            "parse_state": "named_only",
            "mechanics": _source_actor_record(0),
        }
    else:
        clue = _automatic_clue(f"clue-{target_id}")
        if fact_form == "nested_clue":
            kind = "location"
            payload = {"parse_state": "deep", "clues": [clue]}
        else:
            kind = "clue"
            payload = {"parse_state": "deep", **clue}

    with pytest.raises(
        assets.ModuleAssetsError,
        match=(
            rf"{re.escape(expected_field)} source_authored fact requires "
            r"a registered accepted source bundle"
        ),
    ):
        assets.put_entity(tmp_path, root_id, kind, target_id, payload)
    assert assets.get_entity(tmp_path, root_id, kind, target_id) is None


@pytest.mark.parametrize(
    "fact_form", ["mechanics", "nested_clue", "standalone_clue"],
)
def test_unregistered_root_keeps_campaign_local_facts_legal(
    tmp_path: Path,
    fact_form: str,
):
    root_id = "campaign-local"
    assets.init_module_root(
        tmp_path,
        asset_root_id=root_id,
        identity={"canonical_module_id": root_id},
        file_sha256=FAKE_SHA,
    )
    target_id = f"campaign-{fact_form}"
    if fact_form == "mechanics":
        kind = "npc"
        payload = {
            "parse_state": "named_only",
            "mechanics": {
                "status": "unresolved",
                "provenance": {
                    "authority": "campaign_generated",
                    "basis": "keeper_decision",
                },
            },
        }
    else:
        clue = {
            "clue_id": f"clue-{target_id}",
            "player_safe_summary": "A campaign-local observation.",
            "delivery_kind": "obvious",
            "discovery": {
                "mode": "automatic",
                "skill": None,
                "difficulty": None,
            },
            "provenance": {
                "authority": "campaign_improvised",
                "basis": "keeper_decision",
            },
        }
        if fact_form == "nested_clue":
            kind = "location"
            payload = {
                "parse_state": "deep",
                "provenance": {"authority": "campaign_improvised"},
                "clues": [clue],
            }
        else:
            kind = "clue"
            payload = {"parse_state": "deep", **clue}

    assets.put_entity(tmp_path, root_id, kind, target_id, payload)
    stored = assets.get_entity(tmp_path, root_id, kind, target_id)
    assert stored is not None
    fact = stored["mechanics"] if fact_form == "mechanics" else (
        stored["clues"][0] if fact_form == "nested_clue" else stored
    )
    assert fact["provenance"]["authority"].startswith("campaign_")
    assert "source_evidence" not in fact


@pytest.mark.parametrize(
    "fact_form",
    ["mechanics", "nested_clue", "standalone_clue", "campaign_clue"],
)
def test_structured_basis_rejects_all_durable_fact_consumers_without_write(
    tmp_path: Path,
    fact_form: str,
):
    bundle, _file_sha, _ = _write_host_bundle(tmp_path)
    root_id = assets.register_source_bundle(
        tmp_path, bundle, asset_root_id="bound-module",
    )["asset_root_id"]
    target_id = f"structured-basis-{fact_form}"
    foreign_basis = {
        "source_evidence": {
            "source_id": "pdf:foreign",
            "file_sha256": "b" * 64,
            "pdf_indices": [999],
        },
        "source_span": {"pdf_index_start": 999, "pdf_index_end": 999},
    }
    if fact_form == "mechanics":
        kind = "npc"
        record = _source_actor_record(0)
        record["provenance"]["basis"] = foreign_basis
        payload = {"parse_state": "named_only", "mechanics": record}
    else:
        clue = _automatic_clue(f"clue-{target_id}")
        clue["provenance"]["basis"] = foreign_basis
        if fact_form == "nested_clue":
            kind = "location"
            payload = {
                "parse_state": "deep",
                "source_page_indices": [0],
                "clues": [clue],
            }
        elif fact_form == "standalone_clue":
            kind = "clue"
            payload = {"parse_state": "deep", **clue}
        else:
            kind = "clue"
            clue.pop("source_refs")
            clue["provenance"] = {
                "authority": "campaign_improvised",
                "basis": foreign_basis,
            }
            payload = {"parse_state": "deep", **clue}

    with pytest.raises(
        assets.ModuleAssetsError,
        match=r"provenance\.basis must be a non-empty string",
    ):
        assets.put_entity(tmp_path, root_id, kind, target_id, payload)
    assert assets.get_entity(tmp_path, root_id, kind, target_id) is None


@pytest.mark.parametrize(
    ("profile_path", "profile_mutation"),
    [
        (
            "profile.source_evidence",
            {"source_evidence": {"source_id": "pdf:foreign"}},
        ),
        (
            "profile.weapons[0].source_refs",
            {
                "weapons": [{
                    "weapon_id": "module:test-knife",
                    "source_refs": [{"source_id": "pdf:foreign", "pdf_index": 999}],
                }],
            },
        ),
        (
            "profile.weapons[0].file_sha256",
            {
                "weapons": [{
                    "weapon_id": "module:test-knife",
                    "file_sha256": "b" * 64,
                }],
            },
        ),
        (
            "profile.weapons[0].effects[0].pdf_indices",
            {
                "weapons": [{
                    "weapon_id": "module:test-knife",
                    "effects": [{
                        "effect_id": "foreign-page-scope",
                        "resolution": "keeper_advisory",
                        "applicability": {"scene_tags_any": ["cramped"]},
                        "pdf_indices": [999],
                    }],
                }],
            },
        ),
    ],
)
def test_durable_authored_profile_rejects_second_source_boundary_before_write(
    tmp_path: Path,
    profile_path: str,
    profile_mutation: dict,
):
    bundle, _file_sha, _ = _write_host_bundle(tmp_path)
    root_id = assets.register_source_bundle(
        tmp_path, bundle, asset_root_id="bound-module",
    )["asset_root_id"]
    record = _source_actor_record(0)
    record["profile"].update(json.loads(json.dumps(profile_mutation)))
    target_id = f"nested-profile-{len(profile_path)}"

    with pytest.raises(
        assets.ModuleAssetsError,
        match=re.escape(profile_path),
    ):
        assets.put_entity(tmp_path, root_id, "npc", target_id, {
            "parse_state": "named_only",
            "mechanics": record,
        })
    assert assets.get_entity(tmp_path, root_id, "npc", target_id) is None


def test_durable_authored_weapon_profile_keeps_record_level_canonical_evidence(
    tmp_path: Path,
):
    bundle, file_sha, _ = _write_host_bundle(tmp_path)
    registration = assets.register_source_bundle(
        tmp_path, bundle, asset_root_id="bound-module",
    )
    root_id = registration["asset_root_id"]
    record = {
        "status": "authored",
        "source_refs": [{
            "source_id": "pdf:bound-module",
            "pdf_index": 0,
        }],
        "fields_observed": ["weapon_id", "extends", "name"],
        "fields_extracted": ["weapon_id", "extends", "name"],
        "fields_not_authored": [],
        "provenance": {
            "authority": "source_authored",
            "basis": "host_pack",
        },
        "profile": {
            "profile_kind": "weapon",
            "weapon_id": "module:ritual-knife",
            "extends": "knife_medium",
            "name": "Ritual Knife",
        },
    }

    assets.put_entity(tmp_path, root_id, "item", "ritual-knife", {
        "parse_state": "named_only",
        "mechanics": record,
    })
    stored = assets.get_entity(tmp_path, root_id, "item", "ritual-knife")
    assert stored is not None
    mechanics_fact = stored["mechanics"]
    assert mechanics_fact["profile"] == record["profile"]
    assert mechanics_fact["source_evidence"] == {
        "schema_version": 1,
        "source_id": "pdf:bound-module",
        "file_sha256": file_sha,
        "bundle_sha256s": [registration["bundle_sha256"]],
        "pdf_indices": [0],
        "page_text_sha256": [mechanics_fact["source_refs"][0]["text_sha256"]],
    }
    assert not {
        "source_refs", "source_evidence", "file_sha256", "pdf_indices",
    }.intersection(mechanics_fact["profile"])

    assets.put_entity(
        tmp_path, root_id, "item", "ritual-knife", stored,
    )


def test_source_bound_fact_rejects_mismatched_derived_page_text_digests(
    tmp_path: Path,
):
    bundle, _file_sha, _ = _write_host_bundle(tmp_path)
    root_id = assets.register_source_bundle(
        tmp_path, bundle, asset_root_id="bound-module",
    )["asset_root_id"]
    record = _source_actor_record(0)
    record["page_text_sha256"] = ["b" * 64]

    with pytest.raises(assets.ModuleAssetsError, match="page_text_sha256"):
        assets.put_entity(tmp_path, root_id, "npc", "wrong-page-digest", {
            "parse_state": "named_only",
            "mechanics": record,
        })


def test_source_bound_fact_rejects_unregistered_cached_bundle_coverage(
    tmp_path: Path,
):
    bundle, _file_sha, _ = _write_host_bundle(tmp_path)
    root_id = assets.register_source_bundle(
        tmp_path, bundle, asset_root_id="bound-module",
    )["asset_root_id"]
    meta_path = (
        tmp_path / ".coc" / "module-assets" / root_id
        / "pages" / "0000.meta.json"
    )
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    meta["bundle_sha256s"].append("b" * 64)
    meta_path.write_text(json.dumps(meta), encoding="utf-8")

    with pytest.raises(assets.ModuleAssetsError, match="unregistered.*coverage"):
        assets.put_entity(tmp_path, root_id, "npc", "foreign-bundle-coverage", {
            "parse_state": "named_only",
            "mechanics": _source_actor_record(0),
        })
    assert assets.get_entity(
        tmp_path, root_id, "npc", "foreign-bundle-coverage",
    ) is None


def test_campaign_clue_may_not_borrow_parent_or_explicit_pdf_refs(tmp_path: Path):
    bundle, _file_sha, _ = _write_host_bundle(tmp_path)
    root_id = assets.register_source_bundle(
        tmp_path, bundle, asset_root_id="bound-module",
    )["asset_root_id"]
    clue = {
        "clue_id": "campaign-clue",
        "player_safe_summary": "Campaign-local observation.",
        "delivery_kind": "obvious",
        "discovery": {
            "mode": "automatic",
            "skill": None,
            "difficulty": None,
        },
        "provenance": {"authority": "campaign_improvised"},
    }
    assets.put_entity(tmp_path, root_id, "location", "campaign-scene", {
        "parse_state": "deep",
        "source_page_indices": [0],
        "clues": [clue],
    })
    stored = assets.get_entity(tmp_path, root_id, "location", "campaign-scene")
    assert "source_refs" not in stored["clues"][0]

    borrowed = json.loads(json.dumps(clue))
    borrowed["source_refs"] = [{"pdf_index": 0}]
    with pytest.raises(assets.ModuleAssetsError, match="must not borrow"):
        assets.put_entity(tmp_path, root_id, "location", "campaign-scene-bad", {
            "parse_state": "deep",
            "source_page_indices": [0],
            "clues": [borrowed],
        })

    for parallel_field, parallel_value in _PARALLEL_PROVENANCE_SOURCE_FIELDS:
        borrowed = json.loads(json.dumps(clue))
        borrowed["provenance"][parallel_field] = json.loads(
            json.dumps(parallel_value)
        )
        with pytest.raises(assets.ModuleAssetsError, match=parallel_field):
            assets.put_entity(
                tmp_path,
                root_id,
                "location",
                f"campaign-provenance-{parallel_field}",
                {
                    "parse_state": "deep",
                    "source_page_indices": [0],
                    "clues": [borrowed],
                },
            )

    borrowed = json.loads(json.dumps(clue))
    borrowed["source_evidence"] = {
        "file_sha256": "b" * 64,
        "pdf_indices": [999],
    }
    with pytest.raises(assets.ModuleAssetsError, match="must not borrow"):
        assets.put_entity(
            tmp_path,
            root_id,
            "location",
            "campaign-record-source-evidence",
            {
                "parse_state": "deep",
                "source_page_indices": [0],
                "clues": [borrowed],
            },
        )


def test_source_bound_locator_rejects_cached_page_content_hash_drift(tmp_path: Path):
    bundle, file_sha, _ = _write_host_bundle(tmp_path)
    root_id = assets.register_source_bundle(
        tmp_path, bundle, asset_root_id="bound-module",
    )["asset_root_id"]
    cached_page = (
        tmp_path / ".coc" / "module-assets" / root_id / "pages" / "0000.md"
    )
    cached_page.write_text("tampered cached text\n", encoding="utf-8")
    skeleton = _source_bound_skeleton(
        tmp_path,
        file_sha,
        page_count=1,
        mechanics_index=[_absence_row(pdf_index=0, file_sha=file_sha)],
    )

    with pytest.raises(assets.ModuleAssetsError, match="content hash drift"):
        assets.put_skeleton(tmp_path, root_id, skeleton)


def test_source_bound_locator_rejects_ineligible_cached_review_state(tmp_path: Path):
    bundle, file_sha, _ = _write_host_bundle(tmp_path)
    root_id = assets.register_source_bundle(
        tmp_path, bundle, asset_root_id="bound-module",
    )["asset_root_id"]
    meta_path = (
        tmp_path / ".coc" / "module-assets" / root_id / "pages" / "0000.meta.json"
    )
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    meta["review_state"] = "rejected"
    meta_path.write_text(json.dumps(meta), encoding="utf-8")
    skeleton = _source_bound_skeleton(
        tmp_path,
        file_sha,
        page_count=1,
        mechanics_index=[_absence_row(pdf_index=0, file_sha=file_sha)],
    )

    with pytest.raises(assets.ModuleAssetsError, match="accepted review state"):
        assets.put_skeleton(tmp_path, root_id, skeleton)
