"""Tests for coc_director_apply: persists DirectorPlan effects to save/logs/memory."""
import importlib.util
import json
import os
import time
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


def test_apply_reveal_clue_reveal_carries_handout_asset_when_clue_has_ref(tmp_path):
    """P2-5: clue_reveal carries handout_asset_id + resolved title/summary
    from index/handout-assets.json when the clue record has a handout_asset_id."""
    camp = _campaign(tmp_path)
    # clue record in scenario/clue-graph.json with a handout_asset_id
    (camp / "scenario" / "clue-graph.json").write_text(json.dumps({
        "conclusions": [{
            "conclusion_id": "c1", "importance": "major", "minimum_routes": 1,
            "clues": [{
                "clue_id": "clue-handout",
                "delivery": "reading the letter",
                "visibility": "player-safe",
                "handout_asset_id": "handout-letter",
                "player_safe_summary": "A cryptic letter from the professor.",
            }],
            "fallback_policy": "n/a",
        }],
    }))
    # the resolved handout asset in index/handout-assets.json
    (camp / "index").mkdir(parents=True, exist_ok=True)
    (camp / "index" / "handout-assets.json").write_text(json.dumps({
        "schema_version": 1, "scenario_id": "test", "asset_root": "assets/handouts",
        "assets": [{
            "asset_id": "handout-letter",
            "title": "The Professor's Letter",
            "summary": "A handwritten letter hinting at the chapel.",
            "source": {"path": "pdf/module.pdf", "page": 7},
            "player_visible": True,
            "clue_refs": ["clue-handout"],
        }],
        "display": {},
    }))

    plan = {"decision_id": "d1", "scene_action": "REVEAL",
            "clue_policy": {"reveal": ["clue-handout"]},
            "pressure_moves": [], "memory_writes": [], "rule_signals": {}}
    events = coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")

    reveals = [e for e in events if e.get("event_type") == "clue_reveal"
               and e.get("clue_id") == "clue-handout"]
    assert reveals, "expected a clue_reveal event for clue-handout"
    ev = reveals[0]
    assert ev["handout_asset_id"] == "handout-letter"
    assert ev["handout_title"] == "The Professor's Letter"
    assert ev["handout_summary"] == "A handwritten letter hinting at the chapel."
    # rendering hint surfaces player visibility for consumers
    assert ev["player_visible"] is True


def test_apply_reveal_clue_reveal_omits_handout_when_clue_has_no_ref(tmp_path):
    """A clue without handout_asset_id produces a plain clue_reveal with no
    handout fields (backward compatible with all existing scenarios)."""
    camp = _campaign(tmp_path)
    (camp / "scenario" / "clue-graph.json").write_text(json.dumps({
        "conclusions": [{
            "conclusion_id": "c1", "importance": "major", "minimum_routes": 1,
            "clues": [{
                "clue_id": "clue-plain", "delivery": "looking around",
                "visibility": "player-safe",
                "player_safe_summary": "A mundane observation.",
            }],
            "fallback_policy": "n/a",
        }],
    }))

    plan = {"decision_id": "d1", "scene_action": "REVEAL",
            "clue_policy": {"reveal": ["clue-plain"]},
            "pressure_moves": [], "memory_writes": [], "rule_signals": {}}
    events = coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")

    reveals = [e for e in events if e.get("event_type") == "clue_reveal"
               and e.get("clue_id") == "clue-plain"]
    assert reveals
    ev = reveals[0]
    assert "handout_asset_id" not in ev
    assert "handout_title" not in ev
    assert "handout_summary" not in ev


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


def test_apply_narrative_exit_does_not_auto_advance_on_clue_reveal(tmp_path):
    """P1 scene-advancement: a scene with a *narrative* exit_condition (e.g.
    "investigators accept the job") must NOT auto-advance just because its last
    available_clue got revealed. The exit_condition can't be machine-checked, so
    the scene waits for an explicit CUT / force_transition."""
    camp = _campaign(tmp_path)
    world = json.loads((camp / "save" / "world-state.json").read_text())
    world["active_scene_id"] = "briefing"
    (camp / "save" / "world-state.json").write_text(json.dumps(world))
    # briefing has 1 available_clue + a narrative exit the apply layer can't eval
    sg = {"scenes": [
        {"scene_id": "briefing", "available_clues": ["clue-briefing"],
         "dramatic_question": "will the investigators accept the job?",
         "entry_conditions": [],
         "exit_conditions": ["investigators accept the job"]},
        {"scene_id": "archive", "available_clues": ["clue-newspaper"],
         "dramatic_question": "q2", "entry_conditions": [], "exit_conditions": []},
    ]}
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(sg))
    # revealing the single clue exhausts available_clues
    plan = {"decision_id": "d1", "scene_action": "REVEAL",
            "clue_policy": {"reveal": ["clue-briefing"]}, "pressure_moves": [],
            "memory_writes": [], "rule_signals": {}, "narrative_directives": {}}
    coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    world2 = json.loads((camp / "save" / "world-state.json").read_text())
    assert world2["active_scene_id"] == "briefing"  # narrative exit blocks advance

    # ... but a subsequent CUT must still force the transition.
    plan_cut = {"decision_id": "d2", "scene_action": "CUT",
                "clue_policy": {"reveal": []}, "pressure_moves": [],
                "memory_writes": [], "rule_signals": {}, "narrative_directives": {}}
    coc_director_apply.apply_plan(camp, plan_cut, investigator_id="inv1")
    world3 = json.loads((camp / "save" / "world-state.json").read_text())
    assert world3["active_scene_id"] == "archive"


