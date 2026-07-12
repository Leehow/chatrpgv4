"""Long-lived public-SDK white-box playtest driver contracts."""
from __future__ import annotations

import importlib.util
import hashlib
import json
import os
import select
import signal
import shutil
import subprocess
import sys
import time
from pathlib import Path


REPO = Path(__file__).resolve().parents[1]
DRIVER = REPO / "plugins" / "coc-keeper" / "scripts" / "coc_interactive_playtest.py"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


runtime_fixture = _load(
    "interactive_runtime_fixture",
    REPO / "tests" / "test_playtest_checkpoint_runtime.py",
)


def _workspace(path: Path) -> Path:
    runtime_fixture._build_generation(path)
    runtime_fixture._write_json(path / ".coc" / "runtime.json", {
        "schema_version": 2,
        "planner": {"kind": "deterministic"},
        "rules": {"kind": "deterministic"},
        "narrator": {"kind": "pi"},
        "player": {"kind": "human"},
    })
    story_path = path / ".coc" / "campaigns" / "live" / "scenario" / "story-graph.json"
    story = json.loads(story_path.read_text(encoding="utf-8"))
    story["scenes"].append({
        "scene_id": "scene-3",
        "scene_type": "resolution",
        "dramatic_question": "Does the session conclude?",
        "entry_conditions": [],
        "exit_conditions": [],
        "available_clues": [],
        "npc_ids": [],
        "pressure_moves": [],
        "tone": ["quiet"],
        "allowed_improvisation": [],
    })
    runtime_fixture._write_json(story_path, story)
    return path


def _fake_node(tmp_path: Path, *, response_mode: str = "tool") -> tuple[Path, Path]:
    bindir = tmp_path / "fake-bin"
    bindir.mkdir()
    marker = tmp_path / "fake-narrator-closed"
    executable = bindir / "node"
    executable.write_text(
        """#!/usr/bin/env python3
import json, os, signal, sys
marker = os.environ.get("FAKE_NARRATOR_CLOSED")
calls = os.environ.get("FAKE_NARRATOR_CALLS")
def stop(_signum, _frame):
    if marker:
        open(marker, "w", encoding="utf-8").write("closed\\n")
    raise SystemExit(0)
signal.signal(signal.SIGTERM, stop)
mode = os.environ.get("FAKE_NARRATOR_MODE", "tool")
provider = os.environ.get("FAKE_NARRATOR_PROVIDER", "zhipu-coding")
model_id = os.environ.get("FAKE_NARRATOR_MODEL_ID", "glm-5.2")
for line in sys.stdin:
    request = json.loads(line)
    if calls:
        with open(calls, "a", encoding="utf-8") as handle:
            handle.write(request["request_id"] + "\\n")
    response = {
        "request_id": request["request_id"],
        "ok": True,
        "final_text": "门锁上的新鲜刮痕在灯下发亮。",
        "asserted_fact_refs": [],
        "semantic_audit": [],
        "secret_audit_complete": True,
        "model_identity": {"provider": provider, "id": model_id},
        "response_mode": mode,
    }
    print(json.dumps(response, ensure_ascii=False), flush=True)
""",
        encoding="utf-8",
    )
    executable.chmod(0o755)
    return bindir, marker


def _env(
    bindir: Path,
    marker: Path,
    *,
    response_mode: str = "tool",
    provider: str = "zhipu-coding",
    model_id: str = "glm-5.2",
) -> dict[str, str]:
    env = dict(os.environ)
    env["PATH"] = str(bindir) + os.pathsep + env.get("PATH", "")
    env["FAKE_NARRATOR_CLOSED"] = str(marker)
    env["FAKE_NARRATOR_CALLS"] = str(marker.parent / "fake-narrator-calls.jsonl")
    env["FAKE_NARRATOR_MODE"] = response_mode
    env["FAKE_NARRATOR_PROVIDER"] = provider
    env["FAKE_NARRATOR_MODEL_ID"] = model_id
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    return env


def _start_command(
    workspace: Path, run_dir: Path, *, max_turns: int = 5
) -> list[str]:
    return [
        sys.executable,
        str(DRIVER),
        "start",
        "--workspace", str(workspace),
        "--campaign", "live",
        "--investigator", "inv1",
        "--run-dir", str(run_dir),
        "--run-kind", "diagnostic_spoiler_run",
        "--rng-seed", "masks-run-a-20260712",
        "--max-turns", str(max_turns),
    ]


def _resume_command(run_dir: Path, checkpoint: Path) -> list[str]:
    return [
        sys.executable,
        str(DRIVER),
        "resume",
        "--run-dir", str(run_dir),
        "--checkpoint", str(checkpoint),
    ]


def _spawn(command: list[str], env: dict[str, str]) -> subprocess.Popen[str]:
    return subprocess.Popen(
        command,
        cwd=REPO,
        env=env,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )


def _read(proc: subprocess.Popen[str], timeout: float = 20.0) -> dict:
    assert proc.stdout is not None
    ready, _, _ = select.select([proc.stdout], [], [], timeout)
    if not ready:
        proc.kill()
        stderr = proc.stderr.read() if proc.stderr is not None else ""
        raise AssertionError(f"driver output timed out: {stderr}")
    line = proc.stdout.readline()
    if not line:
        stderr = proc.stderr.read() if proc.stderr is not None else ""
        raise AssertionError(f"driver exited without JSON output: {stderr}")
    return json.loads(line)


def _send(proc: subprocess.Popen[str], payload: dict) -> dict:
    assert proc.stdin is not None
    proc.stdin.write(json.dumps(payload, ensure_ascii=False) + "\n")
    proc.stdin.flush()
    return _read(proc)


def _send_raw(proc: subprocess.Popen[str], payload: str) -> dict:
    assert proc.stdin is not None
    proc.stdin.write(payload + "\n")
    proc.stdin.flush()
    return _read(proc)


def _turn(text: str, request_id: str) -> dict:
    return {
        "kind": "turn",
        "request_id": request_id,
        "player_input": text,
        "player_intent": {
            "primary_intent": "investigate",
            "secondary_intents": [],
            "target_entities": ["door"],
            "risk_posture": "cautious",
            "explicit_roll_request": False,
            "player_hypothesis": None,
            "action_atoms": [{"topic": "door", "verb": "examine"}],
            "npc_interactions": [],
        },
    }


def _assert_stdout_allowlisted(payload: dict, tmp_path: Path) -> None:
    encoded = json.dumps(payload, ensure_ascii=False)
    for forbidden in (
        str(tmp_path), "scenario_path", "campaign_dir", "narration_envelope",
        "keeper_secret", "director_rationale", "evaluator_text", "source_prose",
    ):
        assert forbidden not in encoded
    assert payload["kind"] in {
        "ready", "turn_result", "checkpoint_written", "terminal", "error"
    }
    if payload["kind"] in {"turn_result", "terminal"}:
        assert set(payload) <= {
            "kind", "turn_number", "events", "public_state", "attestation",
            "action_chain_sha256", "rng_seed", "ceiling_reached",
            "terminal_evidence", "terminal_kind",
        }


