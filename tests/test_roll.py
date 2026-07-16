import importlib.util
import random
from pathlib import Path


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


def test_roll_expression_returns_total_and_terms():
    result = coc_roll.roll_expression("2D6+3", rng=random.Random(4))
    assert result["expression"] == "2D6+3"
    assert result["modifier"] == 3
    assert len(result["rolls"]) == 2
    assert result["total"] == sum(result["rolls"]) + 3


def test_percentile_check_applies_hard_difficulty():
    result = coc_roll.percentile_check(60, difficulty="hard", rng=random.Random(1))
    assert result["target"] == 60
    assert result["effective_target"] == 30
    assert result["difficulty"] == "hard"
    assert result["roll"] == 18
    assert result["outcome"] == "regular"


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
        "奖励骰：个位 1，十位 4/1，取 1 -> 11/37，困难成功"
    )


def test_format_percentile_result_shows_penalty_die_components():
    result = coc_roll.percentile_check(70, penalty=1, rng=SequenceRandom([8, 2, 9]))

    assert result["roll"] == 98
    assert coc_roll.format_percentile_result(result, language="zh-Hans") == (
        "惩罚骰：个位 8，十位 2/9，取 9 -> 98/70，失败"
    )


def test_format_percentile_result_shows_tens_units_breakdown_without_modifiers():
    # A plain percentile roll (no bonus/penalty) has no tens_values/units in the
    # result, so the breakdown must be derived from `roll` itself.
    result = {
        "target": 50,
        "effective_target": 50,
        "roll": 47,
        "outcome": "regular",
        "bonus": 0,
        "penalty": 0,
        "tens_values": [],
        "units": None,
    }

    formatted = coc_roll.format_percentile_result(result, language="zh-Hans")

    assert "十位" in formatted
    assert "个位" in formatted
    assert "4" in formatted
    assert "7" in formatted
    assert "47/50" in formatted
    assert formatted.startswith("47/50 = ")


def test_format_percentile_result_breakdown_derives_tens_digit_for_double_digit_roll():
    # roll=100 (valid fumble band): tens digit is 10, units digit is 0.
    result = {
        "target": 80,
        "effective_target": 80,
        "roll": 100,
        "outcome": "fumble",
        "bonus": 0,
        "penalty": 0,
        "tens_values": [],
        "units": None,
    }

    formatted = coc_roll.format_percentile_result(result, language="zh-Hans")

    assert "十位 10" in formatted
    assert "个位 0" in formatted


def test_format_percentile_result_compact_opt_out_preserves_minimal_form():
    result = {
        "target": 50,
        "effective_target": 50,
        "roll": 47,
        "outcome": "regular",
        "bonus": 0,
        "penalty": 0,
        "tens_values": [],
        "units": None,
    }

    formatted = coc_roll.format_percentile_result(result, language="zh-Hans", compact=True)

    assert formatted == "47/50，成功"


def test_format_percentile_result_compact_opt_out_english():
    result = {
        "target": 50,
        "effective_target": 50,
        "roll": 47,
        "outcome": "regular",
        "bonus": 0,
        "penalty": 0,
        "tens_values": [],
        "units": None,
    }

    formatted = coc_roll.format_percentile_result(result, language="en-US", compact=True)

    assert formatted == "47/50, regular"


def test_format_percentile_result_breakdown_english():
    result = {
        "target": 50,
        "effective_target": 50,
        "roll": 47,
        "outcome": "regular",
        "bonus": 0,
        "penalty": 0,
        "tens_values": [],
        "units": None,
    }

    formatted = coc_roll.format_percentile_result(result, language="en-US")

    assert "tens" in formatted
    assert "units" in formatted
    assert "4" in formatted
    assert "7" in formatted
    assert formatted.startswith("47/50 = ")


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
    assert api["format_percentile_result"]["returns"] == "player-facing roll summary"


# --------------------------------------------------------------------------- #
# W1-1: spend_luck / recover_luck (Keeper Rulebook p.99, optional rule)
# --------------------------------------------------------------------------- #

def _failed_result(roll=55, target=50):
    return {
        "target": target,
        "effective_target": target,
        "difficulty": "regular",
        "roll": roll,
        "outcome": "failure",
    }


def test_spend_luck_converts_failure_to_success():
    out = coc_roll.spend_luck(_failed_result(roll=55, target=50), 5, 40)

    assert out["roll"] == 50
    assert out["outcome"] == "regular"
    assert out["luck_spent"] == 5
    assert out["luck_remaining"] == 35
    assert out["improvement_tick_eligible"] is False
    assert out["rule_ref"] == "core.optional.spending_luck"


def test_spend_luck_can_reach_hard_success():
    out = coc_roll.spend_luck(_failed_result(roll=30, target=50), 5, 20)

    assert out["roll"] == 25
    assert out["outcome"] == "hard"


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


def test_spend_luck_cannot_buy_off_fumble_or_critical():
    fumble = _failed_result(roll=100)
    fumble["outcome"] = "fumble"
    critical = _failed_result(roll=1)
    critical["outcome"] = "critical"
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
