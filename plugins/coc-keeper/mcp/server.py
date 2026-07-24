#!/usr/bin/env python3
"""Small stdio MCP transport for the canonical COC Keeper toolbox.

The server deliberately contains no rules, state, or narrative decisions. It
adapts MCP calls to the existing ``coc_toolbox`` registry so Cursor, Grok,
Kimi, and ZCode consume the same operations and envelopes as Codex and the headless
runtime.

Progressive discovery: ``tools/list`` exposes only meta tools plus a small
hotset. Full operation contracts live in a committed hash-bound archive and are
returned on demand via ``coc_discover``; long-tail execution goes through
``coc_invoke`` (or a still-compatible hidden direct call) into the same
``toolbox.run_tool`` gateway.
"""
from __future__ import annotations

from copy import deepcopy
from contextlib import contextmanager
import importlib.util
import json
import os
from pathlib import Path
import sys
from typing import Any


PLUGIN_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_ROOT = PLUGIN_ROOT / "scripts"
CAPABILITIES_PATH = PLUGIN_ROOT / "references" / "host-capabilities.json"
CONTRACT_ARCHIVE_PATH = (
    PLUGIN_ROOT / "references" / "mcp-operation-contracts.json"
)


def _load_module(module_name: str, path: Path):
    existing = sys.modules.get(module_name)
    if existing is not None:
        return existing
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"unable to load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def _load_toolbox():
    return _load_module("coc_toolbox_mcp", SCRIPTS_ROOT / "coc_toolbox.py")


def _load_contract_archive_module():
    return _load_module(
        "coc_mcp_contract_archive_mcp",
        SCRIPTS_ROOT / "coc_mcp_contract_archive.py",
    )


def _load_wire_projection_module():
    return _load_module(
        "coc_mcp_wire_mcp",
        SCRIPTS_ROOT / "coc_mcp_wire.py",
    )


toolbox = _load_toolbox()
contract_archive = _load_contract_archive_module()
wire_projection = _load_wire_projection_module()

try:
    CONTRACTS = contract_archive.load_and_validate(CONTRACT_ARCHIVE_PATH, toolbox)
except contract_archive.ContractArchiveError as exc:
    raise RuntimeError(
        f"MCP progressive-discovery contract archive failed validation "
        f"({exc.code}): {exc}"
    ) from exc

MCP_LISTED_HOTSET: tuple[str, ...] = tuple(contract_archive.MCP_LISTED_HOTSET)
SOURCE_SUBMIT_PROFILE = "source-submit"
SOURCE_SUBMIT_TOOL = "submit_source_result"
SOURCE_RESULT_CONTRACT = "coc.source-pack-worker.v1"


def _invoke_arguments_schema(operation: str) -> dict[str, Any]:
    """Project a direct MCP schema into ``coc_invoke.arguments`` shape."""
    schema = deepcopy(CONTRACTS["operations"][operation]["inputSchema"])
    properties = schema.get("properties")
    if isinstance(properties, dict):
        properties.pop("root", None)
        properties.pop("campaign", None)
    required = schema.get("required")
    if isinstance(required, list):
        schema["required"] = [
            field for field in required if field not in {"root", "campaign"}
        ]
    return schema


INVOKE_ARGUMENT_SCHEMAS: dict[str, dict[str, Any]] = {
    operation: _invoke_arguments_schema(operation)
    for operation in CONTRACTS["operations"]
}


def _invoke_card(
    operation: str,
    *,
    prefilled_arguments: dict[str, Any] | None = None,
    missing_arguments: list[str] | None = None,
) -> dict[str, Any]:
    contract_suffix = CONTRACTS["content_sha256"].removeprefix("sha256:")[:16]
    schema = deepcopy(INVOKE_ARGUMENT_SCHEMAS[operation])
    return {
        "operation": operation,
        "invoke_via": "coc_invoke",
        "prefilled_arguments": deepcopy(prefilled_arguments or {}),
        "missing_arguments": list(
            schema.get("required", [])
            if missing_arguments is None
            else missing_arguments
        ),
        "arguments_schema": schema,
        "contract_ref": f"{operation}@{contract_suffix}",
        "discovery_required": False,
    }

