#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest


def _load(name: str, rel: str):
    spec = importlib.util.spec_from_file_location(name, Path(rel))
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


coc_language = _load("coc_language_dialogue_test", "plugins/coc-keeper/scripts/coc_language.py")

SOURCE = "Nicht dort. Der Schrecken ist unten."
TRANSLATION = "不要去那里。恐怖在下面。"
PARTIAL = "不要去……那里。恐怖……在下面。"
GIST = "像是反复提到“下面”和“恐怖”。"
INTENT = "别往下面走，那里有危险。"
UTTERANCE = "Geht nicht hinunter. Es ist gefährlich."


def _character_with_skills(skills: dict[str, int]) -> dict:
    return {"skills": skills}


def _german(skill_value: int, *, native: bool = False) -> dict:
    if native:
        return {"skills": {"Language (Own: German)": skill_value}}
    return {"skills": {
        "Language (Own: Italian)": 64,
        "Language (Other: German)": skill_value,
    }}


def _inbound(skill_value: int, **kwargs):
    kwargs.setdefault("translation", TRANSLATION)
    kwargs.setdefault("partial_translation", PARTIAL)
    kwargs.setdefault("gist", GIST)
    return coc_language.render_foreign_dialogue_for_investigator(
        source_text=SOURCE,
        source_language="German",
        investigator=_german(skill_value),
        **kwargs,
    )


def _outbound(skill_value: int, **kwargs):
    return coc_language.render_investigator_speech_in_language(
        intended_meaning=INTENT,
        source_text=UTTERANCE,
        source_language="German",
        investigator=_german(skill_value),
        **kwargs,
    )


def test_unknown_foreign_language_shows_source_without_translation():
    character = _character_with_skills({"Language (Own: Italian)": 64})

    rendered = coc_language.render_foreign_dialogue_for_investigator(
        source_text="Nicht dort. Der Schrecken ist unten.",
        source_language="German",
        investigator=character,
        translation="不要去那里。恐怖在下面。",
        gist="下面、恐怖",
    )

    assert rendered["comprehension"] == "none"
    assert rendered["skill_value"] == 0
    assert "Nicht dort. Der Schrecken ist unten." in rendered["visible_text"]
    assert "不要去那里" not in rendered["visible_text"]
    assert "下面、恐怖" not in rendered["visible_text"]
    assert "听不懂具体意思" in rendered["visible_text"]


def test_low_language_skill_shows_source_and_gist_only():
    character = _character_with_skills({
        "Language (Own: Italian)": 64,
        "Language (Other: German)": 12,
    })

    rendered = coc_language.render_foreign_dialogue_for_investigator(
        source_text="Nicht dort. Der Schrecken ist unten.",
        source_language="German",
        investigator=character,
        translation="不要去那里。恐怖在下面。",
        gist="像是反复提到“下面”和“恐怖”。",
    )

    assert rendered["comprehension"] == "gist"
    assert rendered["skill_value"] == 12
    assert "Nicht dort. Der Schrecken ist unten." in rendered["visible_text"]
    assert "像是反复提到" in rendered["visible_text"]
    assert "不要去那里" not in rendered["visible_text"]


def test_mid_language_skill_shows_source_and_partial_translation():
    character = _character_with_skills({
        "Language (Own: Italian)": 64,
        "Language (Other: German)": 30,
    })

    rendered = coc_language.render_foreign_dialogue_for_investigator(
        source_text="Nicht dort. Der Schrecken ist unten.",
        source_language="German",
        investigator=character,
        translation="不要去那里。恐怖在下面。",
        partial_translation="不要去……那里。恐怖……在下面。",
    )

    assert rendered["comprehension"] == "partial"
    assert rendered["skill_value"] == 30
    assert "不要去……那里" in rendered["visible_text"]
    assert "不要去那里。恐怖在下面。" not in rendered["visible_text"]


