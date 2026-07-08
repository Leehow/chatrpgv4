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


# =============================================================================
# P1-3: cross-turn roll density marker for repeated player actions
# =============================================================================

def test_cross_turn_density_marker_when_same_skill_kind_repeats_across_turns():
    """When the same (skill, kind) action appears ≥3 times in the recent window
    (including the current turn), the resulting request must carry a
    cross_turn_density marker with coalesce_hint == "montage". This is a marker
    only: it never changes rules adjudication or skips rolls."""
    rich = {"action_atoms": [{
        "id": "search-shelf",
        "verb": "再搜一次书架",
        "skill": "Library Use",
        "kind": "skill_check",
    }]}
    # Two prior turns each emitted a Library Use / skill_check atom (plus the
    # current turn's own atom) → repeated_count == 3 → marker fires.
    recent = [("Library Use", "skill_check"), ("Library Use", "skill_check")]

    requests = narr.build_action_chain_requests(rich, recent_atom_signatures=recent)

    assert len(requests) == 1
    marker = requests[0]["cross_turn_density"]
    assert marker["repeated_count"] == 3
    assert marker["coalesce_hint"] == "montage"
    assert marker["window"] == "cross_turn"
    # marker is informational only — the roll contract is still present so the
    # runner can still roll per request (rules adjudication untouched).
    assert "roll_contract" in requests[0]


def test_cross_turn_density_marker_absent_below_threshold():
    """A repeat that does not reach the ≥3 threshold must NOT emit the marker."""
    rich = {"action_atoms": [{
        "id": "search-shelf",
        "verb": "搜书架",
        "skill": "Library Use",
        "kind": "skill_check",
    }]}
    # Only one prior turn + current = 2 → below threshold.
    recent = [("Library Use", "skill_check")]

    requests = narr.build_action_chain_requests(rich, recent_atom_signatures=recent)

    assert len(requests) == 1
    assert "cross_turn_density" not in requests[0]


def test_cross_turn_density_marker_absent_when_no_recent_signatures():
    """Backward-compat: omitting recent_atom_signatures must not crash and must
    not emit the marker (no history → no repetition)."""
    rich = {"action_atoms": [{
        "id": "search-shelf",
        "verb": "搜书架",
        "skill": "Library Use",
        "kind": "skill_check",
    }]}

    requests_default = narr.build_action_chain_requests(rich)
    requests_empty = narr.build_action_chain_requests(rich, recent_atom_signatures=[])

    assert "cross_turn_density" not in requests_default[0]
    assert "cross_turn_density" not in requests_empty[0]


def test_cross_turn_density_marker_scoped_to_player_atoms_only():
    """The marker is keyed on (skill, kind). Two different skills must each
    accumulate their own counts; a different skill/kind must not trigger the
    other atom's marker."""
    rich = {"action_atoms": [
        {"id": "search", "verb": "搜", "skill": "Library Use", "kind": "skill_check"},
        {"id": "listen", "verb": "听", "skill": "Listen", "kind": "skill_check"},
    ]}
    # Library Use seen twice before; Listen never → only the search atom marks.
    recent = [("Library Use", "skill_check"), ("Library Use", "skill_check")]

    requests = narr.build_action_chain_requests(rich, recent_atom_signatures=recent)

    by_id = {r["atom_id"]: r for r in requests}
    assert by_id["search"]["cross_turn_density"]["repeated_count"] == 3
    assert "cross_turn_density" not in by_id["listen"]


def test_cross_turn_density_marker_respects_explicit_kind():
    """The (skill, kind) signature uses the inferred kind when the atom omits
    an explicit kind, mirroring the request's resolved kind."""
    rich = {"action_atoms": [{
        "id": "str-check",
        "verb": "用力推",
        "skill": "STR",  # characteristic → inferred kind characteristic_check
    }]}
    recent = [
        ("STR", "characteristic_check"),
        ("STR", "characteristic_check"),
    ]

    requests = narr.build_action_chain_requests(rich, recent_atom_signatures=recent)

    assert requests[0]["cross_turn_density"]["repeated_count"] == 3


