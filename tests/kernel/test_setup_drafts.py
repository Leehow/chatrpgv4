"""Actual draft values, acknowledgment and commit are one versioned contract."""
import copy
import json
from pathlib import Path

from conftest import CAMPAIGN, campaign_dir


def profile():
    return {"name": "Helen", "occupation": "Journalist", "age": 29,
            "concept": "A cautious local reporter seeking rent money.", "own_language": "English",
            "occupation_skills": ["Art and Craft (Photography)", "History", "Language (Own)", "Library Use", "Psychology", "Persuade", "Spot Hidden", "Listen"],
            "interest_skills": ["Accounting", "Law", "First Aid", "Drive Auto"],
            "backstory": {"personal_description": "A practical coat", "ideology_beliefs": "Evidence before rumors",
                          "significant_people": "An editor friend", "scenario_bound": "Meeting Knott about the house investigation"},
            "key_connection": {"backstory_field": "significant_people", "summary": "The editor friend"},
            "equipment": ["Press card", "Notebook", "Camera", "Flashlight"]}


def begin(kernel):
    kernel.ok("campaign.create", {"id": CAMPAIGN, "module": "the-haunting", "play_language": "en"})
    return kernel.ok("setup.draft", {"campaign": CAMPAIGN, "profile": profile()})


def test_draft_is_complete_without_party_and_confirm_commits_exact_card(kernel, tmp_path):
    draft = begin(kernel)
    assert draft["completeness"]["valid"]
    sheet = draft["sheet"]
    assert sheet["creation"]["skills"]["occupation"]["unspent"] == 0
    assert sheet["creation"]["skills"]["interest"]["unspent"] == 0
    assert sheet["equipment"] == profile()["equipment"]
    assert not list((campaign_dir(kernel.workspace) / "party").glob("*.json"))
    refused = kernel.call("setup.confirm", {"campaign": CAMPAIGN, "revision": draft["revision"], "consent": "approved"})
    assert refused["error"]["code_detail"] == "preview_required"
    kernel.ok("setup.previewed", {"campaign": CAMPAIGN, "revision": draft["revision"]})
    committed = kernel.ok("setup.confirm", {"campaign": CAMPAIGN, "revision": draft["revision"], "consent": "approved"})
    assert committed["sheet"] == sheet
    assert kernel.ok("setup.confirm", {"campaign": CAMPAIGN, "revision": draft["revision"], "consent": "approved"})["replayed"]
    assert len(list((campaign_dir(kernel.workspace) / "party").glob("*.json"))) == 1
    assert kernel.ok("setup.complete", {"campaign": CAMPAIGN})["status"] == "ready_for_table"


def test_revision_invalidates_preview_and_retains_unrelated_rolls(kernel):
    original = begin(kernel)
    kernel.ok("setup.previewed", {"campaign": CAMPAIGN, "revision": original["revision"]})
    repeated = kernel.ok("setup.draft", {"campaign": CAMPAIGN, "profile": profile()})
    assert repeated["revision"] == original["revision"]
    updated = kernel.ok("setup.draft", {"campaign": CAMPAIGN, "profile": {"age": 45}})
    assert updated["revision"] > original["revision"]
    assert updated["sheet"]["creation"]["characteristics"] == original["sheet"]["creation"]["characteristics"]
    assert updated["sheet"]["creation"]["luck"] == original["sheet"]["creation"]["luck"]
    assert kernel.call("setup.confirm", {"campaign": CAMPAIGN, "revision": original["revision"], "consent": "approved"})["error"]["code_detail"] == "stale_draft"
    assert kernel.call("setup.confirm", {"campaign": CAMPAIGN, "revision": updated["revision"], "consent": "approved"})["error"]["code_detail"] == "preview_required"
    assert kernel.ok("setup.confirm", {"campaign": CAMPAIGN, "revision": updated["revision"], "consent": "delegated"})["committed"]


