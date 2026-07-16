"""G1: computable clue affordance matching (structured intent ∩ clue affordance).

Semantic Matcher Constitution: matching uses only structured intent fields
(target_entities, action_atoms.verb/skill) and compile-time affordance lists —
never player prose or delivery strings.
"""
from __future__ import annotations

import importlib.util
import json
import random


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, rel)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


coc_rule_signals = _load(
    "coc_rule_signals", "plugins/coc-keeper/scripts/coc_rule_signals.py"
)
coc_story_director = _load(
    "coc_story_director", "plugins/coc-keeper/scripts/coc_story_director.py"
)
coc_scenario_compile = _load(
    "coc_scenario_compile", "plugins/coc-keeper/scripts/coc_scenario_compile.py"
)


def _clue_graph(*clues):
    return {
        "conclusions": [{
            "conclusion_id": "c1",
            "importance": "major",
            "minimum_routes": 1,
            "clues": list(clues),
            "fallback_policy": "",
        }]
    }


def test_match_entity_hit():
    intent = {
        "target_entities": ["desk", "study"],
        "action_atoms": [],
    }
    graph = _clue_graph({
        "clue_id": "clue-desk",
        "visibility": "player-safe",
        "affordance": {
            "target_entities": ["Desk", "drawer"],
            "verbs": ["search"],
            "skills": ["Spot Hidden"],
        },
    })
    hits = coc_rule_signals.match_clue_affordances(
        intent, graph, available_clue_ids=["clue-desk"]
    )
    assert len(hits) == 1
    assert hits[0]["clue_id"] == "clue-desk"
    assert hits[0]["matched"]["entities"] == ["desk"]
    assert hits[0]["score"] >= 1


def test_match_verb_and_skill_hit():
    intent = {
        "target_entities": [],
        "action_atoms": [
            {"verb": "search", "skill": "Spot Hidden"},
        ],
    }
    graph = _clue_graph({
        "clue_id": "clue-spot",
        "visibility": "player-safe",
        "affordance": {
            "target_entities": ["window"],
            "verbs": ["Search", "examine"],
            "skills": ["spot hidden"],
        },
    })
    hits = coc_rule_signals.match_clue_affordances(
        intent, graph, available_clue_ids=["clue-spot"]
    )
    assert len(hits) == 1
    assert set(hits[0]["matched"]["verbs"]) == {"search"}
    assert set(hits[0]["matched"]["skills"]) == {"spot hidden"}
    assert hits[0]["score"] == 2


def test_match_no_hit_when_sets_disjoint():
    intent = {
        "target_entities": ["garden"],
        "action_atoms": [{"verb": "listen", "skill": "Listen"}],
    }
    graph = _clue_graph({
        "clue_id": "clue-desk",
        "visibility": "player-safe",
        "affordance": {
            "target_entities": ["desk"],
            "verbs": ["search"],
            "skills": ["Spot Hidden"],
        },
    })
    hits = coc_rule_signals.match_clue_affordances(
        intent, graph, available_clue_ids=["clue-desk"]
    )
    assert hits == []


def test_match_empty_affordance_is_no_hit():
    intent = {
        "target_entities": ["desk"],
        "action_atoms": [{"verb": "search", "skill": "Spot Hidden"}],
    }
    graph = _clue_graph(
        {
            "clue_id": "clue-no-aff",
            "visibility": "player-safe",
        },
        {
            "clue_id": "clue-empty-aff",
            "visibility": "player-safe",
            "affordance": {"target_entities": [], "verbs": [], "skills": []},
        },
    )
    hits = coc_rule_signals.match_clue_affordances(
        intent, graph, available_clue_ids=["clue-no-aff", "clue-empty-aff"]
    )
    assert hits == []


def test_match_ignores_unavailable_clues():
    intent = {
        "target_entities": ["desk"],
        "action_atoms": [{"verb": "search"}],
    }
    graph = _clue_graph({
        "clue_id": "clue-desk",
        "visibility": "player-safe",
        "affordance": {
            "target_entities": ["desk"],
            "verbs": ["search"],
            "skills": [],
        },
    })
    hits = coc_rule_signals.match_clue_affordances(
        intent, graph, available_clue_ids=[]
    )
    assert hits == []


