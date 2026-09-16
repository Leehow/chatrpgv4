"""Slice 9 (#29, contract §17): the NPC layer through the RPC seam -- the dossier the book
authored (§17.2), the ledger this table writes (§17.3), and the projection the keeper plays
from (§17.4).

The ledger is asserted as a fold over receipts: what a settled roll does to a stance, what
the keeper's own `apply npc` does to it, and that replaying the closed turns rebuilds the
same file. Nothing here reads prose."""

import json
import sys
from pathlib import Path

import pytest

from conftest import (CAMPAIGN, KERNEL_DIR, OPENING_SCENE, campaign_dir, narrate, open_turn, read_json)
from test_rules_families import resolve, resolve_err

if str(KERNEL_DIR) not in sys.path:
    sys.path.insert(0, str(KERNEL_DIR))

from coc.module_graph import ModuleGraph  # noqa: E402
from coc.errors import RpcError  # noqa: E402
from coc.npc import StanceTable  # noqa: E402
from coc.rules.tables import RuleTables  # noqa: E402

KNOTT = "npc-steven-knott"
CONTENT = KERNEL_DIR.parent / "content"


def ledger(client):
    return read_json(campaign_dir(client.workspace) / "npc-ledger.json")


def present(client):
    return {p["name"]: p for p in client.table("look", focus="npc")["present"]}


def charm(client, call_id, **extra):
    return resolve(client, call_id, intent="social", goal="get the keys and the story",
                   method="charm him", target="Steven Knott", stakes="he clams up", **extra)


# ---- the authored dossier (§17.2) -----------------------------------------------------------

def test_the_dossier_is_read_the_same_way_from_a_starter_and_a_built_book():
    """§17.2: first-class properties win, the starter's runtime_projection is the fallback,
    and one reading serves both — a book compiled before #29 is never rebuilt."""
    starter = ModuleGraph("the-haunting", CONTENT / "starters" / "the-haunting" / "module-graph.json")
    knott = starter.nodes[KNOTT]
    profile = starter.npc_profile(knott)
    assert profile["agenda"] and profile["fear"] and profile["secret"]
    assert profile["relationship_to_investigators"] == "employer"
    # the starter states his knowledge as `facts`; `npc_knows` reads it as knowledge either way
    assert {entry["handle"] for entry in starter.npc_knows(knott)} == {
        "knott-commission", "knott-research-leads", "knott-macario-summary"}
    assert starter.npc_has_material(knott) is True

    # a node with a stat block and nothing else has no dossier, and says so rather than
    # inventing one -- that is what the brief's `npc_without_material` reports
    bare = {"node_id": "npc-bare", "node_kind": "npc", "name": "Bare",
            "properties": {"STR": 50, "role": "guard"}}
    starter.nodes["npc-bare"] = bare
    assert starter.npc_profile(bare) == {}
    assert starter.npc_has_material(bare) is False


def test_what_someone_would_say_instead_reaches_the_projection():
    """§17.2/§17.4: a lie the book wrote is an `asserts` claim about the clue it is told
    over; a deflection is a line, so it stays in `properties` where the contract keeps
    prose. Both answer the same question for the keeper, so both land in `would_lie_about`."""
    starter = ModuleGraph("the-haunting", CONTENT / "starters" / "the-haunting" / "module-graph.json")
    dooley = starter.npc("Mr. Dooley")
    # he embellishes the burning-eyes account, and he stalls for the price of a paper
    assert [c["object"]["node_id"] for c in starter.npc_claims(dooley, "asserts")] == ["clue-burning-eyes-form"]
    said = starter.npc_would_say(dooley)
    assert any("memory improves" in line for line in said), said
    assert len(said) == 2  # one lie, one deflection

    knott = starter.npc("Steven Knott")
    assert starter.npc_claims(knott, "asserts") == []  # the book gives him no lie
    assert starter.npc_would_say(knott) == [
        "Start with the papers; we can discuss the rest when you have something concrete."]


def test_an_assertion_someone_holds_true_is_a_belief_not_a_lie():
    """§17.2/§17.4: `asserts` covers everything a person would say, and its `truth_status`
    says which kind. Telling the keeper that Gabriela "would lie about" the presence she
    truly saw is a worse error than saying nothing, so the two are read apart."""
    starter = ModuleGraph("the-haunting", CONTENT / "starters" / "the-haunting" / "module-graph.json")
    # a node of its own, so the deflection lines the book gave Dooley do not blur the test
    node = {"node_id": "npc-under-test", "node_kind": "npc", "name": "Under Test", "properties": {}}
    line = starter.nodes["clue-burning-eyes-form"]["summary"]

    def assert_as(status: str) -> tuple[list[str], list[str]]:
        starter.claims_by_subject["npc-under-test"] = [
            {"subject_id": "npc-under-test", "predicate": "asserts", "truth_status": status,
             "object": {"node_id": "clue-burning-eyes-form"}}]
        return starter.npc_would_say(node), starter.npc_beliefs(node)

    # a lie and a rumour are things he would say instead of the truth
    for status in ("authored-lie", "authored-rumor"):
        would_say, beliefs = assert_as(status)
        assert would_say == [line] and beliefs == [], status
    # one he holds true is a belief of his, and never something he would lie about
    would_say, beliefs = assert_as("authored-belief")
    assert beliefs == [line] and would_say == []

    # and the starter projector states the book's own lie as a lie, not as a fact
    dooley = starter.npc("Mr. Dooley")
    assert [c["truth_status"] for c in starter.npc_claims(dooley, "asserts")] == ["authored-lie"]


