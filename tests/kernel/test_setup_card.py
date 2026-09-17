"""The card is a patched document: words change words, numbers change numbers (contract §98).

Every case here is the RPC seam: `setup.draft` / `setup.revise` / `setup.reroll` / `setup.confirm`
against the emitted kernel, and the card file on disk. Nothing reads an internal function.
"""
import copy

from conftest import CAMPAIGN, RpcClient, campaign_dir, read_json
from test_setup_drafts import profile, begin

TABLE_ORDER = ["STR", "CON", "SIZ", "DEX", "APP", "INT", "POW", "EDU"]


def criminal():
    semantic = profile()
    semantic.update({"name": "龙薇", "occupation": "Criminal", "age": 26, "sex": "女", "own_language": "中文",
                     "occupation_skills": ["Fighting (Brawl)", "Firearms (Handgun)", "Stealth", "Drive Auto", "Disguise", "Psychology", "Spot Hidden", "Sleight of Hand"],
                     "interest_skills": ["Dodge", "Throw", "Climb"]})
    return semantic


def draft(kernel, semantic, **extra):
    kernel.ok("campaign.create", {"id": CAMPAIGN, "module": "the-haunting", "play_language": "zh-Hans"})
    return kernel.ok("setup.draft", {"campaign": CAMPAIGN, "profile": semantic, **extra})


def current(kernel):
    return kernel.ok("setup.steps", {"campaign": CAMPAIGN})["state"]["draft"]


# ---- how the numbers come to be ---------------------------------------------------------------

def test_a_described_person_takes_the_quick_fire_array_in_priority_order(kernel):
    """龙薇: a beautiful, agile assassin got APP 35 / DEX 50 because 'strong' could only permute her own dice."""
    semantic = criminal()
    semantic["aptitude"] = {"strong": ["DEX", "APP", "STR", "CON"], "weak": [], "origin": "player"}
    card = draft(kernel, semantic)
    generated = card["sheet"]["creation"]["characteristics"]
    assert generated["method"] == "quick_fire"
    values = generated["values"]
    assert values["DEX"] == 80 and values["APP"] == 70 and values["STR"] == 60 and values["CON"] == 60
    assert [values[a] for a in ("SIZ", "INT", "POW", "EDU")] == [50, 50, 50, 40], "the rest take the middle of the array in table order"
    assert card["sheet"]["characteristics"]["DEX"] == 80 and card["sheet"]["characteristics"]["APP"] >= 70
    assert card["generation"]["method"] == "quick_fire"


def test_a_weak_characteristic_takes_the_bottom_of_the_array(kernel):
    semantic = criminal()
    semantic["aptitude"] = {"strong": ["INT"], "weak": ["STR"], "origin": "player"}
    values = draft(kernel, semantic)["sheet"]["creation"]["characteristics"]["values"]
    assert values["INT"] == 80 and values["STR"] == 40


def test_without_a_word_about_the_person_the_dice_decide(kernel):
    card = draft(kernel, criminal())
    assert card["sheet"]["creation"]["characteristics"]["method"] == "rolled"
    assert card["generation"]["method"] == "rolled"
    assert card["pins"] == {"characteristics": {}, "skills": {}}


def test_a_number_written_in_the_dossier_is_a_pin(kernel):
    card = draft(kernel, criminal(), numbers={"characteristics": {"DEX": 90, "APP": 85}})
    assert card["sheet"]["characteristics"]["DEX"] == 90 and card["sheet"]["characteristics"]["APP"] == 85
    assert card["pins"]["characteristics"]["DEX"] == {"value": 90, "by": "player"}
    assert card["generation"]["method"] == "rolled", "a number is a pin over the dice, not a method of its own"
    assert card["sheet"]["creation"]["characteristics"]["pinned"] == ["DEX", "APP"]
    assert card["sheet"]["derived"]["HP"] == (card["sheet"]["characteristics"]["CON"] + card["sheet"]["characteristics"]["SIZ"]) // 10


def test_a_pin_above_the_creation_bound_asks_for_the_unlock(kernel):
    kernel.ok("campaign.create", {"id": CAMPAIGN, "module": "the-haunting", "play_language": "zh-Hans"})
    error = kernel.err("setup.draft", {"campaign": CAMPAIGN, "profile": criminal(), "numbers": {"characteristics": {"STR": 95}}})
    assert error["code"] == "needs"
    assert error["details"]["field"] == "STR" and error["details"]["unlock"] == {"characteristic_max": 95}
    card = kernel.ok("setup.draft", {"campaign": CAMPAIGN, "profile": criminal(), "numbers": {"characteristics": {"STR": 95}}, "limits": {"characteristic_max": 95}})
    assert card["sheet"]["characteristics"]["STR"] == 95
    assert card["budget"]["legal"] is False and "characteristic_max" in card["limits"]["overridden"]


