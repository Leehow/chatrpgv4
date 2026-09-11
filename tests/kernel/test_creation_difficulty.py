"""§33 creation difficulty: preset scaling, custom knobs, records, limits and validation.

Every case drives the TypeScript kernel over RPC. Seeded cases use the legacy
`setup.investigator` path (explicit seed); the draft cases pin the §23.4 limits block and
the pool-assignment permutation under scaling. Absent difficulty is today's card bit for bit."""

from __future__ import annotations

import json
import math

from conftest import CAMPAIGN, campaign_dir, read_json
from test_setup_drafts import profile

MODULE = "the-haunting"
PRESET = {"extreme": 0.5, "hard": 1, "normal": 2, "easy": 4}
POOL_3D6 = ["STR", "CON", "DEX", "APP", "POW"]
POOL_2D6_6 = ["SIZ", "INT", "EDU"]


def round5(value: float) -> int:
    return math.floor(value / 5 + 0.5) * 5


def scaled(total: int, m: float) -> int:
    """§33.2: dice×5×m, nearest multiple of 5 (ties up), clamped to the scaled creation bounds."""
    return scaled_value(total * 5, m)


def scaled_value(value: float, m: float) -> int:
    """§33.2 applied to an already-multiplied value (the quick-fire array entries)."""
    lo, hi = max(5, round5(15 * m)), max(5, round5(90 * m))
    return max(5, min(hi, max(lo, round5(value * m))))


def create(kernel, difficulty=None, campaign_id=CAMPAIGN):
    params = {"id": campaign_id, "module": MODULE, "play_language": "en"}
    if difficulty is not None:
        params["difficulty"] = difficulty
    return kernel.ok("campaign.create", params)["campaign"]


def investigator(kernel, campaign_id=CAMPAIGN, seed="11", method="rolled", occupation="Antiquarian"):
    return kernel.ok("setup.investigator", {"campaign": campaign_id, "name": "Ada", "occupation": occupation,
                                            "age": 27, "method": method, "seed": seed})["sheet"]


def preset(name):
    return {"mode": "preset", "preset": name}


# ---- absent means hard: today's card bit for bit -------------------------------------------


def test_absent_hard_and_empty_custom_are_bit_identical(kernel):
    create(kernel)
    create(kernel, preset("hard"), "c2")
    create(kernel, {"mode": "custom", "custom": {}}, "c3")
    plain, hard, empty = (investigator(kernel, cid) for cid in (CAMPAIGN, "c2", "c3"))
    assert "difficulty" not in plain["creation"]
    assert "difficulty" not in read_json(campaign_dir(kernel.workspace) / "campaign.json")
    assert hard["creation"]["difficulty"] == {"mode": "preset", "preset": "hard", "multiplier": 1, "custom": {}}
    assert empty["creation"]["difficulty"] == {"mode": "custom", "custom": {}}
    for card in (hard, empty):
        assert {**card["creation"], "difficulty": None} == {**plain["creation"], "difficulty": None}
        assert card["characteristics"] == plain["characteristics"]
        assert card["derived"] == plain["derived"] and card["skills"] == plain["skills"]


def test_same_seed_same_difficulty_same_card(kernel):
    create(kernel, preset("normal"))
    create(kernel, preset("normal"), "c2")
    first, second = investigator(kernel), investigator(kernel, "c2")
    assert second == first


# ---- presets: characteristics, luck, quick fire, cap (§33.2) --------------------------------


def test_preset_rolls_scale_by_the_multiplier(kernel):
    create(kernel, preset("hard"))
    baseline = investigator(kernel)
    for name in ("extreme", "normal", "easy"):
        create(kernel, preset(name), name)
        card = investigator(kernel, name)
        m = PRESET[name]
        generation = card["creation"]["characteristics"]
        assert generation["scaling"] == {"multiplier": m, "bounds": [max(5, round5(15 * m)), max(5, round5(90 * m))]}
        # the same seed rolls the same dice; only the scaling differs
        assert generation["rolls"] == baseline["creation"]["characteristics"]["rolls"]
        for abbr, roll in generation["rolls"].items():
            assert generation["values"][abbr] == scaled(roll["total"], m), abbr
        # age adjustments consume the stream by value (a scaled EDU draws different improvement rolls),
        # so luck is verified against its own attempts, not against the baseline campaign's
        luck = card["creation"]["luck"]
        assert luck["value"] == scaled(max(a["total"] for a in luck["attempts"]), m)
        assert luck["scaling"] == {"multiplier": m, "bounds": [max(5, round5(15 * m)), max(5, round5(90 * m))]}
        assert card["creation"]["skills"]["cap"]["value"] == round(75 * m)