def test_ties_come_from_the_relations_the_graph_already_has():
    """§17.2: no new relation kind; who someone stands with is read off the graph both ways
    round, and the people in the room sort first (§17.4)."""
    starter = ModuleGraph("the-haunting", CONTENT / "starters" / "the-haunting" / "module-graph.json")
    corbitt = starter.npc("Walter Corbitt")
    kinds = {tie["kind"] for tie in starter.npc_ties(corbitt)}
    assert kinds <= set(starter.npc_ties.__doc__ and
                        ("allied-with", "opposes", "member-of", "controls", "owns", "possesses",
                         "worships", "threatens", "impersonates", "located-in"))


# ---- the stance table (§17.3) ----------------------------------------------------------------

def test_the_stance_numbers_all_live_in_the_table():
    """§17.3: the kernel writes no literal of its own; the thresholds and the deltas are the
    content file's, and an approach the table does not name moves nothing."""
    table = StanceTable(RuleTables(CONTENT / "rulesets" / "coc7" / "rules-json"))
    assert table.words == ["hostile", "wary", "neutral", "warm"]
    assert [table.word(s) for s in (-5, -3, -2, 0, 1, 2, 5)] == [
        "hostile", "hostile", "wary", "neutral", "neutral", "warm", "warm"]
    assert table.delta("persuade", "regular") == 1 and table.delta("persuade", "extreme") == 2
    assert table.delta("intimidate", "regular") == 0 and table.delta("intimidate", "failure") == -1
    assert table.delta("nonesuch", "regular") == 0 and table.delta("persuade", "nonesuch") == 0
    assert table.clamp(99) == 5 and table.clamp(-99) == -5
    assert table.floor_of("warm") == 2 and table.floor_of("hostile") == -5


# ---- apply npc (§17.3, folding in #25) -------------------------------------------------------

def test_apply_npc_moves_someone_on_and_off_the_stage(kernel):
    open_turn(kernel)
    assert "Steven Knott" in present(kernel)
    result = kernel.table("apply", call_id="t1-c1", effects=[
        {"kind": "npc", "name": "Steven Knott", "to": "away", "why": "he leaves for the bank"}])
    assert result["receipts"] == ["npc:steven-knott-t1-c1"]
    assert "Steven Knott" not in present(kernel)
    # and back again: `here` is the active scene
    kernel.table("apply", call_id="t1-c2", effects=[{"kind": "npc", "name": "Steven Knott", "to": "here"}])
    assert "Steven Knott" in present(kernel)
    assert read_json(campaign_dir(kernel.workspace) / "world.json")["npc_presence"]["steven-knott"] == OPENING_SCENE


def test_apply_npc_needs_something_to_do_and_a_word_the_ledger_knows(kernel):
    open_turn(kernel)
    empty = kernel.table_err("apply", call_id="t1-c1", effects=[{"kind": "npc", "name": "Steven Knott"}])
    assert empty["code"] == "invalid_params"
    bad = kernel.table_err("apply", call_id="t1-c1",
                           effects=[{"kind": "npc", "name": "Steven Knott", "stance": "furious"}])
    assert bad["code"] == "invalid_params"
    # the batch did not write: he is still where he was
    assert "Steven Knott" in present(kernel)


def test_the_keeper_can_set_a_stance_and_the_reason_reaches_the_capsule(kernel):
    open_turn(kernel)
    kernel.table("apply", call_id="t1-c1", effects=[
        {"kind": "npc", "name": "Steven Knott", "stance": "warm", "why": "the party found his brother"}])
    narrate(kernel, "t1-c2", "诺特松了口气。")
    row = ledger(kernel)[KNOTT]
    assert row["stance"]["value"] == "warm" and row["stance"]["score"] == 2
    assert row["stance"]["because"][-1]["how"] == "keeper"

    # §17.6: it has to reach the capsule the keeper is handed, not only `look`
    capsule = kernel.table("player_input", text="我再问他一句。")["capsule"]
    knott = {p["name"]: p for p in capsule["present"]}["Steven Knott"]
    assert knott["toward_party"]["stance"] == "warm"
    assert knott["toward_party"]["because"][-1] == "turn 1: keeper set warm: the party found his brother"
    assert knott == present(kernel)["Steven Knott"]  # `look` and the capsule never disagree


# ---- the ledger folds receipts (§17.3) -------------------------------------------------------

