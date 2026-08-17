#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
from pathlib import Path


def _load(name: str, rel: str):
    spec = importlib.util.spec_from_file_location(name, Path(rel))
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


coc_language = _load("coc_language_dialogue_test", "plugins/coc-keeper/scripts/coc_language.py")


def _character_with_skills(skills: dict[str, int]) -> dict:
    return {"skills": skills}


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
