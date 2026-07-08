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


def test_stop_actionability_contract_uses_structured_handles_after_costly_failure():
    turn = {
        "rule_results": [{
            "success": False,
            "roll_contract": {
                "goal": "判断电话线为何移动以及通向哪里",
                "failure_effect": "得到一个不完整方向，但线另一端先有反应。",
                "failure_outcome_mode": "clue_with_cost",
            },
        }],
        "choice_frame": {
            "routes": [
                {"route_id": "old-route", "cue": "旧的现场入口。"}
            ],
        },
        "npc_moves": [{
            "npc_id": "bruno",
            "agency_moves": [{"move_id": "take_command"}],
        }],
    }
    active_scene = {
        "visible_affordances": [
            {"route": "follow_rear_line", "cue": "电话线从箱体后方小孔穿出，通向掩体后壁。"},
            {"route": "tamper_with_box", "cue": "箱盖半开，想拆或切线必须把手伸进去。"},
            {"route": "inspect_empty_boot", "cue": "箱子下面倒着一只空军靴，靴底沾着新泥。"},
        ],
        "pressure_moves": [
            {"id": "line-end-answered", "visible_symptom": "线另一端已经被惊动。"}
        ],
    }

    contract = narr.build_stop_actionability_contract(
        turn,
        active_scene,
        stop_reason="risk_requires_roll",
    )

    assert contract["why_stopped"] == "clue_with_cost"
    assert contract["forbidden_menu_rendering"] is True
    assert contract["must_surface_handles"] is True
    assert contract["pressure_if_ignored"] == "线另一端已经被惊动。"
    assert [handle["route_id"] for handle in contract["immediate_handles"]] == [
        "follow_rear_line",
        "tamper_with_box",
        "inspect_empty_boot",
    ]
    assert contract["npc_position"][0]["npc_id"] == "bruno"
    assert contract["npc_position"][0]["move_ids"] == ["take_command"]


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


def test_action_atom_requests_include_roll_contract():
    rich = {"action_atoms": [{
        "id": "cross-fire",
        "verb": "冲过火线",
        "skill": "Dodge",
        "stakes": "失败则被敌人抢先射击",
        "failure_outcome_mode": "pressure_cost",
        "roll_density_group": "crossing_fire",
    }]}

    requests = narr.build_action_chain_requests(rich)

    contract = requests[0]["roll_contract"]
    assert contract["goal"] == "冲过火线"
    assert contract["failure_effect"] == "失败则被敌人抢先射击"
    assert contract["failure_outcome_mode"] == "pressure_cost"
    assert contract["roll_density_group"] == "crossing_fire"


def test_action_atom_density_group_merges_same_axis_requests():
    rich = {"action_atoms": [
        {
            "id": "search-desk",
            "verb": "先搜桌面",
            "skill": "Spot Hidden",
            "stakes": "耗费时间",
            "roll_density_group": "same-room-search",
        },
        {
            "id": "search-drawer",
            "verb": "再搜抽屉",
            "skill": "Spot Hidden",
            "stakes": "弄出声响",
            "roll_density_group": "same-room-search",
        },
    ]}

    requests = narr.build_action_chain_requests(rich)

    assert len(requests) == 1
    request = requests[0]
    assert request["request_id"] == "roll-search-desk"
    assert request["density_decision"]["mode"] == "merged_roll"
    assert request["density_decision"]["roll_density_group"] == "same-room-search"
    assert request["density_decision"]["merged_atom_ids"] == ["search-desk", "search-drawer"]
    assert request["merged_atoms"] == ["search-desk", "search-drawer"]
    assert request["roll_contract"]["roll_density_group"] == "same-room-search"
    assert "先搜桌面" in request["roll_contract"]["goal"]
    assert "再搜抽屉" in request["roll_contract"]["goal"]
    assert "耗费时间" in request["roll_contract"]["failure_effect"]
    assert "弄出声响" in request["roll_contract"]["failure_effect"]


def test_action_atom_density_group_keeps_distinct_failure_modes_separate():
    rich = {"action_atoms": [
        {
            "id": "cross-yard",
            "verb": "冲过空地",
            "skill": "Dodge",
            "failure_outcome_mode": "goal_with_cost",
            "roll_density_group": "yard-crossing",
        },
        {
            "id": "cover-ally",
            "verb": "掩护同伴",
            "skill": "Firearms (Handgun)",
            "failure_outcome_mode": "pressure_cost",
            "roll_density_group": "yard-crossing",
        },
    ]}

    requests = narr.build_action_chain_requests(rich)

    assert len(requests) == 2
    assert all("density_decision" not in request for request in requests)


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


