"""Optional rules, rule patches, and their runtime gates.

Product path under test: a ruleset declares its rulebook-optional rules; a
campaign records house rules / session rulings as patches; the RuleGraph
runtime, the Luck spend operation and the development settlement read the
effective set. Nothing here asserts a literal rule list beyond what the coc7
package manifest declares.
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"


def _load(name: str, rel: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / rel)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_rule_options = _load("coc_rule_options_test", "coc_rule_options.py")
coc_rules_runtime = _load("coc_rules_runtime_test_options", "coc_rules_runtime.py")


def _patch(**overrides) -> dict:
    row = {
        "patch_id": "house:no-luck-spend",
        "layer": "house_rule",
        "scope": "campaign",
        "operation": "DISABLES",
        "target": "luck-spend",
        "reason": "classic resource pressure",
    }
    row.update(overrides)
    return row


def _campaign(tmp_path: Path) -> Path:
    campaign = tmp_path / ".coc" / "campaigns" / "opt-1"
    (campaign / "save").mkdir(parents=True)
    return campaign


# -- declarations ---------------------------------------------------------- #

def test_coc7_declares_its_rulebook_optional_rules_with_explicit_defaults():
    declared = {row["option_id"]: row for row in coc_rule_options.declared_optional_rules("coc7")}
    assert {"luck-spend", "luck-recovery"} <= set(declared)
    for row in declared.values():
        # The package profile is explicit, never inferred from a table flag.
        assert isinstance(row["enabled_by_default"], bool)
        assert row["source_note"]
    assert "rules.luck_spend" in declared["luck-spend"]["operation_gates"]
    assert "decision:coc7:push-luck:luck-spend" in declared["luck-spend"]["decision_refs"]
    assert "development.luck_recovery" in declared["luck-recovery"]["settlement_gates"]


def test_declared_refs_resolve_to_package_graph_nodes():
    graph = json.loads(
        (ROOT / "plugins/coc-keeper/rulesets/coc7/rule-graph.json").read_text(encoding="utf-8")
    )
    kinds = {node["node_id"]: node["node_kind"] for node in graph["nodes"]}
    for row in coc_rule_options.declared_optional_rules("coc7"):
        for ref in row["rule_refs"]:
            assert kinds.get(ref) == "rule", ref
        for ref in row["decision_refs"]:
            assert kinds.get(ref) == "decision", ref


# -- patches --------------------------------------------------------------- #

def test_patch_can_only_target_a_declared_option():
    with pytest.raises(coc_rule_options.RulePatchError) as info:
        coc_rule_options.normalize_patch(_patch(target="free-rerolls"), "coc7")
    assert info.value.code == "unknown_optional_rule"
    assert "luck-spend" in info.value.details["declared"]


@pytest.mark.parametrize("field, value, code", [
    ("layer", "core", "invalid_param"),
    ("operation", "OVERRIDES", "invalid_param"),
    ("scope", "chapter:1", "invalid_param"),
    ("patch_id", "House Rule 1", "invalid_param"),
    ("reason", "  ", "missing_param"),
])
def test_patch_shape_is_validated_fail_closed(field, value, code):
    with pytest.raises(coc_rule_options.RulePatchError) as info:
        coc_rule_options.normalize_patch(_patch(**{field: value}), "coc7")
    assert info.value.code == code


def test_record_is_idempotent_by_patch_id_and_conflicts_on_different_content(tmp_path):
    campaign = _campaign(tmp_path)
    doc, status = coc_rule_options.record_rule_patch(
        campaign, "coc7", _patch(), recorded_at="2026-09-02T00:00:00+00:00",
    )
    assert status == "recorded" and len(doc["patches"]) == 1
    assert coc_rule_options.rule_patches_path(campaign).is_file()
    doc, status = coc_rule_options.record_rule_patch(
        campaign, "coc7", _patch(), recorded_at="2026-09-02T00:00:01+00:00",
    )
    assert status == "duplicate" and len(doc["patches"]) == 1
    with pytest.raises(coc_rule_options.RulePatchError) as info:
        coc_rule_options.record_rule_patch(
            campaign, "coc7", _patch(operation="ENABLES"),
            recorded_at="2026-09-02T00:00:02+00:00",
        )
    assert info.value.code == "rule_patch_conflict"


def test_absent_patch_file_means_no_patches_but_a_corrupt_one_fails_closed(tmp_path):
    campaign = _campaign(tmp_path)
    assert coc_rule_options.load_rule_patches(campaign)["patches"] == []
    coc_rule_options.rule_patches_path(campaign).write_text(
        json.dumps({"schema_version": 1, "campaign_id": "other", "patches": []}),
        encoding="utf-8",
    )
    with pytest.raises(coc_rule_options.RulePatchError) as info:
        coc_rule_options.load_rule_patches(campaign)
    assert info.value.code == "rule_patches_corrupt"


# -- effective set --------------------------------------------------------- #

def test_defaults_apply_when_nothing_is_patched():
    effective = coc_rule_options.effective_optional_rules("coc7", [])
    declared = {row["option_id"]: row for row in coc_rule_options.declared_optional_rules("coc7")}
    for option_id, status in effective.items():
        assert status["enabled"] is declared[option_id]["enabled_by_default"]
        assert status["decided_by"] == coc_rule_options.DEFAULT_LAYER


def test_layer_precedence_session_ruling_beats_house_rule_beats_campaign_patch():
    patches = [
        _patch(patch_id="campaign:luck-off", layer="campaign_patch", operation="DISABLES"),
        _patch(patch_id="house:luck-on", layer="house_rule", operation="ENABLES"),
    ]
    status = coc_rule_options.effective_optional_rules("coc7", patches)["luck-spend"]
    assert status["enabled"] is True and status["decided_by"] == "house:luck-on"
    patches.append(_patch(patch_id="ruling:no-luck-now", layer="session_ruling",
                          operation="DISABLES"))
    status = coc_rule_options.effective_optional_rules("coc7", patches)["luck-spend"]
    assert status["enabled"] is False and status["decided_by"] == "ruling:no-luck-now"


def test_latest_patch_wins_inside_one_layer():
    patches = [
        _patch(patch_id="house:v1", operation="DISABLES"),
        _patch(patch_id="house:v2", operation="ENABLES"),
    ]
    status = coc_rule_options.effective_optional_rules("coc7", patches)["luck-spend"]
    assert status["enabled"] is True and status["decided_by"] == "house:v2"


def test_scene_scoped_ruling_applies_only_in_that_scene():
    patches = [_patch(patch_id="ruling:cellar", layer="session_ruling", scope="scene:cellar")]
    off = coc_rule_options.effective_optional_rules("coc7", patches, scene_id="cellar")
    on = coc_rule_options.effective_optional_rules("coc7", patches, scene_id="attic")
    none = coc_rule_options.effective_optional_rules("coc7", patches, scene_id=None)
    assert off["luck-spend"]["enabled"] is False
    assert on["luck-spend"]["enabled"] is True
    assert none["luck-spend"]["enabled"] is True


def test_gates_map_disabled_options_to_decisions_operations_and_settlements():
    effective = coc_rule_options.effective_optional_rules("coc7", [
        _patch(), _patch(patch_id="house:no-luck-recovery", target="luck-recovery"),
    ])
    gates = coc_rule_options.disabled_decision_gates("coc7", effective)
    assert gates["decision:coc7:push-luck:luck-spend"]["decided_by"] == "house:no-luck-spend"
    assert coc_rule_options.gate_for(
        "coc7", effective, operation="rules.luck_spend",
    )["option_id"] == "luck-spend"
    assert coc_rule_options.gate_for(
        "coc7", effective, settlement="development.luck_recovery",
    )["option_id"] == "luck-recovery"
    assert coc_rule_options.gate_for("coc7", effective, operation="rules.roll") is None
    enabled = coc_rule_options.effective_optional_rules("coc7", [])
    assert coc_rule_options.disabled_decision_gates("coc7", enabled) == {}


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


def test_runtime_projects_a_disabled_card_as_not_applicable_and_names_the_ruling():
    effective = coc_rule_options.effective_optional_rules("coc7", [_patch()])
    runtime = _packaged_runtime(coc_rule_options.disabled_decision_gates("coc7", effective))
    card = runtime._card("decision:coc7:push-luck:luck-spend", {"campaign.ruleset_id": "coc7"})
    assert card["applicability"] == "not_applicable"
    assert card["disabled_by_optional_rule"]["decided_by"] == "house:no-luck-spend"
    context = runtime.context({"family": "push-luck", "kind": "procedure"})
    assert all(c["decision_ref"] != "decision:coc7:push-luck:luck-spend" for c in context["cards"])
    assert [row["decision_ref"] for row in context["disabled_by_optional_rules"]] == [
        "decision:coc7:push-luck:luck-spend"
    ]


def test_runtime_settle_refuses_a_disabled_decision_with_an_actionable_code():
    effective = coc_rule_options.effective_optional_rules("coc7", [_patch()])
    runtime = _packaged_runtime(coc_rule_options.disabled_decision_gates("coc7", effective))
    result = runtime.settle(
        {"decision_ref": "decision:coc7:push-luck:luck-spend", "semantic_inputs": {}},
        "luck-1",
    )
    assert result["status"] == "optional_rule_disabled"
    assert result["failure"]["code"] == "optional_rule_disabled"
    assert "house:no-luck-spend" in result["failure"]["message"]


def test_runtime_without_gates_keeps_the_card_applicable():
    runtime = _packaged_runtime({})
    card = runtime._card("decision:coc7:push-luck:luck-spend", {"campaign.ruleset_id": "coc7"})
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
    coc_rule_options.record_rule_patch(
        camp, "coc7", _patch(patch_id="house:no-luck-recovery", target="luck-recovery"),
        recorded_at="2026-09-02T00:00:00+00:00",
    )
    capsule = coc_development.build_ending_settlement_capsule(camp, _ending("ending-off", inv_id))
    plan = capsule["development_inputs"][inv_id]["deterministic_plan"]
    assert plan["luck_recovery"]["skipped"] is True
    assert plan["luck_recovery"]["reason"] == "optional_rule_disabled"
    assert plan["luck_recovery"]["decided_by"] == "house:no-luck-recovery"
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


def test_a_ruling_recorded_after_the_capsule_froze_does_not_rewrite_the_plan(tmp_path):
    camp, inv_id = _development_campaign(tmp_path, luck=40)
    capsule = coc_development.build_ending_settlement_capsule(camp, _ending("ending-late", inv_id))
    coc_rule_options.record_rule_patch(
        camp, "coc7", _patch(patch_id="house:late", target="luck-recovery"),
        recorded_at="2026-09-02T00:00:00+00:00",
    )
    result = coc_development.run_development_phase(
        camp, inv_id, ending_evidence=capsule,
        development_input=capsule["development_inputs"][inv_id],
    )
    assert "skipped" not in result["luck_recovery"]
    assert result["luck_recovery"]["roll"] == capsule["development_inputs"][inv_id]["deterministic_plan"]["luck_recovery"]["roll"]