# ---- words change words -------------------------------------------------------------------------

def test_a_profile_revision_moves_no_number(kernel):
    first = draft(kernel, criminal())
    second = kernel.ok("setup.revise", {"campaign": CAMPAIGN, "profile": {"equipment": ["吉他箱", "武士刀", "六把飞刀"], "backstory": {**profile()["backstory"], "personal_description": "皮肤白皙，黑发到肩"}}})
    assert second["revision"] == first["revision"] + 1
    assert second["sheet"]["characteristics"] == first["sheet"]["characteristics"]
    assert second["sheet"]["skills"] == first["sheet"]["skills"]
    assert second["sheet"]["credit_rating"] == first["sheet"]["credit_rating"]
    assert second["sheet"]["equipment"] == ["吉他箱", "武士刀", "六把飞刀"]
    assert second["sheet"]["backstory"]["personal_description"] == "皮肤白皙，黑发到肩"
    assert second["applied"] == ["backstory", "equipment"]


def test_one_backstory_category_can_be_corrected_alone(kernel):
    """The live table sent personal_description by itself and the shallow merge wiped the rest (§98)."""
    first = draft(kernel, criminal())
    fixed = kernel.ok("setup.revise", {"campaign": CAMPAIGN, "profile": {"backstory": {"personal_description": "皮肤白皙，黑发到肩，很美"}}})
    assert fixed["sheet"]["backstory"]["personal_description"] == "皮肤白皙，黑发到肩，很美"
    for key in ("ideology_beliefs", "significant_people", "scenario_bound"):
        assert fixed["sheet"]["backstory"][key] == first["sheet"]["backstory"][key]
    assert fixed["sheet"]["characteristics"] == first["sheet"]["characteristics"]


def test_a_backstory_category_at_the_top_level_is_folded_in(kernel):
    first = draft(kernel, criminal())
    fixed = kernel.ok("setup.revise", {"campaign": CAMPAIGN, "profile": {"personal_description": "很美", "equipment": ["吉他箱"]}})
    assert fixed["sheet"]["backstory"]["personal_description"] == "很美" and fixed["sheet"]["equipment"] == ["吉他箱"]
    assert fixed["sheet"]["backstory"]["scenario_bound"] == first["sheet"]["backstory"]["scenario_bound"]


def test_draft_with_a_card_on_the_table_is_a_revision(kernel):
    first = draft(kernel, criminal())
    again = kernel.ok("setup.draft", {"campaign": CAMPAIGN, "profile": {"age": 30}})
    assert again["revision"] == first["revision"] + 1
    assert again["sheet"]["creation"]["characteristics"] == first["sheet"]["creation"]["characteristics"]


def test_an_unprinted_weapon_goes_to_the_equipment_instead_of_a_refusal(kernel):
    semantic = criminal()
    semantic["weapons"] = ["武士刀", ".45 Automatic"]
    card = draft(kernel, semantic)
    assert [weapon["name"] for weapon in card["sheet"]["weapons"]] == [".45 Automatic"]
    assert "武士刀" in card["sheet"]["equipment"]
    assert card["moved_to_equipment"] == ["武士刀"]


def test_unknown_profile_fields_are_named_not_the_whole_schema(kernel):
    kernel.ok("campaign.create", {"id": CAMPAIGN, "module": "the-haunting", "play_language": "zh-Hans"})
    error = kernel.err("setup.draft", {"campaign": CAMPAIGN, "profile": {**criminal(), "step": "x", "skills": {}}})
    assert error["code"] == "invalid_params"
    assert error["details"]["unknown"] == ["skills", "step"]


# ---- the catalog is the kernel's job ------------------------------------------------------------

def test_fewer_than_eight_occupation_skills_are_filled_from_the_trade(kernel):
    semantic = criminal()
    semantic["occupation_skills"] = ["Psychology", "Stealth"]
    card = draft(kernel, semantic)
    listed = card["sheet"]["creation"]["skills"]["occupation"]["resolved"]
    assert len(listed) == 8 and len(set(listed)) == 8
    assert {"Psychology", "Stealth", "Spot Hidden"} <= set(listed)
    assert set(card["filled_in"]) == set(listed) - {"Psychology", "Stealth"}
    assert card["profile"]["occupation_skills"] == listed


