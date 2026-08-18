"""Contract tests for setup.complete and ready_for_table session.resume."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_toolbox = _load("coc_toolbox_setup_complete", SCRIPTS / "coc_toolbox.py")
coc_state = _load("coc_state_setup_complete", SCRIPTS / "coc_state.py")


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def _make_campaign(root: Path, campaign_id: str, title: str = "Handoff") -> Path:
    coc_state.create_campaign(root, campaign_id, title, era="1920s")
    return root / ".coc" / "campaigns" / campaign_id


def _link_investigator(
    root: Path,
    campaign_id: str,
    investigator_id: str,
    *,
    method: str = "quick_fire",
) -> None:
    campaign_dir = root / ".coc" / "campaigns" / campaign_id
    _write_json(
        campaign_dir / "party.json",
        {
            "schema_version": 1,
            "campaign_id": campaign_id,
            "investigator_ids": [investigator_id],
            "active_investigator_ids": [investigator_id],
        },
    )
    _write_json(
        root / ".coc" / "investigators" / investigator_id / "creation.json",
        {
            "schema_version": 1,
            "investigator_id": investigator_id,
            "method": method,
        },
    )


def _bind_source(
    campaign_dir: Path,
    *,
    projected: bool,
    watch_status: str | None = None,
) -> None:
    scenario_path = campaign_dir / "scenario" / "scenario.json"
    scenario: dict = {
        "schema_version": 1,
        "scenario_id": "src-mod",
        "progressive_asset_root_id": "asset-root-src",
        "source_cache_asset_root_id": "asset-root-src",
    }
    if projected:
        scenario["opening_projection_receipt"] = {
            "schema_version": 1,
            "asset_root_id": "asset-root-src",
            "start_location_id": "opening-room",
        }
    elif watch_status is not None:
        scenario["opening_projection_watch"] = {
            "status": watch_status,
            "asset_root_id": "asset-root-src",
        }
    _write_json(scenario_path, scenario)


def test_setup_complete_rejects_placeholder_investigator(tmp_path: Path):
    campaign_id = "placeholder-camp"
    _make_campaign(tmp_path, campaign_id)
    _link_investigator(
        tmp_path, campaign_id, "web-char-setup-draft",
        method="complete_sheet_placeholder",
    )
    envelope = coc_toolbox.run_tool(
        "setup.complete",
        tmp_path,
        None,
        {"campaign_id": campaign_id, "decision_id": "handoff-1"},
    )
    assert envelope["ok"] is False
    assert envelope["error"]["code"] == "character_setup_incomplete"


def test_setup_complete_source_bound_unprojected_is_pending(tmp_path: Path):
    campaign_id = "src-pending"
    campaign_dir = _make_campaign(tmp_path, campaign_id)
    _link_investigator(tmp_path, campaign_id, "inv-ok")
    _bind_source(campaign_dir, projected=False, watch_status="pending")
    envelope = coc_toolbox.run_tool(
        "setup.complete",
        tmp_path,
        None,
        {"campaign_id": campaign_id, "decision_id": "handoff-2"},
    )
    assert envelope["ok"] is False
    assert envelope["error"]["code"] == "opening_source_pending"


def test_setup_complete_builtin_confirmed_is_idempotent(tmp_path: Path):
    campaign_id = "builtin-ready"
    campaign_dir = _make_campaign(tmp_path, campaign_id)
    _link_investigator(tmp_path, campaign_id, "inv-ok")
    first = coc_toolbox.run_tool(
        "setup.complete",
        tmp_path,
        None,
        {"campaign_id": campaign_id, "decision_id": "handoff-3"},
    )
    assert first["ok"] is True, first
    result = first["data"]["result"]
    assert result["ready_for_table"] is True
    assert result["next"] == "table_opening"
    campaign = json.loads((campaign_dir / "campaign.json").read_text())
    assert campaign["status"] == "ready_for_table"
    receipt = campaign["setup_handoff"]
    assert receipt["decision_id"] == "handoff-3"
    assert receipt["investigator_ids"] == ["inv-ok"]
    assert receipt["lane_interrupted_at_handoff"] is False
    replay = coc_toolbox.run_tool(
        "setup.complete",
        tmp_path,
        None,
        {"campaign_id": campaign_id, "decision_id": "handoff-3"},
    )
    assert replay["ok"] is True, replay
    assert replay["data"]["result"]["handoff"] == receipt


def test_setup_complete_source_bound_projected_succeeds(tmp_path: Path):
    campaign_id = "src-ready"
    campaign_dir = _make_campaign(tmp_path, campaign_id)
    _link_investigator(tmp_path, campaign_id, "inv-ok")
    _bind_source(campaign_dir, projected=True)
    envelope = coc_toolbox.run_tool(
        "setup.complete",
        tmp_path,
        None,
        {"campaign_id": campaign_id, "decision_id": "handoff-4"},
    )
    assert envelope["ok"] is True, envelope
    campaign = json.loads((campaign_dir / "campaign.json").read_text())
    assert campaign["status"] == "ready_for_table"
    assert campaign["setup_handoff"]["opening_projection_ref"]["kind"] == (
        "opening_projection_receipt"
    )


def test_session_resume_ready_for_table_points_at_table_opening(tmp_path: Path):
    campaign_id = "resume-table"
    campaign_dir = _make_campaign(tmp_path, campaign_id)
    _link_investigator(tmp_path, campaign_id, "inv-ok")
    completed = coc_toolbox.run_tool(
        "setup.complete",
        tmp_path,
        None,
        {"campaign_id": campaign_id, "decision_id": "handoff-5"},
    )
    assert completed["ok"] is True, completed
    resumed = coc_toolbox.run_tool(
        "session.resume", tmp_path, campaign_id, {},
    )
    assert resumed["ok"] is True, resumed
    assert resumed["data"]["mode"] == "table_opening"
    assert resumed["data"]["next_operations"] == ["evidence.table_opening"]
    assert "character_creation" not in resumed["data"]
    assert campaign_dir.is_dir()