def test_apply_machine_checkable_exit_auto_advances_on_clue_reveal(tmp_path):
    """A scene whose exit_condition IS machine-checkable (e.g. "clue-x discovered")
    still auto-advances once all available_clues are revealed — preserved behavior."""
    camp = _campaign(tmp_path)
    world = json.loads((camp / "save" / "world-state.json").read_text())
    world["active_scene_id"] = "scene-1"
    (camp / "save" / "world-state.json").write_text(json.dumps(world))
    sg = {"scenes": [
        {"scene_id": "scene-1", "available_clues": ["clue-A"],
         "dramatic_question": "q1", "entry_conditions": [],
         "exit_conditions": ["clue-A discovered"]},
        {"scene_id": "scene-2", "available_clues": ["clue-B"],
         "dramatic_question": "q2", "entry_conditions": [], "exit_conditions": []},
    ]}
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(sg))
    plan = {"decision_id": "d1", "scene_action": "REVEAL",
            "clue_policy": {"reveal": ["clue-A"]}, "pressure_moves": [],
            "memory_writes": [], "rule_signals": {}, "narrative_directives": {}}
    coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    world2 = json.loads((camp / "save" / "world-state.json").read_text())
    assert world2["active_scene_id"] == "scene-2"  # machine-checkable exit allows


def test_apply_no_exit_conditions_auto_advances_on_clue_reveal(tmp_path):
    """A scene with NO exit_conditions still auto-advances once all available_clues
    are revealed — preserved behavior (nothing to block on)."""
    camp = _campaign(tmp_path)
    world = json.loads((camp / "save" / "world-state.json").read_text())
    world["active_scene_id"] = "scene-1"
    (camp / "save" / "world-state.json").write_text(json.dumps(world))
    sg = {"scenes": [
        {"scene_id": "scene-1", "available_clues": ["clue-A"],
         "dramatic_question": "q1", "entry_conditions": [], "exit_conditions": []},
        {"scene_id": "scene-2", "available_clues": ["clue-B"],
         "dramatic_question": "q2", "entry_conditions": [], "exit_conditions": []},
    ]}
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(sg))
    plan = {"decision_id": "d1", "scene_action": "REVEAL",
            "clue_policy": {"reveal": ["clue-A"]}, "pressure_moves": [],
            "memory_writes": [], "rule_signals": {}, "narrative_directives": {}}
    coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    world2 = json.loads((camp / "save" / "world-state.json").read_text())
    assert world2["active_scene_id"] == "scene-2"  # no exit -> allow


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
    """Failed Idea Roll still surfaces the lead, but in a worse position (thick of it)."""
    camp = _campaign(tmp_path)
    plan = {
        "decision_id": "d-recover",
        "scene_action": "RECOVER",
        "clue_policy": {"reveal": [], "fallback_routes": ["clue-B"]},
        "rules_requests": [{"kind": "idea_roll", "skill": "INT", "difficulty": "regular"}],
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {"stalled_turns": 3},
        "narrative_directives": {
            "idea_roll_plan": {
                "missed_clue_id": "clue-B",
                "difficulty": "regular",
                "signpost_level": "mentioned",
            }
        },
    }
    events = coc_director_apply.apply_plan(
        camp,
        plan,
        investigator_id="inv1",
        rules_results=[{
            "kind": "idea_roll",
            "skill": "INT",
            "outcome": "failure",
            "success": False,
        }],
    )
    world = json.loads((camp / "save" / "world-state.json").read_text())
    pacing = json.loads((camp / "save" / "pacing-state.json").read_text())
    assert "clue-B" in world["discovered_clue_ids"]
    assert any(e.get("event_type") == "fail_forward_recovery" for e in events)
    assert pacing["tension_level"] == "medium"


def test_apply_recover_idea_roll_success_surfaces_lead_without_danger(tmp_path):
    """Winning the Idea Roll delivers the lead without increasing danger."""
    camp = _campaign(tmp_path)
    plan = {
        "decision_id": "d-recover-win",
        "scene_action": "RECOVER",
        "clue_policy": {"reveal": [], "fallback_routes": ["clue-B"]},
        "rules_requests": [{"kind": "idea_roll", "skill": "INT", "difficulty": "regular"}],
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {"stalled_turns": 3},
        "narrative_directives": {
            "idea_roll_plan": {
                "missed_clue_id": "clue-B",
                "difficulty": "regular",
                "signpost_level": "mentioned",
            }
        },
    }
    events = coc_director_apply.apply_plan(
        camp,
        plan,
        investigator_id="inv1",
        rules_results=[{
            "kind": "idea_roll",
            "skill": "INT",
            "outcome": "regular",
            "success": True,
        }],
    )
    world = json.loads((camp / "save" / "world-state.json").read_text())
    pacing = json.loads((camp / "save" / "pacing-state.json").read_text())
    assert "clue-B" in world["discovered_clue_ids"]
    assert any(e.get("event_type") == "idea_roll_recovery" for e in events)
    assert not any(e.get("event_type") == "fail_forward_recovery" for e in events)
    assert pacing["tension_level"] == "low"


def test_apply_recover_unmentioned_free_delivery_without_roll(tmp_path):
    """Never-signposted missed clue: Keeper gives the lead free (no Idea Roll)."""
    camp = _campaign(tmp_path)
    plan = {
        "decision_id": "d-recover-free",
        "scene_action": "RECOVER",
        "clue_policy": {"reveal": [], "fallback_routes": ["clue-B"]},
        "rules_requests": [],
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {"stalled_turns": 3},
        "narrative_directives": {
            "idea_roll_plan": {
                "missed_clue_id": "clue-B",
                "difficulty": None,
                "signpost_level": "unmentioned",
            }
        },
    }
    events = coc_director_apply.apply_plan(camp, plan, investigator_id="inv1", rules_results=[])
    world = json.loads((camp / "save" / "world-state.json").read_text())
    pacing = json.loads((camp / "save" / "pacing-state.json").read_text())
    assert "clue-B" in world["discovered_clue_ids"]
    assert any(e.get("event_type") == "idea_roll_recovery" for e in events)
    assert pacing["tension_level"] == "low"


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
    plan = {
        "decision_id": "d-recover",
        "scene_action": "RECOVER",
        "clue_policy": {"reveal": [], "fallback_routes": ["clue-B"]},
        "rules_requests": [{"kind": "idea_roll", "skill": "INT", "difficulty": "regular"}],
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {"stalled_turns": 3},
        "narrative_directives": {"must_include": ["fallback anchor"], "tone": []},
    }
    resolved = coc_director_apply.backfill_rule_results(
        plan,
        [{"kind": "idea_roll", "skill": "INT", "outcome": "failure", "success": False}],
    )
    assert resolved["resolved_clue_policy"]["fallback_recovered"] == ["clue-B"]
    failure = resolved["narrative_directives"]["failure_consequence"]
    assert failure["narration_mode"] == "recover_with_cost"
    assert "do not present this as a table-level hint" in failure["must_not_claim"]


