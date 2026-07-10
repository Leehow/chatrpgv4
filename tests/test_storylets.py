#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import random


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


def test_infer_conflict_level_reads_tension_target_not_pacing_mode():
    """R1-Z D4: climax intensity comes from tension_target, not pacing_mode."""
    ctx = _ctx("low")
    ctx["storylet_policy"] = {"seed": "fixed"}  # no explicit conflict_level
    plan = _plan("REVEAL")
    plan["pacing_mode"] = "investigation"
    plan["tension_target"] = "climax"
    assert storylets.infer_conflict_level(plan, ctx) == "climax"

    plan2 = _plan("REVEAL")
    plan2["pacing_mode"] = "investigation"
    plan2["tension_target"] = "low"
    assert storylets.infer_conflict_level(plan2, ctx) == "low"


def test_bind_storylet_requires_explicit_true_flags():
    """R1-Z E5a: missing/non-bool requires flags must not auto-bind."""
    storylet = {
        "storylet_id": "opt",
        "requires": {"npc_id": "maybe", "unrevealed_clue": 1},
    }
    plan = _plan("REVEAL")
    ctx = _ctx("low")
    bound = storylets._bind_storylet(storylet, plan, ctx, random.Random(1))
    assert bound["npc_id"] is None
    assert bound["clue_id"] is None

    storylet_true = {
        "storylet_id": "req",
        "requires": {"npc_id": True, "unrevealed_clue": True},
    }
    bound_true = storylets._bind_storylet(storylet_true, plan, ctx, random.Random(1))
    assert bound_true["npc_id"] == "npc-archivist"
    assert bound_true["clue_id"] == "clue-transfer-record"


def test_max_per_session_resets_when_session_number_advances(tmp_path):
    """R1-Z E5b: max_per_session is scoped to the current session_number."""
    library = {"storylets": [{
        "storylet_id": "once-a",
        "family_id": "fam-a",
        "trope_id": "trope-a",
        "conflict_level": "low",
        "base_weight": 10,
        "scene_actions": ["REVEAL"],
        "eligible_scene_types": ["investigation"],
        "horror_stage": ["wrongness"],
        "requires": {"unrevealed_clue": True},
        "serves": {"mainline": True, "can_reveal_clue": True},
        "anti_repeat": {"max_per_session": 1, "exclude_if_family_used_recently": False},
        "cue": "once",
        "story_functions": ["clue_delivery"],
        "deck_tags": ["clue_delivery", "investigation"],
    }]}
    camp = tmp_path / "campaigns" / "sess"
    (camp / "save").mkdir(parents=True)
    ledger = {
        "session_number": 1,
        "used_storylets": [{"storylet_id": "once-a", "session_number": 1}],
    }
    assert storylets._repeat_penalty(library["storylets"][0], ledger) == 0.0

    storylets.start_new_session(camp)
    ledger2 = json.loads((camp / "save" / "storylet-ledger.json").read_text())
    assert ledger2["session_number"] == 2
    # Carry prior uses forward; new session must ignore session-1 counts.
    ledger2["used_storylets"] = ledger["used_storylets"]
    assert storylets._repeat_penalty(library["storylets"][0], ledger2) == 1.0
    moves = storylets.select_storylet_moves(
        _plan("REVEAL"), _ctx("low", ledger=ledger2), library=library, seed="sess2",
    )
    assert moves and moves[0]["storylet_id"] == "once-a"


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


def test_load_storylet_library_rejects_bad_setting_tags_shape(tmp_path):
    """Malformed setting_tags in a library file must fail loudly on load."""
    import pytest

    lib_path = tmp_path / "storylet-library.json"
    lib_path.write_text(json.dumps({
        "schema_version": 1,
        "storylets": [
            {"storylet_id": "bad-tags", "setting_tags": "military"},
        ],
    }), encoding="utf-8")
    with pytest.raises(ValueError, match="bad-tags.*setting_tags"):
        storylets.load_storylet_library(lib_path)

    lib_path.write_text(json.dumps({
        "schema_version": 1,
        "storylets": [
            {"storylet_id": "bad-items", "setting_tags": ["military", 3, ""]},
        ],
    }), encoding="utf-8")
    with pytest.raises(ValueError, match="bad-items.*setting_tags"):
        storylets.load_storylet_library(lib_path)


