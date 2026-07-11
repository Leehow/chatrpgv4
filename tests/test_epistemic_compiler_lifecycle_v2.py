"""TDD coverage for epistemic compiler, confidence, multi-effect, and lifecycle v2."""
import importlib.util
import json
import sys
from pathlib import Path


SCRIPTS = Path("plugins/coc-keeper/scripts").resolve()
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, rel)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_epistemic_compile = _load(
    "coc_epistemic_compile_v2_tests",
    "plugins/coc-keeper/scripts/coc_epistemic_compile.py",
)
coc_compile_confidence = _load(
    "coc_compile_confidence_tests",
    "plugins/coc-keeper/scripts/coc_compile_confidence.py",
)
coc_epistemic_lifecycle = _load(
    "coc_epistemic_lifecycle_tests",
    "plugins/coc-keeper/scripts/coc_epistemic_lifecycle.py",
)
coc_epistemic_policy = _load(
    "coc_epistemic_policy_v2_tests",
    "plugins/coc-keeper/scripts/coc_epistemic_policy.py",
)
coc_epistemic_resolve = _load(
    "coc_epistemic_resolve_v2_tests",
    "plugins/coc-keeper/scripts/coc_epistemic_resolve.py",
)
coc_belief_state = _load(
    "coc_belief_state_v2_tests",
    "plugins/coc-keeper/scripts/coc_belief_state.py",
)
coc_scenario_compile = _load(
    "coc_scenario_compile_lifecycle_tests",
    "plugins/coc-keeper/scripts/coc_scenario_compile.py",
)


