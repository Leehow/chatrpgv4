"""Tests for coc_director_apply: persists DirectorPlan effects to save/logs/memory."""
import importlib.util
import json
import os
import random
import time
from pathlib import Path

import pytest


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, rel)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


coc_director_apply = _load("coc_director_apply", "plugins/coc-keeper/scripts/coc_director_apply.py")
coc_adherence = _load("coc_adherence_for_director", "plugins/coc-keeper/scripts/coc_adherence.py")


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


def _character_file(tmp_path: Path, investigator_id: str = "inv1") -> Path:
    path = tmp_path / "investigators" / investigator_id / "character.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({
        "schema_version": 1,
        "id": investigator_id,
        "characteristics": {"INT": 70, "POW": 55},
        "derived": {"SAN": 55},
        "skills": {"Spot Hidden": 65, "Library Use": 60},
    }), encoding="utf-8")
    return path


def _normalized_rules_plan(decision_id: str, *, count: int = 1) -> dict:
    requests = [
        {"kind": "skill_check", "skill": "Spot Hidden", "difficulty": "regular"},
        {"kind": "skill_check", "skill": "Library Use", "difficulty": "regular"},
    ][:count]
    return {
        "decision_id": decision_id,
        "scene_action": "PRESSURE",
        "clue_policy": {"reveal": []},
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {},
        "rules_requests": requests,
        "narrative_directives": {},
    }


def _execute_plan_results(camp: Path, character: Path, plan: dict, *, investigator_id="inv1"):
    executor = coc_director_apply.coc_subsystem_executor
    commands = executor.commands_from_rules_requests(plan)
    return executor.execute_commands(
        camp,
        character,
        investigator_id,
        commands,
        rng=random.Random(130),
    )


def test_apply_reveal_adds_clue_to_discovered(tmp_path):
    camp = _campaign(tmp_path)
    plan = {"decision_id": "d1", "scene_action": "REVEAL",
            "clue_policy": {"reveal": ["clue-A"]},
            "pressure_moves": [], "memory_writes": [], "rule_signals": {}}
    events = coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    world = json.loads((camp / "save" / "world-state.json").read_text())
    assert "clue-A" in world["discovered_clue_ids"]
    assert any("clue-A" in e.get("summary", "") or "reveal" in e.get("event_type", "") for e in events)


def test_apply_does_not_persist_noncanonical_strategy_state(tmp_path):
    camp = _campaign(tmp_path)
    plan = {
        "decision_id": "d-bad-strategy", "scene_action": "PRESSURE",
        "clue_policy": {"reveal": []}, "pressure_moves": [],
        "memory_writes": [], "rule_signals": {},
        "director_strategy_state": {
            "schema_version": 1, "strategy_type": "multi_faction",
            "ranked_faction_ids": ["cult", "cult"],
        },
    }
    coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    assert not (camp / "save" / "director-strategy-state.json").exists()


def test_apply_rejects_untrusted_normalized_result_before_state_mutation(tmp_path):
    camp = _campaign(tmp_path)
    plan = {
        "decision_id": "d-untrusted-envelope",
        "scene_action": "REVEAL",
        "clue_policy": {"reveal": ["clue-A"]},
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {},
    }
    forged = [{
        "command_id": "never-executed",
        "kind": "skill_check",
        "status": "completed",
        "events": [{"kind": "skill_check", "success": True}],
        "pending_choice": None,
        "state_refs": ["logs/rolls.jsonl#never-executed"],
    }]
    world_path = camp / "save" / "world-state.json"
    event_log = camp / "logs" / "events.jsonl"
    world_before = world_path.read_bytes()
    log_before = event_log.read_bytes()

    with pytest.raises(
        coc_director_apply.coc_subsystem_executor.SubsystemExecutorError
    ) as exc_info:
        coc_director_apply.apply_plan(
            camp,
            plan,
            investigator_id="inv1",
            rules_results=forged,
            rules_results_mode="normalized",
        )

    assert exc_info.value.code == "untrusted_subsystem_result"
    assert exc_info.value.path == "rules_results[0]"
    assert world_path.read_bytes() == world_before
    assert event_log.read_bytes() == log_before
    assert not (camp / "save" / "apply-ledger.json").exists()


def test_apply_rejects_authentic_result_from_an_old_decision(tmp_path):
    camp = _campaign(tmp_path)
    character = _character_file(tmp_path)
    old_plan = _normalized_rules_plan("decision-old")
    old_results = _execute_plan_results(camp, character, old_plan)
    new_plan = _normalized_rules_plan("decision-new")
    world_path = camp / "save" / "world-state.json"
    world_before = world_path.read_bytes()

    with pytest.raises(
        coc_director_apply.coc_subsystem_executor.SubsystemExecutorError
    ) as exc_info:
        coc_director_apply.apply_plan(
            camp,
            new_plan,
            investigator_id="inv1",
            rules_results=old_results,
            rules_results_mode="normalized",
        )

    assert exc_info.value.code == "untrusted_subsystem_result"
    assert world_path.read_bytes() == world_before
    assert not (camp / "save" / "apply-ledger.json").exists()


def test_apply_cannot_override_commands_derived_from_the_current_plan(tmp_path):
    camp = _campaign(tmp_path)
    character = _character_file(tmp_path)
    source_plan = _normalized_rules_plan("decision-no-command-override")
    authentic_results = _execute_plan_results(camp, character, source_plan)
    authentic_commands = (
        coc_director_apply.coc_subsystem_executor.commands_from_rules_requests(source_plan)
    )
    plan_without_requests = {
        "decision_id": source_plan["decision_id"],
        "scene_action": "REVEAL",
        "clue_policy": {"reveal": ["clue-A"]},
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {},
        "narrative_directives": {},
    }
    world_path = camp / "save" / "world-state.json"
    world_before = world_path.read_bytes()

    with pytest.raises(TypeError, match="expected_subsystem_commands"):
        coc_director_apply.apply_plan(
            camp,
            plan_without_requests,
            investigator_id="inv1",
            rules_results=authentic_results,
            rules_results_mode="normalized",
            expected_subsystem_commands=authentic_commands,
        )

    assert world_path.read_bytes() == world_before
    assert not (camp / "save" / "apply-ledger.json").exists()


def test_apply_rejects_authentic_result_for_a_different_investigator(tmp_path):
    camp = _campaign(tmp_path)
    character = _character_file(tmp_path)
    plan = _normalized_rules_plan("decision-actor")
    results = _execute_plan_results(camp, character, plan, investigator_id="inv1")

    with pytest.raises(
        coc_director_apply.coc_subsystem_executor.SubsystemExecutorError
    ) as exc_info:
        coc_director_apply.apply_plan(
            camp,
            plan,
            investigator_id="inv2",
            rules_results=results,
            rules_results_mode="normalized",
        )

    assert exc_info.value.code == "untrusted_subsystem_result"
    assert not (camp / "save" / "apply-ledger.json").exists()


@pytest.mark.parametrize("mode", ["subset", "reordered"])
def test_apply_requires_exact_ordered_current_command_result_set(tmp_path, mode):
    case_root = tmp_path / mode
    camp = _campaign(case_root)
    character = _character_file(case_root)
    plan = _normalized_rules_plan(f"decision-{mode}", count=2)
    results = _execute_plan_results(camp, character, plan)
    supplied = results[:1] if mode == "subset" else list(reversed(results))

    with pytest.raises(
        coc_director_apply.coc_subsystem_executor.SubsystemExecutorError
    ) as exc_info:
        coc_director_apply.apply_plan(
            camp,
            plan,
            investigator_id="inv1",
            rules_results=supplied,
            rules_results_mode="normalized",
        )

    assert exc_info.value.code == "untrusted_subsystem_result"
    assert not (camp / "save" / "apply-ledger.json").exists()