def test_subprocess_start_two_turns_hash_chain_initial_checkpoint_and_close_workers(
    tmp_path: Path,
):
    workspace = _workspace(tmp_path / "generation-original")
    run_dir = tmp_path / "run"
    bindir, marker = _fake_node(tmp_path)
    env = _env(bindir, marker)
    proc = _spawn(_start_command(workspace, run_dir), env)
    ready = _read(proc)
    assert ready["kind"] == "ready"
    assert ready["turn_number"] == 0

    first_action = _turn("我检查门锁。", "request-0001")
    second_action = _turn("我再检查门框。", "request-0002")
    first = _send(proc, first_action)
    second = _send(proc, second_action)
    assert first["kind"] == second["kind"] == "turn_result"
    assert second["turn_number"] == 2
    assert all(event["visibility"] == "player" for event in second["events"])
    _assert_stdout_allowlisted(second, tmp_path)

    proc.send_signal(signal.SIGTERM)
    assert proc.wait(timeout=10) == 0
    deadline = time.monotonic() + 2
    while not marker.exists() and time.monotonic() < deadline:
        time.sleep(0.02)
    assert marker.read_text(encoding="utf-8") == "closed\n"

    rows = [
        json.loads(line)
        for line in (run_dir / "actions.jsonl").read_text(encoding="utf-8").splitlines()
        if line
    ]
    assert [row["turn_number"] for row in rows] == [1, 2]
    assert rows[0]["previous_sha256"] == "0" * 64
    assert rows[1]["previous_sha256"] == rows[0]["row_sha256"]
    assert [row["provenance"]["rng_seed"] for row in rows] == [
        "masks-run-a-20260712:000001",
        "masks-run-a-20260712:000002",
    ]
    metadata = json.loads((run_dir / "run.json").read_text(encoding="utf-8"))
    current_git_head = subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=REPO, text=True
    ).strip()
    assert metadata["durable_turn_number"] == 2
    assert metadata["last_request_id"] == "request-0002"
    assert metadata["generation_counter"] == 0
    assert metadata["driver_identity"] == (
        "plugins/coc-keeper/scripts/coc_interactive_playtest.py"
    )
    assert metadata["driver_sha256"] == hashlib.sha256(DRIVER.read_bytes()).hexdigest()
    assert metadata["git_head"] == current_git_head
    assert rows[1]["provenance"]["driver_sha256"] == metadata["driver_sha256"]
    assert rows[1]["provenance"]["git_head"] == current_git_head
    assert metadata["current_public_state_sha256"] == hashlib.sha256(
        json.dumps(
            second["public_state"], ensure_ascii=False, sort_keys=True,
            separators=(",", ":"), allow_nan=False,
        ).encode("utf-8")
    ).hexdigest()
    manifest_bytes = (
        run_dir / "checkpoints" / "turn-000002" / "manifest.json"
    ).read_bytes()
    assert json.loads(manifest_bytes)["git_head"] == current_git_head
    assert metadata["latest_checkpoint_manifest_sha256"] == hashlib.sha256(
        manifest_bytes
    ).hexdigest()
    assert metadata["pending_model_session_boundary"] is None
    assert rows[1]["provenance"]["attestation"] == second["attestation"]
    assert rows[1]["provenance"]["decision_ids"]
    assert rows[1]["provenance"]["director_plan_refs"] == (
        rows[1]["provenance"]["decision_ids"]
    )
    assert rows[1]["provenance"]["usage"] == second["attestation"]["usage"]
    assert set(rows[1]["provenance"]["usage"]) == {
        "input_tokens", "output_tokens",
    }
    assert isinstance(rows[1]["provenance"]["narrator_llm_ms"], float)
    assert rows[1]["provenance"]["narrator_llm_ms"] >= 0.0
    assert rows[1]["provenance"]["narrator_llm_ms"] == (
        second["attestation"]["narrator_llm_ms"]
    )
    assert (run_dir / "checkpoints" / "turn-000000").is_dir()
    assert (run_dir / "checkpoints" / "turn-000002").is_dir()
    assert workspace.exists()

    marker.unlink()
    resume = _spawn(
        _resume_command(run_dir, run_dir / "checkpoints" / "turn-000002"),
        env,
    )
    resumed = _read(resume)
    assert resumed["kind"] == "ready"
    assert resumed["turn_number"] == 2
    assert resumed["last_request_id"] == "request-0002"
    calls_before_replay = (
        tmp_path / "fake-narrator-calls.jsonl"
    ).read_text(encoding="utf-8").splitlines()
    assert _send(resume, second_action) == second
    assert (
        tmp_path / "fake-narrator-calls.jsonl"
    ).read_text(encoding="utf-8").splitlines() == calls_before_replay
    third = _send(resume, _turn("我检查门后的脚印。", "request-0003"))
    assert third["kind"] == "turn_result"
    assert third["turn_number"] == 3
    _assert_stdout_allowlisted(third, tmp_path)
    resume.send_signal(signal.SIGTERM)
    assert resume.wait(timeout=10) == 0
    deadline = time.monotonic() + 2
    while not marker.exists() and time.monotonic() < deadline:
        time.sleep(0.02)
    assert marker.read_text(encoding="utf-8") == "closed\n"

    resumed_rows = [
        json.loads(line)
        for line in (run_dir / "actions.jsonl").read_text(encoding="utf-8").splitlines()
        if line
    ]
    assert [row["turn_number"] for row in resumed_rows] == [1, 2, 3]
    assert resumed_rows[2]["previous_sha256"] == resumed_rows[1]["row_sha256"]
    assert resumed_rows[2]["provenance"]["rng_seed"] == (
        "masks-run-a-20260712:000003"
    )
    assert resumed_rows[2]["provenance"]["model_session_boundary"] == {
        "kind": "resume", "after_turn": 2,
    }
    resumed_metadata = json.loads(
        (run_dir / "run.json").read_text(encoding="utf-8")
    )
    assert resumed_metadata["durable_turn_number"] == 3
    assert resumed_metadata["generation_counter"] == 1
    assert resumed_metadata["active_workspace_generation"] == "generation-000001"
    assert Path(resumed_metadata["active_workspace_path"]).is_dir()
    assert workspace.is_dir()
    calls = (tmp_path / "fake-narrator-calls.jsonl").read_text(
        encoding="utf-8"
    ).splitlines()
    assert len(calls) > len(calls_before_replay)


