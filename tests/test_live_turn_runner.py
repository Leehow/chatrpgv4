"""Tests for the live Keeper turn runner.

These cover the production/live path rather than the offline playtest driver:
one player input should run through the director/enrichment/rules/apply stack,
default to fast background recording, and compress low-agency continuation until
the next real interrupt.
"""
import importlib.util
import json
import os
import random
import time
from pathlib import Path

import pytest



def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, rel)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


live_runner = _load("coc_live_turn_runner", "plugins/coc-keeper/scripts/coc_live_turn_runner.py")


def _build_live_campaign(tmp_path):
    camp = tmp_path / "campaigns" / "live"
    scn = camp / "scenario"
    save = camp / "save"
    logs = camp / "logs"
    (save / "investigator-state").mkdir(parents=True)
    scn.mkdir(parents=True)
    logs.mkdir(parents=True)
    (logs / "events.jsonl").write_text("")
    (logs / "rolls.jsonl").write_text("")
    (save / "world-state.json").write_text(json.dumps({
        "schema_version": 1,
        "campaign_id": "live",
        "scenario_id": "live-mod",
        "active_scene_id": "scene-1",
        "discovered_clue_ids": [],
        "major_decisions": [],
    }))
    (save / "pacing-state.json").write_text(json.dumps({
        "schema_version": 1,
        "tension_level": "low",
        "lethal_chances_used": 0,
        "recent_intent_classes": [],
        "turn_number": 0,
        "luck_spent_last": 0,
    }))
    (save / "investigator-state" / "inv1.json").write_text(json.dumps({
        "schema_version": 1,
        "campaign_id": "live",
        "investigator_id": "inv1",
        "current_hp": 12,
        "current_san": 55,
        "current_mp": 11,
        "conditions": [],
        "skill_checks_earned": [],
    }))
    char_dir = tmp_path / "investigators" / "inv1"
    char_dir.mkdir(parents=True)
    char_path = char_dir / "character.json"
    char_path.write_text(json.dumps({
        "schema_version": 1,
        "id": "inv1",
        "occupation": "Antiquarian",
        "era": "1920s",
        "characteristics": {
            "STR": 60,
            "CON": 55,
            "SIZ": 65,
            "DEX": 50,
            "APP": 45,
            "INT": 70,
            "POW": 55,
            "EDU": 75,
            "LUCK": 55,
        },
        "derived": {"HP": 12, "MP": 11, "SAN": 55, "MOV": 7},
        "skills": {"Spot Hidden": 60, "Library Use": 55, "Credit Rating": 50},
        "backstory": {},
    }))
    (scn / "story-graph.json").write_text(json.dumps({"scenes": [
        {
            "scene_id": "scene-1",
            "scene_type": "investigation",
            "dramatic_question": "Can the investigator find the first lead?",
            "entry_conditions": [],
            "exit_conditions": ["c1 discovered"],
            "available_clues": ["c1"],
            "npc_ids": [],
            "pressure_moves": [],
            "tone": ["tense"],
            "allowed_improvisation": [],
        },
        {
            "scene_id": "scene-2",
            "scene_type": "investigation",
            "dramatic_question": "What happens after the first lead?",
            "entry_conditions": [],
            "exit_conditions": [],
            "available_clues": [],
            "npc_ids": [],
            "pressure_moves": [],
            "tone": ["tense"],
            "allowed_improvisation": [],
        },
    ]}))
    (scn / "clue-graph.json").write_text(json.dumps({"conclusions": [{
        "conclusion_id": "conclusion-1",
        "importance": "critical",
        "minimum_routes": 1,
        "clues": [{"clue_id": "c1", "delivery": "Handout", "delivery_kind": "handout", "visibility": "player-safe"}],
        "fallback_policy": "",
    }]}))
    (scn / "npc-agendas.json").write_text(json.dumps({"npcs": []}))
    (scn / "threat-fronts.json").write_text(json.dumps({"fronts": []}))
    (scn / "pacing-map.json").write_text(json.dumps({"pacing_curve": []}))
    (scn / "improvisation-boundaries.json").write_text(json.dumps({
        "invent_allowed": [],
        "never_invent": [],
        "keeper_secrets": [],
    }))
    (scn / "module-meta.json").write_text(json.dumps({
        "schema_version": 1,
        "scenario_id": "live-mod",
        "structure_type": "linear_acts",
        "era": "1920s",
        "content_flags": [],
        "win_condition": "continue live play",
    }))
    return camp, char_path


def _persist_live_push_offer(camp: Path, char_path: Path) -> dict:
    executor = live_runner.subsystem_executor
    origin = {
        "command_id": "live-push-origin",
        "kind": "skill_check",
        "phase": "resolve",
        "payload": {
            "decision_id": "live-push-origin-decision",
            "roll_id": "live-push-origin-roll",
            "skill": "Spot Hidden",
            "difficulty": "regular",
            "roll_contract": {
                "push_policy": {
                    "eligible": True,
                    "requires_changed_method": True,
                    "keeper_must_foreshadow_failure": True,
                },
            },
            "resolution_context": {
                "scene_action": "REVEAL",
                "clue_policy": {},
                "narrative_directives": {},
                "rule_signals": {},
            },
        },
    }
    original = executor.execute_commands(
        camp, char_path, "inv1", [origin], rng=random.Random(5)
    )[0]
    assert original["events"][0]["outcome"] == "failure"
    offer = {
        "command_id": "live-push-offer",
        "kind": "push_offer",
        "phase": "offer",
        "payload": {
            "decision_id": "live-push-offer-decision",
            "original_command_id": "live-push-origin",
            "changed_method_evidence": {
                "changed": True,
                "source": "player_proposal",
                "summary": "inspect the paper impressions instead of rereading",
            },
            "announced_consequence": {
                "summary": "the watcher identifies the investigator",
                "effect": {
                    "kind": "fictional_position",
                    "severity": "serious",
                },
            },
        },
    }
    return executor.execute_commands(
        camp, char_path, "inv1", [offer], rng=random.Random(211)
    )[0]


def _persist_live_realtime_bout(camp: Path, char_path: Path) -> dict:
    character = json.loads(char_path.read_text())
    character["characteristics"]["POW"] = 99
    character["characteristics"]["INT"] = 99
    character["derived"]["SAN"] = 99
    char_path.write_text(json.dumps(character))
    command = {
        "command_id": "live-bout-origin",
        "kind": "sanity_check",
        "phase": "resolve",
        "payload": {
            "decision_id": "live-bout-decision",
            "roll_id": "live-bout-roll",
            "san_loss_success": 5,
            "san_loss_fail_expr": "5",
            "source": "live structured horror",
            "alone": False,
            "involuntary_kind": "flee",
            "involuntary_summary": "run toward the lit doorway",
            "module_bout_override": {
                "force_mode": "real_time",
                "result_description": "keeper-private bout direction",
            },
        },
    }
    return live_runner.subsystem_executor.execute_commands(
        camp, char_path, "inv1", [command], rng=random.Random(1)
    )[0]


def test_director_production_san_trigger_forwards_structured_bout_context(tmp_path):
    camp, char_path = _build_live_campaign(tmp_path)
    story = json.loads((camp / "scenario" / "story-graph.json").read_text())
    story["scenes"][0]["on_enter"] = {"san_triggers": [{
        "trigger_id": "scene-horror",
        "source": "scene-horror",
        "san_loss_success": 5,
        "san_loss_fail_expr": "5",
        "alone": False,
        "involuntary_action": {
            "kind": "cry_out",
            "summary": "cries out and recoils",
        },
        "module_bout_override": {
            "force_mode": "real_time",
            "result_description": "authored real-time bout",
        },
        "creature_type": "deep-one",
    }]}
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(story))
    character = json.loads(char_path.read_text())
    character["characteristics"]["POW"] = 10
    character["characteristics"]["INT"] = 99
    character["derived"]["SAN"] = 10
    char_path.write_text(json.dumps(character))

    result = live_runner.run_live_turn(
        camp,
        char_path,
        "inv1",
        "我踏入房间。",
        intent_class="move",
        recording_mode="sync",
        max_auto_advance=1,
        rng_seed=1,
    )

    request = next(
        request for request in result["turns"][0]["rules_requests"]
        if request.get("kind") == "sanity_check"
    )
    assert request["alone"] is False
    assert request["involuntary_kind"] == "cry_out"
    assert request["involuntary_summary"] == "cries out and recoils"
    assert request["module_bout_override"]["force_mode"] == "real_time"
    assert request["creature_type"] == "deep-one"
    assert any(
        event.get("event_type") == "involuntary_action"
        for event in result["turns"][0]["rule_results"]
    )
    assert result["pending_choice"]["kind"] == "bout_keeper_action"


def _run_failed_live_origin(camp: Path, char_path: Path) -> dict:
    clue_graph = json.loads((camp / "scenario" / "clue-graph.json").read_text())
    clue_graph["conclusions"][0]["clues"][0].update({
        "delivery_kind": "skill_check",
        "skill": "Spot Hidden",
        "difficulty": "regular",
    })
    (camp / "scenario" / "clue-graph.json").write_text(json.dumps(clue_graph))
    result = live_runner.run_live_turn(
        camp,
        char_path,
        "inv1",
        "我检查桌上的文件。",
        intent_class="investigate",
        recording_mode="sync",
        max_auto_advance=1,
        rng_seed=5,
    )
    origin = next(
        row
        for row in result["subsystem_results"]
        if row.get("kind") == "skill_check"
    )
    assert origin["events"][0]["outcome"] == "failure"
    return origin