_GROK_TO_CANONICAL = {
    operation.replace(".", "_"): operation for operation in toolbox.TOOLS
}
if len(_GROK_TO_CANONICAL) != len(toolbox.TOOLS):
    raise RuntimeError("canonical toolbox operations collide under Grok MCP naming")


# A host starts a new MCP server process when it starts a genuinely new coding
# session.  Keep a tiny process-local gate as the baseline restart signal so a
# host that delays or suppresses plugin lifecycle hooks still cannot read or
# mutate campaign state before rehydrating it.  Durable truth remains in the
# campaign checkpoint; this variable only remembers which campaign this one
# disposable transport process has acknowledged.
_PROCESS_ACTIVE_CAMPAIGN: tuple[str, str] | None = None
_PROCESS_HOST_SESSION_ID: str | None = None


@contextmanager
def _host_session_binding(session_id: str | None):
    """Expose the exact host session while the canonical toolbox runs.

    The stdio server is single-request-at-a-time.  A temporary environment
    bridge lets the shared host-context module resolve the correct marker
    without introducing a host-specific parameter into every operation.
    """
    prior = os.environ.get("COC_HOST_SESSION_ID")
    if session_id:
        os.environ["COC_HOST_SESSION_ID"] = session_id
    try:
        yield
    finally:
        if prior is None:
            os.environ.pop("COC_HOST_SESSION_ID", None)
        else:
            os.environ["COC_HOST_SESSION_ID"] = prior


def _mcp_tool_name(operation: str) -> str:
    """Expose canonical dotted operations through a Grok-valid MCP name."""
    if _host_name() == "grok":
        return operation.replace(".", "_")
    return operation


def _canonical_tool_name(name: str) -> str:
    if name in toolbox.TOOLS:
        return name
    if _host_name() == "grok":
        operation = _GROK_TO_CANONICAL.get(name)
        if operation is not None:
            return operation
    return name


def _json_schema(spec: dict[str, Any]) -> dict[str, Any]:
    """Translate the toolbox's compact parameter metadata to JSON Schema."""
    return contract_archive.json_schema(spec)


def _tool_schema(name: str, spec: dict[str, Any]) -> dict[str, Any]:
    """Build a live MCP tool schema (used by tests and hotset materialization)."""
    contract = contract_archive.contract_for_operation(name, spec)
    return contract_archive.mcp_tool_from_contract(
        contract, mcp_name=_mcp_tool_name(name)
    )


def _archived_tool_schema(operation: str) -> dict[str, Any]:
    contract = CONTRACTS["operations"][operation]
    return contract_archive.mcp_tool_from_contract(
        contract, mcp_name=_mcp_tool_name(operation)
    )


def _host_name() -> str:
    return os.environ.get("COC_HOST", "unknown").strip() or "unknown"


def _mcp_profile() -> str:
    return os.environ.get("COC_MCP_PROFILE", "keeper").strip() or "keeper"


def _default_root() -> Path:
    value = (
        os.environ.get("COC_PROJECT_ROOT")
        or os.environ.get("GROK_WORKSPACE_ROOT")
        or os.environ.get("CLAUDE_PROJECT_DIR")
        or os.environ.get("ZCODE_PROJECT_DIR")
        or os.getcwd()
    )
    return Path(value).expanduser().resolve()


def _implicit_root_is_plugin_storage(root: Path) -> bool:
    """Reject the managed plugin package as implicit campaign storage."""
    return root == PLUGIN_ROOT or PLUGIN_ROOT in root.parents