def test_enrich_director_plan_emits_montage_hint_on_repeated_player_action():
    """When build_action_chain_requests produces a request carrying the
    cross_turn_density marker, enrich_director_plan must surface a montage_hint
    in narrative_directives so narration can compress the repetition."""
    plan = {"clue_policy": {}, "rules_requests": [], "npc_moves": [], "narrative_directives": {}, "handoff": "narration"}
    ctx = {
        "active_scene": {},
        "player_intent_rich": {
            "action_atoms": [{"id": "search", "skill": "Library Use", "kind": "skill_check"}],
        },
        "npc_agendas": {"npcs": []},
        "recent_atom_signatures": [
            ("Library Use", "skill_check"),
            ("Library Use", "skill_check"),
        ],
    }

    enriched = narr.enrich_director_plan(plan, ctx)

    hint = enriched["narrative_directives"]["montage_hint"]
    assert hint["coalesce_hint"] == "montage"
    assert hint["repeated_count"] >= 3
    assert hint["window"] == "cross_turn"
    # The marked request itself is present in rules_requests.
    roll_req = [r for r in enriched["rules_requests"] if r.get("source", "").startswith("player_intent_rich")][0]
    assert roll_req["cross_turn_density"]["coalesce_hint"] == "montage"


def test_enrich_director_plan_omits_montage_hint_without_repetition():
    """Without recent_atom_signatures, no montage_hint is emitted."""
    plan = {"clue_policy": {}, "rules_requests": [], "npc_moves": [], "narrative_directives": {}, "handoff": "narration"}
    ctx = {
        "active_scene": {},
        "player_intent_rich": {
            "action_atoms": [{"id": "search", "skill": "Library Use", "kind": "skill_check"}],
        },
        "npc_agendas": {"npcs": []},
    }

    enriched = narr.enrich_director_plan(plan, ctx)

    assert "montage_hint" not in enriched["narrative_directives"]


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
        {
            "storylet_id": "medium-fumble-complication",
            "family_id": "fumble_complication",
            "trope_id": "fumble_complicates_step",
            "conflict_level": "medium",
            "base_weight": 1,
            "scene_actions": ["SUBSYSTEM", "PRESSURE", "DEEPEN"],
            "eligible_scene_types": ["investigation"],
            "scene_tags": ["wrongness"],
            "horror_stage": ["wrongness", "pattern"],
            "requires": {"npc_id": False, "unrevealed_clue": False, "active_front": False},
            "serves": {"mainline": True, "theme": True, "can_surface_choice": True},
            "cue": "一个不致命但让人难堪的失误拖延了节奏。",
            "story_functions": ["complication"],
            "deck_tags": ["complication", "failure_consequence"],
            "trigger_polarity": ["negative"],
        },
        {
            "storylet_id": "medium-critical-opportunity",
            "family_id": "critical_opportunity",
            "trope_id": "lucky_break",
            "conflict_level": "medium",
            "base_weight": 1,
            "scene_actions": ["SUBSYSTEM", "PRESSURE", "DEEPEN"],
            "eligible_scene_types": ["investigation"],
            "scene_tags": ["wrongness"],
            "horror_stage": ["wrongness", "pattern"],
            "requires": {"npc_id": False, "unrevealed_clue": False, "active_front": False},
            "serves": {"mainline": True, "theme": True, "can_surface_choice": True},
            "cue": "一次漂亮的手气在小事上带来意外收获。",
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
        "risk_level": "high",
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
        "risk_level": "high",
        "stakes": "敌人乱刺露出破绽",
    }]

    enriched = narr.enrich_storylets_after_rules(plan, _storylet_gate_ctx("restrain"))

    assert enriched["storylet_moves"]
    assert enriched["storylet_moves"][0]["target_conflict_level"] == "high"
    assert enriched["storylet_moves"][0]["storylet_id"] == "high-enemy-fumble-opportunity"
    assert enriched["narrative_enrichment"]["storylet_trigger"]["reason"] == "fumble"
    assert enriched["narrative_enrichment"]["storylet_trigger"]["polarity"] == "positive"


