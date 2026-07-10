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
    """A well-formed DirectorPlan that passes all narration checks."""
    secrets = ["secret-1: a hidden truth", "secret-2: another secret"] if secrets is None else secrets
    # R-2: plan carries {id, category} refs only — prose stays in boundaries.
    secret_refs = cnc.normalize_keeper_secret_refs(secrets)
    secret_ids = [ref["id"] for ref in secret_refs]
    return {
        "decision_id": "d1",
        "scene_action": "REVEAL",
        "dramatic_question": "Will the investigators uncover the truth?",
        "narrative_directives": {
            "tone": ["eerie", "oppressive"],
            "must_include": [],
            "must_not_reveal": secret_refs,
            "improvisation_allowed": [],
            "horror_escalation_stage": "wrongness",
            "player_facing_style": cnc.player_facing_style_contract("zh-Hans"),
        },
        "clue_policy": {"reveal": ["clue-public-1"], "withhold": secret_ids,
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
        "must_not_reveal_has_no_secret_prose",
        "scene_action_narratable", "rationale_present",
        "content_constraints_passed_through", "player_facing_style_present",
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


def test_missing_player_facing_style_fails_check(tmp_path):
    scenario_dir = _make_scenario(tmp_path)
    plan = _good_plan()
    del plan["narrative_directives"]["player_facing_style"]

    findings = cnc.assert_narration_ready(plan, scenario_dir)

    assert findings["player_facing_style_present"]["passed"] is False
    assert "player_facing_style" in findings["player_facing_style_present"]["detail"]


def test_player_facing_style_missing_final_output_pass_fails_check(tmp_path):
    scenario_dir = _make_scenario(tmp_path)
    plan = _good_plan()
    guard = plan["narrative_directives"]["player_facing_style"]["style_guard"]
    guard["required_rules"] = [
        rule for rule in guard["required_rules"]
        if rule != "final_prose_guard_before_output"
    ]
    del guard["final_output_pass"]

    findings = cnc.assert_narration_ready(plan, scenario_dir)

    assert findings["player_facing_style_present"]["passed"] is False
    detail = findings["player_facing_style_present"]["detail"]
    assert "final_prose_guard_before_output" in detail
    assert "final_output_pass_ok=False" in detail


def test_player_facing_style_contract_includes_repetition_compression_policy():
    style = cnc.player_facing_style_contract("zh-Hans")

    policy = style["repetition_policy"]
    assert policy["established_fact_mode"] == "compress"
    assert policy["repeat_foreign_dialogue"] == "summarize_unless_new_information"
    assert "semantic_repetition" in style["avoid"]
    assert "abstract_psychological_explanation" in style["avoid"]
    assert "observable_behavior" in style["prefer"]
    assert "observable_before_interpretation" in style["style_guard"]["required_rules"]
    assert "crisis_scene_clarity" in style["style_guard"]["required_rules"]
    assert "final_prose_guard_before_output" in style["style_guard"]["required_rules"]
    assert style["style_guard"]["final_output_pass"]["function"] == "guard_player_visible_text"
    assert style["render_contract"]["frame_type"] == "crisis_scene_render"
    assert "connection_or_force" in style["render_contract"]["required_slots"]


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


def test_must_not_reveal_with_secret_prose_fails_isolation_check(tmp_path):
    """Legacy plan that copies full keeper_secrets prose into must_not_reveal fails."""
    secrets = ["corbitt-buried-in-basement: body is under the house"]
    scenario_dir = _make_scenario(tmp_path, secrets=secrets)
    plan = _good_plan(secrets=secrets)
    plan["narrative_directives"]["must_not_reveal"] = list(secrets)
    findings = cnc.assert_narration_ready(plan, scenario_dir)
    assert findings["must_not_reveal_has_no_secret_prose"]["passed"] is False


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


# ---------------------------------------------------------------------------
# Content-constraint chain (Spec S1/S2): meta flags must reach the plan
# ---------------------------------------------------------------------------
def _make_scenario_with_meta(tmp_path, content_flags):
    """Scenario dir with both improvisation-boundaries and module-meta.json."""
    scenario_dir = _make_scenario(tmp_path)
    (scenario_dir / "module-meta.json").write_text(json.dumps({
        "schema_version": 1, "scenario_id": "m",
        "content_flags": content_flags,
    }))
    return scenario_dir


def test_content_flags_in_meta_missing_from_plan_fails_chain(tmp_path):
    """meta has content_flags but plan omits them -> chain NOT closed -> FAIL."""
    scenario_dir = _make_scenario_with_meta(
        tmp_path, content_flags=["cannibalism", "body_horror"])
    plan = _good_plan()
    # _good_plan has no content_constraints -> meta flags missing from plan
    plan["narrative_directives"]["content_constraints"] = []
    findings = cnc.assert_narration_ready(plan, scenario_dir)
    assert findings["content_constraints_passed_through"]["passed"] is False
    detail = findings["content_constraints_passed_through"]["detail"]
    assert "cannibalism" in detail and "body_horror" in detail
    assert cnc.is_narration_ready(plan, scenario_dir) is False


def test_content_flags_in_meta_present_in_plan_passes_chain(tmp_path):
    """meta flags mirrored in plan.content_constraints -> chain closed -> PASS."""
    scenario_dir = _make_scenario_with_meta(
        tmp_path, content_flags=["cannibalism", "body_horror"])
    plan = _good_plan()
    plan["narrative_directives"]["content_constraints"] = ["cannibalism", "body_horror"]
    findings = cnc.assert_narration_ready(plan, scenario_dir)
    assert findings["content_constraints_passed_through"]["passed"] is True


def test_no_module_meta_passes_chain_cannot_verify(tmp_path):
    """Scenario without module-meta.json -> check passes (cannot verify)."""
    scenario_dir = _make_scenario(tmp_path)  # no module-meta written
    plan = _good_plan()
    findings = cnc.assert_narration_ready(plan, scenario_dir)
    assert findings["content_constraints_passed_through"]["passed"] is True
    assert "cannot verify" in findings["content_constraints_passed_through"]["detail"]


# ---------------------------------------------------------------------------
# N3: player-visible prose guard over narration envelope fields
# ---------------------------------------------------------------------------

def test_iter_player_visible_text_fields_covers_envelope_prose():
    envelope = {
        "dramatic_question": "桌上有什么？",
        "approved_reveals": {
            "must_include": ["门框上的新划痕", {"cue": "抽屉半开着"}],
            "leads": ["去书房"],
            "clue_ids": ["c1"],
        },
        "choice_frame": {"prompt": "你要怎么做？"},
        "storylet_moves": [{"cue": "地板吱呀一声"}],
        "rationale": "keeper-only reason should be skipped",
        "must_not_reveal": [{"id": "secret-1", "category": "keeper_secret"}],
    }

    fields = dict(cnc.iter_player_visible_text_fields(envelope))

    assert fields["narration_envelope.dramatic_question"] == "桌上有什么？"
    assert fields["narration_envelope.approved_reveals.must_include[0]"] == "门框上的新划痕"
    assert fields["narration_envelope.approved_reveals.must_include[1].cue"] == "抽屉半开着"
    assert fields["narration_envelope.approved_reveals.leads[0]"] == "去书房"
    assert fields["narration_envelope.choice_frame.prompt"] == "你要怎么做？"
    assert fields["narration_envelope.storylet_moves[0].cue"] == "地板吱呀一声"
    assert "rationale" not in "".join(fields)
    assert "must_not_reveal" not in "".join(fields)
    assert "secret-1" not in fields.values()


def test_audit_player_visible_fields_emits_structured_rewrite_findings():
    """Guard findings are advisory (severity=rewrite); never block by default."""
    envelope = {
        "dramatic_question": "继续？",
        "approved_reveals": {
            "must_include": ["这表明桌上有一份文件。"],
            "leads": [],
            "clue_ids": [],
        },
        "choice_frame": {},
        "storylet_moves": [],
    }

    audit = cnc.audit_player_visible_fields(
        envelope, decision_id="turn-001", ts="2026-07-10T00:00:00Z"
    )

    assert audit["findings_count"] >= 1
    assert audit["blocking"] is False
    record = audit["records"][0]
    assert record["decision_id"] == "turn-001"
    assert record["ts"] == "2026-07-10T00:00:00Z"
    assert "must_include" in record["field"]
    assert record["finding_code"] == "ai_summary_voice"
    assert record["severity"] == "rewrite"
    assert cnc.is_blocking_severity(record["severity"]) is False


def test_audit_player_visible_fields_clean_prose_has_zero_findings():
    envelope = {
        "dramatic_question": "桌上有什么？",
        "approved_reveals": {
            "must_include": ["门框上的新划痕。"],
            "leads": [],
            "clue_ids": [],
        },
        "choice_frame": {},
        "storylet_moves": [],
    }

    audit = cnc.audit_player_visible_fields(envelope, decision_id="turn-002")

    assert audit["findings_count"] == 0
    assert audit["records"] == []
    assert audit["blocking"] is False


def test_blocking_severity_contract_is_block_only():
    """guard_player_visible_text emits rewrite; only 'block' would gate a turn."""
    assert cnc.is_blocking_severity("rewrite") is False
    assert cnc.is_blocking_severity("block") is True
    assert cnc.NARRATION_GUARD_BLOCKING_SEVERITY == "block"
