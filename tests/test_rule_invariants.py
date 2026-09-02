"""System invariants the rules kernel must hold, each as an executed check.

The table at the top is the declaration; every row has a test that drives
the real kernel or the real toolbox path and would fail if the invariant
broke. A row without a test is not an invariant, it is a wish. Source pages
are the Keeper Rulebook (7th edition) unless marked ``engineering``.
"""
from __future__ import annotations

import importlib.util
import json
import random
from pathlib import Path

import pytest

from toolbox_test_support import _run, campaign_ws  # noqa: F401  (fixture)

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"


def _load(name: str, rel: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / rel)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_roll = _load("coc_roll_inv", "coc_roll.py")
coc_rules = _load("coc_rules_inv", "coc_rules.py")
coc_sanity = _load("coc_sanity_inv", "coc_sanity.py")
coc_mythos = _load("coc_mythos_inv", "coc_mythos.py")
coc_development = _load("coc_development_inv", "coc_development.py")
coc_rule_options = _load("coc_rule_options_inv", "coc_rule_options.py")
coc_rulesets = _load("coc_rulesets_inv", "coc_rulesets.py")
resolver = coc_rulesets.get_resolver(None)

INVARIANTS = {
    "hp-never-negative": "HP is recorded as 0, never below (p.120 zero hit points)",
    "san-capped-by-mythos": "current SAN never exceeds 99 - Cthulhu Mythos (p.166)",
    "combat-roll-not-pushable": "combat skill rolls cannot be pushed (p.116)",
    "opposed-roll-not-pushable": "an opposed contest is not a pushable check (p.86)",
    "net-dice-capped-at-two": "after cancellation at most two bonus or penalty dice (p.91)",
    "luck-cannot-buy-fumble-or-pushed": "Luck never alters fumbles or pushed rolls (p.99)",
    "no-san-loss-during-bout": "no further SAN loss while a bout of madness is active (p.157)",
    "same-inputs-same-settlement": "engineering: identical seed and inputs give identical results",
    "one-improvement-check-per-skill": "one improvement check per skill per development phase (p.94)",
    "optional-rule-defaults-are-explicit": "engineering: every declared optional rule states its default",
    "disabled-option-refuses-its-operation": "engineering: a disabled optional rule refuses its gated operation",
}


def test_every_declared_invariant_has_an_executed_check():
    checked = {
        name[len("test_inv__"):].replace("_", "-")
        for name in globals()
        if name.startswith("test_inv__")
    }
    assert checked == set(INVARIANTS)


def test_inv__hp_never_negative(campaign_ws):
    hit = _run(campaign_ws, "rules.damage", {
        "investigator": campaign_ws["investigator_id"],
        "amount": "999",
        "decision_id": "inv-hp-floor",
    })
    assert hit["ok"] is True, hit
    assert hit["data"]["hp_after"] == 0
    state = json.loads((
        campaign_ws["campaign_dir"] / "save" / "investigator-state"
        / f"{campaign_ws['investigator_id']}.json"
    ).read_text(encoding="utf-8"))
    assert state["current_hp"] == 0


def test_inv__san_capped_by_mythos():
    assert coc_rules.sanity_max_formula()["formula"] == "99 - cthulhu_mythos"
    state = {"cm_value": 0, "current_san": 99, "max_san": 99}
    coc_mythos.gain_mythos(state, is_first=True)
    assert state["max_san"] == coc_mythos.max_san_for(state["cm_value"])
    assert state["current_san"] <= state["max_san"]
    assert coc_mythos.max_san_for(23) == 76


@pytest.mark.parametrize("skill", ["Fighting (Brawl)", "Firearms (Handgun)", "Dodge"])
def test_inv__combat_roll_not_pushable(skill):
    verdict = resolver.push_policy("failure", False, skill=skill)
    assert verdict is not None and "cannot be pushed" in verdict


def test_inv__opposed_roll_not_pushable(campaign_ws):
    contest = _run(campaign_ws, "rules.opposed", {
        "contest_kind": "noncombat",
        "investigator": campaign_ws["investigator_id"],
        "skill": "Persuade",
        "target": 30,
        "opponent_value": 90,
        "decision_id": "inv-opposed",
        "seed": 7,
    })
    assert contest["ok"] is True, contest
    pushed = _run(campaign_ws, "rules.push", {
        "original_check_decision_id": "inv-opposed",
        "method_changed": "a new angle",
        "failure_consequence": "the witness walks out",
        "decision_id": "inv-opposed-push",
    })
    assert pushed["ok"] is False


def test_inv__net_dice_capped_at_two():
    cap = coc_rules.roll_modifiers_rule()["maximum_dice_per_roll"]
    assert cap == {"bonus": 2, "penalty": 2}
    bonus = coc_roll.percentile_check(50, bonus=5, rng=random.Random(11))
    assert bonus["bonus"] == 2 and len(bonus["tens_values"]) == 3
    penalty = coc_roll.percentile_check(50, penalty=4, rng=random.Random(11))
    assert penalty["penalty"] == 2 and len(penalty["tens_values"]) == 3
    mixed = coc_roll.percentile_check(50, bonus=5, penalty=2, rng=random.Random(11))
    assert (mixed["bonus"], mixed["penalty"]) == (2, 0)


