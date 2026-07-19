import importlib.util
import random
from pathlib import Path

import pytest


def load_module(name: str, relative_path: str):
    path = Path(relative_path)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_roll = load_module("coc_roll", "plugins/coc-keeper/scripts/coc_roll.py")


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


def _settled_result(
    roll: int,
    base_target: int,
    required_level: str = "regular",
    **extra,
):
    return {
        **coc_roll.resolve_percentile_roll(
            roll, base_target, required_level
        ),
        "roll": roll,
        "bonus": 0,
        "penalty": 0,
        "tens_values": [],
        "units": None,
        **extra,
    }


def test_roll_expression_returns_total_and_terms():
    result = coc_roll.roll_expression("2D6+3", rng=random.Random(4))
    assert result["expression"] == "2D6+3"
    assert result["modifier"] == 3
    assert len(result["rolls"]) == 2
    assert result["total"] == sum(result["rolls"]) + 3


def test_percentile_check_applies_hard_difficulty():
    result = coc_roll.percentile_check(60, difficulty="hard", rng=random.Random(1))
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


def test_required_and_achieved_levels_are_distinct_with_surplus():
    result = coc_roll.percentile_check(
        45,
        difficulty="hard",
        rng=SequenceRandom([5]),
    )

    assert result["required_level"] == "hard"
    assert result["required_target"] == 22
    assert result["achieved_level"] == "extreme"
    assert result["passed"] is True
    assert result["surplus_levels"] == 1
    assert result["outcome"] == "extreme"


def test_achieved_regular_can_fail_a_hard_requirement():
    result = coc_roll.percentile_check(
        45,
        difficulty="hard",
        rng=SequenceRandom([30]),
    )

    assert result["achieved_level"] == "regular"
    assert result["passed"] is False
    assert result["success"] is False
    assert result["surplus_levels"] == 0
    assert result["outcome"] == "failure"


def test_fumble_band_uses_required_target_not_base_target():
    result = coc_roll.percentile_check(
        80,
        difficulty="hard",
        rng=SequenceRandom([96]),
    )

    assert result["base_target"] == 80
    assert result["required_target"] == 40
    assert result["achieved_level"] == "fumble"
    assert result["outcome"] == "fumble"
    assert result["passed"] is False


def test_critical_is_achieved_above_an_extreme_requirement():
    result = coc_roll.percentile_check(
        45,
        difficulty="extreme",
        rng=SequenceRandom([1]),
    )

    assert result["achieved_level"] == "critical"
    assert result["passed"] is True
    assert result["surplus_levels"] == 1
    assert result["outcome"] == "critical"


@pytest.mark.parametrize(
    (
        "base_target",
        "required_level",
        "roll",
        "required_target",
        "achieved_level",
        "passed",
        "outcome",
        "surplus_levels",
    ),
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
    base_target,
    required_level,
    roll,
    required_target,
    achieved_level,
    passed,
    outcome,
    surplus_levels,
):
    result = coc_roll.resolve_percentile_roll(
        roll, base_target, required_level
    )

    assert result["required_target"] == required_target
    assert result["achieved_level"] == achieved_level
    assert result["passed"] is passed
    assert result["success"] is passed
    assert result["outcome"] == outcome
    assert result["surplus_levels"] == surplus_levels


def test_percentile_check_uses_rules_json_difficulty_target(monkeypatch):
    calls = []

    def fake_difficulty_target(target: int, difficulty: str) -> int:
        calls.append((target, difficulty))
        return 17

    monkeypatch.setattr(coc_roll.coc_rules, "difficulty_target", fake_difficulty_target, raising=False)

    result = coc_roll.percentile_check(60, difficulty="hard", rng=random.Random(1))

    assert calls == [(60, "hard")]
    assert result["effective_target"] == 17


def test_percentile_check_uses_rules_json_roll_bounds(monkeypatch):
    calls = []

    def fake_percentile_check_rule():
        calls.append("bounds")
        return {
            "die": "1D20",
            "minimum_roll": 10,
            "maximum_roll": 20,
            "minimum_target": 1,
            "maximum_target": 100,
            "success_if_roll_lte_effective_target": True,
            "zero_zero_result": 20,
            "digit_base": 10,
        }

    monkeypatch.setattr(coc_roll.coc_rules, "percentile_check_rule", fake_percentile_check_rule, raising=False)

    result = coc_roll.percentile_check(50, rng=random.Random(1))

    assert calls
    assert 10 <= result["roll"] <= 20


