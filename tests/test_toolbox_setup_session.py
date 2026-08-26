"""Behavior tests owned by the setup-session operation cell."""
from toolbox_test_support import *

def test_setup_phase_inner_campaign_uses_its_shared_campaign_lock(
    campaign_ws, monkeypatch,
):
    locks: list[tuple[Path, str]] = []

    @contextmanager
    def recorded_lock(campaign_dir, **kwargs):
        locks.append((Path(campaign_dir), str(kwargs.get("mode", "exclusive"))))
        yield Path(campaign_dir) / ".campaign.lock"

    monkeypatch.setattr(coc_toolbox.coc_fileio, "campaign_lock", recorded_lock)
    result = coc_toolbox.run_tool(
        "setup.phase",
        campaign_ws["workspace"],
        "unrelated-outer-campaign",
        {"campaign_id": campaign_ws["campaign_id"]},
    )

    assert result["ok"] is True, result
    assert result["data"]["campaign_id"] == campaign_ws["campaign_id"]
    assert locks == [(campaign_ws["campaign_dir"], "shared")]

def test_cli_json_stdin_accepts_one_object_without_shell_interpolation(
    tmp_path: Path, monkeypatch, capsys,
):
    monkeypatch.setattr(sys, "stdin", io.StringIO("{}"))
    code = coc_toolbox.main([
        "setup.inspect", "--root", str(tmp_path), "--json-stdin",
    ])
    assert code == 0
    envelope = json.loads(capsys.readouterr().out)
    assert envelope["ok"] is True
    assert envelope["tool"] == "setup.inspect"

def test_cli_json_stdin_rejects_non_object(monkeypatch, capsys):
    monkeypatch.setattr(sys, "stdin", io.StringIO("[]"))
    code = coc_toolbox.main(["setup.inspect", "--json-stdin"])
    assert code == 1
    envelope = json.loads(capsys.readouterr().out)
    assert envelope["error"] == {
        "code": "bad_json",
        "message": "--json-stdin must be an object",
    }

def test_setup_tools_reuse_canonical_pre_session_gateway(tmp_path):
    inspected = coc_toolbox.run_tool("setup.inspect", tmp_path, None, {})
    assert inspected["ok"] is True, inspected
    result = inspected["data"]["result"]
    assert result["workspace_ready"] is False
    haunting = next(
        row for row in result["starters"]
        if row["scenario_id"] == "the-haunting"
    )
    assert any(
        row["pregen_id"] == "thomas-hayes"
        for row in haunting["pregens"]
    )

    started = coc_toolbox.run_tool(
        "setup.quick_start",
        tmp_path,
        None,
        {
            "scenario_id": "the-haunting",
            "pregen_id": "thomas-hayes",
            "campaign_id": "typed-setup",
            "title": "Typed Setup",
        },
    )
    assert started["ok"] is True, started
    assert started["data"]["kind"] == "campaign.quick_start"
    assert started["data"]["result"]["campaign_id"] == "typed-setup"
    assert not any(
        "call session.resume" in hint for hint in started["hints"]
    )
    assert any(
        "predates the current host context" in hint
        for hint in started["hints"]
    )
    campaign = json.loads(
        (tmp_path / ".coc" / "campaigns" / "typed-setup" / "campaign.json")
        .read_text(encoding="utf-8")
    )
    assert campaign["play_language"] == "zh-Hans"
    assert started["warnings"] == []

    duplicate = coc_toolbox.run_tool(
        "setup.quick_start",
        tmp_path,
        None,
        {
            "scenario_id": "the-haunting",
            "pregen_id": "eleanor-reed",
            "campaign_id": "typed-setup-second",
            "title": "Typed Setup Second",
        },
    )
    assert duplicate["ok"] is True, duplicate
    assert any(
        "typed-setup" in warning and "Mid-setup duplicate campaigns" in warning
        for warning in duplicate["warnings"]
    ), duplicate["warnings"]

    unsupported = coc_toolbox.run_tool(
        "setup.quick_start",
        tmp_path,
        None,
        {
            "scenario_id": "the-haunting",
            "pregen_id": "thomas-hayes",
            "play_language": "en",
        },
    )
    assert unsupported["ok"] is False
    assert unsupported["error"]["code"] == "invalid_param"
    assert "play_language" in unsupported["error"]["message"]

