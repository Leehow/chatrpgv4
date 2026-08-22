import importlib.util
import json
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
    assert any("missing characteristics" in e for e in errors)


def _complete_quick_fire_sheet() -> dict:
    characteristics = {
        "STR": 80,
        "CON": 70,
        "SIZ": 60,
        "DEX": 60,
        "APP": 50,
        "INT": 50,
        "POW": 50,
        "EDU": 40,
    }
    return {
        "id": "ada",
        "name": "Ada",
        "age": 29,
        "characteristics": characteristics,
        "derived": coc_character.derive_values(characteristics, luck=60),
        "skills": {"Credit Rating": 20, "Spot Hidden": 50},
    }


def test_validate_character_create_sheet_accepts_complete_canonical_sheet():
    assert coc_character.validate_character_create_sheet(
        _complete_quick_fire_sheet(),
        {"method": "quick_fire_array", "input_mode": "import_complete_sheet"},
    ) == []


def test_validate_character_create_sheet_rejects_localized_skills_and_missing_derived():
    sheet = _complete_quick_fire_sheet()
    sheet["derived"] = None
    sheet["skills"] = {"信用评级": 20, "侦查": 50}

    errors = coc_character.validate_character_create_sheet(sheet)

    assert any("missing derived" in e for e in errors)
    assert "missing canonical skill Credit Rating" in errors
    assert any("canonical English" in error for error in errors)


def test_validate_character_create_sheet_rejects_wrong_quick_fire_array_and_derived_values():
    sheet = _complete_quick_fire_sheet()
    sheet["characteristics"]["STR"] = 60
    sheet["derived"]["DB"] = "0"

    errors = coc_character.validate_character_create_sheet(
        sheet,
        {"method": "quick_fire_array", "input_mode": "guided_quick_fire"},
    )

    assert any("quick_fire_array values" in error for error in errors)
    assert "derived DB '0' does not match rules value 'none'" in errors


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


_QUICK_FIRE_ORDER = ("DEX", "INT", "POW", "EDU", "CON", "SIZ", "APP", "STR")
_QUICK_FIRE_OCCUPATION_ALLOCATIONS = {
    "Credit Rating": 20,
    "Spot Hidden": 40,
    "Library Use": 40,
    "Psychology": 30,
    "Fast Talk": 30,
    "History": 40,
}
_QUICK_FIRE_INTEREST_ALLOCATIONS = {
    "Listen": 40,
    "Stealth": 40,
    "Occult": 30,
    "First Aid": 30,
}


def _complete_quick_fire_skills() -> tuple[dict, dict]:
    """Reconciled 1920s standard-sheet skills for the guided Quick Fire path."""
    characteristics = dict(zip(
        _QUICK_FIRE_ORDER, (80, 70, 60, 60, 50, 50, 50, 40), strict=True,
    ))
    rule_table = coc_character.coc_rules.load_rule_table("skills")
    catalog = rule_table["skills"]
    required = (
        set(rule_table["standard_sheet"]["1920s"]["default_skill_ids"])
        | set(_QUICK_FIRE_OCCUPATION_ALLOCATIONS)
        | set(_QUICK_FIRE_INTEREST_ALLOCATIONS)
    )
    skills: dict[str, int] = {}
    for skill_id, spec in catalog.items():
        if skill_id not in required:
            continue
        base = spec["base_chance"]
        if base == "half_DEX":
            base = characteristics["DEX"] // 2
        elif base == "EDU":
            base = characteristics["EDU"]
        skills[skill_id] = (
            int(base)
            + _QUICK_FIRE_OCCUPATION_ALLOCATIONS.get(skill_id, 0)
            + _QUICK_FIRE_INTEREST_ALLOCATIONS.get(skill_id, 0)
        )
    return skills, {
        "occupation_points": {
            "budget": 200,
            "spent": 200,
            "allocations": dict(_QUICK_FIRE_OCCUPATION_ALLOCATIONS),
        },
        "personal_interest_points": {
            "budget": 140,
            "spent": 140,
            "allocations": dict(_QUICK_FIRE_INTEREST_ALLOCATIONS),
        },
    }


