"""Contract §143.19 (docs/specs/npc-acts-first.md D10, ticket 20), over the emitted kernel: what a person brings out.

The act step (§143.3) writes what a surprise of the stakes die let a generated act bring out as one host-only npc
effect: `_draws: {weapon, price_id}` for a rulebook weapon (D9's path: `world.npc_weapons`, which the fight reads), and
`_produces: {price_id} | {name}, description` for anything else -- one object instance owned by the person in the
ADR-0005 registry, named by the book's name or the table's own, of a definition with no number in it. The kernel
extension alone sets these keys on the clerk's `npc_act` calls; the RPC seam here stands where that host stands.

From the next turn on the thing is in the person's `npc.situation` `at_hand.holdings`, and it is an ordinary object:
the investigator can take it with `object {from, to}`.
"""

import json

from conftest import CONTENT_DIR, RpcClient, campaign_dir, narrate, open_turn, read_json

KNOTT = "steven-knott"
PHOTO = "一张泛黄的全家福"
ACT = "诺特从上衣内袋摸出一张泛黄的全家福，攥在手里给你看。"
EQUIPMENT = json.loads((CONTENT_DIR / "rulesets" / "coc7" / "rules-json" / "equipment.json").read_text(encoding="utf-8"))["records"]
UMBRELLA = next(row for row in EQUIPMENT if row["era"] == "1920s" and row["name"] == "Umbrella")
DERRINGER = next(row for row in EQUIPMENT if row["era"] == "1920s" and (row.get("entity_ref") or {}).get("entity_id") == "automatic_25_derringer")


def landed(client, result):
    """The receipts an apply wrote (its result lists their ids), as the turn holds them."""
    ids = set(result["receipts"])
    return [r for r in client.table("status")["receipts"] if r["id"] in ids]


def produce(client, call_id, **carried):
    return landed(client, client.table("apply", call_id=call_id, effects=[{"kind": "npc", "name": "Steven Knott", "_produces": carried}]))


def holdings(client):
    return client.ok("npc.situation", {"campaign": "c1", "name": "Steven Knott"})["at_hand"]["holdings"]


def world(client):
    return read_json(campaign_dir(client.workspace) / "world.json")


def instances_of(client, handle=KNOTT):
    return [item for item in world(client).get("objects", {}).get("instances", {}).values() if item["owner"] == {"kind": "npc", "id": handle, "name": "Steven Knott"}]


def test_a_thing_of_the_tables_own_and_one_the_book_prices_are_his_from_the_next_turn(tmp_path):
    client = RpcClient(tmp_path / "ws", env={"COC_KERNEL_SEED": "1"})
    try:
        open_turn(client, "I tell Knott I will not take the job.")
        assert holdings(client) == [], "the starter gives him nothing to hold"
        table = produce(client, "t1-c1", name=PHOTO, description=ACT)
        [own] = [r for r in table if r.get("produced")]
        assert own["produced"] == {"name": PHOTO, "source": "table"} and own["kind"] == "npc" and own["visibility"] == "keeper"
        book = produce(client, "t1-c2", price_id=UMBRELLA["price_id"], description="诺特抄起门边的雨伞。")
        [priced] = [r for r in book if r.get("produced")]
        assert priced["produced"] == {"name": "Umbrella", "source": "catalog", "record": UMBRELLA["price_id"]}, "named as the book names it"
        drawn = landed(client, client.table("apply", call_id="t1-c3", effects=[{"kind": "npc", "name": "Steven Knott",
                                                                    "_draws": {"weapon": "automatic_25_derringer", "price_id": DERRINGER["price_id"]}}]))
        [pistol] = [r for r in drawn if r.get("draws")]
        assert pistol["produced"] == {"name": DERRINGER["name"], "source": "catalog", "record": DERRINGER["price_id"]}
        narrate(client, "t1-c4", "诺特攥着一张旧照片，另一只手摸到了雨伞。")

        client.table("player_input", text="I look at what he is holding.")
        held = holdings(client)
        assert PHOTO in held and "Umbrella" in held, held
        assert any("Derringer" in name for name in held), f"a drawn weapon is his with no stat block too: {held}"

        # The object registry: owned by him, a definition with no number in it, described by the act.
        items = {item["name"]: item for item in instances_of(client)}
        assert set(items) == {PHOTO, "Umbrella"}
        definitions = world(client)["objects"]["definitions"]
        for name, description in ((PHOTO, ACT), ("Umbrella", "诺特抄起门边的雨伞。")):
            definition = definitions[items[name]["definition"]]
            assert definition["category"] == "item" and definition["parameters"] == {"effects": []} and definition["traits"] == []
            assert definition["description"] == description and definition["player_view"] == {"description": description, "fields": []}
            assert items[name]["state"] == {"ammo": None, "charges": None, "condition": "intact"}, "no number anywhere"
        assert UMBRELLA["price_id"] in definitions[items["Umbrella"]["definition"]]["basis"], "the book's record is the basis"

        # An ordinary object from here on: the investigator can take it.
        taken = landed(client, client.table("apply", call_id="t2-c1", effects=[{"kind": "object", "name": PHOTO, "from": "Steven Knott", "to": "Thomas Hayes",
                                                                  "handover": "taken", "why": "I snatch the photograph"}]))
        assert any(r["kind"] == "item" and r["name"] == PHOTO for r in taken), taken
        assert PHOTO not in holdings(client)
    finally:
        client.close()