def test_inv__luck_cannot_buy_fumble_or_pushed():
    fumble = coc_roll.resolve_percentile_roll(100, 60, "regular")
    with pytest.raises(ValueError):
        coc_roll.spend_luck({**fumble, "bonus": 0, "penalty": 0}, 1, 50)
    failed = coc_roll.resolve_percentile_roll(70, 60, "regular")
    with pytest.raises(ValueError):
        coc_roll.spend_luck({**failed, "bonus": 0, "penalty": 0, "pushed": True}, 10, 50)


def test_inv__no_san_loss_during_bout():
    session = coc_sanity.SanitySession("ada", san_max=60, int_value=60, rng=random.Random(3))
    session.bout_active = True
    event = session.sanity_check("horror", 1, "1D6", involuntary_kind="freeze")
    assert event["type"] == "sanity_check_skipped"
    assert session.san_current == 60


def test_inv__same_inputs_same_settlement():
    first = coc_roll.percentile_check(45, difficulty="hard", bonus=1, rng=random.Random(99))
    second = coc_roll.percentile_check(45, difficulty="hard", bonus=1, rng=random.Random(99))
    assert first == second
    plan_a = coc_development._deterministic_development_plan(
        skills={"Spot Hidden": 45, "Library Use": 60}, luck=40,
        sanity={"current": 50, "max": 99, "awfulness_caps": {}},
        seed_material="ending:inv", scenario_reward_expr="1D6",
    )
    plan_b = coc_development._deterministic_development_plan(
        skills={"Spot Hidden": 45, "Library Use": 60}, luck=40,
        sanity={"current": 50, "max": 99, "awfulness_caps": {}},
        seed_material="ending:inv", scenario_reward_expr="1D6",
    )
    assert plan_a == plan_b


def test_inv__one_improvement_check_per_skill(tmp_path):
    root = tmp_path / ".coc"
    camp = root / "campaigns" / "inv-dev"
    (camp / "save" / "investigator-state").mkdir(parents=True)
    (camp / "logs").mkdir(parents=True)
    inv_dir = root / "investigators" / "ada"
    inv_dir.mkdir(parents=True)
    (inv_dir / "character.json").write_text(json.dumps({
        "schema_version": 1, "id": "ada", "name": "Ada",
        "characteristics": {"LUCK": 40, "POW": 50, "INT": 70},
        "derived": {"HP": 11, "MP": 10, "SAN": 50, "Luck": 40},
        "skills": {"Spot Hidden": 45},
    }), encoding="utf-8")
    (inv_dir / "development.jsonl").write_text("", encoding="utf-8")
    result = {"skill": "Spot Hidden", "outcome": "regular_success", "success": True,
              "roll": 22, "target": 45, "kind": "skill_check"}
    for n in range(3):
        tick = coc_development.record_skill_tick(
            camp, "ada", "Spot Hidden", {**result, "roll": 20 + n},
            source_event_id=f"rules.roll:{n}", source_kind="rules.roll",
        )
        assert tick is not None
    ticks = [
        json.loads(line)
        for line in (inv_dir / "development.jsonl").read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert len([row for row in ticks if row.get("skill") == "Spot Hidden"]) == 3
    plan = coc_development._deterministic_development_plan(
        skills={"Spot Hidden": 45}, luck=40,
        sanity={"current": 50, "max": 99, "awfulness_caps": {}},
        seed_material="ending:inv-dev", scenario_reward_expr=None,
    )
    assert [row["skill"] for row in plan["improvement_checks"]] == ["Spot Hidden"]


def test_inv__optional_rule_defaults_are_explicit():
    declared = coc_rule_options.declared_optional_rules("coc7")
    assert declared
    for row in declared:
        assert isinstance(row["enabled_by_default"], bool)
        assert row["source_note"]
    effective = coc_rule_options.effective_optional_rules("coc7", [])
    assert set(effective) == {row["option_id"] for row in declared}


def test_inv__disabled_option_refuses_its_operation(campaign_ws):
    source = _run(campaign_ws, "rules.roll", {
        "investigator": campaign_ws["investigator_id"],
        "skill": "Library Use",
        "target": 50,
        "decision_id": "inv-luck-source",
        "seed": 88,
    })
    assert source["ok"] is True and source["data"]["passed"] is False
    ruling = _run(campaign_ws, "rules.patch", {
        "patch_id": "house:no-luck-spend",
        "layer": "house_rule",
        "operation": "DISABLES",
        "target": "luck-spend",
        "reason": "classic resource pressure",
    })
    assert ruling["ok"] is True, ruling
    spend = _run(campaign_ws, "rules.luck_spend", {
        "investigator": campaign_ws["investigator_id"],
        "points": 1,
        "source_roll_id": source["data"]["roll_id"],
        "decision_id": "inv-luck-refused",
    })
    assert spend["ok"] is False
    assert spend["error"]["code"] == "optional_rule_disabled"
