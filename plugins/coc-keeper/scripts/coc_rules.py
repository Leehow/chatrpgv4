#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
PLUGIN_ROOT = SCRIPT_DIR.parent
RULES_DIR = PLUGIN_ROOT / "references" / "rules-json"

if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import coc_cache  # noqa: E402


def rules_dir() -> Path:
    return RULES_DIR


def load_rule_table(name: str) -> Any:
    path = RULES_DIR / f"{name}.json"
    return coc_cache.load_json_cached(path)


def load_rule_index() -> dict[str, Any]:
    return load_rule_table("rule-index")


def rule_ids() -> set[str]:
    index = load_rule_index()
    rules = index.get("rules", [])
    if not isinstance(rules, list):
        return set()
    return {
        rule["id"]
        for rule in rules
        if isinstance(rule, dict) and isinstance(rule.get("id"), str)
    }


def resolve_rule_refs(refs: list[str]) -> list[dict[str, Any]]:
    by_id = {
        rule["id"]: rule
        for rule in load_rule_index().get("rules", [])
        if isinstance(rule, dict) and isinstance(rule.get("id"), str)
    }
    return [by_id[ref] for ref in refs if ref in by_id]


def percentile_check_rule() -> dict[str, Any]:
    table = load_rule_table("percentile-check")
    return {
        "die": str(table["die"]),
        "minimum_roll": int(table["minimum_roll"]),
        "maximum_roll": int(table["maximum_roll"]),
        "minimum_target": int(table["minimum_target"]),
        "maximum_target": int(table["maximum_target"]),
        "success_if_roll_lte_effective_target": bool(table["success_if_roll_lte_effective_target"]),
        "zero_zero_result": int(table["zero_zero_result"]),
        "digit_base": int(table["digit_base"]),
    }


def roll_modifiers_rule() -> dict[str, Any]:
    table = load_rule_table("roll-modifiers")
    cancellation = table["cancellation"]
    bonus_die = table["bonus_die"]
    penalty_die = table["penalty_die"]
    return {
        "applies_to": str(table["applies_to"]),
        "cancellation": {
            "method": str(cancellation["method"]),
            "net_bonus_formula": str(cancellation["net_bonus_formula"]),
            "net_penalty_formula": str(cancellation["net_penalty_formula"]),
        },
        "bonus_die": {
            "extra_tens_dice_per_die": int(bonus_die["extra_tens_dice_per_die"]),
            "selected_tens": str(bonus_die["selected_tens"]),
            "uses_same_units_die": bool(bonus_die["uses_same_units_die"]),
        },
        "penalty_die": {
            "extra_tens_dice_per_die": int(penalty_die["extra_tens_dice_per_die"]),
            "selected_tens": str(penalty_die["selected_tens"]),
            "uses_same_units_die": bool(penalty_die["uses_same_units_die"]),
        },
    }


def pushed_roll_rule() -> dict[str, Any]:
    table = load_rule_table("pushed-roll")
    return {
        "maximum_attempts_after_initial_failure": int(table["maximum_attempts_after_initial_failure"]),
        "requires_changed_approach": bool(table["requires_changed_approach"]),
        "requires_keeper_foreshadowed_failure": bool(table["requires_keeper_foreshadowed_failure"]),
        "requires_keeper_owned_failure_consequence": bool(table["requires_keeper_owned_failure_consequence"]),
        "requires_player_confirmation": bool(table["requires_player_confirmation"]),
        "required_stages": [str(stage) for stage in table["required_stages"]],
    }


def chase_rule() -> dict[str, Any]:
    table = load_rule_table("chase")
    movement_actions = table["movement_actions"]
    pushed_rolls = table["pushed_rolls"]
    return {
        "movement_actions": {
            "base_movement_actions": int(movement_actions["base_movement_actions"]),
            "extra_actions_per_mov_above_slowest": int(movement_actions["extra_actions_per_mov_above_slowest"]),
            "minimum_movement_actions": int(movement_actions["minimum_movement_actions"]),
        },
        "pushed_rolls": {
            "allowed_inside_active_chase": bool(pushed_rolls["allowed_inside_active_chase"]),
            "applies_to": [str(item) for item in pushed_rolls["applies_to"]],
        },
    }