def test_load_storylet_library_accepts_good_or_absent_setting_tags(tmp_path):
    lib_path = tmp_path / "storylet-library.json"
    lib_path.write_text(json.dumps({
        "schema_version": 1,
        "storylets": [
            {"storylet_id": "neutral"},
            {"storylet_id": "military-beat", "setting_tags": ["military", "wilderness"]},
            {"storylet_id": "empty-ok", "setting_tags": []},
        ],
    }), encoding="utf-8")
    library = storylets.load_storylet_library(lib_path)
    assert len(library["storylets"]) == 3


def test_default_storylet_library_declares_story_functions_and_decks():
    """Packaged storylets should be explicit deck cards, not a global table."""
    library = storylets.load_storylet_library()
    offenders = []
    for item in library.get("storylets", []):
        if not item.get("story_functions") or not item.get("deck_tags"):
            offenders.append(item.get("storylet_id"))

    assert offenders == []


def test_shipped_library_has_early_horror_craft_tropes():
    """W1-5: mundane_expectation_break + cognitive_dissonance tropes (p.207-211)."""
    library = storylets.load_storylet_library()
    required_fields = {
        "storylet_id", "title", "family_id", "trope_id", "conflict_level",
        "base_weight", "scene_actions", "horror_stage", "requires", "serves",
        "anti_repeat", "cue", "beat", "effects", "story_functions", "deck_tags",
    }
    for trope in ("mundane_expectation_break", "cognitive_dissonance"):
        matches = [s for s in library["storylets"] if s.get("trope_id") == trope]
        assert len(matches) >= 3, f"expected >=3 storylets for trope {trope}"
        for item in matches:
            missing = required_fields - set(item)
            assert not missing, f"{item.get('storylet_id')} missing {sorted(missing)}"
            req = item.get("requires") or {}
            anchored = (
                req.get("npc_id") is True
                or req.get("unrevealed_clue") is True
                or req.get("active_front") is True
                or req.get("scene_pressure") is True
                or bool(item.get("scene_tags"))
                or bool(item.get("anchor_contract"))
            )
            assert anchored, f"{item.get('storylet_id')} lacks a scene anchor"
            assert item.get("story_functions") and item.get("deck_tags")


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


def test_opening_briefing_storylet_selected_on_scene_entry():
    """S7: a storylet with scene_tags matching the scene's storylet_tags must
    be selectable when the scene is entered. Verifies S1 (matcher) + S6 (tags)
    + this task (library data) compose end-to-end."""
    library = {
        "schema_version": 1, "description": "test", "conflict_levels": ["low","medium","high","climax"],
        "selection_contract": [], "storylets": [
            {
                "storylet_id": "opening-briefing-tell-not-ask",
                "title": "简报里的沉默", "family_id": "opening_tension", "trope_id": "withheld_mission_truth",
                "conflict_level": "low", "conflict_score": 1, "base_weight": 1.0,
                "dramatic_function": ["CHARACTER","DEEPEN"], "scene_actions": ["CHARACTER","DEEPEN"],
                "scope": "scene",
                "structure_affinity": ["linear_acts","branching_investigation","hub_sandbox","hybrid_mega"],
                "eligible_scene_types": ["social"],
                "horror_stage": ["ordinary","wrongness"],
                "scene_tags": ["opening_briefing"],
                "requires": {"npc_id": True, "unrevealed_clue": False, "active_front": False},
                "serves": {"mainline": True, "can_deepen_npc": True, "can_surface_choice": True},
                "anti_repeat": {"cooldown_turns": 12, "max_per_session": 1, "exclude_if_family_used_recently": True, "exclude_if_trope_used_recently": False},
                "cue": "下达命令的人把真相咽回去半句，眼神在地图上多停了一拍。",
                "beat": "在简报里埋下'这次任务没说全'的张力，给玩家追问的抓手。",
                "effects": {"narrative_move": "在简报里埋下张力。", "clue_handling": "May foreshadow a withheld clue; never reveals it.", "pressure": "No automatic clock tick.", "choice": "Surface as a visible doubt or dilemma."},
                "variants": {"sensory_detail_1d6": ["指挥官的指节在桌沿泛白。","地图边角的批注被刻意压在茶杯下。","传令兵在门口多站了一拍才退下。","炉火里的松枝爆出一声脆响。","窗外风雪忽然盖住后半句话。","副官与军士交换了一个极短的眼神。"], "complication_1d6": ["一名老兵忽然沉默。","补给清单上少了一项关键物资。","任务的返回时间被说得含糊。","有人在简报结束后欲言又止。","地图上有个不该出现的标记。","上级的命令落款时间对不上。"]},
                "narration_directive": "把疑点绑定到简报现场的具体人或物；只埋张力，不揭示被隐瞒的真相。",
                "story_functions": ["character_beat","theme_echo"],
                "deck_tags": ["character_beat","npc","relationship","theme_echo","social","opening"],
            },
        ],
    }
    ctx = {
        "turn_number": 0,
        "structure_type": "linear_acts",
        "storylet_policy": {"conflict_level": "low", "seed": "s7"},
        "active_scene": {"scene_id": "mission-briefing", "scene_type": "social",
                         "storylet_tags": ["opening_briefing"], "npc_ids": ["npc-company-commander"],
                         "available_clues": [], "tone": ["cold"]},
        "world_state": {"discovered_clue_ids": []},
        "threat_fronts": {"fronts": []},
        "module_meta": {"content_flags": []},
        "storylet_ledger": {},
    }
    plan = {"decision_id":"d-s7","scene_action":"CHARACTER","pacing_mode":"social",
            "clue_policy": {"reveal": [], "leads": []},
            "narrative_directives": {"horror_escalation_stage": "ordinary"},
            "rule_signals": {"tension_clock": {"tension_level": "low"}}}
    moves = storylets.select_storylet_moves(plan, ctx, library=library, seed="s7")
    assert moves, "expected the opening-briefing storylet to be selected"
    assert moves[0]["storylet_id"] == "opening-briefing-tell-not-ask"


