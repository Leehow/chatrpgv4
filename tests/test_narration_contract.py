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


def test_applied_events_are_the_only_authority_for_disclosure_reveals():
    plan = _good_plan()
    plan["clue_policy"].update({"delivery_kind": "npc_dialogue"})
    plan["narrative_directives"]["must_include"] = ["THE TRUE CLUE"]
    plan["disclosure_decisions"] = [{
        "npc_id": "npc-a", "outcome": "lie", "fact_id": "fact-a",
        "clue_id": "clue-public-1", "player_safe_line": "A harmless cover story.",
    }]
    graph = {"conclusions": [{"clues": [{
        "clue_id": "clue-public-1", "player_safe_summary": "THE TRUE CLUE",
    }]}]}
    env = cnc.build_narration_envelope(plan, clue_graph=graph, applied_events=[])
    blob = json.dumps(env)
    assert env["approved_reveals"]["clue_ids"] == []
    assert env["approved_reveals"]["clues"] == []
    assert env["approved_reveals"]["must_include"] == []
    assert "THE TRUE CLUE" not in blob
    assert "fact-a" not in blob
    assert "A harmless cover story." in blob


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


# ---------------------------------------------------------------------------
# Narration envelope grounding: reveals / rule_results / scene / npc seeds
# ---------------------------------------------------------------------------

def _clue_graph_with_summaries():
    return {
        "conclusions": [{
            "conclusion_id": "c1",
            "importance": "critical",
            "minimum_routes": 1,
            "clues": [
                {
                    "clue_id": "clue-door-scratch",
                    "delivery_kind": "environmental",
                    "visibility": "player-safe",
                    "player_safe_summary": "门框边缘有新鲜划痕",
                },
                {
                    "clue_id": "clue-keeper-only",
                    "visibility": "keeper-only",
                    "player_safe_summary": "SHOULD_NOT_LEAK",
                },
            ],
        }],
    }


def test_envelope_approved_reveals_include_player_safe_summary_bodies():
    plan = _good_plan()
    plan["clue_policy"]["reveal"] = ["clue-door-scratch"]
    plan["handoff"] = "narration"
    plan["rules_requests"] = []
    envelope = cnc.build_narration_envelope(
        plan, clue_graph=_clue_graph_with_summaries()
    )
    reveals = envelope["approved_reveals"]
    assert "clue-door-scratch" in reveals["clue_ids"]
    assert reveals["clues"] == [{
        "clue_id": "clue-door-scratch",
        "player_safe_summary": "门框边缘有新鲜划痕",
    }]
    blob = json.dumps(envelope, ensure_ascii=False)
    assert "门框边缘有新鲜划痕" in blob
    assert "SHOULD_NOT_LEAK" not in blob


def test_envelope_includes_settled_rule_results_not_just_requests():
    plan = _good_plan()
    plan["rules_results"] = [{
        "kind": "skill_check",
        "skill": "Spot Hidden",
        "outcome": "regular_success",
        "success": True,
        "roll": 42,
        "target": 60,
        "effective_target": 60,
        "difficulty": "hard",
        "roll_contract": {
            "failure_outcome_mode": "bonus_with_cost",
            "goal": "gain extra detail",
        },
    }]
    plan["resolved_clue_policy"] = {
        "bonus_reveal": "抽屉夹层里还有一张发黄的便条",
        "bonus_cost": None,
    }
    envelope = cnc.build_narration_envelope(
        plan, investigator_display_name="埃莉诺·里德"
    )
    assert envelope["rule_results"]
    result = envelope["rule_results"][0]
    assert result["skill"] == "Spot Hidden"
    assert result["investigator_display_name"] == "埃莉诺·里德"
    assert result["outcome"] == "regular_success"
    assert result["success"] is True
    assert result["bonus_reveal"] == "抽屉夹层里还有一张发黄的便条"
    # Hidden dice math must not reach the narrator.
    assert "roll" not in result
    assert "target" not in result
    assert "effective_target" not in result
    assert "difficulty" not in result


def test_envelope_rule_results_carry_player_visible_cost_on_failure():
    plan = _good_plan()
    plan["rules_results"] = [{
        "kind": "skill_check",
        "skill": "Library Use",
        "outcome": "failure",
        "success": False,
        "roll": 88,
        "target": 50,
        "roll_contract": {"failure_outcome_mode": "bonus_with_cost"},
    }]
    plan["resolved_clue_policy"] = {"bonus_cost": "time", "bonus_reveal": None}
    envelope = cnc.build_narration_envelope(
        plan, investigator_display_name="托马斯·海斯"
    )
    result = envelope["rule_results"][0]
    assert result["success"] is False
    assert result["player_visible_cost"] == "time"
    assert "roll" not in result


