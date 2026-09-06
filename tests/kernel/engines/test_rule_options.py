"""Optional rules: declaration, confirmed house-rule toggles, gates. Ported
from the old tree's `tests/test_rule_options.py` (subject: `coc_rule_options.py`,
now `kernel/coc/rules/rule_options.py`).

API change from the port: every function that used to take a `ruleset_id`
string (e.g. `"coc7"`) and look the package manifest up through a ruleset
registry now takes the manifest `dict` directly (`declared_optional_rules`,
`effective_optional_rules`, `toggles_from_patches`, `disabled_decision_gates`,
`gate_for`) -- the registry lookup moved to the caller (`runtime.py` passes
`engine.package_manifest`). Here the manifest is loaded straight from
`content/rulesets/coc7/manifest.json`.

Dropped (subject deleted):
- `test_declared_refs_resolve_to_package_graph_nodes_and_to_the_patch_catalogue`
  -- needs `coc_house_rules.target_catalogue()`; there is no house-rules patch
  catalogue in the port (see below).
- The whole "RuleGraph runtime" section
  (`test_runtime_projects_a_disabled_card_as_not_applicable_and_names_the_patch`,
  `test_runtime_settle_refuses_a_disabled_decision_with_an_actionable_code`,
  `test_runtime_settle_refuses_a_conflicted_decision_as_rule_conflict`,
  `test_runtime_without_gates_keeps_the_card_applicable`) -- exercised
  `coc_rules_runtime.RulesRuntime` / `load_ruleset_graph`, the old MCP-era
  RuleGraph dispatch layer that the RPC-seam kernel replaced; that path is
  covered instead by `tests/kernel/test_rules_families.py`.
- The whole "development settlement" section (luck-recovery gating through
  `coc_development.build_ending_settlement_capsule` /
  `run_development_phase`) -- both depend on `coc_house_rules`'s
  propose/confirm store (not ported: "the kernel has no house-rules store yet")
  *and* on the old development.py's transaction/capsule/investigator-state
  shape, which `kernel/coc/rules/development.py` does not carry (see
  `tests/kernel/engines/test_development.py`'s module docstring for the
  detailed diff). Whether the ported `development.py` still consults
  `rule_options` for the luck-recovery gate is for the development engine's
  own test file to answer, not this one.

`test_only_confirmed_patches_count_and_a_corrupt_store_fails_closed` is kept,
adapted to seed `save/house-rules.json` directly (a plain `{"patches": [...]}`
file) instead of going through the deleted propose/decide workflow -- this
matches the module docstring: "patches are read from
`<campaign>/save/house-rules.json` ... when that file exists."
"""

from __future__ import annotations

import json
import sys

import pytest
from conftest import CONTENT_DIR, KERNEL_DIR

sys.path.insert(0, str(KERNEL_DIR))

from coc.rules import rule_options  # noqa: E402

LUCK_SPEND_RULE = "rule:coc7:push-luck:luck-spend"
LUCK_SPEND_DECISION = "decision:coc7:push-luck:luck-spend"
LUCK_RECOVERY_RULE = "rule:coc7:development:luck-recovery"


@pytest.fixture(scope="module")
def manifest() -> dict:
    path = CONTENT_DIR / "rulesets" / "coc7" / "manifest.json"
    return json.loads(path.read_text(encoding="utf-8"))


def _patch(**overrides) -> dict:
    row = {
        "patch_id": "patch:no-luck-spend", "relation": "disables", "target": LUCK_SPEND_RULE,
        "layer": "house_rule", "scope": "campaign", "version": 1,
        "reason": "classic resource pressure", "statement": "no Luck spending",
    }
    row.update(overrides)
    return row


def _campaign(tmp_path, name: str = "opt-1"):
    campaign = tmp_path / ".coc" / "campaigns" / name
    (campaign / "save").mkdir(parents=True)
    return campaign


def _write_house_rules(campaign_dir, patches: list[dict]) -> None:
    (campaign_dir / "save" / "house-rules.json").write_text(
        json.dumps({"patches": patches}), encoding="utf-8")


# -- declarations ---------------------------------------------------------- #

def test_coc7_declares_its_rulebook_optional_rules_with_explicit_defaults(manifest):
    declared = {row["option_id"]: row for row in rule_options.declared_optional_rules(manifest)}
    assert {"luck-spend", "luck-recovery"} <= set(declared)
    for row in declared.values():
        assert isinstance(row["enabled_by_default"], bool)
        assert row["source_note"]
    assert "rules.luck_spend" in declared["luck-spend"]["operation_gates"]
    assert LUCK_SPEND_DECISION in declared["luck-spend"]["decision_refs"]
    assert "development.luck_recovery" in declared["luck-recovery"]["settlement_gates"]


# -- toggles from confirmed patches ---------------------------------------- #

def test_defaults_apply_when_nothing_is_confirmed(manifest):
    effective = rule_options.effective_optional_rules(manifest, [])
    declared = {row["option_id"]: row for row in rule_options.declared_optional_rules(manifest)}
    for option_id, status in effective.items():
        assert status["enabled"] is declared[option_id]["enabled_by_default"]
        assert status["decided_by"] == rule_options.DEFAULT_LAYER


