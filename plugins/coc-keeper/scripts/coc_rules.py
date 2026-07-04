#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
PLUGIN_ROOT = SCRIPT_DIR.parent
RULES_DIR = PLUGIN_ROOT / "references" / "rules-json"


def rules_dir() -> Path:
    return RULES_DIR


def load_rule_table(name: str) -> Any:
    path = RULES_DIR / f"{name}.json"
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


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


def half_value(value: int) -> int:
    return value // 2


def fifth_value(value: int) -> int:
    return value // 5


def damage_bonus_build(str_value: int, siz_value: int) -> dict[str, int | str]:
    total = str_value + siz_value
    for row in load_rule_table("damage-bonus-build"):
        if row["min"] <= total <= row["max"]:
            return {
                "total": total,
                "damage_bonus": row["damage_bonus"],
                "build": row["build"],
            }
    raise ValueError(f"STR+SIZ total out of V1 table range: {total}")


def _is_fumble(roll: int, target: int) -> bool:
    table = load_rule_table("success-levels")["fumble"]
    key = "target_below_50" if target < 50 else "target_50_or_above"
    lower, upper = table[key]
    return lower <= roll <= upper


def success_level(roll: int, target: int) -> str:
    if not 1 <= roll <= 100:
        raise ValueError("roll must be between 1 and 100")
    if not 1 <= target <= 100:
        raise ValueError("target must be between 1 and 100")
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
