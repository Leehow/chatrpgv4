"""Manual numeric override from the card: rebuild, budgets, limits and audit (contract §23.4)."""
import json

from conftest import CAMPAIGN, RpcClient, campaign_dir, read_json
from test_setup_drafts import profile, begin


def characteristics_edit(sheet, abbr, delta, ceiling=90):
    """An edit of `delta` points that stays inside the creation bounds.

    The draft is rolled, so a fixed rise walks past the ceiling whenever the roll lands near it and
    the whole run fails on a number nothing here is testing (CON 85 and 90 both did). Turning around
    at the top is what the DEX case below already does; the direction is not what these tests assert.
    """
    value = sheet["characteristics"][abbr]
    return {"characteristics": {abbr: value + (delta if value + delta <= ceiling else -delta)}}


def test_draft_carries_the_limits_block_and_the_file_stores_it(kernel, tmp_path):
    draft = begin(kernel)
    limits = draft["limits"]
    sheet = draft["sheet"]
    assert limits["characteristic_min"] == 15 and limits["characteristic_max"] == 90
    assert limits["skill_cap"] == 75
    assert limits["occupation_formula"]["formula"] == "EDU*4"
    assert limits["occupation_formula"]["total"] == sheet["characteristics"]["EDU"] * 4
    assert limits["occupation_points"] == limits["occupation_formula"]["total"]
    assert limits["interest_formula"]["total"] == sheet["characteristics"]["INT"] * 2
    assert limits["interest_points"] == limits["interest_formula"]["total"]
    assert limits["credit_rating_range"] == [9, 30]
    assert limits["overridden"] == []
    stored = read_json(campaign_dir(kernel.workspace) / "setup" / "drafts" / f"{draft['revision']}.json")
    assert stored["limits"] == limits


def test_override_one_characteristic_recomputes_derived_and_resets_currents(kernel):
    draft = begin(kernel)
    sheet = draft["sheet"]
    edits = characteristics_edit(sheet, "CON", 10)
    result = kernel.ok("setup.override", {"campaign": CAMPAIGN, "revision": draft["revision"], "edits": edits})
    assert result["revision"] == draft["revision"] + 1
    updated = result["sheet"]
    assert updated["characteristics"]["CON"] == edits["characteristics"]["CON"]
    assert updated["derived"]["HP"] == (updated["characteristics"]["CON"] + updated["characteristics"]["SIZ"]) // 10
    assert updated["derived"]["SAN"] == updated["characteristics"]["POW"]
    assert updated["derived"]["MP"] == updated["characteristics"]["POW"] // 5
    assert updated["current_hp"] == updated["derived"]["HP"]
    assert updated["current_mp"] == updated["derived"]["MP"]
    assert updated["current_san"] == updated["derived"]["SAN"]
    assert updated["current_luck"] == updated["characteristics"]["LUCK"]
    assert updated["creation"]["pins"]["characteristics"]["CON"] == {"value": edits["characteristics"]["CON"], "by": "player"}
    assert result["pins"]["characteristics"]["CON"]["value"] == edits["characteristics"]["CON"]
    assert updated["creation"]["method"] == sheet["creation"]["method"]
    assert updated["creation"]["characteristics"] == sheet["creation"]["characteristics"], "the dice evidence stays"
    campaign = read_json(campaign_dir(kernel.workspace) / "campaign.json")
    assert campaign["setup"]["draft_revision"] == result["revision"]
    assert campaign["setup"].get("previewed_revision") is None


def test_a_dex_change_recomputes_the_dodge_base_and_holds_its_points(kernel):
    draft = begin(kernel)
    sheet = draft["sheet"]
    old_dex, old_dodge = sheet["characteristics"]["DEX"], sheet["skills"]["Dodge"]
    held = old_dodge - old_dex // 2
    new_dex = 90 if old_dex <= 80 else old_dex - 10
    result = kernel.ok("setup.override", {"campaign": CAMPAIGN, "revision": draft["revision"],
                                          "edits": {"characteristics": {"DEX": new_dex}}})
    assert result["sheet"]["skills"]["Dodge"] == new_dex // 2 + held


def occupation_swap(sheet, amount=5):
    """One occupational skill down, another up by the same amount: pool spend unchanged."""
    allocations = sheet["creation"]["skills"]["occupation"]["allocations"]
    lowered = next(name for name, points in allocations.items() if points >= amount)
    raised = next(name for name in sheet["creation"]["skills"]["occupation"]["resolved"]
                  if name != lowered and sheet["skills"][name] + amount <= 75)
    return {lowered: sheet["skills"][lowered] - amount, raised: sheet["skills"][raised] + amount}


