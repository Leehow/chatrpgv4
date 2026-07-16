"""Public-runtime proof for durable playtest checkpoint generations."""

from __future__ import annotations

import copy
import importlib.util
import json
import os
from pathlib import Path

import pytest


REPO = Path(__file__).resolve().parents[1]


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


checkpoint = _load(
    "coc_playtest_checkpoint_runtime_test",
    REPO / "plugins" / "coc-keeper" / "scripts" / "coc_playtest_checkpoint.py",
)
toolbox = _load(
    "coc_toolbox_checkpoint_runtime_test",
    REPO / "plugins" / "coc-keeper" / "scripts" / "coc_toolbox.py",
)


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _build_live_campaign(workspace: Path) -> tuple[Path, Path]:
    """Build the public-runtime fixture locally instead of importing a test.

    The former fixture lived in the deleted debug-SDK test module, which made
    this checkpoint contract impossible to collect after the runtime refactor.
    """
    coc = workspace / ".coc"
    campaign = coc / "campaigns" / "live"
    scenario = campaign / "scenario"
    save = campaign / "save"
    logs = campaign / "logs"
    (save / "investigator-state").mkdir(parents=True)
    scenario.mkdir(parents=True)
    logs.mkdir(parents=True)
    (logs / "events.jsonl").write_text("", encoding="utf-8")
    (logs / "rolls.jsonl").write_text("", encoding="utf-8")
    _write_json(
        save / "world-state.json",
        {
            "schema_version": 1,
            "campaign_id": "live",
            "scenario_id": "live-mod",
            "active_scene_id": "scene-1",
            "discovered_clue_ids": [],
            "major_decisions": [],
        },
    )
    _write_json(
        save / "pacing-state.json",
        {
            "schema_version": 1,
            "tension_level": "low",
            "lethal_chances_used": 0,
            "recent_intent_classes": [],
            "turn_number": 0,
            "luck_spent_last": 0,
        },
    )
    _write_json(
        save / "investigator-state" / "inv1.json",
        {
            "schema_version": 1,
            "campaign_id": "live",
            "investigator_id": "inv1",
            "current_hp": 12,
            "current_san": 55,
            "current_mp": 11,
            "conditions": [],
            "skill_checks_earned": [],
        },
    )
    character = coc / "investigators" / "inv1" / "character.json"
    _write_json(
        character,
        {
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
            "skills": {
                "Spot Hidden": 60,
                "Library Use": 55,
                "Credit Rating": 50,
            },
            "backstory": {},
        },
    )
    _write_json(
        scenario / "story-graph.json",
        {
            "scenes": [
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
            ]
        },
    )
    _write_json(
        scenario / "clue-graph.json",
        {
            "conclusions": [
                {
                    "conclusion_id": "conclusion-1",
                    "importance": "critical",
                    "minimum_routes": 1,
                    "clues": [
                        {
                            "clue_id": "c1",
                            "delivery": "Handout",
                            "delivery_kind": "handout",
                            "visibility": "player-safe",
                        }
                    ],
                    "fallback_policy": "",
                }
            ]
        },
    )
    _write_json(scenario / "npc-agendas.json", {"npcs": []})
    _write_json(scenario / "threat-fronts.json", {"fronts": []})
    _write_json(scenario / "pacing-map.json", {"pacing_curve": []})
    _write_json(
        scenario / "improvisation-boundaries.json",
        {"invent_allowed": [], "never_invent": [], "keeper_secrets": []},
    )
    _write_json(
        scenario / "module-meta.json",
        {
            "schema_version": 1,
            "scenario_id": "live-mod",
            "structure_type": "linear_acts",
            "era": "1920s",
            "content_flags": [],
            "win_condition": "continue live play",
        },
    )
    _write_json(
        campaign / "campaign.json",
        {"schema_version": 1, "campaign_id": "live", "play_language": "zh-CN"},
    )
    return campaign, character


