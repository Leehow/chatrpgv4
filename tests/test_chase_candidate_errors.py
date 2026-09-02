"""A chase refusal must say which list to choose from, or that none exists.

Observed live 2026-09-02. The Keeper narrated the flight, moved the scene,
then tried to start the chase — leaving the pursuer behind in the scene it
fled. `chase_candidate_invalid` said only "chase refs must resolve to current
actors and current/connected locations", with `recoverable_by: none` and no
next action, so it re-guessed the same refs and the chase family stayed at
zero live settlements. The host had both candidate lists in hand at that
point.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import coc_operation_kernel as kernel  # noqa: E402


class _Ctx:
    campaign_id = "chase-error-probe"


def _binding(monkeypatch, candidates, semantic_inputs):
    monkeypatch.setattr(
        kernel, "_chase_start_candidates", lambda *a, **k: candidates,
    )
    return kernel._canonical_chase_binding(
        _Ctx(),
        decision_ref="decision:coc7:chase:start",
        investigator_id="thomas-hayes",
        semantic_inputs=semantic_inputs,
    )


def test_a_scene_with_nobody_to_flee_says_exactly_that(monkeypatch):
    """No ref the Keeper could pass would work, so "refs must resolve" sends
    it to re-guess a set that cannot exist."""
    with pytest.raises(kernel.ToolError) as excinfo:
        _binding(
            monkeypatch,
            {
                "actors": {"investigator:thomas-hayes": {"id": "thomas-hayes"}},
                "locations": {"scene:a": {}, "scene:b": {}},
                "actor_errors": {},
                "scene_id": "corbitt-house-ground",
            },
            {
                "quarry_refs": ["investigator:thomas-hayes"],
                "pursuer_refs": ["npc:npc-walter-corbitt"],
                "location_refs": ["scene:a", "scene:b"],
            },
        )
    error = excinfo.value
    assert error.code == "chase_no_present_opponent"
    assert "corbitt-house-ground" in str(error)
    assert error.details["present_actor_refs"] == ["investigator:thomas-hayes"]
    assert "state.npc_presence" in error.details["hint"]


def test_a_wrong_ref_is_answered_with_the_right_lists(monkeypatch):
    with pytest.raises(kernel.ToolError) as excinfo:
        _binding(
            monkeypatch,
            {
                "actors": {
                    "investigator:thomas-hayes": {"id": "thomas-hayes"},
                    "npc:walter-corbitt": {"id": "walter-corbitt"},
                },
                "locations": {"scene:a": {}, "scene:b": {}},
                "actor_errors": {},
                "scene_id": "corbitt-confrontation",
            },
            {
                # the semantic handle the Keeper actually guessed
                "quarry_refs": ["investigator:current-investigator"],
                "pursuer_refs": ["npc:npc-walter-corbitt"],
                "location_refs": ["scene:a", "scene:nowhere"],
            },
        )
    details = excinfo.value.details
    assert excinfo.value.code == "chase_candidate_invalid"
    assert details["rejected_actor_refs"] == [
        "investigator:current-investigator", "npc:npc-walter-corbitt",
    ]
    assert details["rejected_location_refs"] == ["scene:nowhere"]
    assert details["present_actor_refs"] == [
        "investigator:thomas-hayes", "npc:walter-corbitt",
    ]
    assert details["connected_location_refs"] == ["scene:a", "scene:b"]
    assert "at least two" in details["requires"]["location_refs"]


def test_a_valid_start_still_binds(monkeypatch):
    binding = _binding(
        monkeypatch,
        {
            "actors": {
                "investigator:thomas-hayes": {"id": "thomas-hayes"},
                "npc:walter-corbitt": {"id": "walter-corbitt"},
            },
            "locations": {"scene:a": {}, "scene:b": {}},
            "actor_errors": {},
            "scene_id": "corbitt-confrontation",
        },
        {
            "quarry_refs": ["investigator:thomas-hayes"],
            "pursuer_refs": ["npc:walter-corbitt"],
            "location_refs": ["scene:a", "scene:b"],
        },
    )
    assert binding, "a well-formed chase start must still bind"