def test_setup_quick_start_omits_pregen_for_white_war(tmp_path):
    started = coc_toolbox.run_tool(
        "setup.quick_start",
        tmp_path,
        None,
        {
            "scenario_id": "the-white-war",
            "campaign_id": "white-war-no-pregen",
        },
    )
    assert started["ok"] is True, started
    result = started["data"]["result"]
    assert result["campaign_id"] == "white-war-no-pregen"
    assert result["needs_investigator"] is True
    assert result["pregen_id"] is None
    assert any("without an investigator" in hint for hint in started["hints"])
    assert any("not a missing campaign_id" in hint for hint in started["hints"])

    empty = coc_toolbox.run_tool(
        "setup.quick_start",
        tmp_path,
        None,
        {
            "scenario_id": "the-white-war",
            "campaign_id": "white-war-empty-pregen",
            "pregen_id": "",
        },
    )
    assert empty["ok"] is False
    assert empty["error"]["code"] == "invalid_param"
    assert "omit the field" in empty["error"]["message"]

    unknown = coc_toolbox.run_tool(
        "setup.quick_start",
        tmp_path,
        None,
        {
            "scenario_id": "the-white-war",
            "campaign_id": "white-war-unknown-pregen",
            "pregen_id": "not-a-real-pregen",
        },
    )
    assert unknown["ok"] is False
    assert "unknown pregen" in unknown["error"]["message"]

    complete = coc_toolbox.run_tool(
        "setup.complete",
        tmp_path,
        None,
        {
            "campaign_id": "white-war-no-pregen",
            "decision_id": "handoff-too-soon",
        },
    )
    assert complete["ok"] is False
    assert complete["error"]["code"] == "character_setup_incomplete"
    assert "investigator" in complete["error"]["message"]

def test_quick_fire_create_echoes_mismatched_campaign_ids(campaign_ws):
    envelope = _run(campaign_ws, "setup.invoke", {
        "kind": "investigator.create",
        "payload": {
            "campaign_id": "other-campaign",
            "creation": {
                "characteristic_assignment_order": ["STR"],
                "luck_roll_total": 10,
                "luck_roll_receipt": {
                    "campaign_id": "third-campaign",
                    "decision_id": "luck-other",
                    "roll_id": "roll-other",
                },
            },
        },
    })
    assert envelope["ok"] is False
    assert envelope["error"]["code"] == "invalid_param"
    message = envelope["error"]["message"]
    assert f"top-level={campaign_ws['campaign_id']!r}" in message
    assert "payload.campaign_id='other-campaign'" in message
    assert "luck_roll_receipt.campaign_id='third-campaign'" in message

@pytest.mark.parametrize("kind", coc_toolbox._CUSTOM_SETUP_OPERATION_KINDS)
def test_flattened_setup_kind_unknown_tool_returns_corrected_setup_invoke(kind):
    envelope = coc_toolbox.run_tool(kind, Path("."), "haunting-setup", {})
    assert envelope["ok"] is False
    assert envelope["error"]["code"] == "unknown_tool"
    message = envelope["error"]["message"]
    assert "setup.invoke kind, not a top-level operation" in message
    assert "retry only this corrected call:" in message
    corrected = json.loads(message.rsplit("retry only this corrected call:", 1)[1])
    assert corrected == {
        "operation": "setup.invoke",
        "invoke_via": "coc_invoke",
        "campaign": "haunting-setup",
        "arguments": {
            "kind": kind,
            "payload": {"campaign_id": "haunting-setup"},
        },
    }