def test_hard_max_persists_one_turn_then_emits_ceiling_terminal_and_closes(
    tmp_path: Path,
):
    workspace = _workspace(tmp_path / "generation-max")
    run_dir = tmp_path / "run-max"
    bindir, marker = _fake_node(tmp_path)
    proc = _spawn(_start_command(workspace, run_dir, max_turns=1), _env(bindir, marker))
    assert _read(proc)["kind"] == "ready"
    first = _send(proc, _turn("我检查门锁。", "request-max-1"))
    assert first["kind"] == "terminal"
    assert first["terminal_kind"] == "turn_ceiling"
    assert first["ceiling_reached"] is True
    calls = (tmp_path / "fake-narrator-calls.jsonl").read_text(
        encoding="utf-8"
    ).splitlines()
    assert len(calls) == 1
    assert proc.wait(timeout=10) == 0
    assert marker.read_text(encoding="utf-8") == "closed\n"


def test_resume_recovers_complete_checkpoint_one_turn_ahead_of_metadata(
    tmp_path: Path,
):
    workspace = _workspace(tmp_path / "generation-cp-ahead")
    run_dir = tmp_path / "run-cp-ahead"
    bindir, marker = _fake_node(tmp_path)
    env = _env(bindir, marker)
    proc = _spawn(_start_command(workspace, run_dir), env)
    assert _read(proc)["kind"] == "ready"
    first_action = _turn("我检查门锁。", "request-ahead-1")
    second_action = _turn("我检查门框。", "request-ahead-2")
    assert _send(proc, first_action)["turn_number"] == 1
    metadata_after_one = json.loads(
        (run_dir / "run.json").read_text(encoding="utf-8")
    )
    second = _send(proc, second_action)
    assert second["turn_number"] == 2
    proc.send_signal(signal.SIGTERM)
    assert proc.wait(timeout=10) == 0

    (run_dir / "run.json").write_text(
        json.dumps(
            metadata_after_one, ensure_ascii=False, sort_keys=True,
            separators=(",", ":"), allow_nan=False,
        ) + "\n",
        encoding="utf-8",
    )
    calls_before = (tmp_path / "fake-narrator-calls.jsonl").read_text(
        encoding="utf-8"
    ).splitlines()
    resume = _spawn(
        _resume_command(run_dir, run_dir / "checkpoints" / "turn-000002"),
        env,
    )
    ready = _read(resume)
    assert ready["kind"] == "ready"
    assert ready["turn_number"] == 2
    assert ready["last_request_id"] == "request-ahead-2"
    assert _send(resume, second_action) == second
    assert (tmp_path / "fake-narrator-calls.jsonl").read_text(
        encoding="utf-8"
    ).splitlines() == calls_before
    assert _send(resume, {"kind": "stop"})["terminal_kind"] == "operator_stop"
    assert resume.wait(timeout=10) == 0
    recovered = json.loads((run_dir / "run.json").read_text(encoding="utf-8"))
    assert recovered["durable_turn_number"] == 2
    assert recovered["last_request_id"] == "request-ahead-2"
    assert recovered["generation_counter"] == 1


def test_resume_rejects_journal_ahead_of_selected_checkpoint_without_pointer_move(
    tmp_path: Path,
):
    workspace = _workspace(tmp_path / "generation-journal-ahead")
    run_dir = tmp_path / "run-journal-ahead"
    bindir, marker = _fake_node(tmp_path)
    env = _env(bindir, marker)
    proc = _spawn(_start_command(workspace, run_dir), env)
    assert _read(proc)["kind"] == "ready"
    assert _send(proc, _turn("我检查门锁。", "request-journal-1"))[
        "turn_number"
    ] == 1
    metadata_after_one = json.loads(
        (run_dir / "run.json").read_text(encoding="utf-8")
    )
    assert _send(proc, _turn("我检查门框。", "request-journal-2"))[
        "turn_number"
    ] == 2
    proc.send_signal(signal.SIGTERM)
    assert proc.wait(timeout=10) == 0
    (run_dir / "run.json").write_text(
        json.dumps(
            metadata_after_one, ensure_ascii=False, sort_keys=True,
            separators=(",", ":"), allow_nan=False,
        ) + "\n",
        encoding="utf-8",
    )
    before = (run_dir / "run.json").read_bytes()
    resume = _spawn(
        _resume_command(run_dir, run_dir / "checkpoints" / "turn-000001"),
        env,
    )
    assert _read(resume) == {
        "kind": "error", "code": "journal_ahead_of_checkpoint"
    }
    assert resume.wait(timeout=10) != 0
    assert (run_dir / "run.json").read_bytes() == before
    assert metadata_after_one["active_workspace_path"] == str(workspace)
    assert not (run_dir / "workspaces").exists()


def test_resume_rejects_state_session_and_manifest_tamper_without_pointer_move(
    tmp_path: Path,
):
    for attack, expected_code in (
        ("state", "resume_state_mismatch"),
        ("session", "resume_validation_failed"),
        ("manifest", "resume_validation_failed"),
        ("manifest_missing", "resume_validation_failed"),
        ("manifest_symlink", "resume_validation_failed"),
    ):
        case = tmp_path / attack
        case.mkdir()
        workspace = _workspace(case / "generation")
        run_dir = case / "run"
        bindir, marker = _fake_node(case)
        env = _env(bindir, marker)
        proc = _spawn(_start_command(workspace, run_dir), env)
        assert _read(proc)["kind"] == "ready"
        assert _send(proc, _turn("我检查门锁。", f"request-{attack}"))[
            "turn_number"
        ] == 1
        proc.send_signal(signal.SIGTERM)
        assert proc.wait(timeout=10) == 0

        checkpoint_dir = run_dir / "checkpoints" / "turn-000001"
        manifest_path = checkpoint_dir / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        metadata_path = run_dir / "run.json"
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        outside_sentinel = None
        if attack == "manifest":
            manifest_path.write_bytes(manifest_path.read_bytes() + b" ")
        elif attack == "manifest_missing":
            manifest_path.unlink()
        elif attack == "manifest_symlink":
            original_manifest = manifest_path.read_bytes()
            outside_sentinel = case / "outside-manifest.json"
            outside_sentinel.write_bytes(original_manifest)
            manifest_path.unlink()
            manifest_path.symlink_to(outside_sentinel)
        else:
            suffix = (
                ".coc/runtime/sessions.json"
                if attack == "session"
                else ".coc/campaigns/live/save/world-state.json"
            )
            entry = next(
                item for item in manifest["state_files"]
                if item["workspace_path"].endswith(suffix)
            )
            state_path = checkpoint_dir / entry["path"]
            value = json.loads(state_path.read_text(encoding="utf-8"))
            if attack == "session":
                value["sessions"][0]["session_id"] = "sess_tampered"
            else:
                value["active_scene_id"] = "scene-tampered"
            state_bytes = json.dumps(
                value, ensure_ascii=False, sort_keys=True,
                separators=(",", ":"), allow_nan=False,
            ).encode("utf-8") + b"\n"
            state_path.write_bytes(state_bytes)
            entry["sha256"] = hashlib.sha256(state_bytes).hexdigest()
            entry["size"] = len(state_bytes)
            if attack == "session":
                manifest["session_snapshot_sha256"] = entry["sha256"]
            manifest_bytes = json.dumps(
                manifest, ensure_ascii=False, sort_keys=True,
                separators=(",", ":"), allow_nan=False,
            ).encode("utf-8") + b"\n"
            manifest_path.write_bytes(manifest_bytes)
            metadata["latest_checkpoint_manifest_sha256"] = hashlib.sha256(
                manifest_bytes
            ).hexdigest()
            metadata_path.write_text(
                json.dumps(
                    metadata, ensure_ascii=False, sort_keys=True,
                    separators=(",", ":"), allow_nan=False,
                ) + "\n",
                encoding="utf-8",
            )
        pointer_before = metadata_path.read_bytes()
        resume = _spawn(_resume_command(run_dir, checkpoint_dir), env)
        assert _read(resume) == {"kind": "error", "code": expected_code}
        assert resume.wait(timeout=10) != 0
        assert metadata_path.read_bytes() == pointer_before
        assert json.loads(pointer_before)["active_workspace_path"] == str(workspace)
        if outside_sentinel is not None:
            assert outside_sentinel.read_bytes() == original_manifest


