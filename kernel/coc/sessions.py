"""The session layer (contract §11.5, §11.9): the three engine snapshots under `save/`,
the `session` / `pending_choice` shapes every resolve echoes, the family facts the
RuleGraph conditions read, and the participant specs built from sheets and NPC profiles.

The old subsystem executor is not ported. This is a thin state view: it reads the
snapshots the engines write (`combat.json`, `chase.json`, `sanity-state/<inv>.json`),
never mutates them; the executors in `rules/executors.py` drive the engines."""

from __future__ import annotations

import random
import re
from pathlib import Path
from typing import Any

from .fileio import read_json
from .module_graph import NPC_KIND, ModuleGraph, record_of
from .rules.chase import DEFAULT_GAP, DEFAULT_LOCATION_COUNT, ChaseSession, chase_outlook, generate_location_chain
from .rules.combat import CombatSession
from .rules.sanity import SanitySession, sanity_gain_pending_path, sanity_snapshot_path
from .rules.tables import RuleTables
from .errors import invalid_params
from .text import normalize

COMBAT_FILE = "combat.json"
CHASE_FILE = "chase.json"
CHASE_END_WORDS = ("escaped", "captured", "concluded")
# The tool schema speaks combat's end vocabulary; a chase reads it from the quarry's side.
COMBAT_END_WORDS = ("investigators_win", "monsters_win", "fled", "stalemate")


def chase_end_word(word: Any, reached: str | None, *, quarry_is_investigator: bool) -> str:
    if reached:
        return reached
    if word is None:
        return "concluded"
    word = str(word)
    if word in CHASE_END_WORDS:
        return word
    mapped = {"fled": "escaped", "stalemate": "concluded",
              "investigators_win": "escaped" if quarry_is_investigator else "captured",
              "monsters_win": "captured" if quarry_is_investigator else "escaped"}.get(word)
    if mapped is None:
        raise invalid_params(f"unknown chase outcome {word!r}",
                             fix="omit outcome to let the chase state decide, or give one of details.options",
                             details={"options": list(COMBAT_END_WORDS) + list(CHASE_END_WORDS)})
    return mapped

#: Contract vocabulary for a defense (§11.9) against the engine's own; a firearm attack
#: can only be dived away from, which the keeper still calls `dodge`.
CONTRACT_DEFENSES = ("dodge", "fight_back", "none")
ENGINE_DEFENSE = {"firearm_attack": {"dodge": "dive_for_cover", "none": "none"},
                  "opposed_melee": {"dodge": "dodge", "fight_back": "fight_back", "none": "none"}}

#: Where the module states an NPC's SAN cost to behold it: a printed `X/YDZ` expression
#: somewhere in the profile's `san_loss` / `san_loss_to_see` field (Corbitt: "1/1D8 …").
SAN_LOSS_IN_TEXT = re.compile(r"(\d+(?:D\d+(?:\+\d+)?)?)\s*/\s*(\d+D\d+(?:\+\d+)?|\d+)", re.IGNORECASE)


def parse_san_loss(text: Any) -> tuple[str, str] | None:
    """`"1/1D8"` (or prose containing it) -> `("1", "1D8")`; None when no expression is there."""
    if not isinstance(text, str):
        return None
    match = SAN_LOSS_IN_TEXT.search(text)
    if match is None:
        return None
    return match.group(1).upper(), match.group(2).upper()


# ---- snapshots ---------------------------------------------------------------------------

def read_snapshot(campaign_dir: Path, name: str) -> dict[str, Any] | None:
    path = Path(campaign_dir) / "save" / name
    if not path.exists():
        return None
    data = read_json(path)
    return data if isinstance(data, dict) else None


def combat_snapshot(campaign_dir: Path) -> dict[str, Any] | None:
    return read_snapshot(campaign_dir, COMBAT_FILE)


def chase_snapshot(campaign_dir: Path) -> dict[str, Any] | None:
    return read_snapshot(campaign_dir, CHASE_FILE)


def sanity_snapshot(campaign_dir: Path, investigator_id: str) -> dict[str, Any] | None:
    try:
        path = sanity_snapshot_path(campaign_dir, investigator_id)
    except ValueError:
        return None
    if not path.exists():
        return None
    data = read_json(path)
    return data if isinstance(data, dict) else None


def sanity_gain_pending(campaign_dir: Path, investigator_id: str) -> dict[str, Any] | None:
    try:
        path = sanity_gain_pending_path(campaign_dir, investigator_id)
    except ValueError:
        return None
    if not path.exists():
        return None
    data = read_json(path)
    gain = data.get("san_gain") if isinstance(data, dict) else None
    if isinstance(gain, bool) or not isinstance(gain, int) or gain <= 0:
        return None
    return data


def combat_active(snapshot: dict[str, Any] | None) -> bool:
    return isinstance(snapshot, dict) and snapshot.get("status") == "active"


