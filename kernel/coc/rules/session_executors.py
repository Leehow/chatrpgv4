"""Executors for the session families (contract §11.5): combat, chase and sanity.

The old subsystem executor is not ported. Each executor loads the engine snapshot from
`save/`, drives the ported engine (CombatSession / ChaseSession / SanitySession), turns
the engine's roll records into kernel receipts (`roll`, `delta`, `session`), mirrors the
investigator's HP / MP / SAN / conditions back onto the sheet, and saves the snapshot.
Rounds and initiative are the engine's; NPC turns are driven by the Keeper through
`resolve` with `actor: <npc>`."""

from __future__ import annotations

from typing import Any, Mapping

from ..errors import RpcError, invalid_params, unsupported_value
from ..sessions import (SessionView, chase_active, combat_active,
                        combat_operation_for, defense_options, engine_defense, investigator_combat_participant,
                        load_chase, load_combat, load_sanity, module_weapons, npc_combat_participant,
                        resolve_investigator_weapon, weapon_options)
from .chase import DEFAULT_GAP, ChaseSession
from .combat import VALID_OUTCOMES, CombatSession, UnknownWeaponError
from .executors import register
from .percentile import SUCCESS_OUTCOMES, roll_expression
from .sanity import INVOLUNTARY_KINDS, consume_sanity_gain_pending

SELF_RESOLVING = frozenset({"aim", "reload", "maneuver", "flee"})
#: The command words `chase.execute` and `sanity.execute` know, so a refusal can name them
#: instead of only naming the word that was wrong (contract §14.15).
CHASE_COMMAND_KINDS = ("chase_start", "chase_move", "chase_hazard", "chase_barrier",
                       "chase_conflict", "chase_end")
SANITY_EXECUTE_KINDS = ("sanity_check", "bout_tick", "bout_end")


def turn_state(message: str, *, fix: str | None = None, **details: Any) -> RpcError:
    return RpcError("turn_state", message, fix=fix, details=details or None)


# ---- receipts from engine records ------------------------------------------------------------

def record_percentile(ctx: Any, record: Mapping[str, Any], *, kind: str, **extra: Any) -> str:
    """One engine percentile record -> one `roll` receipt (NPC rolls public, `actor_label`)."""
    target = int(record.get("target") if record.get("target") is not None else record.get("base_target") or 0)
    difficulty = str(record.get("required_level") or record.get("difficulty") or "regular")
    threshold = record.get("required_target")
    if threshold is None:
        threshold = ctx.tables.difficulty_target(target, difficulty)
    outcome = str(record.get("outcome") or record.get("achieved_level") or "failure")
    passed = record.get("passed")
    if passed is None:
        passed = outcome in SUCCESS_OUTCOMES
    return ctx.add_roll(actor=str(record["actor_id"]), skill=str(record.get("skill") or "check"), target=target,
                        difficulty=difficulty, threshold=int(threshold), roll=int(record["roll"]), level=outcome,
                        passed=bool(passed), bonus=int(record.get("bonus") or 0), penalty=int(record.get("penalty") or 0),
                        visibility="public", kind=kind, engine_roll_id=record.get("roll_id"), **extra)


def record_dice(ctx: Any, record: Mapping[str, Any], *, label: str | None = None, **extra: Any) -> str:
    dice = record.get("dice") if isinstance(record.get("dice"), dict) else {}
    expression = dice.get("expression") or record.get("die_expression") or record.get("die")
    faces = dice.get("raw") if isinstance(dice.get("raw"), list) else record.get("die_rolls")
    if not isinstance(faces, list):
        faces = [int(record.get("roll"))] if record.get("roll") is not None else []
    total = dice.get("total") if dice else record.get("effect_total", record.get("roll"))
    skill = str(record.get("skill") or "dice")
    return ctx.add_dice_roll(actor=str(record["actor_id"]), label=skill, skill_label=label or skill,
                             expression=expression, faces=[int(f) for f in faces], total=total, **extra)


def record_engine_rolls(ctx: Any, rolls: list[dict[str, Any]], *, kind: str, **extra: Any) -> list[str]:
    ids = []
    for record in rolls:
        if not isinstance(record, dict) or not isinstance(record.get("roll_id"), str):
            continue
        if record.get("roll_role") == "amount" or record.get("skill") == "HP Damage" or "die_expression" in record:
            ids.append(record_dice(ctx, record, **extra))
        elif record.get("roll") is not None and (record.get("target") is not None or record.get("base_target") is not None):
            ids.append(record_percentile(ctx, record, kind=kind, **extra))
    return ids


# ---- combat --------------------------------------------------------------------------------

def _eligible(participant: Mapping[str, Any]) -> bool:
    conditions = participant.get("conditions") or []
    return int(participant.get("hp_current") or 0) > 0 and not any(
        value in conditions for value in ("dead", "dying", "unconscious", "fled"))


def _cursor_actor(session: CombatSession) -> str | None:
    order = session._current_initiative
    if 0 <= session.initiative_cursor < len(order):
        return str(order[session.initiative_cursor]["actor_id"])
    return None


def _normalize_cursor(session: CombatSession) -> None:
    """Ported `_normalize_combat_cursor`: skip ineligible actors, start a new round once."""
    while session.initiative_cursor < len(session._current_initiative):
        actor_id = session._current_initiative[session.initiative_cursor]["actor_id"]
        if _eligible(session.participants[actor_id]):
            return
        session.mark_current_initiative_skipped()
        session.initiative_cursor += 1
    session.begin_round()


def _side_alive(session: CombatSession, investigators: bool) -> bool:
    return any(_eligible(p) for p in session.participants.values()
               if (p.get("side") == "investigator") == investigators)


def _conclusion(session: CombatSession, ctx: Any, operation: Mapping[str, Any] | None) -> str | None:
    """Mechanical conclusion after a turn: a wiped side, or every investigator fled."""
    if session.status != "active":
        return session.outcome
    operation = operation or {}
    investigators = [p for p in session.participants.values() if p.get("side") == "investigator"]
    if investigators and all("fled" in (p.get("conditions") or []) for p in investigators):
        session.conclude("fled")
    elif not _side_alive(session, investigators=True):
        session.conclude(str(operation.get("defeat_outcome") or "monsters_win"))
    elif not _side_alive(session, investigators=False):
        session.conclude(str(operation.get("victory_outcome") or "investigators_win"))
    else:
        return None
    session.ended_at_turn = ctx.turn_number
    return session.outcome


