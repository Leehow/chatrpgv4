#!/usr/bin/env python3
"""Tests for background parallel progressive parse-queue worker."""
from __future__ import annotations

import importlib.util
import json
import os
import time
from pathlib import Path

# Prevent detached worker subprocess races during unit tests.
os.environ["COC_DISABLE_QUEUE_WORKER"] = "1"

SCRIPTS = Path("plugins/coc-keeper/scripts")
FAKE_SHA = "d" * 64


def _load(name: str, rel: str):
    spec = importlib.util.spec_from_file_location(name, rel)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


assets = _load("coc_module_assets_qw", str(SCRIPTS / "coc_module_assets.py"))
project = _load("coc_module_project_qw", str(SCRIPTS / "coc_module_project.py"))
worker = _load("coc_module_queue_worker_qw", str(SCRIPTS / "coc_module_queue_worker.py"))
state = _load("coc_state_qw", str(SCRIPTS / "coc_state.py"))
toolbox = _load("coc_toolbox_qw", str(SCRIPTS / "coc_toolbox.py"))


def _skeleton():
    return {
        "schema_version": 1,
        "parse_tier": 1,
        "module_identity": {"canonical_module_id": "qw-demo"},
        "structure_type": "branching_investigation",
        "source": {
            "source_id": "pdf:qw-demo",
            "path": "/tmp/qw-demo.pdf",
            "file_sha256": FAKE_SHA,
            "page_count": 4,
            "producer": "codex-pdf-skill",
        },
        "start_candidates": ["opening"],
        "finale_buckets": [{"id": "end", "title": "End", "importance": "critical"}],
        "locations": [
            {"location_id": "opening", "title": "Opening", "parse_state": "toc_only"},
            {
                "location_id": "cellar",
                "title": "Cellar",
                "parse_state": "named_only",
                "source_span": {"pdf_index_start": 1, "pdf_index_end": 1},
            },
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
        "npc_roster": [],
        "handouts": [],
        "threats": [],
        "conclusion_buckets": [],
    }


def _deep(loc_id: str) -> dict:
    return {
        "location_id": loc_id,
        "title": loc_id,
        "parse_state": "deep",
        "evidence_gap": False,
        "dramatic_question": f"What about {loc_id}?",
        "scene_type": "investigation",
        "player_safe_summary": f"Deep pack for {loc_id}.",
        "available_clue_ids": [f"clue-{loc_id}"],
        "clues": [
            {
                "clue_id": f"clue-{loc_id}",
                "delivery_kind": "obvious",
                "player_safe_summary": f"A real clue in {loc_id}.",
            }
        ],
        "npcs": [],
        "scene_edges": [],
        "affordances": [
            {
                "id": f"{loc_id}-look",
                "cue": "Look around",
                "route_type": "investigative_lead",
                "status": "open",
            },
            {
                "id": f"{loc_id}-leave",
                "cue": "Leave",
                "route_type": "travel",
                "status": "open",
            },
        ],
        "pressure_moves": [],
        "tone": [],
        "mentions": [],
        "keeper_secret_refs": [],
    }


def _campaign(tmp_path: Path, asset_root: str = "qw-demo") -> str:
    assets.init_module_root(
        tmp_path,
        asset_root_id=asset_root,
        identity={"canonical_module_id": asset_root},
        file_sha256=FAKE_SHA,
    )
    assets.put_page(
        tmp_path,
        asset_root,
        1,
        "# Cellar\n\nCached source scope.\n",
        meta={
            "source_id": "pdf:qw-demo",
            "review_state": "manual_accepted",
            "parse_confidence": 0.9,
            "grep_anchors": ["Cached source scope."],
        },
    )
    assets.put_skeleton(tmp_path, asset_root, _skeleton())
    assets.put_entity(tmp_path, asset_root, "location", "opening", _deep("opening"))
    cid = "qw-camp"
    state.create_campaign(tmp_path, cid, "QW Camp", play_language="zh-Hans")
    project.project_opening_deep(tmp_path, cid, asset_root)
    return cid


def _clear_queue(tmp_path: Path, asset_root: str = "qw-demo") -> None:
    qpath = tmp_path / ".coc/module-assets" / asset_root / "parse-queue.json"
    qpath.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "pending": [],
                "in_flight": [],
                "done": [],
            }
        ),
        encoding="utf-8",
    )