def test_preset_scaling_rounds_ties_up(kernel):
    create(kernel, preset("extreme"))
    card = investigator(kernel)
    rolls = card["creation"]["characteristics"]["rolls"]
    odd = {abbr: roll for abbr, roll in rolls.items() if roll["total"] % 2 == 1}
    assert odd, "the seed must exercise the .5 tie"
    for abbr, roll in odd.items():
        raw = roll["total"] * 5 * 0.5
        assert raw % 5 == 2.5
        assert card["creation"]["characteristics"]["values"][abbr] == math.floor(raw / 5 + 0.5) * 5


def test_quick_fire_array_scales_identically(kernel):
    array = [80, 70, 60, 60, 50, 50, 50, 40]
    for name in ("extreme", "normal", "easy"):
        create(kernel, preset(name), name)
        card = investigator(kernel, name, method="quick_fire")
        generation = card["creation"]["characteristics"]
        m = PRESET[name]
        assert generation["array"] == array, "the rulebook source array is recorded unscaled"
        assert generation["values"] == dict(zip(generation["assignment_order"], [scaled_value(v, m) for v in array]))


# ---- budgets follow the scaled characteristics through the formulas --------------------------


def test_budgets_evaluate_on_scaled_characteristics_without_double_scaling(kernel):
    create(kernel, preset("normal"))  # Antiquarian is EDU*4; interest is INT*2
    card = investigator(kernel)
    skills = card["creation"]["skills"]
    assert skills["occupation"]["budget"]["total"] == card["characteristics"]["EDU"] * 4
    assert skills["interest"]["budget"]["total"] == card["characteristics"]["INT"] * 2
    assert "budget_adjusted" not in skills["occupation"] and "budget_adjusted" not in skills["interest"]
    credit = skills["occupation"]["credit_rating"]["value"]
    assert skills["occupation"]["points"] == skills["occupation"]["budget"]["total"] - credit


def test_scaled_cap_bounds_the_spread(kernel):
    create(kernel, preset("extreme"))
    card = investigator(kernel, occupation="Private Investigator")
    occupation = card["creation"]["skills"]["occupation"]
    assert occupation["spent"] + occupation["unspent"] == occupation["points"]
    bases = {name: card["skills"][name] - amount for name, amount in occupation["allocations"].items()}
    for name, amount in occupation["allocations"].items():
        assert bases[name] + amount <= 38  # round(75×0.5)


# ---- custom knobs (§33.3) --------------------------------------------------------------------


def test_custom_pool_dice_replacement_rolls_and_bounds_its_own_range(kernel):
    create(kernel, {"mode": "custom", "custom": {"characteristic_dice": {"3D6": "1D4+2"}}})
    card = investigator(kernel)
    generation = card["creation"]["characteristics"]
    assert generation["replaced_dice"] == {"3D6": "1D4+2"}
    for abbr in POOL_3D6:
        assert generation["rolls"][abbr]["dice"] == "1D4+2"
        assert generation["values"][abbr] in (15, 20, 25, 30)  # (1+2)×5 .. (1×4+2)×5
    for abbr in POOL_2D6_6:
        assert generation["rolls"][abbr]["dice"] == "2D6+6"
        assert 40 <= generation["values"][abbr] <= 90
    assert card["creation"]["difficulty"] == {"mode": "custom", "custom": {"characteristic_dice": {"3D6": "1D4+2"}}}