def test_a_confirmed_disables_patch_on_a_rule_or_decision_node_switches_the_option(manifest):
    for target in (LUCK_SPEND_RULE, LUCK_SPEND_DECISION):
        status = rule_options.effective_optional_rules(manifest, [_patch(target=target)])
        assert status["luck-spend"]["enabled"] is False
        assert status["luck-spend"]["decided_by"] == "patch:no-luck-spend"
        assert status["luck-recovery"]["enabled"] is True


def test_house_rule_outranks_campaign_patch(manifest):
    patches = [
        _patch(patch_id="patch:campaign-luck-off", layer="campaign_patch", relation="disables"),
        _patch(patch_id="patch:house-luck-on", layer="house_rule", relation="enables"),
    ]
    status = rule_options.effective_optional_rules(manifest, patches)["luck-spend"]
    assert status["enabled"] is True and status["decided_by"] == "patch:house-luck-on"


def test_two_disagreeing_toggles_at_one_layer_are_a_conflict_not_a_guess(manifest):
    patches = [
        _patch(patch_id="patch:luck-off", relation="disables"),
        _patch(patch_id="patch:luck-on", relation="enables"),
    ]
    status = rule_options.effective_optional_rules(manifest, patches)["luck-spend"]
    assert status["conflict"] is True and status["enabled"] is None
    assert {row["patch_id"] for row in status["conflicting"]} == {"patch:luck-off", "patch:luck-on"}
    gates = rule_options.disabled_decision_gates(manifest, {"luck-spend": status})
    assert gates[LUCK_SPEND_DECISION]["conflict"] is True
    assert rule_options.gate_code(status) == "rule_conflict"


def test_agreeing_toggles_at_one_layer_do_not_conflict(manifest):
    patches = [
        _patch(patch_id="patch:luck-off-a", relation="disables"),
        _patch(patch_id="patch:luck-off-b", relation="disables"),
    ]
    status = rule_options.effective_optional_rules(manifest, patches)["luck-spend"]
    assert status["enabled"] is False and status["decided_by"] == "patch:luck-off-a"


@pytest.mark.parametrize("override, reason", [
    ({"relation": "overrides"}, "relation_not_enforced"),
    ({"scope": "scene"}, "scope_not_enforced"),
    ({"layer": "session_ruling"}, "layer_cannot_toggle"),
    ({"target": "rule:coc7:push-luck:one-reroll"}, "target_not_an_optional_rule"),
])
def test_unenforceable_patches_are_reported_not_applied(manifest, override, reason):
    rows = rule_options.toggles_from_patches(manifest, [_patch(**override)])
    assert rows[0]["applicable"] is False and rows[0]["inapplicable_reason"] == reason
    assert rule_options.effective_optional_rules(manifest, [_patch(**override)])["luck-spend"]["enabled"] is True


def test_gates_map_disabled_options_to_decisions_operations_and_settlements(manifest):
    effective = rule_options.effective_optional_rules(manifest, [
        _patch(), _patch(patch_id="patch:no-luck-recovery", target=LUCK_RECOVERY_RULE),
    ])
    gates = rule_options.disabled_decision_gates(manifest, effective)
    assert gates[LUCK_SPEND_DECISION]["decided_by"] == "patch:no-luck-spend"
    assert rule_options.gate_for(manifest, effective, operation="rules.luck_spend")["option_id"] == "luck-spend"
    assert rule_options.gate_for(manifest, effective, settlement="development.luck_recovery")["option_id"] == "luck-recovery"
    assert rule_options.gate_for(manifest, effective, operation="rules.roll") is None
    assert rule_options.disabled_decision_gates(
        manifest, rule_options.effective_optional_rules(manifest, []),
    ) == {}


# -- the campaign store (save/house-rules.json) ----------------------------- #

def test_only_confirmed_patches_count_and_a_corrupt_store_fails_closed(tmp_path, manifest):
    campaign = _campaign(tmp_path)
    assert rule_options.campaign_effective_optional_rules(campaign, manifest)["luck-spend"]["enabled"] is True
    _write_house_rules(campaign, [_patch()])
    assert rule_options.campaign_effective_optional_rules(campaign, manifest)["luck-spend"]["enabled"] is False

    # A store with no confirmed patches at all decides nothing.
    other = _campaign(tmp_path, "opt-2")
    _write_house_rules(other, [])
    assert rule_options.campaign_effective_optional_rules(other, manifest)["luck-spend"]["enabled"] is True

    (campaign / "save" / "house-rules.json").write_text("{not json", encoding="utf-8")
    with pytest.raises(rule_options.OptionalRuleError) as info:
        rule_options.campaign_effective_optional_rules(campaign, manifest)
    assert info.value.code == "house_rules_corrupt"


def test_absent_store_means_every_option_keeps_its_default(tmp_path, manifest):
    """Module docstring: "absent means every option keeps its ruleset default"."""
    campaign = _campaign(tmp_path, "opt-absent")
    assert not (campaign / "save" / "house-rules.json").exists()
    effective = rule_options.campaign_effective_optional_rules(campaign, manifest)
    assert effective["luck-spend"]["decided_by"] == rule_options.DEFAULT_LAYER
    assert effective["luck-recovery"]["decided_by"] == rule_options.DEFAULT_LAYER