def _hp_state(session: CombatSession) -> dict[str, dict[str, Any]]:
    """What a call may change per participant. The engine fills a magazine lazily on first
    use, so every carried firearm is read once here to give the ammo effect its `before`."""
    state: dict[str, dict[str, Any]] = {}
    for pid, p in session.participants.items():
        ammo: dict[str, int] = {}
        for row in p.get("weapons") or []:
            weapon_id = row.get("weapon_id") if isinstance(row, dict) else str(row)
            try:
                loaded = session.get_ammo(pid, str(weapon_id))
            except (UnknownWeaponError, KeyError, ValueError):
                loaded = None
            if loaded is not None:
                ammo[str(weapon_id)] = int(loaded)
        state[pid] = {"hp": int(p["hp_current"]), "mp": int(p.get("magic_points") or 0), "armor": int(p.get("armor") or 0),
                      "conditions": list(p.get("conditions") or []), "ammo": ammo}
    return state


def _emit_state_deltas(ctx: Any, session: CombatSession, before: dict[str, dict[str, Any]],
                       damage_receipts: dict[str, str]) -> None:
    after = _hp_state(session)
    for pid, prior in before.items():
        now = after.get(pid)
        if now is None:
            continue
        if now["hp"] != prior["hp"]:
            source = damage_receipts.get(pid)
            ctx.add_delta("hp", pid, prior["hp"], now["hp"], source_receipt=source)
        if now["mp"] != prior["mp"]:
            ctx.add_delta("mp", pid, prior["mp"], now["mp"])
        if now["conditions"] != prior["conditions"]:
            ctx.add_effect("condition", pid, prior["conditions"], now["conditions"])
        for weapon_id, loaded in now["ammo"].items():
            was = prior["ammo"].get(weapon_id)
            if was is not None and was != loaded:
                ctx.add_delta("ammo", pid, was, loaded, weapon=weapon_id)
        if now["armor"] != prior["armor"]:
            # A ward soaking a hit is the only thing that explains "3 damage, no wound" to the player.
            ctx.add_delta("armor", pid, prior["armor"], now["armor"])
    ctx.sync_combatants(session, concluded=session.status != "active")


def _damage_receipts_by_target(session: CombatSession, turn_ids: set[str], receipt_ids: dict[str, str]) -> dict[str, str]:
    """target actor -> the dice receipt of the last damage record this call produced."""
    out: dict[str, str] = {}
    for damage in session.damage_chain:
        if damage.get("source_turn_id") in turn_ids and isinstance(damage.get("damage_roll_id"), str):
            receipt = receipt_ids.get(damage["damage_roll_id"])
            if receipt:
                out[str(damage.get("target_actor_id"))] = receipt
    return out


def _intent_text(args: Mapping[str, Any], default: str) -> str:
    goal = str(args.get("goal_text") or "").strip()
    return goal or default


def _start_combat(ctx: Any, args: Mapping[str, Any], sessions: SessionView) -> tuple[CombatSession, dict[str, Any]]:
    """Open a CombatSession between the investigator and the targeted NPC, honouring the
    scene affordance's authored `rules_operation` (preparations such as Flesh Ward, the
    opponent's weapon, the own-dagger exception and the authored outcomes)."""
    target = str(args["target_npc_id"])
    present = {handle: (node, profile) for handle, node, profile in sessions.present_opponents()}
    if target not in present:
        raise RpcError("unknown_entity", f"{target} is not in the current scene",
                       details={"query": target, "candidates": sorted(present)})
    node, profile = present[target]
    if profile is None:
        raise RpcError("needs", f"{ctx.graph.display_name(node)} has no stat block in the module",
                       fix="use lookup catalog for a creature stat block, or narrate the exchange without dice",
                       details={"needs": {"field": "target", "options": sorted(h for h, (_, p) in present.items() if p)}})
    sheet = ctx.actor
    weapon_id = args.get("weapon_id")
    weapon = resolve_investigator_weapon(ctx.tables, sheet, str(weapon_id)) if weapon_id else None
    if weapon_id and weapon is None:
        raise RpcError("needs", f"{weapon_id!r} is not a weapon the investigator carries",
                       details={"needs": {"field": "weapon", "options": weapon_options(sheet)}})
    scene = ctx.graph.scene(ctx.active_scene)
    affordance_id, operation = combat_operation_for(ctx.graph, scene, target, weapon["weapon_id"] if weapon else None)
    opponent_spec = operation.get("opponent") if isinstance(operation.get("opponent"), dict) else {}
    # Profile / operation rows define a weapon only when they extend a catalog row or
    # carry skill and damage; a bare `{"weapon_id": ...}` is a reference to one.
    extra_weapons = [w for w in list(profile.get("weapons") or []) + list(opponent_spec.get("weapons") or [])
                     if isinstance(w, dict) and (w.get("extends") or (w.get("skill") and (w.get("damage") or w.get("damage_die"))))]
    catalog_rows = module_weapons(ctx.tables, ctx.graph, extra_weapons)
    combat_id = f"{operation.get('combat_id') or 'combat-' + ctx.active_scene}-t{ctx.turn_number}"
    session = CombatSession(combat_id, f"scene/{ctx.active_scene}", ctx.turn_number, ctx.rng, tables=ctx.tables,
                            module_weapons=catalog_rows)
    investigator = investigator_combat_participant(ctx.tables, sheet, weapon)
    npc = npc_combat_participant(ctx.tables, target, profile)
    preferred = str(operation.get("opponent_weapon_id") or "")
    if preferred and preferred in session._weapon_catalog:
        npc["weapons"] = [{"weapon_id": preferred}] + [w for w in npc["weapons"] if w.get("weapon_id") != preferred]
    for spec in (investigator, npc):
        session.add_participant(spec["actor_id"], spec["side"], spec["dex"], spec["combat_skill"], spec["build"], spec["hp_max"],
                                weapons=list(spec["weapons"]), conditions=list(spec["conditions"]), dodge_skill=spec["dodge_skill"],
                                con=spec["con"], firearms_skill=spec["firearms_skill"], has_ready_firearm=spec["has_ready_firearm"],
                                damage_bonus=spec["damage_bonus"], magic_points=spec["magic_points"], armor=spec["armor"],
                                armor_rule=spec["armor_rule"])
        session.participants[spec["actor_id"]]["hp_current"] = spec["hp_current"]
    preparations: list[dict[str, Any]] = []
    for preparation in operation.get("preparations") or []:
        if not isinstance(preparation, dict) or preparation.get("actor_id") not in session.participants:
            continue
        participant = session.participants[str(preparation["actor_id"])]
        before = int(participant["magic_points"])
        cost = int(preparation.get("cost") or 0)
        if before < cost:
            continue
        participant["magic_points"] = before - cost
        if cost:
            ctx.add_delta("mp", str(preparation["actor_id"]), before, participant["magic_points"])
        row: dict[str, Any] = {"effect": preparation.get("effect_kind"), "actor": preparation["actor_id"], "mp_cost": cost,
                               "rule_ref": preparation.get("rule_ref")}
        armor_dice = preparation.get("armor_dice")
        if isinstance(armor_dice, str):
            rolled = roll_expression(armor_dice, ctx.rng)
            participant["armor"] = int(rolled["total"])
            participant["armor_rule"] = preparation.get("armor_rule")
            row["armor"] = int(rolled["total"])
            roll_id = ctx.add_dice_roll(actor=str(preparation["actor_id"]), label=str(preparation.get("effect_kind") or "armor"),
                                        expression=rolled["expression"],
                                        faces=rolled["rolls"], total=rolled["total"])
            ctx.add_delta("armor", str(preparation["actor_id"]), 0, int(rolled["total"]), source_receipt=roll_id)
        session.apply_effect(str(preparation["actor_id"]), str(preparation.get("effect_kind") or "preparation"),
                             str(preparation["actor_id"]), int(preparation.get("duration_rounds") or 1),
                             metadata={"rule_ref": preparation.get("rule_ref")})
        preparations.append(row)
    session.begin_round()
    session.revision = 1
    ctx.add_session_receipt("combat", "start", summary=f"{ctx.graph.display_name(node)}")
    info = {"combat_id": combat_id, "affordance_id": affordance_id, "operation": operation, "preparations": preparations,
            "initiative": [dict(row) for row in session._current_initiative]}
    return session, info


