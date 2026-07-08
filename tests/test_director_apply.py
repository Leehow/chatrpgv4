"""Tests for coc_director_apply: persists DirectorPlan effects to save/logs/memory."""
import importlib.util
import json
from pathlib import Path

import pytest


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, rel)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


coc_director_apply = _load("coc_director_apply", "plugins/coc-keeper/scripts/coc_director_apply.py")


def _clue_roll_contract(clue_id="clue-A"):
    return {
        "schema_version": 1,
        "goal": "surface the current obscured clue",
        "success_effect": "commit the exact planned clue",
        "failure_effect": "withhold the exact clue while keeping a fallback route or cost in motion",
        "failure_outcome_mode": "clue_with_cost",
        "roll_density_group": f"clue:{clue_id}",
        "must_not": ["do not reveal exact withheld clue on failure"],
    }


def _campaign(tmp_path):
    camp = tmp_path / "campaigns" / "test"
    (camp / "save").mkdir(parents=True)
    (camp / "save" / "investigator-state").mkdir()
    (camp / "scenario").mkdir(parents=True)
    (camp / "logs").mkdir(parents=True)
    (camp / "memory" / "cards" / "player-safe").mkdir(parents=True)
    (camp / "save" / "world-state.json").write_text(json.dumps({
        "schema_version": 1, "campaign_id": "test", "discovered_clue_ids": [],
        "active_scene_id": "scene-1"}))
    (camp / "save" / "pacing-state.json").write_text(json.dumps({
        "schema_version": 1, "tension_level": "low", "lethal_chances_used": 0,
        "recent_intent_classes": [], "turn_number": 0, "luck_spent_last": 0}))
    (camp / "logs" / "events.jsonl").write_text("")
    return camp


def test_apply_reveal_adds_clue_to_discovered(tmp_path):
    camp = _campaign(tmp_path)
    plan = {"decision_id": "d1", "scene_action": "REVEAL",
            "clue_policy": {"reveal": ["clue-A"]},
            "pressure_moves": [], "memory_writes": [], "rule_signals": {}}
    events = coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    world = json.loads((camp / "save" / "world-state.json").read_text())
    assert "clue-A" in world["discovered_clue_ids"]
    assert any("clue-A" in e.get("summary", "") or "reveal" in e.get("event_type", "") for e in events)


def test_apply_pressure_updates_pacing_turn(tmp_path):
    camp = _campaign(tmp_path)
    plan = {"decision_id": "d2", "scene_action": "PRESSURE",
            "clue_policy": {"reveal": []},
            "pressure_moves": [{"clock_id": "cult-alert", "tick": 1, "visible_symptom": "黑车出现"}],
            "memory_writes": [], "rule_signals": {},
            "narrative_directives": {"horror_escalation_stage": "pattern"}}
    coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    pacing = json.loads((camp / "save" / "pacing-state.json").read_text())
    assert pacing["turn_number"] == 1
    assert pacing["tension_level"] == "medium"  # low + 1 pressure tick -> medium


def test_apply_persists_storylet_narrative_fields_to_event_log(tmp_path):
    camp = _campaign(tmp_path)
    plan = {
        "decision_id": "d-storylet",
        "scene_action": "REVEAL",
        "clue_policy": {"reveal": []},
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {},
        "storylet_moves": [{
            "storylet_id": "low-paper-wrong-date",
            "title": "错误日期的纸张",
            "family_id": "ambient_anomaly",
            "trope_id": "impossible_admin_detail",
            "conflict_level": "low",
            "target_conflict_level": "low",
            "cue": "一张文件的日期与玩家刚刚确认的时间差了一天。",
            "beat": "把一个可调查的细节轻轻推到台前。",
            "bound_entities": {"scene_id": "archive-room", "clue_id": "ledger-mark"},
            "rolled_variants": {"sensory_detail_1d6": "空气里有一丝金属味。"},
            "serves": ["mainline", "can_reveal_clue"],
            "ledger_update": {"last_storylet_id": "low-paper-wrong-date"},
        }],
    }

    events = coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")

    storylet_event = next(event for event in events if event.get("event_type") == "storylet_move")
    assert storylet_event["cue"] == "一张文件的日期与玩家刚刚确认的时间差了一天。"
    assert storylet_event["beat"] == "把一个可调查的细节轻轻推到台前。"
    assert storylet_event["title"] == "错误日期的纸张"
    assert storylet_event["rolled_variants"]["sensory_detail_1d6"] == "空气里有一丝金属味。"


