#!/usr/bin/env python3
"""Operation adapter cell: continuity-memory."""
from __future__ import annotations

from coc_operation_kernel_runtime import (
    Any,
    Ctx,
    ToolError,
    _SAFE_ID,
    _flags_set,
    _load_sibling,
    _now_iso,
    _resolve_investigator,
    coc_belief_state,
    coc_state,
    deepcopy,
    tool,
)

coc_threat_state = _load_sibling("coc_threat_state_toolbox", "coc_threat_state.py")

coc_epistemic_lifecycle = _load_sibling(
    "coc_epistemic_lifecycle_toolbox", "coc_epistemic_lifecycle.py"
)

coc_memory = _load_sibling("coc_memory", "coc_memory.py")

def _tool_personal_horror_query(ctx: Ctx, args: dict[str, Any]):
    investigator_id = _resolve_investigator(ctx, args)
    state = coc_state.load_investigator_state(ctx.campaign_dir, investigator_id)
    return {
        "investigator_id": investigator_id,
        "personal_horror_hooks": deepcopy(state.get("personal_horror_hooks") or []),
        "backstory_corruptions": deepcopy(state.get("backstory_corruptions") or []),
    }, [], ["these are structured KP references; weave them only when naturally relevant"]

def _tool_state_personal_horror_add(ctx: Ctx, args: dict[str, Any]):
    prior = ctx.ledger_lookup("state.personal_horror_add", args.get("decision_id"))
    if prior is not None:
        return prior.get("data"), ["duplicate decision_id: returning the previous receipt"], []
    investigator_id = _resolve_investigator(ctx, args)
    state = coc_state.load_investigator_state(ctx.campaign_dir, investigator_id)
    hook_id = str(args["hook_id"])
    if any(str(row.get("hook_id")) == hook_id for row in state.get("personal_horror_hooks") or [] if isinstance(row, dict)):
        raise ToolError("invalid_param", f"personal horror hook already exists: {hook_id}")
    coc_state.add_personal_horror_hook(
        ctx.campaign_dir,
        investigator_id,
        hook_id=hook_id,
        backstory_field=str(args["backstory_field"]),
        summary=str(args["summary"]),
    )
    data = {"investigator_id": investigator_id, "hook_id": hook_id, "woven": False}
    ctx.ledger_record(args["decision_id"], "state.personal_horror_add", data)
    return data, [], ["the hook is available to the Director but never mandatory"]

def _tool_state_personal_horror_mark_woven(ctx: Ctx, args: dict[str, Any]):
    prior = ctx.ledger_lookup("state.personal_horror_mark_woven", args.get("decision_id"))
    if prior is not None:
        return prior.get("data"), ["duplicate decision_id: returning the previous receipt"], []
    investigator_id = _resolve_investigator(ctx, args)
    hook_id = str(args["hook_id"])
    state = coc_state.load_investigator_state(ctx.campaign_dir, investigator_id)
    matches = [row for row in state.get("personal_horror_hooks") or [] if isinstance(row, dict) and str(row.get("hook_id")) == hook_id]
    if len(matches) != 1:
        raise ToolError("invalid_param", f"personal horror hook not found exactly once: {hook_id}")
    coc_state.mark_hook_woven(ctx.campaign_dir, investigator_id, hook_id)
    data = {"investigator_id": investigator_id, "hook_id": hook_id, "woven": True}
    ctx.ledger_record(args["decision_id"], "state.personal_horror_mark_woven", data)
    return data, [], []

def _tool_state_backstory_corruption_add(ctx: Ctx, args: dict[str, Any]):
    prior = ctx.ledger_lookup("state.backstory_corruption_add", args.get("decision_id"))
    if prior is not None:
        return prior.get("data"), ["duplicate decision_id: returning the previous receipt"], []
    investigator_id = _resolve_investigator(ctx, args)
    coc_state.add_backstory_corruption(
        ctx.campaign_dir,
        investigator_id,
        mode=str(args["mode"]),
        backstory_field=str(args["backstory_field"]),
        keeper_note=str(args["keeper_note"]),
    )
    data = {
        "investigator_id": investigator_id,
        "mode": str(args["mode"]),
        "backstory_field": str(args["backstory_field"]),
    }
    ctx.ledger_record(args["decision_id"], "state.backstory_corruption_add", data)
    return data, [], ["this records an accepted consequence; it does not author one automatically"]

