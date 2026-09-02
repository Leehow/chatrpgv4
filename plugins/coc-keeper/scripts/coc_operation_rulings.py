#!/usr/bin/env python3
"""Operation adapter cell: rulings.

The Keeper-facing half of session rulings.  `coc_session_rulings` owns the
record, its expiry arithmetic and its retrieval; this cell is the one way a
live Keeper puts a ruling into that store, and the one place a ruling and a
confirmed house rule are handed back at the decision they bind.

A ruling is precedent, never authority over results: nothing here touches
dice, pools, or settled state, and nothing here gates a call.
"""
from __future__ import annotations

from coc_operation_kernel_runtime import (
    Any,
    Ctx,
    ToolError,
    _load_sibling,
    coc_state,
    deepcopy,
    tool,
)

import json
from pathlib import Path

coc_session_rulings = _load_sibling(
    "coc_session_rulings_toolbox", "coc_session_rulings.py"
)
coc_house_rules = _load_sibling("coc_house_rules_toolbox", "coc_house_rules.py")
coc_rulesets_rulings = _load_sibling("coc_rulesets_rulings", "coc_rulesets.py")
coc_table_precedent = _load_sibling(
    "coc_table_precedent_toolbox", "coc_table_precedent.py"
)


def _ruleset_root(ctx: Ctx) -> Path:
    """The active ruleset's package directory, where rule-graph.json lives."""
    campaign = (
        coc_state.load_campaign_state(ctx.campaign_dir)
        if ctx.campaign_dir is not None
        else None
    )
    ruleset_id = coc_rulesets_rulings.get_campaign_ruleset_id(campaign)
    return coc_rulesets_rulings.ruleset_data_dir(ruleset_id).parent


def _known_decision_ids(ctx: Ctx) -> frozenset[str]:
    try:
        return coc_session_rulings.decision_ids_for_ruleset(_ruleset_root(ctx))
    except coc_session_rulings.SessionRulingError as exc:
        raise ToolError("rules_unavailable", str(exc)) from exc


