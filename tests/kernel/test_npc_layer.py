"""Slice 9 (#29, contract §17): the NPC layer through the RPC seam -- the dossier the book
authored (§17.2), the ledger this table writes (§17.3), and the projection the keeper plays
from (§17.4).

The ledger is asserted as a fold over receipts: what a settled roll does to a stance, what
the keeper's own `apply npc` does to it, and that replaying the closed turns rebuilds the
same file. Nothing here reads prose."""

import json
import sys

from conftest import (CAMPAIGN, KERNEL_DIR, OPENING_SCENE, campaign_dir, narrate, open_turn, read_json)
from test_rules_families import resolve

if str(KERNEL_DIR) not in sys.path:
    sys.path.insert(0, str(KERNEL_DIR))

from coc.module_graph import ModuleGraph  # noqa: E402
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
    reader = (CONTENT / "setup" / "reader.md").read_text(encoding="utf-8")
    for word in list(dossier["profile_keys"]) + list(dossier["claim_predicates"]):
        assert f"`{word}`" in reader, word


# ---- the dossier survives the build path (§17.2) ---------------------------------------------

def test_a_reader_s_dossier_claims_reach_the_graph_and_the_table(kernel, tmp_path):
    """§17.2/§17.7: the asks added to the reader are worth nothing unless what it writes
    survives the three gates, the merge, and the projection. This walks one book's
    `believes` and `hides` claims all the way to `look focus=<npc>` -- the path a re-read
    of a real book would take, with no model in the loop."""
    from module_helpers import (TINY_ID, bind_tiny, claim, module_dir, node, packet_for, plan_whole_book,
                                reader_shard, review, span_with, write_shard)

    bind_tiny(kernel, tmp_path)
    section_id = plan_whole_book(kernel)
    packet, work_dir = packet_for(kernel, section_id)
    shard = reader_shard(packet)

    # what the page actually says about him: he saw the sailor go in at night, and he is timid
    seen = span_with(packet, "见过船工深夜进货栈")
    timid = span_with(packet, "嘴碎但胆小")
    assert seen and timid
    shard["nodes"].append(node("secret", "sailor-entered-at-night", "船工深夜进货栈", [seen],
                               "老周见过船工深夜进货栈，但不敢说。"))
    shard["claims"] += [
        claim("npc-lao-zhou", "hides", "secret-sailor-entered-at-night", [seen]),
        claim("npc-lao-zhou", "knows", "clue-brass-whistle", [span_with(packet, "一枚铜哨")]),
        claim("npc-lao-zhou", "believes", "secret-sailor-entered-at-night", [timid]),
    ]
    write_shard(work_dir, shard)
    report = review(kernel, section_id)
    assert report["accepted"], report["findings"]
    kernel.ok("module.accept", {"module_id": TINY_ID, "section_id": section_id})
    assembled = kernel.ok("module.assemble", {"module_id": TINY_ID})
    assert assembled["merge"]["conflicts"] == 0 and assembled["merge"]["dangling_relations"] == 0

    graph = ModuleGraph(TINY_ID, module_dir(kernel.workspace) / "module-graph.json")
    zhou = graph.npc("老周")
    assert [c["object"]["node_id"] for c in graph.npc_claims(zhou, "hides")] == ["secret-sailor-entered-at-night"]
    assert [e["handle"] for e in graph.npc_knows(zhou)] == ["brass-whistle"]
    assert graph.npc_claim_lines(zhou, "believes") == ["老周见过船工深夜进货栈，但不敢说。"]
    # the machine's own `known_by_ids` reading (§17.2), computed rather than stored
    assert graph.npcs_knowing(graph.nodes["clue-brass-whistle"]) == ["npc-lao-zhou"]
    # and a person with a dossier is no longer counted as material-less by the brief
    assert graph.npc_has_material(zhou) is True

    # §17.4: and it is the projection the keeper reads, not just the graph
    from coc.capsule import npc_entry
    entry = npc_entry(graph, {"discovered_clues": [], "npc_presence": {"lao-zhou": "dock-teahouse"}},
                      zhou, {}, {})
    assert entry["believes"] == ["老周见过船工深夜进货栈，但不敢说。"]
    assert [k["clue"] for k in entry["knows"]] == ["brass-whistle"]