def _capabilities() -> dict[str, Any]:
    try:
        data = json.loads(CAPABILITIES_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        data = {}
    contract_suffix = CONTRACTS["content_sha256"].removeprefix("sha256:")[:16]

    def setup_card(
        operation: str,
        *,
        missing_arguments: list[str],
        optional_arguments: list[str] | None = None,
    ) -> dict[str, Any]:
        card = _invoke_card(
            operation,
            missing_arguments=missing_arguments,
        )
        card["optional_arguments"] = list(optional_arguments or [])
        return card

    host = _host_name()
    capabilities = data.get(host, data.get("default", {}))
    cold_start: dict[str, Any] = {
        "empty_or_unknown_workspace": setup_card(
            "setup.inspect",
            missing_arguments=[],
        ),
        "built_in_quick_start": setup_card(
            "setup.quick_start",
            missing_arguments=["scenario_id", "pregen_id"],
            optional_arguments=["campaign_id", "title"],
        ),
        "custom_campaign_setup": setup_card(
            "setup.invoke",
            missing_arguments=["kind", "payload"],
        ),
        "campaign_resume": {
            "operation": "session.resume",
            "invoke_via": "coc_invoke",
            "prefilled_arguments": {},
            "missing_arguments": ["campaign"],
            "contract_ref": f"session.resume@{contract_suffix}",
            "discovery_required": False,
        },
    }
    if capabilities.get("coc_opening_source_coordinator_v1") is True:
        codex_root = Path(os.environ.get("CODEX_HOME", Path.home() / ".codex"))
        cold_start["opening_source_coordinator"] = {
            "copy_task_static_verbatim": True,
            "task_variable_fields": [
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
            ],
            "pdf_identity_before_dispatch": {
                "required": True,
                "fields": ["pdf_path", "pdf_sha256"],
                "page_or_title_read_by_main_keeper": False,
            },
            "task_static": {
                "schema_version": 1,
                "contract_id": "coc.codex-opening-source-task.v1",
                "bootstrap_instruction": (
                    "Before any response or tool call, read instruction_ref "
                    "completely, then execute this closed task under that "
                    "instruction."
                ),
                "instruction_ref": os.fspath(
                    PLUGIN_ROOT / "agents" / "coc-opening-source-coordinator.md"
                ),
                "contract_ref": os.fspath(
                    PLUGIN_ROOT / "references" / "opening-source-coordinator-v1.json"
                ),
                "adapter_mode": "codex_context_free_inline_source",
                "model_policy": "inherit_parent",
                "max_selected_opening_pages": 3,
                "instruction_refs": {
                    "pdf_skill": os.fspath(codex_root / "skills" / "pdf" / "SKILL.md"),
                },
                "result_delivery": "task_return_to_parent",
            },
        }

    return {
        "host": host,
        "capabilities": capabilities,
        "source": "plugins/coc-keeper/references/host-capabilities.json",
        "mcp_wire": {
            "profile": wire_projection.PROFILE_ID,
            "max_inline_bytes": wire_projection.MAX_INLINE_BYTES,
            "contract_archive_sha256": CONTRACTS["content_sha256"],
            "progressive_discovery": True,
            "tool_surface": (
                "gateway_only_v1" if host == "grok" else "hotset_v1"
            ),
            "gateway_tools": [
                "coc_capabilities", "coc_discover", "coc_invoke",
            ],
            "transport_contract": {
                "root": (
                    "pass the current host workspace absolute path on every "
                    "coc_invoke call"
                ),
                "campaign": (
                    "pass the active campaign id on every campaign-bound "
                    "coc_invoke call"
                ),
            },
        },
        "cold_start": cold_start,
    }


def _discover(
    operation: str | None = None,
    domain: str | None = None,
    since_content_sha256: str | None = None,
) -> dict[str, Any]:
    # The archive is hash-bound and immutable at runtime. If the caller
    # passes the content_sha256 it received last time and it still matches,
    # return not_modified — saving the full schema/catalog from re-entering
    # the LLM context (the #1 token consumer: ~16k tokens/run).
    if (
        since_content_sha256 is not None
        and since_content_sha256 == CONTRACTS.get("content_sha256")
    ):
        return {
            "ok": True,
            "not_modified": True,
            "content_sha256": CONTRACTS["content_sha256"],
        }

    if operation:
        operation = _canonical_tool_name(str(operation))
        contract = CONTRACTS["operations"].get(operation)
        if contract is None:
            return {
                "ok": False,
                "error": {"code": "unknown_tool", "message": operation},
            }
        return {
            "ok": True,
            "canonical_operation": operation,
            "content_sha256": CONTRACTS["content_sha256"],
            "operation": contract_archive.mcp_tool_from_contract(
                contract, mcp_name=_mcp_tool_name(operation)
            ),
            "invoke_card": _invoke_card(operation),
        }

    try:
        catalog = contract_archive.compact_catalog(CONTRACTS, domain=domain)
    except contract_archive.ContractArchiveError as exc:
        return {
            "ok": False,
            "error": {"code": exc.code, "message": str(exc)},
        }
    return {
        "ok": True,
        "host": _host_name(),
        "archive": {
            "schema_version": CONTRACTS["schema_version"],
            "kind": CONTRACTS["kind"],
            "content_sha256": CONTRACTS["content_sha256"],
            "operation_count": CONTRACTS["operation_count"],
        },
        **catalog,
    }


def _run_canonical_operation(
    name: str,
    *,
    root_value: Any,
    campaign: Any,
    call_args: dict[str, Any],
) -> dict[str, Any]:
    canonical_name = _canonical_tool_name(name)
    if canonical_name not in toolbox.TOOLS:
        return {
            "ok": False,
            "tool": name,
            "error": {"code": "unknown_tool", "message": name},
        }
    root_was_explicit = bool(root_value)
    root = (
        Path(root_value).expanduser().resolve()
        if root_was_explicit
        else _default_root()
    )
    if _implicit_root_is_plugin_storage(root):
        return {
            "ok": False,
            "tool": name,
            "error": {
                "code": "workspace_root_required",
                "message": (
                    "plugin storage is not a campaign workspace; pass the "
                    "current workspace absolute path in coc_invoke.root"
                ),
            },
            "hints": [
                "keep the same absolute workspace root on every coc_invoke "
                "call for this campaign"
            ],
        }
    if not root.is_dir():
        return {
            "ok": False,
            "tool": name,
            "error": {
                "code": "invalid_root",
                "message": f"project root is not a directory: {root}",
            },
        }
    campaign_id = (
        campaign.strip()
        if isinstance(campaign, str) and campaign.strip()
        else None
    )
    campaign_key = (
        (os.fspath(root), campaign_id) if campaign_id is not None else None
    )
    global _PROCESS_ACTIVE_CAMPAIGN, _PROCESS_HOST_SESSION_ID
    rehydration_advisory = None
    if (
        campaign_key is not None
        and canonical_name != "session.resume"
        and _PROCESS_ACTIVE_CAMPAIGN != campaign_key
    ):
        reason = (
            "mcp_process_start"
            if _PROCESS_ACTIVE_CAMPAIGN is None
            else "campaign_switch"
        )
        rehydration_advisory = {
            "code": "context_rehydration_recommended",
            "reason": reason,
            "campaign_id": campaign_id,
            "next_operation": "session.resume",
            "authority": "advisory",
            "hard_gate": False,
        }

    requested_session_id = call_args.get("host_session_id")
    bound_session_id = (
        str(requested_session_id).strip()
        if isinstance(requested_session_id, str)
        and requested_session_id.strip()
        else _PROCESS_HOST_SESSION_ID
    )
    with _host_session_binding(bound_session_id):
        envelope = toolbox.run_tool(canonical_name, root, campaign, call_args)
    setup_payload = (
        call_args.get("payload")
        if canonical_name == "setup.invoke"
        and call_args.get("kind") == "campaign.create"
        else None
    )
    setup_campaign_id = (
        str(setup_payload.get("campaign_id") or "").strip()
        if isinstance(setup_payload, dict)
        else ""
    )
    if envelope.get("ok") is True and setup_campaign_id:
        # A campaign created in this MCP process has no prior recovery context
        # to rehydrate. Treat it as the active fresh context so its immediate
        # setup/opening operations are not distracted by a contradictory
        # session.resume advisory.
        _PROCESS_ACTIVE_CAMPAIGN = (os.fspath(root), setup_campaign_id)
    if (
        canonical_name == "session.resume"
        and campaign_key is not None
        and envelope.get("ok") is True
    ):
        _PROCESS_ACTIVE_CAMPAIGN = campaign_key
        acknowledged = (
            ((envelope.get("data") or {}).get("host_context") or {}).get(
                "acknowledged"
            )
            or {}
        )
        acknowledged_session_id = acknowledged.get("session_id")
        if (
            isinstance(acknowledged_session_id, str)
            and acknowledged_session_id.strip()
        ):
            _PROCESS_HOST_SESSION_ID = acknowledged_session_id.strip()
        elif bound_session_id:
            _PROCESS_HOST_SESSION_ID = bound_session_id
    if rehydration_advisory is not None:
        envelope.setdefault("warnings", []).append(
            "This MCP process has not loaded the requested campaign recovery "
            "bundle in its current context; session.resume is recommended."
        )
        envelope.setdefault("hints", []).append(
            "call session.resume once for this context epoch; do not reread "
            "save files or rediscover the full catalog"
        )
        envelope["context_rehydration"] = rehydration_advisory
    if canonical_name == "setup.inspect" and envelope.get("ok") is True:
        result = ((envelope.get("data") or {}).get("result") or {})
        if isinstance(result, dict):
            result["custom_campaign_setup"] = _invoke_card(
                "setup.invoke",
                missing_arguments=["kind", "payload"],
            )
    return wire_projection.project_envelope(
        canonical_name,
        envelope,
        contract_digest=CONTRACTS["content_sha256"],
        argument_schemas=INVOKE_ARGUMENT_SCHEMAS,
    )


def _invoke(arguments: dict[str, Any]) -> dict[str, Any]:
    operation = arguments.get("operation")
    if not isinstance(operation, str) or not operation.strip():
        return {
            "ok": False,
            "tool": "coc_invoke",
            "error": {
                "code": "invalid_arguments",
                "message": "coc_invoke requires a non-empty operation string",
            },
        }
    tool_args = arguments.get("arguments", {})
    if tool_args is None:
        tool_args = {}
    if not isinstance(tool_args, dict):
        return {
            "ok": False,
            "tool": "coc_invoke",
            "error": {
                "code": "invalid_arguments",
                "message": "arguments must be an object",
            },
        }
    # Outer transport fields own root/campaign; nested copies are ignored.
    nested = dict(tool_args)
    nested.pop("root", None)
    nested.pop("campaign", None)
    return _run_canonical_operation(
        operation,
        root_value=arguments.get("root"),
        campaign=arguments.get("campaign"),
        call_args=nested,
    )


def _call_tool(name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    if _mcp_profile() == SOURCE_SUBMIT_PROFILE:
        if name != SOURCE_SUBMIT_TOOL:
            return {
                "ok": False,
                "tool": name,
                "error": {
                    "code": "unknown_tool",
                    "message": "source-submit profile exposes only submit_source_result",
                },
            }
        root = _default_root()
        if not root.is_dir():
            return {
                "ok": False,
                "tool": name,
                "error": {
                    "code": "invalid_root",
                    "message": f"project root is not a directory: {root}",
                },
            }
        try:
            receipt = toolbox.submit_source_worker_result(root, arguments)
        except toolbox.ToolError as exc:
            return {
                "ok": False,
                "tool": name,
                "error": {"code": exc.code, "message": exc.message},
            }
        envelope = {
            "ok": bool(receipt.get("ok")),
            "tool": name,
            "data": receipt,
        }
        if not envelope["ok"]:
            envelope["error"] = deepcopy(receipt.get("error") or {
                "code": "source_submit_failed",
                "message": "source result was not fulfilled",
            })
        return envelope
    if name == "coc_capabilities":
        return {
            "ok": True,
            "tool": name,
            "data": _capabilities(),
            "warnings": [],
            "hints": [],
        }
    if name == "coc_discover":
        operation = arguments.get("operation")
        domain = arguments.get("domain")
        if operation is not None and not isinstance(operation, str):
            return {
                "ok": False,
                "tool": name,
                "error": {
                    "code": "invalid_arguments",
                    "message": "operation must be a string",
                },
            }
        if domain is not None and not isinstance(domain, str):
            return {
                "ok": False,
                "tool": name,
                "error": {
                    "code": "invalid_arguments",
                    "message": "domain must be a string",
                },
            }
        return {
            "ok": True,
            "tool": name,
            "data": _discover(
                operation,
                domain,
                since_content_sha256=arguments.get("since_content_sha256"),
            ),
            "warnings": [],
            "hints": [] if arguments.get("since_content_sha256") else [
                "pass since_content_sha256=<value> on subsequent identical discover "
                "calls to get not_modified instead of re-fetching the full static "
                "schema (saves context tokens)"
            ],
        }
    if name == "coc_invoke":
        return _invoke(arguments)

    call_args = dict(arguments)
    root_value = call_args.pop("root", None)
    campaign = call_args.pop("campaign", None)
    return _run_canonical_operation(
        name,
        root_value=root_value,
        campaign=campaign,
        call_args=call_args,
    )


def _meta_tools() -> list[dict[str, Any]]:
    return [
        {
            "name": "coc_capabilities",
            "description": "Return structured host-native capability flags.",
            "inputSchema": {
                "type": "object",
                "properties": {},
                "additionalProperties": False,
            },
        },
        {
            "name": "coc_discover",
            "description": (
                "Progressive discovery for the canonical COC Keeper toolbox. "
                "With no args, return a compact domain catalog of operation ids "
                "and summaries (not full schemas). With exact operation, return "
                "the archived full MCP contract. With exact domain (e.g. rules, "
                "state, progressive), return only that domain's compact rows."
            ),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "operation": {
                        "type": "string",
                        "description": (
                            "Exact canonical dotted operation id "
                            "(e.g. rules.skill_describe)."
                        ),
                    },
                    "domain": {
                        "type": "string",
                        "description": (
                            "Exact toolbox namespace/domain "
                            "(e.g. rules, state, progressive)."
                        ),
                    },
                    "since_content_sha256": {
                        "type": "string",
                        "description": (
                            "The content_sha256 from a previous identical "
                            "discover call. If it matches the current archive, "
                            "returns not_modified instead of the full data, "
                            "saving context tokens (the archive is static)."
                        ),
                    },
                },
                "additionalProperties": False,
            },
        },
        {
            "name": "coc_invoke",
            "description": (
                "Invoke any canonical COC Keeper toolbox operation by exact "
                "dotted id through the shared toolbox.run_tool gateway. "
                "Invoke a returned operation card directly; use coc_discover "
                "only when no exact card is available."
            ),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "operation": {
                        "type": "string",
                        "description": (
                            "Exact canonical dotted operation id "
                            "(e.g. rules.skill_describe)."
                        ),
                    },
                    "root": {
                        "type": "string",
                        "description": (
                            "Absolute host workspace root containing .coc. "
                            "Pass it on every invocation; managed plugin "
                            "storage is never a campaign workspace."
                        ),
                    },
                    "campaign": {
                        "type": "string",
                        "description": (
                            "Campaign id. Required for campaign-bound "
                            "operations."
                        ),
                    },
                    "arguments": {
                        "type": "object",
                        "description": (
                            "Tool-specific arguments object (not including "
                            "operation/root/campaign)."
                        ),
                        "additionalProperties": True,
                    },
                },
                "required": ["operation"],
                "additionalProperties": False,
            },
        },
    ]