def test_campaign_create_warns_when_a_recent_campaign_already_exists(
    tmp_path,
):
    def create(campaign_id: str) -> dict:
        return coc_toolbox.run_tool(
            "setup.invoke",
            tmp_path,
            None,
            {
                "kind": "campaign.create",
                "payload": {"campaign_id": campaign_id, "title": campaign_id},
            },
        )

    first = create("drift-first")
    assert first["ok"] is True, first
    assert first["warnings"] == []

    second = create("drift-second")
    assert second["ok"] is True, second
    assert any(
        "drift-first" in warning and "Mid-setup duplicate campaigns" in warning
        for warning in second["warnings"]
    ), second["warnings"]

def test_table_opening_accepts_empty_presented_roll_ids(campaign_ws):
    narrative = "[in_game]\n没有初见 NPC 的自由开场。\n[/in_game]"
    opening = _run(
        campaign_ws,
        "evidence.table_opening",
        {
            "text": narrative,
            "run_id": "empty-opening-run",
            "presented_roll_ids": [],
            "decision_id": "empty-opening-evidence",
        },
    )

    assert opening["ok"] is True, opening
    assert opening["data"]["text"] == (
        "[in_game]\n"
        "【开场时间】1920-10-12 10:00\n\n"
        "没有初见 NPC 的自由开场。\n"
        "[/in_game]"
    )
    assert opening["data"]["authoritative_time_anchor"] == {
        "schema_version": 1,
        "display": "1920-10-12 10:00",
        "player_time": {
            "phase": "morning",
            "appearance_mode": "normal",
            "display_label": None,
            "source_ref": None,
        },
        "source_ref": None,
        "rendered_line": "【开场时间】1920-10-12 10:00",
    }
    assert opening["data"]["presented_roll_ids"] == []

@pytest.mark.parametrize(
    "authoritative_display",
    [
        "约1080年前后的12月一个清晨，圣诞季约两周后",
        "约1080年前后的12月一个清晨，圣诞季约两周前",
    ],
)
def test_table_opening_preserves_authoritative_christmas_direction(
    campaign_ws,
    authoritative_display: str,
):
    time_path = campaign_ws["campaign_dir"] / "save" / "time-state.json"
    time_state = json.loads(time_path.read_text(encoding="utf-8"))
    time_state["clock"]["display"] = authoritative_display
    _write_json(time_path, time_state)
    args = {
        "text": "[in_game]\n马车停在风雪中的庄园门前。\n[/in_game]",
        "run_id": "christmas-direction-opening",
        "presented_roll_ids": [],
        "decision_id": "christmas-direction-opening-evidence",
    }

    opening = _run(campaign_ws, "evidence.table_opening", args)

    assert opening["ok"] is True, opening
    assert opening["data"]["authoritative_time_anchor"]["display"] == (
        authoritative_display
    )
    assert f"【开场时间】{authoritative_display}" in opening["data"]["text"]

    time_state["clock"]["display"] = "一个会导致重放漂移的错误时间"
    _write_json(time_path, time_state)
    replay = _run(campaign_ws, "evidence.table_opening", args)
    assert replay["ok"] is True, replay
    assert replay["data"] == opening["data"]

def test_pi_current_empty_party_resume_emits_guided_character_discriminator(
    tmp_path: Path,
    monkeypatch,
):
    ws = _opening_component_workspace(tmp_path)
    monkeypatch.setenv("COC_HOST", "codex")
    _publish_and_project_opening_component(ws)
    monkeypatch.setenv("COC_HOST", "pi")

    resumed = _run(ws, "session.resume")

    assert resumed["ok"] is False, resumed
    assert resumed["tool"] == "session.resume"
    assert resumed["error"]["code"] == "opening_setup_incomplete"
    details = resumed["error"]["details"]
    assert details == {
        "schema_version": 1,
        "status": "blocked",
        "hard_gate": True,
        "activation_allowed": False,
        "phase": "opening_character_setup_required",
        "opening_phase": "character_creation",
        "campaign_id": ws["campaign_id"],
        "character_setup_policy": "guided_quick_fire",
        "next_operation": None,
        "instruction": (
            "complete one guided Quick Fire investigator creation and exact "
            "campaign link before opening play"
        ),
    }
    assert not any(
        key in json.dumps(details)
        for key in ("current_turn", "location", "opening_time", "task")
    )

