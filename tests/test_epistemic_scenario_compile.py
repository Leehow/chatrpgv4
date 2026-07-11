"""Focused tests for optional epistemic scenario sidecars."""
import importlib.util


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, rel)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_scenario_compile = _load(
    "coc_scenario_compile_epistemic",
    "plugins/coc-keeper/scripts/coc_scenario_compile.py",
)


def _compiled():
    return {
        "story_graph": {
            "scenes": [
                {
                    "scene_id": "start",
                    "is_start": True,
                    "dramatic_question": "What happened?",
                    "available_clues": ["clue-a", "clue-b", "clue-c"],
                    "npc_ids": [],
                    "exit_targets": ["finale"],
                    "origin": "source",
                },
                {
                    "scene_id": "finale",
                    "is_final": True,
                    "scene_type": "resolution",
                    "dramatic_question": "Can it be stopped?",
                    "available_clues": [],
                    "npc_ids": [],
                    "origin": "source",
                },
            ]
        },
        "clue_graph": {
            "conclusions": [
                {
                    "conclusion_id": "concl-1",
                    "importance": "critical",
                    "minimum_routes": 3,
                    "origin": "source",
                    "fallback_policy": "RECOVER can surface another route",
                    "clues": [
                        {
                            "clue_id": "clue-a",
                            "delivery_kind": "obvious",
                            "visibility": "player-safe",
                            "leads_to": ["finale"],
                            "origin": "source",
                        },
                        {
                            "clue_id": "clue-b",
                            "delivery_kind": "handout",
                            "visibility": "player-safe",
                            "leads_to": ["finale"],
                            "origin": "source",
                        },
                        {
                            "clue_id": "clue-c",
                            "delivery_kind": "environmental",
                            "visibility": "player-safe",
                            "leads_to": ["finale"],
                            "origin": "source",
                        },
                    ],
                }
            ]
        },
        "npc_agendas": {"npcs": []},
        "threat_fronts": {"fronts": []},
    }


def _with_valid_sidecars(compiled):
    compiled["epistemic_graph"] = {
        "schema_version": 1,
        "questions": [
            {
                "question_id": "q-motive",
                "layer": "motive",
                "player_facing_question": "Why did the archivist alter the records?",
                "truth_ref": "truth-protects-survivor",
                "importance": "critical",
                "opens_questions": ["q-structure"],
                "source_refs": [{"path": "pdf/module.pdf", "page": 10}],
            },
            {
                "question_id": "q-structure",
                "layer": "structure",
                "player_facing_question": "Who benefits?",
                "truth_ref": "truth-selection-program",
                "importance": "major",
            },
        ],
        "evidence_links": [
            {
                "clue_id": "clue-a",
                "question_id": "q-motive",
                "effect": "reframe",
                "strength": 0.9,
            }
        ],
    }
    compiled["reveal_contracts"] = {
        "schema_version": 1,
        "contracts": [
            {
                "reveal_contract_id": "rc-motive",
                "mode": "reframe",
                "target_question_id": "q-motive",
                "trigger_clue_ids": ["clue-a"],
                "preserve_as_true": ["truth-archivist-lied"],
                "revise_hypothesis_kinds": ["archivist-is-cultist"],
                "setup_refs": ["clue-b", "clue-c"],
                "opens_questions": ["q-structure"],
                "explanation_targets": ["why-preserve-one-name"],
                "must_not": ["do not invalidate old facts"],
            }
        ],
    }
    return compiled


def _by_code(findings, code):
    return [finding for finding in findings if finding["code"] == code]


def test_valid_epistemic_sidecars_pass():
    findings = coc_scenario_compile.validate_compiled_scenario(
        _with_valid_sidecars(_compiled())
    )
    assert not [finding for finding in findings if finding["severity"] == "error"]


def test_broken_epistemic_clue_reference_errors():
    compiled = _with_valid_sidecars(_compiled())
    compiled["epistemic_graph"]["evidence_links"][0]["clue_id"] = "missing-clue"

    findings = coc_scenario_compile.validate_compiled_scenario(compiled)

    errors = _by_code(findings, "broken_epistemic_reference")
    assert errors
    assert any("missing-clue" in finding["message"] for finding in errors)


def test_invalid_question_layer_errors():
    compiled = _with_valid_sidecars(_compiled())
    compiled["epistemic_graph"]["questions"][0]["layer"] = "plot_twist"

    findings = coc_scenario_compile.validate_compiled_scenario(compiled)

    errors = _by_code(findings, "invalid_epistemic_layer")
    assert errors


def test_reframe_requires_two_setup_refs():
    compiled = _with_valid_sidecars(_compiled())
    compiled["reveal_contracts"]["contracts"][0]["setup_refs"] = ["clue-b"]

    findings = coc_scenario_compile.validate_compiled_scenario(compiled)

    errors = _by_code(findings, "invalid_reframe_contract")
    assert errors
    assert any("at least two setup_refs" in finding["message"] for finding in errors)


def test_reframe_requires_preserved_truth():
    compiled = _with_valid_sidecars(_compiled())
    compiled["reveal_contracts"]["contracts"][0]["preserve_as_true"] = []

    findings = coc_scenario_compile.validate_compiled_scenario(compiled)

    errors = _by_code(findings, "invalid_reframe_contract")
    assert errors
    assert any("preserve_as_true" in finding["message"] for finding in errors)


def test_legacy_compiled_scenario_without_sidecars_still_passes_epistemic_checks():
    findings = coc_scenario_compile.validate_compiled_scenario(_compiled())
    epistemic_codes = {
        "broken_epistemic_reference",
        "invalid_epistemic_layer",
        "invalid_epistemic_effect",
        "invalid_reframe_contract",
    }
    assert not [finding for finding in findings if finding["code"] in epistemic_codes]
