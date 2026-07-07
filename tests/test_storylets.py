#!/usr/bin/env python3
from __future__ import annotations

import importlib.util


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, rel)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


storylets = _load("coc_storylets", "plugins/coc-keeper/scripts/coc_storylets.py")


def _ctx(conflict="low", ledger=None):
    return {
        "turn_number": 7,
        "structure_type": "branching_investigation",
        "storylet_policy": {"conflict_level": conflict, "seed": "fixed"},
        "active_scene": {
            "scene_id": "archive",
            "scene_type": "investigation",
            "npc_ids": ["npc-archivist"],
            "available_clues": ["clue-transfer-record"],
            "tone": ["dust", "bureaucracy"],
        },
        "world_state": {"discovered_clue_ids": []},
        "threat_fronts": {"fronts": [{"front_id": "cult-watch", "clocks": [{"clock_id": "cult-alert", "segments": 6}]}]},
        "module_meta": {"content_flags": []},
        "storylet_ledger": ledger or {},
    }


def _plan(action="REVEAL"):
    return {
        "decision_id": "d-1",
        "scene_action": action,
        "pacing_mode": "investigation",
        "clue_policy": {"reveal": ["clue-transfer-record"], "leads": []},
        "narrative_directives": {"horror_escalation_stage": "wrongness"},
        "rule_signals": {"tension_clock": {"tension_level": "low"}},
    }


def test_conflict_level_caps_storylet_selection():
    moves = storylets.select_storylet_moves(_plan("REVEAL"), _ctx("low"), seed="s")
    assert moves
    assert moves[0]["conflict_level"] == "low"
    assert moves[0]["target_conflict_level"] == "low"


def test_high_conflict_can_select_high_but_not_climax_by_default():
    plan = _plan("PRESSURE")
    plan["pacing_mode"] = "pressure"
    moves = storylets.select_storylet_moves(plan, _ctx("high"), seed="s")
    assert moves
    assert moves[0]["conflict_level"] in {"medium", "high"}
    assert moves[0]["conflict_level"] != "climax"


def test_recent_family_is_excluded_even_if_storylet_differs():
    library = {"storylets": [
        {
            "storylet_id": "a",
            "family_id": "same_family",
            "trope_id": "first",
            "conflict_level": "low",
            "base_weight": 99,
            "scene_actions": ["REVEAL"],
            "eligible_scene_types": ["investigation"],
            "horror_stage": ["wrongness"],
            "requires": {"unrevealed_clue": True},
            "serves": {"mainline": True, "can_reveal_clue": True},
            "anti_repeat": {"exclude_if_family_used_recently": True, "max_per_session": 1},
            "cue": "excluded",
        },
        {
            "storylet_id": "b",
            "family_id": "other_family",
            "trope_id": "second",
            "conflict_level": "low",
            "base_weight": 1,
            "scene_actions": ["REVEAL"],
            "eligible_scene_types": ["investigation"],
            "horror_stage": ["wrongness"],
            "requires": {"unrevealed_clue": True},
            "serves": {"mainline": True, "can_reveal_clue": True},
            "anti_repeat": {"exclude_if_family_used_recently": True, "max_per_session": 1},
            "cue": "selected",
        },
    ]}
    ctx = _ctx("low", ledger={"recent_families": ["same_family"]})
    moves = storylets.select_storylet_moves(_plan("REVEAL"), ctx, library=library, seed="s")
    assert moves[0]["storylet_id"] == "b"


def test_scene_can_exclude_storylet_tropes():
    library = {"storylets": [
        {
            "storylet_id": "bad-animal",
            "family_id": "ambient_anomaly",
            "trope_id": "animal_instinct",
            "conflict_level": "low",
            "base_weight": 100,
            "scene_actions": ["DEEPEN"],
            "structure_affinity": ["branching_investigation"],
            "eligible_scene_types": ["investigation"],
            "horror_stage": ["wrongness"],
            "requires": {"npc_id": False, "unrevealed_clue": False, "active_front": False},
            "serves": {"mainline": True, "theme": True},
            "cue": "附近的动物绕开某处。",
        },
        {
            "storylet_id": "good-echo",
            "family_id": "scene_echo",
            "trope_id": "repeated_image",
            "conflict_level": "low",
            "base_weight": 1,
            "scene_actions": ["DEEPEN"],
            "structure_affinity": ["branching_investigation"],
            "eligible_scene_types": ["investigation"],
            "horror_stage": ["wrongness"],
            "requires": {"npc_id": False, "unrevealed_clue": False, "active_front": False},
            "serves": {"mainline": True, "theme": True},
            "cue": "刚才的意象以无害形式重复。",
        },
    ]}
    ctx = _ctx("low")
    ctx["active_scene"]["excluded_storylet_tropes"] = ["animal_instinct"]

    moves = storylets.select_storylet_moves(
        _plan("DEEPEN"),
        ctx,
        library=library,
        seed="exclude-animal",
    )

    assert moves[0]["storylet_id"] == "good-echo"


