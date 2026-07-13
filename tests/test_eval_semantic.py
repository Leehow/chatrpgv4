from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
from pathlib import Path


REPO = Path(__file__).resolve().parents[1]
MODULE_PATH = REPO / "plugins" / "coc-keeper" / "scripts" / "coc_eval_semantic.py"
JUDGE_PATH = REPO / "plugins" / "coc-keeper" / "scripts" / "coc_eval_judge.py"
PERSONAS_PATH = REPO / "evaluation" / "spec" / "v1" / "personas" / "personas.json"
RUBRICS_DIR = REPO / "evaluation" / "spec" / "v1" / "rubrics"

REQUIRED_PERSONA_IDS = (
    "careful_investigator",
    "reckless_investigator",
    "skeptical_rules_lawyer",
    "genre_savvy_player",
    "social_first_player",
    "combat_first_player",
    "speedrunner",
    "stuck_player",
    "adversarial_boundary_tester",
    "memory_challenger",
    "colloquial_ambiguous_player",
    "meta_question_player",
)

BOUNDED_INT_FIELDS = (
    "risk_tolerance",
    "rules_knowledge",
    "metagame_tendency",
    "social_preference",
    "combat_preference",
    "persistence_after_failure",
)

GOAL_ORIENTATIONS = frozenset({"fast", "thorough", "social", "combat", "chaotic"})
VERBOSITIES = frozenset({"short", "medium", "long"})

ZH_PROSE_FINDING_CODES = (
    "AI_SUMMARY",
    "TRANSLATIONESE_PASSIVE",
    "ABSTRACT_EMOTION",
    "OVEREXPLAIN",
    "GENERIC_HORROR",
    "MENU_DUMP",
    "MECHANICAL_LEAK",
    "REPETITION",
    "REGISTER_MISMATCH",
    "NPC_VOICE_COLLISION",
    "TOO_LITERARY",
    "TOO_FLAT",
    "UNNATURAL_CJK",
)

AGENCY_FINDING_CODES = (
    "ACTION_ACK",
    "CAUSAL_RESULT",
    "INFORMATION_GAIN",
    "MEANINGFUL_CHOICE",
    "COMPETENCE_REWARD",
    "DEEPENING",
    "COMPLICATION",
    "REFRAMING",
    "PAYOFF",
    "TENSION_CHANGE",
    "DEAD_TURN",
    "EMPTY_CONFIRMATION",
    "AUTO_COMPLIANCE",
    "HARD_DENIAL",
    "FAKE_CHOICE",
    "UNFORESHADOWED_RETCON",
    "REPEATED_AFFORDANCE",
    "KP_TAKES_OVER",
    "STUCK_LOOP",
)


