#!/usr/bin/env python3
"""Player-visible narration style guard for COC Keeper.

This module is a prose-quality guard, not a story router. Its pattern checks
are only smoke alarms for awkward player-facing text; they must never decide
scene meaning, storylet selection, rules adjudication, or hidden facts.
"""
from __future__ import annotations

import re
from typing import Any


_INNER_STATE_TERMS = (
    "恐惧",
    "理智",
    "理解",
    "意识",
    "潜意识",
    "本能",
    "内心",
    "心灵",
    "意志",
    "精神",
    "信任",
)
_ABSTRACT_ACTIONS = (
    "盖过",
    "压过",
    "吞没",
    "战胜",
    "取代",
    "支配",
    "淹没",
)
_AI_SUMMARY_PHRASES = (
    "基于以上信息",
    "当前目标转向",
    "二人推断",
    "这表明",
    "这说明",
    "因此可以看出",
    # Summary-ese openers that read like report/log voice rather than
    # tabletop narration.
    "综上所述",
    "由此可见",
    "不难看出",
    "显然",
    "毋庸置疑",
)
# Explanation-ese: clauses that spell out meaning/implication, which reads
# like narrator-as-lecturer rather than scene prose. Folded into the same
# finding category as expository_choice_summary (both expose logic as
# explanation). 也就是说 is already matched by _EXPOSITORY_CHOICE_SUMMARY_RES
# when followed by a colon; listing the bare phrase here also catches the
# comma/period forms.
_EXPLANATION_PHRASES = (
    "这意味着",
    "换句话说",
    "也就是说",
    "简而言之",
)
_CAMERA_DIRECTION_RE = re.compile(r"眼睛[^。！？\n]{0,12}盯着")
_UNNATURAL_SPATIAL_PHRASES = (
    "那段暗处",
    "通信壕里那段暗处",
)
# Passive-voice translationese: 被...所 / 为...所 literary passives read as
# translated prose, not natural spoken narration. Match a short inner span
# (capped to avoid swallowing whole sentences) and a fixed set of verbs that
# commonly appear in this construction. Short natural 被 clauses ("门被推开")
# are NOT matched because they lack the 所 marker.
_PASSIVE_TRANSLATION_RE = re.compile(
    r"(?:被|为)[^，。！？\n]{1,12}?所"
    r"(?:侵蚀|支配|吞没|影响|左右|笼罩|震动|惊叹|震撼|吸引|困扰|束缚|驱使|淹没)"
)
_ZH_FINAL_REWRITE_REPLACEMENTS = (
    ("布鲁诺没有回头，眼睛盯着通信壕里那段暗处。", "布鲁诺没看你，仍盯着壕沟前面的暗弯。"),
    ("没有回头，眼睛盯着通信壕里那段暗处", "没看你，仍盯着壕沟前面的暗弯"),
    ("眼睛盯着通信壕里那段暗处", "盯着壕沟前面的暗弯"),
    ("通信壕里那段暗处", "壕沟前面的暗弯"),
    ("那段暗处", "那片阴影"),
    ("眼睛盯着", "盯着"),
    ("基于以上信息，", ""),
    ("基于以上信息", ""),
    ("当前目标转向", "眼下要做的事变成"),
    ("二人推断", "你们判断"),
    ("这表明", "看得出来，"),
    ("这说明", "看得出来，"),
    ("因此可以看出", "看得出来，"),
)
_CRISIS_RENDER_REQUIRED_SLOTS = [
    "viewpoint_anchor",
    "spatial_anchor",
    "active_motion",
    "connection_or_force",
    "risk_progression",
    "visible_affordance",
    "player_entry",
]
_PLAYER_VISIBLE_MUST_NOT = [
    "slot_labels",
    "expository_choice_summary",
    "if_then_option_dump",
]
_HORROR_AXES = (
    "dread", "uncertainty", "isolation", "helplessness",
    "body_horror", "cosmic_scale", "urgency",
)
_HORROR_STAGE_BASE = {
    "wrongness": {"dread": 0.25, "uncertainty": 0.45},
    "revelation": {"dread": 0.6, "uncertainty": 0.3, "cosmic_scale": 0.45},
    "confrontation": {"dread": 0.75, "helplessness": 0.55, "urgency": 0.65},
    "aftermath": {"dread": 0.35, "isolation": 0.4},
}
_HORROR_TAG_WEIGHTS = {
    "urgent": {"urgency": 0.75},
    "isolated": {"isolation": 0.75},
    "body_horror": {"body_horror": 0.8},
    "cosmic": {"cosmic_scale": 0.8},
    "helpless": {"helplessness": 0.75},
}

