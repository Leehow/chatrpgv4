"""A27: durable, bounded runtime session lifecycle."""
from __future__ import annotations

import importlib.util
import json
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