def test_a_settled_social_check_moves_the_stance_by_the_table(seeded_four):
    """§17.3: the ledger is a fold over receipts -- a settled social check writes the
    interaction, moves the score by the table's delta for that approach and level, and names
    the receipt that did it. Seeded so the branch that actually moves the score is the one
    under test."""
    open_turn(seeded_four)
    outcome = resolve(seeded_four, "t1-c1", intent="social", goal="get the keys and the story",
                      method="persuade him", target="Steven Knott", stakes="he clams up")["outcome"]
    assert (outcome["approach"], outcome["level"], outcome["passed"]) == ("persuade", "regular", True)
    narrate(seeded_four, "t1-c2", "诺特看着他，慢慢开口。")

    table = StanceTable(RuleTables(CONTENT / "rulesets" / "coc7" / "rules-json"))
    expected = table.delta("persuade", "regular")
    assert expected == 1  # the table's number, restated so a change to it fails here
    row = ledger(seeded_four)[KNOTT]
    interaction = row["interactions"][-1]
    assert interaction["kind"] == "social" and interaction["turn"] == 1
    assert interaction["approach"] == "persuade" and interaction["level"] == "regular"
    assert row["stance"]["score"] == expected and row["stance"]["value"] == table.word(expected)
    # the cause names the receipt that moved it -- the keeper can trace it
    assert row["stance"]["because"][-1]["receipt"] == interaction["receipt"]

    # §17.6: the next turn's capsule says where he stands and why
    capsule = seeded_four.table("player_input", text="我等他回话。")["capsule"]
    knott = {p["name"]: p for p in capsule["present"]}["Steven Knott"]
    assert knott["toward_party"] == {"stance": "neutral", "because": ["turn 1: persuade regular"]}
    assert knott["history"]["met_turns"] == 2


def test_a_social_level_the_table_gives_nothing_for_leaves_the_stance_alone(kernel):
    """§17.3: silence in the table is zero, not a guess -- a failed charm is recorded as an
    interaction and moves nothing."""
    open_turn(kernel)
    outcome = charm(kernel, "t1-c1")["outcome"]
    narrate(kernel, "t1-c2", "诺特没接话。")
    row = ledger(kernel)[KNOTT]
    table = StanceTable(RuleTables(CONTENT / "rulesets" / "coc7" / "rules-json"))
    assert row["interactions"][-1]["kind"] == "social"
    if table.delta(outcome.get("approach"), outcome.get("level")) == 0:
        assert row["stance"] is None


def test_a_pushed_social_failure_still_reaches_the_stance(seeded_one):
    """§17.3: a push settles under its own family (`push-luck`) and its outcome names no
    approach, but it continues the social check it came from and the same person is on the
    other side of it. Found at a live table: a pushed Charm reached the ledger as an
    approachless `push-luck` roll, so `pushed_failure_delta` moved nothing and the keeper
    had to set the stance by hand."""
    open_turn(seeded_one)
    action = {"intent": "social", "goal": "get the keys and the story", "method": "charm him",
              "target": "Steven Knott", "stakes": "he clams up"}
    first = resolve(seeded_one, "t1-c1", **action)["outcome"]
    assert first["passed"] is False and first["approach"] == "charm"
    pushed = resolve(seeded_one, "t1-c2", **{**action, "push": True,
                                             "stakes": "he throws me out"})["outcome"]
    assert pushed["kind"] == "push" and pushed["passed"] is False
    narrate(seeded_one, "t1-c3", "诺特把钥匙收了回去。")

    receipts = {r["id"]: r for r in read_json(campaign_dir(seeded_one.workspace) / "turns" / "0001.json")["receipts"]}
    push_receipt = next(r for r in receipts.values() if r.get("kind") == "roll" and r.get("pushed"))
    # the receipt says what it is, which is what makes the ledger a fold over receipts alone
    assert push_receipt["approach"] == "charm" and push_receipt["npc"] == "steven-knott"

    table = StanceTable(RuleTables(CONTENT / "rulesets" / "coc7" / "rules-json"))
    row = ledger(seeded_one)[KNOTT]
    expected = table.delta("charm", first["level"]) + table.delta("charm", pushed["level"]) + table.pushed_failure_delta
    assert table.pushed_failure_delta == -1  # the table's number, restated so a change fails here
    assert row["stance"]["score"] == expected == -1
    assert row["stance"]["value"] == "wary"
    assert row["stance"]["because"][-1]["receipt"] == push_receipt["id"]

    # §17.4: and the keeper meets him again knowing what was tried, not only that they met.
    # The zero-delta attempt has to show too — that is the one the stance cannot report.
    entry = next(p for p in seeded_one.table("capsule")["present"] if p["name"] == "Steven Knott")
    assert entry["history"]["tried"] == [f"turn 1: charm {first['level']}",
                                         f"turn 1: charm {pushed['level']}"]
    assert entry["history"]["met_turns"] == 2  # the opening turn and this one


def test_the_stance_table_must_say_it_is_the_stance_table():
    """§13.10's law, which the stance table was left out of: content that does not declare
    itself fails closed. Without the check a table of another shape is read silently and
    every approach moves the score by nothing — a table that is there and does nothing looks
    exactly like a table that is working."""
    class Wrong:
        def load(self, _name):
            return {"initial_score": 0, "score_range": [-5, 5], "levels": [], "social": {},
                    "pushed_failure_delta": -1, "combat_target_score": -5}

    with pytest.raises(RpcError) as caught:
        StanceTable(Wrong())
    assert caught.value.code == "campaign_not_ready"
    assert "npc-stance" in caught.value.message


