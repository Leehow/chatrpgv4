#!/usr/bin/env python3
"""Operation adapter cell: inventory-mechanics."""
from __future__ import annotations

from coc_operation_kernel_runtime import (
    Any,
    Ctx,
    ToolError,
    _authored_npc_mechanics_revision_ref,
    _compiled_module_npc_mechanics,
    _module_item,
    _npc_by_id,
    _resolve_granted_item_spec,
    _resolve_investigator,
    _runtime_generated_npc_mechanics,
    _with_mechanics_locator_discovery,
    coc_inventory,
    coc_mechanics,
    coc_module_project,
    coc_npc_state,
    coc_subsystem_executor,
    deepcopy,
    emit_core_canonical_event,
    tool,
)

def _tool_mechanics_ensure(ctx: Ctx, args: dict[str, Any]):
    tool_name = "mechanics.ensure"
    decision_id = str(args["decision_id"])
    prior = ctx.ledger_lookup(tool_name, decision_id)
    if prior is not None:
        return prior.get("data"), [
            "duplicate decision_id: returning the previously resolved mechanics profile"
        ], []
    subject_kind = str(args["subject_kind"] or "").strip()
    subject_id = str(args["subject_id"] or "").strip()
    purpose = str(args["purpose"] or "").strip()
    if subject_kind not in {"npc", "item"}:
        raise ToolError("invalid_param", "subject_kind must be npc or item")
    if not subject_id:
        raise ToolError("invalid_param", "subject_id must be non-empty")
    if purpose not in {"combat", "check", "item_use"}:
        raise ToolError("invalid_param", "purpose must be combat, check, or item_use")

    if subject_kind == "npc":
        subject = _npc_by_id(ctx.npc_agendas, subject_id)
        generated = _runtime_generated_npc_mechanics(ctx, subject_id)
        if generated is not None:
            source_mechanics = (
                subject.get("mechanics") if isinstance(subject, dict) else None
            )
            conflict = None
            warnings = ["the frozen campaign profile was reused"]
            if (
                isinstance(source_mechanics, dict)
                and source_mechanics.get("status") == "authored"
            ):
                conflict = {
                    "kind": "continuity_contradiction",
                    "generated_decision_id": generated.get("decision_id"),
                    "authored_source_refs": deepcopy(
                        source_mechanics.get("source_refs") or []
                    ),
                    "disposition": "generated_profile_remains_campaign_canon_pending_kp_resolution",
                }
                document = coc_npc_state.load_npc_state(ctx.campaign_dir)
                card = (document.get("npcs") or {}).get(subject_id)
                if isinstance(card, dict):
                    card["mechanics_source_conflict"] = deepcopy(conflict)
                    coc_npc_state.save_npc_state(ctx.campaign_dir, document)
                ctx.log_event({
                    "event_type": "mechanics_source_conflict_observed",
                    "subject_kind": subject_kind,
                    "subject_id": subject_id,
                    "decision_id": decision_id,
                    **conflict,
                })
                warnings.append(
                    "later authored mechanics conflict was recorded; campaign canon was not silently overwritten"
                )
            data = {
                "status": "ready",
                "authority": "campaign_generated",
                "subject_kind": subject_kind,
                "subject_id": subject_id,
                "profile": deepcopy(generated["profile"]),
                "mechanics_revision_ref": deepcopy(
                    generated["mechanics_revision_ref"]
                ),
                "combat_participant": coc_mechanics.actor_combat_participant(
                    subject_id, generated["profile"], side="npc",
                    mechanics_revision_ref=generated["mechanics_revision_ref"],
                ),
                "reused": True,
            }
            if conflict is not None:
                data["source_conflict"] = conflict
            ctx.ledger_record(decision_id, tool_name, data)
            return data, warnings, []
    else:
        subject = _module_item(ctx, subject_id)
        campaign_doc = ctx.campaign_mechanics()
        generated = campaign_doc["items"].get(subject_id)
        if isinstance(generated, dict):
            source_mechanics = (
                subject.get("mechanics") if isinstance(subject, dict) else None
            )
            conflict = None
            warnings = ["the frozen campaign item profile was reused"]
            if (
                isinstance(source_mechanics, dict)
                and source_mechanics.get("status") == "authored"
            ):
                conflict = {
                    "kind": "continuity_contradiction",
                    "generated_decision_id": generated.get("decision_id"),
                    "authored_source_refs": deepcopy(
                        source_mechanics.get("source_refs") or []
                    ),
                    "disposition": "generated_profile_remains_campaign_canon_pending_kp_resolution",
                }
                generated["source_conflict"] = deepcopy(conflict)
                ctx.save_campaign_mechanics(campaign_doc)
                ctx.log_event({
                    "event_type": "mechanics_source_conflict_observed",
                    "subject_kind": subject_kind,
                    "subject_id": subject_id,
                    "decision_id": decision_id,
                    **conflict,
                })
                warnings.append(
                    "later authored mechanics conflict was recorded; campaign canon was not silently overwritten"
                )
            data = {
                "status": "ready",
                "authority": "campaign_generated",
                "subject_kind": subject_kind,
                "subject_id": subject_id,
                "profile": deepcopy(generated["profile"]),
                "mechanics_ref": f"campaign-item:{subject_id}",
                "reused": True,
            }
            if conflict is not None:
                data["source_conflict"] = conflict
            ctx.ledger_record(decision_id, tool_name, data)
            return data, warnings, []

    subject = subject if isinstance(subject, dict) else {
        ("npc_id" if subject_kind == "npc" else "item_id"): subject_id,
        "origin": "improvised",
        "label": str(args.get("label") or subject_id),
    }
    mechanics = subject.get("mechanics")
    mechanics = mechanics if isinstance(mechanics, dict) else {"status": "unresolved"}
    source_status = str(mechanics.get("status") or "unresolved")
    if source_status == "authored":
        try:
            coc_mechanics.validate_mechanics_record(
                mechanics, subject_kind=subject_kind,
            )
        except coc_mechanics.MechanicsError as exc:
            raise ToolError("invalid_scenario", str(exc)) from exc
        profile = deepcopy(mechanics["profile"])
        data = {
            "status": "ready",
            "authority": "authored",
            "subject_kind": subject_kind,
            "subject_id": subject_id,
            "profile": profile,
            "source_refs": deepcopy(
                mechanics.get("source_refs") or subject.get("source_refs") or []
            ),
            "reused": True,
        }
        if subject_kind == "npc":
            revision_ref = _authored_npc_mechanics_revision_ref(subject, subject_id)
            data["mechanics_revision_ref"] = revision_ref
            data["combat_participant"] = coc_mechanics.actor_combat_participant(
                subject_id, profile, side="npc",
                mechanics_revision_ref=revision_ref,
            )
        else:
            data["mechanics_ref"] = f"module-item:{subject_id}"
        ctx.ledger_record(decision_id, tool_name, data)
        return data, [], ["authored mechanics were selected over campaign fallback"]

    if source_status == "not_authored":
        try:
            coc_mechanics.validate_mechanics_record(
                mechanics, subject_kind=subject_kind,
            )
        except coc_mechanics.MechanicsError as exc:
            raise ToolError("invalid_scenario", str(exc)) from exc

    # Compiled-module fallback: bundled scenarios carry NPC combat truth in
    # authored combat_engagement affordances (opponent spec + monster_ref into
    # the reviewed ruleset monsters table), not in npc-agendas mechanics.
    # Resolve it before progressive source work, which a non-progressive
    # campaign can never fulfill.
    if subject_kind == "npc":
        compiled = _compiled_module_npc_mechanics(ctx, subject, subject_id)
        if compiled is not None:
            profile = deepcopy(compiled["profile"])
            revision_ref = deepcopy(compiled["mechanics_revision_ref"])
            data = {
                "status": "ready",
                "authority": "compiled_module",
                "subject_kind": subject_kind,
                "subject_id": subject_id,
                "profile": profile,
                "source_refs": deepcopy(compiled["source_refs"]),
                "monster_ref": compiled["monster_ref"],
                "affordance_id": compiled["affordance_id"],
                "mechanics_revision_ref": revision_ref,
                "combat_participant": coc_mechanics.actor_combat_participant(
                    subject_id, profile, side="npc",
                    mechanics_revision_ref=revision_ref,
                ),
                "reused": False,
            }
            ctx.ledger_record(decision_id, tool_name, data)
            return data, [], [
                "compiled module combat data (affordance opponent spec + "
                "ruleset monster row) was selected over progressive source work"
            ]

    if not coc_mechanics.fallback_allowed(subject):
        try:
            source_work = coc_module_project.request_mechanics(
                ctx.root,
                ctx.campaign_id,
                kind=subject_kind,
                target_id=subject_id,
                title=str(args.get("label") or subject.get("name") or subject.get("label") or subject_id),
                reason=f"{purpose}_requires_mechanics",
            )
        except coc_module_project.ModuleProjectError as exc:
            raise ToolError("progressive_error", str(exc)) from exc
        if isinstance(source_work, dict) and source_work.get("skipped") is True:
            # A skipped request is a dead end, not work in progress: the
            # campaign has no progressive module project, so nothing will ever
            # fulfill it.  Failing closed beats returning ok=true and letting
            # the Keeper drift on without mechanics.
            raise ToolError(
                "mechanics_source_unavailable",
                f"{subject_kind} {subject_id!r} has no generated, authored, or "
                f"compiled-module mechanics and no progressive module project "
                f"to source them ({source_work.get('reason')}); the Keeper must "
                "not invent stats for a source NPC",
            )
        source_work, locator_discovery = _with_mechanics_locator_discovery(
            ctx,
            source_work,
            subject_kind=subject_kind,
            subject_id=subject_id,
        )
        data = {
            "status": "source_work_required",
            "authority": "source_unresolved",
            "subject_kind": subject_kind,
            "subject_id": subject_id,
            "source_status": source_status,
            "source_work": source_work,
        }
        hints = [
            "do not generate over a possible authored appendix profile; fulfill the one source-bound mechanics request, then retry"
        ]
        if locator_discovery is not None:
            data["next_operation"] = deepcopy(locator_discovery)
            hints.append(
                "narrative/body source refs are not mechanics locator pages; "
                "use the read-only locator discovery operation without guessing pages"
            )
        return data, [], hints

    if subject_kind == "npc":
        archetype_id = str(args.get("fallback_archetype_id") or "").strip()
        if not archetype_id:
            raise ToolError(
                "fallback_choice_required",
                "KP must choose fallback_archetype_id after source fallback is authorized",
            )
        try:
            profile, generation_log = coc_mechanics.generate_actor_profile(
                npc_id=subject_id,
                archetype_id=archetype_id,
                campaign_id=str(ctx.campaign_id),
                reason=f"{purpose}: {args.get('label') or subject_id}",
            )
        except (coc_mechanics.MechanicsError, ValueError) as exc:
            raise ToolError("invalid_param", str(exc)) from exc
        document = coc_npc_state.load_npc_state(ctx.campaign_dir)
        card = (document.get("npcs") or {}).get(subject_id)
        card = deepcopy(card) if isinstance(card, dict) else {
            "npc_id": subject_id,
            "name": str(args.get("label") or subject.get("name") or subject_id),
            "origin": subject.get("origin") or "improvised",
        }
        card["mechanics"] = {
            "status": "generated",
            "profile": profile,
            "decision_id": decision_id,
            "source_status": source_status,
        }
        card["mechanics"]["mechanics_revision_ref"] = (
            coc_mechanics.mechanics_revision_ref(
                subject_id, 1, profile, authority="campaign_generated",
            )
        )
        document["npcs"][subject_id] = card
        coc_npc_state.save_npc_state(ctx.campaign_dir, document)
        ctx.log_event({
            **generation_log,
            "decision_id": decision_id,
            "authority": "campaign_generated",
            "source_status": source_status,
        })
        data = {
            "status": "ready",
            "authority": "campaign_generated",
            "subject_kind": subject_kind,
            "subject_id": subject_id,
            "profile": profile,
            "mechanics_revision_ref": deepcopy(
                card["mechanics"]["mechanics_revision_ref"]
            ),
            "combat_participant": coc_mechanics.actor_combat_participant(
                subject_id, profile, side="npc",
                mechanics_revision_ref=card["mechanics"]["mechanics_revision_ref"],
            ),
            "reused": False,
        }
    else:
        base_weapon_id = str(args.get("base_weapon_id") or "").strip()
        label = str(args.get("label") or subject.get("label") or subject_id)
        if base_weapon_id:
            catalog = coc_subsystem_executor.coc_combat.load_weapon_catalog()
            if base_weapon_id not in catalog:
                raise ToolError(
                    "invalid_param", f"unknown core base_weapon_id {base_weapon_id!r}",
                )
            profile = {
                "profile_kind": "weapon",
                "weapon_id": f"campaign:{subject_id}",
                "extends": base_weapon_id,
                "name": label,
                "authority": "keeper_improvisation",
            }
            coc_mechanics.validate_weapon_profile(profile)
        else:
            profile = {
                "profile_kind": "gear",
                "name": label,
                "effects": [],
                "authority": "keeper_improvisation",
            }
        campaign_doc["items"][subject_id] = {
            "profile": profile,
            "decision_id": decision_id,
            "source_status": source_status,
        }
        ctx.save_campaign_mechanics(campaign_doc)
        data = {
            "status": "ready",
            "authority": "campaign_generated",
            "subject_kind": subject_kind,
            "subject_id": subject_id,
            "profile": profile,
            "mechanics_ref": f"campaign-item:{subject_id}",
            "reused": False,
        }

    ctx.ledger_record(decision_id, tool_name, data)
    return data, [], [
        "fallback was frozen in campaign state and will be reused; later authored conflict must be recorded, never silently overwritten"
    ]

