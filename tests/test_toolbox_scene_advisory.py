"""Behavior tests owned by the scene-advisory operation cell."""
from toolbox_test_support import *

def test_initial_authored_start_move_has_no_off_graph_warning(campaign_ws):
    story_graph = json.loads(
        (campaign_ws["campaign_dir"] / "scenario" / "story-graph.json").read_text(
            encoding="utf-8"
        )
    )
    start = next(scene for scene in story_graph["scenes"] if scene.get("is_start"))
    world_path = campaign_ws["campaign_dir"] / "save" / "world-state.json"
    world = json.loads(world_path.read_text(encoding="utf-8"))
    world["active_scene_id"] = None
    world["unlocked_scene_ids"] = []
    _write_json(world_path, world)

    moved = _run(campaign_ws, "state.move_scene", {
        "scene_id": start["scene_id"],
        "decision_id": "enter-authored-start",
    })

    assert moved["ok"] is True
    assert not any("off-graph" in warning for warning in moved["warnings"])
    assert not any("not unlocked" in warning for warning in moved["warnings"])
    assert moved["data"]["next_operation"]["operation"] == "scene.context"

def test_scene_context_softly_redirects_nonactive_preview_to_typed_move(
    campaign_ws,
):
    current = _run(campaign_ws, "scene.context")
    move_card = current["data"]["exits"][0]["operation_opportunity"]
    assert "travel_minutes" not in move_card["prefilled_arguments"]
    assert move_card["argument_boundary"] == {
        "submission_shape": "prefilled_plus_missing_only",
        "forbidden_arguments": ["travel_minutes"],
        "reason": "travel_minutes is valid only when source-authored and prefilled",
    }
    destination = current["data"]["exits"][0]["to"]
    preview = _run(campaign_ws, "scene.context", {"scene_id": destination})
    assert preview["ok"] is True
    assert preview["data"]["active_scene_id"] != destination
    assert any(
        "state.move_scene" in warning and "do not read" in warning
        for warning in preview["warnings"]
    )

def test_source_edge_travel_minutes_prefill_and_advance_authoritative_clock(
    campaign_ws,
):
    world = json.loads(
        (campaign_ws["campaign_dir"] / "save" / "world-state.json").read_text(
            encoding="utf-8"
        )
    )
    active_id = world["active_scene_id"]
    graph_path = campaign_ws["campaign_dir"] / "scenario" / "story-graph.json"
    story_graph = json.loads(graph_path.read_text(encoding="utf-8"))
    active_scene = next(
        scene for scene in story_graph["scenes"]
        if scene["scene_id"] == active_id
    )
    destination = active_scene["scene_edges"][0]["to"]
    active_scene["scene_edges"] = [{
        "to": destination,
        "kind": "travel",
        "when": {"kind": "always"},
        "travel_minutes": 120,
    }]
    _write_json(graph_path, story_graph)
    coc_toolbox.coc_compiled_archive.publish_from_campaign(
        campaign_ws["campaign_dir"]
    )

    refreshed = _run(campaign_ws, "scene.context")
    exit_card = next(
        row for row in refreshed["data"]["exits"]
        if row["to"] == destination
    )
    assert exit_card["travel_minutes"] == 120
    assert exit_card["operation_opportunity"]["prefilled_arguments"] == {
        "scene_id": destination,
        "travel_minutes": 120,
    }

    conflicting = _run(campaign_ws, "state.move_scene", {
        "scene_id": destination,
        "travel_minutes": 60,
        "reason": "conflicting typed journey",
        "decision_id": "travel-conflict",
    })
    assert conflicting["ok"] is False
    assert conflicting["error"]["code"] == "invalid_param"

    moved = _run(campaign_ws, "state.move_scene", {
        **exit_card["operation_opportunity"]["prefilled_arguments"],
        "reason": "source-authored two-hour journey",
        "decision_id": "travel-two-hours",
    })
    assert moved["ok"] is True, moved
    assert moved["data"]["travel_minutes"] == 120
    assert moved["data"]["travel_time_source"] == "source_scene_edge"
    assert moved["data"]["time_scene_change"]["elapsed_minutes"] == 120
    assert moved["data"]["time_scene_change"]["travel_minutes"] == 120
    time_state = json.loads(
        (campaign_ws["campaign_dir"] / "save" / "time-state.json").read_text(
            encoding="utf-8"
        )
    )
    assert time_state["clock"]["elapsed_minutes"] == 120
    assert time_state["clock"]["location_id"] == destination

    replay = _run(campaign_ws, "state.move_scene", {
        "scene_id": destination,
        "travel_minutes": 120,
        "reason": "source-authored two-hour journey",
        "decision_id": "travel-two-hours",
    })
    assert replay["ok"] is True
    assert replay["data"] == moved["data"]

