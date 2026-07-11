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


def test_lazy_worker_pool_first_use_is_singleton_under_concurrency(monkeypatch):
    session = _load_session()
    registry = session.SessionRegistry(monotonic=FakeClock())
    created = []

    class Pool:
        def __init__(self, *_args, **_kwargs):
            created.append(self)

    class WorkerPoolModule:
        JsonlWorkerPool = Pool

    original_load = session._load_module
    monkeypatch.setattr(
        session, "_load_module",
        lambda name, path: WorkerPoolModule if path.name == "worker_pool.py"
        else original_load(name, path),
    )
    barrier = threading.Barrier(8)
    observed = []

    def first_use():
        barrier.wait()
        observed.append(session._ensure_worker_pool(registry))

    threads = [threading.Thread(target=first_use) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert len(created) == 1
    assert all(pool is created[0] for pool in observed)


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
