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


def test_the_host_binds_only_slots_the_chase_decision_declares(tmp_path):
    """`chase_id` is a slot of start and end alone.

    The binding supplied it for every non-start suffix, and the runtime
    rejects a host-locked input the decision never declared -- as
    `unknown_semantic_input`, which reads as the Keeper's argument error for a
    value the host itself sent. Measured 2026-09-02 r36 on chase:move; hazard,
    barrier and conflict carry the same shape. Same defect as `san_before`
    across the sanity decisions.
    """
    import json as _json  # noqa: PLC0415

    # A chase the product itself wrote, trimmed to what this binding reads.
    save = tmp_path / "save"
    save.mkdir(parents=True)
    (save / "chase.json").write_text(_json.dumps({
        "status": "active",
        "revision": 3,
        "chase_id": "chase:corbitt-confrontation:thomas-hayes-vs-corbitt",
        "initiative_cursor": 0,
        "rounds": [{"dex_order": ["thomas-hayes"]}],
        "participants": [{"actor_id": "thomas-hayes", "position": 0}],
        "location_chain": [{}, {}],
    }), encoding="utf-8")

    class _ChaseCtx:
        campaign_id = "chase-slot-probe"
        campaign_dir = tmp_path

    for suffix in ("move",):
        binding = kernel._canonical_chase_binding(
            _ChaseCtx(),
            decision_ref=f"decision:coc7:chase:{suffix}",
            investigator_id="thomas-hayes",
            semantic_inputs={},
        )
        declared = kernel._declared_payload_slots(
            f"decision:coc7:chase:{suffix}"
        )
        assert "chase_id" not in declared, suffix
        assert "chase_id" not in binding, (
            f"the host sent chase:{suffix} an input it does not declare: "
            f"{sorted(binding)}"
        )
        assert binding.get("actor_id") == "thomas-hayes", binding

    assert "chase_id" in kernel._declared_payload_slots(
        "decision:coc7:chase:end"
    )


def test_the_refusal_names_which_ref_failed_not_just_that_one_did(monkeypatch):
    """The model reads the message before the details.

    "chase refs must resolve to current actors and current/connected
    locations" names nothing it can act on, and the lists that would have
    answered it were already in hand. Two chase starts were refused this way
    in r36.
    """
    with pytest.raises(kernel.ToolError) as excinfo:
        _binding(
            monkeypatch,
            {
                "actors": {
                    "investigator:thomas-hayes": {"id": "thomas-hayes"},
                    "npc:npc-walter-corbitt": {"id": "npc-walter-corbitt"},
                },
                "locations": {"scene:a": {}, "scene:b": {}},
                "actor_errors": {},
                "scene_id": "corbitt-house-ground",
            },
            {
                "quarry_refs": ["investigator:thomas-hayes"],
                "pursuer_refs": ["npc:someone-not-here"],
                "location_refs": ["scene:a", "scene:elsewhere"],
            },
        )
    message = excinfo.value.message
    assert "npc:someone-not-here" in message, message
    assert "scene:elsewhere" in message, message
    assert "npc:npc-walter-corbitt" in message, "it must name who IS present"
    assert "scene:a" in message, "and where IS connected"
