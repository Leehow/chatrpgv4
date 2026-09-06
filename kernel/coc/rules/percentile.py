"""1D100 checks, dice expressions and Luck arithmetic. Ported from coc_roll.py.

The percentile result carries both vocabularies: the slice-0 contract's
`target / difficulty / threshold / level` and the canonical receipt contract the
old engines consume (`base_target / required_level / required_target /
effective_target / achieved_level / success / surplus_levels / outcome`)."""

from __future__ import annotations

import random
import re
from typing import Any

from .tables import RuleTables

_SUCCESS_LEVEL_RANK = {"regular": 1, "hard": 2, "extreme": 3, "critical": 4}
SUCCESS_OUTCOMES = frozenset({"regular", "hard", "extreme", "critical"})

RULE_REFS = ["percentile-check", "success-levels", "difficulty-levels", "half-fifth-values"]
MODIFIER_RULE_REF = "roll-modifiers"

ROLL_PATTERN = re.compile(r"^(?P<count>\d+)D(?P<sides>\d+)(?P<modifier>[+-]\d+)?$")


def roll_expression(expression: str, rng: random.Random | None = None) -> dict[str, Any]:
    """Roll `NdM(+k)`; individual faces are kept for receipts."""
    rng = rng or random.Random()
    normalized = str(expression).strip().upper()
    match = ROLL_PATTERN.match(normalized)
    if match is None:
        raise ValueError(f"unsupported dice expression: {expression}")
    count = int(match.group("count"))
    sides = int(match.group("sides"))
    modifier = int(match.group("modifier") or 0)
    rolls = [rng.randint(1, sides) for _ in range(count)]
    return {"expression": normalized, "count": count, "sides": sides, "modifier": modifier,
            "rolls": rolls, "total": sum(rolls) + modifier}


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
        "base_target": base_target,
        "difficulty": required_level,
        "required_level": required_level,
        "threshold": required_target,
        "required_target": required_target,
        "effective_target": required_target,
        "achieved_level": achieved_level,
        "passed": passed,
        "success": passed,
        "surplus_levels": max(0, achieved_rank - required_rank) if passed else 0,
        "level": outcome,
        "outcome": outcome,
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
    net_bonus, net_penalty = _net_roll_modifiers(int(bonus or 0), int(penalty or 0), modifier_rule)
    target = max(percentile_rule["minimum_target"], min(percentile_rule["maximum_target"], int(target)))

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


# ---- Luck (Keeper Rulebook p.99) ----------------------------------------------

_LUCK_FORBIDDEN_KINDS = {
    "luck": "luck_may_not_be_spent_on_luck_rolls",
    "damage": "luck_may_not_be_spent_on_damage_rolls",
    "sanity": "luck_may_not_be_spent_on_sanity_rolls",
    "sanity_loss": "luck_may_not_be_spent_on_sanity_loss_amount_rolls",
}
_LUCK_ROLL_KINDS = frozenset({"skill", *_LUCK_FORBIDDEN_KINDS})
_LUCK_REQUIRED_FIELDS = frozenset({
    "roll", "base_target", "target", "required_level", "difficulty", "required_target",
    "effective_target", "achieved_level", "passed", "success", "surplus_levels", "outcome",
})


def spend_luck(tables: RuleTables, result: dict[str, Any], points: int, current_luck: int,
               *, roll_kind: str = "skill") -> dict[str, Any]:
    """Recompute a settled check after spending Luck. Raises ValueError naming the
    violated luck.json constraint. The input must be a canonical percentile result."""
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
    missing = sorted(_LUCK_REQUIRED_FIELDS - set(result))
    if missing:
        raise ValueError("percentile_result_must_use_canonical_contract: " + ", ".join(missing))
    roll = int(result["roll"])
    base_target = int(result["base_target"])
    required_level = str(result["required_level"])
    expected = resolve_percentile_roll(tables, roll, base_target, required_level)
    if any(result.get(key) != expected[key] for key in _LUCK_REQUIRED_FIELDS - {"roll"}):
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
        raise ValueError("criticals_fumbles_malfunctions_cannot_be_bought_off")
    out = dict(result)
    out["roll"] = new_roll
    out.update(resolve_percentile_roll(tables, new_roll, base_target, required_level))
    out["luck_spent"] = int(points)
    out["luck_remaining"] = int(current_luck) - int(points)
    out["improvement_tick_eligible"] = False
    out["rule_ref"] = "core.optional.spending_luck"
    return out


def recover_luck(current_luck: int, rng: random.Random | None = None) -> dict[str, Any]:
    """Session-end Luck recovery: 1D100 > current Luck -> +1D10, cap 99 (p.99)."""
    rng = rng or random.Random()
    roll = rng.randint(1, 100)
    success = roll > int(current_luck)
    gained = rng.randint(1, 10) if success else 0
    luck_after = min(99, int(current_luck) + gained)
    return {"roll": roll, "success": success, "gained": luck_after - int(current_luck) if success else 0,
            "luck_before": int(current_luck), "luck_after": luck_after,
            "rule_ref": "core.optional.luck_recovery"}


