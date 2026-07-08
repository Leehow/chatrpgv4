#!/usr/bin/env python3
from __future__ import annotations

import importlib.util


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, rel)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


narr = _load("coc_narrative_enrichment", "plugins/coc-keeper/scripts/coc_narrative_enrichment.py")


def test_choice_frame_surfaces_affordance_tradeoffs_without_menu():
    scene = {"affordances": [
        {"id": "exit_tunnel", "cue": "洞口有凉风", "promise": "可能通向出口", "risk": "出口可能被封堵", "route_priority": 0.8},
        {"id": "upper_shaft", "cue": "头顶有金属反光", "promise": "可能有证据", "cost": "攀爬耗时", "route_priority": 0.7},
    ]}
    frame = narr.build_choice_frame(scene)
    assert frame["mode"] == "diegetic_cues"
    assert frame["do_not_render_as_menu"] is True
    assert frame["route_count"] == 2
    assert frame["routes"][0]["route_id"] == "exit_tunnel"
    assert frame["routes"][0]["visible_risk"] == "出口可能被封堵"
    assert frame["must_surface_tradeoffs"] is True


def test_action_atoms_become_chained_rule_requests():
    rich = {"action_atoms": [
        {"id": "a1", "verb": "贴近警卫", "skill": "Dodge", "stakes": "失败则警卫先手"},
        {"id": "a2", "verb": "推开警卫", "skill": "Fighting (Brawl)", "opposed_by": "guard", "depends_on": "a1"},
        {"id": "a3", "verb": "拖走队友", "skill": "STR", "depends_on": "a2"},
    ]}
    requests = narr.build_action_chain_requests(rich)
    assert [r["request_id"] for r in requests] == ["roll-a1", "roll-a2", "roll-a3"]
    assert requests[1]["kind"] == "opposed_check"
    assert requests[1]["depends_on"] == "roll-a1"
    assert requests[2]["kind"] == "characteristic_check"


def test_npc_reaction_triggers_from_structured_tags():
    scene = {"npc_ids": ["ally-1"]}
    agendas = {"npcs": [{
        "npc_id": "ally-1",
        "agenda": "keep the group alive",
        "desire": "活着离开",
        "reaction_triggers": [
            {"when": "guard", "move": "whisper_warning", "line_seed": "别盯他的枪，看他的脚。"}
        ],
    }]}
    rich = {"target_entities": ["guard"], "action_atoms": []}
    moves = narr.build_npc_reaction_moves(scene, agendas, rich)
    assert moves[0]["desire"] == "活着离开"
    assert moves[0]["active_reactions"][0]["move"] == "whisper_warning"


def test_npc_reaction_trigger_matches_singular_target_entity_tag():
    scene = {"npc_ids": ["ally-1"]}
    agendas = {"npcs": [{
        "npc_id": "ally-1",
        "agenda": "keep watch",
        "reaction_triggers": [
            {"when": "target_entity:guard", "move": "warn_about_guard"}
        ],
    }]}
    rich = {"target_entities": ["guard"], "action_atoms": []}

    moves = narr.build_npc_reaction_moves(scene, agendas, rich)

    assert moves[0]["active_reactions"][0]["move"] == "warn_about_guard"


def test_enrich_director_plan_adds_rules_npc_choice_and_handoff():
    plan = {"clue_policy": {}, "rules_requests": [], "npc_moves": [], "narrative_directives": {}, "handoff": "narration"}
    ctx = {
        "active_scene": {"npc_ids": ["ally-1"], "affordances": [{"id": "door", "cue": "门没锁"}]},
        "player_intent_rich": {
            "target_entities": ["guard"],
            "action_atoms": [{"id": "a1", "skill": "Dodge", "verb": "冲过枪口"}],
        },
        "npc_agendas": {"npcs": [{"npc_id": "ally-1", "agenda": "help", "reaction_triggers": [{"when": "guard", "move": "warn"}]}]},
        "turn_number": 2,
    }
    enriched = narr.enrich_director_plan(plan, ctx)
    assert enriched["handoff"] == "rules"
    assert enriched["choice_frame"]["routes"][0]["route_id"] == "door"
    assert enriched["rules_requests"][0]["skill"] == "Dodge"
    assert enriched["npc_moves"][0]["active_reactions"][0]["move"] == "warn"


