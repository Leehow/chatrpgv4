import importlib.util
import json
import os
from pathlib import Path
import subprocess
import re
import sys


ROOT = Path(__file__).resolve().parents[1]
PLUGIN_ROOT = ROOT / "plugins" / "coc-keeper"
ARCHIVE_PATH = PLUGIN_ROOT / "references" / "mcp-operation-contracts.json"
ARCHIVE_SCRIPT = PLUGIN_ROOT / "scripts" / "coc_mcp_contract_archive.py"
MAX_GROK_TOOLS_LIST_BYTES = 20 * 1024


def _load_server():
    # Unique module name so progressive-discovery reload picks up file changes
    # within a single pytest process that already imported an older server.
    name = f"test_coc_keeper_mcp_server_{ARCHIVE_PATH.stat().st_mtime_ns}"
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(
        name, PLUGIN_ROOT / "mcp" / "server.py"
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def _load_archive_module():
    name = "test_coc_mcp_contract_archive"
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, ARCHIVE_SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def _canonical_tools_list_bytes(tools: list[dict]) -> int:
    payload = {"tools": tools}
    return len(
        json.dumps(
            payload,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    )


def test_plugin_launcher_handshakes_from_opened_project_without_hook_env():
    env = os.environ.copy()
    for name in (
        "COC_PROJECT_ROOT",
        "COC_RUNTIME_ROOT",
        "GROK_WORKSPACE_ROOT",
        "CLAUDE_PROJECT_DIR",
    ):
        env.pop(name, None)
    env["COC_HOST"] = "grok"
    messages = (
        json.dumps({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {"protocolVersion": "2024-11-05"},
        })
        + "\n"
        + json.dumps({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {"name": "coc_capabilities", "arguments": {}},
        })
        + "\n"
    )
    completed = subprocess.run(
        [os.fspath(PLUGIN_ROOT / "mcp" / "launch")],
        cwd=ROOT,
        env=env,
        input=messages,
        text=True,
        capture_output=True,
        check=False,
        timeout=30,
    )
    assert completed.returncode == 0, completed.stderr
    responses = [json.loads(line) for line in completed.stdout.splitlines()]
    assert responses[0]["result"]["serverInfo"]["name"] == "coc-keeper"
    capabilities = responses[1]["result"]["structuredContent"]["data"]
    assert capabilities["host"] == "grok"
    assert capabilities["capabilities"]["plugin_mcp"] is True


def test_grok_mcp_uses_canonical_launcher_and_capabilities(monkeypatch):
    config = json.loads((PLUGIN_ROOT / ".mcp.json").read_text(encoding="utf-8"))
    entry = config["mcpServers"]["coc-keeper"]
    assert entry["command"].endswith("/mcp/launch")
    assert (PLUGIN_ROOT / "mcp" / "launch").is_file()

    server = _load_server()
    monkeypatch.setenv("COC_HOST", "grok")
    envelope = server._call_tool("coc_capabilities", {})
    assert envelope["ok"] is True
    assert envelope["data"]["host"] == "grok"
    assert envelope["data"]["capabilities"]["plugin_mcp"] is True

    listed = server._handle({"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    tool_names = [tool["name"] for tool in listed["result"]["tools"]]
    assert "rules_roll" in tool_names
    assert "rules.roll" not in tool_names
    assert all("__" not in name for name in tool_names)
    assert all(re.fullmatch(r"[a-zA-Z_][a-zA-Z0-9_-]{0,63}", name) for name in tool_names)

    discovered = server._call_tool("coc_discover", {"operation": "rules.roll"})
    assert discovered["data"]["canonical_operation"] == "rules.roll"
    assert discovered["data"]["operation"]["name"] == "rules_roll"

    # Hidden long-tail direct call remains compatible even when not listed.
    called = server._call_tool(
        "rules_skill_describe",
        {"root": os.fspath(ROOT), "skill": "Persuade"},
    )
    assert called["ok"] is True
    assert called["tool"] == "rules.skill_describe"


def test_grok_workspace_root_precedes_process_cwd(monkeypatch, tmp_path):
    server = _load_server()
    monkeypatch.delenv("COC_PROJECT_ROOT", raising=False)
    monkeypatch.setenv("GROK_WORKSPACE_ROOT", os.fspath(tmp_path))
    monkeypatch.chdir(ROOT)
    assert server._default_root() == tmp_path.resolve()


def test_mcp_contract_archive_matches_toolbox_and_is_deterministic():
    archive_mod = _load_archive_module()
    server = _load_server()

    on_disk = archive_mod.load_and_validate(ARCHIVE_PATH, server.toolbox)
    rebuilt = archive_mod.build_archive(server.toolbox)

    assert on_disk["schema_version"] == archive_mod.SCHEMA_VERSION
    assert on_disk["kind"] == archive_mod.ARCHIVE_KIND
    assert on_disk["content_sha256"].startswith("sha256:")
    assert on_disk["content_sha256"] == rebuilt["content_sha256"]
    assert on_disk["operation_count"] == len(server.toolbox.TOOLS)
    assert set(on_disk["operations"]) == set(server.toolbox.TOOLS)
    assert on_disk["listed_hotset"] == list(archive_mod.MCP_LISTED_HOTSET)
    assert "state.record_npc_engagement" in on_disk["listed_hotset"]
    assert "state.move_scene" not in on_disk["listed_hotset"]
    assert len(on_disk["listed_hotset"]) == 12
    assert on_disk["listed_hotset"][0] == "session.resume"

    # Nested finalizer contract remains complete in the archive.
    finalize = on_disk["operations"]["turn.finalize"]
    coverage_item = finalize["inputSchema"]["properties"]["coverage"]["items"]
    assert coverage_item["additionalProperties"] is False
    assert set(coverage_item["required"]) == set(
        server.toolbox.coc_turn_finalization.COVERAGE_FIELDS
    )

    first = archive_mod.archive_to_canonical_bytes(rebuilt)
    second = archive_mod.archive_to_canonical_bytes(
        archive_mod.build_archive(server.toolbox)
    )
    assert first == second

    check = subprocess.run(
        [
            sys.executable,
            os.fspath(ARCHIVE_SCRIPT),
            "check",
            "--path",
            os.fspath(ARCHIVE_PATH),
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert check.returncode == 0, check.stdout + check.stderr
    assert json.loads(check.stdout)["ok"] is True


def test_mcp_contract_archive_check_detects_drift(tmp_path):
    archive_mod = _load_archive_module()
    server = _load_server()
    archive = archive_mod.build_archive(server.toolbox)

    # Drop one operation so the set no longer equals toolbox.TOOLS.
    dropped = next(iter(archive["operations"]))
    del archive["operations"][dropped]
    archive["operation_count"] = len(archive["operations"])
    archive["content_sha256"] = archive_mod.digest_archive_content(archive)
    stale_path = tmp_path / "stale-mcp-operation-contracts.json"
    stale_path.write_bytes(archive_mod.archive_to_canonical_bytes(archive))

    check = subprocess.run(
        [
            sys.executable,
            os.fspath(ARCHIVE_SCRIPT),
            "check",
            "--path",
            os.fspath(stale_path),
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert check.returncode != 0
    payload = json.loads(check.stdout)
    assert payload["ok"] is False
    assert payload["error"]["code"] in {"archive_stale", "archive_hash"}


def test_mcp_contract_archive_hash_binds_listed_hotset(tmp_path):
    """Mutating only listed_hotset must fail as archive_hash, not hotset drift."""
    archive_mod = _load_archive_module()
    server = _load_server()
    archive = archive_mod.build_archive(server.toolbox)
    claimed = archive["content_sha256"]

    # Leave content_sha256 untouched so the failure is hash-bound, not a later
    # listed_hotset equality check against MCP_LISTED_HOTSET.
    mutated = list(archive["listed_hotset"]) + ["state.move_scene"]
    assert "state.move_scene" not in archive["listed_hotset"]
    archive["listed_hotset"] = mutated
    assert archive["content_sha256"] == claimed

    stale_path = tmp_path / "hotset-mutated-mcp-operation-contracts.json"
    stale_path.write_bytes(archive_mod.archive_to_canonical_bytes(archive))

    # In-memory validate agrees with the CLI check path.
    try:
        archive_mod.validate_archive(archive, server.toolbox, path=stale_path)
        raise AssertionError("expected archive_hash failure")
    except archive_mod.ContractArchiveError as exc:
        assert exc.code == "archive_hash"

    check = subprocess.run(
        [
            sys.executable,
            os.fspath(ARCHIVE_SCRIPT),
            "check",
            "--path",
            os.fspath(stale_path),
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert check.returncode != 0
    payload = json.loads(check.stdout)
    assert payload["ok"] is False
    assert payload["error"]["code"] == "archive_hash"


def test_grok_tools_list_is_progressive_hotset_under_20kib(monkeypatch):
    server = _load_server()
    monkeypatch.setenv("COC_HOST", "grok")
    listed = server._handle({"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    tools = listed["result"]["tools"]
    names = [tool["name"] for tool in tools]

    assert len(tools) == 15
    assert names[:3] == ["coc_capabilities", "coc_discover", "coc_invoke"]
    expected_hotset = [
        op.replace(".", "_") for op in server.MCP_LISTED_HOTSET
    ]
    assert names[3:] == expected_hotset
    assert names[3] == "session_resume"
    assert "state_record_npc_engagement" in names
    assert "state.record_npc_engagement" in server.MCP_LISTED_HOTSET
    assert "state_move_scene" not in names
    assert "state.move_scene" not in server.MCP_LISTED_HOTSET
    assert "rules_skill_describe" not in names
    assert "rules.skill_describe" not in names

    byte_size = _canonical_tools_list_bytes(tools)
    assert byte_size < MAX_GROK_TOOLS_LIST_BYTES, (
        f"tools/list canonical JSON is {byte_size} bytes; "
        f"budget is {MAX_GROK_TOOLS_LIST_BYTES}"
    )


def test_coc_discover_operation_and_domain(monkeypatch):
    server = _load_server()
    monkeypatch.setenv("COC_HOST", "grok")

    full = server._call_tool(
        "coc_discover", {"operation": "rules.skill_describe"}
    )
    assert full["ok"] is True
    data = full["data"]
    assert data["ok"] is True
    assert data["canonical_operation"] == "rules.skill_describe"
    assert data["operation"]["name"] == "rules_skill_describe"
    assert data["operation"]["inputSchema"]["type"] == "object"
    assert "skill" in data["operation"]["inputSchema"]["properties"]

    progressive = server._call_tool(
        "coc_discover", {"domain": "progressive"}
    )
    assert progressive["ok"] is True
    catalog = progressive["data"]
    assert catalog["ok"] is True
    assert catalog["domain_count"] == 1
    assert catalog["domains"][0]["domain"] == "progressive"
    op_ids = [row["operation"] for row in catalog["domains"][0]["operations"]]
    assert op_ids
    assert all(op.startswith("progressive.") for op in op_ids)
    # Compact rows must not embed full input schemas.
    for row in catalog["domains"][0]["operations"]:
        assert set(row) == {"operation", "summary"}

    empty = server._call_tool("coc_discover", {})
    assert empty["data"]["ok"] is True
    assert empty["data"]["count"] == len(server.toolbox.TOOLS)
    assert empty["data"]["domain_count"] >= 1


def test_coc_invoke_long_tail_and_structured_errors(monkeypatch, tmp_path):
    server = _load_server()
    monkeypatch.setenv("COC_HOST", "grok")

    invoked = server._call_tool(
        "coc_invoke",
        {
            "operation": "rules.skill_describe",
            "root": os.fspath(ROOT),
            "arguments": {"skill": "Persuade"},
        },
    )
    assert invoked["ok"] is True
    assert invoked["tool"] == "rules.skill_describe"

    unknown = server._call_tool(
        "coc_invoke",
        {"operation": "rules.not_a_real_tool", "arguments": {}},
    )
    assert unknown["ok"] is False
    assert unknown["error"]["code"] == "unknown_tool"

    bad_root = server._call_tool(
        "coc_invoke",
        {
            "operation": "rules.skill_describe",
            "root": os.fspath(tmp_path / "missing-project-root"),
            "arguments": {"skill": "Persuade"},
        },
    )
    assert bad_root["ok"] is False
    assert bad_root["error"]["code"] == "invalid_root"


def test_listed_hotset_direct_call_still_succeeds(monkeypatch, tmp_path):
    server = _load_server()
    monkeypatch.setenv("COC_HOST", "grok")

    listed = server._handle({"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    names = {tool["name"] for tool in listed["result"]["tools"]}
    assert "rules_roll" in names

    # Missing campaign still fails closed through the listed hotset name.
    missing_campaign = server._call_tool(
        "rules_roll",
        {
            "root": os.fspath(ROOT),
            "skill": "Spot Hidden",
            "value": 50,
        },
    )
    assert missing_campaign["ok"] is False
    assert missing_campaign.get("tool") == "rules.roll"
    assert missing_campaign["error"]["code"] == "missing_campaign"

    # A real listed hotset call still reaches the canonical toolbox gateway.
    starter_spec = importlib.util.spec_from_file_location(
        "coc_starter_for_mcp_test",
        PLUGIN_ROOT / "scripts" / "coc_starter.py",
    )
    assert starter_spec is not None and starter_spec.loader is not None
    starter = importlib.util.module_from_spec(starter_spec)
    starter_spec.loader.exec_module(starter)

    workspace = tmp_path / "workspace"
    coc_root = workspace / ".coc"
    coc_root.mkdir(parents=True)
    (coc_root / "runtime.json").write_text(
        json.dumps(
            {
                "schema_version": 2,
                "planner": {"kind": "deterministic"},
                "rules": {"kind": "deterministic"},
                "narrator": {"kind": "template"},
                "player": {"kind": "human"},
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    campaign_id = "mcp-hotset-direct"
    quick = starter.quick_start(
        coc_root,
        "the-haunting",
        "thomas-hayes",
        campaign_id=campaign_id,
        title="MCP Hotset Direct",
    )
    roll_arguments = {
        "root": os.fspath(workspace),
        "campaign": campaign_id,
        "investigator": quick["investigator_id"],
        "skill": "Library Use",
        "difficulty": "regular",
        "goal": "settle a focused progressive-discovery hotset check",
        "stakes": {
            "on_success": "the focused check succeeds",
            "on_failure": "the focused check does not succeed",
        },
        "difficulty_basis": "keeper_judgment",
        "seed": 11,
        "decision_id": "mcp-progressive-hotset-roll-1",
    }
    advised = server._call_tool("rules_roll", roll_arguments)
    assert advised["ok"] is True
    assert advised["context_rehydration"]["hard_gate"] is False
    assert advised["context_rehydration"]["next_operation"] == "session.resume"

    host_context = server.toolbox.coc_host_context
    session_a = "grok-mcp-bound-session-a"
    session_b = "grok-mcp-other-session-b"
    marker_a = host_context.mark_lifecycle(
        workspace,
        session_id=session_a,
        host="grok",
        event="session_start",
        source="test-a",
    )
    host_context.mark_lifecycle(
        workspace,
        session_id=session_b,
        host="grok",
        event="session_start",
        source="test-b",
    )

    resumed = server._call_tool(
        "session_resume",
        {
            "root": os.fspath(workspace),
            "campaign": campaign_id,
            "investigator": quick["investigator_id"],
            "host_session_id": session_a,
            "context_epoch": marker_a["context_epoch"],
        },
    )
    assert resumed["ok"] is True, resumed

    # Updating another active Grok window must not steal this MCP process's
    # marker or make it acknowledge/read that window's prompt.
    host_context.mark_lifecycle(
        workspace,
        session_id=session_b,
        host="grok",
        event="pre_compact",
        source="test-b-newer",
    )
    context = server._call_tool(
        "scene_context",
        {"root": os.fspath(workspace), "campaign": campaign_id},
    )
    assert context["ok"] is True, context
    assert "context_rehydration" not in context
    assert host_context.pending_marker(
        workspace, session_id=session_a
    ) is None
    assert host_context.pending_marker(
        workspace, session_id=session_b
    ) is not None

    rolled = server._call_tool(
        "rules_roll",
        roll_arguments,
    )
    assert rolled["ok"] is True, rolled
    assert rolled["tool"] == "rules.roll"
