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


def test_bonus_and_penalty_cancel():
    result = coc_roll.percentile_check(50, bonus=1, penalty=1, rng=random.Random(3))
    assert result["bonus"] == 0
    assert result["penalty"] == 0
