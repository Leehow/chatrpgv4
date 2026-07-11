"""SDK session API tests for brain=debug."""
from __future__ import annotations

import importlib.util
import json
import random
from pathlib import Path

import pytest


def _load(name: str, rel: str):
    spec = importlib.util.spec_from_file_location(name, rel)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def _build_live_campaign(tmp_path: Path):
    """Copy of live-campaign fixture, rooted under workspace/.coc/ for the SDK."""
    coc = tmp_path / ".coc"
    camp = coc / "campaigns" / "live"
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
    char_dir = coc / "investigators" / "inv1"
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
    (camp / "campaign.json").write_text(json.dumps({
        "schema_version": 1,
        "campaign_id": "live",
        "play_language": "zh-CN",
    }))
    return camp, char_path


def test_sdk_debug_create_send_state_close(tmp_path):
    camp, _char = _build_live_campaign(tmp_path)
    (tmp_path / ".coc" / "runtime.json").write_text(
        json.dumps({"schema_version": 1, "brain": "debug"}),
        encoding="utf-8",
    )

    api = _load("runtime_sdk_api", "runtime/sdk/api.py")
    events_mod = _load("runtime_events", "runtime/engine/events.py")

    sid = api.create_session(
        tmp_path,
        campaign_id="live",
        investigator_id="inv1",
    )
    assert isinstance(sid, str) and sid

    events = api.send(sid, "我环顾四周。")
    assert isinstance(events, list) and len(events) >= 1
    for ev in events:
        events_mod.validate_event(ev)

    receipts = api.get_telemetry_receipts(sid)
    assert len(receipts) == 1
    telemetry = receipts[0]["telemetry"]
    assert set(telemetry) == {
        "intent_ms", "director_ms", "rules_ms", "persistence_ms",
        "player_llm_ms", "narrator_llm_ms", "total_ms", "input_tokens",
        "output_tokens", "fallback", "runner",
    }
    assert telemetry["total_ms"] >= sum(
        telemetry[key] for key in (
            "intent_ms", "director_ms", "rules_ms", "persistence_ms",
            "player_llm_ms", "narrator_llm_ms",
        )
    )
    assert "我环顾四周" not in (
        camp / "logs" / "runtime-telemetry.jsonl"
    ).read_text(encoding="utf-8")

    state = api.get_state(sid)
    assert state["campaign_id"] == "live"
    assert state["brain"] == "debug"
    assert state["schema_version"] == 1

    api.close_session(sid)
    with pytest.raises(Exception):
        api.send(sid, "再试一次。")


def test_sdk_debug_accepts_typed_rescue_request(tmp_path):
    camp, _char = _build_live_campaign(tmp_path)
    (tmp_path / ".coc" / "runtime.json").write_text(
        json.dumps({"schema_version": 1, "brain": "debug"}), encoding="utf-8"
    )
    inv_path = camp / "save" / "investigator-state" / "inv1.json"
    inv = json.loads(inv_path.read_text(encoding="utf-8"))
    inv.update({
        "current_hp": 0,
        "conditions": ["major_wound", "dying", "unconscious"],
    })
    inv_path.write_text(json.dumps(inv), encoding="utf-8")
    api = _load("runtime_sdk_api_typed_rescue", "runtime/sdk/api.py")
    sid = api.create_session(tmp_path, campaign_id="live", investigator_id="inv1")

    events = api.send(
        sid,
        "",
        subsystem_request={
            "kind": "dying_tick",
            "payload": {"decision_id": "sdk-rescue", "clock_kind": "round"},
        },
    )

    assert events
    state = json.loads(inv_path.read_text(encoding="utf-8"))
    assert "dying" in state["conditions"] or "dead" in state["conditions"]


