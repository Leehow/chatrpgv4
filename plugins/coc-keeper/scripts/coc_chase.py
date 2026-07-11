#!/usr/bin/env python3
"""Structured Call of Cthulhu 7e Chase engine — Chapter 7 Parts 1-5.

Owns structured chase state (positions, location chain, movement economy).
Same-location melee delegates to CombatSession; vehicle conflict uses
opposed Drive Auto. Persists via coc_fileio.write_json_atomic.

Rulebook basis: Keeper Rulebook Chapter 7 (Chases), 7e 40th Anniversary.
- Part 1 Establishing: CON/Drive roll adjusts MOV; quarry faster → escape (p.132)
- Part 2 Cut to the Chase: default 2-location gap + location chain (p.132-133)
- Part 3 Movement: hazards (cautious bonus / fail→damage+1D3 debt, still advance),
  barriers (HP / Build×1D10 smash / vehicle wreck→hazard) (p.134-137)
- Part 4 Conflict: same-location melee → CombatSession; vehicle Drive Auto opposed;
  Build×1D10 damage; vehicle_collision wired into session (p.137-138)
- Part 5 Optional: Pedal to the Metal, passengers, fire while moving,
  Choosing a Route, Sudden Hazards (p.139-142)
- Table V vehicle MOV (p.145): economy car MOV 13, etc.
"""
from __future__ import annotations

import json
import random
import re
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
RULES_DIR = SCRIPT_DIR.parent / "references" / "rules-json"


def _load_sibling(name: str, filename: str):
    import importlib.util
    spec = importlib.util.spec_from_file_location(name, SCRIPT_DIR / filename)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


coc_roll = _load_sibling("coc_roll", "coc_roll.py")
coc_rules = _load_sibling("coc_rules", "coc_rules.py")
coc_fileio = _load_sibling("coc_fileio", "coc_fileio.py")
coc_combat = _load_sibling("coc_combat", "coc_combat.py")

LVL = {"fumble": 0, "failure": 1, "regular": 2, "hard": 3, "extreme": 4, "critical": 5}
_DICE_RE = re.compile(r"^(\d+)D(\d+)(?:([+-])(\d+))?$", re.IGNORECASE)

DEFAULT_GAP = 2
DEFAULT_LOCATION_COUNT = 8
CHASE_SCHEMA_VERSION = 2
VALID_CHASE_OUTCOMES = {None, "escaped", "captured", "concluded"}


def _roll_dice(expr: str, rng: random.Random) -> int:
    """Roll a dice expression like '1D6', '1D3-1', '2D10', '5D10'."""
    m = _DICE_RE.match(str(expr).strip())
    if not m:
        try:
            return int(expr)
        except (TypeError, ValueError):
            return 0
    n, sides = int(m.group(1)), int(m.group(2))
    total = sum(rng.randint(1, sides) for _ in range(n))
    if m.group(3) == "+":
        total += int(m.group(4))
    elif m.group(3) == "-":
        total -= int(m.group(4))
    return total


def _normalize_location(raw: dict[str, Any] | str, index: int = 0) -> dict[str, Any]:
    if isinstance(raw, str):
        raw = {"label": raw}
    loc = {
        "index": index,
        "label": raw.get("label", f"loc{index}"),
        "hazard": raw.get("hazard"),
        "barrier": raw.get("barrier"),
    }
    for key in ("kind", "route_id", "notes"):
        if key in raw:
            loc[key] = raw[key]
    if loc["barrier"] is not None:
        b = dict(loc["barrier"])
        if "hp_max" not in b and "hp" in b:
            b["hp_max"] = b["hp"]
        loc["barrier"] = b
    return loc


def generate_location_chain(
    count: int = DEFAULT_LOCATION_COUNT,
    *,
    escape_at_end: bool = True,
    rng: random.Random | None = None,
) -> list[dict[str, Any]]:
    """Build a structured location chain with empty hazard/barrier slots.

    Keepers (or callers) fill hazard/barrier slots; the engine only requires
    the structured shape. Optional random clear/hazard seeding is left to
    ``roll_random_hazard`` / Sudden Hazards.
    """
    rng = rng or random.Random()
    chain: list[dict[str, Any]] = []
    for i in range(max(1, count)):
        label = "start" if i == 0 else ("escape" if escape_at_end and i == count - 1 else f"loc{i}")
        chain.append(_normalize_location({"label": label, "hazard": None, "barrier": None}, i))
    return chain


def _load_chase_rules() -> dict[str, Any]:
    path = RULES_DIR / "chase.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def get_vehicle_stats(vehicle_name: str) -> dict[str, Any]:
    """Look up a vehicle's MOV/Build/armor/passengers (Table V, p.145).

    ``vehicle_name`` is matched case-insensitively against keys in
    ``chase.json -> vehicles.entries`` (e.g. ``car_economy``, ``motorcycle``).
    """
    rules = _load_chase_rules()
    entries = (rules.get("vehicles") or {}).get("entries") or {}
    aliases = (rules.get("vehicles") or {}).get("aliases") or {}
    needle = vehicle_name.strip().lower()
    needle = aliases.get(needle, needle)
    for key, entry in entries.items():
        if key.lower() == needle:
            return {"vehicle": key, **entry}
    raise KeyError(f"unknown vehicle: {vehicle_name!r}")


def vehicle_collision(severity: str, rng: random.Random | None = None) -> dict[str, Any]:
    """Resolve a vehicular collision by severity tier (Table VI, p.147).

    Returns ``{severity, build_damage, passenger_damage, description}``.
    """
    rng = rng or random.Random()
    rules = _load_chase_rules()
    tiers = (rules.get("vehicular_collisions") or {}).get("tiers") or {}
    default_sev = (rules.get("vehicular_collisions") or {}).get(
        "default_severity", "moderate"
    )
    resolved = severity if severity in tiers else default_sev
    tier = tiers.get(resolved) or {}
    return {
        "severity": resolved,
        "build_damage": _roll_dice(tier.get("build_damage", "0"), rng),
        "passenger_damage": _roll_dice(tier.get("passenger_damage", "0"), rng),
        "description": tier.get("description", ""),
        "rule_ref": "core.chase.vehicular_collisions",
    }