def test_bonus_and_penalty_cancel():
    result = coc_roll.percentile_check(50, bonus=1, penalty=1, rng=random.Random(3))
    assert result["bonus"] == 0
    assert result["penalty"] == 0


def test_percentile_bonus_dice_use_rules_json_zero_zero_result(monkeypatch):
    def fake_percentile_check_rule():
        return {
            "die": "1D20",
            "minimum_roll": 1,
            "maximum_roll": 20,
            "minimum_target": 1,
            "maximum_target": 20,
            "success_if_roll_lte_effective_target": True,
            "zero_zero_result": 20,
            "digit_base": 10,
        }

    monkeypatch.setattr(coc_roll.coc_rules, "percentile_check_rule", fake_percentile_check_rule, raising=False)

    result = coc_roll.percentile_check(15, bonus=1, rng=SequenceRandom([0, 0, 0]))

    assert result["roll"] == 20


def test_percentile_bonus_dice_use_rules_json_digit_base(monkeypatch):
    def fake_percentile_check_rule():
        return {
            "die": "1D25",
            "minimum_roll": 1,
            "maximum_roll": 25,
            "minimum_target": 1,
            "maximum_target": 25,
            "success_if_roll_lte_effective_target": True,
            "zero_zero_result": 25,
            "digit_base": 5,
        }

    monkeypatch.setattr(coc_roll.coc_rules, "percentile_check_rule", fake_percentile_check_rule, raising=False)

    result = coc_roll.percentile_check(25, bonus=1, rng=SequenceRandom([3, 4, 4]))

    assert result["roll"] == 23
    assert result["tens_values"] == [4, 4]
    assert result["units"] == 3


def test_percentile_bonus_dice_selection_uses_rules_json_roll_modifiers(monkeypatch):
    def fake_roll_modifiers_rule():
        return {
            "applies_to": "percentile-check",
            "cancellation": {
                "method": "one_for_one",
                "net_bonus_formula": "max(0, bonus - penalty)",
                "net_penalty_formula": "max(0, penalty - bonus)",
            },
            "bonus_die": {
                "extra_tens_dice_per_die": 1,
                "selected_tens": "highest",
                "uses_same_units_die": True,
            },
            "penalty_die": {
                "extra_tens_dice_per_die": 1,
                "selected_tens": "lowest",
                "uses_same_units_die": True,
            },
        }

    monkeypatch.setattr(coc_roll.coc_rules, "roll_modifiers_rule", fake_roll_modifiers_rule, raising=False)

    result = coc_roll.percentile_check(100, bonus=1, rng=SequenceRandom([5, 1, 9]))

    assert result["roll"] == 95


def test_format_percentile_result_shows_bonus_die_components():
    result = coc_roll.percentile_check(37, bonus=1, rng=SequenceRandom([1, 4, 1]))

    assert result["roll"] == 11
    assert coc_roll.format_percentile_result(result, language="zh-Hans") == (
        "奖励骰：个位 1，十位 4/1，取 1 → "
        "掷骰：11；基础值：37；门槛：普通（≤37）；"
        "达到：困难成功（超出 1 级）；通过"
    )


def test_format_percentile_result_shows_penalty_die_components():
    result = coc_roll.percentile_check(70, penalty=1, rng=SequenceRandom([8, 2, 9]))

    assert result["roll"] == 98
    assert coc_roll.format_percentile_result(result, language="zh-Hans") == (
        "惩罚骰：个位 8，十位 2/9，取 9 → "
        "掷骰：98；基础值：70；门槛：普通（≤70）；达到：失败；未通过"
    )


def test_format_percentile_result_shows_tens_units_breakdown_without_modifiers():
    # A plain percentile roll (no bonus/penalty) has no tens_values/units in the
    # result, so the breakdown must be derived from `roll` itself.
    result = _settled_result(47, 50)

    formatted = coc_roll.format_percentile_result(result, language="zh-Hans")

    assert "十位" in formatted
    assert "个位" in formatted
    assert "4" in formatted
    assert "7" in formatted
    assert "掷骰：47" in formatted
    assert "基础值：50" in formatted
    assert "门槛：普通（≤50）" in formatted


def test_format_percentile_result_breakdown_derives_tens_digit_for_double_digit_roll():
    # roll=100 (valid fumble band): tens digit is 10, units digit is 0.
    result = _settled_result(100, 80)

    formatted = coc_roll.format_percentile_result(result, language="zh-Hans")

    assert "十位 10" in formatted
    assert "个位 0" in formatted


