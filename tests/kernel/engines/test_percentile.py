"""Tests for 1D100 checks, dice expressions and Luck arithmetic. Ported from the
old tree's `tests/test_roll.py` (subject: `coc_roll.py`, now
`kernel/coc/rules/percentile.py`).

API change from the port: every function that used to read rule tables through
a module-global `coc_rules` singleton now takes an explicit `tables: RuleTables`
first argument (`percentile_check`, `resolve_percentile_roll`, `spend_luck`,
`idea_roll`, `know_roll`). The old monkeypatch-the-module-global tests
(`monkeypatch.setattr(coc_roll.coc_rules, "difficulty_target", ...)`) are
rewritten to monkeypatch the *instance* method on the injected `tables` object
instead — same behaviour, different injection point.

Dropped (subject deleted): `format_percentile_result` and its whole player-facing
prose surface (`player_facing_roll_view`, `player_facing_contest_label`,
`_contest_clause`, `format_player_facing_percentile`), the `roll_percentile`
alias, and `public_api_index`. None of these exist in the ported module — the
kernel's player-facing projection is `build_player_projection` (still ported,
covered indirectly through `tests/kernel/test_rules_families.py`'s RPC-seam
checks) rather than a localized-text formatter.
"""

from __future__ import annotations

import random
import sys

import pytest
from conftest import CONTENT_DIR, KERNEL_DIR

sys.path.insert(0, str(KERNEL_DIR))

from coc.rules.percentile import (  # noqa: E402
    percentile_check,
    recover_luck,
    resolve_percentile_roll,
    roll_expression,
    spend_luck,
)
from coc.rules.tables import RuleTables  # noqa: E402

RULES = CONTENT_DIR / "rulesets" / "coc7" / "rules-json"


@pytest.fixture(scope="module")
def tables() -> RuleTables:
    return RuleTables(RULES)


class SequenceRandom:
    def __init__(self, values):
        self.values = list(values)

    def randrange(self, upper):
        value = self.values.pop(0)
        assert 0 <= value < upper
        return value

    def randint(self, lower, upper):
        value = self.values.pop(0)
        assert lower <= value <= upper
        return value


def _settled_result(tables, roll: int, base_target: int, required_level: str = "regular", **extra):
    return {
        **resolve_percentile_roll(tables, roll, base_target, required_level),
        "roll": roll, "bonus": 0, "penalty": 0, "tens_values": [], "units": None,
        **extra,
    }


def test_roll_expression_returns_total_and_terms():
    result = roll_expression("2D6+3", rng=random.Random(4))
    assert result["expression"] == "2D6+3"
    assert result["modifier"] == 3
    assert len(result["rolls"]) == 2
    assert result["total"] == sum(result["rolls"]) + 3


def test_percentile_check_applies_hard_difficulty(tables):
    result = percentile_check(tables, 60, difficulty="hard", rng=random.Random(1))
    assert result["target"] == 60
    assert result["base_target"] == 60
    assert result["effective_target"] == 30
    assert result["required_target"] == 30
    assert result["difficulty"] == "hard"
    assert result["required_level"] == "hard"
    assert result["roll"] == 18
    assert result["achieved_level"] == "hard"
    assert result["outcome"] == "hard"
    assert result["passed"] is True
    assert result["success"] is True


def test_required_and_achieved_levels_are_distinct_with_surplus(tables):
    result = percentile_check(tables, 45, difficulty="hard", rng=SequenceRandom([5]))
    assert result["required_level"] == "hard"
    assert result["required_target"] == 22
    assert result["achieved_level"] == "extreme"
    assert result["passed"] is True
    assert result["surplus_levels"] == 1
    assert result["outcome"] == "extreme"


def test_achieved_regular_can_fail_a_hard_requirement(tables):
    result = percentile_check(tables, 45, difficulty="hard", rng=SequenceRandom([30]))
    assert result["achieved_level"] == "regular"
    assert result["passed"] is False
    assert result["success"] is False
    assert result["surplus_levels"] == 0
    assert result["outcome"] == "failure"