def test_proposal_transform_yes_but_from_structured_intent():
    plan = {"clue_policy": {}, "rules_requests": [], "npc_moves": [], "narrative_directives": {}, "handoff": "narration"}
    ctx = {
        "active_scene": {"scene_id": "archive", "affordances": []},
        "player_intent_rich": {
            "proposal": {
                "mode": "yes_but",
                "accepted_goal": "ask the police to guard the artifact",
                "visible_cost_or_risk": "the officer will demand a clear statement",
                "next_contract": "request_roll",
            },
            "action_atoms": [],
        },
        "npc_agendas": {"npcs": []},
        "turn_number": 5,
    }

    enriched = narr.enrich_director_plan(plan, ctx)

    transform = enriched["proposal_transform"]
    assert transform["mode"] == "yes_but"
    assert transform["accepted_goal"] == "ask the police to guard the artifact"
    assert enriched["narrative_directives"]["proposal_transform"] == transform


def test_enrich_records_roll_density_decisions_for_debugging():
    plan = {"clue_policy": {}, "rules_requests": [], "npc_moves": [], "narrative_directives": {}, "handoff": "narration"}
    ctx = {
        "active_scene": {},
        "player_intent_rich": {
            "action_atoms": [
                {"id": "search-desk", "verb": "搜桌面", "skill": "Spot Hidden", "roll_density_group": "same-room"},
                {"id": "search-drawer", "verb": "搜抽屉", "skill": "Spot Hidden", "roll_density_group": "same-room"},
            ],
        },
        "npc_agendas": {"npcs": []},
    }

    enriched = narr.enrich_director_plan(plan, ctx)

    assert len(enriched["rules_requests"]) == 1
    assert enriched["roll_density_decisions"][0]["mode"] == "merged_roll"
    assert enriched["narrative_directives"]["roll_density_decisions"] == enriched["roll_density_decisions"]
    assert enriched["narrative_enrichment"]["roll_density_decisions"] == 1


def test_proposal_transform_rejects_unknown_mode_as_yes_but():
    plan = {"clue_policy": {}, "rules_requests": [], "npc_moves": [], "narrative_directives": {}, "handoff": "narration"}
    ctx = {
        "active_scene": {},
        "player_intent_rich": {"proposal": {"mode": "maybe", "accepted_goal": "try a plan"}, "action_atoms": []},
        "npc_agendas": {"npcs": []},
    }

    enriched = narr.enrich_director_plan(plan, ctx)

    assert enriched["proposal_transform"]["mode"] == "yes_but"


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


def test_choice_frame_is_real_fork_when_two_open_routes():
    scene = {"affordances": [
        {"id": "ask-tenants", "cue": "前租客", "status": "open"},
        {"id": "check-records", "cue": "公共记录", "status": "open"},
    ]}
    frame = narr.build_choice_frame(scene)
    assert frame["is_real_fork"] is True
    assert frame["open_route_count"] == 2
    assert frame["open_route_ids"] == ["ask-tenants", "check-records"]


def test_choice_frame_not_real_fork_when_one_open_one_locked():
    scene = {"affordances": [
        {"id": "ask-tenants", "cue": "前租客", "status": "open"},
        {"id": "check-records", "cue": "公共记录", "status": "locked"},
    ]}
    frame = narr.build_choice_frame(scene)
    assert frame["is_real_fork"] is False
    assert frame["open_route_count"] == 1


def test_choice_frame_open_status_defaults_to_open_when_absent():
    scene = {"affordances": [
        {"id": "a", "cue": "a"},
        {"id": "b", "cue": "b"},
    ]}
    frame = narr.build_choice_frame(scene)
    assert frame["is_real_fork"] is True
    assert frame["open_route_count"] == 2


def test_stop_actionability_surfaces_storylet_cues_when_present():
    turn = {
        "storylet_moves": [{"cue": "气味不属于这里", "title": "wrong_smell"}],
        "choice_frame": {"routes": [], "is_real_fork": False, "open_route_count": 0},
        "narrative_directives": {"must_include": ["气味不属于这里"]},
    }
    contract = narr.build_stop_actionability_contract(turn, {}, stop_reason="awaiting_player_input")
    assert "气味不属于这里" in contract["storylet_cues"]
    assert contract["must_surface_handles"] is True