_INNER_STATE_PATTERN = "|".join(re.escape(term) for term in _INNER_STATE_TERMS)
_ABSTRACT_ACTION_PATTERN = "|".join(re.escape(term) for term in _ABSTRACT_ACTIONS)
_RHETORICAL_EXPLANATION_RE = re.compile(
    rf"不是[^。！？\n]{{0,18}}而是[^。！？\n]{{0,36}}(?:{_INNER_STATE_PATTERN})"
)
_ABSTRACT_METAPHOR_RE = re.compile(
    rf"(?:{_INNER_STATE_PATTERN})[^。！？\n]{{0,8}}"
    rf"(?:{_ABSTRACT_ACTION_PATTERN})[^。！？\n]{{0,16}}"
    rf"(?:{_INNER_STATE_PATTERN})"
)
_EXPOSITORY_CHOICE_SUMMARY_RES = (
    re.compile(r"也就是说[:：]"),
    re.compile(r"你看清了(?:一|二|两|\d+)?件事[:：]"),
    re.compile(r"现在的问题是[:：]"),
    re.compile(r"如果[^。！？\n]{1,60}[；;，,][^。！？\n]{0,24}如果"),
)


def crisis_scene_render_contract(language: str = "zh-Hans") -> dict[str, Any]:
    """Return the internal render-frame contract for urgent physical scenes."""
    return {
        "language": language,
        "frame_type": "crisis_scene_render",
        "required_slots": list(_CRISIS_RENDER_REQUIRED_SLOTS),
        "render_sequence_rule": (
            "Draft with blocking slots internally, then render as natural prose: "
            "viewpoint and space first, motion next, force and worsening risk "
            "next, visible handles before the open player entry."
        ),
        "player_visible_must_not": list(_PLAYER_VISIBLE_MUST_NOT),
        "not_for": ["scene_routing", "storylet_selection", "rules_adjudication"],
    }


def _render_beat(slot: str, content: str) -> dict[str, str]:
    return {"slot": slot, "content": str(content).strip()}


def build_crisis_scene_render_frame(
    *,
    viewpoint_anchor: str,
    spatial_anchor: str,
    active_motion: str,
    connection_or_force: str,
    risk_progression: str,
    visible_affordances: list[str],
    player_entry: str,
    language: str = "zh-Hans",
) -> dict[str, Any]:
    """Build a structured render frame for urgent physical scenes.

    The frame is an intermediate drafting object. Narrators should not print
    slot labels or turn it into a visible checklist.
    """
    affordance_text = " ".join(str(item).strip() for item in visible_affordances if str(item).strip())
    return {
        "schema_version": 1,
        "language": language,
        "frame_type": "crisis_scene_render",
        "render_sequence": [
            _render_beat("viewpoint_anchor", viewpoint_anchor),
            _render_beat("spatial_anchor", spatial_anchor),
            _render_beat("active_motion", active_motion),
            _render_beat("connection_or_force", connection_or_force),
            _render_beat("risk_progression", risk_progression),
            _render_beat("visible_affordance", affordance_text),
            _render_beat("player_entry", player_entry),
        ],
        "player_visible_must_not": list(_PLAYER_VISIBLE_MUST_NOT),
    }


def validate_crisis_scene_render_frame(frame: dict[str, Any]) -> list[dict[str, Any]]:
    """Validate that a crisis render frame carries the minimum blocking data."""
    findings: list[dict[str, Any]] = []
    beats = frame.get("render_sequence") if isinstance(frame, dict) else None
    if not isinstance(beats, list):
        return [{
            "rule_id": "missing_render_sequence",
            "severity": "block",
            "detail": "crisis scene frame needs render_sequence beats",
        }]

    present = {
        str(beat.get("slot")): str(beat.get("content") or "").strip()
        for beat in beats
        if isinstance(beat, dict)
    }
    for slot in _CRISIS_RENDER_REQUIRED_SLOTS:
        if not present.get(slot):
            findings.append({
                "rule_id": f"missing_{slot}",
                "severity": "block",
                "detail": f"crisis scene render frame missing {slot}",
            })
    return findings


def build_horror_profile(
    module_meta: dict[str, Any], scene: dict[str, Any], pacing: dict[str, Any]
) -> dict[str, float]:
    """Build a bounded seven-axis profile from structured values only.

    Precedence is stage baseline, structured tags, scenario override, then
    scene override. Unknown tags and keys are ignored; malformed axis values
    fail closed instead of reaching the narrator.
    """
    profile = {axis: 0.0 for axis in _HORROR_AXES}
    stage = str(pacing.get("horror_stage") or "wrongness")
    for axis, value in _HORROR_STAGE_BASE.get(stage, _HORROR_STAGE_BASE["wrongness"]).items():
        profile[axis] = value
    tags = list(module_meta.get("horror_tags") or []) + list(scene.get("horror_tags") or [])
    for tag in tags:
        for axis, value in _HORROR_TAG_WEIGHTS.get(str(tag), {}).items():
            profile[axis] = max(profile[axis], value)
    for source in (module_meta.get("horror_profile") or {}, scene.get("horror_profile") or {}):
        if not isinstance(source, dict):
            raise ValueError("horror_profile override must be an object")
        for axis, value in source.items():
            if axis not in _HORROR_AXES:
                continue
            if not isinstance(value, (int, float)) or isinstance(value, bool):
                raise ValueError(f"horror_profile.{axis} must be numeric")
            profile[axis] = max(0.0, min(1.0, float(value)))
    return {axis: float(profile[axis]) for axis in _HORROR_AXES}


