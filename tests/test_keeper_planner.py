"""Private Keeper planning contract and advisory-rule integration."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest


REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"


def _load(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


planner = _load("test_coc_keeper_planner", "coc_keeper_planner.py")
action_resolver = _load("test_coc_keeper_action_resolver", "coc_action_resolver.py")
director = _load("test_coc_keeper_story_director", "coc_story_director.py")


def _request() -> dict:
    return {
        "player_text": "I ask Ruth why the files stop at 1878.",
        "rule_advice": [{
            "advice_id": "core:roll-only-for-meaningful-uncertainty",
        }],
        "keeper_context": {
            "present_or_scene_npcs": [{"npc_id": "npc-ruth"}],
            "npc_fact_capabilities": [{
                "npc_id": "npc-ruth",
                "fact_id": "fact-cutoff",
                "known_by_npc": True,
                "revealable": True,
            }],
        },
    }


def _proposal(**overrides) -> dict:
    value = {
        "schema_version": 1,
        "source": "model",
        "resolution_mode": "improvised",
        "scene_action": "CHARACTER",
        "player_goal": "understand why the archive ends in 1878",
        "fictional_method": "ask Ruth while showing her the clipping chronology",
        "rule_ruling": {
            "decision": "no_roll",
            "operation_kind": None,
            "skill": None,
            "difficulty": None,
            "bonus_penalty_dice": 0,
            "accepted_advice_ids": [
                "core:roll-only-for-meaningful-uncertainty",
            ],
            "overridden_advice_ids": [],
            "reason": "A cooperative archivist can answer this routine question.",
        },
        "npc_ruling": {
            "npc_id": "npc-ruth",
            "tactic": "answer",
            "fact_id": "fact-cutoff",
            "reason": "Ruth knows and may reveal the archive limit.",
        },
        "narration_plan": {
            "beat": "character",
            "tone": ["helpful", "musty"],
            "sensory_focus": ["dust on the clipping folders"],
            "end_with": "actionable_hook",
            "objective": "Let Ruth answer and point toward an older source.",
        },
        "rationale": "The question is understood even without a bespoke route.",
    }
    value.update(overrides)
    return value


def test_understood_off_menu_action_is_a_keeper_beat_not_no_match():
    resolution = {
        "matched_affordance_ids": [],
        "matched_destination_scene_id": None,
        "normalized_action_atoms": [],
        "primary_intent": "social",
        "no_match": False,
    }

    result = planner.validate_keeper_proposal(
        _proposal(), request=_request(), resolution=resolution,
    )

    assert result["resolution_mode"] == "improvised"
    assert result["scene_action"] == "CHARACTER"
    assert result["rule_ruling"]["decision"] == "no_roll"
    assert result["npc_ruling"]["fact_id"] == "fact-cutoff"


def test_private_keeper_cannot_authorize_an_unknown_or_hidden_npc_fact():
    proposal = _proposal()
    proposal["npc_ruling"] = {
        "npc_id": "npc-ruth",
        "tactic": "answer",
        "fact_id": "keeper-secret-buried-body",
        "reason": "Try to reveal an unsupplied secret.",
    }

    with pytest.raises(RuntimeError, match="unauthorized NPC fact"):
        planner.validate_keeper_proposal(
            proposal,
            request=_request(),
            resolution={
                "matched_affordance_ids": [],
                "matched_destination_scene_id": None,
                "normalized_action_atoms": [],
                "primary_intent": "social",
                "no_match": False,
            },
        )


def test_public_projection_drops_private_rationale_objective_and_sensory_plan():
    public = planner.public_projection(_proposal())
    serialized = json.dumps(public, ensure_ascii=False)

    assert public["narration"]["beat"] == "character"
    assert public["narration"]["sensory_focus"] == []
    assert "Let Ruth answer" not in serialized
    assert "bespoke route" not in serialized


def test_model_keeper_proposal_replaces_fixed_scene_action_scoring():
    proposal = _proposal()
    scene = {
        "scene_id": "archive",
        "scene_type": "social",
        "affordances": [],
        "scene_edges": [],
        "available_clues": [],
        "npc_ids": ["npc-ruth"],
    }
    ctx = {
        "active_scene_id": "archive",
        "active_scene": scene,
        "story_graph": {"scenes": [scene]},
        "world_state": {
            "active_scene_id": "archive",
            "unlocked_scene_ids": ["archive"],
            "discovered_clue_ids": [],
        },
        "flags": {"flags": {}},
        "clue_graph": {"conclusions": []},
        "player_intent_class": "social",
        "player_intent_rich": {
            "action_resolution": {
                "matched_affordance_ids": [],
                "matched_destination_scene_id": None,
                "no_match": False,
                "keeper_proposal": proposal,
            },
        },
        "rule_signals": {
            "bout_active": False,
            "hp_state": "healthy",
            "last_roll_fumble": False,
            "low_agency_continue_count": 0,
            "scene_pressure_available": False,
            "stalled_turns": 0,
        },
    }

    override = director.apply_rule_signal_overrides(ctx)

    assert override["scene_action"] == "CHARACTER"
    assert override["keeper_proposal_authority"] == "llm_keeper_discretion"


def test_compatibility_proposal_does_not_silently_replace_legacy_fallback():
    proposal = _proposal(source="compatibility_fallback")
    scene = {
        "scene_id": "archive", "scene_type": "social",
        "affordances": [], "scene_edges": [], "available_clues": [],
    }
    ctx = {
        "active_scene_id": "archive",
        "active_scene": scene,
        "story_graph": {"scenes": [scene]},
        "world_state": {
            "active_scene_id": "archive",
            "unlocked_scene_ids": ["archive"],
            "discovered_clue_ids": [],
        },
        "flags": {"flags": {}},
        "clue_graph": {"conclusions": []},
        "player_intent_class": "social",
        "player_intent_rich": {
            "action_resolution": {
                "matched_affordance_ids": [],
                "matched_destination_scene_id": None,
                "no_match": False,
                "keeper_proposal": proposal,
            },
        },
        "rule_signals": {
            "bout_active": False,
            "hp_state": "healthy",
            "last_roll_fumble": False,
            "low_agency_continue_count": 0,
            "scene_pressure_available": False,
            "stalled_turns": 0,
        },
    }

    assert director.apply_rule_signal_overrides(ctx) is None


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")


def _campaign(tmp_path: Path) -> tuple[Path, Path]:
    campaign = tmp_path / "campaign"
    gate = {
        "kind": "skill_check",
        "difficulty": "regular",
        "stakes": "gain access to the archive",
        "ordinary_failure": {
            "mode": "no_progress",
            "summary": "Access is refused.",
            "localized_summaries": {"zh-Hans": "对方拒绝开放档案。"},
        },
        "fumble_consequence": {
            "summary": "The investigator is barred.",
            "localized_summaries": {"zh-Hans": "调查员被禁止进入。"},
            "effect": {"kind": "route_closed", "route_id": "gain-access"},
        },
        "push_failure_consequence": {
            "summary": "The investigator is barred.",
            "localized_summaries": {"zh-Hans": "调查员被禁止进入。"},
            "effect": {"kind": "route_closed", "route_id": "gain-access"},
        },
        "approaches": [{"verb": "persuade", "skill": "Persuade"}],
    }
    _write_json(campaign / "scenario" / "story-graph.json", {
        "scenes": [{
            "scene_id": "archive",
            "scene_type": "social",
            "dramatic_question": "Will the clerk cooperate?",
            "npc_ids": [],
            "available_clues": [],
            "affordances": [{
                "id": "gain-access",
                "cue": "Persuade the clerk to grant archive access.",
                "target_entities": ["clerk"],
                "verbs": ["persuade"],
                "skills": ["Persuade"],
                "roll_gate": gate,
                "status": "open",
            }],
            "scene_edges": [],
        }],
    })
    _write_json(campaign / "scenario" / "npc-agendas.json", {"npcs": []})
    _write_json(campaign / "scenario" / "clue-graph.json", {"conclusions": []})
    _write_json(campaign / "save" / "world-state.json", {
        "campaign_id": "advisory-test",
        "active_scene_id": "archive",
        "discovered_clue_ids": [],
        "route_completion_receipts": [],
        "unlocked_scene_ids": ["archive"],
    })
    character = tmp_path / "character.json"
    _write_json(character, {
        "id": "investigator",
        "name": "Investigator",
        "skills": {"Persuade": 40, "Psychology": 70},
        "characteristics": {},
        "weapons": [],
    })
    return campaign, character


def _model_proposal(
    request: dict,
    *,
    decision: str,
    skill: str | None,
    overridden: list[str],
) -> dict:
    return {
        "schema_version": 1,
        "source": "model",
        "resolution_mode": "authored",
        "scene_action": "CHARACTER",
        "player_goal": "gain archive access",
        "fictional_method": "read the clerk and make a personally tailored appeal",
        "rule_ruling": {
            "decision": decision,
            "operation_kind": "skill_check" if decision == "roll" else None,
            "skill": skill,
            "difficulty": "hard" if decision == "roll" else None,
            "bonus_penalty_dice": 0,
            "accepted_advice_ids": [],
            "overridden_advice_ids": overridden,
            "reason": "Psychology resolves whether the tailored appeal finds leverage.",
        },
        "npc_ruling": {
            "npc_id": None,
            "tactic": "none",
            "fact_id": None,
            "reason": "No authored NPC cognition capability is required.",
        },
        "narration_plan": {
            "beat": "character",
            "tone": ["guarded"],
            "sensory_focus": [],
            "end_with": "consequence",
            "objective": "Resolve the clerk interaction from the chosen method.",
        },
        "rationale": "The Keeper deliberately overrides the suggested approach.",
    }


def test_keeper_may_override_authored_skill_advice_without_bypassing_roll_kernel(
    tmp_path,
):
    campaign, character = _campaign(tmp_path)

    def evaluator(request):
        advice_id = "route:gain-access:authored-roll-gate"
        return {
            "matched_affordance_ids": ["gain-access"],
            "matched_destination_scene_id": None,
            "normalized_target_entities": ["clerk"],
            "normalized_action_atoms": [{
                "id": "read-clerk",
                "verb": "read-and-tailor-appeal",
                "target": "clerk",
                "requires_roll": True,
                "skill": "Psychology",
                "reason": "find the clerk's leverage",
                "stakes": "archive access",
            }],
            "push_request": None,
            "primary_intent": "social",
            "confidence": 0.96,
            "reason": "The action advances the exact access route by another method.",
            "no_match": False,
            "keeper_proposal": _model_proposal(
                request, decision="roll", skill="Psychology",
                overridden=[advice_id],
            ),
        }

    rich, receipt = action_resolver.resolve_player_action(
        campaign,
        "I study what the clerk cares about and tailor my appeal to that leverage.",
        {"primary_intent": "social"},
        character_path=character,
        investigator_id="investigator",
        evaluator=evaluator,
    )

    assert receipt["status"] == "resolved"
    assert receipt["keeper_proposal"]["source"] == "model"
    assert receipt["keeper_proposal"]["rule_ruling"] == {
        "decision": "roll",
        "operation_kind": "skill_check",
        "skill": "Psychology",
        "difficulty": "hard",
        "bonus_penalty_dice": 0,
        "accepted_advice_ids": [],
        "overridden_advice_ids": [
            "route:gain-access:authored-roll-gate",
        ],
        "reason": "Psychology resolves whether the tailored appeal finds leverage.",
        "normalizations": [],
    }
    assert rich["action_atoms"][0]["skill"] == "Psychology"
    assert rich["action_atoms"][0]["difficulty"] == "hard"
    assert rich["action_atoms"][0]["route_id"] == "gain-access"


def test_keeper_may_waive_authored_roll_advice_with_an_explicit_ruling(tmp_path):
    campaign, character = _campaign(tmp_path)

    def evaluator(request):
        advice_id = "route:gain-access:authored-roll-gate"
        proposal = _model_proposal(
            request, decision="no_roll", skill=None, overridden=[advice_id],
        )
        proposal["rule_ruling"]["reason"] = (
            "The clerk already owes the investigator access; there is no uncertainty."
        )
        return {
            "matched_affordance_ids": ["gain-access"],
            "matched_destination_scene_id": None,
            "normalized_target_entities": ["clerk"],
            "normalized_action_atoms": [],
            "push_request": None,
            "primary_intent": "social",
            "confidence": 0.98,
            "reason": "The action advances the access route without uncertainty.",
            "no_match": False,
            "keeper_proposal": proposal,
        }

    rich, receipt = action_resolver.resolve_player_action(
        campaign,
        "I show the clerk the signed authorization they already accepted.",
        {"primary_intent": "social"},
        character_path=character,
        investigator_id="investigator",
        evaluator=evaluator,
    )

    assert receipt["status"] == "resolved"
    assert receipt["keeper_proposal"]["rule_ruling"]["decision"] == "no_roll"
    assert rich.get("action_atoms", []) == []