def test_backfill_idea_roll_success_uses_clean_recovery_mode():
    plan = {
        "decision_id": "d-recover-win",
        "scene_action": "RECOVER",
        "clue_policy": {"reveal": [], "fallback_routes": ["clue-B"]},
        "rules_requests": [{"kind": "idea_roll", "skill": "INT", "difficulty": "regular"}],
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {"stalled_turns": 3},
        "narrative_directives": {"must_include": ["fallback anchor"], "tone": []},
    }
    resolved = coc_director_apply.backfill_rule_results(
        plan,
        [{"kind": "idea_roll", "skill": "INT", "outcome": "regular", "success": True}],
    )
    assert resolved["resolved_clue_policy"]["fallback_recovered"] == ["clue-B"]
    recovery = resolved["narrative_directives"]["failure_consequence"]
    assert recovery["narration_mode"] == "recover_clean"
    assert "do not present this as a table-level hint" in recovery["must_not_claim"]


def test_apply_choice_leads_signposts_clues_as_mentioned(tmp_path):
    """CHOICE that surfaces clue leads records structured signposts for Idea Roll."""
    camp = _campaign(tmp_path)
    plan = {
        "decision_id": "d-choice",
        "scene_action": "CHOICE",
        "clue_policy": {"reveal": [], "leads": ["clue-A", "clue-B"], "fallback_routes": []},
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {},
        "narrative_directives": {},
        "choice_frame": {
            "routes": [
                {"route_id": "clue:clue-A", "route_type": "investigative_lead", "source": "clue_policy.leads"},
                {"route_id": "clue:clue-B", "route_type": "investigative_lead", "source": "clue_policy.leads"},
            ],
        },
    }
    coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    world = json.loads((camp / "save" / "world-state.json").read_text())
    assert world["clue_signposts"]["clue-A"] == "mentioned"
    assert world["clue_signposts"]["clue-B"] == "mentioned"


def test_apply_failed_obscured_check_signposts_clue_as_obvious(tmp_path):
    """A failed obscured perception check marks the missed clue as obvious for Idea Roll."""
    camp = _campaign(tmp_path)
    contract = _clue_roll_contract("clue-A")
    plan = {
        "decision_id": "d-miss",
        "scene_action": "REVEAL",
        "clue_policy": {
            "reveal": ["clue-A"],
            "clue_type": "obscured",
            "fallback_routes": ["clue-B"],
            "skill": "Spot Hidden",
        },
        "rules_requests": [{
            "kind": "skill_check",
            "skill": "Spot Hidden",
            "reason": "obscured clue in scene",
            "difficulty": "regular",
            "roll_contract": contract,
        }],
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {},
        "narrative_directives": {},
    }
    coc_director_apply.apply_plan(
        camp,
        plan,
        investigator_id="inv1",
        rules_results=[{
            "skill": "Spot Hidden",
            "outcome": "failure",
            "success": False,
            "roll_contract": contract,
        }],
    )
    world = json.loads((camp / "save" / "world-state.json").read_text())
    assert "clue-A" not in world["discovered_clue_ids"]
    assert world["clue_signposts"]["clue-A"] == "obvious"


def test_apply_signpost_never_downgrades_obvious_to_mentioned(tmp_path):
    camp = _campaign(tmp_path)
    world = json.loads((camp / "save" / "world-state.json").read_text())
    world["clue_signposts"] = {"clue-A": "obvious"}
    (camp / "save" / "world-state.json").write_text(json.dumps(world))
    plan = {
        "decision_id": "d-choice-again",
        "scene_action": "CHOICE",
        "clue_policy": {"reveal": [], "leads": ["clue-A"], "fallback_routes": []},
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {},
        "narrative_directives": {},
        "choice_frame": {
            "routes": [
                {"route_id": "clue:clue-A", "route_type": "investigative_lead", "source": "clue_policy.leads"},
            ],
        },
    }
    coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    world = json.loads((camp / "save" / "world-state.json").read_text())
    assert world["clue_signposts"]["clue-A"] == "obvious"


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


def test_fast_recording_can_auto_flush_in_background(tmp_path):
    camp = _campaign(tmp_path)
    plan = {
        "decision_id": "d-fast-background",
        "scene_action": "PRESSURE",
        "turn_input": {"active_scene_id": "scene-1", "turn_number": 9},
        "clue_policy": {"reveal": ["clue-background"]},
        "pressure_moves": [{"clock_id": "storm", "tick": 1, "visible_symptom": "风雪压近"}],
        "memory_writes": [],
        "rule_signals": {},
        "narrative_directives": {
            "recording_mode": "fast",
            "recording_flush": "background",
        },
    }

    coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")

    world = json.loads((camp / "save" / "world-state.json").read_text())
    assert "clue-background" in world["discovered_clue_ids"]

    deadline = time.time() + 5
    events_text = ""
    pending_files = []
    while time.time() < deadline:
        events_text = (camp / "logs" / "events.jsonl").read_text(encoding="utf-8")
        pending_dir = camp / "logs" / "pending-turns"
        pending_files = list(pending_dir.glob("*.json")) if pending_dir.is_dir() else []
        if "clue-background" in events_text and not pending_files:
            break
        time.sleep(0.05)

    assert "clue-background" in events_text
    assert pending_files == []


def test_apply_records_recent_intent_tags_alongside_classes(tmp_path):
    """P0-2b: apply_plan must persist rich secondary_intents tags in a parallel
    recent_intent_tags field, keeping recent_intent_classes as list[str] (unchanged)."""
    camp = _campaign(tmp_path)
    plan = {"decision_id": "d-tags", "scene_action": "CHARACTER",
            "clue_policy": {"reveal": []},
            "pressure_moves": [], "memory_writes": [], "rule_signals": {},
            "turn_input": {
                "player_intent": "继续跟着走",
                "player_intent_class": "investigate",
                "player_intent_rich": {"secondary_intents": ["low_agency_continue", "yield_initiative"]},
            }}
    coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    pacing = json.loads((camp / "save" / "pacing-state.json").read_text())
    # classes unchanged (still list[str])
    assert pacing["recent_intent_classes"] == ["investigate"]
    # new parallel field carries the rich tags
    assert pacing["recent_intent_tags"] == [["low_agency_continue", "yield_initiative"]]