# --------------------------------------------------------------------------- #
# Compiler: affordance block shape validation (validate_compiled_scenario)
# --------------------------------------------------------------------------- #

def _compiled_with_clue(clue):
    return {
        "module_meta": {"module_id": "m", "title": "m"},
        "story_graph": {
            "structure_type": "branching_investigation",
            "start_scene_id": "s1",
            "scenes": [{
                "scene_id": "s1", "scene_type": "investigation",
                "available_clues": [clue["clue_id"]], "npc_ids": [],
                "leads_to": [], "origin": "source",
            }],
        },
        "clue_graph": {"conclusions": [{
            "conclusion_id": "c1", "importance": "major", "minimum_routes": 1,
            "clues": [clue], "fallback_policy": "", "origin": "source",
        }]},
        "npc_agendas": {"npcs": []},
        "threat_fronts": {"fronts": []},
        "pacing_map": {"pacing_curve": []},
        "improvisation_boundaries": {"keeper_secrets": [], "never_invent": []},
    }


def test_validator_accepts_well_formed_affordance():
    compiled = _compiled_with_clue({
        "clue_id": "clue-a", "visibility": "player-safe", "origin": "source",
        "affordance": {
            "target_entities": ["desk"], "verbs": ["search"], "skills": ["Spot Hidden"],
        },
    })
    findings = coc_scenario_compile.validate_compiled_scenario(compiled)
    assert not [f for f in findings if f["code"] == "invalid_affordance"]


def test_validator_flags_non_dict_affordance():
    compiled = _compiled_with_clue({
        "clue_id": "clue-a", "visibility": "player-safe", "origin": "source",
        "affordance": ["desk", "search"],
    })
    findings = coc_scenario_compile.validate_compiled_scenario(compiled)
    bad = [f for f in findings if f["code"] == "invalid_affordance"]
    assert bad and bad[0]["severity"] == "warning"
    assert "clue-a" in bad[0]["path"]


def test_validator_flags_non_list_affordance_field():
    compiled = _compiled_with_clue({
        "clue_id": "clue-a", "visibility": "player-safe", "origin": "source",
        "affordance": {"target_entities": "desk", "verbs": ["search"]},
    })
    findings = coc_scenario_compile.validate_compiled_scenario(compiled)
    bad = [f for f in findings if f["code"] == "invalid_affordance"]
    assert bad
    assert "target_entities" in bad[0]["message"]


def test_validator_flags_unknown_affordance_key():
    compiled = _compiled_with_clue({
        "clue_id": "clue-a", "visibility": "player-safe", "origin": "source",
        "affordance": {"target_entities": ["desk"], "keywords": ["hidden"]},
    })
    findings = coc_scenario_compile.validate_compiled_scenario(compiled)
    bad = [f for f in findings if f["code"] == "invalid_affordance"]
    assert bad
    assert "keywords" in bad[0]["message"]


def test_validator_silent_when_affordance_absent():
    compiled = _compiled_with_clue({
        "clue_id": "clue-a", "visibility": "player-safe", "origin": "source",
    })
    findings = coc_scenario_compile.validate_compiled_scenario(compiled)
    assert not [f for f in findings if f["code"] == "invalid_affordance"]


# --------------------------------------------------------------------------- #
# Director integration
# --------------------------------------------------------------------------- #

