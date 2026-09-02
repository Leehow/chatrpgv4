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
    # A list, not a map keyed by the argument names. Keyed that way the whole
    # block arrived model-side as `{}`: those names are identity-bearing, so
    # the projection held their values to the ref grammar and prose is not a
    # ref (tests/pi/chase-candidate-guidance-survives.mjs).
    requires = details["requires"]
    assert isinstance(requires, list), requires
    assert any(
        "location_refs" in row and "at least two" in row for row in requires
    ), requires


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


def test_the_refusal_says_what_went_wrong_and_where_the_refs_are(monkeypatch):
    """The model reads the message before the details.

    "chase refs must resolve to current actors and current/connected
    locations" names nothing it can act on. Two chase starts were refused that
    way in r36 -- but the refs cannot go in the message either, because Pi
    rewrites canonical ids out of error prose. So the message carries counts
    and points at the details keys that hold the refs.
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
    details = excinfo.value.details

    # The refs live in details, which is declared and projected. Naming them
    # in the message does NOT reach the Keeper: Pi rewrites canonical ids out
    # of error prose, and the first version of this fix arrived reading
    # "not present in this scene: (present:, )" -- a host-level test asserting
    # the message held the refs passed while the Keeper saw punctuation.
    assert "npc:someone-not-here" not in message, message
    assert "scene:elsewhere" not in message, message
    assert details["rejected_actor_refs"] == ["npc:someone-not-here"], details
    assert details["rejected_location_refs"] == ["scene:elsewhere"], details
    assert "npc:npc-walter-corbitt" in details["present_actor_refs"], details
    assert "scene:a" in details["connected_location_refs"], details

    # ...and the message says what went wrong and where the refs are.
    assert "1 actor ref(s) are not in this scene" in message, message
    assert "details.rejected_actor_refs" in message, message
    assert "1 location ref(s) are not connected" in message, message


def test_the_move_action_id_is_the_form_the_executor_accepts(tmp_path):
    """`chase:move` binds a host-locked action_id, and the executor holds chase
    action ids to a namespaced form -- `move:advance`, beside `hazard:<id>`
    and `barrier:<id>:<method>`, which the sibling branches bind namespaced
    already. Move alone was bound bare, so the executor refused it as
    `untrusted_chase_action` and chase:move could not be settled at all. The
    Keeper sends nothing for this decision, so nothing it did could have
    helped. Measured 2026-09-02 r40, the first run in which a chase move
    reached the executor.
    """
    import json as _json  # noqa: PLC0415

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
        campaign_id = "chase-move-probe"
        campaign_dir = tmp_path

    binding = kernel._canonical_chase_binding(
        _ChaseCtx(),
        decision_ref="decision:coc7:chase:move",
        investigator_id="thomas-hayes",
        semantic_inputs={},
    )
    assert binding["action_id"] == "move:advance", binding

    # The executor's own guard is the authority on the form; read it rather
    # than restating the string here.
    import coc_subsystem_executor  # noqa: PLC0415
    source = Path(coc_subsystem_executor.__file__).read_text(encoding="utf-8")
    assert 'payload["action_id"] != "move:advance"' in source, (
        "the executor's accepted move action id moved; this binding must follow"
    )