def test_resume_at_turn_ceiling_makes_no_model_call_and_closes(tmp_path: Path):
    workspace = _workspace(tmp_path / "generation-resume-ceiling")
    run_dir = tmp_path / "run-resume-ceiling"
    bindir, marker = _fake_node(tmp_path)
    env = _env(bindir, marker)
    proc = _spawn(_start_command(workspace, run_dir, max_turns=1), env)
    assert _read(proc)["kind"] == "ready"
    terminal = _send(proc, _turn("我检查门锁。", "request-ceiling-resume"))
    assert terminal["terminal_kind"] == "turn_ceiling"
    assert proc.wait(timeout=10) == 0
    calls_before = (tmp_path / "fake-narrator-calls.jsonl").read_text(
        encoding="utf-8"
    ).splitlines()
    marker.unlink()
    resume = _spawn(
        _resume_command(run_dir, run_dir / "checkpoints" / "turn-000001"),
        env,
    )
    assert _read(resume) == terminal
    assert resume.wait(timeout=10) == 0
    assert (tmp_path / "fake-narrator-calls.jsonl").read_text(
        encoding="utf-8"
    ).splitlines() == calls_before
    recovered = json.loads((run_dir / "run.json").read_text(encoding="utf-8"))
    assert recovered["generation_counter"] == 1
    assert recovered["pending_model_session_boundary"] == {
        "kind": "resume", "after_turn": 1,
    }


def test_run_directory_has_a_nonblocking_single_writer_lock(tmp_path: Path):
    workspace = _workspace(tmp_path / "generation-lock")
    run_dir = tmp_path / "run-lock"
    bindir, marker = _fake_node(tmp_path)
    env = _env(bindir, marker)
    owner = _spawn(_start_command(workspace, run_dir), env)
    assert _read(owner)["kind"] == "ready"
    contender = _spawn(_start_command(workspace, run_dir), env)
    assert _read(contender) == {"kind": "error", "code": "run_locked"}
    assert contender.wait(timeout=10) != 0
    stopped = _send(owner, {"kind": "stop"})
    assert stopped["kind"] == "terminal"
    assert stopped["terminal_kind"] == "operator_stop"
    assert stopped["terminal_evidence"]["reached_terminal"] is False
    assert owner.wait(timeout=10) == 0


def test_run_directory_parent_symlink_cannot_escape_to_outside(tmp_path: Path):
    workspace = _workspace(tmp_path / "generation-parent-symlink")
    outside = tmp_path / "outside"
    outside.mkdir()
    sentinel = outside / "sentinel.txt"
    sentinel.write_text("unchanged\n", encoding="utf-8")
    alias = tmp_path / "alias"
    alias.symlink_to(outside, target_is_directory=True)
    bindir, marker = _fake_node(tmp_path)
    proc = _spawn(
        _start_command(workspace, alias / "escaped-run"),
        _env(bindir, marker),
    )
    assert _read(proc) == {"kind": "error", "code": "run_directory_invalid"}
    assert proc.wait(timeout=10) != 0
    assert sentinel.read_text(encoding="utf-8") == "unchanged\n"
    assert sorted(path.name for path in outside.iterdir()) == ["sentinel.txt"]


def test_start_fails_closed_if_locked_run_directory_is_renamed_and_replaced(
    tmp_path: Path,
):
    driver = _load("interactive_driver_start_split_brain", DRIVER)
    workspace = _workspace(tmp_path / "generation-start-split")
    run_dir = tmp_path / "run-start-split"
    moved = tmp_path / "moved-locked-run"
    args = driver.argparse.Namespace(
        command="start",
        workspace=str(workspace),
        campaign="live",
        investigator="inv1",
        run_dir=str(run_dir),
        run_kind="diagnostic_spoiler_run",
        rng_seed="split-brain-seed",
        max_turns=5,
    )
    real_load_api = driver._load_runtime_api

    def swap_after_lock():
        run_dir.rename(moved)
        run_dir.mkdir()
        return real_load_api()

    driver._load_runtime_api = swap_after_lock
    driver.emit = lambda _payload: None
    driver._interactive_loop = lambda **_kwargs: 0
    try:
        try:
            driver._run_start(args)
            assert False, "renamed locked directory must fail closed"
        except driver.DriverError as exc:
            assert exc.code == "run_directory_replaced"
    finally:
        driver._load_runtime_api = real_load_api

    for root in (moved, run_dir):
        assert not (root / "run.json").exists()
        assert not (root / "checkpoints").exists()


def test_resume_fails_closed_if_locked_run_directory_is_renamed_and_replaced(
    tmp_path: Path,
):
    workspace = _workspace(tmp_path / "generation-resume-split")
    run_dir = tmp_path / "run-resume-split"
    bindir, marker = _fake_node(tmp_path)
    env = _env(bindir, marker)
    owner = _spawn(_start_command(workspace, run_dir), env)
    assert _read(owner)["kind"] == "ready"
    assert _send(owner, {"kind": "stop"})["terminal_kind"] == "operator_stop"
    assert owner.wait(timeout=10) == 0
    original_metadata = (run_dir / "run.json").read_bytes()
    original_checkpoints = sorted(
        path.relative_to(run_dir).as_posix()
        for path in (run_dir / "checkpoints").rglob("*")
    )

    driver = _load("interactive_driver_resume_split_brain", DRIVER)
    moved = tmp_path / "moved-resume-run"
    real_preflight = driver._preflight_resume

    def swap_after_lock(run_path, checkpoint, **kwargs):
        Path(run_path).rename(moved)
        shutil.copytree(moved, run_path)
        return real_preflight(run_path, checkpoint, **kwargs)

    driver._preflight_resume = swap_after_lock
    driver.emit = lambda _payload: None
    driver._interactive_loop = lambda **_kwargs: 0
    args = driver.argparse.Namespace(
        command="resume",
        run_dir=str(run_dir),
        checkpoint=str(run_dir / "checkpoints" / "turn-000000"),
    )
    try:
        try:
            driver._run_resume(args)
            assert False, "renamed locked resume directory must fail closed"
        except driver.DriverError as exc:
            assert exc.code == "run_directory_replaced"
    finally:
        driver._preflight_resume = real_preflight

    for root in (moved, run_dir):
        assert (root / "run.json").read_bytes() == original_metadata
        assert not (root / "workspaces").exists()
        assert sorted(
            path.relative_to(root).as_posix()
            for path in (root / "checkpoints").rglob("*")
        ) == original_checkpoints


