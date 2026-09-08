"""Portable definition and instance values. No campaign paths or model calls."""
from __future__ import annotations

import copy
import hashlib
import math
import re
from typing import Any

from ..errors import RpcError, invalid_params
from ..fileio import canonical_json
from ..text import ascii_slug, normalize

EXPRESSION = re.compile(r"^(?:[0-9]+D[0-9]+|[0-9]+)(?:[+-](?:[0-9]+D[0-9]+|[0-9]+))*$", re.I)
WEAPON_FIELDS = {"skill", "damage", "base_range_yards", "uses_per_round", "magazine", "malfunction", "impale", "adds_damage_bonus", "initial_ammo", "reload_rounds"}
SPELL_FIELDS = {"cost_mp", "cost_sanity", "cost_pow", "casting_time", "effects"}
ITEM_FIELDS = {"charges", "effects"}


def expression(value: Any, field: str) -> str:
    if type(value) is int and 0 <= value <= 10000:
        return str(value)
    if not isinstance(value, str) or len(value) > 80 or not EXPRESSION.fullmatch(value):
        raise invalid_params(f"{field} must be a nonnegative number or bounded dice expression")
    for term in re.split(r"[+-]", value.upper()):
        parts = [int(n) for n in term.split("D")]
        if any(n > 10000 for n in parts) or (len(parts) == 2 and (parts[0] > 100 or parts[1] < 1)):
            raise invalid_params(f"{field} exceeds the dice budget")
    if field != "damage":
        minimum = 0
        for sign, term in re.findall(r"([+-]?)([0-9]+D[0-9]+|[0-9]+)", value.upper()):
            parts = [int(n) for n in term.split("D")]
            low = parts[0]
            high = parts[0] * parts[1] if len(parts) == 2 else low
            minimum += -high if sign == "-" else low
        if minimum < 0:
            raise invalid_params(f"{field} can produce a negative cost or effect amount")
    return value.upper()


