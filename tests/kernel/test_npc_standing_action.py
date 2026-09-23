"""SL-08: an NPC's standing action in a fight is data (contract §11.5.3), over the emitted kernel.

The session view issues `standing_action: {action, basis}` on an NPC's own turn: the Keeper's override, else the
record's authored `combat.action`, else the ruleset table `npc-combat-disposition.json` over the NPC's combat
disposition and the fight's state (hit-point fraction, outnumbered, stance). No disposition, no authored word and
no override: no standing, and the Keeper decides as before.

Corbitt, as the starter prints him (HP 16, three weapons), after the investigator's bare-handed swing and his own
dodge: it is his turn in round 1. Each table row is reached by changing only what that row reads: his authored
disposition (a content copy), his hit points or the investigator's side in the saved fight (a read of the fight's
state), or his stance (a Keeper `apply npc stance` after the swing, folded with the open turn).
"""

import json
import shutil

import pytest

from conftest import CONTENT_DIR, RpcClient, campaign_dir, narrate, open_turn, read_json
from test_rules_families import resolve, walk_to_confrontation

CORBITT = "walter-corbitt"
CORBITT_NODE = "npc-walter-corbitt"
INVESTIGATOR = "thomas-hayes"


def corbitt_record(graph):
    node = next(n for n in graph["nodes"] if n["node_id"] == CORBITT_NODE)
    properties = node.setdefault("properties", {})
    projection = properties.get("runtime_projection")
    return projection["record"] if isinstance(projection, dict) and isinstance(projection.get("record"), dict) else properties


def content_with(tmp_path, combat):
    """A copy of the shipped content with Corbitt's record carrying `combat` (his authored combat fields)."""
    content = tmp_path / "content"
    shutil.copytree(CONTENT_DIR, content)
    path = content / "starters" / "the-haunting" / "module-graph.json"
    graph = json.loads(path.read_text(encoding="utf-8"))
    corbitt_record(graph)["combat"] = combat
    path.write_text(json.dumps(graph, ensure_ascii=False), encoding="utf-8")
    return content


def client_with(tmp_path, combat=None):
    content = content_with(tmp_path, combat) if combat is not None else None
    return RpcClient(tmp_path / "ws", env={"COC_KERNEL_SEED": "7"}, content=content)


def corbitts_turn(client, stance=None):
    """Swing at Corbitt, let him dodge, and hand back the call number after: it is now his turn, no attack pending.
    `stance`, when given, is a Keeper stance write between the swing and the dodge (folded with the open turn)."""
    open_turn(client, "I hit him.")
    n = walk_to_confrontation(client)
    resolve(client, f"t1-c{n}", intent="combat", goal="hit him", method="fists", target="Walter Corbitt", weapon="unarmed")
    n += 1
    if stance is not None:
        client.table("apply", call_id=f"t1-c{n}", effects=[{"kind": "npc", "name": "Walter Corbitt", "stance": stance, "why": "test"}])
        n += 1
    defended = resolve(client, f"t1-c{n}", intent="combat", goal="combat:defend", method="combat:defend", actor="Walter Corbitt", defense="dodge")
    assert defended["session"]["turn_of"] == CORBITT and defended["session"]["pending_defense"] is None
    return n + 1


def edit_fight(client, *, hp_fraction=None, ally=False, investigator=None, corbitt=None, round_delta=0):
    """Change the saved fight's state the table reads: Corbitt's hit points (a fraction of his maximum), an extra
    able participant on the investigator's side (outnumbered), or fields of either participant."""
    path = campaign_dir(client.workspace) / "save" / "combat.json"
    combat = read_json(path)
    for participant in combat["participants"]:
        if participant["actor_id"] == CORBITT:
            if hp_fraction is not None:
                participant["hp_current"] = int(participant["hp_max"] * hp_fraction)
            participant.update(corbitt or {})
        if participant["actor_id"] == INVESTIGATOR:
            participant.update(investigator or {})
    if ally:
        combat["participants"].append({**next(p for p in combat["participants"] if p["actor_id"] == INVESTIGATOR), "actor_id": "a-second-investigator"})
    combat["current_round"] += round_delta
    path.write_text(json.dumps(combat), encoding="utf-8")


def standing(client):
    session = client.table("look", focus="session")["session"]
    assert session["turn_of"] == CORBITT
    return session.get("standing_action")


