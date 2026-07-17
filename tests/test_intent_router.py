#!/usr/bin/env python3
"""Tests for coc_intent_router: Semantic Matcher Constitution compliant.

The router no longer does keyword matching for intent classification — that
would violate the Constitution (docs/superpowers/specs/2026-07-03-coc-keeper-
design.md:541). Semantic judgments are delegated to an ``IntentEvaluator``
(Protocol). These tests inject a fixture evaluator (as the Constitution
permits) and verify:

  - the Protocol wiring (an injected evaluator's judgment is returned),
  - the machine-controlled carve-outs (empty → idle, '[' → meta) that do not
    depend on text meaning,
  - the LLM file-mediated path's compliance checks (missing result raises,
    provenance sha256 mismatch raises, schema violations raise).
"""
import importlib.util
import json
from pathlib import Path

import pytest


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, rel)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


router = _load("coc_intent_router", "plugins/coc-keeper/scripts/coc_intent_router.py")


@pytest.fixture(autouse=True)
def _clear_evaluator():
    """Ensure each test starts with the default evaluator (no leakage)."""
    router.set_intent_evaluator(None)
    yield
    router.set_intent_evaluator(None)


# ---------------------------------------------------------------------------
# Fixture evaluator (mirrors coc_playtest_suite's FixtureSemanticEvaluator)
# ---------------------------------------------------------------------------

class FixtureIntentEvaluator:
    """A deterministic stand-in for the LLM, recording what it was asked."""

    evaluator_id = router.LLM_INTENT_EVALUATOR_ID

    def __init__(self, result: dict | None = None) -> None:
        self.calls: list[tuple[str, dict | None]] = []
        self._result = result or {
            "primary_intent": "investigate",
            "secondary_intents": ["avoid_risk"],
            "target_entities": ["backyard"],
            "risk_posture": "cautious",
            "explicit_roll_request": False,
            "player_hypothesis": None,
            "action_atoms": [],
        }

    def classify(self, player_text: str, active_scene: dict | None) -> dict:
        self.calls.append((player_text, active_scene))
        return dict(self._result)


# ---------------------------------------------------------------------------
# Protocol wiring
# ---------------------------------------------------------------------------

def test_injected_evaluator_judgment_is_returned():
    """parse_intent delegates to the injected evaluator (Protocol wiring)."""
    fixture = FixtureIntentEvaluator(result={
        "primary_intent": "social",
        "secondary_intents": ["social_followup"],
        "target_entities": ["neighbor"],
        "risk_posture": "neutral",
        "explicit_roll_request": False,
        "player_hypothesis": "邻居可能知道些什么",
        "action_atoms": [],
    })
    router.set_intent_evaluator(fixture)

    r = router.parse_intent("我去问问邻居昨晚听到了什么")
    assert r["primary_intent"] == "social"
    assert "neighbor" in r["target_entities"]
    assert r["player_hypothesis"] == "邻居可能知道些什么"
    # The fixture received the raw text + scene.
    assert fixture.calls == [("我去问问邻居昨晚听到了什么", None)]


def test_active_scene_is_passed_to_evaluator():
    """The scene dict flows through to the evaluator for target anchoring."""
    fixture = FixtureIntentEvaluator()
    router.set_intent_evaluator(fixture)
    scene = {"available_clues": ["clue-1"], "npc_ids": ["npc-a"]}

    router.parse_intent("some text", active_scene=scene)
    assert fixture.calls[-1] == ("some text", scene)


# ---------------------------------------------------------------------------
# Machine-controlled carve-outs (allowed exact matches, no semantic judgment)
# ---------------------------------------------------------------------------

def test_empty_text_defaults_to_idle_without_evaluator():
    """Empty text is an enum-level machine signal; no evaluator is consulted."""
    fixture = FixtureIntentEvaluator()
    router.set_intent_evaluator(fixture)

    r = router.parse_intent("")
    assert r["primary_intent"] == "idle"
    assert r["secondary_intents"] == []
    assert r["risk_posture"] == "neutral"
    assert r["action_atoms"] == []
    # The fixture was NOT consulted for empty text.
    assert fixture.calls == []


def test_none_text_defaults_to_idle():
    r = router.parse_intent(None)
    assert r["primary_intent"] == "idle"