def test_a_death_the_dice_did_not_settle(kernel):
    """§17.3: `dead` reached the ledger only from a session settlement's HP delta, so a person
    killed any other way stayed unmarked for ever and the table went on treating them as
    someone the party could still meet. At the table the sorcerer crumbled to ash under his
    own dagger with no combat rolled, and his ledger row said nothing."""
    open_turn(kernel)
    kernel.table("apply", call_id="t1-c1", effects=[
        {"kind": "npc", "name": "Steven Knott", "dead": True, "why": "用他自己的匕首，没有掷骰"},
    ])
    narrate(kernel, "t1-c2", "他散了。灰落在铺板上。")

    row = ledger(kernel)[KNOTT]
    assert row["dead"]["turn"] == 1 and row["dead"]["why"] == "用他自己的匕首，没有掷骰"
    assert row["dead"]["receipt"].startswith("npc:")
    entry = next(p for p in kernel.table("capsule")["present"] if p["name"] == "Steven Knott")
    assert entry["history"]["dead_since_turn"] == 1


def test_a_thing_bought_from_someone_goes_on_their_account(kernel):
    """§17.3: goods changing hands are part of what this table has been through with a
    person. Found at a live table: the investigator bought a paper and a box of cigars from
    the newsvendor, and the ledger — which folded rolls, clues and deltas but not items —
    had nothing about it, so the next capsule said only that they had met."""
    open_turn(kernel)
    kernel.table("apply", call_id="t1-c1", effects=[
        {"kind": "item", "name": "Boston Globe", "from": "Steven Knott", "label": "今日《环球报》"},
        {"kind": "item", "name": "lucky pen"},  # nobody named: nothing to put on an account
        # Money moves between people too, and the effect had only a subject and a signed
        # delta: "I paid Dooley two dollars" could not be said at all.
        {"kind": "cash", "delta": -2, "source": "quote", "with": "Steven Knott", "why": "买下那份报纸"},
    ])
    narrate(kernel, "t1-c2", "诺特把报纸推过桌面，收了两块钱。")

    row = ledger(kernel)[KNOTT]
    assert [e.get("item") for e in row["exchanged"]] == ["今日《环球报》", None], "the keeper's label, not the id"
    paid = row["exchanged"][1]
    assert (paid["cash"], paid["direction"], paid["currency"]) == (2, "paid", "USD")
    entry = next(p for p in kernel.table("capsule")["present"] if p["name"] == "Steven Knott")
    assert entry["history"]["exchanged"] == ["turn 1: 今日《环球报》", "turn 1: paid 2 USD"]


def test_the_ledger_records_who_handed_a_clue_over(kernel):
    open_turn(kernel)
    kernel.table("apply", call_id="t1-c1",
                 effects=[{"kind": "clue", "clue": "knott-commission", "from": "Steven Knott"}])
    narrate(kernel, "t1-c2", "诺特把委托说清楚了。")
    assert ledger(kernel)[KNOTT]["disclosed"] == [
        {"clue": "knott-commission", "turn": 1, "receipt": "clue:knott-commission-t1"}]
    knott = present(kernel)["Steven Knott"]
    assert knott["history"]["disclosed"] == ["knott-commission"]
    # and the clue he gave now reads as discovered in his own dossier
    assert {f["clue"]: f["discovered"] for f in knott["knows"]}["knott-commission"] is True


def test_turns_present_counts_the_turns_he_was_on_stage(kernel):
    open_turn(kernel)
    narrate(kernel, "t1-c1", "诺特点点头。")
    kernel.table("player_input", text="我再看看他。")
    narrate(kernel, "t2-c1", "他还在那儿。")
    seen = ledger(kernel)[KNOTT]["turns_present"]
    assert seen["first"] == 0 and seen["last"] == 2 and seen["count"] == 3


# ---- rebuild (§17.3, §12.6) ------------------------------------------------------------------

def test_a_lost_ledger_is_rebuilt_from_the_closed_turns(kernel):
    open_turn(kernel)
    kernel.table("apply", call_id="t1-c1", effects=[
        {"kind": "clue", "clue": "knott-commission", "from": "Steven Knott"},
        {"kind": "npc", "name": "Steven Knott", "stance": "wary", "why": "he was pressed too hard"}])
    narrate(kernel, "t1-c2", "他把委托说了，眼神却冷下来。")
    before = ledger(kernel)

    path = campaign_dir(kernel.workspace) / "npc-ledger.json"
    path.unlink()
    kernel.ok("table.open", {"campaign": CAMPAIGN})
    assert json.loads(path.read_text(encoding="utf-8")) == before


