"""Contract tests for runtime/sdk/rpc_server.py (stdio JSON-RPC sidecar)."""
from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
RPC_SERVER = REPO_ROOT / "runtime" / "sdk" / "rpc_server.py"


class RpcClient:
    """Minimal line-JSON RPC client for tests."""

    def __init__(self, workspace: Path) -> None:
        self.proc = subprocess.Popen(
            [sys.executable, str(RPC_SERVER), "--workspace", str(workspace)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
        self._next_id = 0

    def request(self, method: str, params: dict | None = None, timeout: float = 30.0):
        self._next_id += 1
        request_id = self._next_id
        line = json.dumps({"id": request_id, "method": method, "params": params or {}})
        assert self.proc.stdin is not None and self.proc.stdout is not None
        self.proc.stdin.write((line + "\n").encode("utf-8"))
        self.proc.stdin.flush()
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            raw = self.proc.stdout.readline()
            if not raw:
                raise AssertionError("rpc server closed stdout unexpectedly")
            try:
                msg = json.loads(raw.decode("utf-8"))
            except json.JSONDecodeError:
                continue
            if not isinstance(msg, dict) or msg.get("id") != request_id:
                continue  # notification or out-of-band message
            return msg
        raise AssertionError(f"timed out waiting for response to {method}")

    def close(self) -> None:
        if self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.proc.kill()


@pytest.fixture()
def client(tmp_path: Path):
    client = RpcClient(tmp_path)
    try:
        yield client
    finally:
        client.close()


def test_ping_reports_workspace(client: RpcClient, tmp_path: Path) -> None:
    resp = client.request("ping")
    result = resp.get("result")
    assert resp.get("error") is None
    assert result["ok"] is True
    assert result["workspace"] == str(tmp_path.resolve())


def test_unknown_method_gets_error_envelope(client: RpcClient) -> None:
    resp = client.request("no_such_method")
    error = resp.get("error")
    assert error is not None
    assert error["class"] == "UnknownMethodError"
    assert "no_such_method" in error["message"]


def test_campaign_compat_missing_campaign(client: RpcClient) -> None:
    resp = client.request("campaign_compat", {"campaign_id": "nope"})
    result = resp.get("result")
    assert resp.get("error") is None
    assert result == {"exists": False, "compatible": False}


def test_get_state_unknown_session_error_kind(client: RpcClient) -> None:
    resp = client.request("get_state", {"session_id": "sess-does-not-exist"})
    error = resp.get("error")
    assert error is not None
    assert error["kind"] == "unknown_session"
    assert error["class"] == "UnknownSessionError"


def test_send_validates_required_params(client: RpcClient) -> None:
    resp = client.request("send", {"session_id": "", "input": "hello"})
    error = resp.get("error")
    assert error is not None
    assert "session_id is required" in error["message"]


def test_malformed_line_gets_protocol_error(tmp_path: Path) -> None:
    proc = subprocess.Popen(
        [sys.executable, str(RPC_SERVER), "--workspace", str(tmp_path)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    try:
        assert proc.stdin is not None and proc.stdout is not None
        proc.stdin.write(b"this is not json\n")
        proc.stdin.flush()
        raw = proc.stdout.readline()
        msg = json.loads(raw.decode("utf-8"))
        assert msg["error"]["class"] == "ProtocolError"
    finally:
        proc.terminate()
        proc.wait(timeout=5)


def test_display_character_absent_returns_null(client: RpcClient) -> None:
    resp = client.request(
        "display_character",
        {"investigator_id": "nobody", "play_language": "zh-Hans"},
    )
    result = resp.get("result")
    assert resp.get("error") is None
    assert result == {"character": None}
