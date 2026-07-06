"""Tests for coc_narration_contract: director→narrator handoff contract.

Verifies that a DirectorPlan carries everything an LLM narrator needs to
write a compliant scene (Spec Section 6, steps 5-7). Mirrors the
importlib-based loading pattern of test_story_harness.py / test_story_director.py.
"""
import importlib.util
import json
from pathlib import Path

import pytest

SCRIPT = "plugins/coc-keeper/scripts/coc_narration_contract.py"


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, rel)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


cnc = _load("coc_narration_contract", SCRIPT)


def _make_scenario(tmp_path, secrets=None):
    """Write a minimal scenario dir with an improvisation-boundaries.json."""
    scenario_dir = tmp_path / "scenario"
    scenario_dir.mkdir(parents=True)
    secrets = ["secret-1: a hidden truth", "secret-2: another secret"] if secrets is None else secrets
    (scenario_dir / "improvisation-boundaries.json").write_text(json.dumps(
        {"invent_allowed": [], "never_invent": [], "keeper_secrets": secrets}))
    return scenario_dir


def _good_plan(secrets=None):
    """A well-formed DirectorPlan that passes all 8 narration checks."""
    secrets = ["secret-1: a hidden truth", "secret-2: another secret"] if secrets is None else secrets
    return {
        "decision_id": "d1",
        "scene_action": "REVEAL",
        "dramatic_question": "Will the investigators uncover the truth?",
        "narrative_directives": {
            "tone": ["eerie", "oppressive"],
            "must_include": [],
            "must_not_reveal": list(secrets),
            "improvisation_allowed": [],
            "horror_escalation_stage": "wrongness",
        },
        "clue_policy": {"reveal": ["clue-public-1"], "withhold": list(secrets),
                        "fallback_routes": [], "clue_type": "obscured"},
        "rules_requests": [{"kind": "skill_check", "skill": "Spot Hidden",
                            "reason": "obscured clue", "difficulty": "regular",
                            "bonus_penalty_dice": 0}],
        "handoff": "rules",
        "rationale": "top-scored action REVEAL (score=0.9)",
    }


# ---------------------------------------------------------------------------
# Positive
# ---------------------------------------------------------------------------
def test_well_formed_plan_passes_all_checks(tmp_path):
    scenario_dir = _make_scenario(tmp_path)
    plan = _good_plan()
    findings = cnc.assert_narration_ready(plan, scenario_dir)
    assert set(findings.keys()) == {
        "tone_present", "must_not_reveal_populated", "dramatic_question_present",
        "horror_stage_valid", "handoff_consistency", "clue_policy_no_secret_leak",
        "scene_action_narratable", "rationale_present",
    }
    failed = {k: v for k, v in findings.items() if not v["passed"]}
    assert failed == {}, f"unexpected failures: {failed}"
    assert cnc.is_narration_ready(plan, scenario_dir) is True


# ---------------------------------------------------------------------------
# Negatives — one per the required cases
# ---------------------------------------------------------------------------
def test_missing_must_not_reveal_fails_check_2(tmp_path):
    scenario_dir = _make_scenario(tmp_path)  # secrets: secret-1, secret-2
    plan = _good_plan()
    # empty out must_not_reveal → no longer a superset (nor populated)
    plan["narrative_directives"]["must_not_reveal"] = []
    findings = cnc.assert_narration_ready(plan, scenario_dir)
    assert findings["must_not_reveal_populated"]["passed"] is False
    detail = findings["must_not_reveal_populated"]["detail"]
    # both secrets should be reported missing
    assert "secret-1" in detail and "secret-2" in detail
    assert cnc.is_narration_ready(plan, scenario_dir) is False


def test_handoff_rules_empty_rules_requests_fails_check_5(tmp_path):
    scenario_dir = _make_scenario(tmp_path)
    plan = _good_plan()
    plan["handoff"] = "rules"
    plan["rules_requests"] = []  # handing off to rules with nothing to do
    findings = cnc.assert_narration_ready(plan, scenario_dir)
    assert findings["handoff_consistency"]["passed"] is False
    assert "rules_requests_count=0" in findings["handoff_consistency"]["detail"]


