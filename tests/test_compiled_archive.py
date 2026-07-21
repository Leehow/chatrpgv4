#!/usr/bin/env python3
"""Focused contracts for the compile-on-change scene/entity archive."""
from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path

import pytest

os.environ["COC_DISABLE_QUEUE_WORKER"] = "1"

SCRIPTS = Path("plugins/coc-keeper/scripts")
FAKE_SHA = "c" * 64


def _load(name: str, rel: str):
    spec = importlib.util.spec_from_file_location(name, rel)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


archive = _load("coc_compiled_archive_test", str(SCRIPTS / "coc_compiled_archive.py"))
assets = _load("coc_module_assets_ca_test", str(SCRIPTS / "coc_module_assets.py"))
project = _load("coc_module_project_ca_test", str(SCRIPTS / "coc_module_project.py"))
worker = _load("coc_module_queue_worker_ca_test", str(SCRIPTS / "coc_module_queue_worker.py"))
state = _load("coc_state_ca_test", str(SCRIPTS / "coc_state.py"))
toolbox = _load("coc_toolbox_ca_test", str(SCRIPTS / "coc_toolbox.py"))


def _skeleton() -> dict:
    return {
        "schema_version": 1,
        "parse_tier": 1,
        "module_identity": {"canonical_module_id": "ca-demo"},
        "structure_type": "branching_investigation",
        "source": {
            "source_id": "pdf:ca-demo",
            "path": "/tmp/ca-demo.pdf",
            "file_sha256": FAKE_SHA,
            "page_count": 6,
            "producer": "codex-pdf-skill",
        },
        "start_candidates": ["opening"],
        "finale_buckets": [{"id": "end", "title": "End", "importance": "critical"}],
        "locations": [
            {"location_id": "opening", "title": "Opening", "parse_state": "toc_only"},
            {"location_id": "cellar", "title": "Cellar", "parse_state": "named_only"},
            {"location_id": "attic", "title": "Attic", "parse_state": "named_only"},
        ],
        "edges_provisional": [
            {
                "from": "opening",
                "to": "cellar",
                "kind": "travel",
                "confidence": "low",
                "evidence": "toc_adjacency",
            }
        ],
        "npc_roster": [
            {"npc_id": "npc-patron", "names": ["Patron"], "parse_state": "named_only"}
        ],
        "handouts": [],
        "threats": [],
        "conclusion_buckets": [],
        "mechanics_locator_pass_status": "pending",
    }


def _deep(loc_id: str, *, with_secret: bool = False) -> dict:
    pack = {
        "location_id": loc_id,
        "title": loc_id,
        "parse_state": "deep",
        "evidence_gap": False,
        "source_refs": [{
            "source_id": "pdf:ca-demo",
            "pdf_index": 2,
            "text_sha256": "e" * 64,
            "bundle_sha256s": ["f" * 64],
        }],
        "source_span": {"pdf_index_start": 2, "pdf_index_end": 2},
        "source_page_indices": [2],
        "page_text_sha256": ["e" * 64],
        "source_evidence": {
            "schema_version": 1,
            "source_id": "pdf:ca-demo",
            "file_sha256": FAKE_SHA,
            "bundle_sha256s": ["f" * 64],
            "pdf_indices": [2],
            "page_text_sha256": ["e" * 64],
        },
        "dramatic_question": f"What about {loc_id}?",
        "scene_type": "investigation",
        "player_safe_summary": f"Deep pack for {loc_id}.",
        "available_clue_ids": [f"clue-{loc_id}"],
        "clues": [
            {
                "clue_id": f"clue-{loc_id}",
                "delivery_kind": "obvious",
                "player_safe_summary": f"A real clue in {loc_id}.",
                "discovery": {
                    "mode": "automatic",
                    "skill": None,
                    "difficulty": None,
                },
                "provenance": {
                    "authority": "campaign_generated",
                    "basis": "synthetic archive fixture",
                },
            }
        ],
        "npcs": [
            {
                "npc_id": "npc-patron",
                "name": "Patron",
                "agenda": "Hire investigators quietly.",
                "relationship_to_investigators": "employer",
                "social_role": "委托人",
                "voice": "clipped",
                "secret": "The patron already knows the cellar is wrong.",
                "keeper_note": "Do not volunteer the cellar truth.",
                "parse_state": "deep",
                "source_refs": [{"source_id": "pdf:ca-demo", "pdf_index": 2}],
            }
        ],
        "scene_edges": [
            {
                "to": "cellar" if loc_id == "opening" else "opening",
                "kind": "travel",
            }
        ],
        "affordances": [
            {
                "id": f"{loc_id}-look",
                "cue": "Look around",
                "route_type": "investigative_lead",
                "status": "open",
            }
        ],
        "pressure_moves": [],
        "tone": [],
        "mentions": [],
        "keeper_secret_refs": [],
    }
    if with_secret:
        pack["keeper_secret_refs"] = [
            {
                "id": f"secret-{loc_id}",
                "category": "keeper_secret",
                "prose": f"Hidden truth of {loc_id}.",
                "source_refs": [{"source_id": "pdf:ca-demo", "pdf_index": 2}],
            }
        ]
    return pack


