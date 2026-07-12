"""Tests for live_turn → Event mapping and debug adapter."""
from pathlib import Path
import importlib.util
import json


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, rel)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


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


def test_keeper_choice_frame_is_not_public_but_state_and_stop_reason_remain():
    mapper = _load("live_turn_mapper", "runtime/engine/live_turn_mapper.py")
    events_mod = _load("runtime_events", "runtime/engine/events.py")
    result = {
        "schema_version": 1,
        "turns": [{
            "decision_id": "turn-001",
            "choice_frame": {
                "id": "onboarding",
                "prompt": "你有现成的剧本吗？",
                "options": [
                    {"id": "import", "label": "我有剧本"},
                    {"id": "starter", "label": "新手开玩"},
                ],
            },
        }],
        "auto_advance": {"stop_reason": "awaiting_player_input", "turns_run": 1},
        "final_state": {"active_scene": "scene-1", "tension": "low", "turn_number": 1},
        "state_patch": {"applied": False},
        "stop_actionability": {"immediate_handles": [{"id": "look-around"}], "must_surface_handles": True},
    }
    events = mapper.map_live_turn_result(result)
    for ev in events:
        events_mod.validate_event(ev)
    types = [e["type"] for e in events]
    assert "choice" not in types
    assert "state_patch" in types
    assert "system" in types
    assert "onboarding" not in json.dumps(events, ensure_ascii=False)


def test_maps_narration_final_text_first():
    mapper = _load("live_turn_mapper", "runtime/engine/live_turn_mapper.py")
    events_mod = _load("runtime_events", "runtime/engine/events.py")
    result = {
        "turns": [{
            "decision_id": "turn-final",
            "narration": {"final_text": "你摸到门框上的细痕。"},
            "narrative_directives": {
                "narration": "directive fallback should not win",
            },
        }],
    }
    events = mapper.map_live_turn_result(result)
    for ev in events:
        events_mod.validate_event(ev)
    narrations = [e for e in events if e["type"] == "narration"]
    assert len(narrations) == 1
    assert narrations[0]["payload"]["text"] == "你摸到门框上的细痕。"


def test_rule_results_without_roll_do_not_emit_roll_event():
    mapper = _load("live_turn_mapper", "runtime/engine/live_turn_mapper.py")
    events_mod = _load("runtime_events", "runtime/engine/events.py")
    result = {
        "turns": [{
            "decision_id": "turn-no-roll",
            "rule_results": [{
                "kind": "skill_check",
                "outcome": "success",
                "skill": "Spot Hidden",
            }],
            "narrative_directives": {
                "must_include": ["director anchor: keep pressure on the door"],
            },
        }],
    }
    events = mapper.map_live_turn_result(result)
    for ev in events:
        events_mod.validate_event(ev)
    assert not any(e["type"] == "roll" for e in events)
    assert not any(e["type"] == "narration" for e in events)


def test_rule_results_with_roll_emit_roll_event():
    mapper = _load("live_turn_mapper", "runtime/engine/live_turn_mapper.py")
    events_mod = _load("runtime_events", "runtime/engine/events.py")
    result = {
        "turns": [{
            "decision_id": "turn-with-roll",
            "rule_results": [{
                "kind": "skill_check",
                "skill": "Library Use",
                "outcome": "regular_success",
                "roll": 42,
            }],
            "narration": {
                "final_text": "The shelves creak as you find a marked folio.",
            },
            "narrative_directives": {
                "keeper_narration": "PRIVATE DIRECTOR PROSE",
                "must_include": ["do not invent a second clue"],
            },
        }],
    }
    events = mapper.map_live_turn_result(result)
    for ev in events:
        events_mod.validate_event(ev)
    rolls = [e for e in events if e["type"] == "roll"]
    assert len(rolls) == 1
    assert rolls[0]["payload"]["roll"] == 42
    assert rolls[0]["payload"]["outcome"] == "regular_success"
    assert rolls[0]["payload"]["skill"] == "Library Use"
    narrations = [e for e in events if e["type"] == "narration"]
    assert len(narrations) == 1
    assert narrations[0]["payload"]["text"] == "The shelves creak as you find a marked folio."
    assert "PRIVATE DIRECTOR PROSE" not in json.dumps(events)


def test_combat_pending_defense_emits_player_choice_event():
    mapper = _load("live_turn_mapper_combat_choice", "runtime/engine/live_turn_mapper.py")
    pending = {
        "choice_id": "combat-defense:attack-1", "kind": "combat_defense",
        "command_id": "attack-1", "responder": "player", "revision": 2,
        "prompt": "Choose a legal combat defense.",
        "options": [{"action": "dodge", "label": "Dodge"}],
        "attack_id": "attack-1", "audience": "player",
    }
    events = mapper.map_live_turn_result({
        "turns": [{"decision_id": "combat-turn", "pending_choice": pending}],
    })
    choices = [event for event in events if event["type"] == "choice"]
    assert len(choices) == 1
    assert choices[0]["visibility"] == "player"
    assert choices[0]["payload"]["attack_id"] == "attack-1"