def test_whitespace_only_text_defaults_to_idle():
    fixture = FixtureIntentEvaluator()
    router.set_intent_evaluator(fixture)
    assert router.parse_intent("   \n  ")["primary_intent"] == "idle"
    assert fixture.calls == []


def test_leading_bracket_is_meta_machine_marker():
    """A leading '[' is the out-of-fiction command bracket — a system marker,
    not a natural-language judgment, so it is an allowed exact match."""
    fixture = FixtureIntentEvaluator()
    router.set_intent_evaluator(fixture)

    r = router.parse_intent("[meta] 这个检定用什么技能？")
    assert r["primary_intent"] == "meta"
    assert fixture.calls == []  # no semantic consultation needed


# ---------------------------------------------------------------------------
# LLM file-mediated path compliance (the default evaluator)
# ---------------------------------------------------------------------------

def _write_result(artifacts_dir: Path, request: dict, *, result_overrides: dict | None = None) -> dict:
    """Write a well-formed result for the given request and return it."""
    result = {
        "evaluator_id": router.LLM_INTENT_EVALUATOR_ID,
        "evaluation_provenance": {
            "kind": "llm",
            "request_sha256": router._json_sha256(request),
            "reviewed_artifact": router.INTENT_EVAL_REQUEST,
        },
        "primary_intent": "investigate",
        "secondary_intents": [],
        "target_entities": [],
        "risk_posture": "neutral",
        "explicit_roll_request": False,
        "player_hypothesis": None,
        "action_atoms": [],
        "reasons": {"primary_intent": "Player described a searching action."},
    }
    if result_overrides:
        result.update(result_overrides)
    (artifacts_dir / router.INTENT_EVAL_RESULT).write_text(
        json.dumps(result, ensure_ascii=False), encoding="utf-8"
    )
    return result


def test_llm_evaluator_writes_request_and_reads_result(tmp_path):
    """The default LLM path writes a request, reads the LLM's result."""
    evaluator = router.LLMIntentEvaluator(artifacts_dir=tmp_path)

    # Pre-place the result the external LLM would write. First, let the
    # evaluator build+write its request so we can hash it for provenance.
    request = evaluator._build_request("我检查门框", None)
    evaluator._write_request(request)
    _write_result(tmp_path, request)

    r = evaluator.classify("我检查门框", None)
    assert r["primary_intent"] == "investigate"
    # The request artifact was written with the Constitution embedded.
    written_request = json.loads((tmp_path / router.INTENT_EVAL_REQUEST).read_text(encoding="utf-8"))
    assert written_request["kind"] == "coc_player_intent_request"
    assert "constitution" in written_request
    assert "keyword_hits" in written_request["constitution"]["forbidden_methods"]
    assert "action_atoms" in written_request["expected_output_schema"]["required"]


def test_llm_evaluator_preserves_catalog_backed_intent_detail(tmp_path):
    evaluator = router.LLMIntentEvaluator(artifacts_dir=tmp_path)
    request = evaluator._build_request("I scan the snowfield.", None)
    evaluator._write_request(request)
    _write_result(tmp_path, request, result_overrides={
        "intent_detail": "quick_observation",
        "reasons": {
            "primary_intent": "The player is investigating the scene.",
            "intent_detail": "The evaluator selected the exact quick-observation enum.",
        },
    })

    result = evaluator.classify("I scan the snowfield.", None)

    schema = request["expected_output_schema"]
    assert "intent_detail" in schema["optional"]
    assert schema["intent_detail_enum"] == list(router._TIME_CATEGORY_ENUM)
    assert result["intent_detail"] == "quick_observation"


def test_llm_evaluator_rejects_intent_detail_outside_time_catalog(tmp_path):
    evaluator = router.LLMIntentEvaluator(artifacts_dir=tmp_path)
    request = evaluator._build_request("I scan the snowfield.", None)
    evaluator._write_request(request)
    _write_result(tmp_path, request, result_overrides={
        "intent_detail": "take_a_fast_peek",
        "reasons": {
            "primary_intent": "The player is investigating the scene.",
            "intent_detail": "Free prose must not become a time category.",
        },
    })

    with pytest.raises(router.IntentEvalError, match="intent_detail.*time category enum"):
        evaluator.classify("I scan the snowfield.", None)


