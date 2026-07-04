#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
_COC_RULES_PATH = SCRIPT_DIR / "coc_rules.py"
_COC_RULES_SPEC = importlib.util.spec_from_file_location("coc_rules", _COC_RULES_PATH)
coc_rules = importlib.util.module_from_spec(_COC_RULES_SPEC)
assert _COC_RULES_SPEC.loader is not None
_COC_RULES_SPEC.loader.exec_module(coc_rules)


REQUIRED_CHARACTERISTICS = ("STR", "CON", "SIZ", "DEX", "APP", "INT", "POW", "EDU")


def derive_values(
    characteristics: dict[str, int],
    luck: int | None = None,
    *,
    age_mov_penalty: int = 0,
) -> dict[str, int | str]:
    db_build = coc_rules.damage_bonus_build(characteristics["STR"], characteristics["SIZ"])
    movement = coc_rules.movement_rate(
        characteristics["STR"],
        characteristics["DEX"],
        characteristics["SIZ"],
        age_mov_penalty=age_mov_penalty,
    )
    return {
        "HP": (characteristics["CON"] + characteristics["SIZ"]) // 10,
        "MP": characteristics["POW"] // 5,
        "SAN": characteristics["POW"],
        "Luck": luck if luck is not None else characteristics["POW"],
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

    required_checks = int(age_adjustment.get("edu_improvement_checks", 0))
    edu_maximum = int(coc_rules.load_rule_table("age-adjustments").get("edu_maximum", 99))
    for record in edu_improvement_rolls[:required_checks]:
        if not isinstance(record, dict):
            raise ValueError("EDU improvement checks must include roll and improvement_roll fields")
        roll = int(record["roll"])
        if roll > adjusted["EDU"]:
            improvement_roll = record.get("improvement_roll")
            if improvement_roll in (None, "", [], {}):
                raise ValueError("successful EDU improvement check requires improvement_roll")
            improvement_amount = int(improvement_roll)
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
