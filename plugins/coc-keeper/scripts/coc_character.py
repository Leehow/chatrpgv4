#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import re
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
_COC_RULES_PATH = SCRIPT_DIR / "coc_rules.py"
_COC_RULES_SPEC = importlib.util.spec_from_file_location("coc_rules", _COC_RULES_PATH)
coc_rules = importlib.util.module_from_spec(_COC_RULES_SPEC)
assert _COC_RULES_SPEC.loader is not None
_COC_RULES_SPEC.loader.exec_module(coc_rules)


REQUIRED_CHARACTERISTICS = ("STR", "CON", "SIZ", "DEX", "APP", "INT", "POW", "EDU")
ERA_ADAPTIVE_INPUT_MODE = "kp_guided_era_adaptive"
ERA_ADAPTIVE_SHEET_REQUIRED = (
    "id", "name", "era", "era_adaptive", "kp_guided", "occupation",
    "characteristics", "derived", "skills", "skill_provenance",
    "player_facing_sheet_zh",
)
ERA_ADAPTIVE_CREATION_REQUIRED = (
    "input_mode", "era", "era_adaptive", "kp_guided", "method",
    "luck_roll_total", "luck_roll_receipt", "occupation", "skill_budget",
)
ERA_ADAPTIVE_PROVENANCE_REQUIRED = (
    "original_name", "reskinned_name", "era_adaptive",
)
SINGLE_DIE_PATTERN = re.compile(r"^1D(?P<sides>\d+)$")

# Exact literals from rules-json/occupations.json, whose source_note anchors
# them to Keeper Rulebook Chapter 3 sample occupations (pp. 40–41).  The data
# has no structured formula AST, so this closed table deliberately fails if a
# rule-data literal changes instead of silently growing a second parser.
_OCCUPATION_FORMULA_VARIANTS: dict[str, tuple[tuple[tuple[str, int], ...], ...]] = {
    "EDU*4": ((("EDU", 4),),),
    "EDU*2+APP*2": ((("EDU", 2), ("APP", 2)),),
    "EDU*2+DEX*2": ((("EDU", 2), ("DEX", 2)),),
    "EDU*2+either APP*2 or POW*2": (
        (("EDU", 2), ("APP", 2)), (("EDU", 2), ("POW", 2)),
    ),
    "EDU*2+either APP*2, DEX*2 or STR*2": (
        (("EDU", 2), ("APP", 2)), (("EDU", 2), ("DEX", 2)),
        (("EDU", 2), ("STR", 2)),
    ),
    "EDU*2+either DEX*2 or POW*2": (
        (("EDU", 2), ("DEX", 2)), (("EDU", 2), ("POW", 2)),
    ),
    "EDU*2+either DEX*2 or STR*2": (
        (("EDU", 2), ("DEX", 2)), (("EDU", 2), ("STR", 2)),
    ),
    "EDU*2+either POW*2 or DEX*2": (
        (("EDU", 2), ("POW", 2)), (("EDU", 2), ("DEX", 2)),
    ),
}


def _single_die_range(expression: str) -> tuple[int, int]:
    match = SINGLE_DIE_PATTERN.match(expression.strip().upper())
    if match is None:
        raise ValueError(f"unsupported single-die expression: {expression}")
    return 1, int(match.group("sides"))


def characteristic_generation_methods() -> dict[str, dict[str, Any]]:
    """Return configured characteristic generation methods from rules JSON."""
    rules = coc_rules.load_rule_table("characteristic-dice")
    methods = rules.get("generation_methods", {})
    if not isinstance(methods, dict):
        return {}
    return json.loads(json.dumps(methods))


def characteristic_roll_expressions() -> dict[str, str]:
    """Return the rule-owned dice expressions for characteristics and Luck."""
    rules = coc_rules.load_rule_table("characteristic-dice")
    entries = rules.get("characteristics", {})
    if not isinstance(entries, dict):
        return {}
    expressions: dict[str, str] = {}
    for key in (*REQUIRED_CHARACTERISTICS, "Luck"):
        spec = entries.get(key)
        expression = spec.get("dice") if isinstance(spec, dict) else None
        if isinstance(expression, str) and expression.strip():
            expressions[key] = expression.strip().upper()
    return expressions


def characteristic_generation_multiplier() -> int:
    """Return the rules-json multiplier used to convert rolls to full values."""
    rules = coc_rules.load_rule_table("characteristic-dice")
    multiplier = rules.get("multiplier")
    if isinstance(multiplier, bool) or not isinstance(multiplier, int) or multiplier <= 0:
        raise ValueError("characteristic-dice multiplier rule data is invalid")
    return multiplier


def validate_characteristic_generation(method_id: str, characteristics: dict[str, int]) -> list[str]:
    """Validate generated characteristic values for the chosen creation method."""
    errors = validate_character_sheet({"id": "draft", "name": "Draft", "characteristics": characteristics})
    if errors:
        return errors

    methods = characteristic_generation_methods()
    if method_id not in methods:
        return [f"unknown characteristic generation method: {method_id}"]
    method = methods[method_id]

    if method_id == "point_buy_460":
        required = set(method.get("applies_to") or REQUIRED_CHARACTERISTICS)
        total = 0
        minimum = int(method.get("minimum", 0))
        maximum = int(method.get("maximum", 100))
        increment = int(method.get("increment", 5))
        for key in REQUIRED_CHARACTERISTICS:
            value = int(characteristics[key])
            if key not in required:
                continue
            total += value
            if value < minimum or value > maximum:
                errors.append(f"{key} must be between {minimum} and {maximum}")
            if increment and value % increment != 0:
                errors.append(f"{key} must be a multiple of {increment}")
        expected_total = int(method["total_budget"])
        if total != expected_total:
            errors.append(f"total characteristic budget {total} does not match required {expected_total}")
        return errors

    if method_id == "quick_fire_array":
        expected = sorted(int(value) for value in method.get("array", []))
        actual = sorted(int(characteristics[key]) for key in REQUIRED_CHARACTERISTICS)
        if actual != expected:
            errors.append(f"quick_fire_array values must be {expected}")
        return errors

    return errors


def derive_values(
    characteristics: dict[str, int],
    luck: int | None = None,
    *,
    age_mov_penalty: int = 0,
) -> dict[str, int | str]:
    if luck is None:
        raise ValueError(
            "Luck must be rolled as 3D6x5 and supplied; it is not derived "
            "from POW (rulebook p31)"
        )
    derived_rules = coc_rules.derived_attributes_rule()
    hp_rule = derived_rules["hit_points"]
    mp_rule = derived_rules["magic_points"]
    sanity_rule = derived_rules["sanity"]
    luck_rule = derived_rules["luck_default"]
    db_build = coc_rules.damage_bonus_build(characteristics["STR"], characteristics["SIZ"])
    movement = coc_rules.movement_rate(
        characteristics["STR"],
        characteristics["DEX"],
        characteristics["SIZ"],
        age_mov_penalty=age_mov_penalty,
    )
    return {
        "HP": sum(characteristics[source] for source in hp_rule["sources"]) // int(hp_rule["divisor"]),
        "MP": characteristics[mp_rule["source"]] // int(mp_rule["divisor"]),
        "SAN": characteristics[sanity_rule["source"]],
        "Luck": luck,
        "DB": db_build["damage_bonus"],
        "Build": db_build["build"],
        "MOV": movement["mov"],
    }