def combined_roll_rule() -> dict[str, Any]:
    table = load_rule_table("combat")["combined_roll"]
    teamwork = table.get("teamwork", {})
    return {
        "roll_count": int(table["roll_count"]),
        "minimum_compared_targets": int(table["minimum_compared_targets"]),
        "requires_compared_targets": bool(table["requires_compared_targets"]),
        "success_if_roll_lte_any_target": bool(table["success_if_roll_lte_any_target"]),
        "teamwork": {
            "lead_uses_highest_skill": bool(teamwork.get("lead_uses_highest_skill", False)),
            "helpers_grant_bonus_die_per_helper": bool(teamwork.get("helpers_grant_bonus_die_per_helper", False)),
            "max_bonus_dice": int(teamwork.get("max_bonus_dice", 0)),
        },
    }


def opposed_roll_rule() -> dict[str, Any]:
    table = load_rule_table("combat")["opposed_roll"]
    return {
        "participant_rolls": int(table["participant_rolls"]),
        "requires_mutually_exclusive_goals": bool(table["requires_mutually_exclusive_goals"]),
        "uses_success_level_order": bool(table["uses_success_level_order"]),
        "tie_breakers": [str(item) for item in table["tie_breakers"]],
        "can_be_pushed": bool(table["can_be_pushed"]),
    }


def combat_rule() -> dict[str, Any]:
    table = load_rule_table("combat")["melee_combat"]
    order = table["order"]
    attack_vs_dodge = table["attack_vs_dodge"]
    attack_vs_fight_back = table["attack_vs_fight_back"]
    maneuver = table["maneuver"]
    return {
        "order": {
            "sort_key": str(order["sort_key"]),
            "direction": str(order["direction"]),
        },
        "actions_per_round": int(table["actions_per_round"]),
        "uses_percentile_check": bool(table["uses_percentile_check"]),
        "uses_success_level": bool(table["uses_success_level"]),
        "combat_rolls_can_be_pushed": bool(table["combat_rolls_can_be_pushed"]),
        "defense_options": [str(item) for item in table["defense_options"]],
        "attack_vs_dodge": {
            "attacker_requires_higher_success_level": bool(attack_vs_dodge["attacker_requires_higher_success_level"]),
            "tie_winner": str(attack_vs_dodge["tie_winner"]),
            "both_fail_damage": bool(attack_vs_dodge["both_fail_damage"]),
        },
        "attack_vs_fight_back": {
            "higher_success_level_wins": bool(attack_vs_fight_back["higher_success_level_wins"]),
            "tie_winner": str(attack_vs_fight_back["tie_winner"]),
            "both_fail_damage": bool(attack_vs_fight_back["both_fail_damage"]),
        },
        "maneuver": {
            "build_difference_impossible_at": int(maneuver["build_difference_impossible_at"]),
            "penalty_die_per_build_difference": int(maneuver["penalty_die_per_build_difference"]),
            "attack_vs_dodge_tie_winner": str(maneuver["attack_vs_dodge_tie_winner"]),
            "attack_vs_fight_back_tie_winner": str(maneuver["attack_vs_fight_back_tie_winner"]),
        },
    }


def special_damage_effects_rule() -> dict[str, Any]:
    """Return the special-damage-effects block (Stun/Burn/+DB + table markers).

    Source: Keeper Rulebook Table XVII Key (pp.405-406). These define the
    tags that appear in weapon damage expressions like '1D6+burn' or '1D3+stun'.
    """
    table = load_rule_table("combat")["special_damage_effects"]
    return {
        "stun": {
            "effect": str(table["stun"]["effect"]),
            "duration": str(table["stun"]["duration"]),
            "duration_keeper_discretion": bool(table["stun"]["duration_keeper_discretion"]),
        },
        "burn": {
            "luck_roll_to_avoid_ignition": bool(table["burn"]["luck_roll_to_avoid_ignition"]),
            "on_ignition": str(table["burn"]["on_ignition"]),
            "escalation": str(table["burn"]["escalation"]),
            "requires_flammable_target": bool(table["burn"]["requires_flammable_target"]),
        },
        "plus_db": {
            "effect": str(table["plus_db"]["effect"]),
            "varies_by_individual": bool(table["plus_db"]["varies_by_individual"]),
        },
        "weapon_table_markers": {
            "impale_marker": str(table["weapon_table_markers"]["impale_marker"]),
            "special_marker": str(table["weapon_table_markers"]["special_marker"]),
        },
    }


