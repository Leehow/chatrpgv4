"""Contract tests for the canonical stateful subsystem executor."""
from __future__ import annotations

import base64
import hashlib
import importlib.util
import json
import random
from pathlib import Path

import pytest


SCRIPTS_DIR = Path("plugins/coc-keeper/scripts")
EXECUTOR_PATH = SCRIPTS_DIR / "coc_subsystem_executor.py"
DRIVER_PATH = SCRIPTS_DIR / "coc_playtest_driver.py"
RESULT_KEYS = {
    "command_id",
    "kind",
    "status",
    "events",
    "pending_choice",
    "state_refs",
}


def _load(name: str, path: Path):
    assert path.exists(), f"missing canonical subsystem executor: {path}"
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _executor(name: str = "coc_subsystem_executor_test"):
    return _load(name, EXECUTOR_PATH)


def _driver(name: str = "coc_playtest_driver_executor_test"):
    return _load(name, DRIVER_PATH)


def _campaign_and_character(tmp_path: Path) -> tuple[Path, Path]:
    campaign = tmp_path / "campaign"
    (campaign / "save" / "investigator-state").mkdir(parents=True)
    (campaign / "logs").mkdir(parents=True)
    (campaign / "logs" / "rolls.jsonl").write_text("", encoding="utf-8")
    (campaign / "save" / "investigator-state" / "inv1.json").write_text(
        json.dumps({"schema_version": 1, "investigator_id": "inv1", "current_san": 55}),
        encoding="utf-8",
    )
    character = tmp_path / "investigators" / "inv1" / "character.json"
    character.parent.mkdir(parents=True)
    character.write_text(
        json.dumps({
            "schema_version": 1,
            "id": "inv1",
            "characteristics": {
                "STR": 60,
                "INT": 70,
                "POW": 55,
            },
            "derived": {"SAN": 55},
            "skills": {"Spot Hidden": 65, "Dodge": 40},
        }),
        encoding="utf-8",
    )
    return campaign, character


def _command(
    command_id: str,
    kind: str,
    *,
    phase: str | None = None,
    payload: dict | None = None,
) -> dict:
    return {
        "command_id": command_id,
        "kind": kind,
        "phase": phase or ("offer" if kind == "push_offer" else "resolve"),
        "payload": payload or {},
    }


def _san_command(command_id: str) -> dict:
    return _command(
        command_id,
        "sanity_check",
        payload={
            "decision_id": command_id,
            "roll_id": command_id,
            "skill": "SAN",
            "difficulty": "regular",
            "san_loss_success": 0,
            "san_loss_fail_expr": "1",
            "source": "structured-test-source",
        },
    )


def _execute(module, campaign: Path, character: Path, commands: list[dict], rng):
    return module.execute_commands(
        campaign,
        character,
        "inv1",
        commands,
        rng=rng,
    )


def test_public_typed_contracts_expose_exact_required_json_keys():
    executor = _executor()

    assert executor.SubsystemCommand.__required_keys__ == frozenset({
        "command_id", "kind", "phase", "payload",
    })
    assert executor.SubsystemResult.__required_keys__ == frozenset(RESULT_KEYS)


def test_unsafe_investigator_id_is_rejected_before_state_or_rng_mutation(tmp_path):
    executor = _executor()
    campaign, character = _campaign_and_character(tmp_path)
    rng = random.Random(8)
    rng_before = rng.getstate()

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        executor.execute_commands(
            campaign,
            character,
            "../../keeper-secret",
            [_command("cmd-unsafe", "skill_check", payload={"skill": "Spot Hidden"})],
            rng=rng,
        )

    assert exc_info.value.code == "invalid_investigator_id"
    assert exc_info.value.path == "investigator_id"
    assert rng.getstate() == rng_before
    assert not (campaign / "save" / "subsystem-state.json").exists()


