#!/usr/bin/env python3
"""Operation adapter cell: handouts-clues."""
from __future__ import annotations

from coc_operation_kernel_runtime import (
    Any,
    Ctx,
    ToolError,
    _all_clues,
    _clue_by_id,
    _clue_is_roll_gated,
    _clue_public_view,
    _evaluate_and_apply_unlocks,
    _now_iso,
    _operation_event_id,
    _scene_by_id,
    _settle_contextual_route,
    _skill_check_clues_missing_roll_evidence,
    coc_handouts,
    coc_module_project,
    deepcopy,
    emit_core_canonical_event,
    hashlib,
    tool,
)

def _tool_clues_query(ctx: Ctx, args: dict[str, Any]):
    world = ctx.world()
    discovered = {str(c) for c in (world.get("discovered_clue_ids") or [])}
    clues = _all_clues(ctx.clue_graph)
    if args.get("clue_id"):
        clues = [c for c in clues if str(c.get("clue_id")) == str(args["clue_id"])]
    if args.get("scene_id"):
        scene = _scene_by_id(ctx.story_graph, str(args["scene_id"]))
        allowed = {str(c) for c in (scene or {}).get("available_clues") or []}
        clues = [c for c in clues if str(c.get("clue_id")) in allowed]
    if args.get("undiscovered_only"):
        clues = [c for c in clues if str(c.get("clue_id")) not in discovered]
    conclusions = []
    for conclusion in ctx.clue_graph.get("conclusions") or []:
        if not isinstance(conclusion, dict):
            continue
        route_ids = [
            str(clue.get("clue_id"))
            for clue in conclusion.get("clues") or []
            if isinstance(clue, dict) and clue.get("clue_id")
        ]
        discovered_routes = [clue_id for clue_id in route_ids if clue_id in discovered]
        minimum_routes = int(conclusion.get("minimum_routes") or 1)
        conclusions.append({
            "conclusion_id": conclusion.get("conclusion_id"),
            "importance": conclusion.get("importance"),
            "minimum_routes": minimum_routes,
            "progress": {
                "discovered_route_ids": discovered_routes,
                "discovered_route_count": len(discovered_routes),
                "supported": len(discovered_routes) >= minimum_routes,
            },
        })
    data = {
        "discovered_clue_ids": sorted(discovered),
        "clues": [_clue_public_view(c, discovered) for c in clues],
        "conclusions": conclusions,
    }
    if args.get("include_handouts", True):
        projection = str(args.get("handouts_projection") or "keeper")
        try:
            data["handouts"] = coc_handouts.HandoutCatalog.load(ctx).project(
                world, projection
            )
        except coc_handouts.HandoutError as exc:
            raise ToolError(exc.code, exc.message) from exc
    return data, [], [
        "conclusion solution prose is intentionally omitted here; reveal only the "
        "player-safe text of clues already recorded as discovered",
        "undelivered handout card bodies are keeper-only; deliver via "
        "state.deliver_handout when the fiction earns it, then present the "
        "registered card body exactly",
        "when a handout's when_to_deliver matches the current scene or player "
        "action — especially annotated image cards (annotated-* ids with "
        "image_ref and a when_to_show hint) — call state.deliver_handout for "
        "that card in the same turn so the player sees it at the exact "
        "narrative moment it becomes relevant",
    ]