def idea_roll(tables: RuleTables, int_value: int, *, difficulty: str = "regular", bonus: int = 0,
              penalty: int = 0, rng: random.Random | None = None) -> dict[str, Any]:
    result = percentile_check(tables, int_value, difficulty, bonus, penalty, rng)
    result["roll_kind"] = "idea"
    result["characteristic"] = "INT"
    return result


def know_roll(tables: RuleTables, edu_value: int, *, difficulty: str = "regular", bonus: int = 0,
              penalty: int = 0, rng: random.Random | None = None) -> dict[str, Any]:
    result = percentile_check(tables, edu_value, difficulty, bonus, penalty, rng)
    result["roll_kind"] = "know"
    result["characteristic"] = "EDU"
    return result


# ---- the bound old `coc_roll` surface -------------------------------------------------

#: Projection vocabulary ported from coc_roll.py: which roll-record keys a player may
#: see, which carry the (possibly secret) target, and which are audit-only blobs.
AUDIT_ONLY_KEYS = frozenset({"marker", "tens_values", "units", "player_projection"})
_FIRST_CONTACT_KINDS = frozenset({"first_contact", "first_contact_roll"})
_NPC_SUBJECT_KINDS = frozenset({"npc", "monster", "opponent"})
_PC_SUBJECT_KINDS = frozenset({"investigator", "player"})
_PROJECTION_SAFE_KEYS = (
    "visibility", "roll", "achieved_level", "outcome", "passed", "required_level", "surplus_levels",
    "contest_winner", "opposed_side", "skill", "kind", "die_expression", "original_roll", "luck_spent",
    "adjusted_roll", "bonus", "penalty", "pushed",
)
_PROJECTION_TARGET_KEYS = ("base_target", "required_target", "effective_target", "target")
_FIRST_CONTACT_PUBLIC_KEYS = ("app", "credit_rating", "governing_attribute", "governing_value", "npc_display_name")


def roll_subject_kind(raw: dict[str, Any] | None) -> str | None:
    """Structural subject kind of a roll record; never inferred from a display name."""
    if not isinstance(raw, dict):
        return None
    subject = raw.get("subject")
    if isinstance(subject, dict):
        kind = subject.get("kind")
        if isinstance(kind, str) and kind.strip():
            return kind.strip().casefold()
    side = raw.get("opposed_side")
    if side == "investigator":
        return "investigator"
    if side == "opponent":
        return "opponent"
    return None


def is_first_contact_roll(raw: dict[str, Any] | None) -> bool:
    return isinstance(raw, dict) and str(raw.get("kind") or "") in _FIRST_CONTACT_KINDS


def player_projection_includes_target(raw: dict[str, Any] | None) -> bool:
    if is_first_contact_roll(raw):
        return True
    return roll_subject_kind(raw) not in _NPC_SUBJECT_KINDS


def build_player_projection(raw: dict[str, Any], *, include_target: bool | None = None,
                            extra: dict[str, Any] | None = None) -> dict[str, Any]:
    """Typed player view of one canonical roll record. Audit receipts keep full fields."""
    include = player_projection_includes_target(raw) if include_target is None else bool(include_target)
    view: dict[str, Any] = {"visibility": str(raw.get("visibility") or "public")}
    for key in _PROJECTION_SAFE_KEYS:
        if raw.get(key) is not None:
            view[key] = raw[key]
    if include:
        for key in _PROJECTION_TARGET_KEYS:
            if raw.get(key) is not None:
                view[key] = raw[key]
        if raw.get("characteristic") is not None:
            view["characteristic"] = raw["characteristic"]
        if is_first_contact_roll(raw):
            for key in _FIRST_CONTACT_PUBLIC_KEYS:
                if key in raw:
                    view[key] = raw[key]
    if extra:
        for key, value in extra.items():
            if value is not None:
                view[key] = value
    return {key: value for key, value in view.items() if key not in AUDIT_ONLY_KEYS}


class RollApi:
    """The old `coc_roll` module surface bound to one RuleTables, so the ported session
    engines (combat, chase, sanity) keep their call sites verbatim."""

    def __init__(self, tables: RuleTables) -> None:
        self.tables = tables

    def percentile_check(self, target: int, difficulty: str = "regular", bonus: int = 0,
                         penalty: int = 0, rng: random.Random | None = None) -> dict[str, Any]:
        return percentile_check(self.tables, target, difficulty, bonus, penalty, rng)

    def resolve_percentile_roll(self, roll: int, base_target: int, required_level: str) -> dict[str, Any]:
        return resolve_percentile_roll(self.tables, roll, base_target, required_level)

    def spend_luck(self, result: dict[str, Any], points: int, current_luck: int, *,
                   roll_kind: str = "skill") -> dict[str, Any]:
        return spend_luck(self.tables, result, points, current_luck, roll_kind=roll_kind)

    @staticmethod
    def roll_expression(expression: str, rng: random.Random | None = None) -> dict[str, Any]:
        return roll_expression(expression, rng)

    @staticmethod
    def build_player_projection(raw: dict[str, Any], *, include_target: bool | None = None,
                                extra: dict[str, Any] | None = None) -> dict[str, Any]:
        return build_player_projection(raw, include_target=include_target, extra=extra)