def test_push_offer_persists_stable_choice_and_atomic_state_shape(tmp_path, monkeypatch):
    executor = _executor()
    campaign, character = _campaign_and_character(tmp_path)
    atomic_paths: list[Path] = []
    real_write = executor.coc_fileio.write_json_atomic

    def recording_atomic_write(path, payload, **kwargs):
        atomic_paths.append(Path(path))
        return real_write(path, payload, **kwargs)

    monkeypatch.setattr(executor.coc_fileio, "write_json_atomic", recording_atomic_write)
    result = _execute(
        executor,
        campaign,
        character,
        [_command("cmd-1", "push_offer", payload={"original_roll_id": "roll-1"})],
        random.Random(7),
    )[0]

    assert set(result) == RESULT_KEYS
    assert result["status"] == "pending_choice"
    assert result["pending_choice"] == {
        "choice_id": "cmd-1:confirm",
        "kind": "push_confirm",
        "command_id": "cmd-1",
    }
    assert result["state_refs"] == [
        "save/subsystem-state.json#pending_choices/cmd-1:confirm"
    ]

    state_path = campaign / "save" / "subsystem-state.json"
    state = json.loads(state_path.read_text(encoding="utf-8"))
    assert set(state) == {
        "schema_version",
        "applied_command_ids",
        "command_hashes",
        "result_snapshots",
        "pending_choices",
        "inflight",
    }
    assert state["schema_version"] == 1
    assert state["applied_command_ids"] == ["cmd-1"]
    assert set(state["command_hashes"]) == {"cmd-1"}
    assert len(state["command_hashes"]["cmd-1"]) == hashlib.sha256().digest_size * 2
    assert state["result_snapshots"]["cmd-1"] == result
    assert state["pending_choices"] == {"cmd-1:confirm": result["pending_choice"]}
    assert state["inflight"] is None
    assert atomic_paths == [state_path, state_path]
    assert not list((campaign / "save").glob("*.tmp"))


def test_crash_reload_replays_snapshot_without_rng_or_log_consumption(tmp_path):
    campaign, character = _campaign_and_character(tmp_path)
    command = _command(
        "turn-001-rule-1",
        "skill_check",
        payload={
            "decision_id": "turn-001",
            "roll_id": "turn-001-rule-1",
            "skill": "Spot Hidden",
            "difficulty": "regular",
        },
    )
    rng = random.Random(91)
    first_module = _executor("coc_subsystem_executor_before_crash")
    first = _execute(first_module, campaign, character, [command], rng)[0]
    state_after_first = rng.getstate()
    roll_log_after_first = (campaign / "logs" / "rolls.jsonl").read_bytes()

    reloaded_module = _executor("coc_subsystem_executor_after_crash")
    replay = _execute(reloaded_module, campaign, character, [command], rng)[0]

    assert replay == first
    assert rng.getstate() == state_after_first
    assert (campaign / "logs" / "rolls.jsonl").read_bytes() == roll_log_after_first
    rows = [json.loads(line) for line in roll_log_after_first.decode("utf-8").splitlines()]
    assert len(rows) == 1
    assert rows[0]["command_id"] == command["command_id"]


def test_final_ledger_failure_rolls_back_san_log_and_rng(tmp_path, monkeypatch):
    executor = _executor()
    campaign, character = _campaign_and_character(tmp_path)
    inv_path = campaign / "save" / "investigator-state" / "inv1.json"
    state_path = campaign / "save" / "subsystem-state.json"
    log_path = campaign / "logs" / "rolls.jsonl"
    inv_before = inv_path.read_bytes()
    log_before = log_path.read_bytes()
    rng = random.Random(99)
    rng_before = rng.getstate()
    real_write = executor.coc_fileio.write_json_atomic
    state_writes = 0

    def fail_final_ledger(path, payload, **kwargs):
        nonlocal state_writes
        if Path(path) == state_path:
            state_writes += 1
            if state_writes == 2:
                raise OSError("injected final ledger failure")
        return real_write(path, payload, **kwargs)

    monkeypatch.setattr(executor.coc_fileio, "write_json_atomic", fail_final_ledger)
    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        _execute(executor, campaign, character, [_san_command("san-ledger-fail")], rng)

    assert exc_info.value.code == "subsystem_transaction_failed"
    assert rng.getstate() == rng_before
    assert inv_path.read_bytes() == inv_before
    assert not (campaign / "save" / "sanity.json").exists()
    assert log_path.read_bytes() == log_before
    recovered = json.loads(state_path.read_text(encoding="utf-8"))
    assert recovered["applied_command_ids"] == []
    assert recovered["inflight"] is None