def _tool_state_deliver_handout(ctx: Ctx, args: dict[str, Any]):
    handout_id = str(args["handout_id"]).strip()
    prior = ctx.ledger_lookup("state.deliver_handout", args.get("decision_id"))
    if prior is not None:
        return prior.get("data"), [
            "duplicate decision_id: returning the previously settled result",
        ], []
    warnings: list[str] = []
    world = ctx.world()
    scene_id = str(args.get("scene_id") or "").strip() or None
    reason = str(args.get("reason") or "").strip() or None
    try:
        delivery = coc_handouts.HandoutCatalog.load(ctx).deliver(world, handout_id)
    except coc_handouts.HandoutError as exc:
        raise ToolError(exc.code, exc.message) from exc
    newly = list(delivery.newly)
    already = list(delivery.already)
    if newly:
        ctx.save_world(world)
        ctx.log_event({
            "event_type": "handout_delivered",
            "asset_id": handout_id,
            "source": "state.deliver_handout",
            **(delivery.presentation or {}),
            **({"scene_id": scene_id} if scene_id else {}),
            **({"reason": reason} if reason else {}),
            "ts": _now_iso(),
        })
    data = {
        "asset_id": handout_id,
        "delivered": True,
        "newly_delivered": newly,
        "already_delivered": already,
        "delivered_total": delivery.delivered_total,
        "card": delivery.card,
        "presentation": delivery.presentation,
    }
    hints: list[str] = []
    if newly:
        hints.append(
            "present the registered card body exactly (active-language text "
            "preferred); your narration frames who finds it and in what "
            "situation — do not rewrite or summarize the card's own text"
        )
    ctx.ledger_record(args.get("decision_id"), "state.deliver_handout", data)
    return data, warnings, hints

def _normalize_handout_replay_assertion(value: Any) -> dict[str, Any]:
    """Validate structured KP judgment without classifying player prose."""
    if not isinstance(value, dict):
        raise ToolError("invalid_param", "request_assertion must be an object")
    allowed = {
        "explicit_player_request", "player_text", "semantic_reason",
        "player_turn_epoch",
    }
    extra = set(value) - allowed
    if extra:
        raise ToolError(
            "invalid_param",
            f"request_assertion has unsupported fields: {sorted(extra)}",
        )
    if value.get("explicit_player_request") is not True:
        raise ToolError(
            "explicit_player_request_required",
            "replay requires the Keeper to assert an explicit player request; "
            "ask a clarifying question instead when the reference is ambiguous",
        )
    player_text = value.get("player_text")
    if not isinstance(player_text, str) or not player_text.strip():
        raise ToolError(
            "invalid_param", "request_assertion.player_text must be exact and nonblank"
        )
    semantic_reason = value.get("semantic_reason")
    if not isinstance(semantic_reason, str) or not semantic_reason.strip():
        raise ToolError(
            "invalid_param", "request_assertion.semantic_reason is required"
        )
    epoch = value.get("player_turn_epoch")
    if isinstance(epoch, bool) or not isinstance(epoch, int) or epoch < 1:
        raise ToolError(
            "invalid_param",
            "request_assertion.player_turn_epoch must be the current host player epoch",
        )
    return {
        "explicit_player_request": True,
        "player_text": player_text,
        "player_text_sha256": "sha256:" + hashlib.sha256(
            player_text.encode("utf-8")
        ).hexdigest(),
        "semantic_reason": semantic_reason.strip(),
        "player_turn_epoch": epoch,
    }

def _tool_state_replay_handout(ctx: Ctx, args: dict[str, Any]):
    tool_name = "state.replay_handout"
    handout_id = str(args["handout_id"]).strip()
    prior = ctx.ledger_lookup(tool_name, args.get("decision_id"))
    if prior is not None:
        return prior.get("data"), [
            "duplicate decision_id: returning the previously settled presentation"
        ], []
    assertion = _normalize_handout_replay_assertion(args.get("request_assertion"))
    world = ctx.world()
    try:
        replay = coc_handouts.HandoutCatalog.load(ctx).replay(
            world,
            handout_id,
            request_assertion=assertion,
        )
    except coc_handouts.HandoutError as exc:
        raise ToolError(exc.code, exc.message) from exc
    if not replay.already_consumed:
        ctx.save_world(world)
        ctx.log_event({
            "event_type": "handout_presented",
            **replay.presentation,
            "source": tool_name,
            "request_assertion": replay.request_assertion,
            "ts": _now_iso(),
        })
    data = {
        "asset_id": replay.asset_id,
        "delivered": True,
        "delivery_changed": False,
        "presentation": replay.presentation,
        "card": replay.card,
        "request_assertion": replay.request_assertion,
    }
    ctx.ledger_record(args.get("decision_id"), tool_name, data)
    warnings = (
        ["replay authority already consumed for this asset and player epoch; "
         "returning the original presentation"]
        if replay.already_consumed
        else []
    )
    return data, warnings, [
        "present this exact card again; do not paraphrase its body or create "
        "another delivery/material entry"
    ]