def test_the_same_thing_again_is_not_a_second_one_and_a_name_someone_else_holds_stays_theirs(tmp_path):
    client = RpcClient(tmp_path / "ws", env={"COC_KERNEL_SEED": "1"})
    try:
        open_turn(client, "I tell Knott I will not take the job.")
        produce(client, "t1-c1", name=PHOTO, description=ACT)
        again = produce(client, "t1-c2", name=PHOTO, description=ACT)
        [receipt] = [r for r in again if r.get("produced")]
        assert receipt["produced"]["name"] == PHOTO and len(instances_of(client)) == 1, "shown again, not duplicated"
        client.table("apply", call_id="t1-c3", effects=[{"kind": "object", "name": PHOTO, "from": "Steven Knott", "to": "Thomas Hayes",
                                                          "handover": "taken", "why": "I snatch it"}])
        third = produce(client, "t1-c4", name=PHOTO, description=ACT)
        [other] = [r for r in third if r.get("produced")]
        assert other["produced"]["name"] == f"{PHOTO} ({other['label']})", other["produced"]
        assert [item["name"] for item in instances_of(client)] == [other["produced"]["name"]], "his is told apart; the investigator's keeps its name"
    finally:
        client.close()


def test_what_the_kernel_refuses(tmp_path):
    client = RpcClient(tmp_path / "ws", env={"COC_KERNEL_SEED": "1"})
    try:
        open_turn(client, "I tell Knott I will not take the job.")
        refused = {
            "no such record": {"price_id": "eq.1920s.nothing.here", "description": ACT},
            "a weapon record is drawn, not produced": {"price_id": DERRINGER["price_id"], "description": ACT},
            "a name and a record at once": {"price_id": UMBRELLA["price_id"], "name": PHOTO, "description": ACT},
            "neither": {"description": ACT},
            "no description": {"name": PHOTO},
            "a name on two lines": {"name": f"{PHOTO}\n另一张", "description": ACT},
            "an unknown key": {"name": PHOTO, "description": ACT, "damage": "1D6"},
        }
        for n, (label, carried) in enumerate(refused.items(), start=1):
            error = client.err("table.apply", {"campaign": "c1", "call_id": f"t1-c{n}", "effects": [{"kind": "npc", "name": "Steven Knott", "_produces": carried}]})
            assert error["code"] == "invalid_params", (label, error)
        error = client.err("table.apply", {"campaign": "c1", "call_id": "t1-c20", "effects": [{"kind": "npc", "name": "Steven Knott", "stance": "hostile",
                                                                                                "_produces": {"name": PHOTO, "description": ACT}}]})
        assert error["code"] == "invalid_params", "what is brought out is its own effect"
        wrong = client.err("table.apply", {"campaign": "c1", "call_id": "t1-c21", "effects": [{"kind": "npc", "name": "Steven Knott",
                                                                                                "_draws": {"weapon": "automatic_25_derringer", "price_id": UMBRELLA["price_id"]}}]})
        assert wrong["code"] == "invalid_params", "a drawn weapon's record is that weapon's"
        assert instances_of(client) == [] and "npc_weapons" not in world(client), "nothing landed"
    finally:
        client.close()