def test_live_turn_defaults_to_fast_background_recording_and_receipt(tmp_path, monkeypatch):
    camp, char_path = _build_live_campaign(tmp_path)
    spawned = []

    def fake_spawn_background_flush(campaign_dir, *, limit=None):
        spawned.append({"campaign_dir": Path(campaign_dir), "limit": limit})
        return {"started": True, "pid": 4242}

    monkeypatch.setattr(
        live_runner.coc_async_recorder,
        "spawn_background_flush",
        fake_spawn_background_flush,
    )

    result = live_runner.run_live_turn(
        camp,
        char_path,
        "inv1",
        "我检查桌上的文件。",
        intent_class="investigate",
        rng_seed=7,
    )

    assert result["recording"]["mode"] == "fast"
    assert result["recording"]["flush_policy"] == "background"
    assert result["recording"]["background_flush_started"] is True
    assert spawned
    assert any(turn["apply_path"] == "coc_director_apply.apply_plan" for turn in result["turns"])
    assert sorted((camp / "logs" / "pending-turns").glob("*.json"))

    receipts = [
        json.loads(line)
        for line in (camp / "logs" / "live-turn-runtime.jsonl").read_text().splitlines()
    ]
    assert receipts[-1]["event_type"] == "live_turn_runtime"
    assert receipts[-1]["recording_mode"] == "fast"
    assert receipts[-1]["recording_flush"] == "background"
    assert receipts[-1]["background_flush_requested"] is True


def test_live_turn_foreground_can_return_before_background_flush_finishes(tmp_path, monkeypatch):
    camp, char_path = _build_live_campaign(tmp_path)
    spawned = []

    def fake_spawn_background_flush(campaign_dir, *, limit=None):
        spawned.append({"campaign_dir": Path(campaign_dir), "limit": limit})
        return {"started": True, "pid": 4343}

    monkeypatch.setattr(
        live_runner.coc_async_recorder,
        "spawn_background_flush",
        fake_spawn_background_flush,
    )
    monkeypatch.setattr(
        live_runner.coc_async_recorder,
        "flush_pending_records",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("live turn must not flush synchronously")),
    )

    result = live_runner.run_live_turn(
        camp,
        char_path,
        "inv1",
        "我检查桌上的文件。",
        intent_class="investigate",
        rng_seed=17,
    )

    assert result["foreground"]["narration_can_return_before_flush"] is True
    assert result["foreground"]["waited_for_background_flush"] is False
    assert result["recording"]["background_work"]["status"] == "scheduled"
    assert sorted((camp / "logs" / "pending-turns").glob("*.json"))
    assert spawned

    receipts = [
        json.loads(line)
        for line in (camp / "logs" / "live-turn-runtime.jsonl").read_text().splitlines()
    ]
    assert receipts[-1]["foreground"]["narration_can_return_before_flush"] is True
    assert receipts[-1]["foreground"]["waited_for_background_flush"] is False


def test_live_turn_npc_assist_rule_requests_do_not_interrupt_auto_advance():
    assert live_runner._turn_interrupt_reason({
        "scene_transition": False,
        "event_types": [],
        "rules_requests": [{"kind": "npc_assist", "npc_id": "bruno"}],
        "clue_revealed": [],
        "choice_frame": {},
        "npc_moves": [],
        "narrative_directives": {"dramatic_progress": {"current_interrupts": []}},
    }) is None

    assert live_runner._turn_interrupt_reason({
        "scene_transition": False,
        "event_types": [],
        "rules_requests": [{"kind": "skill_check", "skill": "Spot Hidden"}],
        "clue_revealed": [],
        "choice_frame": {},
        "npc_moves": [],
        "narrative_directives": {"dramatic_progress": {"current_interrupts": []}},
    }) == "risk_requires_roll"


def test_live_turn_low_agency_choice_handles_missing_rich_intent():
    next_choice = live_runner._semantic_low_agency_choice({
        "player_text": "我继续跟着走。",
        "intent_class": "move",
        "player_intent_rich": None,
    })

    assert next_choice["auto_advanced"] is True
    assert next_choice["player_intent_rich"]["primary_intent"] == "move"
    assert "low_agency_continue" in next_choice["player_intent_rich"]["secondary_intents"]


def test_live_turn_state_patch_syncs_minimal_scene_and_defers_detail_log(tmp_path, monkeypatch):
    camp, char_path = _build_live_campaign(tmp_path)
    spawned = []

    def fake_spawn_background_flush(campaign_dir, *, limit=None):
        spawned.append({"campaign_dir": Path(campaign_dir), "limit": limit})
        return {"started": True, "pid": 4444}

    monkeypatch.setattr(
        live_runner.coc_async_recorder,
        "spawn_background_flush",
        fake_spawn_background_flush,
    )
    monkeypatch.setattr(
        live_runner.coc_async_recorder,
        "flush_pending_records",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("state patch detail must not flush synchronously")),
    )

    result = live_runner.run_live_turn(
        camp,
        char_path,
        "inv1",
        "我跟着电话线走。",
        intent_class="move",
        max_auto_advance=1,
        rng_seed=23,
        state_patch={
            "scene_id": "relay-dugout",
            "summary": "队伍抵达第二个电话掩体门口。",
            "scene_type": "investigation",
            "scene_tags": ["wire", "dugout"],
            "visible_affordances": [
                {"cue": "电话线从门缝下方继续伸进去。", "route": "inspect_wire"}
            ],
            "pressure_moves": [
                {"id": "wire-click", "visible_symptom": "掩体里传来短促的咔哒声。"}
            ],
            "npc_ids": ["bruno", "matteo"],
            "details": {
                "draft_summary": "Long-form recap for replay and debugging, not needed before narration.",
            },
        },
    )

    active_scene = json.loads((camp / "save" / "active-scene.json").read_text())
    assert active_scene["scene_id"] == "relay-dugout"
    assert active_scene["summary"] == "队伍抵达第二个电话掩体门口。"
    assert active_scene["visible_affordances"][0]["route"] == "inspect_wire"
    assert active_scene["pressure_moves"][0]["id"] == "wire-click"
    assert result["state_patch"]["applied"] is True
    assert result["state_patch"]["detail_record_deferred"] is True
    assert result["stop_actionability"]["must_surface_handles"] is True
    assert result["stop_actionability"]["immediate_handles"][0]["route_id"] == "inspect_wire"
    assert result["stop_actionability"]["forbidden_menu_rendering"] is True
    assert result["foreground"]["sync_state_writes_completed"] is True
    assert spawned

    pending_payloads = [
        json.loads(path.read_text())
        for path in sorted((camp / "logs" / "pending-turns").glob("*.json"))
    ]
    assert any(
        entry["relative_path"] == "logs/scene-state-patches.jsonl"
        for payload in pending_payloads
        for entry in payload["entries"]
    )


def test_live_turn_auto_advances_low_agency_posture_until_interrupt(tmp_path, monkeypatch):
    camp, char_path = _build_live_campaign(tmp_path)
    story = json.loads((camp / "scenario" / "story-graph.json").read_text())
    story["scenes"] = [
        {
            "scene_id": "snow-bridge",
            "scene_type": "travel",
            "scene_kind": "bridge",
            "dramatic_question": "Can the patrol reach the next actionable point?",
            "entry_conditions": [],
            "exit_conditions": [],
            "available_clues": [],
            "npc_ids": [],
            "pressure_moves": [],
            "tone": ["cold"],
            "allowed_improvisation": [],
            "progress_contract": {
                "kind": "bridge",
                "max_low_agency_turns": 1,
                "fallback_action": "MONTAGE",
                "exit_directive": "Montage the march and cut to the next actionable point.",
            },
        },
        {
            "scene_id": "wire-shelter",
            "scene_type": "investigation",
            "dramatic_question": "What is wrong with the wire shelter?",
            "entry_conditions": [],
            "exit_conditions": [],
            "available_clues": [],
            "npc_ids": [],
            "pressure_moves": [{"id": "wire-rattle", "visible_symptom": "掩体里的电话线忽然绷紧。"}],
            "tone": ["tense"],
            "allowed_improvisation": [],
        },
    ]
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(story))
    world = json.loads((camp / "save" / "world-state.json").read_text())
    world["active_scene_id"] = "snow-bridge"
    (camp / "save" / "world-state.json").write_text(json.dumps(world))

    monkeypatch.setattr(
        live_runner.coc_async_recorder,
        "spawn_background_flush",
        lambda campaign_dir, *, limit=None: {"started": True, "pid": 4243},
    )

    result = live_runner.run_live_turn(
        camp,
        char_path,
        "inv1",
        "我继续跟着班长走。",
        intent_class="move",
        player_intent_rich={
            "primary_intent": "move",
            "secondary_intents": ["low_agency_continue", "follow_group", "yield_initiative"],
            "target_entities": ["patrol"],
            "risk_posture": "neutral",
            "explicit_roll_request": False,
            "player_hypothesis": None,
            "action_atoms": [],
        },
        max_auto_advance=3,
        rng_seed=11,
    )

    assert result["auto_advance"]["enabled"] is True
    assert result["auto_advance"]["turns_run"] >= 2
    assert result["auto_advance"]["stop_reason"] in {
        "scene_arrival_or_transition",
        "threat_approaches",
        "meaningful_interrupt",
    }
    assert result["final_state"]["active_scene"] == "wire-shelter"
    assert any(turn["auto_advanced"] for turn in result["turns"][1:])


def test_no_interrupt_when_two_routes_but_not_real_fork():
    # Scene has 2 routes but player already committed (is_real_fork=False) -> no stop
    assert live_runner._turn_interrupt_reason({
        "scene_transition": False,
        "event_types": [],
        "rules_requests": [],
        "clue_revealed": [],
        "choice_frame": {"route_count": 2, "is_real_fork": False, "open_route_count": 2},
        "npc_moves": [],
        "narrative_directives": {"dramatic_progress": {"current_interrupts": []}},
    }) is None


def test_interrupt_when_real_fork():
    assert live_runner._turn_interrupt_reason({
        "scene_transition": False,
        "event_types": [],
        "rules_requests": [],
        "clue_revealed": [],
        "choice_frame": {"route_count": 2, "is_real_fork": True, "open_route_count": 2},
        "npc_moves": [],
        "narrative_directives": {"dramatic_progress": {"current_interrupts": []}},
    }) == "meaningful_choice"


def test_no_interrupt_for_npc_assist_move():
    # npc_moves with only npc_assist (non-decisional) -> no stop
    assert live_runner._turn_interrupt_reason({
        "scene_transition": False,
        "event_types": [],
        "rules_requests": [],
        "clue_revealed": [],
        "choice_frame": {"route_count": 0, "is_real_fork": False, "open_route_count": 0},
        "npc_moves": [{"npc_id": "bruno", "kind": "npc_assist"}],
        "narrative_directives": {"dramatic_progress": {"current_interrupts": []}},
    }) is None