def test_envelope_scene_anchor_from_player_safe_scene_fields():
    plan = _good_plan()
    plan["handoff"] = "narration"
    plan["rules_requests"] = []
    scene = {
        "scene_id": "hall-of-records",
        "display_name": "市政厅档案厅",
        "tone": ["dust", "old paper", "bureaucratic indifference"],
        "sensory_anchors": ["墨水味", "高窗透进的灰光"],
        "location_tags": ["archive", "档案厅"],
        "allowed_improvisation": ["do not invent new cult fact"],
        "keeper_notes": "Corbitt is undead — never say this",
    }
    envelope = cnc.build_narration_envelope(plan, active_scene=scene)
    anchor = envelope["scene_anchor"]
    assert anchor["scene_id"] == "hall-of-records"
    assert anchor["display_name"] == "市政厅档案厅"
    assert "墨水味" in anchor["sensory_anchors"]
    assert "dust" in anchor["sensory_anchors"]
    assert "archive" in anchor.get("location_tags", [])
    blob = json.dumps(envelope, ensure_ascii=False)
    assert "Corbitt is undead" not in blob
    assert "do not invent new cult fact" not in blob


def test_envelope_drops_agenda_prose_for_secret_bearing_npcs():
    """has_secret=True gates the keeper-facing agenda prose out of the envelope."""
    secret_agenda = (
        "Mislead and frighten intruders away from his buried body; failing "
        "that, murder them and resume feeding on residents."
    )
    plan = _good_plan()
    plan["handoff"] = "narration"
    plan["rules_requests"] = []
    plan["npc_moves"] = [
        {
            "npc_id": "npc-walter-corbitt",
            "display_name": "Walter Corbitt",
            "agenda": secret_agenda,
            "emotional_tone": "hostile",
            "has_secret": True,
            "secret_id": "secret-corbitt-undead",
            "secret_limit": "do not reveal this NPC's secret",
            "voice": "Rarely speaks. Acts through knocks and flying furniture.",
            "agency_moves": [
                {"move_id": "stalk", "visibility": "keeper_only",
                 "agency_directive": secret_agenda},
                {"move_id": "knock", "visibility": "player_visible",
                 "reason": "structured"},
            ],
            "persona": {
                "tags": ["temperament.secretive"],
                "surface_cues": ["空气骤冷"],
                "keeper_note": secret_agenda,
            },
        },
        {
            "npc_id": "npc-knott",
            "display_name": "Steven Knott",
            "agenda": "wants the house rented",
            "emotional_tone": "warm and cooperative",
            "has_secret": False,
        },
    ]
    envelope = cnc.build_narration_envelope(plan)
    blob = json.dumps(envelope, ensure_ascii=False)
    assert secret_agenda not in blob
    corbitt, knott = envelope["npc_moves"]
    assert "agenda" not in corbitt
    assert corbitt["has_secret"] is True
    assert "secret_id" not in corbitt
    # keeper-only agency moves and non-whitelisted persona keys are stripped
    assert [m["move_id"] for m in corbitt["agency_moves"]] == ["knock"]
    assert set(corbitt["persona"].keys()) <= {"tags", "surface_cues"}
    # A21 uses a field-level whitelist: even benign raw agenda prose stays out.
    assert "agenda" not in knott


def test_envelope_npc_moves_keep_display_name_and_dialogue_seed():
    plan = _good_plan()
    plan["handoff"] = "narration"
    plan["rules_requests"] = []
    plan["npc_moves"] = [{
        "npc_id": "npc-steven-knott",
        "display_name": "Steven Knott",
        "agenda": "wants the house rented",
        "emotional_tone": "warm and cooperative",
        "has_secret": True,
        "secret_id": "secret-knott-doubts",
        "secret_limit": "do not reveal this NPC's secret",
        "voice": "Practical, impatient, money-minded.",
        "active_reactions": [{
            "move": "nudge",
            "line_seed": "钥匙在桌上，今天就定下来吧。",
            "visibility": "player_visible",
        }],
        "persona": {"surface_cues": ["捏着怀表链"]},
    }]
    envelope = cnc.build_narration_envelope(plan)
    move = envelope["npc_moves"][0]
    assert move["display_name"] == "Steven Knott"
    assert move["dialogue_seed"] == "钥匙在桌上，今天就定下来吧。"
    assert move["has_secret"] is True
    assert "secret" not in move or move.get("secret") in (None, "")
    # Secret bodies and ids are Keeper-only and never cross this envelope.
    assert "secret_id" not in move


