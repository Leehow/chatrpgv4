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


def _campaign_and_character(tmp_path: Path) -> tuple[Path, Path]:
    campaign = tmp_path / "campaign"
    (campaign / "save" / "investigator-state").mkdir(parents=True)
    (campaign / "logs").mkdir(parents=True)
    (campaign / "logs" / "rolls.jsonl").write_text("", encoding="utf-8")
    (campaign / "save" / "investigator-state" / "inv1.json").write_text(
        json.dumps({
            "schema_version": 1,
            "investigator_id": "inv1",
            "current_san": 55,
            "current_mp": 0,
        }),
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


def _install_creating_marker(executor, root: Path, investigator_id: str) -> Path:
    ending_id = "ending-consumer-guard"
    transaction_id = executor.coc_investigator_guard._expected_transaction_id(
        ending_id, investigator_id
    )
    marker = (
        root / "investigators" / investigator_id
        / "development-active-transaction.json"
    )
    marker.write_text(json.dumps({
        "schema_version": 2,
        "status": "active",
        "transaction_id": transaction_id,
        "investigator_id": investigator_id,
        "campaign_id": "foreign-campaign",
        "ending_id": ending_id,
        "inflight_ref": (
            "campaigns/foreign-campaign/save/development-settlements/"
            "endings/ending-consumer-guard/inv.inflight.json"
        ),
        "created_at": "2026-07-16T00:00:00Z",
        "phase": "creating",
        "journal_sha256": None,
        "next_journal_sha256": None,
        "transition_at": None,
    }), encoding="utf-8")
    return marker


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


def test_direct_character_command_returns_recovery_conflict_without_state_writes(
    tmp_path,
):
    executor = _executor("coc_subsystem_executor_character_recovery_guard")
    campaign, character = _campaign_and_character(tmp_path)
    marker = _install_creating_marker(executor, tmp_path, "inv1")
    tracked = [
        path for path in tmp_path.rglob("*")
        if path.is_file() and "locks" not in path.parts
    ]
    before = {path: path.read_bytes() for path in tracked}
    command = _command("guarded-first-aid", "stabilize", payload={
        "decision_id": "guarded-first-aid",
        "method": "first_aid",
        "skill_value": 99,
    })

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        executor.execute_commands(
            campaign, character, "inv1", [command], rng=random.Random(2)
        )

    assert exc_info.value.code == "RECOVERY_CONFLICT"
    assert marker.is_file()
    assert {
        path: path.read_bytes()
        for path in tmp_path.rglob("*")
        if path.is_file() and "locks" not in path.parts
    } == before


def _realtime_bout_command(command_id: str = "san-realtime-bout") -> dict:
    command = _san_command(command_id)
    command["payload"].update({
        "san_loss_success": 5,
        "san_loss_fail_expr": "5",
        "alone": False,
        "involuntary_kind": "flee",
        "involuntary_summary": "bolt toward the nearest lit doorway",
        "module_bout_override": {
            "force_mode": "real_time",
            "result_description": "structured module bout override",
        },
        "creature_type": "deep-one",
    })
    return command


def _set_high_san_and_int(character: Path) -> None:
    sheet = json.loads(character.read_text(encoding="utf-8"))
    sheet["characteristics"]["POW"] = 99
    sheet["characteristics"]["INT"] = 99
    sheet["derived"]["SAN"] = 99
    character.write_text(json.dumps(sheet), encoding="utf-8")


def _chase_start(command_id: str = "chase-start") -> dict:
    return _command(command_id, "chase_start", phase="start", payload={
        "decision_id": "chase-journey", "chase_id": "roof-run",
        "participants": [
            {"actor_id": "inv1", "side": "quarry", "mov": 8, "dex": 70,
             "con": 60, "hp": 10, "fight": 60, "dodge": 40,
             "build": 0, "current_position": 0, "conditions": []},
            {"actor_id": "cultist", "side": "pursuer", "mov": 8, "dex": 50,
             "con": 50, "hp": 9, "fight": 45, "dodge": 25,
             "build": 0, "current_position": 0, "conditions": []},
        ],
        "locations": [
            {"label": "roof", "hazard": None, "barrier": None},
            {"label": "skylight", "hazard": {"hazard_id": "glass", "skill": "DEX", "target": 100, "difficulty": "regular", "damage_dice": "1D3"}, "barrier": None},
            {"label": "door", "hazard": None, "barrier": {"barrier_id": "door", "hp": 4, "hp_max": 4, "skill": "Climb", "target": 100}},
            {"label": "escape", "hazard": None, "barrier": None},
        ],
    })


def test_chase_commands_persist_reload_replay_and_conclude(tmp_path):
    executor = _executor("coc_subsystem_executor_chase_journey")
    campaign, character = _campaign_and_character(tmp_path)
    investigator = json.loads((campaign / "save" / "investigator-state" / "inv1.json").read_text())
    investigator.update({"current_hp": 10, "conditions": []})
    (campaign / "save" / "investigator-state" / "inv1.json").write_text(json.dumps(investigator))
    start = _chase_start()
    started = executor.execute_commands(campaign, character, "inv1", [start], rng=random.Random(4))
    assert started[0]["events"][0]["event_type"] == "chase_started"
    chase_path = campaign / "save" / "chase.json"
    saved = json.loads(chase_path.read_text())
    assert saved["revision"] == 1

    hazard = _command("chase-hazard", "chase_hazard", payload={
        "decision_id": "chase-journey", "revision": 1, "actor_id": "inv1",
        "action_id": "hazard:glass", "skill": "DEX", "target": 100,
    })
    resolved = executor.execute_commands(campaign, character, "inv1", [hazard], rng=random.Random(5))
    assert resolved[0]["events"][0]["event_type"] == "chase_hazard_resolved"
    assert json.loads(chase_path.read_text())["participants"][0]["position"] == 1
    before = chase_path.read_bytes()
    replay = executor.execute_commands(campaign, character, "inv1", [hazard], rng=random.Random(999))
    assert replay == resolved
    assert chase_path.read_bytes() == before

    pursuer = _command("chase-pursuer-move", "chase_hazard", payload={
        "decision_id": "chase-journey", "revision": 2, "actor_id": "cultist",
        "action_id": "hazard:glass", "skill": "DEX", "target": 100,
    })
    executor.execute_commands(campaign, character, "inv1", [pursuer], rng=random.Random(6))
    barrier = _command("chase-barrier", "chase_barrier", payload={
        "decision_id": "chase-journey", "revision": 4, "actor_id": "inv1",
        "action_id": "barrier:door:negotiate", "method": "negotiate",
        "skill": "Climb", "target": 100,
    })
    barrier_result = executor.execute_commands(campaign, character, "inv1", [barrier], rng=random.Random(7))
    assert barrier_result[0]["events"][0]["event_type"] == "chase_barrier_resolved"
    executor.execute_commands(campaign, character, "inv1", [_command(
        "chase-pursuer-two", "chase_barrier", payload={"decision_id": "chase-journey", "revision": 5,
        "actor_id": "cultist", "action_id": "barrier:door:negotiate", "method": "negotiate",
        "skill": "Climb", "target": 100})], rng=random.Random(8))
    ended = executor.execute_commands(campaign, character, "inv1", [_command(
        "chase-end", "chase_end", phase="end", payload={"decision_id": "chase-journey", "chase_id": "roof-run",
        "revision": 7, "outcome": "escaped"})], rng=random.Random(9))
    assert ended[0]["events"][0]["event_type"] == "chase_ended"
    assert json.loads(chase_path.read_text())["outcome"] == "escaped"


def _plain_chase_start(command_id: str = "plain-chase-start") -> dict:
    command = _chase_start(command_id)
    command["payload"]["chase_id"] = "plain-roof-run"
    command["payload"]["locations"] = [
        {"label": "roof", "hazard": None, "barrier": None},
        {"label": "middle", "hazard": None, "barrier": None},
        {"label": "escape", "hazard": None, "barrier": None},
    ]
    return command


def test_chase_genesis_rejects_coordinated_origin_history_and_final_position_rewrite(
    tmp_path,
):
    executor = _executor("coc_subsystem_executor_chase_genesis_origin")
    campaign, character = _campaign_and_character(tmp_path)
    inv_path = campaign / "save" / "investigator-state" / "inv1.json"
    inv = json.loads(inv_path.read_text())
    inv.update({"current_hp": 10, "conditions": []})
    inv_path.write_text(json.dumps(inv))
    start = _plain_chase_start()
    _execute(executor, campaign, character, [start], random.Random(1))
    move = _command("plain-chase-move", "chase_move", payload={
        "decision_id": "plain-move", "revision": 1,
        "actor_id": "inv1", "action_id": "move:advance",
    })
    expected = _execute(executor, campaign, character, [move], random.Random(2))
    path = campaign / "save" / "chase.json"
    state = json.loads(path.read_text())
    participant = next(row for row in state["participants"] if row["actor_id"] == "inv1")
    action = state["rounds"][0]["turns"][0]["actions_taken"][0]
    participant.update({"position_origin": 1, "position": 2, "escaped": True})
    action.update({"position_before": 1, "new_position": 2, "location_label": "escape"})
    path.write_text(json.dumps(state))

    with pytest.raises(executor.SubsystemExecutorError, match="genesis"):
        executor.execute_commands(
            campaign, character, "inv1", [move], rng=random.Random(999)
        )
    assert expected[0]["kind"] == "chase_move"


@pytest.mark.parametrize("mutation", ["missing", "duplicate", "cross_chase", "cross_participant"])
def test_chase_genesis_ledger_fails_closed_for_missing_duplicate_and_cross_identity(
    tmp_path, mutation,
):
    executor = _executor(f"coc_subsystem_executor_chase_genesis_{mutation}")
    campaign, character = _campaign_and_character(tmp_path)
    inv_path = campaign / "save" / "investigator-state" / "inv1.json"
    inv = json.loads(inv_path.read_text())
    inv.update({"current_hp": 10, "conditions": []})
    inv_path.write_text(json.dumps(inv))
    start = _plain_chase_start()
    _execute(executor, campaign, character, [start], random.Random(1))
    ledger = campaign / "logs" / "chase-genesis.jsonl"
    record = json.loads(ledger.read_text().splitlines()[0])
    if mutation == "missing":
        ledger.unlink()
    elif mutation == "duplicate":
        ledger.write_text(json.dumps(record) + "\n" + json.dumps(record) + "\n")
    else:
        if mutation == "cross_chase":
            record["chase_id"] = "another-chase"
        else:
            record["participants"][0]["actor_id"] = "another-investigator"
        material = {key: value for key, value in record.items() if key != "genesis_hash"}
        record["genesis_hash"] = executor._canonical_json_hash(material)
        ledger.write_text(json.dumps(record) + "\n")

    with pytest.raises(executor.SubsystemExecutorError, match="genesis"):
        executor.execute_commands(
            campaign, character, "inv1", [start], rng=random.Random(999)
        )


def test_chase_genesis_append_failure_rolls_back_snapshot_ledger_and_retries(
    tmp_path, monkeypatch,
):
    executor = _executor("coc_subsystem_executor_chase_genesis_rollback")
    campaign, character = _campaign_and_character(tmp_path)
    inv_path = campaign / "save" / "investigator-state" / "inv1.json"
    inv = json.loads(inv_path.read_text())
    inv.update({"current_hp": 10, "conditions": []})
    inv_path.write_text(json.dumps(inv))
    start = _plain_chase_start()
    original = executor._append_integrity_evidence

    def append_then_fail(campaign_dir, relative, evidence):
        original(campaign_dir, relative, evidence)
        if relative.as_posix() == "logs/chase-genesis.jsonl":
            raise OSError("simulated chase genesis append crash")

    monkeypatch.setattr(executor, "_append_integrity_evidence", append_then_fail)
    with pytest.raises(executor.SubsystemExecutorError, match="transaction"):
        _execute(executor, campaign, character, [start], random.Random(1))
    assert not (campaign / "save" / "chase.json").exists()
    assert not (campaign / "logs" / "chase-genesis.jsonl").exists()

    monkeypatch.setattr(executor, "_append_integrity_evidence", original)
    result = _execute(executor, campaign, character, [start], random.Random(1))
    assert result[0]["events"][0]["event_type"] == "chase_started"
    assert len((campaign / "logs" / "chase-genesis.jsonl").read_text().splitlines()) == 1


def test_chase_rejects_stale_revision_and_untrusted_action_id_without_mutation(tmp_path):
    executor = _executor("coc_subsystem_executor_chase_guard")
    campaign, character = _campaign_and_character(tmp_path)
    inv = json.loads((campaign / "save" / "investigator-state" / "inv1.json").read_text())
    inv.update({"current_hp": 10, "conditions": []})
    (campaign / "save" / "investigator-state" / "inv1.json").write_text(json.dumps(inv))
    executor.execute_commands(campaign, character, "inv1", [_chase_start()], rng=random.Random(1))
    path = campaign / "save" / "chase.json"
    before = path.read_bytes()
    bad = _command("bad-chase", "chase_move", payload={
        "revision": 0, "actor_id": "inv1", "action_id": "invented-action",
    })
    with pytest.raises(executor.SubsystemExecutorError):
        executor.execute_commands(campaign, character, "inv1", [bad], rng=random.Random(2))
    assert path.read_bytes() == before


def test_chase_multiple_actions_use_player_safe_typed_pending_choice(tmp_path):
    executor = _executor("coc_subsystem_executor_chase_choice")
    campaign, character = _campaign_and_character(tmp_path)
    inv = json.loads((campaign / "save" / "investigator-state" / "inv1.json").read_text())
    inv.update({"current_hp": 10, "conditions": []})
    (campaign / "save" / "investigator-state" / "inv1.json").write_text(json.dumps(inv))
    start = _chase_start()
    start["payload"]["locations"] = [start["payload"]["locations"][0], start["payload"]["locations"][2]]
    executor.execute_commands(campaign, character, "inv1", [start], rng=random.Random(1))
    offer = _command("chase-choice", "chase_move", payload={
        "decision_id": "chase-choice", "revision": 1, "actor_id": "inv1",
        "action_id": "choice:offer",
    })
    offered = executor.execute_commands(campaign, character, "inv1", [offer], rng=random.Random(2))[0]
    choice = offered["pending_choice"]
    assert choice["responder"] == "player"
    assert choice["options"] == [
        {"action": "barrier:door:negotiate", "label": "Negotiate door"},
        {"action": "barrier:door:break", "label": "Break through door"},
    ]
    assert "target" not in json.dumps(choice)
    response = {"choice_id": choice["choice_id"], "responder": "player",
                "revision": 0, "action": "barrier:door:negotiate"}
    plan = executor.plan_from_pending_choice_response(campaign, "inv1", response)
    commands = executor.commands_from_rules_requests(plan)
    result = executor.execute_commands(campaign, character, "inv1", commands, rng=random.Random(3))[0]
    assert result["kind"] == "chase_barrier"
    assert executor.get_current_pending_choice(campaign) is None
    assert executor.plan_from_pending_choice_response(campaign, "inv1", response) == plan


def test_chase_hazard_and_barrier_cannot_override_persisted_action_context(tmp_path):
    executor = _executor("coc_subsystem_executor_chase_context_guard")
    campaign, character = _campaign_and_character(tmp_path)
    inv_path = campaign / "save" / "investigator-state" / "inv1.json"
    inv = json.loads(inv_path.read_text())
    inv.update({"current_hp": 10, "conditions": []})
    inv_path.write_text(json.dumps(inv))
    _execute(executor, campaign, character, [_chase_start()], random.Random(1))
    forged = _command("forged-hazard", "chase_hazard", payload={
        "decision_id": "chase-journey", "revision": 1, "actor_id": "inv1",
        "action_id": "hazard:glass", "skill": "DEX", "target": 1,
        "difficulty": "extreme",
    })
    before = (campaign / "save" / "chase.json").read_bytes()
    with pytest.raises(executor.SubsystemExecutorError, match="override persisted context"):
        _execute(executor, campaign, character, [forged], random.Random(2))
    assert (campaign / "save" / "chase.json").read_bytes() == before


def test_chase_mirrors_authoritative_hp_and_conditions_both_directions(tmp_path):
    executor = _executor("coc_subsystem_executor_chase_bidirectional_mirror")
    campaign, character = _campaign_and_character(tmp_path)
    inv_path = campaign / "save" / "investigator-state" / "inv1.json"
    inv = json.loads(inv_path.read_text())
    inv.update({"current_hp": 10, "conditions": ["major_wound"]})
    inv_path.write_text(json.dumps(inv))
    start = _chase_start()
    start["payload"]["participants"][0]["conditions"] = ["major_wound"]
    _execute(executor, campaign, character, [start], random.Random(1))
    saved = json.loads((campaign / "save" / "chase.json").read_text())
    assert saved["participants"][0]["conditions"] == ["major_wound"]

    inv = json.loads(inv_path.read_text())
    inv.update({"current_hp": 7, "conditions": ["major_wound", "unconscious"]})
    inv_path.write_text(json.dumps(inv))
    hazard = _command("mirror-hazard", "chase_hazard", payload={
        "decision_id": "chase-journey", "revision": 1, "actor_id": "inv1",
        "action_id": "hazard:glass",
    })
    _execute(executor, campaign, character, [hazard], random.Random(5))
    saved = json.loads((campaign / "save" / "chase.json").read_text())
    participant = next(row for row in saved["participants"] if row["actor_id"] == "inv1")
    mirrored = json.loads(inv_path.read_text())
    assert participant["conditions"] == ["major_wound", "unconscious"]
    assert mirrored["current_hp"] == participant["hp"]
    assert mirrored["conditions"] == participant["conditions"]


def test_chase_end_atomically_cancels_matching_chase_choice(tmp_path):
    executor = _executor("coc_subsystem_executor_chase_end_pending")
    campaign, character = _campaign_and_character(tmp_path)
    inv_path = campaign / "save" / "investigator-state" / "inv1.json"
    inv = json.loads(inv_path.read_text())
    inv.update({"current_hp": 10, "conditions": []})
    inv_path.write_text(json.dumps(inv))
    start = _chase_start()
    start["payload"]["locations"] = [start["payload"]["locations"][0], start["payload"]["locations"][2]]
    _execute(executor, campaign, character, [start], random.Random(1))
    offered = _execute(executor, campaign, character, [_command(
        "end-choice", "chase_move", payload={"decision_id": "end-choice", "revision": 1,
        "actor_id": "inv1", "action_id": "choice:offer"})], random.Random(2))[0]
    state_path = campaign / "save" / "subsystem-state.json"
    before = state_path.read_bytes()
    for bad_id, bad_revision in (("another-chase", 1), ("roof-run", 2)):
        with pytest.raises(executor.SubsystemExecutorError) as blocked:
            _execute(executor, campaign, character, [_command(
                f"bad-end-{bad_id}-{bad_revision}", "chase_end", phase="end",
                payload={"decision_id": "end-choice", "chase_id": bad_id,
                         "revision": bad_revision, "outcome": "concluded"})], random.Random(3))
        assert blocked.value.code == "blocked_by_pending_choice"
        assert state_path.read_bytes() == before
    ended = _execute(executor, campaign, character, [_command(
        "end-with-choice", "chase_end", phase="end", payload={"decision_id": "end-choice", "chase_id": "roof-run",
        "revision": 1, "outcome": "concluded"})], random.Random(3))[0]
    assert ended["events"][0]["cancelled_choice_id"] == offered["pending_choice"]["choice_id"]
    assert executor.get_current_pending_choice(campaign) is None
    state = json.loads(state_path.read_text())
    assert not state["pending_choices"] and not state["pending_contexts"]
    history = state["choice_history"][offered["pending_choice"]["choice_id"]]
    assert history["terminal_action"] == "cancelled_by_chase_end"
    assert history["terminal_command_ids"] == ["end-with-choice"]
    assert history["terminal_results"][0] == ended


def test_chase_payloads_and_nested_locations_are_exact_discriminated_contracts(tmp_path):
    executor = _executor("coc_subsystem_executor_chase_exact_contracts")
    campaign, character = _campaign_and_character(tmp_path)
    inv_path = campaign / "save" / "investigator-state" / "inv1.json"
    inv = json.loads(inv_path.read_text())
    inv.update({"current_hp": 10, "conditions": []})
    inv_path.write_text(json.dumps(inv))
    forged = _chase_start()
    forged["payload"]["locations"][1]["hazard"]["keeper_secret"] = True
    with pytest.raises(executor.SubsystemExecutorError, match="hazard contract"):
        _execute(executor, campaign, character, [forged], random.Random(1))
    forged = _chase_start()
    forged["payload"]["unexpected"] = "accepted by the old loose schema"
    with pytest.raises(executor.SubsystemExecutorError, match="exact chase_start"):
        _execute(executor, campaign, character, [forged], random.Random(1))


def test_chase_offer_context_is_anchored_to_independent_append_only_evidence(tmp_path):
    executor = _executor("coc_subsystem_executor_chase_offer_evidence")
    campaign, character = _campaign_and_character(tmp_path)
    inv_path = campaign / "save" / "investigator-state" / "inv1.json"
    inv = json.loads(inv_path.read_text())
    inv.update({"current_hp": 10, "conditions": []})
    inv_path.write_text(json.dumps(inv))
    start = _chase_start()
    start["payload"]["locations"] = [start["payload"]["locations"][0], start["payload"]["locations"][2]]
    _execute(executor, campaign, character, [start], random.Random(1))
    offered = _execute(executor, campaign, character, [_command(
        "anchored-choice", "chase_move", payload={"decision_id": "anchored-choice", "revision": 1,
        "actor_id": "inv1", "action_id": "choice:offer"})], random.Random(2))[0]
    evidence_path = campaign / "logs" / "chase-offers.jsonl"
    evidence = json.loads(evidence_path.read_text().splitlines()[0])
    assert evidence["chase_id"] == "roof-run"
    assert evidence["revision"] == 1
    assert evidence["actor_id"] == "inv1"
    assert evidence["location"]["barrier"]["barrier_id"] == "door"
    assert evidence["options"] == offered["pending_choice"]["options"]

    state_path = campaign / "save" / "subsystem-state.json"
    state = json.loads(state_path.read_text())
    choice_id = offered["pending_choice"]["choice_id"]
    state["pending_contexts"][choice_id]["action_context"]["barrier"]["target"] = 1
    state_path.write_text(json.dumps(state))
    with pytest.raises(executor.SubsystemExecutorError, match="chase offer evidence"):
        executor.get_current_pending_choice(campaign)


def test_chase_offer_evidence_tail_rolls_back_on_commit_failure(tmp_path, monkeypatch):
    executor = _executor("coc_subsystem_executor_chase_offer_rollback")
    campaign, character = _campaign_and_character(tmp_path)
    inv_path = campaign / "save" / "investigator-state" / "inv1.json"
    inv = json.loads(inv_path.read_text())
    inv.update({"current_hp": 10, "conditions": []})
    inv_path.write_text(json.dumps(inv))
    start = _chase_start()
    start["payload"]["locations"] = [start["payload"]["locations"][0], start["payload"]["locations"][2]]
    _execute(executor, campaign, character, [start], random.Random(1))
    state_path = campaign / "save" / "subsystem-state.json"
    real_write = executor._write_executor_state
    calls = 0
    def fail_final_write(campaign_dir, state):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise OSError("injected final state failure")
        return real_write(campaign_dir, state)
    monkeypatch.setattr(executor, "_write_executor_state", fail_final_write)
    with pytest.raises(executor.SubsystemExecutorError, match="subsystem_transaction_failed"):
        _execute(executor, campaign, character, [_command(
            "rollback-choice", "chase_move", payload={"decision_id": "rollback-choice", "revision": 1,
            "actor_id": "inv1", "action_id": "choice:offer"})], random.Random(2))
    assert not (campaign / "logs" / "chase-offers.jsonl").exists()
    assert json.loads(state_path.read_text())["inflight"] is None


def _prepare_canonical_chase_conflict(executor, tmp_path):
    campaign, character = _campaign_and_character(tmp_path)
    inv_path = campaign / "save" / "investigator-state" / "inv1.json"
    inv = json.loads(inv_path.read_text())
    inv.update({"current_hp": 11, "conditions": []})
    inv_path.write_text(json.dumps(inv))
    chase_start = _chase_start("ledger-chase-start")
    chase_start["payload"]["participants"][0]["hp"] = 11
    chase_start["payload"]["locations"] = [
        {"label": "roof", "hazard": None, "barrier": None},
        {"label": "escape", "hazard": None, "barrier": None},
    ]
    _execute(executor, campaign, character, [chase_start], random.Random(1))
    combat_start = _combat_start_command("ledger-combat-start")
    combat_start["payload"]["participants"][0]["dex"] = 80
    _execute(executor, campaign, character, [combat_start], random.Random(2))
    attack = _command("ledger-combat-attack", "combat_attack", phase="declare", payload={
        "decision_id": "combat-decision", "revision": 1,
        "actor_id": "inv1", "target_actor_id": "cultist",
        "declared_intent": "block pursuit", "resolution_hint": "opposed_melee",
        "weapon_id": "unarmed",
    })
    _execute(executor, campaign, character, [attack], random.Random(3))
    defend = _command("ledger-combat-defend", "combat_defend", payload={
        "decision_id": "combat-decision", "revision": 2,
        "actor_id": "cultist", "attack_command_id": "ledger-combat-attack",
        "defense_kind": "dodge",
    })
    _execute(executor, campaign, character, [defend], random.Random(4))
    conflict = _command("ledger-chase-conflict", "chase_conflict", payload={
        "decision_id": "chase-journey", "revision": 1,
        "actor_id": "inv1", "target_actor_id": "cultist",
        "action_id": "conflict:cultist", "combat_command_id": "ledger-combat-defend",
    })
    result = _execute(executor, campaign, character, [conflict], random.Random(5))[0]
    return campaign, conflict, result


def test_chase_conflict_ledger_rejects_rehashed_actor_substitution(tmp_path):
    executor = _executor("coc_subsystem_executor_chase_conflict_actor_binding")
    campaign, command_value, result = _prepare_canonical_chase_conflict(executor, tmp_path)
    ledger_path = campaign / "logs" / "chase-conflicts.jsonl"
    record = json.loads(ledger_path.read_text().splitlines()[0])
    state = json.loads((campaign / "save" / "subsystem-state.json").read_text())
    assert record["chase_command"] == command_value
    assert record["chase_command_hash"] == executor._canonical_command_hash(command_value)
    assert record["chase_command_provenance"] == state["command_provenance"][command_value["command_id"]]
    assert record["chase_event"] == result["events"][0]
    assert record["combat_result_receipt"]["result"] == state["result_snapshots"]["ledger-combat-defend"]
    assert record["combat_result_receipt"]["receipt_hash"] == record["combat_receipt_hash"]
    record["actor_id"], record["target_actor_id"] = (
        record["target_actor_id"], record["actor_id"],
    )
    material = {key: value for key, value in record.items() if key != "consumption_hash"}
    record["consumption_hash"] = executor._canonical_json_hash(material)
    ledger_path.write_text(json.dumps(record) + "\n")

    with pytest.raises(executor.SubsystemExecutorError, match="chase conflict consumption"):
        executor.get_current_pending_choice(campaign)


def test_chase_conflict_ledger_rejects_combat_receipt_cross_field_tampering(tmp_path):
    executor = _executor("coc_subsystem_executor_chase_conflict_receipt_binding")
    campaign, _command_value, _result = _prepare_canonical_chase_conflict(executor, tmp_path)
    ledger_path = campaign / "logs" / "chase-conflicts.jsonl"
    record = json.loads(ledger_path.read_text().splitlines()[0])
    record["combat_receipt"]["combat_id"] = "forged-combat"
    record["combat_result_receipt"]["result"]["events"][0]["combat_id"] = "forged-combat"
    material = {key: value for key, value in record.items() if key != "consumption_hash"}
    record["consumption_hash"] = executor._canonical_json_hash(material)
    ledger_path.write_text(json.dumps(record) + "\n")

    with pytest.raises(executor.SubsystemExecutorError, match="chase conflict consumption"):
        executor.get_current_pending_choice(campaign)


def _keeper_response(choice: dict, action: str = "tick") -> dict:
    return {
        "choice_id": choice["choice_id"],
        "responder": "keeper",
        "revision": choice["revision"],
        "action": action,
    }


def _execute(module, campaign: Path, character: Path, commands: list[dict], rng):
    return module.execute_commands(
        campaign,
        character,
        "inv1",
        commands,
        rng=rng,
    )


def test_amount_roll_role_is_a_closed_validated_union():
    executor = _executor("coc_subsystem_executor_amount_union")
    valid = {
        "roll_id": "amount-1",
        "roll_role": "amount",
        "rolled_total": 7,
        "dice": {"expression": "2D6+1", "raw": [2, 4], "total": 7},
        "outcome": "damage_applied",
    }
    executor._validate_roll_event_role(valid, "amount")

    invalid_rows = [
        {**valid, "target": 50},
        {**valid, "difficulty": "hard"},
        {**valid, "success": False},
        {**valid, "roll": 7},
        {key: value for key, value in valid.items() if key != "dice"},
        {**valid, "dice": {"expression": "2D6+1", "raw": [2], "total": 3}, "rolled_total": 3},
        {**valid, "dice": {"expression": "2D6+1", "raw": [2, 7], "total": 10}, "rolled_total": 10},
        {**valid, "dice": {"expression": "2D6+1", "raw": [2, 4], "total": 6}},
        {**valid, "rolled_total": True},
    ]
    for offset, invalid in enumerate(invalid_rows):
        with pytest.raises(executor.SubsystemExecutorError):
            executor._validate_roll_event_role(invalid, f"amount[{offset}]")


def test_sanity_reward_persists_and_replays_canonical_amount_evidence(tmp_path):
    executor = _executor("coc_subsystem_executor_san_reward_amount")
    campaign, character = _campaign_and_character(tmp_path)
    command = _command("san-reward-amount", "sanity_reward", payload={
        "decision_id": "san-reward-amount",
        "roll_id": "san-reward-amount",
        "die": "1D6",
        "source": "scenario reward",
        "rule_ref": "module.test.reward",
    })

    first = _execute(executor, campaign, character, [command], random.Random(4))[0]
    amount = first["events"][0]
    assert amount["roll_role"] == "amount"
    assert amount["rolled_total"] == amount["dice"]["total"]
    assert amount["dice"]["raw"] == [amount["rolled_total"]]
    assert not executor.AMOUNT_FORBIDDEN_FIELDS.intersection(amount)
    row = json.loads(
        (campaign / "logs" / "rolls.jsonl").read_text().splitlines()[0]
    )
    assert row["payload"] == {**amount, "visibility": "public"}
    replay = _execute(executor, campaign, character, [command], random.Random(999))[0]
    assert replay == first


def test_authored_hazard_and_damaged_tome_are_transactional_exact_replays(tmp_path):
    executor = _executor("coc_subsystem_executor_authored_operations")
    campaign, character = _campaign_and_character(tmp_path)
    sheet = json.loads(character.read_text())
    sheet["characteristics"].update({"LUCK": 1})
    sheet["derived"]["HP"] = 12
    sheet["skills"].update({"Jump": 1, "Read Latin": 100, "Cthulhu Mythos": 0})
    character.write_text(json.dumps(sheet))
    inv_path = campaign / "save" / "investigator-state" / "inv1.json"
    inv = json.loads(inv_path.read_text())
    inv.update({"current_hp": 12, "hp_max": 12, "conditions": [], "max_san": 99, "cm_value": 0})
    inv_path.write_text(json.dumps(inv))

    hazard = _command("chapel-floor", "environmental_hazard", payload={
        "decision_id": "chapel-floor", "roll_id": "chapel-floor",
        "luck_skill": "Luck", "jump_skill": "Jump", "damage_expr": "1D6",
        "source": "weak floor", "rule_ref": "module.test.floor",
    })
    first = _execute(executor, campaign, character, [hazard], random.Random(2))[0]
    assert [row.get("skill") for row in first["events"] if row.get("roll_id")][:2] == [
        "Luck", "Jump",
    ]
    assert any(row.get("skill") == "HP Damage" for row in first["events"])
    damage_amount = next(
        row for row in first["events"] if row.get("skill") == "HP Damage"
    )
    assert damage_amount["roll_role"] == "amount"
    assert damage_amount["rolled_total"] == damage_amount["dice"]["total"]
    assert damage_amount["target_actor_id"] == "inv1"
    assert not executor.AMOUNT_FORBIDDEN_FIELDS.intersection(damage_amount)
    after_hazard = json.loads(inv_path.read_text())
    roll_lines = (campaign / "logs" / "rolls.jsonl").read_text().splitlines()
    replay_rng = random.Random(999)
    rng_before = replay_rng.getstate()
    assert _execute(executor, campaign, character, [hazard], replay_rng)[0] == first
    assert replay_rng.getstate() == rng_before
    assert json.loads(inv_path.read_text()) == after_hazard
    assert (campaign / "logs" / "rolls.jsonl").read_text().splitlines() == roll_lines

    tome = _command("damaged-tome", "mythos_tome_study", payload={
        "decision_id": "damaged-tome", "roll_id": "damaged-tome",
        "tome_id": "damaged-liber", "language_skill": "Read Latin",
        "language_threshold": 50, "duration_minutes": 180,
        "mythos_gain": 2, "max_san_reduction": 2,
        "rule_ref": "module.test.damaged_tome",
    })
    studied = _execute(executor, campaign, character, [tome], random.Random(3))[0]
    assert not any(row.get("roll_id") for row in studied["events"])
    after_tome = json.loads(inv_path.read_text())
    assert after_tome["cm_value"] == 2
    assert after_tome["max_san"] == 97
    time_path = campaign / "save" / "time-state.json"
    time_after = json.loads(time_path.read_text())
    assert time_after["clock"]["elapsed_minutes"] == 180
    rolls_after = (campaign / "logs" / "rolls.jsonl").read_text()
    time_log_after = (campaign / "logs" / "time.jsonl").read_text()
    assert _execute(executor, campaign, character, [tome], random.Random(88))[0] == studied
    assert json.loads(inv_path.read_text()) == after_tome
    assert json.loads(time_path.read_text()) == time_after
    assert (campaign / "logs" / "rolls.jsonl").read_text() == rolls_after
    assert (campaign / "logs" / "time.jsonl").read_text() == time_log_after


def test_authored_tome_failure_rolls_back_time_state_logs_and_rng(tmp_path, monkeypatch):
    executor = _executor("coc_subsystem_executor_authored_tome_rollback")
    campaign, character = _campaign_and_character(tmp_path)
    sheet = json.loads(character.read_text())
    sheet["skills"].update({"Read Latin": 100})
    character.write_text(json.dumps(sheet))
    inv_path = campaign / "save" / "investigator-state" / "inv1.json"
    before_inv = inv_path.read_bytes()
    rng = random.Random(9)
    rng_before = rng.getstate()
    real_write = executor.coc_fileio.write_json_atomic

    def fail_inv(path, payload, **kwargs):
        if Path(path) == inv_path:
            raise OSError("injected authored operation mirror failure")
        return real_write(path, payload, **kwargs)

    monkeypatch.setattr(executor.coc_fileio, "write_json_atomic", fail_inv)
    tome = _command("rollback-tome", "mythos_tome_study", payload={
        "decision_id": "rollback-tome", "roll_id": "rollback-tome",
        "tome_id": "damaged-liber", "language_skill": "Read Latin",
        "language_threshold": 50, "duration_minutes": 180,
        "mythos_gain": 2, "max_san_reduction": 2,
        "rule_ref": "module.test.damaged_tome",
    })
    with pytest.raises(executor.SubsystemExecutorError) as exc:
        _execute(executor, campaign, character, [tome], rng)
    assert exc.value.code == "subsystem_transaction_failed"
    assert rng.getstate() == rng_before
    assert inv_path.read_bytes() == before_inv
    assert not (campaign / "save" / "time-state.json").exists()
    assert not (campaign / "logs" / "time.jsonl").exists()
    state = json.loads((campaign / "save" / "subsystem-state.json").read_text())
    assert state["applied_command_ids"] == []
    assert state["inflight"] is None


def test_authored_operation_success_failure_branches_and_source_trace(tmp_path):
    executor = _executor("coc_subsystem_executor_authored_branches")

    def setup(root, *, luck, jump, latin):
        campaign, character = _campaign_and_character(root)
        sheet = json.loads(character.read_text())
        sheet["characteristics"]["LUCK"] = luck
        sheet["derived"]["HP"] = 12
        sheet["skills"].update({"Jump": jump, "Read Latin": latin, "Cthulhu Mythos": 0})
        character.write_text(json.dumps(sheet))
        inv_path = campaign / "save" / "investigator-state" / "inv1.json"
        inv = json.loads(inv_path.read_text())
        inv.update({"current_hp": 12, "hp_max": 12, "conditions": [], "cm_value": 0, "max_san": 99})
        inv_path.write_text(json.dumps(inv))
        return campaign, character, inv_path

    def hazard(command_id):
        return _command(command_id, "environmental_hazard", payload={
            "decision_id": command_id, "roll_id": command_id,
            "luck_skill": "Luck", "jump_skill": "Jump", "damage_expr": "1D6",
            "source": "chapel weakened floor", "rule_ref": "module.haunting.floor",
        })

    luck_camp, luck_char, luck_inv = setup(tmp_path / "luck", luck=50, jump=1, latin=1)
    luck_result = _execute(executor, luck_camp, luck_char, [hazard("luck-safe")], random.Random(0))[0]
    assert [row.get("skill") for row in luck_result["events"] if row.get("roll_id")] == ["Luck"]
    assert json.loads(luck_inv.read_text())["current_hp"] == 12
    assert luck_result["events"][-1]["success"] is True

    jump_camp, jump_char, jump_inv = setup(tmp_path / "jump", luck=1, jump=50, latin=1)
    jump_result = _execute(executor, jump_camp, jump_char, [hazard("jump-safe")], random.Random(2))[0]
    assert [row.get("skill") for row in jump_result["events"] if row.get("roll_id")] == ["Luck", "Jump"]
    assert json.loads(jump_inv.read_text())["current_hp"] == 12
    assert jump_result["events"][-1]["success"] is True
    roll_rows = [json.loads(line) for line in (jump_camp / "logs" / "rolls.jsonl").read_text().splitlines()]
    assert all(row["payload"]["reason"] == "chapel weakened floor" for row in roll_rows)

    tome_camp, tome_char, tome_inv = setup(tmp_path / "tome", luck=1, jump=1, latin=1)
    tome = _command("latin-fails", "mythos_tome_study", payload={
        "decision_id": "latin-fails", "roll_id": "latin-fails",
        "tome_id": "damaged-liber", "language_skill": "Read Latin",
        "language_threshold": 50, "duration_minutes": 180,
        "mythos_gain": 2, "max_san_reduction": 2,
        "rule_ref": "module.haunting.damaged_liber",
    })
    failed = _execute(executor, tome_camp, tome_char, [tome], random.Random(2))[0]
    assert failed["events"][0]["skill"] == "Read Latin"
    assert failed["events"][0]["success"] is False
    inv_failed = json.loads(tome_inv.read_text())
    assert inv_failed["cm_value"] == 0 and inv_failed["max_san"] == 99
    inv_failed_text = tome_inv.read_text()
    time_failed = (tome_camp / "save" / "time-state.json").read_text()
    logs_failed = (tome_camp / "logs" / "rolls.jsonl").read_text()
    assert json.loads(time_failed)["clock"]["elapsed_minutes"] == 180
    assert _execute(executor, tome_camp, tome_char, [tome], random.Random(99))[0] == failed
    assert tome_inv.read_text() == inv_failed_text
    assert (tome_camp / "save" / "time-state.json").read_text() == time_failed
    assert (tome_camp / "logs" / "rolls.jsonl").read_text() == logs_failed


def _combat_start_command(command_id: str = "combat-start") -> dict:
    return _command(command_id, "combat_start", phase="start", payload={
        "decision_id": "combat-decision",
        "combat_id": "fight-1",
        "scene_ref": "scene/fight",
        "turn_number": 3,
        "participants": [
            {
                "actor_id": "inv1", "side": "investigator", "dex": 60,
                "combat_skill": 60, "dodge_skill": 40, "build": 0,
                "hp_max": 11, "hp_current": 11, "con": 60,
                "weapons": [{"weapon_id": "unarmed"}], "conditions": [],
            },
            {
                "actor_id": "cultist", "side": "npc", "dex": 70,
                "combat_skill": 45, "dodge_skill": 25, "build": 0,
                "hp_max": 9, "hp_current": 9, "con": 45,
                "weapons": [{"weapon_id": "unarmed"}], "conditions": [],
            },
        ],
    })


def test_combat_commands_persist_defense_and_reload_hp_atomically(tmp_path):
    executor = _executor("coc_subsystem_executor_combat_journey")
    campaign, character = _campaign_and_character(tmp_path)
    state_path = campaign / "save" / "investigator-state" / "inv1.json"
    inv_state = json.loads(state_path.read_text(encoding="utf-8"))
    inv_state.update({"current_hp": 11, "conditions": []})
    state_path.write_text(json.dumps(inv_state), encoding="utf-8")

    started = _execute(
        executor, campaign, character, [_combat_start_command()], random.Random(1)
    )[0]
    assert started["events"][0]["event_type"] == "combat_started"

    attack = _command("combat-attack", "combat_attack", phase="declare", payload={
        "decision_id": "combat-decision", "revision": 1,
        "actor_id": "cultist", "target_actor_id": "inv1",
        "declared_intent": "structured attack", "resolution_hint": "opposed_melee",
        "weapon_id": "unarmed",
    })
    declared = _execute(
        executor, campaign, character, [attack], random.Random(2)
    )[0]
    assert declared["events"][0]["event_type"] == "combat_defense_required"
    assert declared["events"][0]["allowed_defenses"] == ["dodge", "fight_back"]

    defend = _command("combat-defend", "combat_defend", payload={
        "decision_id": "combat-decision", "revision": 2,
        "actor_id": "inv1", "attack_command_id": "combat-attack",
        "defense_kind": "fight_back",
    })
    resolved = _execute(
        executor, campaign, character, [defend], random.Random(7)
    )[0]
    assert resolved["events"][0]["event_type"] == "combat_turn_resolved"
    saved = executor.coc_combat.CombatSession.load(
        campaign, rng=random.Random(9),
        damage_evidence=executor.load_combat_damage_evidence(campaign),
    )
    assert saved.pending_attack is None
    assert saved.revision == 3
    mirror = json.loads(state_path.read_text(encoding="utf-8"))
    assert mirror["current_hp"] == saved.participants["inv1"]["hp_current"]
    assert mirror["conditions"] == saved.participants["inv1"]["conditions"]
    for wound in mirror.get("wound_ledger", []):
        assert wound["source_damage_roll_id"] in {
            damage["damage_roll_id"] for damage in saved.damage_chain
            if damage.get("target_actor_id") == "inv1"
        }
        assert wound["wound_id"] == f"wound-{wound['source_damage_roll_id'].replace(':', '-')}"

    replay = _execute(
        executor, campaign, character, [defend], random.Random(999)
    )[0]
    assert replay == resolved


def test_combat_mp_preparation_and_attack_cost_mirror_and_replay(tmp_path):
    executor = _executor("coc_subsystem_executor_combat_mp_mirror")
    campaign, character = _campaign_and_character(tmp_path)
    state_path = campaign / "save" / "investigator-state" / "inv1.json"
    inv_state = json.loads(state_path.read_text(encoding="utf-8"))
    inv_state.update({
        "current_hp": 11,
        "current_mp": 10,
        "conditions": [],
    })
    state_path.write_text(json.dumps(inv_state), encoding="utf-8")
    start = _combat_start_command("mp-combat-start")
    start["payload"]["participants"][0].update({
        "dex": 80,
        "magic_points": 10,
    })
    start["payload"]["preparations"] = [{
        "effect_id": "mp-ward",
        "actor_id": "inv1",
        "resource": "magic_points",
        "cost": 3,
        "effect_kind": "protective_ward",
        "duration_rounds": 2,
        "rule_ref": "test.combat.mp_preparation",
    }]

    started = _execute(
        executor, campaign, character, [start], random.Random(1)
    )[0]
    assert started["events"][1] == {
        "event_type": "resource_change",
        "actor_id": "inv1",
        "resource": "magic_points",
        "reason": "protective_ward",
        "before": 10,
        "cost": 3,
        "delta": -3,
        "after": 7,
        "armor_rolls": [],
        "armor_points": 0,
        "duration_rounds": 2,
        "rule_ref": "test.combat.mp_preparation",
        "source_command_id": "mp-combat-start",
    }
    assert json.loads(state_path.read_text(encoding="utf-8"))["current_mp"] == 7
    start_replay = _execute(
        executor, campaign, character, [start], random.Random(99)
    )[0]
    assert start_replay == started
    assert json.loads(state_path.read_text(encoding="utf-8"))["current_mp"] == 7

    attack = _command(
        "mp-combat-attack",
        "combat_attack",
        phase="declare",
        payload={
            "decision_id": "combat-decision",
            "revision": 1,
            "actor_id": "inv1",
            "target_actor_id": "cultist",
            "declared_intent": "power the warded strike",
            "resolution_hint": "opposed_melee",
            "weapon_id": "unarmed",
            "resource_cost": {
                "resource": "magic_points",
                "cost": 2,
                "reason": "warded strike",
                "rule_ref": "test.combat.mp_attack",
            },
        },
    )
    declared = _execute(
        executor, campaign, character, [attack], random.Random(2)
    )[0]
    assert declared["events"][1]["before"] == 7
    assert declared["events"][1]["after"] == 5
    assert json.loads(state_path.read_text(encoding="utf-8"))["current_mp"] == 5
    loaded = executor.coc_combat.CombatSession.load(
        campaign,
        rng=random.Random(3),
        damage_evidence=executor.load_combat_damage_evidence(campaign),
    )
    assert loaded.participants["inv1"]["magic_points"] == 5
    attack_replay = _execute(
        executor, campaign, character, [attack], random.Random(999)
    )[0]
    assert attack_replay == declared
    assert json.loads(state_path.read_text(encoding="utf-8"))["current_mp"] == 5


def test_combat_armor_preparation_persists_one_canonical_amount_roll(tmp_path):
    executor = _executor("coc_subsystem_executor_armor_amount")
    campaign, character = _campaign_and_character(tmp_path)
    state_path = campaign / "save" / "investigator-state" / "inv1.json"
    state = json.loads(state_path.read_text(encoding="utf-8"))
    state.update({"current_hp": 11, "current_mp": 2, "conditions": []})
    state_path.write_text(json.dumps(state), encoding="utf-8")
    start = _combat_start_command("armor-amount-start")
    start["payload"]["participants"][0]["magic_points"] = 2
    start["payload"]["preparations"] = [{
        "effect_id": "flesh-ward",
        "actor_id": "inv1",
        "resource": "magic_points",
        "cost": 2,
        "effect_kind": "flesh_ward",
        "duration_rounds": 3,
        "rule_ref": "core.magic.flesh_ward",
        "armor_dice": "2D6",
        "armor_rule": "degrades_1_per_damage",
    }]

    first = _execute(executor, campaign, character, [start], random.Random(7))[0]
    amount = next(event for event in first["events"] if event.get("roll_id"))
    assert amount["roll_role"] == "amount"
    assert amount["rolled_total"] == sum(amount["dice"]["raw"])
    assert amount["rolled_total"] == amount["dice"]["total"]
    assert not executor.AMOUNT_FORBIDDEN_FIELDS.intersection(amount)
    rows = [
        json.loads(line)
        for line in (campaign / "logs" / "rolls.jsonl").read_text().splitlines()
    ]
    assert [row["roll_id"] for row in rows] == [amount["roll_id"]]
    assert rows[0]["payload"] == {**amount, "visibility": "public"}
    replay = _execute(executor, campaign, character, [start], random.Random(999))[0]
    assert replay == first


@pytest.mark.parametrize("invalid_mp", [None, True, -1, 1.5])
def test_combat_start_requires_exact_current_mp_without_rng_or_writes(
    tmp_path, invalid_mp,
):
    executor = _executor(f"coc_subsystem_executor_strict_mp_{invalid_mp!r}")
    campaign, character = _campaign_and_character(tmp_path)
    state_path = campaign / "save" / "investigator-state" / "inv1.json"
    state = json.loads(state_path.read_text(encoding="utf-8"))
    if invalid_mp is None:
        state.pop("current_mp")
    else:
        state["current_mp"] = invalid_mp
    state_path.write_text(json.dumps(state), encoding="utf-8")
    before = {
        path.relative_to(campaign): path.read_bytes()
        for path in campaign.rglob("*")
        if path.is_file() and "locks" not in path.parts
    }
    rng = random.Random(441)
    rng_before = rng.getstate()

    with pytest.raises(executor.SubsystemExecutorError, match="current_mp"):
        _execute(executor, campaign, character, [_combat_start_command()], rng)

    assert rng.getstate() == rng_before
    assert {
        path.relative_to(campaign): path.read_bytes()
        for path in campaign.rglob("*")
        if path.is_file() and "locks" not in path.parts
    } == before


@pytest.mark.parametrize("continuation", ["attack", "defend", "end"])
def test_active_combat_mp_divergence_rejects_before_rng_or_writes(
    tmp_path, continuation,
):
    executor = _executor(f"coc_subsystem_executor_mp_divergence_{continuation}")
    campaign, character = _campaign_and_character(tmp_path)
    state_path = campaign / "save" / "investigator-state" / "inv1.json"
    state = json.loads(state_path.read_text(encoding="utf-8"))
    state.update({"current_hp": 11, "current_mp": 0, "conditions": []})
    state_path.write_text(json.dumps(state), encoding="utf-8")
    _execute(
        executor, campaign, character, [_combat_start_command()], random.Random(1)
    )
    attack = _command("mp-stale-attack", "combat_attack", phase="declare", payload={
        "decision_id": "mp-stale", "revision": 1,
        "actor_id": "cultist", "target_actor_id": "inv1",
        "declared_intent": "test stale authority",
        "resolution_hint": "opposed_melee", "weapon_id": "unarmed",
    })
    if continuation == "defend":
        _execute(executor, campaign, character, [attack], random.Random(2))
        command = _command("mp-stale-defend", "combat_defend", payload={
            "decision_id": "mp-stale", "revision": 2,
            "actor_id": "inv1", "attack_command_id": "mp-stale-attack",
            "defense_kind": "dodge",
        })
    elif continuation == "end":
        command = _command("mp-stale-end", "combat_end", phase="end", payload={
            "decision_id": "mp-stale", "revision": 1,
            "outcome": "stalemate",
        })
    else:
        command = attack
    state = json.loads(state_path.read_text(encoding="utf-8"))
    state["current_mp"] = 1
    state_path.write_text(json.dumps(state), encoding="utf-8")
    before = {
        path.relative_to(campaign): path.read_bytes()
        for path in campaign.rglob("*")
        if path.is_file() and "locks" not in path.parts
    }
    rng = random.Random(552)
    rng_before = rng.getstate()

    with pytest.raises(executor.SubsystemExecutorError, match="active combat MP"):
        _execute(executor, campaign, character, [command], rng)

    assert rng.getstate() == rng_before
    assert {
        path.relative_to(campaign): path.read_bytes()
        for path in campaign.rglob("*")
        if path.is_file() and "locks" not in path.parts
    } == before


def test_combat_save_then_mirror_failure_rolls_back_both_preimages(
    tmp_path, monkeypatch,
):
    executor = _executor("coc_subsystem_executor_mp_mirror_rollback")
    campaign, character = _campaign_and_character(tmp_path)
    state_path = campaign / "save" / "investigator-state" / "inv1.json"
    state = json.loads(state_path.read_text(encoding="utf-8"))
    state.update({"current_hp": 11, "current_mp": 0, "conditions": []})
    state_path.write_text(json.dumps(state), encoding="utf-8")
    before_state = state_path.read_bytes()
    original_sync = executor._sync_investigator_from_combat

    def fail_after_combat_save(*args, **kwargs):
        assert (campaign / "save" / "combat.json").is_file()
        raise RuntimeError("injected mirror failure")

    monkeypatch.setattr(executor, "_sync_investigator_from_combat", fail_after_combat_save)
    rng = random.Random(663)
    rng_before = rng.getstate()
    with pytest.raises(executor.SubsystemExecutorError, match="injected mirror failure"):
        _execute(executor, campaign, character, [_combat_start_command()], rng)

    assert rng.getstate() == rng_before
    assert not (campaign / "save" / "combat.json").exists()
    assert state_path.read_bytes() == before_state
    monkeypatch.setattr(executor, "_sync_investigator_from_combat", original_sync)


def test_combat_luck_precommit_spends_minimum_and_preserves_raw_die(tmp_path):
    executor = _executor("coc_subsystem_executor_combat_luck_precommit")
    campaign, character = _campaign_and_character(tmp_path)
    state_path = campaign / "save" / "investigator-state" / "inv1.json"
    inv_state = json.loads(state_path.read_text(encoding="utf-8"))
    inv_state.update({"current_hp": 11, "current_luck": 55, "conditions": []})
    state_path.write_text(json.dumps(inv_state), encoding="utf-8")
    _execute(
        executor, campaign, character, [_combat_start_command()], random.Random(1)
    )
    attack = _command("luck-attack", "combat_attack", phase="declare", payload={
        "decision_id": "combat-luck", "revision": 1,
        "actor_id": "cultist", "target_actor_id": "inv1",
        "declared_intent": "strike the investigator",
        "resolution_hint": "opposed_melee", "weapon_id": "unarmed",
    })
    _execute(executor, campaign, character, [attack], random.Random(2))
    defend = _command("luck-defense", "combat_defend", payload={
        "decision_id": "combat-luck", "revision": 2,
        "actor_id": "inv1", "attack_command_id": "luck-attack",
        "defense_kind": "dodge", "luck_spend_max": 40,
        "luck_actor_id": "inv1",
    })

    resolved = _execute(
        executor, campaign, character, [defend], random.Random(3)
    )[0]
    replay = _execute(
        executor, campaign, character, [defend], random.Random(999)
    )[0]

    assert replay == resolved
    turn = resolved["events"][0]["turn"]
    assert turn["outcome"] == "miss"
    assert turn["opposed_outcome"] == "tie_defender_wins"
    luck_event = next(
        event for event in resolved["events"]
        if event.get("event_type") == "combat_luck_spent"
    )
    assert luck_event["original_roll"] == 76
    assert luck_event["adjusted_roll"] == 40
    assert luck_event["luck_spent"] == 36
    assert luck_event["luck_after"] == 19
    roll = next(
        event for event in resolved["events"]
        if event.get("event_type") == "combat_roll"
        and event.get("actor_id") == "inv1"
    )
    assert roll["roll"] == 40
    assert roll["original_roll"] == 76
    assert roll["adjusted_roll"] == 40
    assert roll["luck_spent"] == 36
    assert roll["luck_before"] == 55
    assert roll["luck_after"] == roll["luck_remaining"] == 19
    assert roll["dice"] == {"expression": "1D100", "raw": [76], "total": 76}
    assert roll["base_target"] == 40
    assert roll["required_level"] == "regular"
    assert roll["required_target"] == 40
    assert roll["achieved_level"] == "regular"
    assert roll["passed"] is True
    assert roll["success"] is True
    assert roll["surplus_levels"] == 0
    assert roll["outcome"] == "regular"
    executor._validate_combat_luck_bindings(
        [event for event in resolved["events"] if isinstance(event, dict)],
        "resolved.events",
    )
    for field, replacement in (
        ("original_roll", 75),
        ("adjusted_roll", 39),
        ("luck_spent", 35),
        ("luck_before", 54),
        ("luck_after", 18),
        ("luck_remaining", 18),
    ):
        tampered = json.loads(json.dumps(roll))
        tampered[field] = replacement
        with pytest.raises(executor.SubsystemExecutorError):
            executor._validate_roll_event_role(tampered, f"luck.{field}")
    partial = json.loads(json.dumps(roll))
    partial.pop("luck_before")
    with pytest.raises(executor.SubsystemExecutorError, match="partial Luck"):
        executor._validate_roll_event_role(partial, "luck.partial")
    tampered_dice = json.loads(json.dumps(roll))
    tampered_dice["dice"]["raw"] = [75]
    with pytest.raises(executor.SubsystemExecutorError, match="Luck-adjusted"):
        executor._validate_roll_event_role(tampered_dice, "luck.dice")
    mismatched_source = json.loads(json.dumps(luck_event))
    mismatched_source["luck_spent"] -= 1
    with pytest.raises(executor.SubsystemExecutorError, match="contradicts"):
        executor._validate_combat_luck_bindings(
            [roll, mismatched_source], "luck.binding"
        )
    final_state = json.loads(state_path.read_text(encoding="utf-8"))
    assert final_state["current_luck"] == 19


def test_dying_tick_and_stabilize_use_structured_healing_rules(tmp_path):
    executor = _executor("coc_subsystem_executor_rescue")
    campaign, character = _campaign_and_character(tmp_path)
    state_path = campaign / "save" / "investigator-state" / "inv1.json"
    inv_state = json.loads(state_path.read_text(encoding="utf-8"))
    inv_state.update({
        "current_hp": 0,
        "conditions": ["major_wound", "dying", "unconscious"],
    })
    state_path.write_text(json.dumps(inv_state), encoding="utf-8")

    tick = _command("dying-tick", "dying_tick", payload={
        "decision_id": "rescue", "clock_kind": "round",
    })
    ticked = _execute(executor, campaign, character, [tick], random.Random(1))[0]
    assert ticked["events"][0]["event_type"] == "dying_con_roll"
    assert ticked["events"][0]["died"] is False

    aid = _command("first-aid", "stabilize", payload={
        "decision_id": "rescue", "method": "first_aid", "skill_value": 99,
    })
    stabilized = _execute(executor, campaign, character, [aid], random.Random(2))[0]
    assert stabilized["events"][0]["event_type"] == "first_aid_stabilize"
    final_state = json.loads(state_path.read_text(encoding="utf-8"))
    assert "stabilized" in final_state["conditions"]
    assert "dead" not in final_state["conditions"]


def test_deteriorated_stabilization_reopens_first_aid_window_and_migrates_legacy_usage(
    tmp_path,
):
    executor = _executor("coc_subsystem_executor_rescue_reopen")
    campaign, character = _campaign_and_character(tmp_path)
    state_path = campaign / "save" / "investigator-state" / "inv1.json"
    inv_state = json.loads(state_path.read_text(encoding="utf-8"))
    inv_state.update({
        "current_hp": 0,
        "conditions": ["major_wound", "dying", "unconscious"],
    })
    state_path.write_text(json.dumps(inv_state), encoding="utf-8")

    first = _command("aid-initial", "stabilize", payload={
        "decision_id": "aid-initial",
        "method": "first_aid",
        "skill_value": 99,
    })
    _execute(executor, campaign, character, [first], random.Random(1))
    tick = _command("stabilized-hour-fails", "dying_tick", payload={
        "decision_id": "stabilized-hour-fails",
        "clock_kind": "hour",
    })
    ticked = _execute(executor, campaign, character, [tick], random.Random(5))[0]
    assert ticked["events"][0]["deteriorated"] is True

    # Simulate the pre-fix producer: it recorded the structured deterioration
    # result but left the old treatment flags locked in investigator-state.
    legacy = json.loads(state_path.read_text(encoding="utf-8"))
    for days in legacy["healing_usage"]["records"].values():
        for flags in days.values():
            flags["first_aid_used"] = True
            flags["first_aid_push_used"] = True
    state_path.write_text(json.dumps(legacy), encoding="utf-8")

    retry = _command("aid-after-deterioration", "stabilize", payload={
        "decision_id": "aid-after-deterioration",
        "method": "first_aid",
        "skill_value": 99,
        "pushed": True,
        "changed_method": "replace packing and maintain the airway",
        "failure_consequence": "resolve the next dying CON clock immediately",
    })
    rescued = _execute(
        executor, campaign, character, [retry], random.Random(1)
    )[0]
    assert rescued["events"][0]["event_type"] == "first_aid_stabilize"
    assert rescued["events"][0]["pushed"] is True
    final_state = json.loads(state_path.read_text(encoding="utf-8"))
    assert final_state["current_hp"] == 1
    assert "stabilized" in final_state["conditions"]


def test_survived_dying_round_reopens_one_subsequent_pushed_first_aid_attempt(
    tmp_path,
):
    executor = _executor("coc_subsystem_executor_rescue_next_round")
    campaign, character = _campaign_and_character(tmp_path)
    state_path = campaign / "save" / "investigator-state" / "inv1.json"
    inv_state = json.loads(state_path.read_text(encoding="utf-8"))
    inv_state.update({
        "current_hp": 0,
        "conditions": ["major_wound", "dying", "unconscious"],
    })
    state_path.write_text(json.dumps(inv_state), encoding="utf-8")

    failed = _command("aid-round-1", "stabilize", payload={
        "decision_id": "aid-round-1",
        "method": "first_aid",
        "skill_value": 1,
    })
    _execute(executor, campaign, character, [failed], random.Random(1))
    pushed = _command("aid-round-1-push", "stabilize", payload={
        "decision_id": "aid-round-1-push",
        "method": "first_aid",
        "skill_value": 1,
        "pushed": True,
        "changed_method": "replace packing",
        "failure_consequence": "resolve the dying CON clock",
    })
    _execute(executor, campaign, character, [pushed], random.Random(1))
    tick = _command("dying-round-1", "dying_tick", payload={
        "decision_id": "dying-round-1",
        "clock_kind": "round",
    })
    survived = _execute(
        executor, campaign, character, [tick], random.Random(1)
    )[0]
    assert survived["events"][0]["died"] is False

    next_attempt = _command("aid-round-2-push", "stabilize", payload={
        "decision_id": "aid-round-2-push",
        "method": "first_aid",
        "skill_value": 99,
        "pushed": True,
        "changed_method": "second-round airway support",
        "failure_consequence": "resolve the next dying CON clock",
    })
    rescued = _execute(
        executor, campaign, character, [next_attempt], random.Random(1)
    )[0]
    assert rescued["events"][0]["event_type"] == "first_aid_stabilize"
    assert rescued["events"][0]["pushed"] is True


def test_combat_start_rejects_forged_investigator_hp(tmp_path):
    executor = _executor("coc_subsystem_executor_combat_start_mirror")
    campaign, character = _campaign_and_character(tmp_path)
    inv_path = campaign / "save" / "investigator-state" / "inv1.json"
    inv = json.loads(inv_path.read_text(encoding="utf-8"))
    inv.update({"current_hp": 3, "conditions": ["major_wound"]})
    inv_path.write_text(json.dumps(inv), encoding="utf-8")
    with pytest.raises(executor.SubsystemExecutorError, match="combat participant must match"):
        _execute(executor, campaign, character, [_combat_start_command()], random.Random(1))


def test_combat_start_rejects_forged_investigator_mp(tmp_path):
    executor = _executor("coc_subsystem_executor_combat_start_mp_mirror")
    campaign, character = _campaign_and_character(tmp_path)
    inv_path = campaign / "save" / "investigator-state" / "inv1.json"
    inv = json.loads(inv_path.read_text(encoding="utf-8"))
    inv.update({"current_hp": 11, "current_mp": 8, "conditions": []})
    inv_path.write_text(json.dumps(inv), encoding="utf-8")
    start = _combat_start_command()
    start["payload"]["participants"][0]["magic_points"] = 7

    with pytest.raises(
        executor.SubsystemExecutorError,
        match="combat participant MP must match canonical investigator current_mp",
    ):
        _execute(executor, campaign, character, [start], random.Random(1))


def test_rescue_updates_active_combat_and_investigator_mirror(tmp_path):
    executor = _executor("coc_subsystem_executor_rescue_mirror")
    campaign, character = _campaign_and_character(tmp_path)
    inv_path = campaign / "save" / "investigator-state" / "inv1.json"
    inv = json.loads(inv_path.read_text(encoding="utf-8"))
    inv.update({"current_hp": 0, "conditions": ["major_wound", "dying", "unconscious"]})
    inv_path.write_text(json.dumps(inv), encoding="utf-8")
    start = _combat_start_command()
    start["payload"]["participants"][0].update({
        "hp_current": 0,
        "conditions": ["major_wound", "dying", "unconscious"],
    })
    _execute(executor, campaign, character, [start], random.Random(1))
    result = _execute(executor, campaign, character, [_command(
        "aid-mirror", "stabilize", payload={
            "decision_id": "aid-mirror", "method": "first_aid",
            "skill_value": 99,
        },
    )], random.Random(1))[0]
    combat = json.loads((campaign / "save" / "combat.json").read_text())
    inv = json.loads(inv_path.read_text())
    participant = next(p for p in combat["participants"] if p["actor_id"] == "inv1")
    assert result["events"][0]["roll_evidence"]["roll_id"] == "aid-mirror:roll"
    assert participant["hp_current"] == inv["current_hp"] == 1
    assert participant["conditions"] == inv["conditions"]
    assert combat["revision"] == result["events"][0]["combat_revision"]


def test_healing_usage_survives_reload_and_distinct_commands(tmp_path):
    executor = _executor("coc_subsystem_executor_healing_usage")
    campaign, character = _campaign_and_character(tmp_path)
    inv_path = campaign / "save" / "investigator-state" / "inv1.json"
    inv = json.loads(inv_path.read_text())
    inv.update({"current_hp": 5, "max_hp": 11, "conditions": []})
    inv_path.write_text(json.dumps(inv))
    payload = {
        "decision_id": "aid-one", "method": "first_aid", "skill_value": 99,
    }
    first = _execute(executor, campaign, character, [_command("aid-one", "stabilize", payload=payload)], random.Random(2))[0]
    payload = {**payload, "decision_id": "aid-two"}
    assert first["events"][0]["already_used_today"] is False
    with pytest.raises(executor.SubsystemExecutorError, match="already used"):
        _execute(executor, campaign, character, [_command("aid-two", "stabilize", payload=payload)], random.Random(3))


def test_combat_end_does_not_restore_stale_participant_hp(tmp_path):
    executor = _executor("coc_subsystem_executor_end_keeps_healing")
    campaign, character = _campaign_and_character(tmp_path)
    inv_path = campaign / "save" / "investigator-state" / "inv1.json"
    inv = json.loads(inv_path.read_text())
    inv.update({"current_hp": 11, "conditions": []})
    inv_path.write_text(json.dumps(inv))
    _execute(executor, campaign, character, [_combat_start_command()], random.Random(1))
    inv = json.loads(inv_path.read_text())
    inv.update({"current_hp": 7, "conditions": ["major_wound", "prone"]})
    inv_path.write_text(json.dumps(inv))
    ended = _command("combat-end-safe", "combat_end", phase="end", payload={
        "decision_id": "combat-end-safe", "revision": 1, "outcome": "stalemate",
    })
    _execute(executor, campaign, character, [ended], random.Random(2))
    final = json.loads(inv_path.read_text())
    assert final["current_hp"] == 7
    assert final["conditions"] == ["major_wound"]


def test_combat_end_persists_trusted_turn_and_concluded_snapshot_reloads(tmp_path):
    executor = _executor("coc_subsystem_executor_end_turn")
    campaign, character = _campaign_and_character(tmp_path)
    inv_path = campaign / "save" / "investigator-state" / "inv1.json"
    inv = json.loads(inv_path.read_text())
    inv.update({"current_hp": 11, "conditions": []})
    inv_path.write_text(json.dumps(inv))
    (campaign / "save" / "pacing-state.json").write_text(
        json.dumps({"turn_number": 17}), encoding="utf-8"
    )
    _execute(executor, campaign, character, [_combat_start_command()], random.Random(1))
    ended = _command("combat-end-turn", "combat_end", phase="end", payload={
        "decision_id": "combat-end-turn", "revision": 1, "outcome": "stalemate",
    })
    result = _execute(executor, campaign, character, [ended], random.Random(2))[0]
    loaded = executor.coc_combat.CombatSession.load(campaign, rng=random.Random(3))
    assert loaded.status == "concluded"
    assert loaded.ended_at_turn == 17
    assert result["events"][0]["ended_at_turn"] == 17
    assert _execute(executor, campaign, character, [ended], random.Random(999))[0] == result


def test_mechanical_combat_conclusion_emits_ended_receipt_in_same_transaction(
    tmp_path,
):
    executor = _executor("coc_subsystem_executor_atomic_combat_end")
    campaign, character = _campaign_and_character(tmp_path)
    inv_path = campaign / "save" / "investigator-state" / "inv1.json"
    inv = json.loads(inv_path.read_text())
    inv.update({"current_hp": 11, "conditions": ["prone"]})
    inv_path.write_text(json.dumps(inv))
    start = _combat_start_command()
    start["payload"]["participants"][0]["conditions"] = ["prone"]
    start["payload"]["participants"][0]["dex"] = 80
    start["payload"]["participants"][0]["combat_skill"] = 100
    start["payload"]["participants"][1]["dodge_skill"] = 0
    _execute(executor, campaign, character, [start], random.Random(1))
    attack = _command("atomic-end-attack", "combat_attack", phase="declare", payload={
        "decision_id": "atomic-end-attack",
        "revision": 1,
        "actor_id": "inv1",
        "target_actor_id": "cultist",
        "declared_intent": "end the encounter",
        "resolution_hint": "opposed_melee",
        "weapon_id": "unarmed",
        "on_success": {
            "kind": "destroy_target",
            "outcome": "investigators_win",
            "rule_ref": "test.atomic_combat_end",
        },
    })
    _execute(executor, campaign, character, [attack], random.Random(1))
    defend = _command("atomic-end-defense", "combat_defend", payload={
        "decision_id": "atomic-end-defense",
        "revision": 2,
        "actor_id": "cultist",
        "attack_command_id": "atomic-end-attack",
        "defense_kind": "dodge",
    })
    result = _execute(
        executor, campaign, character, [defend], random.Random(1)
    )[0]
    assert any(event["event_type"] == "combat_ended" for event in result["events"])
    saved = json.loads((campaign / "save" / "combat.json").read_text())
    assert saved["status"] == "concluded"
    assert saved["outcome"] == "investigators_win"
    final_inv = json.loads(inv_path.read_text())
    assert final_inv["conditions"] == []


def test_combat_end_receipt_can_backfill_after_investigator_death(tmp_path):
    executor = _executor("coc_subsystem_executor_dead_combat_end")
    campaign, character = _campaign_and_character(tmp_path)
    inv_path = campaign / "save" / "investigator-state" / "inv1.json"
    inv = json.loads(inv_path.read_text())
    inv.update({"current_hp": 11, "conditions": []})
    inv_path.write_text(json.dumps(inv))
    _execute(executor, campaign, character, [_combat_start_command()], random.Random(1))
    inv.update({
        "current_hp": 0,
        "conditions": ["major_wound", "unconscious", "dying", "dead"],
    })
    inv_path.write_text(json.dumps(inv))
    ended = _command("combat-end-after-death", "combat_end", phase="end", payload={
        "decision_id": "combat-end-after-death",
        "revision": 1,
        "outcome": "monsters_win",
    })
    result = _execute(executor, campaign, character, [ended], random.Random(2))[0]
    assert result["events"][0]["event_type"] == "combat_ended"
    final = json.loads(inv_path.read_text())
    assert final["current_hp"] == 0
    assert "dead" in final["conditions"]


def test_initiative_cursor_advances_round_without_modulo(tmp_path):
    executor = _executor("coc_subsystem_executor_initiative_cursor")
    campaign, character = _campaign_and_character(tmp_path)
    inv_path = campaign / "save" / "investigator-state" / "inv1.json"
    inv = json.loads(inv_path.read_text())
    inv.update({"current_hp": 11, "conditions": []})
    inv_path.write_text(json.dumps(inv))
    _execute(executor, campaign, character, [_combat_start_command()], random.Random(1))
    attack = _command("attack-cultist", "combat_attack", phase="declare", payload={
        "decision_id": "attack-cultist", "revision": 1, "actor_id": "cultist",
        "target_actor_id": "inv1", "declared_intent": "attack",
        "resolution_hint": "opposed_melee", "weapon_id": "unarmed",
    })
    _execute(executor, campaign, character, [attack], random.Random(2))
    defend = _command("defend-inv", "combat_defend", payload={
        "decision_id": "defend-inv", "revision": 2, "actor_id": "inv1",
        "attack_command_id": "attack-cultist", "defense_kind": "dodge",
    })
    _execute(executor, campaign, character, [defend], random.Random(3))
    combat = json.loads((campaign / "save" / "combat.json").read_text())
    assert combat["current_round"] == 1
    assert combat["initiative_cursor"] == 1
    assert combat["current_initiative"][1]["actor_id"] == "inv1"


def test_initiative_progress_persists_skips_and_rejects_deleted_eligible_actor(tmp_path):
    executor = _executor("coc_subsystem_executor_initiative_progress")
    campaign, character = _campaign_and_character(tmp_path)
    inv_path = campaign / "save" / "investigator-state" / "inv1.json"
    inv = json.loads(inv_path.read_text())
    inv.update({"current_hp": 11, "conditions": []})
    inv_path.write_text(json.dumps(inv))
    start = _combat_start_command()
    start["payload"]["participants"].insert(1, {
        "actor_id": "fallen", "side": "npc", "dex": 65,
        "combat_skill": 40, "dodge_skill": 20, "build": 0,
        "hp_max": 8, "hp_current": 0, "con": 40,
        "weapons": [{"weapon_id": "unarmed"}], "conditions": ["unconscious"],
    })
    _execute(executor, campaign, character, [start], random.Random(1))
    combat_path = campaign / "save" / "combat.json"
    combat = json.loads(combat_path.read_text())
    progress = {row["actor_id"]: row for row in combat["initiative_progress"]}
    assert progress["fallen"]["status"] == "excluded_at_round_start"
    assert progress["cultist"]["status"] == "pending"
    forged = json.loads(combat_path.read_text())
    forged["current_initiative"] = [
        row for row in forged["current_initiative"] if row["actor_id"] != "cultist"
    ]
    forged["initiative_progress"] = [
        row for row in forged["initiative_progress"] if row["actor_id"] != "cultist"
    ]
    forged["rounds"][-1]["initiative_order"] = forged["current_initiative"]
    combat_path.write_text(json.dumps(forged))
    with pytest.raises(ValueError, match="initiative"):
        executor.coc_combat.CombatSession.load(campaign, rng=random.Random(2))


def test_stabilize_scope_is_authoritative_and_swapped_external_ids_fail(tmp_path):
    executor = _executor("coc_subsystem_executor_treatment_scope")
    campaign, character = _campaign_and_character(tmp_path)
    inv_path = campaign / "save" / "investigator-state" / "inv1.json"
    inv = json.loads(inv_path.read_text())
    inv.update({
        "current_hp": 5, "max_hp": 11, "conditions": [],
        "wound_ledger": [{
            "wound_id": "wound-canonical", "source_damage_roll_id": "cr7",
            "occurred_elapsed_minutes": 1500, "status": "active",
        }],
    })
    inv_path.write_text(json.dumps(inv))
    (campaign / "save" / "time-state.json").write_text(json.dumps({
        "schema_version": 1, "clock": {"elapsed_minutes": 1600},
    }))
    forged = _command("aid-forged-scope", "stabilize", payload={
        "decision_id": "aid-forged-scope", "method": "first_aid", "skill_value": 99,
        "wound_id": "wound-swapped", "day_id": "day-1",
    })
    with pytest.raises(executor.SubsystemExecutorError, match="authoritative treatment scope"):
        _execute(executor, campaign, character, [forged], random.Random(1))
    valid = _command("aid-canonical-scope", "stabilize", payload={
        "decision_id": "aid-canonical-scope", "method": "first_aid", "skill_value": 99,
        "wound_id": "wound-canonical", "day_id": "day-1",
    })
    result = _execute(executor, campaign, character, [valid], random.Random(1))[0]
    assert result["events"][0]["treatment_scope"] == {
        "wound_id": "wound-canonical", "day_id": "day-1",
    }


def test_used_treatment_rejects_before_ledger_and_future_command_remains_valid(tmp_path):
    executor = _executor("coc_subsystem_executor_treatment_used_preflight")
    campaign, character = _campaign_and_character(tmp_path)
    inv_path = campaign / "save" / "investigator-state" / "inv1.json"
    inv = json.loads(inv_path.read_text())
    inv.update({"current_hp": 5, "max_hp": 11, "conditions": []})
    inv_path.write_text(json.dumps(inv))
    first = _command("aid-first", "stabilize", payload={
        "decision_id": "aid-first", "method": "first_aid", "skill_value": 99,
    })
    _execute(executor, campaign, character, [first], random.Random(2))
    rolls_before = (campaign / "logs" / "rolls.jsonl").read_text()
    used = _command("aid-used", "stabilize", payload={
        "decision_id": "aid-used", "method": "first_aid", "skill_value": 99,
    })
    with pytest.raises(executor.SubsystemExecutorError, match="already used"):
        _execute(executor, campaign, character, [used], random.Random(3))
    assert (campaign / "logs" / "rolls.jsonl").read_text() == rolls_before
    state = json.loads((campaign / "save" / "subsystem-state.json").read_text())
    assert "aid-used" not in state["applied_command_ids"]
    medicine = _command("medicine-after-reject", "stabilize", payload={
        "decision_id": "medicine-after-reject", "method": "medicine", "skill_value": 99,
    })
    assert _execute(executor, campaign, character, [medicine], random.Random(4))[0]["status"] == "completed"


def test_medicine_healing_die_has_separate_canonical_evidence_and_replays(tmp_path):
    executor = _executor("coc_subsystem_executor_medicine_healing_die")
    campaign, character = _campaign_and_character(tmp_path)
    inv_path = campaign / "save" / "investigator-state" / "inv1.json"
    inv = json.loads(inv_path.read_text())
    inv.update({"current_hp": 5, "max_hp": 11, "conditions": []})
    inv_path.write_text(json.dumps(inv))
    command = _command("medicine-dice", "stabilize", payload={
        "decision_id": "medicine-dice", "method": "medicine", "skill_value": 99,
    })
    first = _execute(executor, campaign, character, [command], random.Random(8))[0]
    healing = next(event for event in first["events"] if event.get("skill") == "HP Healing")
    assert healing["roll_id"] == "medicine-dice:healing"
    assert healing["roll_role"] == "amount"
    assert healing["rolled_total"] == healing["dice"]["total"]
    assert not executor.AMOUNT_FORBIDDEN_FIELDS.intersection(healing)
    assert healing["dice"]["expression"] == "1D3"
    assert healing["dice"]["raw"]
    assert healing["dice"]["total"] == first["events"][0]["hp_gained"]
    rows = [json.loads(line) for line in (campaign / "logs" / "rolls.jsonl").read_text().splitlines()]
    assert [row["payload"]["roll_id"] for row in rows if row["command_id"] == "medicine-dice"] == [
        "medicine-dice:roll", "medicine-dice:healing",
    ]
    replay = _execute(executor, campaign, character, [command], random.Random(999))[0]
    assert replay == first
    assert len([json.loads(line) for line in (campaign / "logs" / "rolls.jsonl").read_text().splitlines()]) == len(rows)


def _pushable_roll_command(command_id: str = "original-failed-roll") -> dict:
    return _command(
        command_id,
        "skill_check",
        payload={
            "decision_id": "origin-decision",
            "roll_id": f"{command_id}-roll",
            "skill": "Spot Hidden",
            "difficulty": "regular",
            "bonus_penalty_dice": 0,
            "reason": "structured push origin",
            "roll_contract": {
                "schema_version": 1,
                "goal": "find the hidden ledger",
                "success_effect": "commit clue-ledger",
                "failure_effect": "the watcher notices the search",
                "failure_outcome_mode": "clue_with_cost",
                "push_policy": {
                    "eligible": True,
                    "requires_changed_method": True,
                    "keeper_must_foreshadow_failure": True,
                },
                "push_failure_consequence": {
                    "summary": "the watcher will identify the investigator if the push fails",
                    "effect": {
                        "kind": "fictional_position",
                        "severity": "serious",
                    },
                },
                "roll_density_group": "clue:clue-ledger",
                "must_not": ["do not reveal clue-ledger on failure"],
            },
            "resolution_context": {
                "scene_action": "REVEAL",
                "clue_policy": {
                    "clue_type": "obscured",
                    "reveal": ["clue-ledger"],
                    "fallback_routes": ["clue-watcher"],
                    "skill": "Spot Hidden",
                    "difficulty": "regular",
                },
            },
        },
    )


def _valid_push_offer(
    original_command_id: str = "original-failed-roll",
    *,
    command_id: str = "push-offer-1",
) -> dict:
    return _command(
        command_id,
        "push_offer",
        payload={
            "decision_id": "push-offer-decision",
            "original_command_id": original_command_id,
            "changed_method_evidence": {
                "changed": True,
                "source": "player_proposal",
                "summary": "inspect the binding and page impressions instead of the text",
            },
            "announced_consequence": {
                "summary": "the watcher will identify the investigator if the push fails",
                "effect": {
                    "kind": "fictional_position",
                    "severity": "serious",
                },
            },
        },
    )


def _persist_failed_pushable_roll(module, campaign: Path, character: Path) -> dict:
    result = _execute(
        module,
        campaign,
        character,
        [_pushable_roll_command()],
        random.Random(5),
    )[0]
    assert result["events"][0]["outcome"] == "failure"
    assert result["events"][0]["success"] is False
    return result


def _set_spot_hidden(character: Path, value: int) -> None:
    sheet = json.loads(character.read_text(encoding="utf-8"))
    sheet.setdefault("skills", {})["Spot Hidden"] = value
    character.write_text(json.dumps(sheet), encoding="utf-8")


@pytest.mark.parametrize(
    (
        "difficulty",
        "seed",
        "roll",
        "required_target",
        "achieved_level",
        "passed",
        "outcome",
    ),
    [
        ("hard", 1, 18, 30, "hard", True, "hard"),
        ("hard", 3, 31, 30, "regular", False, "failure"),
        ("extreme", 2, 8, 12, "extreme", True, "extreme"),
        ("extreme", 1, 18, 12, "hard", False, "failure"),
    ],
)
def test_contextual_percentile_contract_survives_persistence_and_replay(
    tmp_path,
    difficulty,
    seed,
    roll,
    required_target,
    achieved_level,
    passed,
    outcome,
):
    executor = _executor(
        f"coc_subsystem_executor_contextual_{difficulty}_{seed}"
    )
    campaign, character = _campaign_and_character(
        tmp_path / f"{difficulty}-{seed}"
    )
    _set_spot_hidden(character, 60)
    command = _command(
        f"contextual-{difficulty}-{seed}",
        "skill_check",
        payload={
            "decision_id": f"contextual-{difficulty}-{seed}",
            "roll_id": f"contextual-{difficulty}-{seed}:roll",
            "skill": "Spot Hidden",
            "difficulty": difficulty,
        },
    )

    result = _execute(
        executor, campaign, character, [command], random.Random(seed)
    )[0]
    event = result["events"][0]

    assert event["roll_role"] == "percentile_check"
    assert event["roll"] == roll
    assert event["base_target"] == event["target"] == 60
    assert event["required_level"] == event["difficulty"] == difficulty
    assert event["required_target"] == event["effective_target"] == required_target
    assert event["achieved_level"] == achieved_level
    assert event["passed"] is passed
    assert event["success"] is passed
    assert event["surplus_levels"] == 0
    assert event["outcome"] == outcome

    reloaded = _executor(
        f"coc_subsystem_executor_contextual_reload_{difficulty}_{seed}"
    )
    replay_rng = random.Random(99)
    replay_before = replay_rng.getstate()
    replay = _execute(
        reloaded, campaign, character, [command], replay_rng
    )[0]
    assert replay == result
    assert replay_rng.getstate() == replay_before


@pytest.mark.parametrize(
    (
        "difficulty",
        "seed",
        "roll",
        "required_target",
        "achieved_level",
        "passed",
        "outcome",
    ),
    [
        ("hard", 1, 18, 30, "hard", True, "hard"),
        ("hard", 3, 31, 30, "regular", False, "failure"),
        ("extreme", 2, 8, 12, "extreme", True, "extreme"),
        ("extreme", 1, 18, 12, "hard", False, "failure"),
    ],
)
def test_pushed_contextual_percentile_contract_survives_history_and_replay(
    tmp_path,
    difficulty,
    seed,
    roll,
    required_target,
    achieved_level,
    passed,
    outcome,
):
    executor = _executor(
        f"coc_subsystem_executor_push_contextual_{difficulty}_{seed}"
    )
    campaign, character = _campaign_and_character(
        tmp_path / f"push-{difficulty}-{seed}"
    )
    _set_spot_hidden(character, 60)
    origin_id = f"push-{difficulty}-{seed}-origin"
    origin = _pushable_roll_command(origin_id)
    origin["payload"]["difficulty"] = difficulty
    origin["payload"]["resolution_context"]["clue_policy"][
        "difficulty"
    ] = difficulty
    original = _execute(
        executor, campaign, character, [origin], random.Random(5)
    )[0]
    assert original["events"][0]["roll"] == 80
    assert original["events"][0]["passed"] is False
    assert original["events"][0]["outcome"] == "failure"

    offered = _execute(
        executor,
        campaign,
        character,
        [
            _valid_push_offer(
                origin_id,
                command_id=f"push-{difficulty}-{seed}-offer",
            )
        ],
        random.Random(211),
    )[0]
    response = _push_response(offered["pending_choice"], "confirm")
    commands = executor.commands_from_rules_requests(
        executor.plan_from_pending_choice_response(
            campaign, "inv1", response
        )
    )

    results = _execute(
        executor, campaign, character, commands, random.Random(seed)
    )
    pushed = results[1]["events"][0]

    assert pushed["roll_role"] == "percentile_check"
    assert pushed["roll"] == roll
    assert pushed["base_target"] == pushed["target"] == 60
    assert pushed["required_level"] == pushed["difficulty"] == difficulty
    assert pushed["required_target"] == pushed["effective_target"] == required_target
    assert pushed["achieved_level"] == achieved_level
    assert pushed["passed"] is passed
    assert pushed["success"] is passed
    assert pushed["surplus_levels"] == 0
    assert pushed["outcome"] == outcome

    reloaded = _executor(
        f"coc_subsystem_executor_push_contextual_reload_{difficulty}_{seed}"
    )
    replay_rng = random.Random(99)
    replay_before = replay_rng.getstate()
    replay = _execute(
        reloaded, campaign, character, commands, replay_rng
    )
    assert replay == results
    assert replay_rng.getstate() == replay_before


def _offer_push(module, campaign: Path, character: Path) -> dict:
    _persist_failed_pushable_roll(module, campaign, character)
    return _execute(
        module,
        campaign,
        character,
        [_valid_push_offer()],
        random.Random(211),
    )[0]


def _rewrite_result_receipt(
    executor,
    campaign: Path,
    command_id: str,
    mutate,
) -> None:
    path = campaign / "logs" / "subsystem-results.jsonl"
    rows = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
    row = next(item for item in rows if item["command_id"] == command_id)
    mutate(row["result"])
    material = {key: value for key, value in row.items() if key != "receipt_hash"}
    row["receipt_hash"] = executor._canonical_json_hash(material)
    path.write_text(
        "".join(json.dumps(item, sort_keys=True) + "\n" for item in rows),
        encoding="utf-8",
    )


def _rewrite_roll_copies(
    executor,
    campaign: Path,
    command_id: str,
    mutate,
    *,
    choice_id: str | None = None,
) -> None:
    state_path = campaign / "save" / "subsystem-state.json"
    state = json.loads(state_path.read_text())
    mutate(state["result_snapshots"][command_id])
    if choice_id is not None:
        mutate({"events": [state["choice_history"][choice_id]["original_roll"]]})
    state_path.write_text(json.dumps(state), encoding="utf-8")
    _rewrite_result_receipt(executor, campaign, command_id, mutate)


def _push_response(
    choice: dict,
    action: str,
    *,
    revision: int | None = None,
    responder: str = "player",
) -> dict:
    response = {
        "choice_id": choice["choice_id"],
        "responder": responder,
        "revision": choice["revision"] if revision is None else revision,
        "action": action,
    }
    return response


def test_public_typed_contracts_expose_exact_required_json_keys():
    executor = _executor()

    assert executor.SubsystemCommand.__required_keys__ == frozenset({
        "command_id", "kind", "phase", "payload",
    })
    assert executor.SubsystemResult.__required_keys__ == frozenset(RESULT_KEYS)


def test_schema_v2_state_migrates_explicitly_to_v3_private_lifecycle_indexes(tmp_path):
    executor = _executor("coc_subsystem_executor_schema_v2_to_v3")
    campaign, character = _campaign_and_character(tmp_path)
    state_path = campaign / "save" / "subsystem-state.json"
    state_path.write_text(
        json.dumps({
            "schema_version": 2,
            "applied_command_ids": [],
            "command_hashes": {},
            "command_provenance": {},
            "result_snapshots": {},
            "pending_choices": {},
            "inflight": None,
        }),
        encoding="utf-8",
    )

    assert _execute(executor, campaign, character, [], random.Random(201)) == []

    migrated = json.loads(state_path.read_text(encoding="utf-8"))
    assert migrated["schema_version"] == 3
    assert migrated["pending_contexts"] == {}
    assert migrated["choice_history"] == {}
    assert set(migrated) == {
        "schema_version",
        "applied_command_ids",
        "command_hashes",
        "command_provenance",
        "result_snapshots",
        "pending_choices",
        "pending_contexts",
        "choice_history",
        "inflight",
    }


def test_push_offer_validates_origin_and_keeps_private_context_out_of_public_choice(
    tmp_path,
):
    executor = _executor("coc_subsystem_executor_push_offer_gate")
    campaign, character = _campaign_and_character(tmp_path)
    original = _persist_failed_pushable_roll(executor, campaign, character)
    roll_log = campaign / "logs" / "rolls.jsonl"
    log_before = roll_log.read_bytes()
    rng = random.Random(202)
    rng_before = rng.getstate()

    offered = _execute(
        executor,
        campaign,
        character,
        [_valid_push_offer()],
        rng,
    )[0]

    assert offered["status"] == "pending_choice"
    assert offered["events"] == []
    assert offered["pending_choice"] == {
        "choice_id": "push-offer-1:confirm",
        "kind": "push_confirm",
        "command_id": "push-offer-1",
        "responder": "player",
        "revision": 0,
        "prompt": (
            "Push the failed Spot Hidden roll? Failure consequence: "
            "the watcher will identify the investigator if the push fails"
        ),
        "options": [
            {"action": "confirm", "label": "Push the roll"},
            {"action": "cancel", "label": "Keep the original failure"},
        ],
    }
    assert rng.getstate() == rng_before
    assert roll_log.read_bytes() == log_before

    state = json.loads((campaign / "save" / "subsystem-state.json").read_text())
    assert state["schema_version"] == 3
    private = state["pending_contexts"][offered["pending_choice"]["choice_id"]]
    assert private["origin_command_id"] == "original-failed-roll"
    assert private["original_roll"]["roll_id"] == original["events"][0]["roll_id"]
    assert private["original_roll"]["outcome"] == "failure"
    assert private["original_roll"]["roll_contract"] == original["events"][0]["roll_contract"]
    assert private["resolution_context"] == original["events"][0]["resolution_context"]
    assert private["changed_method_evidence"] == _valid_push_offer()["payload"]["changed_method_evidence"]
    assert private["announced_consequence"] == _valid_push_offer()["payload"]["announced_consequence"]
    assert private["offer_command"] == _valid_push_offer()
    assert executor.project_player_pending_choice(campaign) == offered["pending_choice"]
    assert "original_roll" not in json.dumps(offered["pending_choice"], ensure_ascii=False)
    assert "watcher" in json.dumps(offered["pending_choice"], ensure_ascii=False)
    assert "fictional_position" not in json.dumps(
        offered["pending_choice"], ensure_ascii=False
    )


def test_push_offer_and_confirmation_use_only_opaque_continuation_capability(
    tmp_path,
):
    executor = _executor("coc_subsystem_executor_push_capsule_only")
    campaign, character = _campaign_and_character(tmp_path)
    original = _persist_failed_pushable_roll(executor, campaign, character)
    capsule = original["events"][0]["push_continuation_capsule"]
    assert capsule["schema_version"] == 1
    assert capsule["kind"] == "push_continuation"
    assert capsule["idempotency"]["mode"] == "exact_once"
    assert "audit_compatibility" not in capsule
    malformed_time = json.loads(json.dumps(capsule))
    malformed_time["settlement"]["source_time_profile"] = {
        "mode": "instant", "category": None, "delta_minutes": 1,
    }
    with pytest.raises(executor.SubsystemExecutorError) as malformed_error:
        executor._validate_push_capsule(
            malformed_time,
            campaign_dir=campaign,
            investigator_id="inv1",
            character_id="inv1",
        )
    assert malformed_error.value.code == "push_continuation_unbound"
    assert malformed_error.value.path == (
        "continuation_capsule.settlement.source_time_profile"
    )
    audited = json.loads(json.dumps(capsule))
    audited["audit_compatibility"] = {
        "original_request_id": "legacy-request",
        "route_id": "legacy-route",
        "clue_ids": ["legacy-clue"],
    }
    validated_audited = executor._validate_push_capsule(
        audited,
        campaign_dir=campaign,
        investigator_id="inv1",
        character_id="inv1",
    )
    assert validated_audited["continuation_id"] == capsule["continuation_id"]
    assert validated_audited["settlement"] == capsule["settlement"]

    offer = _valid_push_offer()
    offer["payload"].pop("original_command_id")
    offer["payload"]["continuation_id"] = capsule["continuation_id"]
    offered = _execute(
        executor, campaign, character, [offer], random.Random(211)
    )[0]
    public_json = json.dumps(offered["pending_choice"], ensure_ascii=False)
    assert "push-cont:" not in public_json
    assert "continuation_capsule" not in public_json

    response = _push_response(offered["pending_choice"], "confirm")
    plan = executor.plan_from_pending_choice_response(campaign, "inv1", response)
    resolve = plan["rules_requests"][-1]
    assert resolve["continuation_id"] == capsule["continuation_id"]
    assert resolve["request_id"] == capsule["settlement"]["request_id"]
    assert "original_command_id" not in resolve
    assert "route_id" not in resolve
    assert "clue_id" not in resolve


def test_forged_continuation_capability_fails_before_rng_or_state_mutation(tmp_path):
    executor = _executor("coc_subsystem_executor_push_capsule_forged")
    campaign, character = _campaign_and_character(tmp_path)
    _persist_failed_pushable_roll(executor, campaign, character)
    offer = _valid_push_offer()
    offer["payload"].pop("original_command_id")
    offer["payload"]["continuation_id"] = "push-cont:" + ("0" * 64)
    rng = random.Random(211)
    rng_before = rng.getstate()
    state_path = campaign / "save" / "subsystem-state.json"
    state_before = state_path.read_bytes()

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        _execute(executor, campaign, character, [offer], rng)

    assert exc_info.value.code == "push_origin_not_found"
    assert rng.getstate() == rng_before
    assert state_path.read_bytes() == state_before


def test_continuation_capsule_rejects_wrong_campaign_and_actor_bindings(tmp_path):
    executor = _executor("coc_subsystem_executor_push_capsule_scope")
    campaign, character = _campaign_and_character(tmp_path / "one")
    original = _persist_failed_pushable_roll(executor, campaign, character)
    capsule = original["events"][0]["push_continuation_capsule"]
    other_campaign, _other_character = _campaign_and_character(tmp_path / "two")

    with pytest.raises(executor.SubsystemExecutorError) as campaign_error:
        executor._validate_push_capsule(
            capsule,
            campaign_dir=other_campaign,
            investigator_id="inv1",
            character_id="inv1",
        )
    assert campaign_error.value.code == "push_continuation_campaign_mismatch"

    with pytest.raises(executor.SubsystemExecutorError) as actor_error:
        executor._validate_push_capsule(
            capsule,
            campaign_dir=campaign,
            investigator_id="inv2",
            character_id="inv2",
        )
    assert actor_error.value.code == "push_origin_actor_mismatch"


def test_push_offer_localizes_prompt_and_options_from_structured_campaign_locale(
    tmp_path,
):
    executor = _executor("coc_subsystem_executor_push_offer_zh")
    campaign, character = _campaign_and_character(tmp_path)
    (campaign / "campaign.json").write_text(
        json.dumps({"play_language": "zh-Hans"}), encoding="utf-8"
    )
    origin = _pushable_roll_command()
    origin["payload"]["roll_contract"]["push_failure_consequence"][
        "localized_summaries"
    ] = {"zh-Hans": "若再次失败，监视者会认出调查员。"}
    _execute(executor, campaign, character, [origin], random.Random(5))
    command = _valid_push_offer()
    command["payload"]["announced_consequence"]["localized_summaries"] = {
        "zh-Hans": "若再次失败，监视者会认出调查员。"
    }

    offered = _execute(
        executor, campaign, character, [command], random.Random(202)
    )[0]

    choice = offered["pending_choice"]
    assert choice["prompt"] == (
        "是否要孤注一掷这次失败的Spot Hidden检定？"
        "若再次失败：若再次失败，监视者会认出调查员。"
    )
    assert "the watcher" not in choice["prompt"]
    assert choice["options"] == [
        {"action": "confirm", "label": "确认孤注一掷"},
        {"action": "cancel", "label": "保留原失败"},
    ]
    assert command["payload"]["announced_consequence"]["effect"] == {
        "kind": "fictional_position",
        "severity": "serious",
    }


def test_push_offer_final_state_failure_rolls_back_independent_evidence(
    tmp_path, monkeypatch,
):
    executor = _executor("coc_subsystem_executor_push_offer_evidence_rollback")
    campaign, character = _campaign_and_character(tmp_path)
    _persist_failed_pushable_roll(executor, campaign, character)
    state_path = campaign / "save" / "subsystem-state.json"
    state_before = state_path.read_bytes()
    result_log = campaign / "logs" / "subsystem-results.jsonl"
    result_before = result_log.read_bytes()
    evidence_log = campaign / "logs" / "push-offers.jsonl"
    real_write = executor._write_executor_state

    def fail_final_state(campaign_dir, state):
        if (
            state.get("inflight") is None
            and "push-offer-1" in state.get("applied_command_ids", [])
        ):
            raise OSError("injected push-offer final state failure")
        return real_write(campaign_dir, state)

    monkeypatch.setattr(executor, "_write_executor_state", fail_final_state)
    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        _execute(
            executor, campaign, character, [_valid_push_offer()], random.Random(211)
        )

    assert exc_info.value.code == "subsystem_transaction_failed"
    assert state_path.read_bytes() == state_before
    assert result_log.read_bytes() == result_before
    assert not evidence_log.exists()


def test_schema_v2_pending_choice_without_private_context_fails_closed(tmp_path):
    executor = _executor("coc_subsystem_executor_schema_v2_pending_reject")
    campaign, character = _campaign_and_character(tmp_path)
    state_path = campaign / "save" / "subsystem-state.json"
    legacy_choice = {
        "choice_id": "legacy-offer:confirm",
        "kind": "push_confirm",
        "command_id": "legacy-offer",
    }
    legacy_result = {
        "command_id": "legacy-offer",
        "kind": "push_offer",
        "status": "pending_choice",
        "events": [],
        "pending_choice": legacy_choice,
        "state_refs": ["save/subsystem-state.json#pending_choices/legacy-offer:confirm"],
    }
    legacy_command = _command(
        "legacy-offer",
        "push_offer",
        payload={"original_roll_id": "unrecoverable-roll"},
    )
    state_path.write_text(
        json.dumps({
            "schema_version": 2,
            "applied_command_ids": ["legacy-offer"],
            "command_hashes": {
                "legacy-offer": executor._canonical_command_hash(legacy_command),
            },
            "command_provenance": {
                "legacy-offer": {
                    "investigator_id": "inv1",
                    "character_id": None,
                    "decision_id": None,
                },
            },
            "result_snapshots": {"legacy-offer": legacy_result},
            "pending_choices": {legacy_choice["choice_id"]: legacy_choice},
            "inflight": None,
        }),
        encoding="utf-8",
    )
    before = state_path.read_bytes()

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        _execute(executor, campaign, character, [], random.Random(205))

    assert exc_info.value.code == "malformed_subsystem_state"
    assert "private context" in exc_info.value.message
    assert state_path.read_bytes() == before


@pytest.mark.parametrize(
    ("payload_patch", "error_path"),
    [
        ({"changed_method_evidence": {"changed": False, "source": "player_proposal", "summary": "same method"}}, "changed_method_evidence.changed"),
        ({"announced_consequence": {"summary": ""}}, "announced_consequence.summary"),
        ({"original_command_id": "missing-origin"}, "original_command_id"),
    ],
)
def test_push_offer_rejects_incomplete_gate_before_rng_or_state_mutation(
    tmp_path,
    payload_patch,
    error_path,
):
    executor = _executor(f"coc_subsystem_executor_push_incomplete_{error_path.replace('.', '_')}")
    campaign, character = _campaign_and_character(tmp_path)
    _persist_failed_pushable_roll(executor, campaign, character)
    offer = _valid_push_offer()
    offer["payload"].update(payload_patch)
    rng = random.Random(203)
    rng_before = rng.getstate()
    state_path = campaign / "save" / "subsystem-state.json"
    state_before = state_path.read_bytes()
    log_before = (campaign / "logs" / "rolls.jsonl").read_bytes()

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        _execute(executor, campaign, character, [offer], rng)

    assert exc_info.value.code in {"invalid_command_payload", "push_origin_not_found"}
    assert error_path in exc_info.value.path
    assert rng.getstate() == rng_before
    assert state_path.read_bytes() == state_before
    assert (campaign / "logs" / "rolls.jsonl").read_bytes() == log_before


@pytest.mark.parametrize(
    ("seed", "expected_outcome", "expected_code"),
    [
        (1, "hard", "push_origin_not_found"),
        (23, "fumble", "push_origin_not_found"),
    ],
)
def test_push_offer_rejects_success_and_fumble_origins_without_side_effects(
    tmp_path,
    seed,
    expected_outcome,
    expected_code,
):
    executor = _executor(f"coc_subsystem_executor_push_origin_{expected_outcome}")
    campaign, character = _campaign_and_character(tmp_path)
    original = _execute(
        executor,
        campaign,
        character,
        [_pushable_roll_command()],
        random.Random(seed),
    )[0]
    assert original["events"][0]["outcome"] == expected_outcome
    if expected_outcome == "fumble":
        assert original["events"][0]["roll_contract"]["push_policy"] == {
            "eligible": False,
            "requires_changed_method": False,
            "keeper_must_foreshadow_failure": False,
        }
        assert executor.project_latest_eligible_push_candidate(
            campaign, "inv1", "inv1",
        ) is None
    rng = random.Random(204)
    rng_before = rng.getstate()
    state_path = campaign / "save" / "subsystem-state.json"
    state_before = state_path.read_bytes()

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        _execute(executor, campaign, character, [_valid_push_offer()], rng)

    assert exc_info.value.code == expected_code
    assert rng.getstate() == rng_before
    assert state_path.read_bytes() == state_before


@pytest.mark.parametrize(
    "push_policy",
    [
        {},
        {
            "eligible": False,
            "requires_changed_method": False,
            "keeper_must_foreshadow_failure": False,
        },
    ],
)
def test_push_offer_rejects_missing_or_false_persisted_push_eligibility(
    tmp_path,
    push_policy,
):
    executor = _executor("coc_subsystem_executor_push_ineligible")
    campaign, character = _campaign_and_character(tmp_path)
    origin = _pushable_roll_command()
    origin["payload"]["roll_contract"]["push_policy"] = push_policy
    result = _execute(executor, campaign, character, [origin], random.Random(5))[0]
    assert result["events"][0]["outcome"] == "failure"
    state_path = campaign / "save" / "subsystem-state.json"
    before = state_path.read_bytes()

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        _execute(
            executor,
            campaign,
            character,
            [_valid_push_offer()],
            random.Random(206),
        )

    assert exc_info.value.code == "push_origin_not_found"
    assert state_path.read_bytes() == before


def test_push_offer_cannot_override_persisted_origin_resolution_context(tmp_path):
    executor = _executor("coc_subsystem_executor_push_context_override")
    campaign, character = _campaign_and_character(tmp_path)
    _persist_failed_pushable_roll(executor, campaign, character)
    offer = _valid_push_offer()
    offer["payload"]["resolution_context"] = {
        "scene_action": "REVEAL",
        "clue_policy": {"reveal": ["keeper-secret-clue"]},
    }
    state_path = campaign / "save" / "subsystem-state.json"
    before = state_path.read_bytes()

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        _execute(executor, campaign, character, [offer], random.Random(207))

    assert exc_info.value.code == "push_origin_context_mismatch"
    assert state_path.read_bytes() == before


def test_push_offer_is_bound_to_original_investigator_and_character(tmp_path):
    executor = _executor("coc_subsystem_executor_push_actor_binding")
    campaign, character = _campaign_and_character(tmp_path)
    _persist_failed_pushable_roll(executor, campaign, character)
    inv2_character = tmp_path / "investigators" / "inv2" / "character.json"
    inv2_character.parent.mkdir(parents=True, exist_ok=True)
    inv2_sheet = json.loads(character.read_text(encoding="utf-8"))
    inv2_sheet["id"] = "inv2"
    inv2_character.write_text(json.dumps(inv2_sheet), encoding="utf-8")
    state_path = campaign / "save" / "subsystem-state.json"
    before = state_path.read_bytes()

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        executor.execute_commands(
            campaign,
            inv2_character,
            "inv2",
            [_valid_push_offer()],
            rng=random.Random(208),
        )

    assert exc_info.value.code == "push_origin_actor_mismatch"
    assert state_path.read_bytes() == before


def test_push_origin_cannot_be_offered_twice(tmp_path):
    executor = _executor("coc_subsystem_executor_push_already_offered")
    campaign, character = _campaign_and_character(tmp_path)
    _persist_failed_pushable_roll(executor, campaign, character)
    _execute(
        executor,
        campaign,
        character,
        [_valid_push_offer()],
        random.Random(209),
    )
    state_path = campaign / "save" / "subsystem-state.json"
    before = state_path.read_bytes()

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        _execute(
            executor,
            campaign,
            character,
            [_valid_push_offer(command_id="push-offer-2")],
            random.Random(210),
        )

    assert exc_info.value.code == "push_origin_already_used"
    assert state_path.read_bytes() == before


def test_push_cancel_is_canonical_consumes_choice_and_has_zero_rng_or_log_effect(
    tmp_path,
):
    executor = _executor("coc_subsystem_executor_push_cancel")
    campaign, character = _campaign_and_character(tmp_path)
    offered = _offer_push(executor, campaign, character)
    response = _push_response(offered["pending_choice"], "cancel")
    plan = executor.plan_from_pending_choice_response(campaign, "inv1", response)
    commands = executor.commands_from_rules_requests(plan)
    assert [command["kind"] for command in commands] == ["push_confirm"]
    assert commands[0]["phase"] == "confirm"
    assert commands[0]["payload"]["action"] == "cancel"
    assert len(commands[0]["command_id"]) <= 128
    assert commands == executor.commands_from_rules_requests(
        executor.plan_from_pending_choice_response(campaign, "inv1", response)
    )
    state_path = campaign / "save" / "subsystem-state.json"
    state_before = json.loads(state_path.read_text(encoding="utf-8"))
    origin_before = state_before["result_snapshots"]["original-failed-roll"]
    roll_log = campaign / "logs" / "rolls.jsonl"
    log_before = roll_log.read_bytes()
    rng = random.Random(212)
    rng_before = rng.getstate()

    cancelled = _execute(executor, campaign, character, commands, rng)

    assert [result["status"] for result in cancelled] == ["cancelled"]
    assert cancelled[0]["events"] == []
    assert cancelled[0]["pending_choice"] is None
    assert rng.getstate() == rng_before
    assert roll_log.read_bytes() == log_before
    state = json.loads(state_path.read_text(encoding="utf-8"))
    assert state["pending_choices"] == {}
    assert state["pending_contexts"] == {}
    assert state["result_snapshots"]["original-failed-roll"] == origin_before
    history = state["choice_history"][response["choice_id"]]
    assert history["terminal_action"] == "cancel"
    assert history["terminal_revision"] == 0


def test_push_confirm_resolve_rerolls_once_from_private_origin_and_replays_exactly(
    tmp_path,
):
    executor = _executor("coc_subsystem_executor_push_confirm_success")
    campaign, character = _campaign_and_character(tmp_path)
    offered = _offer_push(executor, campaign, character)
    response = _push_response(offered["pending_choice"], "confirm")
    plan = executor.plan_from_pending_choice_response(campaign, "inv1", response)
    binding = plan["push_continuation"]["binding"]
    assert binding["schema_version"] == 2
    assert binding["mode"] == "continuation_capsule"
    assert binding["continuation_id"].startswith("push-cont:")
    assert binding["request_id"].startswith("push-settle:")
    assert binding["route_id"] is None
    assert binding["route_transaction_sha256"] is None
    commands = executor.commands_from_rules_requests(plan)
    assert [command["kind"] for command in commands] == ["push_confirm", "push_resolve"]
    assert [command["phase"] for command in commands] == ["confirm", "resolve"]
    assert len({command["command_id"] for command in commands}) == 2
    assert all(len(command["command_id"]) <= 128 for command in commands)
    rng = random.Random(1)
    one_draw = random.Random(1)
    one_draw.randint(1, 100)
    log_path = campaign / "logs" / "rolls.jsonl"
    rows_before = log_path.read_text(encoding="utf-8").splitlines()

    results = _execute(executor, campaign, character, commands, rng)

    assert [result["status"] for result in results] == ["completed", "completed"]
    assert results[0]["events"][0]["event_type"] == "push_confirmed"
    pushed = results[1]["events"][0]
    assert pushed["pushed"] is True
    assert pushed["success"] is True
    assert pushed["original_command_id"] == "original-failed-roll"
    assert pushed["original_roll_id"] == "original-failed-roll-roll"
    assert pushed["source_command_id"] == commands[1]["command_id"]
    assert pushed["push_gate"] == {
        "method_changed": True,
        "consequence_announced": True,
        "player_confirmed": True,
    }
    assert pushed["changed_method_evidence"] == _valid_push_offer()["payload"][
        "changed_method_evidence"
    ]
    assert pushed["resolution_context"] == _pushable_roll_command()["payload"]["resolution_context"]
    assert rng.getstate() == one_draw.getstate()
    rows_after = log_path.read_text(encoding="utf-8").splitlines()
    assert len(rows_after) == len(rows_before) + 1
    assert json.loads(rows_after[-1])["command_id"] == commands[1]["command_id"]
    assert executor.get_current_pending_choice(campaign) is None

    reloaded = _executor("coc_subsystem_executor_push_confirm_success_reload")
    replay_rng = random.Random(213)
    replay_before = replay_rng.getstate()
    replay_log = log_path.read_bytes()
    replay = _execute(reloaded, campaign, character, commands, replay_rng)
    assert replay == results
    assert replay_rng.getstate() == replay_before
    assert log_path.read_bytes() == replay_log
    assert reloaded.plan_from_pending_choice_response(campaign, "inv1", response) == plan


def test_route_bearing_push_with_malformed_source_binding_fails_before_roll(tmp_path):
    executor = _executor("coc_subsystem_executor_push_unbound_route")
    campaign, character = _campaign_and_character(tmp_path)
    origin = _pushable_roll_command()
    origin["payload"]["request_id"] = "route-request-1"
    origin["payload"]["resolution_context"].update({
        "turn_input": {
            "active_scene_id": "archive",
            "player_intent_rich": {
                "action_resolution": {
                    "matched_affordance_ids": ["route-ledger"],
                    "no_match": False,
                },
            },
        },
        "clue_policy": {
            "matched_route_ids": ["route-ledger"],
            "reveal": [],
        },
        # Deliberately no route_resolution receipt: route-bearing continuations
        # must not guess the source route from adjacent structured fields.
    })
    failed = _execute(
        executor, campaign, character, [origin], random.Random(5)
    )[0]
    assert failed["events"][0]["success"] is False
    rng = random.Random(1)
    rng_before = rng.getstate()
    roll_log = campaign / "logs" / "rolls.jsonl"
    log_before = roll_log.read_bytes()

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        _execute(executor, campaign, character, [_valid_push_offer()], rng)

    assert exc_info.value.code == "push_origin_not_found"
    assert rng.getstate() == rng_before
    assert roll_log.read_bytes() == log_before


def test_sealed_route_time_profile_is_exact_authored_authority_or_null(tmp_path):
    executor = _executor("coc_subsystem_executor_push_route_time")
    campaign, _character = _campaign_and_character(tmp_path)
    story_path = campaign / "scenario" / "story-graph.json"
    story_path.parent.mkdir(parents=True, exist_ok=True)
    route = {
        "id": "persuade-arty",
        "cue": "Persuade Arty to grant access.",
        "player_visible_outcome": "Arty grants supervised access.",
        "status": "open",
    }
    story = {
        "schema_version": 1,
        "scenes": [{
            "scene_id": "newspaper-morgue",
            "affordances": [route],
        }],
    }
    story_path.write_text(json.dumps(story), encoding="utf-8")

    missing = executor._seal_authored_route_transaction(
        campaign,
        scene_id="newspaper-morgue",
        route_id="persuade-arty",
    )
    assert missing["source_time_profile"] is None

    exact = {
        "mode": "elapsed",
        "category": "library_research",
        "delta_minutes": 240,
    }
    route["time_profile"] = exact
    story_path.write_text(json.dumps(story), encoding="utf-8")
    sealed = executor._seal_authored_route_transaction(
        campaign,
        scene_id="newspaper-morgue",
        route_id="persuade-arty",
    )
    assert sealed["source_time_profile"] == exact

    route["time_profile"] = {
        "mode": "instant", "category": None, "delta_minutes": 1,
    }
    story_path.write_text(json.dumps(story), encoding="utf-8")
    assert executor._seal_authored_route_transaction(
        campaign,
        scene_id="newspaper-morgue",
        route_id="persuade-arty",
    ) is None


def test_non_route_push_preserves_exact_structured_time_and_rejects_malformed(
    tmp_path,
):
    executor = _executor("coc_subsystem_executor_push_non_route_time")
    exact = {
        "mode": "elapsed",
        "category": "library_research",
        "delta_minutes": 240,
    }
    valid_campaign, valid_character = _campaign_and_character(tmp_path / "valid")
    valid_origin = _pushable_roll_command()
    valid_origin["payload"]["resolution_context"]["source_time_profile"] = exact
    valid_result = _execute(
        executor,
        valid_campaign,
        valid_character,
        [valid_origin],
        random.Random(5),
    )[0]
    valid_capsule = valid_result["events"][0]["push_continuation_capsule"]
    assert valid_capsule["settlement"]["route_transaction"] is None
    assert valid_capsule["settlement"]["source_time_profile"] == exact

    valid_offer = _valid_push_offer()
    valid_offer["payload"]["source_time_profile"] = exact
    offered = _execute(
        executor,
        valid_campaign,
        valid_character,
        [valid_offer],
        random.Random(211),
    )[0]
    assert offered["status"] == "pending_choice"

    invalid_campaign, invalid_character = _campaign_and_character(
        tmp_path / "invalid"
    )
    invalid_origin = _pushable_roll_command()
    invalid_origin["payload"]["resolution_context"]["source_time_profile"] = {
        "mode": "instant", "category": None, "delta_minutes": 1,
    }
    invalid_result = _execute(
        executor,
        invalid_campaign,
        invalid_character,
        [invalid_origin],
        random.Random(5),
    )[0]
    assert "push_continuation_capsule" not in invalid_result["events"][0]
    assert executor.project_latest_eligible_push_candidate(
        invalid_campaign, "inv1", "inv1"
    ) is None


def test_generated_clue_push_missing_exact_clue_binding_fails_before_roll(tmp_path):
    executor = _executor("coc_subsystem_executor_push_unbound_generated_clue")
    campaign, character = _campaign_and_character(tmp_path)
    origin = _pushable_roll_command()
    origin["payload"]["request_id"] = "generated-clue:source-request"
    origin["payload"]["roll_contract"]["generated_clue_gate"] = True
    origin["payload"]["roll_contract"]["fumble_consequence"] = {
        "summary": "The route closes before the clue is secured.",
        "effect": {"kind": "route_closed", "route_id": "route-ledger"},
        "source_binding": {
            "schema_version": 1,
            "kind": "generated_obscured_clue_gate",
            "clue_id": "clue-ledger",
            "route_ids": ["route-ledger"],
        },
    }
    origin["payload"]["resolution_context"].update({
        "turn_input": {
            "active_scene_id": "archive",
            "player_intent_rich": {
                "action_resolution": {
                    "matched_affordance_ids": ["route-ledger"],
                    "no_match": False,
                },
            },
        },
        "clue_policy": {
            "matched_route_ids": ["route-ledger"],
            "reveal": ["clue-ledger"],
        },
        "route_resolution": {
            "schema_version": 1,
            "matched_route_ids": ["route-ledger"],
            "request_id": "generated-clue:source-request",
            # Deliberately missing clue_ids.  Confirmation must not infer the
            # clue from the adjacent clue_policy after the original roll.
        },
    })
    failed = _execute(
        executor, campaign, character, [origin], random.Random(5)
    )[0]
    assert failed["events"][0]["success"] is False
    rng = random.Random(1)
    rng_before = rng.getstate()
    roll_log = campaign / "logs" / "rolls.jsonl"
    log_before = roll_log.read_bytes()

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        _execute(executor, campaign, character, [_valid_push_offer()], rng)

    assert exc_info.value.code == "push_origin_not_found"
    assert rng.getstate() == rng_before
    assert roll_log.read_bytes() == log_before


def test_pushed_failure_preserves_exact_announced_consequence_and_stable_identity(
    tmp_path,
):
    executor = _executor("coc_subsystem_executor_push_confirm_failure")
    campaign, character = _campaign_and_character(tmp_path)
    offered = _offer_push(executor, campaign, character)
    response = _push_response(offered["pending_choice"], "confirm")
    plan = executor.plan_from_pending_choice_response(campaign, "inv1", response)
    commands = executor.commands_from_rules_requests(plan)

    results = _execute(executor, campaign, character, commands, random.Random(5))

    pushed = results[-1]["events"][0]
    assert pushed["outcome"] == "failure"
    assert pushed["success"] is False
    assert pushed["announced_consequence"] == _valid_push_offer()["payload"]["announced_consequence"]
    assert pushed["source_command_id"] == commands[-1]["command_id"]
    assert pushed["original_roll_id"] == "original-failed-roll-roll"


def test_pushed_fumble_contract_is_non_pushable_and_has_structured_consequence(
    tmp_path,
):
    executor = _executor("coc_subsystem_executor_push_confirm_fumble")
    campaign, character = _campaign_and_character(tmp_path)
    offered = _offer_push(executor, campaign, character)
    response = _push_response(offered["pending_choice"], "confirm")
    plan = executor.plan_from_pending_choice_response(campaign, "inv1", response)
    commands = executor.commands_from_rules_requests(plan)

    results = _execute(executor, campaign, character, commands, random.Random(23))

    pushed = results[-1]["events"][0]
    assert pushed["roll"] == 100 and pushed["outcome"] == "fumble"
    assert pushed["roll_contract"]["push_policy"] == {
        "eligible": False,
        "requires_changed_method": False,
        "keeper_must_foreshadow_failure": False,
    }
    assert pushed["fumble_consequence"] == pushed["announced_consequence"]


@pytest.mark.parametrize(
    ("response_patch", "code"),
    [
        ({"revision": 1}, "stale_pending_choice_response"),
        ({"responder": "keeper"}, "wrong_pending_choice_responder"),
        ({"action": "unknown"}, "invalid_pending_choice_action"),
        ({"choice_id": "another-choice"}, "pending_choice_not_found"),
    ],
)
def test_push_response_wrong_stale_or_unknown_fails_before_mutation(
    tmp_path,
    response_patch,
    code,
):
    executor = _executor(f"coc_subsystem_executor_push_response_{code}")
    campaign, character = _campaign_and_character(tmp_path)
    offered = _offer_push(executor, campaign, character)
    response = _push_response(offered["pending_choice"], "cancel")
    response.update(response_patch)
    state_path = campaign / "save" / "subsystem-state.json"
    state_before = state_path.read_bytes()
    log_before = (campaign / "logs" / "rolls.jsonl").read_bytes()

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        executor.plan_from_pending_choice_response(campaign, "inv1", response)

    assert exc_info.value.code == code
    assert state_path.read_bytes() == state_before
    assert (campaign / "logs" / "rolls.jsonl").read_bytes() == log_before


def test_push_confirm_cannot_replace_offer_changed_method_evidence(tmp_path):
    executor = _executor("coc_subsystem_executor_push_response_override")
    campaign, character = _campaign_and_character(tmp_path)
    offered = _offer_push(executor, campaign, character)
    response = _push_response(offered["pending_choice"], "confirm")
    response["changed_method_evidence"] = {
        "changed": True,
        "source": "keeper_prompt",
        "summary": "replace the already agreed method after confirmation",
    }
    state_path = campaign / "save" / "subsystem-state.json"
    before = state_path.read_bytes()

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        executor.plan_from_pending_choice_response(campaign, "inv1", response)

    assert exc_info.value.code == "invalid_pending_choice_response"
    assert state_path.read_bytes() == before


@pytest.mark.parametrize(
    ("field", "replacement"),
    [
        ("announced_consequence", {"summary": "forged"}),
        ("changed_method_evidence", {
            "changed": True,
            "source": "keeper_prompt",
            "summary": "forged method",
        }),
        ("origin_command_id", "forged-origin"),
    ],
)
def test_active_push_private_context_is_anchored_to_creator_command(
    tmp_path, field, replacement,
):
    executor = _executor(f"coc_subsystem_executor_push_anchor_{field}")
    campaign, character = _campaign_and_character(tmp_path)
    offered = _offer_push(executor, campaign, character)
    state_path = campaign / "save" / "subsystem-state.json"
    state = json.loads(state_path.read_text())
    choice_id = offered["pending_choice"]["choice_id"]
    state["pending_contexts"][choice_id][field] = replacement
    state_path.write_text(json.dumps(state))
    before = state_path.read_bytes()

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        executor.get_current_pending_choice(campaign)

    assert exc_info.value.code == "malformed_subsystem_state"
    assert state_path.read_bytes() == before


def test_public_choice_projector_rejects_nested_option_leak(tmp_path):
    executor = _executor("coc_subsystem_executor_public_nested_leak")
    campaign, character = _campaign_and_character(tmp_path)
    offered = _offer_push(executor, campaign, character)
    state_path = campaign / "save" / "subsystem-state.json"
    state = json.loads(state_path.read_text())
    choice_id = offered["pending_choice"]["choice_id"]
    command_id = offered["command_id"]
    for choice in (
        state["pending_choices"][choice_id],
        state["result_snapshots"][command_id]["pending_choice"],
    ):
        choice["options"][0]["keeper_secret"] = "must not cross"
    state_path.write_text(json.dumps(state))

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        executor.project_player_pending_choice(campaign)

    assert exc_info.value.code == "malformed_subsystem_state"


def test_historical_push_private_context_is_anchored_to_creator_command(tmp_path):
    executor = _executor("coc_subsystem_executor_push_history_anchor")
    campaign, character = _campaign_and_character(tmp_path)
    offered = _offer_push(executor, campaign, character)
    response = _push_response(offered["pending_choice"], "cancel")
    plan = executor.plan_from_pending_choice_response(campaign, "inv1", response)
    _execute(
        executor,
        campaign,
        character,
        executor.commands_from_rules_requests(plan),
        random.Random(212),
    )
    state_path = campaign / "save" / "subsystem-state.json"
    state = json.loads(state_path.read_text())
    state["choice_history"][response["choice_id"]]["offer_command"]["payload"][
        "announced_consequence"
    ]["summary"] = "forged creator receipt"
    state_path.write_text(json.dumps(state))
    before = state_path.read_bytes()

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        executor.plan_from_pending_choice_response(campaign, "inv1", response)

    assert exc_info.value.code == "malformed_subsystem_state"
    assert state_path.read_bytes() == before


@pytest.mark.parametrize("action", ["cancel", "confirm"])
def test_push_history_origin_is_bound_to_immutable_roll_log(tmp_path, action):
    executor = _executor(f"coc_subsystem_executor_push_origin_roll_log_{action}")
    campaign, character = _campaign_and_character(tmp_path)
    offered = _offer_push(executor, campaign, character)
    response = _push_response(offered["pending_choice"], action)
    commands = executor.commands_from_rules_requests(
        executor.plan_from_pending_choice_response(campaign, "inv1", response)
    )
    _execute(executor, campaign, character, commands, random.Random(212))

    def forge_origin(result):
        result["events"][0]["roll"] = 66
        result["events"][0]["outcome"] = "failure"
        result["events"][0]["success"] = False

    _rewrite_roll_copies(
        executor,
        campaign,
        "original-failed-roll",
        forge_origin,
        choice_id=response["choice_id"],
    )

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        executor.get_current_pending_choice(campaign)

    assert exc_info.value.code == "malformed_subsystem_state"
    assert "roll" in exc_info.value.message


def test_cancelled_push_offer_rejects_coordinated_state_and_result_rewrite(tmp_path):
    executor = _executor("coc_subsystem_executor_push_offer_independent_evidence")
    campaign, character = _campaign_and_character(tmp_path)
    offered = _offer_push(executor, campaign, character)
    response = _push_response(offered["pending_choice"], "cancel")
    commands = executor.commands_from_rules_requests(
        executor.plan_from_pending_choice_response(campaign, "inv1", response)
    )
    _execute(executor, campaign, character, commands, random.Random(212))
    state_path = campaign / "save" / "subsystem-state.json"
    state = json.loads(state_path.read_text())
    history = state["choice_history"][response["choice_id"]]
    forged = "the investigator is instead trapped behind the sealed door"
    history["offer_command"]["payload"]["announced_consequence"]["summary"] = forged
    history["announced_consequence"]["summary"] = forged
    history["public_choice"]["prompt"] = (
        "Push the failed Spot Hidden roll? Failure consequence: " + forged
    )
    offer_id = history["offer_command_id"]
    state["result_snapshots"][offer_id]["pending_choice"] = history["public_choice"]
    state["command_hashes"][offer_id] = executor._canonical_command_hash(
        history["offer_command"]
    )
    state_path.write_text(json.dumps(state), encoding="utf-8")

    def rewrite_offer(result):
        result["pending_choice"] = history["public_choice"]

    _rewrite_result_receipt(executor, campaign, offer_id, rewrite_offer)
    receipt_path = campaign / "logs" / "subsystem-results.jsonl"
    rows = [json.loads(line) for line in receipt_path.read_text().splitlines()]
    for row in rows:
        if row["command_id"] == offer_id:
            row["command_hash"] = state["command_hashes"][offer_id]
            material = {key: value for key, value in row.items() if key != "receipt_hash"}
            row["receipt_hash"] = executor._canonical_json_hash(material)
    receipt_path.write_text(
        "".join(json.dumps(row, sort_keys=True) + "\n" for row in rows),
        encoding="utf-8",
    )

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        executor.get_current_pending_choice(campaign)

    assert exc_info.value.code == "malformed_subsystem_state"
    assert "offer" in exc_info.value.message


@pytest.mark.parametrize("damage", ["missing", "duplicate", "cross_choice", "malformed"])
def test_push_offer_evidence_rejects_missing_duplicate_cross_choice_or_malformed(
    tmp_path, damage,
):
    executor = _executor(f"coc_subsystem_executor_push_offer_evidence_{damage}")
    campaign, character = _campaign_and_character(tmp_path)
    _offer_push(executor, campaign, character)
    path = campaign / "logs" / "push-offers.jsonl"
    original = path.read_text(encoding="utf-8")
    if damage == "missing":
        path.write_text("", encoding="utf-8")
    elif damage == "duplicate":
        path.write_text(original + original, encoding="utf-8")
    elif damage == "malformed":
        path.write_text(original + "{not-json}\n", encoding="utf-8")
    else:
        row = json.loads(original)
        row["choice_id"] = "another-offer:confirm"
        material = {key: value for key, value in row.items() if key != "evidence_hash"}
        row["evidence_hash"] = executor._canonical_json_hash(material)
        path.write_text(json.dumps(row) + "\n", encoding="utf-8")

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        executor.get_current_pending_choice(campaign)

    assert exc_info.value.code == "malformed_subsystem_state"
    assert "offer" in exc_info.value.message


def test_ordinary_roll_receipt_is_bound_to_immutable_roll_log(tmp_path):
    executor = _executor("coc_subsystem_executor_ordinary_roll_log")
    campaign, character = _campaign_and_character(tmp_path)
    _persist_failed_pushable_roll(executor, campaign, character)

    def forge_origin(result):
        result["events"][0]["roll"] = 66
        result["events"][0]["outcome"] = "failure"
        result["events"][0]["success"] = False

    _rewrite_roll_copies(
        executor, campaign, "original-failed-roll", forge_origin
    )

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        executor.get_current_pending_choice(campaign)

    assert exc_info.value.code == "malformed_subsystem_state"
    assert "roll" in exc_info.value.message


def test_roll_log_rejects_cross_command_payload_substitution(tmp_path):
    executor = _executor("coc_subsystem_executor_cross_roll_substitution")
    campaign, character = _campaign_and_character(tmp_path)
    first = _pushable_roll_command("first-roll")
    second = _pushable_roll_command("second-roll")
    second["payload"]["decision_id"] = "second-decision"
    _execute(executor, campaign, character, [first, second], random.Random(5))
    log_path = campaign / "logs" / "rolls.jsonl"
    rows = [json.loads(line) for line in log_path.read_text().splitlines()]
    rows[0]["payload"], rows[1]["payload"] = rows[1]["payload"], rows[0]["payload"]
    log_path.write_text("".join(json.dumps(row) + "\n" for row in rows))

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        executor.get_current_pending_choice(campaign)

    assert exc_info.value.code == "malformed_subsystem_state"
    assert "roll" in exc_info.value.message


@pytest.mark.parametrize("damage", ["missing", "duplicate", "malformed"])
def test_canonical_roll_log_rejects_missing_duplicate_or_malformed_entry(
    tmp_path, damage,
):
    executor = _executor(f"coc_subsystem_executor_roll_log_{damage}")
    campaign, character = _campaign_and_character(tmp_path)
    _persist_failed_pushable_roll(executor, campaign, character)
    log_path = campaign / "logs" / "rolls.jsonl"
    original = log_path.read_text()
    if damage == "missing":
        log_path.write_text("")
    elif damage == "duplicate":
        log_path.write_text(original + original)
    else:
        log_path.write_text(original + "{not-json}\n")

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        executor.get_current_pending_choice(campaign)

    assert exc_info.value.code == "malformed_subsystem_state"
    assert "roll" in exc_info.value.message


def test_choice_history_rejects_unrelated_applied_terminal_command(tmp_path):
    executor = _executor("coc_subsystem_executor_history_exact_terminal")
    campaign, character = _campaign_and_character(tmp_path)
    offered = _offer_push(executor, campaign, character)
    response = _push_response(offered["pending_choice"], "cancel")
    plan = executor.plan_from_pending_choice_response(campaign, "inv1", response)
    _execute(
        executor,
        campaign,
        character,
        executor.commands_from_rules_requests(plan),
        random.Random(212),
    )
    state_path = campaign / "save" / "subsystem-state.json"
    state = json.loads(state_path.read_text())
    state["choice_history"][response["choice_id"]]["terminal_command_ids"] = [
        "original-failed-roll"
    ]
    state_path.write_text(json.dumps(state))

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        executor.plan_from_pending_choice_response(campaign, "inv1", response)

    assert exc_info.value.code == "malformed_subsystem_state"


@pytest.mark.parametrize("action", ["cancel", "confirm"])
def test_push_history_binds_exact_terminal_command_receipts(tmp_path, action):
    executor = _executor(f"coc_subsystem_executor_history_receipt_push_{action}")
    campaign, character = _campaign_and_character(tmp_path)
    offered = _offer_push(executor, campaign, character)
    response = _push_response(offered["pending_choice"], action)
    commands = executor.commands_from_rules_requests(
        executor.plan_from_pending_choice_response(campaign, "inv1", response)
    )
    _execute(executor, campaign, character, commands, random.Random(212))
    state = json.loads((campaign / "save" / "subsystem-state.json").read_text())
    history = state["choice_history"][response["choice_id"]]

    assert history["terminal_commands"] == commands
    assert [
        state["command_hashes"][command["command_id"]]
        for command in history["terminal_commands"]
    ] == [executor._canonical_command_hash(command) for command in commands]
    assert history["terminal_results"] == [
        state["result_snapshots"][command["command_id"]] for command in commands
    ]


def test_push_result_rejects_coordinated_invalid_percentile_relationships(tmp_path):
    executor = _executor("coc_subsystem_invalid_percentile_relationship")
    campaign, character = _campaign_and_character(tmp_path)
    response, commands, index = _terminal_history_variant(
        executor, campaign, character, "push_resolve"
    )
    state_path = campaign / "save" / "subsystem-state.json"
    state = json.loads(state_path.read_text())
    history = state["choice_history"][response["choice_id"]]
    command_id = commands[index]["command_id"]
    for result in (state["result_snapshots"][command_id], history["terminal_results"][index]):
        result["events"][0]["roll"] = 99
        result["events"][0]["outcome"] = "critical"
        result["events"][0]["success"] = True
    state_path.write_text(json.dumps(state))

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        executor.get_current_pending_choice(campaign)

    assert exc_info.value.code == "malformed_subsystem_state"


def test_bout_history_binds_exact_terminal_command_receipt(tmp_path):
    executor = _executor("coc_subsystem_executor_history_receipt_bout_end")
    campaign, character = _campaign_and_character(tmp_path)
    _set_high_san_and_int(character)
    started = _execute(
        executor, campaign, character,
        [_realtime_bout_command("san-history-receipt")], random.Random(1),
    )[0]
    response = _keeper_response(started["pending_choice"], "end")
    commands = executor.commands_from_rules_requests(
        executor.plan_from_pending_choice_response(campaign, "inv1", response)
    )
    _execute(executor, campaign, character, commands, random.Random(218))
    state = json.loads((campaign / "save" / "subsystem-state.json").read_text())

    history = state["choice_history"][response["choice_id"]]
    assert history["terminal_commands"] == commands
    assert history["terminal_results"] == [
        state["result_snapshots"][command["command_id"]] for command in commands
    ]


@pytest.mark.parametrize(
    ("variant", "field", "value"),
    [
        ("push_resolve", "roll", 99),
        ("push_resolve", "outcome", "critical"),
        ("push_resolve", "success", False),
        ("bout_end", "event_id", "se999"),
        ("bout_end", "summary", "forged ending"),
        ("bout_end", "backstory_amend_suggestion", {"keeper_note": "forged"}),
        ("bout_tick", "event_id", "se999"),
    ],
)
def test_terminal_result_receipt_rejects_exact_field_tampering(
    tmp_path, variant, field, value,
):
    executor = _executor(f"coc_subsystem_exact_result_{variant}_{field}")
    campaign, character = _campaign_and_character(tmp_path)
    response, commands, index = _terminal_history_variant(
        executor, campaign, character, variant
    )
    state_path = campaign / "save" / "subsystem-state.json"
    state = json.loads(state_path.read_text())
    command_id = commands[index]["command_id"]
    event = state["result_snapshots"][command_id]["events"][-1]
    event[field] = value
    state_path.write_text(json.dumps(state))

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        executor.get_current_pending_choice(campaign)

    assert exc_info.value.code == "malformed_subsystem_state"


@pytest.mark.parametrize("variant", ["push_resolve", "bout_end", "bout_tick"])
def test_terminal_result_closed_schema_rejects_coordinated_snapshot_receipt_tamper(
    tmp_path, variant,
):
    executor = _executor(f"coc_subsystem_closed_result_{variant}")
    campaign, character = _campaign_and_character(tmp_path)
    response, commands, index = _terminal_history_variant(
        executor, campaign, character, variant
    )
    state_path = campaign / "save" / "subsystem-state.json"
    state = json.loads(state_path.read_text())
    history = state["choice_history"][response["choice_id"]]
    command_id = commands[index]["command_id"]
    state["result_snapshots"][command_id]["events"][-1]["keeper_secret"] = "leak"
    history["terminal_results"][index]["events"][-1]["keeper_secret"] = "leak"
    state_path.write_text(json.dumps(state))

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        executor.get_current_pending_choice(campaign)

    assert exc_info.value.code == "malformed_subsystem_state"


def test_bout_result_rejects_coordinated_backstory_receipt_tamper(tmp_path):
    executor = _executor("coc_subsystem_bout_backstory_exact_receipt")
    campaign, character = _campaign_and_character(tmp_path)
    response, commands, index = _terminal_history_variant(
        executor, campaign, character, "bout_end"
    )
    state_path = campaign / "save" / "subsystem-state.json"
    state = json.loads(state_path.read_text())
    history = state["choice_history"][response["choice_id"]]
    command_id = commands[index]["command_id"]
    for result in (state["result_snapshots"][command_id], history["terminal_results"][index]):
        result["events"][-1]["backstory_amend_suggestion"]["keeper_note"] = "forged but shaped"
    state_path.write_text(json.dumps(state))

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        executor.get_current_pending_choice(campaign)

    assert exc_info.value.code == "malformed_subsystem_state"


@pytest.mark.parametrize(
    ("variant", "mutate"),
    [
        ("push_resolve", "roll_outcome"),
        ("bout_end", "event_id"),
        ("bout_end", "backstory"),
    ],
)
def test_canonical_result_receipt_rejects_coordinated_terminal_copy_mutation(
    tmp_path, variant, mutate,
):
    executor = _executor(f"coc_subsystem_independent_receipt_{variant}_{mutate}")
    campaign, character = _campaign_and_character(tmp_path)
    response, commands, index = _terminal_history_variant(
        executor, campaign, character, variant
    )
    state_path = campaign / "save" / "subsystem-state.json"
    state = json.loads(state_path.read_text())
    history = state["choice_history"][response["choice_id"]]
    command_id = commands[index]["command_id"]
    copies = (state["result_snapshots"][command_id], history["terminal_results"][index])
    if mutate == "roll_outcome":
        for result in copies:
            result["events"][0]["roll"] = 1
            result["events"][0]["outcome"] = "critical"
            result["events"][0]["success"] = True
    elif mutate == "event_id":
        for result in copies:
            result["events"][-1]["event_id"] = "se999"
    else:
        origin_id = history["origin_command_id"]
        for result in copies:
            result["events"][-1]["backstory_amend_suggestion"]["keeper_note"] = "forged"
        origin_bout = next(
            event for event in state["result_snapshots"][origin_id]["events"]
            if event.get("event_type") == "bout_of_madness"
        )
        origin_bout["backstory_amend_suggestion"]["keeper_note"] = "forged"
    state_path.write_text(json.dumps(state))

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        executor.get_current_pending_choice(campaign)
    assert exc_info.value.code == "malformed_subsystem_state"


def test_canonical_result_receipt_is_choice_scoped_across_histories(tmp_path):
    executor = _executor("coc_subsystem_independent_receipt_cross_history")
    campaign, character = _campaign_and_character(tmp_path)
    first_response, first_commands, first_index = _terminal_history_variant(
        executor, campaign, character, "push_resolve"
    )
    state_path = campaign / "save" / "subsystem-state.json"
    state = json.loads(state_path.read_text())
    first = state["choice_history"][first_response["choice_id"]]
    assert len(first["terminal_result_receipt_hashes"]) == 2
    first["terminal_result_receipt_hashes"].reverse()
    state_path.write_text(json.dumps(state))
    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        executor.get_current_pending_choice(campaign)
    assert exc_info.value.code == "malformed_subsystem_state"


@pytest.mark.parametrize(
    ("tamper", "value"),
    [
        ("hash", "0" * 64),
        ("status", "completed"),
        ("event", [{"event_type": "forged"}]),
        ("refs", []),
    ],
)
def test_cancelled_push_history_rejects_tampered_terminal_receipt_or_result(
    tmp_path, tamper, value,
):
    executor = _executor(f"coc_subsystem_executor_history_tamper_{tamper}")
    campaign, character = _campaign_and_character(tmp_path)
    offered = _offer_push(executor, campaign, character)
    response = _push_response(offered["pending_choice"], "cancel")
    commands = executor.commands_from_rules_requests(
        executor.plan_from_pending_choice_response(campaign, "inv1", response)
    )
    _execute(executor, campaign, character, commands, random.Random(212))
    state_path = campaign / "save" / "subsystem-state.json"
    state = json.loads(state_path.read_text())
    command_id = commands[0]["command_id"]
    if tamper == "hash":
        state["command_hashes"][command_id] = value
    elif tamper == "status":
        state["result_snapshots"][command_id]["status"] = value
    elif tamper == "event":
        state["result_snapshots"][command_id]["events"] = value
    else:
        state["result_snapshots"][command_id]["state_refs"] = value
    state_path.write_text(json.dumps(state))

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        executor.plan_from_pending_choice_response(campaign, "inv1", response)

    assert exc_info.value.code == "malformed_subsystem_state"


def _terminal_history_variant(executor, campaign, character, variant):
    if variant.startswith("push_"):
        offered = _offer_push(executor, campaign, character)
        action = "cancel" if variant == "push_cancel" else "confirm"
        response = _push_response(offered["pending_choice"], action)
        commands = executor.commands_from_rules_requests(
            executor.plan_from_pending_choice_response(campaign, "inv1", response)
        )
        _execute(executor, campaign, character, commands, random.Random(212))
        index = 1 if variant == "push_resolve" else 0
        return response, commands, index

    _set_high_san_and_int(character)
    started = _execute(
        executor, campaign, character,
        [_realtime_bout_command(f"san-{variant}")], random.Random(1),
    )[0]
    choice = started["pending_choice"]
    if variant == "bout_end":
        response = _keeper_response(choice, "end")
        commands = executor.commands_from_rules_requests(
            executor.plan_from_pending_choice_response(campaign, "inv1", response)
        )
        _execute(executor, campaign, character, commands, random.Random(218))
        return response, commands, 0
    for seed in range(300, 320):
        response = _keeper_response(choice, "tick")
        commands = executor.commands_from_rules_requests(
            executor.plan_from_pending_choice_response(campaign, "inv1", response)
        )
        result = _execute(
            executor, campaign, character, commands, random.Random(seed)
        )[0]
        if result["status"] == "completed":
            return response, commands, 0
        choice = result["pending_choice"]
    raise AssertionError("test bout did not reach its terminal tick")


@pytest.mark.parametrize(
    "variant",
    ["push_cancel", "push_confirm", "push_resolve", "bout_end", "bout_tick"],
)
@pytest.mark.parametrize(
    "tamper",
    ["receipt", "hash", "status", "choice", "event", "refs"],
)
def test_all_choice_history_terminal_variants_reject_receipt_and_snapshot_tampering(
    tmp_path, variant, tamper,
):
    executor = _executor(f"coc_subsystem_executor_terminal_{variant}_{tamper}")
    campaign, character = _campaign_and_character(tmp_path)
    response, commands, index = _terminal_history_variant(
        executor, campaign, character, variant
    )
    state_path = campaign / "save" / "subsystem-state.json"
    state = json.loads(state_path.read_text())
    history = state["choice_history"][response["choice_id"]]
    command_id = commands[index]["command_id"]
    snapshot = state["result_snapshots"][command_id]
    if tamper == "receipt":
        history["terminal_commands"][index]["payload"]["decision_id"] = "forged"
    elif tamper == "hash":
        state["command_hashes"][command_id] = "0" * 64
    elif tamper == "status":
        snapshot["status"] = "forged"
    elif tamper == "choice":
        snapshot["pending_choice"] = history["public_choice"]
    elif tamper == "event":
        snapshot["events"] = [{"event_type": "forged"}]
    else:
        snapshot["state_refs"] = []
    state_path.write_text(json.dumps(state))

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        executor.get_current_pending_choice(campaign)

    assert exc_info.value.code == "malformed_subsystem_state"


def test_invalid_pending_response_does_not_recover_or_mutate_prepared_inflight(
    tmp_path,
):
    executor = _executor("coc_subsystem_executor_response_before_recovery")
    campaign, character = _campaign_and_character(tmp_path)
    offered = _offer_push(executor, campaign, character)
    valid_response = _push_response(offered["pending_choice"], "confirm")
    valid_plan = executor.plan_from_pending_choice_response(
        campaign, "inv1", valid_response
    )
    commands = executor.commands_from_rules_requests(valid_plan)
    state_path = campaign / "save" / "subsystem-state.json"
    state = json.loads(state_path.read_text())
    state["inflight"] = executor._build_inflight(
        campaign,
        "inv1",
        [(command, executor._canonical_command_hash(command)) for command in commands],
    )
    executor._write_executor_state(campaign, state)
    roll_log = campaign / "logs" / "rolls.jsonl"
    with roll_log.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps({"sentinel": "must survive invalid response"}) + "\n")
    state_before = state_path.read_bytes()
    log_before = roll_log.read_bytes()
    invalid_response = dict(valid_response)
    invalid_response["revision"] += 1

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        executor.plan_from_pending_choice_response(
            campaign, "inv1", invalid_response
        )

    assert exc_info.value.code == "stale_pending_choice_response"
    assert state_path.read_bytes() == state_before
    assert roll_log.read_bytes() == log_before