def test_log_append_failure_rolls_back_partial_bytes_and_san(tmp_path, monkeypatch):
    executor = _executor()
    campaign, character = _campaign_and_character(tmp_path)
    inv_path = campaign / "save" / "investigator-state" / "inv1.json"
    log_path = campaign / "logs" / "rolls.jsonl"
    inv_before = inv_path.read_bytes()
    log_before = log_path.read_bytes()
    rng = random.Random(101)
    rng_before = rng.getstate()

    def partial_append(*_args, **_kwargs):
        with log_path.open("ab") as handle:
            handle.write(b"partial-uncommitted-row")
        raise OSError("injected append failure")

    monkeypatch.setattr(executor, "_append_roll_event", partial_append)
    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        _execute(executor, campaign, character, [_san_command("san-log-fail")], rng)

    assert exc_info.value.code == "subsystem_transaction_failed"
    assert rng.getstate() == rng_before
    assert inv_path.read_bytes() == inv_before
    assert not (campaign / "save" / "sanity.json").exists()
    assert log_path.read_bytes() == log_before
    state = json.loads((campaign / "save" / "subsystem-state.json").read_text())
    assert state["applied_command_ids"] == []
    assert state["inflight"] is None


def test_reload_recovers_prepared_inflight_before_executing_again(tmp_path):
    campaign, character = _campaign_and_character(tmp_path)
    inv_path = campaign / "save" / "investigator-state" / "inv1.json"
    sanity_path = campaign / "save" / "sanity.json"
    log_path = campaign / "logs" / "rolls.jsonl"
    state_path = campaign / "save" / "subsystem-state.json"
    inv_before = inv_path.read_bytes()
    log_before = b'{"baseline": true}\n'
    log_path.write_bytes(log_before)

    def encoded_preimage(path: Path) -> dict:
        if not path.exists():
            return {"exists": False, "encoding": "base64", "data": None}
        return {
            "exists": True,
            "encoding": "base64",
            "data": base64.b64encode(path.read_bytes()).decode("ascii"),
        }

    preimage_paths = [
        sanity_path,
        inv_path,
        campaign / "save" / "time-state.json",
        campaign / "save" / "time-triggers.json",
    ]
    inflight = {
        "commands": [{"command_id": "crashed-san", "command_hash": "0" * 64}],
        "preimages": {
            path.relative_to(campaign).as_posix(): encoded_preimage(path)
            for path in preimage_paths
        },
        "log_offsets": {
            "logs/rolls.jsonl": {"exists": True, "size": len(log_before)},
        },
    }
    state = {
        "schema_version": 1,
        "applied_command_ids": [],
        "command_hashes": {},
        "result_snapshots": {},
        "pending_choices": {},
        "inflight": inflight,
    }
    state_path.write_text(json.dumps(state), encoding="utf-8")
    inv_path.write_text(json.dumps({"current_san": 1}), encoding="utf-8")
    sanity_path.write_text(json.dumps({"san_current": 1}), encoding="utf-8")
    with log_path.open("ab") as handle:
        handle.write(b"uncommitted-tail")

    reloaded = _executor("coc_subsystem_executor_inflight_restart")
    result = _execute(
        reloaded,
        campaign,
        character,
        [_command("after-recovery", "push_offer")],
        random.Random(3),
    )[0]

    assert result["status"] == "pending_choice"
    assert inv_path.read_bytes() == inv_before
    assert not sanity_path.exists()
    assert log_path.read_bytes() == log_before
    recovered = json.loads(state_path.read_text(encoding="utf-8"))
    assert recovered["inflight"] is None
    assert recovered["applied_command_ids"] == ["after-recovery"]


