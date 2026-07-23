import importlib.util
import hashlib
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


def _load_grok_focused_config_module():
    name = "test_coc_grok_focused_config"
    if name in sys.modules:
        return sys.modules[name]
    path = PLUGIN_ROOT / "scripts" / "coc_grok_focused_config.py"
    spec = importlib.util.spec_from_file_location(name, path)
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


def _custom_setup_investigator_sheet(investigator_id: str) -> dict:
    return {
        "schema_version": 1,
        "id": investigator_id,
        "name": "MCP Custom Investigator",
        "characteristics": {
            "STR": 50,
            "CON": 50,
            "SIZ": 50,
            "DEX": 50,
            "APP": 50,
            "INT": 50,
            "POW": 50,
            "EDU": 50,
        },
        "derived": {
            "HP": 10,
            "SAN": 50,
            "MP": 10,
            "Luck": 60,
            "DB": "none",
            "Build": 0,
            "MOV": 8,
        },
        "skills": {"Credit Rating": 20},
        "player_facing_sheet_zh": {
            "display_name": "MCP 自定义调查员",
            "era": "1920s",
            "nationality": "中国",
            "occupation": "记者",
            "characteristics": {
                "力量": {"key": "STR", "value": 50},
                "教育": {"key": "EDU", "value": 50},
            },
            "derived": {"生命值": 10, "理智": 50},
            "skills": [],
            "backstory_summary": "一名愿意追查异常事件的记者。",
        },
    }


def _custom_setup_source_bundle(tmp_path: Path) -> Path:
    pdf = tmp_path / "custom-setup-module.pdf"
    pdf.write_bytes(b"%PDF host-owned MCP setup fixture")
    bundle = tmp_path / "custom-setup-source"
    bundle.mkdir()
    markdown = b"# Custom MCP Module\n\nAccepted host source page.\n"
    (bundle / "page-0000.md").write_bytes(markdown)
    (bundle / "manifest.json").write_text(json.dumps({
        "schema_version": 1,
        "producer": "codex-pdf-skill",
        "source": {
            "source_id": "pdf:custom-mcp-module",
            "title": "Custom MCP Module",
            "path": os.fspath(pdf),
            "file_sha256": hashlib.sha256(pdf.read_bytes()).hexdigest(),
            "page_count": 1,
        },
        "pages": [{
            "pdf_index": 0,
            "markdown_path": "page-0000.md",
            "text_sha256": hashlib.sha256(markdown).hexdigest(),
            "review_state": "manual_accepted",
            "parse_confidence": 0.99,
            "grep_anchors": ["Accepted host source page."],
        }],
    }), encoding="utf-8")
    return bundle


def _mcp_opening_workspace(
    tmp_path: Path,
    *,
    start_count: int = 1,
    long_titles: bool = False,
    candidate_ids: list[str] | None = None,
    extra_pdf_indices: tuple[int, ...] = (),
    location_pdf_span: tuple[int, int] = (0, 0),
    publish_skeleton: bool = True,
) -> dict:
    server = _load_server()
    workspace = tmp_path / "mcp-opening-workspace"
    campaign_id = "mcp-opening"
    server.toolbox.coc_state.create_campaign(
        workspace,
        campaign_id,
        "MCP Opening",
        play_language="zh-Hans",
    )
    pdf = workspace / "opening.pdf"
    pdf.parent.mkdir(parents=True, exist_ok=True)
    pdf.write_bytes(b"%PDF raw MCP opening fixture")
    file_sha = hashlib.sha256(pdf.read_bytes()).hexdigest()
    bundle = workspace / "opening-source"
    bundle.mkdir()
    page_indices = [0, *extra_pdf_indices]
    pages = []
    for pdf_index in page_indices:
        page_bytes = (
            b"# Opening\n\nAccepted raw MCP opening page.\n"
            if pdf_index == 0
            else f"# Extra {pdf_index}\n\nAccepted raw MCP extra page.\n".encode()
        )
        markdown_path = f"page-{pdf_index:04d}.md"
        (bundle / markdown_path).write_bytes(page_bytes)
        pages.append({
            "pdf_index": pdf_index,
            "markdown_path": markdown_path,
            "text_sha256": hashlib.sha256(page_bytes).hexdigest(),
            "review_state": "manual_accepted",
            "parse_confidence": 0.99,
            "grep_anchors": [
                "Accepted raw MCP opening page."
                if pdf_index == 0 else "Accepted raw MCP extra page."
            ],
        })
    (bundle / "manifest.json").write_text(json.dumps({
        "schema_version": 1,
        "producer": "codex-pdf-skill",
        "source": {
            "source_id": "pdf:mcp-opening",
            "title": "MCP Opening",
            "path": os.fspath(pdf),
            "file_sha256": file_sha,
            "page_count": max(page_indices) + 1,
        },
        "pages": pages,
    }), encoding="utf-8")
    assets = server.toolbox.coc_module_project.coc_module_assets
    registration = assets.register_source_bundle(
        workspace,
        bundle,
        asset_root_id="mcp-opening",
        module_identity={"canonical_module_id": "mcp-opening"},
    )
    identity_path = (
        workspace / ".coc" / "module-assets" / "mcp-opening"
        / "identity.json"
    )
    identity = json.loads(identity_path.read_text(encoding="utf-8"))
    campaign_dir = workspace / ".coc" / "campaigns" / campaign_id
    scenario_path = campaign_dir / "scenario" / "scenario.json"
    scenario = (
        json.loads(scenario_path.read_text(encoding="utf-8"))
        if scenario_path.is_file()
        else {"schema_version": 1}
    )
    scenario.update({
        "source_cache_asset_root_id": "mcp-opening",
        "source": {
            **identity["source"],
            "bundle_sha256": registration["bundle_sha256"],
        },
    })
    scenario_path.parent.mkdir(parents=True, exist_ok=True)
    scenario_path.write_text(
        json.dumps(scenario, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    start_ids = list(candidate_ids) if candidate_ids is not None else [
        f"start-{index:03d}" for index in range(start_count)
    ]
    locations = [
        {
            "location_id": start_id,
            "title": (
                f"{index:03d}-" + ("长标题" * 80)
                if long_titles
                else f"Start {index:03d}"
            ),
            "parse_state": "toc_only",
            "source_span": {
                "pdf_index_start": location_pdf_span[0],
                "pdf_index_end": location_pdf_span[1],
            },
        }
        for index, start_id in enumerate(start_ids)
    ]
    skeleton = {
        "schema_version": 1,
        "parse_tier": 1,
        "module_identity": {
            "canonical_module_id": "mcp-opening",
            "canonical_title": "MCP Opening",
        },
        "structure_type": "branching_investigation",
        "source": identity["source"],
        "start_candidates": start_ids,
        "finale_buckets": [{
            "id": "end", "title": "End", "importance": "critical",
        }],
        "locations": locations,
        "edges_provisional": [],
        "npc_roster": [],
        "handouts": [],
        "threats": [],
        "conclusion_buckets": [],
        "mechanics_locator_pass_status": "pending",
        "start_clock_status": "unresolved",
    }
    if publish_skeleton:
        published = server._call_tool("coc_invoke", {
            "operation": "progressive.publish_skeleton",
            "root": os.fspath(workspace),
            "campaign": campaign_id,
            "arguments": {
                "asset_root_id": "mcp-opening",
                "source_file_sha256": file_sha,
                "skeleton": skeleton,
            },
        })
        assert published["ok"] is True, published
    return {
        "server": server,
        "workspace": workspace,
        "campaign_id": campaign_id,
        "asset_root_id": "mcp-opening",
        "file_sha256": file_sha,
        "source": identity["source"],
        "start_ids": start_ids,
    }


def test_plugin_launcher_handshakes_from_arbitrary_campaign_without_runtime_import(
    tmp_path,
):
    env = os.environ.copy()
    for name in (
        "COC_PROJECT_ROOT",
        "COC_RUNTIME_ROOT",
        "GROK_WORKSPACE_ROOT",
        "CLAUDE_PROJECT_DIR",
    ):
        env.pop(name, None)
    env["COC_HOST"] = "grok"
    # Reproduce a managed plugin opened from an ordinary campaign directory:
    # there is no sibling repository runtime to import at MCP process startup.
    env["COC_RUNTIME_ROOT"] = os.fspath(tmp_path / "missing-runtime")
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
        cwd=tmp_path,
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


def test_plugin_launcher_rejects_cold_bind_without_runtime_before_mutation_and_stays_alive(
    tmp_path,
):
    bundle = _custom_setup_source_bundle(tmp_path)
    env = os.environ.copy()
    for name in (
        "COC_PROJECT_ROOT",
        "COC_RUNTIME_ROOT",
        "GROK_WORKSPACE_ROOT",
        "CLAUDE_PROJECT_DIR",
    ):
        env.pop(name, None)
    env["COC_HOST"] = "grok"
    env["COC_RUNTIME_ROOT"] = os.fspath(tmp_path / "missing-runtime")

    def invoke(request_id: int, operation: str, arguments: dict) -> dict:
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "method": "tools/call",
            "params": {
                "name": "coc_invoke",
                "arguments": {
                    "operation": operation,
                    "root": os.fspath(tmp_path),
                    "arguments": arguments,
                },
            },
        }

    messages = [
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {"protocolVersion": "2024-11-05"},
        },
        invoke(2, "setup.invoke", {
            "kind": "campaign.create",
            "payload": {
                "campaign_id": "cold-bind-rejected",
                "title": "Cold Bind Rejected",
            },
        }),
        invoke(3, "setup.invoke", {
            "kind": "scenario.bind_pdf",
            "payload": {
                "campaign_id": "cold-bind-rejected",
                "scenario_id": "cold-module-rejected",
                "title": "Cold Module Rejected",
                "source_bundle_path": os.fspath(bundle),
                "compile_now": True,
            },
        }),
        {
            "jsonrpc": "2.0",
            "id": 4,
            "method": "tools/call",
            "params": {"name": "coc_capabilities", "arguments": {}},
        },
        invoke(5, "setup.invoke", {
            "kind": "campaign.create",
            "payload": {
                "campaign_id": "progressive-bind",
                "title": "Progressive Bind",
            },
        }),
        invoke(6, "setup.invoke", {
            "kind": "scenario.bind_pdf",
            "payload": {
                "campaign_id": "progressive-bind",
                "scenario_id": "progressive-module",
                "title": "Progressive Module",
                "source_bundle_path": os.fspath(bundle),
                "compile_now": False,
            },
        }),
    ]
    completed = subprocess.run(
        [os.fspath(PLUGIN_ROOT / "mcp" / "launch")],
        cwd=tmp_path,
        env=env,
        input="\n".join(json.dumps(message) for message in messages) + "\n",
        text=True,
        capture_output=True,
        check=False,
        timeout=30,
    )
    assert completed.returncode == 0, completed.stderr
    responses = [json.loads(line) for line in completed.stdout.splitlines()]
    assert [response["id"] for response in responses] == [1, 2, 3, 4, 5, 6]

    rejected = responses[2]["result"]["structuredContent"]
    assert rejected["ok"] is False
    assert rejected["error"]["code"] == "setup_failed"
    assert "compile_now=true requires" in rejected["error"]["message"]
    capabilities = responses[3]["result"]["structuredContent"]
    assert capabilities["ok"] is True
    assert capabilities["data"]["capabilities"]["plugin_mcp"] is True

    rejected_campaign = (
        tmp_path / ".coc" / "campaigns" / "cold-bind-rejected"
    )
    rejected_metadata = json.loads(
        (rejected_campaign / "campaign.json").read_text(encoding="utf-8")
    )
    assert rejected_metadata.get("active_scenario_id") is None
    assert not (rejected_campaign / "scenario" / "scenario.json").exists()
    assert not (
        tmp_path / ".coc" / "module-assets" / "cold-module-rejected"
    ).exists()

    progressive = responses[5]["result"]["structuredContent"]
    assert progressive["ok"] is True, progressive
    assert progressive["data"]["result"]["scenario_id"] == "progressive-module"
    assert (
        tmp_path / ".coc" / "campaigns" / "progressive-bind"
        / "scenario" / "scenario.json"
    ).is_file()
    assert (
        tmp_path / ".coc" / "module-assets" / "progressive-module"
    ).is_dir()