def test_materialize_quick_fire_sheet_owns_fixed_numbers_and_derived_values():
    skills, skill_budget = _complete_quick_fire_skills()
    compact = {
        "id": "ada",
        "name": "Ada",
        "age": 29,
        "skills": dict(skills),
        "player_facing_sheet_zh": {"display_name": "艾达"},
    }
    creation = {
        "method": "quick_fire_array",
        "input_mode": "guided_quick_fire",
        "characteristic_assignment_order": list(_QUICK_FIRE_ORDER),
        "luck_roll_total": 12,
        "skill_budget": skill_budget,
    }
    original = json.loads(json.dumps(compact))

    sheet = coc_character.materialize_quick_fire_create_sheet(compact, creation)

    assert sheet["characteristics"] == {
        "DEX": 80,
        "INT": 70,
        "POW": 60,
        "EDU": 60,
        "CON": 50,
        "SIZ": 50,
        "APP": 50,
        "STR": 40,
    }
    assert sheet["derived"] == coc_character.derive_values(
        sheet["characteristics"], luck=60,
    )
    # Materialization never mutates the caller's compact sheet.
    assert compact == original
    assert coc_character.validate_character_create_sheet(sheet, creation) == []


def test_quick_fire_interest_budget_error_names_int_and_expected():
    order = ("INT", "DEX", "POW", "EDU", "CON", "SIZ", "APP", "STR")
    skills, skill_budget = _complete_quick_fire_skills()
    skill_budget["personal_interest_points"]["budget"] = 140
    skill_budget["personal_interest_points"]["spent"] = 140
    creation = {
        "method": "quick_fire_array",
        "input_mode": "guided_quick_fire",
        "characteristic_assignment_order": list(order),
        "luck_roll_total": 12,
        "skill_budget": skill_budget,
    }
    compact = {
        "id": "ada",
        "name": "Ada",
        "age": 29,
        "skills": dict(skills),
        "player_facing_sheet_zh": {"display_name": "艾达"},
    }
    with pytest.raises(ValueError, match=r"INT=80, expected=160, got=140"):
        coc_character.materialize_quick_fire_create_sheet(compact, creation)


def test_quick_fire_interest_allocations_auto_align_budget_and_spent():
    skills, skill_budget = _complete_quick_fire_skills()
    skill_budget["personal_interest_points"]["budget"] = 1
    skill_budget["personal_interest_points"]["spent"] = 1
    creation = {
        "method": "quick_fire_array",
        "input_mode": "guided_quick_fire",
        "characteristic_assignment_order": list(_QUICK_FIRE_ORDER),
        "luck_roll_total": 12,
        "skill_budget": skill_budget,
    }
    compact = {
        "id": "ada",
        "name": "Ada",
        "age": 29,
        "skills": dict(skills),
        "player_facing_sheet_zh": {"display_name": "艾达"},
    }
    sheet = coc_character.materialize_quick_fire_create_sheet(compact, creation)
    account = creation["skill_budget"]["personal_interest_points"]
    assert account["budget"] == 140
    assert account["spent"] == 140
    assert sum(account["allocations"].values()) == 140
    assert coc_character.validate_character_create_sheet(sheet, creation) == []


@pytest.mark.parametrize(
    ("creation", "message"),
    [
        (
            {
                "method": "quick_fire_array",
                "input_mode": "guided_quick_fire",
                "characteristic_assignment_order": [
                    "DEX", "INT", "POW", "EDU", "CON", "SIZ", "APP", "APP",
                ],
                "luck_roll_total": 12,
            },
            "each of STR, CON, SIZ, DEX, APP, INT, POW, EDU exactly once",
        ),
        (
            {
                "method": "quick_fire_array",
                "input_mode": "guided_quick_fire",
                "characteristic_assignment_order": list(
                    coc_character.REQUIRED_CHARACTERISTICS
                ),
                "luck_roll_total": 19,
            },
            "luck_roll_total must be an integer from 3 through 18",
        ),
    ],
)
def test_materialize_quick_fire_sheet_rejects_invalid_semantic_inputs(
    creation: dict, message: str,
):
    with pytest.raises(ValueError, match=message):
        coc_character.materialize_quick_fire_create_sheet(
            {"id": "ada", "name": "Ada"}, creation,
        )