def test_llm_evaluator_requires_reason_for_optional_intent_detail(tmp_path):
    evaluator = router.LLMIntentEvaluator(artifacts_dir=tmp_path)
    request = evaluator._build_request("I scan the snowfield.", None)
    evaluator._write_request(request)
    _write_result(tmp_path, request, result_overrides={
        "intent_detail": "quick_observation",
    })

    with pytest.raises(router.IntentEvalError, match="reasons.intent_detail"):
        evaluator.classify("I scan the snowfield.", None)


def test_injected_evaluator_drops_invalid_intent_detail_with_reason():
    fixture = FixtureIntentEvaluator(result={
        "primary_intent": "investigate",
        "secondary_intents": [],
        "target_entities": [],
        "risk_posture": "cautious",
        "explicit_roll_request": False,
        "player_hypothesis": None,
        "action_atoms": [],
        "intent_detail": "look around quickly",
    })
    router.set_intent_evaluator(fixture)

    result = router.parse_intent("I scan the snowfield.")

    assert "intent_detail" not in result
    assert result["normalization_warnings"] == [{
        "field": "intent_detail",
        "reason_code": "not_in_time_cost_category_enum",
    }]


def test_action_atoms_are_preserved_from_semantic_evaluator():
    """Multi-step risky actions must survive the intent router into enrichment."""
    atoms = [
        {"id": "a1", "verb": "冲过枪口", "skill": "Dodge", "stakes": "失败则警卫先手"},
        {"id": "a2", "verb": "拖走队友", "skill": "STR", "depends_on": "a1"},
    ]
    fixture = FixtureIntentEvaluator(result={
        "primary_intent": "flee",
        "secondary_intents": ["protect_ally"],
        "target_entities": ["guard"],
        "risk_posture": "reckless",
        "explicit_roll_request": False,
        "player_hypothesis": None,
        "action_atoms": atoms,
    })
    router.set_intent_evaluator(fixture)

    result = router.parse_intent("我冲过枪口，把队友拖出去")

    assert result["action_atoms"] == atoms


def test_llm_evaluator_missing_result_raises(tmp_path):
    """A missing result is missing semantic evidence — never a keyword fallback."""
    evaluator = router.LLMIntentEvaluator(artifacts_dir=tmp_path)
    with pytest.raises(router.IntentEvalError, match="missing_intent_eval_result"):
        evaluator.classify("我检查门框", None)


def test_llm_evaluator_provenance_sha_mismatch_raises(tmp_path):
    """A result whose request_sha256 does not match the request is rejected."""
    evaluator = router.LLMIntentEvaluator(artifacts_dir=tmp_path)
    request = evaluator._build_request("我检查门框", None)
    evaluator._write_request(request)
    bogus = {
        "evaluator_id": router.LLM_INTENT_EVALUATOR_ID,
        "evaluation_provenance": {
            "kind": "llm",
            "request_sha256": "0" * 64,  # wrong hash
            "reviewed_artifact": router.INTENT_EVAL_REQUEST,
        },
        "primary_intent": "investigate",
        "reasons": {"primary_intent": "x"},
    }
    (tmp_path / router.INTENT_EVAL_RESULT).write_text(json.dumps(bogus), encoding="utf-8")

    with pytest.raises(router.IntentEvalError, match="request_sha256 mismatch"):
        evaluator.classify("我检查门框", None)


def test_llm_evaluator_rejects_wrong_evaluator_id(tmp_path):
    evaluator = router.LLMIntentEvaluator(artifacts_dir=tmp_path)
    request = evaluator._build_request("text", None)
    evaluator._write_request(request)
    result = {
        "evaluator_id": "some-other-evaluator",
        "evaluation_provenance": {
            "kind": "llm",
            "request_sha256": router._json_sha256(request),
            "reviewed_artifact": router.INTENT_EVAL_REQUEST,
        },
        "primary_intent": "investigate",
        "reasons": {"primary_intent": "x"},
    }
    (tmp_path / router.INTENT_EVAL_RESULT).write_text(json.dumps(result), encoding="utf-8")

    with pytest.raises(router.IntentEvalError, match="evaluator_id mismatch"):
        evaluator.classify("text", None)


