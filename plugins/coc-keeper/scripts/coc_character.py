#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import re
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
_COC_RULES_PATH = SCRIPT_DIR / "coc_rules.py"
_COC_RULES_SPEC = importlib.util.spec_from_file_location("coc_rules", _COC_RULES_PATH)
coc_rules = importlib.util.module_from_spec(_COC_RULES_SPEC)
assert _COC_RULES_SPEC.loader is not None
_COC_RULES_SPEC.loader.exec_module(coc_rules)


REQUIRED_CHARACTERISTICS = ("STR", "CON", "SIZ", "DEX", "APP", "INT", "POW", "EDU")
SINGLE_DIE_PATTERN = re.compile(r"^1D(?P<sides>\d+)$")


def _single_die_range(expression: str) -> tuple[int, int]:
    match = SINGLE_DIE_PATTERN.match(expression.strip().upper())
    if match is None:
        raise ValueError(f"unsupported single-die expression: {expression}")
    return 1, int(match.group("sides"))


def characteristic_generation_methods() -> dict[str, dict[str, Any]]:
    """Return configured characteristic generation methods from rules JSON."""
    rules = coc_rules.load_rule_table("characteristic-dice")
    methods = rules.get("generation_methods", {})
    if not isinstance(methods, dict):
        return {}
    return json.loads(json.dumps(methods))


def validate_characteristic_generation(method_id: str, characteristics: dict[str, int]) -> list[str]:
    """Validate generated characteristic values for the chosen creation method."""
    errors = validate_character_sheet({"id": "draft", "name": "Draft", "characteristics": characteristics})
    if errors:
        return errors

    methods = characteristic_generation_methods()
    if method_id not in methods:
        return [f"unknown characteristic generation method: {method_id}"]
    method = methods[method_id]

    if method_id == "point_buy_460":
        required = set(method.get("applies_to") or REQUIRED_CHARACTERISTICS)
        total = 0
        minimum = int(method.get("minimum", 0))
        maximum = int(method.get("maximum", 100))
        increment = int(method.get("increment", 5))
        for key in REQUIRED_CHARACTERISTICS:
            value = int(characteristics[key])
            if key not in required:
                continue
            total += value
            if value < minimum or value > maximum:
                errors.append(f"{key} must be between {minimum} and {maximum}")
            if increment and value % increment != 0:
                errors.append(f"{key} must be a multiple of {increment}")
        expected_total = int(method["total_budget"])
        if total != expected_total:
            errors.append(f"total characteristic budget {total} does not match required {expected_total}")
        return errors

    if method_id == "quick_fire_array":
        expected = sorted(int(value) for value in method.get("array", []))
        actual = sorted(int(characteristics[key]) for key in REQUIRED_CHARACTERISTICS)
        if actual != expected:
            errors.append(f"quick_fire_array values must be {expected}")
        return errors

    return errors


def derive_values(
    characteristics: dict[str, int],
    luck: int | None = None,
    *,
    age_mov_penalty: int = 0,
) -> dict[str, int | str]:
    if luck is None:
        raise ValueError(
            "Luck must be rolled as 3D6x5 and supplied; it is not derived "
            "from POW (rulebook p31)"
        )
    derived_rules = coc_rules.derived_attributes_rule()
    hp_rule = derived_rules["hit_points"]
    mp_rule = derived_rules["magic_points"]
    sanity_rule = derived_rules["sanity"]
    luck_rule = derived_rules["luck_default"]
    db_build = coc_rules.damage_bonus_build(characteristics["STR"], characteristics["SIZ"])
    movement = coc_rules.movement_rate(
        characteristics["STR"],
        characteristics["DEX"],
        characteristics["SIZ"],
        age_mov_penalty=age_mov_penalty,
    )
    return {
        "HP": sum(characteristics[source] for source in hp_rule["sources"]) // int(hp_rule["divisor"]),
        "MP": characteristics[mp_rule["source"]] // int(mp_rule["divisor"]),
        "SAN": characteristics[sanity_rule["source"]],
        "Luck": luck,
        "DB": db_build["damage_bonus"],
        "Build": db_build["build"],
        "MOV": movement["mov"],
    }


def apply_age_modifiers(
    characteristics: dict[str, int],
    age: int,
    edu_improvement_rolls: list[dict[str, Any]] | None = None,
    characteristic_reductions: list[dict[str, Any]] | None = None,
) -> dict[str, int]:
    adjusted = dict(characteristics)
    edu_improvement_rolls = edu_improvement_rolls or []
    characteristic_reductions = characteristic_reductions or []
    age_adjustment = coc_rules.age_adjustment(age)
    adjusted["EDU"] = max(0, adjusted["EDU"] - int(age_adjustment.get("edu_reduction", 0)))
    adjusted["APP"] = max(0, adjusted["APP"] - int(age_adjustment.get("app_reduction", 0)))

    required_reduction_total = int(age_adjustment.get("characteristic_reduction_total", 0))
    allowed_reduction_choices = set(age_adjustment.get("characteristic_reduction_choices", []))
    applied_reduction_total = 0
    for reduction in characteristic_reductions:
        if not isinstance(reduction, dict):
            raise ValueError("characteristic_reductions entries must be objects")
        characteristic = str(reduction.get("characteristic", ""))
        amount = int(reduction.get("amount", 0))
        if characteristic not in allowed_reduction_choices:
            raise ValueError(f"characteristic_reductions contains disallowed characteristic: {characteristic}")
        if amount <= 0:
            raise ValueError("characteristic_reductions amounts must be positive")
        adjusted[characteristic] = max(0, adjusted[characteristic] - amount)
        applied_reduction_total += amount
    if applied_reduction_total != required_reduction_total:
        raise ValueError(
            f"characteristic_reductions total {applied_reduction_total} does not match required {required_reduction_total}"
        )

    age_rules = coc_rules.load_rule_table("age-adjustments")
    required_checks = int(age_adjustment.get("edu_improvement_checks", 0))
    if len(edu_improvement_rolls) != required_checks:
        raise ValueError(f"edu_improvement_rolls count {len(edu_improvement_rolls)} does not match required {required_checks}")
    edu_maximum = int(age_rules.get("edu_maximum", 99))
    improvement_die = str(age_rules.get("edu_improvement_amount", "1D10"))
    improvement_min, improvement_max = _single_die_range(improvement_die)
    for record in edu_improvement_rolls:
        if not isinstance(record, dict):
            raise ValueError("EDU improvement checks must include roll and improvement_roll fields")
        roll = int(record["roll"])
        if roll > adjusted["EDU"]:
            improvement_roll = record.get("improvement_roll")
            if improvement_roll in (None, "", [], {}):
                raise ValueError("successful EDU improvement check requires improvement_roll")
            improvement_amount = int(improvement_roll)
            if not improvement_min <= improvement_amount <= improvement_max:
                raise ValueError(f"successful EDU improvement_roll must be within {improvement_die}")
            adjusted["EDU"] = min(edu_maximum, adjusted["EDU"] + improvement_amount)
    return adjusted


def validate_character_sheet(sheet: dict) -> list[str]:
    errors: list[str] = []
    if "id" not in sheet:
        errors.append("missing id")
    if "name" not in sheet:
        errors.append("missing name")
    characteristics = sheet.get("characteristics")
    if not isinstance(characteristics, dict):
        errors.append("missing characteristics")
        return errors
    for key in REQUIRED_CHARACTERISTICS:
        if key not in characteristics:
            errors.append(f"missing characteristic {key}")
    return errors