# ---------------------------------------------------------------------------
# assert_unique_canonical_skills — one owner per canonical skill identity
# ---------------------------------------------------------------------------

def test_assert_unique_canonical_skills_accepts_normal_sheet():
    sheet = {
        "skills": {
            "Credit Rating": 40,
            "Psychology": 55,
            "Spot Hidden": 45,
            "Fighting (Brawl)": 50,
            "Firearms (Handgun)": 55,
            "Library Use": 60,
        },
    }

    assert coc_character.assert_unique_canonical_skills(sheet) is None


def test_assert_unique_canonical_skills_accepts_custom_skills():
    sheet = {
        "skills": {
            "Credit Rating": 40,
            "Talismans": 20,
            "Streetwise": 35,
        },
    }

    assert coc_character.assert_unique_canonical_skills(sheet) is None


def test_assert_unique_canonical_skills_rejects_localized_alias_duplicate():
    sheet = {"skills": {"Psychology": 55, "心理学": 10}}

    with pytest.raises(ValueError, match="collide after canonical folding"):
        coc_character.assert_unique_canonical_skills(sheet)


def test_assert_unique_canonical_skills_rejects_compact_fold_duplicate():
    sheet = {"skills": {"Fast Talk": 45, "FastTalk": 30}}

    with pytest.raises(ValueError, match="collide after canonical folding"):
        coc_character.assert_unique_canonical_skills(sheet)


def test_assert_unique_canonical_skills_tolerates_missing_or_invalid_skills():
    assert coc_character.assert_unique_canonical_skills({}) is None
    assert coc_character.assert_unique_canonical_skills({"skills": []}) is None


def test_validate_character_create_sheet_accepts_era_adaptive_language_other():
    sheet, creation, _meta = coc_character.build_era_adaptive_chargen_payload(
        investigator_id="ada-en",
        name="Ada Lark",
        occupation_name="Journalist",
        era="1890s",
        luck_roll_total=12,
        luck_roll_receipt={
            "campaign_id": "gaslight",
            "decision_id": "ada-en-luck",
            "roll_id": "roll-ada-en-luck",
        },
        occupation_skill_names=["Spot Hidden", "Listen", "Language (English)"],
        interest_skill_names=["Occult", "First Aid", "Language (English)"],
        age=19,
        edu_improvement_rolls=[],
    )

    assert "Language (English)" in sheet["skills"]
    assert "Language (English)" not in sheet["skill_provenance"]
    assert coc_character.validate_character_create_sheet(sheet, creation) == []
    labels = {
        row["key"]: row["label"]
        for row in sheet["player_facing_sheet_zh"]["skills"]
        if isinstance(row, dict)
    }
    assert labels["Language (English)"] == "语言（英语）"


def test_kp_guided_occupation_formula_options_fail_closed_on_rule_literal_drift(
    monkeypatch,
):
    options = coc_character._occupation_skill_point_formula_options()
    assert options["EDU*4"] == (("EDU", 4),)

    original = coc_character.coc_rules.load_rule_table

    def changed_rule_table(name):
        table = original(name)
        if name != "occupations":
            return table
        changed = json.loads(json.dumps(table))
        occupation = next(iter(changed["occupations"].values()))
        occupation["skill_point_formula"] = "EDU*4+INT*2"
        return changed

    monkeypatch.setattr(
        coc_character.coc_rules,
        "load_rule_table",
        changed_rule_table,
    )

    assert coc_character._occupation_skill_point_formula_options() == {}


def _portrait_chargen_sheet() -> dict:
    return {
        "id": "ada",
        "name": "Ada",
        "age": 29,
        "era": "1920s",
        "occupation": "Journalist",
        "nationality": "波士顿",
        "player_facing_sheet_zh": {
            "display_name": "艾达",
            "occupation": "记者",
            "nationality": "波士顿",
            "skills": [],
        },
    }