def test_llm_evaluator_rejects_missing_reasons(tmp_path):
    """Constitution requires recording reasons; a result without them is invalid."""
    evaluator = router.LLMIntentEvaluator(artifacts_dir=tmp_path)
    request = evaluator._build_request("text", None)
    evaluator._write_request(request)
    result = {
        "evaluator_id": router.LLM_INTENT_EVALUATOR_ID,
        "evaluation_provenance": {
            "kind": "llm",
            "request_sha256": router._json_sha256(request),
            "reviewed_artifact": router.INTENT_EVAL_REQUEST,
        },
        "primary_intent": "investigate",
        "reasons": {},  # empty — violates the "record reasons" requirement
    }
    (tmp_path / router.INTENT_EVAL_RESULT).write_text(json.dumps(result), encoding="utf-8")

    with pytest.raises(router.IntentEvalError, match="reasons.primary_intent"):
        evaluator.classify("text", None)


def test_llm_evaluator_rejects_invalid_primary_intent(tmp_path):
    evaluator = router.LLMIntentEvaluator(artifacts_dir=tmp_path)
    request = evaluator._build_request("text", None)
    evaluator._write_request(request)
    result = {
        "evaluator_id": router.LLM_INTENT_EVALUATOR_ID,
        "evaluation_provenance": {
            "kind": "llm",
            "request_sha256": router._json_sha256(request),
            "reviewed_artifact": router.INTENT_EVAL_REQUEST,
        },
        "primary_intent": "flirting",  # not in the enum
        "reasons": {"primary_intent": "x"},
    }
    (tmp_path / router.INTENT_EVAL_RESULT).write_text(json.dumps(result), encoding="utf-8")

    with pytest.raises(router.IntentEvalError, match="not in allowed enum"):
        evaluator.classify("text", None)


# ---------------------------------------------------------------------------
# Enum completeness (director-specific classes must be reachable)
# ---------------------------------------------------------------------------

def test_primary_intent_enum_includes_director_classes():
    """The enum must include ambiguous/montage/cast so the director's
    _base_score branches that check those classes are reachable when the
    router feeds the director."""
    for cls in ("move", "ambiguous", "montage", "cast"):
        assert cls in router._PRIMARY_INTENT_ENUM, f"{cls} missing from enum"


def test_runtime_intent_contract_enum_stays_in_sync_with_router():
    """Runtime contract mirrors the plugin enum (Runtime Track: no plugin import).

    Source of truth: coc_intent_router._PRIMARY_INTENT_ENUM.
    """
    contract_path = (
        Path(__file__).resolve().parents[1]
        / "runtime"
        / "engine"
        / "intent_contract.py"
    )
    spec = importlib.util.spec_from_file_location(
        "runtime_intent_contract_sync", contract_path
    )
    contract = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(contract)
    assert frozenset(router._PRIMARY_INTENT_ENUM) == contract.CANONICAL_INTENT_CLASSES


def test_llm_evaluator_accepts_movement_intent(tmp_path):
    """Ordinary movement is its own intent, not flee/stuck/idle."""
    evaluator = router.LLMIntentEvaluator(artifacts_dir=tmp_path)
    request = evaluator._build_request("我继续跟着队伍往前走", {"scene_id": "ravine"})
    evaluator._write_request(request)
    _write_result(tmp_path, request, result_overrides={
        "primary_intent": "move",
        "secondary_intents": ["low_agency_continue", "follow_group"],
        "reasons": {"primary_intent": "The player keeps moving with the group without choosing a new goal."},
    })

    result = evaluator.classify("我继续跟着队伍往前走", {"scene_id": "ravine"})

    assert result["primary_intent"] == "move"


def test_fixture_can_return_director_specific_classes():
    """A fixture evaluator can return the director-specific intent classes."""
    for cls in ("ambiguous", "montage", "cast"):
        fixture = FixtureIntentEvaluator(result={
            "primary_intent": cls,
            "secondary_intents": [], "target_entities": [],
            "risk_posture": "neutral", "explicit_roll_request": False,
            "player_hypothesis": None,
            "action_atoms": [],
        })
        router.set_intent_evaluator(fixture)
        assert router.parse_intent("anything")["primary_intent"] == cls