def test_low_risk_fumble_triggers_medium_conflict_storylet():
    """A fumble on a low-stakes action should not be force-ranked 'high' conflict.

    P2-2: crit/fumble conflict_level is calibrated by the action's risk_level
    rather than unconditionally 'high'. Low-risk fumbles are still a meaningful
    beat (>= medium) but no longer saturate the conflict dial.
    """
    plan = narr.enrich_director_plan(_storylet_gate_plan("SUBSYSTEM"), _storylet_gate_ctx("organize_notes"))
    plan["rules_results"] = [{
        "skill": "Library Use",
        "roll": 100,
        "target": 75,
        "outcome": "fumble",
        "risk_level": "low",
        "stakes": "笔记卡片散落一地",
    }]

    enriched = narr.enrich_storylets_after_rules(plan, _storylet_gate_ctx("organize_notes"))

    assert enriched["storylet_moves"]
    assert enriched["storylet_moves"][0]["target_conflict_level"] == "medium"
    assert enriched["narrative_enrichment"]["storylet_trigger"]["reason"] == "fumble"
    assert enriched["narrative_enrichment"]["storylet_trigger"]["conflict_level"] == "medium"


def test_low_risk_critical_triggers_medium_conflict_storylet():
    """A critical success on a low-stakes action yields a medium, not high, beat."""
    plan = narr.enrich_director_plan(_storylet_gate_plan("SUBSYSTEM"), _storylet_gate_ctx("investigate"))
    plan["rules_results"] = [{
        "skill": "Library Use",
        "roll": 1,
        "target": 75,
        "outcome": "critical",
        "risk_level": "low",
        "stakes": "恰好翻到需要的页码",
    }]

    enriched = narr.enrich_storylets_after_rules(plan, _storylet_gate_ctx("investigate"))

    assert enriched["storylet_moves"]
    assert enriched["storylet_moves"][0]["target_conflict_level"] == "medium"
    assert enriched["narrative_enrichment"]["storylet_trigger"]["reason"] == "critical_success"
    assert enriched["narrative_enrichment"]["storylet_trigger"]["conflict_level"] == "medium"


def test_high_risk_critical_triggers_high_conflict_storylet():
    """A critical success on a high-stakes action still yields a high-conflict beat."""
    plan = narr.enrich_director_plan(_storylet_gate_plan("SUBSYSTEM"), _storylet_gate_ctx("investigate"))
    plan["rules_results"] = [{
        "skill": "Fighting (Brawl)",
        "roll": 1,
        "target": 50,
        "outcome": "critical",
        "risk_level": "lethal",
        "stakes": "一击制敌",
    }]

    enriched = narr.enrich_storylets_after_rules(plan, _storylet_gate_ctx("investigate"))

    assert enriched["storylet_moves"]
    assert enriched["storylet_moves"][0]["target_conflict_level"] == "high"
    assert enriched["narrative_enrichment"]["storylet_trigger"]["reason"] == "critical_success"
    assert enriched["narrative_enrichment"]["storylet_trigger"]["conflict_level"] == "high"


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


def test_stop_actionability_turn_focus_promotes_fresh_handle():
    turn = {
        "choice_frame": {"routes": [], "is_real_fork": False, "open_route_count": 0},
    }
    active_scene = {
        "visible_affordances": [
            {"route": "ask-tenants", "cue": "问前租客", "route_type": "tenant_history"},
            {"route": "enter-house", "cue": "进屋", "route_type": "direct_entry"},
        ],
    }
    turn_focus = {
        "focus_axis": "tenant_history",
        "focus_target_id": "ask-tenants",
        "focus_reason": "intent_router_structured_match:tenant_history",
    }
    contract = narr.build_stop_actionability_contract(
        turn, active_scene, stop_reason="awaiting_player_input", turn_focus=turn_focus,
    )
    assert contract["immediate_handles"]
    assert contract["immediate_handles"][0]["route_id"] == "ask-tenants"
    assert contract["immediate_handles"][0]["freshness"] == "turn_focus"


def test_stop_actionability_no_focus_falls_back_to_static():
    turn = {"choice_frame": {"routes": []}}
    active_scene = {
        "visible_affordances": [{"route": "old-1", "cue": "老选项"}],
    }
    contract = narr.build_stop_actionability_contract(
        turn, active_scene, stop_reason="awaiting_player_input", turn_focus=None,
    )
    # No focus → static fallback (old option still there)
    assert contract["immediate_handles"][0]["route_id"] == "old-1"