def test_later_malformed_sanity_state_fails_batch_preflight_without_rng(tmp_path):
    executor = _executor()
    campaign, character = _campaign_and_character(tmp_path)
    (campaign / "save" / "sanity.json").write_text(
        json.dumps({"san_current": "not-an-integer", "san_max": 55}),
        encoding="utf-8",
    )
    rng = random.Random(103)
    rng_before = rng.getstate()
    commands = [
        _command("would-roll-first", "skill_check", payload={"skill": "Spot Hidden"}),
        _san_command("malformed-san-later"),
    ]

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        _execute(executor, campaign, character, commands, rng)

    assert exc_info.value.code == "malformed_sanity_state"
    assert exc_info.value.path == "save/sanity.json"
    assert rng.getstate() == rng_before
    assert not (campaign / "save" / "subsystem-state.json").exists()
    assert (campaign / "logs" / "rolls.jsonl").read_text(encoding="utf-8") == ""


@pytest.mark.parametrize("bad_expr", ["1D0", "0D6", "not-dice", "-1", ""])
def test_invalid_san_loss_expression_is_preflighted_without_mutation(tmp_path, bad_expr):
    executor = _executor(f"coc_subsystem_executor_bad_san_{bad_expr or 'empty'}")
    campaign, character = _campaign_and_character(tmp_path)
    command = _san_command("san-invalid-expr")
    command["payload"]["san_loss_fail_expr"] = bad_expr
    inv_path = campaign / "save" / "investigator-state" / "inv1.json"
    inv_before = inv_path.read_bytes()
    log_path = campaign / "logs" / "rolls.jsonl"
    rng = random.Random(104)
    rng_before = rng.getstate()

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        _execute(executor, campaign, character, [command], rng)

    assert exc_info.value.code == "invalid_command_payload"
    assert exc_info.value.path == "commands[0].payload.san_loss_fail_expr"
    assert rng.getstate() == rng_before
    assert inv_path.read_bytes() == inv_before
    assert not (campaign / "save" / "sanity.json").exists()
    assert not (campaign / "save" / "subsystem-state.json").exists()
    assert log_path.read_text(encoding="utf-8") == ""


def test_oversized_san_success_loss_is_preflighted_without_mutation(tmp_path):
    executor = _executor("coc_subsystem_executor_oversized_san_success")
    campaign, character = _campaign_and_character(tmp_path)
    command = _san_command("san-oversized-success")
    command["payload"]["san_loss_success"] = executor.coc_sanity.SAN_LOSS_MAX_TOTAL + 1
    rng = random.Random(120)
    rng_before = rng.getstate()

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        _execute(executor, campaign, character, [command], rng)

    assert exc_info.value.code == "invalid_command_payload"
    assert exc_info.value.path == "commands[0].payload.san_loss_success"
    assert rng.getstate() == rng_before
    assert not (campaign / "save" / "subsystem-state.json").exists()
    assert not (campaign / "save" / "sanity.json").exists()
    assert (campaign / "logs" / "rolls.jsonl").read_text(encoding="utf-8") == ""


def test_subsystem_state_rejects_symlinked_save_escape(tmp_path):
    executor = _executor("coc_subsystem_executor_save_symlink")
    campaign = tmp_path / "campaign"
    campaign.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    sentinel = outside / "sentinel.txt"
    sentinel.write_text("keeper sentinel", encoding="utf-8")
    (campaign / "save").symlink_to(outside, target_is_directory=True)
    character = tmp_path / "unused-character.json"
    rng = random.Random(105)
    rng_before = rng.getstate()

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        _execute(executor, campaign, character, [_command("escape", "push_offer")], rng)

    assert exc_info.value.code == "unsafe_subsystem_state_path"
    assert exc_info.value.path == "save/subsystem-state.json"
    assert rng.getstate() == rng_before
    assert sentinel.read_text(encoding="utf-8") == "keeper sentinel"
    assert not (outside / "subsystem-state.json").exists()


