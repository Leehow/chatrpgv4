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


coc_narration_style = _load(
    "coc_narration_style_test",
    "plugins/coc-keeper/scripts/coc_narration_style.py",
)


def test_style_guard_contract_requires_observable_behavior_before_interpretation():
    guard = coc_narration_style.player_visible_style_guard_contract("zh-Hans")

    assert "observable_before_interpretation" in guard["required_rules"]
    assert "rewrite_abstract_explanation_to_action" in guard["required_rules"]
    assert "crisis_scene_clarity" in guard["required_rules"]
    assert "final_prose_guard_before_output" in guard["required_rules"]
    final_pass = guard["final_output_pass"]
    assert final_pass["required"] is True
    assert final_pass["function"] == "guard_player_visible_text"
    assert final_pass["applies_to"] == "player_visible_narration_only"
    assert guard["not_for"] == ["scene_routing", "storylet_selection", "rules_adjudication"]


def test_crisis_render_contract_keeps_blocking_internal_and_natural_rendering():
    contract = coc_narration_style.crisis_scene_render_contract("zh-Hans")

    assert contract["frame_type"] == "crisis_scene_render"
    assert contract["required_slots"] == [
        "viewpoint_anchor",
        "spatial_anchor",
        "active_motion",
        "connection_or_force",
        "risk_progression",
        "visible_affordance",
        "player_entry",
    ]
    assert contract["player_visible_must_not"] == [
        "slot_labels",
        "expository_choice_summary",
        "if_then_option_dump",
    ]


def test_build_crisis_render_frame_orders_blocking_before_player_entry():
    frame = coc_narration_style.build_crisis_scene_render_frame(
        viewpoint_anchor="洛伦佐站在窄路内侧，背后是岩壁。",
        spatial_anchor="山路外侧是一道雪坡，坡边的雪壳已经开裂。",
        active_motion="押俘虏的士兵跪倒在路边，右臂被绑带猛地扯向坡外。",
        connection_or_force="绑带另一头拖着坡下的奥军俘虏；俘虏一挣，士兵的肩膀就滑出去一点。",
        risk_progression="几片雪壳从士兵身下剥落，滚下坡后迟迟听不见落底。",
        visible_affordances=[
            "滑出去的步枪横在雪里，枪背带露在外面。",
            "医疗箱的宽皮带还压在洛伦佐肩上。",
        ],
        player_entry="班长压住后面的人，给洛伦佐让出一步空间。",
    )

    assert frame["schema_version"] == 1
    assert frame["frame_type"] == "crisis_scene_render"
    assert [beat["slot"] for beat in frame["render_sequence"]] == [
        "viewpoint_anchor",
        "spatial_anchor",
        "active_motion",
        "connection_or_force",
        "risk_progression",
        "visible_affordance",
        "player_entry",
    ]
    assert coc_narration_style.validate_crisis_scene_render_frame(frame) == []


def test_validate_crisis_render_frame_requires_force_risk_and_affordance():
    frame = {
        "schema_version": 1,
        "frame_type": "crisis_scene_render",
        "render_sequence": [
            {"slot": "viewpoint_anchor", "content": "洛伦佐站在窄路内侧。"},
            {"slot": "spatial_anchor", "content": "山路外侧是一道雪坡。"},
            {"slot": "active_motion", "content": "士兵摔倒。"},
            {"slot": "player_entry", "content": "你离得最近。"},
        ],
    }

    findings = coc_narration_style.validate_crisis_scene_render_frame(frame)

    assert {finding["rule_id"] for finding in findings} == {
        "missing_connection_or_force",
        "missing_risk_progression",
        "missing_visible_affordance",
    }


def test_horror_profile_is_bounded_and_scene_override_wins_module_override():
    profile = coc_narration_style.build_horror_profile(
        {"horror_profile": {"dread": 0.3, "isolation": 0.2}},
        {"horror_tags": ["urgent", "isolated"],
         "horror_profile": {"dread": 0.8}},
        {"horror_stage": "revelation"},
    )
    assert set(profile) == {
        "dread", "uncertainty", "isolation", "helplessness",
        "body_horror", "cosmic_scale", "urgency",
    }
    assert profile["dread"] == 0.8
    assert profile["isolation"] >= 0.2
    assert all(isinstance(v, float) and 0.0 <= v <= 1.0 for v in profile.values())


def test_horror_profile_rejects_secret_or_non_numeric_overrides():
    import pytest
    with pytest.raises(ValueError):
        coc_narration_style.build_horror_profile(
            {"horror_profile": {"dread": "secret prose"}}, {}, {}
        )

def test_audit_flags_abstract_psychological_explanation():
    findings = coc_narration_style.audit_player_visible_text(
        "不是不信你，而是恐惧已经盖过了理解。"
    )

    assert findings
    assert findings[0]["rule_id"] == "abstract_psychological_explanation"
    assert findings[0]["severity"] == "rewrite"
    assert "observable behavior" in findings[0]["rewrite_directive"]


def test_audit_flags_expository_choice_summary_in_player_visible_crisis_text():
    findings = coc_narration_style.audit_player_visible_text(
        "你看清了两件事：如果直接拽俘虏，那个意军士兵会一起被拖下去；"
        "如果先解皮带，俘虏可能立刻滑落。"
    )

    assert findings
    assert findings[0]["rule_id"] == "expository_choice_summary"
    assert findings[0]["severity"] == "rewrite"


