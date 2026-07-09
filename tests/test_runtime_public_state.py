import importlib.util
import json
from pathlib import Path


def _load():
    path = Path("runtime/engine/public_state.py")
    spec = importlib.util.spec_from_file_location("runtime_public_state", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _seed_campaign(workspace: Path, campaign_id: str = "camp-1") -> Path:
    coc = workspace / ".coc"
    campaign = coc / "campaigns" / campaign_id
    save = campaign / "save"
    inv_dir = save / "investigator-state"
    inv_dir.mkdir(parents=True)

    (coc / "runtime.json").write_text(
        json.dumps({"schema_version": 1, "brain": "pi"}),
        encoding="utf-8",
    )
    (campaign / "campaign.json").write_text(
        json.dumps({
            "schema_version": 1,
            "campaign_id": campaign_id,
            "play_language": "zh-CN",
        }),
        encoding="utf-8",
    )
    (save / "world-state.json").write_text(
        json.dumps({
            "schema_version": 1,
            "campaign_id": campaign_id,
            "active_scene_id": "dock-warehouse",
            "discovered_clue_ids": ["ledger-mark", "wet-footprints"],
        }),
        encoding="utf-8",
    )
    (save / "pacing-state.json").write_text(
        json.dumps({
            "schema_version": 1,
            "campaign_id": campaign_id,
            "tension_level": "rising",
            "turn_number": 7,
        }),
        encoding="utf-8",
    )
    (inv_dir / "inv-alice.json").write_text(
        json.dumps({
            "schema_version": 1,
            "investigator_id": "inv-alice",
            "current_hp": 11,
            "current_san": 55,
            "current_mp": 10,
            "conditions": ["shaken"],
        }),
        encoding="utf-8",
    )
    return campaign


def test_build_public_state_round_trips_hp_san_and_scene(tmp_path):
    campaign_id = "camp-1"
    _seed_campaign(tmp_path, campaign_id)

    state = _load().build_public_state(tmp_path, campaign_id)

    assert state["schema_version"] == 1
    assert state["campaign_id"] == campaign_id
    assert state["play_language"] == "zh-CN"
    assert state["active_scene_id"] == "dock-warehouse"
    assert state["tension_level"] == "rising"
    assert state["turn_number"] == 7
    assert state["discovered_clue_ids"] == ["ledger-mark", "wet-footprints"]
    assert state["brain"] == "pi"
    assert state["pending_choice"] is None

    assert len(state["investigators"]) == 1
    inv = state["investigators"][0]
    assert inv["id"] == "inv-alice"
    assert inv["current_hp"] == 11
    assert inv["current_san"] == 55
    assert inv["current_mp"] == 10
    assert inv["conditions"] == ["shaken"]


def test_build_public_state_brain_reflects_runtime_json(tmp_path):
    campaign_id = "camp-debug"
    _seed_campaign(tmp_path, campaign_id)
    (tmp_path / ".coc" / "runtime.json").write_text(
        json.dumps({"schema_version": 1, "brain": "debug"}),
        encoding="utf-8",
    )

    state = _load().build_public_state(tmp_path, campaign_id)
    assert state["brain"] == "debug"


def test_build_public_state_missing_files_use_safe_defaults(tmp_path):
    campaign_id = "empty-camp"
    (tmp_path / ".coc" / "campaigns" / campaign_id).mkdir(parents=True)

    state = _load().build_public_state(tmp_path, campaign_id)

    assert state["campaign_id"] == campaign_id
    assert state["brain"] == "debug"
    assert state["play_language"] is None or state["play_language"] == ""
    assert state["active_scene_id"] is None
    assert state["tension_level"] is None
    assert state["turn_number"] == 0
    assert state["discovered_clue_ids"] == []
    assert state["investigators"] == []
    assert state["pending_choice"] is None


def test_public_state_schema_lists_required_keys():
    schema = json.loads(Path("runtime/protocol/public_state.schema.json").read_text())
    required = set(schema["required"])
    assert {
        "schema_version",
        "campaign_id",
        "play_language",
        "active_scene_id",
        "tension_level",
        "turn_number",
        "discovered_clue_ids",
        "investigators",
        "brain",
        "pending_choice",
    }.issubset(required)
