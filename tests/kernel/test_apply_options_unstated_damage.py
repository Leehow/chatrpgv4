"""BR-06: `table.apply.options.unstated_damage` -- the harm a stated step this turn reached leaves unstated (contract §138.10).

Every case drives the emitted kernel over RPC on a derived haunting (the shipped graph plus the rules below, linked from
the opening scene), and asserts what the read returned and which receipts exist -- never private state. The kernel's dice
are seeded, never stubbed: a "forced" level is a recorded seed for exactly that call sequence.
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from conftest import CAMPAIGN, CONTENT_DIR, RpcClient, campaign_dir, read_json

SOURCE = {"source_id": "pdf:call-of-cthulhu-keeper-rulebook-40th-the-haunting", "pdf_index": 452}
SPAN = "span-page-447-anchor-1"
START = "scene-commission-briefing"
ACTOR = "thomas-hayes"


def check(path, **extra):
    return {"scope": "actor", "values": [{"path": path, "label": path.split(".")[1]}], "selection": "maximum", "difficulty": "regular", **extra}


RULES = {
    # A ledge whose failed Jump states harm the page gives no dice for: the one shape the clerk lands as a band.
    "dark-ledge": {"hazard": {"trigger": {"kind": "keeper"}, "steps": [
        check("skills.Jump", results={"failure": {"effects": [{"kind": "damage", "dice_unstated": True}], "book": "They fall into the dark."},
                                      "fumble": {"effects": [{"kind": "damage", "dice_unstated": True}]}},
              push={"allowed": True}),
    ]}},
    # The chapel floor: a stated 1D6, which is the Keeper's to apply with `stated` (§136.22), never a row here.
    "chapel-floor": {"hazard": {"trigger": {"kind": "keeper"}, "steps": [
        check("skills.Jump", results={"failure": {"effects": [{"kind": "damage", "dice": "1D6"}]}}),
    ]}},
}


def derived_content(root: Path) -> Path:
    shutil.copytree(CONTENT_DIR, root)
    path = root / "starters" / "the-haunting" / "module-graph.json"
    graph = json.loads(path.read_text(encoding="utf-8"))
    for slug, mechanics in RULES.items():
        graph["nodes"].append({"node_id": f"rule-{slug}", "node_kind": "rule", "name": slug, "visibility": "keeper-only",
                               "aliases": [], "summary": f"{slug}.", "evidence_span_ids": [SPAN],
                               "properties": {"mechanics": mechanics}, "source_refs": [SOURCE]})
        graph["relations"].append({"relation_id": f"relation-br06-{len(graph['relations'])}", "relation_kind": "uses-rule",
                                   "from_node_id": START, "to_node_id": f"rule-{slug}", "properties": {}})
    path.write_text(json.dumps(graph, ensure_ascii=False), encoding="utf-8")
    return root


@pytest.fixture(scope="module")
def content(tmp_path_factory):
    return derived_content(tmp_path_factory.mktemp("br06") / "content")


@pytest.fixture
def table(tmp_path, content):
    clients: list[RpcClient] = []

    def open_at(seed: int) -> RpcClient:
        client = RpcClient(tmp_path / f"s{seed}-{len(clients)}", env={"COC_KERNEL_SEED": str(seed)}, content=content)
        clients.append(client)
        client.ok("campaign.create", {"id": CAMPAIGN, "module": "the-haunting", "pregen": ACTOR, "play_language": "en"})
        client.table("narrate", call_id="t0-c1", text="The opening.")
        client.table("player_input", text="I edge along the ledge.")
        return client
    yield open_at
    for client in clients:
        client.close()


def resolve(client, call_id, **action):
    body = {"intent": "move", "goal": "keep their footing", "method": "careful steps", **action}
    return client.call("table.resolve", {"campaign": CAMPAIGN, "call_id": call_id, "action": body})


def apply(client, call_id, *effects):
    return client.call("table.apply", {"campaign": CAMPAIGN, "call_id": call_id, "effects": list(effects)})


def ok(response):
    assert response["ok"], response.get("error")
    return response["result"]


def options(client):
    return client.ok("table.apply.options", {"campaign": CAMPAIGN})


def receipts(client):
    return read_json(campaign_dir(client.workspace) / "turn.json")["receipts"]


def sheet(client):
    return read_json(campaign_dir(client.workspace) / "party" / f"{ACTOR}.json")


# Seeds, each recorded for the exact sequence of its test:
JUMP_FAILS = 1          # dark-ledge step 0 (Jump) fails on the first roll of the turn
JUMP_PASSES = 15        # dark-ledge step 0 (Jump) passes (regular) on the first roll of the turn
JUMP_FAILS_PUSH_PASSES = 0  # dark-ledge fails, and the push that follows it passes


def test_a_reached_step_whose_damage_the_book_leaves_unstated_is_issued_until_harm_on_that_actor_lands(table):
    client = table(JUMP_FAILS)
    before = options(client)
    assert "unstated_damage" not in before, "nothing reached: the key is absent, as obligations are"
    rolled = ok(resolve(client, "t1-c1", rule="dark-ledge"))
    assert rolled["stated"]["level"] == "failure"
    assert rolled["stated"]["effects"] == [{"kind": "damage", "dice_unstated": True}]
    roll = next(row for row in receipts(client) if row["kind"] == "roll")
    issued = options(client)["unstated_damage"]
    assert issued == [{"alias": "unstated:0", "rule": "dark-ledge", "step": 0, "level": "failure", "actor": ACTOR,
                       "actor_label": roll["actor_label"], "book": "They fall into the dark.", "receipt": roll["id"]}]
    # Read-only and stable: the same read twice, the same revision, nothing written.
    again = options(client)
    assert again["unstated_damage"] == issued and again["revision"] == options(client)["revision"]
    assert again["revision"] != before["revision"], "the row is part of what the revision digests"

    assert [row["kind"] for row in receipts(client)] == ["roll"]
    # The band the clerk names lands as the kernel's roll on that actor, and the row is settled by it.
    hp = sheet(client)["current_hp"]
    landed = ok(apply(client, "t1-c2", {"kind": "damage", "band": "severe", "subject": ACTOR, "why": "the fall"}))
    rows = {row["id"]: row for row in receipts(client)}
    minted = [rows[receipt] for receipt in landed["receipts"]]
    assert all(row["basis"] == "banded" and row["band"] == "severe" for row in minted)
    dice = next(row for row in minted if row["kind"] == "roll")
    assert dice["expression"] == "1D10" and sheet(client)["current_hp"] == hp - dice["total"]
    assert "unstated_damage" not in options(client)


def test_a_stated_dice_issues_no_row_and_a_passed_step_issues_none(table):
    client = table(JUMP_FAILS)
    rolled = ok(resolve(client, "t1-c1", rule="chapel-floor"))
    assert rolled["stated"]["level"] == "failure" and rolled["stated"]["effects"] == [{"kind": "damage", "dice": "1D6"}]
    assert "unstated_damage" not in options(client), "a stated amount is the Keeper's to apply with stated (§136.22)"
    passed = table(JUMP_PASSES)
    rolled = ok(resolve(passed, "t1-c1", rule="dark-ledge"))
    assert rolled["stated"]["level"] not in ("failure", "fumble")
    assert "unstated_damage" not in options(passed)


def test_the_keepers_own_damage_settles_the_row_and_a_passed_push_withdraws_it(table):
    client = table(JUMP_FAILS)
    ok(resolve(client, "t1-c1", rule="dark-ledge"))
    assert len(options(client)["unstated_damage"]) == 1
    # The Keeper's own dice on the same actor settle it: whoever wrote the harm, it is written.
    ok(apply(client, "t1-c2", {"kind": "damage", "dice": "1D4", "why": "the fall"}))
    assert "unstated_damage" not in options(client)
    # A push continues the roll: when it passes, the failure's harm no longer stands (the latest roll on the rule).
    pushed = table(JUMP_FAILS_PUSH_PASSES)
    first = ok(resolve(pushed, "t1-c1", rule="dark-ledge"))
    assert first["stated"]["level"] == "failure" and first["stated"]["push"] == {"allowed": True}
    assert len(options(pushed)["unstated_damage"]) == 1
    push = ok(resolve(pushed, "t1-c2", push=True, stakes="they fall", method="a running leap"))
    assert push["stated"]["rule"] == "dark-ledge" and push["stated"]["level"] not in ("failure", "fumble")
    assert "unstated_damage" not in options(pushed)