def test_state_move_scene_rejects_malformed_travel_minutes_without_moving(
    campaign_ws,
):
    current = _run(campaign_ws, "scene.context")
    active_id = current["data"]["active_scene_id"]
    destination = current["data"]["exits"][0]["to"]

    rejected = _run(campaign_ws, "state.move_scene", {
        "scene_id": destination,
        "travel_minutes": "120",
        "reason": "malformed typed duration",
        "decision_id": "travel-malformed",
    })

    assert rejected["ok"] is False
    assert rejected["error"]["code"] == "invalid_param"
    after = _run(campaign_ws, "scene.context")
    assert after["data"]["active_scene_id"] == active_id

def test_same_destination_second_source_travel_card_is_accepted(campaign_ws):
    _active_id, destination = _install_same_destination_travel_edges(campaign_ws)
    context = _run(campaign_ws, "scene.context")
    cards = [
        row["operation_opportunity"]["prefilled_arguments"]
        for row in context["data"]["exits"]
        if row["to"] == destination
    ]
    assert cards == [
        {"scene_id": destination, "travel_minutes": 60},
        {"scene_id": destination, "travel_minutes": 120},
    ]

    moved = _run(campaign_ws, "state.move_scene", {
        **cards[1],
        "reason": "take the slower authored route",
        "decision_id": "same-destination-second-edge",
    })

    assert moved["ok"] is True, moved
    assert moved["data"]["travel_minutes"] == 120
    assert moved["data"]["time_scene_change"]["elapsed_minutes"] == 120

def test_same_destination_ambiguous_omitted_travel_minutes_fails_closed(
    campaign_ws,
):
    active_id, destination = _install_same_destination_travel_edges(campaign_ws)

    rejected = _run(campaign_ws, "state.move_scene", {
        "scene_id": destination,
        "reason": "ambiguous route without its exact exit card",
        "decision_id": "same-destination-ambiguous",
    })

    assert rejected["ok"] is False
    assert rejected["error"]["code"] == "invalid_param"
    after = _run(campaign_ws, "scene.context")
    assert after["data"]["active_scene_id"] == active_id

def test_same_destination_unmatched_travel_minutes_fails_closed(campaign_ws):
    active_id, destination = _install_same_destination_travel_edges(campaign_ws)

    rejected = _run(campaign_ws, "state.move_scene", {
        "scene_id": destination,
        "travel_minutes": 90,
        "reason": "duration absent from every authored edge",
        "decision_id": "same-destination-unmatched",
    })

    assert rejected["ok"] is False
    assert rejected["error"]["code"] == "invalid_param"
    after = _run(campaign_ws, "scene.context")
    assert after["data"]["active_scene_id"] == active_id

