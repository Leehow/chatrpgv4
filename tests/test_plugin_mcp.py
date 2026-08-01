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
    assert set(item["properties"]) == {
        "job_id", "pack", "related_packs", "opening_setup",
    }

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

    resume_description = on_disk["operations"]["session.resume"]["description"]
    assert "predates this host startup" in resume_description
    assert "do not call it after creating" in resume_description
    generic_check_description = on_disk["operations"]["rules.check"][
        "description"
    ]
    assert "not an investigator skill or characteristic check" in (
        generic_check_description
    )
    assert "rules.roll" in generic_check_description
    assert "rules.psychology_observe" in generic_check_description
    assert "rules.skill_check does not exist" in generic_check_description
    assert "do not pass investigator skill or skill_id" in (
        on_disk["operations"]["rules.check"]["inputSchema"]["properties"][
            "request"
        ]["description"]
    )
    status_description = on_disk["operations"]["progressive.status"][
        "description"
    ]
    assert "not a Pi private-coordinator completion signal" in status_description
    assert "await its terminal notice without polling" in status_description
    prepare_description = on_disk["operations"][
        "progressive.prepare_opening"
    ]["description"]
    assert "after opening bootstrap, do not repeat this planner" in (
        prepare_description
    )
    assert "opening_page_candidates catalog" in prepare_description
    assert "never guess page indices" in prepare_description
    bootstrap_description = on_disk["operations"][
        "progressive.opening_bootstrap"
    ]["description"]
    assert "follow the returned host lifecycle instead of repeating bootstrap" in (
        bootstrap_description
    )

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
        "job_id", "pack", "related_packs", "opening_setup",
    }
    for operation in (
        "progressive.opening_bootstrap",
        "progressive.renew_host_work_leases",
        "progressive.release_host_work_leases",
    ):
        assert operation in on_disk["operations"]
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
                    "era": "1920s",
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


def test_source_facts_discovery_is_closed_typed_and_delegates_canonically(
    monkeypatch,
):
    server = _load_server()
    discovered = server._call_tool(
        "coc_discover",
        {"operation": "setup.adopt_source_facts"},
    )["data"]
    schema = discovered["operation"]["inputSchema"]
    assert schema["required"] == ["campaign_id", "facts"]
    facts = schema["properties"]["facts"]
    assert facts["additionalProperties"] is False
    assert facts["required"] == [
        "schema_version",
        "contract_id",
        "era",
        "place",
        "investigator_hook",
        "investigator_constraints",
        "player_safe_summary",
        "content_flags",
    ]
    for name in (
        "era",
        "place",
        "investigator_hook",
        "investigator_constraints",
        "player_safe_summary",
        "content_flags",
    ):
        answer = facts["properties"][name]
        assert answer["additionalProperties"] is False
        assert answer["required"] == ["status"]
        assert answer["properties"]["status"]["enum"] == [
            "source", "unresolved",
        ]
        for refs_key in ("source_refs", "inspected_source_refs"):
            refs = answer["properties"][refs_key]
            assert refs["minItems"] == 1
            assert refs["items"]["additionalProperties"] is False
            assert refs["items"]["required"] == ["source_id", "pdf_index"]

    captured = {}

    def fake_execute(root, *, operation):
        captured["root"] = root
        captured["operation"] = operation
        return {
            "schema_version": 1,
            "status": "PASS",
            "kind": "campaign.adopt_source_facts",
            "result": {
                "campaign_id": "typed-facts",
                "facts": operation["payload"]["facts"],
            },
            "state_refs": [],
        }

    monkeypatch.setattr(
        server.toolbox.coc_runtime_ops,
        "execute_setup_operation",
        fake_execute,
    )
    selector = [{"source_id": "pdf:typed", "pdf_index": 0}]
    source = {"status": "source", "value": "1920s", "source_refs": selector}
    unresolved = {
        "status": "unresolved",
        "inspected_source_refs": selector,
    }
    payload = {
        "schema_version": 1,
        "contract_id": "coc.opening-fast-facts.v1",
        "era": source,
        "place": {**source, "value": "Boston"},
        "investigator_hook": unresolved,
        "investigator_constraints": unresolved,
        "player_safe_summary": unresolved,
        "content_flags": {
            "status": "source",
            "value": ["haunting"],
            "source_refs": selector,
        },
    }
    invoked = server._call_tool(
        "coc_invoke",
        {
            "operation": "setup.adopt_source_facts",
            "root": os.fspath(ROOT),
            "arguments": {"campaign_id": "typed-facts", "facts": payload},
        },
    )
    assert invoked["ok"] is True, invoked
    assert captured["operation"] == {
        "schema_version": 1,
        "kind": "campaign.adopt_source_facts",
        "payload": {"campaign_id": "typed-facts", "facts": payload},
    }


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
        if operation == "progressive.prepare_opening":
            for schema in full_schemas:
                assert "campaign_id" not in schema["properties"]
            for schema in invoke_schemas:
                redundant = schema["properties"]["campaign_id"]
                assert redundant["type"] == "string"
                assert redundant["minLength"] == 1
                assert "must exactly equal" in redundant["description"]

    bootstrap = "progressive.opening_bootstrap"
    bootstrap_registered = archive_mod.input_schema_for_spec(
        server.toolbox.TOOLS[bootstrap]
    )
    bootstrap_discovered = server._call_tool(
        "coc_discover", {"operation": bootstrap}
    )["data"]
    bootstrap_schemas = [
        bootstrap_registered,
        rebuilt["operations"][bootstrap]["inputSchema"],
        on_disk["operations"][bootstrap]["inputSchema"],
        server.CONTRACTS["operations"][bootstrap]["inputSchema"],
        bootstrap_discovered["operation"]["inputSchema"],
        server.INVOKE_ARGUMENT_SCHEMAS[bootstrap],
        bootstrap_discovered["invoke_card"]["arguments_schema"],
    ]
    for schema in bootstrap_schemas:
        assert schema["required"] == [
            "campaign", "start_location", "opening_pdf_indices",
        ] or schema["required"] == [
            "start_location", "opening_pdf_indices",
        ]
        start = schema["properties"]["start_location"]
        assert start["additionalProperties"] is False
        assert start["required"] == ["location_id", "title"]
        assert start["properties"]["location_id"]["pattern"] == safe_id_pattern
        assert start["properties"]["title"]["maxLength"] == 240
        for key, value in expected_pages.items():
            assert schema["properties"]["opening_pdf_indices"][key] == value


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