def test_interrupt_for_npc_requires_player_decision():
    assert live_runner._turn_interrupt_reason({
        "scene_transition": False,
        "event_types": [],
        "rules_requests": [],
        "clue_revealed": [],
        "choice_frame": {"route_count": 0, "is_real_fork": False, "open_route_count": 0},
        "npc_moves": [{"npc_id": "bruno", "requires_player_decision": True}],
        "narrative_directives": {"dramatic_progress": {"current_interrupts": []}},
    }) == "npc_requests_specialist_judgment"


def test_live_turn_low_agency_stops_at_real_fork(tmp_path, monkeypatch):
    """P0-2d reverse: even low-agency input must stop when the scene is a real
    fork (two open routes), handing the choice to the player. Verifies the
    is_real_fork gate from Task 4 actually stops (not just route_count)."""
    camp, char_path = _build_live_campaign(tmp_path)
    story = json.loads((camp / "scenario" / "story-graph.json").read_text())
    story["scenes"] = [
        {
            "scene_id": "crossroads",
            "scene_type": "investigation",
            "dramatic_question": "Which lead does the investigator pursue?",
            "entry_conditions": [],
            "exit_conditions": [],
            "available_clues": [],
            "npc_ids": [],
            "pressure_moves": [],
            "tone": ["tense"],
            "allowed_improvisation": [],
            "affordances": [
                {"id": "ask-tenants", "cue": "可以去问前租客。", "status": "open", "route_priority": 0.5},
                {"id": "check-records", "cue": "可以去查公共记录。", "status": "open", "route_priority": 0.5},
            ],
        },
    ]
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(story))
    world = json.loads((camp / "save" / "world-state.json").read_text())
    world["active_scene_id"] = "crossroads"
    (camp / "save" / "world-state.json").write_text(json.dumps(world))

    monkeypatch.setattr(
        live_runner.coc_async_recorder,
        "spawn_background_flush",
        lambda campaign_dir, *, limit=None: {"started": True, "pid": 4244},
    )

    result = live_runner.run_live_turn(
        camp,
        char_path,
        "inv1",
        "继续吧。",
        intent_class="move",
        player_intent_rich={
            "primary_intent": "move",
            "secondary_intents": ["low_agency_continue", "yield_initiative"],
            "target_entities": [],
            "risk_posture": "neutral",
            "explicit_roll_request": False,
            "player_hypothesis": None,
            "action_atoms": [],
        },
        max_auto_advance=3,
        rng_seed=5,
    )

    # Two open affordances -> is_real_fork True -> must stop after the first turn.
    assert result["auto_advance"]["turns_run"] == 1
    assert result["auto_advance"]["stop_reason"] == "meaningful_choice"


# --- P1-2: don't stop on a turn with no actionable content ---


def test_turn_has_actionable_content_true_for_fork_clue_routes_npc():
    """The conservative helper must report actionable content whenever the turn
    carries any structured handle (real fork, clue, routes, npc decision). When
    ambiguous it returns True so the runner does not over-advance."""
    # real fork
    assert live_runner._turn_has_actionable_content({
        "choice_frame": {"is_real_fork": True, "routes": [], "open_route_count": 0},
        "clue_revealed": [],
        "npc_moves": [],
    }) is True
    # non-empty routes (even if not a real fork) — a route is still a handle
    assert live_runner._turn_has_actionable_content({
        "choice_frame": {"is_real_fork": False, "routes": [{"route_id": "x"}], "open_route_count": 1},
        "clue_revealed": [],
        "npc_moves": [],
    }) is True
    # clue revealed
    assert live_runner._turn_has_actionable_content({
        "choice_frame": {"is_real_fork": False, "routes": [], "open_route_count": 0},
        "clue_revealed": ["c1"],
        "npc_moves": [],
    }) is True
    # npc requires player decision
    assert live_runner._turn_has_actionable_content({
        "choice_frame": {"is_real_fork": False, "routes": [], "open_route_count": 0},
        "clue_revealed": [],
        "npc_moves": [{"npc_id": "bruno", "requires_player_decision": True}],
    }) is True


def test_turn_has_actionable_content_false_when_truly_empty():
    """A turn with no fork, no routes, no clue, no npc decision has nothing the
    player can act on — the helper reports False so the runner keeps advancing."""
    assert live_runner._turn_has_actionable_content({
        "choice_frame": {"is_real_fork": False, "routes": [], "open_route_count": 0},
        "clue_revealed": [],
        "npc_moves": [],
    }) is False


def test_turn_has_actionable_content_conservative_on_missing_fields():
    """When structured fields are absent/ambiguous the helper must default to
    True (stop) rather than risk an over-advance into an infinite feeling loop."""
    assert live_runner._turn_has_actionable_content({}) is True
    # choice_frame present but missing routes list — ambiguous, treat as content
    assert live_runner._turn_has_actionable_content({"choice_frame": {}}) is True


def test_live_turn_keeps_advancing_when_no_actionable_content(tmp_path, monkeypatch):
    """P1-2: a turn that surfaces no handle (no real fork, no clue, no routes,
    no npc decision) and is not a low-agency compressed-progress turn must NOT
    stop at awaiting_player_input — the runner should keep advancing (up to the
    max_turns cap) so the director gets another chance to surface a handle."""
    camp, char_path = _build_live_campaign(tmp_path)
    story = json.loads((camp / "scenario" / "story-graph.json").read_text())
    story["scenes"] = [
        {
            "scene_id": "empty-hall",
            "scene_type": "investigation",
            "dramatic_question": "What is in the empty hall?",
            "entry_conditions": [],
            "exit_conditions": [],
            "available_clues": [],
            "npc_ids": [],
            "pressure_moves": [],
            "tone": ["quiet"],
            "allowed_improvisation": [],
        },
    ]
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(story))
    world = json.loads((camp / "save" / "world-state.json").read_text())
    world["active_scene_id"] = "empty-hall"
    (camp / "save" / "world-state.json").write_text(json.dumps(world))

    monkeypatch.setattr(
        live_runner.coc_async_recorder,
        "spawn_background_flush",
        lambda campaign_dir, *, limit=None: {"started": True, "pid": 4255},
    )

    result = live_runner.run_live_turn(
        camp,
        char_path,
        "inv1",
        "我仔细搜寻这个房间。",
        intent_class="investigate",
        # A concrete (non-low-agency) investigative posture: the director will
        # NOT emit a compressed_progress directive, so _should_auto_advance is
        # False. Combined with an empty scene this is exactly the P1-2 trap.
        player_intent_rich={
            "primary_intent": "investigate",
            "secondary_intents": ["search"],
            "action_atoms": [{"topic": "room", "verb": "search"}],
        },
        max_auto_advance=3,
        rng_seed=5,
    )

    # Before the fix this stopped at turn 1 with "awaiting_player_input" leaving
    # the player with nothing to act on. Now it must keep going.
    assert result["auto_advance"]["turns_run"] >= 2
    # It must NOT have given up with awaiting_player_input on an empty turn.
    assert result["auto_advance"]["stop_reason"] != "awaiting_player_input"
    # Continuation turns are marked as auto-advanced low-agency beats.
    assert any(turn["auto_advanced"] for turn in result["turns"][1:])
    # The max_turns cap still holds (no runaway).
    assert result["auto_advance"]["turns_run"] <= result["auto_advance"]["max_turns"]


def test_live_turn_stops_on_single_route_content_does_not_over_advance(tmp_path, monkeypatch):
    """P1-2 reverse: a turn that DOES surface a handle (one open affordance ->
    choice_frame.routes has 1 entry, is_real_fork=False, no clue, no npc
    decision) reached via a non-low-agency intent must STOP at turn 1 with
    awaiting_player_input. The over-advance guard in the empty-handle branch
    must NOT fire here, because ``_turn_has_actionable_content`` returns True.

    This is the critical coverage gap left by the keep-advancing test: that
    test proves an empty turn keeps going; this one proves a turn WITH content
    (a single route) does not get over-advanced past the player."""
    camp, char_path = _build_live_campaign(tmp_path)
    story = json.loads((camp / "scenario" / "story-graph.json").read_text())
    story["scenes"] = [
        {
            "scene_id": "single-door",
            "scene_type": "investigation",
            "dramatic_question": "What is behind the single door?",
            "entry_conditions": [],
            "exit_conditions": [],
            "available_clues": [],
            "npc_ids": [],
            "pressure_moves": [],
            "tone": ["tense"],
            "allowed_improvisation": [],
            # A single open affordance: routes non-empty (content True) but
            # is_real_fork=False (open_route_count=1, < 2) and no clue/npc to
            # trigger _turn_interrupt_reason. This is the exact frame shape
            # that lands in the P1-2 empty-handle branch.
            "affordances": [
                {"id": "open-door", "cue": "门虚掩着。", "status": "open", "route_priority": 0.5},
            ],
        },
    ]
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(story))
    world = json.loads((camp / "save" / "world-state.json").read_text())
    world["active_scene_id"] = "single-door"
    (camp / "save" / "world-state.json").write_text(json.dumps(world))

    monkeypatch.setattr(
        live_runner.coc_async_recorder,
        "spawn_background_flush",
        lambda campaign_dir, *, limit=None: {"started": True, "pid": 4266},
    )

    result = live_runner.run_live_turn(
        camp,
        char_path,
        "inv1",
        "我搜查这个地方。",
        intent_class="investigate",
        # A concrete (non-low-agency) investigative posture: the director does
        # NOT emit a compressed_progress directive, so _should_auto_advance is
        # False and the run reaches the P1-2 branch. Unlike the empty-hall case,
        # this turn carries a single route -> helper True -> stop normally.
        player_intent_rich={
            "primary_intent": "investigate",
            "secondary_intents": ["search"],
            "action_atoms": [{"topic": "room", "verb": "search"}],
        },
        max_auto_advance=3,
        rng_seed=5,
    )

    # The turn had a single route (content present), so the helper returned
    # True and the loop must stop at turn 1 rather than over-advancing.
    first_turn = result["turns"][0]
    choice_frame = first_turn["choice_frame"]
    assert len(choice_frame["routes"]) == 1
    assert choice_frame["is_real_fork"] is False
    assert live_runner._turn_has_actionable_content(first_turn) is True
    # No other handle should have surfaced to stop via a different reason.
    assert not first_turn["clue_revealed"]
    assert not any(
        (move.get("requires_player_decision") if isinstance(move, dict) else False)
        for move in first_turn["npc_moves"]
    )

    assert len(result["turns"]) == 1
    assert result["auto_advance"]["turns_run"] == 1
    assert result["auto_advance"]["stop_reason"] == "awaiting_player_input"


