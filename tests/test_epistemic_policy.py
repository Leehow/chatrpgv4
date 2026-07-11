"""Tests for deterministic epistemic planning."""
import importlib.util


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, rel)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_epistemic_policy = _load(
    "coc_epistemic_policy",
    "plugins/coc-keeper/scripts/coc_epistemic_policy.py",
)


def _ctx(*, effect="confirm", discovered=None, beliefs=None, with_reframe=False):
    graph = {
        "schema_version": 1,
        "questions": [
            {
                "question_id": "q-motive",
                "layer": "motive",
                "player_facing_question": "Why did the archivist alter the records?",
                "truth_ref": "truth-protects-survivor",
                "importance": "critical",
                "opens_questions": ["q-structure"],
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
                "clue_id": "clue-current",
                "question_id": "q-motive",
                "effect": effect,
                "strength": 0.8,
            }
        ],
    }
    contracts = {"schema_version": 1, "contracts": []}
    if with_reframe:
        contracts["contracts"].append(
            {
                "reveal_contract_id": "rc-motive",
                "mode": "reframe",
                "target_question_id": "q-motive",
                "trigger_clue_ids": ["clue-current"],
                "preserve_as_true": ["truth-archivist-lied"],
                "revise_hypothesis_kinds": ["archivist-is-cultist"],
                "setup_refs": ["clue-setup-a", "clue-setup-b"],
                "opens_questions": ["q-structure"],
                "explanation_targets": ["why-preserve-one-name"],
                "must_not": ["do not invalidate old facts"],
            }
        )
    return {
        "epistemic_graph": graph,
        "reveal_contracts": contracts,
        "belief_state": {
            "schema_version": 1,
            "hypotheses": list(beliefs or []),
            "active_question_ids": [],
            "answered_question_ids": [],
        },
        "world_state": {"discovered_clue_ids": list(discovered or [])},
    }


def test_missing_sidecars_returns_none_contract():
    contract = coc_epistemic_policy.plan_epistemic_contract(
        {"world_state": {}, "belief_state": {}},
        {"reveal": ["clue-current"]},
        "REVEAL",
    )
    assert contract == {"schema_version": 1, "mode": "NONE"}


def test_confirm_link_builds_confirm_contract():
    contract = coc_epistemic_policy.plan_epistemic_contract(
        _ctx(effect="confirm"),
        {"reveal": ["clue-current"]},
        "REVEAL",
    )
    assert contract["mode"] == "CONFIRM"
    assert contract["target_question_id"] == "q-motive"
    assert contract["target_layer"] == "motive"
    assert contract["deliver_clue_ids"] == ["clue-current"]
    assert contract["open_question_ids"] == ["q-structure"]


def test_matching_question_attaches_active_belief_refs():
    beliefs = [
        {
            "hypothesis_id": "hyp-000001",
            "question_id": "q-motive",
            "status": "active",
        },
        {
            "hypothesis_id": "hyp-000002",
            "question_id": "q-structure",
            "status": "active",
        },
    ]
    contract = coc_epistemic_policy.plan_epistemic_contract(
        _ctx(effect="complicate", beliefs=beliefs),
        {"reveal": ["clue-current"]},
        "REVEAL",
    )
    assert contract["mode"] == "COMPLICATE"
    assert contract["belief_refs"] == ["hyp-000001"]


def test_reframe_without_setup_returns_hold():
    contract = coc_epistemic_policy.plan_epistemic_contract(
        _ctx(effect="reframe", discovered=["clue-setup-a"], with_reframe=True),
        {"reveal": ["clue-current"]},
        "REVEAL",
    )
    assert contract["mode"] == "HOLD"
    assert contract["hold_reason"] == "insufficient_setup"
    assert contract["missing_setup_refs"] == ["clue-setup-b"]
    assert contract["deliver_clue_ids"] == ["clue-current"]


def test_reframe_with_discovered_setup_returns_reframe():
    contract = coc_epistemic_policy.plan_epistemic_contract(
        _ctx(
            effect="reframe",
            discovered=["clue-setup-a", "clue-setup-b"],
            with_reframe=True,
        ),
        {"reveal": ["clue-current"]},
        "REVEAL",
    )
    assert contract["mode"] == "REFRAME"
    assert contract["preserve_fact_refs"] == ["truth-archivist-lied"]
    assert contract["setup_refs"] == ["clue-setup-a", "clue-setup-b"]
    assert contract["open_question_ids"] == ["q-structure"]
    assert contract["explanation_targets"] == ["why-preserve-one-name"]
    assert contract["must_not"] == ["do not invalidate old facts"]


def test_malformed_effect_degrades_to_none():
    contract = coc_epistemic_policy.plan_epistemic_contract(
        _ctx(effect="surprise"),
        {"reveal": ["clue-current"]},
        "REVEAL",
    )
    assert contract == {"schema_version": 1, "mode": "NONE"}