def test_apply_recent_intent_tags_absent_when_no_rich(tmp_path):
    camp = _campaign(tmp_path)
    plan = {"decision_id": "d-notags", "scene_action": "CHARACTER",
            "clue_policy": {"reveal": []},
            "pressure_moves": [], "memory_writes": [], "rule_signals": {},
            "turn_input": {"player_intent": "search", "player_intent_class": "investigate"}}
    coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    pacing = json.loads((camp / "save" / "pacing-state.json").read_text())
    # no rich intent → empty tags list for that turn
    assert pacing["recent_intent_tags"] == [[]]


def test_apply_writes_spoiler_reveal_to_audit_jsonl(tmp_path):
    """P2-7: when a DirectorPlan carries warning-gated spoiler reveals (Keeper-only
    secrets disclosed to the player after warning+confirm), apply_plan must mirror
    the playtest harness record shape into logs/audit.jsonl and also record the
    reveal in save/flags.json's spoiler_reveals list (previously a dead field).

    Live director currently does not emit spoiler_reveals (keeper_secrets are only
    ever withheld), so this wires the real audit path that a future spoiler-aware
    director decision would flow through. See w5-t4-report.md for scope note."""
    camp = _campaign(tmp_path)
    # flags.json initialized with the dead spoiler_reveals field, mirroring coc_state
    (camp / "save" / "flags.json").write_text(json.dumps({
        "schema_version": 1, "campaign_id": "test",
        "clues_found": {}, "decisions": [], "spoiler_reveals": [],
    }))
    plan = {
        "decision_id": "d-spoiler",
        "scene_action": "REVEAL",
        "turn_input": {"active_scene_id": "corbitt-house-basement", "turn_number": 13},
        "clue_policy": {"reveal": []},
        "spoiler_reveals": [{
            "spoiler_id": "corbitt-basement-reveal",
            "keeper_secret_id": "secret-corbitt-body",
            "scope": "corbitt_basement_presence",
            "confirmed": True,
            "payload": {
                "summary": "Player confirmed a warning-gated limited reveal that "
                           "Walter Corbitt's body remains in the basement.",
            },
        }],
        "pressure_moves": [], "memory_writes": [], "rule_signals": {},
    }

    events = coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")

    # audit.jsonl gets one record mirroring the playtest shape
    audit_records = [
        json.loads(line)
        for line in (camp / "logs" / "audit.jsonl").read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert len(audit_records) == 1
    rec = audit_records[0]
    assert rec["type"] == "spoiler_reveal"
    assert rec["spoiler_id"] == "corbitt-basement-reveal"
    assert rec["keeper_secret_id"] == "secret-corbitt-body"
    assert rec["scope"] == "corbitt_basement_presence"
    assert rec["confirmed"] is True
    assert "Walter Corbitt" in rec["payload"]["summary"]
    assert rec["decision_id"] == "d-spoiler"
    assert rec["investigator_id"] == "inv1"
    # a spoiler_reveal event also surfaces in the events stream
    assert any(
        e.get("event_type") == "spoiler_reveal"
        and e.get("spoiler_id") == "corbitt-basement-reveal"
        for e in events
    )
    # flags.json spoiler_reveals list is now populated (was previously dead)
    flags = json.loads((camp / "save" / "flags.json").read_text())
    assert any(
        f.get("spoiler_id") == "corbitt-basement-reveal" for f in flags["spoiler_reveals"]
    )


def test_apply_creates_flags_json_and_audit_jsonl_when_missing(tmp_path):
    """If flags.json was never initialized, apply_plan still records the spoiler
    reveal without crashing (creates audit.jsonl from scratch, populates flags)."""
    camp = _campaign(tmp_path)
    # deliberately do NOT create flags.json
    plan = {
        "decision_id": "d-spoiler2",
        "scene_action": "REVEAL",
        "clue_policy": {"reveal": []},
        "spoiler_reveals": [{
            "spoiler_id": "sp1",
            "keeper_secret_id": "sec1",
            "scope": "scope1",
            "confirmed": True,
            "payload": {"summary": "limited reveal"},
        }],
        "pressure_moves": [], "memory_writes": [], "rule_signals": {},
    }

    coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")

    audit_records = [
        json.loads(line)
        for line in (camp / "logs" / "audit.jsonl").read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert len(audit_records) == 1
    assert audit_records[0]["spoiler_id"] == "sp1"
    flags = json.loads((camp / "save" / "flags.json").read_text())
    assert any(f.get("spoiler_id") == "sp1" for f in flags["spoiler_reveals"])


def test_apply_no_spoiler_reveals_leaves_audit_jsonl_untouched(tmp_path):
    """A plan with no spoiler_reveals must not create or touch logs/audit.jsonl."""
    camp = _campaign(tmp_path)
    plan = {"decision_id": "d-none", "scene_action": "REVEAL",
            "clue_policy": {"reveal": ["clue-A"]},
            "pressure_moves": [], "memory_writes": [], "rule_signals": {}}
    coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    assert not (camp / "logs" / "audit.jsonl").exists()


def test_apply_payoff_on_final_scene_emits_session_ending(tmp_path):
    """W1-6: PAYOFF on a terminal scene appends a structured session_ending event.

    Terminal evidence is structured only: scene_type == \"resolution\",
    is_final == True, or the scene is the last entry in story-graph.scenes.
    """
    camp = _campaign(tmp_path)
    (camp / "campaign.json").write_text(json.dumps({
        "campaign_id": "test",
        "scenario_id": "the-haunting",
        "title": "Test Campaign",
    }), encoding="utf-8")
    world = json.loads((camp / "save" / "world-state.json").read_text())
    world["active_scene_id"] = "aftermath"
    (camp / "save" / "world-state.json").write_text(json.dumps(world))
    sg = {"scenes": [
        {"scene_id": "house-entry", "available_clues": ["clue-A"],
         "dramatic_question": "q1", "entry_conditions": [], "exit_conditions": [],
         "scene_type": "investigation"},
        {"scene_id": "aftermath", "available_clues": [],
         "dramatic_question": "how does the story close?",
         "entry_conditions": [], "exit_conditions": [],
         "scene_type": "resolution", "is_final": True},
    ]}
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(sg))

    plan = {"decision_id": "d-end", "scene_action": "PAYOFF",
            "clue_policy": {"reveal": []}, "pressure_moves": [],
            "memory_writes": [], "rule_signals": {}, "narrative_directives": {}}
    events = coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")

    ending = next(
        (e for e in events
         if e.get("type") == "session_ending" or e.get("event_type") == "session_ending"),
        None,
    )
    assert ending is not None, "expected a session_ending event for final-scene PAYOFF"
    payload = ending.get("payload") if isinstance(ending.get("payload"), dict) else ending
    assert payload.get("scenario_id") == "the-haunting"
    assert payload.get("scene_id") == "aftermath"

    logged = [
        json.loads(line)
        for line in (camp / "logs" / "events.jsonl").read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert any(
        e.get("type") == "session_ending" or e.get("event_type") == "session_ending"
        for e in logged
    )


def test_apply_payoff_on_non_final_scene_does_not_emit_session_ending(tmp_path):
    """PAYOFF alone is not an ending — only a terminal scene triggers session_ending."""
    camp = _campaign(tmp_path)
    world = json.loads((camp / "save" / "world-state.json").read_text())
    world["active_scene_id"] = "scene-1"
    (camp / "save" / "world-state.json").write_text(json.dumps(world))
    sg = {"scenes": [
        {"scene_id": "scene-1", "available_clues": ["clue-A"],
         "dramatic_question": "q1", "entry_conditions": [], "exit_conditions": [],
         "scene_type": "investigation"},
        {"scene_id": "scene-2", "available_clues": ["clue-B"],
         "dramatic_question": "q2", "entry_conditions": [], "exit_conditions": [],
         "scene_type": "investigation"},
    ]}
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(sg))
    plan = {"decision_id": "d-payoff", "scene_action": "PAYOFF",
            "clue_policy": {"reveal": []}, "pressure_moves": [],
            "memory_writes": [], "rule_signals": {}, "narrative_directives": {}}
    events = coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    assert not any(
        e.get("type") == "session_ending" or e.get("event_type") == "session_ending"
        for e in events
    )


def test_apply_session_ending_bumps_storylet_ledger_session_number(tmp_path):
    """session_ending during apply must call start_new_session (bump ledger)."""
    camp = _campaign(tmp_path)
    (camp / "campaign.json").write_text(json.dumps({
        "campaign_id": "test",
        "scenario_id": "the-haunting",
        "title": "Test Campaign",
    }), encoding="utf-8")
    world = json.loads((camp / "save" / "world-state.json").read_text())
    world["active_scene_id"] = "aftermath"
    (camp / "save" / "world-state.json").write_text(json.dumps(world))
    sg = {"scenes": [
        {"scene_id": "house-entry", "available_clues": ["clue-A"],
         "dramatic_question": "q1", "entry_conditions": [], "exit_conditions": [],
         "scene_type": "investigation"},
        {"scene_id": "aftermath", "available_clues": [],
         "dramatic_question": "how does the story close?",
         "entry_conditions": [], "exit_conditions": [],
         "scene_type": "resolution", "is_final": True},
    ]}
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(sg))
    ledger_path = camp / "save" / "storylet-ledger.json"
    ledger_path.write_text(json.dumps({
        "session_number": 1,
        "used_storylets": [],
        "used_families": [],
        "used_tropes": [],
        "recent_families": [],
        "recent_tropes": [],
        "used_targets": [],
        "turn_number": 0,
    }), encoding="utf-8")

    plan = {"decision_id": "d-end-rollover", "scene_action": "PAYOFF",
            "clue_policy": {"reveal": []}, "pressure_moves": [],
            "memory_writes": [], "rule_signals": {}, "narrative_directives": {}}
    events = coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")

    assert any(
        e.get("type") == "session_ending" or e.get("event_type") == "session_ending"
        for e in events
    )
    ledger = json.loads(ledger_path.read_text(encoding="utf-8"))
    assert ledger["session_number"] == 2