def _tool_state_inventory_list(ctx: Ctx, args: dict[str, Any]):
    npc_id = str(args.get("npc_id") or "").strip()
    if npc_id:
        document = coc_npc_state.load_npc_state(ctx.campaign_dir)
        row = coc_inventory.npc_items(document, npc_id)
        authored = coc_inventory.authored_weapons_for_npc(ctx.story_graph, npc_id)
        effective = coc_inventory.effective_npc_weapons(document, npc_id, authored)
        return {
            "npc_id": npc_id,
            "weapons": effective or [],
            "gear": row["gear"],
            "override_recorded": row["current_weapons"] is not None,
            "authored_weapons": authored,
        }, [], []
    investigator_id = _resolve_investigator(ctx, args)
    state = ctx.inv_state(investigator_id)
    sheet = ctx.sheet(investigator_id)
    inventory = coc_inventory.normalize_inventory(state)
    weapons = coc_inventory.effective_weapons(sheet.get("weapons"), inventory)
    return {
        "investigator_id": investigator_id,
        "items": coc_inventory.effective_items(
            sheet.get("equipment"), inventory
        ),
        "weapons": weapons,
        "lost_weapon_ids": list(inventory["lost_weapon_ids"]),
        "lost_equipment_ids": list(inventory["lost_equipment_ids"]),
    }, [], []