def test_bad_semantic_choices_do_not_replace_a_valid_draft(kernel):
    original = begin(kernel)
    bad = kernel.call("setup.draft", {"campaign": CAMPAIGN, "profile": {"occupation_skills": ["anything"]}})
    assert bad["error"]["code"] == "needs"
    restored = kernel.ok("setup.steps", {"campaign": CAMPAIGN})["state"]["draft"]
    assert restored["sheet"] == original["sheet"]
    assert restored["revision"] == original["revision"]


def test_incomplete_legacy_card_cannot_finish_and_story_questions_are_open(kernel):
    kernel.ok("campaign.create", {"id": CAMPAIGN, "module": "the-haunting"})
    kernel.ok("setup.investigator", {"campaign": CAMPAIGN, "name": "Incomplete", "occupation": "Journalist"})
    assert kernel.call("setup.complete", {"campaign": CAMPAIGN})["error"]["code_detail"] == "incomplete_investigator"


def test_prologue_is_source_bound_and_survives_handoff(kernel):
    draft = begin(kernel)
    kernel.ok("setup.prologue", {"campaign": CAMPAIGN, "scene": "Knott's Office", "guide": "Steven Knott",
                               "text": "Knott asks who the visitor is.", "handoff": "Continue after introductions; the commission is not yet accepted."})
    kernel.ok("setup.confirm", {"campaign": CAMPAIGN, "revision": draft["revision"], "consent": "delegated", "last_exchange": "My name is Helen."})
    kernel.ok("setup.complete", {"campaign": CAMPAIGN})
    opened = kernel.ok("table.open", {"campaign": CAMPAIGN})
    assert opened["setup_prologue"]["introduction"]["name"] == "Helen"
    assert opened["setup_prologue"]["last_exchange"] == "My name is Helen."
    result = kernel.ok("table.narrate", {"campaign": CAMPAIGN, "call_id": "t0-c1", "text": "Knott waits. What do you say?"})
    assert not result.get("pending_choice")
    assert "What do you say?" in result["rendered_text"]


def test_same_input_cannot_approve_its_own_draft(kernel):
    kernel.ok("campaign.create", {"id": CAMPAIGN, "module": "the-haunting", "play_language": "en"})
    draft = kernel.ok("setup.draft", {"campaign": CAMPAIGN, "profile": profile(), "input_key": "description"})
    kernel.ok("setup.previewed", {"campaign": CAMPAIGN, "revision": draft["revision"]})
    error = kernel.err("setup.confirm", {"campaign": CAMPAIGN, "revision": draft["revision"], "consent": "approved", "input_key": "description"})
    assert error["code_detail"] == "confirmation_required"
    assert kernel.ok("setup.confirm", {"campaign": CAMPAIGN, "revision": draft["revision"], "consent": "approved", "input_key": "approval"})["committed"]


def test_parallel_confirmation_writes_one_card(kernel):
    from concurrent.futures import ThreadPoolExecutor
    from conftest import RpcClient
    draft = begin(kernel)
    other = RpcClient(kernel.workspace)
    try:
        params = {"campaign": CAMPAIGN, "revision": draft["revision"], "consent": "delegated"}
        with ThreadPoolExecutor(2) as pool:
            futures = [pool.submit(client.ok, "setup.confirm", params) for client in (kernel, other)]
            results = [future.result() for future in futures]
        assert all(result["committed"] for result in results)
        assert sum(bool(result.get("replayed")) for result in results) == 1
        assert len(list((campaign_dir(kernel.workspace) / "party").glob("*.json"))) == 1
    finally:
        other.close()


def test_malformed_profile_returns_findings_and_keeps_draft(kernel):
    original = begin(kernel)
    for patch in ({"backstory": ["wrong"]}, {"occupation_skills": [{}]}, {"key_connection": ["wrong"]}):
        error = kernel.err("setup.draft", {"campaign": CAMPAIGN, "profile": patch})
        assert error["code"] == "needs"
    assert kernel.ok("setup.steps", {"campaign": CAMPAIGN})["state"]["draft"]["revision"] == original["revision"]