def test_same_destination_missing_and_timed_edges_make_omission_ambiguous(
    campaign_ws,
):
    world = json.loads(
        (campaign_ws["campaign_dir"] / "save" / "world-state.json").read_text(
            encoding="utf-8"
        )
    )
    active_id = world["active_scene_id"]
    graph_path = campaign_ws["campaign_dir"] / "scenario" / "story-graph.json"
    story_graph = json.loads(graph_path.read_text(encoding="utf-8"))
    active_scene = next(
        scene for scene in story_graph["scenes"]
        if scene["scene_id"] == active_id
    )
    destination = active_scene["scene_edges"][0]["to"]
    active_scene["scene_edges"] = [
        {
            "to": destination,
            "kind": "travel",
            "when": {"kind": "always"},
        },
        {
            "to": destination,
            "kind": "travel",
            "when": {
                "kind": "narrative",
                "description": "the party chooses the timed authored route",
            },
            "travel_minutes": 120,
        },
    ]
    _write_json(graph_path, story_graph)
    coc_toolbox.coc_compiled_archive.publish_from_campaign(
        campaign_ws["campaign_dir"]
    )
    context = _run(campaign_ws, "scene.context")
    cards = [
        row["operation_opportunity"]["prefilled_arguments"]
        for row in context["data"]["exits"]
        if row["to"] == destination
    ]
    assert cards == [
        {"scene_id": destination},
        {"scene_id": destination, "travel_minutes": 120},
    ]

    protected_paths = [
        campaign_ws["campaign_dir"] / "save" / "world-state.json",
        campaign_ws["campaign_dir"] / "save" / "time-state.json",
        campaign_ws["campaign_dir"] / "save" / "time-triggers.json",
    ]
    before = {path: path.read_bytes() for path in protected_paths}
    rejected = _run(campaign_ws, "state.move_scene", {
        **cards[0],
        "reason": "the no-duration card is ambiguous beside a timed route",
        "decision_id": "same-destination-mixed-omission",
    })

    assert rejected["ok"] is False
    assert rejected["error"]["code"] == "invalid_param"
    assert {path: path.read_bytes() for path in protected_paths} == before

    moved = _run(campaign_ws, "state.move_scene", {
        **cards[1],
        "reason": "the exact timed card resolves the mixed edge set",
        "decision_id": "same-destination-mixed-timed",
    })
    assert moved["ok"] is True, moved
    assert moved["data"]["travel_minutes"] == 120
    assert moved["data"]["travel_time_source"] == "source_scene_edge"
    assert moved["data"]["time_scene_change"]["elapsed_minutes"] == 120

def test_successful_call_returns_unified_envelope(campaign_ws):
    envelope = _run(campaign_ws, "director.advise", {
        "player_text": "我检查房间里刚才异响的来源。",
        "intent_evidence": {
            "primary_intent": "investigate_scene",
            "reason": "玩家明确要寻找当前场景中异响的来源。",
        },
    })
    assert envelope["ok"] is True
    assert envelope["tool"] == "director.advise"
    assert "data" in envelope
    assert isinstance(envelope["warnings"], list)
    assert isinstance(envelope["hints"], list)
    assert "error" not in envelope

def test_invalid_request_does_not_raise_traceback(campaign_ws):
    # Bad campaign id surfaces as ToolError envelope, not an uncaught exception.
    envelope = coc_toolbox.run_tool(
        "scene.context",
        campaign_ws["workspace"],
        "missing-campaign-id",
        {},
    )
    assert envelope["ok"] is False
    assert envelope["error"]["code"] == "unknown_campaign"

def test_tool_requiring_campaign_without_id_errors():
    envelope = coc_toolbox.run_tool("scene.context", Path("."), None, {})
    assert envelope["ok"] is False
    assert envelope["error"]["code"] == "missing_campaign"
    assert 'top-level "campaign" field' in envelope["error"]["message"]
    assert '"campaign": "<campaign_id>"' in envelope["error"]["message"]

def test_director_advise_is_advisory_not_blocking(campaign_ws):
    envelope = _run(campaign_ws, "director.advise", {
        "player_text": "我检查房间里刚才异响的来源。",
        "intent_evidence": {
            "primary_intent": "investigate_scene",
            "reason": "玩家明确要寻找当前场景中异响的来源。",
        },
    })
    assert envelope["ok"] is True
    data = envelope["data"]
    assert data["authority"] == "advisory"
    assert data["advice_id"].startswith("director:")
    assert isinstance(data["candidate_plan"], dict)
    assert data["intent_evidence"]["primary_intent"] == "investigate_scene"
    # Advisory channel: hints/warnings, never a hard failure for normal play.
    assert isinstance(envelope["warnings"], list)
    assert any("candidate" in h for h in envelope["hints"])

def test_actions_list_gives_noncombat_choices_equal_structured_semantics(campaign_ws):
    moved = _run(
        campaign_ws,
        "state.move_scene",
        {"scene_id": "corbitt-confrontation", "decision_id": "move-actions-final"},
    )
    assert moved["ok"] is True

    envelope = _run(campaign_ws, "actions.list")
    by_id = {row["id"]: row for row in envelope["data"]["affordances"]}
    assert by_id["conventional-assault"]["action_kind"] == "attack"
    assert by_id["conventional-assault"]["resolution_mode"] == "typed_tool"
    assert by_id["flee-and-seal"]["action_kind"] == "retreat"
    assert by_id["flee-and-seal"]["resolution_mode"] == "keeper_adjudication"
    assert any("must not be replaced" in hint for hint in envelope["hints"])

