"""§14.7 chargen: every number from the rules tables, the same seed the same sheet.

The arithmetic cases are the old tree's `tests/test_character.py` rulebook cases; the
allocation and accounting cases pin the deterministic defaults 14.12 declares."""

from __future__ import annotations

import json
import random
import sys
from pathlib import Path

import pytest
from conftest import CAMPAIGN, CONTENT_DIR, KERNEL_DIR, campaign_dir, read_json

sys.path.insert(0, str(KERNEL_DIR))

from coc.chargen import Chargen, ChargenError, default_investigator_id, evaluate_formula, parse_formula  # noqa: E402
from coc.rules import RuleTables  # noqa: E402

RULES = CONTENT_DIR / "rulesets" / "coc7" / "rules-json"
STEPS = json.loads((CONTENT_DIR / "setup" / "steps.json").read_text(encoding="utf-8"))
POLICY = next(s for s in STEPS["steps"] if s["id"] == "create-investigator")
BASE = {"STR": 60, "CON": 50, "SIZ": 70, "DEX": 55, "APP": 45, "INT": 65, "POW": 60, "EDU": 70}


@pytest.fixture(scope="module")
def chargen() -> Chargen:
    return Chargen(RuleTables(RULES), POLICY)


def build(chargen: Chargen, **overrides):
    params = dict(investigator_id="ada", name="Ada", occupation_id="Private Investigator", concept=None,
                  age=27, sex=None, method="quick_fire", seed="7", era="1920s")
    params.update(overrides)
    return chargen.build(**params)


# ---- derived values: the rulebook cases ------------------------------------------------

def test_derive_values_match_the_rulebook_cases(chargen):
    derived = chargen.derive(BASE, 45, 0)["values"]
    assert derived == {"HP": 12, "SAN": 60, "MP": 12, "MOV": 7, "DB": "+1D4", "BUILD": 1}


def test_movement_rate_applies_the_age_penalty(chargen):
    fast = {**BASE, "STR": 80, "SIZ": 65, "DEX": 75}
    assert chargen.derive(fast, 50, 0)["values"]["MOV"] == 9
    assert chargen.derive(fast, 50, 1)["values"]["MOV"] == 8


def test_every_derived_number_names_its_table(chargen):
    trace = chargen.derive(BASE, 45, 0)["trace"]
    assert trace["HP"].startswith("derived-attributes.hit_points")
    assert trace["MP"].startswith("derived-attributes.magic_points")
    assert trace["SAN"].startswith("derived-attributes.sanity")
    assert trace["DB"].startswith("damage-bonus-build") and trace["BUILD"].startswith("damage-bonus-build")
    assert trace["MOV"].startswith("movement-rate")


# ---- age --------------------------------------------------------------------------------

def test_age_bracket_20_39_only_runs_one_edu_check(chargen):
    aged = chargen.apply_age(dict(BASE), 32, random.Random("x"))
    trace = aged["trace"]
    assert trace["bracket"] == "20-39"
    assert trace["edu_reduction"] == 0 and trace["app_reduction"] == 0
    assert trace["characteristic_reductions"] == []
    assert len(trace["edu_improvement_checks"]) == 1
    check = trace["edu_improvement_checks"][0]
    if check["roll"] > check["edu"]:
        assert 1 <= check["improvement"] <= 10
        assert aged["values"]["EDU"] == min(99, BASE["EDU"] + check["improvement"])
    else:
        assert aged["values"]["EDU"] == BASE["EDU"]
    assert trace["mov_penalty"] == 0 and trace["luck_rolls_keep_highest"] == 1


def test_age_bracket_40_49_spreads_the_reduction_over_the_listed_choices(chargen):
    aged = chargen.apply_age(dict(BASE), 47, random.Random("x"))
    trace = aged["trace"]
    assert trace["bracket"] == "40-49"
    assert aged["values"]["APP"] == BASE["APP"] - 5
    assert [r["characteristic"] for r in trace["characteristic_reductions"]] == ["STR", "CON", "DEX"]
    assert sum(r["amount"] for r in trace["characteristic_reductions"]) == 5
    assert aged["values"]["STR"] + aged["values"]["CON"] + aged["values"]["DEX"] == BASE["STR"] + BASE["CON"] + BASE["DEX"] - 5
    assert len(trace["edu_improvement_checks"]) == 2
    assert trace["mov_penalty"] == 1


def test_teens_lose_edu_and_roll_luck_twice(chargen):
    aged = chargen.apply_age(dict(BASE), 17, random.Random("x"))
    assert aged["values"]["EDU"] == BASE["EDU"] - 5
    assert aged["trace"]["luck_rolls_keep_highest"] == 2
    luck = chargen.luck(random.Random("x"), 2)
    assert len(luck["attempts"]) == 2
    assert luck["value"] == max(a["total"] for a in luck["attempts"]) * 5