def _pending_attack(session: CombatSession, ctx: Any, actor_id: str, target_id: str, weapon_id: str | None,
                    operation: Mapping[str, Any], intent: str) -> dict[str, Any]:
    try:
        weapon = session._weapon(actor_id, weapon_id)
    except UnknownWeaponError as exc:
        raise RpcError("needs", str(exc), details={"needs": {"field": "weapon", "options": []}}) from exc
    firearm = str(weapon.get("skill") or "").startswith("Firearms")
    hint = "firearm_attack" if firearm else "opposed_melee"
    pending: dict[str, Any] = {
        "attack_command_id": ctx.call_id, "actor_id": actor_id, "target_actor_id": target_id,
        "declared_intent": intent, "resolution_hint": hint, "weapon_id": str(weapon.get("weapon_id") or weapon_id or "unarmed"),
        "rulebook_exception": None, "on_success": None, "victory_outcome": None, "defeat_outcome": None,
        "allowed_defenses": ["dive_for_cover", "none"] if firearm else ["dodge", "fight_back"],
    }
    if session.participants[actor_id].get("side") == "investigator":
        if isinstance(operation.get("rulebook_exception"), str) and operation.get("investigator_weapon_id") == pending["weapon_id"]:
            pending["rulebook_exception"] = operation["rulebook_exception"]
            if isinstance(operation.get("on_success"), dict):
                pending["on_success"] = dict(operation["on_success"])
        if isinstance(operation.get("victory_outcome"), str):
            pending["victory_outcome"] = operation["victory_outcome"]
    elif isinstance(operation.get("defeat_outcome"), str):
        pending["defeat_outcome"] = operation["defeat_outcome"]
    return pending


