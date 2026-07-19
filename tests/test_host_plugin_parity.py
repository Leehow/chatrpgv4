import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess


ROOT = Path(__file__).resolve().parents[1]
PLUGIN_ROOT = ROOT / "plugins" / "coc-keeper"
EXPECTED_VERSION = "0.4.0-alpha.0"


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def load_gateway():
    path = PLUGIN_ROOT / "mcp" / "server.py"
    spec = importlib.util.spec_from_file_location("coc_keeper_mcp_test", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_all_four_host_manifests_share_the_canonical_version_and_skill_tree():
    manifests = {
        "codex": PLUGIN_ROOT / ".codex-plugin" / "plugin.json",
        "cursor": PLUGIN_ROOT / ".cursor-plugin" / "plugin.json",
        "kimi": PLUGIN_ROOT / ".kimi-plugin" / "plugin.json",
        "zcode": PLUGIN_ROOT / ".zcode-plugin" / "plugin.json",
    }
    for host, path in manifests.items():
        manifest = read_json(path)
        assert manifest["name"] == "coc-keeper", host
        assert manifest["version"] == EXPECTED_VERSION, host
        skills = (PLUGIN_ROOT / manifest["skills"]).resolve()
        assert skills == (PLUGIN_ROOT / "skills").resolve(), host
        assert (skills / "coc-main" / "SKILL.md").is_file(), host
        assert (skills / "coc-keeper-play" / "SKILL.md").is_file(), host
        assert (skills / "coc-story-director" / "SKILL.md").is_file(), host


def test_kimi_uses_current_plugin_manifest_path_and_mcp():
    manifest = read_json(PLUGIN_ROOT / ".kimi-plugin" / "plugin.json")
    assert manifest["sessionStart"]["skill"] == "coc-host-bootstrap"
    assert manifest["mcpServers"]["coc-keeper"]["command"] == "./mcp/launch"
    assert (PLUGIN_ROOT / "skills" / "coc-host-bootstrap" / "SKILL.md").is_file()


def test_zcode_uses_plugin_root_variables_for_mcp():
    manifest = read_json(PLUGIN_ROOT / ".zcode-plugin" / "plugin.json")
    server = manifest["mcpServers"]["coc-keeper"]
    assert server["command"] == "${ZCODE_PLUGIN_ROOT}/mcp/launch"
    assert server["cwd"] == "${ZCODE_PROJECT_DIR}"
    assert server["env"]["COC_HOST"] == "zcode"


def test_cursor_plugin_bundles_the_same_mcp_server():
    mcp = read_json(PLUGIN_ROOT / "mcp.json")
    assert mcp["mcpServers"]["coc-keeper"]["command"] == "./mcp/launch"
    assert mcp["mcpServers"]["coc-keeper"]["env"]["COC_HOST"] == "cursor"


def test_mcp_gateway_exposes_registry_and_capability_tools():
    gateway = load_gateway()
    response = gateway._handle({"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    assert response["result"]["tools"][0]["name"] == "coc_capabilities"
    names = {tool["name"] for tool in response["result"]["tools"]}
    assert {"coc_discover", "scene.context", "turn.finalize"} <= names
    assert len(names) >= 60


def test_mcp_gateway_routes_discovery_and_read_only_calls_to_toolbox():
    gateway = load_gateway()
    discovered = gateway._handle({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/call",
        "params": {"name": "coc_discover", "arguments": {"operation": "rules.skill_describe"}},
    })
    assert discovered["result"]["structuredContent"]["ok"] is True
    assert discovered["result"]["structuredContent"]["data"]["operation"]["name"] == "rules.skill_describe"

    called = gateway._handle({
        "jsonrpc": "2.0",
        "id": 3,
        "method": "tools/call",
        "params": {
            "name": "rules.skill_describe",
            "arguments": {"root": str(ROOT), "skill": "Persuade"},
        },
    })
    envelope = called["result"]["structuredContent"]
    assert envelope["ok"] is True
    assert envelope["tool"] == "rules.skill_describe"


def test_mcp_gateway_starts_from_a_managed_plugin_copy(tmp_path):
    managed = tmp_path / "managed" / "coc-keeper"
    shutil.copytree(PLUGIN_ROOT, managed)
    env = os.environ.copy()
    env.update({"COC_HOST": "zcode", "COC_PROJECT_ROOT": str(ROOT)})
    payload = "\n".join([
        json.dumps({"jsonrpc": "2.0", "id": 1, "method": "initialize"}),
        json.dumps({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {"name": "coc_capabilities", "arguments": {}},
        }),
        "",
    ])
    completed = subprocess.run(
        [str(managed / "mcp" / "launch")],
        input=payload,
        text=True,
        capture_output=True,
        env=env,
        check=False,
        timeout=30,
    )
    assert completed.returncode == 0, completed.stderr
    responses = [json.loads(line) for line in completed.stdout.splitlines()]
    assert responses[0]["result"]["serverInfo"]["name"] == "coc-keeper"
    assert responses[1]["result"]["structuredContent"]["data"]["host"] == "zcode"
