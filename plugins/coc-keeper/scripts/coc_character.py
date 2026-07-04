#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
_COC_RULES_PATH = SCRIPT_DIR / "coc_rules.py"
_COC_RULES_SPEC = importlib.util.spec_from_file_location("coc_rules", _COC_RULES_PATH)
coc_rules = importlib.util.module_from_spec(_COC_RULES_SPEC)
assert _COC_RULES_SPEC.loader is not None
_COC_RULES_SPEC.loader.exec_module(coc_rules)


REQUIRED_CHARACTERISTICS = ("STR", "CON", "SIZ", "DEX", "APP", "INT", "POW", "EDU")


def derive_values(characteristics: dict[str, int], luck: int | None = None) -> dict[str, int | str]:
    db_build = coc_rules.damage_bonus_build(characteristics["STR"], characteristics["SIZ"])
    movement = coc_rules.movement_rate(
        characteristics["STR"],
        characteristics["DEX"],
        characteristics["SIZ"],
        age_mov_penalty=0,
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
    edu_improvement_rolls: list[int] | None = None,
) -> dict[str, int]:
    adjusted = dict(characteristics)
    edu_improvement_rolls = edu_improvement_rolls or []
    if 15 <= age <= 19:
        adjusted["EDU"] = max(0, adjusted["EDU"] - 5)
    elif 40 <= age <= 49:
        adjusted["APP"] = max(0, adjusted["APP"] - 5)
    elif 50 <= age <= 59:
        adjusted["APP"] = max(0, adjusted["APP"] - 10)
    elif 60 <= age <= 69:
        adjusted["APP"] = max(0, adjusted["APP"] - 15)
    elif age >= 70:
        adjusted["APP"] = max(0, adjusted["APP"] - 20)

    for roll in edu_improvement_rolls:
        if roll > adjusted["EDU"]:
            adjusted["EDU"] += 1
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