def test_push_confirm_transaction_failure_restores_pending_rng_log_and_can_retry(
    tmp_path,
    monkeypatch,
):
    executor = _executor("coc_subsystem_executor_push_confirm_rollback")
    campaign, character = _campaign_and_character(tmp_path)
    offered = _offer_push(executor, campaign, character)
    response = _push_response(offered["pending_choice"], "confirm")
    plan = executor.plan_from_pending_choice_response(campaign, "inv1", response)
    commands = executor.commands_from_rules_requests(plan)
    resolve_id = commands[-1]["command_id"]
    state_path = campaign / "save" / "subsystem-state.json"
    state_before = state_path.read_bytes()
    log_path = campaign / "logs" / "rolls.jsonl"
    log_before = log_path.read_bytes()
    rng = random.Random(5)
    rng_before = rng.getstate()
    real_write = executor._write_executor_state

    def fail_final_ledger(campaign_dir, state):
        if state.get("inflight") is None and resolve_id in state.get("applied_command_ids", []):
            raise OSError("injected push final-ledger failure")
        return real_write(campaign_dir, state)

    monkeypatch.setattr(executor, "_write_executor_state", fail_final_ledger)
    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        _execute(executor, campaign, character, commands, rng)

    assert exc_info.value.code == "subsystem_transaction_failed"
    assert rng.getstate() == rng_before
    assert state_path.read_bytes() == state_before
    assert log_path.read_bytes() == log_before
    assert executor.get_current_pending_choice(campaign) == offered["pending_choice"]

    monkeypatch.setattr(executor, "_write_executor_state", real_write)
    retried = _execute(executor, campaign, character, commands, rng)
    assert retried[-1]["events"][0]["outcome"] == "failure"
    assert executor.get_current_pending_choice(campaign) is None


