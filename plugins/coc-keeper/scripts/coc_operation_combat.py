#!/usr/bin/env python3
"""Operation adapter cell: combat."""
from __future__ import annotations

from coc_operation_kernel_runtime import (
    register_context_enricher,
    Any,
    Ctx,
    ToolError,
    _affordance_by_id,
    _authored_npc_mechanics_revision_ref,
    _combat_state,
    _compiled_module_npc_mechanics,
    _execute_subsystem_requests,
    _load_npc_presence_document,
    _load_sibling,
    _mark_improvement_tick,
    _npc_by_id,
    _player_mechanical_snapshot,
    _player_state_receipt,
    _resolve_investigator,
    _runtime_generated_npc_mechanics,
    _scene_by_id,
    coc_development,
    coc_inventory,
    coc_rules,
    coc_subsystem_executor,
    deepcopy,
    hashlib,
    json,
    tool,
)

coc_narrative_enrichment = _load_sibling(
    "coc_narrative_enrichment_toolbox", "coc_narrative_enrichment.py"
)

def _investigator_combat_profile(
    ctx: Ctx,
    investigator_id: str,
    *,
    character_snapshot: dict[str, Any],
) -> dict[str, Any]:
    """Project canonical structured combat inputs without reading prose."""
    sheet = character_snapshot
    state = ctx.inv_state(
        investigator_id, character_snapshot=character_snapshot
    )
    characteristics = sheet.get("characteristics") or {}
    skills = sheet.get("skills") or {}
    derived = sheet.get("derived") or {}
    damage = coc_rules.damage_bonus_build(
        int(characteristics.get("STR", 50)),
        int(characteristics.get("SIZ", 50)),
    )
    inventory = coc_inventory.normalize_inventory(state)
    weapons = coc_inventory.effective_weapons(sheet.get("weapons"), inventory)
    if not any(item.get("weapon_id") == "unarmed" for item in weapons):
        weapons.append({"weapon_id": "unarmed"})
    return {
        "actor_id": investigator_id,
        "side": "investigator",
        "dex": int(characteristics.get("DEX", 50)),
        "combat_skill": int(skills.get("Fighting (Brawl)", 25)),
        "dodge_skill": int(
            skills.get(
                "Dodge",
                max(1, int(characteristics.get("DEX", 50)) // 2),
            )
        ),
        "firearms_skill": int(
            max(
                (
                    int(skills[key])
                    for key in skills
                    if isinstance(key, str) and key.startswith("Firearms")
                ),
                default=int(skills.get("Firearms (Handgun)", 0) or 0),
            )
            if isinstance(skills, dict)
            else 0
        ),
        "has_ready_firearm": False,
        "build": int(damage["build"]),
        "damage_bonus": str(damage["damage_bonus"]),
        "hp_max": int(state.get("hp_max", derived.get("HP", 10))),
        "hp_current": int(state.get("current_hp", derived.get("HP", 10))),
        "con": int(characteristics.get("CON", 50)),
        "magic_points": int(state.get("current_mp", derived.get("MP", 0))),
        "armor": 0,
        "armor_rule": None,
        "weapons": weapons,
        "conditions": list(state.get("conditions") or []),
    }

def _loaded_ammunition_snapshot(
    combat: dict[str, Any],
    investigator_id: str,
    profile: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    participants = combat.get("participants") or []
    if isinstance(participants, dict):
        participant = participants.get(investigator_id)
    elif isinstance(participants, list):
        participant = next(
            (
                row for row in participants
                if isinstance(row, dict) and row.get("actor_id") == investigator_id
            ),
            None,
        )
    else:
        participant = None
    participant = participant if isinstance(participant, dict) else {}
    ammo_map = participant.get("_ammo")
    ammo_map = ammo_map if isinstance(ammo_map, dict) else {}
    weapons = participant.get("weapons")
    if not isinstance(weapons, list) or not weapons:
        weapons = profile.get("weapons") or []
    catalog = combat.get("weapon_catalog")
    if not isinstance(catalog, dict):
        catalog = coc_subsystem_executor.coc_combat.load_weapon_catalog()
    snapshot: dict[str, dict[str, Any]] = {}
    for raw in weapons:
        override = raw if isinstance(raw, dict) else {"weapon_id": raw}
        weapon_id = coc_inventory.weapon_ref_id(override)
        weapon = deepcopy((catalog or {}).get(weapon_id) or {})
        weapon.update(override)
        magazine = weapon.get("magazine")
        if weapon_id is None or isinstance(magazine, bool) or not isinstance(magazine, int):
            continue
        loaded = ammo_map.get(weapon_id, magazine)
        if isinstance(loaded, bool) or not isinstance(loaded, int):
            raise ToolError(
                "state_corrupt", f"loaded ammunition for '{weapon_id}' is invalid"
            )
        snapshot[weapon_id] = {
            "weapon_id": weapon_id,
            "weapon_label": str(
                weapon.get("label")
                or weapon.get("name")
                or weapon.get("display_name")
                or weapon_id
            ),
            "loaded": loaded,
        }
    return snapshot

def _record_combat_improvement_ticks(
    ctx: Ctx,
    *,
    investigator_id: str,
    events: list[dict[str, Any]],
    character_snapshot: dict[str, Any] | None = None,
) -> list[str]:
    """Project qualifying investigator combat rolls into toolbox tick state.

    Combat remains owned by the subsystem executor.  This consumer reads only
    its structured roll/turn receipts, binds them to skills on the reusable
    investigator sheet, and delegates eligibility to ``coc_development``.
    NPC, characteristic, damage, opposed-loser, and Luck-bought rolls therefore
    cannot enter the development stream.
    """
    snapshot = (
        character_snapshot
        if character_snapshot is not None
        else ctx.sheet(investigator_id)
    )
    sheet_skills = snapshot.get("skills") or {}
    if not isinstance(sheet_skills, dict):
        return []
    canonical_skills = {
        str(name).casefold(): str(name) for name in sheet_skills
        if isinstance(name, str) and name.strip()
    }
    opposed_wins: dict[str, bool] = {}
    for event in events:
        if event.get("event_type") != "combat_turn_resolved":
            continue
        turn = event.get("turn")
        if not isinstance(turn, dict):
            continue
        outcome = turn.get("opposed_outcome")
        attack_roll_id = turn.get("roll_id")
        defense_roll_id = turn.get("opposed_roll_id")
        if isinstance(attack_roll_id, str) and outcome in {
            "attacker_higher", "tie_attacker_wins",
            "defender_higher", "tie_defender_wins",
        }:
            opposed_wins[attack_roll_id] = outcome in {
                "attacker_higher", "tie_attacker_wins",
            }
        if isinstance(defense_roll_id, str) and outcome in {
            "attacker_higher", "tie_attacker_wins",
            "defender_higher", "tie_defender_wins",
        }:
            opposed_wins[defense_roll_id] = outcome in {
                "defender_higher", "tie_defender_wins",
            }

    recorded: list[str] = []
    for event in events:
        if event.get("event_type") != "combat_roll":
            continue
        # Skill credit follows skill_owner, not mere presence on the turn and
        # not the action designer who only set a remote device in motion.
        skill_owner = coc_development.skill_owner_for_roll(event)
        if skill_owner != investigator_id:
            continue
        raw_skill = event.get("skill")
        if not isinstance(raw_skill, str):
            continue
        skill = canonical_skills.get(raw_skill.casefold())
        if skill is None:
            continue
        roll = deepcopy(event)
        roll["kind"] = "combat_skill"
        roll.setdefault("skill_owner_id", investigator_id)
        if event.get("actor_id") and event.get("actor_id") != investigator_id:
            roll.setdefault("executor_id", event.get("actor_id"))
        if event.get("action_designer_id"):
            roll["action_designer_id"] = event["action_designer_id"]
        roll_id = roll.get("roll_id")
        if isinstance(roll_id, str) and roll_id in opposed_wins:
            roll["opposed_won"] = opposed_wins[roll_id]
        source_event_id = (
            str(roll_id)
            if isinstance(roll_id, str) and roll_id
            else "combat-roll:" + hashlib.sha256(
                json.dumps(event, sort_keys=True, ensure_ascii=False).encode("utf-8")
            ).hexdigest()
        )
        if _mark_improvement_tick(
            ctx,
            investigator_id,
            skill,
            roll,
            source_event_id=source_event_id,
            source_kind="combat.resolve",
            character_snapshot=snapshot,
        ):
            if skill not in recorded:
                recorded.append(skill)
    return recorded

def _tool_combat_context(ctx: Ctx, args: dict[str, Any]):
    state = _combat_state(ctx)
    if not state:
        return {"active": False, "combat": None}, [], [
            "start authored combat with combat.resolve and an affordance_id"
        ]
    pending = state.get("pending_attack")
    return {
        "active": state.get("status") == "active",
        "combat": {"secret": True, "value": state},
        "pending_defense": deepcopy(pending) if isinstance(pending, dict) else None,
    }, [], []

def _tool_combat_resolve(ctx: Ctx, args: dict[str, Any]):
    decision_id = str(args["decision_id"])
    prior = ctx.ledger_lookup("combat.resolve", decision_id)
    if prior is not None:
        return prior.get("data"), [
            "duplicate decision_id: returning the previously settled result"
        ], []

    investigator_id = _resolve_investigator(ctx, args)
    # Bind every character-derived consumer in this command to the same
    # marker-aware, detached file image.  A development settlement may commit
    # after this read, but it cannot make one combat command mix two accepted
    # investigator versions.
    character_snapshot = ctx.sheet(investigator_id)
    investigator_profile = _investigator_combat_profile(
        ctx,
        investigator_id,
        character_snapshot=character_snapshot,
    )
    player_state_before = _player_mechanical_snapshot(ctx, investigator_id)
    world = ctx.world()
    scene = _scene_by_id(ctx.story_graph, world.get("active_scene_id"))
    affordance_id = str(args.get("affordance_id") or "").strip()
    target_npc_id = str(args.get("target_npc_id") or "").strip()
    combat = _combat_state(ctx)
    pending = combat.get("pending_attack")
    action_kind = str(args.get("action_kind") or ("defend" if isinstance(pending, dict) else "attack")).strip()
    if action_kind not in {"attack", "defend", "aim", "reload", "maneuver", "flee"}:
        raise ToolError("invalid_param", "action_kind must be attack|defend|aim|reload|maneuver|flee")
    if isinstance(pending, dict) and action_kind != "defend":
        raise ToolError("combat_defense_required", "a pending attack accepts only action_kind=defend")
    if not isinstance(pending, dict) and action_kind == "defend":
        raise ToolError("combat_defense_not_pending", "action_kind=defend requires a pending attack")
    supplied_revision = args.get("combat_revision")
    if supplied_revision is not None and (
        isinstance(supplied_revision, bool) or not isinstance(supplied_revision, int)
    ):
        raise ToolError("invalid_param", "combat_revision must be an integer")
    if (
        supplied_revision is not None
        and combat.get("status") == "active"
        and supplied_revision != combat.get("revision")
    ):
        raise ToolError("stale_combat_revision", "combat revision is stale")
    if isinstance(pending, dict) and target_npc_id:
        raise ToolError(
            "invalid_param",
            "target_npc_id cannot replace the actor bound to a pending attack",
        )
    needs_target = action_kind in {"attack", "maneuver"}
    if not isinstance(pending, dict) and needs_target and bool(affordance_id) == bool(target_npc_id):
        raise ToolError(
            "unknown_combat_target",
            "provide exactly one present target_npc_id or combat affordance_id; "
            "a vague threat is not a legal combatant. Do not narrate hit, damage, "
            "or ammunition spend until combat.resolve settles a canonical target.",
        )
    if isinstance(pending, dict):
        # A pending attack already freezes both actors, weapon and command
        # identity.  Resolving the player's exact defense must not require the
        # UI/Keeper to rediscover the authored route that created it.
        affordance = None
        operation = {}
    elif not needs_target:
        if affordance_id or target_npc_id:
            raise ToolError(
                "invalid_param",
                f"action_kind={action_kind} does not accept a combat target or affordance",
            )
        affordance = None
        operation = {}
    elif (
        action_kind == "maneuver"
        and combat.get("status") == "active"
        and target_npc_id in {
            str(row.get("actor_id") or "")
            for row in (combat.get("participants") or [])
            if isinstance(row, dict)
        }
    ):
        affordance = None
        operation = {
            "opponent": {"actor_id": target_npc_id},
            "opponent_defense": "dodge",
        }
    elif target_npc_id:
        presence_document = _load_npc_presence_document(ctx)
        live_presence = presence_document["presence"]
        active_scene_id = str(world.get("active_scene_id") or "")
        authored_ids = {
            str(value) for value in ((scene or {}).get("npc_ids") or []) if value
        }
        live = live_presence.get(target_npc_id)
        present = (
            (
                target_npc_id in authored_ids
                and not (
                    isinstance(live, dict)
                    and (
                        live.get("status") != "present"
                        or str(live.get("scene_id") or "") != active_scene_id
                    )
                )
            )
            or (
                isinstance(live, dict)
                and live.get("status") == "present"
                and str(live.get("scene_id") or "") == active_scene_id
            )
        )
        if not present:
            raise ToolError(
                "unknown_combat_target",
                f"NPC {target_npc_id!r} is not a present canonical combatant in the "
                f"active scene. Call npc/scene/mechanics tools to obtain an id, or tell "
                f"the player the target cannot be confirmed. Do not narrate hit or damage.",
            )
        generated = _runtime_generated_npc_mechanics(ctx, target_npc_id)
        agenda = _npc_by_id(ctx.npc_agendas, target_npc_id) or {}
        source_mechanics = agenda.get("mechanics") if isinstance(agenda, dict) else None
        if generated is not None:
            profile = generated.get("profile")
            opponent_revision_ref = deepcopy(
                generated.get("mechanics_revision_ref")
            )
        elif (
            isinstance(source_mechanics, dict)
            and source_mechanics.get("status") == "authored"
        ):
            profile = source_mechanics.get("profile")
            opponent_revision_ref = _authored_npc_mechanics_revision_ref(
                agenda, target_npc_id,
            )
        else:
            compiled = _compiled_module_npc_mechanics(ctx, agenda, target_npc_id)
            if compiled is None:
                raise ToolError(
                    "mechanics_not_ready",
                    f"NPC {target_npc_id!r} has no ready mechanics profile; call mechanics.ensure first",
                )
            profile = compiled["profile"]
            opponent_revision_ref = deepcopy(compiled["mechanics_revision_ref"])
        if not isinstance(profile, dict):
            raise ToolError("invalid_scenario", "ready NPC mechanics profile is malformed")
        module_weapons: list[dict[str, Any]] = []
        module_items = (
            ((ctx.module_meta.get("module_mechanics") or {}).get("items") or {})
            if isinstance(ctx.module_meta.get("module_mechanics"), dict) else {}
        )
        for item in module_items.values() if isinstance(module_items, dict) else []:
            mechanics = item.get("mechanics") if isinstance(item, dict) else None
            item_profile = mechanics.get("profile") if isinstance(mechanics, dict) else None
            if isinstance(item_profile, dict) and item_profile.get("profile_kind") == "weapon":
                weapon = deepcopy(item_profile)
                weapon.pop("profile_kind", None)
                module_weapons.append(weapon)
        route_id = f"campaign-combat:{target_npc_id}"
        opponent_weapons = list(profile.get("weapons") or [{"weapon_id": "unarmed"}])
        first_weapon = opponent_weapons[0]
        opponent_weapon_id = (
            str(first_weapon.get("weapon_id"))
            if isinstance(first_weapon, dict) else str(first_weapon)
        )
        operation = {
            "kind": "combat_engagement",
            "opponent": {
                "actor_id": target_npc_id,
                "side": "npc",
                "mechanics_profile": deepcopy(profile),
                "mechanics_revision_ref": opponent_revision_ref,
            },
            "module_weapons": module_weapons + [
                {key: deepcopy(value) for key, value in weapon.items()}
                for weapon in opponent_weapons
                if isinstance(weapon, dict) and weapon.get("weapon_id")
            ],
            "opponent_defense": "dodge",
            "opponent_weapon_id": opponent_weapon_id or "unarmed",
            "resolution_hint": "opposed_melee",
        }
        affordance_id = route_id
        affordance = {"id": route_id, "rules_operation": operation}
        scene = deepcopy(scene or {"scene_id": active_scene_id})
        scene.setdefault("affordances", []).append(affordance)
    else:
        affordance = _affordance_by_id(scene, affordance_id)
        operation = (
            affordance.get("rules_operation") if isinstance(affordance, dict) else None
        )
        if not isinstance(operation, dict) or operation.get("kind") != "combat_engagement":
            raise ToolError(
                "unknown_combat_affordance",
                f"'{affordance_id}' has no authored combat_engagement operation in the active scene",
            )
        operation = deepcopy(operation)
        opponent = operation.get("opponent")
        if (
            isinstance(opponent, dict)
            and isinstance(opponent.get("mechanics_profile"), dict)
            and not isinstance(opponent.get("mechanics_revision_ref"), dict)
        ):
            opponent_id = str(opponent.get("actor_id") or "")
            generated = _runtime_generated_npc_mechanics(ctx, opponent_id)
            authored = _npc_by_id(ctx.npc_agendas, opponent_id) or {}
            authored_mechanics = (
                authored.get("mechanics") if isinstance(authored, dict) else None
            )
            if generated is not None:
                opponent["mechanics_revision_ref"] = deepcopy(
                    generated["mechanics_revision_ref"]
                )
            elif (
                isinstance(authored_mechanics, dict)
                and authored_mechanics.get("status") == "authored"
            ):
                opponent["mechanics_revision_ref"] = (
                    _authored_npc_mechanics_revision_ref(authored, opponent_id)
                )

    warnings: list[str] = []
    selected_effect_ids = args.get("weapon_effect_ids") or []
    if not isinstance(selected_effect_ids, list) or any(
        not isinstance(value, str) or not value for value in selected_effect_ids
    ):
        raise ToolError("invalid_param", "weapon_effect_ids must be non-empty strings")
    if len(selected_effect_ids) != len(set(selected_effect_ids)):
        raise ToolError("invalid_param", "weapon_effect_ids must be unique")
    owned_rows = [
        row for row in (investigator_profile.get("weapons") or [])
        if isinstance(row, dict) and row.get("weapon_id")
    ]
    base_catalog = coc_subsystem_executor.coc_combat.resolve_module_weapons(None)
    # Owned ``extends`` weapons are catalog-backed: resolve them through the
    # same merge the engine applies, so a granted module-style weapon is as
    # resolvable as the canonical weapon it extends.
    owned_extends_profiles = [
        deepcopy(row) for row in owned_rows
        if str(row.get("extends") or "").strip()
        and str(row.get("weapon_id") or "") not in base_catalog
    ]
    catalog = (
        coc_subsystem_executor.coc_combat.resolve_module_weapons(
            owned_extends_profiles, base_catalog
        )
        if owned_extends_profiles
        else base_catalog
    )
    for row in owned_rows:
        catalog_row = catalog.get(str(row.get("weapon_id") or ""))
        if isinstance(catalog_row, dict):
            if not str(row.get("skill") or "").strip():
                row["skill"] = catalog_row.get("skill")
            if row.get("magazine") is None and catalog_row.get("magazine") is not None:
                row["magazine"] = catalog_row.get("magazine")
            if not str(row.get("damage") or row.get("damage_die") or "").strip():
                row["damage"] = catalog_row.get("damage") or catalog_row.get("damage_die")
    selected_weapon_id = str(args.get("weapon_id") or "").strip()
    owned_row = coc_inventory.resolve_owned_weapon(owned_rows, selected_weapon_id)
    if owned_row is None and not selected_weapon_id:
        owned_row = coc_inventory.unique_owned_firearm(owned_rows)
    if owned_row is not None:
        selected_weapon_id = str(owned_row.get("weapon_id") or selected_weapon_id)
        args = {**args, "weapon_id": selected_weapon_id}
        sheet_skill = coc_inventory.sheet_skill_for_weapon_skill(
            character_snapshot.get("skills") if isinstance(character_snapshot, dict) else None,
            str(owned_row.get("skill") or ""),
        )
        if sheet_skill is not None:
            investigator_profile["firearms_skill"] = int(sheet_skill[1])
    if selected_weapon_id and selected_weapon_id != "unarmed":
        # Investigator attacks require inventory/sheet ownership. Catalog
        # membership only proves the id is a valid parameter, never possession.
        # NPC/monster profile weapons are resolved from actor authority later.
        owned = {str(row.get("weapon_id")) for row in owned_rows}
        if owned_row is None:
            owned_row = next(
                (
                    row for row in owned_rows
                    if str(row.get("weapon_id") or "") == selected_weapon_id
                ),
                None,
            )
        complete_custom = (
            isinstance(owned_row, dict)
            and str(owned_row.get("skill") or "").strip()
            and str(owned_row.get("damage") or "").strip()
        )
        if selected_weapon_id not in owned:
            # Name what the investigator is carrying. The refusal used to name
            # only the id that failed, while `owned` sat right here: a Keeper
            # that wrote `weapon:38-revolver` from the sheet's display name
            # ".38 Revolver" had no way to learn the canonical
            # `revolver_38_or_9mm` short of a catalog search. Measured
            # 2026-09-02 r56: two such refusals, then eight
            # `nonretryable_repeat_blocked`, and the lane never fired a shot.
            carrying = (
                "carrying: " + ", ".join(sorted(owned)) if owned
                else "the investigator carries no resolvable weapon"
            )
            if selected_weapon_id in catalog:
                raise ToolError(
                    "unowned_weapon",
                    f"unowned_weapon: {selected_weapon_id!r} is catalog-valid "
                    f"but not in investigator inventory; {carrying}",
                )
            raise ToolError(
                "unknown_weapon",
                f"unknown_weapon: {selected_weapon_id!r} is not a catalog, "
                f"module, or owned custom weapon; {carrying}",
            )
        if selected_weapon_id not in catalog and not complete_custom:
            raise ToolError(
                "unknown_weapon",
                f"unknown_weapon: {selected_weapon_id!r} is owned but is not a resolvable weapon",
            )
    if selected_effect_ids:
        selected_weapon_id = str(args.get("weapon_id") or "").strip()
        selected_weapon = next(
            (
                weapon for weapon in investigator_profile.get("weapons") or []
                if isinstance(weapon, dict)
                and str(weapon.get("weapon_id") or "") == selected_weapon_id
            ),
            None,
        )
        effect_map = {
            str(effect.get("effect_id")): effect
            for effect in ((selected_weapon or {}).get("effects") or [])
            if isinstance(effect, dict) and effect.get("effect_id")
        }
        if not selected_weapon_id or any(
            effect_id not in effect_map for effect_id in selected_effect_ids
        ):
            raise ToolError(
                "invalid_param",
                "weapon_effect_ids must belong to the selected owned weapon",
            )
        if any(
            effect_map[effect_id].get("resolution")
            != "combat_damage_multiplier"
            for effect_id in selected_effect_ids
        ):
            raise ToolError(
                "invalid_param",
                "only combat_damage_multiplier effects can be activated by combat.resolve",
            )
    discovered = {str(value) for value in world.get("discovered_clue_ids") or []}
    missing = [
        str(value)
        for value in ((affordance or {}).get("requires_discovered_clue_ids") or [])
        if str(value) not in discovered
    ]
    if missing:
        warnings.append(
            "authored combat affordance prerequisites are not recorded: "
            + ", ".join(missing)
        )

    loaded_ammunition_before = _loaded_ammunition_snapshot(
        combat, investigator_id, investigator_profile
    )
    if combat.get("status") == "concluded":
        warnings.append(
            "the prior combat is concluded; this chosen attack starts a new "
            "authored encounter with a fresh combat/command/roll identity"
        )
    if isinstance(pending, dict):
        target_id = str(pending.get("target_actor_id") or "")
        defense_kind = args.get("defense_kind")
        if target_id == investigator_id and not defense_kind:
            raise ToolError(
                "combat_defense_required",
                "the investigator must choose defense_kind before this pending attack can resolve",
            )
        if not defense_kind:
            defense_kind = operation.get("opponent_defense") or "dodge"
        requests = [{
            "kind": "combat_defend",
            "command_id": f"{pending['attack_command_id']}-defense",
            "revision": int(combat.get("revision", 0)),
            "actor_id": target_id,
            "attack_command_id": str(pending["attack_command_id"]),
            "defense_kind": str(defense_kind),
            "route_resolution": {
                "matched_route_ids": [affordance_id] if affordance_id else [],
            },
        }]
    elif action_kind == "attack":
        rich: dict[str, Any] = {
            "action_resolution": {
                "matched_affordance_ids": [affordance_id],
                "no_match": False,
            }
        }
        if args.get("weapon_id"):
            rich["combat_action"] = {
                "weapon_id": str(args["weapon_id"]),
                "weapon_effect_ids": list(selected_effect_ids),
            }
        requests = coc_narrative_enrichment.build_route_operation_requests({
            "active_scene": scene or {},
            "combat_state": combat,
            "world_state": world,
            "investigator_combat_profile": investigator_profile,
            "character": character_snapshot,
            "player_intent_rich": rich,
            "turn_number": int(ctx.pacing().get("turn_number") or 0),
        })
        # Conclusion rewards deliberately belong to development.settle, not
        # the combat tool.  A combat call may execute only combat commands.
        requests = [
            request for request in requests
            if str(request.get("kind") or "").startswith("combat_")
        ]
    else:
        target_actor_id = target_npc_id
        if not target_actor_id and isinstance(operation.get("opponent"), dict):
            target_actor_id = str(operation["opponent"].get("actor_id") or "")
        request = {
            "kind": "combat_attack",
            "command_id": f"{combat.get('combat_id', 'combat')}-{action_kind}-{combat.get('revision', 0)}",
            "revision": int(combat.get("revision", 0)),
            "actor_id": investigator_id,
            "declared_intent": f"structured combat {action_kind}",
            "resolution_hint": action_kind,
        }
        if target_actor_id:
            request["target_actor_id"] = target_actor_id
        if args.get("weapon_id"):
            request["weapon_id"] = str(args["weapon_id"])
        if action_kind == "maneuver":
            request["goal"] = str(args.get("goal") or "ongoing_disadvantage")
            request["defense_kind"] = str(args.get("defense_kind") or "dodge")
        requests = [request]

    luck_cap = args.get("luck_spend_max")
    if luck_cap is not None:
        if isinstance(luck_cap, bool) or not 1 <= int(luck_cap) <= 99:
            raise ToolError("invalid_param", "luck_spend_max must be 1..99")
        defend_requests = [
            request for request in requests
            if request.get("kind") == "combat_defend"
        ]
        if len(defend_requests) != 1:
            raise ToolError(
                "combat_luck_precommit_unavailable",
                "this combat beat does not contain exactly one opposed resolution",
            )
        defend_requests[0]["luck_spend_max"] = int(luck_cap)
        defend_requests[0]["luck_actor_id"] = investigator_id

    results, events = _execute_subsystem_requests(
        ctx,
        investigator_id=investigator_id,
        decision_id=decision_id,
        requests=requests,
        seed=args.get("seed"),
        character_snapshot=character_snapshot,
    )
    improvement_ticks = _record_combat_improvement_ticks(
        ctx,
        investigator_id=investigator_id,
        events=events,
        character_snapshot=character_snapshot,
    )
    current = _combat_state(ctx)
    player_state_after = _player_mechanical_snapshot(ctx, investigator_id)
    loaded_ammunition_after = _loaded_ammunition_snapshot(
        current, investigator_id, investigator_profile
    )
    data = {
        "results": results,
        "events": events,
        "combat": current,
        "pending_defense": deepcopy(current.get("pending_attack")),
        "improvement_ticks_recorded": improvement_ticks,
        "player_state_receipt": _player_state_receipt(
            player_state_before,
            player_state_after,
            ammo_before=loaded_ammunition_before,
            ammo_after=loaded_ammunition_after,
        ),
    }
    hints: list[str] = []
    if improvement_ticks:
        hints.append(
            "qualifying combat success: improvement tick recorded for "
            + ", ".join(improvement_ticks)
        )
    if isinstance(current.get("pending_attack"), dict):
        hints.append(
            "an attack is pending: ask the player for a legal defense, then call "
            "combat.resolve again with defense_kind"
        )
    luck_events = [
        event for event in events
        if event.get("event_type") == "combat_luck_spent"
    ]
    if luck_events:
        spent = luck_events[-1]
        hints.append(
            f"Luck precommit spent {spent.get('luck_spent')} point(s); "
            f"{spent.get('luck_after')} remain"
        )
    if current.get("status") == "concluded":
        hints.append(
            "combat outcome and combat_ended receipt are mechanically concluded; "
            "this does not by itself end the session or scenario. Continue with "
            "rescue/aftermath when fiction supports it, and call state.end_session "
            "only at an intentional session boundary"
        )
    ctx.ledger_record(decision_id, "combat.resolve", data)
    return data, warnings, hints

def _tool_combat_end(ctx: Ctx, args: dict[str, Any]):
    decision_id = str(args["decision_id"])
    prior = ctx.ledger_lookup("combat.end", decision_id)
    if prior is not None:
        return prior.get("data"), [
            "duplicate decision_id: returning the previously settled result"
        ], []
    investigator_id = _resolve_investigator(ctx, args)
    combat = _combat_state(ctx)
    if not combat:
        raise ToolError("combat_not_started", "no canonical combat snapshot exists")
    outcome = str(args["outcome"])
    if (
        combat.get("status") == "concluded"
        and combat.get("outcome") not in (None, outcome)
    ):
        raise ToolError(
            "combat_outcome_mismatch",
            "combat.end outcome must match the mechanically concluded outcome",
        )
    results, events = _execute_subsystem_requests(
        ctx,
        investigator_id=investigator_id,
        decision_id=decision_id,
        requests=[{
            "kind": "combat_end",
            "command_id": f"{combat.get('combat_id', 'combat')}-end-{combat.get('revision', 0)}",
            "revision": int(combat.get("revision", 0)),
            "outcome": outcome,
        }],
        tool_name="combat.end",
    )
    data = {"results": results, "events": events, "combat": _combat_state(ctx)}
    ctx.ledger_record(decision_id, "combat.end", data)
    return data, [], [
        "if this is the scenario conclusion, call state.end_session and then the "
        "coc-development skill's development.settle operation"
    ]

def register_operations(registry) -> None:
    global TOOLS
    TOOLS = registry.legacy_tools
    # `rules.context` for this family carries the canonical block this
    # handler builds. Registering is what makes that happen; reaching for
    # it through globals() silently did nothing (see the kernel registry).
    register_context_enricher("combat", _tool_combat_context)
    registry.tool(
    "combat.context",
    "Read the canonical combat snapshot, initiative cursor, and pending defense choice.",
    {},
)(_tool_combat_context)
    registry.tool(
    "combat.resolve",
    "Execute one authored or KP-selected combat beat. Required for every player attack, shot, Dodge, or Fight Back. Never substitute rules.roll or unrolled hit/damage prose. weapon_id may be catalog id or inventory item_id; skill is taken from the owned weapon + sheet. Without a present target_npc_id or combat affordance, fail closed — do not narrate a hit.",
    {
        "action_kind": {
            "type": "string",
            "enum": ["attack", "defend", "aim", "reload", "maneuver", "flee"],
            "desc": "explicit structured combat action; omitted only for legacy attack/pending-defense calls",
        },
        "affordance_id": {
            "type": "string",
            "desc": "current-scene affordance whose rules_operation is combat_engagement",
        },
        "target_npc_id": {
            "type": "string",
            "desc": "present stable NPC/combatant id. Required for emergent shots. A vague threat with no id is not a legal target; do not invent hit/damage.",
        },
        "investigator": {"type": "string", "desc": "investigator id"},
        "weapon_id": {
            "type": "string",
            "desc": "owned catalog weapon_id or inventory item_id (e.g. weapon-carcano-rifle); gateway maps to mechanics and sheet Firearms skill",
        },
        "weapon_effect_ids": {
            "type": "array",
            "desc": "authored weapon effect IDs whose applicability the KP has semantically established for this attack",
        },
        "defense_kind": {
            "type": "string",
            "desc": "structured reaction: dodge (ties defend) | fight_back (ties attack) | dive_for_cover | none",
        },
        "luck_spend_max": {
            "type": "integer",
            "desc": "optional pre-authorization (1..99): spend only the minimum Luck that changes this opposed melee result",
        },
        "goal": {
            "type": "string",
            "enum": ["disarm", "ongoing_disadvantage", "escape", "push"],
            "desc": "one rulebook maneuver goal; valid only for action_kind=maneuver",
        },
        "combat_revision": {
            "type": "integer",
            "desc": "host-bound current CombatSession revision; stale values fail closed",
        },
        "decision_id": {
            "type": "string", "required": True, "desc": "idempotency key"
        },
    },
)(_tool_combat_resolve)
    registry.tool(
    "combat.end",
    "Finalize the current CombatSession and emit the canonical combat_ended receipt.",
    {
        "investigator": {"type": "string", "desc": "investigator id"},
        "outcome": {
            "type": "string",
            "required": True,
            "desc": "structured CombatSession outcome",
        },
        "decision_id": {
            "type": "string", "required": True, "desc": "idempotency key"
        },
    },
)(_tool_combat_end)


OPERATION_EXPORTS = (
    '_investigator_combat_profile',
    '_loaded_ammunition_snapshot',
    '_record_combat_improvement_ticks',
    '_tool_combat_context',
    '_tool_combat_end',
    '_tool_combat_resolve',
    'coc_narrative_enrichment',
)
