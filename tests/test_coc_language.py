#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import inspect
import json
from pathlib import Path

import pytest


def _load(name: str, rel: str):
    spec = importlib.util.spec_from_file_location(name, Path(rel))
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


coc_language = _load("coc_language_core_test", "plugins/coc-keeper/scripts/coc_language.py")

WEAPONS_PATH = Path("plugins/coc-keeper/rulesets/coc7/rules-json/weapons.json")
WEAPON_CHROME = {
    "zh-Hans": {
        "weapon_mechanics_unavailable": "武器参数未配置",
        "weapon_range": "射程",
        "weapon_ammo": "弹药",
    },
    "en-US": {
        "weapon_mechanics_unavailable": "Weapon mechanics unavailable",
        "weapon_range": "Range",
        "weapon_ammo": "Ammo",
    },
    "ja-JP": {
        "weapon_mechanics_unavailable": "武器データ未設定",
        "weapon_range": "射程",
        "weapon_ammo": "弾薬",
    },
}


BOUNDARY_CASES = (
    (0, "unrecognized", "none"),
    (4, "unrecognized", "none"),
    (5, "identify", "none"),
    (9, "identify", "none"),
    (10, "simple_ideas", "gist"),
    (29, "simple_ideas", "gist"),
    (30, "transactional", "partial"),
    (49, "transactional", "partial"),
    (50, "fluent", "fluent"),
    (74, "fluent", "fluent"),
    (75, "native_passing", "fluent"),
    (99, "native_passing", "fluent"),
)


@pytest.mark.parametrize("play_language", ("zh-Hans", "en-US", "ja-JP"))
def test_weapon_chrome_is_canonical_for_each_supported_play_language(
    play_language: str,
) -> None:
    chrome = coc_language.table_mechanics_labels(play_language)
    assert {key: chrome.get(key) for key in WEAPON_CHROME[play_language]} == (
        WEAPON_CHROME[play_language]
    )


@pytest.mark.parametrize("play_language", ("zh-Hans", "ja-JP"))
def test_every_exact_weapon_catalog_skill_has_a_localized_table_label(
    play_language: str,
) -> None:
    payload = json.loads(WEAPONS_PATH.read_text(encoding="utf-8"))
    skills = {
        str(spec["skill"])
        for spec in payload["weapons"].values()
        if isinstance(spec, dict) and spec.get("skill")
    }
    terms = coc_language.default_localized_terms(play_language)

    assert skills <= terms.keys()
    for skill in skills:
        assert coc_language.player_facing_skill_label(
            skill, play_language, terms=terms
        ) != skill


def test_five_band_thresholds_match_rulebook():
    assert coc_language.LANGUAGE_ABILITY_THRESHOLDS == {
        "identify": 5,
        "simple_ideas": 10,
        "transactional": 30,
        "fluent": 50,
        "native_passing": 75,
    }
    assert not hasattr(coc_language, "LANGUAGE_FAMILIES")


@pytest.mark.parametrize("skill_value, band, render_tier", BOUNDARY_CASES)
def test_ability_band_boundaries(skill_value, band, render_tier):
    facts = coc_language.language_ability_facts(skill_value)
    assert facts["band"] == band
    assert coc_language.language_ability_band(skill_value) == band
    assert coc_language.dialogue_comprehension_tier(skill_value) == render_tier
    assert facts["identifies_without_roll"] is (skill_value >= 5)
    assert facts["simple_ideas"] is (skill_value >= 10)
    assert facts["transactional"] is (skill_value >= 30)
    assert facts["fluent"] is (skill_value >= 50)
    assert facts["native_passing"] is (skill_value >= 75)
    assert facts["accent"] is (skill_value >= 10 and skill_value < 75)