def test_consumed_push_origin_cannot_be_offered_again_after_cancel(tmp_path):
    executor = _executor("coc_subsystem_executor_push_consumed_origin")
    campaign, character = _campaign_and_character(tmp_path)
    offered = _offer_push(executor, campaign, character)
    response = _push_response(offered["pending_choice"], "cancel")
    plan = executor.plan_from_pending_choice_response(campaign, "inv1", response)
    _execute(
        executor,
        campaign,
        character,
        executor.commands_from_rules_requests(plan),
        random.Random(214),
    )
    state_path = campaign / "save" / "subsystem-state.json"
    before = state_path.read_bytes()

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        _execute(
            executor,
            campaign,
            character,
            [_valid_push_offer(command_id="push-after-cancel")],
            random.Random(215),
        )

    assert exc_info.value.code == "push_origin_already_used"
    assert state_path.read_bytes() == before


def test_structured_sanity_fields_are_forwarded_and_new_session_events_are_captured(
    tmp_path,
):
    executor = _executor("coc_subsystem_executor_sanity_forwarding")
    campaign, character = _campaign_and_character(tmp_path)
    command = _san_command("san-forwarding")
    command["payload"].update({
        "san_loss_fail_expr": "1",
        "alone": True,
        "involuntary_kind": "flee",
        "involuntary_summary": "retreat to the marked safe doorway",
        "module_bout_override": {"force_mode": "summary"},
        "creature_type": "deep-one",
    })

    result = _execute(
        executor,
        campaign,
        character,
        [command],
        random.Random(5),
    )[0]

    assert result["status"] == "completed"
    event_types = [event.get("event_type") for event in result["events"]]
    assert "sanity" in event_types
    assert "involuntary_action" in event_types
    sanity = json.loads((campaign / "save" / "sanity.json").read_text())
    assert sanity["involuntary_actions"][-1] == {
        "kind": "flee",
        "summary": "retreat to the marked safe doorway",
        "source": "structured-test-source",
        "rule_ref": "core.sanity.failure_involuntary_action",
    }
    assert sanity["awfulness_caps"]["deep-one"] == 1
    assert event_types.count("sanity") == 1
    assert event_types.count("involuntary_action") == 1
    roll_rows = [
        json.loads(line)
        for line in (campaign / "logs" / "rolls.jsonl").read_text().splitlines()
    ]
    assert len(roll_rows) == 1
    assert roll_rows[0]["payload"].get("roll_id") == "san-forwarding"
    assert roll_rows[0]["payload"].get("event_type") is None


