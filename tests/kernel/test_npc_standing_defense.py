"""SL-07: an NPC's standing defence is data (contract §11.5.2), over the emitted kernel.

The three sources in order -- the book's tactic, the rules default from the numbers the profile builder makes, the
Keeper's override with a receipt -- and where each is read: `pending_defense.standing` of an NPC defender and the
Keeper's NPC card. Also the two defects SL-02 found beside it: the player's `none` that `ask` refused, and a
handout already handed over that the table kept offering.

Corbitt, as the starter prints him: Fighting 50, Dodge 17. The dodge branch and the tie copy the content and change
only his Dodge, so each case differs from the next by the one number the rule reads.
"""

import json
import shutil

from conftest import CONTENT_DIR, RpcClient, campaign_dir, narrate, open_turn, read_json
from test_rules_families import resolve, walk_to_confrontation

CORBITT = "walter-corbitt"
CORBITT_NODE = "npc-walter-corbitt"


def corbitt_record(graph):
    node = next(n for n in graph["nodes"] if n["node_id"] == CORBITT_NODE)
    properties = node.setdefault("properties", {})
    projection = properties.get("runtime_projection")
    return projection["record"] if isinstance(projection, dict) and isinstance(projection.get("record"), dict) else properties


def content_with(tmp_path, change):
    """A copy of the shipped content with Corbitt's record changed by `change(record)`."""
    content = tmp_path / "content"
    shutil.copytree(CONTENT_DIR, content)
    path = content / "starters" / "the-haunting" / "module-graph.json"
    graph = json.loads(path.read_text(encoding="utf-8"))
    change(corbitt_record(graph))
    path.write_text(json.dumps(graph, ensure_ascii=False), encoding="utf-8")
    return content


def with_dodge(value):
    def change(record):
        record["mechanics"]["profile"]["skills"]["Dodge"] = value
    return change


def melee_attack(client, n):
    """The investigator swings at Corbitt bare-handed: a melee attack, so all three defences are issued."""
    return resolve(client, f"t1-c{n}", intent="combat", goal="hit him", method="fists", target="Walter Corbitt", weapon="unarmed")


def standing_after_melee(client):
    open_turn(client, "I hit him.")
    n = walk_to_confrontation(client)
    attack = melee_attack(client, n)
    pending = attack["session"]["pending_defense"]
    assert pending["for"] == "npc" and pending["actor"] == CORBITT
    assert pending["options"] == ["dodge", "fight_back", "none"], "the standing narrows nothing: the options stay as issued"
    return pending["standing"], attack, n


# ---- the rules default: both branches, the tie, and the firearm mapping -------------------------

def test_rule_default_fights_back_when_fighting_is_at_least_dodge(kernel):
    standing, attack, _ = standing_after_melee(kernel)
    assert standing == {"defense": "fight_back", "basis": "rule-default"}  # Fighting 50 >= Dodge 17
    assert attack["pending_choice"]["for"] == "keeper" and "rule-default" not in json.dumps(attack["pending_choice"])
    # The same standing is on every read of the session, not only on the attack's result.
    assert kernel.table("look", focus="session")["session"]["pending_defense"]["standing"] == standing


def test_rule_default_dodges_when_dodge_is_higher(tmp_path):
    client = RpcClient(tmp_path / "ws", content=content_with(tmp_path, with_dodge(60)))
    try:
        standing, _, _ = standing_after_melee(client)
        assert standing == {"defense": "dodge", "basis": "rule-default"}  # Fighting 50 < Dodge 60
    finally:
        client.close()


def test_rule_default_fights_back_on_a_tie(tmp_path):
    client = RpcClient(tmp_path / "ws", content=content_with(tmp_path, with_dodge(50)))
    try:
        standing, _, _ = standing_after_melee(client)
        assert standing == {"defense": "fight_back", "basis": "rule-default"}  # "at least": 50 >= 50
    finally:
        client.close()


def test_a_firearm_attack_maps_the_standing_to_diving_for_cover(kernel):
    open_turn(kernel, "I shoot him.")
    n = walk_to_confrontation(kernel)
    attack = resolve(kernel, f"t1-c{n}", intent="combat", goal="shoot him", method="revolver", target="Walter Corbitt",
                     weapon=".38 Revolver")
    pending = attack["session"]["pending_defense"]
    assert pending["options"] == ["dodge", "none"]
    # The rule says fight back (50 >= 17); against a firearm that reads as dodge, the engine's dive for cover.
    assert pending["standing"] == {"defense": "dodge", "basis": "rule-default"}
    defend = resolve(kernel, f"t1-c{n + 1}", intent="combat", goal="combat:defend", method="combat:defend",
                     actor="Walter Corbitt", defense=pending["standing"]["defense"])
    assert defend["decision"] == "combat:defend" and defend["outcome"]["defense"] == "dive_for_cover"