def _write_json(path: Path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def _valid_scenario(root: Path) -> Path:
    scenario = root / "scenario"
    scenario.mkdir(parents=True)
    _write_json(scenario / "module-meta.json", {
        "schema_version": 1,
        "scenario_id": "case-x",
        "structure_type": "branching_investigation",
        "era": "1920s",
        "content_flags": [],
        "win_condition": "resolve the case",
        "module_identity": {
            "canonical_module_id": "case-x",
            "canonical_title": "Case X",
            "rules_edition": "7e",
        },
    })
    _write_json(scenario / "story-graph.json", {"scenes": [
        {
            "scene_id": "start",
            "is_start": True,
            "scene_type": "investigation",
            "dramatic_question": "What happened?",
            "entry_conditions": [],
            "exit_conditions": [],
            "available_clues": ["clue-a", "clue-b", "clue-c"],
            "npc_ids": [],
            "pressure_moves": [],
            "tone": ["uneasy"],
            "allowed_improvisation": [],
            "scene_edges": [{"to": "finale", "when": {"kind": "always"}, "kind": "route"}],
            "origin": "source",
        },
        {
            "scene_id": "finale",
            "is_final": True,
            "scene_type": "resolution",
            "dramatic_question": "Can it be stopped?",
            "entry_conditions": [],
            "exit_conditions": [],
            "available_clues": [],
            "npc_ids": [],
            "pressure_moves": [],
            "tone": ["bleak"],
            "allowed_improvisation": [],
            "scene_edges": [],
            "origin": "source",
        },
    ]})
    _write_json(scenario / "clue-graph.json", {"conclusions": [{
        "conclusion_id": "conclusion-x",
        "importance": "critical",
        "minimum_routes": 3,
        "fallback_policy": "RECOVER can surface another route",
        "origin": "source",
        "clues": [
            {"clue_id": "clue-a", "delivery_kind": "obvious", "visibility": "player-safe", "player_safe_summary": "An altered date.", "leads_to": ["finale"], "origin": "source"},
            {"clue_id": "clue-b", "delivery_kind": "handout", "visibility": "player-safe", "player_safe_summary": "A preserved name.", "leads_to": ["finale"], "origin": "source"},
            {"clue_id": "clue-c", "delivery_kind": "environmental", "visibility": "player-safe", "player_safe_summary": "A sealed room.", "leads_to": ["finale"], "origin": "source"},
        ],
    }]})
    _write_json(scenario / "npc-agendas.json", {"npcs": []})
    _write_json(scenario / "threat-fronts.json", {"fronts": []})
    _write_json(scenario / "pacing-map.json", {"pacing_curve": []})
    _write_json(scenario / "improvisation-boundaries.json", {
        "invent_allowed": [],
        "never_invent": [],
        "keeper_secrets": [{
            "id": "secret-x",
            "category": "cult",
            "description": "RAW KEEPER PROSE MUST NOT LEAK",
        }],
    })
    return scenario


def _sidecars():
    graph = {
        "schema_version": 2,
        "questions": [
            {
                "question_id": "q-fact",
                "layer": "fact",
                "player_facing_question": "Were the records altered?",
                "truth_ref": "truth-altered",
                "importance": "major",
                "opens_questions": ["q-motive"],
                "closes_when": {"kind": "clue_any", "clue_ids": ["clue-a"]},
            },
            {
                "question_id": "q-motive",
                "layer": "motive",
                "player_facing_question": "Why were they altered?",
                "truth_ref": "truth-protection",
                "importance": "critical",
                "opens_questions": ["q-structure"],
                "closes_when": {"kind": "evidence_count", "clue_ids": ["clue-a", "clue-b", "clue-c"], "count": 2},
            },
            {
                "question_id": "q-structure",
                "layer": "structure",
                "player_facing_question": "Who benefits?",
                "truth_ref": "truth-program",
                "importance": "major",
                "closes_when": {"kind": "payoff"},
            },
        ],
        "evidence_links": [
            {"clue_id": "clue-a", "question_id": "q-fact", "effect": "confirm", "strength": 0.8},
            {"clue_id": "clue-a", "question_id": "q-motive", "effect": "complicate", "strength": 0.9},
            {"clue_id": "clue-b", "question_id": "q-motive", "effect": "reframe", "strength": 0.95},
        ],
    }
    contracts = {
        "schema_version": 2,
        "contracts": [{
            "reveal_contract_id": "rc-motive",
            "mode": "reframe",
            "target_question_id": "q-motive",
            "trigger_clue_ids": ["clue-b"],
            "preserve_as_true": ["truth-records-altered"],
            "revise_hypothesis_kinds": ["archivist-cultist"],
            "setup_refs": ["clue-a", "clue-c"],
            "opens_questions": ["q-structure"],
            "explanation_targets": ["why-preserve-name"],
            "must_not": ["do not invalidate old facts"],
        }],
    }
    confidence = {
        "schema_version": 1,
        "default_threshold": 0.8,
        "nodes": [
            {"node_type": "question", "node_id": "q-motive", "semantic_confidence": 0.92, "source_confidence": 0.88, "review_state": "auto_accepted"},
            {"node_type": "reveal_contract", "node_id": "rc-motive", "semantic_confidence": 0.90, "source_confidence": 0.86, "review_state": "auto_accepted"},
        ],
    }
    return graph, contracts, confidence


def test_compile_request_excludes_keeper_and_raw_evidence_prose(tmp_path):
    scenario = _valid_scenario(tmp_path)
    request = coc_epistemic_compile.build_compile_request(
        scenario,
        source_bundle={
            "evidence_segments": [{"segment_id": "seg", "text": "RAW EVIDENCE TEXT"}],
            "parse_manifest": {"ranges": []},
            "page_map": {"sources": []},
        },
    )
    serialized = json.dumps(request, ensure_ascii=False)
    assert "RAW KEEPER PROSE" not in serialized
    assert "RAW EVIDENCE TEXT" not in serialized
    assert "secret-x" in serialized
    assert request["kind"] == "coc_epistemic_compile_request"


def test_compile_request_sha_is_stable_across_key_order():
    left = {"b": 2, "a": {"y": 2, "x": 1}}
    right = {"a": {"x": 1, "y": 2}, "b": 2}
    assert coc_epistemic_compile.request_sha256(left) == coc_epistemic_compile.request_sha256(right)


def test_compile_result_rejects_stale_request_sha(tmp_path):
    scenario = _valid_scenario(tmp_path)
    request = coc_epistemic_compile.build_compile_request(scenario)
    graph, contracts, confidence = _sidecars()
    result = {
        "schema_version": 1,
        "evaluator_id": "codex-epistemic-compiler-v1",
        "evaluation_provenance": {
            "kind": "llm",
            "request_sha256": "stale",
            "reviewed_artifact": "epistemic-compile-request.json",
        },
        "epistemic_graph": graph,
        "reveal_contracts": contracts,
        "compile_confidence": confidence,
        "reasons": {"q-motive": "source-backed motive question", "rc-motive": "fair reframe"},
    }
    errors = coc_epistemic_compile.validate_compile_result(request, result)
    assert any("request_sha256" in error for error in errors)


def test_install_compile_result_writes_all_three_sidecars(tmp_path):
    scenario = _valid_scenario(tmp_path)
    request = coc_epistemic_compile.build_compile_request(scenario)
    graph, contracts, confidence = _sidecars()
    result = {
        "schema_version": 1,
        "evaluator_id": "codex-epistemic-compiler-v1",
        "evaluation_provenance": {
            "kind": "llm",
            "request_sha256": coc_epistemic_compile.request_sha256(request),
            "reviewed_artifact": "epistemic-compile-request.json",
        },
        "epistemic_graph": graph,
        "reveal_contracts": contracts,
        "compile_confidence": confidence,
        "reasons": {"q-motive": "source-backed motive question", "rc-motive": "fair reframe"},
    }
    installed = coc_epistemic_compile.install_compile_result(scenario, request, result)
    assert installed["installed"] is True
    assert json.loads((scenario / "epistemic-graph.json").read_text())["questions"]
    assert json.loads((scenario / "reveal-contracts.json").read_text())["contracts"]
    assert json.loads((scenario / "compile-confidence.json").read_text())["nodes"]


def test_scan_scenarios_finds_missing_and_partial_sidecars(tmp_path):
    complete = _valid_scenario(tmp_path / "complete")
    graph, contracts, confidence = _sidecars()
    _write_json(complete / "epistemic-graph.json", graph)
    _write_json(complete / "reveal-contracts.json", contracts)
    _write_json(complete / "compile-confidence.json", confidence)
    missing = _valid_scenario(tmp_path / "missing")
    partial = _valid_scenario(tmp_path / "partial")
    _write_json(partial / "epistemic-graph.json", graph)
    found = coc_epistemic_compile.scan_scenarios(tmp_path)
    paths = {Path(item["scenario_dir"]).parent.name: item["status"] for item in found}
    assert "complete" not in paths
    assert paths["missing"] == "missing"
    assert paths["partial"] == "partial"


def test_effective_confidence_is_minimum_and_review_gated():
    record = {
        "semantic_confidence": 0.91,
        "source_confidence": 0.82,
        "review_state": "auto_accepted",
    }
    assert coc_compile_confidence.effective_confidence(record) == 0.82
    assert coc_compile_confidence.node_ready(
        {"default_threshold": 0.8, "nodes": [{"node_type": "question", "node_id": "q", **record}]},
        "question",
        "q",
    )["ready"] is True
    record["review_state"] = "needs_review"
    assert coc_compile_confidence.node_ready(
        {"default_threshold": 0.8, "nodes": [{"node_type": "question", "node_id": "q", **record}]},
        "question",
        "q",
    )["ready"] is False


def _multi_effect_ctx():
    graph, contracts, confidence = _sidecars()
    return {
        "epistemic_graph": graph,
        "reveal_contracts": contracts,
        "compile_confidence": confidence,
        "belief_state": {
            "active_question_ids": ["q-motive"],
            "hypotheses": [{
                "hypothesis_id": "hyp-1",
                "question_id": "q-motive",
                "hypothesis_kind": "archivist-cultist",
                "claim": "The archivist is a cultist",
                "status": "active",
            }],
        },
        "world_state": {"discovered_clue_ids": []},
    }


def test_one_clue_can_confirm_fact_and_complicate_motive():
    contract = coc_epistemic_policy.plan_epistemic_contract(
        _multi_effect_ctx(), {"reveal": ["clue-a"]}, "REVEAL"
    )
    assert contract["schema_version"] == 2
    assert contract["mode"] == "COMPLICATE"
    assert [effect["mode"] for effect in contract["effects"]] == ["COMPLICATE", "CONFIRM"]
    assert len({effect["effect_id"] for effect in contract["effects"]}) == 2


def test_unready_reframe_does_not_suppress_ready_confirm():
    ctx = _multi_effect_ctx()
    ctx["epistemic_graph"]["evidence_links"].append(
        {"clue_id": "clue-b", "question_id": "q-fact", "effect": "confirm", "strength": 0.6}
    )
    contract = coc_epistemic_policy.plan_epistemic_contract(
        ctx, {"reveal": ["clue-b"]}, "REVEAL"
    )
    modes = [effect["mode"] for effect in contract["effects"]]
    assert "HOLD" in modes
    assert "CONFIRM" in modes
    assert contract["mode"] == "CONFIRM"


def test_resolver_holds_every_effect_when_clue_not_committed():
    planned = coc_epistemic_policy.plan_epistemic_contract(
        _multi_effect_ctx(), {"reveal": ["clue-a"]}, "REVEAL"
    )
    resolved = coc_epistemic_resolve.resolve_epistemic_contract(planned, [])
    assert all(effect["mode"] == "HOLD" for effect in resolved["effects"])
    assert resolved["mode"] == "HOLD"


def test_belief_reducer_applies_effect_ids_only_once(tmp_path):
    campaign = tmp_path / "campaign"
    (campaign / "save").mkdir(parents=True)
    plan = {
        "decision_id": "decision-1",
        "turn_input": {"turn_number": 1, "player_intent_rich": {
            "belief_candidate": {
                "claim": "The archivist is a cultist",
                "question_id": "q-motive",
                "hypothesis_kind": "archivist-cultist",
                "confidence": 0.8,
            }
        }},
        "epistemic_contract": {
            "schema_version": 2,
            "mode": "COMPLICATE",
            "target_question_id": "q-motive",
            "effects": [
                {"effect_id": "e1", "mode": "COMPLICATE", "target_question_id": "q-motive", "deliver_clue_ids": ["clue-a"]},
                {"effect_id": "e2", "mode": "CONFIRM", "target_question_id": "q-fact", "deliver_clue_ids": ["clue-a"]},
            ],
        },
    }
    first = coc_belief_state.apply_belief_turn(campaign, plan, ["clue-a"], "inv", "now")
    second = coc_belief_state.apply_belief_turn(campaign, plan, ["clue-a"], "inv", "later")
    assert len([event for event in first if event.get("event_type", "").startswith("belief_")]) == 2
    assert not [event for event in second if event.get("event_type", "").startswith("belief_")]
    state = coc_belief_state.read_belief_state(campaign)
    assert state["applied_effect_ids"] == ["e1", "e2"]


def test_question_lifecycle_clue_any_and_evidence_count():
    graph, _, _ = _sidecars()
    result = coc_epistemic_lifecycle.evaluate_question_transitions(
        graph,
        {"active_question_ids": ["q-fact", "q-motive"], "answered_question_ids": []},
        {"discovered_clue_ids": ["clue-a"]},
        ["clue-a"],
    )
    assert "q-fact" in result["answer_question_ids"]
    assert "q-motive" not in result["answer_question_ids"]
    result = coc_epistemic_lifecycle.evaluate_question_transitions(
        graph,
        {"active_question_ids": ["q-motive"], "answered_question_ids": ["q-fact"]},
        {"discovered_clue_ids": ["clue-a", "clue-b"]},
        ["clue-b"],
    )
    assert "q-motive" in result["answer_question_ids"]


def test_question_lifecycle_payoff_requires_resolved_effect():
    graph, _, _ = _sidecars()
    no_payoff = coc_epistemic_lifecycle.evaluate_question_transitions(
        graph,
        {"active_question_ids": ["q-structure"], "answered_question_ids": []},
        {"discovered_clue_ids": []},
        [],
        resolved_effects=[],
    )
    assert "q-structure" not in no_payoff["answer_question_ids"]
    payoff = coc_epistemic_lifecycle.evaluate_question_transitions(
        graph,
        {"active_question_ids": ["q-structure"], "answered_question_ids": []},
        {"discovered_clue_ids": []},
        [],
        resolved_effects=[{"mode": "PAYOFF", "target_question_id": "q-structure"}],
    )
    assert "q-structure" in payoff["answer_question_ids"]


def test_scenario_validator_rejects_unknown_question_closure():
    compiled = {
        "story_graph": {"scenes": [
            {"scene_id": "start", "is_start": True, "dramatic_question": "?", "available_clues": ["clue-a"], "npc_ids": [], "exit_targets": ["final"], "origin": "source"},
            {"scene_id": "final", "is_final": True, "scene_type": "resolution", "dramatic_question": "!", "available_clues": [], "npc_ids": [], "origin": "source"},
        ]},
        "clue_graph": {"conclusions": [{"conclusion_id": "c", "minimum_routes": 1, "origin": "source", "clues": [{"clue_id": "clue-a", "delivery_kind": "obvious", "leads_to": ["final"], "origin": "source"}]}]},
        "npc_agendas": {"npcs": []},
        "threat_fronts": {"fronts": []},
        "epistemic_graph": {"questions": [{
            "question_id": "q", "layer": "fact", "player_facing_question": "What?", "truth_ref": "truth", "closes_when": {"kind": "magic"}
        }], "evidence_links": [{"clue_id": "clue-a", "question_id": "q", "effect": "confirm"}]},
        "reveal_contracts": {"contracts": []},
    }
    findings = coc_scenario_compile.validate_compiled_scenario(compiled)
    assert any(f["code"] == "invalid_question_closure" for f in findings)
