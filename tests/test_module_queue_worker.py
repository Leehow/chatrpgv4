#!/usr/bin/env python3
"""Tests for background parallel progressive parse-queue worker."""
from __future__ import annotations

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
    _clear_queue(tmp_path, asset_root_id)
    requested = toolbox.run_tool(
        "progressive.request_deepen", tmp_path, campaign_id,
        {"kind": "location", "target_id": "cellar", "reason": "pi preload"},
    )
    assert requested["ok"] is True, requested
    materialized = worker.run_worker_once(tmp_path, parallel=1)
    assert materialized["claimed"] == 1

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
    assert "fulfillment operation binds the request transiently" in request[
        "instruction"
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
                "authored_choices_or_investigation_paths",
                "information_each_path_can_establish",
                "named_conditional_contacts_as_mentions",
                "materially_present_npcs",
            ],
        },
        "semantic_default_replacement": {
            "clues": "populate every source-authored clue needed to play the current beat",
            "affordances": "populate source-authored immediately usable courses of action",
            "mentions": "populate source-authored named people or places referenced but not materially present",
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
    assert lifecycle["awaiting_scope_count"] == 1
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
    _clear_queue(tmp_path)
    assets.enqueue_job(
        tmp_path,
        "qw-demo",
        kind="deepen_location",
        target_id="chapel",
        reason="known scope whose accepted page is not cached yet",
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
    assert first_request["requested_pdf_indices"] == [1]

    _register_qw_source_pages(tmp_path, {2: "# Cellar context\n"})
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
    _clear_queue(tmp_path)
    for target_id in ("cellar", "annex"):
        assets.enqueue_job(
            tmp_path,
            "qw-demo",
            kind="deepen_location",
            target_id=target_id,
            priority=80,
            reason="bounded background test",
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


def test_legacy_host_work_is_deleted_and_requeued_without_l1_inference(
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
    request_path.write_text(json.dumps(legacy), encoding="utf-8")

    assert assets.list_host_work_requests(tmp_path, "qw-demo") == []
    assert not request_path.exists()
    queue = assets.list_queue(tmp_path, "qw-demo")
    replacement = next(
        row for row in queue["pending"]
        if row["job_id"] == queued["job"]["job_id"]
    )
    assert replacement["work_level"] == "near_term"
    assert "dependency_ref" not in replacement


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
    assert assets.get_entity(tmp_path, "qw-demo", "location", "cellar") is None


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