def test_skill_edits_within_the_budget_are_applied(kernel):
    draft = begin(kernel)
    edits = {"skills": occupation_swap(draft["sheet"])}
    result = kernel.ok("setup.override", {"campaign": CAMPAIGN, "revision": draft["revision"], "edits": edits})
    for name, value in edits["skills"].items():
        assert result["sheet"]["skills"][name] == value


def test_exceeding_a_pool_is_reported_on_the_card_not_refused(kernel):
    """§98: the budget is a report. A pin the pool cannot hold stays, the machine's share gives way
    first, and what is still over is written on the card as an overspend."""
    draft = begin(kernel)
    sheet = draft["sheet"]
    allocations = sheet["creation"]["skills"]["occupation"]["allocations"]
    raised = next(name for name, points in allocations.items() if sheet["skills"][name] + 5 <= 75)
    result = kernel.ok("setup.override", {"campaign": CAMPAIGN, "revision": draft["revision"],
                                          "edits": {"skills": {raised: sheet["skills"][raised] + 5}}})
    assert result["sheet"]["skills"][raised] == sheet["skills"][raised] + 5
    assert result["pins"]["skills"][raised]["value"] == sheet["skills"][raised] + 5
    occupation = result["budget"]["occupation"]
    assert occupation["total"] == draft["limits"]["occupation_points"]
    assert occupation["unspent"] >= 0, "the allocator gave way before anything was overspent"
    others = [name for name in allocations if name != raised]
    assert sum(result["sheet"]["skills"][name] for name in others) == sum(sheet["skills"][name] for name in others) - 5
    campaign = read_json(campaign_dir(kernel.workspace) / "campaign.json")
    assert campaign["setup"]["draft_revision"] == result["revision"]


def test_overspending_past_every_soft_point_is_a_non_standard_card(kernel):
    draft = begin(kernel)
    sheet = draft["sheet"]
    interest = sheet["creation"]["skills"]["interest"]["allocations"]
    pins = {name: 75 for name in interest}
    result = kernel.ok("setup.override", {"campaign": CAMPAIGN, "revision": draft["revision"], "edits": {"skills": pins}})
    for name in interest:
        assert result["sheet"]["skills"][name] == 75
    assert result["budget"]["interest"]["unspent"] < 0 or result["budget"]["interest"]["unspent"] == 0
    assert result["completeness"]["valid"], "an overspent card is confirmable; it is only not standard"
    if result["budget"]["interest"]["unspent"] < 0:
        assert result["budget"]["legal"] is False and any(note["code"] == "overspent" and note["pool"] == "interest" for note in result["budget"]["notes"])


def test_a_stale_revision_conflicts(kernel):
    draft = begin(kernel)
    error = kernel.err("setup.override", {"campaign": CAMPAIGN, "revision": draft["revision"] + 9,
                                          "edits": {"credit_rating": 20}})
    assert error["code"] == "idempotency_conflict" and error["code_detail"] == "stale_draft"


def test_unknown_edit_fields_are_invalid_and_list_the_legal_fields(kernel):
    draft = begin(kernel)
    error = kernel.err("setup.override", {"campaign": CAMPAIGN, "revision": draft["revision"], "edits": {"hit_points": 20}})
    assert error["code"] == "invalid_params"
    assert error["details"]["fields"] == ["characteristics", "credit_rating", "skills"]
    error = kernel.err("setup.override", {"campaign": CAMPAIGN, "revision": draft["revision"],
                                          "edits": {"characteristics": {"Strength": 80}}})
    assert error["code"] == "invalid_params"


def test_skill_edits_below_the_base_and_above_the_cap_are_refused(kernel):
    draft = begin(kernel)
    sheet = draft["sheet"]
    allocations = sheet["creation"]["skills"]["occupation"]["allocations"]
    name = next(iter(allocations))
    base = sheet["skills"][name] - allocations[name]
    error = kernel.err("setup.override", {"campaign": CAMPAIGN, "revision": draft["revision"],
                                          "edits": {"skills": {name: base - 1}}})
    assert error["code"] == "needs" and error["details"]["field"] == name
    assert error["details"]["range"] == [base, 75] and error["details"]["attempted"] == base - 1
    error = kernel.err("setup.override", {"campaign": CAMPAIGN, "revision": draft["revision"],
                                          "edits": {"skills": {name: 76}}})
    assert error["code"] == "needs" and error["details"]["range"] == [base, 75]