def test_subsystem_state_rejects_state_file_symlink_escape(tmp_path):
    executor = _executor("coc_subsystem_executor_state_symlink")
    campaign, character = _campaign_and_character(tmp_path)
    outside_state = tmp_path / "outside-subsystem-state.json"
    sentinel = b'{"outside": "sentinel"}'
    outside_state.write_bytes(sentinel)
    state_path = campaign / "save" / "subsystem-state.json"
    state_path.symlink_to(outside_state)

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        _execute(executor, campaign, character, [], random.Random(106))

    assert exc_info.value.code == "unsafe_subsystem_state_path"
    assert outside_state.read_bytes() == sentinel


def test_strict_san_mirror_failure_rolls_back_every_transaction_surface(tmp_path, monkeypatch):
    executor = _executor("coc_subsystem_executor_strict_san_mirror")
    campaign, character = _campaign_and_character(tmp_path)
    inv_path = campaign / "save" / "investigator-state" / "inv1.json"
    inv_before = inv_path.read_bytes()
    log_path = campaign / "logs" / "rolls.jsonl"
    log_before = log_path.read_bytes()
    state_path = campaign / "save" / "subsystem-state.json"
    rng = random.Random(107)
    rng_before = rng.getstate()
    real_write = executor.coc_sanity.coc_fileio.write_json_atomic

    def fail_investigator_mirror(path, payload, **kwargs):
        if Path(path) == inv_path:
            raise OSError("injected strict investigator mirror failure")
        return real_write(path, payload, **kwargs)

    monkeypatch.setattr(
        executor.coc_sanity.coc_fileio,
        "write_json_atomic",
        fail_investigator_mirror,
    )
    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        _execute(executor, campaign, character, [_san_command("san-strict-mirror")], rng)

    assert exc_info.value.code == "subsystem_transaction_failed"
    assert rng.getstate() == rng_before
    assert inv_path.read_bytes() == inv_before
    assert not (campaign / "save" / "sanity.json").exists()
    assert log_path.read_bytes() == log_before
    state = json.loads(state_path.read_text(encoding="utf-8"))
    assert state["applied_command_ids"] == []
    assert state["inflight"] is None


def test_orphan_pending_choice_index_is_rejected(tmp_path):
    executor = _executor("coc_subsystem_executor_orphan_pending")
    campaign, character = _campaign_and_character(tmp_path)
    state = executor._default_state()
    state["pending_choices"] = {
        "orphan:confirm": {
            "choice_id": "orphan:confirm",
            "kind": "push_confirm",
            "command_id": "orphan",
        }
    }
    (campaign / "save" / "subsystem-state.json").write_text(json.dumps(state), encoding="utf-8")

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        _execute(executor, campaign, character, [], random.Random(108))

    assert exc_info.value.code == "malformed_subsystem_state"


def test_pending_choice_must_deep_match_its_applied_snapshot(tmp_path):
    executor = _executor("coc_subsystem_executor_mismatched_pending")
    campaign, character = _campaign_and_character(tmp_path)
    result = _execute(
        executor,
        campaign,
        character,
        [_command("push-mismatch", "push_offer")],
        random.Random(109),
    )[0]
    state_path = campaign / "save" / "subsystem-state.json"
    state = json.loads(state_path.read_text(encoding="utf-8"))
    state["pending_choices"][result["pending_choice"]["choice_id"]]["kind"] = "forged_kind"
    state_path.write_text(json.dumps(state), encoding="utf-8")

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        _execute(executor, campaign, character, [], random.Random(110))

    assert exc_info.value.code == "malformed_subsystem_state"