def test_claim_jobs_moves_to_in_flight(tmp_path: Path):
    _campaign(tmp_path)
    _clear_queue(tmp_path)
    assets.enqueue_job(
        tmp_path, "qw-demo", kind="deepen_location", target_id="cellar", priority=50,
    )
    assets.enqueue_job(
        tmp_path, "qw-demo", kind="deepen_location", target_id="attic", priority=80,
    )
    claimed = worker.claim_jobs(
        tmp_path, "qw-demo", limit=2, worker_id="w-test",
    )
    assert len(claimed) == 2
    # higher priority first
    assert claimed[0]["target_id"] == "attic"
    q = assets.list_queue(tmp_path, "qw-demo")
    assert q["pending"] == []
    assert len(q["in_flight"]) == 2
    assert all(j.get("worker_id") == "w-test" for j in q["in_flight"])


def test_worker_once_parallel_awaiting_host_and_merge(tmp_path: Path):
    cid = _campaign(tmp_path)
    _clear_queue(tmp_path)
    # cellar missing pack → awaiting_host + host-work file
    assets.enqueue_job(
        tmp_path, "qw-demo", kind="deepen_location", target_id="cellar", priority=50,
        reason="dig",
    )
    # attic has deep pack → should merge
    assets.put_entity(tmp_path, "qw-demo", "location", "attic", _deep("attic"))
    # put_entity may re-enqueue attic; clear and set both jobs explicitly
    _clear_queue(tmp_path)
    assets.enqueue_job(
        tmp_path, "qw-demo", kind="deepen_location", target_id="cellar", priority=50,
        reason="dig",
    )
    assets.enqueue_job(
        tmp_path, "qw-demo", kind="deepen_location", target_id="attic", priority=50,
        reason="dig",
    )

    out = worker.run_worker_once(tmp_path, parallel=2)
    assert out["claimed"] == 2
    results = {r["target_id"]: r for r in out["results"]}
    assert results["cellar"]["result"] == "awaiting_host_pack"
    assert "host_work_request" in results["cellar"]
    assert results["attic"]["ok"] is True
    assert results["attic"]["result"] in {"merged", "pack_ready_no_campaign"}

    # attic should appear deep in campaign IR after merge
    sg = json.loads(
        (tmp_path / ".coc/campaigns" / cid / "scenario" / "story-graph.json").read_text(
            encoding="utf-8"
        )
    )
    attic = next(s for s in sg["scenes"] if s["scene_id"] == "attic")
    assert attic.get("parse_state") == "deep"

    host_work = list(
        (tmp_path / ".coc/module-assets" / "qw-demo" / "host-work").glob("*.json")
    )
    assert host_work, "missing host-work request for cellar"
    request = json.loads(host_work[0].read_text(encoding="utf-8"))
    assert request["requested_pdf_indices"] == [1]
    assert request["cached_scope_complete"] is True
    assert request["cached_page_refs"][0]["pdf_index"] == 1
    assert "do not reopen the PDF" in request["instruction"]
    assert "host_work_job_id" in request["instruction"]

    open_requests = assets.list_host_work_requests(tmp_path, "qw-demo")
    assert len(open_requests) == 1
    assert open_requests[0]["job_id"] == request["job_id"]
    assert open_requests[0]["fulfillment_operation"]["tool"] == (
        "progressive.fulfill_host_work"
    )

    ctx = toolbox.Ctx(tmp_path, cid)
    status, _warnings, hints = toolbox.TOOLS["progressive.status"]["handler"](
        ctx, {},
    )
    assert status["host_work"]["open_count"] == 1
    assert any("not completed parses" in hint for hint in hints)

    fulfilled_pack = _deep("cellar")
    fulfilled, _warnings, _hints = toolbox.TOOLS[
        "progressive.fulfill_host_work"
    ]["handler"](
        ctx, {"job_id": request["job_id"], "pack": fulfilled_pack},
    )
    first_put = fulfilled["put"]
    first_timing = first_put["ingest_timing"]
    assert first_timing["host_work_job_id"] == request["job_id"]
    assert first_timing["host_request_to_pack_ms"] >= 0
    fulfilled_request = json.loads(host_work[0].read_text(encoding="utf-8"))
    assert fulfilled_request["status"] == "fulfilled"
    assert fulfilled_request["fulfilled_entity"] == {
        "kind": "location",
        "entity_id": "cellar",
    }

    fulfilled_pack["host_work_job_id"] = request["job_id"]
    second_put = assets.put_entity(
        tmp_path, "qw-demo", "location", "cellar", fulfilled_pack,
    )
    assert second_put["ingest_timing"]["pack_reuse_count"] == 1
    assert (
        second_put["ingest_timing"]["host_request_to_pack_ms"]
        == first_timing["host_request_to_pack_ms"]
    )


