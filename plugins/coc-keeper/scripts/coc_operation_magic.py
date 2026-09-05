#!/usr/bin/env python3
"""Operation adapter cell: ruleset-bound spell casting and learning."""
from __future__ import annotations

from coc_operation_kernel_runtime import (
    Any,
    Ctx,
    ToolError,
    _active_ruleset_id,
    _investigator_character_path,
    _resolve_investigator,
    _rng,
    coc_runtime_ops,
)


def _execute_magic(ctx: Ctx, args: dict[str, Any], *, kind: str):
    decision_id = str(args["decision_id"])
    prior = ctx.ledger_lookup(kind, decision_id)
    if prior is not None:
        return prior.get("data"), [
            "duplicate decision_id: returning the previously settled result"
        ], []
    if _active_ruleset_id(ctx) != "coc7":
        raise ToolError(
            "unsupported_ruleset_operation",
            f"{kind} is available only for a coc7-bound campaign",
        )
    investigator_id = _resolve_investigator(ctx, args)
    payload = {"spell": args["spell"]}
    if kind == "magic.cast":
        payload.update({
            "pushed": args.get("pushed") is True,
            "interrupted": args.get("interrupted") is True,
            "is_npc": args.get("is_npc") is True,
        })
    else:
        payload["source"] = args.get("source", "tome")
    try:
        receipt = coc_runtime_ops._magic_operation(
            workspace=ctx.root,
            campaign_dir=ctx.campaign_dir,
            campaign_id=str(ctx.campaign_id),
            investigator_id=investigator_id,
            character_path=_investigator_character_path(ctx, investigator_id),
            kind=kind,
            payload=payload,
            rng=_rng(args),
        )
    except coc_runtime_ops.RuntimeOperationError as exc:
        # A refusal that names a fixable content gap must survive projection
        # under its own code; flattening it to invalid_param would tell the
        # Keeper only that something about the call was wrong.
        raise ToolError(
            getattr(exc, "code", None) or "invalid_param",
            str(exc),
            details=getattr(exc, "details", None),
        ) from exc
    data = {
        "schema_version": 1,
        "authority": "coc7_magic_runtime",
        "investigator_id": investigator_id,
        "receipt": receipt,
    }
    ctx.ledger_record(decision_id, kind, data)
    return data, [], [
        "the magic result is authoritative; render its public roll and visible resource changes exactly once"
    ]


def _tool_magic_cast(ctx: Ctx, args: dict[str, Any]):
    return _execute_magic(ctx, args, kind="magic.cast")


def _tool_magic_learn(ctx: Ctx, args: dict[str, Any]):
    return _execute_magic(ctx, args, kind="magic.learn")


def register_operations(registry) -> None:
    registry.tool(
        "magic.cast",
        "Cast one canonical CoC7 spell through the existing magic runtime; spell names come from rules.catalog_search.",
        {
            "investigator": {"type": "string", "desc": "investigator id; defaults to the sole linked party member"},
            "spell": {"type": "string", "required": True, "desc": "exact canonical spell name returned by rules.catalog_search"},
            "pushed": {"type": "boolean", "default": False, "desc": "whether this is a pushed first-cast attempt"},
            "interrupted": {"type": "boolean", "default": False, "desc": "whether casting was interrupted"},
            "is_npc": {"type": "boolean", "default": False, "desc": "whether the caster is an NPC"},
            "decision_id": {"type": "string", "required": True, "desc": "semantic idempotency key supplied and retained by the host"},
        },
        read_domains=("party", "investigator_state"),
        write_domains=("investigator_state", "events", "rolls"),
    )(_tool_magic_cast)
    registry.tool(
        "magic.learn",
        "Learn one canonical CoC7 spell through the existing magic runtime; spell names come from rules.catalog_search.",
        {
            "investigator": {"type": "string", "desc": "investigator id; defaults to the sole linked party member"},
            "spell": {"type": "string", "required": True, "desc": "exact canonical spell name returned by rules.catalog_search"},
            "source": {"type": "string", "enum": ["tome", "person", "entity"], "default": "tome", "desc": "learning source"},
            "decision_id": {"type": "string", "required": True, "desc": "semantic idempotency key supplied and retained by the host"},
        },
        read_domains=("party", "investigator_state"),
        write_domains=("investigator_state", "events", "rolls"),
    )(_tool_magic_learn)


OPERATION_EXPORTS = (
    "_tool_magic_cast",
    "_tool_magic_learn",
)
