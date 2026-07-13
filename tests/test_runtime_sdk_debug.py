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


def _structured_player_intent(primary_intent: str = "investigate") -> dict:
    return {
        "primary_intent": primary_intent,
        "secondary_intents": [],
        "target_entities": ["scene"],
        "risk_posture": "cautious",
        "explicit_roll_request": False,
        "player_hypothesis": None,
        "action_atoms": [{"topic": "room", "verb": "search"}],
        "npc_interactions": [],
    }


def _campaign_snapshot(campaign_dir: Path) -> dict[str, bytes]:
    return {
        path.relative_to(campaign_dir).as_posix(): path.read_bytes()
        for path in campaign_dir.rglob("*")
        if path.is_file()
    }


def _roll_payloads(campaign_dir: Path) -> list[dict]:
    return [
        json.loads(line)["payload"]
        for line in (campaign_dir / "logs" / "rolls.jsonl").read_text(
            encoding="utf-8"
        ).splitlines()
        if line.strip()
    ]


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
        "output_tokens", "fallback", "runner", "narrator",
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


def test_sdk_public_workspace_session_snapshot_restore_round_trip(tmp_path):
    _camp, _char = _build_live_campaign(tmp_path)
    (tmp_path / ".coc" / "runtime.json").write_text(
        json.dumps({"schema_version": 1, "brain": "debug"}),
        encoding="utf-8",
    )
    writer = _load("runtime_sdk_api_snapshot_writer", "runtime/sdk/api.py")
    sid = writer.create_session(
        tmp_path, campaign_id="live", investigator_id="inv1"
    )

    snapshot_path = writer.snapshot_workspace_sessions(tmp_path)
    assert snapshot_path == tmp_path / ".coc" / "runtime" / "sessions.json"

    reader = _load("runtime_sdk_api_snapshot_reader", "runtime/sdk/api.py")
    assert reader.restore_workspace_sessions(tmp_path) == [sid]
    assert reader.get_state(sid) == writer.get_state(sid)