def test_turn_focus_reads_visible_affordances_fallback():
    """build_turn_focus_contract must also read visible_affordances (the field
    name used in active-scene.json), not only 'affordances'."""
    ctx = {
        "player_intent_rich": {
            "primary_intent": "investigate",
            "action_atoms": [{"id": "a1", "topic": "history"}],
        },
        "active_scene": {
            "visible_affordances": [  # NOTE: visible_affordances, not affordances
                {"id": "ask-tenants", "cue": "问前租客", "route_type": "tenant_history"},
            ],
        },
    }
    focus = narr.build_turn_focus_contract(ctx)
    assert focus is not None
    assert focus["focus_target_id"] == "ask-tenants"


# =============================================================================
# P1-8: dialogue comprehension tier wiring (foreign dialogue)
# =============================================================================

def _foreign_dialogue_scene():
    return {
        "scene_id": "tunnel-meeting",
        "npc_ids": ["npc-austrian-survivor"],
    }


def _foreign_dialogue_agendas():
    return {"npcs": [
        {
            "npc_id": "npc-austrian-survivor",
            "agenda": "lash out at anything that moves",
            "foreign_dialogue": {
                "source_language": "German",
                "sample_line": "Der Schrecken ist unten.",
            },
        },
    ]}


def _investigator_with_german(skill_value: int) -> dict:
    return {"skills": {
        "Language (Own: Italian)": 64,
        "Language (Other: German)": skill_value,
    }}


def test_dialogue_comprehension_directive_low_skill_yields_gist_or_none():
    """When the investigator's source-language skill is low, the directive
    must instruct the narrator to show source/fragments, NOT full translation."""
    plan = {"clue_policy": {}, "rules_requests": [], "npc_moves": [], "narrative_directives": {}, "handoff": "narration"}
    ctx = {
        "active_scene": _foreign_dialogue_scene(),
        "player_intent_rich": {"action_atoms": []},
        "npc_agendas": _foreign_dialogue_agendas(),
        "investigator": _investigator_with_german(5),  # tier 'gist' (1-19)
    }
    enriched = narr.enrich_director_plan(plan, ctx)
    dc = enriched["narrative_directives"]["dialogue_comprehension"]
    assert len(dc) == 1
    entry = dc[0]
    assert entry["npc_id"] == "npc-austrian-survivor"
    assert entry["source_language"] == "German"
    assert entry["comprehension"] in {"gist", "none"}
    assert entry["skill_value"] == 5
    # The rule must demand source-language display and forbid full translation.
    assert entry["rule"]
    assert "source" in entry["rule"].lower() or "源" in entry["rule"]
    assert entry["translation_visible"] is False


def test_dialogue_comprehension_directive_fluent_allows_full_translation():
    """When the investigator is fluent, the directive must NOT force
    source-only display."""
    plan = {"clue_policy": {}, "rules_requests": [], "npc_moves": [], "narrative_directives": {}, "handoff": "narration"}
    ctx = {
        "active_scene": _foreign_dialogue_scene(),
        "player_intent_rich": {"action_atoms": []},
        "npc_agendas": _foreign_dialogue_agendas(),
        "investigator": _investigator_with_german(60),  # tier 'fluent'
    }
    enriched = narr.enrich_director_plan(plan, ctx)
    dc = enriched["narrative_directives"]["dialogue_comprehension"]
    entry = dc[0]
    assert entry["comprehension"] == "fluent"
    assert entry["translation_visible"] is True


def test_dialogue_comprehension_directive_absent_when_no_foreign_dialogue():
    """NPCs without foreign_dialogue markers must NOT produce a directive."""
    plan = {"clue_policy": {}, "rules_requests": [], "npc_moves": [], "narrative_directives": {}, "handoff": "narration"}
    agendas = {"npcs": [{"npc_id": "npc-austrian-survivor", "agenda": "no marker"}]}
    ctx = {
        "active_scene": _foreign_dialogue_scene(),
        "player_intent_rich": {"action_atoms": []},
        "npc_agendas": agendas,
        "investigator": _investigator_with_german(5),
    }
    enriched = narr.enrich_director_plan(plan, ctx)
    # directive key should be absent (no foreign dialogue in scene)
    assert "dialogue_comprehension" not in enriched["narrative_directives"]