def test_apply_writes_storylet_scheduler_jsonl(tmp_path):
    camp = _campaign(tmp_path)
    trace = {
        "schema_version": 1,
        "storylet_trigger": {"triggered": True, "reason": "forced", "polarity": "neutral"},
        "story_need": {
            "need_id": "clue_delivery",
            "reason": "director_reveal",
            "candidate_decks": ["clue_delivery", "investigation"],
        },
        "candidate_counts": {
            "library_total": 2,
            "after_context_filter": 2,
            "after_story_need_filter": 1,
            "after_anti_repeat": 1,
        },
        "selected": {
            "storylet_id": "right-clue",
            "deck_id": "clue_delivery",
            "family_id": "clue_delivery",
            "trope_id": "misfiled_record",
        },
        "rejected_examples": [{"storylet_id": "wrong-pressure", "reason": "deck_mismatch"}],
        "ledger_update": {"recent_families": ["clue_delivery"]},
    }
    plan = {
        "decision_id": "d-storylet-trace",
        "scene_action": "REVEAL",
        "turn_input": {"active_scene_id": "archive", "turn_number": 3},
        "clue_policy": {"reveal": []},
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {},
        "narrative_enrichment": {
            "storylet_trigger": trace["storylet_trigger"],
            "storylet_scheduler": {
                "story_need": trace["story_need"],
                "candidate_decks": trace["story_need"]["candidate_decks"],
            },
        },
        "storylet_moves": [{
            "storylet_id": "right-clue",
            "family_id": "clue_delivery",
            "trope_id": "misfiled_record",
            "deck_id": "clue_delivery",
            "story_need": trace["story_need"],
            "scheduler_trace": trace,
            "ledger_update": trace["ledger_update"],
        }],
    }

    coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")

    log_path = camp / "logs" / "storylet-scheduler.jsonl"
    records = [json.loads(line) for line in log_path.read_text(encoding="utf-8").splitlines()]
    assert len(records) == 1
    record = records[0]
    assert record["event_type"] == "storylet_scheduler"
    assert record["decision_id"] == "d-storylet-trace"
    assert record["scene_id"] == "archive"
    assert record["story_need"]["need_id"] == "clue_delivery"
    assert record["candidate_counts"]["after_story_need_filter"] == 1
    assert record["selected"]["storylet_id"] == "right-clue"
    assert record["rejected_examples"][0]["reason"] == "deck_mismatch"


def test_apply_writes_scene_progress_jsonl(tmp_path):
    camp = _campaign(tmp_path)
    plan = {
        "decision_id": "d-scene-progress",
        "scene_action": "MONTAGE",
        "clue_policy": {"reveal": []},
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {"low_agency_continue_count": 2},
        "turn_input": {"active_scene_id": "bridge-1", "player_intent_class": "move"},
        "narrative_directives": {
            "scene_progress": {
                "schema_version": 1,
                "action": "force_transition",
                "reason": "low_agency_bridge_exhausted",
                "scene_kind": "bridge",
                "low_agency_continue_count": 2,
                "max_low_agency_turns": 1,
                "exit_directive": "cut to a meaningful decision point",
                "fallback_action": "MONTAGE",
            }
        },
    }

    coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")

    log_path = camp / "logs" / "scene-progress.jsonl"
    records = [json.loads(line) for line in log_path.read_text(encoding="utf-8").splitlines()]
    assert len(records) == 1
    record = records[0]
    assert record["event_type"] == "scene_progress_directive"
    assert record["decision_id"] == "d-scene-progress"
    assert record["scene_id"] == "bridge-1"
    assert record["reason"] == "low_agency_bridge_exhausted"
    assert record["fallback_action"] == "MONTAGE"


def test_apply_records_recent_intent_classes(tmp_path):
    """apply_plan must append the plan's turn_input.player_intent_class to
    pacing['recent_intent_classes'] so read_stalled_turns can detect stalls.
    Previously this was never written, so stalled recovery was dead."""
    camp = _campaign(tmp_path)
    plan = {"decision_id": "d-ic", "scene_action": "CHARACTER",
            "clue_policy": {"reveal": []},
            "pressure_moves": [], "memory_writes": [], "rule_signals": {},
            "turn_input": {"player_intent": "我和NPC聊天", "player_intent_class": "social"}}
    coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    pacing = json.loads((camp / "save" / "pacing-state.json").read_text())
    assert pacing["recent_intent_classes"] == ["social"]