def test_session_resume_projects_briefing_path_when_investigator_is_unlinked(
    tmp_path: Path,
):
    workspace = tmp_path / "workspace"
    started = coc_starter.quick_start(
        workspace / ".coc",
        "the-haunting",
        None,
        campaign_id="briefing-resume",
    )
    ws = {
        "workspace": workspace,
        "campaign_id": started["campaign_id"],
        "campaign_dir": Path(started["campaign_dir"]),
    }
    campaign = json.loads(
        (ws["campaign_dir"] / "campaign.json").read_text(encoding="utf-8")
    )
    briefing_path = campaign["character_creation"]["briefing_path"]
    briefing = (workspace / briefing_path).read_text(encoding="utf-8")
    assert "波士顿" in briefing

    resumed = _run(ws, "session.resume")

    assert resumed["ok"] is True, resumed
    projection = resumed["data"]["character_creation"]
    assert projection["status"] == "incomplete"
    assert projection["briefing_path"] == briefing_path
    assert projection["era"] == "1920s"
    assert projection["play_language"] == "zh-Hans"
    assert any(
        "character_creation.briefing_path" in hint
        for hint in resumed["hints"]
    )

def test_session_resume_projects_briefing_path_when_party_is_setup_placeholder(
    tmp_path: Path,
):
    workspace = tmp_path / "workspace"
    started = coc_starter.quick_start(
        workspace / ".coc",
        "the-haunting",
        None,
        campaign_id="briefing-placeholder",
    )
    ws = {
        "workspace": workspace,
        "campaign_id": started["campaign_id"],
        "campaign_dir": Path(started["campaign_dir"]),
    }
    created = _run(ws, "setup.invoke", {
        "kind": "investigator.create",
        "payload": {
            "investigator_id": "web-char-setup-draft",
            "sheet": {
                "id": "web-char-setup-draft",
                "name": "（建卡引导中）",
                "occupation": "调查员",
                "era": "1920s",
                "age": 28,
                "characteristics": {
                    "INT": 80, "POW": 70, "DEX": 60, "EDU": 60,
                    "CON": 50, "APP": 50, "SIZ": 50, "STR": 40,
                },
                "derived": {
                    "HP": 10, "MP": 14, "SAN": 70, "Luck": 60,
                    "DB": "none", "Build": 0, "MOV": 8,
                },
                "skills": {
                    "Credit Rating": 20, "Spot Hidden": 25,
                    "Listen": 20, "Library Use": 20,
                },
            },
            "creation": {
                "input_mode": "import_complete_sheet",
                "method": "complete_sheet_placeholder",
            },
        },
    })
    assert created["ok"] is True, created
    linked = _run(ws, "setup.invoke", {
        "kind": "campaign.link_investigator",
        "payload": {
            "campaign_id": ws["campaign_id"],
            "investigator_ids": ["web-char-setup-draft"],
        },
    })
    assert linked["ok"] is True, linked
    campaign = json.loads(
        (ws["campaign_dir"] / "campaign.json").read_text(encoding="utf-8")
    )

    resumed = _run(ws, "session.resume")

    assert resumed["ok"] is True, resumed
    projection = resumed["data"]["character_creation"]
    assert projection["briefing_path"] == (
        campaign["character_creation"]["briefing_path"]
    )
    assert projection["era"] == "1920s"

def test_session_resume_omits_character_creation_after_party_link(campaign_ws):
    resumed = _run(campaign_ws, "session.resume")
    assert resumed["ok"] is True, resumed
    assert "character_creation" not in resumed["data"]

@pytest.mark.parametrize("party_path_kind", ["directory", "fifo"])
def test_pi_character_discriminator_rejects_nonregular_party_path(
    tmp_path: Path,
    monkeypatch,
    party_path_kind: str,
):
    ws = _opening_component_workspace(tmp_path)
    monkeypatch.setenv("COC_HOST", "codex")
    _publish_and_project_opening_component(ws)
    party_path = ws["campaign_dir"] / "party.json"
    if party_path_kind == "directory":
        party_path.mkdir()
    else:
        os.mkfifo(party_path)
    monkeypatch.setenv("COC_HOST", "pi")

    resumed = _run(ws, "session.resume")

    details = (
        resumed.get("error", {}).get("details", {})
        if isinstance(resumed, dict)
        else {}
    )
    assert details.get("phase") != "opening_character_setup_required"
    assert details.get("character_setup_policy") != "guided_quick_fire"