def test_custom_fixed_luck_rolls_nothing(kernel):
    create(kernel, {"mode": "custom", "custom": {"luck": {"fixed": 65}}})
    card = investigator(kernel)
    assert card["characteristics"]["LUCK"] == 65
    assert card["creation"]["luck"]["value"] == 65 and card["creation"]["luck"]["attempts"] == []
    assert card["creation"]["luck"]["fixed"] is True


def test_custom_luck_dice_replaces_the_roll(kernel):
    create(kernel, {"mode": "custom", "custom": {"luck": {"dice": "2D4"}}})
    card = investigator(kernel)
    luck = card["creation"]["luck"]
    assert luck["dice"] == "2D4" and all(2 <= a["total"] <= 8 for a in luck["attempts"])
    assert card["characteristics"]["LUCK"] == max(a["total"] for a in luck["attempts"]) * 5


def test_custom_budget_multiplier_and_fixed(kernel):
    create(kernel, {"mode": "custom", "custom": {"occupation_points": {"multiplier": 2}, "interest_points": {"fixed": 50}}})
    card = investigator(kernel)
    skills = card["creation"]["skills"]
    occupation, interest = skills["occupation"], skills["interest"]
    assert occupation["budget_adjusted"] == {"total": round(occupation["budget"]["total"] * 2), "multiplier": 2, "fixed": None}
    assert occupation["points"] == occupation["budget_adjusted"]["total"] - occupation["credit_rating"]["value"]
    assert occupation["spent"] + occupation["unspent"] == occupation["points"]
    assert interest["budget_adjusted"] == {"total": 50, "multiplier": None, "fixed": 50}
    assert interest["spent"] == 50


def test_custom_fixed_occupation_budget_ignores_the_formula(kernel):
    create(kernel, {"mode": "custom", "custom": {"occupation_points": {"fixed": 300}}})
    card = investigator(kernel)
    occupation = card["creation"]["skills"]["occupation"]
    assert occupation["budget"]["total"] == card["characteristics"]["EDU"] * 4  # the formula is still recorded
    assert occupation["points"] == 300 - occupation["credit_rating"]["value"]
    assert occupation["spent"] + occupation["unspent"] == occupation["points"]


def test_custom_skill_cap_replaces_75(kernel):
    create(kernel, {"mode": "custom", "custom": {"skill_cap": 60}})
    card = investigator(kernel)
    assert card["creation"]["skills"]["cap"] == {"value": 60, "source": "skills.guided_creation_policy.starting_skill_cap",
                                                 "difficulty": {"skill_cap": 60}}


# ---- validation (§33.1/§33.3) ------------------------------------------------------------------


def test_campaign_create_rejects_bad_difficulty_shapes(kernel):
    cases = [
        ({"mode": "preset", "preset": "impossible"}, "difficulty.preset"),
        ({"mode": "weird"}, "difficulty.mode"),
        ({"mode": "preset", "preset": "hard", "custom": {"skill_cap": 60}}, "difficulty.custom"),
        ({"mode": "preset", "preset": "hard", "multiplier": 2}, "difficulty.multiplier"),
        ({"mode": "preset", "preset": "hard", "fluff": 1}, "difficulty.fluff"),
        ({"mode": "custom", "preset": "hard"}, "difficulty.preset"),
        ({"mode": "custom", "custom": {"bogus": 1}}, "difficulty.custom.bogus"),
        ({"mode": "custom", "custom": {"characteristic_dice": {"3d6": "2D6"}}}, "difficulty.custom.characteristic_dice"),
        ({"mode": "custom", "custom": {"characteristic_dice": {"3D6": "3D7"}}}, "difficulty.custom.characteristic_dice"),
        ({"mode": "custom", "custom": {"luck": {"dice": "0D6"}}}, "difficulty.custom.luck.dice"),
        ({"mode": "custom", "custom": {"luck": {"fixed": 63}}}, "difficulty.custom.luck.fixed"),
        ({"mode": "custom", "custom": {"luck": {"dice": "2D6", "fixed": 50}}}, "difficulty.custom.luck"),
        ({"mode": "custom", "custom": {"occupation_points": {"multiplier": 0.1}}}, "difficulty.custom.occupation_points.multiplier"),
        ({"mode": "custom", "custom": {"interest_points": {"fixed": 2001}}}, "difficulty.custom.interest_points.fixed"),
        ({"mode": "custom", "custom": {"skill_cap": 0}}, "difficulty.custom.skill_cap"),
        ({"mode": "custom", "custom": {"characteristic_min": 7}}, "difficulty.custom.characteristic_min"),
        ({"mode": "custom", "custom": {"characteristic_min": 60, "characteristic_max": 30}}, "difficulty.custom.characteristic_min"),
        ("hard", "difficulty"),
    ]
    for difficulty, field in cases:
        error = kernel.err("campaign.create", {"id": CAMPAIGN, "module": MODULE, "difficulty": difficulty})
        assert error["code"] == "invalid_params", difficulty
        assert error["details"]["field"] == field, difficulty
    create(kernel)  # the failures above never created a campaign
    assert investigator(kernel)["name"] == "Ada"