def test_live_resume_affordance_does_not_create_false_real_fork(tmp_path, monkeypatch):
    """A synthetic live resume affordance keeps narration actionable, but must
    not turn one real visible route into a meaningful player fork."""
    camp, char_path = _build_live_campaign(tmp_path)
    story = json.loads((camp / "scenario" / "story-graph.json").read_text())
    story["scenes"] = [
        {
            "scene_id": "relay-dugout",
            "scene_type": "investigation",
            "dramatic_question": "How does the patrol proceed?",
            "entry_conditions": [],
            "exit_conditions": [],
            "available_clues": [],
            "npc_ids": [],
            "pressure_moves": [],
            "tone": ["tense"],
            "allowed_improvisation": [],
        },
    ]
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(story))
    world = json.loads((camp / "save" / "world-state.json").read_text())
    world["active_scene_id"] = "relay-dugout"
    (camp / "save" / "world-state.json").write_text(json.dumps(world))
    (camp / "save" / "active-scene.json").write_text(json.dumps({
        "schema_version": 1,
        "scene_id": "relay-dugout",
        "summary": "队伍抵达第二个电话掩体门口。",
        "visible_affordances": [
            {"cue": "电话线从门缝下方继续伸进去。", "route": "inspect_wire"},
        ],
    }, ensure_ascii=False))

    monkeypatch.setattr(
        live_runner.coc_async_recorder,
        "spawn_background_flush",
        lambda campaign_dir, *, limit=None: {"started": True, "pid": 4277},
    )

    result = live_runner.run_live_turn(
        camp,
        char_path,
        "inv1",
        "我继续跟着班长走。",
        intent_class="move",
        player_intent_rich={
            "primary_intent": "move",
            "secondary_intents": ["low_agency_continue", "follow_group", "yield_initiative"],
            "target_entities": ["patrol"],
            "risk_posture": "neutral",
            "explicit_roll_request": False,
            "player_hypothesis": None,
            "action_atoms": [],
        },
        max_auto_advance=3,
        recording_mode="sync",
        rng_seed=11,
    )

    choice_frame = result["turns"][0]["choice_frame"]
    assert "inspect_wire" in choice_frame["open_route_ids"]
    assert "live-scene-thread" not in choice_frame["open_route_ids"]
    assert choice_frame["is_real_fork"] is False
    assert result["auto_advance"]["stop_reason"] != "meaningful_choice"


# ---------------------------------------------------------------------------
# Semantic intent resolution (Semantic Matcher Constitution)
# ---------------------------------------------------------------------------

class _FixtureIntentEvaluator:
    evaluator_id = "codex-llm-semantic-v1"

    def __init__(self, primary_intent="social"):
        self.calls = []
        self._primary = primary_intent

    def classify(self, player_text, active_scene):
        self.calls.append((player_text, active_scene))
        return {
            "primary_intent": self._primary,
            "secondary_intents": [],
            "target_entities": [],
            "risk_posture": "neutral",
            "explicit_roll_request": False,
            "player_hypothesis": None,
            "action_atoms": [],
        }


class _ParsedTimeIntentEvaluator:
    evaluator_id = "codex-llm-semantic-v1"

    def __init__(self, intent_detail="quick_observation"):
        self.calls = []
        self._intent_detail = intent_detail

    def classify(self, player_text, active_scene):
        self.calls.append((player_text, active_scene))
        raw = {
            "primary_intent": "investigate",
            "secondary_intents": [],
            "target_entities": [],
            "risk_posture": "cautious",
            "explicit_roll_request": False,
            "player_hypothesis": None,
            "action_atoms": [],
            "intent_detail": self._intent_detail,
        }
        return live_runner.coc_intent_router.LLMIntentEvaluator._parse_result(self, raw)


def test_live_turn_caller_intent_is_recorded(tmp_path):
    camp, char_path = _build_live_campaign(tmp_path)
    result = live_runner.run_live_turn(
        camp, char_path, "inv1", "我检查桌上的文件。",
        intent_class="investigate", recording_mode="sync", rng_seed=3,
    )
    assert result["intent_resolution"]["source"] == "caller_intent_class"
    assert result["intent_resolution"]["intent_class"] == "investigate"


def test_live_turn_quick_observation_in_extreme_cold_persists_short_time_and_defers_exposure(
    tmp_path,
):
    camp, char_path = _build_live_campaign(tmp_path)
    story_path = camp / "scenario" / "story-graph.json"
    story = json.loads(story_path.read_text(encoding="utf-8"))
    story["scenes"][0]["scene_tags"] = ["extreme_cold"]
    story_path.write_text(json.dumps(story), encoding="utf-8")

    time_layer = live_runner.director.coc_time
    time_layer.initialize_time_state(camp)
    cold_rule = json.loads(
        (
            Path("plugins/coc-keeper/references/rules-json/the-white-war.json")
        ).read_text(encoding="utf-8")
    )["rules"]["cold_exposure"]
    exposure_interval = cold_rule["interval_minutes"]
    exposure_trigger_id = time_layer.schedule_trigger(camp, {
        "kind": "cold_exposure",
        "target_id": "inv1",
        "due_elapsed_minutes": exposure_interval,
        "policy": "auto_apply",
    })

    result = live_runner.run_live_turn(
        camp,
        char_path,
        "inv1",
        "I take a quick look across the snowfield.",
        intent_class="investigate",
        player_intent_rich={
            "primary_intent": "investigate",
            "intent_detail": "quick_observation",
            "secondary_intents": [],
            "target_entities": [],
            "risk_posture": "cautious",
            "explicit_roll_request": False,
            "player_hypothesis": None,
            "action_atoms": [],
        },
        max_auto_advance=1,
        recording_mode="sync",
        rng_seed=41,
    )

    assert result["turns"][0]["action"] == "REVEAL"
    time_state = time_layer.read_time_state(camp)
    elapsed = time_state["clock"]["elapsed_minutes"]
    assert 0 < elapsed <= exposure_interval

    time_records = [
        json.loads(line)
        for line in (camp / "logs" / "time.jsonl").read_text().splitlines()
        if line.strip()
    ]
    advance = next(record for record in time_records if record["event_type"] == "time_advance")
    assert advance["category"] == "quick_observation"
    assert advance["delta_minutes"] == elapsed

    triggers = json.loads((camp / "save" / "time-triggers.json").read_text())["triggers"]
    exposure = next(trigger for trigger in triggers if trigger["trigger_id"] == exposure_trigger_id)
    assert exposure["status"] == "pending"


def test_live_turn_routed_quick_observation_persists_short_time_and_defers_exposure(
    tmp_path,
):
    camp, char_path = _build_live_campaign(tmp_path)
    story_path = camp / "scenario" / "story-graph.json"
    story = json.loads(story_path.read_text(encoding="utf-8"))
    story["scenes"][0]["scene_tags"] = ["extreme_cold"]
    story_path.write_text(json.dumps(story), encoding="utf-8")

    time_layer = live_runner.director.coc_time
    time_layer.initialize_time_state(camp)
    exposure_interval = 5
    exposure_trigger_id = time_layer.schedule_trigger(camp, {
        "kind": "cold_exposure",
        "target_id": "inv1",
        "due_elapsed_minutes": exposure_interval,
        "policy": "auto_apply",
    })
    fixture = _ParsedTimeIntentEvaluator()
    live_runner.coc_intent_router.set_intent_evaluator(fixture)
    try:
        result = live_runner.run_live_turn(
            camp,
            char_path,
            "inv1",
            "I scan the snowfield.",
            max_auto_advance=1,
            recording_mode="sync",
            rng_seed=42,
        )
    finally:
        live_runner.coc_intent_router.set_intent_evaluator(None)

    assert fixture.calls
    assert result["intent_resolution"]["source"] == "intent_router"
    assert result["turns"][0]["action"] == "REVEAL"
    elapsed = time_layer.read_time_state(camp)["clock"]["elapsed_minutes"]
    assert 0 < elapsed <= exposure_interval
    triggers = json.loads((camp / "save" / "time-triggers.json").read_text())["triggers"]
    exposure = next(trigger for trigger in triggers if trigger["trigger_id"] == exposure_trigger_id)
    assert exposure["status"] == "pending"


def test_live_state_patch_preserves_authored_time_profile_for_next_routed_turn(tmp_path):
    camp, char_path = _build_live_campaign(tmp_path)
    patch_result = live_runner.run_live_turn(
        camp,
        char_path,
        "inv1",
        "I speak briefly.",
        intent_class="social",
        max_auto_advance=1,
        recording_mode="sync",
        rng_seed=43,
        state_patch={
            "scene_id": "scene-1",
            "scene_tags": ["extreme_cold"],
            "time_profile": {"category": "single_room_search"},
        },
    )

    active_path = camp / "save" / "active-scene.json"
    active = json.loads(active_path.read_text(encoding="utf-8"))
    assert active["time_profile"] == {"category": "single_room_search"}
    assert "time_profile" in patch_result["state_patch"]["minimal_keys"]

    time_layer = live_runner.director.coc_time
    time_layer.initialize_time_state(camp)
    exposure_trigger_id = time_layer.schedule_trigger(camp, {
        "kind": "cold_exposure",
        "target_id": "inv1",
        "due_elapsed_minutes": 5,
        "policy": "auto_apply",
    })
    fixture = _ParsedTimeIntentEvaluator()
    live_runner.coc_intent_router.set_intent_evaluator(fixture)
    try:
        result = live_runner.run_live_turn(
            camp,
            char_path,
            "inv1",
            "I scan the snowfield.",
            max_auto_advance=1,
            recording_mode="sync",
            rng_seed=44,
        )
    finally:
        live_runner.coc_intent_router.set_intent_evaluator(None)

    time_records = [
        json.loads(line)
        for line in (camp / "logs" / "time.jsonl").read_text().splitlines()
        if line.strip() and json.loads(line).get("event_type") == "time_advance"
    ]
    assert time_records[-1]["category"] == "single_room_search"
    assert time_records[-1]["delta_minutes"] == 20
    triggers = json.loads((camp / "save" / "time-triggers.json").read_text())["triggers"]
    exposure = next(trigger for trigger in triggers if trigger["trigger_id"] == exposure_trigger_id)
    assert exposure["status"] == "fired"
    assert result["intent_resolution"]["source"] == "intent_router"