# ---- no source: the Keeper decides ------------------------------------------------------------

def test_no_disposition_no_authored_word_and_no_override_is_no_standing(tmp_path):
    client = client_with(tmp_path)
    try:
        corbitts_turn(client)
        assert standing(client) is None, "hostile and able, but nothing says how he fights: the Keeper decides"
        card = client.table("look", focus="npc", name="Walter Corbitt")
        assert card["combat_disposition"]["disposition"] is None and card["combat_disposition"]["basis"] is None
        assert card["combat_action"] == {"action": None, "basis": "rule-default"}
    finally:
        client.close()


# ---- the table, row by row --------------------------------------------------------------------

# (disposition, hp fraction, outnumbered, stance written after the swing, expected action). The stance is `hostile`
# unless a row names another: the swing made him a combat target this turn, folded from the open turn's receipts.
TABLE_ROWS = [
    ("fights_to_the_end", 1.0, False, None, "attack"),
    ("fights_to_the_end", 0.25, True, None, "attack"),
    ("fights_then_flees", 1.0, False, None, "attack"),
    ("fights_then_flees", 0.5, False, None, "flee"),
    ("fights_then_flees", 0.75, True, None, "flee"),
    ("fights_then_flees", 0.75, False, None, "attack"),
    ("fights_then_flees", 1.0, False, "neutral", "hold"),
    ("avoids_fighting", 1.0, False, None, "hold"),
    ("avoids_fighting", 1.0, True, None, "flee"),
    ("avoids_fighting", 0.75, False, None, "flee"),
    ("surrenders", 1.0, False, None, "attack"),
    ("surrenders", 0.75, False, None, "hold"),
    ("surrenders", 1.0, True, None, "hold"),
    ("surrenders", 1.0, False, "wary", "hold"),
]


@pytest.mark.parametrize("disposition,fraction,outnumbered,stance,expected", TABLE_ROWS,
                         ids=[f"{row[0]}-hp{row[1]}-{'outnumbered' if row[2] else 'one-on-one'}-{row[3] or 'hostile'}" for row in TABLE_ROWS])
def test_the_rules_default_reads_the_disposition_table(tmp_path, disposition, fraction, outnumbered, stance, expected):
    client = client_with(tmp_path, {"disposition": disposition})
    try:
        corbitts_turn(client, stance=stance)
        edit_fight(client, hp_fraction=fraction, ally=outnumbered)
        issued = standing(client)
        assert issued["action"] == expected and issued["basis"] == "rule-default"
        assert issued["disposition"] == {"disposition": disposition, "basis": "authored"}
        assert issued["read"] == {"hp_fraction": int(16 * fraction) / 16, "outnumbered": outnumbered, "stance": stance or "hostile"}
    finally:
        client.close()


def test_the_stance_is_the_ledger_folded_with_the_open_turn(tmp_path):
    """Turn 1 has not closed, so the committed ledger has no row for Corbitt; the swing this turn makes him hostile."""
    client = client_with(tmp_path, {"disposition": "fights_then_flees"})
    try:
        corbitts_turn(client)
        ledger = campaign_dir(client.workspace) / "npc-ledger.json"
        assert not ledger.exists() or CORBITT_NODE not in read_json(ledger)
        assert standing(client)["read"]["stance"] == "hostile"
    finally:
        client.close()


# ---- the two in-fight conditions --------------------------------------------------------------

def test_an_npc_out_of_the_fight_has_no_standing(tmp_path):
    client = client_with(tmp_path, {"disposition": "fights_to_the_end"})
    try:
        corbitts_turn(client)
        edit_fight(client, corbitt={"conditions": ["fled"]})
        assert standing(client) is None
    finally:
        client.close()


def test_an_attack_without_a_legal_target_is_not_issued(tmp_path):
    client = client_with(tmp_path, {"disposition": "fights_to_the_end"})
    try:
        corbitts_turn(client)
        edit_fight(client, investigator={"conditions": ["unconscious"]})
        session = client.table("look", focus="session")["session"]
        assert session["actions"][0]["targets"] == []
        assert "standing_action" not in session, "the table says attack, and there is no one he can attack"
    finally:
        client.close()


