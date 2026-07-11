"""Regression tests for epistemic policy/reducer edge cases found in review."""
import importlib.util
import json
from pathlib import Path


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, rel)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


policy = _load(
    "coc_epistemic_policy_edge_cases",
    "plugins/coc-keeper/scripts/coc_epistemic_policy.py",
)
beliefs = _load(
    "coc_belief_state_edge_cases",
    "plugins/coc-keeper/scripts/coc_belief_state.py",
)
apply_mod = _load(
    "coc_director_apply_epistemic_edge_cases",
    "plugins/coc-keeper/scripts/coc_director_apply.py",
)


def _campaign(tmp_path: Path) -> Path:
    campaign = tmp_path / "campaign"
    (campaign / "save").mkdir(parents=True)
    (campaign / "logs").mkdir(parents=True)
    return campaign


def _hypothesis(hypothesis_id, kind, *, status="active"):
    return {
        "hypothesis_id": hypothesis_id,
        "owner": "party",
        "question_id": "q-motive",
        "hypothesis_kind": kind,
        "claim": kind,
        "confidence": 0.7,
        "status": status,
        "supporting_clue_ids": [],
        "challenging_clue_ids": [],
        "recent_treatments": [],
        "created_turn": 1,
        "updated_turn": 1,
    }


def _write_state(campaign: Path, hypotheses):
    (campaign / "save" / "belief-state.json").write_text(json.dumps({
        "schema_version": 1,
        "hypotheses": hypotheses,
        "active_question_ids": ["q-motive"],
        "answered_question_ids": [],
    }), encoding="utf-8")


def _plan(contract, *, decision_id="turn-1", candidate=None, turn_number=1):
    rich = {"primary_intent": "investigate"}
    if candidate is not None:
        rich["player_hypothesis"] = candidate
    return {
        "decision_id": decision_id,
        "turn_input": {
            "turn_number": turn_number,
            "player_intent_rich": rich,
        },
        "epistemic_contract": contract,
    }


def test_policy_prefers_active_question_when_one_clue_has_multiple_links():
    ctx = {
        "epistemic_graph": {
            "questions": [
                {
                    "question_id": "q-fact",
                    "layer": "fact",
                    "player_facing_question": "Were records altered?",
                    "truth_ref": "truth-altered",
                },
                {
                    "question_id": "q-motive",
                    "layer": "motive",
                    "player_facing_question": "Why were they altered?",
                    "truth_ref": "truth-motive",
                },
            ],
            "evidence_links": [
                {
                    "clue_id": "clue-ledger",
                    "question_id": "q-fact",
                    "effect": "confirm",
                    "strength": 0.95,
                },
                {
                    "clue_id": "clue-ledger",
                    "question_id": "q-motive",
                    "effect": "complicate",
                    "strength": 0.6,
                },
            ],
        },
        "reveal_contracts": {"contracts": []},
        "belief_state": {
            "hypotheses": [_hypothesis("hyp-000001", "personal-coverup")],
            "active_question_ids": ["q-motive"],
            "answered_question_ids": [],
        },
        "world_state": {"discovered_clue_ids": []},
    }

    contract = policy.plan_epistemic_contract(
        ctx,
        {"reveal": ["clue-ledger"]},
        "REVEAL",
    )

    assert contract["target_question_id"] == "q-motive"
    assert contract["mode"] == "COMPLICATE"


def test_repeated_confirmations_remain_visible_in_treatment_history(tmp_path):
    campaign = _campaign(tmp_path)
    _write_state(campaign, [_hypothesis("hyp-000001", "records-altered")])

    for turn, clue_id in ((2, "clue-a"), (3, "clue-b")):
        contract = {
            "schema_version": 1,
            "mode": "CONFIRM",
            "target_question_id": "q-motive",
            "belief_refs": ["hyp-000001"],
            "deliver_clue_ids": [clue_id],
        }
        beliefs.apply_belief_turn(
            campaign,
            _plan(contract, decision_id=f"turn-{turn}", turn_number=turn),
            [clue_id],
            "inv1",
            f"2026-07-11T00:0{turn}:00Z",
        )

    record = beliefs.read_belief_state(campaign)["hypotheses"][0]
    assert record["recent_treatments"] == ["confirm", "confirm"]