# ---------------------------------------------------------------------------
# R1-Y: structured exit eval, bidirectional tension, idempotent apply, atomic writes
# ---------------------------------------------------------------------------


def test_apply_structured_clue_discovered_exit_auto_advances(tmp_path):
    """Structured exit_conditions objects must satisfy in the apply layer (not only director)."""
    camp = _campaign(tmp_path)
    world = json.loads((camp / "save" / "world-state.json").read_text())
    world["active_scene_id"] = "scene-1"
    (camp / "save" / "world-state.json").write_text(json.dumps(world))
    sg = {"scenes": [
        {"scene_id": "scene-1", "available_clues": ["clue-A"],
         "dramatic_question": "q1", "entry_conditions": [],
         "exit_conditions": [{"kind": "clue_discovered", "clue_id": "clue-A"}]},
        {"scene_id": "scene-2", "available_clues": ["clue-B"],
         "dramatic_question": "q2", "entry_conditions": [], "exit_conditions": []},
    ]}
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(sg))
    plan = {"decision_id": "d-struct-clue", "scene_action": "REVEAL",
            "clue_policy": {"reveal": ["clue-A"]}, "pressure_moves": [],
            "memory_writes": [], "rule_signals": {}, "narrative_directives": {}}
    coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    world2 = json.loads((camp / "save" / "world-state.json").read_text())
    assert world2["active_scene_id"] == "scene-2"


def test_apply_structured_narrative_exit_blocks_auto_advance(tmp_path):
    camp = _campaign(tmp_path)
    world = json.loads((camp / "save" / "world-state.json").read_text())
    world["active_scene_id"] = "briefing"
    (camp / "save" / "world-state.json").write_text(json.dumps(world))
    sg = {"scenes": [
        {"scene_id": "briefing", "available_clues": ["clue-briefing"],
         "dramatic_question": "q1", "entry_conditions": [],
         "exit_conditions": [{"kind": "narrative", "description": "investigators accept the job"}]},
        {"scene_id": "archive", "available_clues": ["clue-newspaper"],
         "dramatic_question": "q2", "entry_conditions": [], "exit_conditions": []},
    ]}
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(sg))
    plan = {"decision_id": "d-struct-narr", "scene_action": "REVEAL",
            "clue_policy": {"reveal": ["clue-briefing"]}, "pressure_moves": [],
            "memory_writes": [], "rule_signals": {}, "narrative_directives": {}}
    coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    world2 = json.loads((camp / "save" / "world-state.json").read_text())
    assert world2["active_scene_id"] == "briefing"