def test_session_ending_event_type_maps_to_player_safe_structured_event():
    mapper = _load("live_turn_mapper_terminal", "runtime/engine/live_turn_mapper.py")
    events = mapper.map_live_turn_result({
        "turns": [{
            "decision_id": "turn-terminal",
            "scene_id": "ending",
            "event_types": ["clue_reveal", "session_ending"],
            "narration_envelope": {"keeper_secret": "must never surface"},
        }],
    })

    terminal = [event for event in events if event["type"] == "session_ending"]
    assert terminal == [{
        "type": "session_ending",
        "id": terminal[0]["id"],
        "ts": terminal[0]["ts"],
        "visibility": "player",
        "payload": {
            "kind": "session_ending",
            "decision_id": "turn-terminal",
            "scene_id": "ending",
        },
    }]
    assert "keeper_secret" not in json.dumps(terminal)


def test_player_event_projection_strips_keeper_fields_and_paths():
    mapper = _load("live_turn_mapper_privacy_poison", "runtime/engine/live_turn_mapper.py")
    events = mapper.map_live_turn_result({
        "turns": [{
            "decision_id": "turn-poison",
            "scene_id": "ending",
            "event_types": ["session_ending"],
            "narration": {
                "final_text": "你听见门后的脚步。",
                "scenario_path": "/private/scenario.json",
                "keeper_text": "KEEPER-NARRATION",
            },
            "narrative_directives": {
                "keeper_narration": "KEEPER-DIRECTIVE",
            },
            "rule_results": [{
                "roll_id": "roll-public",
                "kind": "skill_check",
                "skill": "Spot Hidden",
                "target": 60,
                "difficulty": "regular",
                "roll": 42,
                "outcome": "regular_success",
                "success": True,
                "resolution_context": {"missed_clue_id": "PRIVATE-CLUE"},
                "_session_events": [{"keeper_secret": "KEEPER-ROLL"}],
                "missed_clue_id": "PRIVATE-CLUE",
            }],
            "choice_frame": {
                "id": "keeper-frame",
                "options": [{"label": "unsafe"}],
                "forbidden_reveal": "KEEPER-CHOICE",
            },
            "pending_choice": {
                "choice_id": "choice-public",
                "kind": "chase_action",
                "command_id": "command-public",
                "responder": "player",
                "revision": 1,
                "prompt": "Choose.",
                "options": [{
                    "action": "dodge",
                    "label": "Dodge",
                    "forbidden_reveal": "KEEPER-OPTION",
                }],
                "keeper_branch": "KEEPER-BRANCH",
                "audience": "keeper",
            },
        }],
        "final_state": {
            "active_scene": "ending",
            "tension": "high",
            "turn_number": 7,
            "scenario_path": "/private/final-state.json",
        },
        "state_patch": {
            "applied": True,
            "world_active_scene_updated": True,
            "active_scene_path": "/private/active-scene.json",
            "detail_pending_batch": "/private/pending.jsonl",
        },
    })

    by_type = {event["type"]: event for event in events}
    assert by_type["narration"]["payload"] == {
        "text": "你听见门后的脚步。",
        "decision_id": "turn-poison",
    }
    assert by_type["roll"]["payload"] == {
        "roll_id": "roll-public",
        "decision_id": "turn-poison",
        "kind": "skill_check",
        "skill": "Spot Hidden",
        "target": 60,
        "difficulty": "regular",
        "roll": 42,
        "outcome": "regular_success",
        "success": True,
    }
    assert [event["payload"] for event in events if event["type"] == "choice"] == [{
        "choice_id": "choice-public",
        "kind": "chase_action",
        "command_id": "command-public",
        "responder": "player",
        "revision": 1,
        "prompt": "Choose.",
        "options": [{"action": "dodge", "label": "Dodge"}],
        "decision_id": "turn-poison",
    }]
    assert by_type["state_patch"]["payload"] == {
        "final_state": {
            "active_scene": "ending",
            "tension": "high",
            "turn_number": 7,
        },
        "state_patch": {
            "applied": True,
            "world_active_scene_updated": True,
        },
    }
    assert by_type["session_ending"]["payload"] == {
        "kind": "session_ending",
        "decision_id": "turn-poison",
        "scene_id": "ending",
    }
    encoded = json.dumps(events, ensure_ascii=False)
    for secret in (
        "KEEPER-NARRATION", "KEEPER-DIRECTIVE", "KEEPER-ROLL",
        "PRIVATE-CLUE", "KEEPER-CHOICE", "KEEPER-OPTION", "KEEPER-BRANCH",
        "/private/",
    ):
        assert secret not in encoded


def test_debug_adapter_runs_live_turn(tmp_path):
    camp, char_path = _build_live_campaign(tmp_path)
    debug_adapter = _load("debug_adapter", "runtime/adapters/debug/adapter.py")
    events_mod = _load("runtime_events", "runtime/engine/events.py")

    events = debug_adapter.debug_send_turn(
        tmp_path,
        camp,
        char_path,
        "inv1",
        "我环顾四周。",
        intent_class="investigate",
        rng_seed=7,
        max_auto_advance=1,
        recording_mode="sync",
    )
    assert len(events) >= 1
    for ev in events:
        events_mod.validate_event(ev)