def test_enrich_director_plan_adds_storylet_moves_with_conflict_control():
    plan = {
        "decision_id": "d-storylet",
        "scene_action": "REVEAL",
        "pacing_mode": "investigation",
        "clue_policy": {"reveal": ["clue-doorframe"]},
        "rules_requests": [],
        "npc_moves": [],
        "narrative_directives": {"horror_escalation_stage": "wrongness"},
        "handoff": "narration",
        "rule_signals": {"tension_clock": {"tension_level": "low"}},
    }
    ctx = {
        "active_scene": {
            "scene_id": "archive",
            "scene_type": "investigation",
            "npc_ids": ["npc-archivist"],
            "available_clues": ["clue-doorframe"],
            "tone": ["dust"],
        },
        "player_intent_rich": {"action_atoms": []},
        "world_state": {"discovered_clue_ids": []},
        "threat_fronts": {"fronts": [{"front_id": "cult-watch", "clocks": [{"clock_id": "cult-alert"}]}]},
        "structure_type": "branching_investigation",
        "module_meta": {"content_flags": []},
        "storylet_policy": {"conflict_level": "low", "seed": "test", "force_storylet": True},
        "turn_number": 4,
    }
    enriched = narr.enrich_director_plan(plan, ctx)
    assert enriched["storylet_moves"]
    assert enriched["storylet_moves"][0]["conflict_level"] == "low"
    assert enriched["narrative_enrichment"]["storylet_moves"] == 1
    assert enriched["narrative_enrichment"]["conflict_level"] == "low"
    assert enriched["narrative_directives"]["storylet_moves"][0]["source"] == "storylet-library.json"


def test_enrichment_reports_story_need_and_candidate_deck():
    plan = {
        "decision_id": "d-storylet-scheduler",
        "scene_action": "REVEAL",
        "pacing_mode": "investigation",
        "clue_policy": {"reveal": ["clue-doorframe"]},
        "rules_requests": [],
        "npc_moves": [],
        "narrative_directives": {"horror_escalation_stage": "wrongness"},
        "handoff": "narration",
        "rule_signals": {"tension_clock": {"tension_level": "low"}},
    }
    ctx = {
        "active_scene": {
            "scene_id": "archive",
            "scene_type": "investigation",
            "available_clues": ["clue-doorframe"],
            "tone": ["dust"],
        },
        "player_intent_rich": {"action_atoms": []},
        "world_state": {"discovered_clue_ids": []},
        "threat_fronts": {"fronts": []},
        "structure_type": "branching_investigation",
        "module_meta": {"content_flags": []},
        "storylet_library": {"storylets": [{
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
        }]},
        "storylet_policy": {"conflict_level": "low", "seed": "scheduler", "force_storylet": True},
        "turn_number": 4,
    }

    enriched = narr.enrich_director_plan(plan, ctx)

    scheduler = enriched["narrative_enrichment"]["storylet_scheduler"]
    assert scheduler["story_need"]["need_id"] == "clue_delivery"
    assert "clue_delivery" in scheduler["candidate_decks"]
    assert enriched["storylet_moves"][0]["story_need"]["need_id"] == "clue_delivery"


def _storylet_gate_plan(action="DEEPEN"):
    return {
        "decision_id": "d-storylet-gate",
        "scene_action": action,
        "pacing_mode": "investigation",
        "clue_policy": {"reveal": [], "leads": []},
        "rules_requests": [],
        "npc_moves": [],
        "narrative_directives": {"horror_escalation_stage": "wrongness"},
        "handoff": "narration",
        "rule_signals": {"tension_clock": {"tension_level": "low"}},
    }


def _storylet_gate_library():
    return {"storylets": [
        {
            "storylet_id": "low-reflection-noise",
            "family_id": "sensory_pressure",
            "trope_id": "quiet_wrongness",
            "conflict_level": "low",
            "base_weight": 1,
            "scene_actions": ["DEEPEN", "REVEAL", "SUBSYSTEM"],
            "eligible_scene_types": ["investigation"],
            "scene_tags": ["wrongness"],
            "horror_stage": ["wrongness"],
            "requires": {"npc_id": False, "unrevealed_clue": False, "active_front": False},
            "serves": {"mainline": True, "theme": True},
            "cue": "房间里的小异常被推到台前。",
        },
        {
            "storylet_id": "high-fumble-complication",
            "family_id": "fumble_complication",
            "trope_id": "fumble_exposes_investigator",
            "conflict_level": "high",
            "base_weight": 10,
            "scene_actions": ["SUBSYSTEM", "PRESSURE", "DEEPEN"],
            "eligible_scene_types": ["investigation"],
            "scene_tags": ["wrongness"],
            "horror_stage": ["wrongness", "pattern"],
            "requires": {"npc_id": False, "unrevealed_clue": False, "active_front": False},
            "serves": {"mainline": True, "theme": True, "can_surface_choice": True},
            "cue": "失误立刻把调查员暴露在新的麻烦里。",
            "story_functions": ["complication"],
            "deck_tags": ["complication", "failure_consequence"],
            "trigger_polarity": ["negative"],
        },
        {
            "storylet_id": "high-enemy-fumble-opportunity",
            "family_id": "enemy_fumble_opportunity",
            "trope_id": "enemy_overextends",
            "conflict_level": "high",
            "base_weight": 10,
            "scene_actions": ["SUBSYSTEM", "PRESSURE", "DEEPEN"],
            "eligible_scene_types": ["investigation"],
            "scene_tags": ["wrongness"],
            "horror_stage": ["wrongness", "pattern"],
            "requires": {"npc_id": False, "unrevealed_clue": False, "active_front": False},
            "serves": {"mainline": True, "theme": True, "can_surface_choice": True},
            "cue": "敌人的失手暴露出一个短暂而危险的机会。",
            "story_functions": ["opportunity"],
            "deck_tags": ["opportunity", "critical_success"],
            "trigger_polarity": ["positive"],
        },
    ]}