def test_apply_accepts_exact_ordered_current_command_result_set(tmp_path):
    camp = _campaign(tmp_path)
    character = _character_file(tmp_path)
    plan = _normalized_rules_plan("decision-current", count=2)
    results = _execute_plan_results(camp, character, plan)

    events = coc_director_apply.apply_plan(
        camp,
        plan,
        investigator_id="inv1",
        rules_results=results,
        rules_results_mode="normalized",
    )

    assert isinstance(events, list)
    ledger = json.loads((camp / "save" / "apply-ledger.json").read_text(encoding="utf-8"))
    assert ledger["applied_decision_ids"] == ["decision-current"]


def test_duplicate_apply_skips_before_mismatched_envelope_validation(tmp_path):
    camp = _campaign(tmp_path)
    plan = {
        "decision_id": "decision-noop-first",
        "scene_action": "PRESSURE",
        "clue_policy": {"reveal": []},
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {},
    }
    coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    before = {
        path.relative_to(camp).as_posix(): path.read_bytes()
        for path in camp.rglob("*")
        if path.is_file()
    }
    mismatched = [{
        "command_id": "never-executed",
        "kind": "skill_check",
        "status": "completed",
        "events": [{"kind": "skill_check", "success": True}],
        "pending_choice": None,
        "state_refs": [],
    }]

    events = coc_director_apply.apply_plan(
        camp,
        plan,
        investigator_id="inv1",
        rules_results=mismatched,
        rules_results_mode="normalized",
    )

    assert events == [{
        "event_type": "apply_skipped",
        "skipped": "duplicate_decision_id",
        "decision_id": "decision-noop-first",
    }]
    after = {
        path.relative_to(camp).as_posix(): path.read_bytes()
        for path in camp.rglob("*")
        if path.is_file()
    }
    assert after == before


@pytest.mark.parametrize("missing_results", [None, []])
def test_normalized_apply_rejects_empty_result_set_for_nonempty_commands(
    tmp_path,
    missing_results,
):
    camp = _campaign(tmp_path)
    plan = _normalized_rules_plan("decision-missing-results")
    world_path = camp / "save" / "world-state.json"
    world_before = world_path.read_bytes()
    log_before = (camp / "logs" / "events.jsonl").read_bytes()

    with pytest.raises(
        coc_director_apply.coc_subsystem_executor.SubsystemExecutorError
    ) as exc_info:
        coc_director_apply.apply_plan(
            camp,
            plan,
            investigator_id="inv1",
            rules_results=missing_results,
            rules_results_mode="normalized",
        )

    assert exc_info.value.code == "untrusted_subsystem_result"
    assert world_path.read_bytes() == world_before
    assert (camp / "logs" / "events.jsonl").read_bytes() == log_before
    assert not (camp / "save" / "apply-ledger.json").exists()


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


def test_apply_writes_storylet_scheduler_jsonl(tmp_path, monkeypatch):
    monkeypatch.setenv("COC_DEBUG_STORYLET_SCHEDULER", "1")
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


def test_apply_skips_storylet_scheduler_jsonl_by_default(tmp_path, monkeypatch):
    monkeypatch.delenv("COC_DEBUG_STORYLET_SCHEDULER", raising=False)
    camp = _campaign(tmp_path)
    plan = {
        "decision_id": "d-storylet-trace-off",
        "scene_action": "REVEAL",
        "turn_input": {"active_scene_id": "archive", "turn_number": 3},
        "clue_policy": {"reveal": []},
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {},
        "narrative_enrichment": {
            "storylet_trigger": {"triggered": True, "reason": "forced", "polarity": "neutral"},
            "storylet_scheduler": {"story_need": {"need_id": "clue_delivery"}},
        },
        "storylet_moves": [],
    }
    coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    assert not (camp / "logs" / "storylet-scheduler.jsonl").exists()


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
    engagement_records = [
        json.loads(line)
        for line in (camp / "logs" / "npc-engagement.jsonl").read_text().splitlines()
        if line.strip()
    ]
    assert engagement_records[0]["event_type"] == "npc_engagement"
    assert engagement_records[0]["npc_id"] == "npc-authority"


def test_apply_records_npc_engagement_without_agency_moves(tmp_path):
    """npc_moves with no agency_moves still leave an append-only engagement event."""
    camp = _campaign(tmp_path)
    plan = {
        "decision_id": "d-npc-engage",
        "scene_action": "CHARACTER",
        "turn_input": {"active_scene_id": "scene-1", "turn_number": 1},
        "clue_policy": {"reveal": []},
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {},
        "npc_moves": [
            {"npc_id": "npc-augustus-larkin", "display_name": "Augustus Larkin"},
        ],
    }

    coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")

    engagement_records = [
        json.loads(line)
        for line in (camp / "logs" / "npc-engagement.jsonl").read_text().splitlines()
        if line.strip()
    ]
    assert len(engagement_records) == 1
    assert engagement_records[0]["event_type"] == "npc_engagement"
    assert engagement_records[0]["npc_id"] == "npc-augustus-larkin"
    events = [
        json.loads(line)
        for line in (camp / "logs" / "events.jsonl").read_text().splitlines()
        if line.strip()
    ]
    assert any(e.get("event_type") == "npc_engagement" for e in events)


@pytest.mark.parametrize("recording_mode", ["sync", "fast"])
@pytest.mark.parametrize("crash_stage", ["after_source", "before_apply_ledger"])
def test_director_npc_receipt_recovers_exactly_once_before_different_plan(
    tmp_path, monkeypatch, crash_stage, recording_mode
):
    camp = _campaign(tmp_path)
    plan = {
        "decision_id": f"director-npc-crash-{crash_stage}",
        "scene_action": "CHARACTER",
        "turn_input": {"active_scene_id": "scene-1", "turn_number": 1},
        "clue_policy": {"reveal": []},
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {},
        "npc_moves": [{"npc_id": "npc-recover", "agency_moves": []}],
    }
    real_ensure = coc_director_apply._ensure_npc_receipt_targets
    real_record = coc_director_apply._record_applied_decision

    def crash_ensure(campaign_dir, receipt):
        if (
            crash_stage == "after_source"
            and receipt.get("decision_id") == plan["decision_id"]
        ):
            raise RuntimeError("synthetic director NPC crash after source")
        return real_ensure(campaign_dir, receipt)

    def crash_record(save_dir, decision_id):
        if (
            crash_stage == "before_apply_ledger"
            and decision_id == plan["decision_id"]
        ):
            raise RuntimeError("synthetic director NPC crash before apply ledger")
        return real_record(save_dir, decision_id)

    with monkeypatch.context() as crash:
        crash.setattr(
            coc_director_apply, "_ensure_npc_receipt_targets", crash_ensure
        )
        crash.setattr(coc_director_apply, "_record_applied_decision", crash_record)
        with pytest.raises(RuntimeError, match="synthetic director NPC crash"):
            coc_director_apply.apply_plan(
                camp,
                plan,
                investigator_id="inv1",
                recording_mode=recording_mode,
            )

    later_plan = {
        "decision_id": f"later-plan-after-{crash_stage}",
        "scene_action": "PRESSURE",
        "clue_policy": {"reveal": []},
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {},
    }
    coc_director_apply.apply_plan(
        camp,
        later_plan,
        investigator_id="inv1",
        recording_mode=recording_mode,
    )
    if recording_mode == "fast":
        coc_director_apply.flush_pending_records(camp)

    rows = [
        json.loads(line)
        for line in (camp / "logs" / "events.jsonl").read_text(
            encoding="utf-8"
        ).splitlines()
        if line.strip()
    ]
    recovered = [
        row for row in rows
        if row.get("event_type") == "npc_engagement"
        and row.get("decision_id") == plan["decision_id"]
    ]
    assert len(recovered) == 1
    assert recovered[0]["event_id"].startswith("npc-engagement-v1:")
    receipts = json.loads((
        camp / "save" / "npc-engagement-receipts.json"
    ).read_text(encoding="utf-8"))["receipts"]
    assert [
        receipt for receipt in receipts.values()
        if receipt["decision_id"] == plan["decision_id"]
    ]