def test_names_resolve_through_the_localized_labels(kernel):
    semantic = criminal()
    semantic.update({"occupation": "罪犯", "occupation_skills": ["心理学", "侦查", "潜行", "斗殴", "手枪", "乔装", "汽车驾驶", "妙手"],
                     "interest_skills": ["闪避", "投掷"]})
    card = draft(kernel, semantic)
    assert card["sheet"]["occupation"] == "Criminal"
    assert "Spot Hidden" in card["profile"]["occupation_skills"] and "Dodge" in card["profile"]["interest_skills"]
    assert card["sheet"]["skills"]["Dodge"] > card["sheet"]["characteristics"]["DEX"] // 2, "the interest list was spent on it"


def test_an_unknown_trade_offers_the_closest_entries_by_their_skills(kernel):
    semantic = criminal()
    semantic.update({"occupation": "Mechanic", "occupation_skills": ["Mechanical Repair", "Electrical Repair", "Drive Auto", "Operate Heavy Machinery"]})
    kernel.ok("campaign.create", {"id": CAMPAIGN, "module": "the-haunting", "play_language": "zh-Hans"})
    error = kernel.err("setup.draft", {"campaign": CAMPAIGN, "profile": semantic})
    assert error["code"] == "needs" and error["details"]["field"] == "occupation"
    candidates = [row["id"] for row in error["details"]["candidates"]]
    assert 1 <= len(candidates) <= 3 and "Engineer" in candidates
    assert all({"id", "label", "skills"} <= set(row) for row in error["details"]["candidates"])
    assert "skills" not in error["details"], "no catalog dump rides on a refusal"


def test_an_unresolved_skill_is_dropped_with_candidates_and_the_card_is_still_drawn(kernel):
    semantic = criminal()
    semantic["interest_skills"] = ["anything at all", "Dodge", "Spot Hiden"]
    card = draft(kernel, semantic)
    given = {row["given"]: row["candidates"] for row in card["unresolved"]}
    assert set(given) == {"anything at all", "Spot Hiden"}
    assert "Spot Hidden" in given["Spot Hiden"]
    assert card["profile"]["interest_skills"] == ["Dodge"]


def test_the_catalog_is_one_compact_read(kernel):
    kernel.ok("campaign.create", {"id": CAMPAIGN, "module": "the-haunting", "play_language": "zh-Hans"})
    catalog = kernel.ok("setup.catalog", {"campaign": CAMPAIGN})
    occupations = {row["id"]: row for row in catalog["occupations"]}
    assert len(occupations) == 28 and occupations["Criminal"]["label"] and occupations["Criminal"]["label"] != "Criminal"
    assert occupations["Criminal"]["credit_rating_range"] == [5, 65] and occupations["Criminal"]["skills"]
    skills = {row["name"]: row["label"] for row in catalog["skills"]}
    assert skills["Spot Hidden"] and skills["Spot Hidden"] != "Spot Hidden" and len(skills) >= 79
    assert ".45 Automatic" in catalog["weapons"]


# ---- numbers change numbers, and stay changed ---------------------------------------------------

def test_a_pinned_skill_survives_a_list_change_and_the_new_skills_take_only_what_is_left(kernel):
    first = draft(kernel, criminal())
    pinned = kernel.ok("setup.revise", {"campaign": CAMPAIGN, "numbers": {"skills": {"Dodge": 70}}})
    assert pinned["sheet"]["skills"]["Dodge"] == 70 and pinned["pins"]["skills"]["Dodge"]["by"] == "player"
    assert pinned["pins"]["skills"]["Dodge"]["interest"] == 70 - first["sheet"]["characteristics"]["DEX"] // 2, "a pin is points in the interest column"
    widened = kernel.ok("setup.revise", {"campaign": CAMPAIGN, "profile": {"interest_skills": ["Dodge", "Throw", "Climb", "First Aid", "Natural World"]}})
    assert widened["sheet"]["skills"]["Dodge"] == 70
    assert widened["pins"]["skills"]["Dodge"]["interest"] == pinned["pins"]["skills"]["Dodge"]["interest"]
    assert widened["budget"]["interest"]["unspent"] >= 0
    for name in ("Throw", "Climb"):
        assert widened["sheet"]["skills"][name] <= pinned["sheet"]["skills"][name], "an older allocation only ever gives way, never grows on its own"