def test_forced_summary_bout_finishes_without_keeper_pending_choice(tmp_path):
    executor = _executor("coc_subsystem_executor_bout_forced_summary")
    campaign, character = _campaign_and_character(tmp_path)
    _set_high_san_and_int(character)
    command = _realtime_bout_command("san-forced-summary")
    command["payload"]["alone"] = True
    command["payload"]["module_bout_override"] = {
        "force_mode": "summary",
        "result_description": "structured summary consequence",
    }

    result = _execute(executor, campaign, character, [command], random.Random(1))[0]

    bout = next(
        event for event in result["events"] if event.get("event_type") == "bout_of_madness"
    )
    assert bout["mode"] == "summary"
    assert result["status"] == "completed"
    assert result["pending_choice"] is None
    sanity = json.loads((campaign / "save" / "sanity.json").read_text())
    assert sanity["bout_active"] is False
    assert sanity["active_bout_id"] is None


def test_module_bout_result_override_does_not_require_forced_mode(tmp_path):
    executor = _executor("coc_subsystem_executor_bout_result_only_override")
    campaign, character = _campaign_and_character(tmp_path)
    command = _san_command("san-result-only-override")
    command["payload"]["module_bout_override"] = {
        "result_description": "module-authored bout result",
    }

    result = _execute(executor, campaign, character, [command], random.Random(225))[0]

    assert result["status"] == "completed"


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("alone", "yes"),
        ("involuntary_kind", "scan this prose for flight"),
        ("involuntary_summary", {"text": "not a string"}),
        ("module_bout_override", {"force_mode": "keyword-inferred"}),
        ("creature_type", ["deep-one"]),
    ],
)
def test_structured_sanity_fields_fail_closed_before_rng_or_state_mutation(
    tmp_path,
    field,
    value,
):
    executor = _executor(f"coc_subsystem_executor_sanity_invalid_{field}")
    campaign, character = _campaign_and_character(tmp_path)
    command = _san_command("san-invalid-structured")
    command["payload"][field] = value
    rng = random.Random(224)
    before = rng.getstate()

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        _execute(executor, campaign, character, [command], rng)

    assert exc_info.value.code == "invalid_command_payload"
    assert field in exc_info.value.path
    assert rng.getstate() == before
    assert not (campaign / "save" / "subsystem-state.json").exists()