def test_iter_player_visible_text_fields_covers_new_envelope_prose():
    envelope = {
        "dramatic_question": "桌上有什么？",
        "approved_reveals": {
            "clue_ids": ["c1"],
            "clues": [{"clue_id": "c1", "player_safe_summary": "门框上的新划痕"}],
            "must_include": [],
            "leads": [],
        },
        "rule_results": [{
            "skill": "Spot Hidden",
            "investigator_display_name": "埃莉诺",
            "outcome": "success",
            "success": True,
            "bonus_reveal": "便条边角发潮",
        }],
        "scene_anchor": {
            "display_name": "档案厅",
            "sensory_anchors": ["灰尘味"],
        },
        "npc_moves": [{
            "npc_id": "npc-1",
            "display_name": "Knott",
            "dialogue_seed": "今天就定下来吧。",
        }],
    }
    fields = dict(cnc.iter_player_visible_text_fields(envelope))
    assert fields["narration_envelope.approved_reveals.clues[0].player_safe_summary"] == "门框上的新划痕"
    assert fields["narration_envelope.rule_results[0].bonus_reveal"] == "便条边角发潮"
    assert fields["narration_envelope.scene_anchor.display_name"] == "档案厅"
    assert fields["narration_envelope.scene_anchor.sensory_anchors[0]"] == "灰尘味"
    assert fields["narration_envelope.npc_moves[0].dialogue_seed"] == "今天就定下来吧。"
    assert fields["narration_envelope.npc_moves[0].display_name"] == "Knott"


def test_envelope_passthrough_redirection_is_player_safe():
    plan = _good_plan()
    plan["redirection"] = {
        "strategy": "npc_influence",
        "reason_code": "stuck_player",
        "grounding": {
            "npc_id": "npc-guide",
            "display_name": "Guide",
            "keeper_only_note": "SECRET_SHOULD_NOT_LEAK",
            "agenda_prose": "SECRET_AGENDA",
        },
        "internal_rationale": "SECRET_RATIONALE",
    }
    envelope = cnc.build_narration_envelope(plan)
    redir = envelope.get("redirection")
    assert isinstance(redir, dict)
    assert redir["strategy"] == "npc_influence"
    assert redir["grounding"]["npc_id"] == "npc-guide"
    assert redir["grounding"]["display_name"] == "Guide"
    assert "reason_code" not in redir
    assert "internal_rationale" not in redir
    assert "keeper_only_note" not in redir["grounding"]
    assert "agenda_prose" not in redir["grounding"]
    blob = json.dumps(envelope, ensure_ascii=False)
    assert "SECRET_SHOULD_NOT_LEAK" not in blob
    assert "SECRET_AGENDA" not in blob
    assert "SECRET_RATIONALE" not in blob
    assert "hard_denial" not in blob


def test_envelope_omits_redirection_when_absent():
    plan = _good_plan()
    envelope = cnc.build_narration_envelope(plan)
    assert "redirection" not in envelope or envelope.get("redirection") is None


def test_social_delivery_without_decisions_exposes_only_committed_clue_events():
    plan = _good_plan()
    plan["clue_policy"].update({
        "delivery_kind": "npc_dialogue",
        "leads": ["clue-public-1"],
        "fallback_routes": ["clue-secret-fallback"],
    })
    plan["narrative_directives"]["must_include"] = ["PRE_GATE_SECRET"]
    plan["choice_frame"] = {"routes": [{"clue_id": "clue-secret-fallback"}]}
    envelope = cnc.build_narration_envelope(
        plan,
        clue_graph={"conclusions": [{"clues": [{
            "clue_id": "clue-public-1", "player_safe_summary": "公开摘要",
        }]}]},
        applied_events=[],
    )
    assert envelope["approved_reveals"] == {
        "clue_ids": [], "clues": [], "must_include": [], "leads": [],
        "fallback_routes": [],
    }
    assert envelope["choice_frame"] == {}
    assert "PRE_GATE_SECRET" not in json.dumps(envelope, ensure_ascii=False)


def test_render_mode_and_horror_profile_are_strict_minimum_privilege_projection():
    plan = _good_plan()
    plan["narrative_directives"].update({
        "render_mode": "keeper-secret-mode",
        "horror_profile": {
            "dread": 0.5, "uncertainty": 0.5, "isolation": 0.5,
            "helplessness": 0.5, "body_horror": 0.5,
            "cosmic_scale": 0.5, "urgency": 0.5,
            "keeper_secret": "DO NOT LEAK",
        },
    })
    envelope = cnc.build_narration_envelope(plan)
    assert envelope["render_mode"] == "investigation"
    assert set(envelope["horror_profile"]) == {
        "dread", "uncertainty", "isolation", "helplessness",
        "body_horror", "cosmic_scale", "urgency",
    }
    assert all(value == 0.0 for value in envelope["horror_profile"].values())
    assert "DO NOT LEAK" not in json.dumps(envelope)


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), -0.1, 1.1, True, "0.5"])
def test_horror_profile_rejects_nonfinite_out_of_range_or_non_numeric_axis(bad):
    plan = _good_plan()
    profile = {axis: 0.5 for axis in (
        "dread", "uncertainty", "isolation", "helplessness",
        "body_horror", "cosmic_scale", "urgency",
    )}
    profile["dread"] = bad
    plan["narrative_directives"]["horror_profile"] = profile
    assert all(value == 0.0 for value in cnc.build_narration_envelope(plan)["horror_profile"].values())