def test_apply_structured_clock_reaches_exit_auto_advances(tmp_path):
    camp = _campaign(tmp_path)
    world = json.loads((camp / "save" / "world-state.json").read_text())
    world["active_scene_id"] = "scene-1"
    world["discovered_clue_ids"] = ["clue-A"]
    (camp / "save" / "world-state.json").write_text(json.dumps(world))
    (camp / "scenario" / "threat-fronts.json").write_text(json.dumps({
        "fronts": [{"front_id": "f1", "clocks": [
            {"clock_id": "cult-alert", "segments": 6, "on_full": "raid"},
        ]}],
    }))
    (camp / "save" / "threat-state.json").write_text(json.dumps({
        "schema_version": 1,
        "clocks": {"cult-alert": {"current_segments": 3, "full": False}},
    }))
    sg = {"scenes": [
        {"scene_id": "scene-1", "available_clues": ["clue-A"],
         "dramatic_question": "q1", "entry_conditions": [],
         "exit_conditions": [{"kind": "clock_reaches", "clock_id": "cult-alert", "threshold": 3}]},
        {"scene_id": "scene-2", "available_clues": ["clue-B"],
         "dramatic_question": "q2", "entry_conditions": [], "exit_conditions": []},
    ]}
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(sg))
    # Clues already exhausted; REVEAL with empty reveal still runs exit eval.
    plan = {"decision_id": "d-struct-clock", "scene_action": "REVEAL",
            "clue_policy": {"reveal": []}, "pressure_moves": [],
            "memory_writes": [], "rule_signals": {}, "narrative_directives": {}}
    coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    world2 = json.loads((camp / "save" / "world-state.json").read_text())
    assert world2["active_scene_id"] == "scene-2"


def test_apply_tension_delta_cools_from_high_to_medium(tmp_path):
    """plan.tension_delta must be able to lower tension (RECOVER/MONTAGE/AFTERMATH)."""
    camp = _campaign(tmp_path)
    (camp / "save" / "pacing-state.json").write_text(json.dumps({
        "schema_version": 1, "tension_level": "high", "lethal_chances_used": 0,
        "recent_intent_classes": [], "turn_number": 3, "luck_spent_last": 0,
    }))
    plan = {
        "decision_id": "d-cool",
        "scene_action": "MONTAGE",
        "tension_delta": -1,
        "clue_policy": {"reveal": []},
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {},
        "narrative_directives": {},
    }
    coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    pacing = json.loads((camp / "save" / "pacing-state.json").read_text())
    assert pacing["tension_level"] == "medium"


def test_apply_tension_delta_cooling_not_blocked_by_pressure_ticks(tmp_path):
    camp = _campaign(tmp_path)
    (camp / "save" / "pacing-state.json").write_text(json.dumps({
        "schema_version": 1, "tension_level": "climax", "lethal_chances_used": 0,
        "recent_intent_classes": [], "turn_number": 5, "luck_spent_last": 0,
    }))
    plan = {
        "decision_id": "d-cool-pressure",
        "scene_action": "AFTERMATH",
        "tension_delta": -1,
        "clue_policy": {"reveal": []},
        "pressure_moves": [{"clock_id": "cult-alert", "tick": 1, "visible_symptom": "echo"}],
        "memory_writes": [],
        "rule_signals": {},
        "narrative_directives": {},
    }
    coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    pacing = json.loads((camp / "save" / "pacing-state.json").read_text())
    assert pacing["tension_level"] == "high"


def test_apply_tension_delta_escalates_and_clamps_at_climax(tmp_path):
    camp = _campaign(tmp_path)
    (camp / "save" / "pacing-state.json").write_text(json.dumps({
        "schema_version": 1, "tension_level": "high", "lethal_chances_used": 0,
        "recent_intent_classes": [], "turn_number": 2, "luck_spent_last": 0,
    }))
    plan = {
        "decision_id": "d-escalate",
        "scene_action": "PRESSURE",
        "tension_delta": 1,
        "clue_policy": {"reveal": []},
        "pressure_moves": [{"clock_id": "cult-alert", "tick": 1}],
        "memory_writes": [],
        "rule_signals": {},
        "narrative_directives": {},
    }
    coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    pacing = json.loads((camp / "save" / "pacing-state.json").read_text())
    assert pacing["tension_level"] == "climax"
    # second escalate stays clamped
    plan2 = {**plan, "decision_id": "d-escalate-2", "tension_delta": 1}
    coc_director_apply.apply_plan(camp, plan2, investigator_id="inv1")
    pacing2 = json.loads((camp / "save" / "pacing-state.json").read_text())
    assert pacing2["tension_level"] == "climax"


def test_apply_plan_idempotent_skips_duplicate_decision_id(tmp_path):
    camp = _campaign(tmp_path)
    plan = {
        "decision_id": "d-once",
        "scene_action": "REVEAL",
        "clue_policy": {"reveal": ["clue-A"]},
        "pressure_moves": [{"clock_id": "cult-alert", "tick": 1}],
        "memory_writes": [],
        "rule_signals": {},
        "narrative_directives": {},
    }
    events1 = coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    assert any(e.get("event_type") == "clue_reveal" for e in events1)
    world1 = json.loads((camp / "save" / "world-state.json").read_text())
    pacing1 = json.loads((camp / "save" / "pacing-state.json").read_text())
    events_path = camp / "logs" / "events.jsonl"
    lines1 = [ln for ln in events_path.read_text().splitlines() if ln.strip()]

    result2 = coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    # Structured no-op: uniform list shape with one apply_skipped event.
    assert isinstance(result2, list)
    assert len(result2) == 1
    assert result2[0].get("event_type") == "apply_skipped"
    assert result2[0].get("skipped") == "duplicate_decision_id"
    assert result2[0].get("decision_id") == "d-once"

    world2 = json.loads((camp / "save" / "world-state.json").read_text())
    pacing2 = json.loads((camp / "save" / "pacing-state.json").read_text())
    lines2 = [ln for ln in events_path.read_text().splitlines() if ln.strip()]
    assert world2 == world1
    assert pacing2["turn_number"] == pacing1["turn_number"]
    assert pacing2["tension_level"] == pacing1["tension_level"]
    assert lines2 == lines1

    ledger = json.loads((camp / "save" / "apply-ledger.json").read_text())
    assert "d-once" in ledger.get("applied_decision_ids", [])