def _campaign(tmp_path: Path) -> tuple[str, Path]:
    assets.init_module_root(
        tmp_path,
        asset_root_id="ca-demo",
        identity={"canonical_module_id": "ca-demo"},
        file_sha256=FAKE_SHA,
    )
    assets.put_skeleton(tmp_path, "ca-demo", _skeleton())
    assets.put_entity(
        tmp_path, "ca-demo", "location", "opening", _deep("opening", with_secret=True)
    )
    cid = "ca-camp"
    state.create_campaign(tmp_path, cid, "CA Camp", play_language="zh-Hans")
    project.project_opening_deep(tmp_path, cid, "ca-demo")
    camp_dir = tmp_path / ".coc" / "campaigns" / cid
    # Seed active scene for scene.context / secrets.briefing defaults.
    world_path = camp_dir / "save" / "world-state.json"
    world = json.loads(world_path.read_text(encoding="utf-8"))
    world["active_scene_id"] = "opening"
    world_path.write_text(json.dumps(world, indent=2) + "\n", encoding="utf-8")
    return cid, camp_dir


def test_publish_manifest_and_shard_hash_integrity(tmp_path: Path):
    _, camp_dir = _campaign(tmp_path)
    manifest = archive.load_manifest(camp_dir)
    assert manifest["schema_version"] == 1
    assert manifest["status"] == "current"
    assert manifest["content_sha256"].startswith("sha256:")
    assert "opening" in manifest["shard_index"]["scenes"]
    scene = archive.load_scene_shard(camp_dir, "opening")
    assert scene["entity_id"] == "opening"
    assert scene["keeper_only"]["secret"] is True
    assert "prose" not in scene["player_safe"]
    # player_safe projection cannot surface secret bodies
    safe = archive.player_safe_scene_view(scene)
    assert "secret" not in safe
    assert "prose" not in json.dumps(safe)


def test_stale_and_malformed_manifest_fail_closed(tmp_path: Path):
    _, camp_dir = _campaign(tmp_path)
    path = camp_dir / "save" / "compiled-archive" / "manifest.json"
    good = json.loads(path.read_text(encoding="utf-8"))
    # Malformed: missing required fields
    path.write_text(json.dumps({"schema_version": 1}), encoding="utf-8")
    with pytest.raises(archive.CompiledArchiveError) as exc:
        archive.load_manifest(camp_dir)
    assert exc.value.code == "archive_corrupt"
    # Stale hash: full field set but wrong content hash
    bad = dict(good)
    bad["content_sha256"] = "sha256:" + ("0" * 64)
    path.write_text(json.dumps(bad, indent=2), encoding="utf-8")
    with pytest.raises(archive.CompiledArchiveError) as exc2:
        archive.load_manifest(camp_dir)
    assert exc2.value.code == "archive_corrupt"


def test_changed_compiler_contract_marks_published_archive_stale_without_ir_scan(
    tmp_path: Path,
):
    _, camp_dir = _campaign(tmp_path)
    original_contract = archive._PLUGIN_CONTRACT_IDENTITY
    archive._PLUGIN_CONTRACT_IDENTITY = {
        **original_contract,
        "module_sha256": "sha256:" + ("0" * 64),
    }

    original_source_identity = archive.campaign_ir_source_identity
    original_publish = archive.publish_from_campaign

    def ban_source_identity(*_a, **_k):
        raise AssertionError("contract gate must not scan canonical IR")

    def ban_publish(*_a, **_k):
        raise AssertionError("hot-path contract gate must not rebuild")

    archive.campaign_ir_source_identity = ban_source_identity  # type: ignore[assignment]
    archive.publish_from_campaign = ban_publish  # type: ignore[assignment]
    try:
        with pytest.raises(archive.CompiledArchiveError) as exc:
            archive.load_manifest(camp_dir)
        assert exc.value.code == "archive_stale"

        published = archive.load_published(camp_dir)
        assert published["ok"] is False
        assert published["code"] == "archive_stale"
        assert "writer-side rebuild required" in published["error"]
    finally:
        archive._PLUGIN_CONTRACT_IDENTITY = original_contract
        archive.campaign_ir_source_identity = original_source_identity  # type: ignore[assignment]
        archive.publish_from_campaign = original_publish  # type: ignore[assignment]