def test_director_npc_operation_set_is_frozen_before_events_and_conflicts_typed(
    tmp_path, monkeypatch,
):
    camp = _campaign(tmp_path)
    decision_id = "director-npc-immutable-operation-set"
    original_plan = {
        "decision_id": decision_id,
        "scene_action": "CHARACTER",
        "turn_input": {"active_scene_id": "scene-1", "turn_number": 1},
        "clue_policy": {"reveal": []},
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {},
        "npc_moves": [{
            "npc_id": "npc-a",
            "agency_moves": [{"move_id": "move-a", "reason": "first"}],
        }],
    }
    real_save = coc_director_apply._save_npc_receipt_document
    tripped = {"value": False}

    def crash_after_operation_set(campaign_dir, document):
        real_save(campaign_dir, document)
        if (
            not tripped["value"]
            and document.get("decision_sets")
            and not document.get("receipts")
        ):
            tripped["value"] = True
            raise RuntimeError("synthetic crash after NPC operation-set source")

    with monkeypatch.context() as crash:
        crash.setattr(
            coc_director_apply,
            "_save_npc_receipt_document",
            crash_after_operation_set,
        )
        with pytest.raises(RuntimeError, match="operation-set source"):
            coc_director_apply.apply_plan(
                camp, original_plan, investigator_id="inv1"
            )
    assert tripped["value"] is True
    source_after_crash = json.loads((
        camp / "save" / "npc-engagement-receipts.json"
    ).read_text(encoding="utf-8"))
    assert len(source_after_crash["decision_sets"]) == 1
    assert source_after_crash["receipts"] == {}

    changed_plan = {
        **original_plan,
        "npc_moves": [{
            "npc_id": "npc-b",
            "agency_moves": [{"move_id": "move-b", "reason": "changed"}],
        }],
    }
    with pytest.raises(
        coc_director_apply.coc_npc_event_chain.NpcOperationSetConflict
    ) as exc_info:
        coc_director_apply.apply_plan(
            camp, changed_plan, investigator_id="inv1"
        )
    assert exc_info.value.code == "idempotency_conflict"

    events = coc_director_apply.apply_plan(
        camp, original_plan, investigator_id="inv1"
    )
    produced = [
        row for row in events
        if row.get("event_type") in {"npc_engagement", "npc_agency"}
    ]
    assert [row["npc_id"] for row in produced] == ["npc-a", "npc-a"]
    event_rows = [
        json.loads(line)
        for line in (camp / "logs" / "events.jsonl").read_text().splitlines()
        if line.strip()
    ]
    assert [
        row.get("event_id") for row in event_rows
        if row.get("decision_id") == decision_id and row.get("event_id")
    ] == [row["event_id"] for row in produced]


def _campaign_bytes(camp: Path) -> dict[str, bytes]:
    return {
        path.relative_to(camp).as_posix(): path.read_bytes()
        for path in camp.rglob("*")
        if path.is_file() and ".locks" not in path.parts
    }


@pytest.mark.parametrize("changed", [False, True])
def test_completed_schema1_director_decision_is_unverifiable_even_with_full_receipts(
    tmp_path, changed,
):
    camp = _campaign(tmp_path)
    original_plan = {
        "decision_id": "legacy-completed-decision",
        "run_id": "legacy-run",
        "scene_action": "CHARACTER",
        "turn_input": {"active_scene_id": "scene-1", "turn_number": 1},
        "clue_policy": {"reveal": []},
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {},
        "npc_moves": [{
            "npc_id": "npc-a",
            "agency_moves": [{"move_id": "legacy-a", "reason": "first"}],
        }],
    }
    coc_director_apply.apply_plan(camp, original_plan, investigator_id="inv1")
    source_path = camp / "save" / "npc-engagement-receipts.json"
    source = json.loads(source_path.read_text(encoding="utf-8"))
    source_path.write_text(json.dumps({
        "schema_version": 1,
        "campaign_id": source["campaign_id"],
        "receipts": source["receipts"],
    }), encoding="utf-8")
    before = _campaign_bytes(camp)

    replay_plan = original_plan if not changed else {
        **original_plan,
        "npc_moves": [{
            "npc_id": "npc-b",
            "agency_moves": [{"move_id": "legacy-b", "reason": "changed"}],
        }],
    }
    with pytest.raises(
        coc_director_apply.coc_npc_event_chain.NpcOperationSetConflict
    ) as exc_info:
        coc_director_apply.apply_plan(
            camp, replay_plan, investigator_id="inv1"
        )

    assert exc_info.value.code == "legacy_recovery_unverifiable"
    assert _campaign_bytes(camp) == before


@pytest.mark.parametrize(
    "receipt_shape",
    ["missing_tail", "missing_middle", "only_zero", "extra_event"],
)
@pytest.mark.parametrize("changed", [False, True])
def test_completed_schema1_partial_receipts_always_fail_closed_before_writes(
    tmp_path, receipt_shape, changed,
):
    camp = _campaign(tmp_path)
    original_plan = {
        "decision_id": f"legacy-partial-{receipt_shape}",
        "run_id": "legacy-partial-run",
        "scene_action": "CHARACTER",
        "turn_input": {"active_scene_id": "scene-1", "turn_number": 1},
        "clue_policy": {"reveal": []},
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {},
        "npc_moves": [{
            "npc_id": "npc-a",
            "agency_moves": [
                {"move_id": "legacy-a", "reason": "first"},
                {"move_id": "legacy-b", "reason": "second"},
            ],
        }],
    }
    coc_director_apply.apply_plan(camp, original_plan, investigator_id="inv1")
    source_path = camp / "save" / "npc-engagement-receipts.json"
    source = json.loads(source_path.read_text(encoding="utf-8"))
    rows = sorted(
        source["receipts"].values(), key=lambda row: row["ordinal"]
    )
    if receipt_shape == "missing_tail":
        rows = rows[:-1]
    elif receipt_shape == "missing_middle":
        rows = [rows[0], rows[-1]]
    elif receipt_shape == "only_zero":
        rows = rows[:1]
    receipts = {row["event_id"]: row for row in rows}
    source_path.write_text(json.dumps({
        "schema_version": 1,
        "campaign_id": source["campaign_id"],
        "receipts": receipts,
    }), encoding="utf-8")
    if receipt_shape == "extra_event":
        with (camp / "logs" / "events.jsonl").open("a", encoding="utf-8") as handle:
            handle.write(json.dumps({
                "event_type": "npc_agency",
                "campaign_id": "test",
                "run_id": "legacy-partial-run",
                "decision_id": original_plan["decision_id"],
                "event_id": "unreceipted-extra-event",
            }) + "\n")
    before = _campaign_bytes(camp)

    with pytest.raises(
        coc_director_apply.coc_npc_event_chain.NpcOperationSetConflict
    ) as exc_info:
        coc_director_apply.apply_plan(
            camp,
            (
                {
                    **original_plan,
                    "npc_moves": [{"npc_id": "npc-changed", "agency_moves": []}],
                }
                if changed
                else original_plan
            ),
            investigator_id="inv1",
        )

    assert exc_info.value.code == "legacy_recovery_unverifiable"
    assert _campaign_bytes(camp) == before