def test_apply_plan_duplicate_result_safe_for_runner_consumption(tmp_path):
    """run_live_turn iterates apply_plan's return with event.get(...) and no
    isinstance guard — the duplicate no-op must keep that consumption shape
    working (list of dicts) and leave state untouched."""
    camp = _campaign(tmp_path)
    plan = {
        "decision_id": "d-retry",
        "scene_action": "REVEAL",
        "clue_policy": {"reveal": ["clue-A"]},
        "pressure_moves": [{"clock_id": "cult-alert", "tick": 1}],
        "memory_writes": [],
        "rule_signals": {},
        "narrative_directives": {},
    }
    coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    world1 = json.loads((camp / "save" / "world-state.json").read_text())
    pacing1 = json.loads((camp / "save" / "pacing-state.json").read_text())

    events = coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    # Mirror the runner's comprehension (coc_live_turn_runner.run_live_turn):
    # iterating with event.get must not raise on the duplicate no-op result.
    clue_revealed = [
        event.get("clue_id") for event in events
        if event.get("event_type") == "clue_reveal"
    ]
    event_types = [event.get("event_type") for event in events if isinstance(event, dict)]
    assert clue_revealed == []
    assert event_types == ["apply_skipped"]

    world2 = json.loads((camp / "save" / "world-state.json").read_text())
    pacing2 = json.loads((camp / "save" / "pacing-state.json").read_text())
    assert world2 == world1
    assert pacing2 == pacing1


def test_write_json_is_atomic_via_replace(tmp_path, monkeypatch):
    """_write_json must use coc_fileio atomic write (tmp + os.replace)."""
    target = tmp_path / "out.json"
    calls = []
    real_replace = os.replace

    def tracking_replace(src, dst):
        calls.append((str(src), str(dst)))
        return real_replace(src, dst)

    monkeypatch.setattr(coc_director_apply.coc_fileio.os, "replace", tracking_replace)
    coc_director_apply._write_json(target, {"ok": True})
    assert target.exists()
    assert json.loads(target.read_text()) == {"ok": True}
    assert calls, "expected os.replace to be used for atomic write"
    assert any(str(target) == dst for _src, dst in calls)


# =============================================================================
# W2-3: push-roll gate in apply layer (Keeper Rulebook p.83-85, p.163)
# =============================================================================

_FULL_PUSH_GATE = {
    "method_changed": True,
    "consequence_announced": True,
    "player_confirmed": True,
}


def test_apply_rejects_pushed_result_without_complete_push_gate(tmp_path):
    """pushed:True without a complete push_gate must not settle as a push."""
    camp = _campaign(tmp_path)
    plan = {
        "decision_id": "d-push-gate",
        "scene_action": "DEEPEN",
        "clue_policy": {"reveal": []},
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {},
        "narrative_directives": {},
    }
    rules_results = [{
        "skill": "Spot Hidden",
        "outcome": "failure",
        "success": False,
        "pushed": True,
        "push_gate": {
            "method_changed": True,
            "consequence_announced": False,
            "player_confirmed": True,
        },
    }]
    events = coc_director_apply.apply_plan(
        camp, plan, investigator_id="inv1", rules_results=rules_results,
    )
    violations = [e for e in events if e.get("event_type") == "push_gate_violation"]
    assert len(violations) == 1
    missing = violations[0].get("missing_gate_fields") or []
    assert "consequence_announced" in missing
    # Demoted: must not be treated as a settled pushed roll.
    assert rules_results[0].get("pushed") is not True
    pacing = json.loads((camp / "save" / "pacing-state.json").read_text())
    assert pacing.get("pushed_fail_pending") is not True


def test_apply_pushed_failure_writes_pushed_fail_pending(tmp_path):
    """Valid pushed failure writes pacing-state.pushed_fail_pending (p.84)."""
    camp = _campaign(tmp_path)
    plan = {
        "decision_id": "d-push-fail",
        "scene_action": "DEEPEN",
        "clue_policy": {"reveal": []},
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {},
        "narrative_directives": {},
    }
    events = coc_director_apply.apply_plan(
        camp, plan, investigator_id="inv1",
        rules_results=[{
            "skill": "Spot Hidden",
            "outcome": "failure",
            "success": False,
            "pushed": True,
            "push_gate": dict(_FULL_PUSH_GATE),
        }],
    )
    pacing = json.loads((camp / "save" / "pacing-state.json").read_text())
    assert pacing.get("pushed_fail_pending") is True
    assert not any(e.get("event_type") == "push_gate_violation" for e in events)
    fail_events = [
        e for e in events
        if e.get("event_type") == "pushed_roll_failure" or e.get("pushed_fail")
    ]
    assert fail_events, "expected a structured pushed-failure event"


def test_apply_pushed_failure_underlying_insanity_allows_delusion_consequence(tmp_path):
    """Underlying insanity (no bout) may use delusion as push-fail consequence (p.163)."""
    camp = _campaign(tmp_path)
    inv_dir = camp / "save" / "investigator-state"
    inv_dir.mkdir(parents=True, exist_ok=True)
    (inv_dir / "inv1.json").write_text(json.dumps({
        "temporary_insane": True,
        "bout_active": False,
    }))
    plan = {
        "decision_id": "d-push-delusion",
        "scene_action": "DEEPEN",
        "clue_policy": {"reveal": []},
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {},
        "narrative_directives": {},
    }
    events = coc_director_apply.apply_plan(
        camp, plan, investigator_id="inv1",
        rules_results=[{
            "skill": "Persuade",
            "outcome": "failure",
            "success": False,
            "pushed": True,
            "push_gate": dict(_FULL_PUSH_GATE),
        }],
    )
    fail_events = [
        e for e in events
        if e.get("event_type") == "pushed_roll_failure"
        or e.get("delusion_consequence_allowed") is True
    ]
    assert fail_events
    assert any(e.get("delusion_consequence_allowed") is True for e in fail_events)


