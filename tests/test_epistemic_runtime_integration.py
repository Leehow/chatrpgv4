"""End-to-end tests for epistemic DirectorPlan and apply semantics."""
import importlib.util
import json
import random
from pathlib import Path


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, rel)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_story_director = _load(
    "coc_story_director_epistemic_integration",
    "plugins/coc-keeper/scripts/coc_story_director.py",
)
coc_director_apply = _load(
    "coc_director_apply_epistemic_integration",
    "plugins/coc-keeper/scripts/coc_director_apply.py",
)


def _campaign(tmp_path: Path):
    camp = tmp_path / "campaigns" / "test"
    (camp / "save" / "investigator-state").mkdir(parents=True)
    (camp / "scenario").mkdir(parents=True)
    (camp / "logs").mkdir(parents=True)
    (camp / "memory" / "cards" / "player-safe").mkdir(parents=True)

    (camp / "save" / "investigator-state" / "inv1.json").write_text(json.dumps({
        "schema_version": 1,
        "campaign_id": "test",
        "investigator_id": "inv1",
        "current_hp": 12,
        "current_san": 55,
        "current_mp": 11,
        "conditions": [],
        "skill_checks_earned": [],
    }))
    (camp / "save" / "world-state.json").write_text(json.dumps({
        "schema_version": 1,
        "campaign_id": "test",
        "scenario_id": "test-mod",
        "status": "active",
        "active_scene_id": "scene-1",
        "active_subsystem": "play",
        "current_phase": "middle",
        "discovered_clue_ids": [],
        "major_decisions": [],
    }))
    (camp / "save" / "flags.json").write_text(json.dumps({
        "schema_version": 1,
        "campaign_id": "test",
        "clues_found": {},
        "decisions": [],
    }))
    (camp / "save" / "pacing-state.json").write_text(json.dumps({
        "schema_version": 1,
        "tension_level": "low",
        "lethal_chances_used": 0,
        "recent_intent_classes": [],
        "recent_intent_tags": [],
        "turn_number": 0,
        "luck_spent_last": 0,
    }))
    (camp / "logs" / "events.jsonl").write_text("")

    (camp / "scenario" / "module-meta.json").write_text(json.dumps({
        "schema_version": 1,
        "scenario_id": "test-mod",
        "structure_type": "branching_investigation",
        "era": "1920s",
        "content_flags": [],
        "win_condition": "test",
    }))
    (camp / "scenario" / "story-graph.json").write_text(json.dumps({
        "scenes": [{
            "scene_id": "scene-1",
            "is_start": True,
            "scene_type": "investigation",
            "dramatic_question": "Why were the records altered?",
            "entry_conditions": [],
            "exit_conditions": [],
            "available_clues": ["clue-current"],
            "npc_ids": [],
            "pressure_moves": [],
            "tone": ["tense"],
            "allowed_improvisation": [],
        }]
    }))
    (camp / "scenario" / "clue-graph.json").write_text(json.dumps({
        "conclusions": [{
            "conclusion_id": "concl-motive",
            "importance": "critical",
            "minimum_routes": 1,
            "clues": [{
                "clue_id": "clue-current",
                "delivery": "visible ledger alteration",
                "delivery_kind": "obvious",
                "visibility": "player-safe",
                "player_safe_summary": "One name was deliberately preserved in the altered ledger.",
            }],
            "fallback_policy": "RECOVER",
        }]
    }))
    (camp / "scenario" / "npc-agendas.json").write_text(json.dumps({"npcs": []}))
    (camp / "scenario" / "threat-fronts.json").write_text(json.dumps({"fronts": []}))
    (camp / "scenario" / "pacing-map.json").write_text(json.dumps({
        "pacing_curve": [{
            "scene_id": "scene-1",
            "tension_target": "medium",
            "horror_stage": "wrongness",
        }]
    }))
    (camp / "scenario" / "improvisation-boundaries.json").write_text(json.dumps({
        "invent_allowed": [],
        "never_invent": [],
        "keeper_secrets": ["secret-1"],
    }))
    (camp / "scenario" / "epistemic-graph.json").write_text(json.dumps({
        "schema_version": 1,
        "questions": [{
            "question_id": "q-motive",
            "layer": "motive",
            "player_facing_question": "Why were the records altered?",
            "truth_ref": "truth-protects-survivor",
            "importance": "critical",
            "opens_questions": ["q-structure"],
        }, {
            "question_id": "q-structure",
            "layer": "structure",
            "player_facing_question": "Who selected the names?",
            "truth_ref": "truth-selection-program",
            "importance": "major",
        }],
        "evidence_links": [{
            "clue_id": "clue-current",
            "question_id": "q-motive",
            "effect": "complicate",
            "strength": 0.8,
        }],
    }))
    (camp / "scenario" / "reveal-contracts.json").write_text(json.dumps({
        "schema_version": 1,
        "contracts": [],
    }))

    char_dir = tmp_path / "investigators" / "inv1"
    char_dir.mkdir(parents=True)
    char_path = char_dir / "character.json"
    char_path.write_text(json.dumps({
        "schema_version": 1,
        "id": "inv1",
        "occupation": "Antiquarian",
        "era": "1920s",
        "characteristics": {
            "STR": 60, "CON": 55, "SIZ": 65, "DEX": 50, "APP": 45,
            "INT": 70, "POW": 55, "EDU": 75, "LUCK": 55,
        },
        "derived": {"HP": 12, "MP": 11, "SAN": 55, "MOV": 7},
        "skills": {"Credit Rating": 50, "Spot Hidden": 60, "Psychology": 55},
        "backstory": {},
    }))
    return camp, char_path