def test_zero_to_four_cannot_identify_by_language_skill():
    for value in (0, 1, 4):
        settled = coc_language.settle_language(
            source_language="German",
            skill_value=value,
            medium="speech",
        )
        assert settled["recognized"] is False
        assert settled["recognition"]["by_language_skill"] is False
        assert settled["recognition"]["requires_other_route"] is True
        assert settled["ability"]["band"] == "unrecognized"

    identified = coc_language.settle_language(
        source_language="German",
        skill_value=5,
        medium="speech",
    )
    assert identified["recognized"] is True
    assert identified["recognition"]["by_language_skill"] is True
    assert identified["recognition"]["route"] == "language_skill"
    assert identified["ability"]["band"] == "identify"


def test_native_own_language_is_native_passing_and_auto_success():
    facts = coc_language.language_ability_facts(40, native=True)
    assert facts["band"] == "native_passing"
    assert facts["native_passing"] is True
    assert facts["accent"] is False
    settled = coc_language.settle_language(
        source_language="Italian",
        skill_value=40,
        native=True,
        medium="speech",
        difficulty="regular",
    )
    assert settled["check"]["automatic_success"] is True
    assert settled["check"]["needed"] is False
    assert settled["recognized"] is True
    assert settled["comprehension"]["realized_scope"] == "native_passing"


def test_fluent_regular_speech_is_automatic_success():
    settled = coc_language.settle_language(
        source_language="German",
        skill_value=50,
        medium="speech",
        difficulty="regular",
    )
    assert settled["ability"]["fluent"] is True
    assert settled["ability"]["native_passing"] is False
    assert settled["ability"]["accent"] is True
    assert settled["check"]["automatic_success"] is True
    assert settled["check"]["needed"] is False
    assert settled["check"]["roll_outcome"] == "auto_success"
    assert settled["comprehension"]["realized_scope"] == "fluent"


@pytest.mark.parametrize("difficulty", ("regular", "hard", "extreme"))
def test_written_material_needs_the_supplied_difficulty(difficulty):
    settled = coc_language.settle_language(
        source_language="Latin",
        skill_value=55,
        medium="writing",
        difficulty=difficulty,
    )
    assert settled["check"]["needed"] is True
    assert settled["check"]["automatic_success"] is False
    assert settled["check"]["difficulty"] == difficulty
    assert settled["check"]["covers_coherent_corpus"] is True
    assert settled["comprehension"]["realized_scope"] == "pending"


def test_hard_speech_still_needs_a_check_when_fluent():
    settled = coc_language.settle_language(
        source_language="German",
        skill_value=60,
        medium="speech",
        difficulty="hard",
    )
    assert settled["check"]["needed"] is True
    assert settled["check"]["difficulty"] == "hard"
    assert settled["check"]["automatic_success"] is False


def test_success_realizes_ability_scope():
    settled = coc_language.settle_language(
        source_language="German",
        skill_value=30,
        medium="speech",
        difficulty="regular",
        roll_outcome="regular_success",
        roll_receipt={"outcome": "regular_success", "roll": 22},
    )
    assert settled["comprehension"]["ability_scope"] == "transactional"
    assert settled["comprehension"]["realized_scope"] == "transactional"
    assert settled["accuracy"]["reliability"] == "transactional"
    assert settled["accuracy"]["risk"] == "none"
    assert settled["accuracy"]["goal_failed"] is False
    assert settled["check"]["roll_receipt"]["roll"] == 22
    assert settled["check"]["roll_settled"] is True


def test_failure_does_not_delete_ability_or_mark_goal_failed():
    settled = coc_language.settle_language(
        source_language="German",
        skill_value=30,
        medium="speech",
        difficulty="regular",
        roll_outcome="failure",
    )
    assert settled["comprehension"]["ability_scope"] == "transactional"
    assert settled["comprehension"]["realized_scope"] == "degraded"
    assert settled["accuracy"]["reliability"] == "unreliable"
    assert settled["accuracy"]["risk"] == "misunderstanding"
    assert settled["accuracy"]["goal_failed"] is False
    assert settled["time"]["guidance"] == "extra_time"
    assert settled["time"]["advisory"] is True