def test_jsonl_parser_rejects_duplicates_nan_unknown_fields_and_long_lines(
    tmp_path: Path,
):
    workspace = _workspace(tmp_path / "generation-parser")
    run_dir = tmp_path / "run-parser"
    bindir, marker = _fake_node(tmp_path)
    proc = _spawn(_start_command(workspace, run_dir), _env(bindir, marker))
    assert _read(proc)["kind"] == "ready"
    assert _send_raw(proc, '{"kind":"checkpoint","kind":"stop"}') == {
        "kind": "error", "code": "malformed_jsonl"
    }
    assert _send_raw(proc, '{"kind":"turn","request_id":"nan","player_input":NaN,"player_intent":{}}') == {
        "kind": "error", "code": "malformed_jsonl"
    }
    poisoned = _turn("我检查门锁。", "request-poison")
    poisoned["keeper_secret"] = "x"
    assert _send(proc, poisoned) == {"kind": "error", "code": "invalid_input"}
    assert _send_raw(proc, '{"kind":"invented"}') == {
        "kind": "error", "code": "unknown_input_kind"
    }
    assert _send_raw(proc, " " * (1024 * 1024 + 1)) == {
        "kind": "error", "code": "jsonl_line_too_long"
    }
    checkpoint = _send(proc, {"kind": "checkpoint"})
    metadata = json.loads((run_dir / "run.json").read_text(encoding="utf-8"))
    assert checkpoint == {
        "kind": "checkpoint_written",
        "turn_number": 0,
        "action_chain_sha256": "0" * 64,
        "latest_checkpoint": metadata["latest_checkpoint"],
        "latest_checkpoint_manifest_sha256": metadata[
            "latest_checkpoint_manifest_sha256"
        ],
    }
    manifest = run_dir / checkpoint["latest_checkpoint"] / "manifest.json"
    assert hashlib.sha256(manifest.read_bytes()).hexdigest() == checkpoint[
        "latest_checkpoint_manifest_sha256"
    ]
    assert _send(proc, {"kind": "stop"})["terminal_kind"] == "operator_stop"
    assert proc.wait(timeout=10) == 0


def test_checkpoint_request_fails_closed_when_latest_manifest_is_tampered(
    tmp_path: Path,
):
    workspace = _workspace(tmp_path / "generation-checkpoint-tamper")
    run_dir = tmp_path / "run-checkpoint-tamper"
    bindir, marker = _fake_node(tmp_path)
    proc = _spawn(_start_command(workspace, run_dir), _env(bindir, marker))
    assert _read(proc)["kind"] == "ready"
    metadata = json.loads((run_dir / "run.json").read_text(encoding="utf-8"))
    manifest = run_dir / metadata["latest_checkpoint"] / "manifest.json"
    manifest.write_bytes(manifest.read_bytes() + b" ")

    assert _send(proc, {"kind": "checkpoint"}) == {
        "kind": "error", "code": "checkpoint_validation_failed"
    }
    assert proc.wait(timeout=10) != 0


def test_request_id_replays_exact_response_and_conflicting_payload_is_rejected(
    tmp_path: Path,
):
    workspace = _workspace(tmp_path / "generation-idempotent")
    run_dir = tmp_path / "run-idempotent"
    bindir, marker = _fake_node(tmp_path)
    proc = _spawn(_start_command(workspace, run_dir), _env(bindir, marker))
    assert _read(proc)["kind"] == "ready"
    action = _turn("我检查门锁。", "request-replay")
    second_action = _turn("我检查门框。", "request-after-replay")
    first = _send(proc, action)
    second = _send(proc, second_action)
    calls_before_replay = (tmp_path / "fake-narrator-calls.jsonl").read_text(
        encoding="utf-8"
    ).splitlines()
    assert _send(proc, action) == first
    conflict = _turn("我踢开门。", "request-replay")
    assert _send(proc, conflict) == {
        "kind": "error", "code": "request_id_conflict"
    }
    assert proc.wait(timeout=10) != 0
    rows = (run_dir / "actions.jsonl").read_text(encoding="utf-8").splitlines()
    assert len(rows) == 2
    calls_after_replay = (tmp_path / "fake-narrator-calls.jsonl").read_text(
        encoding="utf-8"
    ).splitlines()
    assert calls_after_replay == calls_before_replay


def test_operator_stop_preserves_validated_public_terminal_evidence():
    driver = _load("interactive_driver_operator_stop_evidence", DRIVER)
    evidence = {
        "reached_terminal": True,
        "active_scene_id": "ending",
        "graph_terminal": True,
        "session_ending": False,
    }
    public_state = {
        "active_scene_id": "ending",
        "terminal_evidence": evidence,
    }

    result = driver._operator_stop_result(3, "a" * 64, public_state, 5)

    assert result["terminal_evidence"] == evidence
    assert result["terminal_evidence"] is not evidence