def test_worker_merge_refreshes_archive_before_merged(tmp_path: Path):
    cid, camp_dir = _campaign(tmp_path)
    before = archive.load_manifest(camp_dir)["archive_revision"]
    assets.put_entity(tmp_path, "ca-demo", "location", "attic", _deep("attic"))
    qpath = tmp_path / ".coc/module-assets/ca-demo/parse-queue.json"
    qpath.write_text(
        json.dumps(
            {"schema_version": 1, "pending": [], "in_flight": [], "done": []},
            indent=2,
        ),
        encoding="utf-8",
    )
    assets.enqueue_job(
        tmp_path, "ca-demo", kind="deepen_location", target_id="attic", priority=50,
    )
    out = worker.run_worker_once(tmp_path, parallel=1)
    assert out["claimed"] == 1
    result = out["results"][0]
    assert result["ok"] is True
    assert result["result"] == "merged"
    assert cid in (result.get("merged_campaigns") or [cid])
    status = archive.load_status(camp_dir)
    assert status is not None
    assert status["status"] == "current"
    after = archive.load_manifest(camp_dir)
    assert after["archive_revision"] != before
    assert "attic" in after["shard_index"]["scenes"]
    assert after["shard_index"]["scenes"]["attic"]["parse_state"] == "deep"


def test_active_scene_packet_bounded_vs_whole_module(tmp_path: Path):
    _, camp_dir = _campaign(tmp_path)
    # Add a second deep scene so whole-module aggregate is larger.
    ir = project.load_campaign_ir(camp_dir)
    ir = project.merge_deep_location_into_ir(ir, _deep("cellar", with_secret=True))
    project.write_ir_to_campaign(camp_dir, ir, asset_root_id="ca-demo")

    packet = archive.active_scene_static_packet(camp_dir, "opening")
    packet_bytes = archive.payload_byte_size({
        "scene": packet["scene"]["player_safe"],
        "npcs": [row["player_safe"] for row in packet["npcs"]],
        "clues": [row["player_safe"] for row in packet["clues"]],
        "drilldown_refs": packet["drilldown_refs"],
    })
    # Legacy-equivalent aggregate: every scene/npc/clue player_safe surface.
    manifest = archive.load_manifest(camp_dir)
    whole = {"scenes": [], "npcs": [], "clues": [], "secrets": []}
    for sid, row in (manifest["shard_index"]["scenes"] or {}).items():
        shard = archive._load_shard(
            camp_dir,
            rel_path=row["path"],
            kind=archive.SCENE_KIND,
            expected_sha=row["content_sha256"],
        )
        whole["scenes"].append(shard["player_safe"])
    for nid, row in (manifest["shard_index"]["npcs"] or {}).items():
        shard = archive._load_shard(
            camp_dir,
            rel_path=row["path"],
            kind=archive.NPC_KIND,
            expected_sha=row["content_sha256"],
        )
        whole["npcs"].append(shard["player_safe"])
    for cid, row in (manifest["shard_index"]["clues"] or {}).items():
        shard = archive._load_shard(
            camp_dir,
            rel_path=row["path"],
            kind=archive.CLUE_KIND,
            expected_sha=row["content_sha256"],
        )
        whole["clues"].append(shard["player_safe"])
    for secret_id, row in (manifest["shard_index"]["keeper_secrets"] or {}).items():
        shard = archive._load_shard(
            camp_dir,
            rel_path=row["path"],
            kind=archive.SECRET_KIND,
            expected_sha=row["content_sha256"],
        )
        whole["secrets"].append(shard["keeper_only"])
    whole_bytes = archive.payload_byte_size(whole)
    assert len(manifest["shard_index"]["scenes"]) >= 2
    assert packet_bytes < whole_bytes
    # Strict upper bound: one active scene must stay under 80% of the
    # multi-scene aggregate so an unused/oversized archive cannot pass.
    assert packet_bytes < int(whole_bytes * 0.8)
    assert set(packet["scene"]["player_safe"]["available_clue_ids"]) <= {
        "clue-opening"
    }
    assert "clue-cellar" not in packet["scene"]["player_safe"]["available_clue_ids"]


