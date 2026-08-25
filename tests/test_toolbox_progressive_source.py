"""Behavior tests owned by the progressive-source operation cell."""
from toolbox_test_support import *

def test_adoption_rejects_unknown_advice_id(campaign_ws):
    adoption = _run(campaign_ws, "evidence.record_adoption", {
        "decision_id": "turn-adoption-placeholder",
        "advice_id": "placeholder",
        "disposition": "ignored",
        "reason": "No advisory receipt exists for this placeholder.",
    })
    assert adoption["ok"] is False
    assert adoption["error"]["code"] == "unknown_advice_id"
    path = campaign_ws["campaign_dir"] / "logs" / "advisory-adoptions.jsonl"
    rows = _read_jsonl(path) if path.exists() else []
    assert not any(row.get("decision_id") == "turn-adoption-placeholder" for row in rows)

def test_progressive_clue_roll_gate_uses_discovery_mode_not_skill_presence():
    """Automatic discovery is never roll-gated; check mode is; starters remain."""
    automatic = {
        "clue_id": "archive-history",
        "delivery_kind": "obvious",
        "skill": "Library Use",
        "discovery": {"mode": "automatic", "skill": None, "difficulty": None},
    }
    check = {
        "clue_id": "locked-diary",
        "delivery_kind": "obvious",
        "discovery": {
            "mode": "check",
            "skill": "Spot Hidden",
            "difficulty": "regular",
        },
    }
    starter = {
        "clue_id": "starter-check",
        "delivery_kind": "skill_check",
        "skill": "Library Use",
        "difficulty": "regular",
    }
    assert coc_toolbox._clue_is_roll_gated(automatic) is False
    assert coc_toolbox._clue_is_roll_gated(check) is True
    assert coc_toolbox._clue_is_roll_gated(starter) is True
    assert coc_toolbox._clue_roll_gate_skills(check) == ["Spot Hidden"]
    assert coc_toolbox._clue_roll_gate_skills(starter) == ["Library Use"]