def test_soft_allocations_are_sticky_and_only_the_biggest_holder_gives_way(kernel):
    first = draft(kernel, criminal())
    skills = first["sheet"]["skills"]
    softest = min(("Fighting (Brawl)", "Firearms (Handgun)", "Stealth", "Drive Auto"), key=lambda name: skills[name])
    raised = kernel.ok("setup.revise", {"campaign": CAMPAIGN, "numbers": {"skills": {softest: skills[softest] + 10}}})
    changed = {name for name in skills if raised["sheet"]["skills"][name] != skills[name]}
    assert softest in changed and len(changed) <= 3, f"one pin moved {sorted(changed)}"
    assert raised["budget"]["occupation"]["unspent"] == first["budget"]["occupation"]["unspent"]


def test_a_pin_by_the_model_is_recorded_as_the_models(kernel):
    draft(kernel, criminal())
    card = kernel.ok("setup.revise", {"campaign": CAMPAIGN, "numbers": {"skills": {"Dodge": 60}}, "by": "model"})
    assert card["pins"]["skills"]["Dodge"]["by"] == "model" and card["pins"]["skills"]["Dodge"]["value"] == 60
    assert card["pins"]["skills"]["Dodge"]["interest"] == 60 - card["sheet"]["characteristics"]["DEX"] // 2, "a pin is points above the base"


def test_a_pin_above_the_cap_asks_for_the_unlock_and_takes_it(kernel):
    draft(kernel, criminal())
    error = kernel.err("setup.revise", {"campaign": CAMPAIGN, "numbers": {"skills": {"Dodge": 85}}})
    assert error["code"] == "needs" and error["details"]["field"] == "Dodge" and error["details"]["unlock"] == {"skill_cap": 85}
    assert current(kernel)["sheet"]["skills"]["Dodge"] != 85
    card = kernel.ok("setup.revise", {"campaign": CAMPAIGN, "numbers": {"skills": {"Dodge": 85}}, "limits": {"skill_cap": 90}})
    assert card["sheet"]["skills"]["Dodge"] == 85 and card["limits"]["skill_cap"] == 90
    assert card["budget"]["legal"] is False and any(note["code"] == "relaxed" and note["limit"] == "skill_cap" for note in card["budget"]["notes"])


def test_a_pin_the_budget_cannot_hold_is_kept_and_the_overspend_is_reported(kernel):
    draft(kernel, criminal(), limits={"skill_cap": 90})
    card = kernel.ok("setup.revise", {"campaign": CAMPAIGN, "numbers": {"skills": {"Fighting (Brawl)": 90, "Firearms (Handgun)": 90, "Stealth": 90, "Drive Auto": 90, "Disguise": 90, "Psychology": 90, "Spot Hidden": 90, "Sleight of Hand": 90}}})
    for name in ("Fighting (Brawl)", "Sleight of Hand"):
        assert card["sheet"]["skills"][name] == 90
    assert card["budget"]["occupation"]["unspent"] < 0 and card["budget"]["legal"] is False
    assert card["completeness"]["valid"], "an overspent card is a non-standard card, not an incomplete one"


def test_a_relaxed_budget_left_unspent_is_a_note_not_a_gate(kernel):
    draft(kernel, criminal())
    relaxed = kernel.ok("setup.revise", {"campaign": CAMPAIGN, "limits": {"interest_points": 300}})
    assert relaxed["budget"]["interest"]["total"] == 300 and relaxed["budget"]["interest"]["unspent"] > 0
    assert relaxed["completeness"]["valid"]
    committed = kernel.ok("setup.confirm", {"campaign": CAMPAIGN, "consent": "approved"})
    assert committed["committed"] and committed["sheet"]["creation"]["skills"]["interest"]["unspent"] > 0


def test_auto_spread_spends_what_is_left_and_moves_no_pin(kernel):
    draft(kernel, criminal())
    kernel.ok("setup.revise", {"campaign": CAMPAIGN, "numbers": {"skills": {"Dodge": 60}}})
    relaxed = kernel.ok("setup.revise", {"campaign": CAMPAIGN, "limits": {"interest_points": 300, "occupation_points": 600}})
    spread = kernel.ok("setup.revise", {"campaign": CAMPAIGN, "auto_spread": True})
    assert spread["budget"]["interest"]["unspent"] < relaxed["budget"]["interest"]["unspent"]
    assert spread["budget"]["occupation"]["unspent"] < relaxed["budget"]["occupation"]["unspent"]
    assert spread["sheet"]["skills"]["Dodge"] == 60


