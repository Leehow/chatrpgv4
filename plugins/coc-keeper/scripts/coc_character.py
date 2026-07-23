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


def materialize_quick_fire_create_sheet(
    sheet: dict[str, Any],
    creation: dict[str, Any] | None,
) -> dict[str, Any]:
    """Materialize fixed Quick Fire numbers from a semantic assignment order.

    The Keeper chooses which characteristic receives each priority slot and
    supplies the authoritative 3D6 Luck total. The deterministic rules layer
    owns copying the configured array, multiplying Luck, and deriving stats.
    Legacy callers that submit a complete sheet remain unchanged.
    """
    materialized = json.loads(json.dumps(sheet))
    if not isinstance(creation, dict):
        return materialized
    assignment = creation.get("characteristic_assignment_order")
    luck_roll_total = creation.get("luck_roll_total")
    if assignment is None and luck_roll_total is None:
        return materialized
    if creation.get("method") != "quick_fire_array":
        raise ValueError(
            "characteristic_assignment_order/luck_roll_total require "
            "creation.method=quick_fire_array. Full Quick Fire creation = "
            "{method:'quick_fire_array', characteristic_assignment_order:"
            "[STR,CON,SIZ,DEX,APP,INT,POW,EDU in the Keeper's chosen priority "
            "order], luck_roll_total: integer 3..18}. Sheet must omit "
            "characteristics/derived; the deterministic layer computes them."
        )
    if "characteristics" in materialized or "derived" in materialized:
        raise ValueError(
            "deterministic Quick Fire materialization requires sheet to omit "
            "characteristics and derived"
        )
    if (
        not isinstance(assignment, list)
        or len(assignment) != len(REQUIRED_CHARACTERISTICS)
        or any(not isinstance(key, str) for key in assignment)
        or set(assignment) != set(REQUIRED_CHARACTERISTICS)
    ):
        raise ValueError(
            "characteristic_assignment_order must contain each of STR, CON, "
            "SIZ, DEX, APP, INT, POW, EDU exactly once"
        )
    if (
        isinstance(luck_roll_total, bool)
        or not isinstance(luck_roll_total, int)
        or not 3 <= luck_roll_total <= 18
    ):
        raise ValueError("luck_roll_total must be an integer from 3 through 18")
    method = characteristic_generation_methods().get("quick_fire_array") or {}
    values = method.get("array")
    if (
        not isinstance(values, list)
        or len(values) != len(REQUIRED_CHARACTERISTICS)
        or any(isinstance(value, bool) or not isinstance(value, int) for value in values)
    ):
        raise ValueError("quick_fire_array rule data is invalid")
    characteristics = {
        key: int(value) for key, value in zip(assignment, values, strict=True)
    }
    age_mov_penalty = 0
    age = materialized.get("age")
    if age is not None:
        if isinstance(age, bool) or not isinstance(age, int):
            raise ValueError("age must be an integer when supplied")
        age_mov_penalty = int(coc_rules.age_adjustment(age).get("mov_penalty", 0))
    materialized["characteristics"] = characteristics
    materialized["derived"] = derive_values(
        characteristics,
        luck=luck_roll_total * 5,
        age_mov_penalty=age_mov_penalty,
    )
    return materialized


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
        errors.append(
            "missing characteristics (requires each of "
            "STR,CON,SIZ,DEX,APP,INT,POW,EDU as integers)"
        )
        return errors
    for key in REQUIRED_CHARACTERISTICS:
        if key not in characteristics:
            errors.append(f"missing characteristic {key}")
    return errors


def validate_character_create_sheet(
    sheet: dict[str, Any],
    creation: dict[str, Any] | None = None,
) -> list[str]:
    """Validate the complete machine sheet accepted by investigator.create."""
    errors = validate_character_sheet(sheet)
    if errors:
        return errors

    name = sheet.get("name")
    if not isinstance(name, str) or not name.strip():
        errors.append("name must be a non-empty string")

    characteristics = sheet["characteristics"]
    for key in REQUIRED_CHARACTERISTICS:
        value = characteristics.get(key)
        if isinstance(value, bool) or not isinstance(value, int):
            errors.append(f"characteristic {key} must be an integer")

    derived = sheet.get("derived")
    required_derived = ("HP", "MP", "SAN", "Luck", "DB", "Build", "MOV")
    if not isinstance(derived, dict):
        errors.append(
            "missing derived (requires HP,MP,SAN,Luck,DB,Build,MOV; "
            "or use Quick Fire creation to auto-derive them)"
        )
    else:
        for key in required_derived:
            if key not in derived:
                errors.append(f"missing derived {key}")
        for key in ("HP", "MP", "SAN", "Luck", "Build", "MOV"):
            value = derived.get(key)
            if key in derived and (
                isinstance(value, bool) or not isinstance(value, int)
            ):
                errors.append(f"derived {key} must be an integer")
        db = derived.get("DB")
        if "DB" in derived and (
            isinstance(db, bool)
            or not isinstance(db, (int, str))
            or (isinstance(db, str) and not db.strip())
        ):
            errors.append("derived DB must be a non-empty string or integer")

    skills = sheet.get("skills")
    if not isinstance(skills, dict):
        errors.append("missing skills")
    else:
        if "Credit Rating" not in skills:
            errors.append("missing canonical skill Credit Rating")
        for key, value in skills.items():
            if not isinstance(key, str) or not key.strip():
                errors.append("skill keys must be non-empty strings")
                continue
            if key != key.strip() or not key.isascii():
                errors.append(
                    f"skill key {key!r} must use canonical English; put localized labels in player_facing_sheet_zh"
                )
            if isinstance(value, bool) or not isinstance(value, int) or value < 0:
                errors.append(f"skill {key!r} must be a non-negative integer")

    if errors or not creation:
        return errors

    method_id = creation.get("method")
    if not isinstance(method_id, str) or not method_id.strip():
        errors.append("creation method must be a non-empty string")
        return errors
    errors.extend(validate_characteristic_generation(method_id, characteristics))

    luck = derived["Luck"]
    age_mov_penalty = 0
    age = sheet.get("age")
    if age is not None:
        if isinstance(age, bool) or not isinstance(age, int):
            errors.append("age must be an integer when supplied")
            return errors
        try:
            age_mov_penalty = int(coc_rules.age_adjustment(age).get("mov_penalty", 0))
        except ValueError as exc:
            errors.append(str(exc))
            return errors

    expected = derive_values(
        characteristics,
        luck=luck,
        age_mov_penalty=age_mov_penalty,
    )
    for key in ("HP", "MP", "SAN", "Luck", "DB", "Build", "MOV"):
        if derived.get(key) != expected[key]:
            errors.append(
                f"derived {key} {derived.get(key)!r} does not match rules value {expected[key]!r}"
            )
    return errors