def test_fluent_language_skill_can_show_full_translation():
    character = _character_with_skills({
        "Language (Own: Italian)": 64,
        "Language (Other: German)": 55,
    })

    rendered = coc_language.render_foreign_dialogue_for_investigator(
        source_text="Nicht dort. Der Schrecken ist unten.",
        source_language="German",
        investigator=character,
        translation="不要去那里。恐怖在下面。",
        gist="下面、恐怖",
    )

    assert rendered["comprehension"] == "fluent"
    assert rendered["skill_value"] == 55
    assert "Nicht dort. Der Schrecken ist unten." in rendered["visible_text"]
    assert "不要去那里。恐怖在下面。" in rendered["visible_text"]


INBOUND_BANDS = (
    (0, "unrecognized", "none", "tone_only"),
    (4, "unrecognized", "none", "tone_only"),
    (5, "identify", "none", "language_name"),
    (9, "identify", "none", "language_name"),
    (10, "simple_ideas", "gist", "gist"),
    (29, "simple_ideas", "gist", "gist"),
    (30, "transactional", "partial", "partial"),
    (49, "transactional", "partial", "partial"),
    (50, "fluent", "fluent", "full"),
    (74, "fluent", "fluent", "full"),
    (75, "native_passing", "fluent", "full"),
    (99, "native_passing", "fluent", "full"),
)


@pytest.mark.parametrize("skill_value, band, tier, layer", INBOUND_BANDS)
def test_inbound_five_band_keeps_source_and_masks_unearned_meaning(
    skill_value, band, tier, layer,
):
    rendered = _inbound(skill_value)
    assert rendered["direction"] == "inbound"
    assert rendered["source_text"] == SOURCE
    assert SOURCE in rendered["visible_text"]
    assert rendered["source_text"] != TRANSLATION
    assert rendered["ability_band"] == band
    assert rendered["comprehension"] == tier
    assert rendered["understood_layer"] == layer
    assert rendered["play_language"] == "zh-Hans"
    assert rendered["intended_meaning"] is None
    assert rendered["player_visible_source_is_not_investigator_knowledge"] is True
    assert rendered["investigator_knowledge"]["understood_text"] == rendered["understood_text"]
    assert rendered["settlement"]["ability"]["band"] == band

    if layer == "tone_only":
        assert rendered["language_name_visible"] is False
        assert "德语" not in rendered["visible_text"]
        assert GIST not in rendered["visible_text"]
        assert TRANSLATION not in rendered["visible_text"]
        assert PARTIAL not in rendered["visible_text"]
        assert rendered["understood_text"] is None
        assert rendered["investigator_knowledge"]["language_identified"] is False
    elif layer == "language_name":
        assert rendered["language_name_visible"] is True
        assert "德语" in rendered["visible_text"]
        assert GIST not in rendered["visible_text"]
        assert TRANSLATION not in rendered["visible_text"]
        assert PARTIAL not in rendered["visible_text"]
        assert rendered["understood_text"] is None
    elif layer == "gist":
        assert GIST in rendered["visible_text"]
        assert TRANSLATION not in rendered["visible_text"]
        assert PARTIAL not in rendered["visible_text"]
        assert rendered["understood_text"] == GIST
        assert rendered["translation_visible"] is False
    elif layer == "partial":
        assert PARTIAL in rendered["visible_text"]
        assert TRANSLATION not in rendered["visible_text"]
        assert rendered["understood_text"] == PARTIAL
        assert rendered["translation_visible"] is True
    else:
        assert TRANSLATION in rendered["visible_text"]
        assert rendered["understood_text"] == TRANSLATION
        assert rendered["translation_visible"] is True


def test_inbound_player_can_read_source_without_investigator_knowledge():
    rendered = _inbound(0)
    assert SOURCE in rendered["visible_text"]
    assert rendered["understood_text"] is None
    assert rendered["investigator_knowledge"]["understood_text"] is None
    assert rendered["player_visible_source_is_not_investigator_knowledge"] is True


def test_inbound_fluent_accent_is_structured_not_a_hard_gate():
    rendered = _inbound(50)
    assert rendered["ability_band"] == "fluent"
    assert rendered["ability"]["accent"] is True
    assert rendered["ability"]["native_passing"] is False
    assert TRANSLATION in rendered["visible_text"]
    leaked = _inbound(50, register_note="像在念祭文")
    assert "祭文" not in leaked["visible_text"]


