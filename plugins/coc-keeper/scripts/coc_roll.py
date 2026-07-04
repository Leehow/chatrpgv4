#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import random
import re
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
_COC_RULES_PATH = SCRIPT_DIR / "coc_rules.py"
_COC_RULES_SPEC = importlib.util.spec_from_file_location("coc_rules", _COC_RULES_PATH)
coc_rules = importlib.util.module_from_spec(_COC_RULES_SPEC)
assert _COC_RULES_SPEC.loader is not None
_COC_RULES_SPEC.loader.exec_module(coc_rules)


ROLL_PATTERN = re.compile(r"^(?P<count>\d+)D(?P<sides>\d+)(?P<modifier>[+-]\d+)?$")


def roll_expression(expression: str, rng: random.Random | None = None) -> dict[str, Any]:
    rng = rng or random.Random()
    normalized = expression.strip().upper()
    match = ROLL_PATTERN.match(normalized)
    if match is None:
        raise ValueError(f"unsupported dice expression: {expression}")

    count = int(match.group("count"))
    sides = int(match.group("sides"))
    modifier = int(match.group("modifier") or 0)
    rolls = [rng.randint(1, sides) for _ in range(count)]
    return {
        "expression": normalized,
        "count": count,
        "sides": sides,
        "modifier": modifier,
        "rolls": rolls,
        "total": sum(rolls) + modifier,
    }


def _effective_target(target: int, difficulty: str) -> int:
    return coc_rules.difficulty_target(target, difficulty)


def _percentile_from_tens_units(tens: int, units: int, *, digit_base: int, zero_zero_result: int) -> int:
    value = tens * digit_base + units
    return zero_zero_result if value == 0 else value


def _roll_percentile_with_dice(
    rng: random.Random,
    bonus: int,
    penalty: int,
    *,
    digit_base: int,
    zero_zero_result: int,
) -> tuple[int, list[int], int]:
    units = rng.randrange(digit_base)
    tens_values = [rng.randrange(digit_base)]
    extra_count = max(bonus, penalty)
    tens_values.extend(rng.randrange(digit_base) for _ in range(extra_count))
    selected_tens = min(tens_values) if bonus else max(tens_values)
    return _percentile_from_tens_units(
        selected_tens,
        units,
        digit_base=digit_base,
        zero_zero_result=zero_zero_result,
    ), tens_values, units


def percentile_check(
    target: int,
    difficulty: str = "regular",
    bonus: int = 0,
    penalty: int = 0,
    rng: random.Random | None = None,
) -> dict[str, Any]:
    rng = rng or random.Random()
    net_bonus = max(0, bonus - penalty)
    net_penalty = max(0, penalty - bonus)
    effective_target = _effective_target(target, difficulty)
    percentile_rule = coc_rules.percentile_check_rule()

    if net_bonus == 0 and net_penalty == 0:
        roll = rng.randint(
            int(percentile_rule["minimum_roll"]),
            int(percentile_rule["maximum_roll"]),
        )
        tens_values: list[int] = []
        units = None
    else:
        roll, tens_values, units = _roll_percentile_with_dice(
            rng,
            net_bonus,
            net_penalty,
            digit_base=int(percentile_rule["digit_base"]),
            zero_zero_result=int(percentile_rule["zero_zero_result"]),
        )

    return {
        "target": target,
        "effective_target": effective_target,
        "difficulty": difficulty,
        "bonus": net_bonus,
        "penalty": net_penalty,
        "roll": roll,
        "outcome": coc_rules.success_level(roll, effective_target),
        "tens_values": tens_values,
        "units": units,
    }