def test_director_context_loads_epistemic_sidecars_and_belief_state(tmp_path):
    camp, char_path = _campaign(tmp_path)
    (camp / "save" / "belief-state.json").write_text(json.dumps({
        "schema_version": 1,
        "hypotheses": [{
            "hypothesis_id": "hyp-000001",
            "question_id": "q-motive",
            "status": "active",
        }],
        "active_question_ids": ["q-motive"],
        "answered_question_ids": [],
    }))

    ctx = coc_story_director.build_director_context(
        campaign_dir=camp,
        character_path=char_path,
        investigator_id="inv1",
        player_intent="I inspect the altered ledger.",
        player_intent_class="investigate",
        player_intent_rich={
            "primary_intent": "investigate",
            "target_entities": ["ledger"],
            "secondary_intents": [],
            "risk_posture": "cautious",
            "explicit_roll_request": False,
            "action_atoms": [],
        },
        rng=random.Random(42),
    )

    assert ctx["epistemic_graph"]["questions"][0]["question_id"] == "q-motive"
    assert ctx["reveal_contracts"]["contracts"] == []
    assert ctx["belief_state"]["hypotheses"][0]["hypothesis_id"] == "hyp-000001"


def test_director_plan_emits_epistemic_contract_and_rich_intent(tmp_path):
    camp, char_path = _campaign(tmp_path)
    rich = {
        "primary_intent": "investigate",
        "target_entities": ["ledger"],
        "secondary_intents": [],
        "risk_posture": "cautious",
        "explicit_roll_request": False,
        "player_hypothesis": {
            "claim": "The archivist altered the records for personal reasons.",
            "question_id": "q-motive",
            "hypothesis_kind": "personal-coverup",
            "confidence": 0.7,
        },
        "action_atoms": [],
    }
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp,
        character_path=char_path,
        investigator_id="inv1",
        player_intent="I inspect the altered ledger.",
        player_intent_class="investigate",
        player_intent_rich=rich,
        rng=random.Random(42),
    )

    plan = coc_story_director.generate_director_plan(ctx, decision_id="turn-1")

    assert plan["epistemic_contract"]["mode"] == "COMPLICATE"
    assert plan["epistemic_contract"]["deliver_clue_ids"] == ["clue-current"]
    assert plan["turn_input"]["player_intent_rich"] == rich