def test_fumble_band_uses_required_target_not_base_target(tables):
    result = percentile_check(tables, 80, difficulty="hard", rng=SequenceRandom([96]))
    assert result["base_target"] == 80
    assert result["required_target"] == 40
    assert result["achieved_level"] == "fumble"
    assert result["outcome"] == "fumble"
    assert result["passed"] is False


def test_critical_is_achieved_above_an_extreme_requirement(tables):
    result = percentile_check(tables, 45, difficulty="extreme", rng=SequenceRandom([1]))
    assert result["achieved_level"] == "critical"
    assert result["passed"] is True
    assert result["surplus_levels"] == 1
    assert result["outcome"] == "critical"


@pytest.mark.parametrize(
    ("base_target", "required_level", "roll", "required_target", "achieved_level",
     "passed", "outcome", "surplus_levels"),
    [
        (4, "extreme", 1, 0, "critical", True, "critical", 1),
        (4, "extreme", 2, 0, "hard", False, "failure", 0),
        (80, "hard", 96, 40, "fumble", False, "fumble", 0),
        (100, "hard", 96, 50, "regular", False, "failure", 0),
        (100, "regular", 100, 100, "fumble", False, "fumble", 0),
        (45, "hard", 30, 22, "regular", False, "failure", 0),
        (45, "extreme", 15, 9, "hard", False, "failure", 0),
    ],
)
def test_percentile_resolver_boundaries_are_durable(
    tables, base_target, required_level, roll, required_target, achieved_level, passed, outcome, surplus_levels,
):
    result = resolve_percentile_roll(tables, roll, base_target, required_level)
    assert result["required_target"] == required_target
    assert result["achieved_level"] == achieved_level
    assert result["passed"] is passed
    assert result["success"] is passed
    assert result["outcome"] == outcome
    assert result["surplus_levels"] == surplus_levels


def test_percentile_check_uses_rules_json_difficulty_target(tables, monkeypatch):
    calls = []

    def fake_difficulty_target(target: int, difficulty: str) -> int:
        calls.append((target, difficulty))
        return 17

    monkeypatch.setattr(tables, "difficulty_target", fake_difficulty_target, raising=False)

    result = percentile_check(tables, 60, difficulty="hard", rng=random.Random(1))

    assert calls == [(60, "hard")]
    assert result["effective_target"] == 17


def test_percentile_check_uses_rules_json_roll_bounds(tables, monkeypatch):
    calls = []

    def fake_percentile_check_rule():
        calls.append("bounds")
        return {"die": "1D20", "minimum_roll": 10, "maximum_roll": 20, "minimum_target": 1,
                "maximum_target": 100, "success_if_roll_lte_effective_target": True,
                "zero_zero_result": 20, "digit_base": 10}

    monkeypatch.setattr(tables, "percentile_check_rule", fake_percentile_check_rule, raising=False)

    result = percentile_check(tables, 50, rng=random.Random(1))

    assert calls
    assert 10 <= result["roll"] <= 20


def test_bonus_and_penalty_cancel(tables):
    result = percentile_check(tables, 50, bonus=1, penalty=1, rng=random.Random(3))
    assert result["bonus"] == 0
    assert result["penalty"] == 0


def test_percentile_bonus_dice_use_rules_json_zero_zero_result(tables, monkeypatch):
    def fake_percentile_check_rule():
        return {"die": "1D20", "minimum_roll": 1, "maximum_roll": 20, "minimum_target": 1,
                "maximum_target": 20, "success_if_roll_lte_effective_target": True,
                "zero_zero_result": 20, "digit_base": 10}

    monkeypatch.setattr(tables, "percentile_check_rule", fake_percentile_check_rule, raising=False)

    result = percentile_check(tables, 15, bonus=1, rng=SequenceRandom([0, 0, 0]))

    assert result["roll"] == 20