def _tool_state_item_grant(ctx: Ctx, args: dict[str, Any]):
    tool_name = "state.item_grant"
    decision_id = str(args["decision_id"])
    prior = ctx.ledger_lookup(tool_name, decision_id)
    if prior is not None:
        return prior.get("data"), [
            "duplicate decision_id: returning the previously settled result"
        ], []
    spec = _resolve_granted_item_spec(
        ctx, args, tool_name=tool_name, decision_id=decision_id
    )
    kind = spec["kind"]
    label = spec["label"]
    note = spec["note"]
    consumable = spec["consumable"]
    quantity = spec["quantity"]
    weapon_spec = spec["weapon_spec"]
    item_id = spec["item_id"]
    npc_id = str(args.get("npc_id") or "").strip()
    if npc_id:
        if consumable is not None or quantity is not None:
            raise ToolError(
                "invalid_param",
                "NPC gear is label-only: consumable/quantity apply to investigators",
            )
        document = coc_npc_state.load_npc_state(ctx.campaign_dir)
        if kind == "weapon":
            authored = coc_inventory.authored_weapons_for_npc(
                ctx.story_graph, npc_id
            )
            changed = coc_inventory.npc_add_weapon(
                document, npc_id, weapon_spec, authored
            )
        else:
            changed = coc_inventory.npc_add_gear(document, npc_id, label)
        if changed:
            coc_npc_state.save_npc_state(ctx.campaign_dir, document)
            ctx.log_event({
                "event_type": "item_granted",
                "owner_kind": "npc",
                "npc_id": npc_id,
                "kind": kind,
                "item_id": item_id,
                "weapon_id": coc_inventory.weapon_ref_id(weapon_spec),
                "label": label,
                "note": note,
            })
            _npc_item_payload: dict[str, Any] = {
                "_v": 1,
                "item": item_id,
                "from_holder": "keeper",
                "to_holder": npc_id,
            }
            emit_core_canonical_event(
                ctx,
                event_type="item-transferred",
                source="coc_operation_inventory_mechanics.item_grant",
                decision_id=(
                    str(args.get("decision_id") or "").strip()
                    or f"item-grant:npc:{npc_id}:{item_id}"
                ),
                data=_npc_item_payload,
                privacy="secret",
            )
        data = {
            "npc_id": npc_id,
            "kind": kind,
            "item_id": item_id,
            "label": label,
            "changed": changed,
        }
        if kind == "weapon":
            data["weapon"] = deepcopy(weapon_spec)
        ctx.ledger_record(decision_id, tool_name, data)
        warnings = [] if changed else [f"item '{item_id}' already present"]
        return data, warnings, []

    investigator_id = _resolve_investigator(ctx, args)
    state = ctx.inv_state(investigator_id)
    sheet = ctx.sheet(investigator_id)
    inventory = coc_inventory.normalize_inventory(state)
    entry = spec["entry"]
    inventory, changed = coc_inventory.grant_entry(inventory, entry)
    if changed:
        state["inventory"] = inventory
        ctx.save_inv_state(investigator_id, state)
        ctx.log_event({
            "event_type": "item_granted",
            "owner_kind": "investigator",
            "investigator_id": investigator_id,
            "kind": kind,
            "item_id": item_id,
            "weapon_id": coc_inventory.weapon_ref_id(weapon_spec),
            "label": label,
            "note": note,
        })
        _inv_item_payload: dict[str, Any] = {
            "_v": 1,
            "item": item_id,
            "from_holder": "keeper",
            "to_holder": investigator_id,
        }
        if isinstance(quantity, int) and not isinstance(quantity, bool) and quantity >= 1:
            _inv_item_payload["qty"] = quantity
        if str(note or "").strip():
            _inv_item_payload["reason"] = str(note)
        emit_core_canonical_event(
            ctx,
            event_type="item-transferred",
            source="coc_operation_inventory_mechanics.item_grant",
            decision_id=(
                str(args.get("decision_id") or "").strip()
                or f"item-grant:{investigator_id}:{item_id}"
            ),
            data=_inv_item_payload,
        )
    data = {
        "investigator_id": investigator_id,
        "kind": kind,
        "item_id": item_id,
        "label": label,
        "changed": changed,
        "present_before": not changed,
        "present_after": True,
        "items": coc_inventory.effective_items(
            sheet.get("equipment"), inventory
        ),
    }
    if consumable is not None:
        data["consumable"] = consumable
    if quantity is not None:
        data["quantity"] = quantity
    if kind == "weapon":
        data["weapon"] = deepcopy(weapon_spec)
    ctx.ledger_record(decision_id, tool_name, data)
    warnings = [] if changed else [f"item '{item_id}' already present"]
    hints = (
        [f"weapon '{item_id}' is now a legal combat weapon_id for this investigator"]
        if kind == "weapon" and changed else []
    )
    return data, warnings, hints

