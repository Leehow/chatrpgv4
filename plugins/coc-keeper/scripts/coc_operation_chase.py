#!/usr/bin/env python3
"""Operation adapter cell: chase."""
from __future__ import annotations

from coc_operation_kernel_runtime import (
    Any,
    Ctx,
    _execute_subsystem_command,
    _read_optional_json,
    coc_subsystem_executor,
    tool,
)

def _tool_chase_context(ctx: Ctx, args: dict[str, Any]):
    snapshot = _read_optional_json(ctx.campaign_dir / "save" / "chase.json", None)
    choices = coc_subsystem_executor.get_current_pending_choices(ctx.campaign_dir)
    return {
        "active": isinstance(snapshot, dict) and snapshot.get("status") == "active",
        "snapshot": snapshot,
        "pending_choices": choices,
    }, [], ["use chase.execute only when the fiction naturally enters or continues a chase"]

def _tool_chase_execute(ctx: Ctx, args: dict[str, Any]):
    return _execute_subsystem_command(
        ctx,
        args,
        tool_name="chase.execute",
        allowed_kinds=coc_subsystem_executor.CHASE_COMMAND_KINDS,
    )

def register_operations(registry) -> None:
    global TOOLS
    TOOLS = registry.legacy_tools
    registry.tool(
    "chase.context",
    "Read the current canonical ChaseSession snapshot and unresolved subsystem choices.",
    {},
)(_tool_chase_context)
    registry.tool(
    "chase.execute",
    "Execute one exact command through the existing full ChaseSession subsystem. No fixed chase workflow is imposed by the toolbox.",
    {
        "investigator": {"type": "string", "desc": "investigator id"},
        "command": {"type": "object", "required": True, "desc": "exact chase_start/move/hazard/barrier/conflict/end command"},
        "seed": {"type": "integer", "desc": "deterministic RNG seed"},
        "decision_id": {"type": "string", "desc": "idempotency key; must match command.payload.decision_id"},
    },
)(_tool_chase_execute)


OPERATION_EXPORTS = (
    '_tool_chase_context',
    '_tool_chase_execute',
)