def test_format_percentile_result_compact_opt_out_preserves_minimal_form():
    result = _settled_result(47, 50)

    formatted = coc_roll.format_percentile_result(result, language="zh-Hans", compact=True)

    assert formatted == (
        "掷骰：47；基础值：50；门槛：普通（≤50）；达到：成功；通过"
    )


def test_format_percentile_result_compact_opt_out_english():
    result = _settled_result(47, 50)

    formatted = coc_roll.format_percentile_result(result, language="en-US", compact=True)

    assert formatted == (
        "roll: 47; base: 50; required: Regular (≤50); "
        "achieved: Regular; passed"
    )


def test_format_percentile_result_breakdown_english():
    result = _settled_result(47, 50)

    formatted = coc_roll.format_percentile_result(result, language="en-US")

    assert "tens" in formatted
    assert "units" in formatted
    assert "4" in formatted
    assert "7" in formatted
    assert "roll: 47" in formatted
    assert "base: 50" in formatted
    assert "required: Regular (≤50)" in formatted


def test_format_percentile_result_shows_contextual_pass_surplus():
    result = _settled_result(5, 45, "hard")

    assert coc_roll.format_percentile_result(result, compact=True) == (
        "掷骰：5；基础值：45；门槛：困难（≤22）；"
        "达到：极难成功（超出 1 级）；通过"
    )


def test_format_percentile_result_shows_failed_hard_gate_without_contradiction():
    result = _settled_result(30, 45, "hard")

    formatted = coc_roll.format_percentile_result(result, compact=True)

    assert formatted == (
        "掷骰：30；基础值：45；门槛：困难（≤22）；达到：成功；未通过"
    )
    assert "30/45，失败" not in formatted


def test_format_percentile_result_rejects_old_or_contradictory_shapes():
    with pytest.raises(ValueError, match="lacks contextual fields"):
        coc_roll.format_percentile_result(
            {"roll": 30, "target": 45, "outcome": "failure"},
            compact=True,
        )

    contradictory = _settled_result(30, 45, "hard")
    contradictory["passed"] = True
    with pytest.raises(ValueError, match="contradicts canonical settlement"):
        coc_roll.format_percentile_result(contradictory, compact=True)


def test_roll_percentile_alias_matches_percentile_check():
    rng = SequenceRandom([1, 4, 1])

    result = coc_roll.roll_percentile(37, bonus=1, rng=rng)

    assert result["roll"] == 11
    assert result["bonus"] == 1


def test_public_api_index_lists_aliases_and_formatters():
    api = coc_roll.public_api_index()

    assert "percentile_check" in api
    assert "roll_percentile" in api["percentile_check"]["aliases"]
    assert "format_percentile_result" in api
    assert api["format_percentile_result"]["returns"] == (
        "context-complete player-facing roll summary"
    )


# --------------------------------------------------------------------------- #
# W1-1: spend_luck / recover_luck (Keeper Rulebook p.99, optional rule)
# --------------------------------------------------------------------------- #

def _failed_result(roll=55, target=50):
    return _settled_result(roll, target)


def test_spend_luck_converts_failure_to_success():
    out = coc_roll.spend_luck(_failed_result(roll=55, target=50), 5, 40)

    assert out["roll"] == 50
    assert out["outcome"] == "regular"
    assert out["luck_spent"] == 5
    assert out["luck_remaining"] == 35
    assert out["improvement_tick_eligible"] is False
    assert out["rule_ref"] == "core.optional.spending_luck"


def test_spend_luck_can_reach_hard_success():
    out = coc_roll.spend_luck(
        _settled_result(30, 50, "hard"), 5, 20
    )

    assert out["roll"] == 25
    assert out["outcome"] == "hard"
    assert out["required_level"] == "hard"
    assert out["required_target"] == 25
    assert out["achieved_level"] == "hard"
    assert out["passed"] is True


def test_spend_luck_forbidden_roll_kinds():
    for kind, constraint in [
        ("luck", "luck_may_not_be_spent_on_luck_rolls"),
        ("damage", "luck_may_not_be_spent_on_damage_rolls"),
        ("sanity", "luck_may_not_be_spent_on_sanity_rolls"),
        ("sanity_loss", "luck_may_not_be_spent_on_sanity_loss_amount_rolls"),
    ]:
        try:
            coc_roll.spend_luck(_failed_result(), 5, 40, roll_kind=kind)
        except ValueError as exc:
            assert constraint in str(exc)
        else:
            raise AssertionError(f"expected ValueError for roll_kind={kind}")


