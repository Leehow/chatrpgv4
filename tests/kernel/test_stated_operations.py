"""RD-03: operations name a shape -- `action.rule`, `action.step`, `apply ... {stated}` (contract §136.20-§136.24).

Every case drives the emitted kernel over RPC on a derived haunting (the shipped graph plus the rule nodes below,
linked from the opening scene), and asserts what the kernel returned, which receipts exist and what the sheet and
the world hold -- never private state. A "forced" level is a recorded seed for exactly that call sequence (the
kernel's dice are seeded, never stubbed); each seed constant says what it forces.
"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

import pytest

from conftest import CAMPAIGN, CONTENT_DIR, WORKTREE, RpcClient, campaign_dir, read_json

sys.path.insert(0, str(WORKTREE / "tests" / "play"))
import kpi  # noqa: E402

SOURCE = {"source_id": "pdf:call-of-cthulhu-keeper-rulebook-40th-the-haunting", "pdf_index": 452}
SPAN = "span-page-447-anchor-1"
START = "scene-commission-briefing"
LIBRARY = "scene-central-library"
PUSH_LINE = "The ledge gives way under the second try."
HOUND = "cellar-hound"


def check(path, difficulty="regular", **extra):
    return {"scope": "actor", "values": [{"path": path, "label": path.split(".")[1]}], "selection": "maximum",
            "difficulty": difficulty, **extra}


RULES = {
    # The chapel floor as the spec states it: Luck, then Jump, then the book's 1D6 (spec D4.5 shape 7).
    "chapel-floor": {"hazard": {"trigger": {"kind": "keeper"}, "steps": [
        check("characteristics.Luck", results={"failure": {"effects": [{"kind": "next_step", "step": 1}]}}),
        check("skills.Jump", results={"failure": {"effects": [{"kind": "damage", "dice": "1D6"}], "book": "They land hard below."}},
              push={"allowed": True, "book": PUSH_LINE}),
    ]}},
    # A stated loss on seeing it, and a hazard beside it.
    "bed-attack": {"hazard": {"trigger": {"kind": "enter"}, "steps": [
        check("skills.Spot Hidden", results={"failure": {"effects": [{"kind": "next_step", "step": 1}]}}),
        check("skills.Dodge", results={"failure": {"effects": [{"kind": "damage", "dice": "1D6+2"}]}}),
    ]}, "sanity_loss": {"success": "1", "failure": "1D4"}},
    # A check against a person, with approaches, a minimum and a stated difficulty; its pass sets a flag.
    "knott-haggle": {"check": {"scope": "actor-target", "target": "npc-steven-knott",
                               "values": [{"path": "skills.Persuade", "label": "Persuade"},
                                          {"path": "skills.Credit Rating", "label": "Credit Rating", "minimum": 90}],
                               "selection": "approach", "difficulty": "hard",
                               "results": {level: {"effects": [{"kind": "flag", "flag_id": "knott-pays-more", "value": True}]}
                                           for level in ("critical", "extreme", "hard")}}},
    # An opposed check: the investigator's POW against the hound's.
    "hound-stare": {"check": {"scope": "opposed", "target": f"creature-{HOUND}",
                              "values": [{"path": "characteristics.POW", "label": "POW"}], "selection": "maximum",
                              "opposing": {"values": [{"path": "characteristics.POW", "label": "POW"}], "selection": "maximum"},
                              "difficulty": "regular",
                              "results": {"failure": {"effects": [{"kind": "sanity_loss", "success": "0", "failure": "1D3"}]}}}},
    # Own amounts for apply: time, and a reward's cash.
    "long-search": {"time_cost": {"amount": 4, "unit": "hour"}, "reward": {"cash": 30}},
    # Two damage amounts with no roll between them: ambiguous.
    "two-falls": {"damage": {"dice": "1D3"}, "hazard": {"trigger": {"kind": "keeper"}, "effects": [{"kind": "damage", "dice": "1D4"}]}},
    # A fall whose damage the page does not state.
    "dark-fall": {"damage": {"dice_unstated": True}},
    # A cost and nothing to roll.
    "plain-cost": {"resource_cost": {"resource": "mp", "amount": 1, "per": "use"}},
}
ELSEWHERE = {"library-dust": {"check": check("skills.Library Use")}}


def stated(graph, kind, slug, mechanics, name=None):
    graph["nodes"].append({"node_id": f"{kind}-{slug}", "node_kind": kind, "name": name or slug, "visibility": "keeper-only",
                           "aliases": [], "summary": f"{slug}.", "evidence_span_ids": [SPAN],
                           "properties": {"mechanics": mechanics}, "source_refs": [SOURCE]})


def link(graph, kind, source, target):
    graph["relations"].append({"relation_id": f"relation-rd03-{len(graph['relations'])}", "relation_kind": kind,
                               "from_node_id": source, "to_node_id": target, "properties": {}})


def derived_content(root: Path) -> Path:
    """The shipped content with the haunting graph derived as above; registration validates every shape (§136.8)."""
    shutil.copytree(CONTENT_DIR, root)
    path = root / "starters" / "the-haunting" / "module-graph.json"
    graph = json.loads(path.read_text(encoding="utf-8"))
    for slug, mechanics in RULES.items():
        stated(graph, "rule", slug, mechanics)
        link(graph, "uses-rule", START, f"rule-{slug}")
    for slug, mechanics in ELSEWHERE.items():
        stated(graph, "rule", slug, mechanics)
        link(graph, "uses-rule", LIBRARY, f"rule-{slug}")
    stated(graph, "creature", HOUND, {"profile": {"characteristics": {"STR": 60, "CON": 50, "SIZ": 50, "DEX": 70, "POW": 40},
                                                  "derived": {"HP": 10, "MOV": 10}, "skills": {"Fighting (Brawl)": 45, "Dodge": 35}}},
           name="Cellar hound")
    link(graph, "present-in", f"creature-{HOUND}", START)
    threat = next(node for node in graph["nodes"] if node["node_id"] == "threat-corbitt-haunting")
    threat["properties"]["runtime_projection"]["record"]["clocks"][0]["advances_on"] = [{"kind": "enter", "scene": "scene-basement-rites"}]
    threat["evidence_span_ids"] = threat.get("evidence_span_ids") or [SPAN]
    threat["source_refs"] = threat.get("source_refs") or [SOURCE]
    path.write_text(json.dumps(graph, ensure_ascii=False), encoding="utf-8")
    return root


@pytest.fixture(scope="module")
def content(tmp_path_factory):
    return derived_content(tmp_path_factory.mktemp("rd03") / "content")


@pytest.fixture
def table(tmp_path, content):
    clients: list[RpcClient] = []

    def open_at(seed: int, text: str = "I look around the office.") -> RpcClient:
        client = RpcClient(tmp_path / f"s{seed}-{len(clients)}", env={"COC_KERNEL_SEED": str(seed)}, content=content)
        clients.append(client)
        client.ok("campaign.create", {"id": CAMPAIGN, "module": "the-haunting", "pregen": "thomas-hayes", "play_language": "en"})
        client.table("narrate", call_id="t0-c1", text="The opening.")
        client.opened = client.table("player_input", text=text)["capsule"]
        return client
    yield open_at
    for client in clients:
        client.close()


def resolve(client, call_id, **action):
    body = {"intent": "move", "goal": "keep their footing", "method": "careful steps", **action}
    return client.call("table.resolve", {"campaign": CAMPAIGN, "call_id": call_id, "action": body})


def ok(response):
    assert response["ok"], response.get("error")
    return response["result"]


def refusal(response):
    assert not response["ok"], response.get("result")
    return response["error"]["code"], response["error"]["details"]["reason"]


def apply(client, call_id, *effects):
    return client.call("table.apply", {"campaign": CAMPAIGN, "call_id": call_id, "effects": list(effects)})


def receipts(client):
    return read_json(campaign_dir(client.workspace) / "turn.json")["receipts"]


def sheet(client):
    return read_json(campaign_dir(client.workspace) / "party" / "thomas-hayes.json")


def world(client):
    return read_json(campaign_dir(client.workspace) / "world.json")


# Seeds, each recorded for the exact sequence of its test:
LUCK_FAILS_JUMP_FAILS = 1   # chapel-floor step 0 (Luck) fails, then step 1 (Jump) fails
JUMP_FAILS_PUSH = 0         # chapel-floor step 1 fails, and the push that follows it passes (regular)
HAGGLE_PASSES = 15          # knott-haggle with Persuade reaches hard
STARE_SEED = 0              # hound-stare: the investigator succeeds (regular) and loses to the hound (hard)


# ---- resolve names a stated check ------------------------------------------------------------------


def test_a_hazards_steps_are_rolled_when_named_and_nothing_is_applied(table):
    client = table(LUCK_FAILS_JUMP_FAILS)
    hp = sheet(client)["current_hp"]
    luck = ok(resolve(client, "t1-c1", rule="chapel-floor"))
    # A lone Luck value runs the Luck roll (§136.20), and the book says step 1 follows.
    assert luck["decision"] == "push-luck:luck-roll"
    assert luck["stated"] == {"rule": "chapel-floor", "step": 0, "level": "failure", "effects": [], "next_step": 1}
    jump = ok(resolve(client, "t1-c2", rule="chapel-floor", step=1))
    assert jump["decision"] == "core-check:ordinary-check" and jump["outcome"]["skill"] == "Jump"
    assert jump["stated"]["level"] == "failure" and jump["stated"]["step"] == 1
    assert jump["stated"]["effects"] == [{"kind": "damage", "dice": "1D6"}]
    assert jump["stated"]["book"] == "They land hard below." and jump["stated"]["push"] == {"allowed": True, "book": PUSH_LINE}
    assert "next_step" not in jump["stated"]
    # Nothing but the two rolls: no hit point, no delta, no dice (owner ruling Q1).
    rows = receipts(client)
    assert [row["kind"] for row in rows] == ["roll", "roll"]
    assert sheet(client)["current_hp"] == hp
    assert rows[0]["basis"] == {"rule": "chapel-floor", "step": 0, "level": "failure"}
    assert rows[1]["basis"] == {"rule": "chapel-floor", "step": 1, "level": "failure"}
    # The Keeper applies the book's amount by naming it.
    landed = ok(apply(client, "t1-c3", {"kind": "damage", "stated": "chapel-floor", "why": "the floor gives"}))
    rows = {row["id"]: row for row in receipts(client)}
    minted = [rows[receipt] for receipt in landed["receipts"]]
    dice = next(row for row in minted if row["kind"] == "roll")
    assert dice["expression"] == "1D6" and 1 <= dice["total"] <= 6
    assert all(row["basis"] == "stated" and row["stated"] == "chapel-floor" for row in minted)
    assert sheet(client)["current_hp"] == hp - dice["total"]


def test_stated_beside_an_amount_is_a_conflict_and_the_keepers_own_amount_lands_as_keeper(table):
    client = table(LUCK_FAILS_JUMP_FAILS)
    ok(resolve(client, "t1-c1", rule="chapel-floor"))
    ok(resolve(client, "t1-c2", rule="chapel-floor", step=1))
    conflict = apply(client, "t1-c3", {"kind": "damage", "stated": "chapel-floor", "dice": "2D6"})
    assert refusal(conflict) == ("invalid_params", "stated_conflict")
    assert conflict["error"]["details"]["fields"] == ["dice"]
    assert [row["kind"] for row in receipts(client)] == ["roll", "roll"]
    # The module is reference: the Keeper's own dice land, and say so.
    own = ok(apply(client, "t1-c4", {"kind": "damage", "dice": "2D6"}))
    rows = {row["id"]: row for row in receipts(client)}
    assert [rows[receipt]["basis"] for receipt in own["receipts"]] == ["keeper"] * len(own["receipts"])
    assert all("stated" not in rows[receipt] for receipt in own["receipts"])
    assert next(rows[r] for r in own["receipts"] if rows[r]["kind"] == "roll")["expression"] == "2D6"


def test_a_push_continues_the_rule_it_pushes(table):
    client = table(JUMP_FAILS_PUSH)
    first = ok(resolve(client, "t1-c1", rule="chapel-floor", step=1))
    assert first["stated"]["level"] == "failure" and first["stated"]["push"]["book"] == PUSH_LINE
    pushed = ok(resolve(client, "t1-c2", push=True, stakes="they fall", method="a running leap"))
    assert pushed["stated"]["rule"] == "chapel-floor" and pushed["stated"]["step"] == 1
    assert receipts(client)[-1]["basis"]["pushed"] is True
    # The push is not pushed again; an explicit rule on it must be the one it continues.
    other = table(JUMP_FAILS_PUSH)
    ok(resolve(other, "t1-c1", rule="chapel-floor", step=1))
    assert refusal(resolve(other, "t1-c2", push=True, stakes="x", method="y", rule="bed-attack")) == ("invalid_params", "rule_decision")


def test_the_check_binds_its_approach_difficulty_and_person(table):
    client = table(HAGGLE_PASSES)
    haggle = ok(resolve(client, "t1-c1", rule="knott-haggle", intent="social", skill="Persuade",
                        goal="a better rate", method="haggle"))
    assert haggle["decision"] == "core-check:ordinary-check"
    assert haggle["outcome"]["skill"] == "Persuade" and haggle["outcome"]["difficulty"] == "hard"
    assert haggle["stated"]["level"] in ("critical", "extreme", "hard")
    assert haggle["stated"]["effects"] == [{"kind": "flag", "name": "knott-pays-more", "value": True}]
    # Stated, not written: the flag waits for the Keeper.
    assert "knott-pays-more" not in world(client).get("flags", {})
    flagged = ok(apply(client, "t1-c2", {"kind": "flag", "stated": "knott-haggle", "why": "Knott agrees"}))
    assert world(client)["flags"]["knott-pays-more"] is True
    row = next(r for r in receipts(client) if r["id"] == flagged["receipts"][0])
    assert row["basis"] == "stated" and row["stated"] == "knott-haggle"


def test_an_opposed_check_rolls_against_the_opponents_stated_value(table):
    client = table(STARE_SEED)
    stare = ok(resolve(client, "t1-c1", rule="hound-stare", intent="investigate", goal="outstare it", method="hold its gaze"))
    assert stare["decision"] == "core-check:opposed-check"
    outcome = stare["outcome"]
    assert outcome["skill"] == "POW" and outcome["opponent"]["target"] == 40 and outcome["opponent_id"] == HOUND
    # A success that loses the contest is a failure on the book's side of it (§136.21).
    assert (outcome["investigator"]["level"], outcome["winner"]) == ("regular", "opponent")
    assert stare["stated"]["level"] == "failure"
    assert stare["stated"]["effects"] == [{"kind": "sanity_loss", "san_loss": "0/1D3"}]


def test_a_luck_roll_named_by_its_decision_settles_on_the_actors_luck(table):
    """§136.20: the Luck roll had never settled (its skill slot was refused as undeclared); it does now, for any caller."""
    client = table(LUCK_FAILS_JUMP_FAILS)
    luck = ok(resolve(client, "t1-c1", decision="push-luck:luck-roll"))
    assert luck["decision"] == "push-luck:luck-roll" and luck["outcome"]["skill"] == "LUCK"
    assert luck["outcome"]["target"] == sheet(client)["current_luck"]
    assert "stated" not in luck and "basis" not in receipts(client)[-1]


# ---- refusals ---------------------------------------------------------------------------------------


def test_every_refusal_by_its_reason_and_none_writes_a_roll(table):
    client = table(HAGGLE_PASSES)
    social = {"intent": "social", "goal": "a better rate", "method": "haggle"}
    assert refusal(resolve(client, "t1-c1", rule="no-such-rule")) == ("unknown_entity", "rule_unknown")
    assert refusal(resolve(client, "t1-c2", rule="library-dust")) == ("not_here", "rule_not_here")
    assert refusal(resolve(client, "t1-c3", rule="chapel-floor", intent="idle")) == ("invalid_params", "rule_intent")
    assert refusal(resolve(client, "t1-c4", rule="chapel-floor", decision="core-check:opposed-check")) == ("invalid_params", "rule_decision")
    assert refusal(resolve(client, "t1-c5", rule="chapel-floor", step=2)) == ("invalid_params", "rule_step")
    assert refusal(resolve(client, "t1-c6", rule="knott-haggle", step=0, **social, skill="Persuade")) == ("invalid_params", "rule_step")
    assert refusal(resolve(client, "t1-c7", rule="plain-cost")) == ("invalid_params", "rule_no_check")
    missing = resolve(client, "t1-c8", rule="knott-haggle", **social)
    assert refusal(missing) == ("needs", "rule_skill")
    assert missing["error"]["details"]["needs"]["options"] == ["Persuade", "Credit Rating"]
    assert refusal(resolve(client, "t1-c9", rule="knott-haggle", skill="Spot Hidden", **social)) == ("invalid_params", "rule_skill")
    assert refusal(resolve(client, "t1-c10", rule="knott-haggle", skill="Credit Rating", **social)) == ("invalid_params", "rule_minimum")
    assert refusal(resolve(client, "t1-c11", rule="knott-haggle", skill="Persuade", target="Cellar hound", **social)) == ("invalid_params", "rule_target")
    assert refusal(resolve(client, "t1-c12", rule="knott-haggle", skill="Persuade",
                           modifiers={"difficulty": "regular"}, **social)) == ("invalid_params", "rule_difficulty")
    assert refusal(resolve(client, "t1-c13", rule="chapel-floor", obligation="globe-clippings-access")) == ("invalid_params", "rule_decision")
    assert refusal(resolve(client, "t1-c14", step=1)) == ("invalid_params", "rule_step")
    assert not [row for row in receipts(client) if row["kind"] == "roll"]


def test_stated_refusals_by_reason(table):
    client = table(HAGGLE_PASSES)
    assert refusal(apply(client, "t1-c1", {"kind": "damage", "stated": "no-such-rule"})) == ("unknown_entity", "stated_unknown")
    ambiguous = apply(client, "t1-c2", {"kind": "damage", "stated": "two-falls"})
    assert refusal(ambiguous) == ("invalid_params", "stated_ambiguous")
    assert ambiguous["error"]["details"]["choices"] == [{"kind": "damage", "dice": "1D3"}, {"kind": "damage", "dice": "1D4"}]
    assert refusal(apply(client, "t1-c3", {"kind": "time", "stated": "two-falls"})) == ("invalid_params", "stated_none")
    assert refusal(apply(client, "t1-c4", {"kind": "damage", "stated": "dark-fall"})) == ("invalid_params", "stated_unstated")
    assert refusal(apply(client, "t1-c5", {"kind": "move", "to": "central-library", "stated": "long-search"})) == ("invalid_params", "stated_none")
    assert not receipts(client)


def test_time_threat_and_cash_take_the_nodes_own_amounts(table):
    client = table(HAGGLE_PASSES)
    before = world(client)["clock"]["minutes"]
    time = ok(apply(client, "t1-c1", {"kind": "time", "stated": "long-search", "why": "the stacks"}))
    assert world(client)["clock"]["minutes"] == before + 240
    threat = ok(apply(client, "t1-c2", {"kind": "threat", "stated": "corbitt-haunting", "why": "they went in"}))
    cash = ok(apply(client, "t1-c3", {"kind": "cash", "stated": "long-search", "with": "Steven Knott", "why": "paid"}))
    rows = {row["id"]: row for row in receipts(client)}
    assert rows[time["receipts"][0]]["minutes"] == 240 and rows[time["receipts"][0]]["basis"] == "stated"
    tick = rows[threat["receipts"][0]]
    assert (tick["threat"], tick["clock"], tick["after"], tick["stated"]) == ("corbitt-haunting", "corbitt-awareness", 1, "corbitt-haunting")
    paid = rows[cash["receipts"][0]]
    assert paid["delta"] == 30 and paid["source"] == "quote" and paid["stated"] == "long-search"


# ---- sanity ---------------------------------------------------------------------------------------


def test_a_sanity_check_takes_its_pair_from_the_rule(table):
    client = table(HAGGLE_PASSES)
    look = {"intent": "investigate", "goal": "the bed rears up", "method": "watches", "decision": "sanity:check", "involuntary": "flee"}
    result = ok(resolve(client, "t1-c1", rule="bed-attack", **look))
    assert result["decision"] == "sanity:check" and result["stated"] == {"rule": "bed-attack", "san_loss": "1/1D4"}
    loss = result["outcome"]["san_loss"]
    assert (loss == 1) if result["outcome"]["passed"] else (1 <= loss <= 4)
    assert next(row for row in receipts(client) if row["kind"] == "roll")["basis"] == {"rule": "bed-attack"}
    assert refusal(resolve(client, "t1-c2", rule="bed-attack", san_loss="0/1D6", **look)) == ("invalid_params", "stated_conflict")
    assert refusal(resolve(client, "t1-c3", rule="chapel-floor", **look)) == ("invalid_params", "stated_none")


# ---- the module is reference ------------------------------------------------------------------------


def test_a_stated_hazard_refuses_no_unrelated_operation(table):
    """Spec P8: the scene states a hazard; a resolve and an apply that do not name it land as without it."""
    client = table(LUCK_FAILS_JUMP_FAILS)
    plain = ok(resolve(client, "t1-c1", intent="investigate", skill="Jump", goal="jump the gap", method="jumps"))
    assert "stated" not in plain
    assert "basis" not in receipts(client)[-1]
    moved = ok(apply(client, "t1-c2", {"kind": "time", "minutes": 10}))
    assert receipts(client)[-1]["id"] == moved["receipts"][0] and receipts(client)[-1]["basis"] == "keeper"
    # Even after the hazard was rolled, an apply without stated is the Keeper's own amount.
    ok(resolve(client, "t1-c3", rule="chapel-floor"))
    own = ok(apply(client, "t1-c4", {"kind": "damage", "dice": "1D2"}))
    assert all(row["basis"] == "keeper" for row in receipts(client) if row["id"] in own["receipts"])


# ---- the offer ledger -------------------------------------------------------------------------------


def test_the_offer_ledger_counts_stated_rows_and_kpi_counts_the_kind(table):
    client = table(LUCK_FAILS_JUMP_FAILS)
    ok(resolve(client, "t1-c1", rule="chapel-floor"))
    ok(apply(client, "t1-c2", {"kind": "time", "stated": "long-search"}))
    client.table("narrate", call_id="t1-c3", text="The boards creak.")
    rows = [json.loads(line) for line in (campaign_dir(client.workspace) / "telemetry.jsonl").read_text().splitlines() if line.strip()]
    ledger = next(row for row in rows if row.get("lane") == "offers" and row["turn"] == 1)
    # One offer per where.rules row of the turn's capsule that carries a mech line, by the node's handle.
    rows_with_mech = [row["name"] for row in client.opened["where"]["rules"] if "mech" in row]
    assert rows_with_mech and set(rows_with_mech) <= set(RULES)
    offered = [offer for offer in ledger["offered"] if offer.startswith("stated:")]
    assert offered == [f"stated:{name}" for name in rows_with_mech]
    assert {offer for offer in ledger["taken"] if offer.startswith("stated:")} == {"stated:chapel-floor", "stated:long-search"}
    counted = kpi.offers(rows)["by_kind"]["stated"]
    assert counted == {"offered": len(rows_with_mech), "taken": 2, "never_taken": False}
    # Counting only: nothing of the ledger reaches the next capsule.
    assert "stated:" not in json.dumps(client.table("player_input", text="I go on.")["capsule"])
