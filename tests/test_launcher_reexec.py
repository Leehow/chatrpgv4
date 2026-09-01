"""Launcher re-exec: setup handoff exit 42 starts play once."""

from __future__ import annotations

import json
import os
import stat
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
LAUNCHER = REPO / "plugins" / "coc-keeper" / "pi" / "bin" / "pi-coc"
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"

sys.path.insert(0, str(SCRIPTS))
import coc_state  # noqa: E402


def _write_exec(path: Path, body: str) -> None:
    path.write_text(body, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def _agent_home(tmp_path: Path) -> Path:
    agent = tmp_path / "coc-agent"
    bin_dir = agent / "bin"
    bin_dir.mkdir(parents=True)
    (agent / "settings.json").write_text(
        json.dumps(
            {
                "defaultProvider": "test",
                "defaultModel": "test-model",
                "packages": [str(REPO)],
                "quietStartup": True,
            }
        )
        + "\n",
        encoding="utf-8",
    )
    for name in ("fd", "rg"):
        _write_exec(bin_dir / name, "#!/bin/sh\nexit 0\n")
    return agent


def _fake_pi(tmp_path: Path, *, first_exit: int, flip_campaign: Path | None) -> Path:
    fake_bin = tmp_path / "fake-bin"
    fake_bin.mkdir()
    (fake_bin / "package.json").write_text(
        json.dumps({
            "name": "@earendil-works/pi-coding-agent",
            "version": "0.84.2",
        }),
        encoding="utf-8",
    )
    flip = str(flip_campaign) if flip_campaign else ""
    _write_exec(
        fake_bin / "pi",
        f"""#!/bin/sh
log=${{PI_COC_TEST_LOG:?}}
count_file=${{PI_COC_TEST_COUNT:?}}
n=0
if [ -f "$count_file" ]; then
  n=$(cat "$count_file")
fi
n=$((n + 1))
printf '%s\\n' "$n" > "$count_file"
{{
  printf 'CALL=%s\\n' "$n"
  printf 'COC_PI_SESSION_ROLE=%s\\n' "${{COC_PI_SESSION_ROLE-}}"
  printf 'argv:\\n'
  for arg in "$@"; do
    printf '  %s\\n' "$arg"
  done
}} >> "$log"
if [ "$n" -eq 1 ]; then
  flip={json.dumps(flip)}
  if [ -n "$flip" ] && [ -f "$flip" ]; then
    tmp_flip=${{flip}}.tmp
    sed 's/"status": "setup"/"status": "ready_for_table"/' "$flip" > "$tmp_flip"
    mv "$tmp_flip" "$flip"
  fi
  exit {int(first_exit)}
fi
exit 0
""",
    )
    return fake_bin


def _run_launcher(
    tmp_path: Path,
    *,
    campaign_id: str,
    first_exit: int,
    flip: bool,
) -> subprocess.CompletedProcess[str]:
    workspace = tmp_path / "ws"
    workspace.mkdir()
    (workspace / ".coc").mkdir()
    coc_state.create_campaign(workspace, campaign_id, "Reexec Fixture", era="1920s")
    camp_json = workspace / ".coc" / "campaigns" / campaign_id / "campaign.json"
    payload = json.loads(camp_json.read_text(encoding="utf-8"))
    payload["status"] = "setup"
    camp_json.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    agent = _agent_home(tmp_path)
    fake_bin = _fake_pi(
        tmp_path,
        first_exit=first_exit,
        flip_campaign=camp_json if flip else None,
    )
    log = tmp_path / "pi-calls.log"
    count = tmp_path / "pi-count.txt"
    env = {
        **os.environ,
        "PATH": f"{fake_bin}{os.pathsep}{os.environ['PATH']}",
        "COC_PI_CLI": str(fake_bin / "pi"),
        "PI_COC_AGENT_DIR": str(agent),
        "COC_WORKSPACE": str(workspace),
        "PI_COC_TEST_LOG": str(log),
        "PI_COC_TEST_COUNT": str(count),
    }
    return subprocess.run(
        [str(LAUNCHER), "--campaign", campaign_id],
        cwd=str(REPO),
        env=env,
        check=False,
        capture_output=True,
        text=True,
    )


def _calls(tmp_path: Path) -> list[str]:
    log = tmp_path / "pi-calls.log"
    if not log.is_file():
        return []
    return log.read_text(encoding="utf-8").split("--- call ")


def test_handoff_42_reexecs_play_once(tmp_path: Path) -> None:
    completed = _run_launcher(
        tmp_path, campaign_id="reexec-setup", first_exit=42, flip=True
    )
    assert completed.returncode == 0, completed.stderr
    count = int((tmp_path / "pi-count.txt").read_text(encoding="utf-8").strip())
    assert count == 2
    text = (tmp_path / "pi-calls.log").read_text(encoding="utf-8")
    first, second = text.split("CALL=2")
    assert "COC_PI_SESSION_ROLE=setup" in first
    assert "COC_PI_SESSION_ROLE=play" in second
    assert "coc-character" in first
    assert "coc-keeper-play" in second
    assert "coc-keeper-play" not in first
    assert "host-system-play.md" in second
    assert "host-system-setup.md" in first


def test_nonzero_non_handoff_exits_once(tmp_path: Path) -> None:
    completed = _run_launcher(
        tmp_path, campaign_id="reexec-fail", first_exit=3, flip=False
    )
    assert completed.returncode == 3, completed.stderr
    count = int((tmp_path / "pi-count.txt").read_text(encoding="utf-8").strip())
    assert count == 1
    text = (tmp_path / "pi-calls.log").read_text(encoding="utf-8")
    assert text.count("CALL=") == 1
    assert "COC_PI_SESSION_ROLE=setup" in text