def damage_rule() -> dict[str, Any]:
    table = load_rule_table("damage")
    return {
        "resource": str(table["resource"]),
        "dice_kind": str(table["dice_kind"]),
        "requires_roll_id": bool(table["requires_roll_id"]),
        "requires_die": bool(table["requires_die"]),
        "requires_roll_total": bool(table["requires_roll_total"]),
        "requires_resource_before_delta_after": bool(table["requires_resource_before_delta_after"]),
        "delta_sign": str(table["delta_sign"]),
        "non_percentile": bool(table["non_percentile"]),
    }


def reward_rule() -> dict[str, Any]:
    table = load_rule_table("reward")
    return {
        "resource": str(table["resource"]),
        "dice_kind": str(table["dice_kind"]),
        "requires_roll_id": bool(table["requires_roll_id"]),
        "requires_die": bool(table["requires_die"]),
        "requires_roll_total": bool(table["requires_roll_total"]),
        "requires_resource_before_delta_after": bool(table["requires_resource_before_delta_after"]),
        "delta_sign": str(table["delta_sign"]),
        "non_percentile": bool(table["non_percentile"]),
    }


def _json_copy(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _json_copy(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_copy(item) for item in value]
    return value


def module_rules(scenario_id: str) -> dict[str, Any]:
    table = load_rule_table(scenario_id)
    return {
        "scenario_id": str(table["scenario_id"]),
        "rules": _json_copy(table["rules"]),
    }


def the_haunting_rules() -> dict[str, Any]:
    """Backward-compatible wrapper; prefer module_rules('the-haunting')."""
    return module_rules("the-haunting")


def _threshold_value(value: int, key: str) -> int:
    table = load_rule_table("half-fifth-values")
    divisor = int(table[key]["divisor"])
    return value // divisor


def half_value(value: int) -> int:
    return _threshold_value(value, "half")


def fifth_value(value: int) -> int:
    return _threshold_value(value, "fifth")


def difficulty_target(target: int, difficulty: str) -> int:
    table = load_rule_table("difficulty-levels")
    if difficulty not in table:
        raise ValueError(f"unsupported difficulty: {difficulty}")
    block = table[difficulty]
    if not isinstance(block, dict) or "divisor" not in block:
        # "from_opponent" is a lookup block, not a divisor-based difficulty.
        raise ValueError(f"difficulty {difficulty!r} has no divisor; "
                         f"use difficulty_from_opponent() instead")
    divisor = int(block["divisor"])
    return target // divisor


def difficulty_from_opponent(opponent_skill: int) -> str:
    """Return the difficulty level imposed by an opponent's skill (p.83).

    In an opposed roll, the opponent's skill determines the success level the
    actor must beat: opponent skill <50 -> Regular, 50-89 -> Hard, 90+ ->
    Extreme (Keeper Rulebook p.83).
    """
    table = load_rule_table("difficulty-levels")
    block = table.get("from_opponent", {})
    threshold_regular = int(block.get("threshold_regular", 50))
    threshold_hard = int(block.get("threshold_hard", 90))
    skill = int(opponent_skill)
    if skill >= threshold_hard:
        return "extreme"
    if skill >= threshold_regular:
        return "hard"
    return "regular"


def damage_bonus_build(str_value: int, siz_value: int) -> dict[str, int | str]:
    total = str_value + siz_value
    rows = load_rule_table("damage-bonus-build")
    for row in rows:
        if row["min"] <= total <= row["max"]:
            result: dict[str, int | str] = {
                "total": total,
                "damage_bonus": row["damage_bonus"],
                "build": row["build"],
            }
            extrapolation = row.get("extrapolation")
            if extrapolation is not None and total > extrapolation["applies_when_total_greater_than"]:
                excess = total - extrapolation["applies_when_total_greater_than"]
                steps = (excess + extrapolation["per_80_points"] - 1) // extrapolation["per_80_points"]
                base_db = 5  # last fixed row is +5D6 (build 6)
                base_build = 6
                result["damage_bonus"] = f"+{base_db + steps}D6"
                result["build"] = base_build + steps
            return result
    raise ValueError(f"STR+SIZ total out of V1 table range: {total}")


def weapons_table() -> dict[str, Any]:
    """Return the full Table XVII weapons table (Keeper Rulebook pp.401-405)."""
    return load_rule_table("weapons")["weapons"]


def weapon_by_name(name: str) -> dict[str, Any]:
    """Look up a weapon by its ASCII snake_case key (e.g. 'revolver_38').

    Returns the weapon row dict. Raises KeyError if the name is unknown.
    Source: Table XVII (pp.401-405).
    """
    row = weapons_table().get(name)
    if row is None:
        raise KeyError(f"unknown weapon: {name!r}")
    return row


def characteristic_dice() -> dict[str, Any]:
    """Return the Chapter 3 characteristic dice table (Keeper Rulebook pp.30-31).

    The table maps each of the 9 characteristics (STR, CON, SIZ, DEX, APP, INT,
    POW, EDU, Luck) to its roll expression. The top-level `multiplier` is 5
    (rulebook p31: 'any references to a characteristic are to the full value
    (dice roll multiplied by five)'). Luck is independent of POW.
    """
    return load_rule_table("characteristic-dice")["characteristics"]


def characteristic_dice_for(name: str) -> str:
    """Return the dice expression for one characteristic (e.g. 'STR' -> '3D6').

    Raises KeyError if the characteristic name is unknown.
    Source: Keeper Rulebook pp.30-31.
    """
    row = characteristic_dice().get(name)
    if row is None:
        raise KeyError(f"unknown characteristic: {name!r}")
    return str(row["dice"])


def skills_table() -> dict[str, Any]:
    """Return the Chapter 4 Skill List (Keeper Rulebook p.56 / PDF idx 55).

    Maps each canonical skill name to {base_chance, group, modern_only, uncommon}.
    """
    return load_rule_table("skills")["skills"]


def skill_by_name(name: str) -> dict[str, Any]:
    """Look up a skill by its canonical name (e.g. 'Library Use', 'Fighting (Brawl)').

    Returns the skill row dict. Raises KeyError if the name is unknown.
    Source: Keeper Rulebook p.56 (PDF idx 55).
    """
    row = skills_table().get(name)
    if row is None:
        raise KeyError(f"unknown skill: {name!r}")
    return row



def occupations_table() -> dict[str, Any]:
    """Return the Chapter 3 Sample Occupations (Keeper Rulebook pp.40-41).

    Maps each canonical occupation name to {credit_rating_range,
    skill_point_formula, occupational_skills, tags, source_page}.
    """
    return load_rule_table("occupations")["occupations"]


def occupation_by_name(name: str) -> dict[str, Any]:
    """Look up an occupation by its canonical name (e.g. 'Journalist').

    Returns the occupation row dict. Raises KeyError if unknown.
    Source: Keeper Rulebook pp.40-41.
    """
    row = occupations_table().get(name)
    if row is None:
        raise KeyError(f"unknown occupation: {name!r}")
    return row

def skill_specialization_groups() -> dict[str, Any]:
    """Return the group-skill (G) specialization breakdown (Keeper Rulebook p.56)."""
    return load_rule_table("skills")["specialization_groups"]


def _relation_to_siz(value: int, siz_value: int) -> str:
    if value < siz_value:
        return "less_than"
    if value > siz_value:
        return "greater_than"
    return "equal_to"


def _relation_matches(expected: Any, actual: str) -> bool:
    if expected == "any":
        return True
    if isinstance(expected, list):
        return actual in expected
    return expected == actual


def movement_rate(
    str_value: int,
    dex_value: int,
    siz_value: int,
    *,
    age_mov_penalty: int = 0,
) -> dict[str, Any]:
    str_relation = _relation_to_siz(str_value, siz_value)
    dex_relation = _relation_to_siz(dex_value, siz_value)
    table = load_rule_table("movement-rate")
    minimum_mov = table.get("age_penalty", {}).get("minimum_mov", 0)
    for row in table.get("rules", []):
        if not isinstance(row, dict):
            continue
        if not _relation_matches(row.get("str_relation_to_siz"), str_relation):
            continue
        if not _relation_matches(row.get("dex_relation_to_siz"), dex_relation):
            continue
        base_mov = int(row["base_mov"])
        return {
            "rule_key": row["key"],
            "str_relation_to_siz": str_relation,
            "dex_relation_to_siz": dex_relation,
            "base_mov": base_mov,
            "age_mov_penalty": age_mov_penalty,
            "mov": max(int(minimum_mov), base_mov - age_mov_penalty),
            "formula": row["formula"],
        }
    raise ValueError(f"no movement-rate rule matched STR={str_value} DEX={dex_value} SIZ={siz_value}")


def derived_attributes_rule() -> dict[str, Any]:
    table = load_rule_table("derived-attributes")
    hit_points = table["hit_points"]
    magic_points = table["magic_points"]
    sanity = table["sanity"]
    luck_default = table["luck_default"]
    return {
        "hit_points": {
            "sources": [str(source) for source in hit_points["sources"]],
            "divisor": int(hit_points["divisor"]),
            "rounding": str(hit_points["rounding"]),
        },
        "magic_points": {
            "source": str(magic_points["source"]),
            "divisor": int(magic_points["divisor"]),
            "rounding": str(magic_points["rounding"]),
        },
        "sanity": {
            "source": str(sanity["source"]),
        },
        "luck_default": {
            "source": str(luck_default["source"]),
            "formula": str(luck_default.get("formula", "3D6")),
            "multiplier": int(luck_default.get("multiplier", 5)),
            "independent_of_pow": bool(luck_default.get("independent_of_pow", True)),
        },
    }


def age_adjustment(age: int) -> dict[str, Any]:
    table = load_rule_table("age-adjustments")
    minimum_age = int(table.get("minimum_age", 0))
    maximum_age = int(table.get("maximum_age", 0))
    if age < minimum_age or age > maximum_age:
        raise ValueError(f"age out of supported range: {age}")
    for row in table.get("brackets", []):
        if not isinstance(row, dict):
            continue
        if int(row["min_age"]) <= age <= int(row["max_age"]):
            result = dict(row)
            result["age"] = age
            return result
    raise ValueError(f"no age adjustment bracket matched age={age}")


def _finance_amount(amount: float | int | None, currency: str = "USD", formula: str | None = None) -> dict[str, Any]:
    value: dict[str, Any] = {
        "amount": amount,
        "currency": currency,
    }
    if formula:
        value["formula"] = formula
    return value


def cash_and_assets(credit_rating: int, period: str = "1920s") -> dict[str, Any]:
    table = load_rule_table("cash-assets")
    periods = table.get("periods", {})
    if not isinstance(periods, dict) or period not in periods:
        raise ValueError(f"unsupported finance period: {period}")
    rows = periods[period]
    if not isinstance(rows, list):
        raise ValueError(f"cash-assets table period is not a list: {period}")
    currency = str(table.get("currency") or "USD")
    for row in rows:
        if not isinstance(row, dict):
            continue
        if row["credit_rating_min"] <= credit_rating <= row["credit_rating_max"]:
            cash_formula = None
            cash_amount = row.get("cash")
            if "cash_multiplier" in row:
                cash_formula = f"CR x {row['cash_multiplier']}"
                cash_amount = credit_rating * row["cash_multiplier"]
            assets_formula = None
            assets_amount = row.get("assets")
            if "assets_multiplier" in row:
                assets_formula = f"CR x {row['assets_multiplier']}"
                assets_amount = credit_rating * row["assets_multiplier"]
            elif "assets_minimum" in row:
                assets_formula = "minimum"
                assets_amount = row["assets_minimum"]
            elif assets_amount is None:
                assets_formula = "None"
            return {
                "credit_rating": credit_rating,
                "living_standard": row["living_standard"],
                "cash": _finance_amount(cash_amount, currency, cash_formula),
                "assets": _finance_amount(assets_amount, currency, assets_formula),
                "spending_level": _finance_amount(row.get("spending_level"), currency),
                "period": period,
            }
    raise ValueError(f"credit rating out of cash-assets table range: {credit_rating}")


def _is_fumble(roll: int, target: int) -> bool:
    table = load_rule_table("success-levels")["fumble"]
    threshold = int(table["target_threshold"])
    key = "target_below_threshold" if target < threshold else "target_at_or_above_threshold"
    lower, upper = table[key]
    return lower <= roll <= upper


def success_level(roll: int, target: int) -> str:
    percentile_rule = percentile_check_rule()
    min_roll = int(percentile_rule["minimum_roll"])
    max_roll = int(percentile_rule["maximum_roll"])
    min_target = int(percentile_rule["minimum_target"])
    max_target = int(percentile_rule["maximum_target"])
    if not min_roll <= roll <= max_roll:
        raise ValueError(f"roll must be between {min_roll} and {max_roll}")
    if not min_target <= target <= max_target:
        raise ValueError(f"target must be between {min_target} and {max_target}")
    if roll == load_rule_table("success-levels")["critical_roll"]:
        return "critical"
    if _is_fumble(roll, target):
        return "fumble"
    if roll <= fifth_value(target):
        return "extreme"
    if roll <= half_value(target):
        return "hard"
    if roll <= target:
        return "regular"
    return "failure"


def spells_table() -> dict[str, Any]:
    """Return the Chapter 12 Grimoire spell data (Keeper Rulebook pp.258-277)."""
    return load_rule_table("spells")

def spell_by_name(name: str) -> dict[str, Any]:
    """Look up a spell by name (e.g. 'Flesh Ward'). Raises KeyError if unknown."""
    for spell in spells_table().get("spells", []):
        if spell["name"].lower() == name.lower():
            return spell
    raise KeyError(f"unknown spell: {name!r}")

def magic_casting_rules() -> dict[str, Any]:
    """Return the casting mechanics block (Hard POW first cast, pushable, etc.)."""
    return spells_table().get("casting", {})

def magic_learning_rules() -> dict[str, Any]:
    """Return the learning mechanics block (Hard INT, 2D6 weeks from tome)."""
    return spells_table().get("learning", {})

def magic_mp_economy() -> dict[str, Any]:
    """Return the magic point economy block (POW/5, regen rates, HP overspill)."""
    return spells_table().get("mp_economy", {})



def tomes_table() -> dict[str, Any]:
    """Return the Chapter 11 Tomes data (Keeper Rulebook pp.226-249).
    Tomes are keyed by canonical name, each with full_study_weeks,
    sanity_cost, cthulhu_mythos_initial, cthulhu_mythos_full, mythos_rating.
    """
    return load_rule_table("tomes").get("tomes", {})

def tome_by_name(name: str) -> dict[str, Any]:
    """Look up a tome by name. Raises KeyError if unknown."""
    table = tomes_table()
    if name in table:
        return table[name]
    raise KeyError(f"unknown tome: {name!r}")


def monsters_table() -> dict[str, Any]:
    """Return the Chapter 14 Monsters data."""
    return load_rule_table("monsters").get("monsters", {})

def monster_by_name(name: str) -> dict[str, Any]:
    """Look up a monster by name. Raises KeyError if unknown."""
    table = monsters_table()
    if name in table:
        return table[name]
    raise KeyError(f"unknown monster: {name!r}")

def bout_realtime_table() -> list:
    """Return Table VII Bouts of Madness - Real Time (p.156)."""
    return load_rule_table("bout-tables").get("realtime", [])

def bout_summary_table() -> list:
    """Return Table VIII Bouts of Madness - Summary (p.159)."""
    return load_rule_table("bout-tables").get("summary", [])

def phobias_table() -> dict[str, Any]:
    """Return Table IX Sample Phobias (p.160)."""
    return load_rule_table("phobias").get("phobias", {})

def manias_table() -> dict[str, Any]:
    """Return Table X Sample Manias (p.161)."""
    return load_rule_table("manias").get("manias", {})

def equipment_table() -> dict[str, Any]:
    """Return the equipment price list."""
    return load_rule_table("equipment").get("periods", {})

def poisons_table() -> dict[str, Any]:
    """Return the sample poisons."""
    return load_rule_table("poisons").get("poisons", {})

def hazards_table() -> dict[str, Any]:
    """Return Table III other-forms-of-damage severity + presets (p.124)."""
    return load_rule_table("hazards")

def artifacts_table() -> dict[str, Any]:
    """Return the artifacts and alien devices."""
    return load_rule_table("artifacts").get("artifacts", {})

def sanity_max_formula() -> dict[str, Any]:
    """Return the maximum Sanity formula block (Keeper Rulebook p.167, F9).

    Maximum Sanity = 99 minus the current Cthulhu Mythos skill.
    """
    return load_rule_table("sanity").get("max_san", {})

def luck_rule() -> dict[str, Any]:
    """Return the Luck rule block (Keeper Rulebook pp.93-95)."""
    table = load_rule_table("luck")
    spend = table.get("spend", {})
    roll = table.get("roll", {})
    recovery = table.get("recovery", {})
    return {
        "spend": {
            "luck_point_value": int(spend.get("luck_point_value", 1)),
            "cost_per_point_off_roll": int(spend.get("cost_per_point_off_roll", 1)),
            "applies": spend.get("applies", "lower_total_roll_toward_target"),
            "constraints": [str(c) for c in spend.get("constraints", [])],
        },
        "roll": {
            "use": roll.get("use", "group_luck_check"),
            "group_roll_policy": roll.get("group_roll_policy", "take_lowest"),
        },
        "recovery": {
            "applies_when": recovery.get("applies_when", "after_each_session"),
            "check": recovery.get("check", "1D100 > current_luck"),
            "gain_on_success": recovery.get("gain_on_success", "1D10"),
            "cap": int(recovery.get("cap", 99)),
            "optional_rule": bool(recovery.get("optional_rule", False)),
        },
    }

def development_rule() -> dict[str, Any]:
    """Return the Investigator Development Phase rule block (pp.94-95)."""
    table = load_rule_table("development")
    tick = table.get("tick", {})
    improvement = table.get("improvement_roll", {})
    return {
        "tick": {
            "awarded_when": tick.get("awarded_when", "regular_or_hard_or_extreme_success"),
            "ticks_per_qualifying_success": int(tick.get("ticks_per_qualifying_success", 1)),
            "excluded_outcomes": tick.get("excluded_outcomes", []),
            "never_tick_skills": [str(s) for s in tick.get("never_tick_skills", [])],
        },
        "improvement_roll": {
            "check": improvement.get("check", "1D100 > current_skill or 1D100 > 95"),
            "always_improves_above": int(improvement.get("always_improves_above", 95)),
            "gain_on_success": improvement.get("gain_on_success", "1D10"),
            "cap_for_san_reward": int(improvement.get("cap_for_san_reward", 90)),
        },
        "sanity_reward": sanity_reward_rule(),
    }


def sanity_reward_rule() -> dict[str, Any]:
    """Return the SAN-reward-at-skill-90 block (p.95).

    When a skill reaches 90% or above via a development improvement roll, the
    investigator gains 2D6 Sanity (capped at max SAN).
    """
    table = load_rule_table("development")
    reward = table.get("sanity_reward", {})
    return {
        "applies_when": reward.get("applies_when", "skill_reaches_90_or_above_via_development"),
        "reward": reward.get("reward", "2D6"),
        "constraint": reward.get("constraint", "cannot_exceed_max_san"),
    }


def treatment_rule() -> dict[str, Any]:
    """Return the sanity treatment rule block (Keeper Rulebook p.164).

    Recovery paths for indefinite insanity: weekly Psychoanalysis, asylum
    confinement (1D6 months, resolved by a Psychoanalysis roll at release),
    and self-help via a SAN roll. Mirrors the PsychotherapySession
    implementation in coc_healing.py.
    """
    return load_rule_table("treatment")
