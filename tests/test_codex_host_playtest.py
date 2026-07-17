import hashlib
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest


SCRIPT = Path("plugins/coc-keeper/scripts/coc_codex_host_playtest.py")


def _load():
    spec = importlib.util.spec_from_file_location("coc_codex_host_playtest_test", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _canonical_sha(value):
    return hashlib.sha256(
        json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()


def _record(actor_id, turn, *, narration="墙上的裂痕在烛光下像一条细线。"):
    request = {
        "narration": "门厅里很安静。",
        "character_card": {"name": "艾达"},
        "transcript_tail": [],
        "pending_choice": None,
        "play_language": "zh-Hans",
    }
    binding = {
        "schema_version": 1,
        "protocol": "codex_subagent_player_v1",
        "actor_id": actor_id,
        "turn": turn,
        "request": request,
    }
    request_sha = _canonical_sha(binding)
    envelope = {
        **binding,
        "type": "player_request",
        "request_sha256": request_sha,
    }
    response = {
        "schema_version": 1,
        "protocol": "codex_subagent_player_v1",
        "actor_id": actor_id,
        "turn": turn,
        "request_sha256": request_sha,
        "player_text": "我检查墙上的裂痕。",
        "intent_class": "investigate",
    }
    return {
        "schema_version": 1,
        "player_request": envelope,
        "subagent_response": response,
        "kp_narration": narration,
    }


def _prepare_workspace(workspace, *, campaign_id="haunting", investigator_id="ada"):
    campaign = workspace / ".coc" / "campaigns" / campaign_id
    logs = campaign / "logs"
    save = campaign / "save"
    scenario = campaign / "scenario"
    logs.mkdir(parents=True)
    (save / "investigator-state").mkdir(parents=True)
    scenario.mkdir()
    (logs / "toolbox-calls.jsonl").write_text('{"before":"run"}\n', encoding="utf-8")
    (logs / "rolls.jsonl").write_text("", encoding="utf-8")
    (logs / "events.jsonl").write_text("", encoding="utf-8")
    (logs / "time.jsonl").write_text("", encoding="utf-8")
    (campaign / "campaign.json").write_text(
        json.dumps({"schema_version": 1, "campaign_id": campaign_id, "title": "鬼屋"}),
        encoding="utf-8",
    )
    (campaign / "party.json").write_text(
        json.dumps({"schema_version": 1, "campaign_id": campaign_id, "investigator_ids": [investigator_id]}),
        encoding="utf-8",
    )
    (scenario / "module-meta.json").write_text(
        json.dumps({
            "schema_version": 1,
            "scenario_id": "the-haunting",
            "title": "鬼屋",
            "source_pdf": None,
            "author": "Fixture Authors",
        }),
        encoding="utf-8",
    )
    (scenario / "clue-graph.json").write_text(
        json.dumps({"schema_version": 1, "clues": [], "conclusions": []}),
        encoding="utf-8",
    )
    current_states = {
        "time-state.json": {
            "schema_version": 1,
            "campaign_id": campaign_id,
            "clock": {
                "elapsed_minutes": 0,
                "local_datetime": "1920-10-12T10:00:00",
                "display": "1920-10-12 10:00",
            },
        },
        "active-scene.json": {
            "schema_version": 1,
            "campaign_id": campaign_id,
            "scenario_id": "the-haunting",
            "scene_id": "entrance-hall",
        },
        "world-state.json": {
            "schema_version": 2,
            "campaign_id": campaign_id,
            "scenario_id": "the-haunting",
            "active_scene_id": "entrance-hall",
        },
        "flags.json": {
            "schema_version": 1,
            "campaign_id": campaign_id,
            "clues_found": {},
            "decisions": [],
            "flags": {},
        },
        "pacing-state.json": {
            "schema_version": 1,
            "campaign_id": campaign_id,
            "turn_number": 0,
        },
    }
    for name, value in current_states.items():
        (save / name).write_text(json.dumps(value), encoding="utf-8")
    (save / "investigator-state" / f"{investigator_id}.json").write_text(
        json.dumps({
            "schema_version": 1,
            "campaign_id": campaign_id,
            "investigator_id": investigator_id,
            "current_hp": 10,
            "current_san": 60,
            "current_mp": 12,
            "current_luck": 50,
            "conditions": [],
            "skill_checks_earned": [],
        }),
        encoding="utf-8",
    )
    investigator = workspace / ".coc" / "investigators" / investigator_id
    investigator.mkdir(parents=True)
    (investigator / "character.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "id": investigator_id,
                "name": "艾达",
                "occupation": "记者",
                "characteristics": {"POW": 60},
                "derived": {"HP": 10, "SAN": 60},
                "skills": {"Spot Hidden": 55, "Track": 30},
                "backstory": {
                    "ideology": "事实先于猜测。",
                    "traits_detail": "先观察，再行动。",
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    (investigator / "development.jsonl").write_text("", encoding="utf-8")
    return campaign, logs


def _new_run(tmp_path):
    module = _load()
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    _campaign, logs = _prepare_workspace(workspace)
    toolbox = logs / "toolbox-calls.jsonl"
    run_dir = tmp_path / "run"
    state = module.init_run(
        run_dir,
        workspace=workspace,
        campaign_id="haunting",
        investigator_id="ada",
        player_actor_id="player-agent-01",
        player_task_id="/root/player-agent-01",
        orchestrator_id="main-codex",
        toolbox_log=toolbox,
    )
    return module, run_dir, toolbox, state


def _jsonl(path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


def _append_jsonl(path, row):
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")


def _pending_record(actor_id, turn):
    record = _record(actor_id, turn, narration="你接受风险，门锁发出清脆的一声。")
    pending = {
        "choice_id": "push-lock-1",
        "responder": "player",
        "revision": 1,
        "options": [
            {"action": "push", "label": "孤注一掷"},
            {"action": "decline", "label": "放弃"},
        ],
    }
    record["player_request"]["request"]["pending_choice"] = pending
    binding = {
        key: record["player_request"][key]
        for key in ("schema_version", "protocol", "actor_id", "turn", "request")
    }
    request_sha = _canonical_sha(binding)
    record["player_request"]["request_sha256"] = request_sha
    record["subagent_response"]["request_sha256"] = request_sha
    record["subagent_response"]["pending_choice_response"] = {
        "choice_id": "push-lock-1",
        "responder": "player",
        "revision": 1,
        "action": "push",
    }
    return record


def test_manual_codex_host_lifecycle_exports_current_schema_artifacts(tmp_path):
    module, run_dir, toolbox, state = _new_run(tmp_path)
    assert state["toolbox_log"]["initial_offset"] == len('{"before":"run"}\n'.encode())
    assert state["keeper_host"] == {
        "kind": "codex",
        "role": "main_orchestrator_keeper",
        "canonical_plugin_source": "plugins/coc-keeper/skills",
        "skill_loading": "orchestrator_attested",
        "attestation_level": "manual",
        "cryptographic_identity_attestation": False,
    }
    assert state["evidence_boundary"]["shared_fs_isolation"] == "NOT_ATTESTED"
    assert state["evidence_boundary"]["automatic_upgrade"] is False

    appended = '{"tool":"rules.check","decision_id":"turn-1"}\n'
    with toolbox.open("a", encoding="utf-8") as handle:
        handle.write(appended)
    turn = module.append_turn(run_dir, _record("player-agent-01", 1))
    assert turn["toolbox_log"]["start_offset"] == state["toolbox_log"]["initial_offset"]
    assert turn["toolbox_log"]["byte_length"] == len(appended.encode())
    assert (run_dir / turn["toolbox_log"]["snapshot_path"]).read_text() == appended
    assert turn["roll_log"]["byte_length"] == 0
    assert turn["event_log"]["byte_length"] == 0
    assert len(turn["row_sha256"]) == 64

    manifest = module.finalize_run(run_dir)
    assert set(module.FINAL_ARTIFACTS).issubset(manifest["artifacts"])
    assert manifest["evidence_boundary"]["evidence_grade"] == "NOT_ATTESTED"
    receipt = module.verify_run(run_dir)
    assert receipt["valid"] is True
    assert receipt["eligible_as_gameplay_evidence"] is False

    transcript = _jsonl(run_dir / "transcript.jsonl")
    assert [(row["role"], row["text"]) for row in transcript] == [
        ("player_simulator", "我检查墙上的裂痕。"),
        ("keeper_under_test", "墙上的裂痕在烛光下像一条细线。"),
    ]
    player_view = _jsonl(run_dir / "player-view.jsonl")
    assert player_view[0]["player_safe_attestation"] == "orchestrator_attested"
    assert player_view[0]["shared_fs_isolation"] == "NOT_ATTESTED"
    keeper_view = _jsonl(run_dir / "keeper-view.jsonl")
    assert keeper_view[0]["toolbox_log"]["sha256"] == turn["toolbox_log"]["sha256"]
    invocations = _jsonl(run_dir / "runner-invocations.jsonl")
    assert [(row["role"], row["actor_id"]) for row in invocations] == [
        ("player", "player-agent-01"),
        ("narrator", "main-codex"),
    ]
    assert invocations[0]["task_id"] == "/root/player-agent-01"
    assert invocations[0]["identity_attestation"] == "orchestrator_attested"
    playtest = json.loads((run_dir / "playtest.json").read_text())
    assert playtest["simulation_method"] == "main_codex_canonical_plugin_manual_orchestration"
    assert playtest["eligible_as_gameplay_evidence"] is False
    assert playtest["automatic_evidence_upgrade"] is False


def test_current_recorder_renders_ineligible_actual_play_battle_report_with_complete_dice(tmp_path):
    module, run_dir, toolbox, _state = _new_run(tmp_path)
    campaign_logs = toolbox.parent
    clue_graph = campaign_logs.parent / "scenario" / "clue-graph.json"
    clue_graph.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "conclusions": [
                    {
                        "id": "archive",
                        "clues": [
                            {
                                "clue_id": "clue-archive-date",
                                "player_safe_summary": "旧档案把火灾日期指向1878年。",
                                "visibility": "player-safe",
                            }
                        ],
                    }
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    _append_jsonl(toolbox, {"tool": "rules.check", "decision_id": "t1-roll"})
    _append_jsonl(
        campaign_logs / "rolls.jsonl",
        {
            "event_type": "roll",
            "type": "roll",
            "actor": "ada",
            "visibility": "public",
            "roll_id": "codex-host-roll-001",
            "payload": {
                "roll_id": "codex-host-roll-001",
                "investigator_id": "ada",
                "skill": "Spot Hidden",
                "target": 55,
                "effective_target": 55,
                "difficulty": "regular",
                "bonus": 0,
                "penalty": 0,
                "roll": 23,
                "outcome": "hard_success",
                "pushed": False,
                "reason": "检查门厅裂痕",
            },
        },
    )
    _append_jsonl(
        campaign_logs / "events.jsonl",
        {
            "event_type": "scene_transition",
            "from_scene_id": "front-door",
            "to_scene_id": "entrance-hall",
            "summary": "艾达从门前进入门厅。",
        },
    )
    _append_jsonl(
        campaign_logs / "events.jsonl",
        {
            "event_type": "clue_discovered",
            "clue_id": "clue-archive-date",
            "method": "检查墙面",
        },
    )
    _append_jsonl(
        campaign_logs / "events.jsonl",
        {
            "event_type": "storylet_move",
            "storylet_id": "hall-light-flicker",
            "cue": "门厅灯光忽明忽暗，强化了宅邸正在回应调查者的感觉",
            "summary": "门厅灯光忽明忽暗，强化了宅邸正在回应调查者的感觉。",
        },
    )
    _append_jsonl(
        campaign_logs / "events.jsonl",
        {
            "event_type": "npc_engagement",
            "npc_id": "archive-clerk",
            "interaction_count": 1,
        },
    )
    module.append_turn(run_dir, _record("player-agent-01", 1))
    _append_jsonl(toolbox, {"tool": "state.set_flag", "decision_id": "t2-choice"})
    _append_jsonl(
        campaign_logs / "events.jsonl",
        {
            "event_type": "turn",
            "turn_number": 2,
            "player_action": "接受孤注一掷",
            "summary": "艾达接受风险并继续开锁。",
        },
    )
    pending_record = _pending_record("player-agent-01", 2)
    pending_record["subagent_response"]["player_text"] = "自由文本里故意写放弃，但结构化动作仍是 push。"
    module.append_turn(run_dir, pending_record)

    campaign = campaign_logs.parent
    (campaign_logs / "time.jsonl").write_text(
        json.dumps({
            "event_type": "time_advance",
            "seq": 1,
            "current_time": {
                "elapsed_minutes": 110,
                "display": "1920-10-12 11:50",
                "local_datetime": "1920-10-12T11:50:00",
                "day_phase": "morning",
            },
        }) + "\n",
        encoding="utf-8",
    )
    (campaign / "save" / "time-state.json").write_text(
        json.dumps({
            "schema_version": 1,
            "campaign_id": "haunting",
            "clock": {
                "elapsed_minutes": 110,
                "display": "1920-10-12 11:50",
                "local_datetime": "1920-10-12T11:50:00",
            },
        }),
        encoding="utf-8",
    )
    (campaign / "save" / "active-scene.json").write_text(
        json.dumps({
            "schema_version": 1,
            "campaign_id": "haunting",
            "scenario_id": "the-haunting",
            "scene_id": "hall-of-records",
        }),
        encoding="utf-8",
    )
    (campaign / "save" / "world-state.json").write_text(
        json.dumps({
            "schema_version": 2,
            "campaign_id": "haunting",
            "scenario_id": "the-haunting",
            "active_scene_id": "hall-of-records",
        }),
        encoding="utf-8",
    )
    (campaign / "save" / "investigator-state" / "ada.json").write_text(
        json.dumps({
            "schema_version": 1,
            "campaign_id": "haunting",
            "investigator_id": "ada",
            "current_hp": 9,
            "current_san": 57,
            "current_mp": 11,
            "current_luck": 49,
            "conditions": [],
            "skill_checks_earned": ["Spot Hidden"],
        }),
        encoding="utf-8",
    )
    development = tmp_path / "workspace" / ".coc" / "investigators" / "ada" / "development.jsonl"
    _append_jsonl(
        development,
        {
            "schema_version": 2,
            "event_type": "development_check_earned",
            "investigator_id": "ada",
            "campaign_id": "haunting",
            "session_id": "haunting:session:1",
            "source_kind": "rules.roll",
            "source_event_id": "rules.roll:t1-roll",
            "skill": "Spot Hidden",
            "roll": 23,
        },
    )

    manifest = module.finalize_run(run_dir)
    report = run_dir / "artifacts" / "battle-report.md"
    completeness_path = run_dir / "artifacts" / "report-completeness.json"
    assert report.is_file()
    assert not (run_dir / "artifacts" / "verification-sample.md").exists()
    report_text = report.read_text(encoding="utf-8")
    assert "ACTUAL PLAY, EVIDENCE-INELIGIBLE" in report_text
    assert "NOT_ATTESTED" in report_text
    assert "我检查墙上的裂痕。" in report_text
    assert "你接受风险，门锁发出清脆的一声。" in report_text
    assert "艾达" in report_text
    assert "clue-archive-date" in report_text or "1878" in report_text
    assert "hall-light-flicker" in report_text
    assert "门厅灯光忽明忽暗" in report_text
    assert "codex-host-roll-001" in report_text
    assert "第 2 轮：孤注一掷" in report_text
    assert "decision-action: push" in report_text
    decision_section = report_text.split("report-anchor: Major Player Decisions", 1)[1].split(
        "report-anchor: Rules & Rolls Recap", 1
    )[0]
    assert "decision-action: decline" not in decision_section
    assert "自由文本里故意写放弃" not in decision_section
    assert "结构化意图：investigate" in report_text
    assert "已获得成长标记: 侦查" in report_text
    assert "骰值: 23" in report_text
    assert "来源事件: rules.roll:t1-roll" in report_text
    assert "最终记录状态" in report_text
    assert "1920-10-12 11:50" in report_text
    assert "hall-of-records" in report_text
    assert "HP 9, SAN 57, MP 11, 幸运 49" in report_text
    assert "时段：上午" in report_text
    assert "可计入官方证据的外部模型回合: 0" in report_text
    assert "已验证录制玩家回合: 2" in report_text
    assert "Official evidence external model turns: 0" in report_text
    assert "Verified recorded player turns: 2" in report_text
    assert "manual_orchestrator_attestation_only" in report_text
    assert "evidence_receipt_missing" not in report_text
    assert "Fixture Authors" in report_text
    assert "追踪: 30" in report_text
    assert "信念/理念: 事实先于猜测。" in report_text
    assert "特质详情: 先观察，再行动。" in report_text
    assert "npc_engagement×1" in report_text
    assert "未在本节展开" in report_text
    assert "已在对应章节呈现" not in report_text
    assert "report-anchor: rules-and-dice" in report_text
    completeness = json.loads(completeness_path.read_text(encoding="utf-8"))
    assert completeness["passed"] is True
    assert completeness["source_roll_count"] == 1
    assert completeness["required_public_roll_count"] == 1
    assert completeness["rendered_public_roll_count"] == 1
    assert manifest["report_contract_status"] == "INELIGIBLE"
    assert manifest["report_completeness_passed"] is True
    playtest = json.loads((run_dir / "playtest.json").read_text(encoding="utf-8"))
    assert playtest["actual_play_occurred"] is True
    assert playtest["eligible_as_gameplay_evidence"] is False
    assert playtest["evidence_grade"] == "NOT_ATTESTED"
    assert playtest["collaboration_attestation"] == "NOT_ATTESTED"
    assert playtest["shared_fs_isolation"] == "NOT_ATTESTED"
    assert module.verify_run(run_dir)["valid"] is True

    source_manifest = json.loads((run_dir / "report-source-manifest.json").read_text())
    assert set(source_manifest["authoritative_logs"]) == {"rolls", "events", "toolbox", "time"}
    for relative in (
        "logs/time.jsonl",
        "save/time-state.json",
        "save/active-scene.json",
        "save/world-state.json",
        "save/flags.json",
        "save/pacing-state.json",
        "save/investigator-state/ada.json",
    ):
        exported = f"sandbox/.coc/campaigns/haunting/{relative}"
        assert exported in source_manifest["artifacts"]
        assert exported in manifest["artifacts"]

    # The canonical verifier recomputes from the exported source log. Removing
    # one rendered roll never gets repaired from narration or toolbox args.
    report.write_text(
        "\n".join(
            line for line in report_text.splitlines() if "[roll-id: codex-host-roll-001]" not in line
        )
        + "\n",
        encoding="utf-8",
    )
    eval_script = Path("plugins/coc-keeper/scripts/coc_eval.py")
    failed = subprocess.run(
        [sys.executable, str(eval_script), "verify", str(run_dir)],
        check=False,
        capture_output=True,
        text=True,
    )
    failed_payload = json.loads(failed.stdout)
    assert failed.returncode != 0
    assert failed_payload["status"] == "FAIL"
    assert failed_payload["report_completeness"]["missing_roll_ids"] == ["codex-host-roll-001"]

    regenerated = subprocess.run(
        [sys.executable, str(eval_script), "report", str(run_dir)],
        check=False,
        capture_output=True,
        text=True,
    )
    regenerated_payload = json.loads(regenerated.stdout)
    assert regenerated_payload["status"] == "INELIGIBLE"
    exported_roll_log = (
        run_dir
        / "sandbox"
        / ".coc"
        / "campaigns"
        / "haunting"
        / "logs"
        / "rolls.jsonl"
    )
    exported_roll_log.unlink()
    missing_source = subprocess.run(
        [sys.executable, str(eval_script), "verify", str(run_dir)],
        check=False,
        capture_output=True,
        text=True,
    )
    missing_source_payload = json.loads(missing_source.stdout)
    assert missing_source.returncode != 0
    assert missing_source_payload["status"] == "FAIL"
    assert missing_source_payload["report_completeness"]["source_logs_present"] is False


def test_missing_transcript_cannot_preserve_actual_play_report_classification(tmp_path):
    module, run_dir, toolbox, _state = _new_run(tmp_path)
    with toolbox.open("a", encoding="utf-8") as handle:
        handle.write('{"tool":"state.record_clue"}\n')
    module.append_turn(run_dir, _record("player-agent-01", 1))
    module.finalize_run(run_dir)
    (run_dir / "transcript.jsonl").unlink()
    report_module_path = Path("plugins/coc-keeper/scripts/coc_playtest_report.py")
    spec = importlib.util.spec_from_file_location("coc_report_missing_transcript", report_module_path)
    report_module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(report_module)
    generated = report_module.generate_battle_report(run_dir)
    assert generated.name == "verification-sample.md"
    assert not (run_dir / "artifacts" / "battle-report.md").exists()


def test_forged_metadata_and_transcript_roles_do_not_self_attest_actual_play(tmp_path):
    run_dir = tmp_path / "forged-run"
    run_dir.mkdir()
    (run_dir / "playtest.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "run_id": "forged-run",
                "campaign_id": "haunting",
                "recorder_protocol": "codex_host_manual_playtest_v2",
                "actual_play_occurred": True,
                "play_kind": "blind_actual_play",
                "report_kind": "battle_report",
                "eligible_as_gameplay_evidence": False,
                "evidence_grade": "NOT_ATTESTED",
                "shared_fs_isolation": "NOT_ATTESTED",
                "play_language": "zh-Hans",
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    (run_dir / "transcript.jsonl").write_text(
        "".join(
            json.dumps(row, ensure_ascii=False) + "\n"
            for row in (
                {"turn": 1, "role": "player_simulator", "text": "我调查。"},
                {"turn": 1, "role": "keeper_under_test", "text": "你发现线索。"},
            )
        ),
        encoding="utf-8",
    )
    report_module_path = Path("plugins/coc-keeper/scripts/coc_playtest_report.py")
    spec = importlib.util.spec_from_file_location("coc_report_forged_recorder", report_module_path)
    report_module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(report_module)
    generated = report_module.generate_battle_report(run_dir)
    assert generated.name == "verification-sample.md"
    assert not (run_dir / "artifacts" / "battle-report.md").exists()


def test_hash_chain_and_projection_verification_detect_tampering(tmp_path):
    module, run_dir, toolbox, _ = _new_run(tmp_path)
    with toolbox.open("a", encoding="utf-8") as handle:
        handle.write('{"tool":"state.append"}\n')
    module.append_turn(run_dir, _record("player-agent-01", 1))
    module.finalize_run(run_dir)

    rows = _jsonl(run_dir / "turns.jsonl")
    rows[0]["keeper_narration"]["text"] = "tampered"
    (run_dir / "turns.jsonl").write_text(
        "".join(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in rows),
        encoding="utf-8",
    )
    receipt = module.verify_run(run_dir)
    assert receipt["valid"] is False
    assert "turn_row_hash_mismatch:1" in receipt["findings"]


def test_recorder_rejects_old_save_instead_of_migrating(tmp_path):
    module = _load()
    run_dir = tmp_path / "old-run"
    run_dir.mkdir()
    (run_dir / module.STATE_NAME).write_text(
        json.dumps(
            {
                "schema_version": 1,
                "protocol": "codex_host_manual_playtest_v1",
                "turns": [],
            }
        ),
        encoding="utf-8",
    )
    (run_dir / module.SOURCE_NAME).write_text("", encoding="utf-8")
    with pytest.raises(module.RecorderError, match="delete the run and restart") as error:
        module.append_turn(run_dir, _record("player-agent-01", 1))
    assert error.value.code == "unsupported_save_schema"


def test_finalize_rejects_authoritative_log_bytes_not_bound_to_a_turn(tmp_path):
    module, run_dir, toolbox, _ = _new_run(tmp_path)
    with toolbox.open("a", encoding="utf-8") as handle:
        handle.write('{"tool":"rules.check"}\n')
    module.append_turn(run_dir, _record("player-agent-01", 1))
    _append_jsonl(
        toolbox.parent / "rolls.jsonl",
        {
            "event_type": "roll",
            "actor": "ada",
            "visibility": "public",
            "roll_id": "late-unbound-roll",
            "payload": {
                "skill": "Spot Hidden",
                "target": 55,
                "effective_target": 55,
                "roll": 44,
                "outcome": "success",
            },
        },
    )
    with pytest.raises(module.RecorderError) as error:
        module.finalize_run(run_dir)
    assert error.value.code == "uncaptured_source_log_bytes"


def test_finalize_rejects_noncurrent_report_state_schema(tmp_path):
    module, run_dir, toolbox, _ = _new_run(tmp_path)
    with toolbox.open("a", encoding="utf-8") as handle:
        handle.write('{"tool":"state.set_flag"}\n')
    module.append_turn(run_dir, _record("player-agent-01", 1))
    world_state = toolbox.parent.parent / "save" / "world-state.json"
    payload = json.loads(world_state.read_text(encoding="utf-8"))
    payload["schema_version"] = 1
    world_state.write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(module.RecorderError) as error:
        module.finalize_run(run_dir)
    assert error.value.code == "unsupported_report_context_schema"


def test_verify_rejects_tampered_current_state_snapshot(tmp_path):
    module, run_dir, toolbox, _ = _new_run(tmp_path)
    with toolbox.open("a", encoding="utf-8") as handle:
        handle.write('{"tool":"state.set_flag"}\n')
    module.append_turn(run_dir, _record("player-agent-01", 1))
    module.finalize_run(run_dir)
    snapshot = run_dir / "sandbox/.coc/campaigns/haunting/save/time-state.json"
    payload = json.loads(snapshot.read_text(encoding="utf-8"))
    payload["clock"]["display"] = "tampered"
    snapshot.write_text(json.dumps(payload), encoding="utf-8")
    receipt = module.verify_run(run_dir)
    assert receipt["valid"] is False
    assert any(finding.startswith("report_snapshot_mismatch:") for finding in receipt["findings"])


def test_recorder_checks_protocol_binding_but_does_not_audit_narrative(tmp_path):
    module, run_dir, toolbox, _ = _new_run(tmp_path)
    with toolbox.open("a", encoding="utf-8") as handle:
        handle.write("{}\n")
    free_narration = "不论场景状态如何，这段叙事都只被记录，不由 recorder 判定是否合法。"
    row = module.append_turn(
        run_dir,
        _record("player-agent-01", 1, narration=free_narration),
    )
    assert row["keeper_narration"]["text"] == free_narration

    bad = _record("player-agent-01", 2)
    bad["subagent_response"]["actor_id"] = "another-agent"
    with pytest.raises(module.RecorderError) as error:
        module.append_turn(run_dir, bad)
    assert error.value.code == "subagent_response_binding_mismatch"


def test_cli_supports_init_append_finalize_and_verify(tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    _campaign, logs = _prepare_workspace(workspace)
    toolbox = logs / "toolbox-calls.jsonl"
    run_dir = tmp_path / "cli-run"
    common = [sys.executable, str(SCRIPT)]
    initialized = subprocess.run(
        [
            *common,
            "init",
            "--run-dir",
            str(run_dir),
            "--workspace",
            str(workspace),
            "--campaign",
            "haunting",
            "--investigator",
            "ada",
            "--player-actor-id",
            "player-agent-01",
            "--player-task-id",
            "/root/player-agent-01",
            "--toolbox-log",
            str(toolbox),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    assert json.loads(initialized.stdout)["ok"] is True
    with toolbox.open("a", encoding="utf-8") as handle:
        handle.write('{"tool":"rules.check"}\n')
    record_path = tmp_path / "turn.json"
    record_path.write_text(
        json.dumps(_record("player-agent-01", 1), ensure_ascii=False),
        encoding="utf-8",
    )
    for command in (
        ["append-turn", "--run-dir", str(run_dir), "--record-json", str(record_path)],
        ["finalize", "--run-dir", str(run_dir)],
    ):
        completed = subprocess.run(
            [*common, *command], check=True, capture_output=True, text=True
        )
        assert json.loads(completed.stdout)["ok"] is True
    verified = subprocess.run(
        [*common, "verify", "--run-dir", str(run_dir)],
        check=True,
        capture_output=True,
        text=True,
    )
    assert json.loads(verified.stdout)["valid"] is True


def test_pending_choice_response_is_required_iff_request_has_pending_choice(tmp_path):
    module, run_dir, toolbox, _ = _new_run(tmp_path)
    with toolbox.open("a", encoding="utf-8") as handle:
        handle.write("{}\n")

    spurious = _record("player-agent-01", 1)
    spurious["subagent_response"]["pending_choice_response"] = {
        "choice_id": "push-1",
        "responder": "player",
        "revision": 1,
        "action": "accept",
    }
    with pytest.raises(module.RecorderError) as error:
        module.append_turn(run_dir, spurious)
    assert error.value.code == "invalid_subagent_response"

    pending = _record("player-agent-01", 1)
    pending["player_request"]["request"]["pending_choice"] = {
        "choice_id": "push-1",
        "responder": "player",
        "revision": 1,
        "options": [
            {"action": "accept", "label": "孤注一掷"},
            {"action": "decline", "label": "放弃"},
        ],
    }
    binding = {
        key: pending["player_request"][key]
        for key in ("schema_version", "protocol", "actor_id", "turn", "request")
    }
    request_sha = _canonical_sha(binding)
    pending["player_request"]["request_sha256"] = request_sha
    pending["subagent_response"]["request_sha256"] = request_sha
    with pytest.raises(module.RecorderError) as error:
        module.append_turn(run_dir, pending)
    assert error.value.code == "invalid_subagent_response"

    pending["subagent_response"]["pending_choice_response"] = {
        "choice_id": "push-1",
        "responder": "player",
        "revision": 1,
        "action": "not-an-option",
    }
    with pytest.raises(module.RecorderError) as error:
        module.append_turn(run_dir, pending)
    assert error.value.code == "pending_choice_binding_mismatch"

    pending["subagent_response"]["pending_choice_response"]["action"] = "accept"
    row = module.append_turn(run_dir, pending)
    assert row["turn_number"] == 1


def test_exact_schema_rejects_nested_legacy_fields_even_with_recomputed_hash(tmp_path):
    module, run_dir, toolbox, _ = _new_run(tmp_path)
    state_path = run_dir / module.STATE_NAME
    state = json.loads(state_path.read_text(encoding="utf-8"))
    state["keeper_host"]["legacy_host_field"] = True
    state_path.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
    with pytest.raises(module.RecorderError) as error:
        module.append_turn(run_dir, _record("player-agent-01", 1))
    assert error.value.code == "unsupported_save_schema"

    state["keeper_host"].pop("legacy_host_field")
    state_path.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
    with toolbox.open("a", encoding="utf-8") as handle:
        handle.write("{}\n")
    module.append_turn(run_dir, _record("player-agent-01", 1))
    rows = _jsonl(run_dir / module.SOURCE_NAME)
    rows[0]["actor_binding"]["legacy_actor_field"] = "old-format"
    without_sha = dict(rows[0])
    without_sha.pop("row_sha256")
    rows[0]["row_sha256"] = _canonical_sha(without_sha)
    (run_dir / module.SOURCE_NAME).write_text(
        json.dumps(rows[0], ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    state = json.loads(state_path.read_text(encoding="utf-8"))
    state["chain_head_sha256"] = rows[0]["row_sha256"]
    state_path.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")

    receipt = module.verify_run(run_dir)
    assert receipt["valid"] is False
    assert "turn_nested_schema_invalid:1" in receipt["findings"]