@register("combat.resolve")
def execute_combat_resolve(ctx: Any, args: dict[str, Any], plan: Mapping[str, Any]) -> tuple[Any, list[str], list[str]]:
    kind = str(args.get("action_kind") or "attack")
    actor_id = str(args.get("actor_id") or ctx.actor_id)
    sessions = SessionView(ctx.campaign_dir, ctx.graph, ctx.party(), ctx.world)
    hints: list[str] = []
    warnings: list[str] = []
    started = None
    operation: dict[str, Any] = {}
    if combat_active(sessions.combat):
        session = load_combat(ctx.campaign_dir, ctx.tables, ctx.rng)
        operation = _stored_operation(ctx)
    elif kind in ("attack", "maneuver"):
        if actor_id != ctx.actor_id:
            raise turn_state(f"no combat is underway for {actor_id} to act in",
                             fix="the investigator opens the fight: intent combat with target and weapon")
        session, started = _start_combat(ctx, args, sessions)
        operation = dict(started["operation"] or {})
        ctx.write_save("combat-operation.json", {"combat_id": session.combat_id, "affordance_id": started["affordance_id"],
                                                  "operation": operation})
    else:
        raise turn_state("no combat is underway", fix="start one: intent combat with a present target and a weapon")
    if actor_id not in session.participants:
        raise RpcError("unknown_entity", f"{actor_id} is not in this combat",
                       details={"query": actor_id, "candidates": sorted(session.participants)})
    before = _hp_state(session)
    pending = session.pending_attack
    if isinstance(pending, dict) and kind != "defend":
        defender = str(pending["target_actor_id"])
        raise turn_state(f"an attack on {defender} awaits its defense",
                         fix=f"resolve with actor: {defender} and defense (one of {', '.join(defense_options(pending))})",
                         pending_defense=defender)
    turn: dict[str, Any] | None = None
    rolls: list[dict[str, Any]] = []
    if kind == "defend":
        if not isinstance(pending, dict):
            raise turn_state("no attack awaits a defense", fix="declare an attack first")
        defender = str(pending["target_actor_id"])
        if actor_id != defender:
            raise turn_state(f"the pending defense belongs to {defender}", fix=f"resolve with actor: {defender}")
        choice = str(args.get("defense_kind") or "")
        engine_kind = engine_defense(pending, choice)
        if engine_kind is None or (engine_kind not in pending["allowed_defenses"] and engine_kind != "none"):
            raise invalid_params(f"defense {choice!r} is not legal against this attack",
                                 fix="set action.defense to one of details.options",
                                 details={"options": defense_options(pending)})
        try:
            turn = session.declare_and_resolve_turn(
                str(pending["actor_id"]), str(pending["declared_intent"]), target_actor_id=defender,
                defense_kind=engine_kind, weapon_id=pending.get("weapon_id"),
                rulebook_exception=pending.get("rulebook_exception"), resolution_hint=str(pending["resolution_hint"]),
                resolution_command_id=ctx.call_id)
        except UnknownWeaponError as exc:
            raise RpcError("needs", str(exc), details={"needs": {"field": "weapon", "options": []}}) from exc
        rolls, _ = session.drain_pending()
        session.pending_attack = None
        session.mark_current_initiative_acted()
        session.initiative_cursor += 1
        on_success = pending.get("on_success")
        if isinstance(on_success, dict) and on_success.get("kind") == "destroy_target" and turn.get("outcome") in {"hit", "hit_after_cover"}:
            target = session.participants[defender]
            target["hp_current"] = 0
            if "dead" not in target["conditions"]:
                target["conditions"].append("dead")
            session.conclude(str(on_success["outcome"]))
            session.ended_at_turn = ctx.turn_number
            hints.append(f"{on_success.get('rule_ref')}: the target is destroyed outright")
        if _conclusion(session, ctx, operation) is None:
            _normalize_cursor(session)
    else:
        holder = _cursor_actor(session)
        if holder != actor_id:
            order = ", ".join(f"{row['actor_id']} (DEX {row['dex']})" for row in session._current_initiative)
            raise turn_state(f"it is {holder}'s turn, not {actor_id}'s (DEX order: {order})",
                             fix=f"resolve with actor: {holder}, or combat:end", turn_of=holder)
        if kind == "attack":
            target_id = str(args.get("target_npc_id") or "")
            if target_id not in session.participants:
                raise RpcError("unknown_entity", f"{target_id or 'the target'} is not in this combat",
                               details={"query": target_id, "candidates": [p for p in session.participants if p != actor_id]})
            cost = operation.get("opponent_attack_resource_cost")
            if session.participants[actor_id].get("side") != "investigator" and isinstance(cost, dict):
                mp_before = int(session.participants[actor_id].get("magic_points") or 0)
                if mp_before >= int(cost.get("cost") or 0):
                    session.participants[actor_id]["magic_points"] = mp_before - int(cost.get("cost") or 0)
            weapon_id = args.get("weapon_id")
            if weapon_id is None and session.participants[actor_id].get("weapons"):
                first = session.participants[actor_id]["weapons"][0]
                weapon_id = first.get("weapon_id") if isinstance(first, dict) else str(first)
            session.pending_attack = _pending_attack(session, ctx, actor_id, target_id, weapon_id, operation,
                                                     _intent_text(args, f"{actor_id} attacks {target_id}"))
            hints.append(f"an attack is pending: {target_id} must answer with a defense")
        elif kind in SELF_RESOLVING:
            target_id = str(args.get("target_npc_id") or "") or None
            try:
                turn = session.declare_and_resolve_turn(
                    actor_id, _intent_text(args, f"{actor_id} {kind}"), target_actor_id=target_id,
                    defense_kind="dodge" if kind == "maneuver" else None, weapon_id=args.get("weapon_id"),
                    resolution_hint=kind, goal=args.get("goal") if kind == "maneuver" else None,
                    resolution_command_id=ctx.call_id)
            except (UnknownWeaponError, ValueError) as exc:
                raise invalid_params(f"combat {kind} refused: {exc}") from exc
            rolls, _ = session.drain_pending()
            session.mark_current_initiative_acted()
            session.initiative_cursor += 1
            if _conclusion(session, ctx, operation) is None:
                _normalize_cursor(session)
        else:
            raise unsupported_value("action_kind", kind, sorted({"attack", "defend"} | SELF_RESOLVING),
                                    message=f"unknown combat action {kind!r}")
    session.revision += 1
    session.save(ctx.campaign_dir)
    round_no = turn["turn_id"].split("-")[0][1:] if turn else session._current_round
    receipt_ids = {}
    for record in rolls:
        if isinstance(record, dict) and isinstance(record.get("roll_id"), str):
            rid = record_engine_rolls(ctx, [record], kind="combat_check", round=int(round_no), session_kind="combat")
            if rid:
                receipt_ids[record["roll_id"]] = rid[0]
    damage_receipts = _damage_receipts_by_target(session, {turn["turn_id"]} if turn else set(), receipt_ids)
    _emit_state_deltas(ctx, session, before, damage_receipts)
    if session.status != "active":
        ctx.add_session_receipt("combat", "end", outcome=session.outcome)
        hints.append("combat is mechanically concluded; narrate the aftermath (no combat:end needed)")
    view = SessionView(ctx.campaign_dir, ctx.graph, ctx.party(), ctx.world)
    data: dict[str, Any] = {
        "combat_id": session.combat_id, "revision": session.revision, "round": session._current_round,
        "action": kind, "actor_id": actor_id, "turn": dict(turn) if turn else None,
        "pending_attack": dict(session.pending_attack) if isinstance(session.pending_attack, dict) else None,
        "status": session.status, "outcome": session.outcome, "session": view.combat_view(),
        "pending_choice": view.pending_choice(), "started": started is not None,
    }
    if started:
        data["initiative"] = started["initiative"]
        data["preparations"] = started["preparations"]
    if turn and turn.get("outcome"):
        data["turn_outcome"] = turn["outcome"]
    return data, warnings, hints


def _stored_operation(ctx: Any) -> dict[str, Any]:
    document = ctx.read_save("combat-operation.json")
    operation = document.get("operation") if isinstance(document, dict) else None
    return dict(operation) if isinstance(operation, dict) else {}


@register("combat.end")
def execute_combat_end(ctx: Any, args: dict[str, Any], plan: Mapping[str, Any]) -> tuple[Any, list[str], list[str]]:
    sessions = SessionView(ctx.campaign_dir, ctx.graph, ctx.party(), ctx.world)
    if sessions.combat is None:
        raise turn_state("no combat has been started", fix="there is nothing to end")
    session = load_combat(ctx.campaign_dir, ctx.tables, ctx.rng)
    outcome = str(args.get("outcome") or "").strip()
    if session.status == "concluded":
        if outcome and outcome != session.outcome:
            raise invalid_params(f"the combat already concluded as {session.outcome!r}",
                                 details={"outcome": session.outcome})
        raise turn_state(f"the combat already ended ({session.outcome})", fix="narrate the aftermath")
    if isinstance(session.pending_attack, dict):
        raise turn_state("an attack awaits its defense; resolve it before ending the fight")
    if outcome not in VALID_OUTCOMES - {None}:
        raise invalid_params(f"combat outcome must be one of {sorted(VALID_OUTCOMES - {None})}",
                             fix="set action.outcome", details={"options": sorted(VALID_OUTCOMES - {None})})
    before = _hp_state(session)
    session.conclude(outcome)
    session.ended_at_turn = ctx.turn_number
    session.revision += 1
    session.save(ctx.campaign_dir)
    _emit_state_deltas(ctx, session, before, {})
    ctx.add_session_receipt("combat", "end", outcome=outcome)
    view = SessionView(ctx.campaign_dir, ctx.graph, ctx.party(), ctx.world)
    data = {"combat_id": session.combat_id, "revision": session.revision, "round": session._current_round,
            "status": session.status, "outcome": outcome, "session": view.combat_view(), "pending_choice": None}
    return data, [], ["the fight is closed; conditions from the exchange stay on the sheet"]