def test_shipped_library_has_opening_briefing_storylet():
    """S7: the shipped storylet-library.json must contain at least one storylet
    with scene_tags including 'opening_briefing', so white-war's mission-briefing
    scene can trigger a beat on entry."""
    import json
    from pathlib import Path
    lib_path = Path("plugins/coc-keeper/references/rules-json/storylet-library.json")
    lib = json.loads(lib_path.read_text())
    opening = [s for s in lib["storylets"] if "opening_briefing" in (s.get("scene_tags") or [])]
    assert opening, "shipped library lacks any opening_briefing storylet"


def test_e2e_mission_briefing_summons_opening_briefing_storylet_real_data():
    """C3 real-data e2e: on white-war's mission-briefing scene (which carries
    real `pressure_moves` AND `storylet_tags: ["opening_briefing"]`), entering
    the scene fires a `scene_tag_beat` trigger (P0-3b). Against the SHIPPED
    storylet-library.json, an opening_briefing storylet must be reliably
    selected across seeds — not a generic pressure/scene storylet.

    This reproduces the field defect: because mission-briefing has
    `pressure_moves`, infer_story_need resolves to `scene_pressure`, whose
    candidate_decks have zero intersection with the opening storylets' deck_tags
    (character_beat/theme_echo/social). Without the scene_tag_beat bypass, the
    opening storylets are filtered out and generics win selection.
    """
    import json
    from pathlib import Path

    scene = json.loads(Path(
        "plugins/coc-keeper/references/starter-scenarios/the-white-war/story-graph.json"
    ).read_text())["scenes"][0]
    library = storylets.load_storylet_library()

    # Sanity: we are actually testing the real mission-briefing scene, and it
    # really carries pressure_moves + storylet_tags (the defect preconditions).
    assert scene["scene_id"] == "mission-briefing"
    assert scene.get("pressure_moves"), "mission-briefing must carry pressure_moves"
    assert "opening_briefing" in (scene.get("storylet_tags") or [])

    opening_ids = {
        s["storylet_id"] for s in library["storylets"]
        if "opening_briefing" in (s.get("scene_tags") or [])
    }
    assert opening_ids, "shipped library must contain opening_briefing storylets"

    selected_ids: list[str] = []
    for seed in ("ww-1", "ww-2", "ww-3", "ww-4", "ww-5"):
        ctx = {
            "turn_number": 0,
            "source_event_type": "scene_transition",  # fires scene_tag_beat (P0-3b)
            "structure_type": "linear_acts",
            "storylet_policy": {"conflict_level": "low", "seed": seed},
            "active_scene": scene,
            "world_state": {"discovered_clue_ids": []},
            "threat_fronts": {"fronts": []},
            "module_meta": {
                "content_flags": [],
                "setting_tags": ["military", "wilderness"],
            },
            "storylet_ledger": {},
            # The real trigger object produced by infer_storylet_trigger for a
            # storylet_tags-bearing scene entered via scene_transition.
            "storylet_trigger": {
                "triggered": True,
                "reason": "scene_tag_beat",
                "polarity": "neutral",
                "conflict_level": "low",
                "storylet_tags": ["opening_briefing"],
                "source": "storylet_trigger_gate",
            },
        }
        plan = {
            "decision_id": "ww-entry",
            "scene_action": "CHARACTER",
            "pacing_mode": "social",
            "clue_policy": {"reveal": scene.get("available_clues", []), "leads": []},
            "narrative_directives": {"horror_escalation_stage": "ordinary"},
            "rule_signals": {"tension_clock": {"tension_level": "low"}},
        }
        moves = storylets.select_storylet_moves(plan, ctx, library=library, seed=seed)
        assert moves, f"seed {seed}: expected a storylet to be selected"
        selected_ids.append(moves[0]["storylet_id"])

    opening_hits = sum(1 for sid in selected_ids if sid in opening_ids)
    # A summoned scene-tag beat should win selection on (almost) every seed.
    # Requiring >=4/5 keeps the test robust to one unlucky weighted-random draw
    # while still proving the opening storylets are genuinely selectable and
    # favored — which is impossible without the scene_tag_beat bypass.
    assert opening_hits >= 4, (
        f"expected an opening_briefing storylet in >=4 of 5 seeds; "
        f"got {opening_hits}/5. selected={selected_ids}, opening_ids={sorted(opening_ids)}"
    )


