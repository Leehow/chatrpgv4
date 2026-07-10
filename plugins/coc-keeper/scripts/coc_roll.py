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

OUTCOME_LABELS_ZH = {
    "fumble": "大失败",
    "failure": "失败",
    "regular": "成功",
    "regular_success": "成功",
    "hard": "困难成功",
    "hard_success": "困难成功",
    "extreme": "极难成功",
    "extreme_success": "极难成功",
    "critical": "大成功",
    "critical_success": "大成功",
}


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


def _net_roll_modifiers(bonus: int, penalty: int, modifier_rule: dict[str, Any]) -> tuple[int, int]:
    cancellation = modifier_rule["cancellation"]
    if cancellation["method"] != "one_for_one":
        raise ValueError(f"unsupported roll modifier cancellation: {cancellation['method']}")
    return max(0, bonus - penalty), max(0, penalty - bonus)


def _select_tens_value(tens_values: list[int], selected_tens: str) -> int:
    if selected_tens == "lowest":
        return min(tens_values)
    if selected_tens == "highest":
        return max(tens_values)
    raise ValueError(f"unsupported tens selection: {selected_tens}")


def _roll_percentile_with_dice(
    rng: random.Random,
    bonus: int,
    penalty: int,
    *,
    digit_base: int,
    zero_zero_result: int,
    modifier_rule: dict[str, Any],
) -> tuple[int, list[int], int]:
    units = rng.randrange(digit_base)
    tens_values = [rng.randrange(digit_base)]
    active_rule = modifier_rule["bonus_die"] if bonus else modifier_rule["penalty_die"]
    extra_count = max(bonus, penalty) * int(active_rule["extra_tens_dice_per_die"])
    tens_values.extend(rng.randrange(digit_base) for _ in range(extra_count))
    selected_tens = _select_tens_value(tens_values, str(active_rule["selected_tens"]))
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
    effective_target = _effective_target(target, difficulty)
    percentile_rule = coc_rules.percentile_check_rule()
    modifier_rule = coc_rules.roll_modifiers_rule()
    net_bonus, net_penalty = _net_roll_modifiers(bonus, penalty, modifier_rule)

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
            modifier_rule=modifier_rule,
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


def roll_percentile(
    target: int,
    difficulty: str = "regular",
    bonus: int = 0,
    penalty: int = 0,
    rng: random.Random | None = None,
) -> dict[str, Any]:
    """Alias for percentile_check, kept as a discoverable public API."""
    return percentile_check(
        target,
        difficulty=difficulty,
        bonus=bonus,
        penalty=penalty,
        rng=rng,
    )


_LUCK_FORBIDDEN_KINDS = {
    "luck": "luck_may_not_be_spent_on_luck_rolls",
    "damage": "luck_may_not_be_spent_on_damage_rolls",
    "sanity": "luck_may_not_be_spent_on_sanity_rolls",
    "sanity_loss": "luck_may_not_be_spent_on_sanity_loss_amount_rolls",
}


def spend_luck(result: dict[str, Any], points: int, current_luck: int,
               *, roll_kind: str = "skill") -> dict[str, Any]:
    """Spend Luck points to lower a percentile roll (Keeper Rulebook p.99).

    Returns a new result dict with the outcome recomputed at the reduced
    roll, plus ``luck_spent`` / ``luck_remaining`` bookkeeping. Spending Luck
    forfeits the improvement tick (``improvement_tick_eligible: False``) and
    is mutually exclusive with pushing the roll. Raises ``ValueError`` naming
    the violated constraint from ``luck.json`` when the spend is illegal.
    """
    if roll_kind in _LUCK_FORBIDDEN_KINDS:
        raise ValueError(_LUCK_FORBIDDEN_KINDS[roll_kind])
    if result.get("pushed"):
        raise ValueError("luck_may_not_alter_a_pushed_roll")
    outcome = str(result.get("outcome", ""))
    if outcome in ("critical", "fumble"):
        raise ValueError("criticals_fumbles_malfunctions_cannot_be_bought_off")
    if points <= 0:
        raise ValueError("points_must_be_positive")
    if points > current_luck:
        raise ValueError("insufficient_luck")

    new_roll = int(result["roll"]) - int(points)
    if new_roll <= 1:
        # Buying the roll down to 01 would fabricate a critical.
        raise ValueError("criticals_fumbles_malfunctions_cannot_be_bought_off")

    effective_target = int(result.get("effective_target", result.get("target", 0)))
    out = dict(result)
    out["roll"] = new_roll
    out["outcome"] = coc_rules.success_level(new_roll, effective_target)
    out["luck_spent"] = int(points)
    out["luck_remaining"] = int(current_luck) - int(points)
    out["improvement_tick_eligible"] = False
    out["rule_ref"] = "core.optional.spending_luck"
    return out


def recover_luck(current_luck: int, rng: random.Random | None = None) -> dict[str, Any]:
    """Session-end Luck recovery roll: 1D100 > current Luck -> +1D10, cap 99 (p.99)."""
    rng = rng or random.Random()
    roll = rng.randint(1, 100)
    success = roll > int(current_luck)
    gained = rng.randint(1, 10) if success else 0
    luck_after = min(99, int(current_luck) + gained)
    return {
        "roll": roll,
        "success": success,
        "gained": luck_after - int(current_luck) if success else 0,
        "luck_before": int(current_luck),
        "luck_after": luck_after,
        "rule_ref": "core.optional.luck_recovery",
    }


