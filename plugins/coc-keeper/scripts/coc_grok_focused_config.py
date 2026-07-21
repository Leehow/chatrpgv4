#!/usr/bin/env python3
"""Render and verify Grok's focused live-KP MCP configuration.

Grok Build 0.2.106 discovers Claude-compatible plugins outside GROK_HOME and
does not honor their plugin deny entries from an alternate GROK_HOME.  Native
``mcp_servers.<name>.enabled = false`` overrides do take precedence.  The
focused installer feeds this helper the host's own ``grok inspect --json``
result and disables every non-COC MCP without baking user-specific server
names into the repository.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from typing import Any


PLUGIN_NAME = "coc-keeper"
PLUGIN_MCP_NAMES = {"coc-keeper", "coc-source-submit"}
SOURCE_WORKER_AGENT_NAME = "coc-source-pack-worker"
MCP_OVERRIDE_MARKER = "# __COC_DISABLED_MCP_OVERRIDES__"
SKILL_OVERRIDE_MARKER = "# __COC_DISABLED_SKILL_OVERRIDES__"
ALLOWED_HOST_SKILLS = {"imagine"}


class FocusedConfigError(ValueError):
    pass


def _inventory(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise FocusedConfigError("grok inspect inventory must be an object")
    return value


def external_mcp_names(inventory: dict[str, Any]) -> list[str]:
    server_names = {
        str(row.get("name") or "").strip()
        for row in inventory.get("mcpServers") or []
        if isinstance(row, dict)
        and row.get("disabled") is not True
        and str(row.get("name") or "").strip() not in PLUGIN_MCP_NAMES
    }
    # A compatibility plugin can remain discoverable while its MCP row is
    # hidden or marked disabled by `grok inspect`.  Grok 0.2.106 may still
    # merge that plugin again after authentication, so emit a native override
    # for every enabled non-COC plugin that advertises an MCP component too.
    plugin_names = {
        str(row.get("name") or "").strip()
        for row in inventory.get("plugins") or []
        if isinstance(row, dict)
        and row.get("enabled") is not False
        and str(row.get("name") or "").strip() != PLUGIN_NAME
        and isinstance(row.get("provides"), dict)
        and int(row["provides"].get("mcpServers") or 0) > 0
    }
    return sorted((server_names | plugin_names) - {""})


def enabled_external_mcp_names(inventory: dict[str, Any]) -> list[str]:
    """Return servers actually exposed by Grok's resolved MCP inventory.

    Plugin discovery rows are deliberately excluded here. A plugin may remain
    visible for skills or agents while its MCP contribution is suppressed by
    the native override rendered from :func:`external_mcp_names`.
    """
    return sorted({
        str(row.get("name") or "").strip()
        for row in inventory.get("mcpServers") or []
        if isinstance(row, dict)
        and row.get("disabled") is not True
        and str(row.get("name") or "").strip() not in PLUGIN_MCP_NAMES
    } - {""})


def _is_canonical_plugin_skill(row: dict[str, Any]) -> bool:
    source = row.get("source")
    return (
        isinstance(source, dict)
        and source.get("type") == "plugin"
        and source.get("plugin_name") == PLUGIN_NAME
    )


def external_skill_names(inventory: dict[str, Any]) -> list[str]:
    """Return discovered skill names outside the focused KP allowset."""
    return sorted({
        str(row.get("name") or "").strip()
        for row in inventory.get("skills") or []
        if isinstance(row, dict)
        and not _is_canonical_plugin_skill(row)
        and str(row.get("name") or "").strip() not in ALLOWED_HOST_SKILLS
    } - {""})


def enabled_external_skill_names(inventory: dict[str, Any]) -> list[str]:
    return sorted({
        str(row.get("name") or "").strip()
        for row in inventory.get("skills") or []
        if isinstance(row, dict)
        and row.get("disabled") is not True
        and not _is_canonical_plugin_skill(row)
        and str(row.get("name") or "").strip() not in ALLOWED_HOST_SKILLS
    } - {""})


def render_config(template: str, inventory: dict[str, Any]) -> str:
    if template.count(MCP_OVERRIDE_MARKER) != 1:
        raise FocusedConfigError(
            "focused config template must contain exactly one MCP override marker"
        )
    blocks = []
    for name in external_mcp_names(_inventory(inventory)):
        quoted = json.dumps(name, ensure_ascii=False)
        blocks.append(f'[mcp_servers.{quoted}]\nenabled = false')
    replacement = "\n\n".join(blocks)
    return template.replace(MCP_OVERRIDE_MARKER, replacement)


def render_requirements(template: str, inventory: dict[str, Any]) -> str:
    if template.count(SKILL_OVERRIDE_MARKER) != 1:
        raise FocusedConfigError(
            "focused requirements template must contain exactly one skill "
            "override marker"
        )
    names = external_skill_names(_inventory(inventory))
    replacement = "disabled = " + json.dumps(names, ensure_ascii=False)
    return template.replace(SKILL_OVERRIDE_MARKER, replacement)


def source_worker_agent_violations(
    inventory: dict[str, Any], expected_path: Path,
) -> list[str]:
    """Verify Grok resolved the submit-capable worker as a user agent.

    Grok 0.2.106 deliberately ignores ``mcpServers`` on plugin agents.  The
    focused installer therefore projects the canonical worker definition into
    its private user-agent directory.  This check fails closed if Grok instead
    resolves a plugin agent or another file under the unqualified name.
    """
    matches = [
        row for row in inventory.get("agents") or []
        if isinstance(row, dict)
        and str(row.get("name") or "").strip() == SOURCE_WORKER_AGENT_NAME
    ]
    if len(matches) != 1:
        return [f"expected_one_user_agent:found_{len(matches)}"]
    source = matches[0].get("source")
    if not isinstance(source, dict) or source.get("type") != "user":
        return ["source_worker_agent_is_not_user_scoped"]
    actual_path = str(source.get("path") or "").strip()
    if not actual_path:
        return ["source_worker_agent_path_missing"]
    if Path(actual_path).resolve() != expected_path.resolve():
        return ["source_worker_agent_path_mismatch"]
    return []


def isolation_violations(
    inventory: dict[str, Any], *, required_source_agent: Path | None = None,
) -> dict[str, list[str]]:
    inventory = _inventory(inventory)
    violations = {
        "enabled_non_coc_mcps": enabled_external_mcp_names(inventory),
        "enabled_external_skills": enabled_external_skill_names(inventory),
    }
    if required_source_agent is not None:
        violations["source_worker_agent"] = source_worker_agent_violations(
            inventory, required_source_agent,
        )
    return violations


def _read_stdin_inventory() -> dict[str, Any]:
    try:
        return _inventory(json.load(sys.stdin))
    except json.JSONDecodeError as exc:
        raise FocusedConfigError(f"invalid grok inspect JSON: {exc}") from exc


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    render = subparsers.add_parser("render")
    render.add_argument("--template", type=Path, required=True)
    render_requirements_parser = subparsers.add_parser("render-requirements")
    render_requirements_parser.add_argument(
        "--template", type=Path, required=True
    )
    verify = subparsers.add_parser("verify")
    verify.add_argument("--require-source-agent", type=Path)
    args = parser.parse_args(argv)
    try:
        inventory = _read_stdin_inventory()
        if args.command == "render":
            template = args.template.read_text(encoding="utf-8")
            sys.stdout.write(render_config(template, inventory))
            return 0
        if args.command == "render-requirements":
            template = args.template.read_text(encoding="utf-8")
            sys.stdout.write(render_requirements(template, inventory))
            return 0
        violations = isolation_violations(
            inventory, required_source_agent=args.require_source_agent,
        )
        ok = not any(violations.values())
        print(json.dumps({"ok": ok, **violations}, sort_keys=True))
        return 0 if ok else 2
    except (FocusedConfigError, OSError) as exc:
        print(json.dumps({
            "ok": False,
            "error": {"code": "focused_config_error", "message": str(exc)},
        }), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