def test_shipped_library_has_arrival_and_first_contact_storylets():
    """Scenario-data wiring follow-up: the shipped library must also cover the
    two deferred scene-type tags (arrival / first_contact) so mid-scenario
    scene entries can summon beats, not just the opening briefing."""
    library = storylets.load_storylet_library()
    for tag in ("arrival", "first_contact"):
        tagged = [s for s in library["storylets"] if tag in (s.get("scene_tags") or [])]
        assert tagged, f"shipped library lacks any '{tag}' storylet"


def test_e2e_white_war_scene_entries_summon_tagged_storylets_real_data():
    """Real-data e2e for the deferred tags: each white-war scene that carries
    `storylet_tags` (arrival on crossing-saddle / austrian-positions,
    first_contact on blast-chamber / whistle-approaches) must reliably summon
    a matching tagged storylet on scene entry, against the SHIPPED library."""
    import json
    from pathlib import Path

    graph = json.loads(Path(
        "plugins/coc-keeper/references/starter-scenarios/the-white-war/story-graph.json"
    ).read_text())
    scenes = {s["scene_id"]: s for s in graph["scenes"]}
    library = storylets.load_storylet_library()

    expectations = {
        "crossing-saddle": "arrival",
        "austrian-positions": "arrival",
        "blast-chamber": "first_contact",
        "whistle-approaches": "first_contact",
    }
    for scene_id, tag in expectations.items():
        scene = scenes[scene_id]
        assert tag in (scene.get("storylet_tags") or []), (
            f"{scene_id} must carry storylet_tags [{tag}]"
        )
        tagged_ids = {
            s["storylet_id"] for s in library["storylets"]
            if tag in (s.get("scene_tags") or [])
        }
        assert tagged_ids, f"library must contain '{tag}' storylets"

        hits = 0
        seeds = (f"{scene_id}-1", f"{scene_id}-2", f"{scene_id}-3",
                 f"{scene_id}-4", f"{scene_id}-5")
        selected: list[str] = []
        for seed in seeds:
            ctx = {
                "turn_number": 3,
                "source_event_type": "scene_transition",  # fires scene_tag_beat
                "structure_type": "linear_acts",
                "storylet_policy": {"conflict_level": "medium", "seed": seed},
                "active_scene": scene,
                "world_state": {"discovered_clue_ids": []},
                "threat_fronts": {"fronts": []},
                "module_meta": {"content_flags": []},
                "storylet_ledger": {},
                "storylet_trigger": {
                    "triggered": True,
                    "reason": "scene_tag_beat",
                    "polarity": "neutral",
                    "conflict_level": "medium",
                    "storylet_tags": [tag],
                    "source": "storylet_trigger_gate",
                },
            }
            plan = {
                "decision_id": f"{scene_id}-entry",
                "scene_action": "PRESSURE" if tag == "first_contact" else "DEEPEN",
                "pacing_mode": "exploration",
                "clue_policy": {"reveal": scene.get("available_clues", []), "leads": []},
                "narrative_directives": {"horror_escalation_stage": "wrongness"},
                "rule_signals": {"tension_clock": {"tension_level": "medium"}},
            }
            moves = storylets.select_storylet_moves(plan, ctx, library=library, seed=seed)
            assert moves, f"{scene_id} seed {seed}: expected a storylet to be selected"
            selected.append(moves[0]["storylet_id"])
            if moves[0]["storylet_id"] in tagged_ids:
                hits += 1
        assert hits >= 4, (
            f"{scene_id}: expected a '{tag}' storylet in >=4 of 5 seeds; "
            f"got {hits}/5. selected={selected}, tagged={sorted(tagged_ids)}"
        )


