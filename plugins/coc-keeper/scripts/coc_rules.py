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
