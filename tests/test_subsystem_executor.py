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
        "chase-end", "chase_end", phase="end", payload={"decision_id": "chase-journey",
        "revision": 7, "outcome": "escaped"})], rng=random.Random(9))
    assert ended[0]["events"][0]["event_type"] == "chase_ended"
    assert json.loads(chase_path.read_text())["outcome"] == "escaped"


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
    ended = _execute(executor, campaign, character, [_command(
        "end-with-choice", "chase_end", phase="end", payload={"decision_id": "end-choice",
        "revision": 1, "outcome": "concluded"})], random.Random(3))[0]
    assert ended["events"][0]["cancelled_choice_id"] == offered["pending_choice"]["choice_id"]
    assert executor.get_current_pending_choice(campaign) is None
    state = json.loads((campaign / "save" / "subsystem-state.json").read_text())
    assert not state["pending_choices"] and not state["pending_contexts"]


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


def test_combat_start_rejects_forged_investigator_hp(tmp_path):
    executor = _executor("coc_subsystem_executor_combat_start_mirror")
    campaign, character = _campaign_and_character(tmp_path)
    inv_path = campaign / "save" / "investigator-state" / "inv1.json"
    inv = json.loads(inv_path.read_text(encoding="utf-8"))
    inv.update({"current_hp": 3, "conditions": ["major_wound"]})
    inv_path.write_text(json.dumps(inv), encoding="utf-8")
    with pytest.raises(executor.SubsystemExecutorError, match="combat participant must match"):
        _execute(executor, campaign, character, [_combat_start_command()], random.Random(1))


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
    inv.update({"current_hp": 7, "conditions": ["major_wound"]})
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
        (1, "hard", "push_origin_not_failed"),
        (23, "fumble", "push_origin_fumble"),
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

    assert exc_info.value.code == "push_origin_ineligible"
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
    investigator_path = campaign / "save" / "investigator-state" / "inv1.json"
    investigator = json.loads(investigator_path.read_text(encoding="utf-8"))
    investigator["investigator_id"] = "inv2"
    investigator_path.write_text(json.dumps(investigator), encoding="utf-8")

    with pytest.raises(executor.SubsystemExecutorError) as investigator_exc:
        _execute(executor, campaign, character, [_san_command("inv-state-wrong-actor")], rng)

    assert investigator_exc.value.code == "malformed_investigator_state"
    assert investigator_exc.value.path.endswith("inv1.json.investigator_id")
    assert rng.getstate() == rng_before
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