def test_apply_persists_npc_state_writes_and_agency_log(tmp_path):
    camp = _campaign(tmp_path)
    persona_card = {
        "schema_version": 1,
        "npc_id": "npc-authority",
        "lifecycle": "persistent",
        "social_role": {
            "authority_scope": ["scene_safety"],
            "responsibility_domains": ["group_survival"],
            "initiative_style": "decisive",
        },
        "persona": {"tags": ["temperament.impatient"]},
        "generation_log": {
            "event_type": "npc_generation",
            "npc_id": "npc-authority",
            "lifecycle": "persistent",
            "source": "scene_present_npc_missing_state",
            "seed": "seed",
            "inputs": {"module_id": "test"},
            "rolls": {"temperament": {"result": "temperament.impatient"}},
            "social_role": {
                "authority_scope": ["scene_safety"],
                "responsibility_domains": ["group_survival"],
                "initiative_style": "decisive",
            },
            "persona": {"tags": ["temperament.impatient"]},
            "name": {"status": "pending_llm", "value": None},
        },
    }
    agency_move = {
        "npc_id": "npc-authority",
        "move_id": "assert_responsibility",
        "reason": "authority_scope_matches_scene",
        "rules_effect": {
            "kind": "npc_assist",
            "actor_role": "npc",
            "bonus_dice": 1,
            "scope": "scene_safety",
            "reason": "controls the danger area",
        },
    }
    plan = {
        "decision_id": "d-npc",
        "scene_action": "CHARACTER",
        "turn_input": {"active_scene_id": "scene-1", "turn_number": 2},
        "clue_policy": {"reveal": []},
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {},
        "npc_state_writes": [persona_card],
        "npc_moves": [{"npc_id": "npc-authority", "agency_moves": [agency_move]}],
    }

    coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")

    state = json.loads((camp / "save" / "npc-state.json").read_text())
    assert state["npcs"]["npc-authority"]["social_role"]["authority_scope"] == ["scene_safety"]
    records = [
        json.loads(line)
        for line in (camp / "logs" / "npc-agency.jsonl").read_text().splitlines()
        if line.strip()
    ]
    assert records[0]["event_type"] == "npc_agency"
    assert records[0]["npc_id"] == "npc-authority"
    assert records[0]["selected_move"]["move_id"] == "assert_responsibility"
    generation_records = [
        json.loads(line)
        for line in (camp / "logs" / "npc-generation.jsonl").read_text().splitlines()
        if line.strip()
    ]
    assert generation_records[0]["event_type"] == "npc_generation"
    assert generation_records[0]["npc_id"] == "npc-authority"


def test_apply_persists_npc_stat_upgrade_log(tmp_path):
    camp = _campaign(tmp_path)
    upgrade = {
        "npc_id": "npc-authority",
        "card": {
            "schema_version": 1,
            "npc_id": "npc-authority",
            "lifecycle": "mechanical_actor",
            "stat_profile": {
                "archetype_id": "ordinary_adult",
                "characteristics": {"STR": 50, "CON": 45, "SIZ": 55, "DEX": 40, "POW": 50},
                "derived": {"HP": 10},
                "key_skills": {"Persuade": 40},
            },
        },
        "log": {
            "event_type": "npc_stat_upgrade",
            "npc_id": "npc-authority",
            "from_lifecycle": "silhouette",
            "to_lifecycle": "mechanical_actor",
            "reason": "entered_opposed_roll",
            "archetype": "ordinary_adult",
            "generated_stats": {
                "STR": 50,
                "CON": 45,
                "DEX": 40,
                "HP": 10,
                "key_skills": {"Persuade": 40},
            },
            "rule_refs": ["core.npc.stat_archetypes"],
        },
    }
    plan = {
        "decision_id": "d-npc-upgrade",
        "scene_action": "CHARACTER",
        "turn_input": {"active_scene_id": "scene-1", "turn_number": 3},
        "clue_policy": {"reveal": []},
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {},
        "npc_stat_upgrades": [upgrade],
    }

    coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")

    state = json.loads((camp / "save" / "npc-state.json").read_text())
    assert state["npcs"]["npc-authority"]["lifecycle"] == "mechanical_actor"
    records = [
        json.loads(line)
        for line in (camp / "logs" / "npc-stat-upgrade.jsonl").read_text().splitlines()
        if line.strip()
    ]
    assert records[0]["event_type"] == "npc_stat_upgrade"
    assert records[0]["generated_stats"]["HP"] == 10


