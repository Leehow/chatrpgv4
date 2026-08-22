#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import re
from datetime import datetime, timezone
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
# Nine p.157 categories plus the campaign-join hook. Matches coc_state.BACKSTORY_FIELDS.
CHARGEN_BACKSTORY_FIELDS = (
    "personal_description",
    "ideology_beliefs",
    "significant_people",
    "meaningful_locations",
    "treasured_possessions",
    "traits",
    "injuries_scars",
    "phobias_manias",
    "encounters",
)
CHARGEN_BACKSTORY_ALLOWED = CHARGEN_BACKSTORY_FIELDS + ("scenario_bound",)
# Rulebook p.157 starring: only the first six categories may be the key connection.
CHARGEN_KEY_CONNECTION_FIELDS = CHARGEN_BACKSTORY_FIELDS[:6]
CHARGEN_AGE_MIN = 15
CHARGEN_AGE_MAX = 89
CHARGEN_RUN_REQUIRED = frozenset({
    "campaign_id", "investigator_id", "name", "occupation_name",
})
CHARGEN_RUN_ALLOWED = CHARGEN_RUN_REQUIRED | frozenset({
    "assignment_priority",
    "occupation_skill_names",
    "interest_skill_names",
    "luck",
    "age",
    "backstory",
    "equipment",
    "key_connection",
    "occupation_label",
    "own_language",
})
CHARGEN_SHEET_FINANCE_FIELDS = (
    "cash", "assets", "spending_level", "living_standard",
)
CHARGEN_FINANCE_AMOUNT_KEYS = ("amount", "currency", "formula")
CHARGEN_QUICK_FIRE_SHEET_PROPERTIES = frozenset({
    "id", "name", "age", "era", "occupation", "skills",
    "player_facing_sheet_zh", "backstory", "equipment", "key_connection",
    "own_language",
    *CHARGEN_SHEET_FINANCE_FIELDS,
})
# Portrait is runtime-owned sheet metadata, not a KP chargen_run field.
PORTRAIT_SOURCE_PLAYER = "player"
PORTRAIT_SOURCE_SHEET_CONCEPT = "sheet_concept"
PORTRAIT_SOURCE_HOST_NATIVE = "host_native"
PORTRAIT_SOURCES = frozenset({
    PORTRAIT_SOURCE_PLAYER,
    PORTRAIT_SOURCE_SHEET_CONCEPT,
    PORTRAIT_SOURCE_HOST_NATIVE,
})
PORTRAIT_STATUS_PENDING = "pending"
PORTRAIT_STATUS_GENERATED = "generated"
PORTRAIT_STATUS_SKIPPED = "skipped"
PORTRAIT_STATUSES = frozenset({
    PORTRAIT_STATUS_PENDING,
    PORTRAIT_STATUS_GENERATED,
    PORTRAIT_STATUS_SKIPPED,
})
PORTRAIT_ALLOWED_KEYS = frozenset({
    "asset_path",
    "prompt",
    "source",
    "provenance",
    "status",
    "generated_at",
    "updated_at",
    "tool",
    "host",
})
PORTRAIT_PROVENANCE_KEYS = frozenset({
    "concept",
    "age",
    "occupation",
    "era",
    "region",
    "background",
    "appearance",
    "appearance_field",
})
PORTRAIT_ASSET_EXTENSIONS = frozenset({"png", "jpg", "jpeg", "webp"})
_PORTRAIT_INVESTIGATOR_ID_RE = re.compile(
    r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"
)
_PORTRAIT_ASSET_NAME_RE = re.compile(
    r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.(?:png|jpg|jpeg|webp)$",
    re.IGNORECASE,
)
CHARGEN_KP_FORBIDDEN_NUMERIC_FIELDS = frozenset({
    "cash",
    "assets",
    "spending_level",
    "living_standard",
    "credit_rating",
    "characteristics",
    "derived",
    "skills",
    "hp",
    "mp",
    "san",
    "luck_roll_total",
    "occupation_allocations",
    "interest_allocations",
})
_BACKSTORY_ZH_LABELS = {
    "personal_description": "外貌与来历",
    "ideology_beliefs": "人格信念",
    "significant_people": "重要之人",
    "meaningful_locations": "意义之地",
    "treasured_possessions": "珍视之物",
    "traits": "特质",
    "injuries_scars": "伤痕",
    "phobias_manias": "恐惧与躁狂",
    "encounters": "神秘遭遇",
    "scenario_bound": "如何卷入",
}
_LIVING_STANDARD_ZH = {
    "Penniless": "赤贫",
    "Poor": "贫穷",
    "Average": "普通",
    "Wealthy": "富裕",
    "Rich": "富有",
    "Super Rich": "超级富豪",
}
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
        if (
            "edu_improvement_rolls" in creation
            or "characteristic_reductions" in creation
        ):
            characteristics = apply_chargen_age_to_characteristics(
                characteristics,
                age,
                creation.get("edu_improvement_rolls"),
                creation.get("characteristic_reductions"),
            )
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
    own_language = materialized.get("own_language")
    own_name = own_language if isinstance(own_language, str) and own_language.strip() else None
    materialized["player_facing_sheet_zh"] = {
        **player_sheet,
        "skills": _localized_skill_rows(
            expected_skills,
            own_language=own_name.strip() if own_name else None,
        ),
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


def chargen_characteristic_reductions(age: int) -> list[dict[str, Any]]:
    """Deterministic STR/CON/DEX/SIZ spend for chargen; KP never chooses amounts."""
    adjustment = coc_rules.age_adjustment(age)
    total = int(adjustment.get("characteristic_reduction_total", 0))
    choices = [
        str(item)
        for item in (adjustment.get("characteristic_reduction_choices") or [])
        if str(item).strip()
    ]
    if total == 0:
        return []
    if not choices:
        raise ChargenRunError(
            "age",
            "age bracket requires characteristic reductions but lists no choices",
        )
    base, extra = divmod(total, len(choices))
    reductions: list[dict[str, Any]] = []
    for index, characteristic in enumerate(choices):
        amount = base + (1 if index < extra else 0)
        if amount > 0:
            reductions.append({"characteristic": characteristic, "amount": amount})
    return reductions


def apply_chargen_age_to_characteristics(
    characteristics: dict[str, int],
    age: int,
    edu_improvement_rolls: list[dict[str, Any]] | None = None,
    characteristic_reductions: list[dict[str, Any]] | None = None,
) -> dict[str, int]:
    reductions = (
        list(characteristic_reductions)
        if characteristic_reductions is not None
        else chargen_characteristic_reductions(age)
    )
    rolls = list(edu_improvement_rolls or [])
    try:
        return apply_age_modifiers(
            characteristics,
            age,
            edu_improvement_rolls=rolls,
            characteristic_reductions=reductions,
        )
    except ValueError as exc:
        raise ChargenRunError("age", str(exc)) from exc


def quick_fire_array_characteristics(
    assignment_priority: list[str] | None = None,
) -> dict[str, int]:
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
    if (
        not isinstance(values, list)
        or len(values) != len(REQUIRED_CHARACTERISTICS)
        or any(isinstance(value, bool) or not isinstance(value, int) for value in values)
    ):
        raise ChargenRunError("assignment", "quick_fire_array rule data is invalid")
    return {key: int(value) for key, value in zip(order, values, strict=True)}


def required_edu_improvement_checks(age: int) -> int:
    return int(coc_rules.age_adjustment(age).get("edu_improvement_checks", 0))


def chargen_luck_rolls_keep_highest(age: int) -> int:
    return max(1, int(coc_rules.age_adjustment(age).get("luck_rolls_keep_highest", 1)))


def format_chargen_money_zh(entry: Any) -> str:
    if not isinstance(entry, dict):
        return ""
    amount = entry.get("amount")
    if amount is None:
        return "无"
    currency = str(entry.get("currency") or "USD")
    if isinstance(amount, bool):
        return ""
    if isinstance(amount, float) and amount.is_integer():
        amount = int(amount)
    if isinstance(amount, int):
        formatted = f"{amount:,}"
    else:
        formatted = str(amount)
    if currency == "USD":
        return f"${formatted}"
    return f"{formatted} {currency}"


def _edu_before_improvement_checks(creation: dict[str, Any], age: int | None) -> int | None:
    order = creation.get("characteristic_assignment_order")
    if not isinstance(order, list):
        return None
    try:
        chars = quick_fire_array_characteristics(order)
    except ChargenRunError:
        return None
    edu = int(chars["EDU"])
    if age is None:
        return edu
    try:
        adjustment = coc_rules.age_adjustment(age)
    except ValueError:
        return edu
    edu = max(0, edu - int(adjustment.get("edu_reduction", 0)))
    return edu


def build_chargen_player_summary_zh(
    sheet: dict[str, Any],
    creation: dict[str, Any] | None,
) -> dict[str, list[str]]:
    """Deterministic zh-Hans sentences for KP to copy verbatim."""
    dice: list[str] = []
    finance: list[str] = []
    creation = creation if isinstance(creation, dict) else {}
    age = sheet.get("age")
    if isinstance(age, bool) or not isinstance(age, int):
        age = None
    candidates = creation.get("luck_roll_candidates")
    derived = sheet.get("derived") if isinstance(sheet.get("derived"), dict) else {}
    luck_value = derived.get("Luck")
    if isinstance(candidates, list) and candidates:
        totals: list[int] = []
        for index, row in enumerate(candidates, start=1):
            if not isinstance(row, dict):
                continue
            total = row.get("total")
            if isinstance(total, int) and not isinstance(total, bool):
                totals.append(total)
                dice.append(f"幸运（3D6）第{index}次：掷出 {total}")
        if totals:
            kept = max(totals)
            if isinstance(luck_value, int) and not isinstance(luck_value, bool):
                dice.append(f"幸运取高 {kept}，幸运值 {luck_value}")
            else:
                dice.append(f"幸运取高 {kept}，幸运值 {kept * 5}")
    else:
        luck_total = creation.get("luck_roll_total")
        if isinstance(luck_total, int) and not isinstance(luck_total, bool):
            if isinstance(luck_value, int) and not isinstance(luck_value, bool):
                dice.append(f"幸运（3D6）：掷出 {luck_total}，幸运值 {luck_value}")
            else:
                dice.append(f"幸运（3D6）：掷出 {luck_total}，幸运值 {luck_total * 5}")
    edu = _edu_before_improvement_checks(creation, age)
    for index, record in enumerate(creation.get("edu_improvement_rolls") or [], start=1):
        if not isinstance(record, dict):
            continue
        roll = record.get("roll")
        if not isinstance(roll, int) or isinstance(roll, bool):
            continue
        target = edu if isinstance(edu, int) else None
        if target is None:
            dice.append(f"教育提升检定 {index}（1D100）：掷出 {roll}")
            continue
        success = roll > target
        if success:
            improve = record.get("improvement_roll")
            if not isinstance(improve, int) or isinstance(improve, bool):
                improve = 0
            next_edu = min(99, target + improve)
            dice.append(
                f"教育提升检定 {index}（1D100）：{roll}/{target} 成功，EDU +{improve} → {next_edu}"
            )
            edu = next_edu
        else:
            dice.append(
                f"教育提升检定 {index}（1D100）：{roll}/{target} 失败，EDU 仍为 {target}"
            )
    skills = sheet.get("skills") if isinstance(sheet.get("skills"), dict) else {}
    credit = skills.get("Credit Rating")
    parts: list[str] = []
    if isinstance(credit, int) and not isinstance(credit, bool):
        parts.append(f"信用评级 {credit}")
    living = sheet.get("living_standard")
    if isinstance(living, str) and living.strip():
        parts.append(f"生活水平：{_LIVING_STANDARD_ZH.get(living, living)}")
    cash = format_chargen_money_zh(sheet.get("cash"))
    if cash:
        parts.append(f"建卡现金 {cash}")
    assets = format_chargen_money_zh(sheet.get("assets"))
    if assets:
        parts.append(f"建卡资产 {assets}")
    spend = format_chargen_money_zh(sheet.get("spending_level"))
    if spend:
        parts.append(f"每日免记账额度 {spend}")
    if parts:
        finance.append("建卡财力：" + "；".join(parts))
    return {"dice": dice, "finance": finance}


def _chargen_prose_string(value: Any, *, field: str) -> str:
    if isinstance(value, bool) or isinstance(value, (int, float)):
        raise ChargenRunError(
            "backstory",
            f"backstory.{field} must be prose; KP must not submit numbers",
        )
    if not isinstance(value, str) or not value.strip():
        raise ChargenRunError(
            "backstory",
            f"backstory.{field} must be a non-empty string",
        )
    return value.strip()


def normalize_chargen_backstory(backstory: Any) -> dict[str, Any] | None:
    if backstory is None:
        return None
    if not isinstance(backstory, dict):
        raise ChargenRunError("backstory", "backstory must be an object")
    unknown = sorted(str(key) for key in backstory if key not in CHARGEN_BACKSTORY_ALLOWED)
    if unknown:
        raise ChargenRunError(
            "backstory",
            "unsupported backstory keys",
            expected={
                "allowed": list(CHARGEN_BACKSTORY_ALLOWED),
                "unknown": unknown,
            },
        )
    normalized: dict[str, Any] = {}
    for key, value in backstory.items():
        if value is None:
            continue
        normalized[str(key)] = _chargen_prose_string(value, field=str(key))
    return normalized or None


def normalize_chargen_equipment(equipment: Any) -> list[str] | None:
    if equipment is None:
        return None
    if not isinstance(equipment, list):
        raise ChargenRunError("equipment", "equipment must be a list of strings")
    items: list[str] = []
    for item in equipment:
        if isinstance(item, bool) or isinstance(item, (int, float)):
            raise ChargenRunError(
                "equipment",
                "equipment entries must be prose strings; KP must not submit numbers",
            )
        if not isinstance(item, str) or not item.strip():
            raise ChargenRunError("equipment", "equipment entries must be non-empty strings")
        items.append(item.strip())
    return items


def normalize_chargen_key_connection(key_connection: Any) -> dict[str, str] | None:
    """Persist the healing/SAN self-help star: backstory_field + summary."""
    if key_connection is None:
        return None
    if not isinstance(key_connection, dict):
        raise ChargenRunError("key_connection", "key_connection must be an object")
    extra = sorted(
        str(key) for key in key_connection if key not in {"backstory_field", "summary"}
    )
    if extra:
        raise ChargenRunError(
            "key_connection",
            "unsupported key_connection keys",
            expected={"allowed": ["backstory_field", "summary"], "unknown": extra},
        )
    field = key_connection.get("backstory_field")
    if field not in CHARGEN_KEY_CONNECTION_FIELDS:
        raise ChargenRunError(
            "key_connection",
            "key_connection.backstory_field must be one of the first six p.157 categories",
            expected={"allowed": list(CHARGEN_KEY_CONNECTION_FIELDS)},
        )
    summary = key_connection.get("summary")
    if isinstance(summary, bool) or isinstance(summary, (int, float)):
        raise ChargenRunError(
            "key_connection",
            "key_connection.summary must be prose; KP must not submit numbers",
        )
    if not isinstance(summary, str) or not summary.strip():
        raise ChargenRunError(
            "key_connection",
            "key_connection.summary must be non-empty prose",
        )
    return {"backstory_field": str(field), "summary": summary.strip()}


def _format_finance_amount(entry: Any) -> str:
    if not isinstance(entry, dict):
        return "无"
    amount = entry.get("amount")
    if amount is None:
        return "无"
    currency = str(entry.get("currency") or "USD")
    return f"{amount} {currency}"


def chargen_cash_from_credit(credit_rating: int, era: str) -> dict[str, Any] | None:
    try:
        return coc_rules.cash_and_assets(int(credit_rating), str(era).strip())
    except ValueError:
        return None


def chargen_player_occupation_label(
    occupation_name: str,
    *,
    occupation_label: Any = None,
    occupation_value: Any = None,
) -> str:
    """Player-facing occupation must be zh-Hans prose, never a catalog English key."""
    label = occupation_label
    if label is None:
        label = ""
    if not isinstance(label, str):
        raise ChargenRunError("occupation", "occupation_label must be a string")
    label = label.strip()
    machine = occupation_name.strip()
    if isinstance(occupation_value, dict):
        machine = str(occupation_value.get("name") or machine).strip()
    elif isinstance(occupation_value, str) and occupation_value.strip():
        machine = occupation_value.strip()
    if label:
        if label == machine and label.isascii() and lookup_occupation_template(label) is not None:
            raise ChargenRunError(
                "occupation",
                "occupation_label must be player-facing zh-Hans, not the catalog English key",
            )
        return label
    if machine and not machine.isascii():
        return machine
    raise ChargenRunError(
        "occupation",
        "occupation_label is required when occupation_name is a catalog English key",
    )


def normalize_chargen_own_language(own_language: Any) -> str | None:
    if own_language is None:
        return None
    if isinstance(own_language, bool) or isinstance(own_language, (int, float)):
        raise ChargenRunError(
            "own_language",
            "own_language must be prose; KP must not submit numbers",
        )
    if not isinstance(own_language, str) or not own_language.strip():
        raise ChargenRunError(
            "own_language",
            "own_language must be a non-empty play_language name",
        )
    return own_language.strip()


def chargen_default_own_language(era: str) -> str | None:
    """Thin table default when KP omits own_language. Not a locale parser."""
    if str(era or "").strip() in {"1920s", "modern"}:
        return "英语"
    return None


def chargen_working_language(era: str) -> str | None:
    """Module/era working language for chargen advisories.

    Same table as omitted own_language (1920s/modern = 英语). kp_guided
    era-adaptive eras have no authoritative cash/language table, so this
    returns None and chargen must not invent a working-language warning.
    """
    return chargen_default_own_language(era)


def _language_identity_key(name: str) -> str | None:
    raw = str(name or "").strip()
    if not raw:
        return None
    return language_other_skill_id(raw) or language_other_skill_id(
        f"Language ({raw})"
    )


def sheet_has_other_language(skills: Any, language_name: str) -> bool:
    return sheet_other_language_value(skills, language_name) is not None


def sheet_other_language_value(skills: Any, language_name: str) -> int | None:
    wanted = _language_identity_key(language_name)
    if wanted is None or not isinstance(skills, dict):
        return None
    best: int | None = None
    for key, value in skills.items():
        if str(key) == "Language (Own)":
            continue
        if _language_identity_key(str(key)) != wanted:
            continue
        if isinstance(value, bool) or not isinstance(value, int):
            continue
        best = value if best is None else max(best, value)
    return best


# Keeper Rulebook Ch.4 "General level of ability by skill value" (full.md ~2321–2327):
# 50%-74% Professional — eke out a living; bachelor's-degree equivalent.
# Independent file-reading / interview / legal diction is professional work.
CHARGEN_WORKING_LANGUAGE_PROFESSIONAL_MIN = 50


def chargen_working_language_warning(
    *,
    era: str,
    own_language: Any,
    skills: Any,
) -> str | None:
    """Advisory only: missing or sub-professional table working language."""
    working = chargen_working_language(era)
    if working is None:
        return None
    own = str(own_language).strip() if isinstance(own_language, str) else ""
    if not own:
        return None
    if _language_identity_key(own) == _language_identity_key(working):
        return None
    skill_id = language_other_skill_id(working) or f"Language ({working})"
    value = sheet_other_language_value(skills, working)
    if value is None:
        return (
            f"调查员母语与本模组工作语言（{working}）不一致，技能表没有 {skill_id}。"
            f"该调查员在模组语境下无法有效行动。"
            f"建议以 replace=True 重跑 setup.chargen_run / coc_chargen_delegate，"
            f"并把 {skill_id} 分配到得体水平。"
        )
    threshold = CHARGEN_WORKING_LANGUAGE_PROFESSIONAL_MIN
    if value < threshold:
        return (
            f"调查员工作语言 {skill_id} 为 {value}，低于规则书 Professional 档建议阈值 {threshold}"
            f"（50% 起可凭该技能谋生，相当于本科学位）。"
            f"目前只能有限交流，不足以独立读档案、访谈或处理专业措辞。"
            f"建议以 replace=True 重跑 setup.chargen_run / coc_chargen_delegate 并提升到 {threshold}，"
            f"或保留该弱点并安排翻译/同伴。玩家可坚持低语言设定；KP 不得偷偷覆盖硬约束。"
        )
    return None


def own_language_skill_label(own_language: str) -> str:
    return f"语言（{own_language}）"


def apply_own_language_skill_label(
    player_sheet: dict[str, Any], own_language: str
) -> None:
    rows = player_sheet.get("skills")
    if not isinstance(rows, list):
        return
    for row in rows:
        if isinstance(row, dict) and row.get("key") == "Language (Own)":
            row["label"] = own_language_skill_label(own_language)


def investigator_portrait_dir(investigator_id: str) -> str:
    ident = str(investigator_id or "").strip()
    if not _PORTRAIT_INVESTIGATOR_ID_RE.match(ident):
        raise ChargenRunError(
            "portrait",
            "investigator id is required for a canonical portrait path",
        )
    return f".coc/investigators/{ident}/portraits"


def canonical_portrait_asset_path(investigator_id: str, filename: str) -> str:
    name = str(filename or "").strip()
    if not _PORTRAIT_ASSET_NAME_RE.match(name):
        raise ChargenRunError(
            "portrait",
            "portrait filename must be a posix basename with png/jpg/jpeg/webp",
        )
    return f"{investigator_portrait_dir(investigator_id)}/{name}"


def _portrait_timestamp(now: Any = None) -> str:
    if isinstance(now, datetime):
        moment = now if now.tzinfo is not None else now.replace(tzinfo=timezone.utc)
        return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    if isinstance(now, str) and now.strip():
        return now.strip()
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _portrait_prose(value: Any, *, field: str) -> str:
    if isinstance(value, bool) or isinstance(value, (int, float)):
        raise ChargenRunError(
            "portrait",
            f"portrait.{field} must be prose; KP must not submit numbers",
        )
    if not isinstance(value, str) or not value.strip():
        raise ChargenRunError(
            "portrait",
            f"portrait.{field} must be a non-empty string",
        )
    return value.strip()


def _confirmed_portrait_region(sheet: dict[str, Any]) -> str | None:
    identity = sheet.get("identity")
    candidates = (
        sheet.get("nationality"),
        identity.get("nationality") if isinstance(identity, dict) else None,
    )
    player_sheet = sheet.get("player_facing_sheet_zh")
    if isinstance(player_sheet, dict):
        candidates = (*candidates, player_sheet.get("nationality"))
    for value in candidates:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _confirmed_portrait_occupation(sheet: dict[str, Any]) -> str | None:
    player_sheet = sheet.get("player_facing_sheet_zh")
    if isinstance(player_sheet, dict):
        label = player_sheet.get("occupation")
        if isinstance(label, str) and label.strip():
            return label.strip()
    occupation = sheet.get("occupation")
    if isinstance(occupation, dict):
        name = occupation.get("name")
        if isinstance(name, str) and name.strip():
            return name.strip()
    if isinstance(occupation, str) and occupation.strip():
        return occupation.strip()
    return None


def _confirmed_portrait_concept(sheet: dict[str, Any]) -> str | None:
    for value in (sheet.get("name"),):
        if isinstance(value, str) and value.strip():
            return value.strip()
    identity = sheet.get("identity")
    if isinstance(identity, dict):
        name = identity.get("name")
        if isinstance(name, str) and name.strip():
            return name.strip()
    player_sheet = sheet.get("player_facing_sheet_zh")
    if isinstance(player_sheet, dict):
        name = player_sheet.get("display_name")
        if isinstance(name, str) and name.strip():
            return name.strip()
    return None


def build_portrait_prompt_seed(
    sheet: dict[str, Any],
    *,
    era: str = "",
) -> dict[str, Any]:
    """Confirmed concept facts for a later prompt builder. Invents no appearance."""
    seed: dict[str, Any] = {}
    concept = _confirmed_portrait_concept(sheet)
    if concept:
        seed["concept"] = concept
    age = sheet.get("age")
    if isinstance(age, int) and not isinstance(age, bool):
        seed["age"] = age
    occupation = _confirmed_portrait_occupation(sheet)
    if occupation:
        seed["occupation"] = occupation
    era_value = str(era or sheet.get("era") or "").strip()
    if era_value:
        seed["era"] = era_value
    region = _confirmed_portrait_region(sheet)
    if region:
        seed["region"] = region
    backstory = sheet.get("backstory")
    background: dict[str, str] = {}
    if isinstance(backstory, dict):
        for key in CHARGEN_BACKSTORY_ALLOWED:
            if key not in backstory:
                continue
            raw = backstory[key]
            if isinstance(raw, str) and raw.strip():
                background[key] = raw.strip()
    if background:
        seed["background"] = background
        appearance = background.get("personal_description")
        if appearance:
            seed["appearance"] = appearance
            seed["appearance_field"] = "personal_description"
    return seed


def _normalize_portrait_asset_path(
    path_text: Any,
    *,
    investigator_id: Any,
) -> str:
    if not isinstance(path_text, str) or not path_text.strip():
        raise ChargenRunError(
            "portrait",
            "portrait.asset_path must be a non-empty posix path",
        )
    raw = path_text.strip().replace("\\", "/")
    if raw.startswith("/") or raw.startswith("~") or ":" in Path(raw).parts[0]:
        raise ChargenRunError(
            "portrait",
            "portrait.asset_path must be workspace-relative",
        )
    if raw.startswith("./") or "/./" in raw or ".." in Path(raw).parts:
        raise ChargenRunError(
            "portrait",
            "portrait.asset_path must not contain '.' or '..' segments",
        )
    ident = str(investigator_id or "").strip()
    expected_dir = investigator_portrait_dir(ident)
    parts = Path(raw).parts
    if len(parts) < 5 or Path(*parts[:-1]).as_posix() != expected_dir:
        raise ChargenRunError(
            "portrait",
            "portrait.asset_path must live under "
            f"{expected_dir}/",
            expected={"directory": expected_dir},
        )
    return canonical_portrait_asset_path(ident, parts[-1])


def _normalize_portrait_provenance(provenance: Any) -> dict[str, Any] | None:
    if provenance is None:
        return None
    if not isinstance(provenance, dict):
        raise ChargenRunError("portrait", "portrait.provenance must be an object")
    unknown = sorted(
        str(key) for key in provenance if key not in PORTRAIT_PROVENANCE_KEYS
    )
    if unknown:
        raise ChargenRunError(
            "portrait",
            "unsupported portrait.provenance keys",
            expected={
                "allowed": sorted(PORTRAIT_PROVENANCE_KEYS),
                "unknown": unknown,
            },
        )
    normalized: dict[str, Any] = {}
    if "age" in provenance and provenance["age"] is not None:
        age = provenance["age"]
        if isinstance(age, bool) or not isinstance(age, int):
            raise ChargenRunError("portrait", "portrait.provenance.age must be an integer")
        normalized["age"] = age
    for key in ("concept", "occupation", "era", "region", "appearance", "appearance_field"):
        if key not in provenance or provenance[key] is None:
            continue
        normalized[key] = _portrait_prose(provenance[key], field=f"provenance.{key}")
    if "background" in provenance and provenance["background"] is not None:
        background = provenance["background"]
        if not isinstance(background, dict):
            raise ChargenRunError(
                "portrait",
                "portrait.provenance.background must be an object",
            )
        unknown_bg = sorted(
            str(key) for key in background if key not in CHARGEN_BACKSTORY_ALLOWED
        )
        if unknown_bg:
            raise ChargenRunError(
                "portrait",
                "unsupported portrait.provenance.background keys",
                expected={
                    "allowed": list(CHARGEN_BACKSTORY_ALLOWED),
                    "unknown": unknown_bg,
                },
            )
        items: dict[str, str] = {}
        for key, value in background.items():
            if value is None:
                continue
            items[str(key)] = _portrait_prose(
                value, field=f"provenance.background.{key}"
            )
        if items:
            normalized["background"] = items
    return normalized or None


def normalize_chargen_portrait(
    portrait: Any,
    *,
    investigator_id: Any = None,
) -> dict[str, Any] | None:
    if portrait is None:
        return None
    if not isinstance(portrait, dict):
        raise ChargenRunError("portrait", "portrait must be an object")
    unknown = sorted(str(key) for key in portrait if key not in PORTRAIT_ALLOWED_KEYS)
    if unknown:
        raise ChargenRunError(
            "portrait",
            "unsupported portrait keys",
            expected={"allowed": sorted(PORTRAIT_ALLOWED_KEYS), "unknown": unknown},
        )
    normalized: dict[str, Any] = {}
    if "asset_path" in portrait and portrait["asset_path"] not in (None, ""):
        normalized["asset_path"] = _normalize_portrait_asset_path(
            portrait["asset_path"],
            investigator_id=investigator_id,
        )
    for key in ("prompt", "generated_at", "updated_at", "tool", "host"):
        if key not in portrait or portrait[key] is None:
            continue
        normalized[key] = _portrait_prose(portrait[key], field=key)
    if "source" in portrait and portrait["source"] is not None:
        source = portrait["source"]
        if source not in PORTRAIT_SOURCES:
            raise ChargenRunError(
                "portrait",
                "portrait.source must be player, sheet_concept, or host_native",
                expected={"allowed": sorted(PORTRAIT_SOURCES)},
            )
        normalized["source"] = source
    if "status" in portrait and portrait["status"] is not None:
        status = portrait["status"]
        if status not in PORTRAIT_STATUSES:
            raise ChargenRunError(
                "portrait",
                "portrait.status must be pending, generated, or skipped",
                expected={"allowed": sorted(PORTRAIT_STATUSES)},
            )
        normalized["status"] = status
    provenance = _normalize_portrait_provenance(portrait.get("provenance"))
    if provenance:
        normalized["provenance"] = provenance
    if (
        normalized.get("status") == PORTRAIT_STATUS_GENERATED
        and not normalized.get("asset_path")
    ):
        raise ChargenRunError(
            "portrait",
            "portrait.status=generated requires a canonical asset_path",
        )
    return normalized or None


def player_facing_portrait(character: dict[str, Any]) -> dict[str, Any]:
    """Player-facing portrait projection: path/source/status/time only."""
    sheet = character.get("player_facing_sheet_zh")
    sheet = sheet if isinstance(sheet, dict) else {}
    raw = character.get("portrait")
    portrait = raw if isinstance(raw, dict) else {}
    asset = ""
    machine_path = portrait.get("asset_path")
    sheet_path = sheet.get("portrait_path")
    if isinstance(machine_path, str) and machine_path.strip():
        asset = machine_path.strip()
    elif isinstance(sheet_path, str) and sheet_path.strip():
        asset = sheet_path.strip()
    projected: dict[str, Any] = {}
    if asset:
        projected["asset_path"] = asset
        projected["portrait_path"] = asset
    source = portrait.get("source") or sheet.get("portrait_source")
    if isinstance(source, str) and source.strip():
        projected["source"] = source.strip()
        projected["portrait_source"] = source.strip()
    status = portrait.get("status") or sheet.get("portrait_status")
    if isinstance(status, str) and status.strip():
        projected["status"] = status.strip()
        projected["portrait_status"] = status.strip()
    generated_at = portrait.get("generated_at") or sheet.get("portrait_generated_at")
    if isinstance(generated_at, str) and generated_at.strip():
        projected["generated_at"] = generated_at.strip()
        projected["portrait_generated_at"] = generated_at.strip()
    return projected


def apply_player_facing_portrait(
    sheet: dict[str, Any],
    portrait: dict[str, Any] | None = None,
) -> None:
    player_sheet = sheet.get("player_facing_sheet_zh")
    if not isinstance(player_sheet, dict):
        player_sheet = {}
        sheet["player_facing_sheet_zh"] = player_sheet
    machine = portrait if portrait is not None else sheet.get("portrait")
    projected = player_facing_portrait(
        {"portrait": machine if isinstance(machine, dict) else {}, "player_facing_sheet_zh": {}}
    )
    for key in (
        "portrait_path",
        "portrait_source",
        "portrait_status",
        "portrait_generated_at",
    ):
        player_sheet.pop(key, None)
    if projected.get("portrait_path"):
        player_sheet["portrait_path"] = projected["portrait_path"]
    if projected.get("portrait_source"):
        player_sheet["portrait_source"] = projected["portrait_source"]
    if projected.get("portrait_status"):
        player_sheet["portrait_status"] = projected["portrait_status"]
    if projected.get("portrait_generated_at"):
        player_sheet["portrait_generated_at"] = projected["portrait_generated_at"]


def attach_chargen_portrait(
    sheet: dict[str, Any],
    *,
    era: str = "",
    now: Any = None,
) -> dict[str, Any]:
    """Record portrait metadata at chargen. Does not call an image API."""
    attached = sheet
    investigator_id = attached.get("id")
    existing = normalize_chargen_portrait(
        attached.get("portrait"),
        investigator_id=investigator_id,
    )
    portrait = dict(existing) if existing else {}
    seed = build_portrait_prompt_seed(attached, era=era)
    appearance = seed.get("appearance")
    player_locked = portrait.get("source") == PORTRAIT_SOURCE_PLAYER
    generated_locked = (
        portrait.get("status") == PORTRAIT_STATUS_GENERATED
        and bool(portrait.get("asset_path"))
    )
    existing_prov = (
        dict(portrait["provenance"])
        if isinstance(portrait.get("provenance"), dict)
        else {}
    )
    if player_locked or generated_locked:
        filled = dict(existing_prov)
        for key, value in seed.items():
            if key == "appearance" or key == "appearance_field":
                continue
            if key not in filled or filled[key] in (None, "", {}, []):
                filled[key] = value
        if appearance and "appearance" not in filled:
            filled["appearance"] = appearance
            filled["appearance_field"] = "personal_description"
        if filled:
            portrait["provenance"] = filled
    else:
        portrait["source"] = (
            PORTRAIT_SOURCE_PLAYER if appearance else PORTRAIT_SOURCE_SHEET_CONCEPT
        )
        if portrait.get("status") not in PORTRAIT_STATUSES:
            portrait["status"] = PORTRAIT_STATUS_PENDING
        if portrait.get("status") == PORTRAIT_STATUS_GENERATED and not portrait.get(
            "asset_path"
        ):
            portrait["status"] = PORTRAIT_STATUS_PENDING
        merged = dict(seed)
        if appearance:
            merged["appearance"] = appearance
            merged["appearance_field"] = "personal_description"
        elif "appearance" in existing_prov:
            merged["appearance"] = existing_prov["appearance"]
            if existing_prov.get("appearance_field"):
                merged["appearance_field"] = existing_prov["appearance_field"]
        if merged:
            portrait["provenance"] = merged
        portrait["updated_at"] = _portrait_timestamp(now)
        portrait.pop("prompt", None)
    normalized = normalize_chargen_portrait(
        portrait,
        investigator_id=investigator_id,
    )
    if normalized:
        attached["portrait"] = normalized
        apply_player_facing_portrait(attached, normalized)
    return attached


GENERATED_PORTRAIT_PAYLOAD_KEYS = frozenset({
    "asset_path",
    "source",
    "prompt",
    "provenance",
    "generated_at",
    "tool",
    "host",
})


def investigator_character_json_path(root: Path, investigator_id: str) -> Path:
    ident = str(investigator_id or "").strip()
    if not _PORTRAIT_INVESTIGATOR_ID_RE.match(ident):
        raise ChargenRunError(
            "portrait",
            "investigator id is required for a canonical portrait path",
        )
    return Path(root) / ".coc" / "investigators" / ident / "character.json"


def record_generated_portrait(
    sheet: dict[str, Any],
    *,
    asset_path: str,
    source: str | None = None,
    prompt: str | None = None,
    provenance: Any = None,
    generated_at: Any = None,
    tool: str | None = None,
    host: str | None = None,
) -> dict[str, Any]:
    """Write generated portrait metadata onto an investigator sheet.

    Does not call an image API and does not invent appearance. Player-facing
    projection still omits prompt/provenance.
    """
    attached = json.loads(json.dumps(sheet))
    investigator_id = attached.get("id")
    existing = normalize_chargen_portrait(
        attached.get("portrait"),
        investigator_id=investigator_id,
    )
    portrait = dict(existing) if existing else {}
    portrait["asset_path"] = asset_path
    portrait["status"] = PORTRAIT_STATUS_GENERATED
    stamp = _portrait_timestamp(generated_at)
    portrait["generated_at"] = stamp
    portrait["updated_at"] = stamp
    if source is not None:
        portrait["source"] = source
    elif portrait.get("source") not in PORTRAIT_SOURCES:
        portrait["source"] = PORTRAIT_SOURCE_SHEET_CONCEPT
    if prompt is not None:
        portrait["prompt"] = prompt
    if provenance is not None:
        portrait["provenance"] = provenance
    if tool is not None:
        portrait["tool"] = tool
    if host is not None:
        portrait["host"] = host
    normalized = normalize_chargen_portrait(
        portrait,
        investigator_id=investigator_id,
    )
    if not normalized:
        raise ChargenRunError("portrait", "generated portrait metadata is empty")
    attached["portrait"] = normalized
    apply_player_facing_portrait(attached, normalized)
    return attached


def apply_generated_portrait_file(
    *,
    root: Path,
    investigator_id: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    """Load character.json, record generated portrait metadata, write atomically."""
    if not isinstance(payload, dict):
        raise ChargenRunError("portrait", "generated portrait payload must be an object")
    unknown = sorted(
        str(key) for key in payload if key not in GENERATED_PORTRAIT_PAYLOAD_KEYS
    )
    if unknown:
        raise ChargenRunError(
            "portrait",
            "unsupported generated portrait payload keys",
            expected={
                "allowed": sorted(GENERATED_PORTRAIT_PAYLOAD_KEYS),
                "unknown": unknown,
            },
        )
    path = investigator_character_json_path(root, investigator_id)
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ChargenRunError(
            "portrait",
            "character.json is missing or invalid",
        ) from exc
    if not isinstance(raw, dict):
        raise ChargenRunError("portrait", "character.json must be an object")
    sheet_id = str(raw.get("id") or "").strip()
    if sheet_id and sheet_id != str(investigator_id).strip():
        raise ChargenRunError(
            "portrait",
            "investigator id does not match character.json",
        )
    if not sheet_id:
        raw["id"] = str(investigator_id).strip()
    updated = record_generated_portrait(
        raw,
        asset_path=str(payload.get("asset_path") or ""),
        source=payload.get("source"),
        prompt=payload.get("prompt"),
        provenance=payload.get("provenance"),
        generated_at=payload.get("generated_at"),
        tool=payload.get("tool"),
        host=payload.get("host"),
    )
    tmp = path.with_name(f"{path.name}.tmp")
    tmp.write_text(
        json.dumps(updated, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    tmp.replace(path)
    return player_facing_portrait(updated)


def attach_chargen_roleplay(
    sheet: dict[str, Any],
    *,
    backstory: Any = None,
    equipment: Any = None,
    key_connection: Any = None,
    occupation_label: Any = None,
    own_language: Any = None,
    era: str = "",
    now: Any = None,
) -> dict[str, Any]:
    """Persist KP prose plus rules-owned cash. Does not invent narrative."""
    attached = json.loads(json.dumps(sheet))
    normalized_backstory = normalize_chargen_backstory(backstory)
    normalized_equipment = normalize_chargen_equipment(equipment)
    normalized_key = normalize_chargen_key_connection(key_connection)
    if normalized_backstory:
        attached["backstory"] = normalized_backstory
    if normalized_equipment:
        attached["equipment"] = normalized_equipment
    if normalized_key:
        field = normalized_key["backstory_field"]
        if not normalized_backstory or field not in normalized_backstory:
            raise ChargenRunError(
                "key_connection",
                "key_connection.backstory_field must name a backstory entry written this chargen",
                expected={"required_field": field},
            )
        attached["key_connection"] = normalized_key
    resolved_own = normalize_chargen_own_language(own_language)
    if resolved_own is None:
        resolved_own = chargen_default_own_language(era)
    if resolved_own:
        attached["own_language"] = resolved_own
    skills = attached.get("skills") if isinstance(attached.get("skills"), dict) else {}
    credit = skills.get("Credit Rating")
    finance = None
    if isinstance(credit, int) and not isinstance(credit, bool):
        finance = chargen_cash_from_credit(credit, era)
    if finance is not None:
        attached["cash"] = finance["cash"]
        attached["assets"] = finance["assets"]
        attached["spending_level"] = finance["spending_level"]
        attached["living_standard"] = finance["living_standard"]
    player_sheet = attached.get("player_facing_sheet_zh")
    if not isinstance(player_sheet, dict):
        player_sheet = {}
    occupation = attached.get("occupation")
    if isinstance(occupation, dict):
        machine_name = str(occupation.get("name") or "").strip()
    else:
        machine_name = str(occupation or "").strip()
    player_sheet["occupation"] = chargen_player_occupation_label(
        machine_name,
        occupation_label=occupation_label,
        occupation_value=occupation,
    )
    if attached.get("age") is not None:
        player_sheet["age"] = attached["age"]
    details: list[dict[str, Any]] = []
    star_field = normalized_key["backstory_field"] if normalized_key else None
    if normalized_backstory:
        for key in CHARGEN_BACKSTORY_ALLOWED:
            if key not in normalized_backstory:
                continue
            raw = normalized_backstory[key]
            items = raw if isinstance(raw, list) else [raw]
            label = _BACKSTORY_ZH_LABELS.get(key, key)
            block: dict[str, Any] = {
                "field": key,
                "label": f"{label} ★" if key == star_field else label,
                "items": list(items),
            }
            if key == star_field:
                block["starred"] = True
            details.append(block)
    if normalized_equipment:
        details.append({"label": "随身物品", "items": list(normalized_equipment)})
    if normalized_key:
        field_label = _BACKSTORY_ZH_LABELS.get(
            normalized_key["backstory_field"],
            normalized_key["backstory_field"],
        )
        details.append({
            "label": "关键连结",
            "items": [f"{field_label}：{normalized_key['summary']}"],
        })
    if finance is not None:
        living = str(finance.get("living_standard") or "")
        living_zh = _LIVING_STANDARD_ZH.get(living, living)
        details.append({
            "label": "建卡财力",
            "items": [
                f"建卡生活水平：{living_zh}",
                f"建卡现金：{_format_finance_amount(finance.get('cash'))}",
                f"建卡资产：{_format_finance_amount(finance.get('assets'))}",
                f"每日免记账额度：{_format_finance_amount(finance.get('spending_level'))}",
            ],
        })
    if details:
        player_sheet["backstory_details"] = details
        summary_source = None
        if normalized_backstory:
            for key in (
                "personal_description",
                "scenario_bound",
                "ideology_beliefs",
                "traits",
            ):
                if key in normalized_backstory:
                    raw = normalized_backstory[key]
                    summary_source = raw[0] if isinstance(raw, list) else raw
                    break
        if summary_source:
            player_sheet["backstory_summary"] = str(summary_source)
    if resolved_own:
        apply_own_language_skill_label(player_sheet, resolved_own)
    attached["player_facing_sheet_zh"] = player_sheet
    return attach_chargen_portrait(attached, era=era, now=now)


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
            elif localized_skills != _localized_skill_rows(
                expected_skills,
                own_language=(
                    str(sheet.get("own_language")).strip()
                    if isinstance(sheet.get("own_language"), str)
                    else None
                ) or None,
            ):
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
    age_bundle = (
        "edu_improvement_rolls" in creation
        or "characteristic_reductions" in creation
    )
    if method_id == "quick_fire_array" and age_bundle:
        try:
            base_characteristics = quick_fire_array_characteristics(
                list(creation.get("characteristic_assignment_order") or [])
            )
        except ChargenRunError as exc:
            errors.append(str(exc))
            return errors
        errors.extend(
            validate_characteristic_generation(method_id, base_characteristics)
        )
        age = sheet.get("age")
        if isinstance(age, bool) or not isinstance(age, int):
            errors.append("age must be an integer when age modifiers are present")
            return errors
        try:
            adjusted = apply_chargen_age_to_characteristics(
                base_characteristics,
                age,
                creation.get("edu_improvement_rolls"),
                creation.get("characteristic_reductions"),
            )
        except ChargenRunError as exc:
            errors.append(str(exc))
            return errors
        if characteristics != adjusted:
            errors.append(
                "age-adjusted characteristics do not match apply_age_modifiers"
            )
    else:
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


_LANGUAGE_OTHER_NAME_ALIASES = {
    "english": "English",
    "英语": "English",
    "英文": "English",
    "spanish": "Spanish",
    "西班牙语": "Spanish",
    "西语": "Spanish",
}
_LANGUAGE_OTHER_LABEL_ZH = {
    "English": "英语",
    "Spanish": "西班牙语",
}
_LANGUAGE_OTHER_SKILL_RE = re.compile(
    r"^(?:other\s+language|language)\s*\((.+)\)$",
    re.IGNORECASE,
)


def language_other_skill_id(name: str) -> str | None:
    """Map KP language-other names onto Language (English)-style machine keys.

    Language (Other) is a group, not a catalog skill. Specializations are not
    in rules-json; chargen still persists them when the KP names one.
    """
    raw = str(name or "").strip()
    if not raw:
        return None
    folded = raw.casefold()
    mapped = _LANGUAGE_OTHER_NAME_ALIASES.get(folded)
    if mapped:
        return f"Language ({mapped})"
    match = _LANGUAGE_OTHER_SKILL_RE.fullmatch(raw)
    if match is None:
        return None
    inner = match.group(1).strip()
    if not inner:
        return None
    inner_fold = inner.casefold()
    if inner_fold in {"own", "母语", "other"}:
        return None
    language = _LANGUAGE_OTHER_NAME_ALIASES.get(inner_fold) or inner
    if language.isascii():
        language = language[:1].upper() + language[1:]
    return f"Language ({language})"


def _language_other_spec(skill_id: str) -> dict[str, Any] | None:
    canonical = language_other_skill_id(skill_id)
    if canonical is None or canonical != skill_id:
        return None
    return {"base_chance": 1, "group": "Language (Other)"}


def _chargen_skill_spec(
    skill_id: str, catalog: dict[str, dict]
) -> dict[str, Any] | None:
    spec = catalog.get(skill_id)
    if isinstance(spec, dict):
        return spec
    return _language_other_spec(skill_id)


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
            spec = _chargen_skill_spec(skill_id, catalog)
            if spec is None:
                errors.append(
                    f"skill_budget.{account_name} allocation uses unknown "
                    f"canonical skill {skill_id!r}"
                )
                continue
            if skill_id not in available and skill_id in catalog:
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
    for skill_id in list(catalog) + [
        key for key in expected_ids if key not in catalog
    ]:
        if skill_id not in expected_ids:
            continue
        spec = _chargen_skill_spec(skill_id, catalog)
        if spec is None:
            errors.append(
                f"guided Quick Fire cannot resolve skill spec {skill_id!r}"
            )
            continue
        try:
            base = _guided_skill_base(
                skill_id,
                spec,
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
                spec.get("base_chance") in {"half_DEX", "EDU"}
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
    own_language = sheet.get("own_language")
    for skill_id, row in rendered.items():
        entry = provenance.get(skill_id)
        if entry is not None:
            expected_label = entry.get("reskinned_name")
        elif (
            skill_id == "Language (Own)"
            and isinstance(own_language, str)
            and own_language.strip()
        ):
            expected_label = f"语言（{own_language.strip()}）"
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


def _localized_skill_rows(
    skills: dict[str, int],
    *,
    own_language: str | None = None,
) -> list[dict[str, Any]]:
    catalog = _skill_catalog()
    rows: list[dict[str, Any]] = []
    for skill_id, value in skills.items():
        spec = _chargen_skill_spec(skill_id, catalog) or {}
        labels = spec.get("localized_labels") if isinstance(spec, dict) else None
        label = None
        if isinstance(labels, dict):
            label = labels.get("zh-Hans")
        if not isinstance(label, str) or not label.strip():
            other = language_other_skill_id(skill_id)
            if other == skill_id:
                inner = skill_id[len("Language ("):-1]
                label = f"语言（{_LANGUAGE_OTHER_LABEL_ZH.get(inner, inner)}）"
            else:
                label = skill_id
        rows.append({"key": skill_id, "label": str(label), "value": value})
    if own_language:
        apply_own_language_skill_label({"skills": rows}, own_language)
    return rows


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
    other = language_other_skill_id(raw)
    if other is not None:
        return other
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


_PROFESSIONAL_SKILL_PREFIX = "Professional: "


def _decode_professional_skill_name(name: str) -> tuple[str, bool]:
    raw = str(name).strip()
    if raw.startswith(_PROFESSIONAL_SKILL_PREFIX):
        return raw[len(_PROFESSIONAL_SKILL_PREFIX):].strip(), True
    return raw, False


def resolve_occupation_skill_list(
    occupation_spec: dict[str, Any] | None,
    occupation_skill_names: list[str] | None,
) -> list[str]:
    catalog = _skill_catalog()
    resolved: list[str] = []
    seen: set[str] = set()

    def _add(name: str | None) -> None:
        if not name or name in seen:
            return
        if name not in catalog and _language_other_spec(name) is None:
            return
        seen.add(name)
        resolved.append(name)

    extras = [
        _decode_professional_skill_name(str(item))[0]
        for item in (occupation_skill_names or [])
        if str(item).strip()
    ]
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
    edu_improvement_rolls: list[dict[str, Any]] | None = None,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    """Build compact sheet + creation for investigator.create. No I/O."""
    catalog = _skill_catalog()
    if not catalog:
        raise ChargenRunError("occupation", "canonical skill catalog is unavailable")
    order = list(assignment_priority or REQUIRED_CHARACTERISTICS)
    characteristics = quick_fire_array_characteristics(order)
    reductions = chargen_characteristic_reductions(age)
    rolls = list(edu_improvement_rolls or [])
    characteristics = apply_chargen_age_to_characteristics(
        characteristics,
        age,
        rolls,
        reductions,
    )
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
    professional_occ_skills: list[str] = []
    for raw_name in occupation_skill_names or []:
        clean_name, marked_professional = _decode_professional_skill_name(raw_name)
        if not marked_professional:
            continue
        skill_id = resolve_catalog_skill_name(clean_name, catalog)
        if skill_id is None or language_other_skill_id(skill_id) is None:
            raise ChargenRunError(
                "occupation",
                "Professional marker is only valid for a concrete non-native language skill",
                expected={"received": raw_name},
            )
        if skill_id not in professional_occ_skills:
            professional_occ_skills.append(skill_id)
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
    bases = {}
    for skill_id in set(occ_skills) | set(interest_ids):
        spec = _chargen_skill_spec(skill_id, catalog)
        if spec is None:
            continue
        bases[skill_id] = _guided_skill_base(skill_id, spec, characteristics)
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
        occupation_floors = {"Credit Rating": cr_range[0]}
        for skill_id in professional_occ_skills:
            occupation_floors[skill_id] = max(
                0,
                CHARGEN_WORKING_LANGUAGE_PROFESSIONAL_MIN - bases.get(skill_id, 0),
            )
        occ_alloc = allocate_points_in_order(
            occ_skills,
            occ_budget,
            bases,
            floor=occupation_floors,
        )
        if sum(occ_alloc.values()) != occ_budget:
            raise ChargenRunError(
                "occupation_allocations",
                "could not place occupation points under the starting cap",
                expected={"expected": occ_budget, "got": sum(occ_alloc.values())},
            )
        below_professional = {
            skill_id: bases.get(skill_id, 0) + occ_alloc.get(skill_id, 0)
            for skill_id in professional_occ_skills
            if bases.get(skill_id, 0) + occ_alloc.get(skill_id, 0)
            < CHARGEN_WORKING_LANGUAGE_PROFESSIONAL_MIN
        }
        if below_professional:
            raise ChargenRunError(
                "occupation_allocations",
                "occupation budget cannot fund every declared professional language",
                expected={
                    "minimum": CHARGEN_WORKING_LANGUAGE_PROFESSIONAL_MIN,
                    "values": below_professional,
                },
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
    required = set(default_ids) | set(occ_alloc) | set(int_alloc) | {
        skill_id for skill_id in ("Dodge", "Language (Own)") if skill_id in catalog
    }
    skills: dict[str, int] = {}
    for skill_id in list(catalog) + [
        key for key in required if key not in catalog
    ]:
        if skill_id not in required:
            continue
        spec = _chargen_skill_spec(skill_id, catalog)
        if spec is None:
            continue
        base = _guided_skill_base(skill_id, spec, characteristics)
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
        "edu_improvement_rolls": rolls,
        "characteristic_reductions": reductions,
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
    edu_improvement_rolls: list[dict[str, Any]] | None = None,
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
                edu_improvement_rolls=edu_improvement_rolls,
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
    age_mov_penalty = int(coc_rules.age_adjustment(age).get("mov_penalty", 0))
    derived = derive_values(
        characteristics,
        luck=luck_roll_total * characteristic_generation_multiplier(),
        age_mov_penalty=age_mov_penalty,
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
        "edu_improvement_rolls": list(
            creation_qf.get("edu_improvement_rolls") or []
        ),
        "characteristic_reductions": list(
            creation_qf.get("characteristic_reductions") or []
        ),
        "skill_budget": creation_qf["skill_budget"],
    }
    return sheet, creation, meta


def main(argv: list[str] | None = None) -> int:
    import argparse
    import sys

    parser = argparse.ArgumentParser(
        prog="coc_character.py",
        description="Canonical investigator character helpers",
    )
    sub = parser.add_subparsers(dest="command", required=True)
    rec = sub.add_parser(
        "record-generated-portrait",
        help="write generated portrait metadata onto character.json",
    )
    rec.add_argument("--root", type=Path, required=True)
    rec.add_argument("--investigator", required=True)
    rec.add_argument("--json", required=True, help="generated portrait payload JSON")
    args = parser.parse_args(argv)
    if args.command != "record-generated-portrait":
        parser.error("unknown command")
    try:
        payload = json.loads(args.json)
    except json.JSONDecodeError as exc:
        sys.stderr.write(json.dumps({"ok": False, "error": str(exc)}) + "\n")
        return 2
    try:
        projected = apply_generated_portrait_file(
            root=args.root,
            investigator_id=args.investigator,
            payload=payload,
        )
    except ChargenRunError as exc:
        sys.stderr.write(
            json.dumps(
                {"ok": False, "error": str(exc), "stage": exc.stage},
                ensure_ascii=False,
            )
            + "\n"
        )
        return 1
    sys.stdout.write(
        json.dumps({"ok": True, "portrait": projected}, ensure_ascii=False) + "\n"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
