"""Contract §87.8 over the emitted kernel: one junction for a person's name.

§79.2 makes the word a table gives someone with `apply person {who, name}` one of that person's names
wherever a person is named, and §87.7 made `apply npc` honour it. Three other entrances still read only
the graph: `resolve`'s `target` and `actor` (a social check against the word rolled an ordinary check
against a label, and the person's stance never moved), `look focus=npc` with the npc lane methods under
it, and `apply clue from`. The two entrances that already read the word picked when two people carried
it -- `apply person.who` the first owner, the say token the last one written.

Steven Knott is present in the opening; Walter Corbitt is the book's other person. The words below are
what the table calls them. Nothing in the kernel compares them to anything: it reads back what `apply
person` wrote.
"""

from conftest import campaign_dir, narrate, open_turn, read_json
from test_obligation_fold import ACCESS, FAIL, FLAG, PASS, morgue, resolve as gate3  # noqa: F401 -- `morgue` is a fixture

KNOTT = "Steven Knott"
CORBITT = "Walter Corbitt"
EPITHET = "门口的房东"  # what this table calls Knott
SHARED = "那个人"  # a word this table gave two people

SOCIAL = {"intent": "social", "goal": "get the keys and the story", "method": "persuade him", "stakes": "he clams up"}


def name(client, who, word, call_id="t1-c1"):
    client.table("apply", call_id=call_id, effects=[{"kind": "person", "who": who, "name": word}])


def share_one_word(client):
    client.table("apply", call_id="t1-c1", effects=[
        {"kind": "person", "who": KNOTT, "name": SHARED}, {"kind": "person", "who": CORBITT, "name": SHARED}])


def receipts(client, kind):
    return [r for r in client.table("status")["receipts"] if r["kind"] == kind]


def ledger(client):
    return read_json(campaign_dir(client.workspace) / "npc-ledger.json")


# ---- resolve: the person seats -------------------------------------------------------------------

def test_a_table_word_as_target_reaches_the_social_adjudication(kernel):
    open_turn(kernel)
    name(kernel, KNOTT, EPITHET)
    settled = kernel.table("resolve", call_id="t1-c2", action={**SOCIAL, "target": EPITHET})
    # The social adjudication ran against him, with his motives; a miss had routed this to the ordinary check.
    assert settled["decision"] == "social:adjudicate-difficulty", settled["decision"]
    assert settled["outcome"]["npc"] == "steven-knott" and settled["outcome"]["approach"] == "persuade"
    assert "npc_agenda:steven-knott" in settled["outcome"]["motive"]["evidence_refs"]
    [roll] = receipts(kernel, "roll")
    assert roll["npc"] == "steven-knott", roll
    # The call is stored as the Keeper sent it: the same call id with the same word replays, not refuses.
    assert kernel.table("resolve", call_id="t1-c2", action={**SOCIAL, "target": EPITHET}) == {**settled, "replayed": True}
    narrate(kernel, "t1-c3", "他看着她，没有马上回答。")
    interaction = ledger(kernel)["npc-steven-knott"]["interactions"][-1]
    assert interaction["kind"] == "social" and interaction["receipt"] == roll["id"]


def test_a_table_word_as_actor_is_that_npcs_own_roll(kernel):
    open_turn(kernel)
    name(kernel, KNOTT, EPITHET)
    settled = kernel.table("resolve", call_id="t1-c2", action={
        "intent": "investigate", "goal": "size up the visitor", "method": "he looks her over", "actor": EPITHET,
        "skill": "Spot Hidden"})
    assert settled["decision"] == "core-check:ordinary-check"
    [roll] = receipts(kernel, "roll")
    assert roll["actor"] == "steven-knott" and roll["actor_is_investigator"] is False, roll
    assert roll["visibility"] == "keeper"


def test_a_table_word_as_target_settles_exactly_as_the_book_name_does(morgue):
    """Gate #3's Persuade against the archivist, whom `morgue` has already named "Arty" with `apply person`: the same
    seed gives the same settlement by either name, the §134.17 fold included. With the word missing, no fold ran."""
    by_name = gate3(morgue(PASS), target="Arty Wilmot")
    by_word = gate3(morgue(PASS), target="Arty")
    assert by_word == by_name
    assert by_word["obligation"] == {"handle": ACCESS, "step": 1, "counted": "folded", "settled": True}


def test_an_obligation_claimed_against_the_table_word_is_that_persons(morgue):
    """`bindObligation` compared the target to the obligation's person through the graph alone, so the word was refused
    as a check against somebody else."""
    client = morgue(FAIL)
    result = gate3(client, target="Arty", obligation=ACCESS)
    assert result["obligation"]["handle"] == ACCESS and result["obligation"]["settled"] is False
    assert FLAG not in read_json(campaign_dir(client.workspace) / "world.json").get("flags", {})


