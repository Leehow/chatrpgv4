"""Kernel seam tests speak JSON lines to a real `python -m coc.rpc` subprocess."""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any

import pytest

WORKTREE = Path(__file__).resolve().parents[2]
KERNEL_DIR = WORKTREE / "kernel"
CONTENT_DIR = WORKTREE / "content"

MODULE = "the-haunting"
PREGEN = "thomas-hayes"
OPENING_SCENE = "commission-briefing"
CAMPAIGN = "c1"


class RpcClient:
    def __init__(self, workspace: Path, env: dict[str, str] | None = None) -> None:
        self.workspace = Path(workspace)
        self.workspace.mkdir(parents=True, exist_ok=True)
        merged = {**os.environ, "PYTHONPATH": str(KERNEL_DIR), "PYTHONDONTWRITEBYTECODE": "1"}
        merged.update(env or {})
        self.proc = subprocess.Popen(
            ["uv", "run", "--frozen", "python", "-m", "coc.rpc",
             "--workspace", str(self.workspace), "--content", str(CONTENT_DIR)],
            cwd=WORKTREE, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, encoding="utf-8", bufsize=1, env=merged,
        )
        self._n = 0

    def raw(self, line: str) -> dict[str, Any]:
        assert self.proc.stdin and self.proc.stdout
        self.proc.stdin.write(line + "\n")
        self.proc.stdin.flush()
        reply = self.proc.stdout.readline()
        if not reply:
            stderr = self.proc.stderr.read() if self.proc.stderr else ""
            raise AssertionError(f"kernel exited (rc={self.proc.poll()}):\n{stderr}")
        return json.loads(reply)

    def call(self, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        self._n += 1
        request = {"id": f"req-{self._n}", "method": method, "params": params or {}}
        response = self.raw(json.dumps(request, ensure_ascii=False))
        assert response["id"] == request["id"]
        return response

    def ok(self, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        response = self.call(method, params)
        assert response["ok"], f"{method} failed: {response.get('error')}"
        return response["result"]

    def err(self, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        response = self.call(method, params)
        assert not response["ok"], f"{method} unexpectedly succeeded: {response.get('result')}"
        return response["error"]

    def close(self) -> None:
        if self.proc.stdin:
            self.proc.stdin.close()
        try:
            self.proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.proc.kill()

    # ---- table shortcuts (campaign fixed to CAMPAIGN) ----------------------

    def table(self, method: str, **params: Any) -> dict[str, Any]:
        return self.ok(f"table.{method}", {"campaign": CAMPAIGN, **params})

    def table_err(self, method: str, **params: Any) -> dict[str, Any]:
        return self.err(f"table.{method}", {"campaign": CAMPAIGN, **params})


def campaign_dir(workspace: Path, campaign_id: str = CAMPAIGN) -> Path:
    return workspace / ".coc" / "campaigns" / campaign_id


def repo_dir(workspace: Path, campaign_id: str = CAMPAIGN) -> Path:
    return workspace / ".coc" / "repos" / f"{campaign_id}.git"


def git_log(workspace: Path, campaign_id: str = CAMPAIGN) -> list[str]:
    result = subprocess.run(
        ["git", f"--git-dir={repo_dir(workspace, campaign_id)}", "log", "--format=%s"],
        capture_output=True, text=True, check=True,
    )
    return [line for line in result.stdout.splitlines() if line]


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def create_campaign(client: RpcClient, campaign_id: str = CAMPAIGN) -> dict[str, Any]:
    return client.ok("campaign.create", {"id": campaign_id, "module": MODULE, "pregen": PREGEN,
                                         "play_language": "zh-Hans"})


def narrate_opening(client: RpcClient, text: str = "开场。\n\n诺特把钥匙拍在桌上。") -> dict[str, Any]:
    return client.table("narrate", call_id="t0-c1", text=text)


def open_turn(client: RpcClient, text: str = "我仔细观察诺特。") -> dict[str, Any]:
    """Create → opening narrate → first player input; returns the player_input result."""
    create_campaign(client)
    narrate_opening(client)
    return client.table("player_input", text=text)


@pytest.fixture
def kernel(tmp_path: Path):
    client = RpcClient(tmp_path / "ws")
    yield client
    client.close()


@pytest.fixture
def seeded_kernel(tmp_path: Path):
    client = RpcClient(tmp_path / "ws", env={"COC_KERNEL_SEED": "7"})
    yield client
    client.close()