def test_apply_committed_epistemic_clue_updates_belief_state(tmp_path):
    camp, _ = _campaign(tmp_path)
    plan = {
        "decision_id": "turn-1",
        "scene_action": "REVEAL",
        "turn_input": {
            "turn_number": 1,
            "player_intent_class": "investigate",
            "player_intent_rich": {
                "primary_intent": "investigate",
                "player_hypothesis": {
                    "claim": "The archivist altered the records for personal reasons.",
                    "question_id": "q-motive",
                    "hypothesis_kind": "personal-coverup",
                    "confidence": 0.7,
                },
            },
        },
        "clue_policy": {"reveal": ["clue-current"], "clue_type": "obvious"},
        "epistemic_contract": {
            "schema_version": 1,
            "mode": "COMPLICATE",
            "target_question_id": "q-motive",
            "belief_refs": [],
            "deliver_clue_ids": ["clue-current"],
            "open_question_ids": ["q-structure"],
        },
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {},
    }

    events = coc_director_apply.apply_plan(camp, plan, investigator_id="inv1")

    state = json.loads((camp / "save" / "belief-state.json").read_text())
    record = state["hypotheses"][0]
    assert record["recent_treatments"] == ["complicate"]
    assert record["challenging_clue_ids"] == ["clue-current"]
    assert state["active_question_ids"] == ["q-structure"]
    assert any(event.get("event_type") == "belief_complicated" for event in events)


def test_apply_failed_obscured_clue_does_not_apply_belief_treatment(tmp_path):
    camp, _ = _campaign(tmp_path)
    (camp / "save" / "belief-state.json").write_text(json.dumps({
        "schema_version": 1,
        "hypotheses": [{
            "hypothesis_id": "hyp-000001",
            "owner": "party",
            "question_id": "q-motive",
            "hypothesis_kind": "personal-coverup",
            "claim": "The archivist altered the records for personal reasons.",
            "confidence": 0.7,
            "status": "active",
            "supporting_clue_ids": [],
            "challenging_clue_ids": [],
            "recent_treatments": [],
            "created_turn": 1,
            "updated_turn": 1,
        }],
        "active_question_ids": ["q-motive"],
        "answered_question_ids": [],
    }))
    roll_contract = {
        "schema_version": 1,
        "goal": "surface clue",
        "success_effect": "commit clue",
        "failure_effect": "withhold clue with cost",
        "failure_outcome_mode": "clue_with_cost",
        "roll_density_group": "clue:clue-current",
        "must_not": [],
    }
    plan = {
        "decision_id": "turn-2",
        "scene_action": "REVEAL",
        "turn_input": {
            "turn_number": 2,
            "player_intent_class": "investigate",
            "player_intent_rich": {"primary_intent": "investigate"},
        },
        "clue_policy": {
            "reveal": ["clue-current"],
            "clue_type": "obscured",
            "skill": "Library Use",
        },
        "epistemic_contract": {
            "schema_version": 1,
            "mode": "COMPLICATE",
            "target_question_id": "q-motive",
            "belief_refs": ["hyp-000001"],
            "deliver_clue_ids": ["clue-current"],
        },
        "rules_requests": [{
            "kind": "skill_check",
            "skill": "Library Use",
            "reason": "obscured clue in scene",
            "roll_contract": roll_contract,
        }],
        "pressure_moves": [],
        "memory_writes": [],
        "rule_signals": {},
    }
    rules_results = [{
        "kind": "skill_check",
        "skill": "Library Use",
        "success": False,
        "outcome": "failure",
        "roll_contract": roll_contract,
    }]

    events = coc_director_apply.apply_plan(
        camp,
        plan,
        investigator_id="inv1",
        rules_results=rules_results,
    )

    state = json.loads((camp / "save" / "belief-state.json").read_text())
    record = state["hypotheses"][0]
    assert record["recent_treatments"] == []
    assert record["challenging_clue_ids"] == []
    assert not any(event.get("event_type") == "belief_complicated" for event in events)