def test_apply_writes_event_to_logs(tmp_path):
    camp = _campaign(tmp_path)
    plan = {"decision_id": "d3", "scene_action": "REVEAL",
            "clue_policy": {"reveal": ["clue-X"]},
            "pressure_moves": [], "memory_writes": [], "rule_signals": {}}
    coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    events_text = (camp / "logs" / "events.jsonl").read_text().strip()
    assert events_text  # non-empty
    assert "clue-X" in events_text


def test_apply_memory_write_creates_card(tmp_path):
    camp = _campaign(tmp_path)
    plan = {"decision_id": "d4", "scene_action": "CHARACTER",
            "clue_policy": {"reveal": []},
            "pressure_moves": [],
            "memory_writes": [{"type": "player_interest", "privacy": "player_safe",
                               "salience": 0.7, "entities": ["npc-knott"],
                               "tags": ["npc_relationship"], "summary": "玩家信任诺特",
                               "reactivation_cues": ["knott"]}],
            "rule_signals": {}}
    coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    cards = list((camp / "memory" / "cards" / "player-safe").glob("*.md"))
    assert len(cards) >= 1
    assert "玩家信任诺特" in cards[0].read_text(encoding="utf-8")


def test_apply_advances_scene_when_clues_exhausted(tmp_path):
    """When all of a scene's available_clues are discovered, apply advances to next scene."""
    camp = _campaign(tmp_path)
    # scene-1 has clue-A; pre-discover it
    world = json.loads((camp / "save" / "world-state.json").read_text())
    world["discovered_clue_ids"] = ["clue-A"]
    world["active_scene_id"] = "scene-1"
    (camp / "save" / "world-state.json").write_text(json.dumps(world))
    # story-graph: scene-1 (clue-A) -> scene-2 (clue-B)
    sg = {"scenes": [
        {"scene_id": "scene-1", "available_clues": ["clue-A"], "dramatic_question": "q1",
         "entry_conditions": [], "exit_conditions": []},
        {"scene_id": "scene-2", "available_clues": ["clue-B"], "dramatic_question": "q2",
         "entry_conditions": [], "exit_conditions": []},
    ]}
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(sg))
    plan = {"decision_id": "d1", "scene_action": "REVEAL",
            "clue_policy": {"reveal": []}, "pressure_moves": [],
            "memory_writes": [], "rule_signals": {}, "narrative_directives": {}}
    coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    world2 = json.loads((camp / "save" / "world-state.json").read_text())
    assert world2["active_scene_id"] == "scene-2"


def test_apply_does_not_advance_when_clues_remain(tmp_path):
    """Scene with undiscovered clues stays active."""
    camp = _campaign(tmp_path)
    world = json.loads((camp / "save" / "world-state.json").read_text())
    world["active_scene_id"] = "scene-1"
    (camp / "save" / "world-state.json").write_text(json.dumps(world))
    sg = {"scenes": [
        {"scene_id": "scene-1", "available_clues": ["clue-A", "clue-B"], "dramatic_question": "q",
         "entry_conditions": [], "exit_conditions": []},
    ]}
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(sg))
    plan = {"decision_id": "d1", "scene_action": "REVEAL",
            "clue_policy": {"reveal": ["clue-A"]}, "pressure_moves": [],
            "memory_writes": [], "rule_signals": {}, "narrative_directives": {}}
    coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    world2 = json.loads((camp / "save" / "world-state.json").read_text())
    assert world2["active_scene_id"] == "scene-1"  # clue-B still undiscovered


def test_apply_cut_forces_scene_transition(tmp_path):
    """CUT action forces scene advance regardless of clues."""
    camp = _campaign(tmp_path)
    world = json.loads((camp / "save" / "world-state.json").read_text())
    world["active_scene_id"] = "scene-1"
    (camp / "save" / "world-state.json").write_text(json.dumps(world))
    sg = {"scenes": [
        {"scene_id": "scene-1", "available_clues": ["clue-A", "clue-B"], "dramatic_question": "q",
         "entry_conditions": [], "exit_conditions": []},
        {"scene_id": "scene-2", "available_clues": ["clue-C"], "dramatic_question": "q2",
         "entry_conditions": [], "exit_conditions": []},
    ]}
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(sg))
    plan = {"decision_id": "d1", "scene_action": "CUT",
            "clue_policy": {"reveal": []}, "pressure_moves": [],
            "memory_writes": [], "rule_signals": {}, "narrative_directives": {}}
    coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    world2 = json.loads((camp / "save" / "world-state.json").read_text())
    assert world2["active_scene_id"] == "scene-2"


