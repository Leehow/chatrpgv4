import importlib.util
from pathlib import Path

import pytest


def load_module(name: str, relative_path: str):
    path = Path(relative_path)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_character = load_module("coc_character", "plugins/coc-keeper/scripts/coc_character.py")


def test_derive_values_calculates_hp_mp_san_db_build_and_mov():
    characteristics = {
        "STR": 60,
        "CON": 50,
        "SIZ": 70,
        "DEX": 55,
        "APP": 45,
        "INT": 65,
        "POW": 60,
        "EDU": 70,
    }
    result = coc_character.derive_values(characteristics, luck=45)
    assert result["HP"] == 12
    assert result["MP"] == 12
    assert result["SAN"] == 60
    assert result["Luck"] == 45
    assert result["DB"] == "+1D4"
    assert result["Build"] == 1
    assert result["MOV"] == 7


def test_derive_values_requires_luck():
    """Luck must be rolled as 3D6x5 and supplied; it is not derived from POW (rulebook p31)."""
    characteristics = {
        "STR": 60, "CON": 50, "SIZ": 70, "DEX": 55,
        "APP": 45, "INT": 65, "POW": 60, "EDU": 70,
    }
    with pytest.raises(ValueError, match="Luck must be rolled"):
        coc_character.derive_values(characteristics)


def test_derive_values_uses_rules_json_movement_rate(monkeypatch):
    calls = []

    def fake_movement_rate(str_value: int, dex_value: int, siz_value: int, *, age_mov_penalty: int = 0):
        calls.append((str_value, dex_value, siz_value, age_mov_penalty))
        return {"mov": 8}

    monkeypatch.setattr(coc_character.coc_rules, "movement_rate", fake_movement_rate)

    result = coc_character.derive_values({
        "STR": 60,
        "CON": 50,
        "SIZ": 70,
        "DEX": 55,
        "APP": 45,
        "INT": 65,
        "POW": 60,
        "EDU": 70,
    }, luck=45)

    assert calls == [(60, 55, 70, 0)]
    assert result["MOV"] == 8


def test_derive_values_uses_rules_json_derived_attributes(monkeypatch):
    def fake_derived_attributes_rule():
        return {
            "hit_points": {"sources": ["CON", "SIZ"], "divisor": 20, "rounding": "floor"},
            "magic_points": {"source": "POW", "divisor": 10, "rounding": "floor"},
            "sanity": {"source": "EDU"},
            "luck_default": {"source": "rolled", "formula": "3D6", "multiplier": 5, "independent_of_pow": True},
        }

    monkeypatch.setattr(coc_character.coc_rules, "derived_attributes_rule", fake_derived_attributes_rule, raising=False)

    result = coc_character.derive_values({
        "STR": 60,
        "CON": 50,
        "SIZ": 70,
        "DEX": 55,
        "APP": 45,
        "INT": 65,
        "POW": 60,
        "EDU": 70,
    }, luck=45)

    assert result["HP"] == 6
    assert result["MP"] == 6
    assert result["SAN"] == 70
    assert result["Luck"] == 45


def test_derive_values_applies_age_movement_penalty():
    characteristics = {
        "STR": 80,
        "CON": 50,
        "SIZ": 65,
        "DEX": 75,
        "APP": 45,
        "INT": 65,
        "POW": 60,
        "EDU": 70,
    }

    result = coc_character.derive_values(characteristics, luck=50, age_mov_penalty=1)

    assert result["MOV"] == 8


def test_apply_age_modifiers_uses_rules_json_age_adjustment(monkeypatch):
    calls = []

    def fake_age_adjustment(age: int):
        calls.append(age)
        return {
            "edu_improvement_checks": 1,
            "edu_reduction": 0,
            "app_reduction": 7,
        }

    monkeypatch.setattr(coc_character.coc_rules, "age_adjustment", fake_age_adjustment, raising=False)

    result = coc_character.apply_age_modifiers({
        "STR": 60,
        "CON": 50,
        "SIZ": 70,
        "DEX": 55,
        "APP": 50,
        "INT": 65,
        "POW": 60,
        "EDU": 70,
    }, 44, edu_improvement_rolls=[{"roll": 80, "improvement_roll": 1}])

    assert calls == [44]
    assert result["APP"] == 43
    assert result["EDU"] == 71


def test_apply_age_modifiers_rejects_successful_edu_check_without_improvement_roll():
    with pytest.raises(ValueError, match="improvement_roll"):
        coc_character.apply_age_modifiers({
            "STR": 60,
            "CON": 50,
            "SIZ": 70,
            "DEX": 55,
            "APP": 50,
            "INT": 65,
            "POW": 60,
            "EDU": 70,
        }, 32, edu_improvement_rolls=[80])


