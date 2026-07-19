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
