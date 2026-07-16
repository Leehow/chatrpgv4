"""TDD coverage for cognitive storylets, narration projection, and metrics."""
import importlib.util
import json
import sys
from pathlib import Path

import pytest


SCRIPTS = Path("plugins/coc-keeper/scripts").resolve()
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, rel)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_storylets = _load(
    "coc_storylets_cognitive_tests",
    "plugins/coc-keeper/scripts/coc_storylets.py",
)
coc_epistemic_narration = _load(
    "coc_epistemic_narration_tests",
    "plugins/coc-keeper/scripts/coc_epistemic_narration.py",
)
coc_epistemic_metrics = _load(
    "coc_epistemic_metrics_tests",
    "plugins/coc-keeper/scripts/coc_epistemic_metrics.py",
)


def _write_library(path: Path, storylet: dict):
    path.write_text(json.dumps({"schema_version": 1, "storylets": [storylet]}), encoding="utf-8")


def _base_storylet():
    return {
        "storylet_id": "cognitive-card",
        "family_id": "cognitive",
        "trope_id": "belief-shift",
        "conflict_level": "low",
        "base_weight": 1.0,
        "serves": {"mainline": True},
        "requires": {},
    }


def test_storylet_library_accepts_valid_cognitive_tags(tmp_path):
    storylet = _base_storylet()
    storylet.update({
        "epistemic_functions": ["confirm", "complicate"],
        "question_layers": ["fact", "motive"],
        "requires_reveal_contract": False,
    })
    path = tmp_path / "library.json"
    _write_library(path, storylet)
    loaded = coc_storylets.load_storylet_library(path)
    assert loaded["storylets"][0]["epistemic_functions"] == ["confirm", "complicate"]


def test_storylet_library_rejects_unknown_cognitive_function(tmp_path):
    storylet = _base_storylet()
    storylet["epistemic_functions"] = ["random_twist"]
    path = tmp_path / "library.json"
    _write_library(path, storylet)
    with pytest.raises(ValueError, match="epistemic_functions"):
        coc_storylets.load_storylet_library(path)


def test_storylet_library_rejects_reframe_without_contract_gate(tmp_path):
    storylet = _base_storylet()
    storylet["epistemic_functions"] = ["reframe"]
    storylet["question_layers"] = ["motive"]
    path = tmp_path / "library.json"
    _write_library(path, storylet)
    with pytest.raises(ValueError, match="requires_reveal_contract"):
        coc_storylets.load_storylet_library(path)


def test_legacy_storylet_without_cognitive_tags_still_loads(tmp_path):
    path = tmp_path / "library.json"
    _write_library(path, _base_storylet())
    assert coc_storylets.load_storylet_library(path)["storylets"]


def _plan(mode: str, layer: str = "motive", **extra):
    effect = {
        "effect_id": f"effect-{mode.lower()}",
        "mode": mode,
        "target_question_id": f"q-{layer}",
        "target_layer": layer,
        "deliver_clue_ids": ["clue-a"],
        **extra,
    }
    return {
        "scene_action": "REVEAL",
        "epistemic_contract": {
            "schema_version": 2,
            **effect,
            "effects": [effect],
        },
        "clue_policy": {"reveal": ["clue-a"]},
        "narrative_directives": {"horror_escalation_stage": "wrongness"},
        "rule_signals": {},
    }


def test_confirm_contract_requests_belief_confirmation():
    need = coc_storylets.infer_story_need(_plan("CONFIRM", "fact"), {})
    assert need["need_id"] == "belief_confirmation"
    assert need["epistemic_modes"] == ["confirm"]
    assert need["question_layers"] == ["fact"]


def test_complicate_contract_requests_belief_complication():
    need = coc_storylets.infer_story_need(_plan("COMPLICATE"), {})
    assert need["need_id"] == "belief_complication"


def test_hold_contract_falls_back_to_generic_need():
    plan = _plan("HOLD")
    plan["epistemic_contract"]["planned_mode"] = "REFRAME"
    need = coc_storylets.infer_story_need(plan, {"active_scene": {"available_clues": ["clue-a"]}})
    assert need["need_id"] == "clue_delivery"


def _storylet_ctx():
    return {
        "storylet_policy": {
            "allow_unanchored_storylets": True,
            "lower_conflict_window": 1,
        },
        "active_scene": {"scene_type": "investigation", "available_clues": ["clue-a"]},
        "world_state": {"discovered_clue_ids": []},
        "structure_type": "branching_investigation",
        "module_meta": {},
    }


def test_reframe_storylet_requires_ready_reveal_contract():
    storylet = _base_storylet()
    storylet.update({
        "epistemic_functions": ["reframe"],
        "question_layers": ["motive"],
        "requires_reveal_contract": True,
    })
    held = _plan("HOLD")
    assert coc_storylets._matches_context(storylet, held, _storylet_ctx(), "low") is False
    ready = _plan("REFRAME", reveal_contract_id="rc-motive")
    assert coc_storylets._matches_context(storylet, ready, _storylet_ctx(), "low") is True


def test_question_layer_filters_incompatible_storylet():
    storylet = _base_storylet()
    storylet.update({
        "epistemic_functions": ["confirm"],
        "question_layers": ["world"],
    })
    assert coc_storylets._matches_context(storylet, _plan("CONFIRM", "fact"), _storylet_ctx(), "low") is False