def test_the_override_alias_still_edits_numbers_for_the_card(kernel):
    first = draft(kernel, criminal())
    con = first["sheet"]["characteristics"]["CON"]
    target = con + 10 if con + 10 <= 90 else con - 10
    card = kernel.ok("setup.override", {"campaign": CAMPAIGN, "revision": first["revision"], "edits": {"characteristics": {"CON": target}}})
    assert card["revision"] == first["revision"] + 1 and card["sheet"]["characteristics"]["CON"] == target
    assert card["pins"]["characteristics"]["CON"] == {"value": target, "by": "player"}
    assert card["sheet"]["derived"]["HP"] == (target + card["sheet"]["characteristics"]["SIZ"]) // 10


def test_credit_rating_is_pinned_inside_the_trade_range(kernel):
    first = draft(kernel, criminal())
    assert kernel.err("setup.revise", {"campaign": CAMPAIGN, "numbers": {"credit_rating": 70}})["details"]["range"] == [5, 65]
    card = kernel.ok("setup.revise", {"campaign": CAMPAIGN, "numbers": {"credit_rating": 60}})
    assert card["sheet"]["credit_rating"] == 60 and card["sheet"]["skills"]["Credit Rating"] == 60
    assert card["pins"]["credit_rating"] == {"value": 60, "by": "player"}
    assert card["sheet"]["finance"] != first["sheet"]["finance"], "wealth follows the rating"


def test_a_refused_revision_leaves_the_card_as_it_was(kernel):
    first = draft(kernel, criminal())
    assert kernel.err("setup.revise", {"campaign": CAMPAIGN, "numbers": {"skills": {"Dodge": "high"}}})["code"] == "invalid_params"
    assert kernel.err("setup.revise", {"campaign": CAMPAIGN, "profile": {"occupation": "Mechanic"}})["code"] == "needs"
    assert current(kernel)["revision"] == first["revision"]


def test_a_revision_needs_a_card(kernel):
    kernel.ok("campaign.create", {"id": CAMPAIGN, "module": "the-haunting", "play_language": "zh-Hans"})
    assert kernel.err("setup.revise", {"campaign": CAMPAIGN, "numbers": {"skills": {"Dodge": 60}}})["code"] == "needs"


# ---- the dice are rolled once ----------------------------------------------------------------------

def test_reroll_is_the_only_call_that_rolls_again_and_it_keeps_the_pins(kernel):
    first = draft(kernel, criminal())
    kernel.ok("setup.revise", {"campaign": CAMPAIGN, "numbers": {"characteristics": {"DEX": 90}}})
    for _ in range(3):
        kernel.ok("setup.revise", {"campaign": CAMPAIGN, "profile": {"age": 30}})
        assert current(kernel)["sheet"]["creation"]["characteristics"]["rolls"] == first["sheet"]["creation"]["characteristics"]["rolls"]
    rerolled = kernel.ok("setup.reroll", {"campaign": CAMPAIGN})
    assert rerolled["sheet"]["characteristics"]["DEX"] == 90
    assert rerolled["sheet"]["creation"]["characteristics"]["rolls"] != first["sheet"]["creation"]["characteristics"]["rolls"]
    assert rerolled["seed"] != first["seed"]


# ---- one gate -----------------------------------------------------------------------------------------

def test_confirm_checks_only_that_this_is_the_current_card(kernel):
    first = draft(kernel, criminal())
    assert kernel.err("setup.confirm", {"campaign": CAMPAIGN, "revision": first["revision"] + 5, "consent": "approved"})["code_detail"] == "stale_draft"
    committed = kernel.ok("setup.confirm", {"campaign": CAMPAIGN, "revision": first["revision"], "consent": "approved"})
    assert committed["committed"] and committed["sheet"] == first["sheet"]
    assert read_json(campaign_dir(kernel.workspace) / "party" / "investigator.json") == first["sheet"]


def test_previewed_is_gone(kernel):
    draft(kernel, criminal())
    assert kernel.err("setup.previewed", {"campaign": CAMPAIGN, "revision": 1})["code"] == "unknown_method"


def test_the_card_file_holds_the_pins_and_the_soft_share(kernel):
    draft(kernel, criminal())
    card = kernel.ok("setup.revise", {"campaign": CAMPAIGN, "numbers": {"skills": {"Dodge": 65}}})
    stored = read_json(campaign_dir(kernel.workspace) / "setup" / "drafts" / f"{card['revision']}.json")
    assert stored["pins"] == card["pins"] and stored["budget"] == card["budget"]
    assert "Dodge" not in stored["soft"]["interest"]
    assert "manual" not in stored and "manual" not in stored["sheet"]["creation"]


# ---- the review's cases (2026-09-17) -----------------------------------------------------------