def _build_generation(workspace: Path) -> Path:
    campaign, _character = _build_live_campaign(workspace)
    _write_json(
        campaign / "party.json",
        {
            "schema_version": 1,
            "campaign_id": "live",
            "investigator_ids": ["inv1"],
            "active_investigator_ids": ["inv1"],
        },
    )
    _write_json(campaign / "index" / "page-map.json", {"pages": []})
    _write_json(campaign / "memory" / "belief-state.json", {"beliefs": []})
    (campaign / "source").mkdir(parents=True)
    (campaign / "source" / "fixture.txt").write_text(
        "public runtime checkpoint fixture\n", encoding="utf-8"
    )
    investigator = workspace / ".coc" / "investigators" / "inv1"
    _write_json(
        investigator / "creation.json",
        {"schema_version": 1, "investigator_id": "inv1"},
    )
    for name in ("history.jsonl", "development.jsonl", "inventory-history.jsonl"):
        (investigator / name).write_text("", encoding="utf-8")
    _prepare_local_provisioning(workspace)
    return campaign


def _prepare_local_provisioning(workspace: Path) -> None:
    coc = workspace / ".coc"
    _write_json(
        coc / "runtime.json",
        {
            "schema_version": 2,
            "planner": {"kind": "deterministic"},
            "rules": {"kind": "deterministic"},
            "narrator": {"kind": "template"},
            "player": {"kind": "human"},
        },
    )
    _write_json(
        coc / "indexes" / "campaigns.json",
        {
            "schema_version": 1,
            "campaigns": {
                "live": {
                    "campaign_id": "live",
                    "path": ".coc/campaigns/live/campaign.json",
                }
            },
        },
    )
    _write_json(
        coc / "indexes" / "investigators.json",
        {
            "schema_version": 1,
            "investigators": {
                "inv1": {
                    "id": "inv1",
                    "path": ".coc/investigators/inv1/character.json",
                }
            },
        },
    )
    (coc / "module-library").mkdir(parents=True, exist_ok=True)


def _force_sync_adapter(api) -> None:
    """Install the current keeper-agent boundary with synchronous fixture writes."""

    class SyncKeeperAdapter:
        @staticmethod
        def keeper_send_turn(request, **_kwargs):
            campaign = (
                Path(request["workspace"])
                / ".coc"
                / "campaigns"
                / request["campaign_id"]
            )
            world_path = campaign / "save" / "world-state.json"
            world = json.loads(world_path.read_text(encoding="utf-8"))
            player_input = request["player_input"]
            if player_input == "checkpoint:inspect":
                world["discovered_clue_ids"] = ["c1"]
                tool = "state.record_clue"
                narration = "The first lead is now durably recorded."
            elif player_input == "checkpoint:continue":
                world["active_scene_id"] = "scene-2"
                tool = "state.move_scene"
                narration = "The investigation continues into scene two."
            else:  # pragma: no cover - keeps fixture failure explicit.
                raise AssertionError(f"unexpected checkpoint fixture input: {player_input}")
            _write_json(world_path, world)
            log_path = campaign / "logs" / "toolbox-calls.jsonl"
            with log_path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps({
                    "tool": tool,
                    "ok": True,
                    "args": {"decision_id": player_input},
                    "warnings": [],
                }, sort_keys=True) + "\n")
                handle.flush()
                os.fsync(handle.fileno())
            return {
                "ok": True,
                "narration": narration,
                "model_identity": {
                    "provider": "fixture",
                    "id": "checkpoint-keeper",
                },
                "usage": {"input_tokens": 1, "output_tokens": 1},
            }

    api._session._load_keeper_adapter = lambda: SyncKeeperAdapter


def _tree_bytes(root: Path) -> dict[str, bytes]:
    return {
        path.relative_to(root).as_posix(): path.read_bytes()
        for path in sorted(root.rglob("*"))
        if path.is_file()
    }


def _stable_events(events: list[dict]) -> list[dict]:
    """Remove only documented per-emission wall-clock/UUID envelope fields."""

    return [
        {
            key: copy.deepcopy(value)
            for key, value in event.items()
            if key not in {"id", "ts"}
        }
        for event in events
    ]


def _last_jsonl_row(path: Path) -> dict:
    return json.loads(
        next(
            line
            for line in reversed(path.read_text(encoding="utf-8").splitlines())
            if line.strip()
        )
    )


def _restore_with_fresh_api(
    checkpoint_store, checkpoint_dir: Path, target: Path, name: str
):
    _prepare_local_provisioning(target)
    checkpoint_store.restore_checkpoint(checkpoint_dir, target)
    api = _load(name, REPO / "runtime" / "sdk" / "api.py")
    _force_sync_adapter(api)
    restored_ids = api._session._REGISTRY.restore(target)
    return api, restored_ids


