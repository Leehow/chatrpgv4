#!/usr/bin/env python3
"""Deterministic MCP operation-contract archive for progressive discovery.

Materializes host-independent MCP input schemas from the canonical
``coc_toolbox.TOOLS`` registry into a committed, versioned, hash-bound JSON
archive. The MCP transport lists only a small hotset; long-tail operations are
discovered and invoked on demand through the same toolbox gateway.

Commands:
  build   regenerate the committed archive
  check   fail closed if the committed archive is stale or malformed
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import sys
from pathlib import Path
from typing import Any


SCHEMA_VERSION = 1
ARCHIVE_KIND = "mcp_operation_contracts"
PRODUCER = "coc_mcp_contract_archive"

PLUGIN_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ARCHIVE_PATH = PLUGIN_ROOT / "references" / "mcp-operation-contracts.json"
SCRIPTS_ROOT = PLUGIN_ROOT / "scripts"

# Deliberately small first-contact surface for ordinary turn play.
# Meta tools coc_capabilities / coc_discover / coc_invoke are listed separately
# by the MCP transport; this is the direct toolbox hotset only.
MCP_LISTED_HOTSET: tuple[str, ...] = (
    "session.resume",
    "scene.context",
    "secrets.briefing",
    "actions.advise",
    "rules.roll",
    "rules.sanity_check",
    "npc.reaction",
    "state.record_clue",
    "state.record_npc_engagement",
    "state.journal",
    "turn.output_context",
    "turn.finalize",
)

_JSON_SCHEMA_ALLOWED = frozenset({
    "type",
    "enum",
    "items",
    "properties",
    "additionalProperties",
    "minimum",
    "maximum",
    "minItems",
    "maxItems",
    "minLength",
    "maxLength",
    "pattern",
    "uniqueItems",
    "default",
    "examples",
})


class ContractArchiveError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def _load_toolbox():
    name = "coc_toolbox_mcp_contract_archive"
    existing = sys.modules.get(name)
    if existing is not None:
        return existing
    spec = importlib.util.spec_from_file_location(
        name, SCRIPTS_ROOT / "coc_toolbox.py"
    )
    if spec is None or spec.loader is None:
        raise ContractArchiveError(
            "toolbox_load_failed", "unable to load canonical coc_toolbox.py"
        )
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def json_schema(spec: dict[str, Any]) -> dict[str, Any]:
    """Translate toolbox compact parameter metadata to JSON Schema."""
    result: dict[str, Any] = {}
    for key, value in spec.items():
        if key == "properties" and isinstance(value, dict):
            result[key] = {
                name: json_schema(child)
                for name, child in value.items()
                if isinstance(child, dict)
            }
        elif key == "items" and isinstance(value, dict):
            result[key] = json_schema(value)
        elif key == "required" and isinstance(value, list):
            result[key] = list(value)
        elif key == "required_fields" and isinstance(value, list):
            # Toolbox metadata uses ``required: true`` for a top-level
            # operation parameter.  Keep nested object requirements distinct
            # so an optional object does not accidentally become mandatory.
            result["required"] = list(value)
        elif key in _JSON_SCHEMA_ALLOWED:
            result[key] = value
    if "desc" in spec:
        result["description"] = spec["desc"]
    if result.get("type") == "object" and "additionalProperties" not in result:
        result["additionalProperties"] = True
    return result or {"type": "string"}


def input_schema_for_spec(spec: dict[str, Any]) -> dict[str, Any]:
    """Build the MCP inputSchema for one toolbox operation (host-independent)."""
    properties: dict[str, Any] = {
        "root": {
            "type": "string",
            "description": (
                "Project root containing .coc; defaults to the host workspace."
            ),
        },
        "campaign": {
            "type": "string",
            "description": "Campaign id. Required for campaign-bound operations.",
        },
    }
    required = ["campaign"] if spec.get("needs_campaign") else []
    for param_name, param_spec in spec.get("params", {}).items():
        properties[param_name] = json_schema(param_spec)
        if param_spec.get("required"):
            required.append(param_name)
    return {
        "type": "object",
        "properties": properties,
        "required": required,
        "additionalProperties": False,
    }


def contract_for_operation(operation: str, spec: dict[str, Any]) -> dict[str, Any]:
    summary = str(spec.get("summary") or operation)
    return {
        "canonical_operation": operation,
        "summary": summary,
        "needs_campaign": bool(spec.get("needs_campaign")),
        "description": (
            f"{summary} Canonical operation `{operation}`; "
            "the result envelope is authoritative."
        ),
        "inputSchema": input_schema_for_spec(spec),
    }


# Fields bound into content_sha256. Exclude only the hash itself and the
# derived operation_count (len(operations)); everything else that defines the
# archive identity must be in the digest.
_HASH_BOUND_KEYS: tuple[str, ...] = (
    "schema_version",
    "kind",
    "producer",
    "listed_hotset",
    "operations",
)


def archive_hash_payload(archive: dict[str, Any]) -> dict[str, Any]:
    """Canonical subset hashed into content_sha256 (build and validate agree)."""
    return {key: archive.get(key) for key in _HASH_BOUND_KEYS}


def digest_archive_content(archive: dict[str, Any]) -> str:
    """Deterministic sha256 over the hash-bound archive payload."""
    encoded = json.dumps(
        archive_hash_payload(archive),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def domain_of(operation: str) -> str:
    if "." not in operation:
        return operation
    return operation.split(".", 1)[0]


def build_archive(toolbox: Any | None = None) -> dict[str, Any]:
    tb = toolbox if toolbox is not None else _load_toolbox()
    tools = getattr(tb, "TOOLS", None)
    if not isinstance(tools, dict) or not tools:
        raise ContractArchiveError("empty_toolbox", "canonical toolbox.TOOLS is empty")

    missing_hotset = [name for name in MCP_LISTED_HOTSET if name not in tools]
    if missing_hotset:
        raise ContractArchiveError(
            "hotset_missing",
            "hotset operations absent from toolbox: " + ", ".join(missing_hotset),
        )

    operations: dict[str, Any] = {}
    for name in sorted(tools):
        operations[name] = contract_for_operation(name, tools[name])

    archive: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "kind": ARCHIVE_KIND,
        "producer": PRODUCER,
        "operation_count": len(operations),
        "listed_hotset": list(MCP_LISTED_HOTSET),
        "operations": operations,
    }
    archive["content_sha256"] = digest_archive_content(archive)
    return archive


def archive_to_canonical_bytes(archive: dict[str, Any]) -> bytes:
    return (
        json.dumps(
            archive,
            ensure_ascii=False,
            sort_keys=True,
            indent=2,
        )
        + "\n"
    ).encode("utf-8")


def write_archive(path: Path, archive: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = archive if archive is not None else build_archive()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(archive_to_canonical_bytes(payload))
    return payload


def load_archive_file(path: Path) -> dict[str, Any]:
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise ContractArchiveError(
            "archive_missing",
            f"MCP contract archive missing or unreadable: {path}: {exc}",
        ) from exc
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ContractArchiveError(
            "archive_malformed",
            f"MCP contract archive is not valid JSON: {path}: {exc}",
        ) from exc
    if not isinstance(data, dict):
        raise ContractArchiveError(
            "archive_malformed",
            f"MCP contract archive root must be an object: {path}",
        )
    return data


def validate_archive(
    archive: dict[str, Any],
    toolbox: Any | None = None,
    *,
    path: Path | None = None,
) -> dict[str, Any]:
    """Fail closed when the archive is malformed or drifts from toolbox.TOOLS."""
    location = str(path) if path is not None else "<in-memory>"

    if archive.get("schema_version") != SCHEMA_VERSION:
        raise ContractArchiveError(
            "archive_schema",
            (
                f"MCP contract archive schema_version mismatch at {location}: "
                f"expected {SCHEMA_VERSION}, got {archive.get('schema_version')!r}"
            ),
        )
    if archive.get("kind") != ARCHIVE_KIND:
        raise ContractArchiveError(
            "archive_kind",
            (
                f"MCP contract archive kind mismatch at {location}: "
                f"expected {ARCHIVE_KIND!r}, got {archive.get('kind')!r}"
            ),
        )

    operations = archive.get("operations")
    if not isinstance(operations, dict) or not operations:
        raise ContractArchiveError(
            "archive_operations",
            f"MCP contract archive has no operations map at {location}",
        )

    claimed = archive.get("content_sha256")
    actual = digest_archive_content(archive)
    if claimed != actual:
        raise ContractArchiveError(
            "archive_hash",
            (
                f"MCP contract archive content_sha256 mismatch at {location}: "
                f"claimed {claimed!r}, recomputed {actual!r}"
            ),
        )

    if archive.get("operation_count") != len(operations):
        raise ContractArchiveError(
            "archive_count",
            (
                f"MCP contract archive operation_count mismatch at {location}: "
                f"claimed {archive.get('operation_count')!r}, "
                f"operations map has {len(operations)}"
            ),
        )

    hotset = archive.get("listed_hotset")
    if hotset != list(MCP_LISTED_HOTSET):
        raise ContractArchiveError(
            "archive_hotset",
            f"MCP contract archive listed_hotset drift at {location}",
        )

    expected = build_archive(toolbox)
    if set(operations) != set(expected["operations"]):
        missing = sorted(set(expected["operations"]) - set(operations))
        extra = sorted(set(operations) - set(expected["operations"]))
        raise ContractArchiveError(
            "archive_stale",
            (
                f"MCP contract archive operation set drifts from toolbox at "
                f"{location}: missing={missing!r} extra={extra!r}"
            ),
        )

    if archive["content_sha256"] != expected["content_sha256"]:
        # Find a sample differing operation for a clearer error.
        sample = None
        for name in sorted(operations):
            if operations[name] != expected["operations"][name]:
                sample = name
                break
        raise ContractArchiveError(
            "archive_stale",
            (
                f"MCP contract archive is stale relative to toolbox at {location}"
                + (f" (first drift: {sample})" if sample else "")
                + f": archive {archive['content_sha256']} "
                f"!= expected {expected['content_sha256']}"
            ),
        )

    for name, contract in operations.items():
        if not isinstance(contract, dict):
            raise ContractArchiveError(
                "archive_malformed",
                f"operation contract must be an object: {name}",
            )
        if contract.get("canonical_operation") != name:
            raise ContractArchiveError(
                "archive_malformed",
                f"canonical_operation must equal map key for {name}",
            )
        if not isinstance(contract.get("inputSchema"), dict):
            raise ContractArchiveError(
                "archive_malformed",
                f"inputSchema missing for {name}",
            )
        if not isinstance(contract.get("summary"), str):
            raise ContractArchiveError(
                "archive_malformed",
                f"summary missing for {name}",
            )

    return archive


def load_and_validate(
    path: Path,
    toolbox: Any | None = None,
) -> dict[str, Any]:
    archive = load_archive_file(path)
    return validate_archive(archive, toolbox, path=path)


def compact_catalog(
    archive: dict[str, Any],
    *,
    domain: str | None = None,
) -> dict[str, Any]:
    """Domain-grouped compact rows (ids + summaries), never full schemas."""
    operations = archive["operations"]
    selected = sorted(operations)
    if domain is not None:
        domain = domain.strip()
        if not domain:
            raise ContractArchiveError("invalid_domain", "domain must be non-empty")
        selected = [name for name in selected if domain_of(name) == domain]
        if not selected:
            raise ContractArchiveError(
                "unknown_domain",
                f"no operations in domain {domain!r}",
            )

    domains: dict[str, list[dict[str, str]]] = {}
    for name in selected:
        entry = operations[name]
        domains.setdefault(domain_of(name), []).append(
            {
                "operation": name,
                "summary": str(entry["summary"]),
            }
        )

    domain_rows = [
        {
            "domain": domain_name,
            "count": len(rows),
            "operations": rows,
        }
        for domain_name, rows in sorted(domains.items())
    ]
    return {
        "count": len(selected),
        "domain_count": len(domain_rows),
        "domains": domain_rows,
    }


def mcp_tool_from_contract(
    contract: dict[str, Any],
    *,
    mcp_name: str,
) -> dict[str, Any]:
    return {
        "name": mcp_name,
        "description": contract["description"],
        "inputSchema": contract["inputSchema"],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "command",
        choices=("build", "check"),
        help="build regenerates the archive; check fails on drift",
    )
    parser.add_argument(
        "--path",
        type=Path,
        default=DEFAULT_ARCHIVE_PATH,
        help=f"archive path (default: {DEFAULT_ARCHIVE_PATH})",
    )
    args = parser.parse_args(argv)

    try:
        if args.command == "build":
            payload = write_archive(args.path)
            print(
                json.dumps(
                    {
                        "ok": True,
                        "command": "build",
                        "path": str(args.path),
                        "operation_count": payload["operation_count"],
                        "content_sha256": payload["content_sha256"],
                    },
                    ensure_ascii=False,
                    indent=2,
                )
            )
            return 0

        archive = load_and_validate(args.path)
        print(
            json.dumps(
                {
                    "ok": True,
                    "command": "check",
                    "path": str(args.path),
                    "operation_count": archive["operation_count"],
                    "content_sha256": archive["content_sha256"],
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0
    except ContractArchiveError as exc:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": {"code": exc.code, "message": str(exc)},
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