def test_same_source_scope_dedupes_after_stub_dig_metadata_update(
    tmp_path: Path,
):
    """One cached entity scope must not create one host request per question."""
    _campaign(tmp_path)
    _clear_queue(tmp_path)
    assets.ensure_stub(
        tmp_path,
        "qw-demo",
        "location",
        "cellar",
        title="Cellar",
        reason="mention_from:opening",
        source_scope={"source_page_indices": [1]},
    )
    assets.enqueue_job(
        tmp_path,
        "qw-demo",
        kind="deepen_location",
        target_id="cellar",
        priority=50,
        reason="structured mention",
    )
    worker.run_worker_once(tmp_path, parallel=1)

    stub = assets.get_entity(tmp_path, "qw-demo", "location", "cellar")
    assert stub is not None
    stub["evidence_gap"] = True
    stub["dig_pending"] = True
    assets.put_entity(tmp_path, "qw-demo", "location", "cellar", stub)

    repeated = assets.enqueue_job(
        tmp_path,
        "qw-demo",
        kind="deepen_location",
        target_id="cellar",
        priority=80,
        reason="player asks a second question about the same cellar",
    )

    assert repeated["enqueued"] is False
    assert repeated["deduped"] is True
    assert repeated["dedupe_state"] == "awaiting_host_pack"
    host_work = list(
        (tmp_path / ".coc/module-assets/qw-demo/host-work").glob("*.json")
    )
    assert len(host_work) == 1


def test_wider_stub_scope_supersedes_open_host_request(tmp_path: Path):
    _campaign(tmp_path)
    _clear_queue(tmp_path)
    assets.ensure_stub(
        tmp_path,
        "qw-demo",
        "location",
        "cellar",
        title="Cellar",
        source_scope={"source_page_indices": [1]},
    )
    assets.enqueue_job(
        tmp_path,
        "qw-demo",
        kind="deepen_location",
        target_id="cellar",
        reason="initial profile scope",
    )
    first = worker.run_worker_once(tmp_path, parallel=1)
    first_request_path = Path(first["results"][0]["host_work_request"])
    first_request = json.loads(first_request_path.read_text(encoding="utf-8"))
    assert first_request["requested_pdf_indices"] == [1]

    assets.put_page(
        tmp_path,
        "qw-demo",
        2,
        "# Cellar context\n",
        meta={
            "source_id": "pdf:qw-demo",
            "review_state": "manual_accepted",
            "parse_confidence": 0.9,
            "grep_anchors": ["Cellar context"],
        },
    )
    widened = assets.ensure_stub(
        tmp_path,
        "qw-demo",
        "location",
        "cellar",
        source_scope={"source_page_indices": [2]},
    )
    assert widened["entity"]["source_page_indices"] == [1, 2]
    repeated = assets.enqueue_job(
        tmp_path,
        "qw-demo",
        kind="deepen_location",
        target_id="cellar",
        reason="later contextual mention",
    )
    assert repeated["enqueued"] is True
    assert repeated["superseded_host_job_ids"] == [first_request["job_id"]]
    superseded = json.loads(first_request_path.read_text(encoding="utf-8"))
    assert superseded["status"] == "superseded"
    assert superseded["superseded_by_job_id"] == repeated["job"]["job_id"]

    second = worker.run_worker_once(tmp_path, parallel=1)
    second_request = json.loads(
        Path(second["results"][0]["host_work_request"]).read_text(encoding="utf-8")
    )
    assert second_request["requested_pdf_indices"] == [1, 2]
    assert second_request.get("status") is None


