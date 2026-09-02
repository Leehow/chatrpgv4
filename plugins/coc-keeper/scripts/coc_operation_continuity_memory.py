#!/usr/bin/env python3
"""Operation adapter cell: continuity-memory."""
from __future__ import annotations

from coc_operation_kernel_runtime import (
    Any,
    Ctx,
    ToolError,
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

coc_quest_state = _load_sibling("coc_quest_state_toolbox", "coc_quest_state.py")

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

def _tool_state_characteristic_delta(ctx: Ctx, args: dict[str, Any]):
    prior = ctx.ledger_lookup("state.characteristic_delta", args.get("decision_id"))
    if prior is not None:
        return prior.get("data"), ["duplicate decision_id: returning the previous receipt"], []
    investigator_id = _resolve_investigator(ctx, args)
    try:
        delta = int(args["delta"])
    except (TypeError, ValueError) as exc:
        raise ToolError("invalid_param", "delta must be a non-zero integer") from exc
    reason = str(args.get("reason") or "").strip()
    if not reason:
        raise ToolError(
            "invalid_param",
            "reason must state the in-fiction cause of the characteristic change",
        )
    try:
        result = coc_state.apply_stat_delta(
            ctx.campaign_dir,
            investigator_id,
            stat=str(args["characteristic"]),
            delta=delta,
        )
    except ValueError as exc:
        raise ToolError("invalid_param", str(exc)) from exc
    except FileNotFoundError as exc:
        raise ToolError("unknown_investigator", str(exc)) from exc
    data = {**result, "reason": reason}
    ctx.ledger_record(args["decision_id"], "state.characteristic_delta", data)
    hints = [
        "derived values were recomputed and are authoritative; do not restate "
        "or recompute HP/MP/SAN/DB/Build/MOV yourself",
    ]
    if result["stat_kind"] == "house_rule":
        hints.append(
            "this is a house-rule stat: it is stored and reported, and it "
            "never feeds a derivation it was not part of"
        )
    if result["clamped_pools"]:
        hints.append(
            "a maximum dropped below its current pool, so the pool was clamped; "
            "narrate that loss rather than a separate injury"
        )
    if result["floored"]:
        hints.append(
            "the requested delta would have taken the stat below its floor, "
            "so it stopped there"
        )
    return data, [], hints


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

def _quest_definition(ctx: Ctx, quest_id: str) -> dict[str, Any]:
    definitions = coc_quest_state.read_quest_definitions(
        ctx.campaign_dir, root=ctx.root,
    )
    definition = definitions.get(quest_id)
    if definition is None:
        raise ToolError(
            "invalid_param",
            f"unknown quest {quest_id!r}; quest.map lists every known quest id",
        )
    return definition

def _tool_quest_map(ctx: Ctx, args: dict[str, Any]):
    projection = coc_quest_state.quest_projection(
        ctx.campaign_dir, world=ctx.world(), root=ctx.root,
    )
    return projection, [], [
        "advisory pressure only: quests never block actions, scenes, or "
        "endings; nothing here is player-safe before the quest is offered",
    ]

def _tool_quest_offer(ctx: Ctx, args: dict[str, Any]):
    tool_name = "quest.offer"
    prior = ctx.ledger_lookup(tool_name, args.get("decision_id"))
    if prior is not None:
        return prior.get("data"), ["duplicate decision_id: returning the previous receipt"], []
    decision_id = str(args["decision_id"])
    quest_id = str(args["quest_id"])
    _quest_definition(ctx, quest_id)
    try:
        receipt = coc_quest_state.transition_quest(
            ctx.campaign_dir, quest_id, "offer", decision_id,
        )
    except coc_quest_state.QuestStateError as exc:
        raise ToolError("invalid_state", str(exc)) from exc
    data = {"quest_id": quest_id, "status": "offered", "receipt": receipt}
    ctx.ledger_record(decision_id, tool_name, data)
    return data, [], [
        "the quest is player-visible from this transition; render the offer "
        "diegetically in play_language",
    ]

def _tool_quest_activate(ctx: Ctx, args: dict[str, Any]):
    tool_name = "quest.activate"
    prior = ctx.ledger_lookup(tool_name, args.get("decision_id"))
    if prior is not None:
        return prior.get("data"), ["duplicate decision_id: returning the previous receipt"], []
    decision_id = str(args["decision_id"])
    quest_id = str(args["quest_id"])
    _quest_definition(ctx, quest_id)
    try:
        receipt = coc_quest_state.transition_quest(
            ctx.campaign_dir, quest_id, "activate", decision_id,
        )
    except coc_quest_state.QuestStateError as exc:
        raise ToolError("invalid_state", str(exc)) from exc
    data = {"quest_id": quest_id, "status": "active", "receipt": receipt}
    ctx.ledger_record(decision_id, tool_name, data)
    return data, [], [
        "acceptance is your semantic call; this only records the state move",
    ]

def _tool_quest_settle(ctx: Ctx, args: dict[str, Any]):
    tool_name = "quest.settle"
    prior = ctx.ledger_lookup(tool_name, args.get("decision_id"))
    if prior is not None:
        return prior.get("data"), ["duplicate decision_id: returning the previous receipt"], []
    decision_id = str(args["decision_id"])
    quest_id = str(args["quest_id"])
    outcome = str(args["outcome"])
    basis = str(args["basis"]) if args.get("basis") is not None else None
    _quest_definition(ctx, quest_id)
    try:
        receipt = coc_quest_state.transition_quest(
            ctx.campaign_dir,
            quest_id,
            f"settle-{outcome}",
            decision_id,
            settled_by="keeper",
            basis=basis,
            ts=_now_iso(),
        )
    except coc_quest_state.QuestStateError as exc:
        message = str(exc)
        code = "idempotency_conflict" if "already applied" in message else "invalid_state"
        raise ToolError(code, message) from exc
    data = {
        "quest_id": quest_id,
        "outcome": outcome,
        "receipt": receipt,
    }
    ctx.ledger_record(decision_id, tool_name, data)
    return data, [], [
        "narrative conditions close only here; the close receipt is the "
        "audit trail for what ended the quest and why",
    ]

def _tool_quest_improvise(ctx: Ctx, args: dict[str, Any]):
    tool_name = "quest.improvise"
    prior = ctx.ledger_lookup(tool_name, args.get("decision_id"))
    if prior is not None:
        return prior.get("data"), ["duplicate decision_id: returning the previous receipt"], []
    decision_id = str(args["decision_id"])
    quest = args.get("quest")
    if not isinstance(quest, dict):
        raise ToolError("invalid_param", "quest must be a quest definition object")
    quest_id = str(quest.get("quest_id") or "").strip()
    if not quest_id.startswith("quest-"):
        raise ToolError(
            "invalid_param",
            "quest_id must be a semantic id matching quest-<slug>",
        )
    slug = quest_id[len("quest-"):]
    asset_root_id = coc_quest_state.campaign_quest_asset_root_id(ctx.campaign_dir)
    if not asset_root_id:
        raise ToolError(
            "invalid_state",
            "campaign has no module asset root bound; improvised quests are "
            "authored as campaign-improvised entity packs and need a root "
            "(scenario.json progressive/source_cache asset root id)",
        )
    payload = dict(quest)
    # Controlled improvisation: the campaign, not a source module, is the
    # authority for this quest, so provenance is forced and the pack enters
    # the store fully parsed. put_entity revalidates the whole frozen shape.
    payload["provenance"] = "campaign-improvised"
    payload["parse_state"] = "deep"
    payload["evidence_gap"] = False
    payload.pop("schema_version", None)
    payload.pop("updated_at", None)
    payload.pop("source_span", None)
    payload.pop("page_text_sha256", None)
    payload.pop("source_refs", None)
    payload.pop("source_evidence", None)
    payload.pop("origin", None)
    try:
        stored = coc_quest_state.coc_module_assets.put_entity(
            ctx.root, asset_root_id, "quest", slug, payload,
        )
    except coc_quest_state.coc_module_assets.ModuleAssetsError as exc:
        raise ToolError("invalid_param", str(exc)) from exc
    data = {
        "quest_id": quest_id,
        "status": "authored",
        "definition_source": "entity_pack",
        "asset_root_id": asset_root_id,
        "pack_path": stored.get("path"),
        "provenance": "campaign-improvised",
    }
    ctx.ledger_record(decision_id, tool_name, data)
    return data, [], [
        "the improvised quest is campaign canon with provenance "
        "campaign-improvised; offer it with quest.offer when the fiction is "
        "ready",
    ]

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
    "threat.query",
    "Read authored threat fronts with verified live current_segments projected onto them.",
    {},
)(_tool_threat_query)
    registry.tool(
    "state.characteristic_delta",
    "Apply a signed change to any numeric stat on an investigator (the `characteristic` argument takes any stat name, not only STR..EDU). A core characteristic (STR/CON/SIZ/DEX/APP/INT/POW/EDU) re-derives everything that reads from it; a derived value (HP/MP/SAN/Luck/Build/MOV) is recorded as an override that survives later recomputation; any other name is a house-rule stat. Current pools above a dropped maximum are clamped. Use for authored consequences that cost a stat: a spell's POW cost, a drain, time-loop ageing, or whatever this table's rules cost.",
    {
        "investigator": {"type": "string", "desc": "investigator id; defaults to the active PC"},
        "characteristic": {
            "type": "string",
            "required": True,
            "desc": "any stat name: a characteristic (STR..EDU), a derived value (HP/MP/SAN/Luck/Build/MOV), or this table's own house-rule stat",
        },
        "delta": {
            "type": "integer",
            "required": True,
            "desc": "signed change; negative drains, positive restores",
        },
        "reason": {
            "type": "string",
            "required": True,
            "desc": "in-fiction cause of the change, in the campaign's play language",
        },
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)(_tool_state_characteristic_delta)
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
    registry.tool(
    "quest.map",
    "Read the campaign quest projection: every known quest with status, machine condition progress, and player-safe faces. Keeper-only advisory; quests never gate play.",
    {},
    access="query",
)(_tool_quest_map)
    registry.tool(
    "quest.offer",
    "Move a quest authored->offered (decision_id idempotent). The offered transition is what first makes a quest player-visible.",
    {
        "quest_id": {"type": "string", "required": True, "desc": "quest id from quest.map (quest-<slug>)"},
        "decision_id": {"type": "string", "required": True, "desc": "idempotency key"},
    },
)(_tool_quest_offer)
    registry.tool(
    "quest.activate",
    "Move a quest offered->active after the players accept it (decision_id idempotent). Acceptance itself is a KP semantic judgment.",
    {
        "quest_id": {"type": "string", "required": True, "desc": "quest id currently offered"},
        "decision_id": {"type": "string", "required": True, "desc": "idempotency key"},
    },
)(_tool_quest_activate)
    registry.tool(
    "quest.settle",
    "Close a quest active->completed|failed|abandoned (or drop an unaccepted quest to abandoned) with a close receipt. Narrative conditions close only through this operation.",
    {
        "quest_id": {"type": "string", "required": True, "desc": "quest id to close"},
        "outcome": {"type": "string", "required": True, "enum": ["completed", "failed", "abandoned"], "desc": "terminal status"},
        "basis": {"type": "string", "desc": "keeper semantic note recorded in the close receipt (required in spirit for narrative closures)"},
        "decision_id": {"type": "string", "required": True, "desc": "idempotency key"},
    },
)(_tool_quest_settle)
    registry.tool(
    "quest.improvise",
    "Author a campaign-improvised quest at runtime as an entity pack (provenance forced to campaign-improvised; the frozen contract is revalidated on write). Idempotent via decision_id.",
    {
        "quest": {"type": "object", "required": True, "additionalProperties": True, "desc": "quest definition per the frozen quest v1 contract (quest_id, title, quest_kinds, importance, brief, completion, secret, ...)"},
        "decision_id": {"type": "string", "required": True, "desc": "idempotency key"},
    },
)(_tool_quest_improvise)


OPERATION_EXPORTS = (
    '_tool_epistemic_query',
    '_tool_personal_horror_query',
    '_tool_quest_activate',
    '_tool_quest_improvise',
    '_tool_quest_map',
    '_tool_quest_offer',
    '_tool_quest_settle',
    '_tool_state_backstory_corruption_add',
    '_tool_state_belief_apply',
    '_tool_state_personal_horror_add',
    '_tool_state_personal_horror_mark_woven',
    '_tool_state_threat_tick',
    '_tool_threat_query',
    'coc_epistemic_lifecycle',
    'coc_threat_state',
)