def test_public_sdk_checkpoint_restores_state_and_seeded_continuation(
    tmp_path: Path,
):
    workspace = tmp_path / "generation-old"
    campaign = _build_generation(workspace)
    api = _load("runtime_checkpoint_api_source", REPO / "runtime" / "sdk" / "api.py")
    _force_sync_adapter(api)
    session_id = api.create_session(
        workspace, campaign_id="live", investigator_id="inv1"
    )
    pre_state = copy.deepcopy(api.get_state(session_id))
    first_events = api.send(
        session_id, "checkpoint:inspect", rng_seed="checkpoint:inspect"
    )
    checkpoint_state = copy.deepcopy(api.get_state(session_id))
    assert checkpoint_state["discovered_clue_ids"] == ["c1"]
    assert checkpoint_state["active_scene_id"] == "scene-1"
    api._session._REGISTRY.snapshot(workspace)

    receipt = _last_jsonl_row(campaign / "logs" / "live-turn-runtime.jsonl")
    assert receipt["recording_mode"] == "sync"
    assert receipt["recording_flush"] == "auto"
    attestation = api.get_last_turn_attestation(session_id)
    store = checkpoint.CheckpointStore(tmp_path / "run", workspace, "live", "inv1")
    store.append_turn(
        {"kind": "keeper_turn", "player_input": "checkpoint:inspect"},
        first_events,
        pre_state,
        checkpoint_state,
        {
            "player_mode": "whitebox",
            "model_identity": {
                "provider": "fixture",
                "id": "checkpoint-keeper",
            },
            "recording_mode": receipt["recording_mode"],
            "recording_flush": receipt["recording_flush"],
            "runtime_receipt_sha256": attestation["runtime_receipt_sha256"],
        },
    )
    checkpoint_dir = store.write_checkpoint(session_id, 1, "turn_complete")

    later_events = api.send(
        session_id,
        "checkpoint:continue",
        rng_seed="checkpoint:continue",
    )
    later_state = copy.deepcopy(api.get_state(session_id))
    later_attestation = api.get_last_turn_attestation(session_id)
    assert later_state["active_scene_id"] == "scene-2"
    store.append_turn(
        {"kind": "keeper_turn", "player_input": "checkpoint:continue"},
        later_events,
        checkpoint_state,
        later_state,
        {
            "player_mode": "whitebox",
            "model_identity": {
                "provider": "fixture",
                "id": "checkpoint-keeper",
            },
            "recording_mode": "sync",
            "recording_flush": "auto",
            "runtime_receipt_sha256": later_attestation["runtime_receipt_sha256"],
        },
    )
    assert store._turn_number == 2
    (campaign / "save" / "later.json").write_text("later", encoding="utf-8")
    api._session._REGISTRY.snapshot(workspace)
    old_generation_after_later_turn = _tree_bytes(workspace)

    restored_a = tmp_path / "generation-restored-a"
    api_a, restored_ids_a = _restore_with_fresh_api(
        store, checkpoint_dir, restored_a, "runtime_checkpoint_api_restored_a"
    )
    assert restored_ids_a == [session_id]
    assert api_a.get_state(session_id) == checkpoint_state
    assert not (
        restored_a / ".coc" / "campaigns" / "live" / "save" / "later.json"
    ).exists()
    events_a = api_a.send(
        session_id,
        "checkpoint:continue",
        rng_seed="checkpoint:continue",
    )
    state_a = api_a.get_state(session_id)

    restored_b = tmp_path / "generation-restored-b"
    api_b, restored_ids_b = _restore_with_fresh_api(
        store, checkpoint_dir, restored_b, "runtime_checkpoint_api_restored_b"
    )
    assert restored_ids_b == [session_id]
    assert api_b.get_state(session_id) == checkpoint_state
    events_b = api_b.send(
        session_id,
        "checkpoint:continue",
        rng_seed="checkpoint:continue",
    )
    state_b = api_b.get_state(session_id)

    assert _stable_events(events_a) == _stable_events(events_b)
    assert state_a == state_b
    assert _tree_bytes(workspace) == old_generation_after_later_turn
    campaign_a = restored_a / ".coc" / "campaigns" / "live"
    campaign_b = restored_b / ".coc" / "campaigns" / "live"
    assert campaign_a.stat().st_ino != campaign_b.stat().st_ino