def _memory_query_terms(args: dict[str, Any], key: str) -> list[str]:
    raw = args.get(key)
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise ToolError("invalid_param", f"{key} must be an array of strings")
    return [str(item).strip() for item in raw if str(item).strip()]

def _memory_card_projection(card: dict[str, Any]) -> dict[str, Any]:
    projection = {
        "memory_id": card.get("memory_id"),
        "kind": card.get("kind"),
        "privacy": card.get("privacy"),
        "salience": card.get("salience"),
        "entities": deepcopy(card.get("entities") or []),
        "tags": deepcopy(card.get("tags") or []),
        "reactivation_cues": deepcopy(card.get("reactivation_cues") or []),
        "summary": card.get("body", ""),
        "score": card.get("score"),
    }
    for optional in ("status", "introduced_at", "resolved_at", "possible_payoff", "scenes"):
        if card.get(optional) not in (None, ""):
            projection[optional] = deepcopy(card.get(optional))
    return projection

def _tool_memory_search(ctx: Ctx, args: dict[str, Any]):
    kinds = _memory_query_terms(args, "kinds")
    invalid_kinds = sorted(set(kinds) - set(coc_memory.CARD_KINDS))
    if invalid_kinds:
        raise ToolError(
            "invalid_param",
            "unknown memory card kind(s): " + ", ".join(invalid_kinds)
            + "; expected " + ", ".join(coc_memory.CARD_KINDS),
        )
    statuses = _memory_query_terms(args, "statuses")
    invalid_statuses = sorted(set(statuses) - set(coc_memory.HOOK_STATUSES))
    if invalid_statuses:
        raise ToolError(
            "invalid_param",
            "unknown memory card status(es): " + ", ".join(invalid_statuses)
            + "; expected " + ", ".join(coc_memory.HOOK_STATUSES),
        )
    view = str(args.get("view") or "keeper")
    if view not in {"keeper", "player_safe"}:
        raise ToolError("invalid_param", "view must be keeper or player_safe")
    limit = max(1, min(20, int(args.get("limit") or 5)))
    cards = coc_memory.retrieve_memory_cards(
        campaign_dir=ctx.campaign_dir,
        query_entities=_memory_query_terms(args, "entities"),
        query_cues=_memory_query_terms(args, "cues"),
        query_tags=_memory_query_terms(args, "tags"),
        privacy_filter="player_safe" if view == "player_safe" else "keeper",
        limit=limit,
        kinds=kinds or None,
        statuses=statuses or None,
    )
    return {
        "schema_version": 1,
        "authority": "advisory",
        "hard_gate": False,
        "view": view,
        "count": len(cards),
        "cards": [_memory_card_projection(card) for card in cards],
    }, [], [
        "memory cards are semantic context, never authoritative facts; state.*/rules.* own truth",
        "results carry privacy labels — keeper_only/system_only content never becomes player prose without earned play",
    ]

def _tool_memory_write(ctx: Ctx, args: dict[str, Any]):
    prior = ctx.ledger_lookup("memory.write", args.get("decision_id"))
    if prior is not None:
        return prior.get("data"), ["duplicate decision_id: returning the previous receipt"], []
    memory_id = str(args["memory_id"]).strip()
    if not _SAFE_ID.match(memory_id):
        raise ToolError("invalid_param", f"invalid memory_id: {memory_id!r}")
    privacy = str(args["privacy"])
    if privacy not in coc_memory.PRIVACY_DIRS:
        raise ToolError(
            "invalid_param",
            "privacy must be one of " + ", ".join(sorted(coc_memory.PRIVACY_DIRS)),
        )
    summary = str(args["summary"]).strip()
    if not summary:
        raise ToolError("invalid_param", "summary is required")
    if coc_memory.find_card(ctx.campaign_dir, memory_id) is not None:
        raise ToolError("invalid_param", f"memory card already exists: {memory_id}")
    salience = float(args.get("salience") if args.get("salience") is not None else 0.5)
    if not 0.0 <= salience <= 1.0:
        raise ToolError("invalid_param", "salience must be within 0..1")
    status = args.get("status")
    try:
        path = coc_memory.create_memory_card(
            campaign_dir=ctx.campaign_dir,
            memory_id=memory_id,
            privacy=privacy,
            summary=summary,
            entities=_memory_query_terms(args, "entities"),
            tags=_memory_query_terms(args, "tags"),
            reactivation_cues=_memory_query_terms(args, "reactivation_cues"),
            kind=str(args["kind"]),
            status=str(status) if status is not None else None,
            introduced_at=(
                str(args["introduced_at"]) if args.get("introduced_at") else None
            ),
            salience=salience,
            scenes=_memory_query_terms(args, "scenes"),
            possible_payoff=str(args.get("possible_payoff") or ""),
            source_events=[str(args.get("decision_id") or "")],
        )
    except ValueError as exc:
        raise ToolError("invalid_param", str(exc)) from exc
    written = coc_memory.find_card(ctx.campaign_dir, memory_id) or {}
    data = {
        "memory_id": memory_id,
        "kind": written.get("kind"),
        "status": written.get("status"),
        "privacy": privacy,
        "path": str(path),
    }
    ctx.ledger_record(args["decision_id"], "memory.write", data)
    return data, [], [
        "the card is retrieval context only; authoritative facts still live in state.*/rules.*",
    ]