def test_scene_context_consumes_archive_and_exposes_identity(tmp_path: Path):
    cid, camp_dir = _campaign(tmp_path)
    envelope = toolbox.run_tool(
        "scene.context",
        tmp_path,
        cid,
        {},
    )
    assert envelope["ok"] is True
    data = envelope["data"]
    assert data["active_scene_id"] == "opening"
    assert data["compiled_archive"]["source"] == "compiled_archive"
    assert data["compiled_archive"]["archive_revision"]
    assert "scene" in data["covered_domains"]
    assert isinstance(data["drilldown_refs"], dict)
    assert "clue-opening" in (data["drilldown_refs"].get("clue") or [])
    assert len(data["npcs_present"]) == 1
    npc = data["npcs_present"][0]
    assert npc["role_label"] == "委托人"
    assert npc["social_role"] is None
    assert npc["agenda"] == "Hire investigators quietly."
    assert npc["identity_ref"].startswith("npc-identity-v2:")
    assert npc["profile_revision_ref"].startswith("npc-profile-v2:")
    assert "identity_contract" not in npc
    scene_shard = archive.load_scene_shard(camp_dir, "opening")
    assert scene_shard["provenance"]["source_page_indices"] == [2]
    assert scene_shard["provenance"]["source_evidence"]["file_sha256"] == FAKE_SHA
    # No whole-module clue dump: only active scene clues
    clue_ids = {row["clue_id"] for row in data["clues_here"]}
    assert clue_ids == {"clue-opening"}

    queried = toolbox.run_tool(
        "npc.query", tmp_path, cid, {"npc_id": "npc-patron"}
    )
    assert queried["ok"] is True
    queried_npc = queried["data"]["npcs"][0]
    assert queried_npc["role_label"] == "委托人"
    assert queried_npc["social_role"] is None
    assert queried_npc["identity_contract"]["role"]["role_label"] == "委托人"
    assert queried_npc["identity_contract"]["source_refs"] == [
        {"source_id": "pdf:ca-demo", "pdf_index": 2}
    ]


def test_scene_context_cache_invalidates_when_archive_is_republished(tmp_path: Path):
    cid, camp_dir = _campaign(tmp_path)
    manifest = archive.load_manifest(camp_dir)
    archive._write_status(
        camp_dir,
        status="error",
        error="simulated stale generation",
        archive_revision="ca-v1-not-the-published-revision",
    )

    stale = toolbox.run_tool("scene.context", tmp_path, cid, {})
    assert stale["ok"] is True
    assert stale["data"]["compiled_archive"]["source"] == "scenario_ir_fallback"
    assert any("archive_stale" in row for row in stale["warnings"])
    stale_key = stale["cache"]["key"]

    repaired = toolbox.coc_compiled_archive.publish_from_campaign(camp_dir)
    assert repaired["ok"] is True
    assert repaired["archive_revision"] == manifest["archive_revision"]

    current = toolbox.run_tool("scene.context", tmp_path, cid, {})
    assert current["ok"] is True
    assert current["cache"]["status"] == "miss"
    assert current["cache"]["key"] != stale_key
    assert current["data"]["compiled_archive"]["source"] == "compiled_archive"
    assert current["data"]["compiled_archive"]["archive_revision"] == manifest["archive_revision"]
    assert not any("archive_stale" in row for row in current["warnings"])


def test_secrets_briefing_default_is_scene_scoped(tmp_path: Path):
    cid, camp_dir = _campaign(tmp_path)
    ir = project.load_campaign_ir(camp_dir)
    ir = project.merge_deep_location_into_ir(ir, _deep("cellar", with_secret=True))
    project.write_ir_to_campaign(camp_dir, ir, asset_root_id="ca-demo")

    default = toolbox.run_tool("secrets.briefing", tmp_path, cid, {})
    assert default["ok"] is True
    data = default["data"]
    assert data["scope"] == "active_scene"
    assert data["scene_id"] == "opening"
    assert data["compiled_archive"]["source"] == "compiled_archive"
    clue_ids = {row["clue_id"] for row in data["undiscovered_clues"]}
    assert "clue-opening" in clue_ids
    assert "clue-cellar" not in clue_ids
    secret_ids = {row["id"] for row in data.get("module_secrets") or []}
    assert "secret-cellar" not in secret_ids
    assert "secret-opening" in secret_ids
    npc_secret_ids = {row["npc_id"] for row in data.get("npc_secrets") or []}
    assert "npc-patron" in npc_secret_ids

    audit = toolbox.run_tool(
        "secrets.briefing",
        tmp_path,
        cid,
        {"scope": "whole_module_audit"},
    )
    assert audit["ok"] is True
    audit_clues = {row["clue_id"] for row in audit["data"]["undiscovered_clues"]}
    assert "clue-cellar" in audit_clues
    # Default payload must stay smaller than whole-module audit.
    assert archive.payload_byte_size(data) < archive.payload_byte_size(audit["data"])


