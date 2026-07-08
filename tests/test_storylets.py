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
            "scene_tags": ["bureaucracy"],
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


def test_default_storylet_library_declares_story_functions_and_decks():
    """Packaged storylets should be explicit deck cards, not a global table."""
    library = storylets.load_storylet_library()
    offenders = []
    for item in library.get("storylets", []):
        if not item.get("story_functions") or not item.get("deck_tags"):
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


def test_reveal_need_selects_clue_delivery_deck_before_weighted_roll():
    """The scheduler chooses the story function before rolling weighted cards."""
    library = {"storylets": [
        {
            "storylet_id": "wrong-pressure",
            "family_id": "front_pressure",
            "trope_id": "watchers_close_in",
            "conflict_level": "low",
            "base_weight": 100,
            "scene_actions": ["REVEAL"],
            "eligible_scene_types": ["investigation"],
            "horror_stage": ["wrongness"],
            "story_functions": ["front_pressure"],
            "deck_tags": ["front_pressure"],
            "requires": {"active_front": True},
            "serves": {"mainline": True, "can_tick_front": True},
            "cue": "邪教警戒突然推进。",
        },
        {
            "storylet_id": "right-clue",
            "family_id": "clue_delivery",
            "trope_id": "misfiled_record",
            "conflict_level": "low",
            "base_weight": 1,
            "scene_actions": ["REVEAL"],
            "eligible_scene_types": ["investigation"],
            "horror_stage": ["wrongness"],
            "story_functions": ["clue_delivery"],
            "deck_tags": ["clue_delivery", "investigation"],
            "requires": {"unrevealed_clue": True},
            "serves": {"mainline": True, "can_reveal_clue": True},
            "cue": "线索换一种方式出现。",
        },
    ]}

    moves = storylets.select_storylet_moves(_plan("REVEAL"), _ctx("low"), library=library, seed="need")

    assert moves[0]["storylet_id"] == "right-clue"
    assert moves[0]["story_need"]["need_id"] == "clue_delivery"
    assert moves[0]["deck_id"] == "clue_delivery"


def test_pressure_need_selects_front_pressure_deck_before_weighted_roll():
    library = {"storylets": [
        {
            "storylet_id": "wrong-clue",
            "family_id": "clue_delivery",
            "trope_id": "found_note",
            "conflict_level": "high",
            "base_weight": 100,
            "scene_actions": ["PRESSURE"],
            "eligible_scene_types": ["investigation"],
            "horror_stage": ["wrongness"],
            "story_functions": ["clue_delivery"],
            "deck_tags": ["clue_delivery"],
            "requires": {"unrevealed_clue": True},
            "serves": {"mainline": True, "can_reveal_clue": True},
            "cue": "一个无关线索突然出现。",
        },
        {
            "storylet_id": "right-front",
            "family_id": "front_pressure",
            "trope_id": "clock_tick",
            "conflict_level": "high",
            "base_weight": 1,
            "scene_actions": ["PRESSURE"],
            "eligible_scene_types": ["investigation"],
            "horror_stage": ["wrongness"],
            "story_functions": ["front_pressure"],
            "deck_tags": ["front_pressure", "pressure"],
            "requires": {"active_front": True},
            "serves": {"mainline": True, "can_tick_front": True},
            "cue": "威胁前沿兑现一个可见征兆。",
        },
    ]}
    plan = _plan("PRESSURE")
    plan["pacing_mode"] = "pressure"
    plan["pressure_moves"] = [{"clock_id": "cult-alert", "tick": 1, "visible_symptom": "有人盯上档案室"}]

    moves = storylets.select_storylet_moves(plan, _ctx("high"), library=library, seed="need")

    assert moves[0]["storylet_id"] == "right-front"
    assert moves[0]["story_need"]["need_id"] == "front_pressure"
    assert moves[0]["deck_id"] == "front_pressure"


def test_positive_fumble_infers_opportunity_need():
    ctx = _ctx("high")
    ctx["storylet_trigger"] = {"reason": "fumble", "polarity": "positive"}

    need = storylets.infer_story_need(_plan("SUBSYSTEM"), ctx)

    assert need["need_id"] == "opportunity"
    assert "opportunity" in need["candidate_decks"]
    assert need["reason"] == "fumble_positive"


