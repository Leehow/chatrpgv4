#!/usr/bin/env python3
"""Tests for background parallel progressive parse-queue worker."""
from __future__ import annotations

import base64
import importlib.util
import hashlib
import json
import os
import subprocess
import threading
import time
from pathlib import Path

import pytest

# Prevent detached worker subprocess races during unit tests.
os.environ["COC_DISABLE_QUEUE_WORKER"] = "1"
# Never hit the real OCR API from unit tests.  The worker-native full_parse
# lane fails closed (full_parse_ocr_disabled) unless a test explicitly
# monkeypatches the OCR invocation and re-enables the lane.
os.environ["COC_FULL_PARSE_OCR_DISABLED"] = "1"

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
wire = _load("coc_mcp_wire_qw", str(SCRIPTS / "coc_mcp_wire.py"))


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
        "mechanics_locator_pass_status": "pending",
    }


def _deep(loc_id: str) -> dict:
    return {
        "location_id": loc_id,
        "title": loc_id,
        "parse_state": "deep",
        "evidence_gap": False,
        "source_page_indices": [0],
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
                    "authority": "source_authored",
                    "source_refs": [{"pdf_index": 0}],
                },
                "source_refs": [{"pdf_index": 0}],
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


def _register_qw_source_pages(
    tmp_path: Path,
    page_text: dict[int, str],
    *,
    asset_root: str = "qw-demo",
) -> dict:
    """Register only the accepted source pages used by one queue fixture."""
    pdf = tmp_path / f"{asset_root}.pdf"
    if not pdf.is_file():
        pdf.write_bytes(b"%PDF queue worker source fixture")
    file_sha = hashlib.sha256(pdf.read_bytes()).hexdigest()
    suffix = "-".join(str(index) for index in sorted(page_text))
    bundle = tmp_path / f"{asset_root}-source-{suffix}"
    bundle.mkdir()
    pages = []
    for pdf_index, text in sorted(page_text.items()):
        page_bytes = text.encode()
        markdown_path = f"page-{pdf_index:04d}.md"
        (bundle / markdown_path).write_bytes(page_bytes)
        anchor = next(
            line for line in reversed(text.splitlines()) if line.strip()
        )
        pages.append({
            "pdf_index": pdf_index,
            "markdown_path": markdown_path,
            "text_sha256": hashlib.sha256(page_bytes).hexdigest(),
            "review_state": "manual_accepted",
            "parse_confidence": 0.95,
            "grep_anchors": [anchor],
        })
    (bundle / "manifest.json").write_text(json.dumps({
        "schema_version": 1,
        "producer": "codex-pdf-skill",
        "source": {
            "source_id": f"pdf:{asset_root}",
            "title": "Queue Worker Demo",
            "path": str(pdf),
            "file_sha256": file_sha,
            "page_count": 4,
        },
        "pages": pages,
    }), encoding="utf-8")
    return assets.register_source_bundle(
        tmp_path,
        bundle,
        asset_root_id=asset_root,
        module_identity={"canonical_module_id": asset_root},
    )


def _campaign(tmp_path: Path, asset_root: str = "qw-demo") -> str:
    _register_qw_source_pages(tmp_path, {
        0: "# Opening\n\nAccepted authored clue scope.\n",
        1: "# Cellar\n\nCached source scope.\n",
    }, asset_root=asset_root)
    identity = json.loads(
        (
            tmp_path / ".coc" / "module-assets" / asset_root / "identity.json"
        ).read_text(encoding="utf-8")
    )
    skeleton = _skeleton()
    source = identity["source"]
    skeleton["source"] = {
        "source_id": source["source_id"],
        "path": source["path"],
        "file_sha256": source["file_sha256"],
        "page_count": source["page_count"],
        "producer": "codex-pdf-skill",
    }
    skeleton["start_clock_status"] = "unresolved"
    assets.put_skeleton(tmp_path, asset_root, skeleton)
    assets.put_entity(tmp_path, asset_root, "location", "opening", _deep("opening"))
    cid = "qw-camp"
    state.create_campaign(tmp_path, cid, "QW Camp", play_language="zh-Hans")
    project.project_opening_deep(tmp_path, cid, asset_root)
    # Most queue tests exercise host-work lifecycle rather than scope
    # discovery. Mark the fixture's cellar page as an already located body
    # window; identity-only behavior is covered by dedicated regressions.
    assets.ensure_stub(
        tmp_path,
        asset_root,
        "location",
        "cellar",
        body_source_scope={"source_page_indices": [1]},
    )
    return cid


def _consumer(
    tmp_path: Path,
    *,
    asset_root: str = "qw-demo",
    intent_kind: str = "player_dig",
) -> list[dict]:
    return [assets.campaign_consumer_ref(
        tmp_path,
        "qw-camp",
        asset_root,
        intent_kind=intent_kind,
    )]


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


def test_revision_bundle_bind_deepen_projects_immutable_path_to_pi_preload(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
):
    campaign_id = "revision-pi-camp"
    asset_root_id = "revision-pi-module"
    pdf = tmp_path / "revision-pi.pdf"
    pdf.write_bytes(b"%PDF revision source fixture")
    file_sha256 = hashlib.sha256(pdf.read_bytes()).hexdigest()
    bundle = tmp_path / "revision-pi-bundle"
    (bundle / "pages").mkdir(parents=True)
    page_text = "# Cellar\n\nImmutable progressive OCR evidence.\n"
    page_bytes = page_text.encode("utf-8")
    page_sha256 = hashlib.sha256(page_bytes).hexdigest()
    (bundle / "pages" / "0001.md").write_bytes(page_bytes)
    revision_ref = {
        "stable_id": "page:1:fast",
        "pdf_index": 1,
        "layer": "fast",
        "revision": 1,
        "content_sha256": page_sha256,
        "fast_confidence_revision": 1,
    }
    (bundle / "manifest.json").write_text(json.dumps({
        "schema_version": 1,
        "producer": "codex-pdf-skill",
        "source": {
            "source_id": "pdf:revision-pi-module",
            "title": "Revision Pi Module",
            "path": str(pdf),
            "file_sha256": file_sha256,
            "page_count": 2,
        },
        "pages": [{
            "pdf_index": 1,
            "markdown_path": "pages/0001.md",
            "text_sha256": page_sha256,
            "review_state": "manual_accepted",
            "parse_confidence": 0.95,
            "grep_anchors": ["Immutable progressive OCR evidence."],
            "ocr_revision": revision_ref,
        }],
    }), encoding="utf-8")

    created = toolbox.run_tool("setup.invoke", tmp_path, None, {
        "kind": "campaign.create",
        "payload": {"campaign_id": campaign_id, "title": "Revision Pi Campaign"},
    })
    assert created["ok"] is True, created
    bound = toolbox.run_tool("setup.invoke", tmp_path, None, {
        "kind": "scenario.bind_pdf",
        "payload": {
            "campaign_id": campaign_id,
            "scenario_id": asset_root_id,
            "title": "Revision Pi Module",
            "source_bundle_path": str(bundle),
            "compile_now": False,
        },
    })
    assert bound["ok"] is True, bound
    skeleton = _skeleton()
    skeleton["module_identity"] = {"canonical_module_id": asset_root_id}
    skeleton["source"] = {
        "source_id": "pdf:revision-pi-module",
        "path": str(pdf),
        "file_sha256": file_sha256,
        "page_count": 2,
        "producer": "codex-pdf-skill",
    }
    skeleton["start_clock_status"] = "unresolved"
    published = toolbox.run_tool(
        "progressive.publish_skeleton", tmp_path, campaign_id,
        {
            "asset_root_id": asset_root_id,
            "source_file_sha256": file_sha256,
            "skeleton": skeleton,
        },
    )
    assert published["ok"] is True, published
    assets.ensure_stub(
        tmp_path,
        asset_root_id,
        "location",
        "cellar",
        body_source_scope={"source_page_indices": [1]},
    )
    _clear_queue(tmp_path, asset_root_id)
    requested = toolbox.run_tool(
        "progressive.follow_mentions", tmp_path, campaign_id,
        {"mentions": [{"kind": "location", "ref_id": "cellar"}], "reason": "pi preload"},
    )
    assert requested["ok"] is True, requested
    materialized = worker.run_worker_once(tmp_path, parallel=1)
    assert materialized["claimed"] == 1

    # Binding arms the canonical opening-source review gate. On Pi that gate is
    # hard, so complete the coordinator review the product actually requires
    # before any Pi dispatch rather than reaching around it.
    scenario_path = (
        tmp_path / ".coc" / "campaigns" / campaign_id / "scenario" / "scenario.json"
    )
    scenario_json = json.loads(scenario_path.read_text(encoding="utf-8"))
    pending_task = scenario_json["opening_source_review_task"]
    review_receipt = (
        toolbox.coc_runtime_ops._build_opening_source_review_fulfillment(
            tmp_path,
            continuation={
                "schema_version": 1,
                "contract_id": pending_task["continuation_contract_id"],
                "campaign_id": campaign_id,
                "scenario_id": asset_root_id,
                "selected_opening_pdf_indices": [1],
                "source_bundle_id": asset_root_id,
                "source_bundle_path": scenario_json["source"]["source_bundle_path"],
                "result_delivery": "task_return_to_parent",
            },
            status="reviewed",
            selected_opening_pdf_indices=[1],
        )
    )
    toolbox.coc_runtime_ops._apply_opening_source_review_fulfillment(
        tmp_path, review_receipt,
    )

    monkeypatch.setenv("COC_HOST", "pi")
    claimed = toolbox.run_tool(
        "progressive.claim_host_work", tmp_path, campaign_id,
        {
            "executor_id": "pi:revision-path-test",
            "limit": 1,
            "result_delivery": "task_return_to_parent",
        },
    )
    assert claimed["ok"] is True, claimed
    task = claimed["data"]["dispatch_tasks"][0]
    assert task["contract_id"] == "coc.pi-source-pack-task.v1"
    ref = task["packet"]["requests"][0]["cached_page_refs"][0]
    expected_path = (
        tmp_path / ".coc" / "module-assets" / asset_root_id / "pages"
        / "0001" / "fast" / "revisions" / "000001" / "page.md"
    ).resolve()
    assert Path(ref["path"]) == expected_path
    assert expected_path.is_file()
    assert not (
        tmp_path / ".coc" / "module-assets" / asset_root_id / "pages" / "0001.md"
    ).exists()
    assert ref["ocr_revision"] == revision_ref
    assert ref["content_sha256"] == page_sha256

    task_path = tmp_path / "pi-leaf-task.json"
    task_path.write_text(json.dumps(task), encoding="utf-8")
    preloaded = subprocess.run(
        [
            "node", "--experimental-strip-types",
            "tests/pi/repository-ref-preload.mjs", str(Path.cwd()), str(task_path),
        ],
        cwd=Path.cwd(), check=True, capture_output=True, text=True,
    )
    preload = json.loads(preloaded.stdout)
    assert preload == {
        "contract_id": "coc.pi-leaf-evidence-context.v1",
        "page_count": 1,
        "path": str(expected_path),
        "text_sha256": page_sha256,
        "content_sha256": page_sha256,
        "ocr_revision": revision_ref,
    }


def _accepted_scope(tmp_path: Path, pdf_index: int) -> tuple[dict, dict]:
    identity = json.loads(
        (tmp_path / ".coc/module-assets/qw-demo/identity.json").read_text(
            encoding="utf-8"
        )
    )
    scope = assets.validate_opening_source_window(
        tmp_path,
        "qw-demo",
        bundle_sha256=identity["source_bundles"][0]["bundle_sha256"],
        pdf_indices=[pdf_index],
    )
    return identity, scope


def _produce_host_request(
    tmp_path: Path, *, kind: str, target_id: str, **enqueue_args,
) -> tuple[dict, Path]:
    enqueue_args.setdefault("consumer_refs", _consumer(tmp_path))
    queued = assets.enqueue_job(
        tmp_path, "qw-demo", kind=kind, target_id=target_id, **enqueue_args,
    )
    produced = worker.run_worker_once(tmp_path, parallel=1)
    return queued, Path(produced["results"][0]["host_work_request"])


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


def test_in_flight_dedupe_unions_consumers_into_eventual_packet(tmp_path: Path):
    _campaign(tmp_path)
    second_id = "qw-camp-two"
    state.create_campaign(tmp_path, second_id, "QW Camp Two", play_language="zh-Hans")
    project.project_skeleton_to_campaign(tmp_path, second_id, "qw-demo")
    _clear_queue(tmp_path)
    first_ref = _consumer(tmp_path)[0]
    second_ref = assets.campaign_consumer_ref(
        tmp_path, second_id, "qw-demo", intent_kind="player_dig",
    )
    queued = assets.enqueue_job(
        tmp_path,
        "qw-demo",
        kind="deepen_location",
        target_id="cellar",
        reason="first campaign",
        consumer_refs=[first_ref],
        kick_worker=False,
    )
    claimed_jobs = worker.claim_jobs(
        tmp_path, "qw-demo", limit=1, worker_id="consumer-union",
    )
    assert len(claimed_jobs) == 1

    deduped = assets.enqueue_job(
        tmp_path,
        "qw-demo",
        kind="deepen_location",
        target_id="cellar",
        reason="second campaign",
        consumer_refs=[second_ref],
        kick_worker=False,
    )
    assert deduped["dedupe_state"] == "in_flight"
    in_flight = assets.list_queue(tmp_path, "qw-demo")["in_flight"][0]
    assert in_flight["consumer_refs"] == assets.validate_host_work_consumer_refs(
        [first_ref, second_ref]
    )

    processed = worker.process_claimed_job(
        tmp_path, "qw-demo", claimed_jobs[0],
    )
    assert processed["result"] == "awaiting_host_pack"
    packet = assets.claim_host_work_requests(
        tmp_path,
        "qw-demo",
        executor_id="consumer-packet",
    )["packets"][0]
    assert packet["requests"][0]["job_id"] == queued["job"]["job_id"]
    assert packet["requests"][0]["consumer_refs"] == (
        assets.validate_host_work_consumer_refs([first_ref, second_ref])
    )
    assert packet["consumer_refs"] == assets.validate_host_work_consumer_refs(
        [first_ref, second_ref]
    )