def validate_definition(raw: Any, *, name: str | None = None, category: str | None = None) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise invalid_params("Definition must be an object")
    if raw.get("error"):
        raise RpcError("needs", str(raw.get("reason") or "Definition requires an unsupported capability"),
                       details={"reason": "unsupported_capability", "required": raw.get("required", [])})
    if set(raw) - {"name", "category", "description", "basis", "parameters", "traits", "player_view"}:
        raise invalid_params("Unknown definition field")
    for key in ("name", "description", "basis"):
        if not isinstance(raw.get(key), str) or not raw[key].strip() or len(raw[key]) > 8000:
            raise invalid_params(f"Definition needs a bounded {key}")
    if len(raw["name"]) > 120:
        raise invalid_params("Definition names are limited to 120 characters")
    if name is not None and raw["name"] != name or category is not None and raw.get("category") != category:
        raise invalid_params("Definition identity differs from its request")
    kind = raw.get("category")
    fields = {"weapon": WEAPON_FIELDS, "spell": SPELL_FIELDS, "item": ITEM_FIELDS}.get(kind)
    params = raw.get("parameters")
    if fields is None or not isinstance(params, dict) or set(params) - fields:
        raise invalid_params("Unsupported definition category or parameter")
    result = copy.deepcopy(raw)
    traits = raw.get("traits", [])
    if not isinstance(traits, list) or len(traits) > 16:
        raise invalid_params("Physical traits must be a list of at most sixteen facts")
    trait_names = set()
    for trait in traits:
        if (not isinstance(trait, dict) or set(trait) - {"name", "value", "unit", "basis"}
                or not isinstance(trait.get("name"), str) or not trait["name"].strip() or len(trait["name"]) > 80
                or type(trait.get("value")) not in (str, int, float, bool)):
            raise invalid_params("Each physical trait needs a name and scalar value")
        if trait["name"] in trait_names:
            raise invalid_params("Physical trait names must be unique")
        if type(trait["value"]) is float and not math.isfinite(trait["value"]):
            raise invalid_params("Physical traits must contain finite JSON numbers")
        if any(k in trait and (not isinstance(trait[k], str) or len(trait[k]) > 1024) for k in ("unit", "basis")):
            raise invalid_params("Trait units and basis must be bounded strings")
        trait_names.add(trait["name"])
    params = result["parameters"]
    if kind == "weapon":
        if not isinstance(params.get("skill"), str) or not params["skill"].strip():
            raise invalid_params("Weapon needs a rulebook skill")
        params["damage"] = expression(params.get("damage"), "damage")
        for key in ("uses_per_round", "malfunction"):
            if type(params.get(key)) is not int or not 1 <= params[key] <= 100:
                raise invalid_params(f"weapon.{key} must be 1..100")
        if type(params.get("base_range_yards")) not in (int, float) or not 0 <= params["base_range_yards"] <= 100000:
            raise invalid_params("Weapon range must be 0..100000 yards")
        magazine = params.get("magazine")
        if magazine is not None and (type(magazine) is not int or not 1 <= magazine <= 1000):
            raise invalid_params("Weapon magazine must be null or 1..1000")
        if "initial_ammo" in params and (type(params["initial_ammo"]) is not int or magazine is None or not 0 <= params["initial_ammo"] <= magazine):
            raise invalid_params("Initial ammunition exceeds magazine capacity")
        if type(params.get("impale")) is not bool:
            raise invalid_params("Weapon impale must be boolean")
        if "adds_damage_bonus" in params and type(params["adds_damage_bonus"]) is not bool:
            raise invalid_params("Weapon adds_damage_bonus must be boolean")
        if "reload_rounds" in params and (type(params["reload_rounds"]) is not int or not 1 <= params["reload_rounds"] <= 100):
            raise invalid_params("Reload rounds must be 1..100")
    else:
        if kind == "spell":
            for key in ("cost_mp", "cost_sanity"):
                params[key] = expression(params.get(key), key)
            if "cost_pow" in params:
                params["cost_pow"] = expression(params["cost_pow"], "cost_pow")
            if not isinstance(params.get("casting_time"), str) or not params["casting_time"].strip():
                raise invalid_params("Spell needs a casting time")
        elif params.get("charges") is not None and (type(params["charges"]) is not int or not 0 <= params["charges"] <= 10000):
            raise invalid_params("Charges must be null or 0..10000")
        effects = params.get("effects")
        if not isinstance(effects, list) or len(effects) > 8:
            raise invalid_params("Definition effects must be a list of at most eight typed effects")
        for effect in effects:
            if not isinstance(effect, dict):
                raise invalid_params("Invalid definition effect")
            if effect.get("kind") in {"hp", "san", "mp"}:
                if set(effect) != {"kind", "amount", "direction"} or effect.get("direction") not in {"gain", "loss"}:
                    raise invalid_params("Resource effect needs kind, amount and direction")
                effect["amount"] = expression(effect["amount"], "effect.amount")
            elif effect.get("kind") == "condition":
                if set(effect) != {"kind", "value"} or not isinstance(effect.get("value"), str) or not effect["value"].strip():
                    raise invalid_params("Condition effect needs a value")
            else:
                raise invalid_params("Definition references an unsupported effect executor")
    public = raw.get("player_view")
    if (not isinstance(public, dict) or set(public) - {"description", "fields", "traits"}
            or not isinstance(public.get("description"), str) or not isinstance(public.get("fields"), list)
            or any(not isinstance(f, str) or f not in params for f in public["fields"])):
        raise invalid_params("player_view must declare a description and known parameter fields")
    if not isinstance(public.get("traits", []), list) or any(not isinstance(name, str) or name not in trait_names for name in public.get("traits", [])):
        raise invalid_params("Public traits must reference accepted physical facts")
    return result


def registry(world: dict[str, Any]) -> dict[str, Any]:
    return world.setdefault("objects", {"definitions": {}, "instances": {}, "abilities": {}})


def named(rows: dict[str, Any], name: str) -> dict[str, Any] | None:
    if isinstance(name, str) and name in rows:
        return rows[name]
    key = normalize(name)
    matches = [row for row in rows.values() if normalize(row["name"]) == key]
    if len(matches) > 1:
        raise RpcError("unknown_entity", "Object name is ambiguous", details={"candidates": [r["name"] for r in matches]})
    return matches[0] if matches else None


