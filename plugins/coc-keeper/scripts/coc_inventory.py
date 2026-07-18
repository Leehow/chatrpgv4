#!/usr/bin/env python3
"""Campaign-local runtime inventory for investigators and NPCs.

Authority split (per the project constitution):

- During play, item truth is campaign-local:
  investigators live under ``save/investigator-state/<id>.json["inventory"]``;
  NPCs live under ``save/npc-state.json["items"][npc_id]``.
- The reusable investigator library (``character.json``) is written only by
  development/settlement workflows (see ``coc_development``).

Everything here is structured data with stable ids. No free-text inference:
``kind`` is an enum, weapons carry a structured spec keyed by ``weapon_id``,
and mutations are pure functions the toolbox/executor wrap with idempotent,
transactional state writes.

Inventory shape (investigator-state)::

    {"entries": [{"item_id": str, "kind": "gear"|"weapon",
                  "label": str, "weapon": {"weapon_id": str, ...}?,
                  "note": str?, "acquired": {...}?}],
     "lost_weapon_ids": [weapon_id, ...]}

Effective investigator weapons = (character-sheet weapons minus
``lost_weapon_ids``) merged with ``kind == "weapon"`` entries; entries win on
``weapon_id`` collision, sheet order is preserved, new weapons append.

NPC items shape (npc-state)::

    {"items": {npc_id: {"current_weapons": [{"weapon_id": str, ...}] | None,
                        "gear": [str, ...]}}}

``current_weapons`` present (even an empty list) overrides authored module
weapons; ``None``/absent means "no runtime override recorded yet".
"""
from __future__ import annotations

from copy import deepcopy
from typing import Any

ENTRY_KINDS = ("gear", "weapon")
ENTRY_KEYS = {"item_id", "kind", "label", "weapon", "note", "acquired"}

# Module rules_operation opponent lookup walks this exact path in story-graph.
_SCENE_LIST_KEYS = ("scenes",)
_AFFORDANCE_LIST_KEYS = ("affordances",)


def empty_inventory() -> dict[str, Any]:
    return {"entries": [], "lost_weapon_ids": []}


def weapon_ref_id(row: Any) -> str | None:
    """Stable weapon id from a weapon entry (dict or bare string)."""
    if isinstance(row, dict):
        value = row.get("weapon_id")
    else:
        value = row
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def validate_entry(entry: Any) -> list[str]:
    """Structural validation only. Returns a list of problems ([] = ok)."""
    problems: list[str] = []
    if not isinstance(entry, dict):
        return ["entry must be an object"]
    unknown = set(entry) - ENTRY_KEYS
    if unknown:
        problems.append(f"entry has unknown fields: {sorted(unknown)}")
    item_id = entry.get("item_id")
    if not isinstance(item_id, str) or not item_id.strip():
        problems.append("entry.item_id must be a non-empty string")
    kind = entry.get("kind")
    if kind not in ENTRY_KINDS:
        problems.append(f"entry.kind must be one of {list(ENTRY_KINDS)}")
    label = entry.get("label")
    if not isinstance(label, str) or not label.strip():
        problems.append("entry.label must be a non-empty string")
    weapon = entry.get("weapon")
    if kind == "weapon":
        if not isinstance(weapon, dict) or weapon_ref_id(weapon) is None:
            problems.append("weapon entry requires weapon.weapon_id (non-empty string)")
    elif weapon is not None:
        problems.append("gear entries must not carry a weapon spec")
    note = entry.get("note")
    if note is not None and not isinstance(note, str):
        problems.append("entry.note must be a string")
    acquired = entry.get("acquired")
    if acquired is not None and not isinstance(acquired, dict):
        problems.append("entry.acquired must be an object")
    return problems


def normalize_inventory(state: dict[str, Any] | None) -> dict[str, Any]:
    """Tolerant read of investigator-state["inventory"].

    Returns a fresh normalized dict; malformed entries are dropped
    conservatively (Clean-Slate: this is same-version tolerance, not a
    migration).
    """
    raw = (state or {}).get("inventory")
    inventory = empty_inventory()
    if not isinstance(raw, dict):
        return inventory
    entries = raw.get("entries")
    if isinstance(entries, list):
        for row in entries:
            if validate_entry(row):
                continue
            inventory["entries"].append(deepcopy(row))
    lost = raw.get("lost_weapon_ids")
    if isinstance(lost, list):
        for value in lost:
            if isinstance(value, str) and value.strip() and value not in inventory["lost_weapon_ids"]:
                inventory["lost_weapon_ids"].append(value.strip())
    return inventory