def test_worker_once_parallel_awaiting_host_and_merge(tmp_path: Path):
    cid = _campaign(tmp_path)
    _clear_queue(tmp_path)
    # cellar missing pack → awaiting_host + host-work file
    assets.enqueue_job(
        tmp_path, "qw-demo", kind="deepen_location", target_id="cellar", priority=50,
        reason="dig",
        consumer_refs=_consumer(tmp_path),
    )
    # attic has deep pack → should merge
    assets.put_entity(tmp_path, "qw-demo", "location", "attic", _deep("attic"))
    # put_entity may re-enqueue attic; clear and set both jobs explicitly
    _clear_queue(tmp_path)
    assets.enqueue_job(
        tmp_path, "qw-demo", kind="deepen_location", target_id="cellar", priority=50,
        reason="dig",
        consumer_refs=_consumer(tmp_path),
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
    assert "closed result_contract" in request["instruction"]
    assert "fulfillment operation binds the request transiently" in request[
        "instruction"
    ]
    result_contract = request["result_contract"]
    assert result_contract["contract_id"] == "coc.location-body-pack.v1"
    assert result_contract["closed"] is True
    assert result_contract["parse_state"] == "deep"
    assert result_contract["required_location_fields"] == [
        "location_id",
        "player_safe_summary",
        "source_page_indices",
        "source_refs",
    ]
    location_pack_contract = result_contract["location_pack"]
    assert location_pack_contract["fixed_fields"] == {
        "parse_state": "deep",
        "evidence_gap": False,
        "origin": "source",
    }
    assert location_pack_contract["copy_from_request"] == {
        "location_id": "target_id",
        "host_work_job_id": "job_id",
        "source_page_indices": "requested_pdf_indices",
        "source_refs": {
            "from": "cached_page_refs",
            "select_fields": ["source_id", "pdf_index", "text_sha256"],
            "scope": "exact",
        },
    }
    assert location_pack_contract["required_semantic_fields"] == [
        "title", "player_safe_summary",
    ]
    assert location_pack_contract["row_contracts"]["clue"]["required_fields"] == [
        "clue_id",
        "player_safe_summary",
        "discovery",
        "provenance",
        "source_refs",
    ]
    assert location_pack_contract["row_contracts"]["scene_edge"]["required_fields"] == [
        "to",
    ]

    open_requests = assets.list_host_work_requests(tmp_path, "qw-demo")
    assert len(open_requests) == 1
    assert open_requests[0]["job_id"] == request["job_id"]
    assert open_requests[0]["fulfillment_operation"]["tool"] == (
        "progressive.fulfill_host_work"
    )
    assert open_requests[0]["fulfillment_operation"]["args"] == {
        "worker_result": "<exact completed child results[i] object>",
        "host_task_timing": "<exact host task metadata when available>",
    }

    ctx = toolbox.Ctx(tmp_path, cid)
    status, _warnings, hints = toolbox.TOOLS["progressive.status"]["handler"](
        ctx, {},
    )
    assert status["host_work"]["open_count"] == 1
    assert status["host_work"]["ready_for_background_count"] == 1
    status_takeover = status["background_takeover"]
    assert status_takeover["dispatch_mode"] == "direct_single_leaf"
    assert "coordinator_dispatch" not in status_takeover
    direct = status_takeover["direct_single_leaf_dispatch"]
    assert direct["run_in_background"] is True
    claim_task = direct["codex_task"]
    assert claim_task["contract_id"] == "coc.codex-source-pack-claim-task.v1"
    assert claim_task["claim_operation"]["prefilled_arguments"]["limit"] == 1
    assert claim_task["claim_operation"]["prefilled_arguments"][
        "result_delivery"
    ] == "task_return_to_parent"
    assert direct["codex_parent_claims"] is False
    assert direct["completion_operation"]["operation"] == (
        "progressive.fulfill_host_work"
    )
    assert any("not completed parses" in hint for hint in hints)

    claimed, _warnings, claim_hints = toolbox.TOOLS[
        "progressive.claim_host_work"
    ]["handler"](
        ctx, claim_task["claim_operation"]["prefilled_arguments"],
    )
    assert claimed["leased_group_count"] == 1
    task = claimed["dispatch_tasks"][0]
    assert task["contract_id"] == "coc.codex-source-pack-task.v1"
    packet = task["packet"]
    assert packet["contract_id"] == "coc.source-pack-worker.v1"
    assert packet["cached_scope_complete"] is True
    assert packet["requested_pdf_indices"] == [1]
    assert packet["requests"][0]["job_id"] == request["job_id"]
    assert packet["requests"][0]["result_contract"] == result_contract
    assert any("continue play" in hint for hint in claim_hints)
    leased_request = assets.list_host_work_requests(tmp_path, "qw-demo")[0]

    fulfilled_pack = _deep("cellar")
    fulfilled, _warnings, _hints = toolbox.TOOLS[
        "progressive.fulfill_host_work"
    ]["handler"](
        ctx,
        {
            "worker_result": {
                "job_id": request["job_id"],
                "pack": fulfilled_pack,
                "related_packs": [],
            },
            "host_task_timing": {
                "started_at": leased_request["leased_at"],
                "completed_at": leased_request["leased_at"],
                "duration_ms": 0,
                "task_id": "grok-task-test-1",
            },
        },
    )
    first_put = fulfilled["put"]
    first_timing = first_put["ingest_timing"]
    assert "host_work_job_id" not in first_timing
    assert first_timing[assets.FULFILLED_PACK_INGEST_FIELD]["job_id"] == (
        request["job_id"]
    )
    assert first_timing["host_request_to_pack_ms"] >= 0
    assert first_timing["source_compile_ms"] == 0
    assert first_timing["producer"] == "host_background_subagent"
    assert first_timing["source_timing_measurement"] == "exact_host_task_runtime"
    assert first_timing["source_task_id"] == "grok-task-test-1"
    assert first_timing["source_executor_id"] == (
        claim_task["claim_operation"]["prefilled_arguments"]["executor_id"]
    )
    assert first_timing["source_dispatch_to_pack_ms"] >= 0
    assert fulfilled["measured_host_timing"]["duration_ms"] == (
        first_timing["source_compile_ms"]
    )
    fulfilled_request = json.loads(host_work[0].read_text(encoding="utf-8"))
    assert fulfilled_request["status"] == "fulfilled"
    current_cellar = assets.get_entity(
        tmp_path, "qw-demo", "location", "cellar",
    )
    assert fulfilled_request["fulfilled_entity"] == (
        assets.canonical_fulfilled_entity_receipt(
            "location", "cellar", current_cellar,
        )
    )

    fulfilled_pack["host_work_job_id"] = request["job_id"]
    second_put = assets.put_entity(
        tmp_path, "qw-demo", "location", "cellar", fulfilled_pack,
    )
    second_stored = assets.get_entity(
        tmp_path, "qw-demo", "location", "cellar",
    )
    assert "host_work_job_id" not in second_stored
    assert "host_work_job_id" not in second_put["ingest_timing"]
    assert second_put["ingest_timing"]["pack_reuse_count"] == 1
    assert (
        second_put["ingest_timing"]["host_request_to_pack_ms"]
        == first_timing["host_request_to_pack_ms"]
    )


def test_partial_opening_host_request_and_packet_keep_exact_subset(tmp_path: Path):
    _campaign(tmp_path)
    _clear_queue(tmp_path)
    identity = json.loads(
        (
            tmp_path / ".coc" / "module-assets" / "qw-demo" / "identity.json"
        ).read_text(encoding="utf-8")
    )
    bundle_sha = identity["source_bundles"][0]["bundle_sha256"]
    scope = assets.validate_opening_source_window(
        tmp_path,
        "qw-demo",
        bundle_sha256=bundle_sha,
        pdf_indices=[0],
    )
    queued = assets.enqueue_job(
        tmp_path,
        "qw-demo",
        kind="partial_opening",
        target_id="opening",
        request_purpose=assets.FOREGROUND_OPENING_PURPOSE,
        requested_source_scope=scope,
        work_level="current_dependency",
        dependency_ref={
            "operation": "progressive.project_opening",
            "subject": {"kind": "location", "id": "opening"},
            "source_scope_signature": assets.opening_source_scope_signature(scope),
        },
        consumer_refs=_consumer(tmp_path, intent_kind="opening"),
    )

    result = worker.run_worker_once(tmp_path, parallel=1)
    assert result["results"][0]["result"] == "awaiting_host_pack"
    request_path = Path(result["results"][0]["host_work_request"])
    request = json.loads(request_path.read_text(encoding="utf-8"))
    assert request["job_id"] == queued["job"]["job_id"]
    assert request["kind"] == "partial_opening"
    assert request["request_purpose"] == "foreground_opening_slice"
    assert request["requested_source_scope"] == scope
    assert request["requested_pdf_indices"] == [0]
    assert request["work_level"] == "current_dependency"
    assert request["dependency_ref"] == {
        "operation": "progressive.project_opening",
        "subject": {"kind": "location", "id": "opening"},
        "source_scope_signature": assets.opening_source_scope_signature(scope),
    }
    assert [row["pdf_index"] for row in request["cached_page_refs"]] == [0]
    assert "parse_state=partial" in request["instruction"]
    assert "named source transport" in request["instruction"]
    assert "exact fallback parent" in request["instruction"]
    result_contract = request["result_contract"]
    assert result_contract["contract_id"] == "coc.foreground-opening-pack.v1"
    assert result_contract["closed"] is True
    assert result_contract["required_location_fields"] == [
        "location_id",
        "player_safe_summary",
        "source_page_indices",
        "source_refs",
    ]
    assert result_contract["exact_source_scope"] is True
    opening_setup = result_contract["opening_setup"]
    assert opening_setup["start_clock"]["required_fields"] == [
        "calendar_mode",
        "local_datetime",
        "local_date",
        "timezone",
        "display",
        "time_precision",
        "day_phase_hint",
    ]
    assert opening_setup["start_clock"]["optional_fields"] == [
        "location_id", "day_phase_boundaries",
    ]
    assert opening_setup["start_clock"]["forbidden_aliases"] == [
        "phase", "precision",
    ]
    assert opening_setup["start_clock"]["relative_day_phase_template"] == {
        "calendar_mode": "relative",
        "local_datetime": None,
        "local_date": None,
        "timezone": None,
        "display": "<exact-source-supported-display>",
        "time_precision": "day_phase",
        "day_phase_hint": "<morning|afternoon|evening|night>",
    }
    assert opening_setup["start_clock"]["relative_unknown_template"] == {
        "calendar_mode": "relative",
        "local_datetime": None,
        "local_date": None,
        "timezone": None,
        "display": "<exact-source-supported-display>",
        "time_precision": "unknown",
        "day_phase_hint": None,
    }
    shape_rules = opening_setup["start_clock"][
        "receiver_complete_shape_rules"
    ]
    assert shape_rules[0] == {
        "calendar_mode_class": "relative",
        "time_precision_values": ["day_phase", "unknown"],
        "local_datetime": None,
        "local_date": None,
        "timezone": None,
    }
    assert {
        tuple(rule["time_precision_values"])
        for rule in shape_rules
        if rule["calendar_mode_class"] == "non_relative"
    } == {
        ("exact", "minute", "hour"),
        ("date",),
        ("day_phase",),
    }
    assert opening_setup["start_clock_source_ref_required_fields"] == [
        "source_id", "pdf_index",
    ]
    location_pack = result_contract["location_pack"]
    assert location_pack["fixed_fields"] == {
        "parse_state": "partial",
        "evidence_gap": False,
        "origin": "source",
    }
    assert location_pack["copy_from_request"] == {
        "location_id": "target_id",
        "host_work_job_id": "job_id",
        "source_page_indices": "requested_pdf_indices",
        "source_refs": {
            "from": "cached_page_refs",
            "select_fields": ["source_id", "pdf_index", "text_sha256"],
            "scope": "exact",
        },
    }
    assert set(location_pack["empty_defaults"]) == {
        "available_clue_ids",
        "npc_ids",
        "clues",
        "npcs",
        "scene_edges",
        "affordances",
        "keeper_secret_refs",
        "pressure_moves",
        "tone",
        "mentions",
    }
    assert all(value == [] for value in location_pack["empty_defaults"].values())
    assert result_contract["first_submission_guidance"] == {
        "authority": "advisory",
        "hard_gate": False,
        "copy_contract_values": [
            "location_pack.fixed_fields",
            "location_pack.copy_from_request",
            "location_pack.empty_defaults",
        ],
        "required_semantics_only": {
            "location_fields": ["title", "player_safe_summary"],
            "materially_present_npc_fields": ["npc_id", "agenda"],
            "npc_policy": "source_supported_and_materially_present_only",
            "opening_completeness_pass": [
                "current_situation",
                "complete_current_briefing_and_material_referenced_facts",
                "authored_choices_or_investigation_paths",
                "information_each_path_can_establish",
                "named_conditional_contacts_as_mentions",
                "materially_present_npcs",
            ],
        },
        "semantic_default_replacement": {
            "clues": "populate every source-authored clue needed to play the current beat",
            "affordances": "populate source-authored immediately usable courses of action",
            "mentions": "populate source-authored referenced entities; note may preserve current-beat context but never asserts presence, discovery, or disclosure",
            "scene_edges": "populate only source-established destination locations",
        },
        "all_empty_semantic_arrays_allowed_only_when_source_authors_none": True,
        "semantic_judgment_not_keyword_gate": True,
        "invent_unsupported_clock_route_person_or_fact": False,
        "self_check_before_status_usable": True,
        "unsatisfied_required_fields_result": {
            "status": "abstain",
            "results": [],
        },
        "parent_repair_allowed": False,
    }
    assert location_pack["source_ref"]["field_types"] == {
        "source_id": "string",
        "pdf_index": "non_negative_integer",
        "text_sha256": "64_hex_string",
    }
    row_contracts = location_pack["row_contracts"]
    edge_contract = row_contracts["scene_edge"]
    assert edge_contract["template"]["when"] == {"kind": "always"}
    assert edge_contract["when_kind_values"] == sorted(
        assets._EXIT_CONDITION_KINDS
    )
    assert edge_contract["optional_fields"] == {
        "travel_minutes": (
            "positive_integer copied only from an exact "
            "source-authored travel duration"
        ),
    }
    assert edge_contract["forbidden_fields"] == ["when.type"]
    assert row_contracts["affordance"]["required_fields"] == [
        "id", "cue", "route_type", "status",
    ]
    clue_contract = row_contracts["clue"]
    assert clue_contract["discovery_mode_values"] == sorted(
        assets.CLUE_DISCOVERY_MODES
    )
    assert clue_contract["discovery_difficulty_values"] == sorted(
        assets.CLUE_CHECK_DIFFICULTIES
    )
    assert clue_contract["template"]["discovery"] == {
        "mode": "automatic",
        "skill": None,
        "difficulty": None,
        "condition": None,
    }
    assert clue_contract["template"]["provenance"] == {
        "authority": "source_authored",
        "basis": "host_pack",
    }
    assert isinstance(clue_contract["template"]["source_refs"], list)
    assert row_contracts["npc"]["required_fields"] == ["npc_id", "agenda"]
    assert row_contracts["provenance"]["allowed_fields"] == sorted(
        assets.FACT_PROVENANCE_FIELDS
    )
    assert row_contracts["provenance"]["authority_values"] == sorted(
        assets.FACT_PROVENANCE_AUTHORITIES
    )
    assert len(json.dumps(result_contract).encode("utf-8")) < 8 * 1024
    assert result_contract["materially_present_npc"] == {
        "same_pack": True,
        "required_fields": ["npc_id", "agenda"],
        "agenda_scope": "source_bounded_immediate",
    }
    assert result_contract["missing_agenda_disposition"] == "soft_deferred"
    assert result_contract["replacement_before_opening"] is False
    assert result_contract["worker_result_pack_shape"] == (
        "direct_location_entity; never nest it under a location key"
    )
    assert "closed result_contract" in request["instruction"]
    source_worker_contract = json.loads(
        Path(
            "plugins/coc-keeper/references/source-pack-worker-v1.json"
        ).read_text(encoding="utf-8")
    )
    assert result_contract == source_worker_contract["packet"][
        "foreground_opening_slice"
    ]["result_contract"]

    claimed = assets.claim_host_work_requests(
        tmp_path,
        "qw-demo",
        executor_id="opening-packet-test",
        limit=1,
    )
    packet = claimed["packets"][0]
    assert packet["request_purpose"] == "foreground_opening_slice"
    assert packet["requested_source_scope"] == scope
    assert packet["source_scope_signature"] == request["source_scope_signature"]
    assert packet["requested_pdf_indices"] == [0]
    assert packet["requests"][0]["requested_source_scope"] == scope
    assert packet["requests"][0]["result_contract"] == result_contract
    assert [
        row["pdf_index"] for row in packet["requests"][0]["cached_page_refs"]
    ] == [0]

    partial_pack = _deep("opening")
    partial_pack["parse_state"] = "partial"
    partial_pack["host_work_job_id"] = request["job_id"]
    partial_pack["scene_edges"] = [{
        "to": "cellar",
        "kind": "travel",
        "when": {"kind": "clock_reaches", "threshold": "noon"},
    }]
    with pytest.raises(
        assets.ModuleAssetsError,
        match=r"scene_edges\[0\]\.when\.threshold must be an integer",
    ):
        assets.put_entity(
            tmp_path, "qw-demo", "location", "opening", partial_pack,
        )
    partial_pack["scene_edges"] = []
    partial_pack["affordances"] = []
    assets.put_entity(
        tmp_path, "qw-demo", "location", "opening", partial_pack,
    )
    stored = assets.get_entity(
        tmp_path, "qw-demo", "location", "opening",
    )
    assert stored["scene_edges"] == []
    assert stored["affordances"] == []
    assert "host_work_job_id" not in stored
    assert "host_work_job_id" not in stored["ingest_timing"]
    assert worker.process_claimed_job(
        tmp_path, "qw-demo", queued["job"],
    )["result"] == "entity_ready"

    changed = json.loads(json.dumps(stored))
    changed["player_safe_summary"] = "Changed after fulfillment."
    changed["host_work_job_id"] = request["job_id"]
    assets.put_entity(
        tmp_path, "qw-demo", "location", "opening", changed,
    )
    rewritten = assets.get_entity(
        tmp_path, "qw-demo", "location", "opening",
    )
    assert "host_work_job_id" not in rewritten
    assert assets.current_ingest_fulfillment_receipt(rewritten) is None
    assert worker.process_claimed_job(
        tmp_path, "qw-demo", queued["job"],
    )["result"] == "awaiting_host_pack"


def test_unknown_source_scope_never_expands_to_all_cached_pages(tmp_path: Path):
    _campaign(tmp_path)
    _clear_queue(tmp_path)
    assets.enqueue_job(
        tmp_path,
        "qw-demo",
        kind="deepen_location",
        target_id="attic",
        reason="no exact source scope yet",
    )

    result = worker.run_worker_once(tmp_path, parallel=1)
    request = json.loads(
        Path(result["results"][0]["host_work_request"]).read_text(encoding="utf-8")
    )

    assert request["requested_pdf_indices"] == []
    assert request["cached_page_refs"] == []
    assert request["pages_cached"] == []
    assert request["cached_scope_complete"] is None
    assert request["source_scope_status"] == "unknown"
    assert request["dispatch_state"] == "awaiting_scope"
    assert request["work_level"] == "near_term"
    assert "dependency_ref" not in request
    assert "Do not open or scan the PDF" in request["instruction"]
    assert "do not scan unrelated cached pages" in request["instruction"]
    lifecycle = assets.host_work_lifecycle_summary(tmp_path, "qw-demo")
    assert lifecycle["open_host_work_count"] == 1
    assert lifecycle["legacy_unowned_count"] == 1
    assert lifecycle["runnable_count"] == 0
    assert lifecycle["stranded_ready_count"] == 0
    assert assets.claim_host_work_requests(
        tmp_path,
        "qw-demo",
        executor_id="unknown-scope-test",
    )["packets"] == []

    # A legacy no-scope request that embedded the whole cache is invalidated
    # and replaced rather than reused as a negative-cache hit.
    request_path = Path(result["results"][0]["host_work_request"])
    legacy = json.loads(request_path.read_text(encoding="utf-8"))
    legacy.pop("source_scope_status", None)
    legacy["cached_page_refs"] = [{"pdf_index": 1}]
    request_path.write_text(
        json.dumps(legacy, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    repeated = assets.enqueue_job(
        tmp_path,
        "qw-demo",
        kind="deepen_location",
        target_id="attic",
        reason="replace unsafe legacy no-scope handoff",
    )
    assert repeated["enqueued"] is True
    assert repeated["superseded_host_job_ids"] == []
    assert repeated["pending_supersede_host_job_ids"] == [legacy["job_id"]]
    replacement = worker.run_worker_once(tmp_path, parallel=1)
    replacement_request = json.loads(
        Path(replacement["results"][0]["host_work_request"]).read_text(
            encoding="utf-8"
        )
    )
    assert replacement_request["cached_page_refs"] == []
    assert json.loads(request_path.read_text(encoding="utf-8"))["status"] == (
        "superseded"
    )


def test_exact_scope_waits_for_cache_then_becomes_runnable(tmp_path: Path):
    _campaign(tmp_path)
    skeleton = assets.get_skeleton(tmp_path, "qw-demo")
    skeleton["locations"].append({
        "location_id": "chapel",
        "title": "Chapel",
        "parse_state": "named_only",
        "source_page_indices": [3],
    })
    assets.put_skeleton(tmp_path, "qw-demo", skeleton)
    assets.ensure_stub(
        tmp_path,
        "qw-demo",
        "location",
        "chapel",
        body_source_scope={"source_page_indices": [3]},
    )
    _clear_queue(tmp_path)
    assets.enqueue_job(
        tmp_path,
        "qw-demo",
        kind="deepen_location",
        target_id="chapel",
        reason="known scope whose accepted page is not cached yet",
        consumer_refs=_consumer(tmp_path),
    )
    produced = worker.run_worker_once(tmp_path, parallel=1)
    request_path = Path(produced["results"][0]["host_work_request"])
    request = json.loads(request_path.read_text(encoding="utf-8"))

    assert request["requested_pdf_indices"] == [3]
    assert request["cached_scope_complete"] is False
    assert request["dispatch_state"] == "awaiting_cache"
    lifecycle = assets.host_work_lifecycle_summary(tmp_path, "qw-demo")
    assert lifecycle["open_host_work_count"] == 1
    assert lifecycle["awaiting_cache_count"] == 1
    assert lifecycle["runnable_count"] == 0
    assert lifecycle["stranded_ready_count"] == 0
    assert lifecycle["by_work_level"]["near_term"]["awaiting_cache"] == 1
    with pytest.raises(assets.ModuleAssetsError, match="cached_only=false"):
        assets.claim_host_work_requests(
            tmp_path,
            "qw-demo",
            executor_id="cache-miss-test",
            cached_only=False,
        )

    _register_qw_source_pages(tmp_path, {3: "# Chapel\n\nAccepted late page.\n"})
    refreshed = assets.list_host_work_requests(tmp_path, "qw-demo")
    assert refreshed[0]["dispatch_state"] == "ready"
    assert refreshed[0]["operational_class"] == "runnable"
    claimed = assets.claim_host_work_requests(
        tmp_path,
        "qw-demo",
        executor_id="cache-ready-test",
    )
    assert claimed["leased_group_count"] == 1
    assert claimed["lifecycle"]["leased_count"] == 1
    assert claimed["lifecycle"]["stranded_ready_count"] == 0


def test_locator_request_persists_bounded_warm_dependency(tmp_path: Path):
    _campaign(tmp_path)
    identity = json.loads(
        (tmp_path / ".coc/module-assets/qw-demo/identity.json").read_text(
            encoding="utf-8"
        )
    )
    bundle_sha = identity["source_bundles"][0]["bundle_sha256"]
    scope = assets.validate_opening_source_window(
        tmp_path,
        "qw-demo",
        bundle_sha256=bundle_sha,
        pdf_indices=[1],
    )
    _clear_queue(tmp_path)
    assets.enqueue_job(
        tmp_path,
        "qw-demo",
        kind="locate_mechanics_index",
        target_id=assets.MECHANICS_LOCATOR_TARGET_ID,
        request_purpose=assets.MECHANICS_LOCATOR_PURPOSE,
        requested_source_scope=scope,
    )
    produced = worker.run_worker_once(tmp_path, parallel=1)
    request = json.loads(
        Path(produced["results"][0]["host_work_request"]).read_text(
            encoding="utf-8"
        )
    )

    assert request["work_level"] == "bounded_warm"
    assert "dependency_ref" not in request
    assert request["deadline_class"] == "idle_warm"


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
    assert first_request["result_contract"]["contract_id"] == (
        "coc.location-body-pack.v1"
    )
    assert first_request["result_contract"]["parse_state"] == "deep"
    assert first_request["result_contract"]["location_pack"]["fixed_fields"][
        "parse_state"
    ] == "deep"
    assert first_request["requested_pdf_indices"] == [1]

    _register_qw_source_pages(tmp_path, {2: "# Cellar context\n"})
    widened = assets.ensure_stub(
        tmp_path,
        "qw-demo",
        "location",
        "cellar",
        source_scope={"source_page_indices": [2]},
        body_source_scope={"source_page_indices": [1, 2]},
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
    assert repeated["pending_supersede_host_job_ids"] == [
        first_request["job_id"],
    ]

    second = worker.run_worker_once(tmp_path, parallel=1)
    second_request = json.loads(
        Path(second["results"][0]["host_work_request"]).read_text(encoding="utf-8")
    )
    assert second_request["requested_pdf_indices"] == [1, 2]
    assert second_request.get("status") is None
    assert second_request["superseded_host_job_ids"] == [first_request["job_id"]]
    superseded = json.loads(first_request_path.read_text(encoding="utf-8"))
    assert superseded["status"] == "superseded"
    assert superseded["superseded_by_job_id"] == repeated["job"]["job_id"]
    lifecycle = assets.host_work_lifecycle_summary(tmp_path, "qw-demo")
    assert lifecycle["open_host_work_count"] == 1
    assert lifecycle["stale_count"] == 1


def test_deep_job_supersedes_open_partial_neighbor_request(tmp_path: Path):
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
        kind="partial_neighbor",
        target_id="cellar",
        reason="neighbor prefetch",
    )
    first = worker.run_worker_once(tmp_path, parallel=1)
    first_request_path = Path(first["results"][0]["host_work_request"])
    first_request = json.loads(first_request_path.read_text(encoding="utf-8"))
    assert first_request["result_contract"]["contract_id"] == (
        "coc.location-body-pack.v1"
    )
    assert first_request["result_contract"]["parse_state"] == "partial"
    assert first_request["result_contract"]["location_pack"]["fixed_fields"][
        "parse_state"
    ] == "partial"

    deep = assets.enqueue_job(
        tmp_path,
        "qw-demo",
        kind="deepen_location",
        target_id="cellar",
        reason="player enters and investigates",
    )

    assert deep["enqueued"] is True
    assert deep["pending_supersede_host_job_ids"] == [first_request["job_id"]]
    replacement = worker.run_worker_once(tmp_path, parallel=1)
    replacement_request = json.loads(
        Path(replacement["results"][0]["host_work_request"]).read_text(
            encoding="utf-8"
        )
    )
    assert replacement_request["result_contract"]["contract_id"] == (
        "coc.location-body-pack.v1"
    )
    assert replacement_request["result_contract"]["parse_state"] == "deep"
    assert replacement_request["superseded_host_job_ids"] == [
        first_request["job_id"],
    ]
    assert json.loads(first_request_path.read_text(encoding="utf-8"))["status"] == (
        "superseded"
    )


def test_complete_deep_pack_reconciles_covered_stale_partial_request(
    tmp_path: Path,
):
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
        kind="partial_neighbor",
        target_id="cellar",
        reason="neighbor prefetch",
    )
    first = worker.run_worker_once(tmp_path, parallel=1)
    request_path = Path(first["results"][0]["host_work_request"])
    request = json.loads(request_path.read_text(encoding="utf-8"))
    deep_request = dict(request)
    deep_request["job_id"] = "job-deep-replacement"
    deep_request["kind"] = "deepen_location"
    deep_request_path = request_path.with_name("job-deep-replacement.json")
    deep_request_path.write_text(
        json.dumps(deep_request, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    put = assets.put_entity(
        tmp_path,
        "qw-demo",
        "location",
        "cellar",
        {
            "parse_state": "deep",
            "evidence_gap": False,
            "title": "Cellar",
            "source_page_indices": [1],
            "host_work_job_id": "job-deep-replacement",
        },
    )

    assert put["superseded_host_job_ids"] == [request["job_id"]]
    closed = json.loads(request_path.read_text(encoding="utf-8"))
    assert closed["status"] == "superseded"
    assert closed["superseded_by_entity"] == {
        "kind": "location",
        "entity_id": "cellar",
    }
    assert json.loads(deep_request_path.read_text(encoding="utf-8"))["status"] == "fulfilled"


def test_dynamic_mention_stub_keeps_identity_scope_out_of_body_work(
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
    assert request["requested_pdf_indices"] == []
    assert request["dispatch_state"] == "awaiting_scope"
    assert request["cached_scope_complete"] is None
    assert request["cached_page_refs"] == []





def test_ordinary_enter_cannot_prepoison_later_exact_body_dependency(
    tmp_path: Path,
):
    campaign_id = _campaign(tmp_path)
    skeleton = assets.get_skeleton(tmp_path, "qw-demo")
    assert skeleton is not None
    skeleton["locations"].append({
        "location_id": "drixte-village",
        "title": "Drixte Village",
        "parse_state": "named_only",
        "source_page_indices": [1],
    })
    assets.put_skeleton(tmp_path, "qw-demo", skeleton)
    _clear_queue(tmp_path)

    entered = project.on_enter_scene(
        tmp_path, campaign_id, "drixte-village",
    )
    assert any("enqueue" in action for action in entered["actions"])
    ordinary = worker.run_worker_once(tmp_path, parallel=1)
    ordinary_request = json.loads(
        Path(ordinary["results"][0]["host_work_request"]).read_text(
            encoding="utf-8"
        )
    )
    assert ordinary_request["work_level"] == "near_term"
    assert ordinary_request["dispatch_state"] == "awaiting_scope"
    assert ordinary_request["requested_pdf_indices"] == []
    assert assets.claim_host_work_requests(
        tmp_path,
        "qw-demo",
        executor_id="ordinary-body-must-not-dispatch",
    )["packets"] == []

    dependency_ref = {
        "operation": "scene.context",
        "subject": {"kind": "location", "id": "drixte-village"},
        "decision_id": "settle-drixte-arrival",
    }
    exact = project.follow_structured_mentions(
        tmp_path,
        campaign_id,
        [{"kind": "location", "ref_id": "drixte-village"}],
        reason="player arrives and observes",
        work_level="current_dependency",
        dependency_ref=dependency_ref,
    )
    assert exact["followed"][0]["ref_id"] == "drixte-village"
    if assets.list_queue(tmp_path, "qw-demo")["pending"]:
        worker.run_worker_once(tmp_path, parallel=1)
    requests = [
        row for row in assets.list_host_work_requests(
            tmp_path, "qw-demo", include_closed=True, limit=None,
        )
        if row["target_id"] == "drixte-village"
        and row.get("status") not in assets.HOST_WORK_CLOSED_STATUSES
    ]
    assert requests
    assert all(row["requested_pdf_indices"] == [] for row in requests)
    current = [
        row for row in requests
        if row["work_level"] == "current_dependency"
    ]
    assert len(current) == 1
    assert current[0]["dependency_ref"] == dependency_ref
    assert current[0]["operational_class"] == "awaiting_scope"








def test_host_work_preserves_identity_union_without_blessing_body_scope(
    tmp_path: Path,
):
    _campaign(tmp_path)
    _register_qw_source_pages(tmp_path, {
        2: "# NPC context 2\n",
        3: "# NPC context 3\n",
    })
    skeleton = assets.get_skeleton(tmp_path, "qw-demo")
    assert skeleton is not None
    skeleton["npc_roster"] = [{
        "npc_id": "npc-priest",
        "name": "Priest",
        "parse_state": "named_only",
        "source_span": {"pdf_index_start": 1, "pdf_index_end": 1},
    }]
    assets.put_skeleton(tmp_path, "qw-demo", skeleton)
    stub = assets.ensure_stub(
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
    assert stub["entity"]["source_page_indices"] == [1, 2, 3]
    assert request["requested_source_scope"] == {}
    assert request["requested_pdf_indices"] == []
    assert request["dispatch_state"] == "awaiting_scope"
    assert request["cached_scope_complete"] is None
    assert request["cached_page_refs"] == []


def test_worker_merges_standalone_npc_and_threat_into_live_ir(tmp_path: Path):
    cid = _campaign(tmp_path)
    assets.put_entity(tmp_path, "qw-demo", "npc", "npc-witness", {
        "parse_state": "deep",
        "evidence_gap": False,
        "source_page_indices": [0],
        "name": "Witness",
        "agenda": "Tell only what the source supports.",
        "voice": "Measured.",
        "scene_ids": ["opening"],
    })
    assets.put_entity(tmp_path, "qw-demo", "threat", "threat-storm", {
        "parse_state": "deep",
        "evidence_gap": False,
        "source_page_indices": [0],
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


def _actor_mechanics(source_ref: dict) -> dict:
    mechanics = _load("coc_mechanics_qw", str(SCRIPTS / "coc_mechanics.py"))
    extracted = {
        "characteristics.STR",
        "characteristics.CON",
        "characteristics.SIZ",
        "characteristics.DEX",
        "characteristics.POW",
        "derived.HP",
        "derived.MP",
        "derived.SAN",
        "derived.MOV",
        "derived.Build",
        "skills",
        "weapons",
    }
    observed = sorted(extracted)
    not_authored = sorted(mechanics.ACTOR_FIELD_IDS - extracted)
    return {
        "status": "authored",
        "source_refs": [json.loads(json.dumps(source_ref))],
        "fields_observed": observed,
        "fields_extracted": observed,
        "fields_not_authored": not_authored,
        "provenance": {"authority": "source_authored"},
        "profile": {
            "profile_kind": "actor",
            "characteristic_scale": "percentile",
            "characteristics": {
                "STR": 55, "CON": 50, "SIZ": 60, "DEX": 45, "POW": 50,
            },
            "derived": {"HP": 11, "MP": 10, "SAN": 50, "MOV": 8, "Build": 0},
            "skills": {"Fighting (Brawl)": 45, "Dodge": 22},
            "weapons": [{"weapon_id": "unarmed", "extends": "unarmed"}],
        },
    }


def test_host_work_claim_coalesces_page_group_and_recovers_expired_lease(
    tmp_path: Path,
):
    cid = _campaign(tmp_path)
    skeleton = assets.get_skeleton(tmp_path, "qw-demo")
    skeleton["locations"].append({
        "location_id": "annex",
        "title": "Annex",
        "parse_state": "named_only",
        "source_page_indices": [1],
    })
    assets.put_skeleton(tmp_path, "qw-demo", skeleton)
    assets.ensure_stub(
        tmp_path,
        "qw-demo",
        "location",
        "annex",
        body_source_scope={"source_page_indices": [1]},
    )
    _clear_queue(tmp_path)
    for target_id in ("cellar", "annex"):
        assets.enqueue_job(
            tmp_path,
            "qw-demo",
            kind="deepen_location",
            target_id=target_id,
            priority=80,
            reason="bounded background test",
            consumer_refs=_consumer(tmp_path),
        )
    produced = worker.run_worker_once(tmp_path, parallel=2)
    assert produced["claimed"] == 2

    ctx = toolbox.Ctx(tmp_path, cid)
    claimed, _warnings, _hints = toolbox.TOOLS[
        "progressive.claim_host_work"
    ]["handler"](
        ctx, {"executor_id": "host-a", "limit": 1, "lease_seconds": 600},
    )
    assert claimed["leased_group_count"] == 1
    packet = claimed["dispatch_tasks"][0]["packet"]
    assert {row["target_id"] for row in packet["requests"]} == {
        "cellar", "annex",
    }
    assert packet["requested_pdf_indices"] == [1]

    unavailable, _warnings, _hints = toolbox.TOOLS[
        "progressive.claim_host_work"
    ]["handler"](
        ctx, {"executor_id": "host-b", "limit": 4},
    )
    assert unavailable["dispatch_tasks"] == []

    work_dir = tmp_path / ".coc/module-assets/qw-demo/host-work"
    for path in work_dir.glob("*.json"):
        request = json.loads(path.read_text(encoding="utf-8"))
        request["lease_expires_at"] = "2000-01-01T00:00:00+00:00"
        path.write_text(
            json.dumps(request, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    recovered, _warnings, _hints = toolbox.TOOLS[
        "progressive.claim_host_work"
    ]["handler"](
        ctx, {"executor_id": "host-b", "limit": 1},
    )
    assert recovered["leased_group_count"] == 1
    assert recovered["dispatch_tasks"][0]["packet"]["packet_id"] != (
        packet["packet_id"]
    )
    refreshed = assets.list_host_work_requests(tmp_path, "qw-demo")
    assert {row["dispatch_attempts"] for row in refreshed} == {2}
    assert {row["executor_id"] for row in refreshed} == {"host-b"}


def test_fix7_heterogeneous_body_contracts_claim_one_bounded_family(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    """The FIX7 partial-neighbor/deepen topology must not overflow first claim."""
    monkeypatch.setenv("COC_HOST", "pi")
    cid = _campaign(tmp_path)
    skeleton = assets.get_skeleton(tmp_path, "qw-demo")
    skeleton["locations"].append({
        "location_id": "annex",
        "title": "Annex",
        "parse_state": "named_only",
        "source_span": {"pdf_index_start": 1, "pdf_index_end": 1},
    })
    assets.put_skeleton(tmp_path, "qw-demo", skeleton)
    assets.ensure_stub(
        tmp_path,
        "qw-demo",
        "location",
        "annex",
        body_source_scope={"source_page_indices": [1]},
    )
    _clear_queue(tmp_path)
    assets.enqueue_job(
        tmp_path,
        "qw-demo",
        kind="partial_neighbor",
        target_id="cellar",
        priority=80,
        reason="FIX7 neighbor prefetch",
        consumer_refs=_consumer(tmp_path, intent_kind="neighbor_prefetch"),
    )
    assets.enqueue_job(
        tmp_path,
        "qw-demo",
        kind="deepen_location",
        target_id="annex",
        priority=80,
        reason="FIX7 active location deepening",
        consumer_refs=_consumer(tmp_path, intent_kind="scene_enter"),
    )
    produced = worker.run_worker_once(tmp_path, parallel=2)
    assert produced["claimed"] == 2
    ready = assets.list_host_work_requests(tmp_path, "qw-demo")
    assert {row["kind"] for row in ready} == {
        "partial_neighbor", "deepen_location",
    }
    assert len({row["work_group_id"] for row in ready}) == 1
    assert len({
        assets._compact_canonical_sha256(
            assets.get_host_work_request(
                tmp_path, "qw-demo", row["job_id"],
            )["result_contract"]
        )
        for row in ready
    }) == 2

    claimed, _warnings, _hints = toolbox.TOOLS[
        "progressive.claim_host_work"
    ]["handler"](
        toolbox.Ctx(tmp_path, cid),
        {
            "executor_id": "pi:fix7-topology",
            "limit": 2,
            "lease_seconds": 600,
            "result_delivery": "task_return_to_parent",
        },
    )
    assert claimed["ready_group_count"] == 1
    assert claimed["leased_group_count"] == 1
    assert claimed["dispatch_task_count"] == 1
    [task] = claimed["dispatch_tasks"]
    assert len(task["packet"]["requests"]) == 1
    claimed_kind = task["packet"]["requests"][0]["kind"]
    assert claimed_kind in {"partial_neighbor", "deepen_location"}

    envelope = {
        "ok": True,
        "tool": "progressive.claim_host_work",
        "data": claimed,
        "warnings": [],
        "hints": [],
    }
    projected = wire.project_envelope(
        "progressive.claim_host_work",
        envelope,
        contract_digest="sha256:" + "f" * 64,
    )
    assert wire.transport_bytes(projected) <= wire.MAX_INLINE_BYTES
    assert projected["wire"].get(
        "claim_dispatch_projection_failed",
    ) is not True
    assert projected["data"].get("wire_projection_failed") is not True
    assert len(projected["data"]["dispatch_tasks"]) == 1
    assert projected["data"]["dispatch_tasks"][0]["packet"]["packet_id"] == (
        task["packet"]["packet_id"]
    )
    unclaimed = [
        row for row in assets.list_host_work_requests(tmp_path, "qw-demo")
        if row["kind"] != claimed_kind
    ]
    assert len(unclaimed) == 1
    assert assets.host_work_operational_class(unclaimed[0]) == "runnable"


def test_claim_selects_one_urgent_family_per_original_group_before_limit(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    """Different contract families in unrelated groups must not starve."""
    monkeypatch.setenv("COC_HOST", "pi")
    cid = _campaign(tmp_path)
    skeleton = assets.get_skeleton(tmp_path, "qw-demo")
    skeleton["locations"].extend([
        {
            "location_id": "annex",
            "title": "Annex",
            "parse_state": "named_only",
            "source_span": {"pdf_index_start": 1, "pdf_index_end": 1},
        },
        {
            "location_id": "porch",
            "title": "Porch",
            "parse_state": "named_only",
            "source_span": {"pdf_index_start": 0, "pdf_index_end": 0},
        },
        {
            "location_id": "loft",
            "title": "Loft",
            "parse_state": "named_only",
            "source_span": {"pdf_index_start": 0, "pdf_index_end": 0},
        },
    ])
    assets.put_skeleton(tmp_path, "qw-demo", skeleton)
    for target_id, pdf_index in (("annex", 1), ("porch", 0), ("loft", 0)):
        assets.ensure_stub(
            tmp_path,
            "qw-demo",
            "location",
            target_id,
            body_source_scope={"source_page_indices": [pdf_index]},
        )
    _clear_queue(tmp_path)
    requests = (
        ("partial_neighbor", "cellar", "neighbor_prefetch"),
        ("deepen_location", "annex", "scene_enter"),
        ("deepen_location", "porch", "scene_enter"),
        ("partial_neighbor", "loft", "neighbor_prefetch"),
    )
    for kind, target_id, intent_kind in requests:
        assets.enqueue_job(
            tmp_path,
            "qw-demo",
            kind=kind,
            target_id=target_id,
            priority=80,
            reason=f"two-group urgency:{target_id}",
            consumer_refs=_consumer(tmp_path, intent_kind=intent_kind),
        )
    produced = worker.run_worker_once(tmp_path, parallel=4)
    assert produced["claimed"] == 4
    ready = assets.list_host_work_requests(tmp_path, "qw-demo")
    assert len(ready) == 4
    assert len({row["work_group_id"] for row in ready}) == 2

    # Each original page group contains both contract families. Deadline class
    # deterministically selects cellar from page 1 and porch from page 0.
    selected_targets = {"cellar", "porch"}
    work_dir = tmp_path / ".coc/module-assets/qw-demo/host-work"
    for row in ready:
        path = work_dir / f"{row['job_id']}.json"
        stored = json.loads(path.read_text(encoding="utf-8"))
        stored["deadline_class"] = (
            "blocking_micro"
            if stored["target_id"] in selected_targets
            else "idle_warm"
        )
        path.write_text(
            json.dumps(stored, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    claimed, _warnings, _hints = toolbox.TOOLS[
        "progressive.claim_host_work"
    ]["handler"](
        toolbox.Ctx(tmp_path, cid),
        {
            "executor_id": "pi:two-group-families",
            "limit": 2,
            "lease_seconds": 600,
            "result_delivery": "task_return_to_parent",
        },
    )
    assert claimed["ready_group_count"] == 2
    assert claimed["leased_group_count"] == 2
    assert claimed["dispatch_task_count"] == 2
    tasks = claimed["dispatch_tasks"]
    assert {
        task["packet"]["requests"][0]["target_id"]
        for task in tasks
    } == selected_targets
    assert all(len(task["packet"]["requests"]) == 1 for task in tasks)
    assert len({
        task["packet"]["work_group_id"] for task in tasks
    }) == 2

    siblings = [
        row for row in assets.list_host_work_requests(tmp_path, "qw-demo")
        if row["target_id"] not in selected_targets
    ]
    assert {row["target_id"] for row in siblings} == {"annex", "loft"}
    assert all(
        assets.host_work_operational_class(row) == "runnable"
        for row in siblings
    )


def test_claim_orders_current_dependency_before_higher_priority_near_term(
    tmp_path: Path,
):
    _campaign(tmp_path)
    _clear_queue(tmp_path)
    _identity, scope = _accepted_scope(tmp_path, 0)
    signature = assets.opening_source_scope_signature(scope)
    assets.enqueue_job(
        tmp_path,
        "qw-demo",
        kind="deepen_location",
        target_id="cellar",
        priority=999,
        reason="high priority near-term",
        consumer_refs=_consumer(tmp_path),
    )
    assets.enqueue_job(
        tmp_path,
        "qw-demo",
        kind="partial_opening",
        target_id="opening",
        priority=1,
        reason="exact opening dependency",
        request_purpose=assets.FOREGROUND_OPENING_PURPOSE,
        requested_source_scope=scope,
        work_level="current_dependency",
        dependency_ref={
            "operation": "progressive.project_opening",
            "subject": {"kind": "location", "id": "opening"},
            "source_scope_signature": signature,
        },
        consumer_refs=_consumer(tmp_path, intent_kind="opening"),
    )
    assert worker.run_worker_once(tmp_path, parallel=2)["claimed"] == 2

    claimed = assets.claim_host_work_requests(
        tmp_path,
        "qw-demo",
        executor_id="tier-order",
        limit=1,
    )
    assert claimed["packets"][0]["work_level"] == "current_dependency"
    assert claimed["packets"][0]["requests"][0]["dependency_ref"] == {
        "operation": "progressive.project_opening",
        "subject": {"kind": "location", "id": "opening"},
        "source_scope_signature": signature,
    }


def test_legacy_host_work_is_quarantined_without_l1_inference_or_evidence_loss(
    tmp_path: Path,
):
    _campaign(tmp_path)
    _clear_queue(tmp_path)
    queued, request_path = _produce_host_request(
        tmp_path,
        kind="deepen_location",
        target_id="cellar",
        reason="legacy clean-slate fixture",
    )
    legacy = json.loads(request_path.read_text(encoding="utf-8"))
    legacy["schema_version"] = 1
    legacy["work_level"] = "current_dependency"
    legacy.pop("dependency_ref", None)
    raw = json.dumps(legacy).encode()
    request_path.write_bytes(raw)

    assert assets.list_host_work_requests(tmp_path, "qw-demo") == []
    assert request_path.exists()
    disposition = json.loads(request_path.read_text(encoding="utf-8"))
    assert disposition["status"] == "quarantined"
    assert disposition["rejected_evidence_sha256"] == hashlib.sha256(raw).hexdigest()
    evidence = json.loads(
        Path(disposition["rejected_evidence_path"]).read_text(encoding="utf-8")
    )
    assert base64.b64decode(evidence["raw_base64"]) == raw
    queue = assets.list_queue(tmp_path, "qw-demo")
    assert all(
        row["job_id"] != queued["job"]["job_id"]
        for row in queue["pending"]
    )


def test_malformed_host_work_is_quarantined_append_only(tmp_path: Path):
    _campaign(tmp_path)
    work_dir = assets._module_dir(tmp_path, "qw-demo") / "host-work"
    work_dir.mkdir(exist_ok=True)
    path = work_dir / "job-malformed.json"
    raw = b'{"schema_version":2,"job_id":"job-malformed"'
    path.write_bytes(raw)

    claimed = assets.claim_host_work_requests(
        tmp_path, "qw-demo", executor_id="quarantine-test",
    )

    assert claimed["packets"] == []
    disposition = json.loads(path.read_text(encoding="utf-8"))
    assert disposition["status"] == "quarantined"
    assert disposition["rejected_evidence_sha256"] == hashlib.sha256(raw).hexdigest()
    evidence = json.loads(
        Path(disposition["rejected_evidence_path"]).read_text(encoding="utf-8")
    )
    assert base64.b64decode(evidence["raw_base64"]) == raw


def test_superseded_entity_request_cannot_write_pack_after_lock_wait(
    tmp_path: Path,
):
    _campaign(tmp_path)
    _clear_queue(tmp_path)
    queued, request_path = _produce_host_request(
        tmp_path,
        kind="partial_neighbor",
        target_id="cellar",
        reason="stale interleaving",
    )
    job_id = queued["job"]["job_id"]
    started = threading.Event()
    finished = threading.Event()
    errors: list[BaseException] = []

    def fulfill() -> None:
        started.set()
        try:
            assets.put_entity(tmp_path, "qw-demo", "location", "cellar", {
                "location_id": "cellar",
                "parse_state": "partial",
                "evidence_gap": False,
                "source_page_indices": [1],
                "player_safe_summary": "A bounded cellar description.",
                "host_work_job_id": job_id,
            })
        except BaseException as exc:  # noqa: BLE001 - captured across thread
            errors.append(exc)
        finally:
            finished.set()

    lock_path = tmp_path / ".coc/module-assets/qw-demo/host-work.lock"
    with assets.coc_fileio.advisory_file_lock(lock_path):
        thread = threading.Thread(target=fulfill)
        thread.start()
        assert started.wait(1)
        assert not finished.wait(0.05)
        request = json.loads(request_path.read_text(encoding="utf-8"))
        request.update({
            "status": "superseded",
            "dispatch_state": "superseded",
            "superseded_by_job_id": "job-replacement",
        })
        assets._write_json(request_path, request)
    thread.join(timeout=2)

    assert not thread.is_alive()
    assert len(errors) == 1
    assert "superseded" in str(errors[0])
    unchanged = assets.get_entity(
        tmp_path, "qw-demo", "location", "cellar",
    )
    assert unchanged is not None
    assert unchanged["parse_state"] == "named_only"


def test_claim_then_fulfillment_cannot_resurrect_leased_state(
    tmp_path: Path,
    monkeypatch,
):
    _campaign(tmp_path)
    _clear_queue(tmp_path)
    queued, request_path = _produce_host_request(
        tmp_path,
        kind="partial_neighbor",
        target_id="cellar",
        reason="claim fulfillment interleaving",
    )
    job_id = queued["job"]["job_id"]
    claim_paused = threading.Event()
    release_claim = threading.Event()
    fulfillment_done = threading.Event()
    failures: list[BaseException] = []
    real_write = assets._write_json

    def pausing_write(path: Path, payload: dict) -> None:
        if (
            Path(path) == request_path
            and payload.get("dispatch_state") == "leased"
        ):
            claim_paused.set()
            assert release_claim.wait(2)
        real_write(path, payload)

    monkeypatch.setattr(assets, "_write_json", pausing_write)

    def claim() -> None:
        try:
            assets.claim_host_work_requests(
                tmp_path, "qw-demo", executor_id="race-claim",
            )
        except BaseException as exc:  # noqa: BLE001
            failures.append(exc)

    def fulfill() -> None:
        try:
            assets.put_entity(tmp_path, "qw-demo", "location", "cellar", {
                "location_id": "cellar",
                "parse_state": "partial",
                "evidence_gap": False,
                "source_page_indices": [1],
                "player_safe_summary": "A claimed then fulfilled cellar.",
                "host_work_job_id": job_id,
            })
        except BaseException as exc:  # noqa: BLE001
            failures.append(exc)
        finally:
            fulfillment_done.set()

    claim_thread = threading.Thread(target=claim)
    claim_thread.start()
    assert claim_paused.wait(1)
    fulfill_thread = threading.Thread(target=fulfill)
    fulfill_thread.start()
    assert not fulfillment_done.wait(0.05)
    release_claim.set()
    claim_thread.join(timeout=2)
    fulfill_thread.join(timeout=2)

    assert failures == []
    assert not claim_thread.is_alive()
    assert not fulfill_thread.is_alive()
    request = json.loads(request_path.read_text(encoding="utf-8"))
    assert request["status"] == "fulfilled"
    assert request["dispatch_state"] == "fulfilled"
    assert request["dispatch_attempts"] == 1


def test_mechanics_request_batches_same_page_and_reuses_durable_profiles(
    tmp_path: Path,
):
    cid = _campaign(tmp_path)
    skeleton = assets.get_skeleton(tmp_path, "qw-demo")
    skeleton["npc_roster"] = [
        {
            "npc_id": "lucas-strong",
            "names": ["Lucas Strong"],
            "parse_state": "named_only",
            "source_page_indices": [1],
        },
        {
            "npc_id": "joseph-turner",
            "names": ["Joseph Turner"],
            "parse_state": "named_only",
        },
        {
            "npc_id": "jane-strong",
            "names": ["Jane Strong"],
            "parse_state": "named_only",
        },
    ]
    skeleton["item_roster"] = [
        {"item_id": "ritual-knife", "label": "仪式刀", "parse_state": "named_only"},
    ]
    skeleton["mechanics_locator_pass_status"] = "complete"
    source_file_sha = skeleton["source"]["file_sha256"]
    skeleton["mechanics_locator_scope"] = {
        "scope_kind": "explicit_pdf_indices",
        "pdf_indices": [2],
        "source_file_sha256": source_file_sha,
    }
    skeleton["mechanics_index"] = [
        {
            "subject_kind": kind,
            "subject_id": subject_id,
            "status": "located",
            "locator_pass_status": "complete",
            "locator_scope": {
                "scope_kind": "explicit_pdf_indices",
                "pdf_indices": [2],
                "source_file_sha256": source_file_sha,
            },
            "source_page_indices": [2],
        }
        for kind, subject_id in (
            ("npc", "lucas-strong"),
            ("npc", "joseph-turner"),
            ("npc", "jane-strong"),
            ("item", "ritual-knife"),
        )
    ]
    _register_qw_source_pages(tmp_path, {
        2: "# Appendix\n\nTwo NPC blocks and one ritual knife block.\n",
    })
    assets.put_skeleton(tmp_path, "qw-demo", skeleton)
    project.project_skeleton_to_campaign(tmp_path, cid, "qw-demo")
    _clear_queue(tmp_path)

    first = project.request_mechanics(
        tmp_path, cid, kind="npc", target_id="lucas-strong", reason="attacked",
    )
    repeated = project.request_mechanics(
        tmp_path, cid, kind="npc", target_id="lucas-strong", reason="attacked-again",
    )
    assert first["enqueue"]["enqueued"] is True
    assert repeated["enqueue"]["enqueued"] is False

    worker_result = worker.run_worker_once(tmp_path, parallel=1)
    request_path = Path(worker_result["results"][0]["host_work_request"])
    request = json.loads(request_path.read_text(encoding="utf-8"))
    # Lucas's narrative/profile page is 1; mechanics must stay on the
    # appendix locator instead of inheriting that body scope.
    assert request["requested_pdf_indices"] == [2]
    assert request["source_aspect"] == "mechanics"
    assert request["deadline_class"] == "next_turn_hot"
    assert request["work_level"] == "near_term"
    assert "dependency_ref" not in request
    assert "equal to this packet's file_sha256" in request["instruction"]
    assert "registered accepted cached_page_refs" in request["instruction"]
    assert {
        (row["subject_kind"], row["subject_id"])
        for row in request["batch_subjects"]
    } == {
        ("npc", "lucas-strong"),
        ("npc", "joseph-turner"),
        ("npc", "jane-strong"),
        ("item", "ritual-knife"),
    }

    scene_context, _warnings, context_hints = toolbox.TOOLS[
        "scene.context"
    ]["handler"](toolbox.Ctx(tmp_path, cid), {})
    progressive = scene_context["progressive"]
    assert progressive["ready_for_background_count"] == 1
    assert progressive["blocking_micro_ready_count"] == 0
    assert progressive["ready_background_requests"] == [{
        "job_id": request["job_id"],
        "kind": "resolve_npc_mechanics",
        "target_id": "lucas-strong",
        "priority": request["priority"],
        "requested_pdf_indices": [2],
        "source_aspect": "mechanics",
        "deadline_class": "next_turn_hot",
        "work_level": "near_term",
        "work_group_id": request["work_group_id"],
        "dispatch_state": "ready",
        "dispatch_attempts": 0,
        "cached_scope_complete": True,
    }]
    takeover = progressive["background_takeover"]
    assert takeover["authority"] == "advisory"
    assert takeover["hard_gate"] is False
    assert "claim_operation" not in takeover
    assert takeover["direct_single_leaf_dispatch"]["codex_parent_claims"] is False
    assert takeover["host_dispatch"] == {
        "worker_profile": "coc-source-pack-worker",
        "background": True,
            "packet_binding": (
                "one exact returned dispatch_tasks[] value per child when "
                "result_delivery=named_submit"
            ),
        "direct_submit_parent_waits": False,
        "direct_submit_parent_result_polls": 0,
        "direct_submit_parent_output_retrieval": False,
        "direct_submit_parent_calls_fulfill_host_work": False,
        "fallback_without_direct_submit": (
            "forward exact completed results[i] once through "
            "progressive.fulfill_host_work"
        ),
    }
    assert takeover["play_boundary"] == {
        "player_action_gate": False,
        "narrative_gate": False,
        "output_gate": False,
        "nondependent_play_may_continue": True,
        "blocking_micro_applies_only_to_current_dependent_settlement": True,
    }
    assert any("never gates player input" in hint for hint in context_hints)

    exact_ref = {
        key: request["cached_page_refs"][0][key]
        for key in ("source_id", "pdf_index", "text_sha256")
    }
    contract = request["result_contract"]
    assert contract["contract_id"] == "coc.mechanics-entity-pack.v1"
    assert contract["closed"] is True
    assert contract["result_item"]["fixed_fields"] == {
        "job_id": request["job_id"],
    }
    assert contract["primary_subject"] == {
        "subject_kind": "npc", "subject_id": "lucas-strong",
    }
    assert contract["pack"]["allowed_fields"] == ["mechanics"]
    assert contract["pack"]["required_fields"] == ["mechanics"]
    assert "parse_state" in contract["pack"]["forbidden_fields"]
    assert contract["pack"]["mechanics"]["authored"]["source_refs"][
        "allowed_exact_refs"
    ] == [exact_ref]
    allowed_extends = contract["pack"]["mechanics"]["authored"][
        "canonical_profile_self_check"
    ]["allowed_canonical_extends_ids"]
    assert allowed_extends == list(worker.coc_mechanics.canonical_weapon_ids())
    assert allowed_extends == sorted(set(allowed_extends))
    assert {"unarmed", "knife_medium", "30_06_bolt_action_rifle", "shotgun_12g"} <= set(
        allowed_extends
    )
    assert {"brawl", "knife", "rifle", "shotgun"}.isdisjoint(allowed_extends)
    assert {
        (row["subject_kind"], row["subject_id"])
        for row in contract["related_packs"]["eligible_subjects"]
    } == {
        ("npc", "joseph-turner"),
        ("npc", "jane-strong"),
        ("item", "ritual-knife"),
    }

    lucas = {"mechanics": _actor_mechanics(exact_ref)}
    joseph = json.loads(json.dumps(lucas))
    jane = json.loads(json.dumps(lucas))
    knife = {
        "mechanics": {
            "status": "authored",
            "source_refs": [exact_ref],
            "fields_observed": ["weapon_id", "extends", "name"],
            "fields_extracted": ["weapon_id", "extends", "name"],
            "fields_not_authored": [],
            "provenance": {"authority": "source_authored"},
            "profile": {
                "profile_kind": "weapon",
                "weapon_id": "module:ritual-knife",
                "extends": "knife_medium",
                "name": "仪式刀",
            },
        },
    }
    module_root = tmp_path / ".coc" / "module-assets" / "qw-demo"

    def durable_snapshot() -> dict[str, bytes]:
        return {
            str(path.relative_to(module_root)): path.read_bytes()
            for path in module_root.rglob("*.json")
        }

    baseline = durable_snapshot()
    # R24 shape: semantically plausible mechanics were returned at pack root.
    # It must fail as a child-pack error without mutating the entity/request.
    malformed_primary = _actor_mechanics(exact_ref)
    rejected_primary = toolbox.run_tool(
        "progressive.fulfill_host_work",
        tmp_path,
        cid,
        {
            "job_id": request["job_id"],
            "pack": malformed_primary,
            "related_packs": [],
        },
    )
    assert rejected_primary["ok"] is False
    assert rejected_primary["error"]["code"] == "invalid_source_worker_pack"
    assert "must not repair or rewrite" in rejected_primary["hints"][0]
    assert durable_snapshot() == baseline

    # A malformed same-page child is also rejected before the valid primary is
    # written; the parent never normalizes the bare mechanics object.
    rejected_related = toolbox.run_tool(
        "progressive.fulfill_host_work",
        tmp_path,
        cid,
        {
            "job_id": request["job_id"],
            "pack": lucas,
            "related_packs": [{
                "subject_kind": "npc",
                "subject_id": "joseph-turner",
                "pack": _actor_mechanics(exact_ref),
            }],
        },
    )
    assert rejected_related["ok"] is False
    assert rejected_related["error"]["code"] == "invalid_source_worker_pack"
    assert durable_snapshot() == baseline

    r24_weapon_shape = json.loads(json.dumps(joseph))
    r24_weapon_shape["mechanics"]["profile"]["weapons"] = [{
        "name": "Knife", "damage": "1D4+DB",
    }]
    rejected_weapon = toolbox.run_tool(
        "progressive.fulfill_host_work",
        tmp_path,
        cid,
        {
            "job_id": request["job_id"],
            "pack": lucas,
            "related_packs": [{
                "subject_kind": "npc",
                "subject_id": "joseph-turner",
                "pack": r24_weapon_shape,
            }],
        },
    )
    assert rejected_weapon["ok"] is False
    assert rejected_weapon["error"]["code"] == "invalid_source_worker_pack"
    assert "weapon profile requires weapon_id" in rejected_weapon["error"]["message"]
    assert durable_snapshot() == baseline

    r25_unknown_primary = json.loads(json.dumps(lucas))
    r25_unknown_primary["mechanics"]["profile"]["weapons"] = [{
        "weapon_id": "module:lucas-brawl",
        "extends": "brawl",
    }]
    rejected_unknown_primary = toolbox.run_tool(
        "progressive.fulfill_host_work",
        tmp_path,
        cid,
        {
            "job_id": request["job_id"],
            "pack": r25_unknown_primary,
            "related_packs": [],
        },
    )
    assert rejected_unknown_primary["ok"] is False
    assert rejected_unknown_primary["error"]["code"] == (
        "invalid_source_worker_pack"
    )
    assert "not an active canonical weapon id" in (
        rejected_unknown_primary["error"]["message"]
    )
    assert durable_snapshot() == baseline

    r25_unknown_extends = json.loads(json.dumps(joseph))
    r25_unknown_extends["mechanics"]["profile"]["weapons"] = [{
        "weapon_id": "module:lucas-knife",
        "extends": "knife",
    }]
    rejected_unknown_extends = toolbox.run_tool(
        "progressive.fulfill_host_work",
        tmp_path,
        cid,
        {
            "job_id": request["job_id"],
            "pack": lucas,
            "related_packs": [{
                "subject_kind": "npc",
                "subject_id": "joseph-turner",
                "pack": r25_unknown_extends,
            }],
        },
    )
    assert rejected_unknown_extends["ok"] is False
    assert rejected_unknown_extends["error"]["code"] == "invalid_source_worker_pack"
    assert "not an active canonical weapon id" in rejected_unknown_extends["error"]["message"]
    assert durable_snapshot() == baseline

    claimed, _warnings, _hints = toolbox.TOOLS[
        "progressive.claim_host_work"
    ]["handler"](
        toolbox.Ctx(tmp_path, cid),
        {"executor_id": "host-mechanics", "limit": 1, "lease_seconds": 600},
    )
    assert claimed["leased_group_count"] == 1
    request = json.loads(request_path.read_text(encoding="utf-8"))
    assert request["leased_at"]

    fulfillment_args = {
        "job_id": request["job_id"],
        "pack": lucas,
        "related_packs": [
            {
                "subject_kind": "npc",
                "subject_id": "joseph-turner",
                "pack": joseph,
            },
            {
                "subject_kind": "npc",
                "subject_id": "jane-strong",
                "pack": jane,
            },
            {
                "subject_kind": "item",
                "subject_id": "ritual-knife",
                "pack": knife,
            },
        ],
        "host_task_timing": {
            "started_at": request["leased_at"],
            "completed_at": request["leased_at"],
            "duration_ms": 0,
            "task_id": "source-worker-mechanics-exact",
        },
    }
    child_result_before = json.loads(json.dumps(fulfillment_args))
    fulfilled = toolbox.run_tool(
        "progressive.fulfill_host_work", tmp_path, cid, fulfillment_args,
    )
    assert fulfilled["ok"] is True, fulfilled
    assert fulfilled["data"]["request_status"] == "fulfilled"
    assert len(fulfilled["data"]["related_puts"]) == 3
    assert fulfillment_args == child_result_before
    for npc_id in ("lucas-strong", "joseph-turner", "jane-strong"):
        stored = assets.get_entity(tmp_path, "qw-demo", "npc", npc_id)
        assert stored["parse_state"] == "named_only"
        assert stored["mechanics"]["status"] == "authored"
    lucas_stored = assets.get_entity(
        tmp_path, "qw-demo", "npc", "lucas-strong",
    )
    ingest_timing = lucas_stored["ingest_timing"]
    assert ingest_timing["host_timing_status"] == "reported"
    assert ingest_timing["source_compile_ms"] == 0
    assert ingest_timing["source_task_id"] == "source-worker-mechanics-exact"
    assert lucas_stored["host_timing"] == fulfilled["data"][
        "measured_host_timing"
    ]
    fulfillment_receipt = ingest_timing[assets.FULFILLED_PACK_INGEST_FIELD]
    assert fulfillment_receipt["job_id"] == request["job_id"]
    for related_kind, related_id in (
        ("npc", "joseph-turner"),
        ("npc", "jane-strong"),
        ("item", "ritual-knife"),
    ):
        related_stored = assets.get_entity(
            tmp_path, "qw-demo", related_kind, related_id,
        )
        assert related_stored.get("ingest_timing") is None

    fulfilled_request = json.loads(request_path.read_text(encoding="utf-8"))
    assert fulfilled_request["status"] == "fulfilled"
    assert fulfilled_request["dispatch_state"] == "fulfilled"
    assert fulfilled_request["fulfilled_at"]
    assert fulfilled_request["fulfilled_entity"] == (
        assets.canonical_fulfilled_entity_receipt(
            "npc", "lucas-strong", lucas_stored,
        )
    )
    assert assets.fulfilled_request_matches_current_pack(
        fulfilled_request,
        lucas_stored,
        kind="npc",
        entity_id="lucas-strong",
    ) is True

    worker.run_worker_once(tmp_path, parallel=4)
    request_after_merge = json.loads(request_path.read_text(encoding="utf-8"))
    assert request_after_merge["status"] == "fulfilled"
    assert request_after_merge["dispatch_state"] == "fulfilled"
    assert request_after_merge["fulfilled_at"] == fulfilled_request["fulfilled_at"]
    assert request_after_merge["fulfilled_entity"] == fulfilled_request["fulfilled_entity"]
    assert "superseded_at" not in request_after_merge
    scenario = tmp_path / ".coc" / "campaigns" / cid / "scenario"
    agendas = json.loads((scenario / "npc-agendas.json").read_text(encoding="utf-8"))
    lucas_projected = next(
        row for row in agendas["npcs"] if row["npc_id"] == "lucas-strong"
    )
    assert lucas_projected["mechanics"]["status"] == "authored"
    meta = json.loads((scenario / "module-meta.json").read_text(encoding="utf-8"))
    assert (
        meta["module_mechanics"]["items"]["ritual-knife"]["mechanics"]["status"]
        == "authored"
    )

    ready, _warnings, _hints = toolbox.TOOLS["mechanics.ensure"]["handler"](
        toolbox.Ctx(tmp_path, cid),
        {
            "subject_kind": "npc",
            "subject_id": "lucas-strong",
            "purpose": "combat",
            "decision_id": "mechanics-lucas-strong",
        },
    )
    assert ready["authority"] == "authored"
    assert ready["profile"]["characteristics"]["STR"] == 55
    item_ready, _warnings, _hints = toolbox.TOOLS["mechanics.ensure"]["handler"](
        toolbox.Ctx(tmp_path, cid),
        {
            "subject_kind": "item",
            "subject_id": "ritual-knife",
            "purpose": "item_use",
            "decision_id": "mechanics-ritual-knife",
        },
    )
    granted, _warnings, _hints = toolbox.TOOLS["state.item_grant"]["handler"](
        toolbox.Ctx(tmp_path, cid),
        {
            "npc_id": "lucas-strong",
            "kind": "weapon",
            "label": "仪式刀",
            "mechanics_ref": item_ready["mechanics_ref"],
            "decision_id": "grant-ritual-knife",
        },
    )
    assert granted["changed"] is True
    inventory, _warnings, _hints = toolbox.TOOLS["state.inventory_list"]["handler"](
        toolbox.Ctx(tmp_path, cid), {"npc_id": "lucas-strong"},
    )
    assert inventory["weapons"][0]["extends"] == "knife_medium"


def test_improvised_mechanics_are_frozen_and_reused(tmp_path: Path):
    cid = _campaign(tmp_path)
    ctx = toolbox.Ctx(tmp_path, cid)
    first, _warnings, _hints = toolbox.TOOLS["mechanics.ensure"]["handler"](
        ctx,
        {
            "subject_kind": "npc",
            "subject_id": "improvised-bouncer",
            "purpose": "combat",
            "fallback_archetype_id": "capable_adult",
            "label": "临时保镖",
            "decision_id": "generate-bouncer",
        },
    )
    second, _warnings, _hints = toolbox.TOOLS["mechanics.ensure"]["handler"](
        toolbox.Ctx(tmp_path, cid),
        {
            "subject_kind": "npc",
            "subject_id": "improvised-bouncer",
            "purpose": "check",
            "decision_id": "reuse-bouncer",
        },
    )

    assert first["authority"] == "campaign_generated"
    assert first["reused"] is False
    assert second["reused"] is True
    assert second["profile"] == first["profile"]


def _full_parse_bundle(
    tmp_path: Path,
    *,
    name: str,
    source_id: str,
    title: str,
    page_count: int,
    pages: dict[int, str],
) -> tuple[Path, str]:
    """Build one validated schema-v1 source bundle for full-parse fixtures."""
    pdf = tmp_path / f"{name}.pdf"
    pdf.write_bytes(f"%PDF {name} fixture".encode("utf-8"))
    file_sha = hashlib.sha256(pdf.read_bytes()).hexdigest()
    bundle = tmp_path / f"{name}-bundle"
    bundle.mkdir(exist_ok=True)
    manifest_pages = []
    for pdf_index, text in sorted(pages.items()):
        page_bytes = text.encode("utf-8")
        markdown_path = f"page-{pdf_index:04d}.md"
        (bundle / markdown_path).write_bytes(page_bytes)
        anchor = next(
            line for line in reversed(text.splitlines()) if line.strip()
        )
        manifest_pages.append({
            "pdf_index": pdf_index,
            "markdown_path": markdown_path,
            "text_sha256": hashlib.sha256(page_bytes).hexdigest(),
            "review_state": "manual_accepted",
            "parse_confidence": 0.95,
            "grep_anchors": [anchor],
        })
    (bundle / "manifest.json").write_text(json.dumps({
        "schema_version": 1,
        "producer": "codex-pdf-skill",
        "source": {
            "source_id": source_id,
            "title": title,
            "path": str(pdf),
            "file_sha256": file_sha,
            "page_count": page_count,
        },
        "pages": manifest_pages,
    }), encoding="utf-8")
    return bundle, file_sha


def _full_parse_enqueue(
    tmp_path: Path,
    *,
    asset_root: str = "qw-demo",
    campaign: str = "qw-camp",
) -> dict:
    return assets.enqueue_job(
        tmp_path,
        asset_root,
        kind="full_parse",
        target_id=asset_root,
        priority=5,
        reason="bind_full_parse",
        consumer_refs=[assets.campaign_consumer_ref(
            tmp_path, campaign, asset_root, intent_kind="full_parse",
        )],
        kick_worker=False,
    )


def test_full_parse_bind_trigger_enqueues_one_idempotent_job(tmp_path: Path):
    """S1 trigger: a successful bind queues exactly one whole-book parse job."""
    campaign_id = "fp-bind-camp"
    bundle, _file_sha = _full_parse_bundle(
        tmp_path, name="fp-bind", source_id="pdf:fp-bind-module",
        title="FP Bind Module", page_count=4,
        pages={0: "# Opening\n\nOpening evidence.\n", 1: "# Cellar\n\nCellar evidence.\n"},
    )
    created = toolbox.run_tool("setup.invoke", tmp_path, None, {
        "kind": "campaign.create",
        "payload": {"campaign_id": campaign_id, "title": "FP Bind Campaign"},
    })
    assert created["ok"] is True, created
    bound = toolbox.run_tool("setup.invoke", tmp_path, None, {
        "kind": "scenario.bind_pdf",
        "payload": {
            "campaign_id": campaign_id,
            "scenario_id": "fp-bind-module",
            "title": "FP Bind Module",
            "source_bundle_path": str(bundle),
            "compile_now": False,
        },
    })
    assert bound["ok"] is True, bound
    full_parse = bound["data"]["result"]["full_parse"]
    assert full_parse["triggered"] is True
    assert full_parse["enqueued"] is True
    job_id = full_parse["job_id"]
    assert job_id

    # Rebind (opening-review style) coalesces onto the same durable job.
    rebound = toolbox.run_tool("setup.invoke", tmp_path, None, {
        "kind": "scenario.bind_pdf",
        "payload": {
            "campaign_id": campaign_id,
            "scenario_id": "fp-bind-module",
            "title": "FP Bind Module",
            "source_bundle_path": str(bundle),
            "compile_now": False,
        },
    })
    assert rebound["ok"] is True, rebound
    rebind_parse = rebound["data"]["result"]["full_parse"]
    assert rebind_parse["triggered"] is True
    assert rebind_parse["deduped"] is True
    assert rebind_parse["job_id"] == job_id
    queue = assets.list_queue(tmp_path, "fp-bind-module")
    full_parse_rows = [
        row for row in queue["pending"]
        if row.get("kind") == "full_parse"
    ]
    assert len(full_parse_rows) == 1


def test_full_parse_worker_host_request_and_retryable_ocr_failure(
    tmp_path: Path,
):
    """Worker-native lane: one full_parse job runs the whole-book OCR attempt
    (baiduocr bridge); without OCR capability the job records a retryable
    failure with an explicit failure_class and keeps the durable request open
    for a bounded automatic retry instead of stranding."""
    _campaign(tmp_path)
    _clear_queue(tmp_path)
    queued = _full_parse_enqueue(tmp_path)
    assert queued["enqueued"] is True
    assert queued["job"]["kind"] == "full_parse"
    assert queued["job"]["target_id"] == "qw-demo"

    processed = worker.run_worker_once(tmp_path, parallel=1)
    assert processed["claimed"] == 1
    result = processed["results"][0]
    assert result["result"] == "retryable_failure"
    assert result["failure_class"] == "full_parse_ocr_disabled"
    request_path = Path(result["host_work_request"])
    request = json.loads(request_path.read_text(encoding="utf-8"))
    assert request["kind"] == "full_parse"
    assert request["job_id"] == queued["job"]["job_id"]
    # Whole-book 0-based page range from the bound bundle manifest page_count,
    # the same base the bundle contract itself enforces.
    assert request["requested_pdf_indices"] == [0, 1, 2, 3]
    assert [row["pdf_index"] for row in request["cached_page_refs"]] == [0, 1]
    assert request["cached_scope_complete"] is False
    assert request["consumer_state"] == "owned"
    assert request["work_level"] == "bounded_warm"
    assert request["deadline_class"] == "idle_warm"
    assert request["source_aspect"] == "full"
    assert "worker-native OCR" in request["instruction"]
    assert request["result_contract"]["contract_id"] == (
        "coc.full-parse-render-result.v1"
    )
    # Bounded failure accounting lives on the durable request row.
    assert request["render_failure_count"] == 1
    assert request["last_render_failure_class"] == "full_parse_ocr_disabled"
    state = assets.read_full_parse_state(tmp_path, "qw-demo")
    assert state["failure_class"] == "full_parse_ocr_disabled"
    assert state["status"] == "in_progress"  # retryable, not terminal
    assert state["next_operation"]["operation"] == "progressive.retry_full_parse"

    # Re-enqueue while the retry is pending dedupes onto the same in-flight
    # job (one full_parse job per module root, forever).
    again = _full_parse_enqueue(tmp_path)
    assert again["deduped"] is True
    assert again["job"]["job_id"] == queued["job"]["job_id"]
    assert again["dedupe_state"] == "in_flight"

    # The open request remains claimable as a durable packet (bookkeeping).
    claimed = assets.claim_host_work_requests(
        tmp_path, "qw-demo", executor_id="fp-test", limit=1,
    )
    assert len(claimed["packets"]) == 1
    packet = claimed["packets"][0]
    assert packet["requested_pdf_indices"] == [0, 1, 2, 3]
    assert packet["cached_scope_complete"] is False
    assert packet["requests"][0]["kind"] == "full_parse"

    # The stale-requeue pass re-claims the same row for the bounded retry.
    requeued = worker.requeue_stale_in_flight(tmp_path, "qw-demo", stale_after_s=0)
    assert requeued == 1
    processed = worker.run_worker_once(tmp_path, parallel=1)
    result = next(
        row for row in processed["results"]
        if row.get("kind") == "full_parse"
    )
    assert result["result"] == "retryable_failure"
    request = json.loads(request_path.read_text(encoding="utf-8"))
    # Failure budget is preserved across the retry claim, never reset.
    assert request["render_failure_count"] == 2


def test_full_parse_batch_registration_progress_and_first_writer_wins(
    tmp_path: Path,
):
    """S1 batches: registering a later page window advances the progress
    document; a drifted re-render keeps the first writer and records
    provenance instead of blocking the batch."""
    _campaign(tmp_path)
    _clear_queue(tmp_path)
    _full_parse_enqueue(tmp_path)
    worker.run_worker_once(tmp_path, parallel=1)
    state = assets.read_full_parse_state(tmp_path, "qw-demo")
    assert state["status"] == "in_progress"
    assert state["parsed_pdf_indices"] == [0, 1]

    pdf = tmp_path / "qw-demo.pdf"  # same bound PDF identity as the root
    file_sha = hashlib.sha256(pdf.read_bytes()).hexdigest()
    batch = tmp_path / "qw-batch-bundle"
    batch.mkdir(exist_ok=True)
    batch_pages = []
    for pdf_index, text in {2: "# Attic\n\nAttic evidence.\n",
                            3: "# Backyard\n\nBackyard evidence.\n"}.items():
        page_bytes = text.encode("utf-8")
        (batch / f"page-{pdf_index:04d}.md").write_bytes(page_bytes)
        batch_pages.append({
            "pdf_index": pdf_index,
            "markdown_path": f"page-{pdf_index:04d}.md",
            "text_sha256": hashlib.sha256(page_bytes).hexdigest(),
            "review_state": "manual_accepted",
            "parse_confidence": 0.95,
            "grep_anchors": [next(
                line for line in reversed(text.splitlines()) if line.strip()
            )],
        })
    (batch / "manifest.json").write_text(json.dumps({
        "schema_version": 1,
        "producer": "codex-pdf-skill",
        "source": {
            "source_id": "pdf:qw-demo",
            "title": "Queue Worker Demo",
            "path": str(pdf),
            "file_sha256": file_sha,
            "page_count": 4,
        },
        "pages": batch_pages,
    }), encoding="utf-8")
    registered = assets.register_source_bundle(
        tmp_path,
        batch,
        asset_root_id="qw-demo",
        record_drift=True,
    )
    assert registered["cached_pdf_indices"] == [2, 3]
    state = assets.read_full_parse_state(tmp_path, "qw-demo")
    # On one shared base a bundle can carry any page of the book, including
    # the last, so this batch completes it: 0 and 1 came with the first pack
    # and 2 and 3 arrive here.  The old offset made the final physical page
    # unreachable by any bundle and left the book perpetually in progress.
    assert state["parsed_pdf_indices"] == [0, 1, 2, 3]
    assert state["complete"] is True

    # Drifted re-render of page 1 (already accepted): first writer wins and
    # the batch records provenance instead of raising.
    drifted = tmp_path / "qw-drift-bundle"
    drifted.mkdir(exist_ok=True)
    drift_text = "# Cellar\n\nDIFFERENT cellar evidence.\n"
    drift_bytes = drift_text.encode("utf-8")
    (drifted / "page-0001.md").write_bytes(drift_bytes)
    (drifted / "manifest.json").write_text(json.dumps({
        "schema_version": 1,
        "producer": "codex-pdf-skill",
        "source": {
            "source_id": "pdf:qw-demo",
            "title": "Queue Worker Demo",
            "path": str(pdf),
            "file_sha256": file_sha,
            "page_count": 4,
        },
        "pages": [{
            "pdf_index": 1,
            "markdown_path": "page-0001.md",
            "text_sha256": hashlib.sha256(drift_bytes).hexdigest(),
            "review_state": "manual_accepted",
            "parse_confidence": 0.95,
            "grep_anchors": ["DIFFERENT cellar evidence."],
        }],
    }), encoding="utf-8")
    assets.register_source_bundle(
        tmp_path, drifted, asset_root_id="qw-demo", record_drift=True,
    )
    state = assets.read_full_parse_state(tmp_path, "qw-demo")
    assert len(state["provenance"]) == 1
    assert state["provenance"][0]["pdf_index"] == 1
    assert state["provenance"][0]["disposition"] == "first_writer_wins"
    page = assets.get_page(tmp_path, "qw-demo", 1)
    assert "# Cellar\n\nCached source scope.\n" in page["text"]
    assert "DIFFERENT cellar evidence" not in page["text"]


def test_full_parse_cache_hit_completes_without_host_work(tmp_path: Path):
    """S1 cache hit: a fully cached root completes the job directly and never
    writes a render handoff."""
    _register_qw_source_pages(tmp_path, {
        0: "# Opening\n\nAccepted authored clue scope.\n",
        1: "# Cellar\n\nCached source scope.\n",
        2: "# Attic\n\nCached attic scope.\n",
        3: "# Backyard\n\nCached backyard scope.\n",
    })
    # The final physical page (pdf_index == page_count) can only be cached
    # through the OCR put_page lane; bundles never carry it.
    assets.put_page(
        tmp_path, "qw-demo", 4, "# Chapel\n\nCached chapel scope.\n",
        meta={"review_state": "auto_accepted", "source_id": "pdf:qw-demo"},
    )
    cid = _campaign(tmp_path)
    _clear_queue(tmp_path)
    _full_parse_enqueue(tmp_path, campaign=cid)
    processed = worker.run_worker_once(tmp_path, parallel=1)
    result = next(
        row for row in processed["results"]
        if row.get("kind") == "full_parse"
    )
    assert result["result"] == "complete"
    host_work_dir = tmp_path / ".coc" / "module-assets" / "qw-demo" / "host-work"
    assert not host_work_dir.is_dir() or not list(host_work_dir.glob("*.json"))
    state = assets.read_full_parse_state(tmp_path, "qw-demo")
    assert state["status"] == "complete"
    assert state["complete"] is True
    assert state["parsed_pdf_indices"] == [0, 1, 2, 3]

    # Rebind after completion dedupes to the done row without a second job.
    again = _full_parse_enqueue(tmp_path, campaign=cid)
    assert again["dedupe_state"] == "done"
    queue = assets.list_queue(tmp_path, "qw-demo")
    assert sum(
        1 for row in queue["done"] if row.get("kind") == "full_parse"
    ) == 1


def test_full_parse_progress_visible_in_progressive_status(
    tmp_path: Path,
):
    """S1 status: progressive.status exposes the full_parse progress document
    (parsed pdf_indices, complete flag) and the bounded render lane."""
    cid = _campaign(tmp_path)
    _clear_queue(tmp_path)
    _full_parse_enqueue(tmp_path, campaign=cid)
    worker.run_worker_once(tmp_path, parallel=1)

    status = toolbox.TOOLS["progressive.status"]["handler"](
        toolbox.Ctx(tmp_path, cid), {},
    )
    full_parse = status[0]["full_parse"]
    assert full_parse["status"] == "in_progress"
    assert full_parse["page_count"] == 4
    assert full_parse["complete"] is False
    assert full_parse["parsed_pdf_indices"] == [0, 1]
    assert full_parse["job_id"]

    # The renderer registers the batch first (content-addressed), then the
    # driver forwards the receipt; progress recomputes from accepted pages.
    pdf = tmp_path / "qw-demo.pdf"
    batch = tmp_path / "qw-status-batch"
    batch.mkdir(exist_ok=True)
    page_bytes = b"# Attic\n\nStatus attic evidence.\n"
    (batch / "page-0002.md").write_bytes(page_bytes)
    (batch / "manifest.json").write_text(json.dumps({
        "schema_version": 1,
        "producer": "codex-pdf-skill",
        "source": {
            "source_id": "pdf:qw-demo",
            "title": "Queue Worker Demo",
            "path": str(pdf),
            "file_sha256": hashlib.sha256(pdf.read_bytes()).hexdigest(),
            "page_count": 4,
        },
        "pages": [{
            "pdf_index": 2,
            "markdown_path": "page-0002.md",
            "text_sha256": hashlib.sha256(page_bytes).hexdigest(),
            "review_state": "manual_accepted",
            "parse_confidence": 0.95,
            "grep_anchors": ["Status attic evidence."],
        }],
    }), encoding="utf-8")
    assets.register_source_bundle(
        tmp_path, batch, asset_root_id="qw-demo", record_drift=True,
    )
    state = assets.record_full_parse_render_result(
        tmp_path, "qw-demo",
        job_id=full_parse["job_id"],
        status="partial",
        rendered_pdf_indices=[2],
        failed_pdf_indices=[],
    )
    assert state["parsed_pdf_indices"] == [0, 1, 2]


def _fake_ocr_corpus_writer(corpus_pages: dict[int, str]):
    """Return a monkeypatchable OCR bridge that materializes a corpus dir."""

    def fake(source_pdf, corpus_dir, token, *, timeout_s=None):
        assert token, "fake OCR bridge received no token"
        corpus_dir.mkdir(parents=True, exist_ok=True)
        for doc_num, text in corpus_pages.items():
            (corpus_dir / f"doc_{doc_num}.md").write_text(
                text, encoding="utf-8",
            )
        return {
            "status": "completed",
            "markdown_document_count": len(corpus_pages),
        }

    return fake


def test_full_parse_ocr_corpus_registration_mapping_first_writer_wins_and_provenance(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
):
    """Worker-native OCR: the bridge corpus doc_N.md registers as
    pdf_index = doc_N + 1 (0-based doc ordinal → 1-based physical page,
    cover = 1) with baiduocr/unreviewed provenance; identical cached pages
    reuse silently; drifted pages keep the first writer and record
    provenance; out-of-scope docs are skipped; a complete corpus marks the
    manifest complete and closes the job."""
    _campaign(tmp_path)
    _clear_queue(tmp_path)
    queued = _full_parse_enqueue(tmp_path)
    # Hermetic OCR credential: never read the developer machine's secrets.
    (tmp_path / "secrets.env").write_text(
        "BAIDUOCR_TOKEN=test-token\n", encoding="utf-8",
    )
    monkeypatch.setenv("COC_KEEPER_ENV_FILE", str(tmp_path / "secrets.env"))
    monkeypatch.setenv("COC_FULL_PARSE_OCR_DISABLED", "0")
    monkeypatch.setattr(
        worker,
        "_invoke_full_parse_ocr",
        _fake_ocr_corpus_writer({
            # One shared 0-based scale, so each doc lands on the physical page
            # it actually is: doc_0 and doc_1 meet the first-pack pages
            # already cached at 0 and 1 (first writer wins, provenance
            # recorded) instead of being compared against their neighbours.
            0: "# Opening\n\nOCR re-rendered opening evidence.\n",
            1: "# Cellar\n\nOCR re-rendered cellar evidence.\n",
            # doc_2 → 2 and doc_3 → 3 (the final physical page) are newly
            # cached and inside the scope.
            2: "# Backyard\n\nBackyard OCR evidence.\n",
            3: "# Chapel\n\nChapel OCR evidence.\n",
            # doc_4 → pdf_index 4: outside the bound 4-page scope → skipped.
            4: "# Out of scope\n\nShould never register.\n",
        }),
    )
    processed = worker.run_worker_once(tmp_path, parallel=1)
    result = next(
        row for row in processed["results"]
        if row.get("kind") == "full_parse"
    )
    assert result["result"] == "complete", result
    ocr = result["ocr"]
    assert ocr["doc_page_count"] == 5
    # doc_0 and doc_1 drifted from the reviewed first-pack pages 0 and 1
    # (first writer wins, provenance recorded), so only docs 2–3 register.
    assert ocr["registered_pdf_indices"] == [2, 3]
    assert ocr["reused_page_count"] == 0
    assert ocr["drifted_page_count"] == 2
    assert ocr["skipped"] == [{
        "doc_ref": "doc_4.md", "doc_ordinal": 4,
        "pdf_index": 4, "reason": "outside_requested_scope",
    }]

    # First writer wins: the reviewed first-pack pages keep their text.
    page1 = assets.get_page(tmp_path, "qw-demo", 1)
    assert "Cached source scope." in page1["text"]
    assert "OCR re-rendered cellar" not in page1["text"]
    # New OCR pages carry the mechanical auto_accepted tier plus the honest
    # unreviewed baiduocr provenance in page meta.
    page2 = assets.get_page(tmp_path, "qw-demo", 2)
    assert "Backyard OCR evidence." in page2["text"]
    assert page2["meta"]["source"] == "baiduocr"
    assert page2["meta"]["unreviewed"] is True
    assert page2["meta"]["doc_ref"] == "doc_2.md"
    assert page2["meta"]["review_state"] == "auto_accepted"
    page3 = assets.get_page(tmp_path, "qw-demo", 3)
    assert "Chapel OCR evidence." in page3["text"]
    assert page3["meta"]["doc_ref"] == "doc_3.md"

    # The drift is durable provenance in the full_parse progress document.
    state = assets.read_full_parse_state(tmp_path, "qw-demo")
    assert state["status"] == "complete"
    assert state["complete"] is True
    assert state["parsed_pdf_indices"] == [0, 1, 2, 3]
    assert len(state["provenance"]) == 2
    drift = state["provenance"][0]
    assert drift["pdf_index"] == 0
    assert drift["doc_ref"] == "doc_0.md"
    assert drift["source"] == "baiduocr"
    assert drift["unreviewed"] is True
    assert drift["disposition"] == "first_writer_wins"

    # Corpus manifest is complete so a later bind reuses it without OCR.
    identity = json.loads(
        (
            tmp_path / ".coc" / "module-assets" / "qw-demo" / "identity.json"
        ).read_text(encoding="utf-8")
    )
    manifest = assets.read_ocr_corpus_manifest(
        tmp_path, identity["file_sha256"],
    )
    assert manifest["status"] == "complete"
    assert manifest["doc_page_count"] == 5
    assert manifest["producer"] == "baiduocr"
    queue = assets.list_queue(tmp_path, "qw-demo")
    done = next(
        row for row in queue["done"] if row.get("kind") == "full_parse"
    )
    assert done["result"] == "complete"
    # Rebind after completion dedupes to the same done row.
    again = _full_parse_enqueue(tmp_path)
    assert again["dedupe_state"] == "done"


def test_full_parse_ocr_complete_corpus_reuses_without_rerun(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
):
    """baiduocr reuse discipline: a complete sha-keyed corpus is reused
    verbatim; the bridge is never invoked again for the same PDF."""
    _campaign(tmp_path)
    _clear_queue(tmp_path)
    identity = json.loads(
        (
            tmp_path / ".coc" / "module-assets" / "qw-demo" / "identity.json"
        ).read_text(encoding="utf-8")
    )
    corpus = assets.ocr_corpus_dir(tmp_path, identity["file_sha256"])
    corpus.mkdir(parents=True, exist_ok=True)
    # The corpus shares the page cache's base, so doc_N is physical page N:
    # doc_0 and doc_1 restate the two pages the first pack already cached
    # (byte-identical, so they reuse without drift) and doc_2/doc_3 are new.
    (corpus / "doc_0.md").write_text(
        "# Opening\n\nAccepted authored clue scope.\n", encoding="utf-8",
    )
    (corpus / "doc_1.md").write_text(
        "# Cellar\n\nCached source scope.\n", encoding="utf-8",
    )
    (corpus / "doc_2.md").write_text(
        "# Backyard\n\nBackyard OCR evidence.\n", encoding="utf-8",
    )
    (corpus / "doc_3.md").write_text(
        "# Chapel\n\nChapel OCR evidence.\n", encoding="utf-8",
    )
    assets.write_ocr_corpus_manifest(
        tmp_path,
        identity["file_sha256"],
        source_path=str(tmp_path / "qw-demo.pdf"),
        page_count=4,
        doc_page_count=4,
        status="complete",
    )
    monkeypatch.setenv("COC_FULL_PARSE_OCR_DISABLED", "0")

    def must_not_run(*args, **kwargs):
        raise AssertionError("OCR bridge must not re-run for a complete corpus")

    monkeypatch.setattr(worker, "_invoke_full_parse_ocr", must_not_run)
    _full_parse_enqueue(tmp_path)
    processed = worker.run_worker_once(tmp_path, parallel=1)
    result = next(
        row for row in processed["results"]
        if row.get("kind") == "full_parse"
    )
    assert result["result"] == "complete", result
    state = assets.read_full_parse_state(tmp_path, "qw-demo")
    assert state["complete"] is True
    assert state["parsed_pdf_indices"] == [0, 1, 2, 3]
    assert state["provenance"] == []


def test_full_parse_baiduocr_redraw_of_existing_pdf_skill_page_first_writer_wins(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
):
    """Blocker-1 mirror direction (Luna probe page-4 pattern): the whole-book
    baiduocr lane re-renders a pdf_index that the pdf-skill first-pack/review
    lane already cached (cross-producer, different text).  put_page is
    first-writer-wins for the full_parse lane: the existing pdf-skill page
    keeps its text, the drift is durable provenance, and the batch still
    completes — never a content-drift rejection or a deadlock."""
    _campaign(tmp_path)
    # The pdf-skill lane already owns the book's last page with its own
    # transcription, exactly the Luna record ① layout (cached by the first
    # pack / review before the OCR batch redraws it).
    assets.put_page(
        tmp_path, "qw-demo", 3, "# Chapel\n\nReviewed chapel evidence.\n",
        meta={
            "source_id": "pdf:qw-demo",
            "review_state": "manual_accepted",
            "parse_confidence": 0.93,
        },
    )
    _clear_queue(tmp_path)
    queued = _full_parse_enqueue(tmp_path)
    (tmp_path / "secrets.env").write_text(
        "BAIDUOCR_TOKEN=test-token\n", encoding="utf-8",
    )
    monkeypatch.setenv("COC_KEEPER_ENV_FILE", str(tmp_path / "secrets.env"))
    monkeypatch.setenv("COC_FULL_PARSE_OCR_DISABLED", "0")
    monkeypatch.setattr(
        worker,
        "_invoke_full_parse_ocr",
        _fake_ocr_corpus_writer({
            # doc_0 → 0: drifts from the first-pack page 0.
            0: "# Opening\n\nOCR re-rendered opening evidence.\n",
            # doc_1 → 1: byte-identical to the cached page, so it reuses.
            1: "# Cellar\n\nCached source scope.\n",
            # doc_2 → 2: newly cached.
            2: "# Backyard\n\nBackyard OCR evidence.\n",
            # doc_3 → 3: redraws the existing pdf-skill last page with a
            # different transcription (Luna: "12月的帷幕…谢尔伯思").
            3: "# Chapel\n\nOCR redraw of the chapel page.\n",
        }),
    )
    processed = worker.run_worker_once(tmp_path, parallel=1)
    result = next(
        row for row in processed["results"]
        if row.get("kind") == "full_parse"
    )
    # The batch completes despite the cross-producer redraw; the drifted
    # page keeps its first writer instead of failing the whole parse.
    assert result["result"] == "complete", result
    ocr = result["ocr"]
    assert ocr["drifted_page_count"] == 2
    assert ocr["registered_pdf_indices"] == [1, 2]
    page3 = assets.get_page(tmp_path, "qw-demo", 3)
    assert "Reviewed chapel evidence." in page3["text"]
    assert "OCR redraw" not in page3["text"]
    # The existing evidence is untouched: bundle-lane pages carry no producer
    # label at all, and the OCR redraw never replaced them.
    assert page3["meta"].get("review_state") == "manual_accepted"
    assert page3["meta"].get("producer") is None
    state = assets.read_full_parse_state(tmp_path, "qw-demo")
    assert state["complete"] is True
    assert state["parsed_pdf_indices"] == [0, 1, 2, 3]
    last_page_drift = next(
        row for row in state["provenance"]
        if row.get("pdf_index") == 3
    )
    assert last_page_drift["doc_ref"] == "doc_3.md"
    assert last_page_drift["source"] == "baiduocr"
    assert last_page_drift["disposition"] == "first_writer_wins"


def test_full_parse_page_gap_reports_explicit_class_not_name_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
):
    """Last-page wrap-up (33/34 play evidence): when the OCR corpus cannot
    cover every requested page (here the final pdf_index 4 is missing), the
    worker reports the bounded ``full_parse_ocr_page_gap`` failure class and
    a retryable retry path — never a bare NameError that strands the job
    with failure_class=null."""
    _campaign(tmp_path)
    _clear_queue(tmp_path)
    queued = _full_parse_enqueue(tmp_path)
    first_job_id = queued["job"]["job_id"]
    (tmp_path / "secrets.env").write_text(
        "BAIDUOCR_TOKEN=test-token\n", encoding="utf-8",
    )
    monkeypatch.setenv("COC_KEEPER_ENV_FILE", str(tmp_path / "secrets.env"))
    monkeypatch.setenv("COC_FULL_PARSE_OCR_DISABLED", "0")
    monkeypatch.setattr(
        worker,
        "_invoke_full_parse_ocr",
        _fake_ocr_corpus_writer({
            # Only docs 0–2: pdf_index 4 (the final physical page) is never
            # produced — the play-08/luna 33/34 gap.
            0: "# Cellar\n\nOCR re-rendered cellar evidence.\n",
            1: "# Attic\n\nAttic OCR evidence.\n",
            2: "# Backyard\n\nBackyard OCR evidence.\n",
        }),
    )
    processed = worker.run_worker_once(tmp_path, parallel=1)
    result = next(
        row for row in processed["results"]
        if row.get("kind") == "full_parse"
    )
    assert result["result"] == "retryable_failure"
    assert result["failure_class"] == "full_parse_ocr_page_gap"
    assert "is not defined" not in str(result.get("error") or "")
    state = assets.read_full_parse_state(tmp_path, "qw-demo")
    assert state["status"] == "in_progress"
    assert state["complete"] is False
    assert state["failure_class"] == "full_parse_ocr_page_gap"
    assert state["next_operation"]["operation"] == "progressive.retry_full_parse"
    # The durable request row keeps the bounded failure budget.
    request = json.loads(
        (
            tmp_path / ".coc" / "module-assets" / "qw-demo"
            / "host-work" / f"{first_job_id}.json"
        ).read_text(encoding="utf-8")
    )
    assert request["render_failure_count"] == 1
    assert request["last_render_failure_class"] == "full_parse_ocr_page_gap"


def test_full_parse_ocr_terminal_failure_marks_class_and_retry_reenqueues(
    tmp_path: Path,
):
    """Failure handling: OCR failures are bounded (FULL_PARSE_MAX_RENDER_FAILURES)
    with backoff; the terminal failure marks failure_class plus an explicit
    next_operation on the job/progress document and a re-enqueue creates a
    fresh retry job — never a null dead end."""
    _campaign(tmp_path)
    _clear_queue(tmp_path)
    queued = _full_parse_enqueue(tmp_path)
    first_job_id = queued["job"]["job_id"]

    for attempt in range(1, worker.coc_module_assets.FULL_PARSE_MAX_RENDER_FAILURES + 1):
        processed = worker.run_worker_once(tmp_path, parallel=1)
        result = next(
            row for row in processed["results"]
            if row.get("kind") == "full_parse"
        )
        if attempt < worker.coc_module_assets.FULL_PARSE_MAX_RENDER_FAILURES:
            assert result["result"] == "retryable_failure"
            assert result["render_failure_count"] == attempt
        else:
            assert result["result"] == "failed"
            assert result["render_failure_count"] == attempt
            assert result["failure_class"] == "full_parse_ocr_disabled"
            assert result["next_operation"]["operation"] == (
                "progressive.retry_full_parse"
            )
        # Force the bounded automatic retry pass immediately.
        moved = worker.requeue_stale_in_flight(
            tmp_path, "qw-demo", stale_after_s=0,
        )
        assert moved == (1 if attempt < worker.coc_module_assets.FULL_PARSE_MAX_RENDER_FAILURES else 0)

    state = assets.read_full_parse_state(tmp_path, "qw-demo")
    assert state["status"] == "failed"
    assert state["complete"] is False
    assert state["failure_class"] == "full_parse_ocr_disabled"
    assert state["next_operation"]["operation"] == "progressive.retry_full_parse"
    assert state["next_operation"]["arguments"] == {"asset_root_id": "qw-demo"}
    request = json.loads(
        (
            tmp_path / ".coc" / "module-assets" / "qw-demo"
            / "host-work" / f"{first_job_id}.json"
        ).read_text(encoding="utf-8")
    )
    assert request["status"] == "cancelled"
    assert request["result"] == "failed"
    assert request["render_failure_count"] == 3
    queue = assets.list_queue(tmp_path, "qw-demo")
    done_row = next(
        row for row in queue["done"] if row.get("kind") == "full_parse"
    )
    assert done_row["result"] == "failed"
    assert done_row["failed"] is True

    # Re-enqueue after terminal failure creates a FRESH retry job (no dead
    # end), and the retry tool exposes the same lane for the KP.
    retried = _full_parse_enqueue(tmp_path)
    assert retried["enqueued"] is True
    assert retried["job"]["job_id"] != first_job_id
    assert retried["job"]["kind"] == "full_parse"
    state = assets.read_full_parse_state(tmp_path, "qw-demo")
    assert state["status"] == "queued"
    assert state["job_id"] == retried["job"]["job_id"]
    assert state["next_operation"] is None  # fresh attempt clears the retry card


def test_progressive_retry_full_parse_tool_reenqueues_failed_lane(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
):
    """The explicit retry operation re-enqueues one fresh full_parse job after
    a terminal OCR failure and reports the refreshed progress document."""
    cid = _campaign(tmp_path)
    _clear_queue(tmp_path)
    _full_parse_enqueue(tmp_path)
    for _ in range(worker.coc_module_assets.FULL_PARSE_MAX_RENDER_FAILURES):
        worker.run_worker_once(tmp_path, parallel=1)
        worker.requeue_stale_in_flight(tmp_path, "qw-demo", stale_after_s=0)
    state = assets.read_full_parse_state(tmp_path, "qw-demo")
    assert state["status"] == "failed"

    retried = toolbox.run_tool(
        "progressive.retry_full_parse", tmp_path, cid,
        {"asset_root_id": "qw-demo"},
    )
    assert retried["ok"] is True, retried
    data = retried["data"]
    assert data["enqueued"] is True
    assert data["job_id"]
    assert data["full_parse"]["status"] == "queued"
    assert data["full_parse"]["job_id"] == data["job_id"]

    # Complete the retry via the (faked) OCR bridge: the retry op then
    # dedupes to the done row instead of re-parsing.
    (tmp_path / "secrets.env").write_text(
        "BAIDUOCR_TOKEN=test-token\n", encoding="utf-8",
    )
    monkeypatch.setenv("COC_KEEPER_ENV_FILE", str(tmp_path / "secrets.env"))
    monkeypatch.setenv("COC_FULL_PARSE_OCR_DISABLED", "0")
    monkeypatch.setattr(
        worker,
        "_invoke_full_parse_ocr",
        _fake_ocr_corpus_writer({
            0: "# Cellar\n\nCached source scope.\n",
            1: "# Attic\n\nAttic OCR evidence.\n",
            2: "# Backyard\n\nBackyard OCR evidence.\n",
            3: "# Chapel\n\nChapel OCR evidence.\n",
        }),
    )
    worker.run_worker_once(tmp_path, parallel=1)
    state = assets.read_full_parse_state(tmp_path, "qw-demo")
    assert state["status"] == "complete"
    settled = toolbox.run_tool(
        "progressive.retry_full_parse", tmp_path, cid,
        {"asset_root_id": "qw-demo"},
    )
    assert settled["ok"] is True
    assert settled["data"]["dedupe_state"] == "done"


def test_full_parse_open_request_never_blocks_opening(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
):
    """S1 non-blocking: while the whole-book parse is open, the opening lane
    still prepares, claims, and fulfills its exact cached window."""
    campaign_id = "fp-open-camp"
    bundle, _file_sha = _full_parse_bundle(
        tmp_path, name="fp-open", source_id="pdf:fp-open-module",
        title="FP Open Module", page_count=4,
        pages={
            0: "# Opening\n\nOpening evidence.\n",
            1: "# Cellar\n\nCellar evidence.\n",
        },
    )
    toolbox.run_tool("setup.invoke", tmp_path, None, {
        "kind": "campaign.create",
        "payload": {"campaign_id": campaign_id, "title": "FP Open Campaign"},
    })
    bound = toolbox.run_tool("setup.invoke", tmp_path, None, {
        "kind": "scenario.bind_pdf",
        "payload": {
            "campaign_id": campaign_id,
            "scenario_id": "fp-open-module",
            "title": "FP Open Module",
            "source_bundle_path": str(bundle),
            "compile_now": False,
        },
    })
    assert bound["ok"] is True, bound
    assert bound["data"]["result"]["full_parse"]["triggered"] is True

    # The opening-source review is the canonical setup gate (unchanged by
    # full_parse); complete it so the opening lane can proceed.
    scenario_path = (
        tmp_path / ".coc" / "campaigns" / campaign_id / "scenario" / "scenario.json"
    )
    scenario_json = json.loads(scenario_path.read_text(encoding="utf-8"))
    pending_task = scenario_json["opening_source_review_task"]
    review_receipt = (
        toolbox.coc_runtime_ops._build_opening_source_review_fulfillment(
            tmp_path,
            continuation={
                "schema_version": 1,
                "contract_id": pending_task["continuation_contract_id"],
                "campaign_id": campaign_id,
                "scenario_id": "fp-open-module",
                "selected_opening_pdf_indices": [0],
                "source_bundle_id": "fp-open-module",
                "source_bundle_path": scenario_json["source"]["source_bundle_path"],
                "result_delivery": "task_return_to_parent",
            },
            status="reviewed",
            selected_opening_pdf_indices=[0],
        )
    )
    facts = {
        "schema_version": 1,
        "contract_id": "coc.opening-fast-facts.v1",
        "era": {"status": "source", "value": "1920s",
                "source_refs": [{"source_id": "pdf:fp-open-module", "pdf_index": 0}]},
        "place": {"status": "source", "value": "Boston",
                  "source_refs": [{"source_id": "pdf:fp-open-module", "pdf_index": 0}]},
        "investigator_hook": {"status": "unresolved",
                              "inspected_source_refs": [{"source_id": "pdf:fp-open-module", "pdf_index": 0}]},
        "investigator_constraints": {"status": "unresolved",
                                     "inspected_source_refs": [{"source_id": "pdf:fp-open-module", "pdf_index": 0}]},
        "player_safe_summary": {"status": "unresolved",
                                "inspected_source_refs": [{"source_id": "pdf:fp-open-module", "pdf_index": 0}]},
        "content_flags": {"status": "source", "value": ["haunting"],
                          "source_refs": [{"source_id": "pdf:fp-open-module", "pdf_index": 0}]},
    }
    toolbox.coc_runtime_ops._apply_opening_source_review_fulfillment(
        tmp_path, review_receipt, source_facts=facts,
    )
    # The progressive IR projection stamps the campaign's module root; it is
    # the normal opening setup step and is not gated by full_parse.
    skeleton = _skeleton()
    skeleton["source"] = {
        "source_id": "pdf:fp-open-module",
        "path": str(tmp_path / "fp-open.pdf"),
        "file_sha256": hashlib.sha256(
            (tmp_path / "fp-open.pdf").read_bytes()
        ).hexdigest(),
        "page_count": 4,
        "producer": "codex-pdf-skill",
    }
    skeleton["start_clock_status"] = "unresolved"
    published = toolbox.run_tool(
        "progressive.publish_skeleton", tmp_path, campaign_id,
        {
            "asset_root_id": "fp-open-module",
            "source_file_sha256": skeleton["source"]["file_sha256"],
            "skeleton": skeleton,
        },
    )
    assert published["ok"] is True, published
    # Prepare opening while full_parse is still queued: never gated by it.
    prepared = toolbox.run_tool(
        "progressive.prepare_opening", tmp_path, campaign_id,
        {"opening_pdf_indices": [0]},
    )
    assert prepared["ok"] is True, prepared

    worker.run_worker_once(tmp_path, parallel=2)
    all_open = assets.list_host_work_requests(tmp_path, "fp-open-module", limit=None)
    full_parse_rows = [
        row for row in all_open
        if row.get("kind") == "full_parse"
    ]
    assert len(full_parse_rows) == 1
    full_parse_row = full_parse_rows[0]
    assert full_parse_row["work_level"] == "bounded_warm"
    assert full_parse_row["deadline_class"] == "idle_warm"
    assert "dependency_ref" not in full_parse_row

    # The full_parse request is worker-native OCR bookkeeping: it never is a
    # current-dependency wait, never enters the coordinator-ready opening
    # surface, and never carries a pdf-skill adapter dispatch on Pi.
    monkeypatch.setenv("COC_HOST", "pi")
    projection = _projection_for_campaign(tmp_path, campaign_id)
    assert projection["blocking_micro_ready_count"] == 0
    assert projection["current_dependency_waits"] == []
    assert projection["ready_for_background_count"] == 0
    assert "full_parse_dispatch" not in projection
    assert "background_takeover" not in projection

    # prepare_opening completed while full_parse was still open: the opening
    # lane was never blocked by the whole-book parse.
    assert prepared["ok"] is True
    assert (prepared.get("data") or {}).get("component_ready") in {True, False}


def _projection_for_campaign(tmp_path: Path, campaign_id: str) -> dict:
    ctx = toolbox.Ctx(tmp_path, campaign_id)
    ctx.campaign_dir = tmp_path / ".coc" / "campaigns" / campaign_id
    root_id = project.campaign_asset_root_id(ctx.campaign_dir)
    return toolbox._source_host_work_projection(ctx, root_id)


def _structure_claim_envelope(candidate_count: int) -> dict:
    """One claim batch shaped like the live dust-to-dust deadlock.

    A whole-book classify_sections request plus one ordinary request. The
    structure payload alone is larger than the hot claim budget.
    """
    candidates = [
        {
            "section_id": f"sec-{index:06d}",
            "title": f"SECTION TITLE {index} " + "T" * 40,
            "pdf_index": index,
            "size_rank": index + 1,
            "emphasis": True,
            "page_cached": True,
            "preview": f"# SECTION {index} " + "P" * 300,
        }
        for index in range(candidate_count)
    ]
    structure = {
        "schema_version": 1,
        "contract_id": "coc.section-classification-request.v1",
        "job_id": "job-structure",
        "candidates": candidates,
        "page_count": candidate_count,
    }
    request = {
        "job_id": "job-structure",
        "kind": "classify_sections",
        "target_id": "section-index",
        "work_level": "background",
        "result_contract": {"schema_version": 1, "contract_id": "x"},
        "classification_request": structure,
    }
    packet = {
        "schema_version": 1,
        "contract_id": "coc.source-pack-worker.v1",
        "packet_id": "source-lease-structure",
        "asset_root_id": "dust-to-dust",
        "work_group_id": "group-structure",
        "requests": [request],
    }
    task = {
        "schema_version": 1,
        "contract_id": "coc.pi-source-pack-task.v1",
        "instruction_ref": "/tmp/coc-source-pack-worker.md",
        "model_policy": "inherit_parent",
        "packet": packet,
    }
    return {
        "ok": True,
        "tool": "progressive.claim_host_work",
        "data": {
            "leased_group_count": 1,
            "ready_group_count": 0,
            "cached_only": True,
            "dispatch_task_count": 1,
            "lease_bindings": [
                {"lease_id": "source-lease-structure", "job_ids": ["job-structure"]},
            ],
            "dispatch_tasks": [task],
        },
        "warnings": [],
        "hints": [],
    }, structure


def test_oversized_structure_request_spills_instead_of_voiding_the_claim():
    """A whole-book classify_sections claim must survive the hot budget.

    Regression for the live vfy2 deadlock: the structure payload pushed the
    claim past 16 KiB, the projector replaced the whole result with
    _claim_projection_failure, both leases were voided, and the section lane
    could never start. The payload already exists in the host-work job file, so
    it travels as a path plus digest instead.
    """
    envelope, structure = _structure_claim_envelope(42)
    assert wire.transport_bytes(structure) > wire.MAX_INLINE_BYTES

    projected = wire.project_envelope(
        "progressive.claim_host_work",
        envelope,
        contract_digest="sha256:" + "f" * 64,
    )

    assert wire.transport_bytes(projected) <= wire.MAX_INLINE_BYTES
    assert projected["wire"]["claim_structure_requests_spilled"] is True
    # The whole point: the claim is no longer voided.
    assert projected["wire"].get("claim_dispatch_projection_failed") is not True
    assert projected["data"].get("wire_projection_failed") is not True
    assert len(projected["data"]["dispatch_tasks"]) == 1

    request = projected["data"]["dispatch_tasks"][0]["packet"]["requests"][0]
    assert "classification_request" not in request
    ref = request["classification_request_ref"]
    assert ref["field"] == "classification_request"
    assert ref["sha256"] == wire.canonical_digest(structure)
    assert ref["host_work_path"] == (
        ".coc/module-assets/dust-to-dust/host-work/job-structure.json"
    )
    # Workspace-relative only; the Pi runtime refuses anything that escapes.
    assert not ref["host_work_path"].startswith("/")
    assert ".." not in ref["host_work_path"].split("/")
    # Lease ownership is preserved so the work stays claimable.
    assert projected["data"]["lease_bindings"] == [
        {"lease_id": "source-lease-structure", "job_ids": ["job-structure"]},
    ]


def test_spill_covers_the_return_to_parent_packets_shape():
    """The live coordinator path leaves packets in `packets`, not dispatch_tasks.

    A projector that walks only dispatch_tasks silently no-ops on the real
    claim, which is exactly how the first version of this fix passed its
    fixture while doing nothing to the live deadlock.
    """
    envelope, structure = _structure_claim_envelope(42)
    # Re-shape into the return_to_parent delivery the coordinator actually uses.
    task = envelope["data"].pop("dispatch_tasks")[0]
    envelope["data"]["packets"] = [task["packet"]]

    projected = wire.project_envelope(
        "progressive.claim_host_work",
        envelope,
        contract_digest="sha256:" + "f" * 64,
    )

    assert projected["wire"]["claim_structure_requests_spilled"] is True
    request = projected["data"]["packets"][0]["requests"][0]
    assert "classification_request" not in request
    assert request["classification_request_ref"]["sha256"] == (
        wire.canonical_digest(structure)
    )


def test_claim_that_already_fits_is_left_untouched():
    """Spilling is a budget escape hatch, not a change to the normal shape."""
    envelope, _ = _structure_claim_envelope(1)
    assert wire.transport_bytes(envelope) <= wire.MAX_INLINE_BYTES

    projected = wire.project_envelope(
        "progressive.claim_host_work",
        envelope,
        contract_digest="sha256:" + "f" * 64,
    )

    assert "claim_structure_requests_spilled" not in projected["wire"]
    request = projected["data"]["dispatch_tasks"][0]["packet"]["requests"][0]
    assert "classification_request_ref" not in request
    assert request["classification_request"]["candidates"]