def _military_opening_storylet(**overrides):
    base = {
        "storylet_id": "opening-briefing-tell-not-ask",
        "title": "简报里的沉默",
        "family_id": "opening_tension",
        "trope_id": "withheld_mission_truth",
        "conflict_level": "low",
        "conflict_score": 1,
        "base_weight": 1.0,
        "dramatic_function": ["CHARACTER", "DEEPEN"],
        "scene_actions": ["CHARACTER", "DEEPEN"],
        "scope": "scene",
        "structure_affinity": ["linear_acts", "branching_investigation"],
        "eligible_scene_types": ["social"],
        "horror_stage": ["ordinary", "wrongness"],
        "scene_tags": ["opening_briefing"],
        "setting_tags": ["military"],
        "requires": {"npc_id": True, "unrevealed_clue": False, "active_front": False},
        "serves": {"mainline": True, "can_deepen_npc": True, "can_surface_choice": True},
        "anti_repeat": {
            "cooldown_turns": 12,
            "max_per_session": 1,
            "exclude_if_family_used_recently": True,
            "exclude_if_trope_used_recently": False,
        },
        "cue": "下达命令的人把真相咽回去半句，眼神在地图上多停了一拍。",
        "beat": "在简报里埋下张力。",
        "effects": {
            "narrative_move": "在简报里埋下张力。",
            "clue_handling": "May foreshadow a withheld clue; never reveals it.",
            "pressure": "No automatic clock tick.",
            "choice": "Surface as a visible doubt or dilemma.",
        },
        "variants": {
            "sensory_detail_1d6": ["副官与军士交换了一个极短的眼神。"],
            "complication_1d6": ["补给清单上少了一项关键物资。"],
        },
        "narration_directive": "只埋张力，不揭示被隐瞒的真相。",
        "story_functions": ["character_beat", "theme_echo"],
        "deck_tags": ["character_beat", "npc", "relationship", "theme_echo", "social", "opening"],
    }
    base.update(overrides)
    return base


def _neutral_opening_storylet():
    return _military_opening_storylet(
        storylet_id="opening-briefing-civilian-neutral",
        setting_tags=[],
        cue="委托人把后半句话咽了回去，手指在桌沿停了一拍。",
        variants={
            "sensory_detail_1d6": ["茶杯边缘的水渍还没干。"],
            "complication_1d6": ["合同末页有一行被划掉的备注。"],
        },
    )


def test_scene_tags_includes_module_and_location_setting_tags():
    ctx = {
        "active_scene": {
            "scene_type": "social",
            "storylet_tags": ["opening_briefing"],
            "location_tags": ["briefing", "knott"],
            "setting_tags": ["domestic"],
        },
        "module_meta": {"setting_tags": ["urban-civilian", "1920s"]},
    }
    tags = storylets._scene_tags(ctx)
    assert "opening_briefing" in tags
    assert "domestic" in tags
    assert "urban-civilian" in tags
    assert "1920s" in tags
    assert "briefing" in tags