def player_visible_style_guard_contract(language: str = "zh-Hans") -> dict[str, Any]:
    """Return explicit rules for guarding player-visible narration style."""
    action_uptake_review = {
        "authority": "advisory",
        "hard_gate": False,
        "required_when": "player_commits_to_in_fiction_action_or_speech",
        "instruction": (
            "Check semantically whether the draft naturally enacts the current "
            "player action in the fiction before or alongside its outcome. "
            "Preserve the declared method, target, precautions, constraints, and "
            "meaningful spoken words without echoing the whole player message or "
            "inventing extra investigator actions. Do not require uptake for meta "
            "questions, planning, hypotheticals, or actions not yet committed."
        ),
    }
    final_output_pass = {
        "required": False,
        "reviewer": "keeper_llm_semantic_review",
        "tool": "narration.review",
        "invoke_when": [
            "long_or_multi_stage_causality",
            "multiple_speaking_npcs",
            "tonal_climax",
            "keeper_detects_possible_summary_or_translationese",
        ],
        "routine_turn_policy": "self_review_in_drafting_pass; do_not_emit_empty_review_receipt",
        "applies_to": "player_visible_narration_only",
        "not_for": ["scene_routing", "storylet_selection", "rules_adjudication"],
        "instruction": (
            "When the draft is genuinely difficult, review it semantically against the narration "
            "envelope, its action_uptake, and the style contract. Record each "
            "finding with a concrete "
            "reason through narration.review, then decide whether to rewrite. "
            "Do not classify prose by fixed phrases or keyword hits."
        ),
        "authority": "advisory",
        "hard_gate": False,
    }
    return {
        "language": language,
        "required_rules": [
            "observable_before_interpretation",
            "player_action_uptake",
            "rewrite_abstract_explanation_to_action",
            "skill_interpretation_after_visible_evidence",
            "crisis_scene_clarity",
            "final_prose_guard_before_output",
        ],
        "final_output_pass": final_output_pass,
        "action_uptake_review": action_uptake_review,
        "not_for": ["scene_routing", "storylet_selection", "rules_adjudication"],
        "instruction": (
            "Show observable behavior before interpretation. Replace abstract "
            "inner-state explanations with action, voice, posture, gaze, "
            "hesitation, or physical evidence. If a skill result justifies an "
            "interpretation, place it after visible evidence. For urgent "
            "physical scenes, draft a crisis_scene_render frame first so "
            "space, force, worsening risk, visible handles, and the player "
            "entry are clear before prose is sent. When the player has committed "
            "to an in-fiction action, make that action part of the narrated world "
            "before or alongside the settled consequence."
        ),
    }


def player_facing_style_contract(language: str = "zh-Hans") -> dict[str, Any]:
    """Return narrator-facing style constraints for player-visible prose."""
    repetition_policy = {
        "established_fact_mode": "compress",
        "current_player_action_uptake": "not_repetition",
        "repeat_foreign_dialogue": "summarize_unless_new_information",
        "expand_only_when": [
            "new_information",
            "player_asks",
            "comprehension_changes",
            "dramatic_escalation",
        ],
        "instruction": (
            "Do not restate an already established semantic fact, clue, quotation, "
            "or NPC fear in full. After it is established, summarize ongoing "
            "repetition in one short sentence. This does not apply to naturally "
            "enacting the current player action in the fictional world."
        ),
    }
    guard = player_visible_style_guard_contract(language)
    if language == "zh-Hans":
        return {
            "language": "zh-Hans",
            "register": "natural_tabletop_narration",
            "avoid": [
                "translationese",
                "ai_summary_voice",
                "log_style_summary",
                "semantic_repetition",
                "abstract_psychological_explanation",
            ],
            "prefer": [
                "short_sentences",
                "concrete_sensory_detail",
                "observable_behavior",
                "open_ended_prompt",
            ],
            "repetition_policy": repetition_policy,
            "style_guard": guard,
            "render_contract": crisis_scene_render_contract(language),
        }
    return {
        "language": language,
        "register": "natural_tabletop_narration",
        "avoid": [
            "ai_summary_voice",
            "log_style_summary",
            "semantic_repetition",
            "abstract_psychological_explanation",
        ],
        "prefer": [
            "short_sentences",
            "concrete_sensory_detail",
            "observable_behavior",
            "open_ended_prompt",
        ],
        "repetition_policy": repetition_policy,
        "style_guard": guard,
        "render_contract": crisis_scene_render_contract(language),
    }