def test_spend_luck_rejects_pushed_roll():
    result = _failed_result()
    result["pushed"] = True
    try:
        coc_roll.spend_luck(result, 5, 40)
    except ValueError as exc:
        assert "luck_may_not_alter_a_pushed_roll" in str(exc)
    else:
        raise AssertionError("expected ValueError for pushed roll")


def test_spend_luck_rejects_an_already_successful_roll():
    with pytest.raises(ValueError, match="failed_roll"):
        coc_roll.spend_luck(_settled_result(40, 50), 1, 40)


def test_spend_luck_cannot_buy_off_fumble_or_critical():
    fumble = _failed_result(roll=100)
    critical = _failed_result(roll=1)
    for result in (fumble, critical):
        try:
            coc_roll.spend_luck(result, 5, 40)
        except ValueError as exc:
            assert "criticals_fumbles_malfunctions_cannot_be_bought_off" in str(exc)
        else:
            raise AssertionError("expected ValueError for critical/fumble")


def test_spend_luck_cannot_buy_a_critical():
    # Spending down to a roll of 01 would fabricate a critical.
    try:
        coc_roll.spend_luck(_failed_result(roll=6, target=5), 5, 40)
    except ValueError as exc:
        assert "criticals_fumbles_malfunctions_cannot_be_bought_off" in str(exc)
    else:
        raise AssertionError("expected ValueError when buying down to 01")


def test_spend_luck_requires_enough_luck():
    try:
        coc_roll.spend_luck(_failed_result(), 5, 3)
    except ValueError as exc:
        assert "insufficient_luck" in str(exc)
    else:
        raise AssertionError("expected ValueError for insufficient luck")


def test_spend_luck_rejects_non_positive_points():
    try:
        coc_roll.spend_luck(_failed_result(), 0, 40)
    except ValueError as exc:
        assert "points" in str(exc)
    else:
        raise AssertionError("expected ValueError for zero points")


@pytest.mark.parametrize("points", [True, 1.0, -1])
def test_spend_luck_rejects_non_integral_or_negative_points(points):
    with pytest.raises(ValueError, match="points"):
        coc_roll.spend_luck(_failed_result(), points, 40)


@pytest.mark.parametrize("current_luck", [True, 40.0, -1])
def test_spend_luck_rejects_invalid_current_luck(current_luck):
    with pytest.raises(ValueError, match="current_luck"):
        coc_roll.spend_luck(_failed_result(), 1, current_luck)


@pytest.mark.parametrize("roll_kind", ["skills", "ordinary", "", 1, True])
def test_spend_luck_rejects_unknown_roll_kind(roll_kind):
    with pytest.raises(ValueError, match="roll_kind"):
        coc_roll.spend_luck(
            _failed_result(), 1, 40, roll_kind=roll_kind
        )


def test_spend_luck_rejects_old_or_contradictory_percentile_shapes():
    old_shape = {
        "target": 50,
        "effective_target": 25,
        "difficulty": "hard",
        "roll": 30,
        "outcome": "failure",
    }
    with pytest.raises(ValueError, match="canonical_contract"):
        coc_roll.spend_luck(old_shape, 5, 40)

    contradictory = _settled_result(30, 50, "hard")
    contradictory["achieved_level"] = "hard"
    with pytest.raises(ValueError, match="contradicts_canonical_contract"):
        coc_roll.spend_luck(contradictory, 5, 40)


def test_recover_luck_success_gains_1d10():
    rng = SequenceRandom([80, 7])  # 1D100=80 > 30, then 1D10=7

    out = coc_roll.recover_luck(30, rng=rng)

    assert out["success"] is True
    assert out["gained"] == 7
    assert out["luck_before"] == 30
    assert out["luck_after"] == 37


def test_recover_luck_failure_gains_nothing():
    rng = SequenceRandom([20])  # 1D100=20 <= 30

    out = coc_roll.recover_luck(30, rng=rng)

    assert out["success"] is False
    assert out["gained"] == 0
    assert out["luck_after"] == 30


def test_recover_luck_caps_at_99():
    rng = SequenceRandom([99, 10])

    out = coc_roll.recover_luck(95, rng=rng)

    assert out["success"] is True
    assert out["luck_after"] == 99


def test_zero_units_materializes_00_before_bonus_penalty_selection():
    bonus = coc_roll.percentile_check(
        50, bonus=1, rng=random.Random(113)
    )
    penalty = coc_roll.percentile_check(
        50, penalty=1, rng=random.Random(113)
    )

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