def test_progressive_fulfill_resolve_mechanics_preserves_narrative_depth(tmp_path: Path):
    """resolve_* fulfillment merges mechanics only and does not force deep."""
    from datetime import datetime, timedelta, timezone

    assets = _load("coc_module_assets_toolbox_prog", SCRIPTS / "coc_module_assets.py")
    project = _load("coc_module_project_toolbox_prog", SCRIPTS / "coc_module_project.py")
    mechanics = _load("coc_mechanics_toolbox_prog", SCRIPTS / "coc_mechanics.py")
    workspace = tmp_path / "ws"
    workspace.mkdir()
    asset_root = "prog-mech"
    pdf = workspace / "prog-mech.pdf"
    pdf.write_bytes(b"%PDF mechanics fulfillment fixture")
    file_sha = hashlib.sha256(pdf.read_bytes()).hexdigest()
    bundle = workspace / "prog-mech-source"
    bundle.mkdir()
    page_bytes = b"# Appendix\n\nAuthored subject mechanics.\n"
    (bundle / "page-0003.md").write_bytes(page_bytes)
    (bundle / "manifest.json").write_text(json.dumps({
        "schema_version": 1,
        "producer": "codex-pdf-skill",
        "source": {
            "source_id": "pdf:prog-mech",
            "title": "Progressive Mechanics",
            "path": str(pdf),
            "file_sha256": file_sha,
            "page_count": 4,
        },
        "pages": [{
            "pdf_index": 3,
            "markdown_path": "page-0003.md",
            "text_sha256": hashlib.sha256(page_bytes).hexdigest(),
            "review_state": "manual_accepted",
            "parse_confidence": 0.99,
            "grep_anchors": ["Authored subject mechanics."],
        }],
    }), encoding="utf-8")
    assets.register_source_bundle(
        workspace,
        bundle,
        asset_root_id=asset_root,
        module_identity={"canonical_module_id": asset_root},
    )
    assets.put_entity(workspace, asset_root, "npc", "npc-subject", {
        "npc_id": "npc-subject",
        "name": "Subject",
        "display_name": "Subject",
        "parse_state": "body_parsed",
        "source_page_indices": [3],
        "agenda": "Keeps watch over the archive.",
        "origin": "source",
        "mechanics": {"status": "unresolved"},
    })
    now = datetime.now(timezone.utc)
    job_id = "job-resolve-npc-subject"
    host_dir = workspace / ".coc" / "module-assets" / asset_root / "host-work"
    host_dir.mkdir(parents=True, exist_ok=True)
    (host_dir / f"{job_id}.json").write_text(json.dumps({
        "schema_version": assets.HOST_WORK_SCHEMA_VERSION,
        "job_id": job_id,
        "kind": "resolve_npc_mechanics",
        "target_id": "npc-subject",
        "status": "open",
        "dispatch_state": "leased",
        "leased_at": now.isoformat(),
        "lease_expires_at": (now + timedelta(minutes=10)).isoformat(),
        "requested_pdf_indices": [3],
        "cached_page_refs": [{
            "source_id": "pdf:prog-mech",
            "pdf_index": 3,
            "text_sha256": hashlib.sha256(page_bytes).hexdigest(),
        }],
        "batch_subjects": [],
        "work_level": "near_term",
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    campaign_id = "prog-camp"
    camp = workspace / ".coc" / "campaigns" / campaign_id
    camp.mkdir(parents=True)
    (camp / "campaign.json").write_text(json.dumps({
        "schema_version": 1,
        "campaign_id": campaign_id,
        "title": "Prog",
        "status": "active",
        "play_language": "zh-Hans",
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    scenario = camp / "scenario"
    scenario.mkdir(exist_ok=True)
    (scenario / "scenario.json").write_text(json.dumps({
        "schema_version": 1,
        "progressive_asset_root_id": asset_root,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    for name, payload in {
        "module-meta.json": {
            "schema_version": 1,
            "progressive": True,
            "scenario_id": asset_root,
            "module_identity": {"canonical_module_id": asset_root},
        },
        "story-graph.json": {"schema_version": 1, "scenes": []},
        "clue-graph.json": {"schema_version": 1, "conclusions": []},
        "npc-agendas.json": {"schema_version": 1, "npcs": []},
        "timeline.json": {"schema_version": 1},
        "threat-clocks.json": {"schema_version": 1},
        "handouts.json": {"schema_version": 1},
    }.items():
        (scenario / name).write_text(
            json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8",
        )
    assert project.campaign_asset_root_id(camp) == asset_root

    extracted = {
        "characteristics.STR", "characteristics.CON", "characteristics.SIZ",
        "characteristics.DEX", "characteristics.POW",
        "derived.HP", "derived.MP", "derived.SAN", "derived.MOV", "derived.Build",
        "skills", "weapons",
    }
    observed = sorted(extracted)
    not_authored = sorted(mechanics.ACTOR_FIELD_IDS - extracted)
    pack = {
        "mechanics": {
            "status": "authored",
            "source_refs": [{
                "source_id": "pdf:prog-mech",
                "pdf_index": 3,
                "text_sha256": hashlib.sha256(page_bytes).hexdigest(),
            }],
            "fields_observed": observed,
            "fields_extracted": observed,
            "fields_not_authored": not_authored,
            "provenance": {"authority": "source_authored"},
            "profile": {
                "profile_kind": "actor",
                "characteristic_scale": "percentile",
                "characteristics": {
                    "STR": 60, "CON": 55, "SIZ": 60, "DEX": 50, "POW": 45,
                },
                "derived": {"HP": 11, "MP": 9, "SAN": 45, "MOV": 8, "Build": 1},
                "skills": {"Fighting (Brawl)": 45, "Dodge": 25},
                "weapons": [{"weapon_id": "unarmed", "extends": "unarmed"}],
            },
        }
    }
    result = coc_toolbox.run_tool(
        "progressive.fulfill_host_work",
        workspace,
        campaign_id,
        {"job_id": job_id, "pack": pack},
    )
    assert result["ok"] is True, result
    stored = assets.get_entity(workspace, asset_root, "npc", "npc-subject")
    assert stored is not None
    assert stored["parse_state"] == "body_parsed"
    assert stored["mechanics"]["status"] == "authored"
    assert stored.get("agenda") == "Keeps watch over the archive."

def test_structure_fulfill_gateway_returns_standard_tuple_without_replaying_effects(
    tmp_path: Path, monkeypatch,
):
    """Claimed section work must use the ordinary typed gateway envelope."""
    monkeypatch.setenv("COC_DISABLE_QUEUE_WORKER", "1")
    ws = _opening_component_workspace(
        tmp_path,
        extra_pdf_indices=(1, 2),
        source_page_count=3,
    )
    published = _run(ws, "progressive.publish_skeleton", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "skeleton": ws["skeleton"],
    })
    assert published["ok"] is True, published
    monkeypatch.setenv("COC_HOST", "pi")
    monkeypatch.setenv("COC_PI_HEADLESS", "1")

    assets = coc_toolbox.coc_module_project.coc_module_assets
    worker = coc_toolbox.coc_module_project._load_sibling(
        "coc_module_queue_worker_structure_gateway_tuple",
        "coc_module_queue_worker.py",
    )
    outline_store = coc_toolbox.coc_module_project._load_sibling(
        "coc_module_outline_store_structure_gateway_tuple",
        "coc_module_outline_store.py",
    )
    _write_json(
        assets._module_dir(ws["workspace"], ws["asset_root_id"])
        / outline_store.OUTLINE_NAME,
        {
            "schema_version": 1,
            "contract_id": "coc.source-outline.v1",
            "producer": "host_outline",
            "confidence_class": "exact",
            "source_id": "pdf:opening-component",
            "file_sha256": ws["file_sha256"],
            "outline_sha256": "a" * 64,
            "page_count": 3,
            "rows": [
                {
                    "pdf_index": 1,
                    "order": 1,
                    "text": "Keeper Background",
                    "weight": 18.0,
                    "emphasis": False,
                    "size_rank": 1,
                },
            ],
        },
    )
    consumer_refs = [assets.campaign_consumer_ref(
        ws["workspace"],
        ws["campaign_id"],
        ws["asset_root_id"],
        intent_kind="section_pass",
    )]

    def materialize(kind: str, target_id: str) -> str:
        queued = assets.enqueue_job(
            ws["workspace"],
            ws["asset_root_id"],
            kind=kind,
            target_id=target_id,
            priority=60,
            reason="structure gateway tuple regression",
            consumer_refs=consumer_refs,
            kick_worker=False,
        )
        job_id = queued["job"]["job_id"]
        produced = worker.run_worker_once(ws["workspace"], parallel=1)
        assert produced["claimed"] == 1, produced
        queue = assets.list_queue(ws["workspace"], ws["asset_root_id"])
        assert not any(
            row["job_id"] == job_id
            for bucket in ("pending", "in_flight")
            for row in queue[bucket]
        )
        done = [row for row in queue["done"] if row["job_id"] == job_id]
        assert len(done) == 1
        assert done[0]["result"] == "awaiting_host_pack"
        return job_id

    def claim_one() -> dict:
        claimed = _run(ws, "progressive.claim_host_work", {
            "executor_id": "pi-structure-gateway-test",
            "limit": 1,
            "result_delivery": "return_to_parent",
        })
        assert claimed["ok"] is True, claimed
        packets = claimed["data"]["packets"]
        assert len(packets) == 1
        assert len(packets[0]["requests"]) == 1
        return packets[0]["requests"][0]

    classify_job_id = materialize(
        assets.CLASSIFY_SECTIONS_KIND,
        assets.SECTION_INDEX_TARGET_ID,
    )
    classify_request = claim_one()
    assert classify_request["job_id"] == classify_job_id
    candidate = classify_request["classification_request"]["candidates"][0]
    valid_row = {
        "section_id": candidate["section_id"],
        "title": candidate["title"],
        "pdf_indices": [candidate["pdf_index"]],
        "audience": "keeper_only",
        "timing": "on_demand",
        "payload": "narrative",
        "binding": {"kind": "global", "entity_kind": None, "entity_ids": []},
        "confidence": "high",
    }
    # Mirrors the new Pi semantic E2E failure shape: a classifier may not
    # name an entity binding without an existing canonical entity id.
    invalid_row = deepcopy(valid_row)
    invalid_row["binding"] = {
        "kind": "entity",
        "entity_kind": "location",
        "entity_ids": [],
    }
    invalid = _run(ws, "progressive.fulfill_host_work", {
        "worker_result": {
            "job_id": classify_job_id,
            "pack": {"sections": [invalid_row]},
            "related_packs": [],
        },
    })
    assert invalid["ok"] is False
    assert invalid["error"]["code"] == "invalid_source_worker_pack"
    assert assets.read_section_index(ws["workspace"], ws["asset_root_id"]) is None
    assert assets.get_host_work_request(
        ws["workspace"], ws["asset_root_id"], classify_job_id,
    ).get("status") != "fulfilled"

    classified = _run(ws, "progressive.fulfill_host_work", {
        "worker_result": {
            "job_id": classify_job_id,
            "pack": {"sections": [valid_row]},
            "related_packs": [],
        },
    })
    assert classified["ok"] is True, classified
    assert set(classified["data"]) == {
        "ok", "job_id", "kind", "section_count", "coverage",
    }
    assert classified["data"]["ok"] is True
    assert classified["data"]["job_id"] == classify_job_id
    assert classified["data"]["kind"] == assets.CLASSIFY_SECTIONS_KIND
    assert classified["data"]["section_count"] == 1
    assert classified["warnings"] == []
    assert classified["hints"] == []
    index_path = assets.section_index_path(ws["workspace"], ws["asset_root_id"])
    index_before_replay = index_path.read_bytes()
    index = assets.read_section_index(ws["workspace"], ws["asset_root_id"])
    assert index["sections"] == [{**valid_row, "parse_state": "indexed"}]
    assert assets.get_host_work_request(
        ws["workspace"], ws["asset_root_id"], classify_job_id,
    )["status"] == "fulfilled"

    # A retry after canonical closure must not reapply a section-index write.
    classify_replay = _run(ws, "progressive.fulfill_host_work", {
        "worker_result": {
            "job_id": classify_job_id,
            "pack": {"sections": [valid_row]},
            "related_packs": [],
        },
    })
    assert classify_replay["ok"] is False
    assert classify_replay["error"]["code"] == "invalid_state"
    assert index_path.read_bytes() == index_before_replay

    extract_job_id = materialize(assets.EXTRACT_SECTION_KIND, valid_row["section_id"])
    extract_request = claim_one()
    assert extract_request["job_id"] == extract_job_id
    extraction = extract_request["extraction_request"]
    extracted = _run(ws, "progressive.fulfill_host_work", {
        "worker_result": {
            "job_id": extract_job_id,
            "pack": {
                "section_id": valid_row["section_id"],
                "pack_kind": "keeper_truth",
                "title": valid_row["title"],
                "body_markdown": "Bounded faithful section body.",
                "highlights": ["Structure gateway regression fixture."],
                "source_refs": [{
                    "source_id": extraction["source_id"],
                    "pdf_index": extraction["requested_pdf_indices"][0],
                }],
            },
            "related_packs": [],
        },
    })
    assert extracted["ok"] is True, extracted
    assert set(extracted["data"]) == {
        "ok", "job_id", "kind", "section_id", "pack_kind", "body_path",
    }
    assert extracted["data"]["ok"] is True
    assert extracted["data"]["job_id"] == extract_job_id
    assert extracted["data"]["kind"] == assets.EXTRACT_SECTION_KIND
    assert extracted["data"]["section_id"] == valid_row["section_id"]
    assert extracted["data"]["pack_kind"] == "keeper_truth"
    assert Path(extracted["data"]["body_path"]).is_file()
    assert extracted["warnings"] == []
    assert extracted["hints"] == []
    assert assets.get_host_work_request(
        ws["workspace"], ws["asset_root_id"], extract_job_id,
    )["status"] == "fulfilled"
    resolved = assets.read_section_index(ws["workspace"], ws["asset_root_id"])
    assert resolved["sections"][0]["parse_state"] == "resolved"
    assert assets.get_section_pack(
        ws["workspace"], ws["asset_root_id"], valid_row["section_id"],
    )["body_present"] is True

    extract_body = Path(extracted["data"]["body_path"])
    extract_before_replay = extract_body.read_bytes()
    extract_replay = _run(ws, "progressive.fulfill_host_work", {
        "worker_result": {
            "job_id": extract_job_id,
            "pack": {
                "section_id": valid_row["section_id"],
                "pack_kind": "keeper_truth",
                "title": valid_row["title"],
                "body_markdown": "Bounded faithful section body.",
                "highlights": ["Structure gateway regression fixture."],
                "source_refs": [{
                    "source_id": extraction["source_id"],
                    "pdf_index": extraction["requested_pdf_indices"][0],
                }],
            },
            "related_packs": [],
        },
    })
    assert extract_replay["ok"] is False
    assert extract_replay["error"]["code"] == "invalid_state"
    assert extract_body.read_bytes() == extract_before_replay

def test_source_coordinator_dispatch_is_closed_deterministic_and_advisory():
    ready = [
        {
            "job_id": "job-b-2",
            "work_group_id": "group-b",
            "requested_pdf_indices": [2],
        },
        {
            "job_id": "job-a-1",
            "work_group_id": "group-a",
            "requested_pdf_indices": [0],
        },
        {
            "job_id": "job-b-1",
            "work_group_id": "group-b",
            "requested_pdf_indices": [1],
        },
    ]
    first = coc_toolbox._source_coordinator_dispatch(
        workspace_root="/workspace",
        campaign_id="campaign-a",
        asset_root_id="asset-a",
        ready_background=ready,
    )
    second = coc_toolbox._source_coordinator_dispatch(
        workspace_root="/workspace",
        campaign_id="campaign-a",
        asset_root_id="asset-a",
        ready_background=list(reversed(ready)),
    )
    assert first == second
    assert set(first) == {
        "agent_type", "run_in_background", "task_prompt", "packet",
        "codex_task",
    }
    assert first["agent_type"] == "coc-source-coordinator"
    assert first["run_in_background"] is True
    packet = first["packet"]
    assert set(packet) == {
        "schema_version",
        "contract_id",
        "packet_id",
        "adapter_mode",
        "workspace_root",
        "python_executable",
        "toolbox_script",
        "campaign_id",
        "asset_root_id",
        "claim_operation",
        "fulfill_operation",
        "max_leaves",
        "leaf_worker",
        "failure_policy",
    }
    assert packet["contract_id"] == "coc.source-coordinator.v1"
    assert packet["adapter_mode"] == "manager_exact_forward"
    assert packet["workspace_root"] == "/workspace"
    assert Path(packet["python_executable"]).is_absolute()
    assert packet["python_executable"] == sys.executable
    assert Path(packet["toolbox_script"]).is_absolute()
    assert Path(packet["toolbox_script"]) == TOOLBOX_SCRIPT.resolve()
    assert packet["campaign_id"] == "campaign-a"
    assert packet["asset_root_id"] == "asset-a"
    assert packet["max_leaves"] == 2
    claim = packet["claim_operation"]
    assert claim["operation"] == "progressive.claim_host_work"
    assert claim["invoke_via"] == "canonical_typed_operation_gateway"
    assert claim["missing_arguments"] == []
    assert claim["prefilled_arguments"]["limit"] == 2
    assert claim["prefilled_arguments"]["result_delivery"] == (
        "return_to_parent"
    )
    assert claim["prefilled_arguments"]["executor_id"].startswith(
        "source-coordinator:"
    )
    assert packet["fulfill_operation"] == {
        "operation": "progressive.fulfill_host_work",
        "invoke_via": "canonical_typed_operation_gateway",
        "fixed_arguments": {},
        "missing_arguments": ["worker_result"],
        "exact_forward_binding": (
            "worker_result=one exact leaf results[] value"
        ),
        "authority": "source_fulfillment",
        "hard_gate": False,
    }
    assert packet["leaf_worker"] == {
        "agent_type": "coc-source-pack-worker",
        "instruction_ref": str(
            (REPO / "plugins/coc-keeper/agents/coc-source-pack-worker.md").resolve()
        ),
        "model_policy": "inherit_parent",
        "run_in_background": False,
        "prompt_binding": "one exact returned packets[] value",
        "result_binding": (
            "forward every exact usable results[] value once through "
            "progressive.fulfill_host_work"
        ),
    }
    failure = packet["failure_policy"]
    assert failure["authority"] == "prompt_first_advisory"
    assert failure["single_failure"] == "transient_allowed"
    assert failure["same_failure_escalation_threshold"] == 3
    assert failure["threshold_outcome"] == "design_issue"
    assert failure["same_task_retry"] is False
    assert failure["player_action_gate"] is False
    assert failure["narrative_gate"] is False
    assert failure["output_gate"] is False
    serialized = json.dumps(first, ensure_ascii=False, sort_keys=True)
    for forbidden in (
        "player_transcript", "source_page_text", "campaign_state",
    ):
        assert forbidden not in serialized
    codex_task = first["codex_task"]
    assert codex_task["contract_id"] == (
        "coc.codex-source-coordinator-task.v1"
    )
    assert Path(codex_task["instruction_ref"]) == (
        REPO / "plugins/coc-keeper/agents/coc-source-coordinator.md"
    ).resolve()
    assert codex_task["model_policy"] == "inherit_parent"
    assert codex_task["packet"] == packet

def test_source_direct_single_dispatch_is_closed_and_needs_no_manager():
    first = coc_toolbox._source_direct_single_dispatch(
        workspace_root="/workspace",
        campaign_id="campaign-a",
        asset_root_id="asset-a",
    )
    second = coc_toolbox._source_direct_single_dispatch(
        workspace_root="/workspace",
        campaign_id="campaign-a",
        asset_root_id="asset-a",
    )
    assert first == second
    assert first["agent_type"] == "coc-source-pack-worker"
    assert first["run_in_background"] is True
    assert first["dispatch_mode"] == "direct_single_leaf"
    task = first["codex_task"]
    assert task["contract_id"] == "coc.codex-source-pack-claim-task.v1"
    assert task["workspace_root"] == "/workspace"
    assert task["campaign_id"] == "campaign-a"
    assert task["asset_root_id"] == "asset-a"
    claim = task["claim_operation"]
    assert claim["operation"] == "progressive.claim_host_work"
    assert claim["missing_arguments"] == []
    assert claim["prefilled_arguments"] == {
        "executor_id": claim["prefilled_arguments"]["executor_id"],
        "limit": 1,
        "result_delivery": "task_return_to_parent",
    }
    assert claim["prefilled_arguments"]["executor_id"].startswith(
        "source-direct:"
    )
    assert first["codex_parent_claims"] is False
    assert "spawn exact codex_task immediately" in first["codex_task_binding"]
    named_claim = first["named_submit_claim_operation"]
    assert named_claim["prefilled_arguments"]["result_delivery"] == (
        "named_submit"
    )
    assert first["completion_operation"]["operation"] == (
        "progressive.fulfill_host_work"
    )
    assert first["completion_operation"]["missing_arguments"] == [
        "worker_result"
    ]
    assert first["model_policy"] == "inherit_parent"
    assert first["preconfirmation_parent_waits"] is False
    assert first["postconfirmation_blocking_minimum"] is True
    assert first["parent_result_polls"] == 0
    assert first["parent_output_retrieval"] is False
    assert first["parent_calls_fulfill_host_work"] is True

def test_source_inline_single_dispatch_reuses_the_opening_owner():
    first = coc_toolbox._source_inline_single_dispatch(
        workspace_root="/workspace",
        campaign_id="campaign-a",
        asset_root_id="asset-a",
    )
    second = coc_toolbox._source_inline_single_dispatch(
        workspace_root="/workspace",
        campaign_id="campaign-a",
        asset_root_id="asset-a",
    )
    assert first == second
    assert first["dispatch_mode"] == "inline_single_owner"
    action = first["next_host_action"]
    assert action["action"] == "claim_and_compile_inline"
    assert action["owner"] == "opening_source_coordinator"
    assert action["nested_agent"] is False
    assert action["packet_count"] == 1
    claim = action["operation"]
    assert claim["operation"] == "progressive.claim_host_work"
    assert claim["root"] == "/workspace"
    assert claim["campaign"] == "campaign-a"
    assert claim["prefilled_arguments"] == {
        "executor_id": claim["prefilled_arguments"]["executor_id"],
        "limit": 1,
        "result_delivery": "return_to_parent",
    }
    assert claim["prefilled_arguments"]["executor_id"].startswith(
        "source-opening:"
    )
    assert action["on_completion"]["operation"]["operation"] == (
        "progressive.fulfill_host_work"
    )

def test_source_projection_uses_coordinator_only_for_multiple_groups(
    tmp_path: Path,
):
    ctx = coc_toolbox.Ctx(tmp_path, None)
    rows = [
        {
            "job_id": f"job-{suffix}",
            "kind": "deepen_location",
            "target_id": suffix,
            "priority": 50,
            "requested_pdf_indices": [index],
            "source_aspect": "body",
            "deadline_class": "idle_warm",
            "work_group_id": f"group-{suffix}",
            "dispatch_state": "ready",
            "dispatch_attempts": 0,
            "cached_scope_complete": True,
        }
        for index, suffix in enumerate(("a", "b"))
    ]
    projection = coc_toolbox._source_host_work_projection(
        ctx,
        "asset-a",
        all_open_host_work=rows,
    )
    takeover = projection["background_takeover"]
    assert takeover["dispatch_mode"] == "coordinator_fanout"
    assert "direct_single_leaf_dispatch" not in takeover
    assert "next_host_action" not in takeover
    coordinator = takeover["coordinator_dispatch"]
    assert coordinator["run_in_background"] is True
    assert coordinator["packet"]["max_leaves"] == 2
    assert coordinator["packet"]["claim_operation"]["prefilled_arguments"][
        "result_delivery"
    ] == "return_to_parent"

def test_pi_source_projection_terminalizes_exhausted_retry_budget(
    tmp_path: Path,
    monkeypatch,
):
    monkeypatch.setenv("COC_HOST", "pi")
    ctx = coc_toolbox.Ctx(tmp_path, None)
    exhausted = {
        "job_id": "job-exhausted",
        "kind": "deepen_location",
        "target_id": "cellar",
        "priority": 50,
        "requested_pdf_indices": [7],
        "source_aspect": "body",
        "deadline_class": "idle_warm",
        "work_group_id": "group-cellar",
        "dispatch_state": "ready",
        "dispatch_attempts": 2,
        "cached_scope_complete": True,
    }
    projection = coc_toolbox._source_host_work_projection(
        ctx,
        "asset-a",
        all_open_host_work=[exhausted],
    )
    assert projection["ready_for_background_count"] == 0
    assert "background_takeover" not in projection
    assert projection["pi_coordinator_dispatch_status"] == "retry_exhausted"
    assert projection["pi_coordinator_max_attempts"] == 2
    assert projection["pi_coordinator_retry_exhausted_count"] == 1
    assert projection["pi_coordinator_retry_exhausted_requests"] == [
        exhausted
    ]
    assert projection["automatic_retry_remaining"] is False

def test_source_projection_uses_parent_flat_fanout_for_grok_multi_group(
    tmp_path: Path,
    monkeypatch,
):
    monkeypatch.setenv("COC_HOST", "grok")
    ctx = coc_toolbox.Ctx(tmp_path, None)
    rows = [
        {
            "job_id": f"job-{suffix}",
            "kind": "deepen_location",
            "target_id": suffix,
            "priority": 50,
            "requested_pdf_indices": [index],
            "source_aspect": "body",
            "deadline_class": "idle_warm",
            "work_group_id": f"group-{suffix}",
            "dispatch_state": "ready",
            "dispatch_attempts": 0,
            "cached_scope_complete": True,
        }
        for index, suffix in enumerate(("a", "b", "c"))
    ]
    projection = coc_toolbox._source_host_work_projection(
        ctx,
        "asset-a",
        all_open_host_work=rows,
    )
    takeover = projection["background_takeover"]
    assert takeover["dispatch_mode"] == "parent_flat_fanout"
    assert takeover["host_adapter"] == "grok"
    assert "coordinator_dispatch" not in takeover
    action = takeover["next_host_action"]
    assert action["action"] == "claim_then_spawn_named_workers"
    assert action["execute_before_any_other_host_operation"] is True
    claim = action["operation"]
    assert claim["operation"] == "progressive.claim_host_work"
    assert claim["prefilled_arguments"] == {
        "executor_id": claim["prefilled_arguments"]["executor_id"],
        "limit": 3,
        "result_delivery": "named_submit",
    }
    assert claim["prefilled_arguments"]["executor_id"].startswith(
        "source-parent-fanout:"
    )
    assert action["max_workers"] == 3
    assert action["agent_type"] == "coc-source-pack-worker"
    assert action["run_in_background"] is True
    assert action["parent_waits"] is False
    assert action["parent_result_polls"] == 0
    assert action["parent_output_retrieval"] is False
    assert action["parent_calls_fulfill_host_work"] is False
    assert "unqualified" in action["spawn_binding"]
    assert "never nest" in action["spawn_binding"]

def test_grok_parent_flat_fanout_isolated_claim_dispatch_and_fulfill(
    monkeypatch,
):
    """End-to-end Grok multi-group path in an isolated /tmp workspace.

    This is repository adapter evidence (projection → claim → multi leaf
    packets → durable fulfill), not a live Grok KP session and not
    acceptance play. Campaign state lives only under ``/tmp/coc-isolated/``.
    """
    monkeypatch.setenv("COC_HOST", "grok")
    monkeypatch.setenv("COC_DISABLE_QUEUE_WORKER", "1")
    iso_root = _isolated_coc_workspace("grok-parent-fanout")
    ws = _grok_multi_location_isolated_workspace(iso_root)
    (iso_root / "probe-kind.txt").write_text(
        "component-adapter-vertical\nnot-live-kp\nnot-acceptance\n",
        encoding="utf-8",
    )

    published = _run(ws, "progressive.publish_skeleton", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "skeleton": ws["skeleton"],
    })
    assert published["ok"] is True, published
    assets = coc_toolbox.coc_module_project.coc_module_assets
    for target_id, pdf_index in (("alley", 1), ("cellar", 2)):
        # A body deepen only becomes dispatchable background work once its body
        # scope is resolved; a skeleton source_span alone leaves it awaiting the
        # scope locator lane.
        assets.ensure_stub(
            ws["workspace"],
            ws["asset_root_id"],
            "location",
            target_id,
            title=target_id.title(),
            source_scope={"source_page_indices": [pdf_index]},
            body_source_scope={"source_page_indices": [pdf_index]},
        )
    for target_id in ("alley", "cellar"):
        dig = _run(ws, "progressive.follow_mentions", {
            "mentions": [{"kind": "location", "ref_id": target_id}],
            "reason": "isolated_parent_flat_fanout_probe",
        })
        assert dig["ok"] is True, dig

    worker = coc_toolbox.coc_module_project._load_sibling(
        "coc_module_queue_worker_grok_parent_fanout_isolation",
        "coc_module_queue_worker.py",
    )
    materialized = worker.run_worker_once(ws["workspace"], parallel=2)
    assert materialized["claimed"] == 2, materialized

    status = _run(ws, "progressive.status")
    assert status["ok"] is True, status
    host_work = status["data"]["host_work"]
    assert host_work["open_count"] == 2
    assert host_work["ready_for_background_count"] == 2
    takeover = status["data"]["background_takeover"]
    assert takeover["dispatch_mode"] == "parent_flat_fanout"
    assert takeover["host_adapter"] == "grok"
    assert "coordinator_dispatch" not in takeover
    action = takeover["next_host_action"]
    assert action["action"] == "claim_then_spawn_named_workers"
    assert action["parent_calls_fulfill_host_work"] is False
    assert action["parent_output_retrieval"] is False
    assert action["max_workers"] == 2
    claim_card = action["operation"]
    assert claim_card["operation"] == "progressive.claim_host_work"
    assert claim_card["prefilled_arguments"]["limit"] == 2
    assert claim_card["prefilled_arguments"]["result_delivery"] == (
        "named_submit"
    )
    assert claim_card["prefilled_arguments"]["executor_id"].startswith(
        "source-parent-fanout:"
    )

    claimed = _run(
        ws,
        claim_card["operation"],
        claim_card["prefilled_arguments"],
    )
    assert claimed["ok"] is True, claimed
    assert claimed["data"]["dispatch_task_count"] == 2
    assert claimed["data"]["leased_group_count"] == 2
    assert "packets" not in claimed["data"]
    tasks = claimed["data"]["dispatch_tasks"]
    assert len(tasks) == 2
    targets = set()
    for task in tasks:
        assert task["contract_id"] == "coc.codex-source-pack-task.v1"
        assert task["model_policy"] == "inherit_parent"
        packet = task["packet"]
        assert packet["contract_id"] == "coc.source-pack-worker.v1"
        assert packet["result_delivery"] == "named_submit"
        assert packet["cached_scope_complete"] is True
        assert len(packet["requested_pdf_indices"]) == 1
        request = packet["requests"][0]
        assert request["kind"] == "deepen_location"
        targets.add(request["target_id"])
        page = request["cached_page_refs"][0]
        # Named-submit children own merge in live Grok; the repository
        # fulfillment boundary is the same durable put used by submit.
        # This probe exercises that boundary with exact packs, not a KP.
        pack = {
            "location_id": request["target_id"],
            "title": request["target_id"].title(),
            "parse_state": "deep",
            "evidence_gap": False,
            "origin": "source",
            "source_page_indices": list(packet["requested_pdf_indices"]),
            "source_refs": [{
                "source_id": page["source_id"],
                "pdf_index": page["pdf_index"],
                "text_sha256": page["text_sha256"],
            }],
            "player_safe_summary": (
                f"Isolated deep pack for {request['target_id']}."
            ),
            "available_clue_ids": [],
            "npc_ids": [],
            "clues": [],
            "npcs": [],
            "scene_edges": [],
            "affordances": [],
            "keeper_secret_refs": [],
            "pressure_moves": [],
            "tone": [],
            "mentions": [],
            "host_work_job_id": request["job_id"],
        }
        fulfilled = _run(ws, "progressive.fulfill_host_work", {
            "job_id": request["job_id"],
            "pack": pack,
            "related_packs": [],
        })
        assert fulfilled["ok"] is True, fulfilled
        assert fulfilled["data"]["request_status"] == "fulfilled"
    assert targets == {"alley", "cellar"}

    after = _run(ws, "progressive.status")
    assert after["ok"] is True, after
    assert after["data"]["host_work"]["open_count"] == 0
    assert after["data"]["host_work"]["ready_for_background_count"] == 0
    assert after["data"].get("background_takeover") is None
    assert after["data"]["host_work"].get("leased_count", 0) == 0

    evidence = {
        "probe": "grok_parent_flat_fanout_isolated",
        "iso_root": str(iso_root),
        "workspace": str(ws["workspace"]),
        "campaign_id": ws["campaign_id"],
        "dispatch_mode": "parent_flat_fanout",
        "claimed_targets": sorted(targets),
        "open_count_after": 0,
        "live_kp": False,
        "acceptance": False,
    }
    (iso_root / "evidence.json").write_text(
        json.dumps(evidence, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    # Keep the isolated root for inspection; never write into the repo tree.
    workspace_text = str(ws["workspace"].resolve())
    assert workspace_text.startswith("/tmp/coc-isolated/") or workspace_text.startswith(
        "/private/tmp/coc-isolated/"
    )
    assert REPO.resolve() not in ws["workspace"].resolve().parents

def test_opening_request_returns_inline_takeover_for_source_coordinator(
    tmp_path: Path, monkeypatch,
):
    monkeypatch.setenv("COC_DISABLE_QUEUE_WORKER", "1")
    monkeypatch.setenv("COC_HOST", "codex")
    ws = _opening_component_workspace(tmp_path)
    published = _run(ws, "progressive.publish_skeleton", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "skeleton": ws["skeleton"],
    })
    assert published["ok"] is True, published
    first = _run(ws, "progressive.request_opening_pack", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "start_location_id": "opening",
        "opening_pdf_indices": [0],
        "request_purpose": "foreground_opening_slice",
        "execution_owner": "opening_source_coordinator",
    })
    assert first["ok"] is True, first
    assert first["data"]["host_request_id"] == first["data"]["job_id"]
    assert "background_takeover" in first["data"]

    repeated = _run(ws, "progressive.request_opening_pack", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "start_location_id": "opening",
        "opening_pdf_indices": [0],
        "request_purpose": "foreground_opening_slice",
        "execution_owner": "opening_source_coordinator",
    })
    assert repeated["ok"] is True, repeated
    assert repeated["data"]["host_request_id"] == first["data"]["job_id"]
    takeover = repeated["data"]["background_takeover"]
    assert takeover["dispatch_mode"] == "inline_single_owner"
    assert "coordinator_dispatch" not in takeover
    assert takeover["host_adapter"] == "codex"
    assert "direct_single_leaf_dispatch" not in takeover
    action = takeover["next_host_action"]
    assert action["action"] == "claim_and_compile_inline"
    assert action["execute_before_any_other_host_operation"] is True
    assert action["owner"] == "opening_source_coordinator"
    assert action["nested_agent"] is False
    claim_card = action["operation"]
    assert claim_card["invoke_via"] == "coc_invoke"
    assert claim_card["root"] == str(ws["workspace"].resolve())
    assert claim_card["campaign"] == ws["campaign_id"]
    claimed = _run(
        ws,
        claim_card["operation"],
        claim_card["prefilled_arguments"],
    )
    assert claimed["ok"] is True, claimed
    assert "dispatch_tasks" not in claimed["data"]
    assert len(claimed["data"]["packets"]) == 1
    packet = claimed["data"]["packets"][0]
    assert packet["result_delivery"] == "return_to_parent"
    assert packet["requests"][0]["job_id"] == first["data"]["job_id"]
    assert action["on_completion"]["operation"]["operation"] == (
        "progressive.fulfill_host_work"
    )
    fulfilled = _run(ws, action["on_completion"]["operation"]["operation"], {
        "worker_result": {
            "job_id": packet["requests"][0]["job_id"],
            "pack": _opening_component_pack(parse_state="partial"),
            "related_packs": [],
            "opening_setup": _opening_setup_unresolved(),
        },
    })
    assert fulfilled["ok"] is True, fulfilled
    prepared = _run(ws, "progressive.prepare_opening")
    assert prepared["ok"] is True, prepared
    assert prepared["data"]["selected_start_pack_ready"] is True
    assert "background_takeover" not in repeated["data"]["host_work"]
    assert len(json.dumps(
        repeated["data"], ensure_ascii=False, separators=(",", ":"),
    ).encode("utf-8")) < 8 * 1024

@pytest.mark.parametrize("job_kind", ["deepen_location", "partial_neighbor"])
@pytest.mark.parametrize(
    ("alias_case", "expected_code"),
    [
        ("name", "pack_semantic_fields_missing"),
        ("clue_id", "invalid_source_worker_pack"),
        ("edge_to", "invalid_param"),
        ("location_id", "invalid_source_worker_pack"),
    ],
)
def test_body_location_fulfill_rejects_finalverify_aliases(
    tmp_path: Path,
    monkeypatch,
    job_kind: str,
    alias_case: str,
    expected_code: str,
):
    ws, job_id, parse_state = _requested_body_location(
        tmp_path,
        monkeypatch,
        job_kind=job_kind,
    )
    pack = _opening_component_pack(
        location_id="cellar",
        title="Cellar",
        parse_state=parse_state,
        source_page_indices=[0, 1, 2],
        player_safe_summary="A bounded source-authored cellar.",
    )
    if alias_case == "name":
        pack["name"] = pack.pop("title")
    elif alias_case == "clue_id":
        pack["clues"] = [{
            "id": "cellar-mark",
            "player_safe_summary": "A chalk mark crosses the wall.",
        }]
    elif alias_case == "edge_to":
        pack["scene_edges"] = [{
            "destination": "hall",
            "edge_type": "open_passage",
        }]
    elif alias_case == "location_id":
        pack["entity_id"] = pack.pop("location_id")

    rejected = _run(ws, "progressive.fulfill_host_work", {
        "job_id": job_id,
        "pack": pack,
        "related_packs": [],
    })

    assert rejected["ok"] is False
    assert rejected["error"]["code"] == expected_code
    assets = coc_toolbox.coc_module_project.coc_module_assets
    stored = assets.get_entity(
        ws["workspace"], ws["asset_root_id"], "location", "cellar",
    )
    assert stored is not None
    assert stored["parse_state"] == "named_only"
    request = next(
        row for row in assets.list_host_work_requests(
            ws["workspace"],
            ws["asset_root_id"],
            include_closed=True,
            limit=None,
        )
        if row["job_id"] == job_id
    )
    assert request["status"] != "fulfilled"

def test_l0_direct_opening_pack_is_equivalent_partial_structure():
    """The pure L0 builder emits the same projection fields a foreground
    partial opening slice would, with read_aloud/keeper_only split by hook
    audience and cache-backed source evidence."""
    project = coc_toolbox.coc_module_project
    l0 = _l0_direct_opening_l0()
    refs = [{
        "source_id": "pdf:opening-component",
        "pdf_index": 0,
        "text_sha256": "a" * 64,
        "bundle_sha256s": ["b" * 64],
    }]
    pack = project.build_l0_direct_opening_pack(
        l0,
        location_id="opening",
        title="Opening",
        source_refs=refs,
        scope_pdf_indices=[0],
    )
    assert set(pack) >= {
        "location_id", "title", "parse_state", "evidence_gap",
        "player_safe_summary", "read_aloud", "keeper_only",
        "source_refs", "source_page_indices", "origin", "provenance",
    }
    assert pack["parse_state"] == "partial"
    assert pack["player_safe_summary"] == "A bounded authored opening."
    assert pack["read_aloud"][0]["trigger"] == "on_enter"
    assert pack["read_aloud"][0]["source_refs"] == refs
    assert pack["read_aloud"][0]["localized_title"] == {"zh-Hans": "开场"}
    assert pack["read_aloud"][0]["localized_text"] == {
        "zh-Hans": "一段有明确边界的原作开场。",
    }
    assert pack["keeper_only"][0]["note"] == "Keeper-only opening note."
    assert pack["source_page_indices"] == [0]

def test_l0_direct_opening_pack_omits_thin_player_hook_read_aloud():
    """A source-only L0 hook is not a boxed passage and is not localized."""
    project = coc_toolbox.coc_module_project
    l0 = _l0_direct_opening_l0(localized=False)
    source_text = l0["opening_hooks"][0]["text"]
    pack = project.build_l0_direct_opening_pack(
        l0,
        location_id="opening",
        title="Opening",
        source_refs=[{
            "source_id": "pdf:opening-component",
            "pdf_index": 0,
            "text_sha256": "a" * 64,
            "bundle_sha256s": ["b" * 64],
        }],
        scope_pdf_indices=[0],
    )
    assert pack["read_aloud"] == []
    assert pack["player_safe_summary"] == source_text
    assert pack["keeper_only"][0]["note"] == "Keeper-only opening note."
    assert pack["parse_state"] == "partial"
    _assert_source_text_not_substituted_as_zh_hans(pack, source_text)

    incomplete = _l0_direct_opening_l0(localized=False)
    incomplete["opening_hooks"][0]["localized_title"] = {"zh-Hans": "开场"}
    incomplete_pack = project.build_l0_direct_opening_pack(
        incomplete,
        location_id="opening",
        title="Opening",
        source_refs=[{
            "source_id": "pdf:opening-component",
            "pdf_index": 0,
            "text_sha256": "a" * 64,
            "bundle_sha256s": ["b" * 64],
        }],
        scope_pdf_indices=[0],
    )
    assert incomplete_pack["read_aloud"] == []
    _assert_source_text_not_substituted_as_zh_hans(incomplete_pack, source_text)

def test_opening_bootstrap_l0_direct_write_falls_back_without_module_init(
    tmp_path: Path, monkeypatch,
):
    """Without a validated module-init L0 the legacy foreground partial_opening
    lane stays available (no behavior regression for non-Pi/host flows)."""
    monkeypatch.setenv("COC_DISABLE_QUEUE_WORKER", "1")
    monkeypatch.setenv("COC_HOST", "pi")
    ws = _opening_component_workspace(tmp_path)
    args = {
        "start_location": {
            "location_id": "opening",
            "title": "Opening",
        },
        "opening_pdf_indices": [0],
    }
    boot = _run(ws, "progressive.opening_bootstrap", args)
    assert boot["ok"] is True, boot
    assert boot["data"]["status"] == "queued"
    assert boot["data"]["source_work"]["job_id"]
    assert (
        boot["data"]["source_work"]["background_takeover"]["next_host_action"]
        ["action"] == "invoke_coc_dispatch_source_work"
    )

def test_opening_setup_source_clock_preserves_relative_precision(
    tmp_path: Path, monkeypatch,
):
    monkeypatch.setenv("COC_DISABLE_QUEUE_WORKER", "1")
    ws = _opening_component_workspace(tmp_path)
    boot = _run(ws, "progressive.opening_bootstrap", {
        "start_location": {
            "location_id": "opening",
            "title": "Opening",
        },
        "opening_pdf_indices": [0],
    })
    assert boot["ok"] is True, boot
    fulfilled = _run(ws, "progressive.fulfill_host_work", {
        "worker_result": {
            "job_id": boot["data"]["source_work"]["job_id"],
            "pack": _opening_component_pack(parse_state="partial"),
            "related_packs": [],
            "opening_setup": {
                "schema_version": 1,
                "contract_id": "coc.opening-setup-observation.v1",
                "status": "source",
                "start_clock": {
                    "calendar_mode": "relative",
                    "local_datetime": None,
                    "local_date": None,
                    "timezone": None,
                    "display": "上午（日期未注明）",
                    "time_precision": "day_phase",
                    "day_phase_hint": "morning",
                },
                "start_clock_source_refs": [{
                    "source_id": ws["skeleton"]["source"]["source_id"],
                    "pdf_index": 0,
                }],
            },
        },
    })
    assert fulfilled["ok"] is True, fulfilled
    assert fulfilled["data"]["opening_setup"]["skeleton_updated"] is True
    time_state = json.loads(
        (
            ws["campaign_dir"] / "save" / "time-state.json"
        ).read_text(encoding="utf-8")
    )
    assert time_state["clock"]["local_datetime"] is None
    assert time_state["clock"]["local_date"] is None
    assert time_state["clock"]["time_precision"] == "day_phase"
    assert time_state["clock"]["day_phase_hint"] == "morning"

def test_opening_bootstrap_watch_conflict_is_byte_preserving(
    tmp_path: Path, monkeypatch,
):
    monkeypatch.setenv("COC_DISABLE_QUEUE_WORKER", "1")
    ws = _opening_component_workspace(tmp_path)
    scenario_path = ws["campaign_dir"] / "scenario" / "scenario.json"
    scenario = json.loads(scenario_path.read_text(encoding="utf-8"))
    scenario["opening_projection_watch"] = {
        "schema_version": 1,
        "campaign_id": ws["campaign_id"],
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "bundle_sha256": scenario["source"]["bundle_sha256"],
        "start_location_id": "different-opening",
        "source_scope": {"different": True},
        "source_scope_signature": "different",
        "created_at": "2026-07-27T00:00:00+00:00",
        "status": "pending",
    }
    _write_json(scenario_path, scenario)
    before = _opening_state_bytes_without_audit(ws["workspace"])

    rejected = _run(ws, "progressive.opening_bootstrap", {
        "start_location": {"location_id": "opening", "title": "Opening"},
        "opening_pdf_indices": [0],
    })

    assert rejected["ok"] is False
    assert rejected["error"]["code"] == "opening_projection_watch_conflict"
    assert _opening_state_bytes_without_audit(ws["workspace"]) == before

def test_skeleton_reprojection_skips_deep_pack_for_different_selected_scope(
    tmp_path: Path, monkeypatch,
):
    """A reusable deep pack must not poison a different L0 page window."""
    monkeypatch.setenv("COC_DISABLE_QUEUE_WORKER", "1")
    ws = _opening_component_workspace(tmp_path, extra_pdf_indices=(1,))
    assets = coc_toolbox.coc_module_project.coc_module_assets
    skeleton = deepcopy(ws["skeleton"])
    skeleton["locations"][0].pop("source_span", None)
    assets.put_skeleton(ws["workspace"], ws["asset_root_id"], skeleton)
    root_info = coc_toolbox.coc_module_project.resolve_opening_preparation_root(
        ws["workspace"], ws["campaign_id"],
    )
    old_scope = assets.validate_opening_source_window(
        ws["workspace"],
        ws["asset_root_id"],
        bundle_sha256=root_info["bundle_sha256"],
        pdf_indices=[0],
    )
    scope = assets.validate_opening_source_window(
        ws["workspace"],
        ws["asset_root_id"],
        bundle_sha256=root_info["bundle_sha256"],
        pdf_indices=[1],
    )
    refs = assets._cached_source_refs(
        ws["workspace"],
        ws["asset_root_id"],
        {"source_refs": list(old_scope["page_refs"])},
        field="test_l0_direct",
    )
    reusable_pack = coc_toolbox.coc_module_project.build_l0_direct_opening_pack(
        {"opening_hooks": [{
            "id": "hook-player",
            "audience": "player",
            "text": "A source-bound opening hook.",
        }]},
        location_id="opening",
        title="Opening",
        source_refs=refs,
        scope_pdf_indices=[0],
    )
    reusable_pack["parse_state"] = "deep"
    assets.put_entity(
        ws["workspace"],
        ws["asset_root_id"],
        "location",
        "opening",
        reusable_pack,
    )

    projected = coc_toolbox.coc_module_project.project_skeleton_to_campaign(
        ws["workspace"],
        ws["campaign_id"],
        ws["asset_root_id"],
        opening_start_location_id="opening",
        opening_source_scope=scope,
    )

    assert projected["scene_count"] == 1
    assert projected["reapplied_deep_entities"] == []

@pytest.mark.parametrize("failed_phase", ["skeleton", "projection", "source_request"])
def test_opening_bootstrap_retries_each_durable_phase(
    tmp_path: Path, monkeypatch, failed_phase: str,
):
    monkeypatch.setenv("COC_DISABLE_QUEUE_WORKER", "1")
    ws = _opening_component_workspace(tmp_path)
    assets_mod = coc_toolbox.coc_module_project.coc_module_assets
    if failed_phase == "skeleton":
        original = assets_mod.put_skeleton
        calls = {"count": 0}

        def fail_once(*args, **kwargs):
            calls["count"] += 1
            if calls["count"] == 1:
                raise assets_mod.ModuleAssetsError("injected skeleton failure")
            return original(*args, **kwargs)

        monkeypatch.setattr(assets_mod, "put_skeleton", fail_once)
    elif failed_phase == "projection":
        original = coc_toolbox.coc_module_project.project_skeleton_to_campaign
        calls = {"count": 0}

        def fail_once(*args, **kwargs):
            calls["count"] += 1
            if calls["count"] == 1:
                raise coc_toolbox.coc_module_project.ModuleProjectError(
                    "injected projection failure"
                )
            return original(*args, **kwargs)

        monkeypatch.setattr(
            coc_toolbox.coc_module_project,
            "project_skeleton_to_campaign",
            fail_once,
        )
    else:
        progressive_module = coc_toolbox.OPERATION_MODULES["progressive-source"]
        original = progressive_module._tool_progressive_request_opening_pack
        calls = {"count": 0}

        def fail_once(*args, **kwargs):
            calls["count"] += 1
            if calls["count"] == 1:
                raise coc_toolbox.ToolError(
                    "injected_source_request_failure",
                    "injected source request failure",
                )
            return original(*args, **kwargs)

        monkeypatch.setattr(
            progressive_module,
            "_tool_progressive_request_opening_pack",
            fail_once,
        )
    args = {
        "start_location": {"location_id": "opening", "title": "Opening"},
        "opening_pdf_indices": [0],
    }
    first = _run(ws, "progressive.opening_bootstrap", args)
    assert first["ok"] is False
    second = _run(ws, "progressive.opening_bootstrap", args)
    assert second["ok"] is True, second
    scenario = json.loads(
        (ws["campaign_dir"] / "scenario" / "scenario.json").read_text(
            encoding="utf-8"
        )
    )
    assert scenario["opening_projection_watch"]["status"] == "pending"

def test_opening_watch_retry_preserves_partial_and_concurrent_scenario_writes(
    tmp_path: Path, monkeypatch,
):
    monkeypatch.setenv("COC_DISABLE_QUEUE_WORKER", "1")
    ws = _opening_component_workspace(tmp_path)
    boot = _run(ws, "progressive.opening_bootstrap", {
        "start_location": {"location_id": "opening", "title": "Opening"},
        "opening_pdf_indices": [0],
    })
    assert boot["ok"] is True, boot
    project_mod = coc_toolbox.coc_module_project
    scenario_path = ws["campaign_dir"] / "scenario" / "scenario.json"

    def partial_write_then_fail(*args, **kwargs):
        scenario = json.loads(scenario_path.read_text(encoding="utf-8"))
        scenario["concurrent_marker"] = "must-survive"
        project_mod._write_json(scenario_path, scenario)
        raise project_mod.ModuleProjectError("injected partial projection")

    monkeypatch.setattr(
        project_mod, "project_skeleton_to_campaign", partial_write_then_fail,
    )
    watch = boot["data"]["projection_watch"]
    outcome = project_mod.drain_opening_projection_watches(
        ws["workspace"],
        ws["asset_root_id"],
        start_location_id="opening",
        source_scope_signature=watch["source_scope_signature"],
    )

    assert outcome[0]["status"] == "retryable_error"
    scenario = json.loads(scenario_path.read_text(encoding="utf-8"))
    assert scenario["concurrent_marker"] == "must-survive"
    assert scenario["opening_projection_watch"]["status"] == "retryable_error"

@pytest.mark.parametrize("clock", [
    {"foo": "bar"},
    {
        "phase": "dusk",
        "precision": "day_phase",
    },
    {
        "calendar_mode": "relative",
        "local_datetime": "1925-01-15T20:00:00",
        "local_date": None,
        "timezone": None,
        "display": "上午（日期未注明）",
        "time_precision": "day_phase",
        "day_phase_hint": "morning",
    },
    {
        "calendar_mode": "gregorian",
        "local_datetime": "1975-10-12T23:15:00",
        "local_date": "1975-10-13",
        "timezone": "America/Chicago",
        "display": "1975-10-12 23:15",
        "time_precision": "minute",
        "day_phase_hint": None,
    },
])
def test_opening_setup_rejects_invalid_clock_before_source_or_campaign_writes(
    tmp_path: Path, monkeypatch, clock: dict,
):
    monkeypatch.setenv("COC_DISABLE_QUEUE_WORKER", "1")
    ws = _opening_component_workspace(tmp_path)
    boot = _run(ws, "progressive.opening_bootstrap", {
        "start_location": {"location_id": "opening", "title": "Opening"},
        "opening_pdf_indices": [0],
    })
    assert boot["ok"] is True, boot
    before = _opening_state_bytes_without_audit(ws["workspace"])
    rejected = _run(ws, "progressive.fulfill_host_work", {
        "worker_result": {
            "job_id": boot["data"]["source_work"]["job_id"],
            "pack": _opening_component_pack(parse_state="partial"),
            "related_packs": [],
            "opening_setup": {
                "schema_version": 1,
                "contract_id": "coc.opening-setup-observation.v1",
                "status": "source",
                "start_clock": clock,
                "start_clock_source_refs": [{
                    "source_id": ws["skeleton"]["source"]["source_id"],
                    "pdf_index": 0,
                }],
            },
        },
    })
    assert rejected["ok"] is False
    assert rejected["error"]["code"] == "opening_setup_invalid"
    assert _opening_state_bytes_without_audit(ws["workspace"]) == before

def test_direct_source_submit_drains_only_exact_campaign_watch(
    tmp_path: Path, monkeypatch,
):
    monkeypatch.setenv("COC_DISABLE_QUEUE_WORKER", "1")
    ws = _opening_component_workspace(tmp_path)
    other_id = "opening-unwatched"
    coc_state.create_campaign(
        ws["workspace"], other_id, "Unwatched", play_language="zh-Hans",
    )
    other_scenario_path = (
        ws["workspace"] / ".coc" / "campaigns" / other_id
        / "scenario" / "scenario.json"
    )
    other_scenario = json.loads(
        (
            ws["campaign_dir"] / "scenario" / "scenario.json"
        ).read_text(encoding="utf-8")
    )
    _write_json(other_scenario_path, other_scenario)
    boot = _run(ws, "progressive.opening_bootstrap", {
        "start_location": {
            "location_id": "opening",
            "title": "Opening",
        },
        "opening_pdf_indices": [0],
    })
    assert boot["ok"] is True, boot
    claimed = coc_toolbox.coc_module_project.coc_module_assets.claim_host_work_requests(
        ws["workspace"],
        ws["asset_root_id"],
        executor_id="direct-watch-test",
        result_delivery="named_submit",
    )
    packet = claimed["packets"][0]
    receipt = coc_toolbox.submit_source_worker_result(
        ws["workspace"],
        {
            "schema_version": 1,
            "contract_id": "coc.source-pack-worker.v1",
            "packet_id": packet["packet_id"],
            "work_group_id": packet["work_group_id"],
            "status": "usable",
            "results": [{
                "job_id": packet["requests"][0]["job_id"],
                "pack": _opening_component_pack(parse_state="partial"),
                "related_packs": [],
                "opening_setup": _opening_setup_unresolved(),
            }],
        },
    )
    assert receipt["ok"] is True, receipt
    watched = json.loads(
        (
            ws["campaign_dir"] / "scenario" / "scenario.json"
        ).read_text(encoding="utf-8")
    )
    assert watched["opening_projection_watch"]["status"] == "complete"
    untouched = json.loads(other_scenario_path.read_text(encoding="utf-8"))
    assert "opening_projection_watch" not in untouched
    assert "opening_projection_receipt" not in untouched

def test_opening_watch_refuses_non_pristine_without_rolling_back_pack(
    tmp_path: Path, monkeypatch,
):
    monkeypatch.setenv("COC_DISABLE_QUEUE_WORKER", "1")
    ws = _opening_component_workspace(tmp_path)
    boot = _run(ws, "progressive.opening_bootstrap", {
        "start_location": {
            "location_id": "opening",
            "title": "Opening",
        },
        "opening_pdf_indices": [0],
    })
    assert boot["ok"] is True, boot
    world_path = ws["campaign_dir"] / "save" / "world-state.json"
    world = json.loads(world_path.read_text(encoding="utf-8"))
    world["active_scene_id"] = "already-playing"
    _write_json(world_path, world)
    fulfilled = _run(ws, "progressive.fulfill_host_work", {
        "worker_result": {
            "job_id": boot["data"]["source_work"]["job_id"],
            "pack": _opening_component_pack(parse_state="partial"),
            "related_packs": [],
            "opening_setup": _opening_setup_unresolved(),
        },
    })
    assert fulfilled["ok"] is True, fulfilled
    assert fulfilled["data"]["request_status"] == "fulfilled"
    assert fulfilled["data"]["automatic_projection"][0]["status"] == (
        "refused_terminal"
    )
    stored_pack = coc_toolbox.coc_module_project.coc_module_assets.get_entity(
        ws["workspace"], ws["asset_root_id"], "location", "opening",
    )
    assert stored_pack["parse_state"] == "partial"

def test_opening_setup_rejects_clock_ref_outside_exact_window_before_writes(
    tmp_path: Path, monkeypatch,
):
    monkeypatch.setenv("COC_DISABLE_QUEUE_WORKER", "1")
    ws = _opening_component_workspace(tmp_path, extra_pdf_indices=(1,))
    boot = _run(ws, "progressive.opening_bootstrap", {
        "start_location": {
            "location_id": "opening",
            "title": "Opening",
        },
        "opening_pdf_indices": [0],
    })
    assert boot["ok"] is True, boot
    rejected = _run(ws, "progressive.fulfill_host_work", {
        "worker_result": {
            "job_id": boot["data"]["source_work"]["job_id"],
            "pack": _opening_component_pack(parse_state="partial"),
            "related_packs": [],
            "opening_setup": {
                "schema_version": 1,
                "contract_id": "coc.opening-setup-observation.v1",
                "status": "source",
                "start_clock": {
                    "calendar_mode": "relative",
                    "local_datetime": None,
                    "local_date": None,
                    "timezone": None,
                    "display": "Morning",
                    "time_precision": "day_phase",
                    "day_phase_hint": "morning",
                },
                "start_clock_source_refs": [{
                    "source_id": ws["skeleton"]["source"]["source_id"],
                    "pdf_index": 1,
                }],
            },
        },
    })
    assert rejected["ok"] is False
    assert rejected["error"]["code"] == "opening_setup_invalid"
    skeleton = coc_toolbox.coc_module_project.coc_module_assets.get_skeleton(
        ws["workspace"], ws["asset_root_id"],
    )
    assert skeleton["start_clock_status"] == "unresolved"
    pack = coc_toolbox.coc_module_project.coc_module_assets.get_entity(
        ws["workspace"], ws["asset_root_id"], "location", "opening",
    )
    assert pack["parse_state"] == "named_only"

def test_pi_facts_adoption_and_rebind_share_one_source_lock(
    tmp_path: Path, monkeypatch,
):
    ws = _opening_component_workspace(tmp_path)
    scenario_path, facts = _stage_reviewed_facts_transport(ws)
    entered = Event()
    release = Event()
    original = coc_toolbox.coc_runtime_ops._canonicalize_opening_fast_facts
    blocked_once = False

    def blocking_canonicalize(*args, **kwargs):
        nonlocal blocked_once
        result = original(*args, **kwargs)
        if not blocked_once:
            blocked_once = True
            entered.set()
            assert release.wait(timeout=5)
        return result

    monkeypatch.setattr(
        coc_toolbox.coc_runtime_ops,
        "_canonicalize_opening_fast_facts",
        blocking_canonicalize,
    )
    adopt_operation = {
        "schema_version": 1,
        "kind": "campaign.adopt_source_facts",
        "payload": {"campaign_id": ws["campaign_id"], "facts": facts},
    }
    bind_operation = {
        "schema_version": 1,
        "kind": "scenario.bind_pdf",
        "payload": {
            "campaign_id": ws["campaign_id"],
            "scenario_id": ws["asset_root_id"],
            "title": "Opening Component",
            "source_bundle_path": str(ws["workspace"] / "opening-source"),
            "compile_now": False,
        },
    }
    with ThreadPoolExecutor(max_workers=2) as pool:
        adopting = pool.submit(
            coc_toolbox.coc_runtime_ops.execute_setup_operation,
            ws["workspace"], operation=adopt_operation,
        )
        assert entered.wait(timeout=5)
        rebinding = pool.submit(
            coc_toolbox.coc_runtime_ops.execute_setup_operation,
            ws["workspace"], operation=bind_operation,
        )
        time.sleep(0.05)
        assert not rebinding.done()
        release.set()
        assert adopting.result(timeout=5)["status"] == "PASS"
        assert rebinding.result(timeout=5)["status"] == "PASS"

    campaign = json.loads(
        (ws["campaign_dir"] / "campaign.json").read_text(encoding="utf-8")
    )
    rebound = json.loads(scenario_path.read_text(encoding="utf-8"))
    assert "source_fast_facts" not in campaign
    assert campaign["era_source"] == "unestablished"
    assert "opening_source_facts_transport" not in rebound
    assert rebound["opening_source_review_task"]["status"] == "pending"

def test_pi_reviewed_bind_identity_survives_bootstrap_and_exact_claim(
    tmp_path: Path,
    monkeypatch,
):
    monkeypatch.setenv("COC_DISABLE_QUEUE_WORKER", "1")
    monkeypatch.setenv("COC_HOST", "pi")
    ws = _opening_component_workspace(
        tmp_path,
        source_id="pdf:raw-upload-identity",
        source_title="Raw Upload Title",
        canonical_title="Canonical Reviewed Scenario",
    )
    scenario_path = ws["campaign_dir"] / "scenario" / "scenario.json"
    scenario = json.loads(scenario_path.read_text(encoding="utf-8"))
    scenario.update({
        "scenario_id": ws["asset_root_id"],
        "title": "Canonical Reviewed Scenario",
        "opening_source_provenance": "selection_hint_only_not_provenance",
    })
    scenario["source"]["source_bundle_path"] = str(
        ws["workspace"] / "opening-source"
    )
    _install_opening_review_task(ws, scenario)
    _write_json(scenario_path, scenario)
    campaign_path = ws["campaign_dir"] / "campaign.json"
    campaign = json.loads(campaign_path.read_text(encoding="utf-8"))
    campaign["active_scenario_id"] = ws["asset_root_id"]
    _write_json(campaign_path, campaign)
    continuation = {
        "schema_version": 1,
        "contract_id": "coc.opening-source-continue.v1",
        "campaign_id": ws["campaign_id"],
        "scenario_id": ws["asset_root_id"],
        "selected_opening_pdf_indices": [0],
        "source_bundle_id": ws["asset_root_id"],
        "source_bundle_path": scenario["source"]["source_bundle_path"],
        "result_delivery": "task_return_to_parent",
    }
    review_receipt = (
        coc_toolbox.coc_runtime_ops
        ._build_opening_source_review_fulfillment(
            ws["workspace"],
            continuation=continuation,
            status="reviewed",
            selected_opening_pdf_indices=[0],
        )
    )
    coc_toolbox.coc_runtime_ops._apply_opening_source_review_fulfillment(
        ws["workspace"], review_receipt,
    )
    reviewed_before = json.loads(
        scenario_path.read_text(encoding="utf-8")
    )

    bootstrap = _run(ws, "progressive.opening_bootstrap", {
        "start_location": {
            "location_id": "opening",
            "title": "Opening",
        },
        "opening_pdf_indices": [0],
    })

    assert bootstrap["ok"] is True, bootstrap
    projected = json.loads(scenario_path.read_text(encoding="utf-8"))
    assert projected["scenario_id"] == ws["asset_root_id"]
    assert projected["title"] == "Canonical Reviewed Scenario"
    assert projected["opening_source_review_task"] == (
        reviewed_before["opening_source_review_task"]
    )
    assert projected["opening_source_review_receipt"] == (
        reviewed_before["opening_source_review_receipt"]
    )
    assert projected["opening_source_provenance"] == (
        "coordinator_reviewed_playable_opening"
    )
    assert json.loads(campaign_path.read_text(encoding="utf-8"))[
        "active_scenario_id"
    ] == ws["asset_root_id"]
    assert bootstrap["data"]["sparse_projection"]["asset_root_id"] == (
        ws["asset_root_id"]
    )
    module_meta = json.loads(
        (
            ws["campaign_dir"] / "scenario" / "module-meta.json"
        ).read_text(encoding="utf-8")
    )
    assert module_meta["scenario_id"] == ws["asset_root_id"]
    assert module_meta["title"] == "Canonical Reviewed Scenario"

    claim = (
        bootstrap["data"]["source_work"]["background_takeover"]
        ["next_host_action"]["task"]["packet"]["claim_operation"]
        ["prefilled_arguments"]
    )
    claimed = _run(ws, "progressive.claim_host_work", claim)
    assert claimed["ok"] is True, claimed
    assert claimed["data"]["dispatch_task_count"] == 1
    assert claimed["data"]["dispatch_tasks"][0]["packet"][
        "asset_root_id"
    ] == ws["asset_root_id"]

def test_pi_opening_review_adapter_one_shot_validates_and_fulfills_exact_new_task(
    tmp_path: Path, monkeypatch,
):
    ws, request, scenario_path = _pi_opening_review_adapter_fixture(tmp_path)
    adapter = _load(
        "coc_pdf_skill_adapter_opening_one_shot_test",
        REPO / "plugins/coc-keeper/pi/bin/coc-pdf-skill-adapter.py",
    )
    monkeypatch.setattr(
        adapter, "_validate_opening_review_transport", lambda value: value,
    )
    captured: dict = {}
    cached_path = (
        ws["workspace"] / ".coc" / "module-assets" / ws["asset_root_id"]
        / "pages" / "0000.md"
    )
    cached_before = cached_path.read_bytes()
    expected_bundle_sha256 = json.loads(
        scenario_path.read_text(encoding="utf-8")
    )["source"]["bundle_sha256"]

    # Materialization now preseeds every bound page and leaves the window
    # to the extractor. Only the text extractor is mocked, so the full
    # bind/fulfill seam stays real.
    monkeypatch.delenv("COC_PI_PDF_INSPECTOR_COMMAND", raising=False)

    def fake_extractor(
        task_arg: dict, materialized: dict, *, timeout: int, shutdown=None,
    ) -> dict:
        assert timeout == adapter.PI_TIMEOUT_SECONDS
        assert "challenge" not in json.dumps(task_arg)
        task = task_arg
        manifest_contract = json.loads(
            (
                REPO / "plugins/coc-keeper/references"
                / "opening-source-coordinator-v1.json"
            ).read_text(encoding="utf-8")
        )["source_bundle_manifest_contract"]
        assert task["source_bundle_manifest_contract"] == manifest_contract
        template = task["source_bundle_manifest_contract"]["template"]
        assert set(template) == {
            "schema_version", "producer", "source", "pages", "assets",
        }
        assert template["producer"] == "codex-pdf-skill"
        assert set(template["source"]) == {
            "source_id", "title", "path", "file_sha256", "page_count",
        }
        assert set(template["pages"][0]) == {
            "pdf_index", "markdown_path", "text_sha256", "review_state",
            "parse_confidence", "grep_anchors",
        }
        assert task["source_bundle_manifest_contract"][
            "forbidden_shortcut_fields"
        ] == ["source_bundle_id", "pdf_sha256", "pages[].path"]
        reusable = task["reusable_bound_source"]
        assert reusable["source_bundle_path"] == str(
            ws["workspace"] / "opening-source"
        )
        assert reusable["bundle_sha256"] == expected_bundle_sha256
        assert [row["pdf_index"] for row in reusable["manifest"]["pages"]] == [0]
        captured.update({"task": task, "calls": 1})
        output = Path(task["source_bundle_path"])
        assert output != ws["workspace"] / "opening-source"
        assert output.is_relative_to(
            ws["workspace"] / ".tmp" / "coc-opening-source-review"
            / ws["campaign_id"]
        )
        preseeded = json.loads(
            (output / "manifest.json").read_text(encoding="utf-8")
        )
        assert preseeded == reusable["manifest"]
        relative = Path(preseeded["pages"][0]["markdown_path"])
        assert (output / relative).read_bytes() == cached_before
        assert materialized["selected_opening_pdf_indices"] == []
        assert materialized["fact_evidence_pdf_indices"] == [0]
        assert materialized["source"] == "preseed"
        return {
            "schema_version": 1,
            "contract_id": "coc.pi-opening-text-extractor-result.v1",
            "status": "reviewed",
            "campaign_id": task["campaign_id"],
            "scenario_id": task["scenario_id"],
            "source_bundle_path": task["source_bundle_path"],
            "failure_class": None,
            "facts": _pi_opening_adapter_facts(
                task["source"]["source_id"], [0],
            ),
            "module_init_l0": _pi_opening_adapter_l0(),
            "selected_opening_pdf_indices": [0],
            "fact_evidence_pdf_indices": [0],
        }

    monkeypatch.setattr(
        adapter, "_run_opening_text_extractor", fake_extractor,
    )

    class AdapterInput:
        def __init__(self):
            self.buffer = io.BytesIO(json.dumps(request).encode())

    monkeypatch.setattr(adapter.sys, "stdin", AdapterInput())
    real_runtime_modules = adapter._runtime_modules
    captured_operations: list[dict] = []

    def capturing_runtime_modules():
        fileio, pdf_bundle, ops, assets = real_runtime_modules()
        real_execute = ops.execute_setup_operation

        def capturing_execute(workspace, *, operation):
            captured_operations.append(json.loads(json.dumps(operation)))
            return real_execute(workspace, operation=operation)

        monkeypatch.setattr(ops, "execute_setup_operation", capturing_execute)
        return fileio, pdf_bundle, ops, assets

    monkeypatch.setattr(adapter, "_runtime_modules", capturing_runtime_modules)
    receipt = adapter._run_opening_review()
    bind_operation = next(
        operation for operation in captured_operations
        if operation["kind"] == "scenario.bind_pdf"
    )
    # The transport rebind runs the canonical bind on the review lane so
    # pages the whole-book OCR lane cached first (cross-producer) are bound
    # by content address instead of failing as text drift.
    assert bind_operation["payload"]["reference_cached_pages"] is True
    assert receipt == {
        "schema_version": 1,
        "contract_id": "coc.pi-opening-source-review-transport-result.v1",
        "status": "reviewed",
        "campaign_id": ws["campaign_id"],
        "scenario_id": ws["asset_root_id"],
        "opening_review_generation": 2,
        "failure_class": None,
        "facts": _pi_opening_adapter_facts(
            captured["task"]["source"]["source_id"], [0],
        ),
    }
    assert captured["calls"] == 1
    assert "challenge" not in json.dumps(captured["task"])
    assert captured["task"]["source_bundle_path"] != (
        str(ws["workspace"] / "opening-source")
    )
    assert cached_path.read_bytes() == cached_before
    output = Path(captured["task"]["source_bundle_path"])
    output_manifest = json.loads(
        (output / "manifest.json").read_text(encoding="utf-8")
    )
    assert (
        output / output_manifest["pages"][0]["markdown_path"]
    ).read_bytes() == cached_before
    consumed = json.loads(scenario_path.read_text(encoding="utf-8"))
    assert consumed["opening_source_review_task"]["generation"] == 2
    assert consumed["opening_source_review_task"]["status"] == "fulfilled"
    assert consumed["opening_source_review_receipt"][
        "opening_review_generation"
    ] == 2
    assert consumed["opening_source_provenance"] == (
        "coordinator_reviewed_playable_opening"
    )

def test_pi_opening_review_adapter_mixes_reused_and_new_contiguous_pages(
    tmp_path: Path, monkeypatch,
):
    ws, request, scenario_path = _pi_opening_review_adapter_fixture(
        tmp_path, source_page_count=2,
    )
    adapter = _load(
        "coc_pdf_skill_adapter_opening_mixed_reuse_test",
        REPO / "plugins/coc-keeper/pi/bin/coc-pdf-skill-adapter.py",
    )
    monkeypatch.setattr(
        adapter, "_validate_opening_review_transport", lambda value: value,
    )
    cached_path = (
        ws["workspace"] / ".coc" / "module-assets" / ws["asset_root_id"]
        / "pages" / "0000.md"
    )
    cached_before = cached_path.read_bytes()

    # Materialization owns the page split now: the router lane mixes the
    # retained page 0 with a new adjacent page 1 it adds to the bundle.
    def fake_materialize(
        task_arg: dict, private: dict, pdf_bundle, request: dict, shutdown,
    ) -> dict:
        output = Path(task_arg["source_bundle_path"])
        manifest_path = output / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        assert [row["pdf_index"] for row in manifest["pages"]] == [0]
        reused = manifest["pages"][0]
        assert (output / reused["markdown_path"]).read_bytes() == cached_before
        new_bytes = b"# Opening continuation\n\nA new adjacent page.\n"
        new_relative = "page-0001.md"
        (output / new_relative).write_bytes(new_bytes)
        manifest["pages"].append({
            "pdf_index": 1,
            "markdown_path": new_relative,
            "text_sha256": hashlib.sha256(new_bytes).hexdigest(),
            "review_state": "manual_accepted",
            "parse_confidence": 0.98,
            "grep_anchors": ["A new adjacent page."],
        })
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        return {
            "selected_opening_pdf_indices": [0, 1],
            "fact_evidence_pdf_indices": [0, 1],
            "bundle": None,
            "source": "preseed",
        }

    def fake_extractor(
        task_arg: dict, materialized: dict, *, timeout: int, shutdown=None,
    ) -> dict:
        assert timeout == adapter.PI_TIMEOUT_SECONDS
        assert materialized["selected_opening_pdf_indices"] == [0, 1]
        assert materialized["fact_evidence_pdf_indices"] == [0, 1]
        return {
            "schema_version": 1,
            "contract_id": "coc.pi-opening-text-extractor-result.v1",
            "status": "reviewed",
            "campaign_id": task_arg["campaign_id"],
            "scenario_id": task_arg["scenario_id"],
            "source_bundle_path": task_arg["source_bundle_path"],
            "failure_class": None,
            "facts": _pi_opening_adapter_facts(
                task_arg["source"]["source_id"], [1],
            ),
            "module_init_l0": _pi_opening_adapter_l0(),
            "selected_opening_pdf_indices": [0, 1],
            "fact_evidence_pdf_indices": [1],
        }

    monkeypatch.setattr(adapter, "_materialize_opening_bundle", fake_materialize)
    monkeypatch.setattr(
        adapter, "_run_opening_text_extractor", fake_extractor,
    )

    class AdapterInput:
        def __init__(self):
            self.buffer = io.BytesIO(json.dumps(request).encode())

    monkeypatch.setattr(adapter.sys, "stdin", AdapterInput())
    receipt = adapter._run_opening_review()
    assert receipt["status"] == "reviewed"
    assert receipt["opening_review_generation"] == 2
    assert cached_path.read_bytes() == cached_before
    new_cached = (
        ws["workspace"] / ".coc" / "module-assets" / ws["asset_root_id"]
        / "pages" / "0001.md"
    )
    assert new_cached.read_bytes() == (
        b"# Opening continuation\n\nA new adjacent page.\n"
    )
    consumed = json.loads(scenario_path.read_text(encoding="utf-8"))
    assert consumed["opening_source_review_task"]["status"] == "fulfilled"
    assert consumed["opening_source_review_receipt"]["source_scope"][
        "pdf_indices"
    ] == [0, 1]

def test_pi_opening_review_adapter_rejects_changed_reused_page(
    tmp_path: Path, monkeypatch,
):
    ws, request, scenario_path = _pi_opening_review_adapter_fixture(tmp_path)
    adapter = _load(
        "coc_pdf_skill_adapter_opening_reuse_drift_test",
        REPO / "plugins/coc-keeper/pi/bin/coc-pdf-skill-adapter.py",
    )
    monkeypatch.setattr(
        adapter, "_validate_opening_review_transport", lambda value: value,
    )
    cached_path = (
        ws["workspace"] / ".coc" / "module-assets" / ws["asset_root_id"]
        / "pages" / "0000.md"
    )
    cached_before = cached_path.read_bytes()

    # The materializer (router lane) rewrites the retained page's bytes; the
    # splice seam must reject the edit before any receipt is authored.
    def fake_materialize(
        task_arg: dict, private: dict, pdf_bundle, request: dict, shutdown,
    ) -> dict:
        output = Path(task_arg["source_bundle_path"])
        manifest_path = output / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        page = manifest["pages"][0]
        changed = b"# Opening\n\nA changed retranscription.\n"
        (output / page["markdown_path"]).write_bytes(changed)
        page["text_sha256"] = hashlib.sha256(changed).hexdigest()
        page["grep_anchors"] = ["A changed retranscription."]
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        return {
            "selected_opening_pdf_indices": [0],
            "fact_evidence_pdf_indices": [0],
            "bundle": None,
            "source": "router",
        }

    def fake_extractor(
        task_arg: dict, materialized: dict, *, timeout: int, shutdown=None,
    ) -> dict:
        assert timeout == adapter.PI_TIMEOUT_SECONDS
        assert materialized["selected_opening_pdf_indices"] == [0]
        return {
            "schema_version": 1,
            "contract_id": "coc.pi-opening-text-extractor-result.v1",
            "status": "reviewed",
            "campaign_id": task_arg["campaign_id"],
            "scenario_id": task_arg["scenario_id"],
            "source_bundle_path": task_arg["source_bundle_path"],
            "failure_class": None,
            "facts": _pi_opening_adapter_facts(
                task_arg["source"]["source_id"], [0],
            ),
            "module_init_l0": _pi_opening_adapter_l0(),
        }

    monkeypatch.setattr(adapter, "_materialize_opening_bundle", fake_materialize)
    monkeypatch.setattr(
        adapter, "_run_opening_text_extractor", fake_extractor,
    )

    class AdapterInput:
        def __init__(self):
            self.buffer = io.BytesIO(json.dumps(request).encode())

    monkeypatch.setattr(adapter.sys, "stdin", AdapterInput())
    with pytest.raises(RuntimeError, match="reusable bound page 0 was modified"):
        adapter._run_opening_review()
    assert cached_path.read_bytes() == cached_before
    current = json.loads(scenario_path.read_text(encoding="utf-8"))
    assert current["opening_source_review_task"]["generation"] == 1
    assert current["opening_source_review_task"]["status"] == "pending"
    assert "opening_source_review_receipt" not in current

def test_pi_opening_review_adapter_splices_an_equivalent_raw_page_row_rewrite(
    tmp_path: Path, monkeypatch,
):
    """A producer cannot be required to echo bytes it must not change.

    Re-serializing the retained page-0 row (here a cosmetically equivalent
    './page-0000.md') used to fail the whole opening review as drift. The
    repository owns those rows now: it splices the retained one back over
    whatever the producer wrote, and the review proceeds.
    """
    ws, request, scenario_path = _pi_opening_review_adapter_fixture(tmp_path)
    adapter = _load(
        "coc_pdf_skill_adapter_opening_raw_row_splice_test",
        REPO / "plugins/coc-keeper/pi/bin/coc-pdf-skill-adapter.py",
    )
    monkeypatch.setattr(
        adapter, "_validate_opening_review_transport", lambda value: value,
    )
    cached_path = (
        ws["workspace"] / ".coc" / "module-assets" / ws["asset_root_id"]
        / "pages" / "0000.md"
    )
    cached_before = cached_path.read_bytes()
    captured: dict = {}

    # The materializer echoes a cosmetically equivalent page-0 row; the
    # splice seam must author the retained row back over it.
    def fake_materialize(
        task_arg: dict, private: dict, pdf_bundle, request: dict, shutdown,
    ) -> dict:
        captured.update({"task": task_arg})
        manifest_path = Path(task_arg["source_bundle_path"]) / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        assert manifest["pages"][0]["markdown_path"] == "page-0000.md"
        manifest["pages"][0] = {
            "pdf_index": 0,
            "markdown_path": "./page-0000.md",
            "text_sha256": manifest["pages"][0]["text_sha256"],
            "review_state": manifest["pages"][0]["review_state"],
            "parse_confidence": 0.5,
            "grep_anchors": list(
                reversed(manifest["pages"][0]["grep_anchors"])
            ),
            "assets": [],
        }
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        captured.update({"echoed": manifest["pages"][0]})
        return {
            "selected_opening_pdf_indices": [0],
            "fact_evidence_pdf_indices": [0],
            "bundle": None,
            "source": "router",
        }

    def fake_extractor(
        task_arg: dict, materialized: dict, *, timeout: int, shutdown=None,
    ) -> dict:
        assert timeout == adapter.PI_TIMEOUT_SECONDS
        return {
            "schema_version": 1,
            "contract_id": "coc.pi-opening-text-extractor-result.v1",
            "status": "reviewed",
            "campaign_id": task_arg["campaign_id"],
            "scenario_id": task_arg["scenario_id"],
            "source_bundle_path": task_arg["source_bundle_path"],
            "failure_class": None,
            "facts": _pi_opening_adapter_facts(
                task_arg["source"]["source_id"], [0],
            ),
            "module_init_l0": _pi_opening_adapter_l0(),
        }

    monkeypatch.setattr(adapter, "_materialize_opening_bundle", fake_materialize)
    monkeypatch.setattr(
        adapter, "_run_opening_text_extractor", fake_extractor,
    )

    class AdapterInput:
        def __init__(self):
            self.buffer = io.BytesIO(json.dumps(request).encode())

    monkeypatch.setattr(adapter.sys, "stdin", AdapterInput())
    receipt = adapter._run_opening_review()
    assert receipt["status"] == "reviewed"
    assert cached_path.read_bytes() == cached_before
    final_manifest = json.loads(
        (
            Path(captured["task"]["source_bundle_path"]) / "manifest.json"
        ).read_text(encoding="utf-8")
    )
    retained_row = captured["task"][
        "reusable_bound_source"
    ]["manifest"]["pages"][0]
    assert final_manifest["pages"] == [retained_row]
    assert final_manifest["pages"][0] != captured["echoed"]
    current = json.loads(scenario_path.read_text(encoding="utf-8"))
    assert current["opening_source_review_task"]["status"] == "fulfilled"

def test_pi_opening_review_adapter_accepts_untouched_normalized_raw_page_row(
    tmp_path: Path, monkeypatch,
):
    ws, request, scenario_path = _pi_opening_review_adapter_fixture(tmp_path)
    retained_manifest_path = ws["workspace"] / "opening-source" / "manifest.json"
    retained_manifest = json.loads(
        retained_manifest_path.read_text(encoding="utf-8")
    )
    retained_manifest["pages"][0]["markdown_path"] = "./page-0000.md"
    retained_manifest_path.write_text(
        json.dumps(retained_manifest), encoding="utf-8",
    )
    adapter = _load(
        "coc_pdf_skill_adapter_opening_raw_row_untouched_test",
        REPO / "plugins/coc-keeper/pi/bin/coc-pdf-skill-adapter.py",
    )
    monkeypatch.setattr(
        adapter, "_validate_opening_review_transport", lambda value: value,
    )
    cached_path = (
        ws["workspace"] / ".coc" / "module-assets" / ws["asset_root_id"]
        / "pages" / "0000.md"
    )
    cached_before = cached_path.read_bytes()
    # The retained bundle itself is already normalized; the preseed lane
    # keeps that spelling through materialize, splice, and the final bundle.
    monkeypatch.delenv("COC_PI_PDF_INSPECTOR_COMMAND", raising=False)
    captured: dict = {}

    def fake_extractor(
        task_arg: dict, materialized: dict, *, timeout: int, shutdown=None,
    ) -> dict:
        assert timeout == adapter.PI_TIMEOUT_SECONDS
        output_manifest = json.loads(
            (
                Path(task_arg["source_bundle_path"]) / "manifest.json"
            ).read_text(encoding="utf-8")
        )
        assert output_manifest["pages"][0]["markdown_path"] == (
            "./page-0000.md"
        )
        captured.update(task_arg)
        return {
            "schema_version": 1,
            "contract_id": "coc.pi-opening-text-extractor-result.v1",
            "status": "reviewed",
            "campaign_id": task_arg["campaign_id"],
            "scenario_id": task_arg["scenario_id"],
            "source_bundle_path": task_arg["source_bundle_path"],
            "failure_class": None,
            "facts": _pi_opening_adapter_facts(
                task_arg["source"]["source_id"], [0],
            ),
            "module_init_l0": _pi_opening_adapter_l0(),
            "selected_opening_pdf_indices": [0],
            "fact_evidence_pdf_indices": [0],
        }

    monkeypatch.setattr(
        adapter, "_run_opening_text_extractor", fake_extractor,
    )

    class AdapterInput:
        def __init__(self):
            self.buffer = io.BytesIO(json.dumps(request).encode())

    monkeypatch.setattr(adapter.sys, "stdin", AdapterInput())
    receipt = adapter._run_opening_review()
    assert receipt["status"] == "reviewed"
    assert receipt["opening_review_generation"] == 2
    assert cached_path.read_bytes() == cached_before
    output_manifest = json.loads(
        (
            Path(captured["source_bundle_path"]) / "manifest.json"
        ).read_text(encoding="utf-8")
    )
    assert output_manifest["pages"][0]["markdown_path"] == "./page-0000.md"
    consumed = json.loads(scenario_path.read_text(encoding="utf-8"))
    assert consumed["opening_source_review_task"]["status"] == "fulfilled"

def test_pi_opening_review_adapter_rejects_legacy_shortcut_bundle(
    tmp_path: Path, monkeypatch,
):
    ws, request, scenario_path = _pi_opening_review_adapter_fixture(tmp_path)
    adapter = _load(
        "coc_pdf_skill_adapter_opening_legacy_bundle_test",
        REPO / "plugins/coc-keeper/pi/bin/coc-pdf-skill-adapter.py",
    )
    monkeypatch.setattr(
        adapter, "_validate_opening_review_transport", lambda value: value,
    )

    # The materializer writes a legacy shortcut manifest over the preseed;
    # the post-splice host-bundle validation must reject it.
    def fake_materialize(
        task_arg: dict, private: dict, pdf_bundle, request: dict, shutdown,
    ) -> dict:
        output = Path(task_arg["source_bundle_path"])
        page = b"# Legacy shortcut\n\nThis shape is unsupported.\n"
        # A retained preseed file is read-only; write the legacy page beside
        # it so this test exercises the legacy manifest shape, not the
        # separate retained-page-was-modified failure.
        (output / "legacy-0000.md").write_bytes(page)
        (output / "manifest.json").write_text(json.dumps({
            "schema_version": 1,
            "contract_id": "coc.codex-pdf-skill-bundle.v1",
            "source": {
                "source_id": task_arg["source"]["source_id"],
                "title": task_arg["title"],
                "path": task_arg["source"]["path"],
                "file_sha256": task_arg["source"]["file_sha256"],
            },
            "pages": [{
                "pdf_index": 0,
                "markdown_file": "legacy-0000.md",
                "file_sha256": hashlib.sha256(page).hexdigest(),
                "confidence": 0.99,
            }],
        }), encoding="utf-8")
        return {
            "selected_opening_pdf_indices": [0],
            "fact_evidence_pdf_indices": [0],
            "bundle": None,
            "source": "router",
        }

    def fake_extractor(
        task_arg: dict, materialized: dict, *, timeout: int, shutdown=None,
    ) -> dict:
        assert timeout == adapter.PI_TIMEOUT_SECONDS
        return {
            "schema_version": 1,
            "contract_id": "coc.pi-opening-text-extractor-result.v1",
            "status": "reviewed",
            "campaign_id": task_arg["campaign_id"],
            "scenario_id": task_arg["scenario_id"],
            "source_bundle_path": task_arg["source_bundle_path"],
            "failure_class": None,
            "facts": _pi_opening_adapter_facts(
                task_arg["source"]["source_id"], [0],
            ),
            "module_init_l0": _pi_opening_adapter_l0(),
        }

    monkeypatch.setattr(adapter, "_materialize_opening_bundle", fake_materialize)
    monkeypatch.setattr(
        adapter, "_run_opening_text_extractor", fake_extractor,
    )

    class AdapterInput:
        def __init__(self):
            self.buffer = io.BytesIO(json.dumps(request).encode())

    monkeypatch.setattr(adapter.sys, "stdin", AdapterInput())
    with pytest.raises(ValueError, match="manifest.producer"):
        adapter._run_opening_review()
    current = json.loads(scenario_path.read_text(encoding="utf-8"))
    assert current["opening_source_review_task"]["generation"] == 1
    assert current["opening_source_review_task"]["status"] == "pending"
    assert "opening_source_review_receipt" not in current

def test_pi_opening_review_adapter_failed_producer_does_not_forge_fulfillment(
    tmp_path: Path, monkeypatch,
):
    ws, request, scenario_path = _pi_opening_review_adapter_fixture(tmp_path)
    adapter = _load(
        "coc_pdf_skill_adapter_opening_failure_test",
        REPO / "plugins/coc-keeper/pi/bin/coc-pdf-skill-adapter.py",
    )
    monkeypatch.setattr(
        adapter, "_validate_opening_review_transport", lambda value: value,
    )
    # The preseed materialization lane is deterministic; the extractor
    # reports a failed review that must never forge a fulfillment receipt.
    monkeypatch.delenv("COC_PI_PDF_INSPECTOR_COMMAND", raising=False)
    calls = []

    def fake_extractor(
        task_arg: dict, materialized: dict, *, timeout: int, shutdown=None,
    ) -> dict:
        calls.append((task_arg, timeout))
        return {
            "schema_version": 1,
            "contract_id": "coc.pi-opening-text-extractor-result.v1",
            "status": "failed",
            "campaign_id": task_arg["campaign_id"],
            "scenario_id": task_arg["scenario_id"],
            "source_bundle_path": None,
            "failure_class": "pdf_scope_failed",
            "facts": None,
            "module_init_l0": None,
        }

    monkeypatch.setattr(
        adapter, "_run_opening_text_extractor", fake_extractor,
    )

    class AdapterInput:
        def __init__(self):
            self.buffer = io.BytesIO(json.dumps(request).encode())

    monkeypatch.setattr(adapter.sys, "stdin", AdapterInput())
    receipt = adapter._run_opening_review()
    assert receipt["status"] == "failed"
    assert receipt["opening_review_generation"] == 1
    assert receipt["failure_class"] == "pdf_scope_failed"
    assert len(calls) == 1
    current = json.loads(scenario_path.read_text(encoding="utf-8"))
    assert current["opening_source_review_task"]["generation"] == 1
    assert current["opening_source_review_task"]["status"] == "pending"
    assert "opening_source_review_receipt" not in current

def test_prepare_opening_is_strict_read_only_and_skips_recovery(
    tmp_path: Path, monkeypatch,
):
    ws = _opening_component_workspace(tmp_path)
    spec = coc_toolbox.TOOLS["progressive.prepare_opening"]
    assert spec["access"] == "query"
    assert spec["write_domains"] == ()
    assert spec["recovery_domains"] == ()
    assert spec["response_mode"] == "full"
    assert spec["audit_mode"] == "reference"
    assert spec["strict_read_only"] is True
    with pytest.raises(ValueError, match="strict_read_only requires"):
        coc_toolbox.tool(
            "test.invalid_strict_query",
            "invalid",
            {},
            access="query",
            write_domains=(),
            recovery_domains=None,
            response_mode="full",
            audit_mode="reference",
            strict_read_only=True,
        )

    ctx = coc_toolbox.Ctx(ws["workspace"], ws["campaign_id"])
    before = _game_file_bytes(ws["workspace"])
    data, _warnings, hints = spec["handler"](ctx, {})
    assert data["opening_ready"] is False
    assert data["skeleton_ready"] is False
    assert data["mutation_cards"][0]["operation"] == (
        "progressive.publish_skeleton"
    )
    assert data["blocking"] == [{
        "code": "opening_skeleton_missing",
        "entity_id": ws["asset_root_id"],
    }]
    assert data["hard_work"] == []
    assert data["opening_page_candidates"] == [{
        "pdf_index": 0,
        "review_state": "manual_accepted",
        "parse_confidence": 0.99,
        "grep_anchor_preview": "A bounded authored opening.",
        "text_preview": "# Opening A bounded authored opening.",
    }]
    assert data["opening_page_candidate_total"] == 1
    assert data["opening_page_candidate_complete"] is True
    assert data["opening_page_candidate_role"] == (
        "selection_hint_only_not_provenance"
    )
    assert data["anchors_declared"] is True
    assert "opening_window_selection_advisory" not in data
    assert any("never guess page indices" in hint for hint in hints)
    skeleton_contract = data["mutation_cards"][0][
        "skeleton_argument_contract"
    ]
    assert skeleton_contract["contract_id"] == (
        "coc.progressive-opening-skeleton-argument.v1"
    )
    assert skeleton_contract["closed"] is True
    template = skeleton_contract["prefilled_template"]
    assert template == {
        "schema_version": 1,
        "parse_tier": 1,
        "source": {
            "source_id": "pdf:opening-component",
            "file_sha256": ws["file_sha256"],
            "page_count": 1,
            "producer": "codex-pdf-skill",
        },
        "start_candidates": ["<source-grounded-location-id>"],
        "locations": [{
            "location_id": "<same-start-location-id>",
            "title": "<source-grounded-title>",
            "parse_state": "toc_only",
        }],
        "mechanics_locator_pass_status": "pending",
        "mechanics_index": [],
        "start_clock_status": "unresolved",
    }
    assert skeleton_contract["start_clock_source_ref_template"] == {
        "source_id": "pdf:opening-component",
        "pdf_index": "<selected-zero-based-pdf-index>",
    }
    assert skeleton_contract["first_submission_guidance"] == {
        "authority": "advisory",
        "hard_gate": False,
        "copy_prefilled_template": True,
        "replace_placeholders_only": True,
        "omit_optional_source_evidenced_fields": True,
        "source_clock_exception": (
            "when the selected opening pages explicitly author the starting "
            "date/time or day phase, set start_clock_status=source and add only "
            "start_clock plus start_clock_source_refs copied from "
            "start_clock_source_ref_template once per supporting selected page; "
            "when a time or phase "
            "is authored without a date, keep local_datetime/local_date null and "
            "use calendar_mode=relative, time_precision=day_phase, a semantic "
            "day_phase_hint, and the exact source-supported display"
        ),
    }
    assert skeleton_contract["start_clock_source_ref_required_fields"] == [
        "source_id",
        "pdf_index",
    ]
    assert skeleton_contract["required_fields"] == [
        "schema_version",
        "parse_tier",
        "source",
        "start_candidates",
        "locations",
        "mechanics_locator_pass_status",
        "start_clock_status",
    ]
    assert set(skeleton_contract["location_parse_state_enum"]) == (
        coc_toolbox.coc_module_project.coc_module_assets.PARSE_STATES
    )
    assert "mechanics_index" not in skeleton_contract[
        "optional_source_evidenced_fields"
    ]
    selected_data, _warnings, _hints = spec["handler"](
        ctx, {"opening_pdf_indices": [0]},
    )
    assert selected_data["skeleton_ready"] is False
    assert selected_data["source_window_ready"] is True
    assert selected_data["source_window"] == [0]
    assert selected_data["window_origin"] == "host_selected_pre_skeleton"
    assert "opening_page_candidates" not in selected_data
    assert selected_data["blocking"] == [{
        "code": "opening_skeleton_missing",
        "entity_id": ws["asset_root_id"],
    }]
    assert selected_data["ownership"]["semantic_model"] is False
    assert selected_data["ownership"]["player_action_gate"] is False
    assert len(selected_data["cached_page_refs"]) == 1
    selected_ref = selected_data["cached_page_refs"][0]
    assert selected_ref["source_id"] == "pdf:opening-component"
    assert selected_ref["pdf_index"] == 0
    assert len(selected_ref["text_sha256"]) == 64
    assert selected_ref["review_state"] == "manual_accepted"
    assert selected_ref["parse_confidence"] == 0.99
    assert selected_ref["path"] == str(
        ws["workspace"] / ".coc" / "module-assets"
        / ws["asset_root_id"] / "pages" / "0000.md"
    )
    assert selected_data["mutation_cards"][0]["operation"] == (
        "progressive.publish_skeleton"
    )
    assert _game_file_bytes(ws["workspace"]) == before

    recovery_calls = []
    monkeypatch.setattr(
        coc_toolbox.coc_runtime_ops,
        "recover_development_transactions",
        lambda *_args, **_kwargs: recovery_calls.append(True),
    )
    module_root = (
        ws["workspace"] / ".coc" / "module-assets" / ws["asset_root_id"]
    )
    module_before = {
        path.relative_to(module_root): path.read_bytes()
        for path in module_root.rglob("*") if path.is_file()
    }
    result = _run(ws, "progressive.prepare_opening")
    assert result["ok"] is True
    assert recovery_calls == []
    module_after = {
        path.relative_to(module_root): path.read_bytes()
        for path in module_root.rglob("*") if path.is_file()
    }
    assert module_after == module_before
    assert not list(ws["campaign_dir"].rglob("*.lock"))

def test_missing_skeleton_page_catalog_is_complete_bounded_and_fail_closed(
    tmp_path: Path,
):
    ws = _opening_component_workspace(
        tmp_path, extra_pdf_indices=tuple(range(1, 32)),
    )
    prepared = _run(ws, "progressive.prepare_opening")
    assert prepared["ok"] is True, prepared
    data = prepared["data"]
    assert data["opening_page_candidate_total"] == 32
    assert data["opening_page_candidate_complete"] is True
    assert len(data["opening_page_candidates"]) == 32
    assert [
        row["pdf_index"] for row in data["opening_page_candidates"]
    ] == list(range(32))
    candidate_preview_limit = (
        coc_toolbox.coc_module_project.coc_module_assets
        .OPENING_PAGE_CANDIDATE_PREVIEW_MAX_BYTES
    )
    assert all(
        len(row["grep_anchor_preview"].encode("utf-8"))
        <= candidate_preview_limit
        for row in data["opening_page_candidates"]
    )
    per_candidate_text_limit = min(
        coc_toolbox.coc_module_project.coc_module_assets
        .OPENING_PAGE_CANDIDATE_TEXT_PREVIEW_MAX_BYTES,
        coc_toolbox.coc_module_project.coc_module_assets
        .OPENING_PAGE_CANDIDATE_TEXT_PREVIEW_TOTAL_MAX_BYTES // 32,
    )
    assert all(
        len(row["text_preview"].encode("utf-8")) <= per_candidate_text_limit + 3
        for row in data["opening_page_candidates"]
    )
    assert data["anchors_declared"] is True
    assert data["encoded_data_bytes"] <= data["encoded_data_budget_bytes"]
    assert data["next_operation"]["operation"] == (
        "progressive.opening_bootstrap"
    )
    assert data["next_operation"]["hard_gate"] is True
    assert data["blocking_total"] == 1
    assert data["blocking_omitted_count"] == 1

    invalid = _run(ws, "progressive.prepare_opening", {
        "opening_pdf_indices": [0, 2],
    })
    assert invalid["ok"] is False
    assert invalid["error"]["code"] == "opening_source_window_invalid"
    assert "contiguous" in invalid["error"]["message"]

    published = _run(ws, "progressive.publish_skeleton", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "skeleton": ws["skeleton"],
    })
    assert published["ok"] is True, published
    locator_planned = _run(ws, "progressive.prepare_opening")
    assert locator_planned["ok"] is True, locator_planned
    locator_data = locator_planned["data"]
    assert locator_data["mechanics_locator_page_candidate_total"] == 32
    assert len(locator_data["mechanics_locator_page_candidates"]) == 32
    assert locator_data["encoded_data_bytes"] <= locator_data[
        "encoded_data_budget_bytes"
    ]

def test_missing_skeleton_page_catalog_fits_budget_with_cjk_pages(
    tmp_path: Path,
):
    # Regression: CJK page bodies cost ~3 UTF-8 bytes per char, so char-bounded
    # previews once sank the mandatory 12 KiB preparation budget and failed
    # prepare_opening closed. Previews must be byte-bounded and survive.
    ws = _opening_component_workspace(
        tmp_path,
        extra_pdf_indices=tuple(range(1, 32)),
        page_body="圣诞季降临卡尔克萨，村民丢弃盛水器具集体渴死。" * 8,
    )
    prepared = _run(ws, "progressive.prepare_opening")
    assert prepared["ok"] is True, prepared
    data = prepared["data"]
    assert data["opening_page_candidate_total"] == 32
    assert data["encoded_data_bytes"] <= data["encoded_data_budget_bytes"]
    assert "text_preview_omitted_for_budget" not in data
    previews = [row["text_preview"] for row in data["opening_page_candidates"]]
    assert any("圣诞季" in preview for preview in previews)

def test_empty_locator_window_closes_and_only_new_window_requeues(
    tmp_path: Path, monkeypatch,
):
    monkeypatch.setenv("COC_DISABLE_QUEUE_WORKER", "1")
    ws = _opening_component_workspace(tmp_path, extra_pdf_indices=(1, 2))
    published = _run(ws, "progressive.publish_skeleton", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "skeleton": ws["skeleton"],
    })
    assert published["ok"] is True, published
    first = _run(ws, "progressive.request_locator_pass", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "mechanics_locator_pdf_indices": [1],
        "request_purpose": "mechanics_locator_pass",
    })
    assert first["ok"] is True, first
    worker = coc_toolbox.coc_module_project._load_sibling(
        "coc_module_queue_worker_empty_locator_vertical",
        "coc_module_queue_worker.py",
    )
    materialized = worker.run_worker_once(ws["workspace"], parallel=1)
    assert materialized["claimed"] == 1
    claimed = _run(ws, "progressive.claim_host_work", {
        "executor_id": "empty-locator-test-host", "limit": 1,
    })
    request = claimed["data"]["dispatch_tasks"][0]["packet"]["requests"][0]
    empty_scope = {
        "scope_kind": "explicit_pdf_indices",
        "pdf_indices": [1],
        "source_file_sha256": ws["file_sha256"],
    }
    fulfilled = _run(ws, "progressive.fulfill_host_work", {
        "job_id": request["job_id"],
        "pack": {
            "mechanics_locator_pass_status": "pending",
            "mechanics_locator_scope": empty_scope,
            "npc_roster": [],
            "item_roster": [],
            "mechanics_index": [],
        },
        "related_packs": [],
    })
    assert fulfilled["ok"] is True, fulfilled
    assert fulfilled["data"]["locator_rows_merged"] == 0
    same_window = _run(ws, "progressive.request_locator_pass", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "mechanics_locator_pdf_indices": [1],
        "request_purpose": "mechanics_locator_pass",
    })
    assert same_window["ok"] is True, same_window
    assert same_window["data"]["status"] == "current"
    assert same_window["data"]["idempotent"] is True
    assert same_window["data"]["worker_kick"]["reason"] == (
        "locator_window_already_reviewed"
    )
    second = _run(ws, "progressive.request_locator_pass", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "mechanics_locator_pdf_indices": [2],
        "request_purpose": "mechanics_locator_pass",
    })
    assert second["ok"] is True, second
    assert second["data"]["status"] == "queued"
    assert second["data"]["job_id"] != first["data"]["job_id"]

def test_publish_skeleton_reports_all_three_write_phases_truthfully(
    tmp_path: Path, monkeypatch,
):
    ws = _opening_component_workspace(tmp_path)
    skeleton_path = (
        ws["workspace"] / ".coc" / "module-assets" / ws["asset_root_id"]
        / "skeleton.json"
    )
    invalid = deepcopy(ws["skeleton"])
    invalid["parse_tier"] = 99
    rejected = _run(ws, "progressive.publish_skeleton", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "skeleton": invalid,
    })
    assert rejected["ok"] is False
    assert rejected["error"]["details"] == {
        "status": "validation_failed",
        "complete": False,
        "stored": False,
        "projected": False,
    }
    assert not skeleton_path.exists()

    assets = coc_toolbox.coc_module_project.coc_module_assets
    real_bump = assets._bump_parse_tier
    calls = 0

    def fail_metadata_once(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise assets.ModuleAssetsError("injected registry identity failure")
        return real_bump(*args, **kwargs)

    monkeypatch.setattr(assets, "_bump_parse_tier", fail_metadata_once)
    queue_path = skeleton_path.parent / "parse-queue.json"
    queue_before = queue_path.read_bytes()
    partial = _run(ws, "progressive.publish_skeleton", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "skeleton": ws["skeleton"],
    })
    assert partial["ok"] is True, partial
    assert partial["data"] == {
        "status": "stored_metadata_failed",
        "complete": False,
        "stored": True,
        "projected": False,
        "asset_root_id": ws["asset_root_id"],
        "store": partial["data"]["store"],
        "pending_phase": "parse_tier_registry_identity",
        "metadata_error": {
            "type": "ModuleAssetsError",
            "message": "injected registry identity failure",
        },
        "retry_card": partial["data"]["retry_card"],
    }
    assert skeleton_path.is_file()
    assert queue_path.read_bytes() == queue_before
    retry = _run(ws, "progressive.publish_skeleton", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "skeleton": ws["skeleton"],
    })
    assert retry["ok"] is True, retry
    assert retry["data"]["status"] == "complete"
    assert retry["data"]["stored"] is True
    assert retry["data"]["projected"] is True
    assert queue_path.read_bytes() == queue_before
    registry = assets.load_registry(ws["workspace"])
    assert registry["modules"][ws["asset_root_id"]]["parse_tier_max"] == 1

    projection_ws = _opening_component_workspace(tmp_path / "projection")
    monkeypatch.setattr(
        coc_toolbox.coc_module_project,
        "project_skeleton_to_campaign",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            RuntimeError("injected sparse projection failure")
        ),
    )
    projection_failed = _run(
        projection_ws,
        "progressive.publish_skeleton",
        {
            "asset_root_id": projection_ws["asset_root_id"],
            "source_file_sha256": projection_ws["file_sha256"],
            "skeleton": projection_ws["skeleton"],
        },
    )
    assert projection_failed["ok"] is True
    assert projection_failed["data"]["status"] == "stored_projection_failed"
    assert projection_failed["data"]["stored"] is True
    assert projection_failed["data"]["projected"] is False
    assert projection_failed["data"]["projection_error"] == {
        "type": "RuntimeError",
        "message": "injected sparse projection failure",
    }