def test_no_standing_while_an_attack_is_pending(tmp_path):
    client = client_with(tmp_path, {"disposition": "fights_to_the_end"})
    try:
        n = corbitts_turn(client)
        strike = resolve(client, f"t1-c{n}", intent="combat", goal="he lunges", method="", actor="Walter Corbitt", target="Thomas Hayes")
        assert strike["session"]["pending_defense"]["for"] == "player"
        assert "standing_action" not in strike["session"]
    finally:
        client.close()


# ---- the book's word --------------------------------------------------------------------------

def test_an_authored_attack_is_issued_with_basis_authored(tmp_path):
    client = client_with(tmp_path, {"action": "attack"})
    try:
        corbitts_turn(client, stance="warm")
        assert standing(client) == {"action": "attack", "basis": "authored"}, "the book says he always attacks; no disposition is read"
        assert client.table("look", focus="npc", name="Walter Corbitt")["combat_action"] == {"action": "attack", "basis": "authored"}
    finally:
        client.close()


@pytest.mark.parametrize("combat,path", [({"action": "flee"}, "combat.action"), ({"disposition": "cowardly"}, "combat.disposition")])
def test_an_authored_word_outside_the_enum_is_refused_where_the_book_is_registered(tmp_path, combat, path):
    """The one validator (§136.8) holds the record's `combat` words to their enums: a book cannot author a flight."""
    client = client_with(tmp_path, combat)
    try:
        refused = client.err("campaign.create", {"id": "c1", "module": "the-haunting", "pregen": INVESTIGATOR, "play_language": "zh-Hans"})
        assert refused["code"] == "invalid_params" and refused["details"]["reason"] == "mechanics_invalid"
        assert [(r["rule"], r["path"].split(".", 3)[-1]) for r in refused["details"]["refusals"]] == [("shape_prose", path)]
    finally:
        client.close()


# ---- the Keeper's overrides -------------------------------------------------------------------

def test_a_keeper_hold_is_a_receipt_survives_a_restart_and_lapses_with_its_round(tmp_path):
    client = client_with(tmp_path, {"disposition": "fights_to_the_end"})
    try:
        n = corbitts_turn(client)
        assert standing(client)["action"] == "attack"
        why = "He hesitates, staring at the relic in the investigator's hand."
        applied = client.table("apply", call_id=f"t1-c{n}", effects=[{"kind": "npc", "name": "Walter Corbitt", "action": "hold", "why": why}])
        receipt = next(r for r in client.table("status")["receipts"] if r["id"] in applied["receipts"])
        assert receipt["kind"] == "npc" and receipt["handle"] == CORBITT and receipt["call_id"] == f"t1-c{n}"
        assert receipt["action"] == "hold" and receipt["previous"] is None and receipt["why"] == why
        assert receipt["combat_id"] == "corbitt-final-combat-t1" and receipt["round"] == 1 and receipt["visibility"] == "keeper"
        assert standing(client) == {"action": "hold", "basis": "keeper", "disposition": {"disposition": "fights_to_the_end", "basis": "authored"}}
        narrate(client, f"t1-c{n + 1}", "Corbitt freezes.")
    finally:
        client.close()

    resumed = RpcClient(tmp_path / "ws", env={"COC_KERNEL_SEED": "7"}, content=tmp_path / "content")
    try:
        world = read_json(campaign_dir(resumed.workspace) / "world.json")
        assert world["npc_action"][CORBITT] == {"action": "hold", "why": why, "turn": 1, "combat_id": "corbitt-final-combat-t1", "round": 1}
        resumed.table("player_input", text="I wait.")
        assert standing(resumed)["basis"] == "keeper", "same fight, same round: the hold stands after a restart"
        assert resumed.table("look", focus="npc", name="Walter Corbitt")["combat_action"] == {"action": "hold", "basis": "keeper"}
        edit_fight(resumed, round_delta=1)
        assert standing(resumed)["basis"] == "rule-default", "a hold holds for its round; the next round reads the table again"
    finally:
        resumed.close()