def test_realtime_sanity_bout_creates_keeper_choice_and_ticks_to_terminal_across_reload(
    tmp_path,
):
    executor = _executor("coc_subsystem_executor_bout_start")
    campaign, character = _campaign_and_character(tmp_path)
    _set_high_san_and_int(character)
    started = _execute(
        executor,
        campaign,
        character,
        [_realtime_bout_command()],
        random.Random(1),
    )[0]

    assert started["status"] == "pending_choice"
    choice = started["pending_choice"]
    assert choice["kind"] == "bout_keeper_action"
    assert choice["responder"] == "keeper"
    assert choice["revision"] == 0
    assert choice["command_id"] == "san-realtime-bout"
    assert choice["options"] == [
        {"action": "tick", "label": "Advance Keeper-controlled round"},
        {"action": "end", "label": "End the bout now"},
    ]
    assert "structured module bout override" not in json.dumps(choice)
    sanity = json.loads((campaign / "save" / "sanity.json").read_text())
    bout_id = sanity["active_bout_id"]
    initial_rounds = sanity["bout_rounds_remaining"]
    assert initial_rounds >= 1
    state = json.loads((campaign / "save" / "subsystem-state.json").read_text())
    private = state["pending_contexts"][choice["choice_id"]]
    assert private["bout_id"] == bout_id
    assert private["remaining_rounds"] == initial_rounds
    log_path = campaign / "logs" / "rolls.jsonl"
    log_after_start = log_path.read_bytes()

    for expected_remaining in range(initial_rounds - 1, -1, -1):
        executor = _executor(
            f"coc_subsystem_executor_bout_reload_{expected_remaining}"
        )
        response = _keeper_response(choice, "tick")
        plan = executor.plan_from_pending_choice_response(campaign, "inv1", response)
        commands = executor.commands_from_rules_requests(plan)
        assert [command["kind"] for command in commands] == ["bout_tick"]
        rng = random.Random(217 + expected_remaining)
        rng_before = rng.getstate()
        result = _execute(executor, campaign, character, commands, rng)[0]
        assert rng.getstate() == rng_before
        assert log_path.read_bytes() == log_after_start
        assert result["events"][0]["event_type"] == "bout_tick"
        assert result["events"][0]["bout_id"] == bout_id
        assert result["events"][0]["remaining_rounds"] == expected_remaining
        if expected_remaining:
            assert result["status"] == "pending_choice"
            next_choice = result["pending_choice"]
            assert next_choice["choice_id"] == choice["choice_id"]
            assert next_choice["revision"] == choice["revision"] + 1
            choice = next_choice
        else:
            assert result["status"] == "completed"
            assert result["pending_choice"] is None
            assert any(
                event.get("event_type") == "bout_ended"
                for event in result["events"]
            )

    final_sanity = json.loads((campaign / "save" / "sanity.json").read_text())
    assert final_sanity["bout_active"] is False
    assert final_sanity["bout_rounds_remaining"] == 0
    assert final_sanity["active_bout_id"] is None
    assert final_sanity["temporary_insane"] is True
    assert executor.get_current_pending_choice(campaign) is None


