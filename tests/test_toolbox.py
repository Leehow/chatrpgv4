"""Cross-cell toolbox compatibility and vertical-contract tests."""
from toolbox_test_support import *

# transcript.* (exact-transcript retrieval) is a canonical namespace; extend the
# shared pin here so this file's namespace coverage includes it.
EXPECTED_NAMESPACES = EXPECTED_NAMESPACES | {"transcript"}

def test_source_edge_destination_deepens_after_travel_without_opening_reuse(
    tmp_path: Path,
    monkeypatch,
):
    monkeypatch.setenv("COC_DISABLE_QUEUE_WORKER", "1")
    ws = _opening_component_workspace(tmp_path)
    pack = _opening_component_pack(scene_edges=[{
        "to": "edge-only-destination",
        "kind": "travel",
        "when": {"kind": "always"},
        "travel_minutes": 120,
    }])
    _publish_and_project_opening_component(ws, pack=pack)
    activated = _run(ws, "state.move_scene", {
        "scene_id": "opening",
        "decision_id": "activate-source-edge-opening",
        "defer_initial_progressive_on_enter": True,
    })
    assert activated["ok"] is True, activated
    context = _run(ws, "scene.context")
    exit_card = next(
        row for row in context["data"]["exits"]
        if row["to"] == "edge-only-destination"
    )
    assert exit_card["travel_minutes"] == 120

    moved = _run(ws, "state.move_scene", {
        **exit_card["operation_opportunity"]["prefilled_arguments"],
        "reason": "follow the exact source-authored route",
        "decision_id": "travel-to-edge-only-destination",
    })

    assert moved["ok"] is True, moved
    assert moved["data"]["scene"] is None
    assert moved["data"]["travel_minutes"] == 120
    assert moved["data"]["travel_time_source"] == "source_scene_edge"
    assert moved["data"]["time_scene_change"]["elapsed_minutes"] == 120
    assert moved["data"]["time_scene_change"]["travel_minutes"] == 120

    followed_dig = _run(ws, "progressive.follow_mentions", {
        "mentions": [{
            "kind": "location",
            "ref_id": "edge-only-destination",
            "raw_label": "Edge-only destination",
        }],
        "reason": "materialize the reached authored destination",
    })

    assert followed_dig["ok"] is True, followed_dig
    followed = followed_dig["data"]["followed"][0]
    assert followed["enqueued"] or followed["deduped"]
    assert followed.get("shared_source_enqueue_skipped") is not True
    assert followed["ref_id"] == "edge-only-destination"
    assets = coc_toolbox.coc_module_project.coc_module_assets
    stub = assets.get_entity(
        ws["workspace"],
        ws["asset_root_id"],
        "location",
        "edge-only-destination",
    )
    assert stub is not None
    assert stub["source_page_indices"] == [0]
    skeleton = assets.get_skeleton(ws["workspace"], ws["asset_root_id"])
    assert skeleton["start_candidates"] == ["opening"]
    assert "edge-only-destination" not in skeleton["start_candidates"]

def test_campaign_lock_shared_reads_overlap_and_writes_remain_exclusive(
    tmp_path: Path,
):
    campaign_dir = tmp_path / "campaign"
    readers_ready = Barrier(2)
    both_reading = Event()
    release_reads = Event()
    reader_count = 0
    count_lock = Lock()

    def shared_reader() -> None:
        nonlocal reader_count
        readers_ready.wait(timeout=2)
        with coc_toolbox.coc_fileio.campaign_lock(
            campaign_dir, mode="shared", wait_seconds=2,
        ):
            with count_lock:
                reader_count += 1
                if reader_count == 2:
                    both_reading.set()
            assert release_reads.wait(2)

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(shared_reader) for _ in range(2)]
        assert both_reading.wait(2), "shared readers did not overlap"
        release_reads.set()
        for future in futures:
            future.result(timeout=2)

    writer_entered = Event()
    release_writer = Event()
    late_reader_entered = Event()

    def writer() -> None:
        with coc_toolbox.coc_fileio.campaign_lock(campaign_dir, wait_seconds=2):
            writer_entered.set()
            assert release_writer.wait(2)

    def late_reader() -> None:
        assert writer_entered.wait(2)
        with coc_toolbox.coc_fileio.campaign_lock(
            campaign_dir, mode="shared", wait_seconds=2,
        ):
            late_reader_entered.set()

    with ThreadPoolExecutor(max_workers=2) as pool:
        writer_future = pool.submit(writer)
        assert writer_entered.wait(2)
        reader_future = pool.submit(late_reader)
        assert not late_reader_entered.wait(0.1), "read crossed active writer"
        release_writer.set()
        writer_future.result(timeout=2)
        reader_future.result(timeout=2)
    assert late_reader_entered.is_set()

def test_run_tool_lock_dispatch_uses_execution_class_only(campaign_ws, monkeypatch):
    modes: list[str] = []

    @contextmanager
    def recorded_lock(_campaign_dir, **kwargs):
        modes.append(str(kwargs.get("mode", "exclusive")))
        yield campaign_ws["campaign_dir"] / ".campaign.lock"

    def handler(_ctx, _args):
        return {"observed": True}, [], []

    parallel_name = "test.parallel_read_lock_dispatch"
    unknown_name = "test.unknown_lock_dispatch"
    coc_toolbox.TOOLS[parallel_name] = {
        "name": parallel_name,
        "summary": "test only",
        "params": {},
        "needs_campaign": True,
        "strict_read_only": True,
        "execution_class": "parallel_read",
        "handler": handler,
    }
    coc_toolbox.TOOLS[unknown_name] = {
        "name": unknown_name,
        "summary": "test only",
        "params": {},
        "needs_campaign": True,
        "strict_read_only": True,
        "execution_class": "not-a-class",
        "handler": handler,
    }
    monkeypatch.setattr(coc_toolbox.coc_fileio, "campaign_lock", recorded_lock)
    try:
        assert _run(campaign_ws, parallel_name)["ok"] is True
        assert _run(campaign_ws, unknown_name)["ok"] is True
    finally:
        coc_toolbox.TOOLS.pop(parallel_name, None)
        coc_toolbox.TOOLS.pop(unknown_name, None)
    assert modes == ["shared", "exclusive"]

def test_list_tools_covers_expected_namespaces():
    tools = coc_toolbox.list_tools()
    names = {entry["name"] for entry in tools}
    assert names == set(coc_toolbox.TOOLS)
    namespaces = {name.split(".", 1)[0] for name in names}
    assert namespaces == EXPECTED_NAMESPACES
    # Hard / advisory / write surfaces all present.
    assert any(n.startswith("rules.") for n in names)
    assert any(n.startswith("scene.") or n.startswith("clues.") for n in names)
    assert any(n.startswith("director.") or n.startswith("storylets.") for n in names)
    assert any(n.startswith("state.") for n in names)
    for entry in tools:
        assert entry["summary"]

def test_run_tool_unknown_name_returns_error_envelope():
    envelope = coc_toolbox.run_tool("no.such.tool", Path("."), None, {})
    assert envelope["ok"] is False
    assert envelope["tool"] == "no.such.tool"
    assert envelope["error"]["code"] == "unknown_tool"
    assert "unknown tool" in envelope["error"]["message"]

def test_describe_cli_unknown_tool_exits_nonzero():
    proc = subprocess.run(
        [PYTHON, str(TOOLBOX_SCRIPT), "describe", "no.such.tool"],
        cwd=REPO,
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode != 0
    payload = json.loads(proc.stdout)
    assert payload["ok"] is False
    assert payload["error"]["code"] == "unknown_tool"

def test_clock_discontinuity_is_canonical_idempotent_and_visible_to_scene_context(
    campaign_ws,
):
    before_context = _run(campaign_ws, "scene.context")
    before_location = before_context["data"]["time"]["location_id"]
    advanced = _run(campaign_ws, "state.advance_time", {
        "minutes": 19,
        "reason": "crossing before the temporal displacement",
        "decision_id": "pre-discontinuity-advance",
    })
    assert advanced["ok"] is True

    args = {
        "discontinuity_kind": "time_shift",
        "calendar_mode": "julian",
        "precision": "day_phase",
        "display": "1287年1月1日，上半夜（具体时刻未知）",
        "local_date": "1287-01-01",
        "day_phase": "night",
        "source_ref": "module:page-17#forest-arrival",
        "reason": "the source-authored bell displaced the party into 1287",
        "decision_id": "canonical-clock-discontinuity",
    }
    first = _run(campaign_ws, "state.clock_discontinuity", args)
    replay = _run(campaign_ws, "state.clock_discontinuity", args)

    assert first["ok"] is True, first
    assert first["data"]["elapsed_minutes"] == 19
    assert first["data"]["relative_deadlines_preserved"] is True
    assert first["data"]["civil_time"]["local_datetime"] is None
    assert first["data"]["civil_time"]["local_date"] == "1287-01-01"
    assert replay["data"] == first["data"]
    assert any("duplicate decision_id" in row for row in replay["warnings"])

    context = _run(campaign_ws, "scene.context")
    assert context["ok"] is True
    stamp = context["data"]["time"]
    assert stamp["elapsed_minutes"] == 19
    assert stamp["calendar_mode"] == "julian"
    assert stamp["local_datetime"] is None
    assert stamp["local_date"] == "1287-01-01"
    assert stamp["day_phase"] == "night"
    assert stamp["location_id"] == before_location

    bad = _run(campaign_ws, "state.clock_discontinuity", {
        **args,
        "precision": "minute",
        "decision_id": "canonical-clock-discontinuity-bad",
    })
    assert bad["ok"] is False
    assert bad["error"]["code"] == "invalid_param"

    dawn = _run(campaign_ws, "state.advance_time", {
        "minutes": 180,
        "reason": "wait for the first morning bell",
        "day_phase_after": "morning",
        "display_after": "1287年1月1日，清晨（具体时刻未知）",
        "decision_id": "advance-to-first-bell",
    })
    assert dawn["ok"] is True, dawn
    assert dawn["data"]["current_time"]["local_datetime"] is None
    assert dawn["data"]["current_time"]["day_phase"] == "morning"
    assert dawn["data"]["current_time"]["display"] == (
        "1287年1月1日，清晨（具体时刻未知）"
    )

def test_structured_full_sleep_updates_director_rest_continuity(campaign_ws):
    advanced = _run(campaign_ws, "state.advance_time", {
        "minutes": 600,
        "reason": "structured time passage before a completed sleep",
        "decision_id": "advance-before-full-sleep",
    })
    assert advanced["ok"] is True, advanced
    before = _run(campaign_ws, "director.advise", {
        "player_text": "我整理接下来要查的材料。",
        "intent_evidence": {
            "primary_intent": "prepare",
            "reason": "玩家准备下一步调查。",
        },
        "decision_id": "advise-before-full-sleep",
    })
    assert before["data"]["context_summary"]["time_signals"][
        "hours_since_last_rest"
    ] == 10.0

    rested = _run(campaign_ws, "state.mark_safe_rest", {
        "investigator": campaign_ws["investigator_id"],
        "rest_kind": "full_sleep",
        "decision_id": "record-completed-full-sleep",
    })
    assert rested["ok"] is True, rested
    assert rested["data"]["time_signals"]["hours_since_last_rest"] == 0.0
    assert rested["data"]["at_elapsed"] == 600

    after = _run(campaign_ws, "director.advise", {
        "player_text": "我整理接下来要查的材料。",
        "intent_evidence": {
            "primary_intent": "prepare",
            "reason": "玩家睡醒后准备下一步调查。",
        },
        "decision_id": "advise-after-full-sleep",
    })
    assert after["data"]["context_summary"]["time_signals"][
        "hours_since_last_rest"
    ] == 0.0
    time_state = json.loads(
        (campaign_ws["campaign_dir"] / "save" / "time-state.json").read_text(
            encoding="utf-8"
        )
    )
    assert time_state["anchors"]["last_rest_elapsed"] == 600
    safe_rest_rows = [
        row for row in _read_jsonl(
            campaign_ws["campaign_dir"] / "logs" / "time.jsonl"
        )
        if row.get("event_type") == "safe_rest"
    ]
    assert safe_rest_rows == [{
        "event_type": "safe_rest",
        "investigator_id": campaign_ws["investigator_id"],
        "at_elapsed": 600,
        "rest_kind": "full_sleep",
        "decision_id": "record-completed-full-sleep",
    }]
    journaled = _run(campaign_ws, "state.journal", {
        "summary": "调查员在安全地点完成整夜睡眠。",
        "player_action": "完整休息过夜",
        "player_text": "我在安全地点完整休息过夜。",
        "intent_class": "rest",
        "decision_id": "journal-completed-full-sleep",
    })
    assert journaled["ok"] is True, journaled
    output = _run(campaign_ws, "turn.output_context")
    assert output["ok"] is True, output
    assert [
        row["effect_kind"]
        for row in output["data"]["mechanics_bundle"]["state_delta"]
    ] == ["time", "rest"]

@pytest.mark.parametrize(
    ("tool_name", "args"),
    [
        (
            "rules.luck_spend",
            {"points": 1, "source_roll_id": "missing-decision-source"},
        ),
        ("rules.first_aid", {"skill_value": 50}),
        ("rules.medicine", {"skill_value": 50}),
        (
            "rules.weekly_recovery",
            {"complete_rest": True, "poor_environment": False},
        ),
        ("rules.dying_check", {"clock_kind": "round"}),
        ("state.set_flag", {"flag_id": "missing-id"}),
        (
            "state.clear_transient_condition",
            {"condition": "prone", "reason": "stood up outside combat"},
        ),
        (
            "state.record_npc_engagement",
            {"npc_id": "npc-steven-knott", "interaction_kind": "dialogue"},
        ),
        (
            "state.npc_presence",
            {
                "npc_id": "npc-steven-knott",
                "scene_id": "neighborhood-gossip",
                "status": "present",
                "reason": "Knott is speaking here",
            },
        ),
        ("state.npc_update", {"npc_id": "npc-steven-knott", "trust_delta": 1}),
        (
            "state.time_marker",
            {"action": "set", "marker_id": "police-check-in", "minutes_from_now": 10},
        ),
    ],
)
def test_mutating_tools_require_decision_id(campaign_ws, tool_name, args):
    envelope = _run(campaign_ws, tool_name, args)
    assert envelope["ok"] is False
    assert envelope["error"]["code"] == "missing_param"
    assert "decision_id" in envelope["error"]["message"]

def test_roll_dice_batch_expression_error_names_one_per_call_syntax(tmp_path):
    coc_toolbox.run_tool(
        "setup.invoke", tmp_path, None,
        {"kind": "campaign.create", "payload": {"campaign_id": "dice-steer", "title": "D"}},
    )
    envelope = coc_toolbox.run_tool(
        "rules.roll_dice", tmp_path, "dice-steer",
        {"expression": "3D6x2;3D6x2;2D6+6", "decision_id": "dice-steer-1"},
    )
    assert envelope["ok"] is False
    message = envelope["error"]["message"]
    assert "one NdM(+/-k) expression per call" in message
    assert "roll each part of an array as its own rules.roll_dice call" in message

@pytest.mark.parametrize("expression", ["3D6*2", "3D6x2", "3D6×5", "3D6 * 5", "3d6*2"])
def test_roll_dice_multiplier_expression_steers_to_base_roll(tmp_path, expression):
    coc_toolbox.run_tool(
        "setup.invoke", tmp_path, None,
        {"kind": "campaign.create", "payload": {"campaign_id": "dice-mult", "title": "M"}},
    )
    envelope = coc_toolbox.run_tool(
        "rules.roll_dice", tmp_path, "dice-mult",
        {"expression": expression, "decision_id": f"dice-mult-{expression}"},
    )
    assert envelope["ok"] is False
    message = envelope["error"]["message"]
    assert "post-roll characteristic conversion" in message
    assert "expression='3D6'" in message
    assert "multiply the returned total" in message

def test_unknown_tool_errors_suggest_gateway_tools_and_close_names():
    gateway = coc_toolbox.run_tool("coc_capabilities", Path("."), None, {})
    assert gateway["error"]["code"] == "unknown_tool"
    assert "top-level gateway tool, not a coc_invoke operation" in (
        gateway["error"]["message"]
    )

    close = coc_toolbox.run_tool("rules.rolldice", Path("."), None, {})
    assert close["error"]["code"] == "unknown_tool"
    assert "did you mean: rules.roll_dice" in close["error"]["message"]

def test_rules_opposed_fumble_binds_exceptional_effect(campaign_ws):
    # Regression: an opposed critical/fumble (e.g. a POW vs POW contest) must
    # bind through state.exceptional_effect.  The source roll lives in
    # logs/rolls.jsonl with kind=opposed_check; the owning decision_id is
    # resolved from the canonical rules.opposed ledger entry.
    settled = _run(
        campaign_ws,
        "rules.opposed",
        {
            "contest_kind": "noncombat",
            "investigator": campaign_ws["investigator_id"],
            "skill": "POW",
            "target": 40,
            "opponent_value": 60,
            "opponent_label": "a will that is not his own",
            "reason": "resist the alien will gripping his mind",
            "decision_id": "opposed-pow-fumble",
            "seed": 23,
        },
    )
    assert settled["ok"] is True, settled
    assert settled["data"]["investigator_roll"]["outcome"] == "fumble"
    roll_id = settled["data"]["investigator_roll_id"]
    assert any(
        "state.exceptional_effect" in hint for hint in settled["hints"]
    )

    scene_id = json.loads(
        (campaign_ws["campaign_dir"] / "save" / "world-state.json").read_text(
            encoding="utf-8"
        )
    )["active_scene_id"]
    applied = _run(
        campaign_ws,
        "state.exceptional_effect",
        {
            "action": "apply",
            "source_roll_id": roll_id,
            "direction": "cost",
            "effect_kind": "scene_event",
            "player_visible_impact": "他的意志被短暂碾碎，呆立当场，脱困的窗口在眼前关闭",
            "causal_link": "意志对抗掷出100大失败，外来意志趁隙压垮了他的自我",
            "boundary": {"kind": "until_scene_end", "scene_id": scene_id},
            "mechanics": {
                "scene_id": scene_id,
                "event_id": "will-shattered-window-lost",
                "change_kind": "loss",
            },
            "visibility": "player_visible",
            "decision_id": "opposed-pow-fumble-effect",
        },
    )
    assert applied["ok"] is True, applied
    source = applied["data"]["effect"]["source_roll"]
    assert source["tool"] == "rules.opposed"
    assert source["decision_id"] == "opposed-pow-fumble"
    assert source["roll_id"] == roll_id
    assert source["outcome"] == "fumble"

@pytest.mark.parametrize("skill", ["Psychology", "心理学"])
def test_rules_roll_rejects_psychology_in_favor_of_hidden_window_contract(
    campaign_ws, skill
):
    rolls_path = campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"
    before = rolls_path.read_text(encoding="utf-8") if rolls_path.exists() else ""
    envelope = _run(
        campaign_ws,
        "rules.roll",
        {
            "investigator": campaign_ws["investigator_id"],
            "skill": skill,
            "seed": 7,
            "decision_id": "zh-alias-psychology",
        },
    )

    assert envelope["ok"] is False
    assert envelope["error"]["code"] == "psychology_observe_required"
    assert "rules.psychology_observe" in envelope["error"]["message"]
    after = rolls_path.read_text(encoding="utf-8") if rolls_path.exists() else ""
    assert after == before

def test_intermediate_schema4_contradiction_fails_before_migration_mutation(
    campaign_ws,
):
    decision_id = "intermediate-schema4-contradiction"
    assert _run(
        campaign_ws,
        "rules.roll",
        {"skill": "Spot Hidden", "decision_id": decision_id, "seed": 5},
    )["ok"] is True
    receipt_path = (
        campaign_ws["campaign_dir"] / "save" / "roll-operation-receipts.json"
    )
    document = json.loads(receipt_path.read_text(encoding="utf-8"))
    receipt = document["receipts"]["rules.roll"][decision_id]
    receipt["operation"]["skill"] = "Stealth"
    receipt["fingerprint"] = coc_toolbox._operation_fingerprint(
        "rules.roll", receipt["operation"]
    )
    receipt[coc_toolbox._SOURCE_RECEIPT_INTEGRITY_KEY] = (
        coc_toolbox._source_receipt_integrity(receipt)
    )
    _write_json(receipt_path, document)
    rolls_path = campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"
    state_path = (
        campaign_ws["campaign_dir"]
        / "save"
        / "investigator-state"
        / f"{campaign_ws['investigator_id']}.json"
    )
    ledger_path = campaign_ws["campaign_dir"] / "save" / "toolbox-ledger.json"
    before = tuple(
        path.read_bytes()
        for path in (receipt_path, rolls_path, state_path, ledger_path)
    )

    rejected = _run(
        campaign_ws,
        "state.journal",
        {"summary": "ambiguous selector", "player_text": "我继续调查。", "decision_id": "after-selector-ambiguity"},
    )

    assert rejected["ok"] is False
    assert rejected["error"]["code"] == "state_corrupt"
    assert tuple(
        path.read_bytes()
        for path in (receipt_path, rolls_path, state_path, ledger_path)
    ) == before

def test_roll_receipt_replays_after_san_target_changes(campaign_ws):
    args = {
        "investigator": campaign_ws["investigator_id"],
        "characteristic": "SAN",
        "reason": "san before loss",
        "decision_id": "mutable-san-target-roll",
        "seed": 7,
    }
    first = _run(campaign_ws, "rules.roll", args)
    assert first["ok"] is True
    changed = _run(
        campaign_ws,
        "rules.sanity_check",
        {
            "investigator": campaign_ws["investigator_id"],
            "source": "mutable target regression",
            "loss_success": "1",
            "loss_failure": "1",
            "decision_id": "mutable-san-loss",
            "seed": 19,
        },
    )
    assert changed["ok"] is True
    assert changed["data"]["san_loss"] == 1

    replay = _run(campaign_ws, "rules.roll", {**args, "seed": 999})

    assert replay["ok"] is True
    assert replay["data"] == first["data"]

def test_roll_receipt_prefix_tamper_fails_closed_without_log_mutation(campaign_ws):
    decision_id = "tampered-roll-prefix"
    settled = _run(
        campaign_ws,
        "rules.roll_dice",
        {"expression": "1D6", "decision_id": decision_id, "seed": 7},
    )
    assert settled["ok"] is True
    receipt_path = (
        campaign_ws["campaign_dir"] / "save" / "roll-operation-receipts.json"
    )
    document = json.loads(receipt_path.read_text(encoding="utf-8"))
    receipt = document["receipts"]["rules.roll_dice"][decision_id]
    receipt["log_prefix_sha256"] = f"sha256:{'0' * 64}"
    receipt[coc_toolbox._SOURCE_RECEIPT_INTEGRITY_KEY] = (
        coc_toolbox._source_receipt_integrity(receipt)
    )
    _write_json(receipt_path, document)
    rolls_path = campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"
    before = rolls_path.read_bytes()

    rejected = _run(
        campaign_ws,
        "state.journal",
        {"summary": "must not pass tamper", "player_text": "我继续调查。", "decision_id": "after-roll-tamper"},
    )

    assert rejected["ok"] is False
    assert rejected["error"]["code"] == "state_corrupt"
    assert rolls_path.read_bytes() == before

@pytest.mark.parametrize(
    ("tool_name", "args", "resolution_field", "tampered_value"),
    [
        (
            "rules.roll_dice",
            {"expression": "1D6", "decision_id": "dice-resolution-tamper"},
            "sides",
            999,
        ),
        (
            "rules.roll",
            {
                "skill": "Library Use",
                "decision_id": "percentile-resolution-tamper",
            },
            "resolved_target",
            999,
        ),
        (
            "rules.roll_dice",
            {"expression": "1D6", "decision_id": "dice-resolution-extra-field"},
            "unexpected",
            1,
        ),
        (
            "rules.roll",
            {
                "skill": "Library Use",
                "decision_id": "percentile-resolution-wrong-type",
            },
            "target_source",
            7,
        ),
    ],
)
def test_coordinated_resolution_tamper_is_rejected_without_evidence_mutation(
    campaign_ws, tool_name, args, resolution_field, tampered_value
):
    if tool_name == "rules.roll":
        args = {**args, "investigator": campaign_ws["investigator_id"]}
    settled = _run(campaign_ws, tool_name, {**args, "seed": 7})
    assert settled["ok"] is True
    receipt_path = (
        campaign_ws["campaign_dir"] / "save" / "roll-operation-receipts.json"
    )
    document = json.loads(receipt_path.read_text(encoding="utf-8"))
    receipt = document["receipts"][tool_name][args["decision_id"]]
    receipt["resolution"][resolution_field] = tampered_value
    receipt[coc_toolbox._SOURCE_RECEIPT_INTEGRITY_KEY] = (
        coc_toolbox._source_receipt_integrity(receipt)
    )
    _write_json(receipt_path, document)
    receipt_bytes = receipt_path.read_bytes()
    rolls_path = campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"
    roll_bytes = rolls_path.read_bytes()

    rejected = _run(
        campaign_ws,
        "state.journal",
        {
            "summary": "resolution contradiction must fail",
            "player_text": "我继续调查。",
            "decision_id": f"after-{args['decision_id']}",
        },
    )

    assert rejected["ok"] is False
    assert rejected["error"]["code"] == "state_corrupt"
    assert receipt_path.read_bytes() == receipt_bytes
    assert rolls_path.read_bytes() == roll_bytes

def test_coordinated_dice_receipt_and_log_tamper_fails_before_any_mutation(
    campaign_ws,
):
    decision_id = "coordinated-dice-log-tamper"
    assert _run(
        campaign_ws,
        "rules.roll_dice",
        {"expression": "1D6", "decision_id": decision_id, "seed": 7},
    )["ok"] is True
    receipt_path = (
        campaign_ws["campaign_dir"] / "save" / "roll-operation-receipts.json"
    )
    document = json.loads(receipt_path.read_text(encoding="utf-8"))
    receipt = document["receipts"]["rules.roll_dice"][decision_id]
    receipt["resolution"]["sides"] = 999
    receipt["data"]["sides"] = 999
    receipt["roll_record"]["sides"] = 999
    receipt["roll_record"]["payload"]["sides"] = 999
    receipt[coc_toolbox._SOURCE_RECEIPT_INTEGRITY_KEY] = (
        coc_toolbox._source_receipt_integrity(receipt)
    )
    _write_json(receipt_path, document)
    rolls_path = campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"
    rolls_path.write_text(
        json.dumps(receipt["roll_record"], ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    state_path = (
        campaign_ws["campaign_dir"]
        / "save"
        / "investigator-state"
        / f"{campaign_ws['investigator_id']}.json"
    )
    before = (receipt_path.read_bytes(), rolls_path.read_bytes(), state_path.read_bytes())

    rejected = _run(
        campaign_ws,
        "state.journal",
        {"summary": "mechanical contradiction", "player_text": "我继续调查。", "decision_id": "after-dice-log-tamper"},
    )

    assert rejected["ok"] is False
    assert rejected["error"]["code"] == "state_corrupt"
    assert (receipt_path.read_bytes(), rolls_path.read_bytes(), state_path.read_bytes()) == before

@pytest.mark.parametrize(
    "tampered_reason",
    ["a different frozen reason", {"not": "a string"}],
)
def test_current_dice_reason_tamper_fails_global_preflight_without_mutation(
    campaign_ws, tampered_reason
):
    decision_id = "current-dice-reason-contract"
    assert _run(
        campaign_ws,
        "rules.roll_dice",
        {
            "expression": "1D6",
            "reason": "original frozen reason",
            "decision_id": decision_id,
            "seed": 7,
        },
    )["ok"] is True
    receipt_path = (
        campaign_ws["campaign_dir"] / "save" / "roll-operation-receipts.json"
    )
    document = json.loads(receipt_path.read_text(encoding="utf-8"))
    receipt = document["receipts"]["rules.roll_dice"][decision_id]
    receipt["operation"]["reason"] = tampered_reason
    receipt["fingerprint"] = coc_toolbox._operation_fingerprint(
        "rules.roll_dice", receipt["operation"]
    )
    receipt[coc_toolbox._SOURCE_RECEIPT_INTEGRITY_KEY] = (
        coc_toolbox._source_receipt_integrity(receipt)
    )
    _write_json(receipt_path, document)
    rolls_path = campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"
    state_path = (
        campaign_ws["campaign_dir"]
        / "save"
        / "investigator-state"
        / f"{campaign_ws['investigator_id']}.json"
    )
    ledger_path = campaign_ws["campaign_dir"] / "save" / "toolbox-ledger.json"
    before = tuple(
        path.read_bytes()
        for path in (receipt_path, rolls_path, state_path, ledger_path)
    )

    rejected = _run(
        campaign_ws,
        "state.journal",
        {"summary": "detect dice reason damage", "player_text": "我继续调查。", "decision_id": "after-dice-reason"},
    )

    assert rejected["ok"] is False
    assert rejected["error"]["code"] == "state_corrupt"
    assert tuple(
        path.read_bytes()
        for path in (receipt_path, rolls_path, state_path, ledger_path)
    ) == before

@pytest.mark.parametrize("skill", [
    "Dodge", "Fighting (Brawl)", "Firearms (Handgun)", "Artillery",
])
def test_failed_combat_skill_roll_is_refused_a_push_and_never_advises_one(
    campaign_ws, skill,
):
    """CoC7 removes the push option from combat rolls; the roll surface obeys.

    ``rules.roll`` used to close a failed Fighting/Firearms/Dodge/Artillery
    check by emitting an ``open_push_or_context_change`` opportunity and a
    hint naming ``rules.push``, and ``rules.push`` then settled the pushed
    roll. Both are the rulebook's "No Pushing Combat Rolls" (p.116), stated
    again per skill on p.71/75/76.
    """
    original_id = f"combat-skill-no-push-{skill[:8].strip().lower()}"
    rolled = _failed_roll_for_push(campaign_ws, original_id, skill=skill)
    assert rolled["data"]["push_eligible"] is False
    assert rolled["data"].get("operation_opportunities") in (None, [])
    assert not any(
        "rules.push" in hint for hint in rolled.get("hints") or []
    )
    pushed = _run(campaign_ws, "rules.push", {
        "original_check_decision_id": original_id,
        "method_changed": "throw everything into the next attempt",
        "failure_consequence": "the opening closes for good",
        "decision_id": f"{original_id}-push",
        "seed": 3,
    })
    assert pushed["ok"] is False, pushed
    assert pushed["error"]["code"] == "invalid_push"
    assert "combat skill" in pushed["error"]["message"]


def test_failed_ordinary_skill_roll_still_advises_and_allows_its_push(
    campaign_ws,
):
    """The combat-skill guard must leave every other failed check pushable."""
    original_id = "ordinary-skill-still-pushable"
    rolled = _failed_roll_for_push(campaign_ws, original_id)
    assert "push_eligible" not in rolled["data"]
    assert [row["kind"] for row in rolled["data"]["operation_opportunities"]] == [
        "open_push_or_context_change"
    ]
    pushed = _run(campaign_ws, "rules.push", {
        "original_check_decision_id": original_id,
        "method_changed": "search a different archive",
        "failure_consequence": "the archive closes",
        "decision_id": f"{original_id}-push",
        "seed": 3,
    })
    assert pushed["ok"] is True, pushed


@pytest.mark.parametrize(
    ("tool_name", "operation_field", "tampered_value"),
    [
        ("rules.roll", "required_level", "extreme"),
        ("rules.roll", "bonus", 99),
        ("rules.roll", "bonus", True),
        ("rules.roll", "reason", {"bad": "type"}),
        ("rules.roll", "fumble_consequence", "a different fumble"),
        ("rules.push", "method_changed", "a different method"),
        ("rules.push", "failure_consequence", "a different consequence"),
        ("rules.push", "pushed", False),
    ],
)
def test_current_percentile_invocation_tamper_fails_before_mutation(
    campaign_ws, tool_name, operation_field, tampered_value
):
    decision_id = (
        f"current-percentile-{tool_name}-{operation_field}-"
        f"{type(tampered_value).__name__}"
    )
    if tool_name == "rules.push":
        original_decision_id = f"{decision_id}-original"
        _failed_roll_for_push(campaign_ws, original_decision_id)
        args = {
            "original_check_decision_id": original_decision_id,
            "method_changed": "search a different archive",
            "failure_consequence": "the archive closes",
            "fumble_consequence": "the archive shelves collapse",
            "decision_id": decision_id,
            "seed": 4,
        }
    else:
        args = {
            "investigator": campaign_ws["investigator_id"],
            "skill": "Library Use",
            "difficulty": "hard",
            "bonus": 1,
            "reason": "original percentile reason",
            "fumble_consequence": "original fumble consequence",
            "decision_id": decision_id,
            "seed": 4,
        }
    assert _run(campaign_ws, tool_name, args)["ok"] is True
    receipt_path = (
        campaign_ws["campaign_dir"] / "save" / "roll-operation-receipts.json"
    )
    document = json.loads(receipt_path.read_text(encoding="utf-8"))
    receipt = document["receipts"][tool_name][decision_id]
    receipt["operation"][operation_field] = tampered_value
    receipt["fingerprint"] = coc_toolbox._operation_fingerprint(
        tool_name, receipt["operation"]
    )
    receipt[coc_toolbox._SOURCE_RECEIPT_INTEGRITY_KEY] = (
        coc_toolbox._source_receipt_integrity(receipt)
    )
    _write_json(receipt_path, document)
    rolls_path = campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"
    state_path = (
        campaign_ws["campaign_dir"]
        / "save"
        / "investigator-state"
        / f"{campaign_ws['investigator_id']}.json"
    )
    ledger_path = campaign_ws["campaign_dir"] / "save" / "toolbox-ledger.json"
    before = tuple(
        path.read_bytes()
        for path in (receipt_path, rolls_path, state_path, ledger_path)
    )

    rejected = _run(
        campaign_ws,
        "state.journal",
        {
            "summary": "detect percentile invocation damage",
            "player_text": "我继续调查。",
            "decision_id": f"after-{decision_id}",
        },
    )

    assert rejected["ok"] is False
    assert rejected["error"]["code"] == "state_corrupt"
    assert tuple(
        path.read_bytes()
        for path in (receipt_path, rolls_path, state_path, ledger_path)
    ) == before

def test_rules_luck_spend_rejects_a_roll_after_turn_finalization(campaign_ws):
    source = _run(campaign_ws, "rules.roll", {
        "investigator": campaign_ws["investigator_id"],
        "skill": "Library Use",
        "target": 50,
        "decision_id": "finalized-luck-source",
        "seed": 88,
    })
    assert source["data"]["roll"] == 51
    journaled = _run(campaign_ws, "state.journal", {
        "summary": "调查员没有在本轮结算前花费幸运，尝试失败。",
        "player_action": "完成一次失败的图书馆使用检定",
        "player_text": "我试着从图书馆资料中找出线索。",
        "intent_class": "investigate",
        "decision_id": "finalized-luck-journal",
    })
    assert journaled["ok"] is True
    finalized = _finalize_pending_turn_for_test(
        campaign_ws, decision_id="finalized-luck-finalize"
    )
    assert finalized["ok"] is True

    rejected = _run(campaign_ws, "rules.luck_spend", {
        "investigator": campaign_ws["investigator_id"],
        "source_roll_id": source["data"]["roll_id"],
        "points": 1,
        "decision_id": "too-late-luck-spend",
    })

    assert rejected["ok"] is False
    assert rejected["error"]["code"] == "invalid_state"
    assert "before turn.finalize" in rejected["error"]["message"]

def test_pending_journal_rejects_later_state_mutation_before_it_writes(campaign_ws):
    journal_args = {
        "summary": "本轮到此结算。",
        "player_action": "结束本轮",
        "player_text": "我结束这一轮行动。",
        "intent_class": "investigate",
        "decision_id": "journal-before-illegal-move",
    }
    journaled = _run(campaign_ws, "state.journal", journal_args)
    assert journaled["ok"] is True
    before = json.loads(
        (campaign_ws["campaign_dir"] / "save" / "world-state.json").read_text(
            encoding="utf-8"
        )
    )

    rejected = _run(campaign_ws, "state.move_scene", {
        "scene_id": "post-journal-place",
        "decision_id": "illegal-post-journal-move",
    })
    duplicate = _run(campaign_ws, "state.journal", journal_args)

    assert rejected["ok"] is False
    assert rejected["error"]["code"] == "turn_pending_finalization"
    assert duplicate["ok"] is True
    after = json.loads(
        (campaign_ws["campaign_dir"] / "save" / "world-state.json").read_text(
            encoding="utf-8"
        )
    )
    assert after == before

def test_terminal_state_precedes_journal_and_finalization(campaign_ws):
    ended = _run(campaign_ws, "state.end_session", {
        "kind": "retreat",
        "summary": "调查员拒绝委托，故事至此结束。",
        "decision_id": "terminal-state-before-finalize",
    })
    assert ended["ok"] is True, ended
    assert ended["data"]["session_ending"] is True

    journaled = _run(campaign_ws, "state.journal", {
        "summary": "调查员拒绝委托，故事在事务所收束。",
        "player_action": "拒绝委托并离开",
        "player_text": "我不接这份委托，转身离开。",
        "intent_class": "interact",
        "decision_id": "journal-after-terminal-state",
    })
    assert journaled["ok"] is True
    assert coc_toolbox.coc_turn_manifest.pending_manifest(campaign_ws["campaign_dir"]) is not None

    # The ending settles a public development luck-recovery roll, so the
    # finalize contract requires causal coverage and a mechanics placement.
    ending_result = "已结算的幸运恢复与拒绝委托的结局按其原有因果关系落地。这个故事至此结束。"
    finalized = _finalize_pending_turn_for_test(
        campaign_ws,
        decision_id="terminal-state-before-finalize:receipt",
        draft="调查员没有接过钥匙，转身离开。\n\n" + ending_result,
        result_paragraph=ending_result,
    )
    assert finalized["data"]["rendered_text"].endswith("这个故事至此结束。")

    resumed = _run(campaign_ws, "session.resume")
    assert resumed["ok"] is True, resumed
    assert resumed["data"]["mode"] == "ending"
    assert resumed["data"]["next_operations"] == []
    assert resumed["data"]["ending_output"]["rendered_text"] == finalized["data"]["rendered_text"]
    assert resumed["data"]["ending_output"]["rendered_sha256"] == finalized["data"]["rendered_text_sha256"]

def test_pending_journal_allows_scene_context_before_finalization(campaign_ws):
    journaled = _run(campaign_ws, "state.journal", {
        "summary": "本轮状态已经结算，KP 随后读取场景投影用于组织输出。",
        "player_action": "结束本轮",
        "player_text": "我结束这一轮行动。",
        "intent_class": "investigate",
        "decision_id": "journal-before-scene-context",
    })
    assert journaled["ok"] is True

    context = _run(campaign_ws, "scene.context")
    assert context["ok"] is True

    finalized = _finalize_pending_turn_for_test(
        campaign_ws,
        decision_id="finalize-after-scene-context",
    )
    assert finalized["data"]["rendered_text"]

def test_parallel_read_candidates_only_append_atomic_audit_receipts(campaign_ws):
    """Reviewed parallel reads leave state/RNG/receipts untouched except audit JSONL."""
    log_path = campaign_ws["campaign_dir"] / "logs" / "toolbox-calls.jsonl"
    before_log_rows = _read_jsonl(log_path)
    before_files = _game_file_bytes(campaign_ws["campaign_dir"])
    before_files.pop(Path("logs/toolbox-calls.jsonl"), None)

    calls = 16

    def invoke(index: int) -> dict:
        if index % 2:
            return coc_toolbox.run_tool(
                "rules.skill_describe",
                campaign_ws["workspace"],
                campaign_ws["campaign_id"],
                {"skill": "Library Use", "include_selection_policy": False},
            )
        return coc_toolbox.run_tool(
            "setup.phase",
            campaign_ws["workspace"],
            campaign_ws["campaign_id"],
            {},
        )

    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(invoke, range(calls)))
    assert all(result["ok"] is True for result in results), results

    after_files = _game_file_bytes(campaign_ws["campaign_dir"])
    after_files.pop(Path("logs/toolbox-calls.jsonl"), None)
    assert after_files == before_files

    appended = _read_jsonl(log_path)[len(before_log_rows):]
    assert len(appended) == calls
    assert {row["tool"] for row in appended} == {
        "rules.skill_describe", "setup.phase",
    }
    assert sum(row["tool"] == "rules.skill_describe" for row in appended) == calls // 2
    assert sum(row["tool"] == "setup.phase" for row in appended) == calls // 2

def test_pending_journal_allows_inventory_list_before_finalization(campaign_ws):
    journaled = _run(campaign_ws, "state.journal", {
        "summary": "本轮状态已经结算，KP 随后读取持有物用于组织输出。",
        "player_action": "结束本轮",
        "player_text": "我结束这一轮行动。",
        "intent_class": "investigate",
        "decision_id": "journal-before-inventory-list",
    })
    assert journaled["ok"] is True

    listed = _run(
        campaign_ws,
        "state.inventory_list",
        {"investigator": campaign_ws["investigator_id"]},
    )
    assert listed["ok"] is True, listed
    assert listed["data"]["investigator_id"] == campaign_ws["investigator_id"]
    assert isinstance(listed["data"]["items"], list)
    assert isinstance(listed["data"]["weapons"], list)
    logged = [
        row
        for row in _read_jsonl(
            campaign_ws["campaign_dir"] / "logs" / "toolbox-calls.jsonl"
        )
        if row.get("tool") == "state.inventory_list"
    ]
    assert logged
    assert logged[-1]["access"] == "query"

    mutation = _run(campaign_ws, "state.move_scene", {
        "scene_id": "post-journal-place",
        "decision_id": "illegal-post-journal-move-after-inventory",
    })
    assert mutation["ok"] is False
    assert mutation["error"]["code"] == "turn_pending_finalization"

    finalized = _finalize_pending_turn_for_test(
        campaign_ws,
        decision_id="finalize-after-inventory-list",
    )
    assert finalized["data"]["rendered_text"]

def test_same_decision_id_is_scoped_by_tool_name(campaign_ws):
    decision_id = "shared-across-tools"
    moved = _run(
        campaign_ws,
        "state.move_scene",
        {"scene_id": "improvised-place", "decision_id": decision_id},
    )
    clue_id = _first_clue_id(campaign_ws["campaign_dir"])
    recorded = _run(
        campaign_ws,
        "state.record_clue",
        {"clue_id": clue_id, "method": "test", "decision_id": decision_id},
    )
    marker = _run(
        campaign_ws,
        "state.time_marker",
        {
            "action": "set",
            "marker_id": "shared-decision-marker",
            "minutes_from_now": 5,
            "decision_id": decision_id,
        },
    )
    repeated = _run(
        campaign_ws,
        "state.record_clue",
        {"clue_id": clue_id, "method": "test", "decision_id": decision_id},
    )
    assert moved["ok"] and recorded["ok"] and marker["ok"] and repeated["ok"]
    assert recorded["data"]["clue_id"] == clue_id
    assert "to_scene_id" not in recorded["data"]
    assert marker["data"]["marker"]["marker_id"] == "shared-decision-marker"
    assert repeated["data"] == recorded["data"]
    ledger = json.loads(
        (campaign_ws["campaign_dir"] / "save" / "toolbox-ledger.json").read_text(
            encoding="utf-8"
        )
    )
    scoped = [
        entry
        for entry in ledger["entries"].values()
        if isinstance(entry, dict) and entry.get("decision_id") == decision_id
    ]
    assert {entry["tool"] for entry in scoped} == {
        "state.move_scene",
        "state.record_clue",
        "state.time_marker",
    }

@pytest.mark.parametrize("shared_decision_id", [True, False])
def test_concurrent_cli_transactions_preserve_ledger_state_and_events(
    campaign_ws,
    tmp_path: Path,
    shared_decision_id: bool,
):
    case = "same-id" if shared_decision_id else "different-ids"
    scene_id = f"concurrent-{case}-scene"
    flag_id = f"concurrent-{case}-flag"
    move_decision = f"concurrent-{case}"
    flag_decision = move_decision if shared_decision_id else f"{move_decision}-flag"
    outputs = _run_concurrent_cli(
        campaign_ws,
        [
            (
                "state.move_scene",
                {"scene_id": scene_id, "decision_id": move_decision},
            ),
            (
                "state.set_flag",
                {"flag_id": flag_id, "value": True, "decision_id": flag_decision},
            ),
        ],
        barrier_dir=tmp_path / f"barrier-{case}",
    )
    assert all(output["ok"] is True for output in outputs)

    campaign_dir = campaign_ws["campaign_dir"]
    ledger = json.loads(
        (campaign_dir / "save" / "toolbox-ledger.json").read_text(encoding="utf-8")
    )
    entries = ledger["entries"]
    assert coc_toolbox.Ctx._ledger_key("state.move_scene", move_decision) in entries
    assert coc_toolbox.Ctx._ledger_key("state.set_flag", flag_decision) in entries

    world = json.loads(
        (campaign_dir / "save" / "world-state.json").read_text(encoding="utf-8")
    )
    flags = json.loads(
        (campaign_dir / "save" / "flags.json").read_text(encoding="utf-8")
    )
    assert world["active_scene_id"] == scene_id
    assert flags["flags"][flag_id] is True

    relevant_events = [
        row
        for row in _read_jsonl(campaign_dir / "logs" / "events.jsonl")
        if (
            row.get("event_type") == "scene_transition"
            and row.get("to_scene_id") == scene_id
        ) or (
            row.get("event_type") == "flag_set"
            and row.get("flag_id") == flag_id
        )
    ]
    assert len(relevant_events) == 2
    event_tools = [
        "state.move_scene"
        if row["event_type"] == "scene_transition"
        else "state.set_flag"
        for row in relevant_events
    ]
    relevant_calls = [
        row
        for row in _read_jsonl(campaign_dir / "logs" / "toolbox-calls.jsonl")
        if row.get("tool") in {"state.move_scene", "state.set_flag"}
        and (row.get("args") or {}).get("decision_id") in {move_decision, flag_decision}
    ]
    assert len(relevant_calls) == 2
    assert [row["tool"] for row in relevant_calls] == event_tools

def test_legacy_ledger_entry_matches_only_its_original_tool(campaign_ws):
    ledger_path = campaign_ws["campaign_dir"] / "save" / "toolbox-ledger.json"
    _write_json(
        ledger_path,
        {
            "schema_version": 1,
            "entries": {
                "legacy-id": {
                    "tool": "state.set_flag",
                    "ts": "2026-01-01T00:00:00Z",
                    "data": {"flag_id": "legacy", "value": True, "newly_unlocked_scenes": []},
                }
            },
        },
    )
    same_tool = _run(
        campaign_ws,
        "state.set_flag",
        {"flag_id": "should-not-write", "decision_id": "legacy-id"},
    )
    npc_id = _first_npc_id(campaign_ws["campaign_dir"])
    other_tool = _run(
        campaign_ws,
        "state.npc_update",
        {"npc_id": npc_id, "trust_delta": 1, "decision_id": "legacy-id"},
    )
    assert same_tool["ok"] is False
    assert same_tool["error"]["code"] == "state_corrupt"
    assert "should-not-write" not in coc_toolbox.Ctx(
        campaign_ws["workspace"], campaign_ws["campaign_id"]
    ).flags().get("flags", {})
    assert other_tool["ok"] is False
    assert other_tool["error"]["code"] == "state_corrupt"

def test_state_flag_and_npc_updates_are_idempotent(campaign_ws):
    flag_args = {"flag_id": "one-shot", "value": True, "decision_id": "flag-once"}
    first_flag = _run(campaign_ws, "state.set_flag", flag_args)
    second_flag = _run(campaign_ws, "state.set_flag", flag_args)
    assert first_flag["ok"] and second_flag["ok"]
    assert second_flag["data"] == first_flag["data"]
    flag_events = [
        row
        for row in _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "events.jsonl")
        if row.get("event_type") == "flag_set" and row.get("flag_id") == "one-shot"
    ]
    assert len(flag_events) == 1

    npc_id = _first_npc_id(campaign_ws["campaign_dir"])
    npc_args = {"npc_id": npc_id, "trust_delta": 1, "decision_id": "npc-once"}
    first_npc = _run(campaign_ws, "state.npc_update", npc_args)
    second_npc = _run(campaign_ws, "state.npc_update", npc_args)
    assert first_npc["ok"] and second_npc["ok"]
    assert second_npc["data"] == first_npc["data"]
    assert first_npc["data"]["psych"]["trust"] == 1
    npc_events = [
        row
        for row in _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "events.jsonl")
        if row.get("event_type") == "npc_update" and row.get("npc_id") == npc_id
    ]
    assert len(npc_events) == 1

def test_scene_context_projects_pair_impression_for_single_party_member(campaign_ws):
    npc_id = _first_npc_id(campaign_ws["campaign_dir"])
    investigator_id = campaign_ws["investigator_id"]
    updated = _run(campaign_ws, "state.npc_update", {
        "npc_id": npc_id,
        "investigator": investigator_id,
        "impression_update": {
            "expectations": ["下次先说明证据责任。"],
            "reason": "observed_behavior",
        },
        "decision_id": "scene-context-impression",
    })
    assert updated["ok"]
    context = _run(campaign_ws, "scene.context")
    assert context["ok"]
    row = next(item for item in context["data"]["npcs_present"] if item["npc_id"] == npc_id)
    assert row["impression"]["expectations"] == ["下次先说明证据责任。"]
    explicit = _run(campaign_ws, "scene.context", {"investigator": investigator_id})
    assert explicit["data"]["npcs_present"]

def test_scene_context_projects_live_flag_truth_over_stale_authored_description(
    campaign_ws,
):
    campaign_dir = campaign_ws["campaign_dir"]
    story_path = campaign_dir / "scenario" / "story-graph.json"
    story = json.loads(story_path.read_text(encoding="utf-8"))
    world = json.loads(
        (campaign_dir / "save" / "world-state.json").read_text(encoding="utf-8")
    )
    active_scene = next(
        scene
        for scene in story["scenes"]
        if scene.get("scene_id") == world.get("active_scene_id")
    )
    active_scene["pressure_moves"] = ["The side door is still locked (initial description)."]
    _write_json(story_path, story)
    republished = coc_toolbox.coc_compiled_archive.publish_from_campaign(
        campaign_dir
    )
    assert republished["ok"] is True

    flag = _run(
        campaign_ws,
        "state.set_flag",
        {
            "flag_id": "corbitt-house-side-door-unlatched",
            "value": True,
            "reason": "Hayes opened every inside lock and left the door ajar",
            "decision_id": "side-door-unlatched-once",
        },
    )
    assert flag["ok"] is True

    context = _run(campaign_ws, "scene.context")
    assert context["ok"] is True
    assert "still locked" in context["data"]["scene"]["pressure_moves"][0]
    continuity = context["data"]["continuity"]
    assert continuity["keeper_only"] is True
    assert continuity["state_precedence"] == "live_over_authored_initial"
    live = {
        row["flag_id"]: row for row in continuity["live_world_flags"]
    }
    side_door = live["corbitt-house-side-door-unlatched"]
    assert side_door["value"] is True
    assert side_door["provenance"]["decision_id"] == "side-door-unlatched-once"
    assert side_door["provenance"]["reason"].startswith("Hayes opened")
    assert continuity["recent_world_flag_changes"][-1]["flag_id"] == (
        "corbitt-house-side-door-unlatched"
    )
    assert any("live_world_flags" in hint for hint in context["hints"])

def test_time_marker_set_reset_clear_and_advance_projection_are_idempotent(
    campaign_ws,
):
    campaign_dir = campaign_ws["campaign_dir"]
    time_path = campaign_dir / "save" / "time-state.json"
    time_state = json.loads(time_path.read_text(encoding="utf-8"))
    time_state["clock"].update(
        {
            "elapsed_minutes": 93,
            "calendar_mode": "gregorian",
            "local_datetime": "1920-10-15T11:33:00",
            "display": "1920-10-15 11:33",
        }
    )
    _write_json(time_path, time_state)

    set_args = {
        "action": "set",
        "marker_id": "police-check-in",
        "minutes_from_now": 10,
        "label": "Police check-in",
        "reason": "Police enter if Hayes misses the report",
        "decision_id": "police-check-in-set-1",
    }
    first = _run(campaign_ws, "state.time_marker", set_args)
    replay = _run(campaign_ws, "state.time_marker", set_args)
    assert first["ok"] is True
    assert replay["data"] == first["data"]
    assert any("duplicate decision_id" in warning for warning in replay["warnings"])
    marker = first["data"]["marker"]
    assert marker["due_at"]["display"] == "1920-10-15 11:43"
    assert marker["remaining_minutes"] == 10
    assert marker["timing_state"] == "pending"

    advanced = _run(
        campaign_ws,
        "state.advance_time",
        {
            "minutes": 6,
            "reason": "Hayes searches the first basement platform",
            "decision_id": "advance-to-1139",
        },
    )
    assert advanced["ok"] is True
    assert advanced["data"]["current_time"]["display"] == "1920-10-15 11:39"
    active = advanced["data"]["active_time_markers"]
    assert len(active) == 1
    assert active[0]["due_at"]["display"] == "1920-10-15 11:43"
    assert active[0]["remaining_minutes"] == 4
    assert active[0]["overdue"] is False

    context = _run(campaign_ws, "scene.context")
    assert context["data"]["continuity"]["active_time_markers"] == active

    reset = _run(
        campaign_ws,
        "state.time_marker",
        {
            "action": "reset",
            "marker_id": "police-check-in",
            "minutes_from_now": 10,
            "reason": "Hayes reported and renewed the ten-minute agreement",
            "decision_id": "police-check-in-reset-1",
        },
    )
    assert reset["ok"] is True
    assert reset["data"]["marker"]["due_at"]["display"] == "1920-10-15 11:49"
    assert reset["data"]["marker"]["revision"] == 2

    trigger_path = campaign_dir / "save" / "time-triggers.json"
    triggers_before = json.loads(trigger_path.read_text(encoding="utf-8"))
    scene_before = json.loads(
        (campaign_dir / "save" / "world-state.json").read_text(encoding="utf-8")
    )["active_scene_id"]
    overdue = _run(
        campaign_ws,
        "state.advance_time",
        {
            "minutes": 11,
            "reason": "Hayes remains underground past the renewed check-in",
            "decision_id": "advance-past-1149",
        },
    )
    assert overdue["ok"] is True
    overdue_marker = overdue["data"]["active_time_markers"][0]
    assert overdue_marker["remaining_minutes"] == -1
    assert overdue_marker["overdue"] is True
    assert overdue_marker["timing_state"] == "overdue"
    assert json.loads(trigger_path.read_text(encoding="utf-8")) == triggers_before
    assert json.loads(
        (campaign_dir / "save" / "world-state.json").read_text(encoding="utf-8")
    )["active_scene_id"] == scene_before
    assert not any(
        row.get("event_type") == "trigger_fired"
        and row.get("trigger_id") == "police-check-in"
        for row in _read_jsonl(campaign_dir / "logs" / "time.jsonl")
    )

    cleared = _run(
        campaign_ws,
        "state.time_marker",
        {
            "action": "clear",
            "marker_id": "police-check-in",
            "reason": "Hayes returned to the officers",
            "decision_id": "police-check-in-clear-1",
        },
    )
    assert cleared["ok"] is True
    assert cleared["data"]["marker"]["status"] == "cleared"
    assert cleared["data"]["active_time_markers"] == []
    assert _run(campaign_ws, "scene.context")["data"]["continuity"][
        "active_time_markers"
    ] == []

    marker_events = [
        row
        for row in _read_jsonl(campaign_dir / "logs" / "events.jsonl")
        if row.get("event_type") == "time_marker_changed"
        and row.get("marker_id") == "police-check-in"
    ]
    assert [row["action"] for row in marker_events] == ["set", "reset", "clear"]

@pytest.mark.parametrize(
    "crash_stage", ["after_source", "after_event", "before_ledger"]
)
def test_time_marker_source_receipt_recovers_every_crash_window_without_drift(
    campaign_ws,
    monkeypatch,
    crash_stage,
):
    campaign_dir = campaign_ws["campaign_dir"]
    time_path = campaign_dir / "save" / "time-state.json"
    time_state = json.loads(time_path.read_text(encoding="utf-8"))
    time_state["clock"].update(
        {
            "elapsed_minutes": 93,
            "calendar_mode": "gregorian",
            "local_datetime": "1920-10-15T11:33:00",
            "display": "1920-10-15 11:33",
        }
    )
    _write_json(time_path, time_state)
    decision_id = f"marker-crash-{crash_stage}"
    args = {
        "action": "set",
        "marker_id": f"police-check-in-{crash_stage}",
        "minutes_from_now": 10,
        "label": "Police check-in",
        "reason": "SENTINEL_ORIGINAL_MARKER_REASON",
        "decision_id": decision_id,
    }
    real_log_event = coc_toolbox.Ctx.log_event
    real_ledger_record = coc_toolbox.Ctx.ledger_record

    def crash_log_event(self, record):
        if record.get("event_type") != "time_marker_changed":
            return real_log_event(self, record)
        if crash_stage == "after_source":
            raise RuntimeError("synthetic crash after marker source write")
        real_log_event(self, record)
        if crash_stage == "after_event":
            raise RuntimeError("synthetic crash after marker event append")

    def crash_ledger_record(
        self, current_decision_id, tool_name, data, **kwargs
    ):
        if tool_name == "state.time_marker" and crash_stage == "before_ledger":
            raise RuntimeError("synthetic crash before marker ledger write")
        return real_ledger_record(
            self, current_decision_id, tool_name, data, **kwargs
        )

    with monkeypatch.context() as crash:
        crash.setattr(coc_toolbox.Ctx, "log_event", crash_log_event)
        crash.setattr(coc_toolbox.Ctx, "ledger_record", crash_ledger_record)
        with pytest.raises(RuntimeError, match="synthetic crash"):
            _run(campaign_ws, "state.time_marker", args)

    marker_doc = json.loads(
        (campaign_dir / "save" / "time-markers.json").read_text(encoding="utf-8")
    )
    receipt = marker_doc["operation_receipts"]["state.time_marker"][decision_id]
    original_data = receipt["data"]
    assert original_data["marker"]["revision"] == 1
    assert original_data["marker"]["due_at"]["display"] == "1920-10-15 11:43"

    advanced = _run(
        campaign_ws,
        "state.advance_time",
        {
            "minutes": 5,
            "reason": "legitimate work after the crashed marker call",
            "decision_id": f"advance-after-{crash_stage}",
        },
    )
    assert advanced["data"]["current_time"]["display"] == "1920-10-15 11:38"

    replay = _run(campaign_ws, "state.time_marker", args)
    assert replay["ok"] is True
    assert replay["data"] == original_data
    assert replay["data"]["marker"]["revision"] == 1
    assert replay["data"]["marker"]["due_at"]["display"] == "1920-10-15 11:43"
    assert any("source-of-truth receipt" in warning for warning in replay["warnings"])

    live_marker = _run(campaign_ws, "scene.context")["data"]["continuity"][
        "active_time_markers"
    ][0]
    assert live_marker["revision"] == 1
    assert live_marker["due_at"]["display"] == "1920-10-15 11:43"
    assert live_marker["remaining_minutes"] == 5
    events = [
        row
        for row in _read_jsonl(campaign_dir / "logs" / "events.jsonl")
        if row.get("event_id") == receipt["event_id"]
    ]
    assert len(events) == 1
    ledger_path = campaign_dir / "save" / "toolbox-ledger.json"
    ledger_after_repair = ledger_path.read_bytes()
    assert _run(campaign_ws, "state.time_marker", args)["data"] == original_data
    assert ledger_path.read_bytes() == ledger_after_repair
    assert len([
        row
        for row in _read_jsonl(campaign_dir / "logs" / "events.jsonl")
        if row.get("event_id") == receipt["event_id"]
    ]) == 1

    conflict = _run(
        campaign_ws,
        "state.time_marker",
        {**args, "minutes_from_now": 11},
    )
    assert conflict["ok"] is False
    assert conflict["error"]["code"] == "idempotency_conflict"

@pytest.mark.parametrize(
    "crash_stage", ["after_source", "after_event", "before_ledger"]
)
def test_set_flag_source_receipt_preserves_original_provenance_and_unlock_once(
    campaign_ws,
    monkeypatch,
    crash_stage,
):
    campaign_dir = campaign_ws["campaign_dir"]
    story_path = campaign_dir / "scenario" / "story-graph.json"
    story = json.loads(story_path.read_text(encoding="utf-8"))
    source_scene = story["scenes"][0]
    source_scene.setdefault("scene_edges", []).append(
        {
            "to": "receipt-unlock-scene",
            "kind": "unlock",
            "when": {"kind": "flag_set", "flag_id": "receipt-unlock-flag"},
        }
    )
    story["scenes"].append(
        {
            "scene_id": "receipt-unlock-scene",
            "scene_type": "investigation",
            "dramatic_question": "Can the receipt repair this unlock?",
        }
    )
    _write_json(story_path, story)

    decision_id = f"flag-crash-{crash_stage}"
    args = {
        "flag_id": "receipt-unlock-flag",
        "value": True,
        "reason": "SENTINEL_ORIGINAL_FLAG_REASON",
        "decision_id": decision_id,
    }
    real_save_world = coc_toolbox.Ctx.save_world
    real_log_event = coc_toolbox.Ctx.log_event
    real_ledger_record = coc_toolbox.Ctx.ledger_record

    def crash_save_world(self, world):
        if crash_stage == "after_source" and "receipt-unlock-scene" in (
            world.get("unlocked_scene_ids") or []
        ):
            raise RuntimeError("synthetic crash after flag source write")
        return real_save_world(self, world)

    def crash_log_event(self, record):
        if record.get("event_type") != "flag_set":
            return real_log_event(self, record)
        real_log_event(self, record)
        if crash_stage == "after_event":
            raise RuntimeError("synthetic crash after flag event append")

    def crash_ledger_record(
        self, current_decision_id, tool_name, data, **kwargs
    ):
        if tool_name == "state.set_flag" and crash_stage == "before_ledger":
            raise RuntimeError("synthetic crash before flag ledger write")
        return real_ledger_record(
            self, current_decision_id, tool_name, data, **kwargs
        )

    with monkeypatch.context() as crash:
        crash.setattr(coc_toolbox.Ctx, "save_world", crash_save_world)
        crash.setattr(coc_toolbox.Ctx, "log_event", crash_log_event)
        crash.setattr(coc_toolbox.Ctx, "ledger_record", crash_ledger_record)
        with pytest.raises(RuntimeError, match="synthetic crash"):
            _run(campaign_ws, "state.set_flag", args)

    flags_after_crash = json.loads(
        (campaign_dir / "save" / "flags.json").read_text(encoding="utf-8")
    )
    receipt = flags_after_crash["operation_receipts"]["state.set_flag"][
        decision_id
    ]
    original_data = receipt["data"]
    original_provenance = original_data["provenance"]
    assert original_provenance["previous_value"] is None
    assert original_provenance["reason"] == "SENTINEL_ORIGINAL_FLAG_REASON"

    later = _run(
        campaign_ws,
        "state.set_flag",
        {
            "flag_id": "receipt-unlock-flag",
            "value": False,
            "reason": "legitimate later flag transition",
            "decision_id": f"flag-later-{crash_stage}",
        },
    )
    assert later["ok"] is True
    replay = _run(campaign_ws, "state.set_flag", args)
    assert replay["ok"] is True
    assert replay["data"] == original_data
    assert replay["data"]["provenance"] == original_provenance

    current_flags = json.loads(
        (campaign_dir / "save" / "flags.json").read_text(encoding="utf-8")
    )
    assert current_flags["flags"]["receipt-unlock-flag"] is False
    assert current_flags["flag_provenance"]["receipt-unlock-flag"]["reason"] == (
        "legitimate later flag transition"
    )
    continuity = _run(campaign_ws, "scene.context")["data"]["continuity"]
    ordered_changes = [
        row
        for row in continuity["recent_world_flag_changes"]
        if row["flag_id"] == "receipt-unlock-flag"
    ]
    assert [row["value"] for row in ordered_changes] == [True, False]
    assert [
        row["provenance"]["reason"] for row in ordered_changes
    ] == [
        "SENTINEL_ORIGINAL_FLAG_REASON",
        "legitimate later flag transition",
    ]
    assert [
        row["provenance"]["source_sequence"] for row in ordered_changes
    ] == sorted(
        row["provenance"]["source_sequence"] for row in ordered_changes
    )
    world = json.loads(
        (campaign_dir / "save" / "world-state.json").read_text(encoding="utf-8")
    )
    assert world["unlocked_scene_ids"].count("receipt-unlock-scene") == 1
    original_events = [
        row
        for row in _read_jsonl(campaign_dir / "logs" / "events.jsonl")
        if row.get("event_id") == receipt["event_id"]
    ]
    assert len(original_events) == 1
    assert original_events[0]["previous_value"] is None
    assert original_events[0]["reason"] == "SENTINEL_ORIGINAL_FLAG_REASON"
    assert original_events[0]["ts"] == original_provenance["changed_at"]
    ledger_path = campaign_dir / "save" / "toolbox-ledger.json"
    ledger_after_repair = ledger_path.read_bytes()
    assert _run(campaign_ws, "state.set_flag", args)["data"] == original_data
    assert ledger_path.read_bytes() == ledger_after_repair
    assert len([
        row
        for row in _read_jsonl(campaign_dir / "logs" / "events.jsonl")
        if row.get("event_id") == receipt["event_id"]
    ]) == 1

    conflict = _run(
        campaign_ws,
        "state.set_flag",
        {**args, "value": False},
    )
    assert conflict["ok"] is False
    assert conflict["error"]["code"] == "idempotency_conflict"

def test_director_and_toolbox_share_flag_mutation_head_and_capsule(campaign_ws):
    campaign_dir = campaign_ws["campaign_dir"]
    unlocked = _run(
        campaign_ws,
        "state.set_flag",
        {
            "flag_id": "side_door_locked",
            "value": False,
            "reason": "toolbox unlocked it",
            "decision_id": "flag-side-door-unlocked",
        },
    )
    assert unlocked["ok"] is True

    events = coc_director_apply.apply_plan(
        campaign_dir,
        {
            "decision_id": "director-relocks-side-door",
            "scene_action": "CHARACTER",
            "turn_input": {
                "active_scene_id": "commission-briefing",
                "turn_number": 2,
            },
            "flags_set": ["side_door_locked"],
            "clue_policy": {"reveal": []},
            "pressure_moves": [],
            "memory_writes": [],
            "rule_signals": {},
        },
        investigator_id=campaign_ws["investigator_id"],
    )
    director_event = next(
        row for row in events
        if row.get("event_type") == "flag_set"
        and row.get("flag_id") == "side_door_locked"
    )
    assert director_event["value"] is True
    assert director_event["previous_value"] is False
    assert director_event["producer"] == "coc_director_apply"
    assert director_event["reason"] == "plan.flags_set"
    assert director_event["source_sequence"] > unlocked["data"]["provenance"][
        "source_sequence"
    ]

    continuity = _run(campaign_ws, "scene.context")["data"]["continuity"]
    live = next(
        row for row in continuity["live_world_flags"]
        if row["flag_id"] == "side_door_locked"
    )
    assert live["value"] is True
    assert live["provenance"]["producer"] == "coc_director_apply"
    assert live["provenance"]["decision_id"] == "director-relocks-side-door"
    history = [
        row for row in continuity["recent_world_flag_changes"]
        if row["flag_id"] == "side_door_locked"
    ]
    assert [row["value"] for row in history] == [False, True]
    assert history[-1]["provenance"]["source"] == "coc_director_apply"

def test_explicit_false_flag_remains_live_after_history_ages_out(campaign_ws):
    assert _run(
        campaign_ws,
        "state.set_flag",
        {
            "flag_id": "side_door_locked",
            "value": False,
            "decision_id": "side-door-explicitly-unlocked",
        },
    )["ok"] is True
    for index in range(13):
        assert _run(
            campaign_ws,
            "state.set_flag",
            {
                "flag_id": f"later-flag-{index}",
                "value": True,
                "decision_id": f"later-flag-decision-{index}",
            },
        )["ok"] is True

    continuity = _run(campaign_ws, "scene.context")["data"]["continuity"]
    assert not any(
        row["flag_id"] == "side_door_locked"
        for row in continuity["recent_world_flag_changes"]
    )
    live = next(
        row for row in continuity["live_world_flags"]
        if row["flag_id"] == "side_door_locked"
    )
    assert live["present"] is True
    assert live["value"] is False
    assert live["provenance"]["integrity_status"] == "source_anchored"

def test_transient_tool_failure_retries_same_call_and_records_recovery(
    campaign_ws,
    monkeypatch,
):
    name = "state.retry_probe"
    attempts = 0
    contexts = []

    def handler(ctx, args):
        nonlocal attempts
        attempts += 1
        contexts.append(ctx)
        assert "retry-probe" not in ctx._scenario_cache
        ctx._scenario_cache["retry-probe"] = {"attempt": attempts}
        if attempts < 3:
            raise coc_toolbox.ToolError(
                "subsystem_transaction_failed",
                "synthetic transient failure",
            )
        return {"decision_id": args["decision_id"]}, [], []

    coc_toolbox.TOOLS[name] = {
        "name": name,
        "summary": "test-only retry probe",
        "params": {"decision_id": {"type": "string", "required": True}},
        "needs_campaign": True,
        "handler": handler,
    }
    monkeypatch.setattr(coc_toolbox, "_TOOL_TRANSIENT_RETRY_DELAY_SECONDS", 0)
    try:
        envelope = _run(campaign_ws, name, {"decision_id": "retry-probe-once"})
    finally:
        coc_toolbox.TOOLS.pop(name, None)

    assert envelope["ok"] is True
    assert envelope["attempts"] == 3
    assert envelope["recovered_after_retry"] is True
    assert attempts == 3
    assert len({id(ctx) for ctx in contexts}) == 3
    receipts = [
        row
        for row in _read_jsonl(
            campaign_ws["campaign_dir"] / "logs" / "toolbox-calls.jsonl"
        )
        if row.get("tool") == name
    ]
    assert [row["ok"] for row in receipts] == [False, False, True]
    assert [row["attempt"] for row in receipts] == [1, 2, 3]
    assert [row["will_retry"] for row in receipts] == [True, True, False]
    assert receipts[-1]["recovered_after_retry"] is True

def test_campaign_busy_retries_before_handler_and_records_attempts(
    campaign_ws,
    monkeypatch,
):
    lock_attempts = 0
    handler_attempts = 0
    real_lock = coc_toolbox.coc_fileio.campaign_lock

    @contextmanager
    def flaky_lock(campaign_dir, *, wait_seconds):
        nonlocal lock_attempts
        lock_attempts += 1
        if lock_attempts < 3:
            raise coc_toolbox.coc_fileio.CampaignLockError("synthetic busy campaign")
        with real_lock(campaign_dir, wait_seconds=wait_seconds) as lock_path:
            yield lock_path

    name = "state.busy_retry_probe"

    def handler(ctx, args):
        nonlocal handler_attempts
        handler_attempts += 1
        return {"decision_id": args["decision_id"]}, [], []

    coc_toolbox.TOOLS[name] = {
        "name": name,
        "summary": "test-only campaign lock retry probe",
        "params": {"decision_id": {"type": "string", "required": True}},
        "needs_campaign": True,
        "handler": handler,
    }
    monkeypatch.setattr(coc_toolbox.coc_fileio, "campaign_lock", flaky_lock)
    monkeypatch.setattr(coc_toolbox, "_TOOL_TRANSIENT_RETRY_DELAY_SECONDS", 0)
    try:
        envelope = _run(campaign_ws, name, {"decision_id": "busy-retry-once"})
    finally:
        coc_toolbox.TOOLS.pop(name, None)

    assert envelope["ok"] is True
    assert envelope["attempts"] == 3
    assert envelope["recovered_after_retry"] is True
    assert lock_attempts == 3
    assert handler_attempts == 1
    receipts = [
        row
        for row in _read_jsonl(
            campaign_ws["campaign_dir"] / "logs" / "toolbox-calls.jsonl"
        )
        if row.get("tool") == name
    ]
    assert [row.get("error") for row in receipts] == [
        "campaign_busy",
        "campaign_busy",
        None,
    ]
    assert [row["will_retry"] for row in receipts] == [True, True, False]

def test_transient_retry_exhaustion_is_bounded_and_actionable(
    campaign_ws,
    monkeypatch,
):
    name = "state.retry_exhaustion_probe"
    attempts = 0

    def handler(ctx, args):
        nonlocal attempts
        attempts += 1
        raise coc_toolbox.ToolError(
            "subsystem_transaction_failed",
            "synthetic persistent transient failure",
        )

    coc_toolbox.TOOLS[name] = {
        "name": name,
        "summary": "test-only bounded retry probe",
        "params": {"decision_id": {"type": "string", "required": True}},
        "needs_campaign": True,
        "handler": handler,
    }
    monkeypatch.setattr(coc_toolbox, "_TOOL_TRANSIENT_RETRY_DELAY_SECONDS", 0)
    try:
        envelope = _run(campaign_ws, name, {"decision_id": "retry-exhaustion-once"})
    finally:
        coc_toolbox.TOOLS.pop(name, None)

    assert envelope["ok"] is False
    assert envelope["error"]["code"] == "subsystem_transaction_failed"
    assert envelope["attempts"] == 3
    assert envelope["max_attempts"] == 3
    assert envelope["retryable"] is True
    assert envelope["retry_exhausted"] is True
    assert envelope["recovered_after_retry"] is False
    assert attempts == 3
    assert any("same decision_id" in hint for hint in envelope["hints"])
    receipts = [
        row
        for row in _read_jsonl(
            campaign_ws["campaign_dir"] / "logs" / "toolbox-calls.jsonl"
        )
        if row.get("tool") == name
    ]
    assert [row["attempt"] for row in receipts] == [1, 2, 3]
    assert [row["will_retry"] for row in receipts] == [True, True, False]
    assert receipts[-1]["retry_exhausted"] is True

def test_invalid_payload_is_not_retried_and_returns_recovery_hint(
    campaign_ws,
    monkeypatch,
):
    name = "state.invalid_retry_probe"
    attempts = 0

    def handler(ctx, args):
        nonlocal attempts
        attempts += 1
        raise coc_toolbox.ToolError("invalid_param", "synthetic invalid payload")

    coc_toolbox.TOOLS[name] = {
        "name": name,
        "summary": "test-only invalid payload probe",
        "params": {},
        "needs_campaign": True,
        "handler": handler,
    }
    monkeypatch.setattr(coc_toolbox, "_TOOL_TRANSIENT_RETRY_ATTEMPTS", 5)
    try:
        envelope = _run(campaign_ws, name)
    finally:
        coc_toolbox.TOOLS.pop(name, None)

    assert envelope["ok"] is False
    assert envelope["error"]["code"] == "invalid_param"
    assert envelope["attempts"] == 1
    assert envelope["retryable"] is False
    assert envelope["recovered_after_retry"] is False
    assert attempts == 1
    assert any("describe" in hint for hint in envelope["hints"])
    receipts = [
        row
        for row in _read_jsonl(
            campaign_ws["campaign_dir"] / "logs" / "toolbox-calls.jsonl"
        )
        if row.get("tool") == name
    ]
    assert len(receipts) == 1
    assert receipts[0]["retryable"] is False
    assert receipts[0]["will_retry"] is False
    assert receipts[0]["error_message"] == "synthetic invalid payload"

def test_state_end_session_appends_session_ending_event(campaign_ws):
    world = json.loads(
        (campaign_ws["campaign_dir"] / "save" / "world-state.json").read_text(
            encoding="utf-8"
        )
    )
    active = world.get("active_scene_id")
    envelope = _run(
        campaign_ws,
        "state.end_session",
        {
            "kind": "cliffhanger",
            "summary": "session closed by toolbox test",
            "decision_id": "toolbox-end-1",
        },
    )
    assert envelope["ok"] is True
    assert envelope["data"]["session_ending"] is True
    assert envelope["data"]["scene_id"] == active
    assert envelope["data"]["kind"] == "cliffhanger"

    events = _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "events.jsonl")
    endings = [e for e in events if e.get("event_type") == "session_ending"]
    assert endings
    last = endings[-1]
    assert last["scene_id"] == active
    assert last["kind"] == "cliffhanger"
    assert last["summary"] == "session closed by toolbox test"

    journaled = _run(campaign_ws, "state.journal", {
        "summary": "session closed by toolbox test",
        "player_text": "I leave this story here.",
        "decision_id": "toolbox-end-1-journal",
    })
    assert journaled["ok"] is True

    finalized = _finalize_pending_turn_for_test(
        campaign_ws,
        decision_id="toolbox-end-1-finalize",
    )

    resumed = _run(campaign_ws, "session.resume")
    assert resumed["ok"] is True, resumed
    assert resumed["data"]["mode"] == "ending"
    assert resumed["data"]["next_operations"] == []
    assert resumed["data"]["ending_output"]["rendered_text"] == finalized["data"]["rendered_text"]
    assert resumed["data"]["ending_output"]["rendered_sha256"] == finalized["data"]["rendered_text_sha256"]
    assert resumed["data"]["ending_output"]["ending_id"] == last["ending_id"]

def test_evicted_roll_replay_does_not_reearn_consumed_development_check(
    campaign_ws,
):
    investigator_id = campaign_ws["investigator_id"]
    roll_args = {
        "investigator": investigator_id,
        "skill": "Spot Hidden",
        "target": 99,
        "seed": 1,
        "decision_id": "old-roll-after-ledger-eviction",
    }
    first = _run(campaign_ws, "rules.roll", roll_args)
    assert first["ok"] is True
    ended = _run(campaign_ws, "state.end_session", {
        "kind": "cliffhanger",
        "summary": "consume the old roll's development event",
        "decision_id": "consume-old-roll-ending",
    })
    assert ended["data"]["development"]["status"] == "PASS"
    assert ended["data"]["development"]["settlements"][0]["receipt"][
        "result"
    ]["skills_checked"] == ["Spot Hidden"]

    for index in range(coc_toolbox._LEDGER_MAX_ENTRIES + 1):
        journaled = _run(campaign_ws, "state.journal", {
            "summary": f"rotate bounded ledger entry {index}",
            "player_text": f"我完成第 {index} 次测试行动。",
            "decision_id": f"ledger-rotation-{index}",
        })
        assert journaled["ok"] is True
        _finalize_pending_turn_for_test(
            campaign_ws,
            decision_id=f"ledger-rotation-finalize-{index}",
        )

    replay = _run(campaign_ws, "rules.roll", roll_args)
    assert replay["ok"] is True
    assert replay["data"] == first["data"]
    assert any(
        "duplicate decision_id" in warning
        for warning in replay.get("warnings") or []
    )
    assert len([
        row for row in _read_jsonl(
            campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"
        )
        if row.get("roll_id") == first["data"]["roll_id"]
    ]) == 1
    state_path = (
        campaign_ws["campaign_dir"] / "save" / "investigator-state"
        / f"{investigator_id}.json"
    )
    state = json.loads(state_path.read_text(encoding="utf-8"))
    assert state["skill_checks_earned"] == []
    assert state["skill_check_events"] == []
    assert (campaign_ws["coc_root"] / "investigators" / investigator_id
            / "development.jsonl").read_text(encoding="utf-8") == ""

    second_ending = _run(campaign_ws, "state.end_session", {
        "kind": "cliffhanger",
        "summary": "replayed source has no second development event",
        "decision_id": "after-old-roll-replay-ending",
    })
    second_receipt = second_ending["data"]["development"]["settlements"][0][
        "receipt"
    ]
    # The replayed source earned no second development event, so this ending
    # closes the already-settled boundary and replays the original receipt —
    # no new rolls, no new state diffs (one settlement per session).
    assert second_receipt["replayed"] is True
    assert second_receipt["result"]["skills_checked"] == ["Spot Hidden"]

def test_state_end_session_keeps_ending_when_settlement_is_pending(
    campaign_ws, monkeypatch
):
    original = coc_toolbox.coc_runtime_ops.settle_development
    attempts = 0

    def unavailable(*_args, **_kwargs):
        nonlocal attempts
        attempts += 1
        raise OSError("synthetic settlement outage")

    monkeypatch.setattr(
        coc_toolbox.coc_runtime_ops,
        "settle_development",
        unavailable,
    )
    args = {
        "kind": "retreat",
        "summary": "the investigation closes despite bookkeeping trouble",
        "decision_id": "toolbox-end-pending-retry",
    }
    pending = _run(campaign_ws, "state.end_session", args)
    assert pending["ok"] is True
    assert pending["data"]["session_ending"] is True
    assert pending["data"]["development"]["status"] == "PENDING"
    assert pending["data"]["investigator_ids"] == [campaign_ws["investigator_id"]]
    assert attempts == coc_toolbox._TOOL_TRANSIENT_RETRY_ATTEMPTS
    assert any("ending is durable" in warning for warning in pending["warnings"])
    ending_event = next(
        row for row in _read_jsonl(
            campaign_ws["campaign_dir"] / "logs" / "events.jsonl"
        )
        if row.get("event_type") == "session_ending"
        and row.get("decision_id") == args["decision_id"]
    )
    assert ending_event["investigator_ids"] == [campaign_ws["investigator_id"]]

    added_investigator = _add_eleanor_to_party(campaign_ws)

    monkeypatch.setattr(
        coc_toolbox.coc_runtime_ops,
        "settle_development",
        original,
    )
    recovered = _run(campaign_ws, "state.end_session", args)
    assert recovered["ok"] is True
    assert recovered["data"]["development"]["status"] == "PASS"
    assert recovered["data"]["investigator_ids"] == [campaign_ws["investigator_id"]]
    assert recovered["data"]["retry_target_conflict"] == {
        "code": "SETTLEMENT_TARGET_CONFLICT",
        "frozen_investigator_ids": [campaign_ws["investigator_id"]],
        "retry_investigator_ids": [campaign_ws["investigator_id"], added_investigator],
        "resolution": "frozen_targets_preserved",
    }
    assert any("pending development settlement completed" in warning
               for warning in recovered["warnings"])
    assert any(
        "SETTLEMENT_TARGET_CONFLICT" in warning
        for warning in recovered["warnings"]
    )
    assert not (
        campaign_ws["campaign_dir"]
        / "save"
        / "development-settlements"
        / f"{added_investigator}.json"
    ).exists()
    incompatible = _run(
        campaign_ws,
        "development.settle",
        {
            "investigator": added_investigator,
            "decision_id": "ending-frozen-target-incompatible",
        },
    )
    assert incompatible["ok"] is False
    assert incompatible["error"]["code"] == "settlement_target_conflict"
    endings = [
        row for row in _read_jsonl(
            campaign_ws["campaign_dir"] / "logs" / "events.jsonl"
        )
        if row.get("event_type") == "session_ending"
        and row.get("decision_id") == args["decision_id"]
    ]
    assert len(endings) == 1

def test_pending_ending_and_new_same_skill_success_keep_distinct_event_claims(
    campaign_ws, monkeypatch
):
    investigator_id = campaign_ws["investigator_id"]
    first_roll = _run(campaign_ws, "rules.roll", {
        "investigator": investigator_id,
        "skill": "Spot Hidden",
        "target": 99,
        "seed": 1,
        "decision_id": "same-skill-roll-a",
    })
    assert first_roll["ok"] is True
    original = coc_toolbox.coc_runtime_ops.settle_development
    monkeypatch.setattr(
        coc_toolbox.coc_runtime_ops,
        "settle_development",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(OSError("offline")),
    )
    first_args = {
        "kind": "cliffhanger",
        "summary": "first same-skill claim remains pending",
        "decision_id": "same-skill-ending-a",
    }
    first = _run(campaign_ws, "state.end_session", first_args)
    assert first["data"]["development"]["status"] == "PENDING"
    first_capsule = coc_toolbox.coc_development.load_ending_settlement_capsule(
        campaign_ws["campaign_dir"], first["data"]["ending_id"]
    )
    assert first_capsule is not None
    token_a = first_capsule["development_inputs"][investigator_id][
        "input_tokens"
    ][0]

    second_roll = _run(campaign_ws, "rules.roll", {
        "investigator": investigator_id,
        "skill": "Spot Hidden",
        "target": 99,
        "seed": 2,
        "decision_id": "same-skill-roll-b",
    })
    assert second_roll["ok"] is True
    monkeypatch.setattr(
        coc_toolbox.coc_runtime_ops, "settle_development", original
    )
    second = _run(campaign_ws, "state.end_session", {
        "kind": "retreat",
        "summary": "second same-skill claim settles independently",
        "decision_id": "same-skill-ending-b",
    })
    assert second["data"]["development"]["status"] == "PASS"
    second_capsule = coc_toolbox.coc_development.load_ending_settlement_capsule(
        campaign_ws["campaign_dir"], second["data"]["ending_id"]
    )
    assert second_capsule is not None
    token_b = second_capsule["development_inputs"][investigator_id][
        "input_tokens"
    ][0]
    assert token_b != token_a
    assert second_capsule["development_inputs"][investigator_id][
        "skills_checked"
    ] == ["Spot Hidden"]

    retried = _run(campaign_ws, "state.end_session", first_args)
    assert retried["data"]["development"]["status"] == "PASS"
    state_path = (
        campaign_ws["campaign_dir"] / "save" / "investigator-state"
        / f"{investigator_id}.json"
    )
    state = json.loads(state_path.read_text(encoding="utf-8"))
    assert state["skill_checks_earned"] == []
    assert state["skill_check_events"] == []
    claims_path = (
        campaign_ws["coc_root"] / "investigators" / investigator_id
        / "development-claims.json"
    )
    claims = json.loads(claims_path.read_text(encoding="utf-8"))["claims"]
    assert claims[token_a]["ending_id"] == first["data"]["ending_id"]
    assert claims[token_b]["ending_id"] == second["data"]["ending_id"]

def test_frozen_mechanical_plan_merges_without_recomputing_later_state(
    campaign_ws, monkeypatch
):
    investigator_id = campaign_ws["investigator_id"]
    character_path = (
        campaign_ws["coc_root"] / "investigators" / investigator_id
        / "character.json"
    )
    character = json.loads(character_path.read_text(encoding="utf-8"))
    character.setdefault("skills", {})["Frozen Custom Skill"] = 10
    _write_json(character_path, character)
    rolled = _run(campaign_ws, "rules.roll", {
        "investigator": investigator_id,
        "skill": "Frozen Custom Skill",
        "target": 99,
        "seed": 3,
        "decision_id": "frozen-plan-roll",
    })
    assert rolled["ok"] is True
    state_path = (
        campaign_ws["campaign_dir"] / "save" / "investigator-state"
        / f"{investigator_id}.json"
    )
    state = json.loads(state_path.read_text(encoding="utf-8"))
    state["current_luck"] = 0
    _write_json(state_path, state)
    original = coc_toolbox.coc_runtime_ops.settle_development
    monkeypatch.setattr(
        coc_toolbox.coc_runtime_ops,
        "settle_development",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(OSError("offline")),
    )
    end_args = {
        "kind": "cliffhanger",
        "summary": "freeze mechanics before delayed retry",
        "decision_id": "frozen-plan-ending",
    }
    first = _run(campaign_ws, "state.end_session", end_args)
    ending_id = first["data"]["ending_id"]
    capsule = coc_toolbox.coc_development.load_ending_settlement_capsule(
        campaign_ws["campaign_dir"], ending_id
    )
    assert capsule is not None
    frozen = capsule["development_inputs"][investigator_id]
    plan_check = frozen["deterministic_plan"]["improvement_checks"][0]
    assert plan_check["improved"] is True
    character_path = (
        campaign_ws["coc_root"] / "investigators" / investigator_id
        / "character.json"
    )
    character = json.loads(character_path.read_text(encoding="utf-8"))
    character.setdefault("skills", {})["Frozen Custom Skill"] = 99
    _write_json(character_path, character)
    state = json.loads(state_path.read_text(encoding="utf-8"))
    state["current_luck"] = 80
    _write_json(state_path, state)

    monkeypatch.setattr(
        coc_toolbox.coc_runtime_ops, "settle_development", original
    )
    retried = _run(campaign_ws, "state.end_session", end_args)
    result = retried["data"]["development"]["settlements"][0][
        "receipt"
    ]["result"]
    check = result["improvement_checks"][0]
    assert check["check_roll"] == plan_check["check_roll"]
    assert check["gain"] == plan_check["gain"]
    assert check["value_before"] == 10
    assert check["current_value_before_apply"] == 99
    assert check["value_after"] == 99 + plan_check["gain"]
    assert result["luck_recovery"]["planned_luck_before"] == 0
    assert result["luck_recovery"]["current_luck_before_apply"] == 80
    assert result["settlement_plan_sha256"] == frozen[
        "deterministic_plan"
    ]["plan_sha256"]

def test_base_layout_settlement_receipt_is_rejected_without_reapplying(
    campaign_ws,
):
    ended = _run(campaign_ws, "state.end_session", {
        "kind": "cliffhanger",
        "summary": "create a receipt to reshape as the base layout",
        "decision_id": "base-layout-rejection-ending",
    })
    assert ended["data"]["development"]["status"] == "PASS"
    investigator_id = campaign_ws["investigator_id"]
    ending_id = ended["data"]["ending_id"]
    exact = coc_toolbox.coc_development.ending_settlement_path(
        campaign_ws["campaign_dir"], ending_id, investigator_id
    )
    base_layout = (
        campaign_ws["campaign_dir"] / "save" / "development-settlements"
        / f"{investigator_id}.json"
    )
    base_layout.write_bytes(exact.read_bytes())
    exact.unlink()
    character = (
        campaign_ws["coc_root"] / "investigators" / investigator_id
        / "character.json"
    )
    rolls = campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"
    before = {
        character: character.read_bytes(),
        rolls: rolls.read_bytes(),
    }

    replay = _run(campaign_ws, "development.settle", {
        "investigator": investigator_id,
        "ending_id": ending_id,
        "decision_id": "base-layout-rejection-replay",
    })

    assert replay["ok"] is False
    assert replay["error"]["code"] == "development_settlement_failed"
    assert "unsupported base-layout" in replay["error"]["message"]
    assert {path: path.read_bytes() for path in before} == before
    assert not exact.exists()
    assert base_layout.is_file()

def test_capsule_event_identity_survives_preappend_crash_and_interleaving(
    campaign_ws, monkeypatch
):
    original_log_event = coc_toolbox.Ctx.log_event

    def crash_before_ending_append(self, record):
        if (
            record.get("event_type") == "session_ending"
            and record.get("decision_id") == "ending-preappend-crash"
        ):
            raise SystemExit("crash after capsule before ending append")
        return original_log_event(self, record)

    monkeypatch.setattr(
        coc_toolbox.Ctx, "log_event", crash_before_ending_append
    )
    args = {
        "kind": "cliffhanger",
        "summary": "stable event identity",
        "decision_id": "ending-preappend-crash",
    }
    with pytest.raises(SystemExit, match="after capsule before ending append"):
        _run(campaign_ws, "state.end_session", args)

    monkeypatch.setattr(coc_toolbox.Ctx, "log_event", original_log_event)
    capsule_paths = list((
        campaign_ws["campaign_dir"]
        / "save" / "development-settlements" / "endings"
    ).glob("*/capsule.json"))
    assert len(capsule_paths) == 1
    capsule = json.loads(capsule_paths[0].read_text(encoding="utf-8"))

    # New state must land before state.journal.  The journal then closes and is
    # finalized before the interrupted ending is replayed in the next turn.
    moved = _run(
        campaign_ws,
        "state.move_scene",
        {
            "scene_id": "post-capsule-improvised-scene",
            "decision_id": "ending-preappend-scene-change",
        },
    )
    assert moved["ok"] is True
    interleaved = _run(
        campaign_ws,
        "state.journal",
        {
            "summary": "unrelated events land before the ending retry",
            "player_text": "我先处理眼前无关的事情。",
            "decision_id": "ending-preappend-interleave",
        },
    )
    assert interleaved["ok"] is True
    _finalize_pending_turn_for_test(
        campaign_ws,
        decision_id="ending-preappend-interleave-finalize",
    )
    coc_state.link_party(
        campaign_ws["workspace"], campaign_ws["campaign_id"], []
    )
    replay = _run(campaign_ws, "state.end_session", args)
    assert replay["ok"] is True
    assert replay["data"]["scene_id"] == capsule["scene_id"]
    assert replay["data"]["investigator_ids"] == [
        campaign_ws["investigator_id"]
    ]
    assert replay["data"]["retry_target_conflict"] == {
        "code": "SETTLEMENT_TARGET_CONFLICT",
        "frozen_investigator_ids": [campaign_ws["investigator_id"]],
        "retry_investigator_ids": [],
        "resolution": "frozen_targets_preserved",
    }
    events = _read_jsonl(
        campaign_ws["campaign_dir"] / "logs" / "events.jsonl"
    )
    actual_line, ending_event = next(
        (index, row)
        for index, row in enumerate(events, start=1)
        if row.get("decision_id") == args["decision_id"]
        and row.get("event_type") == "session_ending"
    )
    assert actual_line != capsule["event_line_at_capture"]
    assert ending_event["event_id"] == capsule["event_id"]
    assert capsule["event_ref"] == (
        f"logs/events.jsonl#{ending_event['event_id']}"
    )
    assert replay["data"]["development"]["settlements"][0]["receipt"][
        "result"
    ]["ending_evidence"]["event_id"] == ending_event["event_id"]

def test_combat_conclusion_synchronously_settles_development_once(
    campaign_ws, monkeypatch
):
    for module_id in ("turn-output", "development"):
        monkeypatch.setattr(
            coc_toolbox.OPERATION_MODULES[module_id],
            "_ending_rng",
            lambda _ctx, _investigator_id: random.Random(5),
        )
    investigator_id = campaign_ws["investigator_id"]
    clue = _run(
        campaign_ws,
        "state.record_clue",
        {
            "clue_id": "clue-own-dagger-ends-him",
            "method": "structured fixture discovery",
            "decision_id": "settle-own-dagger-clue",
        },
    )
    assert clue["ok"] is True
    moved = _run(
        campaign_ws,
        "state.move_scene",
        {"scene_id": "corbitt-confrontation", "decision_id": "settle-move"},
    )
    assert moved["ok"] is True

    character_path = (
        campaign_ws["coc_root"] / "investigators" / investigator_id
        / "character.json"
    )
    brawl_before = json.loads(character_path.read_text(encoding="utf-8"))[
        "skills"
    ]["Fighting (Brawl)"]
    combat = _run(
        campaign_ws,
        "combat.resolve",
        {
            "affordance_id": "strike-with-his-dagger",
            "investigator": investigator_id,
            "decision_id": "settle-combat",
            "seed": 0,
        },
    )
    assert combat["ok"] is True, combat
    assert combat["data"]["combat"]["status"] == "concluded"
    assert combat["data"]["combat"]["outcome"] == "investigators_win"
    assert combat["data"]["improvement_ticks_recorded"] == [
        "Fighting (Brawl)"
    ]
    state_path = (
        campaign_ws["campaign_dir"] / "save" / "investigator-state"
        / f"{investigator_id}.json"
    )
    assert json.loads(state_path.read_text(encoding="utf-8"))[
        "skill_checks_earned"
    ] == ["Fighting (Brawl)"]
    combat_roll_path = campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"
    combat_rolls_before_replay = combat_roll_path.read_text(encoding="utf-8")
    replayed_combat = _run(
        campaign_ws,
        "combat.resolve",
        {
            "affordance_id": "strike-with-his-dagger",
            "investigator": investigator_id,
            "decision_id": "settle-combat",
            "seed": 999,
        },
    )
    assert replayed_combat["ok"] is True
    assert replayed_combat["data"] == combat["data"]
    assert combat_roll_path.read_text(encoding="utf-8") == combat_rolls_before_replay
    assert json.loads(state_path.read_text(encoding="utf-8"))[
        "skill_checks_earned"
    ] == ["Fighting (Brawl)"]

    end_args = {
        "kind": "conclusion",
        "summary": "Corbitt is destroyed.",
        "decision_id": "settle-ending",
    }
    ended = _run(campaign_ws, "state.end_session", end_args)
    assert ended["ok"] is True, ended
    assert ended["data"]["development"]["status"] == "PASS"
    settlement = ended["data"]["development"]["settlements"][0]
    assert settlement["status"] == "PASS"
    receipt = settlement["receipt"]
    result = receipt["result"]
    ending_id = ended["data"]["ending_id"]
    capsule = coc_toolbox.coc_development.load_ending_settlement_capsule(
        campaign_ws["campaign_dir"], ending_id
    )
    assert capsule is not None
    assert capsule["ending_id"] == ending_id
    assert capsule["event_id"] == (
        coc_toolbox.coc_development.ending_event_id(ending_id)
    )
    assert capsule["event_ref"] == f"logs/events.jsonl#{capsule['event_id']}"
    assert capsule["decision_id"] == end_args["decision_id"]
    assert capsule["conclusion_id"] == "corbitt-destroyed"
    assert capsule["development_inputs"][investigator_id][
        "skills_checked"
    ] == ["Fighting (Brawl)"]
    assert capsule["rng_identity"][investigator_id] == {
        "algorithm": "python-random-seed-v1",
        "seed_material": (
            f"{ending_id}:{investigator_id}:development.settle"
        ),
    }
    assert capsule["source_digest"]["combat_snapshot"]["exists"] is True
    assert len(capsule["source_digest"]["combat_snapshot"]["sha256"]) == 64
    assert capsule["source_digest"]["story_graph"]["exists"] is True
    assert len(capsule["source_digest"]["story_graph"]["sha256"]) == 64
    assert result["skills_checked"] == ["Fighting (Brawl)"]
    assert result["ending_evidence"]["conclusion_id"] == "corbitt-destroyed"
    conclusion_evidence = result["ending_evidence"]["conclusion_evidence"]
    assert conclusion_evidence == {
        "kind": "combat_outcome",
        "combat_id": "combat-corbitt-confrontation",
        "combat_outcome": "investigators_win",
        "scene_ref": "scene/corbitt-confrontation",
        "event_type": "combat_ended",
        "event_ref": conclusion_evidence["event_ref"],
        "event_sha256": conclusion_evidence["event_sha256"],
    }
    assert conclusion_evidence["event_ref"].startswith("logs/events.jsonl#")
    assert len(conclusion_evidence["event_sha256"]) == 64
    assert result["scenario_san_reward_expr"] == "1D6"
    assert result["scenario_san_reward"]["expression"] == "1D6"
    improvement_check = result["improvement_checks"][0]
    assert improvement_check["skill"] == "Fighting (Brawl)"
    assert improvement_check["value_before"] == brawl_before
    assert json.loads(character_path.read_text(encoding="utf-8"))["skills"][
        "Fighting (Brawl)"
    ] == improvement_check["value_after"]
    assert result["skills_improved"] == (
        [improvement_check] if improvement_check["improved"] else []
    )
    assert json.loads(state_path.read_text(encoding="utf-8"))[
        "skill_checks_earned"
    ] == []

    roll_path = campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"
    rolls = _read_jsonl(roll_path)
    kinds = [row.get("payload", {}).get("kind") for row in rolls]
    assert kinds.count("development_check") == 1
    assert kinds.count("development_gain") == int(improvement_check["improved"])
    assert kinds.count("luck_recovery") == 1
    assert kinds.count("scenario_san_reward") == 1
    scenario_roll = next(
        row for row in rolls
        if row.get("payload", {}).get("kind") == "scenario_san_reward"
    )
    assert scenario_roll["visibility"] == "public"
    assert scenario_roll["payload"]["die"] == "1D6"
    roll_ids = [row["roll_id"] for row in rolls]
    assert len(roll_ids) == len(set(roll_ids))
    assert all(row.get("source_ref") == f"logs/rolls.jsonl#{row['roll_id']}"
               for row in rolls)
    assert all(row.get("payload", {}).get("roll_id") == row["roll_id"]
               for row in rolls)

    rolls_before_retry = roll_path.read_text(encoding="utf-8")
    replay = _run(
        campaign_ws,
        "development.settle",
        {
            "investigator": investigator_id,
            "decision_id": "settle-explicit-replay",
            "seed": 999,
        },
    )
    duplicate_replay = _run(
        campaign_ws,
        "development.settle",
        {
            "investigator": investigator_id,
            "decision_id": "settle-explicit-replay",
            "seed": 1,
        },
    )
    duplicate_ending = _run(campaign_ws, "state.end_session", end_args)
    assert replay["ok"] and duplicate_replay["ok"] and duplicate_ending["ok"]
    assert replay["data"]["receipt"] == receipt
    assert duplicate_replay["data"] == replay["data"]
    assert duplicate_ending["data"] == ended["data"]
    assert roll_path.read_text(encoding="utf-8") == rolls_before_retry
    events = _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "events.jsonl")
    ending_event = next(
        row for row in events
        if row.get("event_type") == "session_ending"
        and row.get("decision_id") == "settle-ending"
    )
    assert ending_event["ending_id"] == ending_id
    assert ending_event["event_id"] == capsule["event_id"]
    assert ending_event["settlement_capsule_sha256"] == capsule[
        "capsule_sha256"
    ]
    assert ending_event["settlement_capsule_ref"] == (
        f"save/development-settlements/endings/{ending_id}/capsule.json"
    )
    assert len([
        row for row in events
        if row.get("event_type") == "session_ending"
        and row.get("decision_id") == "settle-ending"
    ]) == 1
    assert len([
        row for row in events
        if row.get("event_type") == "reward"
        and row.get("source") == "conclusion_rewards"
    ]) == 1

def test_party_conclusion_rewards_both_and_migrates_legacy_sanity_once(
    campaign_ws, monkeypatch
):
    ending_rng = lambda _ctx, investigator_id: random.Random(
        5 if investigator_id == campaign_ws["investigator_id"] else 7
    )
    for module_id in ("turn-output", "development"):
        monkeypatch.setattr(
            coc_toolbox.OPERATION_MODULES[module_id],
            "_ending_rng",
            ending_rng,
        )
    thomas_id = campaign_ws["investigator_id"]
    eleanor_id = _add_eleanor_to_party(campaign_ws)
    sanity_engine = coc_toolbox.coc_runtime_ops.coc_sanity
    legacy_session = sanity_engine.SanitySession(
        thomas_id,
        san_max=99,
        int_value=70,
        rng=random.Random(1),
        campaign_dir=campaign_ws["campaign_dir"],
    )
    legacy_session.san_current = 40
    legacy_session.day_start_san = 40
    legacy_path = campaign_ws["campaign_dir"] / "save" / "sanity.json"
    _write_json(legacy_path, legacy_session.snapshot())
    per_sanity_dir = campaign_ws["campaign_dir"] / "save" / "sanity-state"
    assert not per_sanity_dir.exists()

    assert _run(
        campaign_ws,
        "state.record_clue",
        {
            "clue_id": "clue-own-dagger-ends-him",
            "method": "party settlement fixture",
            "decision_id": "party-settle-clue",
        },
    )["ok"]
    assert _run(
        campaign_ws,
        "state.move_scene",
        {
            "scene_id": "corbitt-confrontation",
            "decision_id": "party-settle-move",
        },
    )["ok"]
    combat = _run(
        campaign_ws,
        "combat.resolve",
        {
            "affordance_id": "strike-with-his-dagger",
            "investigator": thomas_id,
            "decision_id": "party-settle-combat",
            "seed": 0,
        },
    )
    assert combat["ok"] is True
    assert combat["data"]["combat"]["outcome"] == "investigators_win"

    end_args = {
        "kind": "conclusion",
        "summary": "Both investigators survive Corbitt's destruction.",
        "decision_id": "party-settle-ending",
    }
    ended = _run(campaign_ws, "state.end_session", end_args)
    assert ended["ok"] is True, ended
    assert ended["data"]["investigator_ids"] == [thomas_id, eleanor_id]
    assert ended["data"]["development"]["status"] == "PASS"
    settlements = ended["data"]["development"]["settlements"]
    assert [row["investigator_id"] for row in settlements] == [
        thomas_id, eleanor_id
    ]
    assert all(row["status"] == "PASS" for row in settlements)
    assert all(
        row["receipt"]["result"]["scenario_san_reward_applied"] is True
        for row in settlements
    )

    ending_event = next(
        row for row in _read_jsonl(
            campaign_ws["campaign_dir"] / "logs" / "events.jsonl"
        )
        if row.get("event_type") == "session_ending"
        and row.get("decision_id") == end_args["decision_id"]
    )
    assert ending_event["investigator_ids"] == [thomas_id, eleanor_id]
    sanity_paths = {
        investigator_id: sanity_engine.sanity_snapshot_path(
            campaign_ws["campaign_dir"], investigator_id
        )
        for investigator_id in [thomas_id, eleanor_id]
    }
    assert all(path.is_file() for path in sanity_paths.values())
    assert len(list(per_sanity_dir.glob("*.json"))) == 2
    legacy = json.loads(legacy_path.read_text(encoding="utf-8"))
    thomas_sanity = json.loads(
        sanity_paths[thomas_id].read_text(encoding="utf-8")
    )
    eleanor_sanity = json.loads(
        sanity_paths[eleanor_id].read_text(encoding="utf-8")
    )
    assert legacy["investigator_id"] == thomas_id
    assert legacy == thomas_sanity
    assert eleanor_sanity["investigator_id"] == eleanor_id
    assert thomas_sanity["san_current"] != eleanor_sanity["san_current"]

    rolls_path = campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"
    events_path = campaign_ws["campaign_dir"] / "logs" / "events.jsonl"
    rolls_before_replay = rolls_path.read_bytes()
    events_before_replay = events_path.read_bytes()
    replay = _run(campaign_ws, "state.end_session", end_args)
    assert replay["ok"] is True
    assert replay["data"] == ended["data"]
    assert rolls_path.read_bytes() == rolls_before_replay
    assert events_path.read_bytes() == events_before_replay
    rolls = _read_jsonl(rolls_path)
    scenario_rolls = [
        row for row in rolls
        if row.get("payload", {}).get("kind") == "scenario_san_reward"
    ]
    assert {row["actor"] for row in scenario_rolls} == {thomas_id, eleanor_id}
    assert len(scenario_rolls) == 2
    assert len({row["roll_id"] for row in rolls}) == len(rolls)
    reward_events = [
        row for row in _read_jsonl(events_path)
        if row.get("event_type") == "reward"
        and row.get("source") == "conclusion_rewards"
    ]
    assert {row["actor_id"] for row in reward_events} == {thomas_id, eleanor_id}
    assert len(reward_events) == 2
    assert all(len(list((
        campaign_ws["campaign_dir"]
        / "save"
        / "development-settlements"
        / "conclusion-rewards"
        / investigator_id
    ).glob("*.json"))) == 1 for investigator_id in [thomas_id, eleanor_id])

    # Migration is one-way: once Thomas has a canonical per-investigator file,
    # a stale legacy singleton cannot supersede it on a later load.
    canonical_thomas_san = json.loads(
        sanity_paths[thomas_id].read_text(encoding="utf-8")
    )["san_current"]
    stale_legacy = json.loads(legacy_path.read_text(encoding="utf-8"))
    stale_legacy["san_current"] = 1
    _write_json(legacy_path, stale_legacy)
    migrated_thomas = sanity_engine.SanitySession.load(
        campaign_ws["campaign_dir"], thomas_id, rng=random.Random(30)
    )
    assert migrated_thomas.san_current == canonical_thomas_san
    migrated_thomas.save(campaign_ws["campaign_dir"], strict_mirror=True)

    # The migrated singleton remains Thomas's compatibility mirror.  Eleanor
    # subsequently writes only her canonical file; Thomas then writes his own
    # file and mirror without altering Eleanor's state.
    thomas_bytes_before = sanity_paths[thomas_id].read_bytes()
    legacy_bytes_before = legacy_path.read_bytes()
    eleanor_session = sanity_engine.SanitySession.load(
        campaign_ws["campaign_dir"], eleanor_id, rng=random.Random(31)
    )
    eleanor_session.gain_san(1, source="independence-test")
    eleanor_session.save(campaign_ws["campaign_dir"], strict_mirror=True)
    eleanor_bytes_after = sanity_paths[eleanor_id].read_bytes()
    assert sanity_paths[thomas_id].read_bytes() == thomas_bytes_before
    assert legacy_path.read_bytes() == legacy_bytes_before
    thomas_session = sanity_engine.SanitySession.load(
        campaign_ws["campaign_dir"], thomas_id, rng=random.Random(32)
    )
    thomas_session.gain_san(1, source="independence-test")
    thomas_session.save(campaign_ws["campaign_dir"], strict_mirror=True)
    assert sanity_paths[eleanor_id].read_bytes() == eleanor_bytes_after
    assert json.loads(legacy_path.read_text(encoding="utf-8")) == json.loads(
        sanity_paths[thomas_id].read_text(encoding="utf-8")
    )

def test_contextual_authored_routes_prevent_false_rolls_and_settle_direct_handouts(
    campaign_ws,
):
    _activate_newspaper_morgue(campaign_ws)
    access = _run(campaign_ws, "rules.roll", {
        "investigator": campaign_ws["investigator_id"],
        "skill": "Persuade",
        "target": 100,
        "difficulty": "regular",
        "goal": "说服 Arty 允许进入剪报库",
        "stakes": {
            "on_success": "Arty 允许进入剪报库",
            "on_failure": "Arty 拒绝开放剪报库",
        },
        "difficulty_basis": "authored_gate",
        "resolution_context": {
            "attempt_id": "route:newspaper-morgue:persuade-arty",
            "scene_id": "newspaper-morgue",
            "route_id": "persuade-arty",
            "roll_density_group": "route:newspaper-morgue:persuade-arty",
        },
        "decision_id": "persuade-arty-success",
        "seed": 2,
    })
    assert access["ok"] is True, access
    assert access["data"]["success"] is True

    hot_context = _run(campaign_ws, "scene.context")
    direct_summary = next(
        row for row in hot_context["data"]["action_routes"]
        if row["route_id"] == "search-clippings"
    )
    assert direct_summary["resolution_kind"] == "direct_delivery"
    assert "operation_opportunities" not in direct_summary

    advised = _run(campaign_ws, "actions.advise", {
        "investigator": campaign_ws["investigator_id"],
        "intent_evidence": {
            "primary_intent": "investigate",
            "reason": "调查员已获准进入剪报库并按地址翻找旧稿。",
            "matched_affordance_ids": ["search-clippings"],
        },
    })
    assert advised["ok"] is True, advised
    resolution = advised["data"]["resolution_advice"]
    assert resolution["route_id"] == "search-clippings"
    assert resolution["resolution_kind"] == "direct_delivery"
    operations = resolution["operation_opportunities"]
    assert [row["operation"] for row in operations] == [
        "state.record_clue", "state.record_clue",
    ]
    assert all(row["hard_gate"] is False for row in advised["data"]["action_routes"])

    results = []
    for index, operation in enumerate(operations, start=1):
        results.append(_run(
            campaign_ws,
            operation["operation"],
            {
                **operation["prefilled_arguments"],
                "decision_id": f"direct-clipping-{index}",
            },
        ))
    assert all(row["ok"] is True for row in results)
    assert results[0]["data"]["route_completion"] is None
    assert results[1]["data"]["route_completion"]["route_id"] == "search-clippings"
    world = json.loads((
        campaign_ws["campaign_dir"] / "save" / "world-state.json"
    ).read_text(encoding="utf-8"))
    consumed = {
        row["route_id"] for row in world.get("route_completion_receipts") or []
        if row.get("status") == "consumed"
    }
    assert {"persuade-arty", "search-clippings"}.issubset(consumed)
    roll_rows = _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl")
    assert len(roll_rows) == 1

def test_npc_engagement_semantically_completes_access_route_without_extra_roll(
    campaign_ws,
):
    _activate_newspaper_morgue(campaign_ws)
    reaction = _run(campaign_ws, "npc.reaction", {
        "npc_id": "npc-arty-wilmot",
        "npc_display_name": "阿尔蒂·威尔莫特",
        "investigator": campaign_ws["investigator_id"],
        "context": {
            "player_conduct": "调查员专业说明来意并尊重编辑室边界",
            "scene_constraints": "阿尔蒂掌握地下剪报库的准入",
            "authored_or_relationship_boundary": "放行不改变其守门人议程",
            "semantic_reason": "首次接触决定即时准入摩擦",
        },
        "seed": 2,
        "decision_id": "arty-alternate-access-reaction",
    })
    assert reaction["ok"] is True, reaction
    engagement_card = reaction["data"]["record_engagement_operation"]
    engagement = _run(campaign_ws, engagement_card["operation"], {
        **engagement_card["prefilled_arguments"],
        "interaction_kind": "assistance",
        "decision_id": "arty-alternate-access-engagement",
        "first_impression_realization": {
            "observable_manner": "阿尔蒂收起拒人的架势，朝地下室门一抬下巴",
            "causal_explanation": "专业而克制的初见让他把调查员当成可放行的正经访客",
            "boundary_preserved": "他仍守着编辑室与未刊材料的权限边界",
            "opportunity_or_friction": "他允许进入剪报库并指名露丝按名调档",
        },
        "route_completion": {
            "scene_id": "newspaper-morgue",
            "route_id": "persuade-arty",
            "semantic_reason": "阿尔蒂已在本次有来源的首次接触中明确放行",
        },
    })
    assert engagement["ok"] is True, engagement
    assert any("persuade-arty" in hint for hint in engagement["hints"])

    world = json.loads((
        campaign_ws["campaign_dir"] / "save" / "world-state.json"
    ).read_text(encoding="utf-8"))
    route_receipt = next(
        row for row in world["route_completion_receipts"]
        if row["route_id"] == "persuade-arty"
    )
    assert route_receipt["status"] == "consumed"
    assert route_receipt["completion_quality"] == "keeper_judgment"
    assert route_receipt["hard_gate"] is False
    assert route_receipt["semantic_reason"].startswith("阿尔蒂已")

    context = _run(campaign_ws, "scene.context")
    routes = {row["route_id"]: row for row in context["data"]["action_routes"]}
    assert "persuade-arty" not in routes
    assert routes["search-clippings"]["resolution_kind"] == "direct_delivery"
    advised = _run(campaign_ws, "actions.advise", {
        "intent_evidence": {
            "primary_intent": "search_clippings",
            "reason": "玩家已获准入并明确按地址翻查剪报",
            "matched_affordance_ids": ["search-clippings"],
        },
    })
    assert advised["ok"] is True, advised
    assert [
        row["operation"]
        for row in advised["data"]["resolution_advice"]["operation_opportunities"]
    ] == ["state.record_clue", "state.record_clue"]

def test_route_completion_repairs_older_structured_evidence_without_save_edit(
    campaign_ws,
):
    _activate_newspaper_morgue(campaign_ws)
    reaction = _run(campaign_ws, "npc.reaction", {
        "npc_id": "npc-arty-wilmot",
        "npc_display_name": "阿尔蒂·威尔莫特",
        "investigator": campaign_ws["investigator_id"],
        "context": {
            "player_conduct": "调查员清楚说明来意",
            "scene_constraints": "阿尔蒂掌握剪报库准入",
            "authored_or_relationship_boundary": "准入不等于交出编辑室秘密",
            "semantic_reason": "首次接触影响当场放行机会",
        },
        "seed": 2,
        "decision_id": "legacy-arty-reaction",
    })
    assert reaction["ok"] is True, reaction
    repaired = _run(campaign_ws, "state.record_route_completion", {
        "scene_id": "newspaper-morgue",
        "route_id": "persuade-arty",
        "semantic_reason": "既有初印象收据已由 KP 在桌面实现为阿尔蒂明确放行",
        "evidence_ref": reaction["data"]["first_impression_ref"],
        "decision_id": "repair-legacy-arty-access-route",
    })
    assert repaired["ok"] is True, repaired
    assert repaired["data"]["completed"] is True
    receipt = repaired["data"]["route_completion"]
    assert receipt["route_id"] == "persuade-arty"
    assert receipt["completion_quality"] == "keeper_judgment"
    assert receipt["evidence_ref"] == reaction["data"]["first_impression_ref"]
    assert repaired["data"]["next_operation"] == {
        "operation": "scene.context",
        "invoke_via": "coc_invoke",
        "prefilled_arguments": {},
        "missing_arguments": [],
        "reason": (
            "Refresh the bounded active-scene route index after recording "
            "this campaign-local semantic completion."
        ),
        "hard_gate": False,
    }
    assert _run(campaign_ws, "state.record_route_completion", {
        "scene_id": "newspaper-morgue",
        "route_id": "persuade-arty",
        "semantic_reason": "既有初印象收据已由 KP 在桌面实现为阿尔蒂明确放行",
        "evidence_ref": reaction["data"]["first_impression_ref"],
        "decision_id": "repair-legacy-arty-access-route",
    })["data"] == repaired["data"]

def test_same_attempt_retry_is_soft_advice_and_survives_resume(campaign_ws):
    _activate_newspaper_morgue(campaign_ws)
    story_path = campaign_ws["campaign_dir"] / "scenario" / "story-graph.json"
    story = json.loads(story_path.read_text(encoding="utf-8"))
    morgue = next(
        row for row in story["scenes"] if row["scene_id"] == "newspaper-morgue"
    )
    persuade = next(
        row for row in morgue["affordances"] if row["id"] == "persuade-arty"
    )
    persuade["roll_gate"]["retry_policy"] = {
        "mode": "elapsed_time_reset",
        "minimum_elapsed_minutes": 60,
    }
    _write_json(story_path, story)
    context = {
        "attempt_id": "archive-index-attempt",
        "scene_id": "newspaper-morgue",
        "route_id": "persuade-arty",
        "roll_density_group": "archive-index",
    }
    first = _run(campaign_ws, "rules.roll", {
        "target": 1,
        "resolution_context": context,
        "decision_id": "soft-attempt-one",
        "seed": 2,
    })
    assert first["ok"] is True
    assert first["data"]["success"] is False
    opportunity = first["data"]["operation_opportunities"][0]
    assert opportunity["hard_gate"] is False
    # The advice must name something the Keeper can actually reach. coc7 has
    # promoted push-luck to the graph, so the legacy `rules.push` is
    # `kp_surface: "none"` and suggesting it would be a guaranteed refusal;
    # the ruleset-agnostic discovery path is the honest advice there. A
    # ruleset that has not promoted the family still gets `rules.push`.
    suggested = opportunity["suggested_operation"]
    assert suggested["operation"] in {"rules.push", "rules.context"}
    assert suggested["invoke_via"], suggested
    if suggested["operation"] == "rules.context":
        assert suggested["prefilled_arguments"]["family"] == "push-luck"
    assert opportunity["attempt_pressure"]["same_goal_no_progress_count"] == 1
    assert opportunity["retry_status"]["status"] == "waiting"

    second = _run(campaign_ws, "rules.roll", {
        "target": 1,
        "resolution_context": context,
        "decision_id": "soft-attempt-two",
        "seed": 2,
    })
    assert second["ok"] is True
    assert second["data"]["attempt_advisory"]["hard_gate"] is False
    assert second["data"]["attempt_pressure"]["same_goal_no_progress_count"] == 2
    assert any("soft advice only" in warning for warning in second["warnings"])

    resumed = _run(campaign_ws, "session.resume")
    assert resumed["ok"] is True, resumed
    open_attempts = resumed["data"]["operation_opportunities"]
    assert open_attempts[-1]["source"]["decision_id"] == "soft-attempt-two"
    assert open_attempts[-1]["hard_gate"] is False
    assert open_attempts[-1]["attempt_pressure"]["same_goal_no_progress_count"] == 2

    advanced = _run(campaign_ws, "state.advance_time", {
        "minutes": 60,
        "reason": "等待作者声明的重新尝试窗口",
        "decision_id": "soft-attempt-wait",
    })
    assert advanced["ok"] is True
    advised = _run(campaign_ws, "actions.advise", {
        "intent_evidence": {
            "primary_intent": "retry_editor_access",
            "reason": "作者结构化等待窗口已经由权威时间记录满足。",
            "matched_affordance_ids": ["persuade-arty"],
        },
    })
    reset_retry = advised["data"]["resolution_advice"]
    assert reset_retry["resolution_kind"] == "reset_retry"
    assert reset_retry["hard_gate"] is False
    assert reset_retry["operation_opportunities"]
    reset_context = reset_retry["operation_opportunities"][0][
        "prefilled_arguments"
    ]["resolution_context"]
    assert reset_context["reset_evidence"]["policy_mode"] == "elapsed_time_reset"
    assert reset_context["reset_evidence"]["elapsed_minutes"] == 60

def test_actions_advise_combines_stable_storylet_and_adoption_updates_ledger(
    campaign_ws, monkeypatch,
):
    candidate = {
        "storylet_id": "test-longrun-pressure",
        "family_id": "longrun",
        "trope_id": "world_moves",
        "title": "世界不会干等",
        "cue": "调查员核对资料时，窗外报童突然喊出一条与旧宅有关的新消息。",
        "beat": "pressure",
        "conflict_level": "rising",
        "target_conflict_level": "rising",
        "bound_entities": {"location_id": "campaign-opening"},
        "rolled_variants": {},
        "presentation_mode": "fictional_beat",
        "grounding_contract": {"status": "authorized"},
        "serves": ["pacing"],
    }
    monkeypatch.setattr(
        coc_toolbox.coc_storylets,
        "select_storylet_moves",
        lambda *args, **kwargs: [deepcopy(candidate)],
    )
    args = {
        "player_text": "我继续核对眼前的资料，同时留意房间里的动静。",
        "intent_evidence": {
            "primary_intent": "investigate",
            "reason": "玩家继续调查，但也明确关注环境变化。",
            "matched_affordance_ids": [],
        },
    }
    first = _run(campaign_ws, "actions.advise", args)
    second = _run(campaign_ws, "actions.advise", args)
    assert first["ok"] is True, first
    assert second["ok"] is True, second
    opportunity = first["data"]["narrative_opportunity"]
    assert opportunity is not None
    assert opportunity["hard_gate"] is False
    assert opportunity["candidate_ref"].startswith("storylet-candidate-v1:")
    assert opportunity["adoption_operation"]["prefilled_arguments"] == {
        "advice_id": opportunity["advice_id"],
        "candidate_ref": opportunity["candidate_ref"],
    }
    assert opportunity == second["data"]["narrative_opportunity"]

    ctx = coc_toolbox.Ctx(campaign_ws["workspace"], campaign_ws["campaign_id"])
    legacy = coc_toolbox._normalize_finalized_advisory_uptake(
        ctx,
        {
            "advice_id": opportunity["advice_id"],
            "disposition": "modified",
            "reason": "兼容旧宿主的完整候选输入。",
            "adopted_fields": ["candidate.cue"],
            "storylet_candidate": opportunity["candidate"],
            "exact_excerpt": "兼容候选",
        },
        draft="兼容候选",
    )
    assert legacy["candidate_ref"] == opportunity["candidate_ref"]

    journal = _run(campaign_ws, "state.journal", {
        "summary": "调查员继续核对资料，同时留意环境变化。",
        "player_action": "核对资料并留意周围动静",
        "player_text": args["player_text"],
        "decision_id": "journal-longrun-pressure",
    })
    assert journal["ok"] is True, journal
    output = _run(campaign_ws, "turn.output_context")
    assert output["ok"] is True, output
    assert output["data"]["narrative_opportunity"] == opportunity
    excerpt = "窗外报童忽然扯开嗓子，喊出一条与旧宅有关的新消息。"
    finalized = _run(campaign_ws, "turn.finalize", {
        "draft": "纸页在指间沙沙作响。\n\n" + excerpt,
        "coverage": [],
        "mechanics_placements": [],
        "revision": 1,
        "decision_id": "finalize-longrun-pressure",
        "advisory_uptake": {
            "advice_id": opportunity["advice_id"],
            "disposition": "modified",
            "reason": "保留世界主动变化的功能，并改写成当前场景可直接听见的报童叫卖。",
            "adopted_fields": ["candidate.cue", "candidate.beat"],
            "candidate_ref": opportunity["candidate_ref"],
            "exact_excerpt": excerpt,
        },
    })
    assert finalized["ok"] is True, finalized
    ledger = json.loads((
        campaign_ws["campaign_dir"] / "save" / "storylet-ledger.json"
    ).read_text(encoding="utf-8"))
    assert ledger["last_storylet_id"] == "test-longrun-pressure"
    adoption_rows = [
        json.loads(line)
        for line in (
            campaign_ws["campaign_dir"] / "logs" / "advisory-adoptions.jsonl"
        ).read_text(encoding="utf-8").splitlines()
    ]
    assert adoption_rows[-1]["finalization_id"] == finalized["data"]["finalization_id"]
    assert adoption_rows[-1]["exact_excerpt"] == excerpt

def test_rich_advice_storylets_and_narration_are_canonically_reachable(campaign_ws):
    intent = {
        "primary_intent": "investigate_scene",
        "reason": "The player explicitly searches the active room for the source of a sound.",
    }
    player_text = "我检查房间里刚才异响的来源。"
    advised = _run(campaign_ws, "director.advise", {
        "player_text": player_text,
        "intent_evidence": intent,
        "seed": 7,
    })
    assert advised["ok"] is True
    plan = advised["data"]["candidate_plan"]

    storylets = _run(campaign_ws, "storylets.suggest", {
        "candidate_plan": plan,
        "player_text": player_text,
        "intent_evidence": intent,
        "seed": 7,
    })
    assert storylets["ok"] is True
    assert storylets["data"]["authority"] == "advisory"

    npc = _run(campaign_ws, "npc.advise", {"intent_evidence": intent, "seed": 7})
    assert npc["ok"] is True
    assert npc["data"]["authority"] == "advisory"

    narration = _run(campaign_ws, "narration.brief", {
        "candidate_plan": plan,
        "applied_events": [],
    })
    assert narration["ok"] is True
    assert narration["data"]["authority"] == "drafting_brief"
    assert narration["data"]["style_contract"]["register"] == "natural_tabletop_narration"
    uptake = narration["data"]["narration_envelope"]["action_uptake"]
    assert uptake["player_text"] == player_text
    assert uptake["primary_intent"] == "investigate_scene"
    assert uptake["authority"] == "player_message"
    assert uptake["render_policy"]["hard_gate"] is False
    assert "treat_current_action_uptake_as_semantic_repetition" in uptake["render_policy"]["do_not"]
    assert any("naturally enact" in hint for hint in narration["hints"])

    # The natural agent order may decide on a roll after consulting the
    # Director.  narration.brief must consume that settled toolbox receipt;
    # callers must not edit the advisory plan just to make the text layer see it.
    settled_roll = _run(campaign_ws, "rules.roll", {
        "skill": "Spot Hidden",
        "reason": "check the active room for the source of the sound",
        "seed": 29,
        "decision_id": "narration-applied-roll-1",
    })
    assert settled_roll["ok"] is True
    narration_after_roll = _run(campaign_ws, "narration.brief", {
        "candidate_plan": plan,
        "applied_events": [settled_roll["data"]],
    })
    projected_rolls = narration_after_roll["data"]["narration_envelope"]["rule_results"]
    assert len(projected_rolls) == 1
    assert projected_rolls[0]["roll_id"] == settled_roll["data"]["roll_id"]
    assert projected_rolls[0]["outcome"] == settled_roll["data"]["outcome"]
    assert projected_rolls[0]["success"] is (
        settled_roll["data"]["outcome"]
        in {"critical", "extreme", "hard", "regular", "success"}
    )

    # The canonical state remains authoritative even when a host omits the
    # state.move_scene receipt from applied_events.  The active scene anchor
    # and state grounding must never disagree about the investigator's
    # location merely because the agent assembled an incomplete receipt list.
    moved = _run(campaign_ws, "state.move_scene", {
        "scene_id": "central-library",
        "reason": "continue research at the public library",
        "decision_id": "narration-canonical-scene-1",
    })
    assert moved["ok"] is True
    narration_after_move = _run(campaign_ws, "narration.brief", {
        "candidate_plan": plan,
        "applied_events": [],
    })
    moved_envelope = narration_after_move["data"]["narration_envelope"]
    assert moved_envelope["scene_anchor"]["scene_id"] == "central-library"
    grounding = moved_envelope["state_grounding"]
    assert grounding["active_scene_before_id"] == plan["turn_input"]["active_scene_id"]
    assert grounding["active_scene_after_id"] == "central-library"
    assert grounding["scene_transition_committed"] is True
    assert grounding["recovery_required"] is False

    narration_with_stale_receipt = _run(campaign_ws, "narration.brief", {
        "candidate_plan": plan,
        "applied_events": [{
            "event_type": "scene_transition",
            "to_scene": plan["turn_input"]["active_scene_id"],
        }],
    })
    stale_grounding = (
        narration_with_stale_receipt["data"]["narration_envelope"]["state_grounding"]
    )
    assert stale_grounding["active_scene_after_id"] == "central-library"
    review = _run(campaign_ws, "narration.review", {
        "decision_id": "semantic-review-1",
        "draft_text": "店员已经彻底被恐惧支配，无法理性思考。",
        "findings": [{
            "rule_id": "observable_before_interpretation",
            "reason": "The draft asserts an NPC's hidden mental state without observable behavior or established evidence.",
        }],
    })
    assert review["ok"] is True
    assert review["data"]["hard_gate"] is False
    assert review["data"]["findings"][0]["reason"].startswith("The draft")

def test_personal_horror_and_adoption_receipts_prove_actual_use(campaign_ws):
    added = _run(campaign_ws, "state.personal_horror_add", {
        "hook_id": "hook-editor",
        "backstory_field": "significant_people",
        "summary": "The editor who buried the investigator's first story.",
        "decision_id": "hook-add-1",
    })
    assert added["ok"] is True
    queried = _run(campaign_ws, "personal_horror.query")
    assert queried["ok"] is True
    assert queried["data"]["personal_horror_hooks"][0]["woven"] is False

    woven = _run(campaign_ws, "state.personal_horror_mark_woven", {
        "hook_id": "hook-editor",
        "decision_id": "hook-woven-1",
    })
    assert woven["ok"] is True
    advised = _run(campaign_ws, "director.advise", {
        "player_text": "I keep the editor's pressure in mind while questioning the clerk.",
        "intent_evidence": {
            "primary_intent": "question_clerk",
            "reason": "The player is questioning the clerk while carrying prior pressure.",
        },
    })
    assert advised["ok"] is True
    adoption = _run(campaign_ws, "evidence.record_adoption", {
        "decision_id": "turn-adoption-1",
        "advice_id": advised["data"]["advice_id"],
        "disposition": "modified",
        "reason": "The pressure fit, but the NPC move contradicted the live conversation.",
        "adopted_fields": ["candidate_plan.beat", "candidate_plan.tone"],
    })
    assert adoption["ok"] is True
    rows = _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "advisory-adoptions.jsonl")
    assert rows[-1]["visibility"] == "keeper_internal"
    assert rows[-1]["disposition"] == "modified"

def test_adoption_receipt_records_emotional_tone_follow_through(campaign_ws):
    advised = _run(campaign_ws, "director.advise", {
        "player_text": "I watch both clerks' reactions before answering.",
        "intent_evidence": {
            "primary_intent": "observe_clerks",
            "reason": "The player explicitly observes the NPCs' reactions.",
        },
    })
    assert advised["ok"] is True
    advice_id = advised["data"]["advice_id"]
    adoption = _run(campaign_ws, "evidence.record_adoption", {
        "decision_id": "turn-adoption-tone-1",
        "advice_id": advice_id,
        "disposition": "modified",
        "reason": "Played Knott cold per the reaction roll; softened Arty's refusal.",
        "emotional_tone_adoption": [
            {"npc_id": "npc-steven-knott", "emotional_tone": "cold and suspicious", "adoption": "adopted"},
            {"npc_id": "npc-arty-wilmot", "emotional_tone": "guarded but civil", "adoption": "modified"},
        ],
    })
    assert adoption["ok"] is True
    tones = adoption["data"]["emotional_tone_adoption"]
    assert tones == [
        {"npc_id": "npc-steven-knott", "emotional_tone": "cold and suspicious", "adoption": "adopted"},
        {"npc_id": "npc-arty-wilmot", "emotional_tone": "guarded but civil", "adoption": "modified"},
    ]
    rows = _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "advisory-adoptions.jsonl")
    assert rows[-1]["emotional_tone_adoption"] == tones

    # Absent param keeps the receipt shape unchanged (backward compatible).
    plain = _run(campaign_ws, "evidence.record_adoption", {
        "decision_id": "turn-adoption-tone-2",
        "advice_id": advice_id,
        "disposition": "ignored",
        "reason": "No plan elements fit the live conversation.",
    })
    assert plain["ok"] is True
    assert "emotional_tone_adoption" not in plain["data"]

    bad_status = _run(campaign_ws, "evidence.record_adoption", {
        "decision_id": "turn-adoption-tone-3",
        "advice_id": advice_id,
        "disposition": "adopted",
        "reason": "test",
        "emotional_tone_adoption": [
            {"npc_id": "npc-x", "emotional_tone": "warm", "adoption": "played"},
        ],
    })
    assert bad_status["ok"] is False
    assert bad_status["error"]["code"] == "invalid_param"

    missing_fields = _run(campaign_ws, "evidence.record_adoption", {
        "decision_id": "turn-adoption-tone-4",
        "advice_id": advice_id,
        "disposition": "adopted",
        "reason": "test",
        "emotional_tone_adoption": [{"npc_id": "npc-x"}],
    })
    assert missing_fields["ok"] is False
    assert missing_fields["error"]["code"] == "invalid_param"

def test_full_sanity_session_consumes_authored_scene_trigger(campaign_ws):
    moved = _run(
        campaign_ws,
        "state.move_scene",
        {"scene_id": "upper-floor-bedroom", "decision_id": "full-san-move-bedroom"},
    )
    assert moved["ok"] is True
    trigger = _run(campaign_ws, "scene.context")["data"]["pending_san_triggers"][0]
    decision_id = "full-san-authored-trigger"
    command = {
        "command_id": decision_id,
        "kind": "sanity_check",
        "phase": "resolve",
        "payload": {
            "decision_id": decision_id,
            "roll_id": decision_id,
            "skill": "SAN",
            "difficulty": "regular",
            "san_loss_success": trigger["san_loss_success"],
            "san_loss_fail_expr": trigger["san_loss_fail_expr"],
            "source": trigger["source"],
            "trigger_id": trigger["trigger_id"],
        },
    }

    resolved = _run(
        campaign_ws,
        "sanity.execute",
        {"decision_id": decision_id, "command": command, "seed": 9},
    )

    assert resolved["ok"] is True
    check = resolved["data"]["results"][0]["events"][0]
    assert check["san_trigger_id"] == trigger["trigger_id"]
    assert _run(campaign_ws, "scene.context")["data"]["pending_san_triggers"] == []

def test_single_npc_query_projects_unrolled_first_contact_readiness(campaign_ws):
    npc_id = "npc-steven-knott"
    rolls_path = campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"
    rolls_before = rolls_path.read_bytes() if rolls_path.is_file() else b""

    queried = _run(campaign_ws, "npc.query", {"npc_id": npc_id})
    assert queried["ok"] is True, queried
    readiness = queried["data"]["npcs"][0]["first_contact_readiness"]
    assert readiness["npc_id"] == npc_id
    assert readiness["identity_ready"] is True
    assert readiness["agenda_ready"] is True
    assert readiness["persona_ready"] is True
    assert readiness["persona"]["source_status"] == "authored"
    assert readiness["persona"]["voice"] == queried["data"]["npcs"][0]["voice"]
    assert readiness["mechanics_ready"] is False
    assert readiness["mechanics_source_status"] == "source_unresolved"
    assert readiness["pending_source_dependency"]["consumer"] == "mechanics.ensure"
    pair = readiness["requested_pair_first_impression"]
    assert pair == {
        "status": "missing",
        "investigator_id": campaign_ws["investigator_id"],
        "receipt_exists": False,
        "first_impression_ref": None,
    }
    reaction = next(
        card for card in readiness["next_operation_cards"]
        if card["operation"] == "npc.reaction"
    )
    assert reaction["roll_created"] is False
    assert reaction["fresh_decision_id_required"] is True
    assert reaction["campaign_id"] == campaign_ws["campaign_id"]
    assert reaction["prefilled_arguments"]["run_id"] == (
        f"campaign:{campaign_ws['campaign_id']}"
    )
    assert reaction["missing_arguments"] == [
        "npc_display_name",
        "context.player_conduct",
        "context.scene_constraints",
        "context.authored_or_relationship_boundary",
        "context.semantic_reason",
        "decision_id",
    ]
    social = readiness["social_adjudication_operation"]
    assert social["prefilled_arguments"] == {
        "investigator": campaign_ws["investigator_id"],
        "npc_id": npc_id,
    }
    assert social["missing_arguments"] == [
        "conversation_window_id", "commitment_id", "approach",
        "goal_summary", "decision_id",
    ]
    assert social["valid_optional_evidence_refs"] == [
        "npc_fact:npc-steven-knott/fact-knott-commission",
        "npc_fact:npc-steven-knott/fact-knott-research-leads",
        "npc_fact:npc-steven-knott/fact-knott-macario-tragedy",
    ]
    assert social["safe_omissions"] == {
        "motive": "omit to use neutral intensity 0",
        "leverage": "omit when no exact player-known typed source applies",
        "feasibility": "omit to derive the canonical default",
        "feasibility_refs": "omit together with feasibility",
    }
    assert (rolls_path.read_bytes() if rolls_path.is_file() else b"") == rolls_before
    bulk = _run(campaign_ws, "npc.query")
    assert all("first_contact_readiness" not in row for row in bulk["data"]["npcs"])

def test_first_contact_readiness_reuses_receipt_and_seed_stable_persona(campaign_ws):
    improvised_id = "npc-improvised-readiness"
    seeded = _run(campaign_ws, "state.npc_update", {
        "npc_id": improvised_id,
        "trust_delta": 1,
        "decision_id": "seed-improvised-readiness",
    })
    assert seeded["ok"] is True
    state_path = campaign_ws["campaign_dir"] / "save" / "npc-state.json"
    state_before = state_path.read_bytes()
    first = _run(campaign_ws, "npc.query", {"npc_id": improvised_id})
    second = _run(campaign_ws, "npc.query", {"npc_id": improvised_id})
    assert state_path.read_bytes() == state_before
    first_ready = first["data"]["npcs"][0]["first_contact_readiness"]
    second_ready = second["data"]["npcs"][0]["first_contact_readiness"]
    assert first_ready["persona_ready"] is False
    assert first_ready["persona_candidate_ready"] is True
    assert first_ready["persona"]["source_status"] == "seed_stable_proposal"
    assert first_ready["persona"]["authority"] == "advisory"
    assert first_ready["persona"]["keeper_only"] is True
    assert first_ready["persona"]["seed"] == second_ready["persona"]["seed"]
    assert first_ready["persona"]["tags"] == second_ready["persona"]["tags"]
    assert first_ready["mechanics_source_status"] == "campaign_fallback_eligible"
    mechanics = next(
        card for card in first_ready["next_operation_cards"]
        if card["operation"] == "mechanics.ensure"
    )
    assert "fallback_archetype_id" in mechanics["missing_arguments"]

    binding = _first_contact_binding(
        campaign_ws, improvised_id, key="improvised-readiness",
    )
    after = _run(campaign_ws, "npc.query", {"npc_id": improvised_id})
    after_ready = after["data"]["npcs"][0]["first_contact_readiness"]
    assert after_ready["requested_pair_first_impression"]["receipt_exists"] is True
    assert after_ready["requested_pair_first_impression"]["first_impression_ref"] == (
        binding["first_impression_ref"]
    )
    assert not any(
        card["operation"] == "npc.reaction"
        for card in after_ready["next_operation_cards"]
    )

def test_explicit_campaign_local_npc_presence_reaches_scene_context_and_replays(
    campaign_ws,
):
    npc_id = "npc-improvised-door-attendant"
    seeded = _run(campaign_ws, "state.npc_update", {
        "npc_id": npc_id,
        "suspicion_delta": 1,
        "decision_id": "presence-seed-psych",
    })
    assert seeded["ok"] is True

    before = _run(campaign_ws, "scene.context")
    assert before["ok"] is True
    revision = before["data"]["working_set"]["revision"]
    assert npc_id not in {
        row["npc_id"] for row in before["data"]["npcs_present"]
    }
    scene_id = before["data"]["active_scene_id"]
    args = {
        "npc_id": npc_id,
        "scene_id": scene_id,
        "status": "present",
        "reason": "the attendant opened the door and remained at the threshold",
        "decision_id": "presence-door-attendant-arrives",
    }
    placed = _run(campaign_ws, "state.npc_presence", args)
    replay = _run(campaign_ws, "state.npc_presence", args)
    assert placed["ok"] is True, placed
    assert replay["ok"] is True, replay
    assert replay["data"] == placed["data"]
    assert any("duplicate decision_id" in warning for warning in replay["warnings"])

    after = _run(campaign_ws, "scene.context", {"since_revision": revision})
    assert after["ok"] is True
    assert after["data"].get("not_modified") is not True
    row = next(
        row for row in after["data"]["npcs_present"] if row["npc_id"] == npc_id
    )
    assert row["origin"] == "improvised"
    assert row["presence_source"] == "live"
    assert row["presence"]["scene_id"] == scene_id
    assert row["presence"]["status"] == "present"
    assert row["suspicion"] == 1

    conflict = _run(campaign_ws, "state.npc_presence", {
        **args,
        "status": "absent",
    })
    assert conflict["ok"] is False
    assert conflict["error"]["code"] == "idempotency_conflict"

    removed = _run(campaign_ws, "state.npc_presence", {
        "npc_id": npc_id,
        "scene_id": scene_id,
        "status": "absent",
        "reason": "the attendant left the threshold",
        "decision_id": "presence-door-attendant-leaves",
    })
    assert removed["ok"] is True
    final_context = _run(campaign_ws, "scene.context")
    assert npc_id not in {
        row["npc_id"] for row in final_context["data"]["npcs_present"]
    }

    state = json.loads(
        (campaign_ws["campaign_dir"] / "save" / "npc-state.json").read_text(
            encoding="utf-8"
        )
    )
    receipt = state["operation_receipts"]["state.npc_presence"][
        "presence-door-attendant-arrives"
    ]
    assert receipt["entity_head"]["entity_kind"] == "npc_presence"
    assert state["presence_heads"][npc_id]["decision_id"] == (
        "presence-door-attendant-leaves"
    )

def test_record_npc_engagement_is_idempotent_with_first_impression_state(campaign_ws):
    moved = _run(
        campaign_ws,
        "state.move_scene",
        {
            "scene_id": "higher-courts-central-police",
            "decision_id": "move-kim-engagement",
        },
    )
    assert moved["ok"] is True
    queried = _run(campaign_ws, "npc.query", {"npc_id": "npc-kim-debrun"})
    identity_ref = queried["data"]["npcs"][0]["identity_ref"]
    args = {
        "npc_id": "npc-kim-debrun",
        "interaction_kind": "dialogue",
        "identity_ref": identity_ref,
        "run_id": "toolbox-live-segment",
        "decision_id": "kim-engagement-once",
        **_first_contact_binding(
            campaign_ws,
            "npc-kim-debrun",
            key="kim-engagement",
            run_id="toolbox-live-segment",
        ),
    }
    state_path = campaign_ws["campaign_dir"] / "save" / "npc-state.json"
    before = state_path.read_bytes() if state_path.is_file() else None

    first = _run(campaign_ws, "state.record_npc_engagement", args)
    after_first = state_path.read_bytes()
    replay = _run(campaign_ws, "state.record_npc_engagement", args)
    after_replay = state_path.read_bytes()
    cross_run = _run(
        campaign_ws,
        "state.record_npc_engagement",
        {**args, "run_id": "different-live-segment"},
    )

    assert first["ok"] is True
    assert replay["data"] == first["data"]
    assert cross_run["ok"] is False
    assert cross_run["error"]["code"] == "idempotency_conflict"
    assert first["data"]["event_type"] == "npc_engagement"
    assert first["data"]["run_id"] == "toolbox-live-segment"
    assert first["data"]["interaction_kind"] == "dialogue"
    assert first["data"]["identity_binding"]["status"] == "authored_bound"
    assert first["data"]["identity_binding"]["authored_identity_attested"] is True
    assert first["data"]["identity_binding"]["coverage_eligible"] is True
    assert after_first != before
    assert after_replay == after_first
    matching = [
        row
        for row in _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "events.jsonl")
        if row.get("event_type") == "npc_engagement"
        and row.get("npc_id") == "npc-kim-debrun"
    ]
    assert len(matching) == 1

@pytest.mark.parametrize("crash_stage", ["after_source", "before_ledger"])
def test_npc_engagement_receipt_recovers_before_a_different_next_decision(
    campaign_ws, monkeypatch, crash_stage
):
    args = {
        "npc_id": "npc-crash-window",
        "interaction_kind": "witness",
        "decision_id": f"npc-crash-{crash_stage}",
        **_first_contact_binding(
            campaign_ws,
            "npc-crash-window",
            key=f"npc-crash-{crash_stage}",
        ),
    }
    real_log_event = coc_toolbox.Ctx.log_event
    real_ledger_record = coc_toolbox.Ctx.ledger_record

    def crash_log_event(self, record):
        if (
            crash_stage == "after_source"
            and record.get("event_type") == "npc_engagement"
        ):
            raise RuntimeError("synthetic NPC crash after source receipt")
        return real_log_event(self, record)

    def crash_ledger_record(self, decision_id, tool_name, data, **kwargs):
        if crash_stage == "before_ledger" and tool_name == (
            "state.record_npc_engagement"
        ):
            raise RuntimeError("synthetic NPC crash before ledger")
        return real_ledger_record(
            self, decision_id, tool_name, data, **kwargs
        )

    with monkeypatch.context() as crash:
        crash.setattr(coc_toolbox.Ctx, "log_event", crash_log_event)
        crash.setattr(coc_toolbox.Ctx, "ledger_record", crash_ledger_record)
        with pytest.raises(RuntimeError, match="synthetic NPC crash"):
            _run(campaign_ws, "state.record_npc_engagement", args)

    # The host deliberately chooses a different valid tool instead of retrying
    # the failed operation.  Global source preflight must finish it first.
    later = _run(
        campaign_ws,
        "state.journal",
        {
            "summary": "continued after NPC recorder interruption",
            "player_text": "我继续调查。",
            "decision_id": f"later-after-{crash_stage}",
        },
    )
    assert later["ok"] is True
    replay = _run(campaign_ws, "state.record_npc_engagement", args)
    assert replay["ok"] is True
    assert replay["idempotent_replay"] is True
    context = _run(campaign_ws, "turn.output_context")
    assert context["ok"] is True
    events = [
        row for row in _read_jsonl(
            campaign_ws["campaign_dir"] / "logs" / "events.jsonl"
        )
        if row.get("event_type") == "npc_engagement"
        and row.get("decision_id") == args["decision_id"]
    ]
    assert len(events) == 1
    receipt_doc = json.loads((
        campaign_ws["campaign_dir"]
        / "save"
        / "npc-engagement-receipts.json"
    ).read_text(encoding="utf-8"))
    assert len([
        row for row in receipt_doc["receipts"].values()
        if row["decision_id"] == args["decision_id"]
    ]) == 1

    # Exact replay is the only post-journal exception.  A changed payload and
    # a new decision remain non-mutating failures, and neither can append a
    # source receipt or event outside the pending turn manifest.
    before_receipts = (campaign_ws["campaign_dir"] / "save" /
                       "npc-engagement-receipts.json").read_bytes()
    before_events = (campaign_ws["campaign_dir"] / "logs" /
                     "events.jsonl").read_bytes()
    changed = _run(
        campaign_ws,
        "state.record_npc_engagement",
        {**args, "interaction_kind": "dialogue"},
    )
    unbound = _run(
        campaign_ws,
        "state.record_npc_engagement",
        {
            "npc_id": args["npc_id"],
            "interaction_kind": "witness",
            "decision_id": f"new-after-{crash_stage}",
        },
    )
    assert changed["ok"] is False
    assert changed["error"]["code"] == "idempotency_conflict"
    assert unbound["ok"] is False
    assert unbound["error"]["code"] == "turn_pending_finalization"
    assert (campaign_ws["campaign_dir"] / "save" /
            "npc-engagement-receipts.json").read_bytes() == before_receipts
    assert (campaign_ws["campaign_dir"] / "logs" /
            "events.jsonl").read_bytes() == before_events

def test_background_flusher_and_toolbox_recovery_share_stable_event_lock(
    campaign_ws, monkeypatch
):
    decision_id = "flag-recovery-vs-background-flush"
    assert _run(
        campaign_ws,
        "state.set_flag",
        {
            "flag_id": "stable-event-lock-domain",
            "value": True,
            "decision_id": decision_id,
        },
    )["ok"] is True
    campaign_dir = campaign_ws["campaign_dir"]
    flags = json.loads(
        (campaign_dir / "save" / "flags.json").read_text(encoding="utf-8")
    )
    receipt = flags["operation_receipts"]["state.set_flag"][decision_id]
    events_path = campaign_dir / "logs" / "events.jsonl"
    remaining = [
        row for row in _read_jsonl(events_path)
        if row.get("event_id") != receipt["event_id"]
    ]
    events_path.write_text(
        "".join(json.dumps(row) + "\n" for row in remaining),
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
    real_ensure = operation_kernel._ensure_operation_event

    def pause_flusher(path, record):
        if record.get("event_id") == receipt["event_id"]:
            flusher_at_append.set()
            assert release_flusher.wait(timeout=5)
        return real_append(path, record)

    def observe_recovery(ctx, current_receipt, **kwargs):
        if current_receipt.get("event_id") == receipt["event_id"]:
            recovery_started.set()
        return real_ensure(ctx, current_receipt, **kwargs)

    monkeypatch.setattr(
        coc_toolbox.coc_async_recorder, "_append_jsonl_sync", pause_flusher
    )
    monkeypatch.setattr(operation_kernel, "_ensure_operation_event", observe_recovery)
    with ThreadPoolExecutor(max_workers=2) as pool:
        flush_future = pool.submit(
            coc_toolbox.coc_async_recorder.flush_pending_records, campaign_dir
        )
        assert flusher_at_append.wait(timeout=5)
        recovery_future = pool.submit(
            _run,
            campaign_ws,
            "state.journal",
            {
                "summary": "continue while a stable event flush is active",
                "player_text": "我继续调查。",
                "decision_id": "later-after-stable-event-lock-race",
            },
        )
        assert recovery_started.wait(timeout=5)
        release_flusher.set()
        assert flush_future.result(timeout=5)["flushed_files"] == 1
        assert recovery_future.result(timeout=5)["ok"] is True

    matches = [
        row for row in _read_jsonl(events_path)
        if row.get("event_id") == receipt["event_id"]
    ]
    assert matches == [receipt["event"]]

def test_common_preflight_repairs_source_receipts_before_context_and_director(
    campaign_ws, monkeypatch,
):
    campaign_dir = campaign_ws["campaign_dir"]
    real_log_event = coc_toolbox.Ctx.log_event

    def crash_flag(self, record):
        if (
            record.get("event_type") == "flag_set"
            and record.get("decision_id") == "flag-before-context"
        ):
            raise RuntimeError("synthetic flag source-before-context crash")
        return real_log_event(self, record)

    with monkeypatch.context() as crash:
        crash.setattr(coc_toolbox.Ctx, "log_event", crash_flag)
        with pytest.raises(RuntimeError, match="source-before-context"):
            _run(
                campaign_ws,
                "state.set_flag",
                {
                    "flag_id": "context-repair-flag",
                    "value": False,
                    "decision_id": "flag-before-context",
                },
            )

    context = _run(campaign_ws, "scene.context", {})
    assert context["ok"] is True
    repaired_flag = next(
        row for row in context["data"]["continuity"]["live_world_flags"]
        if row["flag_id"] == "context-repair-flag"
    )
    assert repaired_flag["value"] is False
    assert repaired_flag["provenance"]["integrity_status"] == "source_anchored"

    def crash_marker(self, record):
        if (
            record.get("event_type") == "time_marker_changed"
            and record.get("decision_id") == "marker-before-director"
        ):
            raise RuntimeError("synthetic marker source-before-director crash")
        return real_log_event(self, record)

    with monkeypatch.context() as crash:
        crash.setattr(coc_toolbox.Ctx, "log_event", crash_marker)
        with pytest.raises(RuntimeError, match="source-before-director"):
            _run(
                campaign_ws,
                "state.time_marker",
                {
                    "action": "set",
                    "marker_id": "director-repair-marker",
                    "minutes_from_now": 5,
                    "decision_id": "marker-before-director",
                },
            )

    coc_director_apply.apply_plan(
        campaign_dir,
        {
            "decision_id": "director-after-marker-source",
            "scene_action": "PRESSURE",
            "clue_policy": {"reveal": []},
            "pressure_moves": [],
            "memory_writes": [],
            "rule_signals": {},
        },
        investigator_id=campaign_ws["investigator_id"],
    )
    marker_events = [
        row for row in _read_jsonl(campaign_dir / "logs" / "events.jsonl")
        if row.get("event_type") == "time_marker_changed"
        and row.get("decision_id") == "marker-before-director"
    ]
    assert len(marker_events) == 1
    marker_ledger = json.loads(
        (campaign_dir / "save" / "toolbox-ledger.json").read_text(
            encoding="utf-8"
        )
    )
    marker_key = coc_toolbox.Ctx._ledger_key(
        "state.time_marker", "marker-before-director"
    )
    assert marker_key in marker_ledger["entries"]

@pytest.mark.parametrize("source_kind", ["flag", "npc"])
def test_director_preflight_repairs_interrupted_toolbox_source(
    campaign_ws, monkeypatch, source_kind
):
    decision_id = f"toolbox-before-director-{source_kind}"
    npc_binding = (
        _first_contact_binding(
            campaign_ws,
            "npc-before-director",
            key="npc-before-director",
        )
        if source_kind == "npc"
        else {}
    )
    real_log_event = coc_toolbox.Ctx.log_event

    def crash_before_event(self, record):
        expected_type = "flag_set" if source_kind == "flag" else "npc_engagement"
        if (
            record.get("event_type") == expected_type
            and record.get("decision_id") == decision_id
        ):
            raise RuntimeError("synthetic toolbox source-before-event crash")
        return real_log_event(self, record)

    with monkeypatch.context() as crash:
        crash.setattr(coc_toolbox.Ctx, "log_event", crash_before_event)
        with pytest.raises(RuntimeError, match="source-before-event"):
            if source_kind == "flag":
                _run(
                    campaign_ws,
                    "state.set_flag",
                    {
                        "flag_id": "toolbox-flag-before-director",
                        "value": True,
                        "decision_id": decision_id,
                    },
                )
            else:
                _run(
                    campaign_ws,
                    "state.record_npc_engagement",
                    {
                        "npc_id": "npc-before-director",
                        "interaction_kind": "witness",
                        "decision_id": decision_id,
                        **npc_binding,
                    },
                )

    coc_director_apply.apply_plan(
        campaign_ws["campaign_dir"],
        {
            "decision_id": f"director-after-{source_kind}",
            "scene_action": "PRESSURE",
            "clue_policy": {"reveal": []},
            "pressure_moves": [],
            "memory_writes": [],
            "rule_signals": {},
        },
        investigator_id=campaign_ws["investigator_id"],
    )
    expected_type = "flag_set" if source_kind == "flag" else "npc_engagement"
    events = [
        row for row in _read_jsonl(
            campaign_ws["campaign_dir"] / "logs" / "events.jsonl"
        )
        if row.get("event_type") == expected_type
        and row.get("decision_id") == decision_id
    ]
    assert len(events) == 1

def test_npc_engagement_identity_binding_degrades_to_warnings_not_a_gate(
    campaign_ws,
):
    moved = _run(
        campaign_ws,
        "state.move_scene",
        {"scene_id": "neighborhood-gossip", "decision_id": "move-dooley-binding"},
    )
    assert moved["ok"] is True
    query = _run(campaign_ws, "npc.query", {"npc_id": "npc-dooley"})
    dooley_ref = query["data"]["npcs"][0]["identity_ref"]

    unverified = _run(
        campaign_ws,
        "state.record_npc_engagement",
        {
            "npc_id": "npc-dooley",
            "interaction_kind": "dialogue",
            "decision_id": "dooley-unverified",
            **_first_contact_binding(
                campaign_ws,
                "npc-dooley",
                key="dooley-first-contact",
            ),
        },
    )
    mismatched = _run(
        campaign_ws,
        "state.record_npc_engagement",
        {
            "npc_id": "npc-dooley",
            "interaction_kind": "dialogue",
            "identity_ref": "npc-identity-v1:not-dooley",
            "decision_id": "dooley-mismatched",
        },
    )
    improvised = _run(
        campaign_ws,
        "state.record_npc_engagement",
        {
            "npc_id": "npc-neighbor-white-hair",
            "interaction_kind": "dialogue",
            "identity_ref": dooley_ref,
            "decision_id": "neighbor-improvised",
            **_first_contact_binding(
                campaign_ws,
                "npc-neighbor-white-hair",
                key="neighbor-first-contact",
            ),
        },
    )
    bound = _run(
        campaign_ws,
        "state.record_npc_engagement",
        {
            "npc_id": "npc-dooley",
            "interaction_kind": "dialogue",
            "identity_ref": dooley_ref,
            "decision_id": "dooley-bound",
        },
    )

    assert all(row["ok"] is True for row in [unverified, mismatched, improvised, bound])
    assert unverified["data"]["identity_binding"]["status"] == "unverified"
    assert mismatched["data"]["identity_binding"]["status"] == "mismatch"
    assert improvised["data"]["identity_binding"]["status"] == "improvised"
    assert bound["data"]["identity_binding"]["status"] == "authored_bound"
    assert not unverified["data"]["identity_binding"]["coverage_eligible"]
    assert not mismatched["data"]["identity_binding"]["coverage_eligible"]
    assert not improvised["data"]["identity_binding"]["coverage_eligible"]
    assert bound["data"]["identity_binding"]["coverage_eligible"] is True
    assert any("coverage" in warning for warning in unverified["warnings"])
    assert any("does not match" in warning for warning in mismatched["warnings"])
    assert any("improvised NPC" in warning for warning in improvised["warnings"])

    context = _run(campaign_ws, "scene.context")
    dooley = next(
        npc for npc in context["data"]["npcs_present"] if npc["npc_id"] == "npc-dooley"
    )
    assert dooley["identity_ref"] == dooley_ref
    assert dooley["agenda"]
    assert "identity_contract" not in dooley

def test_scene_context_projects_and_sanity_check_consumes_authored_trigger(campaign_ws):
    moved = _run(
        campaign_ws,
        "state.move_scene",
        {"scene_id": "upper-floor-bedroom", "decision_id": "move-to-bedroom"},
    )
    assert moved["ok"] is True
    context = _run(campaign_ws, "scene.context")
    assert context["ok"] is True
    triggers = context["data"]["pending_san_triggers"]
    assert [trigger["trigger_id"] for trigger in triggers] == ["bed-moves"]
    trigger = triggers[0]

    settled = _run(
        campaign_ws,
        "rules.sanity_check",
        {
            "investigator": campaign_ws["investigator_id"],
            "source": trigger["source"],
            "loss_success": str(trigger["san_loss_success"]),
            "loss_failure": trigger["san_loss_fail_expr"],
            "trigger_id": trigger["trigger_id"],
            "decision_id": "bed-san-once",
            "seed": 3,
        },
    )
    assert settled["ok"] is True
    assert settled["data"]["trigger_id"] == "bed-moves"
    after = _run(campaign_ws, "scene.context")
    assert after["data"]["pending_san_triggers"] == []

def test_weekly_recovery_uses_authoritative_time_and_is_dice_complete(campaign_ws):
    investigator_id = campaign_ws["investigator_id"]
    campaign_dir = campaign_ws["campaign_dir"]
    state_path = (
        campaign_dir / "save" / "investigator-state" / f"{investigator_id}.json"
    )
    time_state = json.loads(
        (campaign_dir / "save" / "time-state.json").read_text(encoding="utf-8")
    )
    elapsed = int(time_state["clock"]["elapsed_minutes"])
    state = json.loads(state_path.read_text(encoding="utf-8"))
    state.update({
        "current_hp": 2,
        "conditions": ["major_wound"],
        "wound_ledger": [{
            "wound_id": "wound-weekly-test",
            "source_damage_roll_id": "damage-weekly-test",
            "occurred_elapsed_minutes": elapsed,
            "status": "active",
        }],
    })
    _write_json(state_path, state)

    recovery_args = {
        "investigator": investigator_id,
        "complete_rest": True,
        "poor_environment": False,
        "medicine_skill_value": 99,
        "caregiver_id": "npc-hospital-doctor",
        "decision_id": "major-wound-week-1",
        "seed": 1,
    }
    early = _run(campaign_ws, "rules.weekly_recovery", recovery_args)
    assert early["ok"] is False
    assert early["error"]["code"] == "weekly_recovery_not_due"

    advanced = _run(
        campaign_ws,
        "state.advance_time",
        {
            "minutes": 7 * 24 * 60,
            "reason": "one complete week of hospital rest",
            "decision_id": "advance-major-wound-week-1",
        },
    )
    assert advanced["ok"] is True
    before_rolls = len(_read_jsonl(campaign_dir / "logs" / "rolls.jsonl"))
    settled = _run(campaign_ws, "rules.weekly_recovery", recovery_args)
    replay = _run(
        campaign_ws,
        "rules.weekly_recovery",
        {**recovery_args, "seed": 999},
    )
    assert settled["ok"] is True, settled
    assert replay["ok"] is True
    assert replay["data"] == settled["data"]
    event = settled["data"]["event"]
    assert event["event_type"] == "major_wound_recovery"
    assert event["elapsed_minutes_since_prior_attempt"] == 7 * 24 * 60
    assert event["roll"] is not None
    assert event["target"] > 0
    assert len(settled["data"]["major_wound_recovery_ledger"]) == 1

    new_rolls = _read_jsonl(campaign_dir / "logs" / "rolls.jsonl")[before_rolls:]
    expected_roll_count = 2 + int(event.get("healing_dice") is not None)
    assert len(new_rolls) == expected_roll_count
    assert len({row["roll_id"] for row in new_rolls}) == expected_roll_count
    assert new_rolls[0]["payload"]["event_type"] == "major_wound_recovery_roll"
    assert new_rolls[0]["actor"] == investigator_id
    assert new_rolls[1]["payload"]["event_type"] == "weekly_medical_care_roll"
    assert new_rolls[1]["actor"] == "npc-hospital-doctor"
    if event.get("healing_dice") is not None:
        assert new_rolls[2]["payload"]["dice"] == event["healing_dice"]

    too_soon = _run(
        campaign_ws,
        "rules.weekly_recovery",
        {**recovery_args, "decision_id": "major-wound-week-2", "seed": 2},
    )
    assert too_soon["ok"] is False
    if "major_wound" in settled["data"]["conditions"]:
        assert too_soon["error"]["code"] == "weekly_recovery_not_due"
    else:
        assert too_soon["error"]["code"] == "major_wound_not_active"
    assert len(_read_jsonl(campaign_dir / "logs" / "rolls.jsonl")) == (
        before_rolls + expected_roll_count
    )

def test_combat_tool_persists_reloadable_session_and_public_rolls(campaign_ws):
    moved = _run(
        campaign_ws,
        "state.move_scene",
        {"scene_id": "corbitt-confrontation", "decision_id": "move-to-combat"},
    )
    assert moved["ok"] is True
    args = {
        "affordance_id": "conventional-assault",
        "investigator": campaign_ws["investigator_id"],
        "weapon_id": "unarmed",
        "luck_spend_max": 50,
        "decision_id": "combat-beat-1",
        "seed": 7,
    }
    before_rolls = len(_read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl"))
    first = _run(campaign_ws, "combat.resolve", args)
    assert first["ok"] is True, first
    investigator_turn = next(
        event["turn"]
        for event in first["data"]["events"]
        if event.get("event_type") == "combat_turn_resolved"
        and (event.get("turn") or {}).get("actor_id")
        == campaign_ws["investigator_id"]
    )
    assert investigator_turn["resolution_hint"] == "opposed_melee"
    assert any(
        row.get("skill") == "Fighting (Brawl)"
        for event in first["data"]["events"]
        if event.get("event_type") == "combat_turn_resolved"
        for row in event.get("roll_evidence", [])
        if row.get("actor_id") == campaign_ws["investigator_id"]
    )
    assert all(
        row["change"] == 0 and row["after"] == row["before"]
        for row in first["data"]["player_state_receipt"]["loaded_ammunition"]
    )
    repeated = _run(campaign_ws, "combat.resolve", {**args, "seed": 999})
    assert repeated["ok"] is True
    assert repeated["data"] == first["data"]

    combat_path = campaign_ws["campaign_dir"] / "save" / "combat.json"
    saved = json.loads(combat_path.read_text(encoding="utf-8"))
    assert saved["schema_version"] == 2
    reloaded = coc_toolbox.coc_subsystem_executor.coc_combat.CombatSession.load(
        campaign_ws["campaign_dir"],
        rng=random.Random(99),
        damage_evidence=coc_toolbox.coc_subsystem_executor.load_combat_damage_evidence(
            campaign_ws["campaign_dir"]
        ),
        damage_evidence_actor=campaign_ws["investigator_id"],
    )
    assert reloaded.combat_id == saved["combat_id"]
    rolls = _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl")
    assert len(rolls) > before_rolls
    combat_rolls = rolls[before_rolls:]
    assert all(row.get("event_type") == "roll" for row in combat_rolls)
    assert all(row.get("actor") for row in combat_rolls)
    assert all(row.get("roll_id") for row in combat_rolls)
    assert all(row.get("visibility") in {"public", "consequence_public"}
               for row in combat_rolls)
    assert all(row.get("source") == "subsystem_executor" for row in combat_rolls)
    assert all(row.get("source_ref") == f"logs/rolls.jsonl#{row['roll_id']}"
               for row in combat_rolls)
    assert all(row.get("payload", {}).get("roll_id") == row["roll_id"]
               for row in combat_rolls)
    assert all(
        row["actor"] == row["payload"].get("actor_id", campaign_ws["investigator_id"])
        for row in combat_rolls
    )
    assert any(row["actor"] == "walter-corbitt" for row in combat_rolls)

    outcome = reloaded.outcome if reloaded.status == "concluded" else "fled"
    ended = _run(
        campaign_ws,
        "combat.end",
        {
            "investigator": campaign_ws["investigator_id"],
            "outcome": outcome,
            "decision_id": "combat-end-1",
        },
    )
    assert ended["ok"] is True, ended
    assert any(
        event.get("event_type") == "combat_ended"
        for event in _read_jsonl(
            campaign_ws["campaign_dir"] / "logs" / "events.jsonl"
        )
    )

    prior_combat_id = reloaded.combat_id
    prior_roll_ids = {row["roll_id"] for row in rolls}
    rematch = _run(
        campaign_ws,
        "combat.resolve",
        {
            "affordance_id": "conventional-assault",
            "investigator": campaign_ws["investigator_id"],
            "weapon_id": "unarmed",
            "decision_id": "combat-rematch-1",
            "seed": 17,
        },
    )
    assert rematch["ok"] is True, rematch
    assert rematch["data"]["combat"]["combat_id"] != prior_combat_id
    assert "-restart-t" in rematch["data"]["combat"]["combat_id"]
    assert any("fresh combat/command/roll identity" in row
               for row in rematch["warnings"])
    all_rolls = _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl")
    all_roll_ids = [row["roll_id"] for row in all_rolls]
    assert len(all_roll_ids) == len(set(all_roll_ids))
    assert any(row["roll_id"] not in prior_roll_ids for row in all_rolls)

def test_attack_present_improvised_npc_uses_frozen_mechanics(campaign_ws):
    context = _run(campaign_ws, "scene.context")
    scene_id = context["data"]["active_scene_id"]
    npc_id = "npc-improvised-enforcer"
    placed = _run(campaign_ws, "state.npc_presence", {
        "npc_id": npc_id,
        "scene_id": scene_id,
        "status": "present",
        "reason": "the enforcer stepped into the room",
        "decision_id": "place-improvised-enforcer",
    })
    assert placed["ok"] is True, placed
    generated = _run(campaign_ws, "mechanics.ensure", {
        "subject_kind": "npc",
        "subject_id": npc_id,
        "purpose": "combat",
        "fallback_archetype_id": "dangerous_actor",
        "label": "打手",
        "decision_id": "generate-improvised-enforcer",
    })
    assert generated["ok"] is True, generated
    assert generated["data"]["authority"] == "campaign_generated"
    revision_ref = generated["data"]["mechanics_revision_ref"]
    assert revision_ref["stable_id"] == f"npc:{npc_id}:mechanics"
    assert revision_ref["revision"] == 1

    npc_state_path = campaign_ws["campaign_dir"] / "save" / "npc-state.json"
    legacy = json.loads(npc_state_path.read_text(encoding="utf-8"))
    legacy["npcs"][npc_id]["mechanics"].pop("mechanics_revision_ref")
    npc_state_path.write_text(json.dumps(legacy), encoding="utf-8")
    reused = _run(campaign_ws, "mechanics.ensure", {
        "subject_kind": "npc", "subject_id": npc_id, "purpose": "combat",
        "decision_id": "reuse-legacy-improvised-enforcer",
    })
    assert reused["ok"] is True, reused
    assert reused["data"]["mechanics_revision_ref"] == revision_ref
    agendas_path = campaign_ws["campaign_dir"] / "scenario" / "npc-agendas.json"
    agendas = json.loads(agendas_path.read_text(encoding="utf-8"))
    agendas.setdefault("npcs", []).append({
        "npc_id": npc_id,
        "name": "Source Enforcer",
        "mechanics": {
            "status": "authored",
            "profile": generated["data"]["profile"],
            "source_refs": [{"source_id": "pdf:later", "pdf_index": 7}],
        },
    })
    agendas_path.write_text(json.dumps(agendas), encoding="utf-8")
    conflict = _run(campaign_ws, "mechanics.ensure", {
        "subject_kind": "npc", "subject_id": npc_id, "purpose": "combat",
        "decision_id": "observe-later-authored-enforcer",
    })
    assert conflict["ok"] is True, conflict
    assert conflict["data"]["authority"] == "campaign_generated"
    assert conflict["data"]["mechanics_revision_ref"] == revision_ref
    assert conflict["data"]["source_conflict"]["kind"] == "continuity_contradiction"

    result = _run(campaign_ws, "combat.resolve", {
        "target_npc_id": npc_id,
        "investigator": campaign_ws["investigator_id"],
        "weapon_id": "unarmed",
        "decision_id": "attack-improvised-enforcer",
        "seed": 73,
    })

    assert result["ok"] is True, result
    actors = {
        row["actor_id"] for row in result["data"]["combat"]["participants"]
    }
    assert npc_id in actors
    pinned = next(
        row for row in result["data"]["combat"]["participants"]
        if row["actor_id"] == npc_id
    )
    assert pinned["mechanics_revision_ref"] == revision_ref

def test_combat_resolve_uses_compiled_module_npc_mechanics(campaign_ws):
    moved = _run(campaign_ws, "state.move_scene", {
        "scene_id": "corbitt-confrontation",
        "decision_id": "move-compiled-npc-combat",
    })
    assert moved["ok"] is True, moved

    result = _run(campaign_ws, "combat.resolve", {
        "target_npc_id": "npc-walter-corbitt",
        "investigator": campaign_ws["investigator_id"],
        "weapon_id": "unarmed",
        "decision_id": "attack-compiled-corbitt",
        "seed": 41,
    })

    assert result["ok"] is True, result
    pinned = next(
        row for row in result["data"]["combat"]["participants"]
        if row["actor_id"] == "npc-walter-corbitt"
    )
    # p.459 of the bound source prints "Fighting 50% (Hard 25%/Extreme10%)";
    # the 90 this used to pin was the affordance spec lifting STR/POW instead
    # of the printed skill line.
    assert pinned["combat_skill"] == 50
    assert pinned["dodge_skill"] == 17
    assert pinned["mechanics_revision_ref"]["authority"] == "source_authored"
    assert pinned["mechanics_revision_ref"]["stable_id"] == (
        "npc:npc-walter-corbitt:mechanics"
    )

def test_authored_weapon_effect_reaches_deterministic_combat_damage(campaign_ws):
    granted = _run(campaign_ws, "state.item_grant", {
        "investigator": campaign_ws["investigator_id"],
        "kind": "weapon",
        "label": "受祝仪式刀",
        "weapon": {
            "weapon_id": "module:blessed-knife",
            "extends": "knife_medium",
            "effects": [{
                "effect_id": "double-vs-corbitt",
                "resolution": "combat_damage_multiplier",
                "applicability": {"target_ids": ["walter-corbitt"]},
                "multiplier": 2,
            }],
        },
        "decision_id": "grant-blessed-knife",
    })
    assert granted["ok"] is True, granted
    moved = _run(campaign_ws, "state.move_scene", {
        "scene_id": "corbitt-confrontation",
        "decision_id": "move-special-weapon-combat",
    })
    assert moved["ok"] is True, moved

    resolved = _run(campaign_ws, "combat.resolve", {
        "affordance_id": "conventional-assault",
        "investigator": campaign_ws["investigator_id"],
        "weapon_id": "module:blessed-knife",
        "weapon_effect_ids": ["double-vs-corbitt"],
        "decision_id": "special-weapon-combat",
        "seed": 0,
    })

    assert resolved["ok"] is True, resolved
    affected = [
        row for row in resolved["data"]["combat"]["damage_chain"]
        if "double-vs-corbitt" in row.get("weapon_effect_ids", [])
    ]
    assert affected
    assert affected[0]["damage_multiplier"] == 2
    assert affected[0]["raw_damage"] >= affected[0]["rolled_total"] * 2
    reloaded = coc_toolbox.coc_subsystem_executor.coc_combat.CombatSession.load(
        campaign_ws["campaign_dir"], rng=random.Random(99),
        damage_evidence=coc_toolbox.coc_subsystem_executor.load_combat_damage_evidence(
            campaign_ws["campaign_dir"]
        ),
        damage_evidence_actor=campaign_ws["investigator_id"],
    )
    assert reloaded.damage_chain[-1]["weapon_effect_ids"] == [
        "double-vs-corbitt"
    ]

def test_combat_tool_routes_owned_firearm_without_illegal_melee_defense(campaign_ws):
    moved = _run(
        campaign_ws,
        "state.move_scene",
        {"scene_id": "corbitt-confrontation", "decision_id": "move-firearm-combat"},
    )
    assert moved["ok"] is True

    resolved = _run(
        campaign_ws,
        "combat.resolve",
        {
            "affordance_id": "conventional-assault",
            "investigator": campaign_ws["investigator_id"],
            "weapon_id": "revolver_38_or_9mm",
            "decision_id": "combat-firearm-beat",
            "seed": 7,
        },
    )

    assert resolved["ok"] is True, resolved
    attack_events = [
        event
        for event in resolved["data"]["events"]
        if event.get("event_type") == "combat_turn_resolved"
        and (event.get("turn") or {}).get("actor_id")
        == campaign_ws["investigator_id"]
    ]
    assert attack_events
    assert attack_events[0]["turn"]["resolution_hint"] == "firearm_attack"
    assert attack_events[0]["turn"]["defense_kind"] == "none"
    revolver_ammo = next(
        row
        for row in resolved["data"]["player_state_receipt"]["loaded_ammunition"]
        if row["weapon_id"] == "revolver_38_or_9mm"
    )
    assert revolver_ammo["change"] == -1
    assert revolver_ammo["after"] == revolver_ammo["before"] - 1

def test_combat_resolve_maps_inventory_rifle_item_id_to_sheet_skill(campaign_ws):
    investigator_id = campaign_ws["investigator_id"]
    character_path = (
        campaign_ws["coc_root"] / "investigators" / investigator_id / "character.json"
    )
    sheet = json.loads(character_path.read_text(encoding="utf-8"))
    sheet.setdefault("skills", {})["Firearms (Rifle/Shotgun)"] = 25
    sheet["skills"]["Firearms (Handgun)"] = 5
    _write_json(character_path, sheet)
    granted = _run(campaign_ws, "state.item_grant", {
        "investigator": investigator_id,
        "kind": "weapon",
        "label": "卡卡诺步枪",
        "item_id": "weapon-carcano-rifle",
        "weapon_id": "30_06_bolt_action_rifle",
        "decision_id": "grant-carcano-rifle",
    })
    assert granted["ok"] is True, granted
    moved = _run(
        campaign_ws,
        "state.move_scene",
        {"scene_id": "corbitt-confrontation", "decision_id": "move-rifle-combat"},
    )
    assert moved["ok"] is True, moved
    unknown = _run(
        campaign_ws,
        "combat.resolve",
        {
            "target_npc_id": "well-shadow",
            "investigator": investigator_id,
            "weapon_id": "weapon-carcano-rifle",
            "decision_id": "shot-unknown-shadow",
            "seed": 3,
        },
    )
    assert unknown["ok"] is False
    assert unknown["error"]["code"] == "unknown_combat_target"
    resolved = _run(
        campaign_ws,
        "combat.resolve",
        {
            "affordance_id": "conventional-assault",
            "investigator": investigator_id,
            "weapon_id": "weapon-carcano-rifle",
            "decision_id": "shot-carcano-corbitt",
            "seed": 3,
        },
    )
    assert resolved["ok"] is True, resolved
    attack_events = [
        event
        for event in resolved["data"]["events"]
        if event.get("event_type") == "combat_turn_resolved"
        and (event.get("turn") or {}).get("actor_id") == investigator_id
    ]
    assert attack_events
    turn = attack_events[0]["turn"]
    assert turn["resolution_hint"] == "firearm_attack"
    participant = next(
        row for row in resolved["data"]["combat"]["participants"]
        if row["actor_id"] == investigator_id
    )
    assert participant["firearms_skill"] == 25
    owned_ids = {
        str(row.get("weapon_id"))
        for row in participant.get("weapons") or []
        if isinstance(row, dict)
    }
    assert "30_06_bolt_action_rifle" in owned_ids
    ammo = resolved["data"]["player_state_receipt"]["loaded_ammunition"]
    assert ammo
    rifle_ammo = [
        row for row in ammo
        if row.get("weapon_id") == "30_06_bolt_action_rifle"
    ]
    assert rifle_ammo
    assert rifle_ammo[0]["change"] == -1
    assert rifle_ammo[0]["after"] == rifle_ammo[0]["before"] - 1
    assert turn.get("roll_id")

def test_combat_resolve_uses_one_guarded_character_snapshot_for_all_consumers(
    campaign_ws, monkeypatch
):
    investigator_id = campaign_ws["investigator_id"]
    moved = _run(
        campaign_ws,
        "state.move_scene",
        {"scene_id": "corbitt-confrontation", "decision_id": "move-snapshot-combat"},
    )
    assert moved["ok"] is True

    character_path = (
        campaign_ws["coc_root"]
        / "investigators"
        / investigator_id
        / "character.json"
    )
    version_one = json.loads(character_path.read_text(encoding="utf-8"))
    version_one["snapshot_version"] = "v1"
    version_one["characteristics"]["DEX"] = 88
    version_one["skills"]["Fighting (Brawl)"] = 99
    _write_json(character_path, version_one)
    version_two = json.loads(json.dumps(version_one))
    version_two["snapshot_version"] = "v2"
    version_two["characteristics"]["DEX"] = 22
    version_two["skills"]["Fighting (Brawl)"] = 1

    real_sheet = coc_toolbox.Ctx.sheet
    sheet_reads: list[str] = []

    def swap_after_first_guarded_read(self, requested_id):
        sheet = real_sheet(self, requested_id)
        sheet_reads.append(str(sheet.get("snapshot_version")))
        if len(sheet_reads) == 1:
            _write_json(character_path, version_two)
        return sheet

    monkeypatch.setattr(coc_toolbox.Ctx, "sheet", swap_after_first_guarded_read)
    captured: dict[str, object] = {}

    combat_module = coc_toolbox.OPERATION_MODULES["combat"]
    real_profile = combat_module._investigator_combat_profile

    def capture_profile(ctx, requested_id, *args, **kwargs):
        captured["profile_snapshot"] = kwargs.get("character_snapshot")
        if captured["profile_snapshot"] is None and args:
            captured["profile_snapshot"] = args[0]
        return real_profile(ctx, requested_id, *args, **kwargs)

    monkeypatch.setattr(
        combat_module, "_investigator_combat_profile", capture_profile
    )
    real_route = (
        coc_toolbox.coc_narrative_enrichment.build_route_operation_requests
    )

    def capture_route(payload):
        captured["profile"] = payload["investigator_combat_profile"]
        captured["route_character"] = payload["character"]
        return real_route(payload)

    monkeypatch.setattr(
        coc_toolbox.coc_narrative_enrichment,
        "build_route_operation_requests",
        capture_route,
    )
    real_execute = coc_toolbox.coc_subsystem_executor.execute_commands

    def capture_execute(*args, **kwargs):
        captured["executor_snapshot"] = kwargs.get("character_snapshot")
        return real_execute(*args, **kwargs)

    monkeypatch.setattr(
        coc_toolbox.coc_subsystem_executor, "execute_commands", capture_execute
    )
    real_ticks = combat_module._record_combat_improvement_ticks

    def capture_ticks(ctx, **kwargs):
        captured["tick_snapshot"] = kwargs.get("character_snapshot")
        return real_ticks(ctx, **kwargs)

    monkeypatch.setattr(
        combat_module, "_record_combat_improvement_ticks", capture_ticks
    )

    resolved = _run(
        campaign_ws,
        "combat.resolve",
        {
            "affordance_id": "conventional-assault",
            "investigator": investigator_id,
            "weapon_id": "unarmed",
            "decision_id": "combat-one-character-snapshot",
            "seed": 7,
        },
    )

    assert resolved["ok"] is True, resolved
    assert sheet_reads == ["v1"]
    snapshot = captured["route_character"]
    assert captured["profile_snapshot"] is snapshot
    assert captured["executor_snapshot"] is snapshot
    assert captured["tick_snapshot"] is snapshot
    assert snapshot["snapshot_version"] == "v1"
    assert captured["profile"]["dex"] == 88
    assert captured["profile"]["combat_skill"] == 99
    assert resolved["data"]["improvement_ticks_recorded"] == [
        "Fighting (Brawl)"
    ]
    assert json.loads(character_path.read_text(encoding="utf-8"))[
        "snapshot_version"
    ] == "v2"

def test_floating_knife_roll_keeps_authored_pow_semantics(campaign_ws):
    moved = _run(
        campaign_ws,
        "state.move_scene",
        {"scene_id": "corbitt-confrontation", "decision_id": "move-pow-combat"},
    )
    assert moved["ok"] is True
    common = {
        "affordance_id": "conventional-assault",
        "investigator": campaign_ws["investigator_id"],
        "weapon_id": "unarmed",
    }

    opened = _run(
        campaign_ws,
        "combat.resolve",
        {**common, "decision_id": "pow-combat-open", "seed": 7},
    )
    assert opened["ok"] is True, opened
    assert opened["data"]["combat"]["status"] == "active"

    declared = _run(
        campaign_ws,
        "combat.resolve",
        {**common, "decision_id": "pow-knife-declare", "seed": 8},
    )
    assert declared["ok"] is True, declared
    pending = declared["data"]["pending_defense"]
    assert pending["actor_id"] == "walter-corbitt"
    assert pending["weapon_id"] == "floating-knife"
    assert pending["allowed_defenses"] == ["dodge", "fight_back"]

    resolved = _run(
        campaign_ws,
        "combat.resolve",
        {
            "investigator": campaign_ws["investigator_id"],
            "defense_kind": "dodge",
            "decision_id": "pow-knife-defend",
            "seed": 33,
        },
    )
    assert resolved["ok"] is True, resolved
    assert resolved["data"]["pending_defense"] is None
    turn_event = next(
        row
        for row in resolved["data"]["events"]
        if row.get("event_type") == "combat_turn_resolved"
    )
    turn = turn_event["turn"]
    assert turn["defense_kind"] == "dodge"
    assert turn["opposed_outcome"] == "tie_defender_wins"
    assert turn["outcome"] == "miss"
    assert turn["damage_roll_id"] is None
    assert resolved["data"]["player_state_receipt"]["hp"] == {
        "before": 12,
        "after": 12,
    }
    percentile_rolls = turn_event["roll_evidence"]
    assert [row["achieved_level"] for row in percentile_rolls] == [
        "regular", "regular",
    ]
    assert [row["roll"] for row in percentile_rolls] == [74, 22]
    knife_rolls = [
        row
        for row in _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl")
        if row.get("actor") == "walter-corbitt"
        and row.get("payload", {}).get("skill") == "POW"
    ]
    assert len(knife_rolls) == 1
    assert knife_rolls[0]["payload"]["target"] == 90

def test_cli_list_prints_parseable_json():
    proc = subprocess.run(
        [PYTHON, str(TOOLBOX_SCRIPT), "list"],
        cwd=REPO,
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0
    payload = json.loads(proc.stdout)
    names = {entry["name"] for entry in payload["tools"]}
    assert "rules.roll_dice" in names
    assert "state.record_clue" in names
    assert "director.advise" in names

@pytest.mark.parametrize("source_kind", ["flags", "markers"])
def test_noncurrent_flag_and_marker_documents_are_rejected_without_rewrite(
    campaign_ws, source_kind,
):
    campaign_dir = campaign_ws["campaign_dir"]
    if source_kind == "flags":
        path = campaign_dir / "save" / "flags.json"
        document = json.loads(path.read_text(encoding="utf-8"))
        document["schema_version"] = 2
        tool_name = "scene.context"
        args = {}
    else:
        path = campaign_dir / "save" / "time-markers.json"
        document = {
            "schema_version": 2,
            "markers": {},
            "marker_heads": {},
            "marker_source_sequence": 0,
            "operation_receipts": {},
        }
        tool_name = "state.time_marker"
        args = {
            "action": "set",
            "marker_id": "old-document",
            "minutes_from_now": 5,
            "decision_id": "reject-old-marker-document",
        }
    _write_json(path, document)
    before = path.read_bytes()

    rejected = _run(campaign_ws, tool_name, args)

    assert rejected["ok"] is False
    assert rejected["error"]["code"] == "state_corrupt"
    assert path.read_bytes() == before

@pytest.mark.parametrize("entity_kind", ["flag", "marker"])
def test_current_document_rejects_live_entity_without_current_receipt(
    campaign_ws, entity_kind,
):
    campaign_dir = campaign_ws["campaign_dir"]
    if entity_kind == "flag":
        tool_name = "state.set_flag"
        entity_id = "orphan-current-flag"
        args = {
            "flag_id": entity_id,
            "value": True,
            "decision_id": "orphan-current-flag-decision",
        }
        path = campaign_dir / "save" / "flags.json"
        document_key = "flags"
        head_key = "flag_heads"
    else:
        tool_name = "state.time_marker"
        entity_id = "orphan-current-marker"
        args = {
            "action": "set",
            "marker_id": entity_id,
            "minutes_from_now": 5,
            "decision_id": "orphan-current-marker-decision",
        }
        path = campaign_dir / "save" / "time-markers.json"
        document_key = "markers"
        head_key = "marker_heads"
    assert _run(campaign_ws, tool_name, args)["ok"] is True
    document = json.loads(path.read_text(encoding="utf-8"))
    document["operation_receipts"] = {}
    _write_json(path, document)
    before = path.read_bytes()

    unrelated = (
        _run(campaign_ws, "scene.context", {})
        if entity_kind == "flag"
        else _run(
            campaign_ws,
            "state.time_marker",
            {
                "action": "set",
                "marker_id": "unrelated-marker",
                "minutes_from_now": 1,
                "decision_id": "unrelated-marker-decision",
            },
        )
    )

    assert document[document_key][entity_id]
    assert document[head_key][entity_id]
    assert unrelated["ok"] is False
    assert unrelated["error"]["code"] == "state_corrupt"
    assert path.read_bytes() == before

def test_unanchored_flag_head_is_not_authoritative_provenance(campaign_ws):
    campaign_dir = campaign_ws["campaign_dir"]
    args = {
        "flag_id": "unanchored-head-flag",
        "value": True,
        "decision_id": "anchored-flag-decision",
    }
    assert _run(campaign_ws, "state.set_flag", args)["ok"] is True
    flags_path = campaign_dir / "save" / "flags.json"
    flags = json.loads(flags_path.read_text(encoding="utf-8"))
    anchored_sequence = flags["flag_heads"][args["flag_id"]]["source_sequence"]
    provenance = dict(flags["flag_provenance"][args["flag_id"]])
    provenance.update({
        "source": "forged",
        "producer": "forged",
        "decision_id": "forged-decision",
        "source_sequence": anchored_sequence,
    })
    flags["flag_provenance"][args["flag_id"]] = provenance
    live_record = coc_toolbox.coc_flag_state.flag_live_record(
        flags, args["flag_id"]
    )
    flags["flag_heads"][args["flag_id"]] = (
        coc_toolbox.coc_flag_state.entity_head(
            entity_kind="flag",
            entity_id=args["flag_id"],
            decision_id="forged-decision",
            source_sequence=anchored_sequence,
            producer="forged",
            live_record=live_record,
        )
    )
    _write_json(flags_path, flags)

    context = _run(campaign_ws, "scene.context")
    assert context["ok"] is False
    assert context["error"]["code"] == "state_corrupt"
    unrelated = _run(
        campaign_ws,
        "state.set_flag",
        {
            "flag_id": "unrelated-after-forged-head",
            "value": True,
            "decision_id": "unrelated-after-forged-head-decision",
        },
    )
    assert unrelated["ok"] is False
    assert unrelated["error"]["code"] == "state_corrupt"
    replay = _run(campaign_ws, "state.set_flag", args)
    assert replay["ok"] is False
    assert replay["error"]["code"] == "state_corrupt"

def test_unanchored_time_marker_head_is_rejected(campaign_ws):
    campaign_dir = campaign_ws["campaign_dir"]
    args = {
        "action": "set",
        "marker_id": "unanchored-head-marker",
        "minutes_from_now": 5,
        "decision_id": "anchored-marker-decision",
    }
    assert _run(campaign_ws, "state.time_marker", args)["ok"] is True
    marker_path = campaign_dir / "save" / "time-markers.json"
    payload = json.loads(marker_path.read_text(encoding="utf-8"))
    anchored_sequence = payload["marker_heads"][args["marker_id"]][
        "source_sequence"
    ]
    marker = dict(payload["markers"][args["marker_id"]])
    marker.update({
        "decision_id": "forged-marker",
        "source_sequence": anchored_sequence,
        "producer": "forged",
    })
    payload["markers"][args["marker_id"]] = marker
    live_record = coc_toolbox._marker_live_record(payload, args["marker_id"])
    payload["marker_heads"][args["marker_id"]] = (
        coc_toolbox.coc_flag_state.entity_head(
            entity_kind="time_marker",
            entity_id=args["marker_id"],
            decision_id="forged-marker",
            source_sequence=anchored_sequence,
            producer="forged",
            live_record=live_record,
        )
    )
    _write_json(marker_path, payload)

    context = _run(campaign_ws, "scene.context")
    assert context["ok"] is False
    assert context["error"]["code"] == "state_corrupt"
    unrelated = _run(
        campaign_ws,
        "state.time_marker",
        {
            "action": "set",
            "marker_id": "unrelated-after-forged-marker",
            "minutes_from_now": 3,
            "decision_id": "unrelated-after-forged-marker-decision",
        },
    )
    assert unrelated["ok"] is False
    assert unrelated["error"]["code"] == "state_corrupt"
    replay = _run(campaign_ws, "state.time_marker", args)
    assert replay["ok"] is False
    assert replay["error"]["code"] == "state_corrupt"

def test_new_structured_flag_remains_recent_after_many_legacy_rows(campaign_ws):
    campaign_dir = campaign_ws["campaign_dir"]
    events_path = campaign_dir / "logs" / "events.jsonl"
    with events_path.open("a", encoding="utf-8") as handle:
        for index in range(20):
            handle.write(json.dumps({
                "event_type": "flag_set",
                "flag_id": f"legacy-{index}",
                "decision_id": f"legacy-decision-{index}",
                "ts": f"1920-01-01T00:{index:02d}:00Z",
            }) + "\n")
    assert _run(
        campaign_ws,
        "state.set_flag",
        {
            "flag_id": "new-sequenced-transition",
            "value": True,
            "decision_id": "new-sequenced-decision",
        },
    )["ok"] is True

    recent = _run(campaign_ws, "scene.context")["data"]["continuity"][
        "recent_world_flag_changes"
    ]
    assert recent[-1]["flag_id"] == "new-sequenced-transition"
    assert recent[-1]["provenance"]["order_epoch"] == "sequenced-v1"
    assert recent[-1]["provenance"]["integrity_status"] == "source_anchored"

def test_table_opening_boundary_recovers_earliest_logged_row_after_interruption(
    campaign_ws, monkeypatch
):
    original_complete = (
        coc_toolbox.coc_turn_manifest.complete_table_opening_boundary
    )
    interrupted = False

    def interrupt_once(*args, **kwargs):
        nonlocal interrupted
        if not interrupted:
            interrupted = True
            raise coc_toolbox.coc_turn_manifest.TurnManifestError(
                "simulated_interruption", "simulated post-log interruption"
            )
        return original_complete(*args, **kwargs)

    monkeypatch.setattr(
        coc_toolbox.coc_turn_manifest,
        "complete_table_opening_boundary",
        interrupt_once,
    )
    opening_args = {
        "text": "[in_game]\n恢复测试开场。\n[/in_game]",
        "run_id": "opening-recovery-run",
        "presented_roll_ids": [],
        "decision_id": "opening-recovery-evidence",
    }
    opening = _run(campaign_ws, "evidence.table_opening", opening_args)
    assert opening["ok"] is True, opening
    assert any("pre-turn source boundary" in warning for warning in opening["warnings"])
    cursor_path = (
        campaign_ws["campaign_dir"] / "save" / "turn-source-cursor.json"
    )
    assert not cursor_path.exists()

    monkeypatch.setattr(
        coc_toolbox.coc_turn_manifest,
        "complete_table_opening_boundary",
        original_complete,
    )
    later_roll = _run(
        campaign_ws,
        "rules.roll_dice",
        {
            "expression": "1D6",
            "seed": 23,
            "decision_id": "post-interruption-player-roll",
        },
    )
    assert later_roll["ok"] is True, later_roll
    calls = _read_jsonl(
        campaign_ws["campaign_dir"] / "logs" / "toolbox-calls.jsonl"
    )
    earliest_opening_index = next(
        index
        for index, row in enumerate(calls)
        if row.get("tool") == "evidence.table_opening" and row.get("ok") is True
    )
    cursor = json.loads(cursor_path.read_text(encoding="utf-8"))
    assert cursor["next_source_index"] == earliest_opening_index + 1

    cursor_before_replay = cursor_path.read_bytes()
    replay = _run(campaign_ws, "evidence.table_opening", opening_args)
    assert replay["ok"] is True, replay
    assert replay["data"] == opening["data"]
    assert cursor_path.read_bytes() == cursor_before_replay

def test_table_opening_renders_bound_rolls_and_closes_setup_source_prefix(
    campaign_ws,
):
    investigator_id = "credit-focused-investigator"
    source_sheet = coc_toolbox.Ctx(
        campaign_ws["workspace"], campaign_ws["campaign_id"]
    ).sheet(campaign_ws["investigator_id"])
    sheet = deepcopy(source_sheet)
    sheet["id"] = investigator_id
    sheet["name"] = "信用调查员"
    sheet["characteristics"]["APP"] = 40
    sheet["skills"]["Credit Rating"] = 70
    sheet["credit_rating"] = 70
    coc_state.create_investigator(campaign_ws["workspace"], investigator_id, sheet)
    coc_state.link_party(
        campaign_ws["workspace"],
        campaign_ws["campaign_id"],
        [campaign_ws["investigator_id"], investigator_id],
    )

    setup_roll_ids = []
    for index, (expression, seed) in enumerate(
        (("3D6", 1), ("1D100", 2), ("1D10", 3)), start=1
    ):
        setup = _run(
            campaign_ws,
            "rules.roll_dice",
            {
                "expression": expression,
                "reason": f"pre-table source {index}",
                "seed": seed,
                "decision_id": f"pre-table-roll-{index}",
            },
        )
        assert setup["ok"] is True, setup
        setup_roll_ids.append(setup["data"]["roll_id"])

    run_id = "canonical-opening-run"

    def first_impression(npc_id: str, display_name: str, seed: int) -> dict:
        reaction = _run(
            campaign_ws,
            "npc.reaction",
            {
                "npc_id": npc_id,
                "npc_display_name": display_name,
                "investigator": investigator_id,
                "run_id": run_id,
                "context": {
                    "player_conduct": "调查员平静说明来意",
                    "scene_constraints": "对方仍保有自己的职责与边界",
                    "authored_or_relationship_boundary": "双方初次见面且没有既有关系",
                    "semantic_reason": "外表与信用只影响最初接纳方式",
                },
                "seed": seed,
                "decision_id": f"opening-reaction-{npc_id}",
            },
        )
        assert reaction["ok"] is True, reaction
        assert reaction["data"]["app"] == 40
        assert reaction["data"]["credit_rating"] == 70
        assert reaction["data"]["governing_attribute"] == "credit_rating"
        return reaction

    first = first_impression("npc-opening-one", "开场人物甲", 7)
    second = first_impression("npc-opening-two", "开场人物乙", 11)
    opening_roll_ids = [first["data"]["roll_id"], second["data"]["roll_id"]]
    narrative = "[in_game]\n开场叙事仍由 KP 自由书写。\n\n你要做什么？\n[/in_game]"
    opening_args = {
        "text": narrative,
        "run_id": run_id,
        "presented_roll_ids": opening_roll_ids,
        "decision_id": "canonical-opening-evidence",
    }
    opening = _run(campaign_ws, "evidence.table_opening", opening_args)
    assert opening["ok"] is True, opening
    exact_text = opening["data"]["text"]
    expected_lines = [
        coc_toolbox.coc_turn_finalization._render_public_roll(
            reaction["data"]["roll_record"], play_language="zh-Hans"
        )
        for reaction in (first, second)
    ]
    assert opening["data"]["presented_roll_ids"] == opening_roll_ids
    assert "开场叙事仍由 KP 自由书写。" in exact_text
    assert "[roll]" in exact_text and "[/roll]" in exact_text
    for expected in expected_lines:
        assert exact_text.count(expected) == 1
        assert exact_text.index(expected) < exact_text.index("[/in_game]")
    assert "外貌 40 / 信用评级 70；采用信用评级 70" in expected_lines[0]

    calls = _read_jsonl(
        campaign_ws["campaign_dir"] / "logs" / "toolbox-calls.jsonl"
    )
    opening_index = next(
        index
        for index, row in enumerate(calls)
        if row.get("tool") == "evidence.table_opening" and row.get("ok") is True
    )
    cursor_path = (
        campaign_ws["campaign_dir"] / "save" / "turn-source-cursor.json"
    )
    cursor_after_opening = json.loads(cursor_path.read_text(encoding="utf-8"))
    assert cursor_after_opening["next_source_index"] == opening_index + 1
    assert cursor_after_opening["last_finalization_id"] is None

    new_roll = _run(
        campaign_ws,
        "rules.roll_dice",
        {
            "expression": "1D6",
            "reason": "the first genuine player turn",
            "seed": 19,
            "decision_id": "first-player-turn-roll",
        },
    )
    assert new_roll["ok"] is True, new_roll
    cursor_before_replay = cursor_path.read_bytes()
    replay = _run(campaign_ws, "evidence.table_opening", opening_args)
    assert replay["ok"] is True, replay
    assert replay["data"] == opening["data"]
    assert cursor_path.read_bytes() == cursor_before_replay

    journal = _run(
        campaign_ws,
        "state.journal",
        {
            "summary": "首个真实玩家回合完成。",
            "player_text": "我开始行动。",
            "decision_id": "first-player-turn-journal",
        },
    )
    assert journal["ok"] is True, journal
    context = _run(campaign_ws, "turn.output_context")
    assert context["ok"] is True, context
    assert context["data"]["source_roll_ids"] == [new_roll["data"]["roll_id"]]
    public_ids = {
        row["roll_id"]
        for row in context["data"]["mechanics_bundle"]["public_check"]
    }
    assert public_ids == {new_roll["data"]["roll_id"]}
    assert not (set(setup_roll_ids) | set(opening_roll_ids)) & public_ids

def test_opening_bootstrap_is_idempotent_and_auto_projects_exact_watch(
    tmp_path: Path, monkeypatch,
):
    monkeypatch.setenv("COC_DISABLE_QUEUE_WORKER", "1")
    monkeypatch.setenv("COC_HOST", "pi")
    ws = _opening_component_workspace(tmp_path)
    assets = coc_toolbox.coc_module_project.coc_module_assets
    unrelated = assets.enqueue_job(
        ws["workspace"],
        ws["asset_root_id"],
        kind="deepen_location",
        target_id="unrelated-high-priority",
        priority=999,
        reason="prove opening materialization is exact-job only",
        kick_worker=False,
    )

    def reject_grace_poll(_seconds: float) -> None:
        raise AssertionError("blocking opening bootstrap must not sleep or poll")

    monkeypatch.setattr(coc_toolbox.time, "sleep", reject_grace_poll)
    args = {
        "start_location": {
            "location_id": "opening",
            "title": "Opening",
        },
        "opening_pdf_indices": [0],
    }
    first = _run(ws, "progressive.opening_bootstrap", args)
    assert first["ok"] is True, first
    source_work = first["data"]["source_work"]
    opening_job_id = source_work["job_id"]
    assert source_work["status"] == "queued"
    assert source_work["worker_kick"] == {
        "started": False,
        "reason": "caller_owns_materialization",
    }
    assert source_work["host_request_id"] == opening_job_id
    assert source_work["background_takeover"]["next_host_action"]["action"] == (
        "invoke_coc_dispatch_source_work"
    )
    assert (
        source_work["background_takeover"]["next_host_action"]["task"]
        ["packet"]["asset_root_id"]
        == ws["asset_root_id"]
    )
    assert (
        assets.get_host_work_request(
            ws["workspace"], ws["asset_root_id"], opening_job_id,
        )["work_level"]
        == "current_dependency"
    )
    queue = assets.list_queue(ws["workspace"], ws["asset_root_id"])
    assert [
        row["job_id"] for row in queue["pending"]
    ] == [unrelated["job"]["job_id"]]
    assert queue["in_flight"] == []
    assert any(
        row["job_id"] == opening_job_id
        and row["result"] == "awaiting_host_pack"
        for row in queue["done"]
    )
    repeated = _run(ws, "progressive.opening_bootstrap", args)
    assert repeated["ok"] is True, repeated
    assert repeated["data"]["source_work"]["status"] == "coalesced"
    assert repeated["data"]["source_work"]["job_id"] == opening_job_id
    assert (
        repeated["data"]["source_work"]["background_takeover"]
        == source_work["background_takeover"]
    )
    assert len(assets.list_host_work_requests(
        ws["workspace"], ws["asset_root_id"], limit=None,
    )) == 1
    queue = assets.list_queue(ws["workspace"], ws["asset_root_id"])
    assert [
        row["job_id"] for row in queue["pending"]
    ] == [unrelated["job"]["job_id"]]
    conflict = _run(ws, "progressive.opening_bootstrap", {
        **args,
        "start_location": {
            "location_id": "opening",
            "title": "Different",
        },
    })
    assert conflict["ok"] is False
    assert conflict["error"]["code"] == "opening_bootstrap_conflict"

    fulfilled = _run(ws, "progressive.fulfill_host_work", {
        "worker_result": {
            "job_id": opening_job_id,
                "pack": _opening_component_pack(parse_state="partial"),
                "related_packs": [],
                "opening_setup": _opening_setup_unresolved(),
            "opening_setup": _opening_setup_unresolved(),
        },
    })
    assert fulfilled["ok"] is True, fulfilled
    assert fulfilled["data"]["automatic_projection"][0]["status"] == "complete"
    current = _run(ws, "progressive.opening_bootstrap", args)
    assert current["ok"] is True, current
    assert current["data"]["source_work"]["status"] == "current"
    assert "background_takeover" not in current["data"]["source_work"]
    scenario = json.loads(
        (
            ws["campaign_dir"] / "scenario" / "scenario.json"
        ).read_text(encoding="utf-8")
    )
    assert scenario["opening_projection_watch"]["status"] == "complete"

    # The opening is now projected and the first scene transition has made the
    # campaign non-pristine. A duplicate bootstrap must return its receipt
    # without re-projecting or turning the completed opening into a deadlock.
    # This component test does not create Pi's required investigator/evidence
    # route; perform the canonical initial scene mutation on the neutral host,
    # then switch back to Pi for the duplicate-bootstrap regression.
    monkeypatch.setenv("COC_HOST", "codex")
    moved = _run(ws, "state.move_scene", {
        "scene_id": "opening",
        "decision_id": "opening-bootstrap-post-ready-move",
    })
    assert moved["ok"] is True, moved
    monkeypatch.setenv("COC_HOST", "pi")
    before_repeat = _opening_state_bytes_without_audit(ws["workspace"])
    post_ready = _run(ws, "progressive.opening_bootstrap", args)
    assert post_ready["ok"] is True, post_ready
    assert post_ready["data"]["status"] == "current"
    assert post_ready["data"]["idempotent"] is True
    assert post_ready["data"]["idempotent_reason"] == (
        "opening_already_current_after_play"
    )
    assert post_ready["data"]["source_work"]["status"] == "current"
    assert _opening_state_bytes_without_audit(ws["workspace"]) == before_repeat

def test_opening_bootstrap_l0_direct_write_skips_coordinator(
    tmp_path: Path, monkeypatch,
):
    """A validated module-init L0 writes the opening scene without any
    partial_opening claim/fulfill or coordinator spine, and evidence.
    table_opening still gates on the projected source."""
    monkeypatch.setenv("COC_DISABLE_QUEUE_WORKER", "1")
    monkeypatch.setenv("COC_HOST", "pi")
    ws = _opening_component_workspace(
        tmp_path, extra_pdf_indices=(1,), source_page_count=2,
    )
    _scenario_path, staged_facts = _stage_reviewed_facts_transport(
        ws, module_init_l0=_l0_direct_opening_l0(),
    )
    adopted = _run(ws, "setup.adopt_source_facts", {
        "campaign_id": ws["campaign_id"],
        "facts": staged_facts,
    })
    assert adopted["ok"] is True, adopted
    args = {
        "start_location": {
            "location_id": "opening",
            "title": "Opening",
        },
        "opening_pdf_indices": [0],
    }
    boot = _run(ws, "progressive.opening_bootstrap", args)
    assert boot["ok"] is True, boot
    data = boot["data"]
    assert data["status"] == "complete"
    source_work = data["source_work"]
    assert source_work["direct_write"] is True
    assert source_work["origin"] == "module_init_l0"
    assert "background_takeover" not in source_work
    assert "job_id" not in source_work

    assets = coc_toolbox.coc_module_project.coc_module_assets
    all_work = assets.list_host_work_requests(
        ws["workspace"], ws["asset_root_id"],
        include_closed=True, limit=None,
    )
    assert all(
        row.get("kind") != "partial_opening" for row in all_work
    ), [row for row in all_work if row.get("kind") == "partial_opening"]
    queue = assets.list_queue(ws["workspace"], ws["asset_root_id"])
    assert all(
        row.get("kind") != "partial_opening"
        for row in [
            *queue.get("pending", []),
            *queue.get("in_flight", []),
            *queue.get("done", []),
        ]
    )

    scenario = json.loads((
        ws["campaign_dir"] / "scenario" / "scenario.json"
    ).read_text(encoding="utf-8"))
    assert scenario["opening_projection_watch"]["status"] == "complete"
    assert "opening_projection_receipt" in scenario
    assert "opening_projection_source_binding" in scenario

    readiness = coc_toolbox.coc_module_project.opening_source_readiness(
        ws["campaign_dir"],
    )
    assert readiness["state"] == "ready", readiness

    # The L0 text landed in the durable canonical opening pack with the same
    # source-evidence discipline a foreground partial slice would carry.
    pack = assets.get_entity(
        ws["workspace"], ws["asset_root_id"], "location", "opening",
    )
    assert pack["parse_state"] == "partial"
    assert pack["evidence_gap"] is False
    assert [row["text"] for row in pack["read_aloud"]] == [
        "A bounded authored opening."
    ]
    assert [row["note"] for row in pack["keeper_only"]] == [
        "Keeper-only opening note."
    ]
    assert pack["source_evidence"]["pdf_indices"] == [0]
    assert pack["provenance"]["authority"] == "source_authored"
    assert pack["provenance"]["basis"] == "module_init_l0"

    # The projected-source gate lets the player-visible opening be recorded.
    # (A duplicate bootstrap while pristine re-sparses the IR and the gate
    # then issues the project_opening refresh card — same transient recovery
    # as the legacy partial lane — so the opening evidence runs first.)
    opening = _run(ws, "evidence.table_opening", {
        "text": "A bounded authored opening.",
        "run_id": "l0-direct-run",
        "presented_roll_ids": [],
        "decision_id": "l0-direct-opening-evidence",
    })
    assert opening["ok"] is True, opening
    assert opening["data"]["text"]

    # Duplicate bootstrap is idempotent-current with no second materialization.
    repeated = _run(ws, "progressive.opening_bootstrap", args)
    assert repeated["ok"] is True, repeated
    assert repeated["data"]["status"] == "current"
    assert repeated["data"]["idempotent"] is True
    assert repeated["data"]["source_work"]["status"] == "current"

def test_raw_bundle_opening_naturally_queues_and_compiles_media_cards(
    tmp_path: Path, monkeypatch,
):
    """Binding + L0 discovery creates card stubs/jobs; the test never seeds one."""
    monkeypatch.setenv("COC_DISABLE_QUEUE_WORKER", "1")
    monkeypatch.setenv("COC_HOST", "pi")
    scene_image = b"\x89PNG\r\n\x1a\nscene"
    map_image = b"\x89PNG\r\n\x1a\nmap"
    ws = _opening_component_workspace(
        tmp_path,
        extra_pdf_indices=(1, 2),
        source_page_count=3,
        source_assets={
            "assets/opening-scene.png": (scene_image, 0),
            "assets/warehouse-map.png": (map_image, 1),
        },
    )
    assets_mod = coc_toolbox.coc_module_project.coc_module_assets
    card_ids = ["opening-scene", "warehouse-map", "archive-note"]
    assert all(
        assets_mod.get_entity(
            ws["workspace"], ws["asset_root_id"], "handout", card_id,
        ) is None
        for card_id in card_ids
    )
    l0 = _l0_direct_opening_l0()
    l0["opening_handouts"] = [
        {
            "id": "opening-scene",
            "title": "码头景象",
            "when_to_give": "开场抵达时",
            "kind": "document",
            "source_refs": ["pdf_index-0"],
        },
        {
            "id": "warehouse-map",
            "title": "仓库地图",
            "when_to_give": "地图被找到时",
            "kind": "map",
            "source_refs": ["pdf_index-1"],
        },
        {
            "id": "archive-note",
            "title": "档案原文",
            "when_to_give": "档案被读到时",
            "kind": "read_aloud",
            "source_refs": ["pdf_index-2"],
        },
    ]
    adapter = _load(
        "coc_pdf_adapter_natural_media_test",
        REPO / "plugins/coc-keeper/pi/bin/coc-pdf-skill-adapter.py",
    )
    producer_schema = adapter._module_init_l0_schema()
    required_handout_fields = set(
        producer_schema["opening_handout_required_fields"]
    )
    allowed_handout_fields = required_handout_fields | {"kind"}
    assert all(
        required_handout_fields <= set(row) <= allowed_handout_fields
        for row in l0["opening_handouts"]
    )
    producer_result = adapter._validate_opening_extractor_result({
        "schema_version": 1,
        "contract_id": "coc.pi-opening-text-extractor-result.v1",
        "status": "reviewed",
        "campaign_id": ws["campaign_id"],
        "scenario_id": ws["asset_root_id"],
        "source_bundle_path": str(ws["workspace"] / "opening-source"),
        "failure_class": None,
        "facts": _minimal_opening_source_facts("pdf:opening-component"),
        "module_init_l0": l0,
        "selected_opening_pdf_indices": [0],
        "fact_evidence_pdf_indices": [0, 1, 2],
    }, {
        "campaign_id": ws["campaign_id"],
        "scenario_id": ws["asset_root_id"],
        "source_bundle_path": str(ws["workspace"] / "opening-source"),
        "source": {"source_id": "pdf:opening-component"},
    }, [0], [0, 1, 2])
    l0 = producer_result["module_init_l0"]
    _scenario_path, staged_facts = _stage_reviewed_facts_transport(
        ws, module_init_l0=l0,
    )
    adopted = _run(ws, "setup.adopt_source_facts", {
        "campaign_id": ws["campaign_id"],
        "facts": staged_facts,
    })
    assert adopted["ok"] is True, adopted
    boot = _run(ws, "progressive.opening_bootstrap", {
        "start_location": {"location_id": "opening", "title": "Opening"},
        "opening_pdf_indices": [0],
    })
    assert boot["ok"] is True, boot
    source_work = boot["data"]["source_work"]
    assert source_work["opening_handout_card_ids"] == [
        "opening-scene", "warehouse-map", "archive-note",
    ]
    stubs = [
        assets_mod.get_entity(
            ws["workspace"], ws["asset_root_id"], "handout", card_id,
        )
        for card_id in card_ids
    ]
    assert all(isinstance(row, dict) for row in stubs)
    assert {row["handout_id"] for row in stubs} == {
        "opening-scene", "warehouse-map", "archive-note",
    }
    assert {row["parse_state"] for row in stubs} == {"named_only"}
    assert all("image_ref" not in row and "text" not in row for row in stubs)

    queue_worker = coc_toolbox.coc_module_project._load_sibling(
        "coc_module_queue_worker_natural_media_test",
        "coc_module_queue_worker.py",
    )
    while True:
        produced = queue_worker.run_worker_once(ws["workspace"], parallel=1)
        if produced["claimed"] == 0:
            break
    requests = {
        row["target_id"]: row
        for row in assets_mod.list_host_work_requests(
            ws["workspace"], ws["asset_root_id"], include_closed=True, limit=None,
        )
        if row.get("kind") == "deepen_handout"
    }
    assert set(requests) == {"opening-scene", "warehouse-map", "archive-note"}
    assert "opening-keeper" not in requests
    packs = {
        "opening-scene": {
            "kind": "document",
            "source_refs": ["pdf_index-0"],
            "image_ref": "assets/opening-scene.png",
        },
        "warehouse-map": {
            "kind": "map",
            "source_refs": ["pdf_index-1"],
            "image_ref": "assets/warehouse-map.png",
        },
        "archive-note": {
            "kind": "read_aloud",
            "source_refs": ["pdf_index-2"],
            "text": "Accepted extra source page.",
            "localized_title": {"zh-Hans": "档案原文"},
            "localized_text": {"zh-Hans": "已验收的额外来源页。"},
        },
    }
    for card_id, request in requests.items():
        semantic = packs[card_id]
        fulfilled = _run(ws, "progressive.fulfill_host_work", {
            "worker_result": {
                "job_id": request["job_id"],
                "pack": {
                    "handout_id": card_id,
                    "asset_id": card_id,
                    "title": next(
                        row["title"] for row in stubs
                        if row["handout_id"] == card_id
                    ),
                    "scene_refs": ["opening"],
                    "clue_refs": [],
                    "player_visible": True,
                    "parse_state": "deep",
                    "evidence_gap": False,
                    "origin": "source",
                    "provenance": {
                        "authority": "source_authored", "basis": "host_pack",
                    },
                    **semantic,
                },
                "related_packs": [],
            },
        })
        assert fulfilled["ok"] is True, fulfilled
    coc_toolbox.coc_module_project.project_skeleton_to_campaign(
        ws["workspace"], ws["campaign_id"], ws["asset_root_id"],
    )
    handouts = json.loads(
        (ws["campaign_dir"] / "scenario/handouts.json").read_text(encoding="utf-8")
    )["handouts"]
    assert {row["asset_id"] for row in handouts} == set(packs)
    by_id = {row["asset_id"]: row for row in handouts}
    assert by_id["opening-scene"]["image_ref"] == "assets/opening-scene.png"
    assert by_id["warehouse-map"]["kind"] == "map"
    assert by_id["warehouse-map"]["image_ref"] == "assets/warehouse-map.png"
    assert by_id["archive-note"]["kind"] == "read_aloud"
    assert by_id["archive-note"]["text"] == "Accepted extra source page."

def test_opening_bootstrap_rejects_uncached_handout_ref_without_durable_work(
    tmp_path: Path, monkeypatch,
):
    monkeypatch.setenv("COC_DISABLE_QUEUE_WORKER", "1")
    monkeypatch.setenv("COC_HOST", "pi")
    ws = _opening_component_workspace(tmp_path)
    l0 = _l0_direct_opening_l0()
    l0["opening_handouts"][0]["source_refs"] = ["pdf_index-999"]
    _scenario_path, staged_facts = _stage_reviewed_facts_transport(
        ws, module_init_l0=l0,
    )
    adopted = _run(ws, "setup.adopt_source_facts", {
        "campaign_id": ws["campaign_id"], "facts": staged_facts,
    })
    assert adopted["ok"] is True, adopted

    boot = _run(ws, "progressive.opening_bootstrap", {
        "start_location": {"location_id": "opening", "title": "Opening"},
        "opening_pdf_indices": [0],
    })
    assert boot["ok"] is False, boot
    assert boot["error"]["code"] == "opening_l0_direct_write_invalid"
    assets_mod = coc_toolbox.coc_module_project.coc_module_assets
    assert assets_mod.get_entity(
        ws["workspace"], ws["asset_root_id"], "location", "opening",
    ) is None
    assert assets_mod.get_entity(
        ws["workspace"], ws["asset_root_id"], "handout", "handout-1",
    ) is None
    assert not [
        row for row in assets_mod.list_host_work_requests(
            ws["workspace"], ws["asset_root_id"], include_closed=True, limit=None,
        )
        if row.get("kind") == "deepen_handout"
    ]

def test_opening_bootstrap_l0_direct_write_omits_thin_hook_read_aloud(
    tmp_path: Path, monkeypatch,
):
    """Thin L0 still bootstraps; incomplete locale does not become read_aloud."""
    monkeypatch.setenv("COC_DISABLE_QUEUE_WORKER", "1")
    monkeypatch.setenv("COC_HOST", "pi")
    ws = _opening_component_workspace(tmp_path)
    l0 = _l0_direct_opening_l0(localized=False)
    source_text = l0["opening_hooks"][0]["text"]
    _scenario_path, staged_facts = _stage_reviewed_facts_transport(
        ws, module_init_l0=l0,
    )
    adopted = _run(ws, "setup.adopt_source_facts", {
        "campaign_id": ws["campaign_id"],
        "facts": staged_facts,
    })
    assert adopted["ok"] is True, adopted
    boot = _run(ws, "progressive.opening_bootstrap", {
        "start_location": {
            "location_id": "opening",
            "title": "Opening",
        },
        "opening_pdf_indices": [0],
    })
    assert boot["ok"] is True, boot
    assert boot["data"]["status"] == "complete"
    assert boot["data"]["source_work"]["direct_write"] is True
    assets = coc_toolbox.coc_module_project.coc_module_assets
    pack = assets.get_entity(
        ws["workspace"], ws["asset_root_id"], "location", "opening",
    )
    assert pack["parse_state"] == "partial"
    assert pack["read_aloud"] == []
    assert pack["player_safe_summary"] == source_text
    assert [row["note"] for row in pack["keeper_only"]] == [
        "Keeper-only opening note."
    ]
    _assert_source_text_not_substituted_as_zh_hans(pack, source_text)
    readiness = coc_toolbox.coc_module_project.opening_source_readiness(
        ws["campaign_dir"],
    )
    assert readiness["state"] == "ready", readiness

def test_opening_bootstrap_delivers_reviewed_handout_locale_end_to_end(
    tmp_path: Path, monkeypatch,
):
    """Reviewed L0 handout locale fields reach permission-controlled player
    delivery through the normal bootstrap path; source-only rows never
    masquerade as localized cards."""
    monkeypatch.setenv("COC_DISABLE_QUEUE_WORKER", "1")
    monkeypatch.setenv("COC_HOST", "pi")
    ws = _opening_component_workspace(tmp_path)
    l0 = _l0_direct_opening_l0()
    source_title = "小卡片#1"
    l0["opening_handouts"] = [
        {
            "id": "handout-1",
            "title": source_title,
            "when_to_give": "开场简报",
            "kind": "read_aloud",
            "source_refs": ["pdf_index-0"],
            "localized_title": {"zh-Hans": "开场简报卡"},
            "localized_text": {"zh-Hans": "一段已审阅的开场译文。"},
        },
        {
            "id": "handout-2",
            "title": "Source-only note",
            "when_to_give": "later",
            "source_refs": ["pdf_index-0"],
        },
    ]
    _scenario_path, staged_facts = _stage_reviewed_facts_transport(
        ws, module_init_l0=l0,
    )
    adopted = _run(ws, "setup.adopt_source_facts", {
        "campaign_id": ws["campaign_id"],
        "facts": staged_facts,
    })
    assert adopted["ok"] is True, adopted
    boot = _run(ws, "progressive.opening_bootstrap", {
        "start_location": {
            "location_id": "opening",
            "title": "Opening",
        },
        "opening_pdf_indices": [0],
    })
    assert boot["ok"] is True, boot
    assert boot["data"]["status"] == "complete"
    assert boot["data"]["source_work"]["direct_write"] is True

    assets = coc_toolbox.coc_module_project.coc_module_assets
    reviewed = assets.get_entity(
        ws["workspace"], ws["asset_root_id"], "handout", "handout-1",
    )
    assert reviewed["parse_state"] == "body_parsed"
    assert reviewed["localized_title"] == {"zh-Hans": "开场简报卡"}
    assert reviewed["localized_text"] == {"zh-Hans": "一段已审阅的开场译文。"}
    assert "body_source_page_indices" not in reviewed
    source_only = assets.get_entity(
        ws["workspace"], ws["asset_root_id"], "handout", "handout-2",
    )
    assert source_only["parse_state"] == "named_only"
    assert "localized_title" not in source_only
    assert "localized_text" not in source_only
    # Source-only prose never masquerades as a localization anywhere in the
    # canonical entity.
    assert "zh-Hans" not in json.dumps(source_only, ensure_ascii=False)

    # The canonical campaign card store carries the reviewed locale fields
    # through the opening projection.
    store = json.loads((
        ws["campaign_dir"] / "scenario" / "handouts.json"
    ).read_text(encoding="utf-8"))
    cards = {row["asset_id"]: row for row in store["handouts"]}
    assert cards["handout-1"]["localized_title"] == {"zh-Hans": "开场简报卡"}
    assert cards["handout-1"]["localized_text"] == {
        "zh-Hans": "一段已审阅的开场译文。",
    }
    assert cards["handout-1"]["parse_state"] == "body_parsed"
    assert "handout-2" not in cards

    # Permission-controlled delivery hands the player the reviewed title and
    # body; the source-only stub stays fail-closed.
    delivered = _run(ws, "state.deliver_handout", {
        "handout_id": "handout-1",
        "decision_id": "opening-handout-1",
        "scene_id": "opening",
        "reason": "开场简报交付",
    })
    assert delivered["ok"] is True, delivered
    assert delivered["data"]["card"]["title"] == "开场简报卡"
    assert delivered["data"]["card"]["text"] == "一段已审阅的开场译文。"
    world = json.loads((
        ws["campaign_dir"] / "save" / "world-state.json"
    ).read_text(encoding="utf-8"))
    assert world["delivered_handout_ids"] == ["handout-1"]
    refused = _run(ws, "state.deliver_handout", {
        "handout_id": "handout-2",
        "decision_id": "opening-handout-2",
    })
    assert refused["ok"] is False, refused
    assert refused["error"]["code"] == "unknown_handout"

def test_deepen_handout_queue_lifecycle_keeps_table_language_title(
    tmp_path: Path, monkeypatch,
):
    """Queue-enabled regression: the real deepen_handout host-work request
    carries a closed contract that permits (and for read_aloud requires) the
    full play-language title/body maps, so deep fulfillment cannot drop the
    table-language title that player delivery projects from.

    The env toggle only suppresses the detached auto-kick subprocess; the
    real queue worker below is driven in-process so the lifecycle stays
    deterministic."""
    monkeypatch.setenv("COC_DISABLE_QUEUE_WORKER", "1")
    monkeypatch.setenv("COC_HOST", "pi")
    ws = _opening_component_workspace(tmp_path)
    l0 = _l0_direct_opening_l0()
    l0["opening_handouts"] = [
        {
            "id": "handout-1",
            "title": "小卡片#1",
            "when_to_give": "开场简报",
            "kind": "read_aloud",
            "source_refs": ["pdf_index-0"],
        },
    ]
    _scenario_path, staged_facts = _stage_reviewed_facts_transport(
        ws, module_init_l0=l0,
    )
    adopted = _run(ws, "setup.adopt_source_facts", {
        "campaign_id": ws["campaign_id"],
        "facts": staged_facts,
    })
    assert adopted["ok"] is True, adopted
    boot = _run(ws, "progressive.opening_bootstrap", {
        "start_location": {
            "location_id": "opening",
            "title": "Opening",
        },
        "opening_pdf_indices": [0],
    })
    assert boot["ok"] is True, boot
    assert boot["data"]["source_work"]["direct_write"] is True

    assets = coc_toolbox.coc_module_project.coc_module_assets
    worker = coc_toolbox.coc_module_project._load_sibling(
        "coc_module_queue_worker_locale_lifecycle",
        "coc_module_queue_worker.py",
    )
    produced = worker.run_worker_once(ws["workspace"], parallel=1)
    assert produced["claimed"] >= 1

    queue = assets.list_queue(ws["workspace"], ws["asset_root_id"])
    deepen_rows = [
        row
        for row in [
            *list(queue.get("pending") or []),
            *list(queue.get("in_flight") or []),
            *list(queue.get("done") or []),
        ]
        if isinstance(row, dict)
        and row.get("kind") == "deepen_handout"
        and str(row.get("target_id") or "") == "handout-1"
    ]
    assert deepen_rows, produced
    job_id = str(deepen_rows[0]["job_id"])
    request = assets.get_host_work_request(
        ws["workspace"], ws["asset_root_id"], job_id,
    )
    assert request is not None
    contract = request["result_contract"]
    assert contract["contract_id"] == "coc.handout-card-pack.v1"
    # The closed contract and the queue instruction now agree: the deep pack
    # may (and for read_aloud must) carry the table-language title.
    assert "localized_title" in contract["allowed_pack_fields"]
    assert "localized_text" in contract["allowed_pack_fields"]
    assert request["play_languages"] == ["zh-Hans"]

    claimed = assets.claim_host_work_requests(
        ws["workspace"],
        ws["asset_root_id"],
        executor_id="queue-locale-lifecycle-test",
        limit=10,
    )
    claimed_requests = [
        req
        for packet in claimed["packets"]
        for req in packet["requests"]
    ]
    assert any(str(req.get("job_id") or "") == job_id for req in claimed_requests)

    stub = assets.get_entity(
        ws["workspace"], ws["asset_root_id"], "handout", "handout-1",
    )
    deep_pack = {
        "handout_id": "handout-1",
        "asset_id": "handout-1",
        "kind": "read_aloud",
        "title": "小卡片#1",
        "text": "A bounded authored opening.",
        "localized_title": {"zh-Hans": "开场简报卡（深掘）"},
        "localized_text": {"zh-Hans": "深掘后的完整开场译文。"},
        "when_to_deliver": "开场简报交付时",
        "source_refs": ["pdf_index-0"],
        "scene_refs": list(stub.get("scene_refs") or []),
        "clue_refs": [],
        "player_visible": True,
        "parse_state": "deep",
        "evidence_gap": False,
        "origin": "source",
        "provenance": {"authority": "source_authored", "basis": "host_pack"},
    }
    locale_dropped = json.loads(json.dumps(deep_pack))
    del locale_dropped["localized_title"]
    rejected = _run(ws, "progressive.fulfill_host_work", {
        "worker_result": {
            "job_id": job_id,
            "pack": locale_dropped,
            "related_packs": [],
        },
    })
    assert rejected["ok"] is False, rejected
    assert "lacks full active play_language" in rejected["error"]["message"]
    # The rejected pack never overwrote the honest named-only stub.
    still_stub = assets.get_entity(
        ws["workspace"], ws["asset_root_id"], "handout", "handout-1",
    )
    assert still_stub["parse_state"] == "named_only"
    assert "localized_title" not in still_stub

    fulfilled = _run(ws, "progressive.fulfill_host_work", {
        "worker_result": {
            "job_id": job_id,
            "pack": deep_pack,
            "related_packs": [],
        },
    })
    assert fulfilled["ok"] is True, fulfilled

    deep_entity = assets.get_entity(
        ws["workspace"], ws["asset_root_id"], "handout", "handout-1",
    )
    assert deep_entity["parse_state"] == "deep"
    assert deep_entity["localized_title"] == {"zh-Hans": "开场简报卡（深掘）"}
    assert deep_entity["localized_text"] == {"zh-Hans": "深掘后的完整开场译文。"}

    delivered = _run(ws, "state.deliver_handout", {
        "handout_id": "handout-1",
        "decision_id": "deepen-locale-deliver-1",
        "scene_id": "opening",
        "reason": "深掘后开场简报交付",
    })
    assert delivered["ok"] is True, delivered
    assert delivered["data"]["card"]["title"] == "开场简报卡（深掘）"
    assert delivered["data"]["card"]["text"] == "深掘后的完整开场译文。"

    # Canonical reprojection re-merges the stored deep card into the
    # campaign card store (the same path skeleton refresh takes) without
    # losing the authoritative delivery.
    projected = coc_toolbox.coc_module_project.project_skeleton_to_campaign(
        ws["workspace"], ws["campaign_id"], ws["asset_root_id"],
    )
    assert "handout:handout-1" in projected["reapplied_deep_entities"]
    store = json.loads((
        ws["campaign_dir"] / "scenario" / "handouts.json"
    ).read_text(encoding="utf-8"))
    card = next(
        row for row in store["handouts"] if row["asset_id"] == "handout-1"
    )
    assert card["parse_state"] == "deep"
    assert card["localized_title"] == {"zh-Hans": "开场简报卡（深掘）"}
    assert card["localized_text"] == {"zh-Hans": "深掘后的完整开场译文。"}
    world = json.loads((
        ws["campaign_dir"] / "save" / "world-state.json"
    ).read_text(encoding="utf-8"))
    assert world["delivered_handout_ids"] == ["handout-1"]

def test_deepen_handout_body_parsed_card_refs_publish_and_complete(
    tmp_path: Path, monkeypatch,
):
    """A reviewed body_parsed opening card carries canonical compact
    pdf_index-N source_refs; the real queue worker must publish its
    deepen_handout request from that exact scope (previously it died on
    "source_refs[0] must be an object") and the fulfilled deep card must
    keep the required table-language title/body.

    COC_DISABLE_QUEUE_WORKER is deliberately unset: it only gates the
    detached auto-kick, so bootstrap's enqueue kicks the real detached
    worker while this test also drives the same worker code in-process as
    a deterministic fallback for CI environments without process spawn."""
    monkeypatch.delenv("COC_DISABLE_QUEUE_WORKER", raising=False)
    monkeypatch.setenv("COC_HOST", "pi")
    ws = _opening_component_workspace(tmp_path)
    l0 = _l0_direct_opening_l0()
    l0["opening_handouts"] = [
        {
            "id": "handout-1",
            "title": "小卡片#1",
            "when_to_give": "开场简报",
            "kind": "read_aloud",
            "source_refs": ["pdf_index-0"],
            "localized_title": {"zh-Hans": "开场简报卡"},
            "localized_text": {"zh-Hans": "一段已审阅的开场译文。"},
        },
    ]
    _scenario_path, staged_facts = _stage_reviewed_facts_transport(
        ws, module_init_l0=l0,
    )
    adopted = _run(ws, "setup.adopt_source_facts", {
        "campaign_id": ws["campaign_id"],
        "facts": staged_facts,
    })
    assert adopted["ok"] is True, adopted
    boot = _run(ws, "progressive.opening_bootstrap", {
        "start_location": {
            "location_id": "opening",
            "title": "Opening",
        },
        "opening_pdf_indices": [0],
    })
    assert boot["ok"] is True, boot
    assert boot["data"]["source_work"]["direct_write"] is True

    assets = coc_toolbox.coc_module_project.coc_module_assets
    worker = coc_toolbox.coc_module_project._load_sibling(
        "coc_module_queue_worker_body_parsed_refs",
        "coc_module_queue_worker.py",
    )
    reviewed = assets.get_entity(
        ws["workspace"], ws["asset_root_id"], "handout", "handout-1",
    )
    assert reviewed["parse_state"] == "body_parsed"
    assert reviewed["source_refs"] == ["pdf_index-0"]
    assert reviewed["localized_title"] == {"zh-Hans": "开场简报卡"}

    # The bootstrap enqueue auto-kicked the detached worker (disable flag
    # unset); poll for the published request and run one in-process worker
    # pass per poll so the test cannot hang on environments where the
    # detached spawn is unavailable.
    hw_dir = (
        assets._module_dir(ws["workspace"], ws["asset_root_id"])
        / "host-work"
    )
    request: dict | None = None
    for _attempt in range(25):
        if hw_dir.is_dir():
            for path in sorted(hw_dir.glob("*.json")):
                try:
                    row = json.loads(path.read_text(encoding="utf-8"))
                except (OSError, ValueError):
                    continue
                if (
                    isinstance(row, dict)
                    and row.get("kind") == "deepen_handout"
                    and str(row.get("target_id") or "") == "handout-1"
                ):
                    request = row
                    break
        if request is not None:
            break
        worker.run_worker_once(ws["workspace"], parallel=1)
        time.sleep(0.2)
    assert request is not None, (
        "deepen_handout request for the body_parsed card was never published"
    )

    job_id = str(request["job_id"])
    contract = request["result_contract"]
    assert contract["contract_id"] == "coc.handout-card-pack.v1"
    assert "localized_title" in contract["allowed_pack_fields"]
    assert "localized_text" in contract["allowed_pack_fields"]
    assert request["play_languages"] == ["zh-Hans"]
    # The exact compact-ref scope became the request's page window.
    assert request["requested_pdf_indices"] == [0]
    assert {
        row["card_source_ref"]
        for row in contract["allowed_exact_source_refs"]
    } == {"pdf_index-0"}

    assets.claim_host_work_requests(
        ws["workspace"],
        ws["asset_root_id"],
        executor_id="body-parsed-refs-test",
        limit=10,
    )
    deep_pack = {
        "handout_id": "handout-1",
        "asset_id": "handout-1",
        "kind": "read_aloud",
        "title": "小卡片#1",
        "text": "A bounded authored opening.",
        "localized_title": {"zh-Hans": "开场简报卡（深掘）"},
        "localized_text": {"zh-Hans": "深掘后的完整开场译文。"},
        "when_to_deliver": "开场简报交付时",
        "source_refs": ["pdf_index-0"],
        "scene_refs": list(reviewed.get("scene_refs") or []),
        "clue_refs": [],
        "player_visible": True,
        "parse_state": "deep",
        "evidence_gap": False,
        "origin": "source",
        "provenance": {"authority": "source_authored", "basis": "host_pack"},
    }
    locale_dropped = json.loads(json.dumps(deep_pack))
    del locale_dropped["localized_title"]
    rejected = _run(ws, "progressive.fulfill_host_work", {
        "worker_result": {
            "job_id": job_id,
            "pack": locale_dropped,
            "related_packs": [],
        },
    })
    assert rejected["ok"] is False, rejected
    assert "lacks full active play_language" in rejected["error"]["message"]
    # The rejected pack never clobbered the reviewed body_parsed card.
    still_reviewed = assets.get_entity(
        ws["workspace"], ws["asset_root_id"], "handout", "handout-1",
    )
    assert still_reviewed["parse_state"] == "body_parsed"
    assert still_reviewed["localized_title"] == {"zh-Hans": "开场简报卡"}

    fulfilled = _run(ws, "progressive.fulfill_host_work", {
        "worker_result": {
            "job_id": job_id,
            "pack": deep_pack,
            "related_packs": [],
        },
    })
    assert fulfilled["ok"] is True, fulfilled
    deep_entity = assets.get_entity(
        ws["workspace"], ws["asset_root_id"], "handout", "handout-1",
    )
    assert deep_entity["parse_state"] == "deep"
    assert deep_entity["localized_title"] == {"zh-Hans": "开场简报卡（深掘）"}
    assert deep_entity["localized_text"] == {"zh-Hans": "深掘后的完整开场译文。"}

    delivered = _run(ws, "state.deliver_handout", {
        "handout_id": "handout-1",
        "decision_id": "body-parsed-deepen-deliver-1",
        "scene_id": "opening",
        "reason": "深掘后开场简报交付",
    })
    assert delivered["ok"] is True, delivered
    assert delivered["data"]["card"]["title"] == "开场简报卡（深掘）"
    assert delivered["data"]["card"]["text"] == "深掘后的完整开场译文。"

    projected = coc_toolbox.coc_module_project.project_skeleton_to_campaign(
        ws["workspace"], ws["campaign_id"], ws["asset_root_id"],
    )
    assert "handout:handout-1" in projected["reapplied_deep_entities"]
    store = json.loads((
        ws["campaign_dir"] / "scenario" / "handouts.json"
    ).read_text(encoding="utf-8"))
    card = next(
        row for row in store["handouts"] if row["asset_id"] == "handout-1"
    )
    assert card["parse_state"] == "deep"
    assert card["localized_title"] == {"zh-Hans": "开场简报卡（深掘）"}
    world = json.loads((
        ws["campaign_dir"] / "save" / "world-state.json"
    ).read_text(encoding="utf-8"))
    assert world["delivered_handout_ids"] == ["handout-1"]

def test_leased_opening_defers_fulfill_and_releases_after_turn_journal(
    tmp_path: Path, monkeypatch,
):
    """Pending finalization releases, but never fulfills or immediately retries."""
    monkeypatch.setenv("COC_DISABLE_QUEUE_WORKER", "1")
    monkeypatch.setenv("COC_HOST", "pi")
    ws = _opening_component_workspace(tmp_path)
    boot = _run(ws, "progressive.opening_bootstrap", {
        "start_location": {
            "location_id": "opening",
            "title": "Opening",
        },
        "opening_pdf_indices": [0],
    })
    assert boot["ok"] is True, boot
    assets = coc_toolbox.coc_module_project.coc_module_assets
    claimed = assets.claim_host_work_requests(
        ws["workspace"],
        ws["asset_root_id"],
        executor_id="pending-finalize-source-test",
        result_delivery="return_to_parent",
    )
    packet = claimed["packets"][0]

    # A malformed/redundant KP projection attempt while the coordinator owns
    # the source job is a typed, idempotent deferred result rather than a
    # missing-parameter failure or a second projection path.
    deferred = _run(ws, "progressive.project_opening", {})
    assert deferred["ok"] is True, deferred
    assert deferred["data"] == {
        "status": "source_lifecycle_in_flight",
        "projection_deferred": True,
        "idempotent": True,
        "retry_required": False,
        "projection_owner": "campaign_opening_projection_watch",
        "open_job_ids": [boot["data"]["source_work"]["job_id"]],
        "lifecycle_states": ["leased"],
    }

    # This component regression constructs a pre-existing pending turn to test
    # coordinator lease release. The Pi main-KP gate now correctly forbids
    # creating such a played turn before opening, so create the synthetic
    # pending manifest outside the Pi host surface.
    monkeypatch.setenv("COC_HOST", "codex")
    journaled = _run(ws, "state.journal", {
        "summary": "本轮已结算，后台来源工作随后完成。",
        "player_action": "结束本轮",
        "player_text": "我结束这一轮行动。",
        "intent_class": "investigate",
        "decision_id": "journal-before-source-fulfillment",
    })
    assert journaled["ok"] is True, journaled
    monkeypatch.setenv("COC_HOST", "pi")
    renewed = _run(ws, "progressive.renew_host_work_leases", {
        "asset_root_id": ws["asset_root_id"],
        "executor_id": "pending-finalize-source-test",
        "lease_ids": [packet["packet_id"]],
        "lease_seconds": 120,
    })
    assert renewed["ok"] is True, renewed
    assert renewed["data"]["renewed_job_ids"] == [
        packet["requests"][0]["job_id"],
    ]
    deferred_fulfill = _run(ws, "progressive.fulfill_host_work", {
        "worker_result": {
            "job_id": packet["requests"][0]["job_id"],
            "pack": _opening_component_pack(parse_state="partial"),
            "related_packs": [],
            "opening_setup": _opening_setup_unresolved(),
        },
    })
    assert deferred_fulfill["ok"] is False
    assert deferred_fulfill["error"]["code"] == "turn_pending_finalization"
    released = _run(ws, "progressive.release_host_work_leases", {
        "asset_root_id": ws["asset_root_id"],
        "executor_id": "pending-finalize-source-test",
        "lease_ids": [packet["packet_id"]],
        "reason": "turn_pending_finalization",
    })
    assert released["ok"] is True, released
    assert released["data"]["released_job_ids"] == [
        packet["requests"][0]["job_id"],
    ]
    request = assets.get_host_work_request(
        ws["workspace"],
        ws["asset_root_id"],
        packet["requests"][0]["job_id"],
    )
    assert request["dispatch_state"] == "ready"
    assert "lease_id" not in request
    assert "executor_id" not in request

    monkeypatch.setenv("COC_HOST", "codex")
    _finalize_pending_turn_for_test(
        ws,
        decision_id="finalize-before-source-retakeover",
    )
    monkeypatch.setenv("COC_HOST", "pi")
    recovery = _run(ws, "progressive.project_opening", {})
    assert recovery["ok"] is True, recovery
    assert recovery["data"]["status"] == "source_recovery_ready"
    assert recovery["data"]["projection_deferred"] is False
    assert recovery["data"]["retry_required"] is True
    assert recovery["data"]["lifecycle_states"] == ["runnable"]
    assert recovery["data"]["normal_next_operation"] == {
        "operation": "scene.context",
        "arguments": {},
    }
    takeover = recovery["data"]["background_takeover"]
    assert takeover["next_host_action"]["action"] == (
        "invoke_coc_dispatch_source_work"
    )

    context = _run(ws, "scene.context")
    assert context["ok"] is False, context
    assert context["error"]["code"] == "opening_setup_incomplete"
    assert context["error"]["details"]["phase"] == (
        "opening_source_materialization"
    )
    # Pending materialization always carries an honest lifecycle card; never
    # leave next_operation=null while the watch is still live.
    next_operation = context["error"]["details"]["next_operation"]
    assert isinstance(next_operation, dict)
    assert next_operation["operation"] in {
        "progressive.status",
        "progressive.opening_bootstrap",
    }

def test_completed_watch_stale_projection_emits_explicit_refresh_card(
    tmp_path: Path, monkeypatch,
):
    """A completed watch whose whole-payload receipt drifted must never leave
    next_operation null: the gate re-issues the explicit projection card, and
    that card heals the pristine pre-delivery campaign."""
    monkeypatch.setenv("COC_DISABLE_QUEUE_WORKER", "1")
    ws = _opening_component_workspace(tmp_path)
    monkeypatch.setenv("COC_HOST", "codex")
    _gate4_project_opening_with_completed_watch(ws)
    monkeypatch.setenv("COC_HOST", "pi")

    _gate4_deepen_opening_pack(ws)

    blocked = _run(ws, "scene.map")
    assert blocked["ok"] is False, blocked
    assert blocked["error"]["code"] == "opening_setup_incomplete"
    details = blocked["error"]["details"]
    assert details["phase"] == "opening_source_materialization"
    next_operation = details["next_operation"]
    assert isinstance(next_operation, dict)
    assert next_operation["operation"] == "progressive.project_opening"
    assert next_operation["prefilled_arguments"]["start_location_id"] == "opening"

    refreshed = _run(
        ws, next_operation["operation"], next_operation["prefilled_arguments"],
    )
    assert refreshed["ok"] is True, refreshed
    assert refreshed["data"]["status"] == "complete"

    resumed = _run(ws, "scene.map")
    assert resumed["ok"] is True, resumed

def test_delivered_opening_still_refuses_genuine_content_anchor_staleness(
    tmp_path: Path, monkeypatch,
):
    """Post-delivery deepen must not brick play, but a genuinely stale content
    anchor still fails closed: the delivered scene's source evidence no longer
    matches the pinned receipt, so the gate blocks and re-projection over
    played state stays forbidden."""
    monkeypatch.setenv("COC_DISABLE_QUEUE_WORKER", "1")
    ws = _opening_component_workspace(tmp_path)
    monkeypatch.setenv("COC_HOST", "codex")
    _gate4_project_opening_with_completed_watch(ws)
    monkeypatch.setenv("COC_HOST", "pi")
    activated = _run(ws, "state.move_scene", {
        "scene_id": "opening",
        "decision_id": "gate4-stale-activation",
        "defer_initial_progressive_on_enter": True,
    })
    assert activated["ok"] is True, activated
    _gate4_deepen_opening_pack(ws)

    graph_path = ws["campaign_dir"] / "scenario" / "story-graph.json"
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    scene = next(
        row for row in graph["scenes"] if row["scene_id"] == "opening"
    )
    evidence = scene["source_evidence"]
    assert isinstance(evidence, dict)
    evidence["page_text_sha256"] = [
        "0" * 64 for _ in evidence["page_text_sha256"]
    ]
    _write_json(graph_path, graph)

    context = _run(ws, "scene.context")
    assert context["ok"] is False, context
    assert context["error"]["code"] == "opening_setup_incomplete"
    details = context["error"]["details"]
    assert details["phase"] == "opening_source_materialization"
    assert details["next_operation"]["operation"] == (
        "progressive.project_opening"
    )

    refused = _run(ws, "progressive.project_opening", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "start_location_id": "opening",
    })
    assert refused["ok"] is False
    assert refused["error"]["code"] == "opening_projection_non_pristine"

def test_pi_bound_source_hard_gates_play_until_opening_projection_is_current(
    tmp_path: Path, monkeypatch,
):
    ws = _opening_component_workspace(tmp_path)
    monkeypatch.setenv("COC_HOST", "pi")
    world_path = ws["campaign_dir"] / "save" / "world-state.json"
    world_before = world_path.read_bytes()

    blocked_calls = [
        ("session.begin", {"decision_id": "must-not-begin"}),
        ("scene.map", {}),
        (
            "state.move_scene",
            {
                "scene_id": "invented-intro",
                "decision_id": "must-not-move",
                "reason": "must not improvise before source opening",
            },
        ),
    ]
    retained_next_operation = None
    for operation, arguments in blocked_calls:
        blocked = _run(ws, operation, arguments)
        assert blocked["ok"] is False, blocked
        assert blocked["error"]["code"] == "opening_setup_incomplete"
        details = blocked["error"]["details"]
        assert details["hard_gate"] is True
        assert details["activation_allowed"] is False
        assert details["phase"] == "opening_selection"
        if retained_next_operation is None:
            retained_next_operation = details["next_operation"]
        assert details["next_operation"] == retained_next_operation
    assert retained_next_operation["operation"] == (
        "progressive.prepare_opening"
    )
    assert retained_next_operation["missing_arguments"] == []
    assert world_path.read_bytes() == world_before

    briefing = _run(ws, "setup.invoke", {
        "kind": "campaign.render_briefing",
        "payload": {
            "campaign_id": ws["campaign_id"],
            "language": "zh-Hans",
        },
    })
    assert briefing["ok"] is True, briefing
    assert briefing["data"]["schema_version"] == 1
    assert briefing["data"]["status"] == "PASS"
    assert briefing["data"]["kind"] == "campaign.render_briefing"
    assert briefing["data"]["result"]["campaign_id"] == ws["campaign_id"]
    assert (
        ws["workspace"] / briefing["data"]["result"]["briefing_path"]
    ).is_file()

    cash_assets = _run(ws, "rules.cash_assets", {"credit_rating": 20})
    assert cash_assets["ok"] is True, cash_assets
    assert cash_assets["data"]["credit_rating"] == 20

    # Skill 1 supplies the source-bound L0 before any investigator action.
    _scenario_path, staged_facts = _stage_reviewed_facts_transport(ws)
    adopted = _run(ws, "setup.adopt_source_facts", {
        "campaign_id": ws["campaign_id"],
        "facts": staged_facts,
    })
    assert adopted["ok"] is True, adopted
    assert adopted["data"]["result"]["module_init_ready"] is True
    assert adopted["data"]["result"]["character_creation_unblocked"] is True

    assignment_order = (
        "DEX", "INT", "POW", "EDU", "CON", "SIZ", "APP", "STR",
    )
    assigned_characteristics = dict(zip(
        assignment_order,
        (80, 70, 60, 60, 50, 50, 50, 40),
        strict=True,
    ))
    occupation_allocations = {
        "Credit Rating": 20, "Spot Hidden": 40, "Library Use": 40,
        "Psychology": 30, "Fast Talk": 30, "History": 40,
    }
    interest_allocations = {
        "Listen": 40, "Stealth": 40, "Occult": 30, "First Aid": 30,
    }
    skill_rules = coc_toolbox.coc_rules.load_rule_table("skills")
    required_skill_ids = set(
        skill_rules["standard_sheet"]["1920s"]["default_skill_ids"]
    ) | set(occupation_allocations) | set(interest_allocations)
    complete_skills = {}
    for skill_id, spec in skill_rules["skills"].items():
        if skill_id not in required_skill_ids:
            continue
        base = spec["base_chance"]
        if base == "half_DEX":
            base = assigned_characteristics["DEX"] // 2
        elif base == "EDU":
            base = assigned_characteristics["EDU"]
        complete_skills[skill_id] = (
            int(base)
            + occupation_allocations.get(skill_id, 0)
            + interest_allocations.get(skill_id, 0)
        )

    luck = _run(ws, "rules.roll_dice", {
        "expression": "3D6",
        "decision_id": "quick-fire-opening-setup-luck",
        "purpose": "investigator_creation_luck",
        "reason": "为开场调查员生成幸运值",
    })
    assert luck["ok"] is True, luck
    assert 3 <= luck["data"]["total"] <= 18
    quick_fire = _run(ws, "setup.invoke", {
        "kind": "investigator.create",
        "payload": {
            "campaign_id": ws["campaign_id"],
            "investigator_id": "opening-quick-fire",
            "sheet": {
                "id": "opening-quick-fire",
                "name": "Opening Quick Fire",
                "skills": complete_skills,
                "player_facing_sheet_zh": {
                    "display_name": "开场速建调查员",
                    "skills": [],
                },
            },
            "creation": {
                "input_mode": "guided_quick_fire",
                "method": "quick_fire_array",
                "characteristic_assignment_order": list(assignment_order),
                "luck_roll_total": luck["data"]["total"],
                "luck_roll_receipt": {
                    "campaign_id": ws["campaign_id"],
                    "decision_id": "quick-fire-opening-setup-luck",
                    "roll_id": luck["data"]["roll_id"],
                },
                "skill_budget": {
                    "occupation_points": {
                        "budget": 200,
                        "spent": 200,
                        "allocations": occupation_allocations,
                    },
                    "personal_interest_points": {
                        "budget": 140,
                        "spent": 140,
                        "allocations": interest_allocations,
                    },
                },
            },
        },
    })
    assert quick_fire["ok"] is True, quick_fire
    stored_quick_fire = json.loads(
        (
            ws["workspace"] / ".coc" / "investigators"
            / "opening-quick-fire" / "character.json"
        ).read_text(encoding="utf-8")
    )
    assert stored_quick_fire["derived"]["Luck"] == luck["data"]["total"] * 5
    assert sorted(stored_quick_fire["characteristics"].values()) == [
        40, 50, 50, 50, 60, 60, 70, 80,
    ]

    wrong_creation_dice = _run(ws, "rules.roll_dice", {
        "expression": "3D6",
        "decision_id": "not-the-canonical-creation-recipe",
        "purpose": "investigator_creation_luck",
        "reason": "ordinary random event",
    })
    assert wrong_creation_dice["ok"] is True
    played_check = _run(ws, "rules.roll", {
        "actor_id": "opening-quick-fire",
        "skill": "Spot Hidden",
        "target": 60,
        "decision_id": "must-not-play-before-opening",
    })
    assert played_check["ok"] is False
    assert played_check["error"]["code"] == "opening_setup_incomplete"

    prepared = _run(ws, "progressive.prepare_opening")
    assert prepared["ok"] is True, prepared
    bootstrap = prepared["data"]["next_operation"]
    assert bootstrap["operation"] == "progressive.opening_bootstrap"
    assert bootstrap["missing_arguments"] == [
        "start_location", "opening_pdf_indices",
    ]
    assert bootstrap["hard_gate"] is True

    # Component setup uses the canonical projection helpers directly; once
    # source-backed projection is current the same Pi play query is released.
    monkeypatch.setenv("COC_HOST", "codex")
    _publish_and_project_opening_component(ws)
    monkeypatch.setenv("COC_HOST", "pi")
    released = _run(ws, "scene.map")
    assert released["ok"] is True, released

def test_pi_reviewed_facts_transport_replays_before_selection_and_consumes(
    tmp_path: Path, monkeypatch,
):
    ws = _opening_component_workspace(tmp_path)
    scenario_path = ws["campaign_dir"] / "scenario" / "scenario.json"
    scenario = json.loads(scenario_path.read_text(encoding="utf-8"))
    scenario.update({
        "scenario_id": ws["asset_root_id"],
        "opening_source_provenance": "selection_hint_only_not_provenance",
    })
    scenario["source"]["source_bundle_path"] = str(
        ws["workspace"] / "opening-source"
    )
    _install_opening_review_task(ws, scenario)
    _write_json(scenario_path, scenario)
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
    receipt = coc_toolbox.coc_runtime_ops._build_opening_source_review_fulfillment(
        ws["workspace"],
        continuation=continuation,
        status="reviewed",
        selected_opening_pdf_indices=[0],
    )
    facts = _minimal_opening_source_facts("pdf:opening-component")
    coc_toolbox.coc_runtime_ops._apply_opening_source_review_fulfillment(
        ws["workspace"], receipt, source_facts=facts,
    )
    persisted = json.loads(scenario_path.read_text(encoding="utf-8"))
    transport = persisted["opening_source_facts_transport"]
    assert set(transport) == {
        "schema_version", "contract_id", "status", "campaign_id",
        "scenario_id", "opening_review_generation", "source_id",
        "file_sha256", "bundle_sha256", "review_receipt_sha256",
        "facts_sha256", "facts",
    }
    assert transport["facts"] == facts
    persisted_text = json.dumps(persisted)
    for forbidden in ("raw_excerpt", "grep_anchors", "reasoning", "page_text"):
        assert forbidden not in json.dumps(transport)

    monkeypatch.setenv("COC_HOST", "pi")
    resumed = _run(ws, "session.resume")
    assert resumed["ok"] is False
    gate = resumed["error"]["details"]
    assert gate["phase"] == "opening_source_facts_adoption_required"
    card = gate["next_operation"]
    assert card == {
        "operation": "setup.adopt_source_facts",
        "invoke_via": "coc_invoke",
        "campaign": ws["campaign_id"],
        "arguments": {"campaign_id": ws["campaign_id"], "facts": facts},
    }
    blocked = _run(ws, "progressive.prepare_opening")
    assert blocked["ok"] is False
    assert blocked["error"]["details"]["phase"] == (
        "opening_source_facts_adoption_required"
    )

    original_adopt_source_era = (
        coc_toolbox.coc_runtime_ops.coc_module_project.adopt_source_era
    )
    monkeypatch.setattr(
        coc_toolbox.coc_runtime_ops.coc_module_project,
        "adopt_source_era",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            RuntimeError("injected era side-effect failure")
        ),
    )
    with pytest.raises(RuntimeError, match="injected era side-effect failure"):
        _run(ws, "setup.adopt_source_facts", card["arguments"])
    assert "opening_source_facts_transport" in json.loads(
        scenario_path.read_text(encoding="utf-8")
    )
    resumed_partial = _run(ws, "session.resume")
    assert resumed_partial["error"]["details"]["phase"] == (
        "opening_source_facts_adoption_required"
    )
    monkeypatch.setattr(
        coc_toolbox.coc_runtime_ops.coc_module_project,
        "adopt_source_era",
        original_adopt_source_era,
    )

    wrong = deepcopy(facts)
    wrong["place"]["value"] = "Arkham"
    rejected = _run(ws, "setup.adopt_source_facts", {
        "campaign_id": ws["campaign_id"], "facts": wrong,
    })
    assert rejected["ok"] is False
    assert rejected["error"]["details"]["phase"] == (
        "opening_source_facts_adoption_required"
    )
    assert "opening_source_facts_transport" in json.loads(
        scenario_path.read_text(encoding="utf-8")
    )
    with pytest.raises(
        coc_toolbox.coc_runtime_ops.RuntimeOperationError,
        match="does not match the current pending",
    ):
        coc_toolbox.coc_runtime_ops.execute_setup_operation(
            ws["workspace"],
            operation={
                "schema_version": 1,
                "kind": "campaign.adopt_source_facts",
                "payload": {
                    "campaign_id": ws["campaign_id"], "facts": wrong,
                },
            },
        )

    adopted = _run(ws, "setup.adopt_source_facts", card["arguments"])
    assert adopted["ok"] is True, adopted
    after = json.loads(scenario_path.read_text(encoding="utf-8"))
    assert "opening_source_facts_transport" not in after
    restarted = _run(ws, "session.resume")
    assert restarted["ok"] is False
    assert restarted["error"]["details"]["phase"] == "opening_selection"

def test_pi_fast_locator_provenance_cannot_become_a_playable_opening(
    tmp_path: Path, monkeypatch,
):
    ws = _opening_component_workspace(tmp_path, source_page_count=34)
    scenario_path = ws["campaign_dir"] / "scenario" / "scenario.json"
    scenario = json.loads(scenario_path.read_text(encoding="utf-8"))
    scenario["opening_source_provenance"] = (
        "selection_hint_only_not_provenance"
    )
    scenario["scenario_id"] = ws["asset_root_id"]
    scenario["source"]["source_bundle_path"] = str(
        ws["workspace"] / "opening-source"
    )
    scenario["source"].pop("opening_source_provenance", None)
    _install_opening_review_task(ws, scenario)
    _write_json(scenario_path, scenario)
    monkeypatch.setenv("COC_HOST", "pi")

    for operation, arguments in (
        ("progressive.prepare_opening", {}),
        (
            "progressive.opening_bootstrap",
            {
                "start_location": {
                    "location_id": "false-opening",
                    "title": "Premise hint",
                },
                "opening_pdf_indices": [0],
            },
        ),
        (
            "progressive.project_opening",
            {
                "asset_root_id": ws["asset_root_id"],
                "source_file_sha256": ws["file_sha256"],
                "start_location_id": "false-opening",
                "opening_pdf_indices": [0],
            },
        ),
        (
            "evidence.table_opening",
            {
                "text": "不得从快速提示虚构开场。",
                "run_id": "fast-hint-bypass",
                "presented_roll_ids": [],
                "decision_id": "fast-hint-bypass",
            },
        ),
    ):
        blocked = _run(ws, operation, arguments)
        assert blocked["ok"] is False, blocked
        assert blocked["error"]["code"] == "opening_setup_incomplete"
        gate = blocked["error"]["details"]
        assert gate["phase"] == "opening_source_review_required"
        assert gate["source_provenance"] == (
            "selection_hint_only_not_provenance"
        )
        assert gate["required_source_owner"] == (
            "coc-opening-source-coordinator"
        )
        assert gate["next_operation"] is None

    _write_json(ws["campaign_dir"] / "party.json", {
        "schema_version": 1,
        "campaign_id": ws["campaign_id"],
        "investigator_ids": ["linked-investigator"],
        "active_investigator_ids": ["linked-investigator"],
    })
    _write_current_imported_investigator(
        ws["workspace"] / ".coc", "linked-investigator",
    )
    after_character = _run(ws, "progressive.project_opening", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "start_location_id": "false-opening",
        "opening_pdf_indices": [0],
    })
    assert after_character["ok"] is False
    assert after_character["error"]["details"][
        "character_setup_complete"
    ] is True
    restarted = _run(ws, "session.resume")
    assert restarted["ok"] is False
    assert restarted["error"]["details"]["phase"] == (
        "opening_source_review_required"
    )
    assert restarted["error"]["details"]["character_setup_complete"] is True

    continuation = {
        "schema_version": 1,
        "contract_id": "coc.opening-source-continue.v1",
        "campaign_id": ws["campaign_id"],
        "scenario_id": scenario["scenario_id"],
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
    identity_forgery = deepcopy(review_receipt)
    identity_forgery["coordinator_task_identity_sha256"] = (
        "sha256:" + ("0" * 64)
    )
    with pytest.raises(
        coc_toolbox.coc_runtime_ops.RuntimeOperationError,
        match="does not match pending task",
    ):
        coc_toolbox.coc_runtime_ops._apply_opening_source_review_fulfillment(
            ws["workspace"], identity_forgery,
        )
    scope_forgery = deepcopy(review_receipt)
    scope_forgery["source_scope"]["pdf_indices"] = [1]
    with pytest.raises(
        coc_toolbox.coc_runtime_ops.RuntimeOperationError,
        match="scope is invalid",
    ):
        coc_toolbox.coc_runtime_ops._apply_opening_source_review_fulfillment(
            ws["workspace"], scope_forgery,
        )
    coc_toolbox.coc_runtime_ops._apply_opening_source_review_fulfillment(
        ws["workspace"], review_receipt,
    )
    consumed = json.loads(scenario_path.read_text(encoding="utf-8"))
    assert consumed["opening_source_review_task"]["status"] == "fulfilled"
    assert consumed["opening_source_review_task"][
        "terminal_receipt_sha256"
    ].startswith("sha256:")
    resumed_after_review = _run(ws, "session.resume")
    assert resumed_after_review["ok"] is False
    assert resumed_after_review["error"]["details"]["phase"] == (
        "opening_selection"
    )
    reviewed = _run(ws, "progressive.prepare_opening")
    assert reviewed["ok"] is True, reviewed
    assert reviewed["data"]["next_operation"]["operation"] == (
        "progressive.opening_bootstrap"
    )

def test_pi_reviewed_provenance_requires_receipt_and_matching_copies(
    tmp_path: Path, monkeypatch,
):
    ws = _opening_component_workspace(tmp_path)
    scenario_path = ws["campaign_dir"] / "scenario" / "scenario.json"
    scenario = json.loads(scenario_path.read_text(encoding="utf-8"))
    monkeypatch.setenv("COC_HOST", "pi")

    scenario["opening_source_provenance"] = (
        "coordinator_reviewed_playable_opening"
    )
    scenario["source"].pop("opening_source_provenance", None)
    scenario.pop("opening_source_review_receipt", None)
    _write_json(scenario_path, scenario)
    forged = _run(ws, "progressive.prepare_opening")
    assert forged["ok"] is False
    assert forged["error"]["details"]["source_contract_error"]["code"] == (
        "opening_source_review_receipt_invalid"
    )

    scenario["source"]["opening_source_provenance"] = (
        "selection_hint_only_not_provenance"
    )
    _write_json(scenario_path, scenario)
    mismatched = _run(ws, "session.resume")
    assert mismatched["ok"] is False
    assert mismatched["error"]["details"]["source_contract_error"]["code"] == (
        "opening_source_provenance_mismatch"
    )

def test_pi_opening_coordinator_terminal_failure_survives_restart(
    tmp_path: Path, monkeypatch,
):
    ws = _opening_component_workspace(tmp_path)
    scenario_path = ws["campaign_dir"] / "scenario" / "scenario.json"
    scenario = json.loads(scenario_path.read_text(encoding="utf-8"))
    scenario["opening_source_provenance"] = (
        "selection_hint_only_not_provenance"
    )
    scenario["scenario_id"] = ws["asset_root_id"]
    scenario["source"]["source_bundle_path"] = str(
        ws["workspace"] / "opening-source"
    )
    scenario["source"].pop("opening_source_provenance", None)
    _install_opening_review_task(ws, scenario)
    _write_json(scenario_path, scenario)
    monkeypatch.setenv("COC_HOST", "pi")
    failure_receipt = (
        coc_toolbox.coc_runtime_ops
        ._build_opening_source_review_transport_failure(
            ws["workspace"],
            campaign_id=ws["campaign_id"],
            scenario_id=scenario["scenario_id"],
            failure_class="pdf_scope_failed",
            error_code="missing_reviewed_window",
        )
    )
    coc_toolbox.coc_runtime_ops._apply_opening_source_review_fulfillment(
        ws["workspace"], failure_receipt,
    )
    failed_state = json.loads(scenario_path.read_text(encoding="utf-8"))
    assert failed_state["opening_source_review_task"]["status"] == "failed"
    with pytest.raises(
        coc_toolbox.coc_runtime_ops.RuntimeOperationError,
        match="task authority is invalid",
    ):
        coc_toolbox.coc_runtime_ops._apply_opening_source_review_fulfillment(
            ws["workspace"], failure_receipt,
        )

    for operation in ("session.resume", "scene.map"):
        terminal = _run(ws, operation)
        assert terminal["ok"] is False
        assert terminal["error"]["code"] == "opening_setup_incomplete"
        details = terminal["error"]["details"]
        assert details["phase"] == "opening_source_review_failed"
        assert details["status"] == "failed"
        assert details["next_operation"] is None
        assert details["source_review_failure"]["failure_class"] == (
            "pdf_scope_failed"
        )
        assert details["source_review_failure"]["receipt_sha256"].startswith(
            "sha256:"
        )

def test_opening_component_publish_project_prepare_and_initial_defer(
    tmp_path: Path, monkeypatch,
):
    monkeypatch.setenv("COC_DISABLE_QUEUE_WORKER", "1")
    ws = _opening_component_workspace(tmp_path)
    published = _run(ws, "progressive.publish_skeleton", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "skeleton": ws["skeleton"],
    })
    assert published["ok"] is True, published
    assert published["data"]["status"] == "complete"
    assert published["data"]["stored"] is True
    assert published["data"]["projected"] is True

    assets = coc_toolbox.coc_module_project.coc_module_assets
    assets.put_entity(
        ws["workspace"], ws["asset_root_id"], "location", "opening", {
            "location_id": "opening",
            "title": "Opening",
            "parse_state": "deep",
            "evidence_gap": False,
            "source_page_indices": [0],
            "player_safe_summary": "A bounded player-safe opening.",
            "dramatic_question": "What will the investigators do?",
            "scene_type": "investigation",
            "available_clue_ids": [],
            "npc_ids": [],
            "clues": [],
            "npcs": [],
            "keeper_secret_refs": [],
            "scene_edges": [],
            "affordances": [{
                "id": "inspect",
                "cue": "Inspect the room",
                "route_type": "investigative_lead",
                "status": "open",
            }],
            "pressure_moves": [],
            "tone": ["quiet"],
        },
    )
    projected = _run(ws, "progressive.project_opening", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "start_location_id": "opening",
    })
    assert projected["ok"] is True, projected
    assert projected["data"]["status"] == "complete"
    assert projected["data"]["activation_operation"] == {
        "operation": "state.move_scene",
        "invoke_via": "coc_invoke",
        "prefilled_arguments": {
            "scene_id": "opening",
            "defer_initial_progressive_on_enter": True,
        },
        "missing_arguments": ["decision_id"],
        "authority": "advisory",
        "hard_gate": False,
    }

    prepared = _run(ws, "progressive.prepare_opening")
    assert prepared["ok"] is True
    assert prepared["data"]["ready_to_activate"] is True
    assert prepared["data"]["opening_ready"] is False
    assert prepared["data"]["encoded_data_bytes"] <= (
        prepared["data"]["encoded_data_budget_bytes"]
    )
    activation = next(
        card for card in prepared["data"]["mutation_cards"]
        if card["operation"] == "state.move_scene"
    )
    assert activation["prefilled_arguments"] == {
        "scene_id": "opening",
        "defer_initial_progressive_on_enter": True,
    }
    assert activation == projected["data"]["activation_operation"]

    on_enter_calls = []
    monkeypatch.setattr(
        coc_toolbox.coc_module_project,
        "on_enter_scene",
        lambda *_args, **_kwargs: on_enter_calls.append(True),
    )
    moved = _run(ws, "state.move_scene", {
        "scene_id": "opening",
        "reason": "begin authored opening",
        "decision_id": "opening-initial-move",
        "defer_initial_progressive_on_enter": True,
    })
    assert moved["ok"] is True, moved
    assert moved["data"]["progressive"] == {
        "on_enter_deferred": True,
        "deferred_operation": "progressive.on_enter_scene",
        "resume_available": False,
        "scope": "entire_initial_progressive_on_enter_hook",
    }
    assert on_enter_calls == []
    late_projection = _run(ws, "progressive.project_opening", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "start_location_id": "opening",
    })
    assert late_projection["ok"] is True, late_projection
    assert late_projection["data"]["status"] == "current"
    assert "activation_operation" not in late_projection["data"]
    replay = _run(ws, "state.move_scene", {
        "scene_id": "opening",
        "reason": "begin authored opening",
        "decision_id": "opening-initial-move",
        "defer_initial_progressive_on_enter": True,
    })
    assert replay["ok"] is True
    assert replay["data"] == moved["data"]
    assert on_enter_calls == []

def test_mechanics_locator_vertical_is_exact_nonblocking_and_reused(
    tmp_path: Path, monkeypatch,
):
    monkeypatch.setenv("COC_DISABLE_QUEUE_WORKER", "1")
    ws = _opening_component_workspace(tmp_path, extra_pdf_indices=(1, 2))
    appendix_page = coc_toolbox.coc_module_project.coc_module_assets.get_page(
        ws["workspace"], ws["asset_root_id"], 2,
    )
    appendix_meta = appendix_page["meta"]
    appendix_ref = {
        "source_id": appendix_meta["source_id"],
        "pdf_index": 2,
        "text_sha256": appendix_meta["text_sha256"],
    }
    ws["skeleton"]["npc_roster"] = [{
        "npc_id": "lucas-strong",
        "names": ["Lucas Strong"],
        "parse_state": "partial",
        "agenda": "Protect Jane without losing face.",
        # A narrative roster row and its mechanics locator may legitimately
        # bind the same accepted page; the aggregate scope must carry it once.
        "source_page_indices": [2],
        "source_refs": [appendix_ref],
    }]
    published = _run(ws, "progressive.publish_skeleton", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "skeleton": ws["skeleton"],
    })
    assert published["ok"] is True, published
    assets = coc_toolbox.coc_module_project.coc_module_assets
    real_get_page = assets.get_page
    page_body_reads: list[int] = []

    def observe_page_read(workspace, asset_root_id, pdf_index):
        page_body_reads.append(pdf_index)
        return real_get_page(workspace, asset_root_id, pdf_index)

    monkeypatch.setattr(assets, "get_page", observe_page_read)
    planned = _run(ws, "progressive.prepare_opening")
    assert planned["ok"] is True, planned
    data = planned["data"]
    assert {row["pdf_index"] for row in data["mechanics_locator_page_candidates"]} == {
        0, 1, 2,
    }
    # Opening binding may verify its own page; the locator catalog must not
    # read candidate appendix bodies 1 or 2.
    assert set(page_body_reads) <= {0}
    locator_card = next(
        card for card in data["mutation_cards"]
        if card["operation"] == "progressive.request_locator_pass"
    )
    assert locator_card["missing_arguments"] == [
        "mechanics_locator_pdf_indices",
    ]
    assert locator_card["required_for_opening"] is False
    assert locator_card["hard_gate"] is False
    baseline_readiness = {
        key: data[key] for key in (
            "blocking", "hard_work", "ready_to_activate", "opening_ready",
        )
    }
    monkeypatch.setattr(assets, "get_page", real_get_page)
    selected = _run(ws, "progressive.prepare_opening", {
        "mechanics_locator_pdf_indices": [1, 2],
    })
    assert selected["ok"] is True, selected
    assert {
        key: selected["data"][key] for key in baseline_readiness
    } == baseline_readiness
    selected_card = next(
        card for card in selected["data"]["mutation_cards"]
        if card["operation"] == "progressive.request_locator_pass"
    )
    assert selected_card["prefilled_arguments"][
        "mechanics_locator_pdf_indices"
    ] == [1, 2]

    foreign = _run(ws, "progressive.request_locator_pass", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "mechanics_locator_pdf_indices": [3],
        "request_purpose": "mechanics_locator_pass",
    })
    assert foreign["ok"] is False
    assert foreign["error"]["code"] == "mechanics_locator_source_window_invalid"
    requested = _run(ws, "progressive.request_locator_pass", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "mechanics_locator_pdf_indices": [1, 2],
        "request_purpose": "mechanics_locator_pass",
    })
    repeated = _run(ws, "progressive.request_locator_pass", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "mechanics_locator_pdf_indices": [1, 2],
        "request_purpose": "mechanics_locator_pass",
    })
    assert requested["ok"] is True, requested
    assert repeated["ok"] is True, repeated
    assert repeated["data"]["status"] == "coalesced"
    assert repeated["data"]["job_id"] == requested["data"]["job_id"]
    worker = coc_toolbox.coc_module_project._load_sibling(
        "coc_module_queue_worker_locator_vertical",
        "coc_module_queue_worker.py",
    )
    materialized = worker.run_worker_once(ws["workspace"], parallel=1)
    assert materialized["claimed"] == 1
    host_request = assets.list_host_work_requests(
        ws["workspace"], ws["asset_root_id"], include_closed=True, limit=None,
    )[0]
    assert host_request["kind"] == "locate_mechanics_index"
    assert host_request["requested_pdf_indices"] == [1, 2]
    assert host_request["source_aspect"] == "mechanics"
    assert host_request["deadline_class"] == "idle_warm"
    claimed = _run(ws, "progressive.claim_host_work", {
        "executor_id": "locator-test-host", "limit": 1,
    })
    assert claimed["ok"] is True, claimed
    task = claimed["data"]["dispatch_tasks"][0]
    assert task["contract_id"] == "coc.codex-source-pack-task.v1"
    assert task["model_policy"] == "inherit_parent"
    assert Path(task["instruction_ref"]) == (
        REPO / "plugins/coc-keeper/agents/coc-source-pack-worker.md"
    ).resolve()
    packet = task["packet"]
    assert packet["contract_id"] == "coc.source-pack-worker.v1"
    assert packet["requested_pdf_indices"] == [1, 2]
    assert packet["source_aspect"] == "mechanics"
    assert packet["deadline_class"] == "idle_warm"
    assert packet["result_delivery"] == "named_submit"
    request = packet["requests"][0]
    assert request["result_contract"]["contract_id"] == (
        "coc.mechanics-locator-pack.v1"
    )
    result_pack_contract = request["result_contract"]["pack"]
    assert result_pack_contract["required_fields"] == (
        result_pack_contract["allowed_fields"]
    )
    assert result_pack_contract["npc_roster_row"]["allowed_fields"] == [
        "npc_id", "names", "parse_state", "source_page_indices", "source_refs",
    ]
    assert result_pack_contract["npc_roster_row"]["required_fields"] == (
        result_pack_contract["npc_roster_row"]["allowed_fields"]
    )
    assert result_pack_contract["npc_roster_row"]["names_semantics"] == (
        "aliases_for_one_subject_only"
    )
    assert result_pack_contract["npc_roster_row"][
        "shared_stat_block_policy"
    ] == {
        "distinct_named_people": "separate_stable_npc_ids",
        "required_rows_per_person": ["npc_roster", "mechanics_index"],
        "may_reuse_exact_fields": [
            "source_page_indices", "source_refs", "locator_scope",
        ],
        "merge_identity_into_compound_subject": False,
    }
    instruction = request["instruction"]
    for phrase in (
        "every distinct named person",
        "separate stable npc_id",
        "exact source_page_indices, source_refs, and locator_scope",
        "names holds aliases for one subject only",
        "never forms a compound identity",
    ):
        assert phrase in instruction, phrase
    assert result_pack_contract["mechanics_index_row"]["required_fields"] == (
        result_pack_contract["mechanics_index_row"]["allowed_fields"]
    )
    assert any(
        "dramatis_personae_entry_only" in reason
        for reason in result_pack_contract["mechanics_index_row"][
            "does_not_establish_located"
        ]
    )
    assert request["result_contract"]["no_located_subject_result"] == {
        "status": "usable",
        "copy_pack_fixed_fields": True,
        "npc_roster": [],
        "item_roster": [],
        "mechanics_index": [],
        "related_packs": [],
    }
    locator_rules = request["result_contract"]["rules"]
    assert any("every distinct named person" in rule for rule in locator_rules)
    assert any("aliases for one subject only" in rule for rule in locator_rules)
    refs = {
        int(ref["pdf_index"]): {
            "source_id": ref["source_id"],
            "pdf_index": int(ref["pdf_index"]),
            "text_sha256": ref["text_sha256"],
        }
        for ref in request["cached_page_refs"]
    }
    locator_scope = {
        "scope_kind": "explicit_pdf_indices",
        "pdf_indices": [1, 2],
        "source_file_sha256": ws["file_sha256"],
    }

    def npc_row(npc_id: str, names: str | list[str]) -> dict:
        return {
            "npc_id": npc_id,
            "names": [names] if isinstance(names, str) else list(names),
            "parse_state": "named_only",
            "source_page_indices": [2],
            "source_refs": [refs[2]],
        }

    def locator_row(npc_id: str) -> dict:
        return {
            "subject_kind": "npc",
            "subject_id": npc_id,
            "status": "located",
            "locator_pass_status": "complete",
            "locator_scope": locator_scope,
            "source_page_indices": [2],
            "source_refs": [refs[2]],
        }

    locator_pack = {
        "mechanics_locator_pass_status": "pending",
        "mechanics_locator_scope": locator_scope,
        "npc_roster": [
            npc_row("lucas-strong", "Lucas Strong"),
            npc_row("jane-strong", "Jane Strong"),
            npc_row("joseph-turner", "Joseph Turner"),
            npc_row("shared-block-one", "First Distinct Person"),
            npc_row("shared-block-two", "Second Distinct Person"),
            npc_row(
                "one-person-with-aliases",
                ["One Person", "The Same Person's Alias"],
            ),
            npc_row("appendix-person-seven", "Seventh Person"),
            npc_row("appendix-person-eight", "Eighth Person"),
            npc_row("appendix-person-nine", "Ninth Person"),
        ],
        "item_roster": [],
        "mechanics_index": [
            locator_row("lucas-strong"),
            locator_row("jane-strong"),
            locator_row("joseph-turner"),
            locator_row("shared-block-one"),
            locator_row("shared-block-two"),
            locator_row("one-person-with-aliases"),
            locator_row("appendix-person-seven"),
            locator_row("appendix-person-eight"),
            locator_row("appendix-person-nine"),
        ],
    }
    skeleton_path = (
        ws["workspace"] / ".coc" / "module-assets" / ws["asset_root_id"]
        / "skeleton.json"
    )
    before_invalid = skeleton_path.read_bytes()
    invalid_pack = deepcopy(locator_pack)
    invalid_pack["npc_roster"][0]["name"] = invalid_pack[
        "npc_roster"
    ][0].pop("names")[0]
    invalid_pack["npc_roster"][0].pop("source_refs")
    rejected = _run(ws, "progressive.fulfill_host_work", {
        "job_id": request["job_id"],
        "pack": invalid_pack,
        "related_packs": [],
    })
    assert rejected["ok"] is False
    assert rejected["error"]["code"] == "invalid_source_worker_pack"
    assert len(rejected["hints"]) == 1
    assert "must not repair or rewrite" in rejected["hints"][0]
    assert "leave the request unfulfilled" in rejected["hints"][0]
    assert "call describe for the tool schema" not in rejected["hints"][0]
    assert skeleton_path.read_bytes() == before_invalid
    still_open = next(
        row for row in assets.list_host_work_requests(
            ws["workspace"], ws["asset_root_id"], include_closed=True, limit=None,
        )
        if row["job_id"] == request["job_id"]
    )
    assert still_open["status"] != "fulfilled"

    roster_without_locator = deepcopy(locator_pack)
    roster_without_locator["npc_roster"].append(
        npc_row("dramatis-personae-only", "Dramatis Personae Only")
    )
    rejected_roster = _run(ws, "progressive.fulfill_host_work", {
        "job_id": request["job_id"],
        "pack": roster_without_locator,
        "related_packs": [],
    })
    assert rejected_roster["error"]["code"] == "invalid_source_worker_pack"
    assert skeleton_path.read_bytes() == before_invalid

    scope_mismatch = deepcopy(locator_pack)
    scope_mismatch["mechanics_index"][0]["source_page_indices"] = [0]
    scope_mismatch["mechanics_index"][0]["source_refs"] = [refs[2]]
    rejected_scope = _run(ws, "progressive.fulfill_host_work", {
        "job_id": request["job_id"],
        "pack": scope_mismatch,
        "related_packs": [],
    })
    assert rejected_scope["error"]["code"] == "invalid_source_worker_pack"
    assert skeleton_path.read_bytes() == before_invalid

    # The host forwards the complete child item as one exact envelope.  A
    # historically observed parent copy error that nests related_packs inside
    # pack remains a strict child-pack failure; the receiver does not repair it.
    polluted_pack = deepcopy(locator_pack)
    polluted_pack["related_packs"] = []
    polluted_result = {
        "job_id": request["job_id"],
        "pack": polluted_pack,
        "related_packs": [],
    }
    polluted_before = deepcopy(polluted_result)
    direct_base = {
        "schema_version": 1,
        "contract_id": "coc.source-pack-worker.v1",
        "packet_id": packet["packet_id"],
        "work_group_id": packet["work_group_id"],
        "status": "usable",
        "results": [polluted_result],
    }
    with pytest.raises(coc_toolbox.ToolError) as wrong_packet:
        coc_toolbox.submit_source_worker_result(ws["workspace"], {
            **deepcopy(direct_base), "packet_id": "not-the-leased-packet",
        })
    assert wrong_packet.value.code == "invalid_source_lease"
    with pytest.raises(coc_toolbox.ToolError) as wrong_group:
        coc_toolbox.submit_source_worker_result(ws["workspace"], {
            **deepcopy(direct_base), "work_group_id": "not-the-leased-group",
        })
    assert wrong_group.value.code == "invalid_source_lease"
    wrong_jobs = deepcopy(direct_base)
    wrong_jobs["results"][0]["job_id"] = "not-the-leased-job"
    with pytest.raises(coc_toolbox.ToolError) as wrong_job_set:
        coc_toolbox.submit_source_worker_result(ws["workspace"], wrong_jobs)
    assert wrong_job_set.value.code == "invalid_source_lease"
    with monkeypatch.context() as expired_lease:
        expired_lease.setattr(assets, "_lease_is_expired", lambda *_args: True)
        with pytest.raises(coc_toolbox.ToolError) as expired_packet:
            coc_toolbox.submit_source_worker_result(
                ws["workspace"], deepcopy(direct_base),
            )
    assert expired_packet.value.code == "invalid_source_lease"

    rejected_polluted = coc_toolbox.submit_source_worker_result(
        ws["workspace"], direct_base,
    )
    assert rejected_polluted["ok"] is False
    assert rejected_polluted["error"]["code"] == "invalid_source_worker_pack"
    assert "unsupported fields" in rejected_polluted["error"]["message"]
    assert polluted_result == polluted_before
    assert skeleton_path.read_bytes() == before_invalid

    canonical_result = {
        "job_id": request["job_id"],
        "pack": locator_pack,
        "related_packs": [],
    }
    mixed = _run(ws, "progressive.fulfill_host_work", {
        "worker_result": canonical_result,
        "pack": locator_pack,
    })
    assert mixed["ok"] is False
    assert mixed["error"]["code"] == "invalid_param"
    assert "mutually exclusive" in mixed["error"]["message"]
    assert skeleton_path.read_bytes() == before_invalid

    canonical_before = deepcopy(canonical_result)
    fulfilled = coc_toolbox.submit_source_worker_result(ws["workspace"], {
        **deepcopy(direct_base), "results": [canonical_result],
    })
    assert fulfilled["ok"] is True, fulfilled
    assert fulfilled["contract_id"] == "coc.source-submit-receipt.v1"
    assert fulfilled["packet_id"] == packet["packet_id"]
    assert fulfilled["lease_id"] == packet["packet_id"]
    assert fulfilled["work_group_id"] == packet["work_group_id"]
    assert fulfilled["asset_root_id"] == ws["asset_root_id"]
    assert fulfilled["submission_digest"]
    assert fulfilled["job_receipts"] == [{
        "job_id": request["job_id"],
        "ok": True,
        "request_status": "fulfilled",
        "fulfillment_digest": fulfilled["job_receipts"][0][
            "fulfillment_digest"
        ],
    }]
    assert fulfilled["job_receipts"][0]["fulfillment_digest"]
    assert canonical_result == canonical_before
    stored = assets.get_skeleton(ws["workspace"], ws["asset_root_id"])
    assert stored["locations"] == ws["skeleton"]["locations"]
    assert stored["npc_roster"][0] == ws["skeleton"]["npc_roster"][0]
    assert {row["npc_id"] for row in stored["npc_roster"]} == {
        "lucas-strong", "jane-strong", "joseph-turner",
        "shared-block-one", "shared-block-two", "one-person-with-aliases",
        "appendix-person-seven", "appendix-person-eight", "appendix-person-nine",
    }
    stored_roster = {
        row["npc_id"]: row for row in stored["npc_roster"]
    }
    assert stored_roster["shared-block-one"]["source_refs"] == (
        stored_roster["shared-block-two"]["source_refs"]
    )
    assert stored_roster["one-person-with-aliases"]["names"] == [
        "One Person", "The Same Person's Alias",
    ]
    assert stored["mechanics_locator_pass_status"] == "pending"
    assert {
        (row["subject_kind"], row["subject_id"])
        for row in stored["mechanics_index"]
    } == {
        ("npc", "lucas-strong"),
        ("npc", "jane-strong"),
        ("npc", "joseph-turner"),
        ("npc", "shared-block-one"),
        ("npc", "shared-block-two"),
        ("npc", "one-person-with-aliases"),
        ("npc", "appendix-person-seven"),
        ("npc", "appendix-person-eight"),
        ("npc", "appendix-person-nine"),
    }
    stored_index = {
        row["subject_id"]: row for row in stored["mechanics_index"]
    }
    assert stored_index["shared-block-one"]["locator_scope"] == (
        stored_index["shared-block-two"]["locator_scope"]
    )
    closed_request = next(
        row for row in assets.list_host_work_requests(
            ws["workspace"], ws["asset_root_id"], include_closed=True, limit=None,
        )
        if row["job_id"] == request["job_id"]
    )
    assert closed_request["status"] == "fulfilled"

    first_mechanics = _run(ws, "mechanics.ensure", {
        "subject_kind": "npc",
        "subject_id": "lucas-strong",
        "purpose": "check",
        "decision_id": "locator-lucas-first",
    })
    repeated_mechanics = _run(ws, "mechanics.ensure", {
        "subject_kind": "npc",
        "subject_id": "lucas-strong",
        "purpose": "check",
        "decision_id": "locator-lucas-repeat",
    })
    assert first_mechanics["ok"] is True, first_mechanics
    assert first_mechanics["data"]["status"] == "source_work_required"
    assert first_mechanics["data"]["source_work"]["stub"]["entity"][
        "source_page_indices"
    ] == [2]
    assert repeated_mechanics["data"]["source_work"]["enqueue"]["enqueued"] is False
    mechanics_materialized = worker.run_worker_once(ws["workspace"], parallel=1)
    mechanics_request = json.loads(Path(
        mechanics_materialized["results"][0]["host_work_request"]
    ).read_text(encoding="utf-8"))
    assert mechanics_request["requested_pdf_indices"] == [2]
    assert {
        (row["subject_kind"], row["subject_id"])
        for row in mechanics_request["batch_subjects"]
    } == {
        ("npc", "lucas-strong"),
        ("npc", "jane-strong"),
        ("npc", "joseph-turner"),
        ("npc", "shared-block-one"),
        ("npc", "shared-block-two"),
        ("npc", "one-person-with-aliases"),
        ("npc", "appendix-person-seven"),
        ("npc", "appendix-person-eight"),
        ("npc", "appendix-person-nine"),
    }

def test_missing_mechanics_locator_returns_read_only_discovery_card(
    tmp_path: Path, monkeypatch,
):
    monkeypatch.setenv("COC_DISABLE_QUEUE_WORKER", "1")
    ws = _opening_component_workspace(tmp_path)
    ws["skeleton"]["npc_roster"] = [{
        "npc_id": "lucas-strong",
        "names": ["Lucas Strong"],
        "parse_state": "partial",
        "agenda": "Protect Jane without losing face.",
        "source_page_indices": [0],
    }]
    published = _run(ws, "progressive.publish_skeleton", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "skeleton": ws["skeleton"],
    })
    assert published["ok"] is True, published

    requested = _run(ws, "progressive.request_mechanics", {
        "kind": "npc",
        "target_id": "lucas-strong",
        "title": "Lucas Strong",
        "reason": "opposed_strength_check",
    })
    assert requested["ok"] is True, requested
    request_data = requested["data"]
    assert request_data["mechanics_locator_state"] == {
        "global_pass_status": "pending",
        "subject_locator_status": "missing",
        "narrative_body_refs_present": True,
        "narrative_body_refs_are_mechanics_locator": False,
    }
    locator_card = request_data["locator_discovery_operation"]
    assert locator_card == {
        "operation": "progressive.prepare_opening",
        "invoke_via": "coc_invoke",
        "prefilled_arguments": {},
        "missing_arguments": [],
        "authority": "advisory",
        "hard_gate": False,
        "read_only": True,
        "required_for_opening": False,
        "purpose": "discover_mechanics_locator_window",
    }
    assert "mechanics_locator_pdf_indices" not in locator_card[
        "prefilled_arguments"
    ]

    ensured = _run(ws, "mechanics.ensure", {
        "subject_kind": "npc",
        "subject_id": "lucas-strong",
        "purpose": "check",
        "decision_id": "lucas-missing-locator",
    })
    assert ensured["ok"] is True, ensured
    assert ensured["data"]["status"] == "source_work_required"
    assert ensured["data"]["source_work"][
        "mechanics_locator_state"
    ] == request_data["mechanics_locator_state"]
    assert ensured["data"]["next_operation"] == locator_card
    assert ensured["data"]["source_work"][
        "locator_discovery_operation"
    ] == locator_card

@pytest.mark.parametrize(
    "defer_arguments",
    [{}, {"defer_initial_progressive_on_enter": False}],
)
def test_state_move_scene_absent_or_false_deferral_keeps_normal_on_enter(
    tmp_path: Path, monkeypatch, defer_arguments: dict,
):
    ws = _opening_component_workspace(tmp_path)
    published = _run(ws, "progressive.publish_skeleton", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "skeleton": ws["skeleton"],
    })
    assert published["ok"] is True, published
    on_enter_calls: list[tuple[str, str]] = []

    def record_on_enter(_root, campaign_id, scene_id):
        on_enter_calls.append((campaign_id, scene_id))
        return None

    monkeypatch.setattr(
        coc_toolbox.coc_module_project,
        "on_enter_scene",
        record_on_enter,
    )
    moved = _run(ws, "state.move_scene", {
        "scene_id": "opening",
        "reason": "ordinary opening movement",
        "decision_id": "ordinary-opening-move",
        **defer_arguments,
    })

    assert moved["ok"] is True, moved
    assert on_enter_calls == [(ws["campaign_id"], "opening")]
    assert moved["data"].get("progressive", {}).get(
        "on_enter_deferred"
    ) is not True

@pytest.mark.parametrize(
    "non_pristine_kind",
    [
        "world_active",
        "visited",
        "history",
        "pacing",
        "active_pointer",
        "scene_transition",
    ],
)
def test_prepare_opening_activation_card_requires_exact_pristine_state(
    tmp_path: Path, non_pristine_kind: str,
):
    ws = _opening_component_workspace(tmp_path)
    _publish_and_project_opening_component(ws)
    camp = ws["campaign_dir"]
    if non_pristine_kind in {"world_active", "visited", "history"}:
        path = camp / "save" / "world-state.json"
        doc = json.loads(path.read_text(encoding="utf-8"))
        if non_pristine_kind == "world_active":
            doc["active_scene_id"] = "opening"
        elif non_pristine_kind == "visited":
            doc["visited_scene_ids"] = ["opening"]
        else:
            doc["scene_history"] = ["opening"]
        _write_json(path, doc)
    elif non_pristine_kind == "pacing":
        path = camp / "save" / "pacing-state.json"
        doc = json.loads(path.read_text(encoding="utf-8"))
        doc["turn_number"] = 1
        _write_json(path, doc)
    elif non_pristine_kind == "active_pointer":
        _write_json(camp / "save" / "active-scene.json", {
            "schema_version": 1,
            "scene_id": "opening",
        })
    else:
        events = camp / "logs" / "events.jsonl"
        events.parent.mkdir(parents=True, exist_ok=True)
        events.write_text(
            json.dumps({"event_type": "scene_transition"}) + "\n",
            encoding="utf-8",
        )

    prepared = _run(ws, "progressive.prepare_opening")
    assert prepared["ok"] is True, prepared
    assert prepared["data"]["projected_selected_start_ready"] is True
    assert prepared["data"]["ready_to_activate"] is False
    assert all(
        card["operation"] != "state.move_scene"
        for card in prepared["data"]["mutation_cards"]
    )

def test_stale_selected_projection_agrees_across_prepare_defer_and_project(
    tmp_path: Path,
):
    ws = _opening_component_workspace(tmp_path)
    _publish_and_project_opening_component(ws)
    graph_path = ws["campaign_dir"] / "scenario" / "story-graph.json"
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    opening = next(row for row in graph["scenes"] if row["scene_id"] == "opening")
    opening["player_safe_summary"] = "TAMPERED NON-SOURCE OPENING"
    _write_json(graph_path, graph)

    assets = coc_toolbox.coc_module_project.coc_module_assets
    root_info = coc_toolbox.coc_module_project.resolve_opening_preparation_root(
        ws["workspace"], ws["campaign_id"],
    )
    skeleton = assets.get_skeleton(ws["workspace"], ws["asset_root_id"])
    binding_result = coc_toolbox.coc_module_project.resolve_selected_opening_binding(
        ws["workspace"], root_info, skeleton, "opening", None,
    )
    assert binding_result["readiness"]["ready"] is True
    payload = coc_toolbox.coc_module_project.build_opening_projection_payload(
        ws["workspace"],
        ws["asset_root_id"],
        "opening",
        binding_result["scope"],
    )
    assert coc_toolbox.coc_module_project.opening_projection_state_is_fresh(
        ws["workspace"], ws["campaign_dir"], ws["asset_root_id"],
        "opening", binding_result["scope"],
    ) is False

    prepared = _run(ws, "progressive.prepare_opening")
    assert prepared["ok"] is True
    assert prepared["data"]["projected_selected_start_ready"] is False
    assert prepared["data"]["ready_to_activate"] is False
    assert any(
        row["code"] == "opening_projection_required"
        for row in prepared["data"]["blocking"]
    )
    assert all(
        card["operation"] != "state.move_scene"
        for card in prepared["data"]["mutation_cards"]
    )

    world_path = ws["campaign_dir"] / "save" / "world-state.json"
    world_before = world_path.read_bytes()
    deferred = _run(ws, "state.move_scene", {
        "scene_id": "opening",
        "decision_id": "stale-opening-defer",
        "defer_initial_progressive_on_enter": True,
    })
    assert deferred["ok"] is False
    assert deferred["error"]["code"] == "initial_progressive_deferral_invalid"
    assert world_path.read_bytes() == world_before

    repaired = _run(ws, "progressive.project_opening", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "start_location_id": "opening",
    })
    assert repaired["ok"] is True, repaired
    assert repaired["data"]["status"] == "complete"
    assert coc_toolbox.coc_module_project.opening_projection_state_is_fresh(
        ws["workspace"], ws["campaign_dir"], ws["asset_root_id"],
        "opening", binding_result["scope"],
    ) is True

def test_prepare_required_npc_does_not_inject_unreferenced_durable_npc(
    tmp_path: Path,
):
    ws = _opening_component_workspace(tmp_path)
    published = _run(ws, "progressive.publish_skeleton", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "skeleton": ws["skeleton"],
    })
    assert published["ok"] is True
    assets = coc_toolbox.coc_module_project.coc_module_assets
    assets.put_entity(
        ws["workspace"], ws["asset_root_id"], "location", "opening",
        _opening_component_pack(),
    )
    assets.put_entity(
        ws["workspace"], ws["asset_root_id"], "npc", "npc-unreferenced", {
            "npc_id": "npc-unreferenced",
            "name": "Unreferenced Witness",
            "parse_state": "deep",
            "source_page_indices": [0],
            "agenda": "Wait outside the selected pack.",
        },
    )

    prepared = _run(ws, "progressive.prepare_opening", {
        "opening_required_npc_ids": ["npc-unreferenced"],
    })
    assert prepared["ok"] is True
    assert prepared["data"]["selected_start_pack_ready"] is False
    assert prepared["data"]["present_npc_ids"] == []
    assert any(
        row["code"] == "opening_required_npc_not_present"
        for row in prepared["data"]["blocking"]
    )
    assert all(
        card["operation"] not in {
            "progressive.project_opening", "state.move_scene",
        }
        for card in prepared["data"]["mutation_cards"]
    )

def test_derived_external_npc_tamper_agrees_across_all_opening_consumers(
    tmp_path: Path,
):
    ws = _opening_component_workspace(tmp_path)
    published = _run(ws, "progressive.publish_skeleton", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "skeleton": ws["skeleton"],
    })
    assert published["ok"] is True, published
    assets = coc_toolbox.coc_module_project.coc_module_assets
    assets.put_entity(
        ws["workspace"], ws["asset_root_id"], "npc", "npc-external", {
            "npc_id": "npc-external",
            "name": "Source Name",
            "agenda": "Deliver the source-authored opening warning.",
            "parse_state": "deep",
            "source_page_indices": [0],
        },
    )
    assets.put_entity(
        ws["workspace"], ws["asset_root_id"], "location", "opening",
        _opening_component_pack(npc_ids=["npc-external"], npcs=[]),
    )
    projected = _run(ws, "progressive.project_opening", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "start_location_id": "opening",
    })
    assert projected["ok"] is True, projected
    npc_path = ws["campaign_dir"] / "scenario" / "npc-agendas.json"
    npc_doc = json.loads(npc_path.read_text(encoding="utf-8"))
    npc = next(
        row for row in npc_doc["npcs"] if row["npc_id"] == "npc-external"
    )
    assert npc["display_name"] == "Source Name"
    npc["display_name"] = "TAMPERED CURRENT DISPLAY"
    _write_json(npc_path, npc_doc)

    prepared = _run(ws, "progressive.prepare_opening")
    assert prepared["ok"] is True, prepared
    assert prepared["data"]["projected_selected_start_ready"] is False
    assert prepared["data"]["ready_to_activate"] is False
    assert any(
        row["code"] == "opening_projection_required"
        for row in prepared["data"]["blocking"]
    )
    assert all(
        card["operation"] != "state.move_scene"
        for card in prepared["data"]["mutation_cards"]
    )

    world_path = ws["campaign_dir"] / "save" / "world-state.json"
    world_before = world_path.read_bytes()
    deferred = _run(ws, "state.move_scene", {
        "scene_id": "opening",
        "decision_id": "derived-npc-stale-defer",
        "defer_initial_progressive_on_enter": True,
    })
    assert deferred["ok"] is False
    assert deferred["error"]["code"] == "initial_progressive_deferral_invalid"
    assert world_path.read_bytes() == world_before

    repaired = _run(ws, "progressive.project_opening", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "start_location_id": "opening",
    })
    assert repaired["ok"] is True, repaired
    assert repaired["data"]["status"] == "complete"
    repaired_doc = json.loads(npc_path.read_text(encoding="utf-8"))
    repaired_npc = next(
        row for row in repaired_doc["npcs"]
        if row["npc_id"] == "npc-external"
    )
    assert repaired_npc["display_name"] == "Source Name"

def test_wrong_page_pack_blocks_source_projection_not_ordinary_play(
    tmp_path: Path,
):
    ws = _opening_component_workspace(tmp_path, extra_pdf_indices=(9,))
    published = _run(ws, "progressive.publish_skeleton", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "skeleton": ws["skeleton"],
    })
    assert published["ok"] is True, published
    assets = coc_toolbox.coc_module_project.coc_module_assets
    assets.put_entity(
        ws["workspace"],
        ws["asset_root_id"],
        "location",
        "opening",
        _opening_component_pack(source_page_indices=[9]),
    )
    scenario_before = {
        path.name: path.read_bytes()
        for path in (ws["campaign_dir"] / "scenario").glob("*.json")
    }
    prepared = _run(ws, "progressive.prepare_opening")
    assert prepared["ok"] is True, prepared
    assert prepared["data"]["ownership"]["player_action_gate"] is False
    assert prepared["data"]["selected_start_pack_ready"] is False
    assert "opening_pack_source_scope_mismatch" in {
        row["code"] for row in prepared["data"]["blocking"]
    }
    assert all(
        card["operation"] != "state.move_scene"
        for card in prepared["data"]["mutation_cards"]
    )
    projected = _run(ws, "progressive.project_opening", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "start_location_id": "opening",
    })
    assert projected["ok"] is False
    assert projected["error"]["code"] == "opening_pack_source_scope_mismatch"
    assert {
        path.name: path.read_bytes()
        for path in (ws["campaign_dir"] / "scenario").glob("*.json")
    } == scenario_before
    world_path = ws["campaign_dir"] / "save" / "world-state.json"
    world_before = world_path.read_bytes()
    deferred = _run(ws, "state.move_scene", {
        "scene_id": "opening",
        "decision_id": "wrong-page-explicit-defer",
        "defer_initial_progressive_on_enter": True,
    })
    assert deferred["ok"] is False
    assert deferred["error"]["code"] == "initial_progressive_deferral_invalid"
    assert world_path.read_bytes() == world_before

    ordinary = _run(ws, "state.move_scene", {
        "scene_id": "opening",
        "decision_id": "wrong-page-ordinary-move",
    })
    assert ordinary["ok"] is True, ordinary
    assert ordinary["data"]["to_scene_id"] == "opening"

def test_covering_extra_page_pack_is_current_for_request_and_can_activate(
    tmp_path: Path,
):
    ws = _opening_component_workspace(tmp_path, extra_pdf_indices=(9,))
    published = _run(ws, "progressive.publish_skeleton", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "skeleton": ws["skeleton"],
    })
    assert published["ok"] is True, published
    assets = coc_toolbox.coc_module_project.coc_module_assets
    assets.put_entity(
        ws["workspace"],
        ws["asset_root_id"],
        "location",
        "opening",
        _opening_component_pack(source_page_indices=[0, 9]),
    )
    current_request = _run(ws, "progressive.request_opening_pack", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "start_location_id": "opening",
        "opening_pdf_indices": [0],
        "request_purpose": "foreground_opening_slice",
    })
    assert current_request["ok"] is True, current_request
    assert current_request["data"]["status"] == "current"
    prepared = _run(ws, "progressive.prepare_opening")
    assert prepared["ok"] is True, prepared
    assert prepared["data"]["selected_start_pack_ready"] is True
    projected = _run(ws, "progressive.project_opening", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "start_location_id": "opening",
    })
    assert projected["ok"] is True, projected
    activated = _run(ws, "state.move_scene", {
        "scene_id": "opening",
        "decision_id": "covering-extra-page-defer",
        "defer_initial_progressive_on_enter": True,
    })
    assert activated["ok"] is True, activated
    assert activated["data"]["progressive"]["on_enter_deferred"] is True

def test_explicit_page_one_scope_survives_prepare_project_and_disk_defer(
    tmp_path: Path,
):
    ws = _opening_component_workspace(
        tmp_path, extra_pdf_indices=(1, 2),
    )
    ws["skeleton"]["locations"][0]["source_span"] = {
        "pdf_index_start": 0,
        "pdf_index_end": 2,
    }
    published = _run(ws, "progressive.publish_skeleton", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "skeleton": ws["skeleton"],
    })
    assert published["ok"] is True, published
    assets = coc_toolbox.coc_module_project.coc_module_assets
    assets.put_entity(
        ws["workspace"],
        ws["asset_root_id"],
        "location",
        "opening",
        _opening_component_pack(source_page_indices=[1]),
    )

    prepared = _run(ws, "progressive.prepare_opening", {
        "opening_pdf_indices": [1],
    })
    assert prepared["ok"] is True, prepared
    assert prepared["data"]["source_window"] == [1]
    assert prepared["data"]["window_origin"] == "host_selected"
    assert prepared["data"]["selected_start_pack_ready"] is True
    project_card = next(
        row for row in prepared["data"]["mutation_cards"]
        if row["operation"] == "progressive.project_opening"
    )
    assert project_card["prefilled_arguments"]["opening_pdf_indices"] == [1]

    current_request = _run(ws, "progressive.request_opening_pack", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "start_location_id": "opening",
        "opening_pdf_indices": [1],
        "request_purpose": "foreground_opening_slice",
    })
    assert current_request["ok"] is True, current_request
    assert current_request["data"]["status"] == "current"
    assert current_request["data"]["job_id"] is None

    projected = _run(
        ws,
        project_card["operation"],
        project_card["prefilled_arguments"],
    )
    assert projected["ok"] is True, projected
    assert projected["data"]["status"] == "complete"
    scenario = json.loads(
        (
            ws["campaign_dir"] / "scenario" / "scenario.json"
        ).read_text(encoding="utf-8")
    )
    assert scenario["opening_projection_source_binding"]["source_scope"][
        "pdf_indices"
    ] == [1]
    assert set(scenario["opening_projection_receipt"]) == {
        "schema_version",
        "asset_root_id",
        "start_location_id",
        "source_evidence_sha256",
        "projection_input_sha256",
    }

    prepared_after_reload = _run(ws, "progressive.prepare_opening", {
        "opening_pdf_indices": [1],
    })
    assert prepared_after_reload["ok"] is True, prepared_after_reload
    assert prepared_after_reload["data"]["projected_selected_start_ready"] is True
    assert prepared_after_reload["data"]["ready_to_activate"] is True
    second_project = _run(ws, "progressive.project_opening", {
        **project_card["prefilled_arguments"],
    })
    assert second_project["ok"] is True, second_project
    assert second_project["data"]["status"] == "current"
    assert second_project["data"]["idempotent"] is True

    # No prior prepare response is consulted here: explicit defer reloads the
    # persisted page-1 binding and revalidates current module evidence.
    activated = _run(ws, "state.move_scene", {
        "scene_id": "opening",
        "decision_id": "explicit-page-one-opening",
        "defer_initial_progressive_on_enter": True,
    })
    assert activated["ok"] is True, activated
    assert activated["data"]["to_scene_id"] == "opening"
    assert activated["data"]["progressive"]["on_enter_deferred"] is True

def test_persisted_opening_binding_tamper_blocks_only_authored_activation(
    tmp_path: Path,
):
    ws = _opening_component_workspace(tmp_path)
    _publish_and_project_opening_component(ws)
    scenario_path = ws["campaign_dir"] / "scenario" / "scenario.json"
    scenario = json.loads(scenario_path.read_text(encoding="utf-8"))
    scenario["opening_projection_source_binding"][
        "source_scope_signature"
    ] = "0" * 64
    _write_json(scenario_path, scenario)

    prepared = _run(ws, "progressive.prepare_opening", {
        "opening_pdf_indices": [0],
    })
    assert prepared["ok"] is True, prepared
    assert prepared["data"]["ownership"]["player_action_gate"] is False
    assert prepared["data"]["projected_selected_start_ready"] is False
    assert prepared["data"]["ready_to_activate"] is False

    world_path = ws["campaign_dir"] / "save" / "world-state.json"
    world_before = world_path.read_bytes()
    explicit_defer = _run(ws, "state.move_scene", {
        "scene_id": "opening",
        "decision_id": "tampered-binding-explicit-defer",
        "defer_initial_progressive_on_enter": True,
    })
    assert explicit_defer["ok"] is False
    assert explicit_defer["error"]["code"] == (
        "initial_progressive_deferral_invalid"
    )
    assert world_path.read_bytes() == world_before

    # The source-classification prerequisite is not a player-action gate.
    ordinary = _run(ws, "state.move_scene", {
        "scene_id": "opening",
        "decision_id": "tampered-binding-ordinary-move",
    })
    assert ordinary["ok"] is True, ordinary
    assert ordinary["data"]["to_scene_id"] == "opening"

    scenario_before_project = {
        path.name: path.read_bytes()
        for path in (ws["campaign_dir"] / "scenario").glob("*.json")
    }
    refused_repair_after_play = _run(ws, "progressive.project_opening", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "start_location_id": "opening",
        "opening_pdf_indices": [0],
    })
    assert refused_repair_after_play["ok"] is False
    assert refused_repair_after_play["error"]["code"] == (
        "opening_projection_non_pristine"
    )
    assert {
        path.name: path.read_bytes()
        for path in (ws["campaign_dir"] / "scenario").glob("*.json")
    } == scenario_before_project

def test_campaign_local_pack_stays_local_across_prepare_project_and_defer(
    tmp_path: Path,
):
    ws = _opening_component_workspace(tmp_path)
    published = _run(ws, "progressive.publish_skeleton", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "skeleton": ws["skeleton"],
    })
    assert published["ok"] is True, published
    assets = coc_toolbox.coc_module_project.coc_module_assets
    local_pack = _opening_component_pack(
        origin="campaign_improvised",
        provenance={"authority": "campaign_improvised"},
    )
    local_pack.pop("source_page_indices", None)
    assets.put_entity(
        ws["workspace"], ws["asset_root_id"], "location", "opening", local_pack,
    )
    entity_path = (
        ws["workspace"] / ".coc" / "module-assets" / ws["asset_root_id"]
        / "entities" / "location-opening.json"
    )
    entity_before = entity_path.read_bytes()
    prepared = _run(ws, "progressive.prepare_opening")
    assert prepared["ok"] is True, prepared
    assert prepared["data"]["ownership"]["player_action_gate"] is False
    codes = {row["code"] for row in prepared["data"]["blocking"]}
    assert "opening_pack_source_authority_invalid" in codes
    assert "opening_pack_source_evidence_missing" in codes
    projected = _run(ws, "progressive.project_opening", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "start_location_id": "opening",
    })
    assert projected["ok"] is False
    assert projected["error"]["code"] == "opening_pack_source_authority_invalid"
    world_path = ws["campaign_dir"] / "save" / "world-state.json"
    world_before = world_path.read_bytes()
    deferred = _run(ws, "state.move_scene", {
        "scene_id": "opening",
        "decision_id": "local-pack-explicit-defer",
        "defer_initial_progressive_on_enter": True,
    })
    assert deferred["ok"] is False
    assert deferred["error"]["code"] == "initial_progressive_deferral_invalid"
    assert world_path.read_bytes() == world_before
    assert entity_path.read_bytes() == entity_before

def test_table_opening_blocks_while_background_source_parse_is_pending(campaign_ws):
    _bind_progressive_source_for_opening_gate(
        campaign_ws, {"schema_version": 1, "status": "pending"}
    )
    error = _table_opening_error(campaign_ws, "opening-gate-pending")
    assert error["code"] == "opening_source_pending"

def test_table_opening_reports_failed_source_parse_instead_of_inventing(campaign_ws):
    _bind_progressive_source_for_opening_gate(campaign_ws, {
        "schema_version": 1,
        "status": "refused_terminal",
        "last_error": {
            "code": "opening_projection_watch_stale",
            "message": "campaign/source binding no longer matches the watch",
        },
    })
    error = _table_opening_error(campaign_ws, "opening-gate-failed")
    assert error["code"] == "opening_source_failed"
    assert "opening_projection_watch_stale" in error["message"]

def test_table_opening_blocks_source_bound_campaign_with_no_opening_projection(
    campaign_ws,
):
    _bind_progressive_source_for_opening_gate(campaign_ws, None)
    error = _table_opening_error(campaign_ws, "opening-gate-unprepared")
    assert error["code"] == "opening_source_not_prepared"

def test_scene_context_npc_rows_carry_source_readiness(
    tmp_path: Path,
    monkeypatch,
):
    """scene.context NPC rows must never present a named_only stub as fully
    parsed: parse_state + evidence_gap travel with the identity on the hot
    path, and flip to deep/False once the deep pack lands in the archive."""
    monkeypatch.setenv("COC_DISABLE_QUEUE_WORKER", "1")
    ws = _opening_component_workspace(tmp_path)
    published = _run(ws, "progressive.publish_skeleton", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "skeleton": ws["skeleton"],
    })
    assert published["ok"] is True, published
    assets = coc_toolbox.coc_module_project.coc_module_assets
    assets.put_entity(
        ws["workspace"], ws["asset_root_id"], "location", "opening",
        _opening_component_pack(),
    )
    projected = _run(ws, "progressive.project_opening", {
        "asset_root_id": ws["asset_root_id"],
        "source_file_sha256": ws["file_sha256"],
        "start_location_id": "opening",
    })
    assert projected["ok"] is True, projected

    moved = _run(ws, "state.move_scene", {
        "scene_id": "opening",
        "decision_id": "npc-readiness-move",
        "defer_initial_progressive_on_enter": True,
    })
    assert moved["ok"] is True, moved

    # A stub NPC is authored into the active scene's IR (named_only, no deep
    # pack yet) and the archive is republished exactly like a deepen-pending
    # skeleton roster entry would be.
    project_mod = coc_toolbox.coc_module_project
    ir = project_mod.load_campaign_ir(ws["campaign_dir"])
    scene = next(
        s for s in ir["story-graph.json"]["scenes"]
        if s["scene_id"] == "opening"
    )
    scene["npc_ids"] = ["npc-patron"]
    ir["npc-agendas.json"]["npcs"].append({
        "npc_id": "npc-patron",
        "name": "Patron",
        "display_name": "Patron",
        "agenda": "Patron has not been deep-parsed yet.",
        "parse_state": "named_only",
        "origin": "source",
    })
    project_mod.write_ir_to_campaign(
        ws["campaign_dir"], ir, asset_root_id=ws["asset_root_id"],
    )

    context = _run(ws, "scene.context")
    assert context["ok"] is True, context
    row = next(
        r for r in context["data"]["npcs_present"]
        if r["npc_id"] == "npc-patron"
    )
    assert row["parse_state"] == "named_only"
    assert row["evidence_gap"] is True

    # A deep NPC pack merged into the IR/archive flips the row.
    ir = project_mod.load_campaign_ir(ws["campaign_dir"])
    ir = project_mod.merge_deep_entity_into_ir(ir, "npc", {
        "npc_id": "npc-patron",
        "name": "Patron",
        "display_name": "Patron",
        "title": "Patron",
        "parse_state": "deep",
        "evidence_gap": False,
        "agenda_public": "Keep the commission quiet.",
        "player_safe_summary": "A quiet old man.",
    })
    project_mod.write_ir_to_campaign(
        ws["campaign_dir"], ir, asset_root_id=ws["asset_root_id"],
    )
    context2 = _run(ws, "scene.context")
    assert context2["ok"] is True, context2
    row2 = next(
        r for r in context2["data"]["npcs_present"]
        if r["npc_id"] == "npc-patron"
    )
    assert row2["parse_state"] == "deep"
    assert row2["evidence_gap"] is False

def test_parallel_read_opening_gate_inspects_pending_host_work_without_writing(
    tmp_path: Path, monkeypatch,
):
    """Parallel reads run the full gate, but never repair its host-work inputs."""
    from datetime import datetime, timedelta, timezone

    monkeypatch.setenv("COC_DISABLE_QUEUE_WORKER", "1")
    monkeypatch.setenv("COC_HOST", "pi")
    ws = _opening_component_workspace(tmp_path)
    _pending_opening_watch(ws, age_seconds=6000)
    assets = coc_toolbox.coc_module_project.coc_module_assets
    module_root = assets._module_dir(ws["workspace"], ws["asset_root_id"])
    host_work = module_root / "host-work"
    host_work.mkdir(parents=True, exist_ok=True)
    expired_path = host_work / "job-expired.json"
    _write_json(expired_path, {
        "schema_version": assets.HOST_WORK_SCHEMA_VERSION,
        "job_id": "job-expired",
        "kind": "partial_opening",
        "target_id": "opening",
        "work_level": "bounded_warm",
        "play_languages": ["zh-Hans"],
        "dispatch_state": "leased",
        "lease_id": "expired-opening-lease",
        "lease_expires_at": (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat(),
        "executor_id": "source-coordinator:expired",
        "requested_pdf_indices": [0],
        "cached_scope_complete": True,
    })
    invalid_path = host_work / "job-invalid.json"
    invalid_path.write_bytes(b'{"schema_version":2,"job_id":"job-invalid"')
    queue_path = module_root / "parse-queue.json"
    queue = json.loads(queue_path.read_text(encoding="utf-8"))
    queue["done"].append({
        "job_id": "job-invalid",
        "kind": "partial_opening",
        "target_id": "opening",
        "priority": 1,
        "reason": "fixture requeue after invalid host-work",
        "enqueued_at": datetime.now(timezone.utc).isoformat(),
        "work_level": "bounded_warm",
        "requested_source_scope": {"pdf_indices": [0]},
    })
    _write_json(queue_path, queue)
    before = _module_asset_tree_bytes(module_root)
    assert not (module_root / "host-work.lock").exists()

    skill = _run(ws, "rules.skill_describe", {
        "skill": "Library Use", "include_selection_policy": False,
    })
    phase = _run(ws, "setup.phase")

    # setup.phase is ACL-authorized to report the lifecycle. skill_describe is
    # not; both nevertheless traversed the same pure gate before returning.
    assert skill["ok"] is False
    assert skill["error"]["code"] == "opening_setup_incomplete"
    assert phase["ok"] is True, phase
    assert phase["data"]["detail"]["module_preparation"]["sub_phase"] == (
        "opening_source_materialization"
    )
    assert _module_asset_tree_bytes(module_root) == before
    assert not (module_root / "host-work.lock").exists()

    # A serial operation takes the old materializing path even though the
    # opening ACL then blocks the operation itself.
    serial = _run(ws, "scene.map")
    assert serial["ok"] is False
    assert serial["error"]["code"] == "opening_setup_incomplete"
    expired = json.loads(expired_path.read_text(encoding="utf-8"))
    assert expired["dispatch_state"] == "legacy_unowned"
    assert "lease_id" not in expired
    assert "last_lease_expired_at" in expired
    invalid = json.loads(invalid_path.read_text(encoding="utf-8"))
    assert invalid["status"] == "quarantined"
    refreshed_queue = json.loads(queue_path.read_text(encoding="utf-8"))
    assert any(row["job_id"] == "job-invalid" for row in refreshed_queue["pending"])
    assert all(row["job_id"] != "job-invalid" for row in refreshed_queue["done"])

@pytest.mark.parametrize("lifecycle_case", ["pending", "stale", "malformed"])
def test_parallel_reads_keep_current_projection_host_work_pure(
    tmp_path: Path, monkeypatch, lifecycle_case: str,
):
    """Current-receipt freshness must not materialize lifecycle observation."""
    from datetime import datetime, timedelta, timezone

    monkeypatch.setenv("COC_DISABLE_QUEUE_WORKER", "1")
    monkeypatch.setenv("COC_HOST", "pi")
    ws = _opening_component_workspace(tmp_path)
    _project_partial_opening_to_current_receipt(ws)
    assets = coc_toolbox.coc_module_project.coc_module_assets
    module_root = assets._module_dir(ws["workspace"], ws["asset_root_id"])
    host_work = module_root / "host-work"
    fixture_path = host_work / f"job-{lifecycle_case}.json"
    queue_path = module_root / "parse-queue.json"

    if lifecycle_case == "malformed":
        fixture_path.write_bytes(b'{"schema_version":2,"job_id":"job-malformed"')
        queue = json.loads(queue_path.read_text(encoding="utf-8"))
        queue["done"].append({
            "job_id": "job-malformed",
            "kind": "deepen_location",
            "target_id": "opening",
            "priority": 1,
            "reason": "fixture requeue after malformed current projection work",
            "enqueued_at": datetime.now(timezone.utc).isoformat(),
            "work_level": "bounded_warm",
            "requested_source_scope": {"pdf_indices": [0]},
        })
        _write_json(queue_path, queue)
    else:
        request = {
            "schema_version": assets.HOST_WORK_SCHEMA_VERSION,
            "job_id": f"job-{lifecycle_case}",
            "kind": "deepen_location",
            "target_id": lifecycle_case,
            "work_level": "bounded_warm",
            "requested_pdf_indices": [0],
            "cached_scope_complete": lifecycle_case != "pending",
            "play_languages": ["zh-Hans"],
        }
        if lifecycle_case == "stale":
            request.update({
                "dispatch_state": "leased",
                "lease_id": "expired-current-projection-lease",
                "lease_expires_at": (
                    datetime.now(timezone.utc) - timedelta(seconds=1)
                ).isoformat(),
                "executor_id": "source-coordinator:expired",
            })
        _write_json(fixture_path, request)

    before = _module_asset_tree_bytes(module_root)
    host_work_lock_exists = (module_root / "host-work.lock").exists()
    if lifecycle_case == "malformed":
        scenario = json.loads(
            (ws["campaign_dir"] / "scenario" / "scenario.json").read_text(
                encoding="utf-8"
            )
        )
        readiness = coc_toolbox.coc_module_project.opening_pack_readiness(
            ws["workspace"],
            ws["asset_root_id"],
            "opening",
            required_source_scope=scenario[
                "opening_projection_source_binding"
            ]["source_scope"],
            host_work_mode="pure_read",
        )
        assert any(
            row["code"] == "opening_host_work_snapshot_unknown"
            for row in readiness["blocking"]
        )
    skill = _run(ws, "rules.skill_describe", {
        "skill": "Library Use", "include_selection_policy": False,
    })
    phase = _run(ws, "setup.phase")

    # Both entry points take the same pure derivation (including setup.phase's
    # handler rerun). Incomplete malformed evidence fails closed; it never
    # bypasses the established opening ACL.
    if lifecycle_case == "malformed":
        assert skill["ok"] is False
        assert skill["error"]["code"] == "opening_setup_incomplete"
        assert phase["ok"] is True, phase
        assert phase["data"]["detail"]["module_preparation"]["sub_phase"] == (
            "opening_source_materialization"
        )
    else:
        assert skill["ok"] is True, skill
        assert phase["ok"] is True, phase
    assert _module_asset_tree_bytes(module_root) == before
    assert (module_root / "host-work.lock").exists() is host_work_lock_exists

    # The same freshness chain remains materializing for a serial operation.
    _run(ws, "scene.map")
    if lifecycle_case == "pending":
        refreshed = json.loads(fixture_path.read_text(encoding="utf-8"))
        assert refreshed["cached_scope_complete"] is True
        assert refreshed["cached_page_refs"]
        assert refreshed["dispatch_state"] == "legacy_unowned"
        assert refreshed["consumer_state"] == "legacy_unowned"
    elif lifecycle_case == "stale":
        refreshed = json.loads(fixture_path.read_text(encoding="utf-8"))
        assert refreshed["dispatch_state"] == "legacy_unowned"
        assert "lease_id" not in refreshed
        assert "last_lease_expired_at" in refreshed
    else:
        quarantined = json.loads(fixture_path.read_text(encoding="utf-8"))
        assert quarantined["status"] == "quarantined"
        refreshed_queue = json.loads(queue_path.read_text(encoding="utf-8"))
        assert any(row["job_id"] == "job-malformed" for row in refreshed_queue["pending"])
        assert all(row["job_id"] != "job-malformed" for row in refreshed_queue["done"])

def test_pending_watch_with_no_live_owner_re_arms_the_bootstrap(
    tmp_path: Path, monkeypatch,
):
    """A watch whose resolver died must not wedge the campaign forever.

    The coordinator that clears an opening projection watch is spawned per
    session; the watch is persisted in the campaign. When a session dies
    between opening_bootstrap and pack fulfilment, the watch survives with
    nobody left to complete it and the gate used to answer `next_operation:
    null` with "wait" on every turn, permanently. Observed live on campaign
    vfy2: the Keeper correctly replied with empty turns because it was told to
    wait for an event that could never arrive.

    With no open host-work rows the never-leased short grace applies
    (dispatch_lost); the re-arm card shape is the same as resolver_lost.
    """
    monkeypatch.setenv("COC_DISABLE_QUEUE_WORKER", "1")
    ws = _opening_component_workspace(tmp_path)
    monkeypatch.setenv("COC_HOST", "pi")
    _pending_opening_watch(ws, age_seconds=6000)
    module_dir = (
        ws["workspace"] / ".coc" / "module-assets" / ws["asset_root_id"]
    )
    module_dir.mkdir(parents=True, exist_ok=True)
    _write_json(module_dir / "skeleton.json", ws["skeleton"])

    blocked = _run(ws, "scene.map")
    assert blocked["ok"] is False, blocked
    details = blocked["error"]["details"]
    assert details["phase"] == "opening_source_materialization"
    assert details["source_lifecycle_status"] == "dispatch_lost"
    assert details["retained_start_location_id"] == "opening"

    next_operation = details["next_operation"]
    assert isinstance(next_operation, dict), "a lost resolver must not leave null"
    assert next_operation["operation"] == "progressive.opening_bootstrap"
    # The retained opening travels with the card so the Keeper re-arms the same
    # opening rather than re-selecting one.
    assert next_operation["prefilled_arguments"]["opening_pdf_indices"] == [0]
    # The whole start_location travels with the card. A live KP handed the bare
    # id string to a contract that requires {location_id, title} 55 times in one
    # turn, so the repository supplies the object instead of letting it guess.
    assert next_operation["prefilled_arguments"]["start_location"] == {
        "location_id": "opening",
        "title": ws["skeleton"]["locations"][0]["title"],
    }
    assert next_operation["missing_arguments"] == []
    assert next_operation["hard_gate"] is True

def test_a_young_pending_watch_still_waits(tmp_path: Path, monkeypatch):
    """The normal window between an accepted bootstrap and the first claim.

    Pending must never leave next_operation=null: hand back an honest
    progressive.status poll card while the short never-leased grace has not
    elapsed.
    """
    monkeypatch.setenv("COC_DISABLE_QUEUE_WORKER", "1")
    ws = _opening_component_workspace(tmp_path)
    monkeypatch.setenv("COC_HOST", "pi")
    _pending_opening_watch(ws, age_seconds=5)

    blocked = _run(ws, "scene.map")
    assert blocked["ok"] is False, blocked
    details = blocked["error"]["details"]
    assert details["source_lifecycle_status"] == "pending"
    next_operation = details["next_operation"]
    assert isinstance(next_operation, dict), (
        "pending materialization must never leave next_operation=null"
    )
    assert next_operation["operation"] == "progressive.status"
    assert next_operation["prefilled_arguments"]["asset_root_id"] == (
        ws["asset_root_id"]
    )
    assert "resolver" not in details["instruction"]
    assert "dispatch_lost" not in details["instruction"]

def test_pending_watch_never_leased_past_short_grace_is_dispatch_lost(
    tmp_path: Path, monkeypatch,
):
    """Ready host-work that was never claimed must re-arm before the 900s grace.

    Observed live: bootstrap wrote a ready job (attempts=0, no lease) but the
    Pi observer never spawned the coordinator. Waiting out the full 900s
    resolver_lost window leaves the table wedged; the short never-leased grace
    (150s) must surface dispatch_lost + bootstrap re-arm instead.
    """
    monkeypatch.setenv("COC_DISABLE_QUEUE_WORKER", "1")
    from datetime import datetime, timedelta, timezone

    ws = _opening_component_workspace(tmp_path)
    monkeypatch.setenv("COC_HOST", "pi")
    _pending_opening_watch(ws, age_seconds=180)
    module_dir = (
        ws["workspace"] / ".coc" / "module-assets" / ws["asset_root_id"]
    )
    module_dir.mkdir(parents=True, exist_ok=True)
    _write_json(module_dir / "skeleton.json", ws["skeleton"])
    host_work = module_dir / "host-work"
    host_work.mkdir(parents=True, exist_ok=True)
    assets = _load("coc_module_assets_watch_probe", SCRIPTS / "coc_module_assets.py")
    _write_json(host_work / "job-never-leased.json", {
        "schema_version": assets.HOST_WORK_SCHEMA_VERSION,
        "job_id": "job-never-leased",
        "kind": "partial_opening",
        "target_id": "opening",
        "work_level": "bounded_warm",
        "play_languages": ["zh-Hans"],
        "dispatch_state": "ready",
        "dispatch_attempts": 0,
        "requested_pdf_indices": [0],
        "cached_scope_complete": True,
    })

    blocked = _run(ws, "scene.map")
    assert blocked["ok"] is False, blocked
    details = blocked["error"]["details"]
    assert details["phase"] == "opening_source_materialization"
    assert details["source_lifecycle_status"] == "dispatch_lost"
    next_operation = details["next_operation"]
    assert isinstance(next_operation, dict)
    assert next_operation["operation"] == "progressive.opening_bootstrap"
    assert next_operation["prefilled_arguments"]["opening_pdf_indices"] == [0]

def test_pending_watch_once_leased_uses_long_resolver_grace(
    tmp_path: Path, monkeypatch,
):
    """Once-leased work keeps the 900s resolver_lost grace, not the short one.

    dispatch_attempts>0 means a coordinator claimed at least once; disappearing
    mid-batch must not be mistaken for never-dispatched ready work at 150s.
    """
    monkeypatch.setenv("COC_DISABLE_QUEUE_WORKER", "1")
    ws = _opening_component_workspace(tmp_path)
    monkeypatch.setenv("COC_HOST", "pi")
    _pending_opening_watch(ws, age_seconds=180)
    module_dir = (
        ws["workspace"] / ".coc" / "module-assets" / ws["asset_root_id"]
    )
    host_work = module_dir / "host-work"
    host_work.mkdir(parents=True, exist_ok=True)
    assets = _load("coc_module_assets_watch_probe", SCRIPTS / "coc_module_assets.py")
    _write_json(host_work / "job-once-leased.json", {
        "schema_version": assets.HOST_WORK_SCHEMA_VERSION,
        "job_id": "job-once-leased",
        "kind": "partial_opening",
        "target_id": "opening",
        "work_level": "bounded_warm",
        "play_languages": ["zh-Hans"],
        "dispatch_state": "ready",
        "dispatch_attempts": 1,
        "requested_pdf_indices": [0],
        "cached_scope_complete": True,
    })

    blocked = _run(ws, "scene.map")
    details = blocked["error"]["details"]
    assert details["source_lifecycle_status"] == "pending"
    assert details["next_operation"]["operation"] == "progressive.status"

    _pending_opening_watch(ws, age_seconds=6000)
    blocked_old = _run(ws, "scene.map")
    details_old = blocked_old["error"]["details"]
    assert details_old["source_lifecycle_status"] == "resolver_lost"
    assert details_old["next_operation"]["operation"] == (
        "progressive.opening_bootstrap"
    )

def test_an_old_pending_watch_with_leased_work_still_waits(
    tmp_path: Path, monkeypatch,
):
    """An in-flight batch must never be mistaken for a dead resolver."""
    monkeypatch.setenv("COC_DISABLE_QUEUE_WORKER", "1")
    from datetime import datetime, timedelta, timezone

    ws = _opening_component_workspace(tmp_path)
    monkeypatch.setenv("COC_HOST", "pi")
    _pending_opening_watch(ws, age_seconds=6000)

    host_work = (
        ws["workspace"] / ".coc" / "module-assets" / ws["asset_root_id"]
        / "host-work"
    )
    host_work.mkdir(parents=True, exist_ok=True)
    assets = _load("coc_module_assets_watch_probe", SCRIPTS / "coc_module_assets.py")
    _write_json(host_work / "job-leased.json", {
        "schema_version": assets.HOST_WORK_SCHEMA_VERSION,
        "job_id": "job-leased",
        "kind": "partial_opening",
        "target_id": "opening",
        "work_level": "bounded_warm",
        "play_languages": ["zh-Hans"],
        "dispatch_state": "leased",
        "lease_id": "source-lease-live",
        "lease_expires_at": (
            datetime.now(timezone.utc) + timedelta(seconds=600)
        ).isoformat(),
        "executor_id": "source-coordinator:live",
        "requested_pdf_indices": [0],
    })

    blocked = _run(ws, "scene.map")
    assert blocked["ok"] is False, blocked
    details = blocked["error"]["details"]
    assert details["source_lifecycle_status"] == "pending"
    next_operation = details["next_operation"]
    assert isinstance(next_operation, dict), (
        "pending materialization must never leave next_operation=null"
    )
    assert next_operation["operation"] == "progressive.status"