def test_pending_choice_uses_canonical_sdk_continuation_and_durable_transaction(
    tmp_path: Path,
):
    driver = _load("interactive_driver_pending_choice", DRIVER)
    run_dir = tmp_path / "pending-run"
    run_dir.mkdir()
    pending = {
        "choice_id": "choice-1",
        "kind": "push_confirm",
        "command_id": "command-1",
        "responder": "player",
        "revision": 1,
        "prompt": "Push the roll?",
        "options": [
            {"action": "confirm", "label": "Push"},
            {"action": "cancel", "label": "Do not push"},
        ],
    }

    def state(choice):
        return {
            "schema_version": 1,
            "campaign_id": "live",
            "play_language": "zh-CN",
            "active_scene_id": "scene-1",
            "tension_level": "low",
            "turn_number": 0,
            "discovered_clue_ids": [],
            "investigators": [],
            "brain": "pi",
            "pending_choice": choice,
            "terminal_evidence": {
                "reached_terminal": False,
                "active_scene_id": "scene-1",
                "graph_terminal": False,
                "session_ending": False,
            },
            "state_health": {"status": "ok", "issues": []},
        }

    response = {
        "choice_id": "choice-1",
        "responder": "player",
        "revision": 1,
        "action": "confirm",
    }
    request = driver.validate_request({
        "kind": "pending_choice",
        "request_id": "request-choice-1",
        "pending_choice_response": response,
    })

    class FakeApi:
        def __init__(self):
            self.states = [state(pending), state(None)]
            self.snapshotted = False

        def get_state(self, _session_id):
            return self.states.pop(0)

        def send(self, session_id, player_input, **kwargs):
            assert session_id == "sess-safe"
            assert player_input == ""
            assert kwargs == {
                "pending_choice_response": response,
                "rng_seed": "seed:000001",
                "durability_mode": "checkpoint",
            }
            return [{
                "type": "narration",
                "id": "evt-choice-result",
                "ts": "2026-07-12T00:00:00Z",
                "visibility": "player",
                "payload": {"text": "You push the roll.", "decision_id": "turn-1"},
            }]

        def get_last_turn_attestation(self, _session_id):
            return {
                "schema_version": 1,
                "session_id": "sess-safe",
                "investigator_id": "inv1",
                "decision_ids": ["turn-1"],
                "telemetry_receipt_id": "telemetry-1",
                "runtime_receipt_sha256": "a" * 64,
                "recording_mode": "sync",
                "recording_flush": "manual",
                "usage": {"input_tokens": 21, "output_tokens": 7},
                "narrator_llm_ms": 12.5,
                "narrator": {
                    "call_count": 1,
                    "model_identity": {
                        "provider": "zhipu-coding", "id": "glm-5.2"
                    },
                    "response_mode": "tool",
                    "consistent": True,
                    "deterministic_fallback": False,
                },
            }

        def snapshot_workspace_sessions(self, _workspace):
            self.snapshotted = True

    class FakeStore:
        action_chain_sha256 = "0" * 64
        action = None

        def append_turn(self, action, *_args):
            self.action = action
            self.action_chain_sha256 = "b" * 64

        def write_checkpoint(self, _session_id, turn_number, _reason):
            assert turn_number == 1
            return run_dir / "checkpoints" / "turn-000001"

    api = FakeApi()
    store = FakeStore()
    driver._read_checkpoint_manifest_strict = lambda _run, checkpoint: (
        checkpoint, {}, "d" * 64
    )
    args = driver.argparse.Namespace(
        run_kind="diagnostic_spoiler_run",
        rng_seed="seed",
        investigator="inv1",
        max_turns=5,
        run_dir=str(run_dir),
    )
    result, metadata, post_state = driver._process_gameplay_request(
        api=api,
        store=store,
        args=args,
        workspace=tmp_path,
        session_id="sess-safe",
        request=request,
        metadata={"durable_turn_number": 0},
        request_cache={},
    )
    assert result["kind"] == "turn_result"
    assert store.action == request
    assert api.snapshotted is True
    assert post_state["pending_choice"] is None
    assert metadata["last_request_id"] == "request-choice-1"
    assert json.loads((run_dir / "run.json").read_text(encoding="utf-8"))[
        "last_result_sha256"
    ] == metadata["last_result_sha256"]


def test_model_and_telemetry_failures_are_fatal_and_close_workers(tmp_path: Path):
    for failure, expected_code in (
        ("model", "model_attestation_failed"),
        ("telemetry", "telemetry_persistence_failed"),
    ):
        case = tmp_path / failure
        case.mkdir()
        workspace = _workspace(case / "generation")
        run_dir = case / "run"
        bindir, marker = _fake_node(case)
        env = _env(
            bindir,
            marker,
            provider="wrong-provider" if failure == "model" else "zhipu-coding",
        )
        proc = _spawn(_start_command(workspace, run_dir), env)
        assert _read(proc)["kind"] == "ready"
        if failure == "telemetry":
            poison = (
                workspace / ".coc" / "campaigns" / "live" / "logs"
                / "runtime-telemetry.jsonl"
            )
            assert not poison.exists()
            poison.mkdir(parents=True)
        assert _send(proc, _turn("我检查门锁。", f"request-{failure}")) == {
            "kind": "error", "code": expected_code
        }
        assert proc.wait(timeout=10) != 0
        deadline = time.monotonic() + 2
        while not marker.exists() and time.monotonic() < deadline:
            time.sleep(0.02)
        assert marker.read_text(encoding="utf-8") == "closed\n"
        assert not (run_dir / "checkpoints" / "turn-000001").exists()
        assert not (run_dir / "actions.jsonl").exists()


def test_resume_parser_and_strict_run_journal_manifest_readers(tmp_path: Path):
    driver = _load("interactive_driver_resume_preflight", DRIVER)
    run_dir = tmp_path / "run"
    checkpoint_dir = run_dir / "checkpoints" / "turn-000001"
    checkpoint_dir.mkdir(parents=True)
    parsed = driver._build_parser().parse_args([
        "resume", "--run-dir", str(run_dir),
        "--checkpoint", str(checkpoint_dir),
    ])
    assert parsed.command == "resume"

    action = _turn("我检查门锁。", "request-1")
    row = {
        "turn_number": 1,
        "previous_sha256": "0" * 64,
        "action": action,
        "events": [],
        "state_before": {},
        "state_after": {},
        "provenance": {},
    }
    row["row_sha256"] = driver._request_sha256(row)
    (run_dir / "actions.jsonl").write_bytes(driver._canonical_json(row) + b"\n")

    current_git_head = driver._current_git_head()
    manifest = {
        "schema_version": 2,
        "run_id": "live",
        "turn_number": 1,
        "reason": "turn_complete",
        "session_id": "sess-safe",
        "git_head": current_git_head,
        "source_pdf_sha256": "",
        "source_hashes": {},
        "scenario_hashes": {},
        "index_hashes": {},
        "immutable_trees": {},
        "managed_mutable_trees": {},
        "managed_file_presence": {},
        "state_files": [],
        "session_snapshot_sha256": "a" * 64,
        "action_chain_sha256": row["row_sha256"],
        "model_identity": {"provider": "zhipu-coding", "id": "glm-5.2"},
        "invalidation_state": {"invalidated": False, "segments": []},
        "player_mode": "diagnostic_spoiler_run",
    }
    manifest_bytes = driver._canonical_json(manifest) + b"\n"
    (checkpoint_dir / "manifest.json").write_bytes(manifest_bytes)
    manifest_sha = driver.hashlib.sha256(manifest_bytes).hexdigest()
    metadata = {
        "schema_version": 1,
        "driver_identity": driver._DRIVER_IDENTITY,
        "driver_sha256": driver._driver_sha256(),
        "git_head": current_git_head,
        "campaign_id": "live",
        "investigator_id": "inv1",
        "run_kind": "diagnostic_spoiler_run",
        "rng_seed_base": "seed",
        "max_turns": 5,
        "session_id": "sess-safe",
        "original_workspace": str(tmp_path / "original"),
        "active_workspace_path": str(tmp_path / "original"),
        "active_workspace_generation": "original",
        "generation_counter": 0,
        "durable_turn_number": 1,
        "action_chain_sha256": row["row_sha256"],
        "latest_checkpoint": "checkpoints/turn-000001",
        "latest_checkpoint_manifest_sha256": manifest_sha,
        "initial_public_state_sha256": "b" * 64,
        "current_public_state_sha256": "c" * 64,
        "pending_model_session_boundary": None,
        "last_request_id": "request-1",
        "last_request_sha256": driver._request_sha256(action),
        "last_result": {"kind": "turn_result"},
        "last_result_sha256": driver._request_sha256({"kind": "turn_result"}),
    }
    (run_dir / "run.json").write_bytes(driver._canonical_json(metadata) + b"\n")

    assert driver._read_run_metadata_strict(run_dir) == metadata
    driver._validate_run_metadata(metadata)
    assert driver._read_action_journal_strict(run_dir) == [row]
    selected, loaded_manifest, loaded_sha = (
        driver._read_checkpoint_manifest_strict(run_dir, checkpoint_dir)
    )
    assert selected == checkpoint_dir
    assert loaded_manifest == manifest
    assert loaded_sha == manifest_sha

    assert driver._classify_resume_boundary(
        metadata, [row], manifest, "checkpoints/turn-000001", manifest_sha
    ) == "aligned"
    metadata_zero = dict(metadata)
    metadata_zero.update({
        "durable_turn_number": 0,
        "action_chain_sha256": "0" * 64,
        "latest_checkpoint": "checkpoints/turn-000000",
        "latest_checkpoint_manifest_sha256": "e" * 64,
    })
    assert driver._classify_resume_boundary(
        metadata_zero, [row], manifest, "checkpoints/turn-000001", manifest_sha
    ) == "checkpoint_ahead"
    manifest_zero = dict(manifest)
    manifest_zero.update({
        "turn_number": 0,
        "action_chain_sha256": "0" * 64,
        "model_identity": {},
        "player_mode": None,
    })
    try:
        driver._classify_resume_boundary(
            metadata_zero,
            [row],
            manifest_zero,
            "checkpoints/turn-000000",
            "e" * 64,
        )
        assert False, "journal ahead of the selected checkpoint must fail"
    except driver.DriverError as exc:
        assert exc.code == "journal_ahead_of_checkpoint"

    (run_dir / "run.json").write_text(
        '{"schema_version":1,"schema_version":1}\n', encoding="utf-8"
    )
    try:
        driver._read_run_metadata_strict(run_dir)
        assert False, "duplicate metadata keys must fail closed"
    except driver.DriverError as exc:
        assert exc.code == "resume_validation_failed"
    missing_identity = dict(metadata)
    missing_identity.pop("driver_identity")
    try:
        driver._validate_run_metadata(missing_identity)
        assert False, "missing runner identity must fail closed"
    except driver.DriverError as exc:
        assert exc.code == "resume_validation_failed"

    tampered_identity = dict(metadata)
    tampered_identity["driver_sha256"] = "f" * 64
    try:
        driver._validate_run_metadata(tampered_identity)
        assert False, "runner digest tamper must fail closed"
    except driver.DriverError as exc:
        assert exc.code == "resume_validation_failed"