def _storylet_gate_ctx(primary_intent="reflect"):
    return {
        "active_scene": {
            "scene_id": "hotel-room",
            "scene_type": "investigation",
            "tone": ["quiet", "wrongness"],
        },
        "player_intent_rich": {"primary_intent": primary_intent, "action_atoms": []},
        "world_state": {"discovered_clue_ids": []},
        "threat_fronts": {"fronts": []},
        "structure_type": "branching_investigation",
        "module_meta": {"content_flags": []},
        "storylet_library": _storylet_gate_library(),
        "storylet_policy": {"seed": "gate-test", "max_storylets": 1},
        "turn_number": 3,
    }


def test_enrichment_does_not_draw_storylet_without_event_trigger():
    enriched = narr.enrich_director_plan(_storylet_gate_plan("DEEPEN"), _storylet_gate_ctx("reflect"))

    assert enriched["storylet_moves"] == []
    assert enriched["narrative_enrichment"]["storylet_moves"] == 0
    assert enriched["narrative_enrichment"]["storylet_trigger"]["reason"] == "none"


def test_fumble_after_rules_triggers_high_conflict_storylet():
    plan = narr.enrich_director_plan(_storylet_gate_plan("SUBSYSTEM"), _storylet_gate_ctx("organize_notes"))
    plan["rules_results"] = [{
        "skill": "Library Use",
        "roll": 100,
        "target": 75,
        "outcome": "fumble",
        "stakes": "材料顺序被打乱并惊动旁人",
    }]

    enriched = narr.enrich_storylets_after_rules(plan, _storylet_gate_ctx("organize_notes"))

    assert enriched["storylet_moves"]
    assert enriched["storylet_moves"][0]["target_conflict_level"] == "high"
    assert enriched["narrative_enrichment"]["storylet_trigger"]["reason"] == "fumble"
    assert enriched["narrative_enrichment"]["storylet_trigger"]["polarity"] == "negative"


def test_npc_fumble_after_rules_triggers_positive_high_conflict_storylet():
    plan = narr.enrich_director_plan(_storylet_gate_plan("SUBSYSTEM"), _storylet_gate_ctx("restrain"))
    plan["rules_results"] = [{
        "kind": "npc_attack",
        "actor_role": "npc",
        "skill": "Fighting (Bayonet)",
        "roll": 97,
        "target": 40,
        "outcome": "fumble",
        "stakes": "敌人乱刺露出破绽",
    }]

    enriched = narr.enrich_storylets_after_rules(plan, _storylet_gate_ctx("restrain"))

    assert enriched["storylet_moves"]
    assert enriched["storylet_moves"][0]["target_conflict_level"] == "high"
    assert enriched["storylet_moves"][0]["storylet_id"] == "high-enemy-fumble-opportunity"
    assert enriched["narrative_enrichment"]["storylet_trigger"]["reason"] == "fumble"
    assert enriched["narrative_enrichment"]["storylet_trigger"]["polarity"] == "positive"


def test_extreme_success_does_not_trigger_special_storylet_by_itself():
    plan = narr.enrich_director_plan(_storylet_gate_plan("SUBSYSTEM"), _storylet_gate_ctx("investigate"))
    plan["rules_results"] = [{
        "skill": "Spot Hidden",
        "roll": 10,
        "target": 60,
        "outcome": "extreme",
        "stakes": "看清房间细节",
    }]

    enriched = narr.enrich_storylets_after_rules(plan, _storylet_gate_ctx("investigate"))

    assert enriched["storylet_moves"] == []
    assert enriched["narrative_enrichment"]["storylet_trigger"]["reason"] == "none"