def test_pi_opening_facts_transport_tamper_fails_closed_without_raw_leak(
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
        ws["workspace"], continuation=continuation, status="reviewed",
        selected_opening_pdf_indices=[0],
    )
    coc_toolbox.coc_runtime_ops._apply_opening_source_review_fulfillment(
        ws["workspace"], receipt,
        source_facts=_minimal_opening_source_facts("pdf:opening-component"),
    )
    scenario = json.loads(scenario_path.read_text(encoding="utf-8"))
    scenario["opening_source_facts_transport"]["facts"][
        "player_safe_summary"
    ]["raw_excerpt"] = "SECRET_RAW_PAGE_TEXT"
    _write_json(scenario_path, scenario)
    monkeypatch.setenv("COC_HOST", "pi")
    blocked = _run(ws, "session.resume")
    assert blocked["ok"] is False
    details = blocked["error"]["details"]
    assert details["phase"] == "opening_source_contract_invalid"
    assert details["source_contract_error"]["code"] == (
        "opening_source_facts_transport_invalid"
    )
    assert "SECRET_RAW_PAGE_TEXT" not in json.dumps(blocked)
    coc_toolbox.coc_runtime_ops.execute_setup_operation(
        ws["workspace"],
        operation={
            "schema_version": 1,
            "kind": "scenario.bind_pdf",
            "payload": {
                "campaign_id": ws["campaign_id"],
                "scenario_id": ws["asset_root_id"],
                "title": "Opening Component",
                "source_bundle_path": str(
                    ws["workspace"] / "opening-source"
                ),
                "compile_now": False,
            },
        },
    )
    rebound = json.loads(scenario_path.read_text(encoding="utf-8"))
    assert "opening_source_facts_transport" not in rebound

def test_table_opening_allows_projected_source_opening(campaign_ws):
    _bind_progressive_source_for_opening_gate(
        campaign_ws, {"schema_version": 1, "status": "complete"}
    )
    opening = _run(
        campaign_ws,
        "evidence.table_opening",
        {
            "text": "[in_game]\n来源已投影后的开场。\n[/in_game]",
            "run_id": "opening-gate-run",
            "presented_roll_ids": [],
            "decision_id": "opening-gate-complete",
        },
    )
    assert opening["ok"] is True, opening

def test_table_opening_is_not_gated_without_a_source_binding(campaign_ws):
    readiness = coc_toolbox.coc_module_project.opening_source_readiness(
        campaign_ws["campaign_dir"]
    )
    assert readiness["state"] == "not_source_gated"
    opening = _run(
        campaign_ws,
        "evidence.table_opening",
        {
            "text": "[in_game]\n非 PDF 场景的正式开场。\n[/in_game]",
            "run_id": "opening-gate-built-in-control",
            "presented_roll_ids": [],
            "decision_id": "opening-gate-not-source-bound",
        },
    )
    assert opening["ok"] is True, opening

def test_explicit_fresh_campaign_id_quick_start_is_first_mutation(tmp_path):
    campaign_id = "memory-haunting-20260823-02"
    campaign_dir = tmp_path / ".coc" / "campaigns" / campaign_id
    assert not campaign_dir.exists()
    envelope = coc_toolbox.run_tool(
        "setup.quick_start", tmp_path, None,
        {
            "scenario_id": "the-haunting",
            "pregen_id": "thomas-hayes",
            "campaign_id": campaign_id,
            "title": "闹鬼",
        },
    )
    assert envelope["ok"] is True, envelope
    assert envelope["data"]["kind"] == "campaign.quick_start"
    assert envelope["data"]["result"]["campaign_id"] == campaign_id
    campaign = json.loads(
        (campaign_dir / "campaign.json").read_text(encoding="utf-8")
    )
    assert campaign["active_scenario_id"] == "the-haunting"
    assert campaign["status"] == "setup"
    completed = coc_toolbox.run_tool(
        "setup.complete", tmp_path, None,
        {"campaign_id": campaign_id, "decision_id": "handoff-fresh-02"},
    )
    assert completed["ok"] is True, completed
    written = json.loads(
        (campaign_dir / "campaign.json").read_text(encoding="utf-8")
    )
    assert written["status"] == "ready_for_table"
    assert written["active_scenario_id"] == "the-haunting"