def chase_active(snapshot: dict[str, Any] | None) -> bool:
    return isinstance(snapshot, dict) and snapshot.get("status") == "active"


def bout_active(snapshot: dict[str, Any] | None) -> bool:
    return isinstance(snapshot, dict) and bool(snapshot.get("bout_active"))


# ---- engine loaders ---------------------------------------------------------------------

def load_combat(campaign_dir: Path, tables: RuleTables, rng: random.Random) -> CombatSession:
    """The kernel's `save/` under git is the evidence; the old rolls.jsonl cross-check is
    not reproduced, so the snapshot is trusted as it stands."""
    return CombatSession.load(Path(campaign_dir), rng=rng, tables=tables, trusted_in_memory=True)


def load_chase(campaign_dir: Path, tables: RuleTables, rng: random.Random) -> ChaseSession:
    return ChaseSession.load(Path(campaign_dir) / "save" / CHASE_FILE, rng, tables=tables, trusted_standalone=True)


def load_sanity(campaign_dir: Path, tables: RuleTables, rng: random.Random, sheet: dict[str, Any],
                clock_minutes: int) -> SanitySession:
    """The investigator's session; a first load seeds SAN from the sheet (current SAN as
    it stands, maximum per the rules table: 99 minus Cthulhu Mythos)."""
    investigator_id = str(sheet["id"])
    characteristics = sheet.get("characteristics") if isinstance(sheet.get("characteristics"), dict) else {}
    skills = sheet.get("skills") if isinstance(sheet.get("skills"), dict) else {}
    derived = sheet.get("derived") if isinstance(sheet.get("derived"), dict) else {}
    cm_value = int(skills.get("Cthulhu Mythos", 0) or 0)
    existed = sanity_snapshot(campaign_dir, investigator_id) is not None
    session = SanitySession.load(Path(campaign_dir), investigator_id, int_value=int(characteristics.get("INT", 50)),
                                 rng=rng, cm_value=cm_value, tables=tables, clock_minutes=clock_minutes)
    if not existed:
        formula = tables.sanity_max_formula() if hasattr(tables, "sanity_max_formula") else {}
        base_max = int((formula or {}).get("base_max", 99))
        session.san_max = max(0, base_max - cm_value)
        current = sheet.get("current_san")
        if not isinstance(current, int) or isinstance(current, bool):
            current = int(derived.get("SAN", characteristics.get("POW", 50)))
        session.san_current = int(current)
        session.day_start_san = int(current)
    return session


# ---- participants -------------------------------------------------------------------------

class NpcProfileError(ValueError):
    """An NPC has no authored stat block the engines can read."""


def npc_profile(graph: ModuleGraph, node: dict[str, Any]) -> dict[str, Any] | None:
    mechanics = record_of(node).get("mechanics")
    profile = mechanics.get("profile") if isinstance(mechanics, dict) else None
    return profile if isinstance(profile, dict) else None


def npc_san_loss(profile: dict[str, Any] | None) -> tuple[str, str] | None:
    """The module's printed SAN cost of beholding this NPC, when the profile states one."""
    if not isinstance(profile, dict):
        return None
    for key in ("san_loss", "san_loss_to_see", "sanity_loss"):
        parsed = parse_san_loss(profile.get(key))
        if parsed:
            return parsed
    return None


def _int_map(table: Any) -> dict[str, int]:
    return {str(k): int(v) for k, v in (table or {}).items() if isinstance(v, int) and not isinstance(v, bool)}


