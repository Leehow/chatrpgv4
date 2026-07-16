"""A27: durable, bounded runtime session lifecycle."""
from __future__ import annotations

import importlib.util
import json
import math
import threading
from pathlib import Path

import pytest


def _load_session():
    path = Path(__file__).resolve().parents[1] / "runtime" / "engine" / "session.py"
    spec = importlib.util.spec_from_file_location("runtime_session_lifecycle", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class FakeClock:
    def __init__(self, now: float = 100.0) -> None:
        self.now = now

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


def _record(tmp_path: Path, *, campaign_id: str = "case", investigator_id: str = "ada") -> dict:
    return {
        "workspace": tmp_path,
        "campaign_id": campaign_id,
        "investigator_id": investigator_id,
        "character_relpath": f".coc/investigators/{investigator_id}/character.json",
        "resolved_config": {"schema_version": 1, "brain": "debug"},
        "brain_at_create": "debug",
    }


def _valid_player_intent() -> dict:
    return {
        "primary_intent": "investigate",
        "secondary_intents": [],
        "target_entities": ["scene"],
        "risk_posture": "cautious",
        "explicit_roll_request": False,
        "player_hypothesis": None,
        "action_atoms": [{"topic": "room", "verb": "search"}],
        "npc_interactions": [],
    }


def test_player_intent_validator_accepts_exact_public_shape_without_aliasing():
    session = _load_session()
    intent = _valid_player_intent()

    normalized = session._validate_player_intent(intent)

    assert normalized == intent
    assert normalized is not intent
    assert normalized["action_atoms"] is not intent["action_atoms"]


@pytest.mark.parametrize(
    ("field", "bad_value"),
    [
        ("primary_intent", "interpret-prose-locally"),
        ("primary_intent", 1),
        ("secondary_intents", ["follow_up", 1]),
        ("target_entities", "scene"),
        ("risk_posture", "desperate"),
        ("explicit_roll_request", 1),
        ("player_hypothesis", {"guess": "hidden door"}),
        ("action_atoms", [{"path": ("room", "desk")}]),
        ("npc_interactions", [{"difficulty": math.nan}]),
    ],
)
def test_player_intent_validator_rejects_malformed_public_fields(field, bad_value):
    session = _load_session()
    intent = _valid_player_intent()
    intent[field] = bad_value

    with pytest.raises((TypeError, ValueError)):
        session._validate_player_intent(intent)


def test_player_intent_validator_requires_exact_public_fields():
    session = _load_session()
    missing = _valid_player_intent()
    missing.pop("npc_interactions")
    extra = {**_valid_player_intent(), "intent_detail": "careful_investigation"}

    with pytest.raises(ValueError):
        session._validate_player_intent(missing)
    with pytest.raises(ValueError):
        session._validate_player_intent(extra)


def test_runtime_projects_canonical_nested_roll_without_keeper_metadata():
    session = _load_session()
    events = session._load_events_module()
    row = {
        "event_type": "roll",
        "roll_id": "roll-nested-1",
        "actor": "inv1",
        "visibility": "public",
        "source": "keeper_toolbox",
        "source_ref": "logs/rolls.jsonl#roll-nested-1",
        "payload": {
            "roll_id": "roll-nested-1",
            "kind": "skill_check",
            "skill": "Spot Hidden",
            "target": 60,
            "roll": 24,
            "outcome": "hard_success",
            "keeper_reason": "must not cross the public allowlist",
        },
    }

    event = session._project_roll_event(events, row)

    assert event is not None
    assert event["payload"] == {
        "roll": 24,
        "roll_id": "roll-nested-1",
        "kind": "skill_check",
        "skill": "Spot Hidden",
        "outcome": "hard_success",
        "target": 60,
        "success": True,
    }


def test_runtime_projects_canonical_combat_damage_dice_shape():
    session = _load_session()
    events = session._load_events_module()
    row = {
        "event_type": "roll",
        "roll_id": "combat-damage-1",
        "visibility": "consequence_public",
        "source": "combat_session",
        "command_id": "combat-command-1",
        "payload": {
            "event_type": "combat_roll",
            "roll_id": "combat-damage-1",
            "visibility": "consequence_public",
            "skill": "HP Damage",
            "raw_roll": 4,
            "dice": {"expression": "1D6", "raw": [4], "total": 4},
        },
    }

    event = session._project_roll_event(events, row)

    assert event is not None
    assert event["payload"] == {
        "roll": 4,
        "roll_id": "combat-damage-1",
        "decision_id": "combat-command-1",
        "kind": "combat_roll",
        "skill": "HP Damage",
        "die": "1D6",
        "die_rolls": [4],
    }


@pytest.mark.parametrize("visibility", ["keeper", "secret", "system"])
def test_runtime_never_projects_nonpublic_canonical_roll(visibility):
    session = _load_session()
    events = session._load_events_module()
    row = {
        "event_type": "roll",
        "roll_id": "keeper-roll",
        "visibility": visibility,
        "payload": {"roll_id": "keeper-roll", "roll": 1},
    }

    assert session._project_roll_event(events, row) is None


def test_runtime_rejects_conflicting_canonical_roll_identity():
    session = _load_session()
    events = session._load_events_module()
    row = {
        "event_type": "roll",
        "roll_id": "outer-roll",
        "visibility": "public",
        "payload": {"roll_id": "inner-roll", "roll": 1},
    }

    assert session._project_roll_event(events, row) is None


@pytest.mark.parametrize("seed", [0, -1, 2**128, "", "run-a:0001"])
def test_rng_seed_validator_preserves_exact_integer_or_string(seed):
    session = _load_session()

    assert session._validate_rng_seed(seed) == seed
    assert type(session._validate_rng_seed(seed)) is type(seed)


@pytest.mark.parametrize(
    "seed",
    [True, False, None, 1.0, [], {}, {"seed"}, ("run-a", 1)],
)
def test_rng_seed_validator_rejects_boolean_collection_and_non_exact_scalars(seed):
    session = _load_session()

    with pytest.raises((TypeError, ValueError)):
        session._validate_rng_seed(seed)


def test_registry_expires_and_tombstones_session_without_revival(tmp_path):
    session = _load_session()
    clock = FakeClock()
    registry = session.SessionRegistry(ttl_seconds=10, monotonic=clock)
    sid = registry.create(_record(tmp_path), session_id="sess-expire")

    clock.advance(11)
    assert registry.expire() == [sid]
    with pytest.raises(session.UnknownSessionError) as exc:
        registry.get(sid)
    assert exc.value.kind == "unknown_session"
    with pytest.raises(ValueError, match="tombstoned"):
        registry.create(_record(tmp_path), session_id=sid)


def test_registry_returns_deep_copies_and_freezes_creation_config(tmp_path):
    session = _load_session()
    clock = FakeClock()
    source = _record(tmp_path)
    registry = session.SessionRegistry(monotonic=clock)
    sid = registry.create(source, session_id="sess-copy")
    source["resolved_config"]["brain"] = "pi"
    stored = registry.get(sid)
    stored["resolved_config"]["brain"] = "changed"

    again = registry.get(sid)
    assert again["resolved_config"] == {"schema_version": 1, "brain": "debug"}
    assert again["workspace"] == tmp_path.resolve()


def test_registry_rejects_non_integer_frozen_pipeline_schema_version(tmp_path):
    session = _load_session()
    registry = session.SessionRegistry(monotonic=FakeClock())
    record = _record(tmp_path)
    record["resolved_config"] = {
        "schema_version": 2.0,
        "planner": {"kind": "deterministic"},
        "rules": {"kind": "deterministic"},
        "narrator": {"kind": "template"},
        "player": {"kind": "human"},
    }
    record["brain_at_create"] = "debug"
    with pytest.raises(ValueError, match="not recoverable"):
        registry.create(record, session_id="sess-float-schema")


def test_registry_snapshot_restore_is_workspace_scoped_and_secret_free(tmp_path):
    session = _load_session()
    clock = FakeClock()
    registry = session.SessionRegistry(monotonic=clock)
    live = _record(tmp_path)
    live.update({"player_input": "secret", "adapter_handle": object(), "api_key": "nope"})
    registry.create(live, session_id="sess-live")
    registry.create(_record(tmp_path), session_id="sess-closed")
    registry.close("sess-closed")

    path = registry.snapshot(tmp_path)
    raw = json.loads(path.read_text(encoding="utf-8"))
    serialized = json.dumps(raw)
    assert path == tmp_path / ".coc" / "runtime" / "sessions.json"
    assert "secret" not in serialized
    assert "nope" not in serialized
    assert str(tmp_path.resolve()) not in serialized
    assert raw["closed_session_ids"] == ["sess-closed"]

    restored = session.SessionRegistry(monotonic=clock)
    assert restored.restore(tmp_path) == ["sess-live"]
    assert restored.get("sess-live")["workspace"] == tmp_path.resolve()
    with pytest.raises(session.UnknownSessionError):
        restored.get("sess-closed")

    other = tmp_path / "other"
    other.mkdir()
    assert restored.restore(other) == []


def test_registry_lock_serializes_concurrent_create_and_get(tmp_path):
    session = _load_session()
    registry = session.SessionRegistry(monotonic=FakeClock())
    failures: list[Exception] = []

    def worker(index: int) -> None:
        try:
            sid = registry.create(_record(tmp_path, investigator_id=f"inv-{index}"), session_id=f"sess-{index}")
            assert registry.get(sid)["investigator_id"] == f"inv-{index}"
        except Exception as exc:  # pragma: no cover - asserted below
            failures.append(exc)

    threads = [threading.Thread(target=worker, args=(index,)) for index in range(24)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert failures == []
    assert len(registry) == 24


def test_registry_close_and_expiry_retire_registered_worker_scopes(tmp_path):
    session = _load_session()
    clock = FakeClock()

    class Pool:
        def __init__(self):
            self.closed = []
        def close_scope(self, key):
            self.closed.append(key)

    pool = Pool()
    registry = session.SessionRegistry(ttl_seconds=10, monotonic=clock, worker_pool=pool)
    registry.create(_record(tmp_path), session_id="sess-close-worker")
    close_key = {"session_id": "sess-close-worker", "campaign_id": "camp-1",
                 "match_id": "camp-1", "role": "narrator:/runner"}
    registry.register_worker_scope("sess-close-worker", close_key)
    registry.close("sess-close-worker")
    assert pool.closed == [close_key]

    registry.create(_record(tmp_path), session_id="sess-expire-worker")
    expire_key = {"session_id": "sess-expire-worker", "campaign_id": "camp-1",
                  "match_id": "camp-1", "role": "narrator:/runner"}
    registry.register_worker_scope("sess-expire-worker", expire_key)
    clock.advance(11)
    assert registry.expire() == ["sess-expire-worker"]
    assert pool.closed[-1] == expire_key


def test_sdk_unknown_session_is_stable_documented_exception():
    session = _load_session()
    registry = session.SessionRegistry(monotonic=FakeClock())
    with pytest.raises(session.UnknownSessionError) as exc:
        registry.get("sess-never-created")
    assert exc.value.kind == "unknown_session"
    assert str(exc.value) == "unknown_session"


def test_registry_snapshot_rejects_secret_or_absolute_config_values(tmp_path):
    session = _load_session()
    registry = session.SessionRegistry(monotonic=FakeClock())
    record = _record(tmp_path)
    record["resolved_config"] = {
        "schema_version": 1,
        "brain": "debug",
        "api_key": "must-not-persist",
        "cache_path": str(tmp_path / "absolute"),
    }
    registry.create(record, session_id="sess-unrecoverable")

    with pytest.raises(ValueError, match="not recoverable"):
        registry.snapshot(tmp_path)


def test_registry_restore_rejects_path_escape_and_sensitive_edited_snapshot(tmp_path):
    session = _load_session()
    snapshot = tmp_path / ".coc" / "runtime" / "sessions.json"
    snapshot.parent.mkdir(parents=True)
    snapshot.write_text(json.dumps({
        "schema_version": 1,
        "closed_session_ids": [],
        "sessions": [{
            "session_id": "sess-edited",
            "campaign_id": "case",
            "investigator_id": "ada",
            "character_relpath": "../../outside.json",
            "resolved_config": {"schema_version": 1, "brain": "debug", "token": "bad"},
            "brain_at_create": "debug",
        }],
    }), encoding="utf-8")

    with pytest.raises(ValueError, match="invalid session snapshot"):
        session.SessionRegistry(monotonic=FakeClock()).restore(tmp_path)


@pytest.mark.parametrize(
    "sensitive_config",
    [
        {"nested": {"Authorization": "opaque"}},
        {"nested": {"http-cookie": "opaque"}},
        {"nested": {"privateKeyPem": "opaque"}},
        {"nested": {"client_secret": "opaque"}},
        {"nested": {"refresh-token": "opaque"}},
        {"metadata": {"label": "Authorization: Bearer abc.def.ghi"}},
        {"metadata": {"label": "Cookie: session=opaque"}},
        {"metadata": {"label": "-----BEGIN PRIVATE KEY-----\nopaque"}},
        {"metadata": {"label": "https://user:password@example.invalid/api"}},
    ],
)
def test_registry_snapshot_recursively_rejects_sensitive_keys_and_values(
    tmp_path, sensitive_config,
):
    session = _load_session()
    registry = session.SessionRegistry(monotonic=FakeClock())
    record = _record(tmp_path)
    record["resolved_config"].update(sensitive_config)
    registry.create(record, session_id="sess-sensitive")

    with pytest.raises(ValueError, match="not recoverable"):
        registry.snapshot(tmp_path)


@pytest.mark.parametrize("ttl", [math.nan, math.inf, -math.inf])
def test_registry_rejects_non_finite_ttl(ttl):
    session = _load_session()
    with pytest.raises(ValueError, match="positive finite number"):
        session.SessionRegistry(ttl_seconds=ttl)


@pytest.mark.parametrize("now", [math.nan, math.inf, -math.inf])
def test_registry_rejects_non_finite_monotonic_clock(now, tmp_path):
    session = _load_session()
    registry = session.SessionRegistry(monotonic=lambda: now)
    with pytest.raises(RuntimeError, match="invalid value"):
        registry.create(_record(tmp_path), session_id="sess-clock")


def _valid_snapshot_payload(*session_ids: str) -> dict:
    return {
        "schema_version": 1,
        "closed_session_ids": [],
        "sessions": [
            {
                "session_id": sid,
                "campaign_id": "case",
                "investigator_id": "ada",
                "character_relpath": ".coc/investigators/ada/character.json",
                "resolved_config": {"schema_version": 1, "brain": "debug"},
                "brain_at_create": "debug",
            }
            for sid in session_ids
        ],
    }


@pytest.mark.parametrize("schema_version", [True, False, "1", None, 1.0])
def test_registry_restore_requires_exact_snapshot_schema_version(
    tmp_path, schema_version,
):
    session = _load_session()
    snapshot = tmp_path / ".coc" / "runtime" / "sessions.json"
    snapshot.parent.mkdir(parents=True)
    payload = _valid_snapshot_payload("sess-restored")
    payload["schema_version"] = schema_version
    snapshot.write_text(json.dumps(payload), encoding="utf-8")

    registry = session.SessionRegistry(monotonic=FakeClock())
    with pytest.raises(ValueError, match="invalid session snapshot"):
        registry.restore(tmp_path)
    assert len(registry) == 0


def test_registry_restore_rejects_extra_snapshot_root_fields(tmp_path):
    session = _load_session()
    snapshot = tmp_path / ".coc" / "runtime" / "sessions.json"
    snapshot.parent.mkdir(parents=True)
    payload = _valid_snapshot_payload("sess-restored")
    payload["unexpected"] = "must fail closed"
    snapshot.write_text(json.dumps(payload), encoding="utf-8")

    registry = session.SessionRegistry(monotonic=FakeClock())
    with pytest.raises(ValueError, match="invalid session snapshot"):
        registry.restore(tmp_path)
    assert len(registry) == 0


@pytest.mark.parametrize(
    "sessions,closed",
    [
        (["sess-duplicate", "sess-duplicate"], []),
        ([], ["sess-closed", "sess-closed"]),
        (["sess-overlap"], ["sess-overlap"]),
    ],
)
def test_registry_restore_rejects_duplicate_or_overlapping_session_ids(
    tmp_path, sessions, closed,
):
    session = _load_session()
    snapshot = tmp_path / ".coc" / "runtime" / "sessions.json"
    snapshot.parent.mkdir(parents=True)
    payload = _valid_snapshot_payload(*sessions)
    payload["closed_session_ids"] = closed
    snapshot.write_text(json.dumps(payload), encoding="utf-8")

    registry = session.SessionRegistry(monotonic=FakeClock())
    with pytest.raises(ValueError, match="invalid session snapshot"):
        registry.restore(tmp_path)
    assert len(registry) == 0
    assert registry._tombstones == {}


def test_registry_restore_malformed_batch_is_atomic(tmp_path):
    session = _load_session()
    snapshot = tmp_path / ".coc" / "runtime" / "sessions.json"
    snapshot.parent.mkdir(parents=True)
    payload = _valid_snapshot_payload("sess-valid", "sess-invalid")
    payload["sessions"][1]["resolved_config"]["cookie"] = "opaque"
    snapshot.write_text(json.dumps(payload), encoding="utf-8")

    registry = session.SessionRegistry(monotonic=FakeClock())
    registry.create(_record(tmp_path), session_id="sess-existing")
    before = registry.get("sess-existing")
    with pytest.raises(ValueError, match="invalid session snapshot"):
        registry.restore(tmp_path)
    assert registry.get("sess-existing")["campaign_id"] == before["campaign_id"]
    with pytest.raises(session.UnknownSessionError):
        registry.get("sess-valid")


def test_registry_auto_generated_session_id_retries_uuid_collision(tmp_path, monkeypatch):
    session = _load_session()
    registry = session.SessionRegistry(monotonic=FakeClock())

    class FakeUUID:
        def __init__(self, value: str) -> None:
            self.hex = value

    values = iter([FakeUUID("a" * 32), FakeUUID("a" * 32), FakeUUID("b" * 32)])
    monkeypatch.setattr(session.uuid, "uuid4", lambda: next(values))

    first = registry.create(_record(tmp_path))
    second = registry.create(_record(tmp_path, investigator_id="bea"))
    assert first == "sess_aaaaaaaaaaaaaaaa"
    assert second == "sess_bbbbbbbbbbbbbbbb"
