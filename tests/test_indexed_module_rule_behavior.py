"""Behavioral traceability for indexed monster and module rules.

These tests deliberately exercise existing public runtime seams.  They do not
invent a second module-rules executor: authored rows supply parameters and the
canonical SAN or environmental-damage runtime performs the settlement.
"""
from __future__ import annotations

import json
import random
import sys
from pathlib import Path


REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import coc_hazards  # noqa: E402
import coc_rules  # noqa: E402
import coc_rulesets  # noqa: E402
import coc_sanity  # noqa: E402
import coc_story_director  # noqa: E402
import coc_subsystem_executor  # noqa: E402


def _san_campaign(tmp_path: Path, *, san: int) -> tuple[Path, Path]:
    campaign = tmp_path / "campaign"
    (campaign / "scenario").mkdir(parents=True)
    (campaign / "save" / "investigator-state").mkdir(parents=True)
    (campaign / "logs").mkdir(parents=True)
    character_dir = tmp_path / "investigators" / "inv"
    character_dir.mkdir(parents=True)
    character = {
        "schema_version": 1,
        "id": "inv",
        "name": "Rule Trace Investigator",
        "era": "1920s",
        "characteristics": {
            "STR": 50,
            "CON": 50,
            "SIZ": 50,
            "DEX": 50,
            "APP": 50,
            "INT": 50,
            "POW": san,
            "EDU": 50,
        },
        "derived": {
            "HP": 10,
            "MP": max(0, san // 5),
            "SAN": san,
            "MOV": 8,
            "damage_bonus": 0,
            "build": 0,
            "Luck": 50,
        },
        "skills": {"Spot Hidden": 50},
    }
    character_path = character_dir / "character.json"
    character_path.write_text(json.dumps(character), encoding="utf-8")
    (campaign / "save" / "world-state.json").write_text(
        json.dumps({
            "active_scene_id": "monster-reveal",
            "discovered_clue_ids": [],
            "san_triggers_fired": [],
        }),
        encoding="utf-8",
    )
    (campaign / "save" / "pacing-state.json").write_text(
        json.dumps({"tension_level": "low", "turn_number": 0}),
        encoding="utf-8",
    )
    (campaign / "save" / "investigator-state" / "inv.json").write_text(
        json.dumps({
            "investigator_id": "inv",
            "current_san": san,
            "indefinite_insane": False,
        }),
        encoding="utf-8",
    )
    return campaign, character_path


def _director_context(scene: dict) -> dict:
    return {
        "active_scene": scene,
        "active_scene_id": scene["scene_id"],
        "rule_signals": {
            "bout_active": False,
            "sanity_state": "stable",
            "hp_state": "healthy",
            "stalled_turns": 0,
        },
        "player_intent_class": "investigate",
        "world_state": {
            "discovered_clue_ids": [],
            "san_triggers_fired": [],
        },
        "threat_fronts": {"fronts": []},
        "clue_graph": {"conclusions": []},
        "module_meta": {},
        "story_graph": {"scenes": [scene]},
        "npc_agendas": {"npcs": []},
        "pacing_state": {},
        "player_intent_rich": None,
        "investigator_id": "inv",
        "time_signals": {},
        "sanity_engine_state": None,
        "chase_state": None,
    }


def _white_war_document(name: str) -> dict:
    path = (
        REPO / "plugins" / "coc-keeper" / "references"
        / "starter-scenarios" / "the-white-war" / name
    )
    return json.loads(path.read_text(encoding="utf-8"))


def test_white_war_polyp_san_source_row_drives_existing_threat_path(
    tmp_path: Path,
) -> None:
    story = _white_war_document("story-graph.json")
    scene = next(
        row for row in story["scenes"]
        if row["scene_id"] == "blizzard-withdrawal"
    )
    ctx = _director_context(scene)
    ctx["module_meta"] = {"scenario_id": "the-white-war"}
    ctx["story_graph"] = story

    requests = coc_story_director._build_rules_requests(
        ctx, "REVEAL", {"clue_type": "obvious"}
    )
    request = next(row for row in requests if row.get("kind") == "sanity_check")
    assert request["creature_type"] == "polyp_horror"
    assert request["san_loss_success"] == "1D6"
    assert request["san_loss_fail_expr"] == "1D12"
    assert request["rule_ref"] == "module.white_war.polyp_horror"

    campaign, character_path = _san_campaign(tmp_path, san=1)
    commands = coc_subsystem_executor.commands_from_rules_requests({
        "decision_id": "white-war-polyp-san-trace",
        "rules_requests": [request],
    })
    normalized = coc_subsystem_executor.execute_commands(
        campaign,
        character_path,
        "inv",
        commands,
        rng=random.Random(2),
    )
    events = coc_subsystem_executor.flatten_result_events(normalized)
    check = next(row for row in events if row.get("kind") == "sanity_check")
    assert check["san_loss_expression"] == "1D12"
    assert check["rule_ref"] == "module.white_war.polyp_horror"
    persisted = [
        json.loads(line)["payload"]
        for line in (campaign / "logs" / "rolls.jsonl").read_text(
            encoding="utf-8"
        ).splitlines()
        if line.strip()
    ]
    roll = next(row for row in persisted if row.get("kind") == "sanity_check")
    assert roll["san_loss_expression"] == "1D12"
    assert roll["rule_ref"] == "module.white_war.polyp_horror"


def test_white_war_daylight_row_modifies_structured_threat_values() -> None:
    story = _white_war_document("story-graph.json")
    scene = next(
        row for row in story["scenes"]
        if row["scene_id"] == "dawn-counterstroke"
    )
    ctx = _director_context(scene)
    ctx["module_meta"] = {"scenario_id": "the-white-war"}
    ctx["story_graph"] = story
    ctx["threat_fronts"] = _white_war_document("threat-fronts.json")
    ctx["player_intent_class"] = "fight"
    ctx["time_signals"] = {"day_phase": "morning", "is_night": False}

    requests = coc_story_director._build_rules_requests(ctx, "SUBSYSTEM")
    wind = next(
        row for row in requests
        if row.get("kind") == "opposed_check"
        and row.get("attack_name") == "wind blast"
    )
    assert wind["opposed_target_percent"] == 79
    assert wind["opponent_value"] == 79
    assert wind["modifier_evidence"] == {
        "kind": "flat_target_percent",
        "value": -20,
        "rule_ref": "module.white_war.daylight_penalty",
        "creature_rule_ref": "module.white_war.polyp_horror",
    }
    settled = coc_rulesets.get_resolver({"ruleset_id": "coc7"}).opposed(
        50, wind["opponent_value"], rng=random.Random(11)
    )
    assert settled["opponent_roll"]["base_target"] == 79
    tentacle = next(
        row for row in ctx["combat_reaction_advisories"]
        if row.get("attack_name") == "tentacle slash"
    )
    assert tentacle["attack_target_percent"] == 40
    assert tentacle["modifier_evidence"]["rule_ref"] == (
        "module.white_war.daylight_penalty"
    )

    ctx["time_signals"] = {"day_phase": "night", "is_night": True}
    requests = coc_story_director._build_rules_requests(ctx, "SUBSYSTEM")
    night_wind = next(
        row for row in requests
        if row.get("kind") == "opposed_check"
        and row.get("attack_name") == "wind blast"
    )
    assert night_wind["opposed_target_percent"] == 99
    assert "modifier_evidence" not in night_wind


def test_byakhee_san_row_flows_through_threat_request_and_sanity_session(
    tmp_path: Path,
) -> None:
    """A concrete monsters.json row reaches canonical SAN settlement."""
    monster = coc_rules.monster_by_name("Byakhee")
    rule_ref = coc_rules.resolve_rule_refs(["core.monsters.san_loss"])[0]
    assert rule_ref["source_table"] == "monsters.json"
    assert monster["san_loss"] == {"success": "1", "failure": "1D6"}

    source = f"Byakhee sighting [{rule_ref['id']}]"
    scene = {
        "scene_id": "monster-reveal",
        "on_enter": {
            "san_triggers": [{
                "trigger_id": "monster-byakhee-san",
                "source": source,
                "san_loss_success": int(monster["san_loss"]["success"]),
                "san_loss_fail_expr": monster["san_loss"]["failure"],
                "creature_type": "Byakhee",
                "involuntary_action": {
                    "kind": "freeze",
                    "summary": "stops short at the impossible wingbeats",
                },
            }],
        },
    }
    requests = coc_story_director._build_rules_requests(
        _director_context(scene), "REVEAL", {"clue_type": "obvious"}
    )
    assert len(requests) == 1
    assert requests[0]["san_loss_success"] == 1
    assert requests[0]["san_loss_fail_expr"] == "1D6"
    assert requests[0]["source"] == source

    campaign, character_path = _san_campaign(tmp_path, san=1)
    commands = coc_subsystem_executor.commands_from_rules_requests({
        "decision_id": "monster-san-trace",
        "rules_requests": requests,
    })
    normalized = coc_subsystem_executor.execute_commands(
        campaign,
        character_path,
        "inv",
        commands,
        rng=random.Random(2),
    )
    events = coc_subsystem_executor.flatten_result_events(normalized)
    check = next(row for row in events if row.get("kind") == "sanity_check")

    assert check["source"] == source
    assert check["san_trigger_id"] == "monster-byakhee-san"
    assert check["san_loss_expression"] == "1D6"
    assert 1 <= check["san_loss"] <= 6
    assert check["san_after"] == 0
    public_rolls = [
        json.loads(line)["payload"]
        for line in (campaign / "logs" / "rolls.jsonl").read_text(
            encoding="utf-8"
        ).splitlines()
        if line.strip()
    ]
    persisted = next(row for row in public_rolls if row.get("kind") == "sanity_check")
    assert persisted["source"] == source
    assert persisted["san_trigger_id"] == "monster-byakhee-san"
    assert persisted["san_loss_expression"] == "1D6"


def test_haunting_corbitt_summary_rule_drives_sanity_summary_bout() -> None:
    rule = coc_rules.module_rules("the-haunting")["rules"][
        "corbitt_summary_bout"
    ]
    assert rule["source_rule_id"] == "module.haunting.corbitt_summary_bout"
    assert rule["summary_table"] == "table_viii_summary"

    session = coc_sanity.SanitySession(
        "inv", san_max=50, int_value=100, rng=random.Random(4)
    )
    session.apply_direct_loss(
        source=rule["source_rule_id"],
        loss_expr="5",
        alone=rule["alone_uses_summary_table"],
        module_bout_override={
            "force_mode": "summary",
            "result_description": (
                f"module summary table result {rule['playtest_summary_result']}"
            ),
        },
    )

    assert session.bouts_of_madness
    bout = session.bouts_of_madness[-1]
    assert bout["source"] == rule["source_rule_id"]
    assert bout["mode"] == "summary"
    assert bout["summary_table"] == rule["summary_table"]
    assert bout["bout_result"] == "module summary table result 4"
    assert session.bout_active is False


def _participant(*, hp: int = 100) -> dict:
    return {
        "id": "inv",
        "current_hp": hp,
        "hp_max": hp,
        "con": 60,
        "conditions": [],
    }


def test_white_war_cold_exposure_uses_environmental_damage_runtime() -> None:
    rule = coc_rules.module_rules("the-white-war")["rules"]["cold_exposure"]
    participant = _participant()

    event = coc_hazards.apply_other_damage(
        participant,
        damage_expr=rule["hp_damage_per_interval"],
        source=rule["source_rule_id"],
        rng=random.Random(7),
    )

    assert rule["interval_minutes"] == 5
    assert event["source"] == "module.white_war.cold_exposure"
    assert event["damage_expr"] == "1D8"
    assert 1 <= event["raw_damage"] <= 8
    assert event["hp_delta"] == -event["raw_damage"]
    assert event["bypass_armor"] is True


def test_white_war_avalanche_uses_environmental_damage_runtime() -> None:
    rule = coc_rules.module_rules("the-white-war")["rules"][
        "avalanche_damage"
    ]
    participant = _participant()

    event = coc_hazards.apply_other_damage(
        participant,
        damage_expr=rule["damage"],
        source=rule["source_rule_id"],
        rng=random.Random(8),
    )

    assert rule["entity_not_immune"] is True
    assert event["source"] == "module.white_war.avalanche_damage"
    assert event["damage_expr"] == "10D6"
    assert len(event["damage_roll"]["rolls"]) == 10
    assert 10 <= event["raw_damage"] <= 60
    assert event["hp_delta"] == -event["raw_damage"]


def test_haunting_scene_damage_rows_use_environmental_damage_runtime() -> None:
    rules = coc_rules.module_rules("the-haunting")["rules"]
    cases = (
        ("bed_attack_damage", "1D6+2", "failed_dodge_after_spot_hidden"),
        ("basement_search_damage", "1D4+2", "failed_pushed_spot_hidden"),
    )

    for index, (rule_name, expected_die, expected_precondition) in enumerate(cases):
        rule = rules[rule_name]
        participant = _participant()
        event = coc_hazards.apply_other_damage(
            participant,
            damage_expr=rule["damage_die"],
            source=rule["source_rule_id"],
            rng=random.Random(20 + index),
        )

        assert rule["precondition"] == expected_precondition
        assert event["source"] == f"module.haunting.{rule_name}"
        assert event["damage_expr"] == expected_die
        assert event["hp_delta"] == -event["raw_damage"]
        assert event["bypass_armor"] is True