def test_cthulhu_mythos_and_credit_rating_are_not_skill_edits(kernel):
    draft = begin(kernel)
    error = kernel.err("setup.override", {"campaign": CAMPAIGN, "revision": draft["revision"],
                                          "edits": {"skills": {"Cthulhu Mythos": 10}}})
    assert error["code"] == "needs"
    error = kernel.err("setup.override", {"campaign": CAMPAIGN, "revision": draft["revision"],
                                          "edits": {"skills": {"Credit Rating": 20}}})
    assert error["code"] == "invalid_params"
    error = kernel.err("setup.override", {"campaign": CAMPAIGN, "revision": draft["revision"],
                                          "edits": {"skills": {"Astrology": 20}}})
    assert error["code"] == "needs" and error["details"]["field"] == "Astrology"


def test_credit_rating_stays_within_the_occupation_range(kernel):
    draft = begin(kernel)
    for bad in (8, 31):
        error = kernel.err("setup.override", {"campaign": CAMPAIGN, "revision": draft["revision"],
                                              "edits": {"credit_rating": bad}})
        assert error["code"] == "needs"
        assert error["details"]["field"] == "credit_rating" and error["details"]["range"] == [9, 30]


def test_a_characteristic_above_the_default_bound_needs_an_unlock(kernel):
    draft = begin(kernel)
    error = kernel.err("setup.override", {"campaign": CAMPAIGN, "revision": draft["revision"],
                                          "edits": {"characteristics": {"STR": 95}}})
    assert error["code"] == "needs" and error["details"]["range"] == [15, 90]


def test_a_limits_override_unlocks_and_persists_into_later_overrides(kernel):
    draft = begin(kernel)
    unlocked = kernel.ok("setup.override", {"campaign": CAMPAIGN, "revision": draft["revision"],
                                            "edits": {"characteristics": {"STR": 95}},
                                            "limits_override": {"characteristic_max": 99}})
    assert unlocked["sheet"]["characteristics"]["STR"] == 95
    assert unlocked["limits"]["characteristic_max"] == 99 and unlocked["limits"]["overridden"] == ["characteristic_max"]
    stored = read_json(campaign_dir(kernel.workspace) / "setup" / "drafts" / f"{unlocked['revision']}.json")
    assert stored["limits_override"] == {"characteristic_max": 99}
    later = kernel.ok("setup.override", {"campaign": CAMPAIGN, "revision": unlocked["revision"],
                                         "edits": {"characteristics": {"CON": 92}}})
    assert later["sheet"]["characteristics"]["CON"] == 92, "the unlock survived without being carried again"
    assert later["limits"]["characteristic_max"] == 99 and later["limits"]["overridden"] == ["characteristic_max"]


def test_dry_run_returns_the_would_be_result_and_writes_nothing(kernel):
    draft = begin(kernel)
    sheet = draft["sheet"]
    result = kernel.ok("setup.override", {"campaign": CAMPAIGN, "revision": draft["revision"],
                                          "edits": characteristics_edit(sheet, "CON", 10), "dry_run": True})
    assert result["revision"] == draft["revision"] + 1
    assert result["sheet"]["derived"]["HP"] != sheet["derived"]["HP"]
    assert result["limits"]["occupation_points"] == result["sheet"]["characteristics"]["EDU"] * 4
    campaign = read_json(campaign_dir(kernel.workspace) / "campaign.json")
    assert campaign["setup"]["draft_revision"] == draft["revision"]
    drafts = list((campaign_dir(kernel.workspace) / "setup" / "drafts").glob("*.json"))
    assert len(drafts) == 1
    applied = kernel.ok("setup.override", {"campaign": CAMPAIGN, "revision": draft["revision"],
                                           "edits": characteristics_edit(sheet, "CON", 10)})
    assert applied["sheet"] == result["sheet"], "the dry run previewed exactly what the real call wrote"


def test_an_identical_profile_reuses_the_overridden_draft(kernel):
    draft = begin(kernel)
    overridden = kernel.ok("setup.override", {"campaign": CAMPAIGN, "revision": draft["revision"],
                                              "edits": characteristics_edit(draft["sheet"], "CON", 10)})
    repeated = kernel.ok("setup.draft", {"campaign": CAMPAIGN, "profile": profile()})
    assert repeated["revision"] == overridden["revision"]
    assert repeated["sheet"] == overridden["sheet"], "no re-roll, the manual numbers stand"