@pytest.mark.parametrize("changed", [False, True])
def test_campaign_global_decision_id_rejects_cross_run_reuse_without_writes(
    tmp_path, changed,
):
    camp = _campaign(tmp_path)
    original = {
        "decision_id": "campaign-global-npc-decision",
        "run_id": "run-A",
        "scene_action": "CHARACTER",
        "turn_input": {"active_scene_id": "scene-1", "turn_number": 1},
        "clue_policy": {"reveal": []},
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {},
        "npc_moves": [{"npc_id": "npc-a", "agency_moves": []}],
    }
    coc_director_apply.apply_plan(camp, original, investigator_id="inv1")
    before = _campaign_bytes(camp)
    replay = {
        **original,
        "run_id": "run-B",
        "npc_moves": (
            [{"npc_id": "npc-b", "agency_moves": []}]
            if changed
            else original["npc_moves"]
        ),
    }

    with pytest.raises(
        coc_director_apply.coc_npc_event_chain.NpcOperationSetConflict
    ) as exc_info:
        coc_director_apply.apply_plan(camp, replay, investigator_id="inv1")

    assert exc_info.value.code == "idempotency_conflict"
    assert _campaign_bytes(camp) == before


def _downgrade_decision_set_to_legacy_run_scoped(receipt: dict) -> dict:
    chain = coc_director_apply.coc_npc_event_chain
    legacy = json.loads(json.dumps(receipt))
    legacy["schema_version"] = chain.LEGACY_DECISION_SET_RECEIPT_SCHEMA_VERSION
    legacy["receipt_id"] = chain.legacy_decision_set_receipt_id(
        producer=legacy["producer"],
        campaign_id=legacy["campaign_id"],
        run_id=legacy["run_id"],
        decision_id=legacy["decision_id"],
    )
    body = {key: value for key, value in legacy.items() if key != "integrity_digest"}
    legacy["integrity_digest"] = chain.canonical_digest(body)
    assert chain.valid_decision_set_receipt(legacy)
    return legacy


def test_unique_legacy_run_scoped_operation_set_migrates_only_on_exact_retry(
    tmp_path,
):
    camp = _campaign(tmp_path)
    plan = {
        "decision_id": "legacy-run-scoped-exact",
        "run_id": "run-A",
        "scene_action": "CHARACTER",
        "turn_input": {"active_scene_id": "scene-1", "turn_number": 1},
        "clue_policy": {"reveal": []},
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {},
        "npc_moves": [{"npc_id": "npc-a", "agency_moves": []}],
    }
    coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    source_path = camp / "save" / "npc-engagement-receipts.json"
    source = json.loads(source_path.read_text())
    current = next(iter(source["decision_sets"].values()))
    legacy = _downgrade_decision_set_to_legacy_run_scoped(current)
    source["decision_sets"] = {legacy["receipt_id"]: legacy}
    source_path.write_text(json.dumps(source), encoding="utf-8")

    replay = coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")

    assert replay[0]["event_type"] == "apply_skipped"
    migrated = json.loads(source_path.read_text())
    assert list(migrated["decision_sets"].values())[0]["schema_version"] == 2
    assert list(migrated["decision_sets"].values())[0]["run_id"] == "run-A"


def test_legacy_run_scoped_operation_set_rejects_cross_run_before_migration(
    tmp_path,
):
    camp = _campaign(tmp_path)
    plan = {
        "decision_id": "legacy-run-scoped-cross-run",
        "run_id": "run-A",
        "scene_action": "CHARACTER",
        "turn_input": {"active_scene_id": "scene-1", "turn_number": 1},
        "clue_policy": {"reveal": []},
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {},
        "npc_moves": [{"npc_id": "npc-a", "agency_moves": []}],
    }
    coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    source_path = camp / "save" / "npc-engagement-receipts.json"
    source = json.loads(source_path.read_text())
    current = next(iter(source["decision_sets"].values()))
    legacy = _downgrade_decision_set_to_legacy_run_scoped(current)
    source["decision_sets"] = {legacy["receipt_id"]: legacy}
    source_path.write_text(json.dumps(source), encoding="utf-8")
    before = _campaign_bytes(camp)

    with pytest.raises(
        coc_director_apply.coc_npc_event_chain.NpcOperationSetConflict
    ) as exc_info:
        coc_director_apply.apply_plan(
            camp, {**plan, "run_id": "run-B"}, investigator_id="inv1"
        )

    assert exc_info.value.code == "idempotency_conflict"
    assert _campaign_bytes(camp) == before


def test_multiple_legacy_run_scoped_operation_sets_fail_closed(tmp_path):
    camp = _campaign(tmp_path)
    plan = {
        "decision_id": "legacy-run-scoped-multiple",
        "run_id": "run-A",
        "scene_action": "CHARACTER",
        "turn_input": {"active_scene_id": "scene-1", "turn_number": 1},
        "clue_policy": {"reveal": []},
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {},
        "npc_moves": [{"npc_id": "npc-a", "agency_moves": []}],
    }
    coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    source_path = camp / "save" / "npc-engagement-receipts.json"
    source = json.loads(source_path.read_text())
    current = next(iter(source["decision_sets"].values()))
    first = _downgrade_decision_set_to_legacy_run_scoped(current)
    second_current = {
        **current,
        "run_id": "run-B",
    }
    second_current["receipt_id"] = (
        coc_director_apply.coc_npc_event_chain.decision_set_receipt_id(
            producer=second_current["producer"],
            campaign_id=second_current["campaign_id"],
            decision_id=second_current["decision_id"],
        )
    )
    second_current["integrity_digest"] = (
        coc_director_apply.coc_npc_event_chain.canonical_digest({
            key: value for key, value in second_current.items()
            if key != "integrity_digest"
        })
    )
    second = _downgrade_decision_set_to_legacy_run_scoped(second_current)
    source["decision_sets"] = {
        first["receipt_id"]: first,
        second["receipt_id"]: second,
    }
    source_path.write_text(json.dumps(source), encoding="utf-8")
    before = _campaign_bytes(camp)

    with pytest.raises(
        coc_director_apply.coc_npc_event_chain.NpcOperationSetConflict
    ) as exc_info:
        coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")

    assert exc_info.value.code == "idempotency_conflict"
    assert _campaign_bytes(camp) == before


@pytest.mark.parametrize("changed", [False, True])
def test_completed_schema1_director_decision_without_receipts_fails_closed(
    tmp_path, changed,
):
    camp = _campaign(tmp_path)
    original_plan = {
        "decision_id": "legacy-unverifiable-decision",
        "run_id": "legacy-unverifiable-run",
        "scene_action": "CHARACTER",
        "turn_input": {"active_scene_id": "scene-1", "turn_number": 1},
        "clue_policy": {"reveal": []},
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {},
        "npc_moves": [],
    }
    coc_director_apply.apply_plan(camp, original_plan, investigator_id="inv1")
    source_path = camp / "save" / "npc-engagement-receipts.json"
    source = json.loads(source_path.read_text(encoding="utf-8"))
    source_path.write_text(json.dumps({
        "schema_version": 1,
        "campaign_id": source["campaign_id"],
        "receipts": source["receipts"],
    }), encoding="utf-8")
    before = _campaign_bytes(camp)
    replay_plan = {
        **original_plan,
        "npc_moves": (
            [{"npc_id": "npc-new", "agency_moves": []}]
            if changed
            else []
        ),
    }

    with pytest.raises(
        coc_director_apply.coc_npc_event_chain.NpcOperationSetConflict
    ) as exc_info:
        coc_director_apply.apply_plan(
            camp, replay_plan, investigator_id="inv1"
        )

    assert exc_info.value.code == "legacy_recovery_unverifiable"
    assert _campaign_bytes(camp) == before