def test_prepare_opening_dynamically_bounds_long_start_catalog(
    tmp_path: Path,
):
    ws = _opening_component_workspace(tmp_path)
    start_ids = [f"start-{index:03d}" for index in range(100)]
    ws["skeleton"]["start_candidates"] = start_ids
    ws["skeleton"]["locations"] = [
        {
            "location_id": start_id,
            "title": f"{index:03d}-" + ("长标题" * 80),
            "parse_state": "toc_only",
            "source_span": {"pdf_index_start": 0, "pdf_index_end": 0},
        }
        for index, start_id in enumerate(start_ids)
    ]
    published = _run(ws, "progressive.publish_skeleton", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "skeleton": ws["skeleton"],
    })
    assert published["ok"] is True, published

    prepared = _run(ws, "progressive.prepare_opening", {
        "start_location_id": "start-099",
    })
    assert prepared["ok"] is True, prepared
    data = prepared["data"]
    assert data["encoded_data_bytes"] <= data["encoded_data_budget_bytes"] == 12 * 1024
    assert data["start_candidate_total"] == 100
    assert data["start_candidate_returned_count"] == len(data["start_candidates"])
    assert data["start_candidate_omitted_count"] == (
        100 - data["start_candidate_returned_count"]
    )
    assert data["start_candidate_returned_count"] < 64
    assert data["start_candidates"][-1]["location_id"] == "start-099"
    assert [row["location_id"] for row in data["start_candidates"][:-1]] == (
        start_ids[: data["start_candidate_returned_count"] - 1]
    )

