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
SINGLE_DIE_PATTERN = re.compile(r"^1D(?P<sides>\d+)$")


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
            "guided_quick_fire or import_complete_sheet"
        )
        return errors
    input_mode = creation.get("input_mode")
    if input_mode == "import_complete_sheet":
        return errors
    if input_mode != "guided_quick_fire":
        errors.append(
            "creation.input_mode must be guided_quick_fire or "
            "import_complete_sheet"
        )
        return errors

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
        if derived_spent != declared_spent or declared_spent != declared_budget:
            errors.append(
                f"skill_budget.{account_name} derived allocation total "
                f"{derived_spent} must equal spent and budget "
                f"{declared_spent}/{declared_budget}"
            )
        if (
            account_name == "personal_interest_points"
            and isinstance(characteristics.get("INT"), int)
            and not isinstance(characteristics.get("INT"), bool)
            and declared_budget != int(characteristics["INT"]) * 2
        ):
            errors.append(
                "skill_budget.personal_interest_points budget must equal INT*2"
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