def define(world: dict[str, Any], draft: dict[str, Any], provenance: dict[str, Any]) -> dict[str, Any]:
    value = validate_definition(draft)
    rows = registry(world)["definitions"]
    digest = hashlib.sha256(canonical_json(value).encode()).hexdigest()
    prior = named(rows, value["name"])
    if prior:
        if prior["digest"] != digest:
            raise invalid_params("An established definition cannot be regenerated with different parameters")
        return prior
    handle = f"definition-{ascii_slug(value['name']) or 'object'}-{len(rows) + 1}"
    row = {**value, "id": handle, "version": 1, "digest": digest, "provenance": copy.deepcopy(provenance)}
    rows[handle] = row
    return row


def instance(world: dict[str, Any], name: str) -> dict[str, Any] | None:
    return named((world.get("objects") or {}).get("instances", {}), name)


def move(world: dict[str, Any], name: str, definition: str | None, owner: dict[str, str],
         *, source: dict[str, str] | None, turn: int, quantity: int = 1, condition: str | None = None) -> dict[str, Any]:
    if type(quantity) is not int or not 1 <= quantity <= 10000:
        raise invalid_params("Object quantity must be 1..10000")
    data = registry(world)
    prior = instance(world, name)
    if condition is not None and condition not in {"intact", "damaged", "jammed", "broken"}:
        raise invalid_params("Unknown physical object condition")
    parent = owner
    seen = set()
    while parent.get("kind") == "object":
        if parent["id"] in seen or prior and parent["id"] == prior["id"]:
            raise invalid_params("An object cannot contain itself or form an ownership cycle")
        seen.add(parent["id"])
        parent = data["instances"][parent["id"]]["owner"]
    if prior:
        if source is None or prior["owner"] != source:
            raise invalid_params("Transfer must name this instance's current owner in from")
        if definition is not None and data["definitions"][prior["definition"]]["name"] != definition:
            raise invalid_params("Transfer cannot replace the instance definition")
        if quantity != prior["quantity"]:
            raise invalid_params("Transfer preserves the complete instance quantity")
        if condition is not None and condition != prior["state"]["condition"]:
            raise invalid_params("Transfer preserves condition; resolve a repair to fix the object")
        prior["owner"] = copy.deepcopy(owner)
        prior["changed_turn"] = turn
        return prior
    if source is not None:
        raise invalid_params("No existing instance to transfer; define and place it first")
    template = named(data["definitions"], definition or name)
    if not template or template["category"] == "spell":
        raise invalid_params("Place an item/weapon from an accepted definition; spells are knowledge")
    if type(quantity) is not int or quantity < 1 or quantity > 10000:
        raise invalid_params("Object quantity must be 1..10000")
    if template["category"] == "weapon" and quantity != 1:
        raise invalid_params("Each weapon has one instance and its own ammunition")
    handle = f"object-{ascii_slug(name) or 'item'}-{len(data['instances']) + 1}"
    params = template["parameters"]
    row = {"id": handle, "name": name, "definition": template["id"], "owner": copy.deepcopy(owner),
           "quantity": quantity, "state": {"ammo": params.get("initial_ammo", params.get("magazine")),
                                            "charges": params.get("charges"), "condition": condition or "intact"},
           "created_turn": turn, "changed_turn": turn}
    data["instances"][handle] = row
    return row


def weapon_rows(world: dict[str, Any], owner_id: str | None = None) -> list[dict[str, Any]]:
    data = world.get("objects") or {}
    out = []
    for item in data.get("instances", {}).values():
        definition = data["definitions"][item["definition"]]
        if definition["category"] != "weapon" or owner_id is not None and item["owner"]["id"] != owner_id:
            continue
        out.append({**definition["parameters"], "weapon_id": item["id"], "name": item["name"],
                    "display_name": item["name"], "ammo": item["state"].get("ammo"), "object_id": item["id"],
                    "uses_per_round": str(definition["parameters"]["uses_per_round"]),
                    "impales": definition["parameters"].get("impale", False),
                    "adds_damage_bonus": definition["parameters"].get("adds_damage_bonus", False)})
    return out


