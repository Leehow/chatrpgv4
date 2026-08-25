#!/usr/bin/env python3
"""Operation adapter cell: scene-advisory."""
from __future__ import annotations

from coc_operation_kernel_runtime import (
    Any,
    Ctx,
    Path,
    ToolError,
    _adjudication_gap_hints,
    _advice_id,
    _all_clues,
    _canonical_digest,
    _current_open_affordances,
    _evaluate_and_apply_unlocks,
    _intent_evidence,
    _investigator_character_path,
    _jsonl_rows,
    _load_sibling,
    _normalize_engagement_route_completion,
    _now_iso,
    _open_attempt_opportunities,
    _operation_event_id,
    _project_action_route_cards,
    _project_storylet_candidate,
    _read_optional_json,
    _replay_bound_decision,
    _request_digest,
    _resolve_investigator,
    _scene_by_id,
    _settle_engagement_route_completion,
    _storylet_candidate_ref,
    coc_compiled_archive,
    coc_module_project,
    coc_scene_graph,
    coc_state,
    coc_storylets,
    coc_time,
    deepcopy,
    hashlib,
    json,
    random,
    tool,
    _tool_scene_context as _shared_tool_scene_context,
)

coc_story_director = _load_sibling(
    "coc_story_director_toolbox", "coc_story_director.py"
)

coc_keeper_planner = _load_sibling(
    "coc_keeper_planner_toolbox", "coc_keeper_planner.py"
)

def _tool_scene_map(ctx: Ctx, args: dict[str, Any]):
    world = ctx.world()
    sg = ctx.story_graph
    unlocked = {str(s) for s in world.get("unlocked_scene_ids") or []}
    visited = {str(s) for s in world.get("visited_scene_ids") or []}
    exhausted = {str(s) for s in world.get("exhausted_scene_ids") or []}
    edges_map = coc_scene_graph.derive_scene_edges(sg)
    scenes = []
    for scene in sg.get("scenes") or []:
        sid = str(scene.get("scene_id"))
        scenes.append({
            "scene_id": sid,
            "scene_type": scene.get("scene_type"),
            "dramatic_question": scene.get("dramatic_question"),
            "location_tags": scene.get("location_tags"),
            "unlocked": sid in unlocked,
            "visited": sid in visited,
            "exhausted": sid in exhausted,
            "is_terminal": coc_scene_graph.is_terminal_scene(scene, sg),
            "edges": edges_map.get(sid, []),
            # Progressive track: skeleton/partial/deep (KP-only; never player-facing)
            "parse_state": scene.get("parse_state"),
            "evidence_gap": bool(scene.get("evidence_gap")),
        })
    data = {
        "active_scene_id": world.get("active_scene_id"),
        "scenes": scenes,
        "scene_history": world.get("scene_history"),
        "progressive_asset_root_id": coc_module_project.campaign_asset_root_id(
            ctx.campaign_dir
        )
        if ctx.campaign_dir is not None
        else None,
    }
    return data, [], []

_ACTIVE_SCENE_SOURCE_SECTION_MAX_COUNT = 8

_ACTIVE_SCENE_SOURCE_SECTION_MAX_BODY_BYTES = 24 * 1024

def _tool_actions_list(ctx: Ctx, args: dict[str, Any]):
    world = ctx.world()
    scene = _scene_by_id(ctx.story_graph, world.get("active_scene_id"))
    discovered = {str(c) for c in (world.get("discovered_clue_ids") or [])}
    out = []
    for aff in (scene or {}).get("affordances") or []:
        if not isinstance(aff, dict):
            continue
        missing_clues = [
            c for c in (aff.get("requires_discovered_clue_ids") or []) if str(c) not in discovered
        ]
        out.append({
            "id": aff.get("id"),
            "action_kind": aff.get("action_kind"),
            "cue": aff.get("cue"),
            "verbs": aff.get("verbs"),
            "skills": aff.get("skills"),
            "target_entities": aff.get("target_entities"),
            "roll_gate": aff.get("roll_gate"),
            "player_visible_outcome": aff.get("player_visible_outcome"),
            "clue_grants": aff.get("clue_grants") or aff.get("grants_clue_ids"),
            "preconditions_met": not missing_clues,
            "missing_prerequisites": missing_clues or None,
            "status": aff.get("status"),
            "operation_available": isinstance(aff.get("rules_operation"), dict),
            "resolution_mode": (
                "typed_tool"
                if isinstance(aff.get("rules_operation"), dict)
                else "keeper_adjudication"
            ),
            "keeper_only": (
                {
                    "secret": True,
                    "operation_kind": aff["rules_operation"].get("kind"),
                    "tool": (
                        "combat.resolve"
                        if aff["rules_operation"].get("kind")
                        == "combat_engagement"
                        else None
                    ),
                }
                if isinstance(aff.get("rules_operation"), dict)
                else None
            ),
        })
    hints = [
        "these are authored suggestions — improvised player actions are equally valid; use rules.roll for risky ones",
        "match action_kind to the player's explicit intent; keeper_adjudication is fully valid and must not be replaced by a typed combat route merely because that route has a tool",
        "keeper_only operation fields are execution data, never player-facing narration",
    ]
    return {"scene_id": world.get("active_scene_id"), "affordances": out}, [], hints

