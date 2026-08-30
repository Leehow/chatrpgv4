#!/usr/bin/env python3
"""Operation adapter cell: development."""
from __future__ import annotations

from coc_operation_kernel_runtime import (
    Any,
    Ctx,
    ToolError,
    _ending_rng,
    _resolve_investigator,
    _rng,
    coc_development,
    coc_runtime_ops,
    tool,
)

def _tool_development_settle(ctx: Ctx, args: dict[str, Any]):
    decision_id = str(args["decision_id"])
    prior = ctx.ledger_lookup("development.settle", decision_id)
    if prior is not None:
        return prior.get("data"), [
            "duplicate decision_id: returning the previously settled result"
        ], []
    investigator_id = _resolve_investigator(ctx, args)
    try:
        ending = coc_development.structured_ending_evidence(
            ctx.campaign_dir,
            ending_id=(str(args["ending_id"]) if args.get("ending_id") else None),
        )
        if ending is None:
            raise coc_runtime_ops.RuntimeOperationError(
                "development.settle requires a persisted state.end_session receipt"
            )
        rng = _rng(args) if args.get("seed") is not None else _ending_rng(
            ending, investigator_id
        )
        receipt = coc_runtime_ops.settle_development(
            ctx.campaign_dir,
            investigator_id,
            rng=rng,
            ending_id=str(ending["ending_id"]),
        )
    except coc_runtime_ops.DevelopmentRecoveryConflict as exc:
        raise ToolError("recovery_conflict", str(exc)) from exc
    except coc_runtime_ops.DevelopmentTargetConflict as exc:
        raise ToolError("settlement_target_conflict", str(exc)) from exc
    except coc_runtime_ops.RuntimeOperationError as exc:
        if "requires a persisted state.end_session" in str(exc):
            raise ToolError("settlement_unavailable", str(exc)) from exc
        raise ToolError("development_settlement_failed", str(exc)) from exc
    except Exception as exc:
        raise ToolError("development_settlement_failed", str(exc)) from exc
    data = {
        "ending_id": (receipt.get("result") or {}).get("ending_evidence", {}).get("ending_id"),
        "receipt": receipt,
    }
    ctx.ledger_record(decision_id, "development.settle", data)
    return data, [], ["development settlement is complete and safe to report"]

def register_operations(registry) -> None:
    global TOOLS
    TOOLS = registry.legacy_tools
    registry.tool(
    "development.settle",
    "Replay or complete deterministic post-ending development bookkeeping through the canonical development engine.",
    {
        "investigator": {"type": "string", "desc": "investigator id; defaults to the linked party member"},
        "ending_id": {"type": "string", "desc": "exact persisted ending id; defaults to the latest ending"},
        "decision_id": {"type": "string", "required": True, "desc": "idempotency key"},
    },
)(_tool_development_settle)


OPERATION_EXPORTS = (
    '_tool_development_settle',
)