def test_confirmed_draft_cannot_be_replaced_before_handoff(kernel):
    original = begin(kernel)
    kernel.ok("setup.confirm", {"campaign": CAMPAIGN, "revision": original["revision"], "consent": "delegated"})
    assert kernel.err("setup.draft", {"campaign": CAMPAIGN, "profile": {"age": 45}})["code"] == "campaign_not_ready"
    assert kernel.ok("setup.complete", {"campaign": CAMPAIGN})["status"] == "ready_for_table"


def test_pending_action_must_come_from_actual_player_input(kernel):
    draft = begin(kernel)
    params = {"campaign": CAMPAIGN, "revision": draft["revision"], "consent": "delegated", "pending_action": "I will inspect the door", "player_requests": ["Create the card. I will inspect the door next."]}
    bad = {**params, "pending_action": "I take the keys"}
    assert kernel.err("setup.confirm", bad)["code"] == "invalid_params"
    assert kernel.ok("setup.confirm", params)["committed"]
    handoff = kernel.ok("setup.complete", {"campaign": CAMPAIGN})
    assert handoff["prologue"]["pending_action"] == "I will inspect the door"


def test_new_draft_requires_appearance_and_preserves_it_across_skill_changes(kernel):
    original = begin(kernel)
    appearance = original["sheet"]["backstory"]["personal_description"]
    missing = profile()
    missing["backstory"].pop("personal_description")
    missing["backstory"]["traits"] = "Patient and practical"
    error = kernel.err("setup.draft", {"campaign": CAMPAIGN, "profile": missing})
    assert any("personal_description is required" in issue for issue in error["details"]["issues"])
    assert kernel.ok("setup.steps", {"campaign": CAMPAIGN})["state"]["draft"]["revision"] == original["revision"]
    changed = kernel.ok("setup.draft", {"campaign": CAMPAIGN, "profile": {"interest_skills": [*profile()["interest_skills"], "Natural World"]}})
    assert changed["sheet"]["backstory"]["personal_description"] == appearance
    assert changed["sheet"]["creation"]["characteristics"] == original["sheet"]["creation"]["characteristics"]


POOLS = {"3D6": ["STR", "CON", "DEX", "APP", "POW"], "2D6+6": ["SIZ", "INT", "EDU"]}


def test_a_stated_aptitude_reaches_the_characteristics_without_new_dice(kernel):
    """The defect this pins: a player who said 'very strong, rather slow' got a card whose
    STR was below average, because the description could only ever reach the skills."""
    plain = begin(kernel)
    stated = kernel.ok("setup.draft", {"campaign": CAMPAIGN,
                                       "profile": {"aptitude": {"strong": ["STR"], "weak": ["INT"], "origin": "player"}}})
    before, after = plain["sheet"]["characteristics"], stated["sheet"]["characteristics"]
    generated = stated["sheet"]["creation"]["characteristics"]
    assert generated["method"] == "rolled_pool_assignment"
    assert stated["sheet"]["creation"]["method"] == "rolled_pool_assignment"
    assert generated["aptitude"] == {"strong": ["STR"], "weak": ["INT"], "origin": "player"}
    initial = plain["sheet"]["creation"]["characteristics"]["values"]
    assert generated["values"]["STR"] == max(initial[a] for a in POOLS["3D6"])
    assert generated["values"]["INT"] == min(initial[a] for a in POOLS["2D6+6"])
    for pool in POOLS.values():
        assert sorted(initial[a] for a in pool) == sorted(generated["values"][a] for a in pool), "no new dice, no crossed pool"
    assert after["STR"] >= before["STR"] and after["INT"] <= before["INT"]
    assert stated["completeness"]["valid"]