def test_core_clue_failure_keeps_necessary_gist():
    settled = coc_language.settle_language(
        source_language="German",
        skill_value=4,
        medium="writing",
        difficulty="regular",
        roll_outcome="failure",
        core_clue=True,
    )
    assert settled["comprehension"]["core_clue_gist_guaranteed"] is True
    assert settled["comprehension"]["realized_scope"] == "necessary_gist"
    assert settled["accuracy"]["reliability"] == "degraded"
    assert settled["accuracy"]["risk"] == "precision_time_or_safety"
    assert settled["accuracy"]["goal_failed"] is False


def test_core_clue_unsettled_check_still_guarantees_gist():
    settled = coc_language.settle_language(
        source_language="Aklo",
        skill_value=0,
        medium="writing",
        difficulty="extreme",
        core_clue=True,
    )
    assert settled["comprehension"]["realized_scope"] == "necessary_gist"
    assert settled["comprehension"]["core_clue_gist_guaranteed"] is True
    assert settled["recognized"] is False


def test_pushed_failure_lists_candidates_and_selects_none():
    settled = coc_language.settle_language(
        source_language="German",
        skill_value=12,
        medium="speech",
        difficulty="regular",
        roll_outcome="failure",
        pushed=True,
    )
    assert settled["push"]["pushed"] is True
    assert settled["push"]["method_candidates"] == list(
        coc_language.LANGUAGE_PUSH_METHOD_CANDIDATES
    )
    assert settled["push"]["failure_consequence_candidates"] == list(
        coc_language.LANGUAGE_PUSHED_FAILURE_CANDIDATES
    )
    assert settled["push"]["selected_method"] is None
    assert settled["push"]["selected_consequence"] is None
    assert settled["accuracy"]["risk"] == "pushed_failure"
    assert settled["time"]["guidance"] == "extra_time"


def test_pushed_failure_on_core_clue_does_not_drop_gist():
    settled = coc_language.settle_language(
        source_language="German",
        skill_value=12,
        medium="speech",
        difficulty="regular",
        roll_outcome="fumble",
        pushed=True,
        core_clue=True,
    )
    assert settled["comprehension"]["realized_scope"] == "necessary_gist"
    assert settled["push"]["selected_consequence"] is None
    assert settled["check"]["exceptional"] is True
    assert settled["accuracy"]["risk"] == "precision_time_or_safety"


@pytest.mark.parametrize(
    "route",
    ("know", "archaeology", "history", "cthulhu_mythos", "occult"),
)
def test_recognition_other_routes_are_kp_decided(route):
    missed = coc_language.settle_language(
        source_language="Hyperborean",
        skill_value=0,
        medium="inscription",
        recognition_route=route,
        recognition_result="failure",
    )
    assert missed["recognized"] is False
    assert missed["recognition"]["route"] == route
    assert missed["recognition"]["requires_other_route"] is True

    found = coc_language.settle_language(
        source_language="Hyperborean",
        skill_value=0,
        medium="inscription",
        recognition_route=route,
        recognition_result="success",
    )
    assert found["recognized"] is True
    assert found["recognition"]["route"] == route
    assert found["comprehension"]["ability_scope"] == "unrecognized"
    assert found["comprehension"]["realized_scope"] == "pending"


def test_one_check_covers_coherent_corpus():
    first = coc_language.settle_language(
        source_language="Latin",
        skill_value=45,
        medium="writing",
        difficulty="hard",
        roll_outcome="hard_success",
        corpus_id="liber-ivonis",
    )
    second = coc_language.settle_language(
        source_language="Latin",
        skill_value=45,
        medium="writing",
        difficulty="hard",
        roll_outcome="hard_success",
        corpus_id="liber-ivonis",
    )
    assert first["check"]["covers_coherent_corpus"] is True
    assert second["check"]["covers_coherent_corpus"] is True
    assert first["check"]["corpus_id"] == "liber-ivonis"
    assert first["check"]["corpus_id"] == second["check"]["corpus_id"]