def _tool_memory_resolve_hook(ctx: Ctx, args: dict[str, Any]):
    prior = ctx.ledger_lookup("memory.resolve_hook", args.get("decision_id"))
    if prior is not None:
        return prior.get("data"), ["duplicate decision_id: returning the previous receipt"], []
    memory_id = str(args["memory_id"]).strip()
    try:
        receipt = coc_memory.resolve_hook_card(
            ctx.campaign_dir,
            memory_id,
            str(args["resolution"]),
            resolved_at=str(args.get("resolved_at") or ""),
            reason=str(args.get("reason") or ""),
        )
    except ValueError as exc:
        raise ToolError("invalid_param", str(exc)) from exc
    ctx.ledger_record(args["decision_id"], "memory.resolve_hook", receipt)
    warnings = (
        ["hook was already in this status: no lifecycle change was written"]
        if receipt.get("already_resolved")
        else []
    )
    return receipt, warnings, [
        "record the fictional payoff itself through ordinary narration and state tools; this only closes the memory ledger",
    ]

def _tool_threat_query(ctx: Ctx, args: dict[str, Any]):
    definitions = ctx.scenario("threat-fronts.json") or {"fronts": []}
    persisted = coc_threat_state.load_threat_state(ctx.campaign_dir / "save")
    return {
        "schema_version": 1,
        "authority": "structured_state",
        "threat_fronts": coc_threat_state.merge_threat_fronts(definitions, persisted),
    }, [], ["threat pressure is context; it does not force a scene transition or narration beat"]

def _tool_state_threat_tick(ctx: Ctx, args: dict[str, Any]):
    prior = ctx.ledger_lookup("state.threat_tick", args.get("decision_id"))
    if prior is not None:
        return prior.get("data"), ["duplicate decision_id: returning the previous receipt"], []
    clock_id = str(args["clock_id"])
    definitions = ctx.scenario("threat-fronts.json") or {"fronts": []}
    clock = next(
        (
            row
            for front in definitions.get("fronts") or []
            if isinstance(front, dict)
            for row in front.get("clocks") or []
            if isinstance(row, dict) and str(row.get("clock_id")) == clock_id
        ),
        None,
    )
    if clock is None:
        raise ToolError("invalid_param", f"unknown authored threat clock: {clock_id}")
    segments = int(clock.get("segments") or 6)
    became_full = coc_threat_state.tick_clock(
        ctx.campaign_dir / "save",
        clock_id,
        segments,
        source_id=str(args["decision_id"]),
    )
    current = coc_threat_state.get_clock_segments(ctx.campaign_dir / "save", clock_id)
    data = {
        "clock_id": clock_id,
        "current_segments": current,
        "segments": segments,
        "full": current >= segments,
        "became_full": became_full,
        "candidate_on_full": deepcopy(clock.get("on_full")) if became_full else None,
    }
    ctx.ledger_record(args["decision_id"], "state.threat_tick", data)
    return data, [], ["candidate_on_full is advice for the KP; apply any real state change through its authoritative tool"]

def _tool_epistemic_query(ctx: Ctx, args: dict[str, Any]):
    graph = ctx.scenario("epistemic-graph.json")
    state = coc_belief_state.read_belief_state(ctx.campaign_dir)
    world = ctx.world()
    transitions = coc_epistemic_lifecycle.evaluate_question_transitions(
        graph,
        state,
        world,
        list(world.get("discovered_clue_ids") or []),
        flags_set=_flags_set(ctx),
        visited_scene_ids=world.get("visited_scene_ids") or [],
    )
    return {
        "schema_version": 1,
        "authority": "advisory",
        "questions": deepcopy(graph.get("questions") or []),
        "belief_state": state,
        "candidate_transitions": transitions,
    }, [], ["candidate transitions are structured advice until an adopted plan is committed"]

