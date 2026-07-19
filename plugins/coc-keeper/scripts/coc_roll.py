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

REQUIRED_LEVEL_LABELS_ZH = {
    "regular": "普通",
    "hard": "困难",
    "extreme": "极难",
}

REQUIRED_LEVEL_LABELS_EN = {
    "regular": "Regular",
    "hard": "Hard",
    "extreme": "Extreme",
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


_SUCCESS_LEVEL_RANK = {
    "regular": 1,
    "hard": 2,
    "extreme": 3,
    "critical": 4,
}


def resolve_percentile_roll(
    roll: int,
    base_target: int,
    required_level: str,
) -> dict[str, Any]:
    """Resolve one already-rolled percentile result without conflating facts.

    Ordinary/Hard/Extreme achievement is measured against the investigator's
    unmodified skill or characteristic (``base_target``).  Whether that
    achievement passes the current check is a separate comparison against
    ``required_level``.  The fumble band is the rulebook exception: it is
    selected from the required numeric target, so a Hard/Extreme check can
    fumble on 96--100 even when the underlying skill is 50 or greater.

    ``outcome`` remains the compact settlement verdict used by existing rules
    consumers: it is the achieved level on a pass, otherwise ``failure`` (or
    ``fumble``).  Callers that need the die's actual quality use
    ``achieved_level``.
    """
    base_target = int(base_target)
    roll = int(roll)
    required_level = str(required_level)
    required_target = _effective_target(base_target, required_level)

    # success_level validates the canonical 1..100 roll and target ranges.
    # A fifth-value target can be zero for a base chance below 5.  Zero and one
    # are in the same (<50) fumble band, while roll 01 remains a critical, so
    # one is the rule-equivalent validation target for this special check.
    special_level = coc_rules.success_level(roll, max(1, required_target))
    base_level = coc_rules.success_level(roll, base_target)
    if special_level == "critical":
        achieved_level = "critical"
    elif special_level == "fumble":
        achieved_level = "fumble"
    else:
        achieved_level = base_level

    required_rank = _SUCCESS_LEVEL_RANK[required_level]
    achieved_rank = _SUCCESS_LEVEL_RANK.get(achieved_level, 0)
    passed = achieved_rank >= required_rank
    outcome = (
        achieved_level
        if passed
        else "fumble" if achieved_level == "fumble" else "failure"
    )
    return {
        "base_target": base_target,
        "target": base_target,
        "required_level": required_level,
        "difficulty": required_level,
        "required_target": required_target,
        "effective_target": required_target,
        "achieved_level": achieved_level,
        "passed": passed,
        "success": passed,
        "surplus_levels": max(0, achieved_rank - required_rank) if passed else 0,
        "outcome": outcome,
    }


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
    candidates = [
        _percentile_from_tens_units(
            tens,
            units,
            digit_base=digit_base,
            zero_zero_result=zero_zero_result,
        )
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


def percentile_check(
    target: int,
    difficulty: str = "regular",
    bonus: int = 0,
    penalty: int = 0,
    rng: random.Random | None = None,
) -> dict[str, Any]:
    rng = rng or random.Random()
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
    unmodified_roll = (
        roll
        if units is None or not tens_values
        else _percentile_from_tens_units(
            int(tens_values[0]),
            int(units),
            digit_base=int(percentile_rule["digit_base"]),
            zero_zero_result=int(percentile_rule["zero_zero_result"]),
        )
    )

    resolution = resolve_percentile_roll(roll, target, difficulty)
    return {
        **resolution,
        "bonus": net_bonus,
        "penalty": net_penalty,
        "roll": roll,
        "unmodified_roll": unmodified_roll,
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
_LUCK_ROLL_KINDS = frozenset({"skill", *_LUCK_FORBIDDEN_KINDS})


def spend_luck(result: dict[str, Any], points: int, current_luck: int,
               *, roll_kind: str = "skill") -> dict[str, Any]:
    """Spend Luck points to lower a percentile roll (Keeper Rulebook p.99).

    Returns a new result dict with the outcome recomputed at the reduced
    roll, plus ``luck_spent`` / ``luck_remaining`` bookkeeping. Spending Luck
    forfeits the improvement tick (``improvement_tick_eligible: False``) and
    is mutually exclusive with pushing the roll. Raises ``ValueError`` naming
    the violated constraint from ``luck.json`` when the spend is illegal. The
    input must already carry the complete canonical percentile settlement;
    contextual difficulty is never inferred from a numeric target alias.
    """
    if not isinstance(roll_kind, str) or roll_kind not in _LUCK_ROLL_KINDS:
        raise ValueError("roll_kind_must_be_a_supported_enum")
    if roll_kind in _LUCK_FORBIDDEN_KINDS:
        raise ValueError(_LUCK_FORBIDDEN_KINDS[roll_kind])
    if isinstance(points, bool) or not isinstance(points, int):
        raise ValueError("points_must_be_an_integer")
    if isinstance(current_luck, bool) or not isinstance(current_luck, int):
        raise ValueError("current_luck_must_be_an_integer")
    if current_luck < 0:
        raise ValueError("current_luck_must_be_non_negative")
    if result.get("pushed"):
        raise ValueError("luck_may_not_alter_a_pushed_roll")
    required_fields = {
        "roll",
        "base_target",
        "target",
        "required_level",
        "difficulty",
        "required_target",
        "effective_target",
        "achieved_level",
        "passed",
        "success",
        "surplus_levels",
        "outcome",
    }
    missing = sorted(required_fields - set(result))
    if missing:
        raise ValueError(
            "percentile_result_must_use_canonical_contract: "
            + ", ".join(missing)
        )
    integer_fields = {
        "roll",
        "base_target",
        "target",
        "required_target",
        "effective_target",
        "surplus_levels",
    }
    if any(
        isinstance(result[field], bool) or not isinstance(result[field], int)
        for field in integer_fields
    ) or any(
        not isinstance(result[field], bool)
        for field in ("passed", "success")
    ) or any(
        not isinstance(result[field], str)
        for field in (
            "required_level",
            "difficulty",
            "achieved_level",
            "outcome",
        )
    ):
        raise ValueError("percentile_result_must_use_canonical_contract")
    roll = int(result["roll"])
    base_target = int(result["base_target"])
    required_level = str(result["required_level"])
    expected = resolve_percentile_roll(roll, base_target, required_level)
    if any(result.get(key) != expected[key] for key in required_fields - {"roll"}):
        raise ValueError("percentile_result_contradicts_canonical_contract")

    outcome = str(result["outcome"])
    if outcome in ("critical", "fumble"):
        raise ValueError("criticals_fumbles_malfunctions_cannot_be_bought_off")
    if result["passed"] is True:
        raise ValueError("luck_may_only_alter_a_failed_roll")
    if points <= 0:
        raise ValueError("points_must_be_positive")
    if points > current_luck:
        raise ValueError("insufficient_luck")

    new_roll = roll - int(points)
    if new_roll <= 1:
        # Buying the roll down to 01 would fabricate a critical.
        raise ValueError("criticals_fumbles_malfunctions_cannot_be_bought_off")

    out = dict(result)
    out["roll"] = new_roll
    out.update(resolve_percentile_roll(new_roll, base_target, required_level))
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
    """Format a context-complete percentile result for player-facing use.

    Both compact and expanded forms show the base value, required level and
    numeric target, achieved level, pass/fail, and any positive surplus.  The
    expanded form additionally shows the physical tens/units construction.
    All settlement facts are verified against :func:`resolve_percentile_roll`
    before rendering, so a stale or contradictory result fails closed.
    """
    roll = int(result["roll"])
    required_fields = {
        "base_target",
        "required_level",
        "required_target",
        "achieved_level",
        "passed",
        "surplus_levels",
        "outcome",
    }
    missing = sorted(required_fields - set(result))
    if missing:
        raise ValueError(
            "percentile result lacks contextual fields: " + ", ".join(missing)
        )
    base_target = int(result["base_target"])
    required_level = str(result["required_level"])
    expected = resolve_percentile_roll(roll, base_target, required_level)
    if any(result.get(key) != expected[key] for key in required_fields):
        raise ValueError("percentile result contradicts canonical settlement")
    required_target = int(expected["required_target"])
    achieved_level = str(expected["achieved_level"])
    passed = bool(expected["passed"])
    surplus_levels = int(expected["surplus_levels"])
    bonus = int(result.get("bonus", 0) or 0)
    penalty = int(result.get("penalty", 0) or 0)
    tens_values = list(result.get("tens_values") or [])
    units = result.get("units")

    if language == "zh-Hans":
        required_label = REQUIRED_LEVEL_LABELS_ZH[required_level]
        achieved_label = _outcome_label(achieved_level, language)
        surplus = (
            f"（超出 {surplus_levels} 级）" if surplus_levels > 0 else ""
        )
        verdict = "通过" if passed else "未通过"
        context = (
            f"掷骰：{roll}；基础值：{base_target}；"
            f"门槛：{required_label}（≤{required_target}）；"
            f"达到：{achieved_label}{surplus}；{verdict}"
        )
    else:
        required_label = REQUIRED_LEVEL_LABELS_EN[required_level]
        achieved_label = achieved_level.replace("_", " ").title()
        surplus = (
            f" (surplus {surplus_levels} level"
            f"{'s' if surplus_levels != 1 else ''})"
            if surplus_levels > 0
            else ""
        )
        verdict = "passed" if passed else "not passed"
        context = (
            f"roll: {roll}; base: {base_target}; "
            f"required: {required_label} (≤{required_target}); "
            f"achieved: {achieved_label}{surplus}; {verdict}"
        )

    if compact:
        return context

    if not tens_values or units is None or (bonus == 0 and penalty == 0):
        # Derive the tens/units digits from the roll itself (a plain roll has
        # no recorded tens_values/units). roll=100 -> tens 10, units 0.
        tens_digit = roll // 10
        units_digit = roll % 10
        if language == "zh-Hans":
            return f"十位 {tens_digit}，个位 {units_digit} → {context}"
        return f"tens {tens_digit}, units {units_digit} → {context}"

    candidates = [100 if int(tens) == 0 and int(units) == 0 else int(tens) * 10 + int(units)
                  for tens in tens_values]
    selected_roll = min(candidates) if bonus else max(candidates)
    selected_tens = tens_values[candidates.index(selected_roll)]
    if language == "zh-Hans":
        modifier_label = "奖励骰" if bonus else "惩罚骰"
        tens_text = "/".join(str(value) for value in tens_values)
        return (
            f"{modifier_label}：个位 {units}，十位 {tens_text}，取 {selected_tens} "
            f"→ {context}"
        )

    modifier_label = "bonus die" if bonus else "penalty die"
    tens_text = "/".join(str(value) for value in tens_values)
    return (
        f"{modifier_label}: units {units}, tens {tens_text}, choose {selected_tens} "
        f"→ {context}"
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
            "returns": "percentile check with distinct required and achieved levels",
        },
        "resolve_percentile_roll": {
            "aliases": [],
            "signature": "resolve_percentile_roll(roll, base_target, required_level)",
            "returns": "deterministic percentile settlement without rolling",
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
            "returns": "context-complete player-facing roll summary",
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