def test_replay_rejects_snapshot_kind_semantic_mismatch(tmp_path):
    executor = _executor("coc_subsystem_executor_replay_semantic_mismatch")
    campaign, character = _campaign_and_character(tmp_path)
    command = _command("semantic-mismatch", "skill_check", payload={"skill": "Spot Hidden"})
    _execute(executor, campaign, character, [command], random.Random(111))
    state_path = campaign / "save" / "subsystem-state.json"
    state = json.loads(state_path.read_text(encoding="utf-8"))
    state["result_snapshots"][command["command_id"]]["kind"] = "idea_roll"
    state_path.write_text(json.dumps(state), encoding="utf-8")

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        _execute(executor, campaign, character, [command], random.Random(112))

    assert exc_info.value.code == "replay_snapshot_mismatch"
    assert exc_info.value.path == "commands[0]"


def test_persisted_pending_choice_survives_empty_batch_and_blocks_new_commands(tmp_path):
    executor = _executor("coc_subsystem_executor_pending_query")
    campaign, character = _campaign_and_character(tmp_path)
    offered = _execute(
        executor,
        campaign,
        character,
        [_command("push-persisted", "push_offer")],
        random.Random(113),
    )[0]
    rng = random.Random(114)
    rng_before = rng.getstate()

    assert hasattr(executor, "get_current_pending_choice")
    assert _execute(executor, campaign, character, [], rng) == []
    assert executor.get_current_pending_choice(campaign) == offered["pending_choice"]
    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        _execute(
            executor,
            campaign,
            character,
            [_command("ordinary-after-pending", "skill_check", payload={"skill": "Spot Hidden"})],
            rng,
        )

    assert exc_info.value.code == "blocked_by_pending_choice"
    assert exc_info.value.path == "commands"
    assert rng.getstate() == rng_before


def test_max_length_command_id_gets_stable_valid_push_choice_id(tmp_path):
    executor = _executor("coc_subsystem_executor_long_push_choice")
    campaign, character = _campaign_and_character(tmp_path)
    command_id = "p" * 128
    result = _execute(
        executor,
        campaign,
        character,
        [_command(command_id, "push_offer")],
        random.Random(118),
    )[0]

    choice_id = result["pending_choice"]["choice_id"]
    assert len(choice_id) <= 128
    assert executor._SAFE_ID.fullmatch(choice_id)
    assert choice_id == executor._push_choice_id(command_id)
    assert executor.get_current_pending_choice(campaign) == result["pending_choice"]

    reloaded = _executor("coc_subsystem_executor_long_push_choice_reload")
    assert reloaded.get_current_pending_choice(campaign) == result["pending_choice"]


def test_batch_cannot_atomically_create_multiple_global_pending_choices(tmp_path):
    executor = _executor("coc_subsystem_executor_multiple_pending_batch")
    campaign, character = _campaign_and_character(tmp_path)
    rng = random.Random(119)
    rng_before = rng.getstate()
    log_path = campaign / "logs" / "rolls.jsonl"
    log_before = log_path.read_bytes()

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        _execute(
            executor,
            campaign,
            character,
            [
                _command("push-one", "push_offer"),
                _command("push-two", "push_offer"),
            ],
            rng,
        )

    assert exc_info.value.code == "multiple_pending_choices"
    assert exc_info.value.path == "commands"
    assert rng.getstate() == rng_before
    assert not (campaign / "save" / "subsystem-state.json").exists()
    assert log_path.read_bytes() == log_before


