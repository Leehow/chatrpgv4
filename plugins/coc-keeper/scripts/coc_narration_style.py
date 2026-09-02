#!/usr/bin/env python3
"""Player-visible narration craft contract for COC Keeper.

This module hands the Keeper a *vocabulary*: named render slots, named
prohibitions, a register of things to avoid and prefer, and the review rules a
draft may be judged against. It does not judge prose. Slice T4 deleted the
matchers that used to -- eight compiled expressions, two phrase tables and a
thirteen-pair substitution table -- because they only ran for zh-Hans, were
unreachable on the pi-coc path, and silently rewrote Keeper sentences from
fragments of one past playtest. Whether prose is good is a semantic judgment
that belongs to the Keeper; see the TextGraph contract's no_matcher_law.

The craft vocabulary lives in TextGraph and is read through coc_text_runtime.
_HORROR_* stays here and is deliberately NOT TextGraph doctrine: it is
consumed only by coc_story_director's director.advise payload.
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import coc_text_runtime  # noqa: E402  (path bootstrap must run first)


_CRAFT = coc_text_runtime.craft()
_CRISIS_RENDER_REQUIRED_SLOTS = list(_CRAFT["render_slots"])
_PLAYER_VISIBLE_MUST_NOT = list(_CRAFT["render_prohibitions"])

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
            "Check semantically whether the draft enacts the current player "
            "action as independent world-perspective prose before or alongside "
            "its outcome. Preserve the semantic facts (method, target, "
            "precautions, spoken dialogue) but verify the prose is NOT a "
            "pronoun-swapped clone of the player's sentence structure. Spoken "
            "dialogue may appear verbatim as in-fiction quotes; action "
            "description should be the KP's own narration with environment "
            "response and sensory detail. Do not require uptake for meta "
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
            directive_id.replace("-", "_")
            for directive_id, row in _CRAFT["craft_directives"].items()
            if row["declares"] == "required_rule"
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
            "repetition in one short sentence. The current player action is "
            "'not repetition' in the sense that it must be enacted (not skipped), "
            "but enacted as independent world-perspective prose — not cloned from "
            "the player's wording. The exemption means 'do narrate it'; it does "
            "not mean 'reproduce the player's sentence structure.'"
        ),
    }
    guard = player_visible_style_guard_contract(language)
    # `avoid` / `prefer` come from TextGraph (T4), not from literals here.
    # The two former language branches returned identical bodies apart from the
    # `language` value itself, so there is one body.  The field that used to
    # name the surface-smoke checks went with the matchers T4 deleted: this
    # module hands over a vocabulary and no longer judges prose.
    craft = coc_text_runtime.craft(language)
    return {
        "language": language,
        "register": "natural_tabletop_narration",
        "avoid": list(craft["avoid"]),
        "prefer": list(craft["prefer"]),
        "repetition_policy": repetition_policy,
        "style_guard": guard,
        "render_contract": crisis_scene_render_contract(language),
        # Robin Laws' nine beat types (Hamlet's Hit Points, 2010). Offered as a
        # frame for the question "what is this beat FOR", which is the question
        # that decides whether a light moment lands or grates. Naming the beat
        # is the Keeper's judgment; the host neither guesses it nor supplies a
        # line for it.
        "beat_frame": {
            "types": craft["beat_types"],
            "instruction": (
                "Before drafting, name what this beat is for. A `gratification` "
                "beat is where wit, warmth and table banter belong; a "
                "`bringdown` beat is where the same line would grate. "
                "`procedural` and `dramatic` carry most turns and are neither. "
                "This is a frame for your own judgment, not a quota: most beats "
                "want no joke at all, and a beat that wants one wants it in "
                "this NPC's voice rather than a generic quip."
            ),
        },
        "output_language": {
            "play_language": language,
            "instruction": (
                "Write every player-visible sentence in the language the player "
                "is using. The campaign's declared play_language is the default; "
                "when the player writes in another language, follow the player "
                "rather than the declared default. This is a writing "
                "instruction, not a lookup: there is no translation table to "
                "consult and no supported-language list to stay inside. "
                "Machine-facing identifiers, JSON keys, canonical skill keys, "
                "and stable ids stay canonical in every language."
            ),
        },
    }