def test_grok_mcp_uses_canonical_launcher_and_capabilities(monkeypatch):
    config = json.loads((PLUGIN_ROOT / ".mcp.json").read_text(encoding="utf-8"))
    entry = config["mcpServers"]["coc-keeper"]
    assert entry["command"].endswith("/mcp/launch")
    source_entry = config["mcpServers"]["coc-source-submit"]
    assert source_entry["command"] == entry["command"]
    assert source_entry["env"] == {
        "COC_HOST": "grok", "COC_MCP_PROFILE": "source-submit",
    }
    assert (PLUGIN_ROOT / "mcp" / "launch").is_file()

    server = _load_server()
    monkeypatch.setenv("COC_HOST", "grok")
    envelope = server._call_tool("coc_capabilities", {})
    assert envelope["ok"] is True
    assert envelope["data"]["host"] == "grok"
    assert envelope["data"]["capabilities"]["plugin_mcp"] is True
    assert envelope["data"]["mcp_wire"]["tool_surface"] == "gateway_only_v1"
    assert envelope["data"]["mcp_wire"]["gateway_tools"] == [
        "coc_capabilities", "coc_discover", "coc_invoke",
    ]
    assert envelope["data"]["mcp_wire"]["transport_contract"] == {
        "root": (
            "pass the current host workspace absolute path on every "
            "coc_invoke call"
        ),
        "campaign": (
            "pass the active campaign id on every campaign-bound "
            "coc_invoke call"
        ),
    }
    cold_start = envelope["data"]["cold_start"]
    inspect_card = cold_start["empty_or_unknown_workspace"]
    assert {
        key: value
        for key, value in inspect_card.items()
        if key != "arguments_schema"
    } == {
        "operation": "setup.inspect",
        "invoke_via": "coc_invoke",
        "prefilled_arguments": {},
        "missing_arguments": [],
        "optional_arguments": [],
        "contract_ref": inspect_card["contract_ref"],
        "discovery_required": False,
    }
    assert set(inspect_card["arguments_schema"]["properties"]) == set()
    assert cold_start["built_in_quick_start"]["missing_arguments"] == [
        "scenario_id", "pregen_id",
    ]
    assert cold_start["built_in_quick_start"]["discovery_required"] is False
    custom_setup = cold_start["custom_campaign_setup"]
    assert custom_setup["operation"] == "setup.invoke"
    assert custom_setup["missing_arguments"] == ["kind", "payload"]
    assert custom_setup["discovery_required"] is False
    custom_schema = custom_setup["arguments_schema"]
    assert custom_schema["required"] == ["kind", "payload"]
    assert custom_schema["properties"]["kind"]["enum"] == [
        "campaign.create",
        "actor.create",
        "investigator.create",
        "campaign.link_investigator",
        "scenario.bind_pdf",
        "campaign.render_briefing",
        "investigator.render_card",
    ]
    payload_schema = custom_schema["properties"]["payload"]
    assert payload_schema["additionalProperties"] is False
    assert payload_schema["properties"]["language"] == {"type": "string"}
    assert payload_schema["properties"]["html_mode"]["enum"] == [
        "never", "auto", "always",
    ]

    monkeypatch.setenv("COC_HOST", "codex")
    codex = server._call_tool("coc_capabilities", {})["data"]
    opening = codex["cold_start"]["opening_source_coordinator"]
    assert opening["copy_task_static_verbatim"] is True
    assert opening["task_variable_fields"] == [
        "workspace_root",
        "pdf_path",
        "pdf_sha256",
        "campaign_id",
        "scenario_id",
        "title",
        "era",
        "play_language",
        "source_bundle_id",
        "source_bundle_path",
        "opening_locator_pdf_indices",
    ]
    assert opening["pdf_identity_before_dispatch"] == {
        "required": True,
        "fields": ["pdf_path", "pdf_sha256"],
        "page_or_title_read_by_main_keeper": False,
    }
    static = opening["task_static"]
    assert static["instruction_ref"] == os.fspath(
        PLUGIN_ROOT / "agents" / "coc-opening-source-coordinator.md"
    )
    assert static["contract_ref"] == os.fspath(
        PLUGIN_ROOT / "references" / "opening-source-coordinator-v1.json"
    )
    assert set(static["instruction_refs"]) == {"pdf_skill"}
    assert all(
        Path(path).is_absolute()
        for path in (
            static["instruction_ref"],
            static["contract_ref"],
            *static["instruction_refs"].values(),
        )
    )
    monkeypatch.setenv("COC_HOST", "grok")

    listed = server._handle({"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    tool_names = [tool["name"] for tool in listed["result"]["tools"]]
    assert tool_names == ["coc_capabilities", "coc_discover", "coc_invoke"]
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


def test_source_submit_mcp_profile_exposes_only_lease_bound_submit(
    monkeypatch, tmp_path,
):
    server = _load_server()
    monkeypatch.setenv("COC_HOST", "grok")
    monkeypatch.setenv("COC_MCP_PROFILE", "source-submit")
    monkeypatch.setenv("COC_PROJECT_ROOT", os.fspath(tmp_path))

    tools = server._listed_tools()
    assert [tool["name"] for tool in tools] == ["submit_source_result"]
    schema = tools[0]["inputSchema"]
    assert schema["additionalProperties"] is False
    assert set(schema["required"]) == {
        "schema_version", "contract_id", "packet_id", "work_group_id",
        "status", "results",
    }
    item = schema["properties"]["results"]["items"]
    assert item["additionalProperties"] is False
    assert item["required"] == ["job_id", "pack", "related_packs"]

    initialized = server._handle({
        "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {},
    })
    assert initialized["result"]["serverInfo"]["name"] == "coc-source-submit"
    for forbidden in (
        "coc_invoke", "coc_capabilities", "progressive.fulfill_host_work",
    ):
        rejected = server._call_tool(forbidden, {})
        assert rejected["ok"] is False
        assert rejected["error"]["code"] == "unknown_tool"

    payload = {
        "schema_version": 1,
        "contract_id": "coc.source-pack-worker.v1",
        "packet_id": "packet-1",
        "work_group_id": "group-1",
        "status": "abstain",
        "results": [],
    }
    expected = {
        "schema_version": 1,
        "contract_id": "coc.source-submit-receipt.v1",
        "packet_id": "packet-1",
        "ok": False,
        "error": {"code": "source_result_not_usable", "message": "abstain"},
    }
    monkeypatch.setattr(
        server.toolbox, "submit_source_worker_result",
        lambda root, arguments: expected,
    )
    envelope = server._call_tool("submit_source_result", payload)
    assert envelope["data"] == expected
    assert envelope["error"] == expected["error"]


def test_grok_workspace_root_precedes_process_cwd(monkeypatch, tmp_path):
    server = _load_server()
    monkeypatch.delenv("COC_PROJECT_ROOT", raising=False)
    monkeypatch.setenv("GROK_WORKSPACE_ROOT", os.fspath(tmp_path))
    monkeypatch.chdir(ROOT)
    assert server._default_root() == tmp_path.resolve()


def test_grok_focused_config_disables_discovered_external_mcps():
    config = _load_grok_focused_config_module()
    template = (
        PLUGIN_ROOT / "references" / "grok-focused-config.toml"
    ).read_text(encoding="utf-8")
    inventory = {
        "plugins": [
            {
                "name": "github", "enabled": True, "scope": "user",
                "path": "/compat/plugins/github",
            },
            {
                "name": "coc-keeper", "enabled": True, "scope": "user",
                "path": "/focused/coc-keeper",
            },
            {
                "name": "chrome-devtools-mcp", "enabled": True,
                "scope": "user", "path": "/compat/plugins/chrome",
            },
            {
                "name": "github", "enabled": True, "scope": "user",
                "path": "/compat/plugins/github",
            },
        ],
        "mcpServers": [
            {"name": "coc-keeper"},
            {"name": "coc-source-submit"},
            {"name": "github"},
        ],
    }
    rendered = config.render_config(template, inventory)
    assert '[mcp_servers."github"]\nenabled = false' in rendered
    assert "chrome-devtools-mcp" not in rendered
    assert "enabled = [\"coc-keeper\"]" in rendered
    assert config.isolation_violations(inventory) == {
        "enabled_non_coc_mcps": ["github"],
        "enabled_external_skills": [],
    }


def test_grok_focused_config_catches_plugin_mcp_hidden_by_compat_projection():
    config = _load_grok_focused_config_module()
    template = (
        PLUGIN_ROOT / "references" / "grok-focused-config.toml"
    ).read_text(encoding="utf-8")
    inventory = {
        "plugins": [
            {
                "name": "github",
                "enabled": True,
                "provides": {"mcpServers": 1},
            },
            {
                "name": "coc-keeper",
                "enabled": True,
                "provides": {"mcpServers": 1},
            },
        ],
        "mcpServers": [
            {"name": "github", "disabled": True},
            {"name": "coc-keeper"},
            {"name": "coc-source-submit"},
        ],
    }

    rendered = config.render_config(template, inventory)

    assert '[mcp_servers."github"]\nenabled = false' in rendered
    assert config.isolation_violations(inventory) == {
        "enabled_non_coc_mcps": [],
        "enabled_external_skills": [],
    }
    isolated = {
        "plugins": [
            {
                "name": "github", "enabled": False,
                "path": "/compat/plugins/github",
            },
            {
                "name": "coc-keeper", "enabled": True,
                "path": "/focused/coc-keeper",
            },
        ],
        "mcpServers": [
            {"name": "github", "disabled": True},
            {"name": "coc-keeper"},
            {"name": "coc-source-submit"},
        ],
    }
    assert config.isolation_violations(isolated) == {
        "enabled_non_coc_mcps": [],
        "enabled_external_skills": [],
    }


def test_grok_focused_requirements_disable_only_external_skills():
    config = _load_grok_focused_config_module()
    template = (
        PLUGIN_ROOT / "references" / "grok-focused-requirements.toml"
    ).read_text(encoding="utf-8")
    inventory = {
        "skills": [
            {
                "name": "coc-sanity",
                "source": {
                    "type": "plugin", "plugin_name": "coc-keeper",
                },
            },
            {"name": "imagine", "source": {"type": "bundled"}},
            {"name": "review", "source": {"type": "bundled"}},
            {"name": "foreign-skill", "source": {"type": "user"}},
        ],
        "mcpServers": [
            {"name": "coc-keeper"}, {"name": "coc-source-submit"},
        ],
    }

    rendered = config.render_requirements(template, inventory)

    assert 'disabled = ["foreign-skill", "review"]' in rendered
    assert "coc-sanity" not in rendered
    assert '"imagine"' not in rendered
    assert config.isolation_violations(inventory) == {
        "enabled_non_coc_mcps": [],
        "enabled_external_skills": ["foreign-skill", "review"],
    }


def test_grok_focused_source_worker_must_resolve_as_exact_user_projection(
    tmp_path,
):
    config = _load_grok_focused_config_module()
    expected = tmp_path / "agents" / "coc-source-pack-worker.md"
    inventory = {
        "agents": [
            {
                "name": "coc-keeper:coc-source-pack-worker",
                "source": {
                    "type": "plugin",
                    "plugin_name": "coc-keeper",
                    "path": "/installed/agents/coc-source-pack-worker.md",
                },
            },
            {
                "name": "coc-source-pack-worker",
                "source": {"type": "user", "path": str(expected)},
            },
        ],
        "mcpServers": [
            {"name": "coc-keeper"}, {"name": "coc-source-submit"},
        ],
    }

    assert config.isolation_violations(
        inventory, required_source_agent=expected,
    ) == {
        "enabled_non_coc_mcps": [],
        "enabled_external_skills": [],
        "source_worker_agent": [],
    }

    inventory["agents"] = [inventory["agents"][0]]
    assert config.isolation_violations(
        inventory, required_source_agent=expected,
    )["source_worker_agent"] == ["expected_one_user_agent:found_0"]

    inventory["agents"] = [{
        "name": "coc-source-pack-worker",
        "source": {
            "type": "plugin",
            "path": "/installed/agents/coc-source-pack-worker.md",
        },
    }]
    assert config.isolation_violations(
        inventory, required_source_agent=expected,
    )["source_worker_agent"] == [
        "source_worker_agent_is_not_user_scoped",
    ]


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

    fulfill_schema = on_disk["operations"][
        "progressive.fulfill_host_work"
    ]["inputSchema"]
    worker_result = fulfill_schema["properties"]["worker_result"]
    assert worker_result["additionalProperties"] is False
    assert worker_result["required"] == [
        "job_id", "pack", "related_packs",
    ]
    assert set(worker_result["properties"]) == {
        "job_id", "pack", "related_packs",
    }
    # JSON Schema cannot express the runtime's exclusive preferred/legacy
    # alternatives in this compact registry; the handler enforces the choice.
    assert fulfill_schema["required"] == ["campaign"]

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


def test_investigator_contract_discovery_exposes_only_campaign_identity(tmp_path):
    server = _load_server()
    discovered = server._call_tool(
        "coc_discover",
        {"operation": "setup.investigator_contract"},
    )["data"]

    full_schema = discovered["operation"]["inputSchema"]
    assert set(full_schema["properties"]) == {
        "root",
        "campaign",
        "campaign_id",
    }
    assert full_schema["required"] == ["campaign_id"]
    assert "sheet" not in full_schema["properties"]
    assert "creation" not in full_schema["properties"]

    invoke_card = discovered["invoke_card"]
    assert invoke_card["operation"] == "setup.investigator_contract"
    assert invoke_card["missing_arguments"] == ["campaign_id"]
    assert invoke_card["arguments_schema"]["required"] == ["campaign_id"]
    assert set(invoke_card["arguments_schema"]["properties"]) == {"campaign_id"}

    created = server._call_tool(
        "coc_invoke",
        {
            "operation": "setup.invoke",
            "root": os.fspath(tmp_path),
            "arguments": {
                "kind": "campaign.create",
                "payload": {
                    "campaign_id": "contract-discovery",
                    "title": "Contract Discovery",
                },
            },
        },
    )
    assert created["ok"] is True, created
    queried = server._call_tool(
        "coc_invoke",
        {
            "operation": "setup.investigator_contract",
            "root": os.fspath(tmp_path),
            "arguments": {"campaign_id": "contract-discovery"},
        },
    )
    assert queried["ok"] is True, queried
    assert queried["data"]["result"]["ruleset_id"] == "coc7"
    assert queried["data"]["result"]["payload_schema"]["oneOf"]


def test_opening_selector_and_page_schemas_match_every_mcp_projection():
    archive_mod = _load_archive_module()
    server = _load_server()
    on_disk = archive_mod.load_and_validate(ARCHIVE_PATH, server.toolbox)
    rebuilt = archive_mod.build_archive(server.toolbox)
    safe_id_pattern = r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"

    expected_start = {
        "progressive.prepare_opening": {
            "type": ["string", "null"],
            "maxLength": 128,
            "pattern": safe_id_pattern,
        },
        "progressive.request_opening_pack": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "pattern": safe_id_pattern,
        },
        "progressive.project_opening": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "pattern": safe_id_pattern,
        },
    }
    expected_pages = {
        "type": "array",
        "minItems": 1,
        "maxItems": 3,
        "uniqueItems": True,
        "items": {"type": "integer", "minimum": 0},
    }

    for operation in expected_start:
        registered = archive_mod.input_schema_for_spec(
            server.toolbox.TOOLS[operation]
        )
        discovered = server._call_tool(
            "coc_discover", {"operation": operation}
        )["data"]
        full_schemas = [
            registered,
            rebuilt["operations"][operation]["inputSchema"],
            on_disk["operations"][operation]["inputSchema"],
            server.CONTRACTS["operations"][operation]["inputSchema"],
            discovered["operation"]["inputSchema"],
        ]
        invoke_schemas = [
            server.INVOKE_ARGUMENT_SCHEMAS[operation],
            discovered["invoke_card"]["arguments_schema"],
        ]
        for schema in [*full_schemas, *invoke_schemas]:
            actual_start = schema["properties"]["start_location_id"]
            for key, value in expected_start[operation].items():
                assert actual_start[key] == value
            if operation == "progressive.prepare_opening":
                assert "start_location_id" not in schema.get("required", [])
            else:
                assert "start_location_id" in schema["required"]

            actual_pages = schema["properties"]["opening_pdf_indices"]
            for key, value in expected_pages.items():
                assert actual_pages[key] == value
            assert (
                "opening_pdf_indices" in schema.get("required", [])
            ) is (operation == "progressive.request_opening_pack")


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


