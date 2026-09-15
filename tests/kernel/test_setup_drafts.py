"""Actual draft values, acknowledgment and commit are one versioned contract."""
import copy
import json
import shutil
from pathlib import Path

from conftest import CAMPAIGN, CONTENT_DIR, RpcClient, campaign_dir, read_json


def profile():
    return {"name": "Helen", "occupation": "Journalist", "age": 29, "sex": "female",
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


def test_sex_is_required_and_the_issue_says_how_to_draft_it(kernel):
    kernel.ok("campaign.create", {"id": CAMPAIGN, "module": "the-haunting", "play_language": "en"})
    missing = profile()
    missing.pop("sex")
    error = kernel.err("setup.draft", {"campaign": CAMPAIGN, "profile": missing})
    assert error["code"] == "needs"
    assert any(issue.startswith("sex is required") for issue in error["details"]["issues"])
    for empty in ("", "   "):
        assert kernel.err("setup.draft", {"campaign": CAMPAIGN, "profile": {**profile(), "sex": empty}})["code"] == "needs"


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


# ---- the door a package opens: setup context and the aptitude gate (contract §26) ----

def test_a_setting_up_campaign_gets_the_setup_shape_from_mods_context(kernel):
    begin(kernel)
    context = kernel.ok("mods.context", {"campaign": CAMPAIGN})
    assert "guided-creation" in [row["id"] for row in context["active"]], "the built-in is on by default"
    assert {"setup.guidance.v1", "setup.aptitude.v1"} <= set(context["capabilities"])
    guide = next(row for row in context["setup"] if row["mod"] == "guided-creation")
    assert guide["settings"] == {"max_guided_turns": 3}
    assert "Guided Creation" in guide["instruction"]
    assert "instructions" not in context and "pending_contacts" not in context, "no capsule shape before the world is open"


def test_without_the_package_prose_cannot_move_a_characteristic(kernel):
    begin(kernel)
    kernel.ok("mods.configure", {"campaign": CAMPAIGN, "id": "guided-creation", "enabled": False})
    context = kernel.ok("mods.context", {"campaign": CAMPAIGN})
    assert "guided-creation" not in [row["id"] for row in context["active"]]
    assert context["setup"] == [] and "setup.aptitude.v1" not in context["capabilities"]
    refused = kernel.err("setup.draft", {"campaign": CAMPAIGN,
                                          "profile": {"aptitude": {"strong": ["STR"], "origin": "player"}}})
    assert refused["code"] == "needs"
    assert refused["details"]["capability"] == "setup.aptitude.v1"
    assert "guided-creation" not in refused["details"]["active"]
    plain = kernel.ok("setup.draft", {"campaign": CAMPAIGN, "profile": {"age": 31}})
    assert plain["sheet"]["creation"]["method"] == "rolled", "the core is the dice in table order"
    kernel.ok("mods.configure", {"campaign": CAMPAIGN, "id": "guided-creation", "enabled": True})
    opened = kernel.ok("setup.draft", {"campaign": CAMPAIGN,
                                        "profile": {"aptitude": {"strong": ["STR"], "origin": "player"}}})
    assert opened["sheet"]["creation"]["method"] == "rolled_pool_assignment"


def test_the_players_own_trade_stays_on_the_card_beside_the_entry(kernel):
    """A nurse has no line in occupations.json. The entry is what the budget hangs off; the
    player's words are what the table must still read, so both are on the sheet."""
    kernel.ok("campaign.create", {"id": CAMPAIGN, "module": "the-haunting", "play_language": "zh-Hans"})
    nurse = {**profile(), "occupation": "Doctor of Medicine", "occupation_stated": "教会医院的夜班护士",
             "occupation_skills": ["First Aid", "Language (Other: Latin)", "Medicine", "Psychology", "Science (Biology)", "Science (Pharmacy)", "Spot Hidden", "Listen"]}
    draft = kernel.ok("setup.draft", {"campaign": CAMPAIGN, "profile": nurse})
    assert draft["sheet"]["occupation"] == "Doctor of Medicine"
    assert draft["sheet"]["occupation_stated"] == "教会医院的夜班护士"
    kernel.ok("setup.confirm", {"campaign": CAMPAIGN, "revision": draft["revision"], "consent": "delegated"})
    card = read_json(campaign_dir(kernel.workspace) / "party" / "investigator.json")
    assert card["occupation_stated"] == "教会医院的夜班护士", "the written card keeps the player's words"
    kernel.ok("setup.complete", {"campaign": CAMPAIGN})
    opened = kernel.ok("table.open", {"campaign": CAMPAIGN})
    party = json.dumps(opened, ensure_ascii=False)
    assert "教会医院的夜班护士" in party, "the table reads the player's words, not only the entry"


def test_a_stated_trade_must_be_words_or_absent(kernel):
    draft = begin(kernel)
    assert draft["sheet"]["occupation_stated"] is None
    for bad in ("", "   ", 7, ["nurse"]):
        assert kernel.err("setup.draft", {"campaign": CAMPAIGN, "profile": {"occupation_stated": bad}})["code"] == "needs"
    assert kernel.ok("setup.steps", {"campaign": CAMPAIGN})["state"]["draft"]["revision"] == draft["revision"]


def test_a_starting_weapon_is_named_the_way_play_names_it(kernel):
    """`apply item weapon` takes a table id or the printable name and puts the printable name on the
    card. Creation took the id alone and said so to nobody: the refusal listed skills, occupations and
    backstory categories, and left the Keeper to guess `revolver_38` from a hundred and six entries."""
    kernel.ok("campaign.create", {"id": CAMPAIGN, "module": "the-haunting", "play_language": "zh-Hans"})
    printable = kernel.ok("setup.draft", {"campaign": CAMPAIGN, "profile": {**profile(), "era": "1920s", "weapons": [".38 Automatic"]}})
    assert [weapon["name"] for weapon in printable["sheet"]["weapons"]] == [".38 Automatic"]
    assert printable["sheet"]["weapons"][0]["damage_die"] == "1D10"
    by_id = kernel.ok("setup.draft", {"campaign": CAMPAIGN, "profile": {"weapons": ["revolver_38"]}})
    assert [weapon["name"] for weapon in by_id["sheet"]["weapons"]] == [".38 Automatic"], "the id is a way in, never the name on the card"
    assert "revolver_38" not in by_id["sheet"]["equipment"]
    assert ".38 Automatic" in by_id["sheet"]["equipment"]


def test_a_weapon_the_rulebook_never_printed_is_refused_with_the_profiles_and_a_place_to_put_it(kernel):
    """The Keeper drafts in the play language, so the miss is the common case, not the odd one."""
    kernel.ok("campaign.create", {"id": CAMPAIGN, "module": "the-haunting", "play_language": "zh-Hans"})
    error = kernel.err("setup.draft", {"campaign": CAMPAIGN, "profile": {**profile(), "era": "1920s", "weapons": ["袖口单发袖珍手枪"]}})
    assert error["code"] == "needs"
    issue = next(issue for issue in error["details"]["issues"] if "袖口单发袖珍手枪" in issue)
    assert "details.weapons" in issue and "equipment" in issue, "name the catalog and where a non-profile belongs"
    assert ".38 Automatic" in error["details"]["weapons"], "the profiles are on the refusal, not left to be guessed"
    assert "revolver_38" not in error["details"]["weapons"], "offered by the name the card will carry"
    era = json.loads((Path(__file__).resolve().parents[2] / "content/rulesets/coc7/rules-json/weapons.json").read_text(encoding="utf-8"))["weapons"]
    modern = [entry["display_name"] for entry in era.values() if entry.get("eras") == ["modern"]]
    assert modern and not [name for name in modern if name in error["details"]["weapons"]], "a 1920s draft is not offered modern guns"
    assert kernel.ok("setup.draft", {"campaign": CAMPAIGN, "profile": {**profile(), "era": "1920s", "weapons": []}})["completeness"]["valid"]


def authored_era_content(tmp_path, era):
    """A copy of the starter whose book declares the era this campaign is actually set in."""
    content = tmp_path / "content"
    shutil.copytree(CONTENT_DIR, content)
    path = content / "starters" / "the-haunting" / "module-graph.json"
    graph = json.loads(path.read_text(encoding="utf-8"))
    node = next(node for node in graph["nodes"] if node["node_kind"] == "module")
    document = next(entry for entry in node["properties"]["runtime_projection"]["documents"]
                    if entry["filename"] == "module-meta.json")
    document["root"]["era"] = era
    path.write_text(json.dumps(graph, ensure_ascii=False), encoding="utf-8")
    return content


# The playtested book: the authored era is prose naming two years the rulebook never tabulated.
AUTHORED_ERA = "1895 (default); investigators then enter 1287"


def test_an_era_the_rulebook_never_tabulated_builds_the_card_and_says_what_stood_in(tmp_path):
    """A PDF book set in 1895 left a table with no investigator at all: the draft refused, told the
    Keeper to keep setup blocked, and the Keeper truthfully told the player the campaign could not
    start. A finance column the rulebook never printed is not a reason to have no character. The
    table's own nominated period stands in, and every place the number is sourced says which setting
    it stood in for, so the substitution is auditable from the card rather than silent."""
    client = RpcClient(tmp_path / "workspace", content=authored_era_content(tmp_path, AUTHORED_ERA))
    try:
        client.ok("campaign.create", {"id": CAMPAIGN, "module": "the-haunting", "play_language": "en"})
        default_period = json.loads((CONTENT_DIR / "rulesets/coc7/rules-json/cash-assets.json")
                                    .read_text(encoding="utf-8"))["default_period"]
        draft = client.ok("setup.draft", {"campaign": CAMPAIGN, "profile": profile()})
        assert draft["completeness"]["valid"], "an untabulated setting must not cost the table its investigator"
        sheet = draft["sheet"]
        assert sheet["era"] == default_period, "the card is built against a period the rulebook actually prints"
        assert sheet["setting_era"] == AUTHORED_ERA, "the authored setting is kept, never rewritten into a table key"
        finance = sheet["finance"]
        assert finance is not None and finance["period"] == default_period
        assert finance["source"] == f"cash-assets.periods.{default_period}", "the numbers name the row they came from"
        assert finance["substituted_for"] == AUTHORED_ERA, "a stand-in period is on the card, not inferred from a missing match"
        trace = sheet["creation"]["finance"]
        assert trace["available"] is True and trace["source"] == f"cash-assets.periods.{default_period}"
        assert trace["substituted_for"] == AUTHORED_ERA and default_period in trace["note"]
        assert sheet["cash"] == f"{finance['cash']['amount']} {finance['cash']['currency']}"
        # The point of all of this: this campaign can now reach the table.
        client.ok("setup.previewed", {"campaign": CAMPAIGN, "revision": draft["revision"]})
        client.ok("setup.confirm", {"campaign": CAMPAIGN, "revision": draft["revision"], "consent": "approved"})
        assert client.ok("setup.complete", {"campaign": CAMPAIGN})["status"] == "ready_for_table"
    finally:
        client.close()


def test_a_period_the_agent_invents_is_still_refused_with_the_closed_set(tmp_path):
    """The stand-in is the kernel's floor for an authored setting, not a licence for the setup agent
    to pass a table key of its own invention; an explicit choice is still checked against the table."""
    client = RpcClient(tmp_path / "workspace", content=authored_era_content(tmp_path, AUTHORED_ERA))
    try:
        client.ok("campaign.create", {"id": CAMPAIGN, "module": "the-haunting", "play_language": "en"})
        error = client.err("setup.draft", {"campaign": CAMPAIGN, "profile": {**profile(), "era": AUTHORED_ERA}})
        assert error["code"] == "needs" and error["details"]["field"] == "era"
        assert error["details"]["source_era"] == AUTHORED_ERA
        table = json.loads((CONTENT_DIR / "rulesets/coc7/rules-json/cash-assets.json").read_text(encoding="utf-8"))
        assert error["details"]["options"] == list(table["periods"]), "the closed set is the table's own periods"
        assert "blocked" not in (error.get("fix") or ""), "the refusal must not hand the agent a dead end"
        # The agent's own semantic pick from the closed set is honoured, and still records the setting.
        picked = client.ok("setup.draft", {"campaign": CAMPAIGN, "profile": {**profile(), "era": "modern"}})
        assert picked["sheet"]["era"] == "modern"
        assert picked["sheet"]["finance"]["substituted_for"] == AUTHORED_ERA
        assert picked["sheet"]["finance"]["source"] == "cash-assets.periods.modern"
    finally:
        client.close()