def test_prepare_opening_reports_typed_error_when_selected_row_cannot_fit():
    data = {
        "start_candidates": [
            {"location_id": "selected", "title": "x" * (20 * 1024)},
        ],
        "start_candidate_total": 1,
        "deferred": [],
        "deferred_total": 0,
        "soft_work": [],
        "soft_work_total": 0,
        "hard_work": [],
        "hard_work_total": 0,
        "blocking": [],
        "blocking_total": 0,
        "mutation_cards": [],
        "mutation_cards_total": 0,
        "encoded_data_budget_bytes": 12 * 1024,
        "encoded_data_bytes": 0,
    }

    with pytest.raises(coc_toolbox.ToolError) as exc_info:
        coc_toolbox._fit_opening_data_budget(
            data,
            selected_start_location_id="selected",
        )

    assert exc_info.value.code == "opening_selected_candidate_too_large"
    assert exc_info.value.message == (
        "mandatory opening preparation data exceeds the 12 KiB budget"
    )

@pytest.mark.parametrize("raw_id", [True, 7, {"id": "npc"}])
def test_prepare_opening_required_id_selectors_reject_non_strings_every_gateway(
    tmp_path: Path, raw_id,
):
    ws = _opening_component_workspace(tmp_path)
    ctx = coc_toolbox.Ctx(ws["workspace"], ws["campaign_id"])
    handler = coc_toolbox.TOOLS["progressive.prepare_opening"]["handler"]
    with pytest.raises(coc_toolbox.ToolError) as direct:
        handler(ctx, {"opening_required_npc_ids": [raw_id]})
    assert direct.value.code == "invalid_param"
    assert "non-empty string" in direct.value.message

    gateway = _run(ws, "progressive.prepare_opening", {
        "opening_required_secret_ids": [raw_id],
    })
    assert gateway["ok"] is False
    assert gateway["error"]["code"] == "invalid_param"
    assert "non-empty string" in gateway["error"]["message"]