def test_confirm_without_a_revision_commits_the_current_overridden_draft(kernel):
    draft = begin(kernel)
    overridden = kernel.ok("setup.override", {"campaign": CAMPAIGN, "revision": draft["revision"],
                                              "edits": characteristics_edit(draft["sheet"], "CON", 10)})
    stale = kernel.err("setup.confirm", {"campaign": CAMPAIGN, "revision": draft["revision"], "consent": "delegated"})
    assert stale["code_detail"] == "stale_draft"
    committed = kernel.ok("setup.confirm", {"campaign": CAMPAIGN, "consent": "delegated"})
    assert committed["committed"] and committed["sheet"] == overridden["sheet"]
    card = read_json(campaign_dir(kernel.workspace) / "party" / "investigator.json")
    assert card["characteristics"]["CON"] == overridden["sheet"]["characteristics"]["CON"]


def test_override_is_refused_between_confirmation_and_handoff(kernel):
    draft = begin(kernel)
    kernel.ok("setup.confirm", {"campaign": CAMPAIGN, "revision": draft["revision"], "consent": "delegated"})
    error = kernel.err("setup.override", {"campaign": CAMPAIGN, "revision": draft["revision"],
                                          "edits": characteristics_edit(draft["sheet"], "CON", 10)})
    assert error["code"] == "campaign_not_ready"
    meta = read_json(campaign_dir(kernel.workspace) / "campaign.json")
    assert meta["setup"]["draft_revision"] == draft["revision"], "the confirmed draft stays current"


def test_override_is_refused_once_the_campaign_left_setting_up(kernel):
    draft = begin(kernel)
    kernel.ok("setup.confirm", {"campaign": CAMPAIGN, "revision": draft["revision"], "consent": "delegated"})
    assert kernel.ok("setup.complete", {"campaign": CAMPAIGN})["status"] == "ready_for_table"
    error = kernel.err("setup.override", {"campaign": CAMPAIGN, "revision": draft["revision"],
                                          "edits": characteristics_edit(draft["sheet"], "CON", 10)})
    assert error["code"] == "invalid_params"


def test_the_allocation_ledger_is_rewritten_to_the_manual_numbers(tmp_path):
    """The die is pinned here because this case is about the ledger, not about variance.

    EDU is (2D6+6)x5, so it lands on 90 about one run in thirty-six, and on that roll the only way
    left to move it was down — which shrinks an EDU*4 budget by forty points and made the five-point
    raise below illegal. The case then failed on arithmetic it was not testing. `COC_KERNEL_SEED=7`
    rolls EDU 65, so the edit has somewhere to go on every run.
    """
    kernel = RpcClient(tmp_path / "ws", env={"COC_KERNEL_SEED": "7"})
    try:
        _ledger_case(kernel)
    finally:
        kernel.close()


def _ledger_case(kernel):
    draft = begin(kernel)
    sheet = draft["sheet"]
    edu = sheet["characteristics"]["EDU"]
    assert edu <= 85, "the pinned seed must leave room to raise EDU"
    new_edu = 90
    held_library = sheet["skills"]["Library Use"] - 20
    result = kernel.ok("setup.override", {"campaign": CAMPAIGN, "revision": draft["revision"],
                                          "edits": {"characteristics": {"EDU": new_edu},
                                                    "skills": {"Library Use": sheet["skills"]["Library Use"] + 5}}})
    updated = result["sheet"]
    ledger = updated["creation"]["skills"]["occupation"]
    assert ledger["budget"]["total"] == new_edu * 4, "the budget is evaluated on the new characteristics"
    assert ledger["allocations"]["Library Use"] == held_library + 5
    assert updated["skills"]["Library Use"] == 20 + held_library + 5
    assert sum(ledger["allocations"].values()) == ledger["spent"]
    assert ledger["points"] == ledger["budget"]["total"] - updated["credit_rating"]
    assert ledger["unspent"] == ledger["points"] - ledger["spent"]
    interest = updated["creation"]["skills"]["interest"]
    assert interest["budget"]["total"] == updated["characteristics"]["INT"] * 2
    assert sum(interest["allocations"].values()) == interest["spent"]
    assert interest["unspent"] == interest["budget"]["total"] - interest["spent"]