def test_apply_obscured_reveal_waits_for_rule_result(tmp_path):
    camp = _campaign(tmp_path)
    plan = {"decision_id": "d-rule", "scene_action": "REVEAL",
            "clue_policy": {"reveal": ["clue-A"], "clue_type": "obscured"},
            "rules_requests": [{"kind": "skill_check", "skill": "Spot Hidden", "difficulty": "regular"}],
            "pressure_moves": [], "memory_writes": [], "rule_signals": {}, "narrative_directives": {}}
    events = coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    world = json.loads((camp / "save" / "world-state.json").read_text())
    assert "clue-A" not in world["discovered_clue_ids"]
    assert any(e.get("event_type") == "clue_pending_rule_result" for e in events)


def test_apply_obscured_reveal_commits_on_success(tmp_path):
    camp = _campaign(tmp_path)
    plan = {"decision_id": "d-rule", "scene_action": "REVEAL",
            "clue_policy": {"reveal": ["clue-A"], "clue_type": "obscured"},
            "rules_requests": [{"kind": "skill_check", "skill": "Spot Hidden", "difficulty": "regular"}],
            "pressure_moves": [], "memory_writes": [], "rule_signals": {}, "narrative_directives": {}}
    events = coc_director_apply.apply_plan(
        camp, plan, investigator_id="inv1",
        rules_results=[{"skill": "Spot Hidden", "outcome": "regular_success", "success": True}],
    )
    world = json.loads((camp / "save" / "world-state.json").read_text())
    assert "clue-A" in world["discovered_clue_ids"]
    assert any(e.get("event_type") == "clue_reveal" for e in events)


def test_apply_obscured_reveal_uses_later_matching_clue_contract_success(tmp_path):
    camp = _campaign(tmp_path)
    clue_contract = _clue_roll_contract()
    plan = {"decision_id": "d-rule", "scene_action": "REVEAL",
            "clue_policy": {"reveal": ["clue-A"], "clue_type": "obscured", "skill": "Spot Hidden"},
            "rules_requests": [
                {"kind": "skill_check", "skill": "Spot Hidden", "difficulty": "regular",
                 "reason": "obscured clue in scene", "roll_contract": clue_contract},
                {"kind": "skill_check", "skill": "Stealth", "difficulty": "regular",
                 "reason": "悄悄靠近"},
                {"kind": "skill_check", "skill": "Spot Hidden", "difficulty": "regular",
                 "reason": "瞥读电报纸", "source": "player_intent_rich.action_atoms",
                 "roll_contract": clue_contract},
            ],
            "pressure_moves": [], "memory_writes": [], "rule_signals": {},
            "narrative_directives": {}}
    events = coc_director_apply.apply_plan(
        camp, plan, investigator_id="inv1",
        rules_results=[
            {"skill": "Spot Hidden", "outcome": "failure", "success": False,
             "reason": "obscured clue in scene", "roll_contract": clue_contract},
            {"skill": "Stealth", "outcome": "regular", "success": True,
             "reason": "悄悄靠近"},
            {"skill": "Spot Hidden", "outcome": "regular", "success": True,
             "reason": "瞥读电报纸", "roll_contract": clue_contract},
        ],
    )
    world = json.loads((camp / "save" / "world-state.json").read_text())
    assert "clue-A" in world["discovered_clue_ids"]
    assert any(e.get("event_type") == "clue_reveal" for e in events)