@pytest.mark.parametrize(
    ("raw_start", "matching_candidate"),
    [
        (True, "True"),
        (7, "7"),
        (["opening"], "opening"),
        ({"id": "opening"}, "opening"),
    ],
)
def test_prepare_opening_start_selector_rejects_non_strings_before_coercion(
    tmp_path: Path, raw_start, matching_candidate: str,
):
    ws = _opening_component_workspace(tmp_path)
    ws["skeleton"]["start_candidates"] = [matching_candidate]
    ws["skeleton"]["locations"] = [{
        "location_id": matching_candidate,
        "title": f"Start {matching_candidate}",
        "parse_state": "toc_only",
        "source_span": {"pdf_index_start": 0, "pdf_index_end": 0},
    }]
    published = _run(ws, "progressive.publish_skeleton", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "skeleton": ws["skeleton"],
    })
    assert published["ok"] is True, published
    ctx = coc_toolbox.Ctx(ws["workspace"], ws["campaign_id"])
    handler = coc_toolbox.TOOLS["progressive.prepare_opening"]["handler"]

    with pytest.raises(coc_toolbox.ToolError) as direct:
        handler(ctx, {"start_location_id": raw_start})
    assert direct.value.code == "invalid_param"
    assert direct.value.message == (
        "start_location_id must be a string when provided"
    )

    gateway = _run(ws, "progressive.prepare_opening", {
        "start_location_id": raw_start,
    })
    assert gateway["ok"] is False
    assert gateway["error"] == {
        "code": "invalid_param",
        "message": "start_location_id must be a string when provided",
    }