def _tool_state_item_remove(ctx: Ctx, args: dict[str, Any]):
    tool_name = "state.item_remove"
    decision_id = str(args["decision_id"])
    prior = ctx.ledger_lookup(tool_name, decision_id)
    if prior is not None:
        return prior.get("data"), [
            "duplicate decision_id: returning the previously settled result"
        ], []
    item_id = str(args["item_id"]).strip()
    if not item_id:
        raise ToolError("invalid_param", "item_id must be non-empty")
    reason = str(args.get("reason") or "").strip() or None

    npc_id = str(args.get("npc_id") or "").strip()
    if npc_id:
        document = coc_npc_state.load_npc_state(ctx.campaign_dir)
        authored = coc_inventory.authored_weapons_for_npc(ctx.story_graph, npc_id)
        outcome = coc_inventory.npc_remove_weapon(
            document, npc_id, item_id, authored
        )
        removed_kind = "weapon"
        if outcome == "not_found":
            outcome = coc_inventory.npc_remove_gear(document, npc_id, item_id)
            removed_kind = "gear"
        changed = outcome != "not_found"
        if changed:
            coc_npc_state.save_npc_state(ctx.campaign_dir, document)
            ctx.log_event({
                "event_type": "item_removed",
                "owner_kind": "npc",
                "npc_id": npc_id,
                "kind": removed_kind,
                "item_id": item_id,
                "reason": reason,
            })
        data = {
            "npc_id": npc_id,
            "item_id": item_id,
            "outcome": outcome,
            "changed": changed,
        }
        ctx.ledger_record(decision_id, tool_name, data)
        warnings = [] if changed else [f"item '{item_id}' not found for npc '{npc_id}'"]
        return data, warnings, []

    investigator_id = _resolve_investigator(ctx, args)
    state = ctx.inv_state(investigator_id)
    sheet = ctx.sheet(investigator_id)
    sheet_weapon_ids = {
        wid
        for wid in (
            coc_inventory.weapon_ref_id(row) for row in (sheet.get("weapons") or [])
        )
        if wid is not None
    }
    sheet_equipment_entries = coc_inventory.sheet_equipment_entries(
        sheet.get("equipment")
    )
    sheet_equipment_ids = {
        str(entry["item_id"]) for entry in sheet_equipment_entries
    }
    inventory = coc_inventory.normalize_inventory(state)
    removed_label = item_id
    for entry in coc_inventory.effective_items(
        sheet.get("equipment"), inventory
    ):
        if isinstance(entry, dict) and str(entry.get("item_id") or "") == item_id:
            removed_label = str(entry.get("label") or item_id)
            break
    else:
        for weapon in coc_inventory.effective_weapons(
            sheet.get("weapons"), inventory
        ):
            if coc_inventory.weapon_ref_id(weapon) == item_id:
                removed_label = str(
                    weapon.get("label")
                    or weapon.get("name")
                    or weapon.get("weapon_id")
                    or item_id
                )
                break
    inventory, outcome = coc_inventory.remove_item(
        inventory, item_id, sheet_weapon_ids, sheet_equipment_ids
    )
    changed = outcome in {
        "removed_entry",
        "marked_lost",
        "marked_lost_equipment",
    }
    if changed:
        state["inventory"] = inventory
        ctx.save_inv_state(investigator_id, state)
        ctx.log_event({
            "event_type": "item_removed",
            "owner_kind": "investigator",
            "investigator_id": investigator_id,
            "item_id": item_id,
            "outcome": outcome,
            "reason": reason,
        })
    data = {
        "investigator_id": investigator_id,
        "item_id": item_id,
        "label": removed_label,
        "outcome": outcome,
        "changed": changed,
        "present_before": changed,
        "present_after": not changed,
        "items": coc_inventory.effective_items(
            sheet.get("equipment"), inventory
        ),
        "lost_weapon_ids": list(inventory["lost_weapon_ids"]),
        "lost_equipment_ids": list(inventory["lost_equipment_ids"]),
    }
    ctx.ledger_record(decision_id, tool_name, data)
    warnings = []
    if not changed:
        warnings.append(f"item '{item_id}' not found for investigator '{investigator_id}'")
    hints = []
    if outcome == "marked_lost":
        hints.append(
            f"'{item_id}' was a character-sheet weapon: the loss is recorded in "
            "campaign state and reaches the investigator library at development settlement"
        )
    if outcome == "marked_lost_equipment":
        hints.append(
            f"'{item_id}' was character-sheet equipment: the loss is recorded in "
            "campaign state and reaches the investigator library at development settlement"
        )
    return data, warnings, hints