def effective_weapons(
    sheet_weapons: list[Any] | None,
    inventory: dict[str, Any],
) -> list[dict[str, Any]]:
    """Merge character-sheet weapons with runtime inventory.

    Sheet weapons whose id is in ``lost_weapon_ids`` drop out; weapon entries
    replace a sheet weapon with the same id, otherwise append. Callers add
    the ``unarmed`` fallback themselves, as before.
    """
    lost = set(inventory.get("lost_weapon_ids") or [])
    merged: list[dict[str, Any]] = []
    positions: dict[str, int] = {}
    for row in sheet_weapons or []:
        wid = weapon_ref_id(row)
        if wid is None or wid in lost:
            continue
        spec = deepcopy(row) if isinstance(row, dict) else {"weapon_id": wid}
        positions[wid] = len(merged)
        merged.append(spec)
    for entry in inventory.get("entries") or []:
        if entry.get("kind") != "weapon":
            continue
        weapon = entry.get("weapon")
        wid = weapon_ref_id(weapon)
        if wid is None:
            continue
        spec = deepcopy(weapon)
        if wid in positions:
            merged[positions[wid]] = spec
        else:
            positions[wid] = len(merged)
            merged.append(spec)
    return merged


def grant_entry(
    inventory: dict[str, Any],
    entry: dict[str, Any],
) -> tuple[dict[str, Any], bool]:
    """Idempotent add/replace by item_id. Returns (inventory, changed)."""
    problems = validate_entry(entry)
    if problems:
        raise ValueError("; ".join(problems))
    entries = inventory["entries"]
    for index, row in enumerate(entries):
        if row["item_id"] == entry["item_id"]:
            if row == entry:
                return inventory, False
            entries[index] = deepcopy(entry)
            return inventory, True
    entries.append(deepcopy(entry))
    # Granting a weapon back undoes a recorded loss of the same sheet weapon.
    wid = weapon_ref_id(entry.get("weapon"))
    if wid and wid in inventory["lost_weapon_ids"]:
        inventory["lost_weapon_ids"] = [
            value for value in inventory["lost_weapon_ids"] if value != wid
        ]
    return inventory, True


def remove_item(
    inventory: dict[str, Any],
    item_id: str,
    sheet_weapon_ids: set[str] | None = None,
) -> tuple[dict[str, Any], str]:
    """Remove an item. Outcome: removed_entry | marked_lost | already_lost | not_found."""
    item_id = str(item_id or "").strip()
    entries = inventory["entries"]
    for index, row in enumerate(entries):
        row_wid = weapon_ref_id(row.get("weapon"))
        if row["item_id"] == item_id or (row_wid is not None and row_wid == item_id):
            del entries[index]
            return inventory, "removed_entry"
    lost = inventory["lost_weapon_ids"]
    if item_id in lost:
        return inventory, "already_lost"
    if sheet_weapon_ids and item_id in sheet_weapon_ids:
        lost.append(item_id)
        return inventory, "marked_lost"
    return inventory, "not_found"


def lose_weapon(inventory: dict[str, Any], weapon_id: str,
                sheet_weapon_ids: set[str] | None = None) -> tuple[dict[str, Any], str]:
    """Combat-loss path: remove a weapon wherever it currently lives."""
    return remove_item(inventory, weapon_id, sheet_weapon_ids)


# --------------------------------------------------------------------------- #
# NPC items (save/npc-state.json["items"])
# --------------------------------------------------------------------------- #

def _npc_items_bucket(npc_state: dict[str, Any]) -> dict[str, Any]:
    items = npc_state.get("items")
    if not isinstance(items, dict):
        items = {}
        npc_state["items"] = items
    return items


def npc_items(npc_state: dict[str, Any], npc_id: str) -> dict[str, Any]:
    """Normalized mutable view of one NPC's runtime items."""
    npc_id = str(npc_id)
    bucket = _npc_items_bucket(npc_state)
    row = bucket.get(npc_id)
    if not isinstance(row, dict):
        row = {}
        bucket[npc_id] = row
    current = row.get("current_weapons")
    if current is not None and not isinstance(current, list):
        current = None
    if current is not None:
        row["current_weapons"] = [
            deepcopy(w) for w in current if weapon_ref_id(w) is not None
        ]
    else:
        row["current_weapons"] = None
    gear = row.get("gear")
    if not isinstance(gear, list):
        gear = []
    row["gear"] = [str(g) for g in gear if isinstance(g, str) and g.strip()]
    return row