def _source_submit_tools() -> list[dict[str, Any]]:
    return [{
        "name": SOURCE_SUBMIT_TOOL,
        "description": (
            "Submit this source worker's complete coc.source-pack-worker.v1 "
            "result. The server binds packet/work-group/jobs to the active lease, "
            "runs the existing strict fulfillment path once per result, and returns "
            "only a compact receipt. Never repair or retry a rejected submission."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "schema_version": {"type": "integer", "enum": [1]},
                "contract_id": {
                    "type": "string", "enum": [SOURCE_RESULT_CONTRACT],
                },
                "packet_id": {"type": "string", "minLength": 1},
                "work_group_id": {"type": "string", "minLength": 1},
                "status": {
                    "type": "string", "enum": ["usable", "abstain", "failed"],
                },
                "results": {
                    "type": "array",
                    "maxItems": 128,
                    "items": {
                        "type": "object",
                        "properties": {
                            "job_id": {"type": "string", "minLength": 1},
                            "pack": {
                                "type": "object", "additionalProperties": True,
                            },
                            "related_packs": {"type": "array"},
                        },
                        "required": ["job_id", "pack", "related_packs"],
                        "additionalProperties": False,
                    },
                },
            },
            "required": [
                "schema_version", "contract_id", "packet_id",
                "work_group_id", "status", "results",
            ],
            "additionalProperties": False,
        },
    }]


