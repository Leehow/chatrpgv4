"""Codex plugin MCP activation contract (config resolve + real handshake).

Proves the declared mcp-codex.json form can start the real launcher and list
tools. Does not claim live Codex host cache refresh or session activation.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PLUGIN_ROOT = ROOT / "plugins" / "coc-keeper"
CODEX_MCP_CONFIG = PLUGIN_ROOT / "mcp-codex.json"
UNRESOLVED_TOKEN_RE = re.compile(r"\$\{[^}]+\}")
REQUIRED_TOOLS = ("coc_capabilities", "coc_discover", "coc_invoke")


def _load_codex_mcp_entry() -> dict:
    config = json.loads(CODEX_MCP_CONFIG.read_text(encoding="utf-8"))
    return config["mcpServers"]["coc-keeper"]


def _resolve_codex_plugin_relative_spawn(entry: dict) -> tuple[list[str], Path, dict]:
    """Resolve spawn the way working Codex plugins bind plugin-relative paths.

    ``cwd: "."`` is the plugin root; ``command`` must stay under that root as a
    ``./...`` path. Session/campaign cwd is not the MCP process cwd.
    """
    command = entry["command"]
    assert isinstance(command, str) and command.startswith("./"), command
    assert not UNRESOLVED_TOKEN_RE.search(command), command
    assert entry.get("cwd") == ".", entry.get("cwd")

    spawn_cwd = PLUGIN_ROOT.resolve()
    launcher = (spawn_cwd / command[2:]).resolve()
    assert launcher.is_file(), launcher
    assert spawn_cwd in launcher.parents or launcher.parent == spawn_cwd

    env = os.environ.copy()
    for name in (
        "COC_PROJECT_ROOT",
        "COC_RUNTIME_ROOT",
        "GROK_WORKSPACE_ROOT",
        "CLAUDE_PROJECT_DIR",
    ):
        env.pop(name, None)
    env.update({str(k): str(v) for k, v in entry.get("env", {}).items()})
    assert env.get("COC_HOST") == "codex"
    return [os.fspath(launcher)], spawn_cwd, env


def test_codex_mcp_config_rejects_unresolved_tokens_and_pins_supported_shape():
    entry = _load_codex_mcp_entry()
    assert not UNRESOLVED_TOKEN_RE.search(entry["command"])
    assert entry == {
        "command": "./mcp/launch",
        "cwd": ".",
        "env": {"COC_HOST": "codex"},
    }


def test_literal_plugin_root_token_is_not_an_executable_path():
    """Negative arm: the old host-inventoried form cannot be exec'd."""
    literal = "${PLUGIN_ROOT}/mcp/launch"
    # Must not resolve to a real path on disk (token stays literal).
    assert not Path(literal).exists()
    try:
        completed = subprocess.run(
            [literal],
            cwd=os.fspath(ROOT),
            capture_output=True,
            text=True,
            check=False,
            timeout=5,
        )
    except FileNotFoundError:
        return
    assert completed.returncode != 0


def test_codex_mcp_activation_handshakes_from_plugin_cwd_not_campaign_cwd(tmp_path):
    """Start declared launcher under plugin cwd; list real gateway tools.

    ``tmp_path`` stands for an arbitrary campaign workspace the host may have
    open. Codex still binds MCP ``cwd`` to the plugin root (``"."``), so the
    process must not require the campaign directory as its working directory.
    """
    campaign_cwd = tmp_path / "campaign-sandbox"
    campaign_cwd.mkdir()
    # Campaign root must not be the spawn cwd; only prove it exists as decoy.
    assert campaign_cwd.is_dir()
    assert campaign_cwd.resolve() != PLUGIN_ROOT.resolve()

    entry = _load_codex_mcp_entry()
    argv, spawn_cwd, env = _resolve_codex_plugin_relative_spawn(entry)
    assert spawn_cwd == PLUGIN_ROOT.resolve()
    assert Path(argv[0]).name == "launch"

    messages = (
        json.dumps(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {"name": "test-codex-mcp-activation", "version": "0"},
                },
            }
        )
        + "\n"
        + json.dumps(
            {
                "jsonrpc": "2.0",
                "method": "notifications/initialized",
            }
        )
        + "\n"
        + json.dumps(
            {
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/list",
                "params": {},
            }
        )
        + "\n"
    )
    completed = subprocess.run(
        argv,
        cwd=os.fspath(spawn_cwd),
        env=env,
        input=messages,
        text=True,
        capture_output=True,
        check=False,
        timeout=30,
    )
    assert completed.returncode == 0, completed.stderr
    responses = [
        json.loads(line)
        for line in completed.stdout.splitlines()
        if line.strip()
    ]
    by_id = {item.get("id"): item for item in responses if "id" in item}
    assert 1 in by_id and 2 in by_id, responses

    init = by_id[1]["result"]
    assert init["serverInfo"]["name"] == "coc-keeper"

    tools = by_id[2]["result"]["tools"]
    names = [tool["name"] for tool in tools]
    for required in REQUIRED_TOOLS:
        assert required in names, names
    assert len(tools) >= 3