def test_background_flusher_and_director_flag_recovery_share_stable_event_lock(
    campaign_ws, monkeypatch,
):
    decision_id = "director-flag-recovery-vs-background-flush"
    campaign_dir = campaign_ws["campaign_dir"]
    coc_director_apply.apply_plan(
        campaign_dir,
        {
            "decision_id": decision_id,
            "scene_action": "CHARACTER",
            "flags_set": ["director-stable-event-lock-domain"],
            "clue_policy": {"reveal": []},
            "pressure_moves": [],
            "memory_writes": [],
            "rule_signals": {},
        },
        investigator_id=campaign_ws["investigator_id"],
    )
    flags = json.loads(
        (campaign_dir / "save" / "flags.json").read_text(encoding="utf-8")
    )
    receipt = next(
        row for row in flags[
            coc_toolbox.coc_flag_state.DIRECTOR_FLAG_RECEIPTS_KEY
        ].values()
        if row["decision_id"] == decision_id
    )
    events_path = campaign_dir / "logs" / "events.jsonl"
    events_path.write_text(
        "".join(
            json.dumps(row) + "\n"
            for row in _read_jsonl(events_path)
            if row.get("event_id") != receipt["event_id"]
        ),
        encoding="utf-8",
    )
    recorder = coc_toolbox.coc_async_recorder.JsonlRecorder(
        campaign_dir,
        mode="fast",
        decision_id=decision_id,
    )
    recorder.append_jsonl(events_path, receipt["event"])
    assert recorder.commit() is not None

    flusher_at_append = Event()
    release_flusher = Event()
    recovery_started = Event()
    real_append = coc_toolbox.coc_async_recorder._append_jsonl_sync
    operation_kernel = coc_toolbox.coc_operation_kernel
    real_materialize = operation_kernel._materialize_stable_receipt_event

    def pause_flusher(path, record):
        if record.get("event_id") == receipt["event_id"]:
            flusher_at_append.set()
            assert release_flusher.wait(timeout=5)
        return real_append(path, record)

    def observe_recovery(ctx, **kwargs):
        if kwargs.get("event_id") == receipt["event_id"]:
            recovery_started.set()
        return real_materialize(ctx, **kwargs)

    monkeypatch.setattr(
        coc_toolbox.coc_async_recorder, "_append_jsonl_sync", pause_flusher
    )
    monkeypatch.setattr(
        operation_kernel, "_materialize_stable_receipt_event", observe_recovery
    )
    with ThreadPoolExecutor(max_workers=2) as pool:
        flush_future = pool.submit(
            coc_toolbox.coc_async_recorder.flush_pending_records, campaign_dir
        )
        assert flusher_at_append.wait(timeout=5)
        recovery_future = pool.submit(_run, campaign_ws, "scene.context", {})
        assert recovery_started.wait(timeout=5)
        release_flusher.set()
        assert flush_future.result(timeout=5)["flushed_files"] == 1
        assert recovery_future.result(timeout=5)["ok"] is True

    matches = [
        row for row in _read_jsonl(events_path)
        if row.get("event_id") == receipt["event_id"]
    ]
    assert matches == [receipt["event"]]

def test_extra_legacy_flag_cutover_field_is_rejected(campaign_ws):
    path = campaign_ws["campaign_dir"] / "save" / "flags.json"
    document = json.loads(path.read_text(encoding="utf-8"))
    document["flag_event_cutover"] = {"schema_version": 1}
    _write_json(path, document)
    before = path.read_bytes()

    rejected = _run(campaign_ws, "scene.context", {})

    assert rejected["ok"] is False
    assert rejected["error"]["code"] == "state_corrupt"
    assert path.read_bytes() == before

