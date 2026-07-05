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


# Success-level ordering (rulebook p.91). Higher = better.
LVL = {"fumble": 0, "failure": 1, "regular": 2, "hard": 3, "extreme": 4, "critical": 5}

# Valid enums for schema validation.
VALID_SIDES = {"investigator", "monster", "npc"}
VALID_ACTIONS = {"attack", "maneuver", "flee", "cast", "other", "surprise_attack"}
VALID_DEFENSE = {"fight_back", "dodge", "dive_for_cover", "none", None}
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
                        damage_bonus: str = "none") -> None:
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

    def _weapon_db_expr(self, attacker: dict, weapon: dict) -> str | None:
        """Return the attacker's DB expression if the weapon adds DB (melee),
        else None. Per Table XVII (pp.401-405), melee weapons add the attacker's
        damage bonus; firearms do not. The DB comes from the participant's
        `damage_bonus` field (e.g. '+1D4', '-2', 'none')."""
        if not weapon.get("adds_damage_bonus", False):
            return None
        db = attacker.get("damage_bonus", "none")
        if not db or str(db).lower() in ("none", "0", ""):
            return None
        return str(db)

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
        if db_expr:
            # Normalize "+1D4" → append; "-2" → append; "none"/"0" → skip.
            db = db_expr.strip()
            if db and db.lower() not in ("none", "0"):
                if not db.startswith(("+", "-")):
                    db = "+" + db
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
        "characteristic_roll", "flee",
    }
    VALID_MANEUVER_GOALS = {"disarm", "ongoing_disadvantage", "escape", "push"}

    # Backward-compat mapping: the old `action` enum maps to resolution_hint.
    _ACTION_TO_HINT = {
        "attack": None,  # decided by weapon skill (melee vs firearm)
        "surprise_attack": "surprise_attack",
        "maneuver": "maneuver",
        "cast": "spell",
        "flee": "flee",
        "other": "skill_check",
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
                                 difficulty: str = "regular") -> dict[str, Any]:
        """Resolve one combatant's turn per the rulebook's semantic model.

        The primary inputs are ``declared_intent`` (open-ended natural language
        — what the character wants to achieve) and ``resolution_hint`` (the
        Keeper's judgment of which dice mechanism applies). The legacy
        ``action`` parameter is still accepted for backward compatibility and
        is mapped to a resolution_hint when ``resolution_hint`` is not given.

        For maneuvers, ``goal`` names the structured effect on success
        (disarm / ongoing_disadvantage / escape / push, per p.119). The old
        ``maneuver_kind`` is treated as an alias for ``goal``.
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
                resolution_hint = "firearm_attack" if str(weapon.get("skill", "")).startswith("Firearms") else "opposed_melee"
            else:
                resolution_hint = self._ACTION_TO_HINT.get(action, action)
        if resolution_hint not in self.VALID_RESOLUTION_HINTS:
            raise ValueError(f"invalid resolution_hint {resolution_hint!r}")
        if defense_kind not in VALID_DEFENSE:
            raise ValueError(f"invalid defense_kind {defense_kind!r}")
        # maneuver_kind (legacy) aliases goal.
        if goal is None and maneuver_kind is not None:
            goal = maneuver_kind
        if goal is not None and goal not in self.VALID_MANEUVER_GOALS:
            raise ValueError(f"invalid goal {goal!r}; expected one of {self.VALID_MANEUVER_GOALS}")

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
            elif resolution_hint in ("opposed_melee", "firearm_attack"):
                self._resolve_attack(turn, actor_id, target_actor_id,
                                     defense_kind, weapon_id, rulebook_exception,
                                     range_band=range_band, point_blank=point_blank,
                                     cover=cover, fast_moving=fast_moving,
                                     outnumbered_penalty=outnumbered_penalty)
            elif resolution_hint == "surprise_attack":
                self._resolve_surprise_attack(turn, actor_id, target_actor_id, weapon_id)
            elif resolution_hint == "maneuver":
                self._resolve_maneuver(turn, actor_id, target_actor_id, defense_kind,
                                       goal=goal or "ongoing_disadvantage",
                                       target_weapon_id=target_weapon_id,
                                       outnumbered_penalty=outnumbered_penalty)
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

    def _resolve_attack(self, turn, actor_id, target_id, defense_kind, weapon_id,
                        rulebook_exception, range_band=None, point_blank=False,
                        cover=False, fast_moving=False, outnumbered_penalty=False):
        """Resolve one attack turn per Chapter 6.

        Firearms attacks (skill starts with 'Firearms') are unopposed — the
        target cannot fight back or dodge (p.125); they may only Dive for
        Cover (handled separately, declares defense_kind='dive_for_cover').
        Melee attacks (Fighting) are opposed: target chooses fight_back or
        dodge (p.115). Modifier dice are computed from cover / point-blank /
        range / outnumbered / fast-moving per pp.108,125.
        """
        attacker = self.participants[actor_id]
        weapon = self._weapon(actor_id, weapon_id)
        is_firearm = weapon["skill"].startswith("Firearms")

        # --- Compute attacker bonus/penalty dice (p.125) ---
        atk_bonus = 0
        atk_penalty = 0
        if is_firearm:
            # Range → difficulty (p.124): base=regular, long=hard, very long=extreme
            if range_band == "long":
                pass  # difficulty handled via difficulty param below
            # Point-Blank (p.125): bonus die within DEX/5 feet
            if point_blank:
                atk_bonus += 1
            # Cover/Concealment (p.125): target ≥half obscured → penalty die
            if cover:
                atk_penalty += 1
            # Fast-moving target (p.125): MOV 8+ → penalty die
            if fast_moving:
                atk_penalty += 1
        # Outnumbered target (p.108): if target already defended this round,
        # subsequent attackers get a bonus die. Encoded as caller flag.
        if outnumbered_penalty:
            atk_bonus += 1

        # Attacker roll
        difficulty = "regular"
        if is_firearm and range_band == "long":
            difficulty = "hard"
        elif is_firearm and range_band == "very_long":
            difficulty = "extreme"
        atk_oc, atk_rec = self._percentile(
            actor_id, weapon["skill"], attacker["combat_skill"],
            f"attack {target_id}", difficulty=difficulty,
            bonus=atk_bonus, penalty=atk_penalty, ranged=is_firearm)
        turn["roll_id"] = atk_rec["roll_id"]
        turn["attack_modifiers"] = {"bonus": atk_bonus, "penalty": atk_penalty,
                                    "range_band": range_band, "point_blank": point_blank,
                                    "cover": cover, "outnumbered_penalty": outnumbered_penalty}

        # --- Target response ---
        target = self.participants[target_id]

        # Mechanism 1: firearms cannot be fight_back/dodge (p.125), only dive_for_cover
        if is_firearm and defense_kind not in ("dive_for_cover", "none", None):
            # Caller asked for fight_back/dodge on a firearm — override per rule.
            # The target can ONLY dive for cover against firearms.
            defense_kind = "dive_for_cover"

        if defense_kind in (None, "none"):
            # Unopposed (surprise, or target chooses not to defend)
            turn["defense_kind"] = "none"
            turn["opposed_outcome"] = "unopposed"
            if LVL[atk_oc] >= LVL["regular"]:
                turn["outcome"] = "hit"
                bypass = rulebook_exception is not None
                raw, dmg_id, _ = self._damage_roll(
                    weapon["damage"], actor_id, target_id, weapon_id, turn["turn_id"],
                    bypass_armor=bypass, rulebook_exception=rulebook_exception,
                    db_expr=self._weapon_db_expr(attacker, weapon))
                turn["damage_roll_id"] = dmg_id
            else:
                turn["outcome"] = "miss"
            self._mark_defended(target_id)
            return

        if defense_kind == "dive_for_cover":
            # Mechanism 2: Dive for Cover (p.125) — only vs firearms.
            # Target makes Dodge roll. Success → attacker takes 1 penalty die
            # (re-roll). Diver forfeits next attack and can only dodge until then.
            turn["defense_kind"] = "dive_for_cover"
            dodge_target = target.get("dodge_skill") or target["combat_skill"]
            def_oc, def_rec = self._percentile(target_id, "Dodge", dodge_target,
                                               f"dive for cover vs {actor_id}")
            turn["opposed_roll_id"] = def_rec["roll_id"]
            if LVL[def_oc] >= LVL["regular"]:
                # Dive succeeds → attacker penalty die (re-roll attack with -1)
                turn["opposed_outcome"] = "dived_for_cover"
                atk_oc2, atk_rec2 = self._percentile(
                    actor_id, weapon["skill"], attacker["combat_skill"],
                    f"re-attack {target_id} after dive for cover",
                    difficulty=difficulty, bonus=atk_bonus,
                    penalty=atk_penalty + 1, ranged=is_firearm)
                turn["cover_reroll_roll_id"] = atk_rec2["roll_id"]
                # Mark diver as having dived (forfeits next attack)
                self._mark_dived_for_cover(target_id)
                if LVL[atk_oc2] >= LVL["regular"]:
                    turn["outcome"] = "hit_after_cover"
                    bypass = rulebook_exception is not None
                    raw, dmg_id, _ = self._damage_roll(
                        weapon["damage"], actor_id, target_id, weapon_id, turn["turn_id"],
                        bypass_armor=bypass, rulebook_exception=rulebook_exception)
                    turn["damage_roll_id"] = dmg_id
                else:
                    turn["outcome"] = "miss_cover"
            else:
                # Dive failed → normal unopposed firearm resolution
                turn["opposed_outcome"] = "dive_failed"
                if LVL[atk_oc] >= LVL["regular"]:
                    turn["outcome"] = "hit"
                    bypass = rulebook_exception is not None
                    raw, dmg_id, _ = self._damage_roll(
                        weapon["damage"], actor_id, target_id, weapon_id, turn["turn_id"],
                        bypass_armor=bypass, rulebook_exception=rulebook_exception)
                    turn["damage_roll_id"] = dmg_id
                else:
                    turn["outcome"] = "miss"
            self._mark_defended(target_id)
            return

        # Melee opposed resolution (Fighting vs fight_back/dodge, p.115)
        turn["defense_kind"] = defense_kind
        if defense_kind == "fight_back":
            def_oc, def_rec = self._percentile(target_id, "Fighting",
                                               target["combat_skill"],
                                               f"fight back vs {actor_id}")
        else:  # dodge
            dodge_target = target.get("dodge_skill") or target["combat_skill"]
            def_oc, def_rec = self._percentile(target_id, "Dodge", dodge_target,
                                               f"dodge vs {actor_id}")
        turn["opposed_roll_id"] = def_rec["roll_id"]
        opp = self._resolve_opposed(atk_oc, def_oc, defense_kind)
        turn["opposed_outcome"] = opp
        if opp in ("attacker_higher", "tie_attacker_wins"):
            turn["outcome"] = "hit"
            bypass = rulebook_exception is not None
            raw, dmg_id, dmg_rec = self._damage_roll(
                weapon["damage"], actor_id, target_id, weapon_id, turn["turn_id"],
                bypass_armor=bypass, rulebook_exception=rulebook_exception,
                db_expr=self._weapon_db_expr(attacker, weapon))
            # Extreme success → max damage per p.115 (only on attacker's own
            # turn in DEX order, not fight_back — caller controls this by only
            # declaring extreme on their turn).
            if LVL[atk_oc] >= LVL["extreme"]:
                self._apply_extreme_damage(dmg_rec, weapon, attacker)
            turn["damage_roll_id"] = dmg_id
        elif opp == "both_fail":
            turn["outcome"] = "no_damage"
        else:
            turn["outcome"] = "miss"
        self._mark_defended(target_id)

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
                          outnumbered_penalty: bool = False):
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
        turn["maneuver_build_difference"] = build_diff
        turn["maneuver_penalty_dice"] = penalty_dice

        atk_oc, atk_rec = self._percentile(
            actor_id, "Fighting", attacker["combat_skill"],
            f"{goal} maneuver vs {target_id}", penalty=penalty_dice)
        turn["roll_id"] = atk_rec["roll_id"]
        dk = defense_kind or "fight_back"
        turn["defense_kind"] = dk
        if target_id:
            if dk == "fight_back":
                def_oc, def_rec = self._percentile(target_id, "Fighting",
                                                   target["combat_skill"],
                                                   f"resist {goal} maneuver")
            else:
                dodge_target = target.get("dodge_skill") or target["combat_skill"]
                def_oc, def_rec = self._percentile(target_id, "Dodge", dodge_target,
                                                   f"dodge {goal} maneuver")
            turn["opposed_roll_id"] = def_rec["roll_id"]
        else:
            def_oc = "failure"
        opp = self._resolve_opposed(atk_oc, def_oc, dk)
        turn["opposed_outcome"] = opp

        if opp not in ("attacker_higher", "tie_attacker_wins"):
            turn["outcome"] = "maneuver_failed"
            self._mark_defended(target_id) if target_id else None
            return

        # Maneuver succeeded — apply the ONE goal (p.119).
        turn["outcome"] = "maneuver_success"
        if goal == "disarm" and target_id:
            wid = target_weapon_id or (target["weapons"][0].get("weapon_id")
                                       if target.get("weapons") else None
                                       if isinstance(target.get("weapons",[{}])[0], dict)
                                       else target["weapons"][0]
                                       if target.get("weapons") else None)
            if wid:
                target["weapons"] = [w for w in target["weapons"]
                                     if (w.get("weapon_id") if isinstance(w, dict) else w) != wid]
                attacker["weapons"].append(wid if isinstance(wid, str) else wid)
                turn["effect_applied"] = {"effect": "disarmed", "target_actor_id": target_id,
                                          "weapon_id": wid, "transferred_to": actor_id}
                turn["outcome"] = "disarm_success"
            else:
                turn["outcome"] = "disarm_nothing_to_take"
        elif goal == "ongoing_disadvantage" and target_id:
            # p.119: place target at ongoing disadvantage (restraint or knockdown).
            # Target gets 1 penalty die on future actions; automatically held
            # until attacker releases / incapacitated / major wound.
            self.apply_effect(target_id, "restrained", actor_id, remaining_rounds=999,
                              metadata={"goal": "ongoing_disadvantage"})
            turn["effect_applied"] = {"effect": "restrained", "target_actor_id": target_id,
                                      "held_by": actor_id}
            turn["outcome"] = "restrain_success"
        elif goal == "escape":
            # p.119: break out of a hold (bear hug / neck lock / restraint).
            actor_effs = attacker.get("active_effects", [])
            restraint = next((e for e in actor_effs if e["effect"] == "restrained"), None)
            if restraint:
                attacker["active_effects"] = [e for e in actor_effs if e is not restraint]
                turn["effect_applied"] = {"effect": "broke_free", "target_actor_id": actor_id}
                turn["outcome"] = "escape_success"
            else:
                turn["outcome"] = "escape_nothing_to_escape"
        elif goal == "push":
            # p.119: push/throw/knockdown. Damage (if any, e.g. fall) is a
            # separate damage_only turn — the maneuver itself just moves the
            # target. Mark target prone for narrative continuity.
            if target_id and "prone" not in target["conditions"]:
                target["conditions"].append("prone")
            turn["effect_applied"] = {"effect": "pushed", "target_actor_id": target_id}
            turn["outcome"] = "push_success"
        else:
            turn["effect_applied"] = {"effect": goal, "target_actor_id": target_id}
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
        if target_id is None or target_id not in self.participants:
            return
        p = self.participants[target_id]
        # major_wound: single hit damage >= half hp_max (p.119)
        half_max = p["hp_max"] // 2
        for d in self.damage_chain:
            if d["target_actor_id"] == target_id and d.get("rulebook_exception"):
                continue
        # Recompute major_wound based on worst single hit
        worst_single = 0
        for d in self.damage_chain:
            if d["target_actor_id"] == target_id:
                # damage that landed (post-armor)
                landed = -d["hp_delta"]
                if landed > worst_single:
                    worst_single = landed
        if worst_single >= half_max and worst_single > 0:
            if "major_wound" not in p["conditions"]:
                p["conditions"].append("major_wound")
        # dying / unconscious at 0 hp
        if p["hp_current"] == 0:
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
        path.write_text(json.dumps(self.snapshot(), ensure_ascii=False, indent=2),
                        encoding="utf-8")
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
