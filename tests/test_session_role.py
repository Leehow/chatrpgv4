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


@pytest.mark.parametrize(
    ("status", "expected"),
    [
        ("setup", "setup"),
        ("ready_for_table", "play"),
        ("active", "play"),
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