@register("combat.context")
def execute_combat_context(ctx: Any, args: dict[str, Any], plan: Mapping[str, Any]) -> tuple[Any, list[str], list[str]]:
    view = SessionView(ctx.campaign_dir, ctx.graph, ctx.party(), ctx.world)
    return {"session": view.combat_view(), "pending_choice": view.pending_choice()}, [], []


# ---- chase ---------------------------------------------------------------------------------

def _chase_rolls(ctx: Any, session: ChaseSession, **extra: Any) -> dict[str, str]:
    rolls = session.drain_pending()
    session.drain_events()
    ids = {}
    for record in rolls:
        if isinstance(record, dict) and isinstance(record.get("roll_id"), str):
            rid = record_engine_rolls(ctx, [record], kind="chase_check", session_kind="chase", **extra)
            if rid:
                ids[record["roll_id"]] = rid[0]
    return ids


def _chase_state(session: ChaseSession) -> dict[str, dict[str, Any]]:
    return {pid: {"hp": int(p.get("hp") or 0), "position": int(p.get("position") or 0)}
            for pid, p in session.participants.items()}


def _chase_deltas(ctx: Any, session: ChaseSession, before: dict[str, dict[str, Any]]) -> None:
    for pid, prior in before.items():
        now = session.participants.get(pid)
        if now is None:
            continue
        if int(now.get("hp") or 0) != prior["hp"]:
            ctx.add_delta("hp", pid, prior["hp"], int(now.get("hp") or 0))
        if int(now.get("position") or 0) != prior["position"]:
            ctx.add_effect("position", pid, prior["position"], int(now.get("position") or 0))
    ctx.sync_chase_participants(session)


def _ensure_chase_round(session: ChaseSession) -> None:
    if session.status != "active":
        return
    order = session.rounds[-1]["dex_order"] if session.rounds else []
    if not session.rounds or session.initiative_cursor >= len(order):
        session.begin_round()


def _chase_finish(ctx: Any, session: ChaseSession, before: dict[str, dict[str, Any]], data: dict[str, Any],
                  hints: list[str]) -> tuple[Any, list[str], list[str]]:
    ids = _chase_rolls(ctx, session)
    _chase_deltas(ctx, session, before)
    if session.status == "active":
        _ensure_chase_round(session)
    session.save(ctx.campaign_dir)
    view = SessionView(ctx.campaign_dir, ctx.graph, ctx.party(), ctx.world)
    data.update({"chase_id": session.chase_id, "revision": session.revision, "round": session._current_round,
                 "status": session.status, "outcome": session.outcome, "session": view.chase_view(),
                 "pending_choice": view.pending_choice(), "roll_receipts": ids})
    reached = session.check_outcome()
    if reached and session.status == "active":
        hints.append(f"the chase has reached its outcome ({reached}); settle chase:end")
    return data, [], hints


