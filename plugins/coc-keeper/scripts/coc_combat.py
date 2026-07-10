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
VALID_CONDITIONS = {"major_wound", "dying", "unconscious", "prone",
                     "grappled", "surprised", "outnumbered"}
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

    # ------------------------------------------------------------------ #
    # Participant management
    # ------------------------------------------------------------------ #
    def add_participant(self, actor_id: str, side: str, dex: int, combat_skill: int,
                        build: int, hp_max: int, magic_points: int = 0,
                        armor: int = 0, armor_rule: str | None = None,
                        weapons: list[dict] | None = None,
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
        self.rounds.append({
            "round": self._current_round,
            "initiative_order": [dict(item) for item in self._current_initiative],
            "turns": [],
        })
        return self._current_round

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

    def _roll_id(self) -> str:
        # Stable id; the harness may remap to its global roll sequence.
        self._roll_counter += 1
        return f"cr{self._roll_counter}"

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
        record = {
            "roll_id": roll_id,
            "actor_id": actor_id,
            "skill": skill,
            "goal": goal,
            "target": target,
            "roll": res["roll"],
            "outcome": res["outcome"],
            "difficulty": difficulty,
            "bonus": bonus,
            "penalty": penalty,
            "ranged": ranged,
            "marker": f"[roll]{actor_id} {skill}{target}{mod_str}:(d100->{res['roll']})->{res['outcome']}[/roll]",
        }
        self.pending_rolls.append(record)
        return res["outcome"], record

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
                                 defender_goal: str | None = None) -> dict[str, Any]:
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
                                     defender_goal=defender_goal)
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
                        dive_for_cover_actors=None, defender_goal=None):
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
        opp = self._resolve_opposed(atk_oc, def_oc, opp_kind)
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
            # Fight back deals damage to the attacker (existing behaviour via miss;
            # keep outcome as miss — damage-on-fight-back is optional narrative).
            turn["outcome"] = "miss"
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
                target["weapons"] = [
                    w for w in target["weapons"]
                    if (w.get("weapon_id") if isinstance(w, dict) else w) != wid]
                attacker["weapons"].append(wid if isinstance(wid, str) else wid)
                turn["effect_applied"] = {
                    "effect": "disarmed", "target_actor_id": target_id,
                    "weapon_id": wid, "transferred_to": actor_id,
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
        half_max = p["hp_max"] // 2
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
            con_res = coc_roll.percentile_check(int(p.get("con", 50)), rng=self._rng)
            if con_res.get("outcome") in ("failure", "fumble"):
                if "unconscious" not in p["conditions"]:
                    p["conditions"].append("unconscious")
            # Recorded on the participant (not damage_chain) so damage-chain
            # consumers keep seeing pure damage records.
            p["major_wound_con"] = con_res.get("outcome")
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

    # ------------------------------------------------------------------ #
    # Persistence
    # ------------------------------------------------------------------ #
    def snapshot(self) -> dict[str, Any]:
        return {
            "combat_id": self.combat_id,
            "scene_ref": self.scene_ref,
            "started_at_turn": self.started_at_turn,
            "ended_at_turn": self.ended_at_turn,
            "status": self.status,
            "outcome": self.outcome,
            "participants": [dict(p) for p in self.participants.values()],
            "rounds": [dict(r) for r in self.rounds],
            "damage_chain": [dict(d) for d in self.damage_chain],
        }

    def save(self, campaign_dir: Path) -> Path:
        save_dir = campaign_dir / "save"
        save_dir.mkdir(parents=True, exist_ok=True)
        path = save_dir / "combat.json"
        coc_fileio.write_json_atomic(
            path, self.snapshot(), indent=2, ensure_ascii=False, trailing_newline=False
        )
        return path

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