def test_apply_obscured_reveal_ignores_later_same_skill_success_without_clue_contract(tmp_path):
    camp = _campaign(tmp_path)
    clue_contract = _clue_roll_contract()
    plan = {"decision_id": "d-rule", "scene_action": "REVEAL",
            "clue_policy": {"reveal": ["clue-A"], "clue_type": "obscured", "skill": "Spot Hidden"},
            "rules_requests": [
                {"kind": "skill_check", "skill": "Spot Hidden", "difficulty": "regular",
                 "reason": "obscured clue in scene", "roll_contract": clue_contract},
                {"kind": "skill_check", "skill": "Spot Hidden", "difficulty": "regular",
                 "reason": "check the courtyard", "source": "player_intent_rich.action_atoms"},
            ],
            "pressure_moves": [], "memory_writes": [], "rule_signals": {},
            "narrative_directives": {}}

    events = coc_director_apply.apply_plan(
        camp, plan, investigator_id="inv1",
        rules_results=[
            {"skill": "Spot Hidden", "outcome": "failure", "success": False,
             "reason": "obscured clue in scene", "roll_contract": clue_contract},
            {"skill": "Spot Hidden", "outcome": "regular", "success": True,
             "reason": "check the courtyard"},
        ],
    )

    world = json.loads((camp / "save" / "world-state.json").read_text())
    assert "clue-A" not in world["discovered_clue_ids"]
    assert any(e.get("event_type") == "clue_withheld" for e in events)


def test_apply_obscured_reveal_withholds_on_failure_and_costs(tmp_path):
    camp = _campaign(tmp_path)
    plan = {"decision_id": "d-rule", "scene_action": "REVEAL",
            "clue_policy": {"reveal": ["clue-A"], "clue_type": "obscured", "fallback_routes": ["clue-B"]},
            "rules_requests": [{"kind": "skill_check", "skill": "Spot Hidden", "difficulty": "regular"}],
            "pressure_moves": [], "memory_writes": [], "rule_signals": {}, "narrative_directives": {}}
    events = coc_director_apply.apply_plan(
        camp, plan, investigator_id="inv1",
        rules_results=[{"skill": "Spot Hidden", "outcome": "failure", "success": False}],
    )
    world = json.loads((camp / "save" / "world-state.json").read_text())
    pacing = json.loads((camp / "save" / "pacing-state.json").read_text())
    assert "clue-A" not in world["discovered_clue_ids"]
    assert any(e.get("event_type") == "clue_withheld" for e in events)
    assert any(e.get("event_type") == "failure_consequence" for e in events)
    assert pacing["tension_level"] == "medium"


def test_apply_recover_fallback_reveals_after_stall_with_cost(tmp_path):
    camp = _campaign(tmp_path)
    plan = {"decision_id": "d-recover", "scene_action": "RECOVER",
            "clue_policy": {"reveal": [], "fallback_routes": ["clue-B"]},
            "pressure_moves": [], "memory_writes": [],
            "rule_signals": {"stalled_turns": 3}, "narrative_directives": {}}
    events = coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    world = json.loads((camp / "save" / "world-state.json").read_text())
    pacing = json.loads((camp / "save" / "pacing-state.json").read_text())
    assert "clue-B" in world["discovered_clue_ids"]
    assert any(e.get("event_type") == "fail_forward_recovery" for e in events)
    assert pacing["tension_level"] == "medium"


def test_backfill_rule_results_failure_prunes_exact_clue_anchor():
    plan = {"decision_id": "d-rule", "scene_action": "REVEAL",
            "clue_policy": {"reveal": ["clue-A"], "clue_type": "obscured", "fallback_routes": ["clue-B"]},
            "rules_requests": [{"kind": "skill_check", "skill": "Library Use", "difficulty": "regular"}],
            "pressure_moves": [], "memory_writes": [], "rule_signals": {},
            "narrative_directives": {"must_include": ["exact archive detail"], "tone": ["dust"]}}
    resolved = coc_director_apply.backfill_rule_results(
        plan,
        [{"skill": "Library Use", "outcome": "failure", "success": False}],
    )
    assert resolved["resolved_clue_policy"]["committed_reveals"] == []
    assert resolved["resolved_clue_policy"]["withheld_reveals"] == ["clue-A"]
    assert resolved["narrative_directives"]["must_include"] == []
    failure = resolved["narrative_directives"]["failure_consequence"]
    assert failure["narration_mode"] == "withhold_exact_clue_with_cost"
    assert "do not end the scene" in " ".join(failure["must_not_claim"])


def test_backfill_rule_results_recover_marks_fallback_as_in_world_recovery():
    plan = {"decision_id": "d-recover", "scene_action": "RECOVER",
            "clue_policy": {"reveal": [], "fallback_routes": ["clue-B"]},
            "pressure_moves": [], "memory_writes": [],
            "rule_signals": {"stalled_turns": 3},
            "narrative_directives": {"must_include": ["fallback anchor"], "tone": []}}
    resolved = coc_director_apply.backfill_rule_results(plan, [])
    assert resolved["resolved_clue_policy"]["fallback_recovered"] == ["clue-B"]
    failure = resolved["narrative_directives"]["failure_consequence"]
    assert failure["narration_mode"] == "recover_with_cost"
    assert "do not present this as a table-level hint" in failure["must_not_claim"]