@register("chase.execute")
def execute_chase(ctx: Any, args: dict[str, Any], plan: Mapping[str, Any]) -> tuple[Any, list[str], list[str]]:
    command = args.get("command") if isinstance(args.get("command"), dict) else {}
    kind = str(command.get("kind") or "")
    payload = command.get("payload") if isinstance(command.get("payload"), dict) else {}
    hints: list[str] = []
    data: dict[str, Any] = {"command": kind}
    if kind == "chase_start":
        sessions = SessionView(ctx.campaign_dir, ctx.graph, ctx.party(), ctx.world)
        if chase_active(sessions.chase):
            raise turn_state("a chase is already underway", fix="continue it with chase decisions")
        session = ChaseSession(str(payload["chase_id"]), ctx.rng, tables=ctx.tables)
        for participant in payload.get("participants") or []:
            session.add_participant(participant["actor_id"], participant["side"], int(participant["mov"]),
                                    int(participant["dex"]), con=participant.get("con"), hp=participant.get("hp"),
                                    fight=participant.get("fight"), dodge=participant.get("dodge"),
                                    build=int(participant.get("build") or 0),
                                    current_position=int(participant.get("current_position") or 0),
                                    conditions=list(participant.get("conditions") or []))
        session.set_location_chain(list(payload.get("locations") or []))
        before = _chase_state(session)
        established = session.establish()
        ctx.add_session_receipt("chase", "start", summary=", ".join(sorted(session.participants)))
        if session.status == "active":
            session.cut_to_the_chase(gap=DEFAULT_GAP)
            session.begin_round()
        else:
            ctx.add_session_receipt("chase", "end", outcome=session.outcome)
            hints.append("the quarry outruns every pursuer at the speed roll: the chase ends before it begins")
        data.update({"established": established, "initiative": list(session.rounds[-1]["dex_order"]) if session.rounds else []})
        return _chase_finish(ctx, session, before, data, hints)
    session = load_chase(ctx.campaign_dir, ctx.tables, ctx.rng)
    if session.status != "active":
        raise turn_state("the chase is already concluded", fix="nothing to do; narrate the outcome")
    if payload.get("revision") is not None and int(payload["revision"]) != session.revision:
        raise turn_state("the chase moved on since this action was planned", fix="look and resolve again")
    before = _chase_state(session)
    if kind == "chase_end":
        outcome = str(payload.get("outcome") or session.check_outcome() or "concluded")
        session.conclude(outcome)
        ctx.add_session_receipt("chase", "end", outcome=outcome)
        return _chase_finish(ctx, session, before, data, hints)
    actor_id = str(payload.get("actor_id") or "")
    if actor_id not in session.participants:
        raise RpcError("unknown_entity", f"{actor_id} is not in the chase",
                       details={"query": actor_id, "candidates": sorted(session.participants)})
    _ensure_chase_round(session)
    order = session.rounds[-1]["dex_order"]
    holder = order[session.initiative_cursor] if session.initiative_cursor < len(order) else None
    if holder != actor_id:
        raise turn_state(f"it is {holder}'s move, not {actor_id}'s", fix=f"resolve with actor: {holder}", turn_of=holder)
    me = session.participants[actor_id]
    try:
        if kind == "chase_move" and int(me.get("movement_actions_remaining") or 0) <= 0:
            # Hazard debt ate this round's movement (p.135): the actor passes. The engine has
            # no zero-cost pass, so the turn is recorded here in its own shape.
            turn = {"turn_id": f"t{session._current_round}-{session._next_turn()}", "actor_id": actor_id, "dex": me["dex"],
                    "movement_actions": me["movement_actions"], "actions_taken": []}
            session.rounds[-1]["turns"].append(turn)
            session.initiative_cursor += 1
            session.revision += 1
            hints.append(f"{actor_id} has no movement actions this round (hazard debt) and passes")
        elif kind == "chase_move":
            # The actor's whole turn: advance over clear ground while actions remain; a
            # pursuer that reaches a live quarry spends its next action on the grab.
            actions = []
            position = int(me["position"])
            quarries = {pid: row for pid, row in session.participants.items()
                        if row.get("side") == "quarry" and not row.get("escaped") and not row.get("captured")}
            for _ in range(max(1, int(me.get("movement_actions_remaining") or 1))):
                caught = [pid for pid, row in quarries.items() if int(row.get("position", -2)) == position]
                if me.get("side") == "pursuer" and caught and actions:
                    actions.append({"type": "conflict", "target_actor_id": caught[0]})
                    break
                nxt = session._next_location(position)
                if nxt is not None and (nxt.get("hazard") or (nxt.get("barrier") and int(nxt["barrier"].get("hp") or 0) > 0)):
                    break
                actions.append({"type": "advance"})
                position += 1
                if nxt is None:
                    break
            turn = session.move_participant(actor_id, actions or [{"type": "advance"}])
            grabbed = [a for a in turn.get("actions_taken") or [] if a.get("type") == "conflict" and a.get("result") == "grabbed"]
            if grabbed:
                hints.append(f"{grabbed[0].get('target')} is caught; settle chase:end (captured), then fight it out with intent combat")
        elif kind == "chase_hazard":
            turn = session.move_participant(actor_id, [{"type": "advance", "skill": payload.get("skill"),
                                                        "target": payload.get("target"),
                                                        "difficulty": payload.get("difficulty", "regular")}])
        elif kind == "chase_barrier":
            method = str(payload.get("method") or "negotiate")
            action = ({"type": "break_barrier"} if method == "break" else
                      {"type": "barrier", "skill": payload.get("skill"), "target": payload.get("target"),
                       "difficulty": payload.get("difficulty", "regular")})
            turn = session.move_participant(actor_id, [action])
        elif kind == "chase_conflict":
            # The engine's grab: one Fighting roll by the pursuer; success captures the
            # quarry, which is what lets `chase:end` follow. Blows are combat's business
            # (intent combat once the chase has ended).
            target_id = str(payload.get("target_actor_id") or "")
            target = session.participants.get(target_id)
            if target is None:
                raise RpcError("unknown_entity", f"{target_id} is not in the chase",
                               details={"query": target_id, "candidates": sorted(session.participants)})
            if int(target.get("position", -2)) != int(me.get("position", -1)):
                raise turn_state(f"{target_id} is not within reach of {actor_id}", fix="resolve chase:move to close the gap")
            turn = session.move_participant(actor_id, [{"type": "conflict", "target_actor_id": target_id}])
            grab = (turn.get("actions_taken") or [{}])[0]
            data["grab"] = grab.get("result")
            if grab.get("result") == "grabbed":
                hints.append(f"{target_id} is caught; settle chase:end (captured), then fight it out with intent combat")
        else:
            raise unsupported_value("command.kind", kind, CHASE_COMMAND_KINDS,
                                    message=f"unknown chase command {kind!r}")
    except ValueError as exc:
        raise turn_state(f"chase action refused by the engine: {exc}") from exc
    data["turn"] = turn
    if me.get("escaped"):
        hints.append(f"{actor_id} has escaped; settle chase:end")
    return _chase_finish(ctx, session, before, data, hints)


# ---- sanity ------------------------------------------------------------------------------------

def _sanity_session(ctx: Any):
    return load_sanity(ctx.campaign_dir, ctx.tables, ctx.rng, ctx.actor, ctx.clock_minutes)


def _sanity_rolls(ctx: Any, session, **extra: Any) -> list[str]:
    rolls = session.drain_pending()
    ids: list[str] = []
    for record in rolls:
        if not isinstance(record, dict):
            continue
        skill = str(record.get("skill") or "")
        if skill == "SAN":
            ids.append(record_percentile(ctx, record, kind="sanity_check", **extra))
            faces = record.get("san_loss_rolls")
            if isinstance(faces, list) and faces:
                ids.append(ctx.add_dice_roll(actor=str(record["actor_id"]), label="SAN Loss",
                                             expression=record.get("san_loss_expression"), faces=[int(f) for f in faces],
                                             total=record.get("san_loss")))
        elif skill == "INT":
            ids.append(record_percentile(ctx, record, kind="sanity_int_check", **extra))
        elif "die_expression" in record or record.get("die") is not None:
            ids.append(record_dice(ctx, record))
    return ids


