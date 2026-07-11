"""Runtime path-containment regression tests (A26)."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest


def _load(name: str, rel: str):
    spec = importlib.util.spec_from_file_location(name, rel)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _seed_workspace(workspace: Path, *, brain: str = "debug") -> Path:
    coc = workspace / ".coc"
    campaign = coc / "campaigns" / "camp-1"
    save = campaign / "save"
    (save / "investigator-state").mkdir(parents=True)
    (coc / "investigators" / "inv-1").mkdir(parents=True)
    (coc / "runtime.json").write_text(
        json.dumps({"schema_version": 1, "brain": brain}), encoding="utf-8"
    )
    (campaign / "campaign.json").write_text(
        json.dumps({"schema_version": 1, "campaign_id": "camp-1"}), encoding="utf-8"
    )
    (save / "world-state.json").write_text(
        json.dumps({"schema_version": 1, "active_scene_id": "scene-1"}),
        encoding="utf-8",
    )
    (save / "pacing-state.json").write_text(
        json.dumps({"schema_version": 1, "turn_number": 1}), encoding="utf-8"
    )
    (save / "investigator-state" / "inv-1.json").write_text(
        json.dumps({
            "schema_version": 1,
            "investigator_id": "inv-1",
            "current_hp": 10,
            "current_san": 50,
            "current_mp": 10,
            "conditions": [],
        }),
        encoding="utf-8",
    )
    character = coc / "investigators" / "inv-1" / "character.json"
    character.write_text(json.dumps({"id": "inv-1"}), encoding="utf-8")
    return campaign


@pytest.mark.parametrize(
    "bad_id",
    ["", "../camp", "/tmp/camp", "camp/next", r"camp\\next", "café", "x" * 129],
)
def test_runtime_rejects_noncanonical_ids_before_session_registration(tmp_path, bad_id):
    _seed_workspace(tmp_path)
    session = _load("runtime_session_bad_id", "runtime/engine/session.py")

    with pytest.raises(ValueError, match="invalid campaign_id"):
        session.create_session(tmp_path, campaign_id=bad_id, investigator_id="inv-1")

    assert session._SESSIONS == {}


@pytest.mark.parametrize("bad_id", ["../camp", "/tmp/camp", r"camp\\next", "café"])
def test_direct_public_state_rejects_noncanonical_campaign_ids(tmp_path, bad_id):
    _seed_workspace(tmp_path)
    public_state = _load("runtime_public_state_bad_id", "runtime/engine/public_state.py")

    with pytest.raises(ValueError, match="invalid campaign_id"):
        public_state.build_public_state(tmp_path, bad_id)


@pytest.mark.parametrize("brain", ["debug", "pi"])
def test_runtime_rejects_bad_investigator_id_for_each_sdk_brain(tmp_path, brain):
    _seed_workspace(tmp_path, brain=brain)
    session = _load(f"runtime_session_bad_inv_{brain}", "runtime/engine/session.py")

    with pytest.raises(ValueError, match="invalid investigator_id"):
        session.create_session(tmp_path, campaign_id="camp-1", investigator_id="../inv")

    assert session._SESSIONS == {}


@pytest.mark.parametrize("brain", ["debug", "pi"])
def test_sdk_rejects_bad_ids_before_dispatch_or_registry_write(tmp_path, brain):
    _seed_workspace(tmp_path, brain=brain)
    api = _load(f"runtime_sdk_bad_id_{brain}", "runtime/sdk/api.py")

    with pytest.raises(ValueError, match="invalid investigator_id"):
        api.create_session(tmp_path, campaign_id="camp-1", investigator_id="..\\inv")

    assert api._session._SESSIONS == {}


def test_session_stores_character_as_canonical_workspace_relative_path(tmp_path):
    _seed_workspace(tmp_path)
    session = _load("runtime_session_relative_character", "runtime/engine/session.py")

    sid = session.create_session(
        tmp_path,
        campaign_id="camp-1",
        investigator_id="inv-1",
        character_path=tmp_path / ".coc" / "investigators" / "inv-1" / "character.json",
    )

    record = session.get_session(sid)
    assert record["character_relpath"] == ".coc/investigators/inv-1/character.json"
    assert not Path(record["character_relpath"]).is_absolute()


def test_runtime_rejects_campaign_character_and_state_symlink_escapes(tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    public_state = _load("runtime_public_state_symlinks", "runtime/engine/public_state.py")
    session = _load("runtime_session_symlinks", "runtime/engine/session.py")

    campaign_workspace = tmp_path / "campaign-workspace"
    campaign = _seed_workspace(campaign_workspace)
    external_campaign = outside / "campaign"
    external_campaign.mkdir()
    # Remove only this disposable fixture campaign before replacing it with a link.
    import shutil
    shutil.rmtree(campaign)
    (campaign_workspace / ".coc" / "campaigns" / "camp-1").symlink_to(
        external_campaign, target_is_directory=True
    )
    with pytest.raises(ValueError, match="escapes containment"):
        public_state.build_public_state(campaign_workspace, "camp-1")

    character_workspace = tmp_path / "character-workspace"
    _seed_workspace(character_workspace)
    character = character_workspace / ".coc" / "investigators" / "inv-1" / "character.json"
    character.unlink()
    character.symlink_to(outside / "character.json")
    with pytest.raises(ValueError, match="escapes containment"):
        session.create_session(character_workspace, campaign_id="camp-1", investigator_id="inv-1")

    state_workspace = tmp_path / "state-workspace"
    campaign = _seed_workspace(state_workspace)
    state_path = campaign / "save" / "world-state.json"
    state_path.unlink()
    state_path.symlink_to(outside / "world-state.json")
    with pytest.raises(ValueError, match="escapes containment"):
        public_state.build_public_state(state_workspace, "camp-1")
    with pytest.raises(ValueError, match="escapes containment"):
        session.create_session(state_workspace, campaign_id="camp-1", investigator_id="inv-1")


def test_session_revalidates_canonical_paths_before_state_access(tmp_path):
    campaign = _seed_workspace(tmp_path)
    session = _load("runtime_session_revalidate", "runtime/engine/session.py")
    sid = session.create_session(tmp_path, campaign_id="camp-1", investigator_id="inv-1")
    outside = tmp_path / "outside-world.json"
    outside.write_text("{}", encoding="utf-8")
    state_path = campaign / "save" / "world-state.json"
    state_path.unlink()
    state_path.symlink_to(outside)

    with pytest.raises(ValueError, match="escapes containment"):
        session.get_state(sid)
    with pytest.raises(ValueError, match="escapes containment"):
        session.send(sid, "do not dispatch this turn")