def test_percentile_bonus_dice_use_rules_json_digit_base(tables, monkeypatch):
    def fake_percentile_check_rule():
        return {"die": "1D25", "minimum_roll": 1, "maximum_roll": 25, "minimum_target": 1,
                "maximum_target": 25, "success_if_roll_lte_effective_target": True,
                "zero_zero_result": 25, "digit_base": 5}

    monkeypatch.setattr(tables, "percentile_check_rule", fake_percentile_check_rule, raising=False)

    result = percentile_check(tables, 25, bonus=1, rng=SequenceRandom([3, 4, 4]))

    assert result["roll"] == 23
    assert result["tens_values"] == [4, 4]
    assert result["units"] == 3


def test_percentile_bonus_dice_selection_uses_rules_json_roll_modifiers(tables, monkeypatch):
    def fake_roll_modifiers_rule():
        return {
            "applies_to": "percentile-check",
            "cancellation": {"method": "one_for_one", "net_bonus_formula": "max(0, bonus - penalty)",
                             "net_penalty_formula": "max(0, penalty - bonus)"},
            "maximum_dice_per_roll": {"bonus": 2, "penalty": 2},
            "bonus_die": {"extra_tens_dice_per_die": 1, "selected_tens": "highest", "uses_same_units_die": True},
            "penalty_die": {"extra_tens_dice_per_die": 1, "selected_tens": "lowest", "uses_same_units_die": True},
        }

    monkeypatch.setattr(tables, "roll_modifiers_rule", fake_roll_modifiers_rule, raising=False)

    result = percentile_check(tables, 100, bonus=1, rng=SequenceRandom([5, 1, 9]))

    assert result["roll"] == 95


def test_zero_units_materializes_00_before_bonus_penalty_selection(tables):
    bonus = percentile_check(tables, 50, bonus=1, rng=random.Random(113))
    penalty = percentile_check(tables, 50, penalty=1, rng=random.Random(113))

    assert bonus["tens_values"] == [4, 0]
    assert bonus["units"] == 0
    assert bonus["unmodified_roll"] == 40
    assert bonus["roll"] == 40
    assert penalty["tens_values"] == [4, 0]
    assert penalty["units"] == 0
    assert penalty["unmodified_roll"] == 40
    assert penalty["roll"] == 100
    assert bonus["success"] is True
    assert penalty["achieved_level"] == "fumble"
    assert penalty["success"] is False


# --------------------------------------------------------------------------- #
# W1-1: spend_luck / recover_luck (Keeper Rulebook p.99, optional rule)
# --------------------------------------------------------------------------- #

def _failed_result(tables, roll=55, target=50):
    return _settled_result(tables, roll, target)


def test_spend_luck_converts_failure_to_success(tables):
    out = spend_luck(tables, _failed_result(tables, roll=55, target=50), 5, 40)

    assert out["roll"] == 50
    assert out["outcome"] == "regular"
    assert out["luck_spent"] == 5
    assert out["luck_remaining"] == 35
    assert out["improvement_tick_eligible"] is False
    assert out["rule_ref"] == "core.optional.spending_luck"


def test_spend_luck_can_reach_hard_success(tables):
    out = spend_luck(tables, _settled_result(tables, 30, 50, "hard"), 5, 20)

    assert out["roll"] == 25
    assert out["outcome"] == "hard"
    assert out["required_level"] == "hard"
    assert out["required_target"] == 25
    assert out["achieved_level"] == "hard"
    assert out["passed"] is True


def test_spend_luck_forbidden_roll_kinds(tables):
    for kind, constraint in [
        ("luck", "luck_may_not_be_spent_on_luck_rolls"),
        ("damage", "luck_may_not_be_spent_on_damage_rolls"),
        ("sanity", "luck_may_not_be_spent_on_sanity_rolls"),
        ("sanity_loss", "luck_may_not_be_spent_on_sanity_loss_amount_rolls"),
    ]:
        try:
            spend_luck(tables, _failed_result(tables), 5, 40, roll_kind=kind)
        except ValueError as exc:
            assert constraint in str(exc)
        else:
            raise AssertionError(f"expected ValueError for roll_kind={kind}")