def _tool_state_item_use(ctx: Ctx, args: dict[str, Any]):
    tool_name = "state.item_use"
    decision_id = str(args["decision_id"])
    prior = ctx.ledger_lookup(tool_name, decision_id)
    if prior is not None:
        return prior.get("data"), [
            "duplicate decision_id: returning the previously settled result"
        ], []
    item_id = str(args["item_id"]).strip()
    if not item_id:
        raise ToolError("invalid_param", "item_id must be non-empty")
    count = args.get("count", 1)
    if not isinstance(count, int) or isinstance(count, bool) or count < 1:
        raise ToolError("invalid_param", "count must be an integer >= 1")
    note = str(args.get("note") or "").strip() or None

    investigator_id = _resolve_investigator(ctx, args)
    state = ctx.inv_state(investigator_id)
    sheet = ctx.sheet(investigator_id)
    inventory = coc_inventory.normalize_inventory(state)
    used_label = item_id
    for entry in inventory["entries"]:
        if entry["item_id"] == item_id:
            used_label = str(entry.get("label") or item_id)
            break
    inventory, outcome, remaining = coc_inventory.use_entry(
        inventory, item_id, count
    )
    if outcome == "not_consumable":
        raise ToolError(
            "invalid_param",
            f"'{item_id}' is not consumable; use state.item_remove if it is "
            "lost, spent, or given away",
        )
    changed = outcome in {"decremented", "consumed"}
    if changed:
        state["inventory"] = inventory
        ctx.save_inv_state(investigator_id, state)
        ctx.log_event({
            "event_type": "item_used",
            "owner_kind": "investigator",
            "investigator_id": investigator_id,
            "item_id": item_id,
            "count": count,
            "outcome": outcome,
            "remaining": remaining,
            "note": note,
        })
    else:
        sheet_equipment_ids = {
            str(entry["item_id"])
            for entry in coc_inventory.sheet_equipment_entries(
                sheet.get("equipment")
            )
        }
        if item_id in sheet_equipment_ids:
            raise ToolError(
                "invalid_param",
                f"'{item_id}' is character-sheet equipment without consumable "
                "tracking; if it is spent, record it with state.item_remove",
            )
    data = {
        "investigator_id": investigator_id,
        "item_id": item_id,
        "label": used_label,
        "count": count,
        "outcome": outcome,
        "changed": changed,
        "remaining": remaining,
        "present_after": outcome == "decremented",
        "items": coc_inventory.effective_items(
            sheet.get("equipment"), inventory
        ),
    }
    ctx.ledger_record(decision_id, tool_name, data)
    warnings = []
    if not changed:
        warnings.append(
            f"item '{item_id}' not found for investigator '{investigator_id}'"
        )
    hints = []
    if outcome == "consumed":
        hints.append(
            f"'{used_label}' is used up and has left the inventory; the loss "
            "reaches the investigator library at development settlement"
        )
    return data, warnings, hints