@pytest.mark.parametrize(
    "args",
    [{}, {"start_location_id": None}, {"start_location_id": "   "}],
)
def test_prepare_opening_start_selector_preserves_omission_semantics(
    tmp_path: Path, args: dict,
):
    ws = _opening_component_workspace(tmp_path)
    published = _run(ws, "progressive.publish_skeleton", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "skeleton": ws["skeleton"],
    })
    assert published["ok"] is True, published
    ctx = coc_toolbox.Ctx(ws["workspace"], ws["campaign_id"])
    handler = coc_toolbox.TOOLS["progressive.prepare_opening"]["handler"]

    direct_data, _, _ = handler(ctx, args)
    assert direct_data["selected_start_location_id"] == "opening"
    gateway = _run(ws, "progressive.prepare_opening", args)
    assert gateway["ok"] is True, gateway
    assert gateway["data"]["selected_start_location_id"] == "opening"

@pytest.mark.parametrize(
    ("operation", "raw_start", "matching_candidate"),
    [
        ("progressive.request_opening_pack", True, "True"),
        ("progressive.request_opening_pack", 7, "7"),
        ("progressive.request_opening_pack", ["opening"], "opening"),
        ("progressive.request_opening_pack", {"id": "opening"}, "opening"),
        ("progressive.project_opening", True, "True"),
        ("progressive.project_opening", 7, "7"),
        ("progressive.project_opening", ["opening"], "opening"),
        ("progressive.project_opening", {"id": "opening"}, "opening"),
    ],
)
def test_opening_mutation_selectors_reject_non_strings_before_coercion(
    tmp_path: Path,
    operation: str,
    raw_start,
    matching_candidate: str,
):
    ws = _opening_component_workspace(tmp_path)
    ws["skeleton"]["start_candidates"] = [matching_candidate]
    ws["skeleton"]["locations"] = [{
        "location_id": matching_candidate,
        "title": f"Start {matching_candidate}",
        "parse_state": "toc_only",
        "source_span": {"pdf_index_start": 0, "pdf_index_end": 0},
    }]
    published = _run(ws, "progressive.publish_skeleton", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "skeleton": ws["skeleton"],
    })
    assert published["ok"] is True, published
    args = {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "start_location_id": raw_start,
    }
    if operation == "progressive.request_opening_pack":
        args.update({
            "opening_pdf_indices": [0],
            "request_purpose": "foreground_opening_slice",
        })
    ctx = coc_toolbox.Ctx(ws["workspace"], ws["campaign_id"])
    handler = coc_toolbox.TOOLS[operation]["handler"]
    with pytest.raises(coc_toolbox.ToolError) as direct:
        handler(ctx, args)
    assert direct.value.code == "invalid_param"
    assert direct.value.message == (
        "start_location_id must be a string when provided"
    )
    gateway = _run(ws, operation, args)
    assert gateway["ok"] is False
    assert gateway["error"] == {
        "code": "invalid_param",
        "message": "start_location_id must be a string when provided",
    }