def test_revising_an_aptitude_keeps_this_players_own_rolls(kernel):
    plain = begin(kernel)
    initial = plain["sheet"]["creation"]["characteristics"]["values"]
    stated = kernel.ok("setup.draft", {"campaign": CAMPAIGN, "profile": {"aptitude": {"strong": ["DEX"], "origin": "concept"}}})
    assert sorted(stated["sheet"]["creation"]["characteristics"]["values"].values()) == sorted(initial.values())
    cleared = kernel.ok("setup.draft", {"campaign": CAMPAIGN, "profile": {"aptitude": None}})
    assert cleared["sheet"]["creation"]["characteristics"] == plain["sheet"]["creation"]["characteristics"]
    assert cleared["sheet"]["creation"]["luck"] == plain["sheet"]["creation"]["luck"]


def test_an_illegal_aptitude_is_refused_and_keeps_the_valid_draft(kernel):
    original = begin(kernel)
    for patch in ({"strong": ["Strength"], "origin": "player"}, {"strong": ["STR"], "weak": ["STR"], "origin": "player"},
                  {"strong": "STR", "origin": "player"}, {"muscle": ["STR"]}, {"strong": ["STR"]},
                  {"strong": ["STR", "CON"], "origin": "concept"}):
        assert kernel.err("setup.draft", {"campaign": CAMPAIGN, "profile": {"aptitude": patch}})["code"] == "needs"
    assert kernel.ok("setup.steps", {"campaign": CAMPAIGN})["state"]["draft"]["revision"] == original["revision"]


def test_the_interest_list_is_spent_in_the_order_the_player_cares_about(kernel):
    """The other half of the same defect: a stated strength reached the characteristics
    while its own skill stayed level with the fillers listed beside it."""
    begin(kernel)
    long_list = ["Fighting (Brawl)", "Throw", "First Aid", "Climb", "Library Use", "Navigate", "Swim", "Jump"]
    front = kernel.ok("setup.draft", {"campaign": CAMPAIGN, "profile": {"interest_skills": long_list}})
    interest = front["sheet"]["creation"]["skills"]["interest"]
    assert interest["allocation"] == "spread"
    assert interest["source"] == "steps.json create-investigator.interest_allocation"
    assert interest["unspent"] == 0
    assert front["sheet"]["skills"]["Fighting (Brawl)"] > front["sheet"]["skills"]["Jump"]
    back = kernel.ok("setup.draft", {"campaign": CAMPAIGN, "profile": {"interest_skills": list(reversed(long_list))}})
    assert back["sheet"]["skills"]["Jump"] > back["sheet"]["skills"]["Fighting (Brawl)"]
    assert back["sheet"]["creation"]["skills"]["interest"]["spent"] == interest["spent"], "reordering never changes the budget"
    assert back["sheet"]["characteristics"] == front["sheet"]["characteristics"], "and never rerolls"


def test_a_reading_off_the_concept_is_recorded_as_a_reading(kernel):
    """The player named nothing about the body or the mind; the model read the person they
    did describe. That is allowed, stays inside the concept limit, and never poses as a claim."""
    begin(kernel)
    read = kernel.ok("setup.draft", {"campaign": CAMPAIGN,
                                     "profile": {"aptitude": {"strong": ["EDU"], "origin": "concept"}}})
    generated = read["sheet"]["creation"]["characteristics"]
    assert generated["aptitude"]["origin"] == "concept"
    assert generated["method"] == "rolled_pool_assignment"
    assert generated["values"]["EDU"] == max(generated["values"][a] for a in POOLS["2D6+6"])
    said = kernel.ok("setup.draft", {"campaign": CAMPAIGN,
                                     "profile": {"aptitude": {"strong": ["EDU"], "origin": "player"}}})
    assert said["sheet"]["characteristics"] == read["sheet"]["characteristics"], "only the licence differs"
    assert said["sheet"]["creation"]["characteristics"]["aptitude"]["origin"] == "player"
    over = kernel.err("setup.draft", {"campaign": CAMPAIGN,
                                      "profile": {"aptitude": {"strong": ["EDU", "INT"], "origin": "concept"}}})
    assert over["code"] == "needs"
    assert kernel.ok("setup.steps", {"campaign": CAMPAIGN})["state"]["draft"]["revision"] == said["revision"]