def test_archive_error_does_not_corrupt_ir(tmp_path: Path):
    _, camp_dir = _campaign(tmp_path)
    ir_before = project.load_campaign_ir(camp_dir)
    # Force a publish failure path by monkeypatching build_documents.
    original = archive.build_documents

    def boom(*_a, **_k):
        raise RuntimeError("forced archive failure")

    archive.build_documents = boom  # type: ignore[assignment]
    try:
        # Re-bind project module's archive reference if it holds a separate copy.
        project_archive = project.coc_compiled_archive
        project_archive.build_documents = boom  # type: ignore[assignment]
        result = project_archive.publish_from_ir(camp_dir, ir_before)
        assert result["ok"] is False
        status = project_archive.load_status(camp_dir)
        assert status is not None
        assert status["status"] == "error"
        ir_after = project.load_campaign_ir(camp_dir)
        assert ir_after == ir_before
    finally:
        archive.build_documents = original  # type: ignore[assignment]
        project.coc_compiled_archive.build_documents = original  # type: ignore[assignment]


def test_hot_path_reads_do_not_rescan_or_rebuild(tmp_path: Path):
    """After writer publish, hot-path reads never hash IR or re-publish."""
    cid, camp_dir = _campaign(tmp_path)
    manifest_path = camp_dir / "save" / "compiled-archive" / "manifest.json"
    before_text = manifest_path.read_text(encoding="utf-8")
    before_rev = json.loads(before_text)["archive_revision"]

    def ban_source_identity(*_a, **_k):
        raise AssertionError("hot path must not call campaign_ir_source_identity")

    def ban_publish_from_campaign(*_a, **_k):
        raise AssertionError("hot path must not call publish_from_campaign")

    def ban_publish_from_ir(*_a, **_k):
        raise AssertionError("hot path must not call publish_from_ir")

    targets = (archive, toolbox.coc_compiled_archive, project.coc_compiled_archive)
    originals = [
        (
            mod,
            mod.campaign_ir_source_identity,
            mod.publish_from_campaign,
            mod.publish_from_ir,
        )
        for mod in targets
    ]
    for mod in targets:
        mod.campaign_ir_source_identity = ban_source_identity  # type: ignore[assignment]
        mod.publish_from_campaign = ban_publish_from_campaign  # type: ignore[assignment]
        mod.publish_from_ir = ban_publish_from_ir  # type: ignore[assignment]
    try:
        for _ in range(2):
            packet = archive.active_scene_static_packet(camp_dir, "opening")
            assert packet["archive_revision"] == before_rev
            envelope = toolbox.run_tool("scene.context", tmp_path, cid, {})
            assert envelope["ok"] is True
            assert envelope["data"]["compiled_archive"]["source"] == "compiled_archive"
            briefing = toolbox.run_tool("secrets.briefing", tmp_path, cid, {})
            assert briefing["ok"] is True
            assert briefing["data"]["compiled_archive"]["source"] == "compiled_archive"
        after_text = manifest_path.read_text(encoding="utf-8")
        assert after_text == before_text
        assert json.loads(after_text)["archive_revision"] == before_rev
    finally:
        for mod, src, pub_c, pub_ir in originals:
            mod.campaign_ir_source_identity = src  # type: ignore[assignment]
            mod.publish_from_campaign = pub_c  # type: ignore[assignment]
            mod.publish_from_ir = pub_ir  # type: ignore[assignment]