def test_canonical_portrait_asset_path_is_investigator_scoped():
    assert coc_character.canonical_portrait_asset_path("ada", "ada.png") == (
        ".coc/investigators/ada/portraits/ada.png"
    )
    with pytest.raises(coc_character.ChargenRunError, match="basename"):
        coc_character.canonical_portrait_asset_path("ada", "../x.png")


def test_normalize_chargen_portrait_rejects_non_canonical_paths():
    with pytest.raises(coc_character.ChargenRunError, match="must live under"):
        coc_character.normalize_chargen_portrait(
            {"asset_path": "assets/portraits/ada.png"},
            investigator_id="ada",
        )
    with pytest.raises(coc_character.ChargenRunError, match="must live under"):
        coc_character.normalize_chargen_portrait(
            {"asset_path": ".coc/campaigns/camp/assets/portraits/ada.png"},
            investigator_id="ada",
        )
    with pytest.raises(coc_character.ChargenRunError, match="must live under"):
        coc_character.normalize_chargen_portrait(
            {"asset_path": ".coc/investigators/other/portraits/ada.png"},
            investigator_id="ada",
        )


def test_attach_chargen_roleplay_marks_player_appearance_and_does_not_invent_prompt():
    attached = coc_character.attach_chargen_roleplay(
        _portrait_chargen_sheet(),
        backstory={"personal_description": "高瘦，rumpled 大衣领口别着铅笔。"},
        occupation_label="记者",
        era="1920s",
        now="2026-08-21T12:00:00Z",
    )
    portrait = attached["portrait"]
    assert portrait["source"] == coc_character.PORTRAIT_SOURCE_PLAYER
    assert portrait["status"] == coc_character.PORTRAIT_STATUS_PENDING
    assert "asset_path" not in portrait
    assert "prompt" not in portrait
    assert portrait["updated_at"] == "2026-08-21T12:00:00Z"
    assert portrait["provenance"]["appearance"] == "高瘦，rumpled 大衣领口别着铅笔。"
    assert portrait["provenance"]["appearance_field"] == "personal_description"
    assert portrait["provenance"]["concept"] == "Ada"
    assert portrait["provenance"]["age"] == 29
    assert portrait["provenance"]["occupation"] == "记者"
    assert portrait["provenance"]["era"] == "1920s"
    assert portrait["provenance"]["region"] == "波士顿"
    sheet = attached["player_facing_sheet_zh"]
    assert sheet["portrait_source"] == "player"
    assert sheet["portrait_status"] == "pending"
    assert "portrait_path" not in sheet
    assert attached["backstory"]["personal_description"] == (
        "高瘦，rumpled 大衣领口别着铅笔。"
    )


def test_attach_chargen_roleplay_records_concept_seed_when_appearance_is_missing():
    attached = coc_character.attach_chargen_roleplay(
        _portrait_chargen_sheet(),
        backstory={"traits": "冷静"},
        occupation_label="记者",
        era="1920s",
        now="2026-08-21T12:00:00Z",
    )
    portrait = attached["portrait"]
    assert portrait["source"] == coc_character.PORTRAIT_SOURCE_SHEET_CONCEPT
    assert portrait["status"] == coc_character.PORTRAIT_STATUS_PENDING
    assert "appearance" not in portrait["provenance"]
    assert portrait["provenance"]["background"] == {"traits": "冷静"}
    assert attached["backstory"] == {"traits": "冷静"}
    assert "personal_description" not in attached["backstory"]


def test_attach_chargen_portrait_does_not_overwrite_player_source():
    sheet = _portrait_chargen_sheet()
    sheet["portrait"] = {
        "source": "player",
        "status": "generated",
        "asset_path": ".coc/investigators/ada/portraits/ada.png",
        "prompt": "keep-me",
        "generated_at": "2026-01-01T00:00:00Z",
        "provenance": {"appearance": "original player look"},
    }
    attached = coc_character.attach_chargen_roleplay(
        sheet,
        backstory={"personal_description": "a different look the player did not ask to replace"},
        occupation_label="记者",
        era="1920s",
        now="2026-08-21T12:00:00Z",
    )
    portrait = attached["portrait"]
    assert portrait["source"] == "player"
    assert portrait["status"] == "generated"
    assert portrait["prompt"] == "keep-me"
    assert portrait["asset_path"] == ".coc/investigators/ada/portraits/ada.png"
    assert portrait["generated_at"] == "2026-01-01T00:00:00Z"
    assert portrait["provenance"]["appearance"] == "original player look"
    assert attached["player_facing_sheet_zh"]["portrait_path"] == (
        ".coc/investigators/ada/portraits/ada.png"
    )
    assert attached["player_facing_sheet_zh"]["portrait_generated_at"] == (
        "2026-01-01T00:00:00Z"
    )