def materialize_quick_fire_create_sheet(
    sheet: dict[str, Any],
    creation: dict[str, Any] | None,
) -> dict[str, Any]:
    """Materialize fixed Quick Fire numbers from a semantic assignment order.

    The Keeper chooses which characteristic receives each priority slot and
    supplies the authoritative 3D6 Luck total. The deterministic rules layer
    owns copying the configured array, multiplying Luck, and deriving stats.
    Legacy callers that submit a complete sheet remain unchanged.
    """
    materialized = json.loads(json.dumps(sheet))
    if not isinstance(creation, dict):
        return materialized
    assignment = creation.get("characteristic_assignment_order")
    luck_roll_total = creation.get("luck_roll_total")
    if creation.get("input_mode") == ERA_ADAPTIVE_INPUT_MODE:
        return materialized
    if assignment is None and luck_roll_total is None:
        return materialized
    if creation.get("input_mode") != "guided_quick_fire":
        raise ValueError(
            "deterministic Quick Fire creation requires "
            "creation.input_mode=guided_quick_fire"
        )
    if creation.get("method") != "quick_fire_array":
        raise ValueError(
            "characteristic_assignment_order/luck_roll_total require "
            "creation.method=quick_fire_array. Full Quick Fire creation = "
            "{method:'quick_fire_array', characteristic_assignment_order:"
            "[STR,CON,SIZ,DEX,APP,INT,POW,EDU in the Keeper's chosen priority "
            "order], luck_roll_total: integer 3..18}. Sheet must omit "
            "characteristics/derived; the deterministic layer computes them."
        )
    if "characteristics" in materialized or "derived" in materialized:
        raise ValueError(
            "deterministic Quick Fire materialization requires sheet to omit "
            "characteristics and derived"
        )
    if (
        not isinstance(assignment, list)
        or len(assignment) != len(REQUIRED_CHARACTERISTICS)
        or any(not isinstance(key, str) for key in assignment)
        or set(assignment) != set(REQUIRED_CHARACTERISTICS)
    ):
        raise ValueError(
            "characteristic_assignment_order must contain each of STR, CON, "
            "SIZ, DEX, APP, INT, POW, EDU exactly once"
        )
    if (
        isinstance(luck_roll_total, bool)
        or not isinstance(luck_roll_total, int)
        or not 3 <= luck_roll_total <= 18
    ):
        raise ValueError("luck_roll_total must be an integer from 3 through 18")
    method = characteristic_generation_methods().get("quick_fire_array") or {}
    values = method.get("array")
    if (
        not isinstance(values, list)
        or len(values) != len(REQUIRED_CHARACTERISTICS)
        or any(isinstance(value, bool) or not isinstance(value, int) for value in values)
    ):
        raise ValueError("quick_fire_array rule data is invalid")
    characteristics = {
        key: int(value) for key, value in zip(assignment, values, strict=True)
    }
    age_mov_penalty = 0
    age = materialized.get("age")
    if age is not None:
        if isinstance(age, bool) or not isinstance(age, int):
            raise ValueError("age must be an integer when supplied")
        age_mov_penalty = int(coc_rules.age_adjustment(age).get("mov_penalty", 0))
    materialized["characteristics"] = characteristics
    materialized["derived"] = derive_values(
        characteristics,
        luck=luck_roll_total * 5,
        age_mov_penalty=age_mov_penalty,
    )
    expected_skills, skill_errors = _guided_quick_fire_skill_reconciliation(
        materialized,
        creation,
    )
    if skill_errors:
        raise ValueError("; ".join(skill_errors))
    player_sheet = materialized.get("player_facing_sheet_zh")
    if not isinstance(player_sheet, dict):
        raise ValueError(
            "guided Quick Fire requires sheet.player_facing_sheet_zh"
        )
    materialized["player_facing_sheet_zh"] = {
        **player_sheet,
        "skills": _localized_skill_rows(expected_skills),
    }
    return materialized


def apply_age_modifiers(
    characteristics: dict[str, int],
    age: int,
    edu_improvement_rolls: list[dict[str, Any]] | None = None,
    characteristic_reductions: list[dict[str, Any]] | None = None,
) -> dict[str, int]:
    adjusted = dict(characteristics)
    edu_improvement_rolls = edu_improvement_rolls or []
    characteristic_reductions = characteristic_reductions or []
    age_adjustment = coc_rules.age_adjustment(age)
    adjusted["EDU"] = max(0, adjusted["EDU"] - int(age_adjustment.get("edu_reduction", 0)))
    adjusted["APP"] = max(0, adjusted["APP"] - int(age_adjustment.get("app_reduction", 0)))

    required_reduction_total = int(age_adjustment.get("characteristic_reduction_total", 0))
    allowed_reduction_choices = set(age_adjustment.get("characteristic_reduction_choices", []))
    applied_reduction_total = 0
    for reduction in characteristic_reductions:
        if not isinstance(reduction, dict):
            raise ValueError("characteristic_reductions entries must be objects")
        characteristic = str(reduction.get("characteristic", ""))
        amount = int(reduction.get("amount", 0))
        if characteristic not in allowed_reduction_choices:
            raise ValueError(f"characteristic_reductions contains disallowed characteristic: {characteristic}")
        if amount <= 0:
            raise ValueError("characteristic_reductions amounts must be positive")
        adjusted[characteristic] = max(0, adjusted[characteristic] - amount)
        applied_reduction_total += amount
    if applied_reduction_total != required_reduction_total:
        raise ValueError(
            f"characteristic_reductions total {applied_reduction_total} does not match required {required_reduction_total}"
        )

    age_rules = coc_rules.load_rule_table("age-adjustments")
    required_checks = int(age_adjustment.get("edu_improvement_checks", 0))
    if len(edu_improvement_rolls) != required_checks:
        raise ValueError(f"edu_improvement_rolls count {len(edu_improvement_rolls)} does not match required {required_checks}")
    edu_maximum = int(age_rules.get("edu_maximum", 99))
    improvement_die = str(age_rules.get("edu_improvement_amount", "1D10"))
    improvement_min, improvement_max = _single_die_range(improvement_die)
    for record in edu_improvement_rolls:
        if not isinstance(record, dict):
            raise ValueError("EDU improvement checks must include roll and improvement_roll fields")
        roll = int(record["roll"])
        if roll > adjusted["EDU"]:
            improvement_roll = record.get("improvement_roll")
            if improvement_roll in (None, "", [], {}):
                raise ValueError("successful EDU improvement check requires improvement_roll")
            improvement_amount = int(improvement_roll)
            if not improvement_min <= improvement_amount <= improvement_max:
                raise ValueError(f"successful EDU improvement_roll must be within {improvement_die}")
            adjusted["EDU"] = min(edu_maximum, adjusted["EDU"] + improvement_amount)
    return adjusted


def validate_character_sheet(sheet: dict) -> list[str]:
    errors: list[str] = []
    if "id" not in sheet:
        errors.append("missing id")
    if "name" not in sheet:
        errors.append("missing name")
    characteristics = sheet.get("characteristics")
    if not isinstance(characteristics, dict):
        errors.append(
            "missing characteristics (requires each of "
            "STR,CON,SIZ,DEX,APP,INT,POW,EDU as integers)"
        )
        return errors
    for key in REQUIRED_CHARACTERISTICS:
        if key not in characteristics:
            errors.append(f"missing characteristic {key}")
    return errors