def test_quick_start_on_existing_campaign_returns_steered_tool_error(tmp_path):
    coc_toolbox.run_tool(
        "setup.invoke", tmp_path, None,
        {"kind": "campaign.create", "payload": {"campaign_id": "qs-dup", "title": "QS"}},
    )
    envelope = coc_toolbox.run_tool(
        "setup.quick_start", tmp_path, None,
        {
            "scenario_id": "the-haunting",
            "pregen_id": "thomas-hayes",
            "campaign_id": "qs-dup",
        },
    )
    assert envelope["ok"] is False
    assert envelope["error"]["code"] == "idempotency_conflict"
    assert "already exists" in envelope["error"]["message"]
    assert "reusable quick-start receipt" in envelope["error"]["message"]


def test_no_id_quick_start_replays_durable_receipt_after_lost_response(
    tmp_path, monkeypatch,
):
    published = 0
    runtime_starter = coc_toolbox.coc_runtime_ops.coc_starter
    real_publish = runtime_starter._publish_campaign_generation

    def counted_publish(*args, **kwargs):
        nonlocal published
        published += 1
        return real_publish(*args, **kwargs)

    monkeypatch.setattr(
        runtime_starter,
        "_publish_campaign_generation",
        counted_publish,
    )
    arguments = {
        "scenario_id": "the-haunting",
        "pregen_id": "thomas-hayes",
        "decision_id": "quick-start:the-haunting:attempt-1",
    }

    # The caller loses this successful response after the canonical mutation
    # committed, then retries the exact same semantic intent.
    lost = coc_toolbox.run_tool(
        "setup.quick_start", tmp_path, None, arguments,
    )
    assert lost["ok"] is True, lost
    replayed = coc_toolbox.run_tool(
        "setup.quick_start", tmp_path, None, arguments,
    )

    assert replayed == lost
    assert replayed["data"]["result"]["campaign_id"] == "the-haunting-qs"
    assert replayed["data"]["decision_id"] == arguments["decision_id"]
    assert published == 1

    conflict = coc_toolbox.run_tool(
        "setup.quick_start",
        tmp_path,
        None,
        {
            **arguments,
            "decision_id": "quick-start:the-haunting:attempt-2",
        },
    )
    assert conflict["ok"] is False
    assert conflict["error"]["code"] == "idempotency_conflict"

    changed_intent = coc_toolbox.run_tool(
        "setup.quick_start",
        tmp_path,
        None,
        {**arguments, "title": "A different intent"},
    )
    assert changed_intent["ok"] is False
    assert changed_intent["error"]["code"] == "idempotency_conflict"


def test_omitted_decision_id_uses_runtime_owned_semantic_replay(tmp_path):
    arguments = {
        "scenario_id": "the-haunting",
        "pregen_id": "thomas-hayes",
        "campaign_id": "legacy-card-quick-start",
    }

    first = coc_toolbox.run_tool(
        "setup.quick_start", tmp_path, None, arguments,
    )
    replayed = coc_toolbox.run_tool(
        "setup.quick_start", tmp_path, None, arguments,
    )

    assert first["ok"] is True, first
    assert replayed == first
    assert first["data"]["decision_id"] == (
        "quick-start:campaign-setup:attempt-1"
    )
    changed = coc_toolbox.run_tool(
        "setup.quick_start",
        tmp_path,
        None,
        {**arguments, "title": "Different legacy intent"},
    )
    assert changed["ok"] is False
    assert changed["error"]["code"] == "idempotency_conflict"
