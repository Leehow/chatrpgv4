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
    assert "player_action_uptake" in guard["required_rules"]
    assert "rewrite_abstract_explanation_to_action" in guard["required_rules"]
    assert "crisis_scene_clarity" in guard["required_rules"]
    assert "final_prose_guard_before_output" in guard["required_rules"]
    final_pass = guard["final_output_pass"]
    assert final_pass["required"] is False
    assert final_pass["reviewer"] == "keeper_llm_semantic_review"
    assert final_pass["tool"] == "narration.review"
    assert final_pass["authority"] == "advisory"
    assert final_pass["hard_gate"] is False
    assert final_pass["routine_turn_policy"] == (
        "self_review_in_drafting_pass; do_not_emit_empty_review_receipt"
    )
    assert "tonal_climax" in final_pass["invoke_when"]
    assert final_pass["applies_to"] == "player_visible_narration_only"
    assert guard["not_for"] == ["scene_routing", "storylet_selection", "rules_adjudication"]
    uptake = guard["action_uptake_review"]
    assert uptake["authority"] == "advisory"
    assert uptake["hard_gate"] is False
    assert "method, target, precautions, spoken dialogue" in uptake["instruction"]


def test_repetition_policy_does_not_suppress_current_player_action_uptake():
    contract = coc_narration_style.player_facing_style_contract("zh-Hans")

    repetition = contract["repetition_policy"]
    assert repetition["current_player_action_uptake"] == "not_repetition"
    assert "current player action" in repetition["instruction"]


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