def test_sdk_legacy_pi_runs_deterministic_turn_then_safe_narrator_only(tmp_path, monkeypatch):
    camp, _char = _build_live_campaign(tmp_path)
    (tmp_path / ".coc" / "runtime.json").write_text(
        json.dumps({"schema_version": 1, "brain": "pi"}), encoding="utf-8"
    )
    session = _load("runtime_session_pi_pending", "runtime/engine/session.py")
    calls: list[dict] = []

    class Debug:
        @staticmethod
        def debug_send_turn(*_args, **kwargs):
            assert kwargs["include_result"] is True
            return [], {
                "turns": [{
                    "decision_id": "turn-pi-safe",
                    "narration_envelope": {
                        "decision_id": "turn-pi-safe",
                        "keeper_secrets": ["never-forward"],
                    },
                }],
                "runtime_phase_ms": {},
            }

    class Pi:
        @staticmethod
        def pi_narrate(request, *, worker_pool, worker_key):
            calls.append(request)
            assert worker_pool is session._REGISTRY._worker_pool
            assert worker_key["session_id"] == sid
            assert worker_key["campaign_id"] == "live"
            assert worker_key["role"].startswith("narrator:")
            assert "keeper_secrets" not in request["narration_envelope"]
            return worker_pool.request(worker_key, request)

    class Pool:
        def __init__(self):
            self.keys = []
            self.closed = []
        def request(self, key, _request):
            self.keys.append(dict(key))
            return {"ok": True, "final_text": "雨声压住了门后的脚步。"}
        def close_scope(self, key):
            self.closed.append(dict(key))

    monkeypatch.setattr(session, "_load_debug_adapter", lambda: Debug)
    monkeypatch.setattr(session, "_load_pi_adapter", lambda: Pi)
    pool = Pool()
    session._REGISTRY._worker_pool = pool
    sid = session.create_session(tmp_path, campaign_id="live", investigator_id="inv1")
    events = session.send(sid, "我等着听门后。")
    session.send(sid, "我再听一轮。")
    assert calls and events[-1]["payload"]["text"].startswith("雨声")
    assert len(pool.keys) == 2 and pool.keys[0] == pool.keys[1]
    telemetry = session.get_telemetry_receipts(sid)[-1]["telemetry"]
    assert telemetry["runner"]["worker"] == "jsonl_pool"
    session.close_session(sid)
    assert pool.closed == [pool.keys[0]]


def test_sdk_debug_resolves_chase_pending_choice_action_only(tmp_path):
    camp, char_path = _build_live_campaign(tmp_path)
    (tmp_path / ".coc" / "runtime.json").write_text(
        json.dumps({"schema_version": 1, "brain": "debug"}), encoding="utf-8"
    )
    executor = _load("runtime_sdk_chase_executor", "plugins/coc-keeper/scripts/coc_subsystem_executor.py")
    start = {
        "command_id": "sdk-chase-start", "kind": "chase_start", "phase": "start",
        "payload": {"decision_id": "sdk-chase", "chase_id": "sdk-roof",
            "participants": [
                {"actor_id": "inv1", "side": "quarry", "mov": 8, "dex": 70, "con": 60,
                 "hp": 12, "fight": 60, "dodge": 40, "build": 0, "current_position": 0, "conditions": []},
                {"actor_id": "cultist", "side": "pursuer", "mov": 8, "dex": 50, "con": 50,
                 "hp": 9, "fight": 45, "dodge": 25, "build": 0, "current_position": 0, "conditions": []},
            ],
            "locations": [
                {"label": "roof", "hazard": None, "barrier": None},
                {"label": "door", "hazard": None, "barrier": {"barrier_id": "door", "hp": 4, "hp_max": 4, "skill": "Climb", "target": 100}},
            ]},
    }
    offer = {"command_id": "sdk-chase-offer", "kind": "chase_move", "phase": "resolve",
             "payload": {"decision_id": "sdk-chase", "revision": 1,
                         "actor_id": "inv1", "action_id": "choice:offer"}}
    executor.execute_commands(camp, char_path, "inv1", [start], rng=random.Random(1))
    offered = executor.execute_commands(camp, char_path, "inv1", [offer], rng=random.Random(2))[0]
    choice = offered["pending_choice"]
    api = _load("runtime_sdk_api_chase_pending", "runtime/sdk/api.py")
    sid = api.create_session(tmp_path, campaign_id="live", investigator_id="inv1")
    events = api.send(sid, "", pending_choice_response={
        "choice_id": choice["choice_id"], "responder": "player",
        "revision": choice["revision"], "action": "barrier:door:negotiate",
    })
    assert events
    assert executor.get_current_pending_choice(camp) is None