# ---- records (§33.4) ----------------------------------------------------------------------------


def test_snapshot_sheet_and_receipt_records(kernel):
    meta = create(kernel, preset("easy"))
    assert meta["difficulty"] == {"mode": "preset", "preset": "easy"}
    assert read_json(campaign_dir(kernel.workspace) / "campaign.json")["difficulty"] == meta["difficulty"]
    card = investigator(kernel)
    record = {"mode": "preset", "preset": "easy", "multiplier": 4, "custom": {}}
    assert card["creation"]["difficulty"] == record
    receipts = read_json(campaign_dir(kernel.workspace) / "campaign.json")["setup"]["receipts"]
    assert receipts[0]["difficulty"] == record
    assert card["creation"]["characteristics"]["scaling"]["multiplier"] == 4
    assert card["creation"]["luck"]["scaling"]["multiplier"] == 4


# ---- the draft path: limits reflect the snapshot, override relaxes on top -----------------------


def begin_draft(kernel, difficulty):
    create(kernel, difficulty)
    return kernel.ok("setup.draft", {"campaign": CAMPAIGN, "profile": profile()})


def test_draft_limits_obey_the_scaled_bounds_budgets_and_cap(kernel):
    draft = begin_draft(kernel, preset("normal"))
    sheet, limits = draft["sheet"], draft["limits"]
    record = {"mode": "preset", "preset": "normal", "multiplier": 2, "custom": {}}
    assert sheet["creation"]["difficulty"] == record
    stored = read_json(campaign_dir(kernel.workspace) / "setup" / "drafts" / f"{draft['revision']}.json")
    assert stored["receipt"]["difficulty"] == record
    assert limits["characteristic_min"] == 30 and limits["characteristic_max"] == 180
    assert limits["skill_cap"] == 150
    assert limits["occupation_points"] == sheet["characteristics"]["EDU"] * 4
    assert limits["interest_points"] == sheet["characteristics"]["INT"] * 2
    relaxed = kernel.ok("setup.override", {"campaign": CAMPAIGN, "revision": draft["revision"], "edits": {},
                                           "limits_override": {"skill_cap": 200, "characteristic_max": 200}, "dry_run": True})
    assert relaxed["limits"]["skill_cap"] == 200 and relaxed["limits"]["characteristic_max"] == 200
    assert relaxed["limits"]["characteristic_min"] == 30 and relaxed["limits"]["overridden"] == ["characteristic_max", "skill_cap"]


def test_draft_limits_obey_custom_knobs(kernel):
    draft = begin_draft(kernel, {"mode": "custom", "custom": {"characteristic_min": 30, "characteristic_max": 60,
                                                              "skill_cap": 80, "interest_points": {"fixed": 40}}})
    limits = draft["limits"]
    assert (limits["characteristic_min"], limits["characteristic_max"], limits["skill_cap"]) == (30, 60, 80)
    assert limits["interest_points"] == 40
    assert limits["occupation_points"] == draft["sheet"]["characteristics"]["EDU"] * 4