@pytest.mark.parametrize("crash_stage", ["after_receipt", "after_row_before_ledger"])
def test_checkpoint_restores_incomplete_roll_receipt_exactly_once(
    tmp_path: Path, monkeypatch, crash_stage: str
):
    workspace = tmp_path / f"source-{crash_stage}"
    campaign = _build_generation(workspace)
    session_id = f"roll-{crash_stage.replace('_', '-')}"
    sessions = {
        "schema_version": 1,
        "sessions": [
            {
                "session_id": session_id,
                "campaign_id": "live",
                "investigator_id": "inv1",
                "character_relpath": ".coc/investigators/inv1/character.json",
                "resolved_config": {
                    "schema_version": 2,
                    "planner": {"kind": "deterministic"},
                    "rules": {"kind": "deterministic"},
                    "narrator": {"kind": "template"},
                    "player": {"kind": "human"},
                },
                "brain_at_create": "debug",
            }
        ],
        "closed_session_ids": [],
    }
    sessions_path = workspace / ".coc" / "runtime" / "sessions.json"
    sessions_path.parent.mkdir(parents=True, exist_ok=True)
    sessions_path.write_bytes(checkpoint._canonical_json(sessions) + b"\n")
    decision_id = f"checkpoint-roll-{crash_stage}"
    args = {
        "investigator": "inv1",
        "skill": "Spot Hidden",
        "target": 99,
        "reason": "checkpoint interruption proof",
        "decision_id": decision_id,
        "seed": 7,
    }
    real_ensure = toolbox._ensure_roll_receipt_row
    real_ledger = toolbox.Ctx.ledger_record

    def crash_after_receipt(ctx, receipt):
        if receipt.get("decision_id") == decision_id:
            raise RuntimeError("checkpoint crash after receipt")
        return real_ensure(ctx, receipt)

    def crash_before_ledger(self, current_id, tool_name, data, **kwargs):
        if current_id == decision_id and tool_name == "rules.roll":
            raise RuntimeError("checkpoint crash before ledger")
        return real_ledger(self, current_id, tool_name, data, **kwargs)

    with monkeypatch.context() as crash:
        if crash_stage == "after_receipt":
            crash.setattr(toolbox, "_ensure_roll_receipt_row", crash_after_receipt)
        else:
            crash.setattr(toolbox.Ctx, "ledger_record", crash_before_ledger)
        with pytest.raises(RuntimeError, match="checkpoint crash"):
            toolbox.run_tool("rules.roll", workspace, "live", args)

    receipt_path = campaign / "save" / "roll-operation-receipts.json"
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))["receipts"][
        "rules.roll"
    ][decision_id]
    frozen_data = copy.deepcopy(receipt["data"])
    store = checkpoint.CheckpointStore(
        tmp_path / f"run-{crash_stage}", workspace, "live", "inv1"
    )
    checkpoint_dir = store.write_checkpoint(session_id, 0, crash_stage)
    restored = tmp_path / f"restored-{crash_stage}"
    _prepare_local_provisioning(restored)
    store.restore_checkpoint(checkpoint_dir, restored)

    replay = toolbox.run_tool(
        "rules.roll", restored, "live", {**args, "seed": 999}
    )

    assert replay["ok"] is True
    assert replay["data"] == frozen_data
    restored_campaign = restored / ".coc" / "campaigns" / "live"
    rows = [
        json.loads(line)
        for line in (restored_campaign / "logs" / "rolls.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()
        if line.strip()
    ]
    assert [row for row in rows if row.get("roll_id") == receipt["roll_id"]] == [
        receipt["roll_record"]
    ]
    state = json.loads(
        (restored_campaign / "save" / "investigator-state" / "inv1.json")
        .read_text(encoding="utf-8")
    )
    matching_events = [
        event
        for event in state.get("skill_check_events", [])
        if event.get("source_event_id") == f"rules.roll:{decision_id}"
    ]
    assert len(matching_events) == 1
    development_rows = [
        json.loads(line)
        for line in (
            restored / ".coc" / "investigators" / "inv1" / "development.jsonl"
        )
        .read_text(encoding="utf-8")
        .splitlines()
        if line.strip()
    ]
    assert len([
        row
        for row in development_rows
        if row.get("source_event_id") == f"rules.roll:{decision_id}"
    ]) == 1