def test_live_state_patch_drops_invalid_time_profile_with_reason(tmp_path):
    camp, char_path = _build_live_campaign(tmp_path)

    result = live_runner.run_live_turn(
        camp,
        char_path,
        "inv1",
        "I speak briefly.",
        intent_class="social",
        max_auto_advance=1,
        recording_mode="sync",
        rng_seed=45,
        state_patch={
            "scene_id": "scene-1",
            "time_profile": {"category": "look around quickly"},
        },
    )

    active = json.loads((camp / "save" / "active-scene.json").read_text())
    assert "time_profile" not in active
    assert result["state_patch"]["validation_warnings"] == [{
        "field": "time_profile",
        "reason_code": "category_not_in_time_cost_catalog",
    }]


def test_live_state_patch_scene_change_clears_prior_time_profile(tmp_path):
    camp, char_path = _build_live_campaign(tmp_path)
    live_runner.run_live_turn(
        camp,
        char_path,
        "inv1",
        "I speak briefly.",
        intent_class="social",
        max_auto_advance=1,
        recording_mode="sync",
        rng_seed=46,
        state_patch={
            "scene_id": "scene-1",
            "time_profile": {"category": "single_room_search"},
        },
    )
    live_runner.run_live_turn(
        camp,
        char_path,
        "inv1",
        "I move onward.",
        intent_class="move",
        max_auto_advance=1,
        recording_mode="sync",
        rng_seed=47,
        state_patch={
            "scene_id": "scene-2",
            "scene_tags": ["extreme_cold"],
        },
    )

    active = json.loads((camp / "save" / "active-scene.json").read_text())
    assert active["scene_id"] == "scene-2"
    assert "time_profile" not in active

    time_layer = live_runner.director.coc_time
    time_layer.initialize_time_state(camp)
    exposure_trigger_id = time_layer.schedule_trigger(camp, {
        "kind": "cold_exposure",
        "target_id": "inv1",
        "due_elapsed_minutes": 5,
        "policy": "auto_apply",
    })
    fixture = _ParsedTimeIntentEvaluator()
    live_runner.coc_intent_router.set_intent_evaluator(fixture)
    try:
        result = live_runner.run_live_turn(
            camp,
            char_path,
            "inv1",
            "I scan the new scene.",
            max_auto_advance=1,
            recording_mode="sync",
            rng_seed=48,
        )
    finally:
        live_runner.coc_intent_router.set_intent_evaluator(None)

    time_records = [
        json.loads(line)
        for line in (camp / "logs" / "time.jsonl").read_text().splitlines()
        if line.strip() and json.loads(line).get("event_type") == "time_advance"
    ]
    assert time_records[-1]["category"] == "quick_observation"
    assert time_records[-1]["delta_minutes"] <= 5
    triggers = json.loads((camp / "save" / "time-triggers.json").read_text())["triggers"]
    exposure = next(trigger for trigger in triggers if trigger["trigger_id"] == exposure_trigger_id)
    assert exposure["status"] == "pending"
    assert result["intent_resolution"]["source"] == "intent_router"


def test_live_state_patch_explicitly_clears_time_profile(tmp_path):
    camp, char_path = _build_live_campaign(tmp_path)
    live_runner.run_live_turn(
        camp,
        char_path,
        "inv1",
        "I speak briefly.",
        intent_class="social",
        max_auto_advance=1,
        recording_mode="sync",
        rng_seed=49,
        state_patch={
            "scene_id": "scene-1",
            "time_profile": {"category": "single_room_search"},
        },
    )

    result = live_runner.run_live_turn(
        camp,
        char_path,
        "inv1",
        "I revise the scene timing.",
        intent_class="social",
        max_auto_advance=1,
        recording_mode="sync",
        rng_seed=50,
        state_patch={
            "scene_id": "scene-1",
            "time_profile": None,
        },
    )

    active = json.loads((camp / "save" / "active-scene.json").read_text())
    assert "time_profile" not in active
    assert result["state_patch"]["validation_warnings"] == []


def test_live_turn_invalid_compiled_time_profile_warns_and_uses_routed_detail(tmp_path):
    camp, char_path = _build_live_campaign(tmp_path)
    story_path = camp / "scenario" / "story-graph.json"
    story = json.loads(story_path.read_text(encoding="utf-8"))
    story["scenes"][0]["time_profile"] = {"category": "scan_the_snow"}
    story_path.write_text(json.dumps(story), encoding="utf-8")
    time_layer = live_runner.director.coc_time
    time_layer.initialize_time_state(camp)

    fixture = _ParsedTimeIntentEvaluator()
    live_runner.coc_intent_router.set_intent_evaluator(fixture)
    try:
        result = live_runner.run_live_turn(
            camp,
            char_path,
            "inv1",
            "I scan the snowfield.",
            max_auto_advance=1,
            recording_mode="sync",
            rng_seed=51,
        )
    finally:
        live_runner.coc_intent_router.set_intent_evaluator(None)

    turn = result["turns"][0]
    assert turn["validation_warnings"] == [{
        "field": "time_profile",
        "source": "compiled_scene",
        "reason_code": "category_not_in_time_cost_catalog",
    }]
    time_records = [
        json.loads(line)
        for line in (camp / "logs" / "time.jsonl").read_text().splitlines()
        if line.strip() and json.loads(line).get("event_type") == "time_advance"
    ]
    assert time_records[-1]["category"] == "quick_observation"
    assert time_records[-1]["delta_minutes"] <= 5


def test_live_turn_missing_intent_routes_through_intent_router(tmp_path):
    """Without caller intent, the runner consults coc_intent_router (installed
    evaluator), never a hardcoded intent default."""
    camp, char_path = _build_live_campaign(tmp_path)
    fixture = _FixtureIntentEvaluator(primary_intent="social")
    live_runner.coc_intent_router.set_intent_evaluator(fixture)
    try:
        result = live_runner.run_live_turn(
            camp, char_path, "inv1", "我去问问邻居昨晚听到了什么。",
            recording_mode="sync", rng_seed=5,
        )
    finally:
        live_runner.coc_intent_router.set_intent_evaluator(None)

    assert fixture.calls, "semantic evaluator must be consulted"
    assert result["intent_resolution"]["source"] == "intent_router"
    assert result["intent_resolution"]["intent_class"] == "social"
    receipts = [
        json.loads(line)
        for line in (camp / "logs" / "live-turn-runtime.jsonl").read_text().splitlines()
    ]
    assert receipts[-1]["intent_resolution"]["source"] == "intent_router"


def test_live_turn_no_semantic_evidence_degrades_to_ambiguous_not_investigate(tmp_path):
    """With no caller intent and no evaluator result artifact, the intent
    degrades to 'ambiguous' (honest unknown) and the degradation is recorded.
    It must never silently default to 'investigate'."""
    camp, char_path = _build_live_campaign(tmp_path)
    live_runner.coc_intent_router.set_intent_evaluator(None)

    result = live_runner.run_live_turn(
        camp, char_path, "inv1", "我检查桌上的文件。",
        recording_mode="sync", rng_seed=9,
    )

    assert result["intent_resolution"]["source"] == "unresolved_default_ambiguous"
    assert result["intent_resolution"]["intent_class"] == "ambiguous"
    assert result["turns"], "turn should still run with the honest-unknown intent"
    # the file-mediated evaluator request lands under the campaign's logs
    assert (camp / "logs" / "intent-eval" / "intent-eval-request.json").exists()


# ---------------------------------------------------------------------------
# N3: narration quality audit loop on live turns
# ---------------------------------------------------------------------------

def test_live_turn_narration_audit_jsonl_and_counter(tmp_path, monkeypatch):
    """After envelope build, guard findings land in narration-audit.jsonl + turn counter.

    Rewrite-severity findings are audit-only: the turn still completes.
    """
    camp, char_path = _build_live_campaign(tmp_path)
    real_build = live_runner.narration_contract.build_narration_envelope

    def build_with_summary_ese(plan, **kwargs):
        env = dict(real_build(plan, **kwargs))
        reveals = dict(env.get("approved_reveals") or {})
        reveals["must_include"] = ["这表明桌上有一份文件。"]
        env["approved_reveals"] = reveals
        return env

    monkeypatch.setattr(
        live_runner.narration_contract,
        "build_narration_envelope",
        build_with_summary_ese,
    )

    result = live_runner.run_live_turn(
        camp,
        char_path,
        "inv1",
        "我检查桌上的文件。",
        intent_class="investigate",
        recording_mode="sync",
        rng_seed=21,
    )

    turn = result["turns"][0]
    assert turn["narration_audit"]["findings"] >= 1
    assert result["narration_audit"]["findings"] >= 1

    audit_path = camp / "logs" / "narration-audit.jsonl"
    assert audit_path.exists()
    records = [json.loads(line) for line in audit_path.read_text().splitlines() if line.strip()]
    assert records
    assert all(
        {"decision_id", "ts", "field", "finding_code", "severity"} <= set(rec)
        for rec in records
    )
    assert any(rec["finding_code"] == "ai_summary_voice" for rec in records)
    assert all(rec["severity"] == "rewrite" for rec in records)
    # rewrite severity must not gate the turn
    assert turn["decision_id"]
    assert turn["narration_envelope"]["approved_reveals"]["must_include"]


def test_live_turn_narration_audit_zero_findings_when_clean(tmp_path):
    camp, char_path = _build_live_campaign(tmp_path)
    result = live_runner.run_live_turn(
        camp,
        char_path,
        "inv1",
        "我检查桌上的文件。",
        intent_class="investigate",
        recording_mode="sync",
        rng_seed=22,
    )
    assert result["turns"][0]["narration_audit"]["findings"] == 0
    assert result["narration_audit"]["findings"] == 0


# ---------------------------------------------------------------------------
# N6 leftover: campaign_lock wraps run_live_turn
# ---------------------------------------------------------------------------