def _graph():
    return {
        "questions": [
            {"question_id": "q-fact", "layer": "fact", "player_facing_question": "Were the records altered?", "truth_ref": "keeper-truth-fact"},
            {"question_id": "q-motive", "layer": "motive", "player_facing_question": "Why were they altered?", "truth_ref": "keeper-truth-motive"},
            {"question_id": "q-structure", "layer": "structure", "player_facing_question": "Who benefits?", "truth_ref": "keeper-truth-structure"},
        ]
    }


def test_confirm_projection_exposes_player_safe_question_not_truth():
    projection = coc_epistemic_narration.build_belief_update_projection(
        _plan("CONFIRM", "fact")["epistemic_contract"],
        _graph(),
    )
    serialized = json.dumps(projection, ensure_ascii=False)
    assert projection["newly_supported"] == [{
        "question_id": "q-fact",
        "label": "Were the records altered?",
    }]
    assert "keeper-truth" not in serialized
    assert "truth_ref" not in serialized


def test_complicate_projection_marks_question_uncertain():
    projection = coc_epistemic_narration.build_belief_update_projection(
        _plan("COMPLICATE")["epistemic_contract"], _graph()
    )
    assert projection["newly_uncertain"][0]["question_id"] == "q-motive"


def test_reframe_projection_preserves_old_facts_and_opens_question():
    contract = _plan(
        "REFRAME",
        preserve_fact_refs=["truth-records-altered"],
        open_question_ids=["q-structure"],
        explanation_targets=["why-one-name"],
        reveal_contract_id="rc-motive",
    )["epistemic_contract"]
    projection = coc_epistemic_narration.build_belief_update_projection(contract, _graph())
    assert projection["preserve_as_true"] == ["truth-records-altered"]
    assert projection["reframed"][0]["question_id"] == "q-motive"
    assert projection["new_questions"] == [{"question_id": "q-structure", "label": "Who benefits?"}]


def test_hold_projection_forbids_planned_update():
    contract = _plan("HOLD")["epistemic_contract"]
    contract.update({
        "planned_mode": "REFRAME",
        "hold_reason": "supporting_clue_not_committed",
        "must_not": ["do not reveal the clue"],
    })
    projection = coc_epistemic_narration.build_belief_update_projection(contract, _graph())
    assert projection["mode"] == "HOLD"
    assert projection["planned_mode"] == "REFRAME"
    assert "do not narrate the planned belief update" in projection["must_not"]


def _belief_events():
    return [
        {"event_type": "question_opened", "question_id": "q-fact", "importance": "major"},
        {"event_type": "belief_confirmed", "question_id": "q-fact", "mode": "CONFIRM", "clue_ids": ["clue-a"]},
        {"event_type": "belief_confirmed", "question_id": "q-fact", "mode": "CONFIRM", "clue_ids": ["clue-b"]},
        {"event_type": "belief_complicated", "question_id": "q-motive", "mode": "COMPLICATE", "clue_ids": ["clue-c"]},
        {
            "event_type": "belief_reframed",
            "question_id": "q-motive",
            "mode": "REFRAME",
            "clue_ids": ["clue-d"],
            "setup_refs": ["clue-a", "clue-c"],
            "available_setup_refs": ["clue-a", "clue-c"],
            "explanation_targets": ["why-one-name", "why-basement"],
            "preserve_fact_refs": ["truth-records-altered"],
            "reveal_contract_id": "rc-motive",
        },
        {"event_type": "question_answered", "question_id": "q-fact"},
        {"event_type": "belief_hold", "question_id": "q-world", "mode": "HOLD"},
    ]


def test_metrics_compute_all_seven_axes():
    result = coc_epistemic_metrics.compute_epistemic_metrics(
        _belief_events(),
        belief_state={
            "active_question_ids": ["q-motive", "q-structure"],
            "answered_question_ids": ["q-fact"],
        },
        compile_confidence={
            "default_threshold": 0.8,
            "nodes": [{
                "node_type": "question",
                "node_id": "q-motive",
                "effective_confidence": 0.9,
                "review_state": "auto_accepted",
            }],
        },
        parse_manifest={"ranges": []},
    )
    expected = {
        "belief_gain",
        "curiosity_load",
        "explanation_compression",
        "reframe_fairness",
        "confirmation_saturation",
        "unexplained_surprise",
        "parse_risk_exposure",
        "epistemic_health",
    }
    assert expected.issubset(result)
    assert result["belief_gain"]["count"] == 4
    assert result["curiosity_load"]["active_count"] == 2
    assert result["explanation_compression"]["max_items_unified"] == 4
    assert result["reframe_fairness"]["minimum_ratio"] == 1.0
    assert result["confirmation_saturation"]["longest_run"] == 2
    assert result["unexplained_surprise"]["count"] == 0
    assert result["parse_risk_exposure"]["count"] == 0


def test_metrics_flag_unfair_unexplained_low_confidence_reframe():
    events = [{
        "event_type": "belief_reframed",
        "question_id": "q-motive",
        "mode": "REFRAME",
        "setup_refs": ["clue-a", "clue-b"],
        "available_setup_refs": ["clue-a"],
        "preserve_fact_refs": [],
        "reveal_contract_id": None,
        "compile_confidence": {"ready": False, "confidence": 0.4, "threshold": 0.8},
    }]
    result = coc_epistemic_metrics.compute_epistemic_metrics(events)
    assert result["reframe_fairness"]["minimum_ratio"] == 0.5
    assert result["unexplained_surprise"]["count"] == 1
    assert result["parse_risk_exposure"]["count"] >= 1
    assert result["epistemic_health"]["score"] < 100