def test_the_dossier_vocabulary_has_one_home():
    """§17.2: the words for a person as a person belong to the module contract, so the
    reader prompt, the starter projector, the brief and the table cannot drift apart. Every
    predicate and relation it names must already exist in the contract's own vocabulary --
    the block groups words, it does not add any."""
    import importlib.util

    from coc.module_graph import DOSSIER_PREDICATES, PROFILE_KEYS, TIE_RELATION_KINDS
    from coc.modules import contract
    from coc.modules.playability import NPC_DOSSIER_PREDICATES, NPC_PROFILE_KEYS

    dossier = contract.CONTRACT["actor_dossier"]
    assert tuple(dossier["profile_keys"]) == PROFILE_KEYS == NPC_PROFILE_KEYS
    assert tuple(dossier["claim_predicates"]) == DOSSIER_PREDICATES == NPC_DOSSIER_PREDICATES
    assert tuple(dossier["tie_relation_kinds"]) == TIE_RELATION_KINDS
    assert set(dossier["claim_predicates"]) <= contract.RELATION_KINDS
    assert set(dossier["tie_relation_kinds"]) <= contract.RELATION_KINDS

    spec = importlib.util.spec_from_file_location("starter_graph", KERNEL_DIR.parent / "scripts" / "starter_graph.py")
    starter_graph = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(starter_graph)
    assert starter_graph.NPC_PROFILE_KEYS == PROFILE_KEYS

    # and the reader is asked for every one of them by name
    reader = (CONTENT / "setup" / "visual-reader.md").read_text(encoding="utf-8")
    assert contract.vocabulary()["actor_dossier"] == dossier
    assert "task.vocabulary.actor_dossier" in reader


def test_a_profile_key_the_spine_gains_arrives_at_the_table(tmp_path):
    """Contract 28.4: the capsule used to keep its own copy of the five keys and their
    Keeper-facing names, so a key added to the spine would be extracted, stored, returned by
    `npc_profile` -- and then dropped on the way to the table. This gives the contract a sixth
    key and a person who has it, and requires it to arrive under its declared label, in both
    the per-turn dossier and the focused view. Put the copy back in `dossier()` and this fails.

    It runs against the emitted kernel because only that one takes its vocabulary from the
    `--content` it was given; `coc.modules.contract` loads the repo's own file at import."""
    import os
    import shutil

    from conftest import RpcClient, create_campaign, WORKTREE

    entry = WORKTREE / "build" / "kernel" / "rpc.mjs"
    command = json.loads(os.environ["COC_TS_MODS_COMMAND"]) if os.environ.get("COC_TS_MODS_COMMAND") \
        else ["node", str(entry)]
    if command[-1] == str(entry) and not entry.is_file():
        pytest.skip("build the emitted kernel first (npm run build:runtime)")

    content = tmp_path / "content"
    shutil.copytree(WORKTREE / "content", content)

    contract_path = content / "modules" / "module-graph-contract-v3.json"
    spine = json.loads(contract_path.read_text(encoding="utf-8"))
    spine["actor_dossier"]["profile_keys"].append("language")
    spine["actor_dossier"]["profile_labels"]["language"] = "speaks"
    contract_path.write_text(json.dumps(spine), encoding="utf-8")

    graph_path = content / "starters" / "the-haunting" / "module-graph.json"
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    node = next(n for n in graph["nodes"] if n["node_id"] == KNOTT)
    node.setdefault("properties", {})["language"] = "English; his Italian is broken"
    graph_path.write_text(json.dumps(graph), encoding="utf-8")

    client = RpcClient(tmp_path / "ws", command=command, content=content)
    try:
        create_campaign(client)
        knott = present(client)["Steven Knott"]
        assert knott["speaks"] == "English; his Italian is broken"
        assert knott["wants"] and knott["role"] and knott["fears"]  # the core labels did not move
        assert client.table("look", focus="npc", name="Steven Knott")["speaks"] == knott["speaks"]
    finally:
        client.close()



# ---- the dossier survives the build path (§17.2) ---------------------------------------------