def test_apply_age_modifiers_requires_exact_edu_improvement_check_count():
    characteristics = {
        "STR": 60,
        "CON": 50,
        "SIZ": 70,
        "DEX": 55,
        "APP": 50,
        "INT": 65,
        "POW": 60,
        "EDU": 70,
    }

    with pytest.raises(ValueError, match="edu_improvement_rolls"):
        coc_character.apply_age_modifiers(characteristics, 32, edu_improvement_rolls=[])

    with pytest.raises(ValueError, match="edu_improvement_rolls"):
        coc_character.apply_age_modifiers(characteristics, 32, edu_improvement_rolls=[
            {"roll": 20},
            {"roll": 30},
        ])


def test_apply_age_modifiers_rejects_edu_improvement_roll_outside_rule_die():
    with pytest.raises(ValueError, match="1D10"):
        coc_character.apply_age_modifiers({
            "STR": 60,
            "CON": 50,
            "SIZ": 70,
            "DEX": 55,
            "APP": 50,
            "INT": 65,
            "POW": 60,
            "EDU": 70,
        }, 32, edu_improvement_rolls=[{"roll": 80, "improvement_roll": 11}])


def test_apply_age_modifiers_applies_rulebook_edu_improvement_amount():
    result = coc_character.apply_age_modifiers({
        "STR": 60,
        "CON": 50,
        "SIZ": 70,
        "DEX": 55,
        "APP": 50,
        "INT": 65,
        "POW": 60,
        "EDU": 70,
    }, 32, edu_improvement_rolls=[{"roll": 80, "improvement_roll": 4}])

    assert result["EDU"] == 74


def test_apply_age_modifiers_applies_rulebook_characteristic_reductions():
    result = coc_character.apply_age_modifiers({
        "STR": 60,
        "CON": 50,
        "SIZ": 70,
        "DEX": 55,
        "APP": 50,
        "INT": 65,
        "POW": 60,
        "EDU": 70,
    }, 47, edu_improvement_rolls=[
        {"roll": 20},
        {"roll": 30},
    ], characteristic_reductions=[
        {"characteristic": "DEX", "amount": 5},
    ])

    assert result["DEX"] == 50
    assert result["APP"] == 45
    assert result["EDU"] == 70


def test_apply_age_modifiers_rejects_missing_required_characteristic_reductions():
    with pytest.raises(ValueError, match="characteristic_reductions"):
        coc_character.apply_age_modifiers({
            "STR": 60,
            "CON": 50,
            "SIZ": 70,
            "DEX": 55,
            "APP": 50,
            "INT": 65,
            "POW": 60,
            "EDU": 70,
        }, 47, edu_improvement_rolls=[
            {"roll": 20},
            {"roll": 30},
        ])


def test_validate_character_sheet_reports_missing_required_fields():
    errors = coc_character.validate_character_sheet({"name": "Ada"})
    assert "missing id" in errors
    assert "missing characteristics" in errors


def test_characteristic_generation_methods_include_point_buy_and_quick_fire():
    methods = coc_character.characteristic_generation_methods()

    assert "rolled_in_order" in methods
    assert "rolled_pool_assignment" in methods
    assert methods["point_buy_460"]["total_budget"] == 460
    assert methods["point_buy_460"]["increment"] == 5
    assert methods["quick_fire_array"]["array"] == [80, 70, 60, 60, 50, 50, 50, 40]


def test_validate_point_buy_characteristics_accepts_valid_460_budget():
    errors = coc_character.validate_characteristic_generation(
        "point_buy_460",
        {
            "STR": 60,
            "CON": 50,
            "SIZ": 60,
            "DEX": 55,
            "APP": 60,
            "INT": 65,
            "POW": 55,
            "EDU": 55,
        },
    )

    assert errors == []


def test_validate_point_buy_characteristics_rejects_budget_range_and_increment_errors():
    errors = coc_character.validate_characteristic_generation(
        "point_buy_460",
        {
            "STR": 61,
            "CON": 50,
            "SIZ": 60,
            "DEX": 55,
            "APP": 60,
            "INT": 65,
            "POW": 55,
            "EDU": 55,
        },
    )

    assert "STR must be a multiple of 5" in errors
    assert "total characteristic budget 461 does not match required 460" in errors

    range_errors = coc_character.validate_characteristic_generation(
        "point_buy_460",
        {
            "STR": 95,
            "CON": 50,
            "SIZ": 60,
            "DEX": 55,
            "APP": 60,
            "INT": 65,
            "POW": 55,
            "EDU": 20,
        },
    )

    assert "STR must be between 15 and 90" in range_errors


def test_validate_quick_fire_array_accepts_same_values_in_any_assignment():
    errors = coc_character.validate_characteristic_generation(
        "quick_fire_array",
        {
            "STR": 40,
            "CON": 50,
            "SIZ": 50,
            "DEX": 50,
            "APP": 60,
            "INT": 60,
            "POW": 70,
            "EDU": 80,
        },
    )

    assert errors == []
