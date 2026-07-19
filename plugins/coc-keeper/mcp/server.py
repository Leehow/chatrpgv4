#!/usr/bin/env python3
"""Small stdio MCP transport for the canonical COC Keeper toolbox.

The server deliberately contains no rules, state, or narrative decisions. It
adapts MCP calls to the existing ``coc_toolbox`` registry so Cursor, Kimi, and
ZCode consume the same operations and envelopes as Codex and the headless
runtime.
"""
from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import sys
from typing import Any


PLUGIN_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_ROOT = PLUGIN_ROOT / "scripts"
CAPABILITIES_PATH = PLUGIN_ROOT / "references" / "host-capabilities.json"


def _load_toolbox():
    name = "coc_toolbox_mcp"
    existing = sys.modules.get(name)
    if existing is not None:
        return existing
    spec = importlib.util.spec_from_file_location(
        name, SCRIPTS_ROOT / "coc_toolbox.py"
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("unable to load canonical coc_toolbox.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


toolbox = _load_toolbox()


def _json_schema(spec: dict[str, Any]) -> dict[str, Any]:
    """Translate the toolbox's compact parameter metadata to JSON Schema."""
    allowed = {
        "type",
        "enum",
        "items",
        "properties",
        "additionalProperties",
        "minimum",
        "maximum",
        "minItems",
        "maxItems",
        "default",
        "examples",
    }
    result = {key: value for key, value in spec.items() if key in allowed}
    if "desc" in spec:
        result["description"] = spec["desc"]
    if result.get("type") == "object" and "additionalProperties" not in result:
        result["additionalProperties"] = True
    return result or {"type": "string"}


def _tool_schema(name: str, spec: dict[str, Any]) -> dict[str, Any]:
    properties: dict[str, Any] = {
        "root": {
            "type": "string",
            "description": "Project root containing .coc; defaults to the host workspace.",
        },
        "campaign": {
            "type": "string",
            "description": "Campaign id. Required for campaign-bound operations.",
        },
    }
    required = ["campaign"] if spec.get("needs_campaign") else []
    for param_name, param_spec in spec.get("params", {}).items():
        properties[param_name] = _json_schema(param_spec)
        if param_spec.get("required"):
            required.append(param_name)
    return {
        "name": name,
        "description": (
            f"{spec.get('summary', name)} Canonical COC Keeper operation; "
            "the result envelope is authoritative."
        ),
        "inputSchema": {
            "type": "object",
            "properties": properties,
            "required": required,
            "additionalProperties": False,
        },
    }


def _host_name() -> str:
    return os.environ.get("COC_HOST", "unknown").strip() or "unknown"


def _default_root() -> Path:
    value = (
        os.environ.get("COC_PROJECT_ROOT")
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


def _discover(operation: str | None = None) -> dict[str, Any]:
    if operation:
        spec = toolbox.TOOLS.get(operation)
        if spec is None:
            return {"ok": False, "error": {"code": "unknown_tool", "message": operation}}
        return {"ok": True, "operation": _tool_schema(operation, spec)}
    return {
        "ok": True,
        "host": _host_name(),
        "operations": toolbox.list_tools(),
        "count": len(toolbox.TOOLS),
    }


def _call_tool(name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    if name == "coc_capabilities":
        return {"ok": True, "tool": name, "data": _capabilities(), "warnings": [], "hints": []}
    if name == "coc_discover":
        operation = arguments.get("operation")
        return {"ok": True, "tool": name, "data": _discover(operation), "warnings": [], "hints": []}

    spec = toolbox.TOOLS.get(name)
    if spec is None:
        return {"ok": False, "tool": name, "error": {"code": "unknown_tool", "message": name}}
    call_args = dict(arguments)
    root_value = call_args.pop("root", None)
    campaign = call_args.pop("campaign", None)
    root = Path(root_value).expanduser().resolve() if root_value else _default_root()
    if not root.is_dir():
        return {
            "ok": False,
            "tool": name,
            "error": {"code": "invalid_root", "message": f"project root is not a directory: {root}"},
        }
    return toolbox.run_tool(name, root, campaign, call_args)


def _result(request_id: Any, result: Any) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "result": result}


def _error(request_id: Any, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}


def _handle(message: dict[str, Any]) -> dict[str, Any] | None:
    method = message.get("method")
    request_id = message.get("id")
    if not method:
        return _error(request_id, -32600, "missing method") if request_id is not None else None
    if method.startswith("notifications/"):
        return None
    if method == "initialize":
        requested = (message.get("params") or {}).get("protocolVersion")
        return _result(request_id, {
            "protocolVersion": requested or "2024-11-05",
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": {"name": "coc-keeper", "version": "0.4.0-alpha.0"},
        })
    if method == "ping":
        return _result(request_id, {})
    if method == "tools/list":
        tools = [
            {
                "name": "coc_capabilities",
                "description": "Return structured host-native capability flags.",
                "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
            },
            {
                "name": "coc_discover",
                "description": "Discover canonical COC Keeper operations or one operation schema.",
                "inputSchema": {
                    "type": "object",
                    "properties": {"operation": {"type": "string"}},
                    "additionalProperties": False,
                },
            },
        ]
        tools.extend(_tool_schema(name, spec) for name, spec in sorted(toolbox.TOOLS.items()))
        return _result(request_id, {"tools": tools})
    if method == "tools/call":
        params = message.get("params") or {}
        name = params.get("name")
        arguments = params.get("arguments") or {}
        if not isinstance(name, str) or not isinstance(arguments, dict):
            return _error(request_id, -32602, "tools/call requires name and object arguments")
        envelope = _call_tool(name, arguments)
        return _result(request_id, {
            "content": [{"type": "text", "text": json.dumps(envelope, ensure_ascii=False)}],
            "structuredContent": envelope,
            "isError": not bool(envelope.get("ok")),
        })
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