def test_a_reader_s_dossier_claims_reach_the_graph_and_the_table(kernel, tmp_path):
    """§17.2/§17.7: the asks added to the reader are worth nothing unless what it writes
    survives the three gates, the merge, and the projection. This walks one book's
    `believes` and `hides` claims all the way to `look focus=<npc>` -- the path a re-read
    of a real book would take, with no model in the loop."""
    from module_helpers import indexed, request, claim, observed, write, finish
    from coc.modules.visual import check_draft
    from coc.modules.store import ModuleStore
    mid, _ = indexed(kernel, tmp_path)
    request(kernel, mid, "opening")
    job = claim(kernel, mid)
    observed(job)
    frozen = json.loads((Path(__file__).parent / "fixtures/legacy-module/module-graph.json").read_text())
    nodes = [{k: n[k] for k in ("node_id", "node_kind", "name", "aliases", "summary", "properties", "visibility") if k in n}
             for n in frozen["nodes"]]
    for n in nodes:
        if n["node_kind"] == "module": n["node_id"] = f"module-{mid}"
        n["source_refs"] = [{"page": 1}]
        if n["node_kind"] in ("asset", "handout"): n.get("properties", {}).pop("asset_ref", None)
        if n["node_kind"] == "npc" and "skills" in n.get("properties", {}):
            n["properties"]["mechanics"] = {"profile": {"skills": n["properties"].pop("skills")}}
    claims = [{k: c[k] for k in ("subject_id", "predicate", "object", "truth_status", "visibility", "reason", "known_by_ids", "asserted_by_ids", "validity") if k in c}
              for c in frozen["claims"]]
    for c in claims:
        if c["subject_id"].startswith("module-"): c["subject_id"] = f"module-{mid}"
        c["source_refs"] = [{"page": 1}]
    def node(kind, slug, name, summary):
        return {"node_id": f"{kind}-{slug}", "node_kind": kind, "name": name, "summary": summary, "source_refs": [{"page": 1}]}
    def relation(subject, predicate, target):
        return {"subject_id": subject, "predicate": predicate, "object": {"node_id": target},
                "truth_status": "authored-fact", "source_refs": [{"page": 1}]}
    nodes += [
        node("secret", "sailor-entered-at-night", "船工深夜进货栈", "老周见过船工深夜进货栈，但不敢说。"),
        node("location", "dock-teahouse-building", "码头茶棚", "雾锁码头的茶棚。"),
        node("location", "jetty", "栈桥", "从茶棚向北通往废弃货栈。"),
        node("rule", "teahouse-questioning", "茶棚问话", "向老周打听要一次说服检定。"),
        node("ending", "sailor-recovered", "船工获救", "船工被找回，货栈的门重新锁上。"),
    ]
    claims += [relation(a, p, b) for a, p, b in [
        ("scene-dock-teahouse", "occurs-at", "location-dock-teahouse-building"),
        ("location-jetty", "located-in", "location-dock-teahouse-building"),
        ("scene-dock-teahouse", "uses-rule", "rule-teahouse-questioning"),
        ("scene-dock-teahouse", "may-lead-to", "ending-sailor-recovered"),
        ("npc-lao-zhou", "hides", "secret-sailor-entered-at-night"),
        ("npc-lao-zhou", "knows", "clue-brass-whistle"),
        ("npc-lao-zhou", "believes", "secret-sailor-entered-at-night"),
    ]]
    draft = {"nodes": nodes, "claims": claims, "node_refs": [], "coverage": {}, "dependencies": [], "critical": [], "ready_nodes": [n["node_id"] for n in nodes]}
    # Keep the frozen shape checks and include the current source-scope review contract.
    required = [*check_draft(draft, job)["required_review"], "/coverage"]
    write(Path(job["work_dir"])/"draft.json", draft)
    write(Path(job["work_dir"])/"review.json", {"checked": [{"paths": required, "verdict": "supported", "source_refs": [{"page": 1}]}], "missing": []})
    finish(kernel, job)
    graph = ModuleGraph(mid, ModuleStore(kernel.workspace).graph_path(mid))
    zhou = graph.npc("老周")
    assert [c["object"]["node_id"] for c in graph.npc_claims(zhou, "hides")] == ["secret-sailor-entered-at-night"]
    assert [e["handle"] for e in graph.npc_knows(zhou)] == ["brass-whistle"]
    assert graph.npc_claim_lines(zhou, "believes") == ["老周见过船工深夜进货栈，但不敢说。"]
    # the machine's own `known_by_ids` reading (§17.2), computed rather than stored
    assert graph.npcs_knowing(graph.nodes["clue-brass-whistle"]) == ["npc-lao-zhou"]
    # and a person with a dossier is no longer counted as material-less by the brief
    assert graph.npc_has_material(zhou) is True

    # §13.1: a book models a building as a place with rooms hanging off it, and the capsule
    # has to walk that second hop or the rooms never reach the table.
    from coc.capsule import where_section
    where = where_section(graph, {"active_scene": "dock-teahouse", "discovered_clues": [],
                                  "scene_trail": [], "npc_presence": {}},
                          graph.scene("dock-teahouse"), material_of=lambda _h: "ready")
    assert where["places"] == [{"name": "栈桥", "line": "从茶棚向北通往废弃货栈。"}]
    # §13.1: and what the book fixes for this scene. `uses-rule` was wired by every build and
    # read by nothing, so the roll the book prescribes — here, and for the reaction to a
    # newsvendor, and for the hazard on a staircase — never reached the Keeper standing in it.
    assert where["rules"] == [{"name": "茶棚问话", "line": "向老周打听要一次说服检定。"}]
    # §13.1: and the closes this scene can lead to. An ending is not somewhere the party
    # walks — it is a settlement — and nothing told the Keeper one was in reach, so a
    # scenario played to its end simply stopped with the campaign still `active`.
    assert where["endings"] == [{"name": "船工获救", "via": "may-lead-to",
                                 "line": "船工被找回，货栈的门重新锁上。"}]

    # §17.4: and it is the projection the keeper reads, not just the graph
    from coc.capsule import npc_entry
    entry = npc_entry(graph, {"discovered_clues": [], "npc_presence": {"lao-zhou": "dock-teahouse"}},
                      zhou, {}, {})
    assert entry["believes"] == ["老周见过船工深夜进货栈，但不敢说。"]
    assert [k["clue"] for k in entry["knows"]] == ["brass-whistle"]


# ---- an NPC who helps (§17.9) ----------------------------------------------------------------