def test_apply_plan_npc_producer_contract_is_consumed_as_attested_coverage(
    tmp_path,
):
    """A real apply_plan event uses the same versioned identity binding."""
    camp = _campaign(tmp_path)
    (camp / "scenario" / "npc-agendas.json").write_text(
        json.dumps(
            {
                "npcs": [{
                    "npc_id": "npc-authority",
                    "name": "Structured Authority",
                    "origin": "module",
                    "agenda": "Keep the scene safe",
                    "voice": "Direct and concise",
                    "relationship_to_investigators": "scene authority",
                    "social_role": {"authority_scope": ["scene_safety"]},
                    "schedule": [{"scene_ids": ["scene-1"]}],
                    "source_refs": ["npc-agendas.json#npc-authority"],
                }]
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    plan = {
        "decision_id": "d-npc-producer-consumer-contract",
        "run_id": "producer-consumer-run",
        "scene_action": "CHARACTER",
        "turn_input": {"active_scene_id": "scene-1", "turn_number": 2},
        "clue_policy": {"reveal": []},
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {},
        "npc_moves": [{
            "npc_id": "npc-authority",
            "interaction_kind": "assistance",
            "agency_moves": [{
                "move_id": "secure-scene",
                "reason": "structured authority move",
            }],
        }],
    }

    events = coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    produced = [
        row
        for row in events
        if row.get("event_type") in {"npc_engagement", "npc_agency"}
    ]
    assert {row["event_type"] for row in produced} == {
        "npc_engagement", "npc_agency",
    }
    assert all(row["schema_version"] == 2 for row in produced)
    assert all(
        row["identity_contract"]["schema_version"] == 1 for row in produced
    )
    assert all(
        row["identity_binding"]["status"] == "authored_bound"
        and row["identity_binding"]["attestation_source"]
        == "director_apply.npc_move"
        for row in produced
    )
    assert coc_adherence.project_engaged_npc_ids(produced) == {"npc-authority"}
    evidence = coc_adherence.project_npc_engagement_evidence(produced)
    assert evidence["status"] == "PASS"
    assert evidence["legacy_unverifiable_npc_ids"] == []
    binding = coc_adherence.coc_npc_event_chain.build_artifact_binding(
        camp,
        artifact_run_id="producer-consumer-run",
        cumulative_run_ids=["producer-consumer-run"],
    )
    capability = coc_adherence.coc_npc_event_chain.load_canonical_chain(
        camp,
        expected_campaign_id=camp.name,
        expected_artifact_run_id="producer-consumer-run",
        expected_cumulative_run_ids=["producer-consumer-run"],
        expected_binding=binding,
    )
    consumed = coc_adherence._evaluate_adherence(
        [{
            "statement_id": "npc:npc-authority",
            "kind": "optional",
            "criterion": {"npc_id": "npc-authority"},
            "description": "Engage the structured authority",
        }],
        {"events": produced},
        canonical_npc_event_chain=capability,
        canonical_npc_binding=binding,
    )
    assert consumed["statements"][0]["satisfied"] is True
    assert consumed["npc_engagement_evidence"][
        "authored_attested_npc_ids"
    ] == ["npc-authority"]


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


def test_apply_marks_scene_exit_ready_when_clues_exhausted(tmp_path):
    """Clue exhaustion makes a scene leaveable without choosing travel for the player."""
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
    assert world2["active_scene_id"] == "scene-1"
    assert world2["exit_ready_scene_ids"] == ["scene-1"]


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


def test_apply_machine_checkable_exit_requires_separate_transition_authority(tmp_path):
    """A machine-checkable exit unlocks departure but does not authorize a destination."""
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
    assert world2["active_scene_id"] == "scene-1"
    assert world2["exit_ready_scene_ids"] == ["scene-1"]


def test_apply_no_exit_conditions_clue_exhaustion_marks_ready_without_travel(tmp_path):
    """Exhausting a clue-only scene still hands destination choice back to the player."""
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
    assert world2["active_scene_id"] == "scene-1"
    assert world2["exit_ready_scene_ids"] == ["scene-1"]


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
    (camp / "save" / "flags.json").write_text(json.dumps(
        coc_director_apply.coc_flag_state.new_flag_document(campaign_id="test")
    ))
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


def test_apply_structured_clue_discovered_exit_marks_ready(tmp_path):
    """Structured exit objects make departure available without selecting it."""
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
    assert world2["active_scene_id"] == "scene-1"
    assert world2["exit_ready_scene_ids"] == ["scene-1"]


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


def test_apply_structured_clock_reaches_exit_marks_ready(tmp_path):
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
    assert world2["active_scene_id"] == "scene-1"
    assert world2["exit_ready_scene_ids"] == ["scene-1"]


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


def _execute_normalized_push_lifecycle(
    camp: Path,
    character: Path,
    *,
    reroll_seed: int,
) -> tuple[dict, list[dict], dict, list[dict]]:
    executor = coc_director_apply.coc_subsystem_executor
    origin_plan = {
        "decision_id": "push-origin-decision",
        "scene_action": "REVEAL",
        "clue_policy": {
            "clue_type": "obscured",
            "reveal": ["clue-A"],
            "fallback_routes": ["clue-B"],
            "skill": "Spot Hidden",
            "difficulty": "regular",
        },
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {},
        "narrative_directives": {},
        "rules_requests": [{
            "kind": "skill_check",
            "skill": "Spot Hidden",
            "difficulty": "regular",
            "roll_contract": {
                "schema_version": 1,
                "goal": "surface clue-A",
                "success_effect": "commit clue-A",
                "failure_effect": "the watcher notices the search",
                "failure_outcome_mode": "clue_with_cost",
                "push_policy": {
                    "eligible": True,
                    "requires_changed_method": True,
                    "keeper_must_foreshadow_failure": True,
                },
                "push_failure_consequence": {
                    "summary": "the watcher identifies the investigator on failure",
                    "effect": {
                        "kind": "fictional_position",
                        "severity": "serious",
                    },
                },
                "roll_density_group": "clue:clue-A",
                "must_not": ["do not reveal clue-A on failure"],
            },
            "resolution_context": {
                "scene_action": "REVEAL",
                "clue_policy": {
                    "clue_type": "obscured",
                    "reveal": ["clue-A"],
                    "fallback_routes": ["clue-B"],
                    "skill": "Spot Hidden",
                    "difficulty": "regular",
                },
            },
        }],
    }
    origin_commands = executor.commands_from_rules_requests(origin_plan)
    origin_results = executor.execute_commands(
        camp,
        character,
        "inv1",
        origin_commands,
        rng=random.Random(5),
    )
    assert origin_results[0]["events"][0]["outcome"] == "failure"
    coc_director_apply.apply_plan(
        camp,
        origin_plan,
        "inv1",
        rules_results=origin_results,
        rules_results_mode="normalized",
    )
    offer_plan = {
        "decision_id": "push-offer-decision",
        "scene_action": "SUBSYSTEM",
        "clue_policy": {"reveal": []},
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {},
        "narrative_directives": {},
        "rules_requests": [{
            "kind": "push_offer",
            "original_command_id": origin_commands[0]["command_id"],
            "changed_method_evidence": {
                "changed": True,
                "source": "player_proposal",
                "summary": "inspect the binding impressions",
            },
            "announced_consequence": {
                "summary": "the watcher identifies the investigator on failure",
                "effect": {"kind": "fictional_position", "severity": "serious"},
            },
        }],
    }
    offer_results = executor.execute_commands(
        camp,
        character,
        "inv1",
        executor.commands_from_rules_requests(offer_plan),
        rng=random.Random(216),
    )
    choice = offer_results[0]["pending_choice"]
    response = {
        "choice_id": choice["choice_id"],
        "responder": "player",
        "revision": choice["revision"],
        "action": "confirm",
    }
    resume_plan = executor.plan_from_pending_choice_response(camp, "inv1", response)
    resume_commands = executor.commands_from_rules_requests(resume_plan)
    resume_results = executor.execute_commands(
        camp,
        character,
        "inv1",
        resume_commands,
        rng=random.Random(reroll_seed),
    )
    return origin_plan, origin_results, resume_plan, resume_results


def test_normalized_pushed_success_settles_originally_withheld_clue(tmp_path):
    camp = _campaign(tmp_path)
    character = _character_file(tmp_path)
    _origin_plan, _origin_results, resume_plan, resume_results = (
        _execute_normalized_push_lifecycle(camp, character, reroll_seed=1)
    )
    assert "clue-A" not in json.loads(
        (camp / "save" / "world-state.json").read_text()
    )["discovered_clue_ids"]

    events = coc_director_apply.apply_plan(
        camp,
        resume_plan,
        "inv1",
        rules_results=resume_results,
        rules_results_mode="normalized",
    )

    world = json.loads((camp / "save" / "world-state.json").read_text())
    assert "clue-A" in world["discovered_clue_ids"]
    assert any(event.get("event_type") == "clue_reveal" for event in events)


def test_normalized_pushed_failure_applies_exact_announced_consequence_once(tmp_path):
    camp = _campaign(tmp_path)
    character = _character_file(tmp_path)
    _origin_plan, _origin_results, resume_plan, resume_results = (
        _execute_normalized_push_lifecycle(camp, character, reroll_seed=5)
    )
    expected = {
        "summary": "the watcher identifies the investigator on failure",
        "effect": {"kind": "fictional_position", "severity": "serious"},
    }

    events = coc_director_apply.apply_plan(
        camp,
        resume_plan,
        "inv1",
        rules_results=resume_results,
        rules_results_mode="normalized",
    )

    pushed = [event for event in events if event.get("event_type") == "pushed_roll_failure"]
    assert len(pushed) == 1
    assert pushed[0]["push_gate"] == _FULL_PUSH_GATE
    assert pushed[0]["announced_consequence"] == expected
    assert pushed[0]["original_command_id"] == "push-origin-decision-rule-1"
    assert pushed[0]["original_roll_id"] == "push-origin-decision-rule-1"
    assert pushed[0]["source_command_id"] == resume_results[-1]["command_id"]
    applied = [
        event for event in events
        if event.get("event_type") == "pushed_consequence_applied"
    ]
    assert applied == [{
        "event_type": "pushed_consequence_applied",
        "decision_id": resume_plan["decision_id"],
        "investigator_id": "inv1",
        "source_command_id": resume_results[-1]["command_id"],
        "effect_kind": "fictional_position",
        "consequence_summary": expected["summary"],
        "ts": applied[0]["ts"],
    }]
    world = json.loads((camp / "save" / "world-state.json").read_text())
    assert world["pushed_consequences"] == [{
        "source_command_id": resume_results[-1]["command_id"],
        "decision_id": resume_plan["decision_id"],
        "kind": "fictional_position",
        "summary": expected["summary"],
        "severity": "serious",
    }]
    assert not any(event.get("event_type") == "failure_consequence" for event in events)
    before = (camp / "logs" / "events.jsonl").read_bytes()

    replay = coc_director_apply.apply_plan(
        camp,
        resume_plan,
        "inv1",
        rules_results=resume_results,
        rules_results_mode="normalized",
    )

    assert replay == [{
        "event_type": "apply_skipped",
        "skipped": "duplicate_decision_id",
        "decision_id": resume_plan["decision_id"],
    }]
    assert (camp / "logs" / "events.jsonl").read_bytes() == before


@pytest.mark.parametrize(
    ("effect", "expected_key", "expected_value"),
    [
        ({"kind": "fictional_position", "severity": "critical"}, "severity", "critical"),
        ({"kind": "condition", "condition_id": "marked"}, "condition_id", "marked"),
        ({"kind": "pressure_tick", "clock_id": "doom", "ticks": 2}, "ticks", 2),
    ],
)
def test_typed_push_consequence_handlers_materialize_once(
    tmp_path, effect, expected_key, expected_value,
):
    camp = _campaign(tmp_path)
    (camp / "save" / "investigator-state").mkdir(parents=True, exist_ok=True)
    (camp / "save" / "investigator-state" / "inv1.json").write_text(json.dumps({
        "investigator_id": "inv1", "conditions": [],
    }))
    (camp / "scenario" / "threat-fronts.json").write_text(json.dumps({
        "fronts": [{"clocks": [{"clock_id": "doom", "segments": 6}]}],
    }))
    world = {"discovered_clue_ids": []}
    push_event = {
        "event_type": "pushed_roll_failure",
        "source_command_id": "push-resolve-typed",
        "announced_consequence": {
            "summary": "the announced cost lands",
            "effect": effect,
        },
    }

    first = coc_director_apply._apply_typed_push_consequences(
        camp, "inv1", [push_event], world=world, decision_id="d-typed", ts="now"
    )
    second = coc_director_apply._apply_typed_push_consequences(
        camp, "inv1", [push_event], world=world, decision_id="d-typed", ts="later"
    )

    assert len(first) == 1
    assert second == []
    assert world["pushed_consequences"][0][expected_key] == expected_value
    if effect["kind"] == "condition":
        investigator = json.loads(
            (camp / "save" / "investigator-state" / "inv1.json").read_text()
        )
        assert investigator["conditions"] == ["marked"]
    if effect["kind"] == "pressure_tick":
        assert coc_director_apply.coc_threat_state.get_clock_segments(
            camp / "save", "doom"
        ) == 2


def test_pressure_tick_push_consequence_retry_after_target_write_is_exactly_once(
    tmp_path, monkeypatch,
):
    camp = _campaign(tmp_path)
    (camp / "scenario" / "threat-fronts.json").write_text(json.dumps({
        "fronts": [{"clocks": [{"clock_id": "doom", "segments": 6}]}],
    }))
    failure = {
        "event_type": "pushed_roll_failure",
        "source_command_id": "push-resolve-crash",
        "announced_consequence": {
            "summary": "the doom clock advances",
            "effect": {"kind": "pressure_tick", "clock_id": "doom", "ticks": 2},
        },
    }
    real_save = coc_director_apply.coc_threat_state._save_state
    writes = 0

    def persist_then_crash(save_dir, state):
        nonlocal writes
        real_save(save_dir, state)
        writes += 1
        if writes == 1:
            raise OSError("injected crash after threat-state target write")

    monkeypatch.setattr(
        coc_director_apply.coc_threat_state, "_save_state", persist_then_crash
    )
    with pytest.raises(OSError, match="after threat-state target write"):
        coc_director_apply._apply_typed_push_consequences(
            camp, "inv1", [failure], world={}, decision_id="d-crash", ts="first"
        )

    monkeypatch.setattr(coc_director_apply.coc_threat_state, "_save_state", real_save)
    recovered_world = {}
    applied = coc_director_apply._apply_typed_push_consequences(
        camp, "inv1", [failure], world=recovered_world,
        decision_id="d-crash", ts="retry",
    )

    assert coc_director_apply.coc_threat_state.get_clock_segments(
        camp / "save", "doom"
    ) == 2
    assert len(recovered_world["pushed_consequences"]) == 1
    assert len(applied) == 1
    receipt = recovered_world["pushed_consequences"][0]["clock_transition"]
    assert receipt["before_segments"] == 0
    assert receipt["after_segments"] == 2
    assert receipt["transition_id"].startswith("clock-transition:")


def test_pressure_consequence_existing_world_receipt_still_verifies_clock_ledger(
    tmp_path,
):
    camp = _campaign(tmp_path)
    (camp / "scenario" / "threat-fronts.json").write_text(json.dumps({
        "fronts": [{"clocks": [{"clock_id": "doom", "segments": 6}]}],
    }))
    failure = {
        "event_type": "pushed_roll_failure",
        "source_command_id": "push-resolve-tamper",
        "announced_consequence": {
            "summary": "the doom clock advances",
            "effect": {"kind": "pressure_tick", "clock_id": "doom", "ticks": 2},
        },
    }
    world = {}
    coc_director_apply._apply_typed_push_consequences(
        camp, "inv1", [failure], world=world, decision_id="d-tamper", ts="first"
    )
    threat_path = camp / "save" / "threat-state.json"
    threat = json.loads(threat_path.read_text())
    threat["clocks"]["doom"]["current_segments"] = 4
    threat_path.write_text(json.dumps(threat))

    with pytest.raises(ValueError, match="transition|clock"):
        coc_director_apply._apply_typed_push_consequences(
            camp, "inv1", [failure], world=world,
            decision_id="d-tamper", ts="retry",
        )


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


def test_apply_cut_records_departed_visited_and_scene_history(tmp_path):
    """On CUT transition, departed scene lands in visited; history appends enter."""
    camp = _campaign(tmp_path)
    world = json.loads((camp / "save" / "world-state.json").read_text())
    world["active_scene_id"] = "mission-briefing"
    world["unlocked_scene_ids"] = ["mission-briefing", "crossing-saddle"]
    world["visited_scene_ids"] = []
    world["exhausted_scene_ids"] = []
    world["scene_history"] = []
    (camp / "save" / "world-state.json").write_text(json.dumps(world))
    sg = {
        "scenes": [
            {
                "scene_id": "mission-briefing",
                "available_clues": ["clue-briefing"],
                "dramatic_question": "q1",
                "entry_conditions": [],
                "exit_conditions": ["orders_received"],
            },
            {
                "scene_id": "crossing-saddle",
                "available_clues": ["clue-saddle"],
                "dramatic_question": "q2",
                "entry_conditions": [],
                "exit_conditions": [],
            },
        ]
    }
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(sg))
    plan = {
        "decision_id": "d-move-cut",
        "scene_action": "CUT",
        "transition_to": "crossing-saddle",
        "clue_policy": {"reveal": []},
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {},
        "narrative_directives": {},
        "turn_input": {
            "player_intent_class": "move",
            "active_scene_id": "mission-briefing",
        },
    }
    events = coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")
    world2 = json.loads((camp / "save" / "world-state.json").read_text())
    assert world2["active_scene_id"] == "crossing-saddle"
    assert "mission-briefing" in world2["visited_scene_ids"]
    assert "crossing-saddle" in world2["visited_scene_ids"]
    assert any(
        h.get("scene_id") == "crossing-saddle"
        and (h.get("entered_at_decision_id") == "d-move-cut" or h.get("decision_id") == "d-move-cut")
        for h in world2["scene_history"]
    )
    assert any(
        e.get("event_type") == "scene_transition"
        and e.get("from_scene") == "mission-briefing"
        and e.get("to_scene") == "crossing-saddle"
        for e in events
    )


def _bonus_plan(clue_id="clue-A", on_fail_cost="time"):
    return {
        "decision_id": "d-bonus",
        "scene_action": "REVEAL",
        "clue_policy": {
            "reveal": [clue_id],
            "clue_type": "obvious",
            "bonus": {
                "schema_version": 1,
                "origin": "improvised",
                "skill": "Spot Hidden",
                "difficulty": "regular",
                "extra_summary": "A faint chalk mark under the sill.",
                "on_fail_cost": on_fail_cost,
                "fumble_consequence": {
                    "summary": "The failed search marks the investigator as rattled.",
                    "effect": {
                        "kind": "condition", "condition_id": "bonus-rattled",
                    },
                },
            },
        },
        "rules_requests": [{
            "kind": "skill_check",
            "skill": "Spot Hidden",
            "reason": "clue bonus detail",
            "difficulty": "regular",
            "bonus_penalty_dice": 0,
            "clue_bonus": True,
            "clue_id": clue_id,
            "roll_contract": {
                "schema_version": 1,
                "goal": "gain extra investigative detail",
                "success_effect": "attach bonus_reveal without gating the core clue",
                "failure_effect": "core clue still lands; pay time or pressure cost",
                "failure_outcome_mode": "bonus_with_cost",
                "authored_clue_bonus": True,
                "fumble_consequence": {
                    "summary": "The failed search marks the investigator as rattled.",
                    "effect": {
                        "kind": "condition", "condition_id": "bonus-rattled",
                    },
                },
                "roll_density_group": f"clue-bonus:{clue_id}",
                "must_not": ["do not withhold the core clue on bonus failure"],
            },
        }],
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {},
        "narrative_directives": {
            "must_include": ["Core clue summary stays visible."],
        },
    }


def test_backfill_bonus_success_attaches_bonus_reveal_keeps_core_clue():
    plan = _bonus_plan()
    resolved = coc_director_apply.backfill_rule_results(plan, [{
        "kind": "skill_check",
        "skill": "Spot Hidden",
        "success": True,
        "outcome": "regular_success",
        "roll_contract": plan["rules_requests"][0]["roll_contract"],
    }])
    assert resolved["clue_policy"]["bonus_reveal"] == "A faint chalk mark under the sill."
    assert "bonus_cost" not in resolved["clue_policy"]
    assert "A faint chalk mark under the sill." in (
        resolved.get("narrative_directives") or {}
    ).get("must_include", [])
    assert resolved["resolved_clue_policy"]["committed_reveals"] == ["clue-A"]


def test_backfill_bonus_failure_attaches_cost_without_withholding_core():
    plan = _bonus_plan(on_fail_cost="pressure")
    resolved = coc_director_apply.backfill_rule_results(plan, [{
        "kind": "skill_check",
        "skill": "Spot Hidden",
        "success": False,
        "outcome": "failure",
        "roll_contract": plan["rules_requests"][0]["roll_contract"],
    }])
    assert resolved["clue_policy"]["bonus_cost"] == "pressure"
    assert "bonus_reveal" not in resolved["clue_policy"]
    assert resolved["resolved_clue_policy"]["committed_reveals"] == ["clue-A"]
    assert "Core clue summary stays visible." in (
        resolved.get("narrative_directives") or {}
    ).get("must_include", [])


def test_apply_bonus_failure_keeps_core_clue_and_adds_pressure(tmp_path):
    camp = _campaign(tmp_path)
    plan = _bonus_plan(on_fail_cost="pressure")
    events = coc_director_apply.apply_plan(
        camp,
        plan,
        investigator_id="inv1",
        rules_results=[{
            "kind": "skill_check",
            "skill": "Spot Hidden",
            "success": False,
            "outcome": "failure",
            "roll_contract": plan["rules_requests"][0]["roll_contract"],
        }],
    )
    world = json.loads((camp / "save" / "world-state.json").read_text())
    assert "clue-A" in world["discovered_clue_ids"]
    assert any(e.get("event_type") == "clue_reveal" for e in events)
    assert any(e.get("event_type") == "clue_bonus_cost" for e in events)
    pacing = json.loads((camp / "save" / "pacing-state.json").read_text())
    assert pacing["tension_level"] in {"medium", "high", "climax"} or pacing.get("turn_number", 0) >= 1


def test_apply_plan_flags_set_unlocks_and_cuts(tmp_path):
    """P1 regression: move-committed flag_set must unlock then CUT same turn."""
    camp = _campaign(tmp_path)
    sg = {
        "scenes": [
            {
                "scene_id": "lima-museum",
                "is_start": True,
                "dramatic_question": "leave?",
                "available_clues": ["clue-a"],
                "exit_conditions": [{"kind": "always"}],
                "scene_edges": [
                    {
                        "to": "travel-to-puno",
                        "kind": "unlock",
                        "when": {"kind": "flag_set", "flag_id": "expedition_departs_lima"},
                    },
                    {
                        "to": "travel-to-puno",
                        "kind": "travel",
                        "when": {"kind": "flag_set", "flag_id": "expedition_departs_lima"},
                    },
                ],
            },
            {
                "scene_id": "travel-to-puno",
                "dramatic_question": "prepare?",
                "available_clues": [],
                "exit_conditions": [{"kind": "always"}],
                "scene_edges": [],
                "on_enter": {"sets_flags": ["arrived_puno"]},
            },
        ]
    }
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(sg))
    world = json.loads((camp / "save" / "world-state.json").read_text())
    world.update({
        "active_scene_id": "lima-museum",
        "unlocked_scene_ids": ["lima-museum"],
        "visited_scene_ids": ["lima-museum"],
        "exhausted_scene_ids": [],
        "discovered_clue_ids": ["clue-a"],
    })
    (camp / "save" / "world-state.json").write_text(json.dumps(world))
    (camp / "save" / "flags.json").write_text(json.dumps(
        coc_director_apply.coc_flag_state.new_flag_document(campaign_id="test")
    ))

    events = coc_director_apply.apply_plan(
        camp,
        {
            "decision_id": "d-flag-cut",
            "scene_action": "CUT",
            "transition_to": "travel-to-puno",
            "flags_set": ["expedition_departs_lima"],
            "clue_policy": {"reveal": []},
            "pressure_moves": [],
            "memory_writes": [],
            "rule_signals": {},
        },
        investigator_id="inv1",
    )
    types = [e.get("event_type") for e in events]
    assert "flag_set" in types
    assert "scene_unlocked" in types
    assert "scene_transition" in types
    world2 = json.loads((camp / "save" / "world-state.json").read_text())
    assert world2["active_scene_id"] == "travel-to-puno"
    assert "travel-to-puno" in world2["unlocked_scene_ids"]
    flags = json.loads((camp / "save" / "flags.json").read_text())
    assert flags["flags"]["expedition_departs_lima"] is True
    assert flags["flags"]["arrived_puno"] is True


@pytest.mark.parametrize(
    ("recording_mode", "fail_stage"),
    [
        ("sync", "source"),
        ("sync", "event"),
        ("sync", "apply_ledger"),
        ("fast", "source"),
        ("fast", "event"),
        ("fast", "recorder"),
        ("fast", "apply_ledger"),
    ],
)
def test_director_flag_receipt_repairs_every_commit_boundary_exactly_once(
    tmp_path, monkeypatch, recording_mode, fail_stage,
):
    camp = _campaign(tmp_path)
    decision_id = f"director-flag-{recording_mode}-{fail_stage}"
    flag_id = "receipt-bound-flag"
    event_id = coc_director_apply.coc_flag_state.director_flag_event_id(
        decision_id, flag_id
    )
    plan = {
        "decision_id": decision_id,
        "scene_action": "CHARACTER",
        "flags_set": [flag_id],
        "clue_policy": {"reveal": []},
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {},
    }
    tripped = {"value": False}

    if fail_stage == "source":
        original = coc_director_apply._write_json

        def fail_source(path, payload):
            if (
                not tripped["value"]
                and Path(path).name == "flags.json"
                and payload.get(
                    coc_director_apply.coc_flag_state.DIRECTOR_FLAG_RECEIPTS_KEY
                )
            ):
                tripped["value"] = True
                raise RuntimeError("source failpoint")
            return original(path, payload)

        monkeypatch.setattr(coc_director_apply, "_write_json", fail_source)
    elif fail_stage == "event":
        original = coc_director_apply._append_jsonl

        def fail_event(path, record):
            if not tripped["value"] and record.get("event_id") == event_id:
                tripped["value"] = True
                raise RuntimeError("event failpoint")
            return original(path, record)

        monkeypatch.setattr(coc_director_apply, "_append_jsonl", fail_event)
    elif fail_stage == "recorder":
        recorder_cls = coc_director_apply.coc_async_recorder.JsonlRecorder
        original = recorder_cls.commit

        def fail_recorder(self):
            if not tripped["value"]:
                tripped["value"] = True
                raise RuntimeError("recorder failpoint")
            return original(self)

        monkeypatch.setattr(recorder_cls, "commit", fail_recorder)
    else:
        original = coc_director_apply._record_applied_decision

        def fail_ledger(save, current_decision):
            if not tripped["value"] and current_decision == decision_id:
                tripped["value"] = True
                raise RuntimeError("apply ledger failpoint")
            return original(save, current_decision)

        monkeypatch.setattr(
            coc_director_apply, "_record_applied_decision", fail_ledger
        )

    with pytest.raises(RuntimeError):
        coc_director_apply.apply_plan(
            camp,
            plan,
            investigator_id="inv1",
            recording_mode=recording_mode,
    )
    assert tripped["value"] is True

    if fail_stage != "source":
        # Recovery is global: a host may choose another plan instead of
        # replaying the interrupted decision first.
        coc_director_apply.apply_plan(
            camp,
            {
                "decision_id": f"later-after-{decision_id}",
                "scene_action": "PRESSURE",
                "clue_policy": {"reveal": []},
                "pressure_moves": [],
                "memory_writes": [],
                "rule_signals": {},
            },
            investigator_id="inv1",
            recording_mode=recording_mode,
        )

    coc_director_apply.apply_plan(
        camp,
        plan,
        investigator_id="inv1",
        recording_mode=recording_mode,
    )
    if recording_mode == "fast":
        coc_director_apply.coc_async_recorder.flush_pending_records(camp)

    flags = json.loads((camp / "save" / "flags.json").read_text())
    assert flags["flags"][flag_id] is True
    receipt_key = coc_director_apply.coc_flag_state.director_flag_receipt_key(
        decision_id, flag_id
    )
    receipt = flags[
        coc_director_apply.coc_flag_state.DIRECTOR_FLAG_RECEIPTS_KEY
    ][receipt_key]
    assert coc_director_apply.coc_flag_state.valid_director_flag_receipt(
        receipt, decision_id=decision_id, flag_id=flag_id
    )
    event_rows = [
        json.loads(line)
        for line in (camp / "logs" / "events.jsonl").read_text().splitlines()
        if line.strip()
    ]
    matching = [row for row in event_rows if row.get("event_id") == event_id]
    assert matching == [receipt["event"]]
    ledger = json.loads((camp / "save" / "apply-ledger.json").read_text())
    assert decision_id in ledger["applied_decision_ids"]