def test_negative_fumble_infers_complication_need():
    ctx = _ctx("high")
    ctx["storylet_trigger"] = {"reason": "fumble", "polarity": "negative"}

    need = storylets.infer_story_need(_plan("SUBSYSTEM"), ctx)

    assert need["need_id"] == "complication"
    assert "complication" in need["candidate_decks"]
    assert need["reason"] == "fumble"


def test_positive_fumble_can_select_npc_opportunity_without_unrevealed_clue():
    ctx = _ctx("high")
    ctx["storylet_trigger"] = {"reason": "fumble", "polarity": "positive"}
    ctx["active_scene"]["scene_type"] = "exploration"
    ctx["active_scene"]["npc_ids"] = ["npc-panicked-opponent"]
    ctx["active_scene"]["available_clues"] = []

    plan = _plan("CHARACTER")
    plan["clue_policy"] = {"reveal": [], "leads": []}

    moves = storylets.select_storylet_moves(plan, ctx, seed="positive-fumble")

    assert moves
    assert moves[0]["storylet_id"] == "high-enemy-overextends"
    assert moves[0]["story_need"]["need_id"] == "opportunity"
    assert moves[0]["bound_entities"]["npc_id"] == "npc-panicked-opponent"


def test_scheduler_trace_records_candidate_filters_and_selection():
    library = {"storylets": [
        {
            "storylet_id": "wrong-pressure",
            "family_id": "front_pressure",
            "trope_id": "watchers_close_in",
            "conflict_level": "low",
            "base_weight": 100,
            "scene_actions": ["REVEAL"],
            "eligible_scene_types": ["investigation"],
            "horror_stage": ["wrongness"],
            "story_functions": ["front_pressure"],
            "deck_tags": ["front_pressure"],
            "requires": {"active_front": True},
            "serves": {"mainline": True, "can_tick_front": True},
            "cue": "邪教警戒突然推进。",
        },
        {
            "storylet_id": "right-clue",
            "family_id": "clue_delivery",
            "trope_id": "misfiled_record",
            "conflict_level": "low",
            "base_weight": 1,
            "scene_actions": ["REVEAL"],
            "eligible_scene_types": ["investigation"],
            "horror_stage": ["wrongness"],
            "story_functions": ["clue_delivery"],
            "deck_tags": ["clue_delivery", "investigation"],
            "requires": {"unrevealed_clue": True},
            "serves": {"mainline": True, "can_reveal_clue": True},
            "cue": "线索换一种方式出现。",
        },
    ]}

    move = storylets.select_storylet_moves(
        _plan("REVEAL"), _ctx("low"), library=library, seed="trace"
    )[0]

    trace = move["scheduler_trace"]
    assert trace["story_need"]["need_id"] == "clue_delivery"
    assert trace["candidate_counts"]["library_total"] == 2
    assert trace["candidate_counts"]["after_story_need_filter"] == 1
    assert trace["selected"]["storylet_id"] == "right-clue"
    assert trace["selected"]["deck_id"] == "clue_delivery"
    assert trace["rejected_examples"][0]["storylet_id"] == "wrong-pressure"
    assert trace["rejected_examples"][0]["reason"] == "deck_mismatch"


def test_seeded_storylet_selection_is_deterministic():
    first = storylets.select_storylet_moves(_plan("REVEAL"), _ctx("low"), seed="same")
    second = storylets.select_storylet_moves(_plan("REVEAL"), _ctx("low"), seed="same")
    assert first == second


def test_scene_tags_includes_storylet_tags_field():
    """P0-3 wiring: _scene_tags must read scene.storylet_tags so a storylet
    whose scene_tags match can be selected after the scene_tag_beat trigger."""
    ctx = {"active_scene": {"storylet_tags": ["opening_briefing"], "scene_type": "social"}}
    tags = storylets._scene_tags(ctx)
    assert "opening_briefing" in tags
    assert "social" in tags