def test_a_player_defender_has_no_standing(kernel):
    open_turn(kernel, "I shoot him.")
    n = walk_to_confrontation(kernel)
    resolve(kernel, f"t1-c{n}", intent="combat", goal="shoot", method="revolver", target="Walter Corbitt", weapon=".38 Revolver")
    resolve(kernel, f"t1-c{n + 1}", intent="combat", goal="x", method="", actor="Walter Corbitt", defense="none")
    strike = resolve(kernel, f"t1-c{n + 2}", intent="combat", goal="he lunges", method="", actor="Walter Corbitt",
                     target="Thomas Hayes")
    pending = strike["session"]["pending_defense"]
    assert pending["for"] == "player" and "standing" not in pending


# ---- the book's tactic ------------------------------------------------------------------------

def test_an_authored_tactic_is_issued_with_basis_authored(tmp_path):
    def authored(record):
        record["combat"] = {"defense": "dodge"}  # the book says he dodges, though his Fighting beats his Dodge
    client = RpcClient(tmp_path / "ws", content=content_with(tmp_path, authored))
    try:
        standing, _, _ = standing_after_melee(client)
        assert standing == {"defense": "dodge", "basis": "authored"}
        assert client.table("look", focus="npc", name="Walter Corbitt")["combat_tactic"] == {"defense": "dodge", "basis": "authored"}
    finally:
        client.close()


def test_an_authored_word_outside_the_enum_is_refused_at_registration(tmp_path):
    """§136.6 item 11: `combat.defense` is the registered seat of the `tactic` shape and its one validator
    refuses a word outside the three at registration; §11.5.2's fall-through is reached only by state written
    before §136, never by a shipped starter."""
    def authored(record):
        record["combat"] = {"defense": "parry"}
    client = RpcClient(tmp_path / "ws", content=content_with(tmp_path, authored))
    try:
        error = client.err("campaign.create", {"id": "refused-tactic", "module": "the-haunting", "pregen": "thomas-hayes",
                                               "play_language": "zh-Hans"})
        assert error["code"] == "invalid_params" and error["details"]["reason"] == "mechanics_invalid"
        assert any("defense" in refusal.get("path", "") for refusal in error["details"]["refusals"]), error
    finally:
        client.close()


# ---- the Keeper's override ----------------------------------------------------------------------

def test_a_keeper_override_is_a_receipt_changes_the_standing_and_survives_a_restart(tmp_path):
    client = RpcClient(tmp_path / "ws")
    try:
        open_turn(client, "I go down to face him.")
        n = walk_to_confrontation(client)
        why = "Cornered against the coffin, he only tries to get out of the way."
        applied = client.table("apply", call_id=f"t1-c{n}", effects=[{"kind": "npc", "name": "Walter Corbitt", "defense": "dodge", "why": why}])
        receipt = next(r for r in client.table("status")["receipts"] if r["id"] in applied["receipts"])
        assert receipt["kind"] == "npc" and receipt["handle"] == CORBITT and receipt["call_id"] == f"t1-c{n}"
        assert receipt["defense"] == "dodge" and receipt["previous"] is None and receipt["why"] == why
        assert receipt["visibility"] == "keeper"
        assert client.table("look", focus="npc", name="Walter Corbitt")["combat_tactic"] == {"defense": "dodge", "basis": "keeper"}
        # A second override replaces the first, and its receipt says what it replaced.
        again = client.table("apply", call_id=f"t1-c{n + 1}", effects=[{"kind": "npc", "name": "Walter Corbitt", "defense": "none", "why": "He gives up."}])
        second = next(r for r in client.table("status")["receipts"] if r["id"] in again["receipts"])
        assert second["defense"] == "none" and second["previous"] == "dodge"
        narrate(client, f"t1-c{n + 2}", "He sags against the wall.")
    finally:
        client.close()

    # A fresh kernel on the same workspace: the override is committed world state, read again on the next fight.
    resumed = RpcClient(tmp_path / "ws")
    try:
        assert read_json(campaign_dir(resumed.workspace) / "world.json")["npc_defense"][CORBITT] == {"defense": "none", "why": "He gives up.", "turn": 1}
        assert resumed.table("look", focus="npc", name="Walter Corbitt")["combat_tactic"] == {"defense": "none", "basis": "keeper"}
        turn = resumed.table("player_input", text="I hit him.")["turn"]
        attack = resolve(resumed, f"t{turn}-c1", intent="combat", goal="hit him", method="fists", target="Walter Corbitt", weapon="unarmed")
        assert attack["session"]["pending_defense"]["standing"] == {"defense": "none", "basis": "keeper"}
        # The player's client reads the table view: the NPC's tactic is not in it.
        view = json.dumps(resumed.ok("table.view", {"campaign": "c1"}), ensure_ascii=False)
        assert '"basis": "keeper"' not in view and "He gives up." not in view and "npc_defense" not in view
    finally:
        resumed.close()