def _read_json(path: Path, fallback: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return fallback


def _table_position(ctx: Ctx) -> tuple[str | None, int, int]:
    """Where the table is right now: scene, session, turn.

    Read at the moment of the ruling and frozen into it.  Expiry later
    compares these against the live records, so a ruling that was made in the
    warehouse keeps saying so even after the party leaves.
    """
    save = Path(ctx.campaign_dir) / "save"
    scene = _read_json(save / "active-scene.json", {})
    session = _read_json(save / "session-state.json", {})
    pacing = _read_json(save / "pacing-state.json", {})
    scene_id = scene.get("scene_id") if isinstance(scene, dict) else None
    if not isinstance(scene_id, str) or not scene_id:
        scene_id = None
    seq = session.get("table_session_seq") if isinstance(session, dict) else None
    if not isinstance(seq, int) or isinstance(seq, bool):
        seq = 1
    turn = pacing.get("turn_number") if isinstance(pacing, dict) else None
    if not isinstance(turn, int) or isinstance(turn, bool) or turn < 0:
        turn = 0
    return scene_id, seq, turn


def _tool_rules_record_ruling(ctx: Ctx, args: dict[str, Any]):
    prior = ctx.ledger_lookup("rules.record_ruling", args.get("decision_id"))
    if prior is not None:
        return prior.get("data"), [
            "duplicate decision_id: returning the previous receipt",
        ], []

    scene_id, session_seq, turn = _table_position(ctx)
    scope_kind = str(args.get("scope_kind") or "scene")
    scope_id = args.get("scope_id")
    if scope_kind == "scene" and not scope_id:
        # The Keeper almost always means "here". Defaulting to the live scene
        # is safe because a scene ruling that names no scene is refused
        # downstream anyway, and guessing is not involved: the scene is read
        # from campaign state, not inferred from what the ruling says.
        scope_id = scene_id
    ruling = {
        "ruling_id": str(args.get("ruling_id") or ""),
        "decision_ref": str(args.get("decision_ref") or ""),
        "scope_kind": scope_kind,
        "scope_id": scope_id if scope_kind == "scene" else None,
        "expires": str(args.get("expires") or "scene_end"),
        "statement": str(args.get("statement") or ""),
        "reason": str(args.get("reason") or ""),
        "bound_scene_id": scene_id,
        "bound_session_seq": session_seq,
        "source_turn": turn,
        "superseded_by": None,
    }
    try:
        outcome = coc_session_rulings.record_ruling(
            ctx.campaign_dir, ruling,
            known_decision_ids=_known_decision_ids(ctx),
        )
    except coc_session_rulings.SessionRulingError as exc:
        raise ToolError("invalid_param", str(exc)) from exc

    data = {
        "ruling": outcome["ruling"],
        "recorded": outcome["recorded"],
        "scene_id": scene_id,
        "table_session_seq": session_seq,
    }
    ctx.ledger_record(args["decision_id"], "rules.record_ruling", data)
    return data, [], [
        "this is precedent, not a rule change: it does not alter dice, pools, "
        "or any settled result, and it never forces a later call",
        "it will be handed back with this decision while it is in scope; a "
        "different call later is yours to make, and worth saying why",
    ]


def _tool_rules_precedent(ctx: Ctx, args: dict[str, Any]):
    decision_ref = str(args.get("decision_ref") or "").strip()
    if not decision_ref:
        raise ToolError("invalid_param", "decision_ref is required")
    return coc_table_precedent.precedent_for_decisions(
        ctx.campaign_dir, [decision_ref],
    ), [], []


def register_operations(registry) -> None:
    global TOOLS
    TOOLS = registry.legacy_tools
    registry.tool(
        "rules.record_ruling",
        "Record a call you just made where the rules left room, bound to the "
        "decision it adjudicated, so the same situation is adjudicated the "
        "same way later in this campaign. Use it when you resolved an "
        "ambiguity at the table -- what a pushed roll costs here, what counts "
        "as cover in this room, whether this NPC's help grants a bonus die. It "
        "is precedent only: it changes no dice, no pools, and no settled "
        "result, and it never forces your hand later. It is handed back to you "
        "with that decision while it is still in scope.",
        {
            "ruling_id": {
                "type": "string",
                "required": True,
                "desc": "semantic id naming the call, e.g. "
                        "'ruling:warehouse-pushed-locksmith-noise'; two or more "
                        "hyphenated words, never a digest",
            },
            "decision_ref": {
                "type": "string",
                "required": True,
                "desc": "the decision this adjudicates, e.g. "
                        "'decision:coc7:push-luck:pushed-roll'; take it from a "
                        "rules.context card",
            },
            "statement": {
                "type": "string",
                "required": True,
                "desc": "the call itself, in the campaign's play language",
            },
            "reason": {
                "type": "string",
                "required": True,
                "desc": "why the fiction made this the right call",
            },
            "scope_kind": {
                "type": "string",
                "desc": "scene (default), session, or campaign",
            },
            "scope_id": {
                "type": "string",
                "desc": "scene id for a scene ruling; defaults to the live scene",
            },
            "expires": {
                "type": "string",
                "desc": "scene_end (default), session_end, or never; a campaign "
                        "ruling must be never",
            },
            "decision_id": {"type": "string", "desc": "idempotency key"},
        },
    )(_tool_rules_record_ruling)
    registry.tool(
        "rules.precedent",
        "Read the live rulings and confirmed house rules bound to one "
        "decision, without asking for its cards. Ordinary play does not need "
        "this: rules.context already carries the same precedent for every card "
        "it returns. Reach for it when you want to check what this table has "
        "already decided about a specific decision.",
        {
            "decision_ref": {
                "type": "string",
                "required": True,
                "desc": "the decision to read precedent for",
            },
        },
    )(_tool_rules_precedent)


OPERATION_EXPORTS = (
    "_tool_rules_record_ruling",
    "_tool_rules_precedent",
)