def test_mid_generation_failure_preserves_old_snapshot(tmp_path: Path):
    """Failed new generation must leave previous manifest + shards hash-valid."""
    _, camp_dir = _campaign(tmp_path)
    old_manifest = archive.load_manifest(camp_dir)
    old_rev = old_manifest["archive_revision"]
    old_scene_path = (
        camp_dir / "save" / "compiled-archive" / old_manifest["shard_index"]["scenes"]["opening"]["path"]
    )
    old_scene_bytes = old_scene_path.read_bytes()
    old_scene_sha = old_manifest["shard_index"]["scenes"]["opening"]["content_sha256"]

    ir = project.load_campaign_ir(camp_dir)
    ir = project.merge_deep_location_into_ir(ir, _deep("cellar", with_secret=True))

    original_write = archive.coc_fileio.write_json_atomic
    writes = {"n": 0}

    def flaky_write(path, payload, **kwargs):
        path = Path(path)
        # Fail after at least one shard of the *new* generation is written,
        # before the atomic manifest switch.
        if "generations" in path.parts and path.name != "manifest.json":
            writes["n"] += 1
            if writes["n"] >= 2:
                raise OSError("forced mid-generation shard failure")
        return original_write(path, payload, **kwargs)

    archive.coc_fileio.write_json_atomic = flaky_write  # type: ignore[assignment]
    try:
        result = archive.publish_from_ir(camp_dir, ir)
        assert result["ok"] is False
        assert "forced mid-generation" in str(result.get("error") or "")
    finally:
        archive.coc_fileio.write_json_atomic = original_write  # type: ignore[assignment]

    # Old published snapshot remains readable and hash-valid.
    still = archive.load_manifest(camp_dir)
    assert still["archive_revision"] == old_rev
    assert still["content_sha256"] == old_manifest["content_sha256"]
    scene = archive.load_scene_shard(camp_dir, "opening")
    assert scene["content_sha256"] == old_scene_sha
    assert old_scene_path.read_bytes() == old_scene_bytes
    # Skeleton already lists cellar as named_only; the failed publish must not
    # promote it to the deep revision in the live pointer.
    cellar_row = still["shard_index"]["scenes"].get("cellar")
    assert cellar_row is not None
    assert cellar_row.get("parse_state") == "named_only"
    assert cellar_row == old_manifest["shard_index"]["scenes"]["cellar"]
    # A partial new generation tree may exist on disk, but is not live.
    assert still["archive_revision"] == old_rev


def test_writer_and_disk_rebuild_share_seven_file_identity(tmp_path: Path):
    """publish_from_ir and publish_from_campaign use the same seven IR files."""
    _, camp_dir = _campaign(tmp_path)
    ir = project.load_campaign_ir(camp_dir)
    writer_identity = archive.ir_source_identity(ir)
    disk_identity = archive.campaign_ir_source_identity(camp_dir)
    assert writer_identity["file_names"] == list(archive.CANONICAL_IR_FILES)
    assert disk_identity["file_names"] == list(archive.CANONICAL_IR_FILES)
    assert "scenario.json" not in writer_identity["file_names"]
    assert "scenario.json" not in disk_identity["file_names"]
    assert writer_identity["ir_digest"] == disk_identity["ir_digest"]
    assert writer_identity == disk_identity

    # Explicit disk rebuild produces the same revision as the writer identity.
    expected_rev = archive.archive_revision_for_source(writer_identity)
    # Wipe live pointer only; leave IR intact, then rebuild from disk.
    manifest_path = camp_dir / "save" / "compiled-archive" / "manifest.json"
    if manifest_path.is_file():
        manifest_path.unlink()
    published = archive.publish_from_campaign(camp_dir)
    assert published["ok"] is True
    assert published["archive_revision"] == expected_rev
    rebuilt = archive.load_manifest(camp_dir)
    assert rebuilt["source_identity"]["file_names"] == list(archive.CANONICAL_IR_FILES)
    assert "scenario.json" not in rebuilt["source_identity"]["file_names"]
    assert rebuilt["source_identity"]["ir_digest"] == writer_identity["ir_digest"]


def test_entities_scope_does_not_imply_active_scene(tmp_path: Path):
    """scope=entities with one explicit NPC/clue excludes unrelated active scene."""
    cid, camp_dir = _campaign(tmp_path)
    ir = project.load_campaign_ir(camp_dir)
    ir = project.merge_deep_location_into_ir(ir, _deep("cellar", with_secret=True))
    # Add a second NPC so we can request an entity outside the active scene.
    ir = project.merge_deep_entity_into_ir(
        ir,
        "npc",
        {
            "npc_id": "npc-cellar-keeper",
            "name": "Cellar Keeper",
            "agenda": "Guard the cellar.",
            "player_safe_summary": "A quiet cellar attendant.",
            "parse_state": "deep",
            "scene_ids": ["cellar"],
        },
    )
    # Standalone NPC merge does not copy free-prose secret fields; stamp them
    # so the archive has a non-active-scene secret surface to select.
    for npc in ir["npc-agendas.json"]["npcs"]:
        if npc.get("npc_id") == "npc-cellar-keeper":
            npc["secret"] = "The cellar door only opens for the patron."
            npc["keeper_note"] = "Do not volunteer the latch secret."
            break
    project.write_ir_to_campaign(camp_dir, ir, asset_root_id="ca-demo")

    # Entity-only request: one explicit clue, no scene_id.
    only_clue = toolbox.run_tool(
        "secrets.briefing",
        tmp_path,
        cid,
        {"scope": "entities", "clue_ids": ["clue-cellar"]},
    )
    assert only_clue["ok"] is True
    data = only_clue["data"]
    assert data["scope"] == "entities"
    assert data.get("scene_id") in (None, "")
    clue_ids = {row["clue_id"] for row in data["undiscovered_clues"]}
    assert clue_ids == {"clue-cellar"}
    assert "clue-opening" not in clue_ids
    # Active-scene NPC secret must not leak in.
    npc_ids = {row["npc_id"] for row in data.get("npc_secrets") or []}
    assert "npc-patron" not in npc_ids
    secret_ids = {row["id"] for row in data.get("module_secrets") or []}
    assert "secret-opening" not in secret_ids

    only_npc = toolbox.run_tool(
        "secrets.briefing",
        tmp_path,
        cid,
        {"scope": "entities", "npc_ids": ["npc-cellar-keeper"]},
    )
    assert only_npc["ok"] is True
    npc_data = only_npc["data"]
    npc_ids2 = {row["npc_id"] for row in npc_data.get("npc_secrets") or []}
    assert npc_ids2 == {"npc-cellar-keeper"}
    clue_ids2 = {row["clue_id"] for row in npc_data.get("undiscovered_clues") or []}
    assert "clue-opening" not in clue_ids2
    assert "clue-cellar" not in clue_ids2


