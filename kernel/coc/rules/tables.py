"""Rule table access. Ported from the old coc_rules.py; paths come from --content.

Every accessor reads `content/rulesets/coc7/rules-json/<table>.json` through one
cache. Module-level state in the old code (a global RULES_DIR) became this
instance so two content roots can coexist in one process."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from ..fileio import read_json

_SLUG_RE = re.compile(r"[^a-z0-9]+")


def slug(value: Any) -> str:
    return _SLUG_RE.sub("_", str(value or "").casefold()).strip("_")


def _json_copy(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _json_copy(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_copy(item) for item in value]
    return value


class RuleTables:
    def __init__(self, rules_dir: Path) -> None:
        self.rules_dir = Path(rules_dir)
        self._cache: dict[str, Any] = {}

    def load(self, name: str) -> Any:
        if name not in self._cache:
            self._cache[name] = read_json(self.rules_dir / f"{name}.json")
        return self._cache[name]

    def exists(self, name: str) -> bool:
        return (self.rules_dir / f"{name}.json").exists()

    # ---- rule index -------------------------------------------------------

    def rule_index(self) -> list[dict[str, Any]]:
        rules = self.load("rule-index").get("rules", [])
        return [r for r in rules if isinstance(r, dict) and isinstance(r.get("id"), str)]

    def rule_ids(self) -> set[str]:
        return {rule["id"] for rule in self.rule_index()}

    def resolve_rule_refs(self, refs: list[str]) -> list[dict[str, Any]]:
        by_id = {rule["id"]: rule for rule in self.rule_index()}
        return [by_id[ref] for ref in refs if ref in by_id]

    # ---- percentile mechanics ---------------------------------------------

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
            "maximum_dice_per_roll": {"bonus": int(maximum["bonus"]), "penalty": int(maximum["penalty"])},
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

    def pushed_roll_rule(self) -> dict[str, Any]:
        table = self.load("pushed-roll")
        return {
            "maximum_attempts_after_initial_failure": int(table["maximum_attempts_after_initial_failure"]),
            "requires_changed_approach": bool(table["requires_changed_approach"]),
            "requires_keeper_foreshadowed_failure": bool(table["requires_keeper_foreshadowed_failure"]),
            "requires_keeper_owned_failure_consequence": bool(table["requires_keeper_owned_failure_consequence"]),
            "requires_player_confirmation": bool(table["requires_player_confirmation"]),
            "required_stages": [str(stage) for stage in table["required_stages"]],
            "non_pushable_skill_names": [str(v) for v in table.get("non_pushable_skill_names") or []],
            "non_pushable_specialization_groups": [str(v) for v in table.get("non_pushable_specialization_groups") or []],
        }

    def combined_roll_rule(self) -> dict[str, Any]:
        table = self.load("combat")["combined_roll"]
        return {
            "roll_count": int(table["roll_count"]),
            "minimum_compared_targets": int(table["minimum_compared_targets"]),
            "requires_compared_targets": bool(table["requires_compared_targets"]),
            "comparison_modes": [str(value) for value in table["comparison_modes"]],
        }

    def opposed_roll_rule(self) -> dict[str, Any]:
        table = self.load("combat")["opposed_roll"]
        return {
            "participant_rolls": int(table["participant_rolls"]),
            "requires_mutually_exclusive_goals": bool(table["requires_mutually_exclusive_goals"]),
            "uses_success_level_order": bool(table["uses_success_level_order"]),
            "tie_breakers": [str(item) for item in table["tie_breakers"]],
            "can_be_pushed": bool(table["can_be_pushed"]),
        }

    def combat_rule(self) -> dict[str, Any]:
        table = self.load("combat")["melee_combat"]
        maneuver = table["maneuver"]
        return {
            "order": {"sort_key": str(table["order"]["sort_key"]), "direction": str(table["order"]["direction"])},
            "actions_per_round": int(table["actions_per_round"]),
            "uses_percentile_check": bool(table["uses_percentile_check"]),
            "uses_success_level": bool(table["uses_success_level"]),
            "combat_rolls_can_be_pushed": bool(table["combat_rolls_can_be_pushed"]),
            "defense_options": [str(item) for item in table["defense_options"]],
            "attack_vs_dodge": _json_copy(table["attack_vs_dodge"]),
            "attack_vs_fight_back": _json_copy(table["attack_vs_fight_back"]),
            "maneuver": {
                "build_difference_impossible_at": int(maneuver["build_difference_impossible_at"]),
                "penalty_die_per_build_difference": int(maneuver["penalty_die_per_build_difference"]),
                "attack_vs_dodge_tie_winner": str(maneuver["attack_vs_dodge_tie_winner"]),
                "attack_vs_fight_back_tie_winner": str(maneuver["attack_vs_fight_back_tie_winner"]),
            },
        }

    def damage_rule(self) -> dict[str, Any]:
        return _json_copy(self.load("damage"))

    def reward_rule(self) -> dict[str, Any]:
        return _json_copy(self.load("reward"))

    # ---- thresholds -------------------------------------------------------

    def _threshold_value(self, value: int, key: str) -> int:
        divisor = int(self.load("half-fifth-values")[key]["divisor"])
        return value // divisor

    def half_value(self, value: int) -> int:
        return self._threshold_value(value, "half")

    def fifth_value(self, value: int) -> int:
        return self._threshold_value(value, "fifth")

    def difficulties(self) -> list[str]:
        table = self.load("difficulty-levels")
        return [name for name, block in table.items() if isinstance(block, dict) and "divisor" in block]

    def difficulty_target(self, target: int, difficulty: str) -> int:
        table = self.load("difficulty-levels")
        if difficulty not in table:
            raise ValueError(f"unsupported difficulty: {difficulty}")
        block = table[difficulty]
        if not isinstance(block, dict) or "divisor" not in block:
            raise ValueError(f"difficulty {difficulty!r} has no divisor")
        return target // int(block["divisor"])

    def difficulty_from_opponent(self, opponent_skill: int) -> str:
        """Opposed rolls (p.83): opponent <50 -> regular, 50-89 -> hard, 90+ -> extreme."""
        block = self.load("difficulty-levels").get("from_opponent", {})
        threshold_regular = int(block.get("threshold_regular", 50))
        threshold_hard = int(block.get("threshold_hard", 90))
        skill = int(opponent_skill)
        if skill >= threshold_hard:
            return "extreme"
        if skill >= threshold_regular:
            return "hard"
        return "regular"

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

    # ---- characteristics / build -----------------------------------------

    def damage_bonus_build(self, str_value: int, siz_value: int) -> dict[str, int | str]:
        total = str_value + siz_value
        for row in self.load("damage-bonus-build"):
            if row["min"] <= total <= row["max"]:
                result: dict[str, int | str] = {"total": total, "damage_bonus": row["damage_bonus"],
                                                "build": row["build"]}
                extrapolation = row.get("extrapolation")
                if extrapolation is not None and total > extrapolation["applies_when_total_greater_than"]:
                    excess = total - extrapolation["applies_when_total_greater_than"]
                    steps = (excess + extrapolation["per_80_points"] - 1) // extrapolation["per_80_points"]
                    result["damage_bonus"] = f"+{5 + steps}D6"
                    result["build"] = 6 + steps
                return result
        raise ValueError(f"STR+SIZ total out of table range: {total}")

    def characteristic_dice(self) -> dict[str, Any]:
        return self.load("characteristic-dice")["characteristics"]

    def build_scale_row(self, build: int) -> dict[str, Any]:
        rows = sorted((row for row in self.load("build-scale").get("comparative_builds", [])
                       if isinstance(row, dict) and isinstance(row.get("build"), int)),
                      key=lambda row: row["build"])
        for row in rows:
            if row["build"] == build:
                return {"listed": True, **row}
        result: dict[str, Any] = {"build": build, "listed": False}
        lower = [row for row in rows if row["build"] < build]
        upper = [row for row in rows if row["build"] > build]
        if lower:
            result["nearest_below"] = lower[-1]
        if upper:
            result["nearest_above"] = upper[0]
        return result

    def compare_builds(self, actor_build: int, target_build: int) -> dict[str, Any]:
        bands = {int(band["relative_build"]): band
                 for band in self.load("build-scale").get("lift_throw_bands", []) if isinstance(band, dict)}
        maneuver = self.combat_rule()["maneuver"]
        impossible_at = maneuver["build_difference_impossible_at"]
        per_difference = maneuver["penalty_die_per_build_difference"]
        relative = target_build - actor_build
        band = bands[max(-2, min(2, relative))]
        return {
            "actor_build": actor_build, "target_build": target_build, "relative_build": relative,
            "lift_throw": {"verdict": str(band["verdict"]), "note": str(band["note"])},
            "maneuver": {"penalty_dice": max(0, relative) * per_difference if relative < impossible_at else 0,
                         "impossible": relative >= impossible_at},
            "rule_ref": "keeper-rulebook p.279 (Table XV), p.105",
        }

    # ---- catalog tables ---------------------------------------------------

    def weapons_table(self) -> dict[str, Any]:
        return self.load("weapons")["weapons"]

    def weapon_by_name(self, name: str) -> dict[str, Any]:
        row = self.weapons_table().get(name)
        if row is None:
            raise KeyError(f"unknown weapon: {name!r}")
        return row

    def skills_table(self) -> dict[str, Any]:
        """Chapter 4 skill list: canonical name -> {base_chance, group, localized_labels, ...}."""
        return self.load("skills")["skills"]

    def skill_by_name(self, name: str) -> dict[str, Any]:
        row = self.skills_table().get(name)
        if row is None:
            raise KeyError(f"unknown skill: {name!r}")
        return row

    def skill_specialization_groups(self) -> dict[str, Any]:
        return self.load("skills")["specialization_groups"]

    def occupations_table(self) -> dict[str, Any]:
        return self.load("occupations")["occupations"]

    def spells_table(self) -> dict[str, Any]:
        return self.load("spells")

    def magic_casting_rules(self) -> dict[str, Any]:
        return self.spells_table().get("casting", {})

    def magic_learning_rules(self) -> dict[str, Any]:
        return self.spells_table().get("learning", {})

    def magic_mp_economy(self) -> dict[str, Any]:
        return self.spells_table().get("mp_economy", {})

    def tomes_table(self) -> dict[str, Any]:
        return self.load("tomes").get("tomes", {})

    def monsters_table(self) -> dict[str, Any]:
        return self.load("monsters").get("monsters", {})

    def bout_realtime_table(self) -> list:
        return self.load("bout-tables").get("realtime", [])

    def bout_summary_table(self) -> list:
        return self.load("bout-tables").get("summary", [])

    def phobias_table(self) -> dict[str, Any]:
        return self.load("phobias").get("phobias", {})

    def manias_table(self) -> dict[str, Any]:
        return self.load("manias").get("manias", {})

    def equipment_table(self) -> dict[str, Any]:
        data = self.load("equipment")
        if (not isinstance(data, dict) or data.get("schema_version") != 2
                or not isinstance(data.get("records"), list) or "periods" in data):
            raise ValueError("equipment.json must be schema-v2 records[] without legacy periods")
        return data

    def poisons_table(self) -> dict[str, Any]:
        return self.load("poisons").get("poisons", {})

    def hazards_table(self) -> dict[str, Any]:
        return self.load("hazards")

    def artifacts_table(self) -> dict[str, Any]:
        return self.load("artifacts").get("artifacts", {})

    def skill_descriptions(self) -> dict[str, Any]:
        return self.load("skill-descriptions")

    def chase_table(self) -> dict[str, Any]:
        return self.load("chase")

    # ---- sanity / luck / development -------------------------------------

    def sanity_max_formula(self) -> dict[str, Any]:
        return self.load("sanity").get("max_san", {})

    def sanity_table(self) -> dict[str, Any]:
        return self.load("sanity")

    def treatment_rule(self) -> dict[str, Any]:
        return self.load("treatment")

    def luck_rule(self) -> dict[str, Any]:
        table = self.load("luck")
        spend = table.get("spend", {})
        roll = table.get("roll", {})
        recovery = table.get("recovery", {})
        return {
            "spend": {
                "luck_point_value": int(spend.get("luck_point_value", 1)),
                "cost_per_point_off_roll": int(spend.get("cost_per_point_off_roll", 1)),
                "applies": spend.get("applies", "lower_total_roll_toward_target"),
                "constraints": [str(c) for c in spend.get("constraints", [])],
            },
            "roll": {"use": roll.get("use", "group_luck_check"),
                     "group_roll_policy": roll.get("group_roll_policy", "take_lowest")},
            "recovery": {
                "applies_when": recovery.get("applies_when", "after_each_session"),
                "check": recovery.get("check", "1D100 > current_luck"),
                "gain_on_success": recovery.get("gain_on_success", "1D10"),
                "cap": int(recovery.get("cap", 99)),
                "optional_rule": bool(recovery.get("optional_rule", False)),
            },
        }

    def development_rule(self) -> dict[str, Any]:
        table = self.load("development")
        tick = table.get("tick", {})
        improvement = table.get("improvement_roll", {})
        return {
            "tick": {
                "awarded_when": tick.get("awarded_when", "regular_or_hard_or_extreme_success"),
                "ticks_per_qualifying_success": int(tick.get("ticks_per_qualifying_success", 1)),
                "excluded_outcomes": list(tick.get("excluded_outcomes", [])),
                "never_tick_skills": [str(s) for s in tick.get("never_tick_skills", [])],
            },
            "improvement_roll": {
                "check": improvement.get("check", "1D100 > current_skill or 1D100 > 95"),
                "always_improves_above": int(improvement.get("always_improves_above", 95)),
                "gain_on_success": improvement.get("gain_on_success", "1D10"),
                "san_reward_threshold": int(improvement.get("san_reward_threshold",
                                                            improvement.get("cap_for_san_reward", 90))),
                "cap_for_san_reward": int(improvement.get("cap_for_san_reward", 90)),
            },
            "sanity_reward": self.sanity_reward_rule(),
        }

    def sanity_reward_rule(self) -> dict[str, Any]:
        reward = self.load("development").get("sanity_reward", {})
        return {
            "applies_when": reward.get("applies_when", "skill_reaches_90_or_above_via_development"),
            "reward": reward.get("reward", "2D6"),
            "constraint": reward.get("constraint", "cannot_exceed_max_san"),
        }

    # ---- finance ----------------------------------------------------------

    @staticmethod
    def _finance_amount(amount: float | int | None, currency: str = "USD",
                        formula: str | None = None) -> dict[str, Any]:
        out: dict[str, Any] = {"amount": amount, "currency": currency}
        if formula:
            out["formula"] = formula
        return out

    def cash_and_assets(self, credit_rating: int, period: str = "1920s") -> dict[str, Any]:
        table = self.load("cash-assets")
        periods = table.get("periods", {})
        if not isinstance(periods, dict) or period not in periods:
            raise ValueError(f"unsupported finance period: {period}")
        rows = periods[period]
        if not isinstance(rows, list):
            raise ValueError(f"cash-assets table period is not a list: {period}")
        currency = str(table.get("currency") or "USD")
        for row in rows:
            if not isinstance(row, dict):
                continue
            if row["credit_rating_min"] <= credit_rating <= row["credit_rating_max"]:
                cash_formula = None
                cash_amount = row.get("cash")
                if "cash_multiplier" in row:
                    cash_formula = f"CR x {row['cash_multiplier']}"
                    cash_amount = credit_rating * row["cash_multiplier"]
                assets_formula = None
                assets_amount = row.get("assets")
                if "assets_multiplier" in row:
                    assets_formula = f"CR x {row['assets_multiplier']}"
                    assets_amount = credit_rating * row["assets_multiplier"]
                elif "assets_minimum" in row:
                    assets_formula = "minimum"
                    assets_amount = row["assets_minimum"]
                elif assets_amount is None:
                    assets_formula = "None"
                return {
                    "credit_rating": credit_rating,
                    "living_standard": row["living_standard"],
                    "cash": self._finance_amount(cash_amount, currency, cash_formula),
                    "assets": self._finance_amount(assets_amount, currency, assets_formula),
                    "spending_level": self._finance_amount(row.get("spending_level"), currency),
                    "period": period,
                }
        raise ValueError(f"credit rating out of cash-assets table range: {credit_rating}")