def test_a_seat_the_graph_answers_is_the_graphs_person_whatever_the_table_called_someone_else(kernel):
    """The first layer with exactly one answer is the person: the book's name beats a table word that collides with it."""
    open_turn(kernel)
    name(kernel, CORBITT, KNOTT)
    settled = kernel.table("resolve", call_id="t1-c2", action={**SOCIAL, "target": KNOTT})
    assert settled["outcome"]["npc"] == "steven-knott"
    assert kernel.table("look", focus="npc", name=KNOTT)["id"] == "steven-knott"


def test_a_word_two_people_carry_refuses_resolve_before_anything_rolls(kernel):
    open_turn(kernel)
    share_one_word(kernel)
    refused = kernel.table_err("resolve", call_id="t1-c2", action={**SOCIAL, "target": SHARED})
    assert refused["code"] == "unknown_entity", refused
    assert sorted(c["name"] for c in refused["details"]["candidates"]) == ["steven-knott", "walter-corbitt"]
    assert receipts(kernel, "roll") == []


# ---- look focus=npc and the npc lane methods -----------------------------------------------------

def test_look_focus_npc_reads_the_table_word(kernel):
    open_turn(kernel)
    name(kernel, KNOTT, EPITHET)
    view = kernel.table("look", focus="npc", name=EPITHET)
    assert view["id"] == "steven-knott" and view["called"]["name"] == EPITHET
    assert view == kernel.table("look", focus="npc", name=KNOTT)


def test_look_focus_npc_refuses_a_word_two_people_carry(kernel):
    open_turn(kernel)
    share_one_word(kernel)
    refused = kernel.table_err("look", focus="npc", name=SHARED)
    assert refused["code"] == "unknown_entity"
    assert sorted(c["name"] for c in refused["details"]["candidates"]) == ["steven-knott", "walter-corbitt"]


def test_npc_perspective_reads_the_table_word(kernel):
    open_turn(kernel)
    name(kernel, KNOTT, EPITHET)
    params = {"campaign": "c1"}
    assert kernel.ok("npc.perspective", {**params, "name": EPITHET}) == kernel.ok("npc.perspective", {**params, "name": KNOTT})


def test_npc_job_reads_the_table_word(kernel):
    open_turn(kernel)
    name(kernel, KNOTT, EPITHET)
    packet = kernel.ok("npc.job", {"campaign": "c1", "name": EPITHET})
    assert packet["npc"]["name"] == KNOTT
    # The same job for the same person: an open one is handed back, whichever name asks.
    assert kernel.ok("npc.job", {"campaign": "c1", "name": KNOTT})["job_id"] == packet["job_id"]


def test_npc_responses_job_reads_the_table_word(kernel):
    open_turn(kernel)
    name(kernel, KNOTT, EPITHET)
    # He has no personality yet, so the answer is that it is pending -- for him, not a refusal of the word.
    assert kernel.ok("npc.responses.job", {"campaign": "c1", "name": EPITHET}) == {"job_id": None, "reason": "personality_pending"}


# ---- apply -----------------------------------------------------------------------------------------

def test_apply_clue_from_reads_the_table_word(kernel):
    open_turn(kernel)
    name(kernel, KNOTT, EPITHET)
    kernel.table("apply", call_id="t1-c2", effects=[{"kind": "clue", "clue": "knott-keys", "from": EPITHET}])
    [clue] = receipts(kernel, "clue")
    assert clue["from"] == "steven-knott", clue


def test_apply_person_who_refuses_a_word_two_people_carry(kernel):
    open_turn(kernel)
    share_one_word(kernel)
    refused = kernel.table_err("apply", call_id="t1-c2", effects=[{"kind": "person", "who": SHARED, "address": "先生"}])
    assert refused["code"] == "unknown_entity", refused
    assert sorted(c["name"] for c in refused["details"]["candidates"]) == ["steven-knott", "walter-corbitt"]
    labels = read_json(campaign_dir(kernel.workspace) / "world.json")["person_labels"]
    assert "address" not in labels["steven-knott"] and "address" not in labels["walter-corbitt"]


# ---- the say token ---------------------------------------------------------------------------------

def test_a_say_token_two_people_carry_stays_a_label(kernel):
    open_turn(kernel)
    share_one_word(kernel)
    delivered = narrate(kernel, "t1-c2", f"门外有人开口。{{{{say:{SHARED}}}}}「走吧。」{{{{/say}}}}")
    assert delivered["speech"][0]["who"] == {"label": SHARED}, delivered["speech"]
