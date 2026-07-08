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


def player_visible_style_guard_contract(language: str = "zh-Hans") -> dict[str, Any]:
    """Return explicit rules for guarding player-visible narration style."""
    return {
        "language": language,
        "required_rules": [
            "observable_before_interpretation",
            "rewrite_abstract_explanation_to_action",
            "skill_interpretation_after_visible_evidence",
            "crisis_scene_clarity",
        ],
        "not_for": ["scene_routing", "storylet_selection", "rules_adjudication"],
        "instruction": (
            "Show observable behavior before interpretation. Replace abstract "
            "inner-state explanations with action, voice, posture, gaze, "
            "hesitation, or physical evidence. If a skill result justifies an "
            "interpretation, place it after visible evidence. For urgent "
            "physical scenes, draft a crisis_scene_render frame first so "
            "space, force, worsening risk, visible handles, and the player "
            "entry are clear before prose is sent."
        ),
    }


def player_facing_style_contract(language: str = "zh-Hans") -> dict[str, Any]:
    """Return narrator-facing style constraints for player-visible prose."""
    repetition_policy = {
        "established_fact_mode": "compress",
        "repeat_foreign_dialogue": "summarize_unless_new_information",
        "expand_only_when": [
            "new_information",
            "player_asks",
            "comprehension_changes",
            "dramatic_escalation",
        ],
        "instruction": (
            "Do not restate the same semantic fact, quote, clue, or NPC fear in full. "
            "After it is established, summarize ongoing repetition in one short sentence."
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