def test_run_live_turn_holds_campaign_lock_mid_turn(tmp_path, monkeypatch):
    camp, char_path = _build_live_campaign(tmp_path)
    seen = {}
    original = live_runner._run_one_turn

    def wrapped(**kwargs):
        lock_path = camp / ".campaign.lock"
        seen["exists"] = lock_path.exists()
        if lock_path.exists():
            seen["payload"] = json.loads(lock_path.read_text(encoding="utf-8"))
        return original(**kwargs)

    monkeypatch.setattr(live_runner, "_run_one_turn", wrapped)

    live_runner.run_live_turn(
        camp,
        char_path,
        "inv1",
        "我检查桌上的文件。",
        intent_class="investigate",
        recording_mode="sync",
        rng_seed=23,
    )

    assert seen.get("exists") is True
    assert seen["payload"]["pid"] == os.getpid()
    assert not (camp / ".campaign.lock").exists()


def test_run_live_turn_raises_campaign_lock_error_when_held(tmp_path):
    """Concurrent session: CampaignLockError is a hard error (raise, not soft event)."""
    camp, char_path = _build_live_campaign(tmp_path)
    with live_runner.coc_fileio.campaign_lock(camp):
        with pytest.raises(live_runner.coc_fileio.CampaignLockError):
            live_runner.run_live_turn(
                camp,
                char_path,
                "inv1",
                "我检查桌上的文件。",
                intent_class="investigate",
                recording_mode="sync",
                rng_seed=24,
            )


def test_run_live_turn_reclaims_stale_lock_from_dead_pid(tmp_path):
    camp, char_path = _build_live_campaign(tmp_path)
    lock_path = camp / ".campaign.lock"
    lock_path.write_text(
        json.dumps({"pid": 999_999_999, "acquired_at": time.time()}),
        encoding="utf-8",
    )

    result = live_runner.run_live_turn(
        camp,
        char_path,
        "inv1",
        "我检查桌上的文件。",
        intent_class="investigate",
        recording_mode="sync",
        rng_seed=25,
    )

    assert result["turns"]
    assert not lock_path.exists()


def test_live_turn_envelope_grounds_reveals_scene_npc_and_rule_results(tmp_path):
    """Narration envelope must carry player-safe clue bodies, scene anchors, npc seeds."""
    camp, char_path = _build_live_campaign(tmp_path)
    scn = camp / "scenario"
    char = json.loads(char_path.read_text(encoding="utf-8"))
    char["name"] = "艾达·金"
    char_path.write_text(json.dumps(char, ensure_ascii=False), encoding="utf-8")

    story = json.loads((scn / "story-graph.json").read_text(encoding="utf-8"))
    story["scenes"][0].update({
        "display_name": "诺特的事务所",
        "sensory_anchors": ["咖啡渣味", "雨打窗玻璃"],
        "tone": ["dust", "daylight"],
        "npc_ids": ["npc-knott"],
    })
    (scn / "story-graph.json").write_text(json.dumps(story, ensure_ascii=False), encoding="utf-8")

    clues = json.loads((scn / "clue-graph.json").read_text(encoding="utf-8"))
    clues["conclusions"][0]["clues"][0]["player_safe_summary"] = "桌上放着一把黄铜钥匙"
    (scn / "clue-graph.json").write_text(json.dumps(clues, ensure_ascii=False), encoding="utf-8")

    (scn / "npc-agendas.json").write_text(json.dumps({
        "npcs": [{
            "npc_id": "npc-knott",
            "name": "Steven Knott",
            "agenda": "wants the house cleared",
            "fear": "losing money",
            "secret": "knows only rumor",
            "voice": "Practical and impatient.",
            "relationship_to_investigators": "employer",
            "reaction_triggers": [{
                "when": "always",
                "move": "nudge",
                "line_seed": "钥匙在桌上，今天就定下来吧。",
                "visibility": "player_visible",
            }],
        }],
    }, ensure_ascii=False), encoding="utf-8")

    result = live_runner.run_live_turn(
        camp,
        char_path,
        "inv1",
        "我检查桌上的钥匙。",
        intent_class="investigate",
        recording_mode="sync",
        rng_seed=31,
    )
    turn = result["turns"][0]
    env = turn["narration_envelope"]

    assert env["scene_anchor"]["display_name"] == "诺特的事务所"
    assert "咖啡渣味" in env["scene_anchor"]["sensory_anchors"]

    clues_payload = env["approved_reveals"].get("clues") or []
    if env["approved_reveals"].get("clue_ids"):
        assert any(
            c.get("player_safe_summary") == "桌上放着一把黄铜钥匙"
            for c in clues_payload
        )

    assert "rule_results" in env
    assert isinstance(env["rule_results"], list)
    for rr in env["rule_results"]:
        assert "roll" not in rr
        assert "target" not in rr
        if rr.get("skill"):
            assert rr.get("investigator_display_name") == "艾达·金"

    npc_moves = env.get("npc_moves") or []
    if npc_moves:
        assert npc_moves[0].get("display_name") == "Steven Knott"
        assert npc_moves[0].get("dialogue_seed")
        assert "knows only rumor" not in json.dumps(npc_moves, ensure_ascii=False)


def test_live_turn_exposes_normalized_subsystem_results_and_passes_them_to_apply(
    tmp_path,
    monkeypatch,
):
    camp, char_path = _build_live_campaign(tmp_path)
    clue_graph = json.loads((camp / "scenario" / "clue-graph.json").read_text())
    clue_graph["conclusions"][0]["clues"][0].update({
        "delivery_kind": "skill_check",
        "skill": "Spot Hidden",
        "difficulty": "regular",
    })
    (camp / "scenario" / "clue-graph.json").write_text(json.dumps(clue_graph))
    apply_calls = []
    real_apply = live_runner.apply_mod.apply_plan

    def capturing_apply(*args, **kwargs):
        apply_calls.append(kwargs.get("rules_results"))
        return real_apply(*args, **kwargs)

    monkeypatch.setattr(live_runner.apply_mod, "apply_plan", capturing_apply)
    result = live_runner.run_live_turn(
        camp,
        char_path,
        "inv1",
        "我检查桌上的文件。",
        intent_class="investigate",
        recording_mode="sync",
        max_auto_advance=1,
        rng_seed=37,
    )

    turn = result["turns"][0]
    assert turn["subsystem_results"]
    assert result["subsystem_results"] == turn["subsystem_results"]
    assert result["pending_choice"] is None
    assert apply_calls == [turn["subsystem_results"]]
    for subsystem_result in turn["subsystem_results"]:
        assert set(subsystem_result) == {
            "command_id",
            "kind",
            "status",
            "events",
            "pending_choice",
            "state_refs",
        }
    assert turn["rule_results"] == [
        event
        for subsystem_result in turn["subsystem_results"]
        for event in subsystem_result["events"]
    ]


def test_live_turn_returns_current_stable_pending_choice(tmp_path):
    camp, char_path = _build_live_campaign(tmp_path)
    offered = _persist_live_push_offer(camp, char_path)
    assert offered["pending_choice"]["choice_id"] == "live-push-offer:confirm"

    state_before = json.loads((camp / "save" / "subsystem-state.json").read_text())
    side_effect_paths = [
        camp / "save" / "world-state.json",
        camp / "save" / "pacing-state.json",
        camp / "save" / "time-state.json",
        camp / "save" / "time-triggers.json",
        camp / "save" / "apply-ledger.json",
        camp / "logs" / "rolls.jsonl",
        camp / "logs" / "events.jsonl",
        camp / "logs" / "time.jsonl",
    ]
    side_effects_before = {
        path: path.read_bytes() if path.exists() else None
        for path in side_effect_paths
    }
    blocked = live_runner.run_live_turn(
        camp,
        char_path,
        "inv1",
        "我先做别的调查。",
        intent_class="investigate",
        recording_mode="sync",
        max_auto_advance=1,
        rng_seed=39,
    )

    assert blocked["pending_choice"] == offered["pending_choice"]
    assert blocked["auto_advance"]["stop_reason"] == "pending_subsystem_choice"
    assert blocked["turns"][0]["blocked_by_pending_choice"] is True
    assert blocked["turns"][0]["subsystem_results"] == []
    state_after = json.loads((camp / "save" / "subsystem-state.json").read_text())
    assert state_after["applied_command_ids"] == state_before["applied_command_ids"]
    assert {
        path: path.read_bytes() if path.exists() else None
        for path in side_effect_paths
    } == side_effects_before


def test_live_turn_consumes_typed_push_cancel_before_intent_routing(tmp_path, monkeypatch):
    camp, char_path = _build_live_campaign(tmp_path)
    offered = _persist_live_push_offer(camp, char_path)
    choice = offered["pending_choice"]
    monkeypatch.setattr(
        live_runner,
        "_resolve_turn_intent",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("pending response must bypass intent routing")
        ),
    )

    result = live_runner.run_live_turn(
        camp,
        char_path,
        "inv1",
        "",
        pending_choice_response={
            "choice_id": choice["choice_id"],
            "responder": "player",
            "revision": choice["revision"],
            "action": "cancel",
        },
        recording_mode="sync",
        max_auto_advance=1,
        rng_seed=39,
    )

    assert result["intent_resolution"]["source"] == "pending_choice_response"
    assert [row["status"] for row in result["subsystem_results"]] == ["cancelled"]
    assert result["pending_choice"] is None
    assert result["turns"][0]["rules_requests"][0]["kind"] == "push_confirm"


def test_live_turn_confirms_push_and_replays_same_resume_without_second_roll(tmp_path):
    camp, char_path = _build_live_campaign(tmp_path)
    offered = _persist_live_push_offer(camp, char_path)
    choice = offered["pending_choice"]
    response = {
        "choice_id": choice["choice_id"],
        "responder": "player",
        "revision": choice["revision"],
        "action": "confirm",
    }
    rng = random.Random(1)
    result = live_runner.run_live_turn(
        camp,
        char_path,
        "inv1",
        "",
        pending_choice_response=response,
        recording_mode="sync",
        max_auto_advance=1,
        rng=rng,
    )
    rng_after = rng.getstate()
    replay = live_runner.run_live_turn(
        camp,
        char_path,
        "inv1",
        "",
        pending_choice_response=response,
        recording_mode="sync",
        max_auto_advance=1,
        rng=rng,
    )

    assert [row["kind"] for row in result["subsystem_results"]] == [
        "push_confirm",
        "push_resolve",
    ]
    assert result["subsystem_results"][-1]["events"][0]["pushed"] is True
    assert replay["subsystem_results"] == result["subsystem_results"]
    assert rng.getstate() == rng_after