def _make_minimal_campaign(tmp_path):
    """Mirror the director fixture shape used by route_priority tests."""
    camp = tmp_path / "campaigns" / "affordance"
    (camp / "save").mkdir(parents=True)
    (camp / "scenario").mkdir(parents=True)
    (camp / "logs").mkdir(parents=True)
    (camp / "save" / "investigator-state").mkdir()
    char_path = tmp_path / "investigators" / "inv1" / "character.json"
    char_path.parent.mkdir(parents=True)
    char_path.write_text(json.dumps({
        "schema_version": 1,
        "investigator_id": "inv1",
        "characteristics": {"APP": 50, "INT": 60, "POW": 50, "CON": 50, "SIZ": 50,
                            "STR": 50, "DEX": 50, "EDU": 60},
        "skills": {"Spot Hidden": 40, "Credit Rating": 40, "Cthulhu Mythos": 0},
        "hp": {"current": 10, "max": 10},
        "san": {"current": 50, "max": 50},
        "luck": {"current": 50},
        "mp": {"current": 10, "max": 10},
        "conditions": [],
    }))
    (camp / "save" / "world-state.json").write_text(json.dumps({
        "schema_version": 1, "campaign_id": "affordance",
        "discovered_clue_ids": [], "active_scene_id": "scene-1",
        "unlocked_scene_ids": ["scene-1"], "visited_scene_ids": [],
        "exhausted_scene_ids": [], "scene_history": [],
    }))
    (camp / "save" / "pacing-state.json").write_text(json.dumps({
        "schema_version": 1, "tension_level": "low", "lethal_chances_used": 0,
        "recent_intent_classes": [], "turn_number": 1, "luck_spent_last": 0,
    }))
    (camp / "scenario" / "story-graph.json").write_text(json.dumps({
        "structure_type": "branching_investigation",
        "start_scene_id": "scene-1",
        "scenes": [{
            "scene_id": "scene-1",
            "scene_type": "investigation",
            "summary": "study",
            "available_clues": ["clue-high-prio", "clue-matched"],
            "npc_ids": [],
            "exit_conditions": [],
            "leads_to": [],
        }],
    }))
    (camp / "scenario" / "clue-graph.json").write_text(json.dumps({
        "conclusions": [{
            "conclusion_id": "c1",
            "importance": "critical",
            "minimum_routes": 2,
            "clues": [
                {
                    "clue_id": "clue-high-prio",
                    "delivery": "x",
                    "visibility": "player-safe",
                    "delivery_kind": "obvious",
                    "route_priority": 0.9,
                    "player_safe_summary": "a high-priority unmatched clue",
                },
                {
                    "clue_id": "clue-matched",
                    "delivery": "y",
                    "visibility": "player-safe",
                    "delivery_kind": "skill_check",
                    "skill": "Spot Hidden",
                    "route_priority": 0.2,
                    "player_safe_summary": "something under the desk blotter",
                    "affordance": {
                        "target_entities": ["desk"],
                        "verbs": ["search"],
                        "skills": ["Spot Hidden"],
                    },
                },
            ],
            "fallback_policy": "",
        }],
    }))
    (camp / "scenario" / "npc-agendas.json").write_text(json.dumps({"npcs": []}))
    (camp / "scenario" / "threat-fronts.json").write_text(json.dumps({"fronts": []}))
    (camp / "scenario" / "pacing-map.json").write_text(json.dumps({"pacing_curve": []}))
    (camp / "scenario" / "improvisation-boundaries.json").write_text(json.dumps({
        "keeper_secrets": [], "never_invent": [],
    }))
    (camp / "scenario" / "module-meta.json").write_text(json.dumps({
        "module_id": "affordance", "title": "affordance",
    }))
    return camp, char_path


def test_director_affordance_matched_clue_outranks_higher_route_priority(tmp_path):
    """Affordance match boosts REVEAL ranking above a higher route_priority non-match."""
    camp, char_path = _make_minimal_campaign(tmp_path)
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp,
        character_path=char_path,
        investigator_id="inv1",
        player_intent="search the desk",
        player_intent_class="investigate",
        player_intent_rich={
            "primary_intent": "investigate",
            "secondary_intents": [],
            "target_entities": ["desk"],
            "risk_posture": "neutral",
            "explicit_roll_request": False,
            "player_hypothesis": None,
            "action_atoms": [
                {"verb": "search", "skill": "Spot Hidden"},
            ],
        },
        rng=random.Random(42),
    )
    plan = coc_story_director.generate_director_plan(ctx, "affordance-rank")
    assert plan["scene_action"] == "REVEAL"
    assert plan["clue_policy"]["reveal"] == ["clue-matched"]
    matched = plan["clue_policy"].get("matched_affordance")
    assert matched is not None
    assert matched["clue_id"] == "clue-matched"
    assert matched["score"] >= 1
    assert "desk" in matched["matched"]["entities"]