def _tool_state_belief_apply(ctx: Ctx, args: dict[str, Any]):
    prior = ctx.ledger_lookup("state.belief_apply", args.get("decision_id"))
    if prior is not None:
        return prior.get("data"), ["duplicate decision_id: returning the previous receipt"], []
    plan = args.get("candidate_plan")
    if not isinstance(plan, dict):
        raise ToolError("invalid_param", "candidate_plan must be an object")
    plan_decision = plan.get("decision_id")
    if plan_decision is not None and str(plan_decision) != str(args.get("decision_id")):
        raise ToolError("invalid_param", "candidate_plan.decision_id must match decision_id")
    clues = args.get("committed_clue_ids") or []
    if not isinstance(clues, list) or any(not isinstance(value, str) for value in clues):
        raise ToolError("invalid_param", "committed_clue_ids must be an array of strings")
    world_clues = {str(value) for value in ctx.world().get("discovered_clue_ids") or []}
    if not set(clues).issubset(world_clues):
        raise ToolError("invalid_param", "committed_clue_ids must already exist in world state")
    investigator_id = _resolve_investigator(ctx, args)
    events = coc_belief_state.apply_belief_turn(
        ctx.campaign_dir,
        plan,
        clues,
        investigator_id,
        _now_iso(),
    )
    data = {"investigator_id": investigator_id, "events": events}
    ctx.ledger_record(args["decision_id"], "state.belief_apply", data)
    return data, [], ["belief state now reflects only the adopted plan and already-committed evidence"]