@pytest.mark.parametrize(
    ("operation", "raw_start"),
    [
        ("progressive.request_opening_pack", None),
        ("progressive.request_opening_pack", "   "),
        ("progressive.project_opening", None),
        ("progressive.project_opening", "   "),
    ],
)
def test_opening_mutation_selectors_require_nonempty_strings(
    tmp_path: Path,
    operation: str,
    raw_start,
):
    ws = _opening_component_workspace(tmp_path)
    args = {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "start_location_id": raw_start,
    }
    if operation == "progressive.request_opening_pack":
        args.update({
            "opening_pdf_indices": [0],
            "request_purpose": "foreground_opening_slice",
        })
    ctx = coc_toolbox.Ctx(ws["workspace"], ws["campaign_id"])
    with pytest.raises(coc_toolbox.ToolError) as direct:
        coc_toolbox.TOOLS[operation]["handler"](ctx, args)
    assert direct.value.code == "invalid_param"
    assert direct.value.message == "start_location_id must be a nonempty string"
    gateway = _run(ws, operation, args)
    assert gateway["ok"] is False
    assert gateway["error"]["code"] == (
        "missing_param" if raw_start is None else "invalid_param"
    )

def test_partial_opening_fulfill_hint_claims_only_explicit_projection(
    tmp_path: Path, monkeypatch,
):
    monkeypatch.setenv("COC_DISABLE_QUEUE_WORKER", "1")
    ws = _opening_component_workspace(tmp_path)
    published = _run(ws, "progressive.publish_skeleton", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "skeleton": ws["skeleton"],
    })
    assert published["ok"] is True
    requested = _run(ws, "progressive.request_opening_pack", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "start_location_id": "opening",
        "opening_pdf_indices": [0],
        "request_purpose": "foreground_opening_slice",
    })
    assert requested["ok"] is True, requested
    worker = coc_toolbox.coc_module_project._load_sibling(
        "coc_module_queue_worker_partial_hint_test",
        "coc_module_queue_worker.py",
    )
    materialized = worker.run_worker_once(ws["workspace"], parallel=1)
    assert materialized["claimed"] == 1

    fulfilled = _run(ws, "progressive.fulfill_host_work", {
        "worker_result": {
            "job_id": requested["data"]["job_id"],
            "pack": {
                "location": _opening_component_pack(parse_state="partial"),
            },
            "related_packs": [],
            "opening_setup": _opening_setup_unresolved(),
        },
    })
    assert fulfilled["ok"] is True, fulfilled
    assert len(fulfilled["hints"]) == 1
    assert "exact reusable partial opening pack is durable" in fulfilled["hints"][0]
    assert "projection watches were drained automatically" in fulfilled["hints"][0]
    assert "ready for" not in fulfilled["hints"][0]
    assert "re-enqueued" not in fulfilled["hints"][0]
    prepared = _run(ws, "progressive.prepare_opening")
    assert prepared["ok"] is True, prepared
    assert prepared["data"]["window_origin"] == "fulfilled_foreground_request"
    assert prepared["data"]["selected_start_pack_ready"] is True
    current_request = _run(ws, "progressive.request_opening_pack", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "start_location_id": "opening",
        "opening_pdf_indices": [0],
        "request_purpose": "foreground_opening_slice",
    })
    assert current_request["ok"] is True, current_request
    assert current_request["data"]["status"] == "current"
    projected = _run(ws, "progressive.project_opening", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "start_location_id": "opening",
    })
    assert projected["ok"] is True, projected
    assert projected["data"]["status"] == "complete"

