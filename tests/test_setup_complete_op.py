"""Contract tests for setup.complete and ready_for_table session.resume."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_toolbox = _load("coc_toolbox_setup_complete", SCRIPTS / "coc_toolbox.py")
coc_state = _load("coc_state_setup_complete", SCRIPTS / "coc_state.py")
coc_starter = _load("coc_starter_setup_complete", SCRIPTS / "coc_starter.py")

_LIVE_RESUME_MODES = {
    "awaiting_player",
    "open_turn_recovery",
    "pending_finalization",
}
_LIVE_ONLY_NEXT = {
    "rules.roll",
    "state.journal",
    "turn.finalize",
    "interpret_current_player_message",
    "continue_current_turn_from_receipts",
}


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def _make_campaign(root: Path, campaign_id: str, title: str = "Handoff") -> Path:
    coc_state.create_campaign(root, campaign_id, title, era="1920s")
    return root / ".coc" / "campaigns" / campaign_id


def _link_investigator(
    root: Path,
    campaign_id: str,
    investigator_id: str,
    *,
    method: str = "quick_fire",
) -> None:
    campaign_dir = root / ".coc" / "campaigns" / campaign_id
    _write_json(
        campaign_dir / "party.json",
        {
            "schema_version": 1,
            "campaign_id": campaign_id,
            "investigator_ids": [investigator_id],
            "active_investigator_ids": [investigator_id],
        },
    )
    _write_json(
        root / ".coc" / "investigators" / investigator_id / "creation.json",
        {
            "schema_version": 1,
            "investigator_id": investigator_id,
            "method": method,
            "input_mode": "import_complete_sheet",
        },
    )
    _write_json(
        root / ".coc" / "investigators" / investigator_id / "character.json",
        {
            "id": investigator_id,
            "name": investigator_id,
            "characteristics": {
                "STR": 50, "CON": 50, "SIZ": 50, "DEX": 50,
                "APP": 50, "INT": 50, "POW": 50, "EDU": 50,
            },
            "derived": {
                "HP": 10, "MP": 10, "SAN": 50, "Luck": 50,
                "DB": "none", "Build": 0, "MOV": 8,
            },
            "skills": {"Credit Rating": 20},
        },
    )


def _bind_source(
    campaign_dir: Path,
    *,
    projected: bool,
    watch_status: str | None = None,
    scenario_id: str = "src-mod",
) -> None:
    campaign_path = campaign_dir / "campaign.json"
    campaign = json.loads(campaign_path.read_text(encoding="utf-8"))
    campaign["active_scenario_id"] = scenario_id
    campaign_path.write_text(
        json.dumps(campaign, indent=2) + "\n", encoding="utf-8",
    )
    scenario_path = campaign_dir / "scenario" / "scenario.json"
    scenario: dict = {
        "schema_version": 1,
        "scenario_id": scenario_id,
        "progressive_asset_root_id": "asset-root-src",
        "source_cache_asset_root_id": "asset-root-src",
    }
    if projected:
        scenario["opening_projection_receipt"] = {
            "schema_version": 1,
            "asset_root_id": "asset-root-src",
            "start_location_id": "opening-room",
        }
    elif watch_status is not None:
        scenario["opening_projection_watch"] = {
            "status": watch_status,
            "asset_root_id": "asset-root-src",
        }
    _write_json(scenario_path, scenario)


def test_setup_complete_rejects_placeholder_investigator(tmp_path: Path):
    campaign_id = "placeholder-camp"
    _make_campaign(tmp_path, campaign_id)
    _link_investigator(
        tmp_path, campaign_id, "web-char-setup-draft",
        method="complete_sheet_placeholder",
    )
    envelope = coc_toolbox.run_tool(
        "setup.complete",
        tmp_path,
        None,
        {"campaign_id": campaign_id, "decision_id": "handoff-1"},
    )
    assert envelope["ok"] is False
    assert envelope["error"]["code"] == "character_setup_incomplete"


def test_setup_complete_source_bound_unprojected_is_pending(tmp_path: Path):
    campaign_id = "src-pending"
    campaign_dir = _make_campaign(tmp_path, campaign_id)
    _link_investigator(tmp_path, campaign_id, "inv-ok")
    _bind_source(campaign_dir, projected=False, watch_status="pending")
    envelope = coc_toolbox.run_tool(
        "setup.complete",
        tmp_path,
        None,
        {"campaign_id": campaign_id, "decision_id": "handoff-2"},
    )
    assert envelope["ok"] is False
    assert envelope["error"]["code"] == "opening_source_pending"


def test_setup_complete_empty_campaign_fails_without_bound_scenario(
    tmp_path: Path,
):
    campaign_id = "empty-no-scenario"
    _make_campaign(tmp_path, campaign_id)
    _link_investigator(tmp_path, campaign_id, "inv-ok")
    envelope = coc_toolbox.run_tool(
        "setup.complete",
        tmp_path,
        None,
        {"campaign_id": campaign_id, "decision_id": "handoff-empty"},
    )
    assert envelope["ok"] is False
    assert envelope["error"]["code"] == "scenario_not_bound"
    campaign = json.loads(
        (tmp_path / ".coc" / "campaigns" / campaign_id / "campaign.json")
        .read_text(encoding="utf-8")
    )
    assert campaign["status"] == "setup"
    assert campaign.get("active_scenario_id") is None
    assert "setup_handoff" not in campaign


def test_setup_complete_builtin_confirmed_is_idempotent(tmp_path: Path):
    campaign_id = "builtin-ready"
    quick = coc_starter.quick_start(
        tmp_path / ".coc",
        "the-haunting",
        "thomas-hayes",
        campaign_id=campaign_id,
    )
    campaign_dir = Path(quick["campaign_dir"])
    first = coc_toolbox.run_tool(
        "setup.complete",
        tmp_path,
        None,
        {"campaign_id": campaign_id, "decision_id": "handoff-3"},
    )
    assert first["ok"] is True, first
    result = first["data"]["result"]
    assert result["ready_for_table"] is True
    assert result["next"] == "table_opening"
    campaign = json.loads((campaign_dir / "campaign.json").read_text())
    assert campaign["status"] == "ready_for_table"
    assert campaign["active_scenario_id"] == "the-haunting"
    receipt = campaign["setup_handoff"]
    assert receipt["decision_id"] == "handoff-3"
    assert receipt["investigator_ids"] == ["thomas-hayes"]
    assert receipt["lane_interrupted_at_handoff"] is False
    replay = coc_toolbox.run_tool(
        "setup.complete",
        tmp_path,
        None,
        {"campaign_id": campaign_id, "decision_id": "handoff-3"},
    )
    assert replay["ok"] is True, replay
    assert replay["data"]["result"]["handoff"] == receipt


def test_setup_complete_after_active_status_from_link_is_idempotent(tmp_path: Path):
    """Chargen/link or compile_now may stamp status=active before handoff."""
    campaign_id = "active-after-link"
    quick = coc_starter.quick_start(
        tmp_path / ".coc",
        "the-haunting",
        "thomas-hayes",
        campaign_id=campaign_id,
    )
    campaign_dir = Path(quick["campaign_dir"])
    campaign_path = campaign_dir / "campaign.json"
    campaign = json.loads(campaign_path.read_text(encoding="utf-8"))
    campaign["status"] = "active"
    campaign["active_subsystem"] = "play"
    campaign_path.write_text(
        json.dumps(campaign, indent=2) + "\n", encoding="utf-8",
    )
    first = coc_toolbox.run_tool(
        "setup.complete",
        tmp_path,
        None,
        {"campaign_id": campaign_id, "decision_id": "handoff-active"},
    )
    assert first["ok"] is True, first
    result = first["data"]["result"]
    assert result["ready_for_table"] is True
    written = json.loads(campaign_path.read_text(encoding="utf-8"))
    assert written["status"] == "ready_for_table"
    receipt = written["setup_handoff"]
    assert receipt["decision_id"] == "handoff-active"
    assert receipt["investigator_ids"] == ["thomas-hayes"]
    replay = coc_toolbox.run_tool(
        "setup.complete",
        tmp_path,
        None,
        {"campaign_id": campaign_id, "decision_id": "handoff-active"},
    )
    assert replay["ok"] is True, replay
    assert replay["data"]["result"]["handoff"] == receipt


def test_setup_complete_source_bound_projected_succeeds(tmp_path: Path):
    campaign_id = "src-ready"
    campaign_dir = _make_campaign(tmp_path, campaign_id)
    _link_investigator(tmp_path, campaign_id, "inv-ok")
    _bind_source(campaign_dir, projected=True)
    envelope = coc_toolbox.run_tool(
        "setup.complete",
        tmp_path,
        None,
        {"campaign_id": campaign_id, "decision_id": "handoff-4"},
    )
    assert envelope["ok"] is True, envelope
    campaign = json.loads((campaign_dir / "campaign.json").read_text())
    assert campaign["status"] == "ready_for_table"
    assert campaign["setup_handoff"]["opening_projection_ref"]["kind"] == (
        "opening_projection_receipt"
    )


def _bind_playable_builtin(campaign_dir: Path, scenario_id: str = "lib-mod") -> None:
    campaign_path = campaign_dir / "campaign.json"
    campaign = json.loads(campaign_path.read_text(encoding="utf-8"))
    campaign["active_scenario_id"] = scenario_id
    campaign_path.write_text(
        json.dumps(campaign, indent=2) + "\n", encoding="utf-8",
    )
    scenario_dir = campaign_dir / "scenario"
    scenario_dir.mkdir(parents=True, exist_ok=True)
    (scenario_dir / "scenario.json").write_text(
        json.dumps({"schema_version": 1, "scenario_id": scenario_id}, indent=2)
        + "\n",
        encoding="utf-8",
    )
    for name in (
        "module-meta.json",
        "story-graph.json",
        "clue-graph.json",
        "npc-agendas.json",
        "threat-fronts.json",
        "pacing-map.json",
        "improvisation-boundaries.json",
    ):
        (scenario_dir / name).write_text("{}" + "\n", encoding="utf-8")


def _handoff_ready(tmp_path: Path, campaign_id: str) -> Path:
    campaign_dir = _make_campaign(tmp_path, campaign_id)
    _link_investigator(tmp_path, campaign_id, "inv-ok")
    _bind_playable_builtin(campaign_dir)
    completed = coc_toolbox.run_tool(
        "setup.complete",
        tmp_path,
        None,
        {"campaign_id": campaign_id, "decision_id": f"handoff-{campaign_id}"},
    )
    assert completed["ok"] is True, completed
    return campaign_dir


def _resume(tmp_path: Path, campaign_id: str) -> dict:
    resumed = coc_toolbox.run_tool(
        "session.resume", tmp_path, campaign_id, {},
    )
    assert resumed["ok"] is True, resumed
    return resumed


def _open_table(tmp_path: Path, campaign_id: str, decision_id: str) -> dict:
    opening = coc_toolbox.run_tool(
        "evidence.table_opening",
        tmp_path,
        campaign_id,
        {
            "text": "[in_game]\n桌子已经开场。\n[/in_game]",
            "run_id": f"run-{campaign_id}",
            "presented_roll_ids": [],
            "decision_id": decision_id,
        },
    )
    assert opening["ok"] is True, opening
    return opening


def _journal_and_finalize(root: Path, campaign_id: str, suffix: str) -> dict:
    journaled = coc_toolbox.run_tool(
        "state.journal",
        root,
        campaign_id,
        {
            "summary": f"玩家行动已在 {suffix} 中得到连续回应。",
            "player_action": "按当前场景中的既定方法继续调查",
            "player_text": "我先确认门边有没有人。",
            "player_speaker": "玩家",
            "run_id": f"run-{suffix}",
            "intent_class": "investigate",
            "decision_id": f"journal-{suffix}",
        },
    )
    assert journaled["ok"] is True, journaled
    output = coc_toolbox.run_tool(
        "turn.output_context", root, campaign_id, {},
    )
    assert output["ok"] is True, output
    setup = "调查员把刚才声明的方法落实在眼前的场景里。"
    consequence = "环境与在场人物据此给出明确、连续而带有自身立场的回应。"
    coverage = [
        {
            "obligation_id": row["obligation_id"],
            "realization": "fictional_beat",
            "action_realization": "调查员的具体方法已经在场景中发生",
            "response": "场景和相关人物作出了有因果联系的回应",
            "causal_explanation": "回应直接来自本轮已记录的玩家行动",
            "persona_fit": "保持调查员与在场人物既有的身份和立场",
            "player_input_handling": "specific_preserved",
            "exact_excerpt": consequence,
            "exceptional_beat": (
                "特殊结果已经造成与来源行动直接相连的实质改变"
                if row["exceptional_required"]
                else ""
            ),
        }
        for row in output["data"]["obligations"]
    ]
    placements = []
    for segment_type, source_key, after in (
        ("public_check", "roll_id", 0),
        ("state_delta", "effect_id", 1),
        ("exceptional_effect", "event_id", 1),
    ):
        rows = output["data"]["mechanics_bundle"].get(segment_type) or []
        if rows:
            placements.append({
                "after_paragraph": after,
                "segment_type": segment_type,
                "source_ids": [str(row[source_key]) for row in rows],
            })
    finalized = coc_toolbox.run_tool(
        "turn.finalize",
        root,
        campaign_id,
        {
            "draft": setup + "\n\n" + consequence,
            "coverage": coverage,
            "mechanics_placements": placements,
            "revision": 1,
            "decision_id": f"finalize-{suffix}",
        },
    )
    assert finalized["ok"] is True, finalized
    return finalized


def test_session_resume_ready_for_table_points_at_table_opening(tmp_path: Path):
    campaign_id = "resume-table"
    campaign_dir = _handoff_ready(tmp_path, campaign_id)
    resumed = _resume(tmp_path, campaign_id)
    assert resumed["data"]["mode"] == "table_opening"
    assert resumed["data"]["next_operations"] == ["evidence.table_opening"]
    assert "character_creation" not in resumed["data"]
    assert campaign_dir.is_dir()
    assert _LIVE_ONLY_NEXT.isdisjoint(set(resumed["data"]["next_operations"]))
    assert "opening" not in coc_toolbox.operation_policy("rules.roll")["phases"]
    assert "opening" not in coc_toolbox.operation_policy("state.journal")["phases"]
    assert "opening" not in coc_toolbox.operation_policy("turn.finalize")["phases"]


def test_untouched_quick_start_complete_resumes_at_table_opening(tmp_path: Path):
    workspace = tmp_path / "workspace"
    quick = coc_starter.quick_start(
        workspace / ".coc",
        "the-haunting",
        "thomas-hayes",
        campaign_id="active-starter-opening",
    )
    completed = coc_toolbox.run_tool(
        "setup.complete",
        workspace,
        quick["campaign_id"],
        {
            "campaign_id": quick["campaign_id"],
            "decision_id": "complete-active-starter-opening",
        },
    )
    assert completed["ok"] is True, completed
    resumed = _resume(workspace, quick["campaign_id"])
    assert resumed["data"]["mode"] == "table_opening"
    assert resumed["data"]["next_operations"] == ["evidence.table_opening"]


def test_session_resume_ready_for_table_with_opening_evidence_is_live(
    tmp_path: Path,
):
    campaign_id = "resume-opened"
    campaign_dir = _handoff_ready(tmp_path, campaign_id)
    _open_table(tmp_path, campaign_id, "opening-resume-opened")
    resumed = _resume(tmp_path, campaign_id)
    assert resumed["data"]["mode"] in _LIVE_RESUME_MODES
    assert resumed["data"]["mode"] != "table_opening"
    assert resumed["data"]["next_operations"] != ["evidence.table_opening"]
    campaign = json.loads((campaign_dir / "campaign.json").read_text())
    assert campaign["status"] == "ready_for_table"


def test_session_resume_ready_for_table_with_finalized_turn_is_live(
    tmp_path: Path,
):
    campaign_id = "resume-finalized"
    campaign_dir = _handoff_ready(tmp_path, campaign_id)
    _open_table(tmp_path, campaign_id, "opening-resume-finalized")
    _journal_and_finalize(tmp_path, campaign_id, "resume-finalized")
    resumed = _resume(tmp_path, campaign_id)
    assert resumed["data"]["mode"] in _LIVE_RESUME_MODES
    assert resumed["data"]["mode"] != "table_opening"
    assert resumed["data"]["next_operations"] != ["evidence.table_opening"]
    campaign = json.loads((campaign_dir / "campaign.json").read_text())
    assert campaign["status"] == "ready_for_table"


def test_session_resume_ready_for_table_keeps_unconfirmed_delivery_live(
    tmp_path: Path,
):
    workspace = tmp_path / "workspace"
    coc_root = workspace / ".coc"
    _write_json(
        coc_root / "runtime.json",
        {
            "schema_version": 2,
            "planner": {"kind": "deterministic"},
            "rules": {"kind": "deterministic"},
            "narrator": {"kind": "template"},
            "player": {"kind": "human"},
        },
    )
    campaign_id = "resume-delivery"
    quick = coc_starter.quick_start(
        coc_root,
        "the-haunting",
        "thomas-hayes",
        campaign_id=campaign_id,
        title="Ready For Table Delivery",
    )
    campaign_dir = Path(quick["campaign_dir"])
    campaign_path = campaign_dir / "campaign.json"
    campaign = json.loads(campaign_path.read_text(encoding="utf-8"))
    campaign["status"] = "ready_for_table"
    campaign_path.write_text(
        json.dumps(campaign, indent=2) + "\n", encoding="utf-8",
    )
    finalized = _journal_and_finalize(workspace, campaign_id, "delivery")
    resumed = _resume(workspace, campaign_id)
    assert resumed["data"]["mode"] in _LIVE_RESUME_MODES
    assert resumed["data"]["mode"] != "table_opening"
    assert resumed["data"]["next_operations"] != ["evidence.table_opening"]
    assert resumed["data"]["delivery"]["status"] == "unconfirmed"
    assert resumed["data"]["delivery"]["finalization_id"] == (
        finalized["data"]["finalization_id"]
    )
    assert any(
        "exact Keeper output may not have reached the player" in hint
        or "replay only delivery.exact_text" in hint
        for hint in resumed.get("hints") or []
    )
    written = json.loads(campaign_path.read_text(encoding="utf-8"))
    assert written["status"] == "ready_for_table"