def test_bout_end_command_clears_keeper_choice_but_preserves_underlying_insanity(
    tmp_path,
):
    executor = _executor("coc_subsystem_executor_bout_explicit_end")
    campaign, character = _campaign_and_character(tmp_path)
    _set_high_san_and_int(character)
    started = _execute(
        executor,
        campaign,
        character,
        [_realtime_bout_command("san-explicit-end")],
        random.Random(1),
    )[0]
    response = _keeper_response(started["pending_choice"], "end")
    plan = executor.plan_from_pending_choice_response(campaign, "inv1", response)
    commands = executor.commands_from_rules_requests(plan)
    assert [command["kind"] for command in commands] == ["bout_end"]

    ended = _execute(
        executor,
        campaign,
        character,
        commands,
        random.Random(218),
    )[0]

    assert ended["status"] == "completed"
    assert ended["pending_choice"] is None
    assert any(event.get("event_type") == "bout_ended" for event in ended["events"])
    sanity = json.loads((campaign / "save" / "sanity.json").read_text())
    assert sanity["bout_active"] is False
    assert sanity["temporary_insane"] is True


@pytest.mark.parametrize(
    ("response_patch", "code"),
    [
        ({"revision": 99}, "stale_pending_choice_response"),
        ({"responder": "player"}, "wrong_pending_choice_responder"),
        ({"action": "confirm"}, "invalid_pending_choice_action"),
    ],
)
def test_bout_response_wrong_stale_or_player_responder_fails_before_mutation(
    tmp_path,
    response_patch,
    code,
):
    executor = _executor(f"coc_subsystem_executor_bout_response_{code}")
    campaign, character = _campaign_and_character(tmp_path)
    _set_high_san_and_int(character)
    started = _execute(
        executor,
        campaign,
        character,
        [_realtime_bout_command("san-bout-response")],
        random.Random(1),
    )[0]
    response = _keeper_response(started["pending_choice"], "tick")
    response.update(response_patch)
    state_path = campaign / "save" / "subsystem-state.json"
    before = state_path.read_bytes()

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        executor.plan_from_pending_choice_response(campaign, "inv1", response)

    assert exc_info.value.code == code
    assert state_path.read_bytes() == before