def test_same_turn_new_hypothesis_receives_treatment_even_with_stale_refs(tmp_path):
    campaign = _campaign(tmp_path)
    _write_state(campaign, [_hypothesis("hyp-000001", "old-model")])
    candidate = {
        "claim": "The archivist protects someone.",
        "question_id": "q-motive",
        "hypothesis_kind": "protects-survivor",
        "confidence": 0.75,
    }
    contract = {
        "schema_version": 1,
        "mode": "CONFIRM",
        "target_question_id": "q-motive",
        "belief_refs": ["hyp-000001"],
        "deliver_clue_ids": ["clue-survivor"],
    }

    beliefs.apply_belief_turn(
        campaign,
        _plan(contract, candidate=candidate, decision_id="turn-2", turn_number=2),
        ["clue-survivor"],
        "inv1",
        "2026-07-11T00:02:00Z",
    )

    state = beliefs.read_belief_state(campaign)
    by_kind = {record["hypothesis_kind"]: record for record in state["hypotheses"]}
    assert by_kind["protects-survivor"]["recent_treatments"] == ["confirm"]
    assert by_kind["protects-survivor"]["supporting_clue_ids"] == ["clue-survivor"]


def test_reframe_changes_only_explicit_revision_targets(tmp_path):
    campaign = _campaign(tmp_path)
    _write_state(campaign, [
        _hypothesis("hyp-000001", "cultist-model"),
        _hypothesis("hyp-000002", "coerced-witness-model"),
    ])
    contract = {
        "schema_version": 1,
        "mode": "REFRAME",
        "target_question_id": "q-motive",
        "belief_refs": ["hyp-000001", "hyp-000002"],
        "revise_hypothesis_refs": ["hyp-000001"],
        "deliver_clue_ids": ["clue-survivor"],
        "preserve_fact_refs": ["truth-records-altered"],
    }

    beliefs.apply_belief_turn(
        campaign,
        _plan(contract, decision_id="turn-2", turn_number=2),
        ["clue-survivor"],
        "inv1",
        "2026-07-11T00:02:00Z",
    )

    state = beliefs.read_belief_state(campaign)
    by_id = {record["hypothesis_id"]: record for record in state["hypotheses"]}
    assert by_id["hyp-000001"]["status"] == "reframed"
    assert by_id["hyp-000001"]["challenging_clue_ids"] == ["clue-survivor"]
    assert by_id["hyp-000002"]["status"] == "active"
    assert by_id["hyp-000002"]["challenging_clue_ids"] == []


def test_complicate_sets_explicit_complicated_status(tmp_path):
    campaign = _campaign(tmp_path)
    _write_state(campaign, [_hypothesis("hyp-000001", "personal-coverup", status="confirmed")])
    contract = {
        "schema_version": 1,
        "mode": "COMPLICATE",
        "target_question_id": "q-motive",
        "belief_refs": ["hyp-000001"],
        "deliver_clue_ids": ["clue-preserved-name"],
    }

    beliefs.apply_belief_turn(
        campaign,
        _plan(contract, decision_id="turn-2", turn_number=2),
        ["clue-preserved-name"],
        "inv1",
        "2026-07-11T00:02:00Z",
    )

    record = beliefs.read_belief_state(campaign)["hypotheses"][0]
    assert record["status"] == "complicated"


def test_failed_clue_backfill_holds_narrator_epistemic_update():
    roll_contract = {
        "schema_version": 1,
        "goal": "surface clue",
        "success_effect": "commit clue",
        "failure_effect": "withhold clue with cost",
        "failure_outcome_mode": "clue_with_cost",
        "roll_density_group": "clue:clue-current",
        "must_not": [],
    }
    planned = {
        "decision_id": "turn-2",
        "scene_action": "REVEAL",
        "clue_policy": {
            "reveal": ["clue-current"],
            "clue_type": "obscured",
            "skill": "Library Use",
        },
        "epistemic_contract": {
            "schema_version": 1,
            "mode": "COMPLICATE",
            "target_question_id": "q-motive",
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
        "narrative_directives": {"must_include": ["the exact clue"]},
    }
    failed = [{
        "kind": "skill_check",
        "skill": "Library Use",
        "success": False,
        "outcome": "failure",
        "roll_contract": roll_contract,
    }]

    resolved = apply_mod.backfill_rule_results(planned, failed)

    assert resolved["planned_epistemic_contract"]["mode"] == "COMPLICATE"
    assert resolved["epistemic_contract"]["mode"] == "HOLD"
    assert resolved["epistemic_contract"]["hold_reason"] == "supporting_clue_not_committed"
    assert resolved["narrative_directives"]["belief_update_contract"]["mode"] == "HOLD"