def test_inbound_native_passing_can_show_register_not_invented_by_code():
    rendered = _inbound(75, register_note="像在念祭文")
    assert rendered["ability"]["native_passing"] is True
    assert rendered["ability"]["accent"] is False
    assert rendered["delivered_meaning_confidence"] == "native"
    assert "语域" in rendered["visible_text"]
    assert "像在念祭文" in rendered["visible_text"]
    assert rendered["source_text"] == SOURCE


def test_inbound_failure_masks_partial_and_full_to_gist():
    rendered = _inbound(30, roll_outcome="failure")
    assert rendered["realized_scope"] == "degraded"
    assert rendered["understood_layer"] == "gist"
    assert GIST in rendered["visible_text"]
    assert PARTIAL not in rendered["visible_text"]
    assert TRANSLATION not in rendered["visible_text"]
    assert rendered["accuracy"]["risk"] == "misunderstanding"
    assert rendered["accuracy"]["goal_failed"] is False
    assert rendered["delivered_meaning_confidence"] == "unreliable"
    assert rendered["source_text"] == SOURCE


def test_inbound_core_clue_failure_still_gives_gist():
    rendered = _inbound(4, roll_outcome="failure", core_clue=True)
    assert rendered["realized_scope"] == "necessary_gist"
    assert rendered["understood_layer"] == "gist"
    assert GIST in rendered["visible_text"]
    assert TRANSLATION not in rendered["visible_text"]
    assert "德语" not in rendered["visible_text"]
    assert rendered["understood_text"] == GIST
    assert rendered["settlement"]["comprehension"]["core_clue_gist_guaranteed"] is True
    assert rendered["accuracy"]["goal_failed"] is False


def test_inbound_consumes_precomputed_settle_language():
    settled = coc_language.settle_language(
        source_language="German",
        investigator=_german(12),
        medium="speech",
        roll_outcome="success",
    )
    rendered = coc_language.render_foreign_dialogue_for_investigator(
        source_text=SOURCE,
        source_language="German",
        investigator=_german(12),
        gist=GIST,
        translation=TRANSLATION,
        settled=settled,
    )
    assert rendered["settlement"] is settled
    assert rendered["ability_band"] == "simple_ideas"
    assert rendered["understood_text"] == GIST
    assert TRANSLATION not in rendered["visible_text"]


OUTBOUND_BANDS = (
    (0, "unrecognized", False, False, False),
    (4, "unrecognized", False, False, False),
    (5, "identify", False, False, False),
    (9, "identify", False, False, False),
    (10, "simple_ideas", True, True, False),
    (29, "simple_ideas", True, True, False),
    (30, "transactional", True, True, False),
    (49, "transactional", True, True, False),
    (50, "fluent", True, True, False),
    (74, "fluent", True, True, False),
    (75, "native_passing", True, False, True),
    (99, "native_passing", True, False, True),
)


@pytest.mark.parametrize(
    "skill_value, band, delivered, accent, native_passing",
    OUTBOUND_BANDS,
)
def test_outbound_five_band_keeps_intent_and_kp_utterance(
    skill_value, band, delivered, accent, native_passing,
):
    rendered = _outbound(skill_value)
    assert rendered["direction"] == "outbound"
    assert rendered["source_text"] == UTTERANCE
    assert rendered["intended_meaning"] == INTENT
    assert rendered["delivered_meaning"] == INTENT
    assert rendered["ability_band"] == band
    assert rendered["player_visible_source_is_not_investigator_knowledge"] is True
    assert rendered["delivery"]["utterance_delivered"] is delivered
    assert rendered["delivery"]["accent_visible"] is accent
    assert rendered["delivery"]["native_passing"] is native_passing
    assert rendered["delivery"]["wrong_word_risk"] is False
    assert INTENT in rendered["visible_text"]
    if delivered:
        assert UTTERANCE in rendered["visible_text"]
        assert rendered["delivery"]["missing_professional_phrasing"] is (band in {
            "simple_ideas", "transactional",
        })
        assert rendered["delivery"]["simplified"] is (band == "simple_ideas")
        assert rendered["delivery"]["pauses"] is (band == "simple_ideas")
    else:
        assert UTTERANCE not in rendered["visible_text"]
        if band == "identify":
            assert "德语" in rendered["visible_text"]
            assert rendered["delivery"]["pauses"] is True
        else:
            assert "德语" not in rendered["visible_text"]