def _tool_actions_advise(ctx: Ctx, args: dict[str, Any]):
    world = ctx.world()
    active_id = world.get("active_scene_id")
    affordances = _current_open_affordances(ctx)
    investigator_id = _resolve_investigator(ctx, args)
    advice = coc_keeper_planner.build_rule_advice(
        affordances, ctx.sheet(investigator_id)
    )
    gated = [
        row for row in advice
        if isinstance(row, dict) and row.get("classification") == "authored_rule_advice"
    ]
    warnings: list[str] = []
    route_cards = _project_action_route_cards(ctx)
    route_index = {
        str(row.get("route_id") or ""): row
        for row in route_cards
        if isinstance(row, dict) and row.get("route_id")
    }
    intent: dict[str, Any] | None = None
    selected_ids: list[str] = []
    if args.get("intent_evidence") is not None:
        intent = _intent_evidence(args.get("intent_evidence"))
        selected_ids = list(dict.fromkeys(
            str(value).strip()
            for value in (
                intent.get("matched_affordance_ids")
                or intent.get("selected_affordance_ids")
                or []
            )
            if str(value or "").strip()
        ))
        legacy_route_ids = [
            str(value).strip()
            for value in (intent.get("selected_route_ids") or [])
            if str(value or "").strip()
        ]
        if legacy_route_ids and not selected_ids:
            warnings.append(
                "intent_evidence.selected_route_ids is not a supported semantic "
                "binding and was ignored; use matched_affordance_ids (or "
                "selected_affordance_ids) with the exact action_routes IDs. "
                "Do not compensate by reading scenario files."
            )
    unavailable = [route_id for route_id in selected_ids if route_id not in route_index]
    if unavailable:
        warnings.append(
            "KP-selected authored route ids are not in the current open working set and were ignored: "
            + ", ".join(unavailable)
        )
    selected_routes = [
        deepcopy(route_index[route_id])
        for route_id in selected_ids if route_id in route_index
    ]
    if intent is None:
        resolution_advice: dict[str, Any] = {
            "kind": "current_route_working_set",
            "authority": "advisory",
            "hard_gate": False,
            "routes": route_cards,
            "reason": "Supply KP semantic intent evidence to project one contextual route recommendation.",
        }
    elif not selected_routes:
        resolution_advice = {
            "kind": "keeper_judgment",
            "authority": "advisory",
            "hard_gate": False,
            "may_improvise": True,
            "reason": (
                "No exact current authored route was selected. The KP may adjudicate "
                "the action semantically, ask a necessary clarification, or improvise."
            ),
        }
    elif len(selected_routes) == 1:
        resolution_advice = deepcopy(selected_routes[0])
    else:
        resolution_advice = {
            "kind": "compound_or_ambiguous_authored_action",
            "authority": "advisory",
            "hard_gate": False,
            "selected_routes": selected_routes,
            "reason": "The KP decides whether these routes form one natural action, a montage, or successive goals.",
        }
    data = {
        "schema_version": 1,
        "authority": "advisory",
        "hard_gate": False,
        "scene_id": active_id,
        "investigator_id": investigator_id,
        "authored_roll_gate_count": len(gated),
        "rule_advice": advice,
        "action_routes": route_cards,
        "intent_evidence": intent,
        "resolution_advice": resolution_advice,
        "operation_opportunities": _open_attempt_opportunities(
            ctx, scene_id=str(active_id or "") or None,
        ),
    }
    player_text = str(args.get("player_text") or "").strip()
    if intent is not None and player_text:
        director_intent = deepcopy(intent)
        if not isinstance(director_intent.get("action_resolution"), dict):
            director_intent["action_resolution"] = {
                "schema_version": 1,
                "primary_intent": director_intent.get("primary_intent"),
                "matched_affordance_ids": [
                    route_id for route_id in selected_ids if route_id in route_index
                ],
                "matched_destination_scene_id": None,
                "normalized_action_atoms": deepcopy(
                    director_intent.get("normalized_action_atoms") or []
                ),
                "no_match": not bool(selected_routes),
            }
        try:
            director_data, director_ctx = _build_director_advice_payload(
                ctx,
                {
                    "player_text": player_text,
                    "intent_evidence": director_intent,
                    "investigator": investigator_id,
                },
            )
            storylet_data = _storylet_advice_payload(
                ctx,
                plan=director_data["candidate_plan"],
                director_ctx=director_ctx,
                seed=None,
                limit=1,
            )
            if storylet_data["candidates"]:
                candidate = storylet_data["candidates"][0]
                candidate_ref = _storylet_candidate_ref(
                    storylet_data["advice_id"], candidate
                )
                data["narrative_opportunity"] = {
                    "schema_version": 1,
                    "authority": "advisory",
                    "hard_gate": False,
                    "advice_id": storylet_data["advice_id"],
                    "candidate_ref": candidate_ref,
                    "candidate": candidate,
                    "reason": (
                        "A stable existing Storylet candidate is available for this "
                        "action. Adopt, modify, or ignore it according to current pacing; "
                        "never insert it merely to satisfy a quota."
                    ),
                    "adoption_operation": {
                        "operation": "evidence.record_adoption",
                        "invoke_via": "coc_invoke",
                        "prefilled_arguments": {
                            "advice_id": storylet_data["advice_id"],
                            "candidate_ref": candidate_ref,
                        },
                        "missing_arguments": [
                            "decision_id", "disposition", "reason", "adopted_fields",
                        ],
                    },
                }
            else:
                data["narrative_opportunity"] = None
        except (ToolError, ValueError, RuntimeError, OSError) as exc:
            warnings.append(
                f"combined Director/Storylet advice was unavailable and was skipped without blocking play: {exc}"
            )
            data["narrative_opportunity"] = None
    hints = [
        "the returned route cards are the bounded authored source for this action; do not reread story-graph, clue-graph, module assets, tool logs, or old finalization examples",
        "authored roll gates are cited rule advice, not a mandatory pipeline — accept, override with a reason, or ignore",
        "direct_delivery means the authored route grants its clue/handout without a roll; invoke the prefilled state.record_clue cards and narrate the actual discovery",
        "clue-bearing success must call state.record_clue before player-visible prose",
        "push_or_context_change is a soft anti-roll-fishing reminder; it never rejects a player action or prevents the KP from honoring a deliberately chosen new check",
        "narrative_opportunity is one stable optional Storylet candidate, not a random-event quota; record adoption only when its substance actually reaches play",
        "a player-declared fact never satisfies a roll gate by itself; resolve the check with rules.roll before recording its clue",
    ]
    return data, warnings, hints

def _stable_advisory_seed(ctx: Ctx, kind: str, material: Any) -> str:
    digest = hashlib.sha256(
        json.dumps(
            material,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            default=str,
        ).encode("utf-8")
    ).hexdigest()
    return (
        f"{kind}:{ctx.campaign_id}:{ctx.pacing().get('turn_number', 0)}:"
        f"{ctx.world().get('active_scene_id')}:{digest}"
    )