def test_the_books_numbers_read_out_of_either_shape():
    """§17.9 L1: a starter carries an actor's stat block nested under
    `runtime_projection.record.mechanics.profile`; a book built from a PDF writes it flat on
    `properties`. Only the nested shape was ever read, so every actor in every built book
    answered nothing — which is also why social defence found no skill for anyone and chases
    handed out default DEX. Nothing is derived: a skill printed as prose carries no number,
    and HP and Move are not skills."""
    starter = ModuleGraph("the-haunting", CONTENT / "starters" / "the-haunting" / "module-graph.json")
    corbitt = starter.npc("Walter Corbitt")
    profile = starter.actor_profile(corbitt)
    assert profile["skills"]["Fighting"] == 50 and profile["characteristics"]["DEX"] == 35
    assert starter.actor_skill_value(corbitt, "fighting") == 50, "names match the way names match"
    assert starter.actor_skill_value(corbitt, "Medicine") is None, "the book gives him none"

    flat = {"node_id": "npc-doc", "node_kind": "npc", "name": "医生",
            "properties": {"STR": 50, "HP": 11, "Move": 8, "Medicine": 65, "Dodge": "17% (Hard 8%)"}}
    profile = starter.actor_profile(flat)
    assert profile["characteristics"] == {"STR": 50}
    assert profile["derived"] == {"HP": 11, "Move": 8}
    assert profile["skills"] == {"Medicine": 65}, "prose carries no number and is not guessed at"
    assert starter.actor_skill_value(flat, "Dodge") is None

    # Producer and consumer, tied: the reader is asked for exactly the shape this reads, and
    # told what a stat line copied as printed costs. One built book had eleven actors and not
    # a usable skill among them because the ask said "as printed".
    ask = (CONTENT / "setup" / "visual-reader.md").read_text(encoding="utf-8")
    assert "properties.mechanics.profile" in ask and '{"Spot Hidden": 60' in ask
    for key in ("STR", "CON", "DEX", "POW", "EDU"):
        assert key in ask, key
    assert "cannot be used for a roll" in ask


def test_an_npc_acts_for_the_party_and_the_roll_is_theirs(kernel):
    """§17.9 L2: `actor: <NPC>` was refused outside a live combat or chase, and the healing
    family bound the rescuer to the acting investigator regardless — so a doctor stitching a
    hand rolled the *patient's* Medicine at 4%, and consulting anyone was worse than useless.
    Books rarely print skills for a minor NPC, so the keeper pins one; the kernel asks rather
    than inventing, because a number it invents is one it would invent differently next time
    and the second doctor would not be as good as the first."""
    open_turn(kernel)
    action = {"intent": "investigate", "goal": "把伤口缝好", "method": "他给我清创缝合",
              "actor": "Steven Knott", "skill": "Medicine"}
    asked = resolve_err(kernel, "t1-c1", **action)
    assert asked["code"] == "needs" and asked["details"]["needs"]["field"] == "npc.skill"
    assert asked["details"]["actor"] == "steven-knott" and asked["details"]["skill"] == "Medicine"
    assert "apply npc" in asked["fix"], "the refusal names the way out of itself"

    kernel.table("apply", call_id="t1-c2", effects=[
        {"kind": "npc", "name": "Steven Knott", "skill": {"name": "Medicine", "value": 65},
         "why": "书上没写，桌上定为称职的医生"}])
    settled = resolve(kernel, "t1-c3", **action)["outcome"]
    assert settled["skill"] == "Medicine" and settled["target"] == 65, "his number, not the sheet's"

    narrate(kernel, "t1-c4", f"他把线收紧。医学 {settled['roll']}，目标 65。")
    row = ledger(kernel)[KNOTT]
    assert row["skills"]["Medicine"]["value"] == 65 and row["skills"]["Medicine"]["turn"] == 1
    assert row["skills"]["Medicine"]["why"] == "书上没写，桌上定为称职的医生"


@pytest.mark.parametrize(("skill", "value"), [("Climb", 60), ("STR", 70)])
def test_an_ordinary_npc_helper_uses_their_target_and_receipt_identity(kernel, skill, value):
    open_turn(kernel, "Ask Knott to haul the investigator up with a rope.")
    kernel.table("apply", call_id="t1-c1", effects=[
        {"kind": "npc", "name": "Steven Knott", "skill": {"name": skill, "value": value},
         "why": "A stable ability for the helper in this isolated test."}])
    result = resolve(kernel, "t1-c2", actor="Steven Knott", target="Thomas Hayes", intent="move",
                     goal="Haul the investigator to safety", method="Knott works the rope", skill=skill,
                     stakes="The helper cannot raise the investigator")
    assert result["outcome"]["target"] == value
    receipt = next(r for r in kernel.table("status")["receipts"] if r["id"] == result["receipt"])
    assert receipt["actor"] == "steven-knott" and receipt["target"] == value
    assert receipt["check"]["investigator_id"] == "steven-knott"
    assert not result["continuations"], "an NPC check does not offer the player's Push or Luck"
    assert not any("investigator sheet" in hint for hint in result.get("hints", []))