def test_a_printed_list_with_alternatives_and_slashes_still_fills_the_trade(kernel):
    """Engineer prints "Art/Craft (Technical Drawing)"; Farmer prints "Drive Auto (or Wagon)";
    Police Detective prints "Art/Craft (Acting) or Disguise". None of them may vanish."""
    semantic = criminal()
    semantic.update({"occupation": "Engineer", "occupation_skills": ["Mechanical Repair"], "interest_skills": ["Dodge"]})
    card = draft(kernel, semantic)
    listed = card["sheet"]["creation"]["skills"]["occupation"]["resolved"]
    assert len(listed) == 8 and {"Mechanical Repair", "Electrical Repair", "Library Use", "Operate Heavy Machinery", "Science (Physics)"} <= set(listed), listed
    farmer = kernel.ok("setup.revise", {"campaign": CAMPAIGN, "profile": {"occupation": "Farmer", "occupation_skills": ["Natural World"]}})
    assert "Drive Auto" in farmer["sheet"]["creation"]["skills"]["occupation"]["resolved"]
    detective = kernel.ok("setup.revise", {"campaign": CAMPAIGN, "profile": {"occupation": "Police Detective", "occupation_skills": ["Disguise"]}})
    resolved = detective["sheet"]["creation"]["skills"]["occupation"]["resolved"]
    assert "Disguise" in resolved and len(resolved) == 8


def test_a_ninth_occupation_pick_leads_the_interest_list_and_is_reported(kernel):
    semantic = criminal()
    semantic["occupation_skills"] = ["Fighting (Brawl)", "Firearms (Handgun)", "Stealth", "Drive Auto", "Disguise", "Psychology", "Spot Hidden", "Sleight of Hand", "Locksmith", "Appraise"]
    card = draft(kernel, semantic)
    assert len(card["profile"]["occupation_skills"]) == 8
    assert card["moved_to_interest"] == ["Locksmith", "Appraise"]
    assert card["profile"]["interest_skills"][:2] == ["Locksmith", "Appraise"]


def test_a_reordered_interest_list_respreads_that_pool_and_keeps_the_pins(kernel):
    first = draft(kernel, criminal())
    pinned = kernel.ok("setup.revise", {"campaign": CAMPAIGN, "numbers": {"skills": {"Climb": 40}}})
    reordered = kernel.ok("setup.revise", {"campaign": CAMPAIGN, "profile": {"interest_skills": ["Throw", "Dodge", "Climb"]}})
    assert reordered["sheet"]["skills"]["Climb"] == 40
    assert reordered["sheet"]["skills"]["Throw"] >= reordered["sheet"]["skills"]["Dodge"], "the front of the list is served first"
    assert reordered["budget"]["interest"]["total"] == pinned["budget"]["interest"]["total"] and reordered["budget"]["interest"]["unspent"] >= 0
    assert reordered["budget"]["interest"]["total"] == first["budget"]["interest"]["total"]
    assert reordered["sheet"]["characteristics"] == first["sheet"]["characteristics"]


def test_credit_rating_follows_the_trade_on_an_occupation_change(kernel):
    draft(kernel, criminal())
    kernel.ok("setup.revise", {"campaign": CAMPAIGN, "numbers": {"credit_rating": 60}})
    pinned = kernel.ok("setup.revise", {"campaign": CAMPAIGN, "profile": {"occupation": "Drifter", "occupation_skills": ["Stealth"]}})
    assert pinned["sheet"]["credit_rating"] == 60, "a pinned rating stays"
    assert any(note["code"] == "credit_out_of_range" for note in pinned["budget"]["notes"]) and pinned["budget"]["legal"] is False
    assert pinned["budget"]["occupation"]["spent"] + pinned["budget"]["occupation"]["unspent"] == pinned["budget"]["occupation"]["total"], "the report adds up even when the rating exceeds the pool"
    unpinned = kernel.ok("setup.revise", {"campaign": CAMPAIGN, "numbers": {"credit_rating": None}})
    assert unpinned["sheet"]["credit_rating"] == 5 and any(note["code"] == "credit_moved" for note in unpinned["budget"]["notes"])


def test_a_pin_from_the_dossier_below_its_base_is_refused_on_the_first_draft_too(kernel):
    kernel.ok("campaign.create", {"id": CAMPAIGN, "module": "the-haunting", "play_language": "zh-Hans"})
    error = kernel.err("setup.draft", {"campaign": CAMPAIGN, "profile": criminal(), "numbers": {"skills": {"Dodge": 3}}})
    assert error["code"] == "needs" and error["details"]["field"] == "Dodge" and error["details"]["range"][0] > 3


