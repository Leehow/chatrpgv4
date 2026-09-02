"""Optional rules: declaration, confirmed house-rule toggles, runtime gates.

Product path under test: a ruleset declares its rulebook-optional rules; the
table confirms house-rule patches through ``coc_house_rules`` (the one store);
``coc_rule_options`` resolves the effective set; the RuleGraph runtime and the
development settlement read it. Nothing here asserts a literal rule list
beyond what the coc7 package manifest declares.
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
RULESET_DIR = ROOT / "plugins" / "coc-keeper" / "rulesets" / "coc7"


def _load(name: str, rel: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / rel)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_rule_options = _load("coc_rule_options_test", "coc_rule_options.py")
coc_house_rules = _load("coc_house_rules_test", "coc_house_rules.py")
coc_rules_runtime = _load("coc_rules_runtime_test_options", "coc_rules_runtime.py")

LUCK_SPEND_RULE = "rule:coc7:push-luck:luck-spend"
LUCK_SPEND_DECISION = "decision:coc7:push-luck:luck-spend"
LUCK_RECOVERY_RULE = "rule:coc7:development:luck-recovery"


def _patch(**overrides) -> dict:
    row = {
        "patch_id": "patch:no-luck-spend",
        "relation": "disables",
        "target": LUCK_SPEND_RULE,
        "layer": "house_rule",
        "scope": "campaign",
        "version": 1,
        "reason": "classic resource pressure",
        "statement": "no Luck spending",
    }
    row.update(overrides)
    return row


def _campaign(tmp_path: Path, name: str = "opt-1") -> Path:
    campaign = tmp_path / ".coc" / "campaigns" / name
    (campaign / "save").mkdir(parents=True)
    return campaign


def _confirm(campaign: Path, **overrides) -> dict:
    """Confirm a patch through the real propose/decide path."""
    body = _patch(**overrides)
    request = coc_house_rules.build_compile_request(
        campaign_id=campaign.name, source_text="we do not spend Luck", ruleset_dir=RULESET_DIR,
    )
    result = {
        "schema_version": coc_house_rules.SCHEMA_VERSION,
        "evaluator_id": coc_house_rules.EVALUATOR_ID,
        "evaluation_provenance": {
            "kind": coc_house_rules.PROVENANCE_KIND,
            "request_sha256": coc_house_rules.request_sha256(request),
            "reviewed_artifact": coc_house_rules.REQUEST_FILENAME,
        },
        "patch": {**body, "cases": [
            {"kind": "positive", "situation": "a failed skill roll",
             "without_patch": "Luck may be spent", "with_patch": "Luck may not be spent"},
            {"kind": "negative", "situation": "a Luck roll",
             "without_patch": "no spend", "with_patch": "no spend"},
            {"kind": "boundary", "situation": "another campaign",
             "without_patch": "unchanged", "with_patch": "unchanged"},
        ]},
    }
    coc_house_rules.propose_patch(campaign, request=request, result=result)
    return coc_house_rules.decide_patch(
        campaign, patch_id=body["patch_id"], version=body["version"], accept=True,
        decided_reason="confirmed in test",
    )


# -- declarations ---------------------------------------------------------- #

def test_coc7_declares_its_rulebook_optional_rules_with_explicit_defaults():
    declared = {row["option_id"]: row for row in coc_rule_options.declared_optional_rules("coc7")}
    assert {"luck-spend", "luck-recovery"} <= set(declared)
    for row in declared.values():
        assert isinstance(row["enabled_by_default"], bool)
        assert row["source_note"]
    assert "rules.luck_spend" in declared["luck-spend"]["operation_gates"]
    assert LUCK_SPEND_DECISION in declared["luck-spend"]["decision_refs"]
    assert "development.luck_recovery" in declared["luck-recovery"]["settlement_gates"]


def test_declared_refs_resolve_to_package_graph_nodes_and_to_the_patch_catalogue():
    graph = json.loads((RULESET_DIR / "rule-graph.json").read_text(encoding="utf-8"))
    kinds = {node["node_id"]: node["node_kind"] for node in graph["nodes"]}
    catalogue = {row["target_id"] for row in coc_house_rules.target_catalogue(RULESET_DIR)}
    for row in coc_rule_options.declared_optional_rules("coc7"):
        for ref in row["rule_refs"]:
            assert kinds.get(ref) == "rule" and ref in catalogue, ref
        for ref in row["decision_refs"]:
            assert kinds.get(ref) == "decision" and ref in catalogue, ref


# -- toggles from confirmed patches ---------------------------------------- #

def test_defaults_apply_when_nothing_is_confirmed():
    effective = coc_rule_options.effective_optional_rules("coc7", [])
    declared = {row["option_id"]: row for row in coc_rule_options.declared_optional_rules("coc7")}
    for option_id, status in effective.items():
        assert status["enabled"] is declared[option_id]["enabled_by_default"]
        assert status["decided_by"] == coc_rule_options.DEFAULT_LAYER


def test_a_confirmed_disables_patch_on_a_rule_or_decision_node_switches_the_option():
    for target in (LUCK_SPEND_RULE, LUCK_SPEND_DECISION):
        status = coc_rule_options.effective_optional_rules("coc7", [_patch(target=target)])
        assert status["luck-spend"]["enabled"] is False
        assert status["luck-spend"]["decided_by"] == "patch:no-luck-spend"
        assert status["luck-recovery"]["enabled"] is True


def test_house_rule_outranks_campaign_patch():
    patches = [
        _patch(patch_id="patch:campaign-luck-off", layer="campaign_patch", relation="disables"),
        _patch(patch_id="patch:house-luck-on", layer="house_rule", relation="enables"),
    ]
    status = coc_rule_options.effective_optional_rules("coc7", patches)["luck-spend"]
    assert status["enabled"] is True and status["decided_by"] == "patch:house-luck-on"


def test_two_disagreeing_toggles_at_one_layer_are_a_conflict_not_a_guess():
    patches = [
        _patch(patch_id="patch:luck-off", relation="disables"),
        _patch(patch_id="patch:luck-on", relation="enables"),
    ]
    status = coc_rule_options.effective_optional_rules("coc7", patches)["luck-spend"]
    assert status["conflict"] is True and status["enabled"] is None
    assert {row["patch_id"] for row in status["conflicting"]} == {"patch:luck-off", "patch:luck-on"}
    gates = coc_rule_options.disabled_decision_gates("coc7", status and {"luck-spend": status})
    assert gates[LUCK_SPEND_DECISION]["conflict"] is True
    assert coc_rule_options.gate_code(status) == "rule_conflict"


def test_agreeing_toggles_at_one_layer_do_not_conflict():
    patches = [
        _patch(patch_id="patch:luck-off-a", relation="disables"),
        _patch(patch_id="patch:luck-off-b", relation="disables"),
    ]
    status = coc_rule_options.effective_optional_rules("coc7", patches)["luck-spend"]
    assert status["enabled"] is False and status["decided_by"] == "patch:luck-off-a"


@pytest.mark.parametrize("override, reason", [
    ({"relation": "overrides"}, "relation_not_enforced"),
    ({"scope": "scene"}, "scope_not_enforced"),
    ({"layer": "session_ruling"}, "layer_cannot_toggle"),
    ({"target": "rule:coc7:push-luck:one-reroll"}, "target_not_an_optional_rule"),
])
def test_unenforceable_patches_are_reported_not_applied(override, reason):
    rows = coc_rule_options.toggles_from_patches("coc7", [_patch(**override)])
    assert rows[0]["applicable"] is False and rows[0]["inapplicable_reason"] == reason
    assert coc_rule_options.effective_optional_rules("coc7", [_patch(**override)])["luck-spend"]["enabled"] is True


def test_gates_map_disabled_options_to_decisions_operations_and_settlements():
    effective = coc_rule_options.effective_optional_rules("coc7", [
        _patch(), _patch(patch_id="patch:no-luck-recovery", target=LUCK_RECOVERY_RULE),
    ])
    gates = coc_rule_options.disabled_decision_gates("coc7", effective)
    assert gates[LUCK_SPEND_DECISION]["decided_by"] == "patch:no-luck-spend"
    assert coc_rule_options.gate_for("coc7", effective, operation="rules.luck_spend")["option_id"] == "luck-spend"
    assert coc_rule_options.gate_for("coc7", effective, settlement="development.luck_recovery")["option_id"] == "luck-recovery"
    assert coc_rule_options.gate_for("coc7", effective, operation="rules.roll") is None
    assert coc_rule_options.disabled_decision_gates(
        "coc7", coc_rule_options.effective_optional_rules("coc7", []),
    ) == {}


# -- the one store --------------------------------------------------------- #

def test_only_confirmed_patches_count_and_a_corrupt_store_fails_closed(tmp_path):
    campaign = _campaign(tmp_path)
    assert coc_rule_options.campaign_effective_optional_rules(campaign, "coc7")["luck-spend"]["enabled"] is True
    _confirm(campaign)
    assert coc_rule_options.campaign_effective_optional_rules(campaign, "coc7")["luck-spend"]["enabled"] is False
    # A proposed-but-undecided patch decides nothing.
    other = _campaign(tmp_path, "opt-2")
    request = coc_house_rules.build_compile_request(
        campaign_id=other.name, source_text="maybe", ruleset_dir=RULESET_DIR,
    )
    proposed = json.loads(json.dumps(coc_house_rules.load_document(campaign)["patches"][0]["patch"]))
    coc_house_rules.propose_patch(other, request=request, result={
        "schema_version": coc_house_rules.SCHEMA_VERSION,
        "evaluator_id": coc_house_rules.EVALUATOR_ID,
        "evaluation_provenance": {
            "kind": coc_house_rules.PROVENANCE_KIND,
            "request_sha256": coc_house_rules.request_sha256(request),
            "reviewed_artifact": coc_house_rules.REQUEST_FILENAME,
        },
        "patch": proposed,
    })
    assert coc_rule_options.campaign_effective_optional_rules(other, "coc7")["luck-spend"]["enabled"] is True
    coc_house_rules.document_path(campaign).write_text("{not json", encoding="utf-8")
    with pytest.raises(coc_rule_options.OptionalRuleError) as info:
        coc_rule_options.campaign_effective_optional_rules(campaign, "coc7")
    assert info.value.code == "house_rules_corrupt"


# -- RuleGraph runtime ----------------------------------------------------- #

def _packaged_runtime(gates: dict) -> "coc_rules_runtime.RulesRuntime":
    loaded = coc_rules_runtime.load_ruleset_graph("coc7")
    assert loaded["ok"], loaded
    return coc_rules_runtime.RulesRuntime(
        loaded["graph"],
        ruleset_id="coc7",
        graph_manifest=loaded["graph_manifest"],
        facts_provider=lambda: {"campaign.ruleset_id": "coc7"},
        optional_rules_provider=lambda: gates,
    )


def test_runtime_projects_a_disabled_card_as_not_applicable_and_names_the_patch():
    effective = coc_rule_options.effective_optional_rules("coc7", [_patch()])
    runtime = _packaged_runtime(coc_rule_options.disabled_decision_gates("coc7", effective))
    card = runtime._card(LUCK_SPEND_DECISION, {"campaign.ruleset_id": "coc7"})
    assert card["applicability"] == "not_applicable"
    assert card["disabled_by_optional_rule"]["decided_by"] == "patch:no-luck-spend"
    context = runtime.context({"family": "push-luck", "kind": "procedure"})
    assert all(c["decision_ref"] != LUCK_SPEND_DECISION for c in context["cards"])
    assert [row["decision_ref"] for row in context["disabled_by_optional_rules"]] == [LUCK_SPEND_DECISION]


def test_runtime_settle_refuses_a_disabled_decision_with_an_actionable_code():
    effective = coc_rule_options.effective_optional_rules("coc7", [_patch()])
    runtime = _packaged_runtime(coc_rule_options.disabled_decision_gates("coc7", effective))
    result = runtime.settle({"decision_ref": LUCK_SPEND_DECISION, "semantic_inputs": {}}, "luck-1")
    assert result["status"] == "optional_rule_disabled"
    assert result["failure"]["code"] == "optional_rule_disabled"
    assert "patch:no-luck-spend" in result["failure"]["message"]


def test_runtime_settle_refuses_a_conflicted_decision_as_rule_conflict():
    effective = coc_rule_options.effective_optional_rules("coc7", [
        _patch(patch_id="patch:luck-off", relation="disables"),
        _patch(patch_id="patch:luck-on", relation="enables"),
    ])
    runtime = _packaged_runtime(coc_rule_options.disabled_decision_gates("coc7", effective))
    result = runtime.settle({"decision_ref": LUCK_SPEND_DECISION, "semantic_inputs": {}}, "luck-2")
    assert result["status"] == "rule_conflict"
    assert result["failure"]["code"] == "rule_conflict"
    assert "patch:luck-off" in result["failure"]["message"]


def test_runtime_without_gates_keeps_the_card_applicable():
    runtime = _packaged_runtime({})
    card = runtime._card(LUCK_SPEND_DECISION, {"campaign.ruleset_id": "coc7"})
    assert "disabled_by_optional_rule" not in card


# -- development settlement ------------------------------------------------- #

coc_development = _load("coc_development_test_options", "coc_development.py")


def _development_campaign(tmp_path: Path, *, luck: int = 40) -> tuple[Path, str]:
    """Bare development fixture (same layout as tests/test_development.py)."""
    root = tmp_path / ".coc"
    camp = root / "campaigns" / "case-opt"
    (camp / "save" / "investigator-state").mkdir(parents=True)
    (camp / "logs").mkdir(parents=True)
    inv_id = "ada"
    inv_dir = root / "investigators" / inv_id
    inv_dir.mkdir(parents=True)
    (inv_dir / "character.json").write_text(json.dumps({
        "schema_version": 1, "id": inv_id, "name": "Ada",
        "characteristics": {"LUCK": luck, "POW": 50, "INT": 70},
        "derived": {"HP": 11, "MP": 10, "SAN": 50, "Luck": luck},
        "skills": {"Spot Hidden": 45},
    }), encoding="utf-8")
    (inv_dir / "development.jsonl").write_text("", encoding="utf-8")
    (camp / "save" / "investigator-state" / f"{inv_id}.json").write_text(json.dumps({
        "schema_version": 1, "campaign_id": "case-opt", "investigator_id": inv_id,
        "current_luck": luck, "current_san": 50, "current_hp": 11, "current_mp": 10,
        "conditions": [], "skill_checks_earned": [],
    }), encoding="utf-8")
    (camp / "save" / "pacing-state.json").write_text(json.dumps({
        "schema_version": 1, "campaign_id": "case-opt", "luck_spent_last": 0,
        "tension_level": "low", "turn_number": 0,
    }), encoding="utf-8")
    return camp, inv_id


def _ending(ending_id: str, inv_id: str) -> dict:
    return {
        "event_type": "session_ending", "ending_id": ending_id, "scene_id": "finale",
        "kind": "cliffhanger", "decision_id": ending_id, "investigator_ids": [inv_id],
        "ts": "2026-09-02T00:00:00Z",
    }


def test_disabled_luck_recovery_freezes_a_recorded_skip_and_leaves_luck_untouched(tmp_path):
    camp, inv_id = _development_campaign(tmp_path, luck=40)
    _confirm(camp, patch_id="patch:no-luck-recovery", target=LUCK_RECOVERY_RULE)
    capsule = coc_development.build_ending_settlement_capsule(camp, _ending("ending-off", inv_id))
    plan = capsule["development_inputs"][inv_id]["deterministic_plan"]
    assert plan["luck_recovery"]["skipped"] is True
    assert plan["luck_recovery"]["reason"] == "optional_rule_disabled"
    assert plan["luck_recovery"]["decided_by"] == "patch:no-luck-recovery"
    assert "roll" not in plan["luck_recovery"]
    result = coc_development.run_development_phase(
        camp, inv_id, ending_evidence=capsule,
        development_input=capsule["development_inputs"][inv_id],
    )
    assert result["luck_recovery"]["skipped"] is True
    assert result["luck_recovery"]["applied_delta"] == 0
    state = json.loads(
        (camp / "save" / "investigator-state" / f"{inv_id}.json").read_text(encoding="utf-8")
    )
    assert state["current_luck"] == 40


def test_enabled_luck_recovery_still_rolls(tmp_path):
    camp, inv_id = _development_campaign(tmp_path, luck=40)
    capsule = coc_development.build_ending_settlement_capsule(camp, _ending("ending-on", inv_id))
    plan = capsule["development_inputs"][inv_id]["deterministic_plan"]
    assert 1 <= plan["luck_recovery"]["roll"] <= 100
    assert "skipped" not in plan["luck_recovery"]


def test_a_patch_confirmed_after_the_capsule_froze_does_not_rewrite_the_plan(tmp_path):
    camp, inv_id = _development_campaign(tmp_path, luck=40)
    capsule = coc_development.build_ending_settlement_capsule(camp, _ending("ending-late", inv_id))
    _confirm(camp, patch_id="patch:late-recovery-off", target=LUCK_RECOVERY_RULE)
    result = coc_development.run_development_phase(
        camp, inv_id, ending_evidence=capsule,
        development_input=capsule["development_inputs"][inv_id],
    )
    assert "skipped" not in result["luck_recovery"]
    frozen = capsule["development_inputs"][inv_id]["deterministic_plan"]["luck_recovery"]
    assert result["luck_recovery"]["roll"] == frozen["roll"]


def test_conflicting_luck_recovery_patches_refuse_to_freeze_an_ending(tmp_path):
    camp, inv_id = _development_campaign(tmp_path, luck=40)
    _confirm(camp, patch_id="patch:recovery-off", target=LUCK_RECOVERY_RULE, relation="disables")
    _confirm(camp, patch_id="patch:recovery-on", target=LUCK_RECOVERY_RULE, relation="enables")
    with pytest.raises(ValueError, match="conflicting confirmed patches"):
        coc_development.build_ending_settlement_capsule(camp, _ending("ending-conflict", inv_id))
