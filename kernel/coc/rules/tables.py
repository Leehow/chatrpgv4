"""Rule table access. Ported from the old coc_rules.py; paths come from --content."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ..fileio import read_json


class RuleTables:
    def __init__(self, rules_dir: Path) -> None:
        self.rules_dir = Path(rules_dir)
        self._cache: dict[str, Any] = {}

    def load(self, name: str) -> Any:
        if name not in self._cache:
            self._cache[name] = read_json(self.rules_dir / f"{name}.json")
        return self._cache[name]

    def percentile_check_rule(self) -> dict[str, Any]:
        table = self.load("percentile-check")
        return {
            "die": str(table["die"]),
            "minimum_roll": int(table["minimum_roll"]),
            "maximum_roll": int(table["maximum_roll"]),
            "minimum_target": int(table["minimum_target"]),
            "maximum_target": int(table["maximum_target"]),
            "success_if_roll_lte_effective_target": bool(table["success_if_roll_lte_effective_target"]),
            "zero_zero_result": int(table["zero_zero_result"]),
            "digit_base": int(table["digit_base"]),
        }

    def roll_modifiers_rule(self) -> dict[str, Any]:
        table = self.load("roll-modifiers")
        cancellation = table["cancellation"]
        bonus_die = table["bonus_die"]
        penalty_die = table["penalty_die"]
        maximum = table["maximum_dice_per_roll"]
        return {
            "applies_to": str(table["applies_to"]),
            "cancellation": {
                "method": str(cancellation["method"]),
                "net_bonus_formula": str(cancellation["net_bonus_formula"]),
                "net_penalty_formula": str(cancellation["net_penalty_formula"]),
            },
            "maximum_dice_per_roll": {
                "bonus": int(maximum["bonus"]),
                "penalty": int(maximum["penalty"]),
            },
            "bonus_die": {
                "extra_tens_dice_per_die": int(bonus_die["extra_tens_dice_per_die"]),
                "selected_tens": str(bonus_die["selected_tens"]),
                "uses_same_units_die": bool(bonus_die["uses_same_units_die"]),
            },
            "penalty_die": {
                "extra_tens_dice_per_die": int(penalty_die["extra_tens_dice_per_die"]),
                "selected_tens": str(penalty_die["selected_tens"]),
                "uses_same_units_die": bool(penalty_die["uses_same_units_die"]),
            },
        }

    def _threshold_value(self, value: int, key: str) -> int:
        divisor = int(self.load("half-fifth-values")[key]["divisor"])
        return value // divisor

    def half_value(self, value: int) -> int:
        return self._threshold_value(value, "half")

    def fifth_value(self, value: int) -> int:
        return self._threshold_value(value, "fifth")

    def difficulties(self) -> list[str]:
        table = self.load("difficulty-levels")
        return [name for name, block in table.items()
                if isinstance(block, dict) and "divisor" in block]

    def difficulty_target(self, target: int, difficulty: str) -> int:
        table = self.load("difficulty-levels")
        if difficulty not in table:
            raise ValueError(f"unsupported difficulty: {difficulty}")
        block = table[difficulty]
        if not isinstance(block, dict) or "divisor" not in block:
            raise ValueError(f"difficulty {difficulty!r} has no divisor")
        return target // int(block["divisor"])

    def _is_fumble(self, roll: int, target: int) -> bool:
        table = self.load("success-levels")["fumble"]
        threshold = int(table["target_threshold"])
        key = "target_below_threshold" if target < threshold else "target_at_or_above_threshold"
        lower, upper = table[key]
        return lower <= roll <= upper

    def success_level(self, roll: int, target: int) -> str:
        rule = self.percentile_check_rule()
        if not rule["minimum_roll"] <= roll <= rule["maximum_roll"]:
            raise ValueError(f"roll must be between {rule['minimum_roll']} and {rule['maximum_roll']}")
        if not rule["minimum_target"] <= target <= rule["maximum_target"]:
            raise ValueError(f"target must be between {rule['minimum_target']} and {rule['maximum_target']}")
        if roll == int(self.load("success-levels")["critical_roll"]):
            return "critical"
        if self._is_fumble(roll, target):
            return "fumble"
        if roll <= self.fifth_value(target):
            return "extreme"
        if roll <= self.half_value(target):
            return "hard"
        if roll <= target:
            return "regular"
        return "failure"

    def skills_table(self) -> dict[str, Any]:
        """Chapter 4 skill list: canonical name -> {base_chance, group, localized_labels, ...}."""
        return self.load("skills")["skills"]
