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
        }

    monkeypatch.setattr(coc_roll.coc_rules, "percentile_check_rule", fake_percentile_check_rule, raising=False)

    result = coc_roll.percentile_check(15, bonus=1, rng=SequenceRandom([0, 0, 0]))

    assert result["roll"] == 20