def test_stop_actionability_empty_storylet_cues_when_absent():
    turn = {"choice_frame": {"routes": [], "is_real_fork": False, "open_route_count": 0}}
    contract = narr.build_stop_actionability_contract(turn, {}, stop_reason="awaiting_player_input")
    assert contract["storylet_cues"] == []


def test_storylet_triggers_on_scene_entry_with_storylet_tags():
    plan = {"scene_action": "CHARACTER"}
    ctx = {
        "active_scene": {"storylet_tags": ["opening_briefing"]},
        "source_event_type": "scene_transition",
    }
    trigger = narr.infer_storylet_trigger(plan, ctx)
    assert trigger["triggered"] is True
    assert trigger["reason"] == "scene_tag_beat"
    assert trigger["source"] == "storylet_trigger_gate"
    assert trigger["storylet_tags"] == ["opening_briefing"]


def test_storylet_does_not_trigger_without_scene_entry():
    plan = {"scene_action": "CHARACTER"}
    ctx = {
        "active_scene": {"storylet_tags": ["opening_briefing"]},
        # no source_event_type → not a scene entry
    }
    trigger = narr.infer_storylet_trigger(plan, ctx)
    assert trigger.get("triggered") is False


def test_storylet_does_not_trigger_without_storylet_tags():
    plan = {"scene_action": "CHARACTER"}
    ctx = {
        "active_scene": {},  # no storylet_tags
        "source_event_type": "scene_transition",
    }
    trigger = narr.infer_storylet_trigger(plan, ctx)
    assert trigger.get("triggered") is False


def test_storylet_triggers_on_scene_enter_event_type():
    plan = {"scene_action": "CHARACTER"}
    ctx = {
        "active_scene": {"storylet_tags": ["arrival"]},
        "source_event_type": "scene_enter",
    }
    trigger = narr.infer_storylet_trigger(plan, ctx)
    assert trigger["triggered"] is True
    assert trigger["reason"] == "scene_tag_beat"


def test_turn_focus_maps_intent_topic_to_affordance_route_type():
    ctx = {
        "player_intent_rich": {
            "primary_intent": "investigate",
            "action_atoms": [{"id": "a1", "verb": "ask", "object": "tenants", "topic": "history"}],
        },
        "active_scene": {
            "affordances": [
                {"id": "ask-tenants", "cue": "问前租客", "route_type": "tenant_history"},
                {"id": "enter-house", "cue": "进屋", "route_type": "direct_entry"},
            ],
        },
    }
    focus = narr.build_turn_focus_contract(ctx)
    assert focus is not None
    assert focus["focus_axis"] == "tenant_history"
    assert focus["focus_target_id"] == "ask-tenants"
    assert focus["focus_reason"]  # non-empty recorded reason


def test_turn_focus_returns_none_when_no_structured_match():
    ctx = {
        "player_intent_rich": {"primary_intent": "move"},  # no topic/target → no match
        "active_scene": {
            "affordances": [{"id": "x", "cue": "x", "route_type": "direct_entry"}],
        },
    }
    focus = narr.build_turn_focus_contract(ctx)
    assert focus is None  # no structured match → do not guess


def test_turn_focus_returns_none_when_no_affordances():
    ctx = {
        "player_intent_rich": {
            "primary_intent": "investigate",
            "action_atoms": [{"id": "a1", "topic": "history"}],
        },
        "active_scene": {"affordances": []},
    }
    focus = narr.build_turn_focus_contract(ctx)
    assert focus is None


def test_turn_focus_never_uses_player_text_substring():
    """Constitution guardian: even when a focus IS produced, focus_axis must be
    a member of the declared enum and never a substring of free player prose."""
    ctx = {
        "player_intent_rich": {
            "primary_intent": "investigate",
            "action_atoms": [{"id": "a1", "verb": "ask", "object": "tenants", "topic": "history"}],
        },
        "active_scene": {
            "affordances": [
                {"id": "ask-tenants", "cue": "问前租客", "route_type": "tenant_history"},
            ],
        },
        "player_text": "随便一段绝不该变成 focus_axis 的自由文字 blabla 历史 blabla",
    }
    focus = narr.build_turn_focus_contract(ctx)
    # The ctx DOES produce a focus (topic 'history' → tenant_history, matches affordance)
    assert focus is not None
    # focus_axis must be a member of the declared enum
    assert focus["focus_axis"] in narr._FOCUS_AXES
    # and must NOT be a substring of the free player text
    assert focus["focus_axis"] not in ctx["player_text"]