def test_live_turn_keeper_tick_advances_bout_with_typed_response(tmp_path, monkeypatch):
    camp, char_path = _build_live_campaign(tmp_path)
    started = _persist_live_realtime_bout(camp, char_path)
    choice = started["pending_choice"]
    sanity_before = json.loads((camp / "save" / "sanity.json").read_text())
    monkeypatch.setattr(
        live_runner,
        "_resolve_turn_intent",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("Keeper bout progression must bypass intent routing")
        ),
    )
    result = live_runner.run_live_turn(
        camp,
        char_path,
        "inv1",
        "",
        pending_choice_response={
            "choice_id": choice["choice_id"],
            "responder": "keeper",
            "revision": choice["revision"],
            "action": "tick",
        },
        recording_mode="sync",
        max_auto_advance=1,
        rng_seed=40,
    )
    sanity_after = json.loads((camp / "save" / "sanity.json").read_text())

    assert result["subsystem_results"][0]["kind"] == "bout_tick"
    assert sanity_after["bout_rounds_remaining"] == sanity_before["bout_rounds_remaining"] - 1
    if sanity_after["bout_active"]:
        assert result["pending_choice"]["responder"] == "keeper"
        assert result["pending_choice"]["revision"] == choice["revision"] + 1


def test_live_failed_roll_offers_push_through_typed_production_request_then_cancels(
    tmp_path,
):
    camp, char_path = _build_live_campaign(tmp_path)
    origin = _run_failed_live_origin(camp, char_path)
    assert origin["events"][0]["resolution_context"]["scene_action"] == "REVEAL"

    offered = live_runner.run_live_turn(
        camp,
        char_path,
        "inv1",
        "",
        subsystem_request={
            "kind": "push_offer",
            "original_command_id": origin["command_id"],
            "changed_method_evidence": {
                "changed": True,
                "source": "player_proposal",
                "summary": "inspect paper impressions instead of rereading",
            },
            "announced_consequence": {
                "summary": "the watcher identifies the investigator",
                "effect": {
                    "kind": "fictional_position",
                    "severity": "serious",
                },
            },
        },
        recording_mode="sync",
        max_auto_advance=1,
        rng_seed=225,
    )
    choice = offered["pending_choice"]
    assert offered["subsystem_results"][0]["kind"] == "push_offer"
    assert choice["kind"] == "push_confirm"
    envelope_json = json.dumps(
        offered["turns"][0]["narration_envelope"], ensure_ascii=False
    )
    assert "the watcher identifies the investigator" in envelope_json
    assert "keeper_secret" not in envelope_json
    assert "hidden cult leader" not in envelope_json

    cancelled = live_runner.run_live_turn(
        camp,
        char_path,
        "inv1",
        "",
        pending_choice_response={
            "choice_id": choice["choice_id"],
            "responder": "player",
            "revision": choice["revision"],
            "action": "cancel",
        },
        recording_mode="sync",
        max_auto_advance=1,
        rng_seed=226,
    )

    assert cancelled["subsystem_results"][0]["status"] == "cancelled"
    assert cancelled["pending_choice"] is None


def test_live_pushed_failure_applies_announced_consequence_once_across_replay(tmp_path):
    camp, char_path = _build_live_campaign(tmp_path)
    origin = _run_failed_live_origin(camp, char_path)
    offered = live_runner.run_live_turn(
        camp,
        char_path,
        "inv1",
        "",
        subsystem_request={
            "kind": "push_offer",
            "original_command_id": origin["command_id"],
            "changed_method_evidence": {
                "changed": True,
                "source": "player_proposal",
                "summary": "inspect paper impressions instead of rereading",
            },
            "announced_consequence": {
                "summary": "the watcher identifies the investigator",
                "effect": {"kind": "fictional_position", "severity": "serious"},
            },
        },
        recording_mode="sync",
        max_auto_advance=1,
        rng_seed=227,
    )
    choice = offered["pending_choice"]
    response = {
        "choice_id": choice["choice_id"],
        "responder": "player",
        "revision": choice["revision"],
        "action": "confirm",
    }
    first = live_runner.run_live_turn(
        camp,
        char_path,
        "inv1",
        "",
        pending_choice_response=response,
        recording_mode="sync",
        max_auto_advance=1,
        rng_seed=5,
    )
    assert first["subsystem_results"][-1]["events"][0]["outcome"] == "failure"
    narration_json = json.dumps(
        first["turns"][0]["narration_envelope"], ensure_ascii=False
    )
    assert "the watcher identifies the investigator" in narration_json
    assert '"effect"' not in narration_json
    assert '"pending_contexts"' not in narration_json
    event_log = camp / "logs" / "events.jsonl"
    rows_after_first = [
        json.loads(line) for line in event_log.read_text().splitlines() if line.strip()
    ]
    pushed_failures = [
        row for row in rows_after_first
        if (row.get("payload") or {}).get("event_type") == "pushed_roll_failure"
        or row.get("event_type") == "pushed_roll_failure"
    ]
    assert len(pushed_failures) == 1

    replay = live_runner.run_live_turn(
        camp,
        char_path,
        "inv1",
        "",
        pending_choice_response=response,
        recording_mode="sync",
        max_auto_advance=1,
        rng_seed=228,
    )
    assert replay["subsystem_results"] == first["subsystem_results"]
    assert [
        json.loads(line) for line in event_log.read_text().splitlines() if line.strip()
    ] == rows_after_first


def test_live_typed_combat_start_attack_and_defense_journey(tmp_path):
    camp, char_path = _build_live_campaign(tmp_path)
    inv_path = camp / "save" / "investigator-state" / "inv1.json"
    inv = json.loads(inv_path.read_text(encoding="utf-8"))
    inv.update({"current_hp": 11, "conditions": []})
    inv_path.write_text(json.dumps(inv), encoding="utf-8")

    start_payload = {
        "decision_id": "live-combat", "combat_id": "live-fight",
        "scene_ref": "scene/live-fight", "turn_number": 1,
        "participants": [
            {"actor_id": "inv1", "side": "investigator", "dex": 60,
             "combat_skill": 60, "dodge_skill": 40, "build": 0,
             "hp_max": 11, "hp_current": 11, "con": 60,
             "weapons": [{"weapon_id": "unarmed"}], "conditions": []},
            {"actor_id": "cultist", "side": "npc", "dex": 70,
             "combat_skill": 45, "dodge_skill": 25, "build": 0,
             "hp_max": 9, "hp_current": 9, "con": 45,
             "weapons": [{"weapon_id": "unarmed"}], "conditions": []},
        ],
    }
    started = live_runner.run_live_turn(
        camp, char_path, "inv1", "", subsystem_request={
            "kind": "combat_start", "payload": start_payload,
        }, recording_mode="sync", max_auto_advance=1, rng_seed=501,
    )
    assert started["subsystem_results"][0]["kind"] == "combat_start"

    declared = live_runner.run_live_turn(
        camp, char_path, "inv1", "", subsystem_request={
            "kind": "combat_attack", "payload": {
                "decision_id": "live-combat", "revision": 1,
                "actor_id": "cultist", "target_actor_id": "inv1",
                "declared_intent": "structured strike",
                "resolution_hint": "opposed_melee", "weapon_id": "unarmed",
            },
        }, recording_mode="sync", max_auto_advance=1, rng_seed=502,
    )
    defense_request = declared["subsystem_results"][0]["events"][0]
    assert defense_request["event_type"] == "combat_defense_required"

    defended = live_runner.run_live_turn(
        camp, char_path, "inv1", "I get out of the way.",
        intent_class="combat",
        player_intent_rich={
            "primary_intent": "combat",
            "combat_defense": {
                "kind": "dodge",
                "attack_command_id": defense_request["attack_command_id"],
            },
        },
        recording_mode="sync", max_auto_advance=1, rng_seed=503,
    )
    event = defended["subsystem_results"][0]["events"][0]
    assert event["event_type"] == "combat_turn_resolved"
    assert event["turn"]["defense_kind"] == "dodge"


def test_live_npc_defense_is_keeper_typed_and_not_player_projected(tmp_path):
    camp, char_path = _build_live_campaign(tmp_path)
    inv_path = camp / "save" / "investigator-state" / "inv1.json"
    inv = json.loads(inv_path.read_text(encoding="utf-8"))
    inv.update({"current_hp": 11, "conditions": []})
    inv_path.write_text(json.dumps(inv), encoding="utf-8")
    live_runner.run_live_turn(
        camp, char_path, "inv1", "", subsystem_request={
            "kind": "combat_start", "payload": {
                "decision_id": "npc-defense", "combat_id": "npc-fight",
                "scene_ref": "scene/npc-fight", "turn_number": 1,
                "participants": [
                    {"actor_id": "inv1", "side": "investigator", "dex": 80,
                     "combat_skill": 60, "dodge_skill": 40, "build": 0,
                     "hp_max": 11, "hp_current": 11, "con": 60,
                     "weapons": [{"weapon_id": "unarmed"}], "conditions": []},
                    {"actor_id": "cultist", "side": "npc", "dex": 50,
                     "combat_skill": 45, "dodge_skill": 25, "build": 0,
                     "hp_max": 9, "hp_current": 9, "con": 45,
                     "weapons": [{"weapon_id": "unarmed"}], "conditions": []},
                ],
            },
        }, recording_mode="sync", max_auto_advance=1, rng_seed=601,
    )
    declared = live_runner.run_live_turn(
        camp, char_path, "inv1", "", subsystem_request={
            "kind": "combat_attack", "payload": {
                "decision_id": "npc-defense", "revision": 1,
                "actor_id": "inv1", "target_actor_id": "cultist",
                "declared_intent": "structured strike",
                "resolution_hint": "opposed_melee", "weapon_id": "unarmed",
            },
        }, recording_mode="sync", max_auto_advance=1, rng_seed=602,
    )
    attack_id = declared["subsystem_results"][0]["events"][0]["attack_command_id"]
    assert declared["turns"][0]["pending_choice"] is None
    defended = live_runner.run_live_turn(
        camp, char_path, "inv1", "", subsystem_request={
            "kind": "combat_defend", "payload": {
                "decision_id": "keeper-npc-defense", "revision": 2,
                "actor_id": "cultist", "attack_command_id": attack_id,
                "defense_kind": "dodge",
            },
        }, recording_mode="sync", max_auto_advance=1, rng_seed=603,
    )
    assert defended["subsystem_results"][0]["events"][0]["turn"]["defense_kind"] == "dodge"