def test_age_outside_the_table_is_refused(chargen):
    with pytest.raises(ChargenError) as excinfo:
        chargen.age_bracket(14)
    assert excinfo.value.stage == "age"
    with pytest.raises(ChargenError):
        chargen.age_bracket(90)


# ---- characteristics --------------------------------------------------------------------

def test_quick_fire_uses_the_data_array_and_leads_with_the_formula(chargen):
    array = json.loads((RULES / "characteristic-dice.json").read_text())["generation_methods"]["quick_fire_array"]["array"]
    sheet, _ = build(chargen, occupation_id="Antiquarian")  # EDU*4
    generated = sheet["creation"]["characteristics"]
    assert generated["array"] == array
    assert generated["assignment_order"][0] == "EDU"
    assert sorted(generated["values"].values()) == sorted(array)
    assert generated["values"]["EDU"] == array[0]


def test_rolled_uses_each_characteristic_dice_times_the_multiplier(chargen):
    sheet, _ = build(chargen, method="rolled", seed="rolled-1")
    rolls = sheet["creation"]["characteristics"]["rolls"]
    dice = json.loads((RULES / "characteristic-dice.json").read_text())["characteristics"]
    for abbr, roll in rolls.items():
        assert roll["dice"] == dice[abbr]["dice"].upper()
        assert roll["total"] == sum(roll["faces"]) + (6 if roll["dice"].endswith("+6") else 0)
        assert sheet["creation"]["characteristics"]["values"][abbr] == roll["total"] * 5


def test_same_seed_same_sheet_different_seed_different_rolls(chargen):
    one, _ = build(chargen, method="rolled", seed="s1")
    two, _ = build(chargen, method="rolled", seed="s1")
    three, _ = build(chargen, method="rolled", seed="s2")
    assert one == two
    assert three["characteristics"] != one["characteristics"]


# ---- formulas ---------------------------------------------------------------------------

def test_formula_parser_takes_the_richest_alternative_and_says_which():
    parsed = parse_formula("EDU*2+either APP*2, DEX*2 or STR*2")
    assert parsed["base"] == [("EDU", 2)] and len(parsed["alternatives"]) == 3
    value = evaluate_formula(parsed, {"EDU": 60, "APP": 50, "DEX": 70, "STR": 40})
    assert value["total"] == 120 + 140 and value["alternative"] == ["DEX*2"]
    plain = evaluate_formula(parse_formula("EDU*4"), {"EDU": 65})
    assert plain["total"] == 260 and plain["alternative"] is None
    with pytest.raises(ChargenError):
        parse_formula("four times education")


# ---- skills -----------------------------------------------------------------------------

def test_occupation_points_follow_the_formula_and_credit_rating_the_range(chargen):
    occupations = json.loads((RULES / "occupations.json").read_text())["occupations"]
    sheet, receipt = build(chargen, occupation_id="Private Investigator")
    occ = sheet["creation"]["skills"]["occupation"]
    spec = occupations["Private Investigator"]
    chars = sheet["characteristics"]
    expected = evaluate_formula(parse_formula(spec["skill_point_formula"]), chars)["total"]
    assert occ["budget"]["total"] == expected
    assert sheet["credit_rating"] == spec["credit_rating_range"][0] == sheet["skills"]["Credit Rating"]
    assert occ["points"] == expected - sheet["credit_rating"]
    assert occ["spent"] + occ["unspent"] == occ["points"]
    assert set(occ["allocations"]) <= set(occ["resolved"])
    # phrases that are not catalog names are returned untouched, never guessed
    assert "any one other skill" in occ["choices_pending"]
    assert receipt["choices_pending"] == occ["choices_pending"]