def register_operations(registry) -> None:
    global TOOLS
    TOOLS = registry.legacy_tools
    registry.tool(
    "personal_horror.query",
    "Read structured personal-horror hooks and accepted backstory corruptions without scanning character prose.",
    {"investigator": {"type": "string", "desc": "investigator id"}},
)(_tool_personal_horror_query)
    registry.tool(
    "state.personal_horror_add",
    "Persist one structured personal-horror hook after the KP has accepted it.",
    {
        "investigator": {"type": "string", "desc": "investigator id"},
        "hook_id": {"type": "string", "required": True, "desc": "stable hook id"},
        "backstory_field": {"type": "string", "required": True, "desc": "structured character-sheet backstory field"},
        "summary": {"type": "string", "required": True, "desc": "concise keeper summary"},
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)(_tool_state_personal_horror_add)
    registry.tool(
    "state.personal_horror_mark_woven",
    "Mark a structured personal-horror hook as actually woven after it appears in delivered play.",
    {
        "investigator": {"type": "string", "desc": "investigator id"},
        "hook_id": {"type": "string", "required": True, "desc": "existing hook id"},
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)(_tool_state_personal_horror_mark_woven)
    registry.tool(
    "state.backstory_corruption_add",
    "Persist an accepted SanitySession backstory amendment using structured fields only.",
    {
        "investigator": {"type": "string", "desc": "investigator id"},
        "mode": {"type": "string", "required": True, "desc": "corrupt_existing | add_irrational"},
        "backstory_field": {"type": "string", "required": True, "desc": "structured backstory field"},
        "keeper_note": {"type": "string", "required": True, "desc": "accepted amendment note"},
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)(_tool_state_backstory_corruption_add)
    registry.tool(
    "memory.search",
    "Retrieve campaign memory cards by structured kind/status/entity/cue overlap. Data for KP semantic judgment; memory is never authoritative truth.",
    {
        "entities": {"type": "array", "items": {"type": "string"}, "desc": "structured entity ids to overlap"},
        "cues": {"type": "array", "items": {"type": "string"}, "desc": "reactivation cues to overlap"},
        "tags": {"type": "array", "items": {"type": "string"}, "desc": "structured tags to overlap"},
        "kinds": {"type": "array", "items": {"type": "string"}, "desc": "filter by card kind (fact/event/npc_relationship/unresolved_hook/foreshadowing/player_preference/keeper_correction)"},
        "statuses": {"type": "array", "items": {"type": "string"}, "desc": "filter hook lifecycle status (open/resolved/paid_off/abandoned)"},
        "view": {"type": "string", "enum": ["keeper", "player_safe"], "desc": "privacy view; keeper (default) sees keeper_only cards, results always carry privacy labels"},
        "limit": {"type": "integer", "desc": "max cards (default 5, max 20)"},
    },
    access="query",
)(_tool_memory_search)
    registry.tool(
    "memory.write",
    "Write one typed campaign memory card (fact/event/npc_relationship/unresolved_hook/foreshadowing/player_preference/keeper_correction). Idempotent via decision_id.",
    {
        "memory_id": {"type": "string", "required": True, "desc": "stable card id (also the filename)"},
        "kind": {"type": "string", "required": True, "desc": "card kind from the closed enum"},
        "privacy": {"type": "string", "enum": ["player_safe", "keeper_only", "system_only"], "required": True, "desc": "existing privacy tier; controls card directory and projection"},
        "summary": {"type": "string", "required": True, "desc": "short play-language summary body"},
        "entities": {"type": "array", "items": {"type": "string"}, "desc": "structured entity ids"},
        "tags": {"type": "array", "items": {"type": "string"}, "desc": "structured tags"},
        "reactivation_cues": {"type": "array", "items": {"type": "string"}, "desc": "cues that should resurface this card"},
        "salience": {"type": "number", "desc": "0..1 retrieval weight (default 0.5)"},
        "status": {"type": "string", "desc": "hook lifecycle status; only for unresolved_hook/foreshadowing (default open)"},
        "introduced_at": {"type": "string", "desc": "turn/scene reference where this was introduced"},
        "scenes": {"type": "array", "items": {"type": "string"}, "desc": "related scene ids"},
        "possible_payoff": {"type": "string", "desc": "keeper note on how this could pay off"},
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)(_tool_memory_write)
    registry.tool(
    "memory.resolve_hook",
    "Transition an unresolved_hook/foreshadowing card's lifecycle status (resolved/paid_off/abandoned) with resolved_at evidence. Idempotent via decision_id.",
    {
        "memory_id": {"type": "string", "required": True, "desc": "existing hook/foreshadowing card id"},
        "resolution": {"type": "string", "enum": ["resolved", "paid_off", "abandoned"], "required": True, "desc": "terminal lifecycle status"},
        "resolved_at": {"type": "string", "desc": "turn/scene reference where the payoff or abandonment happened"},
        "reason": {"type": "string", "desc": "keeper note on how it resolved"},
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)(_tool_memory_resolve_hook)
    registry.tool(
    "threat.query",
    "Read authored threat fronts with verified live current_segments projected onto them.",
    {},
)(_tool_threat_query)
    registry.tool(
    "state.threat_tick",
    "Advance one authored threat clock segment transactionally. Consequences are returned as advice, never auto-narrated.",
    {
        "clock_id": {"type": "string", "required": True, "desc": "authored clock id"},
        "decision_id": {"type": "string", "desc": "idempotency key and stable source id"},
    },
)(_tool_state_threat_tick)
    registry.tool(
    "epistemic.query",
    "Read compiled open questions, belief state, and structured lifecycle suggestions from current evidence.",
    {},
)(_tool_epistemic_query)
    registry.tool(
    "state.belief_apply",
    "Apply an adopted Director epistemic contract and committed clues to the persistent belief ledger.",
    {
        "investigator": {"type": "string", "desc": "investigator id"},
        "candidate_plan": {"type": "object", "required": True, "desc": "adopted or KP-modified Director plan"},
        "committed_clue_ids": {"type": "array", "desc": "clue ids already committed by state.record_clue"},
        "decision_id": {"type": "string", "desc": "idempotency key; must match plan decision_id when present"},
    },
)(_tool_state_belief_apply)


OPERATION_EXPORTS = (
    '_memory_card_projection',
    '_memory_query_terms',
    '_tool_epistemic_query',
    '_tool_memory_resolve_hook',
    '_tool_memory_search',
    '_tool_memory_write',
    '_tool_personal_horror_query',
    '_tool_state_backstory_corruption_add',
    '_tool_state_belief_apply',
    '_tool_state_personal_horror_add',
    '_tool_state_personal_horror_mark_woven',
    '_tool_state_threat_tick',
    '_tool_threat_query',
    'coc_epistemic_lifecycle',
    'coc_memory',
    'coc_threat_state',
)