def test_scene_context_exposes_party_investigator_briefs(campaign_ws):
    ctx = coc_toolbox.Ctx(
        campaign_ws["workspace"], campaign_ws["campaign_id"]
    )
    sheet_path = (
        campaign_ws["coc_root"]
        / "investigators"
        / campaign_ws["investigator_id"]
        / "character.json"
    )
    sheet = json.loads(sheet_path.read_text(encoding="utf-8"))
    sheet["derived"].pop("BUILD", None)
    sheet["derived"]["Build"] = 3
    _write_json(sheet_path, sheet)
    state = ctx.inv_state(campaign_ws["investigator_id"])
    state["current_luck"] = 17
    ctx.save_inv_state(campaign_ws["investigator_id"], state)
    context = _run(campaign_ws, "scene.context")
    assert context["ok"] is True
    data = context["data"]
    assert data["party"] == [campaign_ws["investigator_id"]]
    briefs = data["party_investigators"]
    assert len(briefs) == 1
    brief = briefs[0]
    assert brief["investigator_id"] == campaign_ws["investigator_id"]
    assert brief["occupation"]
    assert isinstance(brief["age"], int)
    assert isinstance(brief["app"], int)
    assert isinstance(brief["credit_rating"], int)
    assert brief["credit_tier"] in {
        "penniless", "poor", "average", "wealthy", "rich", "super_rich",
    }
    assert brief["build"] == 3
    assert "mov" in brief
    assert brief["luck"] == 17
    assert isinstance(brief.get("hp"), dict)
    assert "current" in brief["hp"] and "max" in brief["hp"]
    assert isinstance(brief.get("mp"), dict)
    assert "current" in brief["mp"] and "max" in brief["mp"]
    assert set(brief["madness"]) >= {
        "bout_active", "temporary_insane", "indefinite_insane", "delusion_active",
    }
    assert brief["madness"]["bout_active"] is False
    assert isinstance(data.get("discovered_clue_count"), int)
    assert data["discovered_clue_count"] >= 0
    assert isinstance(data.get("discovered_clues_public"), list)
    for row in data["discovered_clues_public"]:
        assert row.get("discovered") is True
        assert "clue_id" in row
        assert "secret" not in row or row.get("secret") is not True

def test_delivered_opening_play_survives_post_activation_pack_deepen(
    tmp_path: Path, monkeypatch,
):
    """Gate4 deadlock regression: after the opening is projected and the scene
    activated, the background deepen lane legitimately rewrites durable packs
    and drifts the whole-payload projection_input_sha256. The delivered opening
    receipt must stay pinned (content anchor unchanged), so the next live-play
    operation passes instead of deadlocking in opening_source_materialization.
    """
    monkeypatch.setenv("COC_DISABLE_QUEUE_WORKER", "1")
    ws = _opening_component_workspace(tmp_path)
    # Projection-side setup runs on the codex host surface (publish_skeleton is
    # not a Pi live-play operation); the gate only governs Pi live play.
    monkeypatch.setenv("COC_HOST", "codex")
    _gate4_project_opening_with_completed_watch(ws)
    monkeypatch.setenv("COC_HOST", "pi")

    activated = _run(ws, "state.move_scene", {
        "scene_id": "opening",
        "decision_id": "gate4-opening-activation",
        "defer_initial_progressive_on_enter": True,
    })
    assert activated["ok"] is True, activated
    assert activated["data"]["to_scene_id"] == "opening"

    _gate4_deepen_opening_pack(ws)

    # Live play continues: pre-fix this deadlocked with opening_setup_incomplete.
    context = _run(ws, "scene.context")
    assert context["ok"] is True, context

def test_pi_bound_source_contract_drift_remains_a_hard_play_gate(
    tmp_path: Path, monkeypatch,
):
    ws = _opening_component_workspace(tmp_path)
    monkeypatch.setenv("COC_HOST", "pi")
    scenario_path = ws["campaign_dir"] / "scenario" / "scenario.json"
    scenario = json.loads(scenario_path.read_text(encoding="utf-8"))
    scenario["source_cache_asset_root_id"] = "missing-opening-root"
    _write_json(scenario_path, scenario)
    world_path = ws["campaign_dir"] / "save" / "world-state.json"
    world_before = world_path.read_bytes()

    blocked = _run(ws, "state.move_scene", {
        "scene_id": "invented-after-drift",
        "decision_id": "must-not-move-after-source-drift",
        "reason": "source authority is unavailable",
    })

    assert blocked["ok"] is False, blocked
    assert blocked["error"]["code"] == "opening_setup_incomplete"
    details = blocked["error"]["details"]
    assert details["hard_gate"] is True
    assert details["activation_allowed"] is False
    assert details["phase"] == "opening_source_contract_invalid"
    assert details["asset_root_id"] == "missing-opening-root"
    assert details["source_contract_error"]["code"] == (
        "opening_identity_missing"
    )
    assert details["next_operation"] is None
    assert world_path.read_bytes() == world_before

