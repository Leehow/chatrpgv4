"""Contract tests for runtime/sdk/rpc_server.py (stdio JSON-RPC sidecar)."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from runtime.sdk import rpc_server

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


def test_project_campaign_state_requires_campaign_id(client: RpcClient) -> None:
    resp = client.request("project_campaign_state", {})
    error = resp.get("error")
    assert error is not None
    assert "campaign_id" in error["message"]


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


def test_send_scopes_opening_text_model_to_current_keeper_selection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    observed: dict[str, str | None] = {}
    monkeypatch.setenv("COC_KEEPER_MODEL_PROVIDER", "previous-provider")
    monkeypatch.setenv("COC_KEEPER_MODEL_ID", "previous-model")
    monkeypatch.setenv("COC_PI_OPENING_MODEL", "previous/opening")
    monkeypatch.setenv("COC_PI_PDF_MODEL", "previous/visual")

    def fake_send(*_args, **_kwargs):
        observed["provider"] = os.environ.get("COC_KEEPER_MODEL_PROVIDER")
        observed["model"] = os.environ.get("COC_KEEPER_MODEL_ID")
        observed["opening"] = os.environ.get("COC_PI_OPENING_MODEL")
        observed["visual"] = os.environ.get("COC_PI_PDF_MODEL")
        return []

    monkeypatch.setattr(rpc_server.sdk, "send", fake_send)
    result = rpc_server._m_send(
        {
            "session_id": "session-1",
            "input": "begin",
            "provider": "xai",
            "model": "grok-4.6",
        },
        1,
    )

    assert result == {"events": []}
    assert observed == {
        "provider": "xai",
        "model": "grok-4.6",
        "opening": "xai/grok-4.6",
        "visual": "xai/grok-4.6",
    }
    assert os.environ["COC_KEEPER_MODEL_PROVIDER"] == "previous-provider"
    assert os.environ["COC_KEEPER_MODEL_ID"] == "previous-model"
    assert os.environ["COC_PI_OPENING_MODEL"] == "previous/opening"
    assert os.environ["COC_PI_PDF_MODEL"] == "previous/visual"


def test_send_forwards_validated_player_intent_to_pi_sdk(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    observed: dict[str, object] = {}
    intent = {
        "primary_intent": "combat",
        "secondary_intents": [],
        "target_entities": ["attack-1"],
        "risk_posture": "neutral",
        "explicit_roll_request": False,
        "player_hypothesis": None,
        "action_atoms": [{
            "kind": "combat_defense",
            "action": "fight_back",
            "attack_id": "attack-1",
        }],
        "npc_interactions": [],
    }

    def fake_send(_session_id, _input, **kwargs):
        observed.update(kwargs)
        return []

    monkeypatch.setattr(rpc_server.sdk, "send", fake_send)
    result = rpc_server._m_send(
        {
            "session_id": "session-1",
            "input": "反击",
            "player_intent": intent,
        },
        1,
    )

    assert result == {"events": []}
    assert observed["player_intent"] == intent
    assert callable(observed["on_keeper_stream"])


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


# ---------------------------------------------------------------------------
# Campaign admin (rename / trash / restore / 24h purge)


def _make_campaign(workspace: Path, campaign_id: str, title: str = "旧名") -> Path:
    """Minimal on-disk campaign: identity doc plus one evidence marker file."""
    campaign_dir = workspace / ".coc" / "campaigns" / campaign_id
    (campaign_dir / "logs").mkdir(parents=True, exist_ok=True)
    (campaign_dir / "logs" / "marker.txt").write_text("evidence\n", "utf-8")
    (campaign_dir / "campaign.json").write_text(
        json.dumps(
            {
                "schema_version": 3,
                "campaign_id": campaign_id,
                "ruleset_id": "coc7",
                "title": title,
                "status": "active",
            },
            ensure_ascii=False,
        ),
        "utf-8",
    )
    return campaign_dir


def test_campaign_rename_updates_title(client: RpcClient, tmp_path: Path) -> None:
    _make_campaign(tmp_path, "alpha", "旧名")
    resp = client.request("campaign_rename", {"campaign_id": "alpha", "title": "新名字"})
    assert resp.get("error") is None
    assert resp["result"] == {"campaign_id": "alpha", "title": "新名字"}
    doc = json.loads(
        (tmp_path / ".coc" / "campaigns" / "alpha" / "campaign.json").read_text("utf-8")
    )
    assert doc["title"] == "新名字"
    # Untouched identity fields survive the atomic rewrite.
    assert doc["campaign_id"] == "alpha"
    assert doc["ruleset_id"] == "coc7"
    assert doc["updated_at"]


def test_campaign_rename_validation(client: RpcClient, tmp_path: Path) -> None:
    _make_campaign(tmp_path, "alpha")
    missing = client.request("campaign_rename", {"campaign_id": "ghost", "title": "x"})
    assert missing["error"]["kind"] == "not_found"
    blank = client.request("campaign_rename", {"campaign_id": "alpha", "title": "   "})
    assert blank["error"]["kind"] == "invalid"
    traversal = client.request(
        "campaign_rename", {"campaign_id": "../alpha", "title": "x"}
    )
    assert traversal["error"]["kind"] == "invalid"


def test_campaign_trash_moves_to_trash_and_lists(
    client: RpcClient, tmp_path: Path
) -> None:
    _make_campaign(tmp_path, "beta", "鬼屋")
    resp = client.request("campaign_trash", {"campaign_id": "beta"})
    assert resp.get("error") is None
    result = resp["result"]
    assert result["trash_key"] == "beta"
    assert result["title"] == "鬼屋"
    # The campaign leaves the listing root; run evidence stays intact under trash.
    assert not (tmp_path / ".coc" / "campaigns" / "beta").exists()
    trashed = tmp_path / ".coc" / "trash" / "campaigns" / "beta"
    assert (trashed / "logs" / "marker.txt").read_text("utf-8") == "evidence\n"
    meta = json.loads(
        (tmp_path / ".coc" / "trash" / "meta" / "beta.json").read_text("utf-8")
    )
    assert meta["campaign_id"] == "beta"
    # Retention window is ~24h.
    deleted_at = datetime.fromisoformat(meta["deleted_at"])
    purge_at = datetime.fromisoformat(meta["purge_at"])
    assert timedelta(hours=23, minutes=55) < purge_at - deleted_at <= timedelta(hours=24)
    # The compat/listing surface reports the campaign as gone.
    compat = client.request("campaign_compat", {"campaign_id": "beta"})
    assert compat["result"] == {"exists": False, "compatible": False}
    listing = client.request("campaign_trash_list", {})
    assert [e["trash_key"] for e in listing["result"]["entries"]] == ["beta"]


def test_campaign_trash_restore_roundtrip(
    client: RpcClient, tmp_path: Path
) -> None:
    _make_campaign(tmp_path, "gamma", "夜色")
    client.request("campaign_trash", {"campaign_id": "gamma"})
    resp = client.request("campaign_trash_restore", {"trash_key": "gamma"})
    assert resp.get("error") is None
    assert resp["result"]["campaign_id"] == "gamma"
    assert (tmp_path / ".coc" / "campaigns" / "gamma" / "logs" / "marker.txt").exists()
    assert not (tmp_path / ".coc" / "trash" / "meta" / "gamma.json").exists()
    listing = client.request("campaign_trash_list", {})
    assert listing["result"]["entries"] == []


def test_campaign_restore_conflict_when_id_taken(
    client: RpcClient, tmp_path: Path
) -> None:
    _make_campaign(tmp_path, "delta")
    client.request("campaign_trash", {"campaign_id": "delta"})
    _make_campaign(tmp_path, "delta")  # a new same-id campaign appeared meanwhile
    resp = client.request("campaign_trash_restore", {"trash_key": "delta"})
    assert resp["error"]["kind"] == "conflict"
    # Both sides stay on disk — a refused restore never loses data.
    assert (tmp_path / ".coc" / "campaigns" / "delta").is_dir()
    assert (tmp_path / ".coc" / "trash" / "campaigns" / "delta").is_dir()


def test_campaign_trash_purge_expired(client: RpcClient, tmp_path: Path) -> None:
    _make_campaign(tmp_path, "epsilon")
    client.request("campaign_trash", {"campaign_id": "epsilon"})
    # Backdate the retention window; listing purges lazily.
    meta_path = tmp_path / ".coc" / "trash" / "meta" / "epsilon.json"
    meta = json.loads(meta_path.read_text("utf-8"))
    meta["purge_at"] = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    meta_path.write_text(json.dumps(meta), "utf-8")
    listing = client.request("campaign_trash_list", {})
    assert listing["result"]["entries"] == []
    assert not (tmp_path / ".coc" / "trash" / "campaigns" / "epsilon").exists()
    assert not meta_path.exists()
    resp = client.request("campaign_trash_restore", {"trash_key": "epsilon"})
    assert resp["error"]["kind"] == "not_found"


def test_campaign_trash_repeat_gets_unique_key(
    client: RpcClient, tmp_path: Path
) -> None:
    _make_campaign(tmp_path, "zeta", "一号")
    client.request("campaign_trash", {"campaign_id": "zeta"})
    _make_campaign(tmp_path, "zeta", "二号")
    resp = client.request("campaign_trash", {"campaign_id": "zeta"})
    assert resp.get("error") is None
    assert resp["result"]["trash_key"] != "zeta"
    listing = client.request("campaign_trash_list", {})
    assert len(listing["result"]["entries"]) == 2