def test_status_write_failure_does_not_escape_publish(tmp_path: Path):
    """Secondary status I/O failure must not raise from publish_from_ir."""
    _, camp_dir = _campaign(tmp_path)
    ir = project.load_campaign_ir(camp_dir)

    mods = (archive, project.coc_compiled_archive, toolbox.coc_compiled_archive)
    original_status = {mod: mod._write_status for mod in mods}

    def boom_status(*_a, **_k):
        raise OSError("status root unwritable")

    for mod in mods:
        mod._write_status = boom_status  # type: ignore[assignment]
    try:
        # Failure path: build fails, status recording also fails → still no raise.
        original_build = archive.build_documents

        def boom_build(*_a, **_k):
            raise RuntimeError("forced build failure")

        archive.build_documents = boom_build  # type: ignore[assignment]
        try:
            result = archive.publish_from_ir(camp_dir, ir)
            assert result["ok"] is False
            assert "forced build failure" in str(result.get("error") or "")
        finally:
            archive.build_documents = original_build  # type: ignore[assignment]

        # Success path: generation+manifest publish succeeds even if status dies.
        ir2 = project.merge_deep_location_into_ir(ir, _deep("attic"))
        result_ok = archive.publish_from_ir(camp_dir, ir2)
        assert result_ok["ok"] is True
        live = archive.load_manifest(camp_dir)
        assert live["archive_revision"] == result_ok["archive_revision"]
        assert "attic" in live["shard_index"]["scenes"]

        # IR write path remains unaffected when archive status cannot be written.
        ir_before = project.load_campaign_ir(camp_dir)
        written = project.write_ir_to_campaign(
            camp_dir, ir_before, asset_root_id="ca-demo",
        )
        assert written  # IR files still written
        ir_after = project.load_campaign_ir(camp_dir)
        assert ir_after == ir_before
    finally:
        for mod, fn in original_status.items():
            mod._write_status = fn  # type: ignore[assignment]