def test_lost_watch_never_rearms_bootstrap_after_scene_evidence(
    tmp_path: Path, monkeypatch,
):
    """Lost source work cannot use bootstrap to overwrite played state."""
    monkeypatch.setenv("COC_DISABLE_QUEUE_WORKER", "1")
    monkeypatch.setenv("COC_HOST", "pi")
    ws = _opening_component_workspace(tmp_path)
    _pending_opening_watch(ws, age_seconds=6000)
    module_dir = (
        ws["workspace"] / ".coc" / "module-assets" / ws["asset_root_id"]
    )
    module_dir.mkdir(parents=True, exist_ok=True)
    _write_json(module_dir / "skeleton.json", ws["skeleton"])
    world_path = ws["campaign_dir"] / "save" / "world-state.json"
    world = json.loads(world_path.read_text(encoding="utf-8"))
    world["active_scene_id"] = "opening"
    _write_json(world_path, world)

    blocked = _run(ws, "scene.map")
    assert blocked["ok"] is False, blocked
    details = blocked["error"]["details"]
    assert details["source_lifecycle_status"] == "lost_after_play"
    assert details["next_operation"] is None

def test_re_arm_falls_back_to_a_missing_start_location(
    tmp_path: Path, monkeypatch,
):
    """Without an authored title the card asks for start_location explicitly."""
    monkeypatch.setenv("COC_DISABLE_QUEUE_WORKER", "1")
    ws = _opening_component_workspace(tmp_path)
    monkeypatch.setenv("COC_HOST", "pi")
    _pending_opening_watch(ws, age_seconds=6000)

    blocked = _run(ws, "scene.map")
    details = blocked["error"]["details"]
    assert details["source_lifecycle_status"] == "dispatch_lost"
    next_operation = details["next_operation"]
    assert "start_location" not in next_operation["prefilled_arguments"]
    assert next_operation["missing_arguments"] == ["start_location"]

def test_whole_module_audit_reads_the_field_scenarios_actually_write(campaign_ws):
    """The one place a Keeper can ask what the module is about must answer.

    secrets.briefing read `keeper_overview`/`overview` on the whole-module
    audit path, and no scenario has ever written either name: both shipped
    starters and every extracted module write `keeper_secret_summary`. So the
    audit answered {"value": null} for every scenario that has ever existed,
    and the Keeper reconstructed the plot from scenes and clues instead.

    That matters more than it looks. A Keeper improvising freely is the game
    working as intended; a Keeper improvising because nothing ever told them
    what the module is about is the tool failing quietly.

    Driven through run_tool against the shipped the-haunting starter, so it
    fails if the production lookup regresses — asserting the same expression
    the code uses would pass either way.
    """
    meta = json.loads(
        (campaign_ws["campaign_dir"] / "scenario" / "module-meta.json")
        .read_text(encoding="utf-8")
    )
    assert meta.get("keeper_secret_summary"), "starter fixture lost its secret summary"
    assert "keeper_overview" not in meta and "overview" not in meta

    envelope = _run(campaign_ws, "secrets.briefing", {"scope": "whole_module_audit"})
    module_meta = envelope["data"]["module_meta"]
    assert module_meta["keeper_overview"]["value"] == meta["keeper_secret_summary"]
    assert module_meta["keeper_overview"]["secret"] is True
    assert module_meta["win_condition"]["value"] == meta.get("win_condition")

    # Scene scope stays scene scope: the module-wide truth is not smuggled in.
    scoped = _run(campaign_ws, "secrets.briefing", {})
    assert "keeper_overview" not in scoped["data"]["module_meta"]

