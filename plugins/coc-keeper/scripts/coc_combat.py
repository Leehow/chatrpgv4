#!/usr/bin/env python3
"""Structured Call of Cthulhu 7e combat state — Chapter 6 combat engine.

Owns the structured combat state for one fight, parallel to the chase
subsystem's save/chase.json. Produces save/combat.json (participants,
rounds, turns, damage chain) plus the rolls/events records for
rolls.jsonl/events.jsonl. Audit reads combat.json to machine-verify
rulebook compliance (DEX order, opposed pairing, damage chain balance,
condition evidence) — independent of transcript prose.

Rulebook basis: Chapter 6 (Combat), 7e 40th Anniversary.
- DEX initiative, tie broken by combat_skill (p.114)
- Declaration of intent each round (p.114)
- Multi-round, series of rolls until victor (p.112)
- Action types: attack/maneuver/flee/cast/other/surprise_attack (p.114, p.106)
- Opposed resolution: fight-back (Fighting) or dodge (Dodge), distinct tie rules (p.115)
- Extreme success → max damage + impale for blades (p.115)
- No pushing combat rolls (p.116)
- Conditions: major_wound/dying/unconscious/prone/grappled/surprised/outnumbered (p.119, p.131)
- Flesh Ward armor degrades 1:1 with damage absorbed (p.449)
"""
from __future__ import annotations

import json
import hashlib
import random
import re
from pathlib import Path
from typing import Any

# Resolve sibling modules (coc_roll, coc_rules) without a package context.
SCRIPT_DIR = Path(__file__).resolve().parent


