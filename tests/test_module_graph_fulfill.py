#!/usr/bin/env python3
"""End to end through the lane: a graph-built section becomes a stored pack.

The recon verdict was that nothing new may be invented here -- so this test
walks the whole existing loop: graph registration writes the section index,
the queue worker materializes the host-work request, the shard is compiled
into a pack by the bridge, and fulfill flips the index to ``resolved``.  If
any seam in that chain is fake, this test cannot pass.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import sys
from pathlib import Path

import pytest

os.environ["COC_DISABLE_QUEUE_WORKER"] = "1"
os.environ["COC_FULL_PARSE_OCR_DISABLED"] = "1"

SCRIPTS = Path("plugins/coc-keeper/scripts")


def _load(name: str, rel: str):
    spec = importlib.util.spec_from_file_location(name, rel)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


assets = _load("coc_module_assets_gf", str(SCRIPTS / "coc_module_assets.py"))
sections = _load("coc_module_sections_gf", str(SCRIPTS / "coc_module_sections.py"))
bridge = _load("coc_module_shard_pack_gf", str(SCRIPTS / "coc_module_shard_pack.py"))
worker = _load("coc_module_queue_worker_gf", str(SCRIPTS / "coc_module_queue_worker.py"))
# The queue fixture helpers (synthetic bundle registration) live in the queue
# worker's test module; reusing them keeps the fixture single-sourced.
qw = _load("coc_module_queue_worker_tests_for_fulfill", "tests/test_module_queue_worker.py")


def test_graph_built_section_reaches_resolved_through_the_lane(tmp_path: Path):
    root = "gx-demo"
    # The queue fixture's campaign scaffold: two cached pages, identity,
    # a projected skeleton, and a live campaign to consume the result.
    qw._campaign(tmp_path, asset_root=root)
    qw._clear_queue(tmp_path, asset_root=root)
    identity = json.loads(
        (tmp_path / ".coc" / "module-assets" / root / "identity.json")
        .read_text(encoding="utf-8")
    )
    source = identity["source"]

    # 1. The graph lane registers its plan + skeleton into the section index.
    plan = {"sections": [{
        "section_id": "peru-open", "title": "秘鲁开场",
        "pdf_index_start": 0, "pdf_index_end": 1, "reason": "r",
    }]}
    skeleton = {"nodes": [{
        "node_id": "location-lima", "node_kind": "location", "name": "利马",
        "evidence_span_ids": ["span-page-0-block-1"],
    }]}
    index = sections.build_section_index_from_graph(
        plan=plan, skeleton=skeleton, opening_section_ids=["peru-open"],
        source_id=source["source_id"], file_sha256=source["file_sha256"],
        outline_sha256=hashlib.sha256(b"plan").hexdigest(),
        outline_producer="coc_module_build", page_count=2,
    )
    assets.write_section_index(tmp_path, root, index)

    # 2. The lane's own queue materializes the extraction request.
    queued = assets.enqueue_job(
        tmp_path, root, kind=assets.EXTRACT_SECTION_KIND,
        target_id="peru-open", priority=100, reason="scene_materialize:test",
        consumer_refs=qw._consumer(tmp_path, asset_root=root, intent_kind="scene_enter"),
    )
    assert queued.get("enqueued") is True, queued
    out = worker.run_worker_once(tmp_path, parallel=1)
    assert out["results"], "the worker must produce the host-work request"
    host_work = list(
        (tmp_path / ".coc" / "module-assets" / root / "host-work").glob("*.json")
    )
    assert host_work, "no host-work request materialized"
    request = json.loads(host_work[0].read_text(encoding="utf-8"))
    assert request["kind"] == assets.EXTRACT_SECTION_KIND
    job_id = request["job_id"]

    # 3. The accepted shard compiles into a pack the lane itself validates.
    extraction_request = request["extraction_request"]
    shard = {
        "module_id": "gx-demo", "section_id": "peru-open",
        "nodes": [
            {"node_id": "scene-gate", "node_kind": "scene",
             "name": "神庙大门", "summary": "调查员抵达大门。",
             "evidence_span_ids": ["span-page-0-block-1"]},
            {"node_id": "npc-keeper", "node_kind": "npc",
             "name": "看门人", "summary": "他认得那个印记。",
             "evidence_span_ids": ["span-page-0-block-2"]},
        ],
        "evidence_span_ids": ["span-page-0-block-1", "span-page-0-block-2"],
        "claims": [], "relations": [],
    }
    pack = bridge.shard_to_pack(shard, extraction_request)

    fulfilled = assets.put_section_pack_and_fulfill_host_work(
        tmp_path, root, host_work_job_id=job_id, pack=pack,
    )
    assert fulfilled["section_pack"]["section_id"] == "peru-open"

    # 4. The index flips and the document is real on disk.
    stored = assets.get_section_pack(tmp_path, root, "peru-open")
    assert stored is not None and stored["body_present"]
    assert "看门人" in (tmp_path / ".coc/module-assets" / root
                        / "sections" / "peru-open.md").read_text(encoding="utf-8")
    after = assets.read_section_index(tmp_path, root)
    row = next(r for r in after["sections"] if r["section_id"] == "peru-open")
    assert row["parse_state"] == "resolved"