def test_spread_reserves_the_entries_it_cannot_name_instead_of_maxing_four_skills(chargen):
    """#21, the live case: a Military Officer's list is seven entries, three of them rulebook
    choices the kernel does not make. `fill` poured every point into the four it could
    name (75/75/75/75 and nothing else); `spread` walks all seven, tier by tier, and sets
    the choices' share aside for the table."""
    tiers = POLICY["allocation"]["tiers"]
    sheet, receipt = build(chargen, occupation_id="Military Officer")
    occ = sheet["creation"]["skills"]["occupation"]
    assert occ["allocation"] == "spread" == receipt["allocation"] == POLICY["allocation"]["default"]
    assert sheet["creation"]["allocation"] == {"policy": "spread", "tiers": tiers, "source": "steps.json create-investigator.allocation"}
    assert set(occ["allocations"]) == set(occ["resolved"]) and len(occ["resolved"]) == 4
    # the budget runs out inside the first tier: every named skill sits exactly at tiers[0]
    assert {sheet["skills"][s] for s in occ["resolved"]} == {tiers[0]}
    assert [r["for"] for r in occ["reserved"]] == occ["choices_pending"]
    assert all(0 < r["points"] <= tiers[0] for r in occ["reserved"])
    assert receipt["occupation_reserved"] == sum(r["points"] for r in occ["reserved"]) <= occ["unspent"]
    assert occ["spent"] + occ["unspent"] == occ["points"]

    filled, filled_receipt = build(chargen, occupation_id="Military Officer", allocation="fill")
    filled_occ = filled["creation"]["skills"]["occupation"]
    assert filled_occ["allocation"] == "fill" and filled["creation"]["allocation"]["policy"] == "fill"
    assert {filled["skills"][s] for s in filled_occ["resolved"]} == {chargen.cap}  # 75/75/75/75
    assert filled_occ["reserved"] == [] and filled_receipt["occupation_reserved"] == 0
    assert filled_occ["points"] == occ["points"]  # same formula, different landing


def test_spread_walks_the_list_tier_by_tier_and_the_tiers_come_from_the_table():
    values = {"A": 10, "B": 20, "C": 30}
    slots, resolved = ["A", "B", "any one other skill", "C"], {"A", "B", "C"}
    allocations, reserved = Chargen.spread(slots, resolved, 200, dict(values), 75, [50, 70])
    # tier 50: A+40 B+30 reserve 50 C+20 (140); tier 70: A+20 B+20 reserve+20 (200) — C never reaches 70
    assert allocations == {"A": 60, "B": 50, "C": 20}
    assert reserved == [{"for": "any one other skill", "points": 70}]
    assert sum(allocations.values()) + sum(r["points"] for r in reserved) == 200
    # other tiers, other landing: tier 40 takes 100, tier 60 takes 80, the last 20 start the cap pass
    allocations, reserved = Chargen.spread(slots, resolved, 200, dict(values), 75, [40, 60])
    assert allocations == {"A": 65, "B": 45, "C": 30} and reserved == [{"for": "any one other skill", "points": 60}]
    # no tiers: straight to the cap in the book's order (C gets the crumbs)
    allocations, reserved = Chargen.spread(slots, resolved, 200, dict(values), 75, [])
    assert allocations == {"A": 65, "B": 55, "C": 5} and reserved == [{"for": "any one other skill", "points": 75}]
    # a tier above the cap is the cap; a budget nobody can absorb stays unspent
    allocations, reserved = Chargen.spread(["A"], {"A"}, 500, dict(values), 75, [50, 90])
    assert allocations == {"A": 65} and reserved == []
    # fill (the old allocator) still round-robins the named skills and reserves nothing
    assert Chargen.allocate(["A", "B", "C"], 9, dict(values), 75) == {"A": 3, "B": 3, "C": 3}


def test_the_default_policy_is_read_from_the_table_and_unknown_policies_are_refused(chargen):
    swapped = Chargen(RuleTables(RULES), {**POLICY, "allocation": {**POLICY["allocation"], "default": "fill"}})
    sheet, _ = build(swapped, occupation_id="Military Officer")
    assert sheet["creation"]["allocation"]["policy"] == "fill" and sheet["creation"]["skills"]["occupation"]["reserved"] == []
    with pytest.raises(ChargenError) as refused:
        build(chargen, occupation_id="Military Officer", allocation="random")
    assert refused.value.stage == "allocation" and refused.value.expected["options"] == ["spread", "fill"]
    assert refused.value.expected["default"] == POLICY["allocation"]["default"]


def test_skill_values_are_base_plus_points_and_never_above_the_cap(chargen):
    sheet, _ = build(chargen, occupation_id="Journalist")
    skills = json.loads((RULES / "skills.json").read_text())
    cap = skills["guided_creation_policy"]["starting_skill_cap"]
    occ = sheet["creation"]["skills"]["occupation"]["allocations"]
    interest = sheet["creation"]["skills"]["interest"]["allocations"]
    for name, value in sheet["skills"].items():
        if name == "Credit Rating":
            continue
        base = skills["skills"][name]["base_chance"]
        if base == "half_DEX":
            base = sheet["characteristics"]["DEX"] // 2
        elif base == "EDU":
            base = sheet["characteristics"]["EDU"]  # Language (Own) may sit above the cap by rule
        points = occ.get(name, 0) + interest.get(name, 0)
        assert value == base + points
        assert points == 0 or value <= cap