def _outcome_label(outcome: str, language: str) -> str:
    if language == "zh-Hans":
        return OUTCOME_LABELS_ZH.get(outcome, outcome)
    return outcome


def format_percentile_result(
    result: dict[str, Any],
    *,
    language: str = "zh-Hans",
    compact: bool = False,
) -> str:
    """Format a percentile result for immediate player-facing narration.

    By default the tens/units breakdown is shown even for a plain roll (no
    bonus/penalty dice), so the player can see how the roll composed. Pass
    ``compact=True`` for the minimal ``{roll}/{target}, {outcome}`` form.
    """
    roll = int(result["roll"])
    target = int(result.get("target", result.get("effective_target", 0)))
    outcome = _outcome_label(str(result.get("outcome", "")), language)
    bonus = int(result.get("bonus", 0) or 0)
    penalty = int(result.get("penalty", 0) or 0)
    tens_values = list(result.get("tens_values") or [])
    units = result.get("units")

    if not tens_values or units is None or (bonus == 0 and penalty == 0):
        if compact:
            if language == "zh-Hans":
                return f"{roll}/{target}，{outcome}"
            return f"{roll}/{target}, {outcome}"
        # Derive the tens/units digits from the roll itself (a plain roll has
        # no recorded tens_values/units). roll=100 -> tens 10, units 0.
        tens_digit = roll // 10
        units_digit = roll % 10
        if language == "zh-Hans":
            return f"{roll}/{target} = 十位 {tens_digit} 个位 {units_digit}，{outcome}"
        return f"{roll}/{target} = tens {tens_digit} units {units_digit}, {outcome}"

    selected_tens = min(tens_values) if bonus else max(tens_values)
    if language == "zh-Hans":
        modifier_label = "奖励骰" if bonus else "惩罚骰"
        tens_text = "/".join(str(value) for value in tens_values)
        return (
            f"{modifier_label}：个位 {units}，十位 {tens_text}，取 {selected_tens} "
            f"-> {roll}/{target}，{outcome}"
        )

    modifier_label = "bonus die" if bonus else "penalty die"
    tens_text = "/".join(str(value) for value in tens_values)
    return (
        f"{modifier_label}: units {units}, tens {tens_text}, choose {selected_tens} "
        f"-> {roll}/{target}, {outcome}"
    )


def public_api_index() -> dict[str, dict[str, Any]]:
    """Return a small public helper index for live-play tool discovery."""
    return {
        "roll_expression": {
            "aliases": [],
            "signature": "roll_expression(expression, rng=None)",
            "returns": "dice expression result",
        },
        "percentile_check": {
            "aliases": ["roll_percentile"],
            "signature": "percentile_check(target, difficulty='regular', bonus=0, penalty=0, rng=None)",
            "returns": "percentile check result",
        },
        "idea_roll": {
            "aliases": [],
            "signature": "idea_roll(int_value, difficulty='regular', bonus=0, penalty=0, rng=None)",
            "returns": "INT idea roll result",
        },
        "know_roll": {
            "aliases": [],
            "signature": "know_roll(edu_value, difficulty='regular', bonus=0, penalty=0, rng=None)",
            "returns": "EDU know roll result",
        },
        "format_percentile_result": {
            "aliases": [],
            "signature": "format_percentile_result(result, language='zh-Hans', compact=False)",
            "returns": "player-facing roll summary",
        },
        "spend_luck": {
            "aliases": [],
            "signature": "spend_luck(result, points, current_luck, roll_kind='skill')",
            "returns": "recomputed result after spending Luck (p.99)",
        },
        "recover_luck": {
            "aliases": [],
            "signature": "recover_luck(current_luck, rng=None)",
            "returns": "session-end Luck recovery roll result (p.99)",
        },
    }


def idea_roll(int_value: int, *, difficulty: str = "regular",
              bonus: int = 0, penalty: int = 0,
              rng: random.Random | None = None) -> dict[str, Any]:
    """Idea roll: a percentile check against INT (rule-id core.resolution.idea_roll).

    Used to recall a crucial connection or insight. The target is the
    investigator's INT characteristic; default difficulty is regular.
    """
    result = percentile_check(int_value, difficulty=difficulty, bonus=bonus,
                              penalty=penalty, rng=rng)
    result["roll_kind"] = "idea"
    result["characteristic"] = "INT"
    return result


def know_roll(edu_value: int, *, difficulty: str = "regular",
              bonus: int = 0, penalty: int = 0,
              rng: random.Random | None = None) -> dict[str, Any]:
    """Know roll: a percentile check against EDU (rule-id core.resolution.know_roll).

    Used to recall a piece of common or specialized knowledge. The target is
    the investigator's EDU characteristic; default difficulty is regular.
    """
    result = percentile_check(edu_value, difficulty=difficulty, bonus=bonus,
                              penalty=penalty, rng=rng)
    result["roll_kind"] = "know"
    result["characteristic"] = "EDU"
    return result