def test_live_director_routes_dying_state_through_rescue_engine(tmp_path):
    camp, char_path = _build_live_campaign(tmp_path)
    inv_path = camp / "save" / "investigator-state" / "inv1.json"
    inv = json.loads(inv_path.read_text(encoding="utf-8"))
    inv.update({
        "current_hp": 0,
        "conditions": ["major_wound", "dying", "unconscious"],
    })
    inv_path.write_text(json.dumps(inv), encoding="utf-8")

    result = live_runner.run_live_turn(
        camp, char_path, "inv1", "I hold on.",
        intent_class="reflect", recording_mode="sync", max_auto_advance=1,
        rng_seed=1,
    )

    assert result["turns"][0]["rules_requests"][0]["kind"] == "dying_tick"
    assert result["subsystem_results"][0]["kind"] == "dying_tick"
    event = result["subsystem_results"][0]["events"][0]
    assert event["event_type"] == "dying_con_roll"
    final_inv = json.loads(inv_path.read_text(encoding="utf-8"))
    assert ("dead" in final_inv["conditions"]) is event["died"]


def test_live_combat_injury_reload_rescue_and_treatment_journey_is_replay_safe(tmp_path):
    """One real live-turn journey proves injury, clocks, rescue and evidence."""
    camp, char_path = _build_live_campaign(tmp_path)
    inv_path = camp / "save" / "investigator-state" / "inv1.json"
    inv = json.loads(inv_path.read_text(encoding="utf-8"))
    inv.update({"current_hp": 6, "max_hp": 6, "conditions": []})
    inv_path.write_text(json.dumps(inv), encoding="utf-8")
    character = json.loads(char_path.read_text(encoding="utf-8"))
    character["characteristics"]["CON"] = 99
    character["derived"]["HP"] = 6
    char_path.write_text(json.dumps(character), encoding="utf-8")

    start_request = {
        "kind": "combat_start",
        "payload": {
            "decision_id": "injury-journey",
            "combat_id": "injury-journey",
            "scene_ref": "scene/injury-journey",
            "turn_number": 1,
            "participants": [
                {
                    "actor_id": "inv1", "side": "investigator", "dex": 50,
                    "combat_skill": 60, "dodge_skill": 40, "build": 0,
                    "hp_max": 6, "hp_current": 6, "con": 99,
                    "weapons": [{"weapon_id": "unarmed"}], "conditions": [],
                },
                {
                    "actor_id": "cultist", "side": "npc", "dex": 70,
                    "combat_skill": 150, "dodge_skill": 25, "build": 0,
                    "hp_max": 9, "hp_current": 9, "con": 45,
                    "weapons": [{
                        "weapon_id": "injury-pistol", "skill": "Firearms (Handgun)",
                        "damage": "6", "adds_damage_bonus": False,
                        "impales": False, "special": None,
                    }],
                    "conditions": [],
                },
            ],
        },
    }
    live_runner.run_live_turn(
        camp, char_path, "inv1", "", subsystem_request=start_request,
        recording_mode="sync", max_auto_advance=1, rng_seed=701,
    )
    declared = live_runner.run_live_turn(
        camp, char_path, "inv1", "", subsystem_request={
            "kind": "combat_attack",
            "payload": {
                "decision_id": "injury-journey", "revision": 1,
                "actor_id": "cultist", "target_actor_id": "inv1",
                "declared_intent": "structured lethal shot",
                "resolution_hint": "firearm_attack", "weapon_id": "injury-pistol",
            },
        }, recording_mode="sync", max_auto_advance=1, rng_seed=702,
    )
    choice = declared["turns"][0]["pending_choice"]
    assert choice["kind"] == "combat_defense"
    defended = live_runner.run_live_turn(
        camp, char_path, "inv1", "", pending_choice_response={
            "choice_id": choice["choice_id"], "responder": "player",
            "revision": choice["revision"], "action": "none",
        }, recording_mode="sync", max_auto_advance=1, rng_seed=703,
    )
    resolved = defended["subsystem_results"][0]["events"][0]
    assert resolved["turn"]["outcome"] == "hit"
    assert resolved["turn"]["damage_roll_id"]
    assert {"major_wound", "unconscious", "dying"} <= set(
        json.loads(inv_path.read_text(encoding="utf-8"))["conditions"]
    )

    combat_path = camp / "save" / "combat.json"
    persisted_combat = json.loads(combat_path.read_text(encoding="utf-8"))
    participant = next(
        row for row in persisted_combat["participants"] if row["actor_id"] == "inv1"
    )
    assert participant["hp_current"] == 0
    assert participant["major_wound_con"]["roll_id"]
    wound = json.loads(inv_path.read_text(encoding="utf-8"))["wound_ledger"][0]
    assert wound["source_damage_roll_id"] == resolved["turn"]["damage_roll_id"]
    assert wound["wound_id"] == (
        f"wound-{resolved['turn']['damage_roll_id'].replace(':', '-')}"
    )
    reloaded = live_runner.subsystem_executor.coc_combat.CombatSession.load(
        camp, rng=random.Random(999), damage_evidence=(
            live_runner.subsystem_executor.load_combat_damage_evidence(camp)
        )
    )
    assert reloaded.participants["inv1"]["conditions"] == participant["conditions"]
    reloaded_wound = json.loads(inv_path.read_text(encoding="utf-8"))["wound_ledger"][0]
    assert reloaded_wound == wound

    tick_request = {
        "kind": "dying_tick",
        "payload": {
            "decision_id": "injury-dying-tick", "clock_kind": "round",
        },
    }
    ticked = live_runner.run_live_turn(
        camp, char_path, "inv1", "", subsystem_request=tick_request,
        recording_mode="sync", max_auto_advance=1, rng_seed=1,
    )
    tick_event = ticked["subsystem_results"][0]["events"][0]
    assert tick_event["event_type"] == "dying_con_roll"
    assert tick_event["died"] is False
    rolls_before_replay = (camp / "logs" / "rolls.jsonl").read_text(encoding="utf-8")
    replayed_tick = live_runner.run_live_turn(
        camp, char_path, "inv1", "", subsystem_request=tick_request,
        recording_mode="sync", max_auto_advance=1, rng_seed=999,
    )
    assert replayed_tick["subsystem_results"] == ticked["subsystem_results"]
    assert (camp / "logs" / "rolls.jsonl").read_text(encoding="utf-8") == rolls_before_replay
    assert json.loads(inv_path.read_text(encoding="utf-8"))["wound_ledger"] == [wound]

    first_aid = live_runner.run_live_turn(
        camp, char_path, "inv1", "", subsystem_request={
            "kind": "stabilize",
            "payload": {
                "decision_id": "injury-first-aid", "method": "first_aid",
                "skill_value": 99,
            },
        }, recording_mode="sync", max_auto_advance=1, rng_seed=2,
    )
    aid_event = first_aid["subsystem_results"][0]["events"][0]
    assert aid_event["event_type"] == "first_aid_stabilize"
    stabilized = json.loads(inv_path.read_text(encoding="utf-8"))
    assert stabilized["current_hp"] == 1
    assert {"dying", "stabilized"} <= set(stabilized["conditions"])
    reloaded_after_aid = live_runner.subsystem_executor.coc_combat.CombatSession.load(
        camp, rng=random.Random(998), damage_evidence=(
            live_runner.subsystem_executor.load_combat_damage_evidence(camp)
        )
    )
    assert "stabilized" in reloaded_after_aid.participants["inv1"]["conditions"]

    medicine_request = {
        "kind": "stabilize",
        "payload": {
            "decision_id": "injury-medicine", "method": "medicine",
            "skill_value": 99,
        },
    }
    medicated = live_runner.run_live_turn(
        camp, char_path, "inv1", "", subsystem_request=medicine_request,
        recording_mode="sync", max_auto_advance=1, rng_seed=3,
    )
    medicine_event = medicated["subsystem_results"][0]["events"][0]
    assert medicine_event["event_type"] == "medicine"
    final_inv = json.loads(inv_path.read_text(encoding="utf-8"))
    assert final_inv["current_hp"] > 1
    assert "dying" not in final_inv["conditions"]
    assert "stabilized" not in final_inv["conditions"]
    final_combat = json.loads(combat_path.read_text(encoding="utf-8"))
    final_participant = next(
        row for row in final_combat["participants"] if row["actor_id"] == "inv1"
    )
    assert final_participant["hp_current"] == final_inv["current_hp"]
    assert final_participant["conditions"] == final_inv["conditions"]

    roll_rows = [
        json.loads(line)["payload"]
        for line in (camp / "logs" / "rolls.jsonl").read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert any(row.get("skill") == "HP Damage" for row in roll_rows)
    assert any(row.get("skill") == "CON" for row in roll_rows)
    assert any(row.get("skill") == "First Aid" for row in roll_rows)
    assert any(row.get("skill") == "Medicine" for row in roll_rows)
    assert any(row.get("skill") == "HP Healing" for row in roll_rows)
    assert all(
        isinstance(row.get("roll_id"), str)
        and isinstance(row.get("source_command_id"), str)
        and "dice" in row
        for row in roll_rows
    )
    rolls_before_medicine_replay = len(roll_rows)
    replayed_medicine = live_runner.run_live_turn(
        camp, char_path, "inv1", "", subsystem_request=medicine_request,
        recording_mode="sync", max_auto_advance=1, rng_seed=999,
    )
    assert replayed_medicine["subsystem_results"] == medicated["subsystem_results"]
    assert len([
        line for line in (camp / "logs" / "rolls.jsonl").read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]) == rolls_before_medicine_replay