def _build_director_advice_payload(
    ctx: Ctx, args: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    player_text = str(args.get("player_text") or "").strip()
    if not player_text:
        raise ToolError("invalid_param", "player_text is required")
    intent = _intent_evidence(args.get("intent_evidence"))
    investigator_id = _resolve_investigator(ctx, args)
    sheet = ctx.sheet(investigator_id)
    seed = (
        args.get("seed")
        if args.get("seed") is not None
        else _stable_advisory_seed(
            ctx, "director", {"player_text": player_text, "intent": intent},
        )
    )
    decision_id = str(args.get("decision_id") or _advice_id(
        "director", ctx, {"player_text": player_text, "intent": intent}
    ))
    director_ctx = coc_story_director.build_director_context(
        ctx.campaign_dir,
        _investigator_character_path(ctx, investigator_id),
        investigator_id,
        player_text,
        str(intent["primary_intent"]),
        rng=random.Random(seed),
        player_intent_rich=intent,
        character_snapshot=sheet,
    )
    plan = coc_story_director.generate_director_plan(director_ctx, decision_id)
    advice_id = _advice_id("director", ctx, plan)
    return {
        "schema_version": 1,
        "advice_id": advice_id,
        "authority": "advisory",
        "hard_gate": False,
        "intent_evidence": intent,
        "candidate_plan": plan,
        "context_summary": {
            "active_scene_id": director_ctx.get("active_scene_id"),
            "turn_number": director_ctx.get("turn_number"),
            "story_need": director_ctx.get("story_need"),
            "personal_horror_hooks": director_ctx.get("personal_horror_hooks") or [],
            "threat_fronts": director_ctx.get("threat_fronts") or {},
            "time_signals": director_ctx.get("time_signals") or {},
        },
    }, director_ctx

def _tool_director_advise(ctx: Ctx, args: dict[str, Any]):
    data, _director_ctx = _build_director_advice_payload(ctx, args)
    return data, [], [
        "this is a candidate orchestration plan, not a turn pipeline or state mutation",
        "adopt, modify, or ignore any part; resolve dice and state only through authoritative tools",
    ]

def _storylet_advice_payload(
    ctx: Ctx,
    *,
    plan: dict[str, Any],
    director_ctx: dict[str, Any],
    seed: Any | None,
    limit: int,
) -> dict[str, Any]:
    ledger_path = ctx.campaign_dir / "save" / "storylet-ledger.json"
    ledger = _read_optional_json(ledger_path, {})
    stable_seed = (
        seed
        if seed is not None
        else _stable_advisory_seed(
            ctx,
            "storylets",
            {
                "decision_id": plan.get("decision_id"),
                "scene_action": plan.get("scene_action"),
                "intent": (plan.get("turn_input") or {}).get("player_intent_rich"),
            },
        )
    )
    moves = coc_storylets.select_storylet_moves(
        plan,
        director_ctx,
        library=coc_storylets.load_storylet_library(),
        ledger=ledger,
        seed=stable_seed,
        max_storylets=max(1, min(5, int(limit))),
    )
    candidates = [_project_storylet_candidate(move) for move in moves]
    advice_id = _advice_id("storylets", ctx, candidates)
    return {
        "schema_version": 1,
        "advice_id": advice_id,
        "authority": "advisory",
        "hard_gate": False,
        "candidates": candidates,
    }

def _tool_storylets_suggest(ctx: Ctx, args: dict[str, Any]):
    plan = args.get("candidate_plan")
    if not isinstance(plan, dict):
        raise ToolError("invalid_param", "candidate_plan must be an object")
    player_text = str(args.get("player_text") or "").strip()
    if not player_text:
        raise ToolError("invalid_param", "player_text is required")
    intent = _intent_evidence(args.get("intent_evidence"))
    investigator_id = _resolve_investigator(ctx, args)
    director_ctx = coc_story_director.build_director_context(
        ctx.campaign_dir,
        _investigator_character_path(ctx, investigator_id),
        investigator_id,
        player_text,
        str(intent["primary_intent"]),
        rng=random.Random(
            args.get("seed")
            if args.get("seed") is not None
            else _stable_advisory_seed(
                ctx,
                "storylets-context",
                {"player_text": player_text, "intent": intent},
            )
        ),
        player_intent_rich=intent,
        character_snapshot=ctx.sheet(investigator_id),
    )
    limit = max(1, min(5, int(args.get("max") or 1)))
    data = _storylet_advice_payload(
        ctx,
        plan=plan,
        director_ctx=director_ctx,
        seed=args.get("seed"),
        limit=limit,
    )
    return data, [], [
        "storylets change presentation and cost only; they never rewrite module truth",
        "persist ledger use only after the KP actually adopts and delivers a candidate",
    ]

def _tool_state_promote_scene(ctx: Ctx, args: dict[str, Any]):
    replay = _replay_bound_decision(ctx, "state.promote_scene", args)
    if replay is not None:
        return replay, ["duplicate decision_id: returning the previously recorded promotion"], []
    decision_id = str(args.get("decision_id") or "").strip()
    if not decision_id:
        raise ToolError("invalid_param", "decision_id must be non-empty")
    to_role = str(args["to_role"]).strip()
    if to_role not in {"side_investigation", "investigation", "main", "climax"}:
        raise ToolError(
            "invalid_param",
            "to_role must be side_investigation|investigation|main|climax",
        )
    reason = str(args["reason"] or "").strip()
    if not reason:
        raise ToolError("invalid_param", "reason must be non-empty")
    raw_source_event_ids = args.get("source_event_ids")
    if not isinstance(raw_source_event_ids, list) or not raw_source_event_ids:
        raise ToolError("invalid_param", "source_event_ids must be a non-empty array")
    source_event_ids: list[str] = []
    for raw in raw_source_event_ids:
        if not isinstance(raw, str) or not raw.strip():
            raise ToolError(
                "invalid_param", "source_event_ids must contain non-empty strings"
            )
        event_id = raw.strip()
        if event_id in source_event_ids:
            raise ToolError("invalid_param", "source_event_ids must be unique")
        source_event_ids.append(event_id)
    events_by_id: dict[str, dict[str, Any]] = {}
    for row in _jsonl_rows(ctx.campaign_dir / "logs" / "events.jsonl"):
        event_id = str(row.get("event_id") or "").strip()
        if not event_id:
            continue
        if event_id in events_by_id:
            raise ToolError(
                "state_corrupt", f"canonical event id {event_id!r} is duplicated"
            )
        events_by_id[event_id] = row
    missing_sources = [
        event_id for event_id in source_event_ids if event_id not in events_by_id
    ]
    if missing_sources:
        raise ToolError(
            "source_event_invalid",
            "source_event_ids do not resolve: " + ", ".join(missing_sources),
        )
    world = ctx.world()
    active = str(world.get("active_scene_id") or "")
    scene_id = str(args.get("scene_id") or active or "").strip()
    if not scene_id:
        raise ToolError("invalid_param", "scene_id is required when no scene is active")
    scene = _scene_by_id(ctx.story_graph, scene_id)
    authored_contract = (
        (scene or {}).get("scene_contract")
        if isinstance((scene or {}).get("scene_contract"), dict)
        else {}
    )
    existing_scene_promotions = [
        row
        for row in (world.get("scene_promotions") or [])
        if isinstance(row, dict) and str(row.get("scene_id") or "") == scene_id
    ]
    from_role = str(
        (existing_scene_promotions[-1].get("to_role") if existing_scene_promotions else None)
        or authored_contract.get("role")
        or (scene or {}).get("scene_type")
        or "unknown"
    )
    promotions = [
        row
        for row in (world.get("scene_promotions") or [])
        if isinstance(row, dict)
    ]
    event_id = _operation_event_id("state.promote_scene", decision_id)
    promotion_id = "scene-promotion-v1:" + _canonical_digest(
        {"scene_id": scene_id, "decision_id": decision_id}
    ).removeprefix("sha256:")
    from_contract_id = str(
        (existing_scene_promotions[-1].get("to_contract_id") if existing_scene_promotions else None)
        or authored_contract.get("scene_contract_id")
        or (
            "scene-contract-v1:"
            + _canonical_digest(
                {"scene_id": scene_id, "role": from_role, "source": "campaign-local"}
            ).removeprefix("sha256:")
        )
    )
    to_contract_id = "scene-contract-v1:" + _canonical_digest(
        {
            "scene_id": scene_id,
            "from_contract_id": from_contract_id,
            "to_role": to_role,
            "promotion_id": promotion_id,
        }
    ).removeprefix("sha256:")
    resolved_drift_event_ids = [
        source_id
        for source_id in source_event_ids
        if events_by_id[source_id].get("event_type") == "scene_scope_drift"
        and str(events_by_id[source_id].get("scene_id") or "") == scene_id
    ]
    promotion = {
        "schema_version": 1,
        "event_id": event_id,
        "event_type": "scene_promotion",
        "promotion_id": promotion_id,
        "scene_id": scene_id,
        "from_role": from_role,
        "to_role": to_role,
        "from_contract_id": from_contract_id,
        "to_contract_id": to_contract_id,
        "reason": reason,
        "source_event_ids": source_event_ids,
        "resolved_drift_event_ids": resolved_drift_event_ids,
        "source_decision_id": decision_id,
        "module_divergence": True,
        "request_digest": _request_digest(args),
        "ts": _now_iso(),
    }
    promotions.append(promotion)
    world["scene_promotions"] = promotions
    ctx.save_world(world)
    ctx.log_event(deepcopy(promotion))
    ctx.ledger_record(decision_id, "state.promote_scene", promotion)
    warnings: list[str] = []
    if scene is None:
        warnings.append(
            f"scene '{scene_id}' is not in the story graph — promotion recorded as campaign canon anyway"
        )
    return promotion, warnings, [
        f"later scene.context reads '{scene_id}' with effective role '{to_role}'; "
        "the divergence stays in audit evidence"
    ]

def _tool_secrets_briefing(ctx: Ctx, args: dict[str, Any]):
    world = ctx.world()
    discovered = {str(c) for c in (world.get("discovered_clue_ids") or [])}
    scope_raw = str(args.get("scope") or "active_scene").strip() or "active_scene"
    if scope_raw not in {"active_scene", "entities", "whole_module_audit"}:
        raise ToolError(
            "invalid_param",
            "scope must be active_scene, entities, or whole_module_audit",
        )
    # Default scene_id from world only for active_scene. Entity-only requests
    # must not silently expand to the active-scene secret surface.
    if scope_raw == "active_scene":
        active_scene_id = str(world.get("active_scene_id") or "").strip()
        requested_scene_id = str(args.get("scene_id") or "").strip()
        if requested_scene_id and requested_scene_id != active_scene_id:
            raise ToolError(
                "stale_scene_id",
                "active_scene secrets.briefing only reads the exact canonical active scene",
            )
        scene_id = requested_scene_id or active_scene_id or None
    elif "scene_id" in args and args.get("scene_id") is not None and str(args.get("scene_id")).strip():
        scene_id = str(args["scene_id"]).strip()
    else:
        scene_id = None
    npc_ids = [
        str(value)
        for value in (args.get("npc_ids") or [])
        if str(value).strip()
    ]
    clue_ids = [
        str(value)
        for value in (args.get("clue_ids") or [])
        if str(value).strip()
    ]
    if scope_raw == "active_scene" and not scene_id:
        raise ToolError(
            "invalid_param",
            "active_scene secrets.briefing requires an active scene or scene_id",
        )
    if scope_raw == "entities" and not (scene_id or npc_ids or clue_ids):
        raise ToolError(
            "invalid_param",
            "entities scope requires explicit scene_id and/or npc_ids and/or clue_ids",
        )

    warnings: list[str] = []
    archive_payload: dict[str, Any] | None = None
    if ctx.campaign_dir is not None:
        try:
            archive_payload = coc_compiled_archive.secrets_briefing_from_archive(
                ctx.campaign_dir,
                scope=scope_raw,
                scene_id=scene_id,
                npc_ids=npc_ids,
                clue_ids=clue_ids,
                discovered_clue_ids=discovered,
            )
        except coc_compiled_archive.CompiledArchiveError as exc:
            warnings.append(
                f"compiled archive unavailable ({exc.code}); using scenario IR fallback"
            )
        except Exception as exc:  # noqa: BLE001
            warnings.append(
                f"compiled archive secrets read failed; using scenario IR fallback ({exc})"
            )

    if archive_payload is not None:
        undiscovered = archive_payload.get("undiscovered_clues") or []
        npc_secrets = archive_payload.get("npc_secrets") or []
        module_secrets = archive_payload.get("module_secrets") or []
        archive_meta = {
            "archive_revision": archive_payload.get("archive_revision"),
            "source": "compiled_archive",
            "scope": archive_payload.get("scope"),
            "selected_counts": archive_payload.get("selected_counts"),
            "whole_module": bool(archive_payload.get("whole_module")),
        }
    else:
        # Explicit IR fallback (and whole_module_audit when archive missing).
        if scope_raw == "whole_module_audit":
            selected_clues = _all_clues(ctx.clue_graph)
            selected_npcs = [
                n for n in (ctx.npc_agendas.get("npcs") or []) if isinstance(n, dict)
            ]
            module_secrets = [
                {
                    "id": secret.get("id"),
                    "category": secret.get("category"),
                    "prose": secret.get("prose"),
                    "secret": True,
                }
                for secret in (
                    (ctx.scenario("improvisation-boundaries.json") or {}).get(
                        "keeper_secrets"
                    )
                    or []
                )
                if isinstance(secret, dict) and secret.get("id")
            ]
        elif scope_raw == "entities" and not scene_id:
            # Exact entity scope: only the explicit npc/clue ids, no active scene.
            selected_clues = [
                clue for clue in _all_clues(ctx.clue_graph)
                if str(clue.get("clue_id")) in set(clue_ids)
            ]
            selected_npcs = [
                n for n in (ctx.npc_agendas.get("npcs") or [])
                if isinstance(n, dict) and str(n.get("npc_id")) in set(npc_ids)
            ]
            module_secrets = []
        else:
            scene = _scene_by_id(ctx.story_graph, scene_id) if scene_id else None
            scene_clue_ids = {
                str(value) for value in ((scene or {}).get("available_clues") or [])
            }
            scene_npc_ids = {
                str(value) for value in ((scene or {}).get("npc_ids") or [])
            }
            if clue_ids:
                scene_clue_ids.update(clue_ids)
            if npc_ids:
                scene_npc_ids.update(npc_ids)
            selected_clues = [
                clue for clue in _all_clues(ctx.clue_graph)
                if str(clue.get("clue_id")) in scene_clue_ids
            ]
            selected_npcs = [
                n for n in (ctx.npc_agendas.get("npcs") or [])
                if isinstance(n, dict) and str(n.get("npc_id")) in scene_npc_ids
            ]
            module_secrets = []
        undiscovered = [
            {
                "clue_id": c.get("clue_id"),
                "player_safe_summary": c.get("player_safe_summary"),
                "delivery": c.get("delivery"),
                "secret": True,
            }
            for c in selected_clues
            if str(c.get("clue_id")) not in discovered
        ]
        npc_secrets = [
            {
                "npc_id": n.get("npc_id"),
                "name": n.get("name"),
                "secret": n.get("secret"),
                "keeper_note": n.get("keeper_note"),
                "secret_marker": True,
            }
            for n in selected_npcs
            if n.get("secret") or n.get("keeper_note")
        ]
        archive_meta = {
            "archive_revision": None,
            "source": "scenario_ir_fallback",
            "scope": scope_raw,
            "whole_module": scope_raw == "whole_module_audit",
        }

    source_sections: list[dict[str, Any]] = []
    source_section_candidates: list[dict[str, Any]] = []
    source_section_omitted_count = 0
    source_section_omitted_body_bytes = 0
    if scope_raw == "active_scene" and scene_id:
        root_id = coc_module_project.campaign_source_asset_root_id(ctx.campaign_dir)
        if root_id:
            section_index = coc_module_project.coc_module_assets.read_section_index(
                ctx.root, root_id,
            ) or {}
            for section in section_index.get("sections") or []:
                if not isinstance(section, dict) or section.get("parse_state") != "resolved":
                    continue
                binding = section.get("binding") if isinstance(section.get("binding"), dict) else {}
                exact_location = (
                    binding.get("kind") == "entity"
                    and binding.get("entity_kind") == "location"
                    and scene_id in {str(value) for value in (binding.get("entity_ids") or [])}
                )
                keeper_opening = (
                    binding.get("kind") == "global"
                    and section.get("audience") == "keeper_only"
                    and section.get("timing") in {"pre_session", "opening"}
                )
                if not (exact_location or keeper_opening):
                    continue
                pack = coc_module_project.coc_module_assets.get_section_pack(
                    ctx.root, root_id, str(section.get("section_id") or ""),
                )
                if not pack or not pack.get("body_present"):
                    continue
                try:
                    body = Path(str(pack["body_path"])).read_text(encoding="utf-8")
                except OSError:
                    continue
                source_section_candidates.append({
                    "section_id": str(pack.get("section_id") or ""),
                    "body": body,
                    "source_refs": deepcopy(pack.get("source_refs") or []),
                    "secret": True,
                })
    source_section_body_bytes = 0
    for candidate in sorted(source_section_candidates, key=lambda row: row["section_id"]):
        body_bytes = len(candidate["body"].encode("utf-8"))
        if (
            len(source_sections) >= _ACTIVE_SCENE_SOURCE_SECTION_MAX_COUNT
            or source_section_body_bytes + body_bytes
            > _ACTIVE_SCENE_SOURCE_SECTION_MAX_BODY_BYTES
        ):
            source_section_omitted_count += 1
            source_section_omitted_body_bytes += body_bytes
            continue
        source_sections.append(candidate)
        source_section_body_bytes += body_bytes
    meta = ctx.scenario("module-meta.json")
    # module_meta overview is only included on explicit whole-module audit.
    module_meta: dict[str, Any] = {"title": meta.get("title")}
    if scope_raw == "whole_module_audit":
        # `keeper_secret_summary` is what a scenario actually writes: both
        # shipped starters use it and so does every extracted module. Reading
        # only `keeper_overview`/`overview` meant this returned {"value": null}
        # for every scenario that has ever existed, so the one place a Keeper
        # can ask what the module is really about answered with nothing, and
        # they reconstructed the plot from scenes and clues instead.
        module_meta["keeper_overview"] = {
            "value": (
                meta.get("keeper_secret_summary")
                or meta.get("keeper_overview")
                or meta.get("overview")
            ),
            "secret": True,
        }
        # What winning looks like, which is the other half of "what is this
        # module": the secret says what is really going on, this says what the
        # investigators are up against it for.
        module_meta["win_condition"] = {
            "value": meta.get("win_condition"),
            "secret": True,
        }
    data = {
        "module_truth_note": "module truth is read-only: tools never let you rewrite it, and you should not contradict it",
        "module_meta": module_meta,
        "scope": scope_raw,
        "scene_id": scene_id,
        "undiscovered_clues": undiscovered,
        "npc_secrets": npc_secrets,
        "module_secrets": module_secrets if scope_raw != "active_scene" or module_secrets else [],
        "source_sections": source_sections,
        "source_sections_budget": {
            "max_count": _ACTIVE_SCENE_SOURCE_SECTION_MAX_COUNT,
            "max_body_bytes": _ACTIVE_SCENE_SOURCE_SECTION_MAX_BODY_BYTES,
            "returned_count": len(source_sections),
            "returned_body_bytes": source_section_body_bytes,
            "truncated": bool(source_section_omitted_count),
            "omitted_count": source_section_omitted_count,
            "omitted_body_bytes": source_section_omitted_body_bytes,
        },
        "spoiler_reveals_so_far": ctx.flags().get("spoiler_reveals"),
        "compiled_archive": archive_meta,
        "secret": True,
    }
    if scope_raw == "active_scene" and archive_payload is not None:
        # Active-scene path may still surface scene-bound module secret refs.
        data["module_secrets"] = archive_payload.get("module_secrets") or []
    hints = [
        "reveal secrets only through play (successful rolls, NPC disclosure, discovery) — never as narration exposition",
        "when a secret does surface, record it with state.record_clue or flags so the briefing stays current",
    ]
    if scope_raw == "active_scene":
        hints.append(
            "default secrets.briefing is active-scene scoped; pass scope=whole_module_audit "
            "only for explicit cold-path module audit"
        )
    elif scope_raw == "whole_module_audit":
        hints.append(
            "whole_module_audit returns the full remaining secret surface; prefer active_scene or entities during play"
        )
    return data, warnings, hints

def _tool_state_move_scene(ctx: Ctx, args: dict[str, Any]):
    target = str(args["scene_id"])
    if (
        "travel_minutes" in args
        and (
            isinstance(args.get("travel_minutes"), bool)
            or not isinstance(args.get("travel_minutes"), int)
            or int(args["travel_minutes"]) < 0
        )
    ):
        raise ToolError("invalid_param", "travel_minutes must be a non-negative integer")
    if (
        "defer_initial_progressive_on_enter" in args
        and not isinstance(args.get("defer_initial_progressive_on_enter"), bool)
    ):
        raise ToolError(
            "invalid_param", "defer_initial_progressive_on_enter must be boolean"
        )
    defer_initial = args.get("defer_initial_progressive_on_enter") is True
    prior = ctx.ledger_lookup("state.move_scene", args.get("decision_id"))
    if prior is not None:
        prior_data = prior.get("data") if isinstance(prior.get("data"), dict) else {}
        prior_progressive = (
            prior_data.get("progressive")
            if isinstance(prior_data.get("progressive"), dict)
            else {}
        )
        prior_deferred = prior_progressive.get("on_enter_deferred") is True
        prior_travel_minutes = int(prior_data.get("travel_minutes", 0) or 0)
        requested_travel_minutes = (
            int(args["travel_minutes"])
            if args.get("travel_minutes") is not None
            else prior_travel_minutes
        )
        if (defer_initial or prior_deferred) and (
            defer_initial != prior_deferred
            or str(prior_data.get("to_scene_id") or "") != target
        ):
            raise ToolError(
                "idempotency_conflict",
                "decision_id already settled a different initial scene deferral",
            )
        if requested_travel_minutes != prior_travel_minutes:
            raise ToolError(
                "idempotency_conflict",
                "decision_id already settled different travel_minutes",
            )
        return prior.get("data"), ["duplicate decision_id: returning the previously settled result"], []
    world = ctx.world()
    sg = ctx.story_graph
    coc_scene_graph.ensure_world_scene_fields(world, sg)
    active = world.get("active_scene_id")
    warnings: list[str] = []
    scene = _scene_by_id(sg, target)
    source_travel_minute_options: set[int | None] = set()
    if active is not None:
        active_scene = _scene_by_id(sg, str(active))
        for edge in (active_scene or {}).get("scene_edges") or []:
            if not isinstance(edge, dict) or str(edge.get("to") or "") != target:
                continue
            value = edge.get("travel_minutes")
            source_travel_minute_options.add(
                None if value is None else int(value)
            )
    requested_travel_minutes = (
        int(args["travel_minutes"])
        if args.get("travel_minutes") is not None
        else None
    )
    if (
        source_travel_minute_options
        and requested_travel_minutes is not None
        and requested_travel_minutes not in source_travel_minute_options
    ):
        raise ToolError(
            "invalid_param",
            "travel_minutes does not match any source-authored edge to this scene",
        )
    if requested_travel_minutes is None and len(source_travel_minute_options) > 1:
        raise ToolError(
            "invalid_param",
            "multiple source-authored travel durations reach this scene; "
            "use one exact scene.context exit card",
        )
    travel_minutes = requested_travel_minutes
    if travel_minutes is None:
        source_option = next(iter(source_travel_minute_options), None)
        travel_minutes = 0 if source_option is None else source_option
    matched_source_duration = (
        requested_travel_minutes is not None
        and requested_travel_minutes in source_travel_minute_options
    ) or (
        requested_travel_minutes is None
        and len(source_travel_minute_options) == 1
        and None not in source_travel_minute_options
    )
    travel_time_source = (
        "source_scene_edge"
        if matched_source_duration
        else ("typed_argument" if args.get("travel_minutes") is not None else "none")
    )
    if defer_initial:
        decision_id = str(args.get("decision_id") or "").strip()
        if not decision_id:
            raise ToolError(
                "initial_progressive_deferral_invalid",
                "initial progressive deferral requires a nonempty decision_id",
            )
        if ctx.campaign_dir is None or not coc_module_project.campaign_is_pristine_for_opening(
            ctx.campaign_dir
        ):
            raise ToolError(
                "initial_progressive_deferral_invalid",
                "initial progressive deferral is legal only before any played scene evidence",
            )
        try:
            root_info = coc_module_project.resolve_opening_preparation_root(
                ctx.root, str(ctx.campaign_id),
            )
            skeleton = coc_module_project.coc_module_assets.get_skeleton(
                ctx.root, str(root_info["asset_root_id"]),
            )
            if not isinstance(skeleton, dict):
                raise coc_module_project.OpeningPreparationError(
                    "opening_skeleton_missing", "opening skeleton is missing",
                )
            selected = coc_module_project.select_opening_start(
                ctx.campaign_dir, skeleton, target,
            )
            persisted_binding = (
                coc_module_project.current_opening_projection_source_binding(
                    ctx.campaign_dir
                )
            )
            if not isinstance(persisted_binding, dict):
                raise coc_module_project.OpeningPreparationError(
                    "opening_projection_binding_missing",
                    "the projected opening has no durable source binding",
                )
            persisted_scope = persisted_binding.get("source_scope")
            if not (
                persisted_binding.get("schema_version") == 1
                and persisted_binding.get("authority") == "source_authored"
                and persisted_binding.get("asset_root_id")
                == str(root_info["asset_root_id"])
                and persisted_binding.get("start_location_id") == selected
                and isinstance(persisted_scope, dict)
            ):
                raise coc_module_project.OpeningPreparationError(
                    "opening_projection_binding_invalid",
                    "the durable opening source binding does not match this target",
                )
            binding_result = coc_module_project.resolve_selected_opening_binding(
                ctx.root,
                root_info,
                skeleton,
                selected,
                persisted_scope.get("pdf_indices"),
            )
            readiness = binding_result["readiness"]
            if not readiness["ready"]:
                raise coc_module_project.OpeningPreparationError(
                    "opening_pack_not_ready", "selected opening pack is not ready",
                )
            if readiness.get("source_binding") != persisted_binding:
                raise coc_module_project.OpeningPreparationError(
                    "opening_projection_binding_invalid",
                    "the durable opening source binding no longer matches repository evidence",
                )
            payload = coc_module_project.build_opening_projection_payload(
                ctx.root,
                str(root_info["asset_root_id"]),
                selected,
                binding_result["scope"],
            )
            expected_receipt = coc_module_project.opening_projection_receipt(
                str(root_info["asset_root_id"]), selected, payload,
            )
        except coc_module_project.OpeningPreparationError as exc:
            raise ToolError(
                "initial_progressive_deferral_invalid", exc.message,
            ) from exc
        except coc_module_project.coc_module_assets.ModuleAssetsError as exc:
            raise ToolError(
                "initial_progressive_deferral_invalid", str(exc),
            ) from exc
        except coc_module_project.ModuleProjectError as exc:
            raise ToolError(
                "initial_progressive_deferral_invalid", str(exc),
            ) from exc
        if (
            coc_module_project.current_opening_projection_receipt(ctx.campaign_dir)
            != expected_receipt
            or not coc_module_project.opening_projection_state_is_fresh(
                ctx.root,
                ctx.campaign_dir,
                str(root_info["asset_root_id"]),
                selected,
                binding_result["scope"],
            )
        ):
            raise ToolError(
                "initial_progressive_deferral_invalid",
                "target is not the current receipt-bound authored start projection",
            )
    if scene is None:
        warnings.append(f"scene '{target}' is not in the story graph — moving anyway (improvised location)")
    else:
        candidates = coc_scene_graph.transition_candidates(active, sg, dict(world))
        unlocked = {str(s) for s in world.get("unlocked_scene_ids") or []}
        initial_authored_start = active is None and bool(scene.get("is_start"))
        if target not in candidates and not initial_authored_start:
            if target not in unlocked:
                edges = coc_scene_graph.derive_scene_edges(sg)
                gate = None
                for edge in edges.get(str(active or ""), []):
                    if str(edge["to"]) == target:
                        gate = edge.get("when")
                        break
                detail = f" (authored gate: {json.dumps(gate, ensure_ascii=False)})" if gate else ""
                warnings.append(
                    f"scene '{target}' is not unlocked by the authored design{detail} — "
                    "moving anyway; make sure the fiction has earned this"
                )
            else:
                warnings.append(
                    f"no authored edge from '{active}' to '{target}' — moving anyway (off-graph travel)"
                )

    coc_scene_graph.record_scene_enter(
        world, target,
        decision_id=args.get("decision_id"),
        ts=_now_iso(),
        mark_previous_exhausted=str(active) if args.get("exhaust_previous") and active else None,
    )
    world["active_scene_id"] = target
    newly_unlocked = _evaluate_and_apply_unlocks(ctx, world)
    ctx.save_world(world)
    try:
        time_scene_change = coc_time.record_scene_change(
            ctx.campaign_dir,
            target,
            decision_id=str(args.get("decision_id") or f"scene:{active}:{target}"),
            reason=str(args.get("reason") or ""),
            travel_minutes=travel_minutes,
        )
    except ValueError as exc:
        raise ToolError("invalid_param", str(exc)) from exc

    active_scene_path = ctx.campaign_dir / "save" / "active-scene.json"
    pointer = {
        "schema_version": 1,
        "campaign_id": ctx.campaign_id,
        "scenario_id": world.get("scenario_id"),
        "scene_id": target,
        "source_event_type": "scene_transition",
        "summary": str(args.get("reason") or ""),
        "pending_choices": None,
    }
    coc_state.write_json_atomic(active_scene_path, pointer)
    ctx.log_event({
        "event_type": "scene_transition",
        "from_scene_id": active,
        "to_scene_id": target,
        "reason": args.get("reason"),
        "decision_id": args.get("decision_id"),
    })
    data = {
        "from_scene_id": active,
        "to_scene_id": target,
        "travel_minutes": travel_minutes,
        "travel_time_source": travel_time_source,
        "newly_unlocked_scenes": newly_unlocked,
        "time_scene_change": time_scene_change,
        "scene": {
            "scene_type": (scene or {}).get("scene_type"),
            "dramatic_question": (scene or {}).get("dramatic_question"),
            "tone": (scene or {}).get("tone"),
        } if scene else None,
        "next_operation": {
            "operation": "scene.context",
            "invoke_via": "coc_invoke",
            "prefilled_arguments": {},
            "missing_arguments": [],
            "reason": "Read the newly active scene's bounded material after the transition.",
            "hard_gate": False,
        },
    }
    # Progressive on-demand track: hot-ring enqueue + merge ready deep packs.
    # Never blocks travel; failures become warnings only.
    try:
        progressive_info = (
            {"deferred": True}
            if defer_initial
            else coc_module_project.on_enter_scene(
                ctx.root, str(ctx.campaign_id or ""), target,
            )
        )
        if defer_initial:
            data["progressive"] = {
                "on_enter_deferred": True,
                "deferred_operation": "progressive.on_enter_scene",
                "resume_available": False,
                "scope": "entire_initial_progressive_on_enter_hook",
            }
        elif progressive_info and progressive_info.get("progressive"):
            data["progressive"] = {
                "merged_active": progressive_info.get("merged_active"),
                "neighbors": progressive_info.get("neighbors") or [],
                "prefetched_neighbors": progressive_info.get(
                    "prefetched_neighbors"
                ) or [],
                "deferred_neighbor_count": len(
                    progressive_info.get("deferred_neighbors") or []
                ),
                "neighbor_prefetch_budget": progressive_info.get(
                    "neighbor_prefetch_budget"
                ),
                "host_hints": progressive_info.get("host_hints") or [],
                "asset_root_id": progressive_info.get("asset_root_id"),
            }
            for hint in progressive_info.get("host_hints") or []:
                if isinstance(hint, str) and hint not in warnings:
                    warnings.append(hint)
            if progressive_info.get("merged_active"):
                # Invalidate scenario cache so later tools see deep merge
                ctx._scenario_cache.pop("story-graph.json", None)
                ctx._scenario_cache.pop("clue-graph.json", None)
                ctx._scenario_cache.pop("npc-agendas.json", None)
                ctx._scenario_cache.pop("module-meta.json", None)
                refreshed = _scene_by_id(ctx.story_graph, target)
                if refreshed:
                    data["scene"] = {
                        "scene_type": refreshed.get("scene_type"),
                        "dramatic_question": refreshed.get("dramatic_question"),
                        "tone": refreshed.get("tone"),
                        "parse_state": refreshed.get("parse_state"),
                    }
                post_merge_unlocked = _evaluate_and_apply_unlocks(ctx, world)
                if post_merge_unlocked:
                    newly_unlocked.extend(
                        scene_id for scene_id in post_merge_unlocked
                        if scene_id not in newly_unlocked
                    )
                    data["newly_unlocked_scenes"] = newly_unlocked
                    ctx.save_world(world)
    except Exception as exc:
        warnings.append(f"progressive on-enter skipped: {exc}")

    ctx.ledger_record(args.get("decision_id"), "state.move_scene", data)
    return data, warnings, [
        "call the returned exact scene.context card once after moving; never "
        "preview a destination by passing scene_id to scene.context or by reading "
        "story-graph, clue-graph, module assets, or prior tool logs",
        *_adjudication_gap_hints(ctx),
    ]

def _tool_state_record_route_completion(ctx: Ctx, args: dict[str, Any]):
    tool_name = "state.record_route_completion"
    decision_id = str(args["decision_id"])
    prior = ctx.ledger_lookup(tool_name, decision_id)
    if prior is not None:
        return prior.get("data"), [
            "duplicate decision_id: returning the previously recorded route completion"
        ], []
    normalized = _normalize_engagement_route_completion(ctx, {
        "scene_id": args.get("scene_id"),
        "route_id": args.get("route_id"),
        "semantic_reason": args.get("semantic_reason"),
    })
    evidence_ref = str(args.get("evidence_ref") or "").strip()
    if not evidence_ref:
        raise ToolError("invalid_param", "evidence_ref must be non-empty")
    completion, warnings = _settle_engagement_route_completion(
        ctx,
        normalized,
        decision_id=decision_id,
        evidence_ref=evidence_ref,
    )
    data = {
        "completed": completion is not None,
        "route_completion": deepcopy(completion),
        "authority": "keeper_semantic_judgment",
        "hard_gate": False,
        "next_operation": {
            "operation": "scene.context",
            "invoke_via": "coc_invoke",
            "prefilled_arguments": {},
            "missing_arguments": [],
            "reason": (
                "Refresh the bounded active-scene route index after recording "
                "this campaign-local semantic completion."
            ),
            "hard_gate": False,
        },
    }
    if completion is None:
        warnings.append(
            "the semantic route judgment was preserved as advice but did not yet satisfy the structured completion contract; clue-granting routes complete through state.record_clue route_ref"
        )
        return data, warnings, [
            "keep play moving; use the authored route's returned clue/state cards when their facts are actually delivered"
        ]
    ctx.ledger_record(decision_id, tool_name, data)
    return data, warnings, [
        "dependent authored routes are now visible through scene.context/actions.advise; this receipt does not force the player's next action"
    ]

def _tool_scene_context(ctx, args):
    return _shared_tool_scene_context(ctx, args)


def register_operations(registry) -> None:
    global TOOLS
    TOOLS = registry.legacy_tools
    registry.tool(
    "scene.context",
    "Everything about the current scene: description, NPCs present, clues (with discovery state), exits, pacing, time.",
    {
        "investigator": {
            "type": "string",
            "desc": "optional investigator whose pair-scoped NPC impressions should be projected; defaults only for a one-member party",
        },
        "since_revision": {
            "type": "string",
            "desc": "revision returned by the previous identical query; matching state returns not_modified instead of the full projection",
        },
    },
    access="query",
    read_domains=(
        "scene", "world", "pacing", "clues", "npc_presence", "npc", "time",
        "active_effects", "flags", "party", "module_archive", "module_progressive",
        "mechanics",
    ),
    recovery_domains=("flags", "time_markers", "npc", "npc_presence"),
    response_mode="full_or_not_modified",
    audit_mode="reference",
)(_tool_scene_context)
    registry.tool(
    "scene.map",
    "The whole scene graph with unlock/visit status — where the story can go and what gates each edge.",
    {},
)(_tool_scene_map)
    registry.tool(
    "actions.list",
    "Authored affordances of the current scene with roll gates and precondition status (informational, not blocking).",
    {},
)(_tool_actions_list)
    registry.tool(
    "actions.advise",
    "Contextual authored-route and roll advice for one KP-interpreted player action. Read-only; direct delivery, Push, retry, and narrative suggestions are all soft and never force or block play.",
    {
        "investigator": {"type": "string", "desc": "investigator id (optional when party has one member)"},
        "player_text": {"type": "string", "desc": "optional exact player message for combined Director/Storylet advice"},
        "intent_evidence": {
            "type": "object",
            "desc": (
                "optional KP semantic result; bind authored routes only with "
                "matched_affordance_ids or selected_affordance_ids from the "
                "current action_routes index"
            ),
            "properties": {
                "primary_intent": {
                    "type": "string",
                    "minLength": 1,
                    "desc": "KP semantic label for the player's main intent",
                },
                "semantic_reason": {
                    "type": "string",
                    "minLength": 1,
                    "desc": "why this structured interpretation fits the actual player action",
                },
                "reason": {
                    "type": "string",
                    "minLength": 1,
                    "desc": "backward-compatible alias for semantic_reason",
                },
                "matched_affordance_ids": {
                    "type": "array",
                    "items": {"type": "string", "minLength": 1},
                    "uniqueItems": True,
                    "desc": "preferred exact route IDs from scene.context.action_routes",
                },
                "selected_affordance_ids": {
                    "type": "array",
                    "items": {"type": "string", "minLength": 1},
                    "uniqueItems": True,
                    "desc": "accepted alias for matched_affordance_ids",
                },
                "method": {
                    "type": "string",
                    "desc": "optional semantic description of the attempted method",
                },
                "target": {
                    "type": "string",
                    "desc": "optional semantic target of the action",
                },
                "precautions": {
                    "type": "string",
                    "desc": "optional precautions explicitly established by the player",
                },
                "normalized_action_atoms": {
                    "type": "array",
                    "items": {"type": "object", "additionalProperties": True},
                    "desc": "optional structured atoms from a semantic host resolver",
                },
                "action_resolution": {
                    "type": "object",
                    "additionalProperties": True,
                    "desc": "optional structured semantic-router result",
                },
            },
            "required_fields": ["primary_intent"],
            "additionalProperties": True,
            "examples": [{
                "primary_intent": "search_clippings",
                "semantic_reason": "the player asks the clerk to retrieve the house file",
                "matched_affordance_ids": ["search-clippings"],
            }],
        },
    },
)(_tool_actions_advise)
    registry.tool(
    "director.advise",
    "Build the existing rich Director context and candidate plan from structured KP intent evidence. Advice only; never applies state or forces narration.",
    {
        "player_text": {"type": "string", "required": True, "desc": "exact current player message; retained as evidence, never keyword-classified"},
        "intent_evidence": {"type": "object", "required": True, "desc": "KP semantic result with primary_intent and reason"},
        "investigator": {"type": "string", "desc": "investigator id"},
        "decision_id": {"type": "string", "desc": "stable turn decision id"},
        "seed": {"type": "integer", "desc": "deterministic advisory seed"},
    },
)(_tool_director_advise)
    registry.tool(
    "storylets.suggest",
    "Run the existing rich storylet scheduler against a Director candidate plan. Advisory only; selection never applies itself.",
    {
        "candidate_plan": {"type": "object", "required": True, "desc": "candidate_plan returned by director.advise"},
        "player_text": {"type": "string", "required": True, "desc": "exact player message used for the Director context"},
        "intent_evidence": {"type": "object", "required": True, "desc": "KP semantic intent result"},
        "investigator": {"type": "string", "desc": "investigator id"},
        "max": {"type": "integer", "desc": "max suggestions (default 1)"},
        "seed": {"type": "integer", "desc": "deterministic advisory seed"},
    },
)(_tool_storylets_suggest)
    registry.tool(
    "state.promote_scene",
    "Record a formal scene-role promotion (e.g. transit → side_investigation) with module_divergence evidence. Advisory bookkeeping: it changes how later scene.context reads the scene, never forces a transition.",
    {
        "scene_id": {"type": "string", "desc": "scene to promote (defaults to the active scene)"},
        "to_role": {
            "type": "string",
            "required": True,
            "enum": ["side_investigation", "investigation", "main", "climax"],
            "desc": "new effective role",
        },
        "reason": {"type": "string", "required": True, "desc": "why committed play justifies the promotion"},
        "source_event_ids": {
            "type": "array",
            "required": True,
            "items": {"type": "string"},
            "desc": "non-empty stable event ids that causally justify this campaign-local promotion; only named scene_scope_drift ids resolve drift evidence",
        },
        "decision_id": {"type": "string", "required": True, "desc": "idempotency key"},
    },
)(_tool_state_promote_scene)
    registry.tool(
    "secrets.briefing",
    "Keeper-only briefing scoped to the active scene by default. "
    "Pass scope=whole_module_audit for explicit cold-path full-module dump.",
    {
        "scope": {
            "type": "string",
            "desc": "active_scene (default) | entities | whole_module_audit",
        },
        "scene_id": {
            "type": "string",
            "desc": (
                "for scope=active_scene: optional override (defaults to "
                "world.active_scene_id). for scope=entities: include a scene "
                "only when this is explicitly passed; never implied from active scene"
            ),
        },
        "npc_ids": {
            "type": "array",
            "desc": "optional explicit NPC ids when scope=entities",
        },
        "clue_ids": {
            "type": "array",
            "desc": "optional explicit clue ids when scope=entities",
        },
    },
    access="query",
    read_domains=("scene", "world", "clues", "npc", "flags"),
    response_mode="full",
    audit_mode="reference",
)(_tool_secrets_briefing)
    registry.tool(
    "state.move_scene",
    "Move the party to a scene. Off-graph or locked moves warn but succeed — you own the fiction.",
    {
        "scene_id": {"type": "string", "required": True, "desc": "destination scene id"},
        "exhaust_previous": {"type": "boolean", "desc": "mark the departed scene exhausted (done with it)"},
        "reason": {"type": "string", "desc": "why the story moves (logged)"},
        "decision_id": {"type": "string", "desc": "idempotency key"},
        "travel_minutes": {
            "type": "integer",
            "minimum": 0,
            "desc": "typed elapsed travel time; source-authored scene edges prefill this value",
        },
        "defer_initial_progressive_on_enter": {
            "type": "boolean",
            "desc": "experimental initial-only deferral of the complete progressive on-enter hook",
        },
    },
)(_tool_state_move_scene)
    registry.tool(
    "state.record_route_completion",
    "Record a campaign-local authored route as completed when the KP has structured evidence that play achieved it through a causally valid alternate method. This never infers meaning from prose and never edits module truth.",
    {
        "scene_id": {
            "type": "string",
            "required": True,
            "desc": "exact authored scene id owning the route",
        },
        "route_id": {
            "type": "string",
            "required": True,
            "desc": "exact authored route/affordance id",
        },
        "semantic_reason": {
            "type": "string",
            "required": True,
            "desc": "KP semantic explanation of how established fiction completed the route",
        },
        "evidence_ref": {
            "type": "string",
            "required": True,
            "desc": "exact canonical receipt/event/state reference grounding that judgment",
        },
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)(_tool_state_record_route_completion)


OPERATION_EXPORTS = (
    '_ACTIVE_SCENE_SOURCE_SECTION_MAX_BODY_BYTES',
    '_ACTIVE_SCENE_SOURCE_SECTION_MAX_COUNT',
    '_build_director_advice_payload',
    '_stable_advisory_seed',
    '_storylet_advice_payload',
    '_tool_actions_advise',
    '_tool_actions_list',
    '_tool_director_advise',
    '_tool_scene_context',
    '_tool_scene_map',
    '_tool_secrets_briefing',
    '_tool_state_move_scene',
    '_tool_state_promote_scene',
    '_tool_state_record_route_completion',
    '_tool_storylets_suggest',
    'coc_keeper_planner',
    'coc_story_director',
)