def _sanity_finish(ctx: Any, session, before_san: int, data: dict[str, Any], hints: list[str],
                   was_bout: bool) -> tuple[Any, list[str], list[str]]:
    session.save(ctx.campaign_dir)
    after = int(session.san_current)
    if after != before_san:
        ctx.add_delta("san", ctx.actor_id, before_san, after)
    ctx.sync_sanity(session)
    if session.bout_active and not was_bout:
        bout = session.bouts_of_madness[-1] if session.bouts_of_madness else {}
        result = str(bout.get("bout_result") or bout.get("bout_kind") or "")
        rounds = bout.get("duration_rounds")
        summary = f"{result} ({rounds} rounds)" if result and rounds is not None else (result or None)
        ctx.add_session_receipt("sanity_bout", "start", outcome=result or None, summary=summary,
                                rounds=rounds if isinstance(rounds, int) and not isinstance(rounds, bool) else None)
    elif was_bout and not session.bout_active:
        ctx.add_session_receipt("sanity_bout", "end")
    view = SessionView(ctx.campaign_dir, ctx.graph, ctx.party(), ctx.world)
    data.update({"investigator_id": ctx.actor_id, "san_before": before_san, "san_after": after,
                 "temporary_insane": bool(session.temporary_insane), "indefinite_insane": bool(session.indefinite_insane),
                 "permanently_insane": bool(session.permanently_insane), "bout_active": bool(session.bout_active),
                 "bout_rounds_remaining": int(session.bout_rounds_remaining),
                 "session": view.bout_view(ctx.actor_id) if (session.bout_active or was_bout) else None,
                 "pending_choice": view.pending_choice()})
    if session.bout_active:
        hints.append("a bout of madness is running: the Keeper controls the investigator; advance it with "
                     "sanity:bout-tick or end it with sanity:bout-end; no SAN can be lost meanwhile (p.157)")
    elif session.temporary_insane or session.indefinite_insane:
        hints.append("underlying insanity: any further SAN loss of 1+ triggers another bout (p.158)")
    if session.permanently_insane:
        hints.append("SAN reached 0: permanent insanity — this investigator is lost to the Mythos")
    return data, [], hints


@register("sanity.execute")
def execute_sanity(ctx: Any, args: dict[str, Any], plan: Mapping[str, Any]) -> tuple[Any, list[str], list[str]]:
    command = args.get("command") if isinstance(args.get("command"), dict) else {}
    kind = str(command.get("kind") or "")
    payload = command.get("payload") if isinstance(command.get("payload"), dict) else {}
    session = _sanity_session(ctx)
    before = int(session.san_current)
    was_bout = bool(session.bout_active)
    hints: list[str] = []
    data: dict[str, Any] = {"command": kind}
    if kind == "sanity_check":
        if session.bout_active:
            raise turn_state("no SAN is lost during a bout of madness (p.157)",
                             fix="advance or end the bout first: sanity:bout-tick / sanity:bout-end")
        if session.permanently_insane:
            raise turn_state("the investigator is permanently insane; no further SAN checks",
                             fix="narrate the loss; the character is retired")
        involuntary_kind = str(payload.get("involuntary_kind") or "")
        if involuntary_kind not in INVOLUNTARY_KINDS:
            raise RpcError("needs", "a failed SAN roll needs the involuntary action the Keeper decided on (p.166)",
                           fix="set action.involuntary to one of details.needs.options (optionally {kind, summary})",
                           details={"needs": {"field": "involuntary", "options": sorted(INVOLUNTARY_KINDS)}})
        event = session.sanity_check(
            source=str(payload.get("source") or "the unnatural"), san_loss_success=payload.get("san_loss_success", "0"),
            san_loss_fail_expr=str(payload.get("san_loss_fail_expr") or "1"), involuntary_kind=involuntary_kind,
            involuntary_summary=str(payload.get("involuntary_summary") or ""), alone=bool(payload.get("alone", False)),
            creature_type=payload.get("creature_type") if isinstance(payload.get("creature_type"), str) else None)
        if event.get("type") == "sanity_check_skipped":
            raise turn_state(str((event.get("payload") or {}).get("summary") or "SAN check skipped"))
        ids = _sanity_rolls(ctx, session, source=str(payload.get("source") or ""))
        result = event.get("payload") or {}
        san_roll = next((r for r in ctx.receipts if r.get("id") == ids[0]), {}) if ids else {}
        data["check"] = {"skill": "SAN", "target": before, "roll": san_roll.get("roll"), "level": result.get("roll_outcome"),
                         "passed": result.get("roll_outcome") in SUCCESS_OUTCOMES, "san_loss": result.get("san_loss"),
                         "source": result.get("source")}
        data["involuntary_action"] = result.get("involuntary_action")
        data["mythos_hardened"] = result.get("mythos_hardened")
    elif kind in ("bout_tick", "bout_end"):
        if not session.bout_active:
            raise turn_state("no bout of madness is running", fix="nothing to advance")
        if kind == "bout_tick":
            data["bout"] = session.tick_bout_round()
        else:
            session.end_bout()
            data["bout"] = {"bout_active": False, "bout_rounds_remaining": 0}
        _sanity_rolls(ctx, session)
    else:
        raise unsupported_value("command.kind", kind, SANITY_EXECUTE_KINDS,
                                message=f"unknown sanity command {kind!r}")
    return _sanity_finish(ctx, session, before, data, hints, was_bout)


@register("sanity.session.reality_check")
def execute_reality_check(ctx: Any, args: dict[str, Any], plan: Mapping[str, Any]) -> tuple[Any, list[str], list[str]]:
    command = args.get("command") if isinstance(args.get("command"), dict) else {}
    payload = command.get("payload") if isinstance(command.get("payload"), dict) else {}
    session = _sanity_session(ctx)
    if not isinstance(session.active_delusion, dict):
        raise turn_state("the investigator has no active delusion to test")
    if payload.get("request_reality_check") is not True:
        raise RpcError("needs", "a reality check is the player's call", fix="set action.goal to the player's suspicion",
                       details={"needs": {"field": "goal", "options": []}})
    before = int(session.san_current)
    was_bout = bool(session.bout_active)
    outcome = session.reality_check()
    roll_id = ctx.add_roll(actor=ctx.actor_id, skill="SAN", target=before, difficulty="regular", threshold=before,
                           roll=int(outcome["roll"]), level="regular" if outcome["success"] else "failure",
                           passed=bool(outcome["success"]), kind="sanity_reality_check", visibility="public")
    _sanity_rolls(ctx, session)
    data = {"command": "reality_check", "check": {"skill": "SAN", "target": before, "roll": outcome["roll"],
                                                  "passed": bool(outcome["success"]), "roll_id": roll_id},
            "delusion_cleared": bool(outcome["success"]), "rule_ref": outcome.get("rule_ref")}
    return _sanity_finish(ctx, session, before, data, [], was_bout)


@register("sanity.session.gain_san")
def execute_gain_san(ctx: Any, args: dict[str, Any], plan: Mapping[str, Any]) -> tuple[Any, list[str], list[str]]:
    command = args.get("command") if isinstance(args.get("command"), dict) else {}
    payload = command.get("payload") if isinstance(command.get("payload"), dict) else {}
    amount = payload.get("san_gain")
    if isinstance(amount, bool) or not isinstance(amount, int) or amount <= 0:
        raise turn_state("no host SAN-gain receipt is pending for this investigator")
    source = str(payload.get("gain_source") or "").strip()
    if not source:
        raise RpcError("needs", "the SAN gain needs its source", fix="put it in action.goal",
                       details={"needs": {"field": "goal", "options": []}})
    session = _sanity_session(ctx)
    before = int(session.san_current)
    session.gain_san(int(amount), source=source)
    session.drain_pending()
    consume_sanity_gain_pending(ctx.campaign_dir, ctx.actor_id)
    data = {"command": "gain_current_san", "requested": int(amount), "source": source, "san_gain": int(session.san_current) - before}
    return _sanity_finish(ctx, session, before, data, [], bool(session.bout_active))