def test_a_keeper_override_is_refused_whole_without_why_with_another_change_or_with_an_unknown_word(kernel):
    open_turn(kernel, "I watch Knott.")
    for effect, field in [({"kind": "npc", "name": "Steven Knott", "defense": "dodge"}, "npc.why"),
                          ({"kind": "npc", "name": "Steven Knott", "defense": "dodge", "to": "here", "why": "x"}, "npc.defense"),
                          ({"kind": "npc", "name": "Steven Knott", "defense": "parry", "why": "x"}, "npc.defense")]:
        refused = kernel.table_err("apply", call_id="t1-c1", effects=[effect])
        assert refused["code"] == "invalid_params" and refused["details"]["field"] == field
    unknown = kernel.table_err("apply", call_id="t1-c1", effects=[{"kind": "npc", "name": "Steven Knott", "defense": "parry", "why": "x"}])
    assert unknown["details"]["options"] == ["dodge", "fight_back", "none"]
    assert "npc_defense" not in read_json(campaign_dir(kernel.workspace) / "world.json")
    assert kernel.table("status")["receipts"] == []


def test_the_tactic_is_keeper_only(kernel):
    open_turn(kernel, "I watch Knott.")
    why = "He has decided to swing at anyone who grabs him."
    kernel.table("apply", call_id="t1-c1", effects=[{"kind": "npc", "name": "Steven Knott", "defense": "fight_back", "why": why}])
    card = kernel.table("look", focus="npc", name="Steven Knott")
    assert card["combat_tactic"] == {"defense": "fight_back", "basis": "keeper"}
    delivered = narrate(kernel, "t1-c2", "Knott squares his shoulders.")
    shown = json.dumps(delivered, ensure_ascii=False) + json.dumps(kernel.ok("table.view", {"campaign": "c1"}), ensure_ascii=False)
    assert "combat_tactic" not in shown and "npc_defense" not in shown and why not in shown
    assert not any(row.get("kind") == "npc" for row in delivered["mechanics"])


def test_the_card_reads_the_rule_from_the_profile_and_names_no_word_without_one(kernel):
    open_turn(kernel, "I watch Knott.")
    # Corbitt's printed numbers: Fighting 50 >= Dodge 17.
    assert kernel.table("look", focus="npc", name="Walter Corbitt")["combat_tactic"] == {"defense": "fight_back", "basis": "rule-default"}
    # The starter prints no numbers for Knott, so the rule has nothing to compare.
    assert kernel.table("look", focus="npc", name="Steven Knott")["combat_tactic"] == {"defense": None, "basis": "rule-default"}


# ---- SL-02 defect 1: the player's own `none` ---------------------------------------------------

def test_ask_accepts_the_none_the_kernel_offers_the_player(kernel):
    """§11.5: the investigator's choice is dodge / fight back / no defence, and §11.11: `none` is legal everywhere.
    The kernel offers `none` in `pending_defense.options`; `ask kind: mechanics` refused it (SL-02, turns 6 and 8)."""
    open_turn(kernel, "I shoot him.")
    n = walk_to_confrontation(kernel)
    resolve(kernel, f"t1-c{n}", intent="combat", goal="shoot", method="revolver", target="Walter Corbitt", weapon=".38 Revolver")
    resolve(kernel, f"t1-c{n + 1}", intent="combat", goal="x", method="", actor="Walter Corbitt", defense="none")
    strike = resolve(kernel, f"t1-c{n + 2}", intent="combat", goal="he lunges", method="", actor="Walter Corbitt", target="Thomas Hayes")
    pending = strike["pending_choice"]
    assert pending["for"] == "player" and pending["options"] == ["dodge", "fight_back", "none"]
    asked = kernel.table("ask", call_id=f"t1-c{n + 3}", kind="mechanics", options=pending["options"], binds=pending["name"],
                         text="The knife swings at you.")
    assert asked["pending_choice"]["options"] == ["dodge", "fight_back", "none"]
    assert asked["interaction"]["kind"] == "mechanics"


# ---- SL-02 defect 2: a handout already handed over --------------------------------------------

def test_a_handout_already_shown_is_marked_by_world_state(kernel):
    open_turn(kernel, "I read the letter.")
    assets = kernel.table("capsule")["where"]["assets"]
    handout = next(a for a in assets if a["kind"] == "handout")
    assert "shown" not in handout
    assert kernel.table("apply.options")["context"]["handouts_shown"] == []
    kernel.table("apply", call_id="t1-c1", effects=[{"kind": "handout", "name": handout["name"]}])
    after = next(a for a in kernel.table("capsule")["where"]["assets"] if a["name"] == handout["name"])
    assert after["shown"] is True
    shown = kernel.table("apply.options")["context"]["handouts_shown"]
    assert shown == read_json(campaign_dir(kernel.workspace) / "world.json")["handouts_shown"] and len(shown) == 1