def test_clue_policy_reveal_leaks_keeper_secret_fails_check_6(tmp_path):
    secrets = ["secret-1: a hidden truth", "secret-2: another secret"]
    scenario_dir = _make_scenario(tmp_path, secrets=secrets)
    plan = _good_plan(secrets=secrets)
    # narrator told to reveal a keeper secret id
    plan["clue_policy"]["reveal"] = ["secret-1"]
    findings = cnc.assert_narration_ready(plan, scenario_dir)
    assert findings["clue_policy_no_secret_leak"]["passed"] is False
    assert "secret-1" in findings["clue_policy_no_secret_leak"]["detail"]


# ---------------------------------------------------------------------------
# Extra coverage: other check failures + CLI exit code
# ---------------------------------------------------------------------------
def test_missing_tone_fails_check_1(tmp_path):
    scenario_dir = _make_scenario(tmp_path)
    plan = _good_plan()
    plan["narrative_directives"]["tone"] = []
    findings = cnc.assert_narration_ready(plan, scenario_dir)
    assert findings["tone_present"]["passed"] is False


def test_invalid_horror_stage_fails_check_4(tmp_path):
    scenario_dir = _make_scenario(tmp_path)
    plan = _good_plan()
    plan["narrative_directives"]["horror_escalation_stage"] = "climax"
    findings = cnc.assert_narration_ready(plan, scenario_dir)
    assert findings["horror_stage_valid"]["passed"] is False


def test_narration_handoff_requires_complete_directives(tmp_path):
    scenario_dir = _make_scenario(tmp_path)
    plan = _good_plan()
    plan["handoff"] = "narration"
    plan["rules_requests"] = []
    plan["narrative_directives"]["tone"] = []  # incomplete directives
    findings = cnc.assert_narration_ready(plan, scenario_dir)
    assert findings["handoff_consistency"]["passed"] is False
    assert "tone_present=False" in findings["handoff_consistency"]["detail"]


def test_narration_handoff_complete_directives_passes(tmp_path):
    scenario_dir = _make_scenario(tmp_path)
    plan = _good_plan()
    plan["handoff"] = "narration"
    plan["rules_requests"] = []
    findings = cnc.assert_narration_ready(plan, scenario_dir)
    assert findings["handoff_consistency"]["passed"] is True


def test_missing_rationale_fails_check_8(tmp_path):
    scenario_dir = _make_scenario(tmp_path)
    plan = _good_plan()
    plan["rationale"] = ""
    findings = cnc.assert_narration_ready(plan, scenario_dir)
    assert findings["rationale_present"]["passed"] is False


def test_secret_id_extraction_handles_id_description_format(tmp_path):
    """keeper_secrets use 'id: description'; reveal uses bare ids. The leak
    check must match on the id prefix only."""
    secrets = ["corbitt-buried-in-basement: body is under the house"]
    scenario_dir = _make_scenario(tmp_path, secrets=secrets)
    plan = _good_plan(secrets=secrets)
    plan["clue_policy"]["reveal"] = ["corbitt-buried-in-basement"]
    findings = cnc.assert_narration_ready(plan, scenario_dir)
    assert findings["clue_policy_no_secret_leak"]["passed"] is False
    assert "corbitt-buried-in-basement" in findings["clue_policy_no_secret_leak"]["detail"]


def test_cli_passes_on_good_plan(tmp_path, capsys):
    scenario_dir = _make_scenario(tmp_path)
    plan = _good_plan()
    plan_path = tmp_path / "plan.json"
    plan_path.write_text(json.dumps(plan), encoding="utf-8")
    rc = cnc._main(["coc_narration_contract.py", str(plan_path), str(scenario_dir)])
    out = capsys.readouterr().out
    assert rc == 0
    assert "PASS" in out and "-> PASS" in out


def test_cli_fails_and_exits_nonzero_on_bad_plan(tmp_path, capsys):
    scenario_dir = _make_scenario(tmp_path)
    plan = _good_plan()
    plan["narrative_directives"]["must_not_reveal"] = []
    plan_path = tmp_path / "plan.json"
    plan_path.write_text(json.dumps(plan), encoding="utf-8")
    rc = cnc._main(["coc_narration_contract.py", str(plan_path), str(scenario_dir)])
    out = capsys.readouterr().out
    assert rc == 1
    assert "[FAIL] must_not_reveal_populated" in out
    assert "-> FAIL" in out


def test_cli_usage_error_exits_2(tmp_path, capsys):
    rc = cnc._main(["coc_narration_contract.py"])
    err = capsys.readouterr().err
    assert rc == 2
    assert "usage" in err