def test_apply_pushed_success_with_gate_does_not_set_pending(tmp_path):
    """Pushed success still needs the gate, but does not set pushed_fail_pending."""
    camp = _campaign(tmp_path)
    plan = {
        "decision_id": "d-push-ok",
        "scene_action": "DEEPEN",
        "clue_policy": {"reveal": []},
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {},
        "narrative_directives": {},
    }
    events = coc_director_apply.apply_plan(
        camp, plan, investigator_id="inv1",
        rules_results=[{
            "skill": "Spot Hidden",
            "outcome": "regular_success",
            "success": True,
            "pushed": True,
            "push_gate": dict(_FULL_PUSH_GATE),
        }],
    )
    pacing = json.loads((camp / "save" / "pacing-state.json").read_text())
    assert pacing.get("pushed_fail_pending") is not True
    assert not any(e.get("event_type") == "push_gate_violation" for e in events)


# =============================================================================
# W2-2: auto skill-tick recording on rules_results landing
# =============================================================================

def _campaign_with_dev_investigator(tmp_path):
    """Campaign under .coc/ so development.jsonl resolves beside investigators/."""
    root = tmp_path / ".coc"
    camp = root / "campaigns" / "test"
    (camp / "save" / "investigator-state").mkdir(parents=True)
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
    inv_dir = root / "investigators" / "inv1"
    inv_dir.mkdir(parents=True)
    (inv_dir / "character.json").write_text(json.dumps({
        "id": "inv1", "skills": {"Spot Hidden": 55, "Credit Rating": 40},
    }))
    (inv_dir / "development.jsonl").write_text("")
    return camp


def test_apply_auto_records_skill_tick_on_qualifying_success(tmp_path):
    """W2-2: qualifying skill success lands a development tick + skill_check_earned event."""
    camp = _campaign_with_dev_investigator(tmp_path)
    plan = {
        "decision_id": "d-tick-ok",
        "scene_action": "DEEPEN",
        "clue_policy": {"reveal": []},
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {},
        "narrative_directives": {},
    }
    events = coc_director_apply.apply_plan(
        camp, plan, investigator_id="inv1",
        rules_results=[{
            "skill": "Spot Hidden",
            "outcome": "regular_success",
            "success": True,
            "roll": 18,
            "kind": "skill_check",
        }],
    )
    tick_events = [e for e in events if e.get("event_type") == "skill_check_earned"
                   or e.get("skill_check_earned") is True]
    assert tick_events, "expected skill_check_earned event from apply"
    assert any(e.get("skill") == "Spot Hidden" for e in tick_events)

    tick_path = camp.parents[1] / "investigators" / "inv1" / "development.jsonl"
    rows = [json.loads(line) for line in tick_path.read_text().splitlines() if line.strip()]
    assert len(rows) == 1
    assert rows[0]["skill"] == "Spot Hidden"
    assert rows[0]["roll"] == 18


def test_apply_does_not_tick_excluded_or_failed_rolls(tmp_path):
    camp = _campaign_with_dev_investigator(tmp_path)
    plan = {
        "decision_id": "d-tick-skip",
        "scene_action": "DEEPEN",
        "clue_policy": {"reveal": []},
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {},
        "narrative_directives": {},
    }
    events = coc_director_apply.apply_plan(
        camp, plan, investigator_id="inv1",
        rules_results=[
            {"skill": "Spot Hidden", "outcome": "failure", "success": False, "roll": 90},
            {"skill": "Credit Rating", "outcome": "regular_success", "success": True, "roll": 10},
            {
                "skill": "Spot Hidden",
                "outcome": "regular_success",
                "success": True,
                "roll": 12,
                "improvement_tick_eligible": False,
                "luck_spent": 3,
            },
        ],
    )
    assert not any(
        e.get("event_type") == "skill_check_earned" or e.get("skill_check_earned") is True
        for e in events
    )
    tick_path = camp.parents[1] / "investigators" / "inv1" / "development.jsonl"
    assert tick_path.read_text().strip() == ""


# =============================================================================
# W2-7: Fair Warning ladder increments lethal_chances_used (p.209)
# =============================================================================

def test_apply_fair_warning_increments_lethal_chances_used(tmp_path):
    """Landing fair_warning bumps pacing-state.lethal_chances_used by 1."""
    camp = _campaign(tmp_path)
    plan = {
        "decision_id": "d-fw-1",
        "scene_action": "PRESSURE",
        "clue_policy": {"reveal": []},
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {},
        "narrative_directives": {
            "fair_warning": {"warning_number": 1, "remaining": 2},
        },
    }
    events = coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    pacing = json.loads((camp / "save" / "pacing-state.json").read_text())
    assert pacing["lethal_chances_used"] == 1
    fw_events = [e for e in events if e.get("event_type") == "fair_warning"]
    assert len(fw_events) == 1
    assert fw_events[0]["warning_number"] == 1
    assert fw_events[0]["remaining"] == 2


def test_apply_fair_warning_idempotent_per_decision_id(tmp_path):
    """Same decision_id must not increment lethal_chances_used twice."""
    camp = _campaign(tmp_path)
    plan = {
        "decision_id": "d-fw-dup",
        "scene_action": "PRESSURE",
        "clue_policy": {"reveal": []},
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {},
        "narrative_directives": {
            "fair_warning": {"warning_number": 1, "remaining": 2},
        },
    }
    coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    pacing = json.loads((camp / "save" / "pacing-state.json").read_text())
    assert pacing["lethal_chances_used"] == 1

    # Replay is a structured no-op via apply ledger.
    events2 = coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    assert any(e.get("skipped") == "duplicate_decision_id" for e in events2)
    pacing2 = json.loads((camp / "save" / "pacing-state.json").read_text())
    assert pacing2["lethal_chances_used"] == 1