def register_operations(registry) -> None:
    global TOOLS
    TOOLS = registry.legacy_tools
    registry.tool(
    "mechanics.ensure",
    "Resolve one NPC or item into a source-bound mechanics profile. Authored PDF data wins; source subjects require a reviewed not-authored receipt before campaign fallback generation. Generated profiles are frozen and reused.",
    {
        "subject_kind": {
            "type": "string", "required": True, "desc": "npc | item",
        },
        "subject_id": {
            "type": "string", "required": True, "desc": "stable NPC/item id",
        },
        "purpose": {
            "type": "string", "required": True,
            "desc": "combat | check | item_use",
        },
        "fallback_archetype_id": {
            "type": "string",
            "desc": "KP-selected ordinary_adult | capable_adult | dangerous_actor; only when fallback is source-authorized",
        },
        "base_weapon_id": {
            "type": "string",
            "desc": "KP-selected comparable core weapon for a campaign-improvised item",
        },
        "label": {"type": "string", "desc": "table-language item/NPC label"},
        "decision_id": {"type": "string", "required": True, "desc": "idempotency key"},
    },
)(_tool_mechanics_ensure)
    registry.tool(
    "state.inventory_list",
    "Show an investigator's effective items and weapons (character sheet minus recorded losses plus runtime gains), or an NPC's runtime items.",
    {
        "investigator": {"type": "string", "desc": "investigator id"},
        "npc_id": {"type": "string", "desc": "NPC actor id (query instead of an investigator)"},
    },
    access="query",
    read_domains=("party", "npc"),
    write_domains=(),
    recovery_domains=(),
    response_mode="full",
    audit_mode="reference",
    strict_read_only=True,
    execution_class="serial_campaign",
)(_tool_state_inventory_list)
    registry.tool(
    "state.item_grant",
    "Grant an item or weapon earned in play before narrating. Search catalog first, then pass a KP-chosen weapon_id. kind=weapon requires a canonical id, legal mechanics_ref, or a complete custom weapon schema; unknown ids fail closed and write nothing. Label-only or kind=gear is not a weapon.",
    {
        "investigator": {"type": "string", "desc": "investigator id"},
        "npc_id": {"type": "string", "desc": "NPC actor id (exactly one of investigator/npc_id)"},
        "kind": {"type": "string", "required": True, "enum": ["gear", "weapon"], "desc": "gear | weapon"},
        "label": {"type": "string", "required": True, "desc": "short display label"},
        "item_id": {"type": "string", "desc": "stable item id (defaults to weapon_id for weapons)"},
        "weapon_id": {"type": "string", "desc": "catalog/module weapon id (kind=weapon)"},
        "weapon": {"type": "object", "desc": "full custom weapon spec with weapon_id (kind=weapon)"},
        "mechanics_ref": {"type": "string", "desc": "campaign-item:<id> or module-item:<id> returned by mechanics.ensure"},
        "consumable": {"type": "boolean", "desc": "kind=gear only: using this item spends charges (state.item_use)"},
        "quantity": {"type": "integer", "desc": "kind=gear only: initial charges for a consumable stack (default 1)"},
        "note": {"type": "string", "desc": "where/how the item was obtained"},
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)(_tool_state_item_grant)
    registry.tool(
    "state.item_remove",
    "Remove an item or weapon from an investigator or NPC (lost, spent, given away, looted). Removing character-sheet equipment or a weapon records a campaign-local loss; removing an NPC weapon updates its runtime override.",
    {
        "investigator": {"type": "string", "desc": "investigator id"},
        "npc_id": {"type": "string", "desc": "NPC actor id (exactly one of investigator/npc_id)"},
        "item_id": {
            "type": "string",
            "required": True,
            "desc": "item id or weapon id to remove",
        },
        "reason": {"type": "string", "desc": "what happened to the item"},
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)(_tool_state_item_remove)
    registry.tool(
    "state.item_use",
    "Use charges of an investigator's consumable item (bandage, laudanum, torch). Decrements quantity; at zero the item leaves the inventory for good. Non-consumables are rejected: use state.item_remove when one is lost or spent.",
    {
        "investigator": {"type": "string", "desc": "investigator id"},
        "item_id": {
            "type": "string",
            "required": True,
            "desc": "consumable item id to use",
        },
        "count": {"type": "integer", "desc": "charges to consume (default 1)"},
        "note": {"type": "string", "desc": "how/why the item was used"},
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)(_tool_state_item_use)


OPERATION_EXPORTS = (
    '_tool_mechanics_ensure',
    '_tool_state_inventory_list',
    '_tool_state_item_grant',
    '_tool_state_item_remove',
    '_tool_state_item_use',
)