def audit_player_visible_text(text: str, language: str = "zh-Hans") -> list[dict[str, Any]]:
    """Return style findings for drafted player-visible text.

    The checks intentionally look for surface writing habits, not game meaning.
    They are suitable for tests, reports, and pre-send rewrite prompts only.
    """
    if not text or language != "zh-Hans":
        return []

    findings: list[dict[str, Any]] = []
    for phrase in _AI_SUMMARY_PHRASES:
        if phrase in text:
            findings.append({
                "rule_id": "ai_summary_voice",
                "severity": "rewrite",
                "match": phrase,
                "rewrite_directive": (
                    "Remove report-like summary phrasing and express the same "
                    "information through scene detail or NPC speech."
                ),
            })

    for pattern in _EXPOSITORY_CHOICE_SUMMARY_RES:
        match = pattern.search(text)
        if match:
            findings.append({
                "rule_id": "expository_choice_summary",
                "severity": "rewrite",
                "match": match.group(0),
                "rewrite_directive": (
                    "Do not expose blocking or option logic as explanation. "
                    "Render the spatial setup, motion, force, worsening risk, "
                    "and visible handles as natural scene prose."
                ),
            })
            break

    for phrase in _EXPLANATION_PHRASES:
        if phrase in text:
            findings.append({
                "rule_id": "expository_choice_summary",
                "severity": "rewrite",
                "match": phrase,
                "rewrite_directive": (
                    "Do not narrate meaning or implication as explanation. "
                    "Show the consequence through scene detail, speech, or "
                    "observable behavior instead."
                ),
            })
            break

    camera_match = _CAMERA_DIRECTION_RE.search(text)
    if camera_match:
        findings.append({
            "rule_id": "camera_direction_staging",
            "severity": "rewrite",
            "match": camera_match.group(0),
            "rewrite_directive": (
                "Avoid camera-like body-part staging. Name the person and the "
                "visible focus in one natural sentence."
            ),
        })

    for phrase in _UNNATURAL_SPATIAL_PHRASES:
        if phrase in text:
            findings.append({
                "rule_id": "unnatural_spatial_phrase",
                "severity": "rewrite",
                "match": phrase,
                "rewrite_directive": (
                    "Replace vague translated spatial phrasing with a concrete "
                    "tabletop location the player can picture."
                ),
            })
            break

    passive_match = _PASSIVE_TRANSLATION_RE.search(text)
    if passive_match:
        findings.append({
            "rule_id": "passive_translation_ese",
            "severity": "rewrite",
            "match": passive_match.group(0),
            "rewrite_directive": (
                "Rewrite the literary passive (被…所/为…所) into active voice "
                "with a clear subject and concrete action."
            ),
        })

    abstract_match = _ABSTRACT_METAPHOR_RE.search(text) or _RHETORICAL_EXPLANATION_RE.search(text)
    if abstract_match:
        findings.append({
            "rule_id": "abstract_psychological_explanation",
            "severity": "rewrite",
            "match": abstract_match.group(0),
            "rewrite_directive": (
                "Rewrite to observable behavior first: action, voice, posture, "
                "gaze, hesitation, or physical evidence. Add interpretation "
                "only after visible evidence or a relevant skill result."
            ),
        })

    return findings


def guard_player_visible_text(text: str, language: str = "zh-Hans") -> dict[str, Any]:
    """Audit and lightly rewrite drafted player-visible narration.

    This is a final prose guard. It never routes story, chooses storylets,
    adjudicates rules, or infers hidden facts; it only catches known surface
    writing failures before narration leaves the Keeper.
    """
    original = "" if text is None else str(text)
    findings = audit_player_visible_text(original, language)
    final_text = original

    if language == "zh-Hans" and findings:
        for old, new in _ZH_FINAL_REWRITE_REPLACEMENTS:
            final_text = final_text.replace(old, new)
        final_text = re.sub(r"[ \t]{2,}", " ", final_text)
        final_text = re.sub(r"，([。！？])", r"\1", final_text)
        final_text = final_text.strip()

    remaining_findings = audit_player_visible_text(final_text, language)
    return {
        "schema_version": 1,
        "language": language,
        "original_text": original,
        "final_text": final_text,
        "findings": findings,
        "remaining_findings": remaining_findings,
        "changed": final_text != original,
        "passed": len(remaining_findings) == 0,
        "not_for": ["scene_routing", "storylet_selection", "rules_adjudication"],
    }