def test_dynamic_mention_stub_narrows_host_work_to_inherited_source_page(
    tmp_path: Path,
):
    _campaign(tmp_path)
    _clear_queue(tmp_path)
    assets.ensure_stub(
        tmp_path,
        "qw-demo",
        "location",
        "hidden-annex",
        title="Hidden Annex",
        reason="mention_from:cellar",
        source_scope={"source_page_indices": [1]},
    )
    assets.enqueue_job(
        tmp_path,
        "qw-demo",
        kind="deepen_location",
        target_id="hidden-annex",
        priority=70,
        reason="mention_from:cellar",
    )

    out = worker.run_worker_once(tmp_path, parallel=1)
    assert out["results"][0]["result"] == "awaiting_host_pack"
    request = json.loads(
        Path(out["results"][0]["host_work_request"]).read_text(encoding="utf-8")
    )
    assert request["requested_pdf_indices"] == [1]
    assert request["cached_scope_complete"] is True
    assert [row["pdf_index"] for row in request["cached_page_refs"]] == [1]


def test_host_work_unions_skeleton_profile_and_context_mention_pages(
    tmp_path: Path,
):
    _campaign(tmp_path)
    for pdf_index in (2, 3):
        assets.put_page(
            tmp_path,
            "qw-demo",
            pdf_index,
            f"# NPC context {pdf_index}\n",
            meta={
                "source_id": "pdf:qw-demo",
                "review_state": "manual_accepted",
                "parse_confidence": 0.9,
                "grep_anchors": [f"NPC context {pdf_index}"],
            },
        )
    skeleton = assets.get_skeleton(tmp_path, "qw-demo")
    assert skeleton is not None
    skeleton["npc_roster"] = [{
        "npc_id": "npc-priest",
        "name": "Priest",
        "parse_state": "named_only",
        "source_span": {"pdf_index_start": 1, "pdf_index_end": 1},
    }]
    assets.put_skeleton(tmp_path, "qw-demo", skeleton)
    assets.ensure_stub(
        tmp_path,
        "qw-demo",
        "npc",
        "npc-priest",
        title="Priest",
        reason="mention_from:church",
        source_scope={"source_page_indices": [2, 3]},
    )
    _clear_queue(tmp_path)
    assets.enqueue_job(
        tmp_path,
        "qw-demo",
        kind="deepen_npc",
        target_id="npc-priest",
        priority=80,
        reason="player asks about the priest",
    )

    out = worker.run_worker_once(tmp_path, parallel=1)
    assert out["results"][0]["result"] == "awaiting_host_pack"
    request = json.loads(
        Path(out["results"][0]["host_work_request"]).read_text(encoding="utf-8")
    )
    assert request["requested_source_scope"] == {
        "source_page_indices": [1, 2, 3],
    }
    assert request["requested_pdf_indices"] == [1, 2, 3]
    assert request["cached_scope_complete"] is True
    assert [row["pdf_index"] for row in request["cached_page_refs"]] == [1, 2, 3]