def test_bout_tick_exact_command_replay_does_not_decrement_twice(tmp_path):
    executor = _executor("coc_subsystem_executor_bout_tick_replay")
    campaign, character = _campaign_and_character(tmp_path)
    _set_high_san_and_int(character)
    started = _execute(
        executor, campaign, character, [_realtime_bout_command("san-replay")], random.Random(1)
    )[0]
    response = _keeper_response(started["pending_choice"], "tick")
    plan = executor.plan_from_pending_choice_response(campaign, "inv1", response)
    commands = executor.commands_from_rules_requests(plan)
    first = _execute(executor, campaign, character, commands, random.Random(220))
    sanity_after_first = (campaign / "save" / "sanity.json").read_bytes()

    replay_rng = random.Random(221)
    rng_before = replay_rng.getstate()
    replay = _execute(executor, campaign, character, commands, replay_rng)

    assert replay == first
    assert replay_rng.getstate() == rng_before
    assert (campaign / "save" / "sanity.json").read_bytes() == sanity_after_first


def test_terminal_bout_rejects_different_action_for_consumed_revision(tmp_path):
    executor = _executor("coc_subsystem_executor_bout_terminal_stale")
    campaign, character = _campaign_and_character(tmp_path)
    _set_high_san_and_int(character)
    started = _execute(
        executor, campaign, character, [_realtime_bout_command("san-terminal")], random.Random(1)
    )[0]
    choice = started["pending_choice"]
    end_response = _keeper_response(choice, "end")
    _execute(
        executor,
        campaign,
        character,
        executor.commands_from_rules_requests(
            executor.plan_from_pending_choice_response(campaign, "inv1", end_response)
        ),
        random.Random(222),
    )

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        executor.plan_from_pending_choice_response(
            campaign, "inv1", _keeper_response(choice, "tick")
        )

    assert exc_info.value.code == "stale_pending_choice_response"


def test_corrupt_bout_history_public_choice_must_match_creator_snapshot(tmp_path):
    executor = _executor("coc_subsystem_executor_bout_history_binding")
    campaign, character = _campaign_and_character(tmp_path)
    _set_high_san_and_int(character)
    started = _execute(
        executor,
        campaign,
        character,
        [_realtime_bout_command("san-history-binding")],
        random.Random(1),
    )[0]
    response = _keeper_response(started["pending_choice"], "end")
    _execute(
        executor,
        campaign,
        character,
        executor.commands_from_rules_requests(
            executor.plan_from_pending_choice_response(campaign, "inv1", response)
        ),
        random.Random(227),
    )
    state_path = campaign / "save" / "subsystem-state.json"
    state = json.loads(state_path.read_text())
    state["choice_history"][response["choice_id"]]["public_choice"][
        "responder"
    ] = "player"
    state_path.write_text(json.dumps(state))

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        executor.get_current_pending_choice(campaign)

    assert exc_info.value.code == "malformed_subsystem_state"


def test_bout_tick_final_ledger_failure_rolls_back_sanity_choice_and_can_retry(
    tmp_path,
    monkeypatch,
):
    executor = _executor("coc_subsystem_executor_bout_tick_rollback")
    campaign, character = _campaign_and_character(tmp_path)
    _set_high_san_and_int(character)
    started = _execute(
        executor, campaign, character, [_realtime_bout_command("san-rollback")], random.Random(1)
    )[0]
    response = _keeper_response(started["pending_choice"], "tick")
    commands = executor.commands_from_rules_requests(
        executor.plan_from_pending_choice_response(campaign, "inv1", response)
    )
    command_id = commands[0]["command_id"]
    paths = [
        campaign / "save" / "subsystem-state.json",
        campaign / "save" / "sanity.json",
        campaign / "save" / "investigator-state" / "inv1.json",
        campaign / "logs" / "rolls.jsonl",
    ]
    before = {path: path.read_bytes() for path in paths}
    real_write = executor._write_executor_state

    def fail_final_ledger(campaign_dir, state):
        if state.get("inflight") is None and command_id in state.get("applied_command_ids", []):
            raise OSError("injected bout final-ledger failure")
        return real_write(campaign_dir, state)

    monkeypatch.setattr(executor, "_write_executor_state", fail_final_ledger)
    rng = random.Random(223)
    rng_before = rng.getstate()
    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        _execute(executor, campaign, character, commands, rng)

    assert exc_info.value.code == "subsystem_transaction_failed"
    assert rng.getstate() == rng_before
    assert {path: path.read_bytes() for path in paths} == before
    assert executor.get_current_pending_choice(campaign) == started["pending_choice"]

    monkeypatch.setattr(executor, "_write_executor_state", real_write)
    retried = _execute(executor, campaign, character, commands, rng)
    assert retried[0]["kind"] == "bout_tick"


def test_bout_choice_id_is_bounded_for_maximum_command_id(tmp_path):
    executor = _executor("coc_subsystem_executor_bout_max_id")
    campaign, character = _campaign_and_character(tmp_path)
    _set_high_san_and_int(character)
    result = _execute(
        executor,
        campaign,
        character,
        [_realtime_bout_command("s" * 128)],
        random.Random(1),
    )[0]

    assert len(result["pending_choice"]["choice_id"]) <= 128
    assert executor.get_current_pending_choice(campaign) == result["pending_choice"]


def test_bout_id_is_bounded_for_maximum_investigator_id(tmp_path):
    executor = _executor("coc_subsystem_executor_bout_max_investigator")
    campaign, character = _campaign_and_character(tmp_path)
    investigator_id = "i" * 128
    sheet = json.loads(character.read_text())
    sheet["id"] = investigator_id
    sheet["characteristics"].update({"POW": 99, "INT": 99})
    sheet["derived"]["SAN"] = 99
    character = tmp_path / "investigators" / investigator_id / "character.json"
    character.parent.mkdir(parents=True)
    character.write_text(json.dumps(sheet))

    result = executor.execute_commands(
        campaign,
        character,
        investigator_id,
        [_realtime_bout_command("san-max-investigator")],
        rng=random.Random(1),
    )[0]
    sanity = json.loads((campaign / "save" / "sanity.json").read_text())

    assert result["status"] == "pending_choice"
    assert len(sanity["active_bout_id"]) <= 128
    assert sanity["active_bout_id"] == sanity["bouts_of_madness"][-1]["bout_id"]


def test_corrupt_bout_private_context_fails_closed(tmp_path):
    executor = _executor("coc_subsystem_executor_bout_context_corrupt")
    campaign, character = _campaign_and_character(tmp_path)
    _set_high_san_and_int(character)
    started = _execute(
        executor,
        campaign,
        character,
        [_realtime_bout_command("san-corrupt-context")],
        random.Random(1),
    )[0]
    state_path = campaign / "save" / "subsystem-state.json"
    state = json.loads(state_path.read_text())
    state["pending_contexts"][started["pending_choice"]["choice_id"]][
        "remaining_rounds"
    ] = 0
    state_path.write_text(json.dumps(state))

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        executor.get_current_pending_choice(campaign)

    assert exc_info.value.code == "malformed_subsystem_state"


def test_push_offer_must_be_last_new_command_in_atomic_batch(tmp_path):
    executor = _executor("coc_subsystem_executor_push_pending_batch_tail")
    campaign, character = _campaign_and_character(tmp_path)
    _persist_failed_pushable_roll(executor, campaign, character)
    state_path = campaign / "save" / "subsystem-state.json"
    state_before = state_path.read_bytes()
    log_before = (campaign / "logs" / "rolls.jsonl").read_bytes()
    rng = random.Random(226)
    rng_before = rng.getstate()

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        _execute(
            executor,
            campaign,
            character,
            [
                _valid_push_offer(),
                _command("roll-after-push-offer", "skill_check", payload={"skill": "Dodge"}),
            ],
            rng,
        )

    assert exc_info.value.code == "pending_choice_must_end_batch"
    assert state_path.read_bytes() == state_before
    assert (campaign / "logs" / "rolls.jsonl").read_bytes() == log_before
    assert rng.getstate() == rng_before


def test_structured_san_that_can_start_bout_must_end_atomic_batch(tmp_path):
    executor = _executor("coc_subsystem_executor_san_pending_batch_tail")
    campaign, character = _campaign_and_character(tmp_path)
    _set_high_san_and_int(character)
    rng = random.Random(1)
    rng_before = rng.getstate()

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        _execute(
            executor,
            campaign,
            character,
            [
                _realtime_bout_command("san-before-later-roll"),
                _command("roll-after-san", "skill_check", payload={"skill": "Dodge"}),
            ],
            rng,
        )

    assert exc_info.value.code == "pending_choice_must_end_batch"
    assert rng.getstate() == rng_before
    assert not (campaign / "save" / "subsystem-state.json").exists()
    assert not (campaign / "save" / "sanity.json").exists()


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
    _persist_failed_pushable_roll(executor, campaign, character)
    atomic_replaces: list[dict] = []
    real_replace = executor.os.replace

    def recording_replace(src, dst, **kwargs):
        if str(dst) == "subsystem-state.json" or Path(dst).name == "subsystem-state.json":
            atomic_replaces.append(dict(kwargs))
        return real_replace(src, dst, **kwargs)

    monkeypatch.setattr(executor.os, "replace", recording_replace)
    result = _execute(
        executor,
        campaign,
        character,
        [_valid_push_offer(command_id="cmd-1")],
        random.Random(7),
    )[0]

    assert set(result) == RESULT_KEYS
    assert result["status"] == "pending_choice"
    assert result["pending_choice"] == {
        "choice_id": "cmd-1:confirm",
        "kind": "push_confirm",
        "command_id": "cmd-1",
        "responder": "player",
        "revision": 0,
        "prompt": (
            "Push the failed Spot Hidden roll? Failure consequence: "
            "the watcher will identify the investigator if the push fails"
        ),
        "options": [
            {"action": "confirm", "label": "Push the roll"},
            {"action": "cancel", "label": "Keep the original failure"},
        ],
    }
    assert result["state_refs"] == [
        "save/subsystem-state.json#pending_choices/cmd-1:confirm",
        "save/subsystem-state.json#pending_contexts/cmd-1:confirm",
    ]

    state_path = campaign / "save" / "subsystem-state.json"
    state = json.loads(state_path.read_text(encoding="utf-8"))
    assert set(state) == {
        "schema_version",
        "applied_command_ids",
        "command_hashes",
        "command_provenance",
        "result_snapshots",
        "pending_choices",
        "pending_contexts",
        "choice_history",
        "inflight",
    }
    assert state["schema_version"] == 3
    assert state["applied_command_ids"] == ["original-failed-roll", "cmd-1"]
    assert set(state["command_hashes"]) == {"original-failed-roll", "cmd-1"}
    assert len(state["command_hashes"]["cmd-1"]) == hashlib.sha256().digest_size * 2
    assert state["command_provenance"]["cmd-1"] == {
        "investigator_id": "inv1",
        "character_id": "inv1",
        "decision_id": "push-offer-decision",
    }
    assert state["result_snapshots"]["cmd-1"] == result
    assert state["pending_choices"] == {"cmd-1:confirm": result["pending_choice"]}
    assert state["pending_contexts"]["cmd-1:confirm"]["offer_command_id"] == "cmd-1"
    assert state["choice_history"] == {}
    assert state["inflight"] is None
    assert len(atomic_replaces) == 2
    assert all(call.get("src_dir_fd") is not None for call in atomic_replaces)
    assert all(call.get("dst_dir_fd") is not None for call in atomic_replaces)
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
    real_write = executor._ExecutorStateDirectory.write_bytes
    state_writes = 0

    def fail_final_ledger(state_directory, payload):
        nonlocal state_writes
        state_writes += 1
        if state_writes == 2:
            raise OSError("injected final ledger failure")
        return real_write(state_directory, payload)

    monkeypatch.setattr(
        executor._ExecutorStateDirectory,
        "write_bytes",
        fail_final_ledger,
    )
    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        _execute(executor, campaign, character, [_san_command("san-ledger-fail")], rng)

    assert exc_info.value.code == "subsystem_transaction_failed"
    assert rng.getstate() == rng_before
    assert inv_path.read_bytes() == inv_before
    assert not (campaign / "save" / "sanity.json").exists()
    assert not executor.coc_sanity.sanity_snapshot_path(
        campaign, "inv1"
    ).exists()
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
    builder = _executor("coc_subsystem_executor_inflight_builder")
    campaign, character = _campaign_and_character(tmp_path)
    inv_path = campaign / "save" / "investigator-state" / "inv1.json"
    sanity_path = campaign / "save" / "sanity.json"
    log_path = campaign / "logs" / "rolls.jsonl"
    state_path = campaign / "save" / "subsystem-state.json"
    inv_before = inv_path.read_bytes()
    log_before = b'{"baseline": true}\n'
    log_path.write_bytes(log_before)
    time_log_path = campaign / "logs" / "time.jsonl"
    time_log_before = b'{"time-baseline": true}\n'
    time_log_path.write_bytes(time_log_before)

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
            "logs/time.jsonl": {"exists": True, "size": len(time_log_before)},
        },
    }
    state = builder._default_state()
    state["inflight"] = inflight
    state_path.write_text(json.dumps(state), encoding="utf-8")
    inv_path.write_text(json.dumps({"current_san": 1}), encoding="utf-8")
    sanity_path.write_text(json.dumps({"san_current": 1}), encoding="utf-8")
    with log_path.open("ab") as handle:
        handle.write(b"uncommitted-tail")
    with time_log_path.open("ab") as handle:
        handle.write(b"uncommitted-time-tail")

    reloaded = _executor("coc_subsystem_executor_inflight_restart")
    result = _execute(
        reloaded,
        campaign,
        character,
        [],
        random.Random(3),
    )

    assert result == []
    assert inv_path.read_bytes() == inv_before
    assert not sanity_path.exists()
    assert log_path.read_bytes() == log_before
    assert time_log_path.read_bytes() == time_log_before
    recovered = json.loads(state_path.read_text(encoding="utf-8"))
    assert recovered["inflight"] is None
    assert recovered["applied_command_ids"] == []


def _prepare_uncommitted_inflight(executor, campaign: Path) -> dict[Path, bytes | None]:
    command = _san_command("prepared-crash")
    command_hash = executor._canonical_command_hash(command)
    inflight = executor._build_inflight(campaign, "inv1", [(command, command_hash)])
    state = executor._default_state()
    state["inflight"] = inflight
    state_path = campaign / "save" / "subsystem-state.json"
    state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    inv_path = campaign / "save" / "investigator-state" / "inv1.json"
    sanity_path = campaign / "save" / "sanity.json"
    roll_log = campaign / "logs" / "rolls.jsonl"
    inv_path.write_text(json.dumps({"investigator_id": "inv1", "current_san": 1}), encoding="utf-8")
    sanity_path.write_text(json.dumps({"investigator_id": "inv1", "san_current": 1}), encoding="utf-8")
    with roll_log.open("ab") as handle:
        handle.write(b"uncommitted-roll-tail")
    tracked = [state_path, inv_path, sanity_path, roll_log]
    return {path: path.read_bytes() if path.exists() else None for path in tracked}


