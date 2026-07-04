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
    })

    assert calls == [(60, 55, 70, 0)]
    assert result["MOV"] == 8


def test_derive_values_uses_rules_json_derived_attributes(monkeypatch):
    def fake_derived_attributes_rule():
        return {
            "hit_points": {"sources": ["CON", "SIZ"], "divisor": 20, "rounding": "floor"},
            "magic_points": {"source": "POW", "divisor": 10, "rounding": "floor"},
            "sanity": {"source": "EDU"},
            "luck_default": {"source": "APP"},
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
    })

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

    result = coc_character.derive_values(characteristics, age_mov_penalty=1)

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