def validate_character_create_sheet(
    sheet: dict[str, Any],
    creation: dict[str, Any] | None = None,
) -> list[str]:
    """Validate the complete machine sheet accepted by investigator.create."""
    errors = validate_character_sheet(sheet)
    if errors:
        return errors

    name = sheet.get("name")
    if not isinstance(name, str) or not name.strip():
        errors.append("name must be a non-empty string")

    characteristics = sheet["characteristics"]
    for key in REQUIRED_CHARACTERISTICS:
        value = characteristics.get(key)
        if isinstance(value, bool) or not isinstance(value, int):
            errors.append(f"characteristic {key} must be an integer")

    derived = sheet.get("derived")
    required_derived = ("HP", "MP", "SAN", "Luck", "DB", "Build", "MOV")
    if not isinstance(derived, dict):
        errors.append(
            "missing derived (requires HP,MP,SAN,Luck,DB,Build,MOV; "
            "or use Quick Fire creation to auto-derive them)"
        )
    else:
        for key in required_derived:
            if key not in derived:
                errors.append(f"missing derived {key}")
        for key in ("HP", "MP", "SAN", "Luck", "Build", "MOV"):
            value = derived.get(key)
            if key in derived and (
                isinstance(value, bool) or not isinstance(value, int)
            ):
                errors.append(f"derived {key} must be an integer")
        db = derived.get("DB")
        if "DB" in derived and (
            isinstance(db, bool)
            or not isinstance(db, (int, str))
            or (isinstance(db, str) and not db.strip())
        ):
            errors.append("derived DB must be a non-empty string or integer")

    skills = sheet.get("skills")
    if not isinstance(skills, dict):
        errors.append(
            "missing skills (a dict of canonical English skill name -> "
            "non-negative integer; must include 'Credit Rating'; put "
            "localized labels in player_facing_sheet_zh, not as skill keys)"
        )
    else:
        if "Credit Rating" not in skills:
            errors.append("missing canonical skill Credit Rating")
        for key, value in skills.items():
            if not isinstance(key, str) or not key.strip():
                errors.append("skill keys must be non-empty strings")
                continue
            if key != key.strip() or not key.isascii():
                errors.append(
                    f"skill key {key!r} must use canonical English; put localized labels in player_facing_sheet_zh"
                )
            if isinstance(value, bool) or not isinstance(value, int) or value < 0:
                errors.append(f"skill {key!r} must be a non-negative integer")

    if errors:
        return errors

    if not isinstance(creation, dict):
        errors.append(
            "creation is required and must declare input_mode as "
            "guided_quick_fire, kp_guided_era_adaptive, or import_complete_sheet"
        )
        return errors
    input_mode = creation.get("input_mode")
    if input_mode == "import_complete_sheet":
        return errors
    if input_mode == "guided_quick_fire":
        expected_skills, reconciliation_errors = (
            _guided_quick_fire_skill_reconciliation(sheet, creation)
        )
        errors.extend(reconciliation_errors)

        player_sheet = sheet.get("player_facing_sheet_zh")
        if not isinstance(player_sheet, dict):
            errors.append(
                "guided Quick Fire requires sheet.player_facing_sheet_zh"
            )
        else:
            display_name = player_sheet.get("display_name")
            localized_skills = player_sheet.get("skills")
            if not isinstance(display_name, str) or not display_name.strip():
                errors.append(
                    "guided Quick Fire player_facing_sheet_zh.display_name must "
                    "be non-empty"
                )
            if not isinstance(localized_skills, list):
                errors.append(
                    "guided Quick Fire player_facing_sheet_zh.skills must be a list"
                )
            elif localized_skills != _localized_skill_rows(expected_skills):
                errors.append(
                    "guided Quick Fire localized skills must be the canonical "
                    "zh-Hans catalog projection of the reconciled machine skills"
                )
    elif input_mode == ERA_ADAPTIVE_INPUT_MODE:
        errors.extend(_kp_guided_era_adaptive_errors(sheet, creation))
    else:
        errors.append(
            "creation.input_mode must be guided_quick_fire, "
            "kp_guided_era_adaptive, or import_complete_sheet"
        )
        return errors

    method_id = creation.get("method")
    if not isinstance(method_id, str) or not method_id.strip():
        errors.append("creation method must be a non-empty string")
        return errors
    errors.extend(validate_characteristic_generation(method_id, characteristics))

    luck = derived["Luck"]
    age_mov_penalty = 0
    age = sheet.get("age")
    if age is not None:
        if isinstance(age, bool) or not isinstance(age, int):
            errors.append("age must be an integer when supplied")
            return errors
        try:
            age_mov_penalty = int(coc_rules.age_adjustment(age).get("mov_penalty", 0))
        except ValueError as exc:
            errors.append(str(exc))
            return errors

    expected = derive_values(
        characteristics,
        luck=luck,
        age_mov_penalty=age_mov_penalty,
    )
    for key in ("HP", "MP", "SAN", "Luck", "DB", "Build", "MOV"):
        if derived.get(key) != expected[key]:
            errors.append(
                f"derived {key} {derived.get(key)!r} does not match rules value {expected[key]!r}"
            )
    return errors


_COMPACT_SKILL_FOLD_PATTERN = re.compile(r"[\s_]+")


def _compact_skill_fold(name: str) -> str:
    return _COMPACT_SKILL_FOLD_PATTERN.sub("", str(name)).casefold()


def _skill_catalog() -> dict[str, dict]:
    """Cached rulebook skill catalog (canonical name -> spec incl. aliases)."""
    try:
        table = coc_rules.skills_table()
    except (OSError, KeyError, json.JSONDecodeError):
        return {}
    return {
        str(canonical): spec
        for canonical, spec in table.items()
        if isinstance(canonical, str) and isinstance(spec, dict)
    }


def _guided_skill_policy() -> dict[str, Any]:
    try:
        table = coc_rules.load_rule_table("skills")
    except (OSError, KeyError, json.JSONDecodeError):
        return {}
    if not isinstance(table, dict):
        return {}
    return {
        "guided_creation_policy": table.get("guided_creation_policy"),
        "standard_sheet": table.get("standard_sheet"),
    }


def _guided_skill_base(
    skill_id: str,
    spec: dict[str, Any],
    characteristics: dict[str, Any],
) -> int:
    base = spec.get("base_chance")
    if isinstance(base, int) and not isinstance(base, bool):
        return base
    if base == "half_DEX":
        return int(characteristics["DEX"]) // 2
    if base == "EDU":
        return int(characteristics["EDU"])
    raise ValueError(
        f"skill catalog base chance for {skill_id!r} is unsupported: {base!r}"
    )