def test_a_keeper_attack_stands_and_a_disposition_override_replaces_the_book(tmp_path):
    client = client_with(tmp_path, {"disposition": "surrenders"})
    try:
        n = corbitts_turn(client)
        edit_fight(client, hp_fraction=0.75)
        assert standing(client)["action"] == "hold"
        client.table("apply", call_id=f"t1-c{n}", effects=[{"kind": "npc", "name": "Walter Corbitt", "disposition": "fights_to_the_end", "why": "The house holds him; he cannot yield."}])
        assert standing(client) == {"action": "attack", "basis": "rule-default", "disposition": {"disposition": "fights_to_the_end", "basis": "keeper"},
                                    "read": {"hp_fraction": 0.75, "outnumbered": False, "stance": "hostile"}}
        applied = client.table("apply", call_id=f"t1-c{n + 1}", effects=[{"kind": "npc", "name": "Walter Corbitt", "action": "attack", "why": "He lunges."}])
        receipt = next(r for r in client.table("status")["receipts"] if r["id"] in applied["receipts"])
        assert receipt["action"] == "attack" and "combat_id" not in receipt
        assert standing(client)["basis"] == "keeper"
        card = client.table("look", focus="npc", name="Walter Corbitt")
        assert card["combat_disposition"] == {"disposition": "fights_to_the_end", "basis": "keeper"}
        assert card["combat_action"] == {"action": "attack", "basis": "keeper"}
    finally:
        client.close()


def test_an_override_is_refused_whole_without_why_with_another_change_with_an_unknown_word_or_a_hold_outside_a_fight(kernel):
    open_turn(kernel, "I watch Knott.")
    for effect, field in [({"kind": "npc", "name": "Steven Knott", "action": "attack"}, "npc.why"),
                          ({"kind": "npc", "name": "Steven Knott", "disposition": "surrenders"}, "npc.why"),
                          ({"kind": "npc", "name": "Steven Knott", "action": "attack", "to": "here", "why": "x"}, "npc.action"),
                          ({"kind": "npc", "name": "Steven Knott", "action": "attack", "defense": "dodge", "why": "x"}, "npc.defense"),
                          ({"kind": "npc", "name": "Steven Knott", "action": "attack", "disposition": "surrenders", "why": "x"}, "npc.action"),
                          ({"kind": "npc", "name": "Steven Knott", "action": "flee", "why": "x"}, "npc.action"),
                          ({"kind": "npc", "name": "Steven Knott", "disposition": "cowardly", "why": "x"}, "npc.disposition"),
                          ({"kind": "npc", "name": "Steven Knott", "action": "hold", "why": "x"}, "npc.action")]:
        refused = kernel.table_err("apply", call_id="t1-c1", effects=[effect])
        assert refused["code"] == "invalid_params" and refused["details"]["field"] == field, (effect, refused)
    world = read_json(campaign_dir(kernel.workspace) / "world.json")
    assert "npc_action" not in world and "npc_disposition" not in world
    assert kernel.table("status")["receipts"] == []


def test_a_hold_for_someone_outside_the_fight_is_refused(tmp_path):
    client = client_with(tmp_path)
    try:
        n = corbitts_turn(client)
        refused = client.table_err("apply", call_id=f"t1-c{n}", effects=[{"kind": "npc", "name": "Steven Knott", "action": "hold", "why": "x"}])
        assert refused["code"] == "invalid_params" and refused["details"]["field"] == "npc.name"
    finally:
        client.close()


def test_the_standing_action_and_disposition_are_keeper_only(tmp_path):
    client = client_with(tmp_path, {"disposition": "fights_then_flees"})
    try:
        n = corbitts_turn(client)
        why = "Something in the cellar has taken his nerve."
        client.table("apply", call_id=f"t1-c{n}", effects=[{"kind": "npc", "name": "Walter Corbitt", "disposition": "avoids_fighting", "why": why}])
        assert standing(client)["action"] == "hold"
        delivered = narrate(client, f"t1-c{n + 1}", "Corbitt draws back.")
        shown = json.dumps(delivered, ensure_ascii=False) + json.dumps(client.ok("table.view", {"campaign": "c1"}), ensure_ascii=False)
        for word in ("standing_action", "combat_action", "combat_disposition", "npc_disposition", "avoids_fighting", why):
            assert word not in shown
        assert not any(row.get("kind") == "npc" for row in delivered["mechanics"])
    finally:
        client.close()


# ---- the inferred source (§11.5.3 source 2) -----------------------------------------------------

DISPOSITIONS = ["fights_to_the_end", "fights_then_flees", "avoids_fighting", "surrenders"]