def test_git_head_binding_requires_metadata_manifest_and_current_head_to_match():
    driver = _load("interactive_driver_git_head_binding", DRIVER)
    current = driver._current_git_head()

    driver._validate_git_head_binding(
        {"git_head": current}, {"git_head": current}
    )
    for metadata_head, manifest_head in (
        ("f" * 40, current),
        (current, "e" * 40),
        (None, current),
        (current, None),
    ):
        try:
            driver._validate_git_head_binding(
                {"git_head": metadata_head}, {"git_head": manifest_head}
            )
            assert False, "git-head provenance mismatch must fail closed"
        except driver.DriverError as exc:
            assert exc.code == "resume_validation_failed"

    old = "a" * 40 if current != "a" * 40 else "b" * 40
    try:
        driver._validate_git_head_binding(
            {"git_head": old},
            {"git_head": old, "turn_number": 19},
        )
        assert False, "current HEAD drift without invalidation must fail"
    except driver.DriverError as exc:
        assert exc.code == "resume_validation_failed"

    driver._validate_git_head_binding(
        {"git_head": old},
        {
            "git_head": old,
            "turn_number": 19,
            "invalidation_state": {
                "invalidated": True,
                "segments": [
                    {
                        "kind": "invalidated_segment",
                        "old_commit": old,
                        "new_commit": current,
                        "replay_start_checkpoint": "turn-000019",
                    }
                ],
            },
        },
    )


def test_start_metadata_failure_leaves_diagnostic_incomplete_run_marker(
    tmp_path: Path,
):
    driver = _load("interactive_driver_incomplete_start", DRIVER)
    workspace = _workspace(tmp_path / "generation-incomplete")
    run_dir = tmp_path / "run-incomplete"
    args = driver.argparse.Namespace(
        command="start",
        workspace=str(workspace),
        campaign="live",
        investigator="inv1",
        run_dir=str(run_dir),
        run_kind="diagnostic_spoiler_run",
        rng_seed="incomplete-seed",
        max_turns=5,
    )
    original_atomic = driver.atomic_write_metadata

    def fail_metadata(*_args, **_kwargs):
        raise driver.DriverError("metadata_persistence_failed")

    driver.atomic_write_metadata = fail_metadata
    try:
        try:
            driver._run_start(args)
            assert False, "metadata failure after turn-0 checkpoint must be fatal"
        except driver.DriverError as exc:
            assert exc.code == "incomplete_run"
    finally:
        driver.atomic_write_metadata = original_atomic
    marker = json.loads(
        (run_dir / ".incomplete-run.json").read_text(encoding="utf-8")
    )
    assert marker == {
        "schema_version": 1,
        "code": "incomplete_run",
        "checkpoint": "checkpoints/turn-000000",
        "driver_identity": driver._DRIVER_IDENTITY,
        "driver_sha256": driver._driver_sha256(),
    }
    assert (run_dir / "checkpoints" / "turn-000000").is_dir()
    assert not (run_dir / "run.json").exists()
    try:
        driver._run_start(args)
        assert False, "incomplete run must never be silently reused"
    except driver.DriverError as exc:
        assert exc.code == "incomplete_run"
    try:
        driver._preflight_resume(
            run_dir, run_dir / "checkpoints" / "turn-000000"
        )
        assert False, "incomplete marker must also block resume"
    except driver.DriverError as exc:
        assert exc.code == "incomplete_run"