def _tool_state_record_clue(ctx: Ctx, args: dict[str, Any]):
    clue_id = str(args["clue_id"])
    prior = ctx.ledger_lookup("state.record_clue", args.get("decision_id"))
    if prior is not None:
        return prior.get("data"), ["duplicate decision_id: returning the previously settled result"], []
    world = ctx.world()
    discovered = [str(c) for c in (world.get("discovered_clue_ids") or [])]
    warnings: list[str] = []
    clue = _clue_by_id(ctx.clue_graph, clue_id)
    if clue is None:
        warnings.append(f"clue '{clue_id}' is not in the clue graph — recording anyway (improvised clue)")
    active = world.get("active_scene_id")
    scene = _scene_by_id(ctx.story_graph, active)
    if clue is not None and scene is not None:
        here = {str(c) for c in scene.get("available_clues") or []}
        if clue_id not in here:
            warnings.append(f"clue '{clue_id}' is not authored for scene '{active}' — fine if you moved it deliberately")
    if clue is not None and _clue_is_roll_gated(clue):
        missing = _skill_check_clues_missing_roll_evidence(ctx, [clue_id])
        if missing:
            gate = missing[0]
            skills = "/".join(gate["gate_skills"]) or "the authored gate skill"
            mode = gate.get("discovery_mode") or gate.get("delivery_kind")
            warnings.append(
                f"clue '{clue_id}' is authored with roll gate {mode} "
                f"({skills}) but no matching skill roll is logged — if the player "
                "simply declared this fact, run rules.roll before confirming it, "
                "or consciously rule a free reveal"
            )

    # Resolve the current-schema player handout contract before constructing
    # either discovery document.  Handout delivery is optional metadata: a bad
    # structured link becomes an advisory while canonical clue/flag/world
    # writes continue.  Missing active-language read-aloud content follows the
    # same optional-delivery boundary and performs no entitlement/presentation
    # mutation. Structured ids only; prose is never classified.
    linked_handout_id: str | None = None
    linked_handout_newly: list[str] = []
    linked_handout_presentation: dict[str, Any] | None = None
    handout_delivery_warning: dict[str, Any] | None = None
    linkage_skipped_hidden_card = False
    handout_link_resolution_attempted = False
    handout_catalog: coc_handouts.HandoutCatalog | None = None
    if (
        clue is not None
        and str(clue.get("delivery_kind") or "") == "handout"
        and str(clue.get("visibility") or "") == "player-safe"
    ):
        handout_link_resolution_attempted = True
        handout_catalog = coc_handouts.HandoutCatalog.load(ctx)
        try:
            linkage = handout_catalog.resolve_clue_delivery(
                world,
                clue_id,
                str(clue.get("handout_asset_id") or "").strip() or None,
            )
        except coc_handouts.HandoutError as exc:
            handout_delivery_warning = {
                "code": exc.code,
                "message": exc.message,
                **(
                    {
                        "handout_id": str(
                            clue.get("handout_asset_id") or ""
                        ).strip() or None,
                    }
                    if exc.code == "handout_locale_missing"
                    else {}
                ),
            }
            if exc.code == "handout_locale_missing":
                warnings.append(
                    f"{exc.code}: clue discovery was recorded but its linked "
                    "handout was not delivered because active-language content "
                    "is unavailable"
                )
            else:
                warnings.append(
                    f"optional handout delivery skipped [{exc.code}]: "
                    f"{exc.message}; clue discovery remains authoritative"
                )
        else:
            linked_handout_id = linkage.asset_id
            linked_handout_newly = list(linkage.newly)
            linked_handout_presentation = linkage.presentation

    scene_contract = (
        (scene or {}).get("scene_contract") if isinstance(scene, dict) else None
    )
    scene_contract_id = (
        str(scene_contract.get("scene_contract_id") or "").strip()
        if isinstance(scene_contract, dict)
        else ""
    )
    decision_id = str(args.get("decision_id") or "").strip()
    event_key = decision_id or f"unbound:{active}:{clue_id}"
    source_event_id = _operation_event_id("state.record_clue", event_key)
    flags = ctx.flags()
    clues_found = flags.get("clues_found") or {}
    existing_clue_record = clues_found.get(clue_id)
    clue_record = (
        deepcopy(existing_clue_record)
        if clue_id in discovered and isinstance(existing_clue_record, dict)
        else {"ts": _now_iso(), "method": args.get("method")}
    )
    if clue is None and not (
        clue_id in discovered and isinstance(existing_clue_record, dict)
    ):
        clue_record.update({
            "provenance": "improvised",
            "scene_contract_id": scene_contract_id or None,
            "scene_id": active,
            "local_only": True,
            "can_unlock_authored_milestone": False,
            "source_event_id": source_event_id,
        })
    clues_found[clue_id] = clue_record
    flags["clues_found"] = clues_found

    already = clue_id in discovered
    if not already:
        discovered.append(clue_id)
        world["discovered_clue_ids"] = discovered
    newly_unlocked = _evaluate_and_apply_unlocks(
        ctx, world, clue_records=clues_found
    )
    # Same-transaction linkage: preserve the existing best-effort behavior for
    # non-handout clues that carry an explicitly registered companion card.
    if (
        clue is not None
        and linked_handout_id is None
        and not handout_link_resolution_attempted
    ):
        asset_id = str(clue.get("handout_asset_id") or "").strip()
        if asset_id:
            try:
                linkage = (
                    handout_catalog or coc_handouts.HandoutCatalog.load(ctx)
                ).link_delivery(world, asset_id)
            except coc_handouts.HandoutError as exc:
                handout_delivery_warning = {
                    "code": exc.code,
                    "message": exc.message,
                }
                warnings.append(
                    f"optional handout delivery skipped [{exc.code}]: "
                    f"{exc.message}; clue discovery remains authoritative"
                )
            else:
                linkage_skipped_hidden_card = linkage.hidden_card
                if linkage.asset_id is None:
                    code = (
                        "handout_not_player_visible"
                        if linkage.hidden_card
                        else "unknown_handout"
                    )
                    message = (
                        f"handout '{asset_id}' is not player-visible"
                        if linkage.hidden_card
                        else f"handout '{asset_id}' is not a registered valid card"
                    )
                    handout_delivery_warning = {
                        "code": code,
                        "message": message,
                    }
                    warnings.append(
                        f"optional handout delivery skipped [{code}]: "
                        f"{message}; clue discovery remains authoritative"
                    )
                else:
                    linked_handout_id = linkage.asset_id
                    linked_handout_newly = list(linkage.newly)
                    linked_handout_presentation = linkage.presentation
    # Persist provenance before the world discovery.  A crash between these
    # two current-state files therefore fails closed for authored unlocks: a
    # local-only clue can never briefly exist as an unlabelled prerequisite.
    ctx.save_flags(flags)
    ctx.save_world(world)
    if linked_handout_newly:
        ctx.log_event({
            "event_type": "handout_delivered",
            "asset_id": linked_handout_newly[0],
            "source": "clue_linkage",
            **(linked_handout_presentation or {}),
            "clue_id": clue_id,
            "scene_id": active,
            "ts": _now_iso(),
        })

    if not already:
        clue_event = {
            "event_id": source_event_id,
            "event_type": "clue_discovered",
            "clue_id": clue_id,
            "method": args.get("method"),
            "scene_id": active,
        }
        if clue is None:
            clue_event.update({
                "provenance": "improvised",
                "scene_contract_id": scene_contract_id or None,
                "local_only": True,
                "can_unlock_authored_milestone": False,
                "source_event_id": source_event_id,
            })
        ctx.log_event(clue_event)
        _party = [str(row) for row in ctx.party_ids() if str(row).strip()]
        _discovered_by = _party[0] if len(_party) == 1 else "party"
        _clue_payload: dict[str, Any] = {
            "_v": 1,
            "clue_id": clue_id,
            "discovered_by": _discovered_by,
        }
        _clue_method = str(args.get("method") or "").strip()
        if _clue_method:
            _clue_payload["method"] = _clue_method
        if active:
            _clue_payload["scene_ref"] = str(active)
        if linked_handout_newly:
            _clue_payload["handout_ref"] = str(linked_handout_newly[0])
        _clue_visibility = (
            str((clue or {}).get("visibility") or "player-safe")
            .strip().lower()
        )
        emit_core_canonical_event(
            ctx,
            event_type="clue-discovered",
            source="coc_operation_handouts_clues.record_clue",
            decision_id=(
                decision_id or f"record-clue:{active}:{clue_id}"
            ),
            data=_clue_payload,
            privacy=(
                "public"
                if _clue_visibility in {
                    "player_visible", "player-safe", "public", "",
                }
                else "secret"
            ),
        )

    if isinstance(scene_contract, dict):
        if clue is not None:
            scope = (
                scene_contract.get("truth_scope")
                if isinstance(scene_contract.get("truth_scope"), dict)
                else {}
            )
            max_tier = scope.get("max_tier")
            tier = clue.get("truth_tier")
            if (
                isinstance(max_tier, int)
                and not isinstance(max_tier, bool)
                and isinstance(tier, int)
                and not isinstance(tier, bool)
                and tier > max_tier
            ):
                warnings.append(
                    f"clue '{clue_id}' is truth tier {tier}, above this scene's "
                    f"contract ceiling {max_tier} — delivering it here outruns the "
                    "authored pacing; consider a bridge clue instead (advisory)"
                )
                scene_promotions = [
                    row
                    for row in (world.get("scene_promotions") or [])
                    if isinstance(row, dict)
                    and str(row.get("scene_id") or "") == str(active or "")
                ]
                effective_role = str(
                    (
                        scene_promotions[-1].get("to_role")
                        if scene_promotions
                        else None
                    )
                    or scene_contract.get("role")
                    or ""
                )
                drift_event = {
                    "schema_version": 1,
                    "event_id": _operation_event_id(
                        "state.record_clue.scene_scope_drift", event_key
                    ),
                    "event_type": "scene_scope_drift",
                    "scene_id": active,
                    "scene_contract_id": scene_contract_id or None,
                    "source_decision_id": decision_id or None,
                    "source_event_id": source_event_id,
                    "source_clue_id": clue_id,
                    "truth_tier": tier,
                    "max_tier": max_tier,
                    "effective_role": effective_role,
                    "status": "unpromoted",
                    "acceptance_severity": (
                        "hard"
                        if effective_role == "transit" and tier in {3, 4}
                        else "advisory"
                    ),
                    "options": [
                        "downgrade_to_symptom",
                        "convert_to_bridge",
                        "local_consequence",
                        "promote_scene",
                    ],
                }
                if not already:
                    ctx.log_event(drift_event)
        else:
            budget = (
                scene_contract.get("improv_budget")
                if isinstance(scene_contract.get("improv_budget"), dict)
                else {}
            )
            cap = budget.get("local_clues")
            if isinstance(cap, int) and not isinstance(cap, bool):
                improvised_here = sum(
                    1
                    for row in clues_found.values()
                    if isinstance(row, dict)
                    and row.get("provenance") == "improvised"
                    and str(row.get("scene_id") or "") == str(active or "")
                )
                if improvised_here > cap:
                    warnings.append(
                        f"improv budget exceeded: this is improvised clue "
                        f"#{improvised_here} at this scene (budget {cap}); guide "
                        "play toward authored paths instead of minting more local truth"
                    )

    route_context: dict[str, Any] | None = None
    route_ref = args.get("route_ref")
    if route_ref is not None:
        if isinstance(route_ref, dict):
            scene_ref = str(route_ref.get("scene_id") or "").strip()
            route_id = str(route_ref.get("route_id") or "").strip()
            if scene_ref and route_id:
                route_context = {
                    "schema_version": 1,
                    "hard_gate": False,
                    "scene_id": scene_ref,
                    "route_id": route_id,
                }
            else:
                warnings.append(
                    "route_ref was incomplete; clue remained recorded and no route completion was inferred"
                )
        else:
            warnings.append(
                "route_ref was not an object; clue remained recorded and no route completion was inferred"
            )
    route_completion, route_warnings = _settle_contextual_route(
        ctx,
        route_context,
        decision_id=str(args.get("decision_id") or f"clue:{clue_id}"),
        source_tool="state.record_clue",
        successful=False,
        committed_clue_ids=[clue_id] if not already else [],
    )
    warnings.extend(route_warnings)

    data = {
        "clue_id": clue_id,
        "already_discovered": already,
        "player_safe_summary": (clue or {}).get("player_safe_summary"),
        "localized_text": (clue or {}).get("localized_text"),
        "discovered_total": len(discovered),
        "newly_unlocked_scenes": newly_unlocked,
        "delivered_handout_id": linked_handout_id,
        "handout_presentation": linked_handout_presentation,
        "route_completion": deepcopy(route_completion),
    }
    if handout_delivery_warning is not None:
        data["handout_delivery_warning"] = deepcopy(handout_delivery_warning)
    if clue is None:
        data["provenance"] = deepcopy(clue_record)
    progressive_hints: list[str] = []
    if not already:
        # Progressive dig queue: structured mentions on the clue only (no free-prose scan).
        try:
            if ctx.campaign_dir is not None and coc_module_project.campaign_asset_root_id(
                ctx.campaign_dir
            ):
                dig = coc_module_project.on_clue_discovered(
                    ctx.root, ctx.campaign_id, clue_id,
                )
                if dig and dig.get("progressive") and dig.get("followed"):
                    data["progressive"] = {
                        "followed": dig.get("followed"),
                        "host_hints": dig.get("host_hints") or [],
                        "merged_location_ids": dig.get("merged_location_ids") or [],
                    }
                    progressive_hints.extend(list(dig.get("host_hints") or []))
                    progressive_hints.append(
                        f"progressive: clue mentions queued {len(dig['followed'])} "
                        "deepen target(s) — host-extract missing packs before inventing table detail"
                    )
        except Exception as exc:  # progressive must never block clue write
            warnings.append(f"progressive clue-follow skipped: {exc}")
    hints: list[str] = []
    if linked_handout_newly:
        hints.append(
            f"clue '{clue_id}' delivered handout card "
            f"'{linked_handout_newly[0]}' — present its registered body exactly "
            "(active-language text preferred); frame the find without rewriting the "
            "card text"
        )
    if linkage_skipped_hidden_card:
        hints.append(
            f"clue '{clue_id}' references a player_visible:false handout card — "
            "it stayed keeper-facing reference material and was NOT delivered "
            "to the players"
        )
    if newly_unlocked:
        hints.append(f"new scene(s) unlocked: {', '.join(newly_unlocked)} — consider signposting them")
    hints.extend(progressive_hints)
    ctx.ledger_record(args.get("decision_id"), "state.record_clue", data)
    return data, warnings, hints

