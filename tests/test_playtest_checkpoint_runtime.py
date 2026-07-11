"""Public-runtime proof for durable playtest checkpoint generations."""

from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
from pathlib import Path


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
runtime_fixture = _load(
    "runtime_checkpoint_fixture_source",
    REPO / "tests" / "test_runtime_sdk_debug.py",
)


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _build_generation(workspace: Path) -> Path:
    campaign, _character = runtime_fixture._build_live_campaign(workspace)
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


def _force_sync_adapter(api) -> list[dict[str, str]]:
    canonical = api._session._load_debug_adapter()
    receipts: list[dict[str, str]] = []

    class SyncDebugAdapter:
        @staticmethod
        def debug_send_turn(*args, **kwargs):
            kwargs["recording_mode"] = "sync"
            kwargs["recording_flush"] = "manual"
            result = canonical.debug_send_turn(*args, **kwargs)
            receipts.append(
                {
                    "recording_mode": kwargs["recording_mode"],
                    "recording_flush": kwargs["recording_flush"],
                }
            )
            return result

    api._session._load_debug_adapter = lambda: SyncDebugAdapter
    return receipts


def _chase_requests() -> tuple[dict, dict]:
    start = {
        "kind": "chase_start",
        "payload": {
            "decision_id": "checkpoint-chase",
            "chase_id": "checkpoint-roof",
            "participants": [
                {
                    "actor_id": "inv1",
                    "side": "quarry",
                    "mov": 8,
                    "dex": 70,
                    "con": 60,
                    "hp": 12,
                    "fight": 60,
                    "dodge": 40,
                    "build": 0,
                    "current_position": 0,
                    "conditions": [],
                },
                {
                    "actor_id": "cultist",
                    "side": "pursuer",
                    "mov": 8,
                    "dex": 50,
                    "con": 50,
                    "hp": 9,
                    "fight": 45,
                    "dodge": 25,
                    "build": 0,
                    "current_position": 0,
                    "conditions": [],
                },
            ],
            "locations": [
                {"label": "roof", "hazard": None, "barrier": None},
                {
                    "label": "door",
                    "hazard": None,
                    "barrier": {
                        "barrier_id": "door",
                        "hp": 4,
                        "hp_max": 4,
                        "skill": "Climb",
                        "target": 100,
                    },
                },
            ],
        },
    }
    offer = {
        "kind": "chase_move",
        "payload": {
            "decision_id": "checkpoint-chase",
            "revision": 1,
            "actor_id": "inv1",
            "action_id": "choice:offer",
        },
    }
    return start, offer


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


def _restore_with_fresh_api(
    checkpoint_store, checkpoint_dir: Path, target: Path, name: str
):
    _prepare_local_provisioning(target)
    checkpoint_store.restore_checkpoint(checkpoint_dir, target)
    api = _load(name, REPO / "runtime" / "sdk" / "api.py")
    _force_sync_adapter(api)
    restored_ids = api._session._REGISTRY.restore(target)
    return api, restored_ids


def test_public_sdk_checkpoint_restores_pending_state_and_seeded_continuation(
    tmp_path: Path,
):
    workspace = tmp_path / "generation-old"
    campaign = _build_generation(workspace)
    api = _load("runtime_checkpoint_api_source", REPO / "runtime" / "sdk" / "api.py")
    recording_receipts = _force_sync_adapter(api)
    session_id = api.create_session(
        workspace, campaign_id="live", investigator_id="inv1"
    )
    start, offer = _chase_requests()
    api.send(session_id, "", subsystem_request=start, rng_seed="checkpoint:start")
    pre_state = copy.deepcopy(api.get_state(session_id))
    offer_events = api.send(
        session_id, "", subsystem_request=offer, rng_seed="checkpoint:offer"
    )
    checkpoint_state = copy.deepcopy(api.get_state(session_id))
    assert checkpoint_state["pending_choice"] is not None
    api._session._REGISTRY.snapshot(workspace)

    receipt = recording_receipts[-1]
    assert receipt["recording_mode"] == "sync"
    assert receipt["recording_flush"] == "manual"
    receipt_payload = json.dumps(
        receipt, sort_keys=True, separators=(",", ":")
    ).encode()
    store = checkpoint.CheckpointStore(tmp_path / "run", workspace, "live", "inv1")
    store.append_turn(
        {"kind": "chase_move", "request": offer},
        offer_events,
        pre_state,
        checkpoint_state,
        {
            "player_mode": "whitebox",
            "model_identity": {},
            "recording_mode": receipt["recording_mode"],
            "recording_flush": receipt["recording_flush"],
            "runtime_receipt_sha256": hashlib.sha256(receipt_payload).hexdigest(),
        },
    )
    checkpoint_dir = store.write_checkpoint(session_id, 1, "turn_complete")

    choice = checkpoint_state["pending_choice"]
    response = {
        "choice_id": choice["choice_id"],
        "responder": "player",
        "revision": choice["revision"],
        "action": choice["options"][0]["action"],
    }
    later_events = api.send(
        session_id,
        "",
        pending_choice_response=response,
        rng_seed="checkpoint:continue",
    )
    later_state = copy.deepcopy(api.get_state(session_id))
    store.append_turn(
        {"kind": "pending_choice_response", "response": response},
        later_events,
        checkpoint_state,
        later_state,
        {
            "player_mode": "whitebox",
            "model_identity": {},
            "recording_mode": recording_receipts[-1]["recording_mode"],
            "recording_flush": recording_receipts[-1]["recording_flush"],
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
        "",
        pending_choice_response=response,
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
        "",
        pending_choice_response=response,
        rng_seed="checkpoint:continue",
    )
    state_b = api_b.get_state(session_id)

    assert _stable_events(events_a) == _stable_events(events_b)
    assert state_a == state_b
    assert _tree_bytes(workspace) == old_generation_after_later_turn
    campaign_a = restored_a / ".coc" / "campaigns" / "live"
    campaign_b = restored_b / ".coc" / "campaigns" / "live"
    assert campaign_a.stat().st_ino != campaign_b.stat().st_ino
