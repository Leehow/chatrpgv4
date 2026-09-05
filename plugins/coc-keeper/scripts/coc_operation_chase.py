#!/usr/bin/env python3
"""Operation adapter cell: chase."""
from __future__ import annotations

import coc_chase
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
    # `outlook` is what the gates read, said in the open. Every chase decision
    # but start and move is hard-gated on `chase.pending.kind`, derived from
    # the location ahead of the actor on turn and the quarry's escaped/captured
    # flags -- and the snapshot carries both without ever relating them, so a
    # Keeper reading it could not tell a chase with a barrier two steps off
    # from one that had run out of track four rounds ago. Derived on read; the
    # snapshot stays the authority.
    return {
        "active": isinstance(snapshot, dict) and snapshot.get("status") == "active",
        "snapshot": snapshot,
        "outlook": coc_chase.chase_outlook(snapshot),
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
        "decision_id": {"type": "string", "desc": "idempotency key; must match command.payload.decision_id"},
    },
)(_tool_chase_execute)


OPERATION_EXPORTS = (
    '_tool_chase_context',
    '_tool_chase_execute',
)