def test_military_storylet_ineligible_for_haunting_commission_briefing():
    """Military-prose opening storylets must not fire in The Haunting's
    civilian commission-briefing even when scene_tags match opening_briefing."""
    library = {
        "schema_version": 1,
        "description": "test",
        "conflict_levels": ["low", "medium", "high", "climax"],
        "selection_contract": [],
        "storylets": [_military_opening_storylet(), _neutral_opening_storylet()],
    }
    ctx = {
        "turn_number": 0,
        "structure_type": "branching_investigation",
        "storylet_policy": {
            "conflict_level": "low",
            "seed": "haunt-brief",
            "ignore_story_need": True,
            "allow_unanchored_storylets": True,
        },
        "active_scene": {
            "scene_id": "commission-briefing",
            "scene_type": "social",
            "storylet_tags": ["opening_briefing"],
            "location_tags": ["briefing", "knott", "委托"],
            "npc_ids": ["npc-steven-knott"],
            "available_clues": ["clue-knott-commission"],
            "tone": ["daylight"],
        },
        "world_state": {"discovered_clue_ids": []},
        "threat_fronts": {"fronts": []},
        "module_meta": {
            "content_flags": [],
            "setting_tags": ["urban-civilian", "domestic", "1920s"],
        },
        "storylet_ledger": {},
        "storylet_trigger": {
            "triggered": True,
            "reason": "scene_tag_beat",
            "polarity": "neutral",
            "storylet_tags": ["opening_briefing"],
        },
    }
    plan = {
        "decision_id": "haunt-brief",
        "scene_action": "CHARACTER",
        "pacing_mode": "social",
        "clue_policy": {"reveal": [], "leads": []},
        "narrative_directives": {"horror_escalation_stage": "ordinary"},
        "rule_signals": {"tension_clock": {"tension_level": "low"}},
    }
    assert storylets._matches_context(
        library["storylets"][0], plan, ctx, "low"
    ) is False
    assert storylets._matches_context(
        library["storylets"][1], plan, ctx, "low"
    ) is True
    moves = storylets.select_storylet_moves(plan, ctx, library=library, seed="haunt-brief")
    assert moves
    assert moves[0]["storylet_id"] == "opening-briefing-civilian-neutral"
    assert moves[0]["storylet_id"] != "opening-briefing-tell-not-ask"


def test_military_storylet_eligible_for_white_war_mission_briefing():
    library = {
        "schema_version": 1,
        "description": "test",
        "conflict_levels": ["low", "medium", "high", "climax"],
        "selection_contract": [],
        "storylets": [_military_opening_storylet()],
    }
    ctx = {
        "turn_number": 0,
        "structure_type": "linear_acts",
        "storylet_policy": {
            "conflict_level": "low",
            "seed": "ww-brief",
            "ignore_story_need": True,
        },
        "active_scene": {
            "scene_id": "mission-briefing",
            "scene_type": "social",
            "storylet_tags": ["opening_briefing"],
            "location_tags": ["briefing", "commander", "简报"],
            "npc_ids": ["npc-company-commander"],
            "available_clues": [],
            "tone": ["cold"],
        },
        "world_state": {"discovered_clue_ids": []},
        "threat_fronts": {"fronts": []},
        "module_meta": {
            "content_flags": [],
            "setting_tags": ["military", "wilderness"],
        },
        "storylet_ledger": {},
        "storylet_trigger": {
            "triggered": True,
            "reason": "scene_tag_beat",
            "polarity": "neutral",
            "storylet_tags": ["opening_briefing"],
        },
    }
    plan = {
        "decision_id": "ww-brief",
        "scene_action": "CHARACTER",
        "pacing_mode": "social",
        "clue_policy": {"reveal": [], "leads": []},
        "narrative_directives": {"horror_escalation_stage": "ordinary"},
        "rule_signals": {"tension_clock": {"tension_level": "low"}},
    }
    assert storylets._matches_context(library["storylets"][0], plan, ctx, "low") is True
    moves = storylets.select_storylet_moves(plan, ctx, library=library, seed="ww-brief")
    assert moves
    assert moves[0]["storylet_id"] == "opening-briefing-tell-not-ask"


def test_setting_neutral_storylet_eligible_without_setting_tags():
    storylet = _military_opening_storylet(setting_tags=[])
    ctx = {
        "structure_type": "branching_investigation",
        "storylet_policy": {"conflict_level": "low", "ignore_story_need": True},
        "active_scene": {
            "scene_type": "social",
            "storylet_tags": ["opening_briefing"],
            "npc_ids": ["npc-a"],
        },
        "module_meta": {"setting_tags": ["urban-civilian"]},
        "world_state": {"discovered_clue_ids": []},
        "threat_fronts": {"fronts": []},
    }
    plan = {
        "scene_action": "CHARACTER",
        "clue_policy": {"reveal": []},
        "narrative_directives": {"horror_escalation_stage": "ordinary"},
    }
    assert storylets._matches_context(storylet, plan, ctx, "low") is True


def test_shipped_military_opening_storylets_declare_setting_tags():
    library = storylets.load_storylet_library()
    military_ids = {
        "opening-briefing-tell-not-ask",
        "opening-briefing-comrade-glance",
    }
    found = {s["storylet_id"]: s for s in library["storylets"] if s["storylet_id"] in military_ids}
    assert set(found) == military_ids
    for sid, storylet in found.items():
        assert "military" in (storylet.get("setting_tags") or []), sid