def situation(client):
    return client.ok("npc.situation", {"campaign": "c1", "name": "Steven Knott"})


def close_turn(client, turn, text):
    """Deliver the turn; §142.7 refuses the first delivery that owes an intention's result once, the second goes out."""
    first = client.call("table.narrate", {"campaign": "c1", "call_id": f"t{turn}-c90", "text": text})
    if not first["ok"]:
        narrate(client, f"t{turn}-c91", text)


def test_what_his_own_act_brought_out_says_when_and_by_which_act(tmp_path):
    """§143.29 (ticket 30; table D2's copper badge, brought out on turn 6 and shown again on 9, 14 and 15): from then on
    the packet's `at_hand.brought_out` says what an earlier act of his brought out that he still holds -- the turn it came
    out and, when the write named the act's row, that row and where it stands now. Structure only: the instance's
    `brought_out`, the drawn weapon's row."""
    client = RpcClient(tmp_path / "ws", env={"COC_KERNEL_SEED": "1"})
    try:
        open_turn(client, "I grab Knott by the collar.")
        assert "brought_out" not in situation(client)["at_hand"], "nothing brought out yet: no section"
        # The act step's shape: the act opens its row, and what it brings out is stamped with that row.
        opened = landed(client, client.table("apply", call_id="t1-c1", effects=[{"kind": "npc", "name": "Steven Knott", "intends": ACT,
                                                                                    "outcome": "attempted", "_generated": True}]))
        ref = next(r["intent"]["ref"] for r in opened if r.get("intent"))
        client.table("apply", call_id="t1-c2", effects=[{"kind": "npc", "name": "Steven Knott", "intent_ref": ref, "intent_outcome": "attempted",
                                                         "_produces": {"name": PHOTO, "description": ACT}}])
        # A drawn weapon whose write named no row: its turn only.
        client.table("apply", call_id="t1-c3", effects=[{"kind": "npc", "name": "Steven Knott",
                                                         "_draws": {"weapon": "automatic_25_derringer", "price_id": DERRINGER["price_id"]}}])
        [item] = [item for item in instances_of(client) if item["name"] == PHOTO]
        assert item["brought_out"] == {"by": KNOTT, "turn": 1, "ref": ref}, item
        [weapon] = world(client)["npc_weapons"][KNOTT]
        assert weapon["turn"] == 1 and "ref" not in weapon, weapon
        close_turn(client, 1, "诺特攥着一张旧照片，另一只手摸到了抽屉里的东西。")

        client.table("player_input", text="I tell him to put it away.")
        client.table("apply", call_id="t2-c1", effects=[{"kind": "npc", "name": "Steven Knott", "intent_ref": ref, "intent_outcome": "abandoned",
                                                         "why": "海斯没看那张照片"}])
        # Shown again: the same thing, the same origin -- not a second one, not a later turn.
        client.table("apply", call_id="t2-c2", effects=[{"kind": "npc", "name": "Steven Knott", "_produces": {"name": PHOTO, "description": ACT}}])
        view = situation(client)
        held = view["at_hand"]["holdings"]
        pistol = next(name for name in held if "Derringer" in name)
        assert view["at_hand"]["brought_out"] == [{"name": PHOTO, "turn": 1, "ref": ref, "status": "abandoned"}, {"name": pistol, "turn": 1}], view["at_hand"]
        assert {entry["name"] for entry in view["at_hand"]["brought_out"]} <= set(held), "every entry is a thing he holds, by the name holdings gives it"
        assert next(row for row in view["done"] if row["ref"] == ref)["status"] == "abandoned", "the status is the row's own"

        # Taken from him: no longer his to show.
        client.table("apply", call_id="t2-c3", effects=[{"kind": "object", "name": PHOTO, "from": "Steven Knott", "to": "Thomas Hayes",
                                                         "handover": "taken", "why": "I snatch the photograph"}])
        assert [entry["name"] for entry in situation(client)["at_hand"]["brought_out"]] == [pistol]
    finally:
        client.close()
