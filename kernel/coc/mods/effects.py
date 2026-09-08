"""Core typed effects for generated content; all arithmetic runs inside resolve."""
from __future__ import annotations

import copy
from typing import Any

from ..errors import RpcError, invalid_params
from ..rules.percentile import roll_expression
from ..sessions import npc_combat_participant
from ..text import normalize


def target(ctx: Any, name: str | None = None) -> dict[str, Any]:
    name = name or str(ctx.action.get("target") or ctx.actor_id)
    for sheet in ctx.party():
        if normalize(name) in {normalize(sheet["id"]), normalize(sheet["name"])}:
            return {"id":sheet["id"], "kind":"investigator", "state":copy.deepcopy(sheet)}
    node = ctx.graph.npc(name)
    handle = ctx.graph.handle(node)
    profile = ctx.npc_profile(handle)
    if profile is None:
        raise RpcError("needs", "This NPC has no numeric profile for a resource effect")
    spec = npc_combat_participant(ctx.tables, handle, profile)
    state = {"id":handle, "name":ctx.graph.display_name(node), "characteristics":profile.get("characteristics", {}),
             "derived":{"HP":spec["hp_max"], "MP":int(profile.get("derived", {}).get("MP", profile.get("characteristics", {}).get("POW", 0) // 5))},
             "current_hp":spec["hp_current"], "current_mp":spec["magic_points"], "current_san":0, "conditions":spec["conditions"]}
    state.update(copy.deepcopy(ctx.world.get("npc_resources", {}).get(handle, {})))
    combat = ctx.read_save("combat.json") or {}
    if combat.get("status") == "active":
        participant = next((p for p in combat.get("participants", []) if p["actor_id"] == handle), None)
        if participant:
            state.update(current_hp=participant["hp_current"], current_mp=participant["magic_points"], conditions=participant["conditions"])
    return {"id":handle, "kind":"npc", "state":state}


def save_target(ctx: Any, selected: dict[str, Any]) -> None:
    state = selected["state"]
    if selected["kind"] == "investigator":
        ctx.write_sheet(state)
        ctx.mirror_investigator(selected["id"], current_hp=state.get("current_hp"),
                                current_mp=state.get("current_mp"), current_san=state.get("current_san"),
                                conditions=state.get("conditions"))
    else:
        ctx.world.setdefault("npc_resources", {})[selected["id"]] = {
            k:copy.deepcopy(state[k]) for k in ("current_hp", "current_mp", "current_san", "conditions", "characteristics")}
        ctx.campaign.write_world(ctx.world)
    combat = ctx.read_save("combat.json") or {}
    if combat.get("status") == "active":
        for participant in combat.get("participants", []):
            if participant["actor_id"] == selected["id"]:
                participant.update(hp_current=state["current_hp"], magic_points=state["current_mp"], conditions=state.get("conditions", []))
        ctx.write_save("combat.json", combat)


def apply_effects(ctx: Any, effects: list[dict[str, Any]], selected: dict[str, Any]) -> None:
    state = selected["state"]
    for effect in effects:
        kind = effect["kind"]
        if kind == "condition":
            before = list(state.get("conditions", []))
            after = list(dict.fromkeys(before + [effect["value"]]))
            state["conditions"] = after
            ctx.add_effect("condition", selected["id"], before, after)
            ctx.add_delta("condition", selected["id"], before, after)
            continue
        expr = str(effect["amount"])
        rolled = {"total":int(expr), "expression":expr, "rolls":[]} if expr.isdigit() else roll_expression(expr, ctx.rng)
        amount = max(0, int(rolled["total"]))
        source = ctx.add_dice_roll(actor=ctx.actor_id, label="object-effect", expression=rolled["expression"],
                                  faces=rolled["rolls"], total=amount) if rolled["rolls"] else None
        key = "current_" + kind
        before = int(state.get(key) or 0)
        maximum = int(state.get("derived", {}).get(kind.upper(), 99 if kind == "san" else before))
        after = max(0, min(maximum, before + (amount if effect["direction"] == "gain" else -amount)))
        state[key] = after
        ctx.add_delta(kind, selected["id"], before, after, source_receipt=source)
        if kind == "hp" and after < before and selected["kind"] == "investigator":
            state["conditions"] = ctx.damage_conditions(state, after, before - after)
            selected.setdefault("wounds", []).append(source)
    save_target(ctx, selected)
    for source in selected.get("wounds", []):
        ctx.record_wound(selected["id"], source=source)


def use_item(ctx: Any, name: str) -> dict[str, Any]:
    from .objects import instance, registry
    item = instance(ctx.world, name)
    if not item or item["owner"]["id"] != ctx.actor_id:
        raise RpcError("needs", "The acting investigator must own this item instance")
    definition = registry(ctx.world)["definitions"][item["definition"]]
    if definition["category"] != "item":
        raise invalid_params("Use combat for weapons and magic:cast-spell for spells")
    effects = definition["parameters"]["effects"]
    if not effects:
        raise RpcError("needs", "This object supplies physical facts, not an automatic activated effect",
                       fix="read its traits with look focus object; choose the appropriate ordinary check or world action")
    selected = target(ctx)
    charges = item["state"].get("charges")
    if charges is not None and charges < 1:
        raise RpcError("needs", "This item has no remaining charges")
    apply_effects(ctx, effects, selected)
    if charges is not None:
        item["state"]["charges"] = charges - 1
        ctx.add_delta("charges", ctx.actor_id, charges, charges - 1, item=item["name"])
    ctx.campaign.write_world(ctx.world)
    return {"kind":"item", "status":"used", "item":item["name"], "target":selected["state"]["name"],
            "charges":item["state"].get("charges")}


def cast_npc(ctx: Any, caster_name: str, definition: dict[str, Any]) -> dict[str, Any]:
    from ..rules.magic import cast_spell
    caster_target = target(ctx, caster_name)
    if caster_target["kind"] != "npc":
        raise invalid_params("NPC casting needs an NPC caster")
    profile = ctx.npc_profile(caster_target["id"]) or {}
    if definition["name"] not in (profile.get("spells") or []):
        raise RpcError("needs", "The NPC has not acquired this spell")
    selected = target(ctx, str(ctx.action.get("target") or caster_name))
    state = caster_target["state"]
    if int(state["current_hp"]) <= 0:
        raise RpcError("turn_state", "A dead NPC cannot cast")
    if type(state.get("characteristics", {}).get("POW")) is not int:
        raise RpcError("needs", "The NPC caster needs an established POW")
    before = copy.deepcopy(state)
    caster = {"pow":state["characteristics"]["POW"], "current_mp":state["current_mp"],
              "current_hp":state["current_hp"], "current_san":state["current_san"]}
    result = cast_spell(ctx.tables, ctx.catalog, definition["name"], caster, is_first_cast=False,
                        is_npc=True, rng=ctx.rng, module_spells=ctx.module_spells)
    ctx.actor_id = caster_target["id"]
    if caster["pow"] != state["characteristics"]["POW"]:
        ctx.add_delta("pow", caster_target["id"], state["characteristics"]["POW"], caster["pow"])
        state["characteristics"]["POW"] = caster["pow"]
    for resource in ("hp", "mp", "san"):
        key = "current_" + resource
        state[key] = caster[key]
        if state[key] != before[key]:
            ctx.add_delta(resource, caster_target["id"], before[key], state[key])
    save_target(ctx, caster_target)
    if result.get("success"):
        selected = target(ctx, selected["id"])
        apply_effects(ctx, definition["parameters"]["effects"], selected)
    return {"kind":"magic", "status":"cast" if result.get("success") else "failed",
            "spell":definition["name"], "caster":state["name"], "mp_spent":result["mp_spent"],
            "san_lost":result["san_lost"], "target":selected["state"]["name"]}


def repair_item(ctx: Any, name: str) -> dict[str, Any]:
    from .objects import instance
    from ..rules.percentile import percentile_check
    item = instance(ctx.world, name)
    if not item or item["owner"]["id"] != ctx.actor_id:
        raise RpcError("needs", "The repairer must hold this instance")
    if item["state"]["condition"] == "intact":
        return {"kind":"none", "item":name, "note":"The object is already intact"}
    skill = ctx.action.get("skill")
    if not isinstance(skill, str) or not skill.strip():
        raise RpcError("needs", "Name the appropriate repair skill")
    value = ctx.actor_of_id_skill_value(ctx.actor_id, skill)
    if value is None:
        raise RpcError("needs", "The repairer has no established value for that skill")
    check = percentile_check(ctx.tables, value, rng=ctx.rng)
    ctx.add_roll(actor=ctx.actor_id, skill=skill, target=value, difficulty="regular", threshold=check["threshold"],
                 roll=check["roll"], level=check["level"], passed=check["passed"], bonus=0, penalty=0,
                 visibility="public", kind="object_repair", check=check)
    before = item["state"]["condition"]
    if check["passed"]:
        item["state"]["condition"] = "intact"
        snapshot = ctx.read_save("combat.json")
        if snapshot:
            snapshot["jammed_weapons"] = [key for key in snapshot.get("jammed_weapons", []) if not key.endswith(":" + item["id"])]
            ctx.write_save("combat.json", snapshot)
        ctx.add_delta("condition", ctx.actor_id, before, "intact", item=name)
        ctx.campaign.write_world(ctx.world)
    return {"kind":"check", **check, "item":name, "condition":item["state"]["condition"]}