def test_model_attestation_blockers_and_same_model_prose_fallback():
    driver = _load("interactive_driver_attestation", DRIVER)
    base = {
        "schema_version": 1,
        "session_id": "sess-safe",
        "investigator_id": "inv1",
        "decision_ids": ["turn-1"],
        "telemetry_receipt_id": "telemetry-1",
        "runtime_receipt_sha256": "a" * 64,
        "recording_mode": "sync",
        "recording_flush": "manual",
        "usage": {"input_tokens": None, "output_tokens": None},
        "narrator_llm_ms": 0.0,
        "narrator": {
            "call_count": 1,
            "model_identity": {"provider": "zhipu-coding", "id": "glm-5.2"},
            "response_mode": "prose_fallback",
            "consistent": True,
            "deterministic_fallback": False,
        },
    }
    assert driver.validate_attestation(base)["narrator"]["response_mode"] == (
        "prose_fallback"
    )

    attacks = []
    for narrator in (
        {**base["narrator"], "call_count": 0, "model_identity": None,
         "response_mode": None},
        {**base["narrator"], "consistent": False},
        {**base["narrator"], "deterministic_fallback": True},
        {**base["narrator"], "model_identity": {
            "provider": "openai", "id": "gpt-substitute"
        }},
    ):
        attacks.append({**base, "narrator": narrator})
    for attack in attacks:
        try:
            driver.validate_attestation(attack)
            assert False, "expected model attestation blocker"
        except driver.DriverError as exc:
            assert exc.code == "model_attestation_failed"

    poisoned = {**base, "keeper_secret": "do not emit"}
    poisoned["narrator"] = {**base["narrator"], "scenario_path": "/private"}
    try:
        driver.validate_attestation(poisoned)
        assert False, "expected closed attestation blocker"
    except driver.DriverError as exc:
        assert exc.code == "model_attestation_failed"

    for field, value in (
        ("session_id", "../session"),
        ("telemetry_receipt_id", "x" * 129),
        ("decision_ids", ["turn-1\nsecret"]),
        ("telemetry_receipt_id", "sk-proj-not-an-id"),
    ):
        attack = {**base, field: value}
        try:
            driver.validate_attestation(attack)
            assert False, "unsafe attestation envelope ID must fail closed"
        except driver.DriverError as exc:
            assert exc.code == "model_attestation_failed"


def test_stdout_event_filter_is_structural_not_visibility_only():
    driver = _load("interactive_driver_filter", DRIVER)
    filtered = driver.sanitize_events([{
        "type": "narration",
        "id": "evt-safe",
        "ts": "2026-07-12T00:00:00Z",
        "visibility": "player",
        "payload": {
            "text": "你听到门后的脚步。",
            "decision_id": "turn-1",
            "scenario_path": "/private/module.json",
            "narration_envelope": {"keeper_secret": "nope"},
            "evaluator_text": "private review",
        },
    }, {
        "type": "roll",
        "id": "evt-roll",
        "ts": "2026-07-12T00:00:01Z",
        "visibility": "player",
        "payload": {
            "decision_id": "turn-1",
            "kind": "skill_check",
            "skill": "Spot Hidden",
            "roll": 42,
            "outcome": "regular_success",
            "resolution_context": {"missed_clue_id": "private-clue"},
            "_session_events": [{"keeper_secret": "nope"}],
            "missed_clue_id": "private-clue",
        },
    }, {
        "type": "choice",
        "id": "evt-choice",
        "ts": "2026-07-12T00:00:02Z",
        "visibility": "player",
        "payload": {
            "choice_id": "choice-1",
            "kind": "chase_action",
            "command_id": "command-1",
            "responder": "player",
            "revision": 1,
            "prompt": "Choose.",
            "options": [{"action": "dodge", "label": "Dodge", "secret": "x"}],
            "keeper_branch": "private",
        },
    }, {
        "type": "state_patch",
        "id": "evt-state",
        "ts": "2026-07-12T00:00:03Z",
        "visibility": "player",
        "payload": {"active_scene_path": "/private/scenario.json"},
    }, {
        "type": "system",
        "id": "evt-system",
        "ts": "2026-07-12T00:00:01Z",
        "visibility": "player",
        "payload": {"kind": "raw_keeper_event"},
    }])

    assert filtered == [{
        "type": "narration",
        "id": "evt-safe",
        "ts": "2026-07-12T00:00:00Z",
        "visibility": "player",
        "payload": {"text": "你听到门后的脚步。", "decision_id": "turn-1"},
    }, {
        "type": "roll",
        "id": "evt-roll",
        "ts": "2026-07-12T00:00:01Z",
        "visibility": "player",
        "payload": {
            "decision_id": "turn-1",
            "kind": "skill_check",
            "skill": "Spot Hidden",
            "roll": 42,
            "outcome": "regular_success",
        },
    }, {
        "type": "choice",
        "id": "evt-choice",
        "ts": "2026-07-12T00:00:02Z",
        "visibility": "player",
        "payload": {
            "choice_id": "choice-1",
            "kind": "chase_action",
            "command_id": "command-1",
            "responder": "player",
            "revision": 1,
            "prompt": "Choose.",
            "options": [{"action": "dodge", "label": "Dodge"}],
        },
    }]


def test_stdout_event_filter_rejects_invalid_nested_public_shapes():
    driver = _load("interactive_driver_filter_nested", DRIVER)
    invalid_roll = {
        "type": "roll", "id": "evt-roll", "ts": "now", "visibility": "player",
        "payload": {"roll": 42, "die_rolls": [20, True]},
    }
    invalid_choice = {
        "type": "choice", "id": "evt-choice", "ts": "now", "visibility": "player",
        "payload": {
            "choice_id": "choice-1", "kind": "keeper_branch",
            "command_id": "command-1", "responder": "player", "revision": True,
            "prompt": "Choose.", "options": [{"action": "x", "label": "X"}],
            "audience": "keeper",
        },
    }
    assert driver.sanitize_events([invalid_roll, invalid_choice]) == []


def test_public_envelope_ids_and_terminal_evidence_fail_closed():
    driver = _load("interactive_driver_closed_envelopes", DRIVER)
    base_event = {
        "type": "narration",
        "id": "evt-safe",
        "ts": "2026-07-12T00:00:00Z",
        "visibility": "player",
        "payload": {"text": "Safe.", "decision_id": "turn-1"},
    }
    for event_id in ("../event", "evt\\secret", "x" * 129, "sk-proj-secret"):
        assert driver.sanitize_events([{**base_event, "id": event_id}]) == []

    def state(*, reached: bool, graph: bool, session: bool):
        return {
            "schema_version": 1,
            "campaign_id": "live",
            "play_language": "zh-CN",
            "active_scene_id": "scene-1",
            "tension_level": "low",
            "turn_number": 0,
            "discovered_clue_ids": [],
            "investigators": [],
            "brain": "pi",
            "pending_choice": None,
            "terminal_evidence": {
                "reached_terminal": reached,
                "active_scene_id": "scene-1",
                "graph_terminal": graph,
                "session_ending": session,
            },
            "state_health": {"status": "ok", "issues": []},
        }

    assert driver.sanitize_public_state(
        state(reached=True, graph=True, session=False)
    )["terminal_evidence"]["graph_terminal"] is True
    assert driver.sanitize_public_state(
        state(reached=True, graph=False, session=True)
    )["terminal_evidence"]["session_ending"] is True
    for inconsistent in (
        state(reached=False, graph=True, session=False),
        state(reached=True, graph=False, session=False),
    ):
        try:
            driver.sanitize_public_state(inconsistent)
            assert False, "inconsistent terminal evidence must fail closed"
        except driver.DriverError as exc:
            assert exc.code == "public_state_invalid"
