"""1D100 check with bonus/penalty dice and success levels. Ported from coc_roll.py."""

from __future__ import annotations

import random
from typing import Any

from .tables import RuleTables

_SUCCESS_LEVEL_RANK = {"regular": 1, "hard": 2, "extreme": 3, "critical": 4}

RULE_REFS = ["percentile-check", "success-levels", "difficulty-levels", "half-fifth-values"]
MODIFIER_RULE_REF = "roll-modifiers"


def resolve_percentile_roll(tables: RuleTables, roll: int, base_target: int,
                            required_level: str) -> dict[str, Any]:
    """Achievement is measured against the unmodified skill; passing against the
    required level. The fumble band follows the required numeric target."""
    base_target = int(base_target)
    roll = int(roll)
    required_target = tables.difficulty_target(base_target, required_level)

    special_level = tables.success_level(roll, max(1, required_target))
    base_level = tables.success_level(roll, base_target)
    if special_level == "critical":
        achieved_level = "critical"
    elif special_level == "fumble":
        achieved_level = "fumble"
    else:
        achieved_level = base_level

    required_rank = _SUCCESS_LEVEL_RANK[required_level]
    achieved_rank = _SUCCESS_LEVEL_RANK.get(achieved_level, 0)
    passed = achieved_rank >= required_rank
    outcome = achieved_level if passed else ("fumble" if achieved_level == "fumble" else "failure")
    return {
        "target": base_target,
        "difficulty": required_level,
        "threshold": required_target,
        "achieved_level": achieved_level,
        "passed": passed,
        "level": outcome,
    }


def _percentile_from_tens_units(tens: int, units: int, *, digit_base: int,
                                zero_zero_result: int) -> int:
    value = tens * digit_base + units
    return zero_zero_result if value == 0 else value


def _net_roll_modifiers(bonus: int, penalty: int, modifier_rule: dict[str, Any]) -> tuple[int, int]:
    cancellation = modifier_rule["cancellation"]
    if cancellation["method"] != "one_for_one":
        raise ValueError(f"unsupported roll modifier cancellation: {cancellation['method']}")
    maximum = modifier_rule["maximum_dice_per_roll"]
    net_bonus = min(max(0, bonus - penalty), int(maximum["bonus"]))
    net_penalty = min(max(0, penalty - bonus), int(maximum["penalty"]))
    return net_bonus, net_penalty


def _roll_percentile_with_dice(rng: random.Random, bonus: int, penalty: int, *, digit_base: int,
                               zero_zero_result: int,
                               modifier_rule: dict[str, Any]) -> tuple[int, list[int], int]:
    units = rng.randrange(digit_base)
    tens_values = [rng.randrange(digit_base)]
    active_rule = modifier_rule["bonus_die"] if bonus else modifier_rule["penalty_die"]
    extra_count = max(bonus, penalty) * int(active_rule["extra_tens_dice_per_die"])
    tens_values.extend(rng.randrange(digit_base) for _ in range(extra_count))
    candidates = [
        _percentile_from_tens_units(tens, units, digit_base=digit_base,
                                    zero_zero_result=zero_zero_result)
        for tens in tens_values
    ]
    selected = str(active_rule["selected_tens"])
    if selected == "lowest":
        roll = min(candidates)
    elif selected == "highest":
        roll = max(candidates)
    else:
        raise ValueError(f"unsupported tens selection: {selected}")
    return roll, tens_values, units


def percentile_check(tables: RuleTables, target: int, difficulty: str = "regular",
                     bonus: int = 0, penalty: int = 0,
                     rng: random.Random | None = None) -> dict[str, Any]:
    rng = rng or random.Random()
    percentile_rule = tables.percentile_check_rule()
    modifier_rule = tables.roll_modifiers_rule()
    net_bonus, net_penalty = _net_roll_modifiers(bonus, penalty, modifier_rule)

    if net_bonus == 0 and net_penalty == 0:
        roll = rng.randint(percentile_rule["minimum_roll"], percentile_rule["maximum_roll"])
        tens_values: list[int] = []
        units = None
    else:
        roll, tens_values, units = _roll_percentile_with_dice(
            rng, net_bonus, net_penalty,
            digit_base=percentile_rule["digit_base"],
            zero_zero_result=percentile_rule["zero_zero_result"],
            modifier_rule=modifier_rule,
        )
    unmodified_roll = roll if units is None or not tens_values else _percentile_from_tens_units(
        tens_values[0], units,
        digit_base=percentile_rule["digit_base"],
        zero_zero_result=percentile_rule["zero_zero_result"],
    )

    resolution = resolve_percentile_roll(tables, roll, target, difficulty)
    rule_refs = list(RULE_REFS)
    if net_bonus or net_penalty:
        rule_refs.insert(1, MODIFIER_RULE_REF)
    return {
        **resolution,
        "roll": roll,
        "bonus": net_bonus,
        "penalty": net_penalty,
        "unmodified_roll": unmodified_roll,
        "tens_values": tens_values,
        "units": units,
        "rule_refs": rule_refs,
    }