def test_grok_tools_list_is_gateway_only_under_4kib(monkeypatch):
    server = _load_server()
    monkeypatch.setenv("COC_HOST", "grok")
    listed = server._handle({"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    tools = listed["result"]["tools"]
    names = [tool["name"] for tool in tools]

    assert names == ["coc_capabilities", "coc_discover", "coc_invoke"]
    assert "state.record_npc_engagement" in server.MCP_LISTED_HOTSET
    assert "state.move_scene" not in server.MCP_LISTED_HOTSET
    assert "rules.skill_describe" not in names

    byte_size = _canonical_tools_list_bytes(tools)
    assert byte_size < 4 * 1024, (
        f"tools/list canonical JSON is {byte_size} bytes; "
        "gateway-only budget is 4096 bytes"
    )


def test_static_tool_hosts_retain_direct_hotset(monkeypatch):
    server = _load_server()
    monkeypatch.setenv("COC_HOST", "codex")

    listed = server._handle({"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    names = [tool["name"] for tool in listed["result"]["tools"]]

    assert names[:3] == ["coc_capabilities", "coc_discover", "coc_invoke"]
    assert names[3:] == list(server.MCP_LISTED_HOTSET)


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
    invoke_card = data["invoke_card"]
    assert invoke_card["operation"] == "rules.skill_describe"
    assert invoke_card["invoke_via"] == "coc_invoke"
    assert invoke_card["discovery_required"] is False
    assert "root" not in invoke_card["arguments_schema"]["properties"]
    assert "campaign" not in invoke_card["arguments_schema"]["properties"]
    assert invoke_card["missing_arguments"] == invoke_card[
        "arguments_schema"
    ].get("required", [])

    advance_time = server._call_tool(
        "coc_discover", {"operation": "state.advance_time"}
    )["data"]["invoke_card"]
    assert set(advance_time["arguments_schema"]["properties"]) == {
        "minutes",
        "reason",
        "decision_id",
        "day_phase_after",
        "display_after",
    }
    assert advance_time["missing_arguments"] == [
        "minutes", "reason", "decision_id",
    ]

    opening = server._call_tool(
        "coc_discover", {"operation": "progressive.prepare_opening"}
    )["data"]
    assert opening["canonical_operation"] == "progressive.prepare_opening"
    opening_schema = opening["operation"]["inputSchema"]
    assert opening_schema["additionalProperties"] is False
    assert opening_schema["properties"]["opening_pdf_indices"]["maxItems"] == 3
    assert opening_schema["properties"]["opening_pdf_indices"]["uniqueItems"] is True
    assert opening["invoke_card"]["operation"] == "progressive.prepare_opening"
    assert opening["invoke_card"]["invoke_via"] == "coc_invoke"
    assert opening["invoke_card"]["missing_arguments"] == []

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

    inspected = server._call_tool(
        "coc_invoke",
        {
            "operation": "setup.inspect",
            "root": os.fspath(tmp_path),
            "arguments": {},
        },
    )
    assert inspected["ok"] is True, inspected
    assert inspected["data"]["kind"] == "onboarding.inspect"

    started = server._call_tool(
        "coc_invoke",
        {
            "operation": "setup.quick_start",
            "root": os.fspath(tmp_path),
            "arguments": {
                "scenario_id": "the-haunting",
                "pregen_id": "thomas-hayes",
                "campaign_id": "mcp-typed-setup",
            },
        },
    )
    assert started["ok"] is True, started
    assert started["data"]["result"]["campaign_id"] == "mcp-typed-setup"
    discovered_setup = server._call_tool(
        "coc_discover", {"operation": "setup.quick_start"}
    )
    schema = discovered_setup["data"]["operation"]["inputSchema"]
    assert schema["required"] == ["scenario_id", "pregen_id"]
    assert "play_language" not in schema["properties"]

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


def test_coc_invoke_never_uses_plugin_storage_as_campaign_root(monkeypatch):
    server = _load_server()
    monkeypatch.setenv("COC_HOST", "codex")
    monkeypatch.setattr(server, "_default_root", lambda: server.PLUGIN_ROOT)

    implicit = server._call_tool(
        "coc_invoke",
        {
            "operation": "setup.inspect",
            "arguments": {},
        },
    )
    assert implicit["ok"] is False
    assert implicit["error"]["code"] == "workspace_root_required"
    assert not (server.PLUGIN_ROOT / ".coc").is_dir()

    explicit = server._call_tool(
        "coc_invoke",
        {
            "operation": "setup.inspect",
            "root": os.fspath(server.PLUGIN_ROOT),
            "arguments": {},
        },
    )
    assert explicit["ok"] is False
    assert explicit["error"]["code"] == "workspace_root_required"


def test_coc_invoke_runs_existing_custom_setup_gateway(monkeypatch, tmp_path):
    server = _load_server()
    monkeypatch.setenv("COC_HOST", "grok")
    monkeypatch.setattr(server, "_PROCESS_ACTIVE_CAMPAIGN", None)

    inspected = server._call_tool("coc_invoke", {
        "operation": "setup.inspect",
        "root": os.fspath(tmp_path),
        "arguments": {},
    })
    assert inspected["ok"] is True, inspected
    setup_card = inspected["data"]["result"]["custom_campaign_setup"]
    assert setup_card["operation"] == "setup.invoke"
    assert setup_card["missing_arguments"] == ["kind", "payload"]
    assert setup_card["arguments_schema"]["required"] == ["kind", "payload"]

    def invoke(kind: str, payload: dict) -> dict:
        return server._call_tool("coc_invoke", {
            "operation": "setup.invoke",
            "root": os.fspath(tmp_path),
            "arguments": {"kind": kind, "payload": payload},
        })

    campaign = invoke("campaign.create", {
        "campaign_id": "mcp-custom",
        "title": "MCP Custom Campaign",
        "era": "1920s",
        "play_language": "zh-Hans",
    })
    assert campaign["ok"] is True, campaign
    assert campaign["data"]["result"]["campaign_id"] == "mcp-custom"

    investigator = invoke("investigator.create", {
        "investigator_id": "mcp-custom-investigator",
        "sheet": _custom_setup_investigator_sheet("mcp-custom-investigator"),
    })
    assert investigator["ok"] is True, investigator
    assert investigator["data"]["result"]["investigator_id"] == (
        "mcp-custom-investigator"
    )

    linked = invoke("campaign.link_investigator", {
        "campaign_id": "mcp-custom",
        "investigator_ids": ["mcp-custom-investigator"],
    })
    assert linked["ok"] is True, linked
    assert linked["data"]["result"]["investigator_ids"] == [
        "mcp-custom-investigator",
    ]

    bundle = _custom_setup_source_bundle(tmp_path)
    bound = invoke("scenario.bind_pdf", {
        "campaign_id": "mcp-custom",
        "scenario_id": "custom-mcp-module",
        "title": "Custom MCP Module",
        "source_bundle_path": os.fspath(bundle),
        "compile_now": False,
    })
    assert bound["ok"] is True, bound
    assert bound["data"]["result"]["scenario_id"] == "custom-mcp-module"
    briefing_path = bound["data"]["result"][
        "character_creation_briefing"
    ]["briefing_path"]
    assert bound["data"]["state_refs"][-1] == briefing_path
    assert (tmp_path / briefing_path).is_file()
    assert any(
        "result.character_creation_briefing.briefing_path" in hint
        and "do not rerender" in hint
        for hint in bound["hints"]
    )
    assert (
        tmp_path
        / ".coc"
        / "campaigns"
        / "mcp-custom"
        / "scenario"
        / "scenario.json"
    ).is_file()

    fresh_status = server._call_tool("coc_invoke", {
        "operation": "progressive.status",
        "root": os.fspath(tmp_path),
        "campaign": "mcp-custom",
        "arguments": {},
    })
    assert fresh_status["ok"] is True, fresh_status
    assert "context_rehydration" not in fresh_status

    rerendered = invoke("campaign.render_briefing", {
        "campaign_id": "mcp-custom",
        "language": "zh-Hans",
    })
    assert rerendered["ok"] is True, rerendered
    assert rerendered["data"]["result"]["briefing_path"] == briefing_path

    rendered_card = invoke("investigator.render_card", {
        "campaign_id": "mcp-custom",
        "investigator_id": "mcp-custom-investigator",
        "language": "zh-Hans",
        "html_mode": "never",
    })
    assert rendered_card["ok"] is True, rendered_card
    markdown_path = rendered_card["data"]["result"]["markdown_path"]
    assert (tmp_path / markdown_path).is_file()

    cross_kind_field = invoke("campaign.render_briefing", {
        "campaign_id": "mcp-custom",
        "html_mode": "never",
    })
    assert cross_kind_field["ok"] is False
    assert cross_kind_field["error"]["code"] == "setup_failed"

    invalid = invoke("campaign.create", {
        "campaign_id": "must-not-exist",
        "title": "Rejected",
        "unsupported": True,
    })
    assert invalid["ok"] is False
    assert invalid["error"]["code"] == "setup_failed"
    assert not (
        tmp_path / ".coc" / "campaigns" / "must-not-exist"
    ).exists()


def test_nonpass_bind_receipt_does_not_emit_receipt_first_hint(
    monkeypatch, tmp_path,
):
    server = _load_server()

    monkeypatch.setattr(
        server.toolbox.coc_runtime_ops,
        "execute_setup_operation",
        lambda *_args, **_kwargs: {
            "schema_version": 1,
            "status": "FAIL",
            "kind": "scenario.bind_pdf",
            "result": {
                "character_creation_briefing": {
                    "briefing_path": ".coc/should-not-be-consumed.md",
                },
            },
            "state_refs": [],
        },
    )
    response = server._call_tool("coc_invoke", {
        "operation": "setup.invoke",
        "root": os.fspath(tmp_path),
        "arguments": {
            "kind": "scenario.bind_pdf",
            "payload": {
                "campaign_id": "nonpass-bind",
                "scenario_id": "nonpass-scenario",
                "title": "Non-PASS Scenario",
                "source_bundle_path": os.fspath(tmp_path / "unused-bundle"),
            },
        },
    })

    assert response["ok"] is True, response
    assert response["data"]["status"] == "FAIL"
    assert all(
        "result.character_creation_briefing.briefing_path" not in hint
        for hint in response["hints"]
    )


def test_raw_mcp_prepare_opening_dynamically_bounds_100_long_starts(
    monkeypatch, tmp_path,
):
    monkeypatch.setenv("COC_HOST", "codex")
    fixture = _mcp_opening_workspace(
        tmp_path, start_count=100, long_titles=True,
    )
    server = fixture["server"]
    response = server._handle({
        "jsonrpc": "2.0",
        "id": 901,
        "method": "tools/call",
        "params": {
            "name": "coc_invoke",
            "arguments": {
                "operation": "progressive.prepare_opening",
                "root": os.fspath(fixture["workspace"]),
                "campaign": fixture["campaign_id"],
                "arguments": {"start_location_id": "start-099"},
            },
        },
    })

    raw_response_bytes = len(json.dumps(
        response, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    ).encode("utf-8"))
    envelope = response["result"]["structuredContent"]
    assert envelope["ok"] is True, envelope
    data = envelope["data"]
    exact_data_bytes = len(json.dumps(
        data, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    ).encode("utf-8"))
    assert data["encoded_data_bytes"] <= exact_data_bytes
    assert exact_data_bytes - data["encoded_data_bytes"] <= 1024
    assert exact_data_bytes <= data["encoded_data_budget_bytes"] == 12 * 1024
    assert data["start_candidate_total"] == 100
    assert data["start_candidate_returned_count"] == len(data["start_candidates"])
    assert data["start_candidate_omitted_count"] == (
        100 - data["start_candidate_returned_count"]
    )
    assert data["start_candidate_returned_count"] < 64
    assert data["start_candidates"][-1]["location_id"] == "start-099"
    assert raw_response_bytes <= 64 * 1024


def test_raw_mcp_missing_skeleton_preserves_closed_argument_contract(
    monkeypatch, tmp_path,
):
    monkeypatch.setenv("COC_HOST", "codex")
    fixture = _mcp_opening_workspace(tmp_path, publish_skeleton=False)
    server = fixture["server"]
    response = server._handle({
        "jsonrpc": "2.0",
        "id": 902,
        "method": "tools/call",
        "params": {
            "name": "coc_invoke",
            "arguments": {
                "operation": "progressive.prepare_opening",
                "root": os.fspath(fixture["workspace"]),
                "campaign": fixture["campaign_id"],
                "arguments": {},
            },
        },
    })

    envelope = response["result"]["structuredContent"]
    assert envelope["ok"] is True, envelope
    data = envelope["data"]
    exact_data_bytes = len(json.dumps(
        data, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    ).encode("utf-8"))
    assert exact_data_bytes <= data["encoded_data_budget_bytes"] == 12 * 1024
    assert data["blocking"] == [{
        "code": "opening_skeleton_missing",
        "entity_id": fixture["asset_root_id"],
    }]
    assert data["hard_work"] == []
    assert data["mutation_cards_total"] == 1
    card = data["mutation_cards"][0]
    assert card["operation"] == "progressive.publish_skeleton"
    assert card["contract_ref"].startswith("progressive.publish_skeleton@")
    contract = card["skeleton_argument_contract"]
    assert contract["closed"] is True
    assert contract["semantic_scope"] == "small_accepted_source_window_only"
    assert contract["guessing_allowed"] is False
    assert contract["full_module_scan_allowed"] is False
    template = contract["prefilled_template"]
    assert template["source"] == {
        key: fixture["source"][key]
        for key in ("source_id", "file_sha256", "page_count", "producer")
    }
    assert template["schema_version"] == 1
    assert template["parse_tier"] == 1
    assert template["mechanics_locator_pass_status"] == "pending"
    assert template["mechanics_index"] == []
    assert template["start_clock_status"] == "unresolved"
    assert set(contract["location_parse_state_enum"]) == (
        server.toolbox.coc_module_project.coc_module_assets.PARSE_STATES
    )
    assert contract["location_required_fields"] == [
        "location_id", "title", "parse_state",
    ]


def test_real_coc_invoke_rejects_non_string_opening_required_ids(
    monkeypatch, tmp_path,
):
    monkeypatch.setenv("COC_HOST", "codex")
    fixture = _mcp_opening_workspace(tmp_path)
    server = fixture["server"]

    for raw_id in (True, 7, {"id": "npc"}):
        invoked = server._call_tool("coc_invoke", {
            "operation": "progressive.prepare_opening",
            "root": os.fspath(fixture["workspace"]),
            "campaign": fixture["campaign_id"],
            "arguments": {"opening_required_npc_ids": [raw_id]},
        })
        assert invoked["ok"] is False
        assert invoked["error"]["code"] == "invalid_param"
        assert "non-empty string" in invoked["error"]["message"]


def test_real_launcher_rejects_non_string_start_selectors_for_all_opening_ops(
    tmp_path,
):
    fixture = _mcp_opening_workspace(
        tmp_path,
        candidate_ids=["7", "True"],
    )
    world_path = (
        fixture["workspace"] / ".coc" / "campaigns"
        / fixture["campaign_id"] / "save" / "world-state.json"
    )
    world = json.loads(world_path.read_text(encoding="utf-8"))
    world["active_scene_id"] = "7"
    world_path.write_text(
        json.dumps(world, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    invalid_values = [7, True, ["7"], {"id": "7"}]
    calls = [
        (10 + index, "progressive.prepare_opening", {"start_location_id": value})
        for index, value in enumerate(invalid_values)
    ]
    calls.extend([
        (20, "progressive.prepare_opening", {}),
        (21, "progressive.prepare_opening", {"start_location_id": None}),
        (22, "progressive.prepare_opening", {"start_location_id": "   "}),
    ])
    for operation, base_id in (
        ("progressive.request_opening_pack", 30),
        ("progressive.project_opening", 40),
    ):
        for index, value in enumerate(invalid_values):
            arguments = {
                "asset_root_id": fixture["asset_root_id"],
                "source_file_sha256": fixture["file_sha256"],
                "start_location_id": value,
            }
            if operation == "progressive.request_opening_pack":
                arguments.update({
                    "opening_pdf_indices": [0],
                    "request_purpose": "foreground_opening_slice",
                })
            calls.append((base_id + index, operation, arguments))
        for index, value in enumerate((None, "   "), start=4):
            arguments = {
                "asset_root_id": fixture["asset_root_id"],
                "source_file_sha256": fixture["file_sha256"],
                "start_location_id": value,
            }
            if operation == "progressive.request_opening_pack":
                arguments.update({
                    "opening_pdf_indices": [0],
                    "request_purpose": "foreground_opening_slice",
                })
            calls.append((base_id + index, operation, arguments))
    messages = [{
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {"protocolVersion": "2024-11-05"},
    }]
    for request_id, operation, arguments in calls:
        messages.append({
            "jsonrpc": "2.0",
            "id": request_id,
            "method": "tools/call",
            "params": {
                "name": "coc_invoke",
                "arguments": {
                    "operation": operation,
                    "root": os.fspath(fixture["workspace"]),
                    "campaign": fixture["campaign_id"],
                    "arguments": arguments,
                },
            },
        })
    env = os.environ.copy()
    env["COC_HOST"] = "codex"
    env["COC_DISABLE_QUEUE_WORKER"] = "1"
    completed = subprocess.run(
        [os.fspath(PLUGIN_ROOT / "mcp" / "launch")],
        cwd=tmp_path,
        env=env,
        input="".join(json.dumps(message) + "\n" for message in messages),
        text=True,
        capture_output=True,
        check=False,
        timeout=30,
    )
    assert completed.returncode == 0, completed.stderr
    responses = {
        response["id"]: response
        for response in (
            json.loads(line) for line in completed.stdout.splitlines()
        )
    }
    for request_id in (*range(10, 14), *range(30, 34), *range(40, 44)):
        envelope = responses[request_id]["result"]["structuredContent"]
        assert envelope["ok"] is False
        assert envelope["error"] == {
            "code": "invalid_param",
            "message": "start_location_id must be a string when provided",
        }
    for request_id in (34, 44):
        envelope = responses[request_id]["result"]["structuredContent"]
        assert envelope["ok"] is False
        assert envelope["error"]["code"] == "missing_param"
    for request_id in (35, 45):
        envelope = responses[request_id]["result"]["structuredContent"]
        assert envelope["ok"] is False
        assert envelope["error"]["code"] == "invalid_param"
    for request_id in (20, 21, 22):
        envelope = responses[request_id]["result"]["structuredContent"]
        assert envelope["ok"] is True, envelope
        assert envelope["data"]["selected_start_location_id"] == "7"


def test_real_launcher_rejects_wrong_page_source_opening_before_projection_write(
    tmp_path,
):
    fixture = _mcp_opening_workspace(tmp_path, extra_pdf_indices=(9,))
    assets = fixture["server"].toolbox.coc_module_project.coc_module_assets
    assets.put_entity(
        fixture["workspace"],
        fixture["asset_root_id"],
        "location",
        fixture["start_ids"][0],
        {
            "location_id": fixture["start_ids"][0],
            "title": "Wrong-page opening",
            "parse_state": "deep",
            "source_page_indices": [9],
            "player_safe_summary": "Authored elsewhere, not in the opening window.",
            "available_clue_ids": [],
            "npc_ids": [],
            "clues": [],
            "npcs": [],
            "keeper_secret_refs": [],
            "scene_edges": [],
            "affordances": [],
        },
    )
    campaign_dir = (
        fixture["workspace"] / ".coc" / "campaigns" / fixture["campaign_id"]
    )
    scenario_before = {
        path.name: path.read_bytes()
        for path in (campaign_dir / "scenario").glob("*.json")
    }
    calls = [
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {"protocolVersion": "2024-11-05"},
        },
        {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {
                "name": "coc_invoke",
                "arguments": {
                    "operation": "progressive.prepare_opening",
                    "root": os.fspath(fixture["workspace"]),
                    "campaign": fixture["campaign_id"],
                    "arguments": {},
                },
            },
        },
        {
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {
                "name": "coc_invoke",
                "arguments": {
                    "operation": "progressive.project_opening",
                    "root": os.fspath(fixture["workspace"]),
                    "campaign": fixture["campaign_id"],
                    "arguments": {
                        "asset_root_id": fixture["asset_root_id"],
                        "source_file_sha256": fixture["file_sha256"],
                        "start_location_id": fixture["start_ids"][0],
                    },
                },
            },
        },
    ]
    env = os.environ.copy()
    env["COC_HOST"] = "codex"
    env["COC_DISABLE_QUEUE_WORKER"] = "1"
    completed = subprocess.run(
        [os.fspath(PLUGIN_ROOT / "mcp" / "launch")],
        cwd=tmp_path,
        env=env,
        input="".join(json.dumps(message) + "\n" for message in calls),
        text=True,
        capture_output=True,
        check=False,
        timeout=30,
    )
    assert completed.returncode == 0, completed.stderr
    responses = {
        row["id"]: row
        for row in (json.loads(line) for line in completed.stdout.splitlines())
    }
    prepared = responses[2]["result"]["structuredContent"]
    assert prepared["ok"] is True, prepared
    assert prepared["data"]["ownership"]["player_action_gate"] is False
    assert "opening_pack_source_scope_mismatch" in {
        row["code"] for row in prepared["data"]["blocking"]
    }
    projected = responses[3]["result"]["structuredContent"]
    assert projected["ok"] is False
    assert projected["error"]["code"] == "opening_pack_source_scope_mismatch"
    assert {
        path.name: path.read_bytes()
        for path in (campaign_dir / "scenario").glob("*.json")
    } == scenario_before


def test_real_launcher_preserves_explicit_page_one_opening_scope(tmp_path):
    fixture = _mcp_opening_workspace(
        tmp_path,
        extra_pdf_indices=(1, 2),
        location_pdf_span=(0, 2),
    )
    start_id = fixture["start_ids"][0]
    assets = fixture["server"].toolbox.coc_module_project.coc_module_assets
    assets.put_entity(
        fixture["workspace"],
        fixture["asset_root_id"],
        "location",
        start_id,
        {
            "location_id": start_id,
            "title": "Page-one opening",
            "parse_state": "deep",
            "source_page_indices": [1],
            "player_safe_summary": "The authored opening is on page one.",
            "available_clue_ids": [],
            "npc_ids": [],
            "clues": [],
            "npcs": [],
            "keeper_secret_refs": [],
            "scene_edges": [],
            "affordances": [],
        },
    )
    base_arguments = {
        "asset_root_id": fixture["asset_root_id"],
        "source_file_sha256": fixture["file_sha256"],
        "start_location_id": start_id,
    }
    calls = [
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {"protocolVersion": "2024-11-05"},
        },
        {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {
                "name": "coc_invoke",
                "arguments": {
                    "operation": "progressive.prepare_opening",
                    "root": os.fspath(fixture["workspace"]),
                    "campaign": fixture["campaign_id"],
                    "arguments": {
                        "start_location_id": start_id,
                        "opening_pdf_indices": [1],
                    },
                },
            },
        },
        {
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {
                "name": "coc_invoke",
                "arguments": {
                    "operation": "progressive.request_opening_pack",
                    "root": os.fspath(fixture["workspace"]),
                    "campaign": fixture["campaign_id"],
                    "arguments": {
                        **base_arguments,
                        "opening_pdf_indices": [1],
                        "request_purpose": "foreground_opening_slice",
                    },
                },
            },
        },
        {
            "jsonrpc": "2.0",
            "id": 4,
            "method": "tools/call",
            "params": {
                "name": "coc_invoke",
                "arguments": {
                    "operation": "progressive.project_opening",
                    "root": os.fspath(fixture["workspace"]),
                    "campaign": fixture["campaign_id"],
                    "arguments": {
                        **base_arguments,
                        "opening_pdf_indices": [1],
                    },
                },
            },
        },
        {
            "jsonrpc": "2.0",
            "id": 5,
            "method": "tools/call",
            "params": {
                "name": "coc_invoke",
                "arguments": {
                    "operation": "progressive.prepare_opening",
                    "root": os.fspath(fixture["workspace"]),
                    "campaign": fixture["campaign_id"],
                    "arguments": {
                        "start_location_id": start_id,
                        "opening_pdf_indices": [1],
                    },
                },
            },
        },
        {
            "jsonrpc": "2.0",
            "id": 6,
            "method": "tools/call",
            "params": {
                "name": "coc_invoke",
                "arguments": {
                    "operation": "state.move_scene",
                    "root": os.fspath(fixture["workspace"]),
                    "campaign": fixture["campaign_id"],
                    "arguments": {
                        "scene_id": start_id,
                        "decision_id": "mcp-page-one-explicit-defer",
                        "defer_initial_progressive_on_enter": True,
                    },
                },
            },
        },
    ]
    env = os.environ.copy()
    env["COC_HOST"] = "codex"
    env["COC_DISABLE_QUEUE_WORKER"] = "1"
    completed = subprocess.run(
        [os.fspath(PLUGIN_ROOT / "mcp" / "launch")],
        cwd=tmp_path,
        env=env,
        input="".join(json.dumps(message) + "\n" for message in calls),
        text=True,
        capture_output=True,
        check=False,
        timeout=30,
    )
    assert completed.returncode == 0, completed.stderr
    responses = {
        row["id"]: row
        for row in (json.loads(line) for line in completed.stdout.splitlines())
    }
    prepared = responses[2]["result"]["structuredContent"]
    assert prepared["ok"] is True, prepared
    assert prepared["data"]["source_window"] == [1]
    assert prepared["data"]["selected_start_pack_ready"] is True
    project_card = next(
        row for row in prepared["data"]["mutation_cards"]
        if row["operation"] == "progressive.project_opening"
    )
    assert project_card["prefilled_arguments"]["opening_pdf_indices"] == [1]

    requested = responses[3]["result"]["structuredContent"]
    assert requested["ok"] is True, requested
    assert requested["data"]["status"] == "current"
    assert requested["data"]["job_id"] is None
    projected = responses[4]["result"]["structuredContent"]
    assert projected["ok"] is True, projected
    assert projected["data"]["status"] == "complete"
    activation_operation = projected["data"]["activation_operation"]
    assert activation_operation == {
        "operation": "state.move_scene",
        "invoke_via": "coc_invoke",
        "prefilled_arguments": {
            "scene_id": start_id,
            "defer_initial_progressive_on_enter": True,
        },
        "missing_arguments": ["decision_id"],
        "authority": "advisory",
        "hard_gate": False,
        "contract_ref": activation_operation["contract_ref"],
        "discovery_required": False,
    }
    assert activation_operation["contract_ref"].startswith("state.move_scene@")
    prepared_after = responses[5]["result"]["structuredContent"]
    assert prepared_after["ok"] is True, prepared_after
    assert prepared_after["data"]["projected_selected_start_ready"] is True
    assert prepared_after["data"]["ready_to_activate"] is True
    prepared_activation = next(
        row for row in prepared_after["data"]["mutation_cards"]
        if row["operation"] == "state.move_scene"
    )
    assert prepared_activation == activation_operation
    activated = responses[6]["result"]["structuredContent"]
    assert activated["ok"] is True, activated
    assert activated["data"]["to_scene_id"] == start_id
    assert activated["data"]["progressive"]["on_enter_deferred"] is True

    scenario_path = (
        fixture["workspace"] / ".coc" / "campaigns"
        / fixture["campaign_id"] / "scenario" / "scenario.json"
    )
    scenario = json.loads(scenario_path.read_text(encoding="utf-8"))
    assert scenario["opening_projection_source_binding"]["source_scope"][
        "pdf_indices"
    ] == [1]


def test_hidden_hotset_direct_call_still_succeeds(monkeypatch, tmp_path):
    server = _load_server()
    monkeypatch.setenv("COC_HOST", "grok")

    listed = server._handle({"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    names = {tool["name"] for tool in listed["result"]["tools"]}
    assert "rules_roll" not in names

    # A legacy direct call remains compatible even though Grok no longer lists
    # each hot operation in its progressive search surface.
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

    # A real hidden hotset call still reaches the canonical toolbox gateway.
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
    assert resumed["wire"]["profile"] == "keeper_hot_v1"
    assert resumed["wire"]["control"]["resume_acknowledged"] is True
    assert server.wire_projection.transport_bytes(resumed) <= (
        server.wire_projection.MAX_INLINE_BYTES
    )

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


def test_mcp_wire_projection_keeps_resume_control_before_bounded_working_set():
    server = _load_server()
    repeated = "一段需要保留引用但不应反复塞进模型的连续记忆。" * 4
    full = {
        "ok": True,
        "tool": "session.resume",
        "data": {
            "schema_version": 1,
            "campaign_id": "wire-budget",
            "mode": "awaiting_player",
            "working_set": {
                "mode": "full",
                "revision": "ws-v1-test",
                "read_domains": {"scene": 3, "world": 8},
            },
            "checkpoint": {
                "schema_version": 1,
                "kind": "coc_continuation_checkpoint",
                "campaign_id": "wire-budget",
                "checkpoint_id": "checkpoint-wire-budget",
                "turn_number": 18,
                "status": "awaiting_player",
                "created_at": "2026-07-20T00:00:00+00:00",
                "source": {
                    "finalization_id": "final-wire-budget",
                    "journal_decision_id": "journal-wire-budget",
                    "rendered_sha256": "sha256:rendered",
                    "source_digest": "sha256:source",
                    "integrity_digest": "sha256:integrity",
                },
                "refs": {
                    "finalization": "logs/turn-finalizations.jsonl#final-wire-budget",
                    "transcript": "logs/table-transcript.jsonl",
                    "session_summaries": "memory/session-summaries.jsonl",
                },
                "canonical_projection": {
                    "campaign": {"play_language": "zh-Hans"},
                },
                "content_sha256": "sha256:checkpoint",
            },
            "semantic_capsule": {
                "schema_version": 1,
                "kind": "coc_continuation_semantic_capsule",
                "recent_summaries": [
                    {"turn_number": index, "summary": repeated}
                    for index in range(6)
                ],
                "unresolved_intent": None,
                "threads": [
                    {
                        "thread_id": f"thread-{index}",
                        "summary": repeated,
                        "status": "active",
                        "source_turn": index,
                    }
                    for index in range(12)
                ],
                "confirmed_decisions": [
                    {
                        "decision_id": f"decision-{index}",
                        "summary": repeated,
                        "source_turn": index,
                    }
                    for index in range(32)
                ],
                "do_not_repeat": [
                    {
                        "item_id": f"repeat-{index}",
                        "instruction": repeated,
                        "source_turn": index,
                    }
                    for index in range(32)
                ],
                "style_commitments": ["保留场景、NPC 能动性与友好调侃。"],
                "updated_from_turn": 18,
            },
            "delivery": {
                "status": "unconfirmed",
                "finalization_id": "final-wire-budget",
                "rendered_sha256": "sha256:rendered",
                "exact_text": repeated * 2,
            },
            "current_turn": {
                "rows": [],
                "meaningful_row_count": 0,
                "source_digest": "sha256:turn",
            },
            "pending_turn": None,
            "pending_output_context": None,
            "scene_context": {
                "campaign_id": "wire-budget",
                "active_scene_id": "scene-a",
                "scene": {"dramatic_question": repeated, "tone": ["uneasy"]},
                "npcs_present": [{
                    "npc_id": "npc-a",
                    "name": "甲",
                    "agenda": repeated,
                    "voice": repeated,
                    "impression": {"summary": repeated, "memories": [repeated]},
                }],
                "exits": [{
                    "to": "scene-b",
                    "kind": "travel",
                    "open": True,
                    "operation_opportunity": {
                        "operation": "state.move_scene",
                        "invoke_via": "coc_invoke",
                        "prefilled_arguments": {"scene_id": "scene-b"},
                        "missing_arguments": ["reason", "decision_id"],
                    },
                }],
                "time": {"display": "1920-10-13 15:30"},
                "clues_here": [{
                    "clue_id": "clue-localized",
                    "conclusion_id": "localized-conclusion",
                    "discovered": True,
                    "delivery": "archive",
                    "delivery_kind": "handout",
                    "skill": None,
                    "difficulty": None,
                    "player_safe_summary": "English source summary",
                    "localized_text": {
                        "zh-Hans": {"player_safe_summary": "中文桌面摘要"},
                    },
                    "secret": False,
                }],
                "action_routes": [],
                "continuity": {
                    "active_exceptional_effects": [],
                    "live_world_flags": [],
                },
            },
            "host_input": {"text": repeated, "text_sha256": "sha256:input"},
            "host_context": {
                "before_resume": {"context_epoch": 7, "requires_resume": True},
                "acknowledged": {"context_epoch": 7, "requires_resume": False},
            },
            "operation_opportunities": [],
            "compiled_archive_recovery": None,
            "next_operations": ["interpret_current_player_message"],
        },
        "warnings": [],
        "hints": [repeated for _ in range(10)],
        "attempts": 1,
        "max_attempts": 3,
        "retryable": False,
        "recovered_after_retry": False,
    }
    projected = server.wire_projection.project_envelope(
        "session.resume",
        full,
        contract_digest=server.CONTRACTS["content_sha256"],
        argument_schemas=server.INVOKE_ARGUMENT_SCHEMAS,
    )
    assert server.wire_projection.transport_bytes(projected) <= (
        server.wire_projection.MAX_INLINE_BYTES
    )
    assert projected["wire"]["control"] == {
        "mode": "awaiting_player",
        "context_epoch": 7,
        "resume_acknowledged": True,
        "working_set_revision": "ws-v1-test",
        "next_operations": ["interpret_current_player_message"],
    }
    assert projected["wire"].get("identity_only") is not True
    capsule = projected["data"]["semantic_capsule"]
    assert capsule["omitted_counts"]["confirmed_decisions"] > 0
    assert capsule["detail_operation"]["operation"] == (
        "session.continuation_detail"
    )
    assert capsule["detail_operation"]["discovery_required"] is False
    hot = projected["data"]["ordinary_turn_operations"]
    assert set(hot) == {
        "actions.advise", "state.journal", "turn.output_context",
    }
    assert all(card["discovery_required"] is False for card in hot.values())
    intent_schema = hot["actions.advise"]["arguments_schema"][
        "properties"
    ]["intent_evidence"]
    assert "matched_affordance_ids" in intent_schema["properties"]
    assert "selected_route_ids" not in intent_schema["properties"]
    assert projected["data"]["play_language"] == "zh-Hans"
    assert "current_turn" not in projected["data"]
    tight_scene = projected["data"]["scene_context"]
    assert tight_scene["clues_here"] == [{
        "clue_id": "clue-localized",
        "conclusion_id": "localized-conclusion",
        "discovered": True,
        "delivery": "archive",
        "delivery_kind": "handout",
        "secret": False,
        "player_safe_summary": "中文桌面摘要",
        "localized_for": "zh-Hans",
    }]
    assert "operation_opportunity" not in tight_scene["exits"][0]
    exit_card = tight_scene["exit_operation_template"]
    assert exit_card["operation"] == "state.move_scene"
    assert exit_card["argument_binding"] == {
        "scene_id": "copy exact `to` from the selected open exits[] row"
    }
    assert exit_card["discovery_required"] is False


def test_mcp_wire_scene_context_uses_typed_recovery_index_before_identity_only():
    server = _load_server()
    progressive = {
        "asset_root_id": "source-root",
        "open_host_work_count": 1,
        "ready_for_background_count": 1,
        "blocking_micro_ready_count": 1,
        "leased_count": 0,
        "ready_background_requests": [{
            "job_id": "job-mechanics",
            "kind": "resolve_npc_mechanics",
            "target_id": "sidney-harris",
            "requested_pdf_indices": [373],
            "source_aspect": "mechanics",
            "deadline_class": "blocking_micro",
            "work_group_id": "source-work-mechanics",
            "dispatch_state": "ready",
            "dispatch_attempts": 0,
            "cached_scope_complete": True,
        }],
        "background_takeover": {
            "schema_version": 1,
            "kind": "ready_background_source_work",
            "authority": "advisory",
            "hard_gate": False,
            "dispatch_mode": "direct_single_leaf",
            "direct_single_leaf_dispatch": (
                server.toolbox._source_direct_single_dispatch(
                    workspace_root="/workspace",
                    campaign_id="scene-progressive",
                    asset_root_id="source-root",
                )
            ),
            "host_dispatch": {
                "worker_profile": "coc-source-pack-worker",
                "background": True,
                "packet_binding": (
                    "one exact returned dispatch_tasks[] value per child when "
                    "result_delivery=named_submit"
                ),
                "direct_submit_parent_waits": False,
                "direct_submit_parent_result_polls": 0,
                "direct_submit_parent_output_retrieval": False,
                "direct_submit_parent_calls_fulfill_host_work": False,
                "fallback_without_direct_submit": (
                    "forward exact completed results[i] once through "
                    "progressive.fulfill_host_work"
                ),
            },
            "play_boundary": {
                "player_action_gate": False,
                "narrative_gate": False,
                "output_gate": False,
                "nondependent_play_may_continue": True,
                "blocking_micro_applies_only_to_current_dependent_settlement": True,
            },
        },
    }
    scene_data = {
        "campaign_id": "scene-progressive",
        "active_scene_id": "opening",
        "scene": {"scene_type": "investigation"},
        "npcs_present": [{
            "npc_id": f"npc-{index}",
            "name": f"NPC {index}",
            "agenda": "protect a dense continuity fact " * 24,
            "voice": "measured but detailed " * 16,
            "relationship_to_investigators": "unknown",
        } for index in range(20)],
        "action_routes": [{
            "route_id": f"route-{index}",
            "route_type": "investigative_lead",
            "resolution_kind": "direct_delivery",
            "grants_clue_ids": [f"clue-{index}"],
            "cue": "authored route detail " * 24,
        } for index in range(20)],
        "clues_here": [{
            "clue_id": f"clue-{index}",
            "discovered": False,
            "delivery_kind": "obvious",
            "skill": None,
            "difficulty": None,
            "player_safe_summary": "localized clue substance " * 20,
        } for index in range(30)],
        "exits": [{
            "to": f"scene-{index}",
            "kind": "travel",
            "open": True,
            "cue": "bounded exit cue " * 20,
        } for index in range(30)],
        "party": ["investigator-a"],
        "continuity": {
            "schema_version": 1,
            "state_precedence": "live_over_authored_initial",
            "keeper_only": True,
            "live_world_flags": [{
                "flag_id": f"continuity-{index}",
                "value": True,
                "present": True,
                "provenance": {
                    "decision_id": f"decision-{index}",
                    "reason": "real-session continuity provenance " * 24,
                    "integrity_status": "verified",
                },
            } for index in range(24)],
            "active_exceptional_effects": [],
        },
        "progressive": progressive,
    }
    first_projection = server.wire_projection._compact_scene(
        scene_data, tight=True,
    )
    assert server.wire_projection.transport_bytes(first_projection) > (
        server.wire_projection.MAX_INLINE_BYTES
    )
    projected = server.wire_projection.project_envelope(
        "scene.context",
        {
            "ok": True,
            "tool": "scene.context",
            "data": scene_data,
            "warnings": [],
            "hints": [],
        },
        contract_digest=server.CONTRACTS["content_sha256"],
        argument_schemas=server.INVOKE_ARGUMENT_SCHEMAS,
    )
    assert projected["wire"]["full_result_bytes"] > (
        server.wire_projection.MAX_INLINE_BYTES
    )
    assert server.wire_projection.transport_bytes(projected) <= (
        server.wire_projection.MAX_INLINE_BYTES
    )
    assert projected["wire"]["payload_projected"] is True
    assert projected["wire"]["scene_recovery_index_projection"] is True
    assert projected["wire"].get("identity_only") is not True
    scene_index = projected["data"]
    assert scene_index["kind"] == "typed_scene_recovery_index"
    assert scene_index["active_scene_id"] == "opening"
    assert scene_index["scene_identity"] == {
        "scene_id": "opening",
        "scene_type": "investigation",
    }
    assert len(scene_index["npc_index"]) == 16
    assert len(scene_index["route_index"]) == 16
    assert len(scene_index["clue_index"]) == 24
    assert len(scene_index["exit_index"]) == 24
    assert "continuity" not in scene_index
    assert "agenda" not in scene_index["npc_index"][0]
    assert "cue" not in scene_index["route_index"][0]
    assert "player_safe_summary" not in scene_index["clue_index"][0]
    assert "cue" not in scene_index["exit_index"][0]
    assert scene_index["counts"] == {
        "npcs_present": 20,
        "action_routes": 20,
        "clues_here": 30,
        "exits": 30,
    }
    full_card = scene_index["full_projection_operation"]
    assert full_card["operation"] == "scene.context"
    assert full_card["prefilled_arguments"] == {}
    assert full_card["missing_arguments"] == []
    assert full_card["discovery_required"] is False
    assert full_card["contract_ref"].startswith("scene.context@")
    returned = scene_index["progressive"]
    assert returned["ready_background_requests"][0]["job_id"] == (
        "job-mechanics"
    )
    takeover = returned["background_takeover"]
    assert "claim_operation" not in takeover
    assert takeover["dispatch_mode"] == "direct_single_leaf"
    assert "coordinator_dispatch" not in takeover
    direct = takeover["direct_single_leaf_dispatch"]
    assert direct["agent_type"] == "coc-source-pack-worker"
    assert direct["run_in_background"] is True
    assert direct["codex_parent_claims"] is False
    assert direct["codex_task"]["contract_id"] == (
        "coc.codex-source-pack-claim-task.v1"
    )
    direct_claim = direct["codex_task"]["claim_operation"]
    assert direct_claim["operation"] == "progressive.claim_host_work"
    assert direct_claim["missing_arguments"] == []
    assert direct_claim["prefilled_arguments"]["limit"] == 1
    assert direct_claim["prefilled_arguments"]["result_delivery"] == (
        "task_return_to_parent"
    )
    assert direct_claim["discovery_required"] is False
    assert direct_claim["contract_ref"].startswith(
        "progressive.claim_host_work@"
    )
    completion = direct["completion_operation"]
    assert completion["operation"] == "progressive.fulfill_host_work"
    assert completion["discovery_required"] is False
    assert completion["arguments_schema"]["properties"]["worker_result"][
        "required"
    ] == [
        "job_id", "pack", "related_packs",
    ]
    boundary = returned["background_takeover"]["play_boundary"]
    assert boundary["player_action_gate"] is False
    assert boundary["narrative_gate"] is False
    assert boundary["output_gate"] is False
    assert boundary["nondependent_play_may_continue"] is True
    dispatch = returned["background_takeover"]["host_dispatch"]
    assert dispatch["direct_submit_parent_waits"] is False
    assert dispatch["direct_submit_parent_result_polls"] == 0
    assert dispatch["direct_submit_parent_output_retrieval"] is False
    assert dispatch["direct_submit_parent_calls_fulfill_host_work"] is False


def test_mcp_wire_progressive_status_keeps_coordinator_when_requests_are_large():
    server = _load_server()
    coordinator = server.toolbox._source_coordinator_dispatch(
        workspace_root="/workspace",
        campaign_id="status-progressive",
        asset_root_id="source-root",
        ready_background=[{
            "job_id": "job-opening",
            "work_group_id": "source-work-opening",
        }],
    )
    takeover = {
        "schema_version": 1,
        "kind": "ready_background_source_work",
        "authority": "advisory",
        "hard_gate": False,
        "claim_operation": {
            "operation": "progressive.claim_host_work",
            "invoke_via": "coc_invoke",
            "prefilled_arguments": {"limit": 1},
            "missing_arguments": ["executor_id"],
        },
        "coordinator_dispatch": coordinator,
    }
    huge_request = {
        "job_id": "job-opening",
        "kind": "partial_opening",
        "target_id": "opening",
        "requested_pdf_indices": [357],
        "deadline_class": "blocking_micro",
        "work_group_id": "source-work-opening",
        "dispatch_state": "ready",
        "dispatch_attempts": 0,
        "cached_scope_complete": True,
        "result_contract": {"oversized": "x" * 200_000},
    }
    projected = server.wire_projection.project_envelope(
        "progressive.status",
        {
            "ok": True,
            "tool": "progressive.status",
            "data": {
                "progressive": True,
                "asset_root_id": "source-root",
                "queue": {"schema_version": 1, "done_count": 1},
                "worker": {"running": True},
                "source_cache": {"cached_pdf_indices": [357]},
                "host_work": {
                    "open_count": 1,
                    "ready_for_background_count": 1,
                    "leased_count": 0,
                    "needs_source_window_count": 0,
                    "requests": [huge_request],
                },
                "background_takeover": takeover,
            },
            "warnings": [],
            "hints": [],
        },
        contract_digest=server.CONTRACTS["content_sha256"],
        argument_schemas=server.INVOKE_ARGUMENT_SCHEMAS,
    )
    assert projected["wire"]["full_result_bytes"] > (
        server.wire_projection.MAX_INLINE_BYTES
    )
    assert projected["wire"]["payload_projected"] is True
    assert projected["wire"].get("identity_only") is not True
    returned = projected["data"]["background_takeover"]
    assert returned["coordinator_dispatch"]["codex_task"]["packet"] == (
        returned["coordinator_dispatch"]["packet"]
    )
    assert returned["coordinator_dispatch"]["packet"]["claim_operation"][
        "discovery_required"
    ] is False
    assert "result_contract" not in projected["data"]["host_work"][
        "requests"
    ][0]


def test_resume_budget_keeps_progressive_takeover_after_scene_reduction():
    server = _load_server()
    takeover = {
        "kind": "ready_background_source_work",
        "authority": "advisory",
        "hard_gate": False,
        "claim_operation": {
            "operation": "progressive.claim_host_work",
            "invoke_via": "coc_invoke",
            "prefilled_arguments": {"limit": 1},
            "missing_arguments": ["executor_id"],
        },
    }
    bounded = server.toolbox._bound_session_resume_data({
        "campaign_id": "bounded-progressive",
        "scene_context": {
            "campaign_id": "bounded-progressive",
            "active_scene_id": "opening",
            "scene": {"scene_type": "investigation"},
            "party": ["investigator-a"],
            "npcs_present": [{
                "npc_id": f"npc-{index}",
                "agenda": "oversized" * 1000,
            } for index in range(20)],
            "progressive": {"background_takeover": takeover},
        },
    })
    assert "scene_context_to_minimal_ref" in bounded["resume_budget"][
        "reductions"
    ]
    assert bounded["scene_context"]["progressive"][
        "background_takeover"
    ] == takeover


def test_mcp_wire_resume_inlines_small_hot_argument_contracts():
    server = _load_server()
    projected = server.wire_projection.project_envelope(
        "session.resume",
        {
            "ok": True,
            "tool": "session.resume",
            "data": {
                "campaign_id": "hot-contracts",
                "mode": "awaiting_player",
                "working_set": {"revision": "ws-hot-contracts"},
                "host_context": {
                    "acknowledged": {
                        "context_epoch": 1,
                        "requires_resume": False,
                    },
                },
                "next_operations": ["interpret_current_player_message"],
            },
            "warnings": [],
            "hints": [],
        },
        contract_digest=server.CONTRACTS["content_sha256"],
        argument_schemas=server.INVOKE_ARGUMENT_SCHEMAS,
    )
    hot = projected["data"]["ordinary_turn_operations"]
    assert set(hot["actions.advise"]["arguments_schema"]["properties"]) == {
        "intent_evidence", "investigator", "player_text",
    }
    semantic_fields = hot["actions.advise"]["arguments_schema"][
        "properties"
    ]["intent_evidence"]["properties"]
    assert "matched_affordance_ids" in semantic_fields
    assert "selected_affordance_ids" in semantic_fields
    assert "selected_route_ids" not in semantic_fields
    assert set(hot["state.journal"]["arguments_schema"]["properties"]) == {
        "continuation",
        "decision_id",
        "intent_class",
        "player_action",
        "player_speaker",
        "player_text",
        "run_id",
        "summary",
        "tension",
    }
    assert hot["turn.output_context"]["arguments_schema"]["properties"] == {}
    assert server.wire_projection.transport_bytes(projected) <= (
        server.wire_projection.MAX_INLINE_BYTES
    )


def test_mcp_wire_open_turn_recovery_reuses_action_advice_hot_contract():
    server = _load_server()
    projected = server.wire_projection.project_envelope(
        "session.resume",
        {
            "ok": True,
            "tool": "session.resume",
            "data": {
                "campaign_id": "open-turn-hot-contracts",
                "mode": "open_turn_recovery",
                "working_set": {"revision": "ws-open-turn"},
                "host_context": {
                    "acknowledged": {
                        "context_epoch": 2,
                        "requires_resume": False,
                    },
                },
                "next_operations": ["continue_open_turn"],
            },
            "warnings": [],
            "hints": [],
        },
        contract_digest=server.CONTRACTS["content_sha256"],
        argument_schemas=server.INVOKE_ARGUMENT_SCHEMAS,
    )
    hot = projected["data"]["ordinary_turn_operations"]
    assert set(hot) == {
        "actions.advise", "state.journal", "turn.output_context",
    }
    action_card = hot["actions.advise"]
    assert action_card["discovery_required"] is False
    assert action_card["missing_arguments"] == [
        "player_text", "intent_evidence",
    ]
    assert "arguments_schema" in action_card
    assert server.wire_projection.transport_bytes(projected) <= (
        server.wire_projection.MAX_INLINE_BYTES
    )


def test_mcp_wire_resume_uses_typed_recovery_index_before_identity_only():
    server = _load_server()
    repeated = "过大的恢复详情" * 1200
    projected = server.wire_projection.project_envelope(
        "session.resume",
        {
            "ok": True,
            "tool": "session.resume",
            "data": {
                "schema_version": 1,
                "campaign_id": "recovery-index",
                "mode": "awaiting_player",
                "working_set": {"revision": "ws-index", "read_domains": {}},
                "host_context": {
                    "acknowledged": {
                        "context_epoch": 9,
                        "requires_resume": False,
                    },
                },
                "next_operations": ["interpret_current_player_message"],
                "delivery": {
                    "status": "unconfirmed",
                    "finalization_id": "final-index",
                    "rendered_sha256": "sha256:" + "a" * 64,
                    "exact_text": repeated,
                },
                "checkpoint": {
                    "schema_version": 1,
                    "campaign_id": "recovery-index",
                    "checkpoint_id": "checkpoint-index",
                    "turn_number": 99,
                    "status": "awaiting_player",
                },
                "semantic_capsule": {
                    "schema_version": 1,
                    "kind": "coc_continuation_semantic_capsule",
                    "recent_summaries": [
                        {"turn_number": i, "summary": repeated}
                        for i in range(12)
                    ],
                    "threads": [
                        {"thread_id": f"thread-{i}", "summary": repeated}
                        for i in range(24)
                    ],
                    "confirmed_decisions": [],
                    "do_not_repeat": [],
                    "style_commitments": [repeated for _ in range(8)],
                },
                "current_turn": {
                    "schema_version": 1,
                    "source_row_count": 24,
                    "meaningful_row_count": 24,
                    "operational_row_count": 0,
                    "source_digest": "sha256:" + "b" * 64,
                    "rows": [
                        {
                            "call_index": i,
                            "tool": "actions.advise",
                            "ok": True,
                            "args": {"semantic_reason": repeated},
                            "data_ref": f"logs/toolbox-calls.jsonl#call-{i}",
                        }
                        for i in range(24)
                    ],
                },
                "scene_context": {
                    "campaign_id": "recovery-index",
                    "active_scene_id": "large-scene",
                    "scene": {
                        "scene_id": "large-scene",
                        "scene_type": "investigation",
                        "dramatic_question": repeated,
                    },
                    "party": ["investigator-a"],
                    "time": {"display": "1920-10-12 15:00"},
                    "npcs_present": [
                        {
                            "npc_id": f"npc-{i}",
                            "name": f"NPC {i}",
                            "agenda": repeated,
                            "voice": repeated,
                        }
                        for i in range(40)
                    ],
                    "action_routes": [
                        {
                            "route_id": f"route-{i}",
                            "route_type": "investigative_lead",
                            "resolution_kind": "direct_delivery",
                            "cue": repeated,
                        }
                        for i in range(40)
                    ],
                    "clues_here": [
                        {
                            "clue_id": f"clue-{i}",
                            "discovered": False,
                            "player_safe_summary": repeated,
                        }
                        for i in range(40)
                    ],
                    "exits": [
                        {
                            "to": f"scene-{i}",
                            "kind": "travel",
                            "open": True,
                            "operation_opportunity": {
                                "operation": "state.move_scene",
                                "invoke_via": "coc_invoke",
                                "prefilled_arguments": {"scene_id": f"scene-{i}"},
                                "missing_arguments": ["reason", "decision_id"],
                            },
                        }
                        for i in range(40)
                    ],
                    "progressive": {
                        "asset_root_id": "recovery-source-root",
                        "ready_for_background_count": 1,
                        "blocking_micro_ready_count": 1,
                        "ready_background_requests": [{
                            "job_id": "job-recovery-mechanics",
                            "kind": "resolve_npc_mechanics",
                            "target_id": "sidney-harris",
                            "deadline_class": "blocking_micro",
                            "dispatch_state": "ready",
                            "dispatch_attempts": 0,
                            "cached_scope_complete": True,
                        }],
                        "background_takeover": {
                            "schema_version": 1,
                            "kind": "ready_background_source_work",
                            "dispatch_mode": "direct_single_leaf",
                            "direct_single_leaf_dispatch": (
                                server.toolbox._source_direct_single_dispatch(
                                    workspace_root="/workspace",
                                    campaign_id="recovery-index",
                                    asset_root_id="recovery-source-root",
                                )
                            ),
                            "authority": "advisory",
                            "hard_gate": False,
                            "play_boundary": {
                                "player_action_gate": False,
                                "narrative_gate": False,
                                "output_gate": False,
                                "nondependent_play_may_continue": True,
                            },
                        },
                    },
                },
            },
            "warnings": [],
            "hints": [],
        },
        contract_digest=server.CONTRACTS["content_sha256"],
        argument_schemas=server.INVOKE_ARGUMENT_SCHEMAS,
    )
    assert server.wire_projection.transport_bytes(projected) <= (
        server.wire_projection.MAX_INLINE_BYTES
    )
    assert projected["wire"]["recovery_index_projection"] is True
    assert projected["wire"].get("identity_only") is not True
    data = projected["data"]
    assert data["recovery_index"]["kind"] == "typed_progressive_recovery_index"
    assert data["scene_context"]["kind"] == "typed_scene_recovery_index"
    assert data["scene_context"]["full_projection_operation"]["operation"] == (
        "scene.context"
    )
    progressive = data["scene_context"]["progressive"]
    assert progressive["ready_background_requests"][0]["job_id"] == (
        "job-recovery-mechanics"
    )
    assert "claim_operation" not in progressive["background_takeover"]
    assert progressive["background_takeover"][
        "direct_single_leaf_dispatch"
    ]["codex_parent_claims"] is False
    assert progressive["background_takeover"]["hard_gate"] is False
    assert data["semantic_capsule"]["detail_operation"]["operation"] == (
        "session.continuation_detail"
    )
    assert set(data["ordinary_turn_operations"]) == {
        "actions.advise", "state.journal", "turn.output_context",
    }
    assert "arguments_schema" in data["ordinary_turn_operations"][
        "actions.advise"
    ]
    assert data["delivery"]["replay_operation"]["operation"] == (
        "session.delivery_text"
    )


def test_mcp_wire_npc_reaction_carries_exact_engagement_contract():
    server = _load_server()
    projected = server.wire_projection.project_envelope(
        "npc.reaction",
        {
            "ok": True,
            "tool": "npc.reaction",
            "data": {
                "receipt_id": "impression-1",
                "record_engagement_operation": {
                    "operation": "state.record_npc_engagement",
                    "invoke_via": "coc_invoke",
                    "prefilled_arguments": {
                        "npc_id": "npc-a",
                        "investigator": "investigator-a",
                        "first_impression_ref": "impression-1",
                        "run_id": "run-a",
                    },
                    "missing_arguments": [
                        "interaction_kind",
                        "decision_id",
                        "first_impression_realization",
                    ],
                    "authority": "advisory",
                    "hard_gate": False,
                },
            },
            "warnings": [],
            "hints": [],
        },
        contract_digest=server.CONTRACTS["content_sha256"],
        argument_schemas=server.INVOKE_ARGUMENT_SCHEMAS,
    )
    card = projected["data"]["record_engagement_operation"]
    assert card["discovery_required"] is False
    assert card["prefilled_arguments"]["npc_id"] == "npc-a"
    assert set(card["arguments_schema"]["properties"]) == {
        "decision_id",
        "first_impression_realization",
        "first_impression_ref",
        "identity_ref",
        "interaction_kind",
        "investigator",
        "npc_id",
        "route_completion",
        "run_id",
    }
    assert "root" not in card["arguments_schema"]["properties"]
    assert "campaign" not in card["arguments_schema"]["properties"]
    assert server.wire_projection.transport_bytes(projected) <= (
        server.wire_projection.MAX_INLINE_BYTES
    )


def test_mcp_wire_scene_context_keeps_authored_npc_identity_refs():
    server = _load_server()
    projected = server.wire_projection.project_envelope(
        "scene.context",
        {
            "ok": True,
            "tool": "scene.context",
            "data": {
                "campaign_id": "identity-projection",
                "active_scene_id": "opening",
                "scene": {"scene_type": "investigation"},
                "npcs_present": [{
                    "npc_id": "npc-a",
                    "name": "NPC A",
                    "origin": "source",
                    "identity_ref": "npc-identity-v2:abc123",
                    "profile_revision_ref": "npc-profile-v2:def456",
                }],
                "exits": [],
                "clues_here": [],
                "action_routes": [],
            },
            "warnings": [],
            "hints": [],
        },
        contract_digest=server.CONTRACTS["content_sha256"],
        argument_schemas=server.INVOKE_ARGUMENT_SCHEMAS,
    )

    npc = projected["data"]["npcs_present"][0]
    assert npc["identity_ref"] == "npc-identity-v2:abc123"
    assert npc["profile_revision_ref"] == "npc-profile-v2:def456"
    assert server.wire_projection.transport_bytes(projected) <= (
        server.wire_projection.MAX_INLINE_BYTES
    )


def test_mcp_wire_projects_hot_turn_receipts_without_repeating_full_payloads():
    server = _load_server()
    candidate = {
        "storylet_id": "wire-storylet",
        "cue": "窗外传来一声不合时宜的报童叫卖。",
        "beat": "pressure",
    }
    opportunity = {
        "schema_version": 1,
        "authority": "advisory",
        "hard_gate": False,
        "advice_id": "storylets:3:0123456789abcdef0123",
        "candidate_ref": "storylet-candidate-v1:0123456789abcdef",
        "candidate": candidate,
        "adoption_operation": {
            "operation": "evidence.record_adoption",
            "invoke_via": "coc_invoke",
            "prefilled_arguments": {
                "advice_id": "storylets:3:0123456789abcdef0123",
                "storylet_candidate": candidate,
            },
            "missing_arguments": ["decision_id"],
        },
    }
    actions = server.wire_projection.project_envelope(
        "actions.advise",
        {
            "ok": True,
            "tool": "actions.advise",
            "data": {
                "schema_version": 1,
                "authority": "advisory",
                "hard_gate": False,
                "scene_id": "scene-a",
                "investigator_id": "investigator-a",
                "intent_evidence": {"primary_intent": "investigate"},
                "resolution_advice": {"resolution_kind": "direct_delivery"},
                "rule_advice": [{"large": "规则建议" * 2000}],
                "action_routes": [{"large": "行动路线" * 2000}],
                "operation_opportunities": [],
                "narrative_opportunity": opportunity,
            },
            "warnings": [],
            "hints": [],
        },
        contract_digest=server.CONTRACTS["content_sha256"],
    )
    assert "rule_advice" not in actions["data"]
    assert "action_routes" not in actions["data"]
    projected_opportunity = actions["data"]["narrative_opportunity"]
    assert projected_opportunity["candidate"] == candidate
    prefilled = projected_opportunity["adoption_operation"][
        "prefilled_arguments"
    ]["advisory_uptake"]
    assert prefilled == {
        "advice_id": opportunity["advice_id"],
        "candidate_ref": opportunity["candidate_ref"],
    }

    output = server.wire_projection.project_envelope(
        "turn.output_context",
        {
            "ok": True,
            "tool": "turn.output_context",
            "data": {
                "schema_version": 1,
                "turn_id": "turn-a",
                "journal_decision_id": "journal-a",
                "source_digest": "sha256:source",
                "obligations": [],
                "required_obligation_ids": [],
                "mechanics_bundle": {
                    "journal_decision_id": "journal-a",
                    "public_check": [{
                        "roll_id": "roll-a",
                        "skill": "Library Use",
                        "roll": 33,
                        "base_target": 50,
                        "outcome": "success",
                        "attempt_advisory": {"large": "重复诊断" * 3000},
                    }],
                    "state_delta": [],
                    "exceptional_effect": [],
                    "concealed_consequence": [],
                },
                "mechanics_bundle_sha256": "sha256:bundle",
                "npc_performance_constraints": [],
                "missing_substantive_effects": [],
                "pending_modifier_consumptions": [],
                "narrative_opportunity": opportunity,
            },
            "warnings": [],
            "hints": [],
        },
        contract_digest=server.CONTRACTS["content_sha256"],
    )
    assert "mechanics_bundle" not in output["data"]
    assert output["data"]["mechanics_summary"]["public_check"] == [{
        "roll_id": "roll-a",
        "skill": "Library Use",
        "roll": 33,
        "base_target": 50,
        "outcome": "success",
    }]
    assert output["data"]["narrative_opportunity"]["candidate"] == candidate
    finalize_operation = output["data"]["finalize_operation"]
    assert finalize_operation["operation"] == "turn.finalize"
    assert finalize_operation["discovery_required"] is False
    assert finalize_operation["prefilled_arguments"] == {
        "decision_id": "journal-a:finalize",
        "coverage": [],
    }
    assert finalize_operation["missing_arguments"] == ["draft"]
    assert finalize_operation["argument_contract"]["forbidden_aliases"] == [
        "draft_text",
        "journal_decision_id",
    ]

    finalized = server.wire_projection.project_envelope(
        "turn.finalize",
        {
            "ok": True,
            "tool": "turn.finalize",
            "data": {
                "schema_version": 1,
                "finalization_id": "final-a",
                "decision_id": "decision-a",
                "journal_decision_id": "journal-a",
                "rendered_sha256": "sha256:rendered",
                "rendered_text": "最终玩家可见文本。",
                "mechanics_bundle": {"large": "重复机械包" * 3000},
                "segments": [{"large": "重复分段" * 2000}],
            },
            "continuation": {"checkpoint_id": "checkpoint-a"},
            "warnings": [],
            "hints": ["echo rendered_text exactly"],
        },
        contract_digest=server.CONTRACTS["content_sha256"],
    )
    assert finalized["data"] == {
        "schema_version": 1,
        "finalization_id": "final-a",
        "decision_id": "decision-a",
        "journal_decision_id": "journal-a",
        "rendered_sha256": "sha256:rendered",
        "rendered_text": "最终玩家可见文本。",
    }
    assert finalized["continuation"] == {"checkpoint_id": "checkpoint-a"}
    for envelope in (actions, output, finalized):
        assert server.wire_projection.transport_bytes(envelope) <= (
            server.wire_projection.MAX_INLINE_BYTES
        )


def test_mcp_wire_finalize_card_matches_archive_and_never_prefills_semantics():
    server = _load_server()
    schema = server.CONTRACTS["operations"]["turn.finalize"]["inputSchema"]
    assert set(server.wire_projection.FINALIZE_ARGUMENTS) == (
        set(schema["properties"]) - {"root", "campaign"}
    )
    coverage_schema = schema["properties"]["coverage"]["items"]
    assert set(server.wire_projection.FINALIZE_COVERAGE_FIELDS) == set(
        coverage_schema["required"]
    )
    assert set(server.wire_projection.FINALIZE_REALIZATION_VALUES) == set(
        coverage_schema["properties"]["realization"]["enum"]
    )
    assert set(
        server.wire_projection.FINALIZE_PLAYER_INPUT_HANDLING_VALUES
    ) == set(
        coverage_schema["properties"]["player_input_handling"]["enum"]
    )

    projected = server.wire_projection.project_envelope(
        "turn.output_context",
        {
            "ok": True,
            "tool": "turn.output_context",
            "data": {
                "journal_decision_id": "journal-with-obligations",
                "obligations": [
                    {"obligation_id": "obligation-a"},
                    {"obligation_id": "obligation-b"},
                ],
                "required_obligation_ids": [
                    "obligation-a",
                    "obligation-b",
                ],
            },
            "warnings": [],
            "hints": [],
        },
        contract_digest=server.CONTRACTS["content_sha256"],
    )
    card = projected["data"]["finalize_operation"]
    assert card["prefilled_arguments"] == {
        "decision_id": "journal-with-obligations:finalize",
    }
    assert card["missing_arguments"] == ["draft", "coverage"]
    assert card["coverage_contract"]["obligation_ids"] == [
        "obligation-a",
        "obligation-b",
    ]
    assert set(card["coverage_contract"]["required_fields"]) == set(
        coverage_schema["required"]
    )
    assert "coverage" not in card["prefilled_arguments"]
    assert server.wire_projection.transport_bytes(projected) <= (
        server.wire_projection.MAX_INLINE_BYTES
    )