def test_a_credit_rating_edit_recomputes_wealth_and_charges_the_occupation_pool(kernel):
    draft = begin(kernel)
    sheet = draft["sheet"]
    new_credit = draft["limits"]["credit_rating_range"][1]
    assert new_credit != sheet["credit_rating"]
    result = kernel.ok("setup.override", {"campaign": CAMPAIGN, "revision": draft["revision"],
                                          "edits": {"credit_rating": new_credit},
                                          "limits_override": {"occupation_points": draft["limits"]["occupation_points"] + 30}})
    updated = result["sheet"]
    assert updated["credit_rating"] == new_credit and updated["skills"]["Credit Rating"] == new_credit
    ledger = updated["creation"]["skills"]["occupation"]
    assert ledger["credit_rating"]["value"] == new_credit
    assert ledger["points"] == ledger["budget"]["total"] - new_credit
    assert ledger["unspent"] == ledger["points"] - ledger["spent"]
    assert updated["finance"] != sheet["finance"] and updated["cash"] != sheet["cash"], \
        "the wealth line follows the rating instead of lagging the rolled value"


def test_unlocking_a_pool_budget_raises_the_total_the_ledger_shows(kernel):
    draft = begin(kernel)
    sheet = draft["sheet"]
    occupation = sheet["creation"]["skills"]["occupation"]
    target = min((name for name in occupation["resolved"] if name != "Credit Rating"),
                 key=lambda name: sheet["skills"][name])
    edit = {"skills": {target: sheet["skills"][target] + 5}}
    unlocked = kernel.ok("setup.override", {"campaign": CAMPAIGN, "revision": draft["revision"], "edits": edit,
                                            "limits_override": {"occupation_points": occupation["budget"]["total"] + 10}})
    assert unlocked["limits"]["overridden"] == ["occupation_points"]
    assert unlocked["limits"]["occupation_points"] == occupation["budget"]["total"] + 10
    ledger = unlocked["sheet"]["creation"]["skills"]["occupation"]
    assert ledger["budget"]["total"] == occupation["budget"]["total"] + 10, "the ledger shows the budget in force"
    assert unlocked["budget"]["occupation"]["total"] == occupation["budget"]["total"] + 10
    assert unlocked["budget"]["legal"] is False, "a relaxed bound is a non-standard card"


def test_unknown_limits_override_keys_are_invalid_params(kernel):
    draft = begin(kernel)
    error = kernel.err("setup.override", {"campaign": CAMPAIGN, "revision": draft["revision"],
                                          "edits": characteristics_edit(draft["sheet"], "CON", 5),
                                          "limits_override": {"sanity_cap": 99}})
    assert error["code"] == "invalid_params"


def swap(sheet, pool="occupation", points=10):
    """Move `points` from a skill that has them to the cheapest skill in the same pool.

    Both pools start fully spent, so a legal manual edit is always a swap: a bare raise is refused
    by the budget and a bare drop below a recomputed base is refused by the floor. Picking the donor
    and the target off the recorded ledger keeps the edit legal whatever the dice did.
    """
    allocations = sheet["creation"]["skills"][pool]["allocations"]
    donor = next(name for name, spent in sorted(allocations.items()) if spent >= points)
    target = min((name for name in allocations if name != donor), key=lambda name: sheet["skills"][name])
    return {"skills": {donor: sheet["skills"][donor] - points, target: sheet["skills"][target] + points}}


def test_a_pin_survives_a_re_draft_that_changes_the_age(kernel):
    """§98 replaces §92's carry: a pin is a first-class number on the card, and a revision of the
    words never rebuilds it."""
    draft = begin(kernel)
    edits = characteristics_edit(draft["sheet"], "CON", 10)
    pinned = kernel.ok("setup.override", {"campaign": CAMPAIGN, "revision": draft["revision"], "edits": edits})
    aged = kernel.ok("setup.draft", {"campaign": CAMPAIGN, "profile": {"age": 45}})
    assert aged["revision"] == pinned["revision"] + 1
    assert aged["sheet"]["characteristics"]["CON"] == edits["characteristics"]["CON"]
    assert aged["pins"]["characteristics"]["CON"] == {"value": edits["characteristics"]["CON"], "by": "player"}
    assert "manual" not in aged["sheet"]["creation"] and "manual" not in aged
    committed = kernel.ok("setup.confirm", {"campaign": CAMPAIGN, "consent": "approved"})
    assert committed["sheet"]["characteristics"]["CON"] == edits["characteristics"]["CON"]
