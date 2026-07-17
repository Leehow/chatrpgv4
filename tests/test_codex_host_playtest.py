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


def _new_run(tmp_path):
    module = _load()
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    toolbox = workspace / "toolbox-calls.jsonl"
    toolbox.write_text('{"before":"run"}\n', encoding="utf-8")
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
        json.dumps({"schema_version": 0, "turns": []}), encoding="utf-8"
    )
    (run_dir / module.SOURCE_NAME).write_text("", encoding="utf-8")
    with pytest.raises(module.RecorderError, match="delete the run and restart") as error:
        module.append_turn(run_dir, _record("player-agent-01", 1))
    assert error.value.code == "unsupported_save_schema"


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
    toolbox = workspace / "toolbox-calls.jsonl"
    toolbox.write_text("", encoding="utf-8")
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