def _listed_tools() -> list[dict[str, Any]]:
    if _mcp_profile() == SOURCE_SUBMIT_PROFILE:
        return _source_submit_tools()
    tools = _meta_tools()
    # Grok Build places every MCP tool behind search_tool/use_tool even when a
    # custom primary agent names the MCP server. Listing the direct hotset
    # there therefore causes one schema-search cycle per operation. Keep one
    # stable gateway schema for all canonical operations; exact cards and the
    # hash-bound archive preserve progressive discovery. Other hosts retain
    # the direct hotset when their native tool surfaces benefit from it.
    if _host_name() == "grok":
        return tools
    for operation in MCP_LISTED_HOTSET:
        tools.append(_archived_tool_schema(operation))
    return tools


def _result(request_id: Any, result: Any) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "result": result}


def _error(request_id: Any, code: int, message: str) -> dict[str, Any]:
    return {
        "jsonrpc": "2.0",
        "id": request_id,
        "error": {"code": code, "message": message},
    }


def _handle(message: dict[str, Any]) -> dict[str, Any] | None:
    method = message.get("method")
    request_id = message.get("id")
    if not method:
        return (
            _error(request_id, -32600, "missing method")
            if request_id is not None
            else None
        )
    if method.startswith("notifications/"):
        return None
    if method == "initialize":
        requested = (message.get("params") or {}).get("protocolVersion")
        server_name = (
            "coc-source-submit"
            if _mcp_profile() == SOURCE_SUBMIT_PROFILE
            else "coc-keeper"
        )
        return _result(
            request_id,
            {
                "protocolVersion": requested or "2024-11-05",
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {
                    "name": server_name,
                    "version": "0.4.0-alpha.0",
                },
            },
        )
    if method == "ping":
        return _result(request_id, {})
    if method == "tools/list":
        return _result(request_id, {"tools": _listed_tools()})
    if method == "tools/call":
        params = message.get("params") or {}
        name = params.get("name")
        arguments = params.get("arguments") or {}
        if not isinstance(name, str) or not isinstance(arguments, dict):
            return _error(
                request_id,
                -32602,
                "tools/call requires name and object arguments",
            )
        envelope = _call_tool(name, arguments)
        return _result(
            request_id,
            {
                "content": [
                    {
                        "type": "text",
                        "text": json.dumps(
                            envelope,
                            ensure_ascii=False,
                            separators=(",", ":"),
                        ),
                    }
                ],
                "structuredContent": envelope,
                "isError": not bool(envelope.get("ok")),
            },
        )
    return _error(request_id, -32601, f"method not found: {method}")


def main() -> int:
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            message = json.loads(line)
            if not isinstance(message, dict):
                raise ValueError("message must be an object")
            response = _handle(message)
        except (ValueError, json.JSONDecodeError) as exc:
            response = _error(None, -32700, str(exc))
        if response is not None:
            sys.stdout.write(json.dumps(
                response,
                ensure_ascii=False,
                separators=(",", ":"),
            ) + "\n")
            sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