def _guided_quick_fire_skill_reconciliation(
    sheet: dict[str, Any],
    creation: dict[str, Any],
) -> tuple[dict[str, int], list[str]]:
    """Reconcile guided Quick-Fire skills against the canonical COC7 catalog.

    Occupation eligibility remains semantic Keeper work. This function owns
    only deterministic catalog completeness, base-value resolution, allocation
    arithmetic, and final-value equality.
    """
    errors: list[str] = []
    catalog = _skill_catalog()
    policy = _guided_skill_policy()
    characteristics = sheet.get("characteristics")
    submitted = sheet.get("skills")
    if not catalog:
        return {}, ["canonical COC7 skill catalog is unavailable"]
    if not isinstance(characteristics, dict):
        return {}, ["guided Quick Fire skill reconciliation requires characteristics"]
    if not isinstance(submitted, dict):
        return {}, ["guided Quick Fire skill reconciliation requires skills"]

    raw_era = sheet.get("era")
    era = "1920s" if raw_era is None else (
        raw_era.strip().casefold() if isinstance(raw_era, str) else ""
    )
    supported_eras = guided_quick_fire_supported_eras()
    if era not in supported_eras:
        return {}, [
            f"guided Quick Fire era {raw_era!r} is unsupported; "
            "the package currently owns only "
            + ", ".join(f"standard_sheet.{value}" for value in supported_eras)
        ]
    available = {
        skill_id: spec
        for skill_id, spec in catalog.items()
        if spec.get("modern_only") is not True
    }
    creation_policy = policy.get("guided_creation_policy")
    starting_cap = (
        creation_policy.get("starting_skill_cap")
        if isinstance(creation_policy, dict)
        else None
    )
    sheet_policy = policy.get("standard_sheet")
    sheet_1920s = (
        sheet_policy.get("1920s")
        if isinstance(sheet_policy, dict)
        else None
    )
    default_ids = (
        sheet_1920s.get("default_skill_ids")
        if isinstance(sheet_1920s, dict)
        else None
    )
    if (
        isinstance(starting_cap, bool)
        or not isinstance(starting_cap, int)
        or starting_cap <= 0
    ):
        return {}, ["guided creation starting-skill cap policy is invalid"]
    if (
        not isinstance(default_ids, list)
        or not default_ids
        or any(not isinstance(skill_id, str) for skill_id in default_ids)
        or len(default_ids) != len(set(default_ids))
    ):
        return {}, ["guided creation standard-sheet policy is invalid"]
    required = set(default_ids)
    missing_policy_ids = sorted(required - set(available))
    if missing_policy_ids:
        return {}, [
            "guided creation standard-sheet policy contains unavailable "
            f"skills: {missing_policy_ids}"
        ]
    budget = creation.get("skill_budget")
    if not isinstance(budget, dict) or set(budget) != {
        "occupation_points", "personal_interest_points",
    }:
        return {}, [
            "guided Quick Fire requires skill_budget with exactly "
            "occupation_points and personal_interest_points"
        ]

    allocations_by_account: dict[str, dict[str, int]] = {}
    for account_name in ("occupation_points", "personal_interest_points"):
        account = budget.get(account_name)
        if not isinstance(account, dict) or set(account) != {
            "budget", "spent", "allocations",
        }:
            errors.append(
                f"skill_budget.{account_name} must contain exactly "
                "budget, spent, and allocations"
            )
            continue
        declared_budget = account.get("budget")
        declared_spent = account.get("spent")
        allocations = account.get("allocations")
        if (
            isinstance(declared_budget, bool)
            or not isinstance(declared_budget, int)
            or declared_budget <= 0
            or isinstance(declared_spent, bool)
            or not isinstance(declared_spent, int)
            or declared_spent <= 0
            or not isinstance(allocations, dict)
        ):
            errors.append(
                f"skill_budget.{account_name} requires positive integer "
                "budget/spent and an allocations object"
            )
            continue
        normalized: dict[str, int] = {}
        for skill_id, delta in allocations.items():
            if skill_id not in catalog:
                errors.append(
                    f"skill_budget.{account_name} allocation uses unknown "
                    f"canonical skill {skill_id!r}"
                )
                continue
            if skill_id not in available:
                errors.append(
                    f"skill_budget.{account_name} allocation uses "
                    f"era-inappropriate skill {skill_id!r}"
                )
                continue
            if isinstance(delta, bool) or not isinstance(delta, int) or delta < 0:
                errors.append(
                    f"skill_budget.{account_name} allocation for "
                    f"{skill_id!r} must be a non-negative integer"
                )
                continue
            normalized[skill_id] = delta
        derived_spent = sum(normalized.values())
        if (
            account_name == "personal_interest_points"
            and isinstance(characteristics.get("INT"), int)
            and not isinstance(characteristics.get("INT"), bool)
        ):
            intelligence = int(characteristics["INT"])
            expected = intelligence * 2
            if derived_spent == expected:
                account["budget"] = expected
                account["spent"] = expected
                declared_budget = expected
                declared_spent = expected
            elif declared_budget != expected:
                errors.append(
                    "skill_budget.personal_interest_points budget must equal "
                    f"INT*2 (INT={intelligence}, expected={expected}, "
                    f"got={declared_budget})"
                )
        if derived_spent != declared_spent or declared_spent != declared_budget:
            errors.append(
                f"skill_budget.{account_name} derived allocation total "
                f"{derived_spent} must equal spent and budget "
                f"{declared_spent}/{declared_budget}"
            )
        allocations_by_account[account_name] = normalized

    if errors:
        return {}, errors
    selected = set().union(*(
        set(allocations) for allocations in allocations_by_account.values()
    ))
    expected_ids = required | selected
    expected: dict[str, int] = {}
    for skill_id in catalog:
        if skill_id not in expected_ids:
            continue
        try:
            base = _guided_skill_base(
                skill_id,
                catalog[skill_id],
                characteristics,
            )
        except (KeyError, TypeError, ValueError) as exc:
            errors.append(str(exc))
            continue
        expected[skill_id] = (
            base
            + allocations_by_account["occupation_points"].get(skill_id, 0)
            + allocations_by_account["personal_interest_points"].get(skill_id, 0)
        )
        allocation_delta = (
            allocations_by_account["occupation_points"].get(skill_id, 0)
            + allocations_by_account["personal_interest_points"].get(skill_id, 0)
        )
        if expected[skill_id] > starting_cap:
            characteristic_derived_base = (
                catalog[skill_id].get("base_chance") in {"half_DEX", "EDU"}
            )
            if (
                characteristic_derived_base
                and base > starting_cap
                and allocation_delta == 0
            ):
                continue
            if (
                characteristic_derived_base
                and base > starting_cap
                and allocation_delta > 0
            ):
                errors.append(
                    f"guided Quick Fire skill {skill_id!r} has authoritative "
                    f"characteristic-derived base {base} above the package "
                    f"starting-skill cap {starting_cap}; allocation delta "
                    f"{allocation_delta} is not permitted"
                )
            else:
                errors.append(
                    f"guided Quick Fire skill {skill_id!r} final value "
                    f"{expected[skill_id]} exceeds the package starting-skill "
                    f"cap {starting_cap}"
                )
    if set(submitted) != set(expected):
        missing = sorted(set(expected) - set(submitted))
        extra = sorted(set(submitted) - set(expected))
        errors.append(
            "guided Quick Fire skills must contain the complete "
            f"era-appropriate standard catalog (missing={missing}, extra={extra})"
        )
    else:
        for skill_id, expected_value in expected.items():
            if submitted.get(skill_id) != expected_value:
                errors.append(
                    f"guided Quick Fire skill {skill_id!r} value "
                    f"{submitted.get(skill_id)!r} must equal catalog base plus "
                    f"allocation deltas ({expected_value})"
                )
    return expected, errors


def guided_quick_fire_supported_eras() -> tuple[str, ...]:
    """Return eras with an authoritative package-owned guided sheet policy."""
    policy = _guided_skill_policy().get("standard_sheet")
    if not isinstance(policy, dict):
        return ()
    return tuple(sorted(
        str(era).strip().casefold()
        for era, spec in policy.items()
        if str(era).strip() and isinstance(spec, dict)
    ))


def _occupation_formula_source_literals() -> tuple[str, ...]:
    """Return the exact formula literals currently authored in occupations.json."""
    try:
        table = coc_rules.load_rule_table("occupations")
    except (OSError, KeyError, json.JSONDecodeError):
        return ()
    occupations = table.get("occupations") if isinstance(table, dict) else None
    if not isinstance(occupations, dict):
        return ()
    return tuple(sorted({
        formula
        for spec in occupations.values()
        if isinstance(spec, dict)
        and isinstance((formula := spec.get("skill_point_formula")), str)
    }))


def _occupation_skill_point_formula_options() -> dict[str, tuple[tuple[str, int], ...]]:
    """Return allowed selected 7e formula variants from pinned rule literals."""
    if set(_occupation_formula_source_literals()) != set(_OCCUPATION_FORMULA_VARIANTS):
        return {}
    return {
        "+".join(f"{characteristic}*{multiplier}" for characteristic, multiplier in terms): terms
        for variants in _OCCUPATION_FORMULA_VARIANTS.values()
        for terms in variants
    }


