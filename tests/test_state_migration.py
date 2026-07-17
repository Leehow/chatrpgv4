"""Clean-slate persistence contract for central campaign state."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest


SCRIPT = Path(__file__).resolve().parents[1] / "plugins" / "coc-keeper" / "scripts" / "coc_state.py"


def _load_state():
    spec = importlib.util.spec_from_file_location("coc_state_clean_slate", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def state():
    return _load_state()


def _seed_current_generation(state, root: Path, campaign_id: str = "case-1") -> Path:
    state.create_campaign(root, campaign_id, "Current Campaign")
    return root / ".coc" / "campaigns" / campaign_id


def test_exact_current_generation_loads_without_rewrite(tmp_path, state):
    campaign = _seed_current_generation(state, tmp_path)
    world_path = campaign / "save" / "world-state.json"
    before = world_path.read_bytes()

    loaded = state.validate_campaign_generation(campaign)

    assert loaded["campaign_id"] == "case-1"
    assert loaded["world"]["schema_version"] == 2
    assert world_path.read_bytes() == before


@pytest.mark.parametrize(
    "payload",
    [
        {"schema_version": 1, "campaign_id": "case-1"},
        {"campaign_id": "case-1"},
        {"schema_version": 3, "campaign_id": "case-1"},
        {"schema_version": True, "campaign_id": "case-1"},
        ["not", "an", "object"],
    ],
)
def test_noncurrent_world_is_rejected_without_mutation(tmp_path, state, payload):
    campaign = _seed_current_generation(state, tmp_path)
    path = campaign / "save" / "world-state.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    before = path.read_bytes()

    with pytest.raises(state.UnsupportedSaveSchema) as error:
        state.validate_campaign_generation(campaign)

    assert error.value.code == "unsupported_save_schema"
    assert error.value.fresh_generation_required is True
    assert error.value.to_dict() == {
        "code": "unsupported_save_schema",
        "fresh_generation_required": True,
        "kind": "world",
        "reason": error.value.reason,
        "path_name": "world-state.json",
    }
    assert str(tmp_path) not in json.dumps(error.value.to_dict())
    assert path.read_bytes() == before
    assert list(path.parent.glob("world-state.json.corrupt-*")) == []


def test_malformed_world_is_rejected_without_backup_or_default(tmp_path, state):
    campaign = _seed_current_generation(state, tmp_path)
    path = campaign / "save" / "world-state.json"
    path.write_text("{not-json", encoding="utf-8")

    with pytest.raises(state.UnsupportedSaveSchema):
        state.load_world_state(campaign)

    assert path.read_text(encoding="utf-8") == "{not-json"
    assert list(path.parent.glob("world-state.json.corrupt-*")) == []
    assert not (campaign / "logs" / "state-warnings.jsonl").exists()


def test_missing_core_file_is_not_a_fresh_per_file_default(tmp_path, state):
    campaign = _seed_current_generation(state, tmp_path)
    (campaign / "save" / "pacing-state.json").unlink()

    with pytest.raises(state.UnsupportedSaveSchema) as error:
        state.validate_campaign_generation(campaign)

    assert error.value.reason == "missing_file"
    assert not (campaign / "save" / "pacing-state.json").exists()


@pytest.mark.parametrize(
    "relative,field,value",
    [
        ("campaign.json", "campaign_id", "other"),
        ("save/world-state.json", "campaign_id", "other"),
        ("save/pacing-state.json", "campaign_id", "other"),
    ],
)
def test_core_identity_mismatch_rejects_generation(
    tmp_path, state, relative, field, value,
):
    campaign = _seed_current_generation(state, tmp_path)
    path = campaign / relative
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload[field] = value
    path.write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(state.UnsupportedSaveSchema) as error:
        state.validate_campaign_generation(campaign)

    assert error.value.reason == f"identity_mismatch:{field}"


def test_read_only_validation_never_discards_invalid_generation(tmp_path, state):
    campaign = _seed_current_generation(state, tmp_path)
    marker = campaign / "save" / "old-marker.txt"
    marker.write_text("preserve until explicit fresh start", encoding="utf-8")
    (campaign / "save" / "world-state.json").write_text(
        json.dumps({"schema_version": 1, "campaign_id": "case-1"}),
        encoding="utf-8",
    )

    with pytest.raises(state.UnsupportedSaveSchema):
        state.validate_campaign_generation(campaign)

    assert marker.is_file()


def test_discard_requires_explicit_fresh_start_operation(tmp_path, state):
    campaign = _seed_current_generation(state, tmp_path)

    with pytest.raises(ValueError, match="fresh_start operation required"):
        state.discard_campaign_generation(tmp_path, "case-1")

    assert campaign.is_dir()


def test_fresh_start_discards_whole_campaign_and_owned_runtime_sessions(
    tmp_path, state,
):
    campaign = _seed_current_generation(state, tmp_path)
    stale = campaign / "save" / "stale-old-id-map.json"
    stale.write_text("{}", encoding="utf-8")
    runtime = tmp_path / ".coc" / "runtime" / "sessions.json"
    runtime.parent.mkdir(parents=True)
    runtime.write_text(json.dumps({
        "schema_version": 1,
        "closed_session_ids": [],
        "sessions": [
            {
                "session_id": "discard",
                "campaign_id": "case-1",
                "investigator_id": "ada",
                "character_relpath": ".coc/investigators/ada/character.json",
                "resolved_config": {"schema_version": 2},
                "brain_at_create": "debug",
            },
            {
                "session_id": "keep",
                "campaign_id": "case-2",
                "investigator_id": "bert",
                "character_relpath": ".coc/investigators/bert/character.json",
                "resolved_config": {"schema_version": 2},
                "brain_at_create": "debug",
            },
        ],
    }), encoding="utf-8")

    state.create_campaign(
        tmp_path, "case-1", "Fresh Campaign", fresh_start=True
    )

    assert not stale.exists()
    current = state.validate_campaign_generation(campaign)
    assert current["campaign"]["title"] == "Fresh Campaign"
    snapshot = json.loads(runtime.read_text(encoding="utf-8"))
    assert snapshot["sessions"] == [
        {
            "session_id": "keep",
            "campaign_id": "case-2",
            "investigator_id": "bert",
            "character_relpath": ".coc/investigators/bert/character.json",
            "resolved_config": {"schema_version": 2},
            "brain_at_create": "debug",
        }
    ]


def test_fresh_start_deletes_invalid_runtime_snapshot_instead_of_adopting_it(
    tmp_path, state,
):
    _seed_current_generation(state, tmp_path)
    runtime = tmp_path / ".coc" / "runtime" / "sessions.json"
    runtime.parent.mkdir(parents=True)
    runtime.write_text(json.dumps({
        "schema_version": 1,
        "closed_session_ids": [],
        "sessions": [{"session_id": "partial", "campaign_id": "case-1"}],
    }), encoding="utf-8")

    state.create_campaign(tmp_path, "case-1", "Fresh", fresh_start=True)

    assert not runtime.exists()
    assert state.validate_campaign_generation(
        tmp_path / ".coc" / "campaigns" / "case-1"
    )["campaign"]["title"] == "Fresh"


def test_create_campaign_never_overlays_existing_generation(tmp_path, state):
    campaign = _seed_current_generation(state, tmp_path)
    marker = campaign / "save" / "owned-marker"
    marker.write_text("old", encoding="utf-8")

    with pytest.raises(FileExistsError):
        state.create_campaign(tmp_path, "case-1", "Accidental Overlay")

    assert marker.read_text(encoding="utf-8") == "old"