def authored_weapons_for_npc(
    story_graph: dict[str, Any] | None,
    npc_id: str,
) -> list[dict[str, Any]]:
    """Collect authored module weapons for an NPC across story-graph
    affordances (``rules_operation.opponent`` with a matching actor_id)."""
    npc_id = str(npc_id)
    found: list[dict[str, Any]] = []
    seen: set[str] = set()
    scenes = (story_graph or {}).get("scenes")
    if not isinstance(scenes, list):
        return found
    for scene in scenes:
        if not isinstance(scene, dict):
            continue
        affordances = scene.get("affordances")
        if not isinstance(affordances, list):
            continue
        for affordance in affordances:
            if not isinstance(affordance, dict):
                continue
            operation = affordance.get("rules_operation")
            if not isinstance(operation, dict):
                continue
            opponent = operation.get("opponent")
            if not isinstance(opponent, dict):
                continue
            if str(opponent.get("actor_id") or "") != npc_id:
                continue
            weapons = opponent.get("weapons")
            if not isinstance(weapons, list):
                continue
            for row in weapons:
                wid = weapon_ref_id(row)
                if wid is None or wid in seen:
                    continue
                seen.add(wid)
                found.append(deepcopy(row) if isinstance(row, dict) else {"weapon_id": wid})
    return found


def effective_npc_weapons(
    npc_state: dict[str, Any],
    npc_id: str,
    authored: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]] | None:
    """Runtime override when recorded, else the authored baseline (or None)."""
    row = npc_items(npc_state, npc_id)
    current = row.get("current_weapons")
    if current is not None:
        return deepcopy(current)
    if authored:
        return deepcopy(authored)
    return None


def npc_set_current_weapons(
    npc_state: dict[str, Any],
    npc_id: str,
    weapons: list[Any],
) -> None:
    row = npc_items(npc_state, npc_id)
    cleaned: list[dict[str, Any]] = []
    seen: set[str] = set()
    for weapon in weapons or []:
        wid = weapon_ref_id(weapon)
        if wid is None or wid in seen:
            continue
        seen.add(wid)
        cleaned.append(deepcopy(weapon) if isinstance(weapon, dict) else {"weapon_id": wid})
    row["current_weapons"] = cleaned


def npc_add_weapon(
    npc_state: dict[str, Any],
    npc_id: str,
    weapon: dict[str, Any],
    authored: list[dict[str, Any]] | None = None,
) -> bool:
    """Add (or replace) a weapon in the NPC runtime override. Returns changed."""
    wid = weapon_ref_id(weapon)
    if wid is None:
        raise ValueError("npc weapon requires weapon_id")
    row = npc_items(npc_state, npc_id)
    current = row.get("current_weapons")
    if current is None:
        current = [deepcopy(w) for w in (authored or [])]
        row["current_weapons"] = current
    for index, existing in enumerate(current):
        if weapon_ref_id(existing) == wid:
            if existing == weapon:
                return False
            current[index] = deepcopy(weapon)
            return True
    current.append(deepcopy(weapon))
    return True


def npc_remove_weapon(
    npc_state: dict[str, Any],
    npc_id: str,
    weapon_id: str,
    authored: list[dict[str, Any]] | None = None,
) -> str:
    """Remove a weapon from the NPC runtime override. removed | not_found.

    Without a recorded override and no authored baseline supplied, this is a
    plain miss: it must not fabricate an empty override (which would later
    read as "the NPC owns nothing").
    """
    weapon_id = str(weapon_id or "").strip()
    row = npc_items(npc_state, npc_id)
    current = row.get("current_weapons")
    if current is None:
        if authored is None:
            return "not_found"
        current = [deepcopy(w) for w in authored]
        row["current_weapons"] = current
    for index, existing in enumerate(current):
        if weapon_ref_id(existing) == weapon_id:
            del current[index]
            return "removed"
    return "not_found"


def npc_add_gear(npc_state: dict[str, Any], npc_id: str, label: str) -> bool:
    row = npc_items(npc_state, npc_id)
    label = str(label or "").strip()
    if not label:
        raise ValueError("gear label must be a non-empty string")
    if label in row["gear"]:
        return False
    row["gear"].append(label)
    return True


def npc_remove_gear(npc_state: dict[str, Any], npc_id: str, label: str) -> str:
    row = npc_items(npc_state, npc_id)
    label = str(label or "").strip()
    if label in row["gear"]:
        row["gear"] = [g for g in row["gear"] if g != label]
        return "removed"
    return "not_found"