def _load_sibling(name: str, filename: str):
    import importlib.util
    spec = importlib.util.spec_from_file_location(name, SCRIPT_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_roll = _load_sibling("coc_roll", "coc_roll.py")
coc_rules = _load_sibling("coc_rules", "coc_rules.py")
coc_fileio = _load_sibling("coc_fileio", "coc_fileio.py")


# --------------------------------------------------------------------------- #
# Weapon catalog + module weapon extension
# --------------------------------------------------------------------------- #
def load_weapon_catalog(rules_dir: Path | None = None) -> dict[str, dict[str, Any]]:
    """Load the canonical weapon catalog from references/rules-json/weapons.json.

    Returns a weapon_id → weapon dict map. Each entry has skill, damage,
    adds_damage_bonus, impales, base_range_yards, category (and optional
    ammo_per_reload / note). The damage expression EXCLUDES DB — the engine
    appends the attacker's DB at roll time when adds_damage_bonus is true.
    """
    rd = rules_dir or (SCRIPT_DIR.parent / "references" / "rules-json")
    catalog_path = rd / "weapons.json"
    if not catalog_path.exists():
        return {}
    data = json.loads(catalog_path.read_text(encoding="utf-8"))
    catalog: dict[str, dict[str, Any]] = {}
    for wid, row in data.get("weapons", {}).items():
        entry = dict(row) if isinstance(row, dict) else {}
        # The table stores the dice expression as `damage_die` (Table XVII
        # schema); the combat engine reads `weapon["damage"]`. Expose both so
        # the catalog row works with the engine without a redundant column.
        if "damage" not in entry and "damage_die" in entry:
            entry["damage"] = entry["damage_die"]
        _derive_reload_fields(entry)
        catalog[wid] = entry
    return catalog


def resolve_module_weapons(
    module_weapons: list[dict[str, Any]] | None,
    catalog: dict[str, dict[str, Any]] | None = None,
) -> dict[str, dict[str, Any]]:
    """Merge a module's custom weapons on top of the canonical catalog.

    Each module weapon may use ``extends`` to reference a catalog entry
    (e.g. ``"extends": "knife_medium"``); the module entry then overrides
    fields like ``weapon_id``, ``special``, ``name``, ``rule_refs``. Module
    weapons without ``extends`` are taken verbatim. Returns a new
    weapon_id → weapon dict that callers use as the lookup table.

    This lets any module add scenario-specific weapons (Corbitt's ritual
    dagger, a chapel artifact, a mythos tome-as-weapon) without re-hardcoding
    base damage/skill/impales — those come from the catalog via extends.
    """
    base = dict(catalog) if catalog else load_weapon_catalog()
    if not module_weapons:
        return base
    merged: dict[str, dict[str, Any]] = {}
    for mw in module_weapons:
        if not isinstance(mw, dict):
            continue
        parent_id = mw.get("extends")
        entry: dict[str, Any]
        if parent_id and parent_id in base:
            entry = dict(base[parent_id])  # copy catalog entry
            entry.pop("weapon_id", None)   # don't inherit parent's id
        else:
            entry = {}
        # Override with module-specific fields.
        for k, v in mw.items():
            if k == "extends":
                continue
            entry[k] = v
        wid = entry.get("weapon_id") or parent_id
        if wid:
            entry["weapon_id"] = wid
            merged[wid] = entry
    # Catalog entries remain available unless overridden.
    for wid, entry in base.items():
        merged.setdefault(wid, entry)
    return merged


def parse_uses_per_round(text: str | None) -> dict[str, Any]:
    """Decode Table XVII ``uses_per_round`` strings into engine limits.

    Examples:
      ``"1"`` → max_shots=1
      ``"1 (3)"`` / ``"1(3)"`` → max_shots=3 (optional multi-shot)
      ``"1 or 2"`` → max_shots=2
      ``"1 (2) or full auto"`` → max_shots=2, allows_full_auto=True
      ``"Full auto"`` → allows_full_auto=True, max_shots=0 (auto only)
      ``"1/2"`` → rounds_per_use=2 (one shot every two rounds)
    """
    raw = (text or "1").strip()
    lower = raw.lower()
    allows_full_auto = "full auto" in lower
    rounds_per_use = 1
    max_shots = 1
    frac = re.fullmatch(r"(\d+)\s*/\s*(\d+)", raw)
    if frac:
        rounds_per_use = max(1, int(frac.group(2)))
        max_shots = max(1, int(frac.group(1)))
        return {"max_shots": max_shots, "allows_full_auto": allows_full_auto,
                "rounds_per_use": rounds_per_use}
    if allows_full_auto and re.fullmatch(r"full\s*auto", lower):
        return {"max_shots": 0, "allows_full_auto": True, "rounds_per_use": 1}
    # Optional multi-shot in parentheses: "1 (3)" or "1(3)"
    m_paren = re.search(r"\((\d+)\)", raw)
    if m_paren:
        max_shots = int(m_paren.group(1))
    else:
        # "1 or 2" / "1 or full auto" — take the largest explicit integer
        nums = [int(n) for n in re.findall(r"\d+", raw)]
        max_shots = max(nums) if nums else (0 if allows_full_auto else 1)
    return {"max_shots": max_shots, "allows_full_auto": allows_full_auto,
            "rounds_per_use": rounds_per_use}


def full_auto_volley_size(skill: int) -> int:
    """Full-auto volley size = skill/10 (tens digit), never fewer than 3 (p.114)."""
    return max(3, int(skill) // 10)


def _derive_reload_fields(entry: dict[str, Any]) -> None:
    """Fill reload_rounds / reload_kind when absent (p.113 Reloading Firearms).

    - Clip exchange or loading shells into handgun/rifle/shotgun: 1 round.
    - Machine-gun belt change: 2 rounds.
    - Shells: up to 2 loaded per spent reload round.
    """
    magazine = entry.get("magazine")
    skill = str(entry.get("skill") or "")
    if magazine is None:
        entry.setdefault("reload_rounds", None)
        entry.setdefault("reload_kind", None)
        entry.setdefault("ammo_per_reload_round", None)
        return
    is_mg = ("Machine Gun" in skill) or skill.endswith("(MG)") or "Machine gun" in skill
    if "reload_rounds" not in entry or entry["reload_rounds"] is None:
        entry["reload_rounds"] = 2 if is_mg else 1
    if "reload_kind" not in entry or entry["reload_kind"] is None:
        entry["reload_kind"] = "belt" if is_mg else ("clip" if int(magazine) > 2 else "shells")
    if "ammo_per_reload_round" not in entry or entry["ammo_per_reload_round"] is None:
        if entry["reload_kind"] == "clip":
            entry["ammo_per_reload_round"] = int(magazine)
        elif entry["reload_kind"] == "belt":
            entry["ammo_per_reload_round"] = int(magazine)
        else:
            entry["ammo_per_reload_round"] = 2  # two shells per round (p.113)


# Success-level ordering (rulebook p.91). Higher = better.
LVL = {"fumble": 0, "failure": 1, "regular": 2, "hard": 3, "extreme": 4, "critical": 5}

# Valid enums for schema validation.
VALID_SIDES = {"investigator", "monster", "npc"}
VALID_ACTIONS = {"attack", "maneuver", "flee", "cast", "other", "surprise_attack"}
VALID_DEFENSE = {"fight_back", "dodge", "dive_for_cover", "maneuver", "none", None}
VALID_CONDITIONS = {"major_wound", "dying", "stabilized", "dead",
                     "unconscious", "prone", "grappled", "surprised",
                     "outnumbered", "fled"}
VALID_OUTCOMES = {"investigators_win", "monsters_win", "fled", "stalemate", None}
VALID_ARMOR_RULES = {"fixed", "degrades_1_per_damage", None}


class CombatSession:
    """Single source of truth for one combat scene.

    Drives Chapter 6 combat: DEX initiative, declared intents, opposed
    resolution, damage with armor, conditions, and persistent effects.
    Snapshots to save/combat.json after each round.
    """

    def __init__(self, combat_id: str, scene_ref: str, started_at_turn: int,
                 rng: random.Random, glossary: dict | None = None,
                 play_language: str = "zh-Hans",
                 module_weapons: list[dict[str, Any]] | None = None) -> None:
        self.combat_id = combat_id
        self.scene_ref = scene_ref
        self.started_at_turn = started_at_turn
        self.ended_at_turn: int | None = None
        self.status = "active"
        self.outcome: str | None = None
        self._rng = rng
        self._glossary = glossary or {}
        self._play_language = play_language
        # Merged weapon lookup: canonical catalog + module-specific overrides.
        # Participants reference weapons by weapon_id; base stats (damage,
        # skill, adds_damage_bonus, impales) come from this table, so callers
        # never hardcode damage expressions.
        self._weapon_catalog = resolve_module_weapons(module_weapons)

        self.participants: dict[str, dict[str, Any]] = {}
        self.rounds: list[dict[str, Any]] = []
        self.damage_chain: list[dict[str, Any]] = []
        # Jammed weapons (Table XVII malfunction): a jammed weapon_id is
        # unusable until repaired. Tracked per-actor so the same model in
        # two actors' hands is independent.
        self.jammed_weapons: set[str] = set()
        # Roll/event sinks — the harness reads these after each turn to write
        # to rolls.jsonl/events.jsonl. Keeping them on the session means the
        # session is the single producer of combat records.
        self.pending_rolls: list[dict[str, Any]] = []
        self.pending_events: list[dict[str, Any]] = []
        self._turn_counter = 0
        self._roll_counter = 0
        self._current_round = 0
        self._current_initiative: list[dict[str, Any]] = []
        self.initiative_cursor = 0
        # Complete current-round roster/progress.  Unlike the initiative list,
        # this includes actors excluded at round start and retains structured
        # evidence for every later eligibility skip.
        self.initiative_progress: list[dict[str, Any]] = []
        # Monotonic persisted revision used by live command bridges to reject
        # stale defense/rescue actions after a reload.
        self.revision = 0
        self.pending_attack: dict[str, Any] | None = None

    # ------------------------------------------------------------------ #
    # Participant management
    # ------------------------------------------------------------------ #
    def add_participant(self, actor_id: str, side: str, dex: int, combat_skill: int,
                        build: int, hp_max: int, magic_points: int = 0,
                        armor: int = 0, armor_rule: str | None = None,
                        weapons: list[dict[str, Any] | str] | None = None,
                        conditions: list[str] | None = None,
                        dodge_skill: int | None = None,
                        firearms_skill: int | None = None,
                        has_ready_firearm: bool = False,
                        damage_bonus: str = "none",
                        con: int = 50) -> None:
        if side not in VALID_SIDES:
            raise ValueError(f"invalid side {side!r}")
        if armor_rule not in VALID_ARMOR_RULES:
            raise ValueError(f"invalid armor_rule {armor_rule!r}")
        if actor_id in self.participants:
            raise ValueError(f"duplicate participant {actor_id}")
        self.participants[actor_id] = {
            "actor_id": actor_id,
            "side": side,
            "dex": dex,
            "combat_skill": combat_skill,
            "dodge_skill": dodge_skill if dodge_skill is not None else combat_skill,
            "firearms_skill": firearms_skill if firearms_skill is not None else 0,
            "has_ready_firearm": has_ready_firearm,
            "build": build,
            "damage_bonus": damage_bonus,  # e.g. "+1D4", "-2", "none" (STR+SIZ table)
            "con": con,  # CON characteristic (major-wound unconsciousness roll, p.120)
            "hp_max": hp_max,
            "hp_current": hp_max,
            "magic_points": magic_points,
            "armor": armor,
            "armor_rule": armor_rule,
            "weapons": weapons or [],
            "conditions": list(conditions or []),
            "active_effects": [],
            # Round-local state (reset each round):
            "_defended_this_round": False,
            "_dived_for_cover": False,
            "_forfeit_next_attack": False,
            # Firearms depth (W3-2 / p.113-114, p.126):
            "_aiming": False,
            "_ammo": {},  # weapon_id → rounds currently loaded
            "_reload_remaining": {},  # weapon_id → rounds left to finish reload
        }

    # ------------------------------------------------------------------ #
    # Round / initiative
    # ------------------------------------------------------------------ #
    def begin_round(self) -> int:
        """Start a new round. Computes initiative_order.

        Per p.114: DEX desc, ties broken by combat_skill. Per p.124: a
        participant with a readied firearm shoots at DEX+50. Per-turn DEX
        overrides (e.g. casting Dominate = DEX 85) are recorded on the turn.
        """
        self._current_round += 1
        # Reset round-local defense flags (mechanism 4: outnumbered).
        for p in self.participants.values():
            p["_defended_this_round"] = False
            # Persist dived_for_cover forfeit across rounds until next attack.
        # Compute initiative: effective DEX = base DEX, +50 if ready firearm (p.124).
        def eff_dex(p):
            base = p["dex"]
            if p.get("has_ready_firearm") and p.get("firearms_skill", 0) > 0:
                return base + 50, "ready_firearm"
            return base, None
        ranked = []
        for p in self.participants.values():
            if p["hp_current"] <= 0 or "dying" in p["conditions"] or "unconscious" in p["conditions"]:
                continue
            if "fled" in p["conditions"]:
                continue  # Mechanism 8: fled participants leave the fight
            dex_eff, reason = eff_dex(p)
            # Sort by dex_eff DESC, then combat_skill DESC, then actor_id ASC for stability.
            ranked.append((-dex_eff, -p["combat_skill"], p["actor_id"], dex_eff, reason))
        ranked.sort()
        self._current_initiative = [
            {"actor_id": aid, "dex": dex_eff, "dex_reason": reason}
            for _, _, aid, dex_eff, reason in ranked
        ]
        initiative_by_actor = {
            row["actor_id"]: dict(row) for row in self._current_initiative
        }
        self.initiative_progress = []
        for actor_id in sorted(self.participants):
            participant = self.participants[actor_id]
            eligibility = {
                "hp_current": participant["hp_current"],
                "conditions": list(participant["conditions"]),
                "dex": participant["dex"],
                "combat_skill": participant["combat_skill"],
                "firearms_skill": participant["firearms_skill"],
                "has_ready_firearm": participant["has_ready_firearm"],
            }
            initiative = initiative_by_actor.get(actor_id)
            self.initiative_progress.append({
                "actor_id": actor_id,
                "round_start_eligibility": eligibility,
                "initiative": dict(initiative) if initiative is not None else None,
                "status": "pending" if initiative is not None else "excluded_at_round_start",
                "skip_evidence": None,
            })
        self.rounds.append({
            "round": self._current_round,
            "initiative_order": [dict(item) for item in self._current_initiative],
            "initiative_progress": [dict(item) for item in self.initiative_progress],
            "turns": [],
        })
        self.initiative_cursor = 0
        return self._current_round

    def mark_current_initiative_acted(self) -> None:
        if self.initiative_cursor >= len(self._current_initiative):
            raise ValueError("initiative cursor has no current actor")
        actor_id = self._current_initiative[self.initiative_cursor]["actor_id"]
        row = next(item for item in self.initiative_progress if item["actor_id"] == actor_id)
        if row["status"] != "pending":
            raise ValueError("initiative actor is not pending")
        row["status"] = "acted"
        self._sync_initiative_progress_history()

    def mark_current_initiative_skipped(self) -> None:
        if self.initiative_cursor >= len(self._current_initiative):
            raise ValueError("initiative cursor has no current actor")
        actor_id = self._current_initiative[self.initiative_cursor]["actor_id"]
        participant = self.participants[actor_id]
        row = next(item for item in self.initiative_progress if item["actor_id"] == actor_id)
        if row["status"] != "pending":
            raise ValueError("initiative actor is not pending")
        source_receipt = self._canonical_skip_source_receipt(
            actor_id, self.rounds[-1]
        )
        if source_receipt is None:
            raise ValueError("initiative skip lacks an authoritative source transition")
        row["status"] = "skipped_ineligible"
        row["skip_evidence"] = {
            "hp_current": participant["hp_current"],
            "conditions": list(participant["conditions"]),
            "source_receipt": source_receipt,
        }
        self._sync_initiative_progress_history()

    def _canonical_skip_source_receipt(
        self, actor_id: str, round_row: dict[str, Any]
    ) -> dict[str, Any] | None:
        """Rebuild the exact pre-initiative transition that made an actor skip.

        A skip is not self-authenticating: its HP/condition snapshot must point
        at a damage/status receipt produced by an earlier turn in the same
        round.  Limiting eligible source turns to actors earlier in initiative
        prevents a historical row from being rebound to a later plausible
        damage record.
        """
        initiative = round_row.get("initiative_order") or []
        positions = {
            item.get("actor_id"): index
            for index, item in enumerate(initiative)
            if isinstance(item, dict)
        }
        skip_position = positions.get(actor_id)
        if not isinstance(skip_position, int):
            return None
        allowed_turn_ids: list[str] = []
        for turn in round_row.get("turns") or []:
            if not isinstance(turn, dict):
                continue
            actor_position = positions.get(turn.get("actor_id"))
            if not isinstance(actor_position, int) or actor_position >= skip_position:
                continue
            turn_id = turn.get("turn_id")
            if isinstance(turn_id, str):
                allowed_turn_ids.append(turn_id)
        candidate: dict[str, Any] | None = None
        for turn_id in allowed_turn_ids:
            for damage in self.damage_chain:
                if (
                    not isinstance(damage, dict)
                    or damage.get("source_turn_id") != turn_id
                    or damage.get("target_actor_id") != actor_id
                    or not isinstance(damage.get("damage_roll_id"), str)
                ):
                    continue
                status_after = damage.get("status_after")
                if not isinstance(status_after, dict):
                    continue
                hp_current = status_after.get("hp_current")
                conditions = status_after.get("conditions")
                if (
                    isinstance(hp_current, bool)
                    or not isinstance(hp_current, int)
                    or not isinstance(conditions, list)
                    or hp_current != damage.get("hp_after")
                ):
                    continue
                if hp_current > 0 and not any(
                    value in conditions
                    for value in ("dead", "dying", "unconscious", "fled")
                ):
                    continue
                candidate = {
                    "kind": "damage_status",
                    "round": round_row.get("round"),
                    "source_turn_id": turn_id,
                    "damage_roll_id": damage["damage_roll_id"],
                    "hp_current": hp_current,
                    "conditions": list(conditions),
                }
        return candidate

    def _sync_initiative_progress_history(self) -> None:
        if self.rounds:
            self.rounds[-1]["initiative_progress"] = [
                dict(item) for item in self.initiative_progress
            ]

    def _mark_defended(self, target_id: str) -> None:
        """Mark that target has defended this round (mechanism 4: outnumbered)."""
        if target_id in self.participants:
            self.participants[target_id]["_defended_this_round"] = True

    def _mark_dived_for_cover(self, target_id: str) -> None:
        """Diver forfeits next attack, can only dodge until then (p.125)."""
        if target_id in self.participants:
            p = self.participants[target_id]
            p["_dived_for_cover"] = True
            p["_forfeit_next_attack"] = True

    def has_defended_this_round(self, actor_id: str) -> bool:
        return self.participants.get(actor_id, {}).get("_defended_this_round", False)

    def is_forfeiting_attack(self, actor_id: str) -> bool:
        """True if actor dived for cover and hasn't taken their next attack yet."""
        p = self.participants.get(actor_id, {})
        return bool(p.get("_forfeit_next_attack"))

    def clear_forfeit(self, actor_id: str) -> None:
        """Called when the actor takes an attack turn (the forfeit is consumed)."""
        if actor_id in self.participants:
            self.participants[actor_id]["_forfeit_next_attack"] = False
            self.participants[actor_id]["_dived_for_cover"] = False

    # ------------------------------------------------------------------ #
    # Ammo / aiming helpers (W3-2)
    # ------------------------------------------------------------------ #
    def get_ammo(self, actor_id: str, weapon_id: str) -> int | None:
        """Current loaded ammo for a weapon, or None if the weapon has no magazine."""
        weapon = self._weapon(actor_id, weapon_id)
        magazine = weapon.get("magazine")
        if magazine is None:
            return None
        ammo_map = self.participants[actor_id].setdefault("_ammo", {})
        if weapon_id not in ammo_map:
            ammo_map[weapon_id] = int(magazine)
        return int(ammo_map[weapon_id])

    def set_ammo(self, actor_id: str, weapon_id: str, rounds: int) -> None:
        """Set loaded ammo (clamped to magazine capacity when known)."""
        weapon = self._weapon(actor_id, weapon_id)
        magazine = weapon.get("magazine")
        value = max(0, int(rounds))
        if magazine is not None:
            value = min(value, int(magazine))
        self.participants[actor_id].setdefault("_ammo", {})[weapon_id] = value

    def _consume_ammo(self, actor_id: str, weapon_id: str, count: int = 1) -> int:
        """Consume up to ``count`` rounds; return how many were actually spent."""
        current = self.get_ammo(actor_id, weapon_id)
        if current is None:
            return count  # untracked (melee / unlimited)
        spent = min(current, max(0, int(count)))
        self.set_ammo(actor_id, weapon_id, current - spent)
        return spent

    def _clear_aiming(self, actor_id: str) -> None:
        if actor_id in self.participants:
            self.participants[actor_id]["_aiming"] = False

    def _turn(self, actor_id: str, dex: int | None = None,
              dex_reason: str | None = None) -> dict[str, Any]:
        self._turn_counter += 1
        turn_id = f"t{self._current_round}-{self._turn_counter}"
        return {
            "turn_id": turn_id,
            "actor_id": actor_id,
            "dex": dex if dex is not None else self.participants[actor_id]["dex"],
            "dex_reason": dex_reason,
            "declared_intent": None,
            "action": None,
            "target_actor_id": None,
            "roll_id": None,
            "opposed_roll_id": None,
            "opposed_outcome": None,
            "defense_kind": None,
            "outcome": None,
            "effect_applied": None,
            "damage_roll_id": None,
        }

    @staticmethod
    def _damage_bindings_for_turn(turn: dict[str, Any]) -> list[dict[str, Any]]:
        """Return the canonical damage-roll ownership encoded by one turn."""
        bindings: list[dict[str, Any]] = []

        def add(
            roll_id: Any, kind: str, index: str,
            source_actor_id: Any, target_actor_id: Any,
        ) -> None:
            if isinstance(roll_id, str) and roll_id:
                bindings.append({
                    "damage_roll_id": roll_id,
                    "binding_kind": kind,
                    "binding_index": index,
                    "source_actor_id": source_actor_id,
                    "target_actor_id": target_actor_id,
                })

        actor_id = turn.get("actor_id")
        target_actor_id = turn.get("target_actor_id")
        primary_source = actor_id
        primary_target = target_actor_id
        if turn.get("outcome") == "maneuver_failed_fight_back_damage":
            primary_source, primary_target = target_actor_id, actor_id
        add(
            turn.get("damage_roll_id"), "primary", "0",
            primary_source, primary_target,
        )
        add(
            turn.get("fight_back_damage_roll_id"), "fight_back", "0",
            target_actor_id, actor_id,
        )
        for shot_index, shot in enumerate(turn.get("shots") or []):
            if isinstance(shot, dict):
                add(
                    shot.get("damage_roll_id"), "shot", str(shot_index),
                    actor_id, target_actor_id,
                )
        for volley_index, volley in enumerate(turn.get("volleys") or []):
            if not isinstance(volley, dict):
                continue
            for hit_index, roll_id in enumerate(volley.get("damage_roll_ids") or []):
                add(
                    roll_id, "volley", f"{volley_index}:{hit_index}",
                    actor_id, target_actor_id,
                )
        for target_index, target in enumerate(turn.get("suppression_targets") or []):
            if not isinstance(target, dict):
                continue
            for hit_index, roll_id in enumerate(target.get("damage_roll_ids") or []):
                add(
                    roll_id, "suppression", f"{target_index}:{hit_index}",
                    actor_id, target.get("target_actor_id"),
                )
        return bindings

    @staticmethod
    def _damage_transaction_receipt(
        *, round_number: int, turn: dict[str, Any],
        damage: dict[str, Any], binding: dict[str, Any],
    ) -> dict[str, Any]:
        """Create an independent canonical receipt for a damage transaction.

        The digest covers the complete closed damage record (apart from the
        receipt itself) plus the durable turn fields that authorize it.  Load
        reconstructs this receipt before initiative skip evidence is read.
        """
        payload = {
            "round": round_number,
            "turn": {
                "turn_id": turn.get("turn_id"),
                "actor_id": turn.get("actor_id"),
                "target_actor_id": turn.get("target_actor_id"),
                "resolution_hint": turn.get("resolution_hint"),
                "outcome": turn.get("outcome"),
                "roll_id": turn.get("roll_id"),
                "damage_roll_id": turn.get("damage_roll_id"),
                "fight_back_damage_roll_id": turn.get("fight_back_damage_roll_id"),
                "resolution_command_id": turn.get("resolution_command_id"),
            },
            "binding": dict(binding),
            "damage": {
                key: value for key, value in damage.items()
                if key != "provenance"
            },
        }
        encoded = json.dumps(
            payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
        return {
            "kind": "combat_damage_transaction_v1",
            "round": round_number,
            "turn_id": turn.get("turn_id"),
            "binding_kind": binding["binding_kind"],
            "binding_index": binding["binding_index"],
            "transaction_sha256": hashlib.sha256(encoded).hexdigest(),
        }

    @staticmethod
    def _external_damage_receipt(
        *, turn: dict[str, Any], damage: dict[str, Any],
    ) -> dict[str, Any]:
        """Build the canonical cross-file receipt for one HP transition."""
        return {
            "kind": "combat_damage_external_v1",
            "command_id": turn.get("resolution_command_id"),
            "roll_id": damage.get("damage_roll_id"),
            "source_turn_id": damage.get("source_turn_id"),
            "source_actor_id": damage.get("source_actor_id"),
            "target_actor_id": damage.get("target_actor_id"),
            "weapon_id": damage.get("weapon_id"),
            "die": damage.get("die"),
            "die_rolls": list(damage.get("die_rolls") or []),
            "raw_damage": damage.get("raw_damage"),
            "total": damage.get("raw_damage"),
            "hp_before": damage.get("hp_before"),
            "hp_delta": damage.get("hp_delta"),
            "hp_after": damage.get("hp_after"),
            "status_after": dict(damage.get("status_after") or {}),
            "internal_provenance": dict(damage.get("provenance") or {}),
        }

    def damage_evidence_rows(self, *, command_actor_id: str) -> list[dict[str, Any]]:
        """Export trusted in-memory damage evidence in canonical roll-log shape.

        This is primarily useful to component tests and embedding hosts that
        persist their own append-only evidence ledger.  Reload never derives
        these rows from ``combat.json`` itself. ``command_actor_id`` is kept
        for source compatibility, but canonical evidence attributes the roll
        to the actor that actually caused the damage.
        """
        _ = command_actor_id
        turns = {
            turn["turn_id"]: turn
            for round_row in self.rounds
            for turn in round_row.get("turns", [])
            if isinstance(turn, dict) and isinstance(turn.get("turn_id"), str)
        }
        rows: list[dict[str, Any]] = []
        for damage in self.damage_chain:
            roll_id = damage.get("damage_roll_id")
            if not isinstance(roll_id, str):
                continue
            turn = turns.get(damage.get("source_turn_id"))
            if not isinstance(turn, dict):
                raise ValueError("combat damage lacks its source turn")
            receipt = self._external_damage_receipt(turn=turn, damage=damage)
            if not isinstance(receipt["command_id"], str) or not receipt["command_id"]:
                raise ValueError("combat damage lacks a resolution command ID")
            visibility = "consequence_public"
            source_ref = f"combat:{self.combat_id}#{roll_id}"
            rows.append({
                "event_type": "roll",
                "type": "roll",
                "roll_id": roll_id,
                "actor": damage["source_actor_id"],
                "visibility": visibility,
                "source": "combat_session",
                "source_ref": source_ref,
                "command_id": receipt["command_id"],
                "payload": {
                    "event_type": "combat_roll",
                    "roll_id": roll_id,
                    "visibility": visibility,
                    "actor_id": damage["source_actor_id"],
                    "skill": "HP Damage",
                    "source_command_id": receipt["command_id"],
                    "target": damage["target_actor_id"],
                    "raw_roll": damage["raw_damage"],
                    "dice": {
                        "expression": damage["die"],
                        "raw": list(damage["die_rolls"]),
                        "total": damage["raw_damage"],
                    },
                    "combat_damage_receipt": receipt,
                },
                "ts": "trusted-in-memory",
            })
        return rows

    @staticmethod
    def _reconstruct_damage_roll(die_expr: Any, die_rolls: Any) -> int:
        """Reconstruct an ordinary damage total from its exact dice evidence."""
        if not isinstance(die_expr, str) or not die_expr or not isinstance(die_rolls, list):
            raise ValueError("combat damage roll evidence is invalid")
        rolls = iter(die_rolls)
        total = 0
        normalized = die_expr.replace("-", "+-")
        for token in (part.strip() for part in normalized.split("+") if part.strip()):
            match = re.fullmatch(r"(\d+)D(\d+)", token)
            if match:
                count, sides = int(match.group(1)), int(match.group(2))
                for _ in range(count):
                    try:
                        value = next(rolls)
                    except StopIteration as exc:
                        raise ValueError("combat damage roll evidence is invalid") from exc
                    if (
                        isinstance(value, bool) or not isinstance(value, int)
                        or value < 1 or value > sides
                    ):
                        raise ValueError("combat damage roll evidence is invalid")
                    total += value
            else:
                try:
                    total += int(token)
                except (TypeError, ValueError) as exc:
                    raise ValueError("combat damage roll evidence is invalid") from exc
        try:
            next(rolls)
        except StopIteration:
            return total
        raise ValueError("combat damage roll evidence is invalid")

    def _bind_damage_provenance(self, turn: dict[str, Any]) -> None:
        bindings = {
            row["damage_roll_id"]: row
            for row in self._damage_bindings_for_turn(turn)
        }
        for damage in self.damage_chain:
            if damage.get("source_turn_id") != turn.get("turn_id"):
                continue
            roll_id = damage.get("damage_roll_id")
            if not isinstance(roll_id, str):
                continue  # Malfunction records are validated separately.
            binding = bindings.get(roll_id)
            if binding is None:
                raise ValueError("damage roll is not owned by its combat turn")
            damage["provenance"] = self._damage_transaction_receipt(
                round_number=self._current_round,
                turn=turn,
                damage=damage,
                binding=binding,
            )

    def _roll_id(self) -> str:
        # Stable id; the harness may remap to its global roll sequence.
        self._roll_counter += 1
        return f"{self.combat_id}:cr{self._roll_counter}"

    # ------------------------------------------------------------------ #
    # Skill rolls
    # ------------------------------------------------------------------ #
    def _percentile(self, actor_id: str, skill: str, target: int, goal: str,
                    difficulty: str = "regular", bonus: int = 0, penalty: int = 0,
                    ranged: bool = False) -> tuple[str, dict[str, Any]]:
        target = max(1, min(99, target))  # Luck/etc may exceed 99; cap per rulebook
        res = coc_roll.percentile_check(target, difficulty, bonus=bonus,
                                        penalty=penalty, rng=self._rng)
        roll_id = self._roll_id()
        mod_str = ""
        if bonus or penalty:
            parts = []
            if bonus: parts.append(f"+{bonus}bonus")
            if penalty: parts.append(f"-{penalty}penalty")
            mod_str = "[" + ",".join(parts) + "]"
        tens_values = [int(value) for value in (res.get("tens_values") or [])]
        units = res.get("units")
        unmodified_roll = None
        bonus_die_only_success = False
        if (
            int(res.get("bonus") or 0) > 0
            and int(res.get("penalty") or 0) == 0
            and len(tens_values) >= 2
            and units is not None
        ):
            units_i = int(units)
            # Canonical roll selection materializes ``00`` as 100 *before*
            # choosing a bonus/penalty candidate.  Reuse its selected result;
            # raw-tens ordering would incorrectly choose 00 over 40.
            selected = int(res["roll"])
            unmodified = tens_values[0] * 10 + units_i
            if unmodified == 0:
                unmodified = 100
            bonus_die_only_success = (
                selected <= int(res["effective_target"]) < unmodified
            )
            unmodified_roll = unmodified
        elif tens_values and units is not None:
            unmodified_roll = tens_values[0] * 10 + int(units)
            if unmodified_roll == 0:
                unmodified_roll = 100
        record = {
            "roll_id": roll_id,
            "actor_id": actor_id,
            "skill": skill,
            "goal": goal,
            "target": target,
            "effective_target": res["effective_target"],
            "roll": res["roll"],
            "outcome": res["outcome"],
            "difficulty": difficulty,
            "bonus": bonus,
            "penalty": penalty,
            "effective_modifier": {
                "bonus": int(res.get("bonus") or 0),
                "penalty": int(res.get("penalty") or 0),
                "net": int(res.get("bonus") or 0) - int(res.get("penalty") or 0),
            },
            "tens_values": tens_values,
            "units": int(units) if units is not None else None,
            "unmodified_roll": unmodified_roll,
            "bonus_die_only_success": bonus_die_only_success,
            "excluded_outcome": (
                "bonus_die_only_success" if bonus_die_only_success else None
            ),
            "ranged": ranged,
            "marker": f"[roll]{actor_id} {skill}{target}{mod_str}:(d100->{res['roll']})->{res['outcome']}[/roll]",
        }
        self.pending_rolls.append(record)
        return res["outcome"], record

    def _apply_luck_to_roll(
        self,
        record: dict[str, Any],
        *,
        points: int,
        current_luck: int,
    ) -> tuple[str, dict[str, Any]]:
        """Apply a pre-authorized Luck spend without rewriting the raw die."""
        original_roll = int(record["roll"])
        adjusted = coc_roll.spend_luck(
            {
                "roll": original_roll,
                "outcome": record["outcome"],
                "target": record["target"],
                "effective_target": record.get(
                    "effective_target", record["target"]
                ),
            },
            points,
            current_luck,
            roll_kind="skill",
        )
        record["original_roll"] = original_roll
        record["adjusted_roll"] = int(adjusted["roll"])
        record["luck_spent"] = int(adjusted["luck_spent"])
        record["luck_remaining"] = int(adjusted["luck_remaining"])
        record["outcome"] = str(adjusted["outcome"])
        record["improvement_tick_eligible"] = False
        record["rule_ref"] = "core.optional.spending_luck"
        record["marker"] = (
            f"[roll]{record['actor_id']} {record['skill']}{record['target']}:"
            f"(d100->{original_roll}; Luck-{points}->{record['adjusted_roll']})"
            f"->{record['outcome']}[/roll]"
        )
        event = {
            "event_type": "combat_luck_spent",
            "actor_id": record["actor_id"],
            "source_roll_id": record["roll_id"],
            "original_roll": original_roll,
            "adjusted_roll": record["adjusted_roll"],
            "luck_spent": points,
            "luck_before": current_luck,
            "luck_after": adjusted["luck_remaining"],
            "outcome": record["outcome"],
            "rule_ref": "core.optional.spending_luck",
        }
        self.pending_events.append(event)
        return record["outcome"], event

    def _apply_opposed_luck_precommit(
        self,
        *,
        attacker_id: str,
        defender_id: str,
        attack_outcome: str,
        attack_record: dict[str, Any],
        defense_outcome: str,
        defense_record: dict[str, Any],
        opposed_kind: str,
        luck_precommit: dict[str, Any] | None,
    ) -> tuple[str, str, str, dict[str, Any] | None]:
        """Spend the minimum authorized Luck that changes the opposed result.

        Luck is never spent speculatively when the investigator already has a
        favorable result or when the authorized cap cannot change the outcome.
        """
        opposed = self._resolve_opposed(
            attack_outcome, defense_outcome, opposed_kind
        )
        if not isinstance(luck_precommit, dict):
            return attack_outcome, defense_outcome, opposed, None
        luck_actor = luck_precommit.get("actor_id")
        if luck_actor == attacker_id:
            record = attack_record
            actor_is_attacker = True
        elif luck_actor == defender_id:
            record = defense_record
            actor_is_attacker = False
        else:
            return attack_outcome, defense_outcome, opposed, None

        attacker_wins = {"attacker_higher", "tie_attacker_wins"}
        currently_favorable = (
            opposed in attacker_wins
            if actor_is_attacker
            else opposed not in attacker_wins
        )
        if currently_favorable or record.get("outcome") in {"critical", "fumble"}:
            return attack_outcome, defense_outcome, opposed, None

        current_luck = int(luck_precommit.get("current_luck", 0))
        cap = min(int(luck_precommit.get("max_points", 0)), current_luck)
        original_roll = int(record["roll"])
        max_points = min(cap, original_roll - 2)
        effective_target = int(
            record.get("effective_target", record.get("target", 0))
        )
        chosen: tuple[int, str, str] | None = None
        for points in range(1, max_points + 1):
            candidate = coc_rules.success_level(
                original_roll - points, effective_target
            )
            candidate_attack = candidate if actor_is_attacker else attack_outcome
            candidate_defense = candidate if not actor_is_attacker else defense_outcome
            candidate_opposed = self._resolve_opposed(
                candidate_attack, candidate_defense, opposed_kind
            )
            favorable = (
                candidate_opposed in attacker_wins
                if actor_is_attacker
                else candidate_opposed not in attacker_wins
            )
            if favorable:
                chosen = (points, candidate, candidate_opposed)
                break
        if chosen is None:
            return attack_outcome, defense_outcome, opposed, None

        points, _candidate, chosen_opposed = chosen
        adjusted_outcome, event = self._apply_luck_to_roll(
            record, points=points, current_luck=current_luck
        )
        if actor_is_attacker:
            attack_outcome = adjusted_outcome
        else:
            defense_outcome = adjusted_outcome
        return attack_outcome, defense_outcome, chosen_opposed, event

    def _weapon_db_expr(self, attacker: dict, weapon: dict,
                        half: bool | None = None) -> str | None:
        """Return the attacker's DB expression if the weapon adds DB (melee),
        else None. Per Table XVII (pp.401-405), melee weapons add the attacker's
        damage bonus; firearms do not. Thrown/missile weapons that rely on
        strength use half DB (p.108). The DB comes from the participant's
        `damage_bonus` field (e.g. '+1D4', '-2', 'none').

        When ``half`` is True (or the weapon special notes half DB), the
        expression is tagged ``half:EXPR`` so ``_damage_roll`` halves the roll.
        """
        if not weapon.get("adds_damage_bonus", False):
            return None
        db = attacker.get("damage_bonus", "none")
        if not db or str(db).lower() in ("none", "0", ""):
            return None
        special = str(weapon.get("special") or "").lower()
        skill = str(weapon.get("skill") or "")
        use_half = half if half is not None else (
            "half db" in special or "half damage bonus" in special
            or skill.startswith("Throw")
        )
        expr = str(db)
        if use_half:
            return f"half:{expr}"
        return expr

    def _check_malfunction(self, actor_id: str, weapon: dict, roll_value: int,
                           turn_id: str) -> dict[str, Any] | None:
        """Firearm malfunction check (Table XVII, p.401).

        If the weapon has a ``malfunction`` number (non-null) and the attack
        ``roll_value`` is greater than or equal to it, the weapon jams: it
        becomes unusable until repaired, and a ``malfunction_event`` record is
        appended to the damage_chain. Returns the event dict, or None when no
        malfunction applies.

        Per Table XVII the malfunction is keyed to the percentile attack roll,
        independent of the hit/miss outcome — a roll at or above the number
        jams the gun even if it would otherwise have hit.
        """
        malf = weapon.get("malfunction")
        if malf is None:
            return None
        try:
            threshold = int(malf)
        except (TypeError, ValueError):
            return None
        if roll_value < threshold:
            return None
        # Jam: weapon unusable until repaired.
        weapon_id = weapon.get("weapon_id", "")
        jam_key = f"{actor_id}:{weapon_id}"
        self.jammed_weapons.add(jam_key)
        event = {
            "malfunction_roll_id": self._roll_id(),
            "source_turn_id": turn_id,
            "source_actor_id": actor_id,
            "weapon_id": weapon_id,
            "weapon_display_name": weapon.get("display_name", weapon_id),
            "roll": roll_value,
            "malfunction_threshold": threshold,
            "effect": "jammed_until_repaired",
            "marker": (f"[malfunction]{weapon_id} roll {roll_value} >= {threshold}: "
                       f"jammed, unusable until repaired[/malfunction]"),
        }
        self.damage_chain.append(event)
        self.pending_events.append({
            "event_type": "weapon_malfunction",
            "actor_id": actor_id,
            "weapon_id": weapon_id,
            "roll": roll_value,
            "threshold": threshold,
            "summary": f"{actor_id} {weapon_id} malfunction (roll {roll_value} >= {threshold}); jammed.",
        })
        return event

    def _damage_roll(self, die_expr: str, source_actor_id: str,
                     target_actor_id: str, weapon_id: str,
                     source_turn_id: str,
                     bypass_armor: bool = False,
                     rulebook_exception: str | None = None,
                     db_expr: str | None = None) -> tuple[int, str, dict[str, Any]]:
        """Resolve a damage expression and append to damage_chain.

        Supports NdS, NdS+M, and NdS+NdS (e.g. 1D3+1D4 for claw+DB).
        If db_expr is provided (e.g. "+1D4" from the attacker's damage bonus,
        for melee weapons per Table XVII), it is appended to the die expression
        and rolled as additional dice. If bypass_armor is True (e.g. ritual
        dagger bypassing Flesh Ward per module rule), armor is ignored entirely
        and rulebook_exception is stamped on the damage record.
        Returns (raw_damage, roll_id, record).
        """
        full_expr = die_expr
        half_db_meta: dict[str, Any] | None = None
        if db_expr:
            # Normalize "+1D4" → append; "-2" → append; "none"/"0" → skip.
            # "half:+1D4" → roll DB then halve (thrown/missile, p.108).
            db = db_expr.strip()
            use_half = False
            if db.lower().startswith("half:"):
                use_half = True
                db = db[5:].strip()
            if db and db.lower() not in ("none", "0"):
                if not db.startswith(("+", "-")):
                    db = "+" + db
                if use_half:
                    db_token = db[1:] if db.startswith("+") else db
                    db_raw, db_rolls, _ = self._roll_damage_expr(db_token)
                    half_val = db_raw // 2
                    half_db_meta = {"db_raw": db_raw, "db_rolls": db_rolls, "half": half_val}
                    if half_val != 0:
                        full_expr = f"{die_expr}{half_val:+d}"
                else:
                    full_expr = f"{die_expr}{db}"
        raw, die_rolls, breakdown = self._roll_damage_expr(full_expr)
        roll_id = self._roll_id()
        target = self.participants[target_actor_id]
        hp_before = target["hp_current"]
        armor_before = target["armor"]
        armor_rule = target["armor_rule"]
        # Apply armor (Flesh Ward degrades 1:1; fixed absorbs up to its value).
        # bypass_armor skips armor entirely (module-specific overrides).
        absorbed = 0
        remaining = raw
        if bypass_armor:
            absorbed = 0
        elif armor_before > 0:
            absorbed = min(armor_before, remaining)
            remaining -= absorbed
            if armor_rule == "degrades_1_per_damage":
                target["armor"] = max(0, armor_before - absorbed)
        hp_after = max(0, hp_before - remaining)
        hp_delta = hp_after - hp_before
        target["hp_current"] = hp_after
        # p.113 Aiming: taking damage while aiming loses the advantage.
        if remaining > 0:
            self._clear_aiming(target_actor_id)
        record = {
            "damage_roll_id": roll_id,
            "source_turn_id": source_turn_id,
            "source_actor_id": source_actor_id,
            "target_actor_id": target_actor_id,
            "weapon_id": weapon_id,
            "die": full_expr,
            "die_rolls": die_rolls,
            "raw_damage": raw,
            "hp_before": hp_before,
            "hp_delta": hp_delta,
            "hp_after": hp_after,
            "armor_absorbed": absorbed,
            "armor_before": armor_before,
            "armor_after": target["armor"],
            "rulebook_exception": rulebook_exception,
            "bypass_armor": bypass_armor,
            "half_damage_bonus": half_db_meta,
            "marker": f"[roll]{die_expr}:{breakdown}->{raw}:damage[/roll]",
        }
        self.damage_chain.append(record)
        self.pending_rolls.append({
            "roll_id": roll_id,
            "actor_id": source_actor_id,
            "skill": "HP Damage",
            "goal": f"damage {target_actor_id} with {weapon_id}",
            "die": die_expr,
            "roll": raw,
            "die_rolls": die_rolls,
            "outcome": "damage_applied",
            "marker": record["marker"],
        })
        return raw, roll_id, record

    def _roll_damage_expr(self, die_expr: str) -> tuple[int, list[int], str]:
        """Returns (total, all_dice, breakdown_str).

        Supports NdS+NdS+M and NdS-M forms (negative modifiers like DB -1).
        """
        # Normalize: convert leading '-' to '+-' so split('+') handles negatives.
        normalized = die_expr.replace("-", "+-")
        parts = [p.strip() for p in normalized.split("+") if p.strip()]
        total = 0
        all_dice: list[int] = []
        breakdown_parts: list[str] = []
        for part in parts:
            m = re.fullmatch(r"(\d+)D(\d+)", part)
            if m:
                n, sides = int(m.group(1)), int(m.group(2))
                rolls = [self._rng.randint(1, sides) for _ in range(n)]
                all_dice.extend(rolls)
                s = sum(rolls)
                total += s
                breakdown_parts.append(f"{part}({'+' .join(map(str, rolls))}={s})")
            else:
                # Plain integer modifier
                try:
                    mod = int(part)
                    total += mod
                    breakdown_parts.append(f"{mod}")
                except ValueError:
                    raise ValueError(f"unsupported damage token: {part!r} in {die_expr!r}")
        return total, all_dice, "+".join(breakdown_parts)

    def _max_damage_for_expr(self, die_expr: str) -> int:
        """Maximum possible roll for a die expression (e.g. '1D4+2' → 6, '1D3+1D4' → 7, '1D4-1' → 3)."""
        total = 0
        normalized = die_expr.replace("-", "+-")
        for part in normalized.split("+"):
            part = part.strip()
            m = re.fullmatch(r"(\d+)D(\d+)", part)
            if m:
                n, sides = int(m.group(1)), int(m.group(2))
                total += n * sides
            else:
                try:
                    total += int(part)
                except ValueError:
                    pass  # ignore unknown tokens
        return total

    def _apply_extreme_damage(self, dmg_rec: dict, weapon: dict, attacker: dict) -> None:
        """Apply Extreme-success damage per rulebook p.115.

        Non-impaling weapon (fist/club): max weapon damage + max DB (no roll).
        Impaling weapon (blade/bullet): max weapon damage + max DB + one extra
        weapon-damage roll.

        Modifies the damage_chain record in place: updates raw_damage, hp
        bookkeeping (hp_before/delta/after), armor absorption, and stamps
        impale_or_max + extreme_damage_breakdown.
        """
        weapon_id = dmg_rec.get("weapon_id", "unknown")
        target_id = dmg_rec.get("target_actor_id")
        target = self.participants.get(target_id)
        if not target:
            return

        weapon_max = self._max_damage_for_expr(weapon["damage"])
        db_expr = self._weapon_db_expr(attacker, weapon)
        db_max = self._max_damage_for_expr(db_expr) if db_expr else 0
        is_impale = weapon.get("impales", False)

        # Base extreme damage: max weapon + max DB.
        extreme_raw = weapon_max + db_max
        breakdown = f"extreme: max_weapon({weapon_max})+max_db({db_max})"

        # Impale: add one extra weapon-damage roll (p.119 example).
        extra_roll = 0
        if is_impale:
            extra_raw, extra_dice, _ = self._roll_damage_expr(weapon["damage"])
            extreme_raw += extra_raw
            breakdown += f"+impale_extra_roll({extra_raw})"

        # Re-apply armor to the new raw damage.
        hp_before = dmg_rec["hp_before"]
        armor_before = dmg_rec.get("armor_before", target.get("armor", 0))
        armor_rule = target.get("armor_rule")
        bypass = dmg_rec.get("bypass_armor", False)
        absorbed = 0
        remaining = extreme_raw
        if not bypass and armor_before > 0:
            absorbed = min(armor_before, remaining)
            remaining -= absorbed
            if armor_rule == "degrades_1_per_damage":
                # Restore armor to before-state (undo the original roll's
                # degradation), then re-degrade from the extreme damage.
                target["armor"] = armor_before
                target["armor"] = max(0, armor_before - absorbed)
        hp_after = max(0, hp_before - remaining)
        hp_delta = hp_after - hp_before
        target["hp_current"] = hp_after

        dmg_rec["raw_damage"] = extreme_raw
        dmg_rec["hp_delta"] = hp_delta
        dmg_rec["hp_after"] = hp_after
        dmg_rec["armor_absorbed"] = absorbed
        dmg_rec["armor_after"] = target["armor"]
        dmg_rec["impale_or_max"] = True
        dmg_rec["extreme_damage"] = True
        dmg_rec["extreme_breakdown"] = breakdown
        dmg_rec["is_impale"] = is_impale

    # ------------------------------------------------------------------ #
    # Opposed resolution (p.115)
    # ------------------------------------------------------------------ #
    @staticmethod
    def _resolve_opposed(atk_lvl: str, def_lvl: str, defense_kind: str) -> str:
        """Per p.115. fight_back tie → attacker wins; dodge tie → defender wins."""
        a, d = LVL[atk_lvl], LVL[def_lvl]
        if a <= LVL["failure"] and d <= LVL["failure"]:
            return "both_fail"
        if a > d:
            return "attacker_higher"
        if d > a:
            return "defender_higher"
        # tie (and at least one succeeded)
        if defense_kind == "dodge":
            return "tie_defender_wins"
        return "tie_attacker_wins"

    # ------------------------------------------------------------------ #
    # Turn dispatch — semantic model (intent + resolution_hint)
    # ------------------------------------------------------------------ #
    # The rulebook's model (p.114 Declaration of Intent): the player describes
    # what they want to do in natural language; the Keeper decides which dice
    # mechanism resolves it. We mirror that here. The caller passes the open-
    # ended ``declared_intent`` (any text) plus a ``resolution_hint`` that
    # names the *dice mechanism* (one of a small finite set). The engine
    # routes on resolution_hint, never on the intent text. An optional ``goal``
    # names the structured effect for a successful maneuver (disarm /
    # ongoing_disadvantage / escape / push — per p.119).
    VALID_RESOLUTION_HINTS = {
        "skill_check", "opposed_melee", "firearm_attack", "surprise_attack",
        "maneuver", "damage_only", "spell", "sanity_check",
        "characteristic_roll", "flee", "aim", "reload",
    }
    VALID_MANEUVER_GOALS = {"disarm", "ongoing_disadvantage", "escape", "push"}
    # Legacy SKILL.md names → rulebook p.119 goals.
    _MANEUVER_GOAL_ALIASES = {
        "grapple": "ongoing_disadvantage",
        "break_free": "escape",
        "other": "push",
        "restrain": "ongoing_disadvantage",
        "knockdown": "push",
    }

    # Backward-compat mapping: the old `action` enum maps to resolution_hint.
    _ACTION_TO_HINT = {
        "attack": None,  # decided by weapon skill (melee vs firearm)
        "surprise_attack": "surprise_attack",
        "maneuver": "maneuver",
        "cast": "spell",
        "flee": "flee",
        "other": "skill_check",
        "aim": "aim",
        "reload": "reload",
    }

    def declare_and_resolve_turn(self, actor_id: str, declared_intent: str,
                                 action: str | None = None,
                                 target_actor_id: str | None = None,
                                 defense_kind: str | None = None,
                                 weapon_id: str | None = None,
                                 spell: str | None = None,
                                 dex_override: int | None = None,
                                 dex_reason: str | None = None,
                                 rulebook_exception: str | None = None,
                                 range_band: str | None = None,
                                 point_blank: bool = False,
                                 cover: bool = False,
                                 fast_moving: bool = False,
                                 maneuver_kind: str | None = None,
                                 target_weapon_id: str | None = None,
                                 resolution_hint: str | None = None,
                                 goal: str | None = None,
                                 skill: str | None = None,
                                 target_value: int | None = None,
                                 difficulty: str = "regular",
                                 shots: int | None = None,
                                 fire_mode: str | None = None,
                                 rounds_fired: int | None = None,
                                 load_and_fire: bool = False,
                                 suppress_targets: list[str] | None = None,
                                 dive_for_cover_actors: list[str] | None = None,
                                 defender_goal: str | None = None,
                                 luck_precommit: dict[str, Any] | None = None,
                                 resolution_command_id: str | None = None) -> dict[str, Any]:
        """Resolve one combatant's turn per the rulebook's semantic model.

        The primary inputs are ``declared_intent`` (open-ended natural language
        — what the character wants to achieve) and ``resolution_hint`` (the
        Keeper's judgment of which dice mechanism applies). The legacy
        ``action`` parameter is still accepted for backward compatibility and
        is mapped to a resolution_hint when ``resolution_hint`` is not given.

        For maneuvers, ``goal`` names the structured effect on success
        (disarm / ongoing_disadvantage / escape / push, per p.119). The old
        ``maneuver_kind`` is treated as an alias for ``goal``.

        Firearms depth (W3-2 / pp.113-114, p.126):
        - ``shots``: handgun multi-shot count (each shot gets 1 penalty die when ≥2)
        - ``fire_mode``: ``full_auto`` / ``suppressive`` / None (semi)
        - ``rounds_fired``: bullets expended on full auto
        - ``load_and_fire``: load one chamber and fire same round (penalty die)
        - ``suppress_targets`` / ``dive_for_cover_actors``: suppressing fire
        """
        # Reconcile resolution_hint with legacy action.
        if resolution_hint is None:
            if action is None:
                raise ValueError("provide either resolution_hint or action")
            if action not in self._ACTION_TO_HINT and action not in VALID_ACTIONS:
                raise ValueError(f"invalid action {action!r}")
            # For 'attack', decide melee vs firearm from the weapon.
            if action == "attack":
                weapon = self._weapon(actor_id, weapon_id) if weapon_id or self.participants[actor_id]["weapons"] else {}
                skill_name = str(weapon.get("skill", ""))
                if skill_name.startswith("Firearms"):
                    resolution_hint = "firearm_attack"
                elif skill_name.startswith("Throw"):
                    resolution_hint = "opposed_melee"  # thrown: Dodgeable (W3-4)
                else:
                    resolution_hint = "opposed_melee"
            else:
                resolution_hint = self._ACTION_TO_HINT.get(action, action)
        if resolution_hint not in self.VALID_RESOLUTION_HINTS:
            raise ValueError(f"invalid resolution_hint {resolution_hint!r}")
        if defense_kind not in VALID_DEFENSE:
            raise ValueError(f"invalid defense_kind {defense_kind!r}")
        # maneuver_kind (legacy) aliases goal; map SKILL.md aliases → p.119 set.
        if goal is None and maneuver_kind is not None:
            goal = maneuver_kind
        if goal is not None:
            goal = self._MANEUVER_GOAL_ALIASES.get(goal, goal)
            if goal not in self.VALID_MANEUVER_GOALS:
                raise ValueError(f"invalid goal {goal!r}; expected one of {self.VALID_MANEUVER_GOALS}")
        if defender_goal is not None:
            defender_goal = self._MANEUVER_GOAL_ALIASES.get(defender_goal, defender_goal)
            if defender_goal not in self.VALID_MANEUVER_GOALS:
                raise ValueError(
                    f"invalid defender_goal {defender_goal!r}; expected one of {self.VALID_MANEUVER_GOALS}")

        turn = self._turn(actor_id, dex=dex_override, dex_reason=dex_reason)
        turn["declared_intent"] = declared_intent
        turn["resolution_hint"] = resolution_hint
        turn["action"] = action or resolution_hint  # backward-compat field
        turn["target_actor_id"] = target_actor_id
        if resolution_command_id is not None:
            if not isinstance(resolution_command_id, str) or not resolution_command_id:
                raise ValueError("resolution_command_id must be a non-empty string")
            turn["resolution_command_id"] = resolution_command_id
        if goal:
            turn["goal"] = goal
        # Mechanism 4: outnumbered — if target already defended this round,
        # this attacker gets a bonus die.
        outnumbered_penalty = bool(target_actor_id and self.has_defended_this_round(target_actor_id))

        try:
            if resolution_hint == "spell":
                self._resolve_cast(turn, actor_id, target_actor_id, spell)
            elif resolution_hint == "aim":
                self._resolve_aim(turn, actor_id, weapon_id)
            elif resolution_hint == "reload":
                self._resolve_reload(turn, actor_id, weapon_id)
            elif resolution_hint in ("opposed_melee", "firearm_attack"):
                self._resolve_attack(turn, actor_id, target_actor_id,
                                     defense_kind, weapon_id, rulebook_exception,
                                     range_band=range_band, point_blank=point_blank,
                                     cover=cover, fast_moving=fast_moving,
                                     outnumbered_penalty=outnumbered_penalty,
                                     shots=shots, fire_mode=fire_mode,
                                     rounds_fired=rounds_fired,
                                     load_and_fire=load_and_fire,
                                     suppress_targets=suppress_targets,
                                     dive_for_cover_actors=dive_for_cover_actors,
                                     defender_goal=defender_goal,
                                     luck_precommit=luck_precommit)
            elif resolution_hint == "surprise_attack":
                self._resolve_surprise_attack(turn, actor_id, target_actor_id, weapon_id)
            elif resolution_hint == "maneuver":
                self._resolve_maneuver(turn, actor_id, target_actor_id, defense_kind,
                                       goal=goal or "ongoing_disadvantage",
                                       target_weapon_id=target_weapon_id,
                                       outnumbered_penalty=outnumbered_penalty,
                                       defender_goal=defender_goal)
            elif resolution_hint == "flee":
                self._resolve_flee(turn, actor_id)
            elif resolution_hint == "skill_check":
                self._resolve_skill_check(turn, actor_id, skill or "Spot Hidden",
                                          target_value or 50, difficulty, declared_intent)
            elif resolution_hint == "characteristic_roll":
                self._resolve_characteristic(turn, actor_id, skill or "STR",
                                             target_value or 50, declared_intent)
            elif resolution_hint == "sanity_check":
                self._resolve_sanity(turn, actor_id, target_actor_id, target_value,
                                     declared_intent)
            elif resolution_hint == "damage_only":
                self._resolve_damage_only(turn, actor_id, target_actor_id,
                                          weapon_id, rulebook_exception)
            elif resolution_hint == "other":
                turn["outcome"] = "other"
            self._update_conditions(target_actor_id)
            # Bind every damage record from this turn to the exact durable
            # status it produced.  Initiative skip receipts later reference
            # this canonical history instead of trusting a free-standing HP
            # and conditions copy.
            for damage in self.damage_chain:
                if damage.get("source_turn_id") != turn["turn_id"]:
                    continue
                damaged_id = damage.get("target_actor_id")
                damaged = self.participants.get(damaged_id)
                if isinstance(damaged, dict):
                    damage["status_after"] = {
                        "hp_current": damaged["hp_current"],
                        "conditions": list(damaged["conditions"]),
                    }
            self._bind_damage_provenance(turn)
            self.rounds[-1]["turns"].append(turn)
            return turn
        finally:
            pass

    def _resolve_aim(self, turn, actor_id, weapon_id):
        """p.113 Aiming: spend this round aiming; next shot gains +1 bonus die."""
        attacker = self.participants[actor_id]
        attacker["_aiming"] = True
        turn["defense_kind"] = "none"
        turn["opposed_outcome"] = "unopposed"
        turn["outcome"] = "aiming"
        turn["weapon_id"] = weapon_id
        turn["effect_applied"] = {"effect": "aiming", "target_actor_id": actor_id}

    def _resolve_reload(self, turn, actor_id, weapon_id):
        """p.113 Reloading Firearms: spend reload_rounds to restore magazine."""
        if not weapon_id:
            # Default to first weapon with a magazine.
            for w in self.participants[actor_id]["weapons"]:
                wid = w.get("weapon_id") if isinstance(w, dict) else w
                if self._weapon(actor_id, wid).get("magazine") is not None:
                    weapon_id = wid
                    break
        weapon = self._weapon(actor_id, weapon_id)
        magazine = weapon.get("magazine")
        if magazine is None:
            turn["outcome"] = "reload_not_applicable"
            turn["defense_kind"] = "none"
            turn["opposed_outcome"] = "unopposed"
            return
        reload_rounds = int(weapon.get("reload_rounds") or 1)
        ammo_per = int(weapon.get("ammo_per_reload_round") or magazine)
        remaining_map = self.participants[actor_id].setdefault("_reload_remaining", {})
        left = remaining_map.get(weapon_id)
        if left is None:
            left = reload_rounds
        left -= 1
        current = self.get_ammo(actor_id, weapon_id) or 0
        loaded = min(int(magazine) - current, ammo_per)
        self.set_ammo(actor_id, weapon_id, current + loaded)
        turn["defense_kind"] = "none"
        turn["opposed_outcome"] = "unopposed"
        turn["weapon_id"] = weapon_id
        turn["ammo_loaded"] = loaded
        turn["ammo_after"] = self.get_ammo(actor_id, weapon_id)
        # Aiming is lost if the character does something other than hold aim;
        # reloading counts as another action.
        self._clear_aiming(actor_id)
        if left <= 0 or self.get_ammo(actor_id, weapon_id) >= int(magazine):
            remaining_map.pop(weapon_id, None)
            turn["outcome"] = "reload_complete"
        else:
            remaining_map[weapon_id] = left
            turn["outcome"] = "reload_in_progress"
            turn["reload_rounds_remaining"] = left

    def _firearm_skill_value(self, attacker: dict, weapon: dict) -> int:
        """Prefer firearms_skill when the weapon is a firearm; else combat_skill."""
        if str(weapon.get("skill", "")).startswith("Firearms"):
            return int(attacker.get("firearms_skill") or attacker["combat_skill"])
        if str(weapon.get("skill", "")).startswith("Throw"):
            return int(attacker.get("throw_skill") or attacker["combat_skill"])
        return int(attacker["combat_skill"])

    def _apply_prone_and_aim_modifiers(self, attacker, target, is_firearm, is_thrown,
                                       is_melee, point_blank, atk_bonus, atk_penalty,
                                       mods: dict) -> tuple[int, int]:
        """Prone (p.127-128) and aiming (p.113) modifiers."""
        # Aiming bonus consumed on the shot.
        if attacker.get("_aiming") and (is_firearm or is_thrown):
            atk_bonus += 1
            mods["aimed"] = True
            attacker["_aiming"] = False
        # Prone shooter gets +1 on Firearms (p.128).
        if is_firearm and "prone" in attacker.get("conditions", []):
            atk_bonus += 1
            mods["prone_shooter"] = True
        if target is not None:
            target_prone = "prone" in target.get("conditions", [])
            if target_prone and is_melee:
                atk_bonus += 1
                mods["vs_prone_melee"] = True
            if target_prone and is_firearm and not point_blank:
                atk_penalty += 1
                mods["vs_prone_ranged"] = True
        return atk_bonus, atk_penalty

    def _resolve_attack(self, turn, actor_id, target_id, defense_kind, weapon_id,
                        rulebook_exception, range_band=None, point_blank=False,
                        cover=False, fast_moving=False, outnumbered_penalty=False,
                        shots=None, fire_mode=None, rounds_fired=None,
                        load_and_fire=False, suppress_targets=None,
                        dive_for_cover_actors=None, defender_goal=None,
                        luck_precommit=None):
        """Resolve one attack turn per Chapter 6 (+ W3-2 firearms depth).

        Firearms attacks (skill starts with 'Firearms') are unopposed — the
        target cannot fight back or dodge (p.125); they may only Dive for
        Cover. Thrown weapons (Throw skill) may be Dodged and use half DB
        (p.108). Melee attacks (Fighting) are opposed: fight_back / dodge /
        maneuver counter (p.115, p.117).
        """
        attacker = self.participants[actor_id]
        weapon = self._weapon(actor_id, weapon_id)
        wid = weapon.get("weapon_id") or weapon_id
        skill_name = str(weapon.get("skill", ""))
        is_firearm = skill_name.startswith("Firearms")
        is_thrown = skill_name.startswith("Throw")
        is_melee = (not is_firearm) and (not is_thrown)

        # --- Suppressive fire (p.126) ---
        if fire_mode == "suppressive" and is_firearm:
            self._resolve_suppressive_fire(
                turn, actor_id, weapon, wid,
                suppress_targets or [], dive_for_cover_actors or [],
                range_band=range_band, point_blank=point_blank, cover=cover,
                fast_moving=fast_moving, rounds_fired=rounds_fired)
            return

        # --- Full auto volleys (p.114-116) ---
        if fire_mode == "full_auto" and is_firearm:
            self._resolve_full_auto(
                turn, actor_id, target_id, weapon, wid, defense_kind,
                rulebook_exception, range_band=range_band, point_blank=point_blank,
                cover=cover, fast_moving=fast_moving,
                rounds_fired=rounds_fired or 0)
            return

        # --- uses_per_round + multi-shot handguns (p.113) ---
        uses = parse_uses_per_round(weapon.get("uses_per_round"))
        n_shots = int(shots) if shots is not None else 1
        if is_firearm and n_shots > 1:
            max_shots = uses["max_shots"]
            if max_shots <= 0 or n_shots > max_shots:
                raise ValueError(
                    f"shots={n_shots} exceeds uses_per_round max_shots={max_shots} "
                    f"for {wid} ({weapon.get('uses_per_round')!r})")
            self._resolve_multi_shot(
                turn, actor_id, target_id, weapon, wid, defense_kind,
                rulebook_exception, n_shots=n_shots, range_band=range_band,
                point_blank=point_blank, cover=cover, fast_moving=fast_moving,
                outnumbered_penalty=outnumbered_penalty,
                load_and_fire=load_and_fire)
            return

        # --- Ammo gate ---
        if is_firearm and weapon.get("magazine") is not None and not load_and_fire:
            ammo = self.get_ammo(actor_id, wid)
            if ammo is not None and ammo <= 0:
                turn["defense_kind"] = "none"
                turn["opposed_outcome"] = "unopposed"
                turn["outcome"] = "out_of_ammo"
                turn["attack_modifiers"] = {"bonus": 0, "penalty": 0}
                return
        if load_and_fire and is_firearm:
            # p.113: put one round in chamber and fire same round with penalty.
            self.set_ammo(actor_id, wid, max(self.get_ammo(actor_id, wid) or 0, 0) + 1)

        # --- Compute attacker bonus/penalty dice ---
        atk_bonus = 0
        atk_penalty = 0
        mods: dict[str, Any] = {
            "range_band": range_band, "point_blank": point_blank,
            "cover": cover, "outnumbered_penalty": outnumbered_penalty,
        }
        target = self.participants[target_id] if target_id else None
        if is_firearm or is_thrown:
            if point_blank and is_firearm:
                atk_bonus += 1
            if cover:
                atk_penalty += 1
            if fast_moving:
                atk_penalty += 1
        if outnumbered_penalty and is_melee:
            atk_bonus += 1
        if load_and_fire:
            atk_penalty += 1
            mods["load_and_fire"] = True
        atk_bonus, atk_penalty = self._apply_prone_and_aim_modifiers(
            attacker, target, is_firearm, is_thrown, is_melee,
            point_blank, atk_bonus, atk_penalty, mods)

        difficulty = "regular"
        if (is_firearm or is_thrown) and range_band == "long":
            difficulty = "hard"
        elif (is_firearm or is_thrown) and range_band == "very_long":
            difficulty = "extreme"

        skill_value = self._firearm_skill_value(attacker, weapon)
        atk_oc, atk_rec = self._percentile(
            actor_id, weapon["skill"], skill_value,
            f"attack {target_id}", difficulty=difficulty,
            bonus=atk_bonus, penalty=atk_penalty,
            ranged=is_firearm or is_thrown)
        turn["roll_id"] = atk_rec["roll_id"]
        mods["bonus"] = atk_bonus
        mods["penalty"] = atk_penalty
        turn["attack_modifiers"] = mods

        if is_firearm:
            malfunction_event = self._check_malfunction(
                actor_id, weapon, atk_rec["roll"], turn["turn_id"])
            if malfunction_event is not None:
                turn["malfunction"] = malfunction_event
            self._consume_ammo(actor_id, wid, 1)

        # Firearms: only dive_for_cover / none (p.125)
        if is_firearm and defense_kind not in ("dive_for_cover", "none", None):
            defense_kind = "dive_for_cover"

        # Thrown: may Dodge; fight_back only at point-blank (DEX/5 feet) (p.108)
        if is_thrown and defense_kind == "fight_back" and not point_blank:
            defense_kind = "dodge"

        if defense_kind in (None, "none"):
            turn["defense_kind"] = "none"
            turn["opposed_outcome"] = "unopposed"
            if LVL[atk_oc] >= LVL["regular"]:
                turn["outcome"] = "hit"
                bypass = rulebook_exception is not None
                _, dmg_id, _ = self._damage_roll(
                    weapon["damage"], actor_id, target_id, wid, turn["turn_id"],
                    bypass_armor=bypass, rulebook_exception=rulebook_exception,
                    db_expr=self._weapon_db_expr(attacker, weapon))
                turn["damage_roll_id"] = dmg_id
            else:
                turn["outcome"] = "miss"
            if target_id:
                self._mark_defended(target_id)
            return

        if defense_kind == "dive_for_cover":
            turn["defense_kind"] = "dive_for_cover"
            dodge_target = target.get("dodge_skill") or target["combat_skill"]
            def_oc, def_rec = self._percentile(target_id, "Dodge", dodge_target,
                                               f"dive for cover vs {actor_id}")
            turn["opposed_roll_id"] = def_rec["roll_id"]
            if LVL[def_oc] >= LVL["regular"]:
                turn["opposed_outcome"] = "dived_for_cover"
                atk_oc2, atk_rec2 = self._percentile(
                    actor_id, weapon["skill"], skill_value,
                    f"re-attack {target_id} after dive for cover",
                    difficulty=difficulty, bonus=atk_bonus,
                    penalty=atk_penalty + 1, ranged=True)
                turn["cover_reroll_roll_id"] = atk_rec2["roll_id"]
                self._mark_dived_for_cover(target_id)
                if LVL[atk_oc2] >= LVL["regular"]:
                    turn["outcome"] = "hit_after_cover"
                    bypass = rulebook_exception is not None
                    _, dmg_id, _ = self._damage_roll(
                        weapon["damage"], actor_id, target_id, wid, turn["turn_id"],
                        bypass_armor=bypass, rulebook_exception=rulebook_exception,
                        db_expr=self._weapon_db_expr(attacker, weapon))
                    turn["damage_roll_id"] = dmg_id
                else:
                    turn["outcome"] = "miss_cover"
            else:
                turn["opposed_outcome"] = "dive_failed"
                if LVL[atk_oc] >= LVL["regular"]:
                    turn["outcome"] = "hit"
                    bypass = rulebook_exception is not None
                    _, dmg_id, _ = self._damage_roll(
                        weapon["damage"], actor_id, target_id, wid, turn["turn_id"],
                        bypass_armor=bypass, rulebook_exception=rulebook_exception,
                        db_expr=self._weapon_db_expr(attacker, weapon))
                    turn["damage_roll_id"] = dmg_id
                else:
                    turn["outcome"] = "miss"
            self._mark_defended(target_id)
            return

        # Melee / thrown opposed resolution (p.115); defender may counter with maneuver (p.117)
        turn["defense_kind"] = defense_kind
        if defense_kind == "maneuver":
            def_goal = defender_goal or "ongoing_disadvantage"
            turn["defender_goal"] = def_goal
            def_oc, def_rec = self._percentile(target_id, "Fighting",
                                               target["combat_skill"],
                                               f"maneuver counter ({def_goal}) vs {actor_id}")
            # Resolve like fight_back for ties (attacker wins ties on their attack).
            opp_kind = "fight_back"
        elif defense_kind == "fight_back":
            def_oc, def_rec = self._percentile(target_id, "Fighting",
                                               target["combat_skill"],
                                               f"fight back vs {actor_id}")
            opp_kind = "fight_back"
        else:  # dodge
            dodge_target = target.get("dodge_skill") or target["combat_skill"]
            def_oc, def_rec = self._percentile(target_id, "Dodge", dodge_target,
                                               f"dodge vs {actor_id}")
            opp_kind = "dodge"
        turn["opposed_roll_id"] = def_rec["roll_id"]
        atk_oc, def_oc, opp, luck_event = self._apply_opposed_luck_precommit(
            attacker_id=actor_id,
            defender_id=target_id,
            attack_outcome=atk_oc,
            attack_record=atk_rec,
            defense_outcome=def_oc,
            defense_record=def_rec,
            opposed_kind=opp_kind,
            luck_precommit=luck_precommit,
        )
        if luck_event is not None:
            turn["luck_spend"] = dict(luck_event)
        turn["opposed_outcome"] = opp
        if opp in ("attacker_higher", "tie_attacker_wins"):
            turn["outcome"] = "hit"
            bypass = rulebook_exception is not None
            _, dmg_id, dmg_rec = self._damage_roll(
                weapon["damage"], actor_id, target_id, wid, turn["turn_id"],
                bypass_armor=bypass, rulebook_exception=rulebook_exception,
                db_expr=self._weapon_db_expr(attacker, weapon))
            if LVL[atk_oc] >= LVL["extreme"]:
                self._apply_extreme_damage(dmg_rec, weapon, attacker)
            turn["damage_roll_id"] = dmg_id
        elif defense_kind == "maneuver" and opp in ("defender_higher", "tie_defender_wins"):
            # p.117: defender's maneuver succeeds instead of dealing fight-back damage.
            self._apply_maneuver_goal(
                turn, actor_id=target_id, target_id=actor_id,
                goal=defender_goal or "ongoing_disadvantage",
                target_weapon_id=None, as_counter=True)
        elif defense_kind == "fight_back" and opp == "defender_higher":
            # p.115: a successful Fight Back is a real counter-hit.  Resolve
            # the defender's own first weapon (or unarmed default) against the
            # original attacker and keep the damage receipt on this turn.
            counter_weapon = self._weapon(target_id, None)
            counter_weapon_id = str(counter_weapon.get("weapon_id") or "unarmed")
            _, dmg_id, _ = self._damage_roll(
                str(counter_weapon.get("damage") or "1D3"),
                target_id,
                actor_id,
                counter_weapon_id,
                turn["turn_id"],
                db_expr=self._weapon_db_expr(target, counter_weapon),
            )
            self._update_conditions(actor_id)
            turn["outcome"] = "fight_back_hit"
            turn["fight_back_damage_roll_id"] = dmg_id
            turn["fight_back_weapon_id"] = counter_weapon_id
        elif opp == "both_fail":
            turn["outcome"] = "no_damage"
        else:
            turn["outcome"] = "miss"
        self._mark_defended(target_id)

    def _resolve_multi_shot(self, turn, actor_id, target_id, weapon, wid,
                            defense_kind, rulebook_exception, n_shots,
                            range_band=None, point_blank=False, cover=False,
                            fast_moving=False, outnumbered_penalty=False,
                            load_and_fire=False):
        """Handgun multiple shots (p.113): each shot gets one penalty die."""
        attacker = self.participants[actor_id]
        target = self.participants[target_id]
        skill_value = self._firearm_skill_value(attacker, weapon)
        difficulty = "regular"
        if range_band == "long":
            difficulty = "hard"
        elif range_band == "very_long":
            difficulty = "extreme"
        shot_records = []
        hits = 0
        for i in range(n_shots):
            ammo = self.get_ammo(actor_id, wid)
            if ammo is not None and ammo <= 0 and not (load_and_fire and i == 0):
                shot_records.append({"shot": i + 1, "outcome": "out_of_ammo"})
                break
            atk_bonus = 0
            atk_penalty = 1  # all multi-shots receive one penalty die
            mods: dict[str, Any] = {"multi_shot": True, "shot_index": i + 1,
                                    "point_blank": point_blank, "cover": cover}
            if point_blank:
                atk_bonus += 1
            if cover:
                atk_penalty += 1
            if fast_moving:
                atk_penalty += 1
            if load_and_fire and i == 0:
                atk_penalty += 1
                mods["load_and_fire"] = True
            # Aiming only applies to the first shot, then clears.
            atk_bonus, atk_penalty = self._apply_prone_and_aim_modifiers(
                attacker, target, True, False, False, point_blank,
                atk_bonus, atk_penalty, mods)
            atk_oc, atk_rec = self._percentile(
                actor_id, weapon["skill"], skill_value,
                f"multi-shot {i + 1}/{n_shots} vs {target_id}",
                difficulty=difficulty, bonus=atk_bonus, penalty=atk_penalty,
                ranged=True)
            mods["bonus"] = atk_bonus
            mods["penalty"] = atk_penalty
            malf = self._check_malfunction(actor_id, weapon, atk_rec["roll"], turn["turn_id"])
            self._consume_ammo(actor_id, wid, 1)
            shot = {
                "shot": i + 1,
                "roll_id": atk_rec["roll_id"],
                "attack_modifiers": mods,
                "outcome_level": atk_oc,
            }
            if malf:
                shot["malfunction"] = malf
            if LVL[atk_oc] >= LVL["regular"]:
                shot["outcome"] = "hit"
                hits += 1
                bypass = rulebook_exception is not None
                _, dmg_id, _ = self._damage_roll(
                    weapon["damage"], actor_id, target_id, wid, turn["turn_id"],
                    bypass_armor=bypass, rulebook_exception=rulebook_exception)
                shot["damage_roll_id"] = dmg_id
            else:
                shot["outcome"] = "miss"
            shot_records.append(shot)
        turn["shots"] = shot_records
        turn["defense_kind"] = defense_kind or "none"
        turn["opposed_outcome"] = "unopposed"
        turn["outcome"] = "multi_shot_resolved"
        turn["hits"] = hits
        if shot_records:
            turn["roll_id"] = shot_records[0].get("roll_id")
            turn["attack_modifiers"] = shot_records[0].get("attack_modifiers", {})
        self._mark_defended(target_id)

    def _escalate_auto_penalty(self, volley_index: int) -> tuple[int, str]:
        """p.116: +1 penalty per volley after the first; at 3 penalties → 2 + raise difficulty."""
        # volley_index 0-based
        extra = volley_index  # 0,1,2,3...
        difficulty = "regular"
        penalty = extra
        if penalty >= 3:
            # stick with 2 penalty dice and raise difficulty one step per excess
            steps = penalty - 2
            penalty = 2
            ladder = ["regular", "hard", "extreme", "critical"]
            idx = min(len(ladder) - 1, steps)
            # steps=1 → hard, steps=2 → extreme, ...
            difficulty = ladder[min(len(ladder) - 1, steps)]
            if steps > len(ladder) - 1:
                difficulty = "impossible"
        return penalty, difficulty

    def _resolve_full_auto(self, turn, actor_id, target_id, weapon, wid,
                           defense_kind, rulebook_exception, range_band=None,
                           point_blank=False, cover=False, fast_moving=False,
                           rounds_fired=0):
        """Full-auto volleys (p.114-116)."""
        attacker = self.participants[actor_id]
        uses = parse_uses_per_round(weapon.get("uses_per_round"))
        if not uses["allows_full_auto"]:
            raise ValueError(f"weapon {wid} does not allow full auto "
                             f"({weapon.get('uses_per_round')!r})")
        skill_value = self._firearm_skill_value(attacker, weapon)
        volley_sz = full_auto_volley_size(skill_value)
        ammo = self.get_ammo(actor_id, wid)
        available = ammo if ammo is not None else int(rounds_fired)
        total = min(int(rounds_fired), available)
        if total <= 0:
            turn["outcome"] = "out_of_ammo"
            turn["defense_kind"] = "none"
            turn["opposed_outcome"] = "unopposed"
            turn["volleys"] = []
            return
        base_difficulty = "regular"
        if range_band == "long":
            base_difficulty = "hard"
        elif range_band == "very_long":
            base_difficulty = "extreme"
        volleys = []
        remaining = total
        volley_i = 0
        target = self.participants[target_id]
        while remaining > 0:
            bullets = min(volley_sz, remaining)
            penalty, diff_bump = self._escalate_auto_penalty(volley_i)
            # Combine base range difficulty with escalation bump.
            difficulty = base_difficulty
            if diff_bump != "regular":
                ladder = ["regular", "hard", "extreme", "critical", "impossible"]
                base_i = ladder.index(base_difficulty) if base_difficulty in ladder else 0
                bump_i = ladder.index(diff_bump) if diff_bump in ladder else 0
                difficulty = ladder[min(len(ladder) - 1, max(base_i, bump_i))]
            atk_bonus = 1 if point_blank else 0
            atk_penalty = penalty + (1 if cover else 0) + (1 if fast_moving else 0)
            mods: dict[str, Any] = {"volley_index": volley_i + 1, "full_auto": True,
                                    "bonus": atk_bonus, "penalty": atk_penalty}
            atk_bonus, atk_penalty = self._apply_prone_and_aim_modifiers(
                attacker, target, True, False, False, point_blank,
                atk_bonus, atk_penalty, mods)
            mods["bonus"] = atk_bonus
            mods["penalty"] = atk_penalty
            atk_oc, atk_rec = self._percentile(
                actor_id, weapon["skill"], skill_value,
                f"full-auto volley {volley_i + 1} ({bullets} rds) vs {target_id}",
                difficulty=difficulty, bonus=atk_bonus, penalty=atk_penalty,
                ranged=True)
            malf = self._check_malfunction(actor_id, weapon, atk_rec["roll"], turn["turn_id"])
            self._consume_ammo(actor_id, wid, bullets)
            volley = {
                "volley": volley_i + 1,
                "bullets": bullets,
                "roll_id": atk_rec["roll_id"],
                "attack_modifiers": mods,
                "difficulty": difficulty,
                "outcome_level": atk_oc,
            }
            if malf:
                volley["malfunction"] = malf
            if LVL[atk_oc] >= LVL["regular"]:
                # Half of shots hit (round down, min 1); Extreme → all hit, first half impale.
                if LVL[atk_oc] >= LVL["extreme"] and difficulty != "extreme":
                    hits = bullets
                    impales = max(1, bullets // 2)
                else:
                    hits = max(1, bullets // 2)
                    impales = 0
                volley["outcome"] = "hit"
                volley["hits"] = hits
                volley["impales"] = impales
                bypass = rulebook_exception is not None
                dmg_ids = []
                for h in range(hits):
                    _, dmg_id, dmg_rec = self._damage_roll(
                        weapon["damage"], actor_id, target_id, wid, turn["turn_id"],
                        bypass_armor=bypass, rulebook_exception=rulebook_exception)
                    if h < impales:
                        self._apply_extreme_damage(dmg_rec, weapon, attacker)
                    dmg_ids.append(dmg_id)
                volley["damage_roll_ids"] = dmg_ids
            else:
                volley["outcome"] = "miss"
                volley["hits"] = 0
            volleys.append(volley)
            remaining -= bullets
            volley_i += 1
        turn["volleys"] = volleys
        turn["rounds_fired"] = total
        turn["defense_kind"] = defense_kind or "none"
        turn["opposed_outcome"] = "unopposed"
        turn["outcome"] = "full_auto_resolved"
        if volleys:
            turn["roll_id"] = volleys[0]["roll_id"]
            turn["attack_modifiers"] = volleys[0]["attack_modifiers"]
        self._mark_defended(target_id)

    def _resolve_suppressive_fire(self, turn, actor_id, weapon, wid,
                                  suppress_targets, dive_for_cover_actors,
                                  range_band=None, point_blank=False, cover=False,
                                  fast_moving=False, rounds_fired=None):
        """Suppressing fire (p.126): group may dive; then random targets are engaged."""
        attacker = self.participants[actor_id]
        targets = [t for t in suppress_targets if t in self.participants]
        if not targets:
            turn["outcome"] = "suppressive_fire_no_targets"
            turn["defense_kind"] = "none"
            turn["opposed_outcome"] = "unopposed"
            return
        dived = []
        for tid in dive_for_cover_actors or []:
            if tid not in targets:
                continue
            target = self.participants[tid]
            dodge_target = target.get("dodge_skill") or target["combat_skill"]
            def_oc, def_rec = self._percentile(
                tid, "Dodge", dodge_target, f"dive for cover under suppression")
            if LVL[def_oc] >= LVL["regular"]:
                dived.append(tid)
                self._mark_dived_for_cover(tid)
                turn.setdefault("dive_rolls", {})[tid] = def_rec["roll_id"]
        # Pick random target(s) from the original group (including divers).
        skill_value = self._firearm_skill_value(attacker, weapon)
        volley_sz = full_auto_volley_size(skill_value)
        ammo = self.get_ammo(actor_id, wid)
        budget = rounds_fired if rounds_fired is not None else volley_sz * max(1, len(targets))
        if ammo is not None:
            budget = min(budget, ammo)
        # One volley per chosen target, cycling randomly.
        chosen = list(targets)
        self._rng.shuffle(chosen)
        suppression_results = []
        remaining = budget
        for i, tid in enumerate(chosen):
            if remaining <= 0:
                break
            bullets = min(volley_sz, remaining)
            atk_bonus = 0
            atk_penalty = i  # subsequent targets escalate like volleys
            if atk_penalty > 2:
                atk_penalty = 2
            if tid in dived:
                atk_penalty += 1  # harder to hit those who dived
            if cover:
                atk_penalty += 1
            atk_oc, atk_rec = self._percentile(
                actor_id, weapon["skill"], skill_value,
                f"suppressive volley vs {tid}",
                bonus=atk_bonus, penalty=atk_penalty, ranged=True)
            self._consume_ammo(actor_id, wid, bullets)
            entry = {
                "target_actor_id": tid,
                "bullets": bullets,
                "roll_id": atk_rec["roll_id"],
                "dived": tid in dived,
                "outcome_level": atk_oc,
            }
            if LVL[atk_oc] >= LVL["regular"]:
                hits = max(1, bullets // 2)
                entry["outcome"] = "hit"
                entry["hits"] = hits
                dmg_ids = []
                for _ in range(hits):
                    _, dmg_id, _ = self._damage_roll(
                        weapon["damage"], actor_id, tid, wid, turn["turn_id"])
                    dmg_ids.append(dmg_id)
                entry["damage_roll_ids"] = dmg_ids
            else:
                entry["outcome"] = "miss"
                entry["hits"] = 0
            suppression_results.append(entry)
            remaining -= bullets
            self._mark_defended(tid)
        turn["dived_for_cover"] = dived
        turn["suppression_targets"] = suppression_results
        turn["defense_kind"] = "none"
        turn["opposed_outcome"] = "unopposed"
        turn["outcome"] = "suppressive_fire"
        if suppression_results:
            turn["roll_id"] = suppression_results[0]["roll_id"]

    def _apply_maneuver_goal(self, turn, actor_id, target_id, goal,
                             target_weapon_id=None, as_counter=False):
        """Apply a successful maneuver goal (shared by attack + counter paths)."""
        attacker = self.participants[actor_id]
        target = self.participants[target_id] if target_id else None
        prefix = "counter_" if as_counter else ""
        if goal == "disarm" and target_id:
            wid = target_weapon_id or (
                (target["weapons"][0].get("weapon_id")
                 if target.get("weapons") and isinstance(target["weapons"][0], dict)
                 else target["weapons"][0])
                if target.get("weapons") else None)
            if wid:
                # Transfer the target's full weapon entry (not a bare id) so
                # module-weapon fields survive the hand-off and the combat-end
                # inventory commit can persist the complete spec.
                taken: dict[str, Any] | None = None
                remaining: list[Any] = []
                for w in target["weapons"]:
                    w_id = w.get("weapon_id") if isinstance(w, dict) else w
                    if w_id == wid and taken is None:
                        taken = dict(w) if isinstance(w, dict) else {"weapon_id": str(w)}
                    else:
                        remaining.append(w)
                target["weapons"] = remaining
                if taken is None:
                    taken = {"weapon_id": str(wid)}
                attacker["weapons"].append(taken)
                turn["effect_applied"] = {
                    "effect": "disarmed", "target_actor_id": target_id,
                    "weapon_id": wid, "weapon": dict(taken),
                    "transferred_to": actor_id,
                    "counter": as_counter,
                }
                turn["outcome"] = f"{prefix}disarm_success"
            else:
                turn["outcome"] = f"{prefix}disarm_nothing_to_take"
        elif goal == "ongoing_disadvantage" and target_id:
            self.apply_effect(target_id, "restrained", actor_id, remaining_rounds=999,
                              metadata={"goal": "ongoing_disadvantage", "counter": as_counter})
            turn["effect_applied"] = {
                "effect": "restrained", "target_actor_id": target_id,
                "held_by": actor_id, "counter": as_counter,
            }
            turn["outcome"] = f"{prefix}restrain_success"
        elif goal == "escape":
            actor_effs = attacker.get("active_effects", [])
            restraint = next((e for e in actor_effs if e["effect"] == "restrained"), None)
            if restraint:
                attacker["active_effects"] = [e for e in actor_effs if e is not restraint]
                turn["effect_applied"] = {"effect": "broke_free", "target_actor_id": actor_id,
                                          "counter": as_counter}
                turn["outcome"] = f"{prefix}escape_success"
            else:
                turn["outcome"] = f"{prefix}escape_nothing_to_escape"
        elif goal == "push":
            if target_id and "prone" not in target["conditions"]:
                target["conditions"].append("prone")
            turn["effect_applied"] = {
                "effect": "pushed", "target_actor_id": target_id, "counter": as_counter,
            }
            turn["outcome"] = f"{prefix}push_success"
        else:
            turn["effect_applied"] = {"effect": goal, "target_actor_id": target_id,
                                      "counter": as_counter}
            turn["outcome"] = f"{prefix}maneuver_success"

    def _resolve_flee(self, turn, actor_id):
        """Mechanism 8: fleeing combat (p.114 action list).

        Declaring flee removes the participant from subsequent initiative
        (they have left the fight). If opponents wish to prevent the flee
        (e.g. via fighting maneuver or attack with bonus die for the
        fleeing target's exposed back), that is resolved as a separate
        attack turn against the fleeing actor — the flee itself just marks
        the participant as fled. The Keeper may call for a DEX or Drive Auto
        roll to determine if the escape succeeds when chased; that roll is
        the caller's responsibility (declare it as a follow-up turn).
        """
        p = self.participants[actor_id]
        p["conditions"] = [c for c in p["conditions"] if c != "fled"]
        p["conditions"].append("fled")
        turn["defense_kind"] = "none"
        turn["opposed_outcome"] = "unopposed"
        turn["outcome"] = "fled"
        # Remove from subsequent initiative: hp_current stays, but fled flag
        # excludes them from begin_round ranking (checked there).

    def _resolve_skill_check(self, turn, actor_id, skill, target_value, difficulty, intent):
        """Resolution hint 'skill_check': a single percentile roll vs difficulty.
        Used when the Keeper calls for a skill roll that isn't an attack, e.g.
        Spot Hidden to find cover, Stealth to flank, Listen to hear an ambush."""
        oc, rec = self._percentile(actor_id, skill, target_value, intent, difficulty=difficulty)
        turn["roll_id"] = rec["roll_id"]
        turn["defense_kind"] = "none"
        turn["opposed_outcome"] = "unopposed"
        turn["outcome"] = oc  # critical/extreme/hard/regular/failure/fumble

    def _resolve_characteristic(self, turn, actor_id, characteristic, target_value, intent):
        """Resolution hint 'characteristic_roll': STR/DEX/INT/CON/POW/APP/SIZ/EDU
        percentile check. Same as skill_check semantically but tagged so audit
        can distinguish (characteristic rolls don't earn development ticks)."""
        oc, rec = self._percentile(actor_id, characteristic, target_value, intent)
        turn["roll_id"] = rec["roll_id"]
        turn["defense_kind"] = "none"
        turn["opposed_outcome"] = "unopposed"
        turn["outcome"] = oc

    def _resolve_sanity(self, turn, actor_id, source_actor_id, current_san, intent):
        """Resolution hint 'sanity_check': SAN roll vs current SAN with SAN loss.
        Delegates to the caller-provided current_san (the engine doesn't track
        SAN on combat participants by default — the harness owns character SAN).
        Records the roll; SAN loss application is the caller's responsibility
        (combat sessions track HP, not SAN)."""
        if current_san is None:
            turn["outcome"] = "sanity_check_no_target_value"
            return
        oc, rec = self._percentile(actor_id, "SAN", current_san, intent)
        turn["roll_id"] = rec["roll_id"]
        turn["defense_kind"] = "none"
        turn["opposed_outcome"] = "unopposed"
        turn["outcome"] = oc

    def _resolve_damage_only(self, turn, actor_id, target_id, weapon_id, rulebook_exception):
        """Resolution hint 'damage_only': pure damage roll with no attack check.
        Used for environmental damage (Bed Attack throw, fall, fire) where the
        triggering roll already failed — this just rolls the damage die."""
        if not target_id:
            turn["outcome"] = "damage_only_no_target"
            return
        attacker = self.participants[actor_id]
        weapon = self._weapon(actor_id, weapon_id) if weapon_id else {"damage": "1D6", "adds_damage_bonus": False}
        bypass = rulebook_exception is not None
        raw, dmg_id, _ = self._damage_roll(
            weapon["damage"], actor_id, target_id,
            weapon_id or "environmental", turn["turn_id"],
            bypass_armor=bypass, rulebook_exception=rulebook_exception,
            db_expr=self._weapon_db_expr(attacker, weapon))
        turn["roll_id"] = dmg_id
        turn["damage_roll_id"] = dmg_id
        turn["defense_kind"] = "none"
        turn["opposed_outcome"] = "unopposed"
        turn["outcome"] = "damage_applied"

    def _resolve_surprise_attack(self, turn, actor_id, target_id, weapon_id):
        # p.106: target neither fights back nor dodges. Attack roll only; hit
        # if the attacker achieves any success.
        attacker = self.participants[actor_id]
        weapon = self._weapon(actor_id, weapon_id)
        atk_oc, atk_rec = self._percentile(actor_id, weapon["skill"],
                                           attacker["combat_skill"],
                                           f"surprise attack {target_id}")
        turn["roll_id"] = atk_rec["roll_id"]
        turn["defense_kind"] = "none"
        turn["opposed_outcome"] = "unopposed"
        if LVL[atk_oc] >= LVL["regular"]:
            turn["outcome"] = "hit"
            _, dmg_id, _ = self._damage_roll(
                weapon["damage"], actor_id, target_id, weapon_id, turn["turn_id"],
                db_expr=self._weapon_db_expr(attacker, weapon))
            turn["damage_roll_id"] = dmg_id
        else:
            turn["outcome"] = "miss"

    def _resolve_cast(self, turn, actor_id, target_id, spell):
        # Generic hook. The Dominate path is the first consumer; other spells
        # can extend this. The caster spends MP and resolves an opposed POW.
        caster = self.participants[actor_id]
        if spell == "dominate":
            cost = 1
            if caster["magic_points"] < cost:
                turn["outcome"] = "insufficient_magic_points"
                return
            caster["magic_points"] -= cost
            atk_oc, atk_rec = self._percentile(actor_id, "POW", caster.get("pow", 90),
                                               f"Dominate {target_id}")
            turn["roll_id"] = atk_rec["roll_id"]
            target = self.participants[target_id]
            def_oc, def_rec = self._percentile(target_id, "POW",
                                               target.get("pow", target["combat_skill"]),
                                               f"resist Dominate from {actor_id}")
            turn["opposed_roll_id"] = def_rec["roll_id"]
            turn["defense_kind"] = "none"
            opp = self._resolve_opposed(atk_oc, def_oc, "fight_back")
            turn["opposed_outcome"] = opp
            if opp in ("attacker_higher", "tie_attacker_wins"):
                rounds = self._rng.randint(1, 6) + 1
                self.apply_effect(target_id, "dominated", actor_id, rounds,
                                  metadata={"source_spell": "dominate"})
                turn["outcome"] = "dominate_success"
                turn["effect_applied"] = {
                    "effect": "dominated", "target_actor_id": target_id,
                    "remaining_rounds": rounds,
                }
            else:
                turn["outcome"] = "dominate_resisted"
        else:
            turn["outcome"] = f"unknown_spell:{spell}"

    def _resolve_maneuver(self, turn, actor_id, target_id, defense_kind,
                          goal: str = "ongoing_disadvantage",
                          target_weapon_id: str | None = None,
                          outnumbered_penalty: bool = False,
                          defender_goal: str | None = None):
        """Fighting maneuver (p.117-119) — the rulebook's "one maneuver, one goal" model.

        Build comparison grants penalty dice (p.117): attacker Build below
        target by N → N penalty dice (max 2); 3+ below → impossible. On
        success, the maneuver achieves ONE goal per the p.119 list:

        - ``disarm``: transfer target's weapon to attacker.
        - ``ongoing_disadvantage``: target takes 1 penalty die on future
          actions (or allies get +1 bonus die vs target) — this is the
          rulebook's "physical restraint or knocked down" outcome. The
          restrained character is automatically held until the attacker
          releases, is incapacitated, or suffers a major wound; they may
          use a maneuver (goal='escape') to break free.
        - ``escape``: the actor breaks free from an ongoing_disadvantage
          restraint applied to themselves.
        - ``push``: target is pushed/thrown/knocked down; the Keeper may
          inflict falling damage via a separate damage_only turn.

        The target may respond with a maneuver of their own
        (``defense_kind='maneuver'`` + ``defender_goal``) per p.117.
        """
        attacker = self.participants[actor_id]
        target = self.participants[target_id] if target_id else None
        atk_build = attacker.get("build", 0)
        def_build = target.get("build", 0) if target else 0
        build_diff = def_build - atk_build  # positive = attacker is smaller

        # Build penalty (combat.json melee_combat.maneuver thresholds).
        if build_diff >= 3 and goal != "escape":
            turn["outcome"] = "maneuver_impossible_build"
            turn["opposed_outcome"] = "impossible"
            turn["defense_kind"] = "none"
            turn["maneuver_build_difference"] = build_diff
            return
        penalty_dice = min(2, max(0, build_diff))
        if outnumbered_penalty:
            # Attacker bonus die vs already-defended target (p.108) — encoded
            # as reducing effective penalty for simplicity when both apply.
            pass
        turn["maneuver_build_difference"] = build_diff
        turn["maneuver_penalty_dice"] = penalty_dice

        atk_bonus = 1 if outnumbered_penalty else 0
        atk_oc, atk_rec = self._percentile(
            actor_id, "Fighting", attacker["combat_skill"],
            f"{goal} maneuver vs {target_id}", bonus=atk_bonus, penalty=penalty_dice)
        turn["roll_id"] = atk_rec["roll_id"]
        dk = defense_kind if defense_kind not in (None, "none") else "none"
        if dk == "none":
            # Unopposed maneuver (surprised / non-resisting target).
            turn["defense_kind"] = "none"
            turn["opposed_outcome"] = "unopposed"
            if LVL[atk_oc] >= LVL["regular"]:
                self._apply_maneuver_goal(
                    turn, actor_id=actor_id, target_id=target_id,
                    goal=goal, target_weapon_id=target_weapon_id, as_counter=False)
            else:
                turn["outcome"] = "maneuver_failed"
            if target_id:
                self._mark_defended(target_id)
            return
        turn["defense_kind"] = dk
        if target_id:
            if dk == "maneuver":
                def_goal = defender_goal or "ongoing_disadvantage"
                turn["defender_goal"] = def_goal
                def_oc, def_rec = self._percentile(
                    target_id, "Fighting", target["combat_skill"],
                    f"maneuver counter ({def_goal}) vs {actor_id}")
                opp_kind = "fight_back"
            elif dk == "fight_back":
                def_oc, def_rec = self._percentile(target_id, "Fighting",
                                                   target["combat_skill"],
                                                   f"resist {goal} maneuver")
                opp_kind = "fight_back"
            else:
                dodge_target = target.get("dodge_skill") or target["combat_skill"]
                def_oc, def_rec = self._percentile(target_id, "Dodge", dodge_target,
                                                   f"dodge {goal} maneuver")
                opp_kind = "dodge"
            turn["opposed_roll_id"] = def_rec["roll_id"]
        else:
            def_oc = "failure"
            opp_kind = dk if dk in ("fight_back", "dodge") else "fight_back"
        opp = self._resolve_opposed(atk_oc, def_oc, opp_kind)
        turn["opposed_outcome"] = opp

        if dk == "maneuver" and opp in ("defender_higher",):
            # Defender's counter-maneuver succeeds (p.117).
            self._apply_maneuver_goal(
                turn, actor_id=target_id, target_id=actor_id,
                goal=defender_goal or "ongoing_disadvantage",
                target_weapon_id=None, as_counter=True)
            self._mark_defended(target_id)
            return

        if opp not in ("attacker_higher", "tie_attacker_wins"):
            # fight_back defender_higher → defender deals damage (p.117)
            if dk == "fight_back" and opp == "defender_higher":
                _, dmg_id, _ = self._damage_roll(
                    "1D3", target_id, actor_id, "unarmed", turn["turn_id"],
                    db_expr=self._weapon_db_expr(target, {"adds_damage_bonus": True}))
                turn["damage_roll_id"] = dmg_id
                turn["outcome"] = "maneuver_failed_fight_back_damage"
            else:
                turn["outcome"] = "maneuver_failed"
            if target_id:
                self._mark_defended(target_id)
            return

        # Maneuver succeeded — apply the ONE goal (p.119).
        self._apply_maneuver_goal(
            turn, actor_id=actor_id, target_id=target_id,
            goal=goal, target_weapon_id=target_weapon_id, as_counter=False)
        if target_id:
            self._mark_defended(target_id)

    def _weapon(self, actor_id: str, weapon_id: str | None) -> dict:
        """Resolve the weapon dict for a turn.

        Participants store weapon references in ``weapons[]``. Each entry may
        be either a bare ``weapon_id`` string (resolved from the catalog —
        base damage/skill/impales come from there) or a dict that overrides
        catalog fields (e.g. a module weapon setting ``special``). The catalog
        is the merged table of canonical weapons + module-specific extensions.
        """
        participant = self.participants[actor_id]
        if weapon_id is None:
            if not participant["weapons"]:
                # Default unarmed: Fighting (Brawl), 1D3 + DB
                unarmed = self._weapon_catalog.get("unarmed", {})
                return {"weapon_id": "unarmed",
                        "skill": "Fighting (Brawl)", "damage": "1D3",
                        "adds_damage_bonus": True, "impales": False,
                        "special": None, **unarmed, "weapon_id": "unarmed"}
            weapon_id = (participant["weapons"][0].get("weapon_id")
                         if isinstance(participant["weapons"][0], dict)
                         else participant["weapons"][0])
        # Find the participant's weapon reference (string or dict override).
        participant_ref: dict[str, Any] = {}
        for w in participant["weapons"]:
            wid = w.get("weapon_id") if isinstance(w, dict) else w
            if wid == weapon_id:
                participant_ref = w if isinstance(w, dict) else {}
                break
        # Merge catalog base + participant override.
        catalog_entry = dict(self._weapon_catalog.get(weapon_id, {}))
        catalog_entry.update(participant_ref)
        catalog_entry.setdefault("weapon_id", weapon_id)
        catalog_entry.setdefault("damage", "1D3")
        catalog_entry.setdefault("skill", "Fighting (Brawl)")
        catalog_entry.setdefault("adds_damage_bonus", True)
        catalog_entry.setdefault("impales", False)
        catalog_entry.setdefault("special", None)
        return catalog_entry

    # ------------------------------------------------------------------ #
    # Effects and conditions
    # ------------------------------------------------------------------ #
    def apply_effect(self, target_actor_id: str, effect: str,
                     source_actor_id: str, remaining_rounds: int,
                     metadata: dict | None = None) -> None:
        self.participants[target_actor_id]["active_effects"].append({
            "effect": effect,
            "source_actor_id": source_actor_id,
            "applied_round": self._current_round,
            "remaining_rounds": remaining_rounds,
            "metadata": metadata or {},
        })

    def tick_effects(self) -> None:
        """End-of-round: decrement remaining_rounds; remove expired effects."""
        for p in self.participants.values():
            for eff in p["active_effects"]:
                eff["remaining_rounds"] = max(0, eff["remaining_rounds"] - 1)
            p["active_effects"] = [e for e in p["active_effects"]
                                   if e["remaining_rounds"] > 0]

    def is_dominated(self, actor_id: str) -> bool:
        return any(e["effect"] == "dominated"
                   for e in self.participants[actor_id]["active_effects"])

    def _update_conditions(self, target_id: str | None) -> None:
        """Apply the p.120 wound-state triage after damage lands.

        - Single hit > max HP: inevitable death.
        - Major wound (single hit >= half max HP): immediately prone + CON
          roll to avoid falling unconscious.
        - 0 HP: unconscious; dying only if a major wound was also taken.
        """
        if target_id is None or target_id not in self.participants:
            return
        p = self.participants[target_id]
        # "half or more" means ceil(max/2) for odd HP totals.  Floor division
        # incorrectly made 5 damage a Major Wound on an 11 HP investigator.
        half_max = (p["hp_max"] + 1) // 2
        # Worst single delivered hit (post-armor, NOT capped by remaining HP —
        # p.120 triage keys off the damage the attack delivered), skipping
        # non-damage records (e.g. malfunction events).
        worst_single = 0
        for d in self.damage_chain:
            if "target_actor_id" not in d or d["target_actor_id"] != target_id:
                continue
            landed = int(d.get("raw_damage", 0)) - int(d.get("armor_absorbed", 0))
            if landed > worst_single:
                worst_single = landed
        # p.120: damage greater than max HP in one attack -> death is inevitable.
        if worst_single > p["hp_max"]:
            if "dead" not in p["conditions"]:
                p["conditions"].append("dead")
            return
        newly_major = (worst_single >= half_max and worst_single > 0
                       and "major_wound" not in p["conditions"])
        if worst_single >= half_max and worst_single > 0:
            if "major_wound" not in p["conditions"]:
                p["conditions"].append("major_wound")
        if newly_major:
            # p.120: the character immediately falls prone and must make a
            # CON roll to avoid falling unconscious.
            if "prone" not in p["conditions"]:
                p["conditions"].append("prone")
            con_outcome, con_record = self._percentile(
                target_id,
                "CON",
                int(p.get("con", 50)),
                "remain conscious after a major wound",
            )
            if con_outcome in ("failure", "fumble"):
                if "unconscious" not in p["conditions"]:
                    p["conditions"].append("unconscious")
            # Keep complete stable roll evidence without polluting the damage
            # chain; pending_rolls remains the canonical roll log sink.
            p["major_wound_con"] = dict(con_record)
        if p["hp_current"] == 0:
            # p.120: on zero HP the character is unconscious; dying only when
            # a major wound has also been taken.
            if "unconscious" not in p["conditions"]:
                p["conditions"].append("unconscious")
            if "major_wound" in p["conditions"] and "dying" not in p["conditions"]:
                p["conditions"].append("dying")

    # ------------------------------------------------------------------ #
    # Conclusion
    # ------------------------------------------------------------------ #
    def conclude(self, outcome: str) -> None:
        if outcome not in VALID_OUTCOMES:
            raise ValueError(f"invalid outcome {outcome!r}")
        self.status = "concluded"
        self.outcome = outcome

    @classmethod
    def _validate_external_damage_evidence(
        cls, *, session: "CombatSession",
        evidence: list[dict[str, Any]] | None,
        turns_by_id: dict[str, tuple[int, dict[str, Any]]],
        damage_roll_ids: set[str],
        expected_command_actor: str | None,
    ) -> None:
        """Cross-check every damage transition against append-only roll rows."""
        # Retained for call-site compatibility. A request's focused
        # investigator is not necessarily the actor that dealt the damage.
        _ = expected_command_actor
        if not isinstance(evidence, list):
            raise ValueError("combat external damage evidence is required")
        evidence_by_roll: dict[str, list[dict[str, Any]]] = {}
        legacy_keys = {"type", "actor", "command_id", "payload", "ts"}
        canonical_keys = legacy_keys | {
            "event_type", "roll_id", "visibility", "source", "source_ref",
        }
        for row in evidence:
            row_keys = frozenset(row) if isinstance(row, dict) else frozenset()
            if row_keys not in {frozenset(legacy_keys), frozenset(canonical_keys)}:
                raise ValueError("combat external damage evidence contract is invalid")
            payload = row.get("payload")
            receipt = (
                payload.get("combat_damage_receipt")
                if isinstance(payload, dict) else None
            )
            if not isinstance(receipt, dict):
                continue
            roll_id = receipt.get("roll_id")
            if isinstance(roll_id, str):
                if row_keys == frozenset(canonical_keys) and (
                    row.get("event_type") != "roll"
                    or row.get("roll_id") != roll_id
                    or row.get("visibility") != payload.get("visibility")
                    or row.get("visibility") not in {
                        "public", "consequence_public", "keeper_only",
                    }
                    or not isinstance(row.get("source"), str)
                    or not row["source"]
                    or not isinstance(row.get("source_ref"), str)
                    or not row["source_ref"]
                ):
                    raise ValueError(
                        "combat external damage evidence contract is invalid"
                    )
                evidence_by_roll.setdefault(roll_id, []).append(row)
        damage_by_roll = {
            damage["damage_roll_id"]: damage
            for damage in session.damage_chain
            if isinstance(damage.get("damage_roll_id"), str)
        }
        for roll_id in damage_roll_ids:
            rows = evidence_by_roll.get(roll_id, [])
            if len(rows) != 1:
                raise ValueError(
                    "combat external damage evidence is missing or duplicated"
                )
            row = rows[0]
            payload = row["payload"]
            damage = damage_by_roll[roll_id]
            linked = turns_by_id.get(damage["source_turn_id"])
            turn = linked[1] if linked is not None else None
            if not isinstance(turn, dict):
                raise ValueError("combat external damage evidence source is invalid")
            expected = cls._external_damage_receipt(turn=turn, damage=damage)
            command_id = turn.get("resolution_command_id")
            if (
                not isinstance(command_id, str)
                or not command_id
                or row.get("type") != "roll"
                or row.get("actor") != damage["source_actor_id"]
                or row.get("command_id") != command_id
                or not isinstance(row.get("ts"), str)
                or not row["ts"]
                or payload.get("event_type") != "combat_roll"
                or payload.get("roll_id") != roll_id
                or payload.get("actor_id") != damage["source_actor_id"]
                or payload.get("skill") != "HP Damage"
                or payload.get("source_command_id") != command_id
                or payload.get("target") != damage["target_actor_id"]
                or payload.get("raw_roll") != damage["raw_damage"]
                or payload.get("dice") != {
                    "expression": damage["die"],
                    "raw": damage["die_rolls"],
                    "total": damage["raw_damage"],
                }
                or payload.get("combat_damage_receipt") != expected
            ):
                raise ValueError("combat external damage evidence diverges")

    # ------------------------------------------------------------------ #
    # Persistence
    # ------------------------------------------------------------------ #
    def snapshot(self) -> dict[str, Any]:
        return {
            "schema_version": 2,
            "combat_id": self.combat_id,
            "scene_ref": self.scene_ref,
            "started_at_turn": self.started_at_turn,
            "ended_at_turn": self.ended_at_turn,
            "status": self.status,
            "outcome": self.outcome,
            "participants": [dict(p) for p in self.participants.values()],
            "rounds": [dict(r) for r in self.rounds],
            "damage_chain": [dict(d) for d in self.damage_chain],
            "revision": self.revision,
            "current_round": self._current_round,
            "current_initiative": [dict(row) for row in self._current_initiative],
            "initiative_cursor": self.initiative_cursor,
            "initiative_progress": [dict(row) for row in self.initiative_progress],
            "jammed_weapons": sorted(self.jammed_weapons),
            "weapon_catalog": {
                weapon_id: dict(spec)
                for weapon_id, spec in self._weapon_catalog.items()
            },
            "turn_counter": self._turn_counter,
            "roll_counter": self._roll_counter,
            "pending_attack": (
                dict(self.pending_attack) if isinstance(self.pending_attack, dict) else None
            ),
        }

    def save(self, campaign_dir: Path) -> Path:
        save_dir = campaign_dir / "save"
        save_dir.mkdir(parents=True, exist_ok=True)
        path = save_dir / "combat.json"
        coc_fileio.write_json_atomic(
            path, self.snapshot(), indent=2, ensure_ascii=False, trailing_newline=False
        )
        return path

    @classmethod
    def load(
        cls, campaign_dir: Path, *, rng: random.Random,
        damage_evidence: list[dict[str, Any]] | None = None,
        damage_evidence_actor: str | None = None,
        trusted_in_memory: bool = False,
    ) -> "CombatSession":
        """Load and validate the live combat snapshot without consuming RNG."""
        path = Path(campaign_dir) / "save" / "combat.json"
        data = load_combat_state(path)
        if not isinstance(data, dict) or data.get("schema_version") != 2:
            raise ValueError("unsupported combat snapshot schema")
        required = {
            "schema_version",
            "combat_id", "scene_ref", "started_at_turn", "status",
            "participants", "rounds", "damage_chain", "revision",
            "current_round", "current_initiative", "initiative_cursor",
            "initiative_progress",
            "pending_attack", "ended_at_turn", "outcome", "jammed_weapons",
            "weapon_catalog", "turn_counter", "roll_counter",
        }
        if set(data) != required:
            raise ValueError("combat snapshot must use the exact schema")
        def strict_int(value: Any, label: str, *, minimum: int = 0) -> int:
            if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
                raise ValueError(f"combat {label} is invalid")
            return value
        for field in ("combat_id", "scene_ref"):
            if not isinstance(data[field], str) or not data[field].strip():
                raise ValueError(f"combat {field} is invalid")
        session = cls(
            data["combat_id"], data["scene_ref"],
            strict_int(data["started_at_turn"], "started_at_turn"), rng=rng,
        )
        participants = data["participants"]
        if not isinstance(participants, list):
            raise ValueError("combat participants must be a list")
        for participant in participants:
            if not isinstance(participant, dict):
                raise ValueError("combat participant must be an object")
            participant_keys = {
                "actor_id", "side", "dex", "combat_skill", "dodge_skill",
                "firearms_skill", "has_ready_firearm", "build", "damage_bonus",
                "con", "hp_max", "hp_current", "magic_points", "armor",
                "armor_rule", "weapons", "conditions", "active_effects",
                "_defended_this_round", "_dived_for_cover", "_forfeit_next_attack",
                "_aiming", "_ammo", "_reload_remaining",
            }
            if set(participant) not in (participant_keys, participant_keys | {"major_wound_con"}):
                raise ValueError("combat participant must use the exact schema")
            actor_id = participant.get("actor_id")
            if not isinstance(actor_id, str) or actor_id in session.participants:
                raise ValueError("combat participant IDs must be unique strings")
            if participant.get("side") not in VALID_SIDES:
                raise ValueError("combat participant side is invalid")
            conditions = participant.get("conditions")
            if (not isinstance(conditions, list)
                    or len(conditions) != len(set(conditions))
                    or any(item not in VALID_CONDITIONS for item in conditions)):
                raise ValueError("combat participant conditions are invalid")
            hp_max = strict_int(participant.get("hp_max"), "participant hp_max", minimum=1)
            hp_current = strict_int(participant.get("hp_current"), "participant hp_current")
            if hp_current > hp_max:
                raise ValueError("combat participant HP is out of range")
            if "dead" in conditions and hp_current != 0:
                raise ValueError("dead participant must have zero HP")
            if "dying" in conditions and (hp_current > 1 or "major_wound" not in conditions):
                raise ValueError("dying participant state is incoherent")
            for field in ("dex", "combat_skill", "dodge_skill", "firearms_skill", "con"):
                value = strict_int(participant.get(field), f"participant {field}")
                if value > 150:
                    raise ValueError(f"combat participant {field} is out of range")
            for field in ("build", "magic_points", "armor"):
                if isinstance(participant.get(field), bool) or not isinstance(participant.get(field), int):
                    raise ValueError(f"combat participant {field} is invalid")
            if participant.get("armor_rule") not in VALID_ARMOR_RULES:
                raise ValueError("combat participant armor rule is invalid")
            if not isinstance(participant.get("weapons"), list) or not all(
                isinstance(weapon, dict)
                or (isinstance(weapon, str) and bool(weapon.strip()))
                for weapon in participant["weapons"]
            ):
                raise ValueError("combat participant weapons are invalid")
            if not isinstance(participant.get("active_effects"), list):
                raise ValueError("combat participant active effects are invalid")
            if any(not isinstance(participant.get(field), bool) for field in (
                "has_ready_firearm", "_defended_this_round", "_dived_for_cover",
                "_forfeit_next_attack", "_aiming",
            )):
                raise ValueError("combat participant flags are invalid")
            if not isinstance(participant.get("_ammo"), dict) or not isinstance(participant.get("_reload_remaining"), dict):
                raise ValueError("combat participant weapon counters are invalid")
            session.participants[actor_id] = dict(participant)
        if not isinstance(data["rounds"], list) or not all(isinstance(row, dict) for row in data["rounds"]):
            raise ValueError("combat rounds are invalid")
        if not isinstance(data["damage_chain"], list) or not all(isinstance(row, dict) for row in data["damage_chain"]):
            raise ValueError("combat damage chain is invalid")
        session.rounds = list(data["rounds"])
        session.damage_chain = list(data["damage_chain"])
        session.revision = strict_int(data["revision"], "revision")
        session._current_round = strict_int(data["current_round"], "current round")
        session._current_initiative = list(data["current_initiative"])
        session.initiative_cursor = strict_int(data["initiative_cursor"], "initiative cursor")
        session.initiative_progress = list(data["initiative_progress"])
        if not isinstance(data["jammed_weapons"], list) or not all(isinstance(v, str) for v in data["jammed_weapons"]):
            raise ValueError("combat jammed weapons are invalid")
        session.jammed_weapons = set(data["jammed_weapons"])
        weapon_catalog = data.get("weapon_catalog")
        if not isinstance(weapon_catalog, dict) or not all(
            isinstance(weapon_id, str) and isinstance(spec, dict)
            for weapon_id, spec in weapon_catalog.items()
        ):
            raise ValueError("combat weapon catalog is invalid")
        session._weapon_catalog = {
            weapon_id: dict(spec) for weapon_id, spec in weapon_catalog.items()
        }
        session._turn_counter = strict_int(data["turn_counter"], "turn counter")
        session._roll_counter = strict_int(data["roll_counter"], "roll counter")
        session.pending_attack = (
            dict(data["pending_attack"])
            if isinstance(data.get("pending_attack"), dict)
            else None
        )
        session.status = str(data["status"])
        session.outcome = data.get("outcome")
        session.ended_at_turn = data.get("ended_at_turn")
        if session.status not in {"active", "concluded"}:
            raise ValueError("combat status is invalid")
        if session.ended_at_turn is not None:
            session.ended_at_turn = strict_int(session.ended_at_turn, "ended_at_turn")
        if session._current_round != len(session.rounds):
            raise ValueError("combat round cursor does not match round history")
        expected_initiative = (
            session.rounds[-1].get("initiative_order", []) if session.rounds else []
        )
        if session._current_initiative != expected_initiative:
            raise ValueError("combat initiative does not match current round")
        for index, round_row in enumerate(session.rounds, 1):
            if (
                set(round_row) != {"round", "initiative_order", "initiative_progress", "turns"}
                or round_row.get("round") != index
                or not isinstance(round_row.get("initiative_order"), list)
                or not isinstance(round_row.get("initiative_progress"), list)
                or not isinstance(round_row.get("turns"), list)
                or not all(isinstance(turn, dict) for turn in round_row["turns"])
            ):
                raise ValueError("combat round history is invalid")
        turn_required_keys = {
            "turn_id", "actor_id", "dex", "dex_reason", "declared_intent",
            "action", "target_actor_id", "roll_id", "opposed_roll_id",
            "opposed_outcome", "defense_kind", "outcome", "effect_applied",
            "damage_roll_id", "resolution_hint",
        }
        turn_optional_keys = {
            "goal", "weapon_id", "attack_modifiers", "malfunction",
            "cover_reroll_roll_id", "defender_goal",
            "fight_back_damage_roll_id", "fight_back_weapon_id", "shots",
            "hits", "volleys", "rounds_fired", "dived_for_cover",
            "suppression_targets", "dive_rolls", "maneuver_build_difference",
            "maneuver_penalty_dice", "ammo_loaded", "ammo_after",
            "reload_rounds_remaining",
            "resolution_command_id", "luck_spend",
        }
        turns_by_id: dict[str, tuple[int, dict[str, Any]]] = {}
        bindings_by_damage_roll: dict[str, tuple[int, dict[str, Any], dict[str, Any]]] = {}
        for round_number, round_row in enumerate(session.rounds, 1):
            for turn in round_row["turns"]:
                if (
                    not turn_required_keys <= set(turn)
                    or not set(turn) <= turn_required_keys | turn_optional_keys
                ):
                    raise ValueError("combat turn must use the exact schema")
                turn_id = turn.get("turn_id")
                if (
                    not isinstance(turn_id, str)
                    or re.fullmatch(rf"t{round_number}-[1-9][0-9]*", turn_id) is None
                    or turn_id in turns_by_id
                    or turn.get("actor_id") not in session.participants
                    or isinstance(turn.get("dex"), bool)
                    or not isinstance(turn.get("dex"), int)
                    or not isinstance(turn.get("declared_intent"), str)
                    or not turn["declared_intent"].strip()
                    or turn.get("resolution_hint") not in cls.VALID_RESOLUTION_HINTS
                    or not isinstance(turn.get("action"), str)
                    or turn.get("target_actor_id") not in ({None} | set(session.participants))
                    or not isinstance(turn.get("outcome"), str)
                    or not turn["outcome"]
                ):
                    raise ValueError("combat turn provenance is invalid")
                for roll_field in (
                    "roll_id", "opposed_roll_id", "damage_roll_id",
                    "fight_back_damage_roll_id", "cover_reroll_roll_id",
                ):
                    value = turn.get(roll_field)
                    if value is not None and (not isinstance(value, str) or not value):
                        raise ValueError("combat turn roll provenance is invalid")
                resolution_command_id = turn.get("resolution_command_id")
                if resolution_command_id is not None and (
                    not isinstance(resolution_command_id, str)
                    or not resolution_command_id
                ):
                    raise ValueError("combat turn command provenance is invalid")
                turns_by_id[turn_id] = (round_number, turn)
                for binding in cls._damage_bindings_for_turn(turn):
                    roll_id = binding["damage_roll_id"]
                    if roll_id in bindings_by_damage_roll:
                        raise ValueError("combat turn damage roll provenance is duplicated")
                    bindings_by_damage_roll[roll_id] = (round_number, turn, binding)

        damage_required_keys = {
            "damage_roll_id", "source_turn_id", "source_actor_id",
            "target_actor_id", "weapon_id", "die", "die_rolls",
            "raw_damage", "hp_before", "hp_delta", "hp_after",
            "armor_absorbed", "armor_before", "armor_after",
            "rulebook_exception", "bypass_armor", "half_damage_bonus",
            "marker", "status_after", "provenance",
        }
        extreme_damage_keys = {
            "impale_or_max", "extreme_damage", "extreme_breakdown", "is_impale",
        }
        malfunction_keys = {
            "malfunction_roll_id", "source_turn_id", "source_actor_id",
            "weapon_id", "weapon_display_name", "roll",
            "malfunction_threshold", "effect", "marker",
        }
        seen_damage_rolls: set[str] = set()
        last_hp_by_round_target: dict[tuple[int, str], int] = {}
        for damage in session.damage_chain:
            if set(damage) == malfunction_keys:
                linked = turns_by_id.get(damage.get("source_turn_id"))
                if (
                    linked is None
                    or damage.get("source_actor_id") != linked[1].get("actor_id")
                    or not isinstance(damage.get("malfunction_roll_id"), str)
                    or not damage["malfunction_roll_id"]
                    or isinstance(damage.get("roll"), bool)
                    or not isinstance(damage.get("roll"), int)
                    or isinstance(damage.get("malfunction_threshold"), bool)
                    or not isinstance(damage.get("malfunction_threshold"), int)
                    or damage["roll"] < damage["malfunction_threshold"]
                    or damage.get("effect") != "jammed_until_repaired"
                ):
                    raise ValueError("combat damage chain malfunction provenance is invalid")
                continue
            if (
                not damage_required_keys <= set(damage)
                or not set(damage) <= damage_required_keys | extreme_damage_keys
                or (set(damage) & extreme_damage_keys
                    and not extreme_damage_keys <= set(damage))
            ):
                raise ValueError("combat damage chain must use the exact schema")
            roll_id = damage.get("damage_roll_id")
            binding_row = bindings_by_damage_roll.get(roll_id)
            if (
                not isinstance(roll_id, str)
                or not roll_id
                or roll_id in seen_damage_rolls
                or binding_row is None
            ):
                raise ValueError("combat damage provenance is missing or duplicated")
            seen_damage_rolls.add(roll_id)
            round_number, turn, binding = binding_row
            if (
                damage.get("source_turn_id") != turn.get("turn_id")
                or damage.get("source_actor_id") != binding["source_actor_id"]
                or damage.get("target_actor_id") != binding["target_actor_id"]
                or damage.get("source_actor_id") not in session.participants
                or damage.get("target_actor_id") not in session.participants
            ):
                raise ValueError("combat damage provenance diverges from its turn")
            integer_fields = (
                "raw_damage", "hp_before", "hp_delta", "hp_after",
                "armor_absorbed", "armor_before", "armor_after",
            )
            if any(
                isinstance(damage.get(field), bool)
                or not isinstance(damage.get(field), int)
                for field in integer_fields
            ):
                raise ValueError("combat damage chain arithmetic is invalid")
            raw_damage = damage["raw_damage"]
            hp_before = damage["hp_before"]
            hp_after = damage["hp_after"]
            absorbed = damage["armor_absorbed"]
            if not damage.get("extreme_damage") and (
                cls._reconstruct_damage_roll(damage.get("die"), damage.get("die_rolls"))
                != raw_damage
            ):
                raise ValueError("combat damage chain roll evidence diverges from total")
            if (
                raw_damage < 0 or hp_before < 0 or hp_after < 0
                or absorbed < 0 or absorbed > raw_damage
                or damage["hp_delta"] != hp_after - hp_before
                or hp_after != max(0, hp_before - (raw_damage - absorbed))
                or damage["armor_before"] < 0 or damage["armor_after"] < 0
            ):
                raise ValueError("combat damage chain arithmetic is invalid")
            target = session.participants[damage["target_actor_id"]]
            if damage.get("bypass_armor") is True:
                if absorbed != 0 or damage["armor_after"] != damage["armor_before"]:
                    raise ValueError("combat damage chain armor arithmetic is invalid")
            elif target.get("armor_rule") == "degrades_1_per_damage":
                if damage["armor_after"] != max(0, damage["armor_before"] - absorbed):
                    raise ValueError("combat damage chain armor arithmetic is invalid")
            elif damage["armor_after"] != damage["armor_before"]:
                raise ValueError("combat damage chain armor arithmetic is invalid")
            status_after = damage.get("status_after")
            if (
                not isinstance(status_after, dict)
                or set(status_after) != {"hp_current", "conditions"}
                or status_after.get("hp_current") != hp_after
                or not isinstance(status_after.get("conditions"), list)
                or len(status_after["conditions"]) != len(set(status_after["conditions"]))
                or any(value not in VALID_CONDITIONS for value in status_after["conditions"])
                or (hp_after == 0 and "unconscious" not in status_after["conditions"]
                    and "dead" not in status_after["conditions"])
                or ("dead" in status_after["conditions"] and hp_after != 0)
                or ("dying" in status_after["conditions"]
                    and "major_wound" not in status_after["conditions"])
            ):
                raise ValueError("combat damage chain status transition is invalid")
            round_row = session.rounds[round_number - 1]
            roster = {
                row.get("actor_id"): row.get("round_start_eligibility")
                for row in round_row.get("initiative_progress", [])
                if isinstance(row, dict)
            }
            continuity_key = (round_number, damage["target_actor_id"])
            expected_hp_before = last_hp_by_round_target.get(continuity_key)
            if expected_hp_before is None:
                eligibility = roster.get(damage["target_actor_id"])
                expected_hp_before = (
                    eligibility.get("hp_current") if isinstance(eligibility, dict) else None
                )
            if hp_before != expected_hp_before:
                raise ValueError("combat damage chain cross-record HP is invalid")
            last_hp_by_round_target[continuity_key] = hp_after
            expected_receipt = cls._damage_transaction_receipt(
                round_number=round_number,
                turn=turn,
                damage=damage,
                binding=binding,
            )
            if damage.get("provenance") != expected_receipt:
                raise ValueError("combat damage provenance receipt diverges")
        if set(bindings_by_damage_roll) != seen_damage_rolls:
            raise ValueError("combat turn references missing damage provenance")
        if seen_damage_rolls and not trusted_in_memory:
            cls._validate_external_damage_evidence(
                session=session,
                evidence=damage_evidence,
                turns_by_id=turns_by_id,
                damage_roll_ids=seen_damage_rolls,
                expected_command_actor=damage_evidence_actor,
            )
        if session._turn_counter < sum(len(row["turns"]) for row in session.rounds):
            raise ValueError("combat turn counter is behind round history")
        if any(
            not isinstance(row, dict)
            or set(row) != {"actor_id", "dex", "dex_reason"}
            or isinstance(row.get("dex"), bool)
            or not isinstance(row.get("dex"), int)
            or row.get("dex_reason") not in {None, "ready_firearm"}
            for row in session._current_initiative
        ):
            raise ValueError("combat initiative order is invalid")
        initiative_ids = [row.get("actor_id") for row in session._current_initiative]
        if (
            len(initiative_ids) != len(session._current_initiative)
            or len(initiative_ids) != len(set(initiative_ids))
            or any(actor_id not in session.participants for actor_id in initiative_ids)
            or session.initiative_cursor > len(session._current_initiative)
        ):
            raise ValueError("combat initiative cursor/order is invalid")
        expected_sorted = sorted(
            session._current_initiative,
            key=lambda row: (
                -row["dex"],
                -session.participants[row["actor_id"]]["combat_skill"],
                row["actor_id"],
            ),
        )
        if session._current_initiative != expected_sorted or any(
            row["dex"] != session.participants[row["actor_id"]]["dex"]
            + (50 if row["dex_reason"] == "ready_firearm" else 0)
            for row in session._current_initiative
        ):
            raise ValueError("combat initiative order is not canonical")
        if not session.rounds or session.initiative_progress != session.rounds[-1]["initiative_progress"]:
            raise ValueError("combat initiative progress does not match current round")
        progress_keys = {
            "actor_id", "round_start_eligibility", "initiative", "status",
            "skip_evidence",
        }
        eligibility_keys = {
            "hp_current", "conditions", "dex", "combat_skill",
            "firearms_skill", "has_ready_firearm",
        }
        def validate_skip_evidence(
            row: dict[str, Any], *, historical: bool,
            round_row: dict[str, Any],
        ) -> None:
            """Validate the same eligibility receipt in live and past rounds."""
            evidence = row.get("skip_evidence")
            status = row.get("status")
            prefix = "combat historical" if historical else "combat"
            if status != "skipped_ineligible":
                if evidence is not None:
                    if status == "excluded_at_round_start":
                        raise ValueError(f"{prefix} excluded initiative actor is invalid")
                    raise ValueError(f"{prefix} initiative progress has unexpected skip evidence")
                return
            if not isinstance(evidence, dict) or set(evidence) != {
                "hp_current", "conditions", "source_receipt",
            }:
                raise ValueError(f"{prefix} initiative skip lacks eligibility evidence")
            hp_current = evidence.get("hp_current")
            conditions = evidence.get("conditions")
            if (
                isinstance(hp_current, bool)
                or not isinstance(hp_current, int)
                or hp_current < 0
                or not isinstance(conditions, list)
                or len(conditions) != len(set(conditions))
                or any(value not in VALID_CONDITIONS for value in conditions)
                or (hp_current > 0 and not any(
                    value in conditions
                    for value in ("dead", "dying", "unconscious", "fled")
                ))
            ):
                raise ValueError(f"{prefix} initiative skip lacks eligibility evidence")
            expected_source = session._canonical_skip_source_receipt(
                row["actor_id"], round_row
            )
            if (
                expected_source is None
                or evidence.get("source_receipt") != expected_source
                or hp_current != expected_source["hp_current"]
                or conditions != expected_source["conditions"]
            ):
                raise ValueError(
                    f"{prefix} initiative skip source receipt diverges from history"
                )
        progress_by_actor: dict[str, dict[str, Any]] = {}
        for row in session.initiative_progress:
            if not isinstance(row, dict) or set(row) != progress_keys:
                raise ValueError("combat initiative progress is invalid")
            actor_id = row.get("actor_id")
            eligibility = row.get("round_start_eligibility")
            if (
                actor_id not in session.participants
                or actor_id in progress_by_actor
                or not isinstance(eligibility, dict)
                or set(eligibility) != eligibility_keys
                or not isinstance(eligibility.get("conditions"), list)
                or any(value not in VALID_CONDITIONS for value in eligibility["conditions"])
                or any(isinstance(eligibility.get(field), bool) or not isinstance(eligibility.get(field), int)
                       for field in ("hp_current", "dex", "combat_skill", "firearms_skill"))
                or not isinstance(eligibility.get("has_ready_firearm"), bool)
            ):
                raise ValueError("combat initiative round-start eligibility is invalid")
            progress_by_actor[actor_id] = row
        if set(progress_by_actor) != set(session.participants):
            raise ValueError("combat initiative roster omits a participant")
        expected_from_roster: list[dict[str, Any]] = []
        for actor_id, row in progress_by_actor.items():
            eligibility = row["round_start_eligibility"]
            eligible = (
                eligibility["hp_current"] > 0
                and not any(value in eligibility["conditions"] for value in
                            ("dead", "dying", "unconscious", "fled"))
            )
            initiative = row["initiative"]
            if not eligible:
                if initiative is not None or row["status"] != "excluded_at_round_start":
                    raise ValueError("combat excluded initiative actor is invalid")
                validate_skip_evidence(
                    row, historical=False, round_row=session.rounds[-1]
                )
                continue
            dex_reason = (
                "ready_firearm"
                if eligibility["has_ready_firearm"] and eligibility["firearms_skill"] > 0
                else None
            )
            expected_row = {
                "actor_id": actor_id,
                "dex": eligibility["dex"] + (50 if dex_reason else 0),
                "dex_reason": dex_reason,
            }
            if initiative != expected_row or row["status"] not in {"pending", "acted", "skipped_ineligible"}:
                raise ValueError("combat eligible initiative actor is invalid")
            validate_skip_evidence(
                row, historical=False, round_row=session.rounds[-1]
            )
            expected_from_roster.append(expected_row)
        expected_from_roster.sort(key=lambda row: (
            -row["dex"],
            -progress_by_actor[row["actor_id"]]["round_start_eligibility"]["combat_skill"],
            row["actor_id"],
        ))
        if expected_from_roster != session._current_initiative:
            raise ValueError("combat initiative order diverges from round-start roster")
        for index, initiative in enumerate(session._current_initiative):
            status = progress_by_actor[initiative["actor_id"]]["status"]
            if (index < session.initiative_cursor and status not in {"acted", "skipped_ineligible"}) or (
                index >= session.initiative_cursor and status != "pending"
            ):
                raise ValueError("combat initiative cursor diverges from persisted progress")
        # Completed rounds retain the same complete roster evidence.  This
        # prevents history edits from deleting an eligible actor even after a
        # later round has replaced the live cursor/progress view.
        for historical in session.rounds[:-1]:
            rows = historical["initiative_progress"]
            if not isinstance(rows, list) or len(rows) != len(session.participants):
                raise ValueError("combat historical initiative roster is invalid")
            by_actor: dict[str, dict[str, Any]] = {}
            reconstructed: list[dict[str, Any]] = []
            for row in rows:
                if not isinstance(row, dict) or set(row) != progress_keys:
                    raise ValueError("combat historical initiative progress is invalid")
                actor_id = row.get("actor_id")
                evidence = row.get("round_start_eligibility")
                if actor_id not in session.participants or actor_id in by_actor or not isinstance(evidence, dict) or set(evidence) != eligibility_keys:
                    raise ValueError("combat historical initiative roster is invalid")
                by_actor[actor_id] = row
                eligible = (
                    isinstance(evidence.get("hp_current"), int)
                    and not isinstance(evidence.get("hp_current"), bool)
                    and evidence["hp_current"] > 0
                    and isinstance(evidence.get("conditions"), list)
                    and not any(value in evidence["conditions"] for value in
                                ("dead", "dying", "unconscious", "fled"))
                )
                if not eligible:
                    if row.get("initiative") is not None or row.get("status") != "excluded_at_round_start":
                        raise ValueError("combat historical excluded actor is invalid")
                    validate_skip_evidence(
                        row, historical=True, round_row=historical
                    )
                    continue
                if row.get("status") not in {"acted", "skipped_ineligible"}:
                    raise ValueError("combat historical initiative progress is incomplete")
                validate_skip_evidence(
                    row, historical=True, round_row=historical
                )
                dex_reason = (
                    "ready_firearm"
                    if evidence.get("has_ready_firearm") is True and evidence.get("firearms_skill", 0) > 0
                    else None
                )
                expected_row = {
                    "actor_id": actor_id,
                    "dex": evidence.get("dex", 0) + (50 if dex_reason else 0),
                    "dex_reason": dex_reason,
                }
                if row.get("initiative") != expected_row:
                    raise ValueError("combat historical initiative entry is invalid")
                reconstructed.append(expected_row)
            if set(by_actor) != set(session.participants):
                raise ValueError("combat historical initiative roster omits a participant")
            reconstructed.sort(key=lambda row: (
                -row["dex"],
                -by_actor[row["actor_id"]]["round_start_eligibility"].get("combat_skill", 0),
                row["actor_id"],
            ))
            if reconstructed != historical["initiative_order"]:
                raise ValueError("combat historical initiative order diverges from roster")
        if session.status == "active" and session.outcome is not None:
            raise ValueError("active combat cannot have an outcome")
        if session.status == "concluded" and (
            session.outcome not in VALID_OUTCOMES - {None}
            or session.ended_at_turn is None
            or session.pending_attack is not None
        ):
            raise ValueError("concluded combat state is incoherent")
        if session.pending_attack is not None:
            pending = session.pending_attack
            legacy_pending_keys = {
                "attack_command_id", "actor_id", "target_actor_id",
                "declared_intent", "resolution_hint", "weapon_id",
                "allowed_defenses",
            }
            extended_pending_keys = legacy_pending_keys | {
                "rulebook_exception", "on_success",
                "victory_outcome", "defeat_outcome",
            }
            original_pending_keys = set(pending)
            for key in extended_pending_keys - legacy_pending_keys:
                pending.setdefault(key, None)
            on_success = pending.get("on_success")
            on_success_valid = on_success is None or (
                isinstance(on_success, dict)
                and set(on_success) == {"kind", "outcome", "rule_ref"}
                and on_success.get("kind") == "destroy_target"
                and on_success.get("outcome") in VALID_OUTCOMES - {None}
                and isinstance(on_success.get("rule_ref"), str)
                and bool(on_success["rule_ref"].strip())
            )
            authored_outcomes_valid = all(
                pending.get(field) is None
                or (
                    isinstance(pending.get(field), str)
                    and pending.get(field) in VALID_OUTCOMES - {None}
                )
                for field in ("victory_outcome", "defeat_outcome")
            )
            hint = pending.get("resolution_hint")
            expected_defenses = (
                ["dive_for_cover", "none"]
                if hint == "firearm_attack"
                else ["dodge", "fight_back"]
                if hint == "opposed_melee"
                else None
            )
            if (
                (
                    original_pending_keys != legacy_pending_keys
                    and original_pending_keys != extended_pending_keys
                )
                or not isinstance(pending.get("attack_command_id"), str)
                or not pending["attack_command_id"]
                or pending.get("actor_id") not in session.participants
                or pending.get("target_actor_id") not in session.participants
                or pending.get("actor_id") == pending.get("target_actor_id")
                or not isinstance(pending.get("declared_intent"), str)
                or not pending["declared_intent"].strip()
                or pending.get("allowed_defenses") != expected_defenses
                or (
                    pending.get("rulebook_exception") is not None
                    and not isinstance(pending.get("rulebook_exception"), str)
                )
                or not on_success_valid
                or not authored_outcomes_valid
            ):
                raise ValueError("combat pending attack contract is invalid")
            if (
                session.status != "active"
                or session.initiative_cursor >= len(session._current_initiative)
                or session._current_initiative[session.initiative_cursor]["actor_id"]
                != pending["actor_id"]
            ):
                raise ValueError("combat pending attack is not at the initiative cursor")
        return session

    def drain_pending(self) -> tuple[list[dict], list[dict]]:
        """Return and clear pending roll/event records for the harness to flush."""
        rolls = self.pending_rolls
        events = self.pending_events
        self.pending_rolls = []
        self.pending_events = []
        return rolls, events


def load_combat_state(path: Path) -> dict[str, Any]:
    """Read a combat.json snapshot (used by audit/report)."""
    return json.loads(Path(path).read_text(encoding="utf-8"))