def test_normalize_rejects_forged_or_mismatched_executor_envelopes(tmp_path):
    executor = _executor("coc_subsystem_executor_provenance")
    campaign, character = _campaign_and_character(tmp_path)
    trusted = _execute(
        executor,
        campaign,
        character,
        [_command("trusted-result", "skill_check", payload={"skill": "Spot Hidden"})],
        random.Random(115),
    )
    forged = json.loads(json.dumps(trusted))
    forged[0]["events"][0]["success"] = not forged[0]["events"][0]["success"]

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        executor.normalize_rule_results(forged, campaign_dir=campaign)

    assert exc_info.value.code == "untrusted_subsystem_result"
    assert exc_info.value.path == "rules_results[0]"
    assert executor.normalize_rule_results(trusted, campaign_dir=campaign) == trusted[0]["events"]

    with pytest.raises(executor.SubsystemExecutorError) as duplicate_exc:
        executor.normalize_rule_results(
            [trusted[0], json.loads(json.dumps(trusted[0]))],
            campaign_dir=campaign,
        )
    assert duplicate_exc.value.code == "untrusted_subsystem_result"
    assert duplicate_exc.value.path == "rules_results[1]"

    partial = json.loads(json.dumps(trusted[0]))
    partial.pop("status")
    with pytest.raises(executor.SubsystemExecutorError) as partial_exc:
        executor.normalize_rule_results([partial], campaign_dir=campaign)
    assert partial_exc.value.code == "untrusted_subsystem_result"
    assert partial_exc.value.path == "rules_results[0]"


def test_same_command_id_with_different_hash_is_typed_conflict(tmp_path):
    executor = _executor()
    campaign, character = _campaign_and_character(tmp_path)
    original = _command(
        "cmd-conflict",
        "skill_check",
        payload={"skill": "Spot Hidden", "difficulty": "regular"},
    )
    _execute(executor, campaign, character, [original], random.Random(2))
    state_path = campaign / "save" / "subsystem-state.json"
    state_before = state_path.read_bytes()
    rng = random.Random(3)
    rng_before = rng.getstate()

    changed = _command(
        "cmd-conflict",
        "skill_check",
        payload={"skill": "Spot Hidden", "difficulty": "hard"},
    )
    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        _execute(executor, campaign, character, [changed], rng)

    assert exc_info.value.code == "command_conflict"
    assert exc_info.value.path == "commands[0].command_id"
    assert state_path.read_bytes() == state_before
    assert rng.getstate() == rng_before


def test_invalid_batch_is_fully_preflighted_before_rng_state_or_log_mutation(tmp_path):
    executor = _executor()
    campaign, character = _campaign_and_character(tmp_path)
    rng = random.Random(12)
    rng_before = rng.getstate()
    commands = [
        _command("cmd-valid", "skill_check", payload={"skill": "Spot Hidden"}),
        _command("cmd-invalid", "telepathy", payload={}),
    ]

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        _execute(executor, campaign, character, commands, rng)

    assert exc_info.value.code == "unsupported_command_kind"
    assert exc_info.value.path == "commands[1].kind"
    assert rng.getstate() == rng_before
    assert not (campaign / "save" / "subsystem-state.json").exists()
    assert (campaign / "logs" / "rolls.jsonl").read_text(encoding="utf-8") == ""


@pytest.mark.parametrize(
    ("command", "code", "path"),
    [
        (
            {"command_id": "missing-payload", "kind": "skill_check", "phase": "resolve"},
            "invalid_command_contract",
            "commands[0]",
        ),
        (
            {**_command("extra", "skill_check"), "secret_prose": "must not enter contract"},
            "invalid_command_contract",
            "commands[0]",
        ),
        (
            _command("bad-phase", "push_offer", phase="resolve"),
            "invalid_command_phase",
            "commands[0].phase",
        ),
    ],
)
def test_command_contract_is_strict(tmp_path, command, code, path):
    executor = _executor()
    campaign, character = _campaign_and_character(tmp_path)

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        _execute(executor, campaign, character, [command], random.Random(4))

    assert exc_info.value.code == code
    assert exc_info.value.path == path
    assert not (campaign / "save" / "subsystem-state.json").exists()


