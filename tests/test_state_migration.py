"""N6: schema migration hooks + corrupt-save backup (coc_state)."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "plugins" / "coc-keeper" / "scripts" / "coc_state.py"


def _load_state():
    spec = importlib.util.spec_from_file_location("coc_state_migration", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def state():
    return _load_state()


def test_migrate_state_identity_when_registry_empty(state):
    data = {"schema_version": 1, "campaign_id": "c1"}
    out = state.migrate_state(data, "campaign")
    assert out == data
    assert out["schema_version"] == 1


def test_migrate_state_chains_registered_migration_and_persists(tmp_path, state, monkeypatch):
    def bump_1_to_2(payload: dict) -> dict:
        out = dict(payload)
        out["schema_version"] = 2
        out["migrated"] = True
        return out

    monkeypatch.setitem(state.MIGRATIONS, "test_kind", {1: bump_1_to_2})
    monkeypatch.setitem(state.CURRENT_SCHEMA_VERSIONS, "test_kind", 2)

    path = tmp_path / "save" / "test-state.json"
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps({"schema_version": 1, "x": 1}), encoding="utf-8")

    loaded = state.load_state_object(path, "test_kind", fallback={"schema_version": 2})
    assert loaded["schema_version"] == 2
    assert loaded["migrated"] is True
    assert loaded["x"] == 1

    on_disk = json.loads(path.read_text(encoding="utf-8"))
    assert on_disk["schema_version"] == 2
    assert on_disk["migrated"] is True


def test_migrate_state_over_version_raises(state, monkeypatch):
    monkeypatch.setitem(state.CURRENT_SCHEMA_VERSIONS, "test_kind", 1)
    with pytest.raises(ValueError, match="schema_version 9 .* exceeds current 1"):
        state.migrate_state({"schema_version": 9}, "test_kind")


def test_world_v1_migrates_to_v2_atomically_and_idempotently(tmp_path, state):
    path = tmp_path / "campaigns" / "case-1" / "save" / "world-state.json"
    path.parent.mkdir(parents=True)
    original = {
        "schema_version": 1,
        "campaign_id": "case-1",
        "status": "active",
        "active_scene_id": "study",
        "pending_choice": {"choice_id": "legacy-copy"},
        "unknown_future_safe_field": {"keep": True},
    }
    path.write_text(json.dumps(original), encoding="utf-8")

    loaded = state.load_world_state(path.parents[1])
    assert loaded["schema_version"] == 2
    assert loaded["terminal_state"] is None
    assert loaded["pending_subsystem_choice"] is None
    assert "pending_choice" not in loaded
    assert loaded["unknown_future_safe_field"] == {"keep": True}
    rewritten = json.loads(path.read_text(encoding="utf-8"))
    assert rewritten == loaded

    before = path.read_bytes()
    assert state.load_world_state(path.parents[1]) == loaded
    assert path.read_bytes() == before


def test_world_forward_version_fails_closed_without_rewrite(tmp_path, state):
    path = tmp_path / "campaigns" / "case-1" / "save" / "world-state.json"
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps({"schema_version": 3, "sensitive": "preserve"}), encoding="utf-8")
    before = path.read_bytes()

    with pytest.raises(ValueError, match="exceeds current 2"):
        state.load_world_state(path.parents[1])
    assert path.read_bytes() == before


@pytest.mark.parametrize(
    "schema_version",
    [True, False, "1", None, 1.0, 0, -1, float("nan"), float("inf")],
)
def test_world_migration_requires_exact_positive_integer_schema_version(
    state, schema_version,
):
    with pytest.raises(ValueError, match="invalid schema_version"):
        state.migrate_state({"schema_version": schema_version}, "world")


@pytest.mark.parametrize(
    "terminal_state",
    [[], {}, ["completed"], {"status": "completed"}, True, 1, 1.5],
)
def test_world_migration_normalizes_non_scalar_terminal_state_without_type_error(
    state, terminal_state,
):
    migrated = state.migrate_state(
        {"schema_version": 1, "terminal_state": terminal_state}, "world"
    )
    assert migrated["schema_version"] == 2
    assert migrated["terminal_state"] is None


def test_corrupt_json_backed_up_before_fallback(tmp_path, state):
    path = tmp_path / "campaigns" / "c1" / "campaign.json"
    path.parent.mkdir(parents=True)
    (tmp_path / "campaigns" / "c1" / "logs").mkdir(parents=True)
    path.write_text("{not-json", encoding="utf-8")

    loaded = state.load_state_object(
        path, "campaign", fallback={"schema_version": 1, "campaign_id": "c1"}
    )
    assert loaded["campaign_id"] == "c1"

    backups = list(path.parent.glob("campaign.json.corrupt-*"))
    assert len(backups) == 1
    assert backups[0].read_text(encoding="utf-8") == "{not-json"

    warn_path = tmp_path / "campaigns" / "c1" / "logs" / "state-warnings.jsonl"
    assert warn_path.exists()
    warning = json.loads(warn_path.read_text(encoding="utf-8").splitlines()[0])
    assert warning["event_type"] == "corrupt_save_backup"
    assert warning["reason"] == "json_decode_error"
    assert Path(warning["path"]).name == "campaign.json"
    assert Path(warning["backup_path"]).name.startswith("campaign.json.corrupt-")


def test_non_object_json_backed_up_before_fallback(tmp_path, state):
    path = tmp_path / "save" / "pacing-state.json"
    path.parent.mkdir(parents=True)
    path.write_text("[1, 2, 3]", encoding="utf-8")

    loaded = state.load_state_object(path, "pacing", fallback={"schema_version": 1})
    assert loaded == {"schema_version": 1}

    backups = list(path.parent.glob("pacing-state.json.corrupt-*"))
    assert len(backups) == 1