def register_operations(registry) -> None:
    global TOOLS
    TOOLS = registry.legacy_tools
    registry.tool(
    "clues.query",
    "Clue graph with discovery state, plus the campaign's registered handout "
    "cards with delivery state. Filter clues by scene_id or clue_id. "
    "Undiscovered clues are keeper secrets; undelivered card bodies are "
    "keeper-only until state.deliver_handout.",
    {
        "scene_id": {"type": "string", "desc": "only clues available in this scene"},
        "clue_id": {"type": "string", "desc": "a single clue"},
        "undiscovered_only": {"type": "boolean", "desc": "only clues not yet found"},
        "include_handouts": {
            "type": "boolean",
            "desc": "include the verbatim handout card section (default true)",
        },
        "handouts_projection": {
            "type": "string",
            "desc": "keeper (default, full cards incl. undelivered) or player (delivered cards only, player-safe fields)",
        },
        "since_revision": {
            "type": "string",
            "desc": "revision returned by the previous identical query; matching state returns not_modified instead of the full projection",
        },
    },
    access="query",
    read_domains=("clues", "world", "scene", "handouts"),
    recovery_domains=(),
    response_mode="full_or_not_modified",
    audit_mode="reference",
)(_tool_clues_query)
    registry.tool(
    "state.deliver_handout",
    "Deliver an exact registered info card (handout) to the players. "
    "Source cards preserve verbatim excerpts; authored-derivative cards "
    "preserve their registered in-world prop text. Idempotent via "
    "decision_id. This only writes delivery state — judging WHEN a card is "
    "delivered stays with the Keeper; narration frames the find, the card "
    "registered body is presented exactly, never paraphrased.",
    {
        "handout_id": {
            "type": "string",
            "required": True,
            "desc": "asset_id of the handout card (clues.query handouts section lists them all)",
        },
        "decision_id": {"type": "string", "desc": "idempotency key"},
        "scene_id": {"type": "string", "desc": "scene where the card is handed over (evidence)"},
        "reason": {"type": "string", "desc": "why now (evidence)"},
    },
)(_tool_state_deliver_handout)
    registry.tool(
    "state.replay_handout",
    "Present an already-delivered player-visible card again only after the "
    "Keeper semantically confirms an explicit request in the current player "
    "message. This creates a new presentation identity without changing "
    "delivery/material state. Ambiguous references require a clarifying "
    "question and no tool call; code never keyword-classifies player prose.",
    {
        "handout_id": {
            "type": "string",
            "required": True,
            "desc": "asset_id of an already-delivered player-visible card",
        },
        "request_assertion": {
            "type": "object",
            "required": True,
            "desc": "structured Keeper assertion bound to the exact current player message; Pi injects player_turn_epoch after checking player_text",
            "properties": {
                "explicit_player_request": {"type": "boolean"},
                "player_text": {"type": "string"},
                "semantic_reason": {"type": "string"},
                "player_turn_epoch": {"type": "integer", "minimum": 1},
            },
            "required_fields": [
                "explicit_player_request", "player_text", "semantic_reason",
            ],
            "additionalProperties": False,
        },
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)(_tool_state_replay_handout)
    registry.tool(
    "state.record_clue",
    "Record a clue as discovered. Idempotent; unlocks any scenes gated on it. Off-design discoveries warn, not block.",
    {
        "clue_id": {"type": "string", "required": True, "desc": "clue id from the clue graph"},
        "method": {"type": "string", "desc": "how it was found (roll, social, exploration...)"},
        "route_ref": {
            "type": "object",
            "desc": "optional exact {scene_id, route_id} from actions.advise; binds direct clue delivery to authored route completion without forcing the route",
        },
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)(_tool_state_record_clue)


OPERATION_EXPORTS = (
    '_normalize_handout_replay_assertion',
    '_tool_clues_query',
    '_tool_state_deliver_handout',
    '_tool_state_record_clue',
    '_tool_state_replay_handout',
)