def test_an_ordinary_npc_helper_needs_their_missing_skill_without_using_player_base(kernel):
    open_turn(kernel)
    error = resolve_err(kernel, "t1-c1", actor="Steven Knott", intent="move",
                        goal="Lead the pack animal", method="Knott takes its reins", skill="Animal Handling")
    assert error["code"] == "needs" and error["details"]["needs"]["field"] == "npc.skill"
    assert error["details"]["actor"] == "steven-knott"
    assert kernel.table("status")["receipts"] == []


def test_an_ordinary_npc_check_uses_the_authored_characteristic_without_a_pin(kernel):
    from test_rules_families import walk_to_confrontation

    open_turn(kernel)
    call = walk_to_confrontation(kernel)
    result = resolve(kernel, f"t1-c{call}", actor="Walter Corbitt", intent="move", skill="STR",
                     goal="Lift the obstruction", method="He lifts it with both arms")
    receipt = next(r for r in kernel.table("status")["receipts"] if r["id"] == result["receipt"])
    assert result["outcome"]["target"] == 90
    assert receipt["actor"] == "walter-corbitt" and receipt["target"] == 90


def test_an_npc_pin_cannot_replace_an_authored_value_but_can_fill_a_missing_skill(kernel, tmp_path):
    from module_helpers import indexed, opening, finish, write

    mid, _ = indexed(kernel, tmp_path)
    job, draft, _ = opening(kernel, mid)
    draft["nodes"][2]["properties"]["mechanics"]["profile"]["characteristics"]["STR"] = 70
    write(Path(job["work_dir"]) / "draft.json", draft)
    finish(kernel, job)
    kernel.ok("campaign.create", {"id": CAMPAIGN, "module": mid, "play_language": "en"})
    from setup_helpers import confirmed_investigator
    confirmed_investigator(kernel, campaign=CAMPAIGN, name="Ada")
    kernel.ok("setup.complete", {"campaign": CAMPAIGN})
    kernel.table("open")
    kernel.table("narrate", call_id="t0-c1", text="Lena waits at the dock.")
    kernel.table("player_input", text="Ask Lena to help.")
    ledger_path = campaign_dir(kernel.workspace) / "npc-ledger.json"
    before = ledger_path.read_bytes() if ledger_path.exists() else None
    error = kernel.table_err("apply", call_id="t1-c1", effects=[
        {"kind": "npc", "name": "Lena", "skill": {"name": "STR", "value": 55},
         "why": "The compact view did not list her strength."}])
    assert error["code"] == "invalid_params"
    assert error["details"]["field"] == "npc.skill" and error["details"]["authored_value"] == 70
    assert "source" in error["message"] and "70" in error["fix"]
    assert (ledger_path.read_bytes() if ledger_path.exists() else None) == before
    assert kernel.table("status")["receipts"] == []
    kernel.table("apply", call_id="t1-c1", effects=[
        {"kind": "npc", "name": "Lena", "skill": {"name": "First Aid", "value": 40},
         "why": "The source has no First Aid value."},
        {"kind": "npc", "name": "Lena", "skill": {"name": "STR", "value": 70},
         "why": "Keep the source's existing strength."}])
    kernel.table("narrate", call_id="t1-c2", text="Lena prepares to help.")
    skills = ledger(kernel)["npc-lena"]["skills"]
    assert skills["First Aid"]["value"] == 40 and skills["STR"]["value"] == 70


def test_visual_npc_properties_reach_the_keeper_without_turning_belief_into_truth():
    from coc.capsule import npc_view
    graph = ModuleGraph('the-haunting', CONTENT / 'starters/the-haunting/module-graph.json')
    node = graph.npc('Steven Knott')
    node['properties'].update(biography='A source-authored upbringing.',
        knowledge=['The expedition leaves on Monday.'], beliefs=['He suspects a human conspiracy.'],
        lies=['He claims to be a merchant.'])
    view = npc_view(graph, {}, node)
    assert view['properties']['biography'] == 'A source-authored upbringing.'
    assert view['knowledge'] == ['The expedition leaves on Monday.']
    assert 'He suspects a human conspiracy.' in view['believes']
    assert 'He claims to be a merchant.' in graph.npc_would_say(node)


def test_a_belief_about_a_person_does_not_import_their_secret_biography():
    graph = ModuleGraph('the-haunting', CONTENT / 'starters/the-haunting/module-graph.json')
    believer = graph.npc('Steven Knott')
    target = graph.npc('Walter Corbitt')
    reason = 'He believes the owner is an ordinary recluse.'
    graph.claims_by_subject[believer['node_id']] = [{
        'subject_id': believer['node_id'], 'predicate': 'believes', 'object': {'node_id': target['node_id']},
        'truth_status': 'authored-belief', 'reason': reason}]
    assert graph.npc_beliefs(believer) == [reason]
    graph.out_rel[believer['node_id']].append({'relation_kind': 'impersonates',
        'from_node_id': believer['node_id'], 'to_node_id': believer['node_id']})
    assert all(tie['node']['node_id'] != believer['node_id'] for tie in graph.npc_ties(believer))