class ChaseSession:
    """Structured chase state for one pursuit (Chapter 7 Parts 1-5).

    Boundary: chase owns positions / location chain / movement economy;
    CombatSession owns the melee exchange when same-location conflict
    is delegated via ``initiate_melee_conflict``.
    """

    def __init__(
        self,
        chase_id: str,
        rng: random.Random,
        glossary: dict | None = None,
        play_language: str = "zh-Hans",
    ):
        self.chase_id = chase_id
        self.status = "active"
        self.outcome: str | None = None
        self._rng = rng
        self._glossary = glossary or {}
        self._play_language = play_language
        self.participants: dict[str, dict[str, Any]] = {}
        self.location_chain: list[dict[str, Any]] = []
        self.rounds: list[dict[str, Any]] = []
        self.pending_rolls: list[dict[str, Any]] = []
        self.pending_events: list[dict[str, Any]] = []
        self._roll_counter = 0
        self._turn_counter = 0
        self._current_round = 0
        self._sudden_hazard_last_caller: str | None = None
        self._active_combat: Any | None = None
        self.revision = 0
        self.initiative_cursor = 0

    # ------------------------------------------------------------------ #
    # Participants
    # ------------------------------------------------------------------ #
    def add_participant(
        self,
        actor_id: str,
        side: str,
        mov: int,
        dex: int,
        con: int | None = None,
        drive_auto: int | None = None,
        is_vehicle: bool = False,
        current_position: int = 0,
        build: int = 0,
        hp: int | None = None,
        fight: int | None = None,
        dodge: int | None = None,
        firearms: int | None = None,
        luck: int | None = None,
        vehicle_key: str | None = None,
        armor: int = 0,
        role: str = "driver",
        vehicle_actor_id: str | None = None,
        spot_hidden: int | None = None,
        navigate: int | None = None,
    ) -> None:
        if actor_id in self.participants:
            raise ValueError(f"duplicate participant {actor_id}")
        if side not in ("quarry", "pursuer", "passenger", "neutral"):
            raise ValueError(f"invalid side {side!r}")
        if vehicle_key and is_vehicle:
            stats = get_vehicle_stats(vehicle_key)
            mov = int(stats.get("mov", mov))
            build = int(stats.get("build", build))
            armor = int(stats.get("armor", armor))
        self.participants[actor_id] = {
            "actor_id": actor_id,
            "side": side,
            "role": role,
            "mov_base": mov,
            "mov_adjusted": mov,
            "dex": dex,
            "con": con,
            "drive_auto": drive_auto,
            "is_vehicle": is_vehicle,
            "vehicle_key": vehicle_key,
            "vehicle_actor_id": vehicle_actor_id,
            "position": current_position,
            "build": build,
            "build_max": build,
            "armor": armor,
            "hp": hp if hp is not None else 10,
            "hp_max": hp if hp is not None else 10,
            "fight": fight,
            "dodge": dodge,
            "firearms": firearms,
            "luck": luck,
            "spot_hidden": spot_hidden,
            "navigate": navigate,
            "movement_actions": 1,
            "movement_actions_remaining": 1,
            "movement_debt": 0,
            "assist_penalty_reduction": 0,
            "captured": False,
            "escaped": False,
            "wrecked": False,
        }

    def add_passenger(
        self,
        actor_id: str,
        vehicle_id: str,
        dex: int,
        *,
        firearms: int | None = None,
        spot_hidden: int | None = None,
        navigate: int | None = None,
        luck: int | None = None,
        hp: int = 10,
    ) -> None:
        """Passengers have no speed roll / movement actions (p.142)."""
        if vehicle_id not in self.participants:
            raise ValueError(f"unknown vehicle {vehicle_id!r}")
        self.add_participant(
            actor_id,
            side="passenger",
            mov=0,
            dex=dex,
            is_vehicle=False,
            role="passenger",
            vehicle_actor_id=vehicle_id,
            firearms=firearms,
            spot_hidden=spot_hidden,
            navigate=navigate,
            luck=luck,
            hp=hp,
            current_position=self.participants[vehicle_id]["position"],
        )

    def set_location_chain(self, locations: list[dict[str, Any] | str]) -> None:
        self.location_chain = [
            _normalize_location(loc, i) for i, loc in enumerate(locations)
        ]

    # ------------------------------------------------------------------ #
    # Part 1: Establishing the Chase (p.132)
    # ------------------------------------------------------------------ #
    def establish(self) -> dict[str, Any]:
        """Speed roll adjusts MOV. Quarry faster than all pursuers → escape."""
        results: dict[str, Any] = {}
        for aid, p in self.participants.items():
            if p.get("role") == "passenger":
                results[aid] = {"mov_delta": 0, "mov_adjusted": p["mov_base"], "skipped": "passenger"}
                continue
            if p["is_vehicle"] and p.get("drive_auto") is not None:
                target, skill = p["drive_auto"], "Drive Auto"
            elif p.get("con") is not None:
                target, skill = p["con"], "CON"
            else:
                results[aid] = {"mov_delta": 0, "mov_adjusted": p["mov_base"]}
                continue
            res = coc_roll.percentile_check(int(target), rng=self._rng)
            delta = 0
            if LVL[res["outcome"]] >= LVL["extreme"]:
                delta = 1
            elif res["outcome"] in ("failure", "fumble"):
                delta = -1
            p["mov_adjusted"] = max(1, p["mov_base"] + delta)
            rid = self._roll_id()
            self.pending_rolls.append({
                "roll_id": rid, "actor_id": aid, "skill": skill,
                "target": target, "roll": res["roll"], "outcome": res["outcome"],
                "mov_delta": delta, "kind": "speed_roll",
            })
            results[aid] = {
                "skill": skill, "outcome": res["outcome"],
                "mov_delta": delta, "mov_adjusted": p["mov_adjusted"],
                "roll_id": rid,
            }
        quarries = [p for p in self.participants.values() if p["side"] == "quarry"]
        pursuers = [p for p in self.participants.values() if p["side"] == "pursuer"]
        if quarries and pursuers:
            if min(q["mov_adjusted"] for q in quarries) > max(
                pu["mov_adjusted"] for pu in pursuers
            ):
                self.conclude("escaped")
                for q in quarries:
                    q["escaped"] = True
        return {"speed_rolls": results, "chase_proceeds": self.status == "active"}

    # ------------------------------------------------------------------ #
    # Part 2: Cut to the Chase (p.132-133)
    # ------------------------------------------------------------------ #
    def cut_to_the_chase(
        self,
        gap: int = DEFAULT_GAP,
        locations: list[dict[str, Any] | str] | None = None,
        location_count: int | None = None,
    ) -> dict[str, Any]:
        """Place pursuers ``gap`` locations behind quarry and lay out the chain.

        Default gap is 2 (p.133). Advised not to exceed 2.
        """
        if gap < 1:
            raise ValueError("gap must be >= 1")
        if locations is not None:
            self.set_location_chain(locations)
        elif not self.location_chain:
            count = location_count or max(DEFAULT_LOCATION_COUNT, gap + 4)
            self.set_location_chain(generate_location_chain(count, rng=self._rng))
        elif location_count and len(self.location_chain) < location_count:
            extra = generate_location_chain(
                location_count - len(self.location_chain) + 1,
                escape_at_end=True,
                rng=self._rng,
            )
            # Drop the extra "start"; append remaining.
            base = self.location_chain
            if base and base[-1]["label"] == "escape":
                base = base[:-1]
            merged = base + [
                _normalize_location(loc, len(base) + i)
                for i, loc in enumerate(extra[1:])
            ]
            self.location_chain = [
                _normalize_location(loc, i) for i, loc in enumerate(merged)
            ]

        for p in self.participants.values():
            if p["side"] == "quarry":
                p["position"] = min(gap, len(self.location_chain) - 1)
            elif p["side"] == "pursuer":
                p["position"] = 0
            elif p["side"] == "passenger":
                vid = p.get("vehicle_actor_id")
                if vid and vid in self.participants:
                    p["position"] = self.participants[vid]["position"]

        self.pending_events.append({
            "kind": "cut_to_the_chase",
            "gap": gap,
            "location_count": len(self.location_chain),
            "rule_ref": "core.chase.cut_to_the_chase",
        })
        return {
            "gap": gap,
            "location_count": len(self.location_chain),
            "quarry_positions": {
                aid: p["position"]
                for aid, p in self.participants.items()
                if p["side"] == "quarry"
            },
            "pursuer_positions": {
                aid: p["position"]
                for aid, p in self.participants.items()
                if p["side"] == "pursuer"
            },
        }

    # ------------------------------------------------------------------ #
    # Movement economy
    # ------------------------------------------------------------------ #
    def compute_movement_actions(self) -> None:
        movers = [
            p for p in self.participants.values()
            if p.get("role") != "passenger"
            and not p["captured"]
            and not p["escaped"]
            and not p.get("wrecked")
        ]
        if not movers:
            return
        slowest = min(p["mov_adjusted"] for p in movers)
        for p in movers:
            base = 1 + max(0, p["mov_adjusted"] - slowest)
            debt = int(p.get("movement_debt") or 0)
            actions = max(0, base - debt)
            p["movement_actions"] = actions
            p["movement_actions_remaining"] = actions
            p["movement_debt"] = 0  # debt applied this round
        for p in self.participants.values():
            if p.get("role") == "passenger":
                p["movement_actions"] = 0
                p["movement_actions_remaining"] = 0

    def begin_round(self) -> int:
        if self.status != "active":
            raise ValueError("cannot begin a round for a concluded chase")
        if self.rounds and self.initiative_cursor < len(self.rounds[-1]["dex_order"]):
            raise ValueError("current chase round still has unresolved initiative actors")
        self._current_round += 1
        self.compute_movement_actions()
        active = [
            p for p in self.participants.values()
            if not p["captured"] and not p["escaped"] and not p.get("wrecked")
        ]
        dex_order = sorted(active, key=lambda p: (-p["dex"], p["actor_id"]))
        self.rounds.append({
            "round": self._current_round,
            "dex_order": [p["actor_id"] for p in dex_order],
            "turns": [],
        })
        self.initiative_cursor = 0
        self.revision += 1
        return self._current_round

    def _spend_actions(self, p: dict[str, Any], n: int) -> None:
        p["movement_actions_remaining"] = max(
            0, int(p.get("movement_actions_remaining", 0)) - n
        )

    def _sync_passengers(self, vehicle_id: str) -> None:
        pos = self.participants[vehicle_id]["position"]
        for p in self.participants.values():
            if p.get("vehicle_actor_id") == vehicle_id:
                p["position"] = pos

    # ------------------------------------------------------------------ #
    # Turn / action dispatch
    # ------------------------------------------------------------------ #
    def move_participant(
        self, actor_id: str, actions: list[dict[str, Any]]
    ) -> dict[str, Any]:
        if self.status != "active" or not self.rounds:
            raise ValueError("active chase round required")
        order = self.rounds[-1]["dex_order"]
        if self.initiative_cursor >= len(order) or order[self.initiative_cursor] != actor_id:
            raise ValueError("actor is out of chase initiative order")
        if not isinstance(actions, list) or not actions:
            raise ValueError("at least one structured chase action is required")
        p = self.participants[actor_id]
        if p.get("role") == "passenger":
            raise ValueError("passengers use passenger_action(), not move_participant()")
        budget = int(p.get("movement_actions_remaining", p.get("movement_actions", 0)))
        turn = {
            "turn_id": f"t{self._current_round}-{self._next_turn()}",
            "actor_id": actor_id,
            "dex": p["dex"],
            "movement_actions": p["movement_actions"],
            "actions_taken": [],
        }
        spent_total = 0
        for action in actions:
            if p["escaped"] or p["captured"] or p.get("wrecked"):
                break
            atype = action.get("type", "advance")
            cost_preview = self._action_cost_preview(atype, action)
            if spent_total + cost_preview > budget:
                raise ValueError("chase action budget exceeded")
            result = self._resolve_movement_action(actor_id, action)
            turn["actions_taken"].append(result)
            spent = int(result.get("actions_spent", cost_preview))
            spent_total += spent
            if p["escaped"] or p["captured"] or p.get("wrecked"):
                break
        if self.rounds:
            self.rounds[-1]["turns"].append(turn)
        self.initiative_cursor += 1
        self.revision += 1
        return turn

    def _action_cost_preview(self, atype: str, action: dict[str, Any]) -> int:
        if atype in ("advance", "barrier", "break_barrier", "conflict",
                     "conflict_melee", "conflict_vehicle", "hide"):
            cautious = int(action.get("cautious_bonus_actions") or 0)
            return 1 + max(0, min(2, cautious))
        if atype == "pedal_to_the_metal":
            return 1
        if atype == "fire_while_moving":
            return 0 if action.get("moving", True) else 1
        return 1

    def _resolve_movement_action(
        self, actor_id: str, action: dict[str, Any]
    ) -> dict[str, Any]:
        atype = action.get("type", "advance")
        if atype == "advance":
            return self._resolve_advance(actor_id, action)
        if atype == "pedal_to_the_metal":
            return self._resolve_pedal(actor_id, action)
        if atype == "barrier":
            return self._resolve_barrier_skill(actor_id, action)
        if atype == "break_barrier":
            return self._resolve_break_barrier(actor_id, action)
        if atype == "hide":
            return self._resolve_hide(actor_id, action)
        if atype == "conflict":
            return self._resolve_legacy_conflict(actor_id, action)
        if atype == "conflict_melee":
            combat = action.get("combat_session") or self._active_combat
            if combat is None:
                raise ValueError("conflict_melee requires combat_session")
            return self.initiate_melee_conflict(
                actor_id,
                action["target_actor_id"],
                combat_session=combat,
                declared_intent=action.get("declared_intent", "attack"),
                defense_kind=action.get("defense_kind", "dodge"),
                weapon_id=action.get("weapon_id"),
            )
        if atype == "conflict_vehicle":
            return self.vehicle_conflict(
                actor_id,
                action["target_actor_id"],
                defense_kind=action.get("defense_kind", "dodge"),
            )
        return {"type": atype, "result": "unknown"}

    # ------------------------------------------------------------------ #
    # Part 3: Advance + Hazards (p.134-135)
    # ------------------------------------------------------------------ #
    def _next_location(self, position: int) -> dict[str, Any] | None:
        nxt = position + 1
        if nxt >= len(self.location_chain):
            return None
        return self.location_chain[nxt]

    def _resolve_advance(
        self, actor_id: str, action: dict[str, Any]
    ) -> dict[str, Any]:
        p = self.participants[actor_id]
        nxt = self._next_location(p["position"])
        if nxt is None:
            return {"type": "advance", "result": "end_of_chain", "actions_spent": 0}

        barrier = nxt.get("barrier")
        if barrier and int(barrier.get("hp") or 0) > 0:
            # Active barrier blocks simple advance — must negotiate or smash.
            return {
                "type": "advance",
                "result": "blocked_by_barrier",
                "barrier_id": barrier.get("barrier_id"),
                "actions_spent": 0,
            }

        hazard = nxt.get("hazard")
        cautious = max(0, min(2, int(action.get("cautious_bonus_actions") or 0)))
        if hazard:
            return self._negotiate_hazard(
                actor_id, nxt, hazard, action, cautious_bonus_actions=cautious
            )

        # Clear ground: 1 movement action.
        self._spend_actions(p, 1)
        p["position"] = nxt["index"] if "index" in nxt else p["position"] + 1
        # Re-index safety
        p["position"] = min(p["position"], len(self.location_chain) - 1)
        if p["is_vehicle"]:
            self._sync_passengers(actor_id)
        result: dict[str, Any] = {
            "type": "advance",
            "new_position": p["position"],
            "location_label": nxt.get("label", "?"),
            "actions_spent": 1,
        }
        if nxt.get("label") == "escape" and p["side"] == "quarry":
            p["escaped"] = True
            result["escaped"] = True
        return result

    def _negotiate_hazard(
        self,
        actor_id: str,
        loc: dict[str, Any],
        hazard: dict[str, Any],
        action: dict[str, Any],
        *,
        cautious_bonus_actions: int = 0,
        extra_penalty: int = 0,
    ) -> dict[str, Any]:
        """Hazard check: success or fail, character still advances (p.135)."""
        p = self.participants[actor_id]
        skill = action.get("skill") or hazard.get("skill") or (
            "Drive Auto" if p["is_vehicle"] else "DEX"
        )
        target = int(action.get("target") or hazard.get("target") or 50)
        difficulty = action.get("difficulty") or hazard.get("difficulty") or "regular"
        bonus = cautious_bonus_actions
        penalty = int(action.get("penalty") or 0) + extra_penalty
        # Impaired vehicle (build ≤ half max) → +1 penalty (Table V key, p.145)
        if p["is_vehicle"] and p.get("build_max", 0) > 0:
            if p["build"] <= p["build_max"] // 2:
                penalty += 1

        actions_spent = 1 + cautious_bonus_actions
        self._spend_actions(p, actions_spent)

        res = coc_roll.percentile_check(
            target, difficulty=difficulty, bonus=bonus, penalty=penalty, rng=self._rng
        )
        rid = self._roll_id()
        self.pending_rolls.append({
            "roll_id": rid, "actor_id": actor_id, "skill": skill,
            "target": target, "roll": res["roll"], "outcome": res["outcome"],
            "bonus": bonus, "penalty": penalty, "kind": "hazard",
        })

        # Always advance after negotiating (p.135).
        p["position"] = loc.get("index", p["position"] + 1)
        if p["is_vehicle"]:
            self._sync_passengers(actor_id)

        passed = res["outcome"] not in ("failure", "fumble")
        out: dict[str, Any] = {
            "type": "hazard",
            "hazard_id": hazard.get("hazard_id"),
            "passed": passed,
            "roll_id": rid,
            "bonus": bonus,
            "penalty": penalty,
            "actions_spent": actions_spent,
            "new_position": p["position"],
            "location_label": loc.get("label", "?"),
        }
        if loc.get("label") == "escape" and p["side"] == "quarry" and passed:
            p["escaped"] = True
            out["escaped"] = True
        # Even on fail at escape label, they reached it — quarry escapes if label is escape.
        if loc.get("label") == "escape" and p["side"] == "quarry":
            p["escaped"] = True
            out["escaped"] = True

        if not passed:
            damage_dice = hazard.get("damage_dice") or ("1D6" if not p["is_vehicle"] else "1D6")
            if p["is_vehicle"]:
                # Default Regular hazard → minor incident (p.144)
                sev = hazard.get("collision_severity") or "minor"
                if difficulty == "hard":
                    sev = hazard.get("collision_severity") or "moderate"
                elif difficulty == "extreme":
                    sev = hazard.get("collision_severity") or "severe"
                coll = self.apply_vehicle_collision(actor_id, severity=sev, apply_debt=False)
                out["damage"] = coll["build_damage"]
                out["collision"] = coll
            else:
                dmg = max(0, _roll_dice(damage_dice, self._rng))
                p["hp"] = max(0, int(p["hp"]) - dmg)
                out["damage"] = dmg
            debt = self._rng.randint(1, 3)
            p["movement_debt"] = int(p.get("movement_debt") or 0) + debt
            out["movement_debt"] = debt
        return out

    # ------------------------------------------------------------------ #
    # Part 3: Barriers (p.136-137)
    # ------------------------------------------------------------------ #
    def _resolve_barrier_skill(
        self, actor_id: str, action: dict[str, Any]
    ) -> dict[str, Any]:
        p = self.participants[actor_id]
        nxt = self._next_location(p["position"])
        if nxt is None or not nxt.get("barrier"):
            # Allow barrier on current location (legacy tests place barrier at next).
            loc = self.location_chain[p["position"]] if p["position"] < len(self.location_chain) else {}
            # Prefer next location's barrier (entering).
            if nxt and nxt.get("barrier"):
                loc = nxt
            elif not loc.get("barrier") and nxt:
                loc = nxt
        else:
            loc = nxt

        barrier = (loc or {}).get("barrier")
        if not barrier or int(barrier.get("hp") or 0) <= 0:
            # No active barrier — treat as clear advance.
            return self._resolve_advance(actor_id, {"type": "advance"})

        skill = action.get("skill") or barrier.get("skill") or "Climb"
        target = int(action.get("target") or barrier.get("target") or 50)
        difficulty = action.get("difficulty") or barrier.get("difficulty") or "regular"
        self._spend_actions(p, 1)
        res = coc_roll.percentile_check(target, difficulty=difficulty, rng=self._rng)
        rid = self._roll_id()
        self.pending_rolls.append({
            "roll_id": rid, "actor_id": actor_id, "skill": skill,
            "target": target, "roll": res["roll"], "outcome": res["outcome"],
            "kind": "barrier",
        })
        passed = res["outcome"] not in ("failure", "fumble")
        out: dict[str, Any] = {
            "type": "barrier",
            "passed": passed,
            "roll_id": rid,
            "actions_spent": 1,
            "barrier_id": barrier.get("barrier_id"),
        }
        if passed:
            # Negotiated past — advance; barrier remains for others unless removed.
            dest_index = loc.get("index", p["position"] + 1)
            p["position"] = dest_index
            if p["is_vehicle"]:
                self._sync_passengers(actor_id)
            out["new_position"] = p["position"]
            if loc.get("label") == "escape" and p["side"] == "quarry":
                p["escaped"] = True
                out["escaped"] = True
        return out

    def _resolve_break_barrier(
        self, actor_id: str, action: dict[str, Any]
    ) -> dict[str, Any]:
        """Smash barrier: Build×1D10 damage; no attack roll (p.137)."""
        p = self.participants[actor_id]
        nxt = self._next_location(p["position"])
        if nxt is None or not nxt.get("barrier"):
            return {"type": "break_barrier", "result": "no_barrier", "actions_spent": 0}
        barrier = nxt["barrier"]
        if int(barrier.get("hp") or 0) <= 0:
            return {"type": "break_barrier", "result": "already_destroyed", "actions_spent": 0}

        self._spend_actions(p, 1)
        build = max(0, int(p.get("build") or 0))
        # Characters without vehicle build still smash: use max(1, build) or STR proxy.
        # Rulebook: "for each point of their build, vehicles inflict 1D10".
        # Foot characters kicking doors: typically 1D3 in examples; we use
        # Build×1D10 for vehicles and max(1, Build)×1D10 for characters with
        # Build, else 1D3 for Build 0 (Harvey fence example).
        hp_before = int(barrier["hp"])
        if p["is_vehicle"] or build > 0:
            dice = max(1, build) if p["is_vehicle"] else max(1, build)
            damage = sum(self._rng.randint(1, 10) for _ in range(dice))
        else:
            damage = self._rng.randint(1, 3)

        barrier["hp"] = max(0, hp_before - damage)
        destroyed = barrier["hp"] <= 0
        out: dict[str, Any] = {
            "type": "break_barrier",
            "damage_to_barrier": damage,
            "barrier_hp_before": hp_before,
            "barrier_hp_after": barrier["hp"],
            "destroyed": destroyed,
            "actions_spent": 1,
            "vehicle_wrecked": False,
            "vehicle_damage": 0,
        }

        if p["is_vehicle"]:
            if not destroyed:
                # Vehicle wrecked (p.137).
                p["wrecked"] = True
                out["vehicle_wrecked"] = True
                nxt["hazard"] = {
                    "hazard_id": f"wreck_{actor_id}",
                    "skill": "Drive Auto",
                    "target": 50,
                    "difficulty": "regular",
                    "damage_dice": "1D6",
                    "collision_severity": "moderate",
                    "from_wreck": True,
                }
                self.pending_events.append({
                    "kind": "vehicle_wrecked_on_barrier",
                    "actor_id": actor_id,
                    "barrier_id": barrier.get("barrier_id"),
                })
            else:
                # Half barrier HP prior to impact as vehicle damage (p.137).
                vdmg = hp_before // 2
                out["vehicle_damage"] = vdmg
                self._apply_build_hp_damage(p, vdmg)
                # Debris becomes hazard for those that follow (p.137).
                nxt["hazard"] = {
                    "hazard_id": f"debris_{barrier.get('barrier_id', 'barrier')}",
                    "skill": "Drive Auto" if True else "DEX",
                    "target": 50,
                    "difficulty": "regular",
                    "damage_dice": "1D6",
                    "from_debris": True,
                }
                # Advance through destroyed barrier.
                p["position"] = nxt.get("index", p["position"] + 1)
                self._sync_passengers(actor_id)
                out["new_position"] = p["position"]
        else:
            if destroyed:
                nxt["hazard"] = {
                    "hazard_id": f"debris_{barrier.get('barrier_id', 'barrier')}",
                    "skill": "DEX",
                    "target": 50,
                    "difficulty": "regular",
                    "damage_dice": "1D3",
                    "from_debris": True,
                }
                p["position"] = nxt.get("index", p["position"] + 1)
                out["new_position"] = p["position"]
        return out

    def _apply_build_hp_damage(self, p: dict[str, Any], hp_damage: int) -> int:
        """Apply HP damage to a vehicle; each full 10 HP → −1 Build (p.145)."""
        if hp_damage <= 0:
            return 0
        # Track cumulative damage toward build loss.
        pending = int(p.get("_build_damage_bank", 0)) + hp_damage
        loss = pending // 10
        p["_build_damage_bank"] = pending % 10
        if loss:
            p["build"] = max(0, int(p["build"]) - loss)
        if p["build"] <= 0:
            p["wrecked"] = True
        return loss

    # ------------------------------------------------------------------ #
    # Part 4: Conflict (p.137-138)
    # ------------------------------------------------------------------ #
    def initiate_melee_conflict(
        self,
        attacker_id: str,
        defender_id: str,
        *,
        combat_session: Any,
        declared_intent: str = "attack",
        defense_kind: str = "dodge",
        weapon_id: str | None = None,
    ) -> dict[str, Any]:
        """Same-location melee: chase spends 1 action; CombatSession resolves.

        Chase owns positions; combat owns the exchange. Callers must supply
        a CombatSession (sibling ``coc_combat``) — we add participants if
        missing and call ``declare_and_resolve_turn``.
        """
        atk = self.participants[attacker_id]
        dfn = self.participants[defender_id]
        if atk["position"] != dfn["position"]:
            raise ValueError("melee conflict requires same location")
        if not self.rounds:
            self.begin_round()
        self._spend_actions(atk, 1)
        self._active_combat = combat_session

        def _ensure(actor_id: str, chase_side: str) -> None:
            if actor_id in combat_session.participants:
                return
            p = self.participants[actor_id]
            # CombatSession VALID_SIDES: investigator | monster | npc
            combat_side = "investigator" if chase_side == "quarry" else "npc"
            combat_session.add_participant(
                actor_id,
                combat_side,
                dex=p["dex"],
                combat_skill=int(p.get("fight") or 50),
                build=int(p.get("build") or 0),
                hp_max=int(p.get("hp_max") or p.get("hp") or 10),
                dodge_skill=int(p.get("dodge") or p.get("fight") or 50),
                firearms_skill=int(p.get("firearms") or 0),
                con=int(p.get("con") or 50),
            )
            combat_session.participants[actor_id]["hp_current"] = int(p.get("hp") or 10)

        _ensure(attacker_id, atk["side"])
        _ensure(defender_id, dfn["side"])
        if not combat_session.rounds:
            combat_session.begin_round()

        turn = combat_session.declare_and_resolve_turn(
            attacker_id,
            declared_intent,
            action="attack",
            target_actor_id=defender_id,
            defense_kind=defense_kind,
            weapon_id=weapon_id,
        )
        # Sync HP back to chase participants.
        for aid in (attacker_id, defender_id):
            if aid in combat_session.participants:
                self.participants[aid]["hp"] = combat_session.participants[aid]["hp_current"]
                if combat_session.participants[aid]["hp_current"] <= 0:
                    if self.participants[aid]["side"] == "quarry":
                        self.participants[aid]["captured"] = True

        rolls, events = combat_session.drain_pending()
        self.pending_rolls.extend(rolls)
        self.pending_events.extend(events)
        self.pending_events.append({
            "kind": "conflict_melee_delegated",
            "attacker_id": attacker_id,
            "defender_id": defender_id,
            "combat_id": getattr(combat_session, "combat_id", None),
            "rule_ref": "core.chase.conflict",
        })
        return {
            "type": "conflict_melee",
            "delegated": True,
            "combat_turn": turn,
            "actions_spent": 1,
            "attacker_id": attacker_id,
            "defender_id": defender_id,
            "position": atk["position"],
        }

    def record_external_conflict(
        self, attacker_id: str, defender_id: str, *, combat_command_id: str,
        combat_revision: int, hp_after: dict[str, int],
    ) -> dict[str, Any]:
        """Consume chase economy from a separately persisted combat receipt."""
        if self.status != "active" or not self.rounds:
            raise ValueError("active chase round required")
        order = self.rounds[-1]["dex_order"]
        if self.initiative_cursor >= len(order) or order[self.initiative_cursor] != attacker_id:
            raise ValueError("actor is out of chase initiative order")
        attacker = self.participants.get(attacker_id)
        defender = self.participants.get(defender_id)
        if not isinstance(attacker, dict) or not isinstance(defender, dict):
            raise ValueError("unknown chase conflict actor")
        if attacker["position"] != defender["position"]:
            raise ValueError("melee conflict requires same location")
        if int(attacker.get("movement_actions_remaining", 0)) < 1:
            raise ValueError("chase action budget exceeded")
        self._spend_actions(attacker, 1)
        for actor_id, hp in hp_after.items():
            if actor_id in self.participants:
                self.participants[actor_id]["hp"] = max(0, int(hp))
        event = {
            "type": "conflict", "attacker_id": attacker_id,
            "defender_id": defender_id, "combat_command_id": combat_command_id,
            "combat_revision": combat_revision, "actions_spent": 1,
        }
        self.rounds[-1]["turns"].append({
            "turn_id": f"t{self._current_round}-{self._next_turn()}",
            "actor_id": attacker_id, "dex": attacker["dex"],
            "movement_actions": attacker["movement_actions"],
            "actions_taken": [event],
        })
        self.initiative_cursor += 1
        self.revision += 1
        return event

    def vehicle_conflict(
        self,
        attacker_id: str,
        defender_id: str,
        *,
        defense_kind: str = "dodge",
    ) -> dict[str, Any]:
        """Vehicle vs vehicle: opposed Drive Auto; damage Build×1D10 (p.138)."""
        atk = self.participants[attacker_id]
        dfn = self.participants[defender_id]
        if atk["position"] != dfn["position"]:
            raise ValueError("vehicle conflict requires same location")
        if not atk.get("is_vehicle") or not dfn.get("is_vehicle"):
            raise ValueError("vehicle_conflict requires two vehicles")
        if not self.rounds:
            self.begin_round()
        self._spend_actions(atk, 1)

        atk_skill = int(atk.get("drive_auto") or 50)
        dfn_skill = int(dfn.get("drive_auto") or 50)
        # Build difference → penalty dice on attacker (p.138 fighting maneuver).
        build_diff = int(dfn.get("build") or 0) - int(atk.get("build") or 0)
        atk_penalty = 0
        if build_diff >= 3:
            return {
                "type": "conflict_vehicle",
                "result": "impossible",
                "reason": "target_build_3_or_more_larger",
                "actions_spent": 1,
                "attacker_skill": "Drive Auto",
            }
        if build_diff == 2:
            atk_penalty = 2
        elif build_diff == 1:
            atk_penalty = 1

        atk_res = coc_roll.percentile_check(atk_skill, penalty=atk_penalty, rng=self._rng)
        dfn_res = coc_roll.percentile_check(dfn_skill, rng=self._rng)
        atk_rid = self._roll_id()
        dfn_rid = self._roll_id()
        self.pending_rolls.append({
            "roll_id": atk_rid, "actor_id": attacker_id, "skill": "Drive Auto",
            "target": atk_skill, "roll": atk_res["roll"], "outcome": atk_res["outcome"],
            "penalty": atk_penalty, "kind": "vehicle_conflict_attack",
        })
        self.pending_rolls.append({
            "roll_id": dfn_rid, "actor_id": defender_id, "skill": "Drive Auto",
            "target": dfn_skill, "roll": dfn_res["roll"], "outcome": dfn_res["outcome"],
            "kind": "vehicle_conflict_defense",
        })

        # Reuse combat opposed resolution semantics (fight_back tie → attacker).
        opposed = coc_combat.CombatSession._resolve_opposed(
            atk_res["outcome"], dfn_res["outcome"],
            "dodge" if defense_kind == "dodge" else "fight_back",
        )
        out: dict[str, Any] = {
            "type": "conflict_vehicle",
            "attacker_skill": "Drive Auto",
            "attacker_outcome": atk_res["outcome"],
            "defender_outcome": dfn_res["outcome"],
            "opposed": opposed,
            "actions_spent": 1,
            "attacker_roll_id": atk_rid,
            "defender_roll_id": dfn_rid,
        }
        if opposed == "both_fail":
            out["both_fail"] = True
            out["winner"] = None
            out["damage_to_loser"] = 0
            return out

        if opposed in ("attacker_higher", "tie_attacker_wins"):
            winner, loser = attacker_id, defender_id
        else:
            winner, loser = defender_id, attacker_id
        out["winner"] = winner
        out["loser"] = loser

        winner_p = self.participants[winner]
        loser_p = self.participants[loser]
        w_build = max(1, int(winner_p.get("build") or 1))
        damage = sum(self._rng.randint(1, 10) for _ in range(w_build))
        # Attacker (striker) also takes half, capped by target's original build×10.
        half = damage // 2
        target_build_cap = max(0, int(loser_p.get("build") or 0)) * 10
        # "never enough to cause it to lose a greater amount of build points
        # than the target which it hit originally possessed" (p.138)
        striker = self.participants[attacker_id] if winner == attacker_id else winner_p
        # Damage is inflicted by the vehicle that won the exchange.
        self_damage = min(half, target_build_cap)

        loser_loss = self._apply_build_hp_damage(loser_p, damage)
        striker_loss = self._apply_build_hp_damage(
            self.participants[winner], self_damage
        )
        out["damage_to_loser"] = damage
        out["damage_to_winner"] = self_damage
        out["build_loss"] = {"loser": loser_loss, "winner": striker_loss}

        # Optional: wire a collision severity for narrative/passenger damage.
        if damage >= 20:
            sev = "severe"
        elif damage >= 10:
            sev = "moderate"
        else:
            sev = "minor"
        coll = vehicle_collision(sev, rng=self._rng)
        out["collision"] = coll
        # Passenger HP from collision table.
        for pid, pp in self.participants.items():
            if pp.get("vehicle_actor_id") == loser:
                pp["hp"] = max(0, int(pp["hp"]) - coll["passenger_damage"])
        debt = self._rng.randint(1, 3)
        loser_p["movement_debt"] = int(loser_p.get("movement_debt") or 0) + debt
        out["movement_debt"] = debt
        return out

    def apply_vehicle_collision(
        self,
        actor_id: str,
        severity: str = "moderate",
        *,
        apply_debt: bool = True,
    ) -> dict[str, Any]:
        """Apply Table VI collision to a vehicle participant inside the session."""
        p = self.participants[actor_id]
        coll = vehicle_collision(severity, rng=self._rng)
        loss = self._apply_build_hp_damage(p, coll["build_damage"])
        coll = {
            **coll,
            "kind": "vehicle_collision",
            "actor_id": actor_id,
            "build_loss": loss,
            "build_after": p["build"],
        }
        # Occupants take passenger_damage.
        p["hp"] = max(0, int(p["hp"]) - coll["passenger_damage"])
        for pp in self.participants.values():
            if pp.get("vehicle_actor_id") == actor_id:
                pp["hp"] = max(0, int(pp["hp"]) - coll["passenger_damage"])
        if apply_debt:
            debt = self._rng.randint(1, 3)
            p["movement_debt"] = int(p.get("movement_debt") or 0) + debt
            coll["movement_debt"] = debt
        self.pending_rolls.append(coll)
        self.pending_events.append({
            "kind": "vehicle_collision",
            "actor_id": actor_id,
            "severity": coll["severity"],
            "build_damage": coll["build_damage"],
        })
        return coll

    def _resolve_legacy_conflict(
        self, actor_id: str, action: dict[str, Any]
    ) -> dict[str, Any]:
        """Thin Fighting grab path kept for simple harnesses without CombatSession."""
        p = self.participants[actor_id]
        tid = action.get("target_actor_id", "")
        tp = self.participants.get(tid)
        if not tp:
            return {"type": "conflict", "result": "no_target", "actions_spent": 0}
        if p["position"] != tp["position"]:
            return {"type": "conflict", "result": "not_same_location", "actions_spent": 0}
        self._spend_actions(p, 1)
        ft = action.get("fight_target", p.get("fight") or 40)
        res = coc_roll.percentile_check(int(ft), rng=self._rng)
        rid = self._roll_id()
        self.pending_rolls.append({
            "roll_id": rid, "actor_id": actor_id, "skill": "Fighting",
            "target": ft, "roll": res["roll"], "outcome": res["outcome"],
            "kind": "conflict_grab",
        })
        if res["outcome"] not in ("failure", "fumble"):
            tp["captured"] = True
            return {
                "type": "conflict", "result": "grabbed", "target": tid,
                "roll_id": rid, "actions_spent": 1,
            }
        return {
            "type": "conflict", "result": "missed", "target": tid,
            "roll_id": rid, "actions_spent": 1,
        }

    def _resolve_hide(
        self, actor_id: str, action: dict[str, Any]
    ) -> dict[str, Any]:
        p = self.participants[actor_id]
        self._spend_actions(p, 1)
        stealth = int(action.get("stealth_target") or 40)
        res = coc_roll.percentile_check(stealth, rng=self._rng)
        rid = self._roll_id()
        self.pending_rolls.append({
            "roll_id": rid, "actor_id": actor_id, "skill": "Stealth",
            "target": stealth, "roll": res["roll"], "outcome": res["outcome"],
            "kind": "hide",
        })
        return {
            "type": "hide",
            "success": res["outcome"] not in ("failure", "fumble"),
            "roll_id": rid,
            "actions_spent": 1,
        }

    # ------------------------------------------------------------------ #
    # Part 5: Pedal to the Metal (p.139-140)
    # ------------------------------------------------------------------ #
    def _resolve_pedal(
        self, actor_id: str, action: dict[str, Any]
    ) -> dict[str, Any]:
        p = self.participants[actor_id]
        if not p.get("is_vehicle"):
            raise ValueError("Pedal to the Metal requires a vehicle")
        locations = int(action.get("locations") or 2)
        if locations < 2 or locations > 5:
            raise ValueError("Pedal to the Metal moves 2 to 5 locations")
        if locations <= 3:
            base_penalty = 1
        else:
            base_penalty = 2
        assist = int(p.get("assist_penalty_reduction") or 0)
        penalty = max(0, base_penalty - assist)
        p["assist_penalty_reduction"] = 0  # consumed
        self._spend_actions(p, 1)

        moved = 0
        hazard_results: list[dict[str, Any]] = []
        for _ in range(locations):
            nxt = self._next_location(p["position"])
            if nxt is None:
                break
            barrier = nxt.get("barrier")
            if barrier and int(barrier.get("hp") or 0) > 0:
                # Acceleration usually helps barriers (p.140) — attempt smash.
                br = self._resolve_break_barrier(actor_id, {})
                # break_barrier already spent an action; refund the double-spend
                # by restoring one (pedal already paid).
                p["movement_actions_remaining"] = int(
                    p.get("movement_actions_remaining") or 0
                ) + 1
                hazard_results.append(br)
                if p.get("wrecked") or not br.get("destroyed"):
                    break
                moved += 1
                continue
            hazard = nxt.get("hazard")
            if hazard:
                hr = self._negotiate_hazard(
                    actor_id, nxt, hazard, action,
                    cautious_bonus_actions=0,
                    extra_penalty=penalty,
                )
                # negotiate_hazard spent 1 action; pedal already paid — refund.
                p["movement_actions_remaining"] = int(
                    p.get("movement_actions_remaining") or 0
                ) + 1
                hazard_results.append(hr)
                moved += 1
                if not hr.get("passed"):
                    break  # further movement must be paid afresh (p.140)
            else:
                p["position"] = nxt.get("index", p["position"] + 1)
                moved += 1
                if nxt.get("label") == "escape" and p["side"] == "quarry":
                    p["escaped"] = True
                    break
        self._sync_passengers(actor_id)
        return {
            "type": "pedal_to_the_metal",
            "locations_requested": locations,
            "locations_moved": moved,
            "penalty": penalty,
            "assist_applied": assist,
            "actions_spent": 1,
            "new_position": p["position"],
            "hazard_results": hazard_results,
            "escaped": p.get("escaped", False),
        }

    # ------------------------------------------------------------------ #
    # Part 5: Passengers (p.142)
    # ------------------------------------------------------------------ #
    def passenger_action(
        self, actor_id: str, action: dict[str, Any]
    ) -> dict[str, Any]:
        if self.status != "active" or not self.rounds:
            raise ValueError("active chase round required")
        order = self.rounds[-1]["dex_order"]
        if self.initiative_cursor >= len(order) or order[self.initiative_cursor] != actor_id:
            raise ValueError("actor is out of chase initiative order")
        p = self.participants[actor_id]
        if p.get("role") != "passenger":
            raise ValueError(f"{actor_id} is not a passenger")
        atype = action.get("type", "assist_driver")
        if atype == "assist_driver":
            skill = action.get("skill") or "Spot Hidden"
            if skill == "Navigate":
                target = int(action.get("target") or p.get("navigate") or 40)
            else:
                target = int(action.get("target") or p.get("spot_hidden") or 40)
            res = coc_roll.percentile_check(target, rng=self._rng)
            rid = self._roll_id()
            self.pending_rolls.append({
                "roll_id": rid, "actor_id": actor_id, "skill": skill,
                "target": target, "roll": res["roll"], "outcome": res["outcome"],
                "kind": "passenger_assist",
            })
            success = res["outcome"] not in ("failure", "fumble")
            vid = p.get("vehicle_actor_id")
            if success and vid and vid in self.participants:
                self.participants[vid]["assist_penalty_reduction"] = 1
            result = {
                "type": "assist_driver",
                "success": success,
                "roll_id": rid,
                "vehicle_id": vid,
            }
            self.rounds[-1]["turns"].append({
                "turn_id": f"t{self._current_round}-{self._next_turn()}",
                "actor_id": actor_id, "dex": p["dex"],
                "movement_actions": 0, "actions_taken": [result],
            })
            self.initiative_cursor += 1
            self.revision += 1
            return result
        if atype == "fire":
            return self.fire_while_moving(
                attacker_id=actor_id,
                target_id=action["target_actor_id"],
                firearms_target=int(
                    action.get("firearms_target") or p.get("firearms") or 40
                ),
                moving=True,
            )
        return {"type": atype, "result": "unknown"}

    # ------------------------------------------------------------------ #
    # Part 5: Ranged attacks during chase (p.142)
    # ------------------------------------------------------------------ #
    def fire_while_moving(
        self,
        attacker_id: str,
        target_id: str,
        *,
        firearms_target: int,
        moving: bool = True,
    ) -> dict[str, Any]:
        """Firearms in a chase: moving → +1 penalty, no action cost; stopped → 1 action."""
        atk = self.participants[attacker_id]
        if target_id not in self.participants:
            raise ValueError(f"unknown target {target_id}")
        if not self.rounds:
            self.begin_round()
        cost = 0 if moving else 1
        if cost:
            self._spend_actions(atk, cost)
        penalty = 1 if moving else 0
        res = coc_roll.percentile_check(
            firearms_target, penalty=penalty, rng=self._rng
        )
        rid = self._roll_id()
        self.pending_rolls.append({
            "roll_id": rid, "actor_id": attacker_id, "skill": "Firearms",
            "target": firearms_target, "roll": res["roll"], "outcome": res["outcome"],
            "penalty": penalty, "kind": "fire_while_moving",
        })
        hit = res["outcome"] not in ("failure", "fumble")
        damage = 0
        if hit:
            damage = self._rng.randint(1, 10)  # generic handgun stand-in
            # Vehicle armor protects occupants (Table V).
            tgt = self.participants[target_id]
            armor = 0
            if tgt.get("is_vehicle"):
                armor = int(tgt.get("armor") or 0)
            elif tgt.get("vehicle_actor_id"):
                vid = tgt["vehicle_actor_id"]
                armor = int(self.participants[vid].get("armor") or 0)
            else:
                armor = int(tgt.get("armor") or 0)
            applied = max(0, damage - armor)
            tgt["hp"] = max(0, int(tgt["hp"]) - applied)
            damage = applied
        return {
            "type": "fire_while_moving",
            "moving": moving,
            "penalty": penalty,
            "movement_action_cost": cost,
            "hit": hit,
            "damage": damage,
            "roll_id": rid,
            "actions_spent": cost,
            "target_id": target_id,
        }

    # ------------------------------------------------------------------ #
    # Part 5: Choosing a Route (p.139)
    # ------------------------------------------------------------------ #
    def choose_route(
        self,
        actor_id: str,
        *,
        alternate_locations: list[dict[str, Any] | str],
    ) -> dict[str, Any]:
        """Quarry replaces upcoming locations with an alternate path."""
        p = self.participants[actor_id]
        if p["side"] != "quarry":
            raise ValueError("only the quarry chooses the route")
        pos = p["position"]
        kept = [
            _normalize_location(loc, i)
            for i, loc in enumerate(self.location_chain[: pos + 1])
        ]
        new_tail = [
            _normalize_location(loc, pos + 1 + i)
            for i, loc in enumerate(alternate_locations)
        ]
        self.location_chain = kept + new_tail
        # Re-index.
        for i, loc in enumerate(self.location_chain):
            loc["index"] = i
        self.pending_events.append({
            "kind": "choose_route",
            "actor_id": actor_id,
            "from_position": pos,
            "new_tail_labels": [loc["label"] for loc in new_tail],
            "rule_ref": "core.chase.choosing_a_route",
        })
        return {
            "type": "choose_route",
            "actor_id": actor_id,
            "from_position": pos,
            "location_count": len(self.location_chain),
            "new_tail_labels": [loc["label"] for loc in new_tail],
        }

    # ------------------------------------------------------------------ #
    # Part 5: Sudden Hazards (p.139)
    # ------------------------------------------------------------------ #
    def sudden_hazard(
        self,
        caller: str,
        *,
        luck_target: int = 50,
        hazard: dict[str, Any] | None = None,
        at_position: int | None = None,
    ) -> dict[str, Any]:
        """Alternating Luck calls place a Regular sudden hazard (p.139)."""
        if caller not in ("players", "keeper"):
            raise ValueError("caller must be 'players' or 'keeper'")
        if (
            self._sudden_hazard_last_caller is not None
            and self._sudden_hazard_last_caller == caller
        ):
            raise ValueError("sudden hazards must alternate between players and keeper")

        res = coc_roll.percentile_check(luck_target, rng=self._rng)
        rid = self._roll_id()
        self.pending_rolls.append({
            "roll_id": rid, "actor_id": caller, "skill": "Luck",
            "target": luck_target, "roll": res["roll"], "outcome": res["outcome"],
            "kind": "sudden_hazard_luck",
        })
        luck_passed = res["outcome"] not in ("failure", "fumble")
        # Passed → caller's favor (they place); failed → other side places.
        placer = caller if luck_passed else ("keeper" if caller == "players" else "players")
        self._sudden_hazard_last_caller = caller

        # Default placement: just ahead of the lead quarry.
        quarries = [p for p in self.participants.values() if p["side"] == "quarry"]
        lead = max((q["position"] for q in quarries), default=0)
        pos = at_position if at_position is not None else min(
            lead + 1, max(0, len(self.location_chain) - 1)
        )
        placed = hazard or {
            "hazard_id": f"sudden_{self._current_round}_{caller}",
            "skill": "DEX",
            "target": 50,
            "difficulty": "regular",
            "damage_dice": "1D6",
            "sudden": True,
        }
        if self.location_chain and 0 <= pos < len(self.location_chain):
            self.location_chain[pos]["hazard"] = placed

        out = {
            "type": "sudden_hazard",
            "caller": caller,
            "placer": placer,
            "luck_outcome": res["outcome"],
            "luck_passed": luck_passed,
            "roll_id": rid,
            "position": pos,
            "hazard": placed,
        }
        self.pending_events.append({**out, "kind": "sudden_hazard"})
        return out

    def roll_random_hazard(self, *, environment: str = "normal") -> dict[str, Any]:
        """Random hazards/barriers table (p.139): 01-59 clear, 60+ Regular, etc."""
        bonus = 0
        penalty = 0
        if environment == "hazardous":
            penalty = 1
        elif environment == "safe":
            bonus = 1
        res = coc_roll.percentile_check(100, bonus=bonus, penalty=penalty, rng=self._rng)
        # Use raw roll against thresholds (not success levels).
        roll = res["roll"]
        if roll >= 96:
            kind, difficulty = "hazard_or_barrier", "extreme"
        elif roll >= 85:
            kind, difficulty = "hazard_or_barrier", "hard"
        elif roll >= 60:
            kind, difficulty = "hazard_or_barrier", "regular"
        else:
            kind, difficulty = "clear", "regular"
        return {
            "type": "random_hazard",
            "roll": roll,
            "kind": kind,
            "difficulty": difficulty,
            "environment": environment,
        }

    # ------------------------------------------------------------------ #
    # Outcome / persistence
    # ------------------------------------------------------------------ #
    def check_outcome(self) -> str | None:
        quarries = [p for p in self.participants.values() if p["side"] == "quarry"]
        if not quarries:
            return None
        if all(q["escaped"] for q in quarries):
            self.conclude("escaped")
        elif all(q["captured"] or q.get("wrecked") for q in quarries):
            self.conclude("captured")
        return self.outcome

    def conclude(self, outcome: str) -> None:
        if outcome not in VALID_CHASE_OUTCOMES - {None}:
            raise ValueError("invalid chase outcome")
        self.status = "concluded"
        self.outcome = outcome
        self.revision += 1

    def snapshot(self) -> dict[str, Any]:
        return {
            "schema_version": CHASE_SCHEMA_VERSION,
            "chase_id": self.chase_id,
            "status": self.status,
            "outcome": self.outcome,
            "revision": self.revision,
            "initiative_cursor": self.initiative_cursor,
            "roll_counter": self._roll_counter,
            "turn_counter": self._turn_counter,
            "current_round": self._current_round,
            "participants": json.loads(json.dumps(list(self.participants.values()))),
            "location_chain": json.loads(json.dumps(self.location_chain)),
            "rounds": json.loads(json.dumps(self.rounds)),
            "sudden_hazard_last_caller": self._sudden_hazard_last_caller,
            "play_language": self._play_language,
        }

    def save(self, campaign_dir: Path) -> Path:
        d = Path(campaign_dir) / "save"
        d.mkdir(parents=True, exist_ok=True)
        path = d / "chase.json"
        snapshot = self.snapshot()
        self._validate_snapshot(snapshot)
        coc_fileio.write_json_atomic(
            path, snapshot, indent=2, ensure_ascii=False, trailing_newline=False
        )
        return path

    @classmethod
    def load(cls, path: Path, rng: random.Random | None = None) -> "ChaseSession":
        try:
            data = json.loads(Path(path).read_text(encoding="utf-8"))
            cls._validate_snapshot(data)
        except (OSError, UnicodeError, json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
            if isinstance(exc, ValueError) and str(exc).startswith("chase snapshot"):
                raise
            raise ValueError(f"chase snapshot is invalid: {exc}") from exc
        session = cls(
            data["chase_id"],
            rng=rng or random.Random(),
            play_language=data.get("play_language", "zh-Hans"),
        )
        session.status = data.get("status", "active")
        session.outcome = data.get("outcome")
        session.revision = data["revision"]
        session.initiative_cursor = data["initiative_cursor"]
        session._roll_counter = data["roll_counter"]
        session._turn_counter = data["turn_counter"]
        session.location_chain = [
            _normalize_location(loc, i)
            for i, loc in enumerate(data.get("location_chain") or [])
        ]
        session.rounds = list(data.get("rounds") or [])
        session._sudden_hazard_last_caller = data.get("sudden_hazard_last_caller")
        session._current_round = data["current_round"]
        for p in data.get("participants") or []:
            aid = p["actor_id"]
            session.participants[aid] = dict(p)
        return session

    @staticmethod
    def _validate_snapshot(data: Any) -> None:
        root_keys = {
            "schema_version", "chase_id", "status", "outcome", "revision",
            "initiative_cursor", "roll_counter", "turn_counter", "current_round",
            "participants", "location_chain", "rounds",
            "sudden_hazard_last_caller", "play_language",
        }
        if not isinstance(data, dict) or set(data) != root_keys:
            raise ValueError("chase snapshot root contract is invalid")
        if data.get("schema_version") != CHASE_SCHEMA_VERSION:
            raise ValueError("chase snapshot schema_version is unsupported")
        if not isinstance(data.get("chase_id"), str) or not data["chase_id"]:
            raise ValueError("chase snapshot chase_id is invalid")
        if data.get("status") not in {"active", "concluded"} or data.get("outcome") not in VALID_CHASE_OUTCOMES:
            raise ValueError("chase snapshot status/outcome is invalid")
        if (data["status"] == "active") != (data["outcome"] is None):
            raise ValueError("chase snapshot status/outcome is inconsistent")
        for key in ("revision", "initiative_cursor", "roll_counter", "turn_counter", "current_round"):
            value = data.get(key)
            if isinstance(value, bool) or not isinstance(value, int) or value < 0:
                raise ValueError(f"chase snapshot {key} is invalid")
        participants = data.get("participants")
        if not isinstance(participants, list) or not participants:
            raise ValueError("chase snapshot participants are invalid")
        actor_ids: list[str] = []
        for participant in participants:
            if not isinstance(participant, dict):
                raise ValueError("chase snapshot participant is invalid")
            actor_id = participant.get("actor_id")
            if not isinstance(actor_id, str) or not actor_id or actor_id in actor_ids:
                raise ValueError("chase snapshot actor identity is invalid")
            actor_ids.append(actor_id)
            for key in ("position", "movement_actions", "movement_actions_remaining", "movement_debt"):
                value = participant.get(key)
                if isinstance(value, bool) or not isinstance(value, int) or value < 0:
                    raise ValueError(f"chase snapshot participant {key} is invalid")
            if participant["movement_actions_remaining"] > participant["movement_actions"]:
                raise ValueError("chase snapshot participant action budget is invalid")
        locations = data.get("location_chain")
        if not isinstance(locations, list):
            raise ValueError("chase snapshot location chain is invalid")
        if locations and any(
            not isinstance(loc, dict) or loc.get("index") != index
            for index, loc in enumerate(locations)
        ):
            raise ValueError("chase snapshot location indexes are invalid")
        if locations and any(p["position"] >= len(locations) for p in participants):
            raise ValueError("chase snapshot participant position is invalid")
        rounds = data.get("rounds")
        if not isinstance(rounds, list) or data["current_round"] != len(rounds):
            raise ValueError("chase snapshot round counter is invalid")
        for index, round_row in enumerate(rounds, start=1):
            if (not isinstance(round_row, dict) or set(round_row) != {"round", "dex_order", "turns"}
                    or round_row.get("round") != index
                    or not isinstance(round_row.get("dex_order"), list)
                    or len(round_row["dex_order"]) != len(set(round_row["dex_order"]))
                    or any(actor not in actor_ids for actor in round_row["dex_order"])
                    or not isinstance(round_row.get("turns"), list)):
                raise ValueError("chase snapshot round contract is invalid")
        active_order = rounds[-1]["dex_order"] if rounds else []
        if data["initiative_cursor"] > len(active_order):
            raise ValueError("chase snapshot initiative_cursor is invalid")
        if rounds and len(rounds[-1]["turns"]) != data["initiative_cursor"]:
            raise ValueError("chase snapshot initiative history is inconsistent")

    def drain_pending(self) -> list[dict[str, Any]]:
        r = self.pending_rolls
        self.pending_rolls = []
        return r

    def drain_events(self) -> list[dict[str, Any]]:
        e = self.pending_events
        self.pending_events = []
        return e

    def _roll_id(self) -> str:
        self._roll_counter += 1
        return f"chr{self._roll_counter}"

    def _next_turn(self) -> int:
        self._turn_counter += 1
        return self._turn_counter