def test_translator_and_keeper_duration_are_advisory_time_facts():
    translated = coc_language.settle_language(
        source_language="Aklo",
        skill_value=0,
        medium="writing",
        time_context={"translator": True},
    )
    assert translated["time"]["guidance"] == "translator_pace"
    assert translated["time"]["translator"] is True
    assert translated["time"]["advisory"] is True

    specified = coc_language.settle_language(
        source_language="Latin",
        skill_value=50,
        medium="writing",
        difficulty="hard",
        time_context={"keeper_duration": "a few days"},
    )
    assert specified["time"]["guidance"] == "keeper_specified"
    assert specified["time"]["keeper_duration"] == "a few days"


def test_settle_language_does_not_accept_or_scan_source_text():
    signature = inspect.signature(coc_language.settle_language)
    assert "source_text" not in signature.parameters
    with pytest.raises(TypeError):
        coc_language.settle_language(
            source_language="Latin",
            skill_value=0,
            source_text="Das ist Deutsch. Nicht dort.",
        )
    settled = coc_language.settle_language(
        source_language="Latin",
        skill_value=0,
        medium="writing",
    )
    assert settled["source_language"] == "Latin"
    assert settled["recognized"] is False


def test_source_language_is_echoed_not_rewritten_from_skill_aliases():
    investigator = {
        "skills": {
            "Language (Own: Italian)": 64,
            "Language (Other: German)": 40,
        }
    }
    settled = coc_language.settle_language(
        source_language="Latin",
        investigator=investigator,
        medium="writing",
        difficulty="regular",
        roll_outcome="failure",
    )
    assert settled["source_language"] == "Latin"
    assert settled["skill_value"] == 0
    assert settled["recognized"] is False


def test_investigator_skill_lookup_still_feeds_settlement():
    investigator = {"skills": {"Language (Other: German)": 12}}
    settled = coc_language.settle_language(
        source_language="German",
        investigator=investigator,
        medium="speech",
        difficulty="regular",
        roll_outcome="success",
    )
    assert settled["skill_value"] == 12
    assert settled["skill_key"] == "Language (Other: German)"
    assert settled["ability"]["band"] == "simple_ideas"
    assert settled["comprehension"]["realized_scope"] == "simple_ideas"


def test_explicit_skill_value_wins_over_sheet():
    investigator = {"skills": {"Language (Other: German)": 80}}
    settled = coc_language.settle_language(
        source_language="German",
        investigator=investigator,
        skill_value=4,
        medium="speech",
    )
    assert settled["skill_value"] == 4
    assert settled["ability"]["band"] == "unrecognized"
    assert settled["recognized"] is False


def test_invalid_structured_choices_are_rejected():
    with pytest.raises(ValueError, match="source_language"):
        coc_language.settle_language(source_language="  ")
    with pytest.raises(ValueError, match="medium"):
        coc_language.settle_language(source_language="German", medium="telepathy")
    with pytest.raises(ValueError, match="difficulty"):
        coc_language.settle_language(source_language="German", difficulty="easy")
    with pytest.raises(ValueError, match="recognition_route"):
        coc_language.settle_language(
            source_language="German",
            skill_value=0,
            recognition_route="family_guess",
        )
    with pytest.raises(ValueError, match="roll_outcome"):
        coc_language.settle_language(
            source_language="German",
            skill_value=30,
            roll_outcome="barely",
        )


def test_render_helper_exposes_ability_band_without_dropping_source_text():
    rendered = coc_language.render_foreign_dialogue_for_investigator(
        source_text="Nicht dort.",
        source_language="German",
        investigator={"skills": {"Language (Other: German)": 12}},
        gist="下面",
    )
    assert rendered["source_text"] == "Nicht dort."
    assert rendered["ability_band"] == "simple_ideas"
    assert rendered["comprehension"] == "gist"
    assert "Nicht dort." in rendered["visible_text"]
    assert rendered["player_visible_source_is_not_investigator_knowledge"] is True
    assert rendered["direction"] == "inbound"