def test_a_pinned_characteristic_is_written_into_the_generation_record(kernel):
    draft(kernel, criminal())
    card = kernel.ok("setup.revise", {"campaign": CAMPAIGN, "numbers": {"characteristics": {"CON": 70}}})
    record = card["sheet"]["creation"]["characteristics"]
    assert record["values"]["CON"] == 70 and record["pinned"] == ["CON"]


def test_a_reroll_spends_the_new_budget(kernel):
    draft(kernel, criminal())
    for _ in range(3):
        rerolled = kernel.ok("setup.reroll", {"campaign": CAMPAIGN})
        assert rerolled["budget"]["occupation"]["unspent"] == 0 or rerolled["budget"]["occupation"]["unspent"] < 0 or all(
            rerolled["sheet"]["skills"][name] >= 75 for name in rerolled["sheet"]["creation"]["skills"]["occupation"]["resolved"]), rerolled["budget"]


# ---- the live App test with the user watching (2026-09-17) -------------------------------------

def modern(semantic):
    semantic = dict(semantic); semantic["era"] = "modern"; return semantic


def test_a_modern_card_lists_the_whole_standard_sheet_and_the_modern_only_skills(kernel):
    """The App's 1975 card listed fifteen skills: the table prints a standard sheet for the 1920s only."""
    card = draft(kernel, modern(criminal()))
    assert card["sheet"]["era"] == "modern"
    skills = card["sheet"]["skills"]
    assert len(skills) > 40, len(skills)
    assert "Computer Use" in skills and "Electronics" in skills and "Library Use" in skills


def test_a_skill_pin_is_points_so_dodge_follows_dex(kernel):
    """Dodge is half DEX in the rulebook. A pin is points above the base, whoever set it, so when
    the player raises DEX on the card, Dodge rises with it (the worksheet, not a frozen number)."""
    first = draft(kernel, criminal())
    by_model = kernel.ok("setup.revise", {"campaign": CAMPAIGN, "numbers": {"skills": {"Dodge": 60}}, "by": "model"})
    dex = by_model["sheet"]["characteristics"]["DEX"]
    points = by_model["pins"]["skills"]["Dodge"]["interest"]
    assert points == 60 - dex // 2
    raised = kernel.ok("setup.revise", {"campaign": CAMPAIGN, "numbers": {"characteristics": {"DEX": 90}}})
    assert raised["sheet"]["skills"]["Dodge"] == min(45 + points, 75)
    typed = kernel.ok("setup.override", {"campaign": CAMPAIGN, "revision": raised["revision"], "edits": {"skills": {"Dodge": {"interest": 10}}}})
    assert typed["sheet"]["skills"]["Dodge"] == 55 and typed["pins"]["skills"]["Dodge"]["by"] == "player"
    lowered = kernel.ok("setup.override", {"campaign": CAMPAIGN, "revision": typed["revision"], "edits": {"characteristics": {"DEX": 50}}})
    assert lowered["sheet"]["skills"]["Dodge"] == 35, "the ten interest points ride on the new base"


def test_the_worksheet_columns_are_the_pin_and_the_card_reports_both(kernel):
    first = draft(kernel, criminal())
    card = kernel.ok("setup.override", {"campaign": CAMPAIGN, "revision": first["revision"], "edits": {"skills": {"Stealth": {"occupation": 30, "interest": 10}, "Throw": {"interest": 20}}}})
    ledger = card["sheet"]["creation"]["skills"]
    assert ledger["occupation"]["allocations"]["Stealth"] == 30 and ledger["interest"]["allocations"]["Stealth"] == 10
    assert card["sheet"]["skills"]["Stealth"] == ledger["bases"]["Stealth"] + 40
    assert ledger["interest"]["allocations"]["Throw"] == 20 and "Throw" not in ledger["occupation"]["allocations"]
    refused = kernel.err("setup.override", {"campaign": CAMPAIGN, "revision": card["revision"], "edits": {"skills": {"Throw": {"occupation": 5}}}})
    assert refused["code"] == "needs" and refused["details"]["column"] == "occupation"


