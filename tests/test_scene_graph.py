"""R-3 scene graph: scene_edges unlock model + legacy linear fallback.

Semantic Matcher Constitution: unlock/travel use structured exit-condition
``when`` objects only — never free-text keyword scans.
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, rel)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


coc_scene_graph = _load("coc_scene_graph", "plugins/coc-keeper/scripts/coc_scene_graph.py")
coc_exit_conditions = _load(
    "coc_exit_conditions", "plugins/coc-keeper/scripts/coc_exit_conditions.py"
)
coc_director_apply = _load(
    "coc_director_apply", "plugins/coc-keeper/scripts/coc_director_apply.py"
)
coc_story_director = _load(
    "coc_story_director", "plugins/coc-keeper/scripts/coc_story_director.py"
)


def _campaign(tmp_path: Path) -> Path:
    camp = tmp_path / "campaigns" / "test"
    (camp / "save").mkdir(parents=True)
    (camp / "save" / "investigator-state").mkdir()
    (camp / "scenario").mkdir(parents=True)
    (camp / "logs").mkdir(parents=True)
    (camp / "memory" / "cards" / "player-safe").mkdir(parents=True)
    (camp / "save" / "world-state.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "campaign_id": "test",
                "discovered_clue_ids": [],
                "active_scene_id": "archive",
            }
        )
    )
    (camp / "save" / "pacing-state.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "tension_level": "low",
                "lethal_chances_used": 0,
                "recent_intent_classes": [],
                "turn_number": 0,
                "luck_spent_last": 0,
            }
        )
    )
    (camp / "save" / "flags.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "campaign_id": "test",
                "clues_found": {},
                "decisions": [],
                "spoiler_reveals": [],
                "flags": {},
            }
        )
    )
    (camp / "logs" / "events.jsonl").write_text("")
    return camp


def _branching_graph() -> dict:
    return {
        "scenes": [
            {
                "scene_id": "archive",
                "is_start": True,
                "available_clues": ["clue-warehouse-lead"],
                "dramatic_question": "find the warehouse lead?",
                "exit_conditions": [],
                "scene_edges": [
                    {
                        "to": "warehouse",
                        "kind": "unlock",
                        "when": {
                            "kind": "clue_discovered",
                            "clue_id": "clue-warehouse-lead",
                        },
                    },
                    {
                        "to": "street",
                        "kind": "travel",
                        "when": {"kind": "always"},
                    },
                ],
            },
            {
                "scene_id": "warehouse",
                "available_clues": ["clue-ritual"],
                "dramatic_question": "what is in the warehouse?",
                "exit_conditions": [],
                "scene_edges": [
                    {
                        "to": "finale",
                        "kind": "travel",
                        "when": {
                            "kind": "clue_discovered",
                            "clue_id": "clue-ritual",
                        },
                    },
                ],
            },
            {
                "scene_id": "street",
                "available_clues": [],
                "dramatic_question": "leave for now?",
                "exit_conditions": [],
                "scene_edges": [],
            },
            {
                "scene_id": "finale",
                "scene_type": "resolution",
                "is_final": True,
                "available_clues": [],
                "dramatic_question": "how does it end?",
                "exit_conditions": [],
                "scene_edges": [],
            },
        ]
    }


# ---------------------------------------------------------------------------
# Schema / derive edges
# ---------------------------------------------------------------------------


def test_legacy_linear_fallback_derives_array_order_edges():
    sg = {
        "scenes": [
            {"scene_id": "a", "available_clues": []},
            {"scene_id": "b", "available_clues": []},
            {"scene_id": "c", "available_clues": []},
        ]
    }
    edges = coc_scene_graph.derive_scene_edges(sg)
    assert edges["a"] == [
        {
            "to": "b",
            "kind": "travel",
            "when": {"kind": "always"},
            "legacy": True,
        }
    ]
    assert edges["b"][0]["to"] == "c"
    assert edges["b"][0]["legacy"] is True
    assert edges["c"] == []


def test_explicit_scene_edges_used_not_array_order():
    sg = _branching_graph()
    # warehouse is index 1, but archive's travel edge goes to street (index 2)
    edges = coc_scene_graph.derive_scene_edges(sg)
    targets = {e["to"] for e in edges["archive"]}
    assert targets == {"warehouse", "street"}
    assert all(e.get("legacy") is not True for e in edges["archive"])


# ---------------------------------------------------------------------------
# Unlock evaluation
# ---------------------------------------------------------------------------


def test_legacy_linear_unlocks_only_next_scene_when_start_active():
    """Travel/cut edges need source locality — no full-chain cascade on turn 1."""
    sg = {
        "scenes": [
            {"scene_id": "a", "is_start": True, "available_clues": []},
            {"scene_id": "b", "available_clues": []},
            {"scene_id": "c", "available_clues": []},
            {"scene_id": "d", "available_clues": []},
        ]
    }
    world = {
        "active_scene_id": "a",
        "unlocked_scene_ids": ["a"],
        "visited_scene_ids": ["a"],
        "discovered_clue_ids": [],
    }
    newly = coc_scene_graph.evaluate_unlocks(sg, world)
    assert newly == ["b"]
    assert "c" not in newly
    assert "d" not in newly


def test_legacy_linear_entering_scene_2_unlocks_scene_3():
    """Once scene 2 is visited/active, its always-travel edge unlocks scene 3."""
    sg = {
        "scenes": [
            {"scene_id": "a", "is_start": True, "available_clues": []},
            {"scene_id": "b", "available_clues": []},
            {"scene_id": "c", "available_clues": []},
        ]
    }
    world = {
        "active_scene_id": "b",
        "unlocked_scene_ids": ["a", "b"],
        "visited_scene_ids": ["a", "b"],
        "discovered_clue_ids": [],
    }
    newly = coc_scene_graph.evaluate_unlocks(sg, world)
    assert newly == ["c"]


def test_explicit_unlock_edges_still_fire_from_anywhere():
    """kind=unlock remains a global condition gate (clue opens warehouse anywhere)."""
    sg = _branching_graph()
    world = {
        "active_scene_id": "street",
        "unlocked_scene_ids": ["archive", "street"],
        "visited_scene_ids": ["street"],
        "discovered_clue_ids": ["clue-warehouse-lead"],
    }
    newly = coc_scene_graph.evaluate_unlocks(sg, world)
    assert "warehouse" in newly


def test_travel_unlock_is_one_wave_not_fixpoint():
    """Newly unlocked scenes do not cascade further within the same evaluate call."""
    sg = {
        "scenes": [
            {
                "scene_id": "hub",
                "is_start": True,
                "available_clues": [],
                "dramatic_question": "q",
                "scene_edges": [
                    {"to": "side", "kind": "travel", "when": {"kind": "always"}},
                ],
            },
            {
                "scene_id": "side",
                "available_clues": [],
                "dramatic_question": "q2",
                "scene_edges": [
                    {"to": "secret", "kind": "travel", "when": {"kind": "always"}},
                ],
            },
            {
                "scene_id": "secret",
                "available_clues": [],
                "dramatic_question": "q3",
                "scene_edges": [],
            },
        ]
    }
    world = {
        "active_scene_id": "hub",
        "unlocked_scene_ids": ["hub"],
        "visited_scene_ids": ["hub"],
        "discovered_clue_ids": [],
    }
    newly = coc_scene_graph.evaluate_unlocks(sg, world)
    assert newly == ["side"]
    assert "secret" not in newly


def test_unlock_on_condition_satisfaction(tmp_path):
    camp = _campaign(tmp_path)
    sg = _branching_graph()
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(sg))
    world = json.loads((camp / "save" / "world-state.json").read_text())
    world["active_scene_id"] = "archive"
    (camp / "save" / "world-state.json").write_text(json.dumps(world))

    plan = {
        "decision_id": "d-unlock",
        "scene_action": "REVEAL",
        "clue_policy": {"reveal": ["clue-warehouse-lead"]},
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {},
        "narrative_directives": {},
    }
    events = coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    world2 = json.loads((camp / "save" / "world-state.json").read_text())
    assert "warehouse" in world2["unlocked_scene_ids"]
    assert "archive" in world2["unlocked_scene_ids"]  # start
    assert any(e.get("event_type") == "scene_unlocked" for e in events)
    unlock_ev = next(e for e in events if e.get("event_type") == "scene_unlocked")
    assert unlock_ev["to_scene"] == "warehouse"


def test_no_unlock_without_condition(tmp_path):
    camp = _campaign(tmp_path)
    sg = _branching_graph()
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(sg))
    plan = {
        "decision_id": "d-no-unlock",
        "scene_action": "DEEPEN",
        "clue_policy": {"reveal": []},
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {},
        "narrative_directives": {},
    }
    coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    world2 = json.loads((camp / "save" / "world-state.json").read_text())
    assert "warehouse" not in world2.get("unlocked_scene_ids", [])
    assert "archive" in world2["unlocked_scene_ids"]


def test_flag_set_condition_unlocks(tmp_path):
    camp = _campaign(tmp_path)
    sg = {
        "scenes": [
            {
                "scene_id": "hub",
                "is_start": True,
                "available_clues": [],
                "dramatic_question": "q",
                "scene_edges": [
                    {
                        "to": "side",
                        "kind": "unlock",
                        "when": {"kind": "flag_set", "flag_id": "met_informant"},
                    }
                ],
            },
            {"scene_id": "side", "available_clues": [], "dramatic_question": "q2", "scene_edges": []},
        ]
    }
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(sg))
    flags = json.loads((camp / "save" / "flags.json").read_text())
    flags["flags"] = {"met_informant": True}
    (camp / "save" / "flags.json").write_text(json.dumps(flags))
    world = json.loads((camp / "save" / "world-state.json").read_text())
    world["active_scene_id"] = "hub"
    (camp / "save" / "world-state.json").write_text(json.dumps(world))

    plan = {
        "decision_id": "d-flag",
        "scene_action": "CHARACTER",
        "clue_policy": {"reveal": []},
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {},
        "narrative_directives": {},
    }
    events = coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    world2 = json.loads((camp / "save" / "world-state.json").read_text())
    assert "side" in world2["unlocked_scene_ids"]
    assert any(e.get("event_type") == "scene_unlocked" and e.get("to_scene") == "side" for e in events)


# ---------------------------------------------------------------------------
# Director candidates + CUT gating
# ---------------------------------------------------------------------------


def test_director_offers_only_unlocked_targets():
    sg = _branching_graph()
    world = {
        "active_scene_id": "archive",
        "discovered_clue_ids": [],
        "unlocked_scene_ids": ["archive", "street"],
        "visited_scene_ids": ["archive"],
        "exhausted_scene_ids": [],
    }
    candidates = coc_scene_graph.transition_candidates(
        "archive", sg, world
    )
    assert set(candidates) == {"street"}
    assert "warehouse" not in candidates

    world["unlocked_scene_ids"] = ["archive", "street", "warehouse"]
    candidates2 = coc_scene_graph.transition_candidates("archive", sg, world)
    assert set(candidates2) == {"street", "warehouse"}


def test_cut_cannot_jump_to_locked_scene(tmp_path):
    camp = _campaign(tmp_path)
    sg = _branching_graph()
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(sg))
    world = json.loads((camp / "save" / "world-state.json").read_text())
    world["active_scene_id"] = "archive"
    world["unlocked_scene_ids"] = ["archive", "street"]
    (camp / "save" / "world-state.json").write_text(json.dumps(world))

    plan = {
        "decision_id": "d-cut-locked",
        "scene_action": "CUT",
        "transition_to": "warehouse",  # locked
        "clue_policy": {"reveal": []},
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {},
        "narrative_directives": {},
    }
    coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    world2 = json.loads((camp / "save" / "world-state.json").read_text())
    assert world2["active_scene_id"] == "archive"  # refused


def test_cut_travels_to_unlocked_edge_target(tmp_path):
    camp = _campaign(tmp_path)
    sg = _branching_graph()
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(sg))
    world = json.loads((camp / "save" / "world-state.json").read_text())
    world["active_scene_id"] = "archive"
    world["unlocked_scene_ids"] = ["archive", "street"]
    (camp / "save" / "world-state.json").write_text(json.dumps(world))

    plan = {
        "decision_id": "d-cut-ok",
        "scene_action": "CUT",
        "transition_to": "street",
        "clue_policy": {"reveal": []},
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {},
        "narrative_directives": {},
    }
    events = coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    world2 = json.loads((camp / "save" / "world-state.json").read_text())
    assert world2["active_scene_id"] == "street"
    assert "street" in world2["visited_scene_ids"]
    assert any(e.get("event_type") == "scene_transition" for e in events)


def test_director_cut_score_zero_without_unlocked_targets():
    ctx = {
        "active_scene": {
            "scene_id": "archive",
            "exit_conditions": [{"kind": "always"}],
            "available_clues": [],
        },
        "active_scene_id": "archive",
        "story_graph": _branching_graph(),
        "world_state": {
            "unlocked_scene_ids": ["archive"],
            "exhausted_scene_ids": [],
            "discovered_clue_ids": [],
        },
        "player_intent_class": "idle",
        "rule_signals": {},
    }
    # exit always met, but no unlocked travel targets → CUT score 0
    score = coc_story_director._base_score("CUT", ctx)
    assert score == 0.0


# ---------------------------------------------------------------------------
# Terminal detection
# ---------------------------------------------------------------------------


def test_terminal_via_no_outgoing_edges():
    sg = _branching_graph()
    street = next(s for s in sg["scenes"] if s["scene_id"] == "street")
    finale = next(s for s in sg["scenes"] if s["scene_id"] == "finale")
    archive = next(s for s in sg["scenes"] if s["scene_id"] == "archive")
    assert coc_scene_graph.is_terminal_scene(street, sg) is True
    assert coc_scene_graph.is_terminal_scene(finale, sg) is True
    assert coc_scene_graph.is_terminal_scene(archive, sg) is False


def test_terminal_legacy_last_in_array():
    sg = {
        "scenes": [
            {"scene_id": "a", "available_clues": []},
            {"scene_id": "b", "available_clues": []},
        ]
    }
    assert coc_scene_graph.is_terminal_scene(sg["scenes"][1], sg) is True
    assert coc_scene_graph.is_terminal_scene(sg["scenes"][0], sg) is False


def test_apply_payoff_terminal_by_empty_edges(tmp_path):
    camp = _campaign(tmp_path)
    (camp / "campaign.json").write_text(
        json.dumps({"campaign_id": "test", "scenario_id": "x"}), encoding="utf-8"
    )
    # finale is NOT last in array, but has no outgoing edges
    sg = {
        "scenes": [
            {
                "scene_id": "hub",
                "is_start": True,
                "available_clues": [],
                "dramatic_question": "q",
                "scene_edges": [
                    {"to": "finale", "kind": "travel", "when": {"kind": "always"}},
                    {"to": "epilogue-note", "kind": "travel", "when": {"kind": "always"}},
                ],
            },
            {
                "scene_id": "finale",
                "available_clues": [],
                "dramatic_question": "end?",
                "scene_edges": [],
            },
            {
                "scene_id": "epilogue-note",
                "available_clues": [],
                "dramatic_question": "optional note",
                "scene_edges": [
                    {"to": "hub", "kind": "travel", "when": {"kind": "always"}},
                ],
            },
        ]
    }
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(sg))
    world = json.loads((camp / "save" / "world-state.json").read_text())
    world["active_scene_id"] = "finale"
    world["unlocked_scene_ids"] = ["hub", "finale", "epilogue-note"]
    (camp / "save" / "world-state.json").write_text(json.dumps(world))

    plan = {
        "decision_id": "d-end-edges",
        "scene_action": "PAYOFF",
        "clue_policy": {"reveal": []},
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {},
        "narrative_directives": {},
    }
    events = coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    assert any(
        e.get("type") == "session_ending" or e.get("event_type") == "session_ending"
        for e in events
    )


# ---------------------------------------------------------------------------
# World-state persistence round-trip
# ---------------------------------------------------------------------------


def test_world_state_scene_fields_persist_round_trip(tmp_path):
    camp = _campaign(tmp_path)
    sg = _branching_graph()
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(sg))
    world = json.loads((camp / "save" / "world-state.json").read_text())
    world["active_scene_id"] = "archive"
    world["unlocked_scene_ids"] = ["archive", "street"]
    (camp / "save" / "world-state.json").write_text(json.dumps(world))

    plan = {
        "decision_id": "d-persist",
        "scene_action": "CUT",
        "transition_to": "street",
        "clue_policy": {"reveal": []},
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {},
        "narrative_directives": {},
    }
    coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    world2 = json.loads((camp / "save" / "world-state.json").read_text())
    assert "unlocked_scene_ids" in world2
    assert "visited_scene_ids" in world2
    assert "exhausted_scene_ids" in world2
    assert "scene_history" in world2
    assert world2["active_scene_id"] == "street"
    assert "street" in world2["visited_scene_ids"]
    assert any(h.get("scene_id") == "street" for h in world2["scene_history"])
    # re-read after second apply must keep lists
    plan2 = {
        "decision_id": "d-persist-2",
        "scene_action": "DEEPEN",
        "clue_policy": {"reveal": []},
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {},
        "narrative_directives": {},
    }
    coc_director_apply.apply_plan(camp, plan2, investigator_id="inv1")
    world3 = json.loads((camp / "save" / "world-state.json").read_text())
    assert world3["visited_scene_ids"] == world2["visited_scene_ids"]
    assert len(world3["scene_history"]) >= 1


# ---------------------------------------------------------------------------
# Exit-condition vocabulary extensions
# ---------------------------------------------------------------------------


def test_exit_condition_always_and_flag_set():
    assert coc_exit_conditions.normalize_exit_condition({"kind": "always"}) == {
        "kind": "always"
    }
    assert coc_exit_conditions.evaluate_exit_condition(
        {"kind": "always"},
        discovered_clue_ids=set(),
        clock_reached=lambda c, t: False,
    )
    assert coc_exit_conditions.normalize_exit_condition(
        {"kind": "flag_set", "flag_id": "met_informant"}
    ) == {"kind": "flag_set", "flag_id": "met_informant"}
    assert coc_exit_conditions.evaluate_exit_condition(
        {"kind": "flag_set", "flag_id": "met_informant"},
        discovered_clue_ids=set(),
        clock_reached=lambda c, t: False,
        flags_set={"met_informant"},
    )
    assert not coc_exit_conditions.evaluate_exit_condition(
        {"kind": "flag_set", "flag_id": "met_informant"},
        discovered_clue_ids=set(),
        clock_reached=lambda c, t: False,
        flags_set=set(),
    )


def test_legacy_linear_cut_still_advances(tmp_path):
    """Graphs without scene_edges keep array-order advance (legacy)."""
    camp = _campaign(tmp_path)
    world = json.loads((camp / "save" / "world-state.json").read_text())
    world["active_scene_id"] = "scene-1"
    (camp / "save" / "world-state.json").write_text(json.dumps(world))
    sg = {
        "scenes": [
            {
                "scene_id": "scene-1",
                "is_start": True,
                "available_clues": ["clue-A", "clue-B"],
                "dramatic_question": "q",
                "entry_conditions": [],
                "exit_conditions": [],
            },
            {
                "scene_id": "scene-2",
                "available_clues": ["clue-C"],
                "dramatic_question": "q2",
                "entry_conditions": [],
                "exit_conditions": [],
            },
        ]
    }
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(sg))
    plan = {
        "decision_id": "d-legacy-cut",
        "scene_action": "CUT",
        "clue_policy": {"reveal": []},
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {},
        "narrative_directives": {},
    }
    coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    world2 = json.loads((camp / "save" / "world-state.json").read_text())
    assert world2["active_scene_id"] == "scene-2"


# ---------------------------------------------------------------------------
# Move-intent location_tags matching
# ---------------------------------------------------------------------------


def test_rank_move_targets_prefers_location_tag_match():
    """Structured target_entities ∩ location_tags picks the named scene."""
    sg = {
        "scenes": [
            {
                "scene_id": "hall-of-records",
                "location_tags": ["hall of records", "archives", "档案厅"],
            },
            {
                "scene_id": "corbitt-house-ground",
                "location_tags": ["corbitt house", "old house", "科比特老宅", "house"],
            },
        ]
    }
    candidates = ["hall-of-records", "corbitt-house-ground"]
    chosen, evidence = coc_scene_graph.rank_move_targets(
        candidates, sg, ["corbitt house"]
    )
    assert chosen == "corbitt-house-ground"
    assert evidence is not None
    assert evidence["scene_id"] == "corbitt-house-ground"
    assert "corbitt house" in evidence["matched_entities"]
    assert evidence["score"] >= 1


def test_rank_move_targets_exact_scene_id_match():
    sg = {
        "scenes": [
            {"scene_id": "hall-of-records", "location_tags": ["archives"]},
            {"scene_id": "corbitt-house-ground", "location_tags": ["house"]},
        ]
    }
    chosen, evidence = coc_scene_graph.rank_move_targets(
        ["hall-of-records", "corbitt-house-ground"],
        sg,
        ["Corbitt-House-Ground"],
    )
    assert chosen == "corbitt-house-ground"
    assert evidence is not None
    assert evidence["score"] >= 1


def test_rank_move_targets_zero_match_keeps_candidate_order():
    sg = {
        "scenes": [
            {"scene_id": "hall-of-records", "location_tags": ["archives"]},
            {"scene_id": "corbitt-house-ground", "location_tags": ["house"]},
        ]
    }
    candidates = ["hall-of-records", "corbitt-house-ground"]
    chosen, evidence = coc_scene_graph.rank_move_targets(
        candidates, sg, ["newspaper morgue"]
    )
    assert chosen == "hall-of-records"
    assert evidence is None


def test_rank_move_targets_tie_keeps_candidate_order():
    sg = {
        "scenes": [
            {
                "scene_id": "hall-of-records",
                "location_tags": ["records", "house"],
            },
            {
                "scene_id": "corbitt-house-ground",
                "location_tags": ["corbitt house", "house"],
            },
        ]
    }
    candidates = ["hall-of-records", "corbitt-house-ground"]
    chosen, evidence = coc_scene_graph.rank_move_targets(
        candidates, sg, ["house"]
    )
    assert chosen == "hall-of-records"
    assert evidence is None


def test_resolve_move_flag_commits_matches_locked_destination():
    sg = {
        "scenes": [
            {
                "scene_id": "lima-museum",
                "location_tags": ["museum"],
                "scene_edges": [
                    {
                        "to": "travel-to-puno",
                        "kind": "unlock",
                        "when": {"kind": "flag_set", "flag_id": "expedition_departs_lima"},
                    }
                ],
            },
            {
                "scene_id": "travel-to-puno",
                "location_tags": ["train", "travel", "火车"],
                "scene_edges": [],
            },
        ]
    }
    world = {
        "active_scene_id": "lima-museum",
        "unlocked_scene_ids": ["lima-museum"],
        "visited_scene_ids": ["lima-museum"],
        "exhausted_scene_ids": [],
        "discovered_clue_ids": [],
    }
    gated = coc_scene_graph.resolve_move_flag_commits(
        "lima-museum", sg, world, ["travel-to-puno"]
    )
    assert gated is not None
    assert gated["to_scene"] == "travel-to-puno"
    assert gated["flag_ids"] == ["expedition_departs_lima"]


def test_resolve_scene_flag_commits_intersects_target_tags():
    scene = {
        "scene_id": "andean-pyramid-interior",
        "flag_commits": [
            {
                "flag_id": "ward_repaired",
                "intent_classes": ["investigate"],
                "target_tags": ["cracked ward", "golden ward fragment"],
            }
        ],
    }
    assert coc_scene_graph.resolve_scene_flag_commits(
        scene,
        intent_class="investigate",
        target_entities=["golden ward fragment", "cracked ward"],
    ) == ["ward_repaired"]
    assert coc_scene_graph.resolve_scene_flag_commits(
        scene, intent_class="move", target_entities=["cracked ward"]
    ) == []