def test_override_bounds_follow_a_replaced_pool(kernel):
    draft = begin_draft(kernel, {"mode": "custom", "custom": {"characteristic_dice": {"3D6": "1D4+2"}}})
    beyond = kernel.err("setup.override", {"campaign": CAMPAIGN, "revision": draft["revision"],
                                           "edits": {"characteristics": {"STR": 35}}})
    assert beyond["code"] == "needs" and beyond["details"]["range"] == [15, 30]
    within = kernel.ok("setup.override", {"campaign": CAMPAIGN, "revision": draft["revision"],
                                          "edits": {"characteristics": {"STR": 30, "SIZ": 90}}, "dry_run": True})
    assert within["sheet"]["characteristics"]["STR"] == 30 and within["sheet"]["characteristics"]["SIZ"] == 90


def test_luck_override_keeps_creation_bounds_under_a_replaced_pool(kernel):
    """LUCK is not a pool characteristic: a replaced 3D6 pool bounds the nine characteristics,
    never LUCK — a card holding LUCK 90 stays editable (review W2)."""
    draft = begin_draft(kernel, {"mode": "custom", "custom": {"characteristic_dice": {"3D6": "1D4+2"}}})
    error = kernel.err("setup.override", {"campaign": CAMPAIGN, "revision": draft["revision"],
                                          "edits": {"characteristics": {"STR": 35}}})
    assert error["code"] == "needs" and error["details"]["range"] == [15, 30]  # the pool replacement bounds STR
    # LUCK keeps the creation bounds: 35 and 90 are legal, 95 is not
    for value in (35, 90):
        within = kernel.ok("setup.override", {"campaign": CAMPAIGN, "revision": draft["revision"],
                                              "edits": {"characteristics": {"LUCK": value}}, "dry_run": True})
        assert within["sheet"]["characteristics"]["LUCK"] == value
    beyond = kernel.err("setup.override", {"campaign": CAMPAIGN, "revision": draft["revision"],
                                           "edits": {"characteristics": {"LUCK": 95}}})
    assert beyond["code"] == "needs" and beyond["details"]["range"] == [15, 90]


def test_a_corrupt_snapshot_fails_loudly_on_the_next_build(kernel):
    """A hand-edited campaign.json with an invalid difficulty never coerces to a multiplier (review W1)."""
    create(kernel, preset("hard"))
    path = campaign_dir(kernel.workspace) / "campaign.json"
    meta = read_json(path)
    meta["difficulty"] = {"mode": "preset", "preset": "banana"}
    path.write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    error = kernel.err("setup.investigator", {"campaign": CAMPAIGN, "name": "Ada", "occupation": "Antiquarian",
                                              "age": 27, "seed": "11"})
    assert error["code"] == "invalid_params" and error["details"]["field"] == "difficulty.preset"


def test_rolled_pool_assignment_permutes_the_scaled_results(kernel):
    plain = begin_draft(kernel, preset("normal"))
    stated = kernel.ok("setup.draft", {"campaign": CAMPAIGN,
                                       "profile": {"aptitude": {"strong": ["STR"], "weak": ["INT"], "origin": "player"}}})
    generation = stated["sheet"]["creation"]["characteristics"]
    assert generation["method"] == "rolled_pool_assignment"
    initial = plain["sheet"]["creation"]["characteristics"]
    # rolls are recorded where each result landed, so values and rolls line up per characteristic
    assert sorted(r["total"] for r in generation["rolls"].values()) == sorted(r["total"] for r in initial["rolls"].values())
    assert sorted(tuple(r["faces"]) for r in generation["rolls"].values()) == sorted(tuple(r["faces"]) for r in initial["rolls"].values())
    for entry in generation["assignment"]:
        assert generation["values"][entry["characteristic"]] == scaled(generation["rolls"][entry["characteristic"]]["total"], 2)
    for pool in (POOL_3D6, POOL_2D6_6):
        assert sorted(initial["values"][a] for a in pool) == sorted(generation["values"][a] for a in pool)
    assert generation["values"]["STR"] == max(initial["values"][a] for a in POOL_3D6)
    assert generation["values"]["INT"] == min(initial["values"][a] for a in POOL_2D6_6)