def _prepare_uncommitted_inflight_on_persisted_state(
    executor,
    campaign: Path,
) -> dict[Path, bytes | None]:
    state_path = campaign / "save" / "subsystem-state.json"
    state = json.loads(state_path.read_text(encoding="utf-8"))
    command = _san_command("prepared-normalize-crash")
    command_hash = executor._canonical_command_hash(command)
    state["inflight"] = executor._build_inflight(
        campaign,
        "inv1",
        [(command, command_hash)],
    )
    state_path.write_text(
        json.dumps(state, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    inv_path = campaign / "save" / "investigator-state" / "inv1.json"
    sanity_path = campaign / "save" / "sanity.json"
    roll_log = campaign / "logs" / "rolls.jsonl"
    inv_path.write_text(
        json.dumps({"investigator_id": "inv1", "current_san": 1}),
        encoding="utf-8",
    )
    sanity_path.write_text(
        json.dumps({"investigator_id": "inv1", "san_current": 1}),
        encoding="utf-8",
    )
    with roll_log.open("ab") as handle:
        handle.write(b"uncommitted-normalize-tail")
    tracked = [state_path, inv_path, sanity_path, roll_log]
    return {path: path.read_bytes() if path.exists() else None for path in tracked}


@pytest.mark.parametrize(
    "invalid_binding",
    ["reversed", "wrong_actor", "wrong_hash", "forged_snapshot"],
)
def test_untrusted_normalized_results_do_not_recover_prepared_inflight(
    tmp_path,
    invalid_binding,
):
    executor = _executor(f"coc_subsystem_executor_normalize_before_recovery_{invalid_binding}")
    campaign, character = _campaign_and_character(tmp_path)
    decision_id = "normalize-before-recovery"
    commands = [
        _command(
            "normalize-first",
            "skill_check",
            payload={"skill": "Spot Hidden", "decision_id": decision_id},
        ),
        _command(
            "normalize-second",
            "skill_check",
            payload={"skill": "Dodge", "decision_id": decision_id},
        ),
    ]
    results = _execute(executor, campaign, character, commands, random.Random(133))
    before = _prepare_uncommitted_inflight_on_persisted_state(executor, campaign)
    supplied = json.loads(json.dumps(results))
    expected = json.loads(json.dumps(commands))
    investigator_id = "inv1"
    if invalid_binding == "reversed":
        supplied.reverse()
    elif invalid_binding == "wrong_actor":
        investigator_id = "inv2"
    elif invalid_binding == "wrong_hash":
        expected[0]["payload"]["difficulty"] = "hard"
    else:
        supplied[0]["events"][0]["success"] = not supplied[0]["events"][0]["success"]

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        executor.normalize_rule_results(
            supplied,
            campaign_dir=campaign,
            expected_commands=expected,
            investigator_id=investigator_id,
            decision_id=decision_id,
            results_mode="normalized",
        )

    assert exc_info.value.code == "untrusted_subsystem_result"
    assert {path: path.read_bytes() if path.exists() else None for path in before} == before


def test_trusted_normalized_results_recover_prepared_inflight_before_return(tmp_path):
    executor = _executor("coc_subsystem_executor_trusted_normalize_recovery")
    campaign, character = _campaign_and_character(tmp_path)
    decision_id = "trusted-normalize-recovery"
    commands = [
        _command(
            "trusted-normalize",
            "skill_check",
            payload={"skill": "Spot Hidden", "decision_id": decision_id},
        )
    ]
    results = _execute(executor, campaign, character, commands, random.Random(136))
    _prepare_uncommitted_inflight_on_persisted_state(executor, campaign)

    events = executor.normalize_rule_results(
        results,
        campaign_dir=campaign,
        expected_commands=commands,
        investigator_id="inv1",
        decision_id=decision_id,
        results_mode="normalized",
    )

    assert events == executor.flatten_result_events(results)
    state = json.loads(
        (campaign / "save" / "subsystem-state.json").read_text(encoding="utf-8")
    )
    assert state["inflight"] is None
    assert not (campaign / "save" / "sanity.json").exists()
    mirror = json.loads(
        (campaign / "save" / "investigator-state" / "inv1.json").read_text(
            encoding="utf-8"
        )
    )
    assert mirror["current_san"] == 55
    assert not (campaign / "logs" / "rolls.jsonl").read_bytes().endswith(
        b"uncommitted-normalize-tail"
    )


def test_invalid_command_is_rejected_before_prepared_inflight_recovery(tmp_path):
    executor = _executor("coc_subsystem_executor_validate_before_recovery")
    campaign, character = _campaign_and_character(tmp_path)
    before = _prepare_uncommitted_inflight(executor, campaign)
    invalid = _san_command("invalid-before-recovery")
    invalid["payload"]["san_loss_fail_expr"] = "1D0"
    rng = random.Random(129)
    rng_before = rng.getstate()

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        _execute(executor, campaign, character, [invalid], rng)

    assert exc_info.value.code == "invalid_command_payload"
    assert exc_info.value.path == "commands[0].payload.san_loss_fail_expr"
    assert rng.getstate() == rng_before
    assert {path: path.read_bytes() if path.exists() else None for path in before} == before


def test_invalid_rng_is_rejected_before_prepared_inflight_recovery(tmp_path):
    executor = _executor("coc_subsystem_executor_rng_before_recovery")
    campaign, character = _campaign_and_character(tmp_path)
    before = _prepare_uncommitted_inflight(executor, campaign)

    class InvalidRng:
        def getstate(self):
            raise TypeError("no RNG state")

        def setstate(self, _state):
            raise AssertionError("setstate must not run")

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        _execute(
            executor,
            campaign,
            character,
            [_command("valid-roll-after-crash", "skill_check", payload={"skill": "Spot Hidden"})],
            InvalidRng(),
        )

    assert exc_info.value.code == "invalid_rng"
    assert exc_info.value.path == "rng"
    assert {path: path.read_bytes() if path.exists() else None for path in before} == before


def test_later_malformed_sanity_state_fails_batch_preflight_without_rng(tmp_path):
    executor = _executor()
    campaign, character = _campaign_and_character(tmp_path)
    (campaign / "save" / "sanity.json").write_text(
        json.dumps({
            "investigator_id": "inv1",
            "san_current": "not-an-integer",
            "san_max": 55,
        }),
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


@pytest.mark.parametrize("modifier", [-1_000_000, -3, 3, 1_000_000])
def test_bonus_penalty_dice_outside_coc_bounds_is_preflighted(tmp_path, modifier):
    executor = _executor(f"coc_subsystem_executor_bonus_bound_{modifier}")
    campaign, character = _campaign_and_character(tmp_path)
    command = _command(
        "bounded-bonus-penalty",
        "skill_check",
        payload={"skill": "Spot Hidden", "bonus_penalty_dice": modifier},
    )
    rng = random.Random(121)
    rng_before = rng.getstate()

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        _execute(executor, campaign, character, [command], rng)

    assert exc_info.value.code == "invalid_command_payload"
    assert exc_info.value.path == "commands[0].payload.bonus_penalty_dice"
    assert rng.getstate() == rng_before
    assert not (campaign / "save" / "subsystem-state.json").exists()
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
        _execute(executor, campaign, character, [], rng)

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


def test_subsystem_state_write_is_dirfd_anchored_across_save_swap(tmp_path, monkeypatch):
    executor = _executor("coc_subsystem_executor_state_toctou")
    campaign, character = _campaign_and_character(tmp_path)
    save_dir = campaign / "save"
    displaced_save = campaign / "save-displaced"
    outside = tmp_path / "outside"
    outside.mkdir()
    sentinel = outside / "sentinel.txt"
    sentinel.write_text("outside sentinel", encoding="utf-8")
    real_replace = executor.os.replace
    swapped = False

    def swap_save_during_state_replace(src, dst, **kwargs):
        nonlocal swapped
        is_state_replace = str(dst) == "subsystem-state.json" or Path(dst).name == "subsystem-state.json"
        if is_state_replace and not swapped:
            swapped = True
            real_replace(save_dir, displaced_save)
            save_dir.symlink_to(outside, target_is_directory=True)
            # Preserve the vulnerable absolute temp pathname so the legacy
            # path-based replace demonstrably lands in the external directory.
            if kwargs.get("src_dir_fd") is None:
                source_name = Path(src).name
                real_replace(displaced_save / source_name, outside / source_name)
        return real_replace(src, dst, **kwargs)

    monkeypatch.setattr(executor.os, "replace", swap_save_during_state_replace)

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        _execute(
            executor,
            campaign,
            character,
            [_command("toctou-roll", "skill_check", payload={"skill": "Spot Hidden"})],
            random.Random(122),
        )

    assert swapped is True
    assert exc_info.value.code == "unsafe_subsystem_state_path"
    assert sentinel.read_text(encoding="utf-8") == "outside sentinel"
    assert not (outside / "subsystem-state.json").exists()
    assert not list(outside.glob("tmp*"))


def test_inflight_preimage_restore_is_dirfd_anchored_across_parent_swap(
    tmp_path,
    monkeypatch,
):
    executor = _executor("coc_subsystem_executor_preimage_restore_toctou")
    campaign, _character = _campaign_and_character(tmp_path)
    command = _san_command("preimage-restore-swap")
    inflight = executor._build_inflight(
        campaign,
        "inv1",
        [(command, executor._canonical_command_hash(command))],
    )
    inv_dir = campaign / "save" / "investigator-state"
    displaced_inv_dir = campaign / "save" / "investigator-state-displaced"
    inv_path = inv_dir / "inv1.json"
    inv_path.write_text(
        json.dumps({"investigator_id": "inv1", "current_san": 1}),
        encoding="utf-8",
    )
    outside = tmp_path / "outside-investigators"
    outside.mkdir()
    outside_sentinel = outside / "inv1.json"
    sentinel = b'{"outside": "preimage sentinel"}'
    outside_sentinel.write_bytes(sentinel)
    real_replace = executor.os.replace
    swapped = False

    def swap_parent_during_preimage_replace(src, dst, **kwargs):
        nonlocal swapped
        if Path(dst).name == "inv1.json" and not swapped:
            swapped = True
            real_replace(inv_dir, displaced_inv_dir)
            inv_dir.symlink_to(outside, target_is_directory=True)
            # Preserve the vulnerable absolute temp pathname so a path-based
            # replace demonstrably overwrites the external sentinel.
            if kwargs.get("src_dir_fd") is None:
                source_name = Path(src).name
                real_replace(displaced_inv_dir / source_name, outside / source_name)
        return real_replace(src, dst, **kwargs)

    monkeypatch.setattr(executor.os, "replace", swap_parent_during_preimage_replace)

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        executor._restore_inflight_targets(campaign, inflight)

    assert swapped is True
    assert exc_info.value.code == "unsafe_subsystem_transaction_path"
    assert exc_info.value.path == "save/investigator-state/inv1.json"
    assert outside_sentinel.read_bytes() == sentinel
    assert not list(outside.glob("*.tmp"))


def test_inflight_log_delete_is_dirfd_anchored_across_parent_swap(tmp_path, monkeypatch):
    executor = _executor("coc_subsystem_executor_log_delete_toctou")
    campaign, _character = _campaign_and_character(tmp_path)
    log_path = campaign / "logs" / "rolls.jsonl"
    log_path.unlink()
    command = _command(
        "log-delete-swap",
        "skill_check",
        payload={"skill": "Spot Hidden"},
    )
    inflight = executor._build_inflight(
        campaign,
        "inv1",
        [(command, executor._canonical_command_hash(command))],
    )
    log_path.write_text("uncommitted roll\n", encoding="utf-8")
    logs_dir = campaign / "logs"
    displaced_logs = campaign / "logs-displaced"
    outside = tmp_path / "outside-logs-delete"
    outside.mkdir()
    outside_sentinel = outside / "rolls.jsonl"
    sentinel = b'{"outside": "delete sentinel"}\n'
    outside_sentinel.write_bytes(sentinel)
    real_unlink = executor.os.unlink
    real_replace = executor.os.replace
    swapped = False

    def swap_parent_during_log_unlink(path, *args, **kwargs):
        nonlocal swapped
        if Path(path).name == "rolls.jsonl" and not swapped:
            swapped = True
            real_replace(logs_dir, displaced_logs)
            logs_dir.symlink_to(outside, target_is_directory=True)
        return real_unlink(path, *args, **kwargs)

    monkeypatch.setattr(executor.os, "unlink", swap_parent_during_log_unlink)

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        executor._restore_inflight_targets(campaign, inflight)

    assert swapped is True
    assert exc_info.value.code == "unsafe_subsystem_transaction_path"
    assert exc_info.value.path == "logs/rolls.jsonl"
    assert outside_sentinel.read_bytes() == sentinel


def test_inflight_log_truncate_is_dirfd_anchored_across_parent_swap(
    tmp_path,
    monkeypatch,
):
    executor = _executor("coc_subsystem_executor_log_truncate_toctou")
    campaign, _character = _campaign_and_character(tmp_path)
    log_path = campaign / "logs" / "rolls.jsonl"
    baseline = b'{"baseline": true}\n'
    log_path.write_bytes(baseline)
    command = _command(
        "log-truncate-swap",
        "skill_check",
        payload={"skill": "Spot Hidden"},
    )
    inflight = executor._build_inflight(
        campaign,
        "inv1",
        [(command, executor._canonical_command_hash(command))],
    )
    with log_path.open("ab") as handle:
        handle.write(b"uncommitted roll tail")
    logs_dir = campaign / "logs"
    displaced_logs = campaign / "logs-displaced"
    outside = tmp_path / "outside-logs-truncate"
    outside.mkdir()
    outside_sentinel = outside / "rolls.jsonl"
    sentinel = b'{"outside": "truncate sentinel must remain"}\n'
    outside_sentinel.write_bytes(sentinel)
    real_stat = executor.os.stat
    real_replace = executor.os.replace
    swapped = False

    def swap_parent_during_log_stat(path, *args, **kwargs):
        nonlocal swapped
        path_name = Path(path).name if isinstance(path, (str, Path)) else ""
        if path_name == "rolls.jsonl" and not swapped:
            swapped = True
            real_replace(logs_dir, displaced_logs)
            logs_dir.symlink_to(outside, target_is_directory=True)
        return real_stat(path, *args, **kwargs)

    monkeypatch.setattr(executor.os, "stat", swap_parent_during_log_stat)

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        executor._restore_inflight_targets(campaign, inflight)

    assert swapped is True
    assert exc_info.value.code == "unsafe_subsystem_transaction_path"
    assert exc_info.value.path == "logs/rolls.jsonl"
    assert outside_sentinel.read_bytes() == sentinel


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


def test_strict_san_mirror_failure_removes_new_identity_mirror(tmp_path, monkeypatch):
    executor = _executor("coc_subsystem_executor_strict_new_san_mirror")
    campaign, character = _campaign_and_character(tmp_path)
    inv_path = campaign / "save" / "investigator-state" / "inv1.json"
    inv_path.unlink()
    log_path = campaign / "logs" / "rolls.jsonl"
    log_before = log_path.read_bytes()
    rng = random.Random(137)
    rng_before = rng.getstate()
    real_write = executor.coc_sanity.coc_fileio.write_json_atomic

    def write_new_mirror_then_fail(path, payload, **kwargs):
        result = real_write(path, payload, **kwargs)
        if Path(path) == inv_path:
            persisted = json.loads(inv_path.read_text(encoding="utf-8"))
            assert persisted["schema_version"] == 1
            assert persisted["investigator_id"] == "inv1"
            raise OSError("injected failure after new identity mirror write")
        return result

    monkeypatch.setattr(
        executor.coc_sanity.coc_fileio,
        "write_json_atomic",
        write_new_mirror_then_fail,
    )

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        _execute(executor, campaign, character, [_san_command("san-new-mirror-fail")], rng)

    assert exc_info.value.code == "subsystem_transaction_failed"
    assert rng.getstate() == rng_before
    assert not inv_path.exists()
    assert not (campaign / "save" / "sanity.json").exists()
    assert not executor.coc_sanity.sanity_snapshot_path(
        campaign, "inv1"
    ).exists()
    assert log_path.read_bytes() == log_before
    state = json.loads(
        (campaign / "save" / "subsystem-state.json").read_text(encoding="utf-8")
    )
    assert state["applied_command_ids"] == []
    assert state["inflight"] is None


def test_bout_time_log_is_rolled_back_when_strict_san_mirror_fails(tmp_path, monkeypatch):
    executor = _executor("coc_subsystem_executor_san_time_log_rollback")
    campaign, character = _campaign_and_character(tmp_path)
    sheet = json.loads(character.read_text(encoding="utf-8"))
    sheet["characteristics"]["POW"] = 99
    sheet["characteristics"]["INT"] = 99
    sheet["derived"]["SAN"] = 99
    character.write_text(json.dumps(sheet), encoding="utf-8")
    command = _san_command("san-bout-time-log")
    command["payload"]["san_loss_success"] = 5
    command["payload"]["san_loss_fail_expr"] = "5"

    state_path = campaign / "save" / "subsystem-state.json"
    state_path.write_text(
        json.dumps(executor._default_state(), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    time_log = campaign / "logs" / "time.jsonl"
    time_log.write_text('{"baseline": true}\n', encoding="utf-8")
    tracked = [
        state_path,
        campaign / "save" / "sanity.json",
        campaign / "save" / "investigator-state" / "inv1.json",
        campaign / "save" / "time-state.json",
        campaign / "save" / "time-triggers.json",
        campaign / "logs" / "rolls.jsonl",
        time_log,
    ]
    before = {path: path.read_bytes() if path.exists() else None for path in tracked}
    rng = random.Random(1)
    rng_before = rng.getstate()
    scheduled = []
    real_schedule = executor.coc_sanity.coc_time.schedule_trigger
    real_write = executor.coc_sanity.coc_fileio.write_json_atomic

    def schedule_with_audit(campaign_dir, trigger):
        trigger_id = real_schedule(campaign_dir, trigger)
        scheduled.append(trigger_id)
        with time_log.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps({"event_type": "sanity_trigger_scheduled", "id": trigger_id}) + "\n")
        return trigger_id

    def fail_investigator_mirror(path, payload, **kwargs):
        if Path(path) == campaign / "save" / "investigator-state" / "inv1.json":
            raise OSError("injected strict investigator mirror failure")
        return real_write(path, payload, **kwargs)

    monkeypatch.setattr(executor.coc_sanity.coc_time, "schedule_trigger", schedule_with_audit)
    monkeypatch.setattr(executor.coc_sanity.coc_fileio, "write_json_atomic", fail_investigator_mirror)

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        _execute(executor, campaign, character, [command], rng)

    assert scheduled, "expected 5+ SAN loss to schedule a bout recovery trigger"
    assert exc_info.value.code == "subsystem_transaction_failed"
    assert rng.getstate() == rng_before
    assert {path: path.read_bytes() if path.exists() else None for path in tracked} == before


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


def test_unreleased_schema_v1_state_is_explicitly_rejected_not_reinterpreted(tmp_path):
    executor = _executor("coc_subsystem_executor_schema_v1_reject")
    campaign, character = _campaign_and_character(tmp_path)
    state_path = campaign / "save" / "subsystem-state.json"
    schema_v1 = {
        "schema_version": 1,
        "applied_command_ids": [],
        "command_hashes": {},
        "result_snapshots": {},
        "pending_choices": {},
        "inflight": None,
    }
    state_path.write_text(json.dumps(schema_v1), encoding="utf-8")
    before = state_path.read_bytes()

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        _execute(executor, campaign, character, [], random.Random(133))

    assert exc_info.value.code == "malformed_subsystem_state"
    assert "schema v1 cannot be migrated without command provenance" in exc_info.value.message
    assert state_path.read_bytes() == before


def test_pending_choice_must_deep_match_its_applied_snapshot(tmp_path):
    executor = _executor("coc_subsystem_executor_mismatched_pending")
    campaign, character = _campaign_and_character(tmp_path)
    _persist_failed_pushable_roll(executor, campaign, character)
    result = _execute(
        executor,
        campaign,
        character,
        [_valid_push_offer(command_id="push-mismatch")],
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


def test_roll_command_requires_character_id_to_match_investigator(tmp_path):
    executor = _executor("coc_subsystem_executor_character_identity")
    campaign, character = _campaign_and_character(tmp_path)
    sheet = json.loads(character.read_text(encoding="utf-8"))
    sheet["id"] = "inv2"
    character.write_text(json.dumps(sheet), encoding="utf-8")
    rng = random.Random(123)
    rng_before = rng.getstate()

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        _execute(
            executor,
            campaign,
            character,
            [_command("wrong-character", "skill_check", payload={"skill": "Spot Hidden"})],
            rng,
        )

    assert exc_info.value.code == "character_identity_mismatch"
    assert exc_info.value.path == "character_path.id"
    assert rng.getstate() == rng_before
    assert not (campaign / "save" / "subsystem-state.json").exists()


def test_replay_is_bound_to_original_investigator_and_stable_character_id(tmp_path):
    executor = _executor("coc_subsystem_executor_replay_actor")
    campaign, character = _campaign_and_character(tmp_path)
    command = _command(
        "actor-bound-roll",
        "skill_check",
        payload={"decision_id": "actor-bound", "skill": "Spot Hidden"},
    )
    original = _execute(executor, campaign, character, [command], random.Random(124))
    state_path = campaign / "save" / "subsystem-state.json"
    state_before = state_path.read_bytes()
    log_before = (campaign / "logs" / "rolls.jsonl").read_bytes()

    inv2_character = tmp_path / "investigators" / "inv2" / "character.json"
    inv2_character.parent.mkdir(parents=True)
    inv2_sheet = json.loads(character.read_text(encoding="utf-8"))
    inv2_sheet["id"] = "inv2"
    inv2_character.write_text(json.dumps(inv2_sheet), encoding="utf-8")
    rng = random.Random(125)
    rng_before = rng.getstate()

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        executor.execute_commands(
            campaign,
            inv2_character,
            "inv2",
            [command],
            rng=rng,
        )

    assert exc_info.value.code == "command_provenance_mismatch"
    assert exc_info.value.path == "commands[0]"
    assert rng.getstate() == rng_before
    assert state_path.read_bytes() == state_before
    assert (campaign / "logs" / "rolls.jsonl").read_bytes() == log_before

    # Mutable progression is legitimate: identity, not a whole-sheet hash,
    # binds replay.
    progressed = json.loads(character.read_text(encoding="utf-8"))
    progressed["skills"]["Spot Hidden"] = 70
    character.write_text(json.dumps(progressed), encoding="utf-8")
    assert _execute(executor, campaign, character, [command], random.Random(126)) == original


def test_sanity_and_investigator_state_identity_must_match_requested_actor(tmp_path):
    executor = _executor("coc_subsystem_executor_sanity_actor")
    campaign, character = _campaign_and_character(tmp_path)
    sanity_path = campaign / "save" / "sanity.json"
    wrong_session = executor.coc_sanity.SanitySession(
        "inv2",
        san_max=55,
        int_value=70,
        rng=random.Random(127),
        campaign_dir=campaign,
    )
    sanity_path.write_text(json.dumps(wrong_session.snapshot()), encoding="utf-8")
    rng = random.Random(128)
    rng_before = rng.getstate()

    with pytest.raises(executor.SubsystemExecutorError) as sanity_exc:
        _execute(executor, campaign, character, [_san_command("san-wrong-actor")], rng)

    assert sanity_exc.value.code == "malformed_sanity_state"
    assert sanity_exc.value.path == "save/sanity.json.investigator_id"
    assert rng.getstate() == rng_before
    assert json.loads(sanity_path.read_text(encoding="utf-8"))["investigator_id"] == "inv2"
    assert not (campaign / "save" / "subsystem-state.json").exists()

    sanity_path.unlink()
    valid_legacy = executor.coc_sanity.SanitySession(
        "inv1",
        san_max=55,
        int_value=70,
        rng=random.Random(129),
        campaign_dir=campaign,
    )
    sanity_path.write_text(
        json.dumps(valid_legacy.snapshot()), encoding="utf-8"
    )
    canonical_sanity = executor.coc_sanity.sanity_snapshot_path(
        campaign, "inv1"
    )
    assert not canonical_sanity.exists()
    investigator_path = campaign / "save" / "investigator-state" / "inv1.json"
    investigator = json.loads(investigator_path.read_text(encoding="utf-8"))
    investigator["investigator_id"] = "inv2"
    investigator_path.write_text(json.dumps(investigator), encoding="utf-8")

    with pytest.raises(executor.SubsystemExecutorError) as investigator_exc:
        _execute(executor, campaign, character, [_san_command("inv-state-wrong-actor")], rng)

    assert investigator_exc.value.code == "malformed_investigator_state"
    assert investigator_exc.value.path.endswith("inv1.json.investigator_id")
    assert rng.getstate() == rng_before
    # Validation is read-only; the one-time legacy migration happens only
    # inside the subsequently journalled SAN transaction.
    assert not canonical_sanity.exists()
    assert not (campaign / "save" / "subsystem-state.json").exists()


def test_first_structured_san_creates_identity_bound_investigator_mirror(tmp_path):
    executor = _executor("coc_subsystem_executor_first_san_mirror_identity")
    campaign, character = _campaign_and_character(tmp_path)
    investigator_path = campaign / "save" / "investigator-state" / "inv1.json"
    investigator_path.unlink()

    first = _execute(
        executor,
        campaign,
        character,
        [_san_command("first-san-without-mirror")],
        random.Random(134),
    )[0]
    second = _execute(
        executor,
        campaign,
        character,
        [_san_command("second-san-after-mirror")],
        random.Random(135),
    )[0]

    mirror = json.loads(investigator_path.read_text(encoding="utf-8"))
    assert first["status"] == "completed"
    assert second["status"] == "completed"
    assert mirror["schema_version"] == 1
    assert mirror["investigator_id"] == "inv1"
    assert isinstance(mirror["current_san"], int)


def test_linked_second_investigator_sanity_starts_from_sheet_and_stays_identity_bound(
    tmp_path,
):
    executor = _executor("coc_subsystem_executor_party_sanity_identity")
    campaign, inv1_character = _campaign_and_character(tmp_path)
    (campaign / "party.json").write_text(json.dumps({
        "schema_version": 1,
        "investigator_ids": ["inv1", "inv2"],
    }), encoding="utf-8")

    # The first investigator claims the legacy singleton and also receives a
    # canonical identity-bound snapshot.
    _execute(
        executor,
        campaign,
        inv1_character,
        [_san_command("party-san-inv1")],
        random.Random(140),
    )
    legacy_path = campaign / "save" / "sanity.json"
    legacy_before = legacy_path.read_bytes()
    assert json.loads(legacy_before)["investigator_id"] == "inv1"

    # The legacy owner may leave before the new linked investigator's first
    # SAN use.  The old singleton remains inv1's mirror and must not block or
    # seed inv2 merely because inv1 is no longer in the active party.
    (campaign / "party.json").write_text(json.dumps({
        "schema_version": 1,
        "investigator_ids": ["inv2"],
    }), encoding="utf-8")

    inv2_character = tmp_path / "investigators" / "inv2" / "character.json"
    inv2_character.parent.mkdir(parents=True)
    inv2_character.write_text(json.dumps({
        "schema_version": 1,
        "id": "inv2",
        "characteristics": {"STR": 50, "INT": 60, "POW": 42},
        "derived": {"SAN": 42},
        "skills": {"Spot Hidden": 50, "Dodge": 30},
    }), encoding="utf-8")
    inv2_state = campaign / "save" / "investigator-state" / "inv2.json"
    inv2_state.write_text(json.dumps({
        "schema_version": 1,
        "investigator_id": "inv2",
        "current_san": 42,
    }), encoding="utf-8")

    first = executor.execute_commands(
        campaign,
        inv2_character,
        "inv2",
        [_san_command("party-san-inv2-first")],
        rng=random.Random(141),
    )[0]
    inv2_snapshot_path = executor.coc_sanity.sanity_snapshot_path(
        campaign, "inv2"
    )
    inv2_first = json.loads(inv2_snapshot_path.read_text(encoding="utf-8"))
    assert first["status"] == "completed"
    assert inv2_first["investigator_id"] == "inv2"
    assert inv2_first["san_max"] == 42
    assert inv2_first["san_current"] <= 42
    assert legacy_path.read_bytes() == legacy_before

    second = executor.execute_commands(
        campaign,
        inv2_character,
        "inv2",
        [_san_command("party-san-inv2-second")],
        rng=random.Random(142),
    )[0]
    inv2_second = json.loads(inv2_snapshot_path.read_text(encoding="utf-8"))
    second_sanity_event = next(
        event for event in second["events"]
        if event.get("event_type") == "sanity"
    )
    assert second_sanity_event["san_before"] == inv2_first["san_current"]
    assert inv2_second["san_max"] == 42
    assert inv2_second["san_current"] <= inv2_first["san_current"]
    assert legacy_path.read_bytes() == legacy_before


def test_persisted_pending_choice_survives_empty_batch_and_blocks_new_commands(tmp_path):
    executor = _executor("coc_subsystem_executor_pending_query")
    campaign, character = _campaign_and_character(tmp_path)
    _persist_failed_pushable_roll(executor, campaign, character)
    offered = _execute(
        executor,
        campaign,
        character,
        [_valid_push_offer(command_id="push-persisted")],
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
    _persist_failed_pushable_roll(executor, campaign, character)
    command_id = "p" * 128
    result = _execute(
        executor,
        campaign,
        character,
        [_valid_push_offer(command_id=command_id)],
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
    _persist_failed_pushable_roll(executor, campaign, character)
    rng = random.Random(119)
    rng_before = rng.getstate()
    log_path = campaign / "logs" / "rolls.jsonl"
    log_before = log_path.read_bytes()
    state_path = campaign / "save" / "subsystem-state.json"
    state_before = state_path.read_bytes()

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        _execute(
            executor,
            campaign,
            character,
            [
                _valid_push_offer(command_id="push-one"),
                _valid_push_offer(command_id="push-two"),
            ],
            rng,
        )

    assert exc_info.value.code == "multiple_pending_choices"
    assert exc_info.value.path == "commands"
    assert rng.getstate() == rng_before
    assert state_path.read_bytes() == state_before
    assert log_path.read_bytes() == log_before


def test_normalize_rejects_forged_or_mismatched_executor_envelopes(tmp_path):
    executor = _executor("coc_subsystem_executor_provenance")
    campaign, character = _campaign_and_character(tmp_path)
    command = _command("trusted-result", "skill_check", payload={"skill": "Spot Hidden"})
    trusted = _execute(
        executor,
        campaign,
        character,
        [command],
        random.Random(115),
    )
    forged = json.loads(json.dumps(trusted))
    forged[0]["events"][0]["success"] = not forged[0]["events"][0]["success"]

    with pytest.raises(executor.SubsystemExecutorError) as exc_info:
        executor.normalize_rule_results(
            forged,
            campaign_dir=campaign,
            expected_commands=[command],
            investigator_id="inv1",
            decision_id=None,
            results_mode="normalized",
        )

    assert exc_info.value.code == "untrusted_subsystem_result"
    assert exc_info.value.path == "rules_results[0]"
    with pytest.raises(executor.SubsystemExecutorError) as missing_context:
        executor.normalize_rule_results(
            trusted,
            campaign_dir=campaign,
            results_mode="normalized",
        )
    assert missing_context.value.code == "untrusted_subsystem_result"
    assert executor.normalize_rule_results(
        trusted,
        campaign_dir=campaign,
        expected_commands=[command],
        investigator_id="inv1",
        decision_id=None,
        results_mode="normalized",
    ) == trusted[0]["events"]

    with pytest.raises(executor.SubsystemExecutorError) as duplicate_exc:
        executor.normalize_rule_results(
            [trusted[0], json.loads(json.dumps(trusted[0]))],
            campaign_dir=campaign,
            expected_commands=[command],
            investigator_id="inv1",
            decision_id=None,
            results_mode="normalized",
        )
    assert duplicate_exc.value.code == "untrusted_subsystem_result"
    assert duplicate_exc.value.path == "rules_results[1]"

    partial = json.loads(json.dumps(trusted[0]))
    partial.pop("status")
    with pytest.raises(executor.SubsystemExecutorError) as partial_exc:
        executor.normalize_rule_results(
            [partial],
            campaign_dir=campaign,
            expected_commands=[command],
            investigator_id="inv1",
            decision_id=None,
            results_mode="normalized",
        )
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
        _execute(
            executor,
            campaign,
            character,
            [_command("cmd-1", "skill_check", payload={"skill": "Spot Hidden"})],
            rng,
        )

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
def test_every_legacy_request_kind_runs_through_executor(
    tmp_path,
    kind,
    legacy_request,
):
    executor = _executor(f"coc_subsystem_executor_compat_{kind}")
    campaign, character = _campaign_and_character(tmp_path)
    plan = {
        "decision_id": f"turn-{kind}",
        "rules_requests": [{"kind": kind, **legacy_request}],
    }

    commands = executor.commands_from_rules_requests(plan)
    normalized = _execute(executor, campaign, character, commands, random.Random(44))
    events = executor.flatten_result_events(normalized)

    assert len(commands) == 1
    assert set(normalized[0]) == RESULT_KEYS
    assert normalized[0]["kind"] == kind
    assert normalized[0]["status"] == "completed"
    assert events[0]["kind"] == kind
    assert isinstance(events[0]["success"], bool)