def npc_combat_participant(tables: RuleTables, handle: str, profile: dict[str, Any], *,
                           side: str = "npc") -> dict[str, Any]:
    """Re-cut of the old `actor_combat_participant`: an authored (nested) profile into the
    engine's participant spec. Nothing is invented: a profile without the characteristics
    the engine needs is refused."""
    characteristics = _int_map(profile.get("characteristics"))
    missing = [key for key in ("STR", "SIZ", "DEX", "CON") if key not in characteristics]
    if missing:
        raise NpcProfileError(f"{handle}: profile lacks characteristics {', '.join(missing)}")
    skills = _int_map(profile.get("skills"))
    derived = profile.get("derived") if isinstance(profile.get("derived"), dict) else {}
    damage = tables.damage_bonus_build(characteristics["STR"], characteristics["SIZ"])
    hp = int(derived.get("HP", (characteristics["CON"] + characteristics["SIZ"]) // 10))
    brawl = int(skills.get("Fighting (Brawl)", skills.get("Brawl", skills.get("Fighting", 25))))
    dodge = int(skills.get("Dodge", max(1, characteristics["DEX"] // 2)))
    firearms = max([value for key, value in skills.items() if key.startswith("Firearms")] or [0])
    weapons = [dict(w) if isinstance(w, dict) else {"weapon_id": str(w)} for w in (profile.get("weapons") or [])]
    if not weapons:
        weapons = [{"weapon_id": "unarmed"}]
    return {
        "actor_id": handle, "side": side, "dex": characteristics["DEX"], "combat_skill": brawl, "dodge_skill": dodge,
        "firearms_skill": firearms, "has_ready_firearm": bool(profile.get("has_ready_firearm", False)),
        "build": int(derived.get("Build", damage["build"])), "damage_bonus": str(derived.get("DB", damage["damage_bonus"])),
        "hp_max": max(1, hp), "hp_current": max(1, int(profile.get("hp_current", hp))), "con": characteristics["CON"],
        "magic_points": int(profile.get("current_mp", derived.get("MP", characteristics.get("POW", 0) // 5))),
        "armor": int(profile.get("armor", 0) or 0), "armor_rule": profile.get("armor_rule"),
        "weapons": weapons, "conditions": [str(c) for c in (profile.get("conditions") or [])],
        "mov": int(derived.get("MOV", 8)),
    }


def investigator_weapons(sheet: dict[str, Any]) -> list[dict[str, Any]]:
    """The sheet's weapon rows plus the ever-present fist."""
    rows = [dict(w) for w in (sheet.get("weapons") or []) if isinstance(w, dict) and w.get("weapon_id")]
    if not any(row.get("weapon_id") == "unarmed" for row in rows):
        rows.append({"weapon_id": "unarmed", "name": "unarmed"})
    return rows


def weapon_options(sheet: dict[str, Any]) -> list[str]:
    return [str(row.get("name") or row["weapon_id"]) for row in investigator_weapons(sheet)]


def resolve_investigator_weapon(tables: RuleTables, sheet: dict[str, Any], query: str) -> dict[str, Any] | None:
    """`action.weapon` against the sheet: weapon_id, the row's name, its player-language
    label (#19 `apply item`), or the catalog's display name; `unarmed` always resolves.
    None when nothing matches."""
    key = normalize(query)
    for prefix in ("weapon:", "item:"):
        if key.startswith(prefix):
            key = key[len(prefix):]
    catalog = tables.weapons_table() if tables.exists("weapons") else {}
    for row in investigator_weapons(sheet):
        weapon_id = str(row["weapon_id"])
        names = {normalize(weapon_id), normalize(str(row.get("name") or "")), normalize(str(row.get("label") or ""))}
        entry = catalog.get(weapon_id) if isinstance(catalog, dict) else None
        if isinstance(entry, dict) and entry.get("display_name"):
            names.add(normalize(str(entry["display_name"])))
        if key in names:
            merged = {**(entry or {}), **row, "weapon_id": weapon_id}
            if "damage" not in merged and merged.get("damage_die"):
                merged["damage"] = merged["damage_die"]
            return merged
    return None


def sheet_skill_value(tables: RuleTables, sheet: dict[str, Any], skill_name: str) -> int | None:
    """A skill's value for the sheet by name, matched under `normalize` (the weapons table
    spells `Firearms (Rifle/shotgun)`, the skill list `Firearms (Rifle/Shotgun)`); a skill
    the sheet does not list falls back to the rulebook's flat base chance, matched the
    same way. None when neither knows the name — nothing is guessed."""
    skills = _int_map(sheet.get("skills"))
    key = normalize(skill_name)
    for name, value in skills.items():
        if normalize(name) == key:
            return int(value)
    table = tables.skills_table() if tables.exists("skills") else {}
    for name, spec in table.items():
        if normalize(name) != key or not isinstance(spec, dict):
            continue
        if spec.get("modern_only") is True and str(sheet.get("era") or "").strip().casefold() != "modern":
            return None
        base = spec.get("base_chance")
        return int(base) if isinstance(base, int) and not isinstance(base, bool) else None
    return None


def investigator_combat_participant(tables: RuleTables, sheet: dict[str, Any],
                                    weapon: dict[str, Any] | None) -> dict[str, Any]:
    characteristics = _int_map(sheet.get("characteristics"))
    skills = _int_map(sheet.get("skills"))
    derived = sheet.get("derived") if isinstance(sheet.get("derived"), dict) else {}
    damage = tables.damage_bonus_build(int(characteristics.get("STR", 50)), int(characteristics.get("SIZ", 50)))
    weapons = [weapon] if weapon else [{"weapon_id": "unarmed"}]
    firearms = max([value for key, value in skills.items() if key.startswith("Firearms")] or [0])
    weapon_skill = str((weapon or {}).get("skill") or "")
    if weapon_skill.startswith("Firearms"):
        # The weapon's own skill (a shotgun fires with Rifle/Shotgun, not with the best
        # Firearms on the sheet): the sheet's value, else the rulebook base for that skill.
        own = sheet_skill_value(tables, sheet, weapon_skill)
        if own is not None:
            firearms = own
    has_firearm = bool(weapon and weapon.get("magazine") is not None)
    hp_max = int(derived.get("HP") or 10)
    current_hp = sheet.get("current_hp")
    return {
        "actor_id": str(sheet["id"]), "side": "investigator", "dex": int(characteristics.get("DEX", 50)),
        "combat_skill": int(skills.get("Fighting (Brawl)", 25)),
        "dodge_skill": int(skills.get("Dodge", max(1, int(characteristics.get("DEX", 50)) // 2))),
        "firearms_skill": int(firearms), "has_ready_firearm": has_firearm,
        "build": int(derived.get("BUILD", damage["build"])), "damage_bonus": str(derived.get("DB", damage["damage_bonus"])),
        "hp_max": hp_max, "hp_current": int(current_hp if isinstance(current_hp, int) else hp_max),
        "con": int(characteristics.get("CON", 50)), "magic_points": int(sheet.get("current_mp") or derived.get("MP") or 0),
        "armor": 0, "armor_rule": None, "weapons": weapons, "conditions": [str(c) for c in (sheet.get("conditions") or [])],
        "mov": int(derived.get("MOV", 8)),
    }


def chase_participant_from_combat_spec(spec: dict[str, Any], side: str, position: int) -> dict[str, Any]:
    return {"actor_id": spec["actor_id"], "side": side, "mov": int(spec.get("mov", 8)), "dex": int(spec["dex"]),
            "con": int(spec["con"]), "hp": int(spec["hp_current"]), "fight": int(spec["combat_skill"]),
            "dodge": int(spec["dodge_skill"]), "build": int(spec["build"]), "current_position": position,
            "conditions": [c for c in spec.get("conditions") or [] if c in _CHASE_CONDITIONS]}


_CHASE_CONDITIONS = frozenset({"major_wound", "dying", "stabilized", "dead", "unconscious", "prone", "grappled",
                               "surprised", "outnumbered", "fled"})


def module_weapons(tables: RuleTables, graph: ModuleGraph, extra: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    """The module's authored weapon rows (`rules-json/<module>.json` weapons) plus the rows
    the caller collected from NPC profiles and scene operations."""
    rows: list[dict[str, Any]] = []
    if tables.exists(graph.module_id):
        module = tables.load(graph.module_id)
        rows.extend(dict(w) for w in (module.get("weapons") or []) if isinstance(w, dict) and w.get("weapon_id"))
    rows.extend(dict(w) for w in (extra or []) if isinstance(w, dict) and w.get("weapon_id"))
    return rows


def combat_operation_for(graph: ModuleGraph, scene: dict[str, Any], npc_handle: str,
                         weapon_id: str | None) -> tuple[str | None, dict[str, Any]]:
    """The scene affordance whose authored `rules_operation` engages this NPC: the one
    naming the chosen weapon wins, then one that leaves the weapon to the player."""
    matched: list[tuple[int, str, dict[str, Any]]] = []
    for aff in record_of(scene).get("affordances") or []:
        operation = aff.get("rules_operation") if isinstance(aff, dict) else None
        if not isinstance(operation, dict) or operation.get("kind") != "combat_engagement":
            continue
        opponent = operation.get("opponent") if isinstance(operation.get("opponent"), dict) else {}
        if str(opponent.get("actor_id") or "") != npc_handle:
            continue
        fixed = operation.get("investigator_weapon_id")
        if fixed and weapon_id and str(fixed) == str(weapon_id):
            rank = 0
        elif fixed:
            continue
        else:
            rank = 1
        matched.append((rank, str(aff.get("id")), operation))
    if not matched:
        return None, {}
    matched.sort(key=lambda row: (row[0], row[1]))
    return matched[0][1], matched[0][2]


# ---- the 11.9 shapes -------------------------------------------------------------------

def defense_options(pending: dict[str, Any]) -> list[str]:
    hint = str(pending.get("resolution_hint") or "opposed_melee")
    mapping = ENGINE_DEFENSE.get(hint) or ENGINE_DEFENSE["opposed_melee"]
    allowed = set(pending.get("allowed_defenses") or [])
    return [choice for choice in CONTRACT_DEFENSES if choice in mapping and (mapping[choice] in allowed or choice == "none")]


def engine_defense(pending: dict[str, Any], choice: str) -> str | None:
    hint = str(pending.get("resolution_hint") or "opposed_melee")
    mapping = ENGINE_DEFENSE.get(hint) or ENGINE_DEFENSE["opposed_melee"]
    return mapping.get(choice)


class SessionView:
    """Read-only projection of the three snapshots for one campaign."""

    def __init__(self, campaign_dir: Path, graph: ModuleGraph, party: list[dict[str, Any]], world: dict[str, Any]) -> None:
        self.campaign_dir = Path(campaign_dir)
        self.graph = graph
        self.party = party
        self.world = world
        self.party_ids = {str(sheet.get("id")) for sheet in party}
        self.combat = combat_snapshot(self.campaign_dir)
        self.chase = chase_snapshot(self.campaign_dir)
        self.sanity = {str(sheet["id"]): sanity_snapshot(self.campaign_dir, str(sheet["id"])) for sheet in party}

    # -- labels -------------------------------------------------------------------------

    def label(self, actor_id: str) -> str:
        for sheet in self.party:
            if str(sheet.get("id")) == actor_id:
                return str(sheet.get("name") or actor_id)
        node = self.graph.find(actor_id, (NPC_KIND,))
        return self.graph.display_name(node) if node else actor_id

    def is_investigator(self, actor_id: str) -> bool:
        return actor_id in self.party_ids

    # -- combat -------------------------------------------------------------------------

    @staticmethod
    def combat_turn_of(snapshot: dict[str, Any]) -> str | None:
        order = snapshot.get("current_initiative") or []
        cursor = int(snapshot.get("initiative_cursor") or 0)
        if 0 <= cursor < len(order) and isinstance(order[cursor], dict):
            return str(order[cursor].get("actor_id"))
        return None

    def combat_actions(self, snapshot: dict[str, Any]) -> list[dict[str, Any]]:
        pending = snapshot.get("pending_attack")
        if isinstance(pending, dict):
            defender = str(pending.get("target_actor_id"))
            return [{"decision": "combat:defend", "actor": defender, "options": defense_options(pending),
                     "for": "player" if self.is_investigator(defender) else "npc"}]
        actor = self.combat_turn_of(snapshot)
        if actor is None or snapshot.get("status") != "active":
            return []
        participants = {str(p.get("actor_id")): p for p in snapshot.get("participants") or [] if isinstance(p, dict)}
        me = participants.get(actor) or {}
        others = [pid for pid, p in participants.items() if pid != actor and p.get("side") != me.get("side")
                  and self._eligible(p)]
        catalog = snapshot.get("weapon_catalog") or {}
        weapons = []
        for row in me.get("weapons") or []:
            weapon_id = row.get("weapon_id") if isinstance(row, dict) else str(row)
            weapons.append(str(weapon_id))
        has_firearm = any(isinstance(catalog.get(w), dict) and catalog[w].get("magazine") is not None for w in weapons)
        actions = [{"decision": "combat:attack", "actor": actor, "targets": others, "weapons": weapons}]
        if has_firearm:
            actions.append({"decision": "combat:aim", "actor": actor})
            actions.append({"decision": "combat:reload", "actor": actor})
        actions.append({"decision": "combat:maneuver", "actor": actor, "targets": others})
        if self.is_investigator(actor):
            actions.append({"decision": "combat:flee", "actor": actor})
        actions.append({"decision": "combat:end", "actor": actor})
        return actions

    @staticmethod
    def _eligible(participant: dict[str, Any]) -> bool:
        conditions = participant.get("conditions") or []
        return int(participant.get("hp_current") or 0) > 0 and not any(
            value in conditions for value in ("dead", "dying", "unconscious", "fled"))

    def combat_view(self, snapshot: dict[str, Any] | None = None) -> dict[str, Any] | None:
        snapshot = snapshot if snapshot is not None else self.combat
        if not isinstance(snapshot, dict):
            return None
        pending = snapshot.get("pending_attack")
        pending_defense = None
        if isinstance(pending, dict):
            defender = str(pending.get("target_actor_id"))
            pending_defense = {"for": "player" if self.is_investigator(defender) else "npc", "actor": defender,
                               "attacker": str(pending.get("actor_id")), "options": defense_options(pending)}
        active = snapshot.get("status") == "active"
        view: dict[str, Any] = {
            "kind": "combat", "status": "active" if active else "ended",
            "round": int(snapshot.get("current_round") or 0),
            "turn_of": self.combat_turn_of(snapshot) if active else None,
            "actions": self.combat_actions(snapshot) if active else [],
            "pending_defense": pending_defense,
            "participants": [
                {"name": str(p.get("actor_id")), "label": self.label(str(p.get("actor_id"))), "side": p.get("side"),
                 "hp": p.get("hp_current"), "hp_max": p.get("hp_max"), "conditions": list(p.get("conditions") or []),
                 **({"armor": p.get("armor")} if p.get("armor") else {})}
                for p in snapshot.get("participants") or [] if isinstance(p, dict)],
        }
        if not active:
            view["outcome"] = snapshot.get("outcome")
        return view

    # -- chase --------------------------------------------------------------------------

    @staticmethod
    def chase_turn_of(snapshot: dict[str, Any]) -> str | None:
        rounds = snapshot.get("rounds") if isinstance(snapshot.get("rounds"), list) else []
        order = rounds[-1].get("dex_order") if rounds and isinstance(rounds[-1], dict) else []
        cursor = int(snapshot.get("initiative_cursor") or 0)
        if isinstance(order, list) and 0 <= cursor < len(order):
            return str(order[cursor])
        return None

    @staticmethod
    def chase_pending_kind(snapshot: dict[str, Any]) -> str | None:
        """Ported from the old facts provider: what the actor on turn faces next, or `end`
        once every quarry is escaped or caught, or `conflict` when a pursuer stands on a
        live quarry's location."""
        if not chase_active(snapshot):
            return None
        participants = {str(row.get("actor_id")): row for row in snapshot.get("participants") or [] if isinstance(row, dict)}
        quarries = [row for row in participants.values() if row.get("side") == "quarry"]
        if quarries and all(row.get("escaped") or row.get("captured") for row in quarries):
            return "end"
        live_quarries = [row for row in quarries if not row.get("escaped") and not row.get("captured")]
        actor = participants.get(SessionView.chase_turn_of(snapshot) or "")
        chain = snapshot.get("location_chain") if isinstance(snapshot.get("location_chain"), list) else []
        if actor is None:
            return "move"
        position = int(actor.get("position", 0))
        # A pursuer standing on a live quarry's location has caught up: its act is the
        # conflict (the grab). The quarry on its own turn keeps running.
        if actor.get("side") == "pursuer" and any(int(q.get("position", -2)) == position for q in live_quarries):
            return "conflict"
        nxt = chain[position + 1] if 0 <= position + 1 < len(chain) else None
        if isinstance(nxt, dict) and isinstance(nxt.get("barrier"), dict) and int(nxt["barrier"].get("hp") or 0) > 0:
            return "barrier"
        if isinstance(nxt, dict) and isinstance(nxt.get("hazard"), dict):
            return "hazard"
        return "move"

    def chase_actions(self, snapshot: dict[str, Any]) -> list[dict[str, Any]]:
        kind = self.chase_pending_kind(snapshot)
        actor = self.chase_turn_of(snapshot)
        participants = {str(row.get("actor_id")): row for row in snapshot.get("participants") or [] if isinstance(row, dict)}
        me = participants.get(actor or "") or {}
        remaining = int(me.get("movement_actions_remaining") or 0)
        chain = snapshot.get("location_chain") or []
        position = int(me.get("position", 0))
        nxt = chain[position + 1] if 0 <= position + 1 < len(chain) else None
        actions: list[dict[str, Any]] = []
        if kind == "end":
            return [{"decision": "chase:end", "outcome": self._chase_outcome(snapshot)}]
        if kind == "conflict":
            targets = [pid for pid, row in participants.items() if pid != actor and row.get("side") == "quarry"
                       and int(row.get("position", -2)) == position and not row.get("escaped") and not row.get("captured")]
            actions.append({"decision": "chase:conflict", "actor": actor, "action": f"conflict:{targets[0]}" if targets else None,
                            "targets": targets, "cost": 1, "resolves": "a Fighting roll: success grabs the quarry (captured)"})
        elif kind == "barrier" and isinstance(nxt, dict):
            barrier = nxt["barrier"]
            for method in ("negotiate", "break"):
                actions.append({"decision": "chase:barrier", "actor": actor, "method": method,
                                "action": f"barrier:{barrier.get('barrier_id')}:{method}", "cost": 1,
                                "skill": barrier.get("skill"), "target": barrier.get("target")})
        elif kind == "hazard" and isinstance(nxt, dict):
            hazard = nxt["hazard"]
            actions.append({"decision": "chase:hazard", "actor": actor, "action": f"hazard:{hazard.get('hazard_id')}",
                            "cost": 1, "skill": hazard.get("skill"), "target": hazard.get("target"),
                            "difficulty": hazard.get("difficulty", "regular")})
        else:
            actions.append({"decision": "chase:move", "actor": actor, "action": "move:advance", "cost": 1})
        for action in actions:
            action["movement_actions_remaining"] = remaining
            if remaining <= 0 and action["decision"] == "chase:move":
                action.update({"cost": 0, "note": "no movement actions this round (hazard debt): the actor passes"})
        return actions

    def chase_end_outcome(self, word: Any) -> str:
        """What `chase:end` records: the engine's verdict once it has one, else the keeper's word."""
        snapshot = self.chase if isinstance(self.chase, dict) else {}
        quarry_is_investigator = any(isinstance(row, dict) and row.get("side") == "quarry"
                                     and self.is_investigator(str(row.get("actor_id")))
                                     for row in snapshot.get("participants") or [])
        return chase_end_word(word, self._chase_outcome(snapshot), quarry_is_investigator=quarry_is_investigator)

    @staticmethod
    def _chase_outcome(snapshot: dict[str, Any]) -> str | None:
        quarries = [row for row in snapshot.get("participants") or [] if isinstance(row, dict) and row.get("side") == "quarry"]
        if not quarries:
            return None
        if all(q.get("escaped") for q in quarries):
            return "escaped"
        if all(q.get("captured") or q.get("wrecked") for q in quarries):
            return "captured"
        return None

    def chase_view(self, snapshot: dict[str, Any] | None = None) -> dict[str, Any] | None:
        snapshot = snapshot if snapshot is not None else self.chase
        if not isinstance(snapshot, dict):
            return None
        active = chase_active(snapshot)
        view: dict[str, Any] = {
            "kind": "chase", "status": "active" if active else "ended",
            "round": int(snapshot.get("current_round") or 0),
            "turn_of": self.chase_turn_of(snapshot) if active else None,
            "actions": self.chase_actions(snapshot) if active else [],
            "pending_defense": None,
            "pending_kind": self.chase_pending_kind(snapshot),
            "participants": [
                {"name": str(p.get("actor_id")), "label": self.label(str(p.get("actor_id"))), "side": p.get("side"),
                 "hp": p.get("hp"), "position": p.get("position"), "mov": p.get("mov_adjusted"),
                 "movement_actions": p.get("movement_actions"), "escaped": bool(p.get("escaped")),
                 "captured": bool(p.get("captured"))}
                for p in snapshot.get("participants") or [] if isinstance(p, dict)],
            "locations": [{"index": loc.get("index"), "label": loc.get("label"),
                           **({"hazard": loc["hazard"].get("hazard_id")} if isinstance(loc.get("hazard"), dict) else {}),
                           **({"barrier": loc["barrier"].get("barrier_id")} if isinstance(loc.get("barrier"), dict) else {})}
                          for loc in snapshot.get("location_chain") or [] if isinstance(loc, dict)],
        }
        outlook = chase_outlook(snapshot)
        if outlook:
            view["outlook"] = outlook.get("ends_when")
        if not active:
            view["outcome"] = snapshot.get("outcome")
        return view

    # -- sanity bout --------------------------------------------------------------------

    def bout_view(self, investigator_id: str, snapshot: dict[str, Any] | None = None) -> dict[str, Any] | None:
        snapshot = snapshot if snapshot is not None else self.sanity.get(investigator_id)
        if not isinstance(snapshot, dict):
            return None
        active = bout_active(snapshot)
        bout = next((b for b in snapshot.get("bouts_of_madness") or []
                     if isinstance(b, dict) and b.get("bout_id") == snapshot.get("active_bout_id")), None)
        if bout is None and snapshot.get("bouts_of_madness"):
            bout = snapshot["bouts_of_madness"][-1]
        duration = int((bout or {}).get("duration_rounds") or 0)
        remaining = int(snapshot.get("bout_rounds_remaining") or 0)
        view: dict[str, Any] = {
            "kind": "sanity_bout", "status": "active" if active else "ended",
            "round": max(0, duration - remaining) + (1 if active else 0),
            "turn_of": investigator_id if active else None,
            "actions": [{"decision": "sanity:bout-tick", "actor": investigator_id},
                        {"decision": "sanity:bout-end", "actor": investigator_id}] if active else [],
            "pending_defense": None,
            "participants": [{"name": investigator_id, "label": self.label(investigator_id), "side": "investigator",
                              "san": snapshot.get("san_current")}],
            "bout": {"id": (bout or {}).get("bout_id"), "mode": (bout or {}).get("mode"), "result": (bout or {}).get("bout_result"),
                     "kind": (bout or {}).get("bout_kind"), "rounds_remaining": remaining, "duration_rounds": duration,
                     "phobia": (bout or {}).get("phobia"), "mania": (bout or {}).get("mania")},
            "insanity": {"temporary": bool(snapshot.get("temporary_insane")), "indefinite": bool(snapshot.get("indefinite_insane")),
                         "permanent": bool(snapshot.get("permanently_insane"))},
        }
        return view

    # -- precedence -------------------------------------------------------------------

    def active_session(self) -> dict[str, Any] | None:
        """The one live session (11.3.1 precedence: combat, then chase, then a bout)."""
        if combat_active(self.combat):
            return self.combat_view()
        if chase_active(self.chase):
            return self.chase_view()
        for investigator_id, snapshot in self.sanity.items():
            if bout_active(snapshot):
                return self.bout_view(investigator_id, snapshot)
        return None

    def pending_choice(self) -> dict[str, Any] | None:
        """11.9: `{name, for, prompt, options}`. A player-targeted defense the keeper hands
        back through `ask`; an NPC defense or a bout the keeper answers on the next
        `resolve` (`defense` / `decision`)."""
        if combat_active(self.combat) and isinstance(self.combat.get("pending_attack"), dict):
            pending = self.combat["pending_attack"]
            attacker = str(pending.get("actor_id"))
            defender = str(pending.get("target_actor_id"))
            options = defense_options(pending)
            name = f"defense:{attacker}-r{int(self.combat.get('current_round') or 0)}"
            if self.is_investigator(defender):
                prompt = f"{self.label(attacker)} attacks you. How do you respond? ({' / '.join(options)})"
                return {"name": name, "for": "player", "prompt": prompt, "options": options}
            prompt = (f"{self.label(attacker)} attacks {self.label(defender)}: on the next resolve use actor: {defender} "
                      f"and pick a defense ({' / '.join(options)})")
            return {"name": name, "for": "keeper", "prompt": prompt, "options": options}
        for investigator_id, snapshot in self.sanity.items():
            if bout_active(snapshot):
                view = self.bout_view(investigator_id, snapshot) or {}
                bout = view.get("bout") or {}
                remaining = bout.get("rounds_remaining")
                prompt = (f"{self.label(investigator_id)} is in a bout of madness ({bout.get('result')}, {remaining} rounds "
                          "left): advance one round (sanity:bout-tick) or end it now (sanity:bout-end)?")
                return {"name": f"bout:{investigator_id}-r{view.get('round')}", "for": "keeper", "prompt": prompt,
                        "options": ["sanity:bout-tick", "sanity:bout-end"]}
        return None

    # -- facts ------------------------------------------------------------------------

    def present_opponents(self) -> list[tuple[str, dict[str, Any], dict[str, Any] | None]]:
        """Present NPCs as (handle, node, profile); profile None when unauthored."""
        presence = self.world.get("npc_presence") or {}
        scene = self.world.get("active_scene")
        rows = []
        for handle, at in presence.items():
            if at != scene:
                continue
            node = self.graph.find(handle, (NPC_KIND,))
            if node is None:
                continue
            from .mods.objects import with_profile
            rows.append((handle, node, with_profile(self.world, handle, npc_profile(self.graph, node))))
        return rows

    def chase_start_ready(self) -> bool:
        return not chase_active(self.chase) and bool(self.party) and any(p for _, _, p in self.present_opponents())

    def facts(self, investigator_id: str, clock_minutes: int) -> dict[str, Any]:
        snapshot = self.sanity.get(investigator_id) or {}
        recovery = snapshot.get("recovery_trigger") if isinstance(snapshot.get("recovery_trigger"), dict) else None
        treatment = snapshot.get("treatment_trigger") if isinstance(snapshot.get("treatment_trigger"), dict) else None
        active = chase_active(self.chase)
        pending_kind = self.chase_pending_kind(self.chase) if active else None
        return {
            "chase.session.active": active, "chase.session.inactive": not active,
            "chase.start.ready": self.chase_start_ready(), "chase.pending.kind": pending_kind,
            # The kernel's chase conflict runs the melee itself (the engine delegates to a
            # CombatSession inside the action), so the receipt the old executor demanded
            # is produced by the conflict; positional catch is what makes it ready.
            "chase.conflict.receipt-ready": pending_kind == "conflict",
            "sanity.bout.pending": bout_active(snapshot),
            "sanity.delusion.active": isinstance(snapshot.get("active_delusion"), dict),
            "sanity.insane": bool(snapshot.get("temporary_insane") or snapshot.get("indefinite_insane")),
            "sanity.recovery.due": bool(snapshot.get("temporary_insane")) and recovery is not None
            and int(clock_minutes) >= int(recovery.get("due_elapsed_minutes") or 0),
            "sanity.treatment.due": bool(snapshot.get("indefinite_insane")) and treatment is not None
            and int(clock_minutes) >= int(treatment.get("due_elapsed_minutes") or 0),
            "sanity.gain.pending": sanity_gain_pending(self.campaign_dir, investigator_id) is not None,
            "subsystem.snapshot.active": combat_active(self.combat) or active,
        }


# ---- chase genesis -------------------------------------------------------------------------

def chase_location_chain(graph: ModuleGraph, world: dict[str, Any], rng: random.Random) -> list[dict[str, Any]]:
    """The current scene, then its reachable `route-to` neighbours (up to the engine's
    default length), padded with the engine's generated locations when the module gives
    the chase too little road; the last generated location is the escape."""
    scene = graph.scene(str(world.get("active_scene")))
    chain: list[dict[str, Any]] = [{"label": graph.handle(scene), "kind": "scene", "route_id": f"scene:{graph.handle(scene)}",
                                    "hazard": None, "barrier": None}]
    from .capsule import condition_met  # local import: capsule imports sessions for `where.session`
    for exit_ in graph.scene_exits(scene):
        when = exit_.get("when")
        if when and not condition_met(when, world):
            continue
        if len(chain) >= DEFAULT_LOCATION_COUNT:
            break
        chain.append({"label": str(exit_["to"]), "kind": "scene", "route_id": f"scene:{exit_['to']}", "hazard": None, "barrier": None})
    minimum = DEFAULT_GAP + 3
    if len(chain) < minimum:
        generated = generate_location_chain(minimum - len(chain) + 1, escape_at_end=True, rng=rng)
        for loc in generated[1:]:
            chain.append({"label": loc["label"], "kind": "generated", "hazard": None, "barrier": None})
    return chain[:DEFAULT_LOCATION_COUNT]