def test_interest_points_are_int_times_two_over_the_standard_sheet(chargen):
    sheet, _ = build(chargen, occupation_id="Artist")
    interest = sheet["creation"]["skills"]["interest"]
    assert interest["budget"]["formula"] == POLICY["formulas"]["personal_interest_points"]
    assert interest["budget"]["total"] == sheet["characteristics"]["INT"] * 2
    standard = json.loads((RULES / "skills.json").read_text())["standard_sheet"]["1920s"]["default_skill_ids"]
    resolved = set(sheet["creation"]["skills"]["occupation"]["resolved"])
    assert set(interest["pool"]) == set(standard) - resolved - set(POLICY["interest_pool"]["exclude"])
    assert set(interest["allocations"]) <= set(interest["pool"])
    assert sheet["skills"]["Cthulhu Mythos"] == 0
    assert interest["spent"] + interest["unspent"] == interest["budget"]["total"]


def test_finance_comes_from_the_era_tier_or_is_declared_unavailable(chargen):
    sheet, receipt = build(chargen, occupation_id="Private Investigator")
    finance = sheet["finance"]
    assert finance["credit_rating"] == sheet["credit_rating"] and finance["period"] == "1920s"
    assert sheet["cash"] == f"{finance['cash']['amount']} {finance['cash']['currency']}"
    assert receipt["finance_available"] is True
    ww1, receipt = build(chargen, occupation_id="Soldier", era="ww1")
    assert ww1["finance"] is None and ww1["cash"] is None
    assert ww1["creation"]["finance"]["available"] is False and "ww1" in ww1["creation"]["finance"]["reason"]
    assert receipt["finance_available"] is False
    # no standard sheet for the era: the interest budget is declared unspent, not guessed
    assert ww1["creation"]["skills"]["standard_sheet"] is None
    assert ww1["creation"]["skills"]["interest"]["unspent"] == ww1["characteristics"]["INT"] * 2


def test_equipment_is_not_invented(chargen):
    sheet, _ = build(chargen)
    assert sheet["equipment"] == [] and sheet["weapons"] == []
    assert sheet["creation"]["equipment"]["source"] is None


def test_unknown_occupation_and_method_are_refused(chargen):
    with pytest.raises(ChargenError) as excinfo:
        build(chargen, occupation_id="war correspondent")
    assert excinfo.value.stage == "occupation" and "Journalist" in excinfo.value.expected["options"]
    with pytest.raises(ChargenError) as excinfo:
        build(chargen, method="point_buy")
    assert excinfo.value.stage == "method"


def test_sheet_has_the_pregen_shape(chargen):
    pregen = read_json(CONTENT_DIR / "starters" / "the-haunting" / "pregens" / "thomas-hayes" / "character.json")
    sheet, _ = build(chargen)
    for key in ("schema_version", "id", "name", "occupation", "era", "age", "sex", "characteristics", "derived",
                "skills", "weapons", "equipment", "backstory", "credit_rating", "cash"):
        assert key in sheet, key
    assert set(sheet["characteristics"]) == set(pregen["characteristics"])
    assert set(sheet["derived"]) == set(pregen["derived"])


def test_default_investigator_id_slugs_latin_names_and_numbers_the_rest():
    assert default_investigator_id("Ada Lovelace", 1) == "ada-lovelace"
    assert default_investigator_id("托马斯·海斯", 2) == "inv-2"


# ---- through the kernel ---------------------------------------------------------------------

def test_kernel_sheets_are_reproducible_from_the_seed(kernel):
    for campaign_id in ("c1", "c2"):
        kernel.ok("campaign.create", {"id": campaign_id, "module": "the-haunting"})
        result = kernel.ok("setup.investigator", {"campaign": campaign_id, "name": "Ada", "occupation": "Journalist",
                                                  "method": "rolled", "seed": 42, "age": 35})
        assert result["receipt"] == "investigator:ada"
    one = read_json(campaign_dir(kernel.workspace, "c1") / "party" / "ada.json")
    two = read_json(campaign_dir(kernel.workspace, "c2") / "party" / "ada.json")
    assert one == two
    assert one["creation"]["seed"] == "42"
    assert (one["current_hp"], one["current_san"], one["current_mp"], one["current_luck"]) == (
        one["derived"]["HP"], one["derived"]["SAN"], one["derived"]["MP"], one["characteristics"]["LUCK"])


def test_kernel_defaults_come_from_the_steps_table(kernel):
    kernel.ok("campaign.create", {"id": CAMPAIGN, "module": "the-haunting"})
    result = kernel.ok("setup.investigator", {"campaign": CAMPAIGN, "name": "Ada", "occupation": "Antiquarian"})
    sheet = result["sheet"]
    assert sheet["age"] == POLICY["defaults"]["age"]
    assert sheet["creation"]["method"] == POLICY["defaults"]["method"]
    assert sheet["era"] == "1920s"  # the module node's era