def test_pending_deliveries_lists_only_what_the_module_pushes(campaign_ws):
    """Event/automatic clues are surfaced; elected routes are not duplicated here.

    The split matters: offering an event clue as a choice would be wrong, and
    leaving it unsurfaced is how 23% of the library's clues could only arrive if
    the Keeper happened to remember them.
    """
    scenario = campaign_ws["campaign_dir"] / "scenario"
    story = json.loads((scenario / "story-graph.json").read_text(encoding="utf-8"))
    active = story["scenes"][0]
    active["available_clues"] = ["clue-pushed", "clue-earned"]
    (scenario / "story-graph.json").write_text(
        json.dumps(story, ensure_ascii=False), encoding="utf-8"
    )
    (scenario / "clue-graph.json").write_text(json.dumps({"conclusions": [
        {"conclusion_id": "c-core", "importance": "core", "minimum_routes": 1, "clues": [
            {"clue_id": "clue-pushed", "delivery_kind": "event",
             "delivery": "信使在黄昏抵达。", "player_safe_summary": "有人要见你们。"},
        ]},
        {"conclusion_id": "c-side", "importance": "supporting", "minimum_routes": 1, "clues": [
            {"clue_id": "clue-earned", "delivery_kind": "search",
             "delivery": "翻找书桌。", "player_safe_summary": "抽屉里有信。"},
        ]},
    ]}, ensure_ascii=False), encoding="utf-8")

    world_path = campaign_ws["campaign_dir"] / "save" / "world-state.json"
    world = json.loads(world_path.read_text(encoding="utf-8"))
    world["active_scene_id"] = active["scene_id"]
    world_path.write_text(json.dumps(world, ensure_ascii=False), encoding="utf-8")

    data = _run(campaign_ws, "scene.context", {})["data"]
    rows = data["pending_deliveries"]["clues"]
    assert [row["clue_id"] for row in rows] == ["clue-pushed"]
    assert rows[0]["delivery"] == "信使在黄昏抵达。"
    assert data["pending_deliveries"]["keeper_only"] is True

def test_story_thread_orders_by_what_the_main_line_needs(campaign_ws):
    """Assembled by objective, not by location, and grouped per destination."""
    scenario = campaign_ws["campaign_dir"] / "scenario"
    story = json.loads((scenario / "story-graph.json").read_text(encoding="utf-8"))
    here, there = story["scenes"][0], story["scenes"][1]
    here["available_clues"] = ["clue-here"]
    here["scene_edges"] = [{"to": there["scene_id"], "kind": "travel",
                            "when": {"kind": "always", "description": "沿河向北半日。"}}]
    there["available_clues"] = ["clue-there-a", "clue-there-b"]
    (scenario / "story-graph.json").write_text(
        json.dumps(story, ensure_ascii=False), encoding="utf-8"
    )
    (scenario / "clue-graph.json").write_text(json.dumps({"conclusions": [
        {"conclusion_id": "the-plot", "importance": "core", "minimum_routes": 3, "clues": [
            {"clue_id": "clue-here", "delivery_kind": "search", "delivery": "翻找市集流言。"},
            {"clue_id": "clue-there-a", "delivery_kind": "skill_check", "delivery": "与祭司交谈。"},
            {"clue_id": "clue-there-b", "delivery_kind": "search", "delivery": "查看祭坛。"},
        ]},
    ]}, ensure_ascii=False), encoding="utf-8")
    world_path = campaign_ws["campaign_dir"] / "save" / "world-state.json"
    world = json.loads(world_path.read_text(encoding="utf-8"))
    world["active_scene_id"] = here["scene_id"]
    world_path.write_text(json.dumps(world, ensure_ascii=False), encoding="utf-8")

    rows = _run(campaign_ws, "scene.context", {})["data"]["story_thread"]["outstanding"]
    assert [row["objective"] for row in rows] == ["the-plot"]
    row = rows[0]
    assert [c["clue_id"] for c in row["in_this_scene"]] == ["clue-here"]
    # Both remote clues live in one destination, carrying the module's sentence once.
    assert len(row["one_move_away"]) == 1
    assert row["one_move_away"][0]["transition"] == "沿河向北半日。"
    assert len(row["one_move_away"][0]["clues"]) == 2