def test_a_card_without_a_disposition_carries_what_one_is_inferred_from(kernel):
    """The four closed words with the table's own descriptions, and the person's own text parameters under the
    contract's profile keys: only while the person has no disposition."""
    open_turn(kernel, "I watch Knott.")
    card = kernel.table("look", focus="npc", name="Steven Knott")["combat_disposition"]
    assert card["disposition"] is None and card["basis"] is None
    table = read_json(CONTENT_DIR / "rulesets" / "coc7" / "rules-json" / "npc-combat-disposition.json")
    assert card["options"] == {word: table["dispositions"][word]["description"] for word in DISPOSITIONS}
    assert card["material"] and set(card["material"]) <= {"agenda", "fear", "secret", "voice", "relationship_to_investigators"}
    kernel.table("apply", call_id="t1-c1", effects=[{"kind": "npc", "name": "Steven Knott", "disposition": "surrenders", "why": "He is a landlord, not a brawler."}])
    assert kernel.table("look", focus="npc", name="Steven Knott")["combat_disposition"] == {"disposition": "surrenders", "basis": "keeper"}


def test_an_inferred_disposition_is_a_receipt_is_written_once_and_survives_a_restart(tmp_path):
    client = client_with(tmp_path)
    read = ["agenda", "fear", "voice"]
    try:
        n = corbitts_turn(client)
        assert standing(client) is None
        why = "Inferred once for this campaign from Walter Corbitt's own parameters: agenda, fear, voice."
        applied = client.table("apply", call_id=f"t1-c{n}", effects=[{"kind": "npc", "name": "Walter Corbitt", "disposition": "fights_to_the_end",
                                                                       "why": why, "_inferred": {"read": read}}])
        receipt = next(r for r in client.table("status")["receipts"] if r["id"] in applied["receipts"])
        assert receipt["disposition"] == "fights_to_the_end" and receipt["basis"] == "inferred" and receipt["read"] == read
        assert receipt["previous"] is None and receipt["visibility"] == "keeper"
        assert standing(client)["disposition"] == {"disposition": "fights_to_the_end", "basis": "inferred"}
        # Never inferred twice: a second inferred write is refused whole, whatever it says.
        again = client.table_err("apply", call_id=f"t1-c{n + 1}", effects=[{"kind": "npc", "name": "Walter Corbitt", "disposition": "surrenders",
                                                                            "why": why, "_inferred": {"read": read}}])
        assert again["code"] == "invalid_params" and again["details"]["reason"] == "disposition_already_set"
        narrate(client, f"t1-c{n + 1}", "Corbitt's eyes burn.")
    finally:
        client.close()

    resumed = RpcClient(tmp_path / "ws", env={"COC_KERNEL_SEED": "7"})
    try:
        world = read_json(campaign_dir(resumed.workspace) / "world.json")
        assert world["npc_disposition"][CORBITT] == {"disposition": "fights_to_the_end", "why": why, "turn": 1, "basis": "inferred", "read": read}
        resumed.table("player_input", text="I back away.")
        assert standing(resumed) == {"action": "attack", "basis": "rule-default", "disposition": {"disposition": "fights_to_the_end", "basis": "inferred"},
                                     "read": {"hp_fraction": 1.0, "outnumbered": False, "stance": "hostile"}}
        assert resumed.table("look", focus="npc", name="Walter Corbitt")["combat_disposition"] == {"disposition": "fights_to_the_end", "basis": "inferred"}
        # The Keeper may still rewrite it; that is an override, not a second inference.
        resumed.table("apply", call_id="t2-c1", effects=[{"kind": "npc", "name": "Walter Corbitt", "disposition": "surrenders", "why": "The relic breaks him."}])
        assert standing(resumed)["disposition"] == {"disposition": "surrenders", "basis": "keeper"}
    finally:
        resumed.close()


def test_an_inferred_write_over_the_books_disposition_is_refused(tmp_path):
    client = client_with(tmp_path, {"disposition": "surrenders"})
    try:
        n = corbitts_turn(client)
        refused = client.table_err("apply", call_id=f"t1-c{n}", effects=[{"kind": "npc", "name": "Walter Corbitt", "disposition": "fights_to_the_end",
                                                                           "why": "x", "_inferred": {"read": ["agenda"]}}])
        assert refused["details"]["reason"] == "disposition_already_set"
        assert "material" not in client.table("look", focus="npc", name="Walter Corbitt")["combat_disposition"], "nothing to infer: the book says it"
    finally:
        client.close()