def test_unanchored_generic_storylet_is_not_selected():
    """A storylet with no current-scene anchor should not be forced onto play."""
    library = {"storylets": [{
        "storylet_id": "generic-anywhere",
        "family_id": "generic_pressure",
        "trope_id": "generic_delay",
        "conflict_level": "low",
        "base_weight": 100,
        "scene_actions": ["DEEPEN"],
        "eligible_scene_types": ["any"],
        "horror_stage": ["wrongness"],
        "requires": {"npc_id": False, "unrevealed_clue": False, "active_front": False},
        "serves": {"theme": True},
        "cue": "某处出现一点泛用异样。",
    }]}

    moves = storylets.select_storylet_moves(
        _plan("DEEPEN"),
        _ctx("low"),
        library=library,
        seed="generic-mismatch",
    )

    assert moves == []


def test_scene_pressure_requirement_anchors_storylet_to_current_scene():
    library = {"storylets": [{
        "storylet_id": "scene-pressure",
        "family_id": "local_pressure",
        "trope_id": "local_pressure",
        "conflict_level": "low",
        "base_weight": 1,
        "scene_actions": ["DEEPEN"],
        "eligible_scene_types": ["investigation"],
        "horror_stage": ["wrongness"],
        "requires": {"scene_pressure": True},
        "serves": {"mainline": True, "can_surface_choice": True},
        "cue": "当前场景的压力从既有危险里冒出来。",
    }]}
    ctx = _ctx("low")
    ctx["active_scene"]["pressure_moves"] = ["档案室门外有人突然停步。"]

    moves = storylets.select_storylet_moves(
        _plan("DEEPEN"),
        ctx,
        library=library,
        seed="scene-pressure",
    )

    assert moves[0]["storylet_id"] == "scene-pressure"


def test_default_storylet_library_has_current_scene_anchors():
    """Packaged storylets must declare at least one concrete binding contract."""
    library = storylets.load_storylet_library()
    offenders = []
    for item in library.get("storylets", []):
        req = item.get("requires") or {}
        anchored = (
            req.get("npc_id") is True
            or req.get("unrevealed_clue") is True
            or req.get("active_front") is True
            or req.get("scene_pressure") is True
            or bool(item.get("scene_tags"))
            or bool(item.get("anchor_contract"))
        )
        if not anchored:
            offenders.append(item.get("storylet_id"))

    assert offenders == []


def test_selected_storylet_binds_to_existing_scenario_nodes_and_updates_ledger():
    library = {"storylets": [{
        "storylet_id": "bind-clue",
        "family_id": "clue_delivery_shift",
        "trope_id": "misfiled_record",
        "conflict_level": "low",
        "base_weight": 1,
        "scene_actions": ["REVEAL"],
        "eligible_scene_types": ["investigation"],
        "horror_stage": ["wrongness"],
        "requires": {"unrevealed_clue": True},
        "serves": {"mainline": True, "can_reveal_clue": True},
        "cue": "clue cue",
    }]}
    move = storylets.select_storylet_moves(_plan("REVEAL"), _ctx("low"), library=library, seed="stable")[0]
    assert move["bound_entities"]["scene_id"] == "archive"
    assert move["bound_entities"]["clue_id"] == "clue-transfer-record"
    assert move["serves"]
    assert move["ledger_update"]["last_storylet_id"] == move["storylet_id"]
    assert move["source"] == "storylet-library.json"


def test_seeded_storylet_selection_is_deterministic():
    first = storylets.select_storylet_moves(_plan("REVEAL"), _ctx("low"), seed="same")
    second = storylets.select_storylet_moves(_plan("REVEAL"), _ctx("low"), seed="same")
    assert first == second