def test_failed_new_generation_load_published_is_stale(tmp_path: Path):
    """Failed new generation: old manifest hash-valid, load_published fail-closed.

    Hot path must not hash IR or rebuild; status must carry the attempted
    revision so consumers can detect staleness without scanning scenario files.
    """
    _, camp_dir = _campaign(tmp_path)
    old_manifest = archive.load_manifest(camp_dir)
    old_rev = old_manifest["archive_revision"]

    ir = project.load_campaign_ir(camp_dir)
    ir = project.merge_deep_location_into_ir(ir, _deep("cellar", with_secret=True))
    expected_new_rev = archive.archive_revision_for_source(
        archive.ir_source_identity(ir)
    )
    assert expected_new_rev != old_rev

    original_write = archive.coc_fileio.write_json_atomic
    writes = {"n": 0}

    def flaky_write(path, payload, **kwargs):
        path = Path(path)
        if "generations" in path.parts and path.name != "manifest.json":
            writes["n"] += 1
            if writes["n"] >= 2:
                raise OSError("forced mid-generation shard failure")
        return original_write(path, payload, **kwargs)

    archive.coc_fileio.write_json_atomic = flaky_write  # type: ignore[assignment]
    try:
        result = archive.publish_from_ir(camp_dir, ir)
        assert result["ok"] is False
        assert "forced mid-generation" in str(result.get("error") or "")
    finally:
        archive.coc_fileio.write_json_atomic = original_write  # type: ignore[assignment]

    # Old published snapshot remains hash-valid via direct manifest load.
    still = archive.load_manifest(camp_dir)
    assert still["archive_revision"] == old_rev
    assert still["content_sha256"] == old_manifest["content_sha256"]

    status = archive.load_status(camp_dir)
    assert status is not None
    assert status["status"] == "error"
    assert status["archive_revision"] == expected_new_rev
    assert "forced mid-generation" in str(status.get("error") or "")

    def ban_source_identity(*_a, **_k):
        raise AssertionError("stale gate must not call campaign_ir_source_identity")

    def ban_publish_from_campaign(*_a, **_k):
        raise AssertionError("stale gate must not call publish_from_campaign")

    def ban_publish_from_ir(*_a, **_k):
        raise AssertionError("stale gate must not call publish_from_ir")

    originals = (
        archive.campaign_ir_source_identity,
        archive.publish_from_campaign,
        archive.publish_from_ir,
    )
    archive.campaign_ir_source_identity = ban_source_identity  # type: ignore[assignment]
    archive.publish_from_campaign = ban_publish_from_campaign  # type: ignore[assignment]
    archive.publish_from_ir = ban_publish_from_ir  # type: ignore[assignment]
    try:
        published = archive.load_published(camp_dir)
        assert published["ok"] is False
        assert published["code"] == "archive_stale"
        assert published.get("status") == "error"
        assert published.get("status_archive_revision") == expected_new_rev
        assert published.get("manifest_archive_revision") == old_rev
        assert published.get("status_error")
        # ensure_current is a read-only alias of the same gate.
        alias = archive.ensure_current(camp_dir)
        assert alias["ok"] is False
        assert alias["code"] == "archive_stale"
    finally:
        (
            archive.campaign_ir_source_identity,
            archive.publish_from_campaign,
            archive.publish_from_ir,
        ) = originals


def test_successful_manifest_consumable_when_status_writes_fail(tmp_path: Path):
    """Manifest publish succeeds; advisory status cleanup keeps load_published ok.

    If every status write fails but the atomic manifest switch completes,
    neutralize/remove the older mismatched status so consumers trust the new
    generation without IR rescan.
    """
    _, camp_dir = _campaign(tmp_path)
    prior_status = archive.load_status(camp_dir)
    assert prior_status is not None
    prior_rev = prior_status["archive_revision"]

    ir = project.load_campaign_ir(camp_dir)
    ir2 = project.merge_deep_location_into_ir(ir, _deep("attic"))
    expected_rev = archive.archive_revision_for_source(archive.ir_source_identity(ir2))
    assert expected_rev != prior_rev

    original_status = archive._write_status

    def boom_status(*_a, **_k):
        raise OSError("status root unwritable")

    archive._write_status = boom_status  # type: ignore[assignment]
    try:
        result = archive.publish_from_ir(camp_dir, ir2)
        assert result["ok"] is True
        assert result["archive_revision"] == expected_rev

        live = archive.load_manifest(camp_dir)
        assert live["archive_revision"] == expected_rev
        assert "attic" in live["shard_index"]["scenes"]

        # Cleanup should have removed the advisory status (missing → trust).
        assert archive.load_status(camp_dir) is None

        def ban_source_identity(*_a, **_k):
            raise AssertionError("must not call campaign_ir_source_identity")

        def ban_publish_from_campaign(*_a, **_k):
            raise AssertionError("must not call publish_from_campaign")

        def ban_publish_from_ir(*_a, **_k):
            raise AssertionError("must not call publish_from_ir")

        originals = (
            archive.campaign_ir_source_identity,
            archive.publish_from_campaign,
            archive.publish_from_ir,
        )
        archive.campaign_ir_source_identity = ban_source_identity  # type: ignore[assignment]
        archive.publish_from_campaign = ban_publish_from_campaign  # type: ignore[assignment]
        archive.publish_from_ir = ban_publish_from_ir  # type: ignore[assignment]
        try:
            published = archive.load_published(camp_dir)
            assert published["ok"] is True
            assert published["rebuilt"] is False
            assert published["archive_revision"] == expected_rev
            assert "attic" in published["manifest"]["shard_index"]["scenes"]
        finally:
            (
                archive.campaign_ir_source_identity,
                archive.publish_from_campaign,
                archive.publish_from_ir,
            ) = originals
    finally:
        archive._write_status = original_status  # type: ignore[assignment]
