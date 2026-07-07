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