def test_dialogue_comprehension_directive_only_scenes_npcs_in_scene():
    """Only NPCs listed in scene.npc_ids should be considered."""
    plan = {"clue_policy": {}, "rules_requests": [], "npc_moves": [], "narrative_directives": {}, "handoff": "narration"}
    agendas = {"npcs": [
        {"npc_id": "npc-austrian-survivor", "agenda": "x", "foreign_dialogue": {"source_language": "German"}},
        {"npc_id": "npc-not-here", "agenda": "y", "foreign_dialogue": {"source_language": "German"}},
    ]}
    ctx = {
        "active_scene": {"scene_id": "s", "npc_ids": ["npc-austrian-survivor"]},
        "player_intent_rich": {"action_atoms": []},
        "npc_agendas": agendas,
        "investigator": _investigator_with_german(5),
    }
    enriched = narr.enrich_director_plan(plan, ctx)
    dc = enriched["narrative_directives"]["dialogue_comprehension"]
    assert [e["npc_id"] for e in dc] == ["npc-austrian-survivor"]


def test_dialogue_comprehension_directive_placeholder_when_no_investigator():
    """When the investigator's skills are not available in ctx, the directive
    must still be emitted with a structured placeholder so the narrator/runner
    can fill the comprehension gate from the actual character sheet.

    Constitution: source_language remains structured; the placeholder carries
    comprehension=None and a rule instructing the narrator to gate on the
    investigator's structured Language skill value (no prose scan)."""
    plan = {"clue_policy": {}, "rules_requests": [], "npc_moves": [], "narrative_directives": {}, "handoff": "narration"}
    ctx = {
        "active_scene": _foreign_dialogue_scene(),
        "player_intent_rich": {"action_atoms": []},
        "npc_agendas": _foreign_dialogue_agendas(),
        # NOTE: no "investigator" key — runner did not pre-populate it
    }
    enriched = narr.enrich_director_plan(plan, ctx)
    dc = enriched["narrative_directives"]["dialogue_comprehension"]
    entry = dc[0]
    assert entry["source_language"] == "German"
    assert entry["comprehension"] is None
    assert entry["requires_investigator_skill"] is True
    assert entry["rule"]  # narrator-facing rule still present


def test_dialogue_comprehension_directive_uses_investigator_skills_dict():
    """A caller may pass a slim investigator_skills dict directly instead of
    the full investigator object. Both paths must resolve the skill value."""
    plan = {"clue_policy": {}, "rules_requests": [], "npc_moves": [], "narrative_directives": {}, "handoff": "narration"}
    ctx = {
        "active_scene": _foreign_dialogue_scene(),
        "player_intent_rich": {"action_atoms": []},
        "npc_agendas": _foreign_dialogue_agendas(),
        "investigator_skills": {"Language (Other: German)": 25},  # tier 'partial'
    }
    enriched = narr.enrich_director_plan(plan, ctx)
    dc = enriched["narrative_directives"]["dialogue_comprehension"]
    entry = dc[0]
    assert entry["comprehension"] == "partial"
    assert entry["skill_value"] == 25


def test_dialogue_comprehension_directive_absent_when_coc_language_unavailable():
    """If coc_language.py cannot be loaded (optional sibling missing),
    enrichment must NOT crash and must NOT emit a malformed directive."""
    plan = {"clue_policy": {}, "rules_requests": [], "npc_moves": [], "narrative_directives": {}, "handoff": "narration"}
    ctx = {
        "active_scene": _foreign_dialogue_scene(),
        "player_intent_rich": {"action_atoms": []},
        "npc_agendas": _foreign_dialogue_agendas(),
        "investigator": _investigator_with_german(5),
    }
    # Simulate coc_language missing by patching the module attribute
    original = narr.coc_language
    narr.coc_language = None
    try:
        enriched = narr.enrich_director_plan(plan, ctx)
        assert "dialogue_comprehension" not in enriched["narrative_directives"]
    finally:
        narr.coc_language = original


def test_build_dialogue_comprehension_directive_helper_signature():
    """The helper returns a structured list; each entry has the canonical keys."""
    scene = _foreign_dialogue_scene()
    agendas = _foreign_dialogue_agendas()
    investigator = _investigator_with_german(10)
    dc = narr.build_dialogue_comprehension_directive(scene, agendas, investigator)
    assert isinstance(dc, list)
    assert len(dc) == 1
    entry = dc[0]
    for key in ("npc_id", "source_language", "skill_value", "comprehension",
                "translation_visible", "rule"):
        assert key in entry