def test_outbound_fluent_accent_visible_without_rewriting_intent():
    rendered = _outbound(50)
    assert rendered["delivery"]["accent_visible"] is True
    assert rendered["delivery"]["native_passing"] is False
    assert "母语" in rendered["visible_text"]
    assert rendered["intended_meaning"] == INTENT
    assert rendered["source_text"] == UTTERANCE


def test_outbound_native_passing_hides_accent():
    rendered = _outbound(75)
    assert rendered["delivery"]["native_passing"] is True
    assert rendered["delivery"]["accent_visible"] is False
    assert rendered["delivered_meaning_confidence"] == "native"
    assert "母语者" in rendered["visible_text"]
    own = coc_language.render_investigator_speech_in_language(
        intended_meaning=INTENT,
        source_text=UTTERANCE,
        source_language="German",
        investigator=_german(40, native=True),
    )
    assert own["ability_band"] == "native_passing"
    assert own["delivery"]["native_passing"] is True
    assert own["delivery"]["accent_visible"] is False


def test_outbound_failure_is_risk_not_invented_mistranslation():
    rendered = _outbound(30, roll_outcome="failure")
    assert rendered["intended_meaning"] == INTENT
    assert rendered["delivered_meaning"] == INTENT
    assert rendered["source_text"] == UTTERANCE
    assert rendered["delivery"]["wrong_word_risk"] is True
    assert rendered["delivered_meaning_confidence"] == "unreliable"
    assert rendered["accuracy"]["risk"] == "misunderstanding"
    assert rendered["accuracy"]["goal_failed"] is False
    assert "风险" in rendered["visible_text"]
    assert "别往上面走" not in rendered["visible_text"]
    assert rendered["visible_text"].count(INTENT) == 1


def test_renderer_does_not_translate_or_scan_source_text():
    inbound = coc_language.render_foreign_dialogue_for_investigator(
        source_text=SOURCE,
        source_language="German",
        investigator=_german(0),
    )
    assert inbound["source_text"] == SOURCE
    assert TRANSLATION not in inbound["visible_text"]
    assert inbound["understood_text"] is None
    outbound = coc_language.render_investigator_speech_in_language(
        intended_meaning=INTENT,
        source_text=UTTERANCE,
        source_language="German",
        investigator=_german(12),
    )
    assert outbound["source_text"] == UTTERANCE
    assert outbound["intended_meaning"] == INTENT
    assert "Geht nicht" in outbound["visible_text"]


def test_player_facing_names_prefer_long_forms_and_ascii_boundaries():
    terms = coc_language.resolved_localized_terms("zh-Hans")
    assert terms["Steven Knott"] == "史蒂文·诺特"
    assert terms["Knott"] == "诺特"
    assert terms["Macario"] == "马卡里奥"
    assert coc_language.player_facing_display_name(
        "Steven Knott", "zh-Hans"
    ) == "史蒂文·诺特"
    prose = "Knott nodded. Macario waited. Knotting stayed English. roll-id-Knott-1."
    localized = coc_language.localize_terms(prose, terms)
    assert "诺特 nodded" in localized
    assert "马卡里奥 waited" in localized
    assert "Knotting stayed English" in localized
    assert "roll-id-Knott-1" in localized
    overridden = coc_language.resolved_localized_terms(
        "zh-Hans",
        {"localized_terms": {"zh-Hans": {"Steven Knott": "测试史蒂文"}}},
    )
    assert overridden["Steven Knott"] == "测试史蒂文"
