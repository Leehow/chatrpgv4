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


toolbox = _load_toolbox()
contract_archive = _load_contract_archive_module()

try:
    CONTRACTS = contract_archive.load_and_validate(CONTRACT_ARCHIVE_PATH, toolbox)
except contract_archive.ContractArchiveError as exc:
    raise RuntimeError(
        f"MCP progressive-discovery contract archive failed validation "
        f"({exc.code}): {exc}"
    ) from exc

MCP_LISTED_HOTSET: tuple[str, ...] = tuple(contract_archive.MCP_LISTED_HOTSET)

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


def _default_root() -> Path:
    value = (
        os.environ.get("COC_PROJECT_ROOT")
        or os.environ.get("GROK_WORKSPACE_ROOT")
        or os.environ.get("CLAUDE_PROJECT_DIR")
        or os.environ.get("ZCODE_PROJECT_DIR")
        or os.getcwd()
    )
    return Path(value).expanduser().resolve()


def _capabilities() -> dict[str, Any]:
    try:
        data = json.loads(CAPABILITIES_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        data = {}
    return {
        "host": _host_name(),
        "capabilities": data.get(_host_name(), data.get("default", {})),
        "source": "plugins/coc-keeper/references/host-capabilities.json",
    }


def _discover(
    operation: str | None = None,
    domain: str | None = None,
) -> dict[str, Any]:
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
            "operation": contract_archive.mcp_tool_from_contract(
                contract, mcp_name=_mcp_tool_name(operation)
            ),
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
    root = (
        Path(root_value).expanduser().resolve()
        if root_value
        else _default_root()
    )
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
    return envelope


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
            "data": _discover(operation, domain),
            "warnings": [],
            "hints": [],
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
                },
                "additionalProperties": False,
            },
        },
        {
            "name": "coc_invoke",
            "description": (
                "Invoke any canonical COC Keeper toolbox operation by exact "
                "dotted id through the shared toolbox.run_tool gateway. Use "
                "after coc_discover when the operation is not in the listed "
                "hotset."
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
                            "Project root containing .coc; defaults to the "
                            "host workspace."
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


def _listed_tools() -> list[dict[str, Any]]:
    tools = _meta_tools()
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
        return _result(
            request_id,
            {
                "protocolVersion": requested or "2024-11-05",
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {
                    "name": "coc-keeper",
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
                        "text": json.dumps(envelope, ensure_ascii=False),
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
            sys.stdout.write(json.dumps(response, ensure_ascii=False) + "\n")
            sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