@register("sanity.context")
def execute_sanity_context(ctx: Any, args: dict[str, Any], plan: Mapping[str, Any]) -> tuple[Any, list[str], list[str]]:
    """`sanity:insane-insight` (phase advise): a Keeper-advisory record, no state change."""
    command = args.get("command") if isinstance(args.get("command"), dict) else {}
    payload = command.get("payload") if isinstance(command.get("payload"), dict) else {}
    session = _sanity_session(ctx)
    if not (session.temporary_insane or session.indefinite_insane):
        raise turn_state("insane insight applies only while temporary or indefinite insanity is active")
    insight = str(payload.get("insight") or "").strip()
    if not insight:
        raise RpcError("needs", "the insight needs the Keeper's wording", fix="put it in action.goal",
                       details={"needs": {"field": "goal", "options": []}})
    state = "indefinite" if session.indefinite_insane else "temporary"
    data = {"command": "insane_insight", "insight": insight, "insanity_state": state, "authority": "keeper-advisory",
            "outcome": "advised", "san_before": int(session.san_current), "san_after": int(session.san_current),
            "session": None, "pending_choice": None}
    return data, [], ["advisory only: the Mythos-touched mind glimpses what the sane cannot; no SAN changes"]


@register("time.recover_temporary_insanity")
def execute_recover_temporary(ctx: Any, args: dict[str, Any], plan: Mapping[str, Any]) -> tuple[Any, list[str], list[str]]:
    command = args.get("command") if isinstance(args.get("command"), dict) else {}
    payload = command.get("payload") if isinstance(command.get("payload"), dict) else {}
    session = _sanity_session(ctx)
    trigger = session.recovery_trigger
    if not session.temporary_insane or not isinstance(trigger, dict):
        raise turn_state("no temporary insanity awaits recovery")
    if str(payload.get("recovery_trigger_ref") or trigger.get("trigger_id")) != str(trigger.get("trigger_id")):
        raise turn_state("the recovery trigger is stale", fix="look and resolve again")
    due = int(trigger.get("due_elapsed_minutes") or 0)
    if ctx.clock_minutes < due:
        raise turn_state(f"recovery is due at clock {due}, now {ctx.clock_minutes}",
                         fix=f"advance time by {due - ctx.clock_minutes} minutes of safe rest first")
    before = int(session.san_current)
    was_bout = bool(session.bout_active)
    if session.bout_active:
        session.end_bout()
    session.recover_temporary()
    session.drain_pending()
    data = {"command": "recover_temporary_insanity", "trigger_id": trigger.get("trigger_id"), "recovered": True}
    return _sanity_finish(ctx, session, before, data, ["temporary insanity has passed; underlying phobias or manias remain"], was_bout)


@register("time.apply_psychoanalysis_treatment")
def execute_apply_treatment(ctx: Any, args: dict[str, Any], plan: Mapping[str, Any]) -> tuple[Any, list[str], list[str]]:
    """Indefinite insanity treatment (p.164): a Psychoanalysis roll whose success level
    sets the recovery dice from `treatment.json`; a fumble is the setback; the next
    treatment is scheduled a month on."""
    command = args.get("command") if isinstance(args.get("command"), dict) else {}
    payload = command.get("payload") if isinstance(command.get("payload"), dict) else {}
    session = _sanity_session(ctx)
    trigger = session.treatment_trigger
    if not session.indefinite_insane or not isinstance(trigger, dict):
        raise turn_state("no treatment is due: the investigator is not indefinitely insane")
    due = int(trigger.get("due_elapsed_minutes") or 0)
    if ctx.clock_minutes < due:
        raise turn_state(f"treatment is due at clock {due}, now {ctx.clock_minutes}",
                         fix=f"advance time by {due - ctx.clock_minutes} minutes first")
    rule = ctx.tables.treatment_rule() if hasattr(ctx.tables, "treatment_rule") else {}
    psychoanalysis = (rule or {}).get("psychoanalysis") or {}
    skill_value = int(payload.get("psychoanalysis_skill") or 1)
    check = ctx.resolver.check(skill_value, "regular", 0, 0, rng=ctx.rng)
    roll_id = ctx.add_roll(actor=ctx.actor_id, skill="Psychoanalysis", target=skill_value, difficulty="regular",
                           threshold=check["threshold"], roll=check["roll"], level=check["level"], passed=check["passed"],
                           kind="treatment_check", visibility="public")
    before = int(session.san_current)
    was_bout = bool(session.bout_active)
    recovered = 0
    setback = 0
    level = str(check["outcome"])
    recovery = (psychoanalysis.get("success_recovery") or {})
    if level in SUCCESS_OUTCOMES:
        expression = recovery.get("extreme" if level == "critical" else level) or recovery.get("regular") or "1D3"
        rolled = roll_expression(str(expression), ctx.rng)
        ctx.add_dice_roll(actor=ctx.actor_id, label="SAN Reward",
                          expression=rolled["expression"], faces=rolled["rolls"], total=rolled["total"])
        recovered = int(rolled["total"])
        session.gain_san(recovered, source="psychoanalysis")
        session.drain_pending()
    elif level == "fumble":
        loss = str(((psychoanalysis.get("monthly_roll") or {}).get("setback_loss")) or "1D6")
        session.apply_direct_loss("psychoanalysis setback", loss)
        _sanity_rolls(ctx, session)
        setback = before - int(session.san_current)
    session.treatment_trigger = None
    session._schedule_monthly_treatment_trigger()
    data = {"command": "apply_psychoanalysis_treatment", "trigger_id": trigger.get("trigger_id"), "roll_id": roll_id,
            "check": {"skill": "Psychoanalysis", "target": skill_value, "roll": check["roll"], "level": level,
                      "passed": bool(check["passed"])},
            "san_recovered": recovered, "setback": setback, "next_trigger": session.treatment_trigger}
    return _sanity_finish(ctx, session, before, data, [], was_bout)