def _load():
    assert MODULE_PATH.is_file(), f"missing implementation module: {MODULE_PATH}"
    spec = importlib.util.spec_from_file_location("coc_eval_semantic_test", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules["coc_eval_semantic_test"] = module
    spec.loader.exec_module(module)
    return module


def _load_judge():
    assert JUDGE_PATH.is_file(), f"missing implementation module: {JUDGE_PATH}"
    spec = importlib.util.spec_from_file_location("coc_eval_judge_test", JUDGE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules["coc_eval_judge_test"] = module
    spec.loader.exec_module(module)
    return module


def _canonical_sha256(payload: object) -> str:
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def test_personas_json_defines_exactly_twelve_required_ids():
    assert PERSONAS_PATH.is_file(), f"missing personas file: {PERSONAS_PATH}"
    payload = json.loads(PERSONAS_PATH.read_text(encoding="utf-8"))
    personas = payload["personas"]
    ids = [item["persona_id"] for item in personas]
    assert ids == list(REQUIRED_PERSONA_IDS)
    assert len(set(ids)) == 12


def test_persona_fields_are_bounded_and_enums_are_closed():
    payload = json.loads(PERSONAS_PATH.read_text(encoding="utf-8"))
    for persona in payload["personas"]:
        for field in BOUNDED_INT_FIELDS:
            value = persona[field]
            assert isinstance(value, int) and not isinstance(value, bool)
            assert 0 <= value <= 4, f"{persona['persona_id']}.{field}={value}"
        assert persona["verbosity"] in VERBOSITIES
        assert persona["goal_orientation"] in GOAL_ORIENTATIONS
        assert isinstance(persona["prompt_directives"], list)
        assert all(isinstance(item, str) and item for item in persona["prompt_directives"])
        assert isinstance(persona["description"], str) and persona["description"]


def test_load_personas_and_persona_hash_is_stable():
    semantic = _load()
    loaded = semantic.load_personas(REPO)
    assert loaded["schema_version"] == 1
    assert loaded["eval_spec"] == "eval-spec-v1"
    personas = {item["persona_id"]: item for item in loaded["personas"]}
    assert set(personas) == set(REQUIRED_PERSONA_IDS)

    first = semantic.persona_canonical_sha256(personas["careful_investigator"])
    second = semantic.persona_canonical_sha256(personas["careful_investigator"])
    assert first == second
    assert len(first) == 64
    assert first == _canonical_sha256(personas["careful_investigator"])


def test_load_rubrics_exposes_closed_finding_label_sets():
    semantic = _load()
    rubrics = semantic.load_rubrics(REPO)
    assert set(rubrics) >= {"agency-and-fun", "zh-prose", "module-fidelity"}

    agency = rubrics["agency-and-fun"]
    zh = rubrics["zh-prose"]
    fidelity = rubrics["module-fidelity"]

    for rubric in (agency, zh, fidelity):
        assert rubric["schema_version"] == 1
        assert rubric["eval_spec"] == "eval-spec-v1"
        assert rubric["rubric_id"]
        assert rubric["rubric_version"]
        assert isinstance(rubric["dimensions"], list) and rubric["dimensions"]
        for dimension in rubric["dimensions"]:
            assert dimension["min_score"] == 1
            assert dimension["max_score"] == 5
        assert isinstance(rubric["finding_codes"], list) and rubric["finding_codes"]

    assert set(agency["finding_codes"]) >= set(AGENCY_FINDING_CODES)
    assert set(zh["finding_codes"]) >= set(ZH_PROSE_FINDING_CODES)
    assert all(isinstance(code, str) and code for code in fidelity["finding_codes"])


def test_blind_pair_request_hides_baseline_candidate_and_keeper_secrets():
    semantic = _load()
    rubrics = semantic.load_rubrics(REPO)
    rubric = rubrics["agency-and-fun"]

    baseline_turns = [
        {
            "turn_id": "t1",
            "side": "baseline",
            "text": "alpha narration",
            "keeper_secret": "never-expose",
            "expected_route": "secret-route",
        }
    ]
    candidate_turns = [
        {
            "turn_id": "t1",
            "side": "candidate",
            "text": "omega narration",
            "forbidden_outcome": "never-expose",
        }
    ]
    public_context = {
        "case_id": "fixture-case",
        "language": "zh-Hans",
        "keeper_secret": "must-be-stripped",
    }

    request, mapping = semantic.build_blind_pair_request(
        pair_id="pair-1",
        rubric_id=rubric["rubric_id"],
        rubric_version=rubric["rubric_version"],
        public_context=public_context,
        turn_ids=["t1"],
        baseline_turns=baseline_turns,
        candidate_turns=candidate_turns,
        seed=7,
    )

    encoded = json.dumps(request, ensure_ascii=False, sort_keys=True)
    assert "baseline" not in encoded.lower()
    assert "candidate" not in encoded.lower()
    assert "keeper_secret" not in encoded
    assert "expected_route" not in encoded
    assert "forbidden_outcome" not in encoded
    assert "must-be-stripped" not in encoded
    assert "never-expose" not in encoded

    assert request["labels"] == ["A", "B"]
    assert set(request["sides"]) == {"A", "B"}
    assert request["turn_ids"] == ["t1"]
    assert request["rubric_id"] == rubric["rubric_id"]
    assert request["rubric_version"] == rubric["rubric_version"]
    assert "seed" not in request
    assert request["request_sha256"] == _canonical_sha256(
        {key: value for key, value in request.items() if key != "request_sha256"}
    )
    assert set(mapping) == {"A", "B"}
    assert set(mapping.values()) == {"baseline", "candidate"}

    again, again_mapping = semantic.build_blind_pair_request(
        pair_id="pair-1",
        rubric_id=rubric["rubric_id"],
        rubric_version=rubric["rubric_version"],
        public_context=public_context,
        turn_ids=["t1"],
        baseline_turns=baseline_turns,
        candidate_turns=candidate_turns,
        seed=7,
    )
    assert again == request
    assert again_mapping == mapping


def test_extract_public_turns_allowlists_player_view_fields():
    semantic = _load()
    turns = semantic.extract_public_turns(
        [
            {
                "turn_number": 1,
                "view": "player",
                "player_text": "我查看门锁。",
                "narration": "锁孔边缘有新鲜划痕。",
                "keeper_secret": "hidden",
                "forbidden_outcome": "hidden",
            }
        ]
    )

    assert turns == [
        {
            "turn_id": "t1",
            "text": "我查看门锁。",
            "narration": "锁孔边缘有新鲜划痕。",
        }
    ]

    with __import__("pytest").raises(ValueError, match="player-view"):
        semantic.extract_public_turns(
            [{"turn_number": 1, "view": "keeper", "text": "private"}]
        )


def _valid_judge_result(request: dict, rubric: dict) -> dict:
    dimension_id = rubric["dimensions"][0]["dimension_id"]
    finding = rubric["finding_codes"][0]
    return {
        "evaluator": {"provider": "fixture", "id": "judge-1"},
        "request_sha256": request["request_sha256"],
        "winner": "A",
        "dimension_scores": {dimension_id: 4},
        "findings": [
            {
                "label": finding,
                "turn_id": "t1",
                "side": "A",
                "evidence_span": {"start": 0, "end": 4},
                "reason": "structured evidence cites the turn",
            }
        ],
        "reasons": ["A better preserves player agency on the cited turn."],
    }


def test_validate_judge_result_accepts_well_formed_payload():
    semantic = _load()
    rubrics = semantic.load_rubrics(REPO)
    rubric = rubrics["agency-and-fun"]
    request, _mapping = semantic.build_blind_pair_request(
        pair_id="pair-ok",
        rubric_id=rubric["rubric_id"],
        rubric_version=rubric["rubric_version"],
        public_context={"case_id": "ok"},
        turn_ids=["t1"],
        baseline_turns=[{"turn_id": "t1", "text": "alpha"}],
        candidate_turns=[{"turn_id": "t1", "text": "beta"}],
        seed=1,
    )
    result = _valid_judge_result(request, rubric)
    assert semantic.validate_judge_result(request, result, rubric=rubric) is True


def test_validate_judge_result_rejects_bad_winner_score_label_turn_and_hash():
    semantic = _load()
    rubrics = semantic.load_rubrics(REPO)
    rubric = rubrics["agency-and-fun"]
    request, _mapping = semantic.build_blind_pair_request(
        pair_id="pair-bad",
        rubric_id=rubric["rubric_id"],
        rubric_version=rubric["rubric_version"],
        public_context={"case_id": "bad"},
        turn_ids=["t1"],
        baseline_turns=[{"turn_id": "t1", "text": "alpha"}],
        candidate_turns=[{"turn_id": "t1", "text": "beta"}],
        seed=2,
    )
    dimension_id = rubric["dimensions"][0]["dimension_id"]

    bad_winner = _valid_judge_result(request, rubric)
    bad_winner["winner"] = "baseline"
    with __import__("pytest").raises(ValueError, match="winner"):
        semantic.validate_judge_result(request, bad_winner, rubric=rubric)

    bad_score = _valid_judge_result(request, rubric)
    bad_score["dimension_scores"] = {dimension_id: 9}
    with __import__("pytest").raises(ValueError, match="score"):
        semantic.validate_judge_result(request, bad_score, rubric=rubric)

    bad_label = _valid_judge_result(request, rubric)
    bad_label["findings"][0]["label"] = "NOT_A_REAL_LABEL"
    with __import__("pytest").raises(ValueError, match="finding"):
        semantic.validate_judge_result(request, bad_label, rubric=rubric)

    bad_turn = _valid_judge_result(request, rubric)
    bad_turn["findings"][0]["turn_id"] = "unknown-turn"
    with __import__("pytest").raises(ValueError, match="turn"):
        semantic.validate_judge_result(request, bad_turn, rubric=rubric)

    bad_hash = _valid_judge_result(request, rubric)
    bad_hash["request_sha256"] = "0" * 64
    with __import__("pytest").raises(ValueError, match="request_sha256"):
        semantic.validate_judge_result(request, bad_hash, rubric=rubric)

    missing_evidence = _valid_judge_result(request, rubric)
    missing_evidence["findings"] = [{"label": rubric["finding_codes"][0]}]
    with __import__("pytest").raises(ValueError, match="side|evidence"):
        semantic.validate_judge_result(request, missing_evidence, rubric=rubric)


def test_sol_judge_uses_chat_completions_and_exact_identity(monkeypatch):
    semantic = _load()
    judge = _load_judge()
    rubric = semantic.load_rubrics(REPO)["agency-and-fun"]
    request, _ = semantic.build_blind_pair_request(
        pair_id="pair-1",
        rubric_id="agency-and-fun",
        rubric_version=rubric["rubric_version"],
        public_context={"case_id": "neutral"},
        turn_ids=["t1"],
        baseline_turns=[{"turn_id": "t1", "text": "A"}],
        candidate_turns=[{"turn_id": "t1", "text": "B"}],
        seed=3,
    )
    dimension = rubric["dimensions"][0]["dimension_id"]
    valid_result = {
        "request_sha256": request["request_sha256"],
        "winner": "tie",
        "dimension_scores": {dimension: 3},
        "findings": [],
        "reasons": ["The cited public turn supports a tie."],
    }
    response = {"choices": [{"message": {"content": json.dumps(valid_result)}}]}
    calls = []
    monkeypatch.setattr(
        judge,
        "_post_json",
        lambda url, headers, payload, timeout: calls.append((url, payload))
        or response,
    )

    result = judge.invoke_sol_judge(
        request,
        rubric,
        base_url="http://127.0.0.1:18888/v1",
        api_key="local",
        timeout_s=3,
    )

    assert calls[0][0].endswith("/chat/completions")
    assert calls[0][1]["model"] == "gpt-5.6-sol"
    assert result["evaluator"] == {
        "provider": "coding-relay",
        "id": "gpt-5.6-sol",
    }


def test_judge_payload_contains_no_private_mapping_or_keeper_fields():
    semantic = _load()
    judge = _load_judge()
    rubric = semantic.load_rubrics(REPO)["agency-and-fun"]
    request, _ = semantic.build_blind_pair_request(
        pair_id="pair-private",
        rubric_id="agency-and-fun",
        rubric_version=rubric["rubric_version"],
        public_context={"case_id": "neutral", "keeper_secret": "drop-me"},
        turn_ids=["t1"],
        baseline_turns=[{"turn_id": "t1", "text": "A"}],
        candidate_turns=[{"turn_id": "t1", "text": "B"}],
        seed=4,
    )

    payload = judge.build_chat_payload(request, rubric)

    encoded = json.dumps(payload, ensure_ascii=False).lower()
    for forbidden in (
        "baseline",
        "candidate",
        "keeper_secret",
        "forbidden_outcome",
    ):
        assert forbidden not in encoded

    request["judge_label_mapping"] = {"A": "baseline", "B": "candidate"}
    with __import__("pytest").raises(ValueError, match="schema"):
        judge.build_chat_payload(request, rubric)
    request.pop("judge_label_mapping")
    request["public_context"]["case_id"] = "tampered"
    with __import__("pytest").raises(ValueError, match="request_sha256"):
        judge.build_chat_payload(request, rubric)


def test_aggregate_judge_results_exposes_rates_and_hard_findings():
    semantic = _load()
    rubrics = semantic.load_rubrics(REPO)
    agency = rubrics["agency-and-fun"]
    zh = rubrics["zh-prose"]
    dimension_id = agency["dimensions"][0]["dimension_id"]

    results = [
        {
            "pair_id": "p1",
            "rubric_id": "agency-and-fun",
            "winner": "A",
            "dimension_scores": {dimension_id: 5},
            "findings": [{"label": "ACTION_ACK"}],
            "hard_findings": [],
            "han_character_count": 0,
        },
        {
            "pair_id": "p2",
            "rubric_id": "agency-and-fun",
            "winner": "uncertain",
            "dimension_scores": {dimension_id: 3},
            "findings": [{"label": "DEAD_TURN"}],
            "hard_findings": ["missing_public_roll"],
            "han_character_count": 0,
        },
        {
            "pair_id": "p3",
            "rubric_id": "zh-prose",
            "winner": "B",
            "dimension_scores": {},
            "findings": [
                {"label": "AI_SUMMARY"},
                {"label": "REPETITION"},
            ],
            "hard_findings": [],
            "han_character_count": 2000,
        },
    ]

    aggregate = semantic.aggregate_judge_results(results, rubrics=rubrics)
    assert aggregate["pair_count"] == 3
    assert aggregate["preference_rates"]["A"] == 1 / 3
    assert aggregate["preference_rates"]["B"] == 1 / 3
    assert aggregate["preference_rates"]["tie"] == 0.0
    assert aggregate["uncertain_rate"] == 1 / 3
    assert aggregate["label_frequencies"]["ACTION_ACK"] == 1
    assert aggregate["label_frequencies"]["DEAD_TURN"] == 1
    assert aggregate["label_frequencies"]["AI_SUMMARY"] == 1
    assert aggregate["dimension_score_aggregates"][dimension_id]["mean"] == 4.0
    assert aggregate["zh_prose_findings_per_thousand_han"] == 1.0
    assert aggregate["hard_findings"] == ["missing_public_roll"]
    assert aggregate["hard_findings_override_judge"] is True