def test_backfill_failed_non_clue_roll_adds_failure_routing():
    plan = {
        "decision_id": "d-action-fail",
        "scene_action": "SUBSYSTEM",
        "clue_policy": {"reveal": []},
        "rules_requests": [{
            "kind": "skill_check",
            "skill": "Dodge",
            "reason": "cross the exposed yard",
            "difficulty": "regular",
            "roll_contract": {
                "schema_version": 1,
                "goal": "cross the exposed yard",
                "success_effect": "reach cover",
                "failure_effect": "reach cover but draw hostile attention",
                "failure_outcome_mode": "goal_with_cost",
                "push_policy": {"eligible": True, "requires_changed_method": True, "keeper_must_foreshadow_failure": True},
                "roll_density_group": "exposed_yard",
                "must_not": ["do not narrate no progress on ordinary failure"],
            },
        }],
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {},
        "narrative_directives": {},
    }

    resolved = coc_director_apply.backfill_rule_results(
        plan,
        [{"skill": "Dodge", "outcome": "failure", "success": False, "roll_contract": plan["rules_requests"][0]["roll_contract"]}],
    )

    failure = resolved["narrative_directives"]["failure_consequence"]
    assert failure["narration_mode"] == "goal_with_cost"
    assert failure["goal"] == "cross the exposed yard"
    assert "do not narrate no progress on ordinary failure" in failure["must_not_claim"]


def test_apply_fast_recording_queues_audit_logs_without_blocking_save_state(tmp_path):
    camp = _campaign(tmp_path)
    plan = {
        "decision_id": "d-fast",
        "scene_action": "PRESSURE",
        "turn_input": {"active_scene_id": "scene-1", "turn_number": 7},
        "clue_policy": {"reveal": ["clue-fast"]},
        "pressure_moves": [{"clock_id": "storm", "tick": 1, "visible_symptom": "风雪压近"}],
        "memory_writes": [],
        "rule_signals": {},
        "narrative_directives": {
            "recording_mode": "fast",
            "scene_progress": {
                "schema_version": 1,
                "action": "continue_with_pressure",
                "reason": "test-fast-mode",
            },
        },
    }

    events = coc_director_apply.apply_plan(
        camp, plan, investigator_id="inv1", recording_mode="fast"
    )

    world = json.loads((camp / "save" / "world-state.json").read_text())
    pacing = json.loads((camp / "save" / "pacing-state.json").read_text())
    assert "clue-fast" in world["discovered_clue_ids"]
    assert pacing["turn_number"] == 1
    assert any(event["event_type"] == "clue_reveal" for event in events)
    assert (camp / "logs" / "events.jsonl").read_text() == ""
    pending_files = sorted((camp / "logs" / "pending-turns").glob("*.json"))
    assert len(pending_files) == 1
    pending = json.loads(pending_files[0].read_text(encoding="utf-8"))
    assert pending["recording_mode"] == "fast"
    assert any(entry["relative_path"] == "logs/events.jsonl" for entry in pending["entries"])
    assert any(entry["relative_path"] == "logs/scene-progress.jsonl" for entry in pending["entries"])


def test_flush_pending_records_replays_fast_recording_queue(tmp_path):
    camp = _campaign(tmp_path)
    plan = {
        "decision_id": "d-fast-flush",
        "scene_action": "PRESSURE",
        "turn_input": {"active_scene_id": "scene-1", "turn_number": 8},
        "clue_policy": {"reveal": ["clue-flush"]},
        "pressure_moves": [{"clock_id": "storm", "tick": 1, "visible_symptom": "风雪压近"}],
        "memory_writes": [],
        "rule_signals": {},
    }
    coc_director_apply.apply_plan(camp, plan, investigator_id="inv1", recording_mode="fast")

    result = coc_director_apply.flush_pending_records(camp)

    assert result["flushed_files"] == 1
    assert result["flushed_entries"] >= 2
    assert not list((camp / "logs" / "pending-turns").glob("*.json"))
    events_text = (camp / "logs" / "events.jsonl").read_text(encoding="utf-8")
    assert "clue-flush" in events_text