@pytest.mark.parametrize(
    ("primary_intent", "player_input"),
    [
        ("investigate", "我仔细搜查房间。"),
        ("social", "我谨慎地询问在场的人。"),
    ],
)
def test_sdk_records_structured_caller_intent_and_turn_seed(
    tmp_path, primary_intent, player_input,
):
    camp, _char = _build_live_campaign(tmp_path)
    (tmp_path / ".coc" / "runtime.json").write_text(
        json.dumps({"schema_version": 1, "brain": "debug"}),
        encoding="utf-8",
    )
    api = _load(
        f"runtime_sdk_api_structured_{primary_intent}", "runtime/sdk/api.py"
    )
    sid = api.create_session(tmp_path, campaign_id="live", investigator_id="inv1")
    intent = _structured_player_intent(primary_intent)
    seed = f"run-a:{primary_intent}:0001"

    events = api.send(
        sid,
        player_input,
        player_intent=intent,
        rng_seed=seed,
    )

    assert events
    receipt = json.loads(
        (camp / "logs" / "live-turn-runtime.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()[-1]
    )
    assert receipt["intent_resolution"] == {
        "source": "caller_intent_class",
        "intent_class": primary_intent,
    }
    assert receipt["rng_seed"] == seed
    assert seed not in json.dumps(events, ensure_ascii=False)


def test_sdk_same_seed_and_pre_turn_snapshot_replay_identical_roll_payloads(
    tmp_path,
):
    payloads: list[list[dict]] = []
    for run_name in ("first", "replay"):
        workspace = tmp_path / run_name
        camp, _char = _build_live_campaign(workspace)
        (workspace / ".coc" / "runtime.json").write_text(
            json.dumps({"schema_version": 1, "brain": "debug"}),
            encoding="utf-8",
        )
        api = _load(f"runtime_sdk_api_seed_{run_name}", "runtime/sdk/api.py")
        sid = api.create_session(
            workspace, campaign_id="live", investigator_id="inv1"
        )
        intent = _structured_player_intent()
        intent["explicit_roll_request"] = True
        intent["action_atoms"] = [{
            "id": "search-room",
            "topic": "room",
            "verb": "search",
            "skill": "Spot Hidden",
            "difficulty": "regular",
            "stakes": "The search costs time.",
        }]

        api.send(
            sid,
            "我仔细搜查房间。",
            player_intent=intent,
            rng_seed="run-a:roll:0001",
        )
        payloads.append(_roll_payloads(camp))

    assert payloads[0]
    assert payloads[0] == payloads[1]


@pytest.mark.parametrize(
    ("player_intent", "rng_seed"),
    [
        ({"primary_intent": "investigate"}, None),
        ({**_structured_player_intent(), "unexpected": "field"}, None),
        ({**_structured_player_intent(), "primary_intent": "guess"}, None),
        (
            {
                **_structured_player_intent(),
                "action_atoms": [{"topic": "room", "opaque": object()}],
            },
            None,
        ),
        (_structured_player_intent(), True),
        (_structured_player_intent(), ["run-a", 1]),
    ],
)
def test_sdk_rejects_malformed_structured_turn_before_campaign_mutation(
    tmp_path, player_intent, rng_seed,
):
    camp, _char = _build_live_campaign(tmp_path)
    (tmp_path / ".coc" / "runtime.json").write_text(
        json.dumps({"schema_version": 1, "brain": "debug"}),
        encoding="utf-8",
    )
    api = _load("runtime_sdk_api_reject_structured", "runtime/sdk/api.py")
    sid = api.create_session(tmp_path, campaign_id="live", investigator_id="inv1")
    before = _campaign_snapshot(camp)

    with pytest.raises((TypeError, ValueError)):
        api.send(
            sid,
            "我仔细搜查房间。",
            player_intent=player_intent,
            rng_seed=rng_seed,
        )

    assert _campaign_snapshot(camp) == before


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
            return [{
                "type": "narration",
                "id": "evt-template",
                "ts": "2026-07-12T00:00:00Z",
                "visibility": "player",
                "payload": {
                    "text": "门后的动静仍被雨声遮住。",
                    "decision_id": "turn-pi-safe",
                },
            }], {
                "turns": [{
                    "decision_id": "turn-pi-safe",
                    "narration_envelope": {
                        "decision_id": "turn-pi-safe",
                        "keeper_secrets": ["never-forward"],
                    },
                }],
                "runtime_phase_ms": {},
                "runtime_receipt_sha256": "0" * 64,
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
            return {
                "ok": True,
                "final_text": "雨声压住了门后的脚步。",
                "secret_audit_complete": True,
                "asserted_fact_refs": [],
                "semantic_audit": [],
                "model_identity": {
                    "provider": "zhipu-coding", "id": "glm-5.2",
                },
                "response_mode": "tool",
            }
        def close_scope(self, key):
            self.closed.append(dict(key))

    monkeypatch.setattr(session, "_load_debug_adapter", lambda: Debug)
    monkeypatch.setattr(session, "_load_pi_adapter", lambda: Pi)
    pool = Pool()
    session._REGISTRY._worker_pool = pool
    sid = session.create_session(tmp_path, campaign_id="live", investigator_id="inv1")
    events = session.send(sid, "我等着听门后。")
    session.send(sid, "我再听一轮。")
    assert calls and events[-1]["payload"]["text"].startswith("雨声压住")
    assert len(pool.keys) == 2 and pool.keys[0] == pool.keys[1]
    telemetry = session.get_telemetry_receipts(sid)[-1]["telemetry"]
    assert telemetry["runner"]["worker"] == "jsonl_pool"
    assert telemetry["fallback"] is False
    assert telemetry["narrator"]["deterministic_fallback"] is False
    assert telemetry["narrator"]["consistent"] is True
    session.close_session(sid)
    assert pool.closed == [pool.keys[0]]


def test_sdk_last_turn_attestation_uses_observed_glm_and_durable_receipt(
    tmp_path, monkeypatch
):
    camp, _char = _build_live_campaign(tmp_path)
    (tmp_path / ".coc" / "runtime.json").write_text(json.dumps({
        "schema_version": 2,
        "planner": {"kind": "deterministic"},
        "rules": {"kind": "deterministic"},
        "narrator": {"kind": "pi"},
        "player": {"kind": "human"},
    }), encoding="utf-8")
    api = _load("runtime_sdk_api_glm_attestation", "runtime/sdk/api.py")

    class Pi:
        @staticmethod
        def pi_narrate(_request, *, worker_pool, worker_key):
            return {
                "ok": True,
                "final_text": "门锁上有一道新鲜的刮痕。",
                "secret_audit_complete": True,
                "asserted_fact_refs": [],
                "semantic_audit": [],
                "model_identity": {"provider": "zhipu-coding", "id": "glm-5.2"},
                "response_mode": "tool",
                "usage": {"input_tokens": 21, "output_tokens": 7},
            }

    class Pool:
        def close_scope(self, _key):
            pass

    monkeypatch.setattr(api._session, "_load_pi_adapter", lambda: Pi)
    api._session._REGISTRY._worker_pool = Pool()
    sid = api.create_session(tmp_path, campaign_id="live", investigator_id="inv1")
    api.send(
        sid,
        "我检查门锁。",
        player_intent=_structured_player_intent(),
        rng_seed="masks-run-a-20260712:000001",
        durability_mode="checkpoint",
    )

    attestation = api.get_last_turn_attestation(sid)
    assert attestation["session_id"] == sid
    assert attestation["recording_mode"] == "sync"
    assert attestation["recording_flush"] == "manual"
    assert len(attestation["runtime_receipt_sha256"]) == 64
    assert attestation["decision_ids"]
    assert attestation["usage"] == {"input_tokens": 21, "output_tokens": 7}
    assert isinstance(attestation["narrator_llm_ms"], float)
    assert attestation["narrator_llm_ms"] >= 0.0
    assert attestation["narrator"] == {
        "call_count": 1,
        "model_identity": {"provider": "zhipu-coding", "id": "glm-5.2"},
        "response_mode": "tool",
        "consistent": True,
        "deterministic_fallback": False,
    }
    assert isinstance(attestation.get("secret_audits"), list)
    assert len(attestation["secret_audits"]) == 1
    assert attestation["secret_audits"][0]["passed"] is True
    audit_path = camp / "logs" / "narrator-secret-audits.jsonl"
    assert audit_path.is_file()
    audit_rows = [
        json.loads(line)
        for line in audit_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert len(audit_rows) == 1
    assert audit_rows[0]["runtime_receipt_sha256"] == attestation["runtime_receipt_sha256"]
    assert audit_rows[0]["secret_audits"] == attestation["secret_audits"]
    raw = (camp / "logs" / "runtime-telemetry.jsonl").read_text(encoding="utf-8")
    assert "zhipu-coding" in raw and "glm-5.2" in raw
    assert "我检查门锁" not in raw

    with (camp / "logs" / "runtime-telemetry.jsonl").open(
        "a", encoding="utf-8"
    ) as handle:
        handle.write("{malformed-tail\n")
    with pytest.raises(RuntimeError, match="attestation|receipt"):
        api.get_last_turn_attestation(sid)


def test_sdk_last_turn_attestation_binds_exact_session_not_global_tail(tmp_path):
    _camp, _char = _build_live_campaign(tmp_path)
    (tmp_path / ".coc" / "runtime.json").write_text(json.dumps({
        "schema_version": 2,
        "planner": {"kind": "deterministic"},
        "rules": {"kind": "deterministic"},
        "narrator": {"kind": "template"},
        "player": {"kind": "human"},
    }), encoding="utf-8")
    api = _load("runtime_sdk_api_exact_session_attestation", "runtime/sdk/api.py")
    first = api.create_session(tmp_path, campaign_id="live", investigator_id="inv1")
    second = api.create_session(tmp_path, campaign_id="live", investigator_id="inv1")
    api.send(first, "第一轮。", durability_mode="checkpoint")
    first_attestation = api.get_last_turn_attestation(first)
    api.send(second, "第二轮。", durability_mode="checkpoint")

    assert api.get_last_turn_attestation(first) == first_attestation
    assert api.get_last_turn_attestation(second)["session_id"] == second


def test_sdk_marks_telemetry_failure_as_post_commit(tmp_path, monkeypatch):
    _camp, _char = _build_live_campaign(tmp_path)
    api = _load("runtime_sdk_api_telemetry_failure", "runtime/sdk/api.py")
    telemetry = api._session._load_telemetry_module()

    class FailingTelemetry:
        make_telemetry = staticmethod(telemetry.make_telemetry)

        @staticmethod
        def write_receipt(*_args, **_kwargs):
            raise OSError("disk full")

    monkeypatch.setattr(
        api._session, "_load_telemetry_module", lambda: FailingTelemetry
    )
    sid = api.create_session(tmp_path, campaign_id="live", investigator_id="inv1")

    with pytest.raises(api.TelemetryPersistenceError) as caught:
        api.send(sid, "我检查房间。", durability_mode="checkpoint")
    assert caught.value.kind == "telemetry_persistence_failed"
    assert caught.value.turn_committed is True


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