def test_partial_opening_missing_npc_agenda_projects_without_repack(
    tmp_path: Path, monkeypatch,
):
    monkeypatch.setenv("COC_DISABLE_QUEUE_WORKER", "1")
    ws = _opening_component_workspace(tmp_path)
    ws["skeleton"]["npc_roster"] = [{
        "npc_id": "npc-witness",
        "names": ["Witness"],
        "parse_state": "named_only",
    }]
    published = _run(ws, "progressive.publish_skeleton", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "skeleton": ws["skeleton"],
    })
    assert published["ok"] is True, published
    requested = _run(ws, "progressive.request_opening_pack", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "start_location_id": "opening",
        "opening_pdf_indices": [0],
        "request_purpose": "foreground_opening_slice",
    })
    assert requested["ok"] is True, requested
    worker = coc_toolbox.coc_module_project._load_sibling(
        "coc_module_queue_worker_soft_agenda_test",
        "coc_module_queue_worker.py",
    )
    materialized = worker.run_worker_once(ws["workspace"], parallel=1)
    assert materialized["claimed"] == 1

    pack = _opening_component_pack(
        parse_state="partial",
        npc_ids=["npc-witness"],
        npcs=[{
            "npc_id": "npc-witness",
            "name": "Witness",
            "parse_state": "partial",
            "player_safe_summary": "A witness is present at the briefing.",
        }],
    )
    fulfilled = _run(ws, "progressive.fulfill_host_work", {
        "worker_result": {
            "job_id": requested["data"]["job_id"],
            "pack": pack,
            "related_packs": [],
            "opening_setup": _opening_setup_unresolved(),
        },
    })
    assert fulfilled["ok"] is True, fulfilled

    prepared = _run(ws, "progressive.prepare_opening")
    assert prepared["ok"] is True, prepared
    assert prepared["data"]["selected_start_pack_ready"] is True
    assert {
        row["code"] for row in prepared["data"]["blocking"]
    } == {"opening_projection_required"}
    assert prepared["data"]["soft_work"] == [
        {
            "code": "opening_npc_agenda_missing",
            "entity_id": "npc-witness",
        },
        {
            "code": "mechanics_locator_pass_pending",
            "required_for_opening": False,
            "hard_gate": False,
        },
    ]
    assert prepared["data"]["deferred"] == [
        {
            "code": "opening_npc_agenda_deferred",
            "entity_id": "npc-witness",
            "reason": "not_required_for_opening",
        },
        {
            "code": "mechanics_locator_pass_deferred",
            "reason": "idle_warm_not_required_for_opening",
        },
    ]
    project_card = next(
        row for row in prepared["data"]["mutation_cards"]
        if row["operation"] == "progressive.project_opening"
    )

    current = _run(ws, "progressive.request_opening_pack", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "start_location_id": "opening",
        "opening_pdf_indices": [0],
        "request_purpose": "foreground_opening_slice",
    })
    assert current["ok"] is True, current
    assert current["data"]["status"] == "current"
    assert current["data"]["job_id"] == requested["data"]["job_id"]

    projected = _run(
        ws,
        project_card["operation"],
        project_card["prefilled_arguments"],
    )
    assert projected["ok"] is True, projected
    assert projected["data"]["status"] == "complete"
    agendas = json.loads(
        (
            ws["campaign_dir"] / "scenario" / "npc-agendas.json"
        ).read_text(encoding="utf-8")
    )
    witness = next(
        row for row in agendas["npcs"] if row["npc_id"] == "npc-witness"
    )
    assert witness["agenda"] == "npc-witness agenda"

    queue = json.loads(
        (
            ws["workspace"] / ".coc" / "module-assets" / ws["asset_root_id"]
            / "parse-queue.json"
        ).read_text(encoding="utf-8")
    )
    jobs = [
        row
        for state in ("pending", "in_flight", "done")
        for row in queue.get(state) or []
    ]
    assert sum(row.get("kind") == "partial_opening" for row in jobs) == 1
    assert all(row.get("kind") != "deepen_npc" for row in jobs)

def test_changed_partial_pack_cannot_reuse_old_fulfillment_and_replacement_can(
    tmp_path: Path,
    monkeypatch,
):
    ws, old_job_id, _request_path, entity_path = (
        _fulfilled_partial_opening_workspace(tmp_path, monkeypatch)
    )
    assets = coc_toolbox.coc_module_project.coc_module_assets
    changed = json.loads(entity_path.read_text(encoding="utf-8"))
    changed["player_safe_summary"] = "Changed after the first fulfillment."
    changed["host_work_job_id"] = old_job_id
    assets.put_entity(
        ws["workspace"], ws["asset_root_id"], "location", "opening", changed,
    )
    rewritten = assets.get_entity(
        ws["workspace"], ws["asset_root_id"], "location", "opening",
    )
    assert "host_work_job_id" not in rewritten
    assert "host_work_job_id" not in rewritten["ingest_timing"]
    assert assets.current_ingest_fulfillment_receipt(rewritten) is None

    scenario_before = {
        path.name: path.read_bytes()
        for path in (ws["campaign_dir"] / "scenario").glob("*.json")
    }
    prepared = _run(ws, "progressive.prepare_opening", {
        "opening_pdf_indices": [0],
    })
    assert prepared["ok"] is True, prepared
    assert prepared["data"]["selected_start_pack_ready"] is False
    assert "opening_partial_binding_invalid" in {
        row["code"] for row in prepared["data"]["blocking"]
    }
    projected = _run(ws, "progressive.project_opening", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "start_location_id": "opening",
        "opening_pdf_indices": [0],
    })
    assert projected["ok"] is False
    assert projected["error"]["code"] == "opening_partial_binding_invalid"
    assert {
        path.name: path.read_bytes()
        for path in (ws["campaign_dir"] / "scenario").glob("*.json")
    } == scenario_before

    replacement_request = _run(ws, "progressive.request_opening_pack", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "start_location_id": "opening",
        "opening_pdf_indices": [0],
        "request_purpose": "foreground_opening_slice",
    })
    assert replacement_request["ok"] is True, replacement_request
    assert replacement_request["data"]["status"] in {"queued", "coalesced"}
    assert replacement_request["data"]["job_id"] != old_job_id
    worker = coc_toolbox.coc_module_project._load_sibling(
        "coc_module_queue_worker_revision4_partial_replacement",
        "coc_module_queue_worker.py",
    )
    materialized = worker.run_worker_once(ws["workspace"], parallel=1)
    assert materialized["claimed"] == 1
    replacement_pack = json.loads(entity_path.read_text(encoding="utf-8"))
    fulfilled = _run(ws, "progressive.fulfill_host_work", {
        "worker_result": {
            "job_id": replacement_request["data"]["job_id"],
            "pack": replacement_pack,
            "related_packs": [],
            "opening_setup": _opening_setup_unresolved(),
        },
    })
    assert fulfilled["ok"] is True, fulfilled
    rebound = assets.get_entity(
        ws["workspace"], ws["asset_root_id"], "location", "opening",
    )
    assert assets.current_ingest_fulfillment_receipt(rebound)["job_id"] == (
        replacement_request["data"]["job_id"]
    )
    prepared_after = _run(ws, "progressive.prepare_opening", {
        "opening_pdf_indices": [0],
    })
    assert prepared_after["ok"] is True, prepared_after
    assert prepared_after["data"]["selected_start_pack_ready"] is True
    projected_after = _run(ws, "progressive.project_opening", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "start_location_id": "opening",
        "opening_pdf_indices": [0],
    })
    assert projected_after["ok"] is True, projected_after
    assert projected_after["data"]["status"] == "complete"

@pytest.mark.parametrize(
    "tamper",
    [
        "request_kind",
        "request_entity",
        "request_pack_digest",
        "request_evidence_digest",
        "current_ingest_digest",
    ],
)
def test_partial_receipt_mismatch_refuses_prepare_request_and_project(
    tmp_path: Path,
    monkeypatch,
    tamper: str,
):
    ws, _job_id, request_path, entity_path = (
        _fulfilled_partial_opening_workspace(tmp_path, monkeypatch)
    )
    if tamper.startswith("request_"):
        request = json.loads(request_path.read_text(encoding="utf-8"))
        field, replacement = {
            "request_kind": ("kind", "npc"),
            "request_entity": ("entity_id", "other"),
            "request_pack_digest": ("fulfilled_pack_sha256", "1" * 64),
            "request_evidence_digest": ("source_evidence_sha256", "2" * 64),
        }[tamper]
        request["fulfilled_entity"][field] = replacement
        _write_json(request_path, request)
    else:
        entity = json.loads(entity_path.read_text(encoding="utf-8"))
        receipt_field = (
            coc_toolbox.coc_module_project.coc_module_assets
            .FULFILLED_PACK_INGEST_FIELD
        )
        entity["ingest_timing"][receipt_field]["fulfilled_pack_sha256"] = (
            "3" * 64
        )
        _write_json(entity_path, entity)

    scenario_before = {
        path.name: path.read_bytes()
        for path in (ws["campaign_dir"] / "scenario").glob("*.json")
    }
    prepared = _run(ws, "progressive.prepare_opening", {
        "opening_pdf_indices": [0],
    })
    assert prepared["ok"] is True, prepared
    assert prepared["data"]["selected_start_pack_ready"] is False
    assert "opening_partial_binding_invalid" in {
        row["code"] for row in prepared["data"]["blocking"]
    }
    requested = _run(ws, "progressive.request_opening_pack", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "start_location_id": "opening",
        "opening_pdf_indices": [0],
        "request_purpose": "foreground_opening_slice",
    })
    assert requested["ok"] is True, requested
    assert requested["data"]["status"] != "current"
    projected = _run(ws, "progressive.project_opening", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "start_location_id": "opening",
        "opening_pdf_indices": [0],
    })
    assert projected["ok"] is False
    assert projected["error"]["code"] == "opening_partial_binding_invalid"
    assert {
        path.name: path.read_bytes()
        for path in (ws["campaign_dir"] / "scenario").glob("*.json")
    } == scenario_before

def test_location_pack_required_semantic_fields_honors_stored_contract():
    required = coc_toolbox._location_pack_required_semantic_fields
    assert required({}) == ["title", "player_safe_summary"]
    assert required({"result_contract": "not-an-object"}) == [
        "title", "player_safe_summary",
    ]
    # The stored contract may name extra semantic fields, while structural
    # transport fields stay owned by the job binding and never double-gate.
    assert required({
        "result_contract": {
            "required_location_fields": [
                "location_id", "player_safe_summary",
                "source_page_indices", "source_refs",
            ],
            "location_pack": {
                "required_semantic_fields": ["title", "dramatic_question"],
            },
        },
    }) == ["title", "player_safe_summary", "dramatic_question"]

def test_partial_opening_fulfill_rejects_pack_missing_semantic_fields(
    tmp_path: Path, monkeypatch,
):
    ws, job_id = _requested_partial_opening(
        tmp_path, monkeypatch, "semantic_gate_reject",
    )
    assets = coc_toolbox.coc_module_project.coc_module_assets

    thin = _opening_component_pack(parse_state="partial", player_safe_summary="")
    rejected = _run(ws, "progressive.fulfill_host_work", {
        "job_id": job_id,
        "pack": thin,
        "related_packs": [],
    })
    assert rejected["ok"] is False
    assert rejected["error"]["code"] == "pack_semantic_fields_missing"
    assert "player_safe_summary" in rejected["error"]["message"]
    assert "title" not in rejected["error"]["message"]
    assert "leave the request unfulfilled" in rejected["hints"][0]

    bare = _opening_component_pack(parse_state="partial")
    bare.pop("title")
    bare.pop("player_safe_summary")
    rejected_bare = _run(ws, "progressive.fulfill_host_work", {
        "job_id": job_id,
        "pack": bare,
        "related_packs": [],
    })
    assert rejected_bare["ok"] is False
    assert rejected_bare["error"]["code"] == "pack_semantic_fields_missing"
    assert "title" in rejected_bare["error"]["message"]
    assert "player_safe_summary" in rejected_bare["error"]["message"]

    stub = assets.get_entity(
        ws["workspace"], ws["asset_root_id"], "location", "opening",
    )
    assert stub is not None
    assert stub["parse_state"] == "named_only"
    assert "player_safe_summary" not in stub
    request = next(
        row for row in assets.list_host_work_requests(
            ws["workspace"], ws["asset_root_id"], include_closed=True, limit=None,
        )
        if row["job_id"] == job_id
    )
    assert request["status"] != "fulfilled"

    fulfilled = _run(ws, "progressive.fulfill_host_work", {
        "worker_result": {
            "job_id": job_id,
            "pack": _opening_component_pack(parse_state="partial"),
            "related_packs": [],
            "opening_setup": _opening_setup_unresolved(),
        },
    })
    assert fulfilled["ok"] is True, fulfilled
    assert fulfilled["data"]["request_status"] == "fulfilled"
    prepared = _run(ws, "progressive.prepare_opening")
    assert prepared["ok"] is True, prepared
    assert prepared["data"]["selected_start_pack_ready"] is True

def test_pi_host_warns_when_keeper_races_claim_and_hand_pack_fulfill(
    tmp_path: Path, monkeypatch,
):
    monkeypatch.setenv("COC_HOST", "pi")
    ws, job_id = _requested_partial_opening(
        tmp_path, monkeypatch, "pi_race_fixture",
    )
    assets = coc_toolbox.coc_module_project.coc_module_assets

    # The legit coordinator child claims with task_return_to_parent and never
    # trips the warning (pi/lib/runtime.ts validates this prefill).
    legit_claim = _run(ws, "progressive.claim_host_work", {
        "executor_id": "source-coordinator:0123456789abcdef",
        "limit": 1,
        "result_delivery": "task_return_to_parent",
    })
    assert legit_claim["ok"] is True, legit_claim
    assert not any(
        "auto-dispatches" in row for row in legit_claim["warnings"]
    )

    raced_claim = _run(ws, "progressive.claim_host_work", {
        "executor_id": "opening-owner:v3",
        "limit": 1,
        "result_delivery": "return_to_parent",
    })
    assert raced_claim["ok"] is True, raced_claim
    assert any(
        "auto-dispatches" in row and "must not claim" in row
        for row in raced_claim["warnings"]
    )

    raced_fulfill = _run(ws, "progressive.fulfill_host_work", {
        "job_id": job_id,
        "pack": _opening_component_pack(parse_state="partial"),
        "related_packs": [],
        "opening_setup": _opening_setup_unresolved(),
    })
    assert raced_fulfill["ok"] is True, raced_fulfill
    assert any(
        "directly supplied pack" in row and "auto-dispatches" in row
        for row in raced_fulfill["warnings"]
    )

    # The legit child fulfills by exact-forwarding one worker_result; it must
    # never trip the warning, even on a later replacement job.
    module_root = (
        ws["workspace"] / ".coc" / "module-assets" / ws["asset_root_id"]
    )
    entity_path = module_root / "entities" / "location-opening.json"
    changed = json.loads(entity_path.read_text(encoding="utf-8"))
    changed["player_safe_summary"] = "Changed after the first fulfillment."
    changed["host_work_job_id"] = job_id
    assets.put_entity(
        ws["workspace"], ws["asset_root_id"], "location", "opening", changed,
    )
    monkeypatch.setenv("COC_HOST", "codex")
    replacement = _run(ws, "progressive.request_opening_pack", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "start_location_id": "opening",
        "opening_pdf_indices": [0],
        "request_purpose": "foreground_opening_slice",
    })
    assert replacement["ok"] is True, replacement
    assert replacement["data"]["job_id"] != job_id
    worker = coc_toolbox.coc_module_project._load_sibling(
        "coc_module_queue_worker_pi_race_replacement",
        "coc_module_queue_worker.py",
    )
    assert worker.run_worker_once(ws["workspace"], parallel=1)["claimed"] == 1
    monkeypatch.setenv("COC_HOST", "pi")
    forwarded = _run(ws, "progressive.fulfill_host_work", {
        "worker_result": {
            "job_id": replacement["data"]["job_id"],
            "pack": _opening_component_pack(parse_state="partial"),
            "related_packs": [],
            "opening_setup": _opening_setup_unresolved(),
        },
    })
    assert forwarded["ok"] is True, forwarded
    assert not any(
        "auto-dispatches" in row for row in forwarded["warnings"]
    )

def test_pi_headless_claim_and_hand_pack_fulfill_stay_silent(
    tmp_path: Path, monkeypatch,
):
    monkeypatch.setenv("COC_HOST", "pi")
    monkeypatch.setenv("COC_PI_HEADLESS", "1")
    ws, job_id = _requested_partial_opening(
        tmp_path, monkeypatch, "pi_headless_fixture",
    )

    # Headless Pi cannot spawn the coordinator; the main KP owns the direct
    # claim/fulfill fallback there, so neither call warns.
    claimed = _run(ws, "progressive.claim_host_work", {
        "executor_id": "pi-headless-keeper",
        "limit": 1,
    })
    assert claimed["ok"] is True, claimed
    assert claimed["data"]["dispatch_task_count"] == 0
    assert not any("auto-dispatches" in row for row in claimed["warnings"])

    fulfilled = _run(ws, "progressive.fulfill_host_work", {
        "job_id": job_id,
        "pack": _opening_component_pack(parse_state="partial"),
        "related_packs": [],
        "opening_setup": _opening_setup_unresolved(),
    })
    assert fulfilled["ok"] is True, fulfilled
    assert not any("auto-dispatches" in row for row in fulfilled["warnings"])