def _normalized_skill_point_formula(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip().upper().replace("×", "*").replace("＋", "+").replace(" ", "")


def _valid_kp_guided_roll_reference(value: Any) -> bool:
    return (
        isinstance(value, dict)
        and set(value) == {"campaign_id", "decision_id", "roll_id"}
        and all(
            isinstance(value.get(key), str) and value[key].strip()
            for key in ("campaign_id", "decision_id", "roll_id")
        )
    )


def _kp_guided_identity_errors(sheet: dict[str, Any], creation: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if not isinstance(sheet.get("era"), str) or not sheet["era"].strip():
        errors.append("KP-guided era-adaptive sheet requires a non-empty era")
    for field in ("era_adaptive", "kp_guided"):
        if sheet.get(field) is not True:
            errors.append(f"KP-guided era-adaptive sheet requires {field}=true")
        if creation.get(field) is not True:
            errors.append(f"KP-guided era-adaptive creation requires {field}=true")
    if creation.get("era") != sheet.get("era"):
        errors.append("KP-guided era-adaptive creation.era must equal sheet.era")
    return errors


def _kp_guided_occupation_errors(
    sheet: dict[str, Any],
    creation: dict[str, Any],
) -> tuple[list[str], tuple[tuple[str, int], ...] | None]:
    errors: list[str] = []
    sheet_occupation = sheet.get("occupation")
    creation_occupation = creation.get("occupation")
    if not isinstance(sheet_occupation, dict):
        errors.append("KP-guided era-adaptive sheet requires an occupation object")
    if not isinstance(creation_occupation, dict):
        errors.append("KP-guided era-adaptive creation requires an occupation object")
        return errors, None
    for field in ("name", "reason", "formula_reason"):
        if not isinstance(creation_occupation.get(field), str) or not creation_occupation[field].strip():
            errors.append(f"KP-guided era-adaptive occupation.{field} must be non-empty")
    if creation_occupation.get("era_adaptive") is not True:
        errors.append("KP-guided era-adaptive occupation requires era_adaptive=true")
    if isinstance(sheet_occupation, dict):
        for field in ("name", "reason"):
            if not isinstance(sheet_occupation.get(field), str) or not sheet_occupation[field].strip():
                errors.append(f"KP-guided era-adaptive sheet occupation.{field} must be non-empty")
            elif sheet_occupation[field] != creation_occupation.get(field):
                errors.append(f"KP-guided era-adaptive sheet and creation occupation.{field} must agree")
        if sheet_occupation.get("era_adaptive") is not True:
            errors.append("KP-guided era-adaptive sheet occupation requires era_adaptive=true")
    formula = _normalized_skill_point_formula(creation_occupation.get("skill_point_formula"))
    terms = _occupation_skill_point_formula_options().get(formula)
    if terms is None:
        errors.append(
            "KP-guided era-adaptive occupation.skill_point_formula must select "
            "a pinned 7e formula from occupations.json"
        )
    return errors, terms


def _kp_guided_skill_sources(
    sheet: dict[str, Any],
) -> tuple[dict[str, str], dict[str, dict[str, Any]], list[str]]:
    errors: list[str] = []
    catalog = _skill_catalog()
    skills = sheet.get("skills")
    raw_provenance = sheet.get("skill_provenance")
    if not catalog:
        return {}, {}, ["canonical COC7 skill catalog is unavailable"]
    if not isinstance(skills, dict):
        return {}, {}, errors
    if not isinstance(raw_provenance, dict):
        return {}, {}, ["KP-guided era-adaptive sheet requires skill_provenance"]
    provenance = {
        key: value for key, value in raw_provenance.items() if isinstance(key, str)
    }
    try:
        assert_unique_canonical_skills(sheet)
    except ValueError as exc:
        errors.append(str(exc))
    sources: dict[str, str] = {}
    for skill_id in skills:
        entry = provenance.get(skill_id)
        if entry is None:
            if skill_id not in catalog:
                errors.append(f"KP-guided custom skill {skill_id!r} requires skill_provenance")
            else:
                sources[skill_id] = skill_id
            continue
        if not isinstance(entry, dict):
            errors.append(f"skill_provenance.{skill_id!r} must be an object")
            continue
        original_name = entry.get("original_name")
        if not isinstance(original_name, str) or original_name not in catalog:
            errors.append(f"skill_provenance.{skill_id!r}.original_name must be a canonical catalog skill")
            continue
        if not isinstance(entry.get("reskinned_name"), str) or not entry["reskinned_name"].strip():
            errors.append(f"skill_provenance.{skill_id!r}.reskinned_name must be non-empty")
        if entry.get("era_adaptive") is not True:
            errors.append(f"skill_provenance.{skill_id!r}.era_adaptive must be true")
        if skill_id in catalog and original_name != skill_id:
            errors.append(f"skill_provenance.{skill_id!r}.original_name must equal its canonical skill key")
        if skill_id not in catalog and entry.get("custom") is not True:
            errors.append(f"KP-guided custom skill {skill_id!r} requires skill_provenance.custom=true")
        sources[skill_id] = original_name
    for skill_id in provenance:
        if skill_id not in skills:
            errors.append(f"skill_provenance contains unselected skill {skill_id!r}")
    return sources, provenance, errors


def _kp_guided_skill_budget_errors(
    sheet: dict[str, Any],
    creation: dict[str, Any],
    sources: dict[str, str],
    formula_terms: tuple[tuple[str, int], ...] | None,
) -> tuple[dict[str, dict[str, int]], list[str]]:
    errors: list[str] = []
    budget = creation.get("skill_budget")
    if not isinstance(budget, dict) or set(budget) != {
        "occupation_points", "personal_interest_points",
    }:
        return {}, [
            "KP-guided era-adaptive creation requires skill_budget with exactly "
            "occupation_points and personal_interest_points"
        ]
    characteristics = sheet.get("characteristics")
    allocations_by_account: dict[str, dict[str, int]] = {}
    expected_budgets = {
        "occupation_points": (
            sum(int(characteristics[characteristic]) * multiplier for characteristic, multiplier in formula_terms)
            if isinstance(characteristics, dict) and formula_terms else None
        ),
        "personal_interest_points": (
            int(characteristics["INT"]) * 2 if isinstance(characteristics, dict) else None
        ),
    }
    for account_name in ("occupation_points", "personal_interest_points"):
        account = budget.get(account_name)
        if not isinstance(account, dict) or set(account) != {"budget", "spent", "allocations"}:
            errors.append(f"skill_budget.{account_name} must contain exactly budget, spent, and allocations")
            continue
        declared_budget = account.get("budget")
        declared_spent = account.get("spent")
        allocations = account.get("allocations")
        if (
            isinstance(declared_budget, bool) or not isinstance(declared_budget, int) or declared_budget <= 0
            or isinstance(declared_spent, bool) or not isinstance(declared_spent, int) or declared_spent <= 0
            or not isinstance(allocations, dict)
        ):
            errors.append(f"skill_budget.{account_name} requires positive integer budget/spent and an allocations object")
            continue
        normalized: dict[str, int] = {}
        for skill_id, delta in allocations.items():
            if skill_id not in sources:
                errors.append(f"skill_budget.{account_name} allocation uses unselected skill {skill_id!r}")
            elif isinstance(delta, bool) or not isinstance(delta, int) or delta < 0:
                errors.append(f"skill_budget.{account_name} allocation for {skill_id!r} must be a non-negative integer")
            else:
                normalized[skill_id] = delta
        derived_spent = sum(normalized.values())
        if derived_spent != declared_spent or declared_spent != declared_budget:
            errors.append(
                f"skill_budget.{account_name} derived allocation total {derived_spent} must equal spent and budget {declared_spent}/{declared_budget}"
            )
        expected_budget = expected_budgets[account_name]
        if expected_budget is not None and declared_budget != expected_budget:
            errors.append(f"skill_budget.{account_name} budget must equal its rules value {expected_budget}")
        allocations_by_account[account_name] = normalized
    return allocations_by_account, errors


def _kp_guided_skill_value_errors(
    sheet: dict[str, Any],
    sources: dict[str, str],
    allocations: dict[str, dict[str, int]],
) -> list[str]:
    if set(allocations) != {"occupation_points", "personal_interest_points"}:
        return []
    errors: list[str] = []
    catalog = _skill_catalog()
    skills = sheet["skills"]
    policy = _guided_skill_policy().get("guided_creation_policy")
    starting_cap = policy.get("starting_skill_cap") if isinstance(policy, dict) else None
    if isinstance(starting_cap, bool) or not isinstance(starting_cap, int) or starting_cap <= 0:
        return ["guided creation starting-skill cap policy is invalid"]
    for skill_id, source_skill_id in sources.items():
        try:
            base = _guided_skill_base(source_skill_id, catalog[source_skill_id], sheet["characteristics"])
        except (KeyError, TypeError, ValueError) as exc:
            errors.append(str(exc))
            continue
        delta = allocations["occupation_points"].get(skill_id, 0) + allocations["personal_interest_points"].get(skill_id, 0)
        expected = base + delta
        if skills.get(skill_id) != expected:
            errors.append(
                f"KP-guided era-adaptive skill {skill_id!r} value {skills.get(skill_id)!r} must equal catalog base plus allocation deltas ({expected})"
            )
        if expected <= starting_cap:
            continue
        derived_base = catalog[source_skill_id].get("base_chance") in {"half_DEX", "EDU"}
        if derived_base and base > starting_cap and delta == 0:
            continue
        if derived_base and base > starting_cap:
            errors.append(
                f"KP-guided era-adaptive skill {skill_id!r} has authoritative characteristic-derived base {base} above the package starting-skill cap {starting_cap}; allocation delta {delta} is not permitted"
            )
        else:
            errors.append(
                f"KP-guided era-adaptive skill {skill_id!r} final value {expected} exceeds the package starting-skill cap {starting_cap}"
            )
    return errors


def _kp_guided_localized_skill_errors(
    sheet: dict[str, Any],
    sources: dict[str, str],
    provenance: dict[str, dict[str, Any]],
) -> list[str]:
    errors: list[str] = []
    player_sheet = sheet.get("player_facing_sheet_zh")
    if not isinstance(player_sheet, dict):
        return ["KP-guided era-adaptive sheet requires player_facing_sheet_zh"]
    if not isinstance(player_sheet.get("display_name"), str) or not player_sheet["display_name"].strip():
        errors.append("KP-guided era-adaptive player_facing_sheet_zh.display_name must be non-empty")
    rows = player_sheet.get("skills")
    if not isinstance(rows, list):
        return [*errors, "KP-guided era-adaptive player_facing_sheet_zh.skills must be a list"]
    skills = sheet["skills"]
    rendered: dict[str, dict[str, Any]] = {}
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("key"), str) or row["key"] not in skills:
            errors.append("KP-guided era-adaptive localized skill row has an unknown key")
        elif row["key"] in rendered:
            errors.append(f"KP-guided era-adaptive localized skills duplicate {row['key']!r}")
        else:
            rendered[row["key"]] = row
    if set(rendered) != set(skills):
        errors.append("KP-guided era-adaptive localized skills must contain every selected machine skill exactly once")
    catalog = _skill_catalog()
    for skill_id, row in rendered.items():
        entry = provenance.get(skill_id)
        if entry is not None:
            expected_label = entry.get("reskinned_name")
        else:
            labels = catalog[sources[skill_id]].get("localized_labels")
            expected_label = labels.get("zh-Hans") if isinstance(labels, dict) else None
        if row.get("value") != skills[skill_id]:
            errors.append(f"KP-guided era-adaptive localized skill {skill_id!r} value must match machine skill")
        if not isinstance(expected_label, str) or row.get("label") != expected_label:
            errors.append(f"KP-guided era-adaptive localized skill {skill_id!r} label must match its zh-Hans provenance")
    return errors


def _kp_guided_roll_provenance_errors(sheet: dict[str, Any], creation: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    method = characteristic_generation_methods().get(creation.get("method"))
    if isinstance(method, dict) and method.get("requires_rolls") is True:
        references = creation.get("characteristic_roll_receipts")
        required = {*REQUIRED_CHARACTERISTICS, "Luck"}
        if not isinstance(references, dict) or set(references) != required:
            errors.append("KP-guided rolled characteristics require characteristic_roll_receipts for every characteristic and Luck")
        elif any(not _valid_kp_guided_roll_reference(references[key]) for key in required):
            errors.append("KP-guided characteristic_roll_receipts entries require campaign_id, decision_id, and roll_id")
    luck_roll_total = creation.get("luck_roll_total")
    if isinstance(luck_roll_total, bool) or not isinstance(luck_roll_total, int) or not 3 <= luck_roll_total <= 18:
        errors.append("KP-guided era-adaptive luck_roll_total must be an integer from 3 through 18")
    else:
        try:
            multiplier = characteristic_generation_multiplier()
        except ValueError as exc:
            errors.append(str(exc))
        else:
            derived = sheet.get("derived")
            if isinstance(derived, dict) and derived.get("Luck") != luck_roll_total * multiplier:
                errors.append("KP-guided era-adaptive derived Luck must equal luck_roll_total times the rule multiplier")
    if not _valid_kp_guided_roll_reference(creation.get("luck_roll_receipt")):
        errors.append("KP-guided era-adaptive luck_roll_receipt requires campaign_id, decision_id, and roll_id")
    return errors


def _kp_guided_era_adaptive_errors(
    sheet: dict[str, Any],
    creation: dict[str, Any],
) -> list[str]:
    """Validate the deterministic data surface of KP-led era adaptation."""
    errors = _kp_guided_identity_errors(sheet, creation)
    occupation_errors, formula_terms = _kp_guided_occupation_errors(sheet, creation)
    errors.extend(occupation_errors)
    sources, provenance, source_errors = _kp_guided_skill_sources(sheet)
    errors.extend(source_errors)
    allocations, budget_errors = _kp_guided_skill_budget_errors(
        sheet, creation, sources, formula_terms,
    )
    errors.extend(budget_errors)
    if isinstance(sheet.get("skills"), dict) and sources:
        errors.extend(_kp_guided_skill_value_errors(sheet, sources, allocations))
        errors.extend(_kp_guided_localized_skill_errors(sheet, sources, provenance))
    errors.extend(_kp_guided_roll_provenance_errors(sheet, creation))
    return errors


def _localized_skill_rows(skills: dict[str, int]) -> list[dict[str, Any]]:
    catalog = _skill_catalog()
    return [
        {
            "key": skill_id,
            "label": str(
                (catalog[skill_id].get("localized_labels") or {}).get(
                    "zh-Hans",
                    skill_id,
                )
            ),
            "value": value,
            "half": value // 2,
            "fifth": value // 5,
        }
        for skill_id, value in skills.items()
    ]


def _canonical_skill_identity(key: str, catalog: dict[str, dict]) -> str:
    """Fold one sheet skill key to its canonical skill identity."""
    compact = _compact_skill_fold(key)
    for canonical in catalog:
        if _compact_skill_fold(canonical) == compact:
            return canonical
    folded = str(key).casefold()
    for canonical, spec in catalog.items():
        labels = spec.get("localized_labels")
        alias = labels.get("zh-Hans") if isinstance(labels, dict) else None
        if not isinstance(alias, str) or not alias.strip():
            continue
        alias = alias.strip()
        if alias.casefold() == folded or _compact_skill_fold(alias) == compact:
            return canonical
    return str(key)


def assert_unique_canonical_skills(sheet: dict) -> None:
    """Reject a sheet whose skill keys collide after canonical folding.

    Two keys that fold to the same canonical skill (e.g. 'Psychology' plus its
    zh-Hans alias '心理学', or 'Fast Talk' plus 'FastTalk') are one skill with
    two competing values; selectors and development settlement require a
    single owner per canonical skill.  Custom on-sheet skills without a
    catalog match keep their own identity.
    """
    skills = sheet.get("skills") if isinstance(sheet, dict) else None
    if not isinstance(skills, dict):
        return
    catalog = _skill_catalog()
    seen: dict[str, tuple[str, str]] = {}
    for key in skills:
        if not isinstance(key, str) or not key.strip():
            continue
        canonical = _canonical_skill_identity(key, catalog)
        folded = _compact_skill_fold(canonical)
        if folded in seen:
            prior_key, prior_canonical = seen[folded]
            raise ValueError(
                "character sheet skills collide after canonical folding: "
                f"{prior_key!r} and {key!r} both resolve to {prior_canonical!r}"
            )
        seen[folded] = (key, canonical)


class ChargenRunError(ValueError):
    def __init__(
        self,
        stage: str,
        message: str,
        *,
        expected: Any = None,
    ) -> None:
        super().__init__(message)
        self.stage = stage
        self.expected = expected


_INTERPERSONAL_SKILLS = ("Charm", "Fast Talk", "Intimidate", "Persuade")
_DEFAULT_INTEREST_SKILLS = ("Listen", "Spot Hidden", "Stealth", "First Aid")
_STARTING_SKILL_CAP = 75


def lookup_occupation_template(occupation_name: str) -> tuple[str, dict[str, Any]] | None:
    """Return occupations.json entry for a name, or None."""
    try:
        table = coc_rules.load_rule_table("occupations")
    except (OSError, KeyError, json.JSONDecodeError):
        return None
    occupations = table.get("occupations") if isinstance(table, dict) else None
    if not isinstance(occupations, dict):
        return None
    wanted = str(occupation_name or "").strip()
    if not wanted:
        return None
    if wanted in occupations and isinstance(occupations[wanted], dict):
        return wanted, occupations[wanted]
    folded = _compact_skill_fold(wanted)
    for key, spec in occupations.items():
        if not isinstance(spec, dict):
            continue
        if str(key).casefold() == wanted.casefold() or _compact_skill_fold(str(key)) == folded:
            return str(key), spec
    return None


def resolve_catalog_skill_name(name: str, catalog: dict[str, dict] | None = None) -> str | None:
    catalog = catalog if catalog is not None else _skill_catalog()
    raw = str(name or "").strip()
    if not raw:
        return None
    identity = _canonical_skill_identity(raw, catalog)
    if identity in catalog:
        return identity
    aliases = {
        "own language": "Language (Own)",
        "language (own)": "Language (Own)",
        "firearms": "Firearms (Handgun)",
        "art/craft (photography)": "Art and Craft (Photography)",
        "photography": "Art and Craft (Photography)",
        "art (literature)": "Art and Craft (Writing)",
    }
    mapped = aliases.get(_compact_skill_fold(raw))
    if mapped and mapped in catalog:
        return mapped
    return None


def occupation_point_budget(
    formula: str,
    characteristics: dict[str, int],
) -> int:
    normalized = _normalized_skill_point_formula(formula) or "EDU*4"
    variants = _OCCUPATION_FORMULA_VARIANTS.get(formula) or _OCCUPATION_FORMULA_VARIANTS.get(normalized)
    if variants is None:
        if normalized == "EDU*4":
            terms = (("EDU", 4),)
        else:
            terms = (("EDU", 4),)
    else:
        terms = variants[0]
    return sum(int(characteristics[key]) * int(mult) for key, mult in terms)


def _is_wildcard_occupation_skill(token: str) -> bool:
    folded = token.casefold()
    return folded.startswith("any ") or "other skill" in folded or "personal special" in folded


def _is_interpersonal_choice(token: str) -> bool:
    folded = token.casefold()
    return "interpersonal" in folded and any(
        name.casefold() in folded for name in _INTERPERSONAL_SKILLS
    )


def resolve_occupation_skill_list(
    occupation_spec: dict[str, Any] | None,
    occupation_skill_names: list[str] | None,
) -> list[str]:
    catalog = _skill_catalog()
    resolved: list[str] = []
    seen: set[str] = set()

    def _add(name: str | None) -> None:
        if not name or name not in catalog or name in seen:
            return
        seen.add(name)
        resolved.append(name)

    extras = [str(item).strip() for item in (occupation_skill_names or []) if str(item).strip()]
    extra_iter = iter(extras)
    tokens: list[str] = []
    if isinstance(occupation_spec, dict):
        raw_skills = occupation_spec.get("occupational_skills")
        if isinstance(raw_skills, list):
            tokens = [str(item) for item in raw_skills if isinstance(item, str)]
    for token in tokens:
        if _is_wildcard_occupation_skill(token):
            continue
        if _is_interpersonal_choice(token):
            count = 2 if token.casefold().startswith("two ") else 1
            added = 0
            for candidate in _INTERPERSONAL_SKILLS:
                if added >= count:
                    break
                if candidate not in seen:
                    _add(candidate)
                    added += 1
            continue
        _add(resolve_catalog_skill_name(token, catalog))
    unresolved: list[str] = []
    for extra in extra_iter:
        catalog_name = resolve_catalog_skill_name(extra, catalog)
        if catalog_name is None:
            unresolved.append(extra)
        else:
            _add(catalog_name)
    if unresolved:
        raise ChargenRunError(
            "occupation",
            "unrecognized occupation_skill_names: "
            + ", ".join(repr(name) for name in unresolved),
            expected={"unrecognized": unresolved},
        )
    _add("Credit Rating")
    return resolved


def allocate_points_in_order(
    skill_ids: list[str],
    budget: int,
    bases: dict[str, int],
    *,
    cap: int = _STARTING_SKILL_CAP,
    floor: dict[str, int] | None = None,
) -> dict[str, int]:
    allocations = {skill_id: 0 for skill_id in skill_ids}
    remaining = int(budget)
    floors = floor or {}
    for skill_id, need in floors.items():
        if skill_id not in allocations:
            continue
        room = max(0, cap - bases.get(skill_id, 0))
        take = min(max(0, int(need)), room, remaining)
        allocations[skill_id] += take
        remaining -= take
    while remaining > 0:
        progressed = False
        for skill_id in skill_ids:
            if remaining <= 0:
                break
            current = bases.get(skill_id, 0) + allocations[skill_id]
            if current >= cap:
                continue
            allocations[skill_id] += 1
            remaining -= 1
            progressed = True
        if not progressed:
            break
    return {key: value for key, value in allocations.items() if value > 0}


def build_quick_fire_chargen_payload(
    *,
    investigator_id: str,
    name: str,
    occupation_name: str,
    assignment_priority: list[str] | None = None,
    occupation_skill_names: list[str] | None = None,
    interest_skill_names: list[str] | None = None,
    occupation_allocations: dict[str, int] | None = None,
    interest_allocations: dict[str, int] | None = None,
    age: int = 27,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    """Build compact sheet + creation for investigator.create. No I/O."""
    catalog = _skill_catalog()
    if not catalog:
        raise ChargenRunError("occupation", "canonical skill catalog is unavailable")
    order = list(assignment_priority or REQUIRED_CHARACTERISTICS)
    if (
        len(order) != len(REQUIRED_CHARACTERISTICS)
        or set(order) != set(REQUIRED_CHARACTERISTICS)
    ):
        unrecognized = [
            str(item)
            for item in order
            if str(item) not in REQUIRED_CHARACTERISTICS
        ]
        extra = ""
        if unrecognized:
            extra = "; unrecognized: " + ", ".join(
                repr(name) for name in unrecognized
            )
        raise ChargenRunError(
            "assignment",
            "assignment_priority must list STR, CON, SIZ, DEX, APP, INT, POW, EDU once"
            + extra,
            expected={"unrecognized": unrecognized} if unrecognized else None,
        )
    method = characteristic_generation_methods().get("quick_fire_array") or {}
    values = method.get("array")
    if not isinstance(values, list) or len(values) != 8:
        raise ChargenRunError("assignment", "quick_fire_array rule data is invalid")
    characteristics = {
        key: int(value) for key, value in zip(order, values, strict=True)
    }
    found = lookup_occupation_template(occupation_name)
    if found is None and not occupation_skill_names:
        raise ChargenRunError(
            "occupation",
            f"unknown occupation {occupation_name!r} and no occupation_skill_names",
        )
    occ_key, occ_spec = found if found is not None else (occupation_name, None)
    formula = "EDU*4"
    cr_range = (0, 99)
    if isinstance(occ_spec, dict):
        raw_formula = occ_spec.get("skill_point_formula")
        if isinstance(raw_formula, str) and raw_formula.strip():
            formula = raw_formula.strip()
        raw_cr = occ_spec.get("credit_rating_range")
        if (
            isinstance(raw_cr, list)
            and len(raw_cr) == 2
            and all(isinstance(item, int) and not isinstance(item, bool) for item in raw_cr)
        ):
            cr_range = (int(raw_cr[0]), int(raw_cr[1]))
    occ_skills = resolve_occupation_skill_list(occ_spec, occupation_skill_names)
    if not occ_skills:
        raise ChargenRunError(
            "occupation",
            f"occupation {occupation_name!r} produced no catalog skills",
        )
    occ_budget = occupation_point_budget(formula, characteristics)
    interest_budget = int(characteristics["INT"]) * 2
    interest_ids = [
        resolved
        for name in (interest_skill_names or list(_DEFAULT_INTEREST_SKILLS))
        if (resolved := resolve_catalog_skill_name(name, catalog))
    ]
    if not interest_ids:
        interest_ids = [sid for sid in _DEFAULT_INTEREST_SKILLS if sid in catalog]
    bases = {
        skill_id: _guided_skill_base(skill_id, catalog[skill_id], characteristics)
        for skill_id in set(occ_skills) | set(interest_ids)
        if skill_id in catalog
    }
    if occupation_allocations is not None:
        occ_alloc = {
            str(key): int(value)
            for key, value in occupation_allocations.items()
            if int(value) > 0
        }
        got = sum(occ_alloc.values())
        if got != occ_budget:
            raise ChargenRunError(
                "occupation_allocations",
                "occupation allocations total mismatch",
                expected={"expected": occ_budget, "got": got},
            )
    else:
        occ_alloc = allocate_points_in_order(
            occ_skills,
            occ_budget,
            bases,
            floor={"Credit Rating": cr_range[0]},
        )
        if sum(occ_alloc.values()) != occ_budget:
            raise ChargenRunError(
                "occupation_allocations",
                "could not place occupation points under the starting cap",
                expected={"expected": occ_budget, "got": sum(occ_alloc.values())},
            )
    if interest_allocations is not None:
        int_alloc = {
            str(key): int(value)
            for key, value in interest_allocations.items()
            if int(value) > 0
        }
        got = sum(int_alloc.values())
        if got != interest_budget:
            raise ChargenRunError(
                "interest_allocations",
                "interest allocations total mismatch",
                expected={"expected": interest_budget, "got": got},
            )
    else:
        interest_bases = {
            skill_id: bases.get(skill_id, 0) + occ_alloc.get(skill_id, 0)
            for skill_id in set(bases) | set(interest_ids)
        }
        int_alloc = allocate_points_in_order(
            interest_ids, interest_budget, interest_bases,
        )
        if sum(int_alloc.values()) != interest_budget:
            raise ChargenRunError(
                "interest_allocations",
                "could not place interest points under the starting cap",
                expected={"expected": interest_budget, "got": sum(int_alloc.values())},
            )
    default_ids = list(
        ((_guided_skill_policy().get("standard_sheet") or {}).get("1920s") or {}).get(
            "default_skill_ids"
        )
        or []
    )
    required = set(default_ids) | set(occ_alloc) | set(int_alloc)
    skills: dict[str, int] = {}
    for skill_id in catalog:
        if skill_id not in required:
            continue
        base = _guided_skill_base(skill_id, catalog[skill_id], characteristics)
        skills[skill_id] = (
            base + occ_alloc.get(skill_id, 0) + int_alloc.get(skill_id, 0)
        )
    sheet = {
        "id": investigator_id,
        "name": name,
        "occupation": occ_key,
        "age": age,
        "skills": skills,
        "player_facing_sheet_zh": {"display_name": name, "skills": []},
    }
    creation = {
        "method": "quick_fire_array",
        "input_mode": "guided_quick_fire",
        "characteristic_assignment_order": order,
        "luck": {"mode": "auto_roll"},
        "occupation": {"name": occ_key, "skill_point_formula": formula},
        "skill_budget": {
            "occupation_points": {
                "budget": occ_budget,
                "spent": occ_budget,
                "allocations": occ_alloc,
            },
            "personal_interest_points": {
                "budget": interest_budget,
                "spent": interest_budget,
                "allocations": int_alloc,
            },
        },
    }
    return sheet, creation, {
        "occupation_key": occ_key,
        "formula": formula,
        "characteristics": characteristics,
    }


def build_era_adaptive_chargen_payload(
    *,
    investigator_id: str,
    name: str,
    occupation_name: str,
    era: str,
    luck_roll_total: int,
    luck_roll_receipt: dict[str, Any],
    assignment_priority: list[str] | None = None,
    occupation_skill_names: list[str] | None = None,
    interest_skill_names: list[str] | None = None,
    age: int = 27,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    """Build KP-semantic era-adaptive create sheet. Numbers stay system-owned."""
    era_key = str(era or "").strip()
    if not era_key:
        raise ChargenRunError("payload", "campaign era is required for era-adaptive chargen")
    if era_key in guided_quick_fire_supported_eras():
        raise ChargenRunError(
            "payload",
            "era-adaptive chargen is unavailable for a guided Quick Fire era",
        )
    catalog = _skill_catalog()
    occ_names = list(occupation_skill_names or [])
    if lookup_occupation_template(occupation_name) is None and not occ_names:
        occ_names = list(_DEFAULT_INTEREST_SKILLS)
    interest_names = list(interest_skill_names or [])
    extra = [
        skill_id
        for skill_id in catalog
        if skill_id not in occ_names
        and skill_id not in interest_names
        and skill_id != "Cthulhu Mythos"
    ]
    last_error: ChargenRunError | None = None
    while True:
        try:
            _sheet, creation_qf, meta = build_quick_fire_chargen_payload(
                investigator_id=investigator_id,
                name=name,
                occupation_name=occupation_name,
                assignment_priority=assignment_priority,
                occupation_skill_names=occ_names,
                interest_skill_names=interest_names,
                age=age,
            )
            break
        except ChargenRunError as exc:
            last_error = exc
            if exc.stage not in {"occupation_allocations", "interest_allocations"} or not extra:
                raise
            if exc.stage == "occupation_allocations":
                occ_names.append(extra.pop(0))
            else:
                interest_names.append(extra.pop(0))
    if last_error is not None and "_sheet" not in locals():
        raise last_error
    if (
        isinstance(luck_roll_total, bool)
        or not isinstance(luck_roll_total, int)
        or not 3 <= luck_roll_total <= 18
    ):
        raise ChargenRunError("luck", "luck_roll_total must be an integer from 3 through 18")
    if not _valid_kp_guided_roll_reference(luck_roll_receipt):
        raise ChargenRunError(
            "luck",
            "luck_roll_receipt requires campaign_id, decision_id, and roll_id",
        )
    characteristics = meta["characteristics"]
    derived = derive_values(
        characteristics,
        luck=luck_roll_total * characteristic_generation_multiplier(),
    )
    occ_key = str(meta["occupation_key"])
    formula = str(meta["formula"])
    found = lookup_occupation_template(occupation_name)
    formula_reason = (
        "package occupation formula from occupations.json"
        if found is not None
        else "default EDU*4 for a KP-named era-adapted occupation"
    )
    occupation_obj = {
        "name": occ_key,
        "reason": f"KP-guided era-adapted occupation {occ_key}",
        "era_adaptive": True,
        "skill_point_formula": formula,
        "formula_reason": formula_reason,
    }
    # The deterministic helper above materializes the package-owned 1920s
    # standard sheet so it can reuse its allocation arithmetic.  That full
    # catalog is not an era-neutral investigator sheet: carrying it forward
    # leaks entries such as Drive Auto, firearms, and Electrical Repair into
    # Roman/medieval play.  The era-adaptive contract instead makes the live
    # KP choose the occupation and interest skills semantically.  Preserve
    # exactly those selected rows plus the three rules-level core rows; omit
    # every unselected 1920s default.
    selected_skill_ids = {
        skill_id
        for account in creation_qf["skill_budget"].values()
        for skill_id in account["allocations"]
    } | {"Dodge", "Language (Own)", "Cthulhu Mythos"}
    skills = {
        key: int(value)
        for key, value in (_sheet.get("skills") or {}).items()
        if key in selected_skill_ids
        and isinstance(value, int)
        and not isinstance(value, bool)
    }
    skill_provenance: dict[str, dict[str, Any]] = {}
    if "Credit Rating" in skills:
        skill_provenance["Credit Rating"] = {
            "original_name": "Credit Rating",
            "reskinned_name": "地位与财力",
            "era_adaptive": True,
        }
    localized_rows = _localized_skill_rows(skills)
    for row in localized_rows:
        provenance = skill_provenance.get(str(row.get("key") or ""))
        if provenance is not None:
            row["label"] = provenance["reskinned_name"]
    sheet = {
        "id": investigator_id,
        "name": name,
        "occupation": occupation_obj,
        "age": age,
        "era": era_key,
        "era_adaptive": True,
        "kp_guided": True,
        "characteristics": characteristics,
        "derived": derived,
        "skills": skills,
        "skill_provenance": skill_provenance,
        "player_facing_sheet_zh": {
            "display_name": name,
            "skills": localized_rows,
        },
    }
    creation = {
        "input_mode": ERA_ADAPTIVE_INPUT_MODE,
        "era": era_key,
        "era_adaptive": True,
        "kp_guided": True,
        "method": "quick_fire_array",
        "characteristic_assignment_order": list(
            creation_qf.get("characteristic_assignment_order") or []
        ),
        "luck_roll_total": luck_roll_total,
        "luck_roll_receipt": dict(luck_roll_receipt),
        "occupation": occupation_obj,
        "skill_budget": creation_qf["skill_budget"],
    }
    return sheet, creation, meta
