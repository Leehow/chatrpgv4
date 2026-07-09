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


def test_maps_choice_frame_and_stop_reason():
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
    assert "choice" in types
    assert "state_patch" in types
    assert "system" in types
    choice = next(e for e in events if e["type"] == "choice")
    assert choice["payload"]["id"] == "onboarding"
    assert len(choice["payload"]["options"]) == 2


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
            "narrative_directives": {
                "narration": "The shelves creak as you find a marked folio.",
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