def test_audit_flags_cameraish_darkness_staging():
    findings = coc_narration_style.audit_player_visible_text(
        "布鲁诺没有回头，眼睛盯着通信壕里那段暗处。"
    )

    rule_ids = {finding["rule_id"] for finding in findings}
    assert "camera_direction_staging" in rule_ids
    assert "unnatural_spatial_phrase" in rule_ids


def test_guard_rewrites_cameraish_darkness_before_player_output():
    text = (
        "布鲁诺没有回头，眼睛盯着通信壕里那段暗处。\n"
        "“电话掩体。”他说，“最近的那个。先找个能看押俘虏的人，"
        "再问问这根线到底通到谁手里。”"
    )

    guarded = coc_narration_style.guard_player_visible_text(text)

    rule_ids = {finding["rule_id"] for finding in guarded["findings"]}
    final = guarded["final_text"]
    assert guarded["changed"] is True
    assert "camera_direction_staging" in rule_ids
    assert "unnatural_spatial_phrase" in rule_ids
    assert "眼睛盯着通信壕里那段暗处" not in final
    assert "那段暗处" not in final
    assert "布鲁诺没看你" in final
    assert "电话掩体" in final


def test_guard_preserves_foreign_source_dialogue_when_rewriting_summary_voice():
    text = "他断断续续地喊：“Nein... nicht hinunter... der Schrecken...” 这表明他还在害怕。"

    guarded = coc_narration_style.guard_player_visible_text(text)

    assert "Nein... nicht hinunter... der Schrecken..." in guarded["final_text"]
    assert "这表明" not in guarded["final_text"]


def test_audit_allows_natural_crisis_blocking_prose():
    text = (
        "窄路贴着岩壁拐过去，外侧的雪坡在风里发白。"
        "押俘虏的士兵跪倒在路边，右臂被绑带猛地扯向坡外；"
        "绑带另一头拖在坡下，俘虏的上半身卡在雪边，靴子在下面乱蹬。"
        "几片雪壳从他们身下剥落，顺着坡面滚下去，过了好一会儿才没了声音。"
    )

    assert coc_narration_style.audit_player_visible_text(text) == []


def test_audit_allows_observable_behavior_followed_by_skill_interpretation():
    text = (
        "他听见你的声音，却像没接住话，只顾往后缩，眼睛一直避开坑道。"
        "你判断他不是在装疯，他的恐惧还没退下去。"
    )

    assert coc_narration_style.audit_player_visible_text(text) == []


def test_audit_flags_passive_voice_translation_ese():
    """P1-7: passive-voice translationese (被...所 / 为...所) should be flagged."""
    findings = coc_narration_style.audit_player_visible_text(
        "他的意志被恐惧所侵蚀。"
    )

    assert findings
    rule_ids = {finding["rule_id"] for finding in findings}
    assert "passive_translation_ese" in rule_ids


def test_audit_flags_passive_voice_translation_ese_wei_construction():
    """P1-7: 为...所 form (literary passive) should also be flagged."""
    findings = coc_narration_style.audit_player_visible_text(
        "众人为这一幕所震动。"
    )

    assert findings
    rule_ids = {finding["rule_id"] for finding in findings}
    assert "passive_translation_ese" in rule_ids


def test_audit_flags_more_summary_ese():
    """P1-7: more summary-ese phrases (综上所述/由此可见/不难看出/显然/毋庸置疑)."""
    for text in (
        "综上所述，他们决定进屋。",
        "由此可见，钥匙是关键。",
        "不难看出这里有问题。",
        "显然他已经离开了。",
        "毋庸置疑，这是唯一的出路。",
    ):
        findings = coc_narration_style.audit_player_visible_text(text)
        assert findings, f"expected flag for: {text}"
        rule_ids = {finding["rule_id"] for finding in findings}
        assert "ai_summary_voice" in rule_ids, f"ai_summary_voice for: {text}"


def test_audit_flags_explanation_ese():
    """P1-7: explanation-ese (这意味着/换句话说/也就是说/简而言之)."""
    for text in (
        "这意味着他们必须立刻行动。",
        "换句话说，门锁不上。",
        "简而言之，他在说谎。",
    ):
        findings = coc_narration_style.audit_player_visible_text(text)
        assert findings, f"expected flag for: {text}"


def test_audit_flags_explanation_ese_ye_jiu_shi_shuo():
    """P1-7: 也就是说 without trailing colon is also explanation-ese."""
    findings = coc_narration_style.audit_player_visible_text(
        "也就是说，他根本没去过那里。"
    )

    assert findings


def test_audit_passive_does_not_flag_natural_bei_construction():
    """Natural short 被 clauses (not 被...所/为...所) must not over-flag."""
    text = "门被推开了，他站在门口。"

    findings = coc_narration_style.audit_player_visible_text(text)
    rule_ids = {finding["rule_id"] for finding in findings}
    assert "passive_translation_ese" not in rule_ids


def test_audit_summary_phrases_pin_xianran_substring_overmatch():
    """PIN: 显然 is matched as a literal substring, so it fires mid-sentence
    (e.g. "他显然没料到..."). This is an accepted surface-lint trade-off, NOT
    over-flagging we intend to silently change. This test pins the current
    behavior so any future tightening is a conscious decision.
    """
    text = "他显然没料到你会这么说。"

    findings = coc_narration_style.audit_player_visible_text(text)
    matches = [
        f["match"] for f in findings if f["rule_id"] == "ai_summary_voice"
    ]
    assert any("显然" in m for m in matches)