def test_malformed_persisted_state_fails_closed_without_silent_reset(tmp_path):
    executor = _executor()
    campaign, character = _campaign_and_character(tmp_path)
    state_path = campaign / "save" / "subsystem-state.json"
    malformed = b'{"schema_version": 1, "applied_command_ids": '
    state_path.write_bytes(malformed)
    rng = random.Random(5)
    rng_before = rng.getstate()

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        _execute(executor, campaign, character, [_command("cmd-1", "push_offer")], rng)

    assert exc_info.value.code == "malformed_subsystem_state"
    assert exc_info.value.path == "save/subsystem-state.json"
    assert state_path.read_bytes() == malformed
    assert rng.getstate() == rng_before


@pytest.mark.parametrize(
    ("kind", "legacy_request"),
    [
        ("skill_check", {"skill": "Spot Hidden", "difficulty": "regular"}),
        ("characteristic_check", {"skill": "STR", "difficulty": "hard"}),
        (
            "opposed_check",
            {
                "skill": "Dodge",
                "difficulty": "regular",
                "opposed_by": "guard",
                "opposed_skill": "Fighting (Brawl)",
            },
        ),
        ("sanity_check", {"skill": "SAN", "difficulty": "regular"}),
        (
            "idea_roll",
            {
                "skill": "INT",
                "difficulty": "regular",
                "signpost_level": "mentioned",
                "missed_clue_id": "clue-1",
            },
        ),
    ],
)
def test_every_legacy_request_kind_runs_through_executor_and_wrapper(
    tmp_path,
    kind,
    legacy_request,
):
    executor = _executor(f"coc_subsystem_executor_compat_{kind}")
    driver = _driver(f"coc_playtest_driver_compat_{kind}")
    campaign, character = _campaign_and_character(tmp_path)
    plan = {
        "decision_id": f"turn-{kind}",
        "rules_requests": [{"kind": kind, **legacy_request}],
    }

    wrapper_result = driver._execute_rules_requests(
        campaign,
        character,
        "inv1",
        plan,
        random.Random(44),
    )
    commands = executor.commands_from_rules_requests(plan)
    state_after_wrapper = random.Random(99)
    normalized = _execute(executor, campaign, character, commands, state_after_wrapper)

    assert len(commands) == 1
    assert set(normalized[0]) == RESULT_KEYS
    assert normalized[0]["kind"] == kind
    assert normalized[0]["status"] == "completed"
    assert normalized[0]["events"] == wrapper_result
    assert wrapper_result[0]["kind"] == kind
    assert isinstance(wrapper_result[0]["success"], bool)


def test_wrapper_delegates_to_execute_commands_and_only_unwraps_events(tmp_path, monkeypatch):
    driver = _driver()
    campaign, character = _campaign_and_character(tmp_path)
    captured: dict = {}
    normalized = [{
        "command_id": "turn-1-rule-1",
        "kind": "skill_check",
        "status": "completed",
        "events": [{"kind": "skill_check", "roll": 22, "success": True}],
        "pending_choice": None,
        "state_refs": ["logs/rolls.jsonl#turn-1-rule-1"],
    }]

    def fake_execute(campaign_dir, character_path, investigator_id, commands, *, rng, **kwargs):
        captured.update({
            "campaign_dir": campaign_dir,
            "character_path": character_path,
            "investigator_id": investigator_id,
            "commands": commands,
            "rng": rng,
        })
        return normalized

    monkeypatch.setattr(driver.subsystem_executor, "execute_commands", fake_execute)
    plan = {
        "decision_id": "turn-1",
        "rules_requests": [{"kind": "skill_check", "skill": "Spot Hidden"}],
    }
    rng = random.Random(1)
    result = driver._execute_rules_requests(campaign, character, "inv1", plan, rng)

    assert result == normalized[0]["events"]
    assert captured["campaign_dir"] == campaign
    assert captured["character_path"] == character
    assert captured["investigator_id"] == "inv1"
    assert captured["rng"] is rng
    assert captured["commands"][0]["command_id"] == "turn-1-rule-1"