def public_items(world: dict[str, Any], owner_id: str) -> list[dict[str, Any]]:
    data = world.get("objects") or {}
    rows = []
    for item in data.get("instances", {}).values():
        if item["owner"]["id"] != owner_id:
            continue
        definition = data["definitions"][item["definition"]]
        public = definition["player_view"]
        rows.append({"name": item["name"], "quantity": item["quantity"], "category": definition["category"],
                     "description": public["description"], "state": copy.deepcopy(item["state"]),
                     "traits": [copy.deepcopy(t) for t in definition.get("traits", []) if t["name"] in public.get("traits", [])],
                     "parameters": {k: definition["parameters"][k] for k in public["fields"]}})
    return rows


def sync_ammo(world: dict[str, Any], participants: list[dict[str, Any]], jammed: set[str] | None = None) -> None:
    instances = (world.get("objects") or {}).get("instances", {})
    for participant in participants:
        for handle, ammo in participant.get("_ammo", {}).items():
            item = instances.get(handle)
            if item and item["owner"]["id"] == participant["actor_id"]:
                item["state"]["ammo"] = ammo
                if f"{participant['actor_id']}:{handle}" in (jammed or set()):
                    item["state"]["condition"] = "jammed"


def usable_weapon(world: dict[str, Any], name: str, owner_id: str) -> dict[str, Any] | None:
    item = instance(world, name)
    if item:
        if item["owner"]["id"] != owner_id:
            raise RpcError("needs", "The acting person does not carry this object; take it from its current owner/container first")
        if item["state"]["condition"] in {"jammed", "broken"}:
            raise RpcError("needs", "This weapon is not usable in its current condition",
                           fix="resolve objects:repair with the instance name in object and the appropriate repair skill")
    return item


def with_profile(world: dict[str, Any], owner_id: str, profile: dict[str, Any] | None) -> dict[str, Any] | None:
    if profile is None:
        return None
    extra = weapon_rows(world, owner_id)
    spells = list((world.get("objects") or {}).get("abilities", {}).get(owner_id, {}))
    resources = world.get("npc_resources", {}).get(owner_id, {})
    result = {**profile, "weapons": list(profile.get("weapons") or []) + extra,
              "spells": list(dict.fromkeys(list(profile.get("spells") or []) + spells))}
    if "current_hp" in resources:
        result["hp_current"] = resources["current_hp"]
    for key in ("current_mp", "conditions", "characteristics"):
        if key in resources:
            result[key] = copy.deepcopy(resources[key])
    return result


def spell_rows(world: dict[str, Any]) -> list[dict[str, Any]]:
    from ..rules.catalog import _record
    return [{**_record(kind="spell", entity_id=d["id"], name=d["name"], table="generated-definitions",
                       summary={"description": d["description"]}, params=d["parameters"]),
             "generated_definition": d}
            for d in (world.get("objects") or {}).get("definitions", {}).values() if d["category"] == "spell"]


def look(world: dict[str, Any], name: str | None = None) -> dict[str, Any]:
    data = world.get("objects") or {}
    if not name:
        return {"objects":[{"name":r["name"], "owner":r["owner"]["name"]} for r in data.get("instances", {}).values()],
                "definitions":[{"name":r["name"],"category":r["category"]} for r in data.get("definitions", {}).values()]}
    item = instance(world, name)
    definition = data.get("definitions", {}).get(item["definition"]) if item else named(data.get("definitions", {}), name)
    if not definition:
        raise RpcError("unknown_entity", "No registered object or definition has that name")
    return {"definition":{k:copy.deepcopy(definition[k]) for k in ("name","category","description","parameters","basis","traits") if k in definition},
            "instance":({"name":item["name"],"owner":item["owner"]["name"],"quantity":item["quantity"],"state":item["state"],
                         "contents":[r["name"] for r in data.get("instances", {}).values() if r["owner"]["id"] == item["id"]]} if item else None)}


def project_sheet(world: dict[str, Any], sheet: dict[str, Any]) -> None:
    sheet["weapons"] = [r for r in sheet.get("weapons", []) if not isinstance(r, dict) or not r.get("object_id")]
    sheet["weapons"].extend(weapon_rows(world, sheet["id"]))
    sheet["equipment"] = [r for r in sheet.get("equipment", []) if not isinstance(r, dict) or not r.get("object_id")]
    for item in public_items(world, sheet["id"]):
        physical = instance(world, item["name"])
        sheet["equipment"].append({"name":item["name"], "quantity":item["quantity"],
                                   "object_id":physical["id"], "description":item["description"]})