def test_player_facing_portrait_projects_card_fields_only():
    projected = coc_character.player_facing_portrait({
        "portrait": {
            "asset_path": ".coc/investigators/ada/portraits/ada.png",
            "source": "player",
            "status": "generated",
            "prompt": "secret prompt",
            "provenance": {"appearance": "hidden from card"},
            "generated_at": "2026-01-01T00:00:00Z",
        },
    })
    assert projected["portrait_path"] == ".coc/investigators/ada/portraits/ada.png"
    assert projected["portrait_source"] == "player"
    assert projected["portrait_status"] == "generated"
    assert projected["portrait_generated_at"] == "2026-01-01T00:00:00Z"
    assert "prompt" not in projected
    assert "provenance" not in projected


def test_record_generated_portrait_writes_metadata_without_leaking_on_player_facing():
    sheet = _portrait_chargen_sheet()
    sheet["portrait"] = {
        "source": "player",
        "status": "pending",
        "provenance": {"appearance": "高瘦，大衣领口别着铅笔。"},
    }
    updated = coc_character.record_generated_portrait(
        sheet,
        asset_path=".coc/investigators/ada/portraits/ada.png",
        source="player",
        prompt="secret prompt",
        provenance={"appearance": "高瘦，大衣领口别着铅笔。", "concept": "Ada"},
        generated_at="2026-08-21T12:00:00Z",
        tool="grok-imagine-image-2.0",
        host="pi-coc",
    )
    portrait = updated["portrait"]
    assert portrait["status"] == "generated"
    assert portrait["asset_path"] == ".coc/investigators/ada/portraits/ada.png"
    assert portrait["prompt"] == "secret prompt"
    assert portrait["source"] == "player"
    facing = coc_character.player_facing_portrait(updated)
    assert facing["portrait_path"] == ".coc/investigators/ada/portraits/ada.png"
    assert "prompt" not in facing
    assert "provenance" not in facing


def test_apply_generated_portrait_file_cli_roundtrip(tmp_path: Path):
    root = tmp_path
    sheet_path = root / ".coc" / "investigators" / "ada" / "character.json"
    sheet_path.parent.mkdir(parents=True)
    sheet_path.write_text(
        json.dumps(_portrait_chargen_sheet(), ensure_ascii=False),
        encoding="utf-8",
    )
    projected = coc_character.apply_generated_portrait_file(
        root=root,
        investigator_id="ada",
        payload={
            "asset_path": ".coc/investigators/ada/portraits/n1.png",
            "source": "sheet_concept",
            "prompt": "constructed look",
            "generated_at": "2026-08-21T12:00:00Z",
            "tool": "grok-imagine-image-2.0",
            "host": "pi-coc",
        },
    )
    saved = json.loads(sheet_path.read_text(encoding="utf-8"))
    assert saved["portrait"]["asset_path"] == ".coc/investigators/ada/portraits/n1.png"
    assert saved["portrait"]["prompt"] == "constructed look"
    assert projected["portrait_status"] == "generated"
    assert "prompt" not in projected
    rc = coc_character.main([
        "record-generated-portrait",
        "--root",
        str(root),
        "--investigator",
        "ada",
        "--json",
        json.dumps({
            "asset_path": ".coc/investigators/ada/portraits/n2.png",
            "source": "sheet_concept",
            "generated_at": "2026-08-21T13:00:00Z",
        }),
    ])
    assert rc == 0
    saved = json.loads(sheet_path.read_text(encoding="utf-8"))
    assert saved["portrait"]["asset_path"] == ".coc/investigators/ada/portraits/n2.png"