def test_a_custom_skill_lives_on_the_card_with_its_own_base_and_takes_points(kernel):
    """The player may invent a skill (or a language) on the card; the Keeper can then check it,
    because the play-time resolver reads every skill the sheet carries."""
    semantic = criminal()
    semantic["custom_skills"] = [{"name": "无人机操控", "base": 10}, {"name": "Language (Other: Cantonese)", "base": 1}, {"name": "Spot Hidden", "base": 5}]
    card = draft(kernel, semantic)
    assert card["sheet"]["skills"]["无人机操控"] == 10 and "无人机操控" in card["sheet"]["creation"]["skills"]["custom"]
    assert card["profile"]["custom_skills"] == [{"name": "无人机操控", "base": 10}], "a catalog name is not custom, and a language is its catalog form"
    assert "Spot Hidden" in card["profile"]["occupation_skills"] and "Language (Other: Cantonese)" in card["sheet"]["skills"]
    pinned = kernel.ok("setup.override", {"campaign": CAMPAIGN, "revision": card["revision"], "edits": {"skills": {"无人机操控": {"interest": 40}}}})
    assert pinned["sheet"]["skills"]["无人机操控"] == 50
    kernel.ok("setup.confirm", {"campaign": CAMPAIGN, "consent": "approved"})
    assert read_json(campaign_dir(kernel.workspace) / "party" / "investigator.json")["skills"]["无人机操控"] == 50


def test_the_edit_control_can_change_the_occupation(kernel):
    first = draft(kernel, criminal())
    changed = kernel.ok("setup.override", {"campaign": CAMPAIGN, "revision": first["revision"], "edits": {}, "profile": {"occupation": "Soldier"}})
    assert changed["sheet"]["occupation"] == "Soldier"
    resolved = changed["sheet"]["creation"]["skills"]["occupation"]["resolved"]
    assert len(resolved) == 8 and "Dodge" in resolved and "Fighting (Brawl)" in resolved
    assert changed["sheet"]["characteristics"] == first["sheet"]["characteristics"]


def test_the_budget_reports_the_characteristic_points_against_the_point_buy_reference(kernel):
    card = draft(kernel, criminal())
    chars = card["sheet"]["characteristics"]
    total = sum(chars[a] for a in ("STR", "CON", "SIZ", "DEX", "APP", "INT", "POW", "EDU"))
    assert card["budget"]["characteristics"] == {"total": 460, "spent": total, "unspent": 460 - total, "source": "characteristic-dice.generation_methods.point_buy_460"}


def test_the_edit_control_can_move_a_skill_between_the_lists_and_the_points_reflow(kernel):
    """The player asked to choose occupation and interest skills by hand on the card (2026-09-17)."""
    first = draft(kernel, criminal())
    moved = kernel.ok("setup.override", {"campaign": CAMPAIGN, "revision": first["revision"], "edits": {},
                                         "profile": {"occupation_skills": ["Dodge", "Fighting (Brawl)", "Firearms (Handgun)", "Stealth", "Disguise", "Psychology", "Spot Hidden", "Sleight of Hand"],
                                                     "interest_skills": ["Drive Auto", "Throw", "Climb"]}})
    ledger = moved["sheet"]["creation"]["skills"]
    assert "Dodge" in ledger["occupation"]["resolved"] and "Drive Auto" in ledger["interest"]["pool"]
    assert "Dodge" in ledger["occupation"]["allocations"], "an occupation skill takes occupation points"
    assert "Dodge" not in ledger["interest"]["allocations"]
    assert moved["budget"]["occupation"]["unspent"] >= 0
    assert moved["sheet"]["characteristics"] == first["sheet"]["characteristics"]
    refused = kernel.err("setup.override", {"campaign": CAMPAIGN, "revision": moved["revision"], "edits": {}, "profile": {"name": "x"}})
    assert refused["code"] == "invalid_params"


def test_the_edit_control_can_change_the_age_and_the_age_table_reruns_on_the_same_dice(kernel):
    """Age moves EDU, APP, MOV and Luck (2026-09-17, user): the card's edit control takes it too."""
    first = draft(kernel, criminal())
    kernel.ok("setup.override", {"campaign": CAMPAIGN, "revision": first["revision"], "edits": {"characteristics": {"APP": 85}}})
    older = kernel.ok("setup.override", {"campaign": CAMPAIGN, "revision": first["revision"] + 1, "edits": {}, "profile": {"age": 62}})
    assert older["sheet"]["age"] == 62 and older["sheet"]["creation"]["age"]["bracket"] != first["sheet"]["creation"]["age"]["bracket"]
    assert older["sheet"]["characteristics"]["APP"] == 85, "a pinned characteristic is not aged"
    assert older["sheet"]["creation"]["characteristics"]["rolls"] == first["sheet"]["creation"]["characteristics"]["rolls"], "same dice"
    assert older["sheet"]["derived"]["MOV"] < first["sheet"]["derived"]["MOV"]