def test_pi_keeper_discovery_hides_private_source_lifecycle_with_bound_cache(
    monkeypatch, tmp_path,
):
    server = _load_server()
    hidden = {
        "progressive.claim_host_work",
        "progressive.fulfill_host_work",
        "progressive.renew_host_work_leases",
        "progressive.release_host_work_leases",
    }
    monkeypatch.setenv("COC_HOST", "pi")
    monkeypatch.setenv("COC_MCP_PROFILE", "keeper")

    exact = server._call_tool(
        "coc_discover",
        {"operation": "progressive.claim_host_work"},
    )["data"]
    assert exact["ok"] is False
    assert exact["error"]["code"] == "unknown_tool"

    progressive = server._call_tool(
        "coc_discover", {"domain": "progressive"},
    )["data"]
    progressive_ids = {
        row["operation"]
        for row in progressive["domains"][0]["operations"]
    }
    assert hidden.isdisjoint(progressive_ids)
    assert "progressive.opening_bootstrap" in progressive_ids

    catalog = server._call_tool("coc_discover", {})["data"]
    all_ids = {
        row["operation"]
        for domain_row in catalog["domains"]
        for row in domain_row["operations"]
    }
    assert hidden.isdisjoint(all_ids)
    assert catalog["count"] == len(server.toolbox.TOOLS) - len(hidden)
    assert catalog["archive"]["operation_count"] == catalog["count"]
    pi_hash = catalog["content_sha256"]
    assert pi_hash != server.CONTRACTS["content_sha256"]
    assert catalog["archive_content_sha256"] == server.CONTRACTS[
        "content_sha256"
    ]

    cached = server._call_tool(
        "coc_discover", {"since_content_sha256": pi_hash},
    )["data"]
    assert cached == {
        "ok": True,
        "not_modified": True,
        "content_sha256": pi_hash,
    }
    wrong_query_cache = server._call_tool(
        "coc_discover",
        {
            "domain": "progressive",
            "since_content_sha256": pi_hash,
        },
    )["data"]
    assert wrong_query_cache.get("not_modified") is not True
    assert wrong_query_cache["content_sha256"] != pi_hash

    # Discovery is a main-KP presentation boundary, not an invocation gate.
    invoked = server._call_tool(
        "coc_invoke",
        {
            "operation": "progressive.release_host_work_leases",
            "root": os.fspath(tmp_path),
            "arguments": {
                "asset_root_id": "missing-root",
                "executor_id": "private-coordinator",
                "lease_ids": ["lease-1"],
                "reason": "private lifecycle cleanup",
            },
        },
    )
    assert invoked["tool"] == "progressive.release_host_work_leases"
    assert invoked["error"]["code"] != "unknown_tool"

    # A manual/headless host retains the complete canonical discovery surface,
    # and a Pi-view cache token cannot suppress that different projection.
    monkeypatch.setenv("COC_HOST", "unknown")
    manual = server._call_tool(
        "coc_discover",
        {
            "operation": "progressive.claim_host_work",
            "since_content_sha256": pi_hash,
        },
    )["data"]
    assert manual["ok"] is True
    assert manual.get("not_modified") is not True
    assert manual["canonical_operation"] == "progressive.claim_host_work"


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
    monkeypatch.setenv("COC_HOST", "pi")
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
    assert (
        os.fspath(tmp_path.resolve()), "mcp-custom"
    ) in server._PROCESS_FRESH_CAMPAIGNS
    assert "context_rehydration" not in campaign
    assert not any(
        "call session.resume" in hint for hint in campaign["hints"]
    )
    assert any(
        "predates the current host context" in hint
        for hint in campaign["hints"]
    )

    investigator = invoke("investigator.create", {
        "investigator_id": "mcp-custom-investigator",
        "sheet": _custom_setup_investigator_sheet("mcp-custom-investigator"),
        "creation": {"input_mode": "import_complete_sheet"},
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
    cross_kind_field = invoke("campaign.render_briefing", {
        "campaign_id": "mcp-custom",
        "html_mode": "never",
    })
    assert cross_kind_field["ok"] is False
    assert cross_kind_field["error"]["code"] == "setup_failed"

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
    assert "next_operation" not in bound["data"]
    assert bound["data"]["opening_gate"]["phase"] == (
        "opening_source_review_required"
    )
    continuation = {
        "schema_version": 1,
        "contract_id": "coc.opening-source-continue.v1",
        "campaign_id": "mcp-custom",
        "scenario_id": "custom-mcp-module",
        "selected_opening_pdf_indices": [0],
        "source_bundle_id": "custom-mcp-module",
        "source_bundle_path": os.fspath(bundle.resolve()),
        "result_delivery": "task_return_to_parent",
    }
    review_receipt = (
        server.toolbox.coc_runtime_ops
        ._build_opening_source_review_fulfillment(
            tmp_path,
            continuation=continuation,
            status="reviewed",
            selected_opening_pdf_indices=[0],
        )
    )
    server.toolbox.coc_runtime_ops._apply_opening_source_review_fulfillment(
        tmp_path, review_receipt,
    )
    resumed_after_review = server._call_tool("coc_invoke", {
        "operation": "session.resume",
        "root": os.fspath(tmp_path),
        "campaign": "mcp-custom",
        "arguments": {},
    })
    assert resumed_after_review["ok"] is False, resumed_after_review
    next_operation = resumed_after_review["error"]["details"]["next_operation"]
    assert next_operation["operation"] == "progressive.prepare_opening"
    assert next_operation["invoke_via"] == "coc_invoke"
    assert next_operation["prefilled_arguments"] == {}
    assert next_operation["missing_arguments"] == []
    assert next_operation["hard_gate"] is True
    assert bound["data"]["opening_gate"]["activation_allowed"] is False
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
    assert fresh_status["ok"] is False, fresh_status
    assert fresh_status["error"]["code"] == "opening_setup_incomplete"
    assert fresh_status["error"]["details"]["next_operation"] == next_operation
    assert "context_rehydration" not in fresh_status

    rerendered = invoke("campaign.render_briefing", {
        "campaign_id": "mcp-custom",
        "language": "zh-Hans",
    })
    assert rerendered["ok"] is True, rerendered
    assert rerendered["data"]["status"] == "PASS"
    assert rerendered["data"]["kind"] == "campaign.render_briefing"
    assert rerendered["data"]["result"]["campaign_id"] == "mcp-custom"
    assert (
        tmp_path / rerendered["data"]["result"]["briefing_path"]
    ).is_file()
    assert rerendered["data"]["next_operation"] == next_operation

    rebound = invoke("scenario.bind_pdf", {
        "campaign_id": "mcp-custom",
        "scenario_id": "custom-mcp-module",
        "title": "Custom MCP Module",
        "source_bundle_path": os.fspath(bundle),
        "compile_now": True,
    })
    assert rebound["ok"] is False, rebound
    assert rebound["error"]["code"] == "opening_setup_incomplete"
    assert rebound["error"]["details"]["next_operation"] == next_operation

    prepared = server._call_tool("coc_invoke", {
        "operation": "progressive.prepare_opening",
        "root": os.fspath(tmp_path),
        "campaign": "mcp-custom",
        "arguments": {},
    })
    assert prepared["ok"] is True, prepared
    bootstrap = prepared["data"]["next_operation"]
    assert bootstrap["operation"] == "progressive.opening_bootstrap"
    assert bootstrap["invoke_via"] == "coc_invoke"
    assert bootstrap["missing_arguments"] == [
        "start_location", "opening_pdf_indices",
    ]
    assert bootstrap["hard_gate"] is True

    rendered_card = invoke("investigator.render_card", {
        "campaign_id": "mcp-custom",
        "investigator_id": "mcp-custom-investigator",
        "language": "zh-Hans",
        "html_mode": "never",
    })
    assert rendered_card["ok"] is True, rendered_card
    markdown_path = rendered_card["data"]["result"]["markdown_path"]
    assert (tmp_path / markdown_path).is_file()
    assert rendered_card["data"]["next_operation"] == next_operation

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


def test_historical_setup_receipt_cannot_replace_active_campaign(
    monkeypatch, tmp_path,
):
    server = _load_server()
    root_key = os.fspath(tmp_path.resolve())
    monkeypatch.setattr(
        server, "_PROCESS_ACTIVE_CAMPAIGN", (root_key, "campaign-a"),
    )
    monkeypatch.setattr(server, "_PROCESS_FRESH_CAMPAIGNS", set())

    def fake_run(name, _root, campaign, args):
        if name == "session.resume":
            return {
                "ok": True,
                "tool": name,
                "data": {
                    "campaign_id": campaign,
                    "host_context": {
                        "acknowledged": {
                            "campaign_id": campaign,
                            "session_id": "resume-b",
                        },
                    },
                },
                "warnings": [],
                "hints": [],
            }
        return {
            "ok": True,
            "tool": name,
            "data": {
                "result": {
                    "campaign_id": args["payload"]["campaign_id"],
                },
            },
            "warnings": [],
            "hints": [],
        }

    monkeypatch.setattr(server.toolbox, "run_tool", fake_run)
    historical = server._call_tool("coc_invoke", {
        "operation": "setup.invoke",
        "root": root_key,
        "arguments": {
            "kind": "campaign.render_briefing",
            "payload": {"campaign_id": "historical-b"},
        },
    })
    assert historical["ok"] is True
    assert server._PROCESS_ACTIVE_CAMPAIGN == (root_key, "campaign-a")
    assert historical["context_rehydration"] == {
        "code": "context_rehydration_recommended",
        "reason": "campaign_switch",
        "campaign_id": "historical-b",
        "next_operation": "session.resume",
        "authority": "advisory",
        "hard_gate": False,
    }

    resumed = server._call_tool("coc_invoke", {
        "operation": "session.resume",
        "root": root_key,
        "campaign": "historical-b",
        "arguments": {},
    })
    assert resumed["ok"] is True
    assert server._PROCESS_ACTIVE_CAMPAIGN == (root_key, "historical-b")


def test_opening_resume_gate_acknowledges_mcp_campaign_context(
    monkeypatch, tmp_path,
):
    server = _load_server()
    root_key = os.fspath(tmp_path.resolve())
    campaign_id = "opening-resume-context"
    monkeypatch.setattr(server, "_PROCESS_ACTIVE_CAMPAIGN", None)
    monkeypatch.setattr(server, "_PROCESS_FRESH_CAMPAIGNS", set())

    def fake_run(name, _root, campaign, _args):
        if name == "session.resume":
            return {
                "ok": False,
                "tool": "session.resume",
                "error": {
                    "code": "opening_setup_incomplete",
                    "details": {
                        "schema_version": 1,
                        "status": "blocked",
                        "hard_gate": True,
                        "activation_allowed": False,
                        "phase": "opening_selection",
                        "campaign_id": campaign,
                        "next_operation": {
                            "operation": "progressive.prepare_opening",
                        },
                        "instruction": (
                            "invoke the exact retained "
                            "progressive.prepare_opening route"
                        ),
                    },
                },
            }
        return {
            "ok": True,
            "tool": name,
            "data": {"status": "ready"},
            "warnings": [],
            "hints": [],
        }

    monkeypatch.setattr(server.toolbox, "run_tool", fake_run)
    resumed = server._call_tool("coc_invoke", {
        "operation": "session.resume",
        "root": root_key,
        "campaign": campaign_id,
        "arguments": {},
    })
    assert resumed["ok"] is False
    assert resumed["error"]["code"] == "opening_setup_incomplete"
    assert server._PROCESS_ACTIVE_CAMPAIGN == (root_key, campaign_id)

    prepared = server._call_tool("coc_invoke", {
        "operation": "progressive.prepare_opening",
        "root": root_key,
        "campaign": campaign_id,
        "arguments": {},
    })
    assert prepared["ok"] is True
    assert "context_rehydration" not in prepared
    assert not any(
        "session.resume" in hint for hint in prepared.get("hints", [])
    )


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
                "arguments": {
                    "campaign_id": fixture["campaign_id"],
                },
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
    assert data["opening_page_candidate_complete"] is True
    assert data["opening_page_candidates"]
    assert any(
        "never guess page indices" in hint
        for hint in envelope["hints"]
    )
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


def test_prepare_opening_redundant_campaign_selector_fails_closed_on_drift(
    monkeypatch, tmp_path,
):
    monkeypatch.setenv("COC_HOST", "pi")
    fixture = _mcp_opening_workspace(tmp_path, publish_skeleton=False)
    server = fixture["server"]
    matching = server._call_tool("coc_invoke", {
        "operation": "progressive.prepare_opening",
        "root": os.fspath(fixture["workspace"]),
        "campaign": fixture["campaign_id"],
        "arguments": {"campaign_id": fixture["campaign_id"]},
    })
    assert matching["ok"] is True, matching
    assert matching["data"]["opening_page_candidate_complete"] is True

    for outer_campaign, redundant_campaign in (
        (fixture["campaign_id"], "wrong-campaign"),
        (None, fixture["campaign_id"]),
    ):
        invoked = server._call_tool("coc_invoke", {
            "operation": "progressive.prepare_opening",
            "root": os.fspath(fixture["workspace"]),
            **({"campaign": outer_campaign} if outer_campaign else {}),
            "arguments": {"campaign_id": redundant_campaign},
        })
        assert invoked["ok"] is False
        assert invoked["error"] == {
            "code": "invalid_param",
            "message": (
                "progressive.prepare_opening arguments.campaign_id "
                "must exactly match the bound outer campaign"
            ),
        }


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
        "turn_sequence", "actions.advise", "state.journal", "turn.output_context",
    }
    assert all(card["discovery_required"] is False for card in hot.values() if isinstance(card, dict))
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
        "scene": {
            "scene_type": "investigation",
            "player_safe_summary": "The patron begins the complete briefing.",
        },
        "source_material": {
            "schema_version": 1,
            "keeper_only": True,
            "authority": "source_authored_context",
            "player_safe_summary": "The patron begins the complete briefing.",
            "contextual_mentions": [{
                "kind": "npc",
                "ref_id": "npc-elder",
                "raw_label": "the village elder",
                "note": "The elder is bedridden and hard of hearing.",
                "source_refs": [{
                    "source_id": "pdf:wire-source",
                    "pdf_index": 3,
                    "text_sha256": "a" * 64,
                }],
            }],
            "source_refs": [{
                "source_id": "pdf:wire-source",
                "pdf_index": 3,
                "text_sha256": "a" * 64,
            }],
            "disclosure": {
                "authority": "advisory",
                "hard_gate": False,
                "opening_teaser_is_not_delivery": True,
                "semantic_policy": "Use relevant revealable facts semantically.",
            },
        },
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
    assert scene_index["source_material"] == {
        "schema_version": 1,
        "keeper_only": True,
        "authority": "source_authored_context",
        "player_safe_summary": "The patron begins the complete briefing.",
        "contextual_mentions": [{
            "kind": "npc",
            "ref_id": "npc-elder",
            "raw_label": "the village elder",
            "note": "The elder is bedridden and hard of hearing.",
            "source_refs": [{
                "source_id": "pdf:wire-source",
                "pdf_index": 3,
                "text_sha256": "a" * 64,
            }],
        }],
        "source_refs": [{
            "source_id": "pdf:wire-source",
            "pdf_index": 3,
            "text_sha256": "a" * 64,
        }],
        "disclosure": {
            "authority": "advisory",
            "hard_gate": False,
            "opening_teaser_is_not_delivery": True,
            "semantic_policy": "Use relevant revealable facts semantically.",
        },
    }
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


def test_mcp_wire_request_deepen_preserves_exact_current_dependency_lifecycle():
    server = _load_server()
    dependency_ref = {
        "operation": "turn.finalize",
        "subject": {"kind": "location", "id": "drixstead"},
        "decision_id": "turn-depart-drix-001",
    }
    wait = {
        "schema_version": 1,
        "contract_id": "coc.source-current-dependency-wait.v1",
        "campaign_id": "wire-current-dependency",
        "dependency_id": "dependency-drixstead",
        "job_id": "job-drixstead",
        "work_group_id": "group-drixstead",
        "dependency_ref": dependency_ref,
        "operational_class": "runnable",
        "dispatch_attempts": 0,
    }
    exact_task = {
        "schema_version": 1,
        "contract_id": "coc.pi-source-coordinator-task.v1",
        "instruction_ref": "/plugin/coc-source-coordinator.md",
        "model_policy": "inherit_parent",
        "packet": {
            "schema_version": 1,
            "packet_id": "source-current-dependency-drixstead",
            "campaign_id": "wire-current-dependency",
            "asset_root_id": "source-root",
            "claim_operation": {
                "operation": "progressive.claim_host_work",
                "prefilled_arguments": {
                    "current_dependency_claim": {
                        "campaign_id": "wire-current-dependency",
                        "dependency_id": "dependency-drixstead",
                        "job_id": "job-drixstead",
                        "dependency_ref": dependency_ref,
                    },
                },
            },
        },
    }
    dispatch = {
        **wait,
        "next_host_action": {
            "schema_version": 1,
            "action": "invoke_coc_dispatch_source_work",
            "task": exact_task,
            "parent_waits": False,
            "parent_result_polls": 0,
            "parent_output_retrieval": False,
        },
    }
    unrelated_waits = []
    unrelated_dispatches = []
    for index in range(6):
        unrelated_ref = {
            "operation": "scene.context",
            "subject": {"kind": "location", "id": f"other-{index}"},
            "decision_id": f"other-{index}",
        }
        unrelated_wait = {
            **wait,
            "dependency_id": f"dependency-other-{index}",
            "job_id": f"job-other-{index}",
            "work_group_id": f"group-other-{index}",
            "dependency_ref": unrelated_ref,
        }
        unrelated_waits.append(unrelated_wait)
        unrelated_dispatches.append({
            **unrelated_wait,
            "next_host_action": {
                **dispatch["next_host_action"],
                "task": {
                    **exact_task,
                    "packet": {
                        **exact_task["packet"],
                        "packet_id": f"source-other-{index}",
                        "result_contract": {
                            "description": "unrelated task detail " * 300,
                        },
                    },
                },
            },
        })
    repeated = "source request preview that must not displace control " * 500
    data = {
        "campaign_id": "wire-current-dependency",
        "asset_root_id": "source-root",
        "kind": "location",
        "target_id": "drixstead",
        "status": {"deep_ready": False, "preview": repeated},
        "current_dependency": True,
        "dependency_ref": dependency_ref,
        "host_work": {
            "asset_root_id": "source-root",
            "campaign_id": "wire-current-dependency",
            "current_dependency_snapshot_complete": True,
            "open_host_work_count": 2,
            "ready_for_background_count": 2,
            "blocking_micro_ready_count": 1,
            "ready_background_requests": [{
                "job_id": "job-ordinary",
                "kind": "deepen_location",
                "target_id": "other-location",
                "result_contract": {"description": repeated},
            }],
            "current_dependency_waits": [wait, *unrelated_waits],
            "current_dependency_dispatches": [
                dispatch,
                *unrelated_dispatches,
            ],
        },
    }
    envelope = {
        "ok": True,
        "tool": "progressive.request_deepen",
        "data": data,
        "warnings": [],
        "hints": [],
    }
    assert server.wire_projection.transport_bytes(envelope) > (
        server.wire_projection.MAX_INLINE_BYTES
    )
    projected = server.wire_projection.project_envelope(
        "progressive.request_deepen",
        envelope,
        contract_digest=server.CONTRACTS["content_sha256"],
        argument_schemas=server.INVOKE_ARGUMENT_SCHEMAS,
    )
    assert server.wire_projection.transport_bytes(projected) <= (
        server.wire_projection.MAX_INLINE_BYTES
    )
    assert projected["wire"]["payload_projected"] is True
    assert projected["wire"].get("identity_only") is not True
    host_work = projected["data"]["host_work"]
    assert host_work["current_dependency_snapshot_complete"] is True
    assert host_work["current_dependency_snapshot_scope"] == {
        "schema_version": 1,
        "contract_id": "coc.source-current-dependency-snapshot-scope.v1",
        "kind": "exact_dependency_ref",
        "campaign_id": "wire-current-dependency",
        "dependency_ref": dependency_ref,
    }
    assert host_work["current_dependency_waits"] == [wait]
    assert host_work["current_dependency_dispatches"] == [dispatch]
    assert host_work["current_dependency_dispatches"][0][
        "next_host_action"
    ]["task"] == exact_task
    assert "result_contract" not in host_work["ready_background_requests"][0]
    ordinary_projection = server.wire_projection._project_source_work_lifecycle(
        data["host_work"],
    )
    assert ordinary_projection["current_dependency_snapshot_complete"] is False
    assert ordinary_projection["current_dependency_projection_status"] == (
        "summary_only"
    )
    assert ordinary_projection["current_dependency_wait_count"] == 7
    assert ordinary_projection["current_dependency_dispatch_count"] == 7
    assert "current_dependency_waits" not in ordinary_projection
    assert "current_dependency_dispatches" not in ordinary_projection

    oversized = json.loads(json.dumps(envelope))
    oversized["data"]["host_work"]["current_dependency_dispatches"][0][
        "next_host_action"
    ]["task"]["packet"]["exact_control_bytes"] = "x" * 20_000
    blocked = server.wire_projection.project_envelope(
        "progressive.request_deepen",
        oversized,
        contract_digest=server.CONTRACTS["content_sha256"],
        argument_schemas=server.INVOKE_ARGUMENT_SCHEMAS,
    )
    assert server.wire_projection.transport_bytes(blocked) <= (
        server.wire_projection.MAX_INLINE_BYTES
    )
    assert blocked["wire"]["current_dependency_projection_blocked"] is True
    assert blocked["wire"].get("identity_only") is not True
    assert blocked["data"]["current_dependency_projection_blocker"][
        "status"
    ] == "blocked"
    assert blocked["data"]["host_work"]["current_dependency_waits"] == [{
        key: wait[key]
        for key in (
            "schema_version",
            "contract_id",
            "campaign_id",
            "dependency_id",
            "job_id",
            "dependency_ref",
            "operational_class",
        )
    }]
    assert blocked["data"]["host_work"][
        "current_dependency_dispatches"
    ] == []


def test_mcp_wire_request_deepen_keeps_takeovers_when_exceeding_budget():
    """Play03 regression: >16KB deepen with awaiting_scope must keep the
    locator/coordinator takeovers instead of collapsing to identity_only."""
    server = _load_server()
    dependency_ref = {
        "operation": "state.journal",
        "subject": {"kind": "npc", "id": "npc-syl-greybeard"},
        "decision_id": "journal-ask-village-anomalies-001",
    }
    wait = {
        "schema_version": 1,
        "contract_id": "coc.source-current-dependency-wait.v1",
        "campaign_id": "wire-deepen-takeover",
        "dependency_id": "dependency-greybeard",
        "job_id": "job-greybeard",
        "work_group_id": "group-greybeard",
        "dependency_ref": dependency_ref,
        "operational_class": "awaiting_scope",
        "dispatch_attempts": 0,
    }
    coordinator = server.toolbox._pi_source_coordinator_dispatch(
        workspace_root="/workspace",
        campaign_id="wire-deepen-takeover",
        asset_root_id="source-root",
        ready_background=[{
            "job_id": "job-other-ready",
            "work_group_id": "group-other",
        }],
    )
    background_takeover = {
        "schema_version": 1,
        "kind": "ready_background_source_work",
        "dispatch_mode": "coordinator_fanout",
        "host_adapter": "pi",
        "coordinator_dispatch": coordinator,
        "next_host_action": {
            "schema_version": 1,
            "action": "invoke_coc_dispatch_source_work",
            "execute_before_any_other_host_operation": True,
            "task": coordinator["pi_task"],
            "parent_waits": False,
            "parent_result_polls": 0,
            "parent_output_retrieval": False,
        },
        "authority": "advisory",
        "hard_gate": False,
    }
    locator_task = {
        "schema_version": 1,
        "contract_id": "coc.pi-source-scope-locator-task.v1",
        "instruction_ref": "/plugin/coc-source-scope-locator.md",
        "job_id": "job-greybeard",
        "target_id": "npc-syl-greybeard",
        "dispatch_key": "source-scope-locator:job-greybeard",
        "resolve_operation": {
            "operation": "progressive.resolve_source_scope",
            "invoke_via": "coc_invoke",
            "prefilled_arguments": {
                "job_id": "job-greybeard",
                "kind": "npc",
                "target_id": "npc-syl-greybeard",
            },
            "missing_arguments": ["pdf_indices"],
        },
    }
    source_scope_takeover = {
        "schema_version": 1,
        "kind": "awaiting_source_scope",
        "dispatch_mode": "background_single_locator",
        "host_adapter": "pi",
        "authority": "advisory",
        "hard_gate": False,
        "next_host_action": {
            "schema_version": 1,
            "action": "invoke_coc_dispatch_source_scope_locator",
            "dispatch_key": "source-scope-locator:job-greybeard",
            "spawn_once_while_job_open": True,
            "task": locator_task,
        },
        "play_boundary": {
            "player_action_gate": False,
            "narrative_gate": False,
            "output_gate": False,
        },
    }
    # The raw envelope must be well over budget like the play03 29KB result.
    repeated = "awaiting scope preview " * 600
    data = {
        "campaign_id": "wire-deepen-takeover",
        "asset_root_id": "source-root",
        "kind": "npc",
        "target_id": "npc-syl-greybeard",
        "current_dependency": True,
        "dependency_ref": dependency_ref,
        "status": {"deep_ready": False, "preview": repeated},
        "host_work": {
            "asset_root_id": "source-root",
            "campaign_id": "wire-deepen-takeover",
            "current_dependency_snapshot_complete": True,
            "open_host_work_count": 2,
            "awaiting_scope_count": 1,
            "current_dependency_waits": [wait],
            "current_dependency_dispatches": [],
            "source_scope_takeover": source_scope_takeover,
            "ready_background_requests": [{
                "job_id": "job-other-ready",
                "kind": "deepen_location",
                "target_id": "other",
                "result_contract": {"description": repeated},
            }],
        },
        "source_scope_takeover": source_scope_takeover,
        "background_takeover": background_takeover,
    }
    envelope = {
        "ok": True,
        "tool": "progressive.request_deepen",
        "data": data,
        "warnings": [],
        "hints": [],
    }
    assert server.wire_projection.transport_bytes(envelope) > (
        server.wire_projection.MAX_INLINE_BYTES
    )
    projected = server.wire_projection.project_envelope(
        "progressive.request_deepen",
        envelope,
        contract_digest=server.CONTRACTS["content_sha256"],
        argument_schemas=server.INVOKE_ARGUMENT_SCHEMAS,
    )
    assert server.wire_projection.transport_bytes(projected) <= (
        server.wire_projection.MAX_INLINE_BYTES
    )
    assert projected["wire"]["payload_projected"] is True
    assert projected["wire"].get("identity_only") is not True
    assert projected["wire"].get(
        "current_dependency_projection_blocked"
    ) is not True
    data_out = projected["data"]
    # The locator task must reach the extension dispatch hook.
    assert data_out["source_scope_takeover"]["next_host_action"]["action"] == (
        "invoke_coc_dispatch_source_scope_locator"
    )
    assert data_out["source_scope_takeover"]["next_host_action"][
        "task"
    ]["contract_id"] == "coc.pi-source-scope-locator-task.v1"
    # The coordinator task must survive via next_host_action.task; the
    # byte-identical pi_task duplicate under coordinator_dispatch is dropped.
    bg = data_out["background_takeover"]
    assert bg["next_host_action"]["task"]["contract_id"] == (
        "coc.pi-source-coordinator-task.v1"
    )
    assert "coordinator_dispatch" not in bg
    # Exact current-dependency waits survive.
    host_work = data_out["host_work"]
    assert host_work["current_dependency_waits"] == [wait]
    assert "source_scope_takeover" not in host_work

    # The Codex coordinator shape (codex_task, no next_host_action) must not
    # be deduplicated away: it is the only carrier on that host.
    codex_coordinator = server.toolbox._source_coordinator_dispatch(
        workspace_root="/workspace",
        campaign_id="wire-deepen-takeover",
        asset_root_id="source-root",
        ready_background=[{
            "job_id": "job-codex",
            "work_group_id": "group-codex",
        }],
    )
    codex_takeover = {
        "schema_version": 1,
        "kind": "ready_background_source_work",
        "dispatch_mode": "coordinator_fanout",
        "host_adapter": "codex",
        "coordinator_dispatch": codex_coordinator,
        "authority": "advisory",
        "hard_gate": False,
    }
    codex_data = {
        **data,
        "background_takeover": codex_takeover,
    }
    codex_env = {"ok": True, "tool": "progressive.request_deepen",
                 "data": codex_data, "warnings": [], "hints": []}
    codex_projected = server.wire_projection.project_envelope(
        "progressive.request_deepen",
        codex_env,
        contract_digest=server.CONTRACTS["content_sha256"],
        argument_schemas=server.INVOKE_ARGUMENT_SCHEMAS,
    )
    codex_bg = codex_projected["data"]["background_takeover"]
    assert "coordinator_dispatch" in codex_bg
    assert codex_bg["coordinator_dispatch"]["codex_task"]["packet"][
        "claim_operation"
    ]["discovery_required"] is False


def test_mcp_wire_register_source_bundle_keeps_takeover_when_exceeding_budget():
    server = _load_server()
    coordinator = server.toolbox._pi_source_coordinator_dispatch(
        workspace_root="/workspace",
        campaign_id="wire-register",
        asset_root_id="source-root",
        ready_background=[{
            "job_id": "job-ready",
            "work_group_id": "group-ready",
        }],
    )
    background_takeover = {
        "schema_version": 1,
        "kind": "ready_background_source_work",
        "dispatch_mode": "coordinator_fanout",
        "host_adapter": "pi",
        "coordinator_dispatch": coordinator,
        "next_host_action": {
            "schema_version": 1,
            "action": "invoke_coc_dispatch_source_work",
            "task": coordinator["pi_task"],
            "parent_waits": False,
            "parent_result_polls": 0,
            "parent_output_retrieval": False,
        },
        "authority": "advisory",
        "hard_gate": False,
    }
    repeated = "reviewed page metadata " * 500
    data = {
        "asset_root_id": "source-root",
        "requested_asset_root_id": "source-root",
        "reused_existing_root": True,
        "bundle_sha256": "cf2a825de4b2ff5378bef2d5441bc2288d6261297f02f27843a05a4c595a33d9",
        "cached_pdf_indices": [2, 4],
        "page_revisions": [{"pdf_index": 2, "text_sha256": "a" * 64}],
        "new_page_count": 0,
        "reused_page_count": 2,
        "bundle_validation_and_cache_ms": 6,
        "host_work": {
            "asset_root_id": "source-root",
            "campaign_id": "wire-register",
            "current_dependency_snapshot_complete": True,
            "open_host_work_count": 3,
            "current_dependency_waits": [],
            "open_host_work": [{"job_id": "job-a", "detail": repeated}],
            "background_takeover": background_takeover,
        },
        "background_takeover": background_takeover,
    }
    envelope = {
        "ok": True,
        "tool": "progressive.register_source_bundle",
        "data": data,
        "warnings": [],
        "hints": [],
    }
    assert server.wire_projection.transport_bytes(envelope) > (
        server.wire_projection.MAX_INLINE_BYTES
    )
    projected = server.wire_projection.project_envelope(
        "progressive.register_source_bundle",
        envelope,
        contract_digest=server.CONTRACTS["content_sha256"],
        argument_schemas=server.INVOKE_ARGUMENT_SCHEMAS,
    )
    assert server.wire_projection.transport_bytes(projected) <= (
        server.wire_projection.MAX_INLINE_BYTES
    )
    assert projected["wire"].get("identity_only") is not True
    data_out = projected["data"]
    assert data_out["bundle_sha256"] == data["bundle_sha256"]
    assert data_out["cached_pdf_indices"] == [2, 4]
    bg = data_out["background_takeover"]
    assert bg["next_host_action"]["task"]["contract_id"] == (
        "coc.pi-source-coordinator-task.v1"
    )
    assert "coordinator_dispatch" not in bg
    assert "background_takeover" not in data_out["host_work"]


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


def test_mcp_wire_claim_keeps_two_coalesced_three_page_body_requests_actionable():
    server = _load_server()
    worker = server.toolbox.coc_module_project._load_sibling(
        "coc_module_queue_worker_mcp_claim_projection",
        "coc_module_queue_worker.py",
    )
    contract = worker._body_location_result_contract(parse_state="deep")
    refs = [{
        "source_id": "pdf:claim-projection",
        "pdf_index": index,
        "path": f"/tmp/coc-claim-projection/page-{index:04d}.md",
        "text_sha256": f"{index + 1:x}" * 64,
    } for index in range(3)]
    scope = {
        "source_id": "pdf:claim-projection",
        "file_sha256": "a" * 64,
        "pdf_indices": [0, 1, 2],
    }
    instruction = (
        "Host PDF skill: read exactly the three accepted cached page refs for "
        "this bounded location body; follow the closed result contract, copy "
        "its fixed/request/default fields, use canonical row templates, and "
        "return the direct location pack without aliases or repair. "
    ) * 9
    requests = [{
        "job_id": f"job-{target}",
        "kind": "deepen_location",
        "target_id": target,
        "priority": 50,
        "reason": "coalesced accepted three-page location body",
        "instruction": instruction,
        "requested_pdf_indices": [0, 1, 2],
        "cached_page_refs": refs,
        "cached_scope_complete": True,
        "batch_subjects": [],
        "request_purpose": "deep_location_body",
        "requested_source_scope": scope,
        "source_scope_signature": "sha256:" + "b" * 64,
        "result_contract": contract,
        "work_level": "near_term",
        "consumer_refs": [],
        "consumer_state": {},
    } for target in ("cellar", "annex")]
    task = {
        "schema_version": 1,
        "contract_id": "coc.pi-source-pack-task.v1",
        "instruction_ref": str(
            (PLUGIN_ROOT / "agents" / "coc-source-pack-worker.md").resolve()
        ),
        "model_policy": "inherit_parent",
        "packet": {
            "schema_version": 1,
            "contract_id": "coc.source-pack-worker.v1",
            "packet_id": "source-lease-coalesced",
            "asset_root_id": "source-root",
            "work_group_id": "source-work-coalesced",
            "source_id": "pdf:claim-projection",
            "file_sha256": "a" * 64,
            "requested_pdf_indices": [0, 1, 2],
            "cached_scope_complete": True,
            "requests": requests,
        },
    }
    envelope = {
        "ok": True,
        "tool": "progressive.claim_host_work",
        "data": {
            "leased_group_count": 1,
            "ready_group_count": 1,
            "cached_only": True,
            "dispatch_tasks": [task],
            "dispatch_task_count": 1,
        },
        "warnings": [],
        "hints": [],
    }
    assert server.wire_projection.transport_bytes(envelope) > (
        server.wire_projection.MAX_INLINE_BYTES
    )

    projected = server.wire_projection.project_envelope(
        "progressive.claim_host_work",
        envelope,
        contract_digest=server.CONTRACTS["content_sha256"],
        argument_schemas=server.INVOKE_ARGUMENT_SCHEMAS,
    )

    assert server.wire_projection.transport_bytes(projected) <= (
        server.wire_projection.MAX_INLINE_BYTES
    )
    assert projected["wire"]["claim_dispatch_deduplicated"] is True
    assert projected["wire"].get("identity_only") is not True
    assert projected["data"].get("wire_projection_failed") is not True
    assert projected["data"]["lease_bindings"] == [{
        "lease_id": "source-lease-coalesced",
        "job_ids": ["job-cellar", "job-annex"],
    }]
    [projected_task] = projected["data"]["dispatch_tasks"]
    packet = projected_task["packet"]
    assert len(packet["requests"]) == 2
    assert len(packet["wire_result_contracts"]) == 1
    assert all(
        "result_contract" not in request
        and request["result_contract_ref"] in packet["wire_result_contracts"]
        for request in packet["requests"]
    )


def test_mcp_wire_claim_keeps_single_large_foreground_contract_actionable():
    server = _load_server()
    source_worker = json.loads(
        (
            PLUGIN_ROOT / "references" / "source-pack-worker-v1.json"
        ).read_text(encoding="utf-8")
    )
    contract = source_worker["packet"]["foreground_opening_slice"][
        "result_contract"
    ]
    contract_ref = server.wire_projection.canonical_digest(contract)
    refs = [{
        "source_id": "pdf:fix3-opening",
        "pdf_index": index,
        "path": f"/tmp/fix3-opening/page-{index:04d}.md",
        "text_sha256": f"{index + 1:x}" * 64,
    } for index in (3, 4, 5)]
    request = {
        "job_id": "job-fix3-opening",
        "kind": "partial_opening",
        "target_id": "sherborne-castle",
        "instruction": "bounded foreground opening compilation " * 200,
        "requested_pdf_indices": [3, 4, 5],
        "cached_page_refs": refs,
        "cached_scope_complete": True,
        "request_purpose": "foreground_opening_slice",
        "result_contract": contract,
    }
    task = {
        "schema_version": 1,
        "contract_id": "coc.pi-source-pack-task.v1",
        "instruction_ref": str(
            (PLUGIN_ROOT / "agents" / "coc-source-pack-worker.md").resolve()
        ),
        "model_policy": "inherit_parent",
        "packet": {
            "schema_version": 1,
            "contract_id": "coc.source-pack-worker.v1",
            "packet_id": "source-lease-fix3-opening",
            "work_group_id": "source-work-fix3-opening",
            "requests": [request],
        },
    }
    envelope = {
        "ok": True,
        "tool": "progressive.claim_host_work",
        "data": {
            "leased_group_count": 1,
            "ready_group_count": 1,
            "cached_only": True,
            "dispatch_tasks": [task],
            "dispatch_task_count": 1,
        },
        "warnings": [],
        "hints": [],
    }
    assert server.wire_projection.transport_bytes(envelope) > (
        server.wire_projection.MAX_INLINE_BYTES
    )

    projected = server.wire_projection.project_envelope(
        "progressive.claim_host_work",
        envelope,
        contract_digest=server.CONTRACTS["content_sha256"],
        argument_schemas=server.INVOKE_ARGUMENT_SCHEMAS,
    )

    assert server.wire_projection.transport_bytes(projected) <= (
        server.wire_projection.MAX_INLINE_BYTES
    )
    assert projected["data"].get("wire_projection_failed") is not True
    assert projected["data"]["lease_bindings"] == [{
        "lease_id": "source-lease-fix3-opening",
        "job_ids": ["job-fix3-opening"],
    }]
    [projected_task] = projected["data"]["dispatch_tasks"]
    [projected_request] = projected_task["packet"]["requests"]
    assert "result_contract" not in projected_request
    assert projected_request["result_contract_ref"] == contract_ref
    assert "wire_result_contracts" not in projected_task["packet"]


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
        "turn_sequence", "actions.advise", "state.journal", "turn.output_context",
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
        "turn_sequence", "actions.advise", "state.journal", "turn.output_context",
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


def test_mcp_wire_scene_source_material_is_bounded_and_whitelisted():
    server = _load_server()
    long_text = "source context " * 600
    material = {
        "schema_version": 1,
        "keeper_only": True,
        "authority": "source_authored_context",
        "player_safe_summary": long_text,
        "contextual_mentions": [
            {
                "kind": "npc",
                "ref_id": f"npc-{index}",
                "note": long_text,
                "source_refs": [
                    {
                        "source_id": "pdf:bounded-source",
                        "pdf_index": ref_index,
                        "text_sha256": f"{ref_index:064x}",
                        "review_metadata": long_text,
                    }
                    for ref_index in range(6)
                ],
                "keeper_secret": long_text,
            }
            for index in range(12)
        ],
        "source_refs": [
            {
                "source_id": "pdf:bounded-source",
                "pdf_index": index,
                "text_sha256": f"{index:064x}",
                "grep_anchors": [long_text],
            }
            for index in range(12)
        ],
        "disclosure": {
            "authority": "advisory",
            "hard_gate": False,
            "opening_teaser_is_not_delivery": True,
            "semantic_policy": long_text,
            "secret_policy": long_text,
        },
        "keeper_secret_refs": [{"id": "secret-do-not-forward", "body": long_text}],
    }

    compact = server.wire_projection._compact_scene(
        {
            "campaign_id": "bounded-source-material",
            "active_scene_id": "opening",
            "scene": {"scene_type": "social"},
            "source_material": material,
            "npcs_present": [],
            "clues_here": [],
            "action_routes": [],
            "exits": [],
        },
        tight=True,
    )

    projected = compact["source_material"]
    assert len(projected["player_safe_summary"].encode("utf-8")) <= (
        server.wire_projection.SOURCE_MATERIAL_SUMMARY_BYTE_LIMIT
    )
    assert 0 < len(projected["contextual_mentions"]) <= (
        server.wire_projection.SOURCE_MATERIAL_MENTION_LIMIT
    )
    assert all(
        len(row["note"].encode("utf-8"))
        <= server.wire_projection.SOURCE_MATERIAL_NOTE_BYTE_LIMIT
        for row in projected["contextual_mentions"]
    )
    assert all(
        len(row["source_refs"])
        <= server.wire_projection.SOURCE_MATERIAL_MENTION_REF_LIMIT
        for row in projected["contextual_mentions"]
    )
    assert 0 < len(projected["source_refs"]) <= (
        server.wire_projection.SOURCE_MATERIAL_SCENE_REF_LIMIT
    )
    assert projected["source_refs"][0] == {
        "source_id": "pdf:bounded-source",
        "pdf_index": 0,
        "text_sha256": "0" * 64,
    }
    assert projected["disclosure"]["hard_gate"] is False
    assert projected["projection"]["omitted_contextual_mention_count"] == (
        12 - len(projected["contextual_mentions"])
    )
    emitted_refs = len(projected["source_refs"]) + sum(
        len(row.get("source_refs") or [])
        for row in projected["contextual_mentions"]
    )
    assert projected["projection"]["omitted_source_ref_count"] == (
        84 - emitted_refs
    )
    assert projected["projection"]["trimmed_text_field_count"] > 0
    assert server.wire_projection.transport_bytes(projected) <= (
        server.wire_projection.SOURCE_MATERIAL_MAX_BYTES
    )
    rendered = json.dumps(projected, ensure_ascii=False)
    assert "keeper_secret" not in rendered
    assert "keeper_secret_refs" not in rendered
    assert "review_metadata" not in rendered
    assert "grep_anchors" not in rendered
    assert "secret_policy" not in rendered
    assert server.wire_projection.transport_bytes(compact) <= (
        server.wire_projection.MAX_INLINE_BYTES
    )
    unlabeled = server.wire_projection._compact_scene(
        {
            "campaign_id": "unlabeled-source-material",
            "source_material": {
                "player_safe_summary": "This must not cross the wire.",
                "contextual_mentions": material["contextual_mentions"],
            },
        },
        tight=True,
    )
    assert "source_material" not in unlabeled


def test_mcp_wire_scene_source_material_drops_malformed_exact_refs():
    server = _load_server()
    valid = {
        "source_id": "pdf:valid-source",
        "pdf_index": 0,
        "text_sha256": "a" * 64,
    }
    malformed = [
        {**valid, "source_id": ""},
        {**valid, "source_id": " "},
        {**valid, "source_id": "pdf:bad/source"},
        {**valid, "source_id": "p" * 129},
        {**valid, "pdf_index": True},
        {**valid, "pdf_index": -1},
        {**valid, "text_sha256": "abc"},
        {**valid, "text_sha256": "g" * 64},
        {**valid, "text_sha256": "A" * 64},
    ]
    projected = server.wire_projection._compact_source_material({
        "keeper_only": True,
        "source_refs": [valid, *malformed],
        "contextual_mentions": [{
            "kind": "npc",
            "ref_id": "npc-valid",
            "note": "A source-bound fact.",
            "source_refs": [
                {**valid, "pdf_index": 1, "text_sha256": "b" * 64},
                {**valid, "pdf_index": False},
            ],
        }],
        "disclosure": {"authority": "advisory", "hard_gate": False},
    })

    assert projected["source_refs"] == [valid]
    assert projected["contextual_mentions"][0]["source_refs"] == [{
        **valid,
        "pdf_index": 1,
        "text_sha256": "b" * 64,
    }]
    assert projected["projection"]["omitted_source_ref_count"] == (
        len(malformed) + 1
    )
    rendered = json.dumps(projected, ensure_ascii=False)
    assert '"source_id": " "' not in rendered
    assert '"text_sha256": "abc"' not in rendered
    assert '"text_sha256": "' + ("g" * 64) + '"' not in rendered


def test_mcp_wire_scene_collective_source_budget_survives_recovery():
    server = _load_server()
    source_id = "p" + ("s" * 127)
    material = {
        "schema_version": 1,
        "keeper_only": True,
        "authority": "source_authored_context",
        "player_safe_summary": "源" * (
            server.wire_projection.SOURCE_MATERIAL_SUMMARY_BYTE_LIMIT
        ),
        "contextual_mentions": [
            {
                "kind": "类" * 256,
                "ref_id": "引" * 256,
                "name": "名" * 256,
                "raw_label": "称" * 256,
                "note": "注" * (
                    server.wire_projection.SOURCE_MATERIAL_NOTE_BYTE_LIMIT
                ),
                "source_refs": [
                    {
                        "source_id": source_id,
                        "pdf_index": (mention_index * 10) + ref_index,
                        "text_sha256": f"{ref_index + 1:064x}",
                    }
                    for ref_index in range(
                        server.wire_projection.SOURCE_MATERIAL_MENTION_REF_LIMIT
                    )
                ],
            }
            for mention_index in range(
                server.wire_projection.SOURCE_MATERIAL_MENTION_LIMIT
            )
        ],
        "source_refs": [
            {
                "source_id": source_id,
                "pdf_index": index,
                "text_sha256": f"{index + 1:064x}",
            }
            for index in range(
                server.wire_projection.SOURCE_MATERIAL_SCENE_REF_LIMIT
            )
        ],
        "disclosure": {
            "authority": "advisory",
            "hard_gate": False,
            "opening_teaser_is_not_delivery": True,
            "semantic_policy": "策" * (
                server.wire_projection.SOURCE_MATERIAL_POLICY_BYTE_LIMIT
            ),
        },
    }
    assert server.wire_projection.transport_bytes(material) > 24_000
    scene_data = {
        "campaign_id": "collective-source-budget",
        "active_scene_id": "opening",
        "scene": {"scene_type": "investigation"},
        "source_material": material,
        "npcs_present": [{
            "npc_id": f"npc-{index}",
            "name": f"NPC {index}",
            "agenda": "dense continuity " * 32,
            "voice": "bounded voice " * 24,
            "relationship_to_investigators": "unknown",
        } for index in range(20)],
        "action_routes": [{
            "route_id": f"route-{index}",
            "route_type": "investigative_lead",
            "resolution_kind": "direct_delivery",
            "grants_clue_ids": [f"clue-{index}"],
            "cue": "authored route detail " * 32,
        } for index in range(20)],
        "clues_here": [{
            "clue_id": f"clue-{index}",
            "discovered": False,
            "delivery_kind": "obvious",
            "player_safe_summary": "clue detail " * 32,
        } for index in range(30)],
        "exits": [{
            "to": f"scene-{index}",
            "kind": "travel",
            "open": True,
            "cue": "exit detail " * 32,
        } for index in range(30)],
    }
    first = server.wire_projection._compact_scene(scene_data, tight=True)
    first_material = first["source_material"]
    first_metadata = first_material["projection"]
    assert server.wire_projection.transport_bytes(first_material) <= (
        server.wire_projection.SOURCE_MATERIAL_MAX_BYTES
    )
    assert server.wire_projection.transport_bytes(first) > (
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

    assert server.wire_projection.transport_bytes(projected) <= (
        server.wire_projection.MAX_INLINE_BYTES
    )
    assert projected["wire"]["scene_recovery_index_projection"] is True
    assert projected["wire"].get("identity_only") is not True
    recovered = projected["data"]["source_material"]
    assert server.wire_projection.transport_bytes(recovered) <= (
        server.wire_projection.SOURCE_MATERIAL_MAX_BYTES
    )
    assert recovered["player_safe_summary"]
    assert recovered["disclosure"]["hard_gate"] is False
    assert recovered["source_refs"][0] == {
        "source_id": source_id,
        "pdf_index": 0,
        "text_sha256": "1".rjust(64, "0"),
    }
    assert recovered == first_material
    assert recovered["projection"] == first_metadata
    assert recovered["projection"]["full_source_material_sha256"] == (
        server.wire_projection.canonical_digest(material)
    )
    assert recovered["projection"]["omitted_contextual_mention_count"] > 0
    assert recovered["projection"]["omitted_source_ref_count"] > 0


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


def test_mcp_wire_locator_task_envelope_passes_through_verbatim():
    """Deepen playtest schema-drift regression.

    The locator task's nested ``resolve_operation`` is a closed machine card
    consumed with exactKeys by the Pi extension.  ``_decorate_cards`` must not
    add contract_ref/discovery_required to it; that drift produced the
    ``source_scope_locator_task_invalid`` dispatch block in the deepen
    playtest (8-key card vs 6-key exactKeys).
    """
    server = _load_server()
    task = {
        "schema_version": 1,
        "contract_id": "coc.pi-source-scope-locator-task.v1",
        "bootstrap_instruction": "closed",
        "instruction_ref": "/plugin/coc-source-scope-locator.md",
        "contract_ref": "/plugin/source-scope-locator-v1.json",
        "contract_revision": "sha256:" + "a" * 64,
        "adapter_mode": "pi_external_pdf_skill_lifecycle",
        "model_policy": "pinned_xai_grok_4_5_thinking_low",
        "workspace_root": "/workspace",
        "campaign_id": "wire-locator",
        "asset_root_id": "source-root",
        "job_id": "job-locator",
        "job_kind": "deepen_location",
        "kind": "location",
        "target_id": "archive",
        "target_label": "Archive",
        "reason": "arrival",
        "source": {
            "path": "/workspace/module.pdf",
            "source_id": "pdf:wire-locator",
            "title": "Wire Locator",
            "file_sha256": "b" * 64,
        },
        "source_bundle_path": "/workspace/.tmp/coc-source-scope/wire-locator/job-locator/contract",
        "cached_pdf_indices": [1, 2, 3, 4],
        "max_selected_pages": 3,
        "pdf_index_caliber": "printed_page_number_1_based",
        "source_bundle_manifest_contract": {
            "schema_version": 1,
            "producer": "codex-pdf-skill",
            "source_required": [
                "source_id", "title", "path", "file_sha256", "page_count",
            ],
            "page_required": [
                "pdf_index", "markdown_path", "text_sha256",
                "review_state", "parse_confidence", "grep_anchors",
            ],
            "review_state": "manual_accepted",
            "parse_confidence": "number_from_0_through_1",
            "text_sha256": "sha256_of_exact_markdown_file_bytes",
            "assets": [],
        },
        "resolve_operation": {
            "operation": "progressive.resolve_source_scope",
            "invoke_via": "coc_invoke",
            "prefilled_arguments": {
                "job_id": "job-locator",
                "kind": "location",
                "target_id": "archive",
            },
            "missing_arguments": [
                "pdf_indices",
                "source_bundle_path_if_any_selected_page_is_uncached",
            ],
            "authority": "source_scope_only",
            "hard_gate": False,
        },
        "result_delivery": "natural_completion_notification_only",
    }
    envelope = {
        "ok": True,
        "tool": "progressive.status",
        "data": {
            "source_scope_takeover": {
                "schema_version": 1,
                "kind": "awaiting_source_scope",
                "next_host_action": {
                    "action": "invoke_coc_dispatch_source_scope_locator",
                    "task": task,
                },
            },
        },
        "warnings": [],
        "hints": [],
    }
    projected = server.wire_projection.project_envelope(
        "progressive.status",
        envelope,
        contract_digest=server.CONTRACTS["content_sha256"],
    )
    returned_task = projected["data"]["source_scope_takeover"][
        "next_host_action"
    ]["task"]
    resolve_operation = returned_task["resolve_operation"]
    assert set(resolve_operation) == {
        "operation", "invoke_via", "prefilled_arguments",
        "missing_arguments", "authority", "hard_gate",
    }, resolve_operation
    assert "contract_ref" not in resolve_operation
    assert "discovery_required" not in resolve_operation
    assert returned_task["pdf_index_caliber"] == "printed_page_number_1_based"
    # KP-facing cards still get the discovery decoration elsewhere.
    # The locator envelope itself remains byte-identical.
    assert returned_task == task