def test_worker_merges_standalone_npc_and_threat_into_live_ir(tmp_path: Path):
    cid = _campaign(tmp_path)
    assets.put_entity(tmp_path, "qw-demo", "npc", "npc-witness", {
        "parse_state": "deep",
        "evidence_gap": False,
        "name": "Witness",
        "agenda": "Tell only what the source supports.",
        "voice": "Measured.",
        "scene_ids": ["opening"],
    })
    assets.put_entity(tmp_path, "qw-demo", "threat", "threat-storm", {
        "parse_state": "deep",
        "evidence_gap": False,
        "label": "Oncoming storm",
        "applicability": "Places and people tied to the papers.",
        "manifestation_guidance": [{"id": "radio", "keeper_only": True}],
    })
    _clear_queue(tmp_path)
    assets.enqueue_job(
        tmp_path, "qw-demo", kind="deepen_npc", target_id="npc-witness",
    )
    assets.enqueue_job(
        tmp_path, "qw-demo", kind="deepen_threat", target_id="threat-storm",
    )

    result = worker.run_worker_once(tmp_path, parallel=2)
    assert {row["result"] for row in result["results"]} == {"merged"}
    scenario = tmp_path / ".coc" / "campaigns" / cid / "scenario"
    agendas = json.loads((scenario / "npc-agendas.json").read_text(encoding="utf-8"))
    witness = next(row for row in agendas["npcs"] if row["npc_id"] == "npc-witness")
    assert witness["agenda"] == "Tell only what the source supports."
    story = json.loads((scenario / "story-graph.json").read_text(encoding="utf-8"))
    opening = next(row for row in story["scenes"] if row["scene_id"] == "opening")
    assert "npc-witness" in opening["npc_ids"]
    fronts = json.loads((scenario / "threat-fronts.json").read_text(encoding="utf-8"))
    storm = next(row for row in fronts["fronts"] if row["front_id"] == "threat-storm")
    assert storm["parse_state"] == "deep"
    assert storm["manifestation_guidance"][0]["id"] == "radio"


def test_enqueue_kicks_worker_metadata(tmp_path: Path):
    _campaign(tmp_path)
    # Don't require detached process in CI; kick returns structured result.
    enq = assets.enqueue_job(
        tmp_path, "qw-demo", kind="deepen_location", target_id="cellar", priority=50,
    )
    assert enq.get("enqueued") is True
    assert "worker_kick" in enq


def test_stale_in_flight_requeue(tmp_path: Path):
    _campaign(tmp_path)
    _clear_queue(tmp_path)
    assets.enqueue_job(
        tmp_path, "qw-demo", kind="deepen_location", target_id="cellar", priority=50,
    )
    claimed = worker.claim_jobs(tmp_path, "qw-demo", limit=1, worker_id="w1")
    assert len(claimed) == 1
    # age the claim
    qpath = tmp_path / ".coc/module-assets" / "qw-demo" / "parse-queue.json"
    q = json.loads(qpath.read_text(encoding="utf-8"))
    q["in_flight"][0]["claimed_at_ts"] = time.time() - 10_000
    qpath.write_text(json.dumps(q), encoding="utf-8")
    moved = worker.requeue_stale_in_flight(tmp_path, "qw-demo", stale_after_s=1.0)
    assert moved == 1
    q2 = assets.list_queue(tmp_path, "qw-demo")
    assert any(j.get("target_id") == "cellar" for j in (q2.get("pending") or []))
    assert q2["in_flight"] == []
    pending = next(j for j in q2["pending"] if j.get("target_id") == "cellar")
    assert pending["requeue_count"] == 1
    assert worker.DEFAULT_STALE_IN_FLIGHT_S == 30.0


def test_finish_job_replaces_existing_completion_for_same_job_id(tmp_path: Path):
    _campaign(tmp_path)
    _clear_queue(tmp_path)
    job = {
        "job_id": "job-same",
        "kind": "deepen_location",
        "target_id": "cellar",
        "enqueued_at": "2026-01-01T00:00:00+00:00",
        "claimed_at": "2026-01-01T00:00:01+00:00",
    }

    worker._finish_job(tmp_path, "qw-demo", job, result="awaiting_host_pack")
    worker._finish_job(tmp_path, "qw-demo", job, result="merged")

    done = assets.list_queue(tmp_path, "qw-demo")["done"]
    assert len(done) == 1
    assert done[0]["job_id"] == "job-same"
    assert done[0]["result"] == "merged"
    assert done[0]["queue_wait_ms"] == 1000
    assert done[0]["processing_ms"] >= 0
    assert done[0]["total_ms"] >= done[0]["queue_wait_ms"]
