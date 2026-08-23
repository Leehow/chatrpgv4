from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"
LAUNCHER = REPO / "plugins" / "coc-keeper" / "pi" / "bin" / "pi-coc"
CLI = SCRIPTS / "coc_session_role.py"

sys.path.insert(0, str(SCRIPTS))
import coc_state  # noqa: E402


def _run_cli(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(CLI), *args],
        cwd=str(REPO),
        text=True,
        capture_output=True,
        check=False,
    )


def _set_status(root: Path, campaign_id: str, status: str) -> None:
    path = root / ".coc" / "campaigns" / campaign_id / "campaign.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["status"] = status
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def _link_confirmed_investigator(
    root: Path, campaign_id: str, investigator_id: str
) -> None:
    campaign_dir = root / ".coc" / "campaigns" / campaign_id
    (campaign_dir / "party.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "campaign_id": campaign_id,
                "investigator_ids": [investigator_id],
                "active_investigator_ids": [investigator_id],
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    inv_dir = root / ".coc" / "investigators" / investigator_id
    inv_dir.mkdir(parents=True, exist_ok=True)
    (inv_dir / "creation.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "investigator_id": investigator_id,
                "method": "quick_fire",
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


@pytest.mark.parametrize(
    ("status", "expected"),
    [
        ("setup", "setup"),
        ("ready_for_table", "play"),
    ],
)
def test_status_maps_to_role(tmp_path: Path, status: str, expected: str) -> None:
    campaign_id = f"role-{status}"
    coc_state.create_campaign(tmp_path, campaign_id, "Role Fixture", era="1920s")
    _set_status(tmp_path, campaign_id, status)
    assert coc_state.infer_pi_session_role(tmp_path, campaign_id) == expected
    result = _run_cli(str(tmp_path), campaign_id)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == expected


def test_active_with_confirmed_investigator_without_handoff_is_setup(
    tmp_path: Path,
) -> None:
    campaign_id = "role-active-confirmed"
    coc_state.create_campaign(tmp_path, campaign_id, "Role Fixture", era="1920s")
    _set_status(tmp_path, campaign_id, "active")
    _link_confirmed_investigator(tmp_path, campaign_id, "inv-ok")
    assert coc_state.infer_pi_session_role(tmp_path, campaign_id) == "setup"
    result = _run_cli(str(tmp_path), campaign_id)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "setup"


def test_active_with_completed_handoff_is_play(tmp_path: Path) -> None:
    campaign_id = "role-active-handed-off"
    coc_state.create_campaign(tmp_path, campaign_id, "Role Fixture", era="1920s")
    _set_status(tmp_path, campaign_id, "active")
    _link_confirmed_investigator(tmp_path, campaign_id, "inv-ok")
    campaign_path = tmp_path / ".coc" / "campaigns" / campaign_id / "campaign.json"
    campaign = json.loads(campaign_path.read_text(encoding="utf-8"))
    campaign["setup_handoff"] = {
        "schema_version": 1,
        "campaign_id": campaign_id,
        "decision_id": "handoff-role-active",
        "investigator_ids": ["inv-ok"],
        "completed_at": "2026-08-22T00:00:00Z",
        "opening_projection_ref": None,
        "lane_interrupted_at_handoff": False,
    }
    campaign_path.write_text(json.dumps(campaign, indent=2) + "\n", encoding="utf-8")
    assert coc_state.infer_pi_session_role(tmp_path, campaign_id) == "play"


def test_active_with_empty_party_is_setup(tmp_path: Path) -> None:
    campaign_id = "role-active-empty"
    coc_state.create_campaign(tmp_path, campaign_id, "Role Fixture", era="1920s")
    _set_status(tmp_path, campaign_id, "active")
    assert not coc_state.campaign_has_confirmed_investigator(
        tmp_path / ".coc" / "campaigns" / campaign_id, campaign_id
    )
    assert coc_state.infer_pi_session_role(tmp_path, campaign_id) == "setup"
    result = _run_cli(str(tmp_path), campaign_id)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "setup"


def test_active_with_placeholder_investigator_is_setup(tmp_path: Path) -> None:
    campaign_id = "role-active-placeholder"
    investigator_id = "web-char-setup-draft"
    coc_state.create_campaign(tmp_path, campaign_id, "Role Fixture", era="1920s")
    _set_status(tmp_path, campaign_id, "active")
    campaign_dir = tmp_path / ".coc" / "campaigns" / campaign_id
    (campaign_dir / "party.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "campaign_id": campaign_id,
                "investigator_ids": [investigator_id],
                "active_investigator_ids": [investigator_id],
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    inv_dir = tmp_path / ".coc" / "investigators" / investigator_id
    inv_dir.mkdir(parents=True, exist_ok=True)
    (inv_dir / "creation.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "investigator_id": investigator_id,
                "method": "complete_sheet_placeholder",
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    assert not coc_state.campaign_has_confirmed_investigator(
        campaign_dir, campaign_id
    )
    assert coc_state.infer_pi_session_role(tmp_path, campaign_id) == "setup"
    result = _run_cli(str(tmp_path), campaign_id)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "setup"


def test_missing_campaign_is_setup(tmp_path: Path) -> None:
    (tmp_path / ".coc").mkdir()
    assert coc_state.infer_pi_session_role(tmp_path, "brand-new") == "setup"
    result = _run_cli(str(tmp_path), "brand-new")
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "setup"


def test_missing_workspace_is_nonzero(tmp_path: Path) -> None:
    missing = tmp_path / "no-such-workspace"
    with pytest.raises(FileNotFoundError):
        coc_state.infer_pi_session_role(missing, "any-id")
    result = _run_cli(str(missing), "any-id")
    assert result.returncode != 0
    assert result.stderr


def test_launcher_bash_syntax() -> None:
    result = subprocess.run(
        ["bash", "-n", str(LAUNCHER)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