def test_spend_luck_rejects_pushed_roll(tables):
    result = _failed_result(tables)
    result["pushed"] = True
    try:
        spend_luck(tables, result, 5, 40)
    except ValueError as exc:
        assert "luck_may_not_alter_a_pushed_roll" in str(exc)
    else:
        raise AssertionError("expected ValueError for pushed roll")


def test_spend_luck_rejects_an_already_successful_roll(tables):
    with pytest.raises(ValueError, match="failed_roll"):
        spend_luck(tables, _settled_result(tables, 40, 50), 1, 40)


def test_spend_luck_cannot_buy_off_fumble_or_critical(tables):
    fumble = _failed_result(tables, roll=100)
    critical = _failed_result(tables, roll=1)
    for result in (fumble, critical):
        try:
            spend_luck(tables, result, 5, 40)
        except ValueError as exc:
            assert "criticals_fumbles_malfunctions_cannot_be_bought_off" in str(exc)
        else:
            raise AssertionError("expected ValueError for critical/fumble")


def test_spend_luck_cannot_buy_a_critical(tables):
    # Spending down to a roll of 01 would fabricate a critical.
    try:
        spend_luck(tables, _failed_result(tables, roll=6, target=5), 5, 40)
    except ValueError as exc:
        assert "criticals_fumbles_malfunctions_cannot_be_bought_off" in str(exc)
    else:
        raise AssertionError("expected ValueError when buying down to 01")


def test_spend_luck_requires_enough_luck(tables):
    try:
        spend_luck(tables, _failed_result(tables), 5, 3)
    except ValueError as exc:
        assert "insufficient_luck" in str(exc)
    else:
        raise AssertionError("expected ValueError for insufficient luck")


def test_spend_luck_rejects_non_positive_points(tables):
    try:
        spend_luck(tables, _failed_result(tables), 0, 40)
    except ValueError as exc:
        assert "points" in str(exc)
    else:
        raise AssertionError("expected ValueError for zero points")


@pytest.mark.parametrize("points", [True, 1.0, -1])
def test_spend_luck_rejects_non_integral_or_negative_points(tables, points):
    with pytest.raises(ValueError, match="points"):
        spend_luck(tables, _failed_result(tables), points, 40)


@pytest.mark.parametrize("current_luck", [True, 40.0, -1])
def test_spend_luck_rejects_invalid_current_luck(tables, current_luck):
    with pytest.raises(ValueError, match="current_luck"):
        spend_luck(tables, _failed_result(tables), 1, current_luck)


@pytest.mark.parametrize("roll_kind", ["skills", "ordinary", "", 1, True])
def test_spend_luck_rejects_unknown_roll_kind(tables, roll_kind):
    with pytest.raises(ValueError, match="roll_kind"):
        spend_luck(tables, _failed_result(tables), 1, 40, roll_kind=roll_kind)


def test_spend_luck_rejects_old_or_contradictory_percentile_shapes(tables):
    old_shape = {"target": 50, "effective_target": 25, "difficulty": "hard", "roll": 30, "outcome": "failure"}
    with pytest.raises(ValueError, match="canonical_contract"):
        spend_luck(tables, old_shape, 5, 40)

    contradictory = _settled_result(tables, 30, 50, "hard")
    contradictory["achieved_level"] = "hard"
    with pytest.raises(ValueError, match="contradicts_canonical_contract"):
        spend_luck(tables, contradictory, 5, 40)


def test_recover_luck_success_gains_1d10():
    rng = SequenceRandom([80, 7])  # 1D100=80 > 30, then 1D10=7
    out = recover_luck(30, rng=rng)
    assert out["success"] is True
    assert out["gained"] == 7
    assert out["luck_before"] == 30
    assert out["luck_after"] == 37


def test_recover_luck_failure_gains_nothing():
    rng = SequenceRandom([20])  # 1D100=20 <= 30
    out = recover_luck(30, rng=rng)
    assert out["success"] is False
    assert out["gained"] == 0
    assert out["luck_after"] == 30


def test_recover_luck_caps_at_99():
    rng = SequenceRandom([99, 10])
    out = recover_luck(95, rng=rng)
    assert out["success"] is True
    assert out["luck_after"] == 99
